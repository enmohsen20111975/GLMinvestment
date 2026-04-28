import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, verifyAdminPassword, getCurrencyRates, updateAllCurrencyRates } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// GET /api/admin/currency — Get all currency rates (admin view with metadata)
// POST /api/admin/currency — Update currency rates (admin only, password required)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    await ensureInitialized();
    const rows = getCurrencyRates();
    return NextResponse.json({
      success: true,
      currencies: rows,
      total: rows.length,
    });
  } catch (error) {
    console.error('[GET /api/admin/currency] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء قراءة بيانات الصرف' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();
    const body = await request.json();
    const { password, rates } = body;

    // Verify admin password
    if (!verifyAdminPassword(password || '')) {
      return NextResponse.json(
        { success: false, error: 'كلمة المرور غير صحيحة' },
        { status: 401 }
      );
    }

    // Validate rates array
    if (!Array.isArray(rates) || rates.length === 0) {
      return NextResponse.json(
        { success: false, error: 'بيانات الأسعار غير صالحة' },
        { status: 400 }
      );
    }

    // Validate each rate entry
    const validRates = rates.filter(
      (r: Record<string, unknown>) =>
        r.code && typeof r.code === 'string' &&
        typeof r.buy_rate === 'number' && r.buy_rate > 0 &&
        typeof r.sell_rate === 'number' && r.sell_rate > 0
    );

    if (validRates.length === 0) {
      return NextResponse.json(
        { success: false, error: 'لا توجد بيانات صالحة للتحديث' },
        { status: 400 }
      );
    }

    // Update all currency rates
    const updated = updateAllCurrencyRates(
      validRates.map((r: Record<string, unknown>) => ({
        code: r.code as string,
        buy_rate: Number(r.buy_rate),
        sell_rate: Number(r.sell_rate),
        change: r.change !== null && r.change !== undefined ? Number(r.change) : null,
      }))
    );

    return NextResponse.json({
      success: true,
      message: `تم تحديث ${updated} عملة بنجاح`,
      updated_count: updated,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[POST /api/admin/currency] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تحديث بيانات الصرف' },
      { status: 500 }
    );
  }
}
