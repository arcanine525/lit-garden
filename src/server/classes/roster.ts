import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database } from '../db';
import { requiredEnv } from '../config';
import { userManagement } from '../auth/iam';
import { grantOpenAssignments } from '../assignments/recipients';
import { csvStudents, type CsvRow } from './csv';

export class RosterError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

async function tx<Output>(run: (connection: PoolClient) => Promise<Output>, held?: PoolClient) {
  const connection = held ?? await database().connect();
  try {
    await connection.query('BEGIN');
    const result = await run(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    if ((error as { code?: string }).code === '23505') throw new RosterError(409, 'DUPLICATE');
    throw error;
  } finally {
    if (!held) connection.release();
  }
}

const digestCode = (code: string) => createHmac('sha256', requiredEnv('APP_JOIN_CODE_SECRET')).update(code).digest('hex');
const joinCode = () => randomBytes(6).toString('hex').toUpperCase();

async function activeTeacher(connection: PoolClient, teacher: string) {
  const result = await connection.query(
    "SELECT id FROM garden.users WHERE id=$1 AND role='teacher' AND status='active' FOR UPDATE", [teacher]);
  if (!result.rowCount) throw new RosterError(403, 'FORBIDDEN');
}

type ClassState = 'active' | 'archived';
type MembershipState = 'active' | 'removed';

async function ownedClass(connection: PoolClient, teacher: string, classId: string, requireActive = true) {
  const { rows } = await connection.query<{ state: ClassState }>(
    'SELECT state FROM garden.classes WHERE id=$1 AND teacher_id=$2 FOR UPDATE', [classId, teacher]);
  if (!rows[0]) throw new RosterError(404, 'CLASS_NOT_FOUND');
  if (requireActive && rows[0].state !== 'active') throw new RosterError(409, 'CLASS_ARCHIVED');
  return rows[0].state;
}

export async function listTeacherClasses(teacher: string, archived: boolean) {
  const scope = [teacher, archived ? 'archived' : 'active'];
  const [classes, memberships, requests] = await Promise.all([
    database().query('SELECT id,name,school_year,state FROM garden.classes WHERE teacher_id=$1 AND state=$2 ORDER BY name,school_year', scope),
    database().query(`SELECT membership.class_id, membership.student_id, account.display_name, account.username, membership.state
      FROM garden.memberships membership JOIN garden.classes class ON class.id=membership.class_id
      JOIN garden.users account ON account.id=membership.student_id
      WHERE class.teacher_id=$1 AND class.state=$2 ORDER BY account.username`, scope),
    database().query(`SELECT request.id,request.class_id,account.display_name,account.username
      FROM garden.enrollment_requests request JOIN garden.classes class ON class.id=request.class_id
      JOIN garden.users account ON account.id=request.student_id
      WHERE class.teacher_id=$1 AND class.state=$2 AND request.state='pending' ORDER BY request.requested_at`, scope)
  ]);
  return { classes: classes.rows, memberships: memberships.rows, requests: requests.rows };
}

export async function listStudentClasses(student: string) {
  const { rows } = await database().query(`
    SELECT class.id,class.name,class.school_year,teacher.display_name AS teacher,class.state AS class_state,
      CASE WHEN membership.state='active' THEN 'active' WHEN pending.id IS NOT NULL THEN 'pending'
        ELSE membership.state END AS state
    FROM garden.classes class JOIN garden.users teacher ON teacher.id=class.teacher_id
    LEFT JOIN garden.memberships membership ON membership.class_id=class.id AND membership.student_id=$1
    LEFT JOIN garden.enrollment_requests pending ON pending.class_id=class.id AND pending.student_id=$1 AND pending.state='pending'
    WHERE membership.student_id IS NOT NULL OR pending.id IS NOT NULL
    ORDER BY class.name,teacher.display_name
  `, [student]);
  return { classes: rows };
}

export function saveClass(teacher: string, name: string, year: string, id?: string) {
  return tx(async connection => {
    await activeTeacher(connection, teacher);
    if (id) {
      await ownedClass(connection, teacher, id);
      await connection.query('UPDATE garden.classes SET name=$2,school_year=$3,version=version+1 WHERE id=$1', [id, name, year]);
      return { classId: id };
    }
    const code = joinCode();
    const { rows } = await connection.query<{ id: string }>(
      'INSERT INTO garden.classes(teacher_id,name,school_year,join_code_digest) VALUES($1,$2,$3,$4) RETURNING id',
      [teacher, name, year, digestCode(code)]);
    return { classId: rows[0].id, joinCode: code };
  });
}

export function setClassState(teacher: string, classId: string, state: ClassState) {
  return tx(async connection => {
    await activeTeacher(connection, teacher);
    const current = await ownedClass(connection, teacher, classId, false);
    if (current !== state) {
      await connection.query('UPDATE garden.classes SET state=$2,version=version+1 WHERE id=$1', [classId,state]);
      await connection.query(`
        INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,outcome)
        VALUES($1,$2,'class',$3,'success')
      `, [teacher, state === 'archived' ? 'ARCHIVE' : 'UNARCHIVE', classId]);
    }
    return { state };
  });
}

export function setMembershipState(teacher: string, classId: string, studentId: string, state: MembershipState) {
  return tx(async connection => {
    await activeTeacher(connection, teacher);
    await ownedClass(connection, teacher, classId);
    const { rows } = await connection.query<{ state: MembershipState }>(`
      SELECT state FROM garden.memberships WHERE class_id=$1 AND student_id=$2 FOR UPDATE
    `, [classId,studentId]);
    if (!rows[0]) throw new RosterError(404, 'MEMBERSHIP_NOT_FOUND');
    if (rows[0].state !== state) {
      await connection.query(`
        UPDATE garden.memberships SET state=$3,version=version+1,
          removed_at=CASE WHEN $3='removed' THEN now() ELSE NULL END
        WHERE class_id=$1 AND student_id=$2
      `, [classId,studentId,state]);
      if (state === 'active') {
        await connection.query(`
          UPDATE garden.enrollment_requests SET state='approved',decided_by=$3,decided_at=now()
          WHERE class_id=$1 AND student_id=$2 AND state='pending'
        `, [classId,studentId,teacher]);
        await grantOpenAssignments(connection,teacher,classId,studentId);
      }
      await connection.query(`
        INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,class_id,outcome)
        VALUES($1,$2,'membership',$3,$4,'success')
      `, [teacher, state === 'removed' ? 'REMOVE' : 'RESTORE', studentId, classId]);
    }
    return { state };
  });
}

export function requestEnrollment(student: string, code: string) {
  return tx(async connection => {
    const { rows } = await connection.query<{ id: string; teacher_id: string }>(`
      SELECT class.id,class.teacher_id FROM garden.classes class JOIN garden.users teacher ON teacher.id=class.teacher_id
      WHERE class.join_code_digest=$1 AND class.state='active' AND teacher.status='active'
    `, [digestCode(code)]);
    if (!rows[0]) throw new RosterError(404, 'CLASS_NOT_FOUND');
    const { id: classId, teacher_id: teacherId } = rows[0];
    await activeTeacher(connection, teacherId);
    await ownedClass(connection, teacherId, classId);
    const enrolled = await connection.query("SELECT 1 FROM garden.memberships WHERE class_id=$1 AND student_id=$2 AND state='active'", [classId, student]);
    if (enrolled.rowCount) return { classId, state: 'active' };
    await connection.query(`
      INSERT INTO garden.enrollment_requests(class_id,student_id) VALUES($1,$2)
      ON CONFLICT (class_id,student_id) WHERE state='pending' DO NOTHING
    `, [classId, student]);
    return { classId, state: 'pending' };
  });
}

export function approveEnrollment(teacher: string, requestId: string) {
  return tx(async connection => {
    await activeTeacher(connection, teacher);
    const { rows } = await connection.query<{ class_id: string; student_id: string; state: string }>(
      'SELECT class_id,student_id,state FROM garden.enrollment_requests WHERE id=$1', [requestId]);
    const request = rows[0];
    if (!request) throw new RosterError(404, 'REQUEST_NOT_FOUND');
    await ownedClass(connection, teacher, request.class_id);
    if (request.state === 'approved') return { state: 'approved' };
    if (request.state !== 'pending') throw new RosterError(409, 'REQUEST_CLOSED');
    await connection.query(`
      INSERT INTO garden.memberships(class_id,student_id,state) VALUES($1,$2,'active')
      ON CONFLICT (class_id,student_id) DO UPDATE SET state='active',removed_at=NULL,version=garden.memberships.version+1
    `, [request.class_id, request.student_id]);
    await grantOpenAssignments(connection,teacher,request.class_id,request.student_id);
    await connection.query(`
      UPDATE garden.enrollment_requests SET state='approved',decided_by=$2,decided_at=now() WHERE id=$1
    `, [requestId, teacher]);
    await connection.query(`
      INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,outcome)
      VALUES($1,'ENROLL','request',$2,'success')
    `, [teacher, requestId]);
    return { state: 'approved' };
  });
}

type Provision = { id: string; target_user_id: string; request_digest: string; state: string; keycloak_user_id: string | null };
type StudentInput = { name: string; username: string; classId: string };
const digestInput = (input: StudentInput) => createHash('sha256').update(JSON.stringify([input.classId, input.username, input.name])).digest('hex');

export async function provisionStudent(teacher: string, key: string, input: StudentInput) {
  const { name, username, classId } = input;
  let operation: Provision | undefined;
  try {
    operation = await tx(async connection => {
      await activeTeacher(connection, teacher);
      await ownedClass(connection, teacher, classId);
      const prior = await connection.query<Provision>(`
        SELECT id,target_user_id,request_digest,state,keycloak_user_id FROM garden.identity_operations
        WHERE actor_id=$1 AND idempotency_key=$2 AND kind='create_student'
      `, [teacher, key]);
      const retry = prior.rows[0];
      const digest = digestInput(input);
      if (retry) {
        if (retry.request_digest !== digest) throw new RosterError(409, 'REQUEST_CHANGED');
        return retry;
      }
      const { rows } = await connection.query<{ id: string }>(`
        WITH candidate AS (SELECT gen_random_uuid() AS id)
        INSERT INTO garden.users(id,oidc_issuer,oidc_subject,username,display_name,role,status)
        SELECT id,$1,'provisioning:'||id::text,$2,$3,'student','provisioning' FROM candidate
        ON CONFLICT (username) DO NOTHING RETURNING id
      `, [requiredEnv('KEYCLOAK_ISSUER'), username, name]);
      if (!rows[0]) return undefined;
      const inserted = await connection.query<Provision>(`
        INSERT INTO garden.identity_operations(actor_id,target_user_id,kind,idempotency_key,intended_class_id,request_digest)
        VALUES($1,$2,'create_student',$3,$4,$5)
        RETURNING id,target_user_id,request_digest,state,keycloak_user_id
      `, [teacher, rows[0].id, key, classId, digest]);
      return inserted.rows[0];
    });
  } catch (error) {
    if (error instanceof RosterError) throw error;
    throw new RosterError(503, 'PROVISION_UNAVAILABLE');
  }
  if (!operation) return { state: 'existing' };
  const lock = await database().connect();
  try {
    const { rows } = await lock.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 9018)) AS acquired', [operation.id]);
    if (!rows[0]?.acquired) return { state: 'pending', operationId: operation.id };
    const current = await lock.query<Provision>(
      'SELECT id,target_user_id,request_digest,state,keycloak_user_id FROM garden.identity_operations WHERE id=$1', [operation.id]);
    operation = current.rows[0];
    if (operation.state === 'committed') return { state: 'created', operationId: operation.id };
    const password = randomBytes(18).toString('base64url');
    const iam = await userManagement();
    const subject = await iam.provisionStudent(operation.target_user_id, username, name, password, operation.keycloak_user_id);
    await lock.query(`
      UPDATE garden.identity_operations SET keycloak_user_id=$2,state='keycloak_linked'
      WHERE id=$1
    `, [operation.id, subject]);
    const completed = operation;
    await tx(async connection => {
      await activeTeacher(connection, teacher);
      await ownedClass(connection, teacher, classId);
      const updated = await connection.query(`
        UPDATE garden.users SET oidc_subject=$2,status='active'
        WHERE id=$1 AND status='provisioning'
      `, [completed.target_user_id, subject]);
      if (updated.rowCount !== 1) throw new RosterError(409, 'STATE_CHANGED');
      await connection.query('INSERT INTO garden.students(id) VALUES($1)', [completed.target_user_id]);
      await connection.query(`
        INSERT INTO garden.memberships(class_id,student_id,state) VALUES ($1,$2,'active')
      `, [classId, completed.target_user_id]);
      await grantOpenAssignments(connection,teacher,classId,completed.target_user_id);
      await connection.query("UPDATE garden.identity_operations SET state='committed' WHERE id=$1", [completed.id]);
      await connection.query(`
        INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,identity_operation_id,outcome)
        VALUES ($1,'PROVISION','user',$2,$3,'success')
      `, [teacher, completed.target_user_id, completed.id]);
    }, lock);
    return { state: 'created', operationId: operation.id, temporaryPassword: password };
  } catch {
    // The reservation and any verified provider subject survive an RPC failure.
    // Reusing the same key reconciles the exact account before issuing credentials.
    return { state: 'pending', operationId: operation?.id };
  } finally {
    lock.release(true);
  }
}

