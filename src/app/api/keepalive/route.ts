/**
 * GET /api/keepalive
 * ==================
 * Lightweight endpoint that prevents Hostinger from killing the idle
 * Next.js server. Called every 60 seconds from the client.
 *
 * PKG2-ROUND2 (Engineering): migrated to the Unified Response Schema
 * (`apiOk` from `@/lib/api-response`) so the response shape matches the
 * rest of the API surface — single `success` + `data` + `timestamp`.
 *
 * Rule 67 (SSOT): `timestamp` is the canonical server time, used by
 * clients to detect clock drift.
 */

import { apiOk } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET() {
  return apiOk({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}
