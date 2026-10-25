/**
 * single-stock/ChartContent.tsx
 * ==============================
 * The main chart area: sidebar (live price + OHLCV) + chart iframe or
 * TradingViewChart + error/empty states.
 *
 * Extracted from SingleStockAnalysisView.tsx (1,548 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TradingViewChart } from '@/modules/stock-analysis/components/TradingViewChart';
import type { ChartEngine, FullAnalysisResponse, OHLCVCandle } from './types';

export interface ChartContentProps {
  ticker: string;
  stockName: string;
  chartEngine: ChartEngine;
  tvSymbol: string;
  tvInterval: string;
  loading: boolean;
  error: string | null;
  data: FullAnalysisResponse | null;
  livePrice: number;
  chgPct: number;
  isUp: boolean;
  currencyLabel: string;
  todayCandle?: Partial<OHLCVCandle> | null;
  onRetry: () => void;
}

export function ChartContent(props: ChartContentProps) {
  const {
    ticker,
    stockName,
    chartEngine,
    tvSymbol,
    tvInterval,
    loading,
    error,
    data,
    livePrice,
    chgPct,
    isUp,
    currencyLabel,
    todayCandle,
    onRetry,
  } = props;

  return (
    <CardContent className="p-3 space-y-3">
      <div className="flex flex-col lg:flex-row gap-3 min-h-[440px]">
        <div className="hidden lg:flex flex-col w-40 shrink-0 rounded-xl bg-muted border border-border p-3 gap-2 text-[10px]">
          <div className="text-muted-foreground font-bold border-b border-border pb-1 text-center">
            السعر اللحظي
          </div>
          <div className="text-center">
            <div className="text-[10px] text-muted-foreground">إغلااق</div>
            <div className={cn('text-lg font-black font-mono', isUp ? 'text-profit' : 'text-loss')}>
              {(livePrice ?? 0).toFixed(2)}
            </div>
            <div className={cn('font-bold', isUp ? 'text-profit' : 'text-loss')}>
              {isUp ? '+' : ''}
              {(chgPct ?? 0).toFixed(2)}%
            </div>
          </div>
          <div className="space-y-1 pt-2 border-t border-border">
            <div className="flex justify-between">
              <span className="text-muted-foreground">افتتاح:</span>
              <span className="font-mono">{(todayCandle?.open ?? 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">أعلى:</span>
              <span className="font-mono text-profit">{(todayCandle?.high ?? 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">أدنى:</span>
              <span className="font-mono text-loss">{(todayCandle?.low ?? 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">حجم:</span>
              <span className="font-mono">{(todayCandle?.volume ?? 0).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-[460px] rounded-xl overflow-hidden border border-border bg-card relative">
          {chartEngine === 'tradingview_widget' ? (
            <div className="w-full h-full min-h-[460px] relative bg-card overflow-hidden">
              <iframe
                src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(
                  tvSymbol,
                )}&interval=${tvInterval}&theme=dark&style=1&timezone=Africa%2FCairo&locale=ar_AE&enable_publishing=false&allow_symbol_change=1&save_image=1&hide_side_toolbar=0&utm_source=invist.m2y.net`}
                className="w-full h-full min-h-[460px] border-0"
                title={`TradingView ${ticker}`}
                allowFullScreen
              />
            </div>
          ) : loading ? (
            <div className="flex flex-col justify-center items-center h-full min-h-[440px] gap-2">
              <RefreshCw className="w-6 h-6 text-profit animate-spin" />
              <span className="text-xs text-muted-foreground">
                جاري تحميل بيانات {ticker}...
              </span>
            </div>
          ) : error ? (
            <div className="flex flex-col justify-center items-center h-full min-h-[440px] gap-2 p-4 text-center">
              <AlertTriangle className="w-8 h-8 text-loss" />
              <span className="text-xs font-bold text-loss">{error}</span>
              <Button variant="outline" size="sm" onClick={onRetry} className="mt-2 text-xs">
                إعادة المحاولة
              </Button>
            </div>
          ) : data && data.ohlcv && data.ohlcv.length > 0 ? (
            <TradingViewChart ticker={ticker} stockName={stockName} />
          ) : (
            <div className="flex flex-col justify-center items-center h-full min-h-[440px] text-muted-foreground text-xs">
              لا توجد بيانات كافية لهذا السهم
            </div>
          )}
        </div>
      </div>
    </CardContent>
  );
}
