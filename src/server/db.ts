import { Pool } from 'pg';
import { requiredEnv } from './config';

let pool: Pool | undefined;

export function database(): Pool {
  if (pool) return pool;
  const port = Number(requiredEnv('APP_DB_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid APP_DB_PORT');
  pool = new Pool({
    host: requiredEnv('APP_DB_HOST'),
    port,
    database: requiredEnv('APP_DB_NAME'),
    user: requiredEnv('APP_DB_USER'),
    password: requiredEnv('APP_DB_PASSWORD'),
    connectionTimeoutMillis: 2500,
    statement_timeout: 2500,
    max: 5
  });
  // pg can emit an error when an idle connection dies during a dependency restart.
  pool.on('error', () => process.stderr.write('postgres_idle_connection_closed\n'));
  return pool;
}
