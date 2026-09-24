-- Jarvis sandbox execution lifecycle.
-- Explicitly testnet-gated; this migration only adds persistence contracts.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_account_idempotency
  ON orders(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE fills
  ADD COLUMN IF NOT EXISTS external_trade_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fills_provider_trade
  ON fills(account_id, external_trade_id)
  WHERE external_trade_id IS NOT NULL;
