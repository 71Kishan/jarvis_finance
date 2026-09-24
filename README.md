# Jarvis Finance

Jarvis Finance is being built as a real multi-market financial platform: one terminal for market discovery, charting, connected broker/exchange accounts, portfolio/wallet visibility, research, risk controls and eventually automated execution.

The current repository remains in the safe research/paper stage while the production platform core is assembled. Real-money execution is not enabled.

## Current scope

- Provider-neutral platform core: canonical instruments, accounts, balances, positions, orders, fills and ledger models.
- Dynamic Binance Spot instrument catalog with provider trading-rule metadata and server-side search.
- Trusted market-data ingestion with explicit source and freshness.
- Deterministic technical signal engine.
- Risk-gated paper execution.
- Historical backtesting with modeled fees, slippage, conservative ambiguous-bar handling, and next-bar-open entries.
- Strategy research / validation workflow.
- AI research Copilot that is advisory-only.
- PWA-friendly Android and desktop/browser UI.

**Real-money brokerage execution is intentionally disabled.** No paper result, signal score, or AI response is a promise of future returns.

## Runtime model

The browser/PWA is the control and visualization surface. Server-side code protects provider credentials and performs provider/AI calls.

The repository now includes a server-owned autonomous **paper** runtime for supported 24/7 crypto data. It consumes the reconnecting Binance websocket gateway and processes completed candles without requiring the phone or laptop to stay open.

Android and laptop browsers are not treated as reliable unattended workers. The phone app is therefore a monitoring/control surface; the long-lived trading process belongs on an always-on server.

Set `JARVIS_PAPER_AUTOSTART=true` only after the strategy has completed the research/validation lifecycle. The current paper runtime persists its account snapshot atomically to disk and replays missed completed candles after restart.

When `DATABASE_URL` is configured, the server initializes PostgreSQL before exposing the platform catalog, applies ordered/checksummed migrations, and persists the canonical Binance instrument catalog transactionally. The database layer is intentionally separate from the paper-runtime snapshot so the paper worker remains usable without PostgreSQL during this research stage.

A production live-capital deployment still needs real authentication, encrypted secrets, broker-order reconciliation, idempotent execution, transactional financial event handling, backups, monitoring, and incident recovery.

## Setup

Install dependencies:

```bash
bun install
```

Create environment variables for the server:

```text
GEMINI_API_KEY=...
FINANCIAL_DATASETS_API_KEY=...
FINANCIAL_DATASETS_BASE_URL=https://api.financialdatasets.ai
```

Never expose provider credentials in browser code or commit them to Git.

Run locally:

```bash
bun run dev
```

Checks:

```bash
bun test
bun run lint
bun run build
```

## 24/7 server deployment

For an always-on paper runtime, deploy the production container on an always-on machine/VPS rather than relying on the phone or laptop browser.

Build and start with:

```bash
docker compose up -d --build
```

The compose stack now includes PostgreSQL 16 with a persistent volume. Set `POSTGRES_PASSWORD` and the matching `DATABASE_URL` in the deployment `.env` file; never commit those values. PostgreSQL health gates the Jarvis container startup, and the server applies pending migrations automatically.

The compose file also persists the separate paper-runtime snapshot in a Docker volume. Keep `JARVIS_PAPER_AUTOSTART=false` until the strategy has completed its validation lifecycle; switch it to `true` only for an intentionally unattended paper run.

The server does not require a Gemini key for deterministic trading. Gemini is an optional research/copilot dependency. Public Binance market data is also consumed without an API key; authenticated account credentials will only be required in a later execution phase.

## Android

Use the deployed HTTPS site as a PWA for the phone UI. Installation gives a more app-like experience, but Android/browser lifecycle rules do not make a PWA a guaranteed 24/7 execution process.

## Research lifecycle

`DRAFT -> BACKTEST -> OUT-OF-SAMPLE -> PAPER -> SHADOW -> VALIDATION -> LIVE-GATE`

A green backtest is evidence for research, not permission to risk capital.

## Risk principles

- No leverage in the current paper terminal.
- Position sizing is constrained by configured risk and notional limits.
- Stale trusted data blocks new automatic entries.
- Closed market sessions block supported stock entries.
- Loss streaks trigger cooldown logic.
- Daily loss / peak drawdown controls can halt paper execution.
- Ambiguous OHLC bars resolve conservatively.
- AI recommendations cannot directly authorize a trade.

## Before real-money work

The platform core now has live PostgreSQL runtime wiring in `src/server/platformDatabase.ts`, a repository boundary in `src/platform/platformRepository.ts`, and migrations in `db/migrations/`. The project still requires real authentication, centralized secret management, an authenticated Binance sandbox adapter, order idempotency/reconciliation, multiple non-overlapping out-of-sample periods, stronger execution/short-cost modeling, monitoring, incident recovery, and an independently reviewable live-capital gate.
