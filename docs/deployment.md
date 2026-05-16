# Billinx — AWS Deployment Runbook

**Region:** af-south-1 (Cape Town)  
**Stack:** ECS Fargate · PostgreSQL 15 (RDS) · Redis 7 (ElastiCache) · ALB · ECR  
**IaC:** Terraform 1.6+ · modules in `infra/`  
**CI/CD:** GitHub Actions (`deploy.yml`)

---

## Required GitHub Secrets

Configure these in GitHub → Settings → Secrets and variables → Actions:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM access key for GitHub Actions deploys |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key for GitHub Actions deploys |
| `AWS_ACCOUNT_ID` | 12-digit AWS account number |
| `ECR_REPOSITORY` | ECR repository name (e.g. `billinx-api`) |
| `ECS_CLUSTER` | ECS cluster name (e.g. `billinx-production`) |
| `ECS_SERVICE` | ECS service name (e.g. `billinx-api`) |
| `ECS_TASK_DEFINITION` | Task definition family name (e.g. `billinx-api`) |
| `ECS_PRIVATE_SUBNETS` | Comma-separated private subnet IDs |
| `ECS_SECURITY_GROUP` | ECS task security group ID |
| `ALB_DNS_NAME` | ALB DNS name (from terraform output) |

The GitHub Actions IAM user needs these permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["ecr:GetAuthorizationToken"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["ecr:BatchCheckLayerAvailability","ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage","ecr:PutImage","ecr:InitiateLayerUpload","ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"], "Resource": "arn:aws:ecr:af-south-1:ACCOUNT:repository/billinx-api" },
    { "Effect": "Allow", "Action": ["ecs:DescribeServices","ecs:DescribeTaskDefinition",
        "ecs:DescribeTasks","ecs:RegisterTaskDefinition","ecs:UpdateService","ecs:RunTask",
        "ecs:ListTasks"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["iam:PassRole"],
      "Resource": ["arn:aws:iam::ACCOUNT:role/billinx-production-ecs-*"] }
  ]
}
```

---

## Prerequisites

Install these tools before proceeding:

```bash
# AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip awscliv2.zip && sudo ./aws/install

# Terraform >= 1.6
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install terraform

