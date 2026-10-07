import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import Database from 'better-sqlite3';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { readExitRadarCache } from '@/modules/radar/lib/radar-cache';

export const dynamic = 'force-dynamic';

// Exit Radar path labels (Arabic) + actionable advice per path.
// Used to override the stock's advice when an exit signal is detected on a
// stock the user owns or watches. This is the bridge between Task 2 (Exit
// Radar → Portfolio) and Task 5 (Alerts = decisions, not just prices).
const EXIT_RADAR_PATH_INFO: Record<string, { label_ar: string; advice_action_ar: string; severity: 'critical' | 'warning' | 'caution' }> = {
  X1_distribution_strong: {
    label_ar: 'توزيع قوي (بيع مؤسسي)',
    advice_action_ar: 'السهم فيه بيع مؤسسي قوي — يُنصح ببيع 50-75% من الكمية فورًا والحفاظ على الباقي بوقف متحرك ضيق.',
    severity: 'critical',
  },
  X2_volume_divergence: {
    label_ar: 'تباعد حجمي (صعود بدون حجم)',
    advice_action_ar: 'السعر بيصعد بس الحجم ضعيف — صعود وهمي. خد ربح جزئي 30% وراقب الحجم بكرة.',
    severity: 'warning',
  },
  X3_resistance_rejection: {
    label_ar: 'رفض عند مقاومة',
    advice_action_ar: 'السهم اصطدم بمقاومة ورفض — حط وقف تحت شمعة النهارده وانتظر اختراق صحيح.',
    severity: 'caution',
  },
  X4_exhaustion_gap: {
    label_ar: 'فجوة إرهاق',
    advice_action_ar: 'بعد صعود طويل طلعت فجوة إرهاق — غالبًا السهم بيتعب. بيع 40% من الكمية احتياط.',
    severity: 'warning',
  },
  X5_kill_switch_triggered: {
    label_ar: 'Kill Switch (توزيع قاتل)',
    advice_action_ar: 'إشارة Kill Switch —بيع فوري للكمية كلها. دي إشارة إن السهم في توزيع قاتل.',
    severity: 'critical',
  },
};

