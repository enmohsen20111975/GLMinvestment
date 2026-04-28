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
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShareButton } from '@/components/share/ShareButton';
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Tooltip,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────

interface EGXStock {
  ticker: string;
  name_ar: string;
  sector: string;
  basePrice: number;
  price: number;
  change: number;
  changePercent: number;
}

interface Position {
  ticker: string;
  shares: number;
  avgCost: number;
}

interface Transaction {
  id: string;
  date: string;
  type: 'buy' | 'sell';
  ticker: string;
  shares: number;
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

interface SimState {
  balance: number;
  positions: Position[];
  transactions: Transaction[];
  watchlist: string[];
  history: PortfolioSnapshot[];
  startedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const INITIAL_BALANCE = 100_000;
const COMMISSION_RATE = 0.0015; // 0.15%
const STORAGE_KEY = 'simulation_egx_sim';
const TICK_INTERVAL = 5000; // 5 seconds

const SECTOR_COLORS: Record<string, string> = {
  'البناء والتشييد': '#f59e0b',
  'الإعلام والاتصالات': '#3b82f6',
  'العقارات': '#8b5cf6',
  'الخدمات المالية': '#10b981',
  'التأمين': '#ef4444',
  'الخدمات': '#06b6d4',
  'الأدوية': '#ec4899',
  'الصناعة': '#f97316',
  'الاستثمار': '#14b8a6',
  'البنوك': '#6366f1',
};

const EGX_STOCKS_RAW = [
  { ticker: 'ORAS', name_ar: 'أوراسكوم للإنشاء', sector: 'البناء والتشييد', basePrice: 18.5 },
  { ticker: 'COMI', name_ar: 'أوراسكوم للإعلام', sector: 'الإعلام والاتصالات', basePrice: 2.85 },
  { ticker: 'GBAR', name_ar: 'جولدن بيتش', sector: 'العقارات', basePrice: 6.2 },
  { ticker: 'EMFD', name_ar: 'المهندسون للمعدات', sector: 'الخدمات المالية', basePrice: 32.8 },
  { ticker: 'DCRC', name_ar: 'دار الأهرام للتأمين', sector: 'التأمين', basePrice: 5.15 },
  { ticker: 'SWDY', name_ar: 'السويدى إلكتريك', sector: 'الخدمات', basePrice: 30.4 },
  { ticker: 'CCRS', name_ar: 'كرير للصناعات', sector: 'الخدمات المالية', basePrice: 48.9 },
  { ticker: 'EPCI', name_ar: 'إيبيكو للصناعات الدوائية', sector: 'الأدوية', basePrice: 42.5 },
  { ticker: 'HRHO', name_ar: 'حرم للتعمير', sector: 'العقارات', basePrice: 8.75 },
  { ticker: 'MTIE', name_ar: 'المصرية للاتصالات', sector: 'الإعلام والاتصالات', basePrice: 15.6 },
  { ticker: 'ALUM', name_ar: 'المصرية للألمنيوم', sector: 'الصناعة', basePrice: 12.3 },
  { ticker: 'EAST', name_ar: 'إيست كوست للاستثمار', sector: 'الاستثمار', basePrice: 3.4 },
  { ticker: 'ELSW', name_ar: 'السويس للأسمنت', sector: 'البناء والتشييد', basePrice: 72.5 },
  { ticker: 'OIIC', name_ar: 'أورينت للاستثمار', sector: 'الاستثمار', basePrice: 4.15 },
  { ticker: 'AMCH', name_ar: 'المصرية للبناء', sector: 'البناء والتشييد', basePrice: 7.8 },
  { ticker: 'PHAR', name_ar: 'فاركو للأدوية', sector: 'الأدوية', basePrice: 56.2 },
  { ticker: 'ETEL', name_ar: 'المصرية للاتصالات - تليفون مصر', sector: 'الإعلام والاتصالات', basePrice: 15.6 },
  { ticker: 'ALHI', name_ar: 'المصرية للغزل والنسيج', sector: 'الصناعة', basePrice: 10.2 },
  { ticker: 'MISR', name_ar: 'بنك مصر', sector: 'البنوك', basePrice: 65.3 },
  { ticker: 'CIBK', name_ar: 'بنك القاهرة', sector: 'البنوك', basePrice: 85.4 },
  { ticker: 'TMGH', name_ar: 'المجموعة المالية هيرمس', sector: 'الخدمات المالية', basePrice: 19.8 },
  { ticker: 'FWRY', name_ar: 'فودافون مصر', sector: 'الإعلام والاتصالات', basePrice: 3.65 },
  { ticker: 'KIMA', name_ar: 'كيما للأسمدة', sector: 'الصناعة', basePrice: 22.7 },
  { ticker: 'MFPC', name_ar: 'شركة الماضي للتنمية والتعمير', sector: 'العقارات', basePrice: 4.55 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatNumber(n: number, decimals = 2): string {
  return n.toLocaleString('ar-EG', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCurrency(n: number): string {
  return `${formatNumber(n)} ج.م`;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isMarketOpen(): boolean {
  const now = new Date();
  // Use UTC+2 for Cairo time
  const cairoHour = now.getUTCHours() + 2;
  const day = now.getUTCDay();
  if (day === 5 || day === 6) return false; // Friday/Saturday off
  return cairoHour >= 9 && cairoHour < 15; // 9:30 AM - 2:30 PM approx
}

function getCairoTime(): string {
  const now = new Date();
  const cairoHour = (now.getUTCHours() + 2) % 24;
  const cairoMin = now.getUTCMinutes();
  return `${String(cairoHour).padStart(2, '0')}:${String(cairoMin).padStart(2, '0')}`;
}

function getDefaultState(): SimState {
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

function loadState(): SimState {
  if (typeof window === 'undefined') return getDefaultState();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as SimState;
      return parsed;
    }
  } catch {
    // ignore
  }
  return getDefaultState();
}

function saveState(state: SimState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ─── Component ────────────────────────────────────────────────────────────

export function SimulationView() {
  // State
  const [simState, setSimState] = useState<SimState>(getDefaultState());
  const [stocks, setStocks] = useState<EGXStock[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [transactionFilter, setTransactionFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [isSimulationRunning, setIsSimulationRunning] = useState(true);
  const [flashingTickers, setFlashingTickers] = useState<Record<string, 'up' | 'down'>>({});
  const [reportRef, setReportRef] = useState<HTMLDivElement | null>(null);

  // Trade dialog
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [selectedStock, setSelectedStock] = useState<EGXStock | null>(null);
  const [tradeQuantity, setTradeQuantity] = useState<number>(0);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingTrade, setPendingTrade] = useState<{
    type: 'buy' | 'sell';
    stock: EGXStock;
    quantity: number;
    total: number;
    commission: number;
  } | null>(null);

  // Reset dialog
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize stocks
  const initStocks = useCallback(() => {
    const initialStocks = EGX_STOCKS_RAW.map((s) => {
      const randomOffset = (Math.random() - 0.5) * 0.04; // ±2% initial
      const price = Number((s.basePrice * (1 + randomOffset)).toFixed(2));
      return {
        ...s,
        price,
        change: Number((price - s.basePrice).toFixed(2)),
        changePercent: Number((((price - s.basePrice) / s.basePrice) * 100).toFixed(2)),
      };
    });
    setStocks(initialStocks);
  }, []);

  // Load persisted state on mount
  useEffect(() => {
    const loaded = loadState();
    setSimState(loaded);
    initStocks();
  }, [initStocks]);

  // Save state on change
  useEffect(() => {
    if (stocks.length > 0) {
      saveState(simState);
    }
  }, [simState, stocks.length]);

  // Price simulation tick
  const tickPrices = useCallback(() => {
    setStocks((prev) => {
      const newFlashing: Record<string, 'up' | 'down'> = {};
      const updated = prev.map((s) => {
        const changePercent = (Math.random() - 0.5) * 4; // ±2%
        const newPrice = Number(Math.max(0.01, s.price * (1 + changePercent / 100)).toFixed(2));
        const change = Number((newPrice - s.basePrice).toFixed(2));
        const changePct = Number((((newPrice - s.basePrice) / s.basePrice) * 100).toFixed(2));
        newFlashing[s.ticker] = changePercent >= 0 ? 'up' : 'down';
        return { ...s, price: newPrice, change, changePercent: changePct };
      });
      setFlashingTickers(newFlashing);
      setTimeout(() => setFlashingTickers({}), 800);
      return updated;
    });

    // Record portfolio snapshot
    setSimState((prev) => {
      const portfolioValue = calcPortfolioValue(prev.positions, stocks);
      const totalValue = prev.balance + portfolioValue;
      const lastSnapshot = prev.history[prev.history.length - 1];
      const now = Date.now();

      if (lastSnapshot && now - lastSnapshot.timestamp < 30000) {
        // Update last snapshot if less than 30s ago
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

  // Start/stop simulation
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

  // ─── Calculations ───────────────────────────────────────────────────

  const calcPortfolioValue = useCallback(
    (positions: Position[], currentStocks: EGXStock[]): number => {
      return positions.reduce((sum, pos) => {
        const stock = currentStocks.find((s) => s.ticker === pos.ticker);
        if (!stock) return sum;
        return sum + pos.shares * stock.price;
      }, 0);
    },
    []
  );

  const portfolioValue = useMemo(
    () => calcPortfolioValue(simState.positions, stocks),
    [simState.positions, stocks, calcPortfolioValue]
  );

  const totalValue = simState.balance + portfolioValue;
  const totalPnL = totalValue - INITIAL_BALANCE;
  const totalPnLPercent = INITIAL_BALANCE > 0 ? (totalPnL / INITIAL_BALANCE) * 100 : 0;
  const investedAmount = simState.positions.reduce((sum, pos) => sum + pos.shares * pos.avgCost, 0);
  const tradeCount = simState.transactions.length;

  const marketOpen = isMarketOpen();

  // ─── Actions ───────────────────────────────────────────────────────

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
      const avgCost = position.avgCost;
      const pnl = (pricePerShare - avgCost) * tradeQuantity - commission;
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

      let newPositions = [...prev.positions];
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

      // Remove positions with 0 shares
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
        : `تم بيع ${quantity} سهم من ${stock.name_ar} بنجاح`
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
    setResetDialogOpen(false);
    toast.success('تم إعادة تعيين المحاكاة بنجاح');
  }, [initStocks]);

  const toggleWatchlist = useCallback(
    (ticker: string) => {
      setSimState((prev) => {
        if (prev.watchlist.includes(ticker)) {
          return { ...prev, watchlist: prev.watchlist.filter((t) => t !== ticker) };
        }
        return { ...prev, watchlist: [...prev.watchlist, ticker] };
      });
    },
    []
  );

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

  // ─── Filtered data ─────────────────────────────────────────────────

  const filteredStocks = useMemo(() => {
    if (!searchQuery.trim()) return stocks;
    const q = searchQuery.toLowerCase();
    return stocks.filter(
      (s) =>
        s.ticker.toLowerCase().includes(q) ||
        s.name_ar.includes(q) ||
        s.sector.includes(q)
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
      value: Number(h.portfolioValue.toFixed(2)),
    }));
  }, [simState.history]);

  // ─── Render ────────────────────────────────────────────────────────

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
          <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl shadow-lg">
            <Gamepad2 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">محاكاة التداول - بورصة مصر EGX</h1>
            <p className="text-sm text-muted-foreground">تدرب على التداول بأموال افتراضية بدون أي مخاطر</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={marketOpen ? 'default' : 'secondary'}
            className={cn('gap-1.5 px-3 py-1', marketOpen ? 'bg-emerald-600 hover:bg-emerald-600' : 'bg-red-600 hover:bg-red-600')}
          >
            <span className={cn('h-2 w-2 rounded-full', marketOpen ? 'bg-white animate-pulse' : 'bg-red-200')} />
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
              ticker: 'SIM-EGX',
              name: 'Trading Simulation',
              nameAr: 'محاكاة التداول - بورصة مصر',
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
            قائمة الرغبات
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* Tab 1: Dashboard                                          */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">الرصيد النقدي</p>
                    <p className="text-xl font-bold">{formatCurrency(simState.balance)}</p>
                  </div>
                  <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                    <Wallet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">قيمة المحفظة</p>
                    <p className="text-xl font-bold">{formatCurrency(portfolioValue)}</p>
                  </div>
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <DollarSign className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={cn('relative overflow-hidden', totalPnL >= 0 ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800')}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">إجمالي الربح/الخسارة</p>
                    <p className={cn('text-xl font-bold', totalPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
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
                    <p className="text-sm text-muted-foreground">نسبة الربح/الخسارة</p>
                    <p className={cn('text-xl font-bold', totalPnLPercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
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
                    <p className="text-sm text-muted-foreground">عدد الصفقات</p>
                    <p className="text-xl font-bold">{tradeCount}</p>
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
                        label: 'قيمة المحفظة',
                        color: 'hsl(160, 84%, 39%)',
                        theme: { light: 'hsl(160, 84%, 39%)', dark: 'hsl(160, 84%, 52%)' },
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
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => setActiveTab('trading')}
                  >
                    <ShoppingCart className="h-4 w-4" />
                    شراء أسهم
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
                    <span className="text-muted-foreground">المركز المفتوحة</span>
                    <span className="font-medium">{simState.positions.length}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">العمولة</span>
                    <span className="font-medium">0.15%</span>
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
                {stocks.slice(0, 12).map((stock) => (
                  <div
                    key={stock.ticker}
                    className={cn(
                      'rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md',
                      flashingTickers[stock.ticker] === 'up' && 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200',
                      flashingTickers[stock.ticker] === 'down' && 'bg-red-50 dark:bg-red-950/30 border-red-200'
                    )}
                    onClick={() => openTradeDialog(stock, 'buy')}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm">{stock.ticker}</span>
                      <span className={cn('text-xs font-medium', stock.change >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                        {stock.change >= 0 ? '+' : ''}{stock.changePercent}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{stock.name_ar}</p>
                    <p className="text-sm font-bold mt-1">{formatNumber(stock.price)} ج.م</p>
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
              placeholder="ابحث عن سهم بالرمز أو الاسم أو القطاع..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10 text-right"
            />
          </div>

          {/* Stock List */}
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">السهم</TableHead>
                      <TableHead className="text-right">الرمز</TableHead>
                      <TableHead className="text-right">القطاع</TableHead>
                      <TableHead className="text-right">السعر</TableHead>
                      <TableHead className="text-right">التغير</TableHead>
                      <TableHead className="text-right">النسبة</TableHead>
                      <TableHead className="text-center">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStocks.map((stock) => (
                      <TableRow
                        key={stock.ticker}
                        className={cn(
                          'transition-colors',
                          flashingTickers[stock.ticker] === 'up' && 'bg-emerald-50/50 dark:bg-emerald-950/20',
                          flashingTickers[stock.ticker] === 'down' && 'bg-red-50/50 dark:bg-red-950/20'
                        )}
                      >
                        <TableCell className="font-medium">{stock.name_ar}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">{stock.ticker}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{stock.sector}</TableCell>
                        <TableCell className="font-mono font-bold">{formatNumber(stock.price)}</TableCell>
                        <TableCell className={cn('font-mono', stock.change >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                          <span className="flex items-center gap-1">
                            {stock.change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {stock.change >= 0 ? '+' : ''}{formatNumber(stock.change)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={stock.changePercent >= 0 ? 'default' : 'destructive'}
                            className={cn(stock.changePercent >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : '')}
                          >
                            {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => openTradeDialog(stock, 'buy')}>
                              <Plus className="h-3 w-3" />
                              شراء
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openTradeDialog(stock, 'sell')}>
                              <Minus className="h-3 w-3" />
                              بيع
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredStocks.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
            <Card className={cn(totalPnL >= 0 ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800')}>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">الربح/الخسارة غير المحقق</p>
                <p className={cn('text-lg font-bold', totalPnL >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                  {totalPnL >= 0 ? '+' : ''}{formatCurrency(portfolioValue - investedAmount)}
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
                          <TableHead className="text-right">السهم</TableHead>
                          <TableHead className="text-right">العدد</TableHead>
                          <TableHead className="text-right">متوسط التكلفة</TableHead>
                          <TableHead className="text-right">السعر الحالي</TableHead>
                          <TableHead className="text-right">القيمة الحالية</TableHead>
                          <TableHead className="text-right">الربح/الخسارة</TableHead>
                          <TableHead className="text-center">إجراء</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {simState.positions.map((pos) => {
                          const stock = stocks.find((s) => s.ticker === pos.ticker);
                          if (!stock) return null;
                          const currentValue = pos.shares * stock.price;
                          const costValue = pos.shares * pos.avgCost;
                          const pnl = currentValue - costValue;
                          const pnlPercent = costValue > 0 ? (pnl / costValue) * 100 : 0;
                          return (
                            <TableRow key={pos.ticker}>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{stock.name_ar}</p>
                                  <Badge variant="outline" className="font-mono text-xs">{pos.ticker}</Badge>
                                </div>
                              </TableCell>
                              <TableCell className="font-mono">{pos.shares}</TableCell>
                              <TableCell className="font-mono">{formatNumber(pos.avgCost)}</TableCell>
                              <TableCell className="font-mono">{formatNumber(stock.price)}</TableCell>
                              <TableCell className="font-mono font-bold">{formatCurrency(currentValue)}</TableCell>
                              <TableCell>
                                <div className={cn('font-mono font-medium', pnl >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                                  <p>{pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}</p>
                                  <p className="text-xs">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</p>
                                </div>
                              </TableCell>
                              <TableCell className="text-center">
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50" onClick={() => openTradeDialog(stock, 'sell')}>
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

            {/* Sector Allocation */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <PieChart className="h-4 w-4" />
                  توزيع القطاعات
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sectorAllocation.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2">
                    <PieChart className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm">لا توجد بيانات للعرض</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Pie Chart */}
                    <div className="h-[180px] w-full">
                      <ChartContainer
                        config={Object.fromEntries(sectorAllocation.map((s) => [s.sector, { label: s.sector, color: SECTOR_COLORS[s.sector] || '#888' }]))}
                        className="h-full w-full"
                      >
                        <RechartsPieChart>
                          <Pie
                            data={sectorAllocation}
                            dataKey="value"
                            nameKey="sector"
                            cx="50%"
                            cy="50%"
                            innerRadius={45}
                            outerRadius={75}
                            paddingAngle={2}
                          >
                            {sectorAllocation.map((entry, index) => (
                              <Cell key={index} fill={SECTOR_COLORS[entry.sector] || '#888'} />
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
                      </ChartContainer>
                    </div>

                    {/* Legend */}
                    <div className="space-y-2">
                      {sectorAllocation.map((item) => (
                        <div key={item.sector} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: SECTOR_COLORS[item.sector] || '#888' }} />
                            <span className="text-xs truncate">{item.sector}</span>
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
                        <TableHead className="text-right">السهم</TableHead>
                        <TableHead className="text-right">العدد</TableHead>
                        <TableHead className="text-right">السعر</TableHead>
                        <TableHead className="text-right">العمولة</TableHead>
                        <TableHead className="text-right">الإجمالي</TableHead>
                        <TableHead className="text-right">الربح/الخسارة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...filteredTransactions].reverse().map((tx) => {
                        const stock = stocks.find((s) => s.ticker === tx.ticker);
                        return (
                          <TableRow key={tx.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(tx.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
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
                                <p className="font-medium text-sm">{stock?.name_ar || tx.ticker}</p>
                                <Badge variant="outline" className="font-mono text-xs">{tx.ticker}</Badge>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono">{tx.shares}</TableCell>
                            <TableCell className="font-mono">{formatNumber(tx.price)}</TableCell>
                            <TableCell className="font-mono text-muted-foreground text-xs">{formatNumber(tx.commission)}</TableCell>
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
                        );
                      })}
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
              قائمة الرغبات
              <Badge variant="outline">{simState.watchlist.length}</Badge>
            </h3>
          </div>

          {simState.watchlist.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-3">
                <Star className="h-12 w-12 text-muted-foreground/30" />
                <p>قائمة الرغبات فارغة</p>
                <p className="text-sm">أضف الأسهم التي تريد مراقبتها من صفحة التداول</p>
                <Button variant="outline" size="sm" onClick={() => setActiveTab('trading')} className="gap-1.5">
                  <Search className="h-4 w-4" />
                  استعراض الأسهم
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {simState.watchlist.map((ticker) => {
                const stock = stocks.find((s) => s.ticker === ticker);
                if (!stock) return null;
                return (
                  <Card
                    key={ticker}
                    className={cn(
                      'transition-all hover:shadow-md cursor-pointer',
                      flashingTickers[ticker] === 'up' && 'border-emerald-300 bg-emerald-50/30',
                      flashingTickers[ticker] === 'down' && 'border-red-300 bg-red-50/30'
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono">{stock.ticker}</Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-amber-500 hover:text-amber-600 hover:bg-amber-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleWatchlist(ticker);
                              }}
                            >
                              <Star className="h-4 w-4 fill-amber-500" />
                            </Button>
                          </div>
                          <p className="font-medium mt-1">{stock.name_ar}</p>
                          <p className="text-xs text-muted-foreground">{stock.sector}</p>
                        </div>
                        <div className="text-left">
                          <p className="text-lg font-bold font-mono">{formatNumber(stock.price)}</p>
                          <div className={cn('flex items-center gap-0.5 justify-end text-sm font-medium', stock.change >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                            {stock.change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                            {stock.change >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => openTradeDialog(stock, 'buy')}
                        >
                          <Plus className="h-3 w-3" />
                          شراء
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-8 text-xs gap-1"
                          onClick={() => openTradeDialog(stock, 'sell')}
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
                إضافة أسهم لقائمة الرغبات
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="ابحث عن سهم..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto">
                {filteredStocks
                  .filter((s) => !simState.watchlist.includes(s.ticker))
                  .slice(0, 8)
                  .map((stock) => (
                    <div
                      key={stock.ticker}
                      className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{stock.name_ar}</p>
                        <p className="text-xs text-muted-foreground">{stock.ticker}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-amber-500"
                        onClick={() => toggleWatchlist(stock.ticker)}
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
                  شراء سهم
                </span>
              ) : (
                <span className="flex items-center gap-2 text-red-600">
                  <ArrowUpRight className="h-5 w-5" />
                  بيع سهم
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedStock && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">السهم</span>
                  <span className="font-medium">{selectedStock.name_ar} ({selectedStock.ticker})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">السعر الحالي</span>
                  <span className="font-mono font-bold">{formatNumber(selectedStock.price)} ج.م</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">رصيدك</span>
                  <span className="font-mono">{formatCurrency(simState.balance)}</span>
                </div>
                {tradeType === 'sell' && (() => {
                  const pos = simState.positions.find((p) => p.ticker === selectedStock.ticker);
                  return pos ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">أسهمك</span>
                      <span className="font-mono">{pos.shares} سهم</span>
                    </div>
                  ) : null;
                })()}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">عدد الأسهم</label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0"
                    onClick={() => setTradeQuantity((q) => Math.max(0, q - 1))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    value={tradeQuantity || ''}
                    onChange={(e) => setTradeQuantity(Math.max(0, parseInt(e.target.value) || 0))}
                    className="text-center font-mono"
                    placeholder="0"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0"
                    onClick={() => setTradeQuantity((q) => q + 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  {tradeType === 'buy' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 text-xs"
                      onClick={() => {
                        const maxShares = Math.floor(simState.balance / (selectedStock.price * (1 + COMMISSION_RATE)));
                        setTradeQuantity(maxShares);
                      }}
                    >
                      الأقصى
                    </Button>
                  )}
                  {tradeType === 'sell' && (() => {
                    const pos = simState.positions.find((p) => p.ticker === selectedStock.ticker);
                    return pos ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 text-xs"
                        onClick={() => setTradeQuantity(pos.shares)}
                      >
                        الكل
                      </Button>
                    ) : null;
                  })()}
                </div>
              </div>

              {tradeQuantity > 0 && (
                <div className="rounded-lg border p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">سعر السهم</span>
                    <span className="font-mono">{formatNumber(selectedStock.price)} ج.م</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">عدد الأسهم</span>
                    <span className="font-mono">{tradeQuantity}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">المجموع الفرعي</span>
                    <span className="font-mono">{formatCurrency(tradeQuantity * selectedStock.price)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">العمولة ({(COMMISSION_RATE * 100).toFixed(2)}%)</span>
                    <span className="font-mono text-amber-600">{formatNumber(tradeQuantity * selectedStock.price * COMMISSION_RATE)} ج.م</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between font-bold">
                    <span>{tradeType === 'buy' ? 'الإجمالي' : 'صافي الإيرادات'}</span>
                    <span className="font-mono">
                      {tradeType === 'buy'
                        ? formatCurrency(tradeQuantity * selectedStock.price * (1 + COMMISSION_RATE))
                        : formatCurrency(tradeQuantity * selectedStock.price * (1 - COMMISSION_RATE))}
                    </span>
                  </div>
                </div>
              )}

              {tradeType === 'buy' && tradeQuantity > 0 && tradeQuantity * selectedStock.price * (1 + COMMISSION_RATE) > simState.balance && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>رصيدك غير كافي لإتمام هذه الصفقة</span>
                </div>
              )}

              {tradeType === 'sell' && (() => {
                const pos = simState.positions.find((p) => p.ticker === selectedStock.ticker);
                if (!pos) return (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>ليس لديك أسهم من هذا السهم لبيعها</span>
                  </div>
                );
                if (tradeQuantity > pos.shares) return (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>عدد الأسهم المطلوبة أكبر مما تملك ({pos.shares})</span>
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
              disabled={tradeQuantity <= 0}
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
                      {pendingTrade.quantity} سهم
                    </span>{' '}
                    من{' '}
                    <span className="font-bold text-foreground">
                      {pendingTrade.stock.name_ar} ({pendingTrade.stock.ticker})
                    </span>{' '}
                    بسعر{' '}
                    <span className="font-mono font-bold text-foreground">
                      {formatNumber(pendingTrade.stock.price)} ج.م
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
                    <span className="font-mono">{formatNumber(pendingTrade.commission)} ج.م</span>
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
                <li>قائمة الرغبات</li>
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
        <div style={{ textAlign: 'center', marginBottom: '30px', borderBottom: '3px solid #10b981', paddingBottom: '15px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981', margin: 0 }}>محاكاة التداول - بورصة مصر EGX</h1>
          <p style={{ fontSize: '14px', color: '#666', margin: '5px 0 0' }}>تقرير الأداء - تم الإنشاء: {new Date().toLocaleDateString('ar-EG')}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
          <div style={{ background: '#f0fdf4', padding: '12px', borderRadius: '8px' }}>
            <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>الرصيد النقدي</p>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0' }}>{formatCurrency(simState.balance)}</p>
          </div>
          <div style={{ background: '#eff6ff', padding: '12px', borderRadius: '8px' }}>
            <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>قيمة المحفظة</p>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0' }}>{formatCurrency(portfolioValue)}</p>
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
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>السهم</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>العدد</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>متوسط التكلفة</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>السعر الحالي</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>الربح/الخسارة</th>
              </tr>
            </thead>
            <tbody>
              {simState.positions.map((pos) => {
                const stock = stocks.find((s) => s.ticker === pos.ticker);
                if (!stock) return null;
                const pnl = (stock.price - pos.avgCost) * pos.shares;
                return (
                  <tr key={pos.ticker}>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{stock.name_ar}</td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{pos.shares}</td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{formatNumber(pos.avgCost)}</td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{formatNumber(stock.price)}</td>
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

        <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px', borderBottom: '1px solid #e5e7eb', paddingBottom: '5px' }}>آخر المعاملات</h2>
        {simState.transactions.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>التاريخ</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>النوع</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>السهم</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>العدد</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>السعر</th>
                <th style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb' }}>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {[...simState.transactions].reverse().slice(0, 20).map((tx) => (
                <tr key={tx.id}>
                  <td style={{ padding: '8px', border: '1px solid #e5e7eb', fontSize: '11px' }}>
                    {new Date(tx.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ padding: '8px', border: '1px solid #e5e7eb', color: tx.type === 'buy' ? '#059669' : '#dc2626' }}>
                    {tx.type === 'buy' ? 'شراء' : 'بيع'}
                  </td>
                  <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{tx.ticker}</td>
                  <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{tx.shares}</td>
                  <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{formatNumber(tx.price)}</td>
                  <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{formatCurrency(tx.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: '#999' }}>لا توجد معاملات بعد</p>
        )}

        <div style={{ marginTop: '30px', textAlign: 'center', fontSize: '12px', color: '#999', borderTop: '1px solid #e5e7eb', paddingTop: '10px' }}>
          هذا التقرير تم إنشاؤه تلقائياً من محاكاة التداول - بورصة مصر EGX<br />
          جميع الأرقام افتراضية ولا تمثل صفقات حقيقية
        </div>
      </div>
    </div>
  );
}
