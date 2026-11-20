ALTER TABLE garden.drive_folders DROP CONSTRAINT drive_folders_kind_check;
ALTER TABLE garden.drive_folders ADD CHECK (kind IN ('class','assignment','student','assets'));

CREATE TABLE garden.assignment_assets (
  assignment_id uuid NOT NULL,
  asset_id uuid NOT NULL UNIQUE,
  teacher_id uuid NOT NULL,
  document_part text NOT NULL DEFAULT 'staged' CHECK (document_part IN ('staged','prompt','reference','both')),
  PRIMARY KEY (assignment_id,asset_id),
  FOREIGN KEY (assignment_id,teacher_id) REFERENCES garden.assignments(id,teacher_id),
  FOREIGN KEY (asset_id,teacher_id) REFERENCES garden.drive_objects(id,teacher_id)
);

CREATE TABLE garden.asset_view_leases (
  handle_digest garden.sha256 PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES garden.assignment_assets(asset_id) ON DELETE CASCADE,
  session_digest garden.sha256 NOT NULL REFERENCES garden.app_sessions ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX asset_lease_expiry ON garden.asset_view_leases(expires_at);
