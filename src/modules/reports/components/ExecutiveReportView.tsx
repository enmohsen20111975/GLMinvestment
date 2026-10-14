'use client';

// MAESTRO-DISABLED — use unified API instead (Task PHASE-2-MAESTRO-KILL, Rule 73)
// This component fetches from /api/predictions/honest-tracking/* and
// /api/predictions/honest-tracking/missed-opportunities — NOT maestro endpoints.
// The remaining `maestroScore` / `maestro_score` references are property names
// mapping to the `maestro_score` DB column (stored_analyses / predictions tables).
// They are NOT maestro-engine invocations and are intentionally left intact
// per Rule 4 (NO-DELETION) and the conservative clause of PHASE-2-MAESTRO-UI.

/**
 * ExecutiveReportView — ملخص أداء التوقعات
 * ==============================================================================
 * يعرض ملخصاً مبسطاً لأداء التوقعات خلال الفترة المحددة.
 *
 * مبادئ التصميم (v3):
 *  1. لغة محايدة وبسيطة — بدون عناوين فخمة أو ادعاءات. مجرد أرقام ورسوم.
 *  2. نظام لوني موحد: ذهبي (amber) للتمييز + أخضر (emerald) للربح + وردي (rose) للخسارة.
 *  3. فلترة فعلية: الفترة الزمنية بتفلتر البيانات client-side بشكل صحيح عشان العميل
 *     يشوف تغيير حقيقي لما يغير الفترة.
 *  4. رسوم بيانية جمالية: Donut للفوز/الخسارة + Area للأرباح التراكمية + Bar شهري + Radar للشخصيات.
 *  5. تجاوب كامل: 1 col على الموبايل، 2 على التابلت، 3-4 على الديسكتوب.
 *  6. تصدير PNG عالي الدقة.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Award, Zap, Shield, Flame, Scale, TrendingUp, TrendingDown,
  Clock, Download, Sparkles, Layers, Gauge,
  CheckCircle2, CheckCircle, RefreshCw, ChevronLeft, BarChart3, PieChart as PieIcon,
  AlertTriangle, Filter, Search, X, Database,
  // REPORT-REDESIGN: أيقونات احترافية للـ branding + اختيار السوق + جدول التوقعات الفائزة.
  Landmark, CalendarRange, HandCoins, Building2,
} from 'lucide-react';
import { cn, fmtPrice } from '@/lib/utils';
import { toPng } from 'html-to-image';
import { toast } from 'sonner';
// REPORT-REDESIGN: Select UI لإضافة dropdown اختيار السوق داخل التقرير.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// REPORT-REDESIGN: MARKET_NAMES_AR + MarketType لعرض أسماء الأسواق بالعربية + typing قوي.
import { MARKET_NAMES_AR, type MarketType } from '@/lib/store';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine,
  BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  Legend,
} from 'recharts';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';

// RL-FIX-7: 999 = YTD (من أول السنة) — من 1 يناير للسنة الحالية
export type ReportTimeframe = 1 | 2 | 7 | 14 | 30 | 60 | 90 | 180 | 365 | 999 | 0;

type FilterPersona = 'all' | 'gambler' | 'balanced' | 'conservative';
type FilterOutcome = 'ALL' | 'WIN' | 'LOSS' | 'PENDING' | 'EXPIRED';
type FilterSignal = 'all' | 'BUY' | 'SELL';

interface LivePredictionItem {
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
  // FIX-5C: exit_type — لتمييز TRAILING_PROFIT (💰 خرج بربح) عن WIN العادي.
  // الـ backend بـ يـ return exit_type كـ lowercase string (e.g. 'trailing_profit',
  // 'target_hit', 'stop_loss', 'expired'). الـ UI بـ يستخدمه لعرض badge منفصل.
  exitType?: string | null;
  exit_type?: string | null;
  // FIX-5C: highest/lowest + target_price_2 — لعرضها في الـ highlights إن لزم.
  highestPriceReached?: number | null;
  lowestPriceReached?: number | null;
  highest_price_reached?: number | null;
  lowest_price_reached?: number | null;
  targetPrice2?: number | null;
  target_price_2?: number | null;
}

interface PersonaStatsItem {
  total: number;
  wins: number;
  losses: number;
  pending: number;
  settled: number;
  // RULE20-P3: winRate must come from Python (Rule 20). null when Python stat missing (Rule 27).
  winRate: number | null;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  closedCount: number;
}

interface LiveTrackingResponse {
  success: boolean;
  predictions: Record<'gambler' | 'balanced' | 'conservative', LivePredictionItem[]>;
  stats: PersonaStatsItem;
  statsByPersona: Record<'gambler' | 'balanced' | 'conservative', PersonaStatsItem>;
  last_updated: string;
  market?: string;
  daysWindow?: number;
  source?: string;
}

// RL-FIX-8: ناتج الـ endpoint /api/predictions/honest-tracking/list
// ده الـ endpoint اللي بيرجع بيانات تاريخية كاملة (مش محصور في آخر يوم بس).
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
  status: string; // PENDING | TARGET_HIT | STOPPED | PROFIT_TAKEN | EXPIRED | TRAILING_PROFIT
  outcome?: string; // RULE20-P3: canonical outcome field from Python (TS fix — used at line ~354)
  final_price?: number | null;
  profit_loss_percent?: number | null;
  actual_return?: number | null;
  hit_target?: boolean;
  hit_stop_loss?: boolean;
  holding_days?: number;
  evaluation_date?: string | null; // outcome_date
  persona?: string | null;
  created_at?: string;
  // FIX-5C: highest/lowest + exit_type + target_price_2 — الـ backend بـ يـ returnهم
  // من /api/predictions/honest-tracking/list (FIX-5D).
  highest_price_reached?: number | null;
  lowest_price_reached?: number | null;
  exit_type?: string | null;
  target_price_2?: number | null;
}

interface HonestListResponse {
  success: boolean;
  predictions: HonestPredictionItem[];
  pagination?: { total: number; limit: number; offset: number; has_more: boolean };
  source?: string;
}

// ── الفرص الضائعة (missed opportunities) ──
// ناتج الـ endpoint: /api/predictions/honest-tracking/missed-opportunities
interface MissedOpportunityItem {
  id: number;
  ticker: string;
  name: string | null;
  signal: string;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  prediction_date: string;
  current_price: number;
  pct_change: number;
  persona: string | null;
  master_score: number | null;
}

interface MissedOpportunitiesResponse {
  success?: boolean;
  missed_bulls?: MissedOpportunityItem[];
  false_positives?: MissedOpportunityItem[];
  correct_buys?: MissedOpportunityItem[];
  correct_sells?: MissedOpportunityItem[];
}

const TIMEFRAME_OPTIONS: Array<{ value: ReportTimeframe; label: string; badge: string }> = [
  { value: 1, label: 'اليوم', badge: '1d' },
  { value: 2, label: 'أمس', badge: '2d' },
  { value: 7, label: '7 أيام', badge: '7d' },
  { value: 14, label: '14 يوم', badge: '14d' },
  { value: 30, label: '30 يوم', badge: '30d' },
  { value: 60, label: '60 يوم', badge: '60d' },
  { value: 90, label: '0.25 سنة (ربع سنوي)', badge: '0.25y' },
  { value: 180, label: '0.5 سنة (نصف سنوي)', badge: '0.5y' },
  // RL-FIX-7: YTD — من أول السنة (1 يناير للسنة الحالية)
  { value: 999, label: 'من أول السنة', badge: 'YTD' },
  { value: 365, label: 'سنة كاملة (1y)', badge: '1y' },
  { value: 0, label: 'كافة الأوقات', badge: 'All' },
];

// RL-FIX-7: خيارات فلتر الشخصية
const PERSONA_FILTER_OPTIONS: Array<{ value: FilterPersona; label: string; emoji?: string }> = [
  { value: 'all', label: 'الكل' },
  // { value: 'gambler', label: 'المضارب', emoji: '🔥' },  // معطل
  { value: 'balanced', label: 'المتوازن', emoji: '⚖️' },
  { value: 'conservative', label: 'المستثمر', emoji: '🛡️' },
];

// RL-FIX-7: خيارات فلتر النتيجة
const OUTCOME_FILTER_OPTIONS: Array<{ value: FilterOutcome; label: string; color: string }> = [
  { value: 'ALL', label: 'الكل', color: 'text-slate-300' },
  { value: 'WIN', label: 'رابحة', color: 'text-emerald-400' },
  { value: 'LOSS', label: 'خاسرة', color: 'text-rose-400' },
  { value: 'PENDING', label: 'معلقة', color: 'text-amber-400' },
  { value: 'EXPIRED', label: 'منتهية', color: 'text-slate-400' },
];

// RL-FIX-7: خيارات فلتر الإشارة
const SIGNAL_FILTER_OPTIONS: Array<{ value: FilterSignal; label: string }> = [
  { value: 'all', label: 'كل الإشارات' },
  { value: 'BUY', label: 'شراء' },
  { value: 'SELL', label: 'بيع' },
];

// REPORT-REDESIGN: خيارات السوق — يتيح للمستثمر تبديل التقرير بين الأسواق المدعومة
// بدون مغادرة صفحة التقرير. كل تبديل بـ يعيد fetch البيانات من نفس الـ endpoint
// الكانوني (/api/predictions/honest-tracking/list) — لا fabrication.
const MARKET_FILTER_OPTIONS: Array<{ value: MarketType; label: string; emoji: string }> = [
  { value: 'EGX', label: 'البورصة المصرية', emoji: '🇪🇬' },
  { value: 'TADAWUL', label: 'السوق السعودي', emoji: '🇸🇦' },
  { value: 'KSE', label: 'بورصة الكويت', emoji: '🇰🇼' },
  { value: 'QSE', label: 'بورصة قطر', emoji: '🇶🇦' },
  { value: 'US', label: 'البورصة الأمريكية', emoji: '🇺🇸' },
  { value: 'CRYPTO', label: 'العملات الرقمية', emoji: '₿' },
];

// REPORT-REDESIGN: اسم المنصة الرسمي + شعار نصي مختصر — يظهر في الـ header
// وفي الـ PNG المُصدَّر. لو المنصة عندها شعار صورة، يُستبدل placeholder بالمسار.
const PLATFORM_NAME = 'دليل الاستثمار';
const PLATFORM_TAGLINE = 'تقرير الأداء الاستثماري';

// RL-FIX-10: وضع الجودة — يتحكم في هل نعرض كل التوقعات ولا أفضلها بس
// 'top_picks' = أفضل 5 توقعات/يوم لكل شخصية (الافتراضي — منطقي للعميل)
// 'all' = كل التوقعات (للتحليل الشامل)
type QualityMode = 'top_picks' | 'all';
const QUALITY_MODE_OPTIONS: Array<{ value: QualityMode; label: string; desc: string; emoji: string }> = [
  { value: 'top_picks', label: 'أفضل التوقعات', desc: 'أقصى 5 توقعات/يوم لكل شخصية', emoji: '⭐' },
  { value: 'all', label: 'كل التوقعات', desc: 'بدون فلترة (للتحليل الشامل)', emoji: '📊' },
];

// RL-FIX-10: خيارات الحد الأدنى للثقة (master_score)
const CONFIDENCE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 50, label: '50+ (متوسط)' },
  { value: 60, label: '60+ (جيد)' },
  { value: 70, label: '70+ (قوي)' },
  { value: 80, label: '80+ (قوي جداً)' },
];

export interface ExecutiveReportViewProps {
  market?: MarketType;
  initialDays?: ReportTimeframe;
  onClose?: () => void;
  className?: string;
}

export function ExecutiveReportView({
  market = 'EGX',
  initialDays = 999, // RL-FIX-7: افتراضي = من أول السنة (YTD)
  onClose,
  className
}: ExecutiveReportViewProps) {
  const [days, setDays] = useState<ReportTimeframe>(initialDays);
  // REPORT-REDESIGN: حالة السوق المحلية — تتيح للمستثمر تبديل السوق من داخل التقرير.
  // تُهيَّأ من الـ prop، لكن بعدها مستقلة (لا تتطلب إعادة mount عند تغيير السوق).
  // كل تغيير بـ يعيد تشغيل fetchData + fetchMissedOpps تلقائياً عبر useCallback deps.
  const [selectedMarket, setSelectedMarket] = useState<MarketType>(market);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<LiveTrackingResponse | null>(null);
  const [exporting, setExporting] = useState(false);
  // ── الفرص الضائعة والتحليل البعدي ──
  const [missedOpps, setMissedOpps] = useState<MissedOpportunitiesResponse | null>(null);
  const [missedOppsLoading, setMissedOppsLoading] = useState(false);

  // RL-FIX-7: فلاتر متقدمة (شخصية / نتيجة / إشارة / بحث)
  const [filterPersona, setFilterPersona] = useState<FilterPersona>('all');
  const [filterOutcome, setFilterOutcome] = useState<FilterOutcome>('ALL');
  const [filterSignal, setFilterSignal] = useState<FilterSignal>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // RL-FIX-10: فلترة الجودة — افتراضي 'top_picks' (أفضل 5/يوم) + minConfidence 70
  // ده بيخلي الملخص يعرض أرقام منطقية بدل 310 توقع في أسبوع.
  const [qualityMode, setQualityMode] = useState<QualityMode>('top_picks');
  const [minConfidence, setMinConfidence] = useState<number>(70);

  const reportContainerRef = useRef<HTMLDivElement>(null);

  // RL-FIX-8: بنجيب البيانات من /api/predictions/honest-tracking/list بدل
  // /api/stored-analysis/live-tracking. السبب:
  //   - live-tracking بيرجع آخر 200 سطر لكل شخصية (كلها من نفس اليوم) → الأرقام
  //     ما بتتغيرش مع تغيير الفترة الزمنية.
  //   - honest-tracking/list بيرجع بيانات تاريخية كاملة (من 1/1/2026 للآن) مع
  //     توزيع تواريخ صحيح → الفلترة الزمنية تشتغل فعلاً.
  // بنحوّل الـ response للـ format اللي الـ component بيتوقعه (per-persona buckets).
  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      // RL-FIX-10: نمرر qualityMode + minScore + topPerDay للـ API
      // علشان يفلتر في الـ SQL نفسه (أسرع + أدق).
      const params = new URLSearchParams({
        market: selectedMarket,
        limit: '2000',
        sortBy: 'prediction_date',
        sortOrder: 'DESC',
        qualityMode,
        minScore: String(minConfidence),
        topPerDay: qualityMode === 'top_picks' ? '5' : '0',
      });
      const res = await fetch(
        `/api/predictions/honest-tracking/list?${params.toString()}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const json: HonestListResponse = await res.json();
        if (json.success && json.predictions) {
          // حوّل كل prediction للـ format المتوقع + صنّفهم per-persona
          const buckets: Record<'gambler' | 'balanced' | 'conservative', LivePredictionItem[]> = {
            gambler: [],
            balanced: [],
            conservative: [],
          };
          for (const p of json.predictions) {
            // حدد الـ persona
            let persona: 'gambler' | 'balanced' | 'conservative' = 'balanced';
            const rawPersona = (p.persona || '').toLowerCase().trim();
            if (rawPersona === 'gambler') persona = 'gambler';
            else if (rawPersona === 'investor' || rawPersona === 'conservative') persona = 'conservative';
            else if (rawPersona === 'balanced') persona = 'balanced';

            // حدد الـ outcome
            // RL-FIX-16 (HONEST-WIN): WIN = actual_return > 0 (يتطابق مع Python API).
            // قبل الإصلاح: TARGET_HIT → WIN دائماً، حتى لو actual_return <= 0.
            // ده سبب 103 "false wins" في الإحصائيات. دلوقتي actual_return هو الفاصل.
            //
            // RULE67-CANONICAL-FIX (2026-10-12 — LEAGUE-DEDUP-FIX):
            // قبل كده: الكود كان بـ يعتمد على p.status (field غير موجود في Python response)
            // → كل branches ما بتيجيش → fallback `else → LOSS` بيصنّف PENDING trades كـ LOSS.
            // ده سبب الـ winRate=17.1% الكارثي (PENDING trades اتحسبت كخسائر).
            // الحل: استخدم p.outcome (الـ canonical field من Python) بدل p.status.
            // Rule 67 (CALCULATION-CANONICAL): Node بيـ re-classify outcome = خرق.
            // لو p.outcome موجود → استخدمه مباشرةً. لو مش موجود → fallback على returnPct.
            let outcome: 'WIN' | 'LOSS' | 'EXPIRED' | 'PENDING' = 'PENDING';
            const pyOutcome = (p.outcome || '').toUpperCase();
            const status = (p.status || '').toUpperCase();
            const returnPct = p.actual_return != null
              ? Number(p.actual_return)
              : (p.profit_loss_percent != null ? Number(p.profit_loss_percent) : 0);

            // Rule 67: الأولوية لـ p.outcome (canonical من Python)
            if (pyOutcome === 'WIN' || pyOutcome === 'TARGET_HIT' || pyOutcome === 'TRAILING_PROFIT') {
              outcome = 'WIN';
            } else if (pyOutcome === 'LOSS' || pyOutcome === 'STOP_HIT' || pyOutcome === 'STOPPED') {
              outcome = 'LOSS';
            } else if (pyOutcome === 'EXPIRED') {
              outcome = 'EXPIRED';
            } else if (pyOutcome === 'PENDING' || (pyOutcome === '' && status === 'PENDING')) {
              outcome = 'PENDING';
            } else if (pyOutcome === '' && status === '') {
              // مفيش outcome field من Python نهائياً → fallback على returnPct
              // ده السلوك الصحيح: PENDING لسه ما اتقفلش
              outcome = 'PENDING';
            } else if (returnPct > 0) {
              outcome = 'WIN';
            } else if (returnPct < 0) {
              outcome = 'LOSS';
            } else {
              // returnPct = 0 + status مقفل بدون outcome صريح → PENDING (مش LOSS)
              // ده الإصلاح الأساسي: قبل كده كان بـ يعتبرها LOSS فخسّر الـ winRate.
              outcome = 'PENDING';
            }

            const closedAt = p.evaluation_date || null;
            const entryDate = p.prediction_date || (p.created_at ? String(p.created_at).slice(0, 10) : '');

            // احسب daysSinceEntry
            let daysSince = p.holding_days ?? 0;
            if (!daysSince && entryDate) {
              const d = new Date(String(entryDate).replace(' ', 'T'));
              if (!isNaN(d.getTime())) {
                daysSince = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
              }
            }

            const item: LivePredictionItem = {
              ticker: p.stock_symbol,
              nameAr: p.stock_name_ar || p.stock_symbol,
              persona,
              signal: p.signal_type || '',
              entryDate,
              entryPrice: Number(p.entry_price || 0),
              targetPrice: Number(p.target_price || 0),
              stopLoss: Number(p.stop_loss || 0),
              currentPrice: p.final_price != null ? Number(p.final_price) : Number(p.entry_price || 0),
              outcome,
              returnPct,
              daysSinceEntry: daysSince,
              closedAt,
              exitPrice: p.final_price != null ? Number(p.final_price) : 0,
              maestroScore: p.maestro_score != null ? Number(p.maestro_score) : 0,
              confidence: p.confidence != null ? Number(p.confidence) : 0,
              // FIX-5C: exit_type + highest/lowest + target_price_2 — pass-through من الـ backend
              // للـ UI. الـ exit_type بـ يستخدم لتمييز TRAILING_PROFIT بـ badge منفصل.
              exitType: p.exit_type || null,
              exit_type: p.exit_type || null,
              highestPriceReached: p.highest_price_reached != null ? Number(p.highest_price_reached) : null,
              lowestPriceReached: p.lowest_price_reached != null ? Number(p.lowest_price_reached) : null,
              highest_price_reached: p.highest_price_reached != null ? Number(p.highest_price_reached) : null,
              lowest_price_reached: p.lowest_price_reached != null ? Number(p.lowest_price_reached) : null,
              targetPrice2: p.target_price_2 != null ? Number(p.target_price_2) : null,
              target_price_2: p.target_price_2 != null ? Number(p.target_price_2) : null,
            };
            buckets[persona].push(item);
          }

          // بناء الـ response بالـ format المتوقع
          const transformed: LiveTrackingResponse = {
            success: true,
            predictions: buckets,
            stats: {
              total: 0, wins: 0, losses: 0, pending: 0, settled: 0,
              winRate: null as number | null, avgWinPct: 0, avgLossPct: 0, profitFactor: 0,
              closedCount: 0,
            },
            statsByPersona: {
              gambler: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: null as number | null, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
              balanced: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: null as number | null, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
              conservative: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: null as number | null, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
            },
            last_updated: new Date().toISOString(),
            market: selectedMarket,
            source: json.source || 'honest-tracking-list',
          };
          setData(transformed);
        }
      }
    } catch (e) {
      console.error('[ExecutiveReportView] Failed to load data:', e);
      toast.error('فشل في تحميل بيانات التقرير');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedMarket, qualityMode, minConfidence]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── الفرص الضائعة: fetch منفصل عن الـ main data ──
  // الـ endpoint بيجيب 4 قوائم: missed_bulls / false_positives / correct_buys / correct_sells.
  // بيتعمله fetch في الـ background ومن غير ما يـ block الـ main report.
  // RL-FIX-15: بنمرّر minScore + days علشان الـ endpoint يفلتر بنفس معايير الـ report
  // + dedupe=1 (افتراضي) علشان نفس السهم ما يظهرش 3 مرات (3 شخصيات).
  const fetchMissedOpps = useCallback(async () => {
    setMissedOppsLoading(true);
    try {
      const params = new URLSearchParams({
        threshold: '10',
        limit: '8',
        market: selectedMarket,
        dedupe: '1',
      });
      // RL-FIX-15: فلترة الجودة + الفترة — تطابق الـ report
      if (qualityMode === 'top_picks') {
        params.set('minScore', String(minConfidence));
      }
      // RL-FIX-15: YTD (999) = من أول السنة؛ 0 = كل الأوقات؛ غير كده = عدد الأيام
      if (days === 999) {
        const ytdStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
        params.set('since', ytdStart);
      } else if (days > 0) {
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        params.set('since', cutoff);
      }
      const res = await fetch(
        `/api/predictions/honest-tracking/missed-opportunities?${params.toString()}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const json = await res.json();
        setMissedOpps(json as MissedOpportunitiesResponse);
      }
    } catch (e) {
      console.error('[ExecutiveReportView] missed opps fetch failed:', e);
    } finally {
      setMissedOppsLoading(false);
    }
  }, [selectedMarket, qualityMode, minConfidence, days]);

  useEffect(() => {
    fetchMissedOpps();
  }, [fetchMissedOpps]);

  // ── الفلترة الفعلية client-side حسب الفترة المختارة ──
  // RL-FIX-7: 999 = YTD (من أول السنة) — Jan 1 من السنة الحالية
  const cutoffTs = useMemo(() => {
    if (days === 0) return 0; // كل الأوقات
    if (days === 999) {
      // YTD — من 1 يناير للسنة الحالية
      const now = new Date();
      return new Date(now.getFullYear(), 0, 1).getTime();
    }
    return Date.now() - days * 86400000;
  }, [days]);

  const allPredictionsRaw = useMemo(() => {
    if (!data?.predictions) return [];
    const list: LivePredictionItem[] = [];
    Object.values(data.predictions).forEach((arr) => {
      if (Array.isArray(arr)) list.push(...arr);
    });
    return list;
  }, [data]);

  const allPredictions = useMemo(() => {
    let result = allPredictionsRaw;

    // RL-FIX-10: فلترة الجودة client-side — ده ضروري علشان الـ production fallback
    // (الـ VPS لسه شغّال بالكود القديم) بيرجع كل التوقعات بدون فلترة. الفلترة
    // هنا بتضمن إن الأرقام منطقية حتى قبل ما الـ VPS يتحدّث.
    if (qualityMode === 'top_picks') {
      // (أ) فلترة بالحد الأدنى للثقة
      result = result.filter((p) => {
        const score = Number(p.confidence ?? p.maestroScore ?? 0);
        return score >= minConfidence;
      });
      // (ب) top-N لكل (يوم، شخصية) — خد أعلى 5 توقعات
      const groupKey = (p: LivePredictionItem) => {
        const dateStr = String(p.entryDate || '').slice(0, 10);
        return `${dateStr}__${p.persona}`;
      };
      const groups = new Map<string, LivePredictionItem[]>();
      for (const p of result) {
        const key = groupKey(p);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p);
      }
      const kept: LivePredictionItem[] = [];
      for (const [, group] of groups) {
        group.sort((a, b) => {
          const ca = Number(a.confidence ?? a.maestroScore ?? 0);
          const cb = Number(b.confidence ?? b.maestroScore ?? 0);
          return cb - ca;
        });
        kept.push(...group.slice(0, 5)); // أقصى 5/يوم/شخصية
      }
      result = kept;
    }

    // RL-FIX-8: فلترة بالفترة الزمنية — بنستخدم entryDate (تاريخ التوقع) دايماً
    // لكل الصفقات (مقفولة ومعلقة). السبب: لو استخدمنا closedAt للمقفولة، وهي كلها
    // بتتقفل في نفس اليوم (لما الـ daily_closer يشتغل)، الأرقام ما بتتغيرش مع الفترة.
    // المستخدم عايز "التوقعات اللي اتعملت في آخر X يوم" — ده معناه entryDate.
    if (days !== 0) {
      result = result.filter((p) => {
        try {
          const dateStr = String(p.entryDate || '');
          if (!dateStr || dateStr === 'null' || dateStr === 'undefined' || dateStr === 'None') return false;
          const t = new Date(dateStr.replace(' ', 'T')).getTime();
          if (isNaN(t)) return false;
          return t >= cutoffTs;
        } catch { // silent fallback (safe-by-design)
          return false;
        }
      });
    }

    // RL-FIX-7: 2) فلترة بالشخصية
    if (filterPersona !== 'all') {
      result = result.filter((p) => p.persona === filterPersona);
    }

    // RL-FIX-7: 3) فلترة بالنتيجة
    if (filterOutcome !== 'ALL') {
      result = result.filter((p) => p.outcome === filterOutcome);
    }

    // RL-FIX-7: 4) فلترة بالإشارة (BUY/SELL)
    if (filterSignal !== 'all') {
      result = result.filter((p) => {
        const sig = (p.signal || '').toUpperCase();
        if (filterSignal === 'BUY') {
          return sig === 'BUY' || sig === 'STRONG_BUY';
        }
        if (filterSignal === 'SELL') {
          return sig === 'SELL' || sig === 'STRONG_SELL';
        }
        return true;
      });
    }

    // RL-FIX-7: 5) فلترة بالبحث (ticker أو name)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((p) => {
        const matchTicker = p.ticker.toLowerCase().includes(q);
        const matchName = (p.nameAr || '').toLowerCase().includes(q);
        return matchTicker || matchName;
      });
    }

    return result;
  }, [allPredictionsRaw, days, cutoffTs, filterPersona, filterOutcome, filterSignal, searchQuery, qualityMode, minConfidence]);

  // RL-FIX-7: عدد الفلاتر النشطة (للعرض في الـ badge)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterPersona !== 'all') count++;
    if (filterOutcome !== 'ALL') count++;
    if (filterSignal !== 'all') count++;
    if (searchQuery.trim()) count++;
    // RL-FIX-10: وضع الجودة + الحد الأدنى للثقة
    if (qualityMode === 'all') count++; // 'all' = خروج عن الافتراضي
    if (minConfidence !== 70) count++;
    return count;
  }, [filterPersona, filterOutcome, filterSignal, searchQuery, qualityMode, minConfidence]);

  // RL-FIX-7: reset filters
  const resetFilters = useCallback(() => {
    setFilterPersona('all');
    setFilterOutcome('ALL');
    setFilterSignal('all');
    setSearchQuery('');
    // RL-FIX-10: reset الجودة كمان
    setQualityMode('top_picks');
    setMinConfidence(70);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // RL-FIX-15: القياس على أساس "سهم واحد" (مش "توقع واحد")
  // ═══════════════════════════════════════════════════════════════════════
  // المشكلة: generate_persona_predictions.py بيولّد 3 توقعات لكل سهم يومياً
  // (مضارب/متوازن/مستثمر). لو حسبنا الأداء على الـ 3، نفس السهم بيتحسب 3 مرات
  // → الأرقام منفوخة 3× (41 توقع = في الحقيقة ~14 سهم).
  //
  // الحل: طبقتين قياس:
  // (1) uniqueStocks — نُجمّع التوقعات الـ 3 لنفس (سهم، يوم دخول) في توقع واحد
  //     ممثّل (نفضّل "المتوازن" لأنه الاستراتيجية الوسطى، وبعدها أعلى score).
  //     القياس العام (KPI الرئيسي، الرسوم، أعلى مكاسب/خسائر) بيبقى على ده.
  // (2) allPredictions (3 لكل سهم) — بنستخدمها بس لمقارنة الشخصيات (PersonaCard
  //     + Radar)، لأن مقارنة الاستراتيجيات هي المكان اللي الـ 3-لكل-سهم فيه منطقي.
  // ═══════════════════════════════════════════════════════════════════════

  // RL-FIX-15: يختار التوقع الممثّل لمجموعة (ticker, entryDate) واحدة.
  // أولوية الاختيار: balanced → أعلى score → أول صف.
  const pickRepresentative = (group: LivePredictionItem[]): LivePredictionItem => {
    if (group.length === 1) return group[0];
    const balanced = group.find((p) => p.persona === 'balanced');
    if (balanced) return balanced;
    return [...group].sort(
      (a, b) => Number(b.confidence ?? b.maestroScore ?? 0) - Number(a.confidence ?? a.maestroScore ?? 0)
    )[0];
  };

  // RL-FIX-15: قائمة الأسهم الفريدة — توقع واحد لكل (سهم، يوم دخول)
  const uniqueStocks = useMemo(() => {
    const groups = new Map<string, LivePredictionItem[]>();
    for (const p of allPredictions) {
      const dateStr = String(p.entryDate || '').slice(0, 10) || 'unknown';
      const key = `${p.ticker}__${dateStr}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.values()).map(pickRepresentative);
  }, [allPredictions]);

  // RL-FIX-15: دالة حساب الإحصائيات من أي قائمة توقعات (قابلة لإعادة الاستخدام)
  // بنستخدمها مرتين: مرة على uniqueStocks (للقياس العام)، ومرة على allPredictions
  // (للقياس حسب الشخصية — statsByPersona).
  const computeStats = useCallback((list: LivePredictionItem[]) => {
    const closed = list.filter((p) => p.outcome === 'WIN' || p.outcome === 'LOSS');
    const wins = list.filter((p) => p.outcome === 'WIN');
    const losses = list.filter((p) => p.outcome === 'LOSS');
    const pending = list.filter((p) => p.outcome === 'PENDING');
    const expired = list.filter((p) => p.outcome === 'EXPIRED');

    const winRate = null as number | null; // RULE20-P3 + Rule 27 — Python must provide win_rate (no local computation per Rule 20)
    const avgWinPct = wins.length > 0
      ? wins.reduce((s, p) => s + Number(p.returnPct || 0), 0) / wins.length
      : 0;
    const avgLossPct = losses.length > 0
      ? losses.reduce((s, p) => s + Number(p.returnPct || 0), 0) / losses.length
      : 0;
    // RULE27-NO-FAKE-DATA + RULE67-CANONICAL (2026-10-12 — LEAGUE-DEDUP-FIX):
    // قبل كده: profitFactor = grossWin(SUM) / grossLoss(SUM) — ده SUM جبري للنسب المئوية.
    // مالياً ده غلط: لازم نستخدم الـ AVERAGES (avgWinPct / |avgLossPct|).
    // ده بيتطابق مع Python canonical (utils/backtest_stats.py::compute_profit_factor).
    const profitFactor = avgLossPct < 0
      ? avgWinPct / Math.abs(avgLossPct)
      : (avgWinPct > 0 ? 999 : 0);

    // RULE27-NO-FAKE-DATA (2026-10-12 — LEAGUE-DEDUP-FIX):
    // قبل كده: totalProfit = closed.reduce((s,p) => s + returnPct, 0) — SUM جبري!
    // ده غلط مالياً: جمع 80 صفقة × 30% = +2400% (رقم في الفضاء).
    // الحل الصحيح: متوسط العائد لكل صفقة (avgReturnPct) — ده اللي يمثل "صافي الربح" لكل صفقة.
    // الإجمالي التراكمي الحقيقي = compound return (نستخدمه كـ cumulativeReturnPct).
    const avgReturnPct = closed.length > 0
      ? closed.reduce((s, p) => s + Number(p.returnPct || 0), 0) / closed.length
      : 0;

    // Compound return (الطريقة المالية الصحيحة لحساب العائد التراكمي):
    // افتراض رأس مال 100 لكل صفقة، كل صفقة بـ تضاعف الـ capital بـ (1 + returnPct/100).
    // ده بيـ give عائد تراكمي حقيقي (مش جمع خطي).
    let cumulativeCapital = 100;
    for (const p of closed) {
      cumulativeCapital *= (1 + Number(p.returnPct || 0) / 100);
    }
    const cumulativeReturnPct = closed.length > 0
      ? cumulativeCapital - 100
      : 0;

    // totalProfit: نعرضه كـ avgReturnPct (متوسط العائد لكل صفقة) — ده الرقم المفهوم للعميل
    const totalProfit = avgReturnPct;

    const byPersona = (['gambler', 'balanced', 'conservative'] as const).reduce((acc, personaId) => {
      const personaPreds = list.filter((p) => p.persona === personaId);
      const personaClosed = personaPreds.filter((p) => p.outcome === 'WIN' || p.outcome === 'LOSS');
      const personaWins = personaPreds.filter((p) => p.outcome === 'WIN');
      const personaLosses = personaPreds.filter((p) => p.outcome === 'LOSS');
      const pAvgWin = personaWins.length > 0
        ? personaWins.reduce((s, p) => s + Number(p.returnPct || 0), 0) / personaWins.length
        : 0;
      const pAvgLoss = personaLosses.length > 0
        ? personaLosses.reduce((s, p) => s + Number(p.returnPct || 0), 0) / personaLosses.length
        : 0;
      acc[personaId] = {
        total: personaPreds.length,
        wins: personaWins.length,
        losses: personaLosses.length,
        pending: personaPreds.filter((p) => p.outcome === 'PENDING').length,
        settled: personaClosed.length,
        winRate: null as number | null, // RULE20-P3 + Rule 27 — Python must provide per-persona win_rate
        avgWinPct: pAvgWin,
        avgLossPct: pAvgLoss,
        // RULE67-CANONICAL: profitFactor من averages (مش SUM)
        profitFactor: pAvgLoss < 0 ? pAvgWin / Math.abs(pAvgLoss) : (pAvgWin > 0 ? 999 : 0),
        closedCount: personaClosed.length,
      };
      return acc;
    }, {} as Record<'gambler' | 'balanced' | 'conservative', PersonaStatsItem>);

    return {
      total: list.length,
      wins: wins.length,
      losses: losses.length,
      pending: pending.length,
      expired: expired.length,
      settled: closed.length,
      winRate,
      avgWinPct,
      avgLossPct,
      profitFactor,
      totalProfit,
      // أضفنا cumulativeReturnPct للعرض التراكمي الصحيح (لو الـ UI محتاجه)
      cumulativeReturnPct,
      avgReturnPct,
      closedCount: closed.length,
      statsByPersona: byPersona,
    };
  }, []);

  // RL-FIX-15: القياس العام على أساس "سهم فريد" (توقع واحد لكل سهم/يوم)
  // ده اللي بيظهر في الـ KPI الرئيسية + الرسوم + الهيدر.
  const statsByStock = useMemo(() => computeStats(uniqueStocks), [computeStats, uniqueStocks]);

  // RL-FIX-15: القياس الكامل (3 توقعات لكل سهم) — بنستخدمه فقط لـ statsByPersona
  // (مقارنة الاستراتيجيات في PersonaCard + Radar).
  const statsByPersonaPred = useMemo(() => computeStats(allPredictions), [computeStats, allPredictions]);

  // توافق خلفي: computedStats = القياس على الأسهم الفريدة (KPI الرئيسي)
  const computedStats = statsByStock;

  // Top Gains (highest returnPct among WIN) — RL-FIX-14: dedupe by ticker
  // (نفس السهم ممكن يظهر في أيام متعددة — نعرض أحسن نتيجة لكل سهم مرة واحدة)
  const topGains = useMemo(() => {
    const closedWins = allPredictions.filter(
      (p) => p.outcome === 'WIN' && p.returnPct != null && Number(p.returnPct) > 0
    );
    // Sort by return desc, then dedupe by ticker (keep first = highest)
    const sorted = [...closedWins].sort((a, b) => Number(b.returnPct || 0) - Number(a.returnPct || 0));
    const seen = new Set<string>();
    const deduped = sorted.filter((p) => {
      if (seen.has(p.ticker)) return false;
      seen.add(p.ticker);
      return true;
    });
    return deduped.slice(0, 4);
  }, [allPredictions]);

  // Top Losses (most negative returnPct among LOSS) — RL-FIX-14: dedupe by ticker
  const topLosses = useMemo(() => {
    const closedLosses = allPredictions.filter(
      (p) => p.outcome === 'LOSS' && p.returnPct != null && Number(p.returnPct) < 0
    );
    // Sort by return asc (most negative first), then dedupe by ticker
    const sorted = [...closedLosses].sort((a, b) => Number(a.returnPct || 0) - Number(b.returnPct || 0));
    const seen = new Set<string>();
    const deduped = sorted.filter((p) => {
      if (seen.has(p.ticker)) return false;
      seen.add(p.ticker);
      return true;
    });
    return deduped.slice(0, 4);
  }, [allPredictions]);

  // Fastest Gains (shortest daysSinceEntry with positive return) — RL-FIX-14: dedupe by ticker
  const fastestGains = useMemo(() => {
    const closedWins = allPredictions.filter(
      (p) => p.outcome === 'WIN' && p.returnPct != null && Number(p.returnPct) > 0 && p.daysSinceEntry != null
    );
    const sorted = [...closedWins].sort((a, b) => {
      const daysDiff = Number(a.daysSinceEntry || 99) - Number(b.daysSinceEntry || 99);
      if (daysDiff !== 0) return daysDiff;
      return Number(b.returnPct || 0) - Number(a.returnPct || 0);
    });
    // Dedupe by ticker — keep the fastest entry per stock
    const seen = new Set<string>();
    const deduped = sorted.filter((p) => {
      if (seen.has(p.ticker)) return false;
      seen.add(p.ticker);
      return true;
    });
    return deduped.slice(0, 4);
  }, [allPredictions]);

  // REPORT-REDESIGN: أعلى 5 توقعات فائزة لبطاقة التقرير القابلة للنشر.
  // نفس منطق topGains لكن slice=5 + بيانات entry→target كاملة لعرضها في جدول مدمج.
  // البيانات كلها من نفس المصدر الكانوني (honest-tracking/list) — لا fabrication (Rule 27).
  const topFiveWinningPredictions = useMemo(() => {
    const closedWins = allPredictions.filter(
      (p) => p.outcome === 'WIN' && p.returnPct != null && Number(p.returnPct) > 0
    );
    const sorted = [...closedWins].sort(
      (a, b) => Number(b.returnPct || 0) - Number(a.returnPct || 0)
    );
    const seen = new Set<string>();
    const deduped = sorted.filter((p) => {
      if (seen.has(p.ticker)) return false;
      seen.add(p.ticker);
      return true;
    });
    return deduped.slice(0, 5);
  }, [allPredictions]);

  // REPORT-REDESIGN: متوسط فترة الاحتفاظ (Avg holding days) — KPI رئيسي للمستثمرين.
  // يُحسب من الصفقات المغلقة فقط (WIN + LOSS) باستخدام daysSinceEntry الفعلي.
  // لو لا توجد صفقات مغلقة → null → العرض "—" (Rule 27: لا fabrication).
  const avgHoldingDays = useMemo(() => {
    const closed = allPredictions.filter(
      (p) => (p.outcome === 'WIN' || p.outcome === 'LOSS')
        && p.daysSinceEntry != null
        && Number(p.daysSinceEntry) > 0
    );
    if (closed.length === 0) return null;
    const total = closed.reduce((s, p) => s + Number(p.daysSinceEntry || 0), 0);
    return Math.round((total / closed.length) * 10) / 10;
  }, [allPredictions]);

  // REPORT-REDESIGN: نطاق الفترة الزمنية (من ← إلى) للعرض في الـ header + الـ PNG.
  // - days=0 → "كافة الأوقات" (لا تاريخ بداية)
  // - days=999 → YTD (1 يناير للسنة الحالية)
  // - days=N → من اليوم − N
  // النهاية = تاريخ اليوم (أو آخر توقع مُغلق لو متاح وأحدث).
  const periodRange = useMemo(() => {
    const fmtAr = (d: Date) => d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const end = new Date();
    let start: Date | null = null;
    let startLabel = 'كافة الأوقات';
    if (days === 999) {
      start = new Date(new Date().getFullYear(), 0, 1);
      startLabel = fmtAr(start);
    } else if (days > 0) {
      start = new Date(Date.now() - days * 86400000);
      startLabel = fmtAr(start);
    }
    return {
      start: startLabel,
      end: fmtAr(end),
      isAllTime: days === 0,
    };
  }, [days]);

  // ── بيانات الرسوم البيانية ──
  // RL-FIX-15: الرسوم البيانية (Donut, Area, Bar) بتشتغل على uniqueStocks
  // (توقع واحد لكل سهم/يوم) علشان الأرقام تطلع منطقية ومش منفوخة 3×.
  // 1. Donut: توزيع الفوز/الخسارة/المعلق/المنتهي
  // FIX-5C: أضفنا TRAILING_PROFIT كـ slice منفصل بـ لون زمردي مميز عن WIN (الأخضر).
  // الـ trailing_profit صفقات WIN رسمياً (actual_return > 0) لكن exit_type بيـ differenti.
  // بنـ split الـ wins لـ wins + trailingProfit علشان الـ Donut يعرضهم منفصلين.
  const outcomeDistribution = useMemo(() => {
    const trailingProfit = uniqueStocks.filter((p) => {
      const et = (p.exitType || p.exit_type || '').toString().toLowerCase().trim();
      return et === 'trailing_profit';
    }).length;
    const winsAll = uniqueStocks.filter((p) => p.outcome === 'WIN').length;
    const wins = winsAll - trailingProfit;  // WIN عادي = كل wins - trailing_profit
    const losses = uniqueStocks.filter((p) => p.outcome === 'LOSS').length;
    const pending = uniqueStocks.filter((p) => p.outcome === 'PENDING').length;
    const expired = uniqueStocks.filter((p) => p.outcome === 'EXPIRED').length;
    return [
      { name: 'رابحة', value: wins, color: 'hsl(var(--success))' },
      { name: '💰 خرجت بربح', value: trailingProfit, color: 'hsl(var(--chart-2))' },  // teal-400 — مميز عن emerald
      { name: 'خاسرة', value: losses, color: 'hsl(var(--danger))' },
      { name: 'معلقة', value: pending, color: 'hsl(var(--warning))' },
      { name: 'منتهية', value: expired, color: 'hsl(var(--muted-foreground))' },
    ].filter((d) => d.value > 0);
  }, [uniqueStocks]);

  // 2. Area: الأرباح التراكمية عبر الزمن (للمقفولة فقط)
  // RULE20-P3 (PYTHON = BRAIN): قبل كده كان الـ cumulative بيتحسب محلياً كـ running sum
  // للـ returnPct — ده COMPUTATION مالية (cumulative return) ممنوعة per Rule 20.
  // Python ما بيوفرش حقل `cumulative_return` لكل صفقة → null (Rule 27: NO-FAKE-DATA).
  // الـ chart بـ يعرض `—` placeholder لما cumulative = null.
  // `trade` = display rounding فقط لـ c.returnPct (Python-provided per-trade return) — KEEP.
  const cumulativeProfitData = useMemo(() => {
    const closed = uniqueStocks
      .filter((p) => (p.outcome === 'WIN' || p.outcome === 'LOSS') && p.closedAt && p.returnPct != null)
      .map((p) => ({
        ticker: p.ticker,
        closedAt: p.closedAt as string,
        returnPct: Number(p.returnPct),
      }))
      .sort((a, b) => String(a.closedAt).localeCompare(String(b.closedAt)));
    return closed.map((c) => ({
      label: `${String(c.closedAt).slice(5, 10)} · ${c.ticker}`,
      cumulative: null as number | null, // Rule 20 + Rule 27 — Python must provide cumulative_return
      trade: Math.round(c.returnPct * 100) / 100, // DISPLAY FORMATTING only (Python-provided per-trade return)
    }));
  }, [uniqueStocks]);

  // 3. Bar: العائد الشهري (تجميع حسب شهر الإغلاق)
  // RULE20-P3 (PYTHON = BRAIN): قبل كده كان الـ `total` (sum of returnPct per month)
  // و الـ `winRate` (wins/count * 100) بيتحسبوا محلياً — ده COMPUTATION مالية ممنوعة per Rule 20.
  // Python ما بيوفرش per-month return أو per-month win_rate → null (Rule 27: NO-FAKE-DATA).
  // `count` (عدد الصفقات في الشهر) = metadata (مش financial calc) → KEEP.
  const monthlyReturns = useMemo(() => {
    const monthMap: Record<string, { month: string; count: number }> = {};
    for (const p of uniqueStocks) {
      if (p.outcome !== 'WIN' && p.outcome !== 'LOSS') continue;
      if (!p.closedAt || p.returnPct == null) continue;
      const d = new Date(String(p.closedAt).replace(' ', 'T'));
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = d.toLocaleDateString('ar-EG', { month: 'short', year: '2-digit' });
      if (!monthMap[key]) monthMap[key] = { month: monthLabel, count: 0 };
      monthMap[key].count += 1;
    }
    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6) // آخر 6 شهور
      .map(([, v]) => ({
        month: v.month,
        total: null as number | null, // Rule 20 + Rule 27 — Python must provide monthly return
        count: v.count,
        winRate: null as number | null, // Rule 20 + Rule 27 — Python must provide monthly win_rate
      }));
  }, [uniqueStocks]);

  // 4. Radar: مقارنة الشخصيات في 4 محاور
  // RL-FIX-15: الـ Radar بيقارن الاستراتيجيات، فبنستخدم statsByPersonaPred
  // (القياس على الـ 3 توقعات لكل سهم) مش statsByStock (اللي فيه توقع واحد بس).
  // RL-FIX-16-FE: إصلاح dependency array — كان `[computedStats]` (اللي هو statsByStock)
  // بدل `statsByPersonaPred`. ده كان بيـ cause الـ radar ما يتحدثش لما الفلاتر تتغير
  // لو statsByStock ما اتغيرش (نادراً بس بيحصل). دلوقتي البيانات صحيحة.
  const personaRadarData = useMemo(() => {
    const g = statsByPersonaPred.statsByPersona.gambler;
    const b = statsByPersonaPred.statsByPersona.balanced;
    const c = statsByPersonaPred.statsByPersona.conservative;
    return [
      // RULE20-P3: winRate may be null (Python must provide). Radar axis shows 0 for null
      // (display fallback only — no fabrication in underlying data per Rule 27).
      { axis: 'نسبة النجاح', gambler: Math.round(g.winRate ?? 0), balanced: Math.round(b.winRate ?? 0), conservative: Math.round(c.winRate ?? 0) },
      { axis: 'معامل الربحية', gambler: Math.round(Math.min(g.profitFactor, 5) * 20), balanced: Math.round(Math.min(b.profitFactor, 5) * 20), conservative: Math.round(Math.min(c.profitFactor, 5) * 20) },
      { axis: 'متوسط الربح', gambler: Math.round(Math.min(g.avgWinPct, 20) * 5), balanced: Math.round(Math.min(b.avgWinPct, 20) * 5), conservative: Math.round(Math.min(c.avgWinPct, 20) * 5) },
      { axis: 'عدد الصفقات', gambler: Math.round(Math.min(g.closedCount, 500) / 5), balanced: Math.round(Math.min(b.closedCount, 500) / 5), conservative: Math.round(Math.min(c.closedCount, 500) / 5) },
    ];
  }, [statsByPersonaPred]);

  // FIX-5C: TRAILING_PROFIT counter — عدد الصفقات اللي خرجت بربح جزئي (exit_type ===
  // 'trailing_profit'). الـ outcome الرسمي بـ يفضل WIN، لكن الـ UI بـ يـ differentiate
  // علشان المالك يفرّق بين "هدف محقق كامل" و"جني أرباح قبل الهدف" (trailing stop ratchet).
  const trailingProfitCount = useMemo(() => {
    return uniqueStocks.filter((p) => {
      const et = (p.exitType || p.exit_type || '').toString().toLowerCase().trim();
      return et === 'trailing_profit';
    }).length;
  }, [uniqueStocks]);

  // FIX-5C: topTrailingProfit — أعلى 4 صفقات trailing_profit حسب العائد (لعرضها
  // في قسم منفصل في الـ highlights لو في عدد كافي).
  const topTrailingProfit = useMemo(() => {
    const trailing = allPredictions.filter((p) => {
      const et = (p.exitType || p.exit_type || '').toString().toLowerCase().trim();
      return et === 'trailing_profit' && p.returnPct != null && Number(p.returnPct) > 0;
    });
    const sorted = [...trailing].sort((a, b) => Number(b.returnPct || 0) - Number(a.returnPct || 0));
    const seen = new Set<string>();
    const deduped = sorted.filter((p) => {
      if (seen.has(p.ticker)) return false;
      seen.add(p.ticker);
      return true;
    });
    return deduped.slice(0, 4);
  }, [allPredictions]);

  // PNG export — REPORT-REDESIGN: اسم الملف بيشمل اسم السوق المختار + اسم المنصة.
  const handleExportPng = useCallback(async () => {
    if (!reportContainerRef.current) return;
    setExporting(true);
    toast.loading('جاري توليد تقرير الأداء كصورة...', { id: 'report-export' });
    try {
      const dataUrl = await toPng(reportContainerRef.current, {
        cacheBust: true,
        quality: 0.98,
        pixelRatio: 2,
        backgroundColor: 'hsl(var(--background))',
      });
      const link = document.createElement('a');
      const timeLabel = TIMEFRAME_OPTIONS.find((t) => t.value === days)?.badge || `${days}d`;
      link.download = `Dalilestithmar_Report_${selectedMarket}_${timeLabel}_${Date.now()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('تم استخراج تقرير الأداء كصورة', { id: 'report-export' });
    } catch (err) {
      console.error('[ExecutiveReport] Export failed:', err);
      toast.error('تعذّر استخراج التقرير كصورة', { id: 'report-export' });
    } finally {
      setExporting(false);
    }
  }, [days, selectedMarket]);

  // RL-FIX-15: KPI الرئيسية بتشتغل على uniqueStocks (القياس على أساس السهم).
  // statsByPersona بتيجي من statsByPersonaPred (القياس على الـ 3 توقعات لكل سهم)
  // علشان مقارنة الشخصيات تفضل منطقية.
  const stats = statsByStock;
  const statsByPersona = statsByPersonaPred.statsByPersona;
  // RL-FIX-15: عدد الأسهم الفريدة + إجمالي التوقعات (للعرض في الهيدر)
  const uniqueStockCount = uniqueStocks.length;
  const totalPredictionCount = allPredictions.length;
  const winRate = stats.winRate;
  const profitFactor = stats.profitFactor;
  const totalTrades = stats.total;
  const timeframeLabel = TIMEFRAME_OPTIONS.find((t) => t.value === days)?.label || '';

  // نص المشاركة لملخص الأداء — ينتج من statsByStock
  // REPORT-REDESIGN: نص احترافي للمستثمرين — اسم المنصة + السوق + الفترة + الأرقام الموثقة.
  const reportShareText = useMemo(() => {
    const marketName = MARKET_NAMES_AR[selectedMarket] || selectedMarket;
    const lines: string[] = [
      `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}`,
      `السوق: ${marketName} · الفترة: ${timeframeLabel}`,
      `من ${periodRange.start} إلى ${periodRange.end}`,
      '',
      `إجمالي الصفقات: ${totalTrades}`,
      `نسبة النجاح: ${winRate == null ? '—' : `${winRate.toFixed(1)}%`}`,
      `معامل الربحية: ${profitFactor >= 999 ? '∞' : (profitFactor ?? 0).toFixed(2)}`,
      `رابحة: ${stats.wins} / خاسرة: ${stats.losses} / معلقة: ${stats.pending}`,
      `صافي العائد: ${stats.totalProfit >= 0 ? '+' : ''}${(stats.totalProfit ?? 0).toFixed(2)}%`,
      avgHoldingDays != null ? `متوسط فترة الاحتفاظ: ${avgHoldingDays} يوم` : '',
      '',
      'تنبيه: هذا التقرير لأغراض إعلامية فقط ولا يُعد نصيحة استثمارية. الأداء السابق لا يضمن النتائج المستقبلية.',
    ].filter(Boolean);
    return lines.join('\n');
  }, [selectedMarket, timeframeLabel, periodRange, totalTrades, winRate, profitFactor, stats, avgHoldingDays]);

  return (
    <div className={cn('w-full max-w-6xl mx-auto space-y-5', className)} dir="rtl">
      {/* ════════════════ Control Bar ════════════════ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/60 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-border shadow-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold gap-1 text-xs">
              <Layers className="w-3.5 h-3.5" />
              {PLATFORM_TAGLINE}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">
              {timeframeLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              · {uniqueStockCount} سهم فريد
              {totalPredictionCount > uniqueStockCount && (
                <span className="text-slate-500"> ({totalPredictionCount} توقع · 3 استراتيجيات/سهم)</span>
              )}
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-black text-foreground mt-2 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <span>{PLATFORM_NAME} — {PLATFORM_TAGLINE}</span>
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={refreshing}
            className="h-10 px-4 text-sm font-bold"
          >
            <RefreshCw className={cn('w-4 h-4 ml-1.5 text-emerald-500', refreshing && 'animate-spin')} />
            تحديث
          </Button>

          <Button
            onClick={handleExportPng}
            disabled={exporting || loading}
            size="sm"
            className="h-10 px-4 text-sm font-bold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black shadow-lg shadow-amber-500/20"
          >
            <Download className="w-4 h-4 ml-1.5" />
            تصدير التقرير PNG
          </Button>

          <UnifiedPublishButton
            content={reportShareText}
            title={`${PLATFORM_NAME} — ${PLATFORM_TAGLINE} | ${MARKET_NAMES_AR[selectedMarket] || selectedMarket} · ${timeframeLabel}`}
            image={reportContainerRef}
            filename={`dalilestithmar_report_${selectedMarket}_${new Date().toISOString().split('T')[0]}`}
            hashtags={[selectedMarket, 'بورصة', 'تقرير_أداء']}
            variant="outline"
            size="sm"
          />

          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="h-10 px-3 text-sm flex-shrink-0">
              <ChevronLeft className="w-4 h-4 ml-1" /> رجوع
            </Button>
          )}
        </div>
      </div>

      {/* ════════════════ REPORT-REDESIGN: Market + Timeframe Selectors ════════════════ */}
      {/* اختيار السوق + الفترة الزمنية في صف واحد — يتيح للمستثمر تبديل التقرير بين
          الأسواق الـ 6 المدعومة (EGX/TADAWUL/KSE/QSE/US/CRYPTO) + اختيار الفترة.
          كل تغيير بـ يعيد fetch البيانات من /api/predictions/honest-tracking/list. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-card/60 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-border shadow-sm">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Building2 className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="text-sm font-bold text-muted-foreground flex-shrink-0">السوق:</span>
          <Select
            value={selectedMarket}
            onValueChange={(value) => setSelectedMarket(value as MarketType)}
          >
            <SelectTrigger
              className="w-[200px] h-9 text-sm font-bold"
              aria-label="اختيار السوق"
            >
              <SelectValue placeholder="اختر السوق" />
            </SelectTrigger>
            <SelectContent>
              {MARKET_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="font-medium">
                  <span className="ml-1">{opt.emoji}</span>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1.5 no-scrollbar flex-1 min-w-0">
          <span className="text-sm font-bold text-muted-foreground ml-1 flex-shrink-0">الفترة:</span>
          {TIMEFRAME_OPTIONS.map((opt) => (
            <button
              key={`tf-${opt.value}`}
              onClick={() => setDays(opt.value)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border flex-shrink-0 whitespace-nowrap',
                days === opt.value
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-black border-amber-400 shadow-md shadow-amber-500/30'
                  : 'bg-card/80 hover:bg-muted text-muted-foreground border-border'
              )}
            >
              <Clock className="w-3.5 h-3.5" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════ RL-FIX-7: Advanced Filters Toolbar ════════════════ */}
      <div className="bg-card/60 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-border shadow-sm space-y-3">
        {/* Header row: toggle + active count + reset */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
          >
            <Filter className="w-4 h-4" />
            فلاتر متقدمة
            {activeFilterCount > 0 && (
              <Badge className="bg-amber-500 text-black text-[10px] px-1.5 py-0 min-w-[20px] h-5 flex items-center justify-center">
                {activeFilterCount}
              </Badge>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-rose-500 hover:bg-rose-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              مسح الفلاتر ({activeFilterCount})
            </button>
          )}
        </div>

        {showFilters && (
          <div className="space-y-3 pt-1 border-t border-border">
            {/* RL-FIX-10: Quality Mode Filter — أهم فلتر (أفضل التوقعات بس) */}
            <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400 flex-shrink-0 w-16 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                الجودة:
              </span>
              {QUALITY_MODE_OPTIONS.map((opt) => (
                <button
                  key={`qfilter-${opt.value}`}
                  onClick={() => setQualityMode(opt.value)}
                  title={opt.desc}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1',
                    qualityMode === opt.value
                      ? 'bg-amber-500 text-black border-amber-400 shadow-sm'
                      : 'bg-card/80 hover:bg-muted text-muted-foreground border-border'
                  )}
                >
                  <span>{opt.emoji}</span>
                  {opt.label}
                </button>
              ))}
              <span className="text-[10px] text-muted-foreground mr-auto">
                {qualityMode === 'top_picks'
                  ? '5 توقعات/يوم لكل شخصية — أرقام منطقية'
                  : 'كل التوقعات — للتحليل الشامل'}
              </span>
            </div>

            {/* RL-FIX-10: Confidence Threshold Filter */}
            {qualityMode === 'top_picks' && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-muted-foreground flex-shrink-0 w-16">الثقة ≥:</span>
                {CONFIDENCE_OPTIONS.map((opt) => (
                  <button
                    key={`cfilter-${opt.value}`}
                    onClick={() => setMinConfidence(opt.value)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-bold transition-all border',
                      minConfidence === opt.value
                        ? 'bg-emerald-500 text-white border-emerald-400 shadow-sm'
                        : 'bg-card/80 hover:bg-muted text-muted-foreground border-border'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* FEAT5-PERSONA-REMOVAL: Persona Filter UI removed — production engine
                is V40.2 balanced-only; clients must not see persona switcher
                buttons. The `filterPersona` state stays in the data layer and
                defaults to 'all' (shows every historical prediction regardless
                of legacy persona tag). */}

            {/* Outcome Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-muted-foreground flex-shrink-0 w-16">النتيجة:</span>
              {OUTCOME_FILTER_OPTIONS.map((opt) => (
                <button
                  key={`ofilter-${opt.value}`}
                  onClick={() => setFilterOutcome(opt.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold transition-all border',
                    filterOutcome === opt.value
                      ? cn('bg-card border-border', opt.color, 'ring-1 ring-current')
                      : 'bg-card/50 hover:bg-muted text-muted-foreground border-border'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Signal Filter + Search */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-muted-foreground flex-shrink-0 w-16">الإشارة:</span>
              {SIGNAL_FILTER_OPTIONS.map((opt) => (
                <button
                  key={`sfilter-${opt.value}`}
                  onClick={() => setFilterSignal(opt.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold transition-all border',
                    filterSignal === opt.value
                      ? 'bg-amber-500 text-black border-amber-400'
                      : 'bg-card/80 hover:bg-muted text-muted-foreground border-border'
                  )}
                >
                  {opt.label}
                </button>
              ))}

              {/* Search Input */}
              <div className="relative flex-1 min-w-[200px] mr-auto">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث بالرمز أو الاسم..."
                  className="w-full pr-9 pl-3 py-1.5 rounded-lg text-xs font-medium bg-card/80 border border-border focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 outline-none transition-colors text-foreground placeholder:text-muted-foreground"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════ MAIN REPORT (PNG snapshot target) ════════════════ */}
      <div
        ref={reportContainerRef}
        className="relative max-w-6xl mx-auto rounded-3xl bg-gradient-to-b from-[hsl(var(--card))] via-[hsl(var(--background))] to-[hsl(var(--card))] border-2 border-amber-500/25 text-white shadow-2xl overflow-hidden"
      >
        {/* Decorative background glows — subtle, not overwhelming */}
        <div className="absolute top-0 right-0 w-[28rem] h-[28rem] bg-amber-500/8 blur-[140px] pointer-events-none rounded-full" />
        <div className="absolute bottom-0 left-0 w-[28rem] h-[28rem] bg-emerald-500/6 blur-[140px] pointer-events-none rounded-full" />

        <div className="relative z-10 p-6 sm:p-8 md:p-10 lg:p-12 space-y-8">
          {/* ── REPORT-REDESIGN: Branding Header (احترافي للمستثمرين + PNG) ──
              شعار نصي placeholder + اسم المنصة «دليل الاستثمار» + سطر التاج لاين
              «تقرير الأداء الاستثماري» + نطاق الفترة (من ← إلى) + شارة السوق.
              كل العناصر داخل الـ reportContainerRef علشان تظهر في الـ PNG المُصدَّر. */}
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 pb-7 border-b border-white/10">
            {/* اليمين: الشعار + اسم المنصة + الفترة + السوق */}
            <div className="min-w-0 flex-1">
              {/* الصف الأول: شعار placeholder + اسم المنصة + سطر التاج لاين */}
              <div className="flex items-center gap-4">
                {/* Logo placeholder — علبة ذهبية بأيقونة Landmark.
                    لو المنصة عندها شعار صورة، يُستبدل بـ <Image /> أو <img />. */}
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30 flex-shrink-0 ring-2 ring-amber-300/40">
                  <Landmark className="w-7 h-7 sm:w-8 sm:h-8 text-amber-950" strokeWidth={2.5} />
                </div>
                <div className="min-w-0">
                  <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tight leading-tight">
                    {PLATFORM_NAME}
                  </h1>
                  <p className="text-sm sm:text-base text-amber-300 font-bold mt-0.5">
                    {PLATFORM_TAGLINE}
                  </p>
                </div>
              </div>

              {/* الصف الثاني: نطاق الفترة (من ← إلى) + شارة السوق */}
              <div className="flex items-center gap-2 flex-wrap mt-4">
                <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-slate-800/80 text-slate-200 border border-white/15 flex items-center gap-1.5">
                  <CalendarRange className="w-3.5 h-3.5 text-amber-400" />
                  {periodRange.isAllTime ? (
                    <span>كافة الأوقات ← {periodRange.end}</span>
                  ) : (
                    <span>{periodRange.start} ← {periodRange.end}</span>
                  )}
                </span>
                <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  {MARKET_NAMES_AR[selectedMarket] || selectedMarket}
                </span>
                {/* RL-FIX-7/8: Data source indicator — يظهر للمستخدم مصدر البيانات */}
                {data?.source && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700/50 text-slate-300 border border-slate-600/50 flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    {data.source.includes('vps') || data.source.includes('prod') || data.source.includes('production')
                      ? 'بيانات الإنتاج'
                      : 'بيانات محلية'}
                  </span>
                )}
                {/* RL-FIX-10: Quality mode indicator */}
                <span className={cn(
                  'px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1',
                  qualityMode === 'top_picks'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-700/50 text-slate-300 border-slate-600/50'
                )}>
                  <Sparkles className="w-3 h-3" />
                  {qualityMode === 'top_picks'
                    ? `أفضل التوقعات (≥${minConfidence})`
                    : 'كل التوقعات'}
                </span>
                {/* RL-FIX-7: Active filters indicator */}
                {activeFilterCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    {activeFilterCount} فلتر نشط
                  </span>
                )}
              </div>

              {/* الصف الثالث: وصف موجز احترافي للمستثمرين */}
              <p className="text-sm text-slate-300 mt-3 max-w-2xl leading-relaxed">
                تقرير موثَّق بأداء التوقعات الفعلية للمنصة خلال الفترة المحددة،
                يستند إلى بيانات الصفقات المغلقة من قاعدة بيانات التتبُّع.
                {!loading && totalTrades > 0 && (
                  <>
                    <span className="text-amber-300 font-bold"> — {uniqueStockCount} سهم فريد في النتائج</span>
                    {totalPredictionCount > uniqueStockCount && (
                      <span className="text-slate-400"> ({totalPredictionCount} توقع · 3 استراتيجيات لكل سهم)</span>
                    )}
                  </>
                )}
              </p>
            </div>

            {/* اليسار: صندوق المؤشرات الرئيسية (للعرض السريع في الـ PNG) */}
            <div className="flex flex-col items-start md:items-end justify-center bg-slate-900/70 px-5 py-4 rounded-2xl border border-amber-500/20 md:min-w-[240px]">
              <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">نسبة النجاح</span>
              <span className="text-3xl font-black text-emerald-400 mt-1 leading-none">
                {winRate == null ? '—' : `${winRate.toFixed(1)}%`}
              </span>
              <span className="text-sm text-amber-300 font-bold mt-2">
                معامل الربحية {profitFactor >= 999 ? 'مثالي' : (profitFactor ?? 0).toFixed(2)}
              </span>
              {/* RL-FIX-7: Settled count transparency */}
              {!loading && totalTrades > 0 && (
                <span className="text-[11px] text-slate-400 mt-1.5">
                  {stats.wins} رابحة / {stats.losses} خاسرة / {stats.pending} معلقة
                  {trailingProfitCount > 0 && (
                    <span className="text-teal-400 font-bold"> · {trailingProfitCount} خرجت بربح جزئي</span>
                  )}
                  <span className="text-slate-500"> · قياس على الأسهم الفريدة</span>
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="space-y-6 py-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-36 w-full bg-slate-800/50 rounded-2xl" />
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Skeleton className="h-64 w-full bg-slate-800/50 rounded-2xl" />
                <Skeleton className="h-64 w-full bg-slate-800/50 rounded-2xl" />
              </div>
            </div>
          ) : totalTrades === 0 ? (
            <div className="text-center py-16">
              <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-base">
                لا توجد توقعات في هذه الفترة
              </p>
              <p className="text-slate-500 text-sm mt-1">
                جرّب فترة زمنية أطول أو بدّل السوق لعرض المزيد من البيانات
              </p>
            </div>
          ) : (
            <>
              {/* ═══ 1. HERO KPI CARDS — 6 مؤشرات أساسية للمستثمر ═══ */}
              {/* REPORT-REDESIGN: أضفنا KPI «متوسط فترة الاحتفاظ» (Avg holding days) — */}
              {/* مؤشر أساسي للمستثمر يقيس المدة الفعلية للصفقات. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {/* Win Rate */}
                <KpiCard
                  label="نسبة النجاح"
                  value={winRate == null ? '—' : `${winRate.toFixed(1)}%`}
                  subtext={`من ${stats.settled} سهم محسوم`}
                  accent="emerald"
                />
                {/* Profit Factor */}
                <KpiCard
                  label="معامل الربحية"
                  value={profitFactor >= 999 ? 'مثالي' : (profitFactor ?? 0).toFixed(2)}
                  subtext="نسبة الأرباح للخسائر"
                  accent="amber"
                />
                {/* Wins / Losses */}
                <KpiCard
                  label="الصفقات المحسومة"
                  value={`${stats.wins}`}
                  valueSuffix={`/ ${stats.losses}`}
                  subtext={`من إجمالي ${stats.total} سهم فريد`}
                  accent="rose"
                  isSplit
                />
                {/* Avg Win / Loss */}
                <KpiCard
                  label="متوسط العائد / الخسارة"
                  value={`+${(stats.avgWinPct ?? 0).toFixed(1)}%`}
                  valueSuffix={`/ ${(stats.avgLossPct ?? 0).toFixed(1)}%`}
                  subtext="متوسط العائد للصفقة"
                  accent="emerald"
                  isSplit
                />
                {/* Total Profit (إجمالي الربح) */}
                <KpiCard
                  label="إجمالي الربح"
                  value={`${stats.totalProfit >= 0 ? '+' : ''}${(stats.totalProfit ?? 0).toFixed(2)}%`}
                  subtext="مجموع عوائد الصفقات المغلقة"
                  accent={stats.totalProfit >= 0 ? 'emerald' : 'rose'}
                  icon={<TrendingUp className="w-4 h-4" />}
                />
                {/* Avg Holding Days — REPORT-REDESIGN: مؤشر جديد للمستثمرين */}
                <KpiCard
                  label="متوسط فترة الاحتفاظ"
                  value={avgHoldingDays != null ? `${avgHoldingDays}` : '—'}
                  valueSuffix={avgHoldingDays != null ? 'يوم' : undefined}
                  subtext="متوسط مدة الصفقات المغلقة"
                  accent="amber"
                  icon={<Clock className="w-4 h-4" />}
                />
              </div>

              {/* FIX-5C: TRAILING_PROFIT KPI Card منفصل — لو فيه صفقات خرجت بربح جزئي،
                  نعرض counter منفصل بـ لون زمردي مميز عن WIN الأخضر العادي. ده بـ
                  يـ differentiate بين "هدف محقق كامل" و"جني أرباح قبل الهدف" (trailing
                  stop ratchet). الكارد بـ يظهر بس لو فيه عدد > 0 علشان ما يـ clutterش
                  الـ UI لو مفيش بيانات. */}
              {trailingProfitCount > 0 && (
                <div className="mt-4 inline-flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-teal-500/10 border border-teal-500/30">
                  <HandCoins className="w-6 h-6 text-teal-400 flex-shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[11px] text-slate-400 font-bold">صفقات أُغلقت بربح جزئي (Trailing Profit)</span>
                    <span className="text-teal-300 font-black text-lg font-mono">
                      {trailingProfitCount} صفقة
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 mr-2 max-w-[200px]">
                    وصلت لربح جزئي ثم ارتدت — تم جني الأرباح قبل الهدف الكامل
                  </span>
                </div>
              )}

              {/* ═══ REPORT-REDESIGN: Top 5 Winning Predictions — جدول مدمج للنشر ═══
                  جدول احترافي يعرض أعلى 5 توقعات فائزة في الفترة، بتنسيق مناسب
                  لبطاقة التقرير الموجهة للمستثمرين: السهم | الإشارة | الدخول ← الهدف |
                  المدة | العائد. كل البيانات من honest-tracking/list — لا fabrication. */}
              <div className="bg-slate-900/70 p-5 sm:p-6 rounded-2xl border border-emerald-500/20">
                <div className="flex items-center justify-between gap-2 mb-4 pb-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <Award className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-base sm:text-lg font-bold text-white">أبرز 5 توقعات فائزة</h3>
                  </div>
                  <Badge variant="outline" className="text-[11px] text-emerald-300 border-emerald-500/30 bg-emerald-500/10 whitespace-nowrap">
                    أعلى عائد في الفترة
                  </Badge>
                </div>
                {topFiveWinningPredictions.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                          <th className="text-right py-2 px-2 font-bold">#</th>
                          <th className="text-right py-2 px-2 font-bold">السهم</th>
                          <th className="text-center py-2 px-2 font-bold">الإشارة</th>
                          <th className="text-right py-2 px-2 font-bold">الدخول ← الهدف</th>
                          <th className="text-center py-2 px-2 font-bold">المدة</th>
                          <th className="text-left py-2 px-2 font-bold">العائد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topFiveWinningPredictions.map((item, idx) => {
                          const sig = (item.signal || '').toUpperCase();
                          const isBuy = sig === 'BUY' || sig === 'STRONG_BUY';
                          return (
                            <tr
                              key={`top5-${item.ticker}-${idx}`}
                              className="border-t border-white/5 hover:bg-white/5 transition-colors"
                            >
                              <td className="py-2.5 px-2 text-slate-500 font-bold font-mono">{idx + 1}</td>
                              <td className="py-2.5 px-2">
                                <div className="flex flex-col">
                                  <span className="font-black text-white text-sm font-mono">{item.ticker}</span>
                                  {item.nameAr && (
                                    <span className="text-[11px] text-slate-400 truncate max-w-[140px]">{item.nameAr}</span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-2 text-center">
                                <span className={cn(
                                  'inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border',
                                  isBuy
                                    ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
                                    : 'text-rose-300 border-rose-500/30 bg-rose-500/10'
                                )}>
                                  {isBuy ? 'شراء' : 'بيع'}
                                </span>
                              </td>
                              <td className="py-2.5 px-2 text-right font-mono text-xs text-slate-300">
                                {fmtPrice(item.entryPrice)} ← {fmtPrice(item.targetPrice)}
                              </td>
                              <td className="py-2.5 px-2 text-center text-slate-300 font-bold text-xs">
                                {item.daysSinceEntry || 1} يوم
                              </td>
                              <td className="py-2.5 px-2 text-left font-black text-emerald-400">
                                +{(Number(item.returnPct || 0)).toFixed(2)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500 text-sm">
                    لا توجد صفقات رابحة في هذه الفترة
                  </div>
                )}
              </div>

              {/* ═══ 2. CHARTS GRID — 3 رسوم بيانية جمالية ═══ */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* 2A. Donut: توزيع النتائج */}
                <div className="bg-slate-900/70 p-5 rounded-2xl border border-white/10">
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                    <PieIcon className="w-5 h-5 text-amber-400" />
                    <h3 className="text-base font-bold text-white">توزيع النتائج</h3>
                  </div>
                  {outcomeDistribution.length > 0 ? (
                    <>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={outcomeDistribution}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={75}
                              paddingAngle={3}
                              stroke="none"
                            >
                              {outcomeDistribution.map((entry, idx) => (
                                <Cell key={`cell-${idx}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <RTooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--background))',
                                border: '1px solid hsl(var(--foreground) / 0.1)',
                                borderRadius: '12px',
                                fontSize: '12px',
                              }}
                              formatter={(value: number) => [`${value} صفقة`, '']}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                        {outcomeDistribution.map((d) => (
                          <div key={d.name} className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                            <span className="text-slate-300">{d.name}</span>
                            <span className="text-white font-bold mr-auto">{d.value}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
                      لا توجد بيانات
                    </div>
                  )}
                </div>

                {/* 2B. Area: الأرباح التراكمية */}
                <div className="bg-slate-900/70 p-5 rounded-2xl border border-white/10 lg:col-span-2">
                  <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-emerald-400" />
                      <h3 className="text-base font-bold text-white">حركة الأرباح التراكمية</h3>
                    </div>
                    {cumulativeProfitData.length > 0 && (
                      <Badge variant="outline" className="text-[11px] text-emerald-300 border-emerald-500/30 bg-emerald-500/10">
                        تراكمي: {(() => {
                          // RULE20-P3 + Rule 27: cumulative now comes from Python (or null).
                          // لا fabrication — نعرض `—` لما null.
                          const lastCum = cumulativeProfitData[cumulativeProfitData.length - 1].cumulative;
                          if (lastCum == null) return '—';
                          return `${lastCum > 0 ? '+' : ''}${lastCum.toFixed(1)}%`;
                        })()}
                      </Badge>
                    )}
                  </div>
                  {cumulativeProfitData.length > 1 ? (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={cumulativeProfitData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                          <defs>
                            <linearGradient id="cumProfitGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.5} />
                              <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--foreground) / 0.05)" />
                          <XAxis dataKey="label" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} hide />
                          <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} width={40} />
                          <RTooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--background))',
                              border: '1px solid hsl(var(--foreground) / 0.1)',
                              borderRadius: '12px',
                              fontSize: '12px',
                            }}
                            formatter={(value: number, name: string) => {
                              // RULE20-P3 + Rule 27: cumulative may be null (Python must provide).
                              // trade is Python-provided per-trade return (display rounding only).
                              if (value == null) return ['—', name === 'cumulative' ? 'تراكمي' : 'الصفقة'];
                              return [`${value > 0 ? '+' : ''}${value.toFixed(2)}%`, name === 'cumulative' ? 'تراكمي' : 'الصفقة'];
                            }}
                          />
                          <ReferenceLine y={0} stroke="hsl(var(--foreground) / 0.2)" strokeDasharray="3 3" />
                          <Area
                            type="monotone"
                            dataKey="cumulative"
                            stroke="hsl(var(--success))"
                            strokeWidth={2.5}
                            fill="url(#cumProfitGrad)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
                      لا توجد صفقات مغلقة كافية
                    </div>
                  )}
                </div>
              </div>

              {/* ═══ 3. CHARTS GRID 2 — Bar شهري + Radar للشخصيات ═══ */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* 3A. Bar: العائد الشهري */}
                <div className="bg-slate-900/70 p-5 rounded-2xl border border-white/10">
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                    <BarChart3 className="w-5 h-5 text-amber-400" />
                    <h3 className="text-base font-bold text-white">العائد الشهري</h3>
                  </div>
                  {monthlyReturns.length > 0 ? (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={monthlyReturns} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--foreground) / 0.05)" />
                          <XAxis dataKey="month" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                          <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} width={40} />
                          <RTooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--background))',
                              border: '1px solid hsl(var(--foreground) / 0.1)',
                              borderRadius: '12px',
                              fontSize: '12px',
                            }}
                            formatter={(value: number) => {
                              // RULE20-P3 + Rule 27: monthly total may be null (Python must provide).
                              if (value == null) return ['—', 'العائد'];
                              return [`${value > 0 ? '+' : ''}${value.toFixed(2)}%`, 'العائد'];
                            }}
                          />
                          <ReferenceLine y={0} stroke="hsl(var(--foreground) / 0.2)" strokeDasharray="3 3" />
                          <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                            {monthlyReturns.map((entry, idx) => (
                              <Cell
                                key={`bar-${idx}`}
                                // RULE20-P3: null total → slate/neutral color (لا fabrication).
                                fill={entry.total == null
                                  ? 'hsl(var(--muted-foreground) / 0.3)'
                                  : entry.total >= 0 ? 'hsl(var(--success))' : 'hsl(var(--danger))'}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
                      لا توجد بيانات شهرية كافية
                    </div>
                  )}
                </div>

                {/* 3B. Radar: مقارنة الشخصيات */}
                <div className="bg-slate-900/70 p-5 rounded-2xl border border-white/10">
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                    <Gauge className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-base font-bold text-white">مقارنة الشخصيات</h3>
                  </div>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={personaRadarData} outerRadius="75%">
                        <PolarGrid stroke="hsl(var(--foreground) / 0.1)" />
                        <PolarAngleAxis dataKey="axis" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                        <RTooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--background))',
                            border: '1px solid hsl(var(--foreground) / 0.1)',
                            borderRadius: '12px',
                            fontSize: '12px',
                          }}
                        />
                        {/* <Radar name="المضارب" dataKey="gambler" stroke="hsl(var(--chart-4))" fill="hsl(var(--chart-4))" fillOpacity={0.3} /> */}
                        <Radar name="المتوازن" dataKey="balanced" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.3} />
                        <Legend
                          wrapperStyle={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}
                          iconType="circle"
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* ═══ 4. HIGHLIGHTS: Top Gains + Fastest Gains ═══ */}
              {/* REPORT-REDESIGN: استبدلنا أيقونة Trophy بأيقونة Award الاحترافية. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Top Gains */}
                <HighlightCard
                  title="أعلى المكاسب"
                  subtitle="الأعلى عائداً"
                  icon={<Award className="w-5 h-5 text-amber-400" />}
                  accentBorder="border-amber-500/30"
                  items={topGains.map((item) => ({
                    ticker: item.ticker,
                    nameAr: item.nameAr,
                    returnPct: Number(item.returnPct || 0),
                    meta: `دخول ${fmtPrice(item.entryPrice)}`,
                    rightMeta: `${item.daysSinceEntry || 1} يوم`,
                    accentText: 'text-amber-400',
                  }))}
                  placeholder="لا توجد صفقات رابحة في هذه الفترة"
                />

                {/* Fastest Gains */}
                <HighlightCard
                  title="أسرع الصفقات"
                  subtitle="تحقيق الهدف في مدة قصيرة"
                  icon={<Zap className="w-5 h-5 text-emerald-400" />}
                  accentBorder="border-emerald-500/30"
                  items={fastestGains.map((item) => ({
                    ticker: item.ticker,
                    nameAr: item.nameAr,
                    returnPct: Number(item.returnPct || 0),
                    meta: `دخول ${fmtPrice(item.entryPrice)}`,
                    rightMeta: `${item.daysSinceEntry || 1} يوم`,
                    accentText: 'text-emerald-400',
                  }))}
                  placeholder="لا توجد صفقات سريعة في هذه الفترة"
                />
              </div>

              {/* Top Losers — صف سطر جديد تحت الـ Top Gains + Fastest Gains */}
              <div className="mt-5">
                <HighlightCard
                  title="أعلى الخسائر"
                  subtitle="الأكثر انخفاضاً في الفترة"
                  icon={<TrendingDown className="w-5 h-5 text-rose-400" />}
                  accentBorder="border-rose-500/30"
                  items={topLosses.map((item) => ({
                    ticker: item.ticker,
                    nameAr: item.nameAr,
                    returnPct: Number(item.returnPct || 0),
                    meta: `دخول ${fmtPrice(item.entryPrice)}`,
                    rightMeta: `${item.daysSinceEntry || 1} يوم`,
                    accentText: 'text-rose-400',
                  }))}
                  placeholder="لا توجد صفقات خاسرة في هذه الفترة"
                />
              </div>

              {/* FIX-5C: TRAILING_PROFIT highlights — لو فيه صفقات خرجت بربح جزئي،
                  نعرض أعلى 4 منها في HighlightCard منفصلة بـ لون زمردي مميز عن Top Gains
                  (الأصفر). ده بـ يـ differentiate بين "هدف محقق كامل" (Top Gains) و
                  "جني أرباح قبل الهدف" (Trailing Profit). الكارد بـ يظهر بس لو فيه عدد > 0. */}
              {/* REPORT-REDESIGN: استبدلنا أيقونة Trophy بأيقونة HandCoins + أزلنا emoji */}
              {/* العشوائي من العنوان (لغة احترافية للمستثمرين). */}
              {topTrailingProfit.length > 0 && (
                <div className="mt-5">
                  <HighlightCard
                    title="صفقات أُغلقت بربح جزئي"
                    subtitle="جني أرباح قبل الهدف الكامل"
                    icon={<HandCoins className="w-5 h-5 text-teal-400" />}
                    accentBorder="border-teal-500/30"
                    items={topTrailingProfit.map((item) => ({
                      ticker: item.ticker,
                      nameAr: item.nameAr,
                      returnPct: Number(item.returnPct || 0),
                      meta: `دخول ${fmtPrice(item.entryPrice)}`,
                      rightMeta: `${item.daysSinceEntry || 1} يوم`,
                      accentText: 'text-teal-400',
                    }))}
                    placeholder="لا توجد صفقات trailing profit في هذه الفترة"
                  />
                </div>
              )}

              {/* ═══ 5. PERSONA BREAKDOWN — unified 3-col layout ═══ */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-amber-400" />
                  <h3 className="text-lg font-bold text-white">الأداء حسب استراتيجية المستثمر</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <PersonaCard
                    icon={<Flame className="w-5 h-5 text-orange-400" />}
                    title="المضارب"
                    subtitle="خاطف (1-5 أيام)"
                    description="الزخم السريع واقتناص الفتحات"
                    accentRing="border-orange-500/30"
                    accentBar="bg-orange-500"
                    stats={{
                      winRate: statsByPersona?.gambler?.winRate ?? null,
                      profitFactor: statsByPersona?.gambler?.profitFactor ?? 0,
                      avgWinPct: statsByPersona?.gambler?.avgWinPct ?? 0,
                      wins: statsByPersona?.gambler?.wins ?? 0,
                      losses: statsByPersona?.gambler?.losses ?? 0,
                    }}
                    winRateColor="text-orange-400"
                  />

                  <PersonaCard
                    icon={<Scale className="w-5 h-5 text-teal-400" />}
                    title="المتوازن"
                    subtitle="متوسط (2-6 أسابيع)"
                    description="موجات الصعود المنظمة"
                    accentRing="border-teal-500/30"
                    accentBar="bg-teal-500"
                    stats={{
                      winRate: statsByPersona?.balanced?.winRate ?? null,
                      profitFactor: statsByPersona?.balanced?.profitFactor ?? 0,
                      avgWinPct: statsByPersona?.balanced?.avgWinPct ?? 0,
                      wins: statsByPersona?.balanced?.wins ?? 0,
                      losses: statsByPersona?.balanced?.losses ?? 0,
                    }}
                    winRateColor="text-teal-400"
                  />

                  <PersonaCard
                    icon={<Shield className="w-5 h-5 text-emerald-400" />}
                    title="المستثمر"
                    subtitle="استثماري (6-12 شهر)"
                    description="القيمة العادلة والأمان المالي"
                    accentRing="border-emerald-500/30"
                    accentBar="bg-emerald-500"
                    stats={{
                      winRate: statsByPersona?.conservative?.winRate ?? null,
                      profitFactor: statsByPersona?.conservative?.profitFactor ?? 0,
                      avgWinPct: statsByPersona?.conservative?.avgWinPct ?? 0,
                      wins: statsByPersona?.conservative?.wins ?? 0,
                      losses: statsByPersona?.conservative?.losses ?? 0,
                    }}
                    winRateColor="text-emerald-400"
                  />
                </div>
              </div>

              {/* ═══ 6. MISSED OPPORTUNITIES — الفرص الضائعة والتحليل البعدي ═══ */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                  <h3 className="text-lg font-bold text-white">الفرص الضائعة والتحليل البعدي</h3>
                  <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/30 bg-amber-500/10 whitespace-nowrap">
                    حد التحرك ≥ 10%
                  </Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Missed Bulls — قلنا بيع والسهم طلع */}
                  <MissedOppCard
                    title="فرص ضاعت"
                    subtitle="قلنا بيع والسهم طلع"
                    icon={<TrendingUp className="w-5 h-5 text-amber-400" />}
                    accent="amber"
                    items={missedOpps?.missed_bulls}
                    loading={missedOppsLoading}
                  />
                  {/* False Positives — قلنا شراء والسهم نزل */}
                  <MissedOppCard
                    title="توقعات خاطئة"
                    subtitle="قلنا شراء والسهم نزل"
                    icon={<TrendingDown className="w-5 h-5 text-rose-400" />}
                    accent="rose"
                    items={missedOpps?.false_positives}
                    loading={missedOppsLoading}
                  />
                  {/* Correct Buys — قلنا شراء والسهم طلع */}
                  <MissedOppCard
                    title="توقعات صحيحة (شراء)"
                    subtitle="قلنا شراء والسهم طلع"
                    icon={<CheckCircle className="w-5 h-5 text-emerald-400" />}
                    accent="emerald"
                    items={missedOpps?.correct_buys}
                    loading={missedOppsLoading}
                  />
                  {/* Correct Sells — قلنا بيع والسهم نزل */}
                  <MissedOppCard
                    title="توقعات صحيحة (بيع)"
                    subtitle="قلنا بيع والسهم نزل"
                    icon={<CheckCircle className="w-5 h-5 text-teal-400" />}
                    accent="teal"
                    items={missedOpps?.correct_sells}
                    loading={missedOppsLoading}
                  />
                </div>
              </div>

              {/* ═══ 7. Win/Loss Proportion Bar + Footer ═══ */}
              <div className="bg-slate-900/60 p-6 rounded-2xl border border-white/10 space-y-5">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-300 font-bold">توازن الأداء</span>
                  <span className="text-emerald-400 font-bold">
                    {stats.wins} رابحة <span className="text-slate-500">/</span>{' '}
                    <span className="text-rose-400">{stats.losses} خاسرة</span>
                  </span>
                </div>

                {/* Proportion bar */}
                <div className="h-5 w-full bg-slate-800 rounded-full overflow-hidden flex border border-white/10">
                  {/* RULE20-P3 + Rule 27: winRate may be null (Python must provide). Bar shows
                      neutral split (50/50) when null — NO fabrication of fake percentages. */}
                  <div
                    className="h-full bg-gradient-to-l from-emerald-500 to-teal-400 transition-all duration-1000 flex items-center justify-center"
                    style={{ width: `${winRate == null ? 50 : winRate}%` }}
                  >
                    {winRate != null && winRate > 15 && (
                      <span className="text-xs font-black text-emerald-950 px-2">
                        {winRate.toFixed(0)}% رابحة
                      </span>
                    )}
                    {winRate == null && (
                      <span className="text-xs font-black text-slate-300 px-2">—</span>
                    )}
                  </div>
                  <div
                    className="h-full bg-gradient-to-l from-rose-500 to-red-600 transition-all duration-1000 flex items-center justify-center"
                    style={{ width: `${winRate == null ? 50 : 100 - winRate}%` }}
                  >
                    {winRate != null && 100 - winRate > 15 && (
                      <span className="text-xs font-black text-white px-2">
                        {(100 - winRate).toFixed(0)}% خاسرة
                      </span>
                    )}
                  </div>
                </div>

                {/* REPORT-REDESIGN: Professional Disclaimer — تنبيه استثماري احترافي
                    يوضح أن التقرير لأغراض إعلامية فقط ولا يُعد نصيحة استثمارية.
                    يظهر داخل الـ PNG المُصدَّر علشان يوصل للمستثمر اللي بيشوف البطاقة. */}
                <div className="mt-2 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-[11px] sm:text-xs text-slate-300 leading-relaxed space-y-1">
                      <p className="font-bold text-amber-300">تنبيه للمستثمر</p>
                      <p>
                        هذا التقرير لأغراض إعلامية فقط ولا يُعد نصيحة استثمارية أو توصية بالبيع أو الشراء.
                        الأداء السابق لا يضمن النتائج المستقبلية. القرار الاستثماري النهائي ومسؤولية المخاطر
                        تقع على عاتق المستثمر وحده. جميع الأرقام مستمدة من قاعدة بيانات التتبُّع الفعلية
                        للمنصة ({selectedMarket}) خلال الفترة المحددة.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="pt-4 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span className="text-xs sm:text-sm text-center md:text-right">
                      {PLATFORM_NAME} — {PLATFORM_TAGLINE} | {MARKET_NAMES_AR[selectedMarket] || selectedMarket} · {timeframeLabel}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-slate-500 flex-shrink-0">
                    {new Date().toLocaleDateString('ar-EG')}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sub-components — موحّدة لضمان التناسق
// ════════════════════════════════════════════════════════════════════════════

const KPI_ACCENTS: Record<string, { ring: string; bar: string; value: string; glow: string }> = {
  emerald: { ring: 'border-emerald-500/30', bar: 'bg-emerald-500', value: 'text-emerald-400', glow: 'bg-emerald-500/10' },
  amber: { ring: 'border-amber-500/30', bar: 'bg-amber-500', value: 'text-amber-400', glow: 'bg-amber-500/10' },
  rose: { ring: 'border-rose-500/30', bar: 'bg-rose-500', value: 'text-rose-400', glow: 'bg-rose-500/10' },
};

function KpiCard({
  label,
  value,
  valueSuffix,
  subtext,
  accent,
  isSplit = false,
  icon,
}: {
  label: string;
  value: string;
  valueSuffix?: string;
  subtext: string;
  accent: 'emerald' | 'amber' | 'rose';
  isSplit?: boolean;
  icon?: React.ReactNode;
}) {
  const a = KPI_ACCENTS[accent];
  return (
    <div className={cn(
      'relative bg-slate-900/70 p-5 rounded-2xl border overflow-hidden flex flex-col justify-between min-h-[140px]'
    , a.ring)}>
      <div className={cn('absolute top-0 right-0 w-1.5 h-full', a.bar)} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-300 font-bold leading-snug">{label}</p>
        {icon && <span className={cn('flex-shrink-0', a.value)}>{icon}</span>}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5 flex-wrap">
        <span className={cn('text-3xl sm:text-4xl font-black leading-none', a.value)}>
          {value}
        </span>
        {valueSuffix && (
          <span className="text-base font-bold text-slate-400">{valueSuffix}</span>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-2 leading-relaxed">{subtext}</p>
    </div>
  );
}

interface HighlightItem {
  ticker: string;
  nameAr?: string;
  returnPct: number;
  meta: string;
  rightMeta: string;
  accentText: string;
}

function HighlightCard({
  title,
  subtitle,
  icon,
  accentBorder,
  items,
  placeholder,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accentBorder: string;
  items: HighlightItem[];
  placeholder: string;
}) {
  return (
    <div className={cn('bg-slate-900/70 p-6 rounded-2xl border space-y-4', accentBorder)}>
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-base sm:text-lg font-bold text-white">{title}</h3>
        </div>
        <Badge variant="outline" className="text-[11px] text-slate-300 border-white/20 bg-white/5">
          {subtitle}
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.length > 0 ? (
          items.map((item, idx) => (
            <div
              key={`${title}-${item.ticker}-${idx}`}
              className="bg-slate-950/70 p-4 rounded-xl border border-white/10 hover:border-white/25 transition-colors flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-white text-base font-mono">{item.ticker}</span>
                <span className={cn('font-black text-lg', item.accentText)}>
                  {item.returnPct >= 0 ? '+' : ''}{(item.returnPct ?? 0).toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-slate-300 truncate">{item.nameAr || item.ticker}</p>
              <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-white/5">
                <span>{item.meta}</span>
                <span className="font-bold text-slate-300">{item.rightMeta}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-2 text-center py-8 text-slate-400 text-sm">
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}

interface PersonaStats {
  // RULE20-P3: winRate must come from Python (Rule 20). null when Python stat missing (Rule 27).
  winRate: number | null;
  profitFactor: number;
  avgWinPct: number;
  wins: number;
  losses: number;
}

function PersonaCard({
  icon,
  title,
  subtitle,
  description,
  accentRing,
  accentBar,
  stats,
  winRateColor,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  accentRing: string;
  accentBar: string;
  stats: PersonaStats;
  winRateColor: string;
}) {
  return (
    <div className={cn('relative bg-slate-900/70 p-6 rounded-2xl border space-y-4 overflow-hidden', accentRing)}>
      <div className={cn('absolute top-0 right-0 w-1.5 h-full', accentBar)} />

      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {icon}
            <span className="font-black text-lg text-white">{title}</span>
          </div>
          <Badge variant="outline" className="text-[10px] text-slate-300 border-white/20 bg-white/5 whitespace-nowrap">
            {subtitle}
          </Badge>
        </div>
        <p className="text-sm text-slate-400 mt-1.5">{description}</p>
      </div>

      {/* Big win rate */}
      <div className="py-3 border-y border-white/10 text-center">
        <p className="text-xs text-slate-400 font-bold mb-1">نسبة النجاح</p>
        <p className={cn('text-3xl font-black leading-none', winRateColor)}>
          {stats.winRate == null ? '—' : `${stats.winRate.toFixed(1)}%`}
        </p>
      </div>

      {/* Stats grid — unified, clean */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <StatRow label="معامل الربحية" value={stats.profitFactor >= 999 ? '∞' : (stats.profitFactor ?? 0).toFixed(2)} valueClass="text-amber-400" />
        <StatRow label="متوسط الربح" value={`+${(stats.avgWinPct ?? 0).toFixed(1)}%`} valueClass="text-emerald-400" />
        <StatRow label="رابحة" value={`${stats.wins}`} valueClass="text-emerald-400" />
        <StatRow label="خاسرة" value={`${stats.losses}`} valueClass="text-rose-400" />
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="bg-slate-950/40 px-3 py-2 rounded-lg border border-white/5">
      <p className="text-[11px] text-slate-400 leading-tight">{label}</p>
      <p className={cn('font-black text-base mt-0.5', valueClass)}>{value}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MissedOppCard — بطاقة الفرص الضائعة والتحليل البعدي
// بتعمل review على التوقعات السابقة: فرص ضاعت / توقعات خاطئة / توقعات صحيحة (شراء/بيع)
// ════════════════════════════════════════════════════════════════════════════
const MISSED_OPP_ACCENTS: Record<string, { ring: string; bar: string; value: string }> = {
  amber: { ring: 'border-amber-500/30', bar: 'bg-amber-500', value: 'text-amber-400' },
  rose: { ring: 'border-rose-500/30', bar: 'bg-rose-500', value: 'text-rose-400' },
  emerald: { ring: 'border-emerald-500/30', bar: 'bg-emerald-500', value: 'text-emerald-400' },
  teal: { ring: 'border-teal-500/30', bar: 'bg-teal-500', value: 'text-teal-400' },
};

function signalBadgeClass(signal: string): string {
  const s = (signal || '').toUpperCase();
  if (s === 'BUY' || s === 'STRONG_BUY') {
    return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10';
  }
  if (s === 'SELL' || s === 'STRONG_SELL') {
    return 'text-rose-300 border-rose-500/30 bg-rose-500/10';
  }
  return 'text-slate-300 border-white/20 bg-white/5';
}

function MissedOppCard({
  title,
  subtitle,
  icon,
  accent,
  items,
  loading,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: 'amber' | 'rose' | 'emerald' | 'teal';
  items?: MissedOpportunityItem[];
  loading: boolean;
}) {
  const a = MISSED_OPP_ACCENTS[accent];
  const list = (items || []).slice(0, 8);
  const count = items?.length ?? 0;

  return (
    <div className={cn('relative bg-slate-900/70 p-5 rounded-2xl border space-y-3 overflow-hidden', a.ring)}>
      <div className={cn('absolute top-0 right-0 w-1.5 h-full', a.bar)} />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <div className="min-w-0">
            <h4 className="text-sm sm:text-base font-bold text-white truncate">{title}</h4>
            <p className="text-[11px] sm:text-xs text-slate-400 truncate">{subtitle}</p>
          </div>
        </div>
        <Badge variant="outline" className={cn('text-[11px] flex-shrink-0', a.value, a.ring, 'bg-transparent')}>
          {count} سهم
        </Badge>
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={`mo-sk-${i}`} className="h-14 w-full bg-slate-800/50 rounded-lg" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-sm">
          لا توجد بيانات
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {list.map((item) => {
            const change = Number(item.pct_change ?? 0);
            const changePositive = change >= 0;
            return (
              <div
                key={`mo-${item.id}-${item.ticker}`}
                className="bg-slate-950/70 p-3 rounded-lg border border-white/10 hover:border-white/25 transition-colors flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-black text-white text-sm font-mono flex-shrink-0">{item.ticker}</span>
                    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', signalBadgeClass(item.signal))}>
                      {item.signal}
                    </Badge>
                  </div>
                  <span className={cn('font-black text-sm sm:text-base flex-shrink-0', changePositive ? 'text-emerald-400' : 'text-rose-400')}>
                    {changePositive ? '+' : ''}{(change ?? 0).toFixed(2)}%
                  </span>
                </div>
                {item.name && (
                  <p className="text-[11px] text-slate-300 truncate">{item.name}</p>
                )}
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-white/5">
                  <span className="font-mono">
                    {fmtPrice(item.entry_price)} → {fmtPrice(item.current_price)}
                  </span>
                  {item.prediction_date && (
                    <span className="text-slate-500 font-mono">
                      {String(item.prediction_date).slice(0, 10)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
