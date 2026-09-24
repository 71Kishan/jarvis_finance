-- Store the exact strategy configuration that produced a validation record.
-- This allows a server-owned shadow runtime to consume a server-recomputed
-- candidate without trusting a browser-provided copy later.

ALTER TABLE strategy_validation_runs
  ADD COLUMN IF NOT EXISTS strategy JSONB;
