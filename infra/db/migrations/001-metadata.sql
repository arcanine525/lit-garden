-- Initial metadata schema derived from docs/technical/metadata-reference.sql.
CREATE SCHEMA garden;
SET LOCAL search_path = garden, pg_catalog;
CREATE DOMAIN sha256 AS text CHECK (VALUE ~ '^[0-9a-f]{64}$');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_issuer text NOT NULL,
  oidc_subject text NOT NULL,
  username varchar(30) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,30}$'),
  display_name varchar(100) NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','teacher','student')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','provisioning')),
  auth_epoch bigint NOT NULL DEFAULT 0 CHECK (auth_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oidc_issuer, oidc_subject), UNIQUE (id, role)
);
CREATE TABLE teachers (
  id uuid PRIMARY KEY,
  role text NOT NULL DEFAULT 'teacher' CHECK (role = 'teacher'),
  FOREIGN KEY (id, role) REFERENCES users(id, role)
);
CREATE TABLE students (
  id uuid PRIMARY KEY,
  role text NOT NULL DEFAULT 'student' CHECK (role = 'student'),
  FOREIGN KEY (id, role) REFERENCES users(id, role)
);
CREATE TABLE drive_connections (
  teacher_id uuid PRIMARY KEY REFERENCES teachers,
  google_subject text NOT NULL,
  parent_folder_id text NOT NULL,
  app_folder_id text NOT NULL,
  refresh_token_ciphertext bytea NOT NULL,
  token_key_id text NOT NULL,
  granted_scopes text[] NOT NULL,
  state text NOT NULL CHECK (state IN ('ready','reconnect_required','unavailable')),
  data_started_at timestamptz,
  checked_at timestamptz
);
CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers,
  name varchar(100) NOT NULL,
  school_year varchar(30) NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  join_code_digest sha256 NOT NULL UNIQUE,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  UNIQUE (id, teacher_id)
);
CREATE TABLE memberships (
  class_id uuid NOT NULL REFERENCES classes,
  student_id uuid NOT NULL REFERENCES students,
  state text NOT NULL CHECK (state IN ('active','removed')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (class_id, student_id),
  CHECK ((state = 'removed') = (removed_at IS NOT NULL))
);
CREATE TABLE enrollment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes,
  student_id uuid NOT NULL REFERENCES students,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES teachers,
  decided_at timestamptz,
  CHECK ((state = 'pending') = (decided_at IS NULL)),
  CHECK ((decided_at IS NULL) = (decided_by IS NULL))
);
CREATE UNIQUE INDEX one_pending_enrollment ON enrollment_requests(class_id,student_id) WHERE state='pending';
CREATE INDEX membership_student ON memberships(student_id,state,class_id);

-- IAM saga metadata is separate from Drive operations; no credential or password hash.
-- A provisioning user initially has oidc_subject='provisioning:<app UUID>', never authenticatable.
CREATE TABLE identity_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users,
  target_user_id uuid NOT NULL REFERENCES users,
  kind text NOT NULL CHECK (kind IN ('create_teacher','create_student','reset_student','suspend_teacher','resume_teacher')),
  idempotency_key uuid NOT NULL,
  request_digest sha256 NOT NULL,
  intended_class_id uuid REFERENCES classes,
  keycloak_user_id text,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','keycloak_linked','credentials_pending','unknown','needs_admin','committed','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id,idempotency_key)
);

-- Only business-content exception: admin maintained reusable rubric configuration.
CREATE TABLE rubric_templates (
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  label varchar(150) NOT NULL,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object'),
  retired boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, revision)
);

