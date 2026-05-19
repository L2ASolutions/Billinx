# Billinx Security Audit Report

**Date:** 2026-05-18  
**Scope:** Full source code audit — NestJS API, PostgreSQL, Redis, BullMQ, AWS ECS Fargate  
**Standard:** OWASP Top 10 (2021) + OWASP API Security Top 10 (2023)  
**Auditor:** L2A Solutions Engineering (internal pre-pen-test review)

---

## 1. OWASP Top 10 (2021) Assessment

### A01 — Broken Access Control

**Status: LARGELY MITIGATED with one remaining gap**

**Evidence of controls:**
- `src/infrastructure/database/prisma.service.ts:26–35` — PostgreSQL RLS via `SET LOCAL app.current_tenant_id` on every transaction; tenant data physically cannot bleed across boundaries
- `src/infrastructure/database/prisma.service.ts:48–53` — `asAdmin()` uses `SET LOCAL row_security = OFF` inside a transaction; admin bypass is explicit, audited, and isolated per-query
- `src/modules/identity/guards/api-key.guard.ts:39–42` — API key format validated (`/^blx_(live|test)_[A-Za-z0-9_-]{20,}$/`) before any DB lookup
- `src/modules/identity/services/api-key.service.ts:101–118` — `verifyApiKey()` checks `isRevoked: false` AND `expiresAt: { gt: new Date() }` before accepting a key
- `src/shared/utils/role-checker.ts` — `checkRole()` enforced at service layer for all privileged user operations
- `src/modules/webhook/services/webhook.service.ts:350–407` — Webhook URLs validated for HTTPS, blocked private IP ranges, AWS metadata endpoint (`169.254.169.254`)

**Remaining gap:**
- `src/main.ts:57–63` — `ValidationPipe` configured with `whitelist: false, forbidNonWhitelisted: false`. Unknown fields are not stripped or rejected, creating a potential injection surface through undocumented parameters reaching service layer.
- **Severity: MEDIUM** — Exploitability depends on individual service handling; no direct data exposure confirmed, but surface area is wider than necessary.
- **Fix:** Change to `whitelist: true, forbidNonWhitelisted: true, transform: true` after auditing all DTOs.

---

### A02 — Cryptographic Failures

**Status: STRONG — No critical issues**

**Evidence of controls:**
- `src/modules/tenant/services/credential.service.ts:4` — AES-256-GCM used for all credential encryption (authenticated encryption, not just AES-CBC)
- `src/modules/tenant/services/credential.service.ts:13–19` — Per-tenant key derivation via HMAC-SHA256 with master key + tenantId; no key reuse across tenants
- `src/modules/tenant/services/credential.service.ts:27` — Random 16-byte IV per encryption call (`crypto.randomBytes(16)`)
- `src/modules/tenant/services/credential.service.ts:31–34` — Auth tag appended to ciphertext, verified on decrypt — integrity protected
- `src/modules/identity/services/api-key.service.ts:19,55` — bcrypt with 12 rounds for API key hashing; CSPRNG 48-byte (384-bit) entropy
- `src/modules/user/services/user.service.ts:41,91` — bcrypt 12 rounds for user passwords
- `src/modules/user/services/mfa.service.ts:57` — TOTP via HMAC-SHA1 (RFC 6238 compliant); MFA secrets encrypted before storage via CredentialService
- `src/infrastructure/secrets/secrets.service.ts` — All production secrets from AWS Secrets Manager; 5-minute in-process cache; no secrets in environment variables for production
- `infra/modules/rds/main.tf:storage_encrypted = true` — RDS encrypted at rest
- HTTPS enforced at ALB; HSTS header set with 1-year max-age + preload (`src/main.ts:39–48`)

