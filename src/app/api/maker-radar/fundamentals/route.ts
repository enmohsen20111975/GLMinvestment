/**
 * GET /api/maker-radar/fundamentals?ticker=COMI
 * =================================================
 * CANONICAL fundamentals route — pure Python proxy with honest empty fallback.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `db/data_engine.db` directly (`new Database(...)`) and read 8 tab_*
 * tables (tab_valuation, tab_profitability, ...). That bypassed the
 * canonical Python engine. Now it:
 *   1. Proxies to Python `/api/maker-radar/fundamentals?ticker=X` (primary).
 *   2. Returns honest empty fundamentals (Rule 27 NO-FAKE-DATA) preserving
 *      the exact response shape so consumers don't break.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

const TAB_TABLES = [
  'tab_valuation',
  'tab_profitability',
  'tab_balance_sheet',
  'tab_income_statement',
  'tab_cash_flow',
  'tab_dividends',
  'tab_performance',
  'tab_technical_analysis',
];

const TAB_LABELS_AR: Record<string, string> = {
  tab_valuation: 'التقييم',
  tab_profitability: 'الربحية',
  tab_balance_sheet: 'المركز المالي',
  tab_income_statement: 'قائمة الدخل',
  tab_cash_flow: 'التدفقات النقدية',
  tab_dividends: 'التوزيعات',
  tab_performance: 'الأداء',
  tab_technical_analysis: 'التحليل الفني',
};

function emptyFundamentals(): Record<string, { label: string; data: Record<string, string | null> | null }> {
  const out: Record<string, { label: string; data: Record<string, string | null> | null }> = {};
  for (const t of TAB_TABLES) {
    out[t] = { label: TAB_LABELS_AR[t], data: null };
  }
  return out;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker required' },
      { status: 400 },
    );
  }

  // ─── 1. PRIMARY: Python canonical endpoint ────────────────────────────────
  const qs = `ticker=${encodeURIComponent(ticker)}`;
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/maker-radar/fundamentals?${qs}`,
    `http://127.0.0.1:8010/api/maker-radar/fundamentals?${qs}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (json && (json.success === true || json.fundamentals)) {
          // Pass through Python response verbatim (Rule 4: mirror only).
          // Guarantee fundamentals shape (empty dict if Python omits it).
          return NextResponse.json({
            success: true,
            ticker,
            fundamentals: json.fundamentals ?? emptyFundamentals(),
          });
        }
      }
    } catch { // silent fallback (safe-by-design)
    }
  }

  // ─── 2. FALLBACK: honest empty (Rule 27 NO-FAKE-DATA) ────────────────────
  return NextResponse.json({
    success: false,
    error: 'fundamentals_data_unavailable',
    ticker,
    fallback: true,
    fundamentals: emptyFundamentals(),
  }, { status: 200 });
}
