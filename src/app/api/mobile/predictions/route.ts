/**
 * GET /api/mobile/predictions
 * ==========================
 * Mobile predictions list — falls back to predictions.db when Python is down.
 * Returns latest 50 predictions: ticker, signal, status, entry/target/stop, etc.
 */

import { NextRequest, NextResponse } from 'next/server';
import { applyValidatedTargets } from '@/lib/targets-validator';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || '50', 10) || 50,
    200
  );

  // 1) Try Python first
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/daily/rebuild-predictions${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      // FIX-P4-TARGETS: signal-aware validation على الـ Python predictions.
      // الـ Python ما عندوش validator مكافئ، فالـ targets بتدخل raw.
      if (data && Array.isArray(data.predictions)) {
        data.predictions = data.predictions.map((p: any) => {
          const v = applyValidatedTargets({
            signal: p.signal || p.signal_type || 'BUY',
            entry_price: p.entry_price,
            target1: p.target_price,
            stop_loss: p.stop_loss,
            risk_reward_ratio: p.risk_reward,
          });
          return {
            ...p,
            signal: p.signal,
            entry_price: v.entry_price,
            target_price: v.target1,
            stop_loss: v.stop_loss,
            risk_reward: v.risk_reward_ratio,
          };
        });
        data.count = data.predictions.length;
      }
      return NextResponse.json(data);
    }
  } catch { /* safe-by-design */ }

  // 2) Fallback — predictions.db
  try {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(predDbPath)) {
      // FIX (FLUTTER-PROD-5): return 200 + empty array بدل 500
      return NextResponse.json({
        success: true,
        source: 'unavailable',
        market,
        count: 0,
        predictions: [],
        message: 'قاعدة بيانات التوقعات غير متاحة حالياً',
      }, { status: 200 });
    }
    const pdb = new Database(predDbPath, { readonly: true });

    const rows: any[] = pdb
      .prepare(
        `SELECT ticker, signal, signal_type, prediction_date, entry_price,
                target_price, stop_loss, exit_price, actual_return, holding_days,
                master_score, confidence, status, market, persona, risk_reward,
                hit_target, hit_stop, is_correct
         FROM predictions
         WHERE market = ? COLLATE NOCASE
         ORDER BY prediction_date DESC, id DESC
         LIMIT ?`
      )
      .all(market, limit)
      .map((r: any) => ({
        ticker: r.ticker,
        signal: r.signal,
        signal_type: r.signal_type,
        prediction_date: r.prediction_date,
        entry_price: Number(r.entry_price),
        target_price: r.target_price != null ? Number(r.target_price) : null,
        stop_loss: r.stop_loss != null ? Number(r.stop_loss) : null,
        exit_price: r.exit_price != null ? Number(r.exit_price) : null,
        actual_return: r.actual_return != null ? Number(r.actual_return) : null,
        holding_days: r.holding_days || 0,
        master_score: r.master_score != null ? Number(r.master_score) : null,
        confidence: r.confidence != null ? Number(r.confidence) : null,
        status: r.status,
        market: r.market,
        persona: r.persona,
        risk_reward: r.risk_reward != null ? Number(r.risk_reward) : null,
        hit_target: r.hit_target === 1,
        hit_stop: r.hit_stop === 1,
        is_correct: r.is_correct === 1,
      }));

    pdb.close();

    // FIX-P4-TARGETS: signal-aware validation قبل ما نرجّع الـ response.
    // الـ mobile users بيشوفوا نفس الـ targets المكسورة لو ما validatedناش.
    // الـ signal بـ يحدد اتجاه الـ validation:
    //   BUY  → stop<entry, target>entry
    //   SELL → stop>entry, target<entry
    const validatedRows = rows.map((p: any) => {
      const v = applyValidatedTargets({
        signal: p.signal || p.signal_type || 'BUY',
        entry_price: p.entry_price,
        target1: p.target_price,
        stop_loss: p.stop_loss,
        risk_reward_ratio: p.risk_reward,
      });
      return {
        ...p,
        entry_price: v.entry_price,
        target_price: v.target1,
        stop_loss: v.stop_loss,
        risk_reward: v.risk_reward_ratio,
      };
    });

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      predictions: validatedRows,
      count: validatedRows.length,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[mobile:predictions]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
