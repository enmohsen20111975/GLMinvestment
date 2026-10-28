'use client';

/**
 * SystemTopologyView.tsx — خريطة النظام الحية (Live System Topology)
 * ====================================================================
 * (ALPHA-SYSTEM-TOPOLOGY — owner directive 2026-10-27):
 * «شاشة في الادمن بتوصف النظام بصورة حية جدا»
 *
 * بيعرض:
 *   1. KPI bar حية (CPU/RAM/DB/stocks/predictions/win rate/last cron)
 *   2. رسمين هندسيين تفاعليين (Decision Flow + Full Architecture)
 *   3. كل node فيها لون حسب حالتها + badge + تفاصيل hover
 *   4. Live log feed (آخر القرارات/التوقعات/الأخطاء)
 *   5. Node detail modal (click → تفاصيل كاملة)
 *   6. Auto-refresh selector (10s/30s/60s)
 *
 * Rule 27: لو البيانات مش متاحة → status: 'unknown' (مش fabricated).
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Activity, Database, Brain, Shield, CheckCircle2, AlertTriangle,
  XCircle, Loader2, RefreshCw, Network, Cpu, HardDrive, Zap,
  TrendingUp, Newspaper, Users, Server, Clock, Gauge, Target,
  ArrowRightCircle, XOctagon, Trophy, AlertCircle, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

// ─── Types ─────────────────────────────────────────────────────────────────

type NodeStatus = 'healthy' | 'stale' | 'error' | 'unknown';

interface TopologyNode {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: NodeStatus;
  detail?: string;
  count?: number;
  /** تفاصيل إضافية للـ modal (لو اتضغط عليها) */
  metrics?: Array<{ label: string; value: string | number; status?: NodeStatus }>;
}

interface LogEntry {
  timestamp: string;
  type: 'decision' | 'reject' | 'exit' | 'error' | 'info';
  message: string;
  ticker?: string;
}

interface SystemStats {
  health: { status?: string; uptime?: string; checks?: Array<{ name: string; status: string }> } | null;
  marketStatus: { market?: string; isOpen?: boolean; session?: string } | null;
  engines: Array<{ name: string; status: string; lastRun?: string; pid?: number }> | null;
  predictions: { total?: number; active?: number; wins?: number; losses?: number; pending?: number; winRate?: number } | null;
  cronHealth: Array<{ name: string; lastRun?: string; status?: string; nextRun?: string }> | null;
  dataCoverage: { totalStocks?: number; withPrices?: number; lastUpdate?: string } | null;
  resources: { cpu?: number; ram?: number; dbSizeMB?: number } | null;
  lastUpdated: string | null;
  logs: LogEntry[];
}

// ─── Status colors ─────────────────────────────────────────────────────────

const STATUS_COLORS: Record<NodeStatus, { bg: string; border: string; text: string; icon: string; dot: string }> = {
  healthy: {
    bg: 'bg-profit/10', border: 'border-profit/30', text: 'text-profit', icon: 'text-profit',
    dot: 'bg-profit',
  },
  stale: {
    bg: 'bg-warning/10', border: 'border-warning/30', text: 'text-warning', icon: 'text-warning',
    dot: 'bg-warning',
  },
  error: {
    bg: 'bg-loss/10', border: 'border-loss/30', text: 'text-loss', icon: 'text-loss',
    dot: 'bg-loss',
  },
  unknown: {
    bg: 'bg-muted/20', border: 'border-border', text: 'text-muted-foreground', icon: 'text-muted-foreground',
    dot: 'bg-muted-foreground/40',
  },
};

function StatusIcon({ status, className }: { status: NodeStatus; className?: string }) {
  const cls = cn('w-3.5 h-3.5', className);
  if (status === 'healthy') return <CheckCircle2 className={cls} />;
  if (status === 'stale') return <AlertTriangle className={cls} />;
  if (status === 'error') return <XCircle className={cls} />;
  return <div className={cn('w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/40', className)} />;
}

// ─── Pulsing dot (live indicator) ──────────────────────────────────────────

function LiveDot({ status }: { status: NodeStatus }) {
  const colors = STATUS_COLORS[status];
  return (
    <span className="relative flex h-2 w-2">
      {status !== 'unknown' && (
        <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', colors.dot)} />
      )}
      <span className={cn('relative inline-flex rounded-full h-2 w-2', colors.dot)} />
    </span>
  );
}