# Verify
aws --version       # >= 2.0
terraform version   # >= 1.6
```

Configure AWS CLI:
```bash
aws configure
# AWS Access Key ID: <your key>
# AWS Secret Access Key: <your secret>
# Default region name: af-south-1
# Default output format: json
```

---

## First Deployment (Step by Step)

### Step 1 — Bootstrap AWS resources

```bash
cd /path/to/billinx
chmod +x scripts/*.sh
./scripts/setup-aws.sh
```

This creates the ECR repository, CloudWatch log groups, and all Secrets Manager entries with placeholder values. **Safe to re-run.**

### Step 2 — Populate all secrets

Replace every `PLACEHOLDER` with real values. Generate strong secrets where noted:

```bash
# Database URL (fill in after terraform apply — you'll have the RDS endpoint)
./scripts/update-secrets.sh billinx/production/database-url \
  "postgresql://billinx:YOUR_DB_PASSWORD@RDS_ENDPOINT:5432/billinx"

# JWT secrets (generate with: openssl rand -hex 32)
./scripts/update-secrets.sh billinx/production/jwt-secret \
  "$(openssl rand -hex 32)"

./scripts/update-secrets.sh billinx/production/admin-jwt-secret \
  "$(openssl rand -hex 32)"

# Master encryption key — 64-char hex (32 bytes). BACK THIS UP — data encrypted with it
# cannot be decrypted without it.
./scripts/update-secrets.sh billinx/production/encryption-key \
  "$(openssl rand -hex 32)"

# Admin API key — generate a key then store its bcrypt hash
ADMIN_KEY=$(openssl rand -base64 32)
echo "Save this admin key somewhere safe: ${ADMIN_KEY}"
ADMIN_HASH=$(node -e "const bcrypt=require('bcrypt'); bcrypt.hash('${ADMIN_KEY}', 12).then(h=>console.log(h))")
./scripts/update-secrets.sh billinx/production/admin-api-key "${ADMIN_HASH}"
./scripts/update-secrets.sh billinx/production/admin-key-hash "${ADMIN_HASH}"

# AWS SES credentials (create a dedicated IAM user with SES send permissions)
./scripts/update-secrets.sh billinx/production/aws-ses-key    "AKIAXXXXXXXXXXXXXXXX"
./scripts/update-secrets.sh billinx/production/aws-ses-secret "your-ses-secret-key"

# JWT RSA keys (for SecretsService.getJwtPrivateKey())
openssl genrsa -out /tmp/jwt_private.pem 2048
openssl rsa -in /tmp/jwt_private.pem -pubout -out /tmp/jwt_public.pem
./scripts/update-secrets.sh billinx/production/jwt-private-key "$(cat /tmp/jwt_private.pem)"
./scripts/update-secrets.sh billinx/production/jwt-public-key  "$(cat /tmp/jwt_public.pem)"
rm /tmp/jwt_private.pem /tmp/jwt_public.pem  # Never leave key files on disk

# CAC API key
./scripts/update-secrets.sh billinx/production/cac-api-key "your-cac-bearer-token"

# NRS API base URL (confirm with Interswitch/NRS)
./scripts/update-secrets.sh billinx/production/nrs-api-base-url \
  "https://api.interswitchgroup.com"

# Interswitch base URL
./scripts/update-secrets.sh billinx/production/interswitch-base-url \
  "https://api.interswitchgroup.com"

# Redis URL — fill in after ElastiCache is provisioned in Step 4
# ./scripts/update-secrets.sh billinx/production/redis-url \
#   "rediss://:YOUR_REDIS_AUTH_TOKEN@ELASTICACHE_ENDPOINT:6379"
```

### Step 3 — Request ACM Certificate

```bash
# Request a certificate for your API domain
aws acm request-certificate \
  --domain-name api.billinx.ng \
  --subject-alternative-names "*.billinx.ng" \
  --validation-method DNS \
  --region af-south-1

# Output the certificate ARN — add it to terraform.tfvars
```

Add the DNS validation CNAME records to your DNS provider. Wait for status to become `ISSUED` (5-15 minutes):

```bash
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:af-south-1:ACCOUNT:certificate/CERT-ID \
  --region af-south-1 \
  --query "Certificate.Status"
```

### Step 4 — Configure and Apply Terraform

```bash
cd infra

# Copy example and fill in real values
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars:
# - aws_account_id = "123456789012"
# - domain_name    = "api.billinx.ng"
# - certificate_arn = "arn:aws:acm:..."
# - db_password     = "strong-password-here"
# - redis_auth_token = "strong-token-here"
# - alert_email     = "devops@l2asolutions.com"

terraform init
terraform plan -out=tfplan   # Review carefully
terraform apply tfplan
```

Note the outputs — you'll need them in subsequent steps:
```
alb_dns_name           = "billinx-production-alb-xxxxxx.af-south-1.elb.amazonaws.com"
ecr_repository_url     = "ACCOUNT.dkr.ecr.af-south-1.amazonaws.com/billinx-api"
ecs_cluster_name       = "billinx-production"
ecs_service_name       = "billinx-api"
rds_endpoint           = "billinx-production.xxxxx.af-south-1.rds.amazonaws.com:5432"
redis_primary_endpoint = "billinx-production.xxxxx.cfg.afs1.cache.amazonaws.com"
```

### Step 5 — Update Database and Redis URLs

Now that you have the RDS and ElastiCache endpoints from Terraform outputs:

```bash
./scripts/update-secrets.sh billinx/production/database-url \
  "postgresql://billinx:YOUR_DB_PASSWORD@$(terraform output -raw rds_endpoint | cut -d: -f1):5432/billinx"

./scripts/update-secrets.sh billinx/production/redis-url \
  "rediss://:YOUR_REDIS_AUTH_TOKEN@$(terraform output -raw redis_primary_endpoint):6379"
```

### Step 6 — Configure DNS

Point your domain to the ALB:

**Option A — CNAME record** (if your DNS provider doesn't support ALIAS):
```
api.billinx.ng  CNAME  billinx-production-alb-xxxxxx.af-south-1.elb.amazonaws.com
```

**Option B — Route 53 Alias** (if using Route 53):
```bash
# Get zone ID and ALB zone ID from terraform outputs
# Create an A record with alias pointing to the ALB
```

### Step 7 — Push First Image and Run Migrations

```bash
# Build and push initial image
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URL="${AWS_ACCOUNT_ID}.dkr.ecr.af-south-1.amazonaws.com/billinx-api"

aws ecr get-login-password --region af-south-1 | \
  docker login --username AWS --password-stdin "${ECR_URL}"

docker build -t "${ECR_URL}:latest" .
docker push "${ECR_URL}:latest"

# Run migrations (fill in subnet and security group from terraform outputs)
export ECS_CLUSTER=billinx-production
export ECS_SERVICE=billinx-api
export ECS_SUBNETS="subnet-xxx,subnet-yyy"       # from terraform output private_subnet_ids
export ECS_SECURITY_GROUP="sg-xxx"                # ECS security group ID

./scripts/run-migrations.sh
```

### Step 8 — Force a new deployment

```bash
aws ecs update-service \
  --cluster billinx-production \
  --service billinx-api \
  --force-new-deployment \
  --region af-south-1
```

### Step 9 — Verify deployment

```bash
./scripts/health-check.sh https://api.billinx.ng
```

Expected output:
```json
{ "status": "ok", "database": "connected", "redis": "connected" }
```

### Step 10 — Configure GitHub Secrets

Add all secrets listed in the [Required GitHub Secrets](#required-github-secrets) section above.

From this point, every merge to `main` triggers an automatic deploy.

---

## Ongoing Deployments

1. Merge a PR to `main`
2. GitHub Actions runs: `test → build-and-push → migrate → deploy`
3. Monitor in GitHub → Actions → Deploy to Production
4. Verify with `./scripts/health-check.sh https://api.billinx.ng`

Each deploy:
- Tags the image with the git SHA (`sha-<commit>`) and `latest`
- Runs `prisma migrate deploy` via ECS run-task before updating the service
- Updates the ECS task definition to use the new image
- Waits up to 10 minutes for service stability
- Verifies `/health` returns 200

---

## Rollback Procedure

### Application rollback (fast — ~2 minutes)

```bash
# List recent task definition revisions
aws ecs list-task-definitions \
  --family-prefix billinx-api \
  --sort DESC \
  --region af-south-1

# Roll back to a specific revision
aws ecs update-service \
  --cluster billinx-production \
  --service billinx-api \
  --task-definition billinx-api:N   # N = revision number to roll back to
  --region af-south-1

aws ecs wait services-stable \
  --cluster billinx-production \
  --services billinx-api \
  --region af-south-1
```

### Database migration rollback

Prisma does not support automatic down-migrations. To revert a schema change:

1. Write a new migration that reverses the change: `npx prisma migrate dev --name revert_xxx`
2. Push the revert migration via the normal deploy pipeline, OR
3. Run it manually: `./scripts/run-migrations.sh`

**Do not** modify the `_prisma_migrations` table manually.

---

## Monitoring

### CloudWatch Alarms

These alarms notify the `billinx-alerts` SNS topic (and optionally your email):

| Alarm | Threshold | Action |
|-------|-----------|--------|
| ECS CPU high | >80% for 5 min | Check for traffic spike; scale desired_count in Terraform |
| ECS Memory high | >80% for 5 min | Increase task memory (task_memory variable) |
| ALB 5xx errors | >10 in 5 min | Check ECS task logs in CloudWatch |
| RDS CPU high | >80% for 5 min | Check slow queries; scale instance class |

### Key Metrics to Watch

```bash
# Tail ECS task logs
aws logs tail /ecs/billinx-api --follow --region af-south-1

# Check ECS service events
aws ecs describe-services \
  --cluster billinx-production \
  --services billinx-api \
  --query "services[0].events[:5]" \
  --region af-south-1

# RDS free storage remaining
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name FreeStorageSpace \
  --dimensions Name=DBInstanceIdentifier,Value=billinx-production \
  --start-time $(date -d '1 hour ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 --statistics Average \
  --region af-south-1
```

---

## Environment Variables Reference

Every variable the application needs, where it comes from, and the Secrets Manager key it maps to:

| Env Var | Source | Secrets Manager Key | Notes |
|---------|--------|---------------------|-------|
| `NODE_ENV` | ECS task env | — | Hard-coded `production` |
| `PORT` | ECS task env | — | Hard-coded `3000` |
| `AWS_REGION` | ECS task env | — | `af-south-1` |
| `AWS_SES_REGION` | ECS task env | — | `us-east-1` |
| `DATABASE_URL` | Secrets Manager → ECS env | `billinx/production/database-url` | Full PostgreSQL URL |
| `JWT_SECRET` | Secrets Manager → ECS env | `billinx/production/jwt-secret` | 64-char hex |
| `ADMIN_JWT_SECRET` | Secrets Manager → ECS env | `billinx/production/admin-jwt-secret` | 64-char hex |
| `REDIS_URL` | Secrets Manager → ECS env | `billinx/production/redis-url` | `rediss://:TOKEN@HOST:6379` |
| `AWS_ACCESS_KEY_ID` | Secrets Manager → ECS env | `billinx/production/aws-ses-key` | SES IAM user |
| `AWS_SECRET_ACCESS_KEY` | Secrets Manager → ECS env | `billinx/production/aws-ses-secret` | SES IAM user |
| `CAC_API_KEY` | Secrets Manager → ECS env | `billinx/production/cac-api-key` | CAC bearer token |
| `MASTER_KEY_SECRET_ID` | Secrets Manager → ECS env | `billinx/production/encryption-key` | The app fetches *this secret* at runtime |
| `ADMIN_KEY_SECRET_ID` | Secrets Manager → ECS env | `billinx/production/admin-api-key` | The app fetches *this secret* at runtime |
| `JWT_PRIVATE_KEY_SECRET_ID` | Secrets Manager → ECS env | `billinx/production/jwt-private-key` | The app fetches *this secret* at runtime |
| `JWT_PUBLIC_KEY_SECRET_ID` | Secrets Manager → ECS env | `billinx/production/jwt-public-key` | The app fetches *this secret* at runtime |
| `MFA_ISSUER` | ECS task env | — | `Billinx` |
| `APP_BASE_URL` | ECS task env | — | `https://api.billinx.ng` |
| `EMAIL_FROM` | ECS task env | — | `Billinx <noreply@billinx.ng>` |
| `INTERSWITCH_PROD_URL` | ECS task env | — | Interswitch production URL |
| `CAC_API_BASE_URL` | ECS task env | — | CAC API base URL |

### How Secrets Manager layering works

The ECS execution role fetches secrets and injects them as env vars **before the container starts**. For some secrets (encryption key, JWT keys), the *env var contains the Secrets Manager secret name*, not the value itself. The `SecretsService` then fetches those at runtime with a 5-minute cache.

This two-layer pattern means you can rotate the encryption key or JWT keys without redeploying — just update the secret and wait up to 5 minutes for the cache to expire.

---

## Scaling Up from MVP

When traffic grows, scale these in `terraform.tfvars` and re-apply:

| Setting | MVP | Production |
|---------|-----|------------|
| `desired_count` | 1 | 2-4 |
| `db_instance_class` | `db.t3.micro` | `db.t3.small` / `db.t3.medium` |
| `redis_node_type` | `cache.t3.micro` | `cache.t3.small` |
| RDS `multi_az` | `false` | `true` (edit in rds/main.tf) |

Add Auto Scaling to ECS by adding `aws_appautoscaling_target` and `aws_appautoscaling_policy` resources to the ECS module.
