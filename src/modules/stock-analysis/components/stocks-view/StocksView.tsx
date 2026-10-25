/**
 * stocks-view/StocksView.tsx (container)
 * ============================================================================
 * F-Phase3-Split-StocksView: thin container that orchestrates state (via
 * useStocksViewState hook) + renders the StocksView page layout.
 *
 * قبل كده: ده كان file واحد بـ 2,287 LOC (state + effects + memos + handlers
 * + sub-components + render — كله inline).
 * دلوقتي: الـ container بقا <500 LOC. كل الـ concerns مستخرجة لـ:
 *   - useStocksViewState.ts (state + effects + memos + handlers)
 *   - constants.ts (static config)
 *   - helpers.ts (utility functions)
 *   - types.ts (shared type aliases)
 *   - Skeletons.tsx (loading rows)
 *   - OverviewSummary.tsx (memo'd summary bar)
 *   - StockCard.tsx / MobileStockRow.tsx (memo'd card/row)
 *   - PresetButtonsRow.tsx (memo'd top preset row)
 *   - AdvancedFilters.tsx (memo'd collapsible filters)
 *   - StocksTable.tsx (desktop UnifiedTable + column defs)
 *   - StocksToolbar.tsx (search + chips + advanced filters Card)
 *   - MobileStocksList.tsx (mobile list + pagination)
 * ============================================================================
 */

'use client';

import * as React from 'react';
import { BarChart3, Landmark, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MARKET_NAMES_AR } from '@/lib/store';
import { Header } from '@/components/layout/Header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GuestLimitCta } from '@/components/auth/GuestLimitCta';
import { StockDetail } from '../StockDetail';
import { TreasuryBondsView } from '../TreasuryBondsView';
import { StockScreenerAdvanced } from '@/modules/screener/components/StockScreenerAdvanced';
import { useTranslation } from '@/lib/i18n-context';

import { useStocksViewState } from './useStocksViewState';
import { TableSkeleton, SummarySkeleton } from './Skeletons';
import { OverviewSummary } from './OverviewSummary';
import { PresetButtonsRow } from './PresetButtonsRow';
import { StocksToolbar } from './StocksToolbar';
import { StocksTable } from './StocksTable';
import { MobileStocksList } from './MobileStocksList';
import { PRESET_OPTIONS } from './constants';

