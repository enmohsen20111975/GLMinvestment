'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import {
  TrendingUp, TrendingDown, Target, Shield, AlertTriangle,
  CheckCircle, Loader2, RefreshCw, Search, BarChart3,
  Activity, Zap, Filter, Clock,
  PieChart, Database, Brain, Wifi, WifiOff, ArrowDownUp, ShieldAlert,
  Trophy, CalendarCheck, Hourglass, CircleDot, Flame, History
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';

// ============================================================================
// Types
// ============================================================================

interface StoredAnalysisItem {
  ticker: string;
  market: string;
  // Python backend returns camelCase
  maestroScore?: number;
  maestro_score?: number;
  recommendation: string;
  recommendationAr?: string;
  recommendation_ar?: string;
  confidence: number;
  entry?: { price: number; target: number; stopLoss: number; riskReward: number };
  // flat fields (background_analyzer stored in flat format)
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  risk_reward?: number;
  regime?: string | { phase: string };
  volume?: { ratio: number; liquidityRating: string };
  volume_ratio?: number;
  liquidity_rating?: string;
  updatedAt?: string;
  updated_at?: string;
  analysisJson?: {
    narrative?: { line1: string; line2: string; line3: string };
    personas?: {
      hunter?: { score: number; verdict: string };
      momentum?: { score: number; verdict: string };
      value?: { score: number; verdict: string };
    };
    // Unified Persona Engine (V4.0): gambler + investor + story_arc
    gambler?: {
      verdict?: string;
      score?: number;
      reason?: string;
      signal?: string;
      conditions?: string[];
      entry?: number | null;
      target?: number | null;
      stop?: number | null;
    };
    investor?: {
      verdict?: string;
      score?: number;
      reason?: string;
      signal?: string;
      conditions?: string[];
      entry?: number | null;
      target?: number | null;
      stop?: number | null;
      timeframe?: string;
    };
    story_arc?: {
      price_movement?: string;
      historical_context?: string;
      dual_verdict?: { gambler: string; investor: string };
    };
  };
}

interface EngineStatus {
  isRunning: boolean;
  lastFullAnalysis: string | null;
  lastRun: string | null;
  nextScheduledRun: string | null;
  totalAnalyzed: number;
  errorCount: number;
}

interface Stats {
  totalAnalyses: number;
  buySignals: number;
  strongBuySignals: number;
  avgScore: number;
}

// ============================================================================
// Constants
// ============================================================================

// All 7 markets supported by the backend (مصر / السعودية / الكويت / قطر / الذهب والمعادن / المؤشرات / العملات)
const MARKETS = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'COMMODITIES', 'INDICES', 'FOREX'] as const;

// خريطة أسماء الأسواق بالعربي (تشمل الـ 7 أسواق، تفوق ما هو متاح في MARKET_NAMES_AR من الـ store)
const MARKET_NAMES_AR_FULL: Record<string, string> = {
  EGX: 'مصر (EGX)',
  TADAWUL: 'السعودية (TADAWUL)',
  KSE: 'الكويت (KSE)',
  QSE: 'قطر (QSE)',
  COMMODITIES: 'الذهب والمعادن',
  INDICES: 'المؤشرات',
  FOREX: 'العملات',
  // compat keys (in case old code references them)
  KSA: 'السعودية (TADAWUL)',
  CRYPTO: 'الكريبتو',
};

const AUTO_REFRESH_MS = 5 * 60 * 1000; // كل 5 دقائق
// Python backend على port 8010 — نوصله عبر Caddy gateway باستخدام XTransformPort
// (مش http://localhost:8010 مباشرة عشان المتصفح خارج السيرفر مش هيوصله)
const PYTHON_BACKEND_BASE = '/api';
const XFORM = 'XTransformPort=8010';
const withXForm = (path: string) =>
  path.includes('?') ? `${path}&${XFORM}` : `${path}?${XFORM}`;

