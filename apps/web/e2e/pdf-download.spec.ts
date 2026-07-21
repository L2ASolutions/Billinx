import { test, expect } from '@playwright/test';
import { createAndAcceptInvoiceViaApi } from './helpers/invoices';

test.use({ storageState: 'e2e/.auth/owner.json' });
test.setTimeout(60_000);

test('accepted invoice PDF downloads without error', async ({ page }) => {
  await page.goto('/dashboard');

  const buyerName = `E2E PDF Buyer ${Date.now()}`;
  const invoiceId = await createAndAcceptInvoiceViaApi(page, buyerName);

  await page.goto(`/invoices/${invoiceId}`);
  await expect(page.getByTestId('invoice-status-badge')).toHaveText(
    'FIRS Accepted',
  );

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-pdf-btn').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const failure = await download.failure();
  expect(failure).toBeNull();
});
