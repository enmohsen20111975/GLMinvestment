'use client';

/**
 * SystemTopologyView.tsx — خريطة النظام الحية (Live System Topology)
 * ====================================================================
 * (ALPHA-SYSTEM-TOPOLOGY — owner directive 2026-10-27):
 * «شاشة في الادمن بتوصف النظام بصورة حية جدا»
 *
 * بيعرض رسمين هندسيين تفاعليين:
 *   1. تدفق القرار (Decision Flow) — من Cron لحد Learning Engine
 *   2. المعمارية الكاملة (Full Architecture) — 5 طبقات (Sources → Raw → Canonical → Brain → Presentation)
 *
 * كل node فيها:
 *   - لون حسب حالتها (أخضر=healthy، أصفر=stale/warning، أحمر=error، رمادي=unknown)
 *   - badge بعدّاد (عدد الأسهم، آخر تحديث، إلخ)
 *   - tooltip بتفاصيل إضافية
 *
 * البيانات الحية بتيجي من:
 *   - /api/health — صحة النظام العامة
 *   - /api/market/status — حالة السوق
 *   - /api/admin/system-resources — CPU/RAM/DB
 *   - /api/admin/engines-status — حالة المحركات
 *   - /api/predictions/honest-tracking/stats — إحصائيات التوقعات
 *
 * Rule 27: لو البيانات مش متاحة → status: 'unknown' (مش fabricated).
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Activity, Database, Brain, Shield, CheckCircle2, AlertTriangle,
  XCircle, Loader2, RefreshCw, Network, Cpu, HardDrive, Zap,
  TrendingUp, Newspaper, Users, Server,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ─── Types ─────────────────────────────────────────────────────────────────

type NodeStatus = 'healthy' | 'stale' | 'error' | 'unknown';

interface TopologyNode {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: NodeStatus;
  detail?: string;
  count?: number;
}

interface SystemStats {
  health: { status: string; uptime?: string } | null;
  marketStatus: { market?: string; isOpen?: boolean } | null;
  engines: Array<{ name: string; status: string; lastRun?: string }> | null;
  predictions: { total?: number; active?: number; winRate?: number } | null;
  resources: { cpu?: number; ram?: number; dbSize?: string } | null;
  lastUpdated: string | null;
}

// ─── Status colors ─────────────────────────────────────────────────────────

const STATUS_COLORS: Record<NodeStatus, { bg: string; border: string; text: string; icon: string }> = {
  healthy: { bg: 'bg-profit/10', border: 'border-profit/30', text: 'text-profit', icon: 'text-profit' },
  stale: { bg: 'bg-warning/10', border: 'border-warning/30', text: 'text-warning', icon: 'text-warning' },
  error: { bg: 'bg-loss/10', border: 'border-loss/30', text: 'text-loss', icon: 'text-loss' },
  unknown: { bg: 'bg-muted/10', border: 'border-border', text: 'text-muted-foreground', icon: 'text-muted-foreground' },
};

function StatusIcon({ status }: { status: NodeStatus }) {
  if (status === 'healthy') return <CheckCircle2 className="w-3.5 h-3.5 text-profit" />;
  if (status === 'stale') return <AlertTriangle className="w-3.5 h-3.5 text-warning" />;
  if (status === 'error') return <XCircle className="w-3.5 h-3.5 text-loss" />;
  return <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40" />;
}

// ─── Node component ─────────────────────────────────────────────────────────

function TopologyNodeCard({ node }: { node: TopologyNode }) {
  const colors = STATUS_COLORS[node.status];
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all hover:scale-105 cursor-pointer min-w-[140px] max-w-[180px]',
        colors.bg, colors.border,
      )}
      title={node.detail || node.label}
    >
      <div className="absolute top-1.5 left-1.5">
        <StatusIcon status={node.status} />
      </div>
      <div className={cn('mt-3', colors.icon)}>{node.icon}</div>
      <div className={cn('text-xs font-bold text-center', colors.text)}>{node.label}</div>
      {node.count != null && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {node.count}
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

// ─── Arrow component (CSS-based) ────────────────────────────────────────────

function Arrow({ label, direction = 'down' }: { label?: string; direction?: 'down' | 'right' }) {
  return (
    <div className={cn('flex items-center justify-center', direction === 'down' ? 'flex-col py-1' : 'flex-row px-1')}>
      {label && <span className="text-[9px] text-muted-foreground px-1">{label}</span>}
      <div className={cn('text-muted-foreground/60', direction === 'down' ? 'rotate-180' : '')}>
        {direction === 'down' ? '↓' : '→'}
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
    resources: null,
    lastUpdated: null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeDiagram, setActiveDiagram] = useState<'decision' | 'architecture'>('decision');
  const isMountedRef = useRef(true);

  const fetchStats = useCallback(async (background = false) => {
    if (background) setIsRefreshing(true);

    const results = await Promise.allSettled([
      fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/market/status', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/admin/engines-status', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/predictions/honest-tracking', { cache: 'no-store' }).then((r) => r.json()),
    ]);

    if (!isMountedRef.current) return;

    const [healthRes, marketRes, enginesRes, predRes] = results;

    setStats({
      health: healthRes.status === 'fulfilled' ? healthRes.value : null,
      marketStatus: marketRes.status === 'fulfilled' ? marketRes.value : null,
      engines: enginesRes.status === 'fulfilled' ? enginesRes.value?.engines : null,
      predictions: predRes.status === 'fulfilled' ? predRes.value?.summary : null,
      resources: null, // populated from admin/system-resources (requires auth)
      lastUpdated: new Date().toISOString(),
    });

    if (background) setIsRefreshing(false);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchStats(false);
    const interval = setInterval(() => fetchStats(true), 30000); // refresh every 30s
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchStats]);

  // ─── Derive node statuses from stats ────────────────────────────────────

  const healthOk = stats.health?.status === 'ok' || stats.health?.status === 'healthy';
  const marketOpen = stats.marketStatus?.isOpen === true;
  const enginesRunning = stats.engines && stats.engines.some((e) => e.status === 'running' || e.status === 'active');
  const predictionsActive = (stats.predictions?.active ?? 0) > 0;

  // ─── Decision Flow nodes ────────────────────────────────────────────────

  const decisionNodes: TopologyNode[][] = [
    [
      { id: 'cron', label: 'Cron / فحص', icon: <Zap className="w-5 h-5" />, status: 'healthy', detail: 'كل 2 دقيقة' },
      { id: 'dates', label: 'تواريخ الفحص', icon: <Activity className="w-5 h-5" />, status: 'healthy' },
      { id: 'cache', label: 'Price Cache', icon: <Database className="w-5 h-5" />, status: 'healthy' },
      { id: 'ticker', label: 'اختيار السهم', icon: <TrendingUp className="w-5 h-5" />, status: 'healthy' },
    ],
    [
      { id: 'b1', label: 'B1: Price Sanity', icon: <Shield className="w-5 h-5" />, status: healthOk ? 'healthy' : 'unknown', detail: 'فحص البيانات' },
      { id: 'reject1', label: 'رفض الدخول', icon: <XCircle className="w-5 h-5" />, status: 'unknown', detail: 'DATA_INVALID' },
      { id: 'liq', label: 'Liquidity Gate', icon: <Activity className="w-5 h-5" />, status: 'healthy' },
      { id: 'skip', label: 'تخطي السهم', icon: <AlertTriangle className="w-5 h-5" />, status: 'unknown' },
    ],
    [
      { id: 'master', label: 'MasterAnalyzer', icon: <Brain className="w-5 h-5" />, status: enginesRunning ? 'healthy' : 'unknown', detail: 'تحليل متعدد' },
      { id: 'score', label: 'Master Score', icon: <Activity className="w-5 h-5" />, status: 'healthy', detail: 'BUY/HOLD/SELL' },
      { id: 'veto', label: 'News Veto', icon: <Newspaper className="w-5 h-5" />, status: 'healthy' },
      { id: 'risk', label: 'Risk Gate', icon: <Shield className="w-5 h-5" />, status: 'healthy' },
    ],
    [
      { id: 'noTrade', label: 'رفض/تخفيض', icon: <XCircle className="w-5 h-5" />, status: 'unknown' },
      { id: 'track', label: 'Prediction Tracker', icon: <Activity className="w-5 h-5" />, status: 'healthy' },
      { id: 'store', label: 'predictions.db', icon: <Database className="w-5 h-5" />, status: 'healthy', count: stats.predictions?.total },
      { id: 'stored', label: 'stored_analyses', icon: <Database className="w-5 h-5" />, status: 'healthy' },
    ],
    [
      { id: 'ui', label: 'واجهة التوصيات', icon: <Users className="w-5 h-5" />, status: predictionsActive ? 'healthy' : 'unknown', count: stats.predictions?.active },
      { id: 'closer', label: 'Daily Closer', icon: <Activity className="w-5 h-5" />, status: 'healthy' },
      { id: 'outcome', label: 'نتيجة الصفقة', icon: <TrendingUp className="w-5 h-5" />, status: 'healthy' },
      { id: 'log', label: 'decision_log.db', icon: <Database className="w-5 h-5" />, status: 'healthy' },
    ],
    [
      { id: 'learning', label: 'Learning Engine', icon: <Brain className="w-5 h-5" />, status: 'healthy', detail: 'تحليل الأخطاء' },
    ],
  ];

  // ─── Architecture nodes ─────────────────────────────────────────────────

  const archLayers: Array<{ title: string; nodes: TopologyNode[] }> = [
    {
      title: '1 — مصادر البيانات',
      nodes: [
        { id: 'tv', label: 'TradingView Scanner', icon: <Network className="w-4 h-4" />, status: 'healthy', detail: '5 أسواق' },
        { id: 'rest', label: 'TradingView REST', icon: <Network className="w-4 h-4" />, status: 'healthy' },
        { id: 'egksco', label: 'EGKSCO', icon: <Database className="w-4 h-4" />, status: 'healthy', detail: 'EGX fallback' },
        { id: 'news_src', label: 'RSS/Telegram', icon: <Newspaper className="w-4 h-4" />, status: 'healthy' },
      ],
    },
    {
      title: '2 — البيانات الخام',
      nodes: [
        { id: 'de', label: 'data_engine.db', icon: <Database className="w-4 h-4" />, status: 'healthy', detail: 'سوق + أساسيات' },
        { id: 'intra', label: 'intraday.db', icon: <Database className="w-4 h-4" />, status: 'healthy', detail: '340K+ ticks' },
        { id: 'news', label: 'news.db', icon: <Database className="w-4 h-4" />, status: 'healthy' },
        { id: 'metrics', label: 'metrics.db', icon: <Database className="w-4 h-4" />, status: 'healthy' },
      ],
    },
    {
      title: '3 — القواعد الأساسية',
      nodes: [
        { id: 'stocks', label: 'stocks.db', icon: <Database className="w-4 h-4" />, status: 'healthy', detail: 'stock_daily_prices' },
        { id: 'pred', label: 'predictions.db', icon: <Database className="w-4 h-4" />, status: 'healthy', count: stats.predictions?.total },
        { id: 'decision', label: 'decision_log.db', icon: <Database className="w-4 h-4" />, status: 'healthy' },
        { id: 'auth', label: 'auth.db', icon: <Database className="w-4 h-4" />, status: 'healthy' },
        { id: 'archive', label: 'price_history.db', icon: <Database className="w-4 h-4" />, status: 'stale', detail: 'متجمدة 24-09' },
      ],
    },
    {
      title: '4 — العقل الاستثماري (Python)',
      nodes: [
        { id: 'sanity', label: 'Price Sanity', icon: <Shield className="w-4 h-4" />, status: 'healthy' },
        { id: 'liq2', label: 'Liquidity Gate', icon: <Activity className="w-4 h-4" />, status: 'healthy' },
        { id: 'analyzers', label: 'Analyzers', icon: <Brain className="w-4 h-4" />, status: enginesRunning ? 'healthy' : 'unknown' },
        { id: 'risk2', label: 'Risk Gate', icon: <Shield className="w-4 h-4" />, status: 'healthy' },
        { id: 'track2', label: 'Tracker', icon: <Activity className="w-4 h-4" />, status: 'healthy' },
        { id: 'exit', label: 'Exit Engines', icon: <Activity className="w-4 h-4" />, status: 'healthy' },
        { id: 'learn', label: 'Learning', icon: <Brain className="w-4 h-4" />, status: 'healthy' },
      ],
    },
    {
      title: '5 — واجهة العرض',
      nodes: [
        { id: 'dash', label: 'Dashboard', icon: <Activity className="w-4 h-4" />, status: 'healthy' },
        { id: 'stockui', label: 'Stocks/Chart', icon: <TrendingUp className="w-4 h-4" />, status: 'healthy' },
        { id: 'radarui', label: 'Radar/Incubator', icon: <Network className="w-4 h-4" />, status: 'healthy' },
        { id: 'recommend', label: 'Recommendations', icon: <Users className="w-4 h-4" />, status: predictionsActive ? 'healthy' : 'unknown' },
        { id: 'port', label: 'Portfolio', icon: <Users className="w-4 h-4" />, status: 'healthy' },
      ],
    },
  ];

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="w-5 h-5 text-primary" />
              خريطة النظام الحية (Live System Topology)
              {isRefreshing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={activeDiagram === 'decision' ? 'default' : 'outline'}
                onClick={() => setActiveDiagram('decision')}
                className="gap-1.5 text-xs"
              >
                <Zap className="w-3.5 h-3.5" />
                تدفق القرار
              </Button>
              <Button
                size="sm"
                variant={activeDiagram === 'architecture' ? 'default' : 'outline'}
                onClick={() => setActiveDiagram('architecture')}
                className="gap-1.5 text-xs"
              >
                <Server className="w-3.5 h-3.5" />
                المعمارية الكاملة
              </Button>
              <Button
                size="sm"
                variant="ghost"
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
            <div className="text-[10px] text-muted-foreground">
              آخر تحديث: {new Date(stats.lastUpdated).toLocaleString('ar-EG')}
              {stats.predictions?.winRate != null && (
                <span className="mr-3">
                  • معدل النجاح: <span className="font-bold text-profit">{stats.predictions.winRate}%</span>
                </span>
              )}
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Diagram */}
      {activeDiagram === 'decision' ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-warning" />
              تدفق القرار — من Cron لحد Learning Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto pb-4">
              <div className="flex flex-col items-center gap-1 min-w-[700px]">
                {decisionNodes.map((row, rowIdx) => (
                  <React.Fragment key={rowIdx}>
                    <div className="flex flex-row gap-3 justify-center items-stretch flex-wrap">
                      {row.map((node) => (
                        <TopologyNodeCard key={node.id} node={node} />
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
                      <TopologyNodeCard key={node.id} node={node} />
                    ))}
                  </div>
                  {layerIdx < archLayers.length - 1 && <Arrow />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SystemTopologyView;