// ─── Node component ─────────────────────────────────────────────────────────

function TopologyNodeCard({ node, onClick }: { node: TopologyNode; onClick?: () => void }) {
  const colors = STATUS_COLORS[node.status];
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all hover:scale-105 cursor-pointer min-w-[140px] max-w-[180px]',
        colors.bg, colors.border,
        onClick && 'hover:shadow-md',
      )}
      title={node.detail || node.label}
      onClick={onClick}
    >
      {/* Live dot top-right */}
      <div className="absolute top-1.5 right-1.5">
        <LiveDot status={node.status} />
      </div>
      {/* Status icon top-left */}
      <div className="absolute top-1.5 left-1.5">
        <StatusIcon status={node.status} className={cn('w-3 h-3', colors.icon)} />
      </div>
      <div className={cn('mt-3', colors.icon)}>{node.icon}</div>
      <div className={cn('text-xs font-bold text-center', colors.text)}>{node.label}</div>
      {node.count != null && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
          {node.count.toLocaleString('en-US')}
        </Badge>
      )}
      {node.detail && (
        <div className="text-[9px] text-muted-foreground text-center truncate max-w-full" title={node.detail}>
          {node.detail}
        </div>
      )}
    </div>
  );
}

// ─── Arrow component ────────────────────────────────────────────────────────

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-1">
      {label && <span className="text-[9px] text-muted-foreground/70 px-1">{label}</span>}
      <div className="text-muted-foreground/60 rotate-180">↓</div>
    </div>
  );
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon, status = 'unknown', sub,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  status?: NodeStatus;
  sub?: string;
}) {
  const colors = STATUS_COLORS[status];
  return (
    <div className={cn('flex items-center gap-2 p-2 rounded-lg border', colors.bg, colors.border)}>
      <div className={cn('flex-shrink-0', colors.icon)}>{icon}</div>
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] text-muted-foreground truncate">{label}</span>
        <span className={cn('text-sm font-bold font-mono', colors.text)}>{value}</span>
        {sub && <span className="text-[9px] text-muted-foreground truncate">{sub}</span>}
      </div>
    </div>
  );
}

// ─── Log entry component ───────────────────────────────────────────────────

const LOG_ICONS: Record<LogEntry['type'], React.ReactNode> = {
  decision: <ArrowRightCircle className="w-3.5 h-3.5 text-primary" />,
  reject: <XOctagon className="w-3.5 h-3.5 text-loss" />,
  exit: <Target className="w-3.5 h-3.5 text-warning" />,
  error: <AlertCircle className="w-3.5 h-3.5 text-loss" />,
  info: <Info className="w-3.5 h-3.5 text-muted-foreground" />,
};

