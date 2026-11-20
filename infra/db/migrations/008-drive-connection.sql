CREATE TABLE garden.drive_oauth_attempts (
  state_digest garden.sha256 PRIMARY KEY,
  session_digest garden.sha256 NOT NULL REFERENCES garden.app_sessions ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES garden.teachers,
  nonce text NOT NULL,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX drive_oauth_attempt_expiry ON garden.drive_oauth_attempts(expires_at);

CREATE TABLE garden.drive_setups (
  teacher_id uuid PRIMARY KEY REFERENCES garden.teachers,
  generation uuid NOT NULL DEFAULT gen_random_uuid(),
  session_digest garden.sha256 NOT NULL,
  google_subject text NOT NULL,
  refresh_token_ciphertext bytea NOT NULL,
  token_key_id text NOT NULL,
  granted_scopes text[] NOT NULL,
  parent_folder_id text,
  app_folder_id text,
  expires_at timestamptz NOT NULL,
  CHECK ((parent_folder_id IS NULL) = (app_folder_id IS NULL))
);

ALTER TABLE garden.drive_connections ADD COLUMN generation uuid NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE garden.drive_folders (
  teacher_id uuid NOT NULL REFERENCES garden.teachers,
  kind text NOT NULL CHECK (kind IN ('class','assignment','student')),
  resource_id uuid NOT NULL,
  folder_id text NOT NULL UNIQUE,
  parent_folder_id text NOT NULL,
  PRIMARY KEY (teacher_id,kind,resource_id)
);

CREATE TABLE garden.submission_assets (
  submission_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  PRIMARY KEY (submission_id, asset_id),
  FOREIGN KEY (submission_id, teacher_id) REFERENCES garden.submissions(id, teacher_id),
  FOREIGN KEY (asset_id, teacher_id) REFERENCES garden.drive_objects(id, teacher_id)
);
