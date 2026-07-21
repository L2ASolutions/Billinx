import { Page } from '@playwright/test';

const MAX_ATTEMPTS = 3;

// MockAdapter.submit() (src/modules/submission/adapters/mock/mock.adapter.ts)
// has a real, documented 90% acceptance rate and marks its simulated
// rejection retryable: false, so a genuine ~10% per-submission failure is
// expected behaviour, not flakiness — see invoice-round-trip.spec.ts for
// the full explanation. Retried here the same way: a fresh invoice (new
// IRN) up to MAX_ATTEMPTS times, since a DEAD_LETTERED/REJECTED invoice
// can't be resubmitted.
async function createAndSubmitOnce(
  page: Page,
  buyerName: string,
): Promise<{ id: string; status: string }> {
  const invoiceId: string = await page.evaluate(async (buyer: string) => {
    const token = localStorage.getItem('accessToken');
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    const tenant = await fetch('/api/v1/tenants/me', { headers }).then((r) =>
      r.json(),
    );

    const quantity = 1;
    const unitPrice = 15000;
    const vatRate = 7.5;
    const subtotal = quantity * unitPrice;
    const tax = subtotal * (vatRate / 100);

    const res = await fetch('/api/v1/invoices/dashboard', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invoiceTypeCode: '381',
        invoiceKind: 'B2B',
        currency: 'NGN',
        issueDate: new Date().toISOString(),
        seller: {
          tin: tenant.tin,
          partyName: tenant.name,
          postalAddress: tenant.registeredAddress,
        },
        buyer: {
          partyName: buyer,
          tin: '99988877-0001',
          email: 'e2e-pdf-buyer@test.ng',
          postalAddress: { streetName: '1 Test Street', country: 'NG' },
        },
        lineItems: [
          {
            description: 'E2E PDF test line item',
            quantity,
            unitPrice,
            priceUnit: 'EA',
            itemType: 'PRODUCT',
            hsnCode: '1001',
            productCategory: 'General goods',
          },
        ],
        taxTotal: [{ taxAmount: tax }],
        legalMonetaryTotal: {
          lineExtensionAmount: subtotal,
          taxExclusiveAmount: subtotal,
          taxInclusiveAmount: subtotal + tax,
          payableAmount: subtotal + tax,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to create invoice via API: ${res.status} ${await res.text()}`);
    }
    const created = await res.json();
    return created.id;
  }, buyerName);

  const fetchStatus = () =>
    page.evaluate(async (id: string) => {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/v1/invoices/dashboard/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return (await res.json()).status as string;
    }, invoiceId);

  // createInvoice() auto-queues FIRS submission — poll until it resolves.
  // A plain Node-side loop (not page.waitForFunction with an async
  // predicate) so each status read is an explicit, individually-awaited
  // step — easier to reason about and debug than relying on
  // waitForFunction's own internal polling/await semantics for an async
  // in-page function.
  const deadline = Date.now() + 30_000;
  let status = await fetchStatus();
  while (
    status !== 'ACCEPTED' &&
    status !== 'REJECTED' &&
    status !== 'DEAD_LETTERED' &&
    Date.now() < deadline
  ) {
    await page.waitForTimeout(1000);
    status = await fetchStatus();
  }

  return { id: invoiceId, status };
}

// Creates and auto-submits an invoice directly against the API (not through
// the New Invoice UI form) so journeys that just need *some* ACCEPTED
// invoice to exist — rather than testing invoice creation itself, which
// invoice-round-trip.spec.ts already covers — don't have to duplicate that
// whole slow form-fill flow. Runs via page.evaluate(fetch(...)) inside the
// already-authenticated browser context, reusing the same bearer token the
// real app would send.
export async function createAndAcceptInvoiceViaApi(
  page: Page,
  buyerName: string,
): Promise<string> {
  let last: { id: string; status: string } | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await createAndSubmitOnce(page, `${buyerName}-${attempt}`);
    if (last.status === 'ACCEPTED') return last.id;
  }
  throw new Error(
    `Invoice was rejected by the mock adapter on all ${MAX_ATTEMPTS} attempts (expected ~0.1% chance) — this may indicate a real regression, not simulated randomness. Last status: ${last?.status}`,
  );
}
