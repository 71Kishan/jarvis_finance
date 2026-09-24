-- Explicit server-owned strategy deployment records.
-- Deployment is a research/shadow control plane; it is not a provider order permission.

CREATE TABLE IF NOT EXISTS strategy_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  strategy_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('SHADOW')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','PAUSED','REVOKED')),
  validation_run_id UUID NOT NULL REFERENCES strategy_validation_runs(id) ON DELETE RESTRICT,
  strategy JSONB NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_deployments_active
  ON strategy_deployments(user_id, environment)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_strategy_deployments_history
  ON strategy_deployments(user_id, environment, updated_at DESC);
