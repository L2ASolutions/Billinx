#!/usr/bin/env bash
# health-check.sh — Hit the /health endpoint and report database + Redis status
#
# Usage:
#   ./scripts/health-check.sh https://api.billinx.ng
#   ALB_URL=https://api.billinx.ng ./scripts/health-check.sh

set -euo pipefail

BASE_URL="${1:-${ALB_URL:-}}"

if [ -z "${BASE_URL}" ]; then
  echo "Usage: $0 https://api.billinx.ng"
  echo "   or: ALB_URL=https://api.billinx.ng $0"
  exit 1
fi

HEALTH_URL="${BASE_URL%/}/health"

echo "→ Checking health: ${HEALTH_URL}"
echo ""

HTTP_CODE=$(curl -s -o /tmp/billinx_health.json -w "%{http_code}" \
  "${HEALTH_URL}" --max-time 15 || echo "000")

if [ "${HTTP_CODE}" = "000" ]; then
  echo "ERROR: Could not connect to ${HEALTH_URL}"
  exit 1
fi

echo "HTTP Status: ${HTTP_CODE}"
echo ""

if command -v jq &>/dev/null; then
  cat /tmp/billinx_health.json | jq .
else
  cat /tmp/billinx_health.json
fi

echo ""

STATUS=$(cat /tmp/billinx_health.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")
DB=$(cat /tmp/billinx_health.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('database','unknown'))" 2>/dev/null || echo "unknown")
REDIS=$(cat /tmp/billinx_health.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('redis','unknown'))" 2>/dev/null || echo "unknown")

echo "Overall:  ${STATUS}"
echo "Database: ${DB}"
echo "Redis:    ${REDIS}"

if [ "${HTTP_CODE}" = "200" ] && [ "${STATUS}" = "ok" ]; then
  echo ""
  echo "✓ Health check passed"
  exit 0
else
  echo ""
  echo "✗ Health check failed (HTTP ${HTTP_CODE}, status=${STATUS})"
  exit 1
fi
