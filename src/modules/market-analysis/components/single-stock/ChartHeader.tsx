/**
 * single-stock/ChartHeader.tsx
 * =============================
 * Chart card header — toolbar with:
 *   - Stock search selector + ticker name + price badge + confluence badge + LIVE/DELAYED badge
 *   - Timeframe switcher (5M / 15M / 1H / DAY / WEEK / MONTH)
 *   - Chart-engine switcher (TradingView widget vs native SMC chart)
 *   - Simple/Pro mode toggle
 *   - Action buttons: refresh, alerts, quick-add-alert (star), maximize, screenshot, remove
 *   - "وضعي" (my state) buyer/owner toggle + adjustment reason
 *   - Visible indicators toggle bar
 *
 * Extracted from SingleStockAnalysisView.tsx (1,548 LOC) in Task F-Phase3-FinalPush.
 * Pure presentational component — all state lifted to the container.
 */

'use client';

import React from 'react';
import {
  Bell,
  BellRing,
  Check,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  ShoppingCart,
  Star,
  Trash2,
  Wallet,
} from 'lucide-react';
import { CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StockSearchSelector } from '@/components/shared/StockSearchSelector';
import { cn } from '@/lib/utils';
import {
  DEFAULT_VISIBLE_INDICATORS,
  type ChartEngine,
  type FullAnalysisResponse,
  type VisibleIndicatorsMap,
} from './types';

export interface ChartHeaderProps {
  ticker: string;
  onSelectTicker: (newTicker: string) => void;
  stockName?: string;
  stockInfoName?: string;
  livePrice: number;
  chgPct: number;
  isUp: boolean;
  currencyLabel: string;
  confluence?: FullAnalysisResponse['confluence'];
  isLive: boolean;
  liveDelayedMode?: boolean;
  liveDelayedMinutes?: number;
  timeframe: string;
  onTimeframeChange: (tf: '5M' | '15M' | '1H' | 'DAY' | 'WEEK' | 'MONTH') => void;
  chartEngine: ChartEngine;
  onChartEngineChange: (e: ChartEngine) => void;
  advancedMode: boolean;
  onAdvancedModeChange: (v: boolean) => void;
  loading: boolean;
  onRefresh: () => void;
  alertPanelOpen: boolean;
  onOpenAlertPanel: () => void;
  activeAlertsCount: number;
  quickAdding: boolean;
  quickAdded: boolean;
  onQuickAddAlert: () => void;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  screenshotting: boolean;
  onScreenshot: () => void;
  canRemove: boolean;
  onRemove: () => void;
  userState: 'buyer' | 'owner';
  onUserStateChange: (s: 'buyer' | 'owner') => void;
  isCrypto: boolean;
  adjustmentReason?: string;
  visibleIndicators: VisibleIndicatorsMap;
  onToggleIndicator: (key: string) => void;
}

