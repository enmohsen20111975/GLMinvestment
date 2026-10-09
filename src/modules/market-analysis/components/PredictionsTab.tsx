'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StockIconMini } from '@/modules/stock-analysis/components/StockIcon';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import {
  TrendingUp, TrendingDown, Clock, Calendar,
  BarChart3, Target, AlertTriangle, CheckCircle,
  Activity, ArrowUpRight, ArrowDownRight, Info,
  RefreshCw, Moon, Copy, Share2, ShieldCheck, ShieldX, Crosshair, Gauge, Facebook, ArrowRight, ArrowLeft,
  Bitcoin, Zap, Download, Image as ImageIcon, FileText, Camera, Loader2, X, Layers, Send
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { Radio, Radar } from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn, getRRVerdict, getStockRiskAlert, safeToFixed, verdictStyle, computeRR, rrColor, scoreColor, fmtPrice, formatNumber } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR, MARKET_CURRENCY_LABEL, MarketType } from '@/lib/store';
import { useAnalysisStore } from '@/lib/analysis-store';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK, OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

import { isBuySignalLabel, isSellSignalLabel } from '@/lib/signal-utils';
import { PersonaImageCard, PersonaPick } from '@/components/market/PersonaImageCard';
import { ExpertPredictionsImageCard } from '@/components/market/ExpertPredictionsImageCard';
import { PredictionsImageCard } from '@/components/market/PredictionsImageCard';
import { ImageCardExport } from '@/components/market/ImageCardExport';
import { MarketStatusExport } from '@/components/market/MarketStatusExport';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
import { ExpertRecommendationsPanel } from '@/modules/market-analysis/components/ExpertRecommendationsPanel';
import { ExpertIntelligencePanel } from '@/components/shared/ExpertIntelligencePanel';
import { DailyPicksPoster } from '@/components/daily-picks/DailyPicksPoster';
import type {
  StockData,
  LifecycleStatus,
  StatusBadgeStyle,
  PreviousPrediction,
  PersonaData,
  AnalysisJson,
  StoredAnalysisItem,
  NameMap,
  CryptoPrediction,
  CryptoPredictionsResponse,
  SectorTrackingStock,
  SectorTrackingEntry,
  SectorTrackingResponse,
  SectorSortField,
  SectorStockSortField,
  MorningBellStock,
  PredictionRow,
} from './types';
import {
  pickValidPrice,
  getStatusBadge,
  pnlColorClass,
  formatPnl,
  formatChangePct,
  formatDateShort,
  mapPredictionToStockData,
  MARKET_CODES,
  isMarketClosedNow,
  getNextTradingDay,
  formatDateLabel,
  formatAllPredictionsText,
  formatSinglePredictionText,
  formatSinglePersonaPickText,
  formatAllPersonaPicksText,
  formatComprehensiveStockText,
  formatSingleExpertPredictionText,
  formatAllExpertPredictionsText,
  isTraderPrediction,
  evalPrediction,
  buildNameMap,
  enrichItems,
  pickPersonaMix,
  pickPersonaDiverged,
  getVerdictColor,
  getScoreColor,
  PERSONA_DISPLAY_LIMIT,
  PERSONA_PAGE_SIZE,
  usdCurrencyFmt,
  arDateTimeFmt,
  cryptoSignalStyle,
  cryptoSignalLabelAr,
  cryptoSymbolMeta,
  HEAT_LEVEL_STYLE,
  formatVolumeShort,
  formatEGPShort,
  avgChangeHeatClass,
  stockChangeHeatClass,
  _isEgxIntradayNow,
} from './helpers';


