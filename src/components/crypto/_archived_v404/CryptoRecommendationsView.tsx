'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Target,
  Bitcoin,
  Search,
  Filter,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Info,
  Shield,
  Zap,
  Star,
  BarChart3,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Gauge,
  Users,
  Send,
  Loader2,
  Flame,
  Snowflake,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { PersonaSelector } from '@/components/persona/PersonaSelector';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/*  Types & Interfaces                                                 */
/* ------------------------------------------------------------------ */

/**
 * Flow Score data returned by /api/crypto/flow/top
 * Python backend: vps-service/engine/crypto_engine.py::CryptoFlowScore
 */
interface FlowCoin {
  symbol: string;
  name: string;
  price_usd: number;
  change_24h: number;
  change_7d: number;
  flow_score: number;
  label: string;        // Arabic label: نار / شرارة / رماد / بارد
  label_en: string;     // English label: FIRE / SPARK / ASH / COLD
  color: string;        // red / orange / amber / blue
  volume_score: number;
  momentum_score: number;
  market_cap_score: number;
  trend_score: number;
  market_cap: number;
  volume_24h: number;
  rank: number;
  action: string;       // Arabic action: دخول قوي / دخول حذر / استنى / ماتدخلش
  action_en: string;    // STRONG_ENTRY / CAUTIOUS_ENTRY / WAIT / AVOID
  position_size: number;
  stop_loss: number;    // negative percentage (e.g. -5)
  target: number;       // positive percentage (e.g. +20)
  // Merged from /api/crypto/explosive/top
  pattern?: string;
  pattern_en?: string;
  volume_ratio?: number;
}

type FlowCategory = 'fire' | 'spark' | 'ash' | 'cold';

/* ------------------------------------------------------------------ */
/*  Helper Functions                                                   */
/* ------------------------------------------------------------------ */

