/**
 * Helper functions for MarketAnalysisView modules.
 * Extracted from MarketAnalysisView.tsx as part of PHASE3-BUNDLE-OPT.
 *
 * MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
 * -------------------------------------------------------
 * The remaining references to `maestroScore` in this file are *property
 * names* on `StoredAnalysisItem` that map to the `maestro_score` DB column
 * (stored_analyses table). They are NOT maestro-engine invocations and are
 * intentionally left intact per Rule 4 (NO-DELETION) and the conservative
 * clause of PHASE-2-MAESTRO-UI ("leave DB column references alone").
 * No `/api/maestro/*` calls exist in this file.
 */

import { detectIsSellSignal, isSellSignalLabel, isBuySignalLabel } from '@/lib/signal-utils';
import { MARKET_NAMES_AR, MARKET_CURRENCY_LABEL, MarketType } from '@/lib/store';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';
import type {
  StockData,
  LifecycleStatus,
  StatusBadgeStyle,
  StoredAnalysisItem,
  PersonaData,
  NameMap,
  StockDetail,
  LiveStock,
  PredictionRow,
} from './types';

// DIR-03 (2026-10-12 — GM directive / Rule 67 + Rule 73):
// Single Source of Truth for the stop-loss value shown across table + text + cards.
// Before this, the table read pd.stop while the text formatter read item.entry?.stopLoss
// AND mapPredictionToStockData had its own fallback (entryPrice * 0.93). When these
// diverged (e.g. 4.92 vs 4.97 for IKAZ) users saw two different stop values for the
// same stock in two screens — a public credibility scandal.
// This helper centralizes the resolution: ATR-based stop (entry.stopLoss) wins;
// only fall back to a computed default when the ATR value is missing/invalid.
export function resolveStop(item: StoredAnalysisItem, pdStop?: number | null): number | null {
  // 1) ATR-based stop from the backend (canonical — Rule 67).
  const fromPd = Number(pdStop);
  if (Number.isFinite(fromPd) && fromPd > 0) return fromPd;
  // 2) From the StoredAnalysisItem.entry.stopLoss (same DB column, alternate path).
  const fromEntry = Number(item.entry?.stopLoss);
  if (Number.isFinite(fromEntry) && fromEntry > 0) return fromEntry;
  // 3) No fabricated stop (Rule 27 NO-FAKE-DATA). Surface null -> UI renders "—".
  return null;
}