// GET /api/portfolio/unified-watch
// Returns ALL stocks the user is tracking (portfolio + watchlist + radar tracking)
// with LIVE analysis: current price, prediction, advice, signal, regime impact.
//
// FOCUS-5-TASKS (2026-10-01): enhanced to ALSO join exit-radar data per ticker
// so the dashboard widget can show actionable exit alerts directly on the
// portfolio stocks. Single API call gives the widget everything it needs.
export async function GET(req: NextRequest) {
  const { userId } = await getSessionUserId();
  if (!userId) return NextResponse.json({ success: false, error: 'auth_required' }, { status: 401 });

  // Hoisted so `finally` can close them on the failure path too — a leaked
  // readonly handle per request accumulates under dashboard polling.
  let stocksDb: Database.Database | null = null;
  let predDb: Database.Database | null = null;

  try {
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const predictionsDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    const trackingFile = path.join(process.cwd(), 'db', 'maker_radar_tracking.json');

    // Defensive opens: stocks.db/predictions.db are WAL databases that a
    // concurrent writer can momentarily lock. Degrading the enrichment is
    // better than a 500, so these are guarded (unlike the holdings/watchlist
    // reads below, whose failure is a real bug and must surface).
    if (existsSync(stocksDbPath)) {
      try {
        stocksDb = new Database(stocksDbPath, { readonly: true });
      } catch (e) {
        console.error('[portfolio:unified-watch] stocks.db open failed:', e);
      }
    }
    if (existsSync(predictionsDbPath)) {
      try {
        predDb = new Database(predictionsDbPath, { readonly: true });
      } catch (e) {
        console.error('[portfolio:unified-watch] predictions.db open failed:', e);
      }
    }

    // ─── FOCUS-5-TASKS Task 2: Load exit-radar cache ONCE, build a ticker→entry
    // map so we can attach exit_radar_signal to each portfolio stock in O(1).
    // readExitRadarCache returns null if cache missing — we just skip the join.
    const exitRadarCache = readExitRadarCache();
    const exitRadarByTicker: Map<string, any> = new Map();
    if (exitRadarCache?.data?.exit_list && Array.isArray(exitRadarCache.data.exit_list)) {
      for (const entry of exitRadarCache.data.exit_list) {
        if (entry?.ticker) {
          exitRadarByTicker.set(String(entry.ticker).toUpperCase(), entry);
        }
      }
    }

    // 1. Get portfolio holdings.
    // DB-FIX (2026-10-01): the old query hit auth.db `portfolio_items`, which no
    // longer exists in the restored auth.db (only 16 Prisma tables) → SQLITE_ERROR
    // → 500 for every request. The real user holdings live in stocks.db
    // `portfolio_assets` (same source used by /api/portfolio/holdings and
    // /api/portfolio/risk-summary).
    // NOTE: only the columns consumed below are selected. Selecting extra
    // columns widens the failure surface — `market`/`currency`/`is_active` are
    // not created by every DDL variant in this repo, and one missing column
    // makes the whole read fail.
    let portfolioItems: any[] = [];
    if (stocksDb) {
      try {
        portfolioItems = stocksDb.prepare(
          `SELECT stock_ticker as ticker, name, quantity as shares,
                  avg_buy_price as entry_price, current_value
             FROM portfolio_assets
            WHERE user_id = ?
              AND stock_ticker IS NOT NULL AND stock_ticker != ''`
        ).all(userId) as any[];
        portfolioItems = portfolioItems.map((p) => ({
          ...p,
          // `current_value` is a stored snapshot (updated_at is routinely weeks
          // old), so it must NOT be treated as a live quote. Keep the derived
          // price aside and only use it as a last resort below, once the live
          // stocks.db quote has had its chance to fill current_price.
          derived_price:
            p.current_value != null && p.shares ? p.current_value / p.shares : null,
          current_price: null as number | null,
        }));
      } catch (e) {
        // Surface it: a silent empty portfolio hides real breakage.
        console.error('[portfolio:unified-watch] portfolio_assets read failed:', e);
        throw e;
      }
    }

    // 2. Get watchlist — stocks.db `user_stock_watchlists` joined to `stocks`.
    // LEFT JOIN (not INNER) so entries whose stock_id no longer resolves to a
    // `stocks` row are still surfaced; matches /api/portfolio/watchlists.
    let watchlistItems: any[] = [];
    if (stocksDb) {
      try {
        watchlistItems = stocksDb.prepare(
          `SELECT s.ticker, s.current_price,
                  w.alert_price_above, w.alert_price_below
             FROM user_stock_watchlists w
             LEFT JOIN stocks s ON s.id = w.stock_id
            WHERE w.user_id = ?`
        ).all(userId) as any[];
      } catch (e) {
        console.error('[portfolio:unified-watch] user_stock_watchlists read failed:', e);
        throw e;
      }
    }

    // 3. Get radar tracking
    let radarTracked: any[] = [];
    if (existsSync(trackingFile)) {
      try {
        const tracking = JSON.parse(readFileSync(trackingFile, 'utf-8'));
        radarTracked = Object.entries(tracking).map(([ticker, data]: [string, any]) => ({
          ticker,
          entry_price: data.entryPrice,
          entry_date: data.entryDate,
          source: 'radar',
        }));
      } catch {}
    }

    // 4. Merge all tickers
    const allTickers = new Set<string>();
    portfolioItems.forEach(p => allTickers.add(p.ticker?.toUpperCase()));
    watchlistItems.forEach(w => allTickers.add(w.ticker?.toUpperCase()));
    radarTracked.forEach(r => allTickers.add(r.ticker?.toUpperCase()));

    // 5. Enrich each ticker with live data
    const enrichedStocks: any[] = [];
    for (const ticker of allTickers) {
      if (!ticker) continue;

      const stock: any = {
        ticker,
        sources: [] as string[],
        entry_price: null as number | null,
        shares: null as number | null,
        alert_above: null as number | null,
        alert_below: null as number | null,
        current_price: null as number | null,
        change_percent: null as number | null,
        sector: null as string | null,
        prediction: null as any,
        advice: null as any,
        price_source: null as string | null,
        radar_tracked: false,
      };

      // From portfolio
      const portfolioItem = portfolioItems.find(p => p.ticker?.toUpperCase() === ticker);
      let derivedPrice: number | null = null;
      if (portfolioItem) {
        stock.sources.push('portfolio');
        stock.entry_price = portfolioItem.entry_price;
        stock.shares = portfolioItem.shares;
        // FOCUS-5-TASKS-AUDIT-FIX (AUDIT-DEEP-1 #2):
        // Previously: `portfolioItem.current_price || portfolioItem.entry_price`
        // BUG: when current_price is NULL (true for ALL virtual user items),
        // this falls back to entry_price → blocks stocks.db lookup at line 159
        // → total_pnl always 0 (actual: +270,921 EGP hidden).
        // FIX: never seed current_price from the portfolio row. The live quote
        // from stocks.db below always wins; the derived snapshot price is only
        // a last resort for tickers that have no `stocks` row at all.
        derivedPrice = portfolioItem.derived_price;
      }

      // From watchlist
      const watchlistItem = watchlistItems.find(w => w.ticker?.toUpperCase() === ticker);
      if (watchlistItem) {
        stock.sources.push('watchlist');
        stock.alert_above = watchlistItem.alert_price_above;
        stock.alert_below = watchlistItem.alert_price_below;
        if (!stock.current_price) stock.current_price = watchlistItem.current_price;
      }

      // From radar tracking
      const radarItem = radarTracked.find(r => r.ticker?.toUpperCase() === ticker);
      if (radarItem) {
        stock.sources.push('radar');
        stock.radar_tracked = true;
        if (!stock.entry_price) stock.entry_price = radarItem.entry_price;
      }

      // Enrich with stocks.db data — this is the authoritative live quote.
      if (stocksDb) {
        try {
          const stockInfo = stocksDb.prepare('SELECT name_ar, sector, current_price, change_percent, previous_close FROM stocks WHERE ticker = ? COLLATE NOCASE').get(ticker) as any;
          if (stockInfo) {
            stock.sector = stockInfo.sector;
            stock.name_ar = stockInfo.name_ar;
            if (!stock.current_price) stock.current_price = stockInfo.current_price;
            stock.change_percent = stockInfo.change_percent;
            stock.previous_close = stockInfo.previous_close;
          }
        } catch {}
      }

      // Last resort: no watchlist quote and no `stocks` row for this ticker, so
      // fall back to the stale stored position value rather than showing null.
      if (!stock.current_price && derivedPrice != null && derivedPrice > 0) {
        stock.current_price = derivedPrice;
        stock.price_source = 'portfolio_snapshot';
      } else {
        stock.price_source = stock.current_price ? 'live' : null;
      }

      // Enrich with V40.2 prediction
      if (predDb) {
        try {
          const pred = predDb.prepare(
            'SELECT entry_price, target_price, target_price_2, stop_loss, signal, confidence, risk_reward, prediction_date, status FROM predictions WHERE ticker = ? ORDER BY id DESC LIMIT 1'
          ).get(ticker) as any;
          if (pred) {
            stock.prediction = pred;
            // Generate advice based on prediction + current price
            if (stock.current_price && pred.target_price && pred.stop_loss) {
              const current = stock.current_price;
              const target = pred.target_price;
              const stop = pred.stop_loss;
              // FOCUS-5-TASKS-AUDIT-FIX (AUDIT-DEEP-1 #3 + #4):
              // Previously: `pred.entry_price || stock.entry_price || current`
              // BUG #3: NaN/Infinity risk — `(target-current)/current` produces Infinity
              //        if current=0. JSON.stringify(Infinity) = null (silent corruption).
              // FIX #3: Add guards — only compute to_target_pct/to_stop_pct if current > 0.
              //
              // BUG #4: pred.entry_price is the V40.2 snapshot entry (at prediction time),
              //        NOT the user's actual purchase price. Using it first → wrong PnL
              //        (e.g. ABUK: pred.entry=88.63, user bought at 58 → shows -34.6%
              //        STOP_LOSS, but user actually has +58.6% gain → should be TAKE_PROFIT).
              // FIX #4: Use stock.entry_price (user's actual purchase price) FIRST.
              const entry = stock.entry_price || pred.entry_price || current;
              const pnl_pct = entry > 0 ? ((current - entry) / entry) * 100 : 0;
              // NaN/Infinity guards — only compute if both sides > 0
              const to_target_pct = (target > 0 && current > 0) ? ((target - current) / current) * 100 : 0;
              const to_stop_pct = (stop > 0 && current > 0) ? ((stop - current) / current) * 100 : 0;

              let advice_type = 'HOLD';
              let advice_reason = '';
              let advice_action = '';

              if (pnl_pct > 15) {
                advice_type = 'TAKE_PROFIT';
                advice_reason = `السهم حقق +${pnl_pct.toFixed(1)}% من نقطة الدخول — يُنصح بأخذ ربح جزئي`;
                advice_action = 'بيع 50% من الكمية والحفاظ على الباقي';
              } else if (pnl_pct < -5) {
                advice_type = 'STOP_LOSS';
                advice_reason = `السهم خسر ${pnl_pct.toFixed(1)}% — اقترب من وقف الخسارة`;
                advice_action = 'مراجعة وقف الخسارة واعتباره للبيع إذا وصل';
              } else if (to_target_pct > 0 && to_target_pct < 5) {
                advice_type = 'APPROACHING_TARGET';
                advice_reason = `السهم يقترب من الهدف (${to_target_pct.toFixed(1)}% متبقي)`;
                advice_action = 'مراقبة قرب الاختراق — استعد لجني الأرباح';
              } else if (pred.signal === 'STRONG_BUY' || pred.signal === 'BUY') {
                advice_type = 'HOLD';
                advice_reason = `التوقع ${pred.signal} — السهم في اتجاه صاعد`;
                advice_action = 'الاحتفاظ بالمركز والانتظار للهدف';
              } else {
                advice_type = 'HOLD';
                advice_reason = 'السهم في نطاق طبيعي — لا حاجة لعمل فوري';
                advice_action = 'مراقبة الحركة';
              }

              stock.advice = {
                type: advice_type,
                reason: advice_reason,
                action: advice_action,
                pnl_pct: Math.round(pnl_pct * 10) / 10,
                to_target_pct: Math.round(to_target_pct * 10) / 10,
                to_stop_pct: Math.round(to_stop_pct * 10) / 10,
                confidence: pred.confidence,
                signal: pred.signal,
              };
            }
          }
        } catch {}
      }

      // ─── FOCUS-5-TASKS Task 2 + 5: Exit Radar → Portfolio (actionable alert).
      // If this ticker appears in today's exit_radar cache, attach the signal
      // AND override the advice to be an EXIT decision (critical > existing advice).
      // This is what makes the alert a *decision* instead of just a price tick.
      const exitEntry = exitRadarByTicker.get(ticker);
      if (exitEntry) {
        const pathInfo = EXIT_RADAR_PATH_INFO[exitEntry.path] ?? {
          label_ar: exitEntry.path,
          advice_action_ar: 'راجع السهم — عليه إشارة خروج من رادار الخروج.',
          severity: 'caution' as const,
        };
        stock.exit_radar_signal = {
          path: exitEntry.path,
          label_ar: pathInfo.label_ar,
          reason: exitEntry.reason || '',
          severity: pathInfo.severity,
          volume_ratio_today: exitEntry.volume_ratio_today ?? null,
          all_paths: exitEntry.all_paths || [exitEntry.path],
          current_price_from_radar: exitEntry.current_price ?? null,
          generated_at: exitRadarCache?.data?.generated_at ?? null,
        };
        // Override advice — exit signals are higher priority than the regular
        // prediction-based advice (the user needs to act NOW, not just hold).
        stock.advice = {
          type: 'EXIT_RADAR',
          reason: `${pathInfo.label_ar}: ${exitEntry.reason || ''}`.trim(),
          action: pathInfo.advice_action_ar,
          pnl_pct: stock.advice?.pnl_pct ?? 0,
          to_target_pct: stock.advice?.to_target_pct ?? 0,
          to_stop_pct: stock.advice?.to_stop_pct ?? 0,
          confidence: stock.advice?.confidence ?? null,
          signal: stock.advice?.signal ?? null,
          severity: pathInfo.severity,
        };
      }

      enrichedStocks.push(stock);
    }

    // 6. Portfolio summary
    const totalValue = enrichedStocks.reduce((sum, s) => sum + (s.current_price || 0) * (s.shares || 0), 0);
    const totalCost = enrichedStocks.reduce((sum, s) => sum + (s.entry_price || 0) * (s.shares || 0), 0);
    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // 7. Sector distribution
    const sectorDist: Record<string, number> = {};
    enrichedStocks.forEach(s => {
      if (s.sector) sectorDist[s.sector] = (sectorDist[s.sector] || 0) + 1;
    });

    // ─── FOCUS-5-TASKS: Alerts summary (for the dashboard widget badge count).
    // Counts actionable alerts by type so the widget can show a quick "X alerts"
    // chip without scanning the whole stocks array.
    const alertsSummary = {
      total: 0,
      critical: 0,
      warning: 0,
      caution: 0,
      by_type: {} as Record<string, number>,
      exit_radar_count: 0,
      take_profit_count: 0,
      stop_loss_count: 0,
      approaching_target_count: 0,
    };
    for (const s of enrichedStocks) {
      if (!s.advice || s.advice.type === 'HOLD') continue;
      alertsSummary.total++;
      alertsSummary.by_type[s.advice.type] = (alertsSummary.by_type[s.advice.type] || 0) + 1;
      if (s.advice.type === 'EXIT_RADAR') {
        alertsSummary.exit_radar_count++;
        const sev = (s.exit_radar_signal?.severity) || 'caution';
        if (sev === 'critical') alertsSummary.critical++;
        else if (sev === 'warning') alertsSummary.warning++;
        else alertsSummary.caution++;
      } else if (s.advice.type === 'TAKE_PROFIT') {
        alertsSummary.take_profit_count++;
        alertsSummary.caution++;
      } else if (s.advice.type === 'STOP_LOSS') {
        alertsSummary.stop_loss_count++;
        alertsSummary.critical++;
      } else if (s.advice.type === 'APPROACHING_TARGET') {
        alertsSummary.approaching_target_count++;
        alertsSummary.warning++;
      }
    }

    return NextResponse.json({
      success: true,
      user_id: userId,
      stocks: enrichedStocks,
      summary: {
        total_stocks: enrichedStocks.length,
        portfolio_stocks: portfolioItems.length,
        watchlist_stocks: watchlistItems.length,
        radar_tracked: radarTracked.length,
        total_value: Math.round(totalValue * 100) / 100,
        total_cost: Math.round(totalCost * 100) / 100,
        total_pnl: Math.round(totalPnl * 100) / 100,
        total_pnl_pct: Math.round(totalPnlPct * 10) / 10,
        sector_distribution: sectorDist,
        alerts: alertsSummary,
        exit_radar_cache_age_seconds: exitRadarCache?.data?.generated_at
          ? Math.round((Date.now() - new Date(exitRadarCache.data.generated_at).getTime()) / 1000)
          : null,
      },
    });
  } catch (error) {
    console.error('[portfolio:unified-watch]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  } finally {
    // Close on every path, including the throws above.
    if (stocksDb) stocksDb.close();
    if (predDb) predDb.close();
  }
}
