# Billinx — AWS Deployment Runbook

**Region:** af-south-1 (Cape Town)  
**Stack:** ECS Fargate · PostgreSQL 15 (RDS) · Redis 7 (ElastiCache) · ALB · ECR  
**IaC:** Terraform 1.6+ · modules in `infra/`  
**CI/CD:** GitHub Actions (`deploy.yml`)

---

## Redis Persistence Configuration

### Why it is required

Billinx uses BullMQ for async FIRS submission. BullMQ stores pending and in-progress jobs in Redis. Without persistence, a Redis restart (power failure, ECS task replacement, ElastiCache failover) drops all queued jobs. Invoices that were `QUEUED` or `SUBMITTING` are left stranded — no jobs exist to process them.

With AOF (Append-Only File) persistence enabled, Redis writes every command to disk before acknowledging it (`appendfsync everysec` writes at most 1 second behind). On restart, the AOF log is replayed and all jobs are restored exactly.

### Local development (docker-compose)

Redis is already configured with `--appendonly yes --appendfsync everysec` in `docker-compose.yml`. The `redis_data` Docker volume persists the AOF file across container restarts. No action needed.

### AWS ElastiCache (production)

ElastiCache does not support arbitrary `redis.conf` flags via the command line. Persistence must be enabled via a **parameter group**:

1. In the AWS Console → ElastiCache → Parameter Groups, create a new group based on `redis7`.
2. Set `appendonly = yes`.
3. Set `appendfsync = everysec`.
4. Attach the parameter group to your ElastiCache cluster (requires a cluster reboot on first attach).
5. Verify with: `redis-cli CONFIG GET appendonly` → should return `yes`.

**Important**: ElastiCache AOF is node-local. For cluster-mode disabled (single-node), AOF ensures job durability across node restarts. For Multi-AZ with auto-failover, the replica is promoted and data is replicated — AOF on the replica also applies.

### Verifying persistence is enabled

```bash
redis-cli -h <host> -p 6379 CONFIG GET appendonly
# Expected: appendonly → yes

redis-cli -h <host> -p 6379 CONFIG GET appendfsync
# Expected: appendfsync → everysec
```

### What happens if Redis loses data mid-processing

| Scenario | Effect | Recovery |
|----------|--------|----------|
| Redis restart with AOF enabled | Jobs replayed from AOF log; in-flight jobs re-queued after visibility timeout | Automatic — no action needed |
| Redis restart without AOF | All `QUEUED` jobs lost; invoices stay `QUEUED` in DB with no worker | Run `POST /v1/admin/recovery/run` to re-queue stuck invoices |
| Invoice stuck in `SUBMITTING` > 5 min | Recovery service resets to `QUEUED` automatically (cron every 30 min) | Automatic — or trigger manually via admin endpoint |
| ECS task killed mid-submission | Invoice left in `SUBMITTING`; recovery service detects and re-queues | Automatic within 30 min, or immediately via `POST /v1/admin/recovery/run` |

### Power failure recovery endpoints

- `POST /v1/admin/recovery/run` — immediately reset all stuck `SUBMITTING` invoices to `QUEUED` and re-queue them
- `GET /v1/invoices/check?sourceReference=INV001` — ERP systems call this after power returns to check if an invoice was already received

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
# See "JWT RSA Key Pair" section below for full details
openssl genrsa -out /tmp/jwt_private.pem 2048
openssl rsa -in /tmp/jwt_private.pem -pubout -out /tmp/jwt_public.pem
./scripts/update-secrets.sh billinx/production/jwt-private-key "$(cat /tmp/jwt_private.pem)"
./scripts/update-secrets.sh billinx/production/jwt-public-key  "$(cat /tmp/jwt_public.pem)"
rm -f /tmp/jwt_private.pem /tmp/jwt_public.pem  # Never leave key files on disk

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

---

## JWT RSA Key Pair

