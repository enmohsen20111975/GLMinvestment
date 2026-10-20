'use client';

import React from 'react';
import {
 TrendingUp,
 Minus,
 TrendingDown,
 Activity,
 BarChart3,
 ArrowUpRight,
 ArrowDownRight,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
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
 labelBg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 ',
 },
 neutral: {
 stroke: '#f59e0b',
 gradientStart: '#f59e0b',
 gradientEnd: '#fbbf24',
 bg: 'bg-warning/10',
 text: 'text-warning ',
 label: 'محايد',
 labelBg: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 ',
 },
 bearish: {
 stroke: '#ef4444',
 gradientStart: '#ef4444',
 gradientEnd: '#f87171',
 bg: 'bg-loss/10',
 text: 'text-loss ',
 label: 'هبوطي',
 labelBg: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 ',
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
 config.labelBg
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
 <Card className="border-0 shadow-sm h-full">
 <CardHeader className="pb-0.5 px-3 pt-2.5">
 <CardTitle className="text-sm font-bold flex items-center gap-1.5" dir="rtl">
 <Activity className="w-3.5 h-3.5 text-profit" />
 مؤشر المشاعر
 </CardTitle>
 </CardHeader>
 <CardContent className="p-2.5 pt-1 flex flex-col items-center gap-1.5" dir="rtl">
 {/* Gauge */}
 <SentimentGauge score={market_score} sentiment={market_sentiment} />

 {/* Stats grid */}
 <div className="w-full grid grid-cols-2 gap-1.5">
 {/* Volatility */}
 <div className="rounded-md bg-muted/50 p-1.5">
 <div className="flex items-center gap-1 mb-1">
 <Activity className="w-3 h-3 text-muted-foreground" />
 <span className="text-xs text-muted-foreground font-medium">التذبذب</span>
 </div>
 <p className="text-sm font-bold text-foreground tabular-nums">
 {(Number(volatility_index) || 0).toFixed(2)}
 </p>
 </div>

 {/* Breadth */}
 <div className="rounded-md bg-muted/50 p-1.5">
 <div className="flex items-center gap-1 mb-0.5">
 <BarChart3 className="w-3 h-3 text-muted-foreground" />
 <span className="text-xs text-muted-foreground font-medium">العرض</span>
 </div>
 <p className="text-sm font-bold text-foreground tabular-nums">
 {(Number(market_breadth) || 0).toFixed(1)}%
 </p>
 </div>
 </div>

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
 </CardContent>
 </Card>
 );
}
