'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { Target, Layers, Trophy, RefreshCw, Brain, Sparkles } from 'lucide-react';

// ============================================================================
// NetPicksTab — صافى التوقعات (مجمع من كل مسارات الرادار)
// + تحليل Hybrid Stage Analyzer v2 (تحت التجربة)
// ============================================================================

interface NetPick {
  rank: number;
  ticker: string;
  current_price: number;
  source_path: string;
  source_label: string;
  source_rank: number;
  accumulation: string;
  maker_activity: string;
  volume_ratio: number;
  avg_turnover: number;
  roc_10d: number;
  signal_count: number;
  max_signals: number;
  position_size: number;
  reason: string;
  prediction: {
    entry_price: number;
    target_price: number;
    target_price_2: number;
    stop_loss: number;
    signal: string;
    confidence: number;
    risk_reward: number;
    prediction_date: string;
  } | null;
}

// === Hybrid Stage Analyzer v2 (تحت التجربة) ===
interface StockAnalysis {
  ticker: string;
  current_price: number | null;
  recommendation: string;  // STRONG_BUY / BUY / HOLD / REDUCE / SELL
  hybrid_score: number;    // -100 to +100
  rsi: number | null;
  veto_applied: boolean;
  layers: {
    l1_hmm_stock: { regime: string; confidence: number; method: string };
    l2_wyckoff: { phase: string; phase_ar: string; has_accumulation: boolean; has_spring: boolean; has_sos: boolean };
    l3_weinstein: { stage: string; stage_ar: string; ma_slope: number; distance_from_ma: number };
    l4_volume: { poc: number | null; vah: number | null; val: number | null; position: string; breakout_confirmed: boolean };
  };
  reasons: string[];
  error?: string;
}

interface StockAnalysisResponse {
  success: boolean;
  market_context: {
    regime: string;
    confidence: number;
    veto_buy: boolean;
  } | null;
  results: StockAnalysis[];
}

interface NetPicksData {
  success: boolean;
  market: string;
  picks: NetPick[];
  stats: {
    total_picks: number;
    by_source: Array<{ path: string; label: string; count: number }>;
    with_predictions: number;
    high_confidence: number;
  };
}

