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
│   │   ├── (compliance/ and validation/ do NOT exist as directories — FIRS
│   │   │     validation logic lives inline in invoice.service.ts, see below)
│   │   ├── webhook/       Subscriptions + HMAC-signed event delivery
│   │   ├── activity/      Activity events + system error tracking
│   │   ├── kyb/           Know Your Business (CAC verification + risk scoring)
│   │   ├── admin/         L2A Solutions staff portal
│   │   ├── consent/       NDPA 2023 consent + right-to-erasure
│   │   ├── product-catalog/ Tenant product catalog; /v1/products CRUD + line-item formatter
│   │   ├── export/        Compliance CSV/JSON/monthly export + platform-wide admin export
│   │   ├── reference-data/ Public FIRS lookup tables (invoice types, HS codes, states/LGAs, etc.)
│   │   ├── incoming-invoice/ Purchase invoice lifecycle: validate/approve/reject/mark-paid/attachments
│   │   ├── vat/           VAT Return Assistant: summary, annual summary, entries, reconciliation
│   │   ├── payment/       Paystack/Flutterwave invoice payment initiation + webhooks
│   │   ├── client/        Tenant customer/client CRUD + frequent-clients list
│   │   ├── analytics/     Top items/purchases/suppliers/clients, price trends, revenue-vs-expenses
│   │   ├── inventory/     Stock movements, low-stock alerts, adjustments, reorder
│   │   ├── notification/  In-app notification feed (list, mark read/read-all)
│   │   └── reminder/      Tenant-configurable payment reminder rules (/v1/reminder-rules CRUD)
│   ├── infrastructure/
│   │   ├── database/      PrismaService (shared DB client, RLS middleware)
│   │   └── secrets/       SecretsService (AWS Secrets Manager, 5-min cache)
│   └── shared/
│       ├── context/       CLS request context (tenantId, actor, requestId)
│       ├── email/         AWS SES transactional email
│       ├── interceptors/  AuditLog, Idempotency, TenantRateLimit
│       └── retention/     RetentionService — daily cron archiving (7yr invoices, 2yr events)
│       ├── filters/       GlobalExceptionFilter → SystemError table
│       └── guards/        AuthRateLimitGuard
├── prisma/
│   ├── schema.prisma      Full data model (45 models, 21 enums)
│   └── migrations/        40 applied migrations (chronological below)
├── infra/                 Terraform: VPC, ECS Fargate, RDS, ElastiCache, ALB, ECR, Secrets
├── scripts/               AWS setup, secret rotation, migration runner, health check
├── docs/                  Deployment runbook, NRS/Interswitch API specs, invoice schema
└── .env.example           All environment variables with descriptions
```

---

## Modules

### identity
- **ApiKeyGuard** — Bearer token; validates format (`/^blx_(live|test)_[A-Za-z0-9_-]{20,}$/`) before bcrypt; injects `RequestContext`; extracts `clientIp` from `X-Forwarded-For`
- **JwtGuard** — Bearer JWT; verifies RS256 signature; injects `RequestContext`
- **AdminKeyGuard** — `X-Admin-Key` header; bcrypt compare to stored hash
- **TokenService** — Issue/rotate access + refresh token pairs; lifetimes configurable via `JWT_ACCESS_TOKEN_EXPIRY` / `JWT_REFRESH_TOKEN_EXPIRY` env vars (e.g. `15m`, `7d`; defaults: 15 min / 7 days)
- **ApiKeyService** — Create, list, revoke, rotate tenant API keys; tracks `requestCount` and `lastUsedIp` per key; daily cron sends 7-day and 1-day expiry warnings by email
- Rotation: `POST /v1/api-keys/:keyId/rotate` — zero-downtime rotation with 24h grace period on old key
- Endpoints: `POST /v1/auth/token`, `/auth/refresh`, `/auth/revoke`, `/v1/api-keys` CRUD + rotate

### tenant
- Multi-tenant provisioning; every resource is scoped to a `Tenant`
- **CredentialService** — AES-256-GCM encrypt/decrypt for adapter credentials, webhook signing keys, MFA secrets
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
- BullMQ job queue; mostly background workers, plus one route: `GET /v1/submissions/export`
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

### incoming-invoice (`src/modules/incoming-invoice/`)
- Purchase-invoice lifecycle, mirrors the outbound invoice state machine
- `POST/GET /v1/incoming-invoices`, `GET .../stats`, `GET .../:id`
- `PATCH :id/validate`, `PATCH :id/approve`, `PATCH :id/reject`, `PATCH :id/mark-paid`
- `POST :id/send-receipt`, `POST/GET/DELETE :id/attachment`

### vat (`src/modules/vat/`)
- VAT Return Assistant backend: `GET /v1/vat/summary`, `.../summary/annual`, `.../entries`
- `PATCH /v1/vat/entries/:id/reconcile`, `GET /v1/vat/mismatches`
- Feeds the dashboard VAT return page + Excel export + monthly filing reminder cron

### payment (`src/modules/payment/`)
- Buyer-facing invoice payment initiation via Paystack and Flutterwave
- `POST /v1/payments/paystack/initialize`, `GET .../paystack/verify/:reference`, `POST .../paystack/webhook`
- `POST /v1/payments/flutterwave/initialize`, `POST .../flutterwave/webhook`
- Webhooks are HMAC-verified; initialize/verify routes are currently **unauthenticated with no rate limiting** — flagged as a hardening gap (see Open Issues)
- Rolls its own raw `https` request client rather than the providers' SDKs, with regex-based invoice-ID recovery from the payment reference as a fallback when webhook metadata is missing

### client (`src/modules/client/`)
- Tenant customer/client CRUD: `GET/POST /v1/clients`, `GET .../frequent`, `GET/PATCH/DELETE .../:id`

### analytics (`src/modules/analytics/`)
- Read-only reporting: `GET /v1/analytics/top-items-sold`, `.../top-purchases`, `.../top-suppliers`, `.../top-clients`, `.../price-trends`, `.../revenue-vs-expenses`

### inventory (`src/modules/inventory/`)
- Stock tracking for product-catalog items: `GET /v1/inventory`, `.../alerts`, `.../:productId/movements`
- `POST /v1/inventory/:productId/adjust`, `.../reorder`

### notification (`src/modules/notification/`)
- In-app notification feed: `GET /v1/notifications`, `PATCH .../read-all`, `PATCH .../:id/read`

### reminder (`src/modules/reminder/`)
- Tenant-configurable payment reminder rules: `GET/POST /v1/reminder-rules`, `PATCH/DELETE .../:id`
- Distinct from the invoice-level "Send Reminder" button (`POST /v1/invoices/dashboard/:id/reminder`), which lives in the `invoice` module

---

**Note on architecture drift:** CLAUDE.md previously listed `compliance/` and `validation/` as separate top-level module directories. **They do not exist as separate modules** — FIRS validation logic lives inline inside `invoice.service.ts`'s `validateInvoice()` method, as part of the invoice god-service (see Engineer To-Dos). Treat this doc's old architecture tree as aspirational, not current, until that logic is actually split out.

---

## Data Models (Prisma)

45 models, 21 enums. Key ones (many newer models — Client, InventoryMovement, Notification, VatEntry, ReminderRule, CreditNote, etc. — omitted here for brevity):

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
20260517120000_add_row_level_security
20260517130000_add_data_retention_fields
20260517140000_add_audit_hash_chaining
20260517150000_add_product_catalog
20260517160000_add_bulk_batches         # feat/bulk-processing — BulkBatch model + BulkBatchSource enum
20260517170000_add_api_key_usage_tracking  # feat/tenant-api-improvements — lastUsedIp, requestCount, expiresAt index
20260518000000_add_source_reference_index
20260521000000_add_payment_tracking
20260521010000_add_reminder_rules
20260527014408_add_invoice_list_indexes
20260528000000_add_incoming_invoices
20260528000000_add_user_preferences
20260530004420_add_vat_reconciliation
20260531000000_add_wht_tracking
20260601000000_add_firs_reference_data  # feat/firs-reference-data — 10 lookup tables (invoice types, payment means, tax categories, currencies, HS/service codes, states, LGAs, countries, quantity codes)
20260602000000_add_invoice_optional_fields
20260602100000_add_payment_fields
20260603023311_add_tenant_tax_representative
20260603135639_add_industry_phone_to_tenant
20260603142204_add_invoice_payment_status_index
20260604100000_add_clients
20260604200000_add_supplier_bank
20260605000000_add_inventory
20260606000000_add_performance_indexes
20260607000000_add_invoice_attachment
20260609032519_add_credit_note_model
20260609035413_add_notification_model
20260609175435_add_tenant_dashboard_visibility
20260611000000_make_reminder_log_rule_id_nullable
```

