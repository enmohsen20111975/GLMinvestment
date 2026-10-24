'use client';

/**
 * persona/StockDetailPanel.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — StockDetailPanel component (extracted verbatim).
 * ----------------------------------------------------------------------------
 * Originally lines 1032-1453 of `../PersonaTab.tsx`. Per-stock drill-down panel
 * shown when a user clicks a row in PersonaTableView or a PersonaCard.
 *
 * Tabs:
 *   - details: grid of 8 stock metrics (price / change / volume / sector /
 *     P/E / P/B / market cap / verdict).
 *   - chart: TradingChartViewDynamic (lazy-loaded with Skeleton fallback).
 *   - verdict: entry/target/stop grid + reasons + conditions.
 *
 * P43-VIRAL-SHARE: 3 share actions:
 *   - نسخ شامل (copy comprehensive text to clipboard)
 *   - بطاقة تحليل (download 800x600 Telegram-ready PNG)
 *   - صورة الشارت (download chart container as PNG)
 *
 * The hidden analysis-card PNG is rendered off-screen at position
 * left:-99999px and captured via `toPng` from `html-to-image`.
 * ============================================================================
 */

import React, { useState, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import dynamic from 'next/dynamic';
import { Loader2, ArrowRight, FileText, Camera, Image as ImageIcon } from 'lucide-react';
import { toPng } from 'html-to-image';
import { MARKET_CURRENCY_LABEL } from '@/lib/store';
import { toast } from 'sonner';
import { cn, formatNumber } from '@/lib/utils';
import type { StockDetailPanelProps } from './types';
import { getPersonaJsonKey, cleanTicker } from './helpers';
import {
  pickValidPrice,
  formatVolumeShort,
  formatComprehensiveStockText,
} from '../helpers';

// NOTE: PHASE3-BUNDLE-OPT — dynamic imports relocated from MarketAnalysisView.tsx.
// Relative paths point two directories up since this file lives in
// market-analysis/components/persona/.
const TradingChartViewDynamic = dynamic(
  () => import('@/modules/stock-analysis/components/TradingChartView').then((m) => ({ default: m.TradingChartView })),
  { ssr: false, loading: () => <Skeleton className="h-[500px] w-full rounded-xl" /> }
);

export function StockDetailPanel({
  item,
  persona,
  market,
  subTab,
  onSubTabChange,
  onBack,
  stockDetail,
}: StockDetailPanelProps) {
  const currencyLabel = MARKET_CURRENCY_LABEL[market] || 'ج.م';
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson + fallback للحقول العلوية للسهم
  const _personaKey = getPersonaJsonKey(persona);
  const pd =
    item.analysisJson?.[_personaKey] || {
      verdict: item.recommendationAr || '',
      score: item.maestroScore || 0,
      reason: '',
      signal: item.recommendation || 'HOLD',
      entry: item.entry?.price ?? null,
      target: item.entry?.target ?? null,
      stop: item.entry?.stopLoss ?? null,
      timeframe:
        persona === 'balanced'
          ? '2-6 أسابيع'
          : persona === 'conservative'
            ? '6-12 شهر'
            : '1-5 أيام',
    };
  const ticker = cleanTicker(item.ticker);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const analysisCardRef = useRef<HTMLDivElement>(null);
  const [capturingChart, setCapturingChart] = useState(false);
  const [capturingCard, setCapturingCard] = useState(false);

  // P43-VIRAL-SHARE: نسخ التحليل الشامل (نص غني + Footer ثابت)
  const handleCopyComprehensive = useCallback(() => {
    const text = formatComprehensiveStockText(item, market, stockDetail ?? undefined);
    navigator.clipboard.writeText(text);
    toast.success('تم نسخ التحليل الشامل ✓', {
      description: 'جاهز للّصق في تليجرام / فيسبوك / واتساب',
    });
  }, [item, market, stockDetail]);

  // P43-VIRAL-SHARE: التقاط صورة لكونتبر الشارت التفاعلي (Telegram-ready)
  const handleChartImage = useCallback(async () => {
    if (!chartContainerRef.current) {
      toast.error('افتح تبويب «الشارت» أولاً لالتقاط صورته');
      return;
    }
    setCapturingChart(true);
    try {
      const dataUrl = await toPng(chartContainerRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        skipFonts: true,
      });
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const link = document.createElement('a');
      link.download = `${ticker}-chart-${yyyy}-${mm}-${dd}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('تم تحميل صورة الشارت ✓');
    } catch (err) {
      console.error('[ChartImage] toPng error:', err);
      toast.error('فشل في التقاط صورة الشارت');
    } finally {
      setCapturingChart(false);
    }
  }, [ticker]);

  // P43-VIRAL-SHARE: توليد بطاقة تحليل مخصصة (800x600 Telegram-ready) + نسخ النص الشامل
  const handleAnalysisCard = useCallback(async () => {
    if (!analysisCardRef.current) {
      toast.error('البطاقة غير متاحة');
      return;
    }
    setCapturingCard(true);
    try {
      const dataUrl = await toPng(analysisCardRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#0f172a',
        cacheBust: true,
        skipFonts: true,
      });
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const link = document.createElement('a');
      link.download = `${ticker}-analysis-${yyyy}-${mm}-${dd}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // نسخ النص الشامل في نفس الوقت
      const text = formatComprehensiveStockText(item, market, stockDetail ?? undefined);
      try {
        await navigator.clipboard.writeText(text);
        toast.success('تم نسخ النص وتحميل بطاقة التحليل ✓', {
          description: 'شارك التوقع على تليجرام أو فيسبوك',
        });
      } catch {
        toast.success('تم تحميل بطاقة التحليل ✓');
      }
    } catch (err) {
      console.error('[AnalysisCard] toPng error:', err);
      toast.error('فشل في توليد بطاقة التحليل');
    } finally {
      setCapturingCard(false);
    }
  }, [item, market, stockDetail, ticker]);

  // بيانات للبطاقة المخفية
  const inv = item.analysisJson?.investor || {};
  const gam = item.analysisJson?.gambler || {};
  const activePd = pd;
  const price =
    pickValidPrice(stockDetail?.current_price, activePd.entry, inv.entry, gam.entry) || 0;
  const changePct = stockDetail?.change_percent != null ? stockDetail.change_percent : 0;
  const gates = activePd.gates;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowRight className="h-4 w-4" />
          رجوع
        </Button>
        <span className="font-bold text-lg">{ticker}</span>
        <span className="text-muted-foreground text-sm">{item.nameAr || item.name}</span>
        {/* P43-VIRAL-SHARE: أزرار النسخ الشامل + بطاقة التحليل + صورة الشارت */}
        <div className="flex items-center gap-2 mr-auto flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8"
            onClick={handleCopyComprehensive}
          >
            <FileText className="h-3.5 w-3.5" />
            نسخ شامل
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 border-profit text-profit hover:bg-profit dark:hover:bg-profit/20"
            onClick={handleAnalysisCard}
            disabled={capturingCard}
          >
            {capturingCard ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImageIcon className="h-3.5 w-3.5" />
            )}
            بطاقة تحليل
          </Button>
          {subTab === 'chart' && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 h-8 border-fuchsia-400 text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-950/20"
              onClick={handleChartImage}
              disabled={capturingChart}
            >
              {capturingChart ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
              صورة الشارت
            </Button>
          )}
        </div>
      </div>

      <Tabs
        value={subTab}
        onValueChange={(v) => onSubTabChange(v as 'details' | 'chart' | 'verdict')}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="details">بيانات السهم</TabsTrigger>
          <TabsTrigger value="chart">الشارت</TabsTrigger>
          <TabsTrigger value="verdict">التوقع</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardContent className="p-4 space-y-3">
              {!stockDetail ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">السعر وقت التحليل</p>
                    <p className="font-bold">
                      {stockDetail?.current_price
                        ? `${(stockDetail.current_price ?? 0).toFixed(2)} ${currencyLabel}`
                        : pd.entry
                          ? `${(pd.entry ?? 0).toFixed(2)} ${currencyLabel}`
                          : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">التغير</p>
                    <p className="font-bold">
                      {stockDetail?.change_percent != null
                        ? `${stockDetail.change_percent >= 0 ? '+' : ''}${stockDetail.change_percent.toFixed(2)}%`
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الحجم</p>
                    <p className="font-bold">
                      {stockDetail?.volume
                        ? formatVolumeShort(Number(stockDetail.volume) || 0)
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">القطاع</p>
                    <p className="font-bold">{stockDetail?.sector || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">P/E</p>
                    <p className="font-bold">
                      {stockDetail?.pe_ratio ? (stockDetail.pe_ratio ?? 0).toFixed(2) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">P/B</p>
                    <p className="font-bold">
                      {stockDetail?.pb_ratio ? (Number(stockDetail.pb_ratio) ?? 0).toFixed(2) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">القيمة السوقية</p>
                    <p className="font-bold">
                      {stockDetail?.market_cap
                        ? formatNumber(Number(stockDetail.market_cap) || 0)
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الرأي</p>
                    <p className="font-bold">{pd.verdict || '—'}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chart">
          <Card>
            <CardContent className="p-2">
              <div className="h-[65vh]" ref={chartContainerRef}>
                <TradingChartViewDynamic initialTicker={ticker} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verdict">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="space-y-2">
                <h4 className="font-semibold">التوقع</h4>
                <p className="text-lg font-bold">{pd.verdict || 'متابعة'}</p>
                <p className="text-sm text-muted-foreground">{pd.reason}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded bg-muted text-center">
                  <p className="text-xs text-muted-foreground">الدخول</p>
                  <p className="font-bold">{pd.entry ? (pd.entry ?? 0).toFixed(2) : '—'}</p>
                </div>
                <div className="p-3 rounded bg-muted text-center">
                  <p className="text-xs text-muted-foreground">الهدف</p>
                  <p className="font-bold text-profit">
                    {pd.target ? (pd.target ?? 0).toFixed(2) : '—'}
                  </p>
                </div>
                <div className="p-3 rounded bg-muted text-center">
                  <p className="text-xs text-muted-foreground">الوقف</p>
                  <p className="font-bold text-loss">{pd.stop ? (pd.stop ?? 0).toFixed(2) : '—'}</p>
                </div>
              </div>
              {pd.conditions && pd.conditions.length > 0 && (
                <div className="space-y-1">
                  <h5 className="text-sm font-semibold">الشروط</h5>
                  <ul className="list-disc list-inside text-sm text-muted-foreground">
                    {pd.conditions.slice(0, 5).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* P43-VIRAL-SHARE: بطاقة التحليل المخفية (800x600 Telegram-ready) للتصدير كصورة */}
      <div
        style={{ position: 'absolute', left: '-99999px', top: 0, pointerEvents: 'none' }}
        aria-hidden
      >
        <div
          ref={analysisCardRef}
          style={{
            width: '800px',
            minHeight: '600px',
            padding: '0',
            background: 'transparent',
            borderRadius: '20px',
            fontFamily: 'Arial, sans-serif',
            direction: 'rtl',
            color: '#f8fafc',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              background: 'transparent',
              padding: '20px 28px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: 'white',
                  marginBottom: '4px',
                }}
              >
                {ticker} · {item.nameAr || item.name || ticker}
              </div>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>
                تحليل شامل · المستثمر + المضارب
              </div>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  padding: '6px 14px',
                  borderRadius: '10px',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '13px',
                }}
              >
                دليل الاستثمار
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.7)',
                  marginTop: '4px',
                  textAlign: 'left',
                }}
                suppressHydrationWarning
              >
                {new Date().toLocaleDateString('ar-EG', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '24px 28px' }}>
            {/* Price + Change + Verdict */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '18px',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>السعر وقت التحليل</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fbbf24' }}>
                  {price ? (price ?? 0).toFixed(2) : '—'}{' '}
                  <span style={{ fontSize: '14px', color: '#94a3b8' }}>{currencyLabel}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>التغير اليومي</div>
                <div
                  style={{
                    fontSize: '20px',
                    fontWeight: 'bold',
                    color: changePct >= 0 ? '#10b981' : '#ef4444',
                  }}
                >
                  {changePct >= 0 ? '+' : ''}
                  {(changePct ?? 0).toFixed(2)}%
                </div>
              </div>
              <div
                style={{
                  padding: '8px 18px',
                  borderRadius: '12px',
                  background: (activePd.verdict || '').includes('شراء')
                    ? 'rgba(16,185,129,0.2)'
                    : (activePd.verdict || '').includes('بيع')
                      ? 'rgba(239,68,68,0.2)'
                      : 'rgba(245,158,11,0.2)',
                  color: (activePd.verdict || '').includes('شراء')
                    ? '#10b981'
                    : (activePd.verdict || '').includes('بيع')
                      ? '#ef4444'
                      : '#f59e0b',
                  fontWeight: 'bold',
                  fontSize: '16px',
                }}
              >
                {activePd.verdict || 'متابعة'}
              </div>
            </div>

            {/* Entry / Target / Stop grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                marginBottom: '18px',
              }}
            >
              <div
                style={{
                  background: 'rgba(251,191,36,0.1)',
                  padding: '12px',
                  borderRadius: '12px',
                  textAlign: 'center',
                  border: '1px solid rgba(251,191,36,0.2)',
                }}
              >
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>الدخول</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fbbf24' }}>
                  {activePd.entry ? (activePd.entry ?? 0).toFixed(2) : '—'}
                </div>
              </div>
              <div
                style={{
                  background: 'rgba(16,185,129,0.1)',
                  padding: '12px',
                  borderRadius: '12px',
                  textAlign: 'center',
                  border: '1px solid rgba(16,185,129,0.2)',
                }}
              >
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>الهدف</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981' }}>
                  {activePd.target ? (activePd.target ?? 0).toFixed(2) : '—'}
                </div>
              </div>
              <div
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  padding: '12px',
                  borderRadius: '12px',
                  textAlign: 'center',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}
              >
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>الوقف</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ef4444' }}>
                  {activePd.stop ? (activePd.stop ?? 0).toFixed(2) : '—'}
                </div>
              </div>
            </div>

            {/* Metrics row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '10px',
                marginBottom: '18px',
              }}
            >
              <div
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  padding: '10px',
                  borderRadius: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>R/R</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  1:{activePd.risk_reward ? (activePd.risk_reward ?? 0).toFixed(1) : '—'}
                </div>
              </div>
              <div
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  padding: '10px',
                  borderRadius: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>RSI</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  {activePd.rsi != null ? activePd.rsi.toFixed(0) : '—'}
                </div>
              </div>
              <div
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  padding: '10px',
                  borderRadius: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Score</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  {activePd.score != null ? activePd.score.toFixed(0) : '—'}
                </div>
              </div>
              <div
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  padding: '10px',
                  borderRadius: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Gates</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  {gates ? `${gates.passed}/5` : '—'}
                </div>
              </div>
            </div>

            {/* Reason */}
            {activePd.reason && (
              <div
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  color: '#cbd5e1',
                  marginBottom: '14px',
                  lineHeight: '1.6',
                }}
              >
                📝 {activePd.reason}
              </div>
            )}

            {/* Footer links */}
            <div
              style={{
                background: 'rgba(234,88,12,0.08)',
                borderRadius: '10px',
                padding: '12px 16px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '6px' }}>
                🔗 invist.m2y.net | ✈️ t.me/Arabian_investment_guide
              </div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>
                ⚠️ تعليمي فقط — ليس نصيحة استثمارية
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
