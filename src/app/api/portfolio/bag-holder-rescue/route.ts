/**
 * GET /api/portfolio/bag-holder-rescue
 * =====================================
 * MONEY-TIER1.4: REAL bag-holder rescue analysis.
 *
 * BEFORE: proxied to Python :8010 + returned 503 (fetch failed) on Python down.
 *
 * AFTER:  reads REAL losing positions from portfolio_assets, cross-references
 *         stock's 52w high/low from stock_price_history, and produces a
 *         Hold / Average-Down / Cut-Loss recommendation based on drawdown
 *         depth + holding period. NEVER 503.
 *
 * Query params:
 *   ticker   — optional, analyze a specific ticker (else auto-pick worst loser)
 *   user_id  — optional, override session user (mobile/admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { getLastCleanClose } from '@/lib/data-engine-db-sqljs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

function dbExists(p: string): boolean {
  try { return fs.existsSync(p) && fs.statSync(p).size > 0; } catch { return false; }
}

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

async function tryPythonRescue(ticker: string | null, userId: string | undefined): Promise<any | null> {
  try {
    const params = new URLSearchParams();
    if (ticker) params.set('ticker', ticker);
    if (userId) params.set('user_id', userId);
    const url = `${PY}/api/portfolio/bag-holder-rescue${params.toString() ? `?${params}` : ''}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' as RequestCache });
    if (res.ok) {
      const data = await res.json();
      if (data.success !== false && (data.recommendation || data.signal)) return data;
    }
    return null;
  } catch { return null; }
}

function fetchStockRange(db: any, ticker: string): { high52: number; low52: number; firstDate: string | null } {
  try {
    const row = db.prepare(`
      SELECT MAX(high_price) AS h52, MIN(low_price) AS l52, MIN(date) AS first_date
      FROM stock_price_history
      WHERE stock_id = (SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1)
        AND date >= date('now', '-365 days')
    `).get(ticker) as any;
    return {
      high52: Number(row?.h52 || 0),
      low52: Number(row?.l52 || 0),
      firstDate: row?.first_date || null,
    };
  } catch {
    return { high52: 0, low52: 0, firstDate: null };
  }
}

async function fetchLivePrice(db: any, ticker: string): Promise<{ price: number; name: string; sector: string }> {
  let price = 0;
  let name = '';
  let sector = '';
  try {
    const stockRow = db.prepare(
      "SELECT current_price, previous_close, name, name_ar, sector FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1"
    ).get(ticker) as any;
    if (stockRow) {
      if (Number(stockRow.current_price) > 0) price = Number(stockRow.current_price);
      else if (Number(stockRow.previous_close) > 0) price = Number(stockRow.previous_close);
      name = stockRow.name_ar || stockRow.name || ticker;
      sector = stockRow.sector || '';
    }
  } catch { /* ignore */ }

  if (price <= 0) {
    try {
      const histRow = db.prepare(
        "SELECT close_price FROM stock_price_history WHERE stock_id = (SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1) ORDER BY date DESC LIMIT 1"
      ).get(ticker) as any;
      if (histRow && Number(histRow.close_price) > 0) price = Number(histRow.close_price);
    } catch { /* ignore */ }
  }

  if (price <= 0) {
    try {
      const clean = await getLastCleanClose(ticker);
      if (clean.price > 0) price = clean.price;
    } catch { /* ignore */ }
  }

  return { price, name, sector };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tickerParam = url.searchParams.get('ticker');
    let userId: string | undefined = url.searchParams.get('user_id') || undefined;
    if (!userId) {
      try {
        const session = await getSessionUserId();
        userId = session.userId || undefined;
      } catch { /* ignore */ }
    }
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // 1) Try Python first (optional — richer analysis when alive)
    const py = await tryPythonRescue(tickerParam, userId);
    if (py) return NextResponse.json(py, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    });

    // 2) REAL FALLBACK — read from portfolio_assets (stocks.db)
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!dbExists(stocksDbPath)) {
      return NextResponse.json({
        success: false,
        error: 'stocks.db not found',
        source: 'sqlite_fallback',
      });
    }

    const db = await getFinanceDb();

    const stockAssets = db.prepare(
      "SELECT * FROM portfolio_assets WHERE user_id = ? AND type = 'stock' AND stock_ticker IS NOT NULL AND stock_ticker != '' ORDER BY id DESC"
    ).all(userId) as any[];

    if (stockAssets.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'لا توجد أسهم في محفظتك حالياً. أضف أسهماً لاستخدام محرك الإنقاذ.',
        source: 'sqlite_fallback',
      });
    }

    // Build enriched positions with live PnL
    const positions: any[] = [];
    for (const asset of stockAssets) {
      const ticker = String(asset.stock_ticker);
      const qty = Number(asset.quantity || 0);
      const avgBuy = Number(asset.avg_buy_price || 0);
      const invested = Number(asset.total_invested || (qty * avgBuy) || 0);
      const { price: livePrice, name, sector } = await fetchLivePrice(db, ticker);
      const current = livePrice > 0 && qty > 0 ? livePrice * qty : invested;
      const pnlAmount = current - invested;
      const pnlPct = invested > 0 ? (pnlAmount / invested) * 100 : 0;
      const { high52, low52, firstDate } = fetchStockRange(db, ticker);
      let holdingDays = 0;
      try {
        if (asset.added_at) {
          const added = new Date(String(asset.added_at).replace(' ', 'T'));
          holdingDays = Math.max(0, Math.floor((Date.now() - added.getTime()) / 86400000));
        }
      } catch { /* ignore */ }

      positions.push({
        ticker,
        name,
        sector,
        quantity: qty,
        avg_buy_price: avgBuy,
        current_price: livePrice,
        invested_amount: invested,
        current_value: current,
        pnl_amount: pnlAmount,
        pnl_percent: pnlPct,
        holding_days: holdingDays,
        high_52w: high52,
        low_52w: low52,
        portfolio_id: asset.portfolio_id || 'default',
      });
    }

    // Pick target: explicit ticker, else worst loser
    let target = positions[0];
    if (tickerParam) {
      const found = positions.find(p => p.ticker.toUpperCase() === tickerParam.toUpperCase());
      if (found) target = found;
    } else {
      target = positions.reduce((worst, p) => p.pnl_percent < worst.pnl_percent ? p : worst, positions[0]);
    }

    // Generate recommendation based on drawdown depth + holding period
    const pnlPct = target.pnl_percent;
    const holdingDays = target.holding_days;
    const drawdownFromHigh = target.high_52w > 0 && target.current_price > 0
      ? ((target.current_price - target.high_52w) / target.high_52w) * 100
      : 0;

    let recommendation = 'HOLD';
    let recommendationAr = '⏸️ احتفاظ';
    let recommendationColor = '#3b82f6';
    let confidence = 50;
    let reasoning = '';

    if (pnlPct <= -20) {
      recommendation = 'CUT_LOSS';
      recommendationAr = '🚨 اقفل المركز';
      recommendationColor = '#ef4444';
      confidence = 88;
      reasoning = `السهم خسران ${Math.abs(pnlPct).toFixed(1)}% من قيمة الشراء. `;
      if (drawdownFromHigh < -50) {
        reasoning += `وهو تحت مستوى ${Math.abs(drawdownFromHigh).toFixed(0)}% من أعلى 52 أسبوع. `;
      }
      reasoning += `استمرار الهبوط ممكن يكبّدك خسائر أكبر. `;
      reasoning += holdingDays > 90
        ? `السهم معاك ${holdingDays} يوم — فرصة استرداد رأس المال لاستثمارات أحسن.`
        : `السهم معاك ${holdingDays} يوم — الخسارة لسه قابلة للتحسّن لو Fundamentals قوية.`;
    } else if (pnlPct <= -10) {
      recommendation = 'AVERAGE_DOWN';
      recommendationAr = '📉 متوسط التكلفة';
      recommendationColor = '#f59e0b';
      confidence = 65;
      reasoning = `السهم خسران ${Math.abs(pnlPct).toFixed(1)}%. `;
      if (target.low_52w > 0 && target.current_price <= target.low_52w * 1.1) {
        reasoning += `السهم قريب من القاع التاريخي (${target.low_52w}). `;
      }
      reasoning += `لو Fundamentals الشركة قوية، تقليل متوسط التكلفة (DCA) ممكن يسرّع التعافي. `;
      reasoning += `لكن لا تستثمر أكثر من 10% من رأس المال المتبقي في مركز واحد خسران.`;
    } else if (pnlPct <= -3) {
      recommendation = 'HOLD';
      recommendationAr = '⏸️ احتفاظ + مراقبة';
      recommendationColor = '#3b82f6';
      confidence = 72;
      reasoning = `السهم خسران ${Math.abs(pnlPct).toFixed(1)}% — ضمن النطاق الطبيعي لتذبذب السوق. `;
      reasoning += `لا حاجة لقرار متسرّع. راجع Fundamentals الشركة وأخبار القطاع قبل اتخاذ أي قرار.`;
    } else {
      recommendation = 'HOLD';
      recommendationAr = '✅ مركز سليم';
      recommendationColor = '#16a34a';
      confidence = 80;
      reasoning = `السهم ${pnlPct >= 0 ? 'رابح' : 'بخسارة طفيفة'} ${Math.abs(pnlPct).toFixed(1)}%. `;
      reasoning += `لا حاجة لإنقاذ — المركز في وضع جيد. `;
      if (pnlPct >= 15) {
        reasoning += `فكّر في تأمين جزء من الأرباح (Partial Take-Profit).`;
      }
    }

    const disclaimer = '⚠️ هذه إشارة آلية مبنية على بيانات تاريخية. ليست نصيحة استثمارية مرخصة. استشر مستشاراً مالياً مرخّصاً قبل أي قرار.';

    return NextResponse.json({
      success: true,
      ticker: target.ticker,
      name: target.name,
      sector: target.sector,
      recommendation,
      recommendation_ar: recommendationAr,
      recommendation_color: recommendationColor,
      confidence,
      reasoning,
      position: {
        quantity: target.quantity,
        avg_buy_price: Math.round(target.avg_buy_price * 100) / 100,
        current_price: Math.round(target.current_price * 100) / 100,
        invested_amount: Math.round(target.invested_amount * 100) / 100,
        current_value: Math.round(target.current_value * 100) / 100,
        pnl_amount: Math.round(target.pnl_amount * 100) / 100,
        pnl_percent: Math.round(target.pnl_percent * 100) / 100,
        holding_days: target.holding_days,
      },
      historical: {
        high_52w: Math.round(target.high_52w * 100) / 100,
        low_52w: Math.round(target.low_52w * 100) / 100,
        drawdown_from_high_pct: Math.round(drawdownFromHigh * 100) / 100,
      },
      all_losers: positions
        .filter(p => p.pnl_percent < 0)
        .sort((a, b) => a.pnl_percent - b.pnl_percent)
        .map(p => ({
          ticker: p.ticker,
          name: p.name,
          pnl_percent: Math.round(p.pnl_percent * 100) / 100,
          pnl_amount: Math.round(p.pnl_amount * 100) / 100,
          current_price: Math.round(p.current_price * 100) / 100,
        })),
      disclaimer,
      source: 'sqlite_fallback',
      generated_at: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    });
  } catch (e) {
    console.error('[GET /api/portfolio/bag-holder-rescue] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        recommendation: 'HOLD',
        reasoning: 'تعذّر تحليل المحفظة. حاول لاحقاً.',
      },
      { status: 500 }
    );
  }
}
