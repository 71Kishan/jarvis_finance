# Operations Recovery V1

## Backup

Run `./scripts/backup-postgres.sh` from the deployment host. The script uses `pg_dump -Fc`, writes files with restrictive permissions, verifies a non-empty dump, and does not store secrets in Git.

Recommended production practice is an off-host backup schedule plus retention. The repository does not assume a cloud object-storage provider; the deployment environment should supply the durable destination.

## Restore

Never restore over the active database casually. `scripts/restore-postgres.sh` requires `ALLOW_RESTORE=YES` and an explicit `RESTORE` confirmation. A restore must be followed by application health/readiness checks, database migration verification, account-state reconciliation, and order-state reconciliation before any automation is resumed.

## Readiness probe

`scripts/check-readiness.sh` calls `GET /api/readiness` and exits non-zero when infrastructure is not ready. It can be wired into systemd, a container supervisor, or an external uptime/monitoring system.

## Recovery order

1. Preserve evidence: logs, health response, current runtime state, and provider status.
2. Stop automated runtimes before making state-changing repairs.
3. Confirm PostgreSQL and migration integrity.
4. Restore only from a verified backup when required.
5. Run provider reconciliation before treating unknown orders as resolved.
6. Confirm market-data freshness and account-stream health.
7. Confirm strategy validation and forward shadow evidence are still valid for the exact strategy/version.
8. Restart automation deliberately and observe the first processing cycles.

## Trading boundary

Recovery procedures never convert an unknown provider execution into a presumed rejection, cancellation, or fill. `UNKNOWN_RECONCILIATION` remains a first-class state until provider evidence resolves it.

Real-money execution is still disabled in this repository.