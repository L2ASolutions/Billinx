# API Integrations — NRS/Interswitch & Payment Gateways

Moved out of `CLAUDE.md` on 2026-07-21 (content unchanged, verbatim) to keep the
main file within a manageable size. Covers the `submission` module (FIRS/NRS
adapters) and the `payment` module (Paystack/Flutterwave) descriptions from
CLAUDE.md's Modules section.

- **OAuth token cache details** (Interswitch Bearer token flow, per-tenant
  Client Credentials architecture decision) and the **CSID resolution note**
  live in `docs/nrs-schema-alignment.md` (gap #17 and the CSID entry) — not
  duplicated here to avoid drift between the two documents.
- The raw-`https`-client-vs-SDK investigation and payment endpoint auth/rate-limiting
  hardening are security-audit findings and live in `docs/security-guardrails.md`
  (finding #3).

---

### submission
- BullMQ job queue; mostly background workers, plus one route: `GET /v1/submissions/export`
- **Adapters** (pluggable): `MockAdapter` (dev), `InterswitchAdapter` (production NRS)
- Max 3 attempts per invoice; final failure → `DEAD_LETTERED`
- Each attempt stored in `SubmissionAttempt` with full request/response payloads
- On success: sets `firsConfirmedIrn`, `qrCodeBase64`, `acceptedAt`
- **UpdateStatus queue** (`queues/update-status.queue.ts` + `workers/update-status.worker.ts`, added 2026-07-18) — `PaymentService.recordPayment()` enqueues an `nrs-update-status` BullMQ job instead of firing-and-forgetting `InterswitchAdapter.updatePaymentStatus()` directly. 3 attempts with a custom 0s/5s/15s backoff strategy (`settings.backoffStrategy` on the Worker, since BullMQ's built-in fixed/exponential backoff can't express this exact schedule). `InterswitchAdapter.updatePaymentStatus()` now returns `Promise<boolean>` (was `Promise<void>`) so the worker can throw on failure and drive the retry — it still never throws itself, just resolves `false`. On success the worker sets `Invoice.lastNrsStatusUpdateAt`/`lastNrsStatusUpdateSuccess = true`; on final failure (BullMQ only emits `'failed'` once all attempts are exhausted) it sets `lastNrsStatusUpdateSuccess = false`, logs at `error` level, and notifies the tenant's active OWNER user via `NotificationService`. Both fields are surfaced in the invoice-detail response (`invoice-dashboard.controller.ts` → `InvoiceService.mapToResponse()`).


### payment (`src/modules/payment/`)
- Buyer-facing invoice payment initiation via Paystack and Flutterwave
- `POST /v1/payments/paystack/initialize`, `GET .../paystack/verify/:reference`, `POST .../paystack/webhook`
- `POST /v1/payments/flutterwave/initialize`, `POST .../flutterwave/webhook`
- Webhooks are HMAC-verified; initialize/verify routes are currently **unauthenticated with no rate limiting** — flagged as a hardening gap (see `docs/security-guardrails.md`, finding #3 — fixed 2026-07-04)
- Rolls its own raw `https` request client rather than the providers' SDKs, with regex-based invoice-ID recovery from the payment reference as a fallback when webhook metadata is missing

