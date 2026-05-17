# Billinx — Comprehensive Technical Audit Report
**Date:** May 2026  
**Auditor:** Claude Code (Sonnet 4.6)  
**Branch audited:** `main` (post PR #13 merge)  
**Scope:** Full codebase — src/, prisma/, infra/, scripts/, docs/, Dockerfile, docker-compose.yml, .github/workflows/

---

## Table of Contents

- [A. Executive Summary](#a-executive-summary)
- [B. Architecture Assessment](#b-architecture-assessment)
- [C. Compliance Readiness — FIRS/NRS](#c-compliance-readiness--firsnrs)
- [D. Security Assessment](#d-security-assessment)
- [E. Production Readiness](#e-production-readiness)
- [F. Missing Features Checklist](#f-missing-features-checklist)
- [G. Critical Blockers](#g-critical-blockers)
- [H. Recommended Next Steps](#h-recommended-next-steps-priority-order)
- [I. Readiness Percentages](#i-readiness-percentages)
- [J. Detailed Roadmap](#j-detailed-roadmap)
- [K. Jira Epics & Stories](#k-jira-epics--stories)
- [L. Architecture Recommendations](#l-architecture-recommendations)
- [M. SI vs APP vs Hybrid Decision](#m-si-vs-app-vs-hybrid-decision)

---

## A. Executive Summary

Billinx is a **NestJS monolith** implementing Nigeria's FIRS/NRS e-invoicing compliance pipeline. The codebase is structurally sound, demonstrates sophisticated patterns (BullMQ async submission, AES-256-GCM credential encryption, Prisma RLS middleware, idempotency records, immutable state history), and has a credible path to production.

However, **three critical-severity issues** must be resolved before any production traffic touches the system:

1. **SQL injection in the Prisma RLS middleware** (`prisma.service.ts:32`) bypasses the row-level security model that the entire multi-tenancy guarantee rests on.
2. **Dev RSA private keys committed to source control** (`secrets.service.ts:172–181`) — rotatable, but the pattern is dangerous and must be removed.
3. **Terraform remote state is commented out** (`infra/main.tf:11–18`) — running `terraform apply` without an S3 backend will produce unencrypted local state containing database passwords and secret ARNs.

Beyond these blockers, the platform sits at roughly **61% production readiness**. The main gaps are: absent BullMQ worker process, no integration/e2e test coverage for the submission pipeline, missing ECS auto-scaling, single-NAT-gateway SPOF, and a submission status bug (`REJECTED` vs `DEAD_LETTERED` after 3 failures).

**Billinx's business model is sound as a System Integrator.** The Interswitch APP integration is the correct approach for launch. APP accreditation should be deferred until after 12 months of SI volume proves the business case.

---

## B. Architecture Assessment

### B.1 What is working well

| Strength | File | Evidence |
|---|---|---|
| AES-256-GCM authenticated encryption (not CBC) | `credential.service.ts:4,28` | Uses `aes-256-gcm` with auth tag — better than CBC |
| Idempotency via DB records | `idempotency.interceptor.ts:55–63` | Prevents duplicate invoice submissions |
| Immutable invoice state history | `invoice.repository.ts:84–106` | Every transition permanently recorded |
| Prisma RLS middleware | `prisma.service.ts:27–37` | PostgreSQL `SET LOCAL app.current_tenant_id` per request |
| Secrets Manager cache with warm-up | `secrets.service.ts:121–143` | Avoids cold-start latency in production |
| BullMQ job queuing | `submission.service.ts:32–65` | Invoices survive app restarts mid-queue |
| HMAC-SHA256 webhook signatures | `webhook.service.ts:49–54` | Signing keys encrypted before DB storage |
| bcrypt for passwords and API keys | `admin-key.guard.ts:46` | Standard secure hashing |
| AdminKey uses parameterized SQL | `admin-key.guard.ts:35–40` | Tagged template literals prevent SQL injection in guard |
| Helmet + structured request context | `main.ts:14`, `request-context.ts` | Security headers + thread-safe CLS context |

### B.2 Architecture Weaknesses

#### B.2.1 No BullMQ worker process configured
**Files affected:** `src/modules/submission/queues/submission.queue.ts`, `src/modules/webhook/queues/webhook.queue.ts`

The code calls `addToSubmissionQueue()` and `addToWebhookQueue()` but no standalone BullMQ Worker is wired into the NestJS application as a processor. Without a registered worker, queued jobs sit in Redis indefinitely and invoices remain in `QUEUED` status forever. This is a **production blocker**.

#### B.2.2 Wrong terminal status after 3 submission failures
**File:** `src/modules/submission/services/submission.service.ts:215`

```typescript
const newStatus = isFinal ? "REJECTED" : "SUBMISSION_FAILED";
```

The Prisma schema defines `DEAD_LETTERED` as the terminal status for exhausted retries (`prisma/schema.prisma:InvoiceStatus` enum). The code sets `REJECTED` instead, which semantically means "FIRS said no" rather than "we couldn't reach FIRS". This corrupts reporting and downstream logic.

#### B.2.3 Submission requestPayload is hollow
**File:** `src/modules/submission/services/submission.service.ts:104`

```typescript
requestPayload: { invoiceId, platformIrn, adapterKey },
```

The `requestPayload` field captures none of the actual invoice data sent to FIRS. For compliance audits, regulators need to see exactly what was transmitted. The full NRS payload (from the adapter) should be stored here.

#### B.2.4 Event dispatch is fire-and-forget with no retry
**File:** `src/modules/submission/services/submission.service.ts:263`

`eventEmitter.emit('invoice.rejected', ...)` is synchronous. If the webhook listener (`webhook.service.ts:152–155`) throws, the event is silently dropped. The BullMQ webhook queue exists but is only populated inside `dispatchEvent()` which can throw before queuing.

#### B.2.5 Race condition in tenant registration
**File:** `src/modules/user/services/user.service.ts` (tenant creation flow)

Check-then-insert is not atomic. Two concurrent registrations with the same TIN will both pass the existence check before either completes. The unique constraint on `Tenant.tin` will cause one to fail with a Prisma `P2002` error that surfaces as a 500, not a 409.

#### B.2.6 PrismaService logs all queries to stdout
**File:** `src/infrastructure/database/prisma.service.ts:19–23`

```typescript
log: [
  { emit: "event", level: "query" },   // ← logs every SQL query
  ...
]
```

Query-level logging in production leaks invoice amounts, TINs, and other PII to CloudWatch. These events are emitted but never consumed (no `this.$on('query', ...)` handler), so they accumulate silently.

---

## C. Compliance Readiness — FIRS/NRS

### C.1 NRS Integration Model

Billinx sits in the **System Integrator (SI)** role in the NRS chain:

```
Taxpayer Business → Billinx (SI) → Interswitch (APP) → FIRS NRS Platform
```

This is the correct and lowest-friction launch path. Interswitch holds the APP licence; Billinx provides the compliance API layer to businesses.

### C.2 What the NRS schema requires vs what Billinx implements

| NRS Field | Required | Billinx Status | Gap |
|---|---|---|---|
| `business_id` | Yes | Stored as `interswitchBusinessId` on Tenant | Field name mismatch — no dedicated `nrsBusinessId` column |
| `irn` | Yes | Generated as `platformIrn` | ✅ Correct |
| `issue_date` | Yes | ✅ | — |
| `invoice_type_code` | Yes | Stored as enum name, not NRS code | Mapped in `invoice.service.ts:398–406` and `xml-invoice.builder.ts` |
| `accounting_supplier_party` | Yes | Stored in `metadata.sellerParty` JSON | ✅ But schema-less JSON is fragile |
| `tax_total` | Yes | Stored as JSON `taxTotal` | ✅ |
| `legal_monetary_total` | Yes | Stored as JSON | ✅ |
| `invoice_line` | Yes | Stored as JSON `lineItems` | ✅ |
| `invoice_kind` | Yes | ✅ `invoiceKind` column | — |
| `document_currency_code` | Yes | `currency` column | — |
| Arithmetic validation | Yes | **Missing** — no server-side check that `sum(line_extension_amount) == legal_monetary_total.line_extension_amount` | **Gap** |
| `billing_reference` for credit notes | Yes (for type 381/383) | Checked in `invoice.service.ts:58–64` | ✅ |
| QR code on printed invoice | Yes | Stored as `qrCodeBase64`, returned from API | ✅ |
| Duplicate IRN prevention | Yes | `platformIrn` is unique in DB | ✅ |

### C.3 Critical Compliance Gaps

1. **No arithmetic validation** — `lineExtensionAmount × quantity` is not verified server-side before submission. FIRS rejects invoices with arithmetic errors, wasting submission attempts.
2. **Seller TIN must match tenant TIN** — `invoice.service.ts` does not validate that `request.seller.tin === tenant.tin`. A tenant could submit invoices on behalf of another business's TIN.
3. **No CSID (Cryptographic Stamp ID) storage** — The NRS returns a `csid` on acceptance. The `SubmissionResult` type has it (`result.csid`) but the `Invoice` model has no `csid` column; it is discarded after `activityService.track(...)`.
4. **NRS API base URL set but no NRS-native adapter** — `NRS_API_BASE_URL` is in `.env.example` but `submission.service.ts:29` only registers `mock` and `interswitch` adapters. There is no adapter that calls the NRS API directly. Currently the path is: Billinx → Interswitch → NRS, not Billinx → NRS directly.
5. **No sandbox test results** — No integration test demonstrates a successful round-trip through the Interswitch sandbox.

### C.4 NDPA 2023 Compliance

| Requirement | Implementation | Status |
|---|---|---|
| Consent recording | `ConsentService`, `ConsentRecord` model | ✅ |
| Right to erasure | `ErasureRequest` model + admin approval flow | ✅ |
| User anonymisation | Admin erasure logic (name → "Anonymized", email → hash) | ✅ |
| Consent version tracking | `consentVersion` field on `ConsentRecord` | ✅ |
| IP + user agent capture | `ConsentRecord.ipAddress`, `.userAgent` | ✅ |
| Consent fire-and-forget | `user.service.ts` — consent not awaited | ⚠️ **Consent may not be recorded if async call fails** |

---

## D. Security Assessment

### D.1 Critical — Fix before first customer

#### D.1.1 SQL Injection in Prisma RLS Middleware
**File:** `src/infrastructure/database/prisma.service.ts:31–33`  
**Severity:** CRITICAL

```typescript
await this.$executeRawUnsafe(
  `SET LOCAL app.current_tenant_id = '${ctx.tenantId}'`,
);
```

`tenantId` is a UUID sourced from a verified JWT or API key, so exploitation requires first breaking authentication. However, a `$executeRawUnsafe` with string interpolation is a structural violation of parameterized-query discipline. If `tenantId` ever comes from a non-authenticated path (e.g., a future public endpoint), this becomes an immediate injection vector that can DROP the RLS barrier protecting all tenants.

**Fix:**
```typescript
// prisma.service.ts:31
await this.$executeRaw`SET LOCAL app.current_tenant_id = ${ctx.tenantId}`;
```

#### D.1.2 Dev RSA Private Key Committed to Source
**File:** `src/infrastructure/secrets/secrets.service.ts:172–181`  
**Severity:** HIGH

A 2048-bit RSA private key is embedded in the source file as a string constant `DEV_RSA_PRIVATE_KEY`. Anyone with repository read access can forge JWTs for any user in any development/staging environment where `NODE_ENV !== "production"`. The key should be in a `.gitignore`-d file, not source code.

**Fix:** Move to `dev-keys/jwt-private.pem` and load with `fs.readFileSync`. Add `dev-keys/` to `.gitignore`.

#### D.1.3 Dev Master Encryption Key is All Zeros
**File:** `src/infrastructure/secrets/secrets.service.ts:152`  
**Severity:** HIGH

```typescript
"billinx/production/encryption-key": "0".repeat(64),
```

Every credential encrypted in a dev/staging environment uses an all-zero AES key. If anyone copies a dev database to test recovery, all `Bytes?` fields (API keys, MFA secrets, Interswitch credentials, webhook signing keys) are trivially decryptable. Should be a random per-developer value loaded from environment, never a predictable constant.

### D.2 High — Fix within Sprint 1

#### D.2.1 Fail-Open Rate Limiting Enables Brute Force
**File:** `src/shared/redis/redis.service.ts:48–51` and `72–74`  
**Severity:** HIGH

```typescript
} catch {
  // Fail open — a Redis outage should not cause an API outage
  return { allowed: true, remaining: limit, retryAfter: 0 };
}
```

Both `checkRateLimit` and `recordLoginFailure` fail open silently. During any Redis outage (planned maintenance, AZ failure), unlimited password brute-force is possible against any tenant account. The comment's rationale (API availability) is correct but the trade-off is backwards for **authentication** endpoints specifically.

**Fix:** Split into two behaviours — fail-open for invoice/webhook rate limiting (preserving API availability) but fail-closed (return 503) for `/v1/auth/token` and `/v1/auth/refresh`.

#### D.2.2 Idempotency Records Not Path-Scoped
**File:** `src/shared/interceptors/idempotency.interceptor.ts:55–63`  
**Severity:** MEDIUM**

The composite key is `(tenantId, idempotencyKey)`. Two different endpoints (e.g., `POST /v1/invoices` and `POST /v1/webhooks/subscriptions`) using the same `Idempotency-Key` value will collide — the second call will replay the first endpoint's response body regardless of its own request body.

**Fix:** Add request path to the composite key or include it in the `requestHash`.

#### D.2.3 Webhook Signature Missing Timestamp — Replay Attacks
**File:** `src/modules/webhook/services/webhook.service.ts` (delivery section)  
**Severity:** MEDIUM**

The `X-Billinx-Timestamp` header is sent but not included in the HMAC signature payload, so a captured valid webhook can be replayed indefinitely to any subscriber. The receiving system cannot detect replays because the signature will remain valid.

**Fix:** Include the timestamp string in the HMAC input and document that receivers must reject deliveries with timestamps older than 5 minutes.

#### D.2.4 Prisma Query Logging Leaks PII to CloudWatch
**File:** `src/infrastructure/database/prisma.service.ts:19–22`  
**Severity:** MEDIUM**

Query-level events are registered (`{ emit: "event", level: "query" }`) but no event handler is attached. In Prisma v5, unhandled `query` events still print to the default logger. Every SQL query — including ones containing invoice amounts, TINs, and user emails — goes to stdout and into CloudWatch Logs in production.

**Fix:** Remove the `query` log level for production, or attach a handler that redacts sensitive fields.

### D.3 Medium — Fix within Sprint 2

| Issue | File | Line | Impact |
|---|---|---|---|
| No pagination cap on `limit` param | `invoice.controller.ts:97–102` | — | `?limit=999999` → OOM |
| `JSON.parse(plaintext)` without schema validation | `credential.service.ts:77` | 77 | Corrupt encrypted data → uncaught throw |
| Key derivation uses HMAC not KDF | `credential.service.ts:13–18` | 13 | No stretch; deterministic given master key |
| Admin endpoints have no rate limiting | `admin.controller.ts` | — | Admin DoS possible |
| No request timeout on Express server | `main.ts` | — | Slowloris / slow-client attack |
| Seller TIN not validated against tenant | `invoice.service.ts:66–136` | — | Cross-TIN fraud possible |
| Webhook URL stored plaintext in DB | `webhook.service.ts:57–63` | 57 | DB breach reveals customer endpoints |
| `P2002` unique violations surface as HTTP 500 | `user.service.ts` tenant creation | — | Concurrent register → 500 not 409 |

### D.4 Security Strengths to Preserve

- **AES-256-GCM** (not CBC) with per-encrypt random IV — correct authenticated encryption (`credential.service.ts:4`)
- **bcrypt** for all password and API key storage (`admin-key.guard.ts:46`)
- **Parameterized SQL** in `AdminKeyGuard` using tagged template literals (`admin-key.guard.ts:35`)
- **Webhook signing keys encrypted** before database storage (`webhook.service.ts:50–54`)
- **Secrets Manager** for all production secrets with 5-minute cache (`secrets.service.ts:69–82`)
- **Helmet** middleware with sensible defaults (`main.ts:14`)
- **HTTPS-only** enforced for webhook subscriptions (`webhook.service.ts` URL validator)

---

## E. Production Readiness

### E.1 Infrastructure

| Component | Status | Issue |
|---|---|---|
| VPC + subnets | ✅ Ready | — |
| Security Groups | ✅ Ready | — |
| ECR | ✅ Ready | — |
| ALB + HTTPS | ✅ Ready | — |
| RDS PostgreSQL | ⚠️ Single-AZ | `infra/modules/rds/main.tf:35` — `multi_az = false` |
| ElastiCache Redis | ⚠️ Single node | No cluster mode; single AZ |
| ECS Fargate | ⚠️ No auto-scaling | Static `desired_count`; no `appautoscaling` resource |
| CloudWatch alarms | ✅ Defined | Alarm SNS topic created |
| **Terraform state** | ❌ **Not configured** | `infra/main.tf:11–18` — S3 backend commented out |
| NAT Gateway | ⚠️ Single AZ | `infra/modules/vpc/main.tf` — 1 NAT for all AZs |
| Secrets Manager rotation | ❌ Not set up | No rotation lambda configured |

### E.2 Application

| Component | Status | Issue |
|---|---|---|
| BullMQ queuing | ⚠️ Broken | Jobs enqueued but no worker process registered |
| Submission pipeline | ⚠️ Broken | Depends on BullMQ worker |
| Webhook delivery | ⚠️ Broken | Same — no worker |
| Database migrations | ✅ 11 applied | `scripts/run-migrations.sh` correct |
| Docker image | ✅ Multi-stage | Non-root user `billinx` |
| Health endpoint | ✅ `/health` | DB + Redis checks |
| Swagger docs | ✅ Non-production only | `main.ts:26` |
| CORS | ❓ Not configured | No `app.enableCors()` in `main.ts` |
| Request timeouts | ❌ Not set | Express default is none |
| Pagination safety | ❌ No cap | `limit=999999` accepted |

### E.3 CI/CD

| Step | Status | Issue |
|---|---|---|
| PR type-check | ✅ | `pr-checks.yml` |
| PR lint | ✅ | `pr-checks.yml` |
| Docker build test | ✅ | `pr-checks.yml` |
| Unit tests in CI | ❌ | **Not in `pr-checks.yml`** — tests never run on PRs |
| E2E tests in CI | ❌ | Not configured |
| Deploy on merge to main | ✅ | `deploy.yml` |
| Deployment notifications | ❌ | No failure alerts |
| Semantic versioning | ❌ | Tags created but no release notes |

### E.4 Observability

| Area | Status | Issue |
|---|---|---|
| Structured logging | ⚠️ Partial | `Logger` used throughout but no JSON formatter |
| Request tracing | ❌ | No `requestId` propagated to response headers |
| APM | ❌ | No X-Ray, Datadog, or OpenTelemetry |
| Alerting | ✅ | CloudWatch alarms for CPU, memory, 5xx |
| Slow query tracking | ❌ | RDS Performance Insights disabled (`rds/main.tf:48`) |
| Error budget / SLO | ❌ | Not defined |

---

## F. Missing Features Checklist

### F.1 Business-critical (blocking revenue)

- [ ] **BullMQ worker registration** — Without this, no invoice reaches FIRS
- [ ] **Seller TIN validation** — Must match tenant's registered TIN before submission
- [ ] **Invoice arithmetic validation** — Line totals must sum to `legal_monetary_total`
- [ ] **CSID storage** — NRS returns CSID on acceptance; must be stored and returned to customers
- [ ] **Sandbox end-to-end test** — Proven round-trip via Interswitch sandbox
- [ ] **CORS configuration** — Dashboard frontend cannot call the API
- [ ] **nrsBusinessId column on Tenant** — Current `interswitchBusinessId` is used as a workaround

### F.2 Operational (needed before scale)

- [ ] **ECS auto-scaling** — `aws_appautoscaling_target` + CPU/memory policies
- [ ] **RDS Multi-AZ** — Single AZ is unacceptable for financial data
- [ ] **NAT HA** — One NAT Gateway per AZ
- [ ] **Terraform S3 backend** — Must be configured before first `terraform apply`
- [ ] **Secrets rotation** — Rotation lambda for JWT keys and master encryption key
- [ ] **Request timeout** — `server.setTimeout(30000)` in `main.ts`
- [ ] **Pagination cap** — Hard max of 100 on all `limit` params
- [ ] **Unit tests in CI** — Add `npm test` to `pr-checks.yml`
- [ ] **Deployment failure alerts** — Slack/email on failed deploy

### F.3 Compliance (needed before regulated customers)

- [ ] **NDPA consent synchronous write** — Currently fire-and-forget; consent may be lost
- [ ] **Audit log immutability** — Current `AuditLog` table is mutable by DB admin
- [ ] **Data retention policy enforcement** — `IdempotencyRecord.expiresAt` is set but no cleanup job
- [ ] **Key rotation runbook** — Procedure for rotating master encryption key without data loss

### F.4 Developer experience (needed before team growth)

- [ ] **Integration tests for submission pipeline**
- [ ] **E2E tests for invoice lifecycle**
- [ ] **API client SDK (TypeScript)**
- [ ] **Postman collection**
- [ ] **Error code registry** — Standardised error codes across all modules

---

## G. Critical Blockers

These items prevent the application from being usable in production. Every other task should be deprioritised until these are resolved.

| # | Blocker | File | Fix Complexity |
|---|---|---|---|
| 1 | **BullMQ worker not registered** — no invoice submission completes | `submission.queue.ts`, `webhook.queue.ts` | Medium (1–2 days) |
| 2 | **SQL injection in RLS middleware** | `prisma.service.ts:32` | Trivial (30 min) |
| 3 | **Terraform state backend not configured** | `infra/main.tf:11–18` | Small (2 hrs) |
| 4 | **No unit tests in CI** — regressions undetected | `pr-checks.yml` | Trivial (30 min) |
| 5 | **`REJECTED` vs `DEAD_LETTERED` after 3 failures** — status corruption | `submission.service.ts:215` | Trivial (5 min) |
| 6 | **CORS not configured** — dashboard blocked | `main.ts` | Trivial (30 min) |
| 7 | **Dev RSA keys in source** | `secrets.service.ts:172–181` | Small (2 hrs) |

---

## H. Recommended Next Steps (Priority Order)

### Immediate (this week)

1. **Fix SQL injection** — change `$executeRawUnsafe` to tagged template literal in `prisma.service.ts:32`
2. **Fix DEAD_LETTERED status** — `submission.service.ts:215`: change `"REJECTED"` to `"DEAD_LETTERED"` for exhausted-retry terminal state
3. **Add unit tests to CI** — add `npm test -- --passWithNoTests --no-coverage` job to `pr-checks.yml`
4. **Configure CORS** — add `app.enableCors({ origin: process.env.CORS_ORIGIN, credentials: true })` in `main.ts`
5. **Configure Terraform S3 backend** — uncomment and provision S3 + DynamoDB table

### Sprint 1 (weeks 1–2)

6. **Register BullMQ workers** — create `SubmissionWorker` and `WebhookWorker` as NestJS providers
7. **Remove dev keys from source** — `secrets.service.ts:172–181` → load from gitignored file
8. **Add pagination cap** — all `limit` params hard-capped at 100
9. **Validate seller TIN** — `invoice.service.ts` must assert `seller.tin === tenant.tin`
10. **Invoice arithmetic validation** — sum line items, compare to `legalMonetaryTotal`
11. **Add CSID column** — `prisma/schema.prisma` Invoice model, store from adapter result
12. **Fix fail-open for auth endpoints** — `redis.service.ts` should return 503 during Redis outage for login

### Sprint 2 (weeks 3–4)

13. **Scope idempotency by path** — `idempotency.interceptor.ts:58`: include `request.path` in hash
14. **Add timestamp to webhook HMAC** — `webhook.service.ts` delivery signing
15. **Remove Prisma query logging** — `prisma.service.ts:20`
16. **ECS auto-scaling** — `aws_appautoscaling_target` in `infra/modules/ecs/main.tf`
17. **RDS Multi-AZ** — `infra/modules/rds/main.tf:35` → `multi_az = true`
18. **NAT Gateway per AZ** — `infra/modules/vpc/main.tf`
19. **Integration tests for submission pipeline** — sandbox round-trip

### Sprint 3 (weeks 5–6)

20. **Add `nrsBusinessId` column to Tenant model** — new migration
21. **Fix consent synchronous write** — await consent recording; surface errors
22. **Request timeout** — `main.ts`: `server.setTimeout(30000)`
23. **Deployment failure notifications** — `deploy.yml`: Slack step on `failure()`
24. **Structured JSON logging** — replace NestJS default logger with pino or winston

---

## I. Readiness Percentages

| Category | Score | Rationale |
|---|---|---|
| **Architecture** | 72% | Solid patterns; BullMQ worker gap, status bug, RLS SQL issue |
| **Security** | 55% | Good crypto choices; SQL injection, dev keys in source, fail-open auth |
| **FIRS/NRS Compliance** | 50% | Schema mapping correct; no arithmetic validation, no CSID, no sandbox proof |
| **Production Infrastructure** | 58% | Terraform exists; no state backend, no auto-scaling, single-AZ RDS |
| **Observability** | 40% | Alarms exist; no APM, no structured logging, no request tracing |
| **Testing** | 30% | 40 unit tests; no integration tests, no e2e, tests not in CI |
| **Documentation** | 65% | Good CLAUDE.md; deployment runbook exists; no API client docs |
| **CI/CD** | 60% | Deploy workflow works; tests not in CI, no failure alerts |
| **NDPA Compliance** | 75% | Consent + erasure models complete; fire-and-forget gap |
| **Overall** | **61%** | Not production-ready — 7 critical blockers outstanding |

### Readiness by milestone

| Milestone | Current | Target | Gap |
|---|---|---|---|
| APP integration readiness | 55% | 80% | BullMQ workers, CSID, sandbox test |
| Sandbox testing readiness | 45% | 75% | Integration tests, arithmetic validation |
| Pilot customer readiness | 35% | 70% | Security fixes, CORS, rate limits |
| Full production readiness | 61% | 95% | All items above + HA infra, monitoring |

---

## J. Detailed Roadmap

### Phase 0 — Critical Fixes (Week 1, no new features)

**Goal:** Unblock any further testing.

| Task | Owner | Effort |
|---|---|---|
| `prisma.service.ts:32` — switch to tagged template literal | Backend | 30 min |
| `submission.service.ts:215` — DEAD_LETTERED fix | Backend | 15 min |
| `main.ts` — add CORS | Backend | 30 min |
| `infra/main.tf:11–18` — enable S3 backend | DevOps | 2 hrs |
| `pr-checks.yml` — add test job | DevOps | 30 min |

---

### Phase 1 — APP Integration Readiness (Weeks 1–3)

**Goal:** A real invoice submitted to Interswitch sandbox returns an accepted response with CSID and QR code stored in the database.

**Milestone criteria:**
- BullMQ `SubmissionWorker` and `WebhookWorker` registered and tested
- Invoice created via API → queued → submitted to Interswitch sandbox → `ACCEPTED` with `firsConfirmedIrn`, `qrCodeBase64`, `csid` all stored
- `GET /v1/invoices/:id/status` returns QR code
- Integration test covers full lifecycle

**Key deliverables:**

1. **`src/modules/submission/workers/submission.worker.ts`** — BullMQ `Worker` class that calls `submissionService.processSubmission(job.data)`. Register as NestJS provider with `OnModuleInit`/`OnModuleDestroy`.
2. **`src/modules/webhook/workers/webhook.worker.ts`** — BullMQ `Worker` for webhook delivery.
3. **`prisma/schema.prisma`** — Add `csid String?` to Invoice model. New migration.
4. **`submission.service.ts:148`** — Store `result.csid` in `invoice.update()` data.
5. **`invoice.service.ts:60–65`** — Validate `request.seller.tin === tenant.tin`.
6. **`invoice.service.ts`** — Add arithmetic validation: `Σ(line.lineExtensionAmount) === legalMonetaryTotal.lineExtensionAmount`.
7. **`test/integration/submission.integration.spec.ts`** — Sandbox end-to-end test.

---

### Phase 2 — Sandbox Testing Readiness (Weeks 3–5)

**Goal:** CI runs integration tests against Interswitch sandbox on every merge to main.

**Milestone criteria:**
- All security critical/high fixes merged
- Integration tests pass in CI
- Invoice arithmetic validated before any submission attempt
- Webhook delivery confirmed to reach a test endpoint

**Key deliverables:**

1. Security fixes from H (items 2, 7, 8, 12)
2. Integration test suite with 20+ lifecycle scenarios
3. `test/jest-integration.json` config pointing at `test/integration/`
4. CI job: `npm run test:integration` in `deploy.yml` (sandbox environment)

---

### Phase 3 — Pilot Customer Readiness (Weeks 5–8)

**Goal:** First paying customer can register, create a real invoice, and receive FIRS confirmation.

**Milestone criteria:**
- All rate limiting hardened (auth fail-closed, per-endpoint limits)
- CORS configured for production domain
- Dashboard accessible to frontend team
- Error monitoring (Sentry or CloudWatch Logs Insights) alerting on 5xx
- Runbook for on-call engineer
- Customer onboarding flow tested end-to-end

**Key deliverables:**

1. `redis.service.ts` — fail-closed for auth endpoints
2. `main.ts` — CORS, request timeout
3. `invoice.controller.ts` — pagination cap
4. Structured JSON logging
5. Sentry SDK integration
6. Customer-facing API documentation (Redoc or Mintlify)
7. Onboarding runbook

---

### Phase 4 — Production Readiness (Weeks 8–16)

**Goal:** Multi-tenant scale with SLA commitments.

**Milestone criteria:**
- RDS Multi-AZ, automated backups, point-in-time restore tested
- ECS auto-scaling responding to load
- Secrets rotation automated
- 99.9% uptime over 30-day observation period
- SOC 2 Type I scope document drafted

**Key deliverables:**

1. `infra/modules/rds/main.tf:35` — `multi_az = true`
2. `infra/modules/ecs/main.tf` — auto-scaling policy
3. `infra/modules/vpc/main.tf` — NAT per AZ
4. Secrets Manager rotation lambda
5. Disaster recovery test (restore from backup, measure RTO/RPO)
6. Load test (k6 or Artillery) validating 500 concurrent invoice submissions
7. Security penetration test

---

## K. Jira Epics & Stories

### Epic 1: BILLINX-1 — Critical Security & Stability Fixes

**Acceptance Criteria:**
- All 7 critical blockers resolved
- Zero `$executeRawUnsafe` with string interpolation in codebase
- Dev RSA keys not present in any committed file
- `npm test` runs in every PR

**Stories:**

| Story | Description | Points |
|---|---|---|
| BILLINX-1.1 | Fix SQL injection in `prisma.service.ts:32` — switch to `$executeRaw` tagged template | 1 |
| BILLINX-1.2 | Fix terminal status `REJECTED` → `DEAD_LETTERED` in `submission.service.ts:215` | 1 |
| BILLINX-1.3 | Remove dev RSA keys from `secrets.service.ts:172–181`; load from gitignored `.dev-keys/` | 3 |
| BILLINX-1.4 | Replace all-zero dev encryption key with random per-env value in secrets fallback | 2 |
| BILLINX-1.5 | Add `npm test -- --passWithNoTests` to `pr-checks.yml` | 1 |
| BILLINX-1.6 | Add CORS config to `main.ts`; read from `CORS_ORIGIN` env var | 1 |
| BILLINX-1.7 | Configure Terraform S3 backend; provision bucket + DynamoDB lock table | 3 |

---

### Epic 2: BILLINX-2 — BullMQ Worker Registration

**Acceptance Criteria:**
- Invoice submitted via API reaches `ACCEPTED` status within 30 seconds in sandbox
- Webhook delivery fires within 10 seconds of invoice acceptance
- Workers restart cleanly on ECS task replacement

**Stories:**

| Story | Description | Points |
|---|---|---|
| BILLINX-2.1 | Create `SubmissionWorker` (`src/modules/submission/workers/submission.worker.ts`) using BullMQ `Worker` class | 5 |
| BILLINX-2.2 | Create `WebhookWorker` (`src/modules/webhook/workers/webhook.worker.ts`) | 5 |
| BILLINX-2.3 | Register both workers as NestJS providers with lifecycle hooks | 3 |
| BILLINX-2.4 | Add worker health to `GET /health` response | 2 |
| BILLINX-2.5 | Write integration test: invoice → queue → ACCEPTED status | 5 |

---

### Epic 3: BILLINX-3 — Invoice Compliance Validation

**Acceptance Criteria:**
- Invoice with arithmetic mismatch returns HTTP 422 with field-level error
- Invoice with seller TIN ≠ tenant TIN returns HTTP 403
- CSID stored on acceptance and returned in API response

**Stories:**

| Story | Description | Points |
|---|---|---|
| BILLINX-3.1 | Add arithmetic validation in `invoice.service.ts`: `Σ(lineExtensionAmount) === legalMonetaryTotal.lineExtensionAmount` with 0.01 tolerance | 3 |
| BILLINX-3.2 | Validate `seller.tin === tenant.tin` before `invoiceRepository.create()` | 2 |
| BILLINX-3.3 | Add `csid String?` column to `Invoice` model; new migration | 2 |
| BILLINX-3.4 | Store `result.csid` in `submission.service.ts:handleSuccess()` | 1 |
| BILLINX-3.5 | Return `csid` in `InvoiceResponse` and `InvoiceStatusResponse` | 2 |
| BILLINX-3.6 | Add `nrsBusinessId String?` column to `Tenant` model; migrate and update XML builder | 3 |

---

### Epic 4: BILLINX-4 — Security Hardening

**Acceptance Criteria:**
- Auth endpoints return 503 (not allow) during Redis outage
- Idempotency keys are path-scoped
- Webhook deliveries include timestamp in HMAC
- No query-level SQL logging in production
- All pagination `limit` params capped at 100

**Stories:**

| Story | Description | Points |
|---|---|---|
| BILLINX-4.1 | `redis.service.ts` — fail-closed for `checkRateLimit` called from `AuthRateLimitGuard` | 3 |
| BILLINX-4.2 | `idempotency.interceptor.ts:58` — include `request.path` in composite key | 2 |
| BILLINX-4.3 | Include timestamp in webhook HMAC signature; document 5-min replay window | 3 |
| BILLINX-4.4 | Remove `{ emit: "event", level: "query" }` from `prisma.service.ts:20` | 1 |
| BILLINX-4.5 | Add `Math.min(limit, 100)` to all paginated endpoints | 2 |
| BILLINX-4.6 | Add `server.setTimeout(30000)` in `main.ts` | 1 |
| BILLINX-4.7 | `credential.service.ts:77` — validate decrypted JSON schema before returning | 2 |
| BILLINX-4.8 | `prisma.service.ts` — catch P2002 and throw 409 ConflictException | 2 |

---

### Epic 5: BILLINX-5 — Production Infrastructure

**Acceptance Criteria:**
- `terraform apply` uses remote S3 state with DynamoDB lock
- RDS has Multi-AZ standby
- ECS scales from 1 to 10 tasks based on CPU
- NAT Gateway in every used AZ
- All alarm thresholds documented in runbook

**Stories:**

| Story | Description | Points |
|---|---|---|
| BILLINX-5.1 | Enable `multi_az = true` in `infra/modules/rds/main.tf:35` | 2 |
| BILLINX-5.2 | Enable `performance_insights_enabled = true` in RDS module | 1 |
| BILLINX-5.3 | Add `aws_appautoscaling_target` + CPU/memory policies in `infra/modules/ecs/main.tf` | 5 |
| BILLINX-5.4 | Add NAT Gateway per AZ in `infra/modules/vpc/main.tf` | 3 |
| BILLINX-5.5 | Fix `alb_arn_suffix` output in `infra/modules/alb/outputs.tf`; pass to CloudWatch | 2 |
| BILLINX-5.6 | Define missing Terraform variables (`postgres_version`, `redis_version`, `task_cpu`, `task_memory`, `max_images_to_keep`) | 2 |
| BILLINX-5.7 | Configure Secrets Manager rotation lambda for JWT and master encryption key | 8 |
| BILLINX-5.8 | Set up ElastiCache cluster mode for Redis HA | 5 |

---

### Epic 6: BILLINX-6 — Testing Coverage

**Acceptance Criteria:**
- Unit test coverage ≥ 70% across all modules
- Integration tests cover: register → create invoice → accept → webhook delivered
- E2E tests run against staging environment in CI
- `pr-checks.yml` fails if unit tests fail

**Stories:**

| Story | Description | Points |
|---|---|---|
| BILLINX-6.1 | Unit tests for `InvoiceService` (createInvoice, validateInvoice, cancelInvoice) | 5 |
| BILLINX-6.2 | Unit tests for `SubmissionService` (success path, retry path, dead-letter path) | 5 |
| BILLINX-6.3 | Unit tests for `WebhookService` (dispatch, delivery, retry) | 5 |
| BILLINX-6.4 | Unit tests for `UserService` (register, login, MFA, invite) | 5 |
| BILLINX-6.5 | Integration test: full invoice lifecycle with Interswitch sandbox | 8 |
| BILLINX-6.6 | Integration test: webhook delivery to test endpoint | 5 |
| BILLINX-6.7 | E2E test: tenant register → issue invoice → receive webhook | 8 |
| BILLINX-6.8 | Add `jest-integration.json` config; add `test:integration` npm script | 2 |
| BILLINX-6.9 | Add `npm test` job to `pr-checks.yml` | 1 |

---

### Epic 7: BILLINX-7 — Observability & Operations

**Acceptance Criteria:**
- All logs are structured JSON
- Every HTTP request has a unique `X-Request-ID` in response headers
- CloudWatch dashboard shows p50/p95/p99 latency per endpoint
- Sentry (or equivalent) captures all unhandled exceptions
- On-call runbook covers top 10 alert scenarios

**Stories:**

| Story | Description | Points |
|---|---|---|
| BILLINX-7.1 | Replace NestJS default logger with pino + pino-http | 5 |
| BILLINX-7.2 | Propagate `requestId` to response header `X-Request-ID` | 2 |
| BILLINX-7.3 | Integrate Sentry SDK; capture in `GlobalExceptionFilter` | 3 |
| BILLINX-7.4 | CloudWatch dashboard: latency, error rate, queue depth per service | 5 |
| BILLINX-7.5 | Enable RDS Performance Insights | 1 |
| BILLINX-7.6 | On-call runbook: 10 scenarios with resolution steps | 5 |
| BILLINX-7.7 | Deployment failure alert in `deploy.yml` (Slack/email) | 2 |

---

### Epic 8: BILLINX-8 — Compliance & Documentation

**Acceptance Criteria:**
- Consent recording is synchronous; consent failures are surfaced to user
- Idempotency records cleaned up after `expiresAt` (scheduled job)
- Key rotation runbook documented and tested
- Public API documentation published (Redoc/Mintlify)
- TypeScript SDK published to npm

**Stories:**

| Story | Description | Points |
|---|---|---|
| BILLINX-8.1 | Make consent recording synchronous in `user.service.ts` registration and login | 3 |
| BILLINX-8.2 | Scheduled job to purge expired `IdempotencyRecord` rows | 3 |
| BILLINX-8.3 | Key rotation runbook: step-by-step re-encryption of all tenant credentials | 5 |
| BILLINX-8.4 | NDPA data retention schedule document | 3 |
| BILLINX-8.5 | Public API docs via Redoc (export OpenAPI JSON from `/docs`) | 5 |
| BILLINX-8.6 | TypeScript SDK generated from OpenAPI spec | 8 |
| BILLINX-8.7 | Postman collection covering all endpoints | 3 |

---

## L. Architecture Recommendations

### L.1 Specific File Changes

| File | Change | Reason |
|---|---|---|
| `prisma.service.ts:32` | `$executeRaw` tagged template | SQL injection fix |
| `prisma.service.ts:19–22` | Remove query log level in production | PII leak |
| `submission.service.ts:215` | `"DEAD_LETTERED"` not `"REJECTED"` | Status semantic correctness |
| `submission.service.ts:104` | Store full NRS request payload, not just IDs | Compliance audit trail |
| `secrets.service.ts:172–181` | Load from `.dev-keys/` file, not source constant | Security |
| `main.ts:14–16` | Add `app.enableCors()`, `server.setTimeout(30_000)` | Correctness, resilience |
| `redis.service.ts:48–51` | Differentiate fail-open (invoice) vs fail-closed (auth) | Security |
| `idempotency.interceptor.ts:58` | Include path in composite key | Correctness |

### L.2 Folder Structure Improvements

```
src/modules/submission/
  adapters/
    mock/
    interswitch/
  workers/              ← ADD: submission.worker.ts
  queues/
  services/
  
src/modules/webhook/
  workers/              ← ADD: webhook.worker.ts
  queues/
  services/

src/shared/
  validation/           ← ADD: invoice-arithmetic.validator.ts
  logger/               ← ADD: pino.logger.ts
  
dev-keys/               ← ADD (gitignored): jwt-private.pem, jwt-public.pem
```

### L.3 API Structure Improvements

1. **Version all responses with `apiVersion` field** — clients can detect API upgrades
2. **Standardise error response envelope** — currently some errors are `{ message }` and some are `{ error, message, statusCode }`. Pick one schema.
3. **Add `X-Request-ID` response header** — traces a request through logs
4. **Add `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers** — standard API behaviour
5. **Invoice list cursor pagination** — offset pagination breaks at scale; switch to `cursor` + `nextCursor`

### L.4 Scaling Strategy

**Current state:** Single ECS task, single Redis node, single-AZ RDS, no CDN.

**Recommended path to 1,000 tenants / 1M invoices/month:**

| Layer | Current | Target | Change |
|---|---|---|---|
| API | 1 Fargate task | 2–10 auto-scaled | ECS auto-scaling (Epic 5) |
| Queue workers | 0 | 1–5 auto-scaled | Separate ECS service for workers |
| DB | Single-AZ `db.t3.medium` | Multi-AZ `db.r6g.large` | Epic 5 |
| Cache | Single Redis node | Cluster mode (3 shards) | Epic 5 |
| CDN | None | CloudFront for static assets | Future |
| Read replicas | None | 1 read replica for list queries | Future |

Separate the BullMQ worker into its own ECS service (same Docker image, `CMD ["node", "dist/worker.js"]`) so it scales independently of the API tier.

### L.5 Multi-Tenant Strategy Improvements

1. **Add `nrsBusinessId` column to `Tenant`** — eliminates the `interswitchBusinessId` workaround
2. **Per-tenant rate limit quotas in DB** — currently enum tiers; move to numeric `requestsPerHour` and `invoicesPerDay` columns for flexible pricing
3. **Tenant-level submission adapter override** — currently hard-coded from `appAdapterKey`; allow per-environment override so a tenant can test with mock in sandbox but use interswitch in production
4. **Tenant status field** — `ACTIVE`, `SUSPENDED`, `UNDER_REVIEW`; currently only `isActive: boolean`

---

## M. SI vs APP vs Hybrid Decision

### M.1 Current Position

Billinx is a **System Integrator (SI)**. It transmits invoices to FIRS via **Interswitch**, which is an **Access Point Provider (APP)**.

```
Taxpayer → Billinx SI → Interswitch APP → FIRS NRS
```

### M.2 Option Analysis

#### Option A: Remain SI Only (Recommended for launch)

**What it means:** Continue routing all submissions through Interswitch. Focus on the compliance API layer, developer experience, and multi-tenant features.

**Business case:**
- Fastest path to revenue — no FIRS accreditation process
- Lower technical complexity — Interswitch manages the FIRS protocol
- Interswitch bears the regulatory burden of APP compliance
- All engineering effort goes to product, not protocol

**Risks:**
- Commercial dependency on Interswitch — margin compression if they raise per-submission fees
- Interswitch outage = Billinx outage (mitigated by retry logic)
- Cannot negotiate SLA directly with FIRS

**Realistic timeline to revenue:** 6–8 weeks (after blockers resolved)

---

#### Option B: Integrate with Multiple APPs

**What it means:** Add adapters for NRS's other approved APPs (in addition to Interswitch). Billinx routes to the cheapest/fastest APP per submission.

**Business case:**
- Reduces Interswitch dependency; improves pricing leverage
- Potential to offer tenants APP choice
- No FIRS accreditation required

**Effort:** 4–6 weeks per new APP adapter. The `AppAdapter` interface (`src/modules/submission/adapters/app-adapter.interface.ts`) is already designed for this. This is the **recommended medium-term path**.

**Realistic timeline:** Pursue after achieving 50 active tenants on Interswitch.

---

#### Option C: Pursue APP Accreditation

**What it means:** Billinx applies directly to FIRS to become an Access Point Provider. This means connecting directly to the NRS platform without routing through Interswitch.

**Business case:**
- Full control of the submission pipeline
- Higher margins (no APP fee per submission)
- Ability to offer APP services to other SIs

**Risks and costs:**
- FIRS accreditation process is lengthy (6–18 months) and requires demonstrated volume
- Requires dedicated security audit and FIRS technical review
- Significant engineering investment: direct NRS protocol integration, PKI certificate management, guaranteed uptime SLA
- Regulatory risk: accreditation can be withdrawn

**Realistic financial case:** Only viable above ~500,000 invoices/month. At lower volumes, the Interswitch per-submission fee is cheaper than the engineering + regulatory cost of accreditation.

**Recommendation:** **Do not pursue APP accreditation before 12 months of proven volume.** Re-evaluate at month 12 based on actual invoice throughput.

---

### M.3 Recommended Roadmap

| Quarter | Action |
|---|---|
| Q3 2026 | Launch on Interswitch APP (SI mode). Resolve all critical blockers. |
| Q4 2026 | Add second APP adapter (whichever NRS-approved APP offers best terms). |
| Q1 2027 | Evaluate invoice volume. If >200k/month, begin APP accreditation feasibility study. |
| Q2 2027 | If volume justifies it, begin FIRS APP application. Otherwise, add third APP. |

The `AppAdapter` interface is already designed for multiple APPs. The adapter map in `submission.service.ts:28–29` simply needs a third entry. This is a low-risk path with high optionality.

---

## Appendix: Files Audited

| File | Lines | Status |
|---|---|---|
| `src/main.ts` | 48 | ✅ Read |
| `src/app.module.ts` | — | ✅ Read |
| `src/infrastructure/database/prisma.service.ts` | 56 | ✅ Read |
| `src/infrastructure/secrets/secrets.service.ts` | 182 | ✅ Read |
| `src/modules/identity/guards/admin-key.guard.ts` | 68 | ✅ Read |
| `src/modules/identity/guards/api-key.guard.ts` | — | ✅ Read |
| `src/modules/identity/guards/jwt.guard.ts` | — | ✅ Read |
| `src/modules/tenant/services/credential.service.ts` | 79 | ✅ Read |
| `src/modules/invoice/services/invoice.service.ts` | 442 | ✅ Read |
| `src/modules/invoice/invoice.controller.ts` | — | ✅ Read |
| `src/modules/invoice/repositories/invoice.repository.ts` | 118 | ✅ Read |
| `src/modules/submission/services/submission.service.ts` | 292 | ✅ Read |
| `src/modules/webhook/services/webhook.service.ts` | 350+ | ✅ Read |
| `src/shared/redis/redis.service.ts` | 109 | ✅ Read |
| `src/shared/interceptors/idempotency.interceptor.ts` | 111 | ✅ Read |
| `src/modules/invoice/services/xml-invoice.builder.ts` | — | ✅ Read |
| `prisma/schema.prisma` | — | ✅ Read |
| `infra/main.tf` | 178 | ✅ Read |
| `infra/modules/rds/main.tf` | — | ✅ Read |
| `infra/modules/ecs/main.tf` | — | ✅ Read |
| `infra/modules/vpc/main.tf` | — | ✅ Read |
| `infra/modules/alb/main.tf` | — | ✅ Read |
| `infra/modules/elasticache/main.tf` | — | ✅ Read |
| `infra/modules/cloudwatch/main.tf` | — | ✅ Read |
| `infra/modules/security-groups/main.tf` | — | ✅ Read |
| `infra/modules/secrets/main.tf` | — | ✅ Read |
| `infra/modules/ecr/main.tf` | — | ✅ Read |
| `Dockerfile` | — | ✅ Read |
| `docker-compose.yml` | — | ✅ Read |
| `.env.example` | — | ✅ Read |
| `package.json` | — | ✅ Read |
| `docs/deployment.md` | — | ✅ Read |
| `docs/nrs-api-spec.md` | — | ✅ Read |
| `docs/nrs-invoice-schema.md` | — | ✅ Read |
| `docs/interswitch-api-spec.md` | — | ✅ Read |
| `.github/workflows/deploy.yml` | — | ✅ Read (feat/github-actions branch) |
| `.github/workflows/pr-checks.yml` | — | ✅ Read (feat/github-actions branch) |
| `scripts/setup-aws.sh` | — | ✅ Read |
| `scripts/run-migrations.sh` | — | ✅ Read |
| `scripts/health-check.sh` | — | ✅ Read |
| `scripts/update-secrets.sh` | — | ✅ Read |
| `CLAUDE.md` | — | ✅ Read |

---

*Report generated by Claude Code (Sonnet 4.6) — May 2026. Based on static analysis of source files. Does not replace a formal security penetration test.*
