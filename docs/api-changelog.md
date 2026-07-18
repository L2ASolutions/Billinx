# API Changelog & Versioning Policy

## Current Version: v1

All endpoints are prefixed with `/v1/` (e.g., `GET /v1/invoices`).

---

## Semantic Versioning Policy

Billinx API follows a path-based versioning strategy (`/v1/`, `/v2/`, etc.) aligned with semantic versioning principles.

### What Is a Breaking Change

A breaking change is any modification that requires existing integrations to update their code. The following are considered breaking changes:

- Removing an endpoint or HTTP method
- Renaming or removing a required request field
- Renaming or removing a response field that integrations depend on
- Changing the data type of an existing field (e.g., string → number)
- Changing authentication mechanisms
- Changing error response structure
- Removing or renaming an enum value
- Modifying idempotency behaviour

The following are **not** considered breaking changes:

- Adding new optional request fields
- Adding new response fields
- Adding new endpoints
- Adding new enum values (except when used in discriminated unions)
- Relaxing validation rules (e.g., making a required field optional)
- Performance improvements with identical functional behaviour

### Minor Changes (Non-Breaking)

Minor changes ship to the current version with no migration required. Integrations that do not use the new fields are unaffected.

### Patch Changes

Bug fixes, security patches, and documentation corrections. No API surface changes.

---

## Deprecation Process

### 90-Day Notice

Before removing or changing any feature, Billinx provides a minimum of **90 calendar days** notice via:

1. Email to all registered tenant OWNER users
2. A `Deprecation` response header on affected endpoints: `Deprecation: true` and `Sunset: <ISO date>`
3. An entry in this changelog

### Deprecation Header Example

When an endpoint or field is deprecated, responses will include:

```
Deprecation: true
Sunset: 2026-09-01T00:00:00Z
Link: <https://docs.billinx.ng/v2/invoices>; rel="successor-version"
```

### Deprecation Procedure

1. Announce deprecation with 90-day timeline (email + changelog)
2. Add deprecation headers to affected endpoints
3. Add warning to Swagger documentation
4. After sunset date, remove the feature in the next major version

---

## Accessing Older Versions

When v2 launches, v1 will remain available at `/v1/` for a transition period of **12 months** from the v2 GA date. After that period, v1 will reach end-of-life.

To pin your integration to a specific version:

```
GET /v1/invoices  (current)
GET /v2/invoices  (future)
```

Both versions run concurrently during the transition period.

---

## Planned v2 Timeline

v2 is not yet in active development. Planned improvements include:

- Bulk invoice submission (`POST /v2/invoices/batch`)
- Streaming invoice export (server-sent events)
- GraphQL query interface for invoice analytics
- Enhanced webhook filtering (field-level predicates)

No date has been set for v2 GA. When planning begins, a public roadmap will be shared with all tenant owners.

---

## v1 Release History

### v1.5.0 — July 2026
- Full Swagger/OpenAPI documentation across all endpoints: `@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth`/`@ApiSecurity`, and `@ApiProperty` on every DTO
- Swagger UI moved from `/docs` to `/api/docs`; raw OpenAPI JSON moved from `/openapi.json` to `/api/docs-json`
- Swagger UI/JSON is now live in every environment (previously disabled outside development) — in production both routes require a valid Bearer JWT
- No endpoint paths, methods, or business logic changed — documentation only

### v1.4.0 — May 2026
- Added product catalog (`/v1/products`)
- Added compliance export endpoints (`/v1/invoices/export/csv`, `/v1/invoices/export/json`, `/v1/invoices/export/monthly`)
- Added data retention archiving for invoices (7 years) and activity events (2 years)
- Added hash-chained immutable audit log for ActivityEvents
- Added enhanced health check with database/Redis latency metrics
- Added platform metrics endpoint (`/v1/admin/metrics`)
- Added queue monitoring endpoints (`/v1/admin/queue/status`, `/v1/admin/queue/retry-failed`)
- Added OpenAPI JSON export at `/openapi.json` (non-production only)

### v1.3.0 — May 2026
- Added KYB (Know Your Business) verification with CAC integration
- Added NDPA 2023 consent management and right-to-erasure
- Added MFA/TOTP support for OWNER and ADMIN roles
- Added XML invoice creation and export (`/v1/invoices/from-xml`, `Accept: application/xml`)
- Added webhook HMAC signing with delivery tracking

### v1.2.0 — May 2026
- Added Interswitch/NRS adapter for production FIRS submission
- Added submission queue (BullMQ) with retry logic and dead-letter handling
- Added `CREDIT_NOTE` and `DEBIT_NOTE` invoice types with `originalIrn` linkage
- Added CORS configuration and Sentry error tracking integration

### v1.1.0 — May 2026
- Added rate limiting tiers (STANDARD, PREMIUM, ENTERPRISE)
- Added idempotency interceptor (24-hour replay cache)
- Added audit log interceptor (all requests/responses)
- Added Redis-based login lockout (5 failures → 15-minute lockout)

### v1.0.0 — May 2026 (Initial Release)
- Multi-tenant provisioning with tenant-scoped resource isolation
- JWT + API key authentication
- Invoice CRUD with FIRS validation rules
- Invoice state machine with full history audit trail
- Webhook subscriptions with HMAC-signed delivery
- Activity event tracking and CSV export
- Admin portal for L2A Solutions staff
