import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


/**
 * GET /api/crypto/{id}/history
 * تاريخ أسعار العملات الرقمية
 * 
 * Query params:
 * - days: عدد الأيام (افتراضي: 30)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');

    // Try to fetch from Python backend - ONLY real data source
    const pythonBackendUrl = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';
    
    try {
      const response = await fetch(
        `${pythonBackendUrl}/api/crypto/${id}/history?days=${days}`,
        { next: { revalidate: 300 } } // 5-minute cache
      );

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          success: true,
          source: 'python_backend',
          id,
          ...data,
        });
      }
    } catch (pythonError) {
      console.error('[Crypto History] Python backend error:', pythonError);
    }

    // ❌ NO FAKE DATA - Return error instead of generating mock data
    return NextResponse.json({
      success: false,
      error: 'Unable to fetch crypto history. Python backend unavailable.',
      id,
      days,
      timestamp: new Date().toISOString(),
    }, { status: 503 });

  } catch (error) {
    console.error('[Crypto History] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch crypto history' },
      { status: 500 }
    );
  }
}
