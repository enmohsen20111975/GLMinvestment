/**
 * single-stock/InsightCards.tsx
 * ==============================
 * Row 1.5 — two insight cards visible in both simple & advanced modes:
 *   1. 🔮 توقع الشمعة الجاية (Candle Probability card)
 *   2. 🧬 بصمة السهم (Stock DNA card)
 *
 * Extracted from SingleStockAnalysisView.tsx (1,548 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CandleProbabilities, StockDNA } from './types';

export interface InsightCardsProps {
  ticker: string;
  candleProbabilities?: CandleProbabilities | null;
  stockDna?: StockDNA | null;
}

export function InsightCards({ ticker, candleProbabilities, stockDna }: InsightCardsProps) {
  if (!candleProbabilities && !stockDna) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 pt-1" dir="rtl">
      {candleProbabilities && <CandleProbabilityCard cp={candleProbabilities} />}
      {stockDna && <StockDnaCard dna={stockDna} ticker={ticker} />}
    </div>
  );
}

function CandleProbabilityCard({ cp }: { cp: CandleProbabilities }) {
  const upPct = Math.max(0, Math.min(100, cp.up_prob ?? 0));
  const dnPct = Math.max(0, Math.min(100, cp.dn_prob ?? 0));
  return (
    <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
      <CardHeader className="p-3 pb-2 border-b border-border/40 bg-muted/20">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
            <span>🔮</span>
            <span>توقع الشمعة الجاية</span>
          </span>
          <Badge
            style={{ backgroundColor: cp.bias_color || '#6b7280', color: '#ffffff' }}
            className="text-[10px] font-bold shadow-xs"
          >
            {cp.bias_emoji} {cp.bias}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-2.5 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center p-2 rounded-lg bg-profit/10 border border-profit/20">
            <div className="text-[10px] text-profit dark:text-profit font-bold mb-0.5">
              🟢 صعود
            </div>
            <div className="text-2xl font-black text-profit dark:text-profit font-mono leading-none">
              {(upPct ?? 0).toFixed(1)}%
            </div>
          </div>
          <div className="text-center p-2 rounded-lg bg-loss/10 border border-loss/20">
            <div className="text-[10px] text-loss dark:text-loss font-bold mb-0.5">🔴 هبوط</div>
            <div className="text-2xl font-black text-loss dark:text-loss font-mono leading-none">
              {(dnPct ?? 0).toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="flex h-3 rounded-full overflow-hidden bg-muted border border-border/40">
          <div
            className="bg-profit transition-all duration-500"
            style={{ width: `${upPct}%` }}
            title={`صعود ${(upPct ?? 0).toFixed(1)}%`}
          />
          <div
            className="bg-loss transition-all duration-500"
            style={{ width: `${dnPct}%` }}
            title={`هبوط ${(dnPct ?? 0).toFixed(1)}%`}
          />
        </div>

        <div
          className="text-center text-sm font-bold py-1 rounded bg-muted/30"
          style={{ color: cp.bias_color || '#6b7280' }}
        >
          الميل العام: {cp.bias} {cp.bias_emoji}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div className="p-1.5 rounded bg-profit/5 border border-profit/20">
            <div className="text-[10px] text-profit dark:text-profit font-bold mb-1">
              📈 احتمال كسر القمة السابقة ({cp.prev_high?.toFixed(2)})
            </div>
            <div className="font-mono text-[10px] text-foreground/80 space-y-0.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">+0%:</span>
                <span className="text-profit font-bold">{cp.break_high_0pct?.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">+1%:</span>
                <span className="text-profit font-bold">{cp.break_high_1pct?.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">+2%:</span>
                <span className="text-profit font-bold">{cp.break_high_2pct?.toFixed(1)}%</span>
              </div>
            </div>
          </div>
          <div className="p-1.5 rounded bg-loss/5 border border-loss/20">
            <div className="text-[10px] text-loss dark:text-loss font-bold mb-1">
              📉 احتمال كسر القاع السابق ({cp.prev_low?.toFixed(2)})
            </div>
            <div className="font-mono text-[10px] text-foreground/80 space-y-0.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">-0%:</span>
                <span className="text-loss font-bold">{cp.break_low_0pct?.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">-1%:</span>
                <span className="text-loss font-bold">{cp.break_low_1pct?.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">-2%:</span>
                <span className="text-loss font-bold">{cp.break_low_2pct?.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1 text-center">
          <div className="p-1 rounded bg-profit/10 border border-profit/20">
            <div className="text-[9px] text-muted-foreground">هدف +1%</div>
            <div className="font-mono font-bold text-profit text-[11px]">
              {cp.target_up_1pct?.toFixed(2) ?? '—'}
            </div>
          </div>
          <div className="p-1 rounded bg-profit/10 border border-profit/20">
            <div className="text-[9px] text-muted-foreground">هدف +2%</div>
            <div className="font-mono font-bold text-profit text-[11px]">
              {cp.target_up_2pct?.toFixed(2) ?? '—'}
            </div>
          </div>
          <div className="p-1 rounded bg-loss/10 border border-loss/20">
            <div className="text-[9px] text-muted-foreground">هدف -1%</div>
            <div className="font-mono font-bold text-loss text-[11px]">
              {cp.target_dn_1pct?.toFixed(2) ?? '—'}
            </div>
          </div>
          <div className="p-1 rounded bg-loss/10 border border-loss/20">
            <div className="text-[9px] text-muted-foreground">هدف -2%</div>
            <div className="font-mono font-bold text-loss text-[11px]">
              {cp.target_dn_2pct?.toFixed(2) ?? '—'}
            </div>
          </div>
        </div>

        <div className="text-[10px] text-muted-foreground text-center pt-1 border-t border-border/40">
          الشمعة السابقة:{' '}
          <strong className={cp.prev_candle === 'خضراء' ? 'text-profit' : 'text-loss'}>
            {cp.prev_candle}
          </strong>{' '}
          | الثقة: <strong className="text-foreground">{cp.confidence}</strong> | عينة:{' '}
          <strong className="text-foreground">{cp.sample_size}</strong> شمعة
          <span className="text-muted-foreground/70">
            {' '}
            (🟢 {cp.total_green} / 🔴 {cp.total_red})
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function StockDnaCard({ dna, ticker }: { dna: StockDNA; ticker: string }) {
  const tr = dna.typical_range;
  const positionPct = Math.max(0, Math.min(100, tr?.position_pct ?? 0));
  return (
    <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
      <CardHeader className="p-3 pb-2 border-b border-border/40 bg-muted/20 space-y-1">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
              <span>🧬</span>
              <span>بصمة السهم: {dna.name || dna.ticker || ticker}</span>
            </div>
            {dna.summary && (
              <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                {dna.summary}
              </div>
            )}
          </div>
          {dna.personality_type && (
            <Badge
              className="bg-warning/15 text-warning dark:text-warning border border-warning/20 text-[10px] font-bold shrink-0"
              title={dna.personality_type_en || dna.personality_type}
            >
              {dna.personality_type}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-2.5 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <div className="p-1.5 rounded bg-muted/40 border border-border/40">
            <span className="text-[10px] text-muted-foreground block">التذبذب</span>
            <span className="font-bold text-foreground text-[11px]">{dna.volatility || '—'}</span>
          </div>
          <div className="p-1.5 rounded bg-muted/40 border border-border/40">
            <span className="text-[10px] text-muted-foreground block">العائد السنوي</span>
            <span
              className={cn(
                'font-bold font-mono text-[11px]',
                dna.annual_return === null
                  ? 'text-muted-foreground'
                  : dna.annual_return >= 0
                    ? 'text-profit'
                    : 'text-loss',
              )}
            >
              {dna.annual_return !== null
                ? `${dna.annual_return >= 0 ? '+' : ''}${(dna.annual_return ?? 0).toFixed(1)}%`
                : '—'}
            </span>
          </div>
          <div className="p-1.5 rounded bg-profit/5 border border-profit/20">
            <span className="text-[10px] text-muted-foreground block">أفضل يوم</span>
            <span className="font-bold text-profit dark:text-profit text-[11px]">
              {dna.best_weekday || '—'}
            </span>
          </div>
          <div className="p-1.5 rounded bg-loss/5 border border-loss/20">
            <span className="text-[10px] text-muted-foreground block">أضعف يوم</span>
            <span className="font-bold text-loss dark:text-loss text-[11px]">
              {dna.worst_weekday || '—'}
            </span>
          </div>
        </div>

        {tr && (
          <div className="p-2 rounded bg-muted/30 border border-border/40 text-[10px]">
            <div className="flex justify-between mb-1">
              <span className="text-muted-foreground">النطاق المعتاد:</span>
              <span className="font-mono text-foreground">
                {tr.min?.toFixed(2)} — {tr.max?.toFixed(2)}
              </span>
            </div>
            <div className="relative h-2.5 rounded-full border border-border/40">
              <div
                className="absolute top-1/2 -translate-y-1/2 h-3.5 w-1 bg-foreground rounded-sm shadow-sm transition-all"
                style={{
                  right: `${positionPct}%`,
                  transform: 'translateX(50%) translateY(-50%)',
                }}
                title={`السعر الحالي: ${tr.current?.toFixed(2)}`}
              />
            </div>
            <div className="flex justify-between mt-1 text-[9px]">
              <span className="text-muted-foreground">
                السعر الحالي:{' '}
                <strong className="font-mono text-foreground">{tr.current?.toFixed(2)}</strong>
              </span>
              <span className="text-muted-foreground">
                {tr.current_position || '—'} ({(positionPct ?? 0).toFixed(0)}%)
              </span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {dna.best_months && dna.best_months.length > 0 && (
            <div className="p-1.5 rounded bg-profit/5 border border-profit/20">
              <div className="text-[10px] text-profit dark:text-profit font-bold mb-1">
                🏆 أفضل الشهور:
              </div>
              <div className="flex flex-wrap gap-1">
                {dna.best_months.map((m) => (
                  <Badge
                    key={`bm-${m.month_num}`}
                    className="bg-profit/15 text-profit dark:text-profit border border-profit/20 text-[9px] font-bold"
                  >
                    {m.month} <span className="font-mono">+{(m.avg_change ?? 0).toFixed(1)}%</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {dna.worst_months && dna.worst_months.length > 0 && (
            <div className="p-1.5 rounded bg-loss/5 border border-loss/20">
              <div className="text-[10px] text-loss dark:text-loss font-bold mb-1">
                ⚠️ أضعف الشهور:
              </div>
              <div className="flex flex-wrap gap-1">
                {dna.worst_months.map((m) => (
                  <Badge
                    key={`wm-${m.month_num}`}
                    className="bg-loss/15 text-loss dark:text-loss border border-loss/20 text-[9px] font-bold"
                  >
                    {m.month} <span className="font-mono">{(m.avg_change ?? 0).toFixed(1)}%</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {dna.behavioral_tags && dna.behavioral_tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {dna.behavioral_tags.map((tag, i) => (
              <Badge
                key={`tag-${i}`}
                variant="outline"
                className="text-[9px] font-semibold border-border bg-muted/40 text-foreground/80"
              >
                #{tag}
              </Badge>
            ))}
          </div>
        )}

        {dna.dividend_timing && (
          <div className="text-[10px] text-muted-foreground p-1.5 rounded bg-muted/30 border border-border/30">
            💰 <strong className="text-foreground">توقيت التوزيعات:</strong> {dna.dividend_timing}
          </div>
        )}

        {dna.narrative && (
          <div className="p-2 rounded bg-muted/30 border border-border/40 text-[10px] text-foreground/80 whitespace-pre-line leading-relaxed max-h-60 overflow-y-auto">
            {dna.narrative}
          </div>
        )}

        <div className="text-[9px] text-muted-foreground text-center pt-1 border-t border-border/40">
          القطاع: <strong className="text-foreground">{dna.sector || '—'}</strong> | عينة:{' '}
          <strong className="text-foreground">{dna.sample_months ?? 0}</strong> شهر | الثقة:{' '}
          <strong className="text-foreground">{dna.confidence || '—'}</strong>
        </div>
      </CardContent>
    </Card>
  );
}
