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

Swagger UI: `http://localhost:3000/api/docs` (raw OpenAPI JSON: `GET /api/docs-json`). Live in every environment — in production both routes require a valid Bearer JWT (same RS256 access token as dashboard auth); in development/test they're open. All 27 controllers are tagged (`Invoices`, `Purchase Invoices`, `Products`, `Team`, `VAT & Compliance`, `Reports`, `Webhooks`, `Settings`, `Auth`, plus module-specific tags for the rest) with `@ApiOperation`/`@ApiResponse`/`@ApiBearerAuth` on every endpoint; request/response examples are on the create-invoice, submit-invoice, PDF download, NRS payload preview, and VAT return summary endpoints specifically.
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
│   ├── schema.prisma      Full data model (45 models, 23 enums)
│   └── migrations/        45 applied migrations (chronological below)
├── infra/                 Terraform: VPC, ECS Fargate, RDS, ElastiCache, ALB, ECR, Secrets
├── scripts/               AWS setup, secret rotation, migration runner, health check
├── docs/                  Deployment runbook, NRS/Interswitch API specs, invoice schema
└── .env.example           All environment variables with descriptions
```

---

## Modules

### identity
- **ApiKeyGuard** — Bearer token; validates format (`/^blx_(live|test)_[A-Za-z0-9_-]{20,}$/`) before bcrypt; injects `RequestContext` (incl. `scopes`, see below); extracts `clientIp` from `X-Forwarded-For`
- **JwtGuard** — Bearer JWT; verifies RS256 signature; injects `RequestContext`
- **AdminKeyGuard** — `X-Admin-Key` header; bcrypt compare to stored hash
- **TokenService** — Issue/rotate access + refresh token pairs using **RS256 asymmetric signing** via `SecretsService` (`getJwtPrivateKey` / `getJwtPublicKey`); `jwt.verify` pins `algorithms: ['RS256']`; lifetimes configurable via `JWT_ACCESS_TOKEN_EXPIRY` / `JWT_REFRESH_TOKEN_EXPIRY` env vars (e.g. `15m`, `7d`; defaults: 15 min / 7 days). No symmetric secret or hardcoded fallback.
- **ApiKeyService** — Create, list, revoke, rotate tenant API keys; tracks `requestCount` and `lastUsedIp` per key; daily cron sends 7-day and 1-day expiry warnings by email
- Rotation: `POST /v1/api-keys/:keyId/rotate` — zero-downtime rotation with 24h grace period on old key; the new key **carries forward the old key's `scopes` unchanged** (rotation cannot escalate access)
- Endpoints: `POST /v1/auth/token`, `/auth/refresh`, `/auth/revoke`, `/v1/api-keys` CRUD + rotate
- **API key scopes** (added 2026-07-18, migration `20260718195736_add_api_key_scopes`) — `ApiKey.scopes: String[]`, default `["*"]` (full access, matching every key created before scopes existed — no behaviour change for existing integrations). `CreateApiKeyRequest.scopes?: ApiKeyScope[]` (`packages/types/identity.ts`) lets a caller mint a narrower key; the Settings → API Keys UI exposes this as a simple **Read only / Full access** toggle rather than per-scope checkboxes — read-only maps to `["invoices:read", "submissions:read", "products:read", "reports:read"]`, full access to `["*"]`. Enforced by a new `ScopeGuard` + `@RequireScope(...scopes)` decorator (`src/shared/guards/scope.guard.ts`, `src/shared/decorators/require-scope.decorator.ts`), mirroring the existing `RolesGuard`/`@Roles()` pattern exactly: `ScopeGuard` is a no-op for JWT/admin/system actors (`ctx.actorType !== 'apikey'`) since scopes are an API-key-only concept — JWT dashboard users are governed by `RolesGuard` instead — and a key carrying `"*"` satisfies any required scope. Applied only to the controllers that were already `ApiKeyGuard`/`FlexAuthGuard`-protected (no new API-key-reachable surface was added): `invoice-api.controller.ts` (`invoices:read` on GET routes, `invoices:write` on POST/PATCH routes), `bulk-invoice.controller.ts`'s API-key routes (`submissions:write` on the two submit routes, `submissions:read` on batch-status), and `activity.controller.ts`'s two `FlexAuthGuard` routes (`reports:read`). **Deliberately not scoped:** `webhook.controller.ts` — none of the given scope names (invoices/submissions/products/reports) fit webhook management, and inventing a new scope category wasn't part of this task; it remains reachable by any valid key regardless of scope, unchanged from before. **One addition beyond the literal spec:** `POST /v1/api-keys` (creating a new key) now requires a full-access (`"*"`) key — a read-only key could otherwise mint itself a brand-new full-access key via the `scopes` field in its own request body, which would have been a real privilege-escalation hole. `GET/POST-rotate/DELETE /v1/api-keys` (list/rotate/revoke) were deliberately left unscoped: rotation carries forward the caller's existing scopes (can't escalate), and there's no scope in the given taxonomy that cleanly covers key-management actions.
- **Per-API-key rate limiting** (added 2026-07-18) — `TenantRateLimitInterceptor` (`src/shared/interceptors/tenant-rate-limit.interceptor.ts`) now keys the Redis bucket for `actorType === 'apikey'` requests by `keyId` (`rl:api:key:{keyId}:{hour}`), not `tenantId` (`rl:api:tenant:{tenantId}:{hour}`, still used as a fallback for any other non-JWT actor type). Each key gets its own bucket up to the tenant's tier limit (e.g. three PREMIUM-tier keys under one tenant each get their own 1000/hr budget, rather than sharing one), so a noisy or leaked key can no longer throttle every other integration on the same tenant. JWT dashboard users are unaffected — still bucketed per-tenant on the separate `rl:dashboard:tenant:...` key as before.

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
- **PDF generation** (`InvoicePdfService`, `src/modules/invoice/services/invoice-pdf.service.ts`, added 2026-07-18) — `GET /v1/invoices/dashboard/:id/pdf` (JwtGuard) returns a real NRS-compliant PDF (header/IRN, supplier/buyer, line items, tax summary, totals, NRS Tax Information footer with the QR code) via `@react-pdf/renderer`. **Pinned at `^3.4.5`, not the current `4.x`** — `4.x` ships ESM-only (`"type": "module"`, no CJS `main`/`exports`), which Node's own newer `require(esm)` support loads fine at actual runtime but Jest's module loader cannot parse at all (`SyntaxError: Cannot use import statement outside a module`); `3.4.5` ships a real `./lib/react-pdf.cjs` and works in both. Written with plain `React.createElement` calls (`react@^18` + `@types/react@^18` added as new deps) rather than JSX, so no `.tsx`/`jsx` tsconfig changes were needed anywhere in the backend. The QR code is embedded directly from `Invoice.qrCodeBase64` — already a rendered PNG image, base64-encoded (confirmed via `MockAdapter`'s `QRCode.toBuffer(...).toString('base64')` and the NRS API docs) — so embedding is just `data:image/png;base64,` + the stored string, no `qrcode`-package encode/decode step involved. When `qrCodeBase64` is null (invoices submitted before PR #215), the footer renders the IRN text only and does not crash. The old `GET :id/xml` route is deliberately kept alongside it (not retired) for any direct/API consumers — only the frontend "Download PDF" button was repointed to the new endpoint.
- **NRS JSON payload preview — diagnostic only** (`InterswitchAdapter.previewPayload()`, added 2026-07-18) — `GET /v1/invoices/dashboard/:id/nrs-payload` (JwtGuard + RolesGuard, **OWNER/ADMIN only**) returns, as a downloadable `.json` file, the exact JSON body `InterswitchAdapter.submit()` would POST to `${baseUrl}/Api/SwitchTax/postInvoice` for that invoice — built for testing invoices against the FIRS/NRS sandbox portal directly, without actually submitting through Billinx. It calls the adapter's existing private `buildPayload()` directly (not a reimplementation), so it cannot drift from the real submission payload; a dedicated test (`interswitch.adapter.spec.ts`) diffs `previewPayload()`'s output against what a mocked `submit()` call actually sends over the wire to guarantee this. Replicates `submit()`'s two pre-flight guards (`MISSING_BUSINESS_ID`, `MISSING_CREDENTIALS`) so a preview fails the same way a real submission would rather than emitting an incomplete payload — the controller maps these (plus a new `INVOICE_NOT_FOUND`, including the cross-tenant case) to proper 400/404 responses via a newly-exported `NrsValidationError` class. Never calls `postInvoice()`, never touches invoice status or the state machine, never hits the network at all (verified live and by test) — read-only by construction, not by convention. **The regenerated `irn` and `issue_time` fields are non-deterministic** — `buildPayload()` derives them from `Date.now()` on every call, so two downloads of the same invoice will differ in exactly those two fields; the response includes a `preview_note` field flagging this so it doesn't look like a bug. Frontend: "Download NRS Payload" button on the invoice detail page (`apps/web/app/(dashboard)/invoices/[id]/page.tsx`), gated client-side on `user.role === 'OWNER' | 'ADMIN'` to match the backend guard, downloads `nrs-payload-{IRN}.json`.
- **Recurring invoices** (`RecurringInvoiceService`/`RecurringInvoiceController`/`RecurringInvoiceScheduler`, `src/modules/invoice/services/recurring-invoice.service.ts` + `recurring-invoice.controller.ts` + `recurring-invoice.scheduler.ts`, added 2026-07-21) — schedule-driven automatic invoice generation for recurring billing (e.g. monthly retainers). `RecurringInvoice` model stores a reusable `templateData` JSON blob (buyer + line items + invoiceKind/currency/notes) plus `frequency`/`startDate`/`endDate`/`nextRunDate`/`status`/`autoSubmit`/`autoSend`/`invoiceCount`/`lastRunAt`; `Invoice.recurringInvoiceId` links each generated invoice back to its schedule. Endpoints: `POST/GET /v1/invoices/recurring`, `GET/PATCH/DELETE /v1/invoices/recurring/:id`, `POST /v1/invoices/recurring/:id/pause`\|`/resume` — all `JwtGuard`+`RolesGuard('OWNER','ADMIN','ACCOUNTANT')`.
  - **Routing-order hazard, handled deliberately:** `RecurringInvoiceController` (`v1/invoices/recurring`) is registered **first** in `invoice.module.ts`'s `controllers` array, before `InvoiceApiController`. `InvoiceApiController`'s `ApiKeyGuard`-protected `GET(':id')` is a single-segment catch-all on the same `v1/invoices` prefix — Nest/Express resolves overlapping route patterns across controllers in *registration order*, not by pattern specificity, so registered later `GET v1/invoices/recurring` would have been silently shadowed by that `:id` route and returned 401 for every JWT-authenticated caller. Confirmed both ways during live verification (moved-later placement actually 401'd before the fix).
  - **Cron:** `RecurringInvoiceScheduler.runDailyRecurringInvoices()`, `@Cron('0 5 * * *')` (05:00 UTC = 06:00 WAT) — mirrors the `@nestjs/schedule` pattern already used by `reminder.service.ts`/`payment.service.ts`/`api-key.service.ts`/`retention.service.ts` rather than introducing a new BullMQ repeatable-job queue (no scheduled-job queue exists elsewhere in this app; `vat-reminder.scheduler.ts`'s BullMQ-repeat approach is the only precedent and wasn't reused, to stay consistent with the more common pattern). `RecurringInvoiceService.runDueSchedules()` queries `status=ACTIVE AND nextRunDate<=now`, and each schedule runs inside its own try/catch so one failing schedule never blocks the others in the same run — verified live with a 2-schedule batch (1 forced failure, 1 success) returning `{processed:2, succeeded:1, failed:1}`.
  - **Cross-request-context plumbing:** a cron tick has no HTTP request, but `InvoiceService.saveDraftInvoice()`/`submitDraft()`/`sendToBuyer()` and `ActivityService.track()`/`NotificationService.create()` all write via `PrismaService`'s RLS-scoped main client (or `asAdmin()` with manual `tenantId` filters), and the main client only sets the Postgres `app.current_tenant_id` GUC when a CLS request context is present. `RecurringInvoiceService.processSchedule()` wraps the whole per-schedule run in `runWithContext({ tenantId, environment, actor: 'system:recurring-invoice', actorType: 'system', ... }, ...)` — the same mechanism `JwtGuard`/`ApiKeyGuard` use to populate context per-request, just invoked from a cron instead. Nothing in this codebase did this before (every existing daily cron uses `asAdmin()`-only, cross-tenant patterns); this is the first case of reusing tenant-scoped service methods from a cron job.
  - **Invoice generation always goes through `saveDraftInvoice()`, never `createInvoice()`** — `createInvoice()` unconditionally queues the invoice for FIRS submission as its last step, which would defeat `autoSubmit=false` schedules (they'd get submitted anyway). `saveDraftInvoice()` creates a DRAFT with no submission side effect; `submitDraft()` is called as a separate, explicit second step only when `schedule.autoSubmit` is true.
  - **Seller is resolved server-side from the `Tenant` record** (tin/name/registeredAddress) — `templateData` deliberately has no seller block, since a cron has no logged-in user to source it from the way the New Invoice dashboard form does. **Totals (`legalMonetaryTotal`/`taxTotal`) are computed server-side** in `RecurringInvoiceService.calculateTotals()`, deliberately mirroring the New Invoice form's simple flat-vatRate-per-line formula (`qty × unitPrice`, `× (1 + vatRate/100)`) rather than a discount-aware one — there is no shared backend totals-calculation utility anywhere in this codebase (the New Invoice form computes this client-side only), and discount-aware totals were explicitly scoped out as a separate future PR since discounts affect all invoice-creation paths, not just recurring.
  - **`normaliseLineItems()` made public** on `InvoiceService` (was private) specifically so `RecurringInvoiceService.assertTemplateIsSubmittable()` (the `autoSubmit=true` pre-flight check, below) can run the exact same classification-normalisation logic without duplicating it.
  - **Pre-flight validation only when `autoSubmit=true`:** `createSchedule()`/`updateSchedule()` run `InvoiceValidationService.validateInvoiceFields(..., 'VALIDATE')` against the resolved seller + templateData before saving, so a schedule that will actually auto-submit fails loudly at setup time instead of silently failing every cron run. Schedules with `autoSubmit=false` skip this and get the same DRAFT-permissive treatment as `saveDraftInvoice()`'s other callers.
  - **`autoSubmit=false` failure handling:** N/A — `saveDraftInvoice()` doesn't validate, so it essentially can't fail this way. **`autoSubmit=true` failure handling:** if `submitDraft()`'s SUBMIT-context validation throws, it does so *before* any DB mutation (confirmed by reading `submitDraft()`'s implementation), so the just-created invoice is genuinely left as DRAFT — this is the "leave as Draft and notify tenant" case from spec, and the tenant's active OWNER is notified via `NotificationService`. A true **async** NRS rejection (after the invoice has already been queued and moved out of DRAFT) is a separate, later case handled by an `@OnEvent('invoice.rejected')` listener — by then the invoice is legitimately past DRAFT, and forcing it back would mean setting `invoice.status` outside `StateMachineService`, which this codebase never does; the tenant is notified but the invoice is left in its real (rejected) state, consistent with how every other invoice rejection surfaces today (FIRS Rejections dashboard card, webhook, etc.).
  - **`autoSend` cannot fire synchronously inside `processSchedule()`** — `InvoiceService.sendToBuyer()` requires `status === 'ACCEPTED'`, which only exists after the async FIRS submission worker completes, well after `submitDraft()` returns. Handled by a second listener, `@OnEvent('invoice.accepted')`: looks up whether the accepted invoice has a `recurringInvoiceId` and, if its schedule has `autoSend=true`, calls `sendToBuyer()` then. Both listeners no-op immediately for the (overwhelming majority) non-recurring-invoice case.
  - **Real bug caught by live verification, not by unit tests (which mock `submitDraft`):** the first implementation called `submitDraft(draft.id, tenantId, actor, {})` with an empty body for the `autoSubmit` step. `submitDraft()`'s own metadata-merge logic is `sellerParty: request.seller ?? null` / `buyerParty: request.buyer ?? null` — no fallback to the invoice's just-set value — so an empty body silently nulled out the `sellerParty`/`buyerParty` metadata `saveDraftInvoice()` had just written, which broke `sendToBuyer()`'s `buyerParty.email` fallback for every auto-submitted-and-auto-sent recurring invoice (confirmed live: buyer email present in the request, `null` in the DB, `sendToBuyer()` failing with "No buyer email on file"). Fixed by extracting the same `sellerPayload`/`buyerPayload` objects used for `saveDraftInvoice()` and re-passing them to `submitDraft()` instead of `{}` — re-confirmed live afterward (buyer email round-trips correctly, `sendToBuyer()` succeeds, `INVOICE_SENT_TO_BUYER` activity event recorded).
  - Frontend: `apps/web/app/(dashboard)/invoices/recurring/page.tsx` (list view: name/buyer/frequency/next-run/status/invoice-count/actions, status badges, empty state) + `components/RecurringInvoiceFormModal.tsx` (schedule name, frequency, start/end dates, autoSubmit/autoSend toggles, buyer fields, dynamic line-item rows with product/service classification fields, currency, notes). Sidebar: "Recurring Invoices" added to the Finance section immediately below "Sales Invoices" (`apps/web/components/dashboard/Sidebar.tsx`) — note the sidebar's shared `isActive()` prefix-match means "Sales Invoices" (`/invoices`) also lights up while on `/invoices/recurring`, the same way it already does for `/invoices/new` and `/invoices/[id]`; not fixed here, pre-existing behavior of that matching function. Line-item classification (HSN/ISIC + category) is plain text input, not the New Invoice form's catalogue-picker/HS-code-search UI — an intentional scope reduction for this PR.

### submission
- BullMQ job queue; mostly background workers, plus one route: `GET /v1/submissions/export`
- **Adapters** (pluggable): `MockAdapter` (dev), `InterswitchAdapter` (production NRS)
- Max 3 attempts per invoice; final failure → `DEAD_LETTERED`
- Each attempt stored in `SubmissionAttempt` with full request/response payloads
- On success: sets `firsConfirmedIrn`, `qrCodeBase64`, `acceptedAt`
- **UpdateStatus queue** (`queues/update-status.queue.ts` + `workers/update-status.worker.ts`, added 2026-07-18) — `PaymentService.recordPayment()` enqueues an `nrs-update-status` BullMQ job instead of firing-and-forgetting `InterswitchAdapter.updatePaymentStatus()` directly. 3 attempts with a custom 0s/5s/15s backoff strategy (`settings.backoffStrategy` on the Worker, since BullMQ's built-in fixed/exponential backoff can't express this exact schedule). `InterswitchAdapter.updatePaymentStatus()` now returns `Promise<boolean>` (was `Promise<void>`) so the worker can throw on failure and drive the retry — it still never throws itself, just resolves `false`. On success the worker sets `Invoice.lastNrsStatusUpdateAt`/`lastNrsStatusUpdateSuccess = true`; on final failure (BullMQ only emits `'failed'` once all attempts are exhausted) it sets `lastNrsStatusUpdateSuccess = false`, logs at `error` level, and notifies the tenant's active OWNER user via `NotificationService`. Both fields are surfaced in the invoice-detail response (`invoice-dashboard.controller.ts` → `InvoiceService.mapToResponse()`).

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

### apps/marketing (public landing page, added 2026-07-16)
- Not a `src/modules/` backend module — a separate top-level app, `apps/marketing/`, the public Billinx marketing/waitlist site. Runs on **port 3002** (backend: 3000, `apps/web` dashboard: 3001, marketing: 3002).
- Standalone Next.js 16 app (matches `apps/web`'s `next@16.2.10`), own `package.json`/`npm install`, same ad-hoc pattern as `apps/web` — **this repo is not a pnpm/Turborepo workspace**, so there is no `pnpm-workspace.yaml` or `turbo.json` tying the three apps together; each is built independently (`npm run build` from its own directory).
- Single scrolling page (`app/page.tsx`) assembled from section components in `apps/marketing/components/`: `Nav`, `Hero`, `ProblemSolution`, `Features`, `HowItWorks`, `ComplianceTrust`, `WaitlistCTA`, `Footer`.
- Waitlist capture is **frontend-only for now** — `WaitlistCTA` validates the email client-side and writes to `localStorage` (key `billinx_waitlist_submissions`); no backend endpoint exists yet to receive signups. The "127 businesses already on the waitlist" counter is a static placeholder, not derived from real data.
- Shares `apps/web`'s Tailwind brand tokens (`green`/`dark`/`surface`/`border`/`muted` in `tailwind.config.ts`, copied at scaffold time) plus a few page-specific literals (`#16a34a` CTA green, `#0f3460` gradient secondary) that are **not** in the shared token set — intentionally a slightly different, brighter green than the dashboard app's `#1D9E75` brand green, per this task's explicit spec.
- Uses `framer-motion` for scroll-triggered fade-ins (`FadeIn` component) and `@heroicons/react` for icons; wordmark SVGs copied from `apps/web/public/`.

