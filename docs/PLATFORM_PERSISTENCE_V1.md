# Jarvis Finance — Platform Persistence V1

This phase makes PostgreSQL a real runtime component instead of leaving the platform schema as documentation only.

## What is now persisted

The server can persist the canonical Binance Spot instrument catalog into PostgreSQL and exposes the database health state separately from market-data health.

The persistence layer also provides provider-neutral repository primitives for Jarvis users, connected-account records and audit events. Money-moving account credentials are still not stored by the repository; the account table contains a secret_ref that will point to an external secret manager later.

## Migration safety

Migrations are discovered from db/migrations, applied in filename order, and recorded in jarvis_schema_migrations.

Each applied migration is stored with a SHA-256 checksum. Editing an already-applied migration causes the server to reject the migration run rather than silently changing production schema history.

A PostgreSQL advisory lock serializes migration execution across multiple Jarvis server instances.

## Failure behavior

DATABASE_URL is optional during the current research/paper stage. Without it, Jarvis reports the database as DISABLED and the existing paper runtime continues to use its separate durable local snapshot.

When DATABASE_URL is configured, Jarvis attempts the database connection and migration at startup. JARVIS_DB_REQUIRED=true converts database initialization failure into a server-start failure; the default remains false while live execution is disabled.

The market-data catalog does not pretend to be healthy because the database is healthy. Database persistence failures are reported separately.

## Local Docker stack

docker-compose.yml now contains PostgreSQL 16 alongside the Jarvis server. The database volume is persistent, and the Jarvis server waits for a healthy PostgreSQL container before starting.

Set a strong POSTGRES_PASSWORD in the deployment .env file. Do not commit production passwords or connection strings.

## Session model

user_sessions stores an opaque-session token hash, expiry, revocation state, and minimal request metadata. Actual login, refresh, device binding, CSRF protection, and authentication UX are deliberately not implemented in this phase.

That separation matters: the session storage contract exists, but an unauthenticated endpoint must not be mistaken for real access control.

## Not enabled yet

There is still no authenticated Binance order adapter, no live-money order submission, and no withdrawal/custody workflow. Real execution remains a later gate after sandbox validation, idempotency, reconciliation, monitoring and independent review.
