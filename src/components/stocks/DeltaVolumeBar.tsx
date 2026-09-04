'use client';

import { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Zap } from 'lucide-react';

interface DeltaData {
  latest: {
    date: string;
    volume: number;
    buy_volume: number;
    sell_volume: number;
    delta_volume: number;
    delta_pct: number;
    pressure: string;
    close: number;
  };
  history: Array<{
    date: string;
    volume: number;
    buy_volume: number;
    sell_volume: number;
    delta_volume: number;
    delta_pct: number;
    pressure: string;
    close: number;
  }>;
  summary: {
    total_days: number;
    avg_delta_pct: number;
    buy_days: number;
    sell_days: number;
    neutral_days: number;
    total_buy: number;
    total_sell: number;
    buy_ratio: number;
    sell_ratio: number;
    maker_direction: string;
  } | null;
}

const PRESSURE_CONFIG: Record<string, { color: string; bg: string; label: string; icon: any }> = {
  STRONG_BUY: { color: 'text-emerald-600', bg: 'bg-emerald-500', label: 'شراء قوي', icon: Zap },
  BUY: { color: 'text-emerald-500', bg: 'bg-emerald-400', label: 'شراء', icon: TrendingUp },
  NEUTRAL: { color: 'text-amber-500', bg: 'bg-amber-400', label: 'محايد', icon: Minus },
  SELL: { color: 'text-red-400', bg: 'bg-red-400', label: 'بيع', icon: TrendingDown },
  STRONG_SELL: { color: 'text-red-600', bg: 'bg-red-500', label: 'بيع قوي', icon: AlertTriangle },
};

const MAKER_CONFIG: Record<string, { label: string; color: string; desc: string }> = {
  ACCUMULATION: { label: 'تجميع قوي', color: 'text-emerald-600', desc: 'الميكرز بيجمع — السهم هايطلع' },
  ACCUMULATION_LIGHT: { label: 'تجميع خفيف', color: 'text-emerald-500', desc: 'الميكرز بيجمع بهدوء' },
  NEUTRAL: { label: 'محايد', color: 'text-amber-500', desc: 'مفيش اتجاه واضح' },
  DISTRIBUTION_LIGHT: { label: 'تصريف خفيف', color: 'text-red-400', desc: 'الميكرز بيوزع بهدوء' },
  DISTRIBUTION: { label: 'تصريف قوي', color: 'text-red-600', desc: 'الميكرز بيوزع — السهم هينزل' },
};

