'use client';

import { useMemo, useState } from 'react';
import {
  Gamepad2,
  Clock,
  Download,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShareButton } from '@/components/share/ShareButton';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { MARKET_NAMES_AR, MARKET_CURRENCY_LABEL } from '@/lib/store';

import { INITIAL_BALANCE } from './constants';
import {
  formatCurrency,
  formatNumber,
  isMarketOpen,
  getCairoTime,
  calcPortfolioValue,
} from './helpers';
import {
  buildStockListColumns,
  buildHoldingsColumns,
  buildTransactionsColumns,
  type HoldingsRow,
  type TransactionRow,
} from './columns';
import { TradeDialog, ConfirmDialog, ResetDialog } from './dialogs';
import { SimulationTabs } from './tabs';
import { ReportSection } from './ReportSection';
import { useSimulationEngine } from './useSimulationEngine';

/* ============================================================
 * P40-SIMULATION — Trading Simulation View (container)
 *
 * Pure layout: pulls all state + actions from useSimulationEngine,
 * derives display-only values, then renders header + tabs +
 * dialogs + hidden PDF report. Stays under 400 LOC (Rule 75).
 * ============================================================ */

export function SimulationView() {
  const engine = useSimulationEngine();
  const {
    currentMarket,
    simState,
    stocks,
    isSimulationRunning,
    setIsSimulationRunning,
    flashingTickers,
    reportRef,
    tradeDialogOpen,
    setTradeDialogOpen,
    tradeType,
    selectedStock,
    tradeQuantity,
    setTradeQuantity,
    confirmDialogOpen,
    setConfirmDialogOpen,
    pendingTrade,
    resetDialogOpen,
    setResetDialogOpen,
    openTradeDialog,
    handleTradeSubmit,
    executeTrade,
    resetSimulation,
    toggleWatchlist,
    exportPDF,
  } = engine;

  const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket] || 'ج.م';
  const marketNameAr = MARKET_NAMES_AR[currentMarket] || 'السوق';

  const [searchQuery, setSearchQuery] = useState('');
  const [transactionFilter, setTransactionFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [activeTab, setActiveTab] = useState('dashboard');

  // ─── Derived values ────────────────────────────────────────

  const portfolioValue = useMemo(
    () => calcPortfolioValue(simState.positions, stocks),
    [simState.positions, stocks],
  );
  const totalValue = simState.balance + portfolioValue;
  const totalPnL = totalValue - INITIAL_BALANCE;
  const totalPnLPercent = INITIAL_BALANCE > 0 ? (totalPnL / INITIAL_BALANCE) * 100 : 0;
  const investedAmount = simState.positions.reduce((sum, pos) => sum + pos.shares * pos.avgCost, 0);
  const tradeCount = simState.transactions.length;
  const marketOpen = isMarketOpen();

  // ─── Filtered data + memoized columns ─────────────────────

  const filteredStocks = useMemo(() => {
    if (!searchQuery.trim()) return stocks;
    const q = searchQuery.toLowerCase();
    return stocks.filter(
      (s) =>
        s.ticker.toLowerCase().includes(q) ||
        s.name_ar.includes(q) ||
        s.sector.includes(q),
    );
  }, [stocks, searchQuery]);

  const filteredTransactions = useMemo(() => {
    if (transactionFilter === 'all') return simState.transactions;
    return simState.transactions.filter((t) => t.type === transactionFilter);
  }, [simState.transactions, transactionFilter]);

  const sectorAllocation = useMemo(() => {
    const allocation: Record<string, number> = {};
    simState.positions.forEach((pos) => {
      const stock = stocks.find((s) => s.ticker === pos.ticker);
      if (stock) {
        const value = pos.shares * stock.price;
        allocation[stock.sector] = (allocation[stock.sector] || 0) + value;
      }
    });
    return Object.entries(allocation)
      .map(([sector, value]) => ({ sector, value, percent: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [simState.positions, stocks, totalValue]);

  const chartData = useMemo(() => {
    return simState.history.map((h) => ({
      time: h.date,
      value: Number((h.portfolioValue ?? 0).toFixed(2)),
    }));
  }, [simState.history]);

  const stockListColumns = useMemo(() => buildStockListColumns(openTradeDialog), [openTradeDialog]);
  const holdingsColumns = useMemo(
    () => buildHoldingsColumns(openTradeDialog, currencyLabel),
    [openTradeDialog, currencyLabel],
  );
  const transactionsColumns = useMemo(
    () => buildTransactionsColumns(currencyLabel),
    [currencyLabel],
  );

  const holdingsRows = useMemo<HoldingsRow[]>(() => {
    return simState.positions.map((pos) => {
      const stock = stocks.find((s) => s.ticker === pos.ticker);
      if (!stock) return null;
      const currentValue = pos.shares * stock.price;
      const costValue = pos.shares * pos.avgCost;
      const pnl = currentValue - costValue;
      const pnlPercent = costValue > 0 ? (pnl / costValue) * 100 : 0;
      return { ...pos, _stock: stock, _currentValue: currentValue, _pnl: pnl, _pnlPercent: pnlPercent };
    }).filter((r): r is HoldingsRow => r !== null);
  }, [simState.positions, stocks]);

  const transactionsRows = useMemo<TransactionRow[]>(() => {
    return [...filteredTransactions].reverse().map((tx) => {
      const stock = stocks.find((s) => s.ticker === tx.ticker);
      return { ...tx, _stockName: stock?.name_ar };
    });
  }, [filteredTransactions, stocks]);

  // ─── Render ────────────────────────────────────────────────

  if (stocks.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">جاري تحميل المحاكاة...</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 from-profit to-whale rounded-xl shadow-lg">
            <Gamepad2 className="h-6 w-6 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">محاكاة التداول الافتراضي</h1>
            <p className="text-sm text-muted-foreground">
              تدرّب على التداول بأموال افتراضية بدون أي مخاطر — {marketNameAr}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <MarketSelector size="sm" />
          <Badge
            variant={marketOpen ? 'default' : 'secondary'}
            className={cn('gap-1.5 px-3 py-1', marketOpen ? 'bg-profit hover:bg-profit' : 'bg-loss hover:bg-loss')}
          >
            <span className={cn('h-2 w-2 rounded-full', marketOpen ? 'bg-white animate-pulse' : 'bg-loss')} />
            {marketOpen ? 'السوق مفتوح' : 'السوق مغلق'}
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {getCairoTime()} - القاهرة
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSimulationRunning((p) => !p)}
            className="gap-1.5"
          >
            {isSimulationRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isSimulationRunning ? 'إيقاف' : 'تشغيل'}
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} className="gap-1.5">
            <Download className="h-4 w-4" />
            تصدير التقرير
          </Button>
          <ShareButton
            iconOnly={false}
            variant="outline"
            size="sm"
            stockData={{
              ticker: `SIM-${currentMarket}`,
              name: 'Trading Simulation',
              nameAr: `محاكاة التداول — ${marketNameAr}`,
              price: totalValue,
              change: totalPnLPercent,
              recommendation: totalPnL >= 0 ? 'مربح' : 'خاسر',
              recommendationAr: totalPnL >= 0 ? 'محفظة رابحة' : 'محفظة خاسرة',
              confidence: totalPnLPercent >= 0 ? totalPnLPercent : 100 - Math.abs(totalPnLPercent),
              sector: `${tradeCount} صفقة | ${simState.positions.length} مركز مفتوح`,
            }}
          />
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setResetDialogOpen(true)}
            className="gap-1.5"
          >
            <RotateCcw className="h-4 w-4" />
            إعادة تعيين
          </Button>
        </div>
      </div>

      <SimulationTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        balance={simState.balance}
        portfolioValue={portfolioValue}
        totalValue={totalValue}
        totalPnL={totalPnL}
        totalPnLPercent={totalPnLPercent}
        investedAmount={investedAmount}
        tradeCount={tradeCount}
        chartData={chartData}
        stocks={stocks}
        flashingTickers={flashingTickers}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        filteredStocks={filteredStocks}
        stockListColumns={stockListColumns}
        positions={simState.positions}
        holdingsRows={holdingsRows}
        holdingsColumns={holdingsColumns}
        sectorAllocation={sectorAllocation}
        currencyLabel={currencyLabel}
        transactionFilter={transactionFilter}
        onTransactionFilterChange={setTransactionFilter}
        filteredTransactions={filteredTransactions}
        transactionsRows={transactionsRows}
        transactionsColumns={transactionsColumns}
        watchlist={simState.watchlist}
        onToggleWatchlist={toggleWatchlist}
        onOpenTradeDialog={openTradeDialog}
      />

      <TradeDialog
        open={tradeDialogOpen}
        onOpenChange={setTradeDialogOpen}
        tradeType={tradeType}
        selectedStock={selectedStock}
        tradeQuantity={tradeQuantity}
        onTradeQuantityChange={setTradeQuantity}
        balance={simState.balance}
        positions={simState.positions}
        onSubmit={handleTradeSubmit}
      />

      <ConfirmDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        pendingTrade={pendingTrade}
        onConfirm={executeTrade}
      />

      <ResetDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        onConfirm={resetSimulation}
      />

      <div ref={reportRef}>
        <ReportSection
          marketNameAr={marketNameAr}
          balance={simState.balance}
          portfolioValue={portfolioValue}
          totalPnL={totalPnL}
          tradeCount={tradeCount}
          currencyLabel={currencyLabel}
          positions={simState.positions}
          transactions={simState.transactions}
          stocks={stocks}
        />
      </div>
    </div>
  );
}

export default SimulationView;

/* Re-export helpers so legacy callers (if any) importing them from the
 * original path keep working without needing to know about the split. */
export { formatCurrency, formatNumber } from './helpers';
