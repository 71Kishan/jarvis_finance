-- Jarvis authenticated control-plane state.
-- Raw passwords and raw session tokens are never persisted.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_app_users_auth_email
  ON app_users(lower(email));

CREATE INDEX IF NOT EXISTS idx_user_sessions_active_token
  ON user_sessions(token_hash, expires_at)
  WHERE revoked_at IS NULL;