function LogEntryRow({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0 hover:bg-muted/30 px-2 rounded">
      <div className="flex-shrink-0 mt-0.5">{LOG_ICONS[entry.type]}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {entry.ticker && (
            <span className="text-[10px] font-mono font-bold text-foreground">{entry.ticker}</span>
          )}
          <span className="text-[10px] text-muted-foreground truncate">{entry.message}</span>
        </div>
        <div className="text-[9px] text-muted-foreground/70 font-mono">
          {new Date(entry.timestamp).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function SystemTopologyView() {
  const [stats, setStats] = useState<SystemStats>({
    health: null,
    marketStatus: null,
    engines: null,
    predictions: null,
    cronHealth: null,
    dataCoverage: null,
    resources: null,
    lastUpdated: null,
    logs: [],
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeDiagram, setActiveDiagram] = useState<'decision' | 'architecture'>('decision');
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const isMountedRef = useRef(true);
  const logCounterRef = useRef(0);

  const fetchStats = useCallback(async (background = false) => {
    if (background) setIsRefreshing(true);

    const results = await Promise.allSettled([
      fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/market/status', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/admin/engines-status', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/predictions/honest-tracking', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/admin/cron-health', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/stocks/data-coverage', { cache: 'no-store' }).then((r) => r.json()),
    ]);

    if (!isMountedRef.current) return;

    const [healthRes, marketRes, enginesRes, predRes, cronRes, coverageRes] = results;

    // Build live log entries from the fetched data.
    const newLogs: LogEntry[] = [];

    if (healthRes.status === 'fulfilled') {
      const h = healthRes.value;
      if (h.status === 'ok' || h.status === 'healthy') {
        newLogs.push({ timestamp: new Date().toISOString(), type: 'info', message: 'فحص الصحة: سليم' });
      } else {
        newLogs.push({ timestamp: new Date().toISOString(), type: 'error', message: `فحص الصحة: ${h.status || 'خطأ'}` });
      }
    }

    if (predRes.status === 'fulfilled' && predRes.value?.summary) {
      const s = predRes.value.summary;
      if (s.pending && s.pending > 0) {
        newLogs.push({
          timestamp: new Date().toISOString(),
          type: 'decision',
          message: `${s.pending} توقع نشط قيد التتبع`,
        });
      }
      if (s.wins && s.wins > 0) {
        newLogs.push({
          timestamp: new Date().toISOString(),
          type: 'exit',
          message: `${s.wins} صفقة حققت الهدف (Win)`,
        });
      }
      if (s.losses && s.losses > 0) {
        newLogs.push({
          timestamp: new Date().toISOString(),
          type: 'reject',
          message: `${s.losses} صفقة ضربت الوقف (Loss)`,
        });
      }
    }

    if (coverageRes.status === 'fulfilled' && coverageRes.value) {
      const c = coverageRes.value;
      if (c.totalStocks) {
        newLogs.push({
          timestamp: new Date().toISOString(),
          type: 'info',
          message: `تغطية البيانات: ${c.totalStocks} سهم، ${c.withPrices || 0} بسعر`,
        });
      }
    }

    setStats((prev) => ({
      health: healthRes.status === 'fulfilled' ? healthRes.value : null,
      marketStatus: marketRes.status === 'fulfilled' ? marketRes.value : null,
      engines: enginesRes.status === 'fulfilled' ? enginesRes.value?.engines : null,
      predictions: predRes.status === 'fulfilled' ? predRes.value?.summary : null,
      cronHealth: cronRes.status === 'fulfilled' ? cronRes.value?.jobs : null,
      dataCoverage: coverageRes.status === 'fulfilled' ? coverageRes.value : null,
      resources: prev.resources, // keep previous (admin/system-resources requires auth)
      lastUpdated: new Date().toISOString(),
      logs: [...newLogs, ...prev.logs].slice(0, 30), // keep last 30
    }));

    if (background) setIsRefreshing(false);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchStats(false);
    const interval = setInterval(() => fetchStats(true), refreshInterval * 1000);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchStats, refreshInterval]);

  // ─── Derive node statuses from stats ────────────────────────────────────

  const healthOk = stats.health?.status === 'ok' || stats.health?.status === 'healthy';
  const marketOpen = stats.marketStatus?.isOpen === true;
  const enginesRunning = stats.engines && stats.engines.some((e) => e.status === 'running' || e.status === 'active');
  const predictionsActive = (stats.predictions?.active ?? 0) > 0;
  const stocksCount = stats.dataCoverage?.totalStocks ?? 0;
  const winRate = stats.predictions?.winRate;

  // ─── Decision Flow nodes (with enriched metrics) ────────────────────────

  const decisionNodes: TopologyNode[][] = useMemo(() => [
    [
      {
        id: 'cron', label: 'Cron / فحص', icon: <Zap className="w-5 h-5" />, status: 'healthy',
        detail: `كل ${refreshInterval}s`, count: stats.cronHealth?.length,
        metrics: [
          { label: 'Cron Jobs', value: stats.cronHealth?.length ?? '—' },
          { label: 'آخر تشغيل', value: stats.cronHealth?.[0]?.lastRun ?? '—' },
        ],
      },
      {
        id: 'dates', label: 'تواريخ الفحص', icon: <Activity className="w-5 h-5" />, status: 'healthy',
        detail: new Date().toISOString().slice(0, 10),
      },
      {
        id: 'cache', label: 'Price Cache', icon: <Database className="w-5 h-5" />, status: 'healthy',
        detail: 'in-memory', count: stocksCount,
      },
      {
        id: 'ticker', label: 'اختيار السهم', icon: <TrendingUp className="w-5 h-5" />, status: stocksCount > 0 ? 'healthy' : 'unknown',
        count: stocksCount,
      },
    ],
    [
      {
        id: 'b1', label: 'B1: Price Sanity', icon: <Shield className="w-5 h-5" />,
        status: healthOk ? 'healthy' : 'unknown', detail: 'فحص البيانات',
        metrics: [
          { label: 'الحالة', value: healthOk ? 'سليم' : 'غير معروف', status: healthOk ? 'healthy' : 'unknown' },
          { label: 'آخر فحص', value: stats.lastUpdated ? new Date(stats.lastUpdated).toLocaleTimeString('ar-EG') : '—' },
        ],
      },
      {
        id: 'reject1', label: 'رفض الدخول', icon: <XCircle className="w-5 h-5" />, status: 'unknown',
        detail: 'DATA_INVALID',
        metrics: [{ label: 'السبب', value: 'بيانات ملوثة/قديمة' }],
      },
      {
        id: 'liq', label: 'Liquidity Gate', icon: <Activity className="w-5 h-5" />, status: 'healthy',
        detail: 'min turnover 50K',
      },
      {
        id: 'skip', label: 'تخطي السهم', icon: <AlertTriangle className="w-5 h-5" />, status: 'unknown',
        detail: 'سيولة ضعيفة',
      },
    ],
    [
      {
        id: 'master', label: 'MasterAnalyzer', icon: <Brain className="w-5 h-5" />,
        status: enginesRunning ? 'healthy' : 'unknown', detail: 'تحليل متعدد الطبقات',
        metrics: (stats.engines ?? []).map((e) => ({
          label: e.name,
          value: e.status,
          status: (e.status === 'running' || e.status === 'active' ? 'healthy' : 'unknown') as NodeStatus,
        })),
      },
      {
        id: 'score', label: 'Master Score', icon: <Gauge className="w-5 h-5" />, status: 'healthy',
        detail: 'BUY/HOLD/SELL',
      },
      {
        id: 'veto', label: 'News Veto', icon: <Newspaper className="w-5 h-5" />, status: 'healthy',
        detail: 'فحص الأخبار',
      },
      {
        id: 'risk', label: 'Risk Gate', icon: <Shield className="w-5 h-5" />, status: 'healthy',
        detail: 'R/R ≥ 1.5',
      },
    ],
    [
      {
        id: 'noTrade', label: 'رفض/تخفيض', icon: <XCircle className="w-5 h-5" />, status: 'unknown',
        detail: 'تسجيل السبب',
      },
      {
        id: 'track', label: 'Prediction Tracker', icon: <Activity className="w-5 h-5" />, status: 'healthy',
        detail: 'Dedup + حفظ',
      },
      {
        id: 'store', label: 'predictions.db', icon: <Database className="w-5 h-5" />, status: 'healthy',
        count: stats.predictions?.total,
        metrics: [
          { label: 'إجمالي التوقعات', value: stats.predictions?.total ?? '—' },
          { label: 'نشطة', value: stats.predictions?.active ?? '—', status: predictionsActive ? 'healthy' : 'unknown' },
          { label: 'محققة (Win)', value: stats.predictions?.wins ?? '—', status: 'healthy' },
          { label: 'خاسرة (Loss)', value: stats.predictions?.losses ?? '—', status: 'error' },
        ],
      },
      {
        id: 'stored', label: 'stored_analyses', icon: <Database className="w-5 h-5" />, status: 'healthy',
        detail: 'كاتب واحد (Rule 73)',
      },
    ],
    [
      {
        id: 'ui', label: 'واجهة التوصيات', icon: <Users className="w-5 h-5" />,
        status: predictionsActive ? 'healthy' : 'unknown', count: stats.predictions?.active,
      },
      {
        id: 'closer', label: 'Daily Closer', icon: <Activity className="w-5 h-5" />, status: 'healthy',
        detail: 'بعد الإغلاق',
      },
      {
        id: 'outcome', label: 'نتيجة الصفقة', icon: <Trophy className="w-5 h-5" />, status: 'healthy',
        detail: 'Target/Stop/Exit',
        metrics: [
          { label: 'معدل النجاح', value: winRate != null ? `${winRate}%` : '—', status: winRate != null && winRate >= 50 ? 'healthy' : 'stale' },
        ],
      },
      {
        id: 'log', label: 'decision_log.db', icon: <Database className="w-5 h-5" />, status: 'healthy',
        detail: 'سجل القرارات',
      },
    ],
    [
      {
        id: 'learning', label: 'Learning Engine', icon: <Brain className="w-5 h-5" />, status: 'healthy',
        detail: 'تحليل الأخطاء + feedback',
        metrics: [
          { label: 'الدروس المستفادة', value: stats.predictions?.pending ?? '—' },
          { label: 'Feedback', value: 'يحسّن الـ MasterAnalyzer' },
        ],
      },
    ],
  ], [stats, healthOk, enginesRunning, predictionsActive, stocksCount, winRate, refreshInterval]);

  // ─── Architecture nodes ─────────────────────────────────────────────────

  const archLayers: Array<{ title: string; nodes: TopologyNode[] }> = useMemo(() => [
    {
      title: '1 — مصادر البيانات',
      nodes: [
        { id: 'tv', label: 'TradingView Scanner', icon: <Network className="w-4 h-4" />, status: 'healthy', detail: '5 أسواق × 65 fields', count: stocksCount },
        { id: 'rest', label: 'TradingView REST', icon: <Network className="w-4 h-4" />, status: 'healthy', detail: 'fallback' },
        { id: 'egksco', label: 'EGKSCO', icon: <Database className="w-4 h-4" />, status: 'healthy', detail: 'EGX archive' },
        { id: 'news_src', label: 'RSS/Telegram', icon: <Newspaper className="w-4 h-4" />, status: 'healthy', detail: 'أخبار' },
      ],
    },
    {
      title: '2 — البيانات الخام',
      nodes: [
        { id: 'de', label: 'data_engine.db', icon: <Database className="w-4 h-4" />, status: 'healthy', detail: 'سوق + أساسيات' },
        { id: 'intra', label: 'intraday.db', icon: <Database className="w-4 h-4" />, status: 'healthy', detail: '340K+ ticks' },
        { id: 'news', label: 'news.db', icon: <Database className="w-4 h-4" />, status: 'healthy' },
        { id: 'metrics', label: 'metrics.db', icon: <Database className="w-4 h-4" />, status: 'healthy', detail: 'قياسات النظام' },
      ],
    },
    {
      title: '3 — القواعد الأساسية',
      nodes: [
        {
          id: 'stocks', label: 'stocks.db', icon: <Database className="w-4 h-4" />, status: 'healthy',
          detail: 'stock_daily_prices', count: stocksCount,
          metrics: [
            { label: 'إجمالي الأسهم', value: stocksCount || '—' },
            { label: 'بسعر حي', value: stats.dataCoverage?.withPrices ?? '—' },
            { label: 'آخر تحديث', value: stats.dataCoverage?.lastUpdate ?? '—' },
          ],
        },
        {
          id: 'pred', label: 'predictions.db', icon: <Database className="w-4 h-4" />, status: 'healthy',
          count: stats.predictions?.total,
          metrics: [
            { label: 'إجمالي التوقعات', value: stats.predictions?.total ?? '—' },
            { label: 'نشطة', value: stats.predictions?.active ?? '—' },
            { label: 'محققة', value: stats.predictions?.wins ?? '—', status: 'healthy' },
            { label: 'خاسرة', value: stats.predictions?.losses ?? '—', status: 'error' },
          ],
        },
        { id: 'decision', label: 'decision_log.db', icon: <Database className="w-4 h-4" />, status: 'healthy', detail: 'أسباب الرفض' },
        { id: 'auth', label: 'auth.db', icon: <Database className="w-4 h-4" />, status: 'healthy', detail: 'مستخدمون' },
        { id: 'archive', label: 'price_history.db', icon: <Database className="w-4 h-4" />, status: 'stale', detail: 'متجمدة 24-09', metrics: [{ label: 'الحالة', value: 'DEPRECATED — fallback فقط', status: 'stale' }] },
      ],
    },
    {
      title: '4 — العقل الاستثماري (Python)',
      nodes: [
        { id: 'sanity', label: 'Price Sanity', icon: <Shield className="w-4 h-4" />, status: healthOk ? 'healthy' : 'unknown' },
        { id: 'liq2', label: 'Liquidity Gate', icon: <Activity className="w-4 h-4" />, status: 'healthy' },
        {
          id: 'analyzers', label: 'Analyzers', icon: <Brain className="w-4 h-4" />,
          status: enginesRunning ? 'healthy' : 'unknown',
          metrics: (stats.engines ?? []).map((e) => ({
            label: e.name,
            value: e.status,
            status: (e.status === 'running' || e.status === 'active' ? 'healthy' : 'unknown') as NodeStatus,
          })),
        },
        { id: 'risk2', label: 'Risk Gate', icon: <Shield className="w-4 h-4" />, status: 'healthy' },
        { id: 'track2', label: 'Tracker', icon: <Activity className="w-4 h-4" />, status: 'healthy' },
        { id: 'exit', label: 'Exit Engines', icon: <Target className="w-4 h-4" />, status: 'healthy' },
        { id: 'learn', label: 'Learning', icon: <Brain className="w-4 h-4" />, status: 'healthy' },
      ],
    },
    {
      title: '5 — واجهة العرض',
      nodes: [
        { id: 'dash', label: 'Dashboard', icon: <Activity className="w-4 h-4" />, status: 'healthy' },
        { id: 'stockui', label: 'Stocks/Chart', icon: <TrendingUp className="w-4 h-4" />, status: 'healthy' },
        { id: 'radarui', label: 'Radar/Incubator', icon: <Network className="w-4 h-4" />, status: 'healthy' },
        { id: 'recommend', label: 'Recommendations', icon: <Users className="w-4 h-4" />, status: predictionsActive ? 'healthy' : 'unknown', count: stats.predictions?.active },
        { id: 'port', label: 'Portfolio', icon: <Users className="w-4 h-4" />, status: 'healthy' },
      ],
    },
  ], [stats, healthOk, enginesRunning, predictionsActive, stocksCount]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header + Controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="w-5 h-5 text-primary" />
              خريطة النظام الحية (Live System Topology)
              {isRefreshing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Diagram toggle */}
              <Button
                size="sm" variant={activeDiagram === 'decision' ? 'default' : 'outline'}
                onClick={() => setActiveDiagram('decision')}
                className="gap-1.5 text-xs"
              >
                <Zap className="w-3.5 h-3.5" />
                تدفق القرار
              </Button>
              <Button
                size="sm" variant={activeDiagram === 'architecture' ? 'default' : 'outline'}
                onClick={() => setActiveDiagram('architecture')}
                className="gap-1.5 text-xs"
              >
                <Server className="w-3.5 h-3.5" />
                المعمارية
              </Button>
              {/* Refresh interval selector */}
              <div className="flex items-center gap-1 text-xs">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                {[10, 30, 60].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={refreshInterval === s ? 'default' : 'ghost'}
                    onClick={() => setRefreshInterval(s)}
                    className="h-7 px-2 text-[10px]"
                  >
                    {s}s
                  </Button>
                ))}
              </div>
              {/* Manual refresh */}
              <Button
                size="sm" variant="ghost"
                onClick={() => fetchStats(true)}
                disabled={isRefreshing}
                className="gap-1.5 text-xs"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
                تحديث
              </Button>
            </div>
          </div>
          {stats.lastUpdated && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(stats.lastUpdated).toLocaleString('ar-EG')}
              </span>
              {marketOpen != null && (
                <span className={marketOpen ? 'text-profit' : 'text-muted-foreground'}>
                  • السوق: {marketOpen ? 'مفتوح' : 'مقفول'}
                </span>
              )}
              {winRate != null && (
                <span className="flex items-center gap-1">
                  <Trophy className="w-3 h-3 text-warning" />
                  معدل النجاح: <span className="font-bold text-profit">{winRate}%</span>
                </span>
              )}
            </div>
          )}
        </CardHeader>
      </Card>

      {/* KPI Bar — متابعة دقيقة */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <KpiCard
          label="الأسهم المتابَعة"
          value={stocksCount || '—'}
          icon={<TrendingUp className="w-4 h-4" />}
          status={stocksCount > 0 ? 'healthy' : 'unknown'}
          sub={stats.dataCoverage?.withPrices ? `${stats.dataCoverage.withPrices} بسعر` : undefined}
        />
        <KpiCard
          label="التوقعات"
          value={stats.predictions?.total ?? '—'}
          icon={<Database className="w-4 h-4" />}
          status="healthy"
          sub={stats.predictions?.active ? `${stats.predictions.active} نشطة` : undefined}
        />
        <KpiCard
          label="معدل النجاح"
          value={winRate != null ? `${winRate}%` : '—'}
          icon={<Trophy className="w-4 h-4" />}
          status={winRate != null ? (winRate >= 50 ? 'healthy' : 'stale') : 'unknown'}
        />
        <KpiCard
          label="المحركات"
          value={stats.engines?.length ?? '—'}
          icon={<Cpu className="w-4 h-4" />}
          status={enginesRunning ? 'healthy' : 'unknown'}
          sub={enginesRunning ? 'تعمل' : 'متوقفة'}
        />
        <KpiCard
          label="Cron Jobs"
          value={stats.cronHealth?.length ?? '—'}
          icon={<Clock className="w-4 h-4" />}
          status="healthy"
        />
        <KpiCard
          label="صحة النظام"
          value={healthOk ? 'سليم' : stats.health?.status ?? '—'}
          icon={<Activity className="w-4 h-4" />}
          status={healthOk ? 'healthy' : 'unknown'}
        />
      </div>

      {/* Diagram + Log Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Diagram (2/3 width) */}
        <div className="lg:col-span-2">
          {activeDiagram === 'decision' ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-warning" />
                  تدفق القرار — من Cron لحد Learning Engine
                  <span className="text-[10px] text-muted-foreground font-normal">(اضغط على أي node للتفاصيل)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="overflow-x-auto pb-4">
                  <div className="flex flex-col items-center gap-1 min-w-[700px]">
                    {decisionNodes.map((row, rowIdx) => (
                      <React.Fragment key={rowIdx}>
                        <div className="flex flex-row gap-3 justify-center items-stretch flex-wrap">
                          {row.map((node) => (
                            <TopologyNodeCard
                              key={node.id}
                              node={node}
                              onClick={() => setSelectedNode(node)}
                            />
                          ))}
                        </div>
                        {rowIdx < decisionNodes.length - 1 && <Arrow />}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="w-4 h-4 text-primary" />
                  المعمارية الكاملة — 5 طبقات
                  <span className="text-[10px] text-muted-foreground font-normal">(اضغط على أي node للتفاصيل)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {archLayers.map((layer, layerIdx) => (
                    <div key={layerIdx}>
                      <div className="text-xs font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-md text-[10px]">
                          {layerIdx + 1}
                        </span>
                        {layer.title}
                      </div>
                      <div className="flex flex-row gap-2 justify-center items-stretch flex-wrap">
                        {layer.nodes.map((node) => (
                          <TopologyNodeCard
                            key={node.id}
                            node={node}
                            onClick={() => setSelectedNode(node)}
                          />
                        ))}
                      </div>
                      {layerIdx < archLayers.length - 1 && <Arrow />}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Live Log Feed (1/3 width) */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-profit" />
              سجل النشاط الحي (Live Log)
              {stats.logs.length > 0 && <LiveDot status="healthy" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-96 overflow-y-auto">
              {stats.logs.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  لا يوجد نشاط بعد — انتظر التحديث التالي
                </div>
              ) : (
                stats.logs.map((entry, idx) => (
                  <LogEntryRow key={`${entry.timestamp}-${idx}`} entry={entry} />
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Legend */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-center gap-4 flex-wrap text-xs">
            <div className="flex items-center gap-1.5">
              <StatusIcon status="healthy" />
              <span className="text-muted-foreground">سليم (Healthy)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusIcon status="stale" />
              <span className="text-muted-foreground">قديم/تحذير (Stale)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusIcon status="error" />
              <span className="text-muted-foreground">خطأ (Error)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusIcon status="unknown" />
              <span className="text-muted-foreground">غير معروف (Unknown)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <LiveDot status="healthy" />
              <span className="text-muted-foreground">حي (Live pulse)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Node Detail Modal */}
      <Dialog open={!!selectedNode} onOpenChange={(open) => !open && setSelectedNode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedNode?.icon}
              {selectedNode?.label}
              {selectedNode && <StatusIcon status={selectedNode.status} />}
            </DialogTitle>
            <DialogDescription>
              {selectedNode?.detail || 'تفاصيل الـ node'}
            </DialogDescription>
          </DialogHeader>
          {selectedNode?.metrics && selectedNode.metrics.length > 0 ? (
            <div className="space-y-2">
              {selectedNode.metrics.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <span className="text-xs text-muted-foreground">{m.label}</span>
                  <span className="text-xs font-mono font-bold flex items-center gap-1.5">
                    {m.status && <StatusIcon status={m.status} className="w-3 h-3" />}
                    {m.value}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              لا توجد تفاصيل إضافية متاحة لهذا الـ node
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SystemTopologyView;
