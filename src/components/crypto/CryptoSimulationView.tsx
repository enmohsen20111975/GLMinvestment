'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Gamepad2,
  TrendingUp,
  TrendingDown,
  Wallet,
  DollarSign,
  ShoppingCart,
  BarChart3,
  Eye,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Download,
  X,
  Plus,
  Minus,
  Search,
  Star,
  PieChart,
  History,
  Trophy,
  Target,
  AlertTriangle,
  RotateCcw,
  Play,
  Pause,
  Zap,
  Bitcoin,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  PieChart as RechartsPieChart,
  Pie,
  Tooltip,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────

interface CryptoCoin {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  ath: number;
  ath_change_percentage: number;
  price_change_24h?: number;
  sparkline_in_7d?: number[];
}

interface CryptoPosition {
  coinId: string;
  symbol: string;
  name: string;
  amount: number;
  avgCost: number;
}

interface CryptoTransaction {
  id: string;
  date: string;
  type: 'buy' | 'sell';
  coinId: string;
  symbol: string;
  name: string;
  amount: number;
  price: number;
  total: number;
  commission: number;
  pnl?: number;
}

interface PortfolioSnapshot {
  date: string;
  portfolioValue: number;
  timestamp: number;
}

interface CryptoSimState {
  balance: number;
  positions: CryptoPosition[];
  transactions: CryptoTransaction[];
  watchlist: string[];
  history: PortfolioSnapshot[];
  startedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const INITIAL_BALANCE = 100_000;
const COMMISSION_RATE = 0.001; // 0.1%
const STORAGE_KEY = 'crypto_simulation_state';
const TICK_INTERVAL = 5000; // 5 seconds

const CRYPTO_COLORS: Record<string, string> = {
  bitcoin: '#F7931A',
  ethereum: '#627EEA',
  tether: '#26A17B',
  binancecoin: '#F3BA2F',
  solana: '#9945FF',
  ripple: '#23292F',
  'usd-coin': '#2775CA',
  cardano: '#0033AD',
  dogecoin: '#C3A634',
  'avalanche-2': '#E84142',
  tron: '#FF0013',
  chainlink: '#2A5ADA',
  polkadot: '#E6007A',
  'bitcoin-cash': '#8DC351',
  litecoin: '#BFBBBB',
  near: '#00C08B',
  uniswap: '#FF007A',
  aptos: '#4CD9A3',
  stellar: '#14B6E7',
  'render-token': '#FF4F4F',
  sui: '#6FBCF0',
  pepe: '#5D9B49',
  'shiba-inu': '#FFA409',
  polygon: '#8247E5',
  bonk: '#FF6B35',
  'injective-protocol': '#00F2EA',
  fantom: '#1969FF',
  aave: '#B6509E',
  'the-graph': '#6747ED',
  maker: '#1AAB9B',
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) < 0.0001 && n !== 0) {
    return n.toExponential(2);
  }
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) {
    return `$${(n / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }
  return `$${formatNumber(n)}`;
}

function formatCryptoAmount(amount: number, symbol: string): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(2)}M ${symbol}`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(2)}K ${symbol}`;
  }
  if (amount < 0.0001 && amount > 0) {
    return `${amount.toExponential(2)} ${symbol}`;
  }
  return `${formatNumber(amount, 6)} ${symbol}`;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getDefaultState(): CryptoSimState {
  return {
    balance: INITIAL_BALANCE,
    positions: [],
    transactions: [],
    watchlist: [],
    history: [
      {
        date: new Date().toISOString().split('T')[0],
        portfolioValue: INITIAL_BALANCE,
        timestamp: Date.now(),
      },
    ],
    startedAt: new Date().toISOString(),
  };
}

function loadState(): CryptoSimState {
  if (typeof window === 'undefined') return getDefaultState();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as CryptoSimState;
      return parsed;
    }
  } catch {
    // ignore
  }
  return getDefaultState();
}

function saveState(state: CryptoSimState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ─── Component ────────────────────────────────────────────────────────────

export function CryptoSimulationView() {
  // State
  const [simState, setSimState] = useState<CryptoSimState>(getDefaultState());
  const [cryptos, setCryptos] = useState<CryptoCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [transactionFilter, setTransactionFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [isSimulationRunning, setIsSimulationRunning] = useState(true);
  const [flashingCoins, setFlashingCoins] = useState<Record<string, 'up' | 'down'>>({});
  const [reportRef, setReportRef] = useState<HTMLDivElement | null>(null);

  // Trade dialog
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoCoin | null>(null);
  const [tradeAmount, setTradeAmount] = useState<number>(0);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingTrade, setPendingTrade] = useState<{
    type: 'buy' | 'sell';
    crypto: CryptoCoin;
    amount: number;
    total: number;
    commission: number;
  } | null>(null);

  // Reset dialog
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch crypto data
  const fetchCryptos = useCallback(async () => {
    try {
      const response = await fetch('/api/crypto?per_page=50');
      const data = await response.json();
      if (data.success && data.data) {
        const cryptoList = Array.isArray(data.data)
          ? data.data
          : Array.isArray(data.data?.coins)
          ? data.data.coins
          : [];
        setCryptos(cryptoList);
      }
    } catch (error) {
      console.error('Error fetching crypto data:', error);
      toast.error('فشل في تحميل بيانات العملات');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load persisted state on mount
  useEffect(() => {
    const loaded = loadState();
    setSimState(loaded);
    fetchCryptos();
  }, [fetchCryptos]);

  // Save state on change
  useEffect(() => {
    if (cryptos.length > 0) {
      saveState(simState);
    }
  }, [simState, cryptos.length]);

  // Price simulation tick (adds small random variations)
  const tickPrices = useCallback(() => {
    setCryptos((prev) => {
      const newFlashing: Record<string, 'up' | 'down'> = {};
      const updated = prev.map((coin) => {
        const changePercent = (Math.random() - 0.5) * 2; // ±1%
        const newPrice = Math.max(0.0000001, coin.current_price * (1 + changePercent / 100));
        newFlashing[coin.id] = changePercent >= 0 ? 'up' : 'down';
        return {
          ...coin,
          current_price: newPrice,
          price_change_percentage_24h: coin.price_change_percentage_24h + changePercent * 0.1,
        };
      });
      setFlashingCoins(newFlashing);
      setTimeout(() => setFlashingCoins({}), 800);
      return updated;
    });

    // Record portfolio snapshot
    setSimState((prev) => {
      const portfolioValue = calcPortfolioValue(prev.positions, cryptos);
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
          history: [...prev.history.slice(-99), { date: new Date().toLocaleTimeString('en-US'), portfolioValue: totalValue, timestamp: now }],
        };
      }

      return {
        ...prev,
        history: [...prev.history, { date: new Date().toLocaleTimeString('en-US'), portfolioValue: totalValue, timestamp: now }],
      };
    });
  }, [cryptos]);

  // Start/stop simulation
  useEffect(() => {
    if (isSimulationRunning && cryptos.length > 0) {
      simulationRef.current = setInterval(tickPrices, TICK_INTERVAL);
    } else if (simulationRef.current) {
      clearInterval(simulationRef.current);
      simulationRef.current = null;
    }
    return () => {
      if (simulationRef.current) clearInterval(simulationRef.current);
    };
  }, [isSimulationRunning, tickPrices, cryptos.length]);

  // Refresh data periodically
  useEffect(() => {
    const refreshInterval = setInterval(fetchCryptos, 60000); // Refresh every minute
    return () => clearInterval(refreshInterval);
  }, [fetchCryptos]);

  // ─── Calculations ───────────────────────────────────────────────────

  const calcPortfolioValue = useCallback(
    (positions: CryptoPosition[], currentCryptos: CryptoCoin[]): number => {
      return positions.reduce((sum, pos) => {
        const coin = currentCryptos.find((c) => c.id === pos.coinId);
        if (!coin) return sum;
        return sum + pos.amount * coin.current_price;
      }, 0);
    },
    []
  );

  const portfolioValue = useMemo(
    () => calcPortfolioValue(simState.positions, cryptos),
    [simState.positions, cryptos, calcPortfolioValue]
  );

  const totalValue = simState.balance + portfolioValue;
  const totalPnL = totalValue - INITIAL_BALANCE;
  const totalPnLPercent = INITIAL_BALANCE > 0 ? (totalPnL / INITIAL_BALANCE) * 100 : 0;
  const investedAmount = simState.positions.reduce((sum, pos) => sum + pos.amount * pos.avgCost, 0);
  const tradeCount = simState.transactions.length;

  // ─── Actions ───────────────────────────────────────────────────────

  const openTradeDialog = useCallback((crypto: CryptoCoin, type: 'buy' | 'sell') => {
    setSelectedCrypto(crypto);
    setTradeType(type);
    setTradeAmount(0);
    setTradeDialogOpen(true);
  }, []);

  const handleTradeSubmit = useCallback(() => {
    if (!selectedCrypto || tradeAmount <= 0) {
      toast.error('يرجى إدخال كمية صحيحة');
      return;
    }

    const pricePerCoin = selectedCrypto.current_price;
    const subtotal = tradeAmount * pricePerCoin;
    const commission = subtotal * COMMISSION_RATE;

    if (tradeType === 'buy') {
      const totalCost = subtotal + commission;
      if (totalCost > simState.balance) {
        toast.error('رصيد غير كافي لإتمام هذه الصفقة');
        return;
      }
      setPendingTrade({ type: 'buy', crypto: selectedCrypto, amount: tradeAmount, total: totalCost, commission });
    } else {
      const position = simState.positions.find((p) => p.coinId === selectedCrypto.id);
      if (!position || position.amount < tradeAmount) {
        toast.error('ليس لديك كمية كافية للبيع');
        return;
      }
      const totalRevenue = subtotal - commission;
      setPendingTrade({ type: 'sell', crypto: selectedCrypto, amount: tradeAmount, total: totalRevenue, commission });
    }

    setConfirmDialogOpen(true);
  }, [selectedCrypto, tradeAmount, tradeType, simState]);

  const executeTrade = useCallback(() => {
    if (!pendingTrade) return;

    const { type, crypto, amount, total, commission } = pendingTrade;
    const now = new Date().toISOString();

    setSimState((prev) => {
      const newTransactions: CryptoTransaction[] = [
        ...prev.transactions,
        {
          id: generateId(),
          date: now,
          type,
          coinId: crypto.id,
          symbol: crypto.symbol,
          name: crypto.name,
          amount,
          price: crypto.current_price,
          total,
          commission,
        },
      ];

      let newPositions = [...prev.positions];
      if (type === 'buy') {
        const existingIdx = newPositions.findIndex((p) => p.coinId === crypto.id);
        if (existingIdx >= 0) {
          const existing = newPositions[existingIdx];
          const totalAmount = existing.amount + amount;
          const newAvgCost = (existing.amount * existing.avgCost + amount * crypto.current_price) / totalAmount;
          newPositions[existingIdx] = { ...existing, amount: totalAmount, avgCost: newAvgCost };
        } else {
          newPositions.push({
            coinId: crypto.id,
            symbol: crypto.symbol,
            name: crypto.name,
            amount,
            avgCost: crypto.current_price,
          });
        }
      } else {
        const existingIdx = newPositions.findIndex((p) => p.coinId === crypto.id);
        if (existingIdx >= 0) {
          const existing = newPositions[existingIdx];
          const pnl = (crypto.current_price - existing.avgCost) * amount - commission;
          const sellTxIdx = newTransactions.length - 1;
          newTransactions[sellTxIdx] = { ...newTransactions[sellTxIdx], pnl };
          if (Math.abs(existing.amount - amount) < 0.0000001) {
            newPositions.splice(existingIdx, 1);
          } else {
            newPositions[existingIdx] = { ...existing, amount: existing.amount - amount };
          }
        }
      }

      // Remove positions with near-zero amounts
      newPositions = newPositions.filter((p) => p.amount > 0.0000001);

      return {
        ...prev,
        balance: type === 'buy' ? prev.balance - total : prev.balance + total,
        positions: newPositions,
        transactions: newTransactions,
      };
    });

    toast.success(
      type === 'buy'
        ? `تم شراء ${formatCryptoAmount(amount, crypto.symbol)} بنجاح`
        : `تم بيع ${formatCryptoAmount(amount, crypto.symbol)} بنجاح`
    );

    setConfirmDialogOpen(false);
    setTradeDialogOpen(false);
    setPendingTrade(null);
    setTradeAmount(0);
  }, [pendingTrade]);

  const resetSimulation = useCallback(() => {
    const fresh = getDefaultState();
    setSimState(fresh);
    setResetDialogOpen(false);
    toast.success('تم إعادة تعيين المحاكاة بنجاح');
  }, []);

  const toggleWatchlist = useCallback(
    (coinId: string) => {
      setSimState((prev) => {
        if (prev.watchlist.includes(coinId)) {
          return { ...prev, watchlist: prev.watchlist.filter((id) => id !== coinId) };
        }
        return { ...prev, watchlist: [...prev.watchlist, coinId] };
      });
    },
    []
  );

  const exportPDF = useCallback(async () => {
    if (!reportRef) return;
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      await exportToPdf(reportRef, {
        filename: 'تقرير_محاكاة_الكريبتو.pdf',
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    }
  }, [reportRef]);

  // ─── Filtered data ─────────────────────────────────────────────────

  const filteredCryptos = useMemo(() => {
    if (!searchQuery.trim()) return cryptos;
    const q = searchQuery.toLowerCase();
    return cryptos.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q)
    );
  }, [cryptos, searchQuery]);

  const filteredTransactions = useMemo(() => {
    if (transactionFilter === 'all') return simState.transactions;
    return simState.transactions.filter((t) => t.type === transactionFilter);
  }, [simState.transactions, transactionFilter]);

  const allocationData = useMemo(() => {
    const allocation: Record<string, { value: number; name: string; symbol: string }> = {};
    simState.positions.forEach((pos) => {
      const coin = cryptos.find((c) => c.id === pos.coinId);
      if (coin) {
        const value = pos.amount * coin.current_price;
        allocation[pos.coinId] = {
          value: (allocation[pos.coinId]?.value || 0) + value,
          name: pos.name,
          symbol: pos.symbol,
        };
      }
    });
    return Object.entries(allocation)
      .map(([id, data]) => ({
        id,
        name: data.name,
        symbol: data.symbol,
        value: data.value,
        percent: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [simState.positions, cryptos, totalValue]);

  const chartData = useMemo(() => {
    return simState.history.map((h) => ({
      time: h.date,
      value: Number(h.portfolioValue.toFixed(2)),
    }));
  }, [simState.history]);

  // ─── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">جاري تحميل بيانات العملات...</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl shadow-lg">
            <Bitcoin className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">محاكاة تداول الكريبتو</h1>
            <p className="text-sm text-muted-foreground">تدرب على تداول العملات الرقمية بأموال افتراضية</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="default" className="gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-600">
            <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
            السوق مفتوح 24/7
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {new Date().toLocaleTimeString('en-US')}
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

      {/* ─── Tabs ─────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="dashboard" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            لوحة التحكم
          </TabsTrigger>
          <TabsTrigger value="trading" className="gap-1.5">
            <ShoppingCart className="h-4 w-4" />
            التداول
          </TabsTrigger>
          <TabsTrigger value="portfolio" className="gap-1.5">
            <Wallet className="h-4 w-4" />
            المحفظة
          </TabsTrigger>
          <TabsTrigger value="transactions" className="gap-1.5">
            <History className="h-4 w-4" />
            سجل المعاملات
          </TabsTrigger>
          <TabsTrigger value="watchlist" className="gap-1.5">
            <Eye className="h-4 w-4" />
            قائمة المراقبة
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* Tab 1: Dashboard                                          */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <Card className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">القيمة الإجمالية</p>
                    <p className="text-lg font-bold">{formatCurrency(totalValue)}</p>
                  </div>
                  <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                    <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">الرصيد النقدي</p>
                    <p className="text-lg font-bold">{formatCurrency(simState.balance)}</p>
                  </div>
                  <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-lg">
                    <Wallet className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">قيمة المحفظة</p>
                    <p className="text-lg font-bold">{formatCurrency(portfolioValue)}</p>
                  </div>
                  <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                    <TrendingUp className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={cn('relative overflow-hidden', totalPnL >= 0 ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800')}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">إجمالي الربح/الخسارة</p>
                    <p className={cn('text-lg font-bold', totalPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL)}
                    </p>
                  </div>
                  <div className={cn('p-2 rounded-lg', totalPnL >= 0 ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30')}>
                    {totalPnL >= 0 ? <TrendingUp className="h-5 w-5 text-emerald-600" /> : <TrendingDown className="h-5 w-5 text-red-600" />}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">نسبة الربح/الخسارة</p>
                    <p className={cn('text-lg font-bold', totalPnLPercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {totalPnLPercent >= 0 ? '+' : ''}{totalPnLPercent.toFixed(2)}%
                    </p>
                  </div>
                  <div className={cn('p-2 rounded-lg', totalPnLPercent >= 0 ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30')}>
                    <Target className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">عدد الصفقات</p>
                    <p className="text-lg font-bold">{tradeCount}</p>
                  </div>
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                    <Zap className="h-5 w-5 text-amber-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Chart + Quick Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  أداء المحفظة
                </CardTitle>
              </CardHeader>
              <CardContent>
                {chartData.length > 1 ? (
                  <ChartContainer
                    config={{
                      value: {
                        label: 'Portfolio Value',
                        color: 'hsl(25, 95%, 53%)',
                        theme: { light: 'hsl(25, 95%, 53%)', dark: 'hsl(25, 95%, 63%)' },
                      },
                    }}
                    className="h-[280px] w-full"
                  >
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                      <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" domain={['auto', 'auto']} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="var(--color-value)"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ChartContainer>
                ) : (
                  <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                    <p>سيتم عرض الرسم البياني بعد أول تحديث للأسعار</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  إجراءات سريعة
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">الرصيد المتاح</p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(simState.balance)}</p>
                  <Progress value={((INITIAL_BALANCE - simState.balance) / INITIAL_BALANCE) * 100} className="h-2" />
                  <p className="text-xs text-muted-foreground">مستثمر: {formatCurrency(investedAmount)} من {formatCurrency(INITIAL_BALANCE)}</p>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Button
                    className="w-full gap-2 bg-orange-600 hover:bg-orange-700"
                    onClick={() => setActiveTab('trading')}
                  >
                    <ShoppingCart className="h-4 w-4" />
                    شراء عملات
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => setActiveTab('portfolio')}
                  >
                    <Wallet className="h-4 w-4" />
                    عرض المحفظة
                  </Button>
                </div>
                <Separator />
                <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">إحصائيات سريعة</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">القيمة الإجمالية</span>
                    <span className="font-medium">{formatCurrency(totalValue)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">المراكز المفتوحة</span>
                    <span className="font-medium">{simState.positions.length}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">العمولة</span>
                    <span className="font-medium">0.1%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Market Overview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                نظرة على السوق
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 max-h-[400px] overflow-y-auto">
                {cryptos.slice(0, 12).map((coin) => (
                  <div
                    key={coin.id}
                    className={cn(
                      'rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md',
                      flashingCoins[coin.id] === 'up' && 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200',
                      flashingCoins[coin.id] === 'down' && 'bg-red-50 dark:bg-red-950/30 border-red-200'
                    )}
                    onClick={() => openTradeDialog(coin, 'buy')}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {coin.image ? (
                          <img src={coin.image} alt={coin.name} className="w-5 h-5 rounded-full" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-muted" />
                        )}
                        <span className="font-bold text-sm">{coin.symbol}</span>
                      </div>
                      <span className={cn('text-xs font-medium', coin.price_change_percentage_24h >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                        {coin.price_change_percentage_24h >= 0 ? '+' : ''}{coin.price_change_percentage_24h?.toFixed(2)}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{coin.name}</p>
                    <p className="text-sm font-bold mt-1">{formatCurrency(coin.current_price)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* Tab 2: Trading                                            */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="trading" className="space-y-6">
          {/* Search */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="ابحث عن عملة بالاسم أو الرمز..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10 text-right"
            />
          </div>

          {/* Crypto List */}
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">#</TableHead>
                      <TableHead className="text-right">العملة</TableHead>
                      <TableHead className="text-right">السعر</TableHead>
                      <TableHead className="text-right">التغير 24h</TableHead>
                      <TableHead className="text-right">القيمة السوقية</TableHead>
                      <TableHead className="text-center">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCryptos.map((coin) => (
                      <TableRow
                        key={coin.id}
                        className={cn(
                          'transition-colors',
                          flashingCoins[coin.id] === 'up' && 'bg-emerald-50/50 dark:bg-emerald-950/20',
                          flashingCoins[coin.id] === 'down' && 'bg-red-50/50 dark:bg-red-950/20'
                        )}
                      >
                        <TableCell className="text-muted-foreground">{coin.market_cap_rank}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {coin.image ? (
                              <img src={coin.image} alt={coin.name} className="w-8 h-8 rounded-full" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-muted" />
                            )}
                            <div>
                              <p className="font-medium">{coin.name}</p>
                              <Badge variant="outline" className="font-mono text-xs">{coin.symbol}</Badge>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono font-bold">{formatCurrency(coin.current_price)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={coin.price_change_percentage_24h >= 0 ? 'default' : 'destructive'}
                            className={cn(coin.price_change_percentage_24h >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : '')}
                          >
                            <span className="flex items-center gap-1">
                              {coin.price_change_percentage_24h >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                              {coin.price_change_percentage_24h >= 0 ? '+' : ''}{coin.price_change_percentage_24h?.toFixed(2)}%
                            </span>
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">{formatCurrency(coin.market_cap)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => openTradeDialog(coin, 'buy')}>
                              <Plus className="h-3 w-3" />
                              شراء
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openTradeDialog(coin, 'sell')}>
                              <Minus className="h-3 w-3" />
                              بيع
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className={cn("h-7 w-7 p-0", simState.watchlist.includes(coin.id) && "text-amber-500")}
                              onClick={() => toggleWatchlist(coin.id)}
                            >
                              <Star className={cn("h-4 w-4", simState.watchlist.includes(coin.id) && "fill-amber-500")} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredCryptos.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          لا توجد نتائج مطابقة للبحث
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* Tab 3: Portfolio                                           */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="portfolio" className="space-y-6">
          {/* Portfolio Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">الرصيد النقدي</p>
                <p className="text-lg font-bold">{formatCurrency(simState.balance)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">إجمالي الاستثمار</p>
                <p className="text-lg font-bold">{formatCurrency(investedAmount)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">القيمة الحالية</p>
                <p className="text-lg font-bold">{formatCurrency(portfolioValue)}</p>
              </CardContent>
            </Card>
            <Card className={cn(portfolioValue - investedAmount >= 0 ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800')}>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">الربح/الخسارة غير المحقق</p>
                <p className={cn('text-lg font-bold', portfolioValue - investedAmount >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                  {portfolioValue - investedAmount >= 0 ? '+' : ''}{formatCurrency(portfolioValue - investedAmount)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Holdings */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet className="h-4 w-4" />
                  الأصول المحتفظ بها
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {simState.positions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-3">
                    <Trophy className="h-12 w-12 text-muted-foreground/30" />
                    <p>لا توجد أصول محتفظ بها حالياً</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveTab('trading')}
                      className="gap-1.5"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      ابدأ التداول
                    </Button>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">العملة</TableHead>
                          <TableHead className="text-right">الكمية</TableHead>
                          <TableHead className="text-right">متوسط التكلفة</TableHead>
                          <TableHead className="text-right">السعر الحالي</TableHead>
                          <TableHead className="text-right">القيمة الحالية</TableHead>
                          <TableHead className="text-right">الربح/الخسارة</TableHead>
                          <TableHead className="text-center">إجراء</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {simState.positions.map((pos) => {
                          const coin = cryptos.find((c) => c.id === pos.coinId);
                          if (!coin) return null;
                          const currentValue = pos.amount * coin.current_price;
                          const costValue = pos.amount * pos.avgCost;
                          const pnl = currentValue - costValue;
                          const pnlPercent = costValue > 0 ? (pnl / costValue) * 100 : 0;
                          return (
                            <TableRow key={pos.coinId}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {coin.image ? (
                                    <img src={coin.image} alt={coin.name} className="w-8 h-8 rounded-full" />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-muted" />
                                  )}
                                  <div>
                                    <p className="font-medium">{coin.name}</p>
                                    <Badge variant="outline" className="font-mono text-xs">{pos.symbol}</Badge>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{formatCryptoAmount(pos.amount, pos.symbol)}</TableCell>
                              <TableCell className="font-mono">{formatCurrency(pos.avgCost)}</TableCell>
                              <TableCell className="font-mono">{formatCurrency(coin.current_price)}</TableCell>
                              <TableCell className="font-mono font-bold">{formatCurrency(currentValue)}</TableCell>
                              <TableCell>
                                <div className={cn('font-mono font-medium', pnl >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                                  <p>{pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}</p>
                                  <p className="text-xs">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</p>
                                </div>
                              </TableCell>
                              <TableCell className="text-center">
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50" onClick={() => openTradeDialog(coin, 'sell')}>
                                  <Minus className="h-3 w-3" />
                                  بيع
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Allocation Pie Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <PieChart className="h-4 w-4" />
                  توزيع المحفظة
                </CardTitle>
              </CardHeader>
              <CardContent>
                {allocationData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2">
                    <PieChart className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm">لا توجد بيانات للعرض</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Pie Chart */}
                    <div className="h-[180px] w-full">
                      <RechartsPieChart>
                        <Pie
                          data={allocationData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={75}
                          paddingAngle={2}
                        >
                          {allocationData.map((entry, index) => (
                            <Cell key={index} fill={CRYPTO_COLORS[entry.id] || `hsl(${index * 45}, 70%, 50%)`} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                          contentStyle={{
                            borderRadius: '8px',
                            border: '1px solid hsl(var(--border))',
                            background: 'hsl(var(--background))',
                            fontSize: '12px',
                          }}
                        />
                      </RechartsPieChart>
                    </div>

                    {/* Legend */}
                    <div className="space-y-2 max-h-[150px] overflow-y-auto">
                      {allocationData.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: CRYPTO_COLORS[item.id] || '#888' }} />
                            <span className="text-xs truncate">{item.name} ({item.symbol})</span>
                          </div>
                          <span className="text-xs font-mono font-medium whitespace-nowrap">{item.percent.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* Tab 4: Transaction History                                */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="transactions" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <History className="h-5 w-5" />
              سجل المعاملات
            </h3>
            <Select value={transactionFilter} onValueChange={(v) => setTransactionFilter(v as 'all' | 'buy' | 'sell')}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="buy">الشراء فقط</SelectItem>
                <SelectItem value="sell">البيع فقط</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              {filteredTransactions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-3">
                  <History className="h-12 w-12 text-muted-foreground/30" />
                  <p>لا توجد معاملات بعد</p>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab('trading')} className="gap-1.5">
                    <ShoppingCart className="h-4 w-4" />
                    ابدأ التداول
                  </Button>
                </div>
              ) : (
                <div className="max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">التاريخ</TableHead>
                        <TableHead className="text-right">النوع</TableHead>
                        <TableHead className="text-right">العملة</TableHead>
                        <TableHead className="text-right">الكمية</TableHead>
                        <TableHead className="text-right">السعر</TableHead>
                        <TableHead className="text-right">العمولة</TableHead>
                        <TableHead className="text-right">الإجمالي</TableHead>
                        <TableHead className="text-right">الربح/الخسارة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...filteredTransactions].reverse().map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(tx.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </TableCell>
                          <TableCell>
                            <Badge variant={tx.type === 'buy' ? 'default' : 'destructive'} className={cn(tx.type === 'buy' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : '')}>
                              {tx.type === 'buy' ? (
                                <span className="flex items-center gap-1"><ArrowDownRight className="h-3 w-3" /> شراء</span>
                              ) : (
                                <span className="flex items-center gap-1"><ArrowUpRight className="h-3 w-3" /> بيع</span>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{tx.name}</p>
                              <Badge variant="outline" className="font-mono text-xs">{tx.symbol}</Badge>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{formatCryptoAmount(tx.amount, tx.symbol)}</TableCell>
                          <TableCell className="font-mono">{formatCurrency(tx.price)}</TableCell>
                          <TableCell className="font-mono text-muted-foreground text-xs">{formatCurrency(tx.commission)}</TableCell>
                          <TableCell className="font-mono font-bold">{formatCurrency(tx.total)}</TableCell>
                          <TableCell>
                            {tx.pnl !== undefined ? (
                              <span className={cn('font-mono font-medium text-sm', tx.pnl >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                                {tx.pnl >= 0 ? '+' : ''}{formatCurrency(tx.pnl)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* Tab 5: Watchlist                                           */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="watchlist" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Eye className="h-5 w-5" />
              قائمة المراقبة
              <Badge variant="outline">{simState.watchlist.length}</Badge>
            </h3>
          </div>

          {simState.watchlist.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-3">
                <Star className="h-12 w-12 text-muted-foreground/30" />
                <p>قائمة المراقبة فارغة</p>
                <p className="text-sm">أضف العملات التي تريد مراقبتها من صفحة التداول</p>
                <Button variant="outline" size="sm" onClick={() => setActiveTab('trading')} className="gap-1.5">
                  <Search className="h-4 w-4" />
                  استعراض العملات
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {simState.watchlist.map((coinId) => {
                const coin = cryptos.find((c) => c.id === coinId);
                if (!coin) return null;
                return (
                  <Card
                    key={coinId}
                    className={cn(
                      'transition-all hover:shadow-md cursor-pointer',
                      flashingCoins[coinId] === 'up' && 'border-emerald-300 bg-emerald-50/30',
                      flashingCoins[coinId] === 'down' && 'border-red-300 bg-red-50/30'
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {coin.image ? (
                            <img src={coin.image} alt={coin.name} className="w-10 h-10 rounded-full" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-muted" />
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono">{coin.symbol}</Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-amber-500 hover:text-amber-600 hover:bg-amber-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleWatchlist(coinId);
                                }}
                              >
                                <Star className="h-4 w-4 fill-amber-500" />
                              </Button>
                            </div>
                            <p className="font-medium mt-1">{coin.name}</p>
                            <p className="text-xs text-muted-foreground">Rank #{coin.market_cap_rank}</p>
                          </div>
                        </div>
                        <div className="text-left">
                          <p className="text-lg font-bold font-mono">{formatCurrency(coin.current_price)}</p>
                          <div className={cn('flex items-center gap-0.5 justify-end text-sm font-medium', coin.price_change_percentage_24h >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                            {coin.price_change_percentage_24h >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                            {coin.price_change_percentage_24h >= 0 ? '+' : ''}{coin.price_change_percentage_24h?.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => openTradeDialog(coin, 'buy')}
                        >
                          <Plus className="h-3 w-3" />
                          شراء
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-8 text-xs gap-1"
                          onClick={() => openTradeDialog(coin, 'sell')}
                        >
                          <Minus className="h-3 w-3" />
                          بيع
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Add from search */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Plus className="h-4 w-4" />
                إضافة عملات لقائمة المراقبة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="ابحث عن عملة..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto">
                {filteredCryptos
                  .filter((c) => !simState.watchlist.includes(c.id))
                  .slice(0, 8)
                  .map((coin) => (
                    <div
                      key={coin.id}
                      className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {coin.image ? (
                          <img src={coin.image} alt={coin.name} className="w-6 h-6 rounded-full" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-muted" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{coin.name}</p>
                          <p className="text-xs text-muted-foreground">{coin.symbol}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-amber-500"
                        onClick={() => toggleWatchlist(coin.id)}
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Trade Dialog ──────────────────────────────────────────── */}
      <Dialog open={tradeDialogOpen} onOpenChange={setTradeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {tradeType === 'buy' ? (
                <span className="flex items-center gap-2 text-emerald-600">
                  <ArrowDownRight className="h-5 w-5" />
                  شراء عملة
                </span>
              ) : (
                <span className="flex items-center gap-2 text-red-600">
                  <ArrowUpRight className="h-5 w-5" />
                  بيع عملة
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedCrypto && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">العملة</span>
                  <div className="flex items-center gap-2">
                    {selectedCrypto.image && (
                      <img src={selectedCrypto.image} alt={selectedCrypto.name} className="w-5 h-5 rounded-full" />
                    )}
                    <span className="font-medium">{selectedCrypto.name} ({selectedCrypto.symbol})</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">السعر الحالي</span>
                  <span className="font-mono font-bold">{formatCurrency(selectedCrypto.current_price)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">رصيدك</span>
                  <span className="font-mono">{formatCurrency(simState.balance)}</span>
                </div>
                {tradeType === 'sell' && (() => {
                  const pos = simState.positions.find((p) => p.coinId === selectedCrypto.id);
                  return pos ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">كميتك</span>
                      <span className="font-mono">{formatCryptoAmount(pos.amount, pos.symbol)}</span>
                    </div>
                  ) : null;
                })()}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">الكمية ({selectedCrypto.symbol})</label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0"
                    onClick={() => setTradeAmount((a) => Math.max(0, a - (selectedCrypto.current_price < 1 ? 100 : 0.1)))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min={0}
                    step={selectedCrypto.current_price < 1 ? 100 : 0.1}
                    value={tradeAmount || ''}
                    onChange={(e) => setTradeAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="text-center font-mono"
                    placeholder="0"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0"
                    onClick={() => setTradeAmount((a) => a + (selectedCrypto.current_price < 1 ? 100 : 0.1))}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  {tradeType === 'buy' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 text-xs whitespace-nowrap"
                      onClick={() => {
                        const maxAmount = simState.balance / (selectedCrypto.current_price * (1 + COMMISSION_RATE));
                        setTradeAmount(maxAmount);
                      }}
                    >
                      الأقصى
                    </Button>
                  )}
                  {tradeType === 'sell' && (() => {
                    const pos = simState.positions.find((p) => p.coinId === selectedCrypto.id);
                    return pos ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 text-xs"
                        onClick={() => setTradeAmount(pos.amount)}
                      >
                        الكل
                      </Button>
                    ) : null;
                  })()}
                </div>
              </div>

              {tradeAmount > 0 && (
                <div className="rounded-lg border p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">سعر الوحدة</span>
                    <span className="font-mono">{formatCurrency(selectedCrypto.current_price)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">الكمية</span>
                    <span className="font-mono">{formatCryptoAmount(tradeAmount, selectedCrypto.symbol)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">المجموع الفرعي</span>
                    <span className="font-mono">{formatCurrency(tradeAmount * selectedCrypto.current_price)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">العمولة ({(COMMISSION_RATE * 100).toFixed(1)}%)</span>
                    <span className="font-mono text-amber-600">{formatCurrency(tradeAmount * selectedCrypto.current_price * COMMISSION_RATE)}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between font-bold">
                    <span>{tradeType === 'buy' ? 'الإجمالي' : 'صافي الإيرادات'}</span>
                    <span className="font-mono">
                      {tradeType === 'buy'
                        ? formatCurrency(tradeAmount * selectedCrypto.current_price * (1 + COMMISSION_RATE))
                        : formatCurrency(tradeAmount * selectedCrypto.current_price * (1 - COMMISSION_RATE))}
                    </span>
                  </div>
                </div>
              )}

              {tradeType === 'buy' && tradeAmount > 0 && tradeAmount * selectedCrypto.current_price * (1 + COMMISSION_RATE) > simState.balance && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>رصيدك غير كافي لإتمام هذه الصفقة</span>
                </div>
              )}

              {tradeType === 'sell' && (() => {
                const pos = simState.positions.find((p) => p.coinId === selectedCrypto.id);
                if (!pos) return (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>ليس لديك هذه العملة لبيعها</span>
                  </div>
                );
                if (tradeAmount > pos.amount) return (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>الكمية المطلوبة أكبر مما تملك ({formatCryptoAmount(pos.amount, pos.symbol)})</span>
                  </div>
                );
                return null;
              })()}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setTradeDialogOpen(false)}>
              إلغاء
            </Button>
            <Button
              className={cn(
                'gap-1.5',
                tradeType === 'buy' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
              )}
              onClick={handleTradeSubmit}
              disabled={tradeAmount <= 0}
            >
              {tradeType === 'buy' ? (
                <span className="flex items-center gap-1.5"><ArrowDownRight className="h-4 w-4" /> تأكيد الشراء</span>
              ) : (
                <span className="flex items-center gap-1.5"><ArrowUpRight className="h-4 w-4" /> تأكيد البيع</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Confirm Dialog ────────────────────────────────────────── */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              تأكيد {pendingTrade?.type === 'buy' ? 'الشراء' : 'البيع'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTrade && (
                <div className="space-y-2 mt-2 text-right" dir="rtl">
                  <p>
                    هل أنت متأكد من{' '}
                    <span className="font-bold text-foreground">
                      {pendingTrade.type === 'buy' ? 'شراء' : 'بيع'}
                    </span>{' '}
                    <span className="font-bold text-foreground">
                      {formatCryptoAmount(pendingTrade.amount, pendingTrade.crypto.symbol)}
                    </span>{' '}
                    من{' '}
                    <span className="font-bold text-foreground">
                      {pendingTrade.crypto.name}
                    </span>{' '}
                    بسعر{' '}
                    <span className="font-mono font-bold text-foreground">
                      {formatCurrency(pendingTrade.crypto.current_price)}
                    </span>
                    ؟
                  </p>
                  <Separator />
                  <div className="flex justify-between text-sm">
                    <span>الإجمالي (شامل العمولة)</span>
                    <span className="font-mono font-bold">{formatCurrency(pendingTrade.total)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>العمولة</span>
                    <span className="font-mono">{formatCurrency(pendingTrade.commission)}</span>
                  </div>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeTrade}
              className={cn(pendingTrade?.type === 'buy' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700')}
            >
              تأكيد التنفيذ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Reset Dialog ──────────────────────────────────────────── */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              إعادة تعيين المحاكاة
            </AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من إعادة تعيين المحاكاة؟ سيتم حذف جميع البيانات بما في ذلك:
              <ul className="mt-2 space-y-1 text-right mr-4 list-disc">
                <li>جميع المعاملات السابقة</li>
                <li>جميع الأصول المحتفظ بها</li>
                <li>سجل الأداء</li>
                <li>قائمة المراقبة</li>
              </ul>
              <p className="mt-2 font-bold text-foreground">لا يمكن التراجع عن هذا الإجراء.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={resetSimulation} className="bg-destructive hover:bg-destructive/90">
              <span className="flex items-center gap-1.5"><RotateCcw className="h-4 w-4" /> إعادة تعيين</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Hidden Report Section for PDF Export ─────────────────── */}
      <div ref={setReportRef} className="hidden" dir="rtl" style={{ fontFamily: 'Arial, sans-serif', padding: '20px', color: '#333' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px', borderBottom: '3px solid #F7931A', paddingBottom: '15px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#F7931A', margin: 0 }}>محاكاة تداول الكريبتو</h1>
          <p style={{ fontSize: '14px', color: '#666', margin: '5px 0 0' }}>تقرير الأداء - تم الإنشاء: {new Date().toLocaleDateString('en-US')}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
          <div style={{ background: '#f0fdf4', padding: '12px', borderRadius: '8px' }}>
            <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>القيمة الإجمالية</p>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0' }}>{formatCurrency(totalValue)}</p>
          </div>
          <div style={{ background: '#eff6ff', padding: '12px', borderRadius: '8px' }}>
            <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>الرصيد النقدي</p>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0' }}>{formatCurrency(simState.balance)}</p>
          </div>
          <div style={{ background: totalPnL >= 0 ? '#f0fdf4' : '#fef2f2', padding: '12px', borderRadius: '8px' }}>
            <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>إجمالي الربح/الخسارة</p>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0', color: totalPnL >= 0 ? '#059669' : '#dc2626' }}>
              {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL)}
            </p>
          </div>
          <div style={{ background: '#fffbeb', padding: '12px', borderRadius: '8px' }}>
            <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>عدد الصفقات</p>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0' }}>{tradeCount}</p>
          </div>
        </div>

        <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px', borderBottom: '1px solid #e5e7eb', paddingBottom: '5px' }}>الأصول المحتفظ بها</h2>
        {simState.positions.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>العملة</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>الكمية</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>متوسط التكلفة</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>السعر الحالي</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>الربح/الخسارة</th>
              </tr>
            </thead>
            <tbody>
              {simState.positions.map((pos) => {
                const coin = cryptos.find((c) => c.id === pos.coinId);
                if (!coin) return null;
                const pnl = (coin.current_price - pos.avgCost) * pos.amount;
                return (
                  <tr key={pos.coinId}>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{pos.name} ({pos.symbol})</td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{formatCryptoAmount(pos.amount, pos.symbol)}</td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{formatCurrency(pos.avgCost)}</td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{formatCurrency(coin.current_price)}</td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb', color: pnl >= 0 ? '#059669' : '#dc2626' }}>
                      {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p style={{ color: '#999', marginBottom: '20px' }}>لا توجد أصول محتفظ بها</p>
        )}
      </div>
    </div>
  );
}
