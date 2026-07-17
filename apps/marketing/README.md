# Billinx Marketing Site

Public landing page for Billinx, built with Next.js. Standalone app (own
`package.json`/install, same ad-hoc pattern as `apps/web` — this repo is not
a pnpm/Turborepo workspace).

```bash
npm install
npm run dev     # http://localhost:3002
npm run build
npm run start
```

Runs on port **3002** (backend: 3000, apps/web: 3001, marketing: 3002).

Set `NEXT_PUBLIC_APP_LOGIN_URL` to the live app login URL when deploying to production, e.g. `https://app.billinx.com/login`.
