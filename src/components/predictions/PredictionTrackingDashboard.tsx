'use client';

/**
 * PredictionTrackingDashboard (متابعة التوقعات وإثبات صحة الصفقات)
 * -----------------------------------------------------------------------------
 * لوحة تحكم تعتمد على بيانات حقيقية وموثقة من Python backend.
 * توفر إثباتات شفافة ومباشرة على صحة صفقات المنصة.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose,
} from '@/components/ui/dialog';
import {
  RefreshCw, Loader2, TrendingDown, TrendingUp, Trophy, Target, Shield,
  Flame, Scale, Clock, Wifi, WifiOff, Activity, Info, AlertTriangle,
  CalendarClock, Percent, Gauge, Search, X, Check, ArrowUpDown, Download,
  ExternalLink, Sparkles, Filter, CheckCircle2, XCircle, Clock3, Share2, Layers
} from 'lucide-react';
import { cn, fmtPrice } from '@/lib/utils';
import { toPng } from 'html-to-image';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK } from '@/lib/official-links';
import { ExportDropdown } from '@/components/screener/StockScreenerAdvanced';
import { BarChart, Bar, Cell as RechartsCell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

// ==================== Types ====================

type PersonaId = 'all' | 'gambler' | 'balanced' | 'conservative';
type OutcomeFilter = 'ALL' | 'WIN' | 'LOSS' | 'PENDING' | 'EXPIRED';
type DaysWindow = 1 | 2 | 7 | 14 | 30 | 60 | 90 | 180 | 365 | 999 | 0;

// HONEST-TRACKING-FIX: ناتج الـ endpoint /api/predictions/honest-tracking/list
// ده الـ endpoint اللي بيرجع بيانات تاريخية كاملة من SQLite مباشرةً بدون الحاجة لـ Python.
interface HonestPredictionItem {
  id: string;
  stock_symbol: string;
  stock_name_ar?: string;
  signal_type: string;
  market: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence?: number | null;
  maestro_score?: number | null;
  prediction_date: string;
  status: string;
  final_price?: number | null;
  profit_loss_percent?: number | null;
  actual_return?: number | null;
  hit_target?: boolean;
  hit_stop_loss?: boolean;
  holding_days?: number;
  evaluation_date?: string | null;
  persona?: string | null;
  created_at?: string;
  highest_price_reached?: number | null;
  lowest_price_reached?: number | null;
  exit_type?: string | null;
  target_price_2?: number | null;
  // V40.1: Evidence-based fields
  evidence_count?: number;
  morning_bell?: boolean;
  kill_filter_result?: string | null;
}

interface HonestListResponse {
  success: boolean;
  predictions: HonestPredictionItem[];
  pagination?: { total: number; limit: number; offset: number; has_more: boolean };
  source?: string;
}

interface LivePrediction {
  ticker: string;
  nameAr?: string;
  persona: 'gambler' | 'balanced' | 'conservative';
  signal?: string;
  entryDate?: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  currentPrice?: number;
  outcome: 'WIN' | 'LOSS' | 'EXPIRED' | 'PENDING';
  returnPct?: number | null;
  daysSinceEntry?: number | null;
  closedAt?: string | null;
  exitPrice?: number | null;
  maestroScore?: number;
  confidence?: number;
  reason?: string;
  // V40.1: Evidence-based fields
  evidence_count?: number;
  morning_bell?: boolean;
  kill_filter_result?: string | null;
  // RL-FIX-6: new fields from backend
  targetPrice2?: number;
  liveOutcome?: 'WIN' | 'LOSS' | 'PENDING';
  executionDate?: string | null;
  // FIX-5B: highest/lowest price reached + exit_type — لعرض أقصى ربح/خسارة + تمييز
  // TRAILING_PROFIT (💰 خرج بربح) عن WIN العادي.
  highestPriceReached?: number | null;
  lowestPriceReached?: number | null;
  highest_price_reached?: number | null;
  lowest_price_reached?: number | null;
  exit_type?: string | null;
  exitType?: string | null;
  target_price_2?: number | null;
}

interface PersonaStats {
  total: number;
  wins: number;
  losses: number;
  pending: number;
  settled: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  closedCount: number;
  expired?: number;
  // ما يهم العميل: الفلوس + الحماية
  netReturn: number;      // صافي الربح/الخسارة = sum(actual_return)
  grossProfit: number;     // إجمالي الأرباح = sum(positive returns)
  grossLoss: number;       // إجمالي الخسائر = sum(negative returns, سالب)
  maxLoss: number;         // أقصى خسارة في صفقة واحدة (سالب)
  rrRatio: number;         // متوسط الربح ÷ متوسط الخسارة
}

interface LiveTrackingResponse {
  success: boolean;
  predictions: Record<'gambler' | 'balanced' | 'conservative', LivePrediction[]>;
  stats: PersonaStats;
  statsByPersona: Record<'gambler' | 'balanced' | 'conservative', PersonaStats>;
  market_session: {
    is_open: boolean;
    server_time: string;
    next_refresh_seconds: number;
    session_name: string;
  };
  last_updated: string;
  source?: string;
  market?: string;
  daysWindow?: number;
  error?: string;
}

// ==================== Config & UI Theme ====================

const PERSONA_CONFIG: Record<'gambler' | 'balanced' | 'conservative', {
  id: 'gambler' | 'balanced' | 'conservative';
  emoji: string;
  nameAr: string;
  horizonAr: string;
  color: string;
  badgeBg: string;
  border: string;
  glow: string;
  icon: typeof Flame;
}> = {
  gambler: {
    id: 'gambler',
    emoji: '🔥',
    nameAr: 'المضارب',  // UNIFIED-BALANCED-ONLY: معطل
    horizonAr: 'صفقات خاطفة (1-5 أيام)',
    color: 'text-orange-500 dark:text-orange-400',
    badgeBg: 'bg-orange-500/10 text-orange-600 dark:text-orange-300 border-orange-500/20',
    border: 'border-orange-500/30 hover:border-orange-500/60',
    glow: 'shadow-orange-500/10',
    icon: Flame,
  },
  balanced: {
    id: 'balanced',
    emoji: '⚖️',
    nameAr: 'المتوازن',
    horizonAr: 'صفقات متوسطة (2-6 أسابيع)',
    color: 'text-teal-500 dark:text-teal-400',
    badgeBg: 'bg-teal-500/10 text-teal-600 dark:text-teal-300 border-teal-500/20',
    border: 'border-teal-500/30 hover:border-teal-500/60',
    glow: 'shadow-teal-500/10',
    icon: Scale,
  },
  conservative: {
    id: 'conservative',
    emoji: '🛡️',
    nameAr: 'المستثمر',
    horizonAr: 'صفقات استثمارية (6-12 شهر)',
    color: 'text-emerald-500 dark:text-emerald-400',
    badgeBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20',
    border: 'border-emerald-500/30 hover:border-emerald-500/60',
    glow: 'shadow-emerald-500/10',
    icon: Shield,
  },
};

const OUTCOME_CONFIG: Record<'WIN' | 'LOSS' | 'EXPIRED' | 'PENDING', {
  label: string;
  badge: string;
  icon: typeof Trophy;
  accentColor: string;
}> = {
  WIN: {
    label: 'هدف محقق 🎯',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    icon: Trophy,
    accentColor: 'text-emerald-500',
  },
  LOSS: {
    label: 'وقف خسارة 🛑',
    badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
    icon: TrendingDown,
    accentColor: 'text-rose-500',
  },
  EXPIRED: {
    label: 'منتهية ⏰',
    badge: 'bg-muted text-muted-foreground border-border',
    icon: Clock,
    accentColor: 'text-muted-foreground',
  },
  PENDING: {
    label: 'جاري التداول ⏳',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    icon: Clock3,
    accentColor: 'text-amber-500',
  },
};

// FIX-5B: TRAILING_PROFIT badge — "💰 خرج بربح" بـ لون زمردي مميز عن WIN العادي.
// ده بيـ trigger لما exit_type === 'trailing_profit' (السهم وصل لـ ربح جزئي ثم
// ارتد فـ exit قبل الهدف الكامل — جني أرباح). الـ outcome الرسمي بـ يفضل WIN
// لكن الـ badge بـ يـ differentiعلشان المالك يفرّق بين "هدف محقق" و"جني أرباح".
const TRAILING_PROFIT_CONFIG = {
  label: 'خرج بربح 💰',
  badge: 'bg-teal-500/20 text-teal-700 dark:text-teal-300 border-teal-500/40 font-bold',
  accentColor: 'text-teal-600 dark:text-teal-400',
};

// FIX-5B: helper — يحدد هل التوقع ده TRAILING_PROFIT (للـ status display).
// الـ data بتيجي من مسارين:
//   1. live-tracking (Python): exit_type field lowercase (e.g. 'trailing_profit').
//   2. honest-tracking/list (Node): exit_type field from DB (same lowercase).
function isTrailingProfit(p: LivePrediction): boolean {
  const et = (p.exit_type || p.exitType || '').toString().toLowerCase().trim();
  return et === 'trailing_profit';
}

// FIX-5B: helper — يحسب أقصى ربح % بناءً على direction (BUY vs SELL).
// للـ BUY: (highest - entry) / entry × 100
// للـ SELL: (entry - lowest) / entry × 100  (لأن الـ SELL ربحه في نزول السعر)
function computeMaxProfitPct(p: LivePrediction): number | null {
  const entry = Number(p.entryPrice || 0);
  if (!entry || entry <= 0) return null;
  const highest = Number(p.highestPriceReached ?? p.highest_price_reached ?? 0);
  const lowest = Number(p.lowestPriceReached ?? p.lowest_price_reached ?? 0);
  if (highest <= 0 && lowest <= 0) return null;
  const sigType = (p.signal || '').toString().toUpperCase();
  const isSell = sigType.includes('SELL');
  if (isSell) {
    // للـ SELL: الربح لما السعر ينزل → نستخدم lowest
    if (lowest <= 0) return null;
    return ((entry - lowest) / entry) * 100;
  }
  // للـ BUY: الربح لما السعر يطلع → نستخدم highest
  if (highest <= 0) return null;
  return ((highest - entry) / entry) * 100;
}

// FIX-5B: helper — يحسب أقصى خسارة % بناءً على direction (BUY vs SELL).
// للـ BUY: (lowest - entry) / entry × 100 (سالب)
// للـ SELL: (entry - highest) / entry × 100 (سالب لو highest > entry)
function computeMaxLossPct(p: LivePrediction): number | null {
  const entry = Number(p.entryPrice || 0);
  if (!entry || entry <= 0) return null;
  const highest = Number(p.highestPriceReached ?? p.highest_price_reached ?? 0);
  const lowest = Number(p.lowestPriceReached ?? p.lowest_price_reached ?? 0);
  if (highest <= 0 && lowest <= 0) return null;
  const sigType = (p.signal || '').toString().toUpperCase();
  const isSell = sigType.includes('SELL');
  if (isSell) {
    // للـ SELL: الخسارة لما السعر يطلع → نستخدم highest
    if (highest <= 0) return null;
    return ((entry - highest) / entry) * 100;  // سالب لو highest > entry
  }
  // للـ BUY: الخسارة لما السعر ينزل → نستخدم lowest
  if (lowest <= 0) return null;
  return ((lowest - entry) / entry) * 100;  // سالب لو lowest < entry
}

// FIX-5B: helper — يحسب _live_return للـ PENDING (معاينة غير رسمية).
// لو outcome_date === null و highest_price_reached > 0:
//   - احسب من current_price (إن وُجد) أو exitPrice أو last known price.
//   - direction-aware: BUY = (current - entry)/entry, SELL = (entry - current)/entry.
// الـ return بـ يكون percentage. بـ يـ return null لو مفيش سعر متاح.
function computeLiveReturnPct(p: LivePrediction): number | null {
  const entry = Number(p.entryPrice || 0);
  if (!entry || entry <= 0) return null;
  // لو مُقفلة رسمياً → الـ returnPct هو الرسمي، مش محتاجين نحسب live
  if (p.outcome !== 'PENDING') return null;
  const current = Number(p.currentPrice ?? p.exitPrice ?? 0);
  if (!current || current <= 0) return null;
  const sigType = (p.signal || '').toString().toUpperCase();
  const isSell = sigType.includes('SELL');
  if (isSell) {
    return ((entry - current) / entry) * 100;
  }
  return ((current - entry) / entry) * 100;
}

// RL-FIX-6: LIVE outcome preview badges — visually distinct from official OUTCOME_CONFIG
// (dashed border + "معاينة" tag) so users see live price-action state of pending trades.
const LIVE_OUTCOME_CONFIG: Record<'WIN' | 'LOSS' | 'PENDING', { label: string; badge: string }> = {
  WIN: {
    label: 'ربح متوقع (معاينة)',
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-dashed border-emerald-500/40',
  },
  LOSS: {
    label: 'خسارة متوقعة (معاينة)',
    badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-dashed border-rose-500/40',
  },
  PENDING: {
    label: 'بانتظار الهدف',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-dashed border-amber-500/40',
  },
};

const DAYS_OPTIONS: Array<{ value: DaysWindow; label: string }> = [
  { value: 1, label: 'اليوم' },
  { value: 2, label: 'أمس' },
  { value: 7, label: '7 أيام' },
  { value: 14, label: '14 يوم' },
  { value: 30, label: '30 يوم' },
  { value: 60, label: '60 يوم' },
  { value: 90, label: '0.25 سنة (90d)' },
  { value: 180, label: '0.5 سنة (6m)' },
  // RL-FIX-7: YTD — من أول السنة (1 يناير للسنة الحالية)
  { value: 999, label: 'من أول السنة (YTD)' },
  { value: 365, label: 'سنة كاملة (1y)' },
  { value: 0, label: 'كل الأوقات' },
];

// RL-FIX-13: Quality filter — نفس مفهوم ExecutiveReportView
// يفلتر التوقعات الضعيفة من كل الإحصائيات (KPI cards + persona cards + chart + table)
type QualityMode = 'top_picks' | 'all';
const QUALITY_MODE_OPTIONS: Array<{ value: QualityMode; label: string; desc: string; emoji: string }> = [
  { value: 'top_picks', label: 'أفضل التوقعات', desc: 'أقصى 5 توقعات/يوم لكل شخصية (الثقة ≥ الحد)', emoji: '⭐' },
  { value: 'all', label: 'كل التوقعات', desc: 'بدون فلترة (للتحليل الشامل)', emoji: '📊' },
];
const CONFIDENCE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 50, label: '50+ (متوسط)' },
  { value: 60, label: '60+ (جيد)' },
  { value: 70, label: '70+ (قوي)' },
  { value: 80, label: '80+ (قوي جداً)' },
];

function formatReturnPct(pct: number | null | undefined) {
  if (pct == null || isNaN(Number(pct))) return { text: '—', color: 'text-muted-foreground' };
  const n = Number(pct);
  if (n > 0) return { text: `+${n.toFixed(2)}%`, color: 'text-emerald-600 dark:text-emerald-400' };
  if (n < 0) return { text: `${n.toFixed(2)}%`, color: 'text-rose-600 dark:text-rose-400' };
  return { text: '0.00%', color: 'text-muted-foreground' };
}

function formatProfitFactor(pf: number | null | undefined): string {
  if (pf == null || isNaN(Number(pf))) return '—';
  const n = Number(pf);
  if (n >= 999) return '∞';
  return n.toFixed(2);
}

// P0-v17: عرض تاريخ الدخول/التنفيذ بصيغة موجزة (dd/mm/yyyy) + الوقت إن وُجد
function formatDateShort(d?: string | null, withTime = false): string {
  if (!d) return '—';
  try {
    const s = String(d).replace(' ', 'T');
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return String(d).slice(0, 10);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = dt.getFullYear();
    if (withTime) {
      const hh = String(dt.getHours()).padStart(2, '0');
      const mi = String(dt.getMinutes()).padStart(2, '0');
      return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
    }
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return String(d).slice(0, 10);
  }
}

// P0-v17: حساب أيام التداول الفعلية بين تاريخين (entry → exit/now)
function computeHoldingDays(entryDate?: string | null, closedAt?: string | null): number | null {
  if (!entryDate) return null;
  try {
    const start = new Date(String(entryDate).replace(' ', 'T'));
    if (isNaN(start.getTime())) return null;
    const end = closedAt ? new Date(String(closedAt).replace(' ', 'T')) : new Date();
    if (isNaN(end.getTime())) return null;
    const diff = Math.floor((end.getTime() - start.getTime()) / 86400000);
    return Math.max(0, diff);
  } catch {
    return null;
  }
}

// ─── Export text generator — builds shareable plain-text from the predictions table ─

function generatePredictionsText(
  predictions: LivePrediction[],
  data: LiveTrackingResponse | null,
): string {
  if (!predictions.length) return '';
  const daysLabel = data?.daysWindow != null ? DAYS_OPTIONS.find((d) => d.value === data.daysWindow)?.label : '';
  const lines: string[] = [
    '📊 سجل أداء التوقعات — تتبع القصاعات بين الشخصيات',
    `📋 عدد الصفقات: ${predictions.length}${daysLabel ? ` | الفترة: ${daysLabel}` : ''}`,
    `🕒 آخر تحديث: ${data?.last_updated || '—'}`,
    '',
  ];
  predictions.forEach((p) => {
    const personaCfg = PERSONA_CONFIG[p.persona as keyof typeof PERSONA_CONFIG];
    const trailing = isTrailingProfit(p);
    const outcomeLabel = trailing
      ? TRAILING_PROFIT_CONFIG.label
      : OUTCOME_CONFIG[p.outcome as keyof typeof OUTCOME_CONFIG]?.label || p.outcome || '—';
    const lastPrice = !p.outcome || p.outcome === 'PENDING' ? p.currentPrice : p.exitPrice;
    const pct = p.returnPct != null ? (p.returnPct >= 0 ? '+' : '') + p.returnPct.toFixed(2) + '%' : '—';
    const holding = computeHoldingDays(p.entryDate, p.closedAt);
    lines.push(
      `• ${p.ticker} — ${p.nameAr || p.ticker}`,
      `  🔥 الشخصية: ${personaCfg?.nameAr || p.persona}`,
      `  📅 التاريخ: ${formatDateShort(p.entryDate)}`,
      `  📥 دخول: ${fmtPrice(p.entryPrice)} ج.م | 🛑 وقف: ${fmtPrice(p.stopLoss)}`,
      `  🎯 هدف 1: ${fmtPrice(p.targetPrice)} ج.م${p.targetPrice2 != null ? ` | 🎯 هدف 2: ${fmtPrice(p.targetPrice2)}` : ''}`,
      `  💰 ${!p.outcome || p.outcome === 'PENDING' ? 'حالي' : 'نهائي'}: ${fmtPrice(lastPrice ?? 0)} ج.م`,
      `  🏷️ الحالة: ${outcomeLabel} | 📈 العائد: ${pct}`,
      `  📆 المدة: ${holding != null ? `${holding} يوم` : (p.daysSinceEntry != null ? `${p.daysSinceEntry} يوم` : '—')}`,
    );
  });
  lines.push('', '⚠️ هذا التحليل لأغراض تعليمية فقط — ليس نصيحة استثمارية', OFFICIAL_LINKS_BLOCK);
  return lines.join('\n');
}

// RL-FIX-13: أعِد حساب الإحصائيات من قائمة توقعات مفلترة (بدلاً من استخدام stats الـ backend
// اللي بتعكس كل التوقعات بما فيها الضعيفة). دي الدالة اللي بتخلي الـ KPI cards والـ persona
// cards يتحدثوا مع تغيير فلتر الجودة.
function computeStatsFromPredictions(preds: LivePrediction[]): PersonaStats {
  let wins = 0, losses = 0, expired = 0, pending = 0;
  let winReturnsSum = 0;   // مجموع عوائد الصفقات الرابحة (موجب)
  let lossReturnsSum = 0;  // مجموع عوائد الصفقات الخاسرة (سالب)
  for (const p of preds) {
    const ret = Number(p.returnPct || 0);
    if (p.outcome === 'WIN') {
      // Constitution Rule 7 (HARD cap): تجاهل العوائد السامة |ret| > 50% اللي بتلوث المتوسطات والـ PF.
      if (Math.abs(ret) > 50) continue;
      wins++;
      winReturnsSum += ret;
    } else if (p.outcome === 'LOSS') {
      if (Math.abs(ret) > 50) continue;
      losses++;
      lossReturnsSum += ret; // ret سالب للخسائر
    } else if (p.outcome === 'EXPIRED') {
      expired++;
    } else if (p.outcome === 'PENDING') {
      pending++;
    }
  }
  const settled = wins + losses;
  const total = preds.length;
  const winRate = settled > 0 ? (wins / settled) * 100 : 0;
  const avgWinPct = wins > 0 ? winReturnsSum / wins : 0;
  const avgLossPct = losses > 0 ? lossReturnsSum / losses : 0; // سالب
  const profitFactor = lossReturnsSum < 0
    ? winReturnsSum / Math.abs(lossReturnsSum)
    : (winReturnsSum > 0 ? 999 : 0);
  const closedCount = settled;
  const netReturn = winReturnsSum + lossReturnsSum; // صافي الربح/الخسارة
  const grossProfit = winReturnsSum; // إجمالي الأرباح (موجب)
  const grossLoss = lossReturnsSum; // إجمالي الخسائر (سالب)
  const validLosses = preds
    .map(p => Number(p.returnPct ?? (p as any).actual_return ?? (p as any).pnl_pct))
    .filter(r => !isNaN(r) && r < 0);
  const maxLoss = validLosses.length > 0 ? Math.min(...validLosses) : 0; // أقصى خسارة (أكثر قيمة سالبة)
  const rrRatio = avgLossPct < 0 ? avgWinPct / Math.abs(avgLossPct) : 0; // متوسط الربح ÷ متوسط الخسارة
  return { total, wins, losses, pending, settled, winRate, avgWinPct, avgLossPct, profitFactor, closedCount, expired, netReturn, grossProfit, grossLoss, maxLoss, rrRatio };
}

// ==================== Main Dashboard Component ====================

interface PredictionTrackingDashboardProps {
  market?: string;
  className?: string;
}

export function PredictionTrackingDashboard({
  market = 'EGX',
  className,
}: PredictionTrackingDashboardProps) {
  const [data, setData] = useState<LiveTrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<DaysWindow>(999); // RL-FIX-7: افتراضي = من أول السنة (YTD)
  const [countdown, setCountdown] = useState(60);

  // Filters & Search & Sorting State
  const [selectedPersona, setSelectedPersona] = useState<PersonaId>('all');
  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'return' | 'date' | 'target' | 'days'>('return');
  // P0-v17: فلتر تاريخ الدخول (مستقل عن فلتر الـ backend days window)
  const [entryPeriod, setEntryPeriod] = useState<'all' | '7d' | '30d' | '90d'>('all');

  // RL-FIX-13: فلتر الجودة — يفلتر التوقعات الضعيفة من كل الإحصائيات
  const [qualityMode, setQualityMode] = useState<QualityMode>('top_picks');
  const [minConfidence, setMinConfidence] = useState<number>(70);

  // Proof Modal State
  const [selectedProofTrade, setSelectedProofTrade] = useState<LivePrediction | null>(null);
  const proofCardRef = useRef<HTMLDivElement>(null);
  const [downloadingProof, setDownloadingProof] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  // RL-FIX-16-FE: ref لتتبع هل عننا data (بدل ما نـ depend على `data` في useCallback
  // اللي بـ يسبب re-fetch loop). بنقرأ الـ ref جوه catch block علشان نقرر هل نـ show
  // toast.error (initial load failure) ولا لأ (polling failure — silent).
  const hasDataRef = useRef(false);

  // ── Fetch Data ──
  // HONEST-TRACKING-FIX: بنجيب البيانات من /api/predictions/honest-tracking/live-tracking
  // بدل /api/stored-analysis/live-tracking. السبب:
  //   - live-tracking (القديم) بيـ depend على Python backend (port 8010) — لو Python مش شغال
  //     بيرجع أصفار في كل الإحصائيات.
  //   - honest-tracking/live-tracking بيرجع بيانات من SQLite مباشرةً بدون Python.
  //   - ده endpoint خفيف بيحسب الإحصائيات في SQL ويرجع بس top-N predictions لكل شخصية.
  //   - ده بيخلي التبويب يشتغل دايماً حتى لو Python مش شغال.
  const fetchData = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRefreshing(true);
    setError(null);

    try {
      const fetchDays = days; // 999 = YTD, 0 = All, >0 = Days
      const minScore = qualityMode === 'top_picks' ? minConfidence : 0;
      const res = await fetch(
        `/api/predictions/honest-tracking/live-tracking?market=${encodeURIComponent(market)}&days=${fetchDays}&limit=200&minScore=${minScore}`,
        { cache: 'no-store', signal: ctrl.signal }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json: LiveTrackingResponse = await res.json();
      if (!ctrl.signal.aborted) {
        if (json.success) {
          setData(json);
          hasDataRef.current = true;
          setCountdown(json.market_session?.next_refresh_seconds || 300);
        } else {
          setError(json.error || 'فشل تحميل إحصائيات التوقعات');
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error('[PredictionTracking] Fetch failed:', e);
        setError('تعذر الاتصال بالخادم. جاري إعادة المحاولة...');
        if (!hasDataRef.current) {
          toast.error('فشل تحميل بيانات متابعة التوقعات');
        }
      }
    } finally {
      if (!abortRef.current?.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [market, days, qualityMode, minConfidence]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchData]);

  // Polling interval — HONEST-TRACKING-FIX: poll كل 5 دقائق (مش كل 60 ثانية)
  // لأن honest-tracking بياخد البيانات من SQLite مباشرةً (مش Python) وبيتحتمل
  // أقل frequency لأن البيانات ما بتتغيرش كل ثانية.
  useEffect(() => {
    const pollSec = 300; // 5 minutes
    const timer = setInterval(fetchData, pollSec * 1000);
    const countTimer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? pollSec : prev - 1));
    }, 1000);

    return () => {
      clearInterval(timer);
      clearInterval(countTimer);
    };
  }, [fetchData]);

  // Merge all predictions from response
  const allRawPredictions = useMemo<LivePrediction[]>(() => {
    if (!data?.predictions) return [];
    return [
      ...(data.predictions.gambler || []),
      ...(data.predictions.balanced || []),
      ...(data.predictions.conservative || []),
    ];
  }, [data?.predictions]);

  // FIX-5B: Dedup client-side — توقع واحد لكل (ticker, persona, entryDate).
  // المشكلة: live-tracking endpoint (Python) بيرجع نفس التوقع مرتين أحياناً (مثلاً
  // ARVA تظهر مرتين لنفس اليوم والشخصية). الـ dedup بيضمن إن الـ stats والـ table
  // ما يحسبوش نفس الصفقة مرتين. الـ pattern نفسه موجود في ExecutiveReportView:590
  // (uniqueStocks) — بس هنا بنـ dedup على (ticker, persona, entryDate) بدل (ticker,
  // entryDate) علشان شخصيات مختلفة لنفس السهم ممكن تـ count بشكل مستقل.
  const dedupedPredictions = useMemo<LivePrediction[]>(() => {
    const seen = new Set<string>();
    const out: LivePrediction[] = [];
    for (const p of allRawPredictions) {
      const key = `${p.ticker}__${p.persona || 'unknown'}__${String(p.entryDate || '').slice(0, 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }, [allRawPredictions]);

  // RL-FIX-13: Quality-filtered predictions — يطبّق (1) حد الثقة و (2) top-5/يوم/شخصية
  // على كل التوقعات الخام قبل ما تروح للـ stats والـ chart والـ table.
  // لما qualityMode === 'all' بيرجّع كل التوقعات بدون فلترة.
  // FIX-5B: بنطبّق الـ quality filter على dedupedPredictions بدل allRawPredictions
  // علشان الـ dedup يفضل ساري حتى في وضع 'all'.
  const qualityFilteredPredictions = useMemo<LivePrediction[]>(() => {
    if (qualityMode === 'all') return dedupedPredictions;
    // (a) confidence floor
    const filtered = dedupedPredictions.filter((p) => {
      const score = Number(p.confidence ?? p.maestroScore ?? 0);
      return score >= minConfidence;
    });
    // (b) top-N per (entryDate, persona) — مجموع حسب (اليوم، الشخصية) ثم خذ أعلى 5
    const groupKey = (p: LivePrediction) =>
      `${String(p.entryDate || '').slice(0, 10)}__${p.persona || 'unknown'}`;
    const groups = new Map<string, LivePrediction[]>();
    for (const p of filtered) {
      const key = groupKey(p);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    const kept: LivePrediction[] = [];
    for (const [, group] of groups) {
      group.sort((a, b) =>
        Number(b.confidence ?? b.maestroScore ?? 0) - Number(a.confidence ?? a.maestroScore ?? 0)
      );
      kept.push(...group.slice(0, 5));
    }
    return kept;
  }, [dedupedPredictions, qualityMode, minConfidence]);

  // PERSONA-DEDUP (القاعدة الذهبية: السهم الواحد = صفقة واحدة): للإحصائيات الإجمالية،
  // نخصّص صف واحد لكل (ticker, entryDate) — حتى لو السهم ظهر في أكثر من شخصية.
  // التكرار بين الشخصيات = إشارة قوة (انظر focusTickers)، مش 3 صفقات منفصلة.
  // نختار الصف ذو الأولوية الأعلى: morning_bell → evidence_count → maestroScore/confidence.
  const aggregateByTicker = useMemo<LivePrediction[]>(() => {
    const best = new Map<string, LivePrediction>();
    const rank = (x: LivePrediction) =>
      (x.morning_bell ? 1_000_000 : 0) +
      Number(x.evidence_count ?? 0) * 1_000 +
      Number(x.confidence ?? x.maestroScore ?? 0);
    for (const p of qualityFilteredPredictions) {
      const key = `${p.ticker}__${String(p.entryDate || '').slice(0, 10)}`;
      const prev = best.get(key);
      if (!prev || rank(p) > rank(prev)) best.set(key, p);
    }
    return Array.from(best.values());
  }, [qualityFilteredPredictions]);

  // RL-FIX-13 + PERSONA-DEDUP: الإحصائيات الإجمالية تُحسب من الأسهم المخصّصة (ticker-level)،
  // أما تفصيل الشخصيات فيعرض "تغطية" كل شخصية (السهم في شخصيتين يظهر في الإحمالين) —
  // ده تحليل تغطية مش عدّ صفقات منفصلة. الـ overall هو العدّاد الرسمي للـ WR/PF.
  const computedStats = useMemo<{
    overall: PersonaStats;
    byPersona: Record<'gambler' | 'balanced' | 'conservative', PersonaStats>;
  }>(() => {
    const overall = computeStatsFromPredictions(aggregateByTicker);
    const byPersona = {
      gambler: computeStatsFromPredictions(qualityFilteredPredictions.filter((p) => p.persona === 'gambler')),
      balanced: computeStatsFromPredictions(qualityFilteredPredictions.filter((p) => p.persona === 'balanced')),
      conservative: computeStatsFromPredictions(qualityFilteredPredictions.filter((p) => p.persona === 'conservative')),
    };
    return { overall, byPersona };
  }, [aggregateByTicker, qualityFilteredPredictions]);

  // P0-v17: كشف التكرار بين الشخصيات — السهم اللي يظهر في شخصيتين أو أكتر = "تركيز/قوة"
  // (نظام حساب واحد → التكرار معناه إشارة قوية: يا هتطلع يا هتنزل، لازم نركز كعصابة)
  const focusTickers = useMemo<Record<string, { count: number; personas: string[] }>>(() => {
    const map: Record<string, { count: number; personas: Set<string> }> = {};
    for (const p of qualityFilteredPredictions) {
      if (!p.ticker) continue;
      if (!map[p.ticker]) map[p.ticker] = { count: 0, personas: new Set() };
      map[p.ticker].count += 1;
      if (p.persona) map[p.ticker].personas.add(p.persona);
    }
    const out: Record<string, { count: number; personas: string[] }> = {};
    for (const [tk, info] of Object.entries(map)) {
      if (info.personas.size >= 2) out[tk] = { count: info.count, personas: Array.from(info.personas) };
    }
    return out;
  }, [qualityFilteredPredictions]);

  const focusTickerList = useMemo(() => Object.keys(focusTickers).sort(), [focusTickers]);

  // P0-v17: بيانات الرسم البياني لحركة الأرباح التراكمية (من الصفقات المقفولة فقط)
  // 🔥 VERIFY-FIX-5: الرسم بيقبل نفس فلتر entryPeriod (7d/30d/90d) اللي بيتحكم
  // في الجدول. قبل كده كان الرسم بـ uses allRawPredictions من غير فلتر → لما
  // المستخدم بيغير الفترة الزمنية، الجدول كان بيتحرك بس الرسم بيفضل ثابت.
  // دلوقتي الرسم بـ يتحدث مع تغيير الفترة.
  const cumulativeProfitData = useMemo<{ date: string; label: string; cumulative: number; trade: number; ticker: string }[]>(() => {
    // احسب حد تاريخ الدخول للفلتر الزمني (نفس منطق filteredPredictions)
    let entryCutoff: number | null = null;
    if (entryPeriod !== 'all') {
      const d = entryPeriod === '7d' ? 7 : entryPeriod === '30d' ? 30 : 90;
      entryCutoff = Date.now() - d * 86400000;
    }

    // PERSONA-DEDUP + Rule 7: الرسم التراكمي يستخدم الأسهم المخصّصة (ticker-level) + HARD cap 50%.
    const closed = aggregateByTicker
      .filter((p) => p.outcome === 'WIN' || p.outcome === 'LOSS')
      .filter((p) => p.closedAt && p.returnPct != null)
      .filter((p) => Math.abs(Number(p.returnPct || 0)) <= 50)
      // 🔥 VERIFY-FIX-5: فلتر entryPeriod — نفس اللي الجدول بـ يستخدمه
      .filter((p) => {
        if (entryCutoff === null || !p.entryDate) return true;
        const t = new Date(String(p.entryDate).replace(' ', 'T')).getTime();
        if (isNaN(t)) return true; // لو التاريخ مش مفهوم، خليه (better to show than hide)
        return t >= entryCutoff;
      })
      .map((p) => ({
        ticker: p.ticker,
        closedAt: p.closedAt as string,
        returnPct: Number(p.returnPct),
      }))
      .sort((a, b) => String(a.closedAt).localeCompare(String(b.closedAt)));
    let cum = 0;
    return closed.map((c, i) => {
      cum += c.returnPct;
      return {
        date: String(c.closedAt).slice(0, 10),
        label: `${String(c.closedAt).slice(5, 10)} · ${c.ticker}`,
        cumulative: Math.round(cum * 100) / 100,
        trade: Math.round(c.returnPct * 100) / 100,
        ticker: c.ticker,
      };
    });
  }, [qualityFilteredPredictions, entryPeriod]);

  // RL-FIX-13: Computed Persona Stats — من التوقعات المفلترة بالجودة (مش من backend stats)
  const activeStats = useMemo<PersonaStats>(() => {
    if (!data) return { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0, netReturn: 0, grossProfit: 0, grossLoss: 0, maxLoss: 0, rrRatio: 0 };
    if (selectedPersona === 'all') return computedStats.overall;
    return computedStats.byPersona[selectedPersona] || computedStats.overall;
  }, [data, selectedPersona, computedStats]);

  // Filtered & Sorted Predictions for Proof Table
  const filteredPredictions = useMemo(() => {
    // P0-v17: حساب حد تاريخ الدخول للفلتر الزمني
    let entryCutoff: number | null = null;
    if (entryPeriod !== 'all') {
      const d = entryPeriod === '7d' ? 7 : entryPeriod === '30d' ? 30 : 90;
      entryCutoff = Date.now() - d * 86400000;
    }
    // RL-FIX-7: YTD (days=999) — فلتر client-side من 1 يناير للسنة الحالية
    if (days === 999) {
      const now = new Date();
      const ytdCutoff = new Date(now.getFullYear(), 0, 1).getTime();
      entryCutoff = entryCutoff !== null ? Math.max(entryCutoff, ytdCutoff) : ytdCutoff;
    }

    return qualityFilteredPredictions
      .filter((item) => {
        // Persona filter
        if (selectedPersona !== 'all' && item.persona !== selectedPersona) return false;

        // Outcome filter
        if (selectedOutcome !== 'ALL' && item.outcome !== selectedOutcome) return false;

        // P0-v17: فلتر تاريخ الدخول (client-side)
        if (entryCutoff !== null && item.entryDate) {
          const t = new Date(String(item.entryDate).replace(' ', 'T')).getTime();
          if (!isNaN(t) && t < entryCutoff) return false;
        }

        // Search query filter (Ticker or Name)
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const matchTicker = item.ticker.toLowerCase().includes(q);
          const matchName = (item.nameAr || '').toLowerCase().includes(q);
          if (!matchTicker && !matchName) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'return') {
          return (b.returnPct ?? 0) - (a.returnPct ?? 0);
        }
        if (sortBy === 'date') {
          return (b.entryDate || '').localeCompare(a.entryDate || '');
        }
        if (sortBy === 'target') {
          const aDist = a.targetPrice && a.currentPrice ? Math.abs(a.targetPrice - a.currentPrice) : 999;
          const bDist = b.targetPrice && b.currentPrice ? Math.abs(b.targetPrice - b.currentPrice) : 999;
          return aDist - bDist;
        }
        if (sortBy === 'days') {
          return (b.daysSinceEntry ?? 0) - (a.daysSinceEntry ?? 0);
        }
        return 0;
      });
  }, [qualityFilteredPredictions, selectedPersona, selectedOutcome, searchQuery, sortBy, entryPeriod, days]);

  const predictionsShareText = useMemo(
    () => generatePredictionsText(filteredPredictions, data),
    [filteredPredictions, data],
  );

  // ── UnifiedTable columns for the desktop predictions table ────────────────
  // كل render function بتاخد row (LivePrediction) وبترد ReactNode.
  // الـ columns بتعتمد على focusTickers (مكروم) لذا الـ memo بيتحدث معها.
  const desktopTableColumns = useMemo<Column<LivePrediction>[]>(() => [
    {
      key: 'ticker',
      header: 'السهم والشخصية',
      align: 'right',
      width: 'min-w-[180px]',
      render: (p) => {
        const personaCfg = PERSONA_CONFIG[p.persona];
        return (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono font-black text-sm text-foreground">
                {p.ticker}
              </span>
              <Badge variant="outline" className={cn('text-[9px] py-0 px-1.5 font-bold', personaCfg.badgeBg)}>
                {personaCfg.emoji} {personaCfg.nameAr}
              </Badge>
              {focusTickers[p.ticker] && (
                <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[9px] py-0 px-1.5 font-bold whitespace-nowrap" title="مكرر في عدة شخصيات — إشارة قوية">
                  🎯 تركيز ×{focusTickers[p.ticker].count}
                </Badge>
              )}
              {p.morning_bell && (
                <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 text-[9px] py-0 px-1.5 font-bold whitespace-nowrap" title="جرس الصباح — أعلى ثقة وربحية متوقعة">
                  🔔 جرس الصباح
                </Badge>
              )}
              {p.evidence_count != null && p.evidence_count > 0 && (
                <Badge variant="outline" className="text-[9px] py-0 px-1.5 font-bold text-emerald-600 dark:text-emerald-400 border-emerald-500/30 whitespace-nowrap" title="عدد الأدلة المتوافقة (V40)">
                  ✅ {p.evidence_count}/6
                </Badge>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
              {p.nameAr || p.ticker}
            </span>
          </div>
        );
      },
    },
    {
      key: 'entryDate',
      header: 'تاريخ التوقع',
      align: 'right',
      width: 'min-w-[110px]',
      className: 'font-mono',
      render: (p) => (
        <div className="flex flex-col">
          <span className="text-[9px] text-muted-foreground">تاريخ التوقع</span>
          <span className="font-bold text-foreground text-[11px]">{formatDateShort(p.entryDate)}</span>
        </div>
      ),
    },
    {
      key: 'entryPrice',
      header: 'الأسعار (دخول/وقف)',
      align: 'right',
      width: 'min-w-[120px]',
      className: 'font-mono',
      render: (p) => (
        <div className="flex flex-col">
          <span className="font-bold text-foreground">📥 {fmtPrice(p.entryPrice)}</span>
          <span className="text-rose-600 dark:text-rose-400 text-[11px]">🛑 {fmtPrice(p.stopLoss)}</span>
        </div>
      ),
    },
    {
      key: 'targetPrice',
      header: 'المستهدف الأول',
      align: 'right',
      width: 'min-w-[120px]',
      className: 'font-mono',
      render: (p) => (
        <div className="flex flex-col">
          <span className="text-[9px] text-muted-foreground">المستهدف الأول</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-bold">🎯 {fmtPrice(p.targetPrice)}</span>
        </div>
      ),
    },
    {
      key: 'targetPrice2',
      header: 'المستهدف الثاني',
      align: 'right',
      width: 'min-w-[120px]',
      className: 'font-mono',
      render: (p) => {
        const hasTarget2 = p.targetPrice2 != null && Number(p.targetPrice2) > 0;
        return (
          <div className="flex flex-col">
            <span className="text-[9px] text-muted-foreground">المستهدف الثاني</span>
            {hasTarget2 ? (
              <span className="text-teal-600 dark:text-teal-400 font-bold">🎯 {fmtPrice(p.targetPrice2)}</span>
            ) : (
              <span className="text-muted-foreground font-bold">—</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'currentPrice',
      header: 'السعر الحالي + تاريخ التنفيذ',
      align: 'right',
      width: 'min-w-[140px]',
      className: 'font-mono font-bold',
      render: (p) => {
        const isClosed = p.outcome !== 'PENDING';
        const lastPrice = isClosed ? p.exitPrice : p.currentPrice;
        const executionDate = p.executionDate || p.closedAt;
        return (
          <div className="flex flex-col">
            <span>{fmtPrice(lastPrice)}</span>
            <span className="text-[10px] text-muted-foreground font-normal">
              {executionDate ? `تنفيذ: ${formatDateShort(executionDate)}` : 'معلّقة ⏳'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'outcome',
      header: 'الحالة الرسمية',
      align: 'right',
      width: 'min-w-[120px]',
      render: (p) => {
        const trailingProfit = isTrailingProfit(p);
        return trailingProfit ? (
          <Badge className={cn('text-[10px] font-bold whitespace-nowrap', TRAILING_PROFIT_CONFIG.badge)} title="السهم وصل لربح جزئي ثم ارتد — تم جني الأرباح قبل الهدف الكامل">
            {TRAILING_PROFIT_CONFIG.label}
          </Badge>
        ) : (
          <Badge className={cn('text-[10px] font-bold whitespace-nowrap', OUTCOME_CONFIG[p.outcome].badge)}>
            {OUTCOME_CONFIG[p.outcome].label}
          </Badge>
        );
      },
    },
    {
      key: 'liveOutcome',
      header: 'الحالة الحية (معاينة)',
      align: 'right',
      width: 'min-w-[120px]',
      render: (p) => {
        const isClosed = p.outcome !== 'PENDING';
        const liveOutcomeKey = p.liveOutcome ?? 'PENDING';
        const showLivePreview = !isClosed && p.liveOutcome != null && p.liveOutcome !== 'PENDING';
        const highest = Number(p.highestPriceReached ?? p.highest_price_reached ?? 0);
        const liveReturnPct = computeLiveReturnPct(p);
        const showLiveReturnBadge = !isClosed && liveReturnPct != null && highest > 0;
        if (isClosed) {
          return <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">✓ مؤكدة</span>;
        }
        if (showLiveReturnBadge) {
          return (
            <Badge
              className={cn(
                'text-[9px] font-bold whitespace-nowrap border border-dashed',
                liveReturnPct != null && liveReturnPct >= 0
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
                  : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
              )}
              title="العائد اللحظي من السعر الحالي (معاينة غير رسمية — لم تُقفل الصفقة بعد)"
            >
              معاينة: {liveReturnPct != null ? `${liveReturnPct >= 0 ? '+' : ''}${liveReturnPct.toFixed(2)}%` : '—'}
            </Badge>
          );
        }
        if (showLivePreview) {
          return (
            <Badge className={cn('text-[9px] font-bold whitespace-nowrap', LIVE_OUTCOME_CONFIG[liveOutcomeKey].badge)} title="الحالة الحية بناءً على السعر اللحظي (معاينة غير رسمية)">
              {LIVE_OUTCOME_CONFIG[liveOutcomeKey].label}
            </Badge>
          );
        }
        return <span className="text-[10px] text-muted-foreground">—</span>;
      },
    },
    {
      key: 'returnPct',
      header: 'العائد %',
      align: 'right',
      sortable: true,
      width: 'min-w-[100px]',
      className: 'font-mono font-black text-sm',
      render: (p) => {
        const ret = formatReturnPct(p.returnPct);
        return <span className={cn('font-mono font-black text-sm', ret.color)}>{ret.text}</span>;
      },
    },
    {
      key: 'highestPriceReached',
      header: 'أعلى سعر 📈',
      align: 'right',
      width: 'min-w-[100px]',
      className: 'font-mono',
      render: (p) => {
        const highest = Number(p.highestPriceReached ?? p.highest_price_reached ?? 0);
        return (
          <span className={cn('text-[11px] font-bold', highest > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            {highest > 0 ? fmtPrice(highest) : '—'}
          </span>
        );
      },
    },
    {
      key: 'lowestPriceReached',
      header: 'أقل سعر 📉',
      align: 'right',
      width: 'min-w-[100px]',
      className: 'font-mono',
      render: (p) => {
        const lowest = Number(p.lowestPriceReached ?? p.lowest_price_reached ?? 0);
        return (
          <span className={cn('text-[11px] font-bold', lowest > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
            {lowest > 0 ? fmtPrice(lowest) : '—'}
          </span>
        );
      },
    },
    {
      key: 'maxProfitPct',
      header: 'أقصى ربح %',
      align: 'right',
      width: 'min-w-[100px]',
      className: 'font-mono',
      render: (p) => {
        const v = computeMaxProfitPct(p);
        if (v == null) return <span className="text-[11px] text-muted-foreground">—</span>;
        return (
          <span className={cn('text-[11px] font-bold', v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            {v >= 0 ? '+' : ''}{v.toFixed(2)}%
          </span>
        );
      },
    },
    {
      key: 'maxLossPct',
      header: 'أقصى خسارة %',
      align: 'right',
      width: 'min-w-[100px]',
      className: 'font-mono',
      render: (p) => {
        const v = computeMaxLossPct(p);
        if (v == null) return <span className="text-[11px] text-muted-foreground">—</span>;
        return (
          <span className={cn('text-[11px] font-bold', v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
            {v >= 0 ? '+' : ''}{v.toFixed(2)}%
          </span>
        );
      },
    },
    {
      key: 'daysSinceEntry',
      header: 'المدة',
      align: 'center',
      width: 'min-w-[70px]',
      className: 'font-mono font-bold',
      render: (p) => {
        const d = computeHoldingDays(p.entryDate, p.closedAt);
        return d != null ? `${d}d` : (p.daysSinceEntry != null ? `${p.daysSinceEntry}d` : '—');
      },
    },
    {
      key: 'proof',
      header: 'بطاقة الإثبات',
      align: 'center',
      width: 'min-w-[110px]',
      render: (p) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedProofTrade(p);
          }}
          className="h-7 text-[11px] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 font-bold gap-1"
        >
          إثبات الصفقة 🔍
        </Button>
      ),
    },
  ], [focusTickers]);

  // Handle Exporting Proof Image
  const handleExportProofImage = useCallback(async () => {
    if (!proofCardRef.current || !selectedProofTrade) return;
    setDownloadingProof(true);
    try {
      const dataUrl = await toPng(proofCardRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#090d16',
      });
      const link = document.createElement('a');
      link.download = `PROOF_${selectedProofTrade.ticker}_${selectedProofTrade.persona}_${Date.now()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('تمت طباعة واستخراج بطاقة الإثبات بنجاح 📸');
    } catch (err) {
      console.error('Proof export failed:', err);
      toast.error('فشل استخراج بطاقة الإثبات');
    } finally {
      setDownloadingProof(false);
    }
  }, [selectedProofTrade]);

  const session = data?.market_session;

  return (
    <div className={cn('space-y-5 dir-rtl', className)}>
      {/* ─── 1. Luxury Header & Timeframe Control Bar ─── */}
      <Card className="border border-emerald-500/30 bg-gradient-to-br from-card via-card to-emerald-950/20 shadow-xl rounded-2xl overflow-hidden">
        <CardHeader className="p-4 md:p-6 pb-3 border-b border-border/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1 font-bold">
                  <Sparkles className="w-3.5 h-3.5" />
                  مركز الشفافية والمصداقية الحية
                </Badge>
                {session && (
                  <Badge className={cn(
                    'text-[10px] gap-1 font-bold',
                    session.is_open
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 animate-pulse'
                      : 'bg-muted text-muted-foreground border border-border'
                  )}>
                    {session.is_open ? <Activity className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                    {session.is_open ? 'جلسة تداول حية LIVE' : 'السوق مغلق'}
                  </Badge>
                )}
              </div>
              <h1 className="text-xl md:text-2xl font-black text-foreground mt-1.5 flex items-center gap-2">
                <Gauge className="w-6 h-6 text-emerald-500" />
                سجل أداء التوقعات ودلائل صحة الصفقات
              </h1>
              <p className="text-xs md:text-sm text-muted-foreground mt-1">
                سجل موثق بالكامل لكافة الصفقات والتوقعات الصادرة من المحرك الفني الذكي، مع متابعة دقيقة لنسبة النجاح والأهداف المحققة.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchData}
                disabled={refreshing}
                className="h-9 px-3 text-xs border-border bg-background hover:bg-muted font-bold"
              >
                {refreshing ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 ml-1 text-emerald-500" />}
                تحديث {countdown > 0 && `(${countdown}s)`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    const res = await fetch('/api/predictions/honest-tracking/verify-pending', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ limit: 500 }),
                    });
                    const result = await res.json();
                    if (result.success) {
                      const r = result.results;
                      toast.success(`تحقق من ${r.checked} توقع: ${r.target_hits} هدف ✓ | ${r.stopped} وقف ✗ | ${r.expired} منتهي | ${r.still_pending} معلق`);
                      fetchData(); // Refresh data after verification
                    } else {
                      toast.error(result.error || 'فشل التحقق');
                    }
                  } catch (e) {
                    toast.error('فشل في التحقق من التوقعات المعلقة');
                  } finally {
                    setRefreshing(false);
                  }
                }}
                disabled={refreshing}
                className="h-9 px-3 text-xs border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold"
              >
                {refreshing ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 ml-1" />}
                تحقق من المعلقة
              </Button>
              <ExportDropdown shareText={predictionsShareText} disabled={!predictionsShareText} />
            </div>
          </div>

          {/* Timeframe Selector Pills */}
          <div className="flex items-center gap-1.5 pt-4 overflow-x-auto no-scrollbar">
            <span className="text-xs text-muted-foreground font-bold ml-1 flex-shrink-0">الفترة الزمنية:</span>
            {DAYS_OPTIONS.map((opt) => (
              <button
                key={`days-${opt.value}`}
                onClick={() => setDays(opt.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap border',
                  days === opt.value
                    ? 'bg-emerald-500 text-white dark:text-emerald-950 border-emerald-500 shadow-md shadow-emerald-500/20'
                    : 'bg-background border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* RL-FIX-13: Quality Filter — يفلتر التوقعات الضعيفة من كل الإحصائيات */}
          <div className="flex flex-col gap-2 pt-3 mt-3 border-t border-border/40">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <span className="text-xs text-muted-foreground font-bold ml-1 flex-shrink-0">الجودة:</span>
              {QUALITY_MODE_OPTIONS.map((opt) => (
                <button
                  key={`qm-${opt.value}`}
                  onClick={() => setQualityMode(opt.value)}
                  title={opt.desc}
                  className={cn(
                    'px-3 py-1.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap border',
                    qualityMode === opt.value
                      ? 'bg-amber-500 text-white dark:text-amber-950 border-amber-500 shadow-md shadow-amber-500/20'
                      : 'bg-background border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  {opt.emoji} {opt.label}
                </button>
              ))}
              {qualityMode === 'top_picks' && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px] font-bold mr-1">
                  ≥{minConfidence} ثقة · 5/يوم/شخصية
                </Badge>
              )}
            </div>
            {qualityMode === 'top_picks' && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                <span className="text-xs text-muted-foreground font-bold ml-1 flex-shrink-0">الثقة ≥:</span>
                {CONFIDENCE_OPTIONS.map((opt) => (
                  <button
                    key={`conf-${opt.value}`}
                    onClick={() => setMinConfidence(opt.value)}
                    className={cn(
                      'px-2.5 py-1 text-xs font-bold rounded-lg transition-all whitespace-nowrap border',
                      minConfidence === opt.value
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-extrabold'
                        : 'bg-background border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardHeader>

        {/* ─── 2. Hero KPI Cards Grid — ما يهم العميل: الفلوس + الحماية ─── */}
        <CardContent className="p-4 md:p-6 pt-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
            {/* صافي الربح/الخسارة — الفلوس الفعلية */}
            <div className={cn(
              'col-span-2 sm:col-span-1 p-4 rounded-2xl border flex flex-col justify-between relative overflow-hidden',
              activeStats.netReturn >= 0
                ? 'bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent border-emerald-500/30'
                : 'bg-gradient-to-br from-red-500/15 via-red-500/5 to-transparent border-red-500/30'
            )}>
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <span className={activeStats.netReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                  {activeStats.netReturn >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
                </span>
                <TrendingUp className={cn('w-4 h-4', activeStats.netReturn >= 0 ? 'text-emerald-500' : 'text-red-500')} />
              </div>
              <div className="flex items-baseline gap-1 my-1">
                <span className={cn(
                  'text-3xl md:text-4xl font-black tracking-tight font-mono',
                  activeStats.netReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                )}>
                  {activeStats.netReturn >= 0 ? '+' : ''}{activeStats.netReturn.toFixed(1)}%
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                إجمالي عائد {activeStats.settled} صفقة مقفولة
              </p>
            </div>

            {/* إجمالي الأرباح */}
            <div className="bg-card border border-emerald-500/20 p-4 rounded-2xl flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-bold mb-1">
                <span>إجمالي الأرباح</span>
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="my-1">
                <span className="text-2xl md:text-3xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                  +{activeStats.grossProfit.toFixed(1)}%
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                من {activeStats.wins} صفقة رابحة
              </p>
            </div>

            {/* إجمالي الخسائر */}
            <div className="bg-card border border-red-500/20 p-4 rounded-2xl flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-red-600 dark:text-red-400 font-bold mb-1">
                <span>إجمالي الخسائر</span>
                <TrendingDown className="w-4 h-4" />
              </div>
              <div className="my-1">
                <span className="text-2xl md:text-3xl font-black font-mono text-red-600 dark:text-red-400">
                  {activeStats.grossLoss.toFixed(1)}%
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                من {activeStats.losses} صفقة خاسرة
              </p>
            </div>

            {/* الحماية من الخسائر — أقصى خسارة في صفقة */}
            <div className="bg-card border border-amber-500/20 p-4 rounded-2xl flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-amber-600 dark:text-amber-400 font-bold mb-1">
                <span>أقصى خسارة (حماية)</span>
                <Shield className="w-4 h-4" />
              </div>
              <div className="my-1">
                <span className="text-2xl md:text-3xl font-black font-mono text-amber-600 dark:text-amber-400">
                  {activeStats.maxLoss.toFixed(1)}%
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                الحد الأقصى للخسارة في صفقة واحدة
              </p>
            </div>

            {/* نسبة الربح للخسارة — R:R */}
            <div className="bg-card border border-border/80 p-4 rounded-2xl flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-bold mb-1">
                <span>نسبة الربح/الخسارة</span>
                <Scale className="w-4 h-4 text-teal-500" />
              </div>
              <div className="my-1">
                <span className={cn(
                  'text-2xl md:text-3xl font-black font-mono',
                  activeStats.rrRatio >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' :
                  activeStats.rrRatio >= 1.0 ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400'
                )}>
                  {activeStats.rrRatio.toFixed(2)}:1
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                متوسط الربح ÷ متوسط الخسارة
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── 3. Persona Breakdown Cards Showcase (UNIFIED — balanced only) ─── */}
      {/* KILL-MAESTRO (2026-08-31): V40.2 = balanced فقط — لا كروت للمضارب/المستثمر */}
      <div className="grid grid-cols-1 gap-4">
        {(['balanced'] as const).map((pId) => {
          const cfg = PERSONA_CONFIG[pId];
          const pStats = computedStats.byPersona[pId];
          const Icon = cfg.icon;
          const isSelected = selectedPersona === pId;

          return (
            <button
              key={`persona-card-${pId}`}
              onClick={() => setSelectedPersona(isSelected ? 'all' : pId)}
              className={cn(
                'text-right p-4 rounded-2xl border transition-all duration-200 relative overflow-hidden bg-card flex flex-col justify-between group',
                cfg.border,
                isSelected ? 'ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/10 bg-emerald-500/5' : 'hover:shadow-md'
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{cfg.emoji}</span>
                  <div>
                    <h3 className="font-black text-base text-foreground flex items-center gap-1.5">
                      {cfg.nameAr}
                    </h3>
                    <p className="text-[10px] text-muted-foreground">{cfg.horizonAr}</p>
                  </div>
                </div>
                <Badge variant="outline" className={cn('text-[10px] font-bold', cfg.badgeBg)}>
                  {pStats.winRate.toFixed(1)}% نجاح
                </Badge>
              </div>

              {/* Persona Stats Grid */}
              <div className="grid grid-cols-3 gap-2 text-center my-2 p-2 bg-muted/40 rounded-xl border border-border/50">
                <div>
                  <div className="text-[10px] text-muted-foreground">التوقعات</div>
                  <div className="font-mono font-bold text-xs">{pStats.total}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">صفقات ناجحة</div>
                  <div className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400">{pStats.wins}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">صفقات معلقة</div>
                  <div className="font-mono font-bold text-xs text-amber-600 dark:text-amber-400">{pStats.pending}</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground pt-1 border-t border-border/40 mt-1">
                <span>متوسط الربح: <strong className="text-emerald-600 dark:text-emerald-400">+{pStats.avgWinPct.toFixed(1)}%</strong></span>
                <span>تصفية بالجدول ↓</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ─── P0-v17: Focus Stocks Banner + Cumulative Profit Chart ─── */}
      {focusTickerList.length > 0 && (
        <Card className="border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card to-card shadow-md rounded-2xl overflow-hidden">
          <CardHeader className="p-4 border-b border-amber-500/20">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 gap-1 font-bold text-xs">
                <Layers className="w-3.5 h-3.5" />
                أسهم تحت التركيز ({focusTickerList.length})
              </Badge>
              <CardTitle className="text-sm font-black text-foreground">
                مكررة في أكثر من شخصية — إشارة قوية (طالع أو نازل)
              </CardTitle>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              نظام حساب واحد → ظهور نفس السهم في شخصيتين أو أكتر معناه تقارب التحليل. دي الأسهم اللي لازم نركز عليها كعصابة.
            </p>
          </CardHeader>
          <CardContent className="p-3">
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {focusTickerList.map((tk) => {
                const info = focusTickers[tk];
                return (
                  <button
                    key={`focus-${tk}`}
                    onClick={() => setSearchQuery(tk)}
                    className="px-2.5 py-1 text-xs font-bold rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors flex items-center gap-1"
                    title="اضغط للفلترة على هذا السهم"
                  >
                    <span className="font-mono">{tk}</span>
                    <span className="text-[9px] opacity-70">×{info.count}</span>
                    <span className="flex gap-0.5">
                      {info.personas.map((p) => (
                        <span key={p} className="text-[9px]">{PERSONA_CONFIG[p as keyof typeof PERSONA_CONFIG]?.emoji}</span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── P0-v17: Cumulative Profit Movement Chart ─── */}
      {cumulativeProfitData.length > 0 && (
        <Card className="border border-border/80 shadow-md rounded-2xl overflow-hidden bg-card">
          <CardHeader className="p-4 border-b border-border/60">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-emerald-500" />
                <CardTitle className="text-base font-black">حركة الأرباح التراكمية عبر الزمن</CardTitle>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">إجمالي الصفقات المقفولة:</span>
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-mono font-black">
                  {cumulativeProfitData.length} صفقة
                </Badge>
                <Badge className={cn(
                  'font-mono font-black',
                  cumulativeProfitData[cumulativeProfitData.length - 1]?.cumulative >= 0
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                )}>
                  تراكمي: {cumulativeProfitData[cumulativeProfitData.length - 1]?.cumulative >= 0 ? '+' : ''}{cumulativeProfitData[cumulativeProfitData.length - 1]?.cumulative.toFixed(2)}%
                </Badge>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              الرسم بيوضح تراكم العائد % مع كل صفقة مقفولة (مرتبة حسب تاريخ التنفيذ). بـ يساعدك تشوف اتجاه الأرباح على المنصة عبر الفترات الزمنية.
            </p>
          </CardHeader>
          <CardContent className="p-2 md:p-4">
            <div className="h-56 md:h-64 w-full dir-ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cumulativeProfitData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" minTickGap={20} angle={-20} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={48} tickFormatter={(v) => `${v}%`} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" opacity={0.5} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, direction: 'ltr' }}
                    labelStyle={{ fontWeight: 700, marginBottom: 4 }}
                    formatter={(value: any, name: any) => [`${Number(value).toFixed(2)}%`, name === 'cumulative' ? 'التراكمي' : 'الصفقة']}
                  />
                  <Bar dataKey="cumulative" name="cumulative" radius={[4, 4, 0, 0]}>
                    {cumulativeProfitData.map((entry, idx) => (
                      <RechartsCell key={`cell-${idx}`} fill={entry.cumulative >= 0 ? '#10b981' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── 4. Trade Proof Table & Multi-Filter Toolbar ─── */}
      <Card className="border border-border/80 shadow-md rounded-2xl overflow-hidden bg-card">
        <CardHeader className="p-4 border-b border-border/60 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-emerald-500" />
              <CardTitle className="text-base font-black">
                جدول صفقات التوقعات الموثقة ({filteredPredictions.length} صفقة)
              </CardTitle>
            </div>

            {/* Outcome Filter Buttons */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {(['ALL', 'WIN', 'LOSS', 'PENDING', 'EXPIRED'] as const).map((outcomeKey) => (
                <button
                  key={`outcome-${outcomeKey}`}
                  onClick={() => setSelectedOutcome(outcomeKey)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-bold rounded-lg transition-colors whitespace-nowrap border',
                    selectedOutcome === outcomeKey
                      ? 'bg-foreground text-background border-foreground shadow-xs'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                  )}
                >
                  {outcomeKey === 'ALL' && 'الكل'}
                  {outcomeKey === 'WIN' && '🎯 الناجحة (WIN)'}
                  {outcomeKey === 'LOSS' && '🛑 الخاسرة (LOSS)'}
                  {outcomeKey === 'PENDING' && '⏳ المعلقة (PENDING)'}
                  {outcomeKey === 'EXPIRED' && '⏰ المنتهية (EXPIRED)'}
                </button>
              ))}
            </div>
          </div>

          {/* Sub Toolbar: Search Bar + Sorting
              FEAT5-PERSONA-REMOVAL: Persona Quick Filter removed — production
              engine is V40.2 balanced-only; client should not see persona
              switcher buttons. The `selectedPersona` state is still controlled
              by clicking the balanced breakdown card above (toggles between
              'all' and 'balanced' for filtering historical predictions). */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            {/* Search & Sort Controls */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {/* Search Bar */}
              <div className="relative flex-1 sm:w-56">
                <Search className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث برمز السهم أو الاسم..."
                  className="pr-8 h-8 text-xs bg-background border-border"
                  dir="rtl"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute left-2 top-2 p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Sort Selector */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="h-8 text-xs bg-background border border-border rounded-lg px-2 font-bold text-foreground"
              >
                <option value="return">الأعلى أرباحاً (%)</option>
                <option value="date">الأحدث تاريخاً</option>
                <option value="target">الأقرب للهدف</option>
                <option value="days">أيام التداول</option>
              </select>
            </div>
          </div>

          {/* P0-v17: فلتر تاريخ الدخول (client-side) */}
          <div className="flex items-center gap-1.5 pt-2 overflow-x-auto no-scrollbar">
            <span className="text-xs text-muted-foreground font-bold ml-1 flex-shrink-0">تاريخ الدخول:</span>
            {([
              { v: 'all', l: 'الكل' },
              { v: '7d', l: 'آخر أسبوع' },
              { v: '30d', l: 'آخر شهر' },
              { v: '90d', l: 'آخر 3 شهور' },
            ] as const).map((opt) => (
              <button
                key={`entry-period-${opt.v}`}
                onClick={() => setEntryPeriod(opt.v)}
                className={cn(
                  'px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-all whitespace-nowrap',
                  entryPeriod === opt.v
                    ? 'bg-amber-500/15 border-amber-500 text-amber-600 dark:text-amber-400 font-extrabold'
                    : 'bg-background border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {opt.l}
              </button>
            ))}
            {entryPeriod !== 'all' && (
              <button
                onClick={() => setEntryPeriod('all')}
                className="px-1.5 py-1 text-[11px] text-muted-foreground hover:text-rose-500"
                title="إلغاء الفلتر"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-8 space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : error && !data ? (
            // RL-FIX-16-FE: عرض خطأ واضح بدل "لا توجد صفقات" المضللة.
            // قبل كده، لما Python backend كان مش شغال، كان بيظهر رسالة "لا توجد صفقات
            // تطابق خيارات الفلترة" — المستخدم يفتكر إن الفلاتر غلط. دلوقتي بنوضّح
            // إن المشكلة في الاتصال بالخادم، مش في الفلاتر.
            <div className="p-12 text-center space-y-3 text-muted-foreground">
              <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />
              <p className="font-bold text-sm text-foreground">تعذّر تحميل بيانات التوقعات</p>
              <p className="text-xs">{error}</p>
              <p className="text-[11px] text-muted-foreground/70">
                تعذّر تحميل البيانات، اضغط تحديث للمحاولة مرة أخرى
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchData}
                disabled={refreshing}
                className="mt-2 h-8 text-xs font-bold gap-1"
              >
                {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                إعادة المحاولة
              </Button>
            </div>
          ) : filteredPredictions.length === 0 ? (
            <div className="p-12 text-center space-y-2 text-muted-foreground">
              <Target className="w-10 h-10 mx-auto opacity-30" />
              <p className="font-bold text-sm">لا توجد صفقات تطابق خيارات الفلترة المحددة</p>
              <p className="text-xs">جرب تغيير الفترة الزمنية أو تحديد شخصية أخرى</p>
            </div>
          ) : (
            <>
              {/* Mobile Card View (on small screens) */}
              <div className="block sm:hidden divide-y divide-border/40">
                {filteredPredictions.map((pred, idx) => {
                  const ret = formatReturnPct(pred.returnPct);
                  const isClosed = pred.outcome !== 'PENDING';
                  const lastPrice = isClosed ? pred.exitPrice : pred.currentPrice;
                  const personaCfg = PERSONA_CONFIG[pred.persona];
                  // RL-FIX-6: live preview + second target + execution date
                  const liveOutcomeKey = pred.liveOutcome ?? 'PENDING';
                  const showLivePreview =
                    !isClosed && pred.liveOutcome != null && pred.liveOutcome !== 'PENDING';
                  const hasTarget2 =
                    pred.targetPrice2 != null && Number(pred.targetPrice2) > 0;
                  const executionDate = pred.executionDate || pred.closedAt;
                  // FIX-5B: highest/lowest + maxProfit/maxLoss direction-aware + trailing_profit + live_return
                  const highest = Number(pred.highestPriceReached ?? pred.highest_price_reached ?? 0);
                  const lowest = Number(pred.lowestPriceReached ?? pred.lowest_price_reached ?? 0);
                  const maxProfitPct = computeMaxProfitPct(pred);
                  const maxLossPct = computeMaxLossPct(pred);
                  const trailingProfit = isTrailingProfit(pred);
                  const liveReturnPct = computeLiveReturnPct(pred);
                  const showLiveReturnBadge =
                    !isClosed && liveReturnPct != null && highest > 0;

                  return (
                    <div
                      key={`mob-pred-${pred.ticker}-${idx}`}
                      onClick={() => setSelectedProofTrade(pred)}
                      className="p-3 hover:bg-muted/40 cursor-pointer space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-black text-sm">{pred.ticker}</span>
                          <Badge variant="outline" className={cn('text-[9px] py-0 px-1.5', personaCfg.badgeBg)}>
                            {personaCfg.emoji} {personaCfg.nameAr}
                          </Badge>
                          {focusTickers[pred.ticker] && (
                            <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[9px] py-0 px-1.5 font-bold" title="مكرر في عدة شخصيات — إشارة قوية">
                              🎯 تركيز ×{focusTickers[pred.ticker].count}
                            </Badge>
                          )}
                          {pred.morning_bell && (
                            <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 text-[9px] py-0 px-1.5 font-bold" title="جرس الصباح — أعلى ثقة وربحية متوقعة">
                              🔔 جرس الصباح
                            </Badge>
                          )}
                          {pred.evidence_count != null && pred.evidence_count > 0 && (
                            <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-bold" title="عدد الأدلة المتوافقة (V40)">
                              ✅ {pred.evidence_count}/6
                            </Badge>
                          )}
                        </div>
                        {/* FIX-5B: TRAILING_PROFIT badge بـ لون زمردي مميز عن WIN العادي */}
                        {trailingProfit ? (
                          <Badge className={cn('text-[10px]', TRAILING_PROFIT_CONFIG.badge)}>
                            {TRAILING_PROFIT_CONFIG.label}
                          </Badge>
                        ) : (
                          <Badge className={cn('text-[10px]', OUTCOME_CONFIG[pred.outcome].badge)}>
                            {OUTCOME_CONFIG[pred.outcome].label}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{pred.nameAr || pred.ticker}</span>
                        <span className="font-mono font-bold text-foreground">
                          {formatDateShort(pred.entryDate)}
                        </span>
                      </div>

                      {/* RL-FIX-6: 4-column grid (entry / target1 / target2 / stop) */}
                      <div className="grid grid-cols-4 gap-1.5 bg-muted/30 p-2 rounded-lg text-[11px] font-mono">
                        <div>
                          <div className="text-[9px] text-muted-foreground">الدخول</div>
                          <div className="font-bold">{fmtPrice(pred.entryPrice)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-muted-foreground">المستهدف ١</div>
                          <div className="font-bold text-emerald-600 dark:text-emerald-400">{fmtPrice(pred.targetPrice)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-muted-foreground">المستهدف ٢</div>
                          {hasTarget2 ? (
                            <div className="font-bold text-teal-600 dark:text-teal-400">{fmtPrice(pred.targetPrice2)}</div>
                          ) : (
                            <div className="font-bold text-muted-foreground">—</div>
                          )}
                        </div>
                        <div>
                          <div className="text-[9px] text-muted-foreground">الوقف</div>
                          <div className="font-bold text-rose-600 dark:text-rose-400">{fmtPrice(pred.stopLoss)}</div>
                        </div>
                      </div>

                      {/* RL-FIX-6: صف تواريخ التوقع + التنفيذ */}
                      <div className="grid grid-cols-2 gap-2 bg-muted/20 p-2 rounded-lg text-[10px] font-mono">
                        <div>
                          <div className="text-[9px] text-muted-foreground">تاريخ التوقع</div>
                          <div className="font-bold text-foreground">{formatDateShort(pred.entryDate)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-muted-foreground">تاريخ التنفيذ</div>
                          <div className="font-bold text-foreground">
                            {executionDate ? formatDateShort(executionDate) : 'معلّقة'}
                          </div>
                        </div>
                      </div>

                      {/* RL-FIX-6: مدة التداول + السعر الحالي */}
                      <div className="grid grid-cols-2 gap-2 bg-muted/20 p-2 rounded-lg text-[10px] font-mono">
                        <div>
                          <div className="text-[9px] text-muted-foreground">مدة التداول</div>
                          <div className="font-bold text-foreground">
                            {(() => {
                              const d = computeHoldingDays(pred.entryDate, pred.closedAt);
                              return d != null ? `${d} يوم` : '—';
                            })()}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] text-muted-foreground">السعر الحالي/الإغلاق</div>
                          <div className="font-bold text-foreground">{fmtPrice(lastPrice)}</div>
                        </div>
                      </div>

                      {/* RL-FIX-6: الحالة الحية (معاينة) — تظهر فقط للصفقات المعلّقة الفعالة */}
                      {showLivePreview && !showLiveReturnBadge && (
                        <div className="flex items-center justify-between gap-2 bg-background/60 border border-dashed border-border rounded-lg p-2 text-[10px]">
                          <span className="text-muted-foreground font-bold">الحالة الحية:</span>
                          <Badge
                            className={cn('text-[9px] font-bold', LIVE_OUTCOME_CONFIG[liveOutcomeKey].badge)}
                            title="الحالة الحية بناءً على السعر اللحظي (معاينة غير رسمية)"
                          >
                            {LIVE_OUTCOME_CONFIG[liveOutcomeKey].label}
                          </Badge>
                        </div>
                      )}

                      {/* FIX-5B: _live_return للـ PENDING — اعرض badge بـ النسبة المئوية */}
                      {showLiveReturnBadge && (
                        <div className="flex items-center justify-between gap-2 bg-amber-500/5 border border-dashed border-amber-500/40 rounded-lg p-2 text-[10px]">
                          <span className="text-muted-foreground font-bold">العائد اللحظي (معاينة):</span>
                          <Badge
                            className={cn(
                              'text-[9px] font-bold whitespace-nowrap',
                              liveReturnPct != null && liveReturnPct >= 0
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                                : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40'
                            )}
                            title="العائد اللحظي من السعر الحالي (معاينة غير رسمية — لم تُقفل الصفقة بعد)"
                          >
                            معاينة: {liveReturnPct != null
                              ? `${liveReturnPct >= 0 ? '+' : ''}${liveReturnPct.toFixed(2)}%`
                              : '—'}
                          </Badge>
                        </div>
                      )}

                      {/* FIX-5B: highest/lowest + maxProfit/maxLoss — صف مختصر للموبايل */}
                      {(highest > 0 || lowest > 0) && (
                        <div className="grid grid-cols-2 gap-2 bg-muted/20 p-2 rounded-lg text-[10px] font-mono">
                          <div>
                            <div className="text-[9px] text-muted-foreground">أعلى سعر 📈</div>
                            <div className="font-bold text-emerald-600 dark:text-emerald-400">
                              {highest > 0 ? fmtPrice(highest) : '—'}
                              {maxProfitPct != null && (
                                <span className="text-[9px] mr-1">
                                  ({maxProfitPct >= 0 ? '+' : ''}{maxProfitPct.toFixed(1)}%)
                                </span>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-[9px] text-muted-foreground">أقل سعر 📉</div>
                            <div className="font-bold text-rose-600 dark:text-rose-400">
                              {lowest > 0 ? fmtPrice(lowest) : '—'}
                              {maxLossPct != null && (
                                <span className="text-[9px] mr-1">
                                  ({maxLossPct >= 0 ? '+' : ''}{maxLossPct.toFixed(1)}%)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1 text-xs">
                        <span className={cn('font-mono font-black', ret.color)}>
                          العائد: {ret.text}
                        </span>
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                          عرض بطاقة الإثبات 🔍
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table View — UnifiedTable (on sm and up) */}
              <div className="hidden sm:block">
                <UnifiedTable<LivePrediction>
                  columns={desktopTableColumns}
                  data={filteredPredictions}
                  keyField="ticker"
                  maxHeight="max-h-[70vh]"
                  emptyTextAr="مفيش صفقات تطابق الفلاتر الحالية"
                  onRowClick={(p) => setSelectedProofTrade(p)}
                  rowClassName={() => 'hover:bg-emerald-500/5 group cursor-pointer'}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── 5. Trade Proof Modal Dialog ─── */}
      <Dialog open={!!selectedProofTrade} onOpenChange={(open) => !open && setSelectedProofTrade(null)}>
        <DialogContent className="max-w-lg p-0 bg-popover border-border shadow-2xl rounded-2xl overflow-hidden dir-rtl">
          {selectedProofTrade && (
            <div ref={proofCardRef} className="p-6 bg-card space-y-4 relative">
              <DialogHeader className="p-0 border-b border-border/60 pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-bold text-xs gap-1">
                    <Shield className="w-3.5 h-3.5" />
                    بطاقة إثبات التوقع الموثقة
                  </Badge>
                  <Badge className={cn('text-xs font-bold', OUTCOME_CONFIG[selectedProofTrade.outcome].badge)}>
                    {OUTCOME_CONFIG[selectedProofTrade.outcome].label}
                  </Badge>
                </div>

                <DialogTitle className="text-xl font-black text-foreground mt-2 flex items-center justify-between">
                  <span>{selectedProofTrade.ticker} ({selectedProofTrade.nameAr || selectedProofTrade.ticker})</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 text-lg">
                    {formatReturnPct(selectedProofTrade.returnPct).text}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  توقع شخصي {PERSONA_CONFIG[selectedProofTrade.persona].emoji} {PERSONA_CONFIG[selectedProofTrade.persona].nameAr} — صدرت بتاريخ {formatDateShort(selectedProofTrade.entryDate)} — التنفيذ: {(selectedProofTrade.executionDate || selectedProofTrade.closedAt) ? formatDateShort(selectedProofTrade.executionDate || selectedProofTrade.closedAt) : 'معلّقة'}
                </DialogDescription>
              </DialogHeader>

              {/* RL-FIX-6: Trade Proof Numbers Grid — 3x3 grid includes second target + dates */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-muted/30 border border-border/60 rounded-xl font-mono text-xs">
                <div>
                  <span className="text-muted-foreground text-[10px] block">سعر الدخول المعتمد:</span>
                  <strong className="text-foreground text-sm font-bold">{fmtPrice(selectedProofTrade.entryPrice)} ج.م</strong>
                </div>
                <div>
                  <span className="text-muted-foreground text-[10px] block">سعر الإغلاق / الحالي:</span>
                  <strong className="text-foreground text-sm font-bold">{fmtPrice(selectedProofTrade.exitPrice || selectedProofTrade.currentPrice)} ج.م</strong>
                </div>
                <div>
                  <span className="text-muted-foreground text-[10px] block">المستهدف الأول (Target 1):</span>
                  <strong className="text-emerald-600 dark:text-emerald-400 text-sm font-bold">🎯 {fmtPrice(selectedProofTrade.targetPrice)} ج.م</strong>
                </div>
                <div>
                  <span className="text-muted-foreground text-[10px] block">المستهدف الثاني (Target 2):</span>
                  {(selectedProofTrade.targetPrice2 != null && Number(selectedProofTrade.targetPrice2) > 0) ? (
                    <strong className="text-teal-600 dark:text-teal-400 text-sm font-bold">🎯 {fmtPrice(selectedProofTrade.targetPrice2)} ج.م</strong>
                  ) : (
                    <strong className="text-muted-foreground text-sm font-bold">—</strong>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground text-[10px] block">وقف الخسارة (Stop):</span>
                  <strong className="text-rose-600 dark:text-rose-400 text-sm font-bold">🛑 {fmtPrice(selectedProofTrade.stopLoss)} ج.م</strong>
                </div>
                <div>
                  <span className="text-muted-foreground text-[10px] block">تاريخ التوقع:</span>
                  <strong className="text-foreground text-sm font-bold">{formatDateShort(selectedProofTrade.entryDate)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground text-[10px] block">تاريخ التنفيذ:</span>
                  <strong className="text-foreground text-sm font-bold">
                    {(selectedProofTrade.executionDate || selectedProofTrade.closedAt)
                      ? formatDateShort(selectedProofTrade.executionDate || selectedProofTrade.closedAt)
                      : 'معلّقة ⏳'}
                  </strong>
                </div>
              </div>

              {/* Reason / Proof Rationale */}
              <div className="space-y-1 text-xs">
                <span className="font-bold text-foreground">دليل وتحليل التوقع:</span>
                <p className="p-3 bg-background border border-border/60 rounded-xl text-muted-foreground text-xs leading-relaxed">
                  {selectedProofTrade.reason || 'تم إغلاق الصفقة بناءً على تحقق الهدف الفني وحساب حركة السعر المباشرة.'}
                </p>
              </div>

              {/* Footer Proof Metadata */}
              <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-border/40">
                <span>تاريخ التوثيق: {new Date().toLocaleDateString('ar-EG')}</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">M2Y INVESTMENT VERIFIED</span>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 print:hidden">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportProofImage}
                  disabled={downloadingProof}
                  className="h-8 text-xs font-bold border-emerald-500/40 text-emerald-600 dark:text-emerald-400 gap-1"
                >
                  {downloadingProof ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  تحميل بطاقة الإثبات 📸
                </Button>
                <DialogClose asChild>
                  <Button variant="secondary" size="sm" className="h-8 text-xs font-bold">
                    إغلاق
                  </Button>
                </DialogClose>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

export default PredictionTrackingDashboard;
