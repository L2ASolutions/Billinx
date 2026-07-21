// Runs once before the whole Playwright suite. Fails fast with a clear
// message if the backend or web server aren't actually up yet — without
// this, a test failing because "the app never loaded" looks identical to a
// test failing because of a real regression, and is a common source of
// confusing E2E flakiness reports.

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3001';

async function checkUrl(url: string, label: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${label} responded with HTTP ${res.status}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `\n\nE2E global setup failed: ${label} is not reachable at ${url} (${message}).\n` +
        'Make sure both the backend (npm run start:dev, port 3000) and the web ' +
        'app (npm run dev --prefix apps/web -- -p 3001, port 3001) are running ' +
        'before running the E2E suite.\n',
    );
  }
}

export default async function globalSetup(): Promise<void> {
  await checkUrl(`${API_URL}/health`, 'Backend API');
  await checkUrl(WEB_URL, 'Web app');
}
