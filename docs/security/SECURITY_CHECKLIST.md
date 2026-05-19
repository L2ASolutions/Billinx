# Billinx Security Checklists

**Version:** 1.0  
**Date:** 2026-05-18  
**Owner:** L2A Solutions Engineering

All items must be checked by an engineer and signed off by the Engineering Lead before the relevant milestone is approved. For each item: ✅ complete, ⚠️ partial (note required), ❌ not done.

---

## 1. Pre-Launch Security Checklist

Complete before the first production tenant is onboarded.

### Authentication & Access

- [ ] All production secrets stored in AWS Secrets Manager (not in `.env` or ECS task definition plaintext)
- [ ] `JWT_SECRET` env var absent from production ECS task definition — RS256 keys used instead
- [ ] Admin API key generated with `scripts/setup-aws.sh` and stored in Secrets Manager
- [ ] Master encryption key is a securely generated 64-character hex string (not all-zeros)
- [ ] All dev-only fallback secrets confirmed absent from production environment
- [ ] MFA enforcement verified for OWNER/ADMIN roles in production tenant
- [ ] First OWNER user account created with strong password + MFA enrolled
- [ ] No default/test API keys active in production

### Infrastructure

- [ ] ECS tasks running in private subnets (no public IP assigned)
- [ ] ALB security group allows only ports 80/443 from `0.0.0.0/0`
- [ ] ECS security group allows only port 3000 inbound from ALB security group
- [ ] RDS security group allows only port 5432 inbound from ECS security group
- [ ] ElastiCache security group allows only port 6379 inbound from ECS security group
- [ ] RDS `storage_encrypted = true` confirmed in Terraform state
- [ ] RDS automated backups enabled (minimum 7-day retention)
- [ ] HTTPS listener configured on ALB with valid ACM certificate
- [ ] HTTP→HTTPS redirect configured on ALB port 80 listener
- [ ] `ALLOWED_ORIGINS` env var set to production frontend domain only (not `*`)
- [ ] CloudWatch log groups created and retaining logs (minimum 90 days)
- [ ] CloudWatch alarms configured for ECS CPU, memory, and unhealthy tasks

### Application

- [ ] `NODE_ENV=production` set in ECS task definition
- [ ] Swagger/OpenAPI docs disabled (confirmed: `GET /docs` returns 404 in production)
- [ ] `GET /health` returns HTTP 200 with `status: "ok"`
- [ ] `validateEnvironment()` passes — no missing required vars logged on startup
- [ ] Helmet headers confirmed in responses: `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`
- [ ] CORS configured to production domain only
- [ ] Body size limit of 10 MB confirmed (test with large payload)
- [ ] Rate limiting active: test STANDARD tenant hits 429 after 100 requests/hour
- [ ] Auth lockout active: test 6 failed logins triggers lockout

### CI/CD

- [ ] `npm audit --audit-level=high` passes (zero high/critical CVEs)
- [ ] Trivy image scan passes (zero critical/high CVEs)
- [ ] All GitHub Actions secrets set: `AWS_ACCOUNT_ID`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `ECR_REPOSITORY`, `ECS_CLUSTER`, `ECS_SERVICE`, `ECS_TASK_DEFINITION`, `ECS_PRIVATE_SUBNETS`, `ECS_SECURITY_GROUP`, `ALB_DNS_NAME`
- [ ] Deploy workflow tested end-to-end on staging before production
- [ ] Rollback tested: intentionally broken image confirmed to roll back

### Data

- [ ] PostgreSQL RLS policies created and active on all tenant-scoped tables
- [ ] `app.current_tenant_id` RLS variable functioning (confirmed by cross-tenant query test)
- [ ] All pending Prisma migrations applied: `npx prisma migrate status` shows no pending migrations
- [ ] Audit log writing confirmed: `AuditLog` row present after test API call
- [ ] Hash chain seeded: first `ActivityEvent` per tenant uses `GENESIS` as `previousHash`

### Legal & Compliance

- [ ] Privacy policy published and URL referenced in registration flow
- [ ] NDPA consent recorded at registration (confirmed in `ConsentRecord` table)
- [ ] Data Processing Agreement (DPA) template prepared for tenant onboarding
- [ ] NITDA notification contact (`info@nitda.gov.ng`) saved in incident response contacts
- [ ] Data retention policy active: cron job confirmed running at 02:00 UTC

