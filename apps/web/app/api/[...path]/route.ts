import { NextRequest, NextResponse } from 'next/server';

/**
 * Catch-all proxy route: /api/v1/... → backend
 *
 * Using an explicit Next.js API Route instead of next.config.mjs rewrites
 * guarantees that ALL request headers (including Authorization) are forwarded
 * verbatim to the backend. Rewrites rely on Next.js's internal HTTP client
 * which can silently drop or mangle headers in certain Next.js 14 builds.
 */
// This route handler runs server-side inside the same container as the backend,
// so it always reaches the backend over localhost — even in Codespaces.
// The Codespaces forwarded URL (https://<name>-3000.app.github.dev) is for
// browser → backend calls and requires GitHub auth; it must NOT be used here.
// Set API_URL in .env.local to override (e.g. when backend runs elsewhere).
const BACKEND = process.env.API_URL ?? 'http://localhost:3000';

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  // params is a Promise in Next.js 15+ (App Router dynamic segments).
  // params.path contains the segments after the /api/ directory prefix, e.g.
  //   Request: /api/v1/invoices/dashboard/stats
  //   params.path: ['v1', 'invoices', 'dashboard', 'stats']
  // Strip a leading 'api/' segment as a safety net for any call path that
  // includes the prefix in the captured segments, so we never forward
  // /api/v1/... to the backend — only /v1/...
  const { path: pathSegments } = await params;
  const rawPath = pathSegments.join('/');
  const path = rawPath.startsWith('api/') ? rawPath.slice(4) : rawPath;
  const search = req.nextUrl.search;
  const url = `${BACKEND}/${path}${search}`;

  // Explicitly forward every request header — the key fix.
  // Next.js rewrites may silently drop Authorization; here we copy it ourselves.
  const forwardHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    // Skip hop-by-hop headers that must not be forwarded to the upstream.
    const hopByHop = ['host', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade'];
    if (!hopByHop.includes(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  });

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await req.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers: forwardHeaders,
      body: body as BodyInit | undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { statusCode: 502, message: `Upstream unreachable: ${msg}` },
      { status: 502 },
    );
  }

  // Forward the upstream response back to the browser.
  const resHeaders: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    const skip = ['connection', 'keep-alive', 'transfer-encoding'];
    if (!skip.includes(key.toLowerCase())) {
      resHeaders[key] = value;
    }
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