**Remaining gaps:**
- `src/modules/user/services/token.service.ts:44–45` — JWT signed with `JWT_SECRET` (symmetric HS256) in development. Production path should use RS256 keys from Secrets Manager but `TokenService` does not switch algorithms conditionally on `NODE_ENV`. If `JWT_SECRET` is present in production environment, HS256 would be used instead of RS256.
  - **Severity: MEDIUM** — Risk exists only if production is accidentally configured with `JWT_SECRET` instead of Secrets Manager keys.
  - **Fix:** Make TokenService always use RS256 in production; fail hard if JWT_SECRET is set when NODE_ENV=production.
- `src/infrastructure/secrets/secrets.service.ts:186` — Dev fallback for `MASTER_ENCRYPTION_KEY` defaults to `'0'.repeat(64)` — all-zero encryption key. Acceptable in dev only; confirmed production path goes to Secrets Manager.
  - **Severity: LOW** (dev only)

---

### A03 — Injection

**Status: MITIGATED**

**Evidence of controls:**
- All database access via Prisma ORM with parameterised queries; raw SQL used in only two places:
  - `src/modules/identity/guards/admin-key.guard.ts:35–40` — `$queryRaw` with tagged template literal (parameterised, safe)
  - `src/infrastructure/database/prisma.service.ts:31` — `$executeRaw` with tagged template literal (parameterised, safe)
- `src/modules/invoice/bulk/bulk-invoice.service.ts:parseCsvRow()` — Inline CSV parser; no eval, no shell execution
- No `child_process.exec()` usage found in codebase
- Express body parser with 10 MB limit prevents large payload injection

**No SQL injection, command injection, or template injection vulnerabilities found.**

---

### A04 — Insecure Design

**Status: GENERALLY GOOD with two design notes**

**Positive design patterns:**
- Immutable audit trail: every HTTP request logged, every invoice state transition recorded (`InvoiceStateHistory`)
- Hash-chained `ActivityEvent` records prevent tampering without detection
- `IdempotencyRecord` prevents duplicate operations; 24-hour TTL
- Fail-closed Redis auth: `AuthRateLimitGuard` throws `ServiceUnavailableException` if Redis is unavailable rather than allowing unlimited attempts

**Design concerns:**
- `src/modules/submission/workers/submission.worker.ts` and `src/modules/submission/workers/bulk-submission.worker.ts` — BullMQ workers run in the same process as the HTTP server. A crash in a worker (unhandled exception) could take down the API. A dedicated worker process would isolate this.
  - **Severity: LOW** (reliability concern, not a security vulnerability directly)
- Fixed-window rate limiting (`src/shared/interceptors/tenant-rate-limit.interceptor.ts:41`) allows burst exploitation at the hour boundary (2× limit possible in a 2-second window at rollover).
  - **Severity: LOW** — Mitigated by per-IP auth rate limiting and account lockout.

---

### A05 — Security Misconfiguration

**Status: MITIGATED with one note**

**Evidence of controls:**
- `src/main.ts:39–48` — Helmet: HSTS (1 yr + preload), referrer-policy strict, no cross-domain policies
- `src/main.ts:65` — Swagger/OpenAPI docs disabled when `NODE_ENV=production`
- `src/config/config.validation.ts` — Startup validation fails fast if required env vars missing
- `src/infrastructure/secrets/secrets.service.ts:29–41` — Production-only Secrets Manager path; dev fallbacks clearly gated on `!isProduction`
- ECS tasks in private subnets; only ALB exposed to internet (`infra/modules/security-groups/main.tf`)
- RDS in private subnet, not directly reachable from internet
- Container Insights enabled on ECS cluster (`infra/modules/ecs/main.tf:setting containerInsights = enabled`)

**Remaining gap:**
- No container image vulnerability scanning in CI pipeline (`.github/workflows/deploy.yml` — no Trivy, Snyk, or ECR scan step). A vulnerable base image (Node.js, Alpine) could be deployed unknowingly.
  - **Severity: MEDIUM**
  - **Fix:** Add Trivy scan before ECR push. See Section 5.

---

### A06 — Vulnerable and Outdated Components

**Status: UNKNOWN — Not assessed**

