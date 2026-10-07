import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { openDb } from '@/lib/shared-db';
import path from 'path';
// ─── PHASE-3-FINAL (Task UNIFICATION-PHASE-3, Rule 73) ────────────────────
import { getUnifiedStockData } from '@/lib/unified-stock-data';

/**
 * GET /api/deal-advisor/[ticker]
 * =============================
 * مستشار الصفقة (Deal Advisor) — Node-side API (no Python dependency).
 *
 * يقرأ مباشرة من قواعد البيانات المحلية (stocks.db + price_history.db)
 * ويرجع تقرير قرار بهيكل ثابت:
 *   1. هوية السهم (identity)
 *   2. السوق والقطاع (market_context)
 *   3. الوضع الفني الآن (technical_state)
 *   4. تقييم سعر الدخول (entry_assessment) — إن وُجد entry_price
 *   5. أحداث جوهرية (events)
 *   6. سيناريوهات التصرف (action_scenarios) — الإلزامي
 *   7. مستويات مقترحة (suggested_levels)
 *   8. تحذير ثابت (disclaimer)
 *
 * Query params (اختيارية):
 *   - entry_price: سعر الدخول (لتقييم الصفقة الحالية)
 *   - entry_qty: الكمية (لحساب PnL)
 *   - entry_date: تاريخ الدخول تقريبي (YYYY-MM-DD)
 *   - persona: gambler | balanced | investor (افتراضي: balanced)
 *   - note: ملاحظة قصيرة من العميل (لا تُحفظ — فقط تعرض في السياق)
 *
 * READ-ONLY: لا يكتب على أي DB. لا يحفظ ملاحظات العميل.
 * Separate channels: لا يخلط إحصائيات الشخصيات.
 */

// ============================================================================
// Types
// ============================================================================