function PredictionsPerformanceChart({ stocks }: { stocks: StockData[] }) {
  const chartData = React.useMemo(() => {
    const dateMap = new Map<string, { date: string; hits: number; stopped: number; active: number; totalPnl: number; count: number }>();

    stocks.forEach((s) => {
      let rawDate = s.prediction_date || s.target_hit_date || 'اليوم';
      let dateKey = 'اليوم';
      if (rawDate && rawDate !== 'اليوم') {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          dateKey = `${d.getMonth() + 1}/${d.getDate()}`;
        }
      }

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { date: dateKey, hits: 0, stopped: 0, active: 0, totalPnl: 0, count: 0 });
      }
      const item = dateMap.get(dateKey)!;
      item.count += 1;

      const pnl = s.profit_loss_percent !== null && s.profit_loss_percent !== undefined
        ? s.profit_loss_percent
        : s.entry_price && s.current_price && s.entry_price > 0
        ? ((s.current_price - s.entry_price) / s.entry_price) * 100
        : 0;
      item.totalPnl += pnl;

      const isHit = s.status === 'TARGET_HIT' || s.status === 'CLOSED_PROFIT' || s.hit_target;
      const isStopped = s.status === 'STOPPED' || s.status === 'CLOSED_LOSS' || s.hit_stop_loss;

      if (isHit) item.hits += 1;
      else if (isStopped) item.stopped += 1;
      else item.active += 1;
    });

    return Array.from(dateMap.values()).map(d => ({
      ...d,
      avgPnl: d.count > 0 ? Number((d.totalPnl / d.count).toFixed(2)) : 0,
    }));
  }, [stocks]);

  if (chartData.length === 0) return null;

  return (
    <Card className="border border-teal-200 dark:border-teal-900 bg-card p-4 my-2 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-extrabold text-sm text-teal-800 dark:text-teal-300 flex items-center gap-2">
          📊 الأداء التراكمي وتوزيع الصفقات حسب الأيام
        </h4>
        <span className="text-xs text-muted-foreground font-mono">تتبع تلقائي لمعدلات الأرباح والتوقعات الصادرة</span>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
              formatter={(val: any, name: string) => {
                if (name === 'hits') return [`${val} صفقة`, '🎯 حققت الهدف'];
                if (name === 'stopped') return [`${val} صفقة`, '🛑 ضربت الوقف'];
                if (name === 'active') return [`${val} صفقة`, '⏳ صفقة مستمرة'];
                if (name === 'avgPnl') return [`${val}%`, '📈 متوسط الربح المئوي'];
                return [val, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
            <Bar dataKey="hits" name="حققت الهدف 🎯" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="stopped" name="ضربت الوقف 🛑" fill="#ef4444" radius={[4, 4, 0, 0]} />
            <Bar dataKey="active" name="صفقة مستمرة ⏳" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ============================================================================


function ProofPredictionsTableView({
  stocks,
}: {
  stocks: StockData[];
}) {
  const currencyLabel = MARKET_CURRENCY_LABEL[useAppStore.getState().currentMarket] || "ج.م";
  const storeStocks = useAnalysisStore((state) => state.stocks) || [];

  const stocksMap = React.useMemo(() => {
    const map = new Map<string, any>();
    storeStocks.forEach((s) => {
      if (s.ticker) {
        const clean = s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
        map.set(clean, s);
        map.set(s.ticker.toUpperCase(), s);
      }
    });
    return map;
  }, [storeStocks]);

  const loadStockDetail = useAnalysisStore((state) => state.loadStockDetail);

  if (stocks.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center text-muted-foreground">
          <Info className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="font-semibold">لا توجد صفقات مطابقة للفلاتر المختارة حالياً</p>
          <p className="text-xs mt-1 text-muted-foreground">جرّب تغيير التصفية أو الفئة لتبديل العرض</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-teal-200 dark:border-teal-900 bg-card shadow-sm">
      <table className="w-full text-sm min-w-[1180px] border-collapse">
        <thead className="bg-gradient-to-r from-teal-500/10 via-emerald-500/10 to-teal-500/10 text-foreground font-semibold border-b border-teal-200 dark:border-teal-900">
          <tr>
            <th className="p-3 text-center font-medium w-12">#</th>
            <th className="p-3 text-right font-medium">السهم والرمز</th>
            <th className="p-3 text-center font-medium">نوع الصفقة</th>
            <th className="p-3 text-center font-medium">تاريخ التوقع</th>
            <th className="p-3 text-center font-medium">سعر الدخول</th>
            <th className="p-3 text-center font-medium">الهدف والوقف</th>
            <th className="p-3 text-center font-medium whitespace-nowrap">أعلى وأقل سعر<br/><span className="text-[10px] text-muted-foreground font-normal">منذ التوقع</span></th>
            <th className="p-3 text-center font-medium">نسبة الربح / الخسارة</th>
            <th className="p-3 text-center font-medium">نتيجة وحالة التوقع</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {stocks.map((stock, i) => {
            const cleanTicker = stock.ticker ? stock.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
            const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(stock.ticker?.toUpperCase());
            const { isHit, isStopped, pnl, currentPrice, entryPrice, targetPrice, stopLoss, targetPct, isTrader, maxHigh, minLow, maxHighUsed, minLowUsed, bestPotentialPnl } = evalPrediction(stock, liveStock);

            const displayDate = stock.prediction_date
              ? formatDateShort(stock.prediction_date)
              : 'اليوم';

            // P6-PREDICTIONS: هل الحالة مبنية على المسار التاريخي؟
            const pathBased = maxHighUsed || minLowUsed;

            return (
              <tr
                key={stock.id || `proof-${stock.ticker}-${i}`}
                className={cn(
                  "hover:bg-teal-50/40 dark:hover:bg-teal-950/20 transition-colors cursor-pointer",
                  isHit ? "bg-emerald-50/20 dark:bg-emerald-950/10" : isStopped ? "bg-rose-50/10 dark:bg-rose-950/10" : ""
                )}
                onClick={() => loadStockDetail(stock.ticker)}
              >
                <td className="p-3 text-center font-mono text-xs text-muted-foreground">{i + 1}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <StockIconMini
                      ticker={cleanTicker}
                      name={stock.name_ar || stock.name}
                      sector={stock.sector || liveStock?.sector}
                      logoUrl={stock.logo_url || liveStock?.logo_url}
                      className="w-7 h-7"
                    />
                    <div>
                      <p className="font-bold text-foreground leading-none">{stock.name_ar || stock.name}</p>
                      <span className="font-mono text-xs text-muted-foreground">{stock.ticker}</span>
                    </div>
                  </div>
                </td>
                <td className="p-3 text-center whitespace-nowrap">
                  {isTrader ? (
                    <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 gap-1 py-0.5 px-2 text-[11px] font-bold">
                      ⚡ مضارب
                    </Badge>
                  ) : (
                    <Badge className="bg-teal-100 text-teal-700 dark:bg-slate-900 dark:text-teal-300 border border-teal-300 gap-1 py-0.5 px-2 text-[11px] font-bold">
                      📊 مستثمر
                    </Badge>
                  )}
                </td>
                <td className="p-3 text-center font-mono text-xs text-muted-foreground whitespace-nowrap">
                  {displayDate}
                </td>
                <td className="p-3 text-center font-mono font-semibold text-foreground">
                  {entryPrice ? `${(entryPrice ?? 0).toFixed(2)} ${currencyLabel}` : '—'}
                </td>
                <td className="p-3 text-center font-mono text-xs whitespace-nowrap">
                  <div className="text-emerald-600 dark:text-emerald-400 font-semibold">🎯 {targetPrice ? (targetPrice ?? 0).toFixed(2) : '—'} ({targetPct}%)</div>
                  <div className="text-rose-500 font-normal text-[11px]">🛑 {stopLoss ? (stopLoss ?? 0).toFixed(2) : '—'}</div>
                </td>
                {/* أعلى وأقل سعر منذ التوقع */}
                <td className="p-3 text-center font-mono text-xs whitespace-nowrap">
                  <div className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    ▲ {maxHigh > 0 ? (maxHigh ?? 0).toFixed(2) : (liveStock?.high_price ? (liveStock.high_price ?? 0).toFixed(2) : (currentPrice ? (currentPrice ?? 0).toFixed(2) : '—'))}
                  </div>
                  <div className="text-rose-600 dark:text-rose-400 font-semibold">
                    ▼ {minLow > 0 ? (minLow ?? 0).toFixed(2) : (liveStock?.low_price ? (liveStock.low_price ?? 0).toFixed(2) : (currentPrice ? (currentPrice ?? 0).toFixed(2) : '—'))}
                  </div>
                </td>
                <td className="p-3 text-center font-mono">
                  <span className={cn(
                    "inline-block px-2.5 py-1 rounded-md font-bold text-xs",
                    pnl > 0 ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300" :
                    pnl < 0 ? "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300" :
                    "bg-gray-100 text-gray-700"
                  )}>
                    {pnl > 0 ? `+${(pnl ?? 0).toFixed(2)}%` : `${(pnl ?? 0).toFixed(2)}%`}
                  </span>
                  {/* P6-PREDICTIONS: "best potential" للصفقات النشطة */}
                  {bestPotentialPnl !== null && bestPotentialPnl > 0 && (
                    <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                      قمة: +{(bestPotentialPnl ?? 0).toFixed(2)}%
                    </div>
                  )}
                </td>
                <td className="p-3 text-center whitespace-nowrap">
                  {isHit ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 py-1 px-2.5 text-xs font-bold">
                      🎯 صفقة مكتملة (تم تحقيق الهدف)
                    </Badge>
                  ) : isStopped ? (
                    <Badge variant="destructive" className="gap-1 py-1 px-2.5 text-xs font-bold">
                      🛑 ضربت وقف الخسارة
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-teal-500 text-teal-700 dark:text-teal-300 bg-teal-50/50 dark:bg-teal-950/30 gap-1 py-1 px-2.5 text-xs font-bold">
                      ⏳ صفقة مستمرة (جارية)
                    </Badge>
                  )}
                  {/* P6-PREDICTIONS: وسم "مبنية على المسار" لما الحالة تُحدد بالقيم التاريخية */}
                  {pathBased && (
                    <div className="mt-1">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-900">
                        مبنية على المسار
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// P6-PREDICTIONS: PreviousPredictionsArchive — أرشيف التوقعات السابقة
// ============================================================================
// مكوّن مستقل بيُعرض التوقعات السابقة بحالاتها (✅ تم الهدف / ❌ ضرب وقف / ⏳ معلقة).
// اتسحب من PredictionsTab عشان يتعرض في تبويبات المستثمر والمضارب بدل ما
// يزدحم في التبويب العام. بيقبل قائمة previousPredictions + title اختياري.
// ============================================================================


export function PreviousPredictionsArchive({
  predictions,
  title = 'توقعات سابقة',
}: {
  predictions: PreviousPrediction[];
  title?: string;
}) {
  if (!predictions || predictions.length === 0) return null;

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📋</span>
          <h3 className="font-bold text-base">{title}</h3>
          <Badge variant="secondary">{predictions.length}</Badge>
          <span className="text-xs text-muted-foreground hidden sm:inline">— توقعات تم إصدارها سابقاً وحالتها الحالية</span>
        </div>
        <div className="max-h-96 overflow-y-auto rounded-md border border-border table-mobile-scroll">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr className="text-right text-xs text-muted-foreground">
                <th className="p-2 font-medium">السهم</th>
                <th className="p-2 font-medium">الإشارة</th>
                <th className="p-2 font-medium hidden sm:table-cell">الدخول</th>
                <th className="p-2 font-medium hidden sm:table-cell">الهدف</th>
                {/* P6-PREDICTIONS: عمودان جديدان للقيم التاريخية */}
                <th className="p-2 font-medium hidden md:table-cell">أعلى سعر</th>
                <th className="p-2 font-medium hidden md:table-cell">أقل سعر</th>
                <th className="p-2 font-medium">الحالة</th>
                <th className="p-2 font-medium">العائد</th>
                <th className="p-2 font-medium hidden md:table-cell">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((p, i) => {
                const statusColor =
                  p.status === 'TARGET_HIT'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-300'
                    : p.status === 'TRAILING_PROFIT'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300'
                    : p.status === 'STOPPED'
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-300'
                    : p.status === 'EXPIRED'
                    ? 'bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300 border-slate-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300';
                const ret = p.actual_return;
                const retColor = ret === null || ret === undefined
                  ? 'text-muted-foreground'
                  : ret >= 0 ? 'text-green-600' : 'text-red-600';
                const dateStr = p.prediction_date
                  ? (typeof p.prediction_date === 'string' ? p.prediction_date.slice(5, 10) : '')
                  : '';
                const sigColor: Record<string, string> = {
                  'STRONG_BUY': 'bg-emerald-500', 'BUY': 'bg-green-500', 'ACCUMULATE': 'bg-teal-500',
                  'HOLD': 'bg-gray-500', 'REDUCE': 'bg-orange-500', 'SELL': 'bg-red-500', 'STRONG_SELL': 'bg-red-700',
                };
                // P6-PREDICTIONS: قراءة القيم التاريخية بأمان (alias fallback)
                const entryVal = Number(p.entry_price || p.current_price || 0);
                const maxHigh = Number(p.max_high_since_pred ?? p.highest_price_reached ?? p.high_price ?? entryVal) || entryVal;
                const minLow = Number(p.min_low_since_pred ?? p.lowest_price_reached ?? p.low_price ?? entryVal) || entryVal;
                return (
                  <tr key={(p.ticker || '') + '-' + i} className="border-t border-border hover:bg-muted/40">
                    <td className="p-2 font-bold">{p.ticker}</td>
                    <td className="p-2">
                      <span className={cn('inline-block px-1.5 py-0.5 rounded text-xs text-white', sigColor[p.signal || ''] || 'bg-gray-500')}>
                        {p.signal_ar || p.signal}
                      </span>
                    </td>
                    <td className="p-2 hidden sm:table-cell">{entryVal > 0 ? (entryVal ?? 0).toFixed(2) : '—'}</td>
                    <td className="p-2 hidden sm:table-cell">{p.target_price ? Number(p.target_price).toFixed(2) : '—'}</td>
                    {/* P6-PREDICTIONS: القيم التاريخية */}
                    <td className="p-2 hidden md:table-cell font-mono text-xs">
                      {maxHigh > 0
                        ? <span className="text-emerald-600 dark:text-emerald-400">▲ {Number(maxHigh).toFixed(2)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 hidden md:table-cell font-mono text-xs">
                      {minLow > 0
                        ? <span className="text-rose-600 dark:text-rose-400">▼ {Number(minLow).toFixed(2)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2">
                      <span className={cn('inline-block px-2 py-0.5 rounded text-xs border', statusColor)}>
                        {p.status_ar || p.status}
                      </span>
                    </td>
                    <td className={cn('p-2 font-medium', retColor)}>
                      {ret === null || ret === undefined
                        ? '—'
                        : <span className="inline-flex items-center gap-1">
                            <span>{ret >= 0 ? '+' : ''}{Number(ret).toFixed(1)}%</span>
                            {p.is_live_return && (
                              <span className="text-[9px] text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700 rounded px-1" title="عائد لحظي — الصفقة لسه مفتوحة">
                                معاينة
                              </span>
                            )}
                          </span>}
                    </td>
                    <td className="p-2 hidden md:table-cell text-muted-foreground text-xs">{dateStr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}


export function PredictionsTab({ market }: { market: MarketType }) {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [closedStocks, setClosedStocks] = useState<StockData[]>([]);
  // ROBO-ADVISOR-P1: أرشيف التوقعات السابقة بحالاتها (✅/❌/⏳)
  const [previousPredictions, setPreviousPredictions] = useState<any[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    closed_count: number;
    win_count: number;
    loss_count: number;
    win_rate: number;
    avg_pnl: number;
    by_status?: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // إعدادات واجهة إثبات النتائج والتصفية المتقدمة
  const [viewMode, setViewMode] = useState<'table' | 'chart' | 'image'>('table');
  const [personaFilter, setPersonaFilter] = useState<'all' | 'investor' | 'trader'>('all');
  const [timeFrame, setTimeFrame] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [filterType, setFilterType] = useState<'smart' | 'successful' | 'completed' | 'stopped' | 'active' | 'all'>('all');

  const fetchPredictions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];
      const res = await fetch(`/api/unified/predictions?market=${marketCode}&limit=5`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        const predictions = Array.isArray(data.predictions) ? data.predictions : [];
        const closedPredictions = Array.isArray(data.closed_predictions) ? data.closed_predictions : [];

        const openMapped: StockData[] = predictions.map((p: any) => mapPredictionToStockData(p));
        const closedMapped: StockData[] = closedPredictions.map((p: any) => mapPredictionToStockData(p));

        setStocks(openMapped);
        setClosedStocks(closedMapped);
        // ROBO-ADVISOR-P1: التقاط أرشيف التوقعات السابقة من العقل
        setPreviousPredictions(Array.isArray(data.previous_predictions) ? data.previous_predictions : []);
        if (data.stats) {
          setStats({
            total: Number(data.stats.total) || 0,
            closed_count: Number(data.stats.closed_count) || 0,
            win_count: Number(data.stats.win_count) || 0,
            loss_count: Number(data.stats.loss_count) || 0,
            win_rate: Number(data.stats.win_rate) || 0,
            avg_pnl: Number(data.stats.avg_pnl) || 0,
            by_status: data.stats.by_status,
          });
        }
      } else {
        setError('فشل في تحميل التوقعات');
      }
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    fetchPredictions();
    // 🔥 P14: polling بيتوقف لو liveMode مش مفعّل (افتراضي). المستخدم يفعّله يدوياً.
    const interval = setInterval(() => {
      if (!useAnalysisStore.getState().liveMode) return;
      fetchPredictions();
    }, 300_000);
    return () => clearInterval(interval);
  }, [market, fetchPredictions]);

  // دمج كافة التوقعات (المفتوحة والمغلقة)
  const allCombinedStocks = useMemo(() => [...stocks, ...closedStocks], [stocks, closedStocks]);

  const storeStocks = useAnalysisStore((state) => state.stocks) || [];

  const stocksMap = React.useMemo(() => {
    const map = new Map<string, any>();
    storeStocks.forEach((s) => {
      if (s.ticker) {
        const clean = s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
        map.set(clean, s);
        map.set(s.ticker.toUpperCase(), s);
      }
    });
    return map;
  }, [storeStocks]);

  // 1. تصفية حسب السوق والنطاق الزمني والفئة (المستثمر vs المضارب) فقط للنسبة الإجمالية
  const scopeStocks = useMemo(() => {
    const now = new Date();
    return allCombinedStocks.filter((stock) => {
      const cleanTicker = stock.ticker ? stock.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
      const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(stock.ticker?.toUpperCase());
      const evalRes = evalPrediction(stock, liveStock);

      // تصفية الفئة (المستثمر vs المضارب)
      if (personaFilter === 'trader' && !evalRes.isTrader) return false;
      if (personaFilter === 'investor' && evalRes.isTrader) return false;

      // تصفية النطاق الزمني (اليوم / الأسبوع / الشهر)
      if (timeFrame !== 'all' && stock.prediction_date) {
        const predDate = new Date(stock.prediction_date);
        if (!isNaN(predDate.getTime())) {
          const diffMs = now.getTime() - predDate.getTime();
          const diffDays = diffMs / (1000 * 60 * 60 * 24);

          if (timeFrame === 'today' && diffDays > 1.5) return false;
          if (timeFrame === 'week' && diffDays > 7.5) return false;
          if (timeFrame === 'month' && diffDays > 30.5) return false;
        }
      }

      return true;
    });
  }, [allCombinedStocks, personaFilter, timeFrame, stocksMap]);

  // 2. حساب نسبة الدقة التراكمية الإجمالية المستقلة عن فلاتر العرض الفرعية (بين المكسب والخسارة)
  const dynamicTotal = scopeStocks.length;

  const dynamicHits = useMemo(() => {
    return scopeStocks.filter((s) => {
      const cleanTicker = s.ticker ? s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
      const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(s.ticker?.toUpperCase());
      return evalPrediction(s, liveStock).isHit;
    }).length;
  }, [scopeStocks, stocksMap]);

  const dynamicStopped = useMemo(() => {
    return scopeStocks.filter((s) => {
      const cleanTicker = s.ticker ? s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
      const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(s.ticker?.toUpperCase());
      return evalPrediction(s, liveStock).isStopped;
    }).length;
  }, [scopeStocks, stocksMap]);

  // نسبة دقة التوقعات المباشرة = (عدد الصفقات التي حققت الهدف / إجمالي صفقات النطاق المالي) × 100
  const dynamicWinRate = useMemo(() => {
    if (dynamicTotal > 0) return (dynamicHits / dynamicTotal) * 100;
    return 0;
  }, [dynamicHits, dynamicTotal]);

  const dynamicAvgPnl = useMemo(() => {
    if (dynamicTotal === 0) return 0;
    let sum = 0;
    scopeStocks.forEach((s) => {
      const cleanTicker = s.ticker ? s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
      const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(s.ticker?.toUpperCase());
      sum += evalPrediction(s, liveStock).pnl;
    });
    return sum / dynamicTotal;
  }, [scopeStocks, dynamicTotal, stocksMap]);

  // 3. تصفية جدول العرض السفلي حسب زر حالة الصفقة (filterType)
  const filteredCombinedStocks = useMemo(() => {
    return scopeStocks.filter((stock) => {
      const cleanTicker = stock.ticker ? stock.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
      const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(stock.ticker?.toUpperCase());
      const evalRes = evalPrediction(stock, liveStock);

      if (filterType === 'successful') return evalRes.isHit;
      if (filterType === 'completed') return evalRes.isHit || evalRes.isStopped;
      if (filterType === 'stopped') return evalRes.isStopped;
      if (filterType === 'active') return evalRes.isActive;

      return true; // 'all' or 'smart'
    });
  }, [scopeStocks, filterType, stocksMap]);

  if (loading && stocks.length === 0 && closedStocks.length === 0) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (error && stocks.length === 0 && closedStocks.length === 0) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-4 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchPredictions}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  const shareCaptionWithLinks = `📈 إثبات صحة وتوثيق نتائج توقعات المنصة — ${MARKET_NAMES_AR[market] || market}\n` + OFFICIAL_LINKS_BLOCK;

  return (
    <div className="space-y-4">
      {/* 📢 ترويسة التوثيق وإثبات مصداقية التوقعات */}
      <Card className="border-2 border-teal-500/30 bg-gradient-to-r from-teal-50 via-emerald-50 to-teal-50 dark:from-teal-950/40 dark:via-emerald-950/40 dark:to-teal-950/40 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-extrabold text-lg text-teal-800 dark:text-teal-300 flex items-center gap-2">
                🏆 نتائج ودقة التوقعات الفنية والمالية المتقدمة — {MARKET_NAMES_AR[market] || market}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                توثيق تلقائي مباشر للنتائج والأرباح المحققة لكافة الصفقات والتوقعات الصادرة عن المنصة
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchPredictions} className="gap-1.5 border-teal-400 text-teal-700 dark:text-teal-300">
              <RefreshCw className="h-3.5 w-3.5" />
              تحديث النتائج المباشرة
            </Button>
          </div>

          {/* شريط الإحصائيات التراكمية الحية (يتغير ديناميكياً مع الفلاتر) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center pt-1">
            <div className="rounded-lg bg-white/70 dark:bg-black/30 p-2.5 border border-teal-100 dark:border-teal-900">
              <p className="text-xs text-muted-foreground mb-0.5">إجمالي الصفقات المحددة</p>
              <p className="text-xl font-extrabold text-teal-700 dark:text-teal-300">{dynamicTotal}</p>
            </div>
            <div className="rounded-lg bg-white/70 dark:bg-black/30 p-2.5 border border-emerald-100 dark:border-emerald-900">
              <p className="text-xs text-muted-foreground mb-0.5">صفقات حققت الهدف 🎯</p>
              <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{dynamicHits}</p>
            </div>
            <div className="rounded-lg bg-white/70 dark:bg-black/30 p-2.5 border border-emerald-100 dark:border-emerald-900">
              <p className="text-xs text-muted-foreground mb-0.5">نسبة دقة التوقعات</p>
              <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                {(dynamicWinRate ?? 0).toFixed(0)}%
              </p>
            </div>
            <div className="rounded-lg bg-white/70 dark:bg-black/30 p-2.5 border border-teal-100 dark:border-teal-900">
              <p className="text-xs text-muted-foreground mb-0.5">متوسط العائد المئوي</p>
              <p className={cn("text-xl font-extrabold", pnlColorClass(dynamicAvgPnl))}>
                {formatPnl(dynamicAvgPnl)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 🎛️ شريط الفلاتر الذكية والتقسيمات (الفئة + الوقت + حالة الصفقة) */}
      <div className="space-y-2 bg-muted/30 p-3 rounded-xl border border-border">
        {/* الصف الأول: تصفية المستثمر والخصائص + النطاق الزمني */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* تصفية المستثمر vs المضارب */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-teal-800 dark:text-teal-200 ml-1">فئة التوقعات:</span>
            {([
              ['all', '🌐 جميع الصفقات'],
              ['investor', '📊 توقعات المستثمر'],
              ['trader', '⚡ توقعات المضارب'],
            ] as const).map(([p, label]) => (
              <Button
                key={p}
                variant={personaFilter === p ? 'default' : 'outline'}
                size="sm"
                className={cn("h-8 text-xs px-3 font-semibold", personaFilter === p ? "bg-teal-700 text-white hover:bg-teal-800" : "")}
                onClick={() => setPersonaFilter(p)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* التقسيم الزمني: أيام، أسابيع، شهور، الكل */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground ml-1">الوقت:</span>
            {([
              ['all', 'الكل'],
              ['today', '📅 اليوم'],
              ['week', '🗓️ هذا الأسبوع'],
              ['month', '📆 هذا الشهر'],
            ] as const).map(([tf, label]) => (
              <Button
                key={tf}
                variant={timeFrame === tf ? 'secondary' : 'ghost'}
                size="sm"
                className={cn("h-8 text-xs px-2.5", timeFrame === tf ? "font-bold bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200" : "")}
                onClick={() => setTimeFrame(tf)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* أزرار نمط العرض (جدول / رسم بياني / صورة للنشر) */}
          <div className="inline-flex rounded-md border border-border p-0.5 bg-background">
            {([['table', 'جدول'], ['chart', 'رسم بياني 📊'], ['image', 'صورة للنشر 🖼️']] as const).map(([m, l]) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={cn(
                  'px-3 py-1 text-xs rounded font-medium transition-colors',
                  viewMode === m ? 'bg-teal-600 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* الصف الثاني: تصفية النتيجة والحالة (مكتملة / جارية / ناجحة / ضربت الوقف) */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border/50">
          <span className="text-xs font-semibold text-muted-foreground ml-1">حالة التوقع:</span>
          {([
            ['smart', '💡 التصفية الذكية'],
            ['successful', '🎯 الناجحة فقط'],
            ['completed', '🏁 الصفقات المكتملة'],
            ['active', '⏳ المستمرة (قيد الانتظار)'],
            ['stopped', '🛑 الصفقات الخاسرة (ضربت الوقف)'],
            ['all', '📋 عرض الجميع'],
          ] as const).map(([ft, label]) => (
            <Button
              key={ft}
              variant={filterType === ft ? 'default' : 'outline'}
              size="sm"
              className={cn(
                "h-7 text-xs px-2.5 rounded-full transition-all",
                filterType === ft ? "bg-emerald-600 text-white font-bold" : "text-muted-foreground"
              )}
              onClick={() => setFilterType(ft)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* 📊 عرض المحتوى حسب النمط المختار */}
      {viewMode === 'table' ? (
        <ProofPredictionsTableView
          stocks={filteredCombinedStocks}
        />
      ) : viewMode === 'chart' ? (
        <PredictionsPerformanceChart stocks={filteredCombinedStocks} />
      ) : (
        <ImageCardExport
          title="بطاقة نتائج التوقعات الفنية الرسمية"
          description="حمّل صورة إثبات نتائج التوقعات متضمنة الروابط الرسمية جاهزة للنشر الفوري"
          filename={`predictions-proof-${MARKET_CODES[market]}`}
          telegramCaption={shareCaptionWithLinks}
          telegramMarket={MARKET_CODES[market]}
          accentColor="#0d9488"
          borderClass="border-teal-200"
          bgClass="bg-gradient-to-br from-teal-50 via-emerald-50 to-teal-100/40"
          hasData={filteredCombinedStocks.length > 0}
          emptyHint="لا توجد توقعات متاحة حالياً"
        >
          {(ref) => (
            <PredictionsImageCard
              ref={ref}
              market={market}
              stocks={filteredCombinedStocks}
              winRate={dynamicWinRate}
              avgPnl={dynamicAvgPnl}
              hits={dynamicHits}
              lastUpdate={filteredCombinedStocks[0]?.prediction_date ? new Date(filteredCombinedStocks[0].prediction_date).toLocaleTimeString('ar-EG') : undefined}
            />
          )}
        </ImageCardExport>
      )}

      {/* P6-PREDICTIONS: أرشيف التوقعات السابقة اتنقل لتبويبات المستثمر والمضارب */}
      <div className="text-center text-xs text-muted-foreground py-3 border-t border-border/40 mt-2">
        💡 لعرض التوقعات السابقة، راجع تبويب المستثمر أو المضارب
      </div>
    </div>
  );
}

// ============================================================================
// Expert Predictions Tab - توقعات الخبراء
// ============================================================================


