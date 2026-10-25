import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";
export const runtime = 'nodejs';

/**
 * /api/stock-state/[ticker]
 *
 * Returns the canonical stock state + timeline from radar_signal_tracking.
 * This is the SINGLE SOURCE OF TRUTH for stock state.
 *
 * Phase 5 of Liquidity Radar development.
 */

// Next.js 16 requires params to be awaited in dynamic routes
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await context.params;
  const ticker = rawTicker?.toUpperCase().replace('.CA', '');
  if (!ticker) {
    return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });
  }

  const path = require('path');
  const fs = require('fs');
  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');

  if (!fs.existsSync(stocksDbPath)) {
    return NextResponse.json({ success: false, error: 'stocks.db not found' }, { status: 500 });
  }

  const Database = require('better-sqlite3');
  const db = new Database(stocksDbPath, { readonly: true });

  try {
    // Get latest state
    const latest = db.prepare(`
      SELECT ticker, signal_date, canonical_state, prev_state, transition_type,
             days_in_state, confidence, direction_up, direction_down,
             data_freshness, evidence_json, invalidation_json
      FROM radar_signal_tracking
      WHERE ticker = ? AND canonical_state != ''
      ORDER BY signal_date DESC LIMIT 1
    `).get(ticker);

    if (!latest) {
      return NextResponse.json({
        success: false,
        error: 'No state assessment found for ' + ticker,
        ticker,
      }, { status: 404 });
    }

    // Get timeline (last 30 days)
    const timeline = db.prepare(`
      SELECT signal_date, canonical_state, prev_state, transition_type,
             days_in_state, confidence, direction_up, direction_down,
             data_freshness
      FROM radar_signal_tracking
      WHERE ticker = ? AND canonical_state != ''
      ORDER BY signal_date DESC LIMIT 30
    `).all(ticker);

    // Parse evidence
    let evidence = null;
    try {
      if (latest.evidence_json) {
        evidence = JSON.parse(latest.evidence_json);
      }
    } catch {}

    // Parse invalidation
    let invalidation: string[] = [];
    try {
      if (latest.invalidation_json) {
        invalidation = JSON.parse(latest.invalidation_json);
      }
    } catch {}

    // State labels
    const STATE_AR: Record<string, string> = {
      'ACCUMULATION': 'تجميع محتمل',
      'UPTREND': 'اتجاه صاعد',
      'CORRECTION_HEALTHY': 'تصحيح صحي',
      'DISTRIBUTION': 'توزيع محتمل',
      'DOWNTREND': 'اتجاه هابط',
      'RECOVERY': 'تعافٍ محتمل',
      'STATE_UNCONFIRMED': 'حالة غير محسومة',
      'DATA_STALE': 'بيانات قديمة',
      'DATA_INCOMPLETE': 'بيانات ناقصة',
    };

    db.close();

    return NextResponse.json({
      success: true,
      ticker,
      state: {
        current: latest.canonical_state,
        label_ar: STATE_AR[latest.canonical_state] || latest.canonical_state,
        confidence: latest.confidence,
        direction: {
          up: latest.direction_up,
          down: latest.direction_down,
        },
        days_in_state: latest.days_in_state,
        transition: latest.transition_type,
        prev_state: latest.prev_state,
        data_freshness: latest.data_freshness,
        evidence: evidence,
        invalidation_conditions: invalidation,
        assessment_date: latest.signal_date,
      },
      timeline: timeline.map((t: any) => ({
        date: t.signal_date,
        state: t.canonical_state,
        label_ar: STATE_AR[t.canonical_state] || t.canonical_state,
        prev_state: t.prev_state,
        transition: t.transition_type,
        days_in_state: t.days_in_state,
        confidence: t.confidence,
        direction_up: t.direction_up,
        direction_down: t.direction_down,
        data_freshness: t.data_freshness,
      })),
    });
  } catch (e) {
    db.close();
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch stock state',
      message: String(e),
    }, { status: 500 });
  }
}