Billinx uses RS256 (RSA + SHA-256) for JWT signing. The private key signs tokens; the public key verifies them. **The private key is a production secret — treat it like a database password.**

### Generating the key pair

```bash
# Generate a 2048-bit RSA private key
openssl genrsa -out private.key 2048

# Extract the public key
openssl rsa -in private.key -pubout -out public.key

# Verify
openssl rsa -in private.key -check -noout   # "RSA key ok"
```

### Local development

Set the full PEM content in your `.env` file. Use `\n` for newlines or a multiline string:

```bash
# In .env — paste the full content of private.key
JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
...
-----END RSA PRIVATE KEY-----"

# In .env — paste the full content of public.key
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
...
-----END PUBLIC KEY-----"
```

Never commit `private.key` or `public.key` — `.gitignore` blocks `*.key` and `*.pem`.

### Storing in AWS Secrets Manager (production)

```bash
# Store the full PEM content as a single Secrets Manager secret
aws secretsmanager put-secret-value \
  --secret-id billinx/production/jwt-private-key \
  --secret-string "$(cat private.key)" \
  --region af-south-1

aws secretsmanager put-secret-value \
  --secret-id billinx/production/jwt-public-key \
  --secret-string "$(cat public.key)" \
  --region af-south-1

# Delete local key files immediately after uploading
rm -f private.key public.key
```

The `SecretsService` fetches these at startup and caches them for 5 minutes. The ECS task environment variables `JWT_PRIVATE_KEY_SECRET_ID` and `JWT_PUBLIC_KEY_SECRET_ID` tell it which Secrets Manager secrets to fetch.

### Key rotation

1. Generate a new key pair (commands above)
2. Upload the new public key to Secrets Manager — existing tokens continue to work until they expire (access tokens: 15 min)
3. Upload the new private key — all new tokens are signed with the new key
4. Wait 15 minutes for all old tokens to expire naturally
5. Delete local key files

No redeployment needed — the `SecretsService` cache expires every 5 minutes and picks up the new keys automatically.

---

## CLAUDE.md reference content (moved 2026-07-21)

The sections below were moved out of `CLAUDE.md` verbatim (content unchanged)
to keep the main file within a manageable size: environment variable
reference, the Terraform module table, the ops-scripts table, and the GitHub
Actions CI/CD pipeline description.

## Environment Variables

```bash
# App
NODE_ENV=development|production
PORT=3000

# Database
DATABASE_URL=postgresql://...          # app role (billinx_app in production; billinx in dev)
MIGRATION_DATABASE_URL=postgresql://...# owner role (billinx) — used by prisma migrate and asAdmin(); required in production
# For production: append ?connection_limit=10&pool_timeout=20
DB_POOL_SIZE=10

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_URL=                        # takes precedence over HOST/PORT

# JWT — RSA key pair (dev: env vars; prod: AWS Secrets Manager via secret IDs below)
JWT_PRIVATE_KEY=            # dev only — PEM-encoded RSA-2048 private key
JWT_PUBLIC_KEY=             # dev only — matching public key
ADMIN_JWT_SECRET=           # admin portal JWT; separate from user auth
# Token lifetimes — units: s, m, h, d (defaults: 15m / 7d)
JWT_ACCESS_TOKEN_EXPIRY=15m
JWT_REFRESH_TOKEN_EXPIRY=7d

# AWS
AWS_REGION=af-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SES_REGION=us-east-1

# AWS Secrets Manager secret IDs (prod)
JWT_PRIVATE_KEY_SECRET_ID=
JWT_PUBLIC_KEY_SECRET_ID=
MASTER_KEY_SECRET_ID=
ADMIN_KEY_SECRET_ID=

# CORS — required in production; app refuses to start without it
ALLOWED_ORIGINS=https://app.billinx.ng  # comma-separated list of allowed browser origins

# Admin IP allowlist — required in production; guard returns 403 on all /v1/admin/* without it
ADMIN_ALLOWED_IPS=10.0.0.0/8,203.0.113.5  # comma-separated CIDRs or exact IPs

# Email
EMAIL_FROM=Billinx <noreply@billinx.ng>
APP_BASE_URL=https://app.billinx.ng

# MFA
MFA_ISSUER=Billinx

# BullMQ worker concurrency
WORKER_CONCURRENCY=10        # individual submission worker
BULK_WORKER_CONCURRENCY=5    # bulk submission worker (lower priority)

# External APIs
INTERSWITCH_SANDBOX_URL=
INTERSWITCH_PROD_URL=
NRS_API_BASE_URL=
CAC_API_BASE_URL=
CAC_API_KEY=
```