- No `npm audit` step in `.github/workflows/pr-checks.yml` or `deploy.yml`
- Node.js version pinned to 20 in GitHub Actions (LTS — acceptable)
- Package versions not reviewed in this audit (no lock-file analysis performed)
- **Severity: MEDIUM** — Unknown exposure to known CVEs in dependencies
- **Fix:** Add `npm audit --audit-level=high` to `pr-checks.yml`. Run immediately.

---

### A07 — Identification and Authentication Failures

**Status: STRONG**

**Evidence of controls:**
- `src/modules/user/services/user.service.ts:154–169` — Login lockout: 5 failures per 15 minutes per `tenantId:email`; Redis-backed; fail-closed on Redis unavailability
- `src/shared/guards/auth-rate-limit.guard.ts` — IP-based rate limit on auth endpoints: 5 attempts per 15 minutes; X-Forwarded-For normalisation handles IPv6-mapped IPv4
- `src/modules/user/services/user.service.ts:187–189` — Failed login incremented even for unknown emails (prevents timing-based user enumeration)
- `src/modules/user/services/mfa.service.ts` — TOTP MFA required for OWNER/ADMIN roles; backup codes issued at setup; secrets encrypted at rest
- `src/modules/identity/services/token.service.ts:28–35` — Access tokens: 15-minute TTL (configurable via `JWT_ACCESS_TOKEN_EXPIRY`); refresh tokens: 7-day TTL
- `src/modules/identity/services/api-key.service.ts:263–318` — Daily cron checks keys expiring ≤7 days; emails OWNER users; 24-hour grace-period rotation available
- `src/modules/user/services/user.service.ts:44` — Password reset tokens: 2-hour single-use
- `src/modules/user/services/user.service.ts:43` — Invitations: 7-day expiry

**No authentication failures found.**

---

### A08 — Software and Data Integrity Failures

**Status: PARTIAL**

**Evidence of controls:**
- `src/shared/interceptors/audit-log.interceptor.ts` — All requests logged with sanitised body; uses shared `sanitize()` to redact 16 sensitive key patterns
- Activity events hash-chained (SHA-256): `SHA256(tenantId|eventType|actor|occurredAt|payload|previousHash)` — tampering detectable
- Prisma migrations committed to source control; applied via `migrate deploy` (no ad-hoc DDL)
- GitHub Actions deploys from CI pipeline, not manual pushes

**Remaining gaps:**
- No Sigstore/cosign image signing. Docker image is built and pushed to ECR but not cryptographically signed.
  - **Severity: LOW** — ECR is private; risk of image substitution is low in this architecture.
- No `npm ci --ignore-scripts` in CI — build scripts from dependencies run untrusted code.
  - **Severity: LOW** — Mitigated by npm lock file.

---

### A09 — Security Logging and Monitoring Failures

**Status: PARTIAL**

**Evidence of controls:**
- `src/shared/interceptors/audit-log.interceptor.ts` — Every HTTP request/response written to `AuditLog` table (async, non-blocking)
- `src/shared/filters/global-exception.filter.ts:54–61` — Unhandled exceptions captured to Sentry and written to `SystemError` table
- `src/modules/activity/services/activity.service.ts` — Business events tracked: login, login failure, invoice creation, API key operations
- CloudWatch log groups configured in Terraform (`infra/modules/cloudwatch/`)
- ECS Container Insights enabled

**Remaining gaps:**
- NestJS default logger outputs plain-text; no structured JSON logging. CloudWatch Insights queries on free-text logs are fragile and slower.
  - **Severity: LOW** — Functional but not optimal for pen-test or incident investigation
- No `npm audit` alerts; no Dependabot configured
- No CloudWatch alarms on auth failure rate (only alarms in Terraform are general)

---

### A10 — Server-Side Request Forgery (SSRF)

**Status: MITIGATED**

