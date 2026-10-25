/**
 * executive-report/ReportBody.tsx
 * ===============================
 * The MAIN REPORT card — the PNG snapshot target. Contains:
 *  - Decorative background glows
 *  - Branding header (badge + timeframe + market + data-source +
 *    active-filter indicator + quality mode badge + win-rate KPI badge)
 *  - Loading skeleton / empty state / full body
 *  - Full body:
 *    · 5 hero KPI cards (win rate / profit factor / wins-losses /
 *      avg win-loss / total profit)
 *    · Trailing-profit KPI card (conditional)
 *    · Charts grid (Donut + Area cumulative)
 *    · Charts grid 2 (Bar monthly + Radar persona)
 *    · Highlights grid (top gains + fastest gains)
 *    · Top losers row
 *    · Trailing-profit highlights (conditional)
 *    · Persona breakdown (3 cards)
 *    · Missed opportunities grid (4 cards)
 *    · Win/loss proportion bar + footer
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 *
 * Sub-components: KpiCard / HighlightCard / PersonaCard / MissedOppCard.
 */

'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle,
  CheckCircle2,
  Database,
  Flame,
  Gauge,
  Layers,
  PieChart as PieIcon,
  Scale,
  Shield,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import { cn, fmtPrice } from '@/lib/utils';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  BarChart,
  Bar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from 'recharts';
import { KpiCard } from './KpiCard';
import { HighlightCard } from './HighlightCard';
import { PersonaCard } from './PersonaCard';
import { MissedOppCard } from './MissedOppCard';
import type {
  ComputedStats,
  LivePredictionItem,
  MissedOpportunitiesResponse,
  PersonaStatsItem,
} from './types';

export interface ReportBodyProps {
  // PNG snapshot target ref
  reportContainerRef: React.RefObject<HTMLDivElement>;
  // Header state
  market: string;
  timeframeLabel: string;
  source?: string;
  activeFilterCount: number;
  qualityMode: 'top_picks' | 'all';
  minConfidence: number;
  // Loading / empty
  loading: boolean;
  totalTrades: number;
  // Computed stats
  stats: ComputedStats;
  statsByPersona: Record<'gambler' | 'balanced' | 'conservative', PersonaStatsItem>;
  winRate: number;
  profitFactor: number;
  uniqueStockCount: number;
  totalPredictionCount: number;
  trailingProfitCount: number;
  // Chart data
  outcomeDistribution: Array<{ name: string; value: number; color: string }>;
  cumulativeProfitData: Array<{ label: string; cumulative: number; trade: number }>;
  monthlyReturns: Array<{ month: string; total: number; count: number; winRate: number }>;
  personaRadarData: Array<{
    axis: string;
    gambler: number;
    balanced: number;
    conservative: number;
  }>;
  // Highlights
  topGains: LivePredictionItem[];
  topLosses: LivePredictionItem[];
  fastestGains: LivePredictionItem[];
  topTrailingProfit: LivePredictionItem[];
  // Missed opportunities
  missedOpps: MissedOpportunitiesResponse | null;
  missedOppsLoading: boolean;
}

