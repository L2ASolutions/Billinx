# Billinx FIRS Accreditation Readiness Report

**Date:** 2026-05-18  
**Standard:** FIRS NRS System Integrator Accreditation Requirements  
**Stack:** NestJS + PostgreSQL + Redis + BullMQ + Docker + ECS Fargate + AWS (af-south-1)  
**Accreditation Readiness Score: 74 / 100**

---

## 1. Executive Summary

Billinx is a **System Integrator (SI)** platform connecting Nigerian businesses to the FIRS National Revenue Service (NRS) e-invoicing system via the Interswitch adapter. The platform has a solid technical foundation with enterprise-grade security controls. The main gaps before accreditation are: (1) no image vulnerability scanning, (2) permissive input validation, (3) incomplete documentation package, and (4) no formal penetration test report.

**Recommendation:** Billinx is **not yet ready for black-box pen test** but will be after completing the 5 critical pre-pen-test fixes (estimated 1 week of engineering effort). Accreditation can be pursued 2–4 weeks after a clean pen test report.

---

## 2. FIRS System Integrator Accreditation Checklist

### Category A — Technical Integration Requirements

| Req | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| A-01 | IRN generation per FIRS specification | ✅ BUILT | `src/modules/invoice/services/irn.service.ts` — generates platform IRN | — |
| A-02 | UBL 2.1 / XML invoice format support | ✅ BUILT | `src/modules/invoice/services/xml-invoice.builder.ts` | — |
| A-03 | Invoice validation before FIRS submission | ✅ BUILT | `src/modules/invoice/services/invoice.service.ts:208–284` — TIN, HSN, party, amount validation | — |
| A-04 | Async submission pipeline with retry | ✅ BUILT | BullMQ queue; 3 attempts; exponential backoff 5s→25s→125s | — |
| A-05 | FIRS response handling (accept/reject) | ✅ BUILT | `src/modules/submission/services/submission.service.ts:223–295` | — |
| A-06 | Confirmed IRN storage (`firsConfirmedIrn`) | ✅ BUILT | `prisma/schema.prisma` Invoice model; set on ACCEPTED status | — |
| A-07 | QR code generation and storage | ✅ BUILT | `qrCodeBase64` stored on Invoice; set on acceptance | — |
| A-08 | Credit/debit note referencing original IRN | ✅ BUILT | `src/modules/invoice/services/invoice.service.ts:59–67` — enforced | — |
| A-09 | Multi-invoice type support (Standard, Credit, Debit, Proforma) | ✅ BUILT | `InvoiceType` enum; `InvoiceKind` enum (B2B, B2C, B2G) | — |
| A-10 | Sandbox and Production environment separation | ✅ BUILT | `TenantEnvironment` enum; `blx_live_` vs `blx_test_` key prefixes | — |
| A-11 | Idempotent resubmission handling | ✅ BUILT | `IdempotencyRecord` table; SHA-256 body hash; 24h replay | — |
| A-12 | Bulk/batch invoice submission (enterprise tenants) | ✅ BUILT | `POST /v1/invoices/bulk` (500 max), CSV upload | — |

### Category B — Security Requirements

| Req | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| B-01 | All API communication over TLS 1.2+ | ✅ BUILT | ALB HTTPS listener; HSTS header set | — |
| B-02 | API key authentication | ✅ BUILT | bcrypt-12 hashed; 384-bit CSPRNG; prefix-indexed | — |
| B-03 | API key rotation capability | ✅ BUILT | `POST /v1/api-keys/:keyId/rotate` — 24h grace period | — |
| B-04 | Secrets not in source code or env files | ✅ BUILT | AWS Secrets Manager for all production secrets | — |
| B-05 | Data encryption at rest | ✅ BUILT | RDS encrypted (`storage_encrypted = true`); AES-256-GCM for credentials | — |
| B-06 | Data encryption in transit | ✅ BUILT | TLS at ALB; TLS for Redis (`rediss://`); TLS for RDS | — |
| B-07 | Multi-factor authentication for admin access | ✅ BUILT | TOTP MFA required for OWNER/ADMIN roles; backup codes | — |
| B-08 | Brute-force protection on authentication | ✅ BUILT | 5 failures → 15-min lockout; IP-based rate limiting | — |
| B-09 | Role-based access control | ✅ BUILT | 5 roles (OWNER/ADMIN/ACCOUNTANT/VIEWER/API_MANAGER) | — |
| B-10 | Audit logging of all operations | ✅ BUILT | `AuditLog` table; hash-chained `ActivityEvent` | — |
| B-11 | Input validation | ⚠️ PARTIAL | ValidationPipe present but `whitelist: false` — unknown fields not rejected | Fix M-01 |
| B-12 | Vulnerability scanning in CI/CD | ❌ MISSING | No `npm audit` or image scan in pipeline | Fix H-01, H-02 |
| B-13 | Penetration test with clean report | ❌ MISSING | Not yet conducted | Required |
| B-14 | SSRF protection | ✅ BUILT | Webhook URL validation; private IPs blocked | — |
| B-15 | Injection protection (SQL, command) | ✅ BUILT | Prisma ORM; tagged template literals for raw SQL | — |

