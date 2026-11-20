import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { migrate, migrationPool } from '../../infra/db/migrate.mjs';
import { findIdentity, findLatestSubmission, metadataReady } from '../../src/server/metadata.ts';

const migrations = ['001-metadata.sql', '002-tenant-constraints.sql', '003-auth-sessions.sql', '004-identity-lifecycle.sql', '005-enrollment.sql', '006-roster-lifecycle.sql', '007-rubric-versioning.sql', '008-drive-connection.sql', '009-private-assets.sql', '010-assignment-policy.sql', '011-submission-integrity.sql', '012-library-assets.sql'];
const uid = key => {
  const hash = createHash('md5').update(key).digest('hex');
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20)].join('-');
};

async function inScratchDatabase(run) {
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.APP_DB_HOST), 'Integration tests require a loopback database');
  // Identifiers cannot be parameters in CREATE DATABASE. This name contains only generated hex.
  const name = `lit_garden_test_${randomBytes(8).toString('hex')}`;
  const owner = migrationPool();
  let database;
  try {
    await owner.query(`CREATE DATABASE ${name}`);
    database = migrationPool(name);
    await run(database);
  } finally {
    try {
      if (database) {
        await database.end();
        await owner.query(`DROP DATABASE ${name}`);
      }
    } finally {
      await owner.end();
    }
  }
}

