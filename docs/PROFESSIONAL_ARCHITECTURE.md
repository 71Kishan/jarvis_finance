# Jarvis Finance — Professional Architecture

## Purpose
Jarvis Finance is a research, analysis, and paper-trading system. It is not a profit machine and no model output is treated as a guarantee.

Core rule: no unvalidated assumption is allowed to control real capital.

## Runtime

Android: monitoring/control plane for market state, research, paper positions, alerts, and risk status. It must not be treated as a reliable 24/7 unattended execution worker.

Laptop browser/desktop: same control surface with more space for charts, experiments, strategy inspection, and research.

Server: provider access, API-key protection, AI research calls, normalization, caching, and eventually durable cross-device state.

Dedicated worker: unattended automation belongs in a server-side worker/scheduler, not in a browser tab, Android PWA, or React component.

Broker boundary: any future real-money order service must be separated from the AI/research process. AI may propose; deterministic policy validates; execution submits; reconciliation confirms.

## Data hierarchy
1. Trusted provider data.
2. Normalized data with source and timestamp.
3. Deterministic derived indicators.
4. Research/AI interpretation.
5. Validation gate.
6. Paper/shadow execution.

When trusted data is unavailable, show DATA_UNAVAILABLE instead of silently substituting synthetic values.

## Current providers
Crypto: the current live feed uses exchange data for the supported crypto symbols.
US stocks/ETFs: the application is wired for Financial Datasets as the trusted server-side stock provider.
Provider credentials remain server-side; never expose an API key to the browser.

## Signal engine
Current baseline: EMA structure, MACD, RSI, Bollinger structure, and volume participation.
The signal score is a heuristic score, not a calibrated probability of profit.

## Risk engine
Current paper controls: one open position, no leverage, position-notional cap, per-trade risk budget, daily-loss limit, peak-drawdown limit, spread/volatility gates when data exists, loss-streak cooldown, and circuit-breaker halt.
These controls reduce modeled risk; they do not guarantee protection from real-market gaps or execution failures.

## Execution model
Paper execution models adverse entry and exit slippage, entry and exit fees, conservative stop-first resolution for ambiguous OHLC bars, and next-bar-open entry for backtests.

The execution layer now has two explicit contracts: a fill-execution model for deterministic simulated costs and a provider-neutral broker execution adapter for canonical order intents. The paper broker adapter proves idempotent market/limit order handling, balance reservation/cancellation, and trusted-price requirements without enabling real-money routing.

## Strategy lifecycle
DRAFT -> BACKTEST -> OUT-OF-SAMPLE -> PAPER -> SHADOW -> VALIDATION -> LIVE-GATE

The learning layer now records each closed paper trade as a structured, strategy-versioned outcome record containing signal score, execution costs, holding period, exit status, rationale, and realized P&L. The journal is bounded and idempotent by trade ID. This is a dataset foundation, not automatic model retraining or strategy promotion. The research loop now consumes that journal alongside historical candles, generates deterministic small perturbation candidates, evaluates train/validation/held-out test windows, and requires a minimum learning dataset before exposing a candidate for review. Historical backtests remain available before that learning-data gate is met.
The Strategy Vault records evidence. It must not auto-promote a strategy after a small number of trades.

## AI lifecycle
OBSERVE -> EXPLAIN -> PROPOSE -> TEST -> COMPARE -> VALIDATE -> DEPLOY
AI must not fabricate missing market facts, claim certainty from a small sample, directly submit real-money orders, or freely rewrite/deploy its own production trading code.

## Cross-device state
Much of the current paper/session state remains local. Before serious multi-device use, move the authoritative journal to a durable server database.
Every authoritative record should carry a stable ID, timestamp, provider/source, strategy/version, data snapshot/version, decision reason, risk decision, execution/fill record, and audit record.

## Monitoring
Track provider availability, data freshness, latency, AI errors, strategy/model version, paper/live mode, risk-halt state, order reconciliation, and expected-versus-actual fills.

## Security
API credentials stay server-side. Production needs centralized secret handling, rotation, access controls, and audit logging.
Local hashes can detect changes in a local record set; they are not an immutable external ledger or custody system.

## Deliberately disabled
Real-money brokerage execution is not enabled in this version.

### Controlled feature-research dataset

The learning dataset now has an explicit preparation/audit stage before any ML experiment. It keeps chronological 60/20/20 partitions without shuffling, checks that decision-time features precede entry, rejects unsupported feature-schema or non-finite values, tracks missingness and constant features, and keeps target fields outside the numeric feature vector. The first controlled ML experiment requires at least 90 valid feature rows plus a clean leakage/schema audit. This is a research-data gate only; it does not promote or deploy a model.

### First controlled ML experiment

The first machine-learning experiment is intentionally narrow: a deterministic logistic-regression meta-labeler predicts WIN versus non-WIN for an already eligible deterministic signal. It does not generate direction, sizing, exits, orders, or capital decisions. The implementation uses TRAIN-only missing-value imputation and normalization, validation-only selection of regularization and the filter threshold, and a held-out TEST evaluation. The experiment reports classification metrics and a test P&L overlay against taking every deterministic signal. A successful experiment is evidence for further research only; it does not promote or deploy a model.

### Combined ML robustness gate

The first ML path now combines balanced-class training, train-only Platt probability calibration, explicit classification/trading baselines, and three chronological rolling 90/30/30 experiments once at least 210 valid live-market feature rows exist. Each rolling period repeats model selection without using its future test rows. These results remain research evidence only.
