'use client';

import React from 'react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { BarChart3, LineChart } from 'lucide-react';

/**
 * ChartToggle — زر تبديل بين TradingViewChart و InteractiveChart
 * ALPHA-CHART-TOGGLE-1: المستخدم يقدر يبدل بين الشارتين في أي شاشة فيها شارت.
 *
 * Usage:
 * <ChartToggle />
 *
 * الـ state بيتـ persist في localStorage (chart-pref key).
 * Default: 'interactive' (الـ chart المدمج بكل المميزات).
 */
export function ChartToggle({ className }: { className?: string }) {
  const chartPreference = useAppStore((s) => s.chartPreference);
  const setChartPreference = useAppStore((s) => s.setChartPreference);

  return (
    <div className={cn(
      'inline-flex items-center gap-0.5 bg-muted border border-border rounded-xl p-0.5 text-xs font-semibold',
      className
    )}>
      <button
        type="button"
        onClick={() => setChartPreference('interactive')}
        className={cn(
          'flex items-center gap-1 px-2.5 py-1 rounded-lg transition-colors',
          chartPreference === 'interactive'
            ? 'bg-primary text-primary-foreground font-bold shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
        title="الشارت التفاعلي (مميزات متقدمة: SMC + Fusion + BOS)"
      >
        <BarChart3 className="w-3.5 h-3.5" />
        تفاعلي
      </button>
      <button
        type="button"
        onClick={() => setChartPreference('tradingview')}
        className={cn(
          'flex items-center gap-1 px-2.5 py-1 rounded-lg transition-colors',
          chartPreference === 'tradingview'
            ? 'bg-primary text-primary-foreground font-bold shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
        title="شارت TradingView الأصلي"
      >
        <LineChart className="w-3.5 h-3.5" />
        TradingView
      </button>
    </div>
  );
}