interface DealAdvisorResponse {
  success: boolean;
  ticker: string;
  generated_at: string;
  data_quality: 'complete' | 'partial' | 'minimal';
  persona: 'gambler' | 'balanced' | 'investor';
  // 1. هوية السهم
  identity: {
    ticker: string;
    name: string;
    name_ar: string | null;
    sector: string | null;
    market: string | null;
    classification: 'clean' | 'momentum' | 'high_risk' | 'unknown';
    classification_reason_ar: string;
    is_egx30: boolean;
    is_egx70: boolean;
    is_suspended: boolean;
  };
  // 2. السوق والقطاع
  market_context: {
    trend: 'up' | 'down' | 'flat' | 'unknown';
    trend_ar: string;
    sector_perform_ar: string | null;
    market_regime_ar: string;
    is_market_open: boolean;
  };
  // 3. الوضع الفني الآن
  technical_state: {
    trend: 'bullish' | 'bearish' | 'neutral' | 'unknown';
    trend_ar: string;
    rsi: number | null;
    rsi_state_ar: string;
    above_ma50: boolean | null;
    above_ma200: boolean | null;
    near_support: boolean;
    near_resistance: boolean;
    distance_to_support_pct: number | null;
    distance_to_resistance_pct: number | null;
    extension_from_ma50_pct: number | null;
    volume_vs_avg: number | null; // ratio
    volume_state_ar: string;
    volatility_note_ar: string;
  };
  // 4. تقييم سعر الدخول (إن وُجد)
  entry_assessment: {
    entry_price: number | null;
    current_price: number;
    assessment: 'cheap' | 'fair' | 'expensive' | 'unknown';
    assessment_reason_ar: string;
    pnl_pct: number | null;
    pnl_value: number | null;
    pnl_state_ar: string | null;
    days_held: number | null;
  } | null;
  // 5. أحداث جوهرية
  events: {
    dividend_yield: number | null;
    dps_ttm: number | null;
    ex_dividend_date: string | null;
    has_corporate_action: boolean;
    events_ar: string[];
  };
  // 6. سيناريوهات التصرف — الإلزامي
  action_scenarios: {
    scenarios: Array<{
      name: string;
      name_ar: string;
      trigger: string;
      trigger_ar: string;
      action: 'hold_conditional' | 'reduce' | 'take_profit' | 'exit' | 'add';
      action_ar: string;
      priority: 'high' | 'medium' | 'low';
    }>;
    current_recommendation: {
      action: 'hold_conditional' | 'reduce' | 'take_profit' | 'exit' | 'add' | 'wait';
      action_ar: string;
      reason_ar: string;
    };
  };
  // 7. مستويات مقترحة
  suggested_levels: {
    support: number | null;
    resistance: number | null;
    suggested_stop: number | null;
    stop_reason_ar: string | null;
    reevaluation_level: number | null;
    near_target: number | null;
    rr_ratio: number | null;
    rr_state_ar: string | null;
  };
  // 8. تحذير ثابت
  disclaimer: {
    text_ar: string;
    is_automated: boolean;
    not_guaranteed: boolean;
    client_responsibility: boolean;
  };
  // مصادر البيانات (للشفافية)
  data_sources: string[];
  data_missing: string[];
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

interface StockRow {
  ticker: string;
  name: string;
  name_ar: string | null;
  market: string | null;
  sector: string | null;
  industry: string | null;
  current_price: number | null;
  previous_close: number | null;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  change_percent: number | null;
  volume: number | null;
  market_cap: number | null;
  pe_ratio: number | null;
  pb_ratio: number | null;
  eps: number | null;
  roe: number | null;
  roa: number | null;
  debt_to_equity: number | null;
  dividend_yield: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi: number | null;
  support: number | null;
  resistance: number | null;
  signal: number | null;
  trend: string | null;
  avg_volume: number | null;
  beta: number | null;
  high_52w: number | null;
  low_52w: number | null;
  is_egx30: number | null;
  is_egx70: number | null;
  is_egx100: number | null;
  is_suspended: number | null;
  is_egx: number | null;
  turnover_egp: number | null;
  value_traded: number | null;
  dps_ttm: number | null;
  free_float_percentage: number | null;
}

function getStockFromDb(ticker: string): StockRow | null {
  try {
    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const db = openDb(dbPath);
    const row = db
      .prepare(
        `SELECT ticker, name, name_ar, market, sector, industry, current_price,
                previous_close, open_price, high_price, low_price, change_percent,
                volume, market_cap, pe_ratio, pb_ratio, eps, roe, roa,
                debt_to_equity, dividend_yield, ma_50, ma_200, rsi, support, resistance,
                signal, trend, avg_volume, beta, high_52w, low_52w, is_egx30, is_egx70,
                is_egx100, is_suspended, is_egx, turnover_egp, value_traded, dps_ttm,
                free_float_percentage
         FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1`
      )
      .get(ticker.toUpperCase()) as StockRow | undefined;
    return row ?? null;
  } catch (err) {
    console.error('[deal-advisor] getStockFromDb error:', (err as Error).message);
    return null;
  }
}

interface PriceHistoryRow {
  ticker: string;
  date: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
}

function getPriceHistoryFromDb(ticker: string, days: number = 90): PriceHistoryRow[] {
  try {
    const dbPath = path.join(process.cwd(), 'db', 'price_history.db');
    const db = openDb(dbPath);
    const rows = db
      .prepare(
        `SELECT ticker, date, open_price, high_price, low_price, close_price, volume
         FROM price_history
         WHERE ticker = ? COLLATE NOCASE
         ORDER BY date DESC
         LIMIT ?`
      )
      .all(ticker.toUpperCase(), days) as PriceHistoryRow[];
    return rows ?? [];
  } catch (err) {
    console.error('[deal-advisor] getPriceHistoryFromDb error:', (err as Error).message);
    return [];
  }
}

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(part: number, whole: number): number {
  if (!whole || whole === 0) return 0;
  return (part / whole) * 100;
}

// ============================================================================
// Classification helpers
// ============================================================================

function classifyStock(stock: StockRow): {
  classification: 'clean' | 'momentum' | 'high_risk' | 'unknown';
  reason_ar: string;
} {
  const isEgx30 = Boolean(stock.is_egx30);
  const isSuspended = Boolean(stock.is_suspended);
  const change = Math.abs(safeNum(stock.change_percent) ?? 0);
  const volume = safeNum(stock.volume);
  // value_traded is the effective turnover (price × volume); turnover_egp may be null.
  const turnover = safeNum(stock.value_traded) ?? safeNum(stock.turnover_egp);

  if (isSuspended) {
    return { classification: 'high_risk', reason_ar: 'السهم موقوف عن التداول حالياً' };
  }

  if (isEgx30 && (turnover ?? 0) > 50_000_000) {
    return {
      classification: 'clean',
      reason_ar: `من EGX30 وسيولة عالية (دوران ${formatNum(turnover)} ج.م) — أنظف نسبياً`,
    };
  }

  if (change > 5 || (volume ?? 0) > 5_000_000) {
    return {
      classification: 'momentum',
      reason_ar: `زخم واضح اليوم (تغير ${change.toFixed(2)}%، حجم ${formatNum(volume)}) — يحتاج حذر`,
    };
  }

  if ((turnover ?? 0) < 1_000_000 && (turnover ?? 0) > 0) {
    return {
      classification: 'high_risk',
      reason_ar: `سيولة منخفضة (دوران ${formatNum(turnover)} ج.م) — مخاطرة ارتفاع/هبوط حاد`,
    };
  }

  // لو turnover غير متاح، استخدم isEgx30 كـ proxy
  if (isEgx30) {
    return {
      classification: 'clean',
      reason_ar: 'من EGX30 — سيولة مقبولة وانتشار جيد',
    };
  }

  return {
    classification: 'clean',
    reason_ar: 'سهم عادي — راجع السيولة قبل الدخول',
  };
}

function formatNum(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(2);
}

function isMarketOpenNow(): boolean {
  // EGX hours: 10:00 - 14:30 Cairo time, Sunday-Thursday
  // Cairo = UTC+2 (no DST in winter, +3 in summer — we use +2 for safety)
  const now = new Date();
  const cairoOffset = 2; // UTC+2
  const cairoHour = (now.getUTCHours() + cairoOffset + 24) % 24;
  const cairoDay = (now.getUTCDay() + (cairoOffset >= 12 ? 1 : 0) + 7) % 7; // approx
  const day = now.getUTCDay(); // 0=Sunday
  const isTradingDay = day >= 0 && day <= 4; // Sun-Thu
  return isTradingDay && cairoHour >= 10 && cairoHour < 14.5;
}

function rsiState(rsi: number | null): string {
  if (rsi === null) return 'غير متاح';
  if (rsi >= 70) return 'تشبع شرائي — احتمال تصحيح';
  if (rsi >= 60) return 'قوة معتدلة — زخم صاعد';
  if (rsi >= 40) return 'منطقة محايدة';
  if (rsi >= 30) return 'ضعف — اقتراب من تشبع بيعي';
  return 'تشبع بيعي — احتمال ارتداد';
}

function trendAr(trend: string | null): string {
  if (!trend) return 'غير محدد';
  const t = trend.toLowerCase();
  if (t.includes('up') || t.includes('bull')) return 'صاعد';
  if (t.includes('down') || t.includes('bear')) return 'هابط';
  if (t.includes('neutral') || t.includes('side')) return 'عرضي/محايد';
  return trend;
}

function volumeStateAr(ratio: number | null): string {
  if (ratio === null) return 'غير متاح';
  if (ratio >= 2) return 'حجم مرتفع جداً (×' + ratio.toFixed(1) + ') — اهتمام قوي';
  if (ratio >= 1.3) return 'حجم فوق المتوسط (×' + ratio.toFixed(1) + ')';
  if (ratio >= 0.7) return 'حجم طبيعي';
  if (ratio >= 0.3) return 'حجم منخفض — اهتمام محدود';
  return 'حجم ضعيف جداً — سيولة رقيقة';
}

// ============================================================================
// Main handler
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
): Promise<NextResponse<DealAdvisorResponse>> {
  const { ticker: paramTicker } = await params;
  const ticker = paramTicker.toUpperCase();
  const sp = request.nextUrl.searchParams;

  const entryPrice = safeNum(sp.get('entry_price'));
  const entryQty = safeNum(sp.get('entry_qty'));
  const entryDateStr = sp.get('entry_date');
  const persona = (sp.get('persona') as 'gambler' | 'balanced' | 'investor') || 'balanced';
  const note = sp.get('note'); // not stored — only context

  const dataSources: string[] = [];
  const dataMissing: string[] = [];

  const generatedAt = new Date().toISOString();

  // 1. جلب بيانات السهم من stocks.db
  const stock = getStockFromDb(ticker);
  if (!stock) {
    return NextResponse.json(
      {
        success: false,
        ticker,
        generated_at: generatedAt,
        data_quality: 'minimal',
        persona,
        identity: {
          ticker,
          name: ticker,
          name_ar: null,
          sector: null,
          market: null,
          classification: 'unknown',
          classification_reason_ar: 'السهم غير موجود في قاعدة البيانات',
          is_egx30: false,
          is_egx70: false,
          is_suspended: false,
        },
        market_context: {
          trend: 'unknown',
          trend_ar: 'غير متاح',
          sector_perform_ar: null,
          market_regime_ar: 'غير متاح',
          is_market_open: false,
        },
        technical_state: {
          trend: 'unknown',
          trend_ar: 'غير متاح',
          rsi: null,
          rsi_state_ar: 'غير متاح',
          above_ma50: null,
          above_ma200: null,
          near_support: false,
          near_resistance: false,
          distance_to_support_pct: null,
          distance_to_resistance_pct: null,
          extension_from_ma50_pct: null,
          volume_vs_avg: null,
          volume_state_ar: 'غير متاح',
          volatility_note_ar: 'غير متاح',
        },
        entry_assessment: null,
        events: {
          dividend_yield: null,
          dps_ttm: null,
          ex_dividend_date: null,
          has_corporate_action: false,
          events_ar: ['لا توجد أحداث مؤكدة في المصادر المتاحة'],
        },
        action_scenarios: {
          scenarios: [],
          current_recommendation: {
            action: 'wait',
            action_ar: 'انتظار',
            reason_ar: 'لا توجد بيانات كافية لاتخاذ قرار',
          },
        },
        suggested_levels: {
          support: null,
          resistance: null,
          suggested_stop: null,
          stop_reason_ar: null,
          reevaluation_level: null,
          near_target: null,
          rr_ratio: null,
          rr_state_ar: null,
        },
        disclaimer: {
          text_ar:
            'هذا التحليل مساعد للقرار وليس نصيحة استثمارية. غير مضمون. المسؤولية على العميل. لا يوجد نجاح 80%.',
          is_automated: true,
          not_guaranteed: true,
          client_responsibility: true,
        },
        data_sources: [],
        data_missing: ['stock_profile', 'price_history', 'fundamentals', 'events'],
        error: `السهم ${ticker} غير موجود في قاعدة البيانات`,
      },
      { status: 404 }
    );
  }
  dataSources.push('stocks.db.stocks');

  const currentPrice = safeNum(stock.current_price) ?? safeNum(stock.previous_close) ?? 0;
  let support = safeNum(stock.support);
  let resistance = safeNum(stock.resistance);
  const ma50 = safeNum(stock.ma_50);
  const ma200 = safeNum(stock.ma_200);
  const rsi = safeNum(stock.rsi);
  const volume = safeNum(stock.volume);
  let avgVolume = safeNum(stock.avg_volume);

  // 2. جلب الأسعار التاريخية لحساب التذبذب والامتداد + تحسين الدعم/المقاومة
  const ph = getPriceHistoryFromDb(ticker, 90);
  if (ph.length > 0) dataSources.push('price_history.db.price_history');
  else dataMissing.push('price_history');

  // تحسين الدعم/المقاومة: لو قديمة جداً (أكثر من 30% من السعر الحالي)، احسب من آخر 90 يوم
  if (currentPrice > 0) {
    if (support === null || support < currentPrice * 0.7) {
      // احسب الدعم كـ percentile 25 من low آخر 30 يوم (متجنب القيم الشاذة والبيانات القديمة)
      const recent30 = ph.slice(0, Math.min(30, ph.length));
      const lows = recent30
        .map((r) => safeNum(r.low_price))
        .filter(
          (v): v is number =>
            v !== null && v > 0 && v <= currentPrice * 1.05 && v >= currentPrice * 0.7
        ) // ضمن نطاق منطقي (-30% إلى +5% من السعر الحالي)
        .sort((a, b) => a - b);
      if (lows.length >= 5) {
        const p25Idx = Math.floor(lows.length * 0.25);
        support = lows[p25Idx];
        dataSources.push('price_history:computed_support');
      } else {
        // fallback: MA50 كدعم ديناميكي لو ما في lows كافية
        if (ma50 && ma50 < currentPrice && ma50 >= currentPrice * 0.7) {
          support = ma50;
          dataSources.push('ma50:fallback_support');
        }
      }
    }
    if (resistance === null || resistance < currentPrice * 0.7 || resistance <= currentPrice) {
      // احسب المقاومة كـ percentile 75 من high آخر 30 يوم
      const recent30 = ph.slice(0, Math.min(30, ph.length));
      const highs = recent30
        .map((r) => safeNum(r.high_price))
        .filter(
          (v): v is number =>
            v !== null && v > 0 && v >= currentPrice * 0.95 && v <= currentPrice * 1.3
        ) // ضمن نطاق منطقي (-5% إلى +30% من السعر الحالي)
        .sort((a, b) => a - b);
      if (highs.length >= 5) {
        const p75Idx = Math.floor(highs.length * 0.75);
        resistance = highs[p75Idx];
        dataSources.push('price_history:computed_resistance');
      } else {
        // fallback: high_52w كمقاومة بعيدة لو ما في highs كافية فوق السعر الحالي
        const high52w = safeNum(stock.high_52w);
        if (high52w && high52w > currentPrice) {
          resistance = high52w;
          dataSources.push('high_52w:fallback_resistance');
        }
      }
    }
    // لو المقاومة ما زالت أقل من السعر الحالي، اعتبرها غير متاحة
    if (resistance !== null && resistance <= currentPrice) {
      resistance = null;
    }
    if (support !== null && support >= currentPrice) {
      support = null;
    }
  }

  // تحسين avg_volume: احسب دائماً من price_history (القيمة في stocks.db غير موثوقة)
  if (ph.length >= 20) {
    const recent20 = ph.slice(0, Math.min(20, ph.length));
    const vols = recent20
      .map((r) => safeNum(r.volume))
      .filter((v): v is number => v !== null && v > 1000); // فلتر القيم الشاذة
    if (vols.length >= 5) {
      const computedAvg = vols.reduce((a, b) => a + b, 0) / vols.length;
      // استخدم القيمة المحسوبة لو أكبر من القيمة في DB أو لو DB غير متاح
      if (computedAvg > (avgVolume ?? 0)) {
        avgVolume = computedAvg;
        dataSources.push('price_history:computed_avg_volume');
      }
    }
  }

  // volume_ratio: تجاهل لو avg_volume صغير جداً أو volume غير متاح
  const volumeRatio =
    avgVolume && avgVolume > 100 && volume && volume > 0 ? volume / avgVolume : null;

  // حساب التذبذب (ATR-like) من آخر 14 شمعة — مع فلتر للبيانات الشاذة
  let volatilityPct: number | null = null;
  if (ph.length >= 14 && currentPrice > 0) {
    const recent = ph.slice(0, Math.min(14, ph.length));
    const ranges: number[] = [];
    for (let i = 0; i < recent.length; i++) {
      const high = safeNum(recent[i].high_price) ?? 0;
      const low = safeNum(recent[i].low_price) ?? 0;
      const close = safeNum(recent[i].close_price) ?? 0;
      const prevClose = i > 0 ? (safeNum(recent[i - 1].close_price) ?? close) : close;
      // فلتر: تجاهل القيم غير المنطقية (high < low أو close = 0)
      if (high < low || close <= 0 || high <= 0) continue;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      // فلتر: تجاهل TR أكبر من 25% من السعر (بيانات شاذة)
      if (tr > close * 0.25) continue;
      ranges.push(tr);
    }
    if (ranges.length >= 5) {
      const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
      volatilityPct = (atr / currentPrice) * 100;
      // حد أقصى 15% (أي شيء أعلى غير منطقي لـ EGX)
      if (volatilityPct > 15) volatilityPct = 15;
    }
  }

  // 3. تصنيف السهم
  const classification = classifyStock(stock);

  // 4. تقييم الوضع الفني
  const distToSupport =
    support && currentPrice > 0 ? ((currentPrice - support) / currentPrice) * 100 : null;
  const distToResistance =
    resistance && currentPrice > 0 ? ((resistance - currentPrice) / currentPrice) * 100 : null;
  const extensionFromMa50 =
    ma50 && currentPrice > 0 ? ((currentPrice - ma50) / ma50) * 100 : null;

  const nearSupport = distToSupport !== null && distToSupport >= -2 && distToSupport <= 3;
  const nearResistance = distToResistance !== null && distToResistance >= -3 && distToResistance <= 2;

  const aboveMa50 = ma50 !== null ? currentPrice > ma50 : null;
  const aboveMa200 = ma200 !== null ? currentPrice > ma200 : null;

  let techTrend: 'bullish' | 'bearish' | 'neutral' | 'unknown' = 'unknown';
  if (aboveMa50 !== null && aboveMa200 !== null) {
    if (aboveMa50 && aboveMa200) techTrend = 'bullish';
    else if (!aboveMa50 && !aboveMa200) techTrend = 'bearish';
    else techTrend = 'neutral';
  }
  const techTrendAr =
    techTrend === 'bullish'
      ? 'صاعد (فوق MA50 و MA200)'
      : techTrend === 'bearish'
        ? 'هابط (تحت MA50 و MA200)'
        : techTrend === 'neutral'
          ? 'مختلط (تقاطع بين MA50 و MA200)'
          : 'غير محدد';

  // 5. تقييم سعر الدخول (إن وُجد)
  let entryAssessment: DealAdvisorResponse['entry_assessment'] = null;
  if (entryPrice !== null && entryPrice > 0) {
    const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
    const pnlValue = entryQty ? (currentPrice - entryPrice) * entryQty : null;
    let assessment: 'cheap' | 'fair' | 'expensive' | 'unknown' = 'unknown';
    let reasonAr = '';

    if (ma50 && ma200) {
      const avg = (ma50 + ma200) / 2;
      if (currentPrice < avg * 0.95) {
        assessment = 'cheap';
        reasonAr = `السعر الحالي تحت متوسط MA50/MA200 بـ ${pct(avg - currentPrice, currentPrice).toFixed(1)}%`;
      } else if (currentPrice > avg * 1.05) {
        assessment = 'expensive';
        reasonAr = `السعر الحالي فوق متوسط MA50/MA200 بـ ${pct(currentPrice - avg, currentPrice).toFixed(1)}%`;
      } else {
        assessment = 'fair';
        reasonAr = 'السعر قريب من متوسط MA50/MA200';
      }
    } else {
      reasonAr = 'لا يمكن تقييم الرخص/الغلاء بدون متوسطات سعرية';
    }

    let daysHeld: number | null = null;
    if (entryDateStr) {
      const entryDate = new Date(entryDateStr);
      if (!isNaN(entryDate.getTime())) {
        daysHeld = Math.floor((Date.now() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    let pnlStateAr: string | null = null;
    if (pnlPct >= 15) pnlStateAr = 'ربح قوي — فكر في جني جزئي';
    else if (pnlPct >= 5) pnlStateAr = 'ربح جيد — مراقبة';
    else if (pnlPct >= -5) pnlStateAr = 'قرب نقطة الدخول — صبر';
    else if (pnlPct >= -15) pnlStateAr = 'خسارة معتدلة — راجع الوقف';
    else pnlStateAr = 'خسارة كبيرة — راجع الموقف فوراً';

    entryAssessment = {
      entry_price: entryPrice,
      current_price: currentPrice,
      assessment,
      assessment_reason_ar: reasonAr,
      pnl_pct: pnlPct,
      pnl_value: pnlValue,
      pnl_state_ar: pnlStateAr,
      days_held: daysHeld,
    };
  }

  // 6. الأحداث الجوهرية (من DB فقط — لا اختراع)
  const dividendYield = safeNum(stock.dividend_yield);
  const dpsTtm = safeNum(stock.dps_ttm);
  const eventsAr: string[] = [];
  if (dividendYield && dividendYield > 0) {
    eventsAr.push(`توزيعات نقدية: ${dividendYield.toFixed(2)}% سنوياً`);
  }
  if (dpsTtm && dpsTtm > 0) {
    eventsAr.push(`DPS (آخر 12 شهر): ${dpsTtm.toFixed(2)} ج.م`);
  }
  if (eventsAr.length === 0) {
    eventsAr.push('لا يوجد حدث مؤكد في المصادر المتاحة');
  }

  // 7. سيناريوهات التصرف — الإلزامي
  const scenarios: DealAdvisorResponse['action_scenarios']['scenarios'] = [];

  // سيناريو كسر الدعم
  if (support) {
    scenarios.push({
      name: 'break_support',
      name_ar: 'كسر الدعم',
      trigger: `إذا أغلق السعر تحت ${support.toFixed(2)} ج.م`,
      trigger_ar: `إذا أغلق السعر تحت ${support.toFixed(2)} ج.م`,
      action: 'reduce',
      action_ar: 'تخفيف جزئي (25-50%) أو وقف الخسارة',
      priority: 'high',
    });
  }

  // سيناريو الثبات فوق MA50
  if (ma50) {
    scenarios.push({
      name: 'hold_above_ma50',
      name_ar: 'ثبات فوق MA50',
      trigger: `إذا ثبت السعر فوق ${ma50.toFixed(2)} ج.م (MA50)`,
      trigger_ar: `إذا ثبت السعر فوق ${ma50.toFixed(2)} ج.م (MA50)`,
      action: 'hold_conditional',
      action_ar: 'صبر مشروط مع وقف متحرك تحت MA50',
      priority: 'medium',
    });
  }

  // سيناريو الاقتراب من المقاومة
  if (resistance) {
    scenarios.push({
      name: 'near_resistance',
      name_ar: 'اقتراب من المقاومة',
      trigger: `إذا اقترب السعر من ${resistance.toFixed(2)} ج.م`,
      trigger_ar: `إذا اقترب السعر من ${resistance.toFixed(2)} ج.م`,
      action: 'take_profit',
      action_ar: 'جني جزئي (30-50%) أو تضييق الوقف',
      priority: 'medium',
    });
  }

  // سيناريو كسر المقاومة
  if (resistance) {
    scenarios.push({
      name: 'break_resistance',
      name_ar: 'كسر المقاومة',
      trigger: `إذا أغلق السعر فوق ${resistance.toFixed(2)} ج.م بحجم مرتفع`,
      trigger_ar: `إذا أغلق السعر فوق ${resistance.toFixed(2)} ج.م بحجم مرتفع`,
      action: 'add',
      action_ar: 'إعادة تقييم لإضافة (بعد تأكيد الكسر)',
      priority: 'low',
    });
  }

  // سيناريو RSI تشبع
  if (rsi !== null && rsi >= 70) {
    scenarios.push({
      name: 'rsi_overbought',
      name_ar: 'تشبع شرائي',
      trigger: `RSI = ${rsi.toFixed(0)} (فوق 70)`,
      trigger_ar: `RSI = ${rsi.toFixed(0)} (فوق 70)`,
      action: 'take_profit',
      action_ar: 'جني جزئي — احتمال تصحيح قريب',
      priority: 'medium',
    });
  } else if (rsi !== null && rsi <= 30) {
    scenarios.push({
      name: 'rsi_oversold',
      name_ar: 'تشبع بيعي',
      trigger: `RSI = ${rsi.toFixed(0)} (تحت 30)`,
      trigger_ar: `RSI = ${rsi.toFixed(0)} (تحت 30)`,
      action: 'hold_conditional' as const,
      action_ar: 'انتظار تأكيد الارتداد قبل الإضافة',
      priority: 'medium',
    });
  }

  // التوقع الحالية (محسوبة من البيانات)
  // ─── PHASE-3-FINAL (Task UNIFICATION-PHASE-3, Rule 73: SINGLE-DISPLAY-SOURCE) ─
  // قبل كده: deal-advisor كان بـ ينتج signal خاص بيه (wait/exit/hold_conditional)
  // من computations محلية بـ thresholds مختلفة → CANA بـ يطلع "انتظر" هنا +
  // "شراء قوي" في unified API.
  //
  // الحل: deal-advisor بـ ياخد canonical signal من unified API.
  // الـ action scenarios لسه بتشتغل (للـ entry assessment) بس الـ signal الأساسي
  // = canonical.
  const _unifiedStockData = getUnifiedStockData(ticker);
  const _canonicalSignal = _unifiedStockData?.canonical?.signal ?? 'HOLD';
  const _canonicalSignalAr = _unifiedStockData?.canonical?.signal_ar ?? 'انتظار';

  let currentRec: DealAdvisorResponse['action_scenarios']['current_recommendation'] = {
    action: (_canonicalSignal.toLowerCase() as any) ?? 'hold_conditional',
    action_ar: _canonicalSignalAr,
    reason_ar: 'الإشارة الموحدة: ' + _canonicalSignalAr,
  };

  if (entryAssessment) {
    // لو العميل يملك السهم
    const pnl = entryAssessment.pnl_pct ?? 0;
    if (pnl <= -15) {
      currentRec = {
        action: 'exit',
        action_ar: 'خروج/تخفيف فوري',
        reason_ar: `خسارة كبيرة (${pnl.toFixed(1)}%) — راجع الموقف فوراً وحافظ على رأس المال`,
      };
    } else if (pnl >= 15) {
      currentRec = {
        action: 'take_profit',
        action_ar: 'جني جزئي',
        reason_ar: `ربح قوي (${pnl.toFixed(1)}%) — جني 30-50% ورفع الوقف`,
      };
    } else if (techTrend === 'bearish' && pnl < 0) {
      currentRec = {
        action: 'reduce',
        action_ar: 'تخفيف',
        reason_ar: `الاتجاه هابط والخسارة ${pnl.toFixed(1)}% — تخفيف لتقليل المخاطرة`,
      };
    } else {
      currentRec = {
        action: 'hold_conditional',
        action_ar: 'صبر مشروط',
        reason_ar: `المركز ${pnl >= 0 ? 'رابح' : 'خاسر'} بـ ${Math.abs(pnl).toFixed(1)}% — صبر بشرط بقاء الوقف`,
      };
    }
  } else {
    // لو العميل يفكر في الدخول
    if (nearSupport && techTrend !== 'bearish') {
      currentRec = {
        action: 'wait',
        action_ar: 'انتظار تأكيد',
        reason_ar: 'السعر قرب دعم — انتظر تأكيد الارتداد بحجم قبل الدخول',
      };
    } else if (nearResistance || (rsi !== null && rsi >= 70)) {
      currentRec = {
        action: 'wait',
        action_ar: 'انتظار',
        reason_ar: 'السعر قرب مقاومة أو تشبع — انتظر تصحيح أو كسر مؤكد',
      };
    } else if (techTrend === 'bullish') {
      currentRec = {
        action: 'hold_conditional',
        action_ar: 'مراقبة للدخول',
        reason_ar: 'اتجاه صاعد — انتظر تصحيح لـ MA50 للدخول بوقف واضح',
      };
    } else if (techTrend === 'bearish') {
      currentRec = {
        action: 'wait',
        action_ar: 'انتظار',
        reason_ar: 'اتجاه هابط — لا تشترِ ضد الاتجاه بدون تأكيد انعكاس',
      };
    }
  }

  // 8. مستويات مقترحة
  let suggestedStop: number | null = null;
  let stopReasonAr: string | null = null;

  // الوقف المقترح: الدعم إن وُجد، أو MA50 - (ATR × 1.5)
  if (support && currentPrice > 0 && support < currentPrice) {
    suggestedStop = support * 0.98; // 2% تحت الدعم
    stopReasonAr = `2% تحت الدعم (${support.toFixed(2)})`;
  } else if (ma50 && currentPrice > 0 && ma50 < currentPrice) {
    const atr = volatilityPct ? (volatilityPct / 100) * currentPrice : currentPrice * 0.03;
    suggestedStop = ma50 - atr * 1.5;
    stopReasonAr = `MA50 ناقص 1.5× ATR`;
  } else if (currentPrice > 0) {
    suggestedStop = currentPrice * 0.93; // 7% تحت السعر
    stopReasonAr = '7% تحت السعر الحالي (افتراضي)';
  }

  // إعادة التقييم: MA50 أو نقطة منتصف بين الدعم والمقاومة
  const reevaluationLevel = ma50 ?? (support && resistance ? (support + resistance) / 2 : null);

  // الهدف القريب: المقاومة أو +1× ATR
  let nearTarget: number | null = null;
  if (resistance && resistance > currentPrice) {
    nearTarget = resistance;
  } else if (currentPrice > 0 && volatilityPct) {
    nearTarget = currentPrice * (1 + volatilityPct / 100);
  }

  // R:R ratio
  let rrRatio: number | null = null;
  let rrStateAr: string | null = null;
  if (suggestedStop && nearTarget && currentPrice > 0) {
    const risk = currentPrice - suggestedStop;
    const reward = nearTarget - currentPrice;
    if (risk > 0) {
      rrRatio = reward / risk;
      if (rrRatio >= 2) rrStateAr = 'ممتاز (≥ 2:1)';
      else if (rrRatio >= 1.5) rrStateAr = 'مقبول (≥ 1.5:1)';
      else if (rrRatio >= 1) rrStateAr = 'ضعيف (≥ 1:1) — تحت الحد الأدنى الموصى به';
      else rrStateAr = 'سلبي — المكافأة لا تبرر المخاطرة';
    }
  }

  // 9. سياق السوق
  const marketTrend =
    techTrend === 'bullish' ? 'up' : techTrend === 'bearish' ? 'down' : techTrend === 'neutral' ? 'flat' : 'unknown';
  const marketTrendAr =
    marketTrend === 'up'
      ? 'صاعد'
      : marketTrend === 'down'
        ? 'هابط'
        : marketTrend === 'flat'
          ? 'عرضي'
          : 'غير محدد';

  // 10. تحذير السياق (ملاحظة العميل)
  if (note) {
    // لا نحفظها — فقط نستخدمها في السياق الداخلي (لا تظهر في الرد للحفاظ على الخصوصية)
  }

  // 11. تقييم جودة البيانات
  let dataQuality: 'complete' | 'partial' | 'minimal' = 'complete';
  if (!rsi || !ma50 || !ma200 || !support || !resistance) {
    dataQuality = 'partial';
    if (!rsi) dataMissing.push('rsi');
    if (!ma50) dataMissing.push('ma_50');
    if (!ma200) dataMissing.push('ma_200');
    if (!support) dataMissing.push('support_level');
    if (!resistance) dataMissing.push('resistance_level');
  }
  if (ph.length < 14) {
    dataQuality = 'minimal';
    dataMissing.push('sufficient_price_history');
  }

  // 12. ملاحظة التذبذب
  let volatilityNoteAr = 'غير متاح';
  if (volatilityPct !== null) {
    if (volatilityPct >= 5) volatilityNoteAr = `تذبذب يومي مرتفع (~${volatilityPct.toFixed(1)}%) — حذر`;
    else if (volatilityPct >= 2) volatilityNoteAr = `تذبذب يومي متوسط (~${volatilityPct.toFixed(1)}%)`;
    else volatilityNoteAr = `تذبذب يومي منخفض (~${volatilityPct.toFixed(1)}%)`;
  }

  const response: DealAdvisorResponse = {
    success: true,
    ticker,
    generated_at: generatedAt,
    data_quality: dataQuality,
    persona,
    identity: {
      ticker,
      name: stock.name,
      name_ar: stock.name_ar,
      sector: stock.sector,
      market: stock.market,
      classification: classification.classification,
      classification_reason_ar: classification.reason_ar,
      is_egx30: Boolean(stock.is_egx30),
      is_egx70: Boolean(stock.is_egx70),
      is_suspended: Boolean(stock.is_suspended),
    },
    market_context: {
      trend: marketTrend,
      trend_ar: marketTrendAr,
      sector_perform_ar: stock.sector ? `قطاع: ${stock.sector}` : null,
      market_regime_ar: techTrend === 'bullish' ? 'سوق صاعد' : techTrend === 'bearish' ? 'سوق هابط' : 'سوق عرضي',
      is_market_open: isMarketOpenNow(),
    },
    technical_state: {
      trend: techTrend,
      trend_ar: techTrendAr,
      rsi,
      rsi_state_ar: rsiState(rsi),
      above_ma50: aboveMa50,
      above_ma200: aboveMa200,
      near_support: nearSupport,
      near_resistance: nearResistance,
      distance_to_support_pct: distToSupport,
      distance_to_resistance_pct: distToResistance,
      extension_from_ma50_pct: extensionFromMa50,
      volume_vs_avg: volumeRatio,
      volume_state_ar: volumeStateAr(volumeRatio),
      volatility_note_ar: volatilityNoteAr,
    },
    entry_assessment: entryAssessment,
    events: {
      dividend_yield: dividendYield,
      dps_ttm: dpsTtm,
      ex_dividend_date: null, // غير متاح في DB الحالي
      has_corporate_action: eventsAr.length > 0 && eventsAr[0] !== 'لا يوجد حدث مؤكد في المصادر المتاحة',
      events_ar: eventsAr,
    },
    action_scenarios: {
      scenarios,
      current_recommendation: currentRec,
    },
    suggested_levels: {
      support,
      resistance,
      suggested_stop: suggestedStop,
      stop_reason_ar: stopReasonAr,
      reevaluation_level: reevaluationLevel,
      near_target: nearTarget,
      rr_ratio: rrRatio,
      rr_state_ar: rrStateAr,
    },
    disclaimer: {
      text_ar:
        'هذا التحليل مساعد للقرار وليس نصيحة استثمارية. غير مضمون. المسؤولية على العميل. لا يوجد نجاح 80%.',
      is_automated: true,
      not_guaranteed: true,
      client_responsibility: true,
    },
    data_sources: dataSources,
    data_missing: dataMissing,
  };

  return NextResponse.json(response);
}
