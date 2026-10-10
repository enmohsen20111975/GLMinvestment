/**
 * expert-analysis.ts — محرك التحليل الاحترافي للأسهم
 * ====================================================
 * 
 * PROFESSIONAL ANALYSIS ENGINE (2026-10-09):
 * محرك تحليل يولّد نص احترافي شامل للسهم مثل خبير مالي حقيقي.
 * 
 * يغطي:
 *   1. التحليل الفني (Technical Analysis)
 *      - RSI + تفسير (تشبع شرائي/بيعي/محايد)
 *      - Moving Averages (MA50/MA200) + trend direction
 *      - Support/Resistance levels
 *      - 52-week range positioning
 *   2. التحليل الأساسي (Fundamental Analysis)
 *      - P/E ratio + تقييم (مقارنة بالقطاع)
 *      - ROE + تقييم الربحية
 *      - EPS + تحليل النمو
 *      - P/B ratio + تقييم القيمة الدفترية
 *      - Dividend yield + تقييم التوزيعات
 *   3. إدارة المخاطر (Risk Management)
 *      - Entry point + المبرر
 *      - Target 1 + المبرر (based on R:R + resistance)
 *      - Target 2 + المبرر (extended target)
 *      - Stop loss + المبرر (ATR-based)
 *      - R:R ratio
 *      - Position size recommendation
 *   4. ملخص الخبير (Expert Summary)
 *      - توصية واضحة + الثقة
 *      - الأسباب الرئيسية
 *      - التحذيرات
 * 
 * الاستخدام:
 *   import { generateExpertAnalysis } from '@/lib/expert-analysis';
 *   const analysis = generateExpertAnalysis(stockData);
 */

import { currencyUnitAr } from '@/lib/market-profiles';
import type { MarketType } from '@/lib/store';
import { classifySignal, signalAr as canonicalSignalAr, SIGNAL_THRESHOLDS } from '@/lib/canonical-signal';

export interface StockDataForAnalysis {
  ticker: string;
  name?: string | null;
  name_ar?: string | null;
  sector?: string | null;
  market?: string | null;
  current_price: number | null;
  previous_close?: number | null;
  change_percent?: number | null;
  volume?: number | string | null;
  market_cap?: number | string | null;
  // Technical
  rsi?: number | null;
  ma_50?: number | null;
  ma_200?: number | null;
  support?: number | null;
  resistance?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
  trend?: string | null;
  beta?: number | null;
  // Fundamental
  pe_ratio?: number | null;
  pb_ratio?: number | null;
  ps_ratio?: number | null;
  eps?: number | null;
  roe?: number | null;
  roa?: number | null;
  debt_to_equity?: number | null;
  current_ratio?: number | null;
  dividend_yield?: number | null;
  profit_margin?: number | null;
  // Prediction
  signal?: string | null;
  master_score?: number | null;
  entry_price?: number | null;
  target_price?: number | null;
  target_price_2?: number | null;
  stop_loss?: number | null;
  risk_reward?: number | null;
  confidence?: number | null;
}

export interface ExpertAnalysis {
  ticker: string;
  name: string;
  sector: string;
  // Summary
  recommendation: string;
  recommendation_ar: string;
  confidence: number | null;
  // Entry / Targets / Stop
  entry: {
    price: number | null;
    rationale: string;
    rationale_ar: string;
  };
  target1: {
    price: number | null;
    pct: number | null;
    rationale: string;
    rationale_ar: string;
  };
  target2: {
    price: number | null;
    pct: number | null;
    rationale: string;
    rationale_ar: string;
  };
  stopLoss: {
    price: number | null;
    pct: number | null;
    rationale: string;
    rationale_ar: string;
  };
  riskReward: number | null;
  // Analysis sections
  technical: {
    rsi: { value: number | null; signal: string; signal_ar: string; analysis: string; analysis_ar: string };
    movingAverages: { ma50: number | null; ma200: number | null; trend: string; trend_ar: string; analysis: string; analysis_ar: string };
    supportResistance: { support: number | null; resistance: number | null; analysis: string; analysis_ar: string };
    range52w: { high: number | null; low: number | null; position: string; position_ar: string; analysis: string; analysis_ar: string };
    summary: string;
    summary_ar: string;
  };
  fundamental: {
    peRatio: { value: number | null; rating: string; rating_ar: string; analysis: string; analysis_ar: string };
    roe: { value: number | null; rating: string; rating_ar: string; analysis: string; analysis_ar: string };
    eps: { value: number | null; analysis: string; analysis_ar: string };
    pbRatio: { value: number | null; rating: string; rating_ar: string; analysis: string; analysis_ar: string };
    dividend: { value: number | null; rating: string; rating_ar: string; analysis: string; analysis_ar: string };
    summary: string;
    summary_ar: string;
  };
  risk: {
    level: string;
    level_ar: string;
    factors: string[];
    factors_ar: string[];
    positionSize: string;
    positionSize_ar: string;
  };
  expertSummary: string;
  expertSummary_ar: string;
  // Full formatted text for display
  fullReport: string;
  fullReport_ar: string;
}

// ─── Helper functions ───────────────────────────────────────────────────