export function ReportBody(props: ReportBodyProps) {
  const {
    reportContainerRef,
    market,
    timeframeLabel,
    source,
    activeFilterCount,
    qualityMode,
    minConfidence,
    loading,
    totalTrades,
    stats,
    statsByPersona,
    winRate,
    profitFactor,
    uniqueStockCount,
    totalPredictionCount,
    trailingProfitCount,
    outcomeDistribution,
    cumulativeProfitData,
    monthlyReturns,
    personaRadarData,
    topGains,
    topLosses,
    fastestGains,
    topTrailingProfit,
    missedOpps,
    missedOppsLoading,
  } = props;

  return (
    <div
      ref={reportContainerRef}
      className="relative max-w-6xl mx-auto rounded-3xl via-card to-muted border-2 border-warning/25 text-foreground shadow-2xl overflow-hidden"
    >
      {/* Decorative background glows — subtle, not overwhelming */}
      <div className="absolute top-0 right-0 w-[28rem] h-[28rem] bg-warning/8 blur-[140px] pointer-events-none rounded-full" />
      <div className="absolute bottom-0 left-0 w-[28rem] h-[28rem] bg-profit/6 blur-[140px] pointer-events-none rounded-full" />

      <div className="relative z-10 p-6 sm:p-8 md:p-10 lg:p-12 space-y-8">
        {/* ── Branding Header ── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-7 border-b border-white/10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span className="px-3 py-1 rounded-full text-xs font-black bg-warning/15 text-warning border border-warning/20 tracking-wider">
                ملخص الأداء
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {timeframeLabel} · {market}
              </span>
              {/* RL-FIX-7/8: Data source indicator */}
              {source && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-muted text-foreground border border-border flex items-center gap-1">
                  <Database className="w-3 h-3" />
                  {source.includes('vps') || source.includes('prod') || source.includes('production')
                    ? 'بيانات الإنتاج'
                    : 'بيانات محلية'}
                </span>
              )}
              {/* RL-FIX-7: Active filters indicator */}
              {activeFilterCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-warning/20 text-warning border border-warning/20">
                  {activeFilterCount} فلتر نشط
                </span>
              )}
              {/* RL-FIX-10: Quality mode indicator */}
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1',
                  qualityMode === 'top_picks'
                    ? 'bg-profit/15 text-profit border-profit/20'
                    : 'bg-muted text-foreground border-border',
                )}
              >
                <Sparkles className="w-3 h-3" />
                {qualityMode === 'top_picks'
                  ? `أفضل التوقعات (≥${minConfidence})`
                  : 'كل التوقعات'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-foreground flex items-center gap-3 tracking-tight leading-tight">
              <Gauge className="w-8 h-8 sm:w-9 sm:h-9 text-warning flex-shrink-0" />
              <span>ملخص أداء التوقعات</span>
            </h1>
            <p className="text-sm sm:text-base text-foreground mt-2 max-w-2xl leading-relaxed">
              ملخص لنتائج التوقعات خلال {timeframeLabel}، يعرض الأرقام الفعلية للصفقات.
              {!loading && totalTrades > 0 && (
                <>
                  <span className="text-warning font-bold">
                    {' '}
                    — {uniqueStockCount} سهم فريد في النتائج
                  </span>
                  {totalPredictionCount > uniqueStockCount && (
                    <span className="text-muted-foreground">
                      {' '}
                      ({totalPredictionCount} توقع · 3 شخصيات لكل سهم)
                    </span>
                  )}
                </>
              )}
            </p>
          </div>

          {/* Market + key metric badge */}
          <div className="flex flex-col items-start md:items-end justify-center bg-card px-5 py-4 rounded-2xl border border-warning/20 md:min-w-[220px]">
            <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider">
              سوق {market}
            </span>
            <span className="text-2xl font-black text-profit mt-1 leading-none">
              {(winRate ?? 0).toFixed(1)}%
            </span>
            <span className="text-sm text-warning font-bold mt-1.5">
              معامل الربحية {profitFactor >= 999 ? 'مثالي' : (profitFactor ?? 0).toFixed(2)}
            </span>
            {/* RL-FIX-7: Settled count transparency */}
            {!loading && totalTrades > 0 && (
              <span className="text-xs text-muted-foreground mt-1.5">
                {stats.wins} رابحة / {stats.losses} خاسرة / {stats.pending} معلقة
                {trailingProfitCount > 0 && (
                  <span className="text-whale font-bold"> · {trailingProfitCount} 💰 خرجت بربح</span>
                )}
                <span className="text-muted-foreground"> · قياس على الأسهم الفريدة</span>
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-6 py-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-36 w-full bg-card rounded-2xl" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Skeleton className="h-64 w-full bg-card rounded-2xl" />
              <Skeleton className="h-64 w-full bg-card rounded-2xl" />
            </div>
          </div>
        ) : totalTrades === 0 ? (
          <div className="text-center py-16">
            <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-base">لا توجد توقعات خلال الفترة المحددة</p>
            <p className="text-muted-foreground text-sm mt-1">
              جرّب فترة زمنية أطول لعرض المزيد من البيانات
            </p>
          </div>
        ) : (
          <>
            {/* ═══ 1. HERO KPI CARDS — 5 metrics ═══ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard
                label="نسبة النجاح"
                value={`${(winRate ?? 0).toFixed(1)}%`}
                subtext={`من ${stats.settled} سهم محسوم`}
                accent="emerald"
              />
              <KpiCard
                label="معامل الربحية"
                value={profitFactor >= 999 ? 'مثالي' : (profitFactor ?? 0).toFixed(2)}
                subtext="نسبة الأرباح للخسائر"
                accent="amber"
              />
              <KpiCard
                label="الصفقات المحسومة"
                value={`${stats.wins}`}
                valueSuffix={`/ ${stats.losses}`}
                subtext={`من إجمالي ${stats.total} سهم فريد`}
                accent="rose"
                isSplit
              />
              <KpiCard
                label="متوسط العائد / الخسارة"
                value={`+${(stats.avgWinPct ?? 0).toFixed(1)}%`}
                valueSuffix={`/ ${(stats.avgLossPct ?? 0).toFixed(1)}%`}
                subtext="متوسط العائد للصفقة"
                accent="emerald"
                isSplit
              />
              <KpiCard
                label="إجمالي الربح"
                value={`${stats.totalProfit >= 0 ? '+' : ''}${(stats.totalProfit ?? 0).toFixed(2)}%`}
                subtext="مجموع عوائد الصفقات المغلقة"
                accent={stats.totalProfit >= 0 ? 'emerald' : 'rose'}
                icon={<TrendingUp className="w-4 h-4" />}
              />
            </div>

            {/* FIX-5C: TRAILING_PROFIT KPI Card منفصل */}
            {trailingProfitCount > 0 && (
              <div className="mt-4 inline-flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-whale/10 border border-whale/20">
                <span className="text-2xl">💰</span>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground font-bold">
                    خرجت بربح (Trailing Profit)
                  </span>
                  <span className="text-whale font-black text-lg font-mono">
                    {trailingProfitCount} صفقة
                  </span>
                </div>
                <span className="text-xs text-muted-foreground mr-2 max-w-[200px]">
                  وصلت لربح جزئي ثم ارتدت — تم جني الأرباح قبل الهدف الكامل
                </span>
              </div>
            )}

            {/* ═══ 2. CHARTS GRID — Donut + Area ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* 2A. Donut: توزيع النتائج */}
              <div className="bg-card p-5 rounded-2xl border border-white/10">
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                  <PieIcon className="w-5 h-5 text-warning" />
                  <h3 className="text-base font-bold text-foreground">توزيع النتائج</h3>
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
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid rgba(255,255,255,0.1)',
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
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: d.color }}
                          />
                          <span className="text-foreground">{d.name}</span>
                          <span className="text-foreground font-bold mr-auto">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                    لا توجد بيانات
                  </div>
                )}
              </div>

              {/* 2B. Area: الأرباح التراكمية */}
              <div className="bg-card p-5 rounded-2xl border border-white/10 lg:col-span-2">
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-profit" />
                    <h3 className="text-base font-bold text-foreground">حركة الأرباح التراكمية</h3>
                  </div>
                  {cumulativeProfitData.length > 0 && (
                    <Badge variant="outline" className="text-xs text-profit border-profit/20 bg-profit/10">
                      تراكمي:{' '}
                      {cumulativeProfitData[cumulativeProfitData.length - 1].cumulative > 0 ? '+' : ''}
                      {(cumulativeProfitData[cumulativeProfitData.length - 1].cumulative ?? 0).toFixed(1)}%
                    </Badge>
                  )}
                </div>
                {cumulativeProfitData.length > 1 ? (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={cumulativeProfitData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                        <defs>
                          <linearGradient id="cumProfitGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} hide />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={40} />
                        <RTooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            fontSize: '12px',
                          }}
                          formatter={(value: number, name: string) => {
                            if (name === 'cumulative')
                              return [`${value > 0 ? '+' : ''}${(value ?? 0).toFixed(2)}%`, 'تراكمي'];
                            return [`${value > 0 ? '+' : ''}${(value ?? 0).toFixed(2)}%`, 'الصفقة'];
                          }}
                        />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />
                        <Area
                          type="monotone"
                          dataKey="cumulative"
                          stroke="#10b981"
                          strokeWidth={2.5}
                          fill="url(#cumProfitGrad)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                    لا توجد صفقات مغلقة كافية
                  </div>
                )}
              </div>
            </div>

            {/* ═══ 3. CHARTS GRID 2 — Bar شهري + Radar للشخصيات ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-card p-5 rounded-2xl border border-white/10">
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                  <BarChart3 className="w-5 h-5 text-warning" />
                  <h3 className="text-base font-bold text-foreground">العائد الشهري</h3>
                </div>
                {monthlyReturns.length > 0 ? (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyReturns} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={40} />
                        <RTooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            fontSize: '12px',
                          }}
                          formatter={(value: number) => [
                            `${value > 0 ? '+' : ''}${(value ?? 0).toFixed(2)}%`,
                            'العائد',
                          ]}
                        />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />
                        <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                          {monthlyReturns.map((entry, idx) => (
                            <Cell key={`bar-${idx}`} fill={entry.total >= 0 ? '#10b981' : '#f43f5e'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                    لا توجد بيانات شهرية كافية
                  </div>
                )}
              </div>

              <div className="bg-card p-5 rounded-2xl border border-white/10">
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                  <Gauge className="w-5 h-5 text-profit" />
                  <h3 className="text-base font-bold text-foreground">مقارنة الشخصيات</h3>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={personaRadarData} outerRadius="75%">
                      <PolarGrid stroke="rgba(255,255,255,0.1)" />
                      <PolarAngleAxis dataKey="axis" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                      <RTooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '12px',
                          fontSize: '12px',
                        }}
                      />
                      <Radar name="المتوازن" dataKey="balanced" stroke="#2dd4bf" fill="#2dd4bf" fillOpacity={0.3} />
                      <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} iconType="circle" />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* ═══ 4. HIGHLIGHTS: Top Gains + Fastest Gains ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <HighlightCard
                title="أعلى المكاسب"
                subtitle="الأعلى عائداً"
                icon={<Trophy className="w-5 h-5 text-warning" />}
                accentBorder="border-warning/20"
                items={topGains.map((item) => ({
                  ticker: item.ticker,
                  nameAr: item.nameAr,
                  returnPct: Number(item.returnPct || 0),
                  meta: `دخول ${fmtPrice(item.entryPrice)}`,
                  rightMeta: `${item.daysSinceEntry || 1} يوم`,
                  accentText: 'text-warning',
                }))}
                placeholder="لا توجد صفقات رابحة في هذه الفترة"
              />

              <HighlightCard
                title="أسرع الصفقات"
                subtitle="تحقيق الهدف في مدة قصيرة"
                icon={<Zap className="w-5 h-5 text-profit" />}
                accentBorder="border-profit/20"
                items={fastestGains.map((item) => ({
                  ticker: item.ticker,
                  nameAr: item.nameAr,
                  returnPct: Number(item.returnPct || 0),
                  meta: `دخول ${fmtPrice(item.entryPrice)}`,
                  rightMeta: `⚡ ${item.daysSinceEntry || 1} يوم`,
                  accentText: 'text-profit',
                }))}
                placeholder="لا توجد صفقات سريعة في هذه الفترة"
              />
            </div>

            {/* Top Losers */}
            <div className="mt-5">
              <HighlightCard
                title="أعلى الخسائر"
                subtitle="الأكثر انخفاضاً في الفترة"
                icon={<TrendingDown className="w-5 h-5 text-loss" />}
                accentBorder="border-loss/20"
                items={topLosses.map((item) => ({
                  ticker: item.ticker,
                  nameAr: item.nameAr,
                  returnPct: Number(item.returnPct || 0),
                  meta: `دخول ${fmtPrice(item.entryPrice)}`,
                  rightMeta: `${item.daysSinceEntry || 1} يوم`,
                  accentText: 'text-loss',
                }))}
                placeholder="لا توجد صفقات خاسرة في هذه الفترة"
              />
            </div>

            {/* FIX-5C: TRAILING_PROFIT highlights */}
            {topTrailingProfit.length > 0 && (
              <div className="mt-5">
                <HighlightCard
                  title="💰 خرجت بربح (Trailing Profit)"
                  subtitle="جني أرباح قبل الهدف الكامل"
                  icon={<Trophy className="w-5 h-5 text-whale" />}
                  accentBorder="border-whale/20"
                  items={topTrailingProfit.map((item) => ({
                    ticker: item.ticker,
                    nameAr: item.nameAr,
                    returnPct: Number(item.returnPct || 0),
                    meta: `دخول ${fmtPrice(item.entryPrice)}`,
                    rightMeta: `${item.daysSinceEntry || 1} يوم`,
                    accentText: 'text-whale',
                  }))}
                  placeholder="لا توجد صفقات trailing profit في هذه الفترة"
                />
              </div>
            )}

            {/* ═══ 5. PERSONA BREAKDOWN ═══ */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-warning" />
                <h3 className="text-lg font-bold text-foreground">الأداء حسب استراتيجية المستثمر</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PersonaCard
                  icon={<Flame className="w-5 h-5 text-warning" />}
                  title="المضارب"
                  subtitle="خاطف (1-5 أيام)"
                  description="الزخم السريع واقتناص الفتحات"
                  accentRing="border-orange-500/30"
                  accentBar="bg-warning"
                  stats={{
                    winRate: statsByPersona?.gambler?.winRate ?? 0,
                    profitFactor: statsByPersona?.gambler?.profitFactor ?? 0,
                    avgWinPct: statsByPersona?.gambler?.avgWinPct ?? 0,
                    wins: statsByPersona?.gambler?.wins ?? 0,
                    losses: statsByPersona?.gambler?.losses ?? 0,
                  }}
                  winRateColor="text-warning"
                />

                <PersonaCard
                  icon={<Scale className="w-5 h-5 text-whale" />}
                  title="المتوازن"
                  subtitle="متوسط (2-6 أسابيع)"
                  description="موجات الصعود المنظمة"
                  accentRing="border-whale/20"
                  accentBar="bg-whale"
                  stats={{
                    winRate: statsByPersona?.balanced?.winRate ?? 0,
                    profitFactor: statsByPersona?.balanced?.profitFactor ?? 0,
                    avgWinPct: statsByPersona?.balanced?.avgWinPct ?? 0,
                    wins: statsByPersona?.balanced?.wins ?? 0,
                    losses: statsByPersona?.balanced?.losses ?? 0,
                  }}
                  winRateColor="text-whale"
                />

                <PersonaCard
                  icon={<Shield className="w-5 h-5 text-profit" />}
                  title="المستثمر"
                  subtitle="استثماري (6-12 شهر)"
                  description="القيمة العادلة والأمان المالي"
                  accentRing="border-profit/20"
                  accentBar="bg-profit"
                  stats={{
                    winRate: statsByPersona?.conservative?.winRate ?? 0,
                    profitFactor: statsByPersona?.conservative?.profitFactor ?? 0,
                    avgWinPct: statsByPersona?.conservative?.avgWinPct ?? 0,
                    wins: statsByPersona?.conservative?.wins ?? 0,
                    losses: statsByPersona?.conservative?.losses ?? 0,
                  }}
                  winRateColor="text-profit"
                />
              </div>
            </div>

            {/* ═══ 6. MISSED OPPORTUNITIES ═══ */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                <h3 className="text-lg font-bold text-foreground">الفرص الضائعة والتحليل البعدي</h3>
                <Badge variant="outline" className="text-xs text-warning border-warning/20 bg-warning/10 whitespace-nowrap">
                  حد التحرك ≥ 10%
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <MissedOppCard
                  title="فرص ضاعت"
                  subtitle="قلنا بيع والسهم طلع"
                  icon={<TrendingUp className="w-5 h-5 text-warning" />}
                  accent="amber"
                  items={missedOpps?.missed_bulls}
                  loading={missedOppsLoading}
                />
                <MissedOppCard
                  title="توقعات خاطئة"
                  subtitle="قلنا شراء والسهم نزل"
                  icon={<TrendingDown className="w-5 h-5 text-loss" />}
                  accent="rose"
                  items={missedOpps?.false_positives}
                  loading={missedOppsLoading}
                />
                <MissedOppCard
                  title="توقعات صحيحة (شراء)"
                  subtitle="قلنا شراء والسهم طلع"
                  icon={<CheckCircle className="w-5 h-5 text-profit" />}
                  accent="emerald"
                  items={missedOpps?.correct_buys}
                  loading={missedOppsLoading}
                />
                <MissedOppCard
                  title="توقعات صحيحة (بيع)"
                  subtitle="قلنا بيع والسهم نزل"
                  icon={<CheckCircle className="w-5 h-5 text-whale" />}
                  accent="teal"
                  items={missedOpps?.correct_sells}
                  loading={missedOppsLoading}
                />
              </div>
            </div>

            {/* ═══ 7. Win/Loss Proportion Bar + Footer ═══ */}
            <div className="bg-card p-6 rounded-2xl border border-white/10 space-y-5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-foreground font-bold">توازن الأداء</span>
                <span className="text-profit font-bold">
                  {stats.wins} رابحة <span className="text-muted-foreground">/</span>{' '}
                  <span className="text-loss">{stats.losses} خاسرة</span>
                </span>
              </div>

              <div className="h-5 w-full bg-card rounded-full overflow-hidden flex border border-white/10">
                <div
                  className="h-full from-profit to-whale transition-all duration-1000 flex items-center justify-center"
                  style={{ width: `${winRate}%` }}
                >
                  {winRate > 15 && (
                    <span className="text-xs font-black text-profit px-2">
                      {(winRate ?? 0).toFixed(0)}% رابحة
                    </span>
                  )}
                </div>
                <div
                  className="h-full from-loss to-loss transition-all duration-1000 flex items-center justify-center"
                  style={{ width: `${100 - winRate}%` }}
                >
                  {100 - winRate > 15 && (
                    <span className="text-xs font-black text-foreground px-2">
                      {(100 - winRate).toFixed(0)}% خاسرة
                    </span>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 text-foreground">
                  <CheckCircle2 className="w-4 h-4 text-profit flex-shrink-0" />
                  <span className="text-xs sm:text-sm text-center md:text-right">
                    ملخص أداء التوقعات — {timeframeLabel}
                  </span>
                </div>
                <span className="font-mono text-xs text-muted-foreground flex-shrink-0">
                  {new Date().toLocaleDateString('ar-EG')}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
