-- Bind an idempotency key to the exact order intent that first used it.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint TEXT;
