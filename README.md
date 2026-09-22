# Jarvis Finance

Jarvis Finance is a research and paper-trading terminal for evidence-driven market analysis.

## Current scope

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

Android and laptop browsers are not treated as reliable unattended workers. A future unattended scheduler/worker belongs server-side.

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

The project still requires durable cross-device state, production authentication, centralized secrets, broker sandbox testing, order idempotency/reconciliation, multiple non-overlapping out-of-sample periods, stronger execution/short-cost modeling, monitoring, incident recovery, and an independently reviewable live-capital gate.
