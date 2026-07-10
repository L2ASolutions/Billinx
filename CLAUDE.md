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
│   │   ├── database/      PrismaService (two-client: app role + owner/admin role; FORCE RLS + $extends)
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
- **TokenService** — Issue/rotate access + refresh token pairs using **RS256 asymmetric signing** via `SecretsService` (`getJwtPrivateKey` / `getJwtPublicKey`); `jwt.verify` pins `algorithms: ['RS256']`; lifetimes configurable via `JWT_ACCESS_TOKEN_EXPIRY` / `JWT_REFRESH_TOKEN_EXPIRY` env vars (e.g. `15m`, `7d`; defaults: 15 min / 7 days). No symmetric secret or hardcoded fallback.
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
- **File upload security (enforced on `POST :id/attachment`):**
  - Stream-level size limit: `FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } })` prevents Multer from buffering the full body before rejecting oversized uploads.
  - Controller-layer size check: `ParseFilePipe` + `MaxFileSizeValidator` (10 MB, `errorHttpStatusCode: 400`) runs before the service handler is reached — belt-and-suspenders, unit-testable.
  - Magic-byte MIME verification: `file-type@16` reads the actual bytes and confirms the file is PDF/JPEG/PNG; rejects if the detected type is not in the allowed set, or if it disagrees with the client-supplied `Content-Type`. The verified MIME type (not the client-supplied value) is stored in the database.
  - Allowed types: `application/pdf`, `image/jpeg`, `image/png`.
  - S3/object-storage migration is pending AWS setup (planned as a follow-up — currently stored as `attachmentData` BYTEA in Postgres).

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

**Note on architecture drift:** CLAUDE.md previously listed `compliance/` and `validation/` as separate top-level module directories. They do not exist as separate modules.

**FIRS validation is now handled by `InvoiceValidationService`** (`src/modules/invoice/services/invoice-validation.service.ts`) — the single source of truth for all invoice field rules. All three entry points delegate to it:

- `createInvoice()` → `validateInvoiceFields(dto, 'CREATE')` — throws; lineItems/totalAmount not required (DRAFT permissiveness); buyer.tin required for B2B/B2G.
- `submitDraft()` → `validateInvoiceFields(dto, 'SUBMIT')` — throws; all CREATE rules plus lineItems non-empty and totalAmount > 0.
- `validateInvoice()` / `POST /v1/invoices/validate` → `validateInvoiceFields(dto, 'VALIDATE')` — collects errors into `ValidationResponse` (mirrors SUBMIT rules so pre-flight matches submit behaviour).

