import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { ensureInitialized, getRandomSmartTip, getAllSmartTipCategories, getSmartTipsByCategory } from '@/lib/egx-db';

export const maxDuration = 10;

// ---------------------------------------------------------------------------
// GET /api/tips/random?trigger=xxx&category=xxx
// Returns a single random smart tip filtered by trigger and/or category.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    await ensureInitialized();

    const { searchParams } = new URL(request.url);
    const trigger = searchParams.get('trigger') || undefined;
    const category = searchParams.get('category') || undefined;
    const action = searchParams.get('action') || 'random'; // random | categories | all

    if (action === 'categories') {
      const categories = getAllSmartTipCategories();
      return NextResponse.json({
        success: true,
        categories,
        total: categories.length,
      });
    }

    if (action === 'all' && category) {
      const tips = getSmartTipsByCategory(category);
      return NextResponse.json({
        success: true,
        category,
        tips,
        total: tips.length,
      });
    }

    // Default: return a single random tip
    const tip = getRandomSmartTip();

    if (!tip) {
      // Fallback: get any random tip
      const fallbackTip = getRandomSmartTip();
      if (!fallbackTip) {
        return NextResponse.json({
          success: false,
          message: 'لا توجد نصائح متاحة حالياً',
        });
      }
      return NextResponse.json({
        success: true,
        tip: {
          id: fallbackTip.id,
          content: fallbackTip.tip_text_ar as string,
          category: fallbackTip.category as string,
          author: null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      tip: {
        id: tip.id,
        content: tip.tip_text_ar as string,
        category: tip.category as string,
        author: null,
      },
    });
  } catch (error) {
    console.error('[GET /api/tips/random] Error:', error);
    return NextResponse.json(
      { success: false, message: 'حدث خطأ أثناء تحميل النصيحة' },
      { status: 500 }
    );
  }
}
