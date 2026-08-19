'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Activity, RefreshCw, Target, AlertTriangle,
  Settings, Play, Download, Search, ChevronUp, ChevronDown, Filter,
  Clock, BarChart3, PieChart, Newspaper, Volume2, Users, Zap, Check,
  X, Info, Calendar, DollarSign, Percent, Award, AlertCircle, Loader2,
  Eye, FileJson, FileSpreadsheet, ArrowUpDown, ChevronLeft, ChevronRight,
  Bitcoin, Brain, Sparkles, Flame, Dna,
  Crosshair, Layers, Trophy, ThumbsUp, ThumbsDown, AlertOctagon, Clock3
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { CryptoPredictionGenerator } from '@/components/admin/CryptoPredictionGenerator';

// ==================== TYPES ====================

export interface MaestroResult {
  ticker: string;
  name: string;
  nameAr?: string;
  currentPrice: number;
  maestroScore: number;
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  recommendationAr: string;
  regime: 'bull' | 'bear' | 'range';
  timeframeConfluence: number;
  volumeRating: number;
  newsSentiment: 'positive' | 'negative' | 'neutral';
  newsSentimentScore: number;
  stopLoss?: number;
  target?: number;
  sector?: string;
  lastUpdated: string;
}

export interface MaestroStatus {
  lastAnalysis: string | null;
  totalStocksAnalyzed: number;
  phases: {
    phase1: { name: string; nameAr: string; active: boolean };
    phase2: { name: string; nameAr: string; active: boolean };
    phase3: { name: string; nameAr: string; active: boolean };
    phase4: { name: string; nameAr: string; active: boolean };
    phase5: { name: string; nameAr: string; active: boolean };
    phase6: { name: string; nameAr: string; active: boolean };
  };
  regime: {
    type: 'bull' | 'bear' | 'range';
    confidence: number;
    adx: number;
  };
  marketSentiment: 'positive' | 'negative' | 'neutral';
}

export interface MaestroStats {
  winRate: number;
  profitFactor: number;
  avgReturn: number;
  totalSignals: number;
  successByPhase: {
    phase1: number;
    phase2: number;
    phase3: number;
    phase4: number;
    phase5: number;
    phase6: number;
  };
}

export interface RegimeData {
  ticker: string;
  regime: 'bull_trend' | 'bear_trend' | 'ranging' | 'unknown';
  regime_ar: string;
  confidence: number;
  indicators?: {
    adx: { adx: number; trend_strength: string; direction: string };
    roc: { roc: number; status: string };
  };
}

export interface TimeframeData {
  ticker: string;
  intraday: { trend: string; score: number; signals: string[] };
  daily: { trend: string; score: number; signals: string[] };
  weekly: { trend: string; score: number; signals: string[] };
  monthly: { trend: string; score: number; signals: string[] };
  confluence: { score: number; aligned: boolean; alignedCount: number };
}

export interface NewsItem {
  id: number;
  ticker?: string;
  title: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number;
  impactScore: number;
  category: string;
  publishedAt: string;
}

export interface PersonaConfig {
  id: string;
  name: string;
  nameAr: string;
  riskTolerance: number;
  minMaestroScore: number;
  positionSizeMultiplier: number;
  stopLossMultiplier: number;
  targetMultiplier: number;
  allowedSectors: string[];
  blockedSectors: string[];
}

export interface MaestroDashboardProps {
  defaultTab?: string;
  onAnalysisComplete?: (results: MaestroResult[]) => void;
  compact?: boolean;
}

// ==================== CONSTANTS ====================