type PreparedRow = CsvRow & { classId?: string };

async function setupCsv(teacher: string, source: string): Promise<PreparedRow[]> {
  let rows;
  try { rows = csvStudents(source); }
  catch { throw new RosterError(422, 'INVALID_CSV'); }
  const owned = await database().query<{ id: string; name: string; school_year: string }>(
    "SELECT id,name,school_year FROM garden.classes WHERE teacher_id=$1 AND state='active'", [teacher]);
  const classes = new Map(owned.rows.map(row => [JSON.stringify([row.name,row.school_year]), row.id]));
  return rows.map(row => {
    const classId = classes.get(JSON.stringify([row.className,row.year]));
    return { ...row, ...(classId ? { classId } : { error: row.error ?? 'CLASS_NOT_FOUND' }) };
  });
}

function rowKey(batch: string, line: number) {
  const digest = createHash('sha256').update(`${batch}:${line}`).digest('hex');
  return [digest.slice(0,8),digest.slice(8,12),digest.slice(12,16),digest.slice(16,20),digest.slice(20,32)].join('-');
}

export async function importCsv(teacher: string, source: string, batch: string, line?: number) {
  const rows = await setupCsv(teacher, source);
  const prepared = line === undefined ? rows : rows.filter(row => row.line === line);
  if (!prepared.length) throw new RosterError(404, 'ROW_NOT_FOUND');
  const results = [];
  for (const row of prepared) {
    if (row.error || !row.classId) {
      results.push({ ...row, state: 'invalid' });
    } else {
      try {
        const result = await provisionStudent(teacher, rowKey(batch, row.line),
          { name: row.name, username: row.username, classId: row.classId });
        results.push({ ...row, ...result });
      } catch {
        results.push({ ...row, state: 'pending' });
      }
    }
  }
  return { rows: results };
}

export async function previewCsv(teacher: string, source: string) {
  const rows = await setupCsv(teacher, source);
  const existing = await database().query<{ username: string }>(
    'SELECT username FROM garden.users WHERE username=ANY($1)', [rows.map(row => row.username)]);
  const usernames = new Set(existing.rows.map(row => row.username));
  return { rows: rows.map(row => ({ ...row, state: row.error ? 'invalid' : usernames.has(row.username) ? 'existing' : 'ready' })) };
}
