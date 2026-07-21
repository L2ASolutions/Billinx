import { Page } from '@playwright/test';
import { generateTotpCode } from './totp';

export const OWNER_EMAIL = 'owner@testcompany.ng';
export const OWNER_PASSWORD = 'TestOwner2026!';
// Must stay in sync with scripts/seed-dev-users.ts's E2E_OWNER_TOTP_SECRET —
// that script pre-enables MFA on this account with this exact secret so
// loginAsOwner() can compute a real, valid TOTP code instead of needing to
// walk through the QR-based /mfa/setup flow on every run.
export const OWNER_TOTP_SECRET = 'E2ETESTOWNERSECRETXYZABCDEFGH23';

export const VIEWER_EMAIL = 'testviewer@testcompany.ng';
export const VIEWER_PASSWORD = 'Viewer123!';

async function submitLoginForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// OWNER (and ADMIN) accounts always require MFA on login — see
// UserService.login()'s isPrivileged check. VIEWER/ACCOUNTANT do not.
export async function loginAsOwner(page: Page): Promise<void> {
  await submitLoginForm(page, OWNER_EMAIL, OWNER_PASSWORD);

  await page.waitForURL('**/mfa');
  const code = generateTotpCode(OWNER_TOTP_SECRET);
  const digitInputs = page.getByTestId('mfa-digit');
  for (let i = 0; i < 6; i++) {
    await digitInputs.nth(i).fill(code[i]);
  }
  await page.getByRole('button', { name: 'Verify' }).click();

  await page.waitForURL('**/dashboard');
}

export async function loginAsViewer(page: Page): Promise<void> {
  await submitLoginForm(page, VIEWER_EMAIL, VIEWER_PASSWORD);
  await page.waitForURL('**/dashboard');
}
