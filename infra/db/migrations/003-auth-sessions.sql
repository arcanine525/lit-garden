-- These tables contain only short-lived authentication metadata, never passwords
-- or issued OIDC tokens. The opaque browser values are hashed before storage.
CREATE TABLE garden.oidc_attempts (
  handle_digest garden.sha256 PRIMARY KEY,
  state text NOT NULL,
  nonce text NOT NULL,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX oidc_attempts_expiry ON garden.oidc_attempts(expires_at);

CREATE TABLE garden.app_sessions (
  handle_digest garden.sha256 PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES garden.users ON DELETE CASCADE,
  auth_epoch bigint NOT NULL CHECK (auth_epoch >= 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX app_sessions_expiry ON garden.app_sessions(expires_at);
CREATE INDEX app_sessions_user ON garden.app_sessions(user_id);