40 migrations applied as of 2026-07-04; database schema confirmed in sync via `npx prisma migrate status`.

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
2. **TenantRateLimitInterceptor** — Redis fixed-window counter per tenant/tier; 429 on breach; sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Tier` on every response
3. **AuditLogInterceptor** — Async DB write of every request/response; uses shared `sanitize()` to recursively redact 16 sensitive keys before writing

### Log sanitizer (`src/shared/utils/log-sanitizer.ts`)
- `sanitize(obj)` — recursive (depth ≤5); redacts: `password`, `apikey`, `secret`, `token`, `authorization`, `x-api-key`, `x-api-secret`, `x-admin-key`, `privatekey`, `credential`, `mastersecret`, `refreshtoken`, and more
- Used by AuditLogInterceptor; import wherever logs touch user-supplied data

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
# For production: append ?connection_limit=10&pool_timeout=20
DB_POOL_SIZE=10

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_URL=                        # takes precedence over HOST/PORT

# JWT (dev only — prod uses Secrets Manager)
JWT_SECRET=
ADMIN_JWT_SECRET=
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
| `pr-checks.yml` | Pull request | Type-check + lint + unit tests + `npm audit --audit-level=high` + Docker build check (no push) |

Deployment pipeline: test → build-and-push (incl. Trivy image scan) → migrate → deploy (needs both build-and-push AND migrate). Auto-rollback: if `/health` fails after 10 retries × 15s, previous ECS task definition is restored.

No CodeQL/SAST or dedicated secret-scanning (gitleaks/trufflehog) step exists in either workflow — see Open Issues.

---

## Documentation

| File | Contents |
|---|---|
| `docs/deployment.md` | AWS ECS/Fargate deployment runbook; GitHub Secrets; DNS; rollback |
| `docs/nrs-api-spec.md` | NRS E-Invoicing API spec; static header auth (`x-api-key` / `x-api-secret`) |
| `docs/nrs-invoice-schema.md` | Complete NRS invoice JSON field reference |
| `docs/interswitch-api-spec.md` | Interswitch/NRS platform roles and integration flow |
| `docs/quickstart.md` | Developer quickstart with curl examples (6 steps to first FIRS invoice) |
| `docs/postman-setup.md` | Postman import and environment setup guide |
| `docs/billinx-api.postman_collection.json` | Postman Collection v2.1 with all endpoint groups |
| `docs/api-changelog.md` | API versioning policy, deprecation process, v1 release history |

---

## Key Conventions

- **Tenancy**: all queries must be scoped to `tenantId` from `getRequestContext()` — never trust client-supplied tenant IDs
- **Encryption**: encrypted fields always stored as a pair: `encryptedFoo` + `fooIv`; use `CredentialService`, never roll your own crypto
- **State transitions**: use `StateMachineService` — never set `invoice.status` directly; always record `InvoiceStateHistory`
- **No comments**: code is self-documenting; only add a comment when the *why* is non-obvious
- **Error handling**: throw NestJS exceptions (`NotFoundException`, `ForbiddenException`, etc.); `GlobalExceptionFilter` formats and logs them
- **Secrets in prod**: all secrets come from AWS Secrets Manager via `SecretsService`; never hardcode in production
- **Idempotency**: all mutating endpoints should accept an `Idempotency-Key` header; the interceptor handles replay automatically

---

## New Modules (May 2026)

### product-catalog (`src/modules/product-catalog/`)
- Tenant product catalog for pre-loading line item data into invoices
- CRUD endpoints: `POST/GET/PATCH/DELETE /v1/products`
- `GET /v1/products/:id/as-line-item` — returns product as ready-to-use invoice line item
- Tenant-scoped (JwtGuard); search by name/description/HSN code, filter by category or isActive

### export (`src/modules/export/`)
- Compliance export: `GET /v1/invoices/export/csv?startDate=&endDate=`
- JSON export: `GET /v1/invoices/export/json?startDate=&endDate=`
- Monthly report: `GET /v1/invoices/export/monthly?year=&month=`
- Admin platform-wide CSV: `GET /v1/admin/export/platform-csv?startDate=&endDate=`
- Redis rate limit: 60-second cooldown per tenant per export request

### retention (`src/shared/retention/`)
- `RetentionService` — daily cron at 02:00 UTC
- Archives invoices older than 7 years (`isArchived = true`, sets `archivedAt`)
- Archives activity events older than 2 years (`isArchived = true`)
- Admin endpoints: `GET /v1/admin/retention/stats`, `POST /v1/admin/retention/run`
- Requires `ScheduleModule.forRoot()` in AppModule (from `@nestjs/schedule`)

### Hash-chained audit log (ActivityEvent)
- Every `ActivityEvent` now stores `entryHash` (SHA-256) and `previousHash`
- Chain: `SHA256(tenantId|eventType|actor|occurredAt|payload|previousHash)`
- First event per tenant uses `"GENESIS"` as previousHash
- Verification: `GET /v1/admin/audit/verify` recomputes and validates entire chain

### Enhanced health check (`GET /health`)
- Returns database latency (ms), Redis latency (ms), submission queue depth, and process uptime
- `status: "ok"` when both DB and Redis are connected; `"degraded"` otherwise

### Monitoring endpoints
- `GET /v1/admin/metrics` — invoice counts (today/week/month), acceptance rates, active tenants, system errors, webhook delivery rates
- `GET /v1/admin/queue/status` — BullMQ job counts (waiting, active, completed, failed, delayed)
- `GET /v1/admin/queue/bulk/status` — bulk queue job counts (separate BullMQ queue)
- `POST /v1/admin/queue/retry-failed` — re-queues all failed submission jobs

### Reference data (`src/modules/reference-data/`)
- Public read-only lookup endpoints — no auth required
- 5-minute in-process cache per endpoint; safe to call on every invoice form load
- Endpoints: `GET /v1/reference/invoice-types`, `/payment-means`, `/tax-categories`, `/currencies`, `/quantity-codes`, `/states`, `/countries`
- Paginated search: `GET /v1/reference/hs-codes?search=&limit=20&offset=0`, `/service-codes?search=&limit=20&offset=0`
- Filtered: `GET /v1/reference/lgas?stateCode=NG-LA`
- Seed script: `npx tsx scripts/seed-reference-data.ts` (safe to re-run — uses `skipDuplicates`)
- Migration: `20260601000000_add_firs_reference_data`

### Bulk invoice ingestion (`src/modules/invoice/bulk/`)
- `POST /v1/invoices/bulk` — up to 500 invoices per JSON request; per-invoice results with `invoiceId`, `platformIrn`, `status`, `errors`
- `POST /v1/invoices/bulk/csv` — multipart upload; 5 MB / 500-row limits; flat CSV mapped to invoice format
- `GET /v1/invoices/bulk/:batchId/status` — batch progress (`total`, `queued`, `processing`, `accepted`, `rejected`, `failed`, `percentComplete`)
- Separate BullMQ queue `billinx-bulk-submission` at priority 10 (lower than individual invoices); concurrency via `BULK_WORKER_CONCURRENCY` (default 5)
- Rate limit: 3 bulk requests per minute per tenant (Redis key `bulk:rl:${tenantId}`)
- `BulkBatch` Prisma model tracks batch lifecycle; migration: `20260517160000_add_bulk_batches`

### Startup environment validation (`src/config/config.validation.ts`)
- `validateEnvironment()` called before app creation; exits with a clear list of all missing vars
- Always required: `DATABASE_URL`
- Production required: `JWT_PRIVATE_KEY_SECRET_ID`, `JWT_PUBLIC_KEY_SECRET_ID`, `MASTER_KEY_SECRET_ID`, `ADMIN_KEY_SECRET_ID`, `REDIS_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Development required: `JWT_SECRET`

