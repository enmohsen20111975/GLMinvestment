import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';

// ---------------------------------------------------------------------------
// PUT    /api/finance/assets/:id    — Update a single asset
// DELETE /api/finance/assets/:id    — Remove a single asset
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PUT — Update asset by ID
// ---------------------------------------------------------------------------

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const { id: idParam } = await params;
    const assetId = Number(idParam);

    if (!assetId || isNaN(assetId) || assetId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid asset ID is required' },
        { status: 400 }
      );
    }

    const db = await getFinanceDb();

    // Verify exists
    const existing = db
      .prepare('SELECT id FROM portfolio_assets WHERE id = ? AND user_id = ?')
      .get(assetId, userId!) as { id: number } | undefined;

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Asset not found' },
        { status: 404 }
      );
    }

    const body = await request.json();

    // Build dynamic SET clause
    const allowedFields = [
      'type', 'name', 'total_invested', 'current_value', 'notes',
      'weight_grams', 'karat', 'purchase_price_per_gram',
      'bank_name', 'interest_rate',
      'certificate_duration_months', 'certificate_return_rate', 'certificate_maturity_date',
      'fund_name', 'fund_type',
      'stock_id', 'stock_ticker', 'quantity', 'avg_buy_price',
    ];

    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(body[field] === null ? null : body[field]);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields provided for update' },
        { status: 400 }
      );
    }

    setClauses.push("updated_at = datetime('now')");

    db.prepare(
      `UPDATE portfolio_assets SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`
    ).run(...values, assetId, userId!);

    return NextResponse.json({
      success: true,
      message: 'Asset updated successfully',
    });
  } catch (error) {
    console.error('[PUT /api/finance/assets/:id] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error updating portfolio asset' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove asset by ID
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const { id: idParam } = await params;
    const assetId = Number(idParam);

    if (!assetId || isNaN(assetId) || assetId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid asset ID is required' },
        { status: 400 }
      );
    }

    const db = await getFinanceDb();

    // Verify exists
    const existing = db
      .prepare('SELECT id FROM portfolio_assets WHERE id = ? AND user_id = ?')
      .get(assetId, userId!) as { id: number } | undefined;

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Asset not found' },
        { status: 404 }
      );
    }

    const result = db
      .prepare('DELETE FROM portfolio_assets WHERE id = ? AND user_id = ?')
      .run(assetId, userId!);

    if (result.changes === 0) {
      return NextResponse.json(
        { success: false, error: 'Failed to delete asset' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Asset deleted successfully',
      deleted_id: assetId,
    });
  } catch (error) {
    console.error('[DELETE /api/finance/assets/:id] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error deleting portfolio asset' },
      { status: 500 }
    );
  }
}
