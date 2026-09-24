#!/usr/bin/env bash
set -euo pipefail

if [[ "${ALLOW_RESTORE:-}" != "YES" ]]; then
  echo "Refusing restore. Set ALLOW_RESTORE=YES explicitly."
  exit 2
fi

if [[ "${1:-}" == "" ]]; then
  echo "Usage: ALLOW_RESTORE=YES ./scripts/restore-postgres.sh backups/file.dump"
  exit 2
fi

: "${POSTGRES_USER:=jarvis}"
: "${POSTGRES_DB:=jarvis_finance}"
: "${POSTGRES_SERVICE:=postgres}"

dump_file="$1"
test -s "$dump_file"

echo "WARNING: restoring over PostgreSQL database $POSTGRES_DB."
echo "The dump must come from the same Jarvis schema family."
read -r -p "Type RESTORE to continue: " confirmation
[[ "$confirmation" == "RESTORE" ]]

docker compose exec -T "$POSTGRES_SERVICE" pg_restore   -U "$POSTGRES_USER"   -d "$POSTGRES_DB"   --clean   --if-exists   < "$dump_file"

echo "Restore command completed. Verify /api/health and the critical account/order invariants before resuming automation."
