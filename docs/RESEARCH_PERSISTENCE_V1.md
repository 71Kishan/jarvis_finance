# Research Evidence Persistence V1

## Server authority

Research can be explored in the browser for responsiveness, but strategy promotion evidence is now recomputed on the server from Binance public historical market data.

The server research endpoint currently uses a configurable Binance Spot kline interval (default `1h`) and a bounded history window (default 1,800 completed candles). The current hourly interval is intentional: the validation policy requires calendar-time out-of-sample coverage, and a short 1-minute UI sample cannot satisfy that evidence requirement.

The historical service paginates Binance kline responses and explicitly excludes the currently incomplete candle. Strategy validation is then run against that completed server-owned history.

## Evidence records

Each validation record stores:

- exact strategy configuration;
- deterministic validation policy;
- backtest and walk-forward metrics;
- individual validation gates;
- provider, symbol, interval, and candle-count context for server recomputation;
- a SHA-256 evidence hash binding the stored record to its canonical evidence payload;
- source: `CLIENT_SUBMITTED` or `SERVER_RECOMPUTED`.

`CLIENT_SUBMITTED` is an evidence archive only. It is not treated as server verification.

`SERVER_RECOMPUTED` means Jarvis recomputed the current validation result from the server's Binance historical data path. It still does not guarantee future performance.

## Promotion boundary

The Research UI can apply a candidate only when its deterministic validation result is `PROVISIONALLY_VALIDATED`. A server-recomputed record is the required source for activating the server-owned shadow runtime.

The normal shadow path is now an explicit server-owned deployment record in `strategy_deployments`. The Research workspace can request deployment using a persisted validation run; the server transaction rechecks that the run is `PROVISIONALLY_VALIDATED`, `SERVER_RECOMPUTED`, and contains the exact strategy configuration before activating it. The shadow runtime then loads the active deployment record on startup.

Real-money execution remains disabled.

## Forward shadow evidence

Once a server-recomputed strategy is activated for shadow, Jarvis persists per-candle forward observations and meaningful trade-state changes. The Automation workspace evaluates the durable sample against a separate forward policy requiring, by default:

- at least 30 closed shadow trades;
- at least 30 calendar days of forward observation;
- profit factor of at least 1.05;
- non-negative average realized PnL per closed shadow trade;
- maximum drawdown no greater than 10%;
- a runtime that is not in ERROR or HALTED.

This forward status is a research evidence state. It does not authorize provider orders or claim that an edge will persist.

## Operational readiness

The server health endpoint also reports operational dependencies separately from strategy performance: PostgreSQL readiness, market-data freshness, instrument catalog readiness, authenticated account stream health when configured, provider reconciliation freshness, paper/shadow runtime state, and forward validation status. A missing freshness timestamp fails closed for the affected critical dependency.


## Shadow deployment control plane

A validated research result is not automatically an active shadow strategy. Deployment is a separate operator action and is stored durably in PostgreSQL.

Only one SHADOW deployment may be ACTIVE for a user at a time. Activating a new deployment pauses the existing deployment in the same transaction. The deployment stores the exact validated strategy configuration and the validation-run identifier used to authorize it.

Environment-based strategy selection remains available only as an explicit legacy fallback when `JARVIS_SHADOW_ALLOW_LEGACY_ENV=true`. The default is to require a server-owned deployment record.
