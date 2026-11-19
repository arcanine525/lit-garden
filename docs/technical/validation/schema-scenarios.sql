-- Run after metadata-reference.sql in the same disposable DB. All fixtures roll back.
\set ON_ERROR_STOP on
BEGIN;
SET search_path = garden, public;
CREATE TEMP TABLE checks_passed(label text);
CREATE FUNCTION pg_temp.uid(label text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(label)::uuid $$;
CREATE FUNCTION pg_temp.ok(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 INSERT INTO checks_passed VALUES(label);
END $$;
CREATE FUNCTION pg_temp.reject(statement text, expected_state text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
 END;
 IF actual_state IS DISTINCT FROM expected_state THEN
  RAISE EXCEPTION 'FAIL %: expected %, got %',label,expected_state,actual_state;
 END IF;
 INSERT INTO checks_passed VALUES(label);
END $$;
INSERT INTO users(id,oidc_issuer,oidc_subject,username,display_name,role)
 SELECT pg_temp.uid(x), 'https://identity.test/realms/garden', x, x, x, r
 FROM (VALUES ('admin','admin'),('teacher1','teacher'),('teacher2','teacher'),
 ('student1','student'),('student2','student'),('student3','student')) t(x,r);
INSERT INTO teachers(id) SELECT id FROM users WHERE role='teacher';
INSERT INTO students(id) SELECT id FROM users WHERE role='student';
INSERT INTO drive_connections(teacher_id,google_subject,parent_folder_id,app_folder_id,
 refresh_token_ciphertext,token_key_id,granted_scopes,state)
 SELECT id,username,'parent-'||username,'app-'||username,'\x00','fixture',ARRAY['drive.file'],'ready'
 FROM users WHERE role='teacher';
INSERT INTO classes(id,teacher_id,name,school_year,join_code_digest) VALUES
 (pg_temp.uid('class1'),pg_temp.uid('teacher1'),'Class 1','2026',repeat('1',64)),
 (pg_temp.uid('class2'),pg_temp.uid('teacher2'),'Class 2','2026',repeat('2',64));
INSERT INTO memberships(class_id,student_id,state) VALUES
 (pg_temp.uid('class1'),pg_temp.uid('student1'),'active'),
 (pg_temp.uid('class2'),pg_temp.uid('student1'),'active'),
 (pg_temp.uid('class1'),pg_temp.uid('student2'),'active'),
 (pg_temp.uid('class1'),pg_temp.uid('student3'),'active');
INSERT INTO rubric_templates(id,revision,label,definition,created_by)
 VALUES(pg_temp.uid('rubric'),1,'Fixture rubric','{"criteria":[]}',pg_temp.uid('admin'));

-- Distinct fixture operations/files, all terminal so they do not occupy the pending mutex.
INSERT INTO operations(id,actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,
 request_digest,expected_version,state)
 SELECT pg_temp.uid('op-'||x),pg_temp.uid('teacher1'),pg_temp.uid('teacher1'),
 'autosave','stream',pg_temp.uid(x),pg_temp.uid('key-'||x),repeat('a',64),0,'committed'
 FROM unnest(ARRAY['prompt','rubric-file','reference','draft','candidate','submission1','submission2','pub1','pub2','library','message']) x;
INSERT INTO operations(id,actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,
 request_digest,expected_version,state)
 VALUES(pg_temp.uid('op-foreign'),pg_temp.uid('teacher2'),pg_temp.uid('teacher2'),'autosave','stream',
 pg_temp.uid('foreign'),pg_temp.uid('key-foreign'),repeat('b',64),0,'committed');
INSERT INTO drive_objects(id,teacher_id,operation_id,slot,drive_file_id,parent_drive_id,mime_type,
 expected_sha256,byte_size,integrity,lifecycle)
 SELECT pg_temp.uid(x),pg_temp.uid('teacher1'),pg_temp.uid('op-'||x),'document',x,'app-teacher1',
 'text/markdown',repeat('a',64),100,'ok',CASE WHEN x='candidate' THEN 'candidate' ELSE 'referenced' END
 FROM unnest(ARRAY['prompt','rubric-file','reference','draft','candidate','submission1','submission2','pub1','pub2','library','message']) x;
INSERT INTO drive_objects(id,teacher_id,operation_id,slot,drive_file_id,parent_drive_id,mime_type,
 expected_sha256,byte_size,integrity,lifecycle)
 VALUES(pg_temp.uid('foreign'),pg_temp.uid('teacher2'),pg_temp.uid('op-foreign'),'document',
 'foreign','app-teacher2','text/markdown',repeat('b',64),100,'ok','referenced');
INSERT INTO document_streams(id,teacher_id,kind) VALUES
 (pg_temp.uid('assignment-stream1'),pg_temp.uid('teacher1'),'assignment'),
 (pg_temp.uid('assignment-stream2'),pg_temp.uid('teacher2'),'assignment'),
 (pg_temp.uid('student-stream'),pg_temp.uid('teacher1'),'student'),
 (pg_temp.uid('library-stream'),pg_temp.uid('teacher1'),'library');
INSERT INTO assignments(id,class_id,teacher_id,draft_stream_id,rubric_template_id,rubric_template_revision)
 VALUES(pg_temp.uid('assignment1'),pg_temp.uid('class1'),pg_temp.uid('teacher1'),
 pg_temp.uid('assignment-stream1'),pg_temp.uid('rubric'),1),
 (pg_temp.uid('assignment2'),pg_temp.uid('class2'),pg_temp.uid('teacher2'),
 pg_temp.uid('assignment-stream2'),pg_temp.uid('rubric'),1);
SELECT pg_temp.ok(NOT can_read_assignment(pg_temp.uid('student1'),pg_temp.uid('assignment1')),'draft assignment hidden');
UPDATE assignments SET state='published',published_at=now(),accepting=true,
 prompt_object_id=pg_temp.uid('prompt'),rubric_object_id=pg_temp.uid('rubric-file'),
 reference_object_id=pg_temp.uid('reference'),due_at='2026-12-01T00:00:00Z'
 WHERE id=pg_temp.uid('assignment1');
SELECT pg_temp.ok(NOT can_read_assignment(pg_temp.uid('student1'),pg_temp.uid('assignment1')),'membership without recipient denied');
INSERT INTO recipients(id,assignment_id,class_id,teacher_id,student_id)
 VALUES(pg_temp.uid('recipient1'),pg_temp.uid('assignment1'),pg_temp.uid('class1'),pg_temp.uid('teacher1'),pg_temp.uid('student1'));
SELECT pg_temp.ok(can_read_assignment(pg_temp.uid('student1'),pg_temp.uid('assignment1')),'assigned student reads prompt');
SELECT pg_temp.ok(NOT can_read_reference(pg_temp.uid('student1'),pg_temp.uid('assignment1')),'private reference hidden');
SELECT pg_temp.ok(NOT can_read_assignment(pg_temp.uid('admin'),pg_temp.uid('assignment1')),'admin denied content');
SELECT pg_temp.ok(NOT can_read_assignment(pg_temp.uid('teacher2'),pg_temp.uid('assignment1')),'other teacher denied');
SELECT pg_temp.ok(can_write_recipient(pg_temp.uid('student1'),pg_temp.uid('recipient1')),'active writer allowed');
UPDATE classes SET state='archived' WHERE id=pg_temp.uid('class1');
SELECT pg_temp.ok(NOT can_write_recipient(pg_temp.uid('student1'),pg_temp.uid('recipient1')),'archived denies write');
SELECT pg_temp.ok(can_read_assignment(pg_temp.uid('student1'),pg_temp.uid('assignment1')),'archived retains read');
UPDATE classes SET state='active' WHERE id=pg_temp.uid('class1');
UPDATE users SET status='suspended' WHERE id=pg_temp.uid('teacher1');
SELECT pg_temp.ok(NOT can_write_recipient(pg_temp.uid('student1'),pg_temp.uid('recipient1')),'suspended owner denies write');
SELECT pg_temp.ok(can_read_assignment(pg_temp.uid('student1'),pg_temp.uid('assignment1')),'suspended owner retains student read');
SELECT pg_temp.ok(NOT can_read_assignment(pg_temp.uid('teacher1'),pg_temp.uid('assignment1')),'suspended teacher denied own request');
UPDATE users SET status='active' WHERE id=pg_temp.uid('teacher1');
INSERT INTO submissions(id,recipient_id,teacher_id,submission_no,operation_id,object_id,submitted_at) VALUES
 (pg_temp.uid('sub1'),pg_temp.uid('recipient1'),pg_temp.uid('teacher1'),1,pg_temp.uid('op-submission1'),pg_temp.uid('submission1'),now()),
 (pg_temp.uid('sub2'),pg_temp.uid('recipient1'),pg_temp.uid('teacher1'),2,pg_temp.uid('op-submission2'),pg_temp.uid('submission2'),now());
SELECT pg_temp.ok(can_read_submission(pg_temp.uid('student1'),pg_temp.uid('sub1')),'student reads own submission');
SELECT pg_temp.ok(NOT can_read_submission(pg_temp.uid('student2'),pg_temp.uid('sub1')),'same class other student denied');
SELECT pg_temp.ok(NOT can_read_submission(pg_temp.uid('teacher2'),pg_temp.uid('sub1')),'other teacher submission denied');
SELECT pg_temp.ok(NOT can_read_submission(pg_temp.uid('admin'),pg_temp.uid('sub1')),'admin export source denied');
UPDATE memberships SET state='removed',removed_at=now() WHERE class_id=pg_temp.uid('class1') AND student_id=pg_temp.uid('student1');
SELECT pg_temp.ok(can_read_assignment(pg_temp.uid('student1'),pg_temp.uid('assignment1')),'removed keeps submitted prompt');
SELECT pg_temp.ok(can_read_submission(pg_temp.uid('student1'),pg_temp.uid('sub1')),'removed keeps own submission');
SELECT pg_temp.ok(NOT can_write_recipient(pg_temp.uid('student1'),pg_temp.uid('recipient1')),'removed denies write');
UPDATE memberships SET state='active',removed_at=NULL WHERE class_id=pg_temp.uid('class1') AND student_id=pg_temp.uid('student1');
SELECT pg_temp.ok(can_write_recipient(pg_temp.uid('student1'),pg_temp.uid('recipient1')),'readmit restores open write');

SELECT pg_temp.reject($q$UPDATE assignments SET prompt_object_id=pg_temp.uid('draft') WHERE id=pg_temp.uid('assignment1')$q$,'23514','published prompt immutable');
SELECT pg_temp.reject($q$UPDATE assignments SET due_at='2026-11-30' WHERE id=pg_temp.uid('assignment1')$q$,'23514','shorter deadline rejected');
UPDATE assignments SET due_at='2026-12-02' WHERE id=pg_temp.uid('assignment1');
SELECT pg_temp.ok((SELECT due_at='2026-12-02' FROM assignments WHERE id=pg_temp.uid('assignment1')),'deadline extension allowed');
UPDATE assignments SET accepting=false,reference_public_at=now() WHERE id=pg_temp.uid('assignment1');
SELECT pg_temp.ok(can_read_reference(pg_temp.uid('student1'),pg_temp.uid('assignment1')),'assigned student public reference');
SELECT pg_temp.ok(NOT can_read_reference(pg_temp.uid('student3'),pg_temp.uid('assignment1')),'F42 late member public reference denied');
SELECT pg_temp.reject($q$UPDATE assignments SET accepting=true WHERE id=pg_temp.uid('assignment1')$q$,'23514','public reference cannot reopen');
SELECT pg_temp.reject($q$UPDATE assignments SET reference_public_at=NULL WHERE id=pg_temp.uid('assignment1')$q$,'23514','public reference cannot revert');

INSERT INTO review_publications(id,submission_id,teacher_id,revision,operation_id,object_id)
 VALUES(pg_temp.uid('publication1'),pg_temp.uid('sub1'),pg_temp.uid('teacher1'),1,pg_temp.uid('op-pub1'),pg_temp.uid('pub1'));
UPDATE submissions SET current_publication_id=pg_temp.uid('publication1') WHERE id=pg_temp.uid('sub1');
SELECT pg_temp.ok((SELECT id=pg_temp.uid('sub2') AND current_publication_id IS NULL FROM latest_submission_metadata WHERE recipient_id=pg_temp.uid('recipient1')),'latest submission pending despite old returned');
SELECT pg_temp.reject($q$UPDATE submissions SET current_publication_id=pg_temp.uid('publication1') WHERE id=pg_temp.uid('sub2')$q$,'23503','publication bound to submission');
SELECT pg_temp.reject($q$UPDATE review_publications SET revision=2 WHERE id=pg_temp.uid('publication1')$q$,'23514','publication append-only');
SELECT pg_temp.reject($q$INSERT INTO submissions(id,recipient_id,teacher_id,submission_no,operation_id,object_id,submitted_at) VALUES(pg_temp.uid('duplicate'),pg_temp.uid('recipient1'),pg_temp.uid('teacher1'),1,pg_temp.uid('op-draft'),pg_temp.uid('draft'),now())$q$,'23505','duplicate submission ordinal rejected');
SELECT pg_temp.reject($q$UPDATE assignments SET prompt_object_id=pg_temp.uid('prompt') WHERE id=pg_temp.uid('assignment2')$q$,'23503','cross-owner object FK rejected');
-- assignment2 has teacher2; use an explicit cross-owner stream FK as a second boundary.
SELECT pg_temp.reject($q$UPDATE assignments SET draft_stream_id=pg_temp.uid('student-stream') WHERE id=pg_temp.uid('assignment2')$q$,'23503','cross-owner or kind stream rejected');

INSERT INTO library_items(id,teacher_id,draft_stream_id,current_object_id,state)
 VALUES(pg_temp.uid('item'),pg_temp.uid('teacher1'),pg_temp.uid('library-stream'),pg_temp.uid('library'),'active');
INSERT INTO library_shares(item_id,class_id,teacher_id) VALUES(pg_temp.uid('item'),pg_temp.uid('class1'),pg_temp.uid('teacher1'));
SELECT pg_temp.ok(can_read_library(pg_temp.uid('student1'),pg_temp.uid('item')),'shared library allowed');
UPDATE memberships SET state='removed',removed_at=now() WHERE class_id=pg_temp.uid('class1') AND student_id=pg_temp.uid('student1');
INSERT INTO library_favorites(item_id,user_id) VALUES(pg_temp.uid('item'),pg_temp.uid('student1'));
SELECT pg_temp.ok(NOT can_read_library(pg_temp.uid('student1'),pg_temp.uid('item')),'favorite cannot restore removed access');
UPDATE library_items SET state='deleting' WHERE id=pg_temp.uid('item');
SELECT pg_temp.ok(NOT can_read_library(pg_temp.uid('student2'),pg_temp.uid('item')),'partial deletion hides item');
SELECT pg_temp.reject($q$INSERT INTO library_shares(item_id,class_id,teacher_id) VALUES(pg_temp.uid('item'),pg_temp.uid('class2'),pg_temp.uid('teacher1'))$q$,'23503','cross-teacher library share rejected');

UPDATE document_streams SET head_object_id=pg_temp.uid('draft'),version=2,
 lease_actor_id=pg_temp.uid('student1'),lease_session_id=pg_temp.uid('session-new'),lease_epoch=8,
 lease_until=clock_timestamp()+interval '60 seconds' WHERE id=pg_temp.uid('student-stream');
SELECT pg_temp.reject($q$SELECT commit_draft_head(pg_temp.uid('student-stream'),pg_temp.uid('student1'),pg_temp.uid('session-old'),7,2,pg_temp.uid('candidate'))$q$,'40001','old in-flight candidate cannot replace head after takeover');
SELECT pg_temp.reject($q$SELECT commit_draft_head(pg_temp.uid('student-stream'),pg_temp.uid('student1'),pg_temp.uid('session-new'),8,1,pg_temp.uid('candidate'))$q$,'40001','stale base version rejected');
SELECT pg_temp.ok(commit_draft_head(pg_temp.uid('student-stream'),pg_temp.uid('student1'),pg_temp.uid('session-new'),8,2,pg_temp.uid('candidate'))=3,'current writer CAS succeeds');
SELECT pg_temp.reject($q$SELECT commit_draft_head(pg_temp.uid('student-stream'),pg_temp.uid('student1'),pg_temp.uid('session-new'),8,2,pg_temp.uid('candidate'))$q$,'40001','repeated CAS cannot advance twice');
UPDATE document_streams SET lease_until=clock_timestamp()-interval '1 second' WHERE id=pg_temp.uid('student-stream');
SELECT pg_temp.reject($q$SELECT commit_draft_head(pg_temp.uid('student-stream'),pg_temp.uid('student1'),pg_temp.uid('session-new'),8,3,pg_temp.uid('candidate'))$q$,'40001','expired lease rejected');
SELECT pg_temp.reject($q$UPDATE drive_objects SET expected_sha256=repeat('c',64) WHERE id=pg_temp.uid('submission1')$q$,'23514','cannot rebase immutable hash');
SELECT pg_temp.reject($q$UPDATE submissions SET object_id=pg_temp.uid('draft') WHERE id=pg_temp.uid('sub1')$q$,'23514','submission source immutable');
INSERT INTO review_comments(id,submission_id) VALUES(pg_temp.uid('comment1'),pg_temp.uid('sub1'));
INSERT INTO publication_comments(publication_id,submission_id,comment_id,comment_digest)
 VALUES(pg_temp.uid('publication1'),pg_temp.uid('sub1'),pg_temp.uid('comment1'),repeat('d',64));
INSERT INTO conversation_messages(id,comment_id,submission_id,teacher_id,author_id,operation_id,object_id,message_no)
 VALUES(pg_temp.uid('message1'),pg_temp.uid('comment1'),pg_temp.uid('sub1'),pg_temp.uid('teacher1'),
 pg_temp.uid('student1'),pg_temp.uid('op-message'),pg_temp.uid('message'),1);
SELECT pg_temp.reject($q$UPDATE conversation_messages SET message_no=2 WHERE id=pg_temp.uid('message1')$q$,'23514','sent message immutable');
SELECT pg_temp.reject($q$DELETE FROM conversation_messages WHERE id=pg_temp.uid('message1')$q$,'23514','sent message cannot delete');
INSERT INTO operations(id,actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version)
 VALUES(pg_temp.uid('pending'),pg_temp.uid('student1'),pg_temp.uid('teacher1'),'autosave','stream',pg_temp.uid('student-stream'),pg_temp.uid('pending-key'),repeat('e',64),3);
SELECT pg_temp.reject($q$INSERT INTO operations(actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version) VALUES(pg_temp.uid('student1'),pg_temp.uid('teacher1'),'autosave','stream',pg_temp.uid('other-stream'),pg_temp.uid('pending-key'),repeat('e',64),3)$q$,'23505','idempotency key cannot reserve twice');
SELECT pg_temp.reject($q$INSERT INTO operations(actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version) VALUES(pg_temp.uid('student1'),pg_temp.uid('teacher1'),'autosave','stream',pg_temp.uid('student-stream'),pg_temp.uid('other-key'),repeat('e',64),3)$q$,'23505','one unfinished operation per target');
INSERT INTO notifications(user_id,teacher_id,event_operation_id,event_kind,target_kind,target_id)
 VALUES(pg_temp.uid('student1'),pg_temp.uid('teacher1'),pg_temp.uid('op-pub1'),'returned','submission',pg_temp.uid('sub1'));
SELECT pg_temp.reject($q$INSERT INTO notifications(user_id,teacher_id,event_operation_id,event_kind,target_kind,target_id) VALUES(pg_temp.uid('student1'),pg_temp.uid('teacher1'),pg_temp.uid('op-pub1'),'returned','submission',pg_temp.uid('sub1'))$q$,'23505','notification event dedup');
-- Shared account remains usable in teacher2's space after teacher1 suspension.
UPDATE assignments SET state='published',published_at=now(),accepting=true,
 prompt_object_id=pg_temp.uid('foreign'),rubric_object_id=pg_temp.uid('foreign')
 WHERE id=pg_temp.uid('assignment2');
INSERT INTO recipients(id,assignment_id,class_id,teacher_id,student_id)
 VALUES(pg_temp.uid('recipient2'),pg_temp.uid('assignment2'),pg_temp.uid('class2'),pg_temp.uid('teacher2'),pg_temp.uid('student1'));
UPDATE users SET status='suspended' WHERE id=pg_temp.uid('teacher1');
SELECT pg_temp.ok(can_write_recipient(pg_temp.uid('student1'),pg_temp.uid('recipient2')),'other teacher space remains writable with shared identity');
SELECT pg_temp.ok((SELECT count(*)=1 FROM users WHERE username='student1'),'shared identity not duplicated per teacher');
UPDATE users SET status='active' WHERE id=pg_temp.uid('teacher1');
INSERT INTO review_publications(id,submission_id,teacher_id,revision,operation_id,object_id)
 VALUES(pg_temp.uid('publication2'),pg_temp.uid('sub1'),pg_temp.uid('teacher1'),2,pg_temp.uid('op-pub2'),pg_temp.uid('pub2'));
UPDATE submissions SET current_publication_id=pg_temp.uid('publication2') WHERE id=pg_temp.uid('sub1');
SELECT pg_temp.ok(readable_review_object(pg_temp.uid('student1'),pg_temp.uid('sub1'))=pg_temp.uid('pub2'),'student current publication only');
SELECT pg_temp.ok(readable_review_object(pg_temp.uid('student1'),pg_temp.uid('sub1'),pg_temp.uid('publication1')) IS NULL,'student known superseded publication denied');
SELECT pg_temp.ok(readable_review_object(pg_temp.uid('teacher1'),pg_temp.uid('sub1'),pg_temp.uid('publication1'))=pg_temp.uid('pub1'),'teacher publication history allowed');
SELECT pg_temp.ok(readable_review_object(pg_temp.uid('admin'),pg_temp.uid('sub1')) IS NULL,'admin review object denied');
SELECT pg_temp.ok(readable_review_object(pg_temp.uid('student2'),pg_temp.uid('sub1')) IS NULL,'other student current review denied');
INSERT INTO student_drafts(recipient_id,teacher_id,stream_id)
 VALUES(pg_temp.uid('recipient1'),pg_temp.uid('teacher1'),pg_temp.uid('student-stream'));
SELECT pg_temp.ok(NOT can_read_draft(pg_temp.uid('teacher1'),pg_temp.uid('student-stream')),'teacher cannot open student draft F26');
SELECT pg_temp.ok(NOT can_read_draft(pg_temp.uid('student1'),pg_temp.uid('student-stream')),'removed student cannot open old draft');
UPDATE memberships SET state='active',removed_at=NULL WHERE class_id=pg_temp.uid('class1') AND student_id=pg_temp.uid('student1');
SELECT pg_temp.ok(can_read_draft(pg_temp.uid('student1'),pg_temp.uid('student-stream')),'readmitted student reads own closed draft');
SELECT pg_temp.ok(NOT can_read_draft(pg_temp.uid('admin'),pg_temp.uid('student-stream')),'admin cannot open draft');
SELECT count(*) AS passed_sql_checks FROM checks_passed;
ROLLBACK;