---


## Infrastructure (Terraform)

`infra/` contains full AWS infrastructure:

| Module | Resource |
|---|---|
| `vpc` | VPC, subnets (public/private), NAT gateway, route tables |
| `security-groups` | ALB, ECS task, RDS, ElastiCache SGs |
| `ecr` | ECR repository for Docker images |
| `ecs` | Fargate cluster + task definition + service |
| `rds` | PostgreSQL RDS in private subnet |
| `elasticache` | Redis cluster in private subnet |
| `alb` | Application Load Balancer + HTTPS listener + target group |
| `secrets` | Secrets Manager secrets for JWT keys, master key, admin key |
| `cloudwatch` | Log groups + metric alarms |

Copy `infra/terraform.tfvars.example` → `infra/terraform.tfvars` and fill in values before running.

```bash
cd infra
terraform init
terraform plan
terraform apply
```

---


## Scripts

| Script | Purpose |
|---|---|
| `scripts/setup-aws.sh` | Bootstrap AWS resources (ECR, Secrets Manager) |
| `scripts/update-secrets.sh` | Rotate secrets in Secrets Manager |
| `scripts/run-migrations.sh` | Run `prisma migrate deploy` in ECS task |
| `scripts/health-check.sh` | Curl `/health` and report status |

---


## GitHub Actions

| Workflow | Trigger | Purpose |
|---|---|---|
| `deploy.yml` | **Manual (`workflow_dispatch`)** — not automatic on push to `main` | Test → build Docker image → Trivy scan (CRITICAL/HIGH, blocking) → push ECR → Prisma migrate → ECS deploy → health check → auto-rollback on failure |
| `pr-checks.yml` | Pull request | Type-check + lint + unit tests + frontend unit tests + **E2E tests (Playwright)** + `npm audit --audit-level=high` + RLS isolation test + Docker build check (no push) + **gitleaks secret scan** + **TruffleHog secret scan** |
| `codeql.yml` | Push to `main` + Pull request | CodeQL static analysis (TypeScript, `security-extended` query suite) |

Deployment pipeline: test → build-and-push (incl. Trivy image scan) → migrate → deploy (needs both build-and-push AND migrate). Auto-rollback: if `/health` fails after 10 retries × 15s, previous ECS task definition is restored.

**Required checks before any PR can merge:** type-check, lint, unit tests, frontend unit tests, E2E tests, dependency audit, RLS isolation test, Docker build, gitleaks secret scan, TruffleHog secret scan, and CodeQL analysis. All must be green; none can be skipped. **`e2e-tests` still needs to be added to the branch protection ruleset's required-checks list by someone with repo admin access** (same standing gap already noted for `frontend-tests` — this tool doesn't have API access to branch protection, confirmed via a 403 on read).

Secret scanning notes:
- `gitleaks/gitleaks-action@v2` scans commits introduced by the PR; `.gitleaks.toml` allowlists two commits containing a known-inert RSA placeholder pending a git-history scrub.
- `trufflesecurity/trufflehog@main` scans the full git history (`base: ""`) with `--only-verified`; the inert placeholder is suppressed automatically because it cannot verify against any real service. See `.trufflehog.yml` for the full rationale.
- CodeQL runs on both PRs and every push to `main`; results appear in the GitHub Security tab.

---

