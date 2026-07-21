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
See [docs/api-integrations.md](docs/api-integrations.md) for the full `submission` module description (BullMQ adapters, UpdateStatus queue).

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
See [docs/api-integrations.md](docs/api-integrations.md) for the full `payment` module description (Paystack/Flutterwave).

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
See [docs/security-guardrails.md](docs/security-guardrails.md).

### PrismaService
See [docs/security-guardrails.md](docs/security-guardrails.md) for the full two-client/RLS architecture.

## Environment Variables
See [docs/deployment.md](docs/deployment.md) for the full environment variable reference.

## Infrastructure (Terraform)
See [docs/deployment.md](docs/deployment.md) for the Terraform module table and `terraform apply` steps.

## Scripts
See [docs/deployment.md](docs/deployment.md) for the ops-scripts table.

## GitHub Actions
See [docs/deployment.md](docs/deployment.md) for the full CI/CD workflow table, required-checks list, and secret-scanning notes.

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
- 973 tests passing, 61 suites, 45 DB models, 23 enums — up from 863/56 (2026-07-09) via several PRs since (OAuth/prettier/lint work not separately itemised here) plus `fix/nrs-schema-alignment` (2026-07-18): new `payment.service.spec.ts` (18 tests — this file, `src/modules/invoice/services/payment.service.ts`, had **zero** prior coverage), `update-status.worker.spec.ts` (5 tests), `interswitch.adapter.spec.ts` rewritten for OAuth (53 tests), plus new/updated cases in `invoice-validation.service.spec.ts`, `tenant.service.spec.ts`, and `product-catalog.service.spec.ts` for the new NRS-schema rules; plus `fix/jwt-name-claim` (1 test), `feat/pdf` (8 tests: new `invoice-pdf.service.spec.ts` — 7 tests, plus 1 new `invoice-dashboard.controller.spec.ts` case), and `feat/debug` (11 tests: 8 new `previewPayload` cases in `interswitch.adapter.spec.ts`, 3 new `invoice-dashboard.controller.spec.ts` cases) since. Backend test count is 993 as of `chore/ui-cleanup-admin-actions` (2026-07-18) — one delegation test for the retired dashboard `:id/xml` route was removed along with the route itself; no other suites changed. 1010 tests / 64 suites as of `fix/line-item-normalisation` (2026-07-20): new `invoice.service.spec.ts` (17 tests — `InvoiceService` had no dedicated spec file before this, only the indirect `invoice-flow.integration.spec.ts` coverage) for `normaliseLineItems()` and its five call sites, see the line-item shape-mismatch note above. **1062 tests / 67 suites** as of `feat/recurring-invoices` (2026-07-21): new `recurring-invoice.service.spec.ts` (44 tests), `recurring-invoice.controller.spec.ts` (7 tests), `recurring-invoice.scheduler.spec.ts` (1 test) — see the `invoice` module's recurring-invoices note above. Backend/frontend unit test counts unchanged by `test/e2e-playwright-tests` (2026-07-21) — that PR adds a *separate* suite, 7 Playwright tests (2 one-time auth-setup + 5 journeys) in `apps/web/e2e/`, run by their own `npm run test:e2e` / CI job rather than `npm test` — see the Test coverage section's E2E-tests note (just above the "Dead/misleading UI" heading) for the full design and the several real bugs it caught.
- Last merged PRs: `test/e2e-playwright-tests` (this one), `feat/recurring-invoices`, `chore/ui-cleanup-admin-actions`, `feat/api-key-scopes-rate-limiting`, `feat/swagger-openapi-docs`

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

**NRS Schema Alignment** — 18 compliance gaps against the NRS API/invoice schema, resolved 2026-07-18 (PR `fix/nrs-schema-alignment`). See [docs/nrs-schema-alignment.md](docs/nrs-schema-alignment.md) for the full gap-by-gap record, including the Interswitch OAuth architecture decision and the CSID resolution note.

**Security** — full 2026-07-04 audit finding-by-finding record (JWT RS256 migration, admin IP allowlist, payment auth/rate limiting, RLS enforcement, CORS validation, CodeQL fixes, dependency CVEs, JWT `name` claim). See [docs/security-guardrails.md](docs/security-guardrails.md).

**Test coverage** — per-module backend/frontend/E2E test coverage detail. See [docs/testing.md](docs/testing.md) for the full breakdown and how to run each suite.

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
