/**
 * GET /api/admin/validation
 * ========================
 * Task 28-B (Fix 3 — Fix Battalion):
 *   Validation Monitor — surfaces the count of stocks whose fields would
 *   be marked INVALID / SUSPECT / MISSING by vps-service/data/validation.py
 *   (Rule 65 — DATA-VALIDATION-LAYER).
 *
 *   Rule 20: admin API routes that need logic → call Python (or keep simple
 *   read-only). This endpoint is read-only and re-implements the same
 *   validation rules as validation.py in TypeScript so we don't have to
 *   spawn a Python process on every request. The validator runs against
 *   stocks.db (current_price, high_52w, low_52w, support, resistance,
 *   ma_50, ma_200, rsi) — the same fields validation.py operates on.
 *
 *   Returns:
 *     - summary: total_stocks + per_field breakdown (VALID/INVALID/SUSPECT/MISSING)
 *     - top_invalid_tickers: top N tickers by INVALID-finding count
 *     - recent_nullified: sample of INVALID findings (support/resistance nullified)
 *     - fields_by_invalid_count: ranking of which fields fail most often
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { openDb } from '@/lib/db-manager';

export const dynamic = 'force-dynamic';

type Status = 'VALID' | 'INVALID' | 'SUSPECT' | 'MISSING';

interface Finding {
  field: string;
  status: Status;
  value: number | null;
  reason: string;
}

interface StockValidation {
  ticker: string;
  name_ar: string | null;
  market: string | null;
  current_price: number | null;
  findings: Finding[];
  invalid_count: number;
}

interface ValidationResponse {
  success: boolean;
  timestamp: string;
  source: string;
  total_stocks: number;
  total_invalid_tickers: number;
  summary: Record<string, Record<Status, number>>;
  fields_by_invalid_count: Array<{ field: string; invalid_count: number; suspect_count: number; missing_count: number }>;
  top_invalid_tickers: StockValidation[];
  recent_nullified: Array<{ ticker: string; field: string; value: number | null; reason: string; market: string | null }>;
}

const DB_PATH = 'stocks.db';

function validateField(
  fieldName: string,
  value: number | null,
  currentPrice: number | null,
  ref?: number | null,
): Finding | null {
  // MISSING = null
  if (value === null || value === undefined || Number.isNaN(value)) {
    return { field: fieldName, status: 'MISSING', value: null, reason: `${fieldName} is NULL` };
  }
  if (value <= 0) {
    return { field: fieldName, status: 'INVALID', value, reason: `${fieldName}=${value} <= 0 — impossible` };
  }

  // current_price-specific: must be > 0
  if (fieldName === 'current_price') {
    if (value < 0.001) {
      return { field: fieldName, status: 'SUSPECT', value, reason: `current_price=${value} < 0.001 — likely unit/scale error` };
    }
    return { field: fieldName, status: 'VALID', value, reason: 'OK' };
  }

  // High_52w: should be >= current_price
  if (fieldName === 'high_52w' && currentPrice !== null && currentPrice > 0) {
    if (value < currentPrice) {
      return {
        field: fieldName, status: 'INVALID', value,
        reason: `high_52w=${value} < current_price=${currentPrice} — 52W data is STALE or from wrong source`,
      };
    }
    return { field: fieldName, status: 'VALID', value, reason: 'OK' };
  }

  // Low_52w: should be <= current_price AND <= high_52w
  if (fieldName === 'low_52w' && currentPrice !== null && currentPrice > 0) {
    if (value > currentPrice) {
      return { field: fieldName, status: 'INVALID', value, reason: `low_52w=${value} > current_price=${currentPrice} — impossible` };
    }
    if (ref !== null && ref !== undefined && ref > 0 && value > ref) {
      return { field: fieldName, status: 'INVALID', value, reason: `low_52w=${value} > high_52w=${ref} — inverted` };
    }
    return { field: fieldName, status: 'VALID', value, reason: 'OK' };
  }

  // Support: should be below current_price and within reasonable range
  if (fieldName === 'support' && currentPrice !== null && currentPrice > 0) {
    const ratio = value / currentPrice;
    if (ratio > 10) {
      return {
        field: fieldName, status: 'INVALID', value,
        reason: `support=${value} is ${ratio.toFixed(1)}x current_price=${currentPrice} — CROSS-STOCK CONTAMINATION`,
      };
    }
    if (ratio > 2.0) {
      return {
        field: fieldName, status: 'INVALID', value,
        reason: `support=${value} is ${ratio.toFixed(1)}x current_price=${currentPrice} — unreasonable scale`,
      };
    }
    if (value > currentPrice * 1.05) {
      return {
        field: fieldName, status: 'SUSPECT', value,
        reason: `support=${value} > current_price=${currentPrice} — support above price is unusual`,
      };
    }
    return { field: fieldName, status: 'VALID', value, reason: 'OK' };
  }

  // Resistance: should be above current_price and within reasonable range
  if (fieldName === 'resistance' && currentPrice !== null && currentPrice > 0) {
    const ratio = value / currentPrice;
    if (ratio > 10) {
      return {
        field: fieldName, status: 'INVALID', value,
        reason: `resistance=${value} is ${ratio.toFixed(1)}x current_price=${currentPrice} — CROSS-STOCK CONTAMINATION`,
      };
    }
    if (value < currentPrice * 0.95) {
      return {
        field: fieldName, status: 'SUSPECT', value,
        reason: `resistance=${value} < current_price=${currentPrice} — resistance below price is unusual`,
      };
    }
    return { field: fieldName, status: 'VALID', value, reason: 'OK' };
  }

  // MA50 / MA200: ratio to current_price must be in [0.1, 10]
  if ((fieldName === 'ma_50' || fieldName === 'ma_200') && currentPrice !== null && currentPrice > 0) {
    const ratio = value / currentPrice;
    if (ratio > 10 || ratio < 0.1) {
      return {
        field: fieldName, status: 'INVALID', value,
        reason: `${fieldName}=${value} is ${ratio.toFixed(1)}x current_price=${currentPrice} — scale error`,
      };
    }
    return { field: fieldName, status: 'VALID', value, reason: 'OK' };
  }

  // RSI: must be 0-100
  if (fieldName === 'rsi') {
    if (value < 0 || value > 100) {
      return { field: fieldName, status: 'INVALID', value, reason: `rsi=${value} outside 0-100 range — impossible` };
    }
    return { field: fieldName, status: 'VALID', value, reason: 'OK' };
  }

  return { field: fieldName, status: 'VALID', value, reason: 'OK' };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const db = openDb(DB_PATH);
    if (!db) {
      return NextResponse.json(
        { success: false, error: 'stocks_db_missing', path: DB_PATH },
        { status: 503 },
      );
    }
    db.pragma('busy_timeout = 5000');

    const rows = db.prepare(`
      SELECT ticker, name_ar, market,
             current_price, high_52w, low_52w,
             support, resistance, ma_50, ma_200, rsi
      FROM stocks
      WHERE is_active = 1
      ORDER BY ticker
      LIMIT 2000
    `).all() as Array<Record<string, unknown>>;

    db.close();

    const fieldNames = [
      'current_price', 'high_52w', 'low_52w',
      'support', 'resistance', 'ma_50', 'ma_200', 'rsi',
    ];

    const summary: Record<string, Record<Status, number>> = {};
    for (const f of fieldNames) {
      summary[f] = { VALID: 0, INVALID: 0, SUSPECT: 0, MISSING: 0 };
    }

    const allValidations: StockValidation[] = [];
    const recentNullified: ValidationResponse['recent_nullified'] = [];

    for (const row of rows) {
      const ticker = String(row.ticker || '').trim();
      if (!ticker) continue;

      const cp = num(row.current_price);
      const h52 = num(row.high_52w);
      const l52 = num(row.low_52w);
      const sup = num(row.support);
      const res = num(row.resistance);
      const ma50 = num(row.ma_50);
      const ma200 = num(row.ma_200);
      const rsi = num(row.rsi);

      const findings: Finding[] = [];
      const f1 = validateField('current_price', cp, cp);
      if (f1) findings.push(f1);
      const f2 = validateField('high_52w', h52, cp);
      if (f2) findings.push(f2);
      const f3 = validateField('low_52w', l52, cp, h52);
      if (f3) findings.push(f3);
      const f4 = validateField('support', sup, cp);
      if (f4) findings.push(f4);
      const f5 = validateField('resistance', res, cp);
      if (f5) findings.push(f5);
      const f6 = validateField('ma_50', ma50, cp);
      if (f6) findings.push(f6);
      const f7 = validateField('ma_200', ma200, cp);
      if (f7) findings.push(f7);
      const f8 = validateField('rsi', rsi, cp);
      if (f8) findings.push(f8);

      // Cascade: if current_price is INVALID, derived fields cascade to INVALID
      const cpInvalid = f1 && (f1.status === 'INVALID' || f1.status === 'MISSING');
      if (cpInvalid) {
        for (const f of findings) {
          if (f.field !== 'current_price' && f.status === 'VALID') {
            f.status = 'INVALID';
            f.reason = `CASCADE: current_price is ${f1?.status} → ${f.field} cannot be trusted`;
          }
        }
      }

      // Accumulate summary
      for (const f of findings) {
        if (summary[f.field]) {
          summary[f.field][f.status] = (summary[f.field][f.status] || 0) + 1;
        }
      }

      const invalidCount = findings.filter(f => f.status === 'INVALID').length;
      const suspectCount = findings.filter(f => f.status === 'SUSPECT').length;
      const missingCount = findings.filter(f => f.status === 'MISSING').length;

      if (invalidCount > 0 || suspectCount > 0) {
        allValidations.push({
          ticker,
          name_ar: (row.name_ar as string) || null,
          market: (row.market as string) || null,
          current_price: cp,
          findings,
          invalid_count: invalidCount + suspectCount, // include SUSPECT in display count
        });
      }

      // Collect samples of nullified support/resistance (INVALID findings)
      for (const f of findings) {
        if (f.status === 'INVALID' && (f.field === 'support' || f.field === 'resistance')) {
          recentNullified.push({
            ticker,
            field: f.field,
            value: f.value,
            reason: f.reason,
            market: (row.market as string) || null,
          });
        }
      }
    }

    // Rank fields by INVALID count
    const fieldsByInvalid = fieldNames
      .map(f => ({
        field: f,
        invalid_count: summary[f].INVALID,
        suspect_count: summary[f].SUSPECT,
        missing_count: summary[f].MISSING,
      }))
      .sort((a, b) => b.invalid_count - a.invalid_count);

    // Top invalid tickers (most INVALID findings)
    const topInvalid = allValidations
      .sort((a, b) => b.invalid_count - a.invalid_count)
      .slice(0, 20);

    // Truncate nullified findings to 50 most recent (we don't have a timestamp,
    // so use the order stocks were returned — alphabetical ticker order)
    const recentNullifiedSample = recentNullified.slice(0, 50);

    const response: ValidationResponse = {
      success: true,
      timestamp: new Date().toISOString(),
      source: 'stocks.db.stocks (Rule 65 mirror)',
      total_stocks: rows.length,
      total_invalid_tickers: allValidations.length,
      summary,
      fields_by_invalid_count: fieldsByInvalid,
      top_invalid_tickers: topInvalid,
      recent_nullified: recentNullifiedSample,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/admin/validation]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
