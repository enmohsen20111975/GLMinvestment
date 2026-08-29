'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Activity, TrendingUp, TrendingDown, RefreshCw, Download, Filter,
  Zap, Target, Thermometer, Search, Flame, AlertTriangle, Crown,
  ArrowUpRight, ArrowDownRight, BarChart3, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScreenerStock {
  ticker: string;
  name: string;
  name_ar: string;
  market: string;
  sector: string;
  current_price: number;
  change_percent: number;
  volume: number;
  market_cap: number;
  pe_ratio: number | null;
  roe: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi: number | null;
  trend: string | null;
  signal: number | null;
  beta: number | null;
  high_52w: number | null;
  low_52w: number | null;
  avg_volume: number | null;
  // Existing computed
  above_ma_50: boolean;
  above_ma_200: boolean;
  distance_from_52w_high: number | null;
  distance_from_52w_low: number | null;
  momentum_score: number;
  correction_status: string;
  volume_surge: boolean;
  // New computed (Phase 2-3)
  relative_strength: number;
  stock_class: string;
  sector_change: number | null;
  sector_rank: number | null;
  market_role: string;
  state_label: string;
  state_color: string;
}

interface ScreenerResponse {
  success: boolean;
  data: ScreenerStock[];
  total: number;
  sectors: string[];
  market_avg_change?: number;
  sector_averages?: Record<string, number>;
  filters?: Record<string, unknown>;
  error?: string;
}

interface StrongestData {
  success: boolean;
  market_summary?: {
    total_stocks: number;
    advancers: number;
    decliners: number;
    unchanged: number;
    breadth: number;
    avg_change: number;
    total_volume: number;
  };
  strongest_movers?: Array<{ ticker: string; name: string; name_ar: string; sector: string; current_price: number; change_percent: string; volume: number; rsi: number | null }>;
  weakest_movers?: Array<{ ticker: string; name: string; name_ar: string; sector: string; current_price: number; change_percent: string; volume: number; rsi: number | null }>;
  most_active?: Array<{ ticker: string; name: string; name_ar: string; sector: string; current_price: number; change_percent: string; volume: number }>;
  volume_surge?: Array<{ ticker: string; name: string; name_ar: string; sector: string; current_price: number; change_percent: string; volume: number; avg_volume: number; vol_ratio: string }>;
  strongest_accumulators?: Array<{ ticker: string; name: string; name_ar: string; sector: string; current_price: number; change_percent: number; volume: number; vol_buildup_ratio: number; accumulation_score: number }>;
  strongest_breakdowns?: Array<{ ticker: string; name: string; name_ar: string; sector: string; current_price: number; change_percent: number; volume: number; vol_buildup_ratio: number; distribution_score: number }>;
  sector_heat?: Array<{ sector: string; stock_count: number; avg_change: number; advancers: number; decliners: number; breadth: number; total_volume: number; leader_ticker: string | null; leader_change: number | null; heat_level: string }>;
}

// ─── State Label Helpers (14 states) ─────────────────────────────────────────

const CORRECTION_STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  breakout:       { label: 'اختراق جديد',       color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800', icon: '🚀' },
  near_high:       { label: 'قرب القمة',          color: 'text-green-700 bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800',          icon: '🎯' },
  advancing:      { label: 'صعود قوي',          color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800', icon: '📈' },
  recovery:       { label: 'تعافي من تصحيح',    color: 'text-teal-700 bg-teal-50 border-teal-200 dark:bg-teal-950 dark:border-teal-800',               icon: '🔄' },
  consolidation:   { label: 'تجميع عرضي',        color: 'text-slate-700 bg-slate-50 border-slate-200 dark:bg-slate-900 dark:border-slate-700',          icon: '⚖️' },
  stable:          { label: 'مستقر',              color: 'text-slate-700 bg-slate-50 border-slate-200 dark:bg-slate-900 dark:border-slate-700',          icon: '➡️' },
  pulling_back:    { label: 'تصحيح بسيط',         color: 'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800',          icon: '↩️' },
  in_correction:   { label: 'في تصحيح',           color: 'text-orange-700 bg-orange-50 border-orange-200 dark:bg-orange-950 dark:border-orange-800',      icon: '📉' },
  distribution:    { label: 'توزيع (تصريف)',     color: 'text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-950 dark:border-rose-800',               icon: '🔴' },
  overbought:      { label: 'تشبع شرائي',         color: 'text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-950 dark:border-rose-800',               icon: '🔥' },
  oversold:        { label: 'تشبع بيعي',          color: 'text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800',               icon: '❄️' },
  lagging:         { label: 'متأخر عن السوق',    color: 'text-zinc-700 bg-zinc-50 border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700',               icon: '🐌' },
  dangerous:       { label: 'خطر (سقوط)',         color: 'text-red-700 bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800',                     icon: '⚠️' },
  neutral:         { label: 'محايد',              color: 'text-gray-700 bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700',                icon: '➖' },
};

function getStateBadge(stock: ScreenerStock) {
  // Prefer server-provided state_label + state_color; fallback to local map
  if (stock.state_label && stock.state_color) {
    return (
      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border', stock.state_color)}>
        {stock.state_label}
      </span>
    );
  }
  const config = CORRECTION_STATUS_MAP[stock.correction_status] || CORRECTION_STATUS_MAP.neutral;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border', config.color)}>
      <span>{config.icon}</span>
      {config.label}
    </span>
  );
}

