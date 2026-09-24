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

The shadow runtime additionally requires `JARVIS_SHADOW_STRATEGY_ID` and, by default, `JARVIS_SHADOW_REQUIRE_SERVER_VALIDATED=true`.

Real-money execution remains disabled.