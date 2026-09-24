-- Durable research evidence records.
-- This table stores submitted validation evidence; it does not itself authorize
-- execution or prove the metrics were independently recomputed by the server.

CREATE TABLE IF NOT EXISTS strategy_validation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  strategy_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  strategy_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('INSUFFICIENT_EVIDENCE','FAILED','PROVISIONALLY_VALIDATED')),
  evaluated_at TIMESTAMPTZ NOT NULL,
  evidence_hash TEXT NOT NULL,
  policy JSONB NOT NULL,
  metrics JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'CLIENT_SUBMITTED'
    CHECK (source IN ('CLIENT_SUBMITTED','SERVER_RECOMPUTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, strategy_id, strategy_version, evidence_hash)
);

CREATE INDEX IF NOT EXISTS idx_strategy_validation_latest
  ON strategy_validation_runs(user_id, strategy_id, strategy_version, evaluated_at DESC);