// ─── Stock Class Badges ──────────────────────────────────────────────────────

const STOCK_CLASS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  sector_leader:       { label: 'قائد القطاع',       color: 'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800', icon: '👑' },
  sector_weak:         { label: 'ضعيف القطاع',       color: 'text-red-700 bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800',             icon: '🔻' },
  breakout_candidate:  { label: 'مرشح اختراق',      color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800', icon: '🎯' },
  correction_candidate: { label: 'مرشح تصحيح',       color: 'text-orange-700 bg-orange-50 border-orange-200 dark:bg-orange-950 dark:border-orange-800', icon: '⚠️' },
  exhausted:           { label: 'منهك',              color: 'text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-950 dark:border-rose-800',          icon: '🔥' },
  advancing:          { label: 'صاعد',              color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800', icon: '📈' },
  lagging:             { label: 'متأخر',             color: 'text-zinc-700 bg-zinc-50 border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700',            icon: '🐌' },
  stable:              { label: 'مستقر',             color: 'text-slate-700 bg-slate-50 border-slate-200 dark:bg-slate-900 dark:border-slate-700',       icon: '➡️' },
  dangerous:           { label: 'خطر',               color: 'text-red-700 bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800',                 icon: '⚠️' },
  above_sector:        { label: 'فوق القطاع',        color: 'text-green-700 bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800',      icon: '▲' },
  below_sector:        { label: 'تحت القطاع',        color: 'text-red-700 bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800',                 icon: '▼' },
  neutral:             { label: 'محايد',             color: 'text-gray-700 bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700',            icon: '➖' },
};

function getStockClassBadge(stockClass: string) {
  const config = STOCK_CLASS_MAP[stockClass] || STOCK_CLASS_MAP.neutral;
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border', config.color)}>
      <span>{config.icon}</span>
      {config.label}
    </span>
  );
}

// ─── Mini Sparkline (real price data) ────────────────────────────────────────

interface SparklineData {
  prices: number[];
  change_pct: number;
}

