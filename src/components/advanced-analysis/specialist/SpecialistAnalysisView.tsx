/**
 * specialist/SpecialistAnalysisView.tsx — Container (render-only).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 2229–2550).
 *
 * Container-only responsibility:
 * - Read ticker from store + manage UI state (loading/error via hook).
 * - Wire 16 sub-components into a single report layout.
 *
 * F-Strangler-Specialist (Phase 2): data-fetching logic extracted to
 * useSpecialistAnalysisData hook (5 useApiQuery calls parallel + flow→footprint
 * remap + error/loading derivation). This component is render-only — no fetches.
 *
 * 16 sections (professional financial report):
 * §1 Header Card · §2 Price Summary · §3 Candlestick Chart · §4 Liquidity Footprint
 * §5 Technical Indicators · §6 Fundamentals · §7 Momentum Stats · §8 Prediction History
 * §9 Recommendation · §10 52-Week Analysis · §11 Flow + Explosive · §12 Comprehensive
 * §13 Position Sizing · §14 Price Levels Ladder · §15 Score Dashboard · §16 Sharia
 *
 * Rules honored:
 * Rule 4 — split existing file into sub-components (no behavioral change).
 * Rule 20 — Node.js = display only. All numbers come from real DB/API responses.
 * Rule 30 — emerald (positive) / amber (warning) / red (negative) / slate (neutral).
 * Rule 67 — PRIMARY = maker-radar/stock (always-available data). Missing fields → "—".
 * Rule 75 — commit + push after success.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity,
  AlertTriangle,
  Loader2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
import {
  useSpecialistAnalysisData,
  type PriceRow,
  type RadarStats,
  type StockInfo,
} from './types';
import { safeNum, safeStr, fmtNum, fmtCompact } from './helpers';
import { SkeletonCard, SectionCard, PriceTile } from './primitives';
import { CandlestickChart } from './CandlestickChart';
import { ComprehensiveAnalysisSection } from './ComprehensiveAnalysisSection';
import { FlowExplosiveSection } from './FlowExplosiveSection';
import { FundamentalsSection } from './FundamentalsSection';
import { HeaderCard } from './HeaderCard';
import { LiquidityFootprintSection } from './LiquidityFootprintSection';
import { MomentumStatsSection } from './MomentumStatsSection';
import { PositionSizingCalculator } from './PositionSizingCalculator';
import { PredictionHistorySection } from './PredictionHistorySection';
import { PriceLevelsLadderSection } from './PriceLevelsLadderSection';
import { RecommendationSection } from './RecommendationSection';
import { ScoreDashboardSection } from './ScoreDashboardSection';
import { ShariaSection } from './ShariaSection';
import { ShareButtons } from './ShareButtons';
import { TechnicalIndicatorsSection } from './TechnicalIndicatorsSection';
import { Week52AnalysisSection } from './Week52AnalysisSection';

export function SpecialistAnalysisView() {
  const { stocks, currentMarket, loadStocks } = useAppStore();
  const [ticker, setTicker] = useState('');

  // ─── F-Strangler-Specialist (Task F-Strangler-Specialist) ────────────────
  // قبل كده: 12 useState + 1 useCallback (fetchAnalysis, 121 LOC) + Promise.allSettled
  // لـ 5 fetches inline في الـ component. الـ render logic اختلط بـ data-fetching logic.
  // دلوقتي: الـ data logic كله في useSpecialistAnalysisData hook. الـ hook بـ يـ fire
  // 5 useApiQuery calls parallel + يـ remap /api/flow → FootprintData + يـ derive
  // loading/error من TanStack Query state. الـ component بقا render-only.
  // Orphan states (flow / explosive / comprehensive / stockMeta) — بترجع null
  // من الـ hook (PHASE-0 شال نداءاتهم؛ الـ sub-components بـ تـ show empty state).
  const {
    radarData,
    footprint,
    predictions,
    sharia,
    unified,
    flow,
    explosive,
    comprehensive,
    stockMeta,
    loading,
    error,
    refetch,
  } = useSpecialistAnalysisData(ticker, currentMarket);

  useEffect(() => {
    if (stocks.length === 0) {
      loadStocks();
    }
  }, [stocks.length, loadStocks]);

  // "تحليل" button — re-fetches all 5 queries (TanStack Query refetch under the hood).
  // قبل كده: handleSearch كان بـ يقول fetchAnalysis(ticker.trim().toUpperCase()).
  // دلوقتي: ticker in state is the source of truth; refetch() re-runs the 5 queries.
  const handleSearch = useCallback(() => {
    if (ticker.trim()) {
      void refetch();
    }
  }, [ticker, refetch]);

  // ════ Derived values ════
  const info: StockInfo | null = radarData?.stock_info ?? null;
  const prices: PriceRow[] = radarData?.prices ?? [];
  const stats: RadarStats | null = radarData?.stats ?? null;

  const currentPrice = safeNum(info?.current_price);
  const support = safeNum(info?.support);
  const resistance = safeNum(info?.resistance);
  const ma50 = safeNum(info?.ma_50);
  const ma200 = safeNum(info?.ma_200);
  const signal = safeNum(info?.signal);

  // R:R from real support/resistance (Rule 67 — no fabrication)
  const computedRR =
    currentPrice != null && resistance != null && support != null && currentPrice > support
      ? (resistance - currentPrice) / (currentPrice - support)
      : null;

  // ─── Stock icon: prefer stockMeta.icon_url / logo_url, fall back to store ───
  const iconUrl =
    safeStr(stockMeta?.icon_url) ??
    safeStr(stockMeta?.logo_url) ??
    safeStr(stockMeta?.image) ??
    stocks.find((s) => s.ticker === ticker)?.icon_url ??
    null;

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 bg-white dark:bg-slate-950 min-h-screen" dir="rtl">
      {/* ════ Header ════ */}
      <div className="rounded-xl border border-profit/20 /40 from-profit to-slate-50 /30 dark:dark:to-slate-900/40 p-4 sm:p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-lg from-profit to-warning flex items-center justify-center flex-shrink-0 shadow-md">
              <Activity className="w-6 h-6 sm:w-7 sm:h-7 text-foreground" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <span>التقرير المالي الاحترافي</span>
              </h1>
              <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
                تحليل عميق لسهم واحد — بيانات من 8 مصادر (PRIMARY: maker-radar/stock ← SECONDARY: footprint ← TERTIARY: predictions.db ← ENRICHMENT: flow + explosive + comprehensive + sharia)
              </p>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="bg-profit/10 text-profit border border-profit/20 border border-profit "
          >
            <span className="w-2 h-2 rounded-full bg-profit animate-pulse ml-1" />
            السوق: {MARKET_NAMES_AR[currentMarket] || currentMarket}
          </Badge>
        </div>
      </div>

      {/* ════ Stock Selector ════ */}
      <Card className="bg-white border-border">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={ticker}
              onChange={(e) => {
                const val = e.target.value;
                setTicker(val);
                // F-Strangler-Specialist: hook auto-fires 5 queries when ticker changes
                // (enabled: !!ticker). No manual fetchAnalysis call needed.
              }}
              disabled={loading}
              className="flex-1 px-3 sm:px-4 py-2 border border-border rounded-lg bg-background text-foreground text-sm sm:text-base min-w-0"
            >
              <option value="">اختر سهماً من {MARKET_NAMES_AR[currentMarket] || currentMarket}...</option>
              {stocks.map((stock) => (
                <option key={stock.ticker} value={stock.ticker}>
                  {stock.ticker} {stock.name_ar ? `- ${stock.name_ar}` : stock.name ? `- ${stock.name}` : ''}
                </option>
              ))}
            </select>
            <Button onClick={handleSearch} disabled={loading || !ticker} className="flex-shrink-0 gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span>تحليل</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ════ Error ════ */}
      {error && !loading && (
        <Card className="p-4 bg-loss/10 border-loss ">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-loss flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-loss text-sm">تعذّر تحميل بيانات السهم</p>
              <p className="text-xs text-loss mt-1">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {/* ════ Loading skeletons ════ */}
      {loading && (
        <div className="space-y-4">
          <SkeletonCard />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <SkeletonCard />
        </div>
      )}

      {/* ════ Empty state ════ */}
      {!radarData && !loading && !error && (
        <Card className="p-6 sm:p-12 text-center bg-white border-border">
          <Activity className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-base sm:text-xl font-semibold mb-2">اختر سهماً للتحليل الشامل</h3>
          <p className="text-muted-foreground text-xs sm:text-sm max-w-md mx-auto">
            حدد سهماً من القائمة المنسدلة أعلاه للحصول على تقرير مالي احترافي بكل البيانات:
            60+ مؤشر من stock_info + 30 يوم OHLCV + بصمة السيولة + سجل التوقعات + المؤشرات الفنية والأساسية.
          </p>
        </Card>
      )}

      {/* ════ 16-SECTION PROFESSIONAL FINANCIAL REPORT ════ */}
      {radarData && info && !loading && !error && (
        <div className="space-y-4 sm:space-y-6">
          {/* ── §1. Header Card ── */}
          <HeaderCard
            info={info}
            symbol={radarData.ticker ?? ticker.toUpperCase()}
            iconUrl={iconUrl}
            sharia={sharia}
            market={info.market ?? currentMarket}
          />

          {/* ── §2. Price Summary (8 tiles from stock_info) ── */}
          <SectionCard
            icon={<TrendingUp className="w-4 h-4" />}
            title="ملخص حركة السعر"
            description="من stock_info: open + high + low + previous_close + volume + turnover + 52w high/low"
            accent="emerald"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <PriceTile label="الافتتاح" value={fmtNum(info.open_price)} color="text-muted-foreground dark:text-slate-200" />
              <PriceTile label="الأعلى" value={fmtNum(info.high_price)} color="text-profit" />
              <PriceTile label="الأدنى" value={fmtNum(info.low_price)} color="text-loss" />
              <PriceTile label="الإغلاق السابق" value={fmtNum(info.previous_close)} color="text-muted-foreground dark:text-muted-foreground" />
              <PriceTile label="حجم التداول" value={fmtCompact(info.volume)} color="text-warning" />
              <PriceTile label="قيمة التداول" value={fmtCompact(info.turnover_egp ?? info.value_traded, ' ج.م')} color="text-warning" />
              <PriceTile label="أعلى 52 أسبوع" value={fmtNum(info.high_52w)} color="text-profit" />
              <PriceTile label="أدنى 52 أسبوع" value={fmtNum(info.low_52w)} color="text-loss" />
            </div>
            {/* Distance tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <PriceTile
                label="المسافة من قمة 52 أسبوع"
                value={
                  currentPrice != null && info.high_52w != null && info.high_52w > 0
                    ? `${(((currentPrice - info.high_52w) / info.high_52w) * 100).toFixed(1)}%`
                    : '—'
                }
                color={currentPrice != null && info.high_52w != null && currentPrice < info.high_52w ? 'text-loss' : 'text-profit'}
              />
              <PriceTile
                label="المسافة من قاع 52 أسبوع"
                value={
                  currentPrice != null && info.low_52w != null && info.low_52w > 0
                    ? `${(((currentPrice - info.low_52w) / info.low_52w) * 100).toFixed(1)}%`
                    : '—'
                }
                color={currentPrice != null && info.low_52w != null && currentPrice > info.low_52w ? 'text-profit' : 'text-loss'}
              />
              <PriceTile
                label="متوسط الحجم"
                value={fmtCompact(info.avg_volume)}
                color="text-muted-foreground dark:text-muted-foreground"
              />
              <PriceTile
                label="Beta (حساسية السوق)"
                value={fmtNum(info.beta)}
                color="text-muted-foreground dark:text-muted-foreground"
              />
            </div>
          </SectionCard>

          {/* ── §3. 30-Day Candlestick Chart (BEAUTIFUL SVG) ── */}
          <CandlestickChart
            prices={prices}
            support={support}
            resistance={resistance}
            ma50={ma50}
            ma200={ma200}
          />

          {/* ── §4. Liquidity Footprint ── */}
          {/* UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72) — pass canonical
          accumulation + money_flow labels down to the footprint section. */}
          <LiquidityFootprintSection
            data={footprint}
            canonicalAccumulation={unified?.canonical?.accumulation ?? null}
            canonicalMoneyFlow={unified?.canonical?.money_flow ?? null}
          />

          {/* ── §5. Technical Indicators ── */}
          <TechnicalIndicatorsSection info={info} />

          {/* ── §6. Fundamentals ── */}
          <FundamentalsSection info={info} />

          {/* ── §7. Momentum Stats ── */}
          <MomentumStatsSection stats={stats} info={info} />

          {/* ── §8. Prediction History ── */}
          <PredictionHistorySection data={predictions} />

          {/* ── §9. Recommendation ── */}
          <RecommendationSection info={info} />

          {/* ── §10. 52-Week Analysis ── */}
          <Week52AnalysisSection info={info} />

          {/* ── §11. Flow + Explosive (graceful degrade) ── */}
          <FlowExplosiveSection flow={flow} explosive={explosive} />

          {/* ── §12. Comprehensive Analysis (graceful degrade) ── */}
          <ComprehensiveAnalysisSection data={comprehensive} />

          {/* ── §13. Position Sizing Calculator ── */}
          <PositionSizingCalculator
            entryPrice={currentPrice}
            stopLoss={support}
            targetPrice={resistance}
            rrRatio={computedRR}
          />

          {/* ── §14. Price Levels Ladder ── */}
          <PriceLevelsLadderSection info={info} />

          {/* ── §15. Score Dashboard ── */}
          <ScoreDashboardSection info={info} />

          {/* ── Sharia Compliance (kept from Task 43) ── */}
          <ShariaSection data={sharia} />

          {/* ── Share ── */}
          <ShareButtons info={info} ticker={radarData.ticker ?? ticker.toUpperCase()} />

          {/* ── §16. Disclaimer ── */}
          <Card className="p-4 bg-warning/20 border-warning ">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-warning mb-1 text-sm">إخلاء المسؤولية</h4>
                <p className="text-xs text-warning">
                  هذا التحليل لأغراض تعليمية وإعلامية فقط وليس توصية استثمارية.
                  القرار النهائي مسؤولية العميل. قرارات الاستثمار يجب أن تبنى على تقييمك الشخصي
                  ومشورة مستشار مالي محترف. الأداء السابق لا يضمن النتائج المستقبلية.
                </p>
              </div>
            </div>
          </Card>

          {/* ── Engine errors transparency (Rule 67) ── */}
          {radarData.db_source && (
            <Card className="p-3 bg-slate-50/60 border-border">
              <p className="text-xs text-muted-foreground">
                مصدر البيانات الرئيسي: <span className="font-mono font-bold">{radarData.db_source}</span> — Rule 67: البيانات حقيقية من stocks.db + predictions.db
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default SpecialistAnalysisView;