`originalIrn` is required for credit/debit notes across all contexts; checks all four code forms: `'380'`, `'384'`, `'CREDIT_NOTE'`, `'DEBIT_NOTE'`. Missing `hsnCode` is a WARNING in VALIDATE, not an error. The three previously-divergent inline rule sets have been removed from `invoice.service.ts`.

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
20260709000000_enforce_rls_and_app_role  # fix/rls-enforcement — FORCE ROW LEVEL SECURITY on all tenant tables + billinx_app non-owner role
```

41 migrations applied as of 2026-07-09; database schema confirmed in sync via `npx prisma migrate status`.

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
- **Two-client architecture** (migration `20260709000000_enforce_rls_and_app_role`):
  - Main client (`this`, `DATABASE_URL`) connects as the non-owner `billinx_app` role in production. `FORCE ROW LEVEL SECURITY` is set on all tenant-scoped tables so RLS policies are enforced even if that role were ever granted ownership — and more importantly, they are enforced on the non-superuser `billinx_app` role that cannot bypass them.
  - Admin client (`adminClient`, `MIGRATION_DATABASE_URL`) connects as the owner/superuser `billinx` role and is used exclusively inside `asAdmin()`.
- **RLS scoping via `$extends`**: the main client uses a Prisma `$extends` `$allOperations` hook that batches `SELECT set_config('app.current_tenant_id', tenantId, true)` and the actual query in the **same `$transaction([...])`** call so the GUC value is visible to the RLS policy when the query executes. The old `$use` middleware fired `SET LOCAL` on a pooled connection that was unrelated to the query connection — that bug is now fixed.
- **`asAdmin()`** wraps the admin client in a transaction with `SET LOCAL row_security = OFF`; this succeeds because the admin client connects as the superuser `billinx`.
- **Production requirement**: `DATABASE_URL` must connect as `billinx_app`; `MIGRATION_DATABASE_URL` must connect as the owner role (`billinx`). Both are required at startup in production — `MIGRATION_DATABASE_URL` is in `PRODUCTION_REQUIRED_VARS` in `config.validation.ts`.
- **Manual `tenantId` filters are still in place** as defence-in-depth — RLS is an additional layer, not a replacement for them.

---

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
| `pr-checks.yml` | Pull request | Type-check + lint + unit tests + `npm audit --audit-level=high` + Docker build check (no push) + **gitleaks secret scan** + **TruffleHog secret scan** |
| `codeql.yml` | Push to `main` + Pull request | CodeQL static analysis (TypeScript, `security-extended` query suite) |

Deployment pipeline: test → build-and-push (incl. Trivy image scan) → migrate → deploy (needs both build-and-push AND migrate). Auto-rollback: if `/health` fails after 10 retries × 15s, previous ECS task definition is restored.

**Required checks before any PR can merge:** type-check, lint, unit tests, dependency audit, RLS isolation test, Docker build, gitleaks secret scan, TruffleHog secret scan, and CodeQL analysis. All must be green; none can be skipped.

Secret scanning notes:
- `gitleaks/gitleaks-action@v2` scans commits introduced by the PR; `.gitleaks.toml` allowlists two commits containing a known-inert RSA placeholder pending a git-history scrub.
- `trufflesecurity/trufflehog@main` scans the full git history (`base: ""`) with `--only-verified`; the inert placeholder is suppressed automatically because it cannot verify against any real service. See `.trufflehog.yml` for the full rationale.
- CodeQL runs on both PRs and every push to `main`; results appear in the GitHub Security tab.

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
- Development required: `JWT_PRIVATE_KEY` (PEM RSA private key — generate with `openssl genrsa -out private.key 2048 && openssl rsa -in private.key -pubout -out public.key`, then set `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`)

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

### Current State (as of 2026-07-09)
- 152+ PRs merged to main (through PR #188)
- 863 tests passing, 56 suites, 45 DB models, 21 enums (payment + webhook + identity/auth + user module tests added 2026-07-04; tenant, admin, kyb, consent, product-catalog, export, reference-data, submission-adapter, client, analytics, inventory, notification, and reminder module tests added 2026-07-05 — every backend module now has at least some test coverage; was 83/5, unchanged since 2026-06-11, until then; state-machine spec rescued from the orphaned `test/unit/` tree and colocated into `src/` 2026-07-06, adding 15 more; payment httpsRequest timeout/size-cap tests added 2026-07-06, adding 2 more; invoice controller split into 4 auth-scoped controllers 2026-07-06 with 47 new delegation tests — first-ever test coverage for this controller; JWT auth wired to RS256 via SecretsService 2026-07-09, adding 8 new tests — config.validation spec + updated token.service spec; RLS enforcement 2026-07-09, adding 1 new unit test — 3 integration tests in separate suite `test:integration`; unified InvoiceValidationService 2026-07-10 with 24 new tests — upload security 10 new tests adding to 839 then +24 = 863)
- Last merged PRs: #188 refactor/split-invoice-controller, #187 fix/harden-payment-https-client

### Open Issues

**Resolved since 2026-06-11 (kept here so nobody re-investigates them):**
- ~~Ghost endpoint `POST /v1/invoices/dashboard/:id/reminder`~~ — now implemented (`invoice.controller.ts`, "Send Reminder" button on invoice detail page works).
- ~~Ghost endpoint `POST /v1/auth/mfa/resend`~~ — route now exists, but is a **deliberate permanent stub** that always returns 400 ("TOTP codes are generated by your authenticator app and cannot be resent"). The frontend still shows a "Resend code" link on the MFA login page that can never succeed — needs UX follow-up (remove the link or change copy), not a backend fix.

**Security (from 2026-07-04 audit — see full report in project history for details):**
0. ~~JWT auth used HS256 with a hardcoded symmetric secret fallback (`'billinx-dev-secret-key-change-in-production'`); `JWT_SECRET` was not required in production; `jwt.verify` did not pin algorithms~~ — **fixed 2026-07-09 (PR fix/jwt-rs256).** `TokenService` and `UserService.issueAccessToken` now sign with RS256 via `SecretsService.getJwtPrivateKey()` and verify with `getJwtPublicKey()` with `algorithms: ['RS256']` pinned. `MfaService` MFA challenge tokens now derive their HMAC secret from `getMasterEncryptionKey()` (HMAC-SHA256 namespaced with `'mfa-challenge'`). `JWT_SECRET` removed from all code paths; `JWT_PRIVATE_KEY` added to development-required validation; `JWT_PRIVATE_KEY_SECRET_ID`/`JWT_PUBLIC_KEY_SECRET_ID` were already in production-required validation. 8 new tests: `config.validation.spec.ts` (startup refusal without key IDs in prod) + updated `token.service.spec.ts` (RS256 sign/verify, HS256 rejection, forged-admin-token rejection). Old secret (`billinx-dev-secret-key-change-in-production`) was never production material but should be considered public — rotate any env that happened to have it set as `JWT_SECRET`.
1. ~~RSA private key committed to git history~~ — **investigated and downgraded, false alarm.** Commit `3c11a74` (2026-05-16, removed next day in `e4e9248`) added a `DEV_RSA_PRIVATE_KEY` constant that *looks* like a PEM block but fails `openssl rsa -check` — only 3 lines of base64 body, not a parseable RSA-2048 key. It's an inert placeholder string, not real key material, and the code path was gated behind `!isProduction` so it never touched the production signing path. **No rotation needed.** Still worth a git-history cleanup for hygiene (see below) so it doesn't trip future secret scanners as a false positive, but this is not an active exposure.
2. ~~Admin IP allowlist (`AdminIpGuard`) fails open~~ — **guard now fails closed in production (PR fix/security-fail-closed-guard-and-cors, 2026-07-09).** When `ADMIN_ALLOWED_IPS` is absent and `NODE_ENV=production`, `canActivate` throws `ForbiddenException` — all `/v1/admin/*` requests return 403 rather than allowing any IP. In development/test the guard still allows through with a warning log (to not break local dev). **Still needed to fully close:** the real IP/CIDR list (office IP, staff VPN CIDR — only Kay/the team knows these) must be set in `ADMIN_ALLOWED_IPS` in the ECS task environment and a `terraform apply` run by someone with AWS access. The Terraform wiring (`infra/variables.tf`, `infra/main.tf`, `docker/ecs-task-definition.json`) is already in place from 2026-07-04. Until the real value is deployed, production admin routes remain locked at 403 rather than open to the world — a secure default.
3. ~~Payment endpoints have no auth or rate limiting~~ — **fixed 2026-07-04.** Added `PaymentRateLimitGuard` (`src/shared/guards/payment-rate-limit.guard.ts`, 10 requests / 5 min per IP, same fixed-window Redis primitive as `AuthRateLimitGuard`/`TenantRateLimitInterceptor`, fails open on Redis outage — consistent with the rest of the app's non-auth rate limiting). Applied to `POST /v1/payments/paystack/initialize`, `GET .../paystack/verify/:reference`, `POST .../flutterwave/initialize`. Webhook receivers were left unguarded by design (already HMAC-verified; rate-limiting them risks dropping legitimate provider retries). Verified live: 11th request in the window correctly returns `429` with `X-RateLimit-*`/`Retry-After` headers; build, full app boot, and existing test suite (83/83) all still pass.
   - ~~zero test coverage~~ — **fixed 2026-07-04.** Added `payment.service.spec.ts` (28 tests: initialize/verify/webhook happy paths for both providers, invoice-not-found/not-accepted/already-paid guards, not-configured guards, kobo-vs-naira amount conversion, invoiceId recovery from both metadata and regex-parsed reference — including the malformed-reference case that returns null, network-error propagation, webhook dedup/missing-invoice/zero-amount/email-notification side effects), `payment.controller.spec.ts` (11 tests: route delegation, Paystack HMAC-SHA512 signature verification, Flutterwave verif-hash check, both "secret not configured" bypass paths), and `payment-rate-limit.guard.spec.ts` (5 tests for the guard added earlier this session). 44 new tests total (28+11+5), all passing; `tsc`/`nest build`/lint all clean.
   - ~~`PaymentProviderService` still rolls its own raw `https` client instead of a vetted Paystack/Flutterwave SDK~~ — **investigated 2026-07-06, swap rejected, hardened instead.** Checked both providers' official Node SDKs before touching anything: `flutterwave-node-v3` has no method for the Standard hosted-checkout flow (`POST /v3/payments` → `data.link`) Billinx actually uses — it only wraps Direct Charge APIs (card/mobile-money forms embedded in your own UI), so there's no drop-in replacement for the call in use. `@paystack/paystack-sdk` (v1.0.1) is worse than it looks: its `package.json` `typings` field points at a file that doesn't exist in the published package, so importing it under this repo's `strict`/`noImplicitAny` `tsconfig` fails to compile (`TS7016`) unless you add an `any`-typed ambient module shim — confirmed by actually installing it and running `tsc --noEmit`. It also still uses raw `https` internally with no HTTP-status-code check, so it wouldn't have been a transport-layer improvement even if the types worked. Adopting either "official" SDK would have traded a working, tested client for a less-typed, no-better-tested one. Instead hardened the existing `httpsRequest` helper in `payment.service.ts` (shared by both providers) with the two real gaps it had: a 20s socket timeout (`req.on('timeout', ...)` → `req.destroy()`, previously a hung Paystack/Flutterwave connection would block the request indefinitely) and a 5MB response-size cap (destroys the response and rejects if exceeded, previously an unbounded body would be buffered fully in memory before `JSON.parse`). Regex-based invoice-ID recovery as a webhook fallback remains, unchanged — still covered by existing tests. 2 new tests added for the timeout/size-cap paths (771 tests / 50 suites total, up from 769/50); `tsc`/`nest build` clean; booted the app and confirmed the payment endpoints still route correctly.
4. ~~No rate limiting on `auth/reset-password`, `auth/accept-invitation`, `users/request-access`, `kyb/tin-confirm`, or `reference-data` search endpoints~~ — **fixed 2026-07-04.** `reset-password`, `accept-invitation`, and `request-access` now use the existing `AuthRateLimitGuard` (5/15min per IP, shared bucket with login/register/forgot-password on that same IP — this is existing, intentional behavior, not new). `kyb/tin-confirm` also now uses `AuthRateLimitGuard`. `reference-data`'s `hs-codes`/`service-codes` search endpoints got a new, more generous `ReferenceSearchRateLimitGuard` (60/5min per IP — sized for real usage, since the frontend debounces search input at 300ms and a user builds an invoice with many line items in one sitting; a tight limit would have broken the actual feature). Also fixed the unbounded `limit`/`offset` query params on `hs-codes`/`service-codes` — now clamped server-side to 1–100 / ≥0 regardless of what's requested. All verified live: booted the app, hit each endpoint past its threshold and confirmed `429` + correct `X-RateLimit-*`/`Retry-After` headers; confirmed `limit=99999` clamps to 100 and negative values clamp to the floor; full test suite (83/83) and `tsc`/`nest build` still clean throughout.
5. ~~`dump.rdb` and `..env.swp` are committed to the repo; neither `*.swp`/`*.swo` nor `dump.rdb` is in `.gitignore`~~ — **fixed 2026-07-06.** Added `*.swp`, `*.swo`, and `dump.rdb` to `.gitignore`, removed both files from the working tree/index. Note: this only stops recurrence going forward — the files (`..env.swp` in particular, a vim swapfile that may contain a past `.env`'s contents) remain in git history and would need a separate history-rewrite pass (`git filter-repo` or similar) to fully purge, same caveat as the RSA-key false-alarm item above. Not investigated further here since a history rewrite is a bigger, riskier operation that needs explicit sign-off.
6. ~~`ALLOWED_ORIGINS` and `ADMIN_ALLOWED_IPS` not validated at startup~~ — **fixed 2026-07-09 (PR fix/security-fail-closed-guard-and-cors).** `ALLOWED_ORIGINS` is now in `PRODUCTION_REQUIRED_VARS` — the app refuses to boot in production without it (empty CORS allowlist would block all browser clients). `ADMIN_ALLOWED_IPS` is enforced at the guard level — all `/v1/admin/*` routes return 403 in production when unset (see Open Issue 2 above). Still unvalidated at startup: `INTERSWITCH_PROD_URL` (falls back to a hardcoded URL if unset), `CAC_API_KEY`. `NRS_API_BASE_URL` is documented everywhere but unused in code — dead config.
7. ~~Tenant isolation relied solely on ~217 manual `tenantId` checks; Postgres RLS bypassed for the owner role~~ — **fixed 2026-07-09 (PR fix/rls-enforcement).** Migration `20260709000000_enforce_rls_and_app_role` adds `FORCE ROW LEVEL SECURITY` to all 30 tenant-scoped tables and creates the `billinx_app` non-owner, non-superuser Postgres role. The app connects as `billinx_app` in production (`DATABASE_URL`) so RLS policies are enforced unconditionally — FORCE RLS applies even to the `billinx_app` role that is not a superuser. `PrismaService` now uses `$extends`+`$transaction([set_config, query])` to correctly scope `app.current_tenant_id` inside the query's own connection/transaction (the old `$use` middleware fired on a different pooled connection). `asAdmin()` uses a separate admin-role client (`MIGRATION_DATABASE_URL`) with `SET LOCAL row_security = OFF`. Manual `tenantId` filters remain as defence-in-depth. Cross-tenant isolation verified by automated integration test (`test/rls-isolation.integration-spec.ts`, 3 tests, wired into CI `rls-isolation` job) that FAILS before the migration and PASSES after.
8. ~~BullMQ queues are constructed as module-level singletons that eagerly open a live Redis connection at import time~~ — **fully fixed 2026-07-04.** Found while writing webhook tests (a test hung indefinitely; root cause was importing `WebhookService` transitively opening a real, never-closed Redis connection via `new Queue(...)` at the top of `webhook.queue.ts`). All four queue files in the codebase used this pattern and are now fixed the same way — the queue is built lazily on first actual use (`getSubmissionQueue()`, `getBulkSubmissionQueue()`, `getVatReminderQueue()`, and webhook's equivalent), not at module import time:
   - `webhook.queue.ts` — no external call sites, self-contained fix.
   - `submission.queue.ts` — call sites updated: `health.controller.ts` (the endpoint AWS ECS/CI use to decide on deploy rollback) and `admin.service.ts` (`getQueueStatus`, `retryFailedJobs`).
   - `bulk-submission.queue.ts` — call site updated: `admin.service.ts` (`getBulkQueueStatus`).
   - `invoice/vat-reminder.queue.ts` — call site updated: `vat-reminder.scheduler.ts` (still only invoked inside `onModuleInit`, which is fine — Nest lifecycle hooks aren't the "just importing the file" problem this was fixing).
   Verified: `tsc`/`nest build`/lint clean, full suite (188/188) clean with normal exit, and — since this touched the deploy health-check endpoint specifically — booted the real app and confirmed `GET /health` still returns `"queue": { "depth": 0 }` correctly through the new lazy getter.
   Considered but not done: migrating to `@nestjs/bullmq`'s `BullModule.registerQueue()` (already an installed but unused dependency) would be the more idiomatic long-term fix, but is a bigger change touching how all four queues and their workers are wired — left as a separate decision for the team, not bundled into this fix.
9. ~~CodeQL High: insecure Helmet configuration (`src/main.ts`) — `contentSecurityPolicy: false`, no CSP at all~~ — **fixed 2026-07-10 (PR fix/security-helmet-csp-and-property-injection).** The Helmet setup is now in `src/shared/security/security-headers.ts` (`buildHelmetOptions`/`applySecurityHeaders`, called from `main.ts`), with all six recommended directives explicitly enabled and none disabled: `contentSecurityPolicy` (locked to `'self'`/`'none'` for this JSON API; `script-src`/`style-src` relax to add `'unsafe-inline'` only when `NODE_ENV !== 'production'`, since `/docs` — Swagger UI, itself only mounted outside production — needs inline scripts/styles to render), `strictTransportSecurity` (`hsts`, unchanged: 1yr, includeSubDomains, preload), `noSniff`, `frameguard` (`action: 'deny'` — this API is never meant to be framed, stricter than the previous implicit `SAMEORIGIN` default), `xssFilter` (explicitly sets `X-XSS-Protection: 0`, matching Helmet's own default/current OWASP guidance — the legacy browser XSS auditor this header once enabled is deprecated and was itself a vulnerability source; CSP is the modern replacement), and `hidePoweredBy`. 8 new tests in `security-headers.spec.ts`: `buildHelmetOptions` never disables any of the six regardless of environment, and an `applySecurityHeaders`-on-a-real-Express-app + supertest check confirms each header is actually present on a response (previously only CSP was missing — the other five were already correctly enabled via Helmet's untouched defaults, confirmed by inspecting a live response before this fix).
10. ~~CodeQL High: remote property injection (`src/modules/invoice/bulk/bulk-invoice.service.ts` `parseCsv()`) — `row[h] = values[idx]` assigns directly from uploaded CSV header cells~~ — **fixed 2026-07-10 (same PR as #9).** A bulk-CSV upload's header row is fully attacker-controlled; assigning every column name as an object key without restriction let a header literally named `__proto__`, `constructor`, or `prototype` reach a dynamic property assignment. Fixed with an explicit `ALLOWED_CSV_HEADERS` whitelist (the exact 18 keys `mapCsvRowToInvoice()` actually reads) — any other header, dangerous or not, is silently dropped rather than assigned — plus `Object.create(null)` for the per-row object as defence-in-depth (a null-prototype object has no `__proto__` accessor to hijack even if a dangerous key somehow got whitelisted later). 3 new tests in `bulk-invoice.service.spec.ts` confirm `__proto__`/`constructor`/`prototype` columns are dropped without touching the global `Object.prototype`, that row objects genuinely have a null prototype, and that the whitelist rejects unrecognised headers generally (not just the three classic pollution keys).
11. ~~Dependabot: `uuid` moderate (missing buffer bounds check in v3/v5/v6, alert #20) and `js-yaml` moderate (quadratic-complexity DoS in merge-key handling, alerts #34/#35)~~ — **fixed 2026-07-10 (PR fix/deps-uuid-js-yaml).** Neither package was a direct dependency — both were transitive. `uuid` (was 8.3.2) is pulled in only by `exceljs`, whose latest stable release (4.4.0) still requires `uuid@^8.3.0`, so no parent-version bump could fix it; added a top-level `overrides.uuid: "^14.0.1"` in `package.json` instead. Verified the only in-tree usage (`exceljs`'s `const {v4: uuidv4} = require('uuid')`) only touches the `v4` named export, which is unchanged in the new major versions, so no code changes were needed. `js-yaml` had two vulnerable copies: the hoisted top-level one (4.1.1, pulled in by `@nestjs/swagger`) was fixed by bumping `@nestjs/swagger` from `^11.4.2` to `^11.4.5` (its dependency pin moved from `js-yaml@4.1.1` to the patched `js-yaml@4.3.0`, and `@eslint/eslintrc`/`cosmiconfig`'s ranges both already permit 4.3.0 so it hoists cleanly); a second, older copy (3.14.2) nested under `@istanbuljs/load-nyc-config` (a dev-only transitive dep of `babel-plugin-istanbul`, used for Jest coverage) needed its own targeted override — `overrides["@istanbuljs/load-nyc-config"].js-yaml: "^3.15.0"` — since bumping it to the 4.x line would have been a breaking major-version jump for that package. `npm audit` went from 4 moderate findings to 0; full suite (874 tests / 58 suites) and `nest build` both clean after the change.

**Test coverage** — thinner than previously documented:
- Real coverage exists for: invoice-flow, XML builder, incoming-invoice, VAT service, and (added 2026-07-04) payment, webhook, identity/auth, and user, and (added 2026-07-05) tenant, admin, kyb, consent, product-catalog, export, reference-data, submission adapters, client, analytics, inventory, notification, and reminder (769 tests / 50 suites total) — this closes out the last module that had zero coverage; every backend module now has some real tests, though depth still varies a lot by module (see the per-module notes below and the frontend items after).
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
  - ~~Noted but not de-duplicated: `src/modules/admin/guards/admin-jwt.guard.ts` is a byte-identical copy of `src/modules/identity/guards/admin-jwt.guard.ts`~~ — **collapsed 2026-07-06.** `identity/guards/admin-jwt.guard.ts` had zero real call sites (only `AdminController`/`ActivityController`/`KybController` import the `admin/guards/` copy) — its 5-test spec was the only thing pointing at it. Deleted the unused `identity/guards/` copy and its spec, and moved the spec to sit next to the actually-wired `admin/guards/admin-jwt.guard.ts` instead (no import-path changes needed, spec already used a relative `./admin-jwt.guard` import). Net effect: one guard file instead of two, and the guard that's actually on the request path now has test coverage instead of its unused twin. `tsc`/`nest build` clean, full suite still 769/50, and verified live — booted the app and confirmed `GET /v1/activity/export` (guarded by this same class) still correctly returns `401` with no token.
  - Webhook coverage (`webhook.service.spec.ts`, 52 tests; `webhook.controller.spec.ts`, 9 tests) includes the SSRF-protection allow/block list in `validateUrl` (private IPv4/IPv6 ranges, `.local`/`.internal`, AWS metadata endpoint), delivery retry/dead-letter math against `MAX_ATTEMPTS`, and the outbound HMAC-SHA256 delivery signature — the `WebhookWorker`'s BullMQ wiring itself is intentionally untested (no business logic there beyond calling `processDelivery`, which is covered).
  - Identity/auth coverage (74 tests across 9 files: `token.service.spec.ts` 11 (rewritten for RS256 + 3 new: HS256-rejection, forged-admin-token, algorithm-pinning), `api-key.service.spec.ts` 20, `jwt.guard.spec.ts` 6, `api-key.guard.spec.ts` 5, `admin-key.guard.spec.ts` 4, `admin-jwt.guard.spec.ts` 5, `flex-auth.guard.spec.ts` 3, `identity.controller.spec.ts` 12, `config.validation.spec.ts` 6 (new — startup refusal without key IDs)) covers RS256 JWT issue/verify/rotate using test-generated RSA key pairs (no env vars), HS256 rejection and forged-token rejection, startup validation refusal without key IDs, API key lifecycle (create/verify/revoke/rotate-with-grace-period/list) and the expiry-warning cron (OWNER-only, urgency threshold), and all five auth guards (`JwtGuard`, `ApiKeyGuard`, `AdminKeyGuard`, `AdminJwtGuard`, `FlexAuthGuard`'s JWT-then-API-key fallback). The orphaned `test/unit/identity/api-key.service.spec.ts` (previously dead — never executed by any npm script) was deleted, superseded by the new, properly-located, more thorough version.
  - User module coverage (98 tests across 3 files: `mfa.service.spec.ts` 17, `user.service.spec.ts` 46, `user.controller.spec.ts` 35) covers real RFC-6238 TOTP generation/verification (not mocked — tests compute valid codes against the actual algorithm), backup-code consumption, login's account-lockout/MFA-branch/privileged-role-setup-prompt logic, invitation and password-reset token lifecycles (expired/used/invalid), and the two chunks of real business logic embedded in the controller itself: the tenant-profile allow-listed-field + address-JSON-merge logic in `updateMyTenant`, and the per-role dashboard-visibility defaults-merge + validation in `getDashboardVisibility`/`updateDashboardVisibility`.
- ~~Two spec files remain orphaned under `test/unit/`~~ — **fixed 2026-07-06.** `test/unit/invoice/xml-invoice.builder.spec.ts` was a stale duplicate missing newer test cases (`ClassifiedTaxCategory`/`taxCode` round-trip) already present in the real, running `src/modules/invoice/services/xml-invoice.builder.spec.ts` — deleted outright. `test/unit/invoice/state-machine.spec.ts` had no colocated equivalent, so it was moved (import path updated, content otherwise unchanged) to `src/modules/invoice/services/state-machine.service.spec.ts`, matching the project's colocated-spec convention; its 15 tests now actually run. The now-empty `test/unit/` directory was removed. (A third previously-orphaned file, `identity/api-key.service.spec.ts`, was deleted 2026-07-04 — superseded by a proper, more thorough version at `src/modules/identity/services/api-key.service.spec.ts`.)
- Frontend has zero test infrastructure (no framework, no config, no test script).

**Dead/misleading UI:**
- `adminApi.exportPlatformCsv` and `adminApi.unlockAccount` are fully wired in the frontend API client (`lib/api.ts`) but have **no UI caller anywhere** — admin staff cannot actually trigger a platform-wide CSV export or unlock a locked account from any screen today.
- The "Live chat" support button always falls back to `mailto:` because Intercom is never loaded in the app, despite UI copy promising live chat.
- Two permanently-disabled "Coming soon" toggles in Settings (POS Integration, Email Invoice Intake) advertise unbuilt features.

### Engineer To-Dos (do not run through Claude Code without engineering review)
**Backend refactors — grew, not shrunk, since last noted:**
- `invoice.service.ts` — still large god service: create, validate, XML, draft, duplicate, stats, charts, sample. The three-divergent-validation-sets problem is **resolved** (PR #194 `refactor/unified-invoice-validation`) — all field validation now delegates to `InvoiceValidationService`. Remaining split plan (phased: dashboard/analytics extraction → mapper/export helpers → draft/lifecycle extraction) is still pending engineering review.
- ~~`invoice.controller.ts` — 786 lines — two auth surfaces in one file~~ — **split 2026-07-06.** This was the lower-risk half of the plan above (pure route reorganization, no business-logic changes) and was done after the plan was reviewed. Turned out to be four auth surfaces, not two — the `export/csv`, `export/json`, `export/monthly` routes live under the non-`dashboard/` URL prefix but actually use `JwtGuard` like the dashboard routes do, not `ApiKeyGuard` like their neighboring routes. Split into `InvoiceApiController` (`v1/invoices`, `ApiKeyGuard` — external ERP-facing routes), `InvoiceExportController` (`v1/invoices/export`, `JwtGuard` — the misplaced-prefix reporting routes), `InvoiceDashboardController` (`v1/invoices/dashboard`, `JwtGuard`+`RolesGuard` — internal frontend), and `InvoicePublicController` (`v1/invoices`, no guard — the one public payment-page route). Also dropped a `Logger` field that was instantiated but never called anywhere in the original file. Zero business logic changed — every route path, guard, and response is identical to before. The controller had **zero test coverage** before this (no spec file existed); added 47 delegation tests across the 4 new files (818 tests / 54 suites total, up from 771/50). Verified live: rebuilt, booted, and confirmed all four auth boundaries behave identically to before (401/401/401/404 on the four representative routes) plus a full `RouterExplorer` route-count diff against the original 37 routes.
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
