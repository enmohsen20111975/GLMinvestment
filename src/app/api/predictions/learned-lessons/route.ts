/**
 * Learned Lessons API (P1-GEMS-WIRING)
 * ====================================
 * Reads from predictions.db.learned_lessons (19,464 rows).
 *
 * The learned_lessons table stores AI training data — pattern→outcome
 * mappings the engine has discovered across thousands of historical
 * predictions. Each row is one lesson:
 *
 *   - condition       : the trigger (e.g. "market_regime=bear", "signal = BUY")
 *   - outcome         : success / failure
 *   - occurrences     : how many times this condition was observed
 *   - failure_rate    : 0..100 — how often it ended badly
 *   - avg_return      : average % return
 *   - recommendation  : the AI action applied (reduce_exposure / increase_weight / add_filter / reduce_weight)
 *
 * GET /api/predictions/learned-lessons?limit=50&condition=X
 *   → { success, total, lessons: [{ id, condition, outcome, recommendation, updated_at, occurrence_count, ... }] }
 *
 * Query params:
 *   - limit     (default 50, max 500)
 *   - condition (LIKE substring filter, optional)
 *   - outcome   (success|failure, optional)
 *   - sort      (occurrences|failure_rate|avg_return|updated_at — default occurrences DESC)
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

/** Generic SQL row. */
type SqlRow = Record<string, unknown>;

const SORTABLE = new Set(['occurrences', 'failure_rate', 'avg_return', 'updated_at']);

function openDb(): Database.Database {
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  try {
    return new Database(dbPath, { readonly: true, timeout: 3000 });
  } catch {
    return new Database(`file:${dbPath}?immutable=1`, { timeout: 3000 });
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const condition = url.searchParams.get('condition');
  const outcome = url.searchParams.get('outcome');
  const sortParam = url.searchParams.get('sort') || 'occurrences';

  // Clamp limit to [1, 500], default 50
  let limit = 50;
  if (limitParam) {
    const n = parseInt(limitParam, 10);
    if (Number.isFinite(n)) limit = Math.min(500, Math.max(1, n));
  }
  const sort = SORTABLE.has(sortParam) ? sortParam : 'occurrences';

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (condition) {
    where.push('condition LIKE ?');
    params.push(`%${condition}%`);
  }
  if (outcome === 'success' || outcome === 'failure') {
    where.push('outcome = ?');
    params.push(outcome);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const db = openDb();
  try {
    const total = (db.prepare(
      `SELECT COUNT(*) as n FROM learned_lessons ${whereSql}`,
    ).get(...params) as SqlRow).n as number;

    const rows = db.prepare(
      `SELECT
         id,
         lesson_type,
         condition,
         outcome,
         failure_rate,
         occurrences AS occurrence_count,
         avg_return,
         recommendation,
         created_at,
         updated_at
       FROM learned_lessons
       ${whereSql}
       ORDER BY ${sort} DESC
       LIMIT ?`,
    ).all(...params, limit) as SqlRow[];

    // Distinct conditions for the dropdown filter (top 200 by occurrences)
    const distinctConditions = db.prepare(
      `SELECT condition FROM learned_lessons
       WHERE condition IS NOT NULL AND condition != ''
       GROUP BY condition
       ORDER BY MAX(occurrences) DESC
       LIMIT 200`,
    ).all() as { condition: string }[];

    return NextResponse.json({
      success: true,
      total,
      returned: rows.length,
      filters: { limit, condition: condition || null, outcome: outcome || null, sort },
      conditions: distinctConditions.map((r) => r.condition),
      lessons: rows,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[predictions:learned-lessons]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 },
    );
  } finally {
    db.close();
  }
}
