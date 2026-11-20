import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const directory = new URL('./migrations/', import.meta.url);

export function migrationPool(database = process.env.APP_DB_NAME) {
  for (const key of ['APP_DB_HOST', 'APP_DB_PORT', 'APP_DB_NAME', 'APP_DB_USER', 'APP_DB_PASSWORD']) {
    if (!process.env[key]) throw new Error(`Missing server setting: ${key}`);
  }
  const port = Number(process.env.APP_DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid APP_DB_PORT');
  return new pg.Pool({
    host: process.env.APP_DB_HOST,
    port,
    database,
    user: process.env.APP_DB_USER,
    password: process.env.APP_DB_PASSWORD,
    connectionTimeoutMillis: 5000
  });
}

export async function migrate(pool, { through } = {}) {
  const files = (await readdir(directory)).filter(name => /^\d{3}-[a-z0-9-]+\.sql$/.test(name)).sort();
  const limit = through ? files.indexOf(through) + 1 : files.length;
  if (!limit) throw new Error('Unknown migration target');
  const migrations = await Promise.all(files.map(async name => {
    const bytes = await readFile(new URL(name, directory));
    return { name, sql: bytes.toString('utf8'), sha256: createHash('sha256').update(bytes).digest('hex') };
  }));

  const client = await pool.connect();
  const applied = [];
  try {
    // Session lock serializes runners across the migration transactions.
    await client.query("SELECT pg_advisory_lock(hashtext('lit-garden-app-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS public.garden_schema_migrations (
      name text PRIMARY KEY,
      sha256 char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    const previous = await client.query('SELECT name, sha256 FROM public.garden_schema_migrations ORDER BY name');
    if (previous.rows.some((row, i) => row.name !== migrations[i]?.name || row.sha256 !== migrations[i]?.sha256)) {
      throw new Error('Applied migration history does not match the checked-in files');
    }
    if (previous.rows.length > limit) throw new Error('Migration target precedes the database version');

    for (const migration of migrations.slice(previous.rows.length, limit)) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO public.garden_schema_migrations(name, sha256) VALUES ($1, $2)',
          [migration.name, migration.sha256]);
        await client.query('COMMIT');
        applied.push(migration.name);
      } catch (cause) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed: ${migration.name} (${cause.code ?? 'UNKNOWN'})`, { cause });
      }
    }
    return applied;
  } finally {
    // A closed connection releases the session lock even after an I/O error.
    client.release(true);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pool;
  try {
    pool = migrationPool();
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Migrations already current.');
  } catch (error) {
    console.error(error.cause ? error.message : `Database migration stopped (${error.code ?? error.message})`);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}
