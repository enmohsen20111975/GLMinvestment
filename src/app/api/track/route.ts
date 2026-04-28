import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';

// ---------------------------------------------------------------------------
// POST /api/track
// Lightweight page-visit & error tracking endpoint (no auth required).
// ---------------------------------------------------------------------------

interface TrackPayload {
  type: 'page_view' | 'api_error' | 'feature_use' | 'system_event';
  view?: string;
  action?: string;
  detail?: string;
  user_agent?: string;
  screen_width?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TrackPayload;
    const { type, view, action, detail, user_agent, screen_width } = body;

    if (!type) {
      return NextResponse.json({ success: false, error: 'type is required' }, { status: 400 });
    }

    // Get user from auth_token cookie if available
    let userId: string | null = null;
    const authCookie = request.cookies.get('auth_token')?.value;
    if (authCookie) {
      try {
        const parts = authCookie.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
          userId = payload.userId || payload.sub || payload.id || null;
        }
      } catch {
        // Invalid token, continue without user
      }
    }

    // Get IP (anonymized)
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0]?.trim()?.replace(/\d+$/, '***') : '***.***.***.***';

    const db = await getFinanceDb();

    // Ensure table exists
    db.prepare(`
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
        created_at TEXT DEFAULT (datetime('now', '+2 hours'))
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(type, created_at)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_view ON analytics_events(view, created_at)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id, created_at)`).run();

    // Insert event
    db.prepare(`
      INSERT INTO analytics_events (type, user_id, view, action, detail, ip_hash, user_agent, screen_width)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(type, userId || null, view || null, action || null, detail || null, ip, user_agent || null, screen_width || null);

    // Cleanup old events (keep last 90 days)
    db.prepare(`DELETE FROM analytics_events WHERE created_at < datetime('now', '-90 days', '+2 hours')`).run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Track API] Error:', error);
    return NextResponse.json({ success: true });
  }
}
