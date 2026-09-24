export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { openDb, safeQuery } from '@/lib/shared-db';

export const revalidate = 30; // Cache for 30s

export async function GET() {
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
      error: String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
