import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Convert any value to a safe number. Returns 0 for undefined/null/NaN. */
export function safeNum(value: unknown, fallback: number = 0): number {
  const num = Number(value);
  return !isNaN(num) && isFinite(num) ? num : fallback;
}

/** Safely call toFixed on any value. Returns fallback string for undefined/null/NaN. */
export function safeToFixed(value: unknown, digits: number = 2, fallback: string = '—'): string {
  const num = Number(value);
  return !isNaN(num) && isFinite(num) ? num.toFixed(digits) : fallback;
}

// ============================================================================
// R/R Visual Indicator (نظام مؤشر المخاطرة/العائد المرئي)
// ============================================================================

export type RRVerdict = {
  level: 'excellent' | 'good' | 'acceptable' | 'weak' | 'forbidden';
  label_ar: string;
  emoji: string;
  color: 'green' | 'yellow' | 'red';
  textClass: string;
  badgeClass: string;
};

/**
 * تقييم R:R المرئي لعرضه بألوان في كل توقع:
 *   >= 3   : ممتازة ✅
 *   2-3    : جيدة ✅
 *   1.5-2  : مقبولة ⚠️
 *   1-1.5  : ضعيفة ⚠️
 *   < 1    : ممنوعة ❌
 */
export function getRRVerdict(rr: number | null | undefined): RRVerdict {
  const v = safeNum(rr, 0);
  if (v >= 3)
    return { level: 'excellent', label_ar: 'ممتازة', emoji: '✅', color: 'green',
      textClass: 'text-green-600 dark:text-green-400', badgeClass: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800' };
  if (v >= 2)
    return { level: 'good', label_ar: 'جيدة', emoji: '✅', color: 'green',
      textClass: 'text-green-500 dark:text-green-500', badgeClass: 'bg-green-50 text-green-600 border-green-200 dark:bg-green-950/40 dark:text-green-500 dark:border-green-800' };
  if (v >= 1.5)
    return { level: 'acceptable', label_ar: 'مقبولة', emoji: '⚠️', color: 'yellow',
      textClass: 'text-yellow-600 dark:text-yellow-400', badgeClass: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-400 dark:border-yellow-800' };
  if (v >= 1)
    return { level: 'weak', label_ar: 'ضعيفة', emoji: '⚠️', color: 'yellow',
      textClass: 'text-yellow-600 dark:text-yellow-400', badgeClass: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-400 dark:border-yellow-800' };
  return { level: 'forbidden', label_ar: 'ممنوعة', emoji: '❌', color: 'red',
    textClass: 'text-red-600 dark:text-red-400', badgeClass: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800' };
}

// ============================================================================
// Stock Risk Alert (لوحة الحماية داخل التحليلات)
// ============================================================================
// بيربط منطق "الخروج الإجباري" و"التصحيح/الانهيار" و"فخ الشراء" بنفس
// عتبات الباك-إند (enforce_stop_loss = -8%, evaluate_buy_safety RSI<30).

export type StockRiskAlert = {
  level: 'crash' | 'correction' | 'rsi_trap' | 'safe';
  emoji: string;
  title_ar: string;
  detail_ar: string;
  badgeClass: string;
  textClass: string;
};

export function getStockRiskAlert(
  perf1w?: number | null,
  perf1m?: number | null,
  rsi?: number | null,
  riskReward?: number | null
): StockRiskAlert {
  const w = safeNum(perf1w);
  const m = safeNum(perf1m);
  const r = safeNum(rsi);
  const rr = safeNum(riskReward);

  // 1) انهيار / نزول حاد → اخرج فوراً (نفس حد الإيقاف -8%)
  if (w <= -8 || m <= -15) {
    return {
      level: 'crash',
      emoji: '🚨',
      title_ar: 'انهيار / نزول حاد — اخرج فوراً',
      detail_ar: 'السهم كسر حد الإيقاف (-8%). لا تستنى التعافي — اخرج الآن.',
      badgeClass: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/70 dark:text-red-300',
      textClass: 'text-red-600 dark:text-red-400',
    };
  }

  // 2) تصحيح حاد → راقب الوقف (لا تشتري النزول الأعمى)
  if (w <= -5) {
    return {
      level: 'correction',
      emoji: '⚠️',
      title_ar: 'تصحيح حاد',
      detail_ar: 'السهم بيتصحح. ثبّت الوقف ولا تشتري النزول من غير تأكيد.',
      badgeClass: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400',
      textClass: 'text-orange-600 dark:text-orange-400',
    };
  }

  // 3) فخ الشراء — RSI منخفض من غير تأكيد (Anti-Falling-Knife)
  if (r < 30) {
    return {
      level: 'rsi_trap',
      emoji: '⚠️',
      title_ar: 'فخ الشراء (RSI منخفض)',
      detail_ar: 'RSI < 30 مش سبب كافي للشراء — محتاج تأكيد حجم أو شمعة انعكاس.',
      badgeClass: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-400',
      textClass: 'text-yellow-600 dark:text-yellow-400',
    };
  }

  // 4) آمن — مفيش تصحيح حاد ولا فخ شراء
  void rr; // R:R بيُعرض separately في نفس اللوحة
  return {
    level: 'safe',
    emoji: '✅',
    title_ar: 'وضع آمن',
    detail_ar: 'السهم مش في تصحيح حاد ولا فخ شراء حالياً.',
    badgeClass: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400',
    textClass: 'text-green-600 dark:text-green-400',
  };
}

// ============================================================================
// Shared Calculation Helpers — centralized across all tabs
// ============================================================================

export type VerdictStyle = { color: string; bg: string };

export function verdictStyle(verdict: string | undefined): VerdictStyle {
  const v = (verdict || '').toLowerCase();
  if (v.includes('فرصة') || v.includes('ادخل') || v.includes('قوي') || v.includes('شراء')) {
    return { color: '#16a34a', bg: '#dcfce7' };
  }
  if (v.includes('انتظر')) {
    return { color: '#d97706', bg: '#fef3c7' };
  }
  if (v.includes('ابعد') || v.includes('بيع') || v.includes('تجنب') || v.includes('اخرج')) {
    return { color: '#dc2626', bg: '#fee2e2' };
  }
  return { color: '#78716c', bg: '#f5f5f4' };
}

// RULE28-NO-DUPLICATION (2026-10-12 - MAESTRO-GHOST-HUNT):
// computeRR() was a DUPLICATE of src/lib/risk-reward.ts::computeRiskReward().
// Per Rule 28, there must be ONE canonical implementation.
// This re-export keeps backward compat for the 7 callers that import from utils.ts,
// but delegates to the canonical risk-reward.ts implementation.
import { computeRiskReward as _computeRiskReward } from '@/lib/risk-reward';

export function computeRR(pd: Record<string, unknown>): number | null {
  // DIR-02 (2026-10-12 - GM directive / Rule 67 CALCULATION-CANONICAL):
  // CRITICAL FIX: the previous body called `_computeRiskReward(pd as any)` which
  // passes the WHOLE object as `entry` -> `Number({})` = NaN -> returns fallback 0
  // -> every pick showed "R/R = 0.00:1" to users (public credibility scandal).
  // The canonical signature is `computeRiskReward(entry, target, stop)` - three
  // separate numbers. We must extract them from `pd` before delegating.
  // Also: prefer stored `risk_reward` if valid (> 0) before re-computing, to honor
  // backend-computed values when available.

  // 1) Prefer backend-stored risk_reward if it's a valid positive number.
  const storedRR = Number(pd.risk_reward ?? pd.rr);
  if (Number.isFinite(storedRR) && storedRR > 0) {
    return Math.round(storedRR * 100) / 100;
  }
  // 2) Otherwise compute from the canonical formula (Rule 67).
  //    Extract the three separate numeric params from the object.
  const entry = Number(pd.entry);
  const target = Number(pd.target);
  const stop = Number(pd.stop);
  // computeRiskReward returns 0 on invalid inputs; we surface `null` instead
  // so the UI can render "---" rather than the misleading "0.00:1".
  const rr = _computeRiskReward(entry, target, stop, 0);
  if (!Number.isFinite(rr) || rr <= 0) return null;
  return rr;
}

export function rrColor(rr: number | null): string {
  if (rr == null) return 'text-muted-foreground';
  if (rr >= 1.5) return 'text-emerald-600 dark:text-emerald-400 font-bold';
  if (rr >= 1.0) return 'text-amber-600 dark:text-amber-400 font-bold';
  return 'text-rose-600 dark:text-rose-400 font-bold';
}

export function scoreColor(score: number | undefined): string {
  const s = Number(score ?? 0);
  if (s >= 70) return 'text-emerald-600 dark:text-emerald-400 font-bold';
  if (s >= 50) return 'text-amber-600 dark:text-amber-400 font-bold';
  return 'text-rose-600 dark:text-rose-400 font-bold';
}

export function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n === 0) return '—';
  return n.toFixed(2);
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toLocaleString();
}

export function getSignalColor(signal: string): string {
  switch (signal.toLowerCase()) {
    case 'strong_buy':
      return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800';
    case 'buy':
      return 'bg-green-50 text-green-600 border-green-200 dark:bg-green-950 dark:text-green-500 dark:border-green-800';
    case 'hold':
      return 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800';
    case 'sell':
      return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800';
    case 'strong_sell':
      return 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-700';
    default:
      return 'bg-muted text-muted-foreground border-muted';
  }
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 70) return 'text-green-600 dark:text-green-400';
  if (confidence >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

export function getConfidenceBg(confidence: number): string {
  if (confidence >= 70) return 'bg-green-500';
  if (confidence >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ============================================================================
// Python Backend API Helpers — إدارة الأموال والمحفظة
// ============================================================================
// الدوال دي بتستخدم الـ proxy الموجود /api/python/... للوصول للـ Python backend.

const PYTHON_API = '/api/python';

async function pythonFetch<T = unknown>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${PYTHON_API}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

// --- Trade Journal ---
export const tradeJournalApi = {
  open: (body: Record<string, unknown>) =>
    pythonFetch('/portfolio/journal/open', { method: 'POST', body: JSON.stringify(body) }),
  close: (body: Record<string, unknown>) =>
    pythonFetch('/portfolio/journal/close', { method: 'POST', body: JSON.stringify(body) }),
  reflect: (body: Record<string, unknown>) =>
    pythonFetch('/portfolio/journal/reflect', { method: 'POST', body: JSON.stringify(body) }),
  stats: (days = 30) =>
    pythonFetch(`/portfolio/journal/stats?days=${days}`),
  recent: (limit = 20) =>
    pythonFetch(`/portfolio/journal/recent?limit=${limit}`),
  openTrades: () =>
    pythonFetch('/portfolio/journal/open-trades'),
};

// --- Trade Recorder (صفقات فعلية) ---
export const tradeRecorderApi = {
  recordBuy: (body: Record<string, unknown>) =>
    pythonFetch('/portfolio/trades/record-buy', { method: 'POST', body: JSON.stringify(body) }),
  recordSell: (body: Record<string, unknown>) =>
    pythonFetch('/portfolio/trades/record-sell', { method: 'POST', body: JSON.stringify(body) }),
  list: (userId: string, limit = 50) =>
    pythonFetch(`/portfolio/trades/list?user_id=${userId}&limit=${limit}`),
  outcomes: (userId?: string, limit = 50) =>
    pythonFetch(`/portfolio/trades/outcomes?${userId ? `user_id=${userId}&` : ''}limit=${limit}`),
  performance: (userId?: string) =>
    pythonFetch(`/portfolio/trades/performance?${userId ? `user_id=${userId}` : ''}`),
  learn: (userId?: string) =>
    pythonFetch('/portfolio/trades/learn', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),
};

// --- Equity Curve ---
export const equityApi = {
  snapshot: (body: Record<string, unknown>) =>
    pythonFetch('/portfolio/equity/snapshot', { method: 'POST', body: JSON.stringify(body) }),
  curve: (userId: string, days = 90) =>
    pythonFetch(`/portfolio/equity/curve?user_id=${userId}&days=${days}`),
};

// --- Cash Transactions ---
export const cashApi = {
  record: (body: Record<string, unknown>) =>
    pythonFetch('/portfolio/cash/record', { method: 'POST', body: JSON.stringify(body) }),
  list: (userId: string) =>
    pythonFetch(`/portfolio/cash/transactions?user_id=${userId}`),
};

// --- P&L History ---
export const pnlApi = {
  record: (body: Record<string, unknown>) =>
    pythonFetch('/portfolio/pnl/record', { method: 'POST', body: JSON.stringify(body) }),
  history: (userId: string, days = 30) =>
    pythonFetch(`/portfolio/pnl/history?user_id=${userId}&days=${days}`),
};

// --- Hard Protection ---
export const protectionApi = {
  check: (body: Record<string, unknown>) =>
    pythonFetch('/portfolio/protection/check', { method: 'POST', body: JSON.stringify(body) }),
  state: (userId: string) =>
    pythonFetch(`/portfolio/protection/state?user_id=${userId}`),
  recordTrade: (body: Record<string, unknown>) =>
    pythonFetch('/portfolio/protection/record-trade', { method: 'POST', body: JSON.stringify(body) }),
  resetDaily: (userId: string) =>
    pythonFetch('/portfolio/protection/reset-daily', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),
};

// --- Portfolio Dashboard ---
export const portfolioDashboardApi = {
  dashboard: (portfolioId = 'default') =>
    pythonFetch(`/portfolio/dashboard?portfolio_id=${portfolioId}`),
  state: (portfolioId = 'default') =>
    pythonFetch(`/portfolio/state?portfolio_id=${portfolioId}`),
  holdings: (userId: string) =>
    pythonFetch(`/portfolio/holdings?user_id=${userId}`),
  smartMonitor: (userId: string) =>
    pythonFetch(`/portfolio/smart-monitor?user_id=${userId}`),
  smartSignals: (userId: string) =>
    pythonFetch(`/portfolio/smart-monitor/signals?user_id=${userId}`),
};
