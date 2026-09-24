-- Exactly-once reservation key for provider execution requests.
-- The fingerprint remains necessary so a reused idempotency key with a different
-- order intent is rejected rather than silently replaying the first intent.

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_account_idempotency
  ON orders(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
