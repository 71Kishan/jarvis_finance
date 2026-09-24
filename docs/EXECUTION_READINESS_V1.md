# Execution Readiness V1

## Spot venue boundary

Binance Spot instruments are explicitly marked `shortable=false`. A Spot account represents asset custody through balances; leveraged/margin positions are not inferred from balances. The Spot adapter rejects `reduceOnly` because that semantic is not silently mapped onto Spot.

Research strategies may still contain LONG/SHORT paper trades for strategy study. That research representation is not an authorization to submit a short order to Spot.

## Order idempotency

Sandbox order reservation now uses a unique `(account_id, idempotency_key)` index plus an exact intent fingerprint. Reusing a key with a different request is rejected instead of replaying the first order.

Provider execution remains testnet-only. An uncertain provider submission is persisted as `UNKNOWN_RECONCILIATION` rather than treated as a rejected or canceled order.

## State transitions

Persisted order status mutations are checked against the canonical state machine. `PENDING_SUBMIT -> SUBMISSION_FAILED` is the explicit pre-submit failure path. Terminal states cannot be silently resurrected.

## Readiness vs safety

`GET /api/health` is a liveness/diagnostic surface. `GET /api/readiness` reports whether core infrastructure dependencies are available.

Readiness does not mean trading is safe. Strategy evidence, forward shadow validation, portfolio risk controls, reconciliation, operational monitoring, and the final execution safety gate remain separate conditions.

## Recovery

PostgreSQL data is persistent in the deployment volume. Before any production-money phase, scheduled off-host database backups and a tested restore procedure are required. A backup that has never been restored is not considered verified.

Example manual backup:

    docker compose exec -T postgres pg_dump -U jarvis -d jarvis_finance -Fc > backups/jarvis_$(date +%Y%m%d_%H%M%S).dump

Example restore to a disposable database:

    pg_restore --clean --if-exists --dbname=jarvis_finance_restore backups/<dump-file>.dump

The exact database user/database name must match deployment environment configuration; do not hard-code production secrets into the repository.

## Live-money boundary

Real-money order submission remains disabled. A future live-money gate must be a separate, explicit change after execution compatibility, reconciliation, alerting, backup/restore, and extended forward evidence have all been demonstrated.
## Strategy deployment

The strategy deployment control plane is separate from order submission. A server-recomputed, provisionally validated research run must be explicitly deployed before the shadow runtime can use it. This deployment is durable, auditable, and limited to the SHADOW environment. There is no equivalent live-money deployment record in this phase.