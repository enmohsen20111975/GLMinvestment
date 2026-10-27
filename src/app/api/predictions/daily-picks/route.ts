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
// (ALPHA-DAL-WAVE2 — owner directive 2026-10-27):
// «إزالة استدعاء new Database(...) نهائياً. البديل: openDb من DbManager.»
import { openDb } from '@/lib/db-manager';

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

// ============================================================================
// S-1.3 (Bravo, Integration Stabilization) — Trusted market_regime_info source
// ============================================================================
// When the Python backend is OFFLINE, the Next.js fallback path used to return
// `{picks: []}` WITHOUT a `market_regime_info` field, so the user saw empty
// picks with NO explanation. The frontend (A4 MarketRegimeBanner) relies on
// `market_regime_info` to render the NO_TRADE banner — without it, the UI
// falls back to "regime unavailable" which is honest but vague.
//
// The TRUSTED source for the regime is the same one Python reads:
//   `stocks.db.system_settings` with key `current_regime_<MARKET>`.
// The regime is persisted by `analyzers/market_regime_engine.py`
// (MarketRegimeEngine.update_regime()). We READ it here — NEVER fabricate.
//
// Shape mirrors what `api/misc_routes.py::_b4_get_market_regime_info()` returns
// (B4-MARKET-REGIME-FIX, Task 1-c). If stocks.db is missing or the row is
// absent, we return `null` + `no_trade_reason: "backend_offline"` (honest —
// NOT a fabricated DEFENSIVE/OFFENSIVE regime).
// ============================================================================

interface MarketRegimeInfo {
  market_regime: 'DEFENSIVE' | 'NORMAL' | 'AGGRESSIVE' | null;
  market_regime_source: string;
  market_regime_reasons: string[];
  market_regime_last_update: string;
  no_trade_reason: string;
}

const REGIME_MARKET_MAP: Record<string, string> = {
  EGX: 'EGX',
  EGYPT: 'EGX',
  TADAWUL: 'TADAWUL',
  KSA: 'TADAWUL',
  SAUDI: 'TADAWUL',
  KSE: 'KSE',
  KUWAIT: 'KSE',
  QSE: 'QSE',
  QATAR: 'QSE',
  CRYPTO: 'CRYPTO',
  BINANCE: 'CRYPTO',
};

function _regimeNoTradeReason(
  regime: 'DEFENSIVE' | 'NORMAL' | 'AGGRESSIVE' | null,
  picksCount: number,
): string {
  if (picksCount > 0) return '';
  if (regime === null) {
    return 'backend_offline — Python backend is down and no persisted market regime was found. Cash/wait position.';
  }
  if (regime === 'DEFENSIVE') {
    return (
      'BEAR/DEFENSIVE market regime — no qualifying BUY signals passed the ' +
      'regime-aware min_score + min_rr gates. Hold cash; NO_TRADE decision preserved.'
    );
  }
  if (regime === 'NORMAL') {
    return 'NORMAL market regime — no BUY signals currently qualify. Cash/wait position.';
  }
  if (regime === 'AGGRESSIVE') {
    return 'AGGRESSIVE market regime — no BUY signals currently qualify. Unusual; verify data freshness.';
  }
  return 'No qualifying BUY signals — cash/wait.';
}

