import { NextRequest, NextResponse } from 'next/server';
<<<<<<< HEAD
import { readFile, access } from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import {
  getRadarDb,
  getRadarDbConfig,
  parseVolume,
  type RadarDbConfig,
} from '@/modules/radar/lib/radar-db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Signal Tracking Timeline API
 * =============================
 *
 * GET /api/maker-radar/timeline?ticker=COMI&days=30
 *
 * Returns the journey of a tracked stock from the moment it entered the
 * radar until now — entry price, current price, target progress, milestone
 * events, and a checklist of "did this happen yet" milestones.
 *
 * Data sources (all optional — graceful degradation when missing):
 *   1. db/maker_radar_tracking.json — entry date + entry price (REQUIRED)
 *   2. db radar DB (egksco_price_history / stock_daily_prices) — daily prices
 *   3. db/predictions.db.radar_signal_tracking — signal events (optional)
 *   4. db/predictions.db.predictions — target prices + stop loss (optional)
 *
 * If the stock is not tracked or no radar DB is available, returns
 * success=false with a helpful Arabic error message so the component can
 * render the appropriate empty / CTA state.
 */

const PROJECT_ROOT = process.cwd();
const TRACKING_FILE = path.join(PROJECT_ROOT, 'db', 'maker_radar_tracking.json');
const PREDICTIONS_DB = path.join(PROJECT_ROOT, 'db', 'predictions.db');

interface TrackedStock {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  addedAt: string;
  notes?: string;
}

