'use client';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChartControlsProps {
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  indicators: Record<string, boolean>;
  onIndicatorToggle: (key: string, value: boolean) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TIMEFRAMES = [
  { key: '5M', label: '5 دقائق' },
  { key: '15M', label: '15 دقيقة' },
  { key: '1H', label: 'ساعة' },
  { key: 'TODAY', label: 'اليوم (لحظي)' },
  { key: 'DAY', label: 'يوم' },
  { key: 'WEEK', label: 'أسبوع' },
  { key: 'MONTH', label: 'شهر' },
  { key: '3MONTH', label: '3 أشهر' },
  { key: '6MONTH', label: '6 أشهر' },
  { key: 'YEAR', label: 'سنة' },
  { key: 'ALL', label: 'الكل' },
] as const;

const INDICATOR_CONFIG: {
  key: string;
  label: string;
  color: string;
}[] = [
  { key: 'sma20', label: 'SMA20', color: '#f0b90b' },
  { key: 'sma50', label: 'SMA50', color: '#2196f3' },
  { key: 'sma200', label: 'SMA200', color: '#9c27b0' },
  { key: 'ema', label: 'EMA 9/21', color: '#ff6b6b' },
  { key: 'bb', label: 'Bollinger', color: '#e91e63' },
  { key: 'macd', label: 'MACD', color: '#2196f3' },
  { key: 'rsi', label: 'RSI', color: '#26a69a' },
  { key: 'cmf', label: 'CMF', color: '#ff9800' },
  { key: 'volume', label: 'الحجم', color: '#78909c' },
  { key: 'obv', label: 'OBV', color: '#ab47bc' },
  { key: 'fibonacci', label: 'فيبوناتشي', color: '#ffd700' },
  { key: 'levels', label: 'دعم/مقاومة', color: '#ffffff' },
  { key: 'bos', label: 'BOS', color: '#22c55e' },
];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function ChartControls({
  timeframe,
  onTimeframeChange,
  indicators,
  onIndicatorToggle,
}: ChartControlsProps) {
  return (
    <div className="sticky top-0 z-30 bg-card/95 backdrop-blur-sm text-card-foreground border border-border rounded-xl px-3 py-2 space-y-2 shadow-sm">
      {/* ---- Timeframe Row ---- */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground ml-1 shrink-0">
          الإطار الزمني
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          {TIMEFRAMES.map((tf) => (
            <Button
              key={tf.key}
              size="sm"
              variant="ghost"
              onClick={() => onTimeframeChange(tf.key)}
              className={cn(
                'h-7 min-w-[3rem] px-2.5 text-xs font-medium rounded-md transition-all',
                timeframe === tf.key
                  ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 font-bold hover:bg-cyan-500/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {tf.label}
            </Button>
          ))}
        </div>
      </div>

      <Separator className="bg-border" />

      {/* ---- Indicator Toggles ---- */}
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground shrink-0">
          المؤشرات
        </span>
        <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
          {INDICATOR_CONFIG.map((ind) => {
            const isActive = indicators[ind.key] ?? false;

            return (
              <label
                key={ind.key}
                className="flex items-center gap-1.5 cursor-pointer group"
              >
                {/* colored dot */}
                <span
                  className="size-2 rounded-full shrink-0 transition-opacity"
                  style={{
                    backgroundColor: ind.color,
                    opacity: isActive ? 1 : 0.35,
                  }}
                />
                {/* label */}
                <span
                  className={cn(
                    'text-[11px] transition-colors select-none',
                    isActive ? 'text-foreground font-semibold' : 'text-muted-foreground'
                  )}
                >
                  {ind.label}
                </span>
                {/* switch */}
                <Switch
                  checked={isActive}
                  onCheckedChange={(checked) =>
                    onIndicatorToggle(ind.key, checked)
                  }
                  className="scale-75 origin-right mr-[-2px]"
                  aria-label={ind.label}
                />
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}