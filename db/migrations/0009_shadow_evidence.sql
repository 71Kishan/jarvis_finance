-- Durable forward-validation observations for server-owned shadow runs.

CREATE TABLE IF NOT EXISTS shadow_equity_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_id UUID NOT NULL REFERENCES shadow_runtime_states(id) ON DELETE CASCADE,
  candle_timestamp TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  close_price NUMERIC(38,18) NOT NULL,
  equity NUMERIC(38,18) NOT NULL,
  cash NUMERIC(38,18) NOT NULL,
  drawdown_percent NUMERIC(18,8) NOT NULL,
  daily_drawdown_percent NUMERIC(18,8) NOT NULL,
  bot_state TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('HEARTBEAT','SIGNAL','ENTRY','EXIT','HALT')),
  signal JSONB,
  active_trade JSONB,
  trade_event JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shadow_equity_runtime_candle
  ON shadow_equity_snapshots(runtime_id, candle_timestamp);

CREATE INDEX IF NOT EXISTS idx_shadow_equity_runtime_time
  ON shadow_equity_snapshots(runtime_id, candle_timestamp DESC);

CREATE TABLE IF NOT EXISTS shadow_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_id UUID NOT NULL REFERENCES shadow_runtime_states(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  trade_type TEXT NOT NULL CHECK (trade_type IN ('LONG','SHORT')),
  entry_price NUMERIC(38,18) NOT NULL,
  exit_price NUMERIC(38,18),
  amount NUMERIC(38,18) NOT NULL,
  size_usd NUMERIC(38,18) NOT NULL,
  margin_usd NUMERIC(38,18),
  entry_time TIMESTAMPTZ NOT NULL,
  exit_time TIMESTAMPTZ,
  stop_loss NUMERIC(38,18) NOT NULL,
  take_profit NUMERIC(38,18) NOT NULL,
  highest_price NUMERIC(38,18),
  lowest_price NUMERIC(38,18),
  pnl NUMERIC(38,18) NOT NULL,
  pnl_percent NUMERIC(18,8) NOT NULL,
  fees_usd NUMERIC(38,18),
  slippage_usd NUMERIC(38,18),
  status TEXT NOT NULL,
  signal_score NUMERIC(18,8) NOT NULL,
  confidence NUMERIC(18,8) NOT NULL,
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(runtime_id, trade_id)
);

CREATE INDEX IF NOT EXISTS idx_shadow_trades_runtime_time
  ON shadow_trades(runtime_id, entry_time DESC);