-- Generic operation targets are validated against the canonical resource in service code.
-- Never put user text, scores, URL input, Google error bodies or arbitrary JSON here.
CREATE TABLE operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users,
  teacher_id uuid NOT NULL REFERENCES teachers,
  kind text NOT NULL CHECK (kind IN ('autosave','submit','assign','extend_deadline','publish_review','reply','library_save','library_delete','asset_upload')),
  target_kind text NOT NULL CHECK (target_kind IN ('stream','recipient','submission','comment','library','assignment')),
  target_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_digest sha256 NOT NULL,
  expected_version bigint NOT NULL CHECK (expected_version >= 0),
  lease_epoch bigint,
  client_session_id uuid,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','writing','unknown','needs_client','drive_verified','committed','rejected','cleanup')),
  error_code text CHECK (error_code IN ('TIMEOUT','RATE_LIMIT','QUOTA','AUTH','FORBIDDEN','NOT_FOUND','INTEGRITY','STALE','POLICY','INVALID')),
  result_id uuid,
  retry_after timestamptz,
  worker_epoch bigint NOT NULL DEFAULT 0,
  worker_until timestamptz,
  UNIQUE (actor_id, idempotency_key), UNIQUE (id, teacher_id)
);
CREATE UNIQUE INDEX one_unfinished_mutation ON operations(teacher_id,target_kind,target_id)
  WHERE state IN ('reserved','writing','unknown','needs_client','drive_verified');
CREATE INDEX reconcile_due ON operations(state,retry_after) WHERE state NOT IN ('committed','rejected','cleanup');

CREATE TABLE drive_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers,
  operation_id uuid NOT NULL,
  slot text NOT NULL CHECK (slot IN ('document','prompt','reference','rubric','asset','message')),
  slot_index integer NOT NULL DEFAULT 0 CHECK (slot_index >= 0),
  drive_file_id text NOT NULL UNIQUE,
  parent_drive_id text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('text/markdown','text/plain','application/pdf','image/png','image/jpeg','image/webp')),
  expected_sha256 sha256 NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  verified_drive_version text,
  integrity text NOT NULL DEFAULT 'unverified' CHECK (integrity IN ('unverified','ok','conflict','missing','unavailable')),
  checked_at timestamptz,
  lifecycle text NOT NULL DEFAULT 'candidate' CHECK (lifecycle IN ('candidate','referenced','orphan','trash_pending','trashed')),
  FOREIGN KEY (operation_id,teacher_id) REFERENCES operations(id,teacher_id),
  UNIQUE (operation_id,slot,slot_index), UNIQUE (id,teacher_id)
);

