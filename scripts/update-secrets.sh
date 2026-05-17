#!/usr/bin/env bash
# update-secrets.sh — Update a single AWS Secrets Manager secret
#
# Usage:
#   ./scripts/update-secrets.sh SECRET_NAME VALUE
#   ./scripts/update-secrets.sh billinx/production/jwt-secret 'my-64-char-secret'
#
# Safe to run multiple times (idempotent).

set -euo pipefail

REGION="${AWS_REGION:-af-south-1}"

if [ $# -lt 2 ]; then
  echo "Usage: $0 SECRET_NAME VALUE"
  echo ""
  echo "Examples:"
  echo "  $0 billinx/production/database-url 'postgresql://billinx:pass@host:5432/billinx'"
  echo "  $0 billinx/production/jwt-secret   '\$(openssl rand -hex 32)'"
  exit 1
fi

SECRET_NAME="$1"
SECRET_VALUE="$2"

echo "→ Updating secret: ${SECRET_NAME}"

aws secretsmanager put-secret-value \
  --secret-id "${SECRET_NAME}" \
  --secret-string "${SECRET_VALUE}" \
  --region "${REGION}" \
  > /dev/null

echo "  Updated successfully."