**Evidence of controls:**
- `src/modules/webhook/services/webhook.service.ts:350–407` — Webhook URL validated:
  - HTTPS required (line 359)
  - Private IPv4 ranges blocked: `10.x.x.x`, `172.16–31.x.x`, `192.168.x.x`, `127.x.x.x` (lines 376–388)
  - AWS metadata endpoint `169.254.169.254` explicitly blocked (line 389)
  - IPv6 loopback and private ranges blocked (lines 394–403)
- `src/modules/kyb/services/kyb.service.ts` — CAC API calls use configured base URL from environment variable; no user-supplied URL routing

**No SSRF vulnerabilities found.**

---

## 2. OWASP API Security Top 10 (2023) Assessment

### API1 — Broken Object Level Authorization (BOLA)

**Status: MITIGATED**

Every resource query filters by `tenantId` from `RequestContext` (populated by guards, never from user input). PostgreSQL RLS provides a second independent enforcement layer. Example: `src/modules/invoice/repositories/invoice.repository.ts:40` — `WHERE tenantId = ctx.tenantId`.

### API2 — Broken Authentication

**Status: MITIGATED** — See A07 above.

### API3 — Broken Object Property Level Authorization (BOPLA)

**Status: PARTIAL GAP**

- `src/main.ts:57–63` — `whitelist: false` allows unknown fields to pass through. Service-layer code that uses `request as any` or spreads body objects could inadvertently process injected fields.
- **Severity: MEDIUM** — Fix: `whitelist: true` in ValidationPipe.

### API4 — Unrestricted Resource Consumption

**Status: MITIGATED**

- 10 MB body limit (`src/main.ts:51,53`)
- Per-tenant tier-based rate limits: STANDARD 100/hr, PREMIUM 1,000/hr, ENTERPRISE 10,000/hr
- Bulk endpoint: max 500 invoices, 5 MB CSV, 3 bulk requests/minute per tenant (`src/modules/invoice/bulk/bulk-invoice.service.ts:13–16`)
- BullMQ worker rate limiter: max 50 jobs/second (individual), max 50 jobs/second (bulk) — prevents adapter overload

### API5 — Broken Function Level Authorization (BFLA)

**Status: MITIGATED**

- Admin endpoints protected by `AdminKeyGuard` or `AdminJwtGuard` on every route (`src/modules/admin/admin.controller.ts`)
- User endpoints protected by `JwtGuard`; API key endpoints by `ApiKeyGuard`
- Role checks (`checkRole()`) enforced at service layer for privilege escalation scenarios

### API6 — Unrestricted Access to Sensitive Business Flows

**Status: MITIGATED**

- Invoice creation requires API key authentication with active, unexpired, unrevoked key
- Bulk invoice ingestion: 3 requests/minute Redis rate limit per tenant
- Export endpoints: 60-second Redis cooldown per tenant per export type

### API7 — Server-Side Request Forgery (API)

**Status: MITIGATED** — See A10 above.

### API8 — Security Misconfiguration

**Status: LARGELY MITIGATED** — See A05 above. One gap: no image scanning in CI.

### API9 — Improper Inventory Management

**Status: PARTIAL**

- Swagger docs disabled in production (`src/main.ts:65`) ✓
- No documented API deprecation enforcement at runtime; `X-API-Deprecated` and `X-API-Sunset` headers documented in `docs/api-versioning.md` but not yet emitted by the code.
  - **Severity: LOW**

### API10 — Unsafe Consumption of APIs

**Status: PARTIAL**

- `src/modules/submission/adapters/interswitch/interswitch.adapter.ts` — Outbound calls to Interswitch/NRS API. Response validation exists; no timeout configured in the adapter (relies on BullMQ job timeout).
  - **Severity: LOW** — Add explicit `AbortController` timeout on fetch calls to FIRS adapter.

---

## 3. Current Vulnerabilities by Severity

### HIGH