-- Head pointers identify the logical draft; physical files are write-once candidates.
CREATE TABLE document_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers,
  kind text NOT NULL CHECK (kind IN ('assignment','student','review','library')),
  head_object_id uuid,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  lease_actor_id uuid REFERENCES users,
  lease_session_id uuid,
  lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  lease_until timestamptz,
  FOREIGN KEY (head_object_id,teacher_id) REFERENCES drive_objects(id,teacher_id),
  CHECK ((lease_actor_id IS NULL AND lease_session_id IS NULL AND lease_until IS NULL)
    OR (lease_actor_id IS NOT NULL AND lease_session_id IS NOT NULL AND lease_until IS NOT NULL)),
  UNIQUE (id,teacher_id), UNIQUE (id,teacher_id,kind)
);
CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  draft_stream_id uuid NOT NULL UNIQUE,
  draft_kind text NOT NULL DEFAULT 'assignment' CHECK (draft_kind='assignment'),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published')),
  accepting boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  prompt_object_id uuid,
  reference_object_id uuid,
  rubric_object_id uuid,
  rubric_template_id uuid NOT NULL,
  rubric_template_revision integer NOT NULL,
  due_at timestamptz,
  reference_public_at timestamptz,
  version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (class_id,teacher_id) REFERENCES classes(id,teacher_id),
  FOREIGN KEY (draft_stream_id,teacher_id,draft_kind) REFERENCES document_streams(id,teacher_id,kind),
  FOREIGN KEY (prompt_object_id,teacher_id) REFERENCES drive_objects(id,teacher_id),
  FOREIGN KEY (reference_object_id,teacher_id) REFERENCES drive_objects(id,teacher_id),
  FOREIGN KEY (rubric_object_id,teacher_id) REFERENCES drive_objects(id,teacher_id),
  FOREIGN KEY (rubric_template_id,rubric_template_revision) REFERENCES rubric_templates(id,revision),
  CHECK ((state='published') = (published_at IS NOT NULL)),
  CHECK (state='published' OR (NOT accepting AND reference_public_at IS NULL)),
  CHECK (state='draft' OR (prompt_object_id IS NOT NULL AND rubric_object_id IS NOT NULL)),
  CHECK (reference_public_at IS NULL OR (NOT accepting AND reference_object_id IS NOT NULL)),
  UNIQUE (id,class_id,teacher_id), UNIQUE (id,teacher_id)
);
CREATE TABLE assignment_deadlines (
  assignment_id uuid NOT NULL REFERENCES assignments,
  revision integer NOT NULL CHECK (revision > 0),
  old_due_at timestamptz,
  new_due_at timestamptz,
  changed_by uuid NOT NULL REFERENCES teachers,
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id,revision),
  CHECK (old_due_at IS NOT NULL AND (new_due_at IS NULL OR new_due_at > old_due_at))
);
CREATE TABLE recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  class_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  student_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  next_submission_no integer NOT NULL DEFAULT 1 CHECK (next_submission_no > 0),
  FOREIGN KEY (assignment_id,class_id,teacher_id) REFERENCES assignments(id,class_id,teacher_id),
  FOREIGN KEY (class_id,student_id) REFERENCES memberships(class_id,student_id),
  UNIQUE (assignment_id,student_id), UNIQUE (id,teacher_id)
);
CREATE TABLE student_drafts (
  recipient_id uuid PRIMARY KEY,
  teacher_id uuid NOT NULL,
  stream_id uuid NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'student' CHECK (kind='student'),
  FOREIGN KEY (recipient_id,teacher_id) REFERENCES recipients(id,teacher_id),
  FOREIGN KEY (stream_id,teacher_id,kind) REFERENCES document_streams(id,teacher_id,kind)
);
CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  submission_no integer NOT NULL CHECK (submission_no > 0),
  operation_id uuid NOT NULL UNIQUE,
  object_id uuid NOT NULL UNIQUE,
  submitted_at timestamptz NOT NULL,
  current_publication_id uuid,
  FOREIGN KEY (recipient_id,teacher_id) REFERENCES recipients(id,teacher_id),
  FOREIGN KEY (operation_id,teacher_id) REFERENCES operations(id,teacher_id),
  FOREIGN KEY (object_id,teacher_id) REFERENCES drive_objects(id,teacher_id),
  UNIQUE (recipient_id,submission_no), UNIQUE (id,teacher_id)
);
CREATE TABLE review_drafts (
  submission_id uuid PRIMARY KEY,
  teacher_id uuid NOT NULL,
  stream_id uuid NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'review' CHECK (kind='review'),
  based_on_publication_id uuid,
  FOREIGN KEY (submission_id,teacher_id) REFERENCES submissions(id,teacher_id),
  FOREIGN KEY (stream_id,teacher_id,kind) REFERENCES document_streams(id,teacher_id,kind)
);
CREATE TABLE review_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  operation_id uuid NOT NULL UNIQUE,
  object_id uuid NOT NULL UNIQUE,
  published_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (submission_id,teacher_id) REFERENCES submissions(id,teacher_id),
  FOREIGN KEY (operation_id,teacher_id) REFERENCES operations(id,teacher_id),
  FOREIGN KEY (object_id,teacher_id) REFERENCES drive_objects(id,teacher_id),
  UNIQUE (submission_id,revision), UNIQUE (id,submission_id)
);
ALTER TABLE submissions ADD FOREIGN KEY (current_publication_id,id) REFERENCES review_publications(id,submission_id);
ALTER TABLE review_drafts ADD FOREIGN KEY (based_on_publication_id,submission_id) REFERENCES review_publications(id,submission_id);

