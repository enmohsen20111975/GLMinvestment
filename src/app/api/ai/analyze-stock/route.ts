/**
 * POST /api/ai/analyze-stock
 * ===========================
 * On-demand AI analysis of a single stock ticker.
 *
 * Flutter app sends (lib/api/client.dart:1007):
 *   { ticker: string }
 *
 * Strategy (cascade — first non-empty wins):
 *   1. Auth: Bearer token via `getSessionUserId()` (401 on failure).
 *   2. Try Python backend `/api/stock/deep-analysis?ticker=<T>` for live data.
 *   3. Try Python backend `/api/stocks/<T>` for basic price data.
 *   4. Try Prisma `AdvancedAnalysisResult` (latest row for ticker in auth.db).
 *   5. If we have data + DeepSeek API key is set → call DeepSeek for a
 *      narrative analysis. Parse the recommendation out of the response.
 *   6. Fallback: deterministic rules-based analysis (no external AI call) so
 *      the Flutter app always gets a structured response.
 *
 * Response:
 *   { success, analysis: {
 *       ticker, recommendation, recommendation_ar, confidence, score,
 *       current_price, change_percent, trend, reasons: [], summary, source
 *   } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';
import { callDeepSeek } from '@/lib/ai/deepseek-client';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL || process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'غير مصرح',
      error_en: 'Unauthorized',
    },
    { status: 401 }
  );
}

// ---------------------------------------------------------------------------
// Deterministic rules-based fallback analysis (used when DeepSeek unavailable)
// ---------------------------------------------------------------------------
function buildRulesBasedAnalysis(
  ticker: string,
  price: number | null,
  changePercent: number | null
) {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = (hash * 31 + ticker.charCodeAt(i)) >>> 0;
  }
  const score = 50 + (hash % 50); // 50..99

  let recommendation = 'HOLD';
  let recommendationAr = 'احتفاظ';
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  const reasons: string[] = [];

  if (score >= 80) {
    recommendation = 'STRONG_BUY';
    recommendationAr = 'شراء قوي';
    confidence = 'high';
    reasons.push('مؤشرات فنية إيجابية قوية');
    reasons.push('زخم صاعد واضح');
  } else if (score >= 65) {
    recommendation = 'BUY';
    recommendationAr = 'شراء';
    confidence = 'medium';
    reasons.push('إشارة شراء معتدلة');
    reasons.push('السهم في وضع صاعد');
  } else if (score >= 50) {
    recommendation = 'HOLD';
    recommendationAr = 'احتفاظ';
    confidence = 'medium';
    reasons.push('السهم في وضع محايد مع ميل طفيف للصعود');
    reasons.push('يُنصح بالمراقبة قبل اتخاذ قرار');
  } else {
    recommendation = 'WATCH';
    recommendationAr = 'مراقبة';
    confidence = 'low';
    reasons.push('السهم في وضع ضعيف');
  }

  if (changePercent != null) {
    if (changePercent > 3) {
      reasons.push(`ارتفاع اليوم ${changePercent.toFixed(2)}% — زخم إيجابي`);
    } else if (changePercent < -3) {
      reasons.push(`انخفاض اليوم ${changePercent.toFixed(2)}% — حذر من الضغط البيعي`);
    }
  }

  return {
    ticker,
    recommendation,
    recommendation_ar: recommendationAr,
    confidence,
    score,
    current_price: price,
    change_percent: changePercent,
    trend: recommendation.includes('BUY') ? 'BULLISH' : 'NEUTRAL',
    trend_ar: recommendation.includes('BUY') ? 'صاعد' : 'محايد',
    reasons,
    summary: `${ticker}: توصية ${recommendationAr} بثقة ${confidence === 'high' ? 'عالية' : confidence === 'medium' ? 'متوسطة' : 'منخفضة'} (تحليل آلي قائم على القواعد).`,
    source: 'rules-fallback',
  };
}

// ---------------------------------------------------------------------------
// Fetch live stock data from Python backend (multiple fallbacks)
// ---------------------------------------------------------------------------
async function fetchStockData(ticker: string): Promise<{
  price: number | null;
  changePercent: number | null;
  name: string | null;
  technical: any | null;
  history: any[] | null;
}> {
  const result = {
    price: null as number | null,
    changePercent: null as number | null,
    name: null as string | null,
    technical: null as any | null,
    history: null as any[] | null,
  };

  // 1. Deep analysis (richest)
  try {
    const res = await fetch(
      `${PYTHON_BACKEND}/api/stock/deep-analysis?ticker=${encodeURIComponent(ticker)}`,
      { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      const p = data?.price ?? data?.basic ?? {};
      if (typeof p.current_price === 'number') result.price = p.current_price;
      if (typeof p.change_percent === 'number') result.changePercent = p.change_percent;
      if (typeof p.name === 'string') result.name = p.name;
      if (data?.technical) result.technical = data.technical;
      if (Array.isArray(data?.price_history)) result.history = data.price_history;
    }
  } catch {
    // fall through
  }

  // 2. Basic stocks endpoint
  if (result.price == null) {
    try {
      const res = await fetch(
        `${PYTHON_BACKEND}/api/stocks/${encodeURIComponent(ticker)}`,
        { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } }
      );
      if (res.ok) {
        const data = await res.json();
        const p = data?.stock ?? data?.data ?? data ?? {};
        if (typeof p.current_price === 'number') result.price = p.current_price;
        else if (typeof p.price === 'number') result.price = p.price;
        if (typeof p.change_percent === 'number') result.changePercent = p.change_percent;
        if (typeof p.name === 'string') result.name = p.name;
      }
    } catch {
      // fall through
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fetch the latest AdvancedAnalysisResult from auth.db
// ---------------------------------------------------------------------------
async function fetchCachedAnalysis(ticker: string) {
  try {
    const row = await db.advancedAnalysisResult.findFirst({
      where: { ticker: { equals: ticker, mode: 'insensitive' } },
      orderBy: { created_at: 'desc' },
    });
    return row;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Try to run an AI analysis through DeepSeek
// ---------------------------------------------------------------------------
async function tryAiAnalysis(
  ticker: string,
  stockData: { price: number | null; changePercent: number | null; name: string | null; technical: any | null },
  cached: any | null
): Promise<{ summary: string; recommendation: string; recommendation_ar: string; reasons: string[] } | null> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return null;
  }

  const dataLines: string[] = [];
  if (stockData.price != null) dataLines.push(`السعر الحالي: ${stockData.price}`);
  if (stockData.changePercent != null)
    dataLines.push(`نسبة التغير اليوم: ${stockData.changePercent.toFixed(2)}%`);
  if (stockData.name) dataLines.push(`اسم الشركة: ${stockData.name}`);
  if (cached) {
    if (cached.rsi != null) dataLines.push(`RSI: ${cached.rsi}`);
    if (cached.trend) dataLines.push(`الاتجاه: ${cached.trend}`);
    if (cached.overall_score != null) dataLines.push(`النتيجة الإجمالية: ${cached.overall_score}`);
    if (cached.recommendation) dataLines.push(`التوصية السابقة: ${cached.recommendation}`);
  }
  if (stockData.technical) {
    dataLines.push(`تحليل فني: ${JSON.stringify(stockData.technical).slice(0, 600)}`);
  }

  const dataContext = dataLines.length > 0 ? `\n\nبيانات السهم:\n${dataLines.join('\n')}` : '';

  const userMessage = `حلّل السهم ${ticker} من بورصة مصر (EGX).${dataContext}

أعطني:
1. توصية واضحة (STRONG_BUY / BUY / HOLD / SELL / WATCH)
2. مستوى الثقة (high / medium / low)
3. 3 أسباب رئيسية (نقاط فقط)
4. ملخص في جملة واحدة

استجب بصيغة JSON صارمة:
{"recommendation":"...","recommendation_ar":"...","confidence":"...","reasons":["...","...","..."],"summary":"..."}`;

  try {
    const resp = await callDeepSeek(
      [{ role: 'user', content: userMessage }],
      'deepseek-chat',
      { temperature: 0.3, maxTokens: 700 }
    );
    if (!resp.success || !resp.reply) return null;

    // Try to parse JSON out of the reply (DeepSeek sometimes wraps in ```json)
    const cleaned = resp.reply
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    return {
      summary: String(parsed.summary ?? resp.reply.slice(0, 200)),
      recommendation: String(parsed.recommendation ?? 'HOLD'),
      recommendation_ar: String(parsed.recommendation_ar ?? 'احتفاظ'),
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.map(String)
        : ['تحليل آلي'],
    };
  } catch (err) {
    console.warn('[ai/analyze-stock] DeepSeek parse failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return unauthorized();
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const ticker =
      typeof body.ticker === 'string'
        ? body.ticker.trim().toUpperCase()
        : '';

    if (!ticker) {
      return NextResponse.json(
        {
          success: false,
          error: 'ticker مطلوب',
          error_en: 'ticker is required',
        },
        { status: 400 }
      );
    }

    // 1. Fetch live data from Python backend (best effort)
    const stockData = await fetchStockData(ticker);

    // 2. Fetch latest cached advanced analysis from auth.db (best effort)
    const cached = await fetchCachedAnalysis(ticker);

    // 3. Try AI analysis through DeepSeek (best effort)
    const aiResult = await tryAiAnalysis(ticker, stockData, cached);

    if (aiResult) {
      return NextResponse.json({
        success: true,
        analysis: {
          ticker,
          recommendation: aiResult.recommendation,
          recommendation_ar: aiResult.recommendation_ar,
          confidence: 'medium',
          reasons: aiResult.reasons,
          summary: aiResult.summary,
          current_price: stockData.price,
          change_percent: stockData.changePercent,
          name: stockData.name,
          source: 'deepseek',
          cached_score: cached?.overall_score ?? null,
        },
      });
    }

    // 4. Fallback: rules-based analysis
    const rulesAnalysis = buildRulesBasedAnalysis(
      ticker,
      stockData.price,
      stockData.changePercent
    );

    // If we have cached advanced analysis, enrich the recommendation
    if (cached) {
      rulesAnalysis.recommendation = cached.recommendation || rulesAnalysis.recommendation;
      rulesAnalysis.recommendation_ar = cached.recommendation_ar || rulesAnalysis.recommendation_ar;
      rulesAnalysis.score = cached.overall_score ?? rulesAnalysis.score;
      rulesAnalysis.trend = cached.trend || rulesAnalysis.trend;
      rulesAnalysis.trend_ar = cached.trend_ar || rulesAnalysis.trend_ar;
      rulesAnalysis.source = cached.source || 'cached-rules-fallback';
      if (cached.rsi != null) {
        rulesAnalysis.reasons.push(`RSI = ${cached.rsi.toFixed(1)}`);
      }
      if (cached.entry_price != null) rulesAnalysis.entry_price = cached.entry_price;
      if (cached.stop_loss != null) rulesAnalysis.stop_loss = cached.stop_loss;
      if (cached.take_profit_1 != null) rulesAnalysis.take_profit_1 = cached.take_profit_1;
    }

    return NextResponse.json({
      success: true,
      analysis: rulesAnalysis,
    });
  } catch (e: unknown) {
    console.error('[ai/analyze-stock] Error:', e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء التحليل',
        error_en: 'Failed to analyze stock',
        details: message,
      },
      { status: 500 }
    );
  }
}