---

## 2. Pre-Pen-Test Checklist

Complete before commissioning an external penetration test.

### Internal Fixes

- [ ] `ValidationPipe` set to `whitelist: true, forbidNonWhitelisted: true` — unknown fields rejected
- [ ] `npm audit --audit-level=high` — zero high/critical dependency CVEs
- [ ] Trivy image scan — zero critical/high CVEs in deployed image
- [ ] Outbound HTTP timeout added to FIRS adapter (30-second `AbortController`)
- [ ] Admin endpoints restricted at WAF to L2A Solutions office IP ranges
- [ ] JWT algorithm confirmed RS256 in production (verify `JWT_SECRET` absent from production)

### Pen-Test Environment

- [ ] Dedicated pen-test ECS cluster provisioned (separate from production and sandbox)
- [ ] Pen-test RDS instance created with synthetic data only (zero production PII)
- [ ] Pen-test Redis instance provisioned
- [ ] Pen-test Secrets Manager secrets created with pen-test values
- [ ] Pen-test ALB deployed with dedicated DNS (e.g. `pentest.billinx.ng`)
- [ ] WAF configured to allowlist only the pen-test firm's IP ranges for pen-test environment
- [ ] Production environment confirmed unreachable from pen-test firm IPs
- [ ] CloudWatch logging enabled on pen-test environment (for incident correlation during test)

### Test Data

- [ ] Minimum 2 tenant accounts created with synthetic data
- [ ] Each tenant has: at least 5 invoices (ACCEPTED, REJECTED, DRAFT states), 2 API keys, 1 webhook subscription
- [ ] Admin user created for pen-test monitoring (separate from production admin)
- [ ] No real TINs, real names, or real financial data in pen-test environment

### Scope Document (give to pen-test firm)

- [ ] Written scope document listing: in-scope URLs, out-of-scope (production), allowed techniques, prohibited techniques (e.g. DoS)
- [ ] Rules of engagement signed by both parties
- [ ] Emergency contact for L2A Solutions during the test (phone number, not just email)
- [ ] Agreed test window (dates and hours)
- [ ] Agreed disclosure timeline for findings

### Documentation Handed to Pen-Test Firm

- [ ] API documentation (Swagger export or `/docs` URL)
- [ ] Architecture diagram (component-level, no source code)
- [ ] This security audit report
- [ ] Pen-test environment credentials (NOT production credentials)
- [ ] Incident response contact (in case they find a critical issue)

### Post-Test

- [ ] Pen-test report received and reviewed
- [ ] All Critical findings remediated before any other milestone
- [ ] All High findings remediated or formally risk-accepted before accreditation
- [ ] Pen-test environment torn down after assessment complete
- [ ] Pen-test report stored securely (not in public GitHub)

---

## 3. Pre-Accreditation Checklist

Complete before submitting for FIRS System Integrator accreditation.

### Technical Readiness

- [ ] All Pre-Launch items ✅
- [ ] Penetration test completed with clean report (Critical + High findings resolved)
- [ ] `npm audit` and Trivy scan in CI pipeline and passing
- [ ] `ValidationPipe` enforcing strict mode
- [ ] Structured logging implemented (JSON output to CloudWatch)
- [ ] Request timeout middleware in place (30-second limit)
- [ ] Admin endpoints IP-restricted at WAF

### FIRS-Specific

- [ ] Interswitch production credentials provisioned and stored in Secrets Manager
- [ ] Interswitch production URL (`INTERSWITCH_PROD_URL`) configured
- [ ] NRS API base URL (`NRS_API_BASE_URL`) confirmed for production
- [ ] End-to-end FIRS submission tested in NRS sandbox with real UBL XML
- [ ] IRN format validated against FIRS specification
- [ ] QR code verified scannable and correctly formatted
- [ ] Credit note referencing original IRN flow tested
- [ ] Bulk submission tested with 100+ invoices in sandbox

### Documentation Package

