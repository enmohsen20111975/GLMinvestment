/**
 * GET /api/predictions/daily-picks
 * =================================
 * P0-FIX (API-FALLBACKS-WAVE-2): fallback to SQLite when Python backend is down.
 * Reads from predictions.db.predictions — no mock data (Rule 27).
 *
 * Tries Python /api/predictions/daily-picks first (5s timeout).
 * On failure, returns latest 10 predictions WHERE market = 'EGX' ORDER BY
 * prediction_date DESC.
 *
 * Shape: { success, source: 'sqlite_fallback', picks: [...], count, date }
 */

import { NextRequest, NextResponse } from 'next/server';
import { preferComputedRiskReward } from '@/lib/risk-reward';
import { applyValidatedTargets } from '@/lib/targets-validator';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';
import { applyPaywallToResults } from '@/lib/paywall';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

const MARKET_MAP: Record<string, string> = {
  EGX: 'EGX',
  TADAWUL: 'TADAWUL',
  KSA: 'TADAWUL',
  KSE: 'KSE',
  QSE: 'QSE',
  US: 'US',
  CRYPTO: 'CRYPTO',
};

interface DailyPick {
  ticker: string;
  market: string;
  signal: string;
  signal_type: string | null;
  entry_price: number;
  target_price: number;
  target_price_2: number | null;
  stop_loss: number;
  risk_reward: number;
  master_score: number;
  technical_score: number | null;
  confidence: number | null;
  persona: string | null;
  status: string | null;
  prediction_date: string;
  horizon: string | null;
  exit_type: string | null;
  morning_bell: number | null;
  explosive_score: number | null;
  evidence_count: number | null;
  kill_filter_result: string | null;
  name_ar: string | null;
  sector: string | null;
}

/**
 * FIX-P4-TARGETS: validate each pick's targets (signal-aware) before returning.
 * صالح للـ Python source والـ SQLite fallback. لو الـ picks فيه أي targets مكسورة،
 * الـ validator بـ يصلّحها. لو مفيش entry price صالح، القيم بـ تكون null.
 */
