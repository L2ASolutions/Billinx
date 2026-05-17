# CLAUDE.md — Billinx

Nigeria FIRS/NRS e-invoicing compliance API. Billinx acts as a **System Integrator** between Nigerian businesses and the FIRS NRS (National Revenue Service) e-invoicing platform. Built with NestJS, PostgreSQL + Prisma, Redis, BullMQ, and AWS.

---

## Commands

Run from `C:\Projects\billinx\` (or `/billinx/` in the container).

```bash
npm install           # Install dependencies
npm run start:dev     # Dev server with watch (port 3000)
npm run start:debug   # Dev server with debugger
npm run build         # Compile TypeScript → dist/
npm run start:prod    # Run compiled production build
npm run lint          # ESLint with autofix
npm run format        # Prettier format
npm test              # Unit tests (Jest)
npm run test:e2e      # End-to-end tests
npm run test:cov      # Coverage report
```

Swagger UI: `http://localhost:3000/docs`
Health check: `GET /health`

---

## Architecture

```
billinx/
├── src/
│   ├── modules/
│   │   ├── identity/      Auth: JWT + API keys + admin keys
│   │   ├── tenant/        Multi-tenant provisioning + credential encryption
│   │   ├── user/          Users, roles, MFA, invitations, access requests
│   │   ├── invoice/       Invoice CRUD + IRN generation + state machine
│   │   ├── submission/    Async FIRS submission queue (BullMQ) + adapters
│   │   ├── compliance/    FIRS validation rules
│   │   ├── validation/    Data validation layer
│   │   ├── webhook/       Subscriptions + HMAC-signed event delivery
│   │   ├── activity/      Activity events + system error tracking
│   │   ├── kyb/           Know Your Business (CAC verification + risk scoring)
│   │   ├── admin/         L2A Solutions staff portal
│   │   └── consent/       NDPA 2023 consent + right-to-erasure
│   ├── infrastructure/
│   │   ├── database/      PrismaService (shared DB client, RLS middleware)
│   │   └── secrets/       SecretsService (AWS Secrets Manager, 5-min cache)
│   └── shared/
│       ├── context/       CLS request context (tenantId, actor, requestId)
│       ├── email/         AWS SES transactional email
│       ├── interceptors/  AuditLog, Idempotency, TenantRateLimit
│       ├── filters/       GlobalExceptionFilter → SystemError table
│       └── guards/        AuthRateLimitGuard
├── prisma/
│   ├── schema.prisma      Full data model (22 models, 11 enums)
│   └── migrations/        11 applied migrations (chronological below)
├── infra/                 Terraform: VPC, ECS Fargate, RDS, ElastiCache, ALB, ECR, Secrets
├── scripts/               AWS setup, secret rotation, migration runner, health check
├── docs/                  Deployment runbook, NRS/Interswitch API specs, invoice schema
└── .env.example           All environment variables with descriptions
```

---

## Modules

### identity
- **ApiKeyGuard** — Bearer token; validates hashed key in DB; injects `RequestContext`
- **JwtGuard** — Bearer JWT; verifies RS256 signature; injects `RequestContext`
- **AdminKeyGuard** — `X-Admin-Key` header; bcrypt compare to stored hash
- **TokenService** — Issue/rotate access (15 min) + refresh (7 day) token pairs
- **ApiKeyService** — Create, list, revoke tenant API keys
- Endpoints: `POST /v1/auth/token`, `/auth/refresh`, `/auth/revoke`, `/v1/api-keys` CRUD

### tenant
- Multi-tenant provisioning; every resource is scoped to a `Tenant`
- **CredentialService** — AES-256-CBC encrypt/decrypt for adapter credentials, webhook signing keys, MFA secrets
- Adapter config stored encrypted: `encryptedCredential + credentialIv`, per-adapter fields
- Admin-only endpoints: `POST/GET/PATCH/DELETE /v1/tenants`

### user
- Registration creates Tenant + OWNER user in one transaction
- Login: bcrypt verify → 5 failures → 15-min Redis lockout → optional TOTP MFA
- TOTP MFA required for OWNER/ADMIN roles; backup codes issued at setup
- 7-day email invitations; 2-hour password reset tokens
- Roles: `OWNER | ADMIN | ACCOUNTANT | VIEWER | API_MANAGER`
- NDPA 2023: consent recording (3 types), erasure requests, user anonymisation

