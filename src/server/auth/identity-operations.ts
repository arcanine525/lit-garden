import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database } from '../db';
import { requiredEnv } from '../config';
import { fenceStudentWrites } from '../student-drafts/policy';
import { fenceReplyWrites, fenceReviewWrites } from '../reviews/policy';
import { userManagement } from './iam';

export const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const kindToAudit = {
  create_teacher: 'PROVISION', suspend_teacher: 'SUSPEND',
  resume_teacher: 'RESUME', reset_student: 'RESET'
} as const;
type Kind = keyof typeof kindToAudit;
type State = 'reserved' | 'unknown' | 'needs_admin' | 'committed';
type Operation = { id: string; kind: Kind; state: State; target_user_id: string; request_digest: string };
type Person = { id: string; username: string; display_name: string; status: string; role: string; oidc_subject: string };
export type Mutation =
  | { kind: 'create_teacher'; key: string; username: string; name: string }
  | { kind: 'suspend_teacher' | 'resume_teacher'; key: string; userId: string }
  | { kind: 'reset_student'; key: string; userId: string; identityVerified: true };

export class IdentityError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

async function audit(connection: PoolClient, actor: string, operation: Operation, outcome: string) {
  await connection.query(`
    INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,identity_operation_id,outcome)
    VALUES ($1,$2,'user',$3,$4,$5)
  `, [actor, kindToAudit[operation.kind], operation.target_user_id, operation.id, outcome]);
}

