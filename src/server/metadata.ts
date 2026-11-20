import type { Pool, PoolClient } from 'pg';

type Executor = Pick<Pool | PoolClient, 'query'>;
type Identity = {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'teacher' | 'student';
  status: 'active' | 'suspended' | 'provisioning';
  auth_epoch: string;
};
type Submission = {
  id: string;
  submission_no: number;
  current_publication_id: string | null;
  submitted_at: Date;
};

// Callers supply identity claims or actor IDs from verified server sessions.
// Boundary queries select metadata fields explicitly and bind IDs as parameters.

export async function findIdentity(db: Executor, issuer: string, subject: string): Promise<Identity | null> {
  const { rows } = await db.query<Identity>(`
    SELECT id, username, display_name, role, status, auth_epoch
    FROM garden.users
    WHERE oidc_issuer = $1 AND oidc_subject = $2
  `, [issuer, subject]);
  return rows[0] ?? null;
}

export async function findLatestSubmission(db: Executor, actorId: string, recipientId: string): Promise<Submission | null> {
  const { rows } = await db.query<Submission>(`
    SELECT id, submission_no, current_publication_id, submitted_at
    FROM garden.latest_submission_metadata
    WHERE recipient_id = $2 AND garden.can_read_submission($1, id)
  `, [actorId, recipientId]);
  return rows[0] ?? null;
}

export async function metadataReady(db: Executor): Promise<boolean> {
  const { rows } = await db.query<{ ready: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM public.garden_schema_migrations WHERE name = $1
    ) AND to_regclass('garden.users') IS NOT NULL AS ready
  `, ['009-private-assets.sql']);
  return rows[0]?.ready === true;
}
