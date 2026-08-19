'use client';

import React, { useState, useEffect } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  TrendingUp, TrendingDown, Target, Shield, BarChart3,
  Activity, Award, ArrowUpRight, ArrowDownRight, Zap,
  CheckCircle2, AlertTriangle, XCircle, BarChart2,
} from 'lucide-react';

interface StrategyResult {
  name: string;
  description: string;
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  avg_winner_pct: number;
  avg_loser_pct: number;
  profit_factor: number;
  avg_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  picks_per_day: number;
  avg_holding_days: number;
  rating: string;
  exit_breakdown: Record<string, number>;
  is_best?: boolean;
}

interface WalkForwardData {
  in_sample: {
    period: string;
    total_trades: number;
    win_rate: number;
    profit_factor: number;
    avg_return_pct: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
  };
  out_of_sample: {
    period: string;
    total_trades: number;
    win_rate: number;
    profit_factor: number;
    avg_return_pct: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
  };
  verdict: string;
}

interface BacktestData {
  meta: {
    version: string;
    market: string;
    stocks: number;
    period: string;
    trading_days: number;
    data_source: string;
    last_updated: string;
  };
  strategies: Record<string, StrategyResult>;
  walk_forward: Record<string, WalkForwardData>;
  comparison_vs_old: {
    title: string;
    old: { market: string; best_combo: string; win_rate: number; profit_factor: number; avg_return_30d: number; verdict: string };
    new: { market: string; best_combo: string; win_rate: number; profit_factor: number; avg_return: number; verdict: string };
    improvements: string[];
  };
}

function MetricCard({ label, value, icon, color = 'text-foreground', sub }: {
  label: string; value: string | number; icon?: React.ReactNode; color?: string; sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/50 border border-border/50">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function PFIndicator({ pf }: { pf: number }) {
  const pct = Math.min(Math.max((pf / 3) * 100, 0), 100);
  const color = pf >= 1.5 ? 'text-emerald-500' : pf >= 1.0 ? 'text-amber-500' : 'text-red-500';
  const bgColor = pf >= 1.5 ? 'bg-emerald-500' : pf >= 1.0 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Profit Factor</span>
        <span className={`text-lg font-bold ${color}`}>{pf.toFixed(2)}</span>
      </div>
      <Progress value={pct} className={`h-2 ${bgColor}`} />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>خسران (&lt;1.0)</span>
        <span>رابح (≥1.5)</span>
      </div>
    </div>
  );
}

