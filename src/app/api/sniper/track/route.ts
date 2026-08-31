import { NextRequest, NextResponse } from 'next/server';
import { openDb } from '@/lib/shared-db';

export const revalidate = 30; // Cache for 30s

// Arabic signal translations
const SIGNAL_AR: Record<string, string> = {
  'STRONG_BUY': 'شراء قوي',
  'BUY': 'شراء',
  'HOLD': 'انتظار',
  'REDUCE': 'تخفيض',
  'SELL': 'بيع',
  'STRONG_SELL': 'بيع قوي',
  'ACCUMULATE': 'تجميع',
};

export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ticker = searchParams.get('ticker');
    const market = searchParams.get('market') || 'EGX';

    // Also accept JSON body
    let bodyTicker = ticker;
    let bodyMarket = market;
    try {
      const body = await request.json();
      if (body.ticker) bodyTicker = body.ticker;
      if (body.market) bodyMarket = body.market;
    } catch {
      // No JSON body, use query params
    }

    if (!bodyTicker) {
      return NextResponse.json({
        success: false,
        error: 'ticker is required (query param or JSON body)',
      }, { status: 400 });
    }

    const predDb = openDb('predictions.db');

    // Insert a new prediction into predictions with basic tracking data
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const result = predDb.prepare(`
      INSERT INTO predictions (
        ticker, signal, signal_type, confidence, master_score,
        entry_price, target_price, stop_loss, risk_reward,
        market, status, prediction_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bodyTicker.toUpperCase(),
      'HOLD',        // signal — will be updated by the Python backend
      'HOLD',        // signal_type — will be updated by the Python backend
      50,            // Default confidence
      50,            // Default master score
      0,             // entry_price — to be filled
      0,             // target_price — to be filled
      0,             // stop_loss — to be filled
      0,             // risk_reward
      bodyMarket,
      'PENDING',
      today,
      now
    );

    const newId = result.lastInsertRowid;

    predDb.close();

    return NextResponse.json({
      success: true,
      prediction_id: newId,
      ticker: bodyTicker.toUpperCase(),
      market: bodyMarket,
      message: 'Prediction tracking started — Python backend will fill in analysis data',
      timestamp: now,
    });
  } catch (error) {
    console.error('[sniper/track] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