### invoice
- Creates invoices, validates FIRS rules, generates IRN, queues for submission
- State machine: `DRAFT → VALIDATING → QUEUED → SUBMITTING → ACCEPTED/REJECTED`
- Also: `VALIDATION_FAILED`, `SUBMISSION_FAILED`, `DEAD_LETTERED`, `CANCELLATION_REQUESTED`, `CANCELLED`
- Supports `STANDARD`, `CREDIT_NOTE`, `DEBIT_NOTE`, `PROFORMA` invoice types
- Supports `B2B`, `B2C`, `B2G` invoice kinds
- Credit/debit notes require `originalIrn`
- Full `InvoiceStateHistory` audit trail on every transition
- Dashboard endpoints (JWT auth) separate from API endpoints (API key auth)

### submission
- BullMQ job queue; no controller — purely background workers
- **Adapters** (pluggable): `MockAdapter` (dev), `InterswitchAdapter` (production NRS)
- Max 3 attempts per invoice; final failure → `DEAD_LETTERED`
- Each attempt stored in `SubmissionAttempt` with full request/response payloads
- On success: sets `firsConfirmedIrn`, `qrCodeBase64`, `acceptedAt`

### webhook
- Tenant subscribes to event types (e.g. `invoice.accepted`)
- HTTPS-only endpoints; private IPs blocked
- Delivery: HMAC-SHA256 body signature, headers: `X-Billinx-Signature`, `X-Billinx-Event`, `X-Billinx-Timestamp`, `X-Billinx-Delivery`
- Max 3 delivery attempts, retry delays: 5 s, 15 s → `DEAD_LETTERED`
- Signing key encrypted at rest via CredentialService

### activity
- Tracks user logins, API key ops, invoice events, system errors
- Tenant-scoped for users; admin endpoints for platform-wide view
- `GET /v1/activity/export` returns CSV
- Captures unhandled exceptions to `SystemError` table with severity levels

### kyb
- CAC (Corporate Affairs Commission) verification for on-boarding
- Compares submitted company name to CAC record; name-match scoring
- Risk scores: `PENDING | GREEN | AMBER | RED`
- Admin-only endpoints

### admin
- Separate `AdminUser` model (not tenant users); roles: `SUPER_ADMIN | STAFF`
- Login via `POST /v1/admin/auth/login`; admin JWT (`AdminJwtGuard`)
- Dashboard stats, tenant management, access request approval/rejection
- Approve-and-provision: creates Tenant from `AccessRequest`, sets adapter + environment
- Consent records, erasure approvals (anonymise PII: name → "Anonymized", email → hash)

### consent
- `ConsentType`: `TERMS_AND_PRIVACY | NDPR_DATA_PROCESSING | BUSINESS_AUTHORISATION`
- Stores IP, user agent, consent version for audit trail
- Fire-and-forget from registration/login flows; no controller

---

## Data Models (Prisma)

22 models. Key ones:

| Model | Purpose |
|---|---|
| `Tenant` | Organisation; all resources scoped to this |
| `ApiKey` | Hashed API keys per tenant |
| `RefreshToken` | Hashed JWT refresh tokens |
| `AdminKey` | Hashed admin keys (L2A staff) |
| `Invoice` | Core FIRS invoice with full financial + party data |
| `InvoiceStateHistory` | Immutable log of every invoice state transition |
| `SubmissionAttempt` | Every FIRS submission attempt with request/response |
| `IdempotencyRecord` | 24-hour cache of POST/PUT/PATCH/DELETE responses |
| `WebhookSubscription` | Tenant webhook endpoints + encrypted signing key |
| `WebhookDelivery` | Per-event delivery tracking with retry state |
| `AuditLog` | Every HTTP request + response (redacted) |
| `ActivityEvent` | Business events (login, invoice ops, etc.) |
| `SystemError` | Unhandled exceptions; severity + resolution tracking |
| `User` | Tenant team members; MFA secret encrypted |
| `UserRole` | RBAC join: user ↔ role ↔ tenant |
| `UserInvitation` | 7-day email invitations |
| `PasswordResetToken` | 2-hour single-use tokens |
| `AccessRequest` | On-boarding requests before tenant provisioning |
| `KybVerification` | CAC + risk scoring result for an AccessRequest |
| `AdminUser` | L2A Solutions staff accounts |
| `ConsentRecord` | NDPA 2023 consent records |
| `ErasureRequest` | Right-to-erasure requests |