export function ChartHeader(props: ChartHeaderProps) {
  const {
    ticker,
    onSelectTicker,
    stockName,
    stockInfoName,
    livePrice,
    chgPct,
    isUp,
    currencyLabel,
    confluence,
    isLive,
    liveDelayedMode,
    liveDelayedMinutes,
    timeframe,
    onTimeframeChange,
    chartEngine,
    onChartEngineChange,
    advancedMode,
    onAdvancedModeChange,
    loading,
    onRefresh,
    onOpenAlertPanel,
    activeAlertsCount,
    quickAdding,
    quickAdded,
    onQuickAddAlert,
    isMaximized,
    onToggleMaximize,
    screenshotting,
    onScreenshot,
    canRemove,
    onRemove,
    userState,
    onUserStateChange,
    isCrypto,
    adjustmentReason,
    visibleIndicators,
    onToggleIndicator,
  } = props;

  return (
    <CardHeader className="px-4 py-3 border-b border-border from-slate-50 via-white space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <StockSearchSelector
            value={ticker}
            onSelectStock={onSelectTicker}
            placeholder="اختر السهم"
            compact
            buttonClassName="w-[140px] md:w-[170px] bg-card border-border shadow-sm rounded-xl"
          />

          <div className="min-w-0">
            <div className="text-sm md:text-base font-black text-foreground truncate max-w-[220px]">
              {stockName || stockInfoName || ticker}
            </div>
          </div>

          <Badge
            variant="outline"
            className={cn(
              'font-mono text-xs font-black px-2.5 py-1 border rounded-full',
              isUp
                ? 'bg-profit/10 text-profit border border-profit/20 border-profit'
                : 'bg-loss/10 text-loss border border-loss/20 border-loss',
            )}
          >
            {livePrice > 0 ? `${(livePrice ?? 0).toFixed(2)} ${currencyLabel}` : '—'}
            <span className="text-[10px] mr-1">
              ({isUp ? '+' : ''}{(chgPct ?? 0).toFixed(1)}%)
            </span>
          </Badge>

          {confluence?.signal && (
            <Badge
              style={{ backgroundColor: confluence.signal_color || '#10b981' }}
              className="text-foreground text-[10px] font-bold px-2.5 py-1 shadow-sm rounded-full"
            >
              {confluence.signal} ({confluence.score?.toFixed(1)}/10)
            </Badge>
          )}

          {isLive && (
            <Badge
              className={cn(
                'text-[9px] font-bold rounded-full',
                liveDelayedMode
                  ? 'bg-warning text-white border border-warning'
                  : 'bg-loss text-white animate-pulse',
              )}
            >
              {liveDelayedMode ? `DELAYED ${liveDelayedMinutes || 5}M` : 'LIVE'}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex bg-muted border border-border rounded-xl p-0.5 text-[10px] font-semibold gap-1">
            {[
              { label: '5M', key: '5M' as const },
              { label: '15M', key: '15M' as const },
              { label: '1H', key: '1H' as const },
              { label: 'يومي', key: 'DAY' as const },
              { label: 'أسبوعي', key: 'WEEK' as const },
              { label: 'شهري', key: 'MONTH' as const },
            ].map((tf) => (
              <button
                key={tf.key}
                type="button"
                onClick={() => onTimeframeChange(tf.key)}
                className={cn(
                  'px-2 py-1 rounded-lg transition-colors',
                  timeframe === tf.key
                    ? 'bg-profit text-white font-bold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-muted border border-border rounded-xl p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => onChartEngineChange('tradingview_widget')}
              className={cn(
                'px-2 py-1 rounded-lg transition-all font-semibold flex items-center gap-1',
                chartEngine === 'tradingview_widget'
                  ? 'bg-card text-profit shadow-sm'
                  : 'text-muted-foreground',
              )}
              title="عرض شارت TradingView الأصلي الرسمي مباشرة"
            >
              <span>TradingView الأصلي</span>
            </button>
            <button
              type="button"
              onClick={() => onChartEngineChange('native')}
              className={cn(
                'px-2 py-1 rounded-lg transition-all font-semibold flex items-center gap-1',
                chartEngine === 'native'
                  ? 'bg-card text-whale shadow-sm'
                  : 'text-muted-foreground',
              )}
              title="عرض شارت الذكاء الاصطناعي مع مستويات SMC ومصايد الحيتان"
            >
              <span>شارت الذكاء (SMC)</span>
            </button>
          </div>

          <div className="flex items-center gap-1 bg-muted border border-border rounded-xl p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => onAdvancedModeChange(false)}
              className={cn(
                'px-2 py-1 rounded-lg transition-all font-semibold',
                !advancedMode ? 'bg-card text-profit shadow-sm' : 'text-muted-foreground',
              )}
            >
              مبسط
            </button>
            <button
              type="button"
              onClick={() => onAdvancedModeChange(true)}
              className={cn(
                'px-2 py-1 rounded-lg transition-all font-semibold',
                advancedMode ? 'bg-card text-whale shadow-sm' : 'text-muted-foreground',
              )}
            >
              محترفين
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenAlertPanel}
            className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-warning hover:text-warning relative"
          >
            {activeAlertsCount > 0 ? (
              <BellRing className="h-3.5 w-3.5 text-warning" />
            ) : (
              <Bell className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onQuickAddAlert}
            disabled={quickAdding || livePrice <= 0}
            className={cn(
              'h-8 w-8 p-0 rounded-lg',
              quickAdded
                ? 'text-profit hover:bg-profit'
                : 'text-muted-foreground hover:bg-warning',
            )}
          >
            {quickAdding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : quickAdded ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Star className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleMaximize}
            className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-muted"
          >
            {isMaximized ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onScreenshot}
            disabled={screenshotting}
            className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-muted"
          >
            {screenshotting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ImageIcon className="w-3.5 h-3.5" />
            )}
          </Button>
          {canRemove && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-loss hover:text-loss"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 text-[10px] flex-wrap">
        <span className="text-muted-foreground font-bold">وضعي:</span>
        <div className="flex bg-card border border-border rounded-xl p-0.5">
          <button
            type="button"
            onClick={() => onUserStateChange('buyer')}
            className={cn(
              'px-2 py-1 rounded-lg transition-all font-semibold',
              userState === 'buyer'
                ? 'bg-profit/10 text-profit border border-profit/20'
                : 'text-muted-foreground',
            )}
          >
            <ShoppingCart className="w-3 h-3 inline ml-1" /> أبحث عن شراء
          </button>
          <button
            type="button"
            onClick={() => onUserStateChange('owner')}
            className={cn(
              'px-2 py-1 rounded-lg transition-all font-semibold',
              userState === 'owner'
                ? 'bg-warning/10 text-warning dark:text-warning border border-warning/20'
                : 'text-muted-foreground',
            )}
          >
            <Wallet className="w-3 h-3 inline ml-1" /> {isCrypto ? 'أملك العملة' : 'أملك السهم'}
          </button>
        </div>
        {adjustmentReason && (
          <span className="text-muted-foreground truncate max-w-md">💡 {adjustmentReason}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border text-[10px]">
        <span className="text-muted-foreground font-bold">المؤشرات:</span>
        {[
          { label: 'MA20', key: 'sma20' },
          { label: 'MA50', key: 'sma50' },
          { label: 'MA200', key: 'sma200' },
          { label: 'EMA', key: 'ema' },
          { label: 'RSI', key: 'rsi' },
          { label: 'Bollinger', key: 'bb' },
          { label: 'MACD', key: 'macd' },
          { label: 'Volume', key: 'volume' },
          { label: 'Levels', key: 'levels' },
          { label: 'SMC/BOS', key: 'bos' },
        ].map((ind) => (
          <button
            key={ind.key}
            type="button"
            onClick={() => onToggleIndicator(ind.key)}
            className={cn(
              'px-1.5 py-1 rounded-lg border transition-all font-mono',
              (visibleIndicators as Record<string, boolean>)[ind.key]
                ? 'bg-profit/10 text-profit border border-profit/20 border-profit font-bold'
                : 'bg-muted text-muted-foreground border-border hover:bg-muted',
            )}
          >
            {(visibleIndicators as Record<string, boolean>)[ind.key] ? '✓ ' : ''}
            {ind.label}
          </button>
        ))}
      </div>
    </CardHeader>
  );
}

// Re-export for convenience
export { DEFAULT_VISIBLE_INDICATORS };
