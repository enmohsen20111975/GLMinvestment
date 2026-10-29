/**
 * single-stock/AdvancedBreakdown.tsx
 * ===================================
 * Row 2 — Advanced mode technical breakdown (visible only when "وضع المحترفين"
 * is active). Renders 4-column grid:
 *   - SMC analysis (bias + nearest OB + nearest FVG)
 *   - Candlestick patterns
 *   - Liquidity sweeps
 *   - Technical indicators deep (RSI / MACD / SMA20/50 / ATR)
 *   - Fusion metrics
 *   - Fundamental valuation (P/E, EPS, ROE) — Rule 27 NO-FAKE-DATA
 *
 * Extracted from SingleStockAnalysisView.tsx (1,548 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import type { FullAnalysisResponse } from './types';

export interface AdvancedBreakdownProps {
  data: FullAnalysisResponse;
  currencyLabel: string;
}

export function AdvancedBreakdown({ data, currencyLabel }: AdvancedBreakdownProps) {
  const smc_analysis: any = data.smc_analysis;
  const candlestick_patterns: any = data.candlestick_patterns;
  const current_indicators: any = data.current_indicators;
  const fusion_metrics: any = data.fusion_metrics;
  const fundamentals: any = data.fundamentals;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 pt-1">
      {/* SMC & Order Blocks */}
      {smc_analysis && (
        <div className="p-3 rounded-lg bg-whale/10 border border-whale/20 space-y-1">
          <span className="font-bold text-[11px] block border-b border-whale/20 text-whale dark:text-whale">
            🏛️ تحليل سلوك السيولة (SMC):
          </span>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">الاتجاه الهيكلي:</span>
            <span className="font-bold text-whale dark:text-whale">
              {smc_analysis.bias_ar || 'متوازن'}
            </span>
          </div>
          {smc_analysis.nearest_ob && (
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Order Block:</span>
              <span className="font-mono font-bold text-foreground">
                {smc_analysis.nearest_ob.price} {currencyLabel} (
                {smc_analysis.nearest_ob.type})
              </span>
            </div>
          )}
          {smc_analysis.nearest_fvg && (
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">فجوة FVG:</span>
              <span className="font-mono font-bold text-foreground">
                {smc_analysis.nearest_fvg.bottom} -{' '}
                {smc_analysis.nearest_fvg.top}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Candlestick Patterns — للخبراء */}
      {candlestick_patterns && candlestick_patterns.length > 0 && (
        <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 space-y-1">
          <span className="font-bold text-[11px] block border-b border-warning/20 text-warning dark:text-warning">
            🕯️ الأنماط اليابانية المكتشفة:
          </span>
          {candlestick_patterns.slice(0, 5).map((p, i) => (
            <div key={i} className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">{p.name_ar || p.name}</span>
              <span
                className={`font-bold ${
                  p.signal === 'bullish'
                    ? 'text-profit dark:text-profit'
                    : p.signal === 'bearish'
                      ? 'text-loss dark:text-loss'
                      : 'text-muted-foreground'
                }`}
              >
                {p.signal === 'bullish' ? 'صعودي' : p.signal === 'bearish' ? 'هبوطي' : 'محايد'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Liquidity Sweeps — للخبراء */}
      {smc_analysis?.liquidity_sweeps &&
        smc_analysis.liquidity_sweeps.length > 0 && (
          <div className="p-3 rounded-lg bg-primary/10 border border-purple-500/30 space-y-1">
            <span className="font-bold text-[11px] block border-b border-purple-500/30 text-primary dark:text-primary">
              💧 سحب السيولة (Liquidity Sweeps):
            </span>
            {smc_analysis.liquidity_sweeps.slice(0, 3).map((s, i) => (
              <div key={i} className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">
                  {s.type === 'bullish_sweep' ? 'سحب بيعي (صعودي)' : 'سحب شرائي (هبوطي)'}
                </span>
                <span className="font-mono font-bold text-foreground">
                  {s.price} {currencyLabel}
                </span>
              </div>
            ))}
          </div>
        )}

      {/* Technical Indicators Deep Breakdown */}
      {current_indicators && (
        <div className="p-3 rounded-lg bg-whale/10 border border-whale/20 space-y-1">
          <span className="font-bold text-[11px] block border-b border-whale/20 text-whale">
            📊 المؤشرات الفنية التفصيلية:
          </span>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">RSI (14):</span>
            <span className="font-mono font-bold text-foreground">
              {current_indicators.rsi?.toFixed(1) || '50.0'}
            </span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">MACD Trend:</span>
            <span className="font-bold text-foreground truncate max-w-[100px]">
              {current_indicators.macd_trend_ar || 'حيادي'}
            </span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">SMA 20 / 50:</span>
            <span className="font-mono text-foreground">
              {current_indicators?.sma20 != null
                ? Number(current_indicators.sma20).toFixed(2)
                : '—'}{' '}
              /{' '}
              {current_indicators?.sma50 != null
                ? Number(current_indicators.sma50).toFixed(2)
                : '—'}
            </span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">التقلب (ATR):</span>
            <span className="font-mono text-foreground">
              {current_indicators.atr?.toFixed(2) || '—'}
            </span>
          </div>
        </div>
      )}

      {/* V20 Fusion Metrics */}
      {fusion_metrics && (
        <div className="p-3 rounded-lg bg-primary/10 border border-purple-500/30 space-y-1">
          <span className="font-bold text-[11px] block border-b border-purple-500/30 text-primary dark:text-primary">
            التحليل الفني الموحد:
          </span>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">درجة النموذج:</span>
            <span className="font-mono font-bold text-primary dark:text-primary">
              {fusion_metrics.fusion_score?.toFixed(1) || '0.0'}/10
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground leading-tight pt-0.5">
            {fusion_metrics.summary_ar || 'تحليل فني شامل'}
          </div>
        </div>
      )}

      {/* Fundamental Valuation */}
      <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 space-y-1">
        <span className="font-bold text-[11px] block border-b border-warning/20 text-warning dark:text-warning">
          🏛️ التقييم والتحليل الأساسي:
        </span>
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground">مكرر الربحية (P/E):</span>
          <span className="font-mono font-bold text-foreground">
            {fundamentals?.valuation?.pe_ratio != null
              ? `${Number(fundamentals?.valuation?.pe_ratio).toFixed(2)}x`
              : '— بيانات غير متاحة'}
          </span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground">ربحية السهم (EPS):</span>
          <span className="font-mono text-foreground">
            {fundamentals?.profitability?.eps != null
              ? `${Number(fundamentals?.profitability?.eps).toFixed(2)} ${currencyLabel}`
              : '— بيانات غير متاحة'}
          </span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground">العائد على الاستثمار:</span>
          <span className="font-mono text-foreground">
            {fundamentals?.profitability?.roe != null
              ? `${Number(fundamentals?.profitability?.roe).toFixed(1)}%`
              : '— بيانات غير متاحة'}
          </span>
        </div>
      </div>
    </div>
  );
}
