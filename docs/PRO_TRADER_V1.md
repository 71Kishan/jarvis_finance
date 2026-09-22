# Jarvis Finance — Pro-Trader V1 Engineering Specification

## Operating principle

Jarvis is a research and paper-trading system first. The application must earn the right to move capital through evidence.

A professional workflow is:

**data → research → hypothesis → backtest → chronological holdout → paper forward test → shadow/live comparison → tiny live allocation → monitored expansion**

An AI model can propose hypotheses and summarize evidence. It must not be allowed to manufacture a price, news item, performance statistic, order-flow conclusion, or "verified" trade.

## What changed in this branch

- Paper execution is opt-in and separate from broker execution.
- Signals are formed on completed candles and queued for the next candle open.
- Backtests model fees, slippage, trailing stops, and ambiguous OHLC bars conservatively.
- Strategy qualification requires meaningful trade count, holdout evidence, positive expectancy/P&L and drawdown limits.
- Fabricated default win rates, "verified" fills, synthetic FX-to-crypto mappings, and custody/profit-guarantee language are removed.
- Paper profit "Vault" terminology now means local accounting only; it is not custody.
- Browser/PWA operation is not treated as an always-on trading server.
- Market-session times use IANA time zones and are explicitly treated as reference data.
- Financial Datasets is exposed through a server-side stock research gateway. Its API key stays server-side.

## Data architecture

### Market data

**Crypto:** exchange market data can feed the paper simulator and research scanner.

**US equities/fundamentals:** Financial Datasets can provide price snapshots, historical data, financial statements, metrics, SEC filings, earnings, ownership and related datasets. The server should fetch this data; the browser should never receive the provider key.

**Macro:** rates, inflation, employment, yield curve and other macro series should become a separate source layer rather than being mixed into technical indicators.

### Data quality contract

Every observation used by a strategy should carry:

- source
- symbol/instrument
- event/data timestamp
- ingestion timestamp
- timeframe
- adjusted/unadjusted status where relevant
- units/currency
- freshness status
- corporate-action context for equities

No trading decision should be created from a stale or synthetic observation unless that observation is explicitly marked as simulation input.

## Research architecture

Jarvis should evaluate a strategy on more than win rate.

Required metrics include:

- net return after costs
- profit factor
- expectancy
- Sharpe/Sortino-style risk-adjusted metrics
- maximum drawdown
- annualized volatility
- exposure and turnover
- number of trades
- out-of-sample performance
- robustness across instruments and market regimes

A high win rate can coexist with poor expectancy. A single winning period cannot establish durable edge.

## Backtesting rules

The engine should enforce:

1. chronological train/test separation
2. no look-ahead
3. no future corporate-action knowledge
4. realistic fees and slippage
5. conservative treatment of ambiguous bars
6. minimum sample-size gates
7. parameter-sweep limits
8. walk-forward validation before promotion
9. reproducible experiment IDs
10. versioned strategy/config fingerprints

## Risk architecture

Default paper limits in this branch are deliberately conservative.

The risk engine should eventually support:

- per-trade risk budget
- maximum position/notional percentage
- daily loss limit
- maximum trades/day
- loss cooldown
- stale-data rejection
- spread/liquidity checks
- symbol and sector concentration limits
- portfolio-level volatility target
- correlation limits
- event-risk blocks
- hard manual kill switch
- latched circuit breakers

Risk controls limit behavior; they cannot guarantee a market fill or a maximum real-world loss.

## AI architecture

AI has four safe roles:

**Research assistant:** explains filings, macro data, and market observations.

**Hypothesis generator:** proposes strategy variations.

**Model selector:** compares already-tested models.

**Risk reviewer:** highlights weaknesses and conflicts in evidence.

AI does **not** receive a direct "place order" capability.

Promotion should require a deterministic policy engine to verify:

- required data quality
- minimum sample
- holdout performance
- maximum drawdown
- cost sensitivity
- robustness tests
- paper-forward performance
- explicit human approval for live deployment

## Mobile and laptop architecture

The phone and laptop are client surfaces.

They should provide:

- dashboards
- charts
- research
- approvals
- alerts
- journaling
- kill switch
- audit views

A browser tab or PWA should not be considered a reliable 24/7 execution process because operating systems and browsers can suspend background work.

The long-term architecture is:

**Android / Web UI → authenticated API → persistent research/portfolio services → execution worker → broker adapter**

The execution worker should be restartable and idempotent.

## Real-money boundary

There is intentionally no real-money execution adapter in this branch.

The eventual order path should be physically and logically separated:

**AI / Research → proposal → risk policy → approval → execution gateway → broker**

The execution gateway should have:

- allowlisted instruments
- max order size
- max daily notional
- duplicate-order prevention
- idempotency keys
- broker-state reconciliation
- cancel/replace controls
- heartbeat and stale-session handling
- independent emergency shutdown
- append-only audit trail

## Current status

This branch is suitable for continued paper research and engineering hardening.

It is **not** evidence of profitability and it is **not** a production live-trading system.

## Next build order

1. Add proper Financial Datasets client ingestion and normalized storage.
2. Add a persistent database instead of browser-only paper state.
3. Build walk-forward and multi-regime validation.
4. Add portfolio construction and risk attribution.
5. Move paper execution to a persistent worker.
6. Add authenticated mobile/web API access.
7. Add broker sandbox integration.
8. Run shadow trading.
9. Only then evaluate a tiny real-money allocation.
