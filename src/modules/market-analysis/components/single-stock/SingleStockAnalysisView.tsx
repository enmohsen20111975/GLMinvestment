/**
 * single-stock/SingleStockAnalysisView.tsx (container)
 * =====================================================
 * Main SingleStockAnalysisView container — the comprehensive single-stock
 * chart + analysis card with all AI insight panels.
 *
 * Originally 1,548 LOC (single file). Split into single-stock/ folder in
 * Task F-Phase3-FinalPush. Container now owns:
 *   - All state (ticker, timeframe, userState, data, canonical, loading, error,
 *     advancedMode, alertPanelOpen, isMaximized, quickAdding, screenshotting,
 *     chartEngine, visibleIndicators, userEntryPrice/Qty)
 *   - fetchData() — fetches /api/v2/chart/full-analysis (EGX) OR /api/crypto/full-analysis
 *     in parallel with the canonical unified-data fetch from /api/stocks/[ticker]/unified
 *     (Rule 73 SINGLE-DISPLAY-SOURCE)
 *   - handleQuickAddAlert() — POSTs /api/alerts/quick-add + registers in client store
 *   - handleScreenshot() — html-to-image download
 * UI is delegated to dedicated sub-components (ChartHeader, ChartContent,
 * ExecutiveSummary, InsightCards, AdvancedBreakdown) + the existing panels
 * (InstitutionalDecisionPanel, DealAdvisorPanel, AlertPanel, CanonicalWhoIsBuyingBanner).
 *
 * Reference:
 * - Constitution Rule 4 (NO-NEW-SCREENS): owner exception.
 * - Constitution Rule 27 (NO-FAKE-DATA): fundamentals show "— بيانات غير متاحة" when missing.
 * - Constitution Rule 30 (CLIENT-FACING-STYLE): Arabic labels.
 * - Constitution Rule 62 (GIT-PUSH-DISCIPLINE).
 * - Constitution Rule 73 (SINGLE-DISPLAY-SOURCE): unified data from /api/stocks/[ticker]/unified.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useAppStore, MARKET_CURRENCY_LABEL } from '@/lib/store';
import { useLiveTicker } from '@/lib/ws-client';
import { useAlertsStore } from '@/lib/alerts-store';
import {
  WhaleAlertListener,
} from '@/modules/market-analysis/components/LiveDashboard';
import { InstitutionalDecisionPanel } from '@/modules/market-analysis/components/InstitutionalDecisionPanel';
import { CanonicalWhoIsBuyingBanner } from '@/modules/market-analysis/components/CanonicalWhoIsBuyingBanner';
import { AlertPanel } from '@/modules/market-analysis/components/AlertPanel';
import { DealAdvisorPanel } from '@/components/deal-advisor/DealAdvisorPanel';
import { toast } from 'sonner';
import {
  buildAnalysisUrl,
  buildTvSymbol,
  captureCardScreenshot,
  quickAddAlert,
  timeframeToTvInterval,
} from './helpers';
import {
  DEFAULT_VISIBLE_INDICATORS,
  type CanonicalData,
  type ChartEngine,
  type FullAnalysisResponse,
  type SingleStockAnalysisViewProps,
  type VisibleIndicatorsMap,
} from './types';
import { ChartHeader } from './ChartHeader';
import { ChartContent } from './ChartContent';
import { ExecutiveSummary } from './ExecutiveSummary';
import { InsightCards } from './InsightCards';
import { AdvancedBreakdown } from './AdvancedBreakdown';

export function SingleStockAnalysisView({
  initialTicker,
  predictionContext,
  canRemove = false,
  onRemove,
  onTickerChange,
}: SingleStockAnalysisViewProps) {
  const { stocks, user, currentMarket, dealAdvisorPrefill } = useAppStore();
  const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket] || 'ج.م';
  const isCrypto = currentMarket === 'CRYPTO';
  const [ticker, setTicker] = useState(initialTicker);
  const [timeframe, setTimeframe] = useState<'5M' | '15M' | '1H' | 'DAY' | 'WEEK' | 'MONTH'>('DAY');
  const [userState, setUserState] = useState<'buyer' | 'owner'>('buyer');
  const [data, setData] = useState<FullAnalysisResponse | null>(null);
  const [canonical, setCanonical] = useState<CanonicalData>(null);
  const [canonicalLoading, setCanonicalLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [quickAdding, setQuickAdding] = useState(false);
  const [quickAdded, setQuickAdded] = useState(false);
  const [userEntryPrice, setUserEntryPrice] = useState(0);
  const [userEntryQty, setUserEntryQty] = useState(0);
  const [chartEngine, setChartEngine] = useState<ChartEngine>('tradingview_widget');
  const [visibleIndicators, setVisibleIndicators] = useState<VisibleIndicatorsMap>(
    DEFAULT_VISIBLE_INDICATORS,
  );

  const cardRef = useRef<HTMLDivElement>(null);
  const [screenshotting, setScreenshotting] = useState(false);

  const { liveData, isLive } = useLiveTicker(ticker);

  const activeAlertsCount = useAlertsStore(
    (s) => s.alerts.filter((a) => a.ticker === ticker.toUpperCase() && a.enabled).length,
  );
  const addAlert = useAlertsStore((s) => s.addAlert);

  const tvSymbol = useMemo(() => buildTvSymbol(ticker, currentMarket), [ticker, currentMarket]);
  const tvInterval = useMemo(() => timeframeToTvInterval(timeframe), [timeframe]);

  const fetchData = useCallback(
    async (
      tk: string,
      tf: string,
      state: 'buyer' | 'owner' = 'buyer',
      entryPrice?: number,
      entryQty?: number,
    ) => {
      setLoading(true);
      setError(null);
      if (!isCrypto) {
        setCanonicalLoading(true);
        fetch(`/api/stocks/${encodeURIComponent(tk)}/unified?market=${encodeURIComponent(currentMarket)}&_t=${Date.now()}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((json: CanonicalData) => setCanonical(json))
          .catch((e) => {
            console.warn('[canonical] unified fetch failed:', e);
            setCanonical(null);
          })
          .finally(() => setCanonicalLoading(false));
      } else {
        setCanonical(null);
      }
      try {
        const url = buildAnalysisUrl({
          ticker: tk,
          timeframe: tf,
          userState: state,
          isCrypto,
          userId: user?.id,
          entryPrice,
          entryQty,
        });
        const res = await fetch(url);
        const json = await res.json();
        if (!json.success && !json.ohlcv) {
          setError(json.error || `خطأ في تحميل بيانات ${tk}`);
          return;
        }
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    },
    [user?.id, isCrypto, currentMarket],
  );

  useEffect(() => {
    fetchData(ticker, timeframe, userState);
  }, [ticker, timeframe, userState, fetchData]);

  const handleSelectTicker = (newTk: string) => {
    setTicker(newTk);
    if (onTickerChange) onTickerChange(newTk);
  };

  const toggleIndicator = (key: string) => {
    setVisibleIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleScreenshot = useCallback(async () => {
    if (!cardRef.current) return;
    setScreenshotting(true);
    try {
      await captureCardScreenshot(cardRef.current, ticker);
    } catch (err) {
      console.error('Screenshot failed:', err);
      toast.error('فشل في التقاط الصورة');
    } finally {
      setScreenshotting(false);
    }
  }, [ticker]);

  const handleQuickAddAlert = useCallback(async () => {
    if (quickAdding) return;
    const stockInfo = stocks.find((s) => s.ticker === ticker.toUpperCase());
    const tc = liveData?.today_candle || data?.ohlcv?.[data.ohlcv.length - 1];
    const livePrice = liveData?.today_candle?.close ?? tc?.close ?? stockInfo?.current_price ?? 0;
    const refPrice = livePrice > 0 ? livePrice : (stockInfo?.current_price ?? 0);
    if (refPrice <= 0) {
      toast.error('لا يوجد سعر متاح لتسجيل التنبيه');
      return;
    }
    setQuickAdding(true);
    setQuickAdded(false);
    try {
      await quickAddAlert({ ticker, refPrice, addClientAlert: addAlert });
      setQuickAdded(true);
      setTimeout(() => setQuickAdded(false), 2000);
    } catch (err) {
      console.error('[QuickAddAlert] failed:', err);
      toast.error(err instanceof Error ? err.message : 'فشل تسجيل التنبيه');
    } finally {
      setQuickAdding(false);
    }
  }, [ticker, liveData, data, stocks, quickAdding, addAlert]);

  // ── Derived display values ────────────────────────────────────────────
  const stockInfo = stocks.find((s) => s.ticker === ticker.toUpperCase());
  const tc = liveData?.today_candle || data?.ohlcv?.[data.ohlcv.length - 1];
  const livePrice = liveData?.today_candle?.close ?? tc?.close ?? stockInfo?.current_price ?? 0;
  const prevClose = data?.ohlcv?.[data.ohlcv.length - 2]?.close ?? livePrice;
  const chgPct = prevClose > 0 ? ((livePrice - prevClose) / prevClose) * 100 : 0;
  const isUp = chgPct >= 0;
  const stockName = data?.name_ar || data?.name || stockInfo?.name_ar || stockInfo?.name || ticker;

  return (
    <div
      id={`chart-card-${ticker.toUpperCase()}`}
      ref={cardRef}
      className={cn(
        'border border-border shadow-[0_8px_30px_rgba(15,23,42,0.06)] bg-card transition-all duration-200 flex flex-col overflow-hidden rounded-2xl',
        isMaximized ? 'fixed inset-2 z-50 overflow-y-auto bg-card p-4' : 'w-full',
      )}
    >
      <WhaleAlertListener />

      {/* ════ CANONICAL BANNER: محرك القرار المؤسسي V60.2 — WHO IS BUYING? ════ */}
      {canonical && canonical.success && (
        <CanonicalWhoIsBuyingBanner data={canonical as any} currencyLabel={currencyLabel} />
      )}
      {canonicalLoading && (
        <div className="mb-3 p-3 rounded-lg border border-profit/20 bg-profit/10 dark:bg-profit/10 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-profit" />
          <span>جارٍ تحميل قرار المحرك المؤسسي الموحّد…</span>
        </div>
      )}

      {/* ════ COHERENCE-FIX: بانر التوقّع النشط ════ */}
      {predictionContext && (
        <div className="mb-3 p-3 rounded-lg border-2 border-profit/20 bg-profit/20 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-1 rounded-full bg-profit text-white">
              📊 توقّع نشط
            </span>
            <span
              className="font-bold text-sm"
              style={{ color: predictionContext.ratingColor || '#10b981' }}
            >
              {predictionContext.rating}
            </span>
            <span className="text-xs text-muted-foreground">
              (ثقة {(predictionContext.score ?? 0).toFixed(0)}%)
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {predictionContext.entryPrice && (
              <span>
                الدخول:{' '}
                <b className="font-mono">{(predictionContext.entryPrice ?? 0).toFixed(2)}</b>
              </span>
            )}
            {predictionContext.targetPrice && (
              <span className="text-profit">
                الهدف:{' '}
                <b className="font-mono">
                  {(predictionContext.targetPrice ?? 0).toFixed(2)}
                </b>
              </span>
            )}
            {predictionContext.stopLoss && (
              <span className="text-loss">
                الوقف:{' '}
                <b className="font-mono">{(predictionContext.stopLoss ?? 0).toFixed(2)}</b>
              </span>
            )}
            {predictionContext.riskReward && (
              <span>
                R/R: <b>{(predictionContext.riskReward ?? 0).toFixed(2)}</b>
              </span>
            )}
          </div>
        </div>
      )}

      <ChartHeader
        ticker={ticker}
        onSelectTicker={handleSelectTicker}
        stockName={data?.name_ar || data?.name}
        stockInfoName={stockInfo?.name_ar || stockInfo?.name}
        livePrice={livePrice}
        chgPct={chgPct}
        isUp={isUp}
        currencyLabel={currencyLabel}
        confluence={data?.confluence}
        isLive={isLive}
        liveDelayedMode={liveData?.delayed_mode}
        liveDelayedMinutes={liveData?.delayed_minutes}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        chartEngine={chartEngine}
        onChartEngineChange={setChartEngine}
        advancedMode={advancedMode}
        onAdvancedModeChange={setAdvancedMode}
        loading={loading}
        onRefresh={() => fetchData(ticker, timeframe, userState)}
        alertPanelOpen={alertPanelOpen}
        onOpenAlertPanel={() => setAlertPanelOpen(true)}
        activeAlertsCount={activeAlertsCount}
        quickAdding={quickAdding}
        quickAdded={quickAdded}
        onQuickAddAlert={handleQuickAddAlert}
        isMaximized={isMaximized}
        onToggleMaximize={() => setIsMaximized((v) => !v)}
        screenshotting={screenshotting}
        onScreenshot={handleScreenshot}
        canRemove={canRemove}
        onRemove={onRemove || (() => {})}
        userState={userState}
        onUserStateChange={setUserState}
        isCrypto={isCrypto}
        adjustmentReason={data?.adjustment_reason}
        visibleIndicators={visibleIndicators}
        onToggleIndicator={toggleIndicator}
      />

      <ChartContent
        ticker={ticker}
        stockName={stockName}
        chartEngine={chartEngine}
        tvSymbol={tvSymbol}
        tvInterval={tvInterval}
        loading={loading}
        error={error}
        data={data}
        livePrice={livePrice}
        chgPct={chgPct}
        isUp={isUp}
        currencyLabel={currencyLabel}
        todayCandle={tc || null}
        onRetry={() => fetchData(ticker, timeframe, userState)}
      />

      {/* ─── Detailed Accordions / Cards ─── */}
      {data && (
        <CardContent className="p-3 space-y-3">
          <div className="space-y-3 pt-2 text-xs">
            {/* Row 1: Executive Summary + Trade Plan */}
            <ExecutiveSummary
              data={data}
              currencyLabel={currencyLabel}
              predictionContext={predictionContext}
            />

            {/* Institutional Decision Panel */}
            {data.institutional_decision && (
              <InstitutionalDecisionPanel
                decision={data.institutional_decision as any}
                ticker={ticker}
                currencyLabel={currencyLabel}
                onPositionUpdate={(price, qty) => {
                  setUserEntryPrice(price);
                  setUserEntryQty(qty);
                  fetchData(ticker, timeframe, userState, price, qty);
                }}
              />
            )}

            {/* Row 1.5: Insight Cards */}
            <InsightCards
              ticker={ticker}
              candleProbabilities={data.candle_probabilities}
              stockDna={data.stock_dna}
            />

            {/* Row 2: Advanced Mode Technical Breakdown */}
            {advancedMode && (
              <AdvancedBreakdown data={data} currencyLabel={currencyLabel} />
            )}
          </div>
        </CardContent>
      )}

      {/* ── Deal Advisor Panel ── */}
      <CardContent className="pt-0">
        <DealAdvisorPanel
          ticker={ticker}
          initialEntryPrice={dealAdvisorPrefill?.entryPrice ?? userEntryPrice}
          initialEntryQty={dealAdvisorPrefill?.entryQty ?? userEntryQty}
        />
      </CardContent>

      <AlertPanel ticker={ticker} open={alertPanelOpen} onClose={() => setAlertPanelOpen(false)} />
    </div>
  );
}

export default SingleStockAnalysisView;
