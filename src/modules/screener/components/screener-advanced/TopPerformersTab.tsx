// src/modules/screener/components/screener-advanced/TopPerformersTab.tsx
// F-Phase3-Split-Screener — Tab 2 of StockScreenerAdvanced: أعلى/أدنى
// المؤدين خلال فترة معيّنة. بيانات الـ fetch في useTopPerformersData (Phase 2).

'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RefreshCw,
  AlertTriangle,
  Trophy,
  BarChart3,
  TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { UnifiedTable } from '@/components/shared/UnifiedTable';
import { useTranslation } from '@/lib/i18n-context';
import {
  useTopPerformersData,
  type TopPerformerStock,
} from '@/hooks/useScreenerData';
import {
  getPeriods,
  getDirections,
  formatNumber,
  generateTopPerformersText,
} from './helpers';
import { CollapsibleSection } from './CollapsibleSection';
import { FilterField } from './FilterField';
import { KPIBox } from './KPIBox';
import { ExportDropdown } from './ExportDropdown';
import { buildTopPerformerColumns } from './topPerformerColumns';

type TopSortField = 'ticker' | 'start_price' | 'end_price' | 'change_pct' | 'period_days';

export function TopPerformersTab() {
  const t = useTranslation();
  const loadStockDetail = useAppStore((s) => s.loadStockDetail);
  // FIX (Oct 2026 — owner directive): sync مع store.currentMarket
  const _storeMarket = useAppStore((s) => s.currentMarket);

  const [period, setPeriod] = useState('1m');
  const [direction, setDirection] = useState('both');
  const [market, setMarket] = useState(_storeMarket || 'EGX');
  // لما الـ store market يتغير، حدّث الـ local state
  useEffect(() => {
    if (_storeMarket) setMarket(_storeMarket);
  }, [_storeMarket]);
  const [limit, setLimit] = useState(20);
  // F-Strangler-Screener: data logic moved to useTopPerformersData hook
  // (fetches /api/stocks/top-performers via useApiQuery — TanStack Query).
  const {
    topPerformers: data,
    topLoading: loading,
    topError: error,
    refetch: refetchTopPerformers,
  } = useTopPerformersData({ period, direction, market, limit });

  // client-side sort
  const [sortField, setSortField] = useState<TopSortField | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const results = data?.results || [];
  const summary = data?.summary;
  const periodLabel = getPeriods(t).find((p) => p.value === period)?.label || period;

  const sortedResults = useMemo(() => {
    if (!sortField) return results;
    const dir = sortDir === 'desc' ? -1 : 1;
    return [...results].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
      return dir * String(av).localeCompare(String(bv));
    });
  }, [results, sortField, sortDir]);

  // ── UnifiedTable columns for top performers ──
  const topPerformerColumns = useMemo(() => buildTopPerformerColumns(t), [t]);

  const toggleSort = (field: TopSortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };
  // toggleSort preserved from original (UnifiedTable handles sort internally).
  void toggleSort;

  const topPerformersShareText = useMemo(() => {
    return data ? generateTopPerformersText(data, t) : '';
  }, [data, t]);

  return (
    <div className="space-y-3">
      {/* Filters Card — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      <CollapsibleSection
        title={t('screener.advanced.performers.topPerformersTitle')}
        icon={<Trophy className="w-4 h-4 text-warning" />}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <FilterField label={t('screener.advanced.performers.filters.period')}>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {getPeriods(t).map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label={t('screener.advanced.performers.filters.direction')}>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {getDirections(t).map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label={t('screener.advanced.performers.filters.market')}>
            <Select value={market} onValueChange={setMarket}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EGX">{t('screener.advanced.filters.egx')}</SelectItem>
                <SelectItem value="ALL">{t('screener.advanced.filters.allMarkets')}</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label={t('screener.advanced.filters.resultCount')}>
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </div>

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border flex-wrap gap-2">
          <div className="text-xs text-muted-foreground">
            {t('screener.advanced.performers.periodLabel')} <span className="font-medium">{periodLabel}</span>
            {data && (
              <>
                {' • ' + t('screener.advanced.performers.fromWord') + ' '}
                <span className="font-mono">{data.start_date}</span>
                {' ' + t('screener.advanced.performers.toWord') + ' '}
                <span className="font-mono">{data.end_date}</span>
              </>
            )}
          </div>
          <Button variant="default" size="sm" onClick={refetchTopPerformers} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            {t('screener.advanced.buttons.refresh')}
          </Button>
          <ExportDropdown shareText={topPerformersShareText} disabled={!topPerformersShareText} />
        </div>
      </CollapsibleSection>

      {/* Summary KPIs inline */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KPIBox label={t('screener.advanced.performers.kpi.totalStocks')} value={summary.total_stocks} />
          <KPIBox label={t('screener.advanced.performers.kpi.gainers')} value={summary.gainers} color="text-profit" />
          <KPIBox label={t('screener.advanced.performers.kpi.losers')} value={summary.losers} color="text-loss" />
          <KPIBox
            label={t('screener.advanced.performers.kpi.avgChange')}
            value={`${summary.avg_change >= 0 ? '+' : ''}${summary.avg_change}%`}
            color={summary.avg_change >= 0 ? 'text-profit' : 'text-loss'}
          />
        </div>
      )}

      {/* Best / Worst performer — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      {summary && (summary.best_performer || summary.worst_performer) && (
        <CollapsibleSection
          title={t('screener.advanced.performers.kpi.bestWorst')}
          icon={<Trophy className="w-4 h-4 text-warning" />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summary.best_performer && (
              <Card className="border-profit/20 bg-profit/5">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="w-4 h-4 text-warning" />
                    <span className="text-sm font-semibold text-profit ">
                      {t('screener.advanced.performers.topGainer', { period: periodLabel })}
                    </span>
                  </div>
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => loadStockDetail(summary.best_performer!.ticker)}
                  >
                    <div>
                      <div className="font-mono font-bold text-lg">{summary.best_performer.ticker}</div>
                      <div className="text-xs text-muted-foreground">
                        {summary.best_performer.name_ar || summary.best_performer.name}
                        {summary.best_performer.sector && ` • ${summary.best_performer.sector}`}
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="text-profit font-mono font-bold text-xl">
                        +{summary.best_performer.change_pct}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatNumber(summary.best_performer.start_price)} → {formatNumber(summary.best_performer.end_price)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {summary.worst_performer && (
              <Card className="border-loss/20 bg-loss/5">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingDown className="w-4 h-4 text-loss" />
                    <span className="text-sm font-semibold text-loss ">
                      {t('screener.advanced.performers.topLoser', { period: periodLabel })}
                    </span>
                  </div>
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => loadStockDetail(summary.worst_performer!.ticker)}
                  >
                    <div>
                      <div className="font-mono font-bold text-lg">{summary.worst_performer.ticker}</div>
                      <div className="text-xs text-muted-foreground">
                        {summary.worst_performer.name_ar || summary.worst_performer.name}
                        {summary.worst_performer.sector && ` • ${summary.worst_performer.sector}`}
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="text-loss font-mono font-bold text-xl">
                        {summary.worst_performer.change_pct}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatNumber(summary.worst_performer.start_price)} → {formatNumber(summary.worst_performer.end_price)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Results Table — UNIFIED-MARKET-UX (Task 3): Collapsible */}
      <CollapsibleSection
        title={t('screener.advanced.performers.filters.resultsTable')}
        icon={<BarChart3 className="w-4 h-4 text-profit" />}
        contentClassName="p-0 space-y-0"
      >
        {loading && !data ? (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            {t('screener.advanced.loading.loadingPerformers')}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-loss">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
            {error}
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={refetchTopPerformers} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                {t('screener.advanced.buttons.retry')}
              </Button>
            </div>
          </div>
        ) : sortedResults.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {t('screener.advanced.performers.empty')}
          </div>
        ) : (
          <UnifiedTable<TopPerformerStock>
            columns={topPerformerColumns}
            data={sortedResults}
            keyField="ticker"
            onRowClick={(row) => loadStockDetail(row.ticker)}
            dense
            maxHeight="max-h-[600px]"
            emptyTextAr={t('screener.advanced.performers.empty')}
            filterable
            columnToggle
          />
        )}
      </CollapsibleSection>

      {/* Footer hint */}
      <div className="text-xs text-muted-foreground text-center pt-1">
        {t('screener.advanced.performers.footer')}
      </div>
    </div>
  );
}
