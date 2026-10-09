import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

/**
 * GET /api/maker-radar/market-intelligence?ticker=COMI
 *
 * "خريطة الكنوز" — بيحلّل بيانات السوق المتاحة ويرجع:
 *   1. Opening Auction (مزاد الافتتاح)
 *   2. Closing Auction (مزاد الإغلاق)
 *   3. Volume Profile (بصمة السيولة)
 *   4. Intraday Momentum (زخم لحظي + buy/sell pressure)
 *   5. Price History Summary (ملخص 30 يوم)
 *   6. Fundamentals Intelligence (من 9 جداول)
 *   7. Intelligence Summary (استنتاجات آلية)
 */

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
    if (!ticker) return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });

    const result: any = { success: true, ticker, sections: {} };

    // ═══ 1. INTRADAY ═══
    try {
      const dbPath = path.join(process.cwd(), 'db', 'intraday.db');
      const db = new Database(dbPath, { readonly: true });
      const latest = db.prepare('SELECT MAX(DATE(timestamp)) as d FROM stock_intraday WHERE ticker = ?').get(ticker);

      if (latest?.d) {
        const date = latest.d;
        const allTicks = db.prepare('SELECT price, volume, timestamp FROM stock_intraday WHERE ticker = ? AND DATE(timestamp) = ? ORDER BY timestamp ASC').all(ticker, date);

        if (allTicks.length > 0) {
          const first = allTicks[0], last = allTicks[allTicks.length - 1];
          const change = first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0;
          const totalVol = allTicks.reduce((s, t) => s + (t.volume || 0), 0);
          const maxP = Math.max(...allTicks.map(t => t.price));
          const minP = Math.min(...allTicks.map(t => t.price).filter(p => p > 0));

          // buy/sell pressure
          let buy = 0, sell = 0;
          for (let i = 1; i < allTicks.length; i++) {
            const v = allTicks[i].volume || 0;
            if (allTicks[i].price >= allTicks[i-1].price) buy += v; else sell += v;
          }
          const buyPct = totalVol > 0 ? (buy / totalVol) * 100 : 50;

          // opening (10:00-10:15)
          const openTicks = allTicks.filter(t => { const h = t.timestamp.substring(11, 16); return h >= '10:00' && h < '10:15'; });
          // closing (14:15-14:30)
          const closeTicks = allTicks.filter(t => { const h = t.timestamp.substring(11, 16); return h >= '14:15' && h <= '14:30'; });

          // volume profile (top 5 price levels)
          const vpMap: Record<string, number> = {};
          allTicks.forEach(t => {
            if (t.volume > 0) {
              const k = t.price.toFixed(1);
              vpMap[k] = (vpMap[k] || 0) + t.volume;
            }
          });
          const vp = Object.entries(vpMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([price, vol]) => ({ price: parseFloat(price), volume: vol }));

          result.sections.intraday = {
            date,
            ticks: allTicks.length,
            firstPrice: first.price?.toFixed(2),
            lastPrice: last.price?.toFixed(2),
            change: change.toFixed(2) + '%',
            totalVolume: totalVol,
            maxPrice: maxP?.toFixed(2),
            minPrice: minP?.toFixed(2),
            buyPressure: buyPct.toFixed(1) + '%',
            sellPressure: (100 - buyPct).toFixed(1) + '%',
            sentiment: buyPct > 60 ? '🟢 ضغط شراء' : buyPct < 40 ? '🔴 ضغط بيع' : '🟡 متوازن',
            opening: openTicks.length > 0 ? {
              ticks: openTicks.length,
              volume: openTicks.reduce((s, t) => s + (t.volume || 0), 0),
              avgPrice: (openTicks.reduce((s, t) => s + t.price, 0) / openTicks.length).toFixed(2),
              direction: openTicks[openTicks.length - 1].price > openTicks[0].price ? '🟢 صعود' : '🔴 هبوط',
            } : null,
            closing: closeTicks.length > 0 ? {
              ticks: closeTicks.length,
              volume: closeTicks.reduce((s, t) => s + (t.volume || 0), 0),
              avgPrice: (closeTicks.reduce((s, t) => s + t.price, 0) / closeTicks.length).toFixed(2),
              direction: closeTicks[closeTicks.length - 1].price > closeTicks[0].price ? '🟢 صعود' : '🔴 هبوط',
            } : null,
            volumeProfile: vp,
          };
        }
      }
      db.close();
    } catch { /* safe-by-design */ result.sections.intraday = { error: 'intraday.db not available' }; }

    // ═══ 2. FUNDAMENTALS ═══
    try {
      const dbPath = path.join(process.cwd(), 'db', 'data_engine.db');
      const db = new Database(dbPath, { readonly: true });

      // البحث بـ LIKE لأن الرموز في data_engine.db بتكون زي "COMIالبنك" (ticker + اسم عربي)
      const likePattern = `%${ticker}%`;
      const val = db.prepare('SELECT * FROM tab_valuation WHERE symbol LIKE ? OR symbol LIKE ? OR symbol = ? OR symbol = ? LIMIT 1').get(likePattern, ticker, ticker.toUpperCase(), ticker);
      const perf = db.prepare('SELECT * FROM tab_performance WHERE symbol LIKE ? OR symbol LIKE ? OR symbol = ? OR symbol = ? LIMIT 1').get(likePattern, ticker, ticker.toUpperCase(), ticker);
      const prof = db.prepare('SELECT * FROM tab_profitability WHERE symbol LIKE ? OR symbol LIKE ? OR symbol = ? OR symbol = ? LIMIT 1').get(likePattern, ticker, ticker.toUpperCase(), ticker);

      result.sections.fundamentals = {
        valuation: val ? { pe: val.pe_ratio, pb: val.pb_ratio, ps: val.ps_ratio, peg: val.peg_ratio, marketCap: val.market_cap, ev: val.ev } : null,
        performance: perf ? { perf1w: perf.perf_1w, perf1m: perf.perf_1m, perf3m: perf.perf_3m, perf6m: perf.perf_6m, perf1y: perf.perf_1y, volatility: perf.volatility_1m } : null,
        profitability: prof ? { roe: prof.roe, roa: prof.roa, netMargin: prof.net_margin } : null,
      };

      // ═══ 3. INTELLIGENCE ═══
      const signals: string[] = [];
      if (val) {
        const pe = parseFloat(val.pe_ratio);
        const pb = parseFloat(val.pb_ratio);
        if (!isNaN(pe) && pe > 0 && pe < 15) signals.push(`✅ P/E منخفض (${pe}) — سهم مُقوّم بأقل من قيمته`);
        else if (!isNaN(pe) && pe > 30) signals.push(`⚠️ P/E مرتفع (${pe}) — مُقوّم بأعلى من قيمته`);
        if (!isNaN(pb) && pb > 0 && pb < 1) signals.push(`✅ P/B أقل من 1 (${pb}) — يتداول بأقل من قيمته الدفترية`);
      }
      if (perf) {
        const p1m = parseFloat(perf.perf_1m);
        const p3m = parseFloat(perf.perf_3m);
        if (!isNaN(p1m) && p1m > 10) signals.push(`🚀 أداء شهر قوي (+${p1m}%)`);
        if (!isNaN(p3m) && p3m > 20) signals.push(`🚀 أداء 3 شهور قوي (+${p3m}%)`);
        if (!isNaN(p3m) && p3m < -15) signals.push(`🔴 تراجع 3 شهور (${p3m}%) — فرصة ارتداد؟`);
      }
      if (prof) {
        const roe = parseFloat(prof.roe || '0');
        if (roe > 20) signals.push(`✅ ROE ممتاز (${roe}%)`);
      }

      result.sections.intelligence = {
        signals,
        summary: signals.length > 0 ? signals.join(' | ') : 'مفيش إشارات واضحة من fundamentals',
        signalCount: signals.length,
      };
      db.close();
    } catch { /* safe-by-design */ result.sections.fundamentals = { error: 'data_engine.db not available' }; }

    // ═══ 4. PRICE HISTORY ═══
    try {
      const dbPath = path.join(process.cwd(), 'db', 'price_history.db');
      const db = new Database(dbPath, { readonly: true });
      const last30 = db.prepare('SELECT date, close_price, volume FROM price_history WHERE ticker = ? AND close_price > 0 ORDER BY date DESC LIMIT 30').all(ticker);

      if (last30.length > 0) {
        const prices = last30.map(r => r.close_price).reverse();
        const avgVol = last30.reduce((s, r) => s + r.volume, 0) / last30.length;
        const maxP = Math.max(...prices), minP = Math.min(...prices);
        const last = prices[prices.length - 1], first = prices[0];
        const ret = first > 0 ? ((last - first) / first) * 100 : 0;
        const range = minP > 0 ? ((maxP - minP) / minP) * 100 : 0;
        const posInRange = maxP > minP ? ((last - minP) / (maxP - minP) * 100).toFixed(0) : '—';

        result.sections.priceHistory = {
          days: last30.length,
          lastPrice: last.toFixed(2),
          return30d: ret.toFixed(2) + '%',
          range: `${minP.toFixed(2)} - ${maxP.toFixed(2)}`,
          rangePct: range.toFixed(1) + '%',
          avgVolume: Math.round(avgVol),
          positionInRange: posInRange + '%',
          nearestSupport: minP.toFixed(2),
          nearestResistance: maxP.toFixed(2),
        };
      }
      db.close();
    } catch { /* safe-by-design */ result.sections.priceHistory = { error: 'price_history.db not available' }; }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'error' }, { status: 500 });
  }
}
