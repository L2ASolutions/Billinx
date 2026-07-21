import { test as setup } from '@playwright/test';
import { loginAsOwner, loginAsViewer } from './helpers/auth';

// Authenticates once per role and persists the result (localStorage token)
// to a storageState file that every journey spec then loads directly via
// test.use({ storageState: ... }) instead of re-running the login form.
//
// This isn't just a speed optimisation: POST /v1/auth/login (and
// /v1/auth/mfa/challenge) sit behind AuthRateLimitGuard, a strict 5
// requests / 15 minutes *per IP* bucket shared across login/register/
// forgot-password. Every Playwright test/worker on a CI runner shares one
// IP, so five independent journeys each doing their own full UI login (one
// of them — the owner — needing two calls, for the password step and the
// MFA challenge step) would blow through that budget on its own, before
// counting Playwright's built-in retry-once-on-failure. Logging in exactly
// twice total (one owner, one viewer), here, keeps the whole suite — retries
// included — comfortably under the limit.
//
// The real login-form + MFA-challenge UI flow itself is still exercised for
// real by loginAsOwner()/loginAsViewer() (see helpers/auth.ts) — this file
// just runs it once instead of once per test.

setup('authenticate as owner', async ({ page }) => {
  await loginAsOwner(page);
  await page.context().storageState({ path: 'e2e/.auth/owner.json' });
});

setup('authenticate as viewer', async ({ page }) => {
  await loginAsViewer(page);
  await page.context().storageState({ path: 'e2e/.auth/viewer.json' });
});
