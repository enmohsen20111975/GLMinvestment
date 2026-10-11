/**
 * GET /api/stocks/[ticker]/comprehensive
 * ========================================
 * الشاشة الشاملة لتحليل سهم واحد — تجمع كل المحركات في response واحد.
 *
 * بينادي على:
 * 1. Python /api/stock/deep-analysis (basic + technical + price_history + news + predictions + hunter + board)
 * 2. Next.js /api/maestro/stock/[ticker] (Maestro phases + persona)
 * 3. Next.js /api/stocks/[ticker]/professional-analysis (professional)
 *
 * يرجع schema موحد للـ frontend.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
// getSelfBaseUrl removed — was only used for /api/maestro/stock fetch (now disabled)
// ─── UNIFIED-DATA-CONTRACT (Task UNIFIED-API-V3, Rule 67 + Rule 72) ─────────
// قبل كده: comprehensive route بـ يجيب RSI/support/resistance من Python backend
// أو stocks.db (ممكن يكون قديم). النتيجة: CANA بـ يطلع RSI=79.6 في شاشة و
// RSI=56.8 في شاشة تانية لنفس السهم في نفس اللحظة.
//
// الحل: comprehensive route بـ يستخدم getUnifiedStockData() كمصدر canonical
// للـ RSI/support/resistance/signal. أي قيمة من Python backend بتـ override
// بس لو unified مش متاح.
import { getUnifiedStockData } from '@/lib/unified-stock-data';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND = process.env.PYTHON_BACKEND_URL || process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

interface ComprehensiveResponse {
  success: boolean;
  ticker: string;
  market: string;
  timestamp: string;
  // Section 1: Basic Info + Price
  basic?: Record<string, unknown>;
  price?: Record<string, unknown>;
  keyMetrics?: Record<string, unknown>;
  // Section 2: Technical
  technical?: Record<string, unknown>;
  priceHistory?: Record<string, unknown>[];
  // Section 3: Maestro
  maestro?: Record<string, unknown>;
  // Section 4: Hunter / Board
  hunter?: Record<string, unknown>;
  board?: Record<string, unknown>;
  // Section 5: News
  news?: Record<string, unknown>[];
  // Section 6: Predictions
  predictions?: Record<string, unknown>[];
  // Section 7: Professional
  professional?: Record<string, unknown>;
  // Section 8: CANONICAL (UNIFIED-DATA-CONTRACT, Rule 72)
  canonical?: Record<string, unknown>;
  // Section 9: Prediction (single latest, canonical)
  prediction?: Record<string, unknown>;
  // Section 10: Radar (canonical)
  radar?: Record<string, unknown>;
  // Meta
  errors: string[];
  elapsed_ms: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const startTime = Date.now();
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'EGX';

  const response: ComprehensiveResponse = {
    success: true,
    ticker: tickerUpper,
    market,
    timestamp: new Date().toISOString(),
    errors: [],
    elapsed_ms: 0,
  };

  // Launch all API calls in parallel
  const promises: Promise<void>[] = [];

  // 1. Deep Analysis (Python) — basic, price, technical, history, news, predictions, hunter, board
  promises.push(
    fetch(`${PYTHON_BACKEND}/api/stock/deep-analysis?ticker=${encodeURIComponent(tickerUpper)}&market=${encodeURIComponent(market)}`, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) {
          response.errors.push(`deep-analysis: HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (data.success === false) {
          response.errors.push(`deep-analysis: ${data.error || 'failed'}`);
          return;
        }
        response.basic = data.basic_info;
        response.price = data.price;
        response.keyMetrics = data.key_metrics;
        response.technical = data.technical;
        response.priceHistory = data.price_history;
        response.news = data.news;
        response.predictions = data.predictions;
        response.hunter = data.hunter_assessment;
        response.board = data.board_analysis;
      })
      .catch((e) => {
        response.errors.push(`deep-analysis: ${e instanceof Error ? e.message : 'fetch failed'}`);
      })
  );

  // 2. Maestro Analysis — DISABLED
  // MAESTRO-DISABLED — removed fetch to /api/maestro/stock (Task PHASE-2-MAESTRO-KILL)
  // Owner: "أمسح كل حاجة ليها علاقة بالمايسترو" — Maestro has different thresholds
  // (55/42/30/20) and conflicts with canonical signal.
  // comprehensive route already injects canonical values via getUnifiedStockData()
  // below, so maestro data is no longer needed. The `maestro` section (if populated
  // elsewhere) is still overridden with canonical signal in the UNIFIED-DATA-OVERRIDE block.

  // 3. Professional Analysis (Python)
  promises.push(
    fetch(`${PYTHON_BACKEND}/api/professional-analysis/${encodeURIComponent(tickerUpper)}`, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) {
          response.errors.push(`professional: HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (data.success !== false) {
          response.professional = data.data || data;
        } else {
          response.errors.push(`professional: ${data.error || 'failed'}`);
        }
      })
      .catch((e) => {
        response.errors.push(`professional: ${e instanceof Error ? e.message : 'fetch failed'}`);
      })
  );

  // Wait for all (don't fail if some error)
  await Promise.allSettled(promises);

  response.elapsed_ms = Date.now() - startTime;

  // If basic info is missing, try to get it from the database directly
  if (!response.basic) {
    try {
      // MARKET-FILTER-COMPLETE (Task MARKET-FILTER-COMPLETE):
      // قبل كده: `findFirst({ where: { ticker } })` بـ يرجع أي سهم بالـ ticker ده
      // بغض النظر عن السوق → لو فيه ticker متكرر بين EGX و US (فيه 15 حالة كده
      // بسبب migration قديم) بـ يرجع الأول في الترتيب. الحل: نضيف market filter.
      // EGX → ['EGX', 'مصر'] (الاتنين موجودين في stocks.db). غير كده → market بس.
      const marketVariants = market.toUpperCase() === 'EGX'
        ? ['EGX', 'مصر']
        : [market];
      const stock = await db.stocks.findFirst({
        where: {
          ticker: tickerUpper,
          market: { in: marketVariants },
        },
      });
      if (stock) {
        response.basic = {
          ticker: stock.ticker,
          name: stock.name,
          name_ar: stock.name_ar,
          market: stock.market || market,
          sector: stock.sector || '',
          industry: '',
          is_active: true,
          is_egx30: false,
          is_egx70: false,
          is_egx100: false,
        };
      }
    } catch { // silent fallback (safe-by-design)
      // db might not have stocks table — ignore
    }
  }

  // ─── UNIFIED-DATA-OVERRIDE (Task UNIFIED-API-V3, Rule 72) ───────────────
  // Use canonical values from unified-stock-data.ts for ALL technical fields.
  // This guarantees CANA shows the SAME RSI/support/resistance/signal across
  // all screens (comprehensive / stocks / publish-data / unified / professional).
  const unified = getUnifiedStockData(ticker);
  if (unified) {
    if (!response.technical) response.technical = {};
    if (!response.price) response.price = {};

    // Override with canonical (fresh-computed or pre-computed) values
    response.technical.rsi = unified.technical.rsi;
    response.technical.ma_50 = unified.technical.ma_50;
    response.technical.ma_200 = unified.technical.ma_200;
    response.technical.support = unified.technical.support;
    response.technical.resistance = unified.technical.resistance;
    response.technical.high_52w = unified.technical.high_52w;
    response.technical.low_52w = unified.technical.low_52w;
    response.technical.signal = unified.canonical.signal;
    response.technical.signal_ar = unified.canonical.signal_ar;
    response.technical.trend = unified.technical.trend;
    response.technical.atr = unified.technical.atr;

    // ─── DEEP-AUDIT-FIX (Task DEEP-AUDIT-ALL-ENGINES, Rule 72) ───────────
    // قبل كده: board/maestro/professional كلهم بـ يرجّعوا signals مختلفة
    // بـ thresholds مختلفة (board=78/68, professional=65/55/48, maestro=55/42/30/20).
    // النتيجة: CANA بـ يطلع 3 signals مختلفة على نفس الشاشة.
    //
    // الحل: نـ override كل الـ sub-engine signals بـ canonical signal.
    // الـ sub-engines لسه بـ return بياناتها (composite scores, reasoning, etc.)
    // بس الـ signal النهائي = canonical signal.
    if (response.board && typeof response.board === 'object') {
      (response.board as any).signal = unified.canonical.signal;
      (response.board as any).signal_ar = unified.canonical.signal_ar;
      (response.board as any).master_score = unified.canonical.master_score;
      (response.board as any).recommendation = unified.canonical.signal ? unified.canonical.signal.toLowerCase() : null;
      (response.board as any).recommendation_ar = unified.canonical.signal_ar;
    }
    // MAESTRO-KILL (2026-10-12): maestro section override removed — Maestro deleted.
    // response.maestro is no longer populated (the fetch was already disabled above).
    // We just null out the field so no client tries to use stale Maestro data.
    if ('maestro' in response) {
      response.maestro = null;
    }
    if (response.professional && typeof response.professional === 'object') {
      (response.professional as any).recommendation = unified.canonical.signal ? unified.canonical.signal.toLowerCase() : null;
      (response.professional as any).recommendation_ar = unified.canonical.signal_ar;
      (response.professional as any).score = unified.canonical.master_score;
    }
    if (response.hunter && typeof response.hunter === 'object') {
      (response.hunter as any).signal = unified.canonical.signal;
      (response.hunter as any).signal_ar = unified.canonical.signal_ar;
    }
    if (Array.isArray(response.predictions)) {
      response.predictions = response.predictions.map((p: any) => ({
        ...p,
        signal: unified.canonical.signal,
        signal_ar: unified.canonical.signal_ar,
        master_score: unified.canonical.master_score,
        entry_price: unified.prediction?.entry_price ?? p?.entry_price,
        target_price: unified.prediction?.target_price ?? p?.target_price,
        stop_loss: unified.prediction?.stop_loss ?? p?.stop_loss,
      }));
    }

    // Override price with current_price from stocks.db (always fresh)
    if (unified.stock.current_price != null) {
      response.price.current_price = unified.stock.current_price;
    }
    if (unified.stock.change_percent != null) {
      response.price.change_percent = unified.stock.change_percent;
    }
    if (unified.stock.volume != null) {
      response.price.volume = unified.stock.volume;
    }
    if (unified.stock.last_update != null) {
      response.price.last_update = unified.stock.last_update;
    }

    // Add canonical section (so frontend can read it directly)
    response.canonical = {
      signal: unified.canonical.signal,
      signal_ar: unified.canonical.signal_ar,
      accumulation: unified.canonical.accumulation,
      money_flow: unified.canonical.money_flow,
      phase: unified.canonical.phase,
      master_score: unified.canonical.master_score,
      master_score_source: unified.canonical.master_score_source,
      prediction_is_fresh: unified.canonical.prediction_is_fresh,
      buy_pct: unified.canonical.buy_pct,
      sell_pct: unified.canonical.sell_pct,
    } as any;

    // Add prediction section if available
    if (unified.prediction) {
      response.prediction = {
        entry_price: unified.prediction.entry_price,
        target_price: unified.prediction.target_price,
        target_price_2: unified.prediction.target_price_2,
        target_price_3: unified.prediction.target_price_3,
        stop_loss: unified.prediction.stop_loss,
        risk_reward: unified.prediction.risk_reward,
        confidence: unified.prediction.confidence,
        prediction_date: unified.prediction.prediction_date,
        analysis_reason: unified.prediction.analysis_reason,
        who_is_buying: unified.prediction.who_is_buying,
        hmm_regime: unified.prediction.hmm_regime,
      } as any;
    }

    // Add radar section if available
    if (unified.radar) {
      response.radar = {
        buy_pct: unified.radar.buy_pct,
        sell_pct: unified.radar.sell_pct,
        money_flow_state: unified.canonical.money_flow,
        accumulation: unified.canonical.accumulation,
        path: unified.radar.path,
        under_microscope: unified.radar.under_microscope,
        position_size_pct: unified.radar.position_size_pct,
        data_quality: unified.radar.data_quality,
        staleness_days: unified.radar.staleness_days,
        live_price: unified.radar.live_price,
        price_source: unified.radar.price_source,
      } as any;
    }

    return NextResponse.json(response);
  }

  // ─── FALLBACK: لو unified API فشل، استخدم الـ logic القديم (مع sanity check) ──
  if (response.technical && response.price) {
    const cp = Number(response.price.current_price || response.price.close || 0);
    if (cp > 0) {
      // NO fabrication — keep only real values from DB
      const sup = Number(response.technical.support || 0);
      const res = Number(response.technical.resistance || 0);
      let h52: number | null = response.technical.high_52w != null ? Number(response.technical.high_52w) : null;
      let l52: number | null = response.technical.low_52w != null ? Number(response.technical.low_52w) : null;

      response.technical.support = sup > 0 && sup < cp ? sup : null as any;
      response.technical.resistance = res > cp ? res : null as any;
      if (h52 != null && !isNaN(h52) && h52 > 0) {
        h52 = Math.max(h52, cp);
      } else {
        h52 = null;
      }
      if (l52 != null && !isNaN(l52) && l52 > 0) {
        l52 = Math.min(l52, cp);
      } else {
        l52 = null;
      }

      response.technical.high_52w = h52;
      response.technical.low_52w = l52;
    }
  }

  return NextResponse.json(response);
}
