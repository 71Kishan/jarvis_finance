#!/usr/bin/env bash
set -euo pipefail

: "${JARVIS_BASE_URL:=http://localhost:3000}"

status="$(curl -fsS -o /tmp/jarvis-readiness.json -w '%{http_code}' "$JARVIS_BASE_URL/api/readiness" || true)"

if [[ "$status" == "200" ]]; then
  cat /tmp/jarvis-readiness.json
  echo
  exit 0
fi

echo "Jarvis readiness check failed with HTTP $status"
cat /tmp/jarvis-readiness.json 2>/dev/null || true
echo
exit 1