export function StocksView() {
  const t = useTranslation();
  const s = useStocksViewState();

  // ── Detail View (early return) ──
  if (s.showDetail) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header title={t('stocks.detail.title')} />
        <main className="flex-1 p-3 md:p-6 max-w-7xl mx-auto w-full">
          <StockDetail />
        </main>
      </div>
    );
  }

  // ── Page title + subtitle (UNIFIED-MARKET-VIEW) ──
  const pageTitle = s.isCrypto ? t('stocks.title.crypto') : t('stocks.title.stocks');
  const pageSubtitle = s.isCrypto
    ? t('stocks.subtitle.crypto')
    : t('stocks.subtitle.stocks', {
        market: MARKET_NAMES_AR[s.currentMarket] || t('markets.egypt'),
      });

  return (
    <div className="flex flex-col min-h-screen" dir="rtl">
      <Header title={pageTitle} subtitle={pageSubtitle} />
      <main className="flex-1 p-3 md:p-6 max-w-7xl mx-auto w-full space-y-3 md:space-y-4">
        {/* ── Tabs ── */}
        <div className="flex gap-2">
          <button
            onClick={() => s.setStockTab('stocks')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border',
              s.stockTab === 'stocks'
                ? 'bg-profit text-white border-profit shadow-sm'
                : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
            )}
          >
            <BarChart3 className="w-4 h-4" />
            {s.isCrypto ? t('stocks.tabs.crypto') : t('stocks.tabs.stocks')}
          </button>
          {s.currentMarket !== 'CRYPTO' && (
            <button
              onClick={() => s.setStockTab('bonds')}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border',
                s.stockTab === 'bonds'
                  ? 'bg-profit text-white border-profit shadow-sm'
                  : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
              )}
            >
              <Landmark className="w-4 h-4" />
              {t('stocks.tabs.bonds')}
            </button>
          )}
          {/* RESTRUCT-A-P2: filters tab merged from top-level #stock-filters */}
          <button
            onClick={() => s.setStockTab('filters')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border',
              s.stockTab === 'filters'
                ? 'bg-profit text-white border-profit shadow-sm'
                : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
            )}
          >
            <Filter className="w-4 h-4" />
            الفلاتر
          </button>
        </div>

        {/* ── Bonds View ── */}
        {/* UI-STABILITY fix (2026-09-28): stable key on conditional section */}
        {s.stockTab === 'bonds' && <TreasuryBondsView key="stocks-bonds-view" />}

        {/* RESTRUCT-A-P2: Filters merged from #stock-filters top-level */}
        {s.stockTab === 'filters' && (
          <StockScreenerAdvanced key="stocks-filters-view" />
        )}

        {/* ── Stocks View ── */}
        {/* UI-STABILITY fix (2026-09-28): stable key on conditional fragment wrapper */}
        {s.stockTab === 'stocks' && (
          <React.Fragment key="stocks-stocks-view">
            {/* ── Preset Buttons Row (EGX only — /api/stocks/presets doesn't serve crypto) ── */}
            {!s.isCrypto && (
              <PresetButtonsRow
                activePreset={s.selectedPreset}
                onSelect={s.handlePresetSelect}
              />
            )}

            {/* ── Search + Quick Filters + Advanced Filter Toggle ── */}
            <StocksToolbar
              localSearch={s.localSearch}
              onSearchChange={s.handleSearchChange}
              onClearSearch={s.handleClearSearch}
              showFilters={s.showFilters}
              setShowFilters={s.setShowFilters}
              hasActiveFilters={s.hasActiveFilters}
              selectedPreset={s.selectedPreset}
              setSelectedPreset={s.setSelectedPreset}
              presetPeriod={s.presetPeriod}
              setPresetPeriod={s.setPresetPeriod}
              selectedSector={s.selectedSector}
              onSectorChange={s.handleSectorChange}
              selectedIndex={s.selectedIndex}
              onIndexChange={s.handleIndexChange}
              priceRange={s.priceRange}
              onPriceRangeChange={s.handlePriceRangeChange}
              changeFilter={s.changeFilter}
              onChangeFilterChange={s.handleChangeFilterChange}
              onResetFilters={s.handleResetFilters}
              activeQuickFilter={s.activeQuickFilter}
              onQuickFilter={s.handleQuickFilter}
              selectedSectors={s.selectedSectors}
              onToggleSector={s.handleToggleSector}
              priceMin={s.priceMin}
              priceMax={s.priceMax}
              onPriceMinChange={s.setPriceMin}
              onPriceMaxChange={s.setPriceMax}
              changeMin={s.changeMin}
              changeMax={s.changeMax}
              onChangeMinChange={s.setChangeMin}
              onChangeMaxChange={s.setChangeMax}
              onResetAdvanced={s.handleResetAdvanced}
              availableSectors={s.availableSectors}
              baseData={s.baseData}
              currentMarket={s.currentMarket}
              isCrypto={s.isCrypto}
              isEGX={s.isEGX}
              setPage={s.setPage}
              t={t}
            />

            {/* ── Overview Summary Bar / Preset Summary ── */}
            {s.isInitialLoading ? (
              <SummarySkeleton />
            ) : s.isPresetMode ? (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 bg-profit/10 rounded-lg px-3 py-1.5">
                  <span className="text-sm font-bold">
                    {PRESET_OPTIONS.find(p => p.key === s.selectedPreset)?.icon} {' '}
                    {PRESET_OPTIONS.find(p => p.key === s.selectedPreset)?.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{t('stocks.footer.count')}</span>
                  <span className="text-sm font-bold">{s.presetData.length}</span>
                </div>
                {s.presetScanDate && (
                  <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
                    <span className="text-xs font-medium text-muted-foreground">{t('stocks.footer.lastUpdate')}</span>
                    <span className="text-xs tabular-nums">{new Date(s.presetScanDate).toLocaleString('ar-EG')}</span>
                  </div>
                )}
                {s.presetLoading && (
                  <div className="flex items-center gap-1.5 bg-warning/10 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-warning animate-pulse">{t('stocks.footer.loading')}</span>
                  </div>
                )}
              </div>
            ) : (
              <OverviewSummary
                total={s.summaryStats.total}
                gainers={s.summaryStats.gainers}
                losers={s.summaryStats.losers}
                unchanged={s.summaryStats.unchanged}
                avgChange={s.summaryStats.avgChange}
              />
            )}

            {/* ── Stock Content ── */}
            {s.isInitialLoading ? (
              <Card className="py-0 overflow-hidden">
                <CardContent className="p-4">
                  <TableSkeleton />
                </CardContent>
              </Card>
            ) : s.paginatedStocks.length === 0 ? (
              <Card className="py-0 overflow-hidden">
                <CardContent className="p-12 text-center">
                  <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">
                    {s.isPresetMode
                      ? t('stocks.empty.presetMissing')
                      : t('stocks.empty.noMatches')}
                  </p>
                  {s.hasActiveFilters && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 text-xs"
                      onClick={s.handleResetFilters}
                    >
                      {t('stocks.empty.resetFilters')}
                    </Button>
                  )}
                  {s.isPresetMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 text-xs"
                      onClick={() => s.setSelectedPreset('all')}
                    >
                      {t('stocks.empty.showAll')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              /* ── Table + Mobile list + Pagination ── */
              <Card className="py-0 overflow-hidden">
                <>
                  <StocksTable
                    displayData={s.displayData}
                    onRowClick={s.handleRowClick}
                    isCrypto={s.isCrypto}
                    currencyLabel={s.currencyLabel}
                    emptyTextAr={t('stocks.empty.noMatches')}
                    t={t}
                  />
                  <MobileStocksList
                    paginatedStocks={s.paginatedStocks}
                    onRowClick={s.handleRowClick}
                    totalPages={s.totalPages}
                    safePage={s.safePage}
                    setPage={s.setPage}
                    t={t}
                  />
                  {/* ALPHA-UX-FIX-5: guest freemium CTA — بتشوف 50 من 412، سجل للمزيد */}
                  <GuestLimitCta shown={s.displayData.length} total={s.baseData.length} itemLabel="سهًماً" itemLabelPlural="أسهم" />
                </>
              </Card>
            )}
          </React.Fragment>
        )}
      </main>
    </div>
  );
}