| ID | Vulnerability | File | Line | Status |
|---|---|---|---|---|
| H-01 | No container image vulnerability scanning — a CVE-laden Node base image could be deployed | `.github/workflows/deploy.yml` | — | **OPEN** |
| H-02 | `npm audit` not run in CI — known vulnerable dependency could be shipped | `.github/workflows/pr-checks.yml` | — | **OPEN** |

### MEDIUM

| ID | Vulnerability | File | Line | Status |
|---|---|---|---|---|
| M-01 | `ValidationPipe` accepts unknown fields (`whitelist: false`) | `src/main.ts` | 59–60 | **OPEN** |
| M-02 | JWT algorithm not enforced — HS256 used in production if `JWT_SECRET` is set | `src/modules/identity/services/token.service.ts` | 44–45 | **OPEN** |
| M-03 | Fixed-window rate limiting — 2× burst possible at hour boundary | `src/shared/interceptors/tenant-rate-limit.interceptor.ts` | 41 | **OPEN** |
| M-04 | No explicit timeout on FIRS adapter outbound HTTP calls | `src/modules/submission/adapters/interswitch/interswitch.adapter.ts` | — | **OPEN** |
| M-05 | Admin panel has no IP allowlist — accessible from any IP with valid key | `src/modules/admin/admin.controller.ts` | — | **OPEN** |

### LOW

| ID | Vulnerability | File | Line | Status |
|---|---|---|---|---|
| L-01 | Plain-text NestJS logger — no structured JSON for CloudWatch Insights | `src/main.ts` | 15 | **OPEN** |
| L-02 | No `X-API-Deprecated`/`X-API-Sunset` header emission in code | `docs/api-versioning.md` | — | **OPEN** |
| L-03 | No Sigstore/cosign image signing | `.github/workflows/deploy.yml` | — | **OPEN** |
| L-04 | Dev master encryption key defaults to `'0'.repeat(64)` | `src/infrastructure/secrets/secrets.service.ts` | 186 | **OPEN (dev only)** |
| L-05 | No request timeout middleware — long-running requests can hold connections | `src/main.ts` | — | **OPEN** |
| L-06 | BullMQ worker in-process with API — worker crash can affect HTTP serving | `src/modules/submission/workers/submission.worker.ts` | 19 | **OPEN** |

---

## 4. Already Fixed — Evidence

| ID | Fix | File | Evidence |
|---|---|---|---|
| F-01 | API key format validation before bcrypt (prevents timing attacks on format) | `src/modules/identity/guards/api-key.guard.ts:39–42` | Regex check rejects malformed keys immediately |
| F-02 | API key expiry enforced at verification time | `src/modules/identity/services/api-key.service.ts:106` | `expiresAt: { gt: new Date() }` in WHERE clause |
| F-03 | AES-256-GCM with auth tag (authenticated encryption) | `src/modules/tenant/services/credential.service.ts:4` | `ALGORITHM = 'aes-256-gcm'`; auth tag verified on decrypt |
| F-04 | Per-tenant encryption key derivation | `src/modules/tenant/services/credential.service.ts:13–19` | `HMAC-SHA256(masterKey, tenantId)` — unique key per tenant |
| F-05 | SSRF protection on webhook URLs | `src/modules/webhook/services/webhook.service.ts:350–407` | HTTPS required, private IPs + metadata endpoint blocked |
| F-06 | Brute-force protection — account lockout | `src/modules/user/services/user.service.ts:154–169` | Redis lockout after 5 failures; fail-closed on Redis outage |
| F-07 | Graceful SIGTERM shutdown | `src/main.ts:89–100` | `app.close()` drains requests before exit |
| F-08 | Startup environment validation | `src/config/config.validation.ts` | Fails fast listing all missing vars |
| F-09 | HSTS + security headers | `src/main.ts:39–48` | Helmet with 1-year HSTS, preload, strict referrer policy |
| F-10 | Body size limits (10 MB) | `src/main.ts:51,53` | `express.json({ limit: '10mb' })` |
| F-11 | Automatic rollback on health check failure | `.github/workflows/deploy.yml:246–266` | Restores previous ECS task definition on 429/non-200 |
| F-12 | Sensitive field redaction in audit logs | `src/shared/utils/log-sanitizer.ts` | 16 sensitive keys recursively redacted |
| F-13 | Zero-downtime API key rotation | `src/modules/identity/services/api-key.service.ts:180–241` | 24-hour grace period; old key soft-expires |
| F-14 | API key usage tracking | `src/modules/identity/services/api-key.service.ts:320–334` | `requestCount` and `lastUsedIp` per key |
| F-15 | TOTP MFA for OWNER/ADMIN roles | `src/modules/user/services/mfa.service.ts` | RFC 6238 TOTP; secrets AES-256-GCM encrypted |
| F-16 | Idempotency protection on all mutating endpoints | `src/shared/interceptors/idempotency.interceptor.ts` | SHA-256 body hash; 24-hour replay cache |
| F-17 | PostgreSQL RLS tenant isolation | `src/infrastructure/database/prisma.service.ts:26–35` | `SET LOCAL app.current_tenant_id` per transaction |
| F-18 | Hash-chained audit log | `src/modules/activity/services/activity.service.ts` | SHA-256 chain with GENESIS anchor; tamper-detectable |
| F-19 | ALB trust-proxy (correct IP resolution) | `src/main.ts:20` | `trust proxy 1` — `req.ip` resolves through ALB correctly |
| F-20 | Rate-limit reset header | `src/shared/interceptors/tenant-rate-limit.interceptor.ts:47–52` | `X-RateLimit-Reset` epoch sent on every response |

