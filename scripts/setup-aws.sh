#!/usr/bin/env bash
# setup-aws.sh — Bootstrap AWS resources for Billinx before running terraform apply
# Run once per environment. Safe to re-run (idempotent).
#
# Prerequisites:
#   - AWS CLI installed and configured (aws configure)
#   - Correct AWS account and region set
#   - IAM permissions: ecr:*, secretsmanager:*, logs:CreateLogGroup

set -euo pipefail

REGION="${AWS_REGION:-af-south-1}"
APP="billinx"
ENV="${ENVIRONMENT:-production}"
PREFIX="${APP}/${ENV}"

echo "========================================================"
echo "  Billinx AWS Bootstrap"
echo "  Region:      ${REGION}"
echo "  Environment: ${ENV}"
echo "========================================================"
echo ""

# ── Verify AWS access ─────────────────────────────────────────────────────────

echo "→ Verifying AWS credentials..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "ERROR: AWS credentials not configured. Run: aws configure"
  exit 1
}
echo "  Account ID:  ${ACCOUNT_ID}"
echo ""

# ── ECR Repository ────────────────────────────────────────────────────────────

REPO_NAME="${APP}-api"
echo "→ Ensuring ECR repository: ${REPO_NAME}"

if aws ecr describe-repositories --repository-names "${REPO_NAME}" --region "${REGION}" &>/dev/null; then
  echo "  Repository already exists."
else
  aws ecr create-repository \
    --repository-name "${REPO_NAME}" \
    --region "${REGION}" \
    --image-tag-mutability MUTABLE \
    --image-scanning-configuration scanOnPush=true \
    --tags Key=App,Value="${APP}" Key=Environment,Value="${ENV}" Key=ManagedBy,Value=terraform
  echo "  Created repository: ${REPO_NAME}"
fi

ECR_URL="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"
echo "  ECR URL: ${ECR_URL}"
echo ""

# ── CloudWatch Log Groups ─────────────────────────────────────────────────────

echo "→ Ensuring CloudWatch log groups..."

for LOG_GROUP in "/ecs/${APP}-api" "/${APP}/application"; do
  if aws logs describe-log-groups --log-group-name-prefix "${LOG_GROUP}" --region "${REGION}" \
      --query "logGroups[?logGroupName=='${LOG_GROUP}'].logGroupName" --output text | grep -q "${LOG_GROUP}"; then
    echo "  Log group exists: ${LOG_GROUP}"
  else
    aws logs create-log-group \
      --log-group-name "${LOG_GROUP}" \
      --region "${REGION}"
    echo "  Created log group: ${LOG_GROUP}"
  fi
done
echo ""

# ── Secrets Manager Entries ───────────────────────────────────────────────────

echo "→ Ensuring Secrets Manager entries (placeholder values)..."

create_secret_if_missing() {
  local name="$1"
  local description="$2"

  if aws secretsmanager describe-secret --secret-id "${name}" --region "${REGION}" &>/dev/null; then
    echo "  Exists: ${name}"
  else
    aws secretsmanager create-secret \
      --name "${name}" \
      --description "${description}" \
      --secret-string "PLACEHOLDER — update with update-secrets.sh" \
      --region "${REGION}" \
      --tags Key=App,Value="${APP}" Key=Environment,Value="${ENV}" Key=ManagedBy,Value=bootstrap \
      > /dev/null
    echo "  Created: ${name}"
  fi
}

create_secret_if_missing "${PREFIX}/database-url"         "Full PostgreSQL connection URL"
create_secret_if_missing "${PREFIX}/jwt-secret"           "JWT signing secret for user sessions"
create_secret_if_missing "${PREFIX}/admin-jwt-secret"     "JWT signing secret for admin sessions"
create_secret_if_missing "${PREFIX}/encryption-key"       "AES-256-GCM master key (64-char hex)"
create_secret_if_missing "${PREFIX}/admin-api-key"        "bcrypt hash of platform admin API key"
create_secret_if_missing "${PREFIX}/jwt-private-key"      "RSA private key for JWT signing"
create_secret_if_missing "${PREFIX}/jwt-public-key"       "RSA public key for JWT verification"
create_secret_if_missing "${PREFIX}/admin-key-hash"       "bcrypt hash of L2A admin panel key"
create_secret_if_missing "${PREFIX}/aws-ses-key"          "AWS IAM access key for SES"
create_secret_if_missing "${PREFIX}/aws-ses-secret"       "AWS IAM secret key for SES"
create_secret_if_missing "${PREFIX}/interswitch-base-url" "Interswitch NRS production API base URL"
create_secret_if_missing "${PREFIX}/redis-url"            "Redis TLS connection URL"
create_secret_if_missing "${PREFIX}/cac-api-key"          "CAC API bearer token"
create_secret_if_missing "${PREFIX}/nrs-api-base-url"     "NRS e-invoicing API base URL"
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

echo "========================================================"
echo "  Bootstrap complete!"
echo "========================================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Update ALL secrets with real values:"
echo "     ./scripts/update-secrets.sh ${PREFIX}/database-url 'postgresql://...'"
echo "     ./scripts/update-secrets.sh ${PREFIX}/jwt-secret   'your-64-char-secret'"
echo "     (etc. — see docs/deployment.md for full list)"
echo ""
echo "  2. Request an ACM certificate for your domain in ${REGION}:"
echo "     aws acm request-certificate --domain-name api.billinx.ng \\"
echo "       --validation-method DNS --region ${REGION}"
echo ""
echo "  3. Copy infra/terraform.tfvars.example to infra/terraform.tfvars"
echo "     and fill in all required values (account ID, cert ARN, passwords)."
echo ""
echo "  4. Run Terraform:"
echo "     cd infra && terraform init && terraform plan && terraform apply"
echo ""
echo "  ECR URL: ${ECR_URL}"
echo "  Account: ${ACCOUNT_ID}"