// ============================================================================
// pickValidPrice
// ============================================================================
export function pickValidPrice(...candidates: Array<unknown>): number | undefined {
  for (const c of candidates) {
    if (c != null) {
      const n = Number(c);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return undefined;
}

// ============================================================================
// Lifecycle / PnL formatting
// ============================================================================
export function getStatusBadge(status: LifecycleStatus | undefined): StatusBadgeStyle {
  switch (status) {
    case 'TARGET_HIT':
      return { label: '🎯 حقق الهدف', badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900', dotClass: 'bg-emerald-500' };
    case 'STOPPED':
      return { label: '🛑 وقف الخسارة', badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-200 dark:border-rose-900', dotClass: 'bg-rose-500' };
    case 'EXPIRED':
      return { label: '⏰ انتهى', badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-900', dotClass: 'bg-amber-500' };
    case 'PENDING':
    default:
      return { label: '⏳ مفتوح', badgeClass: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300 border-teal-200 dark:border-teal-900', dotClass: 'bg-teal-500' };
  }
}

export function pnlColorClass(pnl: number | null | undefined): string {
  if (pnl === null || pnl === undefined) return 'text-muted-foreground';
  return pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
}

export function formatPnl(pnl: number | null | undefined): string {
  if (pnl === null || pnl === undefined) return '—';
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}${pnl.toFixed(2)}%`;
}

/**
 * تنسيق نسبة التغير للسهم.
 * FIX-RECOMMENDATIONS (يوليو 2026): لو مفيش change_percent (null/undefined)
 * نعرض "—" بدل ما نعرض "0.00%" مضلل. لو القيمة 0 فعلياً نعرضها عادي.
 */
export function formatChangePct(change: number | null | undefined): string {
  if (change === null || change === undefined) return '—';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { // silent fallback (safe-by-design)
    return '—';
  }
}

// ============================================================================
// mapPredictionToStockData
// ============================================================================
export function mapPredictionToStockData(p: PredictionRow): StockData {
  const entryPrice = Number(p.entry_price) || Number(p.current_price) || 0;
  const currPrice = Number(p.current_price) || entryPrice;
  let target = Number(p.target_price) || 0;
  let stop = Number(p.stop_loss) || 0;

  // FRONTEND-026: كشف اتجاه الإشارة بالتسمية (SELL/STRONG_SELL/REDUCE/...) أو بالقيم.
  // ده بيمنع الـ BUY fallback من إنه يلغي قيم العقل الصحيحة للـ REDUCE.
  // الواجهة بس تستخدم القيم زي ما هي، مع fallback direction-aware لو ناقصة/معكوسة.
  const isSell = detectIsSellSignal(p.signal, target, stop, entryPrice);
  if (entryPrice > 0) {
    if (isSell) {
      // بيع: الهدف تحت الدخول، الوقف فوق الدخول
      if (target === 0 || target >= entryPrice) {
        target = Number((entryPrice * 0.90).toFixed(2));
      }
      if (stop === 0 || stop <= entryPrice) {
        stop = Number((entryPrice * 1.08).toFixed(2));
      }
    } else {
      // شراء: الهدف فوق الدخول، الوقف تحت الدخول
      if (target === 0 || target <= entryPrice) {
        target = Number((entryPrice * 1.12).toFixed(2));
      }
      if (stop === 0 || stop >= entryPrice) {
        stop = Number((entryPrice * 0.93).toFixed(2));
      }
    }
  }

  const predDate = p.prediction_date || p.created_at || p.updated_at || p.date || '';

  return {
    id: p.id,
    ticker: (p.symbol || p.ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, ''),
    name: p.name || p.symbol || '',
    name_ar: p.name || p.symbol,
    current_price: currPrice,
    high_price: Number(p.high_price) || Number(p.high) || 0,
    low_price: Number(p.low_price) || Number(p.low) || 0,
    max_high_since_pred: Number(p.max_high_since_pred ?? p.highest_price_reached ?? p.high_price ?? 0),
    min_low_since_pred: Number(p.min_low_since_pred ?? p.lowest_price_reached ?? p.low_price ?? 0),
    change_percent: 0,
    signal: p.signal,
    signal_ar: p.signal_ar,
    master_score: Number(p.score) || 0,
    entry_price: entryPrice,
    target_price: target,
    stop_loss: stop,
    risk_reward: Number(p.risk_reward) || (entryPrice > 0 && stop > 0 ? Math.abs(target - entryPrice) / Math.abs(entryPrice - stop) : 0),
    confidence: Number(p.confidence) || 0,
    rsi: Number(p.rsi_value ?? p.rsi) || 50,
    rsi_value: p.rsi_value !== null && p.rsi_value !== undefined ? Number(p.rsi_value) : null,
    technical_score: Number(p.score) || 0,
    prediction_date: predDate,
    // Lifecycle:
    status: p.status || 'PENDING',
    final_price: p.final_price !== null && p.final_price !== undefined ? Number(p.final_price) : null,
    profit_loss_percent: p.profit_loss_percent !== null && p.profit_loss_percent !== undefined ? Number(p.profit_loss_percent) : null,
    hit_target: p.hit_target ?? null,
    hit_stop_loss: p.hit_stop_loss ?? null,
    target_hit_date: p.target_hit_date || null,
    stop_hit_date: p.stop_hit_date || null,
    evaluation_date: p.evaluation_date || null,
    max_profit_percent: p.max_profit_percent !== null && p.max_profit_percent !== undefined ? Number(p.max_profit_percent) : null,
    max_loss_percent: p.max_loss_percent !== null && p.max_loss_percent !== undefined ? Number(p.max_loss_percent) : null,
    holding_days: p.holding_days !== null && p.holding_days !== undefined ? Number(p.holding_days) : null,
    // Rich analysis:
    analysis_methods: Array.isArray(p.analysis_methods) ? p.analysis_methods : null,
    reasons: Array.isArray(p.reasons) ? p.reasons : null,
    trend_direction: p.trend_direction || null,
    macd_histogram: p.macd_histogram !== null && p.macd_histogram !== undefined ? Number(p.macd_histogram) : null,
    candle_patterns: Array.isArray(p.candle_patterns) ? p.candle_patterns : null,
    sr_zone: p.sr_zone || null,
    sr_support: p.sr_support !== null && p.sr_support !== undefined ? Number(p.sr_support) : null,
    sr_resistance: p.sr_resistance !== null && p.sr_resistance !== undefined ? Number(p.sr_resistance) : null,
    atr_value: p.atr_value !== null && p.atr_value !== undefined ? Number(p.atr_value) : null,
    regime: p.regime || null,
    market_ar: p.market_ar || undefined,
    logo_url: p.logo_url || null,
    // P6-PREDICTIONS: القيم التاريخية المُتتبَعة منذ التوقع
    // الأولوية: max_high_since_pred → highest_price_reached → null
    max_high_since_pred: p.max_high_since_pred !== null && p.max_high_since_pred !== undefined
      ? Number(p.max_high_since_pred)
      : (p.highest_price_reached !== null && p.highest_price_reached !== undefined
        ? Number(p.highest_price_reached)
        : null),
    min_low_since_pred: p.min_low_since_pred !== null && p.min_low_since_pred !== undefined
      ? Number(p.min_low_since_pred)
      : (p.lowest_price_reached !== null && p.lowest_price_reached !== undefined
        ? Number(p.lowest_price_reached)
        : null),
  };
}

// ============================================================================
// Market Codes
// ============================================================================
export const MARKET_CODES: Record<MarketType, string> = {
  'EGX': 'EGX',
  'TADAWUL': 'KSA',  // Frontend uses KSA for TADAWUL
  'KSE': 'KSE',
  'QSE': 'QSE',
  'US': 'US',
  'CRYPTO': 'CRYPTO'
};

// ============================================================================
// Market / Date helpers
// ============================================================================
export function isMarketClosedNow(): boolean {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=الأحد, 6=السبت
  
  // السوق المصري: الأحد-الخميس، 10:00-14:30
  const isWorkDay = day >= 0 && day <= 4; // الأحد للخميس
  const isMarketHours = hour >= 10 && hour < 15;
  
  return !isWorkDay || !isMarketHours;
}

// حساب تاريخ الجلسة القادمة
export function getNextTradingDay(): Date {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // لو السبت (6)، يبقى الجلسة القادمة يوم الأحد (بعد يومين)
  if (tomorrow.getDay() === 6) {
    tomorrow.setDate(tomorrow.getDate() + 1);
  }
  // لو الجمعة (5)، يبقى الجلسة القادمة يوم الأحد (بعد يومين)
  if (tomorrow.getDay() === 5) {
    tomorrow.setDate(tomorrow.getDate() + 2);
  }
  
  return tomorrow;
}

// تنسيق التاريخ مع تحديد اليوم أو الغد
export function formatDateLabel(predictionDate?: string): { label: string; dateStr: string } {
  const isClosed = isMarketClosedNow();
  const today = new Date();
  
  if (isClosed) {
    // السوق مقفول - التوقعات لجلسة الغد
    const nextDay = getNextTradingDay();
    const dateStr = nextDay.toLocaleDateString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return {
      label: 'توقعات لجلسة الغد',
      dateStr: dateStr,
    };
  } else {
    // السوق مفتوح - توقعات اليوم
    const dateStr = today.toLocaleDateString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return {
      label: 'توقعات اليوم',
      dateStr: dateStr,
    };
  }
}

// ============================================================================
// Prediction text formatting
// ============================================================================
export function formatAllPredictionsText(stocks: StockData[], market: MarketType): string {
  const marketName = MARKET_NAMES_AR[market] || market;
  const { label, dateStr } = formatDateLabel(stocks[0]?.prediction_date);

  let text = `📊 *${label} - ${marketName}*\n`;
  text += `📅 ${dateStr}\n`;
  text += `━━━━━━━━━━━━━━━━━━━\n\n`;

  stocks.forEach((s, i) => {
    const tp = s.entry_price && s.target_price && s.entry_price > 0
      ? ((s.target_price - s.entry_price) / s.entry_price * 100).toFixed(1)
      : '0.0';
    // FRONTEND-026: شامل لكل إشارات البيع (REDUCE, WEAK_SELL, ...) والشراء (ACCUMULATE, ...)
    const _sigUp = isBuySignalLabel(s.signal);
    const _sigDown = isSellSignalLabel(s.signal);
    const signalIcon = _sigUp
      ? '🟢'
      : _sigDown
      ? '🔴'
      : '🟡';

    text += `${i + 1}- ${signalIcon} *${s.ticker}* - ${s.signal_ar || 'متابعة'}\n`;
    text += `   💰 السعر: ${s.current_price?.toFixed(2)} ${MARKET_CURRENCY_LABEL[market]}\n`;
    text += `   🎯 الهدف: ${s.target_price?.toFixed(2)} (${tp}%)\n`;
    text += `   🛑 وقف الخسارة: ${s.stop_loss?.toFixed(2)}\n`;
    text += `   ⚖️ R/R: ${s.risk_reward?.toFixed(2)}\n`;
    text += `   📈 ثقة: ${Number(s.confidence || 0).toFixed(0)}% | RSI: ${Number(s.rsi || 50).toFixed(0)}\n\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━\n`;
  text += OFFICIAL_LINKS_BLOCK;

  return text;
}

export function formatSinglePredictionText(stock: StockData, market: MarketType = 'EGX'): string {
  const tp = stock.entry_price && stock.target_price && stock.entry_price > 0
    ? ((stock.target_price - stock.entry_price) / stock.entry_price * 100).toFixed(1)
    : '0.0';
  // FRONTEND-026: شامل لكل إشارات البيع (REDUCE, WEAK_SELL, ...) والشراء (ACCUMULATE, ...)
  const _sigUp2 = isBuySignalLabel(stock.signal);
  const _sigDown2 = isSellSignalLabel(stock.signal);
  const signalIcon = _sigUp2
    ? '🟢'
    : _sigDown2
    ? '🔴'
    : '🟡';

  let text = `${signalIcon} *${stock.ticker}* - ${stock.signal_ar || 'متابعة'}\n`;
  text += `💰 السعر: ${stock.current_price?.toFixed(2)} ${MARKET_CURRENCY_LABEL[market]}\n`;
  text += `🎯 الهدف: ${stock.target_price?.toFixed(2)} (${tp}%)\n`;
  text += `🛑 وقف الخسارة: ${stock.stop_loss?.toFixed(2)}\n`;
  text += `⚖️ R/R: ${stock.risk_reward?.toFixed(2)}\n`;
  text += `📈 ثقة: ${Number(stock.confidence || 0).toFixed(0)}% | RSI: ${Number(stock.rsi || 50).toFixed(0)}\n\n`;
  text += `${OFFICIAL_LINKS_BLOCK}\n`;

  return text;
}

// ============================================================================
// Persona pick text formatting
// ============================================================================
export function formatSinglePersonaPickText(item: StoredAnalysisItem, persona: 'conservative' | 'balanced' | 'gambler', market: MarketType): string {
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor، balanced→gambler كتقريب)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  // P26: لو analysisJson مفيهوش sub-dict للبرسونا، ابني PersonaData من الحقول العلوية
  const pd: PersonaData = item.analysisJson?.[_personaKey] || {
    verdict: item.recommendationAr || '',
    score: item.maestroScore || 0,
    reason: '',
    signal: item.recommendation || 'HOLD',
    entry: item.entry?.price ?? null,
    target: item.entry?.target ?? null,
    stop: item.entry?.stopLoss ?? null,
    timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
  };

  // DIR-01 (2026-10-12 — GM directive / Rule 73 SINGLE-DISPLAY-SOURCE):
  // قبل طباعة "🟢 شراء قوي + سعر الدخول"، نفحص isMismatch/isStale.
  // لو السهم منتهي/قديم → نطبع بادج واضح + نمنع أسعار الدخول الوهمية.
  // هذا يطابق سلوك الجدول (PersonaTab L847-874) وينهي التضارب العلني.
  const isMismatch = Boolean(item.priceTargetMismatch);
  const isStale = Boolean(item.stale);
  const isExpired = isMismatch || isStale;
  const staleReason = item.staleReason || (isMismatch ? 'الهدف محقّق — التوقع منتهية' : 'توقع قديمة');

  // الأيقونة: منتهية 🔴 بدل 🟢، عشان العميل يفهم إنها مش فرصة حية.
  const signalIcon = isExpired
    ? '🔴'
    : pd.verdict?.includes('شراء') || pd.verdict?.includes('فرصة') || pd.verdict?.includes('ادخل')
    ? '🟢'
    : pd.verdict?.includes('بيع') || pd.verdict?.includes('تجنب') || pd.verdict?.includes('ابعد') || pd.verdict?.includes('اخرج')
    ? '🔴'
    : '🟡';

  // الـ verdict: لو منتهية → نوضّح كده بدل "شراء قوي"
  const verdictLabel = isExpired
    ? (isMismatch ? 'توقع منتهية (الهدف محقّق)' : `توقع قديمة${item.stalePct ? ` ${item.stalePct}%` : ''}`)
    : (pd.verdict || 'متابعة');

  let text = `${signalIcon} *${item.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '')}* - ${verdictLabel}\n`;
  if (item.nameAr || item.name) {
    text += `🏢 الاسم: ${item.nameAr || item.name}\n`;
  }
  // DIR-01: لو السهم منتهية → نمنع طباعة أسعار الدخول/الأهداف (ممنوع misleading).
  // لو السهم لسه حية → نطبع الأسعار كالعادة.
  if (isExpired) {
    text += `⚠️ ${staleReason}\n`;
    text += `📅 آخر تحديث: ${item.updatedAt || 'غير معروف'}\n`;
  } else {
    if (pd.entry) text += `💰 سعر الدخول: ${pd.entry.toFixed(2)}\n`;
    if (pd.tp1 && pd.tp2) {
      text += `🎯 الأهداف (TP1 / TP2): ${pd.tp1.toFixed(2)} | ${pd.tp2.toFixed(2)}\n`;
    } else if (pd.target) {
      text += `🎯 الهدف: ${pd.target.toFixed(2)}\n`;
    }
    // DIR-03: مصدر موحّد لـ stop عبر resolveStop() (ATR من item.entry.stopLoss).
    const _stop = resolveStop(item, pd.stop);
    if (_stop) text += `🛑 وقف الخسارة (ATR): ${_stop.toFixed(2)}\n`;
    if (pd.timeframe) text += `⏳ أفق الاستثمار: ${pd.timeframe}\n`;
    if (pd.reason) text += `📝 التحليل: ${pd.reason}\n`;
  }

  text += `\n${OFFICIAL_LINKS_BLOCK}\n`;
  return text;
}

export function formatAllPersonaPicksText(items: StoredAnalysisItem[], persona: 'conservative' | 'balanced' | 'gambler', market: MarketType): string {
  const marketName = MARKET_NAMES_AR[market] || market;
  // P26: persona names للنص المنسق — 3 شخصيات
  const personaName = persona === 'conservative'
    ? 'المستثمر 🛡️'
    : persona === 'balanced'
    ? 'المتوازن ⚖️'
    : 'المضارب 🎯';
  let text = `📊 *توقعات ${personaName} - ${marketName}*\n`;
  text += `📅 ${formatDateLabel().dateStr}\n`;
  text += `━━━━━━━━━━━━━━━━━━━\n\n`;

  // إظهار الصفقات النشطة القابلة للتداول فقط وتجنب إدراج التوقعات المنتهية
  const activeItems = items.filter(it => !it.priceTargetMismatch && !it.stale && it.status !== 'CLOSED' && it.status !== 'EXPIRED');
  const targetItems = activeItems.length > 0 ? activeItems : items;

  targetItems.forEach((it, i) => {
    // P26: خريطة الشخصية المعروضة لمفتاح analysisJson + fallback للحقول العلوية
    const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
    const pd: PersonaData = it.analysisJson?.[_personaKey] || {
      verdict: it.recommendationAr || '',
      score: it.maestroScore || 0,
      reason: '',
      signal: it.recommendation || 'HOLD',
      entry: it.entry?.price ?? null,
      target: it.entry?.target ?? null,
      stop: it.entry?.stopLoss ?? null,
      timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
    };

    // DIR-01 (2026-10-12): نفس منطق formatSinglePersonaPickText —
    // فحص isMismatch/isStale قبل طباعة أسعار الدخول.
    const isMismatch = Boolean(it.priceTargetMismatch);
    const isStale = Boolean(it.stale);
    const isExpired = isMismatch || isStale;
    const staleReason = it.staleReason || (isMismatch ? 'الهدف محقّق — التوقع منتهية' : 'توقع قديمة');

    const signalIcon = isExpired
      ? '🔴'
      : pd.verdict?.includes('شراء') || pd.verdict?.includes('فرصة') || pd.verdict?.includes('ادخل')
      ? '🟢'
      : pd.verdict?.includes('بيع') || pd.verdict?.includes('تجنب') || pd.verdict?.includes('ابعد') || pd.verdict?.includes('اخرج')
      ? '🔴'
      : '🟡';

    const verdictLabel = isExpired
      ? (isMismatch ? 'توقع منتهية (الهدف محقّق)' : `توقع قديمة${it.stalePct ? ` ${it.stalePct}%` : ''}`)
      : (pd.verdict || 'متابعة');

    text += `${i + 1}- ${signalIcon} *${it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '')}* - ${verdictLabel}\n`;
    if (it.nameAr || it.name) {
      text += `   🏢 الاسم: ${it.nameAr || it.name}\n`;
    }
    if (isExpired) {
      text += `   ⚠️ ${staleReason}\n`;
      if (it.updatedAt) text += `   📅 آخر تحديث: ${it.updatedAt}\n`;
    } else {
      if (pd.entry) text += `   💰 سعر الدخول: ${pd.entry.toFixed(2)}\n`;
      if (pd.tp1 && pd.tp2) {
        text += `   🎯 الأهداف (TP1 / TP2): ${pd.tp1.toFixed(2)} | ${pd.tp2.toFixed(2)}\n`;
      } else if (pd.target) {
        text += `   🎯 الهدف: ${pd.target.toFixed(2)}\n`;
      }
      // DIR-03: مصدر موحّد لـ stop عبر resolveStop().
      const _stop = resolveStop(it, pd.stop);
      if (_stop) text += `   🛑 وقف الخسارة (ATR): ${_stop.toFixed(2)}\n`;
      if (pd.reason) text += `   📝 التحليل: ${pd.reason}\n`;
    }
    text += `\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━\n`;
  text += OFFICIAL_LINKS_BLOCK;
  return text;
}

// P43-VIRAL-SHARE: قالب التحليل الشامل الغني — يجمع سيناريو المستثمر + المضارب +
// الـ 8 طبقات الفنية + SMC (الحيتان) + الأساسيات + Footer ثابت.
// يُستخدم في زر "نسخ شامل" و"بطاقة تحليل" داخل StockDetailPanel.
export function formatComprehensiveStockText(item: StoredAnalysisItem, market: MarketType, stockDetail?: StockDetail): string {
  const ticker = item.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
  const name = item.nameAr || item.name || ticker;
  const inv = item.analysisJson?.investor || {};
  const gam = item.analysisJson?.gambler || {};
  const fund = item.fundamentals || {};

  const price = pickValidPrice(stockDetail?.current_price, inv.entry, gam.entry, fund.pe_ratio) || 0;
  const changePct = stockDetail?.change_percent != null
    ? stockDetail.change_percent
    : fund?.change_1d != null
    ? fund.change_1d
    : 0;
  const changeIcon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';

  let text = `📊 تحليل شامل: ${name} (${ticker})\n`;
  text += `السعر الحالي: ${price ? price.toFixed(2) : '—'} جنيه | التغير اليومي: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% ${changeIcon}\n\n`;

  // ── الخلاصة التنفيذية ──
  text += `📌 الخلاصة التنفيذية:\n`;
  const summary = inv.reason || gam.reason || item.analysisJson?.narrative?.line1 ||
    'تحليل شامل للسهم بناءً على المؤشرات الفنية والمفاهيم الاستثمارية.';
  text += `${summary}\n\n`;

  // ── سيناريو المستثمر ──
  if (inv.verdict || inv.entry || inv.target) {
    text += `🏦 سيناريو المستثمر (مدى طويل):\n`;
    text += `- التوقع: ${inv.verdict || 'متابعة'}\n`;
    const invEntry = inv.entry;
    if (invEntry) text += `- الدخول: ${invEntry.toFixed(2)}`;
    if (inv.target) {
      const upside = invEntry ? ((inv.target - invEntry) / invEntry * 100) : 0;
      text += ` | الهدف: ${inv.target.toFixed(2)} (${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%)`;
    }
    if (inv.stop) {
      const downside = invEntry ? ((inv.stop - invEntry) / invEntry * 100) : 0;
      text += ` | الوقف: ${inv.stop.toFixed(2)} (${downside.toFixed(1)}%)`;
    }
    text += `\n`;
    if (inv.risk_reward) text += `- نسبة المخاطرة/العائد (R/R): 1:${inv.risk_reward.toFixed(1)}\n`;
    if (inv.timeframe) text += `- الأفق: ${inv.timeframe}\n`;
    text += `\n`;
  }

  // ── سيناريو المضارب ──
  if (gam.verdict || gam.entry || gam.target) {
    text += `🎯 سيناريو المضارب (مدى قصير):\n`;
    text += `- التوقع: ${gam.verdict || 'متابعة'}\n`;
    const gamEntry = gam.entry;
    if (gamEntry) text += `- الدخول: ${gamEntry.toFixed(2)}`;
    if (gam.target) {
      const upside = gamEntry ? ((gam.target - gamEntry) / gamEntry * 100) : 0;
      text += ` | الهدف: ${gam.target.toFixed(2)} (${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%)`;
    }
    if (gam.stop) {
      const downside = gamEntry ? ((gam.stop - gamEntry) / gamEntry * 100) : 0;
      text += ` | الوقف: ${gam.stop.toFixed(2)} (${downside.toFixed(1)}%)`;
    }
    text += `\n`;
    if (gam.risk_reward) text += `- نسبة المخاطرة/العائد (R/R): 1:${gam.risk_reward.toFixed(1)}\n`;
    text += `\n`;
  }

  // ── التحليل الفني (8 طبقات) ──
  text += `التحليل الفني الشامل:
`;
  const gates = inv.gates || gam.gates;
  if (gates) {
    text += `${gates.trend ? '✅' : '❌'} الاتجاه العام: ${gates.trend ? 'صاعد (مؤكد)' : 'هابط/عرضي'}\n`;
  }
  const rsi = inv.rsi || gam.rsi || fund?.rsi;
  if (rsi != null) {
    const rsiStatus = rsi > 70 ? 'تشبع شرائي' : rsi < 30 ? 'تشبع بيعي' : 'صحي';
    text += `🟡 القوة النسبية (RSI): ${rsi.toFixed(0)} (${rsiStatus})\n`;
  }
  const volRatio = inv.volume_ratio || gam.volume_ratio || fund?.volume_ratio;
  if (volRatio != null) {
    text += `${volRatio > 1.2 ? '✅' : '🟡'} الحجم: ${volRatio.toFixed(1)}x ${volRatio > 1.2 ? '(دخول سيولة)' : '(طبيعي)'}\n`;
  }
  if (inv.support_level || inv.resistance_level || gam.support_level || gam.resistance_level) {
    const srStatus = inv.price_vs_sr || gam.price_vs_sr || 'مستويات محددة';
    text += `✅ المستويات (S/R): ${srStatus}\n`;
  }
  const regime = inv.market_regime || gam.market_regime;
  if (regime) {
    text += `✅ نظام السوق (Regime): ${regime}\n`;
  }
  const momentum = inv.momentum_score || gam.momentum_score;
  if (momentum != null) {
    text += `${momentum > 0 ? '✅' : '🟡'} الزخم (Momentum): ${momentum.toFixed(0)}\n`;
  }
  text += `\n`;

  // ─ـ SMC (Smart Money Concepts) ──
  text += `🐋 تحليل الحيتان (Smart Money Concepts - SMC):\n`;
  if (gates) {
    text += `${gates.liquidity ? '✅' : '❌'} السيولة (Liquidity): ${gates.liquidity ? 'مؤكدة' : 'ضعيفة'}\n`;
    text += `${gates.support_resistance ? '✅' : '❌'} المستويات (S/R): ${gates.support_resistance ? 'مؤكدة' : 'غير مؤكدة'}\n`;
    text += `${gates.confirmation ? '✅' : '❌'} التأكيد (Confirmation): ${gates.confirmation ? 'مؤكد' : 'بانتظار التأكيد'}\n`;
  }
  const gd = inv.gate_details || gam.gate_details;
  if (gd?.trend_reason || gd?.liquidity_reason) {
    text += `✅ Verdict: ${gd.trend_reason || gd.liquidity_reason}\n`;
  }
  text += `\n`;

  // ── الأساسيات ──
  const pe = pickValidPrice(inv.pe_ratio, gam.pe_ratio, fund?.pe_ratio, stockDetail?.pe_ratio);
  const roe = pickValidPrice(inv.roe, gam.roe, fund?.roe);
  const volatility = pickValidPrice(inv.volatility, gam.volatility, fund?.volatility);
  const fairValue = fund?.fair_value_upside;
  if (pe != null || roe != null) {
    text += `📊 التقييم الأساسي (Fundamentals):\n`;
    if (pe != null) {
      const peVerdict = pe < 10 ? 'مقيم بأقل من قيمته' : pe < 20 ? 'عادل' : 'مقيم بأعلى من قيمته';
      text += `- مكرر الربحية (P/E): ${pe.toFixed(1)}x (${peVerdict})\n`;
    }
    if (roe != null) {
      const roeVerdict = roe > 15 ? 'ممتاز' : roe > 10 ? 'جيد' : 'ضعيف';
      text += `- العائد على حقوق الملكية (ROE): ${roe.toFixed(1)}% (${roeVerdict})\n`;
    }
    if (fairValue != null) {
      text += `- القيمة العادلة (PVG): ${fairValue >= 0 ? '+' : ''}${fairValue.toFixed(1)}% ${fairValue >= 0 ? 'خصم (فرصة)' : 'علاوة (حذر)'}\n`;
    }
    if (volatility != null) {
      text += `- التقلب (Volatility): ${volatility.toFixed(1)}%\n`;
    }
    const fundVerdict = (pe != null && pe < 15) && (roe != null && roe > 12)
      ? '🟢 أساسيات قوية تدعم الاستثمار طويل المدى'
      : '🟡 أساسيات متوسطة — يحتاج متابعة دقيقة';
    text += `- التقييم النهائي: ${fundVerdict}\n`;
    text += `\n`;
  }

  text += `-----------------------------------\n`;
  text += OFFICIAL_LINKS_BLOCK;

  return text;
}

// ============================================================================
// Expert prediction text formatting
// ============================================================================
export function formatSingleExpertPredictionText(s: StockData): string {
  const isUp = (s.change_percent || 0) > 0;
  const isDown = (s.change_percent || 0) < 0;
  const changeIcon = isUp ? '🟢' : isDown ? '🔴' : '🟡';
  
  let text = `${changeIcon} *${s.ticker}* - ${s.name_ar || s.name}\n`;
  text += `💰 السعر: ${s.current_price?.toFixed(2)}\n`;
  text += `📈 التغير: ${(s.change_percent || 0) >= 0 ? '+' : ''}${(s.change_percent || 0).toFixed(2)}%\n`;
  if (s.sector) text += `📁 القطاع: ${s.sector}\n`;
  
  text += `\n${OFFICIAL_LINKS_BLOCK}\n`;
  return text;
}

export function formatAllExpertPredictionsText(stocks: StockData[], market: MarketType): string {
  const marketName = MARKET_NAMES_AR[market] || market;
  let text = `📊 *توقعات الخبراء - ${marketName}*\n`;
  text += `📅 ${formatDateLabel().dateStr}\n`;
  text += `━━━━━━━━━━━━━━━━━━━\n\n`;

  stocks.forEach((s, i) => {
    const isUp = (s.change_percent || 0) > 0;
    const isDown = (s.change_percent || 0) < 0;
    const changeIcon = isUp ? '🟢' : isDown ? '🔴' : '🟡';
    
    text += `${i + 1}- ${changeIcon} *${s.ticker}* - ${s.name_ar || s.name}\n`;
    text += `   💰 السعر: ${s.current_price?.toFixed(2)}\n`;
    text += `   📈 التغير: ${(s.change_percent || 0) >= 0 ? '+' : ''}${(s.change_percent || 0).toFixed(2)}%\n`;
    if (s.sector) text += `   📁 القطاع: ${s.sector}\n`;
    text += `\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━\n`;
  text += OFFICIAL_LINKS_BLOCK;
  return text;
}

// ============================================================================
// isTraderPrediction + evalPrediction
// ============================================================================
export function isTraderPrediction(stock: StockData): boolean {
  const rec = String(stock.recommendation || stock.signal || '').toUpperCase();
  const horizon = String(stock.horizon || stock.timeframe || stock.regime || '').toLowerCase();
  const persona = String(stock.persona || stock.persona_type || '').toLowerCase();

  if (
    rec.includes('SWING') ||
    rec.includes('T1') ||
    rec.includes('DAY') ||
    horizon.includes('short') ||
    horizon.includes('day') ||
    horizon.includes('swing') ||
    horizon.includes('t1') ||
    persona.includes('trader') ||
    persona.includes('gambler') ||
    persona.includes('sniper')
  ) {
    return true;
  }

  if (stock.entry_price && stock.target_price && stock.entry_price > 0) {
    const gap = Math.abs((stock.target_price - stock.entry_price) / stock.entry_price);
    if (gap >= 0.08) return false;
  }

  return true;
}

export function evalPrediction(stock: StockData, liveStock?: LiveStock) {
  const entryPrice = Number(stock.entry_price || stock.current_price) || 0;
  const currentPrice = Number(liveStock?.current_price || liveStock?.close || stock.current_price) || entryPrice;
  const rawHigh = Number(liveStock?.high_price || stock.high_price || currentPrice);
  const rawLow = Number(liveStock?.low_price || stock.low_price || currentPrice);
  
  // Guard against 52-week high/low leakage into daily high/low
  const highPrice = (rawHigh > currentPrice * 2.0 && currentPrice > 0) ? currentPrice : rawHigh;
  const lowPrice = (rawLow < currentPrice * 0.3 && currentPrice > 0) ? currentPrice : rawLow;

  let targetPrice = Number(stock.target_price) || 0;
  let stopLoss = Number(stock.stop_loss) || 0;

  // FRONTEND-026: كشف اتجاه الإشارة بالتسمية (SELL/STRONG_SELL/REDUCE/...) أو بالقيم.
  // ده بيمنع الـ BUY fallback من إنه يلغي قيم العقل الصحيحة للـ REDUCE.
  // العقل بيبعت القيم صح؛ الواجهة بس تتحقق وتعمل fallback direction-aware.
  const isSellSignal = detectIsSellSignal(stock.signal, targetPrice, stopLoss, entryPrice);

  if (entryPrice > 0) {
    if (isSellSignal) {
      // بيع: الهدف تحت الدخول، الوقف فوق الدخول
      if (targetPrice === 0 || targetPrice >= entryPrice) {
        targetPrice = Number((entryPrice * 0.90).toFixed(2));
      }
      if (stopLoss === 0 || stopLoss <= entryPrice) {
        stopLoss = Number((entryPrice * 1.08).toFixed(2));
      }
    } else {
      // شراء: الهدف فوق الدخول، الوقف تحت الدخول
      if (targetPrice === 0 || targetPrice <= entryPrice) {
        targetPrice = Number((entryPrice * 1.10).toFixed(2));
      }
      if (stopLoss === 0 || stopLoss >= entryPrice) {
        stopLoss = Number((entryPrice * 0.92).toFixed(2));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // P6-PREDICTIONS: الأولوية للقيم التاريخية المُتتبَعة
  // ═══════════════════════════════════════════════════════════════════
  // الـ daily_closer بيتبع أعلى/أقل سعر وصلهم السهم منذ التوقع ويحفظهم في
  // highest_price_reached / lowest_price_reached. دول القيم التاريخية الصح،
  // مش أسعار اليوم. بنستخدمهم كـ PRIMARY source لتحديد الحالة، ولو مش
  // متوفرين بنرجع لـ highPrice/lowPrice اللحظية.
  // ==================================================================
  const histMaxHigh = Number(stock.max_high_since_pred);
  const histMinLow = Number(stock.min_low_since_pred);
  const hasHistMax = Number.isFinite(histMaxHigh) && histMaxHigh > 0;
  const hasHistMin = Number.isFinite(histMinLow) && histMinLow > 0;

  // maxHigh: تاريخي → لحظي → currentPrice
  const maxHigh = hasHistMax
    ? histMaxHigh
    : Math.max(highPrice || currentPrice, currentPrice);
  // minLow: تاريخي → لحظي → currentPrice
  const minLow = hasHistMin
    ? histMinLow
    : Math.min(lowPrice > 0 ? lowPrice : currentPrice, currentPrice);

  const maxHighUsed = hasHistMax;
  const minLowUsed = hasHistMin;

  const hitTargetFlag = Boolean(stock.hit_target === 1 || stock.hit_target === true || stock.hit_target === '1' || stock.hit_target === 'true');
  const hitStopFlag = Boolean(stock.hit_stop === 1 || stock.hit_stop === true || stock.hit_stop_loss === 1 || stock.hit_stop_loss === true || stock.hit_stop_loss === '1');
  const statusStr = String(stock.status || '').toUpperCase();

  // ─── P6-PREDICTIONS: منطق الـ status حسب القيم التاريخية (PRIMARY) ───
  // شراء: TARGET_HIT لو maxHigh >= target؛ STOPPED لو minLow <= stop
  // بيع:  TARGET_HIT لو minLow <= target؛ STOPPED لو maxHigh >= stop
  // لو القيم التاريخية متوفرة، نعتمد عليهم لوحدهم (مش بنمزج مع currentPrice).
  // لو مش متوفرة، نرجّع للـ live (currentPrice + high/low اليوم).
  // ----------------------------------------------------------------
  let isHit = false;
  let isStopped = false;

  if (isSellSignal) {
    if (hasHistMin && hasHistMax) {
      // القيم التاريخية متوفرة → نعتمد عليهم
      isHit = entryPrice > 0 && targetPrice > 0 && histMinLow <= targetPrice;
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && histMaxHigh >= stopLoss;
    } else if (hasHistMin) {
      // عندي min تاريخي بس → استخدمه للـ target، و highPrice للـ stop
      isHit = entryPrice > 0 && targetPrice > 0 && histMinLow <= targetPrice;
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && (currentPrice >= stopLoss || highPrice >= stopLoss);
    } else if (hasHistMax) {
      // عندي max تاريخي بس → استخدمه للـ stop، و lowPrice للـ target
      isHit = entryPrice > 0 && targetPrice > 0 && (currentPrice <= targetPrice || lowPrice <= targetPrice);
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && histMaxHigh >= stopLoss;
    } else {
      // مفيش قيم تاريخية → fallback كامل للـ live (المنطق القديم)
      isHit = entryPrice > 0 && targetPrice > 0 && (currentPrice <= targetPrice || lowPrice <= targetPrice);
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && (currentPrice >= stopLoss || highPrice >= stopLoss);
    }
  } else {
    if (hasHistMax && hasHistMin) {
      isHit = entryPrice > 0 && targetPrice > 0 && histMaxHigh >= targetPrice;
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && histMinLow <= stopLoss;
    } else if (hasHistMax) {
      isHit = entryPrice > 0 && targetPrice > 0 && histMaxHigh >= targetPrice;
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && (currentPrice <= stopLoss || lowPrice <= stopLoss);
    } else if (hasHistMin) {
      isHit = entryPrice > 0 && targetPrice > 0 && (currentPrice >= targetPrice || highPrice >= targetPrice);
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && histMinLow <= stopLoss;
    } else {
      isHit = entryPrice > 0 && targetPrice > 0 && (currentPrice >= targetPrice || highPrice >= targetPrice);
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && (currentPrice <= stopLoss || lowPrice <= stopLoss);
    }
  }

  // دعم التحديد اليدوي الصريح فقط لو السعر كسر بالفعل أو تم التثبيت
  if (!isHit && !isStopped && (statusStr === 'TARGET_HIT' || statusStr === 'CLOSED_PROFIT' || hitTargetFlag)) {
    if (isSellSignal ? (currentPrice <= targetPrice || minLow <= targetPrice || lowPrice <= targetPrice) : (currentPrice >= targetPrice || maxHigh >= targetPrice || highPrice >= targetPrice)) {
      isHit = true;
    }
  }
  if (!isHit && !isStopped && (statusStr === 'STOPPED' || statusStr === 'CLOSED_LOSS' || hitStopFlag)) {
    // نتحقق من كسر الوقف فعلياً لمنع الأخطاء في عرض الصفقات المستمرة
    if (isSellSignal ? (currentPrice >= stopLoss || maxHigh >= stopLoss || highPrice >= stopLoss) : (currentPrice <= stopLoss || minLow <= stopLoss || lowPrice <= stopLoss)) {
      isStopped = true;
    }
  }

  const isActive = !isHit && !isStopped;

  // targetPctNum / stopPctNum حسب الاتجاه (موجب = مكسب متوقع)
  let targetPctNum = 0;
  if (entryPrice > 0 && targetPrice > 0) {
    targetPctNum = isSellSignal
      ? ((entryPrice - targetPrice) / entryPrice) * 100   // بيع: موجب لما target تحت
      : ((targetPrice - entryPrice) / entryPrice) * 100;  // شراء: موجب لما target فوق
  }

  let stopPctNum = 0;
  if (entryPrice > 0 && stopLoss > 0) {
    // وقف الخسارة = خسارة محتملة (سالب دايماً)
    stopPctNum = -Math.abs(((stopLoss - entryPrice) / entryPrice) * 100);
  }

  // livePnl حسب الاتجاه الفعلي (موجب = مكسب فعلي)
  let livePnl = 0;
  if (entryPrice > 0) {
    livePnl = isSellSignal
      ? ((entryPrice - currentPrice) / entryPrice) * 100   // بيع: موجب لما السعر ينزل
      : ((currentPrice - entryPrice) / entryPrice) * 100;  // شراء: موجب لما السعر يطلع
  } else if (stock.profit_loss_percent !== undefined && stock.profit_loss_percent !== null) {
    livePnl = Number(stock.profit_loss_percent);
  }

  // ─── P6-PREDICTIONS: حساب الـ PnL النهائي ──────────────────────────
  // - TARGET_HIT → استخدم target price (مكسب الهدف الكامل)
  // - STOPPED → استخدم stop loss (خسارة الوقف)
  // - ACTIVE → اعرض الـ livePnl الحالي + best potential كـ secondary
  // ----------------------------------------------------------------
  let pnl = livePnl;
  if (isHit) {
    pnl = targetPctNum > 0 ? targetPctNum : livePnl;
  } else if (isStopped) {
    pnl = stopPctNum < 0 ? stopPctNum : livePnl;
  } else {
    // صفقة نشطة — PnL الحقيقي المباشر (يمكن أن يكون 0.00% أو موجب/سالب)
    pnl = Number(livePnl.toFixed(2));
  }

  // "best potential" = أعلى مكسب ممكن كان يتحقق لو بِعنا في القمة (للصفقات النشطة)
  let bestPotentialPnl: number | null = null;
  if (isActive && entryPrice > 0) {
    bestPotentialPnl = isSellSignal
      ? Number((((entryPrice - minLow) / entryPrice) * 100).toFixed(2))
      : Number((((maxHigh - entryPrice) / entryPrice) * 100).toFixed(2));
  }

  const targetPct = targetPctNum > 0 ? targetPctNum.toFixed(1) : '10.0';
  const isTrader = isTraderPrediction(stock);

  // ─── P6-PREDICTIONS: الحالة + الترجمة العربية ─────────────────────
  const status: LifecycleStatus = isHit ? 'TARGET_HIT' : isStopped ? 'STOPPED' : 'PENDING';
  const statusAr: string = status === 'TARGET_HIT'
    ? '✅ تم تحقيق الهدف'
    : status === 'STOPPED'
    ? '❌ ضرب وقف الخسارة'
    : '⏳ جاري التنفيذ';

  // pnlValue (القيمة النقدية التقريبية لكل سهم واحد)
  const pnlValue = entryPrice > 0 ? (pnl / 100) * entryPrice : 0;

  return {
    isHit,
    isStopped,
    isActive,
    pnl,
    pnlValue,
    currentPrice,
    entryPrice,
    targetPrice,
    stopLoss,
    targetPct,
    isTrader,
    isSellSignal,
    // P6-PREDICTIONS: القيم الجديدة
    maxHigh,
    minLow,
    maxHighUsed,
    minLowUsed,
    bestPotentialPnl,
    status,
    statusAr,
  };
}

// ============================================================================
// NameMap / persona mixing helpers
// ============================================================================
export async function buildNameMap(marketCode: string): Promise<NameMap> {
  const map: NameMap = {};
  try {
    const res = await fetch(`/api/stocks?market=${marketCode}&limit=600`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const list: Array<{ ticker?: string; symbol?: string; name?: string; name_ar?: string; logo_url?: string | null }> = data.stocks || [];
      for (const s of list) {
        const tk = String(s.ticker || s.symbol || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
        if (!tk) continue;
        map[tk] = { name: s.name, name_ar: s.name_ar || s.name, logo_url: s.logo_url || null };
      }
    }
  } catch { // silent fallback (safe-by-design)
    /* تجاهل — نعتمد على الاسم من نتيجة التصطاد مباشرة */
  }
  return map;
}

export function enrichItems(items: StoredAnalysisItem[], nameMap: NameMap): StoredAnalysisItem[] {
  return items.map((it) => {
    const tk = it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
    const mapped = nameMap[tk];
    // لو الاسم والـ logo موجودين على it، نكمل منهم — بس نستخدم mapped كـ fallback
    const name = it.name || mapped?.name;
    const nameAr = it.nameAr || mapped?.name_ar || mapped?.name;
    const logoUrl = it.logoUrl || mapped?.logo_url || null;
    return {
      ...it,
      name,
      nameAr,
      logoUrl,
    };
  });
}

/**
 * يختار أفضل الأسهم لبرسونا معين: يخلط أعلى BUY مع أعلى SELL
 * (عشان المضارب يشوف بيع وشراء حقيقي، مش نوع واحد بس).
 * BUY ترتيبه التنازلي بالـ score، SELL ترتيبه التنازلي بالـ score،
 * وياخد نصيب كل منهم من الـ limit.
 */
export function pickPersonaMix(items: StoredAnalysisItem[], persona: 'conservative' | 'balanced' | 'gambler', limit = 5): StoredAnalysisItem[] {
  // P26: balanced = عرض عام بدون فلتر persona-specific، مرتّب بالـ maestroScore.
  if (persona === 'balanced') {
    const actionableBalanced = ['institutional_buy', 'strong_buy', 'buy', 'swing_buy', 't1_buy', 'accumulate', 'strong_sell', 'sell', 'hold', 'wait', 'reduce'];
    return items
      .filter((it) => actionableBalanced.includes((it.recommendation || '').toLowerCase()))
      .sort((a, b) => (b.maestroScore || 0) - (a.maestroScore || 0))
      .slice(0, limit);
  }
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  // RELAX-INVESTOR-001: أضفنا 'accumulate' للـ actionable list عشان تبويب
  // المستثمر يعرض أسهم ACCUMULATE (تجميع) مش بس BUY/SELL/HOLD.
  const actionable = ['institutional_buy', 'strong_buy', 'buy', 'swing_buy', 't1_buy', 'accumulate', 'strong_sell', 'sell', 'hold', 'wait', 'reduce'];
  const valid = items.filter(
    (it) =>
      it.analysisJson && it.analysisJson[_personaKey] &&
      (it.analysisJson[_personaKey]?.verdict || it.analysisJson[_personaKey]?.score !== undefined) &&
      actionable.includes((it.recommendation || '').toLowerCase()),
  );
  const byScore = (a: StoredAnalysisItem, b: StoredAnalysisItem) =>
    (b.analysisJson?.[_personaKey]?.score ?? 0) - (a.analysisJson?.[_personaKey]?.score ?? 0);

  // RELAX-INVESTOR-001: أضفنا ACCUMULATE لقائمة الشراء عشان تتعامل كفرصة.
  const buys = valid
    .filter((it) => ['BUY', 'STRONG_BUY', 'ACCUMULATE', 'INSTITUTIONAL_BUY'].includes(String(it.analysisJson?.[_personaKey]?.signal).toUpperCase()))
    .sort(byScore);
  const sells = valid
    .filter((it) => ['SELL', 'STRONG_SELL', 'REDUCE', 'INSTITUTIONAL_SELL'].includes(String(it.analysisJson?.[_personaKey]?.signal).toUpperCase()))
    .sort(byScore);
  const others = valid
    .filter((it) => !['BUY', 'STRONG_BUY', 'ACCUMULATE', 'INSTITUTIONAL_BUY', 'SELL', 'STRONG_SELL', 'REDUCE', 'INSTITUTIONAL_SELL'].includes(String(it.analysisJson?.[_personaKey]?.signal).toUpperCase()))
    .sort(byScore);

  const buyN = Math.min(Math.ceil(limit / 2), buys.length);
  const sellN = Math.min(limit - buyN, sells.length);
  const result = [...buys.slice(0, buyN), ...sells.slice(0, sellN)];
  // لو فيه مساحة (مفيش بيع/شراء كفاية) نكمل من others
  let idx = result.length;
  while (result.length < limit && idx < others.length) {
    result.push(others[idx]);
    idx++;
  }
  return result;
}

// P16-PERSONA-DIVERGENCE: اختيار الأسهم بناءً على فلاتر البرسونا المستقلة.
// - المضارب: يفضّل الـ items اللي fundamentals.is_gambler_opportunity=1،
//   مرتبة بـ gambler_rank_score DESC.
// - المستثمر: يفضّل الـ items اللي fundamentals.is_investor_opportunity=1،
//   مرتبة بـ investor_rank_score DESC.
// لو مفيش enough diverged items → fallback لـ pickPersonaMix (السلوك القديم).
// RELAX-INVESTOR-001: لو مفيش enough diverged items، بنضمّ items اللي إشاراتها
// BUY/ACCUMULATE حتى لو ممعندهاش الـ flag، عشان تبويب المستثمر ميفضلش فاضي.

export function pickPersonaDiverged(items: StoredAnalysisItem[], persona: 'conservative' | 'balanced' | 'gambler', limit = 5): StoredAnalysisItem[] {
  // P26: balanced = عرض عام بدون فلتر persona-specific، مرتّب بالـ maestroScore.
  if (persona === 'balanced') {
    const actionableBalanced = ['institutional_buy', 'strong_buy', 'buy', 'swing_buy', 't1_buy', 'accumulate', 'strong_sell', 'sell', 'hold', 'wait', 'reduce'];
    return items
      .filter((it) => actionableBalanced.includes((it.recommendation || '').toLowerCase()))
      .sort((a, b) => (b.maestroScore || 0) - (a.maestroScore || 0))
      .slice(0, limit);
  }
  const flagKey = persona === 'gambler' ? 'is_gambler_opportunity' : 'is_investor_opportunity';
  const rankKey = persona === 'gambler' ? 'gambler_rank_score' : 'investor_rank_score';
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';

  // فقط الـ items اللي عندها fundamentals معرّفة وبتطابق persona flag
  const diverged = items.filter((it) => {
    const f = it?.fundamentals;
    return f && (f[flagKey] === true || f[flagKey] === 1);
  });

  // مرّتبة بـ rank score تنازلياً
  const sorted = diverged.sort((a, b) => {
    const ra = (a?.fundamentals?.[rankKey] as number) || 0;
    const rb = (b?.fundamentals?.[rankKey] as number) || 0;
    return rb - ra;
  });

  if (sorted.length >= Math.min(limit, 3)) {
    return sorted.slice(0, limit);
  }

  // RELAX-INVESTOR-001: لو الـ diverged items مش كفاية، نضمّ items اللي إشاراتها
  // BUY/ACCUMULATE (للمستثمر) حتى لو ممعندهاش الـ is_investor_opportunity flag.
  // ده بيضمن إن تبويب المستثمر دايماً فيه محتوى، حتى لو الفلتر الصارم رفض الكل.
  const byPersonaScore = (a: StoredAnalysisItem, b: StoredAnalysisItem) =>
    (b.analysisJson?.[_personaKey]?.score ?? 0) - (a.analysisJson?.[_personaKey]?.score ?? 0);
  const signalTier = items
    .filter((it) => {
      const sig = String(it?.analysisJson?.[_personaKey]?.signal || '').toUpperCase();
      return sig === 'BUY' || sig === 'STRONG_BUY' || sig === 'ACCUMULATE' || sig === 'INSTITUTIONAL_BUY';
    })
    .sort(byPersonaScore);

  // ادمج diverged + signalTier بدون تكرار
  const seen = new Set(sorted.map((s) => s.ticker));
  const merged = [...sorted];
  for (const it of signalTier) {
    if (merged.length >= limit) break;
    if (!seen.has(it.ticker)) {
      merged.push(it);
      seen.add(it.ticker);
    }
  }

  if (merged.length >= Math.min(limit, 3)) {
    return merged.slice(0, limit);
  }

  // fallback أخير: لو لسه مش كفاية → كمّل بـ pickPersonaMix
  const fallback = pickPersonaMix(items, persona, limit);
  for (const it of fallback) {
    if (merged.length >= limit) break;
    if (!seen.has(it.ticker)) {
      merged.push(it);
      seen.add(it.ticker);
    }
  }
  return merged.slice(0, limit);
}


// ============================================================================
// Verdict / score colors
// ============================================================================
export function getVerdictColor(verdict: string | undefined): { bg: string; text: string; border: string } {
  const v = (verdict || '').toLowerCase();
  if (v.includes('فرصة') || v.includes('ادخل') || v.includes('قوي') || v.includes('شراء')) {
    return { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-900' };
  }
  // DYNAMIC-SYSTEM-001: تجميع (ACCUMULATE) — لون teal مميز
  if (v.includes('تجميع')) {
    return { bg: 'bg-teal-50 dark:bg-teal-950/40', text: 'text-teal-700 dark:text-teal-400', border: 'border-teal-200 dark:border-teal-900' };
  }
  if (v.includes('انتظر')) {
    return { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-900' };
  }
  if (v.includes('ابعد') || v.includes('بيع') || v.includes('تجنب') || v.includes('اخرج')) {
    return { bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-900' };
  }
  return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' };
}

/** Score bar color */
export function getScoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}


// ============================================================================
// Persona constants
// ============================================================================
export const PERSONA_DISPLAY_LIMIT = 10;
export const PERSONA_PAGE_SIZE = 5;

// ============================================================================
// Crypto formatters
// ============================================================================
export const usdCurrencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export const arDateTimeFmt = new Intl.DateTimeFormat('ar-EG', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function cryptoSignalStyle(signal: string): {
  badge: string;
  text: string;
  bg: string;
} {
  const s = (signal || '').toUpperCase();
  if (s === 'BUY' || s === 'STRONG_BUY' || s === 'LONG') {
    return {
      badge: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
      text: 'text-emerald-600',
      bg: 'bg-emerald-500/5',
    };
  }
  if (s === 'SELL' || s === 'STRONG_SELL' || s === 'SHORT') {
    return {
      badge: 'bg-rose-500/15 text-rose-600 border-rose-500/30',
      text: 'text-rose-600',
      bg: 'bg-rose-500/5',
    };
  }
  return {
    badge: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    text: 'text-amber-600',
    bg: 'bg-amber-500/5',
  };
}

export function cryptoSignalLabelAr(signal: string): string {
  const s = (signal || '').toUpperCase();
  if (s === 'BUY' || s === 'STRONG_BUY') return 'شراء';
  if (s === 'SELL' || s === 'STRONG_SELL') return 'بيع';
  if (s === 'LONG') return 'صفقة شراء';
  if (s === 'SHORT') return 'صفقة بيع';
  if (s === 'WAIT') return 'انتظار';
  return 'تجمّد';
}

export function cryptoSymbolMeta(symbol: string): { icon: string; name: string } {
  const s = (symbol || '').toUpperCase();
  if (s === 'BTC') return { icon: '₿', name: 'Bitcoin' };
  if (s === 'ETH') return { icon: 'Ξ', name: 'Ethereum' };
  return { icon: '●', name: symbol };
}

// ============================================================================
// Sector tracking helpers
// ============================================================================
export const HEAT_LEVEL_STYLE: Record<string, { bg: string; text: string; icon: string; label: string }> = {
  HOT:     { bg: 'bg-red-500/10 border-red-500/30',      text: 'text-red-700 dark:text-red-300',       icon: '🔥', label: 'نار' },
  WARM:    { bg: 'bg-orange-500/10 border-orange-500/30', text: 'text-orange-700 dark:text-orange-300', icon: '☀️', label: 'دافئ' },
  NEUTRAL: { bg: 'bg-slate-500/10 border-slate-500/30',  text: 'text-slate-700 dark:text-slate-300',   icon: '➖', label: 'محايد' },
  COOL:    { bg: 'bg-sky-500/10 border-sky-500/30',      text: 'text-sky-700 dark:text-sky-300',       icon: '💧', label: 'بارد' },
  COLD:    { bg: 'bg-teal-500/10 border-teal-500/30',    text: 'text-teal-700 dark:text-teal-300',     icon: '❄️', label: 'بارد جداً' },
};


export function formatVolumeShort(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}


export function formatEGPShort(v: number): string {
  if (!v || v <= 0) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)} مليار`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} مليون`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)} ألف`;
  return v.toLocaleString('en-US');
}

// خلفية خفيفة على عمود "متوسط التغير" (heatmap تذكري بسيط)

export function avgChangeHeatClass(avgChange: number): string {
  if (avgChange >= 2) return 'bg-emerald-100 dark:bg-emerald-950/50';
  if (avgChange > 0.5) return 'bg-emerald-50 dark:bg-emerald-950/30';
  if (avgChange <= -2) return 'bg-rose-100 dark:bg-rose-950/50';
  if (avgChange < -0.5) return 'bg-rose-50 dark:bg-rose-950/30';
  return 'bg-muted/40';
}

// خلفية خفيفة على عمود "التغير %" في جدول الأسهم (نفس منطق heatmap)

export function stockChangeHeatClass(chg: number): string {
  if (chg >= 5) return 'bg-emerald-100 dark:bg-emerald-950/50';
  if (chg > 0) return 'bg-emerald-50 dark:bg-emerald-950/30';
  if (chg <= -5) return 'bg-rose-100 dark:bg-rose-950/50';
  if (chg < 0) return 'bg-rose-50 dark:bg-rose-950/30';
  return 'bg-transparent';
}


// ============================================================================
// EGX intraday check
// ============================================================================
export function _isEgxIntradayNow(): boolean {
  try {
    const now = new Date();
    // Cairo time = UTC+2 (winter) / UTC+3 (summer DST, months 4-10)
    const isDst = 4 <= now.getUTCMonth() + 1 && now.getUTCMonth() + 1 <= 10;
    const cairoOffset = isDst ? 3 : 2;
    const cairoHour = (now.getUTCHours() + cairoOffset + 24) % 24;
    const cairoMinute = now.getUTCMinutes();
    const cairoDay = now.getUTCDay(); // 0=Sun, 6=Sat
    // EGX closed on Friday (5) and Saturday (6)
    if (cairoDay === 5 || cairoDay === 6) return false;
    const minutes = cairoHour * 60 + cairoMinute;
    return minutes >= 600 && minutes < 870; // 10:00 (600) → 14:30 (870)
  } catch { // silent fallback (safe-by-design)
    return false;
  }
}