async function tx<Output>(run: (connection: PoolClient) => Promise<Output>, locked?: PoolClient) {
  const connection = locked ?? await database().connect();
  try {
    await connection.query('BEGIN');
    const result = await run(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') throw new IdentityError(409, 'ALREADY_EXISTS_OR_PENDING');
    throw error;
  } finally {
    if (!locked) connection.release();
  }
}

export async function accountDirectory() {
  const { rows } = await database().query(`
    SELECT users.id, users.username, users.display_name, users.role, users.status,
      drive.state AS drive_state, drive.checked_at AS drive_checked_at,
      pending.id AS pending_identity_operation_id
    FROM garden.users LEFT JOIN garden.drive_connections AS drive ON drive.teacher_id=users.id
    LEFT JOIN garden.identity_operations AS pending ON pending.target_user_id=users.id
      AND pending.kind IN ('suspend_teacher','resume_teacher') AND pending.state IN ('reserved','unknown')
    WHERE users.role IN ('teacher','student') ORDER BY users.role,users.username
  `);
  return rows;
}

async function reserve(actor: string, input: Mutation) {
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return tx(async connection => {
    const owner = await connection.query("SELECT id FROM garden.users WHERE id=$1 AND role='admin' AND status='active' FOR UPDATE", [actor]);
    if (!owner.rowCount) throw new IdentityError(403, 'FORBIDDEN');
    const replay = await connection.query<Operation>(`
      SELECT id,kind,state,target_user_id,request_digest FROM garden.identity_operations
      WHERE actor_id=$1 AND idempotency_key=$2
    `, [actor, input.key]);
    if (replay.rows[0]) {
      if (replay.rows[0].request_digest !== fingerprint) throw new IdentityError(409, 'REQUEST_CHANGED');
      return { operation: replay.rows[0], fresh: false };
    }

    let target: string;
    if (input.kind === 'create_teacher') {
      const created = await connection.query<{ id: string }>(`
        WITH ident AS (SELECT gen_random_uuid() AS id)
        INSERT INTO garden.users(id,oidc_issuer,oidc_subject,username,display_name,role,status)
        SELECT id,$1,'provisioning:'||id::text,$2,$3,'teacher','provisioning' FROM ident RETURNING id
      `, [requiredEnv('KEYCLOAK_ISSUER'), input.username, input.name]);
      target = created.rows[0].id;
      await connection.query('INSERT INTO garden.teachers(id) VALUES ($1)', [target]);
    } else {
      target = input.userId;
      const { rows } = await connection.query<Person>(`
        SELECT id,role,status,oidc_subject FROM garden.users WHERE id=$1 AND oidc_issuer=$2 FOR UPDATE
      `, [target, requiredEnv('KEYCLOAK_ISSUER')]);
      const account = rows[0];
      const role = input.kind === 'reset_student' ? 'student' : 'teacher';
      if (!account || account.role !== role || account.oidc_subject.startsWith('provisioning:')) throw new IdentityError(404, 'ACCOUNT_NOT_FOUND');
      if (input.kind === 'resume_teacher' && account.status !== 'suspended') throw new IdentityError(409, 'ACCOUNT_NOT_SUSPENDED');
      await connection.query('UPDATE garden.users SET status=$2, auth_epoch=auth_epoch+1 WHERE id=$1',
        [target, role === 'student' ? 'provisioning' : 'suspended']);
      await connection.query('DELETE FROM garden.app_sessions WHERE user_id=$1', [target]);
      if (input.kind === 'suspend_teacher') {
        await fenceStudentWrites(connection,{ teacher:target });
        await fenceReviewWrites(connection,target);
      }
      if (input.kind === 'reset_student') {
        await fenceStudentWrites(connection,{ student:target });
        await fenceReplyWrites(connection,{ student:target });
      }
    }
    const { rows } = await connection.query<Operation>(`
      INSERT INTO garden.identity_operations(actor_id,target_user_id,kind,idempotency_key,request_digest)
      VALUES ($1,$2,$3,$4,$5) RETURNING id,kind,state,target_user_id,request_digest
    `, [actor, target, input.kind, input.key, fingerprint]);
    await audit(connection, actor, rows[0], 'requested');
    return { operation: rows[0], fresh: true };
  });
}

function publicOperation(operation: Operation) {
  return { id: operation.id, kind: operation.kind, state: operation.state, accountId: operation.target_user_id };
}

async function execute(actor: string, id: string, retry: boolean) {
  const lock = await database().connect();
  try {
    const { rows: [guard] } = await lock.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 9018)) AS acquired', [id]
    );
    if (!guard.acquired) throw new IdentityError(409, 'OP_IN_PROGRESS');
    const { rows: [operation] } = await lock.query<Operation & Person & { id: string }>(`
      SELECT operation.id, operation.kind, operation.state, operation.request_digest,
        operation.target_user_id, account.username, account.display_name, account.oidc_subject
      FROM garden.identity_operations AS operation
      JOIN garden.users AS account ON operation.target_user_id=account.id
      WHERE operation.id=$1
    `, [id]);
    if (!operation) throw new IdentityError(404, 'OP_NOT_FOUND');
    const teacherToggle = ['suspend_teacher', 'resume_teacher'].includes(operation.kind);
    if (retry && !teacherToggle) throw new IdentityError(409, 'REQUIRES_OPERATOR');
    if (operation.state === 'committed' || operation.state === 'needs_admin') return { operation: publicOperation(operation) };

    let subject = operation.oidc_subject;
    let temporaryPassword: string | undefined;
    try {
      const iam = await userManagement();
      switch (operation.kind) {
        case 'create_teacher':
          temporaryPassword = randomBytes(18).toString('base64url');
          subject = await iam.provisionTeacher(operation.target_user_id, operation.username, operation.display_name, temporaryPassword);
          break;
        case 'reset_student':
          temporaryPassword = randomBytes(18).toString('base64url');
          await iam.resetPassword(subject, temporaryPassword);
          break;
        case 'suspend_teacher':
        case 'resume_teacher':
          await iam.setTeacherEnabled(subject, operation.kind === 'resume_teacher');
          break;
      }
    } catch {
      operation.state = teacherToggle ? 'unknown' : 'needs_admin';
      await tx(async connection => {
        await connection.query('UPDATE garden.identity_operations SET state=$2 WHERE id=$1', [id, operation.state]);
        await audit(connection, actor, operation, 'unknown');
      }, lock);
      return { operation: publicOperation(operation) };
    }

    await tx(async connection => {
      await connection.query('UPDATE garden.users SET status=$2, oidc_subject=$3 WHERE id=$1',
        [operation.target_user_id, operation.kind === 'suspend_teacher' ? 'suspended' : 'active', subject]);
      await connection.query("UPDATE garden.identity_operations SET state='committed',keycloak_user_id=$2 WHERE id=$1",
        [id, subject]);
      await audit(connection, actor, operation, 'success');
    }, lock);
    operation.state = 'committed';
    return { operation: publicOperation(operation), ...(temporaryPassword ? { temporaryPassword } : {}) };
  } finally {
    lock.release(true);
  }
}

export async function changeIdentity(actor: string, input: Mutation) {
  const { operation, fresh } = await reserve(actor, input);
  if (!fresh) return { operation: publicOperation(operation) };
  return execute(actor, operation.id, false);
}

export function reconcileIdentity(actor: string, id: string) {
  return execute(actor, id, true);
}
