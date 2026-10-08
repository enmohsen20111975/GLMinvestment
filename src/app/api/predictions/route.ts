/**
 * Predictions API
 * ===============
 * يجلب التوقعات من Python Backend مع fallback لـ data_engine.db
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getSessionUserId } from '@/lib/auth-helper';
import { applyValidatedTargets } from '@/lib/targets-validator';
import { trialExpiredResponse } from '@/lib/subscription-gate';
import Database from 'better-sqlite3';
import path from 'path';

export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

/**
 * TASK-C: Parse `analysis_json` of a prediction and extract the
 * `technical_explanation` sub-dict (if present).
 *
 * Returns { technical_explanation, analysis_obj } where technical_explanation
 * is null if not present / parse error / wrong shape.
 */
function parseAnalysisJson(raw: any): {
  technical_explanation: Record<string, any> | null;
  analysis_obj: Record<string, any> | null;
} {
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    return { technical_explanation: null, analysis_obj: null };
  }
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { technical_explanation: null, analysis_obj: null };
    }
    const te = (obj as any).technical_explanation;
    if (te && typeof te === 'object' && !Array.isArray(te) && Object.keys(te).length > 0) {
      return { technical_explanation: te as Record<string, any>, analysis_obj: obj as Record<string, any> };
    }
    return { technical_explanation: null, analysis_obj: obj as Record<string, any> };
  } catch {
    return { technical_explanation: null, analysis_obj: null };
  }
}

/**
 * TASK-C: Enrich a prediction row with technical_explanation (parsed from
 * analysis_json) + ai_reason / ai_narrative (from a stored_analyses join).
 *
 * Mutates the row in place and returns the same row.
 */