async function loadTracking(): Promise<Record<string, TrackedStock>> {
  try {
    try {
      await access(TRACKING_FILE);
    } catch {
      return {};
    }
    const data = await readFile(TRACKING_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error('[maker-radar/timeline] load tracking error:', e);
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function round2(v: number): number {
  if (!isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function num(v: any): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

interface PriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function fetchPricesSinceEntry(
  db: any,
  cfg: RadarDbConfig,
  ticker: string,
  entryDate: string,
  maxDays: number
): PriceRow[] {
  const cols = `${cfg.dateCol}, ${cfg.openCol} AS open, ${cfg.highCol} AS high, ${cfg.lowCol} AS low, ${cfg.priceCol} AS close, ${cfg.volumeCol} AS volume`;
  // SQLite ISO date strings compare lexicographically — perfect for 'YYYY-MM-DD'.
  const rows = db
    .prepare(
      `SELECT ${cols}
       FROM ${cfg.table}
       WHERE ${cfg.tickerCol} = ?
         AND ${cfg.priceCol} IS NOT NULL
         AND ${cfg.priceCol} > 0
         AND ${cfg.dateCol} >= ?
       ORDER BY ${cfg.dateCol} ASC
       LIMIT ?`
    )
    .all(ticker, entryDate, maxDays) as any[];

  return rows.map((r) => ({
    date: String(r[cfg.dateCol]),
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    close: num(r.close),
    volume: parseVolume(r.volume),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional: read latest prediction row for the ticker (target/stop_loss)
// ─────────────────────────────────────────────────────────────────────────────
interface PredictionRow {
  target_price: number | null;
  stop_loss: number | null;
  signal: string | null;
  prediction_date: string | null;
}

function readLatestPrediction(ticker: string): PredictionRow | null {
  let db: Database.Database | null = null;
  try {
    // Lazy require so the route never crashes if better-sqlite3 fails on this DB
    db = new Database(PREDICTIONS_DB, { readonly: true, timeout: 1500 });
  } catch {
    return null;
  }
  try {
    // Check the predictions table exists
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='predictions'")
      .get() as any;
    if (!row) return null;
    const pred = db
      .prepare(
        `SELECT target_price, stop_loss, signal, prediction_date
         FROM predictions
         WHERE ticker = ?
         ORDER BY prediction_date DESC, id DESC
         LIMIT 1`
      )
      .get(ticker) as any;
    return pred || null;
  } catch (e) {
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional: read radar_signal_tracking events for the ticker
// ─────────────────────────────────────────────────────────────────────────────
interface SignalEvent {
  signal_date: string;
  signal_type: string;
  entry_price: number;
  reason: string | null;
}

function readSignalEvents(ticker: string, sinceDate: string): SignalEvent[] {
  let db: Database.Database | null = null;
  try {
    db = new Database(PREDICTIONS_DB, { readonly: true, timeout: 1500 });
  } catch {
    return [];
  }
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='radar_signal_tracking'")
      .get() as any;
    if (!row) return [];
    const rows = db
      .prepare(
        `SELECT signal_date, signal_type, entry_price, reason
         FROM radar_signal_tracking
         WHERE ticker = ? AND signal_date >= ?
         ORDER BY signal_date ASC`
      )
      .all(ticker, sinceDate) as any[];
    return rows.map((r) => ({
      signal_date: String(r.signal_date),
      signal_type: String(r.signal_type || ''),
      entry_price: num(r.entry_price),
      reason: r.reason != null ? String(r.reason) : null,
    }));
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the timeline events + milestones from price history
// ─────────────────────────────────────────────────────────────────────────────
type TimelineEvent = 'signal' | 'milestone' | 'alert' | 'current';

interface TimelinePoint {
  date: string;
  price: number;
  event: TimelineEvent;
  label: string;
  note: string | null;
}

interface Milestone {
  label: string;
  date: string | null;
  price: number | null;
  reached: boolean;
}

function buildTimeline(
  prices: PriceRow[],
  entryPrice: number,
  signalEvents: SignalEvent[]
): { timeline: TimelinePoint[]; milestones: Milestone[] } {
  if (prices.length === 0) {
    return { timeline: [], milestones: [] };
  }

  const timeline: TimelinePoint[] = [];
  const milestones: Milestone[] = [];

  // Entry point
  timeline.push({
    date: prices[0].date,
    price: round2(entryPrice),
    event: 'signal',
    label: 'دخل الرادار',
    note: 'بداية المتابعة',
  });

  milestones.push({
    label: 'دخل الرادار',
    date: prices[0].date,
    price: round2(entryPrice),
    reached: true,
  });

  // Build a date → signal event lookup for annotation
  const signalByDate = new Map<string, SignalEvent>();
  for (const ev of signalEvents) {
    signalByDate.set(ev.signal_date, ev);
  }

  // Track milestone thresholds reached (for the checklist)
  const reachedThresholds = new Set<number>();
  const THRESHOLDS = [
    { pct: 5,  label: 'قوة الإشارة ارتفعت' },
    { pct: 8,  label: 'حجم انفجاري' },
    { pct: 10, label: 'وصل الهدف الأول' },
    { pct: 15, label: 'اقترب من الهدف الثاني' },
    { pct: 20, label: 'وصل الهدف الثاني' },
  ];

  // Build intermediate timeline points — pick one point per ~3-day window OR
  // whenever a signal event occurred OR when a milestone threshold was hit OR
  // a meaningful alert (drawdown) happened.
  let lastTimelineDate = prices[0].date;
  const seenDays = new Set<string>();
  seenDays.add(prices[0].date);

  for (let i = 1; i < prices.length; i++) {
    const p = prices[i];
    const changePct = entryPrice > 0 ? ((p.close - entryPrice) / entryPrice) * 100 : 0;

    // Detect threshold crossings (milestone reached)
    let crossedMilestone = false;
    for (const t of THRESHOLDS) {
      if (changePct >= t.pct && !reachedThresholds.has(t.pct)) {
        reachedThresholds.add(t.pct);
        milestones.push({
          label: t.label,
          date: p.date,
          price: round2(p.close),
          reached: true,
        });
        crossedMilestone = true;
      }
    }

    // Detect drawdown alerts (≥ 3% drop from previous timeline point OR ≥ 4% from entry)
    const prevPrice = prices[i - 1].close;
    const dayChangePct = prevPrice > 0 ? ((p.close - prevPrice) / prevPrice) * 100 : 0;
    const drawdownFromEntry = -changePct;
    const isAlert = dayChangePct <= -3 || drawdownFromEntry >= 4;

    // Signal event on this date?
    const sig = signalByDate.get(p.date);

    // Pick this point if: milestone crossed, alert, signal event, OR every ~3 days
    const dayDiff = Math.floor(
      (new Date(p.date).getTime() - new Date(lastTimelineDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    const shouldAdd = crossedMilestone || isAlert || sig != null || dayDiff >= 3;

    if (shouldAdd && !seenDays.has(p.date)) {
      seenDays.add(p.date);
      let event: TimelineEvent = 'milestone';
      let label = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`;
      let note: string | null = null;

      if (sig != null) {
        event = 'milestone';
        label = `قوة الإشارة: ${sig.signal_type}`;
        note = sig.reason;
      } else if (isAlert) {
        event = 'alert';
        label = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`;
        note = drawdownFromEntry >= 4 ? 'تصحيح من قمة الدخول' : 'تصحيح طفيف';
      } else if (crossedMilestone) {
        event = 'milestone';
        note = 'تجاوز عتبة جديدة';
      }

      timeline.push({
        date: p.date,
        price: round2(p.close),
        event,
        label,
        note,
      });
      lastTimelineDate = p.date;
    }
  }

  // Append any unreached milestones
  for (const t of THRESHOLDS) {
    if (!reachedThresholds.has(t.pct)) {
      milestones.push({
        label: t.label,
        date: null,
        price: null,
        reached: false,
      });
    }
  }

  // Current point — always the last price
  const last = prices[prices.length - 1];
  const currentChange = entryPrice > 0 ? ((last.close - entryPrice) / entryPrice) * 100 : 0;
  if (!seenDays.has(last.date)) {
    timeline.push({
      date: last.date,
      price: round2(last.close),
      event: 'current',
      label: `${currentChange >= 0 ? '+' : ''}${currentChange.toFixed(1)}%`,
      note: 'الآن',
    });
  } else {
    // Mutate the last entry into a "current" event so the UI shows it prominently
    const lastEntry = timeline[timeline.length - 1];
    lastEntry.event = 'current';
    lastEntry.label = `${currentChange >= 0 ? '+' : ''}${currentChange.toFixed(1)}%`;
    lastEntry.note = 'الآن';
  }

  return { timeline, milestones };
}

// ─────────────────────────────────────────────────────────────────────────────
// Target progress computation
// ─────────────────────────────────────────────────────────────────────────────
function computeProgress(
  entryPrice: number,
  currentPrice: number,
  targetPrice: number | null,
  stopLoss: number | null
) {
  // Defaults if prediction row missing
  const t1 = targetPrice && targetPrice > 0 ? targetPrice : entryPrice * 1.10;
  const t2 = (targetPrice && targetPrice > 0 ? targetPrice : entryPrice * 1.10) * 1.10; // +10% beyond t1
  const sl = stopLoss && stopLoss > 0 ? stopLoss : entryPrice * 0.95;

  const t1Pct = entryPrice > 0 ? ((t1 - entryPrice) / entryPrice) * 100 : 0;
  const t2Pct = entryPrice > 0 ? ((t2 - entryPrice) / entryPrice) * 100 : 0;
  const slPct = entryPrice > 0 ? ((sl - entryPrice) / entryPrice) * 100 : 0;

  // Progress = how far from entry → target / stop
  const t1Range = t1 - entryPrice;
  const t1Progress = t1Range !== 0
    ? Math.max(0, Math.min(100, ((currentPrice - entryPrice) / t1Range) * 100))
    : 0;
  const t2Range = t2 - entryPrice;
  const t2Progress = t2Range !== 0
    ? Math.max(0, Math.min(100, ((currentPrice - entryPrice) / t2Range) * 100))
    : 0;

  // Stop loss: progress = how close price is to stop_loss (100% = stopped out, 0% = far away)
  // But we want "safe" when far. So: distance ratio.
  // safe (0% close) → danger (100% close)
  const slRange = entryPrice - sl; // positive number
  const slProgress = slRange !== 0
    ? Math.max(0, Math.min(100, ((entryPrice - currentPrice) / slRange) * 100))
    : 0;

  const t1Status = currentPrice >= t1 ? 'hit' : t1Progress >= 85 ? 'approaching' : 'pending';
  const t2Status = currentPrice >= t2 ? 'hit' : t2Progress >= 85 ? 'approaching' : 'pending';
  const slStatus = slProgress >= 90 ? 'danger' : slProgress >= 50 ? 'warning' : 'safe';

  return {
    target_1: {
      price: round2(t1),
      pct: round2(t1Pct),
      status: t1Status,
      progress_pct: Math.round(t1Progress),
    },
    target_2: {
      price: round2(t2),
      pct: round2(t2Pct),
      status: t2Status,
      progress_pct: Math.round(t2Progress),
    },
    stop_loss: {
      price: round2(sl),
      pct: round2(slPct),
      status: slStatus,
      progress_pct: Math.round(slProgress),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET handler
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  const days = Math.max(1, parseInt(url.searchParams.get('days') || '60', 10));

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker query param is required' },
      { status: 400 }
    );
  }

  // 1. Load tracking JSON
  const tracking = await loadTracking();
  const tracked = tracking[ticker];

  if (!tracked) {
    return NextResponse.json({
      success: false,
      not_tracked: true,
      ticker,
      error: 'السهم مش متابع — أضفه للمتابعة عشان تشوف الخط الزمني',
    });
  }

  if (!tracked.entryPrice || tracked.entryPrice <= 0) {
    return NextResponse.json({
      success: false,
      ticker,
      entry_price_missing: true,
      error: 'سعر الدخول مش متسجل',
      entry: { date: tracked.entryDate, price: 0 },
    });
  }

  // 2. Open radar DB
  const cfg = getRadarDbConfig();
  const db = getRadarDb();
  if (!cfg || !db) {
    return NextResponse.json({
      success: false,
      ticker,
      no_price_history: true,
      error: 'مفيش بيانات أسعار كافية بعد',
      entry: { date: tracked.entryDate, price: tracked.entryPrice },
    });
  }

  try {
    const prices = fetchPricesSinceEntry(db, cfg, ticker, tracked.entryDate, days);

    if (prices.length < 2) {
      db.close();
      return NextResponse.json({
        success: false,
        ticker,
        no_price_history: true,
        error: 'مفيش بيانات أسعار كافية بعد',
        entry: { date: tracked.entryDate, price: tracked.entryPrice },
        data_points: prices.length,
      });
    }

    const entryPrice = tracked.entryPrice;
    const lastPrice = prices[prices.length - 1].close;
    const lastDate = prices[prices.length - 1].date;
    const changePct = entryPrice > 0 ? ((lastPrice - entryPrice) / entryPrice) * 100 : 0;
    const daysTracked = Math.max(
      1,
      Math.floor((new Date(lastDate).getTime() - new Date(tracked.entryDate).getTime()) / (1000 * 60 * 60 * 24))
    );

    // 3. Optional: read predictions + signal events
    const pred = readLatestPrediction(ticker);
    const signalEvents = readSignalEvents(ticker, tracked.entryDate);

    // 4. Build timeline + milestones
    const { timeline, milestones } = buildTimeline(prices, entryPrice, signalEvents);

    // 5. Compute targets + stop loss progress
    const targets = computeProgress(
      entryPrice,
      lastPrice,
      pred?.target_price ?? null,
      pred?.stop_loss ?? null
    );

    db.close();

    return NextResponse.json({
      success: true,
      ticker,
      entry: { date: tracked.entryDate, price: round2(entryPrice) },
      current: {
        date: lastDate,
        price: round2(lastPrice),
        change_pct: round2(changePct),
        days_tracked: daysTracked,
      },
      target_1: targets.target_1,
      target_2: targets.target_2,
      stop_loss: targets.stop_loss,
      timeline,
      milestones,
      prediction: pred
        ? {
            target_price: pred.target_price,
            stop_loss: pred.stop_loss,
            signal: pred.signal,
            prediction_date: pred.prediction_date,
          }
        : null,
      signal_events_count: signalEvents.length,
      price_points: prices.length,
      computed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[maker-radar/timeline] error:', error);
    try { db.close(); } catch {}
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error', ticker },
      { status: 500 }
    );
=======
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  
  if (!ticker) return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });
  
  try {
    const trackingFile = path.join(process.cwd(), 'db', 'maker_radar_tracking.json');
    if (!existsSync(trackingFile)) {
      return NextResponse.json({ success: false, error: 'not_tracked', ticker });
    }
    const tracking = JSON.parse(readFileSync(trackingFile, 'utf-8'));
    const tracked = tracking[ticker];
    if (!tracked) {
      return NextResponse.json({ success: false, error: 'not_tracked', ticker });
    }
    
    return NextResponse.json({
      success: true,
      ticker,
      entry: { date: tracked.entryDate, price: tracked.entryPrice },
      current: { date: new Date().toISOString().slice(0,10), price: 0, change_pct: 0, days_tracked: 0 },
      target_1: { price: 0, pct: 0, status: 'pending', progress_pct: 0 },
      target_2: { price: 0, pct: 0, status: 'pending', progress_pct: 0 },
      stop_loss: { price: 0, pct: 0, status: 'safe', progress_pct: 0 },
      timeline: [{ date: tracked.entryDate, price: tracked.entryPrice, event: 'signal', label: 'دخل الرادار', note: null }],
      milestones: [],
      signal_events_count: 1,
      price_points: 1,
      computed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
>>>>>>> 835c22b (fix: recreate 7 lost API routes + restore predictions.db + Flutter audit)
  }
}