const REGIME_CONFIG = {
  bull: { color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30', icon: TrendingUp, label: 'صاعد', labelEn: 'Bull' },
  bull_trend: { color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30', icon: TrendingUp, label: 'صاعد واضح', labelEn: 'Bull Trend' },
  bear: { color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30', icon: TrendingDown, label: 'هابط', labelEn: 'Bear' },
  bear_trend: { color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30', icon: TrendingDown, label: 'هابط واضح', labelEn: 'Bear Trend' },
  range: { color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30', icon: Minus, label: 'متراوح', labelEn: 'Range' },
  ranging: { color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30', icon: Minus, label: 'متراوح', labelEn: 'Ranging' },
  unknown: { color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-gray-900/30', icon: Activity, label: 'غير معروف', labelEn: 'Unknown' }
};

const TIMEFRAME_CONFIG = {
  bullish: { color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', icon: TrendingUp, label: 'صاعد' },
  bearish: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: TrendingDown, label: 'هابط' },
  neutral: { color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-900/20', icon: Minus, label: 'محايد' }
};

const SENTIMENT_CONFIG = {
  positive: { color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30', label: 'إيجابي' },
  negative: { color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30', label: 'سلبي' },
  neutral: { color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30', label: 'محايد' }
};

const RECOMMENDATION_CONFIG = {
  strong_buy: { color: 'text-green-700', bg: 'bg-green-600', label: 'شراء قوي', labelEn: 'Strong Buy' },
  buy: { color: 'text-green-600', bg: 'bg-green-500', label: 'شراء', labelEn: 'Buy' },
  hold: { color: 'text-yellow-600', bg: 'bg-yellow-500', label: 'احتفاظ', labelEn: 'Hold' },
  sell: { color: 'text-red-600', bg: 'bg-red-500', label: 'بيع', labelEn: 'Sell' },
  strong_sell: { color: 'text-red-700', bg: 'bg-red-600', label: 'بيع قوي', labelEn: 'Strong Sell' }
};

const SCORE_COLORS = {
  low: { min: 0, max: 40, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' },
  medium: { min: 41, max: 60, color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
  high: { min: 61, max: 80, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  excellent: { min: 81, max: 100, color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30' }
};

const DEFAULT_PERSONAS: PersonaConfig[] = [
  { id: 'conservative', name: 'Conservative', nameAr: 'المستثمر', riskTolerance: 3, minMaestroScore: 75, positionSizeMultiplier: 0.5, stopLossMultiplier: 0.8, targetMultiplier: 1.2, allowedSectors: ['Banks', 'Telecom'], blockedSectors: [] },
  { id: 'balanced', name: 'Balanced', nameAr: 'المتوازن', riskTolerance: 5, minMaestroScore: 60, positionSizeMultiplier: 1.0, stopLossMultiplier: 1.0, targetMultiplier: 1.5, allowedSectors: [], blockedSectors: [] },
  { id: 'aggressive', name: 'Aggressive', nameAr: 'المضارب', riskTolerance: 8, minMaestroScore: 45, positionSizeMultiplier: 1.5, stopLossMultiplier: 1.2, targetMultiplier: 2.0, allowedSectors: [], blockedSectors: [] },
];

// ==================== HELPER FUNCTIONS ====================

function getScoreColor(score: number): { color: string; bg: string } {
  if (score <= 40) return { color: SCORE_COLORS.low.color, bg: SCORE_COLORS.low.bg };
  if (score <= 60) return { color: SCORE_COLORS.medium.color, bg: SCORE_COLORS.medium.bg };
  if (score <= 80) return { color: SCORE_COLORS.high.color, bg: SCORE_COLORS.high.bg };
  return { color: SCORE_COLORS.excellent.color, bg: SCORE_COLORS.excellent.bg };
}

function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

// ==================== SUB-COMPONENTS ====================

function PhaseIndicator({ active, label, labelAr }: { active: boolean; label: string; labelAr: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        'w-3 h-3 rounded-full',
        active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
      )} />
      <span className="text-xs">{labelAr}</span>
    </div>
  );
}

function ScoreDisplay({ score, label, showLabel = true }: { score: number; label?: string; showLabel?: boolean }) {
  const { color, bg } = getScoreColor(score);
  return (
    <div className={cn('rounded-lg p-2 text-center', bg)}>
      <div className={cn('text-2xl font-bold', color)}>{Math.round(score)}</div>
      {showLabel && label && <div className="text-xs text-muted-foreground">{label}</div>}
    </div>
  );
}

function TimeframeColumn({ name, trend, score, signals }: { name: string; trend: string; score: number; signals: string[] }) {
  const config = TIMEFRAME_CONFIG[trend as keyof typeof TIMEFRAME_CONFIG] || TIMEFRAME_CONFIG.neutral;
  const Icon = config.icon;
  const { color, bg } = getScoreColor(score);

  return (
    <div className="flex flex-col items-center p-3 rounded-lg border bg-card">
      <div className="text-sm font-medium mb-2">{name}</div>
      <div className={cn('rounded-full p-2 mb-2', config.bg)}>
        <Icon className={cn('h-5 w-5', config.color)} />
      </div>
      <div className={cn('text-xl font-bold', color)}>{Math.round(score)}</div>
      <div className="text-xs text-muted-foreground mt-1">{config.label}</div>
      {signals.length > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="mt-2 h-6 px-2">
                <Info className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <div className="max-w-xs">
                {signals.map((s, i) => <div key={i} className="text-xs py-0.5">{s}</div>)}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function NewsItemCard({ news }: { news: NewsItem }) {
  const config = SENTIMENT_CONFIG[news.sentiment];
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className={cn('rounded-full p-1.5', config.bg)}>
        {news.sentiment === 'positive' ? (
          <TrendingUp className={cn('h-4 w-4', config.color)} />
        ) : news.sentiment === 'negative' ? (
          <TrendingDown className={cn('h-4 w-4', config.color)} />
        ) : (
          <Minus className={cn('h-4 w-4', config.color)} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium line-clamp-2">{news.title}</p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-xs">{news.category}</Badge>
          <span className="text-xs text-muted-foreground">{formatDate(news.publishedAt)}</span>
        </div>
      </div>
      <div className="text-right">
        <div className={cn('text-sm font-bold', config.color)}>
          {news.sentimentScore > 0 ? '+' : ''}{formatNumber(news.sentimentScore)}
        </div>
        <div className="text-xs text-muted-foreground">تأثير: {formatNumber(news.impactScore)}</div>
      </div>
    </div>
  );
}

function PersonaCard({ persona, onEdit }: { persona: PersonaConfig; onEdit?: () => void }) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{persona.nameAr}</CardTitle>
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Settings className="h-4 w-4" />
            </Button>
          )}
        </div>
        <CardDescription className="text-xs">{persona.name}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">الحد الأدنى للدرجة</span>
          <span className="font-medium">{persona.minMaestroScore}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">تحمل المخاطر</span>
          <span className="font-medium">{persona.riskTolerance}/10</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">مضاعف الحجم</span>
          <span className="font-medium">{persona.positionSizeMultiplier}x</span>
        </div>
        <Progress value={persona.riskTolerance * 10} className="h-1 mt-2" />
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value, subtitle, icon: Icon, trend, color = 'primary' }: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'primary' | 'success' | 'warning' | 'danger';
}) {
  const colorClasses = {
    primary: 'text-primary',
    success: 'text-green-600',
    warning: 'text-yellow-600',
    danger: 'text-red-600'
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={cn('text-2xl font-bold mt-1', colorClasses[color])}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          {Icon && (
            <div className="rounded-full bg-muted p-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
        {trend && (
          <div className="flex items-center gap-1 mt-2">
            {trend === 'up' && <ChevronUp className="h-4 w-4 text-green-600" />}
            {trend === 'down' && <ChevronDown className="h-4 w-4 text-red-600" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== MAIN COMPONENT ====================

export function MaestroDashboard({ defaultTab = 'phase1', onAnalysisComplete, compact = false }: MaestroDashboardProps) {
  // State
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MaestroStatus | null>(null);
  const [results, setResults] = useState<MaestroResult[]>([]);
  const [stats, setStats] = useState<MaestroStats | null>(null);
  const [regime, setRegime] = useState<RegimeData | null>(null);
  const [timeframeData, setTimeframeData] = useState<TimeframeData | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [personas, setPersonas] = useState<PersonaConfig[]>(DEFAULT_PERSONAS);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null); // null = checking, false = disconnected, true = connected

  // Filters & Pagination
  const [scoreFilter, setScoreFilter] = useState<[number, number]>([0, 100]);
  const [sortColumn, setSortColumn] = useState<keyof MaestroResult>('maestroScore');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchTicker, setSearchTicker] = useState('');

  // Analysis state
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [selectedStock, setSelectedStock] = useState('');

  // 🧬 DNA state (Axis C — Stock DNA Builder)
  const [dnaBuilding, setDnaBuilding] = useState(false);
  const [dnaResult, setDnaResult] = useState<any>(null);

  // 🤖 AI state (Live AI Monitor + Historical Generator + AI Decision)
  const [aiScanning, setAiScanning] = useState(false);
  const [aiSignals, setAiSignals] = useState<any[]>([]);
  const [aiStats, setAiStats] = useState<any>(null);
  const [generatingTrades, setGeneratingTrades] = useState(false);
  const [tradeStats, setTradeStats] = useState<any>(null);
  const [aiDecision, setAiDecision] = useState<any>(null);
  const [aiDecisionTicker, setAiDecisionTicker] = useState('');
  const [aiDecisionLoading, setAiDecisionLoading] = useState(false);

  // 🎯 Expert View state — نظرة المحلل الخبير (3 endpoints موحّدة)
  const [missedOpp, setMissedOpp] = useState<any>(null);
  const [missedOppLoading, setMissedOppLoading] = useState(false);
  const [sectorIntel, setSectorIntel] = useState<any>(null);
  const [sectorIntelLoading, setSectorIntelLoading] = useState(false);
  const [consensusList, setConsensusList] = useState<any[]>([]);
  const [consensusSummary, setConsensusSummary] = useState<any>(null);
  const [consensusLoading, setConsensusLoading] = useState(false);
  const [consensusVerdict, setConsensusVerdict] = useState<string>('all');
  const [singleConsensus, setSingleConsensus] = useState<any>(null);
  const [singleConsensusTicker, setSingleConsensusTicker] = useState('');
  const [singleConsensusLoading, setSingleConsensusLoading] = useState(false);
  // الـ consensus per ticker للعرض في tab الدرجة (رفع دقة التوقع الظاهر)
  const [topConsensusMap, setTopConsensusMap] = useState<Record<string, any>>({});

  // Market selection (moved before fetchers that depend on it — fixes TDZ error)
  const [selectedMarket, setSelectedMarket] = useState('EGX');
  // أسواق الأسهم فقط
  // CRYPTO ليها Tab منفصل لأن نظام التحليل مختلف
  // DFM (دبي) مش مدعوم - لا توجد بيانات
  const MARKETS = [
    { code: 'EGX', name_ar: 'البورصة المصرية', icon: '🏛️', count: 369 },
    { code: 'KSA', name_ar: 'تداول السعودية', icon: '🇸🇦', count: 388 },
    { code: 'KSE', name_ar: 'بورصة الكويت', icon: '🇰🇼', count: 130 },
    { code: 'QSE', name_ar: 'بورصة قطر', icon: '🇶🇦', count: 55 },
  ];

  // 🎯 Expert View — fetchers (useCallback عشان يشتغلوا في useEffect)
  const fetchMissedOpportunities = useCallback(async () => {
    setMissedOppLoading(true);
    try {
      const mkt = selectedMarket ? `&market=${selectedMarket}` : '';
      const res = await fetch(`/api/predictions/honest-tracking/missed-opportunities?threshold=10&limit=15${mkt}`);
      const data = await res.json();
      if (data.success) setMissedOpp(data);
    } catch (e) {
      console.error('[ExpertView] missed-opportunities fetch failed', e);
    } finally {
      setMissedOppLoading(false);
    }
  }, [selectedMarket]);

  const fetchSectorIntel = useCallback(async () => {
    setSectorIntelLoading(true);
    try {
      const res = await fetch('/api/market/sectors/intelligence?min_stocks=5&limit=10');
      const data = await res.json();
      if (data.success) setSectorIntel(data);
    } catch (e) {
      console.error('[ExpertView] sector intelligence fetch failed', e);
    } finally {
      setSectorIntelLoading(false);
    }
  }, []);

  const fetchConsensusList = useCallback(async (verdict: string = 'all') => {
    setConsensusLoading(true);
    try {
      const verdictParam = verdict && verdict !== 'all' ? `&verdict=${verdict}` : '';
      const res = await fetch(`/api/predictions/expert-consensus?limit=15&min_score=40${verdictParam}`);
      const data = await res.json();
      if (data.success) {
        setConsensusList(data.consensus_list || []);
        setConsensusSummary(data.summary || null);
        const m: Record<string, any> = {};
        for (const c of (data.consensus_list || [])) {
          if (c.ticker) m[c.ticker] = c;
        }
        setTopConsensusMap(m);
      }
    } catch (e) {
      console.error('[ExpertView] consensus list fetch failed', e);
    } finally {
      setConsensusLoading(false);
    }
  }, []);

  const fetchSingleConsensus = useCallback(async (ticker: string) => {
    if (!ticker) return;
    setSingleConsensusLoading(true);
    try {
      const res = await fetch(`/api/predictions/expert-consensus?ticker=${ticker.toUpperCase()}`);
      const data = await res.json();
      if (data.success) setSingleConsensus(data.consensus || null);
      else setSingleConsensus({ error: data.error || 'مش موجود' });
    } catch (e) {
      console.error('[ExpertView] single consensus fetch failed', e);
      setSingleConsensus({ error: String(e) });
    } finally {
      setSingleConsensusLoading(false);
    }
  }, []);

  // أول ما الـ dashboard تحمّل، حمّل consensus list عشان tab الدرجة يعرض الإجماع
  useEffect(() => {
    fetchConsensusList('all');
  }, [fetchConsensusList]);

  // Config state
  const [volumeThreshold, setVolumeThreshold] = useState(1.5);

  // Check backend connection
  const checkBackendHealth = useCallback(async () => {
    try {
      console.log('[MaestroDashboard] Checking backend health...');
      // Use the python health endpoint directly
      const res = await fetch('/api/python/health');
      const data = await res.json();
      console.log('[MaestroDashboard] Health response:', data.status, data.port);
      // Backend is "connected" whenever it is REACHABLE and answers HTTP 200.
      // The Python /health endpoint returns:
      //   - "healthy"   (HTTP 200) → all DBs ok + scheduler running
      //   - "degraded"  (HTTP 200) → backend UP but a non-critical subsystem
      //                              (e.g. scheduler idle) is not running.
      //                              The admin panel can still operate.
      //   - "unhealthy" (HTTP 503) → multiple DBs down → truly disconnected.
      // Accept "healthy" + "degraded" (and legacy "ok") as connected so the
      // red "Python Backend غير متصل" screen does NOT appear when the backend
      // is up but the scheduler happens to be idle.
      const isHealthy =
        res.ok &&
        (data.status === 'ok' ||
          data.status === 'healthy' ||
          data.status === 'degraded');
      setBackendConnected(isHealthy);
      return isHealthy;
    } catch (e) {
      console.error('[MaestroDashboard] Backend health check failed:', e);
      setBackendConnected(false);
      return false;
    }
  }, []);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/python/maestro/status');
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
      }
    } catch (e) {
      console.error('Error fetching status:', e);
    }
  }, []);

  // Fetch regime for selected market
  const fetchRegime = useCallback(async () => {
    try {
      const res = await fetch(`/api/python/regime/market?market=${selectedMarket}`);
      const data = await res.json();
      if (data.success) {
        setRegime(data.data);
      }
    } catch (e) {
      console.error('Error fetching regime:', e);
    }
  }, [selectedMarket]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/python/maestro/signals?stats=true');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (e) {
      console.error('Error fetching stats:', e);
    }
  }, []);

  // Fetch results from UNIFIED predictions API
  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      // Use unified API - same source for all predictions
      const marketCode = selectedMarket === 'KSA' ? 'TADAWUL' : selectedMarket;
      const res = await fetch(`/api/unified/predictions?market=${marketCode}&limit=100`);
      const data = await res.json();
      if (data.success && data.predictions && data.predictions.length > 0) {
        // Transform unified format to MaestroResult
        const transformedResults: MaestroResult[] = data.predictions.map((item: any) => ({
          ticker: item.symbol || item.ticker || '',
          name: item.name || item.symbol || item.ticker || '',
          nameAr: item.name_ar || item.name || item.symbol || item.ticker || '',
          currentPrice: item.entry_price || item.current_price || 0,
          maestroScore: item.score || item.maestro_score || 50,
          recommendation: (item.signal || item.recommendation || 'hold').toLowerCase().replace('strong_', '') as any,
          recommendationAr: item.signal_ar || 'انتظار',
          regime: item.regime || 'range',
          timeframeConfluence: item.confidence || 50,
          volumeRating: 50,
          newsSentiment: 'neutral',
          newsSentimentScore: 0,
          stopLoss: item.stop_loss,
          target: item.target_price,
          sector: item.sector || '',
          lastUpdated: item.created_at || item.updated_at || new Date().toISOString()
        }));
        setResults(transformedResults);
      } else {
        // مفيش نتائج — فضّي الـ results
        setResults([]);
      }
    } catch (e) {
      console.error('Error fetching results:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedMarket]);

  // Fetch news
  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/python/news/egx?limit=10');
      const data = await res.json();
      if (data.success) {
        setNews(data.news || []);
      }
    } catch (e) {
      console.error('Error fetching news:', e);
    }
  }, []);

  // Run full analysis using UNIFIED predictions API
  const runFullAnalysis = async () => {
    setAnalysisRunning(true);
    setAnalysisProgress(0);
    setError(null);

    try {
      console.log('[MaestroDashboard] Triggering analysis for market:', selectedMarket);
      const marketCode = selectedMarket === 'KSA' ? 'TADAWUL' : selectedMarket;

      // استدعاء trigger-analysis عبر Python proxy — ده اللي بيحلل فعلاً
      const res = await fetch('/api/python/admin/trigger-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: marketCode, limit: 20 })
      });

      const data = await res.json();
      console.log('[MaestroDashboard] Trigger response:', data);

      if (data.success) {
        setAnalysisProgress(50);

        // عرض رسالة نجاح
        if (data.message) {
          console.log('[MaestroDashboard]', data.message);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        setAnalysisProgress(100);

        // Fetch updated predictions
        const resultsRes = await fetch(`/api/unified/predictions?market=${marketCode}&limit=100`);
        const resultsData = await resultsRes.json();

        if (resultsData.success && resultsData.predictions) {
          const transformedResults: MaestroResult[] = resultsData.predictions.map((item: any) => ({
            ticker: item.symbol || item.ticker,
            name: item.name || item.symbol || item.ticker,
            nameAr: item.name_ar || item.name || item.symbol || item.ticker,
            currentPrice: item.entry_price || item.current_price || 0,
            maestroScore: item.score || item.maestro_score || 50,
            recommendation: (item.signal || item.recommendation || 'hold').toLowerCase().replace('strong_', '') as any,
            recommendationAr: item.signal_ar || 'انتظار',
            regime: item.regime || 'range',
            timeframeConfluence: item.confidence || 50,
            volumeRating: 50,
            newsSentiment: 'neutral',
            newsSentimentScore: 0,
            stopLoss: item.stop_loss,
            target: item.target_price,
            sector: item.sector || '',
            lastUpdated: item.created_at || item.updated_at || new Date().toISOString()
          }));

          setResults(transformedResults);
          if (onAnalysisComplete) {
            onAnalysisComplete(transformedResults);
          }
        }
        
        // Refresh status
        fetchStatus();
        fetchStats();
      } else {
        setError(data.error || data.message || 'فشل في تشغيل التحليل');
      }
    } catch (e) {
      console.error('[MaestroDashboard] Analysis error:', e);
      setError('فشل الاتصال بالخادم - تأكد من تشغيل Python Backend على المنفذ 8010');
    } finally {
      setAnalysisRunning(false);
      setTimeout(() => setAnalysisProgress(0), 1000);
    }
  };

  // 🧬 Build Stock DNA — يبني ملفات الأسهم التكيفية (Axis C)
  // الزر ده بيشغّل scripts/build_stock_profiles.py اللي بيبني DNA لكل سهم
  // ويحفظه في stock_adaptive_profiles. بعد كده الـ master_analyzer.py بيقرأ
  // الـ DNA وبيفك القيود للأسهم "الحيّة" (amplifier/volume_spike/momentum عالي).
  const buildStockDNA = async () => {
    setDnaBuilding(true);
    setDnaResult(null);
    setError(null);
    try {
      console.log('[MaestroDashboard] Building Stock DNA...');
      const marketCode = selectedMarket === 'KSA' ? 'TADAWUL' : selectedMarket;
      const res = await fetch('/api/admin/build-stock-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: marketCode }),
      });
      const data = await res.json();
      console.log('[MaestroDashboard] DNA build response:', data);
      if (data.success) {
        setDnaResult(data.data || data);
      } else {
        setError(data.error || 'فشل بناء ملفات الأسهم');
      }
    } catch (e: any) {
      console.error('[MaestroDashboard] DNA build error:', e);
      setError('فشل الاتصال بالخادم — تأكد من تشغيل Python Backend');
    } finally {
      setDnaBuilding(false);
    }
  };

  // 🤖 Live AI Scan — يكتشف الأسهم الساخنة ويحللها بالـ AI فوراً
  const runLiveAIScan = async () => {
    setAiScanning(true);
    setError(null);
    try {
      console.log('[MaestroDashboard] Running Live AI Scan...');
      const res = await fetch(`/api/python/ai/live/scan?market=EGX&max_stocks=10`);
      const data = await res.json();
      console.log('[MaestroDashboard] AI scan result:', data);
      if (data.success) {
        setAiSignals(data.signals || []);
        setAiStats({
          analyzed: data.analyzed || 0,
          success: data.success_count || 0,
          failed: data.failed || 0,
        });
      } else {
        setError(data.error || 'فشل في AI scan');
      }
    } catch (e) {
      console.error('[MaestroDashboard] AI scan error:', e);
      setError('فشل في AI scan - تأكد من تشغيل Ollama');
    } finally {
      setAiScanning(false);
    }
  };

  // 📜 Generate Historical Trades — يولّد صفقات تاريخية للتعلم
  const generateHistoricalTrades = async () => {
    setGeneratingTrades(true);
    setError(null);
    try {
      console.log('[MaestroDashboard] Generating historical trades...');
      const res = await fetch(`/api/python/ai/historical/generate?ticker_limit=50&days_back=180&max_trades_per_ticker=50`);
      const data = await res.json();
      console.log('[MaestroDashboard] Trades result:', data);
      if (data.success) {
        // غذّي الـ AI بالصفقات
        await fetch('/api/python/ai/historical/feed-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 10000 }),
        });
        setTradeStats({
          total_trades: data.total_trades || 0,
          tickers: data.successful_tickers || 0,
          elapsed: data.elapsed_seconds || 0,
        });
      }
    } catch (e) {
      console.error('[MaestroDashboard] Trades error:', e);
      setError('فشل في توليد الصفقات');
    } finally {
      setGeneratingTrades(false);
    }
  };

  // 🧠 AI Decision — اسأل AI عن سهم معيّن
  const fetchAIDecision = async (ticker: string) => {
    if (!ticker) return;
    setAiDecisionLoading(true);
    setAiDecision(null);
    try {
      const res = await fetch(`/api/python/ai/decision/${ticker.toUpperCase()}`);
      const data = await res.json();
      setAiDecision(data);
    } catch (e) {
      console.error('[MaestroDashboard] AI decision error:', e);
      setAiDecision({ error: 'فشل في جلب قرار AI' });
    } finally {
      setAiDecisionLoading(false);
    }
  };

  // Analyze single stock
  const analyzeSingleStock = async (ticker: string) => {
    if (!ticker) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/python/maestro/stock/${ticker.toUpperCase()}`);
      const data = await res.json();
      if (data.success && data.result) {
        // Add to results if not already present
        setResults(prev => {
          const exists = prev.find(r => r.ticker === data.result.ticker);
          if (exists) {
            return prev.map(r => r.ticker === data.result.ticker ? data.result : r);
          }
          return [data.result, ...prev];
        });
      }
    } catch (e) {
      setError('فشل في تحليل السهم');
    } finally {
      setLoading(false);
    }
  };

  // Export results
  const exportResults = (format: 'csv' | 'json') => {
    const dataToExport = filteredAndSortedResults.map(r => ({
      ticker: r.ticker,
      name: r.name,
      maestroScore: r.maestroScore,
      recommendation: r.recommendation,
      regime: r.regime,
      timeframeConfluence: r.timeframeConfluence,
      volumeRating: r.volumeRating,
      newsSentiment: r.newsSentiment,
      currentPrice: r.currentPrice,
      stopLoss: r.stopLoss,
      target: r.target
    }));

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maestro-results-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
    } else {
      const csv = [
        Object.keys(dataToExport[0] || {}).join(','),
        ...dataToExport.map(r => Object.values(r).join(','))
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maestro-results-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    }
  };

  // Filter and sort results
  const filteredAndSortedResults = useMemo(() => {
    let filtered = results.filter(r => {
      if (searchTicker && !r.ticker.toLowerCase().includes(searchTicker.toLowerCase())) {
        return false;
      }
      if (r.maestroScore < scoreFilter[0] || r.maestroScore > scoreFilter[1]) {
        return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return 0;
    });
  }, [results, searchTicker, scoreFilter, sortColumn, sortDirection]);

  // Paginated results
  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedResults.slice(start, start + pageSize);
  }, [filteredAndSortedResults, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredAndSortedResults.length / pageSize);

  // Initial load
  useEffect(() => {
    // Check backend health first
    checkBackendHealth().then((isConnected) => {
      if (isConnected) {
        fetchStatus();
        fetchRegime();
        fetchStats();
        fetchNews();
        fetchResults();
      }
    });
  }, [checkBackendHealth, fetchStatus, fetchRegime, fetchStats, fetchNews, fetchResults]);

  // Re-fetch when market changes
  useEffect(() => {
    if (backendConnected) {
      fetchRegime();
      fetchResults();
    }
  }, [selectedMarket, backendConnected, fetchRegime, fetchResults]);

  // Sort handler
  const handleSort = (column: keyof MaestroResult) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  return (
    <div className={cn("space-y-4", compact && "space-y-2")} dir="rtl">
      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>خطأ</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Backend Disconnected Alert */}
      {backendConnected === false && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>⚠️ Python Backend غير متصل</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>الـ Python Backend (Port 8010) مش شغال. نظام المايسترو بيحتاج الباكند عشان يشتغل.</p>
            <div className="mt-2 p-3 bg-red-950/30 rounded-lg text-sm font-mono">
              <p>لتشغيل الباكند على السيرفر:</p>
              <code className="block mt-1 text-green-400">pm2 start ecosystem.config.js --only python-backend</code>
              <p className="mt-2">أو يدوى:</p>
              <code className="block mt-1 text-green-400">cd vps-service && python3 main.py</code>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => checkBackendHealth()}
            >
              <RefreshCw className="h-4 w-4 ml-2" />
              إعادة التحقق
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Checking Backend */}
      {backendConnected === null && (
        <Alert className="mb-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertTitle>جاري التحقق من الاتصال...</AlertTitle>
        </Alert>
      )}

      {/* Header Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Zap className="h-6 w-6 text-primary" />
                نظام المايسترو - Maestro System
              </CardTitle>
              <CardDescription>
                نظام تحليل متكامل لجميع الأسواق - EGX, KSA, KSE, QSE, DFM, CRYPTO
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {/* Market Selector */}
              <Select value={selectedMarket} onValueChange={(v) => { setSelectedMarket(v); fetchResults(); }}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="اختر السوق" />
                </SelectTrigger>
                <SelectContent>
                  {MARKETS.map(m => (
                    <SelectItem key={m.code} value={m.code}>
                      {m.icon} {m.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* Run Analysis Button */}
              <Button 
                size="sm" 
                onClick={runFullAnalysis}
                disabled={analysisRunning}
              >
                {analysisRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                    جاري التحليل...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 ml-2" />
                    تشغيل التحليل
                  </>
                )}
              </Button>

              {/* 🧬 Build Stock DNA Button (Axis C) */}
              <Button
                variant="default"
                size="sm"
                onClick={buildStockDNA}
                disabled={dnaBuilding}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                title="يبني ملفات الأسهم (DNA) — الأسهم الحية تاخد threshold_boost + confidence_boost"
              >
                {dnaBuilding ? (
                  <>
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                    يبني DNA...
                  </>
                ) : (
                  <>
                    <Dna className="h-4 w-4 ml-2" />
                    🧬 بناء ملفات الأسهم
                  </>
                )}
              </Button>
              {dnaResult && (
                <span className="text-xs text-emerald-600 font-medium" title={JSON.stringify(dnaResult, null, 2)}>
                  🧬 {dnaResult.profiles_built || 0} ملف ({dnaResult.alive_stocks || 0} حيّ) في {dnaResult.duration_seconds || 0}ث
                </span>
              )}

              <Button variant="outline" size="sm" onClick={() => { fetchStatus(); fetchRegime(); fetchStats(); fetchResults(); }}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                <span className="mr-2">تحديث</span>
              </Button>

              {/* 🤖 Live AI Scan Button */}
              <Button
                variant="default"
                size="sm"
                onClick={runLiveAIScan}
                disabled={aiScanning}
                className="bg-purple-600 hover:bg-purple-700 text-white"
                title="AI يكتشف الأسهم الساخنة ويحللها فوراً"
              >
                {aiScanning ? (
                  <>
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                    AI بيحلل...
                  </>
                ) : (
                  <>
                    <Brain className="h-4 w-4 ml-2" />
                    AI Scan
                  </>
                )}
              </Button>

              {/* 📜 Generate Historical Trades Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={generateHistoricalTrades}
                disabled={generatingTrades}
                title="يولّد صفقات تاريخية للتعلم"
              >
                {generatingTrades ? (
                  <>
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                    يولّد...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 ml-2" />
                    تعلم AI
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {status?.phases && Object.entries(status.phases).map(([key, phase]) => (
              <PhaseIndicator
                key={key}
                active={phase.active}
                label={phase.name}
                labelAr={phase.nameAr}
              />
            ))}
          </div>
          <Separator className="my-4" />
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>آخر تحليل: {formatDate(status?.lastAnalysis)}</span>
            </div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              <span>الأسهم المحللة: {status?.totalStocksAnalyzed || 0}</span>
            </div>
            {status?.regime && (
              <div className="flex items-center gap-2">
                {React.createElement(REGIME_CONFIG[status.regime.type]?.icon || Activity, {
                  className: cn('h-4 w-4', REGIME_CONFIG[status.regime.type]?.color)
                })}
                <span>حالة السوق: {REGIME_CONFIG[status.regime.type]?.label}</span>
                <Badge variant="outline" className="text-xs">{status.regime.confidence}%</Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="phase1" className="text-xs sm:text-sm">المرحلة 1: الحالة</TabsTrigger>
          <TabsTrigger value="phase2" className="text-xs sm:text-sm">المرحلة 2: الأطر</TabsTrigger>
          <TabsTrigger value="phase3" className="text-xs sm:text-sm">المرحلة 3: الحجم</TabsTrigger>
          <TabsTrigger value="phase4" className="text-xs sm:text-sm">المرحلة 4: الأخبار</TabsTrigger>
          <TabsTrigger value="phase5" className="text-xs sm:text-sm">المرحلة 5: الدرجة</TabsTrigger>
          <TabsTrigger value="phase6" className="text-xs sm:text-sm">المرحلة 6: الشخصيات</TabsTrigger>
          <TabsTrigger value="ai" className="text-xs sm:text-sm gap-1">
            <Brain className="h-4 w-4" />
            المحرك التحليلي
          </TabsTrigger>
          <TabsTrigger value="expert" className="text-xs sm:text-sm gap-1">
            <Crosshair className="h-4 w-4" />
            نظرة المحلل الخبير
          </TabsTrigger>
          <TabsTrigger value="crypto" className="text-xs sm:text-sm gap-1">
            <Bitcoin className="h-4 w-4" />
            العملات الرقمية
          </TabsTrigger>
        </TabsList>

        {/* Phase 1: Regime Detection */}
        <TabsContent value="phase1" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    حالة السوق - EGX30
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={fetchRegime} disabled={loading}>
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                  </Button>
                </div>
                <CardDescription>كشف حالة السوق باستخدام ADX و ROC</CardDescription>
              </CardHeader>
              <CardContent>
                {regime ? (
                  <div className="space-y-4">
                    <div className={cn('rounded-xl p-6 text-center', REGIME_CONFIG[regime.regime]?.bg)}>
                      {React.createElement(REGIME_CONFIG[regime.regime]?.icon || Activity, {
                        className: cn('h-12 w-12 mx-auto mb-2', REGIME_CONFIG[regime.regime]?.color)
                      })}
                      <h3 className="text-2xl font-bold">{regime.regime_ar}</h3>
                      <div className="mt-3">
                        <div className="text-sm text-muted-foreground mb-1">مستوى الثقة</div>
                        <Progress value={regime.confidence} className="h-2" />
                        <div className="text-lg font-bold mt-1">{regime.confidence}%</div>
                      </div>
                    </div>
                    {regime.indicators && (
                      <div className="space-y-2">
                        <div className="flex justify-between p-2 bg-muted/30 rounded-lg">
                          <span className="text-sm">ADX</span>
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{regime.indicators.adx.adx}</span>
                            <Badge variant="outline" className="text-xs">{regime.indicators.adx.trend_strength}</Badge>
                          </div>
                        </div>
                        <div className="flex justify-between p-2 bg-muted/30 rounded-lg">
                          <span className="text-sm">ROC (20)</span>
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{regime.indicators.roc.roc}%</span>
                            <Badge variant="outline" className="text-xs">{regime.indicators.roc.status}</Badge>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-8 flex justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                )}
              </CardContent>
              <CardFooter>
                <Button className="w-full" onClick={fetchRegime} disabled={loading}>
                  <RefreshCw className="h-4 w-4 ml-2" />
                  تحديث الحالة
                </Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  مؤشرات السوق
                </CardTitle>
                <CardDescription>ملخص أداء السوق والمؤشرات الرئيسية</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm text-muted-foreground">اتجاه EGX30</div>
                    <div className="text-xl font-bold text-green-600">+2.3%</div>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm text-muted-foreground">أيام هبوط متتالية</div>
                    <div className="text-xl font-bold">0</div>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm text-muted-foreground">نسبة الأسهم المرتفعة</div>
                    <div className="text-xl font-bold text-green-600">68%</div>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm text-muted-foreground">سيولة السوق</div>
                    <div className="text-xl font-bold">1.2B ج.م</div>
                  </div>
                </div>
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    مرحلة كشف الحالة تحدد استراتيجية التداول المناسبة حسب حالة السوق
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Phase 2: Timeframe Confluence */}
        <TabsContent value="phase2" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                توافق الأطر الزمنية
              </CardTitle>
              <CardDescription>تحليل 4 أطر زمنية: اللحظي، اليومي، الأسبوعي، الشهري</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <TimeframeColumn
                  name="اللحظي"
                  trend={timeframeData?.intraday?.trend || 'neutral'}
                  score={timeframeData?.intraday?.score || 50}
                  signals={timeframeData?.intraday?.signals || []}
                />
                <TimeframeColumn
                  name="اليومي"
                  trend={timeframeData?.daily?.trend || 'neutral'}
                  score={timeframeData?.daily?.score || 50}
                  signals={timeframeData?.daily?.signals || []}
                />
                <TimeframeColumn
                  name="الأسبوعي"
                  trend={timeframeData?.weekly?.trend || 'neutral'}
                  score={timeframeData?.weekly?.score || 50}
                  signals={timeframeData?.weekly?.signals || []}
                />
                <TimeframeColumn
                  name="الشهري"
                  trend={timeframeData?.monthly?.trend || 'neutral'}
                  score={timeframeData?.monthly?.score || 50}
                  signals={timeframeData?.monthly?.signals || []}
                />
              </div>
              <div className="flex items-center justify-center gap-4 p-4 bg-muted/30 rounded-lg">
                <div className="text-center">
                  <div className="text-3xl font-bold text-primary">
                    {timeframeData?.confluence?.score || 50}
                  </div>
                  <div className="text-sm text-muted-foreground">درجة التقارب</div>
                </div>
                <Separator orientation="vertical" className="h-12" />
                <div className="text-center">
                  <Badge
                    variant={timeframeData?.confluence?.aligned ? 'default' : 'secondary'}
                    className="text-sm"
                  >
                    {timeframeData?.confluence?.aligned ? 'متوافق' : 'غير متوافق'}
                  </Badge>
                  <div className="text-sm text-muted-foreground mt-1">
                    {timeframeData?.confluence?.alignedCount || 0}/4 أطر متوافقة
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Phase 3: Volume Context */}
        <TabsContent value="phase3" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Volume2 className="h-5 w-5" />
                  تحليل الحجم
                </CardTitle>
                <CardDescription>فلترة وتحليل السيولة</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <Label>حد طفرة الحجم</Label>
                    <span className="text-sm font-medium">{volumeThreshold}x</span>
                  </div>
                  <Slider
                    value={[volumeThreshold]}
                    onValueChange={([v]) => setVolumeThreshold(v)}
                    min={1}
                    max={5}
                    step={0.1}
                  />
                  <p className="text-xs text-muted-foreground">
                    الأسهم التي يتجاوز حجم تداولها {volumeThreshold}x المتوسط تُعتبر طفرة حجم
                  </p>
                </div>
                <Separator />
                <div className="space-y-2">
                  <div className="flex justify-between p-2 bg-muted/30 rounded-lg">
                    <span className="text-sm">أسهم بطفرة حجم</span>
                    <Badge variant="default">24 سهم</Badge>
                  </div>
                  <div className="flex justify-between p-2 bg-muted/30 rounded-lg">
                    <span className="text-sm">متوسط السيولة</span>
                    <span className="font-medium">85M ج.م</span>
                  </div>
                  <div className="flex justify-between p-2 bg-muted/30 rounded-lg">
                    <span className="text-sm">فلترة السيولة</span>
                    <Switch defaultChecked />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>إعدادات الفلترة</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>الحد الأدنى للسيولة (ج.م)</Label>
                  <Input type="number" defaultValue={10000000} />
                </div>
                <div className="space-y-2">
                  <Label>الحد الأدنى لحجم التداول</Label>
                  <Input type="number" defaultValue={100000} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>استبعاد الأسهم قليلة السيولة</Label>
                  <Switch defaultChecked />
                </div>
                <Button className="w-full">
                  <Filter className="h-4 w-4 ml-2" />
                  تطبيق الفلترة
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Phase 4: News Context */}
        <TabsContent value="phase4" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Newspaper className="h-5 w-5" />
                    الأخبار الأخيرة
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={fetchNews}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] pr-4">
                  <div className="space-y-3">
                    {news.length > 0 ? news.map((item, i) => (
                      <NewsItemCard key={item.id || i} news={item} />
                    )) : (
                      <div className="text-center py-8 text-muted-foreground">
                        لا توجد أخبار متاحة
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  إعدادات الأخبار
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>كلمات مفتاحية إيجابية</Label>
                  <div className="flex flex-wrap gap-1">
                    {['أرباح', 'نمو', 'ارتفاع', 'توزيعات'].map(kw => (
                      <Badge key={kw} variant="outline" className="bg-green-50">{kw}</Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input placeholder="إضافة كلمة..." className="h-8" />
                    <Button size="sm" variant="outline">+</Button>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>كلمات مفتاحية سلبية</Label>
                  <div className="flex flex-wrap gap-1">
                    {['خسائر', 'انخفاض', 'تراجع', 'غرامة'].map(kw => (
                      <Badge key={kw} variant="outline" className="bg-red-50">{kw}</Badge>
                    ))}
                  </div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>أخبار البنك المركزي</Label>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">تأثير عالي</span>
                    <Switch defaultChecked />
                  </div>
                </div>
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">تنبيه</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    أخبار البنك المركزي لها تأثير كبير على السوق
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Phase 5: Maestro Score */}
        <TabsContent value="phase5" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                  <Award className="h-5 w-5 flex-shrink-0" />
                  <span>أفضل 10 أسهم — مايسترو + الإجماع الخبير</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  عمود "الإجماع الخبير" بيجمع 5 مصادر (توقع + أداء + RSI + MA + قطاع) → قرار أعلى وأدق
                </CardDescription>
              </CardHeader>
              <CardContent className="p-2 sm:p-6 pt-0">
                {/* ✅ Mobile-first: cards on mobile, table on sm+ */}
                {/* Cards for mobile */}
                <div className="sm:hidden space-y-2">
                  {filteredAndSortedResults.slice(0, 10).map((result, i) => {
                    const cons = topConsensusMap[result.ticker];
                    const vColor = cons?.verdict === 'STRONG_BUY' ? 'bg-green-600' :
                                   cons?.verdict === 'BUY' ? 'bg-green-500' :
                                   cons?.verdict === 'SELL' ? 'bg-red-500' :
                                   cons?.verdict === 'STRONG_SELL' ? 'bg-red-600' :
                                   cons?.verdict ? 'bg-yellow-500' : 'bg-muted text-muted-foreground';
                    const vLabel = cons?.verdict === 'STRONG_BUY' ? 'شراء قوي' :
                                   cons?.verdict === 'BUY' ? 'شراء' :
                                   cons?.verdict === 'SELL' ? 'بيع' :
                                   cons?.verdict === 'STRONG_SELL' ? 'بيع قوي' :
                                   cons?.verdict === 'HOLD' ? 'احتفاظ' : '—';
                    return (
                      <div key={result.ticker} className="border rounded-lg p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs text-muted-foreground flex-shrink-0">#{i+1}</span>
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{result.ticker}</div>
                              <div className="text-[10px] text-muted-foreground truncate">{result.name}</div>
                            </div>
                          </div>
                          <ScoreDisplay score={result.maestroScore} showLabel={false} />
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge className={cn('text-white text-[10px]', RECOMMENDATION_CONFIG[result.recommendation]?.bg)}>
                            {RECOMMENDATION_CONFIG[result.recommendation]?.label}
                          </Badge>
                          {cons && (
                            <Badge className={cn('text-white text-[10px]', vColor)}>
                              خبير: {vLabel} {cons.confidence_pct}%
                            </Badge>
                          )}
                          {cons?.current_state?.price_is_stale && (
                            <Badge className="text-[9px] bg-orange-100 text-orange-700">⏱️</Badge>
                          )}
                        </div>
                        {result.sector && <div className="text-[10px] text-muted-foreground">{result.sector}</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Table for sm+ */}
                <Table className="hidden sm:table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>السهم</TableHead>
                      <TableHead className="w-20">الدرجة</TableHead>
                      <TableHead>المايسترو</TableHead>
                      <TableHead className="bg-emerald-50 dark:bg-emerald-950/30">الإجماع الخبير</TableHead>
                      <TableHead>القطاع</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedResults.slice(0, 10).map((result, i) => {
                      const cons = topConsensusMap[result.ticker];
                      const vColor = cons?.verdict === 'STRONG_BUY' ? 'bg-green-600' :
                                     cons?.verdict === 'BUY' ? 'bg-green-500' :
                                     cons?.verdict === 'SELL' ? 'bg-red-500' :
                                     cons?.verdict === 'STRONG_SELL' ? 'bg-red-600' :
                                     cons?.verdict ? 'bg-yellow-500' : 'bg-muted text-muted-foreground';
                      const vLabel = cons?.verdict === 'STRONG_BUY' ? 'شراء قوي' :
                                     cons?.verdict === 'BUY' ? 'شراء' :
                                     cons?.verdict === 'SELL' ? 'بيع' :
                                     cons?.verdict === 'STRONG_SELL' ? 'بيع قوي' :
                                     cons?.verdict === 'HOLD' ? 'احتفاظ' : '—';
                      return (
                        <TableRow key={result.ticker}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">{result.ticker}</div>
                              <div className="text-xs text-muted-foreground">{result.name}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <ScoreDisplay score={result.maestroScore} showLabel={false} />
                          </TableCell>
                          <TableCell>
                            <Badge className={cn('text-white', RECOMMENDATION_CONFIG[result.recommendation]?.bg)}>
                              {RECOMMENDATION_CONFIG[result.recommendation]?.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="bg-emerald-50/50 dark:bg-emerald-950/20">
                            {cons ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <Badge className={cn('text-white text-xs', vColor)}>{vLabel}</Badge>
                                  <span className="text-xs text-muted-foreground">{cons.confidence_pct}%</span>
                                  {cons.current_state?.price_is_stale && (
                                    <Badge variant="outline" className="text-[9px] text-orange-600 border-orange-300">⏱️</Badge>
                                  )}
                                </div>
                                {cons.bullish_signals != null && (
                                  <div className="text-[10px] text-muted-foreground">
                                    {cons.bullish_signals} صعودي · {cons.bearish_signals} هبوطي
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{result.sector || '--'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>توزيع الدرجات</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-red-500" />
                  <span className="text-sm">0-40: بيع/تجنب</span>
                  <Badge variant="outline" className="mr-auto">
                    {results.filter(r => r.maestroScore <= 40).length}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-yellow-500" />
                  <span className="text-sm">41-60: احتفاظ</span>
                  <Badge variant="outline" className="mr-auto">
                    {results.filter(r => r.maestroScore > 40 && r.maestroScore <= 60).length}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-blue-500" />
                  <span className="text-sm">61-80: شراء</span>
                  <Badge variant="outline" className="mr-auto">
                    {results.filter(r => r.maestroScore > 60 && r.maestroScore <= 80).length}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-green-500" />
                  <span className="text-sm">81-100: شراء قوي</span>
                  <Badge variant="outline" className="mr-auto">
                    {results.filter(r => r.maestroScore > 80).length}
                  </Badge>
                </div>
              </CardContent>
              <CardFooter>
                <div className="w-full space-y-2">
                  <Label>أوزان المراحل حسب الحالة</Label>
                  <Select defaultValue="auto">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">تلقائي</SelectItem>
                      <SelectItem value="bull">سوق صاعد</SelectItem>
                      <SelectItem value="bear">سوق هابط</SelectItem>
                      <SelectItem value="range">سوق متراوح</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardFooter>
            </Card>
          </div>
        </TabsContent>

        {/* Phase 6: Persona Settings */}
        <TabsContent value="phase6" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {personas.map(persona => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                onEdit={() => {/* Open edit dialog */}}
              />
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                إعدادات الشخصيات
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>الحد الأدنى للدرجة</Label>
                  <Input type="number" defaultValue={60} />
                </div>
                <div className="space-y-2">
                  <Label>مضاعف حجم الصفقة</Label>
                  <Input type="number" defaultValue={1.0} step={0.1} />
                </div>
                <div className="space-y-2">
                  <Label>مضاعف وقف الخسارة</Label>
                  <Input type="number" defaultValue={1.0} step={0.1} />
                </div>
                <div className="space-y-2">
                  <Label>مضاعف الهدف</Label>
                  <Input type="number" defaultValue={1.5} step={0.1} />
                </div>
              </div>
              <Separator className="my-4" />
              <div className="space-y-2">
                <Label>القطاعات المسموحة</Label>
                <div className="flex flex-wrap gap-2">
                  {['بنوك', 'عقارات', 'اتصالات', 'صناعة', 'أغذية'].map(sector => (
                    <Badge key={sector} variant="secondary" className="cursor-pointer">
                      {sector}
                      <Button variant="ghost" size="sm" className="h-4 w-4 p-0 mr-1">
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              </div>
              <Button className="mt-4">
                <Settings className="h-4 w-4 ml-2" />
                حفظ الإعدادات
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 🤖 AI Tab - Live AI Monitor + Historical Generator + AI Decision */}
        <TabsContent value="ai" className="space-y-4">
          {/* AI Actions Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-600" />
                المحرك التحليلي المحلي (glm-fast)
              </CardTitle>
              <CardDescription>
                AI بيحلل الأسهم الساخنة + يتعلّم من الصفقات التاريخية + يدي قرارات لحظية
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Stats */}
              {aiStats && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-purple-50 dark:bg-purple-950/20 p-3 rounded-lg text-center">
                    <div className="text-2xl font-bold text-purple-600">{aiStats.analyzed}</div>
                    <div className="text-xs text-muted-foreground">سهم محلل</div>
                  </div>
                  <div className="bg-green-50 dark:bg-green-950/20 p-3 rounded-lg text-center">
                    <div className="text-2xl font-bold text-green-600">{aiStats.success}</div>
                    <div className="text-xs text-muted-foreground">نجح</div>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/20 p-3 rounded-lg text-center">
                    <div className="text-2xl font-bold text-red-600">{aiStats.failed}</div>
                    <div className="text-xs text-muted-foreground">فشل</div>
                  </div>
                </div>
              )}

              {tradeStats && (
                <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    <span className="font-medium">آخر توليد صفقات:</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {tradeStats.total_trades} صفقة من {tradeStats.tickers} سهم في {tradeStats.elapsed}s
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={runLiveAIScan}
                  disabled={aiScanning}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {aiScanning ? (
                    <><Loader2 className="h-4 w-4 ml-2 animate-spin" />جاري المسح...</>
                  ) : (
                    <><Flame className="h-4 w-4 ml-2" />Live AI Scan (الأسهم الساخنة)</>
                  )}
                </Button>
                <Button
                  onClick={generateHistoricalTrades}
                  disabled={generatingTrades}
                  variant="outline"
                >
                  {generatingTrades ? (
                    <><Loader2 className="h-4 w-4 ml-2 animate-spin" />جاري التوليد...</>
                  ) : (
                    <><Sparkles className="h-4 w-4 ml-2" />ولّد صفقات للتعلم</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* AI Signals List */}
          {aiSignals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Flame className="h-5 w-5 text-orange-500" />
                  إشارات AI المباشرة ({aiSignals.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {aiSignals.map((sig, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={
                            sig.decision === 'BUY' ? 'default' :
                            sig.decision === 'SELL' ? 'destructive' :
                            'secondary'
                          }
                        >
                          {sig.decision || 'N/A'}
                        </Badge>
                        <div>
                          <div className="font-medium">{sig.ticker}</div>
                          <div className="text-xs text-muted-foreground">
                            {sig.reason || sig.narrative || '—'}
                          </div>
                        </div>
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-medium">
                          ثقة: {sig.confidence || '—'}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {sig.source || 'live_ai'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Decision for Single Stock */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-600" />
                اسأل AI عن سهم
              </CardTitle>
              <CardDescription>
                اكتب رمز السهم وهيطلعلك قرار AI مفصّل (BUY/SELL/HOLD + السبب + التحليل)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="مثال: DSCW"
                  value={aiDecisionTicker}
                  onChange={(e) => setAiDecisionTicker(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && fetchAIDecision(aiDecisionTicker)}
                  className="max-w-xs"
                />
                <Button
                  onClick={() => fetchAIDecision(aiDecisionTicker)}
                  disabled={aiDecisionLoading || !aiDecisionTicker}
                >
                  {aiDecisionLoading ? (
                    <><Loader2 className="h-4 w-4 ml-2 animate-spin" />بيحلل...</>
                  ) : (
                    <><Brain className="h-4 w-4 ml-2" />حلّل بالـ AI</>
                  )}
                </Button>
              </div>

              {aiDecision && (
                <div className="border rounded-lg p-4 space-y-2 bg-muted/30">
                  {aiDecision.error ? (
                    <div className="text-red-600 text-sm">{aiDecision.error}</div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            aiDecision.decision === 'BUY' ? 'default' :
                            aiDecision.decision === 'SELL' ? 'destructive' :
                            'secondary'
                          }
                          className="text-base px-3 py-1"
                        >
                          {aiDecision.decision || '—'}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          ثقة: {aiDecision.confidence || 0}%
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {aiDecision.source || 'live_ai'}
                        </Badge>
                      </div>
                      {aiDecision.reason && (
                        <div className="text-sm">
                          <span className="font-medium">السبب: </span>
                          {aiDecision.reason}
                        </div>
                      )}
                      {aiDecision.narrative && (
                        <div className="text-sm text-muted-foreground italic">
                          {aiDecision.narrative}
                        </div>
                      )}
                      {aiDecision.updated_at && (
                        <div className="text-xs text-muted-foreground">
                          آخر تحديث: {aiDecision.updated_at}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Expert View Tab — نظرة المحلل الخبير (3 endpoints موحّدة) — mobile-first 100% */}
        <TabsContent value="expert" className="space-y-4">
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 p-3 sm:p-4 rounded-lg border border-emerald-200 dark:border-emerald-800">
            <div className="flex items-center gap-2">
              <Crosshair className="h-5 w-5 text-emerald-600 flex-shrink-0" />
              <span className="font-bold text-emerald-800 dark:text-emerald-200 text-sm sm:text-base">نظرة المحلل الخبير</span>
            </div>
            <p className="text-xs sm:text-sm text-emerald-700 dark:text-emerald-300 mt-1 leading-relaxed">
              3 طبقات ذكاء على نفس البيانات: (1) الفرص اللي فاتتنا (2) ذكاء القطاعات (3) الإجماع الموحّد. الأسعار بتتحدث كل 5 دقايق.
            </p>
          </div>

          {/* ─── القسم 1: الفرص الضائعة ─── */}
          <Card>
            <CardHeader className="p-4 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                  <AlertOctagon className="h-5 w-5 text-red-500 flex-shrink-0" />
                  <span>الفرص الضائعة والتوصيات الغلط</span>
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={fetchMissedOpportunities} disabled={missedOppLoading} className="flex-shrink-0">
                  <RefreshCw className={cn('h-4 w-4', missedOppLoading && 'animate-spin')} />
                </Button>
              </div>
              <CardDescription className="text-xs">بيراجع التوقعات السابقة ويقارنها بآخر سعر — الأسعار بتتحدث كل 5 دقايق</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
              {!missedOpp && !missedOppLoading && (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  اضغط زر التحديث عشان يشغّل المراجعة
                </div>
              )}
              {missedOppLoading && (
                <div className="py-6 flex justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}
              {missedOpp && missedOpp.summary && (
                <>
                  {/* Summary stats — 2x2 grid على الموبايل، 4 cols على الديسكتوب */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                    <div className="bg-red-50 dark:bg-red-950/20 p-2 sm:p-3 rounded-lg text-center">
                      <div className="text-xl sm:text-2xl font-bold text-red-600">{missedOpp.summary.missed_bulls}</div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">فرصة ضاعت</div>
                    </div>
                    <div className="bg-orange-50 dark:bg-orange-950/20 p-2 sm:p-3 rounded-lg text-center">
                      <div className="text-xl sm:text-2xl font-bold text-orange-600">{missedOpp.summary.false_positives}</div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">توصية غلط</div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-950/20 p-2 sm:p-3 rounded-lg text-center">
                      <div className="text-xl sm:text-2xl font-bold text-green-600">{missedOpp.summary.correct_buys + missedOpp.summary.correct_sells}</div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">توصية صحيحة</div>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-950/20 p-2 sm:p-3 rounded-lg text-center">
                      <div className="text-xl sm:text-2xl font-bold text-blue-600">{missedOpp.summary.accuracy_rate_pct}%</div>
                      <div className="text-[10px] sm:text-xs text-muted-foreground">نسبة الدقة</div>
                    </div>
                  </div>

                  {/* Freshness stats */}
                  {(missedOpp.summary.prices_fresh > 0 || missedOpp.summary.prices_stale > 0) && (
                    <div className="flex items-center gap-2 text-xs p-2 rounded-lg bg-muted/30">
                      <Clock3 className="h-3 w-3 flex-shrink-0" />
                      <span className="text-muted-foreground">
                        أسعار طازة: <b className="text-green-600">{missedOpp.summary.prices_fresh}</b> ·
                        مش طازة (15+ دقيقة): <b className="text-orange-600">{missedOpp.summary.prices_stale}</b>
                      </span>
                    </div>
                  )}

                  {/* Missed bulls */}
                  {missedOpp.missed_bulls && missedOpp.missed_bulls.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <ThumbsDown className="h-4 w-4 text-red-500 flex-shrink-0" />
                        <span className="font-medium text-xs sm:text-sm">فرص ضاعت</span>
                        <Badge variant="destructive" className="text-[10px]">متوسط: +{missedOpp.summary.avg_missed_gain_pct}%</Badge>
                      </div>
                      <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
                        {missedOpp.missed_bulls.map((op: any) => (
                          <div key={op.id} className="p-2.5 sm:p-3 hover:bg-muted/40">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{op.ticker}</div>
                                <div className="text-[10px] sm:text-xs text-muted-foreground truncate">
                                  {op.name || op.sector || '—'}
                                </div>
                                <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                                  <span className="text-red-600">{op.signal}</span> · {op.days_since_prediction} يوم
                                  {op.price_is_stale && <span className="text-orange-600"> · ⏱️ سعر مش طازة</span>}
                                </div>
                              </div>
                              <div className="text-left flex-shrink-0">
                                <div className="font-bold text-red-600 text-sm sm:text-base">+{op.pct_change}%</div>
                                <div className="text-[10px] text-muted-foreground">{op.entry_price} → {op.current_price}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* False positives */}
                  {missedOpp.false_positives && missedOpp.false_positives.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                        <span className="font-medium text-xs sm:text-sm">توصيات شراء غلط</span>
                        <Badge className="text-[10px] bg-orange-100 text-orange-700">متوسط: {missedOpp.summary.avg_false_loss_pct}%</Badge>
                      </div>
                      <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
                        {missedOpp.false_positives.map((op: any) => (
                          <div key={op.id} className="p-2.5 sm:p-3 hover:bg-muted/40">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{op.ticker}</div>
                                <div className="text-[10px] sm:text-xs text-muted-foreground truncate">
                                  {op.name || op.sector || '—'}
                                </div>
                                <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                                  <span className="text-green-600">{op.signal}</span> · {op.days_since_prediction} يوم
                                  {op.price_is_stale && <span className="text-orange-600"> · ⏱️ سعر مش طازة</span>}
                                </div>
                              </div>
                              <div className="text-left flex-shrink-0">
                                <div className="font-bold text-orange-600 text-sm sm:text-base">{op.pct_change}%</div>
                                <div className="text-[10px] text-muted-foreground">{op.entry_price} → {op.current_price}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Correct calls */}
                  {(missedOpp.correct_buys?.length > 0 || missedOpp.correct_sells?.length > 0) && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <ThumbsUp className="h-4 w-4 text-green-500 flex-shrink-0" />
                        <span className="font-medium text-xs sm:text-sm">توصيات صحيحة</span>
                      </div>
                      <div className="max-h-60 overflow-y-auto border rounded-lg divide-y">
                        {missedOpp.correct_buys.slice(0, 5).map((op: any) => (
                          <div key={`cb-${op.id}`} className="flex items-center justify-between p-2.5 sm:p-3 hover:bg-muted/40 gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{op.ticker}</div>
                              <div className="text-[10px] sm:text-xs text-muted-foreground">
                                <span className="text-green-600">{op.signal}</span> · {op.days_since_prediction} يوم
                              </div>
                            </div>
                            <div className="text-left flex-shrink-0">
                              <div className="font-bold text-green-600 text-sm">+{op.pct_change}%</div>
                            </div>
                          </div>
                        ))}
                        {missedOpp.correct_sells.slice(0, 5).map((op: any) => (
                          <div key={`cs-${op.id}`} className="flex items-center justify-between p-2.5 sm:p-3 hover:bg-muted/40 gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{op.ticker}</div>
                              <div className="text-[10px] sm:text-xs text-muted-foreground">
                                <span className="text-red-600">{op.signal}</span> · {op.days_since_prediction} يوم
                              </div>
                            </div>
                            <div className="text-left flex-shrink-0">
                              <div className="font-bold text-green-600 text-sm">{op.pct_change}%</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* ─── القسم 2: ذكاء القطاعات ─── */}
          <Card>
            <CardHeader className="p-4 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                  <Layers className="h-5 w-5 text-blue-500 flex-shrink-0" />
                  <span>ذكاء القطاعات</span>
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={fetchSectorIntel} disabled={sectorIntelLoading} className="flex-shrink-0">
                  <RefreshCw className={cn('h-4 w-4', sectorIntelLoading && 'animate-spin')} />
                </Button>
              </div>
              <CardDescription className="text-xs">ترتيب القطاعات + Relative Strength لكل سهم ضد قطاعه</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
              {!sectorIntel && !sectorIntelLoading && (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  اضغط زر التحديث عشان يشغّل تحليل القطاعات
                </div>
              )}
              {sectorIntelLoading && (
                <div className="py-6 flex justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}
              {sectorIntel && sectorIntel.summary && (
                <>
                  {/* Market mood */}
                  <div className={cn(
                    'rounded-lg p-3 sm:p-4 text-center',
                    sectorIntel.summary.market_breadth?.market_mood?.includes('صاعد') ? 'bg-green-50 dark:bg-green-950/20' :
                    sectorIntel.summary.market_breadth?.market_mood?.includes('هابط') ? 'bg-red-50 dark:bg-red-950/20' :
                    'bg-yellow-50 dark:bg-yellow-950/20'
                  )}>
                    <div className="text-xs text-muted-foreground">مزاج السوق</div>
                    <div className="text-lg sm:text-2xl font-bold">{sectorIntel.summary.market_breadth?.market_mood || '—'}</div>
                    <div className="text-[10px] sm:text-xs text-muted-foreground mt-1">
                      {sectorIntel.summary.market_breadth?.sectors_up} طالع · {sectorIntel.summary.market_breadth?.sectors_down} نازل · من {sectorIntel.summary.market_breadth?.total_sectors}
                    </div>
                  </div>

                  {/* Best + worst */}
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    <div className="border rounded-lg p-2 sm:p-3 bg-green-50 dark:bg-green-950/20">
                      <div className="text-[10px] sm:text-xs text-muted-foreground">أقوى قطاع</div>
                      <div className="font-bold text-green-700 dark:text-green-300 text-xs sm:text-sm truncate">{sectorIntel.summary.best_sector?.sector || '—'}</div>
                      <div className="text-xs sm:text-sm text-green-600">+{sectorIntel.summary.best_sector?.avg_change_pct}%</div>
                    </div>
                    <div className="border rounded-lg p-2 sm:p-3 bg-red-50 dark:bg-red-950/20">
                      <div className="text-[10px] sm:text-xs text-muted-foreground">أضعف قطاع</div>
                      <div className="font-bold text-red-700 dark:text-red-300 text-xs sm:text-sm truncate">{sectorIntel.summary.worst_sector?.sector || '—'}</div>
                      <div className="text-xs sm:text-sm text-red-600">{sectorIntel.summary.worst_sector?.avg_change_pct}%</div>
                    </div>
                  </div>

                  {/* Sector ranking */}
                  {sectorIntel.sector_ranking && sectorIntel.sector_ranking.length > 0 && (
                    <div>
                      <div className="text-xs sm:text-sm font-medium mb-2">ترتيب القطاعات</div>
                      <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
                        {sectorIntel.sector_ranking.map((s: any, i: number) => (
                          <div key={s.sector} className="p-2.5 sm:p-3 hover:bg-muted/40">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                                  i === 0 ? 'bg-green-100 text-green-700' :
                                  i === sectorIntel.sector_ranking.length - 1 ? 'bg-red-100 text-red-700' :
                                  'bg-muted text-muted-foreground')}>{i + 1}</span>
                                <div className="min-w-0">
                                  <div className="font-medium text-xs sm:text-sm truncate">{s.sector}</div>
                                  <div className="text-[10px] sm:text-xs text-muted-foreground">
                                    {s.gainers} طالع · {s.losers} نازل · {s.total_stocks} سهم
                                  </div>
                                </div>
                              </div>
                              <div className="text-left flex-shrink-0">
                                <div className={cn('font-bold text-xs sm:text-sm', s.avg_change_pct > 0 ? 'text-green-600' : s.avg_change_pct < 0 ? 'text-red-600' : 'text-muted-foreground')}>
                                  {s.avg_change_pct > 0 ? '+' : ''}{s.avg_change_pct}%
                                </div>
                                {s.top_gainer && (
                                  <div className="text-[10px] text-muted-foreground truncate">أقوى: {s.top_gainer.ticker}</div>
                                )}
                              </div>
                            </div>
                            {/* Freshness indicator */}
                            {(s.prices_fresh_count > 0 || s.prices_stale_count > 0) && (
                              <div className="mt-1 text-[10px] text-muted-foreground flex items-center gap-1">
                                <Clock3 className="h-2.5 w-2.5" />
                                <span className="text-green-600">{s.prices_fresh_count} طازة</span>
                                <span>·</span>
                                <span className="text-orange-600">{s.prices_stale_count} مش طازة</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Top outperformers */}
                  {sectorIntel.top_outperformers && sectorIntel.top_outperformers.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Trophy className="h-4 w-4 text-amber-500 flex-shrink-0" />
                        <span className="font-medium text-xs sm:text-sm">أقوى أسهم تتفوق على قطاعها</span>
                      </div>
                      <div className="max-h-60 overflow-y-auto border rounded-lg divide-y">
                        {sectorIntel.top_outperformers.slice(0, 8).map((s: any) => (
                          <div key={s.ticker} className="p-2.5 sm:p-3 hover:bg-muted/40">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{s.ticker}</div>
                                <div className="text-[10px] sm:text-xs text-muted-foreground truncate">— {s.sector}</div>
                                <div className="text-[10px] sm:text-xs text-muted-foreground">
                                  السهم {s.stock_change_pct > 0 ? '+' : ''}{s.stock_change_pct}% · القطاع {s.sector_avg_change_pct}%
                                </div>
                              </div>
                              <Badge className="bg-green-100 text-green-700 text-[10px] flex-shrink-0">RS +{s.relative_strength}%</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* ─── القسم 3: الإجماع الخبير ─── */}
          <Card>
            <CardHeader className="p-4 sm:p-6">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                  <Crosshair className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                  <span>الإجماع الخبير</span>
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select
                    value={consensusVerdict}
                    onValueChange={(v) => { setConsensusVerdict(v); fetchConsensusList(v); }}
                  >
                    <SelectTrigger className="w-32 sm:w-40 h-8 text-xs">
                      <SelectValue placeholder="كل التوصيات" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      <SelectItem value="STRONG_BUY">شراء قوي</SelectItem>
                      <SelectItem value="BUY">شراء</SelectItem>
                      <SelectItem value="HOLD">احتفاظ</SelectItem>
                      <SelectItem value="SELL">بيع</SelectItem>
                      <SelectItem value="STRONG_SELL">بيع قوي</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => fetchConsensusList(consensusVerdict)} disabled={consensusLoading} className="flex-shrink-0">
                    <RefreshCw className={cn('h-4 w-4', consensusLoading && 'animate-spin')} />
                  </Button>
                </div>
              </div>
              <CardDescription className="text-xs">5 مصادر لكل سهم: توقع + أداء + RSI + MA + Relative Strength</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
              {/* Summary by verdict — 5 cols على الديسكتوب، 5 cols صغيرة على الموبايل */}
              {consensusSummary?.by_verdict && (
                <div className="grid grid-cols-5 gap-1 sm:gap-2">
                  {[
                    { k: 'STRONG_BUY', label: 'قوي', color: 'bg-green-600' },
                    { k: 'BUY', label: 'شراء', color: 'bg-green-500' },
                    { k: 'HOLD', label: 'احتفاظ', color: 'bg-yellow-500' },
                    { k: 'SELL', label: 'بيع', color: 'bg-red-500' },
                    { k: 'STRONG_SELL', label: 'بيع قوي', color: 'bg-red-600' },
                  ].map(v => (
                    <div key={v.k} className="border rounded-lg p-1.5 sm:p-2 text-center">
                      <div className={cn('text-base sm:text-xl font-bold text-white rounded mx-auto w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center', v.color)}>
                        {consensusSummary.by_verdict[v.k] || 0}
                      </div>
                      <div className="text-[9px] sm:text-xs text-muted-foreground mt-1">{v.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {consensusLoading && (
                <div className="py-6 flex justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {!consensusLoading && consensusList.length === 0 && (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  مفيش بيانات consensus متاحة — شغّل تحليل جديد الأول
                </div>
              )}

              {/* Consensus list */}
              {consensusList.length > 0 && (
                <div className="max-h-96 overflow-y-auto border rounded-lg divide-y">
                  {consensusList.map((c: any) => {
                    const vColor = c.verdict === 'STRONG_BUY' ? 'bg-green-600' :
                                   c.verdict === 'BUY' ? 'bg-green-500' :
                                   c.verdict === 'SELL' ? 'bg-red-500' :
                                   c.verdict === 'STRONG_SELL' ? 'bg-red-600' : 'bg-yellow-500';
                    const vLabel = c.verdict === 'STRONG_BUY' ? 'شراء قوي' :
                                   c.verdict === 'BUY' ? 'شراء' :
                                   c.verdict === 'SELL' ? 'بيع' :
                                   c.verdict === 'STRONG_SELL' ? 'بيع قوي' : 'احتفاظ';
                    return (
                      <div key={c.ticker} className="p-2.5 sm:p-3 hover:bg-muted/40">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-sm">{c.ticker}</span>
                              {c.is_egx30 && <Badge variant="outline" className="text-[9px] px-1 py-0">EGX30</Badge>}
                              {c.is_egx100 && !c.is_egx30 && <Badge variant="outline" className="text-[9px] px-1 py-0">EGX100</Badge>}
                              {c.current_state?.price_is_stale && (
                                <Badge className="text-[9px] px-1 py-0 bg-orange-100 text-orange-700">⏱️ سعر مش طازة</Badge>
                              )}
                            </div>
                            <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 truncate">
                              {c.name || c.sector || '—'}
                            </div>
                            <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                              {c.current_state.price != null && <span>{c.current_state.price} · </span>}
                              {c.current_state.change_pct != null && (
                                <span className={c.current_state.change_pct > 0 ? 'text-green-600' : c.current_state.change_pct < 0 ? 'text-red-600' : ''}>
                                  {c.current_state.change_pct > 0 ? '+' : ''}{c.current_state.change_pct}%
                                </span>
                              )}
                              {c.current_state.rsi != null && c.current_state.rsi > 0 && <span> · RSI {c.current_state.rsi.toFixed(0)}</span>}
                              {c.sector_context.relative_strength != null && (
                                <span className={c.sector_context.relative_strength > 0 ? ' text-green-600' : c.sector_context.relative_strength < 0 ? ' text-red-600' : ''}>
                                  {' '}· RS {c.sector_context.relative_strength > 0 ? '+' : ''}{c.sector_context.relative_strength}%
                                </span>
                              )}
                            </div>
                            {/* freshness minutes */}
                            {c.current_state?.price_freshness_minutes != null && (
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                <Clock3 className="h-2.5 w-2.5 inline" /> آخر سعر منذ {c.current_state.price_freshness_minutes} دقيقة
                              </div>
                            )}
                          </div>
                          <div className="text-left flex-shrink-0">
                            <Badge className={cn('text-white text-[10px] sm:text-xs', vColor)}>{vLabel}</Badge>
                            <div className="text-[10px] sm:text-xs text-muted-foreground mt-1">ثقة {c.confidence_pct}%</div>
                          </div>
                        </div>
                        {/* Reasons */}
                        {c.reasons && c.reasons.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {c.reasons.slice(0, 3).map((r: string, i: number) => (
                              <Badge key={i} variant="secondary" className="text-[9px] sm:text-[10px] font-normal">{r}</Badge>
                            ))}
                          </div>
                        )}
                        {/* Dissent */}
                        {c.dissent && c.dissent.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {c.dissent.map((d: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-[9px] sm:text-[10px] font-normal text-orange-600 border-orange-300">⚠ {d}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Single ticker consensus */}
              <Separator />
              <div>
                <div className="text-xs sm:text-sm font-medium mb-2">اسأل عن إجماع سهم معين</div>
                <div className="flex gap-2">
                  <Input
                    placeholder="مثال: COMI"
                    value={singleConsensusTicker}
                    onChange={(e) => setSingleConsensusTicker(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && fetchSingleConsensus(singleConsensusTicker)}
                    className="max-w-xs h-9 text-sm"
                  />
                  <Button onClick={() => fetchSingleConsensus(singleConsensusTicker)} disabled={singleConsensusLoading || !singleConsensusTicker} size="sm">
                    {singleConsensusLoading ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Crosshair className="h-4 w-4 ml-1" />}
                    إجماع
                  </Button>
                </div>
                {singleConsensus && (
                  <div className="mt-3 border rounded-lg p-3 sm:p-4 space-y-2 bg-muted/30">
                    {singleConsensus.error ? (
                      <div className="text-red-600 text-sm">{singleConsensus.error}</div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">{singleConsensus.ticker}</span>
                          <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{singleConsensus.name || '—'}</span>
                          <Badge className={cn('text-white text-xs',
                            singleConsensus.verdict === 'STRONG_BUY' ? 'bg-green-600' :
                            singleConsensus.verdict === 'BUY' ? 'bg-green-500' :
                            singleConsensus.verdict === 'SELL' ? 'bg-red-500' :
                            singleConsensus.verdict === 'STRONG_SELL' ? 'bg-red-600' : 'bg-yellow-500')}>
                            {singleConsensus.verdict === 'STRONG_BUY' ? 'شراء قوي' :
                             singleConsensus.verdict === 'BUY' ? 'شراء' :
                             singleConsensus.verdict === 'SELL' ? 'بيع' :
                             singleConsensus.verdict === 'STRONG_SELL' ? 'بيع قوي' : 'احتفاظ'}
                          </Badge>
                          <span className="text-xs">ثقة: <b>{singleConsensus.confidence_pct}%</b></span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {singleConsensus.bullish_signals} إشارة شراء · {singleConsensus.bearish_signals} إشارة بيع
                          {singleConsensus.current_state?.price_freshness_minutes != null && (
                            <span> · آخر سعر منذ {singleConsensus.current_state.price_freshness_minutes} دقيقة</span>
                          )}
                        </div>
                        {singleConsensus.reasons && singleConsensus.reasons.length > 0 && (
                          <div className="text-xs sm:text-sm">
                            <span className="font-medium">الأسباب: </span>
                            <ul className="list-disc mr-5 mt-1 space-y-0.5">
                              {singleConsensus.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                            </ul>
                          </div>
                        )}
                        {singleConsensus.dissent && singleConsensus.dissent.length > 0 && (
                          <div className="text-xs sm:text-sm">
                            <span className="font-medium text-orange-600">تحذيرات: </span>
                            <ul className="list-disc mr-5 mt-1 space-y-0.5">
                              {singleConsensus.dissent.map((d: string, i: number) => <li key={i}>{d}</li>)}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Crypto Tab - نظام تحليل مستقل */}
        <TabsContent value="crypto" className="space-y-4">
          <div className="bg-gradient-to-r from-orange-50 to-yellow-50 dark:from-orange-950/20 dark:to-yellow-950/20 p-4 rounded-lg border border-orange-200 dark:border-orange-800 mb-4">
            <div className="flex items-center gap-2">
              <Bitcoin className="h-5 w-5 text-orange-600" />
              <span className="font-bold text-orange-800 dark:text-orange-200">نظام تحليل العملات الرقمية</span>
            </div>
            <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
              تحليل شامل لـ 50 عملة رقمية - Fear & Greed، BTC Dominance، تصنيف الفرص
            </p>
          </div>
          <CryptoPredictionGenerator />
        </TabsContent>
      </Tabs>

      {/* Action Panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">لوحة التحكم</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <Label>تحليل سهم محدد</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="رمز السهم (مثال: COMI)"
                  value={selectedStock}
                  onChange={(e) => setSelectedStock(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && analyzeSingleStock(selectedStock)}
                />
                <Button onClick={() => analyzeSingleStock(selectedStock)} disabled={loading || !selectedStock}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Separator orientation="vertical" className="hidden sm:block h-20" />
            <Separator className="sm:hidden" />
            <div className="flex flex-col gap-2">
              <Button
                onClick={runFullAnalysis}
                disabled={analysisRunning}
                className="bg-primary"
              >
                {analysisRunning ? (
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 ml-2" />
                )}
                تشغيل التحليل الكامل
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => exportResults('csv')}>
                  <FileSpreadsheet className="h-4 w-4 ml-2" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportResults('json')}>
                  <FileJson className="h-4 w-4 ml-2" />
                  JSON
                </Button>
              </div>
            </div>
          </div>
          {analysisRunning && (
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span>جاري التحليل...</span>
                <span>{analysisProgress}%</span>
              </div>
              <Progress value={analysisProgress} className="h-2" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle className="text-lg">نتائج التحليل</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">فلترة الدرجة:</Label>
                <Select
                  value={`${scoreFilter[0]}-${scoreFilter[1]}`}
                  onValueChange={(v) => {
                    const [min, max] = v.split('-').map(Number);
                    setScoreFilter([min, max]);
                  }}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0-100">الكل</SelectItem>
                    <SelectItem value="81-100">شراء قوي</SelectItem>
                    <SelectItem value="61-80">شراء</SelectItem>
                    <SelectItem value="41-60">احتفاظ</SelectItem>
                    <SelectItem value="0-40">بيع/تجنب</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="بحث..."
                value={searchTicker}
                onChange={(e) => setSearchTicker(e.target.value)}
                className="w-32"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cursor-pointer" onClick={() => handleSort('ticker')}>
                        السهم
                        <ArrowUpDown className="inline h-4 w-4 mr-1" />
                      </TableHead>
                      <TableHead className="cursor-pointer" onClick={() => handleSort('maestroScore')}>
                        الدرجة
                        <ArrowUpDown className="inline h-4 w-4 mr-1" />
                      </TableHead>
                      <TableHead>التحليل</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead className="cursor-pointer" onClick={() => handleSort('timeframeConfluence')}>
                        التقارب
                        <ArrowUpDown className="inline h-4 w-4 mr-1" />
                      </TableHead>
                      <TableHead className="cursor-pointer" onClick={() => handleSort('volumeRating')}>
                        الحجم
                        <ArrowUpDown className="inline h-4 w-4 mr-1" />
                      </TableHead>
                      <TableHead>الأخبار</TableHead>
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedResults.length > 0 ? (
                      paginatedResults.map((result) => (
                        <TableRow key={result.ticker}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{result.ticker}</div>
                              <div className="text-xs text-muted-foreground">{result.name}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <ScoreDisplay score={result.maestroScore} showLabel={false} />
                          </TableCell>
                          <TableCell>
                            <Badge className={cn('text-white', RECOMMENDATION_CONFIG[result.recommendation]?.bg)}>
                              {RECOMMENDATION_CONFIG[result.recommendation]?.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {React.createElement(REGIME_CONFIG[result.regime]?.icon || Activity, {
                                className: cn('h-4 w-4', REGIME_CONFIG[result.regime]?.color)
                              })}
                              <span className="text-sm">{REGIME_CONFIG[result.regime]?.label}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={result.timeframeConfluence} className="w-16 h-2" />
                              <span className="text-xs">{Math.round(result.timeframeConfluence)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={result.volumeRating} className="w-16 h-2" />
                              <span className="text-xs">{Math.round(result.volumeRating)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn(
                              SENTIMENT_CONFIG[result.newsSentiment]?.bg,
                              SENTIMENT_CONFIG[result.newsSentiment]?.color
                            )}>
                              {SENTIMENT_CONFIG[result.newsSentiment]?.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>عرض التفاصيل</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                      <Download className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>تصدير</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          لا توجد نتائج - قم بتشغيل التحليل
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    عرض {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredAndSortedResults.length)} من {filteredAndSortedResults.length}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">{currentPage} / {totalPages}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Statistics Panel */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          title="نسبة النجاح"
          value={`${stats?.winRate?.toFixed(1) || '--'}%`}
          subtitle="من الإشارات"
          icon={Target}
          color="success"
        />
        <StatCard
          title="معامل الربح"
          value={stats?.profitFactor?.toFixed(2) || '--'}
          subtitle="Profit Factor"
          icon={DollarSign}
          color="primary"
        />
        <StatCard
          title="متوسط العائد"
          value={`${stats?.avgReturn?.toFixed(1) || '--'}%`}
          subtitle="لكل صفقة"
          icon={Percent}
          color={stats?.avgReturn && stats.avgReturn > 0 ? 'success' : 'danger'}
        />
        <StatCard
          title="إجمالي الإشارات"
          value={stats?.totalSignals || 0}
          subtitle="إشارة"
          icon={Zap}
          color="primary"
        />
        <StatCard
          title="أفضل مرحلة"
          value={stats?.successByPhase ? Math.max(...Object.values(stats.successByPhase)).toFixed(0) + '%' : '--'}
          subtitle="أعلى نسبة نجاح"
          icon={Award}
          color="success"
        />
      </div>

      {/* Success Rate by Phase */}
      {stats?.successByPhase && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">نسبة النجاح حسب المرحلة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {Object.entries(stats.successByPhase).map(([phase, rate]) => (
                <div key={phase} className="text-center">
                  <div className="text-sm text-muted-foreground mb-1">المرحلة {phase.replace('phase', '')}</div>
                  <Progress value={rate} className="h-2 mb-1" />
                  <div className="text-lg font-bold">{rate.toFixed(0)}%</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default MaestroDashboard;