---

**Note on architecture drift:** CLAUDE.md previously listed `compliance/` and `validation/` as separate top-level module directories. They do not exist as separate modules.

**FIRS validation is now handled by `InvoiceValidationService`** (`src/modules/invoice/services/invoice-validation.service.ts`) — the single source of truth for all invoice field rules. All three entry points delegate to it:

- `createInvoice()` → `validateInvoiceFields(dto, 'CREATE')` — throws; lineItems/totalAmount not required (DRAFT permissiveness); buyer.tin required for B2B/B2G.
- `submitDraft()` → `validateInvoiceFields(dto, 'SUBMIT')` — throws; all CREATE rules plus lineItems non-empty and totalAmount > 0.
- `validateInvoice()` / `POST /v1/invoices/validate` → `validateInvoiceFields(dto, 'VALIDATE')` — collects errors into `ValidationResponse` (mirrors SUBMIT rules so pre-flight matches submit behaviour).

`originalIrn` is required for credit/debit notes across all contexts; checks all four code forms: `'380'`, `'384'`, `'CREDIT_NOTE'`, `'DEBIT_NOTE'`. The three previously-divergent inline rule sets have been removed from `invoice.service.ts`.

**Extended 2026-07-18 (`fix/nrs-schema-alignment`)** with NRS-schema content-correctness rules, all mirrored across the throwing (CREATE/SUBMIT) and collecting (VALIDATE) paths:
- `invoiceKind` is now a hard presence + enum (`B2B|B2C|B2G`) check, enforced even at CREATE (closes the gap where a DRAFT could be created with no kind at all, which `bulk-invoice.service.ts`'s CSV importer now relies on — a missing `invoice_kind` column produces a per-row validation error instead of a silent `B2B` default). The hardcoded `invoiceKind: 'B2B'` in `InvoiceService.getSampleInvoice()` is explicitly exempt (comment marks it as demo-only, never submitted).
- `invoiceTypeCode`, when present, must be one of the values `InvoiceService.mapInvoiceTypeCode()` actually recognises (NRS numeric codes, legacy aliases, and the stored enum names) — enforced at CREATE too, since that's where `mapInvoiceTypeCode()`'s own silent `?? 'STANDARD'` fallback would otherwise fire on a typo.
- SUBMIT/VALIDATE only (not CREATE — DRAFT permissiveness still applies to in-progress data): `legalMonetaryTotal`'s four fields must all be present and > 0; every `taxTotal[].taxSubtotal[].taxCategory.id` must be a recognised tax category or alias (mirrors `InterswitchAdapter.normaliseTaxCategoryId()`'s accepted set); every line item must carry `hsnCode`+`productCategory` (PRODUCT, the default) or `isicCode`+`serviceCategory` (`itemType: 'SERVICE'`) — this replaces the old missing-`hsnCode`-is-a-WARNING behaviour with a hard error; `price.priceUnit`, when present, must be one of the NRS unit codes (`EA`/`KGM`/`LTR`).
- `paymentStatus`, when present, must be one of `PENDING|PAID|PARTIAL` (matches the new `PaymentStatusType` enum — see Data Models below).

---

## Data Models (Prisma)

47 models, 25 enums (added `ProductItemType` and `PaymentStatusType` 2026-07-18; added `RecurringInvoice` model + `RecurringFrequency`/`RecurringStatus` enums 2026-07-21 — the previously-documented "45 models, 23 enums" count was already stale by one model even before this change, not just from this PR). Key ones (many newer models — Client, InventoryMovement, Notification, VatEntry, ReminderRule, CreditNote, etc. — omitted here for brevity):