test('T07 migrates an empty PostgreSQL database and applies only once across parallel runners', async () => {
  await inScratchDatabase(async db => {
    await assert.rejects(() => metadataReady(db), { code: '42P01' });
    const applied = await Promise.all([migrate(db), migrate(db)]);
    assert.deepEqual(applied.flat().sort(), migrations);
    assert.equal(await metadataReady(db), true);
    assert.deepEqual(await migrate(db), []);

    const sql = (await readFile(new URL('../../docs/technical/validation/schema-scenarios.sql', import.meta.url), 'utf8'))
      .replace(/^\\set ON_ERROR_STOP on\r?\n/m, '').replace(/ROLLBACK;\s*$/, '');
    const client = await db.connect();
    try {
      const checks = await client.query(sql);
      assert.equal(checks.at(-1).rows[0].passed_sql_checks, '60');
      await client.query('RESET search_path');
      const student = await findIdentity(client, 'https://identity.test/realms/garden', 'student1');
      assert.deepEqual(student, {
        id: uid('student1'), username: 'student1', display_name: 'student1',
        role: 'student', status: 'active', auth_epoch: '0'
      });
      assert.equal(await findIdentity(client, 'https://wrong.test', 'student1'), null);
      const latest = await findLatestSubmission(client, student.id, uid('recipient1'));
      assert.equal(latest.id, uid('sub2'));
      assert.equal(latest.submission_no, 2);
      assert.equal(latest.current_publication_id, null);
      for (const actor of ['admin', 'student2', 'teacher2']) {
        assert.equal(await findLatestSubmission(client, uid(actor), uid('recipient1')), null);
      }

      const contentColumns = await client.query(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'garden'
          AND (data_type IN ('json','jsonb','xml')
            OR column_name ~ '(^|_)(body|content|markdown|payload|prompt_text|score|password|comment_text)(_|$)')
        ORDER BY table_name,column_name
      `);
      assert.deepEqual(contentColumns.rows, [{ table_name: 'rubric_templates', column_name: 'definition' }]);
      const checksAfterUpgrade = await client.query(`
        SELECT pg_temp.reject($q$INSERT INTO garden.users(oidc_issuer,oidc_subject,username,display_name,role)
          VALUES ('urn:test','new-subject','student1','Duplicate','student')$q$,
          '23505','username globally unique');
        SELECT pg_temp.reject($q$INSERT INTO garden.memberships(class_id,student_id,state)
          VALUES(pg_temp.uid('class1'),pg_temp.uid('student1'),'active')$q$,
          '23505','duplicate membership');
        SELECT pg_temp.reject($q$INSERT INTO garden.recipients(assignment_id,class_id,teacher_id,student_id)
          VALUES(pg_temp.uid('assignment1'),pg_temp.uid('class1'),pg_temp.uid('teacher1'),pg_temp.uid('student1'))$q$,
          '23505','duplicate recipient');
        SELECT pg_temp.reject($q$UPDATE garden.operations SET body='FIXTURE_DO_NOT_PERSIST'
          WHERE id=pg_temp.uid('op-draft')$q$,'42703','operation has no content column');
        SELECT count(*) AS passed_sql_checks FROM checks_passed;
      `);
      assert.equal(checksAfterUpgrade.at(-1).rows[0].passed_sql_checks, '64');
      const closedPolicy = await client.query(`SELECT
        garden.can_read_draft(pg_temp.uid('student1'),pg_temp.uid('student-stream')) AS read_draft,
        garden.can_write_recipient(pg_temp.uid('student1'),pg_temp.uid('recipient1')) AS write_draft,
        garden.can_review_submission(pg_temp.uid('teacher1'),pg_temp.uid('sub1')) AS review,
        garden.can_reply_submission(pg_temp.uid('teacher1'),pg_temp.uid('sub1')) AS teacher_reply,
        garden.can_reply_submission(pg_temp.uid('student1'),pg_temp.uid('sub1')) AS author_reply,
        garden.can_reply_submission(pg_temp.uid('student1'),pg_temp.uid('sub2')) AS unpublished_reply,
        garden.can_reply_submission(pg_temp.uid('student2'),pg_temp.uid('sub1')) AS peer_reply
      `);
      assert.deepEqual(closedPolicy.rows[0], {
        read_draft: true, write_draft: false, review: true, teacher_reply: true, author_reply: true,
        unpublished_reply: false, peer_reply: false
      });
      await client.query("UPDATE garden.classes SET state='archived' WHERE id=pg_temp.uid('class1')");
      const archivePolicy = await client.query(`SELECT
        garden.can_read_draft(pg_temp.uid('student1'),pg_temp.uid('student-stream')) AS read_draft,
        garden.can_review_submission(pg_temp.uid('teacher1'),pg_temp.uid('sub1')) AS review,
        garden.can_reply_submission(pg_temp.uid('student1'),pg_temp.uid('sub1')) AS author_reply
      `);
      assert.deepEqual(archivePolicy.rows[0], { read_draft: true, review: false, author_reply: false });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const retained = await db.query('SELECT count(*) AS count FROM garden.operations');
    assert.equal(retained.rows[0].count, '0');
  });
});

test('T07 upgrades a populated database atomically and rejects cross-teacher links', async () => {
  await inScratchDatabase(async db => {
    assert.deepEqual(await migrate(db, { through: migrations[0] }), [migrations[0]]);
    assert.equal(await metadataReady(db), false);
    const teacherA = uid('upgrade-a'), teacherB = uid('upgrade-b');
    const op = uid('upgrade-op'), object = uid('upgrade-object'), notification = uid('upgrade-notification');

    await db.query(`INSERT INTO garden.users(id,oidc_issuer,oidc_subject,username,display_name,role) VALUES
      ($1,'urn:fixture','a','fixture_a','Cô An','teacher'), ($2,'urn:fixture','b','fixture_b','Cô Mai','teacher')`, [teacherA, teacherB]);
    await db.query('INSERT INTO garden.teachers(id) VALUES ($1),($2)', [teacherA, teacherB]);
    await db.query(`INSERT INTO garden.operations(id,actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version)
      VALUES ($1,$2,$2,'library_delete','library',$1,$1,repeat('a',64),0)`, [op, teacherA]);
    await db.query(`INSERT INTO garden.drive_objects(id,teacher_id,operation_id,slot,drive_file_id,parent_drive_id,mime_type,expected_sha256,byte_size)
      VALUES ($1,$2,$3,'document','file-fixture','folder-fixture','text/markdown',repeat('b',64),6)`, [object, teacherA, op]);
    await db.query('INSERT INTO garden.library_delete_files(operation_id, object_id) VALUES ($1,$2)', [op, object]);
    await db.query(`INSERT INTO garden.notifications(id,user_id,teacher_id,event_operation_id,event_kind,target_kind,target_id)
      VALUES ($1,$2,$3,$4,'assigned','assignment',$4)`, [notification, teacherA, teacherB, op]);

    await assert.rejects(() => migrate(db), error => error.cause?.code === '23503');
    assert.equal(await metadataReady(db), false);
    const unaltered = await db.query('SELECT * FROM garden.library_delete_files WHERE operation_id=$1', [op]);
    assert.deepEqual(unaltered.rows, [{ operation_id: op, object_id: object, state: 'pending' }]);

    await db.query('UPDATE garden.notifications SET teacher_id=$1 WHERE id=$2', [teacherA, notification]);
    assert.deepEqual(await migrate(db), migrations.slice(1));
    assert.equal(await metadataReady(db), true);
    const upgraded = await db.query('SELECT * FROM garden.library_delete_files WHERE operation_id=$1', [op]);
    assert.deepEqual(upgraded.rows, [{ ...unaltered.rows[0], teacher_id: teacherA }]);
    await assert.rejects(() => db.query('UPDATE garden.notifications SET teacher_id=$1 WHERE id=$2',
      [teacherB, notification]), { code: '23503' });
    await assert.rejects(() => db.query('UPDATE garden.library_delete_files SET teacher_id=$1 WHERE operation_id=$2',
      [teacherB, op]), { code: '23503' });

    // A modified ledger row must not be accepted as a valid repeat execution.
    await db.query('UPDATE public.garden_schema_migrations SET sha256=repeat($1,64) WHERE name=$2', ['f', migrations[0]]);
    await assert.rejects(() => migrate(db), /migration history does not match/);
  });
});
