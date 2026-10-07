import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { applyValidatedTargets } from '@/lib/targets-validator';
import Database from 'better-sqlite3';
import path from 'path';

/**
 * GET /api/ads/successful-trades?limit=10
 *
 * بيرجّع الصفقات الناجحة الحقيقية من الـ DB (predictions table)
 * — الصفقات اللي actual_return > 0 أو hit_target = 1.
 *
 * بيستخدم في ContentStudioHub → TradesShowcase.
 */

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50);

    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    const db = new Database(dbPath, { readonly: true });

    // نجاوب الصفقات الناجحة (actual_return > 0 أو hit_target = 1)
    const trades = db.prepare(`
      SELECT
        id, ticker, signal, signal_type, prediction_date,
        entry_price, target_price, target_price_2, stop_loss,
        confidence, market, outcome_date, exit_price, actual_return,
        exit_reason, hit_target, hit_stop, is_correct, holding_days,
        risk_reward
      FROM predictions
      WHERE (actual_return IS NOT NULL AND actual_return > 0)
         OR hit_target = 1
      ORDER BY actual_return DESC, prediction_date DESC
      LIMIT ?
    `).all(limit) as any[];

    db.close();

    // validate targets + تنسيق
    // FIX-P4-TARGETS: signal-aware — t.signal بيحدد اتجاه الـ validation.
    // FIX-P4-TARGETS: ما بـ نعملش `?? t.X` fallback للقيمة الأصلية المكسورة.
    //   بنستخدم القيم المُتحقَّق منها مباشرة. لو الـ validator رجّع null، بـ ينتقل
    //   زي ما هو (الأصل كان `?? 0` بـ يخبي الـ broken data).
    const validatedTrades = trades.map((t) => {
      const v = applyValidatedTargets({
        signal: t.signal || 'BUY',
        entry_price: t.entry_price,
        target1: t.target_price,
        target2: t.target_price_2,
        stop_loss: t.stop_loss,
        risk_reward_ratio: t.risk_reward,
      });

      const returnPct = t.actual_return != null
        ? Number(t.actual_return)
        : t.exit_price && t.entry_price
          ? ((Number(t.exit_price) - Number(t.entry_price)) / Number(t.entry_price)) * 100
          : 0;

      return {
        id: t.id,
        ticker: t.ticker,
        signal: t.signal || '',
        entryPrice: v.entry_price,
        exitPrice: Number(t.exit_price) || 0,
        targetPrice: v.target1,
        stopLoss: v.stop_loss,
        returnPct: Number(returnPct.toFixed(2)),
        confidence: t.confidence || 0,
        market: t.market || 'EGX',
        predictionDate: t.prediction_date,
        outcomeDate: t.outcome_date,
        holdingDays: t.holding_days || 0,
        riskReward: v.risk_reward_ratio ?? 0,
        exitReason: t.exit_reason || '',
        hitTarget: t.hit_target === 1,
      };
    });

    return NextResponse.json({
      success: true,
      trades: validatedTrades,
      count: validatedTrades.length,
    });
  } catch (err: any) {
    console.error('[ads/successful-trades] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل جلب الصفقات الناجحة', trades: [] },
      { status: 500 },
    );
  }
}