function fmtMoney(n: number): string {
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return n?.toFixed(0) || '—';
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${(n ?? 0).toFixed(1)}%`;
}

export function NetPicksTab({ market = 'EGX' }: { market?: string }) {
  const [data, setData] = useState<NetPicksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [stockAnalysis, setStockAnalysis] = useState<Map<string, StockAnalysis>>(new Map());
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [marketContext, setMarketContext] = useState<{ regime: string; confidence: number; veto_buy: boolean } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/maker-radar/net-picks?market=${market}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) setData(json);
    } catch (e) {
      console.error('NetPicksTab error:', e);
    } finally {
      setLoading(false);
    }
  }, [market]);

  // === Fetch Hybrid Stage Analysis لأسهم الرادار (تحت التجربة) ===
  const fetchStockAnalysis = useCallback(async (tickers: string[]) => {
    if (tickers.length === 0) return;
    setAnalysisLoading(true);
    try {
      const res = await fetch(
        `/api/maker-radar/stock-analysis?tickers=${encodeURIComponent(tickers.join(','))}`,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        console.error('stock-analysis API error:', res.status);
        return;
      }
      const json: StockAnalysisResponse = await res.json();
      const map = new Map<string, StockAnalysis>();
      for (const r of json.results || []) {
        map.set(r.ticker, r);
      }
      setStockAnalysis(map);
      if (json.market_context) {
        setMarketContext(json.market_context);
      }
    } catch (e) {
      console.error('stock-analysis fetch error:', e);
    } finally {
      setAnalysisLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // لما الـ picks تـجي، حضّر تحليل الـ Hybrid
  useEffect(() => {
    if (data?.picks && data.picks.length > 0) {
      const tickers = data.picks.slice(0, 20).map(p => p.ticker); // أول 20 سهم (limit)
      fetchStockAnalysis(tickers);
    }
  }, [data, fetchStockAnalysis]);

  // === Helpers لعرض التحليل ===
  const recColor = (rec: string): string => {
    switch (rec) {
      case 'STRONG_BUY': return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
      case 'BUY': return 'bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30';
      case 'HOLD': return 'bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30';
      case 'REDUCE': return 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30';
      case 'SELL': return 'bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-500/30';
      default: return 'bg-muted text-muted-foreground border-muted';
    }
  };

  const recLabel = (rec: string): string => {
    switch (rec) {
      case 'STRONG_BUY': return '🔥 شراء قوي';
      case 'BUY': return '🟢 شراء';
      case 'HOLD': return '🟡 تجمّل';
      case 'REDUCE': return '🟠 تقليل';
      case 'SELL': return '🔴 بيع';
      default: return '—';
    }
  };

  const regimeColor = (regime: string): string => {
    switch (regime) {
      case 'BULL': return 'text-emerald-600 dark:text-emerald-400';
      case 'BEAR': return 'text-rose-600 dark:text-rose-400';
      case 'RANGE': return 'text-amber-600 dark:text-amber-400';
      default: return 'text-muted-foreground';
    }
  };

  const regimeLabel = (regime: string): string => {
    switch (regime) {
      case 'BULL': return 'صاعد';
      case 'BEAR': return 'هابط';
      case 'RANGE': return 'عرضي';
      default: return '—';
    }
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  if (!data || !data.picks || data.picks.length === 0) {
    return (
      <Card className="p-4 border-dashed">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Target className="h-3.5 w-3.5" />
          <span>الرادار قيد التحميل — حاول مرة أخرى بعد دقيقة</span>
        </div>
      </Card>
    );
  }

  const columns: Column<NetPick>[] = [
    {
      key: 'rank',
      header: '#',
      sortable: true,
      render: (row) => <span className="font-mono text-muted-foreground">{row.rank}</span>,
    },
    {
      key: 'ticker',
      header: 'السهم',
      sortable: true,
      filterable: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-bold text-sm">{row.ticker}</span>
          {row.prediction && (
            <Badge className="text-[9px] h-4 px-1 mt-0.5 bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
              {row.prediction.signal}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'source_label',
      header: 'المصدر',
      sortable: true,
      filterable: true,
      render: (row) => (
        <span className="text-[10px] text-muted-foreground">{row.source_label}</span>
      ),
    },
    {
      key: 'current_price',
      header: 'السعر',
      sortable: true,
      render: (row) => <span className="font-mono font-semibold">{row.current_price?.toFixed(2)}</span>,
    },
    {
      key: 'signal_count',
      header: 'الإشارات',
      sortable: true,
      render: (row) => {
        const stars = '⭐'.repeat(Math.ceil((row.signal_count / row.max_signals) * 5));
        return (
          <div className="flex flex-col items-start">
            <span className="text-[9px]">{stars}</span>
            <span className="text-[9px] text-muted-foreground">{row.signal_count}/{row.max_signals}</span>
          </div>
        );
      },
    },
    {
      key: 'volume_ratio',
      header: 'حجم نسبي',
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{row.volume_ratio?.toFixed(2)}×</span>,
    },
    {
      key: 'avg_turnover',
      header: 'السيولة',
      sortable: true,
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{fmtMoney(row.avg_turnover)}</span>,
    },
    {
      key: 'roc_10d',
      header: 'ROC 10d',
      sortable: true,
      render: (row) => (
        <span className={`font-mono text-xs ${row.roc_10d >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {fmtPct(row.roc_10d)}
        </span>
      ),
    },
    {
      key: 'prediction',
      header: 'توقع',
      sortable: false,
      render: (row) => {
        if (!row.prediction) return <span className="text-[10px] text-muted-foreground">—</span>;
        const p = row.prediction;
        return (
          <div className="flex flex-col gap-0.5 text-[10px]">
            <div className="flex gap-1">
              <span className="text-muted-foreground">دخول:</span>
              <span className="font-mono font-semibold">{p.entry_price?.toFixed(2)}</span>
            </div>
            <div className="flex gap-1">
              <span className="text-muted-foreground">هدف:</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">{p.target_price?.toFixed(2)}</span>
            </div>
            <div className="flex gap-1">
              <span className="text-muted-foreground">وقف:</span>
              <span className="font-mono text-rose-600 dark:text-rose-400">{p.stop_loss?.toFixed(2)}</span>
            </div>
            <div className="flex gap-1">
              <span className="text-muted-foreground">RR:</span>
              <span className="font-mono font-bold">1:{p.risk_reward?.toFixed(1)}</span>
            </div>
          </div>
        );
      },
    },
    // === تحليل هجين v2 (تحت التجربة) ===
    {
      key: 'hybrid_analysis',
      header: 'تحليل هجين',
      sortable: true,
      filterable: true,
      render: (row) => {
        const analysis = stockAnalysis.get(row.ticker);
        if (analysisLoading && !analysis) {
          return <Skeleton className="h-4 w-16" />;
        }
        if (!analysis) {
          return <span className="text-[10px] text-muted-foreground">—</span>;
        }
        if (analysis.error) {
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] text-muted-foreground">خطأ</span>
              <span className="text-[8px] text-muted-foreground/70">{analysis.error}</span>
            </div>
          );
        }
        return (
          <div className="flex flex-col gap-1">
            {/* Recommendation badge */}
            <Badge className={`text-[9px] h-4 px-1 ${recColor(analysis.recommendation)}`}>
              {recLabel(analysis.recommendation)}
            </Badge>
            {/* Score */}
            <span className={`text-[9px] font-mono ${
              analysis.hybrid_score >= 25 ? 'text-emerald-600 dark:text-emerald-400' :
              analysis.hybrid_score <= -25 ? 'text-rose-600 dark:text-rose-400' :
              'text-muted-foreground'
            }`}>
              score: {analysis.hybrid_score > 0 ? '+' : ''}{analysis.hybrid_score.toFixed(0)}
            </span>
            {/* Veto indicator */}
            {analysis.veto_applied && (
              <span className="text-[8px] text-rose-600 dark:text-rose-400" title="EGX30 BEAR → تم تقييد التوصية">
                ⚠️ تقييد
              </span>
            )}
          </div>
        );
      },
    },
    // === تفاصيل الـ Layers (HMM + Wyckoff + Weinstein + Volume) ===
    {
      key: 'hybrid_layers',
      header: 'الطبقات',
      sortable: false,
      render: (row) => {
        const analysis = stockAnalysis.get(row.ticker);
        if (!analysis || analysis.error) {
          return <span className="text-[10px] text-muted-foreground">—</span>;
        }
        const l1 = analysis.layers.l1_hmm_stock;
        const l2 = analysis.layers.l2_wyckoff;
        const l3 = analysis.layers.l3_weinstein;
        const l4 = analysis.layers.l4_volume;
        return (
          <div className="flex flex-col gap-0.5 text-[9px]">
            <div className="flex gap-1">
              <span className="text-muted-foreground">HMM:</span>
              <span className={`font-medium ${regimeColor(l1.regime)}`}>
                {regimeLabel(l1.regime)} ({l1.confidence?.toFixed(0)}%)
              </span>
            </div>
            <div className="flex gap-1">
              <span className="text-muted-foreground">Wyckoff:</span>
              <span className="text-foreground">{l2.phase_ar || '—'}</span>
            </div>
            <div className="flex gap-1">
              <span className="text-muted-foreground">Weinstein:</span>
              <span className={`font-medium ${
                l3.stage.includes('MARKUP') ? 'text-emerald-600 dark:text-emerald-400' :
                l3.stage.includes('MARKDOWN') ? 'text-rose-600 dark:text-rose-400' :
                l3.stage.includes('TOP') ? 'text-amber-600 dark:text-amber-400' :
                'text-foreground'
              }`}>
                {l3.stage_ar || '—'}
              </span>
            </div>
            <div className="flex gap-1">
              <span className="text-muted-foreground">Volume:</span>
              <span className={`${
                l4.breakout_confirmed ? 'text-emerald-600 dark:text-emerald-400 font-bold' :
                l4.position === 'BELOW_VA' ? 'text-rose-600 dark:text-rose-400' :
                'text-foreground'
              }`}>
                {l4.breakout_confirmed ? '✅ اختراق مؤكد' :
                 l4.position === 'ABOVE_VA' ? 'فوق VAH' :
                 l4.position === 'BELOW_VA' ? 'تحت VAL' :
                 l4.position === 'IN_VA' ? 'في VA' : '—'}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key: 'accumulation',
      header: 'التجميع',
      sortable: true,
      filterable: true,
      render: (row) => {
        const acc = row.accumulation || '';
        const cls = acc.includes('قوي') ? 'text-emerald-600 dark:text-emerald-400' : acc.includes('تصريف') ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground';
        return <span className={`text-[10px] font-medium ${cls}`}>{acc || '—'}</span>;
      },
    },
  ];

  return (
    <Card className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h4 className="text-sm font-semibold">صافى التوقعات</h4>
            <p className="text-[10px] text-muted-foreground">مجمع من كل مسارات الرادار + مزوّد بالتوقعات</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {data.stats.total_picks} سهم
          </Badge>
          {data.stats.with_predictions > 0 && (
            <Badge className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
              {data.stats.with_predictions} بتوقع
            </Badge>
          )}
          {/* Hybrid analysis status */}
          <Badge variant="outline" className="text-[9px] gap-1" title="تحليل هجين v2 (تحت التجربة)">
            <Brain className="h-2.5 w-2.5" />
            {analysisLoading ? 'جاري التحليل...' : `${stockAnalysis.size} محلل`}
          </Badge>
          <button onClick={fetchData} className="text-muted-foreground hover:text-foreground" title="تحديث">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Market Context Banner (EGX30 regime من الـ Hybrid) */}
      {marketContext && (
        <div className="mb-3 p-2 rounded-md bg-muted/50 border border-border/50 flex items-center gap-2 text-[10px]">
          <Sparkles className="h-3 w-3 text-amber-500" />
          <span className="text-muted-foreground">سياق السوق (EGX30):</span>
          <Badge className={`text-[9px] h-4 px-1.5 ${
            marketContext.regime === 'BULL' ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' :
            marketContext.regime === 'BEAR' ? 'bg-rose-500/20 text-rose-700 dark:text-rose-400' :
            'bg-amber-500/20 text-amber-700 dark:text-amber-400'
          }`}>
            {regimeLabel(marketContext.regime)} ({marketContext.confidence?.toFixed(0)}%)
          </Badge>
          {marketContext.veto_buy && (
            <Badge className="text-[9px] h-4 px-1.5 bg-rose-500/20 text-rose-700 dark:text-rose-400">
              ⚠️ تقييد الشراء
            </Badge>
          )}
          <span className="text-muted-foreground/70 mr-auto">تحت التجربة</span>
        </div>
      )}

      {/* Source breakdown */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {data.stats.by_source.filter(s => s.count > 0).map(s => (
          <Badge key={s.path} variant="outline" className="text-[9px] h-5 px-1.5">
            {s.label.split(' ')[0]} {s.count}
          </Badge>
        ))}
      </div>

      {/* Unified Table */}
      <UnifiedTable<NetPick>
        columns={columns}
        data={data.picks}
        keyField="ticker"
        dense
        filterable
        columnToggle
        maxHeight="max-h-[60vh]"
      />
    </Card>
  );
}
