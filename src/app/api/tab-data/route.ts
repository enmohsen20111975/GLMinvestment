import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';

// P0-12-SQLI fix (2026-09-27): whitelist table names to prevent SQL injection.
// The `tab` query parameter is validated against this Set before being used to
// build `tab_${tab}`. Any request with a tab not in the whitelist returns 400.
// Previously the audit flagged `db.prepare(`SELECT * FROM ${tableName}`)` where
// tableName came from the query string — now tableName is always one of these
// 8 hardcoded literals, even if the underlying db.prepare call still uses
// template-string interpolation (which is safe because the value is whitelisted).
const ALLOWED_TABS = new Set([
  'performance', 'valuation', 'dividends', 'profitability',
  'income_statement', 'balance_sheet', 'cash_flow', 'technical_analysis',
]);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'performance';
    const market = searchParams.get('market');
    // P0-12-SQLI fix (2026-09-27): clamp limit/offset to safe integer ranges and
    // bind them as `?` parameters below (defence-in-depth — even though parseInt
    // returns a number, using placeholders is the canonical safe pattern).
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 1000);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    if (!ALLOWED_TABS.has(tab)) {
      return NextResponse.json(
        { error: `Invalid tab name '${tab}'. Allowed: ${Array.from(ALLOWED_TABS).join(', ')}` },
        { status: 400 }
      );
    }

    const tableName = `tab_${tab}`;
    const dbPath = path.join(process.cwd(), 'data-engine', 'data', 'data_engine.db');
    const db = new Database(dbPath, { readonly: true });

    // Get columns
    const columnsInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
    const columns = columnsInfo.map(c => c.name);

    // Get data — tableName is whitelisted above (safe to interpolate).
    // market / limit / offset use `?` bound parameters.
    let query = `SELECT * FROM ${tableName}`;
    const params: (string | number)[] = [];

    if (market) {
      query += ' WHERE market = ?';
      params.push(market);
    }

    query += ` ORDER BY id LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const data = db.prepare(query).all(...params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as count FROM ${tableName}`;
    const countParams: string[] = [];
    if (market) {
      countQuery += ' WHERE market = ?';
      countParams.push(market);
    }
    const total = db.prepare(countQuery).get(...countParams) as { count: number };

    db.close();

    return NextResponse.json({
      tab,
      columns,
      data,
      total: total.count
    });
  } catch (error: any) {
    console.error('[tab-data]', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
