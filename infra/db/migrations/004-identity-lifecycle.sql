-- Existing sessions can still read their own metadata. A sensitive mutation
-- requires an auth time supplied by a fresh OIDC login.
ALTER TABLE garden.app_sessions ADD COLUMN authenticated_at timestamptz;
CREATE UNIQUE INDEX one_active_identity_mutation
  ON garden.identity_operations(target_user_id)
  WHERE state IN ('reserved','keycloak_linked','credentials_pending','unknown');
ALTER TABLE garden.audit_events ADD COLUMN identity_operation_id uuid REFERENCES garden.identity_operations;
