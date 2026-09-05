/**
 * GET /api/stocks/dual-persona/[ticker]
 * =====================================
 * "سهم واحد، وجهين" — 🎰 المغامر vs 🏦 المستثمر
 *
 * يجلب تحليل الشخصيتين (gambler + investor) + القصة التاريخية (story_arc)
 * لسهم واحد من stored_analyses عبر Python backend.
 *
 * المسار الرئيسي:
 *   1) يحاول /api/stored-analysis/ticker/<ticker> من Python backend (سريع — من DB)
 *   2) لو مش موجود أو مفيش gambler/investor → يحاول /api/maestro/persona/<ticker> (تحليل فوري)
 *   3) لو فشل الاتنين → يرجع 404 برسالة واضحة
 *
 * Response (200):
 * {
 *   success: true,
 *   ticker: "COMI",
 *   price: 132.39,
 *   market: "EGX",
 *   updated_at: "2026-06-23T...",
 *   story: { price_movement, historical_context, dual_verdict },
 *   gambler: { verdict, score, reason, conditions, signal, entry, target, stop },
 *   investor: { verdict, score, reason, conditions, signal, entry, target, stop, timeframe },
 *   narrative: { line1, line2, line3 },
 *   source: "stored" | "live"  // من وين جت البيانات
 * }
 *
 * المعمارية: Python = الدماغ، Node.js = العرض فقط
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://localhost:8010';

interface PersonaData {
  verdict?: string;
  score?: number;
  reason?: string;
  signal?: string;
  conditions?: string[];
  entry?: number | null;
  target?: number | null;
  stop?: number | null;
  timeframe?: string;
}

interface StoryArc {
  price_movement?: string;
  historical_context?: string;
  dual_verdict?: { gambler: string; investor: string };
}

interface DualPersonaResponse {
  success: boolean;
  ticker: string;
  price?: number;
  market?: string;
  updated_at?: string;
  story?: StoryArc;
  gambler?: PersonaData;
  investor?: PersonaData;
  narrative?: { line1?: string; line2?: string; line3?: string };
  source: 'stored' | 'live';
  error?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: tickerRaw } = await params;
  const ticker = tickerRaw.toUpperCase();
  const { searchParams } = new URL(request.url);
  const forceLive = searchParams.get('live') === 'true';

  // ----------------------------------------------------------------
  // Path 1: stored_analyses (سريع — من DB)
  // ----------------------------------------------------------------
  if (!forceLive) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const storedUrl = `${PYTHON_BACKEND.replace(/\/$/, '')}/api/stored-analysis/ticker/${ticker}`;
      const resp = await fetch(storedUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        const row = data?.data || data;

        if (row && row.analysis_json) {
          // analysis_json ممكن يكون string أو object
          let analysisJson: any = row.analysis_json;
          if (typeof analysisJson === 'string') {
            try {
              analysisJson = JSON.parse(analysisJson);
            } catch {
              analysisJson = {};
            }
          }

          const gambler = analysisJson.gambler;
          const investor = analysisJson.investor;
          const storyArc = analysisJson.story_arc;
          const narrative = analysisJson.narrative;

          // لو عندنا gambler أو investor → نرجع البيانات
          if (gambler || investor) {
            const responseBody: DualPersonaResponse = {
              success: true,
              ticker,
              price: Number(row.entry_price) || undefined,
              market: row.market || 'EGX',
              updated_at: row.updated_at,
              story: storyArc,
              gambler,
              investor,
              narrative,
              source: 'stored',
            };
            return NextResponse.json(responseBody);
          }
        }
      }
    } catch (err) {
      console.warn(`[dual-persona] stored path failed for ${ticker}:`, err);
    }
  }

  // ----------------------------------------------------------------
  // Path 2: live analysis via /api/maestro/persona/<ticker> (تحليل فوري)
  // ----------------------------------------------------------------
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const liveUrl = `${PYTHON_BACKEND.replace(/\/$/, '')}/api/maestro/persona/${ticker}?persona=all`;
    const resp = await fetch(liveUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();

      // الـ persona endpoint بيرجع gambler + investor + narrative + price + stock_info
      const responseBody: DualPersonaResponse = {
        success: true,
        ticker,
        price: data.price || data.stock_info?.current_price,
        market: data.stock_info?.market || 'EGX',
        updated_at: new Date().toISOString(),
        story: undefined, // الـ live path ما بيبنيش story_arc (بيتعمل في background_analyzer بس)
        gambler: data.gambler,
        investor: data.investor,
        narrative: data.narrative,
        source: 'live',
      };
      return NextResponse.json(responseBody);
    }
  } catch (err) {
    console.warn(`[dual-persona] live path failed for ${ticker}:`, err);
  }

  // ----------------------------------------------------------------
  // Path 3: فشل الاتنين → 404
  // ----------------------------------------------------------------
  return NextResponse.json<DualPersonaResponse>(
    {
      success: false,
      ticker,
      source: 'stored',
      error: `لا يوجد تحليل متاح للسهم ${ticker}. تأكد أن الـ Python backend شغّال وحاول مرة تانية.`,
    },
    { status: 404 }
  );
}
