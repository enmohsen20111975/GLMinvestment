import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';

// P0-12-SQLI fix (2026-09-27): whitelist table names to prevent SQL injection.
const ALLOWED_TABS = new Set([
  'performance', 'valuation', 'dividends', 'profitability',
  'income_statement', 'balance_sheet', 'cash_flow', 'technical_analysis',
]);

/** يتحقق لو عمود معين موجود في جدول معين (defensive — pre-merge). */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return info.some((c) => c.name === column);
  } catch {
    return false;
  }
}

/**
 * (ALPHA-FUNDAMENTALS-AND-TABS، Task 1b — owner directive 2026-10-27):
 * «صحّح مسار الداتابيز ليقرأ من db/stocks.db (المحدّث بـ 66 عمود و tabs_data).
 *  ابحث بالرمز النقي (Direct WHERE symbol = ? OR ticker = ?) دون LIKE».
 *
 * الاستراتيجية (defensive، pre/post-merge):
 *   1. اقرأ tabs_data (JSON) من stocks.db.stocks WHERE ticker = ? (مباشر، نقي).
 *      برافو بيـ merge التبويبات الـ 8 التاريخية في عمود tabs_data أثناء الهجرة.
 *   2. لو tabs_data مش موجود (pre-merge) أو السهم مش لاقي → fallback على
 *      data_engine.db.tab_* tables بـ WHERE symbol = ? (مباشر، نقي — بدون LIKE).
 *   3. لو مفيش match في أي مصدر → رجّع empty data (صِدق، Rule 27).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'performance';
    const market = searchParams.get('market');
    const ticker = searchParams.get('ticker')?.toUpperCase();
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 1000);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    if (!ALLOWED_TABS.has(tab)) {
      return NextResponse.json(
        { error: `Invalid tab name '${tab}'. Allowed: ${Array.from(ALLOWED_TABS).join(', ')}` },
        { status: 400 }
      );
    }

    const tableName = `tab_${tab}`;

    // ─── المصدر 1: stocks.db.stocks.tabs_data (JSON، post-merge) ──────────────
    // برافو بيـ merge التبويبات التاريخية في عمود tabs_data أثناء الهجرة.
    // نقرأ السجل بالـ ticker المباشر (نقي، بدون LIKE).
    if (ticker) {
      try {
        const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
        const stocksDb = new Database(stocksDbPath, { readonly: true, timeout: 5000 });
        stocksDb.pragma('busy_timeout = 5000');
        if (columnExists(stocksDb, 'stocks', 'tabs_data')) {
          const row = stocksDb.prepare(
            'SELECT ticker, name_ar, tabs_data FROM stocks WHERE ticker = ? LIMIT 1'
          ).get(ticker) as { ticker: string; name_ar?: string; tabs_data?: string | null } | undefined;
          if (row?.tabs_data) {
            try {
              const parsed = JSON.parse(row.tabs_data) as Record<string, unknown>;
              // tabs_data ممكن يكون { tab_valuation: {...}, tab_profitability: {...}, ... }
              // أو { valuation: {...}, ... }. نبحث بالمفتاح الكامل أو المختصر.
              const tabData = parsed[tableName] ?? parsed[tab];
              if (tabData && typeof tabData === 'object') {
                stocksDb.close();
                return NextResponse.json({
                  tab,
                  source: 'stocks.db.tabs_data',
                  ticker: row.ticker,
                  name_ar: row.name_ar,
                  columns: Object.keys(tabData as Record<string, unknown>),
                  data: [tabData],
                  total: 1,
                });
              }
            } catch {
              // JSON تالف → نكمل على fallback.
            }
          }
        }
        stocksDb.close();
      } catch {
        // stocks.db مش متوفر أو العمود مش موجود → نكمل على data_engine fallback.
      }
    }

    // ─── المصدر 2 (fallback): data_engine.db.tab_* tables (التاريخي) ─────────
    // بحث مباشر بالـ symbol (نقي، بدون LIKE). لو ticker محدد وله market filter،
    // نطبّق الـ ticker كـ WHERE إضافي.
    // (defensive): لو data_engine.db مش موجود (ساندبوكس مضغوط) → رجّع empty data.
    try {
      const deDbPath = path.join(process.cwd(), 'db', 'data_engine.db');
      const deDb = new Database(deDbPath, { readonly: true });

      const columnsInfo = deDb.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
      const columns = columnsInfo.map(c => c.name);

      let query = `SELECT * FROM ${tableName}`;
      const params: (string | number)[] = [];
      const whereParts: string[] = [];

      if (market) {
        whereParts.push('market = ?');
        params.push(market);
      }
      // (ALPHA-FUNDAMENTALS-AND-TABS): بحث مباشر بالـ symbol (نقي، بدون LIKE).
      if (ticker) {
        whereParts.push('(symbol = ? OR symbol = ? COLLATE NOCASE)');
        params.push(ticker, ticker);
      }

      if (whereParts.length > 0) {
        query += ` WHERE ${whereParts.join(' AND ')}`;
      }
      query += ` ORDER BY id LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const data = deDb.prepare(query).all(...params);

      let countQuery = `SELECT COUNT(*) as count FROM ${tableName}`;
      const countParams: string[] = [];
      const countWhere: string[] = [];
      if (market) {
        countWhere.push('market = ?');
        countParams.push(market);
      }
      if (ticker) {
        countWhere.push('(symbol = ? OR symbol = ? COLLATE NOCASE)');
        countParams.push(ticker, ticker);
      }
      if (countWhere.length > 0) {
        countQuery += ` WHERE ${countWhere.join(' AND ')}`;
      }
      const total = deDb.prepare(countQuery).get(...countParams) as { count: number };

      deDb.close();

      return NextResponse.json({
        tab,
        source: 'data_engine.db',
        columns,
        data,
        total: total.count
      });
    } catch (fallbackErr: any) {
      // data_engine.db مش متوفر (ساندبوكس مضغوط) أو tab_* tables مش موجودة.
      // رجّع empty data صِدق (Rule 27: لا fabrication) بدل 500.
      return NextResponse.json({
        tab,
        source: 'none',
        columns: [],
        data: [],
        total: 0,
        message: 'لا توجد بيانات تبويبات متاحة حاليًا (ستتوفر بعد اكتمال الهجرة)',
      });
    }
  } catch (error: any) {
    console.error('[tab-data]', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