function _readRegimeFromStocksDb(marketCode: string): {
  regime: 'DEFENSIVE' | 'NORMAL' | 'AGGRESSIVE' | null;
  source: string;
  reasons: string[];
  lastUpdate: string;
} | null {
  // Read the persisted regime from stocks.db.system_settings.
  // Returns null if stocks.db is missing OR the regime row is absent
  // (in which case the caller MUST NOT fabricate a regime — it should
  // surface `market_regime: null` + `no_trade_reason: "backend_offline"`).
  try {
    const fs = require('fs');
    const stocksDbPath = require('path').join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(stocksDbPath)) return null;
    // (ALPHA-DAL-WAVE2): استخدم openDb من الـ DAL — ممنوع new Database().
    const db = openDb('stocks.db');
    if (!db) return null;
    try {
      // Idempotent-ish: if system_settings doesn't exist, return null.
      const marketKey = REGIME_MARKET_MAP[(marketCode || 'EGX').toUpperCase()] || 'EGX';
      const settingsKey = `current_regime_${marketKey}`;
      const row = db
        .prepare('SELECT value FROM system_settings WHERE key = ?')
        .get(settingsKey) as { value?: string } | undefined;
      if (!row || !row.value) {
        return { regime: null, source: 'system_settings_missing', reasons: [], lastUpdate: '' };
      }
      let parsed: { current_regime?: string; last_update?: string; reasons?: string[] };
      try {
        parsed = JSON.parse(row.value);
      } catch {
        return { regime: null, source: 'system_settings_invalid_json', reasons: [], lastUpdate: '' };
      }
      let regime = (parsed.current_regime || '').toUpperCase();
      if (!['DEFENSIVE', 'NORMAL', 'AGGRESSIVE'].includes(regime)) {
        regime = '';
      }
      const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [];
      const lastUpdate = parsed.last_update || '';
      return {
        regime: (regime || null) as 'DEFENSIVE' | 'NORMAL' | 'AGGRESSIVE' | null,
        source: 'MarketRegimeEngine',
        reasons,
        lastUpdate,
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function _buildMarketRegimeInfo(marketCode: string, picksCount: number): MarketRegimeInfo {
  const read = _readRegimeFromStocksDb(marketCode);
  if (read === null) {
    // stocks.db missing OR error reading → DO NOT fabricate a regime.
    // Surface null + honest "backend_offline" reason.
    return {
      market_regime: null,
      market_regime_source: 'stocks_db_missing',
      market_regime_reasons: [],
      market_regime_last_update: '',
      no_trade_reason: _regimeNoTradeReason(null, picksCount),
    };
  }
  return {
    market_regime: read.regime,
    market_regime_source: read.source,
    market_regime_reasons: read.reasons,
    market_regime_last_update: read.lastUpdate,
    no_trade_reason: _regimeNoTradeReason(read.regime, picksCount),
  };
}

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
      // PHASE3-MARKET-SEGREGATION: graceful fallback when DB file is missing.
      // S-1.3 (Bravo): also surface market_regime_info so the frontend's
      // MarketRegimeBanner can render an honest NO_TRADE banner explaining
      // WHY picks is empty (not just "no data"). The regime is read from
      // the trusted stocks.db.system_settings source — NOT fabricated.
      const marketRaw0 = (url.searchParams.get('market') || 'EGX').toUpperCase();
      const market0 = MARKET_MAP[marketRaw0] || 'EGX';
      return NextResponse.json(
        {
          success: true,
          picks: [],
          count: 0,
          message: 'لا توجد توقعات متاحة لهذا السوق حالياً. يتم توليد التوقعات للسوق المصري أولاً، ثم تُضاف بقية الأسواق تدريجياً.',
          source: 'db-missing',
          market_regime_info: _buildMarketRegimeInfo(market0, 0),
        },
        {
          status: 200,
          headers: { 'X-Data-Source': 'db-missing' },
        }
      );
    }
    // (ALPHA-DAL-WAVE2): استخدم openDb من الـ DAL — ممنوع new Database().
    const db = openDb(dbPath.endsWith('predictions.db') ? 'predictions.db' : 'predictions.db');

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
      // (ALPHA-DAL-WAVE2): استخدم openDb من الـ DAL — ممنوع new Database().
      const stocksDb = openDb('stocks.db');
      if (stocksDb) {
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
      ['BUY', 'STRONG_BUY'].includes((p.signal || '').toUpperCase())
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
      // S-1.3 (Bravo): same trusted market_regime_info shape as Python.
      // The frontend's MarketRegimeBanner (A4) can now render the
      // NO_TRADE banner explaining WHY picks is empty even when Python
      // is offline. Read from stocks.db.system_settings (the persisted
      // regime) — NEVER fabricated.
      market_regime_info: _buildMarketRegimeInfo(market, validatedPicks.length),
      generated_at: new Date().toISOString(),
    }, picksLocked, isPaidUser));
  } catch (e) {
    // PHASE3-MARKET-SEGREGATION (Task B): same graceful-fallback rule as
    // honest-tracking/list — never return 500 to the client. The error is
    // logged server-side for diagnostics, but the UI gets an empty list +
    // a friendly Arabic message so the user can keep browsing other tabs.
    //
    // S-1.3 (Bravo): still surface market_regime_info so the frontend's
    // NO_TRADE banner can render. We have NO picks to count, so picksCount=0
    // — the regime read is best-effort; if stocks.db is unreadable, the
    // regime becomes `null` with `no_trade_reason: "backend_offline"`.
    const marketRawErr = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const marketErr = MARKET_MAP[marketRawErr] || 'EGX';
    return NextResponse.json(
      {
        success: true,
        picks: [],
        count: 0,
        message: 'لا توجد توقعات متاحة لهذا السوق حالياً. يتم توليد التوقعات للسوق المصري أولاً، ثم تُضاف بقية الأسواق تدريجياً.',
        source: 'error-fallback',
        market_regime_info: _buildMarketRegimeInfo(marketErr, 0),
      },
      {
        status: 200,
        headers: { 'X-Data-Source': 'error-fallback' },
      }
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
