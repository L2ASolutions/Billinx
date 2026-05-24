# Billinx Security Incident Response Plan

**Version:** 1.0  
**Effective Date:** 2026-05-18  
**Owner:** L2A Solutions Engineering  
**Review Cycle:** Quarterly

---

## 1. Purpose and Scope

This plan governs how L2A Solutions responds to security incidents affecting the Billinx platform and its tenants. It covers all components: NestJS API, PostgreSQL, Redis, BullMQ, Docker containers, ECS Fargate, AWS infrastructure, and tenant data.

**This plan is mandatory reading for:** all engineers with production access, the CTO, and any on-call engineer.

---

## 2. Incident Classification

### Severity Levels

| Level | Name | Definition | Response SLA |
|---|---|---|---|
| **P0** | Critical | Active breach; data exfiltration; service fully down; FIRS submission pipeline stopped | 15 minutes |
| **P1** | High | Auth bypass; privilege escalation; tenant data exposure confirmed; ransom/extortion | 1 hour |
| **P2** | Medium | Failed attack attempt; suspected breach under investigation; partial service degradation | 4 hours |
| **P3** | Low | Security misconfiguration found internally; failed login storm; single-tenant anomaly | 24 hours |
| **P4** | Info | Security tooling alert; dependency CVE; config drift detected | 72 hours |

### Incident Type Classification

| Type | Examples |
|---|---|
| **Data Breach** | Unauthorised access to tenant invoice data, PII, or credentials |
| **Auth Compromise** | API key exfiltration, admin key leak, JWT forgery |
| **API Attack** | DDoS, BOLA/IDOR exploitation, injection attack |
| **Infrastructure** | ECS task compromise, RDS access anomaly, S3/ECR misconfiguration |
| **Supply Chain** | Malicious npm package, compromised Docker base image |
| **FIRS Pipeline** | Fraudulent invoice submission, IRN manipulation, NRS callback spoofing |
| **Availability** | Full service outage, database connection exhaustion, Redis failure |

---

## 3. Response Procedures by Incident Type

### 3.1 Data Breach (P0/P1)

**Indicators:** Unusual data export volume in CloudWatch logs; `ActivityEvent` chain broken; unexpected `AuditLog` entries from unknown IPs; tenant reports data they did not submit.

**Steps:**

1. **Contain (0–15 min)**
   - Identify the affected tenant(s) from `AuditLog` table: query by `ipAddress` or `actor`
   - Revoke all API keys for affected tenant(s): `UPDATE api_keys SET "isRevoked" = TRUE WHERE "tenantId" = '<id>'`
   - If admin credentials suspected: rotate `billinx/production/admin-api-key` in Secrets Manager immediately
   - If master key suspected: rotate `billinx/production/encryption-key` and re-encrypt all tenant credentials
   - Force-terminate suspicious ECS tasks if needed: `aws ecs stop-task --cluster billinx-production --task <arn>`

2. **Investigate (15–60 min)**
   - Pull CloudWatch logs for the affected time window: `aws logs filter-log-events --log-group-name /ecs/billinx-production`
   - Query `AuditLog` for the incident window:
     ```sql
     SELECT * FROM audit_logs WHERE ip_address = '<suspect_ip>'
     AND created_at BETWEEN '<start>' AND '<end>'
     ORDER BY created_at;
     ```
   - Verify hash chain integrity: `GET /v1/admin/audit/verify`
   - Check `SystemError` table for unhandled exceptions coinciding with incident
   - Determine scope: which tenants, which data, which endpoints, what volume

3. **Notify (within 1 hour of confirmation)**
   - Notify NITDA per NDPA 2023 breach notification requirement (within 72 hours of discovery)
   - Notify affected tenants directly (see Section 6 — Communication Templates)
   - If FIRS invoice data involved: notify FIRS NRS operations contact

4. **Remediate**
   - Patch the exploited vulnerability
   - Rotate all secrets regardless of confirmed scope
   - Deploy patched image via CI/CD pipeline
   - Verify clean deployment via health check

