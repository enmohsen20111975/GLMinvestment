/**
 * modules/market-analysis/lib/signals.ts
 * ============================================================================
 * P0-COMPONENT-UNIFICATION (Phase 0.5): Canonical signal color/label/icon map.
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 10+ أماكن بـ تعرّف نفس الـ signal→color map:
 *   - shared/PredictionCard.tsx:115 (SIGNAL_STYLES — canonical, full)
 *   - PredictionsTab.tsx:417 (sigColor: Record<string,string> — simple)
 *   - CanonicalWhoIsBuyingBanner.tsx:58 (SIGNAL_STYLES — has bg/text/border/icon)
 *   - UnifiedAnalysisView.tsx:68 (SIGNAL_COLORS — simple)
 *   - GateAnalysisView.tsx:19 (signalColors — simple)
 *   - EnginesStatusTab.tsx:97 (SIGNAL_COLORS — simple, different mapping)
 *   - eid-predictions-widget.tsx:52 (signalColors — simple)
 *   - V82DecisionPanel.tsx:57 (ACTION_COLORS — different naming)
 *   - StockAdvancedAnalysisView.tsx:118 (SIGNAL_CONFIG — different shape)
 *   - AIAnalysisWidget.tsx:79 (SIGNAL_CONFIG — different shape)
 *   - seasonality/SeasonalityDashboard.tsx (getSignalColor/getSignalArabic)
 *
 * كده هنا = single source of truth. كل الـ consumers لاقبل كده بـ تستورد من هنا.
 *
 * ملاحظة: الـ PredictionCard.tsx كان فيه bug مشهور (trailing spaces في
 * `'text-profit '`, `'border-profit '`, إلخ) — الصفحة دي بـ تستخدم نفس الـ classes
 * بس بـ تنضفها (مفيش trailing spaces). الـ PredictionCard نفسها هـ تـتـفكس لما
 * الـ SignalBadge component يتعمل في Phase 1 + يـستورد من هنا.
 * ============================================================================
 */

import {
  ArrowUpCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  type LucideIcon,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

/**
 * الأنواع الأساسية للإشارات. كل الـ signals اللي بيرجّعها الـ backend بـ
 * تـدخل في وحد من الـ 4 kinds دول:
 *   - 'strong_buy' → STRONG_BUY, STRONG BUY, ACCUMULATE
 *   - 'buy'        → BUY
 *   - 'hold'       → HOLD, WAIT
 *   - 'sell'       → SELL, STRONG_SELL, AVOID, REDUCE
 */
export type SignalKind = 'strong_buy' | 'buy' | 'hold' | 'sell';

/**
 * Style object لكل signal kind — كل الـ info اللي الـ SignalBadge محتاجها.
 * - bg: خلفية خفيفة شفافة (background)
 * - text: لون النص (foreground)
 * - border: لون الحدود
 * - icon: الأيقونة المناسبة
 * - defaultLabelAr: الترجمة العربية الافتراضية
 */
export interface SignalStyle {
  bg: string;
  text: string;
  border: string;
  icon: LucideIcon;
  defaultLabelAr: string;
}

// ============================================================
// Canonical SIGNAL_STYLES (full version)
// ============================================================

/**
 * الـ canonical signal styles map. لكل signal kind فيه:
 * - bg (background — شفاف بـ opacity /10)
 * - text (foreground color)
 * - border (border color)
 * - icon (lucide-react icon component — NOT instance, but the type)
 * - defaultLabelAr (Arabic label)
 *
 * @example
 * const style = SIGNAL_STYLES[detectSignalKind('STRONG_BUY')];
 * // → { bg: 'bg-profit/10', text: 'text-profit', ... }
 *
 * const Icon = style.icon;
 * <Icon className="h-3.5 w-3.5" />
 */
export const SIGNAL_STYLES: Record<SignalKind, SignalStyle> = {
  strong_buy: {
    bg: 'bg-profit/10',
    text: 'text-profit',
    border: 'border-profit',
    icon: ArrowUpCircle,
    defaultLabelAr: 'شراء قوي',
  },
  buy: {
    bg: 'bg-profit/10',
    text: 'text-success',
    border: 'border-success dark:border-success',
    icon: TrendingUp,
    defaultLabelAr: 'شراء',
  },
  hold: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning',
    icon: Minus,
    defaultLabelAr: 'احتفاظ',
  },
  sell: {
    bg: 'bg-loss/10',
    text: 'text-loss',
    border: 'border-loss',
    icon: TrendingDown,
    defaultLabelAr: 'بيع / تجنب',
  },
};

