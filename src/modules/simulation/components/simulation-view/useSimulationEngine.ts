import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore, type MarketType } from '@/lib/store';

import {
  COMMISSION_RATE,
  TICK_INTERVAL,
  FALLBACK_SEEDS,
  API_MARKET_CODE,
  getDefaultState,
} from './constants';
import type { SimState } from './types';
import {
  adaptApiStock,
  generateId,
  loadState,
  saveState,
  calcPortfolioValue,
} from './helpers';
import type { EGXStock, PendingTrade, Position, Transaction } from './types';

/* ============================================================
 * SimulationView — useSimulationEngine
 *
 * Owns the per-market simulation state, the random-walk price
 * tick loop, persistence, and trade/reset/watchlist actions.
 * The view component consumes the returned bag — the layout
 * itself stays in SimulationView.tsx.
 * ============================================================ */

export interface SimulationEngine {
  // market + currency context
  currentMarket: MarketType;
  // state
  simState: SimState;
  stocks: EGXStock[];
  isSimulationRunning: boolean;
  setIsSimulationRunning: React.Dispatch<React.SetStateAction<boolean>>;
  flashingTickers: Record<string, 'up' | 'down'>;
  reportRef: (node: HTMLDivElement | null) => void;
  // trade dialog state
  tradeDialogOpen: boolean;
  setTradeDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tradeType: 'buy' | 'sell';
  selectedStock: EGXStock | null;
  tradeQuantity: number;
  setTradeQuantity: React.Dispatch<React.SetStateAction<number>>;
  confirmDialogOpen: boolean;
  setConfirmDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pendingTrade: PendingTrade | null;
  resetDialogOpen: boolean;
  setResetDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // actions
  openTradeDialog: (stock: EGXStock, type: 'buy' | 'sell') => void;
  handleTradeSubmit: () => void;
  executeTrade: () => void;
  resetSimulation: () => void;
  toggleWatchlist: (ticker: string) => void;
  exportPDF: () => Promise<void>;
}

