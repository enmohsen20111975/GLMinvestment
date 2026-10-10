export const dynamic = 'force-dynamic';
import { NextResponse, NextRequest } from 'next/server';
// P0-11-AUTH fix (2026-09-27): added user auth guard — returns pending
// trading predictions (signal/entry/target/stop). Was open to anyone.
import { requireAuthAsync } from '@/lib/admin-guard';
import { openDb, safeQuery } from '@/lib/shared-db';

export const revalidate = 30; // Cache for 30s

export async function GET(req: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): user auth guard (trading signals)
  const auth = await requireAuthAsync(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const predDb = openDb('predictions.db');

    // Get pending predictions from predictions table
    const predictions = safeQuery<any>(
      predDb,
      `      SELECT
        id, ticker, signal, signal_type, confidence, master_score,
        entry_price, target_price, stop_loss,
        prediction_date, status, created_at
      FROM predictions
      WHERE status = 'PENDING' OR status IS NULL OR status = ''
      ORDER BY prediction_date DESC
      LIMIT 50`
    );

    predDb.close();

    return NextResponse.json({
      success: true,
      count: predictions.length,
      predictions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[sniper/closer/pending] Error:', error);
    return NextResponse.json({
      success: false,
      count: 0,
      predictions: [],
      error: 'internal_error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