// ============================================================
// Helpers
// ============================================================

/**
 * بياخد raw signal string (من الـ backend زي 'STRONG_BUY' أو 'BUY' أو 'REDUCE')
 * و بيرجّعه لأحد الـ 4 signal kinds الموحّدة.
 *
 * @example
 * detectSignalKind('STRONG_BUY')  // → 'strong_buy'
 * detectSignalKind('buy')         // → 'buy'
 * detectSignalKind('WAIT')        // → 'hold'
 * detectSignalKind('REDUCE')       // → 'sell'
 * detectSignalKind('')            // → 'hold' (default آمن)
 */
export function detectSignalKind(signal: string | null | undefined): SignalKind {
  const s = (signal || '').toUpperCase().trim();
  if (s === 'STRONG_BUY' || s === 'STRONG BUY' || s === 'ACCUMULATE') return 'strong_buy';
  if (s === 'BUY') return 'buy';
  if (s === 'HOLD' || s === 'WAIT') return 'hold';
  // SELL / STRONG_SELL / AVOID / REDUCE → treat as sell
  return 'sell';
}

/**
 * بيرجّع الـ Arabic label للإشارة. لو signalAr موجود (من الـ backend) بـ
 * يـرجّعه. لو لأ بـ يستخدم SIGNAL_STYLES[...].defaultLabelAr.
 *
 * @example
 * signalLabelAr('STRONG_BUY', 'شراء جريء')  // → 'شراء جريء' (from caller)
 * signalLabelAr('BUY')                       // → 'شراء' (from SIGNAL_STYLES)
 */
export function signalLabelAr(
  signal: string | null | undefined,
  signalAr?: string | null
): string {
  if (signalAr && typeof signalAr === 'string' && signalAr.trim().length > 0) {
    return signalAr;
  }
  const kind = detectSignalKind(signal);
  return SIGNAL_STYLES[kind].defaultLabelAr;
}

/**
 * بيرجّع الـ SignalStyle الكامل للإشارة.
 *
 * @example
 * const style = getSignalStyle('STRONG_BUY');
 * <span className={cn(style.bg, style.text, style.border)}>{style.defaultLabelAr}</span>
 */
export function getSignalStyle(signal: string | null | undefined): SignalStyle {
  return SIGNAL_STYLES[detectSignalKind(signal)];
}

// ============================================================
// Backward-compat simple map (for legacy code that just wants bg color)
// ============================================================

/**
 * خريطة بسيطة من signal → bg color class (للـ legacy code اللي بـ يستخدم
 * `<Badge className={sigColor[p.signal]}>`). Phase 2 codemod بـ يستبدل كل
 * الاستخدامات دي بـ <SignalBadge> component (Phase 1).
 *
 * @deprecated استخدم `getSignalStyle(signal).bg` بدل ده.
 *
 * @example
 * // ❌ legacy
 * const sigColor = { STRONG_BUY: 'bg-profit', BUY: 'bg-success', ... };
 * <Badge className={sigColor[p.signal] || 'bg-muted'}>...</Badge>
 *
 * // ✅ canonical (Phase 2)
 * import { getSignalStyle } from '@/modules/market-analysis/lib/signals';
 * <SignalBadge signal={p.signal} />  // (Phase 1 component)
 */
export const SIGNAL_COLOR_MAP: Record<string, string> = {
  STRONG_BUY: 'bg-profit',
  BUY: 'bg-success',
  ACCUMULATE: 'bg-whale',
  HOLD: 'bg-muted',
  WAIT: 'bg-muted',
  REDUCE: 'bg-warning',
  SELL: 'bg-loss',
  STRONG_SELL: 'bg-loss',
  AVOID: 'bg-loss',
};

/**
 * بيرجّع الـ bg color class للإشارة. للـ legacy code اللي بـ يستخدم
 * `sigColor[p.signal]`. Phase 2 codemod بـ يستبدله.
 *
 * @deprecated استخدم `getSignalStyle(signal).bg` بدل ده.
 */
export function signalColorClass(signal: string | null | undefined): string {
  if (!signal) return 'bg-muted';
  return SIGNAL_COLOR_MAP[String(signal).toUpperCase()] || 'bg-muted';
}
