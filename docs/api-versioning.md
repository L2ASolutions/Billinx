# Billinx API Versioning Policy

## Current Version

**v1** — all endpoints are prefixed `/v1/`.

Every response includes the header:

```
X-API-Version: 1.0.0
```

When a breaking change is introduced the major segment increments and a new URL prefix (`/v2/`) is added. The old prefix is deprecated but continues working for the deprecation period.

---

## How to Specify a Version

Use the URL prefix:

```
POST /v1/invoices/bulk
GET  /v1/api-keys
```

There is no header-based or query-param-based version selection — URL prefix is the only mechanism. This keeps proxies, caches, and logs unambiguous.

---

## Deprecation Policy

| Phase | Duration | What happens |
|---|---|---|
| **Active** | Indefinite | Supported, no deprecation headers |
| **Deprecated** | 12 months minimum | `X-API-Deprecated: true` and `X-API-Sunset: <date>` added to responses |
| **Sunset** | After sunset date | Endpoint returns `410 Gone` |

When a version enters deprecation we will:
1. Add `X-API-Deprecated: true` and `X-API-Sunset: YYYY-MM-DD` headers to every response from that prefix
2. Announce via email to all tenant OWNERs
3. Post a changelog entry to `docs/api-changelog.md`
4. Keep the endpoint alive for the full 12-month deprecation window

---

## Breaking vs Non-Breaking Changes

### Non-breaking (no version bump required)
- Adding new optional request fields
- Adding new response fields
- Adding new endpoints
- Relaxing validation rules
- Adding new enum values (when existing values still work)

### Breaking (requires new version prefix)
- Removing or renaming fields
- Changing field types
- Changing required/optional status of existing fields
- Removing endpoints
- Changing authentication mechanisms
- Changing error response formats

---

## Example Deprecation Headers

```http
HTTP/1.1 200 OK
X-API-Version: 1.0.0
X-API-Deprecated: true
X-API-Sunset: 2027-06-01
Content-Type: application/json
```

---

## Changelog

See `docs/api-changelog.md` for the full versioning history.