- [ ] System architecture diagram (data flow, component diagram) — current
- [ ] API documentation — complete and up to date
- [ ] Security audit report — dated within 12 months
- [ ] Penetration test report — dated within 12 months, all Critical/High resolved
- [ ] Data flow diagram — showing PII path from registration through NRS submission and erasure
- [ ] Risk register — listing identified risks with controls and residual risk
- [ ] Incident response plan — reviewed and tested
- [ ] Data retention policy — documented and active
- [ ] Business continuity / disaster recovery plan — documented
- [ ] Change management procedure — documented

### Compliance

- [ ] NDPA 2023 consent recording confirmed in production
- [ ] Right to erasure flow tested end-to-end
- [ ] Data retention cron job confirmed running
- [ ] Breach notification procedure rehearsed (tabletop exercise)
- [ ] DPA with NITDA filed (if required as a Data Processor)
- [ ] Privacy policy published and accessible

### Infrastructure Evidence

- [ ] Terraform state showing encrypted RDS, private subnets, WAF rules
- [ ] CloudWatch alarm evidence (screenshots or export)
- [ ] CloudTrail enabled and retaining logs
- [ ] AWS Config rules passing (if configured)
- [ ] ECR image scan results (clean)

### Operational Readiness

- [ ] Runbook for common operations (migration, scale, rollback) — up to date
- [ ] On-call rotation documented
- [ ] Monitoring dashboards accessible to on-call engineers
- [ ] RTO/RPO validated by disaster recovery test

---

## 4. Monthly Security Review Checklist

Run on the first Monday of each month.

### Dependencies

- [ ] Run `npm audit --audit-level=moderate` — review and triage any new findings
- [ ] Check Node.js LTS releases — update if current version EOL within 3 months
- [ ] Review Dependabot alerts (or manually check `npm outdated`)
- [ ] Pull latest base Docker image and run Trivy — redeploy if new CVEs found

### Secrets and Credentials

- [ ] Confirm no API keys in `api_keys` table are past their `expiresAt` date without rotation
- [ ] Review `api_keys.lastUsedAt` — flag any keys unused >90 days for review by tenant
- [ ] Confirm `billinx/production/encryption-key` rotation is not overdue (rotate every 12 months)
- [ ] Confirm `billinx/production/admin-api-key` rotation is not overdue (rotate every 90 days)
- [ ] Review admin user list — confirm only active L2A staff have admin access
- [ ] GitHub Actions secrets — confirm no stale or overprivileged secrets

### Access Review

- [ ] Review AWS IAM: confirm ECS task role has no excess permissions beyond Secrets Manager and ECR
- [ ] Review GitHub repository access — confirm only active contributors have write access
- [ ] Review ECS service: confirm task count and CPU/memory are expected
- [ ] Confirm no unexpected security group rule changes (compare to Terraform state)

### Monitoring

- [ ] Review CloudWatch alarm history — any alarms fired? Were they investigated?
- [ ] Review `SystemError` table for unresolved HIGH severity errors this month
- [ ] Review `AuditLog` for anomalies: unusual IPs, unusual endpoints, unusual hours
- [ ] Review failed login rate: `SELECT COUNT(*) FROM activity_events WHERE event_type = 'USER_LOGIN_FAILED' AND occurred_at > NOW() - INTERVAL '30 days'`
- [ ] Confirm Sentry has no unresolved critical exceptions

### Backup and Recovery

- [ ] Confirm RDS automated backup is succeeding (check backup window in AWS console)
- [ ] Confirm ElastiCache is not retaining stale job data (Redis memory < 70%)
- [ ] Verify `prisma migrate status` — no pending migrations drifting out of sync

### Compliance

- [ ] Review `ErasureRequest` table — any pending requests older than 30 days?
- [ ] Review `ConsentRecord` — consent version still current (update if privacy policy changed)
- [ ] Confirm data retention cron ran successfully this month (check CloudWatch logs for `RetentionService`)
- [ ] Confirm audit hash chain is intact: `GET /v1/admin/audit/verify` → `valid: true`

### Documentation

- [ ] This checklist is up to date with current architecture
- [ ] Incident response plan reflects current contacts and procedures
- [ ] Security audit report is not older than 12 months (schedule new audit if needed)
- [ ] Any findings from last month's checklist have been actioned

---

*Sign-off: Engineering Lead _________________ Date: _________________*