### API versioning header (`src/shared/interceptors/version-header.interceptor.ts`)
- `VersionHeaderInterceptor` — appends `X-API-Version: 1.0.0` to all responses
- Applied globally in `main.ts`
- See `docs/api-versioning.md` for deprecation policy

---

## Product & Workflow Context

### About Billinx
- Product owner: Kay (non-technical founder)
- GitHub repo: L2ASolutions/Billinx
- Dev environment: GitHub Codespace (`fuzzy-lamp-g5r9qw7g4vhjw6`)
- Access Point Provider: Interswitch (InterswitchAdapter) — chosen over direct FIRS integration
- NDPR compliance required; Data Processing Agreements with Nigerian tech lawyer pending
- Hosting regions (planned): AWS eu-west-1 and af-south-1

### Current State (as of 2026-07-04)
- 152+ PRs merged to main (through PR #164)
- 754 tests passing, 49 test suites, 45 DB models, 21 enums (payment + webhook + identity/auth + user module tests added 2026-07-04; tenant, admin, kyb, consent, product-catalog, export, reference-data, submission-adapter, client, analytics, inventory, notification, and reminder module tests added 2026-07-05 — every backend module now has at least some test coverage; was 83/5, unchanged since 2026-06-11, until then)
- Last merged PRs: #164 fix/lga-reference-data-and-vat-export, #163 fix/payments-overdue-data-consistency, #161 fix/npm-audit-deps, #160 fix/payments-ssr-auth, #159/#162 dependency bumps

### Open Issues

**Resolved since 2026-06-11 (kept here so nobody re-investigates them):**
- ~~Ghost endpoint `POST /v1/invoices/dashboard/:id/reminder`~~ — now implemented (`invoice.controller.ts`, "Send Reminder" button on invoice detail page works).
- ~~Ghost endpoint `POST /v1/auth/mfa/resend`~~ — route now exists, but is a **deliberate permanent stub** that always returns 400 ("TOTP codes are generated by your authenticator app and cannot be resent"). The frontend still shows a "Resend code" link on the MFA login page that can never succeed — needs UX follow-up (remove the link or change copy), not a backend fix.

**Security (from 2026-07-04 audit — see full report in project history for details):**
1. ~~RSA private key committed to git history~~ — **investigated and downgraded, false alarm.** Commit `3c11a74` (2026-05-16, removed next day in `e4e9248`) added a `DEV_RSA_PRIVATE_KEY` constant that *looks* like a PEM block but fails `openssl rsa -check` — only 3 lines of base64 body, not a parseable RSA-2048 key. It's an inert placeholder string, not real key material, and the code path was gated behind `!isProduction` so it never touched the production signing path. **No rotation needed.** Still worth a git-history cleanup for hygiene (see below) so it doesn't trip future secret scanners as a false positive, but this is not an active exposure.
2. **Admin IP allowlist (`AdminIpGuard`) fails open** — `ADMIN_ALLOWED_IPS` wasn't set anywhere in infra/ECS config, so every `/v1/admin/*` route was reachable from any IP. **Partially fixed 2026-07-04:** `admin_allowed_ips` is now a real Terraform variable (`infra/variables.tf`), wired into the ECS task env vars (`infra/main.tf`), documented in `infra/terraform.tfvars.example`, and added as a placeholder in `docker/ecs-task-definition.json`. **Still needed before this is actually closed:** (1) the real IP/CIDR list (office IP, staff VPN range, etc. — only Kay/the team knows these), and (2) an engineer with AWS credentials running `terraform apply` to push it to the live ECS service. Not added to `config.validation.ts`'s hard-required production vars — doing so would crash-loop the *entire* app on next deploy if the live infra doesn't have a real value set yet, which couldn't be verified from this environment (no AWS access). Guard still fails open with a warning log until the real value is deployed.
3. ~~Payment endpoints have no auth or rate limiting~~ — **fixed 2026-07-04.** Added `PaymentRateLimitGuard` (`src/shared/guards/payment-rate-limit.guard.ts`, 10 requests / 5 min per IP, same fixed-window Redis primitive as `AuthRateLimitGuard`/`TenantRateLimitInterceptor`, fails open on Redis outage — consistent with the rest of the app's non-auth rate limiting). Applied to `POST /v1/payments/paystack/initialize`, `GET .../paystack/verify/:reference`, `POST .../flutterwave/initialize`. Webhook receivers were left unguarded by design (already HMAC-verified; rate-limiting them risks dropping legitimate provider retries). Verified live: 11th request in the window correctly returns `429` with `X-RateLimit-*`/`Retry-After` headers; build, full app boot, and existing test suite (83/83) all still pass.
   - ~~zero test coverage~~ — **fixed 2026-07-04.** Added `payment.service.spec.ts` (28 tests: initialize/verify/webhook happy paths for both providers, invoice-not-found/not-accepted/already-paid guards, not-configured guards, kobo-vs-naira amount conversion, invoiceId recovery from both metadata and regex-parsed reference — including the malformed-reference case that returns null, network-error propagation, webhook dedup/missing-invoice/zero-amount/email-notification side effects), `payment.controller.spec.ts` (11 tests: route delegation, Paystack HMAC-SHA512 signature verification, Flutterwave verif-hash check, both "secret not configured" bypass paths), and `payment-rate-limit.guard.spec.ts` (5 tests for the guard added earlier this session). 44 new tests total (28+11+5), all passing; `tsc`/`nest build`/lint all clean.
   - **Still open, not addressed by these fixes:** `PaymentProviderService` still rolls its own raw `https` client instead of a vetted Paystack/Flutterwave SDK, with regex-based invoice-ID recovery as a webhook fallback (now covered by tests, but the design itself — hand-rolled HTTP client for a payments integration — is still worth a review pass on whether to swap in official SDKs).
4. ~~No rate limiting on `auth/reset-password`, `auth/accept-invitation`, `users/request-access`, `kyb/tin-confirm`, or `reference-data` search endpoints~~ — **fixed 2026-07-04.** `reset-password`, `accept-invitation`, and `request-access` now use the existing `AuthRateLimitGuard` (5/15min per IP, shared bucket with login/register/forgot-password on that same IP — this is existing, intentional behavior, not new). `kyb/tin-confirm` also now uses `AuthRateLimitGuard`. `reference-data`'s `hs-codes`/`service-codes` search endpoints got a new, more generous `ReferenceSearchRateLimitGuard` (60/5min per IP — sized for real usage, since the frontend debounces search input at 300ms and a user builds an invoice with many line items in one sitting; a tight limit would have broken the actual feature). Also fixed the unbounded `limit`/`offset` query params on `hs-codes`/`service-codes` — now clamped server-side to 1–100 / ≥0 regardless of what's requested. All verified live: booted the app, hit each endpoint past its threshold and confirmed `429` + correct `X-RateLimit-*`/`Retry-After` headers; confirmed `limit=99999` clamps to 100 and negative values clamp to the floor; full test suite (83/83) and `tsc`/`nest build` still clean throughout.
5. `dump.rdb` and `..env.swp` are committed to the repo; neither `*.swp`/`*.swo` nor `dump.rdb` is in `.gitignore`.
6. Several production env vars aren't validated at startup (silent misconfig risk): `INTERSWITCH_PROD_URL` (falls back to a hardcoded URL if unset), `CAC_API_KEY`, `ADMIN_ALLOWED_IPS`. `NRS_API_BASE_URL` is documented everywhere but unused in code — dead config.
7. Tenant isolation is correctly implemented everywhere sampled, but relies on ~217 manual `tenantId` checks inside `prisma.asAdmin()` calls rather than a DB-enforced guarantee (Postgres RLS is explicitly bypassed inside those calls) — one missed check in a future PR would silently leak cross-tenant.
8. ~~BullMQ queues are constructed as module-level singletons that eagerly open a live Redis connection at import time~~ — **fully fixed 2026-07-04.** Found while writing webhook tests (a test hung indefinitely; root cause was importing `WebhookService` transitively opening a real, never-closed Redis connection via `new Queue(...)` at the top of `webhook.queue.ts`). All four queue files in the codebase used this pattern and are now fixed the same way — the queue is built lazily on first actual use (`getSubmissionQueue()`, `getBulkSubmissionQueue()`, `getVatReminderQueue()`, and webhook's equivalent), not at module import time:
   - `webhook.queue.ts` — no external call sites, self-contained fix.
   - `submission.queue.ts` — call sites updated: `health.controller.ts` (the endpoint AWS ECS/CI use to decide on deploy rollback) and `admin.service.ts` (`getQueueStatus`, `retryFailedJobs`).
   - `bulk-submission.queue.ts` — call site updated: `admin.service.ts` (`getBulkQueueStatus`).
   - `invoice/vat-reminder.queue.ts` — call site updated: `vat-reminder.scheduler.ts` (still only invoked inside `onModuleInit`, which is fine — Nest lifecycle hooks aren't the "just importing the file" problem this was fixing).
   Verified: `tsc`/`nest build`/lint clean, full suite (188/188) clean with normal exit, and — since this touched the deploy health-check endpoint specifically — booted the real app and confirmed `GET /health` still returns `"queue": { "depth": 0 }` correctly through the new lazy getter.
   Considered but not done: migrating to `@nestjs/bullmq`'s `BullModule.registerQueue()` (already an installed but unused dependency) would be the more idiomatic long-term fix, but is a bigger change touching how all four queues and their workers are wired — left as a separate decision for the team, not bundled into this fix.

**Test coverage** — thinner than previously documented:
- Real coverage exists for: invoice-flow, XML builder, incoming-invoice, VAT service, and (added 2026-07-04) payment, webhook, identity/auth, and user, and (added 2026-07-05) tenant, admin, kyb, consent, product-catalog, export, reference-data, submission adapters, client, analytics, inventory, notification, and reminder (754 tests / 49 suites total) — this closes out the last module that had zero coverage; every backend module now has some real tests, though depth still varies a lot by module (see the per-module notes below and the two orphaned-spec/frontend items after).
  - Reminder coverage (35 tests across 2 files: `reminder.service.spec.ts` 30, `reminder.controller.spec.ts` 5; uses Jest fake timers with a fixed system clock since the daily reminder check's day-difference math reads the real clock) covers rule CRUD validation (`triggerType` enum check, `triggerDays` non-negative-integer check, and the `ON_DUE_DATE`-must-be-0 / other-types-must-be->0 cross-field rule, re-validated against the *existing* rule's triggerType on partial updates that omit it), rule ownership enforcement (404 vs 403 for a rule belonging to another tenant) shared by update/delete, and the cron-driven `runReminderCheck` engine end-to-end: the three trigger-type day-math branches (`DAYS_BEFORE_DUE`/`ON_DUE_DATE`/`DAYS_AFTER_DUE`) firing on the exact matching day and not otherwise, per-invoice-per-rule dedup via existing `reminderLogs` rows, the tenant-level early-exit gates (no active OWNER email, owner user inactive, no active rules, no qualifying invoices), the full send side effects (reminder log + invoice reminderCount/lastReminderAt update + `invoice.reminder_sent` event emission + activity tracking), `amountOutstanding` floored at 0, the `firsConfirmedIrn`-falls-back-to-`platformIrn` display logic, and that an email-send failure is caught/logged inside `sendReminder` without failing the whole tenant's batch — worth noting this means the returned `sent` count still increments even when the underlying email threw, since the catch lives inside the per-reminder helper, not the caller; that's existing behavior the tests document rather than something changed here.
  - Notification coverage (9 tests across 2 files: `notification.service.spec.ts` 6, `notification.controller.spec.ts` 3) covers tenant/user-scoped notification listing and the read/read-all mutations (scoped to id+tenantId+userId to prevent cross-tenant marking; read-all only touches currently-unread rows), and `hasUnreadOfTypeForPeriod`'s period-substring match used by the VAT-reminder cron to avoid re-notifying within the same period.
  - Inventory coverage (35 tests across 2 files: `inventory.service.spec.ts` 28, `inventory.controller.spec.ts` 7) covers the tenant-level `inventoryEnabled` gate shared across every endpoint (including the two fire-and-forget invoice-lifecycle hooks silently no-op'ing rather than throwing when disabled), stock-status classification (`OUT_OF_STOCK`/`LOW_STOCK`/`IN_STOCK` thresholds), the low-stock filter + pagination on the stock list, `adjustStock`'s balanceBefore/balanceAfter movement recording for both positive and negative (write-off) adjustments, `deductStock`'s HSN-code-to-product matching from outbound invoice line items (including the `commodityClassification.hsn`/`invoicedQuantity` field-name fallback, floor-at-zero, and skip-if-already-zero guards), `addStock`'s case-insensitive product-name matching from incoming-invoice items, `getLowStockCount`'s tenant-gated count, and `triggerReorder`'s missing-supplier-email guard and reorder-email payload.
  - Analytics coverage (29 tests across 2 files: `analytics.service.spec.ts` 21, `analytics.controller.spec.ts` 8; uses Jest fake timers with a fixed system clock since the service's `month`/`quarter`/`year` period math and `revenueVsExpenses`'s month-label generation both read the real clock) covers the in-memory aggregation/grouping logic shared by `topItemsSold`/`topPurchases`/`topSuppliers`/`topClients` (case-insensitive grouping by name, revenue/spend accumulation, most-recent-invoice-date tracking, sort-descending-then-cap-at-10, and safe fallbacks for missing description/quantity/amount), `priceTrends`'s substring item-name filter and YYYY-MM period bucketing, and `revenueVsExpenses`'s per-month ACCEPTED-invoice-vs-incoming-invoice aggregation with a 0-default when a month has no data.
  - Client coverage (33 tests across 2 files: `client.service.spec.ts` 25, `client.controller.spec.ts` 8) covers TIN-uniqueness conflict handling and its reactivate-instead-of-duplicate path for soft-deleted clients, tenant-scoped search/pagination, the falsy-vs-undefined patch-field distinction in `update` (mirroring the same pattern already covered for tenant/product-catalog), and `syncFromInvoice` — the auto-population logic invoice creation feeds into: incrementing `totalInvoices`/`totalBilled`/`lastInvoiceAt` for an existing TIN match, auto-creating a client from buyer party details (including the flat-field-vs-`buyerParty`-nested-field fallback) when no match exists, silently swallowing unique-constraint races from concurrent invoice creation, and no-op when the invoice has no buyer name at all.
  - Submission-adapter coverage (37 tests across 2 files: `mock.adapter.spec.ts` 6, `interswitch.adapter.spec.ts` 31) covers `MockAdapter`'s randomized accept/reject roll and FIRS-IRN generation (deterministic via a mocked `Math.random` + Jest fake timers to avoid the real 800–2000ms simulated delays) and malformed-platformIrn fallback; and `InterswitchAdapter`'s credential-missing short-circuit, sandbox-vs-production URL selection, per-tenant credential decryption, the NRS payload builder (FIRS invoice-type-code mapping, tax-category-id normalisation e.g. legacy `VAT`→`STANDARD_VAT`, optional buyer-party omission, payment-means default-from-provider fallback), the full `mapError` branch set (401/429/500/422/400-with-various-detail-strings/unrecognised-status/AbortError → INVALID_CREDENTIALS/RATE_LIMITED/SERVER_ERROR/SCHEMA_VALIDATION/IRN_DUPLICATE|INVALID_BUSINESS_ID|VALIDATION_ERROR/UNKNOWN_ERROR/TIMEOUT with correct `retryable` flags), `checkStatus`'s missing-tenantId/missing-credentials/success/4xx-vs-5xx-retryable/abort/generic-error paths, `updatePaymentStatus`'s PARTIAL-includes-amount vs PAID-omits-amount body and its swallow-don't-throw behavior on both non-OK responses and network errors, and `ping`'s status/exception-based health signal.
  - Reference-data coverage (33 tests across 3 files: `reference-data.service.spec.ts` 20, `reference-data.controller.spec.ts` 10, plus (in `shared/guards/`, since it guards the module's two search endpoints) `reference-search-rate-limit.guard.spec.ts` 5) covers the 5-minute in-process cache (each of the six cached endpoints keyed independently, single DB hit across repeated calls within the TTL, re-query after expiry — using a mocked `Date.now`), the `getHsCodes`/`getServiceCodes` search filter and the server-side limit/offset clamping fixed 2026-07-04 (excessive limit clamped to 100, negative limit clamped to 1, `limit=0` falling back to the 20 default since the clamp uses a falsy check not an undefined check, negative offset clamped to 0), `getLgas` correctly *not* being cached (state-scoped, always fresh), and `getCountries`' cache-bypass-when-searching behavior. Also added `ReferenceSearchRateLimitGuard` tests (60-req/5-min per-IP, mirroring the existing `PaymentRateLimitGuard` test pattern) since it was untested despite guarding these same endpoints.
  - Export coverage (16 tests in `export.service.spec.ts`; no dedicated controller — its routes live inline in `invoice.controller.ts`/`admin.controller.ts`, both already covered for delegation) covers the shared 60-second Redis rate limit (429 on an existing key, cooldown key set after success, and confirms `exportPlatformCSV` — the admin platform-wide export — is *not* subject to it), CSV field-quoting/escaping (embedded double quotes, blank fields for missing buyerTin/firsConfirmedIrn/qrCode), the JSON export's Decimal-to-number and ISO-date-truncation mapping, the monthly report's pending-count derivation and 0%/0-amount edge case when a month has no invoices, and the platform CSV's extra TenantName/TenantTIN columns (including the missing-tenant-relation blank-column case).
  - Product-catalog coverage (26 tests across 2 files: `product-catalog.service.spec.ts` 20, `product-catalog.controller.spec.ts` 6) covers tenant-scoped CRUD including the explicit-`undefined`-vs-falsy-value distinction in both create (`isActive: false`/`stockQuantity: 0` respected, not defaulted) and update (patch fields fall back to the existing value only when actually omitted, not when falsy), the search/category/isActive list filters, Decimal-to-number coercion for price/stock fields, the `PRODUCT_CREATED`/`PRODUCT_UPDATED` activity-tracking side effects (using the mocked `getRequestContext()`, same pattern as the identity/auth `ApiKeyService` tests), and `getProductAsLineItem`'s VAT-category-based tax-rate derivation (7.5% for `STANDARD_VAT`, 0% otherwise).
  - Consent coverage (16 tests in `consent.service.spec.ts`; module has no controller — fire-and-forget from registration/login flows) covers consent-record defaults/field persistence, the duplicate-pending-erasure-request guard, and the full erasure lifecycle: request → approve (user PII anonymisation, refresh-token revocation, consent-record revocation, a freshly-generated random password hash on every approval — not reused/static) → reject (clears the user's pending flag so they can re-request), plus the not-PENDING conflict guard shared by approve/reject.
  - KYB coverage (16 tests across 2 files: `kyb.service.spec.ts` 14, `kyb.controller.spec.ts` 2) covers `confirmTin`'s upsert-with-null-clearing-on-unconfirm behavior, and `verifyCac`'s fuzzy company-name matching (Levenshtein + Jaccard blend) and risk scoring (GREEN/AMBER/RED thresholds at 90%/70%) against a mocked global `fetch` — including the three distinct RED-with-error-message paths (`CAC_API_BASE_URL` unset, non-OK HTTP response, and a thrown/network error), the alternate CAC response field-name variants (`company_name`/`companyName`, `rcDate`/`registrationDate`, `proprietors`/`directors`), the non-ACTIVE-status risk-reason addition, and that a `KybVerification` row is upserted before the network call is even attempted.
  - Tenant coverage (43 tests across 4 files: `credential.service.spec.ts` 8, `tenant.repository.spec.ts` 10, `tenant.service.spec.ts` 22, `tenant.controller.spec.ts` 8) covers the AES-256-GCM encrypt/decrypt round-trip in `CredentialService` including tenant-scoped key derivation (decryption fails if the tenantId, master key, or ciphertext differs from what it was encrypted with), the repository's `asAdmin`-wrapped Prisma calls and its partial-update field-inclusion logic (explicit `undefined` checks, not truthy checks, for `batchEnabled`/`batchSize`/`isActive`), and the service's TIN-uniqueness/format validation, per-field credential re-encryption using the tenant's own TIN (not client-supplied input) as the key-derivation input, and the fire-and-forget default-reminder-rule creation on tenant creation.
  - Admin coverage (74 tests across 3 files: `admin.service.spec.ts` 44, `admin.controller.spec.ts` 22, plus (added to `shared/guards/`, since it's the admin-only IP allowlist) `admin-ip.guard.spec.ts` 8) covers admin login/bootstrap (bcrypt verify, inactive-account and wrong-password rejection, 8h bearer token issuance), dashboard/metrics/tenant-detail acceptance-rate math including the 0-total edge case, access-request approve-and-provision (tenant creation + request status update + applicant email, defaulting to `mock`/`SANDBOX` when unspecified) and reject, the hash-chained audit-log verifier (`verifyAuditChain` — valid GENESIS-rooted chain, legacy rows with no `entryHash` skipped, and tamper detection reporting the first broken event id), queue-monitoring success/failure paths for both the submission and bulk queues (mocking `getSubmissionQueue`/`getBulkSubmissionQueue` per the lazy-queue pattern — see BullMQ fix below), and the `AdminIpGuard` fail-open-with-no-allowlist behavior plus its exact-match and CIDR (including `/0` and `/32` edge cases) allow/deny logic — the guard flagged as failing open in Open Issue #2 above.
  - Noted but not de-duplicated: `src/modules/admin/guards/admin-jwt.guard.ts` is a byte-identical copy of the already-tested `src/modules/identity/guards/admin-jwt.guard.ts` (only the admin module's copy is actually wired into `AdminController`/`AdminModule`). Didn't add a redundant third test file for it, but this duplication is worth collapsing to a single shared guard in a future cleanup pass.
  - Webhook coverage (`webhook.service.spec.ts`, 52 tests; `webhook.controller.spec.ts`, 9 tests) includes the SSRF-protection allow/block list in `validateUrl` (private IPv4/IPv6 ranges, `.local`/`.internal`, AWS metadata endpoint), delivery retry/dead-letter math against `MAX_ATTEMPTS`, and the outbound HMAC-SHA256 delivery signature — the `WebhookWorker`'s BullMQ wiring itself is intentionally untested (no business logic there beyond calling `processDelivery`, which is covered).
  - Identity/auth coverage (66 tests across 8 files: `token.service.spec.ts` 11, `api-key.service.spec.ts` 20, `jwt.guard.spec.ts` 6, `api-key.guard.spec.ts` 5, `admin-key.guard.spec.ts` 4, `admin-jwt.guard.spec.ts` 5, `flex-auth.guard.spec.ts` 3, `identity.controller.spec.ts` 12) covers JWT issue/verify/rotate including the userId\|tenantId-prefix scoping optimization and its legacy-token fallback, API key lifecycle (create/verify/revoke/rotate-with-grace-period/list) and the expiry-warning cron (OWNER-only, urgency threshold), and all five auth guards (`JwtGuard`, `ApiKeyGuard`, `AdminKeyGuard`, `AdminJwtGuard`, `FlexAuthGuard`'s JWT-then-API-key fallback). The orphaned `test/unit/identity/api-key.service.spec.ts` (previously dead — never executed by any npm script) was deleted, superseded by the new, properly-located, more thorough version.
  - User module coverage (98 tests across 3 files: `mfa.service.spec.ts` 17, `user.service.spec.ts` 46, `user.controller.spec.ts` 35) covers real RFC-6238 TOTP generation/verification (not mocked — tests compute valid codes against the actual algorithm), backup-code consumption, login's account-lockout/MFA-branch/privileged-role-setup-prompt logic, invitation and password-reset token lifecycles (expired/used/invalid), and the two chunks of real business logic embedded in the controller itself: the tenant-profile allow-listed-field + address-JSON-merge logic in `updateMyTenant`, and the per-role dashboard-visibility defaults-merge + validation in `getDashboardVisibility`/`updateDashboardVisibility`.
- Two spec files remain orphaned under `test/unit/` (`invoice/xml-invoice.builder.spec.ts`, `invoice/state-machine.spec.ts`) — never executed by any npm script because Jest's `rootDir` is scoped to `src/`; the xml-builder one is a stale duplicate missing newer test cases. (A third, `identity/api-key.service.spec.ts`, was deleted 2026-07-04 — superseded by a proper, more thorough version at `src/modules/identity/services/api-key.service.spec.ts`.)
- Frontend has zero test infrastructure (no framework, no config, no test script).

**Dead/misleading UI:**
- `adminApi.exportPlatformCsv` and `adminApi.unlockAccount` are fully wired in the frontend API client (`lib/api.ts`) but have **no UI caller anywhere** — admin staff cannot actually trigger a platform-wide CSV export or unlock a locked account from any screen today.
- The "Live chat" support button always falls back to `mailto:` because Intercom is never loaded in the app, despite UI copy promising live chat.
- Two permanently-disabled "Coming soon" toggles in Settings (POS Integration, Email Invoice Intake) advertise unbuilt features.

### Engineer To-Dos (do not run through Claude Code without engineering review)
**Backend refactors — grew, not shrunk, since last noted:**
- `invoice.service.ts` — now **2,070 lines** (was 1,842) — god service: create, validate, XML, draft, duplicate, stats, charts, sample. This is also where the "missing" compliance/validation logic lives (see architecture-drift note above) — splitting FIRS validation out into its own module would address both problems at once.
- `invoice.controller.ts` — now **786 lines** (was 761) — two auth surfaces in one file.
- **New, previously unflagged:** `src/shared/email/email.service.ts` — 927 lines. `src/modules/user/services/user.service.ts` — 880 lines.

**Frontend refactors — grew, not shrunk, since last noted:**
- `invoices/new/page.tsx` — now **1,734 lines** (was ~1,557) → extract into sub-components.
- `invoices/[id]/page.tsx` — now **1,527 lines** (was ~1,486) → extract into sub-components.
- `settings/page.tsx` — unchanged at 1,138 lines → extract into sub-components.
- **New, previously unflagged:** `dashboard/page.tsx` — 1,111 lines. `purchases/page.tsx` — 851 lines. `payments/page.tsx` — 845 lines.

### Completed Frontend Features
- VAT Return Assistant: VAT category per line item, credit note model, VAT return summary endpoint + Excel export + dashboard page, BullMQ cron for monthly filing deadline reminders
- RBAC enforcement: roles (OWNER, ADMIN, INVOICE_CREATOR, VIEWER) enforced at API level via `@Roles()` decorators; static Role Permissions tab in Team settings
- Dashboard: interactive Revenue Trend and Invoice Pipeline charts with click-through to filtered invoice list; FIRS Rejections card; role-based visibility; per-user Customize panel; three-layer precedence (tenant admin rules → user preferences → role defaults)
- Invoice list: 5-column layout, combined FIRS/payment status pill, due date colour logic, distinct action icons
- Excel exports: invoice list, submissions history, audit log
- Credit note visibility fix applied

### How Kay Works With Claude
- Development driven by Claude Code prompts generated in Claude chat sessions, executed in the Codespace
- Multi-terminal workflow: Terminal 1 (backend), Terminal 2 (frontend), Terminal 3 (Claude Code)
- Engineers review, deploy, and maintain the codebase — Claude accelerates engineers, not replaces them
- Solo deployment of a regulated financial product without engineering oversight is unacceptable risk
- Kay shares screenshots and database outputs to verify feature behaviour before moving to the next task
- Features built in phases with clear scope per branch, then merged
- Backend-to-frontend audits (scanning controllers against page directories) used to confirm coverage before adding new layers
- Push back when suggestions add unnecessary complexity
- Brand colour: #1D9E75 (green); UI icons: Tabler Icons
