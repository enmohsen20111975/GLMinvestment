import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


/**
 * POST /api/cache/clear
 * مسح الكاش - إعادة تعيين ذاكرة التخزين المؤقت
 * 
 * Query params:
 * - type: 'all' | 'stocks' | 'market' | 'crypto' (افتراضي: 'all')
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all';

    // In Next.js, we can't directly clear the cache, but we can:
    // 1. Clear any in-memory caches
    // 2. Trigger revalidation
    
    let clearedCount = 0;
    const clearedItems: string[] = [];

    // Clear any global caches if they exist
    if (typeof global !== 'undefined') {
      // Clear any cached data in global scope
      const globalKeys = Object.keys(global).filter(k => 
        k.includes('cache') || k.includes('Cache') || k.includes('_cache')
      );
      
      for (const key of globalKeys) {
        if (type === 'all' || type === 'stocks' || type === 'market' || type === 'crypto') {
          try {
            delete (global as Record<string, unknown>)[key];
            clearedItems.push(key);
            clearedCount++;
          } catch {
            // Ignore errors
          }
        }
      }
    }

    // Log the cache clear
    console.log(`[Cache Clear] Type: ${type}, Cleared: ${clearedCount} items`);

    return NextResponse.json({
      success: true,
      message: 'تم مسح الكاش بنجاح',
      message_en: 'Cache cleared successfully',
      cleared_count: clearedCount,
      cleared_items: clearedItems,
      type,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cache Clear] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to clear cache' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cache/clear
 * فحص حالة الكاش
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Use POST method to clear cache',
    usage: {
      method: 'POST',
      url: '/api/cache/clear',
      query_params: {
        type: 'all | stocks | market | crypto',
      },
    },
  });
}
