import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/owner.json' });
test.setTimeout(60_000);

test('creates, pauses, resumes and cancels a recurring invoice schedule', async ({ page }) => {
  const scheduleName = `E2E Monthly Retainer ${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);

  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/invoices/recurring');
  await page.getByRole('button', { name: '+ New Recurring Invoice' }).first().click();

  await page.getByTestId('recurring-name-input').fill(scheduleName);
  await page.getByTestId('recurring-frequency-select').selectOption('MONTHLY');
  await page.getByTestId('recurring-start-date-input').fill(today);
  await page.getByTestId('recurring-buyer-name-input').fill('E2E Recurring Buyer');
  await page.getByTestId('recurring-buyer-tin-input').fill('12345678-0002');
  await page.getByTestId('recurring-line-item-description').fill('Monthly Service');
  await page.getByTestId('recurring-line-item-quantity').fill('1');
  await page.getByTestId('recurring-line-item-unit-price').fill('50000');
  await page.getByTestId('recurring-line-item-type-select').selectOption('service');

  await page.getByRole('button', { name: 'Save schedule' }).click();

  const row = page.locator('tr', { hasText: scheduleName });
  await expect(row).toBeVisible();
  await expect(row.getByTestId('recurring-invoice-status')).toHaveText('Active');

  await row.getByRole('button', { name: 'Pause' }).click();
  await expect(row.getByTestId('recurring-invoice-status')).toHaveText('Paused');

  await row.getByRole('button', { name: 'Resume' }).click();
  await expect(row.getByTestId('recurring-invoice-status')).toHaveText('Active');

  await row.getByRole('button', { name: 'Cancel' }).click();
  await expect(row.getByTestId('recurring-invoice-status')).toHaveText('Cancelled');
});
