import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';
import type { AssetType } from '@/types';
import { getSessionUserId } from '@/lib/auth-helper';

// ---------------------------------------------------------------------------
// GET    /api/finance/assets          — Fetch all portfolio assets (or summary)
// POST   /api/finance/assets          — Add new asset
// PUT    /api/finance/assets          — Update asset
// DELETE /api/finance/assets          — Remove asset
// ---------------------------------------------------------------------------

const VALID_ASSET_TYPES: AssetType[] = ['stock', 'gold', 'bank', 'certificate', 'fund', 'real_estate', 'other'];

// ---------------------------------------------------------------------------
// Table schema — created once, then cached in-memory.
// ---------------------------------------------------------------------------

const PORTFOLIO_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS portfolio_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'stock',
    name TEXT NOT NULL,
    total_invested REAL NOT NULL DEFAULT 0,
    current_value REAL NOT NULL DEFAULT 0,
    notes TEXT,
    weight_grams REAL,
    karat INTEGER,
    purchase_price_per_gram REAL,
    bank_name TEXT,
    interest_rate REAL,
    certificate_duration_months INTEGER,
    certificate_return_rate REAL,
    certificate_maturity_date TEXT,
    fund_name TEXT,
    fund_type TEXT,
    stock_id INTEGER,
    stock_ticker TEXT,
    quantity REAL,
    avg_buy_price REAL,
    added_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`;

/** Ensures the table exists — runs only ONCE per process lifetime. */
let _tableEnsured = false;
function ensurePortfolioAssetsTable(db: SqliteDatabase): void {
  if (_tableEnsured) return;
  db.prepare(PORTFOLIO_TABLE_DDL).run();
  _tableEnsured = true;
}

// ---------------------------------------------------------------------------
// All optional columns that can be set during INSERT
// ---------------------------------------------------------------------------

const OPTIONAL_INSERT_FIELDS = [
  'notes', 'weight_grams', 'karat', 'purchase_price_per_gram',
  'bank_name', 'interest_rate', 'certificate_duration_months',
  'certificate_return_rate', 'certificate_maturity_date',
  'fund_name', 'fund_type', 'stock_id', 'stock_ticker',
  'quantity', 'avg_buy_price',
] as const;

// ---------------------------------------------------------------------------
// GET — Fetch all assets or summary
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: true, items: [], total: 0 });
    }

    const db = await getFinanceDb();
    ensurePortfolioAssetsTable(db);

    const { searchParams } = new URL(request.url);
    const withSummary = searchParams.get('summary') === 'true';

    const rows = db
      .prepare(
        `SELECT pa.*,
           s.current_price AS market_price,
           s.previous_close AS market_previous_close,
           s.name_ar AS stock_name_ar,
           s.sector AS stock_sector,
           CASE WHEN s.current_price > 0 AND s.previous_close > 0
             THEN ROUND(((s.current_price - s.previous_close) / s.previous_close) * 100, 2)
             ELSE 0
           END AS market_change_percent,
           CASE WHEN pa.quantity IS NOT NULL AND pa.quantity > 0 AND s.current_price IS NOT NULL
             THEN ROUND(pa.quantity * s.current_price, 2)
             ELSE NULL
           END AS market_value
         FROM portfolio_assets pa
         LEFT JOIN stocks s ON pa.stock_ticker = s.ticker AND s.is_active = 1
         WHERE pa.user_id = ?
         ORDER BY pa.added_at DESC`
      )
      .all(userId!) as Record<string, unknown>[];

    if (withSummary) {
      const totalAssets = rows.reduce((sum, row) => sum + (Number(row.current_value) || 0), 0);
      const totalInvested = rows.reduce((sum, row) => sum + (Number(row.total_invested) || 0), 0);
      const totalGainLoss = totalAssets - totalInvested;
      const totalGainLossPercent = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;

      const assetsByType = rows.reduce((acc, row) => {
        const type = (row.type as string) || 'other';
        acc[type] = (acc[type] || 0) + (Number(row.current_value) || 0);
        return acc;
      }, {} as Record<string, number>);

      return NextResponse.json({
        success: true,
        items: rows,
        total: rows.length,
        summary: {
          total_assets: Number(totalAssets.toFixed(2)),
          total_invested: Number(totalInvested.toFixed(2)),
          total_gain_loss: Number(totalGainLoss.toFixed(2)),
          total_gain_loss_percent: Number(totalGainLossPercent.toFixed(2)),
          assets_by_type: assetsByType,
        },
      });
    }

    return NextResponse.json({
      success: true,
      items: rows,
      total: rows.length,
    });
  } catch (error) {
    console.error('[GET /api/finance/assets] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error reading portfolio assets', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Add new asset (single INSERT with all fields — 1 disk write only)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const db = await getFinanceDb();
    ensurePortfolioAssetsTable(db);

    // Parse JSON body
    let body: Record<string, unknown>;
    try {
      const rawBody = await request.text();
      if (!rawBody.trim()) {
        return NextResponse.json(
          { success: false, error: 'Request body is empty' },
          { status: 400 }
        );
      }
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch (parseErr) {
      console.error('[POST /api/finance/assets] JSON parse error:', parseErr);
      return NextResponse.json(
        { success: false, error: 'Invalid JSON', detail: parseErr instanceof Error ? parseErr.message : String(parseErr) },
        { status: 400 }
      );
    }

    const { type, name, total_invested, current_value } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Asset name is required' },
        { status: 400 }
      );
    }

    const assetType = (type || 'other') as AssetType;
    if (!VALID_ASSET_TYPES.includes(assetType)) {
      return NextResponse.json(
        { success: false, error: `Invalid asset type: ${type}` },
        { status: 400 }
      );
    }

    const invested = Number(total_invested) || 0;
    const currentValue = Number(current_value) || 0;

    // Build a single INSERT with all provided fields (1 disk write instead of 2)
    const columns: string[] = ['user_id', 'type', 'name', 'total_invested', 'current_value'];
    const placeholders: string[] = ['?', '?', '?', '?', '?'];
    const values: unknown[] = [userId!, assetType, name.trim(), invested, currentValue];

    for (const field of OPTIONAL_INSERT_FIELDS) {
      const val = body[field];
      if (val !== undefined && val !== null && val !== '') {
        columns.push(field);
        placeholders.push('?');
        values.push(val);
      }
    }

    const insertSql = `INSERT INTO portfolio_assets (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
    const insertResult = db.prepare(insertSql).run(...values);
    const insertedId = insertResult.lastInsertRowid;

    // No resetFinanceDb() — singleton stays alive, DB already saved to disk by saveToDisk()
    return NextResponse.json({
      success: true,
      message: 'Asset added successfully',
      id: insertedId,
    });
  } catch (error) {
    console.error('[POST /api/finance/assets] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: 'Error adding portfolio asset', detail: message },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — Update asset
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const db = await getFinanceDb();
    ensurePortfolioAssetsTable(db);

    const body = await request.json();
    const { id } = body;

    if (!id || Number(id) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid asset ID is required' },
        { status: 400 }
      );
    }

    const existing = db
      .prepare('SELECT id FROM portfolio_assets WHERE id = ? AND user_id = ?')
      .get(Number(id), userId!) as { id: number } | undefined;

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Asset not found' },
        { status: 404 }
      );
    }

    const allowedFields = [
      'type', 'name', 'total_invested', 'current_value', 'notes',
      'weight_grams', 'karat', 'purchase_price_per_gram',
      'bank_name', 'interest_rate',
      'certificate_duration_months', 'certificate_return_rate', 'certificate_maturity_date',
      'fund_name', 'fund_type',
      'stock_id', 'stock_ticker', 'quantity', 'avg_buy_price',
    ];

    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        params.push(body[field] === null ? null : body[field]);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields provided for update' },
        { status: 400 }
      );
    }

    setClauses.push("updated_at = datetime('now')");
    params.push(Number(id));

    db.prepare(
      `UPDATE portfolio_assets SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`
    ).run(...params, userId!);

    // No resetFinanceDb() — singleton stays alive
    return NextResponse.json({
      success: true,
      message: 'Asset updated successfully',
    });
  } catch (error) {
    console.error('[PUT /api/finance/assets] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error updating portfolio asset', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove asset
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const db = await getFinanceDb();
    ensurePortfolioAssetsTable(db);

    const { searchParams } = new URL(request.url);
    const queryId = searchParams.get('id');

    let assetId: number | null = null;

    if (queryId) {
      assetId = Number(queryId);
    } else {
      try {
        const body = await request.json();
        assetId = body.id ? Number(body.id) : null;
      } catch {
        // No body
      }
    }

    if (!assetId || isNaN(assetId) || assetId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid asset ID is required' },
        { status: 400 }
      );
    }

    const existing = db
      .prepare('SELECT id FROM portfolio_assets WHERE id = ? AND user_id = ?')
      .get(assetId, userId!) as { id: number } | undefined;

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Asset not found' },
        { status: 404 }
      );
    }

    db
      .prepare('DELETE FROM portfolio_assets WHERE id = ? AND user_id = ?')
      .run(assetId, userId!);

    // No resetFinanceDb() — singleton stays alive
    return NextResponse.json({
      success: true,
      message: 'Asset deleted successfully',
      deleted_id: assetId,
    });
  } catch (error) {
    console.error('[DELETE /api/finance/assets] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error deleting portfolio asset', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