### Category C — Multi-Tenancy and Data Isolation

| Req | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| C-01 | Complete data isolation between tenants | ✅ BUILT | PostgreSQL RLS + application-level `WHERE tenantId` | — |
| C-02 | Tenant-scoped API keys | ✅ BUILT | `ApiKey.tenantId` FK; verified in every request | — |
| C-03 | Tenant-specific credentials encrypted separately | ✅ BUILT | Per-tenant AES-256-GCM key derivation | — |
| C-04 | Admin bypass clearly gated | ✅ BUILT | `prisma.asAdmin()` is explicit; `SET LOCAL row_security = OFF` | — |

### Category D — Availability and Reliability

| Req | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| D-01 | Health check endpoint | ✅ BUILT | `GET /health` — DB latency, Redis latency, queue depth, uptime | — |
| D-02 | Graceful shutdown | ✅ BUILT | SIGTERM handler; `app.close()` drains requests | — |
| D-03 | Dead-letter handling for failed submissions | ✅ BUILT | `DEAD_LETTERED` status after 3 failures; admin retry available | — |
| D-04 | Deployment rollback capability | ✅ BUILT | Auto-rollback in `deploy.yml` on health check failure | — |
| D-05 | Database backup | ⚠️ PARTIAL | RDS automated backups (AWS default); no pre-migration snapshot in CI | Recommended |
| D-06 | High availability infrastructure | ✅ BUILT | Multi-AZ RDS; ECS Fargate in private subnets; ALB | — |

### Category E — Compliance and Privacy (NDPA 2023)

| Req | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| E-01 | Consent recording | ✅ BUILT | `ConsentRecord` model; 3 consent types; IP + user-agent stored | — |
| E-02 | Right to erasure | ✅ BUILT | `ErasureRequest` model; user anonymisation (name → "Anonymized", email → hash) | — |
| E-03 | Data retention policy | ✅ BUILT | 7-year invoice archive; 2-year activity event archive via daily cron | — |
| E-04 | Breach notification procedure | ❌ MISSING | No documented procedure | See INCIDENT_RESPONSE_PLAN.md |
| E-05 | Privacy policy linkage | ⚠️ PARTIAL | Consent types defined; no static privacy policy URL confirmed in app | — |

### Category F — Documentation Requirements

| Req | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| F-01 | System architecture diagram | ✅ BUILT | `CLAUDE.md` architecture section | — |
| F-02 | API documentation | ✅ BUILT | Swagger at `/docs`; Postman collection in `docs/` | — |
| F-03 | Deployment runbook | ✅ BUILT | `docs/deployment.md` | — |
| F-04 | Security policy | ⚠️ PARTIAL | `docs/security/SECURITY_AUDIT_REPORT.md` (this audit) | Formalise |
| F-05 | Incident response plan | ⚠️ PARTIAL | See `docs/security/INCIDENT_RESPONSE_PLAN.md` | Formalise |
| F-06 | Data flow diagram (showing PII flow) | ❌ MISSING | Not produced | Produce before accreditation |
| F-07 | Risk register | ❌ MISSING | Not produced | Produce before accreditation |
| F-08 | Change management procedure | ❌ MISSING | CI/CD pipeline exists; no written policy | Document |

---

## 3. Accreditation Readiness Score Breakdown

| Category | Max | Score | Notes |
|---|---|---|---|
| A — Technical Integration | 25 | 25 | All 12 requirements met |
| B — Security | 30 | 19 | Missing pen test, image scan, strict validation |
| C — Multi-Tenancy | 15 | 15 | Full tenant isolation |
| D — Availability | 10 | 8 | Missing pre-migration snapshot |
| E — Privacy/NDPA | 10 | 7 | Missing breach notification procedure |
| F — Documentation | 10 | 4 | Missing data flow diagram, risk register, change management |
| **Total** | **100** | **74** | |

---

## 4. Top 5 Critical Fixes Before Pen Test

These must be completed before commissioning an external penetration test. The pen test firm must not be able to identify obvious low-hanging fruit that would dominate the report and obscure deeper findings.

1. **[H-01] Add container image vulnerability scan** — Add Trivy to `deploy.yml` before ECR push. Ensures the image being tested is clean.
2. **[H-02] Add `npm audit` to PR checks** — Blocks PRs with high-severity dependency CVEs.
3. **[M-01] Enforce strict ValidationPipe** — `whitelist: true, forbidNonWhitelisted: true`. Without this, a pen tester will flag parameter injection as a finding.
4. **[G-05] Admin endpoint IP restriction** — Apply AWS WAF IP allowlist to `/v1/admin/*`. Admin endpoints should not be reachable from arbitrary pen test IPs.
5. **[M-04] Outbound timeout on FIRS adapter** — An explicit 30-second `AbortController` timeout prevents slow-response attacks in the test environment.

---

## 5. Top 5 Critical Fixes Before Accreditation

Beyond pen test readiness, these are required for FIRS submission:

