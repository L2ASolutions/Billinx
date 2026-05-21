#!/usr/bin/env bash
# create-test-users.sh — seed an admin user and a test tenant user for local dev
# Usage: ADMIN_KEY=<your-admin-key> bash scripts/create-test-users.sh
# Requires: backend running on localhost:3000

set -e

BASE=http://localhost:3000
ADMIN_KEY=${ADMIN_KEY:-billinx-admin-key-change-in-production}

echo "==> Creating admin user..."
curl -sf -X POST "$BASE/v1/admin/users" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -d '{
    "email": "admin@l2asolutions.com",
    "password": "L2AAdmin2026!",
    "firstName": "L2A",
    "lastName": "Admin",
    "role": "SUPER_ADMIN"
  }' && echo "" || echo "(admin user may already exist)"

echo ""
echo "==> Logging in as admin..."
ADMIN_TOKEN=$(curl -sf -X POST "$BASE/v1/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@l2asolutions.com","password":"L2AAdmin2026!"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$ADMIN_TOKEN" ]; then
  echo "ERROR: admin login failed. Check ADMIN_KEY and that the backend is running."
  exit 1
fi
echo "Admin token obtained."

echo ""
echo "==> Submitting test access request..."
curl -sf -X POST "$BASE/v1/users/access-request" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Test Company Ltd",
    "tin": "12345678-0001",
    "contactName": "Test User",
    "email": "testuser@testcompany.ng",
    "phone": "+2348012345678",
    "useCase": "Testing Billinx e-invoicing integration"
  }' && echo "" || echo "(request may already exist)"

echo ""
echo "==> Listing pending access requests..."
REQUEST_ID=$(curl -sf "$BASE/v1/admin/access-requests?status=PENDING" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$REQUEST_ID" ]; then
  echo "No pending requests found (may already be approved). Skipping provision step."
else
  echo "Found request: $REQUEST_ID"

  echo ""
  echo "==> Provisioning tenant from access request..."
  PROVISION=$(curl -sf -X POST "$BASE/v1/admin/access-requests/$REQUEST_ID/provision" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"appAdapterKey":"mock","environment":"SANDBOX","reviewNote":"Test provisioning"}')
  echo "$PROVISION"
  TENANT_ID=$(echo "$PROVISION" | grep -o '"tenantId":"[^"]*"' | cut -d'"' -f4)
fi

echo ""
echo "==> Done."
echo ""
echo "To complete setup, invite testuser@testcompany.ng to the tenant:"
echo "  1. Log into the admin panel at http://localhost:3001/admin/login"
echo "     Email: admin@l2asolutions.com / Password: L2AAdmin2026!"
echo "  2. Find the approved tenant and note its ID"
echo "  3. Or use the API to invite the user:"
echo "     First, get a tenant API key, then:"
echo "     POST /v1/users/invite {\"email\":\"testuser@testcompany.ng\",\"role\":\"OWNER\"}"
echo ""
echo "Business login URL: http://localhost:3001/login"