---

## Migrations (Applied)

```
20260508031059_init_identity
20260510020135_add_activity_and_errors
20260510024921_add_user_management
20260511001709_update_invoice_model
20260511133833_add_access_requests
20260511141500_add_admin_users
20260515000000_add_interswitch_fields
20260515200000_add_mfa
20260516000000_add_kyb
20260516010000_add_consent
20260516020000_add_nrs_invoice_fields
```

Run pending migrations: `npx prisma migrate deploy`

---

## Shared Infrastructure

### Request Context (CLS)
Every request gets a context object threaded via Continuation Local Storage:
```ts
{ tenantId, environment, tier, actor, actorType, requestId, isAdmin }
```
Populated by guards. Read anywhere via `getRequestContext()`. Never pass tenantId as a parameter — always read from context.

### Interceptors (applied globally)
1. **IdempotencyInterceptor** — SHA256 hash of body; replay response if `Idempotency-Key` header reused (24h TTL)
2. **TenantRateLimitInterceptor** — Redis fixed-window counter per tenant/tier; 429 on breach
3. **AuditLogInterceptor** — Async DB write of every request/response; redacts sensitive fields

### Encryption pattern
- Master key from AWS Secrets Manager → `SecretsService.getMasterEncryptionKey()`
- `CredentialService.encrypt(plaintext, tenantId)` → `{ encrypted, iv }`
- Always store both `encryptedFoo` and `fooIv` columns together

### PrismaService
- Sets `app.current_tenant_id` via middleware for Postgres RLS
- Use `prisma.asAdmin()` to bypass RLS for cross-tenant admin queries

---

## Environment Variables

```bash
# App
NODE_ENV=development|production
PORT=3000

# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_URL=                        # takes precedence over HOST/PORT

# JWT (dev only — prod uses Secrets Manager)
JWT_SECRET=
ADMIN_JWT_SECRET=

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

# Email
EMAIL_FROM=Billinx <noreply@billinx.ng>
APP_BASE_URL=https://app.billinx.ng

# MFA
MFA_ISSUER=Billinx

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

## GitHub Actions (pending — branch `feat/github-actions`)

Two workflows (requires `workflow` scope on PAT to push):

| Workflow | Trigger | Purpose |
|---|---|---|
| `deploy.yml` | Push to `main` | Build Docker image → push ECR → deploy ECS |
| `pr-checks.yml` | Pull request | Lint + type-check + tests |

---

## Documentation

| File | Contents |
|---|---|
| `docs/deployment.md` | AWS ECS/Fargate deployment runbook; GitHub Secrets; DNS; rollback |
| `docs/nrs-api-spec.md` | NRS E-Invoicing API spec; static header auth (`x-api-key` / `x-api-secret`) |
| `docs/nrs-invoice-schema.md` | Complete NRS invoice JSON field reference |
| `docs/interswitch-api-spec.md` | Interswitch/NRS platform roles and integration flow |

---

## Key Conventions

- **Tenancy**: all queries must be scoped to `tenantId` from `getRequestContext()` — never trust client-supplied tenant IDs
- **Encryption**: encrypted fields always stored as a pair: `encryptedFoo` + `fooIv`; use `CredentialService`, never roll your own crypto
- **State transitions**: use `StateMachineService` — never set `invoice.status` directly; always record `InvoiceStateHistory`
- **No comments**: code is self-documenting; only add a comment when the *why* is non-obvious
- **Error handling**: throw NestJS exceptions (`NotFoundException`, `ForbiddenException`, etc.); `GlobalExceptionFilter` formats and logs them
- **Secrets in prod**: all secrets come from AWS Secrets Manager via `SecretsService`; never hardcode in production
- **Idempotency**: all mutating endpoints should accept an `Idempotency-Key` header; the interceptor handles replay automatically
