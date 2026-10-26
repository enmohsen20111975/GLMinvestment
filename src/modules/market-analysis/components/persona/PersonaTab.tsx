'use client';

/**
 * persona/PersonaTab.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — PersonaTab container (< 500 LOC).
 * ----------------------------------------------------------------------------
 * F-Strangler-PersonaTab (Phase 2): all data-fetch logic moved to
 * `usePersonaTabData` hook (5 fetches: /api/unified/predictions ×2,
 * /api/market/regime, /api/stored-analysis/results, /api/stocks/[ticker]).
 * The widget is render-only — fetches + cache + polling + event listener live
 * in the hook.
 *
 * F-Phase3-Split-PersonaTab (this task): the 3 large inline sub-components
 * (`PersonaCard`, `PersonaTableView`, `StockDetailPanel`) + 7 view-section
 * components (`PersonaEmptyStates`, `PersonaTextView`, `WhaleRadarSection`,
 * `TestingCandidatesSection`, `UnifiedAnalysisModal`, `PersonaImageCardExport`,
 * `PersonaBanners`) extracted into this folder. Container is now < 500 LOC.
 *
 * Container still owns:
 *   - Header theme derivation + `isLongTerm` flag + pagination slicing
 *   - `viewSelector` (image / cards / table / text toggle) + share-all buttons
 *   - 4 view branches + IncubatorSection + UnifiedPagination + archive
 *   - `<StockDetailPanel>` drill-down host + `<UnifiedAnalysisModal>` host
 *
 * MAESTRO-DISABLED — see ./PersonaCard.tsx header comment for full context.
 * ============================================================================
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Copy, Share2, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarketType } from '@/lib/store';
import { usePersonaTabData } from '@/hooks/usePersonaTabData';
import { toast } from 'sonner';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
import { IncubatorSection } from '@/modules/radar/components/IncubatorSection';
import { UnifiedPagination } from '@/components/shared/ui';
import { PreviousPredictionsArchive } from '../PredictionsTab';

// Local sub-components (extracted in this Phase 3 task).
import { PersonaCard } from './PersonaCard';
import { PersonaTableView } from './PersonaTableView';

import { PersonaEmptyStates } from './PersonaEmptyStates';
import { PersonaTextView } from './PersonaTextView';
import { WhaleRadarSection } from './WhaleRadarSection';
import { TestingCandidatesSection } from './TestingCandidatesSection';
import { UnifiedAnalysisModal } from './UnifiedAnalysisModal';
import { PersonaImageCardExport } from './PersonaImageCardExport';
import { PersonaBanners, PersonaHoldBanner } from './PersonaBanners';

// Helpers
import type { Persona } from './types';
import { isLongTermPersona, getPersonaHeaderTheme } from './helpers';
import { MARKET_CODES, PERSONA_PAGE_SIZE, formatAllPersonaPicksText } from '../helpers';
import type { PersonaData } from '../types';

// P42-NO-FREEZE: ثوابت منع تجميد الشاشة.
// PERSONA_DISPLAY_LIMIT: عدد الأسهم اللي بنحتفظ بيها في الـ state (10).
// PERSONA_PAGE_SIZE: عدد الكروت اللي بتترسم في نفس اللحظة (5) — عشان المتصفح مايموتش.

export function PersonaTab({
  market,
  persona,
}: {
  market: MarketType;
  persona: Persona;
}) {
  // F-Strangler-PersonaTab: data-fetch logic moved to usePersonaTabData hook.
  // الـ widget دلوقتي render-only — كل الـ fetches + state + cache + polling في الـ hook.
  const {
    items,
    loading,
    error,
    usingFallback,
    dataSource,
    marketRegime,
    previousPredictions,
    testingCandidates,
    whaleRadarPicks,
    sectorHeat,
    stockDetail,
    viewMode,
    setViewMode,
    selectedItem,
    selectedTicker,
    setSelectedTicker,
    selectedContext,
    setSelectedContext,
    subTab,
    setSubTab,
    personaPage,
    setPersonaPage,
    showArchive,
    setShowArchive,
    fetchPersona,
    handleSelectItem,
    handleBack,
  } = usePersonaTabData(market, persona);

  // P26: isLongTerm = conservative (أفق طويل). balanced & gambler = أفق أقصر.
  const isLongTerm = isLongTermPersona(persona);
  // P42-NO-FREEZE: ترقيم الصفحات — نرسم 5 كروت بس في كل لحظة عشان المتصفح مايموتش
  const personaTotalPages = Math.max(1, Math.ceil(items.length / PERSONA_PAGE_SIZE));
  const personaPageItems = items.slice(
    personaPage * PERSONA_PAGE_SIZE,
    (personaPage + 1) * PERSONA_PAGE_SIZE
  );
  // P26: ألوان/عناوين 3 شخصيات — 🛡️ مستثمر / ⚖️ متوازن / 🎯 مضارب
  const headerTheme = getPersonaHeaderTheme(persona);

  // Early-return for loading / error / empty states.
  if (loading || error || items.length === 0) {
    return (
      <PersonaEmptyStates
        loading={loading}
        error={error}
        itemsLength={items.length}
        marketRegime={marketRegime}
        persona={persona}
        isLongTerm={isLongTerm}
        headerTheme={headerTheme}
        onRetry={fetchPersona}
      />
    );
  }

  const viewSelector = (
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/40">
        {(
          [
            ['image', 'صورة'],
            ['cards', 'كروت'],
            ['table', 'جدول'],
            ['text', 'نص'],
          ] as const
        ).map(([m, l]) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={cn(
              'px-3 py-1 text-xs rounded font-medium transition-colors',
              viewMode === m
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <RefreshAnalyticsButton variant="glow" size="sm" onRefreshed={fetchPersona} />
        {items.length > 0 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => {
                const text = formatAllPersonaPicksText(items, persona, market);
                navigator.clipboard.writeText(text);
                toast.success('تم نسخ جميع التوقعات ✓');
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              نسخ الكل
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={async () => {
                const text = formatAllPersonaPicksText(items, persona, market);
                if (navigator.share) {
                  try {
                    await navigator.share({ title: `توقعات ${headerTheme.title}`, text });
                  } catch {}
                } else {
                  navigator.clipboard.writeText(text);
                  toast.success('تم نسخ جميع التوقعات ✓');
                }
              }}
            >
              <Share2 className="h-3.5 w-3.5" />
              مشاركة
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {viewSelector}

          {/* Fallback warning + sector heat banners (gambler-only sector heat). */}
          <PersonaBanners
            usingFallback={usingFallback}
            dataSource={dataSource}
            items={items}
            itemsCount={items.length}
            sectorHeat={sectorHeat}
            persona={persona}
          />

          {/* بطاقة البرسونا القابلة للمشاركة (تحميل صورة / نشر تيليجرام) */}
          {viewMode === 'image' && (
            <PersonaImageCardExport
              items={items}
              persona={persona}
              market={market}
              headerTheme={headerTheme}
            />
          )}

          {/* رأس التاب */}
          <Card
            className={cn(
              'border-l-4',
              isLongTerm
                ? 'border-l-emerald-500'
                : persona === 'balanced'
                  ? 'border-l-amber-500'
                  : 'border-l-fuchsia-500'
            )}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <span className="text-3xl">{headerTheme.emoji}</span>
              <div>
                <h3 className={cn('text-lg font-bold', headerTheme.accent)}>
                  {headerTheme.title}
                </h3>
                <p className="text-xs text-muted-foreground">{headerTheme.subtitle}</p>
              </div>
              <Badge variant="secondary" className="mr-auto">
                {items.length} سهم
              </Badge>
            </CardContent>
          </Card>

          {/* P21-PERSONA-CONSTRAINTS: HOLD Banner for Conservative. */}
          <PersonaHoldBanner items={items} persona={persona} />

          {/* قائمة الكروت */}
          {viewMode === 'cards' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {personaPageItems.map((it) => {
                const personaKey = persona === 'conservative' ? 'investor' : 'gambler';
                const personaData: PersonaData = it.analysisJson?.[personaKey] || {
                  verdict: it.recommendationAr || '',
                  score: it.maestroScore || 0,
                  reason: '',
                  signal: it.recommendation || 'HOLD',
                  entry: it.entry?.price ?? null,
                  target: it.entry?.target ?? null,
                  stop: it.entry?.stopLoss ?? null,
                  timeframe:
                    persona === 'balanced'
                      ? '2-6 أسابيع'
                      : persona === 'conservative'
                        ? '6-12 شهر'
                        : '1-5 أيام',
                };
                return (
                  <PersonaCard
                    key={`${it.ticker}-${persona}`}
                    ticker={it.ticker}
                    persona={persona}
                    data={personaData}
                    maestroScore={it.maestroScore}
                    updatedAt={it.updatedAt}
                    narrative={it.analysisJson?.narrative}
                    market={market}
                    nameAr={it.nameAr}
                    logoUrl={it.logoUrl}
                    fundamentals={it.fundamentals}
                    onClick={() => handleSelectItem(it)}
                  />
                );
              })}
            </div>
          )}

          {/* عرض الجدول */}
          {viewMode === 'table' && (
            <>
              {/* ⚠️ تنبيه اتجاه السوق ورادار الحيتان (جيمي directive) */}
              <div className="mb-3 p-3 rounded-lg border border-warning/20 bg-warning/10 text-warning flex items-start gap-2.5 text-xs leading-relaxed">
                <span className="text-base flex-shrink-0">⚠️</span>
                <div>
                  <div className="font-bold mb-0.5">
                    تنبيه اتجاه السوق — صفقات استثنائية مضادة للاتجاه (أفضل 5 فرص فقط):
                  </div>
                  <div className="opacity-90">
                    المؤشر العام في مسار هابط / كاش عام. الفرص المعروضة هنا مستخرجة عبر{' '}
                    <strong>رادار الحيتان ورصد السيولة المؤسسية الخفية</strong> في مناطق
                    التجميع. الدخول بحجم محفظة لا يتعدى <strong>2%</strong> مع الالتزام
                    الصارم بوقف الخسارة.
                  </div>
                </div>
              </div>
              <PersonaTableView
                items={personaPageItems}
                persona={persona}
                market={market}
                onSelectItem={handleSelectItem}
              />
            </>
          )}

          {/* عرض النص المنسق للمشاركة */}
          {viewMode === 'text' && (
            <PersonaTextView
              items={personaPageItems}
              persona={persona}
              market={market}
              onSelectItem={handleSelectItem}
            />
          )}

          {/* ============================================================================
              ALPHA — INCUBATOR SECTION (The Stalking Radar — per Mohsen's directive)
              يـعرض الأسهم اللي محققة 4/6 أو 5/6 شروط + مستنية trigger.
              - لما السوق دفاعي: يظهر في أول الصفحة (فوق التوقعات).
              - لما السوق طبيعي: يظهر بعد التوقعات النشطة (كـ "coming up" preview).
              ============================================================================ */}
          <div className={marketRegime?.regime === 'DEFENSIVE' ? 'order-first' : ''}>
            <IncubatorSection
              market={MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market]}
              refreshIntervalMs={60_000}
              maxDisplay={6}
            />
          </div>

          {/* P42-NO-FREEZE: ترقيم الصفحات — 5 كروت لكل صفحة عشان المتصفح مايموتش.
              P0-COMPONENT-UNIFICATION (Phase 2.4): استبدلنا الـ inline pagination
              (4 أزرار + counter) بـ <UnifiedPagination> الموحّد. */}
          {personaTotalPages > 1 && (
            <UnifiedPagination
              page={personaPage}
              totalPages={personaTotalPages}
              onChange={setPersonaPage}
              size="sm"
              variant="compact"
            />
          )}

          {/* ============================================================================
              BRAVO-WHALE-RADAR-HUNTER-MODE (Per Mohsen's directive 2026-10-20):
              Smart Money Radar section — يظهر لما السوق العام يكون دفاعي + فيه تجميع
              حيتان هادئ. الأسهم دي بتـجيل من maker_radar.py (path
              B_quiet_accumulation_strong بـ 5/6 أو 6/6 signals + 10M+ EGP liquidity).
              ⚠️ صفقات مخاطرة محسوبة — إدارة رأس مال صارمة (2% من المحفظة).
              ============================================================================ */}
          <WhaleRadarSection picks={whaleRadarPicks} />

          {/* P0-4b — BRAVO-TESTING-CANDIDATES: أسهم تحت الاختبار والمراقبة اللحظية. */}
          <TestingCandidatesSection candidates={testingCandidates} />

          {/* P6-PREDICTIONS: أرشيف التوقعات السابقة — مخفي افتراضياً لتجنب إحباط العميل */}
          {previousPredictions && previousPredictions.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border/60">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowArchive(!showArchive)}
                className="gap-2 text-xs text-muted-foreground hover:text-foreground border-dashed h-8"
              >
                <span>📋</span>
                <span>
                  {showArchive
                    ? 'إخفاء الأرشيف التاريخي'
                    : `عرض أرشيف التوقعات السابقة (${previousPredictions.length} صفقة)`}
                </span>
                {showArchive ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </Button>

              {showArchive && (
                <div className="mt-3">
                  <PreviousPredictionsArchive
                    predictions={previousPredictions}
                    title="التوقعات السابقة"
                  />
                </div>
              )}
            </div>
          )}

      {/* ════════════════════════════════════════════════════════════════════
          🪟 نافذة التحليل الشامل (Unified Analysis Modal) — يفتح فوق الشاشة.
          ════════════════════════════════════════════════════════════════════ */}
      <UnifiedAnalysisModal
        selectedTicker={selectedTicker}
        selectedContext={selectedContext}
        onClose={() => {
          setSelectedTicker(null);
          setSelectedContext(null);
        }}
      />
    </div>
  );
}
