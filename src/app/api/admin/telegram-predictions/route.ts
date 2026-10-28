/**
 * GET /api/admin/telegram-predictions
 * ===================================
 * Task 28-B (Fix 7 — Fix Battalion):
 *   Telegram published predictions audit — lists predictions with their
 *   published_at + telegram_message_id + was_published flag, and shows
 *   pending (not published) predictions.
 *
 *   The predictions table doesn't always have the was_published /
 *   published_at / telegram_message_id columns — they're added lazily
 *   by /api/telegram/publish-stock/route.ts (FIX-P2-PREDICTIONS). Here
 *   we use PRAGMA table_info to gracefully degrade if the columns
 *   are missing.
 *
 *   Returns:
 *     - summary: total, published, pending, with_audit_trail
 *     - published: predictions with was_published=1
 *     - pending_today: predictions from today without was_published
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { openDb } from '@/lib/db-manager';

export const dynamic = 'force-dynamic';

const DB_PATH = 'predictions.db';

interface PredictionRow {
  id: number;
  ticker: string;
  signal: string | null;
  signal_type: string | null;
  market: string | null;
  prediction_date: string | null;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  master_score: number | null;
  status: string | null;
  published_at: string | null;
  telegram_message_id: number | null;
  was_published: number | null;
}

interface TelegramPredictionsResponse {
  success: boolean;
  timestamp: string;
  audit_columns_present: boolean;
  summary: {
    total: number;
    published: number;
    pending: number;
    pending_today: number;
    with_message_id: number;
  };
  published: PredictionRow[];
  pending_today: PredictionRow[];
  message?: string;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const db = openDb(DB_PATH);
    if (!db) {
      return NextResponse.json(
        { success: false, error: 'predictions_db_missing', path: DB_PATH },
        { status: 503 },
      );
    }
    db.pragma('busy_timeout = 5000');

    // Check if the audit-trail columns exist
    const cols = db.prepare('PRAGMA table_info(predictions)').all() as Array<{ name: string }>;
    const colNames = new Set(cols.map(c => c.name));
    const hasAudit = colNames.has('was_published')
      && colNames.has('published_at')
      && colNames.has('telegram_message_id');

    const totalRow = db.prepare('SELECT COUNT(*) as n FROM predictions').get() as { n: number };
    const total = totalRow?.n || 0;

    let published: PredictionRow[] = [];
    let pendingToday: PredictionRow[] = [];
    let publishedCount = 0;
    let pendingCount = 0;
    let pendingTodayCount = 0;
    let withMessageIdCount = 0;

    if (hasAudit) {
      // Published predictions
      published = db.prepare(`
        SELECT id, ticker, signal, signal_type, market, prediction_date,
               entry_price, target_price, stop_loss, master_score, status,
               published_at, telegram_message_id, was_published
        FROM predictions
        WHERE was_published = 1
        ORDER BY published_at DESC
        LIMIT 50
      `).all() as PredictionRow[];

      publishedCount = (db.prepare('SELECT COUNT(*) as n FROM predictions WHERE was_published = 1').get() as { n: number })?.n || 0;
      pendingCount = total - publishedCount;
      pendingTodayCount = (db.prepare(`
        SELECT COUNT(*) as n FROM predictions
        WHERE (was_published = 0 OR was_published IS NULL)
          AND date(prediction_date) = date('now')
      `).get() as { n: number })?.n || 0;
      withMessageIdCount = (db.prepare('SELECT COUNT(*) as n FROM predictions WHERE telegram_message_id IS NOT NULL').get() as { n: number })?.n || 0;

      // Pending today (not published + today's prediction_date)
      pendingToday = db.prepare(`
        SELECT id, ticker, signal, signal_type, market, prediction_date,
               entry_price, target_price, stop_loss, master_score, status,
               published_at, telegram_message_id, was_published
        FROM predictions
        WHERE (was_published = 0 OR was_published IS NULL)
          AND date(prediction_date) = date('now')
        ORDER BY master_score DESC
        LIMIT 30
      `).all() as PredictionRow[];
    }

    db.close();

    // Normalize numbers (better-sqlite3 returns bigint for INTEGER columns sometimes)
    const normalize = (rows: PredictionRow[]): PredictionRow[] => rows.map(r => ({
      ...r,
      entry_price: num(r.entry_price),
      target_price: num(r.target_price),
      stop_loss: num(r.stop_loss),
      master_score: num(r.master_score),
      telegram_message_id: num(r.telegram_message_id),
      was_published: num(r.was_published),
    }));

    const response: TelegramPredictionsResponse = {
      success: true,
      timestamp: new Date().toISOString(),
      audit_columns_present: hasAudit,
      summary: {
        total,
        published: publishedCount,
        pending: pendingCount,
        pending_today: pendingTodayCount,
        with_message_id: withMessageIdCount,
      },
      published: normalize(published),
      pending_today: normalize(pendingToday),
      message: hasAudit
        ? undefined
        : 'أعمدة التدقيق (was_published / published_at / telegram_message_id) غير موجودة في predictions.db. شغّل /api/telegram/publish-stock مرة واحدة لإضافتها تلقائياً.',
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/admin/telegram-predictions]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
