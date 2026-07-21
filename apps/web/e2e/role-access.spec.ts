import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/viewer.json' });

test('viewer cannot create invoices but can view them', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/);

  await expect(page.getByTestId('create-invoice-btn')).not.toBeVisible();

  await page.goto('/invoices');
  // Read access works: either real rows, or the genuine empty state — both
  // prove the list loaded rather than being blocked/erroring for this role.
  // Waits (via toPass's retrying poll) for the initial loading skeleton to
  // resolve into one or the other, rather than a one-shot check that can
  // race the list's own fetch-on-mount.
  await expect(async () => {
    const rows = await page.locator('table tbody tr').count();
    const emptyState = await page.getByText(/no invoices yet/i).isVisible();
    expect(rows > 0 || emptyState).toBe(true);
  }).toPass({ timeout: 15_000 });

  const hasRows = (await page.locator('table tbody tr').count()) > 0;
  if (hasRows) {
    await page.locator('table tbody tr').first().click();
    // UUID-anchored, not a loose [^/]+$: see invoice-round-trip.spec.ts for
    // why — waitForURL resolves immediately against an already-matching
    // current URL, so a loose pattern risks not waiting for navigation at
    // all if this page is ever reachable from another /invoices/<word> URL.
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/i);
    // There is no "Submit"/"Submit to NRS" action anywhere on the dashboard
    // invoice detail page for any role — submission only happens from the
    // New Invoice form's preview step — so this is a real, meaningful
    // assertion, not a vacuous one.
    await expect(
      page.getByRole('button', { name: /submit/i }),
    ).toHaveCount(0);
  }
});
