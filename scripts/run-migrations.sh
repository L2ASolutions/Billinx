#!/usr/bin/env bash
# run-migrations.sh — Run Prisma migrate deploy via an ECS run-task
#
# Usage:
#   ./scripts/run-migrations.sh
#
# Required env vars (or pass as arguments):
#   ECS_CLUSTER        — ECS cluster name
#   ECS_SERVICE        — ECS service name (to find the task definition)
#   ECS_SUBNETS        — Comma-separated private subnet IDs
#   ECS_SECURITY_GROUP — ECS security group ID
#
# Or pass directly:
#   CLUSTER=billinx-production SUBNETS=subnet-xxx,subnet-yyy SG=sg-xxx ./scripts/run-migrations.sh

set -euo pipefail

REGION="${AWS_REGION:-af-south-1}"
CLUSTER="${ECS_CLUSTER:-billinx-production}"
SERVICE="${ECS_SERVICE:-billinx-api}"
SUBNETS="${ECS_SUBNETS:-}"
SG="${ECS_SECURITY_GROUP:-}"

if [ -z "${SUBNETS}" ] || [ -z "${SG}" ]; then
  echo "ERROR: ECS_SUBNETS and ECS_SECURITY_GROUP must be set."
  echo ""
  echo "Example:"
  echo "  export ECS_SUBNETS=subnet-abc123,subnet-def456"
  echo "  export ECS_SECURITY_GROUP=sg-abc123"
  echo "  ./scripts/run-migrations.sh"
  exit 1
fi

echo "→ Looking up current task definition for service: ${SERVICE}..."
TASK_DEF_ARN=$(aws ecs describe-services \
  --cluster "${CLUSTER}" \
  --services "${SERVICE}" \
  --region "${REGION}" \
  --query "services[0].taskDefinition" \
  --output text)

echo "  Task definition: ${TASK_DEF_ARN}"
echo ""
echo "→ Starting migration task..."

TASK_ARN=$(aws ecs run-task \
  --cluster "${CLUSTER}" \
  --task-definition "${TASK_DEF_ARN}" \
  --launch-type FARGATE \
  --region "${REGION}" \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SG}],assignPublicIp=DISABLED}" \
  --overrides "{
    \"containerOverrides\": [{
      \"name\": \"billinx-api\",
      \"command\": [\"node\", \"node_modules/.bin/prisma\", \"migrate\", \"deploy\"]
    }]
  }" \
  --query "tasks[0].taskArn" \
  --output text)

echo "  Migration task ARN: ${TASK_ARN}"
echo ""
echo "→ Waiting for migration to complete (this may take 1-2 minutes)..."

aws ecs wait tasks-stopped \
  --cluster "${CLUSTER}" \
  --tasks "${TASK_ARN}" \
  --region "${REGION}"

EXIT_CODE=$(aws ecs describe-tasks \
  --cluster "${CLUSTER}" \
  --tasks "${TASK_ARN}" \
  --region "${REGION}" \
  --query "tasks[0].containers[0].exitCode" \
  --output text)

if [ "${EXIT_CODE}" = "0" ]; then
  echo "  Migrations completed successfully (exit code: 0)"
else
  echo "ERROR: Migration task exited with code ${EXIT_CODE}"
  echo ""
  echo "Check CloudWatch logs:"
  echo "  aws logs filter-log-events \\"
  echo "    --log-group-name /ecs/billinx-api \\"
  echo "    --region ${REGION} \\"
  echo "    --start-time \$(date -d '10 minutes ago' +%s000)"
  exit 1
fi
