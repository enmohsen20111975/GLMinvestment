/**
 * Python Backend Proxy Route — unified with /api/proxy/* (SEC-04 + REDIRECT-FIX)
 * =========================================================================
 *
 * HISTORY (P0.3): This route WAS a 308 redirect to `/api/proxy/*`. That
 * redirect broke production behind Caddy because `new URL(path, req.url)`
 * built the Location header from the INTERNAL `req.url`
 * (e.g. `https://localhost:3000/api/proxy/health`). The browser then
 * tried to follow the redirect to `localhost:3000` on the USER'S machine,
 * causing `net::ERR_SSL_PROTOCOL_ERROR`.
 *
 * FIX (REDIRECT-FIX 2026-08-30): Eliminated the redirect entirely. This
 * route now calls the SAME `proxyRequest` handler as `/api/proxy/*`,
 * so `/api/python/health` and `/api/proxy/health` behave identically —
 * no redirect, no URL construction, no proxy-header sensitivity.
 *
 * Frontend callers using `fetch('/api/python/foo')` continue to work
 * transparently — the request is proxied directly to the Python backend
 * (http://localhost:8010) with the same auth + CORS hardening as
 * `/api/proxy/*`.
 *
 * Reference: Documentation/03-REFACTORING_REPORT.md §P0.3 + §13 Example 3.
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";
export const runtime = 'nodejs';

import { proxyRequest } from '@/app/api/proxy/[...path]/route';
import { handleV4Stats } from '@/app/api/v4/stats/route';

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * P0-FIX (API-FALLBACKS-WAVE-2): special-case `v4/stats`.
 * The Python backend is down in this sandbox, so the unified proxy below
 * returns 502 for every path. `/api/python/v4/stats` is consumed by the
 * TradingMemoryView (client-facing) — we intercept it here, try Python
 * first (5s timeout), then fall back to SQLite via handleV4Stats().
 *
 * Every other path continues to use the standard proxyRequest() pipeline.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const joined = path.join('/');
  if (joined === 'v4/stats' || joined === 'v4\\stats') {
    return handleV4Stats(request);
  }
  return proxyRequest(request, { params: context.params });
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}