function StrategyCard({ strategyKey, strategy }: { strategyKey: string; strategy: StrategyResult }) {
  const pfColor = strategy.profit_factor >= 1.5 ? 'text-emerald-500' :
    strategy.profit_factor >= 1.0 ? 'text-amber-500' : 'text-red-500';
  const wrColor = strategy.win_rate >= 60 ? 'text-emerald-500' :
    strategy.win_rate >= 50 ? 'text-amber-500' : 'text-red-500';

  return (
    <Card className={`relative overflow-hidden ${strategy.is_best ? 'ring-2 ring-emerald-500/50' : ''}`}>
      {strategy.is_best && (
        <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">
          🏆 BEST
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Badge variant={strategy.is_best ? 'default' : 'secondary'} className="text-xs">
            Strategy {strategyKey}
          </Badge>
          <span className="text-sm font-medium">{strategy.name}</span>
        </div>
        <CardDescription className="text-xs">{strategy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <PFIndicator pf={strategy.profit_factor} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MetricCard
            label="Win Rate"
            value={`${strategy.win_rate}%`}
            icon={<TrendingUp className="w-3 h-3" />}
            color={wrColor}
          />
          <MetricCard
            label="Avg Win"
            value={`+${strategy.avg_winner_pct}%`}
            icon={<ArrowUpRight className="w-3 h-3" />}
            color="text-emerald-500"
          />
          <MetricCard
            label="Avg Loss"
            value={`${strategy.avg_loser_pct}%`}
            icon={<ArrowDownRight className="w-3 h-3" />}
            color="text-red-500"
          />
          <MetricCard
            label="Avg Return"
            value={`${strategy.avg_return_pct >= 0 ? '+' : ''}${strategy.avg_return_pct}%`}
            icon={<Activity className="w-3 h-3" />}
            color={strategy.avg_return_pct >= 0 ? 'text-emerald-500' : 'text-red-500'}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <MetricCard label="Trades" value={strategy.total_trades} icon={<BarChart3 className="w-3 h-3" />} />
          <MetricCard label="Picks/Day" value={strategy.picks_per_day} icon={<Target className="w-3 h-3" />} />
          <MetricCard label="Hold Days" value={strategy.avg_holding_days} icon={<Shield className="w-3 h-3" />} />
        </div>

        {/* Exit breakdown bar */}
        {strategy.exit_breakdown && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Exit Breakdown</div>
            <div className="flex rounded-full overflow-hidden h-3">
              {Object.entries(strategy.exit_breakdown).map(([reason, count]) => {
                const pct = (count / strategy.total_trades) * 100;
                const bgColor = reason === 'target' ? 'bg-emerald-500' :
                  reason === 'trailing_stop' ? 'bg-blue-500' :
                  reason === 'stop' ? 'bg-red-500' : 'bg-gray-400';
                return (
                  <div
                    key={reason}
                    className={`${bgColor} transition-all`}
                    style={{ width: `${pct}%` }}
                    title={`${reason}: ${count} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 text-[10px]">
              {Object.entries(strategy.exit_breakdown).map(([reason, count]) => {
                const dotColor = reason === 'target' ? 'bg-emerald-500' :
                  reason === 'trailing_stop' ? 'bg-blue-500' :
                  reason === 'stop' ? 'bg-red-500' : 'bg-gray-400';
                return (
                  <div key={reason} className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                    <span>{reason}: {count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t">
          <span className="text-xs text-muted-foreground">Rating</span>
          <span className="text-sm">{strategy.rating}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function WalkForwardComparison({ data, title }: { data: WalkForwardData; title: string }) {
  const metrics = [
    { name: 'Win Rate %', is: data.in_sample.win_rate, oos: data.out_of_sample.win_rate, unit: '%' },
    { name: 'Profit Factor', is: data.in_sample.profit_factor, oos: data.out_of_sample.profit_factor, unit: '×' },
    { name: 'Avg Return %', is: data.in_sample.avg_return_pct, oos: data.out_of_sample.avg_return_pct, unit: '%' },
    { name: 'Sharpe Ratio', is: data.in_sample.sharpe_ratio, oos: data.out_of_sample.sharpe_ratio, unit: '' },
    { name: 'Max Drawdown %', is: data.in_sample.max_drawdown_pct, oos: data.out_of_sample.max_drawdown_pct, unit: '%', lower_better: true },
  ];

  const verdictIcon = data.verdict.includes('✅') ?
    <CheckCircle2 className="w-5 h-5 text-emerald-500" /> :
    data.verdict.includes('⚠️') ?
    <AlertTriangle className="w-5 h-5 text-amber-500" /> :
    <XCircle className="w-5 h-5 text-red-500" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart2 className="w-4 h-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground mb-1 px-1">
          <span>Metric</span>
          <span className="text-center">In-Sample</span>
          <span className="text-center">Out-of-Sample</span>
        </div>
        {metrics.map((m) => {
          const delta = m.oos - m.is;
          const isBetter = m.lower_better ? delta < 0 : delta > 0;
          return (
            <div key={m.name} className="grid grid-cols-3 gap-2 items-center px-1">
              <span className="text-xs">{m.name}</span>
              <span className="text-center text-sm font-medium">{m.is.toFixed(2)}{m.unit}</span>
              <span className={`text-center text-sm font-medium ${isBetter ? 'text-emerald-500' : 'text-red-500'}`}>
                {m.oos.toFixed(2)}{m.unit}
                <span className="text-[10px] ml-1">
                  ({delta >= 0 ? '+' : ''}{delta.toFixed(2)})
                </span>
              </span>
            </div>
          );
        })}
        <div className="flex items-center gap-2 pt-2 border-t">
          {verdictIcon}
          <span className="text-sm">{data.verdict}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonCard({ comparison }: { comparison: BacktestData['comparison_vs_old'] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="w-4 h-4" />
          {comparison.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Old system */}
          <div className="space-y-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="text-sm font-bold text-red-500">❌ النظام القديم (v1.0)</div>
            <div className="text-xs text-muted-foreground">{comparison.old.market}</div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>Win Rate</span>
                <span className="font-medium">{comparison.old.win_rate}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>Profit Factor</span>
                <span className="font-bold text-red-500">{comparison.old.profit_factor}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>Avg 30d Return</span>
                <span className="font-medium text-red-500">{comparison.old.avg_return_30d}%</span>
              </div>
            </div>
          </div>
          {/* New system */}
          <div className="space-y-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-sm font-bold text-emerald-500">✅ النظام الجديد (v2.0)</div>
            <div className="text-xs text-muted-foreground">{comparison.new.market}</div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>Win Rate</span>
                <span className="font-medium">{comparison.new.win_rate}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>Profit Factor</span>
                <span className="font-bold text-emerald-500">{comparison.new.profit_factor}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>Avg Return</span>
                <span className="font-medium text-emerald-500">+{comparison.new.avg_return}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Improvements */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium">التحسينات الرئيسية:</div>
          {comparison.improvements.map((imp, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <Award className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
              <span>{imp}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function EGXBacktestDashboard() {
  const [data, setData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sniper/backtest')
      .then(r => r.json())
      .then(res => {
        if (res.success) setData(res.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-sm text-muted-foreground">جاري تحميل نتائج الاختبار...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-red-500">فشل تحميل البيانات</p>
      </div>
    );
  }

  const strategyEntries = Object.entries(data.strategies);

  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Target className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold">EGX Sniper Backtest v2.0</h1>
            <p className="text-sm text-muted-foreground">
              اختبار تجريبي على البورصة المصرية — مش تداول!
            </p>
          </div>
        </div>

        {/* Meta info */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="text-xs">
            🇪🇬 {data.meta.market}
          </Badge>
          <Badge variant="outline" className="text-xs">
            📊 {data.meta.stocks} سهم
          </Badge>
          <Badge variant="outline" className="text-xs">
            📅 {data.meta.period}
          </Badge>
          <Badge variant="outline" className="text-xs">
            🔢 {data.meta.trading_days} يوم تداول
          </Badge>
          <Badge variant="outline" className="text-xs">
            💾 {data.meta.data_source}
          </Badge>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="strategies" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="strategies">الاستراتيجيات</TabsTrigger>
          <TabsTrigger value="walkforward">Walk-Forward</TabsTrigger>
          <TabsTrigger value="comparison">المقارنة</TabsTrigger>
        </TabsList>

        <TabsContent value="strategies" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {strategyEntries.map(([key, strategy]) => (
              <StrategyCard key={key} strategyKey={key} strategy={strategy} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="walkforward" className="space-y-4">
          <div className="text-sm text-muted-foreground mb-2">
            🔬 اختبار Walk-Forward: تدريب على 2021-2024، اختبار على 2025
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(data.walk_forward).map(([key, wf]) => (
              <WalkForwardComparison
                key={key}
                data={wf}
                title={`Strategy ${key.replace('strategy_', '')}`}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="comparison" className="space-y-4">
          <ComparisonCard comparison={data.comparison_vs_old} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
