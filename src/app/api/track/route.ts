import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';

// ---------------------------------------------------------------------------
// POST /api/track
// Track analytics events into analytics_events (stocks.db)
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

    const db = await getFinanceDb();

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
        created_at TEXT DEFAULT (datetime('now', '+2 hours'))
      )
    `);

    const xff = request.headers.get('x-forwarded-for');
    const ipHash = xff ? xff.split(',')[0].trim() : (request.headers.get('x-real-ip') || 'unknown');

    const adminSession = request.headers.get('cookie')?.match(/(?:^|; )admin_session=([^;]+)/)?.[1] || null;

    db.run(
      `INSERT INTO analytics_events (type, view, action, detail, user_id, ip_hash, user_agent, screen_width) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      type,
      view || null,
      action || null,
      detail || null,
      adminSession,
      ipHash,
      user_agent || null,
      screen_width || null,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Track API] Error:', error);
    return NextResponse.json({ success: true });
  }
}
