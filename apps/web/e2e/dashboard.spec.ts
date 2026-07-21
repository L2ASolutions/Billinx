import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/owner.json' });

test('dashboard loads and shows financial summary without NaN values', async ({ page }) => {
  await page.goto('/dashboard');

  const receivables = page.getByTestId('outstanding-receivables');
  const payables = page.getByTestId('outstanding-payables');
  const netCash = page.getByTestId('net-cash-position');
  const vatSummary = page.getByTestId('vat-summary');

  await expect(receivables).toBeVisible();
  await expect(receivables).not.toContainText('NaN');

  await expect(payables).toBeVisible();
  await expect(payables).not.toContainText('NaN');

  await expect(netCash).not.toContainText('NaN');

  // VAT strip is gated behind the tenant's dashboard-visibility rules for
  // this role, so only assert its content when it's actually rendered.
  if (await vatSummary.isVisible()) {
    await expect(vatSummary).not.toContainText('NaN');
  }

  // No visible error banners anywhere on the page. This app's convention
  // for an inline error banner is specifically bg-red-50 + border-red-200
  // (see e.g. login/page.tsx, invoices/new/page.tsx) — narrower than "any
  // red text", which would also catch legitimate red accents like the
  // "N overdue" badge on this same page.
  await expect(page.locator('.bg-red-50.border-red-200')).toHaveCount(0);
});
