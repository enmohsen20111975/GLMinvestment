/**
 * single-stock/ExecutiveSummary.tsx
 * =================================
 * Row 1 — Executive Summary card (confluence score + signal + confidence +
 * analysis_text + COHERENCE-FIX note) + Trade Plan card (entry/target/sl/TP2
 * + R:R + suggested position size).
 *
 * Extracted from SingleStockAnalysisView.tsx (1,548 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { FullAnalysisResponse, PredictionContext } from './types';

export interface ExecutiveSummaryProps {
  data: FullAnalysisResponse;
  currencyLabel: string;
  predictionContext?: PredictionContext;
}

export function ExecutiveSummary({ data, currencyLabel, predictionContext }: ExecutiveSummaryProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {/* Score Card & Confluence — الملخص التنفيذي */}
      <div className="p-3 rounded-lg bg-profit/10 border border-profit/20 space-y-1.5">
        <div className="flex justify-between items-center font-bold text-[11px]">
          <span className="text-profit dark:text-profit">📋 الملخص التنفيذي:</span>
          <span className="font-mono text-profit dark:text-profit font-black text-base">
            {data.confluence?.score?.toFixed(1) || '0.0'}/10
          </span>
        </div>
        <Badge
          style={{ backgroundColor: data.confluence?.signal_color || '#10b981' }}
          className="text-foreground text-xs font-bold w-full justify-center py-1 shadow-xs"
        >
          {data.confluence?.signal || 'حيادي'}
        </Badge>
        {data.confidence != null && (
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>درجة الثقة:</span>
            <span className="font-bold text-foreground">{(data.confidence ?? 0).toFixed(0)}%</span>
          </div>
        )}
        {data.analysis_text && (
          <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
            💡 <span className="font-bold text-foreground">السبب:</span> {data.analysis_text}
          </p>
        )}
        {predictionContext && data?.confluence && (
          <div className="text-[10px] text-muted-foreground mt-1">
            النتيجة الشاملة ({data.confluence.score?.toFixed(1)}/10) من محرك التحليل الفني —
            التوقّع النشط ({(predictionContext.score ?? 0).toFixed(0)}/100) من نظام التحليل.
          </div>
        )}
      </div>

      {/* Trade Plan (سعر الدخول / الهدف / الوقف / الهدف الثاني) */}
      {data.risk && (
        <div className="p-3 rounded-lg bg-card border border-border space-y-2">
          <span className="font-bold text-[11px] block border-b border-border pb-1 text-foreground">
            🎯 خطة التداول (Trade Plan):
          </span>
          <div className="grid grid-cols-3 gap-1.5 text-center font-mono">
            <div className="p-1.5 rounded bg-muted/40">
              <span className="text-[9px] text-muted-foreground block font-sans">سعر الدخول</span>
              <span className="font-bold text-xs">
                {data.risk.entry?.toFixed(2)} {currencyLabel}
              </span>
            </div>
            <div className="p-1.5 rounded bg-profit/10 text-profit dark:text-profit">
              <span className="text-[9px] block font-sans">🎯 الهدف 1</span>
              <span className="font-bold text-xs">
                {data.risk.target?.toFixed(2)} {currencyLabel}
              </span>
            </div>
            <div className="p-1.5 rounded bg-loss/10 text-loss dark:text-loss">
              <span className="text-[9px] block font-sans">🛑 الوقف</span>
              <span className="font-bold text-xs">
                {data.risk.stop_loss?.toFixed(2)} {currencyLabel}
              </span>
            </div>
          </div>
          {data.risk.target_2 && (
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>الهدف الثاني (TP2):</span>
              <span className="font-mono font-bold text-profit dark:text-profit">
                {(data.risk.target_2 ?? 0).toFixed(2)} {currencyLabel}
              </span>
            </div>
          )}
          <div className="flex justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40">
            <span>
              R:R: <strong className="font-mono text-foreground">
                {data.risk.rr_ratio?.toFixed(2)}R
              </strong>
            </span>
            {data.suggested_position_size_pct && (
              <span>
                حجم المحفظة:{' '}
                <strong className="font-mono text-profit">
                  {data.suggested_position_size_pct}%
                </strong>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
