import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, verifyAdminPassword, getGoldPrices, updateAllGoldPrices } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// GET /api/admin/gold — Get all gold prices (admin view with metadata)
// POST /api/admin/gold — Update gold prices (admin only, password required)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    await ensureInitialized();
    const rows = getGoldPrices();
    return NextResponse.json({
      success: true,
      prices: rows,
      total: rows.length,
    });
  } catch (error) {
    console.error('[GET /api/admin/gold] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء قراءة بيانات الذهب' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();
    const body = await request.json();
    const { password, prices } = body;

    // Verify admin password
    if (!verifyAdminPassword(password || '')) {
      return NextResponse.json(
        { success: false, error: 'كلمة المرور غير صحيحة' },
        { status: 401 }
      );
    }

    // Validate prices array
    if (!Array.isArray(prices) || prices.length === 0) {
      return NextResponse.json(
        { success: false, error: 'بيانات الأسعار غير صالحة' },
        { status: 400 }
      );
    }

    // Validate each price entry
    const validPrices = prices.filter(
      (p: Record<string, unknown>) =>
        p.karat && typeof p.karat === 'string' &&
        p.price_per_gram && typeof p.price_per_gram === 'number' &&
        p.price_per_gram > 0
    );

    if (validPrices.length === 0) {
      return NextResponse.json(
        { success: false, error: 'لا توجد بيانات صالحة للتحديث' },
        { status: 400 }
      );
    }

    // Update all gold prices
    const updated = updateAllGoldPrices(
      validPrices.map((p: Record<string, unknown>) => ({
        karat: p.karat as string,
        price_per_gram: Number(p.price_per_gram),
        change: p.change !== null && p.change !== undefined ? Number(p.change) : null,
      }))
    );

    return NextResponse.json({
      success: true,
      message: `تم تحديث ${updated} سعر بنجاح`,
      updated_count: updated,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[POST /api/admin/gold] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تحديث بيانات الذهب' },
      { status: 500 }
    );
  }
}
