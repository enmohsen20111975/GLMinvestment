import { NextRequest, NextResponse } from 'next/server';
// P0-14-ASYNC fix (2026-09-27): replaced sync readFileSync/existsSync with
// async fs/promises equivalents in loadTracking so the maker-radar stock GET
// handler never blocks the event loop.
import { readFile, access } from 'fs/promises';
import path from 'path';
import { getRadarDb, getRadarDbConfig, parseVolume, computeTurnover } from '@/modules/radar/lib/radar-db';
// FIX-P4-TARGETS: validator for prediction enrichment (if a prediction exists
// for this ticker in predictions.db, we validate it before returning).
import { applyValidatedTargets } from '@/lib/targets-validator';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const TRACKING_FILE = path.join(PROJECT_ROOT, 'db', 'maker_radar_tracking.json');

interface TrackedStock {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  addedAt: string;
  notes?: string;
}

// P0-14-ASYNC fix (2026-09-27): loadTracking is now async.
async function loadTracking(): Promise<Record<string, TrackedStock>> {
  try {
    try {
      await access(TRACKING_FILE);
    } catch { // silent fallback (safe-by-design)
      return {};
    }
    const data = await readFile(TRACKING_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error('[maker-radar/stock] load tracking error:', e);
  }
  return {};
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  const days = parseInt(url.searchParams.get('days') || '30', 10);

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker query param is required' },
      { status: 400 }
    );
  }

  const cfg = getRadarDbConfig();
  const db = getRadarDb();
  if (!cfg || !db) {
    return NextResponse.json(
      {
        success: false,
        error: 'No radar DB available. Run scripts/fetch_production_data.py on sandbox, or ensure db/stocks.db exists on production.',
      },
      { status: 503 }
    );
  }

  try {
    // 1. بيانات السهم الأساسية من stocks table (لو موجود)
    let stockInfo: any = null;
    try {
      stockInfo = db.prepare('SELECT * FROM stocks WHERE ticker = ?').get(ticker);
    } catch (e) {
      // مفيش stocks table — نكمل من غيره
    }

    // 2. آخر N يوم أسعار — portable query
    const cols = `${cfg.dateCol}, ${cfg.openCol} as open, ${cfg.highCol} as high, ${cfg.lowCol} as low, ${cfg.priceCol} as close, ${cfg.volumeCol} as volume`;
    const turnoverSelect = cfg.turnoverCol ? `, ${cfg.turnoverCol} as turnover` : ', NULL as turnover';
    const priceRows = db.prepare(`
      SELECT ${cols}${turnoverSelect}
      FROM ${cfg.table}
      WHERE ${cfg.tickerCol} = ? AND ${cfg.priceCol} IS NOT NULL AND ${cfg.priceCol} > 0
      ORDER BY ${cfg.dateCol} DESC
      LIMIT ?
    `).all(ticker, days) as any[];

    const prices = priceRows.reverse().map((r) => ({
      date: r[cfg.dateCol],
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: parseVolume(r.volume),
      turnover: computeTurnover(r, cfg),
    }));

    // 3. إحصائيات
    const closes = prices.map((p) => p.close).filter((c) => c > 0);
    const volumes = prices.map((p) => p.volume).filter((v) => v > 0);
    const turnovers = prices.map((p) => p.turnover).filter((t) => t > 0);

    const lastClose = closes.length > 0 ? closes[closes.length - 1] : 0;
    const firstClose = closes.length > 0 ? closes[0] : 0;
    const changePct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

    const avgVolume20 = volumes.length >= 20
      ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
      : (volumes.reduce((a, b) => a + b, 0) / Math.max(volumes.length, 1));
    const avgTurnover20 = turnovers.length >= 20
      ? turnovers.slice(-20).reduce((a, b) => a + b, 0) / 20
      : (turnovers.reduce((a, b) => a + b, 0) / Math.max(turnovers.length, 1));

    // ROC 10d
    const roc10d = closes.length >= 11 && closes[closes.length - 11] > 0
      ? ((closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11]) * 100
      : 0;

    // max/min 20d
    const last20 = closes.slice(-20);
    const max20 = last20.length > 0 ? Math.max(...last20) : 0;
    const min20 = last20.length > 0 ? Math.min(...last20) : 0;
    const range20Pct = min20 > 0 ? ((max20 - min20) / min20) * 100 : 0;

    // 4. tracking info
    const tracking = await loadTracking();
    const tracked = tracking[ticker];
    let trackingInfo = null;
    if (tracked) {
      const changeSinceTracking = tracked.entryPrice > 0
        ? ((lastClose - tracked.entryPrice) / tracked.entryPrice) * 100
        : 0;
      trackingInfo = {
        isTracked: true,
        entryDate: tracked.entryDate,
        entryPrice: tracked.entryPrice,
        currentPrice: lastClose,
        changeSinceTracking: Math.round(changeSinceTracking * 100) / 100,
        daysTracked: Math.floor((Date.now() - new Date(tracked.entryDate).getTime()) / (1000 * 60 * 60 * 24)),
      };
    }

    // FIX-P4-TARGETS: prediction enrichment — لو فيه توقع حالي للـ ticker في
    // predictions.db، نـ validate الـ targets بتاعته (signal-aware) ونرجّعه.
    // الـ prediction منفصل عن الـ radar DB — بـ نقرأه من db/predictions.db.
    // لو مفيش predictions.db أو مفيش توقع، الـ field بـ يكون null.
    let predictionEnrichment: any = null;
    try {
      const fs = await import('fs/promises');
      const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');
      let predDbExists = true;
      try {
        await fs.access(predDbPath);
      } catch { // silent fallback (safe-by-design)
        // predictions.db غير موجود — نـ skip الـ enrichment بصمت.
        predDbExists = false;
      }
      if (predDbExists) {
        const Database = (await import('better-sqlite3')).default;
        const pdb = new Database(predDbPath, { readonly: true, timeout: 2000 });
        try {
          const pred = pdb.prepare(
            `SELECT ticker, signal, signal_type, prediction_date, entry_price,
                    target_price, target_price_2, stop_loss, risk_reward,
                    confidence, master_score, market, persona, status,
                    entry_price_min, entry_price_max, support_level,
                    support_level_2, resistance_level, resistance_level_2
             FROM predictions
             WHERE ticker = ?
             ORDER BY prediction_date DESC, id DESC
             LIMIT 1`
          ).get(ticker) as any;
          if (pred) {
            // FIX-P4-TARGETS: signal-aware validation قبل ما نرجّع الـ prediction.
            const v = applyValidatedTargets({
              signal: pred.signal || pred.signal_type || 'BUY',
              entry_price: pred.entry_price,
              current_price: lastClose || pred.entry_price,
              target1: pred.target_price,
              target2: pred.target_price_2 ?? null,
              stop_loss: pred.stop_loss,
              risk_reward_ratio: pred.risk_reward,
            });
            // Task REAPPLY-CRITICAL-FIXES — fabrication fallbacks removed (Rule 27).
            // Was: support1 = entry*0.96, support2 = support1*0.96, entry_min = entry*0.99,
            // entry_max = entry*1.01 — all fabricated from entry_price when DB lacked them.
            // Now: return null when DB has no real value (Rule 27 — NO-FAKE-DATA).
            // The UI (MakerRadarTab) handles null gracefully via the amber "data missing" badge.
            const s1 = pred.support_level || null;
            const s2 = pred.support_level_2 || null;
            const r1 = pred.resistance_level || v.target1;
            const r2 = pred.resistance_level_2 || v.target2;
            const entryMin = pred.entry_price_min || null;
            const entryMax = pred.entry_price_max || null;

            predictionEnrichment = {
              ticker: pred.ticker,
              signal: pred.signal,
              signal_type: pred.signal_type,
              prediction_date: pred.prediction_date,
              entry_price: v.entry_price,
              entry_price_min: entryMin,
              entry_price_max: entryMax,
              target_price: v.target1,
              target_price_2: v.target2,
              stop_loss: v.stop_loss,
              support_level: s1,
              support_level_2: s2,
              resistance_level: r1,
              resistance_level_2: r2,
              risk_reward: v.risk_reward_ratio,
              confidence: pred.confidence != null ? Number(pred.confidence) : null,
              master_score: pred.master_score != null ? Number(pred.master_score) : null,
              market: pred.market,
              persona: pred.persona,
              status: pred.status,
              current_price: lastClose,
              targets_validated: v.adjusted || false,
            };
          }
        } finally {
          pdb.close();
        }
      }
    } catch (predErr) {
      // الـ enrichment اختياري — لو فشل، نكمل من غير prediction field.
      console.error('[maker-radar/stock] prediction enrichment error:', predErr);
    }

    db.close();

    return NextResponse.json({
      success: true,
      ticker,
      stock_info: stockInfo || null,
      prices,
      stats: {
        lastClose: Math.round(lastClose * 100) / 100,
        changePct: Math.round(changePct * 100) / 100,
        roc10d: Math.round(roc10d * 100) / 100,
        avgVolume20: Math.round(avgVolume20),
        avgTurnover20: Math.round(avgTurnover20),
        max20: Math.round(max20 * 100) / 100,
        min20: Math.round(min20 * 100) / 100,
        range20Pct: Math.round(range20Pct * 100) / 100,
        dataPoints: prices.length,
      },
      tracking: trackingInfo,
      // FIX-P4-TARGETS: latest prediction for this ticker (validated, signal-aware).
      // null لو مفيش prediction في predictions.db أو الـ DB مش موجود.
      prediction: predictionEnrichment,
      db_source: cfg.dbPath.split('/').pop(), // اسم الـ DB المستخدم
    });
  } catch (error: any) {
    console.error('[maker-radar/stock] error:', error);
    try { db.close(); } catch { /* safe-by-design */ }
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}
