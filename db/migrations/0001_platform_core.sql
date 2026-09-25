-- Jarvis Finance Platform Core
-- PostgreSQL 16+ recommended.
-- Provider/venue-neutral schema.
-- Authoritative financial amounts live in NUMERIC columns.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','LOCKED','CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('BROKER','EXCHANGE','BANK','WALLET')),
  label TEXT NOT NULL,
  external_account_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('DISCONNECTED','CONNECTED','DEGRADED','REQUIRES_REAUTH')),
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  secret_ref TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_connections_external
  ON account_connections(provider, external_account_id)
  WHERE external_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS instruments (
  instrument_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  venue TEXT NOT NULL,
  venue_kind TEXT NOT NULL,
  symbol TEXT NOT NULL,
  display_symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  market TEXT NOT NULL,
  base_asset TEXT,
  quote_asset TEXT,
  currency TEXT,
  provider_symbol TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','DELISTED')),
  tradable BOOLEAN NOT NULL DEFAULT FALSE,
  shortable BOOLEAN,
  fractionable BOOLEAN,
  tick_size NUMERIC(38,18),
  lot_size NUMERIC(38,18),
  min_quantity NUMERIC(38,18),
  max_quantity NUMERIC(38,18),
  min_notional NUMERIC(38,18),
  price_precision INTEGER,
  quantity_precision INTEGER,
  contract_multiplier NUMERIC(38,18),
  listing_time TIMESTAMPTZ,
  delisting_time TIMESTAMPTZ,
  session JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_instruments_provider_symbol
  ON instruments(provider, provider_symbol);

CREATE INDEX IF NOT EXISTS idx_instruments_search
  ON instruments(asset_class, quote_asset, tradable, display_symbol);

CREATE TABLE IF NOT EXISTS balances (
  account_id UUID NOT NULL REFERENCES account_connections(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  free NUMERIC(38,18) NOT NULL DEFAULT 0,
  locked NUMERIC(38,18) NOT NULL DEFAULT 0,
  total NUMERIC(38,18) GENERATED ALWAYS AS (free + locked) STORED,
  valuation_currency TEXT,
  valuation_amount NUMERIC(38,18),
  provider_updated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, asset)
);

CREATE TABLE IF NOT EXISTS positions (
  account_id UUID NOT NULL REFERENCES account_connections(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id),
  side TEXT NOT NULL CHECK (side IN ('LONG','SHORT')),
  quantity NUMERIC(38,18) NOT NULL,
  average_entry_price NUMERIC(38,18) NOT NULL,
  mark_price NUMERIC(38,18),
  market_value NUMERIC(38,18),
  unrealized_pnl NUMERIC(38,18),
  realized_pnl NUMERIC(38,18),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, instrument_id, side)
);

CREATE TABLE IF NOT EXISTS orders (
  client_order_id TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES account_connections(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id),
  external_order_id TEXT,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  order_type TEXT NOT NULL,
  quantity NUMERIC(38,18) NOT NULL,
  limit_price NUMERIC(38,18),
  stop_price NUMERIC(38,18),
  time_in_force TEXT,
  reduce_only BOOLEAN NOT NULL DEFAULT FALSE,
  strategy_id TEXT,
  strategy_version INTEGER,
  reason TEXT,
  status TEXT NOT NULL,
  filled_quantity NUMERIC(38,18) NOT NULL DEFAULT 0,
  average_fill_price NUMERIC(38,18),
  requested_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_provider_event_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_provider_id
  ON orders(account_id, external_order_id)
  WHERE external_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account_connections(id) ON DELETE CASCADE,
  client_order_id TEXT NOT NULL REFERENCES orders(client_order_id),
  external_order_id TEXT,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id),
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity NUMERIC(38,18) NOT NULL,
  price NUMERIC(38,18) NOT NULL,
  fee_amount NUMERIC(38,18),
  fee_asset TEXT,
  liquidity TEXT,
  executed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account_connections(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('DEPOSIT','WITHDRAWAL','TRADE','FEE','TRANSFER','ADJUSTMENT','DIVIDEND','INTEREST')),
  external_reference TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING','POSTED','REVERSED','FAILED')),
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES account_connections(id) ON DELETE RESTRICT,
  asset TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount NUMERIC(38,18) NOT NULL CHECK (amount > 0),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('CASH','ASSET','FEE','RESERVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_asset
  ON ledger_entries(account_id, asset, created_at);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES account_connections(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  base_currency TEXT NOT NULL,
  cash_value NUMERIC(38,18) NOT NULL,
  holdings_value NUMERIC(38,18) NOT NULL,
  total_equity NUMERIC(38,18) NOT NULL,
  realized_pnl NUMERIC(38,18) NOT NULL,
  unrealized_pnl NUMERIC(38,18) NOT NULL,
  day_pnl NUMERIC(38,18),
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_account_time
  ON portfolio_snapshots(account_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  account_id UUID REFERENCES account_connections(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_account_time
  ON audit_events(account_id, created_at DESC);
