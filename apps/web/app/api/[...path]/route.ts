import { NextRequest, NextResponse } from 'next/server';

/**
 * Catch-all proxy route: /api/v1/... → backend
 *
 * Using an explicit Next.js API Route instead of next.config.mjs rewrites
 * guarantees that ALL request headers (including Authorization) are forwarded
 * verbatim to the backend. Rewrites rely on Next.js's internal HTTP client
 * which can silently drop or mangle headers in certain Next.js 14 builds.
 */
const BACKEND = process.env.API_URL ?? 'http://localhost:3000';

async function proxy(
  req: NextRequest,
  { params }: { params: { path: string[] } },
): Promise<NextResponse> {
  const path = params.path.join('/');
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
