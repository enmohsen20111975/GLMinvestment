import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewsItem {
  title: string;
  summary: string;
  source: string;
  url: string;
  timestamp: number;
  sentiment: 'positive' | 'negative' | 'neutral';
}

interface NewsResponse {
  success: boolean;
  count: number;
  news: NewsItem[];
}

// ---------------------------------------------------------------------------
// Main GET handler - Returns empty news (no fake data)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));

    // Return empty news - no fake data
    const response: NewsResponse = {
      success: true,
      count: 0,
      news: [],
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/egxpilot/news] Error:', error);
    return NextResponse.json(
      {
        success: false,
        count: 0,
        news: [],
        error: 'Failed to fetch news',
      },
      { status: 500 }
    );
  }
}