5. **Review (within 48 hours)**
   - Write incident post-mortem (what happened, timeline, root cause, fix, prevention)
   - Update this incident response plan if gaps found
   - Review affected tenant SLAs

---

### 3.2 API Key or Auth Credential Compromise (P1)

**Indicators:** API key used from unusual geography; abnormal request volume from one key; key owner reports they did not make requests; `lastUsedIp` in `api_keys` table shows unknown IP.

**Steps:**

1. **Immediate containment**
   - Revoke specific compromised key: `POST /v1/api-keys/:keyId` with `isRevoked: true` via admin API, or directly: `UPDATE api_keys SET "isRevoked" = TRUE WHERE id = '<keyId>'`
   - Issue new key for the tenant: `POST /v1/api-keys`
   - If JWT secret suspected: rotate `JWT_PRIVATE_KEY_SECRET_ID` in Secrets Manager; all existing tokens immediately invalid after 5-minute cache TTL

2. **Investigate**
   - Query all requests from compromised key in `AuditLog` for the past 30 days
   - Check what endpoints were called and what data was accessed or modified
   - Review `InvoiceStateHistory` for any fraudulent FIRS submissions

3. **Notify**
   - Inform affected tenant of the key compromise and actions taken
   - If fraudulent invoices were submitted to FIRS: contact NRS to flag IRNs for review

4. **Harden**
   - Review how key was exposed (leaked in logs, committed to repo, phished)
   - Confirm `sanitize()` in `src/shared/utils/log-sanitizer.ts` redacts key patterns in audit logs
   - Add `npm audit` and secret scanning (GitHub secret scanning) if not present

---

### 3.3 DDoS / API Abuse (P2)

**Indicators:** 429 rate limit responses spiking in CloudWatch; `X-RateLimit-Remaining` hitting 0 for multiple tenants; ECS CPU/memory alarm firing; ALB request count anomaly.

**Steps:**

1. **Immediate**
   - Identify abusing IP(s) from ALB access logs: `aws logs filter-log-events --log-group-name /aws/elasticloadbalancing/...`
   - Block at WAF level: `aws wafv2 update-ip-set --scope REGIONAL ...` (add to deny list)
   - If a specific tenant is being abused: temporarily reduce their rate limit tier in the database

2. **Mitigate**
   - Scale ECS service if legitimate traffic is overwhelming: `aws ecs update-service --desired-count <n>`
   - Confirm ALB auto-scaling is working; Redis is not overloaded (check ElastiCache metrics)

3. **Post-incident**
   - Add permanent WAF rules for observed attack patterns
   - Consider enabling AWS Shield Standard (already included in ALB pricing)
   - Review fixed-window rate limiting gap (see SECURITY_AUDIT_REPORT.md M-03)

---

### 3.4 Infrastructure Compromise (P0)

**Indicators:** Unauthorised IAM activity in CloudTrail; unknown ECS tasks running; unexpected S3/ECR access; SSH/SSM session from unknown principal.

**Steps:**

1. **Isolate**
   - Remove inbound rules from ECS security group: `aws ec2 revoke-security-group-ingress ...`
   - Stop all running ECS tasks: `aws ecs update-service --desired-count 0`
   - Take RDS snapshot immediately before any changes: `aws rds create-db-snapshot --db-instance-identifier billinx-production --db-snapshot-identifier incident-$(date +%Y%m%d%H%M%S)`

2. **Investigate**
   - Review CloudTrail: `aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventSource,AttributeValue=ecs.amazonaws.com`
   - Identify compromised IAM role or access key
   - Check ECR for any new or modified images

3. **Contain and Recover**
   - Rotate all IAM access keys associated with CI/CD and ECS task roles
   - Rebuild ECS task definition from source (Terraform apply)
   - Re-pull clean image from ECR (verified via Trivy scan) and redeploy
   - Restore RDS from last clean snapshot if database integrity is uncertain

---

### 3.5 FIRS Pipeline Integrity (P1)

