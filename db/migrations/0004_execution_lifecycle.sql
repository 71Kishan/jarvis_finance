-- Jarvis sandbox execution lifecycle.
-- This migration adds persistent idempotency fingerprints and explicit provider
-- failure detail. Fills are uniquely reconciled by provider trade id.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE fills
  ADD COLUMN IF NOT EXISTS external_trade_id TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_account_idempotency
  ON orders(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_reconciliation
  ON orders(account_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fills_provider_trade
  ON fills(account_id, external_order_id, external_trade_id)
  WHERE external_order_id IS NOT NULL AND external_trade_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fills_order
  ON fills(account_id, client_order_id, executed_at DESC);