-- Fingerprints cover comment body AND anchor. No quoted selection or comment text.
CREATE TABLE review_comments (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES submissions,
  frozen_digest sha256,
  pending_reply_operation uuid REFERENCES operations,
  UNIQUE (id,submission_id)
);
CREATE TABLE publication_comments (
  publication_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  comment_id uuid NOT NULL,
  comment_digest sha256 NOT NULL,
  PRIMARY KEY (publication_id,comment_id),
  FOREIGN KEY (publication_id,submission_id) REFERENCES review_publications(id,submission_id),
  FOREIGN KEY (comment_id,submission_id) REFERENCES review_comments(id,submission_id)
);
CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users,
  operation_id uuid NOT NULL UNIQUE,
  object_id uuid NOT NULL UNIQUE,
  message_no integer NOT NULL CHECK (message_no > 0),
  sent_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (comment_id,submission_id) REFERENCES review_comments(id,submission_id),
  FOREIGN KEY (submission_id,teacher_id) REFERENCES submissions(id,teacher_id),
  FOREIGN KEY (operation_id,teacher_id) REFERENCES operations(id,teacher_id),
  FOREIGN KEY (object_id,teacher_id) REFERENCES drive_objects(id,teacher_id),
  UNIQUE (comment_id,message_no)
);

