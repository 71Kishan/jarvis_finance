# Server Shadow Runtime V1

## What this is

Shadow runtime is the forward-validation stage between historical research and any future execution design. It consumes the same server-owned completed-candle stream as the paper engine and runs the same deterministic TradingEngine strategy/risk behavior.

It does not call the Binance order endpoints. Its research capital is a model balance used only to measure hypothetical paper execution and is never presented as an account balance.

## Restart behavior

- A fresh shadow run evaluates only the newest completed candle and uses older completed bars only as indicator context.
- An already-open research position may replay available missed completed candles after restart.
- If the completed-candle gap is incomplete while a research position is open, the runtime halts for manual reconciliation rather than guessing.
- The pending next-bar entry is intentionally not persisted, so an interrupted process cannot submit a stale historical entry after restart.

## Persistence

Runtime state is persisted in PostgreSQL in `shadow_runtime_states`. The saved state is isolated from provider `orders`, `fills`, balances, and positions tables.

## Operator controls

Shadow is disabled by default. The server exposes control-token-protected status/start/stop endpoints and optional `JARVIS_SHADOW_AUTOSTART=true`.

## Evidence boundary

Shadow performance is forward paper evidence, not proof of a durable trading edge. A future promotion gate should consider enough forward calendar time, trade count, drawdown, execution assumptions, and stability across market regimes.

Real-money trading remains disabled.