1. **[B-13] Penetration test with clean report** — FIRS requires a third-party pen test report dated within 12 months. Conduct after fixing pen-test prerequisites above.
2. **[B-12] Vulnerability scanning in CI/CD** — Both `npm audit` and Trivy must be part of the standard pipeline, not one-off checks.
3. **[F-06] Data flow diagram** — Must show every path PII takes through the system: registration → storage → NRS transmission → erasure. Required for NDPA compliance review.
4. **[F-07] Risk register** — Formal document listing identified risks, likelihood, impact, and controls. FIRS accreditation review will request this.
5. **[E-04] Breach notification procedure** — NDPA 2023 requires notification to NITDA within 72 hours of discovering a personal data breach. Must be documented, rehearsed, and accessible to all staff.

---

## 6. IP Protection Strategy for External Assessors

### What assessors CAN see

| Asset | Justification |
|---|---|
| Deployed pen test environment URL (HTTPS) | Required for black-box testing |
| API documentation (Swagger at `/docs`) | Required; confirms the attack surface |
| This security audit report | Shows controls in place; accelerates assessment |
| Incident response plan | Shows response capability |
| Architecture diagram (component level) | Required for grey-box; omit internal implementation detail |
| `infra/` Terraform at module level (no values) | Shows AWS topology without credentials |

### What assessors CANNOT see

| Asset | Justification |
|---|---|
| Application source code | Contains business logic and full implementation detail |
| `.github/workflows/` | Reveals CI/CD credential structure |
| `prisma/schema.prisma` in full | Reveals every data model and relationship |
| AWS credentials, account IDs, secret ARNs | Obvious |
| Interswitch/NRS API credentials | Third-party credentials |
| Production database | Out of scope; use staging/pen-test DB only |
| L2A Solutions' internal admin keys | Never shared |

### IP protection implementation

```
Environment: Dedicated pen-test ECS deployment in af-south-1
             Separate RDS instance (synthetic/seeded data only — no production PII)
             Separate Redis instance
             Separate Secrets Manager secrets (pen-test values)
             Separate ALB with pen-test DNS (e.g. pentest.billinx.ng)
             
Access:      Assessors given: pen-test API keys (blx_test_ prefix)
                               pen-test tenant account credentials
                               NO shell/EC2/ECS access
                               NO RDS direct access
                               NO AWS console access

Monitoring:  CloudWatch Logs streaming during test for anomaly detection
             Assessor IP ranges allowlisted at ALB WAF
             Any attempt to reach production environment treated as out-of-scope
```

---

## 7. Black-Box vs Grey-Box Testing Recommendation

### Recommendation: **Grey-Box**

| Factor | Black-Box | Grey-Box |
|---|---|---|
| Source code shared | No | No (see IP protection above) |
| Architecture diagram | No | Yes (component-level) |
| API documentation | Partial (discoverable) | Full Swagger export |
| Auth credentials | Discovered | Provided (1 tenant account) |
| Time to useful findings | 3–5 days overhead | Day 1 |
| Cost | Higher (slower) | Lower (focused) |
| FIRS acceptance | ✅ Accepted | ✅ Accepted |
| Coverage quality | Risk of time wasted on discovery | Deeper logic/business-flow testing |

**Rationale:** Grey-box is preferred because:
1. The API surface is well-documented (Swagger). A black-box tester will spend 30–40% of their time re-discovering what the Swagger already describes.
2. Providing architecture context (not source code) allows the pen tester to focus on multi-tenancy bypass, IDOR, business logic flaws, and auth chain weaknesses — the real risks for a compliance API.
3. FIRS and NDPA do not mandate a specific mode; grey-box is industry standard for SaaS API assessments.
4. Source code remains private throughout; no NDA violation.

### Environments needed for accreditation

| Environment | Purpose | Data |
|---|---|---|
| **Production** | Live FIRS submissions from real tenants | Real PII — never used for testing |
| **Sandbox** | Tenant integration testing | Synthetic invoices; `blx_test_` keys; Interswitch sandbox URL |
| **Pen-test** | External security assessment | Seeded synthetic data; isolated RDS; no production secrets |

The pen-test environment is a one-time deployment cloned from Terraform (`terraform workspace new pentest`). It is destroyed after the assessment.

---

## 8. Is Billinx Ready for Black-Box Pen Test Now?

**No — not yet. Estimated: ready in 1 week.**

| Check | Status |
|---|---|
| 5 pre-pen-test fixes complete | ❌ Not yet |
| Pen-test environment provisioned | ❌ Not yet |
| Synthetic test data seeded | ❌ Not yet |
| Admin endpoints IP-restricted | ❌ Not yet |
| Scope document written for assessor | ❌ Not yet |
| Container image clean (Trivy) | ❌ Not verified |
| `npm audit` clean (high severity) | ❌ Not run |
| All FIRS adapters operational in sandbox | ✅ Interswitch sandbox configured |
| Auth chain end-to-end working | ✅ MFA, API keys, JWT all functional |
| Health check returns 200 | ✅ Deployed and verified |

**After completing the 5 pre-pen-test fixes and provisioning the pen-test environment, Billinx will be ready for a grey-box pen test.**

---

*This report should be shared with FIRS accreditation reviewers as part of the technical submission package.*