---

## 5. Remaining Gaps — Prioritised Remediation

### Priority 1 — Fix before pen test (within 2 weeks)

**G-01: Add `npm audit` to CI pipeline**
```yaml
# .github/workflows/pr-checks.yml — add after lint job
- name: Dependency audit
  run: npm audit --audit-level=high
```
Time: 30 minutes.

**G-02: Add container image scanning to deploy pipeline**
```yaml
# .github/workflows/deploy.yml — add after Docker build, before ECR push
- name: Scan image for vulnerabilities
  uses: aquasecurity/trivy-action@0.28.0
  with:
    image-ref: ${{ env.IMAGE_URI }}:${{ env.IMAGE_TAG }}
    format: table
    severity: CRITICAL,HIGH
    exit-code: 1
```
Time: 1 hour.

**G-03: Enforce strict ValidationPipe**
```typescript
// src/main.ts:57–63 — change to:
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
}));
```
Requires: audit all `@Body()` usages and add class-validator DTOs.  
Time: 2–4 hours.

**G-04: Add outbound timeout on FIRS adapter HTTP calls**
```typescript
// src/modules/submission/adapters/interswitch/interswitch.adapter.ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);
try {
  const response = await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}
```
Time: 1 hour.

**G-05: Restrict admin endpoints to known IP ranges (ALB WAF rule)**
Add AWS WAF rule on ALB for `/v1/admin/*` paths allowing only L2A Solutions office IPs.  
Time: 2 hours (infrastructure change).

### Priority 2 — Fix before FIRS accreditation

**G-06: Enforce RS256-only JWT in production**
```typescript
// src/modules/identity/services/token.service.ts
if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must not be set in production — use Secrets Manager RS256 keys');
}
```
Time: 1 hour.

**G-07: Add request timeout middleware**
```typescript
// src/main.ts — add after body parsers
import timeout from 'connect-timeout';
app.use(timeout('30s'));
```
Time: 30 minutes.

**G-08: Structured JSON logging**
Replace NestJS default logger with `nestjs-pino` or `winston` for structured output, enabling CloudWatch Insights queries and log-based alerts.  
Time: 4 hours.

**G-09: Sliding-window rate limiting**
Replace fixed-window bucket in `src/shared/interceptors/tenant-rate-limit.interceptor.ts:41` with Redis sorted-set sliding window.  
Time: 2 hours.

---

*Next review: before pen test engagement commences.*
