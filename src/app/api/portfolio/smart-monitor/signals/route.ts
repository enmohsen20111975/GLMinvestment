/**
 * GET /api/portfolio/smart-monitor/signals?ticker=XXX
 * ===================================================
 * MONEY-TIER2.2: REAL per-stock signal.
 *
 * BEFORE: proxied to Python + hardcoded mock for 4 tickers only
 *         (COMI/ABUK/EAST/SWDY). Other tickers got a fake 50→55 position.
 *
 * AFTER:  reads REAL position from portfolio_assets, computes live PnL,
 *         emits evidence-based signal (HOLD/TAKE_PROFIT/STOP_LOSS/BUY_MORE)
 *         with multi-factor reasoning narrative.
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
  try { return fs.existsSync(p) && fs.statSync(p).size > 0; } catch { /* safe-by-design */ return false; }
}

async function tryPythonSignals(ticker: string): Promise<any | null> {
  const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
  try {
    const res = await fetch(`${PY}/api/portfolio/smart-monitor/signals?ticker=${ticker}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.signal) return data;
    }
    return null;
  } catch { /* safe-by-design */ return null; }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').toUpperCase();

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker parameter required' },
      { status: 400 }
    );
  }

  // 1) Try Python first (optional)
  const py = await tryPythonSignals(ticker);
  if (py) return NextResponse.json(py);

  // 2) REAL FALLBACK — read from portfolio_assets + stocks.db
  let userId = searchParams.get('user_id') || undefined;
  if (!userId) {
    try {
      const session = await getSessionUserId();
      userId = session.userId || undefined;
    } catch { /* ignore - safe-by-design */ }
  }
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!dbExists(stocksDbPath)) {
      return NextResponse.json({
        success: false,
        error: 'stocks.db not found',
        ticker,
        signal: 'HOLD',
      });
    }

    const db = await getFinanceDb();

    const asset = db.prepare(
      "SELECT * FROM portfolio_assets WHERE user_id = ? AND type = 'stock' AND UPPER(stock_ticker) = ? ORDER BY id DESC LIMIT 1"
    ).get(userId, ticker) as any;

    if (!asset) {
      return NextResponse.json({
        success: true,
        ticker,
        in_portfolio: false,
        signal: 'WATCH_ONLY',
        signal_badge: '👁️ متابعة فقط',
        signal_color: '#6b7280',
        ai_narrative: 'السهم ليس ضمن محفظتك الحالية. أضفه للمحفظة لتحصل على تحليل مركز متعمّق.',
        updated_at: new Date().toISOString(),
      });
    }

    const qty = Number(asset.quantity || 0);
    const avgBuy = Number(asset.avg_buy_price || 0);
    const invested = Number(asset.total_invested || (qty * avgBuy) || 0);

    let livePrice = 0;
    let stockName = asset.name || '';
    let stockSector = '';
    let changePct = 0;
    let volume = 0;
    try {
      const stockRow = db.prepare(
        "SELECT current_price, previous_close, name, name_ar, sector, change_percent, volume FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1"
      ).get(ticker) as any;
      if (stockRow) {
        if (Number(stockRow.current_price) > 0) livePrice = Number(stockRow.current_price);
        else if (Number(stockRow.previous_close) > 0) livePrice = Number(stockRow.previous_close);
        stockName = stockName || stockRow.name_ar || stockRow.name || ticker;
        stockSector = stockRow.sector || '';
        changePct = Number(stockRow.change_percent || 0);
        volume = Number(stockRow.volume || 0);
      }
    } catch { /* ignore - safe-by-design */ }

    if (livePrice <= 0) {
      try {
        const histRow = db.prepare(
          "SELECT close_price FROM stock_price_history WHERE stock_id = (SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1) ORDER BY date DESC LIMIT 1"
        ).get(ticker) as any;
        if (histRow && Number(histRow.close_price) > 0) livePrice = Number(histRow.close_price);
      } catch { /* ignore - safe-by-design */ }
    }

    if (livePrice <= 0) {
      try {
        const clean = await getLastCleanClose(ticker);
        if (clean.price > 0) livePrice = clean.price;
      } catch { /* ignore - safe-by-design */ }
    }

    if (livePrice <= 0 && avgBuy > 0) livePrice = avgBuy;

    const currentValue = livePrice > 0 && qty > 0 ? livePrice * qty : invested;
    const pnlAmount = currentValue - invested;
    const pnlPct = invested > 0 ? (pnlAmount / invested) * 100 : 0;

    let holdingDays = 0;
    try {
      if (asset.added_at) {
        const added = new Date(String(asset.added_at).replace(' ', 'T'));
        holdingDays = Math.max(0, Math.floor((Date.now() - added.getTime()) / 86400000));
      }
    } catch { /* ignore - safe-by-design */ }

    let subPortfolio = 'المحفظة الافتراضية';
    try {
      if (asset.portfolio_id && asset.portfolio_id !== 'default') {
        const sp = db.prepare(
          "SELECT name FROM portfolios WHERE id = ? OR CAST(id AS TEXT) = ? LIMIT 1"
        ).get(asset.portfolio_id, String(asset.portfolio_id)) as any;
        if (sp?.name) subPortfolio = sp.name;
      }
    } catch { /* ignore - safe-by-design */ }

    // Multi-factor signal generation
    let signalCode = 'HOLD';
    let signalBadge = '⏸️ احتفاظ مستقر';
    let signalColor = '#3b82f6';
    let confidence = 50;
    const reasons: string[] = [];

    if (pnlPct >= 15) {
      signalCode = 'TAKE_PROFIT';
      signalBadge = '✅ حقق ربح الآن';
      signalColor = '#16a34a';
      confidence = 82;
      reasons.push(`السهم حقق ربحاً ${pnlPct.toFixed(1)}% — تأمين جزء من الأرباح (50% من المركز) يقلّل المخاطرة.`);
    } else if (pnlPct >= 5) {
      signalCode = 'BUY_MORE';
      signalBadge = '💰 فرصة زيادة المركز';
      signalColor = '#06b6d4';
      confidence = 68;
      reasons.push(`السهم في مسار صاعد بربح ${pnlPct.toFixed(1)}% — الزيادة الجزئية (Trailing) ممكنة.`);
    } else if (pnlPct <= -10) {
      signalCode = 'STOP_LOSS';
      signalBadge = '🚨 إيقاف خسارة';
      signalColor = '#ef4444';
      confidence = 85;
      reasons.push(`السهم خسران ${Math.abs(pnlPct).toFixed(1)}% — تجاوز حد وقف الخسارة المعتاد (-8%).`);
    } else if (pnlPct <= -3) {
      signalCode = 'HOLD';
      signalBadge = '⚠️ احتفاظ بمراقبة';
      signalColor = '#f59e0b';
      confidence = 60;
      reasons.push(`السهم خسران ${Math.abs(pnlPct).toFixed(1)}% — ضمن تذبذب السوق الطبيعي لكن يستحق مراقبة.`);
    } else {
      reasons.push(`السهم في منطقة متوازنة (${pnlPct.toFixed(1)}%) — لا توجد إشارات قاطعة.`);
    }

    if (changePct <= -5) {
      reasons.push(`⚠️ هبوط حاد اليوم ${changePct.toFixed(1)}% — ممكن إشارة لخبر سلبي في القطاع.`);
      if (signalCode === 'HOLD') {
        signalCode = 'STOP_LOSS';
        signalBadge = '🚨 إيقاف خسارة';
        signalColor = '#ef4444';
        confidence = Math.max(confidence, 78);
      }
    } else if (changePct >= 5) {
      reasons.push(`🚀 صعود قوي اليوم ${changePct.toFixed(1)}% — تأكّد إنه مش خبر مؤقت قبل الزيادة.`);
    }

    if (holdingDays > 180 && pnlPct < 0) {
      reasons.push(`⏰ ممسك السهم ${holdingDays} يوم — ابحث في سبب استمرار الخسارة.`);
    } else if (holdingDays <= 2) {
      reasons.push('⚠️ تحذير تسوية T+2 قائم — الأسهم لسه في فترة التسوية.');
    }

    if (stockSector) {
      reasons.push(`القطاع: ${stockSector} — راجع أداء القطاع ككل.`);
    }

    return NextResponse.json({
      success: true,
      ticker,
      name: stockName,
      sector: stockSector,
      in_portfolio: true,
      signal: signalCode,
      signal_badge: signalBadge,
      signal_color: signalColor,
      confidence,
      pnl_amount: Math.round(pnlAmount * 100) / 100,
      pnl_percent: Math.round(pnlPct * 100) / 100,
      sub_portfolio: subPortfolio,
      buy_price: Math.round(avgBuy * 100) / 100,
      current_price: Math.round(livePrice * 100) / 100,
      quantity: qty,
      invested_amount: Math.round(invested * 100) / 100,
      current_value: Math.round(currentValue * 100) / 100,
      holding_days: holdingDays,
      today_change_pct: Math.round(changePct * 100) / 100,
      today_volume: volume,
      position_warning: holdingDays <= 2 ? '⚠️ تحذير تسوية T+2 قائم' : null,
      ai_narrative: reasons.join(' '),
      disclaimer: '⚠️ إشارة آلية — ليست نصيحة استثمارية مرخصة. راجع Fundamentals قبل أي قرار.',
      source: 'sqlite_fallback',
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[/api/portfolio/smart-monitor/signals] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        ticker,
        signal: 'HOLD',
        ai_narrative: 'تعذّر تحليل السهم. حاول لاحقاً.',
      },
      { status: 500 }
    );
  }
}
