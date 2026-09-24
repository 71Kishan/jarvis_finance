# Jarvis Finance — Platform Persistence & Control Plane V1

This phase turns PostgreSQL into a real runtime component for the platform's identity, provider-account, execution and audit state.

## Persisted platform state

The server can persist the canonical Binance Spot instrument catalog, authenticated Jarvis users and sessions, connected provider accounts, provider wallet balances, orders, fills, ledger transactions/entries, portfolio snapshots and audit events.

Provider credentials are not stored in browser state or the repository. The account connection contains a server-side secret reference for future external secret-manager integration.

## Authentication

Jarvis now has a server-owned password/session layer:

- password verifiers use salted scrypt; plaintext passwords are never persisted;
- login creates an opaque HttpOnly SameSite session cookie and only the SHA-256 token hash is stored;
- login attempts are throttled and repeated failures trigger temporary account lockout;
- state-changing browser requests are checked for same-origin;
- authenticated /api/me and account routes fail closed when the PostgreSQL identity layer is unavailable.

For the current private single-operator deployment, bootstrap uses JARVIS_ADMIN_EMAIL and JARVIS_ADMIN_PASSWORD. Production deployment should move credentials to a proper secret manager and use HTTPS with JARVIS_SECURE_COOKIES=true.

## Sandbox execution

Binance Spot Testnet execution is deliberately behind two independent gates:

1. the adapter must remain locked to the Binance Spot Testnet host;
2. JARVIS_BINANCE_TESTNET_ENABLE_ORDERS=true must explicitly enable provider order submission/cancellation.

Additionally, the connected account must carry the local TRADE permission granted by an authenticated operator.

Every submitted sandbox order has a server-derived deterministic client order id and a database idempotency key. The exact order request is fingerprinted so reusing an idempotency key for a different order is rejected.

The server reserves a PENDING_SUBMIT order before the provider request. This avoids submitting twice when concurrent requests use the same idempotency key.

## Pre-trade validation

Before a sandbox order reaches Binance, Jarvis validates the persisted venue rules and current provider balance state:

- instrument must be active and tradable;
- quantity must meet min/max and lot-size rules;
- price must meet tick-size rules for price-bearing orders;
- estimated notional must meet the provider minimum;
- market orders require a fresh trusted bid/ask price;
- BUY orders require sufficient free quote-asset balance;
- SELL orders require sufficient free base-asset balance.

These are hard execution-safety checks. They are not a substitute for the strategy/risk engine.

## Order state and reconciliation

Provider events are treated as authoritative but monotonic:

- stale provider events cannot overwrite newer state;
- terminal states cannot silently regress;
- UNKNOWN_RECONCILIATION is used when provider state cannot be established safely;
- the server-owned Binance user-data stream provides execution/balance events;
- a periodic REST reconciliation loop is the backstop for missed WebSocket events;
- execution updates are deduplicated by provider trade id.

Unknown execution is never automatically retried because a timeout does not prove that the provider rejected the order.

## Ledger

Each newly observed provider fill is persisted once and produces a provider-account TRADE ledger transaction with asset movements:

- BUY: quote-asset debit + base-asset credit;
- SELL: base-asset debit + quote-asset credit;
- provider fee: fee-asset debit when the provider reports a fee.

Financial quantities remain PostgreSQL NUMERIC(38,18) / strings across the application boundary. JavaScript floating-point arithmetic is not used to decide monetary equality or provider deduplication.

The current ledger is an event/accounting record for provider activity. Portfolio valuation is a separate concern and must use trusted marks rather than synthetic prices.

## Migration safety

Migrations are discovered from db/migrations, applied in filename order, and recorded in jarvis_schema_migrations.

Each applied migration is stored with a SHA-256 checksum. Editing an already-applied migration causes startup to reject the run rather than silently changing production schema history.

A PostgreSQL advisory lock serializes migration execution across multiple Jarvis instances.

## Failure behavior

DATABASE_URL is still optional while Jarvis remains in the research/paper phase. Without it, the database reports DISABLED and the legacy paper runtime can continue using its separate durable snapshot.

JARVIS_DB_REQUIRED=true turns database initialization failure into server-start failure.

For sandbox execution, however, PostgreSQL is mandatory: there is no safe fallback that could create an authenticated order state outside the persistent execution journal.

## Current boundary

The implementation is testnet-only. There is no live-money order route, no withdrawal/custody workflow and no production secret-manager integration.

The next production gates are independent risk authorization, richer portfolio valuation/reconciliation, shadow execution against live market data, operational alerting, multi-instance coordination/disaster recovery and broader out-of-sample strategy validation.