**Indicators:** IRNs submitted to NRS that were not initiated by a legitimate tenant; unexpected callbacks from NRS; `SubmissionAttempt` records with `responseCode` not matching expected NRS responses.

**Steps:**

1. **Halt the pipeline**
   - Scale BullMQ workers to 0: `aws ecs update-service --cluster billinx-production --service billinx-worker --desired-count 0`
   - This stops all pending submissions without losing queued jobs (BullMQ persists in Redis)

2. **Investigate**
   - Identify affected IRNs from `SubmissionAttempt` table
   - Verify `InvoiceStateHistory` chain for each suspicious invoice
   - Contact Interswitch/NRS operations to flag potentially fraudulent IRNs

3. **Recover**
   - Remediate the vulnerability
   - Resume worker: scale back to 1+
   - Coordinate with FIRS to void any fraudulent submissions

---

## 4. Contact List and Escalation Path

```
PRIMARY ON-CALL
  Role:  Engineering Lead
  When:  First contact for any P0/P1 incident
  How:   Phone (always) + Slack #incidents

ESCALATION 1 — CTO
  When:  P0, or P1 unresolved after 1 hour
  How:   Phone

ESCALATION 2 — CEO / Legal
  When:  Data breach confirmed (NDPA notification required)
         FIRS notified of fraudulent submissions
         Press inquiry received
  How:   Phone

EXTERNAL CONTACTS
  AWS Support:        support.console.aws.amazon.com (Business Support plan)
  Interswitch NRS:    [Interswitch technical support contact — fill before go-live]
  NITDA (breach):     info@nitda.gov.ng — breach notification authority
  FIRS IT:            [FIRS NRS operations contact — obtain from accreditation team]
  Pen Test Firm:      [fill when contracted]
  Legal Counsel:      [fill before go-live]
```

---

## 5. Data Breach Notification Procedure (NDPA 2023)

### Legal Obligation

Under the Nigeria Data Protection Act 2023 (NDPA) and the NDPR 2019, L2A Solutions (as a Data Processor) must:
1. Notify the **Data Controller** (the affected tenant) **without undue delay** upon discovering a breach
2. Notify **NITDA** within **72 hours** of becoming aware of the breach
3. Maintain records of all breaches, even those not requiring notification

### Notification Threshold

Notification is required if the breach is likely to result in:
- Risk to rights and freedoms of natural persons
- Identity theft or fraud
- Financial loss to affected individuals
- Reputational damage
- Unauthorised disclosure of health, financial, or location data

Invoice data (which contains business financial information) triggers this threshold.

### 72-Hour Notification Timeline

| Hour | Action |
|---|---|
| 0 | Breach detected and confirmed |
| 1 | Incident declared P0/P1; containment started |
| 4 | Scope determined (which tenants, what data, volume) |
| 8 | Affected tenants notified (see Template B-01) |
| 24 | NITDA notification filed (see Template B-02) |
| 48 | Full incident report drafted |
| 72 | NITDA notified (hard deadline) |

### NITDA Notification Content (Required Fields)

1. Nature of the personal data breach
2. Categories and approximate number of data subjects affected
3. Categories and approximate number of personal data records affected
4. Name and contact details of the Data Protection Officer
5. Likely consequences of the breach
6. Measures taken or proposed to address the breach

---

## 6. Communication Templates

### Template B-01 — Tenant Notification (Data Breach)

```
Subject: Important Security Notice — Your Billinx Account

Dear [Tenant Name],

We are writing to inform you of a security incident that may have affected 
data associated with your Billinx account.

What happened:
[Brief description — e.g., "On [date], we identified unauthorised access to 
invoice records associated with your account."]

What data was involved:
[Specific data types — e.g., invoice metadata, buyer/seller information]

What we have done:
- Immediately revoked all affected API keys
- Contained the incident and blocked the attack vector
- Notified NITDA per NDPA 2023 requirements
- [Additional specific actions taken]

What you should do:
1. Generate new API keys from your Billinx dashboard
2. Review your invoice submissions for the period [date range]
3. Report any suspicious activity to security@billinx.ng

We sincerely apologise for this incident. We are committed to the security 
of your data and are taking every step to prevent recurrence.

Contact: security@billinx.ng | +234 [phone]

L2A Solutions Engineering Team
```

