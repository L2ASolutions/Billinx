import { test, expect, Page } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/owner.json' });

// Generous: mock adapter delay (800-2100ms) + BullMQ processing + the
// detail page's own 2s status poll + a 3s post-accept UI delay before the
// real page renders, on top of a full form fill, repeated up to
// MAX_SUBMIT_ATTEMPTS times (see below) — see CLAUDE.md's note on this
// journey's timeout for the full breakdown.
test.setTimeout(180_000);

// MockAdapter.submit() (src/modules/submission/adapters/mock/mock.adapter.ts)
// has a real, documented 90% acceptance rate and marks its simulated
// rejection retryable: false, so SubmissionService dead-letters it on the
// very first attempt — there is no built-in backend retry to lean on. A
// genuine ~10% per-submission failure rate isn't test flakiness, it's the
// adapter working as designed, so this journey creates a fresh invoice (a
// fresh IRN, not a resubmit — DEAD_LETTERED invoices can't be resubmitted)
// up to 3 times, only failing if all 3 happen to land on the simulated
// rejection (≈0.1% chance) rather than relying on Playwright's outer
// retries: 1 to paper over it.
const MAX_SUBMIT_ATTEMPTS = 3;

async function fillAndSubmitInvoice(
  page: Page,
  buyerName: string,
): Promise<{ status: string; invoiceId: string }> {
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  await page.goto('/dashboard');
  await page.getByTestId('create-invoice-btn').click();
  await page.waitForURL('**/invoices/new');

  // Header
  await page.getByTestId('invoice-kind-select').selectOption('B2B');
  await page.getByTestId('issue-date-input').fill(today);
  await page.getByTestId('due-date-input').fill(dueDate);

  // Buyer — address/state are also required by this form's client-side
  // validateForSubmit(), even though only name/TIN/email were in scope.
  await page.getByTestId('buyer-name-input').fill(buyerName);
  await page.getByTestId('buyer-tin-input').fill('12345678-0001');
  await page.getByTestId('buyer-email-input').fill('buyer@test.ng');
  await page.getByTestId('buyer-address-input').fill('1 E2E Test Street');
  await page.getByTestId('buyer-state-select').selectOption({ index: 1 });

  // Line item
  await page.getByTestId('line-item-description').fill('E2E Test Service');
  await page.getByTestId('line-item-quantity').fill('5');
  await page.getByTestId('line-item-unit-price').fill('10000');
  await page.getByTestId('line-item-type-service').click();
  await page.getByTestId('code-search-input').fill('7020');
  await page.getByTestId('code-search-result').first().click();
  await page.getByTestId('line-item-category').fill('Consulting');

  // Save as draft first
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('button', { name: '✓ Saved' })).toBeVisible();

  // Submit to NRS (Preview & submit → opens a modal; Submit invoice inside
  // it is the actual submission trigger — see CLAUDE.md for why this
  // journey's steps don't match a literal "Save Draft" / "Submit to NRS"
  // two-button flow on the detail page, which doesn't exist).
  await page.getByRole('button', { name: 'Preview & submit →' }).click();
  await page.getByRole('button', { name: 'Submit invoice' }).click();

  // A real regression, not just belt-and-suspenders: Page.waitForURL()
  // resolves immediately if the *current* URL already matches — it does not
  // wait for a fresh navigation. The page is already on /invoices/new at
  // this point, which itself matches a loose /\/invoices\/[^/]+$/ pattern
  // ("new" satisfies [^/]+), so that regex resolved instantly without
  // waiting for the real navigation to the created invoice's detail page,
  // and the "invoice id" captured from the URL right after was literally
  // the string "new". Caught via live verification (a trace showing
  // GET /api/v1/invoices/pay/new), not by reading the code — anchoring the
  // id itself to a UUID shape is what actually forces a wait for the real
  // navigation.
  await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/i);
  const invoiceId = page.url().match(/\/invoices\/([0-9a-f-]{36})/i)?.[1] ?? '';

  // Wait for a terminal outcome (async: mock adapter -> BullMQ -> 2s UI
  // poll). "Invoice rejected" is this page's <h1> when submission lands on
  // REJECTED/DEAD_LETTERED — a single, unique element (unlike "FIRS
  // Rejected", which appears twice on that same page and trips Playwright's
  // strict-mode duplicate-match check if used with .or() here).
  await expect(
    page
      .getByTestId('invoice-status-badge')
      .or(page.getByRole('heading', { name: 'Invoice rejected' })),
  ).toBeVisible({ timeout: 60_000 });

  const isAccepted = await page.getByTestId('invoice-status-badge').isVisible();
  return { status: isAccepted ? 'ACCEPTED' : 'REJECTED', invoiceId };
}

test('creates invoice, submits to NRS, and renders all fields correctly on detail page', async ({ page }) => {
  const unique = Date.now();
  let result: { status: string; invoiceId: string } | undefined;

  for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
    result = await fillAndSubmitInvoice(page, `E2E Test Buyer ${unique}-${attempt}`);
    if (result.status === 'ACCEPTED') break;
  }

  expect(
    result?.status,
    `Invoice was rejected by the mock adapter on all ${MAX_SUBMIT_ATTEMPTS} attempts (expected ~0.1% chance) — this may indicate a real regression, not simulated randomness`,
  ).toBe('ACCEPTED');

  await expect(page.getByTestId('invoice-status-badge')).toHaveText('FIRS Accepted');

  // IRN / FIRS reference
  await expect(page.getByTestId('invoice-irn')).toBeVisible();
  await expect(page.getByTestId('invoice-irn')).not.toHaveText('');
  await expect(page.getByTestId('firs-reference')).toBeVisible();
  await expect(page.getByTestId('firs-reference')).not.toHaveText('');

  // Line item rendering
  await expect(page.getByText('E2E Test Service')).toBeVisible();
  await expect(page.getByTestId('line-item-quantity-display').first()).toHaveText('5');
  const lineAmount = await page.getByTestId('line-item-amount').first().textContent();
  expect(lineAmount).not.toContain('NaN');

  // Totals
  const totalPayable = await page.getByTestId('total-payable').textContent();
  expect(totalPayable).not.toContain('NaN');
  const totalPayableNumber = Number((totalPayable ?? '').replace(/[^0-9.]/g, ''));
  expect(totalPayableNumber).toBeGreaterThan(0);

  const vatAmount = await page.getByTestId('vat-amount').textContent();
  expect(vatAmount).not.toContain('NaN');
  await expect(page.getByTestId('vat-amount')).toBeVisible();

  // Payment buttons live on the public buyer-facing pay page, not the
  // dashboard invoice detail page — see CLAUDE.md's assessment note. Longer
  // timeout: this page loads the invoice via its own fetch independently of
  // the dashboard detail page's poll, so there can be a brief extra lag
  // right after acceptance before canPay's amountOutstanding > 0 check
  // reflects the just-accepted invoice.
  await page.goto(`/pay/${result!.invoiceId}`);
  await expect(page.getByTestId('pay-paystack-btn')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('pay-flutterwave-btn')).toBeVisible({ timeout: 15_000 });
});
