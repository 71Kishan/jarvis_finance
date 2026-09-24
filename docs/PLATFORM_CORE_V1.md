# Jarvis Finance — Platform Core V1

This phase changes the target from a paper-trading demo toward a broker/exchange-neutral financial platform.

## What was added

- Canonical instrument model independent of the existing paper engine.
- Dynamic Binance Spot instrument catalog sourced from Binance exchange metadata.
- Search/filter primitives for large instrument universes.
- Provider-neutral account, wallet balance, portfolio position, order, fill and ledger models.
- Execution-adapter boundary so Binance, Indian brokers, US brokers and future venues use one contract.
- PostgreSQL schema for users, connected accounts, instruments, balances, positions, orders, fills, ledger transactions and audit events.

## Money model

Jarvis does not create synthetic cash in this platform layer. A wallet represents balances held by a connected provider/account. Real custody or deposits require a regulated provider/partner and are intentionally outside this migration.

Authoritative financial amounts are stored in PostgreSQL NUMERIC rather than JavaScript number.

## Instrument model

The Binance catalog represents the current Binance Spot instrument universe returned by exchangeInfo. It is not a claim that every global crypto venue is covered.

Provider trading rules such as tick size, quantity step, minimum quantity and minimum notional are captured so order construction can eventually be validated before submission.

## Execution boundary

The intended live path is:

AI/research -> strategy -> deterministic risk -> order intent -> execution adapter -> venue -> fill events -> reconciliation -> ledger/portfolio.

The AI layer remains outside the execution adapter and cannot directly send money-moving commands.

## Persistence

The SQL migration is the first production-oriented persistence contract. It is not yet wired into server startup. Before live capital, migrations, connection pooling, transaction boundaries, backups, access controls, reconciliation and incident recovery must be implemented and tested against an actual PostgreSQL deployment.

## Next phase

Wire the instrument registry into the terminal UI, add provider-neutral market-data interfaces, build the Binance Spot authenticated account/order adapter, then add a controlled database repository and reconciliation service.