| Model | Purpose |
|---|---|
| `Tenant` | Organisation; all resources scoped to this |
| `ApiKey` | Hashed API keys per tenant |
| `RefreshToken` | Hashed JWT refresh tokens |
| `AdminKey` | Hashed admin keys (L2A staff) |
| `Invoice` | Core FIRS invoice with full financial + party data. `paymentStatus` is `PaymentStatusType` (`PENDING\|PAID\|PARTIAL`, NOT NULL, default `PENDING` — was a free-text nullable column until 2026-07-18). `lastNrsStatusUpdateAt`/`lastNrsStatusUpdateSuccess` track the outcome of the most recent NRS `UpdateStatus` call (see `submission` module's UpdateStatus queue). `recurringInvoiceId` (added 2026-07-21) links back to the `RecurringInvoice` schedule that generated it, when applicable. |
| `RecurringInvoice` | Recurring-billing schedule (added 2026-07-21): `frequency`/`status` enums, `startDate`/`endDate`/`nextRunDate`, `autoSubmit`/`autoSend` toggles, `templateData` JSON (buyer + line items + invoiceKind/currency/notes), `invoiceCount`/`lastRunAt`. See `invoice` module notes above. |
| `ProductCatalog` | `itemType` (`PRODUCT\|SERVICE`), `isicCode`/`serviceCategory` (SERVICE), `priceUnit` (default `EA`) added 2026-07-18 alongside the existing `hsnCode`/`productCategory` (PRODUCT) fields. |
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
20260718100000_add_product_catalog_item_type  # fix/nrs-schema-alignment — ProductItemType enum, ProductCatalog.itemType/isicCode/serviceCategory
20260718100100_add_product_catalog_price_unit  # fix/nrs-schema-alignment — ProductCatalog.priceUnit, default "EA"
20260718100200_add_invoice_payment_status_enum  # fix/nrs-schema-alignment — PaymentStatusType enum; Invoice.paymentStatus String? → PaymentStatusType NOT NULL DEFAULT PENDING, with a backfill step normalising NULL/UNPAID/OVERDUE/unrecognised values to PENDING before the type cast
20260718100300_add_invoice_nrs_status_tracking  # fix/nrs-schema-alignment — Invoice.lastNrsStatusUpdateAt/lastNrsStatusUpdateSuccess
20260718195736_add_api_key_scopes  # feat/api-key-scopes-rate-limiting — ApiKey.scopes String[], default ["*"]
20260721131342_add_recurring_invoices  # feat/recurring-invoices — RecurringInvoice model (RecurringFrequency/RecurringStatus enums), Invoice.recurringInvoiceId; also adds FORCE ROW LEVEL SECURITY + tenant_isolation policy + billinx_app grant for the new table in the same migration file, matching the 20260709000000 pattern (no prior precedent in this repo for adding RLS to a table created after that migration — established here)
```

47 migrations applied as of 2026-07-21; database schema confirmed in sync via `npx prisma migrate status` (verified live against a local Postgres/Redis via docker-compose — reset + reapplied cleanly).

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
- `itemType` (`PRODUCT | SERVICE`, default `PRODUCT`) plus classification fields matching the NRS line-item split: `hsnCode`/`productCategory` for `PRODUCT`, `isicCode`/`serviceCategory` for `SERVICE`. `priceUnit` (default `"EA"`) is the NRS `price_unit` code. All four fields are threaded through create/update/list/as-line-item (migration `20260718100000_add_product_catalog_item_type` + `20260718100100_add_product_catalog_price_unit`).

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

### Current State (as of 2026-07-21)
- 152+ PRs merged to main (through PR #188 as of 2026-07-09; several since, including `feat/docs` Swagger/OpenAPI coverage, `feat/auth` API key scopes + per-key rate limiting, and `chore/ui-cleanup-admin-actions` below)
- 973 tests passing, 61 suites, 45 DB models, 23 enums — up from 863/56 (2026-07-09) via several PRs since (OAuth/prettier/lint work not separately itemised here) plus `fix/nrs-schema-alignment` (2026-07-18): new `payment.service.spec.ts` (18 tests — this file, `src/modules/invoice/services/payment.service.ts`, had **zero** prior coverage), `update-status.worker.spec.ts` (5 tests), `interswitch.adapter.spec.ts` rewritten for OAuth (53 tests), plus new/updated cases in `invoice-validation.service.spec.ts`, `tenant.service.spec.ts`, and `product-catalog.service.spec.ts` for the new NRS-schema rules; plus `fix/jwt-name-claim` (1 test), `feat/pdf` (8 tests: new `invoice-pdf.service.spec.ts` — 7 tests, plus 1 new `invoice-dashboard.controller.spec.ts` case), and `feat/debug` (11 tests: 8 new `previewPayload` cases in `interswitch.adapter.spec.ts`, 3 new `invoice-dashboard.controller.spec.ts` cases) since. Backend test count is 993 as of `chore/ui-cleanup-admin-actions` (2026-07-18) — one delegation test for the retired dashboard `:id/xml` route was removed along with the route itself; no other suites changed. 1010 tests / 64 suites as of `fix/line-item-normalisation` (2026-07-20): new `invoice.service.spec.ts` (17 tests — `InvoiceService` had no dedicated spec file before this, only the indirect `invoice-flow.integration.spec.ts` coverage) for `normaliseLineItems()` and its five call sites, see the line-item shape-mismatch note above. Now **1062 tests / 67 suites** as of `feat/recurring-invoices` (2026-07-21): new `recurring-invoice.service.spec.ts` (44 tests), `recurring-invoice.controller.spec.ts` (7 tests), `recurring-invoice.scheduler.spec.ts` (1 test) — see the `invoice` module's recurring-invoices note above.
- Last merged PRs: `feat/recurring-invoices` (this one), `chore/ui-cleanup-admin-actions`, `feat/api-key-scopes-rate-limiting`, `feat/swagger-openapi-docs`, #188 refactor/split-invoice-controller

### Open Issues

**Resolved since 2026-06-11 (kept here so nobody re-investigates them):**
- ~~Ghost endpoint `POST /v1/invoices/dashboard/:id/reminder`~~ — now implemented (`invoice.controller.ts`, "Send Reminder" button on invoice detail page works).
- ~~Ghost endpoint `POST /v1/auth/mfa/resend`~~ — route now exists, but is a **deliberate permanent stub** that always returns 400 ("TOTP codes are generated by your authenticator app and cannot be resent"). The frontend still shows a "Resend code" link on the MFA login page that can never succeed — needs UX follow-up (remove the link or change copy), not a backend fix.

**Found 2026-07-21 during `feat/recurring-invoices` live verification (unfixed, out of scope for that PR — kept here so nobody re-discovers them from scratch):**
- **`POST /v1/register` (self-serve tenant/owner registration) is completely broken.** `UserController.register()` (`src/modules/user/user.controller.ts`) does `this.userService.registerTenant(body as unknown as RegisterTenantRequest)` — a raw unchecked cast, not a field mapping. The validated `RegisterDto` (`src/modules/user/dto/auth.dto.ts`) has `companyName`; `RegisterTenantRequest`/`UserService.registerTenant()` reads `request.tenantName` and `request.registeredAddress` — neither of which exists on `RegisterDto` at all. Every self-serve registration attempt hits `tenant.create()` with `registeredAddress: undefined` against a `Json` **NOT NULL** column and fails with a Prisma validation error, surfaced to the caller as an opaque `"Invalid request data"` 400. Confirmed live (not from reading code alone): a request with every `RegisterDto` field correctly populated still 400s. The documented onboarding path (`AccessRequest` → admin "approve and provision", `admin` module) is unaffected and appears to be the actual production flow — this may be why it's gone unnoticed. Not fixed here: unrelated to recurring invoices, and a real fix needs a decision on whether `/v1/register` is meant to be live at all (add `tenantName`/`registeredAddress` to `RegisterDto` and fix the mapping, or deprecate/remove the route) — a judgment call for engineering, not a mechanical fix.
- **`IrnService.generateUniqueIrn()` can deadlock-retry on a cross-tenant IRN collision.** `getNextInvoiceSequence(tenantId, year)` computes the next sequence number scoped to `tenantId`, but `Invoice.platformIrn` has a **global** unique constraint, not a tenant-scoped one. Two different tenants both using the default `interswitchServiceId` (`'SVC00001'`, applied whenever a tenant has none configured — the common case pre-Interswitch-onboarding) that each create their *first* invoice on the same calendar day both compute sequence `#1` and therefore the identical literal `platformIrn` string (`INV<year>0001-SVC00001-<date>`) — the second tenant's `generateUniqueIrn()` retries the identical (colliding) value up to 5 times and throws `"Failed to generate unique IRN after 5 attempts"`, since the retry loop recomputes from the same DB state every time (nothing about the collision changes between attempts). Confirmed live with two same-day, same-default-serviceId tenants. Not specific to recurring invoices — any two such tenants creating a same-day invoice via the New Invoice form, bulk import, or the API would hit this identically. Not fixed here: a real fix (e.g. scoping `platformIrn` uniqueness per-tenant, or including a tenant-disambiguating component in the generated IRN itself) touches IRN format/uniqueness semantics used throughout the submission pipeline and NRS payload — too large a blast radius for an incidental fix inside a recurring-invoices PR.

~~**Found 2026-07-18 during the UI-cleanup audit (PR `chore/ui-cleanup-admin-actions`) — the New Invoice dashboard form builds a flat line-item payload shape that doesn't match the canonical nested shape the adapter/validator read**~~ — **shape mismatch fixed 2026-07-20 (PR `fix/line-item-normalisation`); a real, separate data-completeness gap remains, see below.**
- **`InvoiceService.normaliseLineItems()`** (private method, `src/modules/invoice/services/invoice.service.ts`, added alongside `mapInvoiceTypeCode`/`captureCurrentTime`) converts the New Invoice dashboard form's flat line-item shape (`{ quantity, unitPrice, priceUnit, hsnCode, itemType: "product"|"service", ... }`) into the canonical shape `InterswitchAdapter.mapLineItems()` and `InvoiceValidationService` actually read: `invoicedQuantity` top-level, `price: { priceAmount, baseQuantity, priceUnit }` nested, and — this is the detail that matters — **`hsnCode`/`productCategory`/`isicCode`/`serviceCategory` stay top-level fields on the line item, not nested inside an `item: {}` block**, matching the real read sites in `interswitch.adapter.ts:779-844` and `invoice-validation.service.ts:291-327,419-443` exactly (an initial draft of this fix nested them under `item`, which would have silently continued to fail `MISSING_PRODUCT_CLASSIFICATION`/`MISSING_SERVICE_CLASSIFICATION` — caught before implementation). `itemType` is upper-cased (form sends lowercase `"product"`/`"service"`). Detection of already-canonical input (`invoicedQuantity` + `price.priceAmount` both present) short-circuits to a pass-through — the API/bulk-JSON-import paths already send canonical shape and must not be double-transformed. All other fields (`taxCode`, `vatRate`, `discountRate`, `discountAmount`, etc.) pass through unchanged; `taxCategoryId`-style per-line tax fields are **not** part of the canonical shape in this codebase — tax category lives at the invoice level (`taxTotal[].taxSubtotal[].taxCategory.id`) — so nothing consumes a per-line tax category id today.
- Called at every DB-write site for `lineItems`: `createInvoice()` (before both the `CREATE`-context validation call and the repository write), `submitDraft()` (normalises `effectiveLineItems` before the `SUBMIT`-context validation call, not just before the write — validation would otherwise see raw flat data even post-fix), `saveDraftInvoice()`, `updateDraftFields()` (only when the request actually supplies `lineItems`), and `duplicateInvoice()` (normalises the *source* invoice's stored `lineItems` — defensive/idempotent, since a legacy pre-fix DB row duplicated today would otherwise carry its flat shape forward). `createInvoiceFromXml()` and `bulk-invoice.service.ts`'s CSV/JSON import inherit the fix automatically since both delegate to `createInvoice()`.
- ~~**Known residual limitation: the New Invoice form never collected `productCategory`/`serviceCategory` at all**~~ — **closed 2026-07-20 (PR `feat/invoice-form-categories`).** The form's `LineItem` interface, line-item row UI, `buildPayload()`, `DraftLineItem`/draft-load mapping, and `pickFromCatalog()` (`apps/web/app/(dashboard)/invoices/new/page.tsx`) all now carry `productCategory`/`serviceCategory`: a single text input per line item — labelled "Product category" or "Service category" depending on the item's PRODUCT/SERVICE toggle, mutually exclusive, optional (no client-side required validation; NRS-submission-time validation is the enforcement point, unchanged) — sits below the existing HS/service code search. `pickFromCatalog()` also now copies `productCategory` from the picked catalogue product (the `Product` interface gained a `productCategory` field; the backend already returned it, the frontend just wasn't reading it) into either `productCategory` or `serviceCategory` on the line item depending on whether the picked product is HS- or ISIC-classified — the products catalogue itself only has one generic "Category" field for both item types (`apps/web/app/(dashboard)/products/page.tsx`), a separate pre-existing gap left untouched. The draft-load path (`DraftLineItem` + the `setLineItems` mapping when opening an existing DRAFT) was also updated — without this, re-opening and re-saving a draft that already had these values set would have silently wiped them.
  - **Bug found and fixed along the way, not just the two new fields:** `buildPayload()` never sent `itemType` at all (confirmed: absent from the pre-existing field list). `InvoiceService.normaliseLineItems()` (and, before it, `InterswitchAdapter.mapLineItems()` directly) both default a missing `itemType` to `PRODUCT` — so every SERVICE line item ever created through this form was silently reclassified as PRODUCT at the backend, and its `isicCode` (and now `serviceCategory`) would never have been read by the adapter's PRODUCT/SERVICE branch. This predates PR #224 — it's not something that PR introduced. `buildPayload()` now sends `itemType: "PRODUCT"|"SERVICE"` explicitly, which is required for the new `serviceCategory` field (and the pre-existing `isicCode` field) to actually reach NRS correctly for SERVICE items.
  - `normaliseLineItems()` itself needed **no backend changes** — it already destructured and re-attached `productCategory`/`serviceCategory` top-level per PR #224. The dashboard controllers (`createInvoiceDashboard`/`updateDraftDashboard`) take `@Body() body: Record<string, any>` with no DTO whitelist, so both new fields were already accepted server-side with zero backend changes.
- **Separate, pre-existing, unaffected by this fix:** `bulk-invoice.service.ts`'s CSV importer builds a *third*, different flat line-item shape when a CSV row has no explicit `line_items` JSON column (`bulk-invoice.service.ts:359-370` — `unitCode`/`taxCategoryId`/`taxPercent`, no `hsnCode` at all). `normaliseLineItems()` doesn't recognise this shape (it isn't the New-Invoice-form shape and isn't already canonical) and doesn't need to — bulk-CSV rows without an `hsnCode` were already failing SUBMIT classification validation before this PR and continue to exactly as before. Not in scope here.

**NRS Schema Alignment — 18 compliance gaps against `docs/nrs-api-spec.md`/`docs/nrs-invoice-schema.md` (resolved 2026-07-18, PR `fix/nrs-schema-alignment`):**

Two architecture decisions worth remembering: (1) Interswitch OAuth Client Credentials **remain per-tenant** (`Tenant.interswitchClientId`/`interswitchClientSecret`/`interswitchSecretIv`, decrypted via `CredentialService`, admin-settable through `TenantService.createTenant`/`updateTenant`'s `interswitchCredentials` field) — a platform-level (single shared credential) alternative was drafted and explicitly rejected mid-implementation once the existing per-tenant admin flow was found; do not revisit without re-confirming which is actually correct against Interswitch's own onboarding docs, since this codebase currently just asserts per-tenant. (2) `business_id`/`invoice_kind`/`payment_status` DB columns stay nullable-then-defaulted or newly-enum'd per field (see below) rather than adding NOT NULL constraints beyond what's noted — enforcement is at the application/validation layer except where a migration explicitly changes the column type.

- ~~#17 Bearer token OAuth flow~~ — **was already correct** (implemented in a prior session on this branch): `POST /Api/SwitchTax/Token` with `ClientId`/`ClientSecret`, `Map<tenantId, {token, expiresAt}>` cache, 3600s TTL with a 60s refresh margin, all 4 call sites (`submit`/`checkStatus`/`updatePaymentStatus`/`ping`) send `Authorization: Bearer <token>`. No changes needed this round beyond confirming it (see decision above — a platform-level rewrite was attempted and reverted).
- ~~#5 `invoice_type_code` exact codes~~ — adapter already threw `INVALID_INVOICE_TYPE_CODE` on an unmapped code (no `?? '381'` fallback). Added the missing half: `InvoiceValidationService` now rejects an unrecognised `invoiceTypeCode` at CREATE too (was previously unvalidated at that layer, relying only on the adapter catching it at submission time — too late for a clean 400).
- ~~#6 `billing_reference` from `originalIrn`~~ — already correct: credit/debit notes derive `billing_reference` from the original invoice's own `issueDate` via a DB lookup, not from whatever was passed through; `MISSING_ORIGINAL_IRN`/`ORIGINAL_INVOICE_NOT_FOUND` on the two failure paths.
- ~~#8 `tax_category.id` exact casing + `Stamp_Duty`~~ — already correct in the adapter (`Withholding_Tax`/`Stamp_Duty` exact casing, full legacy alias table, rejects anything unrecognised). Added `InvoiceValidationService` rejection of unrecognised tax category ids at SUBMIT/VALIDATE (mirrors the adapter's alias table so nothing the adapter would accept gets rejected early).
- ~~#9 `isic_code` path for SERVICE items~~ — adapter-side classification (`isic_code`+`service_category` for SERVICE, `hsn_code`+`product_category` for PRODUCT, both hard errors) was already correct. Added: `ProductCatalog.itemType`/`isicCode`/`serviceCategory` (migration `20260718100000_add_product_catalog_item_type`), threaded through `product-catalog.service.ts` create/update/as-line-item; `InvoiceValidationService` now hard-errors on missing classification at SUBMIT/VALIDATE (was a WARNING for missing `hsnCode` only, and didn't check SERVICE items at all).
- ~~#11 `price_unit` valid NRS code~~ — adapter-side whitelist (`EA`/`KGM`/`LTR`, default `EA`) was already correct. Added: `ProductCatalog.priceUnit` (migration `20260718100100_add_product_catalog_price_unit`, default `"EA"`), threaded through the same call sites as `itemType`; `InvoiceValidationService` rejects an unrecognised `price_unit` at SUBMIT/VALIDATE.
- ~~#14 `legal_monetary_total` guard~~ — adapter-side guard (all four fields present and > 0, else `INVALID_LEGAL_MONETARY_TOTAL`, no NRS call made) was already correct. Added the mirror in `InvoiceValidationService` at SUBMIT/VALIDATE.
- ~~#1 `business_id` required per tenant~~ — adapter-side check (`MISSING_BUSINESS_ID` if unset or not a UUID) was already correct. Added: UUID format validation in `TenantService.createTenant`/`updateTenant` when `interswitchCredentials.businessId` is supplied, so a malformed value is rejected at admin-entry time instead of only failing at the next submission.
- ~~#3 `issue_time` captured at submission~~ — **fixed.** Was being stamped at both `createInvoice()` (DRAFT creation) and `submitDraft()`; a DRAFT can sit for hours/days before submission, so the creation-time stamp was wrong. Now only `submitDraft()` captures `issueTime` if the caller didn't supply one; `createInvoice()` leaves it `null` until actual submission.
- ~~#13 `item.description` auto-generated~~ — already correct (`formatDefaultDescription()`: `"{quantity} {price_unit} at {unit_price} each"`, 2 decimal places, never blank).
- ~~#2 `invoice_kind` required, not defaulted~~ — adapter-side (`MISSING_INVOICE_KIND` if missing/invalid, no default) and `bulk-invoice.service.ts` (CSV `invoice_kind` column: missing → `undefined`, not a silent `'B2B'` — `InvoiceValidationService`'s new CREATE-time check turns this into a per-row validation error) were already correct from a prior session. `getSampleInvoice()`'s hardcoded `'B2B'` has an explicit exemption comment. Added the `InvoiceValidationService` hard check itself (see above) — without it, the bulk-CSV comment's claim wasn't actually true yet.
- ~~#16 `payment_status` constrained enum~~ — **fixed.** New `PaymentStatusType` enum (`PENDING|PAID|PARTIAL`); `Invoice.paymentStatus` changed from `String?` to `PaymentStatusType` NOT NULL DEFAULT `PENDING` (migration `20260718100200_add_invoice_payment_status_enum`, with a backfill step normalising every existing NULL/`''`/`UNPAID`/`OVERDUE`/other value to `PENDING` before the type cast — required since the app previously wrote `'UNPAID'` as a display fallback in one spot). All read/write sites updated across `invoice.service.ts`, `payment.service.ts`, `vat.service.ts`, `invoice.repository.ts` — several `OR: [{paymentStatus: null}, {paymentStatus: {not: 'PAID'}}]` filters simplified to just `{paymentStatus: {not: 'PAID'}}` since NULL can no longer occur. `InvoiceValidationService` rejects any value outside the three.
- ~~#18 UpdateStatus retry logic~~ — **fixed**, see the `submission` module's UpdateStatus queue entry above for the full design (BullMQ queue+worker, 3 attempts at 0s/5s/15s, `Invoice.lastNrsStatusUpdateAt`/`lastNrsStatusUpdateSuccess` migration `20260718100300_add_invoice_nrs_status_tracking`, tenant notification on final failure, surfaced in invoice-detail response).
- ~~#4 `tax_point_date`~~ — **fixed, wasn't actually closed on inspection.** The gap asked to "confirm it defaults to issueDate and is persisted at creation time" — it didn't: `createInvoice()` stored `taxPointDate: null` when not supplied, relying on the adapter's own `?? issueDate` fallback to paper over it transiently at submission time. Now `createInvoice()` persists `taxPointDate` defaulted to `issueDate` at creation, matching what the gap assumed was already true.
- ~~#7 QR code storage~~ — **confirmed working**, no change needed: `SubmissionService.handleSuccess()` persists `result.qrCodeBase64` (from the adapter's NRS response) to `Invoice.qrCodeBase64` on acceptance. **PDF rendering fixed 2026-07-18 (PR `feat/pdf`).** New `InvoicePdfService` (`src/modules/invoice/services/invoice-pdf.service.ts`), built with `@react-pdf/renderer` (pinned at `^3.4.5`, not the current `4.x` — see the `submission`/library note below), generates an NRS-compliant PDF from the raw invoice record: header (wordmark, IRN, dates), supplier/buyer blocks (with tenant-registeredAddress fallback when `metadata.sellerParty` is absent), a zebra-striped line-items table (HSN/ISIC, qty, unit, unit price, discount, amount), a tax-summary table (one row per `taxTotal[].taxSubtotal[]` entry), a right-aligned totals block, and an "NRS Tax Information" footer with the IRN, submission timestamp, and the QR code embedded directly from `qrCodeBase64` (already a rendered PNG, base64-encoded — no encode/decode library needed, just `data:image/png;base64,` + the stored string). When `qrCodeBase64` is null (pre-PR-#215 invoices), the footer renders IRN text only — verified live against a real seeded invoice, no crash. New route `GET /v1/invoices/dashboard/:id/pdf` (JwtGuard) added *alongside* the existing `:id/xml` route, which is deliberately kept live (not retired) in case any integration depends on it — only the frontend's "Download PDF" button was repointed. The frontend's "Download PDF" button (`apps/web/app/(dashboard)/invoices/[id]/page.tsx`, `handleDownloadPdf`) now calls the real PDF endpoint (`invoiceApi.getPdf`) instead of the old XML one — see the dead/misleading-UI note below, now resolved.
- ~~#10 `price.base_quantity`~~ — **confirmed, closed.** `baseQuantity` is a real field in `packages/types/canonical-invoice.ts` and round-trips correctly: `createInvoice()` stores `lineItems` as an unmodified JSON blob (no field stripping), so a supplied `price.baseQuantity` survives DB storage and reaches the adapter's `?? 1` fallback only when genuinely absent — not hardcoded at the adapter boundary. Note: the dashboard's "New Invoice" form doesn't currently expose a `baseQuantity` input (only the sample-invoice demo modal's type does), so in practice today it will usually default to 1 in the UI — a frontend form-completeness gap, out of scope here.
- ~~#12 supplier address~~ — **confirmed correct against the schema, data audit flagged, not performed.** Per `docs/nrs-invoice-schema.md`'s Party Object table, `street_name`/`city_name`/`country` are required and `postal_zone`/`lga`/`state` are optional — the adapter matches this exactly (required three have defaults, optional three are `?? undefined`). **Not verified:** whether every existing tenant's `Tenant.registeredAddress` JSON blob actually has non-empty `streetName`/`cityName` — there is no application-layer required-field validation on this JSON blob at tenant creation (the `TenantAddress` TypeScript type claims these are required, but nothing enforces it at runtime), so a tenant provisioned with an incomplete address would get `street_name: ''` submitted to NRS and rejected only at actual submission time. Recommend a one-off data audit: `SELECT id, name FROM tenants WHERE registeredAddress->>'streetName' IS NULL OR registeredAddress->>'streetName' = '' OR registeredAddress->>'cityName' IS NULL;` — not run as part of this PR (no production DB access from here).
- ~~#15 `payment_status` in payload~~ — **confirmed, closed.** Adapter's `payment_status: invoice.paymentStatus ?? 'PENDING'` fallback is now backed by a real NOT NULL DEFAULT PENDING column (see #16) — left as-is since `invoice` arrives at the adapter as a loosely-typed `payload.invoice`, not a direct Prisma read, so the defensive fallback is still worth keeping.
- **CSID (investigated 2026-07-21, no code change):** Interswitch applies ECDSA signing at the APP layer before NRS submission. The `QRCodeData` returned encodes the cryptographic stamp. No separate CSID field is exposed by the Interswitch API. Billinx is compliant via correct QR code storage and rendering.

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
12. ~~`apps/web` on Next.js 15.5.18; `postcss` Dependabot moderate (XSS via unescaped `</style>` in stringify output) flagged via `next` itself~~ — **Next.js upgraded to 16.2.10 2026-07-10 (PR chore/nextjs-16-upgrade); postcss CVE fixed via override, not by the Next.js bump.** Kept React on `^18` deliberately — `next@16`'s peerDependencies still accept `^18.2.0`, and React 19 has its own breaking-change surface that belongs in a separate PR. Verified before assuming: Next.js pins an internal, exact-version `postcss@8.4.31` dependency for its own build pipeline (separate from the project's own Tailwind-facing `postcss`, already patched at `^8`) — this pin is unchanged across **every** 15.x and 16.x release including latest stable, so the upgrade alone does **not** clear the CVE (confirmed via `npm audit`, which flagged `next` itself across the range through `16.3.0-canary.5`, i.e. current stable too). Fixed instead with a targeted override in `apps/web/package.json`: `overrides: { next: { postcss: "^8.5.10" } }` — same pattern as the backend's uuid/js-yaml overrides. Breaking changes actually hit by this codebase, and how each was handled:
    - `next.config.mjs`'s `eslint: { ignoreDuringBuilds: true }` — the `eslint` config key was removed outright in v16 (`next build` no longer lints at all); deleted the key.
    - `next lint` command removed entirely — migrated via the official `next-lint-to-eslint-cli` codemod: `.eslintrc.json` deleted, `eslint.config.mjs` (flat config, extends `eslint-config-next/core-web-vitals` + `/typescript`) added, `"lint"` script changed from `next lint` to `eslint .`. This forced `eslint` from `^8` to `^9` (`eslint-config-next@16.2.6`, already installed pre-upgrade, requires `eslint>=9` — this was the actual root cause of the `legacy-peer-deps` workaround below).
    - Turbopack is on by default for `dev`/`build` in v16 (no more `--turbopack` flag needed) — no custom webpack config existed, so no forced-failure case there, **but** Turbopack's CSS parser enforces the spec strictly (`@import` must precede all other rules) where webpack didn't: `app/globals.css` had its Google Fonts `@import` positioned *after* the `@tailwind` directives, which built fine under webpack but hard-failed the Turbopack build. Fixed by moving `@import` to the top of the file. This wasn't caught in the pre-upgrade assessment — worth remembering that a CSS file with `@import` not at the very top is exactly the kind of thing Turbopack will catch that webpack silently tolerated.
    - Turbopack also emitted a workspace-root-ambiguity warning (two lockfiles: repo root's and `apps/web`'s) — silenced by explicitly setting `turbopack: { root: __dirname }` in `next.config.mjs`.
    - `next build` auto-updated `tsconfig.json`: `jsx: "preserve"` → `"react-jsx"` (mandatory, Next.js's new JSX transform requirement) and added `.next/dev/types/**/*.ts` to `include` (dev builds now output to `.next/dev` separately from `next build`'s `.next`, per v16's concurrent-dev-and-build change).
    - `remove-experimental-ppr`, `remove-unstable-prefix`, and `middleware-to-proxy` codemods were all run for correctness but were no-ops — none of `experimental_ppr`, `unstable_`-prefixed cache APIs, or a `middleware.ts` file exist in this codebase.
    - No sync `cookies()`/`headers()`/`params`/`searchParams` access, no parallel-route (`@folder`) segments, no AMP/`serverRuntimeConfig`/`publicRuntimeConfig`/`devIndicators` sub-option/`unstable_rootParams` usage, and the one `next/image` call (`app/mfa/setup/page.tsx`) uses a `data:` URI (not a local path+query string) — none of these `next/image` or removed-API breaking changes required any code changes.
    - **`apps/web/.npmrc` (`legacy-peer-deps=true`, added in the frontend-test-infra PR to work around the `eslint@^8` vs `eslint-config-next@16.2.6` peer conflict) is now removed** — verified with a real `rm -rf node_modules && npm ci` with the file absent before deleting it, not assumed. The underlying eslint 8/9 mismatch that caused it is resolved by this PR's eslint bump.
    - `npm audit` in `apps/web`: 3 findings (1 low, 2 moderate) → 1 low (only the pre-existing, explicitly out-of-scope `@babel/core` low finding remains — dev-only, not touched per instructions). Backend suite (874 tests / 58 suites) and `nest build` unaffected/still clean; frontend `next build` and the 3 Vitest smoke tests both clean after all of the above.
    - ~~Not done, flagged for a separate PR: wiring up `eslint .` surfaced 101 pre-existing lint errors/warnings across application code that had never actually been linted before~~ — **fixed 2026-07-10 (PR fix/lint-errors-apps-web).** `eslint .` in `apps/web` now returns 0 errors, 0 warnings — enforced for real, not just wired up. Audited first, fixed by category:
      - `react-hooks/set-state-in-effect` (36, all read individually) — every instance was the standard "fetch on mount" idiom (`useEffect(() => { load(); }, [deps])` with a synchronous `setX(...)` call, deps not including the state being set), not an actual infinite-loop bug. Verified this by reading all 36, not sampling. Per explicit decision, resolved with a documented `eslint-disable-next-line` + comment at each site ("Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.") rather than a bigger data-fetching-hook refactor, which was judged out of scope for a lint-debt PR.
      - `react-hooks/static-components` (13) — traced to exactly 2 root causes: `Req` (required-field asterisk helper, `invoices/new/page.tsx`) and `QueueCard` (`admin/system/page.tsx`) were both defined *inside* their parent component's render body. Hoisted both to module scope (`Req` needed `submitAttempted` threaded through as a new prop since it closed over that state; `QueueCard` needed no changes beyond the move, since `title`/`q` were already explicit props). Fixing these 2 components resolved all 13 errors.
      - `react-hooks/immutability` (5) — all 5 traced to one root cause in `invoices/new/page.tsx`: the "pre-load an existing DRAFT" effect referenced `setLineItems`/`setAllowanceCharges`/`setPayeeParty`/`setShipToParty`/`setTaxRepParty`, all declared via `useState` *after* that effect in the source (not a live bug — effects run after the full render completes, so the setters were already initialized by execution time — but fragile ordering). Moved the 8 `useState` declarations earlier, into the component's existing top-of-function declaration block, before any effect.
      - `react-hooks/exhaustive-deps` (net 2, not 3 — one of the original raw-count "3" was a false positive: a pre-existing inline `eslint-disable-line` comment on a *different* rule, incidentally caught by the audit's text-matching) — one was a genuinely unused, stale `eslint-disable-next-line` comment (deleted); the other was a real missing dependency (`setInventoryEnabledCtx` in `settings/page.tsx`) — verified the setter is a plain `useState` setter threaded through `UserProfileContext` (provably stable identity), so adding it to the deps array was safe and didn't reintroduce a re-render loop.
      - `react-hooks/purity` (2) — both are `Date.now()` calls inside render for "days overdue" display banners (`invoices/[id]/page.tsx`, `payments/page.tsx`). Per explicit decision, resolved with a documented `eslint-disable-next-line` + comment (SSR/hydration mismatch risk accepted for a read-only cosmetic calculation) rather than restructuring — the disable is placed on the exact `Math.floor(...Date.now()...)` sub-expression line, not the outer `const` line, since `eslint-disable-next-line` only covers the literal next line and the first attempt at this placement silently no-op'd (caught by re-running lint after, not assumed fixed).
      - `@typescript-eslint/no-unused-vars` (10, not 11 — one of the original 11 resolved incidentally as a side effect of the static-components hoist) — 8 were genuinely dead (unused imports, an unused derived constant, an unused destructured field, dead lookup tables superseded by `getInvoiceStatusPill`) and deleted outright; 1 (`dashboard/page.tsx`'s `prefsLoaded`) is state that's written but never read anywhere — renamed the read-side binding to `_prefsLoaded` (config change below makes `_`-prefixed vars exempt) rather than removing the `setPrefsLoaded` calls, since removing those would be an application-logic change, not a lint fix.
      - `@next/next/no-img-element` (4) — all 4 were the same static, developer-authored logo SVG (`/billinx-wordmark.svg` or `-dark.svg`) in `login/page.tsx`, `AuthCard.tsx`, and twice in `Sidebar.tsx`. Swapped `<img>` for `next/image`'s `<Image>` with explicit `width={320} height={60}` (the SVGs' real intrinsic size) and `unoptimized` — chosen over adding `images.dangerouslyAllowSVG: true` to `next.config.mjs` (which Next.js requires to let its image optimizer touch SVGs at all) because `unoptimized` scopes the opt-out to these 4 specific, trusted assets instead of widening a security-relevant config flag for the whole app; also technically correct since a vector logo gets no benefit from raster srcset optimization anyway.
      - `@typescript-eslint/no-explicit-any` (45, the largest category) — no blanket approach; each judged individually. Recharts custom tooltips (`dashboard/page.tsx`, `payments/page.tsx`) got properly typed via recharts' own exported `TooltipContentProps<ValueType, NameType>` (not `TooltipProps`, which — confirmed by reading recharts' own `.d.ts` — omits `payload`/`label`/`active` on purpose since those are "read from context" only for the built-in `content={<X/>}` element-instance pattern; switched both usages to `content={X}` function-reference form to make the types actually check). Several were `(x as any).field` reads where the surrounding code already had a proper interface in scope (`Stats`, `TenantProfile`, `InvoiceDetail`) that the cast was needlessly bypassing — removed the casts. Several were the repeated `api.get<any>('/v1/tenants/me')` "is inventory enabled" check duplicated across 5 files — typed each as `api.get<{ inventoryEnabled?: boolean }>(...)`. The `invoices/new/page.tsx` draft-loading handler (7 of the 45) got a proper new local `DraftInvoiceResponse` interface matching every field actually read (seller/buyer nested objects, line items, allowance charges, metadata parties) instead of `any`. Two Recharts chart-click handlers (`dashboard/page.tsx`) needed a deliberate `as unknown as {...}` narrowing rather than the library's own declared `payload?: any` field — verified by reading recharts' actual JS implementation (not just its types) that the original datum's custom fields (e.g. `monthKey`) are spread directly onto the click handler's argument at the top level, not nested under `.payload` as the loose library type would suggest, so a naive "correct-per-the-types" fix would have silently broken navigation.
      - Config: added `ignores: ["coverage/**", ".next/**"]` to `eslint.config.mjs` (it was linting the generated Vitest coverage report) and an `argsIgnorePattern`/`varsIgnorePattern: "^_"` override for `no-unused-vars` (needed for the `_prefsLoaded` fix above; wasn't configured by `eslint-config-next` by default).
      - Full verification: `eslint .` → 0 errors, 0 warnings. `next build` (Turbopack) → clean, all 35 routes. `npm test` (Vitest) → 3/3 smoke tests still passing. Backend suite (874 tests / 58 suites) and `nest build` unaffected. No application logic changed — every fix was either a mechanical hoist/reorder, a type-only change, or a documented suppression; the two "decision point" categories (the 36 fetch-on-mount suppressions and the 2 purity suppressions) were explicitly approved rather than assumed.
13. ~~JWT access token never includes a `name` claim~~ — **fixed 2026-07-18.** `issueAccessToken` (`src/modules/user/services/user.service.ts`) now signs `name: \`${user.firstName} ${user.lastName}\`.trim()` alongside the existing `sub`/`tenantId`/`email`/`roles`/`role`/`environment`/`tier` claims, at all four call sites (register/login/MFA-complete/accept-invitation all flow through the same private helper). The frontend's `apps/web/lib/auth.tsx` already had the `decoded.name ?? decoded.email` fallback in place from when this was first found, so no change was needed there — it now resolves `name` correctly instead of always falling through to email. The dashboard top-nav avatar dropdown (`apps/web/app/(dashboard)/dashboard/page.tsx`) had its `displayFullName` workaround (`profile?.fullName ?? (profile?.firstName && profile?.lastName ? ... : undefined) ?? user?.name ?? ''`, sourced from a separate `useUserProfile()` call) simplified to read `user?.name` directly from the token — the `profile`-based lookup is no longer needed for this display (note: `profile` is still used elsewhere on that page, for the dashboard greeting's first-name, so `useUserProfile()` itself wasn't removed). Added a decode-and-assert test in `user.service.spec.ts` (`login` test) confirming the signed JWT payload actually contains `name: 'Ada Lovelace'` alongside the other claims — this is the first test in the suite that decodes the token to check claim shape rather than just asserting `accessToken` is a string. Existing sessions holding a token issued before this fix will keep showing the email fallback until they next log in (token is opaque, not reissued retroactively) — expected, not a bug. Full backend suite (954/60) and frontend build both verified clean after the change.


**Test coverage** — thinner than previously documented:
- Real coverage exists for: invoice-flow, XML builder, incoming-invoice, VAT service, and (added 2026-07-04) payment, webhook, identity/auth, and user, and (added 2026-07-05) tenant, admin, kyb, consent, product-catalog, export, reference-data, submission adapters, client, analytics, inventory, notification, and reminder (769 tests / 50 suites total) — this closes out the last module that had zero coverage; every backend module now has some real tests, though depth still varies a lot by module (see the per-module notes below and the frontend items after).
  - Reminder coverage (35 tests across 2 files: `reminder.service.spec.ts` 30, `reminder.controller.spec.ts` 5; uses Jest fake timers with a fixed system clock since the daily reminder check's day-difference math reads the real clock) covers rule CRUD validation (`triggerType` enum check, `triggerDays` non-negative-integer check, and the `ON_DUE_DATE`-must-be-0 / other-types-must-be->0 cross-field rule, re-validated against the *existing* rule's triggerType on partial updates that omit it), rule ownership enforcement (404 vs 403 for a rule belonging to another tenant) shared by update/delete, and the cron-driven `runReminderCheck` engine end-to-end: the three trigger-type day-math branches (`DAYS_BEFORE_DUE`/`ON_DUE_DATE`/`DAYS_AFTER_DUE`) firing on the exact matching day and not otherwise, per-invoice-per-rule dedup via existing `reminderLogs` rows, the tenant-level early-exit gates (no active OWNER email, owner user inactive, no active rules, no qualifying invoices), the full send side effects (reminder log + invoice reminderCount/lastReminderAt update + `invoice.reminder_sent` event emission + activity tracking), `amountOutstanding` floored at 0, the `firsConfirmedIrn`-falls-back-to-`platformIrn` display logic, and that an email-send failure is caught/logged inside `sendReminder` without failing the whole tenant's batch — worth noting this means the returned `sent` count still increments even when the underlying email threw, since the catch lives inside the per-reminder helper, not the caller; that's existing behavior the tests document rather than something changed here.
  - Notification coverage (9 tests across 2 files: `notification.service.spec.ts` 6, `notification.controller.spec.ts` 3) covers tenant/user-scoped notification listing and the read/read-all mutations (scoped to id+tenantId+userId to prevent cross-tenant marking; read-all only touches currently-unread rows), and `hasUnreadOfTypeForPeriod`'s period-substring match used by the VAT-reminder cron to avoid re-notifying within the same period.
  - Inventory coverage (35 tests across 2 files: `inventory.service.spec.ts` 28, `inventory.controller.spec.ts` 7) covers the tenant-level `inventoryEnabled` gate shared across every endpoint (including the two fire-and-forget invoice-lifecycle hooks silently no-op'ing rather than throwing when disabled), stock-status classification (`OUT_OF_STOCK`/`LOW_STOCK`/`IN_STOCK` thresholds), the low-stock filter + pagination on the stock list, `adjustStock`'s balanceBefore/balanceAfter movement recording for both positive and negative (write-off) adjustments, `deductStock`'s HSN-code-to-product matching from outbound invoice line items (including the `commodityClassification.hsn`/`invoicedQuantity` field-name fallback, floor-at-zero, and skip-if-already-zero guards), `addStock`'s case-insensitive product-name matching from incoming-invoice items, `getLowStockCount`'s tenant-gated count, and `triggerReorder`'s missing-supplier-email guard and reorder-email payload.
  - Analytics coverage (29 tests across 2 files: `analytics.service.spec.ts` 21, `analytics.controller.spec.ts` 8; uses Jest fake timers with a fixed system clock since the service's `month`/`quarter`/`year` period math and `revenueVsExpenses`'s month-label generation both read the real clock) covers the in-memory aggregation/grouping logic shared by `topItemsSold`/`topPurchases`/`topSuppliers`/`topClients` (case-insensitive grouping by name, revenue/spend accumulation, most-recent-invoice-date tracking, sort-descending-then-cap-at-10, and safe fallbacks for missing description/quantity/amount), `priceTrends`'s substring item-name filter and YYYY-MM period bucketing, and `revenueVsExpenses`'s per-month ACCEPTED-invoice-vs-incoming-invoice aggregation with a 0-default when a month has no data.
  - Client coverage (33 tests across 2 files: `client.service.spec.ts` 25, `client.controller.spec.ts` 8) covers TIN-uniqueness conflict handling and its reactivate-instead-of-duplicate path for soft-deleted clients, tenant-scoped search/pagination, the falsy-vs-undefined patch-field distinction in `update` (mirroring the same pattern already covered for tenant/product-catalog), and `syncFromInvoice` — the auto-population logic invoice creation feeds into: incrementing `totalInvoices`/`totalBilled`/`lastInvoiceAt` for an existing TIN match, auto-creating a client from buyer party details (including the flat-field-vs-`buyerParty`-nested-field fallback) when no match exists, silently swallowing unique-constraint races from concurrent invoice creation, and no-op when the invoice has no buyer name at all.
  - Submission-adapter coverage (59 tests across 2 files: `mock.adapter.spec.ts` 6, `interswitch.adapter.spec.ts` 53 — rewritten 2026-07 for the OAuth Client Credentials flow, was 31 tests against the old static-header scheme) covers `MockAdapter`'s randomized accept/reject roll and FIRS-IRN generation (deterministic via a mocked `Math.random` + Jest fake timers to avoid the real 800–2000ms simulated delays) and malformed-platformIrn fallback; and `InterswitchAdapter`'s OAuth token fetch/cache/refresh (a URL-dispatching fetch mock so tests don't have to reason about token-vs-action call ordering), `MISSING_BUSINESS_ID` (absent or non-UUID) and `MISSING_CREDENTIALS` short-circuits, sandbox-vs-production URL selection, the NRS payload builder (FIRS invoice-type-code mapping incl. `INVALID_INVOICE_TYPE_CODE` rejection, exact-case tax-category normalisation incl. `Withholding_Tax`/`Stamp_Duty`, `MISSING_INVOICE_KIND`, `INVALID_LEGAL_MONETARY_TOTAL`, PRODUCT/SERVICE line-item classification incl. `MISSING_PRODUCT_CLASSIFICATION`/`MISSING_SERVICE_CLASSIFICATION`, `INVALID_PRICE_UNIT`, auto-generated line-item descriptions, credit/debit-note `billing_reference` derivation from the original invoice's `issueDate`), the full `mapError` branch set (401/429/500/422/400-with-various-detail-strings/unrecognised-status/AbortError → INVALID_CREDENTIALS/RATE_LIMITED/SERVER_ERROR/SCHEMA_VALIDATION/IRN_DUPLICATE|INVALID_BUSINESS_ID|VALIDATION_ERROR/UNKNOWN_ERROR/TIMEOUT with correct `retryable` flags, including a token-fetch-failure mapped through the same table), `checkStatus`'s missing-tenantId/missing-credentials/success/4xx-vs-5xx-retryable/abort/generic-error paths, `updatePaymentStatus`'s PARTIAL-includes-amount vs PAID-omits-amount body and (since 2026-07-18) its `Promise<boolean>` success/failure return rather than always-silent-void, and `ping`'s status/exception-based health signal.
  - PaymentService coverage (`src/modules/invoice/services/payment.service.ts` — invoice payment recording, distinct from the `payment` module's Paystack/Flutterwave provider service) had **zero prior tests**; `payment.service.spec.ts` added 2026-07-18 (18 tests) covers `recordPayment`'s validation guards (provider/amount/reference/paidAt/invoice-not-found/wrong-tenant/not-ACCEPTED), the PAID-vs-PARTIAL payment-status derivation and event emission, enqueuing an NRS UpdateStatus job only when `firsConfirmedIrn` is set (with amount included only for PARTIAL) and not throwing when the enqueue itself fails, activity tracking, `listPayments`, and the daily `detectOverdueInvoices` cron.
  - UpdateStatusWorker coverage (`update-status.worker.spec.ts`, 5 tests) covers the two extractable private methods (`recordOutcome`, `notifyTenant` — invoked via `(worker as any)`) directly rather than driving a real BullMQ `Worker`/`Job`: `recordOutcome` writes `lastNrsStatusUpdateAt`/`lastNrsStatusUpdateSuccess` correctly for both outcomes; `notifyTenant` creates a notification for the active OWNER user and no-ops when there is none or they're inactive. The BullMQ wiring itself (job processor, `settings.backoffStrategy`, lifecycle hooks) is intentionally untested, matching this codebase's existing convention for every other worker in `submission/workers/` — a lifecycle test that called `onModuleInit()` was tried and reverted because a real local Redis is available in this dev environment, so it opened a genuine, never-closed connection and hung the whole Jest run.
  - Reference-data coverage (33 tests across 3 files: `reference-data.service.spec.ts` 20, `reference-data.controller.spec.ts` 10, plus (in `shared/guards/`, since it guards the module's two search endpoints) `reference-search-rate-limit.guard.spec.ts` 5) covers the 5-minute in-process cache (each of the six cached endpoints keyed independently, single DB hit across repeated calls within the TTL, re-query after expiry — using a mocked `Date.now`), the `getHsCodes`/`getServiceCodes` search filter and the server-side limit/offset clamping fixed 2026-07-04 (excessive limit clamped to 100, negative limit clamped to 1, `limit=0` falling back to the 20 default since the clamp uses a falsy check not an undefined check, negative offset clamped to 0), `getLgas` correctly *not* being cached (state-scoped, always fresh), and `getCountries`' cache-bypass-when-searching behavior. Also added `ReferenceSearchRateLimitGuard` tests (60-req/5-min per-IP, mirroring the existing `PaymentRateLimitGuard` test pattern) since it was untested despite guarding these same endpoints.
  - Export coverage (16 tests in `export.service.spec.ts`; no dedicated controller — its routes live inline in `invoice.controller.ts`/`admin.controller.ts`, both already covered for delegation) covers the shared 60-second Redis rate limit (429 on an existing key, cooldown key set after success, and confirms `exportPlatformCSV` — the admin platform-wide export — is *not* subject to it), CSV field-quoting/escaping (embedded double quotes, blank fields for missing buyerTin/firsConfirmedIrn/qrCode), the JSON export's Decimal-to-number and ISO-date-truncation mapping, the monthly report's pending-count derivation and 0%/0-amount edge case when a month has no invoices, and the platform CSV's extra TenantName/TenantTIN columns (including the missing-tenant-relation blank-column case).
  - Product-catalog coverage (30 tests across 2 files: `product-catalog.service.spec.ts` 24, `product-catalog.controller.spec.ts` 6) covers tenant-scoped CRUD including the explicit-`undefined`-vs-falsy-value distinction in both create (`isActive: false`/`stockQuantity: 0` respected, not defaulted) and update (patch fields fall back to the existing value only when actually omitted, not when falsy), the search/category/isActive list filters, Decimal-to-number coercion for price/stock fields, the `PRODUCT_CREATED`/`PRODUCT_UPDATED` activity-tracking side effects (using the mocked `getRequestContext()`, same pattern as the identity/auth `ApiKeyService` tests), `getProductAsLineItem`'s VAT-category-based tax-rate derivation (7.5% for `STANDARD_VAT`, 0% otherwise), and (added 2026-07-18) `itemType`/`isicCode`/`serviceCategory`/`priceUnit` defaults on create, SERVICE-item creation, and their fall-back-vs-overwrite behaviour on update.
  - Consent coverage (16 tests in `consent.service.spec.ts`; module has no controller — fire-and-forget from registration/login flows) covers consent-record defaults/field persistence, the duplicate-pending-erasure-request guard, and the full erasure lifecycle: request → approve (user PII anonymisation, refresh-token revocation, consent-record revocation, a freshly-generated random password hash on every approval — not reused/static) → reject (clears the user's pending flag so they can re-request), plus the not-PENDING conflict guard shared by approve/reject.
  - KYB coverage (16 tests across 2 files: `kyb.service.spec.ts` 14, `kyb.controller.spec.ts` 2) covers `confirmTin`'s upsert-with-null-clearing-on-unconfirm behavior, and `verifyCac`'s fuzzy company-name matching (Levenshtein + Jaccard blend) and risk scoring (GREEN/AMBER/RED thresholds at 90%/70%) against a mocked global `fetch` — including the three distinct RED-with-error-message paths (`CAC_API_BASE_URL` unset, non-OK HTTP response, and a thrown/network error), the alternate CAC response field-name variants (`company_name`/`companyName`, `rcDate`/`registrationDate`, `proprietors`/`directors`), the non-ACTIVE-status risk-reason addition, and that a `KybVerification` row is upserted before the network call is even attempted.
  - Tenant coverage (45 tests across 4 files: `credential.service.spec.ts` 8, `tenant.repository.spec.ts` 10, `tenant.service.spec.ts` 24, `tenant.controller.spec.ts` 8) covers the AES-256-GCM encrypt/decrypt round-trip in `CredentialService` including tenant-scoped key derivation (decryption fails if the tenantId, master key, or ciphertext differs from what it was encrypted with), the repository's `asAdmin`-wrapped Prisma calls and its partial-update field-inclusion logic (explicit `undefined` checks, not truthy checks, for `batchEnabled`/`batchSize`/`isActive`), the service's TIN-uniqueness/format validation, per-field credential re-encryption using the tenant's own TIN (not client-supplied input) as the key-derivation input, the fire-and-forget default-reminder-rule creation on tenant creation, and (added 2026-07-18) `interswitchCredentials.businessId` UUID-format rejection on both create and update.
  - Admin coverage (74 tests across 3 files: `admin.service.spec.ts` 44, `admin.controller.spec.ts` 22, plus (added to `shared/guards/`, since it's the admin-only IP allowlist) `admin-ip.guard.spec.ts` 8) covers admin login/bootstrap (bcrypt verify, inactive-account and wrong-password rejection, 8h bearer token issuance), dashboard/metrics/tenant-detail acceptance-rate math including the 0-total edge case, access-request approve-and-provision (tenant creation + request status update + applicant email, defaulting to `mock`/`SANDBOX` when unspecified) and reject, the hash-chained audit-log verifier (`verifyAuditChain` — valid GENESIS-rooted chain, legacy rows with no `entryHash` skipped, and tamper detection reporting the first broken event id), queue-monitoring success/failure paths for both the submission and bulk queues (mocking `getSubmissionQueue`/`getBulkSubmissionQueue` per the lazy-queue pattern — see BullMQ fix below), and the `AdminIpGuard` fail-open-with-no-allowlist behavior plus its exact-match and CIDR (including `/0` and `/32` edge cases) allow/deny logic — the guard flagged as failing open in Open Issue #2 above.
  - ~~Noted but not de-duplicated: `src/modules/admin/guards/admin-jwt.guard.ts` is a byte-identical copy of `src/modules/identity/guards/admin-jwt.guard.ts`~~ — **collapsed 2026-07-06.** `identity/guards/admin-jwt.guard.ts` had zero real call sites (only `AdminController`/`ActivityController`/`KybController` import the `admin/guards/` copy) — its 5-test spec was the only thing pointing at it. Deleted the unused `identity/guards/` copy and its spec, and moved the spec to sit next to the actually-wired `admin/guards/admin-jwt.guard.ts` instead (no import-path changes needed, spec already used a relative `./admin-jwt.guard` import). Net effect: one guard file instead of two, and the guard that's actually on the request path now has test coverage instead of its unused twin. `tsc`/`nest build` clean, full suite still 769/50, and verified live — booted the app and confirmed `GET /v1/activity/export` (guarded by this same class) still correctly returns `401` with no token.
  - Webhook coverage (`webhook.service.spec.ts`, 52 tests; `webhook.controller.spec.ts`, 9 tests) includes the SSRF-protection allow/block list in `validateUrl` (private IPv4/IPv6 ranges, `.local`/`.internal`, AWS metadata endpoint), delivery retry/dead-letter math against `MAX_ATTEMPTS`, and the outbound HMAC-SHA256 delivery signature — the `WebhookWorker`'s BullMQ wiring itself is intentionally untested (no business logic there beyond calling `processDelivery`, which is covered).
  - Identity/auth coverage (74 tests across 9 files: `token.service.spec.ts` 11 (rewritten for RS256 + 3 new: HS256-rejection, forged-admin-token, algorithm-pinning), `api-key.service.spec.ts` 20, `jwt.guard.spec.ts` 6, `api-key.guard.spec.ts` 5, `admin-key.guard.spec.ts` 4, `admin-jwt.guard.spec.ts` 5, `flex-auth.guard.spec.ts` 3, `identity.controller.spec.ts` 12, `config.validation.spec.ts` 6 (new — startup refusal without key IDs)) covers RS256 JWT issue/verify/rotate using test-generated RSA key pairs (no env vars), HS256 rejection and forged-token rejection, startup validation refusal without key IDs, API key lifecycle (create/verify/revoke/rotate-with-grace-period/list) and the expiry-warning cron (OWNER-only, urgency threshold), and all five auth guards (`JwtGuard`, `ApiKeyGuard`, `AdminKeyGuard`, `AdminJwtGuard`, `FlexAuthGuard`'s JWT-then-API-key fallback). The orphaned `test/unit/identity/api-key.service.spec.ts` (previously dead — never executed by any npm script) was deleted, superseded by the new, properly-located, more thorough version.
  - User module coverage (98 tests across 3 files: `mfa.service.spec.ts` 17, `user.service.spec.ts` 46, `user.controller.spec.ts` 35) covers real RFC-6238 TOTP generation/verification (not mocked — tests compute valid codes against the actual algorithm), backup-code consumption, login's account-lockout/MFA-branch/privileged-role-setup-prompt logic, invitation and password-reset token lifecycles (expired/used/invalid), and the two chunks of real business logic embedded in the controller itself: the tenant-profile allow-listed-field + address-JSON-merge logic in `updateMyTenant`, and the per-role dashboard-visibility defaults-merge + validation in `getDashboardVisibility`/`updateDashboardVisibility`.
- ~~Two spec files remain orphaned under `test/unit/`~~ — **fixed 2026-07-06.** `test/unit/invoice/xml-invoice.builder.spec.ts` was a stale duplicate missing newer test cases (`ClassifiedTaxCategory`/`taxCode` round-trip) already present in the real, running `src/modules/invoice/services/xml-invoice.builder.spec.ts` — deleted outright. `test/unit/invoice/state-machine.spec.ts` had no colocated equivalent, so it was moved (import path updated, content otherwise unchanged) to `src/modules/invoice/services/state-machine.service.spec.ts`, matching the project's colocated-spec convention; its 15 tests now actually run. The now-empty `test/unit/` directory was removed. (A third previously-orphaned file, `identity/api-key.service.spec.ts`, was deleted 2026-07-04 — superseded by a proper, more thorough version at `src/modules/identity/services/api-key.service.spec.ts`.)
- ~~Frontend has zero test infrastructure (no framework, no config, no test script)~~ — **foundation added 2026-07-10 (PR chore/frontend-test-infra).** Framework is Vitest + React Testing Library (`apps/web/vitest.config.ts` + `vitest.setup.ts`); test files live in `apps/web/__tests__/`. Scripts: `npm test` (`vitest run`), `npm run test:watch`, `npm run test:coverage`. Only 3 smoke tests exist so far (a component render, the `getInvoiceStatusPill` ACCEPTED-status label, and a `Button` onClick via `userEvent`) — proves the setup works, does not mean pages have coverage. Wired into CI as a new `frontend-tests` job in `pr-checks.yml` (runs `npm ci` + `npm test` with `working-directory: apps/web`). Along the way, found and worked around a pre-existing, unrelated bug: `apps/web`'s committed lockfile could not do a clean `npm ci` at all — a prior Dependabot merge (`af4f2ac`) bumped `eslint-config-next` to 16.2.6 (needs `eslint@>=9`) without bumping `eslint` (still `^8`). Added `apps/web/.npmrc` with `legacy-peer-deps=true` to unblock installs. ~~The underlying eslint version mismatch is still unresolved~~ — resolved 2026-07-10 as part of the Next.js 16 upgrade (see Open Issue #12): eslint bumped to `^9` with a flat-config migration, and the now-unnecessary `.npmrc` was removed (verified with a real `npm ci` first).
  - **Reminder:** once this PR merges, add `frontend-tests` to the required status checks in GitHub → Settings → Branches → branch protection rule for `main` (alongside the existing backend checks) — this was not done as part of the PR itself.

**Dead/misleading UI:**
- ~~`adminApi.exportPlatformCsv` and `adminApi.unlockAccount` are fully wired in the frontend API client but have no UI caller anywhere~~ — **fixed 2026-07-18 (PR `chore/ui-cleanup-admin-actions`).** Both backend endpoints were already complete (verified `exportPlatformCSV` against the identical, already-working `GET /v1/invoices/export/csv` pattern before wiring it up — same "return the CSV string, no explicit headers" shape, `requestBlob` doesn't need them). `exportPlatformCsv` is now a date-range export card on `apps/web/app/(admin)/admin/system/page.tsx`'s "Manual Operations" section, alongside the other admin action cards. `unlockAccount` is now a per-tenant-row "Unlock account" button on `apps/web/app/(admin)/admin/tenants/page.tsx` — prompts for the email to unlock (there's no per-user list anywhere in the admin UI yet, only tenant-level aggregates, so a raw tenantId+email form would have made an admin hand-type a UUID; the row action reuses the tenantId already in context instead).
- ~~The "Live chat" support button always falls back to `mailto:` because Intercom is never loaded~~ — **fixed 2026-07-18.** Removed entirely from `apps/web/app/(dashboard)/support/page.tsx` rather than replaced with a static label, since the adjacent "Email support" card was already the same `mailto:support@billinx.ng` address with honest copy — a static replacement would have just duplicated it. Contact cards grid is now 2-column (Documentation, Email support).
- ~~Two permanently-disabled "Coming soon" toggles in Settings (POS Integration, Email Invoice Intake)~~ — **removed 2026-07-18.** No planned implementation date existed for either; if/when they're actually scheduled, track them here, not as inert UI.
- ~~The invoice detail page's "Download PDF" button actually downloaded the XML export~~ — **fixed 2026-07-18 (PR `feat/pdf`)**, see Open Issues #7 above. It now downloads a real NRS-compliant PDF.
- **XML download — dashboard route retired, API-key route intentionally kept (2026-07-18, PR `chore/ui-cleanup-admin-actions`).** `GET /v1/invoices/dashboard/:id/xml` (`invoice-dashboard.controller.ts`) has been deleted — it had zero remaining callers once the PDF button replaced it (confirmed via repo-wide search before removing), and `apps/web/lib/api.ts`'s orphaned `invoiceApi.getXml` helper was removed with it. The **separate** `GET /v1/invoices/:id/xml` on `invoice-api.controller.ts` (`ApiKeyGuard`-protected, for third-party ERP consumers) was **deliberately left fully intact** — it's documented in `docs/api-changelog.md` and the Postman collection, has no PDF equivalent for API-key clients (PDF is JWT/dashboard-only), and removing a public endpoint without the 90-day deprecation notice `docs/api-changelog.md`'s own versioning policy requires would be an undocumented breaking change for external integrators. It is now considered **on a deprecation track pending a formal announcement** — do not remove it in a future cleanup pass without going through that process. The underlying `InvoiceService.exportAsXml()`/`XmlInvoiceBuilder` are untouched either way, still used by the surviving route.

### Engineer To-Dos (do not run through Claude Code without engineering review)
**Backend refactors — grew, not shrunk, since last noted:**
- `invoice.service.ts` — still large god service: create, validate, XML, draft, duplicate, stats, charts, sample. The three-divergent-validation-sets problem is **resolved** (PR #194 `refactor/unified-invoice-validation`) — all field validation now delegates to `InvoiceValidationService`. Remaining split plan (phased: dashboard/analytics extraction → mapper/export helpers → draft/lifecycle extraction) is still pending engineering review.
- ~~`invoice.controller.ts` — 786 lines — two auth surfaces in one file~~ — **split 2026-07-06.** This was the lower-risk half of the plan above (pure route reorganization, no business-logic changes) and was done after the plan was reviewed. Turned out to be four auth surfaces, not two — the `export/csv`, `export/json`, `export/monthly` routes live under the non-`dashboard/` URL prefix but actually use `JwtGuard` like the dashboard routes do, not `ApiKeyGuard` like their neighboring routes. Split into `InvoiceApiController` (`v1/invoices`, `ApiKeyGuard` — external ERP-facing routes), `InvoiceExportController` (`v1/invoices/export`, `JwtGuard` — the misplaced-prefix reporting routes), `InvoiceDashboardController` (`v1/invoices/dashboard`, `JwtGuard`+`RolesGuard` — internal frontend), and `InvoicePublicController` (`v1/invoices`, no guard — the one public payment-page route). Also dropped a `Logger` field that was instantiated but never called anywhere in the original file. Zero business logic changed — every route path, guard, and response is identical to before. The controller had **zero test coverage** before this (no spec file existed); added 47 delegation tests across the 4 new files (818 tests / 54 suites total, up from 771/50). Verified live: rebuilt, booted, and confirmed all four auth boundaries behave identically to before (401/401/401/404 on the four representative routes) plus a full `RouterExplorer` route-count diff against the original 37 routes.
- **New, previously unflagged:** `src/shared/email/email.service.ts` — 927 lines. `src/modules/user/services/user.service.ts` — 880 lines.

**Frontend refactors — grew, not shrunk, since last noted:**
- `invoices/new/page.tsx` — now **1,734 lines** (was ~1,557) → extract into sub-components (deliberately excluded from the 2026-07-20 extraction series below — recently changed by the productCategory/serviceCategory PR, left to settle).
- ~~`invoices/[id]/page.tsx` — now 1,527 lines (was ~1,486) → extract into sub-components.~~ — **extracted 2026-07-20 (PR `refactor/invoice-detail-extract-components`, PR 3 of the series — see below). Actual pre-extraction size was 1,540 lines.**
- ~~`settings/page.tsx` — unchanged at 1,138 lines → extract into sub-components.~~ — **extracted 2026-07-20 (PR `refactor/settings-extract-tabs`, PR 1 of a 3-page extraction series — see below).**
- ~~`dashboard/page.tsx` — 1,207 lines (corrected from a previously-documented 1,111)~~ — **extracted 2026-07-20 (PR `refactor/dashboard-extract-components`, PR 2 of the series — see below).**
- **New, previously unflagged:** `purchases/page.tsx` — 851 lines. `payments/page.tsx` — 845 lines.

**Component extraction series (2026-07-20)** — three oversized dashboard pages assessed together, extracted as three separate PRs in ascending-risk order (`invoices/new/page.tsx` deliberately excluded — recently changed by the productCategory/serviceCategory PR, left to settle). All three complete.
- ~~PR 1 — `settings/page.tsx`~~ — **done (PR `refactor/settings-extract-tabs`).** Dropped **1,138 → 119 lines**. New `settings/components/`: `ApiKeysTab.tsx`, `WebhooksTab.tsx`, `RemindersTab.tsx`, `CompanyTab.tsx` (keeps nested `TaxRepSection`), `FeaturesTab.tsx`, `NotificationsTab.tsx`, `SecurityTab.tsx`, `InvoicingTab.tsx` (the last three were previously inline JSX only, not yet functions — now proper components, reproducing their existing non-functional-placeholder behavior verbatim, e.g. no real state/handlers on most Notifications/Invoicing controls), plus a small `shared.ts` (`sel()` style helper, used by 4 tabs). Every extracted component is **zero-prop and fully self-contained** — this page turned out to have no cross-tab shared state at all beyond the tab-switcher itself (`mainTab`/`integTab`, which stays in the page). The `Suspense`/`useSearchParams()` split was left untouched. `SecurityTab` calls `useAuth()` itself rather than receiving `user` as a prop, matching how every other tab manages its own data access.
- ~~PR 2 — `dashboard/page.tsx`~~ — **done (PR `refactor/dashboard-extract-components`).** Dropped **1,206 → 296 lines**. New `dashboard/components/`: `DashboardHeader.tsx`, `AttentionBanner.tsx` (self-gates on its 3 mutually-exclusive states — returns `null` if none apply, rather than the page wrapping it in a `showBanner &&` condition), `FinancialSummaryCards.tsx`, `VatSummaryStrip.tsx`, `FirsRejectionsCard.tsx`/`CustomizeSheet.tsx`/`UserAvatarMenu.tsx` (moved near-verbatim — already standalone components in the original file), `DashboardCharts.tsx` (the 3 Recharts charts, their tooltips, and click-through handlers — self-gates on `anyChartVisible` and now internally derives `visibleChartCount`/`noChartData`, which were previously computed in the page but used nowhere else), `RecentPaymentsPanel.tsx`, `NeedsAttentionPanel.tsx`, `Sk.tsx` (skeleton primitive, shared by 5 files). Two non-component shared modules: `types.ts` (6 interfaces) and `visibility.ts` (`SECTION_LABELS`/`FINANCIAL_SECTIONS`/`canSeeFinancials`/`canCustomize`/`isSectionVisible`) — **required**, not optional, since `CustomizeSheet` independently consumes the same visibility helpers the page does. Per-section visibility gates (`{financials && sectionVisible('receivables') && (...)}` etc.) were kept wrapping each component's usage *in the page*, not pushed inside the components, exactly as planned. The Recharts tooltip function-reference wiring (`content={RevenueTooltip}`, not `content={<RevenueTooltip/>}`) and the non-standard Bar/Pie `onClick` datum access (`(data as unknown as {monthKey?:string})`, `nonZero[index]`) were preserved verbatim in `DashboardCharts.tsx` — both are fragile, previously-broken-before patterns per this file's own history. One self-caught mistake during extraction: an early draft of `DashboardCharts.tsx`'s `RevenueTooltip` used a raw `Intl.NumberFormat` call instead of reusing the shared `formatCurrency()` helper the original code called — fixed before verification to guarantee byte-identical output, not just visually-similar.
- ~~PR 3 — `invoices/[id]/page.tsx`~~ — **done (PR `refactor/invoice-detail-extract-components`), the most complex of the three.** Dropped **1,540 → 551 lines**. Moved near-verbatim (already standalone components in the original file): `Row.tsx`, `CreditNotesSection.tsx`, `AcceptedBanner.tsx`, `RejectedBanner.tsx` (bundles the `REJECTION_FIXES` lookup, only used there), `OverdueBanner.tsx` (its `react-hooks/purity` eslint-disable and the multi-line justification comment above it were kept byte-for-byte), `SubmissionProgress.tsx` (bundles `stepIcon`/`getSteps`). New extractions: `InvoiceHeader.tsx`, `InvoiceStatusBanners.tsx` (duplicated/overdue/accepted/rejected banners + the FIRS-details/payment-link/WHT cards — one bundle, matching how contiguous they were in the original JSX), `PaymentTrackingCard.tsx` (bundles the `PROVIDER_BADGE` lookup, only used there), `InvoiceHistorySections.tsx`, `InvoiceBottomBar.tsx`, `SendToBuyerModal.tsx`, `CancelInvoiceModal.tsx`, `RecordPaymentModal.tsx` (bundles the `PROVIDERS` lookup; the only modal whose original render guard was `{showPaymentModal && (...)}` with **no** `invoice &&` check — its `invoice` prop is correctly typed `InvoiceDetail | null`, not narrowed like the others, and every read goes through the original's exact optional-chaining), `InvoiceToasts.tsx` (combines the pay-link-copied and reminder toasts — two small, visually-adjacent, always-rendered elements), `CreditNoteModal.tsx`, plus a shared `types.ts` (`PaymentRecord`/`CreditNoteRecord`/`InvoiceDetail`/`RecordPaymentForm`). `openPaymentModal` and `copyPaymentLink` — each triggered from 3 different UI locations — stayed page-level functions passed down as plain callbacks, not pushed into any modal/card component. The credit-notes-section call and the `InvoiceDocument` call were left inline in the page orchestrator rather than wrapped in a new component, since they were already just calls to existing components. Toast/modal render order in the page's JSX was kept byte-for-byte identical to the original (their fixed `bottom-24`/`bottom-36` offsets are tuned relative to each other and to the bottom bar). The loading/error skeleton and the `showingProgress` early return both stayed in the page orchestrator, calling the moved `SubmissionProgress` component.

### Completed Frontend Features
- VAT Return Assistant: VAT category per line item, credit note model, VAT return summary endpoint + Excel export + dashboard page, BullMQ cron for monthly filing deadline reminders
- RBAC enforcement: roles (OWNER, ADMIN, INVOICE_CREATOR, VIEWER) enforced at API level via `@Roles()` decorators; static Role Permissions tab in Team settings
- Dashboard: interactive Revenue Trend and Invoice Pipeline charts with click-through to filtered invoice list; FIRS Rejections card; role-based visibility; per-user Customize panel; three-layer precedence (tenant admin rules → user preferences → role defaults)
- Invoice list: 5-column layout, combined FIRS/payment status pill, due date colour logic, distinct action icons
- Excel exports: invoice list, submissions history, audit log
- Top nav user avatar dropdown (2026-07-10): dashboard header's top-right now has a `UserAvatarMenu` (initials circle, same size/style as the sidebar's former bottom avatar) — click opens a small dropdown with full name (bold), role (grey), a divider, and Sign out (reusing the same `logout()` from `useAuth()`). Closes on outside click; on screens <768px the dropdown shows the avatar only, name/role text hidden. The sidebar's old bottom-left user profile section (name/role/logout) was removed in the same change since this replaces it — see Open Issue #13 for a real bug found along the way (JWT never carried a `name` claim; fixed 2026-07-18, dropdown now reads `name` straight from the token).
- Credit note visibility fix applied
- Public marketing landing page (2026-07-16): new standalone app `apps/marketing/` (port 3002) — 7-section scrolling page (Hero, Problem/Solution, Features, How It Works, Compliance Trust, Early Access waitlist, Footer) built with Tailwind + framer-motion, matching the shared brand tokens from `apps/web`. Waitlist form is `localStorage`-only pending a real backend endpoint — see the `apps/marketing` module note above.
- Recurring invoices (2026-07-21): new `apps/web/app/(dashboard)/invoices/recurring/page.tsx` — list view (name/buyer/frequency/next-run/status/invoice-count/actions, status badges, empty state) + `components/RecurringInvoiceFormModal.tsx` create/edit form. Sidebar entry added below "Sales Invoices". See the `invoice` module's recurring-invoices note above for the full backend design (scheduling, autoSubmit/autoSend semantics, a real bug caught and fixed via live verification).

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
