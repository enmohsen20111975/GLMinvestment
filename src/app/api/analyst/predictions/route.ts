/**
 * API Route: Analyst Predictions
 * ==============================
 * إدارة توقعات المحللين
 *
 * KPI Alignment Agent — gold standard alignment
 * Mirrors src/app/api/admin/platform-performance/route.ts logic:
 *   1. n_raw / n_valid / n_excluded
 *   2. exclusion_breakdown
 *   3. capped_rows (HARD cap ±50 on pnl_pct — Constitution Rule 7)
 *   4. avg_loss_pct negative (sign convention — Rule 9)
 *   5. HARD cap: ABS(pnl_pct) <= 50 in every aggregate
 *
 * NOTE — channel separation (Rule 8):
 *   analyst_predictions has no morning_bell column (it tracks individual
 *   analyst calls, not platform channels). Channel separation is NOT
 *   applicable here, so audit_status is marked 'non-audited' for that
 *   specific rule. All other gold-standard rules are satisfied.
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';

// ============================================================================
// Gold standard constants
// ============================================================================
const HARD_CAP = 50.0; // Constitution Rule 7: ABS(pnl_pct) <= 50

// ============================================================================
// Audit result type — returned by updateAnalystPerformance so callers (PUT
// endpoint) can include the audit fields in their response.
// ============================================================================
interface KpiAuditResult {
  n_raw: number;
  n_valid: number;
  n_excluded: number;
  exclusion_breakdown: Record<string, number>;
  capped_rows: number;
  avg_loss_pct: number; // negative when losses exist (Rule 9)
  avg_win_pct: number; // positive
  worst_return: number | null; // negative when losses exist (Rule 9)
  best_return: number | null; // positive
  audit_status: 'non-audited';
  audit_note: string;
}

// GET /api/analyst/predictions - جلب التوقعات
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const analystId = searchParams.get('analyst_id');
    const status = searchParams.get('status') || 'active';
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = `SELECT * FROM analyst_predictions WHERE 1=1`;
    const params: unknown[] = [];

    if (ticker) {
      query += ` AND ticker = ?`;
      params.push(ticker);
    }
    if (analystId) {
      query += ` AND analyst_id = ?`;
      params.push(analystId);
    }
    if (status !== 'all') {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY prediction_date DESC LIMIT ?`;
    params.push(limit);

    const predictions = await db.$queryRawUnsafe(query, ...params);

    // حساب الإحصائيات — gold standard aligned:
    //   - HARD cap ±50 on pnl_pct (Constitution Rule 7)
    //   - n_raw / n_valid / n_excluded + exclusion_breakdown
    //   - avg_loss_pct negative (Rule 9)
    //   - capped_rows reported
    //
    // The CASE WHEN expressions clamp pnl_pct to [-50, 50] before every
    // aggregate (AVG, SUM, MAX, MIN). Rows with NULL pnl_pct or missing
    // actual_result are excluded from the measured aggregates and counted
    // in the exclusion breakdown.
    const stats = await db.$queryRaw`
      SELECT
        COUNT(*) AS n_raw,
        SUM(CASE WHEN actual_result IS NOT NULL AND actual_result != '' AND pnl_pct IS NOT NULL THEN 1 ELSE 0 END) AS n_valid,
        SUM(CASE WHEN actual_result IS NULL OR actual_result = '' THEN 1 ELSE 0 END) AS n_excluded_no_result,
        SUM(CASE WHEN pnl_pct IS NULL AND actual_result IS NOT NULL AND actual_result != '' THEN 1 ELSE 0 END) AS n_excluded_no_pnl,
        SUM(CASE WHEN pnl_pct IS NOT NULL AND ABS(pnl_pct) > ${HARD_CAP} THEN 1 ELSE 0 END) AS capped_rows,
        SUM(CASE WHEN actual_result = prediction THEN 1 ELSE 0 END) AS correct,
        SUM(CASE WHEN actual_result != prediction AND actual_result IS NOT NULL THEN 1 ELSE 0 END) AS wrong,
        AVG(CASE
              WHEN pnl_pct IS NULL THEN NULL
              WHEN pnl_pct > ${HARD_CAP} THEN ${HARD_CAP}
              WHEN pnl_pct < ${-HARD_CAP} THEN ${-HARD_CAP}
              ELSE pnl_pct
            END) AS avg_return,
        AVG(CASE
              WHEN pnl_pct IS NULL THEN NULL
              WHEN pnl_pct <= 0 THEN NULL
              WHEN pnl_pct > ${HARD_CAP} THEN ${HARD_CAP}
              ELSE pnl_pct
            END) AS avg_win_pct_raw,
        AVG(CASE
              WHEN pnl_pct IS NULL THEN NULL
              WHEN pnl_pct >= 0 THEN NULL
              WHEN pnl_pct < ${-HARD_CAP} THEN ${-HARD_CAP}
              ELSE pnl_pct
            END) AS avg_loss_pct_raw,
        SUM(CASE
              WHEN pnl_pct IS NULL THEN 0
              WHEN pnl_pct > ${HARD_CAP} THEN ${HARD_CAP}
              WHEN pnl_pct < ${-HARD_CAP} THEN ${-HARD_CAP}
              ELSE pnl_pct
            END) AS total_return,
        MAX(CASE
              WHEN pnl_pct IS NULL THEN NULL
              WHEN pnl_pct > ${HARD_CAP} THEN ${HARD_CAP}
              ELSE pnl_pct
            END) AS best_return,
        MIN(CASE
              WHEN pnl_pct IS NULL THEN NULL
              WHEN pnl_pct < ${-HARD_CAP} THEN ${-HARD_CAP}
              ELSE pnl_pct
            END) AS worst_return
      FROM analyst_predictions
      WHERE status = 'reviewed'
    `;

    const rawStats = (stats as Record<string, number | null>[])[0] || {};
    const nRaw = Number(rawStats.n_raw || 0);
    const nValid = Number(rawStats.n_valid || 0);
    const nExcludedNoResult = Number(rawStats.n_excluded_no_result || 0);
    const nExcludedNoPnl = Number(rawStats.n_excluded_no_pnl || 0);
    const nExcluded = nExcludedNoResult + nExcludedNoPnl;
    const cappedRows = Number(rawStats.capped_rows || 0);

    // avg_loss_pct MUST be negative (gold standard Rule 9). The SQL returns
    // the raw average of capped negative values (already negative); we
    // negate the absolute value defensively in case the DB returns 0 or NULL.
    const avgLossRaw = rawStats.avg_loss_pct_raw !== null ? Number(rawStats.avg_loss_pct_raw) : null;
    const avgLossPct =
      avgLossRaw !== null && avgLossRaw < 0
        ? avgLossRaw
        : avgLossRaw !== null && avgLossRaw > 0
        ? -avgLossRaw // defensive: flip positive to negative
        : 0;
    const avgWinPct = rawStats.avg_win_pct_raw !== null ? Number(rawStats.avg_win_pct_raw) : 0;

    const exclusionBreakdown: Record<string, number> = {};
    if (nExcludedNoResult > 0) exclusionBreakdown.no_actual_result = nExcludedNoResult;
    if (nExcludedNoPnl > 0) exclusionBreakdown.no_pnl_pct = nExcludedNoPnl;

    const audit: KpiAuditResult = {
      n_raw: nRaw,
      n_valid: nValid,
      n_excluded: nExcluded,
      exclusion_breakdown: exclusionBreakdown,
      capped_rows: cappedRows,
      avg_loss_pct: avgLossPct, // negative (Rule 9)
      avg_win_pct: avgWinPct,
      worst_return: rawStats.worst_return !== null ? Number(rawStats.worst_return) : null,
      best_return: rawStats.best_return !== null ? Number(rawStats.best_return) : null,
      audit_status: 'non-audited',
      audit_note:
        'analyst_predictions table has no morning_bell column — channel ' +
        'separation (Rule 8) is not applicable. HARD cap ±50 applied to ' +
        'pnl_pct in every aggregate. avg_loss_pct is negative.',
    };

    return NextResponse.json({
      success: true,
      predictions,
      stats: {
        total: nRaw, // backward-compat alias
        correct: Number(rawStats.correct || 0),
        wrong: Number(rawStats.wrong || 0),
        avg_return: rawStats.avg_return !== null ? Number(rawStats.avg_return) : 0,
        total_return: rawStats.total_return !== null ? Number(rawStats.total_return) : 0,
        best_return: rawStats.best_return !== null ? Number(rawStats.best_return) : null,
        worst_return: rawStats.worst_return !== null ? Number(rawStats.worst_return) : null,
        // ---- Audit fields (gold standard) ----
        n_raw: nRaw,
        n_valid: nValid,
        n_excluded: nExcluded,
        exclusion_breakdown: exclusionBreakdown,
        capped_rows: cappedRows,
        avg_loss_pct: avgLossPct, // negative
        avg_win_pct: avgWinPct,
      },
      audit,
    });
  } catch (error) {
    console.error('Error fetching predictions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch predictions' },
      { status: 500 }
    );
  }
}

// POST /api/analyst/predictions - إنشاء توقع جديد
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      analyst_id,
      analyst_name,
      ticker,
      prediction,
      target_price,
      stop_loss,
      confidence,
      notes,
      rsi_at_prediction,
      sma20_at_prediction,
      sma50_at_prediction,
      price_at_prediction
    } = body;

    if (!analyst_id || !ticker || !prediction) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: analyst_id, ticker, prediction' },
        { status: 400 }
      );
    }

    if (!['up', 'down', 'neutral'].includes(prediction)) {
      return NextResponse.json(
        { success: false, error: 'Invalid prediction. Must be: up, down, or neutral' },
        { status: 400 }
      );
    }

    // إنشاء التوقع
    const id = crypto.randomUUID();

    await db.$executeRaw`
      INSERT INTO analyst_predictions (
        id, analyst_id, analyst_name, ticker, prediction_date,
        prediction, target_price, stop_loss, confidence, notes,
        rsi_at_prediction, sma20_at_prediction, sma50_at_prediction, price_at_prediction,
        status, created_at, updated_at
      ) VALUES (
        ${id},
        ${analyst_id},
        ${analyst_name || null},
        ${ticker},
        datetime('now'),
        ${prediction},
        ${target_price || null},
        ${stop_loss || null},
        ${confidence || 5},
        ${notes || null},
        ${rsi_at_prediction || null},
        ${sma20_at_prediction || null},
        ${sma50_at_prediction || null},
        ${price_at_prediction || null},
        'active',
        datetime('now'),
        datetime('now')
      )
    `;

    // تحديث أداء المحلل
    await updateAnalystPerformance(analyst_id);

    return NextResponse.json({
      success: true,
      message: 'تم حفظ التوقع بنجاح',
      prediction_id: id
    });
  } catch (error) {
    console.error('Error creating prediction:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create prediction' },
      { status: 500 }
    );
  }
}

// PUT /api/analyst/predictions - مراجعة توقع
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { prediction_id, actual_result, actual_price, pnl_pct } = body;

    if (!prediction_id || !actual_result) {
      return NextResponse.json(
        { success: false, error: 'Missing prediction_id or actual_result' },
        { status: 400 }
      );
    }

    // KPI Alignment — defensive HARD cap ±50 on the stored pnl_pct BEFORE
    // writing. The aggregate queries also re-cap, but storing the capped
    // value prevents a single 5000% outlier from skewing future reads.
    let cappedPnl = pnl_pct;
    if (cappedPnl !== null && cappedPnl !== undefined) {
      const n = Number(cappedPnl);
      if (Number.isFinite(n)) {
        cappedPnl = Math.max(-HARD_CAP, Math.min(HARD_CAP, n));
      }
    }

    await db.$executeRaw`
      UPDATE analyst_predictions
      SET 
        status = 'reviewed',
        review_date = datetime('now'),
        actual_result = ${actual_result},
        actual_price = ${actual_price || null},
        pnl_pct = ${cappedPnl ?? null},
        updated_at = datetime('now')
      WHERE id = ${prediction_id}
    `;

    // جلب analyst_id لتحديث الأداء
    const prediction = await db.$queryRaw`
      SELECT analyst_id FROM analyst_predictions WHERE id = ${prediction_id}
    `;

    const p = prediction as Record<string, unknown>[];
    let auditResult: KpiAuditResult | null = null;
    if (p[0]?.analyst_id) {
      auditResult = await updateAnalystPerformance(p[0].analyst_id as string);
    }

    return NextResponse.json({
      success: true,
      message: 'تم مراجعة التوقع بنجاح',
      audit: auditResult,
    });
  } catch (error) {
    console.error('Error reviewing prediction:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to review prediction' },
      { status: 500 }
    );
  }
}

// تحديث أداء المحلل — gold standard aligned
// Returns KpiAuditResult so the PUT endpoint can surface the audit fields
// (n_raw, n_valid, n_excluded, exclusion_breakdown, capped_rows, avg_loss_pct)
// in its response.
async function updateAnalystPerformance(analystId: string): Promise<KpiAuditResult> {
  // SQL aggregate with HARD cap ±50 on pnl_pct in EVERY aggregate (Rule 7).
  // CASE WHEN clamps pnl_pct to [-50, 50] before AVG/SUM/MAX/MIN. NULLs are
  // preserved in MAX/MIN/AVG (so they don't pull aggregates toward zero) and
  // counted as 0 in SUM (so they don't double-count).
  //
  // Exclusion logic:
  //   - n_raw = all 'reviewed' rows for this analyst
  //   - n_valid = reviewed + has actual_result + has pnl_pct
  //   - n_excluded = n_raw - n_valid (broken into no_actual_result / no_pnl_pct)
  const stats = await db.$queryRaw`
      SELECT
        COUNT(*) AS n_raw,
        SUM(CASE WHEN actual_result IS NOT NULL AND actual_result != '' AND pnl_pct IS NOT NULL THEN 1 ELSE 0 END) AS n_valid,
        SUM(CASE WHEN actual_result IS NULL OR actual_result = '' THEN 1 ELSE 0 END) AS n_excluded_no_result,
        SUM(CASE WHEN pnl_pct IS NULL AND actual_result IS NOT NULL AND actual_result != '' THEN 1 ELSE 0 END) AS n_excluded_no_pnl,
        SUM(CASE WHEN pnl_pct IS NOT NULL AND ABS(pnl_pct) > ${HARD_CAP} THEN 1 ELSE 0 END) AS capped_rows,
        SUM(CASE WHEN actual_result = prediction THEN 1 ELSE 0 END) AS correct,
        SUM(CASE WHEN actual_result != prediction AND actual_result IS NOT NULL THEN 1 ELSE 0 END) AS wrong,
        AVG(CASE
              WHEN pnl_pct IS NULL THEN NULL
              WHEN pnl_pct > ${HARD_CAP} THEN ${HARD_CAP}
              WHEN pnl_pct < ${-HARD_CAP} THEN ${-HARD_CAP}
              ELSE pnl_pct
            END) AS avg_return,
        AVG(CASE
              WHEN pnl_pct IS NULL THEN NULL
              WHEN pnl_pct <= 0 THEN NULL
              WHEN pnl_pct > ${HARD_CAP} THEN ${HARD_CAP}
              ELSE pnl_pct
            END) AS avg_win_pct_raw,
        AVG(CASE
              WHEN pnl_pct IS NULL THEN NULL
              WHEN pnl_pct >= 0 THEN NULL
              WHEN pnl_pct < ${-HARD_CAP} THEN ${-HARD_CAP}
              ELSE pnl_pct
            END) AS avg_loss_pct_raw,
        SUM(CASE
              WHEN pnl_pct IS NULL THEN 0
              WHEN pnl_pct > ${HARD_CAP} THEN ${HARD_CAP}
              WHEN pnl_pct < ${-HARD_CAP} THEN ${-HARD_CAP}
              ELSE pnl_pct
            END) AS total_return,
        MAX(CASE
              WHEN pnl_pct IS NULL THEN NULL
              WHEN pnl_pct > ${HARD_CAP} THEN ${HARD_CAP}
              ELSE pnl_pct
            END) AS best_return,
        MIN(CASE
              WHEN pnl_pct IS NULL THEN NULL
              WHEN pnl_pct < ${-HARD_CAP} THEN ${-HARD_CAP}
              ELSE pnl_pct
            END) AS worst_return
      FROM analyst_predictions
      WHERE analyst_id = ${analystId} AND status = 'reviewed'
    `;

  const s = (stats as Record<string, number | null>[])[0] || {};
  const total = Number(s?.n_raw || 0);
  const nValid = Number(s?.n_valid || 0);
  const nExcludedNoResult = Number(s?.n_excluded_no_result || 0);
  const nExcludedNoPnl = Number(s?.n_excluded_no_pnl || 0);
  const nExcluded = nExcludedNoResult + nExcludedNoPnl;
  const cappedRows = Number(s?.capped_rows || 0);
  const correct = Number(s?.correct || 0);
  const winRate = total > 0 ? (correct / total) * 100 : 0;

  // avg_loss_pct — MUST be negative (Rule 9). The SQL returns the raw average
  // of capped negative values (already negative); we flip defensively if the
  // DB returned a positive number (which shouldn't happen since the CASE WHEN
  // filters to pnl_pct < 0, but defensive coding is cheap).
  const avgLossRaw = s?.avg_loss_pct_raw !== null && s?.avg_loss_pct_raw !== undefined
    ? Number(s.avg_loss_pct_raw)
    : null;
  const avgLossPct =
    avgLossRaw !== null && avgLossRaw < 0
      ? avgLossRaw
      : avgLossRaw !== null && avgLossRaw > 0
      ? -avgLossRaw
      : 0;
  const avgWinPct = s?.avg_win_pct_raw !== null && s?.avg_win_pct_raw !== undefined
    ? Number(s.avg_win_pct_raw)
    : 0;

  const exclusionBreakdown: Record<string, number> = {};
  if (nExcludedNoResult > 0) exclusionBreakdown.no_actual_result = nExcludedNoResult;
  if (nExcludedNoPnl > 0) exclusionBreakdown.no_pnl_pct = nExcludedNoPnl;

  // best_return / worst_return — already capped in SQL; ensure sign convention
  const bestReturn = s?.best_return !== null && s?.best_return !== undefined
    ? Number(s.best_return)
    : null;
  const worstReturn = s?.worst_return !== null && s?.worst_return !== undefined
    ? Number(s.worst_return)
    : null;

  const auditResult: KpiAuditResult = {
    n_raw: total,
    n_valid: nValid,
    n_excluded: nExcluded,
    exclusion_breakdown: exclusionBreakdown,
    capped_rows: cappedRows,
    avg_loss_pct: avgLossPct, // negative (Rule 9)
    avg_win_pct: avgWinPct,
    worst_return: worstReturn,
    best_return: bestReturn,
    audit_status: 'non-audited',
    audit_note:
      'analyst_predictions has no morning_bell column — channel separation ' +
      '(Rule 8) is not applicable. HARD cap ±50 applied to pnl_pct in every ' +
      'aggregate. avg_loss_pct is negative.',
  };

  try {
    const existing = await db.$queryRaw`
      SELECT id FROM analyst_performance WHERE analyst_id = ${analystId}
    `;

    if ((existing as Record<string, unknown>[]).length > 0) {
      await db.$executeRaw`
        UPDATE analyst_performance
        SET 
          total_predictions = ${total},
          correct_predictions = ${correct},
          wrong_predictions = ${Number(s?.wrong || 0)},
          win_rate = ${winRate},
          total_return_pct = ${Number(s?.total_return || 0)},
          avg_return_per_trade = ${Number(s?.avg_return || 0)},
          best_return = ${bestReturn ?? null},
          worst_return = ${worstReturn ?? null},
          updated_at = datetime('now')
        WHERE analyst_id = ${analystId}
      `;
    } else {
      const id = crypto.randomUUID();
      const level = winRate >= 70 ? 'expert' : winRate >= 50 ? 'intermediate' : 'beginner';

      await db.$executeRaw`
        INSERT INTO analyst_performance (
          id, analyst_id, total_predictions, correct_predictions, wrong_predictions,
          win_rate, total_return_pct, avg_return_per_trade, best_return, worst_return,
          level, created_at, updated_at
        ) VALUES (
          ${id},
          ${analystId},
          ${total},
          ${correct},
          ${Number(s?.wrong || 0)},
          ${winRate},
          ${Number(s?.total_return || 0)},
          ${Number(s?.avg_return || 0)},
          ${bestReturn ?? null},
          ${worstReturn ?? null},
          ${level},
          datetime('now'),
          datetime('now')
        )
      `;
    }
  } catch (error) {
    console.error('Error updating analyst performance:', error);
  }

  return auditResult;
}