function formatNumber(num: number | null | undefined): string {
  if (num == null || Number.isNaN(num)) return '0';
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

function formatPrice(price: number | null | undefined): string {
  if (price == null || Number.isNaN(price)) return '$0.00';
  if (price >= 1) return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return '$' + price.toFixed(4);
  return '$' + price.toFixed(8);
}

function formatPercent(percent: number | null | undefined): string {
  if (percent == null || Number.isNaN(percent)) return '0.00%';
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

/**
 * Map Python backend color string → category + Tailwind classes.
 * red=نار (FIRE), orange=شرارة (SPARK), amber=رماد (ASH), blue=بارد (COLD)
 */
function colorToCategory(color: string): FlowCategory {
  switch ((color || '').toLowerCase()) {
    case 'red': return 'fire';
    case 'orange': return 'spark';
    case 'amber': return 'ash';
    case 'blue': return 'cold';
    default: return 'cold';
  }
}

function categoryConfig(cat: FlowCategory): {
  label: string;
  label_en: string;
  badge: string;
  icon: React.ReactNode;
  ring: string;
  text: string;
  progress: string;
} {
  switch (cat) {
    case 'fire':
      return {
        label: 'نار',
        label_en: 'FIRE',
        badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-200 dark:border-rose-800',
        icon: <Flame className="w-3.5 h-3.5" />,
        ring: 'ring-rose-300 dark:ring-rose-700',
        text: 'text-rose-600 dark:text-rose-400',
        progress: '[&>div]:bg-rose-500',
      };
    case 'spark':
      return {
        label: 'شرارة',
        label_en: 'SPARK',
        badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-orange-200 dark:border-orange-800',
        icon: <Zap className="w-3.5 h-3.5" />,
        ring: 'ring-orange-300 dark:ring-orange-700',
        text: 'text-orange-600 dark:text-orange-400',
        progress: '[&>div]:bg-orange-500',
      };
    case 'ash':
      return {
        label: 'رماد',
        label_en: 'ASH',
        badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800',
        icon: <Activity className="w-3.5 h-3.5" />,
        ring: 'ring-amber-300 dark:ring-amber-700',
        text: 'text-amber-600 dark:text-amber-400',
        progress: '[&>div]:bg-amber-500',
      };
    case 'cold':
      return {
        label: 'بارد',
        label_en: 'COLD',
        badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 border-sky-200 dark:border-sky-800',
        icon: <Snowflake className="w-3.5 h-3.5" />,
        ring: 'ring-sky-300 dark:ring-sky-700',
        text: 'text-sky-600 dark:text-sky-400',
        progress: '[&>div]:bg-sky-500',
      };
  }
}

function actionBadgeClass(action_en: string): string {
  switch (action_en) {
    case 'STRONG_ENTRY':
      return 'bg-emerald-500 text-white';
    case 'CAUTIOUS_ENTRY':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
    case 'WAIT':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
    case 'AVOID':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/* ------------------------------------------------------------------ */
/*  Skeleton Loading                                                   */
/* ------------------------------------------------------------------ */

function RecommendationsSkeleton() {
  return (
    <div className="space-y-4 p-4 md:p-6" dir="rtl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-md rounded-lg" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Recommendation Card                                                */
/* ------------------------------------------------------------------ */

function RecommendationCard({
  coin,
  isExpanded,
  onToggle,
}: {
  coin: FlowCoin;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const cat = colorToCategory(coin.color);
  const cfg = categoryConfig(cat);
  const isPositive24h = (coin.change_24h ?? 0) >= 0;
  const isPositive7d = (coin.change_7d ?? 0) >= 0;
  const volRatio = coin.volume_ratio ?? 0;
  const hasTradeSetup = coin.position_size > 0 || coin.target > 0 || coin.stop_loss < 0;

  return (
    <Card className={cn(
      'border-border/60 transition-all hover:shadow-md ring-1',
      cfg.ring
    )}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
              <Bitcoin className="w-5 h-5 text-orange-500" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-foreground truncate">
                {coin.symbol}
              </h3>
              <p className="text-xs text-muted-foreground truncate">{coin.name}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge className={cn('text-xs border', cfg.badge)}>
              {cfg.icon}
              <span className="mr-1">{coin.label}</span>
            </Badge>
            <Badge className={cn('text-xs font-bold', actionBadgeClass(coin.action_en))}>
              {coin.action}
            </Badge>
          </div>
        </div>

        {/* Price & Change */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-lg font-bold text-foreground" dir="ltr">
              {formatPrice(coin.price_usd)}
            </span>
            <div className={cn(
              'flex items-center gap-1 text-xs',
              isPositive24h ? 'text-emerald-500' : 'text-rose-500'
            )}>
              {isPositive24h ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span dir="ltr">{formatPercent(coin.change_24h)}</span>
            </div>
          </div>
          <div className="text-left">
            <p className="text-xs text-muted-foreground">تغير 7 أيام</p>
            <p className={cn(
              'font-bold text-sm',
              isPositive7d ? 'text-emerald-500' : 'text-rose-500'
            )} dir="ltr">
              {formatPercent(coin.change_7d)}
            </p>
          </div>
        </div>

        {/* Flow Score Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5" />
              Flow Score
            </span>
            <span className={cn('font-bold', cfg.text)}>
              {coin.flow_score.toFixed(0)} / 100
            </span>
          </div>
          <Progress
            value={coin.flow_score}
            className={cn('h-2', cfg.progress)}
          />
        </div>

        {/* Trade Setup: Entry / Target / Stop */}
        {hasTradeSetup && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                <Target className="w-2.5 h-2.5" />
                الهدف
              </p>
              <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400" dir="ltr">
                +{coin.target.toFixed(0)}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                <Shield className="w-2.5 h-2.5" />
                ستوب لوز
              </p>
              <p className="text-sm font-bold text-rose-600 dark:text-rose-400" dir="ltr">
                {coin.stop_loss.toFixed(0)}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                <BarChart3 className="w-2.5 h-2.5" />
                حجم الصفقة
              </p>
              <p className="text-sm font-bold text-orange-600 dark:text-orange-400">
                {coin.position_size}%
              </p>
            </div>
          </div>
        )}

        {/* Pattern & Volume Ratio */}
        {(coin.pattern || volRatio > 0) && (
          <div className="flex items-center justify-between gap-2 text-xs">
            {coin.pattern && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Activity className="w-3 h-3" />
                {coin.pattern}
              </Badge>
            )}
            {volRatio > 0 && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] gap-1',
                  volRatio >= 2 ? 'border-rose-300 text-rose-700 dark:text-rose-400' :
                  volRatio >= 1.5 ? 'border-orange-300 text-orange-700 dark:text-orange-400' :
                  'border-muted-foreground/30'
                )}
              >
                <Zap className="w-3 h-3" />
                حجم × {volRatio.toFixed(2)}
              </Badge>
            )}
          </div>
        )}

        {/* Collapsible Details */}
        <Collapsible open={isExpanded} onOpenChange={onToggle}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full h-8 text-xs">
              {isExpanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
              {isExpanded ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            {/* Sub-scores */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">تفصيل النقاط</p>
              {[
                { label: 'حجم التداول', value: coin.volume_score, icon: <BarChart3 className="w-3 h-3" /> },
                { label: 'الزخم', value: coin.momentum_score, icon: <Activity className="w-3 h-3" /> },
                { label: 'القيمة السوقية', value: coin.market_cap_score, icon: <Gauge className="w-3 h-3" /> },
                { label: 'الاتجاه', value: coin.trend_score, icon: <TrendingUp className="w-3 h-3" /> },
              ].map(s => (
                <div key={s.label} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground flex items-center gap-1">{s.icon}{s.label}</span>
                    <span className="font-medium">{s.value.toFixed(0)}</span>
                  </div>
                  <Progress value={s.value} className="h-1.5 [&>div]:bg-orange-400" />
                </div>
              ))}
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
              <div className="bg-muted/30 rounded-lg p-2">
                <p className="text-[10px] text-muted-foreground">القيمة السوقية</p>
                <p className="text-sm font-semibold" dir="ltr">${formatNumber(coin.market_cap)}</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <p className="text-[10px] text-muted-foreground">حجم التداول 24س</p>
                <p className="text-sm font-semibold" dir="ltr">${formatNumber(coin.volume_24h)}</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <p className="text-[10px] text-muted-foreground">الترتيب</p>
                <p className="text-sm font-semibold">#{coin.rank}</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <p className="text-[10px] text-muted-foreground">معدل الحجم</p>
                <p className="text-sm font-semibold" dir="ltr">×{(coin.volume_ratio ?? 0).toFixed(2)}</p>
              </div>
            </div>

            {/* Pattern info */}
            {coin.pattern && (
              <div className="bg-muted/30 rounded-lg p-2 text-xs">
                <p className="font-semibold flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5" />
                  النمط المكتشف: {coin.pattern}
                </p>
                {coin.pattern_en && (
                  <p className="text-muted-foreground mt-1" dir="ltr">{coin.pattern_en}</p>
                )}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function CryptoRecommendationsView() {
  const [coins, setCoins] = useState<FlowCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeAction, setActiveAction] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'flow_score' | 'change_24h' | 'change_7d' | 'rank' | 'volume_ratio'>('flow_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [sendingToTelegram, setSendingToTelegram] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // Fetch data from Python backend: flow + explosive (for pattern)
  const fetchCoins = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [flowRes, explosiveRes] = await Promise.all([
        fetch('/api/crypto/flow/top?limit=50', { signal: AbortSignal.timeout(15000) }),
        fetch('/api/crypto/explosive/top?limit=111', { signal: AbortSignal.timeout(15000) }),
      ]);

      const flowData = await flowRes.json();
      const explosiveData = await explosiveRes.json();

      if (!flowData?.success || !Array.isArray(flowData.data)) {
        setError(flowData?.error || 'فشل في تحميل بيانات Flow Score');
        setCoins([]);
        return;
      }

      // Build explosive map by symbol (for pattern + volume_ratio)
      const explosiveMap: Record<string, any> = {};
      if (explosiveData?.success && Array.isArray(explosiveData.data)) {
        for (const e of explosiveData.data) {
          if (e?.symbol) {
            explosiveMap[String(e.symbol).toUpperCase()] = e;
          }
        }
      }

      // Merge flow + explosive
      const merged: FlowCoin[] = flowData.data.map((c: any) => {
        const sym = String(c?.symbol || '').toUpperCase();
        const ex = explosiveMap[sym] || {};
        return {
          symbol: sym,
          name: String(c?.name || sym),
          price_usd: Number(c?.price_usd ?? 0),
          change_24h: Number(c?.change_24h ?? 0),
          change_7d: Number(c?.change_7d ?? 0),
          flow_score: Number(c?.flow_score ?? 0),
          label: String(c?.label || ''),
          label_en: String(c?.label_en || ''),
          color: String(c?.color || 'blue'),
          volume_score: Number(c?.volume_score ?? 0),
          momentum_score: Number(c?.momentum_score ?? 0),
          market_cap_score: Number(c?.market_cap_score ?? 0),
          trend_score: Number(c?.trend_score ?? 0),
          market_cap: Number(c?.market_cap ?? 0),
          volume_24h: Number(c?.volume_24h ?? 0),
          rank: Number(c?.rank ?? 999),
          action: String(c?.action || ''),
          action_en: String(c?.action_en || ''),
          position_size: Number(c?.position_size ?? 0),
          stop_loss: Number(c?.stop_loss ?? 0),
          target: Number(c?.target ?? 0),
          pattern: ex.pattern ? String(ex.pattern) : undefined,
          pattern_en: ex.pattern_en ? String(ex.pattern_en) : undefined,
          volume_ratio: ex.volume_ratio != null ? Number(ex.volume_ratio) : undefined,
        };
      });

      setCoins(merged);
      setLastUpdated(new Date().toLocaleString('ar-EG'));
    } catch (e) {
      console.error('Error fetching flow data:', e);
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchCoins();
    const interval = setInterval(() => fetchCoins(), 60000); // 60s auto-refresh
    return () => clearInterval(interval);
  }, [fetchCoins]);

  // Toggle card expansion
  const toggleCard = (symbol: string) => {
    setExpandedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(symbol)) newSet.delete(symbol);
      else newSet.add(symbol);
      return newSet;
    });
  };

  // Filtered and sorted coins
  const filteredCoins = useMemo(() => {
    let result = coins.filter(coin => {
      const matchesSearch =
        coin.name.toLowerCase().includes(search.toLowerCase()) ||
        coin.symbol.toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        activeCategory === 'all' || colorToCategory(coin.color) === activeCategory;
      const matchesAction =
        activeAction === 'all' || coin.action_en === activeAction;
      return matchesSearch && matchesCategory && matchesAction;
    });

    const dir = sortAsc ? 1 : -1;
    switch (sortBy) {
      case 'flow_score':
        result.sort((a, b) => (a.flow_score - b.flow_score) * dir);
        break;
      case 'change_24h':
        result.sort((a, b) => (a.change_24h - b.change_24h) * dir);
        break;
      case 'change_7d':
        result.sort((a, b) => (a.change_7d - b.change_7d) * dir);
        break;
      case 'rank':
        result.sort((a, b) => (a.rank - b.rank) * dir);
        break;
      case 'volume_ratio':
        result.sort((a, b) => ((a.volume_ratio ?? 0) - (b.volume_ratio ?? 0)) * dir);
        break;
    }
    return result;
  }, [coins, search, activeCategory, activeAction, sortBy, sortAsc]);

  // Category stats
  const categoryStats = useMemo(() => {
    const stats = { fire: 0, spark: 0, ash: 0, cold: 0 };
    coins.forEach(c => {
      const cat = colorToCategory(c.color);
      stats[cat]++;
    });
    return stats;
  }, [coins]);

  // Average Flow Score
  const averageFlowScore = useMemo(() => {
    if (coins.length === 0) return 0;
    return coins.reduce((sum, c) => sum + c.flow_score, 0) / coins.length;
  }, [coins]);

  // Best opportunities (Flow Score >= 60)
  const bestOpportunities = useMemo(() => {
    return coins
      .filter(c => c.flow_score >= 60)
      .sort((a, b) => b.flow_score - a.flow_score)
      .slice(0, 5);
  }, [coins]);

  // Generate Telegram share message
  const generateShareMessage = useCallback(() => {
    const dateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

    let message = `🔥 Flow Score - تحليل العملات الرقمية\n`;
    message += `━━━━━━━━━━━━━━━━━━\n\n`;
    message += `📅 ${dateStr}\n\n`;
    message += `📊 الملخص:\n`;
    message += `🔴 نار: ${categoryStats.fire}\n`;
    message += `🟠 شرارة: ${categoryStats.spark}\n`;
    message += `🟡 رماد: ${categoryStats.ash}\n`;
    message += `🔵 بارد: ${categoryStats.cold}\n`;
    message += `⭐ متوسط Flow Score: ${averageFlowScore.toFixed(0)}/100\n\n`;

    if (bestOpportunities.length > 0) {
      message += `🚀 أفضل الفرص:\n`;
      bestOpportunities.forEach((coin, i) => {
        message += `${i + 1}. <b>${coin.symbol}</b> - ${coin.name}\n`;
        message += `   💰 ${formatPrice(coin.price_usd)}\n`;
        message += `   🔥 Flow Score: ${coin.flow_score.toFixed(0)}/100 (${coin.label})\n`;
        message += `   ${coin.action}${coin.pattern ? ' | ' + coin.pattern : ''}\n\n`;
      });
    }

    message += `━━━━━━━━━━━━━━━━━━\n`;
    message += `🚀 دليل الاستثمار`;
    return message;
  }, [bestOpportunities, categoryStats, averageFlowScore]);

  // Send to Telegram
  const handleSendToTelegram = useCallback(async () => {
    if (coins.length === 0) {
      toast.error('لا توجد بيانات للمشاركة');
      return;
    }
    setSendingToTelegram(true);
    try {
      const message = generateShareMessage();
      const response = await fetch('/api/telegram/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          parseMode: 'HTML',
          title: 'Flow Score - تحليل العملات الرقمية',
          generateImage: true,
        }),
      });
      const data = await response.json();
      if (data.success) {
        const imageMsg = data.hasImage ? ' (مع صورة)' : '';
        toast.success(`تم النشر على تليجرام بنجاح! ✅${imageMsg}`);
      } else {
        toast.error(data.error || 'فشل في النشر');
      }
    } catch (err) {
      console.error('Telegram send error:', err);
      toast.error('خطأ في الاتصال');
    } finally {
      setSendingToTelegram(false);
    }
  }, [coins.length, generateShareMessage]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background" dir="rtl">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-yellow-500 flex items-center justify-center">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Flow Score — تحليلات العملات الرقمية</h1>
                <p className="text-xs text-muted-foreground">محرك تحليل العملات</p>
              </div>
            </div>
          </div>
        </div>
        <RecommendationsSkeleton />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-yellow-500 flex items-center justify-center">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Flow Score — تحليلات العملات الرقمية</h1>
                <p className="text-xs text-muted-foreground">محرك التدفقات الذكي · 50 عملة</p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="ابحث عن عملة..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-9"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => fetchCoins(true)}
                disabled={refreshing}
              >
                <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
              </Button>
              <Button
                size="sm"
                onClick={handleSendToTelegram}
                disabled={sendingToTelegram || coins.length === 0}
                className="bg-[#0088cc] hover:bg-[#0077b5] text-white gap-1"
              >
                {sendingToTelegram ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">نشر تليجرام</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-5">
        {/* Persona Selector */}
        <section dir="rtl">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-orange-500" />
            <h3 className="text-sm font-semibold">اختر شخصيتك الاستثمارية</h3>
            <Badge variant="outline" className="text-[10px]">يؤثر على القرار</Badge>
          </div>
          <PersonaSelector showDescription />
        </section>

        {/* Error State */}
        {error && (
          <div className="flex flex-col items-center justify-center py-12 gap-4" dir="rtl">
            <AlertCircle className="w-12 h-12 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">{error}</p>
            <Button variant="outline" onClick={() => fetchCoins()}>
              <RefreshCw className="w-4 h-4 ml-2" />
              إعادة المحاولة
            </Button>
          </div>
        )}

        {!error && (
          <>
            {/* Disclaimer */}
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    إخلاء المسؤولية
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    تحليلات Flow Score تعتمد على معدل الحجم والزخم والقيمة السوقية والاتجاه. للأغراض التعليمية فقط ولا تمثل نصيحة استثمارية.
                  </p>
                </div>
              </div>
            </div>

            {/* Summary Stats: Fire / Spark / Ash / Cold */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="border-rose-200/60 dark:border-rose-800/60">
                <CardContent className="p-4 flex flex-col items-center gap-1">
                  <Flame className="w-5 h-5 text-rose-500" />
                  <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                    {categoryStats.fire}
                  </span>
                  <span className="text-xs text-muted-foreground">نار · دخول قوي</span>
                </CardContent>
              </Card>
              <Card className="border-orange-200/60 dark:border-orange-800/60">
                <CardContent className="p-4 flex flex-col items-center gap-1">
                  <Zap className="w-5 h-5 text-orange-500" />
                  <span className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {categoryStats.spark}
                  </span>
                  <span className="text-xs text-muted-foreground">شرارة · دخول حذر</span>
                </CardContent>
              </Card>
              <Card className="border-amber-200/60 dark:border-amber-800/60">
                <CardContent className="p-4 flex flex-col items-center gap-1">
                  <Activity className="w-5 h-5 text-amber-500" />
                  <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                    {categoryStats.ash}
                  </span>
                  <span className="text-xs text-muted-foreground">رماد · استنى</span>
                </CardContent>
              </Card>
              <Card className="border-sky-200/60 dark:border-sky-800/60">
                <CardContent className="p-4 flex flex-col items-center gap-1">
                  <Snowflake className="w-5 h-5 text-sky-500" />
                  <span className="text-2xl font-bold text-sky-600 dark:text-sky-400">
                    {categoryStats.cold}
                  </span>
                  <span className="text-xs text-muted-foreground">بارد · ماتدخلش</span>
                </CardContent>
              </Card>
            </div>

            {/* Average Flow Score Card */}
            <Card className="border-border/60 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center">
                    <Gauge className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">متوسط Flow Score للسوق</p>
                    <p className="text-xs text-muted-foreground">من أصل {coins.length} عملة محللة</p>
                  </div>
                </div>
                <div className="text-left">
                  <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {averageFlowScore.toFixed(0)}<span className="text-sm text-muted-foreground">/100</span>
                  </p>
                  <Badge variant="outline" className="text-[10px] mt-1">
                    {averageFlowScore >= 60 ? 'سوق نشط' : averageFlowScore >= 40 ? 'سوق هادئ' : 'سوق بارد'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Best Opportunities */}
            {bestOpportunities.length > 0 && (
              <Card className="border-emerald-200 dark:border-emerald-800 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                    <Star className="w-4 h-4 fill-emerald-500 text-emerald-500" />
                    أفضل الفرص الحالية (Flow Score ≥ 60)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {bestOpportunities.map(coin => {
                      const cfg = categoryConfig(colorToCategory(coin.color));
                      return (
                        <Badge
                          key={coin.symbol}
                          className={cn(
                            'border gap-1.5 py-1 px-3',
                            cfg.badge
                          )}
                        >
                          <Bitcoin className="w-3 h-3" />
                          {coin.symbol}
                          <span className="text-[10px] opacity-75" dir="ltr">
                            {coin.flow_score.toFixed(0)}/100 · {coin.label}
                          </span>
                        </Badge>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Filters */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">التصفية:</span>

                {/* Category Filter (نار/شرارة/رماد/بارد) */}
                <Select value={activeCategory} onValueChange={setActiveCategory}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue placeholder="الفئة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الفئات</SelectItem>
                    <SelectItem value="fire">نار (دخول قوي)</SelectItem>
                    <SelectItem value="spark">شرارة (دخول حذر)</SelectItem>
                    <SelectItem value="ash">رماد (استنى)</SelectItem>
                    <SelectItem value="cold">بارد (ماتدخلش)</SelectItem>
                  </SelectContent>
                </Select>

                {/* Action Filter */}
                <Select value={activeAction} onValueChange={setActiveAction}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue placeholder="التحليل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع القرارات</SelectItem>
                    <SelectItem value="STRONG_ENTRY">دخول قوي</SelectItem>
                    <SelectItem value="CAUTIOUS_ENTRY">دخول حذر</SelectItem>
                    <SelectItem value="WAIT">استنى</SelectItem>
                    <SelectItem value="AVOID">ماتدخلش</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 mr-auto">
                <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">الترتيب:</span>

                <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flow_score">Flow Score</SelectItem>
                    <SelectItem value="change_24h">التغير 24س</SelectItem>
                    <SelectItem value="change_7d">التغير 7 أيام</SelectItem>
                    <SelectItem value="rank">الترتيب</SelectItem>
                    <SelectItem value="volume_ratio">معدل الحجم</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSortAsc(!sortAsc)}
                >
                  {sortAsc ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* Results Count */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                عرض {filteredCoins.length} من {coins.length} عملة
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setExpandedCards(new Set(filteredCoins.map(c => c.symbol)))}
              >
                توسيع الكل
              </Button>
            </div>

            {/* Crypto Grid */}
            {filteredCoins.length === 0 ? (
              <Card className="border-border/60">
                <CardContent className="py-12 text-center">
                  <Target className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">لا توجد عملات تطابق الفلاتر المحددة</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setActiveCategory('all');
                      setActiveAction('all');
                      setSearch('');
                    }}
                  >
                    إعادة تعيين الفلاتر
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCoins.map((coin) => (
                  <RecommendationCard
                    key={coin.symbol}
                    coin={coin}
                    isExpanded={expandedCards.has(coin.symbol)}
                    onToggle={() => toggleCard(coin.symbol)}
                  />
                ))}
              </div>
            )}

            {/* Methodology Info */}
            <Card className="border-border/60 bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Info className="w-4 h-4 text-orange-500" />
                  منهجية Flow Score
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-muted-foreground">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="font-medium text-foreground">معايير التقييم:</p>
                    <ul className="space-y-1 list-disc list-inside">
                      <li>معدل حجم التداول (25%)</li>
                      <li>الزخم خلال 24س و 7 أيام (30%)</li>
                      <li>القيمة السوقية والترتيب (25%)</li>
                      <li>اتجاه السعر (20%)</li>
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <p className="font-medium text-foreground">فئات Flow Score:</p>
                    <ul className="space-y-1">
                      <li className="flex items-center gap-2">
                        <Badge className="bg-rose-100 text-rose-800 text-[10px] gap-1">
                          <Flame className="w-3 h-3" /> نار
                        </Badge>
                        <span>≥ 80 — دخول قوي</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Badge className="bg-orange-100 text-orange-800 text-[10px] gap-1">
                          <Zap className="w-3 h-3" /> شرارة
                        </Badge>
                        <span>60-79 — دخول حذر</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Badge className="bg-amber-100 text-amber-800 text-[10px] gap-1">
                          <Activity className="w-3 h-3" /> رماد
                        </Badge>
                        <span>40-59 — استنى</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Badge className="bg-sky-100 text-sky-800 text-[10px] gap-1">
                          <Snowflake className="w-3 h-3" /> بارد
                        </Badge>
                        <span>&lt; 40 — ماتدخلش</span>
                      </li>
                    </ul>
                  </div>
                </div>
                {lastUpdated && (
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 pt-2 border-t border-border/50">
                    <Clock className="w-3.5 h-3.5" />
                    <span>آخر تحديث: {lastUpdated}</span>
                    <span className="mr-auto text-[10px] text-muted-foreground">تحديث تلقائي كل 60 ثانية</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

export default CryptoRecommendationsView;