function validatePicks<T extends DailyPick>(picks: T[]): T[] {
  return picks.map((p) => {
    const v = applyValidatedTargets({
      signal: p.signal || 'BUY',
      entry_price: p.entry_price,
      target1: p.target_price,
      target2: p.target_price_2 ?? null,
      stop_loss: p.stop_loss,
      risk_reward_ratio: p.risk_reward,
    });
    return {
      ...p,
      signal: v.signal,
      entry_price: v.entry_price,
      target_price: v.target1,
      target_price_2: v.target2,
      stop_loss: v.stop_loss,
      risk_reward: v.risk_reward_ratio,
    } as T;
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // ── PAYWALL Phase 2 — Gate 7: predictions detail blurring ──────────
  //   Per PAYWALL-STRATEGY-FINAL.md §5.2 row 2 + §8.2 marketing copy
  //   ("🔓 كل التوقعات V40.2 (مش بس 3)") — daily-picks must enforce both
  //   the trial expiry (403) AND apply `applyPaywallToResults` blurring
  //   for non-paid authenticated users (top 3 visible, rest blurred).
  //   - Anonymous (no session) → full picks (taste hook per §4).
  //   - Authenticated + paid → full picks.
  //   - Authenticated + trial-active free → top 3 visible, rest blurred.
  //   - Authenticated + free + trial expired → 403 TRIAL_EXPIRED.
  const { userId } = await getSessionUserId();
  let picksLocked = false;      // apply applyPaywallToResults blurring
  let isPaidUser = false;       // pass-through to applyPaywallToResults
  if (userId) {
    const trial = await checkTrialNotExpired(userId);
    if (!trial.ok) {
      return NextResponse.json(
        { error: 'TRIAL_EXPIRED', upgradeUrl: trial.upgradeUrl },
        { status: 403 },
      );
    }
    isPaidUser = trial.isPaid;
    picksLocked = !trial.isPaid; // blur for trial-active free users
  }

  // 1) Try Python first (5s timeout)
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/predictions/daily-picks${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      // FIX-P4-TARGETS: validate Python picks too — الـ Python ما عندوش validator
      // مكافئ، فـ الـ targets بتدخل raw. نـ validate هنا علشان نضمن consistency.
      if (data && Array.isArray(data.picks)) {
        data.picks = validatePicks(data.picks as DailyPick[]);
        data.count = data.picks.length;
      }
      return NextResponse.json(applyPicksPaywall(data, picksLocked, isPaidUser));
    }
  } catch {}

  // 2) Fallback — read from predictions.db
  try {
    const path = require('path');
    const fs = require('fs');
    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json(
        { success: false, error: 'تعذّر الوصول إلى قاعدة بيانات التوقعات' },
        { status: 500 }
      );
    }
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const market = MARKET_MAP[marketRaw] || 'EGX';
    const date = url.searchParams.get('date'); // optional YYYY-MM-DD
    const persona = url.searchParams.get('persona')?.trim().toLowerCase();
    const minConfidence = url.searchParams.get('min_confidence');
    const limitRaw = Number(url.searchParams.get('limit') || 10);
    const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 10));

    // Optional stock lookup for name_ar + sector
    let stocksLookup: Map<string, { sector: string; name_ar: string }> = new Map();
    try {
      const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
      if (fs.existsSync(stocksDbPath)) {
        const stocksDb = new Database(stocksDbPath, { readonly: true });
        const stockRows = stocksDb
          .prepare(`SELECT ticker, sector, name_ar FROM stocks`)
          .all() as Array<Record<string, unknown>>;
        for (const r of stockRows) {
          stocksLookup.set(String(r.ticker), {
            sector: String(r.sector || ''),
            name_ar: String(r.name_ar || r.ticker || ''),
          });
        }
        stocksDb.close();
      }
    } catch {}

    const where: string[] = ['market = ?'];
    const params: unknown[] = [market];

    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      where.push('prediction_date = ?');
      params.push(date);
    }
    if (persona && persona !== 'all') {
      where.push("LOWER(COALESCE(persona, '')) = ?");
      params.push(persona);
    }
    if (minConfidence && !Number.isNaN(Number(minConfidence))) {
      where.push('COALESCE(confidence, master_score, 0) >= ?');
      params.push(Number(minConfidence));
    }

    const sql = `
      SELECT
        ticker, signal, signal_type, market,
        entry_price, target_price, target_price_2, stop_loss,
        risk_reward, master_score, technical_score, confidence,
        persona, status, prediction_date, horizon,
        exit_type, morning_bell, explosive_score, evidence_count,
        kill_filter_result
      FROM predictions
      WHERE ${where.join(' AND ')}
      ORDER BY prediction_date DESC, master_score DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    const picks: DailyPick[] = rows.map((r) => {
      const lookup = stocksLookup.get(String(r.ticker));
      const entryPrice = Number(r.entry_price ?? 0);
      const targetPrice = Number(r.target_price ?? 0);
      const stopLoss = Number(r.stop_loss ?? 0);
      const storedRr = Number(r.risk_reward ?? 0);
      // P0-FIX (PHASE1-CRITICAL-FIXES): prefer stored R:R if it's > 0,
      // otherwise compute dynamically from entry/target/stop.
      const riskReward = preferComputedRiskReward(entryPrice, targetPrice, stopLoss, storedRr);
      return {
        ticker: String(r.ticker || ''),
        market: String(r.market || market),
        signal: String(r.signal || ''),
        signal_type: r.signal_type === null ? null : String(r.signal_type),
        entry_price: entryPrice,
        target_price: targetPrice,
        target_price_2: r.target_price_2 === null ? null : Number(r.target_price_2),
        stop_loss: stopLoss,
        risk_reward: riskReward,
        master_score: Number(r.master_score ?? 0),
        technical_score: r.technical_score === null ? null : Number(r.technical_score),
        confidence: r.confidence === null ? null : Number(r.confidence),
        persona: r.persona === null ? null : String(r.persona),
        status: r.status === null ? null : String(r.status),
        prediction_date: String(r.prediction_date || ''),
        horizon: r.horizon === null ? null : String(r.horizon),
        exit_type: r.exit_type === null ? null : String(r.exit_type),
        morning_bell: r.morning_bell === null ? null : Number(r.morning_bell),
        explosive_score: r.explosive_score === null ? null : Number(r.explosive_score),
        evidence_count: r.evidence_count === null ? null : Number(r.evidence_count),
        kill_filter_result:
          r.kill_filter_result === null ? null : String(r.kill_filter_result),
        name_ar: lookup?.name_ar || String(r.ticker || ''),
        sector: lookup?.sector || null,
      };
    });

    db.close();

    // FIX-P4-TARGETS: signal-aware validation قبل ما نحسب الـ stats ونرجّع الـ response.
    // الـ validator بـ يصلّح الـ targets المكسورة (stop فوق entry، target تحت entry، إلخ)
    // أو بـ يرجّع null لو مفيش entry price صالح. الـ signal بيحدد اتجاه الـ validation.
    const validatedPicks = validatePicks(picks);

    // Stats summary for the header card (computed on validated picks)
    const buyCount = validatedPicks.filter((p) =>
      ['BUY', 'STRONG_BUY'].includes(p.signal.toUpperCase())
    ).length;
    const avgConfidence =
      validatedPicks.length > 0
        ? Math.round(
            (validatedPicks.reduce((s, p) => s + (p.confidence ?? p.master_score ?? 0), 0) /
              validatedPicks.length) *
              100
          ) / 100
        : 0;

    return NextResponse.json(applyPicksPaywall({
      success: true,
      source: 'sqlite_fallback',
      picks: validatedPicks,
      count: validatedPicks.length,
      date: date || (validatedPicks[0]?.prediction_date ?? new Date().toISOString().slice(0, 10)),
      stats: {
        total: validatedPicks.length,
        buy_signals: buyCount,
        avg_confidence: avgConfidence,
        market,
      },
      generated_at: new Date().toISOString(),
    }, picksLocked, isPaidUser));
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: 'تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.',
        picks: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}

/**
 * Apply the predictions paywall to the daily-picks response.
 *
 * Per PAYWALL-STRATEGY-FINAL.md §5.2 row 2 + §8.2 marketing copy
 * ("🔓 كل التوقعات V40.2 (مش بس 3)") — free users see only the top 3
 * picks unblurred; the rest are blurred via the canonical
 * `applyPaywallToResults` helper (ticker replaced with '🔒', narrative
 * truncated to 30 chars). Paid users see the full list. Anonymous users
 * (no session) see the full list as the marketing taste hook.
 *
 * The `locked` flag is only set when the caller is an authenticated
 * non-paid user (trial-active or paid-but-expired-but-revalidated).
 * Anonymous callers skip the gate entirely.
 */
function applyPicksPaywall<T extends Record<string, unknown>>(
  payload: T,
  locked: boolean,
  isPaidUser: boolean,
): T {
  if (!locked) return payload;
  const picksArr = Array.isArray(payload.picks) ? payload.picks as unknown[] : [];
  const blurred = applyPaywallToResults(picksArr, isPaidUser);
  return {
    ...payload,
    picks: blurred,
    count: blurred.length,
    locked: true,
    free_preview_count: 3,
    upgradeUrl: '/pricing',
  };
}
