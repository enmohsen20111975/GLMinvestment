'use client';

import React from 'react';
import {
  TrendingUp,
  Minus,
  TrendingDown,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { WidgetStat, WidgetStatGrid } from '@/components/shared/WidgetStat';
import { cn } from '@/lib/utils';

function SentimentGauge({ score, sentiment }: { score: number; sentiment: string }) {
  // Handle NaN/undefined values safely
  const safeScore = Number.isFinite(score) ? score : 50;
  const clampedScore = Math.max(0, Math.min(100, safeScore));
  const circumference = 2 * Math.PI * 54;
  const strokeDashoffset = circumference - (clampedScore / 100) * circumference;

  const colorConfig = {
    bullish: {
      stroke: '#10b981',
      gradientStart: '#10b981',
      gradientEnd: '#34d399',
      bg: 'bg-profit/10',
      text: 'text-profit ',
      label: 'صعودي',
      labelBg: 'bg-profit/10 text-profit border border-profit/20 ',
    },
    neutral: {
      stroke: '#f59e0b',
      gradientStart: '#f59e0b',
      gradientEnd: '#fbbf24',
      bg: 'bg-warning/10',
      text: 'text-warning ',
      label: 'محايد',
      labelBg: 'bg-warning/10 text-warning dark:text-warning border border-warning/20 ',
    },
    bearish: {
      stroke: '#ef4444',
      gradientStart: '#ef4444',
      gradientEnd: '#f87171',
      bg: 'bg-loss/10',
      text: 'text-loss ',
      label: 'هبوطي',
      labelBg: 'bg-loss/10 text-loss border border-loss/20 ',
    },
  };

  const config = colorConfig[sentiment as keyof typeof colorConfig] || colorConfig.neutral;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Circular gauge */}
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={config.gradientStart} />
              <stop offset="100%" stopColor={config.gradientEnd} />
            </linearGradient>
          </defs>
          {/* Background circle */}
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-muted/30"
          />
          {/* Progress circle */}
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-lg font-black tabular-nums', config.text)}>
            {(Number(clampedScore) || 0).toFixed(0)}
          </span>
          <span className="text-[8px] font-medium text-muted-foreground">من 100</span>
        </div>
      </div>

      {/* Sentiment label */}
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold',
          config.labelBg,
        )}
      >
        {sentiment === 'bullish' && <TrendingUp className="w-4 h-4" />}
        {sentiment === 'neutral' && <Minus className="w-4 h-4" />}
        {sentiment === 'bearish' && <TrendingDown className="w-4 h-4" />}
        {config.label}
      </span>
    </div>
  );
}

export function MarketSentiment() {
  const { aiInsights } = useAppStore();

  if (!aiInsights) return null;

  const {
    market_score,
    market_sentiment,
    volatility_index,
    market_breadth,
    gainers,
    losers,
  } = aiInsights;

  const totalMovers = gainers + losers;
  const breadthPercent = totalMovers > 0 ? (gainers / totalMovers) * 100 : 50;

  return (
    <WidgetCard
      title="مؤشر المشاعر"
      icon={Activity}
      iconColor="text-profit"
      hideRefresh
      className="border-0 shadow-sm h-full"
      headerClassName="pb-0.5 px-3 pt-2.5"
      titleClassName="font-bold"
      contentClassName="p-2.5 pt-1 flex flex-col items-center gap-1.5"
    >
      {/* Gauge */}
      <SentimentGauge score={market_score} sentiment={market_sentiment} />

      {/* Stats grid */}
      <WidgetStatGrid cols={2}>
        <WidgetStat
          label="التذبذب"
          value={(Number(volatility_index) || 0).toFixed(2)}
        />
        <WidgetStat
          label="العرض"
          value={(Number(market_breadth) || 0).toFixed(1)}
          suffix="%"
        />
      </WidgetStatGrid>

      {/* Breadth bar */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-muted-foreground">صعود / هبوط</span>
          <div className="flex items-center gap-1 text-xs">
            <span className="flex items-center gap-0.5 text-profit font-semibold">
              <ArrowUpRight className="w-2.5 h-2.5" />
              {gainers}
            </span>
            <span className="text-muted-foreground">/</span>
            <span className="flex items-center gap-0.5 text-loss font-semibold">
              <ArrowDownRight className="w-2.5 h-2.5" />
              {losers}
            </span>
          </div>
        </div>
        <div className="relative h-2 bg-loss/10 rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 right-0 bg-profit rounded-full transition-all duration-700"
            style={{ width: `${breadthPercent}%` }}
          />
        </div>
      </div>
    </WidgetCard>
  );
}
