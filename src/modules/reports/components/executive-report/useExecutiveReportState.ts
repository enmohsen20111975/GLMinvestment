/**
 * executive-report/useExecutiveReportState.ts
 * ============================================
 * Big state hook for ExecutiveReportView. Owns:
 *  - 12 useState slices (timeframe, loading, refreshing, data, exporting,
 *    missed-opps state, advanced filters, quality mode, confidence).
 *  - 2 useEffects (fetch main data + fetch missed opportunities).
 *  - fetchData + fetchMissedOpps useCallbacks.
 *  - All derived useMemo slices (cutoffTs, allPredictionsRaw, allPredictions,
 *    activeFilterCount, uniqueStocks, statsByStock, statsByPersonaPred,
 *    topGains, topLosses, fastestGains, outcomeDistribution,
 *    cumulativeProfitData, monthlyReturns, personaRadarData,
 *    trailingProfitCount, topTrailingProfit, reportShareText).
 *  - handleExportPng + resetFilters useCallbacks.
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 *
 * The container just calls `useExecutiveReportState({ market, initialDays })`
 * and renders the layout — zero logic in the JSX tree.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { computeStats, pickRepresentative } from './helpers';
import { DEFAULT_MIN_CONFIDENCE, TIMEFRAME_OPTIONS } from './constants';
import type {
  FilterOutcome,
  FilterPersona,
  FilterSignal,
  HonestListResponse,
  LivePredictionItem,
  LiveTrackingResponse,
  MissedOpportunitiesResponse,
  QualityMode,
  ReportTimeframe,
} from './types';

export interface UseExecutiveReportStateArgs {
  market: string;
  initialDays: ReportTimeframe;
}

export interface ExecutiveReportState {
  // ── raw state ──
  days: ReportTimeframe;
  setDays: (d: ReportTimeframe) => void;
  loading: boolean;
  refreshing: boolean;
  data: LiveTrackingResponse | null;
  exporting: boolean;
  missedOpps: MissedOpportunitiesResponse | null;
  missedOppsLoading: boolean;
  filterPersona: FilterPersona;
  setFilterPersona: (p: FilterPersona) => void;
  filterOutcome: FilterOutcome;
  setFilterOutcome: (o: FilterOutcome) => void;
  filterSignal: FilterSignal;
  setFilterSignal: (s: FilterSignal) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showFilters: boolean;
  setShowFilters: (b: boolean) => void;
  qualityMode: QualityMode;
  setQualityMode: (q: QualityMode) => void;
  minConfidence: number;
  setMinConfidence: (n: number) => void;
  activeFilterCount: number;
  // ── actions ──
  fetchData: () => Promise<void>;
  handleExportPng: () => Promise<void>;
  resetFilters: () => void;
  reportContainerRef: React.RefObject<HTMLDivElement>;
  // ── derived ──
  allPredictions: LivePredictionItem[];
  uniqueStocks: LivePredictionItem[];
  topGains: LivePredictionItem[];
  topLosses: LivePredictionItem[];
  fastestGains: LivePredictionItem[];
  topTrailingProfit: LivePredictionItem[];
  outcomeDistribution: Array<{ name: string; value: number; color: string }>;
  cumulativeProfitData: Array<{ label: string; cumulative: number; trade: number }>;
  monthlyReturns: Array<{ month: string; total: number; count: number; winRate: number }>;
  personaRadarData: Array<{
    axis: string;
    gambler: number;
    balanced: number;
    conservative: number;
  }>;
  trailingProfitCount: number;
  stats: ReturnType<typeof computeStats>;
  statsByPersona: ReturnType<typeof computeStats>['statsByPersona'];
  uniqueStockCount: number;
  totalPredictionCount: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  timeframeLabel: string;
  reportShareText: string;
}

export function useExecutiveReportState({
  market,
  initialDays,
}: UseExecutiveReportStateArgs): ExecutiveReportState {
  const [days, setDays] = useState<ReportTimeframe>(initialDays);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<LiveTrackingResponse | null>(null);
  const [exporting, setExporting] = useState(false);
  const [missedOpps, setMissedOpps] = useState<MissedOpportunitiesResponse | null>(null);
  const [missedOppsLoading, setMissedOppsLoading] = useState(false);

  // RL-FIX-7: فلاتر متقدمة (شخصية / نتيجة / إشارة / بحث)
  const [filterPersona, setFilterPersona] = useState<FilterPersona>('all');
  const [filterOutcome, setFilterOutcome] = useState<FilterOutcome>('ALL');
  const [filterSignal, setFilterSignal] = useState<FilterSignal>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // RL-FIX-10: فلترة الجودة — افتراضي 'top_picks' (أفضل 5/يوم) + minConfidence 70
  const [qualityMode, setQualityMode] = useState<QualityMode>('top_picks');
  const [minConfidence, setMinConfidence] = useState<number>(DEFAULT_MIN_CONFIDENCE);

  const reportContainerRef = useRef<HTMLDivElement>(null);

  // RL-FIX-8: بنجيب البيانات من /api/predictions/honest-tracking/list بدل
  // /api/stored-analysis/live-tracking. الـ endpoint ده بيرجع بيانات تاريخية كاملة.
  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams({
        market,
        limit: '2000',
        sortBy: 'prediction_date',
        sortOrder: 'DESC',
        qualityMode,
        minScore: String(minConfidence),
        topPerDay: qualityMode === 'top_picks' ? '5' : '0',
      });
      const res = await fetch(
        `/api/predictions/honest-tracking/list?${params.toString()}`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const json: HonestListResponse = await res.json();
        if (json.success && json.predictions) {
          const buckets: Record<'gambler' | 'balanced' | 'conservative', LivePredictionItem[]> = {
            gambler: [],
            balanced: [],
            conservative: [],
          };
          for (const p of json.predictions) {
            let persona: 'gambler' | 'balanced' | 'conservative' = 'balanced';
            const rawPersona = (p.persona || '').toLowerCase().trim();
            if (rawPersona === 'gambler') persona = 'gambler';
            else if (rawPersona === 'investor' || rawPersona === 'conservative')
              persona = 'conservative';
            else if (rawPersona === 'balanced') persona = 'balanced';

            // RL-FIX-16 (HONEST-WIN): WIN = actual_return > 0 (يتطابق مع Python API).
            let outcome: 'WIN' | 'LOSS' | 'EXPIRED' | 'PENDING' = 'PENDING';
            const status = (p.status || '').toUpperCase();
            const returnPct =
              p.actual_return != null
                ? Number(p.actual_return)
                : p.profit_loss_percent != null
                ? Number(p.profit_loss_percent)
                : 0;

            if (status === 'PENDING') {
              outcome = 'PENDING';
            } else if (returnPct > 0) {
              outcome = 'WIN';
            } else if (returnPct < 0) {
              outcome = 'LOSS';
            } else if (status === 'EXPIRED') {
              outcome = 'EXPIRED';
            } else if (status === 'STOPPED') {
              outcome = 'LOSS';
            } else if (
              status === 'TARGET_HIT' ||
              status === 'PROFIT_TAKEN' ||
              status === 'TRAILING_PROFIT'
            ) {
              outcome = 'LOSS';
            } else {
              outcome = 'LOSS';
            }

            const closedAt = p.evaluation_date || null;
            const entryDate =
              p.prediction_date || (p.created_at ? String(p.created_at).slice(0, 10) : '');

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
              currentPrice:
                p.final_price != null ? Number(p.final_price) : Number(p.entry_price || 0),
              outcome,
              returnPct,
              daysSinceEntry: daysSince,
              closedAt,
              exitPrice: p.final_price != null ? Number(p.final_price) : 0,
              maestroScore: p.maestro_score != null ? Number(p.maestro_score) : 0,
              confidence: p.confidence != null ? Number(p.confidence) : 0,
              exitType: p.exit_type || null,
              exit_type: p.exit_type || null,
              highestPriceReached:
                p.highest_price_reached != null ? Number(p.highest_price_reached) : null,
              lowestPriceReached:
                p.lowest_price_reached != null ? Number(p.lowest_price_reached) : null,
              highest_price_reached:
                p.highest_price_reached != null ? Number(p.highest_price_reached) : null,
              lowest_price_reached:
                p.lowest_price_reached != null ? Number(p.lowest_price_reached) : null,
              targetPrice2: p.target_price_2 != null ? Number(p.target_price_2) : null,
              target_price_2: p.target_price_2 != null ? Number(p.target_price_2) : null,
            };
            buckets[persona].push(item);
          }

          const transformed: LiveTrackingResponse = {
            success: true,
            predictions: buckets,
            stats: {
              total: 0,
              wins: 0,
              losses: 0,
              pending: 0,
              settled: 0,
              winRate: 0,
              avgWinPct: 0,
              avgLossPct: 0,
              profitFactor: 0,
              closedCount: 0,
            },
            statsByPersona: {
              gambler: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
              balanced: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
              conservative: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
            },
            last_updated: new Date().toISOString(),
            market,
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
  }, [market, qualityMode, minConfidence]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── الفرص الضائعة: fetch منفصل عن الـ main data ──
  const fetchMissedOpps = useCallback(async () => {
    setMissedOppsLoading(true);
    try {
      const params = new URLSearchParams({
        threshold: '10',
        limit: '8',
        market,
        dedupe: '1',
      });
      if (qualityMode === 'top_picks') {
        params.set('minScore', String(minConfidence));
      }
      if (days === 999) {
        const ytdStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
        params.set('since', ytdStart);
      } else if (days > 0) {
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        params.set('since', cutoff);
      }
      const res = await fetch(
        `/api/predictions/honest-tracking/missed-opportunities?${params.toString()}`,
        { cache: 'no-store' },
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
  }, [market, qualityMode, minConfidence, days]);

  useEffect(() => {
    fetchMissedOpps();
  }, [fetchMissedOpps]);

  // RL-FIX-7: 999 = YTD (من أول السنة) — Jan 1 من السنة الحالية
  const cutoffTs = useMemo(() => {
    if (days === 0) return 0; // كل الأوقات
    if (days === 999) {
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

    if (qualityMode === 'top_picks') {
      result = result.filter((p) => {
        const score = Number(p.confidence ?? p.maestroScore ?? 0);
        return score >= minConfidence;
      });
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
        kept.push(...group.slice(0, 5));
      }
      result = kept;
    }

    if (days !== 0) {
      result = result.filter((p) => {
        try {
          const dateStr = String(p.entryDate || '');
          if (!dateStr || dateStr === 'null' || dateStr === 'undefined' || dateStr === 'None')
            return false;
          const t = new Date(dateStr.replace(' ', 'T')).getTime();
          if (isNaN(t)) return false;
          return t >= cutoffTs;
        } catch {
          return false;
        }
      });
    }

    if (filterPersona !== 'all') {
      result = result.filter((p) => p.persona === filterPersona);
    }
    if (filterOutcome !== 'ALL') {
      result = result.filter((p) => p.outcome === filterOutcome);
    }
    if (filterSignal !== 'all') {
      result = result.filter((p) => {
        const sig = (p.signal || '').toUpperCase();
        if (filterSignal === 'BUY') return sig === 'BUY' || sig === 'STRONG_BUY';
        if (filterSignal === 'SELL') return sig === 'SELL' || sig === 'STRONG_SELL';
        return true;
      });
    }
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

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterPersona !== 'all') count++;
    if (filterOutcome !== 'ALL') count++;
    if (filterSignal !== 'all') count++;
    if (searchQuery.trim()) count++;
    if (qualityMode === 'all') count++;
    if (minConfidence !== DEFAULT_MIN_CONFIDENCE) count++;
    return count;
  }, [filterPersona, filterOutcome, filterSignal, searchQuery, qualityMode, minConfidence]);

  const resetFilters = useCallback(() => {
    setFilterPersona('all');
    setFilterOutcome('ALL');
    setFilterSignal('all');
    setSearchQuery('');
    setQualityMode('top_picks');
    setMinConfidence(DEFAULT_MIN_CONFIDENCE);
  }, []);

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

  const statsByStock = useMemo(() => computeStats(uniqueStocks), [uniqueStocks]);
  const statsByPersonaPred = useMemo(() => computeStats(allPredictions), [allPredictions]);

  const topGains = useMemo(() => {
    const closedWins = allPredictions.filter(
      (p) => p.outcome === 'WIN' && p.returnPct != null && Number(p.returnPct) > 0,
    );
    const sorted = [...closedWins].sort(
      (a, b) => Number(b.returnPct || 0) - Number(a.returnPct || 0),
    );
    const seen = new Set<string>();
    const deduped = sorted.filter((p) => {
      if (seen.has(p.ticker)) return false;
      seen.add(p.ticker);
      return true;
    });
    return deduped.slice(0, 4);
  }, [allPredictions]);

  const topLosses = useMemo(() => {
    const closedLosses = allPredictions.filter(
      (p) => p.outcome === 'LOSS' && p.returnPct != null && Number(p.returnPct) < 0,
    );
    const sorted = [...closedLosses].sort(
      (a, b) => Number(a.returnPct || 0) - Number(b.returnPct || 0),
    );
    const seen = new Set<string>();
    const deduped = sorted.filter((p) => {
      if (seen.has(p.ticker)) return false;
      seen.add(p.ticker);
      return true;
    });
    return deduped.slice(0, 4);
  }, [allPredictions]);

  const fastestGains = useMemo(() => {
    const closedWins = allPredictions.filter(
      (p) =>
        p.outcome === 'WIN' &&
        p.returnPct != null &&
        Number(p.returnPct) > 0 &&
        p.daysSinceEntry != null,
    );
    const sorted = [...closedWins].sort((a, b) => {
      const daysDiff = Number(a.daysSinceEntry || 99) - Number(b.daysSinceEntry || 99);
      if (daysDiff !== 0) return daysDiff;
      return Number(b.returnPct || 0) - Number(a.returnPct || 0);
    });
    const seen = new Set<string>();
    const deduped = sorted.filter((p) => {
      if (seen.has(p.ticker)) return false;
      seen.add(p.ticker);
      return true;
    });
    return deduped.slice(0, 4);
  }, [allPredictions]);

  const outcomeDistribution = useMemo(() => {
    const trailingProfit = uniqueStocks.filter((p) => {
      const et = (p.exitType || p.exit_type || '').toString().toLowerCase().trim();
      return et === 'trailing_profit';
    }).length;
    const winsAll = uniqueStocks.filter((p) => p.outcome === 'WIN').length;
    const wins = winsAll - trailingProfit;
    const losses = uniqueStocks.filter((p) => p.outcome === 'LOSS').length;
    const pending = uniqueStocks.filter((p) => p.outcome === 'PENDING').length;
    const expired = uniqueStocks.filter((p) => p.outcome === 'EXPIRED').length;
    return [
      { name: 'رابحة', value: wins, color: '#10b981' },
      { name: '💰 خرجت بربح', value: trailingProfit, color: '#2dd4bf' },
      { name: 'خاسرة', value: losses, color: '#f43f5e' },
      { name: 'معلقة', value: pending, color: '#f59e0b' },
      { name: 'منتهية', value: expired, color: '#64748b' },
    ].filter((d) => d.value > 0);
  }, [uniqueStocks]);

  const cumulativeProfitData = useMemo(() => {
    const closed = uniqueStocks
      .filter((p) => (p.outcome === 'WIN' || p.outcome === 'LOSS') && p.closedAt && p.returnPct != null)
      .map((p) => ({
        ticker: p.ticker,
        closedAt: p.closedAt as string,
        returnPct: Number(p.returnPct),
      }))
      .sort((a, b) => String(a.closedAt).localeCompare(String(b.closedAt)));
    let cum = 0;
    return closed.map((c) => {
      cum += c.returnPct;
      return {
        label: `${String(c.closedAt).slice(5, 10)} · ${c.ticker}`,
        cumulative: Math.round(cum * 100) / 100,
        trade: Math.round(c.returnPct * 100) / 100,
      };
    });
  }, [uniqueStocks]);

  const monthlyReturns = useMemo(() => {
    const monthMap: Record<string, { month: string; total: number; count: number; wins: number }> = {};
    for (const p of uniqueStocks) {
      if (p.outcome !== 'WIN' && p.outcome !== 'LOSS') continue;
      if (!p.closedAt || p.returnPct == null) continue;
      const d = new Date(String(p.closedAt).replace(' ', 'T'));
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = d.toLocaleDateString('ar-EG', { month: 'short', year: '2-digit' });
      if (!monthMap[key]) monthMap[key] = { month: monthLabel, total: 0, count: 0, wins: 0 };
      monthMap[key].total += Number(p.returnPct);
      monthMap[key].count += 1;
      if (p.outcome === 'WIN') monthMap[key].wins += 1;
    }
    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([, v]) => ({
        month: v.month,
        total: Math.round(v.total * 100) / 100,
        count: v.count,
        winRate: v.count > 0 ? Math.round((v.wins / v.count) * 100) : 0,
      }));
  }, [uniqueStocks]);

  const personaRadarData = useMemo(() => {
    const g = statsByPersonaPred.statsByPersona.gambler;
    const b = statsByPersonaPred.statsByPersona.balanced;
    const c = statsByPersonaPred.statsByPersona.conservative;
    return [
      {
        axis: 'نسبة النجاح',
        gambler: Math.round(g.winRate),
        balanced: Math.round(b.winRate),
        conservative: Math.round(c.winRate),
      },
      {
        axis: 'معامل الربحية',
        gambler: Math.round(Math.min(g.profitFactor, 5) * 20),
        balanced: Math.round(Math.min(b.profitFactor, 5) * 20),
        conservative: Math.round(Math.min(c.profitFactor, 5) * 20),
      },
      {
        axis: 'متوسط الربح',
        gambler: Math.round(Math.min(g.avgWinPct, 20) * 5),
        balanced: Math.round(Math.min(b.avgWinPct, 20) * 5),
        conservative: Math.round(Math.min(c.avgWinPct, 20) * 5),
      },
      {
        axis: 'عدد الصفقات',
        gambler: Math.round(Math.min(g.closedCount, 500) / 5),
        balanced: Math.round(Math.min(b.closedCount, 500) / 5),
        conservative: Math.round(Math.min(c.closedCount, 500) / 5),
      },
    ];
  }, [statsByPersonaPred]);

  const trailingProfitCount = useMemo(() => {
    return uniqueStocks.filter((p) => {
      const et = (p.exitType || p.exit_type || '').toString().toLowerCase().trim();
      return et === 'trailing_profit';
    }).length;
  }, [uniqueStocks]);

  const topTrailingProfit = useMemo(() => {
    const trailing = allPredictions.filter((p) => {
      const et = (p.exitType || p.exit_type || '').toString().toLowerCase().trim();
      return et === 'trailing_profit' && p.returnPct != null && Number(p.returnPct) > 0;
    });
    const sorted = [...trailing].sort(
      (a, b) => Number(b.returnPct || 0) - Number(a.returnPct || 0),
    );
    const seen = new Set<string>();
    const deduped = sorted.filter((p) => {
      if (seen.has(p.ticker)) return false;
      seen.add(p.ticker);
      return true;
    });
    return deduped.slice(0, 4);
  }, [allPredictions]);

  const handleExportPng = useCallback(async () => {
    if (!reportContainerRef.current) return;
    setExporting(true);
    toast.loading('جاري توليد صورة الملخص...', { id: 'report-export' });
    try {
      const dataUrl = await toPng(reportContainerRef.current, {
        cacheBust: true,
        quality: 0.98,
        pixelRatio: 2,
        backgroundColor: 'hsl(var(--card))',
      });
      const link = document.createElement('a');
      const timeLabel = TIMEFRAME_OPTIONS.find((t) => t.value === days)?.badge || `${days}d`;
      link.download = `GLM_Summary_${timeLabel}_${Date.now()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('تم استخراج الملخص كصورة', { id: 'report-export' });
    } catch (err) {
      console.error('[ExecutiveReport] Export failed:', err);
      toast.error('تعذّر استخراج الملخص كصورة', { id: 'report-export' });
    } finally {
      setExporting(false);
    }
  }, [days]);

  // ── Final derived values for the JSX ──
  const stats = statsByStock;
  const statsByPersona = statsByPersonaPred.statsByPersona;
  const uniqueStockCount = uniqueStocks.length;
  const totalPredictionCount = allPredictions.length;
  const winRate = stats.winRate;
  const profitFactor = stats.profitFactor;
  const totalTrades = stats.total;
  const timeframeLabel = TIMEFRAME_OPTIONS.find((t) => t.value === days)?.label || '';

  const reportShareText = useMemo(() => {
    const lines: string[] = [
      `📊 ملخص أداء التوقعات — ${market} · ${timeframeLabel}`,
      '',
      `إجمالي الصفقات: ${totalTrades}`,
      `نسبة النجاح: ${(winRate ?? 0).toFixed(1)}%`,
      `معامل الربحية: ${profitFactor >= 999 ? '∞' : (profitFactor ?? 0).toFixed(2)}`,
      `رابحة: ${stats.wins} / خاسرة: ${stats.losses} / معلقة: ${stats.pending}`,
      `صافي العائد: ${stats.totalProfit >= 0 ? '+' : ''}${(stats.totalProfit ?? 0).toFixed(2)}%`,
      '',
      '⚠️ لأغراض إعلامية فقط وليست نصيحة استثمارية.',
    ];
    return lines.join('\n');
  }, [market, timeframeLabel, totalTrades, winRate, profitFactor, stats]);

  return {
    days,
    setDays,
    loading,
    refreshing,
    data,
    exporting,
    missedOpps,
    missedOppsLoading,
    filterPersona,
    setFilterPersona,
    filterOutcome,
    setFilterOutcome,
    filterSignal,
    setFilterSignal,
    searchQuery,
    setSearchQuery,
    showFilters,
    setShowFilters,
    qualityMode,
    setQualityMode,
    minConfidence,
    setMinConfidence,
    activeFilterCount,
    fetchData,
    handleExportPng,
    resetFilters,
    reportContainerRef,
    allPredictions,
    uniqueStocks,
    topGains,
    topLosses,
    fastestGains,
    topTrailingProfit,
    outcomeDistribution,
    cumulativeProfitData,
    monthlyReturns,
    personaRadarData,
    trailingProfitCount,
    stats,
    statsByPersona,
    uniqueStockCount,
    totalPredictionCount,
    winRate,
    profitFactor,
    totalTrades,
    timeframeLabel,
    reportShareText,
  };
}

// Re-export cn for the container's className utility usage (optional helper).
export { cn };
