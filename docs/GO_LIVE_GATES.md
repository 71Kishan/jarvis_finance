# Jarvis Finance — Go-Live Gates

Real-money trading is a separate phase. A green backtest alone is not enough.

## Gate 0 — Data integrity
Trusted provider for every instrument; normalized timestamps/timezones; corporate-action handling for securities research; missing/stale-data detection; no synthetic fallback presented as live.

## Gate 1 — Research correctness
Reproducible indicators; versioned strategies; train/validation/test separation; look-ahead checks; survivorship-bias treatment; realistic fees and slippage; trading-calendar handling; conservative ambiguous-bar handling.

## Gate 2 — Out-of-sample evidence
Use multiple non-overlapping test periods, sufficient observations, sensitivity analysis, parameter perturbation checks, drawdown/cost/turnover analysis, and simple benchmarks.

## Gate 3 — Forward paper
Live market data, simulated fills, full cost model, zero real capital, complete journal, stable risk controls, and extended monitoring.

## Gate 4 — Shadow trading
Generate decisions without sending orders. Compare expected fills, timing, spread, slippage, signal stability, and opportunity cost.

### Sandbox order lifecycle requirement

Before a broker sandbox is allowed to receive test orders, Jarvis must have durable order intents, account ownership enforcement, mandatory idempotency keys/fingerprints, deterministic client-order identifiers, explicit server-side notional/open-order caps, conservative provider-error classification, fill deduplication, and reconciliation that never assumes an order disappeared because a request timed out.

## Gate 5 — Production controls
Authentication, durable database, secret management, idempotent orders, broker reconciliation, duplicate-order protection, stale-data protection, kill switch, loss/exposure/position limits, alerting, incident logs, and recovery procedure.

### Authenticated control plane requirement

Before any future money-moving service is considered, the operator control plane must have a durable user identity, server-side session enforcement, credential isolation, audit logging, account ownership checks, same-origin protection for state-changing requests, authentication rate limiting/lockout, and provider reconciliation that fails closed on unknown order state.

These controls establish who is allowed to inspect or operate the platform; they do not authorize live trading.

## Gate 6 — Broker sandbox
Use a broker paper/sandbox environment. Keep the execution service independent from the AI/research service.

## Gate 7 — Minimal live allocation
Only after every prior gate passes should live capital be considered. Start with deliberately small capital under an explicit risk budget. Leverage and options are not required for the first live phase.

## Permanent stop conditions
Pause when market data is stale, provider identity changes unexpectedly, reconciliation fails, strategy version is unknown, risk state is inconsistent, unexpected code/configuration changed, material model/data drift appears, or risk limits are breached.

A safety-triggered pause is a success condition for the safety system.

### Gate 6 implementation — Binance Spot Testnet lifecycle

The current sandbox branch implements the first broker-connected lifecycle behind the existing authenticated control plane: persist the order intent first, submit to Binance Spot Testnet, persist the provider order ID/status, retrieve fills, deduplicate provider trades, support cancellation, and reconcile uncertain state after timeouts or restarts. The provider adapter is locked to the Binance Spot Testnet endpoint when testnet-only mode is enabled.

The default configuration keeps provider order submission disabled. Enabling testnet orders requires both the Jarvis sandbox-order flag and the Binance testnet-order flag; this branch does not contain a real-money order route. A testnet lifecycle pass is evidence that execution plumbing works, not evidence that a strategy is profitable or ready for live capital.
