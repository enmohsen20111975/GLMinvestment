import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { createHash } from 'crypto';
import { db as authDb } from '@/lib/db';
import { updateLastActiveRaw } from '@/lib/last-active-helper';

// ---------------------------------------------------------------------------
// POST /api/track
// Track analytics events into analytics_events (stocks.db).
//
// ANALYTICS-FIX (2026-10-01):
//   - Previously this endpoint only inspected the `admin_session` cookie and
//     ignored NextAuth sessions + Bearer tokens, so 106/106 real users were
//     recorded as inactive. Now we resolve the user via `getSessionUserId()`
//     (handles both web session + mobile bearer) and fall back to an
//     anonymous IP-hashed ID for unauthenticated visitors.
//   - Also backfills `User.last_active_at` on every authenticated page_view
//     so the admin dashboard can show real activity instead of relying solely
//     on analytics_events.
//   - Accepts BOTH the legacy payload shape (type/view/action/detail) used by
//     AdminView AND the new beacon shape ({event, route, timestamp}) emitted
//     by Providers.tsx for hash-route page views.
// ---------------------------------------------------------------------------

interface TrackPayload {
  // Legacy shape (AdminView)
  type?: 'page_view' | 'api_error' | 'feature_use' | 'system_event';
  view?: string;
  action?: string;
  detail?: string;
  user_agent?: string;
  screen_width?: number;
  // New beacon shape (Providers.tsx global tracking)
  event?: string;
  route?: string;
  timestamp?: number;
}

function anonIdFromIp(ip: string): string {
  return 'anon_' + createHash('sha256').update(ip || 'unknown').digest('hex').substring(0, 16);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as TrackPayload;

    // ---- Normalize the payload: support BOTH legacy + beacon shapes ----
    // The legacy callers (AdminView) send { type, view, action, detail }.
    // The new global Providers.tsx beacon sends { event:'page_view', route, timestamp }.
    const rawType = body.type || body.event;
    const type = rawType || 'page_view';
    const route = body.route || body.view || null;
    const action = body.action || null;
    const detail = body.detail || null;
    const userAgent = body.user_agent || request.headers.get('user-agent') || null;
    const screenWidth = body.screen_width || null;

    if (!type) {
      return NextResponse.json({ success: false, error: 'type is required' }, { status: 400 });
    }

    const db = await getFinanceDb();

    // ---- Ensure table exists + add is_authenticated column (idempotent) ----
    db.run(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        user_id TEXT,
        view TEXT,
        action TEXT,
        detail TEXT,
        ip_hash TEXT,
        user_agent TEXT,
        screen_width INTEGER,
        is_authenticated INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', '+2 hours'))
      )
    `);

    // Idempotently add is_authenticated column for legacy installs (Rule 56: column name is whitelisted literal).
    try {
      db.run(`ALTER TABLE analytics_events ADD COLUMN is_authenticated INTEGER DEFAULT 0`);
    } catch { // silent fallback (safe-by-design)
      // Column already exists — safe to ignore.
    }

    // ---- Resolve the real user ID (NextAuth session OR Bearer token) ----
    const { userId: realUserId } = await getSessionUserId();
    const isAuthenticated = !!realUserId;

    // ---- IP hash for both analytics + anonymous fallback ID ----
    const xff = request.headers.get('x-forwarded-for');
    const ip = xff ? xff.split(',')[0].trim() : (request.headers.get('x-real-ip') || 'unknown');
    const ipHash = createHash('sha256').update(ip).digest('hex').substring(0, 16);

    // Rule 55 (P0-WAVE-SECURITY): never expose sensitive data — store only the
    // user_id (Prisma CUID) or the anonymous hashed ID. No emails/names/tokens.
    const userIdForStorage = realUserId || anonIdFromIp(ip);

    // ---- Insert the event (Rule 56: parameterized) ----
    db.run(
      `INSERT INTO analytics_events
         (type, view, action, detail, user_id, ip_hash, user_agent, screen_width, is_authenticated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      type,
      route,
      action,
      detail,
      userIdForStorage,
      ipHash,
      userAgent,
      screenWidth,
      isAuthenticated ? 1 : 0,
    );

    // ---- Fire-and-forget: update User.last_active_at for authenticated users ----
    // Throttled to 1 update per user per 5 minutes via global cache.
    // FIX (Prisma SQLite bug): Uses updateLastActiveRaw (better-sqlite3) directly to avoid corrupting DateTime with ms integers.
    if (isAuthenticated && realUserId && type === 'page_view') {
      const now = Date.now();
      const g = globalThis as unknown as { _lastActiveUpdate?: Record<string, number> };
      g._lastActiveUpdate = g._lastActiveUpdate || {};
      const last = g._lastActiveUpdate[realUserId] || 0;
      if (now - last > 5 * 60 * 1000) {
        g._lastActiveUpdate[realUserId] = now;
        try {
          updateLastActiveRaw(realUserId);
        } catch {
          // Non-fatal — tracking must still succeed.
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Track API] Error:', error);
    // Always return success to the client — tracking is fire-and-forget,
    // we never want a tracking error to break the user's UX (Rule 55).
    return NextResponse.json({ success: true });
  }
}