export function DeltaVolumeBar({ ticker }: { ticker: string }) {
  const [data, setData] = useState<DeltaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [animateWidth, setAnimateWidth] = useState(false);
  const prevBuyRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    async function fetchDelta() {
      try {
        const res = await fetch(`/api/stocks/delta-volume?ticker=${ticker}&days=14`);
        const json = await res.json();
        if (mounted && json.success) {
          setData(json);
          // Trigger animation
          setTimeout(() => setAnimateWidth(true), 100);
        }
      } catch {
        // silent fail
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchDelta();
    return () => { mounted = false; };
  }, [ticker]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card/50 p-4 animate-pulse">
        <div className="h-4 w-32 bg-muted rounded mb-3" />
        <div className="h-8 w-full bg-muted rounded" />
      </div>
    );
  }

  if (!data || !data.latest) {
    return null;
  }

  const { latest, summary } = data;
  const total = latest.buy_volume + latest.sell_volume;
  const buyPct = total > 0 ? (latest.buy_volume / total) * 100 : 50;
  const sellPct = 100 - buyPct;
  const pressureCfg = PRESSURE_CONFIG[latest.pressure] || PRESSURE_CONFIG.NEUTRAL;
  const PressureIcon = pressureCfg.icon;
  const makerCfg = summary ? MAKER_CONFIG[summary.maker_direction] : null;

  // History bars (last 14 days, reversed for chronological)
  const historyBars = [...(data.history || [])].reverse();

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-foreground">عمق السوق — ضغط الشراء/البيع</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <PressureIcon className={`w-4 h-4 ${pressureCfg.color}`} />
          <span className={`text-xs font-semibold ${pressureCfg.color}`}>{pressureCfg.label}</span>
        </div>
      </div>

      {/* Main Buy/Sell Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            شراء: {formatVolume(latest.buy_volume)}
          </span>
          <span className="text-muted-foreground">{latest.delta_pct > 0 ? '+' : ''}{latest.delta_pct}%</span>
          <span className="text-red-500 dark:text-red-400 font-semibold flex items-center gap-1">
            بيع: {formatVolume(latest.sell_volume)}
            <TrendingDown className="w-3 h-3" />
          </span>
        </div>

        {/* Animated bar */}
        <div className="relative h-6 rounded-full overflow-hidden bg-muted/30 flex">
          <div
            className={`h-full ${pressureCfg.bg} transition-all duration-1000 ease-out flex items-center justify-start pr-2`}
            style={{
              width: animateWidth ? `${buyPct}%` : '0%',
            }}
          >
            {buyPct > 15 && (
              <span className="text-[10px] text-white font-bold">{Math.round(buyPct)}%</span>
            )}
          </div>
          <div
            className="h-full bg-red-500/70 transition-all duration-1000 ease-out flex items-center justify-end pl-2"
            style={{
              width: animateWidth ? `${sellPct}%` : '0%',
            }}
          >
            {sellPct > 15 && (
              <span className="text-[10px] text-white font-bold">{Math.round(sellPct)}%</span>
            )}
          </div>
        </div>
      </div>

      {/* Maker Direction */}
      {makerCfg && summary && (
        <div className={`flex items-center gap-2 p-2 rounded-lg ${summary.maker_direction.includes('ACCUMULATION') ? 'bg-emerald-500/10' : summary.maker_direction.includes('DISTRIBUTION') ? 'bg-red-500/10' : 'bg-amber-500/10'}`}>
          <div className={`w-2 h-2 rounded-full ${summary.maker_direction.includes('ACCUMULATION') ? 'bg-emerald-500 animate-pulse' : summary.maker_direction.includes('DISTRIBUTION') ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`} />
          <div className="flex-1">
            <span className={`text-xs font-bold ${makerCfg.color}`}>{makerCfg.label}</span>
            <span className="text-[10px] text-muted-foreground block">{makerCfg.desc}</span>
          </div>
          <span className="text-[10px] text-muted-foreground">{summary.total_days} يوم</span>
        </div>
      )}

      {/* History mini-chart */}
      {historyBars.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground font-medium">آخر {historyBars.length} يوم</div>
          <div className="flex items-end gap-0.5 h-12">
            {historyBars.map((h, i) => {
              const hTotal = h.buy_volume + h.sell_volume;
              const hBuyPct = hTotal > 0 ? (h.buy_volume / hTotal) * 100 : 50;
              const cfg = PRESSURE_CONFIG[h.pressure] || PRESSURE_CONFIG.NEUTRAL;
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col-reverse rounded-sm overflow-hidden group relative"
                  style={{ height: '100%' }}
                  title={`${h.date}: ${h.delta_pct > 0 ? '+' : ''}${h.delta_pct}% (${cfg.label})`}
                >
                  <div
                    className={`${cfg.bg} transition-all duration-500`}
                    style={{ height: `${hBuyPct}%` }}
                  />
                  <div
                    className="bg-red-500/50 transition-all duration-500"
                    style={{ height: `${100 - hBuyPct}%` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-1.5 rounded-lg bg-emerald-500/5">
            <div className="text-[10px] text-muted-foreground">أيام شراء</div>
            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{summary.buy_days}</div>
          </div>
          <div className="p-1.5 rounded-lg bg-amber-500/5">
            <div className="text-[10px] text-muted-foreground">محايد</div>
            <div className="text-sm font-bold text-amber-500">{summary.neutral_days}</div>
          </div>
          <div className="p-1.5 rounded-lg bg-red-500/5">
            <div className="text-[10px] text-muted-foreground">أيام بيع</div>
            <div className="text-sm font-bold text-red-500 dark:text-red-400">{summary.sell_days}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatVolume(v: number | null | undefined): string {
  if (!v || v === 0) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}
