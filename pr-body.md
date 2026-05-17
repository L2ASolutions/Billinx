## Summary

- **WebhookSubscription CRUD** — POST/GET/PATCH/DELETE /v1/webhooks/subscriptions scoped per tenant via API key auth
- **Async delivery via BullMQ** — WebhookWorker processes deliveries with 10 concurrent jobs; retry delays match the Interswitch spec (immediate, 5s, 15s)
- **HMAC-SHA256 signing** — per-subscription 32-byte key encrypted at rest (AES-256-GCM); delivered as X-Billinx-Signature: sha256=<hex> + X-Billinx-Timestamp + X-Billinx-Delivery headers
- **SSRF protection** — URL validation blocks non-HTTPS, localhost, private IPv4 ranges (10/8, 172.16-31/12, 192.168/16, 169.254/16, 127/8, 0.0.0.0), IPv6 loopback/ULA, and .local/.internal hostnames
- **Event wiring** — EventEmitterModule added to AppModule; invoice.created and invoice.cancelled emitted from InvoiceService; invoice.accepted and invoice.rejected emitted from SubmissionService after final FIRS result; WebhookService listens with @OnEvent decorators
- **Delivery management** — GET/POST /v1/webhooks/deliveries with status filter and manual retry; dead-lettered after 3 failures

## New endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /v1/webhooks/subscriptions | Create subscription |
| GET | /v1/webhooks/subscriptions | List subscriptions |
| GET | /v1/webhooks/subscriptions/:id | Get subscription |
| PATCH | /v1/webhooks/subscriptions/:id | Update subscription |
| DELETE | /v1/webhooks/subscriptions/:id | Delete subscription |
| GET | /v1/webhooks/deliveries | List deliveries (filter by status) |
| GET | /v1/webhooks/deliveries/:id | Get delivery detail |
| POST | /v1/webhooks/deliveries/:id/retry | Manual retry |
| GET | /v1/webhooks/event-types | List available event types |

## Test plan

- [ ] Create a subscription to a valid HTTPS endpoint, confirm signing key is encrypted in DB and not exposed in response
- [ ] Create an invoice, confirm invoice.created delivery is enqueued
- [ ] Confirm mock adapter acceptance triggers invoice.accepted delivery
- [ ] Verify subscriber receives correct HMAC X-Billinx-Signature: sha256=<computed>
- [ ] Simulate endpoint returning 500, confirm retry at 5s then 15s then DEAD_LETTERED
- [ ] POST to retry endpoint on dead-lettered delivery, confirm re-enqueued
- [ ] Attempt subscription with http:// URL, expect 400
- [ ] Attempt subscription with https://localhost/, expect 400
- [ ] Attempt to access another tenant subscription, expect 403

Generated with Claude Code
