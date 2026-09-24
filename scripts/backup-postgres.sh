#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_USER:=jarvis}"
: "${POSTGRES_DB:=jarvis_finance}"
: "${POSTGRES_SERVICE:=postgres}"
: "${BACKUP_DIR:=./backups}"

mkdir -p "$BACKUP_DIR"
umask 077

timestamp="$(date -u +%Y%m%d_%H%M%S)"
output="$BACKUP_DIR/jarvis_${timestamp}.dump"

echo "Creating PostgreSQL backup: $output"
docker compose exec -T "$POSTGRES_SERVICE" pg_dump   -U "$POSTGRES_USER"   -d "$POSTGRES_DB"   -Fc > "$output"

test -s "$output"
echo "Backup written successfully: $output"