function MiniSparkline({ ticker }: { ticker: string }) {
  const [data, setData] = useState<SparklineData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stocks/sparkline?ticker=${encodeURIComponent(ticker)}&days=30`)
      .then(res => res.json())
      .then(json => {
        if (!cancelled && json.success && json.prices?.length > 1) {
          setData({ prices: json.prices, change_pct: json.change_pct });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) return <div className="w-20 h-8 bg-muted/30 animate-pulse rounded" />;
  if (!data) return <span className="text-xs text-muted-foreground">—</span>;

  const max = Math.max(...data.prices);
  const min = Math.min(...data.prices);
  const range = max - min || 1;
  const points = data.prices.map((p, i) => {
    const x = (i / (data.prices.length - 1)) * 80;
    const y = 20 - ((p - min) / range) * 18;
    return `${x},${y}`;
  }).join(' ');

  const isUp = data.change_pct >= 0;
  const color = isUp ? '#10b981' : '#ef4444';

  return (
    <div className="flex items-center gap-1">
      <svg width="80" height="20" className="overflow-visible">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={cn('text-xs font-mono', isUp ? 'text-emerald-600' : 'text-red-600')}>
        {isUp ? '+' : ''}{data.change_pct.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Format Helpers ──────────────────────────────────────────────────────────

function formatNumber(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || isNaN(n as number)) return '—';
  return (n as number).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function getChangeColor(change: number): string {
  if (change > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (change < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

// ─── Strongest Movers Panel (top movers + accumulators + breakdowns) ────────

function StrongestMoversPanel({ market }: { market: string }) {
  const [data, setData] = useState<StrongestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'movers' | 'active' | 'accumulators' | 'breakdowns'>('movers');

  const fetchStrongest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stocks/strongest?market=${encodeURIComponent(market)}&top=5`);
      const json: StrongestData = await res.json();
      if (json.success) setData(json);
    } catch (e) {
      console.error('[StrongestMoversPanel]', e);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    fetchStrongest();
  }, [fetchStrongest]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">جاري تحميل الأقوى...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const tabs = [
    { id: 'movers' as const,      label: 'أقوى/أضعف',       icon: TrendingUp },
    { id: 'active' as const,      label: 'الأكثر نشاطاً',    icon: BarChart3 },
    { id: 'accumulators' as const, label: 'تجميع هادئ',      icon: Layers },
    { id: 'breakdowns' as const,  label: 'توزيع/تصريف',     icon: AlertTriangle },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          لوحة الأقوى والأضعف — {market}
          <Badge variant="outline" className="text-xs">
            {data.market_summary?.total_stocks || 0} سهم
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {/* Tabs */}
        <div className="flex gap-1 mb-3 flex-wrap">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors',
                  tab === t.id
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-800'
                    : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50'
                )}
              >
                <Icon className="w-3 h-3" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tab === 'movers' && (
            <>
              <div>
                <div className="text-xs font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> أقوى الصاعدات
                </div>
                <div className="space-y-1">
                  {(data.strongest_movers || []).map((s, i) => (
                    <div key={s.ticker} className="flex items-center justify-between text-xs py-1 border-b border-muted/30 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground font-mono">{i + 1}.</span>
                        <span className="font-mono font-bold">{s.ticker}</span>
                        <span className="text-muted-foreground truncate max-w-[100px]">{s.name_ar || s.name}</span>
                      </div>
                      <span className="text-emerald-600 font-mono font-semibold">+{s.change_percent}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-red-700 mb-1.5 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> أقوى الهابطات
                </div>
                <div className="space-y-1">
                  {(data.weakest_movers || []).map((s, i) => (
                    <div key={s.ticker} className="flex items-center justify-between text-xs py-1 border-b border-muted/30 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground font-mono">{i + 1}.</span>
                        <span className="font-mono font-bold">{s.ticker}</span>
                        <span className="text-muted-foreground truncate max-w-[100px]">{s.name_ar || s.name}</span>
                      </div>
                      <span className="text-red-600 font-mono font-semibold">{s.change_percent}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'active' && (
            <div className="sm:col-span-2">
              <div className="text-xs font-semibold text-blue-700 mb-1.5 flex items-center gap-1">
                <BarChart3 className="w-3 h-3" /> الأكثر نشاطاً (أعلى حجم)
              </div>
              <div className="space-y-1">
                {(data.most_active || []).map((s, i) => (
                  <div key={s.ticker} className="flex items-center justify-between text-xs py-1 border-b border-muted/30 last:border-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground font-mono">{i + 1}.</span>
                      <span className="font-mono font-bold">{s.ticker}</span>
                      <span className="text-muted-foreground truncate max-w-[120px]">{s.name_ar || s.name}</span>
                      <span className="text-muted-foreground">{s.sector}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('font-mono', s.change_percent.startsWith('-') ? 'text-red-600' : 'text-emerald-600')}>
                        {s.change_percent.startsWith('-') ? '' : '+'}{s.change_percent}%
                      </span>
                      <span className="text-muted-foreground font-mono">{formatVolume(s.volume)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'accumulators' && (
            <div className="sm:col-span-2">
              <div className="text-xs font-semibold text-teal-700 mb-1.5 flex items-center gap-1">
                <Layers className="w-3 h-3" /> تجميع هادئ (vol buildup ≥ 1.25× + صعود)
              </div>
              {(data.strongest_accumulators || []).length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">لا يوجد تجميع هادئ اليوم</div>
              ) : (
                <div className="space-y-1">
                  {(data.strongest_accumulators || []).map((s, i) => (
                    <div key={s.ticker} className="flex items-center justify-between text-xs py-1 border-b border-muted/30 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground font-mono">{i + 1}.</span>
                        <span className="font-mono font-bold">{s.ticker}</span>
                        <span className="text-muted-foreground truncate max-w-[100px]">{s.name_ar || s.name}</span>
                        <span className="text-muted-foreground">{s.sector}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs px-1.5 text-teal-700 border-teal-300">
                          buildup {s.vol_buildup_ratio}×
                        </Badge>
                        <span className="text-emerald-600 font-mono font-semibold">+{s.change_percent}%</span>
                        <span className="text-muted-foreground font-mono text-xs">score {s.accumulation_score}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'breakdowns' && (
            <div className="sm:col-span-2">
              <div className="text-xs font-semibold text-rose-700 mb-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> توزيع/تصريف (vol surge + هبوط)
              </div>
              {(data.strongest_breakdowns || []).length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">لا يوجد توزيع اليوم</div>
              ) : (
                <div className="space-y-1">
                  {(data.strongest_breakdowns || []).map((s, i) => (
                    <div key={s.ticker} className="flex items-center justify-between text-xs py-1 border-b border-muted/30 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground font-mono">{i + 1}.</span>
                        <span className="font-mono font-bold">{s.ticker}</span>
                        <span className="text-muted-foreground truncate max-w-[100px]">{s.name_ar || s.name}</span>
                        <span className="text-muted-foreground">{s.sector}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs px-1.5 text-rose-700 border-rose-300">
                          surge {s.vol_buildup_ratio}×
                        </Badge>
                        <span className="text-red-600 font-mono font-semibold">{s.change_percent}%</span>
                        <span className="text-muted-foreground font-mono text-xs">score {s.distribution_score}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Sector Heat Panel ───────────────────────────────────────────────────────

const HEAT_LEVEL_MAP: Record<string, { label: string; color: string; icon: string }> = {
  hot:     { label: 'ساخن',    color: 'text-red-700 bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800',       icon: '🔥' },
  warm:    { label: 'دافئ',    color: 'text-orange-700 bg-orange-50 border-orange-200 dark:bg-orange-950 dark:border-orange-800', icon: '☀️' },
  neutral: { label: 'محايد',   color: 'text-slate-700 bg-slate-50 border-slate-200 dark:bg-slate-900 dark:border-slate-700',      icon: '➖' },
  cool:    { label: 'بارد',    color: 'text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800',         icon: '❄️' },
  cold:    { label: 'بارد جداً', color: 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:bg-indigo-950 dark:border-indigo-800', icon: '🥶' },
};

function SectorHeatPanel({ market, onSelectSector }: { market: string; onSelectSector?: (sector: string) => void }) {
  const [data, setData] = useState<StrongestData['sector_heat']>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stocks/strongest?market=${encodeURIComponent(market)}&top=1`)
      .then(res => res.json())
      .then(json => {
        if (!cancelled && json.success && json.sector_heat) {
          setData(json.sector_heat);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [market]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">جاري تحميل حرارة القطاعات...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Thermometer className="w-4 h-4 text-rose-500" />
          حرارة القطاعات — {market}
          <Badge variant="outline" className="text-xs">{data.length} قطاع</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {data.slice(0, 12).map(s => {
            const heat = HEAT_LEVEL_MAP[s.heat_level] || HEAT_LEVEL_MAP.neutral;
            return (
              <button
                key={s.sector}
                onClick={() => onSelectSector?.(s.sector)}
                className={cn(
                  'flex flex-col gap-0.5 p-2 rounded border text-right transition-all hover:scale-[1.02] hover:shadow-sm',
                  heat.color
                )}
                title={`انقر لفلترة Screener بقطاع ${s.sector}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold truncate">{s.sector}</span>
                  <span className="text-sm">{heat.icon}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={cn('font-mono text-sm font-bold', s.avg_change >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                    {s.avg_change >= 0 ? '+' : ''}{s.avg_change}%
                  </span>
                  <span className="text-xs opacity-70">{s.stock_count} سهم</span>
                </div>
                <div className="flex items-center justify-between text-xs opacity-80">
                  <span>صاعد {s.advancers} / هابط {s.decliners}</span>
                  {s.leader_ticker && (
                    <span className="font-mono font-semibold">
                      {s.leader_ticker} ({s.leader_change && s.leader_change >= 0 ? '+' : ''}{s.leader_change}%)
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function StockScreener() {
  // Filters state
  const [market, setMarket] = useState('EGX');
  const [sector, setSector] = useState('ALL');
  const [sort, setSort] = useState('change_percent');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [limit, setLimit] = useState(100);
  const [trend, setTrend] = useState('all');
  const [aboveMa, setAboveMa] = useState('all');
  const [correctionStatus, setCorrectionStatus] = useState('all');
  const [stockClass, setStockClass] = useState('all');
  const [volumeSurgeOnly, setVolumeSurgeOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Data state
  const [stocks, setStocks] = useState<ScreenerStock[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [marketAvgChange, setMarketAvgChange] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch screener data
  const fetchScreener = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        market,
        sort,
        order,
        limit: String(limit),
      });
      if (sector !== 'ALL') params.set('sector', sector);
      if (trend !== 'all') params.set('trend', trend);
      if (aboveMa !== 'all') params.set('above_ma', aboveMa);
      if (correctionStatus !== 'all') params.set('correction_status', correctionStatus);
      if (stockClass !== 'all') params.set('stock_class', stockClass);
      if (volumeSurgeOnly) params.set('volume_surge_only', '1');

      const res = await fetch(`/api/stocks/screener?${params}`);
      const json: ScreenerResponse = await res.json();

      if (json.success) {
        setStocks(json.data);
        setSectors(json.sectors || []);
        setMarketAvgChange(json.market_avg_change ?? null);
      } else {
        setError(json.error || 'فشل تحميل البيانات');
        toast.error(json.error || 'فشل تحميل البيانات');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطأ في الاتصال';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [market, sector, sort, order, limit, trend, aboveMa, correctionStatus, stockClass, volumeSurgeOnly]);

  useEffect(() => {
    fetchScreener();
  }, [fetchScreener]);

  // Client-side search filter
  const filteredStocks = useMemo(() => {
    if (!searchQuery.trim()) return stocks;
    const q = searchQuery.toUpperCase();
    return stocks.filter(s =>
      s.ticker.includes(q) ||
      s.name.toUpperCase().includes(q) ||
      s.name_ar.includes(searchQuery)
    );
  }, [stocks, searchQuery]);

  // Export to CSV
  const exportCSV = () => {
    const headers = ['Ticker', 'Name', 'Sector', 'Price', 'Change%', 'Volume', 'RSI', 'Momentum', 'RS', 'StockClass', 'State', 'SectorRank', 'DistFromHigh'];
    const rows = filteredStocks.map(s => [
      s.ticker, s.name, s.sector,
      s.current_price, s.change_percent, s.volume,
      s.rsi ?? '', s.momentum_score, s.relative_strength,
      s.stock_class, s.state_label || s.correction_status,
      s.sector_rank ?? '', s.distance_from_52w_high ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screener_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`تم تصدير ${filteredStocks.length} سهم`);
  };

  const handleSelectSector = (newSector: string) => {
    setSector(newSector);
    setStockClass('all');
    setCorrectionStatus('all');
  };

  return (
    <div className="space-y-4 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-600" />
            ماسح الأسهم المتقدم
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            فرز الأسهم بفلاتر متقدمة — تصحيح، زخم، تشبع، مقارنة بالقطاع، قوة نسبية
            {marketAvgChange !== null && (
              <span className="ml-2 text-xs">
                • متوسط السوق: <span className={marketAvgChange >= 0 ? 'text-emerald-600 font-mono' : 'text-red-600 font-mono'}>
                  {marketAvgChange >= 0 ? '+' : ''}{marketAvgChange}%
                </span>
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filteredStocks.length} className="gap-1.5">
            <Download className="w-3.5 h-3.5" />
            تصدير CSV
          </Button>
          <Button variant="outline" size="sm" onClick={fetchScreener} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            تحديث
          </Button>
        </div>
      </div>

      {/* Strongest Movers + Sector Heat Panels (NEW) */}
      <StrongestMoversPanel market={market} />
      <SectorHeatPanel market={market} onSelectSector={handleSelectSector} />

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" />
            الفلاتر
            {(stockClass !== 'all' || correctionStatus !== 'all' || volumeSurgeOnly) && (
              <Badge variant="secondary" className="text-xs">نشط</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {/* Market */}
            <div>
              <Label className="text-xs">السوق</Label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EGX">البورصة المصرية</SelectItem>
                  <SelectItem value="ALL">الكل</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sector */}
            <div>
              <Label className="text-xs">القطاع</Label>
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">كل القطاعات</SelectItem>
                  {sectors.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sort */}
            <div>
              <Label className="text-xs">ترتيب بـ</Label>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="change_percent">نسبة التغير</SelectItem>
                  <SelectItem value="volume">الحجم</SelectItem>
                  <SelectItem value="momentum">الزخم</SelectItem>
                  <SelectItem value="relative_strength">القوة النسبية</SelectItem>
                  <SelectItem value="sector_rank">ترتيب القطاع</SelectItem>
                  <SelectItem value="rsi">RSI</SelectItem>
                  <SelectItem value="market_cap">القيمة السوقية</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Order */}
            <div>
              <Label className="text-xs">الاتجاه</Label>
              <Select value={order} onValueChange={(v) => setOrder(v as 'asc' | 'desc')}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">تنازلي (الأعلى أولاً)</SelectItem>
                  <SelectItem value="asc">تصاعدي (الأقل أولاً)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Trend */}
            <div>
              <Label className="text-xs">الاتجاه</Label>
              <Select value={trend} onValueChange={setTrend}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="up">صاعد فقط</SelectItem>
                  <SelectItem value="down">هابط فقط</SelectItem>
                  <SelectItem value="neutral">مستقر</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Above MA */}
            <div>
              <Label className="text-xs">فوق المتوسط</Label>
              <Select value={aboveMa} onValueChange={setAboveMa}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="50">فوق MA50</SelectItem>
                  <SelectItem value="200">فوق MA200</SelectItem>
                  <SelectItem value="both">فوق الاثنين</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Correction Status (14 states) */}
            <div>
              <Label className="text-xs">حالة السهم</Label>
              <Select value={correctionStatus} onValueChange={setCorrectionStatus}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="breakout">🚀 اختراق جديد</SelectItem>
                  <SelectItem value="near_high">🎯 قرب القمة</SelectItem>
                  <SelectItem value="advancing">📈 صعود قوي</SelectItem>
                  <SelectItem value="recovery">🔄 تعافي من تصحيح</SelectItem>
                  <SelectItem value="consolidation">⚖️ تجميع عرضي</SelectItem>
                  <SelectItem value="stable">➡️ مستقر</SelectItem>
                  <SelectItem value="pulling_back">↩️ تصحيح بسيط</SelectItem>
                  <SelectItem value="in_correction">📉 في تصحيح</SelectItem>
                  <SelectItem value="distribution">🔴 توزيع (تصريف)</SelectItem>
                  <SelectItem value="overbought">🔥 تشبع شرائي</SelectItem>
                  <SelectItem value="oversold">❄️ تشبع بيعي</SelectItem>
                  <SelectItem value="lagging">🐌 متأخر عن السوق</SelectItem>
                  <SelectItem value="dangerous">⚠️ خطر (سقوط)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Stock Class (12 categories) */}
            <div>
              <Label className="text-xs">تصنيف السهم</Label>
              <Select value={stockClass} onValueChange={setStockClass}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="sector_leader">👑 قائد القطاع</SelectItem>
                  <SelectItem value="breakout_candidate">🎯 مرشح اختراق</SelectItem>
                  <SelectItem value="advancing">📈 صاعد</SelectItem>
                  <SelectItem value="above_sector">▲ فوق القطاع</SelectItem>
                  <SelectItem value="correction_candidate">⚠️ مرشح تصحيح</SelectItem>
                  <SelectItem value="exhausted">🔥 منهك</SelectItem>
                  <SelectItem value="lagging">🐌 متأخر</SelectItem>
                  <SelectItem value="below_sector">▼ تحت القطاع</SelectItem>
                  <SelectItem value="sector_weak">🔻 ضعيف القطاع</SelectItem>
                  <SelectItem value="stable">➡️ مستقر</SelectItem>
                  <SelectItem value="dangerous">⚠️ خطر</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Limit */}
            <div>
              <Label className="text-xs">عدد النتائج</Label>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Search + Volume Surge toggle */}
          <div className="mt-3 flex gap-3 items-center">
            <div className="relative flex-1">
              <Search className="absolute right-2 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو الرمز..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-8 h-9"
              />
            </div>
            <button
              onClick={() => setVolumeSurgeOnly(v => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-medium transition-colors whitespace-nowrap',
                volumeSurgeOnly
                  ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950 dark:border-amber-800'
                  : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50'
              )}
              title="فلترة الأسهم بانفجار سيولة (vol > 1.5× avg)"
            >
              <Zap className="w-3.5 h-3.5" />
              انفجار سيولة فقط
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">إجمالي النتائج</div>
            <div className="text-xl font-bold">{filteredStocks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">صاعدة</div>
            <div className="text-xl font-bold text-emerald-600">
              {filteredStocks.filter(s => s.change_percent > 0).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">هابطة</div>
            <div className="text-xl font-bold text-red-600">
              {filteredStocks.filter(s => s.change_percent < 0).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">انفجار سيولة</div>
            <div className="text-xl font-bold text-amber-600">
              {filteredStocks.filter(s => s.volume_surge).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Crown className="w-3 h-3 text-amber-500" />
              قادة القطاعات
            </div>
            <div className="text-xl font-bold text-amber-600">
              {filteredStocks.filter(s => s.stock_class === 'sector_leader').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Target className="w-3 h-3 text-emerald-500" />
              مرشحو اختراق
            </div>
            <div className="text-xl font-bold text-emerald-600">
              {filteredStocks.filter(s => s.stock_class === 'breakout_candidate').length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              جاري التحميل...
            </div>
          ) : error ? (
            <div className="p-8 text-center text-red-600">
              <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
              {error}
            </div>
          ) : filteredStocks.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
              لا توجد نتائج مطابقة
            </div>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-right">السهم</TableHead>
                    <TableHead className="text-right">السعر</TableHead>
                    <TableHead className="text-right">التغير</TableHead>
                    <TableHead className="text-right">الرسم (30 يوم)</TableHead>
                    <TableHead className="text-right">الحجم</TableHead>
                    <TableHead className="text-right">القوة النسبية</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">التصنيف</TableHead>
                    <TableHead className="text-right">الزخم</TableHead>
                    <TableHead className="text-right">ترتيب القطاع</TableHead>
                    <TableHead className="text-right">من القمة</TableHead>
                    <TableHead className="text-right">المتوسطات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStocks.map((s) => (
                    <TableRow key={s.ticker} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="font-mono font-bold text-sm">{s.ticker}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                          {s.name_ar || s.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.sector}</div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {formatNumber(s.current_price)}
                      </TableCell>
                      <TableCell className={cn('font-mono text-sm font-medium', getChangeColor(s.change_percent))}>
                        {s.change_percent > 0 ? '+' : ''}{formatNumber(s.change_percent)}%
                      </TableCell>
                      <TableCell>
                        <MiniSparkline ticker={s.ticker} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatVolume(s.volume)}
                        {s.volume_surge && <Zap className="inline w-3 h-3 text-amber-500 mr-1" />}
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          'font-mono text-xs font-bold',
                          s.relative_strength > 1 ? 'text-emerald-600' :
                          s.relative_strength < -1 ? 'text-red-600' : 'text-muted-foreground'
                        )}>
                          {s.relative_strength > 0 ? '+' : ''}{formatNumber(s.relative_strength)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        {getStateBadge(s)}
                      </TableCell>
                      <TableCell>
                        {getStockClassBadge(s.stock_class)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className={cn(
                            'font-mono text-xs font-bold',
                            s.momentum_score > 5 ? 'text-emerald-600' :
                            s.momentum_score < 0 ? 'text-red-600' : 'text-muted-foreground'
                          )}>
                            {s.momentum_score > 0 ? '+' : ''}{formatNumber(s.momentum_score, 1)}
                          </span>
                          {s.momentum_score > 5 && <TrendingUp className="w-3 h-3 text-emerald-500" />}
                          {s.momentum_score < 0 && <TrendingDown className="w-3 h-3 text-red-500" />}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {s.sector_rank !== null ? (
                          <span className={cn(
                            'px-1.5 py-0.5 rounded font-bold',
                            s.sector_rank === 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950' :
                            s.sector_rank <= 3 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950' :
                            'text-muted-foreground'
                          )}>
                            #{s.sector_rank}
                          </span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s.distance_from_52w_high !== null
                          ? `${formatNumber(s.distance_from_52w_high, 1)}%`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Badge variant={s.above_ma_50 ? 'default' : 'outline'} className="text-xs px-1.5">
                            50
                          </Badge>
                          <Badge variant={s.above_ma_200 ? 'default' : 'outline'} className="text-xs px-1.5">
                            200
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
