'use client';

/**
 * IntradayPulseBar.tsx — نبض لحظي جوه الجلسة (shared component)
 * ====================================================================
 * مستخرج من LiquidityRadarView (برافو) للاستخدام في عدة شاشات.
 * ALERT ONLY — مش توصية شراء.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Zap, Flame, ArrowDownCircle, Activity } from 'lucide-react';
import { useAppStore } from '@/lib/store';

interface PulseStock {
  symbol: string;
  current_price: number;
  change_from_open_pct: number | null;
  volume: number;
  flags: string[];
  data_status: string;
  daily_context: string | null;
  note_ar: string;
}

export function IntradayPulseBar() {
  // /api/intraday-pulse runs the Cairo/EGX Python intraday scanner — EGX-only.
  // Hide the bar entirely on non-EGX markets to avoid a noisy fetch that will
  // never return useful data.
  const currentMarket = useAppStore((s) => s.currentMarket);
  const [pulse, setPulse] = useState<PulseStock[] | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPulse = useCallback(async () => {
    if (currentMarket !== 'EGX') return;
    try {
      const res = await fetch('/api/intraday-pulse', { cache: 'no-store' as RequestCache });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.results) {
        const active = (data.results as PulseStock[]).filter(
          (r) =>
            r.data_status === 'OK' &&
            r.flags.some(
              (f) =>
                f === 'SURGE_UP_LIVE' ||
                f === 'SURGE_DOWN_LIVE' ||
                f === 'VOLUME_SPIKE_LIVE' ||
                f === 'BREAKING_DAY_HIGH' ||
                f === 'BREAKING_DAY_LOW'
            )
        );
        setPulse(active);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [currentMarket]);

  useEffect(() => {
    fetchPulse();
    const interval = setInterval(fetchPulse, 30000);
    return () => clearInterval(interval);
  }, [fetchPulse]);

  if (currentMarket !== 'EGX') return null;
  if (loading || !pulse || pulse.length === 0) return null;

  const surgers = pulse.filter((s) => s.flags.includes('SURGE_UP_LIVE'));
  const decliners = pulse.filter((s) => s.flags.includes('SURGE_DOWN_LIVE'));
  const volSpikes = pulse.filter(
    (s) => s.flags.includes('VOLUME_SPIKE_LIVE') && !s.flags.includes('SURGE_UP_LIVE') && !s.flags.includes('SURGE_DOWN_LIVE')
  );

  return (
    <div className="mb-3 rounded-xl border border-orange-500/30 bg-orange-500/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="size-4 text-orange-500 animate-pulse" />
        <span className="text-xs font-bold text-orange-600 dark:text-orange-400">
          نبض لحظي — حركة جوه الجلسة
        </span>
        <span className="text-[10px] text-muted-foreground">
          ({pulse.length} سهم بيتحرك) — تحديث كل 30 ثانية
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
        {surgers
          .sort((a, b) => (b.change_from_open_pct || 0) - (a.change_from_open_pct || 0))
          .slice(0, 12)
          .map((s) => (
            <div
              key={s.symbol}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-profit/10 border border-profit/20 text-xs"
              title={s.note_ar}
            >
              <Flame className="size-3 text-profit" />
              <span className="font-bold text-profit">{s.symbol}</span>
              <span className="font-mono text-profit">+{s.change_from_open_pct?.toFixed(1)}%</span>
              <span className="text-[9px] text-muted-foreground">
                {s.volume > 1000000 ? `${(s.volume / 1000000).toFixed(1)}M` : s.volume > 1000 ? `${(s.volume / 1000).toFixed(0)}K` : s.volume}
              </span>
              {s.daily_context === 'under_microscope' && (
                <span className="text-[8px] text-whale bg-whale/10 px-0.5 rounded">مراقبة</span>
              )}
              {s.daily_context === 'rule80_downtrend' && (
                <span className="text-[8px] text-warning bg-warning/10 px-0.5 rounded">⚠️ هبوط</span>
              )}
            </div>
          ))}
        {decliners
          .sort((a, b) => (a.change_from_open_pct || 0) - (b.change_from_open_pct || 0))
          .slice(0, 12)
          .map((s) => (
            <div
              key={s.symbol}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-loss/10 border border-loss/20 text-xs"
              title={s.note_ar}
            >
              <ArrowDownCircle className="size-3 text-loss" />
              <span className="font-bold text-loss">{s.symbol}</span>
              <span className="font-mono text-loss">{s.change_from_open_pct?.toFixed(1)}%</span>
              <span className="text-[9px] text-muted-foreground">
                {s.volume > 1000000 ? `${(s.volume / 1000000).toFixed(1)}M` : s.volume > 1000 ? `${(s.volume / 1000).toFixed(0)}K` : s.volume}
              </span>
            </div>
          ))}
        {volSpikes.slice(0, 6).map((s) => (
          <div
            key={s.symbol}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs"
            title={s.note_ar}
          >
            <Activity className="size-3 text-violet-500" />
            <span className="font-bold text-violet-600 dark:text-violet-400">{s.symbol}</span>
            <span className="text-[9px] text-muted-foreground">حجم غير عادي</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default IntradayPulseBar;
