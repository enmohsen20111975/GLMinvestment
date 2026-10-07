'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { Target, Layers, Trophy, RefreshCw } from 'lucide-react';

// ============================================================================
// NetPicksTab — صافى التوقعات (مجمع من كل مسارات الرادار)
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
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function NetPicksTab({ market = 'EGX' }: { market?: string }) {
  const [data, setData] = useState<NetPicksData | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => { fetchData(); }, [fetchData]);

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
          <button onClick={fetchData} className="text-muted-foreground hover:text-foreground" title="تحديث">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

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