CREATE TABLE library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers,
  draft_stream_id uuid NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'library' CHECK (kind='library'),
  current_object_id uuid,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','deleting','deleted')),
  version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (draft_stream_id,teacher_id,kind) REFERENCES document_streams(id,teacher_id,kind),
  FOREIGN KEY (current_object_id,teacher_id) REFERENCES drive_objects(id,teacher_id),
  CHECK (state <> 'active' OR current_object_id IS NOT NULL),
  UNIQUE (id,teacher_id)
);
CREATE TABLE library_shares (
  item_id uuid NOT NULL,
  class_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  PRIMARY KEY (item_id,class_id),
  FOREIGN KEY (item_id,teacher_id) REFERENCES library_items(id,teacher_id),
  FOREIGN KEY (class_id,teacher_id) REFERENCES classes(id,teacher_id)
);
CREATE TABLE library_favorites (
  item_id uuid NOT NULL REFERENCES library_items,
  user_id uuid NOT NULL REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id,user_id)
);
CREATE TABLE library_featured (
  class_id uuid NOT NULL,
  item_id uuid NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 2),
  PRIMARY KEY (class_id,slot),
  FOREIGN KEY (item_id,class_id) REFERENCES library_shares(item_id,class_id)
);
CREATE TABLE library_delete_files (
  operation_id uuid NOT NULL REFERENCES operations,
  object_id uuid NOT NULL REFERENCES drive_objects,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','unknown','trashed','inaccessible')),
  PRIMARY KEY (operation_id,object_id)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users,
  teacher_id uuid NOT NULL REFERENCES teachers,
  event_operation_id uuid NOT NULL REFERENCES operations,
  event_kind text NOT NULL CHECK (event_kind IN ('assigned','returned','reply','deadline_extended')),
  target_kind text NOT NULL CHECK (target_kind IN ('assignment','submission','comment')),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (user_id,event_operation_id,event_kind,target_id)
);
CREATE INDEX notifications_unread ON notifications(user_id,created_at DESC) WHERE read_at IS NULL;
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users,
  action_code text NOT NULL CHECK (action_code IN ('PROVISION','RESET','SUSPEND','RESUME','ENROLL','REMOVE','RESTORE','ARCHIVE','UNARCHIVE','DRIVE_CONNECT','LEASE_TAKEOVER','INTEGRITY','DEADLINE','OP_COMMIT','OP_REJECT','RUBRIC')),
  target_kind text NOT NULL,
  target_id uuid NOT NULL,
  operation_id uuid REFERENCES operations,
  outcome text NOT NULL CHECK (outcome IN ('requested','success','failure','unknown')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- These SQL guards demonstrate temporal rules; authorization is still required in services.
CREATE FUNCTION guard_assignment_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, garden AS $$
BEGIN
  IF OLD.state='published' THEN
    IF NEW.state <> OLD.state OR
      ROW(NEW.class_id,NEW.teacher_id,NEW.prompt_object_id,NEW.reference_object_id,NEW.rubric_object_id,
          NEW.rubric_template_id,NEW.rubric_template_revision,NEW.published_at)
      IS DISTINCT FROM
      ROW(OLD.class_id,OLD.teacher_id,OLD.prompt_object_id,OLD.reference_object_id,OLD.rubric_object_id,
          OLD.rubric_template_id,OLD.rubric_template_revision,OLD.published_at)
    THEN RAISE EXCEPTION 'published assignment content is immutable' USING ERRCODE='23514'; END IF;
    IF (OLD.due_at IS NULL AND NEW.due_at IS NOT NULL) OR NEW.due_at < OLD.due_at
    THEN RAISE EXCEPTION 'deadline cannot be shortened' USING ERRCODE='23514'; END IF;
  END IF;
  IF OLD.reference_public_at IS NOT NULL AND NEW.reference_public_at IS DISTINCT FROM OLD.reference_public_at
  THEN RAISE EXCEPTION 'reference publication is permanent' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignment_update_guard BEFORE UPDATE ON assignments FOR EACH ROW EXECUTE FUNCTION guard_assignment_update();
CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, garden AS $$
BEGIN RAISE EXCEPTION 'append-only record' USING ERRCODE='23514'; END $$;
CREATE TRIGGER publication_immutable BEFORE UPDATE OR DELETE ON review_publications FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER message_immutable BEFORE UPDATE OR DELETE ON conversation_messages FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER rubric_immutable BEFORE UPDATE OF definition,label ON rubric_templates FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER publication_comment_immutable BEFORE UPDATE OR DELETE ON publication_comments FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER submission_identity_immutable BEFORE UPDATE OF recipient_id,teacher_id,submission_no,operation_id,object_id,submitted_at
 ON submissions FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER object_identity_immutable BEFORE UPDATE OF teacher_id,operation_id,slot,slot_index,drive_file_id,parent_drive_id,mime_type,expected_sha256,byte_size
 ON drive_objects FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE INDEX assignments_class ON assignments(class_id,state,accepting);
CREATE INDEX submission_latest ON submissions(recipient_id,submission_no DESC);
CREATE INDEX publication_history ON review_publications(submission_id,revision DESC);
CREATE INDEX recipient_student ON recipients(student_id,assignment_id);
CREATE INDEX drive_integrity ON drive_objects(teacher_id,integrity,lifecycle);
CREATE INDEX library_share_class ON library_shares(class_id,item_id);
-- Contains no score. Fetch authorized Drive publication transiently to compute/export scores.
CREATE VIEW latest_submission_metadata AS
 SELECT DISTINCT ON (recipient_id) recipient_id,id,submission_no,current_publication_id,submitted_at
 FROM submissions ORDER BY recipient_id,submission_no DESC;

-- Reference predicates. Actor comes from the verified server session, never a request field.
CREATE FUNCTION can_read_submission(actor uuid, submission uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, garden AS $$
 SELECT EXISTS (
  SELECT 1 FROM submissions s JOIN recipients r ON r.id=s.recipient_id
  JOIN users u ON u.id=actor
  WHERE s.id=submission AND u.status='active' AND
    ((u.role='teacher' AND s.teacher_id=u.id) OR (u.role='student' AND r.student_id=u.id))
 )
$$;
CREATE FUNCTION can_read_assignment(actor uuid, assignment uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, garden AS $$
 SELECT EXISTS (
  SELECT 1 FROM assignments a JOIN users u ON u.id=actor
  WHERE a.id=assignment AND u.status='active' AND (
   (u.role='teacher' AND a.teacher_id=u.id) OR
   (u.role='student' AND a.state='published' AND EXISTS (
    SELECT 1 FROM recipients r JOIN memberships m ON m.class_id=r.class_id AND m.student_id=r.student_id
    WHERE r.assignment_id=a.id AND r.student_id=u.id AND
     (m.state='active' OR EXISTS (SELECT 1 FROM submissions s WHERE s.recipient_id=r.id))
   ))
  )
 )
$$;
CREATE FUNCTION can_read_reference(actor uuid, assignment uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, garden AS $$
 SELECT EXISTS (
  SELECT 1 FROM assignments a JOIN users u ON u.id=actor WHERE a.id=assignment
  AND can_read_assignment(actor,assignment)
  AND ((u.role='teacher' AND a.teacher_id=u.id) OR a.reference_public_at IS NOT NULL)
 )
$$;
CREATE FUNCTION can_write_recipient(actor uuid, recipient uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, garden AS $$
 SELECT EXISTS (
  SELECT 1 FROM recipients r JOIN assignments a ON a.id=r.assignment_id
  JOIN classes c ON c.id=r.class_id
  JOIN memberships m ON m.class_id=r.class_id AND m.student_id=r.student_id
  JOIN users owner ON owner.id=r.teacher_id JOIN users u ON u.id=actor
  JOIN drive_connections d ON d.teacher_id=r.teacher_id
  WHERE r.id=recipient AND u.id=r.student_id AND u.role='student' AND u.status='active'
  AND owner.status='active' AND c.state='active' AND m.state='active'
  AND a.state='published' AND a.accepting AND d.state='ready'
 )
$$;
CREATE FUNCTION can_read_library(actor uuid, item uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, garden AS $$
 SELECT EXISTS (
  SELECT 1 FROM library_items i JOIN users u ON u.id=actor
  WHERE i.id=item AND i.state='active' AND u.status='active' AND (
   (u.role='teacher' AND i.teacher_id=u.id) OR
   (u.role='student' AND EXISTS (
    SELECT 1 FROM library_shares sh JOIN memberships m ON m.class_id=sh.class_id
    WHERE sh.item_id=i.id AND m.student_id=u.id AND m.state='active'
   ))
  )
 )
$$;
CREATE FUNCTION readable_review_object(actor uuid, submission uuid, requested_publication uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog, garden AS $$
 SELECT p.object_id FROM submissions s JOIN users u ON u.id=actor
 JOIN review_publications p ON p.submission_id=s.id
  AND p.id=COALESCE(requested_publication,s.current_publication_id)
 WHERE s.id=submission AND can_read_submission(actor,submission)
 AND (u.role='teacher' OR p.id=s.current_publication_id)
$$;
CREATE FUNCTION can_read_draft(actor uuid, stream uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, garden AS $$
 SELECT EXISTS (
  SELECT 1 FROM document_streams ds JOIN users u ON u.id=actor
  WHERE ds.id=stream AND u.status='active' AND (
   (u.role='teacher' AND ds.teacher_id=u.id AND (
    (ds.kind='assignment' AND EXISTS (SELECT 1 FROM assignments a WHERE a.draft_stream_id=ds.id)) OR
    (ds.kind='review' AND EXISTS (SELECT 1 FROM review_drafts d WHERE d.stream_id=ds.id)) OR
    (ds.kind='library' AND EXISTS (SELECT 1 FROM library_items i WHERE i.draft_stream_id=ds.id AND i.state IN ('draft','active')))
   )) OR
   (u.role='student' AND ds.kind='student' AND EXISTS (
    SELECT 1 FROM student_drafts d JOIN recipients r ON r.id=d.recipient_id
    JOIN memberships m ON m.class_id=r.class_id AND m.student_id=r.student_id
    WHERE d.stream_id=ds.id AND r.student_id=u.id AND m.state='active'
   ))
  )
 )
$$;

-- Caller holds all policy rows and stream FOR UPDATE before invoking this CAS.
-- Authorization must be rechecked in that same transaction. Files are never overwritten.
CREATE FUNCTION commit_draft_head(stream uuid, actor uuid, client_session uuid,
  fence bigint, base_version bigint, candidate uuid) RETURNS bigint LANGUAGE plpgsql SET search_path = pg_catalog, garden AS $$
DECLARE new_version bigint;
BEGIN
 UPDATE document_streams ds SET head_object_id=candidate,version=version+1
 WHERE ds.id=stream AND ds.lease_actor_id=actor AND ds.lease_session_id=client_session
 AND ds.lease_epoch=fence AND ds.lease_until>clock_timestamp() AND ds.version=base_version
 AND EXISTS (SELECT 1 FROM drive_objects o WHERE o.id=candidate AND o.teacher_id=ds.teacher_id
   AND o.integrity='ok' AND o.lifecycle='candidate');
 IF NOT FOUND THEN RAISE EXCEPTION 'stale lease, version or candidate' USING ERRCODE='40001'; END IF;
 UPDATE drive_objects SET lifecycle='referenced' WHERE id=candidate;
 SELECT version INTO new_version FROM document_streams WHERE id=stream;
 RETURN new_version;
END $$;
