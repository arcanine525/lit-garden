import { randomInt } from 'node:crypto';
import { expect } from '@playwright/test';

// Hold the first transaction after it has locked the teacher and class. Start
// the second request and verify PostgreSQL says it is blocked by the first.
export async function overlap(db,name,table,event,predicate,first,second) {
  const guard = await db.connect();
  const key = randomInt(100_000_000,2_000_000_000);
  const pending = [];
  let installed = false;
  const waiting = `SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=$1 AND objsubid=1 AND NOT granted`;
  try {
    await guard.query('SELECT pg_advisory_lock($1)',[key]);
    await db.query(`CREATE FUNCTION garden.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF ${predicate} THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${name} BEFORE ${event} ON garden.${table} FOR EACH ROW EXECUTE FUNCTION garden.${name}()`);
    installed = true;
    pending.push(first());
    await expect.poll(async () => (await db.query(waiting,[key])).rowCount).toBe(1);
    pending.push(second());
    await expect.poll(async () => (await db.query(`SELECT EXISTS (
      SELECT 1 FROM (${waiting}) first_waiter JOIN pg_stat_activity activity
        ON first_waiter.pid=ANY(pg_blocking_pids(activity.pid))
    ) AS queued`,[key])).rows[0].queued).toBe(true);
    await guard.query('SELECT pg_advisory_unlock($1)',[key]);
    for (const response of await Promise.all(pending)) expect(response.status()).toBe(200);
  } finally {
    try {
      await guard.query('SELECT pg_advisory_unlock($1)',[key]);
      await Promise.allSettled(pending);
      if (installed) await db.query(`DROP TRIGGER ${name} ON garden.${table}; DROP FUNCTION garden.${name}()`);
    } finally { guard.release(); }
  }
}