// Helper: normalize camelCase/snake_case fields from Python backend
function getField(a: StoredAnalysisItem, field: 'recommendation'): string;
function getField(a: StoredAnalysisItem, field: 'score'): number;
function getField(a: StoredAnalysisItem, field: 'rec_ar'): string;
function getField(a: StoredAnalysisItem, field: 'updated'): string;
function getField(a: StoredAnalysisItem, field: 'entry_price'): number;
function getField(a: StoredAnalysisItem, field: 'target'): number;
function getField(a: StoredAnalysisItem, field: 'stop_loss'): number;
function getField(a: StoredAnalysisItem, field: 'risk_reward'): number;
function getField(a: StoredAnalysisItem, field: 'liquidity'): string;
function getField(a: StoredAnalysisItem, field: any): any {
  switch (field) {
    case 'recommendation': return a.recommendation || '';
    case 'score': return a.maestroScore ?? a.maestro_score ?? 0;
    case 'rec_ar': return a.recommendationAr ?? a.recommendation_ar ?? a.recommendation ?? '';
    case 'updated': return a.updatedAt ?? a.updated_at ?? '';
    case 'entry_price': return a.entry?.price ?? a.entry_price ?? 0;
    case 'target': return a.entry?.target ?? a.target_price ?? 0;
    case 'stop_loss': return a.entry?.stopLoss ?? a.stop_loss ?? 0;
    case 'risk_reward': return a.entry?.riskReward ?? a.risk_reward ?? 0;
    case 'liquidity': return a.volume?.liquidityRating ?? a.liquidity_rating ?? '';
    default: return (a as any)[field];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

const getRecommendationColor = (rec: string): string => {
  const r = rec.toLowerCase();
  if (r === 'strong_buy') return 'text-emerald-600 dark:text-emerald-400';
  if (r === 'buy') return 'text-green-600 dark:text-green-400';
  if (r === 't1_buy') return 'text-cyan-600 dark:text-cyan-400';
  if (r === 'swing_buy') return 'text-teal-600 dark:text-teal-400';
  if (r === 'hold') return 'text-gray-500 dark:text-gray-400';
  if (r === 'sell') return 'text-red-500 dark:text-red-400';
  if (r === 'strong_sell') return 'text-red-700 dark:text-red-500';
  return 'text-gray-500';
};

const getRecommendationBg = (rec: string): string => {
  const r = rec.toLowerCase();
  if (r === 'strong_buy') return 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800';
  if (r === 'buy') return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
  if (r === 't1_buy') return 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800';
  if (r === 'swing_buy') return 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800';
  if (r === 'hold') return 'bg-gray-50 dark:bg-gray-800/20 border-gray-200 dark:border-gray-700';
  if (r === 'sell' || r === 'strong_sell') return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
  return 'bg-gray-50 dark:bg-gray-800/20';
};

const getRecommendationBadge = (rec: string): string => {
  const r = rec.toLowerCase();
  if (r === 'strong_buy') return 'bg-emerald-500 text-white';
  if (r === 'buy') return 'bg-green-500 text-white';
  if (r === 't1_buy') return 'bg-cyan-500 text-white';
  if (r === 'swing_buy') return 'bg-teal-500 text-white';
  if (r === 'hold') return 'bg-gray-500 text-white';
  if (r === 'sell') return 'bg-red-500 text-white';
  if (r === 'strong_sell') return 'bg-red-700 text-white';
  return 'bg-gray-400 text-white';
};

const getScoreColor = (score: number): string => {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 65) return 'text-green-600 dark:text-green-400';
  if (score >= 55) return 'text-yellow-600 dark:text-yellow-400';
  if (score >= 45) return 'text-orange-500 dark:text-orange-400';
  return 'text-red-500 dark:text-red-400';
};

const isBuySignal = (rec: string) =>
  ['buy', 'strong_buy', 't1_buy', 'swing_buy'].includes(rec.toLowerCase());

// ============================================================================
// Persona Helpers (للنظام: 🎯 المضارب + 🏦 المستثمر)
// ============================================================================

type PersonaKey = 'gambler' | 'investor';
type VerdictCategory = 'opportunity' | 'wait' | 'avoid' | 'unknown';

/** تصنيف الـ verdict لكلمة عربي → فئة */
function verdictCategory(verdict: string | undefined): VerdictCategory {
  const v = (verdict || '').toLowerCase();
  if (v.includes('فرصة') || v.includes('ادخل') || v.includes('قوي') || v.includes('شراء')) {
    return 'opportunity';
  }
  if (v.includes('انتظر')) {
    return 'wait';
  }
  if (v.includes('ابعد') || v.includes('بيع') || v.includes('تجنب')) {
    return 'avoid';
  }
  return 'unknown';
}

/** ترتيب الـ verdict (الفرص الأول، بعدين انتظر، بعدين ابعد) */
function verdictRank(verdict: string | undefined): number {
  const cat = verdictCategory(verdict);
  return cat === 'opportunity' ? 0 : cat === 'wait' ? 1 : cat === 'avoid' ? 2 : 3;
}

/** نص الفئة بالعربي */
function verdictCategoryLabel(cat: VerdictCategory): string {
  return cat === 'opportunity' ? 'فرصة' : cat === 'wait' ? 'انتظر' : cat === 'avoid' ? 'ابعد' : 'غير معروف';
}

/** لون الـ verdict */
function verdictColor(verdict: string | undefined): { text: string; bg: string; border: string; dot: string } {
  const cat = verdictCategory(verdict);
  if (cat === 'opportunity') {
    return { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-950/40', border: 'border-emerald-300 dark:border-emerald-800', dot: 'bg-emerald-500' };
  }
  if (cat === 'wait') {
    return { text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-950/40', border: 'border-amber-300 dark:border-amber-800', dot: 'bg-amber-500' };
  }
  if (cat === 'avoid') {
    return { text: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-950/40', border: 'border-red-300 dark:border-red-800', dot: 'bg-red-500' };
  }
  return { text: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-800/40', border: 'border-gray-300 dark:border-gray-700', dot: 'bg-gray-400' };
}

/** نسبة العائد المتوقعة من entry/target (لو متاحين) */
function personaReturnPct(persona: { entry?: number | null; target?: number | null } | undefined): number {
  if (!persona?.entry || !persona?.target || persona.entry <= 0) return -1;
  return ((persona.target - persona.entry) / persona.entry) * 100;
}

/** أعلى سكور برسونا للسهم (للـ comparison tab) */
function maxPersonaScore(a: StoredAnalysisItem): number {
  const g = a.analysisJson?.gambler?.score ?? 0;
  const i = a.analysisJson?.investor?.score ?? 0;
  return Math.max(g, i);
}

const formatTimeAgo = (isoStr: string | null): string => {
  if (!isoStr) return 'غير معروف';
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return 'منذ أقل من دقيقة';
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
  return `منذ ${Math.floor(diff / 86400)} يوم`;
};

// ============================================================================
// Prediction Types & Helpers (التوقعات مع النتائج)
// ============================================================================

interface CandlePattern {
  name?: string;
  name_ar?: string;
  type?: string;
  strength?: number;
}

interface PredictionItem {
  id: string;
  symbol: string;
  name?: string;
  market: string;
  market_ar?: string;
  signal?: string;          // BUY | SELL | HOLD
  signal_ar?: string;
  score?: number;
  confidence?: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  risk_reward?: number;
  status: 'PENDING' | 'TARGET_HIT' | 'STOPPED' | 'EXPIRED' | string;
  final_price?: number | null;
  profit_loss_percent?: number | null;
  hit_target?: number;
  hit_stop_loss?: number;
  target_hit_date?: string | null;
  stop_hit_date?: string | null;
  evaluation_date?: string | null;
  holding_days?: number | null;
  analysis_methods?: string[] | null;
  reasons?: string[] | null;
  trend_direction?: string | null;
  rsi_value?: number | null;
  macd_histogram?: number | null;
  candle_patterns?: CandlePattern[] | null;
  sr_zone?: string | null;
  sr_support?: number | null;
  sr_resistance?: number | null;
  atr_value?: number | null;
  regime?: string | null;
  prediction_date?: string | null;
  created_at?: string | null;
}

interface PredictionStats {
  total?: number;
  closed_count?: number;
  win_count?: number;
  loss_count?: number;
  avg_pnl?: number;
  win_rate?: number;
  avg_score?: number;
  by_status?: Record<string, number>;
  by_signal?: Record<string, number>;
}

/** نص حالة التوقع بالعربي */
function predStatusText(status: string): string {
  switch (status) {
    case 'TARGET_HIT': return '🎯 حقق الهدف';
    case 'STOPPED': return '🛑 وقف الخسارة';
    case 'EXPIRED': return '⏰ انتهى';
    case 'PENDING':
    default: return '⏳ مفتوح';
  }
}

/** فئات لون الـ badge حسب الحالة */
function predStatusBadge(status: string): string {
  switch (status) {
    case 'TARGET_HIT': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800';
    case 'STOPPED': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-300 dark:border-rose-800';
    case 'EXPIRED': return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-300 dark:border-amber-800';
    case 'PENDING':
    default: return 'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400 border-teal-300 dark:border-teal-800';
  }
}

/** لون العائد (أخضر للإيجابي / أحمر للسلبي) */
function pnlColor(pnl: number | null | undefined): string {
  if (pnl == null) return 'text-muted-foreground';
  return pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
}

/** لون إشارة التوقع (BUY/SELL/HOLD) */
function signalBadge(signal?: string): { cls: string; text: string } {
  const s = (signal || '').toUpperCase();
  if (s === 'BUY') return { cls: 'bg-emerald-500 text-white', text: '🟢 شراء' };
  if (s === 'SELL') return { cls: 'bg-rose-500 text-white', text: '🔴 بيع' };
  return { cls: 'bg-gray-400 text-white', text: '⏸️ انتظار' };
}

/** تنسيق السعر بصيغة mono */
function fmtPrice(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(digits);
}

/** تنسيق نسبة مئوية مع إشارة */
function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  const s = n > 0 ? '+' : '';
  return `${s}${Number(n).toFixed(digits)}%`;
}

// ============================================================================
// Main Component
// ============================================================================

export function StoredAnalysisView() {
  const { loadStockDetail } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [analyses, setAnalyses] = useState<StoredAnalysisItem[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'gambler' | 'investor' | 'comparison'>('gambler');
  // top-level section: live analyses vs predictions-with-outcomes
  const [activeSection, setActiveSection] = useState<'analyses' | 'predictions'>('analyses');
  const [verdictFilter, setVerdictFilter] = useState<'all' | 'opportunity' | 'wait' | 'avoid'>('all');
  const [sortBy, setSortBy] = useState<'score' | 'verdict' | 'return'>('score');
  const [searchTicker, setSearchTicker] = useState('');
  const [selectedMarket, setSelectedMarket] = useState('EGX');
  const [countdown, setCountdown] = useState(AUTO_REFRESH_MS / 1000);

  // predictions state (التوقعات مع النتائج)
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [closedPredictions, setClosedPredictions] = useState<PredictionItem[]>([]);
  const [predStats, setPredStats] = useState<PredictionStats | null>(null);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [predictionsError, setPredictionsError] = useState<string | null>(null);

  const refreshTimer = useRef<NodeJS.Timeout | null>(null);
  const countdownTimer = useRef<NodeJS.Timeout | null>(null);

  // ------------------------------------------------------------------
  // Fetch engine status from Python backend
  // (DECOUPLED from data display — engine status check failure must NOT block showing data)
  // ------------------------------------------------------------------
  const fetchEngineStatus = useCallback(async () => {
    try {
      // Use the Next.js proxy route /api/analysis/status?type=analyzer
      // (calling /api/analyzer/status directly through Caddy conflicts with Next.js routing)
      const r = await fetch('/api/analysis/status?type=analyzer', {
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const json = await r.json();
        setEngineStatus(json.data || json);
        // The engine endpoint returning 200 means it's reachable.
        // isRunning:false just means it's idle between analysis cycles — NOT disconnected.
        setBackendOnline(true);
      } else {
        // Don't blank out data — just mark engine status as unknown.
        setBackendOnline(false);
      }
    } catch {
      setBackendOnline(false);
    }
  }, []);

  // ------------------------------------------------------------------
  // Fetch stored analyses from Python backend's stored-analysis endpoint
  // (DECOUPLED — data renders whether or not the engine is "online")
  // ------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // جلب التحليلات من Python backend عبر Caddy gateway (XTransformPort=8010)
      // مش نستخدم http://localhost:8010 مباشرة عشان متصفح المستخدم مش هيوصله
      const url = withXForm(
        `${PYTHON_BACKEND_BASE}/stored-analysis/results?market=${selectedMarket}&limit=300&min_score=0`
      );
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const data = await r.json();

      // Python backend returns { success, data: [...], meta: {...} }
      const list: StoredAnalysisItem[] = data.data || data.results || data.analyses || [];
      setAnalyses(list);
      // Data successfully fetched — engine is online for data purposes
      setBackendOnline(true);
      setLastFetchTime(new Date());

      // حساب الإحصائيات
      const buys = list.filter(a => isBuySignal(getField(a, 'recommendation')));
      const strongBuys = list.filter(a =>
        ['strong_buy', 't1_buy'].includes(getField(a, 'recommendation').toLowerCase())
      );
      const avgScore = list.length > 0
        ? list.reduce((sum, a) => sum + (a.maestroScore ?? a.maestro_score ?? 0), 0) / list.length
        : 0;

      setStats({
        totalAnalyses: list.length,
        buySignals: buys.length,
        strongBuySignals: strongBuys.length,
        avgScore,
      });

      // جلب حالة المحرك (لا يمنع عرض البيانات)
      fetchEngineStatus().catch(() => {});

    } catch (err) {
      console.error('[StoredAnalysisView] fetch error:', err);

      // Fallback: جرّب Next.js API route (proxy بدون XTransformPort)
      try {
        const r2 = await fetch('/api/stored-analysis/results?market=' + selectedMarket + '&limit=200');
        if (r2.ok) {
          const d2 = await r2.json();
          const list2: StoredAnalysisItem[] = d2.data || d2.results || d2.analyses || [];
          setAnalyses(list2);
          setLastFetchTime(new Date());
          const buys2 = list2.filter(a => isBuySignal(getField(a, 'recommendation')));
          const avg2 = list2.length > 0
            ? list2.reduce((s, a) => s + (a.maestroScore ?? a.maestro_score ?? 0), 0) / list2.length : 0;
          setStats({ totalAnalyses: list2.length, buySignals: buys2.length, strongBuySignals: 0, avgScore: avg2 });
          setBackendOnline(true);
          fetchEngineStatus().catch(() => {});
        } else {
          // Data unavailable — but keep backendOnline reflecting engine status separately
          setBackendOnline(false);
        }
      } catch {
        toast.error('تعذّر الاتصال بالمحرك — تأكد أن python-backend شغّال');
        setBackendOnline(false);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedMarket, fetchEngineStatus]);

  // ------------------------------------------------------------------
  // Fetch unified predictions (open + closed with P&L)
  // (DECOUPLED from engine status — predictions come from a different DB/route)
  // ------------------------------------------------------------------
  const fetchPredictions = useCallback(async () => {
    setLoadingPredictions(true);
    setPredictionsError(null);
    try {
      const r = await fetch(`/api/unified/predictions?market=${selectedMarket}&limit=50`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const open: PredictionItem[] = Array.isArray(d.predictions) ? d.predictions : [];
      const closed: PredictionItem[] = Array.isArray(d.closed_predictions) ? d.closed_predictions : [];
      setPredictions(open);
      setClosedPredictions(closed);
      setPredStats(d.stats || null);
    } catch (err) {
      console.error('[StoredAnalysisView] predictions fetch error:', err);
      setPredictionsError('تعذّر جلب التوقعات');
      setPredictions([]);
      setClosedPredictions([]);
      setPredStats(null);
    } finally {
      setLoadingPredictions(false);
    }
  }, [selectedMarket]);

  // ------------------------------------------------------------------
  // Auto-refresh every 5 minutes
  // ------------------------------------------------------------------
  const startAutoRefresh = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);

    setCountdown(AUTO_REFRESH_MS / 1000);

    refreshTimer.current = setInterval(() => {
      fetchData();
      fetchPredictions();
      setCountdown(AUTO_REFRESH_MS / 1000);
    }, AUTO_REFRESH_MS);

    countdownTimer.current = setInterval(() => {
      setCountdown(prev => (prev > 1 ? prev - 1 : AUTO_REFRESH_MS / 1000));
    }, 1000);
  }, [fetchData, fetchPredictions]);

  useEffect(() => {
    fetchData();
    fetchPredictions();
    startAutoRefresh();
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, [fetchData, fetchPredictions, startAutoRefresh]);

  // ------------------------------------------------------------------
  // Manual refresh
  // ------------------------------------------------------------------
  const handleManualRefresh = () => {
    fetchData();
    fetchPredictions();
    startAutoRefresh();
    toast.info('جاري تحديث البيانات...');
  };

  // ------------------------------------------------------------------
  // Fallback: if no stored analyses exist for the selected market but
  // predictions DO exist, auto-switch to the predictions section so the
  // user never sees an empty/disconnected state.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!loading && analyses.length === 0 && (predictions.length > 0 || closedPredictions.length > 0)) {
      setActiveSection('predictions');
    } else if (!loading && analyses.length > 0 && activeSection === 'predictions' && predictions.length === 0 && closedPredictions.length === 0) {
      // restore analyses view if predictions are unavailable but analyses exist
      setActiveSection('analyses');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, analyses.length, predictions.length, closedPredictions.length]);

  // ------------------------------------------------------------------
  // Filter + Sort (persona-aware)
  // ------------------------------------------------------------------
  const activePersona: PersonaKey | null = activeTab === 'comparison' ? null : activeTab;

  const filteredAnalyses = analyses.filter(a => {
    const matchesSearch = !searchTicker ||
      a.ticker.toLowerCase().includes(searchTicker.toLowerCase());

    // في تاب المقارنة: اعرض اللي عندهم أي بيانات برسونا
    if (activeTab === 'comparison') {
      const hasGambler = a.analysisJson?.gambler?.verdict || a.analysisJson?.gambler?.score != null;
      const hasInvestor = a.analysisJson?.investor?.verdict || a.analysisJson?.investor?.score != null;
      return matchesSearch && (hasGambler || hasInvestor);
    }

    // في تاب الصياد/المستثمر: فلترة ببيانات البرسونا دي بالظبط
    const pd = a.analysisJson?.[activePersona!];
    if (!pd) return false;

    const matchesVerdict =
      verdictFilter === 'all' ||
      verdictCategory(pd.verdict) === verdictFilter;

    return matchesSearch && matchesVerdict;
  });

  // sort حسب الاختيار
  const sorted = [...filteredAnalyses].sort((a, b) => {
    if (activeTab === 'comparison') {
      // رتّب بأعلى سكور برسونا
      return maxPersonaScore(b) - maxPersonaScore(a);
    }
    const pa = a.analysisJson?.[activePersona!];
    const pb = b.analysisJson?.[activePersona!];

    if (sortBy === 'verdict') {
      const rankDiff = verdictRank(pb?.verdict) - verdictRank(pa?.verdict);
      if (rankDiff !== 0) return rankDiff;
      // tiebreaker: score desc
      return (pb?.score ?? 0) - (pa?.score ?? 0);
    }
    if (sortBy === 'return') {
      return personaReturnPct(pb) - personaReturnPct(pa);
    }
    // default: score desc
    return (pb?.score ?? 0) - (pa?.score ?? 0);
  });

  // إحصائيات البرسونا (للـ stats cards)
  const personaStats = useMemo(() => {
    let gOpp = 0, gWait = 0, gAvoid = 0;
    let iOpp = 0, iWait = 0, iAvoid = 0;
    let withGambler = 0, withInvestor = 0;
    for (const a of analyses) {
      const g = a.analysisJson?.gambler;
      const i = a.analysisJson?.investor;
      if (g && (g.verdict || g.score != null)) {
        withGambler++;
        const cat = verdictCategory(g.verdict);
        if (cat === 'opportunity') gOpp++;
        else if (cat === 'wait') gWait++;
        else if (cat === 'avoid') gAvoid++;
      }
      if (i && (i.verdict || i.score != null)) {
        withInvestor++;
        const cat = verdictCategory(i.verdict);
        if (cat === 'opportunity') iOpp++;
        else if (cat === 'wait') iWait++;
        else if (cat === 'avoid') iAvoid++;
      }
    }
    return { gOpp, gWait, gAvoid, iOpp, iWait, iAvoid, withGambler, withInvestor };
  }, [analyses]);

  // ------------------------------------------------------------------
  // Loading — show only on first ever load (no analyses AND no predictions)
  // ------------------------------------------------------------------
  if (loading && analyses.length === 0 && predictions.length === 0 && closedPredictions.length === 0) {
    return (
      <div className="h-full flex flex-col bg-background" dir="rtl">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold">محرك التحليلات — المايسترو</h1>
            </div>
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        </div>
        <div className="flex-1 p-4 space-y-4">
          {[1, 2, 3, 4, 5].map(i => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="animate-pulse space-y-2">
                  <div className="h-4 bg-muted rounded w-1/4" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                  <div className="h-3 bg-muted rounded w-3/4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Derived: status indicator (decoupled from data display)
  // - "متصل" (green) if engine endpoint reachable OR data exists
  // - "آخر تشغيل: منذ X دقيقة" (amber) if data exists but engine endpoint unreachable
  // - "غير متصل" (red) only if NO data at all
  // ------------------------------------------------------------------
  const hasAnyData = analyses.length > 0 || predictions.length > 0 || closedPredictions.length > 0;
  const engineLastRun = engineStatus?.lastRun || engineStatus?.lastFullAnalysis || null;
  const showEngineOnline = backendOnline || hasAnyData;
  const marketName = MARKET_NAMES_AR_FULL[selectedMarket] || MARKET_NAMES_AR[selectedMarket as keyof typeof MARKET_NAMES_AR] || selectedMarket;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="h-full flex flex-col bg-background" dir="rtl">
      {/* ===== Header ===== */}
      <div className="p-4 border-b bg-card">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">محرك التحليلات — المايسترو</h1>
            {/* مؤشر الحالة — لا يحجب البيانات */}
            {showEngineOnline ? (
              <Badge
                className={
                  backendOnline
                    ? 'bg-emerald-500 text-white text-xs flex items-center gap-1'
                    : 'bg-amber-500 text-white text-xs flex items-center gap-1'
                }
                title={engineLastRun ? `آخر تشغيل: ${formatTimeAgo(engineLastRun)}` : 'متصل'}
              >
                {backendOnline ? (
                  <>
                    <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
                    متصل
                  </>
                ) : (
                  <>
                    <Clock className="h-3 w-3" />
                    آخر تشغيل: {formatTimeAgo(engineLastRun)}
                  </>
                )}
              </Badge>
            ) : (
              <Badge className="bg-rose-500 text-white text-xs flex items-center gap-1">
                <WifiOff className="h-3 w-3" /> منفصل
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* السوق — كل الـ 7 أسواق */}
            <Select value={selectedMarket} onValueChange={setSelectedMarket}>
              <SelectTrigger className="w-36 sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MARKETS.map(m => (
                  <SelectItem key={m} value={m}>
                    {MARKET_NAMES_AR_FULL[m] || MARKET_NAMES_AR[m as keyof typeof MARKET_NAMES_AR] || m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* زر تحديث يدوي */}
            <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={loading || loadingPredictions}>
              {(loading || loadingPredictions) ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1" />
              ) : (
                <RefreshCw className="h-4 w-4 ml-1" />
              )}
              تحديث
            </Button>
          </div>
        </div>

        {/* ===== شريط حالة المحرك ===== */}
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
          {engineStatus && (
            <>
              <span className="flex items-center gap-1">
                <Activity className={`h-3 w-3 ${engineStatus.isRunning ? 'text-emerald-500 animate-pulse' : 'text-gray-400'}`} />
                المحرك: {engineStatus.isRunning ? 'يعمل الآن' : 'في انتظار الدور'}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                آخر تحليل كامل: {formatTimeAgo(engineStatus.lastFullAnalysis)}
              </span>
              <span className="flex items-center gap-1">
                <Database className="h-3 w-3" />
                تحليلات: {engineStatus.totalAnalyzed}
              </span>
            </>
          )}
          {lastFetchTime && (
            <span className="flex items-center gap-1 mr-auto">
              <RefreshCw className="h-3 w-3" />
              آخر جلب: {lastFetchTime.toLocaleTimeString('ar-EG')}
              {' '}— تحديث تلقائي خلال {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      </div>

      {/* ===== Stats Cards — persona-aware ===== */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">🎯 المضارب</div>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{personaStats.gOpp}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">
              فرص شراء · من {personaStats.withGambler}
              {personaStats.gOpp === 0 && personaStats.withGambler > 0 && (
                <span className="block mt-0.5 text-amber-600 dark:text-amber-400">
                  {personaStats.gWait} انتظر · {personaStats.gAvoid} ابعد
                </span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">🏦 المستثمر</div>
            <div className="text-2xl font-bold text-teal-600 dark:text-teal-400">{personaStats.iOpp}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">
              فرص شراء · من {personaStats.withInvestor}
              {personaStats.iOpp === 0 && personaStats.withInvestor > 0 && (
                <span className="block mt-0.5 text-amber-600 dark:text-amber-400">
                  {personaStats.iWait} انتظر · {personaStats.iAvoid} ابعد
                </span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">إجمالي التحليلات</div>
            <div className="text-2xl font-bold">{analyses.length}</div>
            <div className="text-[10px] text-muted-foreground">
              {showEngineOnline ? '✅ متصل بقاعدة البيانات' : '🔴 المحرك غير متصل'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Trophy className="h-3 w-3" />
              توقعات مفتوحة
            </div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{predictions.length}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">
              + {closedPredictions.length} مغلق
              {predStats?.win_rate != null && (
                <span className="block mt-0.5">
                  نسبة الفوز: <span className="font-bold">{predStats.win_rate.toFixed(1)}%</span>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== Info banner when no buy opportunities but analyses exist ===== */}
      {analyses.length > 0 && personaStats.gOpp === 0 && personaStats.iOpp === 0 && (
        <div className="mx-4 mt-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">تم تحليل {analyses.length} سهم</span> — لا توجد فرص شراء واضحة حالياً.
            كل الأسهم خرجت بقرار «انتظر» أو «ابعد». هذا طبيعي في السوق العرضي أو لما الأساسيات ضعيفة.
            البيانات تتحدّث كل دورة تحليل تلقائياً — راجع التبويبات بالأسفل لتفاصيل كل سهم.
          </div>
        </div>
      )}

      {/* ===== Top-level Tabs: live analyses vs predictions with outcomes ===== */}
      <div className="px-4 pt-3 border-b">
        <Tabs value={activeSection} onValueChange={(v) => setActiveSection(v as 'analyses' | 'predictions')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="analyses">
              <Flame className="h-4 w-4 ml-1" />
              التحليلات الحية
              {analyses.length > 0 && (
                <Badge variant="secondary" className="mr-1 text-[10px] h-4 px-1">{analyses.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="predictions">
              <Trophy className="h-4 w-4 ml-1" />
              التوقعات مع النتائج
              {(predictions.length + closedPredictions.length) > 0 && (
                <Badge variant="secondary" className="mr-1 text-[10px] h-4 px-1">
                  {predictions.length + closedPredictions.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* ===== Section: Predictions with outcomes ===== */}
      {activeSection === 'predictions' && (
        <PredictionsSection
          loading={loadingPredictions}
          error={predictionsError}
          openPredictions={predictions}
          closedPredictions={closedPredictions}
          stats={predStats}
          marketName={marketName}
          onRefresh={handleManualRefresh}
          onJumpToAnalyses={() => setActiveSection('analyses')}
          hasAnalyses={analyses.length > 0}
        />
      )}

      {/* ===== Section: Live analyses (existing persona tabs) ===== */}
      {activeSection === 'analyses' && (
        <>
          {/* ===== Inner persona Tabs ===== */}
          <div className="px-4 pt-3 border-b">
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as any); setVerdictFilter('all'); }}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="gambler">
                  <span className="ml-1">🎯</span>
                  المضارب
                  {personaStats.gOpp > 0 && (
                    <Badge variant="secondary" className="mr-1 text-[10px] h-4 px-1">{personaStats.gOpp}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="investor">
                  <span className="ml-1">🏦</span>
                  المستثمر
                  {personaStats.iOpp > 0 && (
                    <Badge variant="secondary" className="mr-1 text-[10px] h-4 px-1">{personaStats.iOpp}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="comparison">
                  <span className="ml-1">📊</span>
                  مقارنة
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* ===== Filter & Sort & Search ===== */}
          <div className="p-4 border-b flex flex-wrap gap-3 items-center">
            {/* فلتر الـ verdict — يتأثر بالـ persona النشط */}
            {activeTab !== 'comparison' && (
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={verdictFilter} onValueChange={(v) => setVerdictFilter(v as any)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل التوصيات</SelectItem>
                    <SelectItem value="opportunity">✅ فرصة شراء</SelectItem>
                    <SelectItem value="wait">⏳ انتظر</SelectItem>
                    <SelectItem value="avoid">🚫 ابعد</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* ترتيب حسب */}
            {activeTab !== 'comparison' && (
              <div className="flex items-center gap-2">
                <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="score">ترتيب: النتيجة ↓</SelectItem>
                    <SelectItem value="verdict">ترتيب: الفرص أول</SelectItem>
                    <SelectItem value="return">ترتيب: العائد %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* بحث */}
            <div className="flex-1 max-w-sm">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="ابحث عن سهم..."
                  value={searchTicker}
                  onChange={(e) => setSearchTicker(e.target.value)}
                  className="pr-10"
                />
              </div>
            </div>

            <span className="text-xs text-muted-foreground self-center">
              {sorted.length} نتيجة
            </span>
          </div>

          {/* ===== Content ===== */}
          <ScrollArea className="flex-1">
            <div className="p-4">
              {sorted.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground mb-2">
                      {analyses.length === 0
                        ? `لا توجد تحليلات مخزّنة لسوق ${marketName} بعد`
                        : 'لا توجد تحليلات متاحة لهذا الفلتر'}
                    </p>
                    <p className="text-xs text-muted-foreground mb-4">
                      {analyses.length === 0
                        ? (predictions.length + closedPredictions.length) > 0
                          ? 'يمكنك عرض التوقعات مع النتائج بدلاً من ذلك'
                          : 'المحرك قد يكون في دورة تحليل — حاول لاحقاً'
                        : showEngineOnline
                          ? 'المحرك متصل — قد تكون التحليلات لم تكتمل بعد'
                          : 'المحرك (python-backend) غير متصل'}
                    </p>
                    <div className="flex justify-center gap-2 flex-wrap">
                      <Button variant="outline" onClick={handleManualRefresh}>
                        <RefreshCw className="h-4 w-4 ml-2" />
                        إعادة التحميل
                      </Button>
                      {(predictions.length + closedPredictions.length) > 0 && (
                        <Button variant="default" onClick={() => setActiveSection('predictions')}>
                          <Trophy className="h-4 w-4 ml-2" />
                          عرض التوقعات مع النتائج
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {sorted.map((analysis) => (
                    <AnalysisCard
                      key={`${analysis.ticker}-${analysis.market}`}
                      analysis={analysis}
                      personaView={activeTab}
                      onClick={() => loadStockDetail(analysis.ticker)}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Predictions Section — التوقعات مع النتائج (open + closed with P&L)
// ============================================================================

function PredictionsSection({
  loading,
  error,
  openPredictions,
  closedPredictions,
  stats,
  marketName,
  onRefresh,
  onJumpToAnalyses,
  hasAnalyses,
}: {
  loading: boolean;
  error: string | null;
  openPredictions: PredictionItem[];
  closedPredictions: PredictionItem[];
  stats: PredictionStats | null;
  marketName: string;
  onRefresh: () => void;
  onJumpToAnalyses: () => void;
  hasAnalyses: boolean;
}) {
  // Sort closed: most recent evaluation first
  const sortedClosed = useMemo(() => {
    return [...closedPredictions].sort((a, b) => {
      const da = a.evaluation_date ? new Date(a.evaluation_date).getTime() : 0;
      const db = b.evaluation_date ? new Date(b.evaluation_date).getTime() : 0;
      return db - da;
    });
  }, [closedPredictions]);

  // Sort open: highest confidence first
  const sortedOpen = useMemo(() => {
    return [...openPredictions].sort((a, b) => (b.confidence ?? b.score ?? 0) - (a.confidence ?? a.score ?? 0));
  }, [openPredictions]);

  if (loading && openPredictions.length === 0 && closedPredictions.length === 0) {
    return (
      <div className="flex-1 p-4 space-y-3">
        {[1, 2, 3].map(i => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="h-8 bg-muted rounded w-full" />
                <div className="h-8 bg-muted rounded w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error && openPredictions.length === 0 && closedPredictions.length === 0) {
    return (
      <div className="flex-1 p-4">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
            <p className="text-muted-foreground mb-2">{error}</p>
            <p className="text-xs text-muted-foreground mb-4">
              تعذّر جلب التوقعات لسوق {marketName}. حاول مرة أخرى.
            </p>
            <Button variant="outline" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4 ml-2" />
              إعادة التحميل
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (openPredictions.length === 0 && closedPredictions.length === 0) {
    return (
      <div className="flex-1 p-4">
        <Card>
          <CardContent className="p-8 text-center">
            <Trophy className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">لا توجد توقعات لسوق {marketName} بعد</p>
            <p className="text-xs text-muted-foreground mb-4">
              {hasAnalyses
                ? 'يوجد تحليلات حية لهذا السوق — يمكنك عرضها من تبويب "التحليلات الحية"'
                : 'محرك التوقعات لم يولّد توقعات لهذا السوق بعد'}
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={onRefresh}>
                <RefreshCw className="h-4 w-4 ml-2" />
                إعادة التحميل
              </Button>
              {hasAnalyses && (
                <Button variant="default" onClick={onJumpToAnalyses}>
                  <Flame className="h-4 w-4 ml-2" />
                  عرض التحليلات الحية
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalOpen = openPredictions.length;
  const totalClosed = closedPredictions.length;
  const winRate = stats?.win_rate ?? 0;
  const avgPnl = stats?.avg_pnl ?? 0;
  const winCount = stats?.win_count ?? 0;
  const lossCount = stats?.loss_count ?? 0;

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-4">
        {/* ===== Summary Bar ===== */}
        <Card className="border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/40 dark:bg-emerald-950/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-base font-bold">ملخّص التوقعات — {marketName}</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-white/70 dark:bg-black/20 p-3 border border-emerald-100 dark:border-emerald-900/40">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Hourglass className="h-3 w-3" /> مفتوح
                </div>
                <div className="text-2xl font-bold text-teal-600 dark:text-teal-400 tabular-nums">{totalOpen}</div>
              </div>
              <div className="rounded-lg bg-white/70 dark:bg-black/20 p-3 border border-emerald-100 dark:border-emerald-900/40">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <History className="h-3 w-3" /> مغلق
                </div>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">{totalClosed}</div>
              </div>
              <div className="rounded-lg bg-white/70 dark:bg-black/20 p-3 border border-emerald-100 dark:border-emerald-900/40">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Trophy className="h-3 w-3" /> نسبة الفوز
                </div>
                <div className={`text-2xl font-bold tabular-nums ${winRate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {winRate.toFixed(1)}%
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {winCount} فوز · {lossCount} خسارة
                </div>
              </div>
              <div className="rounded-lg bg-white/70 dark:bg-black/20 p-3 border border-emerald-100 dark:border-emerald-900/40">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" /> متوسط العائد
                </div>
                <div className={`text-2xl font-bold tabular-nums ${avgPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {fmtPct(avgPnl)}
                </div>
              </div>
            </div>
            {/* Win-rate progress bar */}
            {totalClosed > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                  <span>نسبة الفوز</span>
                  <span className="tabular-nums">{winCount}/{totalClosed}</span>
                </div>
                <Progress
                  value={winRate}
                  className="h-2 bg-muted"
                  // The indicator color is set via CSS variable; emerald by default
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== Open Predictions ===== */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CircleDot className="h-4 w-4 text-teal-500" />
              التوقعات المفتوحة ({sortedOpen.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sortedOpen.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                لا توجد توقعات مفتوحة حالياً لسوق {marketName}.
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto overflow-x-auto custom-scroll">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="text-right text-[11px]">السهم</TableHead>
                      <TableHead className="text-right text-[11px]">الإشارة</TableHead>
                      <TableHead className="text-right text-[11px]">الدخول</TableHead>
                      <TableHead className="text-right text-[11px]">الهدف</TableHead>
                      <TableHead className="text-right text-[11px]">الوقف</TableHead>
                      <TableHead className="text-right text-[11px]">R/R</TableHead>
                      <TableHead className="text-right text-[11px]">الثقة</TableHead>
                      <TableHead className="text-right text-[11px]">RSI</TableHead>
                      <TableHead className="text-right text-[11px]">الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedOpen.map(p => {
                      const sig = signalBadge(p.signal);
                      const conf = p.confidence ?? p.score ?? 0;
                      return (
                        <TableRow key={p.id} className="text-xs">
                          <TableCell className="font-bold">{p.symbol}</TableCell>
                          <TableCell>
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${sig.cls}`}>
                              {p.signal_ar || sig.text}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono tabular-nums">{fmtPrice(p.entry_price)}</TableCell>
                          <TableCell className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{fmtPrice(p.target_price)}</TableCell>
                          <TableCell className="font-mono tabular-nums text-rose-600 dark:text-rose-400">{fmtPrice(p.stop_loss)}</TableCell>
                          <TableCell className="font-mono tabular-nums">{p.risk_reward != null ? p.risk_reward.toFixed(2) : '—'}</TableCell>
                          <TableCell>
                            <span className={`font-bold tabular-nums ${conf >= 70 ? 'text-emerald-600 dark:text-emerald-400' : conf >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {conf.toFixed(0)}%
                            </span>
                          </TableCell>
                          <TableCell className="font-mono tabular-nums">
                            {p.rsi_value != null ? p.rsi_value.toFixed(1) : '—'}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${predStatusBadge(p.status)}`}>
                              {predStatusText(p.status)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== Closed Predictions ===== */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-amber-500" />
              التوقعات المغلقة مع النتائج ({sortedClosed.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sortedClosed.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                لا توجد توقعات مغلقة بعد لسوق {marketName}.
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto overflow-x-auto custom-scroll">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="text-right text-[11px]">السهم</TableHead>
                      <TableHead className="text-right text-[11px]">الإشارة</TableHead>
                      <TableHead className="text-right text-[11px]">الدخول</TableHead>
                      <TableHead className="text-right text-[11px]">السعر النهائي</TableHead>
                      <TableHead className="text-right text-[11px]">العائد</TableHead>
                      <TableHead className="text-right text-[11px]">الحالة</TableHead>
                      <TableHead className="text-right text-[11px]">تاريخ التقييم</TableHead>
                      <TableHead className="text-right text-[11px]">أيام الاحتفاظ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedClosed.map(p => {
                      const sig = signalBadge(p.signal);
                      const pnl = p.profit_loss_percent;
                      return (
                        <TableRow key={p.id} className="text-xs">
                          <TableCell className="font-bold">{p.symbol}</TableCell>
                          <TableCell>
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${sig.cls}`}>
                              {p.signal_ar || sig.text}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono tabular-nums">{fmtPrice(p.entry_price)}</TableCell>
                          <TableCell className="font-mono tabular-nums">{fmtPrice(p.final_price ?? p.entry_price)}</TableCell>
                          <TableCell className={`font-mono tabular-nums font-bold ${pnlColor(pnl)}`}>
                            {fmtPct(pnl)}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${predStatusBadge(p.status)}`}>
                              {predStatusText(p.status)}
                            </span>
                          </TableCell>
                          <TableCell className="text-[11px] text-muted-foreground tabular-nums">
                            {p.evaluation_date ? new Date(p.evaluation_date).toLocaleDateString('ar-EG') : '—'}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-[11px]">
                            {p.holding_days != null ? `${p.holding_days} يوم` : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== Closed prediction details (reasons + candle patterns) ===== */}
        {sortedClosed.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-500" />
                تفاصيل أحدث التوقعات المغلقة
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-96 overflow-y-auto custom-scroll divide-y">
                {sortedClosed.slice(0, 8).map(p => {
                  const pnl = p.profit_loss_percent;
                  const patterns = (p.candle_patterns || []).slice(0, 3);
                  return (
                    <div key={p.id} className="p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{p.symbol}</span>
                          <span className="text-[11px] text-muted-foreground">{p.name}</span>
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${predStatusBadge(p.status)}`}>
                            {predStatusText(p.status)}
                          </span>
                        </div>
                        <span className={`font-mono tabular-nums font-bold text-sm ${pnlColor(pnl)}`}>
                          {fmtPct(pnl)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px] mb-1">
                        <div><span className="text-muted-foreground">دخول:</span> <span className="font-mono">{fmtPrice(p.entry_price)}</span></div>
                        <div><span className="text-muted-foreground">هدف:</span> <span className="font-mono text-emerald-600">{fmtPrice(p.target_price)}</span></div>
                        <div><span className="text-muted-foreground">وقف:</span> <span className="font-mono text-rose-600">{fmtPrice(p.stop_loss)}</span></div>
                        <div><span className="text-muted-foreground">RSI:</span> <span className="font-mono">{p.rsi_value != null ? p.rsi_value.toFixed(1) : '—'}</span></div>
                        <div><span className="text-muted-foreground">الاتجاه:</span> <span>{p.trend_direction || '—'}</span></div>
                        <div><span className="text-muted-foreground">المنطقة:</span> <span>{p.sr_zone || '—'}</span></div>
                      </div>
                      {p.reasons && p.reasons.length > 0 && (
                        <ul className="text-[11px] text-muted-foreground list-disc pr-4 space-y-0.5 mt-1">
                          {p.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      )}
                      {patterns.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {patterns.map((pat, i) => (
                            <span
                              key={i}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                pat.type === 'bullish'
                                  ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20'
                                  : pat.type === 'bearish'
                                    ? 'border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/20'
                                    : 'border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-900/20'
                              }`}
                            >
                              {pat.name_ar || pat.name} {pat.strength ? `· ${pat.strength}` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}

// ============================================================================
// Story Arc Card — قصة السهم التاريخية بالعربي
// ============================================================================

function StoryArcCard({ storyArc }: { storyArc?: { price_movement?: string; historical_context?: string; dual_verdict?: { gambler: string; investor: string } } }) {
  if (!storyArc) return null;
  const { price_movement, historical_context } = storyArc;

  if (!price_movement && !historical_context) return null;

  return (
    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 mt-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-sm">📖</span>
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">قصة السهم</span>
      </div>
      <div className="space-y-1">
        {price_movement && (
          <p className="text-xs text-amber-900 dark:text-amber-100 leading-relaxed">{price_movement}</p>
        )}
        {historical_context && (
          <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">{historical_context}</p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Dual Persona Card — 🎯 المضارب vs 🏦 المستثمر
// ============================================================================

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

function personaScoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}

function personaScoreBg(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function personaVerdictBg(verdict?: string): string {
  if (!verdict) return 'bg-gray-100 dark:bg-gray-800';
  const v = verdict.toLowerCase();
  if (v.includes('فرصة') || v.includes('ادخل') || v.includes('شراء') || v.includes('قوي')) {
    return 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800';
  }
  if (v.includes('انتظر')) {
    return 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800';
  }
  if (v.includes('ابعد') || v.includes('بيع') || v.includes('تجنب')) {
    return 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800';
  }
  return 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700';
}

function PersonaColumn({
  emoji,
  title,
  persona,
}: {
  emoji: string;
  title: string;
  persona?: PersonaData;
}) {
  if (!persona || (!persona.verdict && !persona.score)) {
    return (
      <div className="flex-1 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-3 text-center">
        <div className="text-lg mb-1">{emoji}</div>
        <div className="text-xs font-semibold text-muted-foreground">{title}</div>
        <p className="text-xs text-muted-foreground/70 mt-1">قيد التحليل</p>
      </div>
    );
  }

  const score = persona.score ?? 0;
  const verdict = persona.verdict || '—';

  return (
    <div className={cn('flex-1 rounded-lg border p-3', personaVerdictBg(verdict))}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-lg">{emoji}</span>
          <span className="text-xs font-semibold">{title}</span>
        </div>
        {persona.signal && (
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] px-1.5 py-0',
              persona.signal === 'BUY'
                ? 'border-emerald-400 text-emerald-600'
                : persona.signal === 'SELL'
                  ? 'border-red-400 text-red-500'
                  : 'border-gray-300 text-gray-500'
            )}
          >
            {persona.signal}
          </Badge>
        )}
      </div>

      {/* Verdict */}
      <p className="text-sm font-bold mb-1">{verdict}</p>

      {/* Reason */}
      {persona.reason && (
        <p className="text-xs text-muted-foreground leading-relaxed mb-2 line-clamp-2">
          {persona.reason}
        </p>
      )}

      {/* Conditions (compact) */}
      {persona.conditions && persona.conditions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {persona.conditions.slice(0, 3).map((c, i) => (
            <span
              key={i}
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/60 dark:bg-black/20 text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </div>
      )}

      {/* Entry / Target / Stop (investor only) */}
      {(persona.entry != null || persona.target != null || persona.stop != null) && (
        <div className="grid grid-cols-3 gap-1 text-[10px] mb-2">
          {persona.entry != null && (
            <div>
              <span className="text-muted-foreground">دخول:</span>
              <span className="font-medium mr-1">{Number(persona.entry).toFixed(2)}</span>
            </div>
          )}
          {persona.target != null && (
            <div>
              <span className="text-muted-foreground">هدف:</span>
              <span className="font-medium mr-1 text-emerald-600">{Number(persona.target).toFixed(2)}</span>
            </div>
          )}
          {persona.stop != null && (
            <div>
              <span className="text-muted-foreground">وقف:</span>
              <span className="font-medium mr-1 text-red-500">{Number(persona.stop).toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Timeframe (investor) */}
      {persona.timeframe && (
        <p className="text-[10px] text-muted-foreground mb-1">⏱️ {persona.timeframe}</p>
      )}

      {/* Score bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', personaScoreBg(score))}
            style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
          />
        </div>
        <span className={cn('text-xs font-bold tabular-nums', personaScoreColor(score))}>
          {score.toFixed(0)}
        </span>
      </div>
    </div>
  );
}

function DualPersonaCard({
  gambler,
  investor,
}: {
  gambler?: PersonaData;
  investor?: PersonaData;
}) {
  const hasGambler = gambler && (gambler.verdict || gambler.score != null);
  const hasInvestor = investor && (investor.verdict || investor.score != null);

  if (!hasGambler && !hasInvestor) return null;

  return (
    <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700">
        <p className="text-xs font-semibold text-muted-foreground text-center">
          🎰 المضارب vs 🏦 المستثمر — نفس السهم، وجهين
        </p>
      </div>
      <div className="flex gap-2 p-2">
        <PersonaColumn emoji="🎰" title="المضارب" persona={gambler} />
        <PersonaColumn emoji="🏦" title="المستثمر" persona={investor} />
      </div>
    </div>
  );
}

// ============================================================================
// Analysis Card Sub-Component
// ============================================================================

function AnalysisCard({
  analysis,
  personaView,
  onClick,
}: {
  analysis: StoredAnalysisItem;
  personaView: 'gambler' | 'investor' | 'comparison';
  onClick: () => void;
}) {
  const narrative = analysis.analysisJson?.narrative;
  const gambler = analysis.analysisJson?.gambler;
  const investor = analysis.analysisJson?.investor;
  const storyArc = analysis.analysisJson?.story_arc;
  const hasDualPersona = (gambler && (gambler.verdict || gambler.score != null)) || (investor && (investor.verdict || investor.score != null));
  const updated = getField(analysis, 'updated');
  const entryPrice = getField(analysis, 'entry_price');

  // تاب المقارنة: اعرض الكارت القديم بالـ DualPersonaCard
  if (personaView === 'comparison') {
    const score = getField(analysis, 'score');
    return (
      <Card
        className={cn('cursor-pointer transition-all hover:shadow-md border', getRecommendationBg(getField(analysis, 'recommendation')))}
        onClick={onClick}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="font-bold text-lg">{analysis.ticker}</span>
                <Badge className={getRecommendationBadge(getField(analysis, 'recommendation'))}>
                  {getField(analysis, 'rec_ar')}
                </Badge>
              </div>
              {narrative?.line1 && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{narrative.line1}</p>
              )}
            </div>
            <div className="flex flex-col items-center">
              <div className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold border-2',
                score >= 70 ? 'border-emerald-400 text-emerald-600 bg-emerald-50' : score >= 55 ? 'border-green-400 text-green-600 bg-green-50' : 'border-gray-300 text-gray-500 bg-gray-50'
              )}>
                {score.toFixed(0)}
              </div>
              <span className="text-xs text-muted-foreground mt-1">{formatTimeAgo(updated)}</span>
            </div>
          </div>
          <StoryArcCard storyArc={storyArc} />
          {hasDualPersona && <DualPersonaCard gambler={gambler} investor={investor} />}
        </CardContent>
      </Card>
    );
  }

  // تاب الصياد / المستثمر: اعرض البرسونا النشطة بتفصيل
  const activePersona = personaView === 'gambler' ? gambler : investor;
  const otherPersona = personaView === 'gambler' ? investor : gambler;
  const personaLabel = personaView === 'gambler' ? '🎯 المضارب' : '🏦 المستثمر';
  const otherLabel = personaView === 'gambler' ? '🏦 المستثمر' : '🎯 المضارب';
  const personaAccent = personaView === 'gambler' ? 'purple' : 'blue';

  // لو مفيش بيانات للبرسونا النشطة
  if (!activePersona || (!activePersona.verdict && activePersona.score == null)) {
    return (
      <Card className="cursor-pointer transition-all hover:shadow-md border border-dashed" onClick={onClick}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg">{analysis.ticker}</span>
              <Badge variant="outline" className="text-gray-500">قيد التحليل</Badge>
            </div>
            <span className="text-xs text-muted-foreground">{formatTimeAgo(updated)}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {personaLabel}: لا توجد بيانات برسونا متاحة لهذا السهم بعد
          </p>
        </CardContent>
      </Card>
    );
  }

  const verdict = activePersona.verdict || 'غير معروف';
  const pScore = activePersona.score ?? 0;
  const vc = verdictColor(verdict);
  const retPct = personaReturnPct(activePersona);
  const otherVerdict = otherPersona?.verdict;
  const otherScore = otherPersona?.score ?? 0;

  return (
    <Card
      className={cn('cursor-pointer transition-all hover:shadow-md border-2', vc.border, vc.bg)}
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* Row 1: Ticker + persona label + verdict badge + score */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-bold text-lg">{analysis.ticker}</span>
              <Badge variant="outline" className="text-xs">{personaLabel}</Badge>
              {entryPrice > 0 && (
                <span className="text-xs text-muted-foreground">· السعر {Number(entryPrice).toFixed(2)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn('text-sm font-bold', vc.bg, vc.text, 'border-0')}>
                {verdict}
              </Badge>
              {activePersona.signal && (
                <Badge variant="outline" className="text-xs">{activePersona.signal}</Badge>
              )}
              {retPct >= 0 && (
                <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">
                  <TrendingUp className="h-3 w-3 ml-1" />
                  عائد متوقع +{retPct.toFixed(1)}%
                </Badge>
              )}
              {activePersona.timeframe && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  ⏱️ {activePersona.timeframe}
                </Badge>
              )}
            </div>
          </div>
          {/* Score circle */}
          <div className="flex flex-col items-center">
            <div className={cn(
              'w-14 h-14 rounded-full flex items-center justify-center text-base font-bold border-2',
              pScore >= 70 ? 'border-emerald-400 text-emerald-600 bg-emerald-50'
                : pScore >= 50 ? 'border-amber-400 text-amber-600 bg-amber-50'
                : 'border-red-400 text-red-600 bg-red-50'
            )}>
              {pScore.toFixed(0)}
            </div>
            <span className="text-[10px] text-muted-foreground mt-1">من 100</span>
          </div>
        </div>

        {/* Row 2: Score bar */}
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">النتيجة</span>
            <span className="font-bold tabular-nums">{pScore.toFixed(0)}/100</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all',
                pScore >= 70 ? 'bg-emerald-500' : pScore >= 50 ? 'bg-amber-500' : 'bg-red-500')}
              style={{ width: `${Math.min(100, Math.max(0, pScore))}%` }}
            />
          </div>
        </div>

        {/* Row 3: Reason */}
        {activePersona.reason && (
          <p className="text-sm leading-relaxed text-foreground/90 bg-muted/40 rounded-md p-2 mb-2">
            {activePersona.reason}
          </p>
        )}

        {/* Row 4: Conditions */}
        {activePersona.conditions && activePersona.conditions.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {activePersona.conditions.slice(0, 5).map((c, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {c}
              </span>
            ))}
          </div>
        )}

        {/* Row 5: Entry / Target / Stop (الأهداف الديناميكية لو متاحة) */}
        {(activePersona.entry != null || activePersona.target != null || activePersona.stop != null) && (
          <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2">
            <div className="rounded-md bg-muted/60 p-2">
              <p className="text-muted-foreground mb-0.5">الدخول</p>
              <p className="font-bold text-foreground">
                {activePersona.entry != null ? Number(activePersona.entry).toFixed(2) : '—'}
              </p>
            </div>
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 p-2">
              <p className="text-emerald-700 dark:text-emerald-400 mb-0.5">الهدف</p>
              <p className="font-bold text-emerald-700 dark:text-emerald-400">
                {activePersona.target != null ? Number(activePersona.target).toFixed(2) : '—'}
              </p>
            </div>
            <div className="rounded-md bg-red-50 dark:bg-red-950/30 p-2">
              <p className="text-red-700 dark:text-red-400 mb-0.5">وقف الخسارة</p>
              <p className="font-bold text-red-700 dark:text-red-400">
                {activePersona.stop != null ? Number(activePersona.stop).toFixed(2) : '—'}
              </p>
            </div>
          </div>
        )}

        {/* Row 6: Narrative */}
        {narrative?.line3 && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-2 border-t pt-2">
            {narrative.line3}
          </p>
        )}

        {/* Row 7: Other persona summary */}
        {otherPersona && (otherVerdict || otherScore != null) && (
          <div className="flex items-center gap-2 text-xs mt-2 pt-2 border-t">
            <span className="text-muted-foreground">{otherLabel}:</span>
            <Badge variant="outline" className={cn('text-[10px]', verdictColor(otherVerdict).text)}>
              {otherVerdict || '—'}
            </Badge>
            <span className={cn('font-semibold tabular-nums', verdictColor(otherVerdict).text)}>
              {otherScore.toFixed(0)}
            </span>
          </div>
        )}

        {/* Row 8: Story Arc */}
        <StoryArcCard storyArc={storyArc} />

        {/* Footer: updated time */}
        <div className="text-[10px] text-muted-foreground mt-2 text-left">
          ⏱️ {formatTimeAgo(updated)}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Utility
// ============================================================================

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