### Template B-02 — NITDA Notification

```
To: info@nitda.gov.ng
Subject: Personal Data Breach Notification — Billinx (L2A Solutions)

Data Controller/Processor: L2A Solutions Ltd
Platform: Billinx (billinx.ng) — FIRS e-invoicing compliance API
Date of notification: [date]
Date breach detected: [date]
Date breach occurred (estimated): [date]

1. Nature of the breach:
[e.g., Unauthorised API access resulting in exposure of invoice records]

2. Categories of data affected:
[e.g., Business identity data (TIN, company name), invoice financial data, 
contact information]

3. Number of data subjects affected (approximate):
[number] tenant businesses; [number] individual users

4. Number of records affected (approximate):
[number] invoice records; [number] user records

5. Data Protection Officer:
Name: [name]
Email: [dpo email]
Phone: [phone]

6. Likely consequences:
[e.g., Potential exposure of financial transaction data; risk of identity 
fraud for affected businesses]

7. Measures taken:
- Immediate revocation of compromised credentials
- System containment and patch deployment
- Affected tenants notified
- Root cause identified and remediated: [description]
- Enhanced monitoring deployed

8. Supporting documentation:
Available on request: incident timeline, affected system logs, remediation evidence.

Signed: [Name, Title]
Date: [date]
```

### Template B-03 — Internal Incident Declaration

```
INCIDENT DECLARED — [Severity Level]
Time: [timestamp UTC]
Declared by: [name]
Type: [incident type]
Summary: [1-2 sentences]
Affected systems: [list]
Incident channel: #incident-[date]
Incident commander: [name]
Next update: [time]
```

### Template B-04 — All-Clear Notification

```
Subject: Resolution Notice — Billinx Security Incident [date]

Dear [Tenant Name],

We are pleased to inform you that the security incident we notified you 
about on [date] has been fully resolved.

Summary of resolution:
- Incident contained: [date/time]
- Root cause: [brief description]
- Fix deployed: [date/time]
- Affected systems restored: [date/time]

Additional security improvements implemented:
[List of hardening steps taken]

No further action is required from you. Your account is secure.

If you have any questions, please contact security@billinx.ng.

L2A Solutions Engineering Team
```

---

## 7. Recovery Time Objectives

| System | RTO | RPO | Recovery Method |
|---|---|---|---|
| API (ECS) | 5 minutes | 0 (stateless) | ECS auto-restart; deploy new image |
| Database (RDS) | 30 minutes | 5 minutes (automated backups) | RDS point-in-time restore or Multi-AZ failover |
| Redis (ElastiCache) | 10 minutes | 0 (queue state in Redis, accept some job loss) | ElastiCache failover; BullMQ jobs re-queued |
| Full service (all components) | 60 minutes | 5 minutes | Terraform apply from scratch to new environment |
| FIRS pipeline restart | 15 minutes | 0 (BullMQ persists in Redis) | Scale worker ECS service back to desired count |

---

## 8. Post-Incident Review Checklist

After every P0 or P1 incident, complete within 48 hours:

- [ ] Incident timeline documented (minute-by-minute from detection to resolution)
- [ ] Root cause identified and described
- [ ] Attack vector patched and verified
- [ ] All affected secrets rotated
- [ ] NITDA notification filed (if breach)
- [ ] Tenant notifications sent (if breach)
- [ ] `AuditLog` and hash chain verified intact
- [ ] CloudWatch alarms reviewed — did they fire? Did they miss the incident?
- [ ] This incident response plan updated if gaps found
- [ ] Post-mortem document published internally
- [ ] Follow-up tickets created for systemic improvements

---

*This plan is a living document. Update after every incident and quarterly review.*