function enrichWithTechnical(p: any, storedRow?: any): any {
  const { technical_explanation } = parseAnalysisJson(p?.analysis_json);
  p.technical_explanation = technical_explanation;
  // Don't leak the raw analysis_json blob to the client — keep payload light.
  delete p.analysis_json;
  if (storedRow) {
    p.ai_reason = storedRow.ai_reason ?? null;
    p.ai_narrative = storedRow.ai_narrative ?? null;
  } else {
    p.ai_reason = p.ai_reason ?? null;
    p.ai_narrative = p.ai_narrative ?? null;
  }
  return p;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type') || 'all';
  const requestedLimit = searchParams.get('limit') || '5';
  const market = searchParams.get('market') || '';
  // Task 44-A (2026-10-05): optional ticker filter so SpecialistAnalysisView can
  // fetch the per-stock prediction history. When `ticker` is present we query
  // predictions.db directly (bypassing Python) so the section renders even
  // when the Python service is down — Rule 67: maker-radar/stock + predictions.db
  // are the canonical always-available data sources.
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();

  // Task 40-C (2026-10-04): Maximum 5 predictions per owner directive.
  // Hard cap — even if client requests more, server returns at most 5.
  const HARD_CAP = 5;
  const finalLimit = Math.min(parseInt(requestedLimit, 10) || HARD_CAP, HARD_CAP);

  // Task 13: limit unauthenticated visitors to 3 predictions.
  const { userId } = await getSessionUserId();
  const isAuthenticated = !!userId;
  const limit = isAuthenticated ? String(finalLimit) : String(Math.min(finalLimit, 3));

  // FIX-P3-P5-P6 (Group P3 — Fix 1): server-side trial expiry gate.
  // Authenticated users whose free trial has expired are blocked with 403
  // TRIAL_EXPIRED. Unauthenticated users pass through (the 3-item preview
  // above is their free taste) — the trial gate only applies to logged-in
  // free users whose 14-day window has elapsed.
  if (isAuthenticated) {
    const trialBlock = await trialExpiredResponse(userId);
    if (trialBlock) {
      return NextResponse.json(trialBlock.body, { status: trialBlock.status });
    }
  }

  // ─── Task 44-A (2026-10-05): ticker-scoped history branch ─────────────────
  // When `?ticker=COMI` is provided we bypass the public Python flow and the
  // 5-item HARD_CAP. We read predictions.db directly so the SpecialistAnalysis
  // screen always renders its "Prediction History" section — even when Python
  // 8010 is down. Rule 67: maker-radar/stock + predictions.db are canonical.
  if (ticker) {
    try {
      const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
      let db: Database.Database;
      try {
        db = new Database(dbPath, { readonly: true, timeout: 3000 });
      } catch (e) {
        db = new Database(`file:${dbPath}?immutable=1`, { timeout: 3000 });
      }
      const tickerLimit = Math.min(Math.max(parseInt(requestedLimit, 10) || 10, 1), 20);
      // MARKET-FILTER-COMPLETE (Task MARKET-FILTER-COMPLETE):
      // قبل كده: `WHERE ticker = ?` بس → كان بـ يرجع predictions من كل الأسواق
      // لنفس الـ ticker (فيه 15 ticker متكرر بين EGX و US في predictions.db بسبب
      // migration قديم خربان). الحل: نضيف `AND market IN (...)` بناءً على market param.
      // لو market='' (مش متحدد) بنـ skip الفلتر علشان نحافظ على الـ backward compat.
      const marketVariants: string[] = [];
      if (market) {
        if (market.toUpperCase() === 'EGX') {
          marketVariants.push('EGX', 'مصر');
        } else {
          marketVariants.push(market);
        }
      }
      const marketClause = marketVariants.length > 0
        ? `AND market IN (${marketVariants.map(() => '?').join(',')})`
        : '';
      const marketParams = marketVariants;
      // NOTE: schema uses `risk_reward` (not `risk_reward_ratio`) — the validator
      // below derives `risk_reward_ratio` numerically and merges it into the row.
      const query = `
        SELECT
          id, ticker, signal, signal_type, prediction_date,
          entry_price, entry_price_min, entry_price_max,
          target_price, target_price_2, stop_loss,
          support_level, support_level_2, resistance_level, resistance_level_2,
          master_score, technical_score, fundamental_score, confidence, persona,
          market, outcome_date, exit_price, actual_return,
          hit_target, hit_stop, is_correct, holding_days,
          status, risk_reward, created_at, analysis_json
        FROM predictions
        WHERE ticker = ? ${marketClause}
        ORDER BY prediction_date DESC, id DESC
        LIMIT ?`;
      const preds = db.prepare(query).all(ticker, ...marketParams, tickerLimit) as any[];
      // DON'T close db here — we need it for the accuracy query below.

      // TASK-C: Fetch latest stored_analyses rows for this ticker in one shot
      // (so we can attach ai_reason / ai_narrative to each prediction).
      // FRESHNESS-CHECK (Task PHASE-3, Rule 72)
      // TODO: Add `AND updated_at >= datetime('now', '-2 days')` to filter stale analyses.
      let storedByTicker: any = null;
      try {
        const storedRows = db.prepare(
          `SELECT ticker, ai_reason, ai_narrative
           FROM stored_analyses
           WHERE ticker = ?
           ORDER BY updated_at DESC
           LIMIT 1`
        ).all(ticker) as any[];
        if (storedRows.length > 0) storedByTicker = storedRows[0];
      } catch (e) {
        // stored_analyses table may be missing in older DBs — ignore.
        console.warn('[/api/predictions] stored_analyses lookup failed:', (e as any)?.message);
      }

      const validated = preds.map((p) => {
        const v = applyValidatedTargets({
          signal: p.signal || 'BUY',
          entry_price: p.entry_price,
          current_price: p.entry_price,
          target1: p.target_price,
          stop_loss: p.stop_loss,
        });
        // Task FINALIZE-UNIFICATION (Rule 27): removed fabricated fallbacks
        // (entry*0.99/1.01, support entry*0.96, target1*1.05). Now NULL when
        // the prediction record lacks these fields.
        const entryMin = (p.entry_price_min && p.entry_price_min > 0) ? p.entry_price_min : null;
        const entryMax = (p.entry_price_max && p.entry_price_max > 0) ? p.entry_price_max : null;
        const s1 = (p.support_level && p.support_level > 0) ? p.support_level : null;
        const s2 = (p.support_level_2 && p.support_level_2 > 0) ? p.support_level_2 : null;
        const r1 = (p.resistance_level && p.resistance_level > 0) ? p.resistance_level : (validated.target1 ?? null);
        const r2 = (p.resistance_level_2 && p.resistance_level_2 > 0) ? p.resistance_level_2 : (p.target_price_2 ?? null);

        return enrichWithTechnical({
          ...p,
          signal: v.signal,
          entry_price: v.entry_price,
          entry_price_min: entryMin,
          entry_price_max: entryMax,
          entry_min: entryMin,
          entry_max: entryMax,
          entry_range_str: (entryMin && entryMax) ? `من ${entryMin.toFixed(2)} إلى ${entryMax.toFixed(2)} ج.م` : '',
          target_price: v.target1,
          // Rule 27: NULL when no canonical target_price_2 (was target1 * 1.05).
          target_price_2: p.target_price_2 ?? null,
          target1: v.target1,
          target2: p.target_price_2 ?? null,
          stop_loss: v.stop_loss,
          support_1: s1,
          support_2: s2,
          support_level: s1,
          resistance_1: r1,
          resistance_2: r2,
          resistance_level: r1,
          risk_reward_ratio: v.risk_reward_ratio ?? p.risk_reward,
        }, storedByTicker || undefined);
      });

      // Accuracy stat ONLY if ≥5 closed predictions (Rule 67).
      // FIX (Task 44-A): compute accuracy from ALL closed predictions for this
      // ticker, NOT just the limited set (was 5). The limited set might all be
      // negative (most recent ones), giving 0% accuracy even though the real
      // accuracy across 191 predictions is 80%.
      const accQuery = `
        SELECT COUNT(*) as total,
               SUM(CASE WHEN actual_return > 0 THEN 1 ELSE 0 END) as hits
        FROM predictions
        WHERE ticker = ?
          AND status IN ('EXPIRED', 'STOPPED', 'TARGET_HIT')
          AND actual_return IS NOT NULL
          ${marketClause}`;
      const accRow = db.prepare(accQuery).get(ticker, ...marketParams) as { total: number; hits: number } | undefined;
      const allClosed = accRow?.total ?? 0;
      const allHits = accRow?.hits ?? 0;
      const accuracy = allClosed >= 5
        ? Math.round((allHits / allClosed) * 100)
        : null;
      db.close();

      // closed/hits from the limited set (for display only)
      const closed = validated.filter((p) => {
        const st = (p.status || '').toUpperCase();
        return st === 'EXPIRED' || st === 'STOPPED' || st === 'TARGET_HIT'
          || p.actual_return != null || p.outcome_date != null;
      });
      const hits = closed.filter((p) => (p.actual_return ?? 0) > 0).length;

      return NextResponse.json({
        success: true,
        authenticated: isAuthenticated,
        limited: !isAuthenticated,
        ticker,
        data: validated,
        stats: {
          total: validated.length,
          closedCount: closed.length,
          hits,
          accuracy,             // null until ≥5 closed (Rule 67)
          avgScore: validated.length > 0
            ? Math.round(validated.reduce((s, p) => s + (p.confidence || p.master_score || 0), 0) / validated.length)
            : 0,
        },
        source: 'local_db_ticker',
      });
    } catch (e: any) {
      console.warn("[/api/predictions] ticker branch error:", e?.message || e);
      return NextResponse.json({
        success: true,
        ticker,
        data: [],
        stats: { total: 0, closedCount: 0, hits: 0, accuracy: null, avgScore: 0 },
        source: 'local_db_ticker_empty',
        error: 'ticker lookup failed',
      });
    }
  }

  // 1. Try Python Backend
  try {
    const qs = new URLSearchParams({ limit });
    if (type && type !== 'all') qs.set('signal', type);
    if (market) qs.set('market', market);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `${PYTHON_BACKEND_URL}/api/v2/predictions?${qs.toString()}`,
      {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const predictions = data.predictions || data.data || [];
      return NextResponse.json({
        success: true,
        authenticated: isAuthenticated,
        limited: !isAuthenticated,
        data: predictions,
        stats: {
          total: predictions.length,
          avgScore: data.stats?.avg_score || 0,
        },
        source: 'python_backend',
      });
    }
  } catch (e) {
    console.warn('[/api/predictions] Python backend error:', e);
  }

  // 2. Fallback: query predictions.db directly
  try {
    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    let db: Database.Database;
    try {
      db = new Database(dbPath, { readonly: true, timeout: 3000 });
    } catch (e) {
      db = new Database(`file:${dbPath}?immutable=1`, { timeout: 3000 });
    }

    // FIX (Aug 2026): aiPrediction table فاضي (0 صفوف) — استخدم predictions table
    // الـ schema: ticker, signal, prediction_date, entry_price, target_price, stop_loss,
    // master_score, confidence, market, outcome_date, exit_price, actual_return
    // MARKET-FILTER-COMPLETE: السطر ده كان بـ يـ ORDER + LIMIT بس من غير WHERE، فكان
    // بـ يخلط predictions من كل الأسواق. بناءً على market param نضيف WHERE clause.
    // لو market مش متحدد بنـ skip الفلتر (backward compat — يرجّع كل الأسواق).
    const fbMarketVariants: string[] = [];
    if (market) {
      if (market.toUpperCase() === 'EGX') {
        fbMarketVariants.push('EGX', 'مصر');
      } else {
        fbMarketVariants.push(market);
      }
    }
    const fbMarketClause = fbMarketVariants.length > 0
      ? `WHERE market IN (${fbMarketVariants.map(() => '?').join(',')})`
      : '';
    const fbMarketParams = fbMarketVariants;
    let query = `
      SELECT
        id,
        ticker,
        signal,
        signal_type,
        prediction_date,
        entry_price,
        entry_price_min,
        entry_price_max,
        target_price,
        target_price_2,
        stop_loss,
        support_level,
        support_level_2,
        resistance_level,
        resistance_level_2,
        master_score,
        confidence,
        market,
        outcome_date,
        exit_price,
        actual_return,
        hit_target,
        hit_stop,
        is_correct,
        holding_days,
        created_at,
        analysis_json
      FROM predictions
      ${fbMarketClause}
      ORDER BY prediction_date DESC, master_score DESC
      LIMIT ?`;
    const predictions = db.prepare(query).all(...fbMarketParams, parseInt(limit)) as any[];

    // TASK-C: Batch-fetch the latest stored_analyses row per ticker (for ai_reason / ai_narrative)
    // FRESHNESS-CHECK (Task PHASE-3, Rule 72)
    // TODO: Add `AND updated_at >= datetime('now', '-2 days')` to filter stale analyses.
    let storedByTicker: Record<string, any> = {};
    try {
      const tickers = Array.from(new Set(predictions.map((p) => p.ticker).filter(Boolean))) as string[];
      if (tickers.length > 0) {
        const placeholders = tickers.map(() => '?').join(',');
        const rows = db.prepare(
          `SELECT ticker, ai_reason, ai_narrative
           FROM stored_analyses
           WHERE ticker IN (${placeholders})
           ORDER BY updated_at DESC`
        ).all(...tickers) as any[];
        for (const r of rows) {
          // Keep only the first (most recent) row per ticker.
          if (!storedByTicker[r.ticker]) storedByTicker[r.ticker] = r;
        }
      }
    } catch (e) {
      console.warn('[/api/predictions] stored_analyses join failed:', (e as any)?.message);
    }
    db.close();

    // TARGETS-VALIDATOR (2026-09-30): نتأكد إن كل الـ targets منطقية ورياضياً صحيحة
    const validatedPredictions = predictions.map((p) => {
      const validated = applyValidatedTargets({
        signal: p.signal || 'BUY',
        entry_price: p.entry_price,
        current_price: p.entry_price, // predictions مفيهاش current_price منفصل
        target1: p.target_price,
        stop_loss: p.stop_loss,
      });
      // Task FINALIZE-UNIFICATION (Rule 27): removed fabricated fallbacks
      // (entry*0.99/1.01, support entry*0.96, target1*1.05). Now NULL when
      // the prediction record lacks these fields.
      const entryMin = (p.entry_price_min && p.entry_price_min > 0) ? p.entry_price_min : null;
      const entryMax = (p.entry_price_max && p.entry_price_max > 0) ? p.entry_price_max : null;
      const s1 = (p.support_level && p.support_level > 0) ? p.support_level : null;
      const s2 = (p.support_level_2 && p.support_level_2 > 0) ? p.support_level_2 : null;
      const r1 = (p.resistance_level && p.resistance_level > 0) ? p.resistance_level : (validated.target1 ?? null);
      const r2 = (p.resistance_level_2 && p.resistance_level_2 > 0) ? p.resistance_level_2 : (p.target_price_2 ?? null);

      return enrichWithTechnical({
        ...p,
        signal: validated.signal,
        entry_price: validated.entry_price,
        entry_price_min: entryMin,
        entry_price_max: entryMax,
        entry_min: entryMin,
        entry_max: entryMax,
        entry_range_str: (entryMin && entryMax) ? `من ${entryMin.toFixed(2)} إلى ${entryMax.toFixed(2)} ج.م` : '',
        target_price: validated.target1,
        // Rule 27: NULL when no canonical target_price_2 (was target1 * 1.05).
        target_price_2: p.target_price_2 ?? null,
        target1: validated.target1,
        target2: p.target_price_2 ?? null,
        stop_loss: validated.stop_loss,
        support_1: s1,
        support_2: s2,
        support_level: s1,
        resistance_1: r1,
        resistance_2: r2,
        resistance_level: r1,
        risk_reward_ratio: validated.risk_reward_ratio,
      }, storedByTicker[p.ticker]);
    });

    return NextResponse.json({
      success: true,
      authenticated: isAuthenticated,
      limited: !isAuthenticated,
      data: validatedPredictions,
      stats: {
        total: predictions.length,
        avgScore: predictions.length > 0
          ? Math.round(predictions.reduce((s, p) => s + (p.confidence || p.master_score || 0), 0) / predictions.length)
          : 0,
      },
      source: 'local_db',
    });
  } catch (e) {
    console.warn('[/api/predictions] Local DB error:', e);
  }

  // 3. Final fallback: empty but success
  return NextResponse.json({
    success: true,
    data: [],
    stats: { total: 0, avgScore: 0 },
    source: 'empty',
    note: 'لا توجد توقعات متاحة حالياً',
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Forward to Python backend
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/v2/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      return NextResponse.json(await response.json());
    }
  } catch (e) {
    console.warn('[/api/predictions] POST error:', e);
  }

  return NextResponse.json({
    success: false,
    error: 'فشل في توليد التوقعات. حاول مرة أخرى لاحقاً.',
  }, { status: 500 });
}
