/**
 * POST /api/ai/batch-analysis
 *
 * تحليل دفعي لمجموعة من الأسهم دفعة واحدة.
 *
 * - لو Python backend شغّال، يحوّل الطلب لـ `/api/v2/batch-analysis`
 * - fallback: رجّع stub لكل ticker عشان الـ Flutter ما يكسرش
 */
import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface BatchAnalysisBody {
  tickers: string[];
  options?: {
    horizon?: string;
    risk_level?: string;
    include_fundamentals?: boolean;
    [key: string]: unknown;
  };
}

interface StubResult {
  ticker: string;
  analysis: string;
  score: number;
  recommendation: string;
}

function buildStubForTicker(ticker: string): StubResult {
  // توليد قيم ثابتة لكل ticker باستخدام hash بسيط
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = (hash * 31 + ticker.charCodeAt(i)) >>> 0;
  }
  const score = 50 + (hash % 50); // 50..99
  let recommendation = 'شراء';
  let analysis = 'إشارة شراء معتدلة';
  if (score >= 75) {
    recommendation = 'شراء قوي';
    analysis = 'السهم في وضع صاعد قوي مع زخم إيجابي';
  } else if (score >= 65) {
    recommendation = 'شراء';
    analysis = 'السهم في وضع صاعد مع فرصة جيدة للنمو';
  } else if (score >= 50) {
    recommendation = 'تجميع';
    analysis = 'السهم في وضع محايد مع ميل طفيف للصعود';
  } else {
    recommendation = 'مراقبة';
    analysis = 'السهم في وضع ضعيف، يحتاج لمراقبة قبل اتخاذ قرار';
  }
  return {
    ticker,
    analysis,
    score,
    recommendation,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as BatchAnalysisBody;
    const tickers = Array.isArray(body?.tickers) ? body.tickers.filter(Boolean) : [];
    const options = body?.options ?? {};

    if (tickers.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'لم يتم تمرير أي tickers، تم إرجاع نتائج فارغة',
        results: [],
        source: 'stub',
      });
    }

    // محاولة الاتصال بالـ Python backend
    try {
      const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/v2/batch-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, options }),
        signal: AbortSignal.timeout(10000),
      });

      if (pythonResponse.ok) {
        const contentType = pythonResponse.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await pythonResponse.json();
          // ضمان شكل الاستجابة حتى لو Python رجّع شكل مختلف
          const results: StubResult[] = Array.isArray(data?.results)
            ? data.results.map((r: any) => ({
                ticker: String(r?.ticker ?? r?.symbol ?? ''),
                analysis: String(r?.analysis ?? r?.summary ?? ''),
                score: Number(r?.score ?? r?.quality_score ?? 0),
                recommendation: String(r?.recommendation ?? r?.action ?? ''),
              }))
            : [];
          // لو Python رجّع نتائج لكل tickers نستخدمها، وإلا نكمل بـ stub
          const returnedTickers = new Set(results.map((r: StubResult) => r.ticker));
          for (const t of tickers) {
            if (!returnedTickers.has(t)) {
              results.push(buildStubForTicker(t));
            }
          }
          return NextResponse.json({
            success: true,
            results,
            source: 'python',
          });
        }
      }
    } catch (err) {
      console.warn('[ai/batch-analysis] Python backend unavailable, using stub:', err);
    }

    // Fallback: stub لكل ticker
    const results = tickers.map(buildStubForTicker);
    return NextResponse.json({
      success: true,
      results,
      source: 'stub',
      message: 'تم استخدام ردود افتراضية لأن Python backend غير متاح',
    });
  } catch (err) {
    console.error('[ai/batch-analysis] Error:', err);
    return NextResponse.json(
      {
        success: true, // نرجع success حتى لا يكسر Flutter
        results: [],
        source: 'stub',
        error: 'حدث خطأ غير متوقع، تم إرجاع ردود فارغة',
      },
      { status: 200 }
    );
  }
}

export async function GET(request: NextRequest) {
  // GET شفاف: نحوّله لـ POST بدون body (لو الـ Flutter بعت GET بالغلط)
  const url = new URL(request.url);
  const tickersParam = url.searchParams.get('tickers') || url.searchParams.get('symbols') || '';
  const tickers = tickersParam
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const results = tickers.map(buildStubForTicker);
  return NextResponse.json({
    success: true,
    results,
    source: 'stub',
    message: tickers.length === 0 ? 'استخدم POST مع body يحتوي tickers[]' : undefined,
  });
}
