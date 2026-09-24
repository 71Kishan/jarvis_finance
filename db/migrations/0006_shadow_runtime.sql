-- Durable server-owned shadow runtime state.
-- Shadow execution never creates or submits provider orders; the state is an isolated
-- forward-validation ledger using the same deterministic TradingEngine on live data.

CREATE TABLE IF NOT EXISTS shadow_runtime_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  strategy_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('STOPPED','STARTING','RUNNING','WAITING_FOR_DATA','HALTED','ERROR')),
  runtime_state JSONB NOT NULL,
  last_processed_candle_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, strategy_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_shadow_runtime_user_updated
  ON shadow_runtime_states(user_id, updated_at DESC);
