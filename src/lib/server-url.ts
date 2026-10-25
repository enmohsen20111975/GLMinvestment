/**
 * Server-side URL helpers for Next.js API routes
 * ==================================================
 *
 * PROBLEM: Several API routes use `http://127.0.0.1:3000/...` to call
 * OTHER Next.js API routes on the same server. This is fragile:
 *   - Port 3000 is hardcoded → breaks if port changes
 *   - `127.0.0.1` might not match the server's actual bind address
 *   - In Docker/PM2 cluster mode, the call might hit a different worker
 *
 * SOLUTION: Use the incoming request's origin (from headers) to build
 * the self-referencing URL. This works behind Caddy, Nginx, or any
 * reverse proxy because the `host` / `x-forwarded-host` headers carry
 * the correct origin.
 *
 * Usage:
 *   import { getSelfBaseUrl } from '@/lib/server-url';
 *
 *   export async function GET(request: NextRequest) {
 *     const baseUrl = getSelfBaseUrl(request);
 *     const res = await fetch(`${baseUrl}/api/stocks/${ticker}`);
 *   }
 *
 * For Python backend calls, use PYTHON_BACKEND_URL env var directly
 * (default: http://127.0.0.1:8010) — never use localhost:3000 for that.
 */

import { NextRequest } from 'next/server';

/**
 * Returns the base URL of THIS Next.js server, as seen from the
 * incoming request. Uses x-forwarded-* headers when behind a proxy.
 *
 * Returns a string like:
 *   - "http://127.0.0.1:3000" (direct, no proxy)
 *   - "https://invist.m2y.net" (behind Caddy with SSL)
 *
 * @param request - The incoming NextRequest
 * @returns Base URL string (no trailing slash)
 */
export function getSelfBaseUrl(request: NextRequest): string {
  // Behind a reverse proxy (Caddy, Nginx), the forwarded headers tell us
  // the original host and protocol.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  const directHost = request.headers.get('host');

  // Prefer forwarded host (original client-facing host), fall back to direct.
  const host = forwardedHost || directHost || '127.0.0.1:3000';

  // If we have a forwarded host, we're behind a proxy → use HTTPS
  // (Caddy terminates SSL and forwards as HTTP, but the client sees HTTPS).
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  // Direct connection (no proxy) → use the request's protocol + host.
  // In dev, this is http://localhost:3000 or http://127.0.0.1:3000.
  // In production behind Caddy, forwardedHost will be set, so we won't get here.
  const protocol = directHost?.startsWith('localhost') || directHost?.startsWith('127.0.0.1')
    ? 'http'
    : 'https';
  return `${protocol}://${host}`;
}

/**
 * Returns the Python backend URL.
 * Uses PYTHON_BACKEND_URL env var (default: http://127.0.0.1:8010).
 * This is always a server-to-server call — never exposed to the browser.
 */
export function getPythonBackendUrl(): string {
  return process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
}
