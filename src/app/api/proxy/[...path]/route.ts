import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { requireAdminAsync } from '@/lib/admin-auth-server';

/**
 * SEC-04 HOTFIX (Phase A) — Admin auth bypass via public proxy.
 *
 * Previous behavior (CRITICAL VULNERABILITY):
 *   - `/api/proxy/[...path]` forwarded ANY method to
 *     `http://localhost:8010/api/{path}` with NO auth check.
 *   - A hardcoded `PROXY_API_KEY` fallback lived in source.
 *   - Python `@require_admin` auto-authorized `127.0.0.1` (the Next.js
 *     server), so any public request to `/api/proxy/admin/<anything>` ran
 *     with full admin privileges.
 *
 * New behavior (FAIL CLOSED):
 *   - Any proxied path beginning with `admin/` requires `requireAdminAsync`
 *     (valid admin_session cookie OR X-Admin-Token OR NextAuth admin
 *     session). Unauthorized → 403.
 *   - The `PROXY_API_KEY` is read ONLY from env. No hardcoded fallback.
 *     If unset, the proxy still works for public endpoints; admin endpoints
 *     are still gated by `requireAdminAsync` (the key is sent as a header
 *     to Python which now validates it instead of trusting localhost).
 *   - CORS `Access-Control-Allow-Origin` is restricted to same-origin
 *     (reflects the request Origin if it matches the host) instead of `*`.
 *   - In production, the localhost bypass in `requireAdminAsync` (Method 3)
 *     is already disabled by `NODE_ENV !== 'production'`, so admin proxy
 *     requests from the public internet cannot succeed without a real
 *     admin cookie/token.
 */

const BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';
// SEC-04: NO hardcoded fallback. Empty string if env var is unset.
const API_KEY = process.env.PROXY_API_KEY || '';

// Headers that should be forwarded from client to backend
const FORWARD_HEADERS = ['content-type', 'accept', 'authorization'];

// Headers that should NOT be sent to the backend (hop-by-hop headers)
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/**
 * Build a same-origin CORS response. Instead of echoing `*` (which allows
 * any site to read admin responses), we reflect the request Origin only if
 * it matches the current host. Cross-origin browsers are denied read access.
 */
function applySameOriginCors(req: NextRequest, responseHeaders: Headers) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host') || '';
  const xForwardedHost = req.headers.get('x-forwarded-host') || '';
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host || originHost === xForwardedHost) {
        responseHeaders.set('Access-Control-Allow-Origin', origin);
        responseHeaders.set('Vary', 'Origin');
      }
      // else: do not set ACAO — browser blocks cross-origin reads
    } catch {
      // malformed origin — ignore
    }
  }
  responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  responseHeaders.set('Access-Control-Allow-Credentials', 'true');
}

export async function proxyRequest(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const backendPath = path.join('/');

  // SEC-04: Any path under admin/ requires a verified admin session.
  // This blocks the public-internet → localhost:8010 → Python admin route
  // privilege escalation chain.
  if (backendPath === 'admin' || backendPath.startsWith('admin/')) {
    const authError = await requireAdminAsync(request);
    if (authError) {
      return authError; // 403
    }
  }

  // P0.3 (SEC-04): `health` and `keepalive` are exposed at root on the Python
  // backend (e.g. http://localhost:8010/health) rather than under /api/.
  // The legacy /api/python/* route special-cased these; we preserve that
  // behavior here so the 308 redirect from /api/python/* to /api/proxy/*
  // keeps them working.
  const NO_API_PREFIX = new Set(['health', 'keepalive']);
  const url = NO_API_PREFIX.has(backendPath)
    ? `${BACKEND_URL}/${backendPath}`
    : `${BACKEND_URL}/api/${backendPath}`;

  // Build headers for the backend request
  const headers: Record<string, string> = {};

  // Forward relevant headers from the incoming request
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && FORWARD_HEADERS.includes(key.toLowerCase())) {
      headers[key] = value;
    }
  });

  // Forward the admin session cookie as an X-Admin-Token-equivalent hint so
  // the Python backend can re-validate (defense in depth). The Python side
  // no longer trusts localhost; it requires this header OR a valid
  // X-Admin-Token. We send the configured PROXY_API_KEY only when set.
  const adminCookie = request.cookies.get('admin_session')?.value;
  if (adminCookie) {
    headers['X-Admin-Session'] = adminCookie;
  }
  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }

  // Build request options
  const init: RequestInit = {
    headers,
    cache: 'no-store',
  };

  // Forward body for non-GET methods
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      init.body = await request.text();
    } else {
      init.body = await request.arrayBuffer();
    }
  }

  try {
    const res = await fetch(url, init);

    // Build response headers
    const responseHeaders = new Headers();
    res.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    // SEC-04: tighten CORS from `*` to same-origin only.
    applySameOriginCors(request, responseHeaders);

    const body = await res.arrayBuffer();

    return new NextResponse(body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`[Proxy] Error proxying ${request.method} /api/${backendPath}:`, error);
    return NextResponse.json(
      { detail: 'Backend service unavailable', error: String(error) },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function OPTIONS(req: NextRequest) {
  const responseHeaders = new Headers();
  applySameOriginCors(req, responseHeaders);
  responseHeaders.set('Access-Control-Max-Age', '86400');
  return new NextResponse(null, {
    status: 204,
    headers: responseHeaders,
  });
}