export function useSimulationEngine(): SimulationEngine {
  const currentMarket = useAppStore((s) => s.currentMarket);

  const [simState, setSimState] = useState<SimState>(getDefaultState());
  const [stocks, setStocks] = useState<EGXStock[]>([]);
  const [isSimulationRunning, setIsSimulationRunning] = useState(true);
  const [flashingTickers, setFlashingTickers] = useState<Record<string, 'up' | 'down'>>({});
  const [reportRef, setReportRef] = useState<HTMLDivElement | null>(null);

  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [selectedStock, setSelectedStock] = useState<EGXStock | null>(null);
  const [tradeQuantity, setTradeQuantity] = useState<number>(0);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingTrade, setPendingTrade] = useState<PendingTrade | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const buildStocksFromSeeds = useCallback(
    (seeds: { ticker: string; name_ar: string; sector: string; basePrice: number }[]): EGXStock[] => {
      return seeds.map((s) => {
        const randomOffset = (Math.random() - 0.5) * 0.04;
        const price = Number((s.basePrice * (1 + randomOffset)).toFixed(s.basePrice < 1 ? 4 : 2));
        return {
          ticker: s.ticker,
          name_ar: s.name_ar,
          sector: s.sector,
          basePrice: s.basePrice,
          price,
          change: Number((price - s.basePrice).toFixed(s.basePrice < 1 ? 4 : 2)),
          changePercent: Number((((price - s.basePrice) / s.basePrice) * 100).toFixed(2)),
          market: currentMarket,
        };
      });
    },
    [currentMarket],
  );

  const initStocks = useCallback(() => {
    const seeds = FALLBACK_SEEDS[currentMarket] || FALLBACK_SEEDS.EGX;
    setStocks(buildStocksFromSeeds(seeds));
  }, [buildStocksFromSeeds, currentMarket]);

  const fetchStocksForMarket = useCallback(async (market: MarketType) => {
    const apiMarket = API_MARKET_CODE[market] || market;
    try {
      const res = await fetch(`/api/stocks?market=${encodeURIComponent(apiMarket)}&page_size=500`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      const rawList: Record<string, unknown>[] =
        (data && Array.isArray(data.stocks) && data.stocks) ||
        (data && Array.isArray(data.data) && data.data) ||
        [];
      if (rawList.length === 0) return;
      const adapted = rawList
        .map((raw) => adaptApiStock(raw, market))
        .filter((s): s is EGXStock => s !== null);
      if (adapted.length === 0) return;
      const withInitial = adapted.map((s) => {
        const randomOffset = (Math.random() - 0.5) * 0.04;
        const price = Number((s.basePrice * (1 + randomOffset)).toFixed(s.basePrice < 1 ? 4 : 2));
        return {
          ...s,
          price,
          change: Number((price - s.basePrice).toFixed(s.basePrice < 1 ? 4 : 2)),
          changePercent: Number((((price - s.basePrice) / s.basePrice) * 100).toFixed(2)),
        };
      });
      setStocks(withInitial);
    } catch {
      // Silent — fallback seeds already cover this case.
    }
  }, []);

  // Load persisted state on mount + whenever the market changes.
  useEffect(() => {
    const loaded = loadState(currentMarket);
    setSimState(loaded);
    initStocks();
    fetchStocksForMarket(currentMarket);
  }, [initStocks, fetchStocksForMarket, currentMarket]);

  useEffect(() => {
    if (stocks.length > 0) {
      saveState(simState, currentMarket);
    }
  }, [simState, stocks.length, currentMarket]);

  // Price tick — random walk every TICK_INTERVAL (5s).
  const tickPrices = useCallback(() => {
    setStocks((prev) => {
      const newFlashing: Record<string, 'up' | 'down'> = {};
      const updated = prev.map((s) => {
        const volatilityPct =
          s.market === 'CRYPTO' ? 3.0 :
          s.market === 'US' ? 1.0 :
          s.market === 'TADAWUL' ? 1.5 :
          2.0;
        const changePercent = (Math.random() - 0.5) * volatilityPct * 2;
        const decimals = s.price < 1 ? 4 : 2;
        const newPrice = Number(Math.max(0.0001, s.price * (1 + changePercent / 100)).toFixed(decimals));
        const change = Number((newPrice - s.basePrice).toFixed(decimals));
        const changePct = Number((((newPrice - s.basePrice) / s.basePrice) * 100).toFixed(2));
        newFlashing[s.ticker] = changePercent >= 0 ? 'up' : 'down';
        return { ...s, price: newPrice, change, changePercent: changePct };
      });
      setFlashingTickers(newFlashing);
      setTimeout(() => setFlashingTickers({}), 800);
      return updated;
    });

    setSimState((prev) => {
      const portfolioValue = calcPortfolioValue(prev.positions, stocks);
      const totalValue = prev.balance + portfolioValue;
      const lastSnapshot = prev.history[prev.history.length - 1];
      const now = Date.now();

      if (lastSnapshot && now - lastSnapshot.timestamp < 30000) {
        const updatedHistory = [...prev.history];
        updatedHistory[updatedHistory.length - 1] = {
          ...lastSnapshot,
          portfolioValue: totalValue,
          timestamp: now,
        };
        return { ...prev, history: updatedHistory };
      }

      if (prev.history.length >= 100) {
        return {
          ...prev,
          history: [...prev.history.slice(-99), { date: new Date().toLocaleTimeString('ar-EG'), portfolioValue: totalValue, timestamp: now }],
        };
      }

      return {
        ...prev,
        history: [...prev.history, { date: new Date().toLocaleTimeString('ar-EG'), portfolioValue: totalValue, timestamp: now }],
      };
    });
  }, [stocks]);

  useEffect(() => {
    if (isSimulationRunning && stocks.length > 0) {
      simulationRef.current = setInterval(tickPrices, TICK_INTERVAL);
    } else if (simulationRef.current) {
      clearInterval(simulationRef.current);
      simulationRef.current = null;
    }
    return () => {
      if (simulationRef.current) clearInterval(simulationRef.current);
    };
  }, [isSimulationRunning, tickPrices, stocks.length]);

  // ─── Actions ───────────────────────────────────────────────

  const openTradeDialog = useCallback((stock: EGXStock, type: 'buy' | 'sell') => {
    setSelectedStock(stock);
    setTradeType(type);
    setTradeQuantity(0);
    setTradeDialogOpen(true);
  }, []);

  const handleTradeSubmit = useCallback(() => {
    if (!selectedStock || tradeQuantity <= 0) {
      toast.error('يرجى إدخال كمية صحيحة');
      return;
    }
    const pricePerShare = selectedStock.price;
    const subtotal = tradeQuantity * pricePerShare;
    const commission = subtotal * COMMISSION_RATE;

    if (tradeType === 'buy') {
      const totalCost = subtotal + commission;
      if (totalCost > simState.balance) {
        toast.error('رصيد غير كافي لإتمام هذه الصفقة');
        return;
      }
      setPendingTrade({ type: 'buy', stock: selectedStock, quantity: tradeQuantity, total: totalCost, commission });
    } else {
      const position = simState.positions.find((p) => p.ticker === selectedStock.ticker);
      if (!position || position.shares < tradeQuantity) {
        toast.error('ليس لديك عدد كافٍ من الأسهم للبيع');
        return;
      }
      const totalRevenue = subtotal - commission;
      setPendingTrade({ type: 'sell', stock: selectedStock, quantity: tradeQuantity, total: totalRevenue, commission });
    }
    setConfirmDialogOpen(true);
  }, [selectedStock, tradeQuantity, tradeType, simState]);

  const executeTrade = useCallback(() => {
    if (!pendingTrade) return;
    const { type, stock, quantity, total, commission } = pendingTrade;
    const now = new Date().toISOString();

    setSimState((prev) => {
      const newTransactions: Transaction[] = [
        ...prev.transactions,
        {
          id: generateId(),
          date: now,
          type,
          ticker: stock.ticker,
          shares: quantity,
          price: stock.price,
          total,
          commission,
        },
      ];

      let newPositions: Position[] = [...prev.positions];
      if (type === 'buy') {
        const existingIdx = newPositions.findIndex((p) => p.ticker === stock.ticker);
        if (existingIdx >= 0) {
          const existing = newPositions[existingIdx];
          const totalShares = existing.shares + quantity;
          const newAvgCost = (existing.shares * existing.avgCost + quantity * stock.price) / totalShares;
          newPositions[existingIdx] = { ticker: stock.ticker, shares: totalShares, avgCost: newAvgCost };
        } else {
          newPositions.push({ ticker: stock.ticker, shares: quantity, avgCost: stock.price });
        }
      } else {
        const existingIdx = newPositions.findIndex((p) => p.ticker === stock.ticker);
        if (existingIdx >= 0) {
          const existing = newPositions[existingIdx];
          const pnl = (stock.price - existing.avgCost) * quantity - commission;
          const sellTxIdx = newTransactions.length - 1;
          newTransactions[sellTxIdx] = { ...newTransactions[sellTxIdx], pnl };
          if (existing.shares === quantity) {
            newPositions.splice(existingIdx, 1);
          } else {
            newPositions[existingIdx] = { ...existing, shares: existing.shares - quantity };
          }
        }
      }

      newPositions = newPositions.filter((p) => p.shares > 0);

      return {
        ...prev,
        balance: type === 'buy' ? prev.balance - total : prev.balance + total,
        positions: newPositions,
        transactions: newTransactions,
      };
    });

    toast.success(
      type === 'buy'
        ? `تم شراء ${quantity} سهم من ${stock.name_ar} بنجاح`
        : `تم بيع ${quantity} سهم من ${stock.name_ar} بنجاح`,
    );

    setConfirmDialogOpen(false);
    setTradeDialogOpen(false);
    setPendingTrade(null);
    setTradeQuantity(0);
  }, [pendingTrade]);

  const resetSimulation = useCallback(() => {
    const fresh = getDefaultState();
    setSimState(fresh);
    initStocks();
    fetchStocksForMarket(currentMarket);
    setResetDialogOpen(false);
    toast.success('تم إعادة تعيين المحاكاة بنجاح');
  }, [initStocks, fetchStocksForMarket, currentMarket]);

  const toggleWatchlist = useCallback((ticker: string) => {
    setSimState((prev) => {
      if (prev.watchlist.includes(ticker)) {
        return { ...prev, watchlist: prev.watchlist.filter((t) => t !== ticker) };
      }
      return { ...prev, watchlist: [...prev.watchlist, ticker] };
    });
  }, []);

  const exportPDF = useCallback(async () => {
    if (!reportRef) return;
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      await exportToPdf(reportRef, {
        filename: 'تقرير_المحاكاة_المالية.pdf',
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    }
  }, [reportRef]);

  return {
    currentMarket,
    simState,
    stocks,
    isSimulationRunning,
    setIsSimulationRunning,
    flashingTickers,
    reportRef: setReportRef,
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
  };
}
