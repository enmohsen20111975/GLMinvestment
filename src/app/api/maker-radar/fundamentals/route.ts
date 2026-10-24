import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

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

// Format display value — convert string numbers to readable format
function fmtVal(v: string | number | null): string | null {
  if (v == null) return null;
  if (typeof v === 'number') return v.toString();
  const s = v.toString().trim();
  if (!s || s === '—' || s === 'null') return null;
  return s;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  if (!ticker) return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });

  const dbPath = path.join(process.cwd(), 'db', 'data_engine.db');
  try {
    const db = new Database(dbPath, { readonly: true });
    const result: Record<string, { label: string; data: Record<string, string | null> | null }> = {};

    for (const table of TAB_TABLES) {
      try {
        // The tab_* tables use 'ticker+arabic_name' format (e.g., 'COMIالبنك')
        // So we search with LIKE 'TICKER%' to match
        const row = db.prepare(`SELECT * FROM ${table} WHERE symbol LIKE ? LIMIT 1`).get(ticker + '%') as Record<string, unknown> | undefined;
        if (row) {
          const cleaned: Record<string, string | null> = {};
          for (const [k, v] of Object.entries(row)) {
            if (['id', 'symbol', 'market', 'data', 'fiscal_period', 'fiscal_end'].includes(k)) continue;
            cleaned[k] = fmtVal(v as string | number | null);
          }
          result[table] = { label: TAB_LABELS_AR[table], data: cleaned };
        } else {
          result[table] = { label: TAB_LABELS_AR[table], data: null };
        }
      } catch {
        result[table] = { label: TAB_LABELS_AR[table], data: null };
      }
    }

    db.close();
    return NextResponse.json({ success: true, ticker, fundamentals: result });
  } catch (error: any) {
    console.error('[maker-radar:fundamentals]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