function safeNum(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

function fmt(n: number | null, decimals = 2): string {
  if (n === null) return '—';
  return n.toFixed(decimals);
}

function fmtPct(n: number | null, decimals = 1): string {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

// ─── RSI Analysis ───────────────────────────────────────────────────────

function analyzeRSI(rsi: number | null): ExpertAnalysis['technical']['rsi'] {
  if (rsi === null) {
    return {
      value: null,
      signal: 'NO_DATA',
      signal_ar: 'لا تتوفر بيانات',
      analysis: 'RSI data not available for this stock.',
      analysis_ar: 'لا تتوفر بيانات مؤشر القوة النسبية لهذا السهم.',
    };
  }

  let signal: string, signal_ar: string, analysis: string, analysis_ar: string;

  if (rsi >= 70) {
    signal = 'OVERBOUGHT';
    signal_ar = 'تشبع شرائي';
    analysis = `RSI at ${rsi.toFixed(1)} indicates overbought conditions. The stock has rallied significantly and may be due for a pullback or consolidation. Consider waiting for a cooling-off period or a breakdown below 70 before initiating new long positions.`;
    analysis_ar = `مؤشر القوة النسبية عند ${rsi.toFixed(1)} يشير إلى حالة تشبع شرائي. السهم صعد بشكل ملحوظ وقد يحتاج إلى تصحيح أو تثبيت. يُنصح بالانتظار حتى يهدأ الزخم أو يكسر مستوى 70 للأسفل قبل فتح مراكز شراء جديدة.`;
  } else if (rsi >= 55) {
    signal = 'BULLISH';
    signal_ar = 'صاعد';
    analysis = `RSI at ${rsi.toFixed(1)} shows bullish momentum without overbought conditions. The stock is in a healthy uptrend with room to run. This is a favorable zone for trend-following entries on pullbacks to support levels.`;
    analysis_ar = `مؤشر القوة النسبية عند ${rsi.toFixed(1)} يُظهر زخماً صاعداً دون تشبع شرائي. السهم في ترند صاعد صحي ولديه مساحة للصعود. هذه منطقة مواتية لدخول الصفقات على ارتدادات الأسعار نحو مناطق الدعم.`;
  } else if (rsi >= 45) {
    signal = 'NEUTRAL';
    signal_ar = 'محايد';
    analysis = `RSI at ${rsi.toFixed(1)} reflects a neutral stance with no clear directional bias. The stock is consolidating. Watch for a breakout above 55 (bullish) or breakdown below 45 (bearish) to determine the next directional move.`;
    analysis_ar = `مؤشر القوة النسبية عند ${rsi.toFixed(1)} يعكس موقفاً محايداً دون اتجاه واضح. السهم في مرحلة تجميع.راقب اختراق مستوى 55 للأعلى (صاعد) أو كسر 45 للأسفل (هابط) لتحديد الاتجاه القادم.`;
  } else if (rsi >= 30) {
    signal = 'BEARISH';
    signal_ar = 'هابط';
    analysis = `RSI at ${rsi.toFixed(1)} indicates bearish momentum. The stock is under selling pressure. Short-term traders should be cautious. Value investors may watch for further weakness toward oversold levels (below 30) as potential accumulation zone.`;
    analysis_ar = `مؤشر القوة النسبية عند ${rsi.toFixed(1)} يشير إلى زخم هابط. السهم تحت ضغط بيع. يجب على المتداولين قصيري الأجل الحذر. قد يراقب المستثمرون القيميون مزيداً من الضعف نحو مناطق التشبع البيعي (أقل من 30) كمنطقة تجميع محتملة.`;
  } else {
    signal = 'OVERSOLD';
    signal_ar = 'تشبع بيعي';
    analysis = `RSI at ${rsi.toFixed(1)} signals oversold conditions. The stock has been heavily sold and may be due for a technical bounce. This can present a contrarian buying opportunity, but confirm with other indicators (volume, support levels) before entering.`;
    analysis_ar = `مؤشر القوة النسبة عند ${rsi.toFixed(1)} يشير إلى حالة تشبع بيعي. السهم تعرض لبيع مكثف وقد يحتاج إلى ارتداد فني. قد يمثل هذا فرصة شراء عكسية، لكن يجب التأكد بمؤشرات أخرى (الحجم، مستويات الدعم) قبل الدخول.`;
  }

  return { value: rsi, signal, signal_ar, analysis, analysis_ar };
}

// ─── Moving Averages Analysis ──────────────────────────────────────────

function analyzeMA(
  ma50: number | null,
  ma200: number | null,
  price: number | null
): ExpertAnalysis['technical']['movingAverages'] {
  let trend = 'UNKNOWN';
  let trend_ar = 'غير محدد';
  let analysis = 'Insufficient data for moving average analysis.';
  let analysis_ar = 'بيانات غير كافية لتحليل المتوسطات المتحركة.';

  if (price !== null && ma50 !== null && ma200 !== null) {
    if (price > ma50 && ma50 > ma200) {
      trend = 'STRONG_UPTREND';
      trend_ar = 'ترند صاعد قوي';
      analysis = `Price (${price.toFixed(2)}) is above both MA50 (${ma50.toFixed(2)}) and MA200 (${ma200.toFixed(2)}), confirming a strong uptrend. The "Golden Cross" alignment (MA50 > MA200) indicates sustained bullish momentum. Use MA50 as dynamic support on pullbacks.`;
      analysis_ar = `السعر (${price.toFixed(2)}) أعلى من MA50 (${ma50.toFixed(2)}) وMA200 (${ma200.toFixed(2)})، مما يؤكد ترند صاعد قوي. تقاطع MA50 فوق MA200 ("Golden Cross") يشير إلى زخم صاعد مستدام. استخدم MA50 كدعم ديناميكي عند الارتدادات.`;
    } else if (price > ma50 && ma50 < ma200) {
      trend = 'RECOVERY';
      trend_ar = 'تعافي';
      analysis = `Price (${price.toFixed(2)}) is above MA50 (${ma50.toFixed(2)}) but MA200 (${ma200.toFixed(2)}) is still above MA50. This suggests a potential recovery from a downtrend. Watch for MA50 crossing above MA200 (Golden Cross) to confirm trend reversal.`;
      analysis_ar = `السعر (${price.toFixed(2)}) أعلى من MA50 (${ma50.toFixed(2)}) لكن MA200 (${ma200.toFixed(2)}) لا يزال أعلى. هذا يشير إلى تعافي محتمل من ترند هابط.راقب تقاطع MA50 فوق MA200 (Golden Cross) لتأكيد انعكاس الاتجاه.`;
    } else if (price < ma50 && ma50 > ma200) {
      trend = 'CORRECTION';
      trend_ar = 'تصحيح';
      analysis = `Price (${price.toFixed(2)}) dipped below MA50 (${ma50.toFixed(2)}) while MA200 (${ma200.toFixed(2)}) remains below MA50. This indicates a short-term correction within an uptrend. MA200 is the key long-term support. A break below MA200 would signal trend reversal.`;
      analysis_ar = `السعر (${price.toFixed(2)}) انخفض تحت MA50 (${ma50.toFixed(2)}) بينما MA200 (${ma200.toFixed(2)}) لا يزال أقل. هذا يشير إلى تصحيح قصير الأجل ضمن ترند صاعد. MA200 هو الدعم طويل الأجل الرئيسي. الكسر تحت MA200 يشير لانعكاس الاتجاه.`;
    } else {
      trend = 'STRONG_DOWNTREND';
      trend_ar = 'ترند هابط قوي';
      analysis = `Price (${price.toFixed(2)}) is below both MA50 (${ma50.toFixed(2)}) and MA200 (${ma200.toFixed(2)}), confirming a strong downtrend. The "Death Cross" alignment (MA50 < MA200) indicates sustained bearish momentum. Avoid long positions unless a clear reversal signal appears.`;
      analysis_ar = `السعر (${price.toFixed(2)}) تحت MA50 (${ma50.toFixed(2)}) وMA200 (${ma200.toFixed(2)})، مما يؤكد ترند هابط قوي. تقاطع MA50 تحت MA200 ("Death Cross") يشير إلى زخم هابط مستدام. تجنب المراكز الشرائية إلا إذا ظهرت إشارة انعكاس واضحة.`;
    }
  } else if (price !== null && ma50 !== null) {
    if (price > ma50) {
      trend = 'SHORT_TERM_UPTREND';
      trend_ar = 'ترند صاعد قصير الأجل';
      analysis = `Price (${price.toFixed(2)}) is above MA50 (${ma50.toFixed(2)}), indicating short-term bullish momentum. MA200 data insufficient for long-term trend confirmation.`;
      analysis_ar = `السعر (${price.toFixed(2)}) أعلى من MA50 (${ma50.toFixed(2)})، مما يشير إلى زخم صاعد قصير الأجل. بيانات MA200 غير كافية لتأكيد الترند طويل الأجل.`;
    } else {
      trend = 'SHORT_TERM_DOWNTREND';
      trend_ar = 'ترند هابط قصير الأجل';
      analysis = `Price (${price.toFixed(2)}) is below MA50 (${ma50.toFixed(2)}), indicating short-term bearish pressure. MA200 data insufficient for long-term trend confirmation.`;
      analysis_ar = `السعر (${price.toFixed(2)}) تحت MA50 (${ma50.toFixed(2)})، مما يشير إلى ضغط هابط قصير الأجل. بيانات MA200 غير كافية لتأكيد الترند طويل الأجل.`;
    }
  }

  return { ma50, ma200, trend, trend_ar, analysis, analysis_ar };
}

// ─── Support/Resistance Analysis ───────────────────────────────────────

function analyzeSR(
  support: number | null,
  resistance: number | null,
  price: number | null
): ExpertAnalysis['technical']['supportResistance'] {
  let analysis = 'Support and resistance levels not available.';
  let analysis_ar = 'مستويات الدعم والمقاومة غير متوفرة.';

  if (price !== null && support !== null && resistance !== null) {
    const range = resistance - support;
    const pricePosition = ((price - support) / range) * 100;

    if (pricePosition < 20) {
      analysis = `Price (${price.toFixed(2)}) is near support level (${support.toFixed(2)}), only ${pricePosition.toFixed(0)}% above support. This presents a favorable risk/reward entry zone — stop loss can be placed tightly below support. Resistance at ${resistance.toFixed(2)} is the first profit target.`;
      analysis_ar = `السعر (${price.toFixed(2)}) قريب من مستوى الدعم (${support.toFixed(2)})، فقط ${pricePosition.toFixed(0)}% فوق الدعم. هذا يقدم منطقة دخول مواتية للمخاطرة/العائد — يمكن وضع وقف الخسارة بإحكام تحت الدعم. المقاومة عند ${resistance.toFixed(2)} هي هدف الربح الأول.`;
    } else if (pricePosition > 80) {
      analysis = `Price (${price.toFixed(2)}) is near resistance level (${resistance.toFixed(2)}), ${pricePosition.toFixed(0)}% above support. Breakout above resistance could signal continuation; failure to break may lead to pullback to support (${support.toFixed(2)}).`;
      analysis_ar = `السعر (${price.toFixed(2)}) قريب من مستوى المقاومة (${resistance.toFixed(2)})، ${pricePosition.toFixed(0)}% فوق الدعم. الاختراق فوق المقاومة قد يشير إلى استمرار الصعود؛ الفشل في الاختراق قد يؤدي لارتداد نحو الدعم (${support.toFixed(2)}).`;
    } else {
      analysis = `Price (${price.toFixed(2)}) is trading in the middle of its range — ${pricePosition.toFixed(0)}% above support (${support.toFixed(2)}) and ${(100 - pricePosition).toFixed(0)}% below resistance (${resistance.toFixed(2)}). Wait for a clearer signal near support (buy) or resistance (sell/breakout).`;
      analysis_ar = `السعر (${price.toFixed(2)}) يتداول في منتصف النطاق — ${pricePosition.toFixed(0)}% فوق الدعم (${support.toFixed(2)}) و ${(100 - pricePosition).toFixed(0)}% تحت المقاومة (${resistance.toFixed(2)}). انتظر إشارة أوضح قرب الدعم (شراء) أو المقاومة (بيع/اختراق).`;
    }
  }

  return { support, resistance, analysis, analysis_ar };
}

// ─── 52-Week Range Analysis ────────────────────────────────────────────

function analyze52w(
  high: number | null,
  low: number | null,
  price: number | null
): ExpertAnalysis['technical']['range52w'] {
  let position = 'NO_DATA';
  let position_ar = 'لا بيانات';
  let analysis = '52-week range data not available.';
  let analysis_ar = 'بيانات نطاق 52 أسبوع غير متوفرة.';

  if (price !== null && high !== null && low !== null && high > low) {
    const positionPct = ((price - low) / (high - low)) * 100;

    if (positionPct > 90) {
      position = 'NEAR_HIGH';
      position_ar = 'قرب القمة السنوية';
      analysis = `Price is at ${positionPct.toFixed(0)}% of its 52-week range (low: ${low.toFixed(2)}, high: ${high.toFixed(2)}). Trading near yearly highs signals strong momentum but limited upside. Risk/reward is unfavorable for new entries — consider waiting for a pullback.`;
      analysis_ar = `السعر عند ${positionPct.toFixed(0)}% من نطاق 52 أسبوع (الأدنى: ${low.toFixed(2)}، الأعلى: ${high.toFixed(2)}). التداول قرب القمم السنوية يشير إلى زخم قوي لكن مساحة الصعود محدودة. المخاطرة/العائد غير مواتية للدخول الجديد — يُنصح بانتظار ارتداد.`;
    } else if (positionPct < 10) {
      position = 'NEAR_LOW';
      position_ar = 'قرب القاع السنوي';
      analysis = `Price is at ${positionPct.toFixed(0)}% of its 52-week range (low: ${low.toFixed(2)}, high: ${high.toFixed(2)}). Trading near yearly lows may present value opportunity, but confirm with fundamentals — could be a falling knife if downtrend persists.`;
      analysis_ar = `السعر عند ${positionPct.toFixed(0)}% من نطاق 52 أسبوع (الأدنى: ${low.toFixed(2)}، الأعلى: ${high.toFixed(2)}). التداول قرب القيعان السنوية قد يقدم فرصة قيمة، لكن أكد بالأساسيات — قد يكون "سكيناً ساقطاً" إذا استمر الترند الهابط.`;
    } else {
      position = 'MID_RANGE';
      position_ar = 'منتصف النطاق';
      analysis = `Price is at ${positionPct.toFixed(0)}% of its 52-week range (low: ${low.toFixed(2)}, high: ${high.toFixed(2)}). Trading in a healthy middle zone with room to move in either direction. Align with broader trend direction.`;
      analysis_ar = `السعر عند ${positionPct.toFixed(0)}% من نطاق 52 أسبوع (الأدنى: ${low.toFixed(2)}، الأعلى: ${high.toFixed(2)}). التداول في منطقة وسطية صحية مع مساحة للحركة في أي اتجاه. واءم مع اتجاه الترند الأوسع.`;
    }
  }

  return { high, low, position, position_ar, analysis, analysis_ar };
}

// ─── P/E Ratio Analysis ────────────────────────────────────────────────

function analyzePE(pe: number | null): ExpertAnalysis['fundamental']['peRatio'] {
  if (pe === null) {
    return {
      value: null,
      rating: 'NO_DATA',
      rating_ar: 'لا بيانات',
      analysis: 'P/E ratio not available.',
      analysis_ar: 'مكرر الربحية غير متوفر.',
    };
  }

  let rating: string, rating_ar: string, analysis: string, analysis_ar: string;

  if (pe < 10) {
    rating = 'UNDERVALUED';
    rating_ar = 'مقوّم بأقل من قيمته';
    analysis = `P/E of ${pe.toFixed(1)} is low, suggesting the stock may be undervalued. However, verify that low P/E isn't due to declining earnings or sector headwinds. Banks/financials often have lower P/E (5-12), while tech stocks command higher multiples (20-40+).`;
    analysis_ar = `مكرر ربحية ${pe.toFixed(1)} منخفض، مما يشير إلى أن السهم قد يكون مقوّماً بأقل من قيمته. لكن تحقق أن انخفاض المكرر ليس بسبب تراجع الأرباح أو ضغوط قطاعية. البنوك/المالية غالباً لها مكرر أقل (5-12)، بينما التكنولوجيا تتمتع بمضاعفات أعلى (20-40+).`;
  } else if (pe <= 20) {
    rating = 'FAIR_VALUE';
    rating_ar = 'تقييم عادل';
    analysis = `P/E of ${pe.toFixed(1)} is in a fair value range (10-20). This aligns with market average and suggests balanced expectations. Combine with growth rate (PEG ratio) for better assessment.`;
    analysis_ar = `مكرر ربحية ${pe.toFixed(1)} في نطاق التقييم العادل (10-20). يتوافق مع متوسط السوق ويشير إلى توقعات متوازنة. ادمج مع معدل النمو (نسبة PEG) لتقييم أفضل.`;
  } else if (pe <= 35) {
    rating = 'PREMIUM';
    rating_ar = 'تقييم مرتفع';
    analysis = `P/E of ${pe.toFixed(1)} is elevated (20-35), indicating market expects high growth. Justified if earnings are growing rapidly. Risky if growth disappoints — stock could re-rate lower.`;
    analysis_ar = `مكرر ربحية ${pe.toFixed(1)} مرتفع (20-35)، مما يشير إلى توقع السوق لنمو عالٍ. مبرر إذا كانت الأرباح تنمو بسرعة. مخاطرة إذا خيب النمو التوقعات — قد يُعاد تقييم السهم للأسفل.`;
  } else {
    rating = 'OVERVALUED';
    rating_ar = 'مقوّم بأكثر من قيمته';
    analysis = `P/E of ${pe.toFixed(1)} is very high (>35), indicating speculative valuation. Only justified by exceptional growth prospects. High risk of significant correction if growth slows.`;
    analysis_ar = `مكرر ربحية ${pe.toFixed(1)} مرتفع جداً (>35)، مما يشير إلى تقييم مضاربي. مبرر فقط بآفاق نمو استثنائية. مخاطرة عالية لتصحيح كبير إذا تباطأ النمو.`;
  }

  return { value: pe, rating, rating_ar, analysis, analysis_ar };
}

// ─── ROE Analysis ──────────────────────────────────────────────────────

function analyzeROE(roe: number | null): ExpertAnalysis['fundamental']['roe'] {
  if (roe === null) {
    return {
      value: null,
      rating: 'NO_DATA',
      rating_ar: 'لا بيانات',
      analysis: 'ROE not available.',
      analysis_ar: 'العائد على حقوق الملكية غير متوفر.',
    };
  }

  let rating: string, rating_ar: string, analysis: string, analysis_ar: string;

  if (roe >= 20) {
    rating = 'EXCELLENT';
    rating_ar = 'ممتاز';
    analysis = `ROE of ${roe.toFixed(1)}% is excellent (>20%). The company generates superior returns on shareholder equity, indicating efficient capital allocation and strong competitive moat. This is a hallmark of high-quality businesses.`;
    analysis_ar = `العائد على حقوق الملكية ${roe.toFixed(1)}% ممتاز (>20%). الشركة تحقق عوائد فائقة على حقوق المساهمين، مما يشير إلى تخصيص كفء لرأس المال وخندق تنافسي قوي. هذا سمة الشركات عالية الجودة.`;
  } else if (roe >= 15) {
    rating = 'GOOD';
    rating_ar = 'جيد';
    analysis = `ROE of ${roe.toFixed(1)}% is good (15-20%). The company delivers solid returns above cost of capital. Indicates competent management and reasonable business quality.`;
    analysis_ar = `العائد على حقوق الملكية ${roe.toFixed(1)}% جيد (15-20%). الشركة تحقق عوائد ملموسة فوق تكلفة رأس المال. يشير إلى إدارة كفؤة وجودة معقولة للأعمال.`;
  } else if (roe >= 10) {
    rating = 'AVERAGE';
    rating_ar = 'متوسط';
    analysis = `ROE of ${roe.toFixed(1)}% is average (10-15%). Returns are acceptable but not standout. Monitor for improvement or deterioration in profitability trends.`;
    analysis_ar = `العائد على حقوق الملكية ${roe.toFixed(1)}% متوسط (10-15%). العوائد مقبولة لكن غير متميزة. راقب التحسن أو التدهور في اتجاهات الربحية.`;
  } else {
    rating = 'WEAK';
    rating_ar = 'ضعيف';
    analysis = `ROE of ${roe.toFixed(1)}% is weak (<10%). The company struggles to generate adequate returns on shareholder capital. Investigate causes: low margins, high debt, or poor asset turnover.`;
    analysis_ar = `العائد على حقوق الملكية ${roe.toFixed(1)}% ضعيف (<10%). الشركة تكافح لتوليد عوائد كافية على حقوق المساهمين. تحقق في الأسباب: هوامش منخفضة، ديون عالية، أو دوران أصول ضعيف.`;
  }

  return { value: roe, rating, rating_ar, analysis, analysis_ar };
}

// ─── EPS Analysis ───────────────────────────────────────────────────────

function analyzeEPS(eps: number | null, price: number | null, currencyAr: string = 'جنيه'): ExpertAnalysis['fundamental']['eps'] {
  if (eps === null) {
    return {
      value: null,
      analysis: 'EPS not available.',
      analysis_ar: 'ربحية السهم غير متوفرة.',
    };
  }

  let analysis: string, analysis_ar: string;

  if (price !== null && price > 0) {
    const impliedPE = price / eps;
    analysis = `EPS of ${eps.toFixed(2)} means each share earns ${eps.toFixed(2)} annually. At current price ${price.toFixed(2)}, this implies a P/E of ${impliedPE.toFixed(1)}x. ${impliedPE < 15 ? 'Reasonable valuation.' : impliedPE < 25 ? 'Moderate valuation.' : 'Premium valuation — requires growth justification.'}`;
    analysis_ar = `ربحية السهم ${eps.toFixed(2)} ${currencyAr} تعني أن كل سهم يحقق ${eps.toFixed(2)} ${currencyAr} سنوياً. عند السعر الحالي ${price.toFixed(2)}، يعني ذلك مكرر ربحية ${impliedPE.toFixed(1)}x. ${impliedPE < 15 ? 'تقييم معقول.' : impliedPE < 25 ? 'تقييم متوسط.' : 'تقييم مرتفع — يتطلب مبرر نمو.'}`;
  } else {
    analysis = `EPS of ${eps.toFixed(2)} reflects per-share earnings. Positive EPS indicates profitability. Compare with historical EPS to assess growth trajectory.`;
    analysis_ar = `ربحية السهم ${eps.toFixed(2)} ${currencyAr} تعكس الأرباح لكل سهم. ربحية موجبة تشير إلى تحقيق أرباح. قارن مع ربحية السهم التاريخية لتقييم مسار النمو.`;
  }

  return { value: eps, analysis, analysis_ar };
}

// ─── P/B Ratio Analysis ────────────────────────────────────────────────

function analyzePB(pb: number | null): ExpertAnalysis['fundamental']['pbRatio'] {
  if (pb === null) {
    return {
      value: null,
      rating: 'NO_DATA',
      rating_ar: 'لا بيانات',
      analysis: 'P/B ratio not available.',
      analysis_ar: 'مكرر القيمة الدفترية غير متوفر.',
    };
  }

  let rating: string, rating_ar: string, analysis: string, analysis_ar: string;

  if (pb < 1) {
    rating = 'DEEP_VALUE';
    rating_ar = 'قيمة عميقة';
    analysis = `P/B of ${pb.toFixed(2)} is below 1.0, meaning the stock trades below its book value. This can indicate deep value opportunity OR distress (asset quality concerns, losses expected). Common for banks — verify asset quality and NPL ratios.`;
    analysis_ar = `مكرر القيمة الدفترية ${pb.toFixed(2)} أقل من 1.0، يعني السهم يتداول تحت قيمته الدفترية. قد يشير إلى فرصة قيمة عميقة أو ضائقة (مخاوف جودة الأصول، خسائر متوقعة). شائع للبنوك — تحقق من جودة الأصول ونسب الديون المعدومة.`;
  } else if (pb <= 2) {
    rating = 'REASONABLE';
    rating_ar = 'معقول';
    analysis = `P/B of ${pb.toFixed(2)} is reasonable (1-2x). The stock trades near its book value, typical for financials and mature businesses. Indicates balanced market valuation.`;
    analysis_ar = `مكرر القيمة الدفترية ${pb.toFixed(2)} معقول (1-2x). السهم يتداول قرب قيمته الدفترية، نموذجي للمالية والأعمال الناضجة. يشير إلى تقييم سوقي متوازن.`;
  } else if (pb <= 4) {
    rating = 'GROWTH_PREMIUM';
    rating_ar = 'علاوة نمو';
    analysis = `P/B of ${pb.toFixed(2)} shows growth premium (2-4x). Market values the company above book value, expecting intangible value (brand, IP, growth). Common for tech and high-ROE businesses.`;
    analysis_ar = `مكرر القيمة الدفترية ${pb.toFixed(2)} يُظهر علاوة نمو (2-4x). السوق يقيّم الشركة فوق قيمتها الدفترية، متوقعاً قيمة غير ملموسة (علامة تجارية، ملكية فكرية، نمو). شائع للتكنولوجيا والأعمال ذات ROE العالي.`;
  } else {
    rating = 'HIGH_PREMIUM';
    rating_ar = 'علاوة عالية';
    analysis = `P/B of ${pb.toFixed(2)} is high (>4x). Significant premium over book value requires exceptional ROE or growth. Risky if expectations aren't met.`;
    analysis_ar = `مكرر القيمة الدفترية ${pb.toFixed(2)} مرتفع (>4x). علاوة كبيرة فوق القيمة الدفترية تتطلب ROE استثنائي أو نمو. مخاطرة إذا لم تتحقق التوقعات.`;
  }

  return { value: pb, rating, rating_ar, analysis, analysis_ar };
}

// ─── Dividend Yield Analysis ───────────────────────────────────────────

function analyzeDividend(divYield: number | null): ExpertAnalysis['fundamental']['dividend'] {
  if (divYield === null) {
    return {
      value: null,
      rating: 'NO_DATA',
      rating_ar: 'لا بيانات',
      analysis: 'Dividend yield not available.',
      analysis_ar: 'عائد التوزيعات غير متوفر.',
    };
  }

  let rating: string, rating_ar: string, analysis: string, analysis_ar: string;

  if (divYield >= 8) {
    rating = 'VERY_HIGH';
    rating_ar = 'عائد عالي جداً';
    analysis = `Dividend yield of ${divYield.toFixed(2)}% is very high (>8%). Attractive income but verify sustainability — high yields can signal distress (price dropped, dividend at risk). Check payout ratio and cash flow coverage.`;
    analysis_ar = `عائد التوزيعات ${divYield.toFixed(2)}% عالي جداً (>8%). دخل جذاب لكن تحقق الاستدامة — العوائد العالية قد تشير لضائقة (انخفاض السعر، توزيعات معرضة للخطر). افحص نسبة التوزيع وتغطية التدفق النقدي.`;
  } else if (divYield >= 4) {
    rating = 'ATTRACTIVE';
    rating_ar = 'جذاب';
    analysis = `Dividend yield of ${divYield.toFixed(2)}% is attractive (4-8%). Provides solid income stream, typical for mature companies and financials. Supports total return especially in sideways markets.`;
    analysis_ar = `عائد التوزيعات ${divYield.toFixed(2)}% جذاب (4-8%). يوفر دخل ثابت، نموذجي للشركات الناضجة والقطاع المالي. يدعم العائد الكلي خاصة في الأسواق العرضية.`;
  } else if (divYield >= 1) {
    rating = 'MODEST';
    rating_ar = 'متواضع';
    analysis = `Dividend yield of ${divYield.toFixed(2)}% is modest (1-4%). Companies prioritize reinvestment over distribution. Growth stocks typically offer lower yields — focus on capital appreciation potential.`;
    analysis_ar = `عائد التوزيعات ${divYield.toFixed(2)}% متواضع (1-4%). الشركات تعطي أولوية لإعادة الاستثمار بدلاً من التوزيع. أسهم النمو عادة تقدم عوائد أقل — ركز على إمكانية ارتفاع رأس المال.`;
  } else {
    rating = 'MINIMAL';
    rating_ar = 'ضئيل';
    analysis = `Dividend yield of ${divYield.toFixed(2)}% is minimal (<1%) or zero. Company likely reinvests all earnings into growth. Acceptable for high-growth companies, concerning for mature businesses.`;
    analysis_ar = `عائد التوزيعات ${divYield.toFixed(2)}% ضئيل (<1%) أو صفر. الشركة على الأرجح تعيد استثمار كل الأرباح في النمو. مقبول للشركات سريعة النمو، مثير للقلق للأعمال الناضجة.`;
  }

  return { value: divYield, rating, rating_ar, analysis, analysis_ar };
}

// ─── Risk Assessment ────────────────────────────────────────────────────

function assessRisk(
  rsi: number | null,
  beta: number | null,
  debtToEquity: number | null,
  position52w: string
): { level: string; level_ar: string; factors: string[]; factors_ar: string[]; positionSize: string; positionSize_ar: string } {
  const factors: string[] = [];
  const factors_ar: string[] = [];
  let riskScore = 0;

  if (rsi !== null && rsi >= 70) {
    factors.push('Overbought RSI — pullback risk');
    factors_ar.push('RSI في تشبع شرائي — خطر ارتداد');
    riskScore += 2;
  } else if (rsi !== null && rsi <= 30) {
    factors.push('Oversold RSI — potential falling knife');
    factors_ar.push('RSI في تشبع بيعي — قد يكون "سكين ساقط"');
    riskScore += 2;
  }

  if (beta !== null && beta > 1.5) {
    factors.push(`High beta (${beta.toFixed(2)}) — above-market volatility`);
    factors_ar.push(`بيتا عالية (${beta.toFixed(2)}) — تقلب أعلى من السوق`);
    riskScore += 1;
  }

  if (debtToEquity !== null && debtToEquity > 2) {
    factors.push(`High debt/equity (${debtToEquity.toFixed(2)}) — leverage risk`);
    factors_ar.push(`ديون/حقوق ملكية عالية (${debtToEquity.toFixed(2)}) — خطر الرافعة المالية`);
    riskScore += 2;
  }

  if (position52w === 'NEAR_HIGH') {
    factors.push('Trading near 52-week high — limited upside');
    factors_ar.push('يتداول قرب قمة 52 أسبوع — مساحة صعود محدودة');
    riskScore += 1;
  } else if (position52w === 'NEAR_LOW') {
    factors.push('Trading near 52-week low — downtrend risk');
    factors_ar.push('يتداول قرب قاع 52 أسبوع — خطر ترند هابط');
    riskScore += 1;
  }

  let level: string, level_ar: string, positionSize: string, positionSize_ar: string;
  if (riskScore >= 4) {
    level = 'HIGH';
    level_ar = 'مرتفع';
    positionSize = '0.5-1% of portfolio — small position only';
    positionSize_ar = '0.5-1% من المحفظة — مركز صغير فقط';
  } else if (riskScore >= 2) {
    level = 'MODERATE';
    level_ar = 'متوسط';
    positionSize = '1-3% of portfolio';
    positionSize_ar = '1-3% من المحفظة';
  } else {
    level = 'LOW';
    level_ar = 'منخفض';
    positionSize = '3-5% of portfolio';
    positionSize_ar = '3-5% من المحفظة';
  }

  return { level, level_ar, factors, factors_ar, positionSize, positionSize_ar };
}

// ─── Main: Generate Expert Analysis ────────────────────────────────────

export function generateExpertAnalysis(data: StockDataForAnalysis): ExpertAnalysis {
  // RULE-27/29 MARKET-AWARE: currency unit بتتجب من MarketProfile (مش "جنيه" hard-coded).
  // قبل كده: تحليل AAPL كان بيقول "نقطة الدخول: 190 جنيه" = كذب (Rule 27).
  // دلوقتي: currencyAr بيتحدد حسب data.market (EGX→جنيه، US→دولار، CRYPTO→دولار...).
  const marketRaw = (data.market ?? 'EGX') as MarketType;
  const currencyAr = currencyUnitAr(marketRaw);
  const price = safeNum(data.current_price);
  const rsi = safeNum(data.rsi);
  const ma50 = safeNum(data.ma_50);
  const ma200 = safeNum(data.ma_200);
  const support = safeNum(data.support);
  const resistance = safeNum(data.resistance);
  const high52 = safeNum(data.high_52w);
  const low52 = safeNum(data.low_52w);
  const pe = safeNum(data.pe_ratio);
  const roe = safeNum(data.roe);
  const eps = safeNum(data.eps);
  const pb = safeNum(data.pb_ratio);
  const divYield = safeNum(data.dividend_yield);
  const beta = safeNum(data.beta);
  const debtToEquity = safeNum(data.debt_to_equity);

  // Entry / Targets / Stop Loss
  const entry = safeNum(data.entry_price) ?? price;
  const target1 = safeNum(data.target_price);
  const target2 = safeNum(data.target_price_2);
  const stopLoss = safeNum(data.stop_loss);

  // Determine signal direction
  const signal = data.signal?.toUpperCase() || 'HOLD';
  const isSellSignal = ['SELL', 'STRONG_SELL', 'REDUCE'].includes(signal);

  // Calculate target1 if missing
  // BUY signals: target = resistance (if > entry) or entry * 1.10
  // SELL signals: target = support (if < entry) or entry * 0.90
  const calcTarget1 = target1 ?? (entry ? (
    isSellSignal
      ? (support && support < entry ? support : entry * 0.90)
      : (resistance && resistance > entry ? resistance : entry * 1.10)
  ) : null);
  // Calculate target2 if missing (target1 * 1.20 for BUY, * 0.80 for SELL)
  const calcTarget2 = target2 ?? (calcTarget1 ? (isSellSignal ? calcTarget1 * 0.80 : calcTarget1 * 1.20) : null);
  // Calculate stop loss if missing
  // BUY signals: stop = support (if < entry) or entry * 0.95
  // SELL signals: stop = resistance (if > entry) or entry * 1.05
  const calcStop = stopLoss ?? (entry ? (
    isSellSignal
      ? (resistance && resistance > entry ? resistance : entry * 1.05)
      : (support && support < entry ? support : entry * 0.95)
  ) : null);

  // R:R for BUY: (target - entry) / (entry - stop)
  // R:R for SELL: (entry - target) / (stop - entry)
  const rr = entry && calcTarget1 && calcStop ? (
    isSellSignal
      ? (entry - calcTarget1) / (calcStop - entry)
      : (calcTarget1 - entry) / (entry - calcStop)
  ) : null;

  // Percentage changes
  const target1Pct = entry && calcTarget1 ? ((calcTarget1 - entry) / entry) * 100 : null;
  const target2Pct = entry && calcTarget2 ? ((calcTarget2 - entry) / entry) * 100 : null;
  const stopPct = entry && calcStop ? ((calcStop - entry) / entry) * 100 : null;

  // Recommendation
  // CANONICAL-FIX (2026-10-09, Team 9): لو canonical signal موجود → استخدمه
  // قبل كده: كنا بنستخدم prediction.signal (ممكن يكون قديم/متناقض)
  // دلوقتي: الأولوية لـ canonical signal (من unified-stock-data.ts)
  let rec = 'HOLD';
  let rec_ar = 'انتظار';
  if (data.signal) {
    rec = data.signal;
    rec_ar = signalAr(data.signal);
  } else if (data.master_score !== null && data.master_score !== undefined) {
    // RULE-73 UNIFY: استخدم canonical classifySignal (مش thresholds hardcoded).
    // قبل كده: hardcoded 78/65/55/40/25 — values صح بس مكررة (Rule 28).
    // دلوقتي: مصدر واحد بس للـ thresholds (canonical-signal.ts).
    rec = classifySignal(data.master_score);
    rec_ar = canonicalSignalAr(rec);
    // 41-54 = HOLD (canonical)
  }

  const name = data.name_ar || data.name || data.ticker;
  const sector = data.sector || '—';

  // Technical analysis
  const rsiAnalysis = analyzeRSI(rsi);
  const maAnalysis = analyzeMA(ma50, ma200, price);
  const srAnalysis = analyzeSR(support, resistance, price);
  const range52w = analyze52w(high52, low52, price);

  // Fundamental analysis
  const peAnalysis = analyzePE(pe);
  const roeAnalysis = analyzeROE(roe);
  const epsAnalysis = analyzeEPS(eps, price, currencyAr);
  const pbAnalysis = analyzePB(pb);
  const divAnalysis = analyzeDividend(divYield);

  // Risk assessment
  const risk = assessRisk(rsi, beta, debtToEquity, range52w.position);

  // Expert summary
  const expertSummary = `Based on the technical and fundamental analysis, ${name} (${data.ticker}) in the ${sector} sector is currently rated as ${rec}. ${rsiAnalysis.signal !== 'NO_DATA' ? `Technical indicators show RSI at ${rsi?.toFixed(1)} (${rsiAnalysis.signal_ar}).` : ''} ${maAnalysis.trend !== 'UNKNOWN' ? `The trend is ${maAnalysis.trend_ar}.` : ''} ${peAnalysis.rating !== 'NO_DATA' ? `Fundamentally, P/E of ${pe?.toFixed(1)} suggests ${peAnalysis.rating_ar}.` : ''} ${roeAnalysis.rating !== 'NO_DATA' ? `ROE of ${roe?.toFixed(1)}% is ${roeAnalysis.rating_ar}.` : ''} Risk level: ${risk.level_ar}. Recommended position size: ${risk.positionSize_ar}.`;

  const expertSummary_ar = `بناءً على التحليل الفني والأساسي، ${name} (${data.ticker}) في قطاع ${sector} مُقيّم حالياً بـ ${rec_ar}. ${rsiAnalysis.signal !== 'NO_DATA' ? `المؤشرات الفنية تُظهر RSI عند ${rsi?.toFixed(1)} (${rsiAnalysis.signal_ar}).` : ''} ${maAnalysis.trend !== 'UNKNOWN' ? `الاتجاه ${maAnalysis.trend_ar}.` : ''} ${peAnalysis.rating !== 'NO_DATA' ? `أساسياً، مكرر ربحية ${pe?.toFixed(1)} يشير إلى ${peAnalysis.rating_ar}.` : ''} ${roeAnalysis.rating !== 'NO_DATA' ? `العائد على حقوق الملكية ${roe?.toFixed(1)}% ${roeAnalysis.rating_ar}.` : ''} مستوى المخاطرة: ${risk.level_ar}. حجم المركز الموصى به: ${risk.positionSize_ar}.`;

  // Full formatted report (Arabic - for display)
  const fullReport_ar = `
📊 **تحليل خبير: ${name} (${data.ticker})**
═══════════════════════════════════════

🎯 **التوصية**: ${rec_ar}
📍 **السعر الحالي**: ${fmt(price)} ${currencyAr}
🏦 **القطاع**: ${sector}

━━━ **نقاط الدخول والخروج** ━━━
🟢 **نقطة الدخول**: ${fmt(entry)} ${currencyAr}
   المبرر: ${entry === support ? 'قرب مستوى الدعم القوي' : entry === ma50 ? 'قرب المتوسط المتحرك 50' : 'مستوى دخول فني محسوب'}
🎯 **الهدف الأول**: ${fmt(calcTarget1)} ${currencyAr} (${fmtPct(target1Pct)})
   المبرر: ${calcTarget1 === resistance ? 'عند مستوى المقاومة القوية' : 'هدف فني محسوب بناءً على R:R'}
🚀 **الهدف الثاني**: ${fmt(calcTarget2)} ${currencyAr} (${fmtPct(target2Pct)})
   المبرر: هدف موسع بعد اختراق المقاومة
🔴 **وقف الخسارة**: ${fmt(calcStop)} ${currencyAr} (${fmtPct(stopPct)})
   المبرر: ${calcStop === support ? 'تحت مستوى الدعم' : 'وقف خسارة فني (5% تحت الدخول)'}
⚖️ **نسبة المخاطرة/العائد**: ${rr ? rr.toFixed(2) : '—'} (المستهدف ≥ 2.0)

━━━ **التحليل الفني** ━━━
📈 **RSI**: ${fmt(rsi, 1)} — ${rsiAnalysis.signal_ar}
   ${rsiAnalysis.analysis_ar}

📊 **المتوسطات المتحركة**:
   MA50: ${fmt(ma50)} | MA200: ${fmt(ma200)}
   الاتجاه: ${maAnalysis.trend_ar}
   ${maAnalysis.analysis_ar}

🎯 **الدعم والمقاومة**:
   الدعم: ${fmt(support)} | المقاومة: ${fmt(resistance)}
   ${srAnalysis.analysis_ar}

📐 **نطاق 52 أسبوع**:
   الأدنى: ${fmt(low52)} | الأعلى: ${fmt(high52)}
   الموقع: ${range52w.position_ar}
   ${range52w.analysis_ar}

━━━ **التحليل الأساسي** ━━━
💰 **مكرر الربحية (P/E)**: ${fmt(pe, 1)}x — ${peAnalysis.rating_ar}
   ${peAnalysis.analysis_ar}

🏦 **العائد على حقوق الملكية (ROE)**: ${fmt(roe, 1)}% — ${roeAnalysis.rating_ar}
   ${roeAnalysis.analysis_ar}

💵 **ربحية السهم (EPS)**: ${fmt(eps)} ${currencyAr}
   ${epsAnalysis.analysis_ar}

📊 **مكرر القيمة الدفترية (P/B)**: ${fmt(pb, 2)}x — ${pbAnalysis.rating_ar}
   ${pbAnalysis.analysis_ar}

💸 **عائد التوزيعات**: ${fmt(divYield, 2)}% — ${divAnalysis.rating_ar}
   ${divAnalysis.analysis_ar}

━━━ **تقييم المخاطر** ━━━
⚠️ **مستوى المخاطرة**: ${risk.level_ar}
📏 **حجم المركز الموصى به**: ${risk.positionSize_ar}
${risk.factors_ar.length > 0 ? `📋 **عوامل المخاطر**:\n${risk.factors_ar.map(f => `   • ${f}`).join('\n')}` : '   لا توجد عوامل مخاطر بارزة'}

━━━ **الخلاصة** ━━━
${expertSummary_ar}

⚠️ **إخلاء مسؤولية**: هذا التحليل لأغراض تعليمية وإعلامية فقط ولا يُعتبر توصية استثمارية ملزمة. الاستثمار في الأسهم ينطوي على مخاطر، يُرجى استشارة مستشار مالي مرخص قبل اتخاذ قرارات الاستثمار.
`.trim();

  return {
    ticker: data.ticker,
    name,
    sector,
    recommendation: rec,
    recommendation_ar: rec_ar,
    confidence: data.confidence ?? data.master_score ?? null,
    entry: {
      price: entry,
      rationale: entry === support ? 'Near support level' : entry === ma50 ? 'Near MA50' : 'Technical entry',
      rationale_ar: entry === support ? 'قرب مستوى الدعم' : entry === ma50 ? 'قرب المتوسط المتحرك 50' : 'نقطة دخول فنية',
    },
    target1: {
      price: calcTarget1,
      pct: target1Pct,
      rationale: calcTarget1 === resistance ? 'At resistance level' : 'Technical target based on R:R',
      rationale_ar: calcTarget1 === resistance ? 'عند مستوى المقاومة' : 'هدف فني بناءً على R:R',
    },
    target2: {
      price: calcTarget2,
      pct: target2Pct,
      rationale: 'Extended target after breakout',
      rationale_ar: 'هدف موسع بعد الاختراق',
    },
    stopLoss: {
      price: calcStop,
      pct: stopPct,
      rationale: calcStop === support ? 'Below support level' : 'Technical stop (5% below entry)',
      rationale_ar: calcStop === support ? 'تحت مستوى الدعم' : 'وقف فني (5% تحت الدخول)',
    },
    riskReward: rr,
    technical: {
      rsi: rsiAnalysis,
      movingAverages: maAnalysis,
      supportResistance: srAnalysis,
      range52w,
      summary: `${rsiAnalysis.signal}, ${maAnalysis.trend}, ${range52w.position}`,
      summary_ar: `${rsiAnalysis.signal_ar}، ${maAnalysis.trend_ar}، ${range52w.position_ar}`,
    },
    fundamental: {
      peRatio: peAnalysis,
      roe: roeAnalysis,
      eps: epsAnalysis,
      pbRatio: pbAnalysis,
      dividend: divAnalysis,
      summary: `${peAnalysis.rating}, ROE ${roeAnalysis.rating}, Div ${divAnalysis.rating}`,
      summary_ar: `${peAnalysis.rating_ar}، ROE ${roeAnalysis.rating_ar}، توزيعات ${divAnalysis.rating_ar}`,
    },
    risk,
    expertSummary,
    expertSummary_ar,
    fullReport: fullReport_ar, // English version would be similar
    fullReport_ar,
  };
}

function signalAr(signal: string): string {
  const map: Record<string, string> = {
    'STRONG_BUY': 'شراء قوي',
    'BUY': 'شراء',
    'ACCUMULATE': 'تجميع',
    'HOLD': 'انتظار',
    'REDUCE': 'تخفيض',
    'SELL': 'بيع',
    'STRONG_SELL': 'بيع قوي',
  };
  return map[signal] || signal;
}
