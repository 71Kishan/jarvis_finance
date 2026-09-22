# Jarvis Finance — Professional Review — 2026-09-22

## Executive conclusion

The original repository already had a substantial paper-trading product surface, but several parts created more confidence than the underlying evidence justified. The audit therefore focused on falsifiability, accounting correctness, risk enforcement, data provenance, and honest mobile/runtime behavior.

The resulting audit branch is a **stronger research/paper-trading foundation**. It is not a live-capital system.

## What the audit changed

### Signal integrity
- Volume is now a participation filter rather than directional evidence.
- Signal eligibility requires a directional edge over the opposing score.
- RSI uses the strategy's configured oversold/overbought bounds.
- Volume comparison uses prior completed bars rather than including the current bar in its own baseline.

### Risk and execution
- Paper entries are sized from risk budget plus position-notional limits.
- Requests above available paper cash are rejected rather than silently clipped.
- Stale market data blocks new automatic entries.
- Market-session state is passed into risk evaluation for supported stock sessions.
- Daily risk boundaries roll explicitly.
- Loading a research candidate pauses automated paper execution.
- Leverage is fixed at 1x in the current paper terminal.

### Backtesting
- Entry/exit fee accounting was corrected so the entry fee is not effectively double-counted.
- Candidate selection no longer uses the held-out test set.
- Backtests incorporate the configured risk budget, drawdown halt, loss cooldown, modeled slippage/fees, and conservative ambiguous-bar resolution.
- High-drawdown verdict classification was corrected.

### Data provenance
- Live UI exposes provider/source and data freshness.
- Provider timestamps are preferred over client arrival time when available.
- Live-data failure is fail-closed instead of silently switching to synthetic values.
- A price-change figure is no longer converted into a fabricated sentiment score.

### AI behavior
- The missing Copilot endpoint was added as an advisory-only research service.
- Copilot receives recent conversation and terminal context.
- Financial-company context can be requested from the configured Financial Datasets provider.
- AI instructions explicitly prohibit invented prices, filings, news, liquidity, or claims that a small sample proves an edge.
- AI output cannot submit or authorize real-money trades.
- Stale model labels were corrected to the current configured Gemini service.

### Security and mobile behavior
- Cryptographic verification now fails closed when Web Crypto is unavailable instead of falling back to a non-cryptographic placeholder.
- Local session PIN is six digits with persistent failed-attempt backoff.
- Disclosures no longer claim that local storage is an immutable ledger, a custody system, or a regulatory/statutory protection.
- The Android/PWA UI now explicitly states that background browser execution is not a guaranteed 24/7 worker.

## What remains before any live-capital phase

1. Durable server-side journal and cross-device state.
2. Production authentication and authorization.
3. Centralized secrets and rotation.
4. Multiple independent out-of-sample periods and parameter-sensitivity tests.
5. Proper instrument-specific trading calendars and corporate-action handling.
6. More complete spread, liquidity, borrow, funding, gap, and execution modeling.
7. Broker sandbox integration and reconciliation.
8. Idempotent order submission / duplicate-order protection.
9. Server-side worker for unattended scheduling.
10. Monitoring, alerting, incident recovery, and rollback.
11. Explicit live-capital approval gates with deliberately small initial exposure.

## Professional design rule

Jarvis may observe, calculate, compare, explain, and propose.

Jarvis should not treat its own confidence score as a probability of profit, should not use a single backtest as proof, and should not let AI-generated text override deterministic risk controls.
