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
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { useAppStore, MARKET_NAMES_AR, MARKET_CURRENCY_LABEL, type MarketType } from '@/lib/store';
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
  market?: MarketType;
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
// Per-market state storage so switching markets keeps separate progress.
const STORAGE_KEY_BY_MARKET: Record<MarketType, string> = {
  EGX: 'simulation_egx_sim',
  TADAWUL: 'simulation_tadawul_sim',
  KSE: 'simulation_kse_sim',
  QSE: 'simulation_qse_sim',
  US: 'simulation_us_sim',
  CRYPTO: 'simulation_crypto_sim',
};
const TICK_INTERVAL = 5000; // 5 seconds — live random-walk tick

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
  { ticker: 'COMI', name_ar: 'البنك التجاري الدولي (CIB)', sector: 'البنوك', basePrice: 38.5 },
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
  { ticker: 'MISR', name_ar: 'مصر للألمنيوم', sector: 'الصناعة', basePrice: 25.3 },
  { ticker: 'CIBK', name_ar: 'بنك مصر', sector: 'البنوك', basePrice: 28.4 },
  { ticker: 'TMGH', name_ar: 'المجموعة المالية هيرمس', sector: 'الخدمات المالية', basePrice: 19.8 },
  { ticker: 'FWRY', name_ar: 'فوري لتكنولوجيا الدفع', sector: 'التكنولوجيا', basePrice: 4.65 },
  { ticker: 'KIMA', name_ar: 'كيما للأسمدة', sector: 'الصناعة', basePrice: 22.7 },
  { ticker: 'MFPC', name_ar: 'شركة الماضي للتنمية والتعمير', sector: 'العقارات', basePrice: 4.55 },
];

// ─── Per-market fallback seeds (offline default if /api/stocks is unreachable) ─
// The primary source is /api/stocks?market=<market>. These are minimal seeds
// so the simulation never shows an empty list, even with no backend.
const FALLBACK_SEEDS: Record<MarketType, { ticker: string; name_ar: string; sector: string; basePrice: number }[]> = {
  EGX: EGX_STOCKS_RAW,
  TADAWUL: [
    { ticker: '2222', name_ar: 'أرامكو السعودية', sector: 'الطاقة', basePrice: 31.5 },
    { ticker: '1180', name_ar: 'الأهلي السعودي', sector: 'البنوك', basePrice: 64.2 },
    { ticker: '7010', name_ar: 'STC', sector: 'الاتصالات', basePrice: 38.9 },
    { ticker: '1120', name_ar: 'الراجحي', sector: 'البنوك', basePrice: 88.4 },
    { ticker: '2010', name_ar: 'سابك', sector: 'البتروكيماويات', basePrice: 71.3 },
    { ticker: '2330', name_ar: 'تداول', sector: 'الخدمات المالية', basePrice: 122.5 },
    { ticker: '4190', name_ar: 'جرير', sector: 'التجزئة', basePrice: 14.8 },
    { ticker: '2280', name_ar: 'المملكة القابضة', sector: 'الاستثمار', basePrice: 6.9 },
    { ticker: '8230', name_ar: 'العثيم', sector: 'التجزئة', basePrice: 89.6 },
    { ticker: '7203', name_ar: 'سيرا', sector: 'النقل', basePrice: 71.4 },
    { ticker: '4001', name_ar: 'مجموعة سامبا', sector: 'البنوك', basePrice: 32.1 },
    { ticker: '4030', name_ar: 'بنك الرياض', sector: 'البنوك', basePrice: 28.5 },
  ],
  KSE: [
    { ticker: 'BKMB', name_ar: 'بنك الكويت المركزي', sector: 'البنوك', basePrice: 0.612 },
    { ticker: 'KFIN', name_ar: 'كاب', sector: 'الخدمات المالية', basePrice: 0.128 },
    { ticker: 'NBKK', name_ar: 'بنك الكويت الوطني', sector: 'البنوك', basePrice: 0.725 },
    { ticker: 'FOOD', name_ar: 'الأغذية المتحدة', sector: 'الأغذية', basePrice: 1.18 },
    { ticker: 'ZAIN', name_ar: 'زين', sector: 'الاتصالات', basePrice: 0.352 },
    { ticker: 'MABANEE', name_ar: 'المباني', sector: 'العقارات', basePrice: 0.418 },
    { ticker: 'BOUBYAN', name_ar: 'بنك بوبيان', sector: 'البنوك', basePrice: 0.612 },
    { ticker: 'AGRICO', name_ar: 'الزراعية', sector: 'الزراعة', basePrice: 0.478 },
    { ticker: 'KPC', name_ar: 'بتروكيماويات الكويت', sector: 'البتروكيماويات', basePrice: 0.712 },
    { ticker: 'FAST', name_ar: 'أجري', sector: 'النقل', basePrice: 0.385 },
  ],
  QSE: [
    { ticker: 'QNB', name_ar: 'بنك قطر الوطني', sector: 'البنوك', basePrice: 18.6 },
    { ticker: 'QIBK', name_ar: 'بنك قطر الإسلامي', sector: 'البنوك', basePrice: 36.2 },
    { ticker: 'OOREDOO', name_ar: 'أوريدو', sector: 'الاتصالات', basePrice: 8.9 },
    { ticker: 'IQCD', name_ar: 'الصناعات القطرية', sector: 'الصناعة', basePrice: 51.4 },
    { ticker: 'QATI', name_ar: 'الأسمنت القطري', sector: 'البناء والتشييد', basePrice: 14.8 },
    { ticker: 'MCCS', name_ar: 'المجموعة الطبية', sector: 'الرعاية الصحية', basePrice: 28.3 },
    { ticker: 'QNNS', name_ar: 'الأسمدة', sector: 'البتروكيماويات', basePrice: 12.5 },
    { ticker: 'UCIC', name_ar: 'الكابلات', sector: 'الصناعة', basePrice: 14.1 },
    { ticker: 'QIMC', name_ar: 'الصناعات القطرية', sector: 'الصناعة', basePrice: 7.2 },
    { ticker: 'MASQ', name_ar: 'مسقط القابضة', sector: 'الاستثمار', basePrice: 1.85 },
  ],
  US: [
    { ticker: 'AAPL', name_ar: 'آبل', sector: 'التكنولوجيا', basePrice: 188.5 },
    { ticker: 'MSFT', name_ar: 'مايكروسوفت', sector: 'التكنولوجيا', basePrice: 374.2 },
    { ticker: 'NVDA', name_ar: 'إنفيديا', sector: 'التكنولوجيا', basePrice: 875.4 },
    { ticker: 'TSLA', name_ar: 'تسلا', sector: 'السيارات', basePrice: 254.8 },
    { ticker: 'GOOGL', name_ar: 'ألفابيت', sector: 'التكنولوجيا', basePrice: 141.6 },
    { ticker: 'AMZN', name_ar: 'أمازون', sector: 'التجزئة', basePrice: 178.3 },
    { ticker: 'META', name_ar: 'ميتا', sector: 'التكنولوجيا', basePrice: 498.7 },
    { ticker: 'JPM', name_ar: 'جي بي مورغان', sector: 'البنوك', basePrice: 198.4 },
    { ticker: 'V', name_ar: 'فيزا', sector: 'الخدمات المالية', basePrice: 275.6 },
    { ticker: 'BRK.B', name_ar: 'بيركشاير', sector: 'التأمين', basePrice: 412.9 },
    { ticker: 'SPY', name_ar: 'مؤشر S&P 500', sector: 'المؤشرات', basePrice: 514.3 },
    { ticker: 'QQQ', name_ar: 'مؤشر نازداك 100', sector: 'المؤشرات', basePrice: 438.2 },
  ],
  CRYPTO: [
    { ticker: 'BTC', name_ar: 'بيتكوين', sector: 'العملات الرقمية', basePrice: 67250 },
    { ticker: 'ETH', name_ar: 'إيثيريوم', sector: 'العملات الرقمية', basePrice: 3512 },
    { ticker: 'BNB', name_ar: 'بينانس', sector: 'العملات الرقمية', basePrice: 588.4 },
    { ticker: 'SOL', name_ar: 'سولانا', sector: 'العملات الرقمية', basePrice: 168.2 },
    { ticker: 'XRP', name_ar: 'ريبل', sector: 'العملات الرقمية', basePrice: 0.524 },
    { ticker: 'ADA', name_ar: 'كاردانو', sector: 'العملات الرقمية', basePrice: 0.452 },
    { ticker: 'DOGE', name_ar: 'دوجكوين', sector: 'العملات الرقمية', basePrice: 0.128 },
    { ticker: 'AVAX', name_ar: 'أفالانش', sector: 'العملات الرقمية', basePrice: 36.5 },
    { ticker: 'DOT', name_ar: 'بولكادوت', sector: 'العملات الرقمية', basePrice: 7.85 },
    { ticker: 'MATIC', name_ar: 'بوليغون', sector: 'العملات الرقمية', basePrice: 0.742 },
    { ticker: 'LINK', name_ar: 'تشين لينك', sector: 'العملات الرقمية', basePrice: 14.3 },
    { ticker: 'LTC', name_ar: 'لايتكوين', sector: 'العملات الرقمية', basePrice: 84.6 },
  ],
};

// Map the MarketType used in the UI to the market code expected by /api/stocks.
const API_MARKET_CODE: Record<MarketType, string> = {
  EGX: 'EGX',
  TADAWUL: 'KSA',
  KSE: 'KSE',
  QSE: 'QSE',
  US: 'US',
  CRYPTO: 'CRYPTO',
};

// Adapt a raw stock returned by /api/stocks (backend shape mirrors the
// stocks.db schema — see src/app/api/stocks/route.ts) into the EGXStock shape
// the simulator consumes. Accepts both stock + crypto row variants.
function adaptApiStock(raw: Record<string, unknown>, market: MarketType): EGXStock | null {
  const ticker = (raw.ticker as string) || (raw.symbol as string) || '';
  if (!ticker) return null;
  const nameAr = (raw.name_ar as string) || (raw.name as string) || ticker;
  const sector = (raw.sector as string) || (raw.industry as string) || (market === 'CRYPTO' ? 'العملات الرقمية' : 'أخرى');
  const basePrice = Number(raw.current_price ?? raw.price ?? raw.price_usd ?? 0) || Number(raw.last_price ?? 0) || 0;
  // For crypto especially, some coins return current_price = 0 from the fallback
  // path — skip those rows so the user doesn't see "BTC at 0".
  if (!basePrice || basePrice <= 0) return null;
  const price = Number(basePrice.toFixed(basePrice < 1 ? 4 : 2));
  return {
    ticker,
    name_ar: nameAr,
    sector,
    basePrice: price,
    price,
    change: 0,
    changePercent: 0,
    market,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatNumber(n: number, decimals = 2): string {
  return n.toLocaleString('ar-EG', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCurrency(n: number, currencyLabel = 'ج.م'): string {
  return `${formatNumber(n)} ${currencyLabel}`;
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

function loadState(market: MarketType): SimState {
  if (typeof window === 'undefined') return getDefaultState();
  try {
    const key = STORAGE_KEY_BY_MARKET[market] || STORAGE_KEY_BY_MARKET.EGX;
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored) as SimState;
      return parsed;
    }
  } catch { // silent fallback (safe-by-design)
    // ignore
  }
  return getDefaultState();
}

function saveState(state: SimState, market: MarketType) {
  if (typeof window === 'undefined') return;
  try {
    const key = STORAGE_KEY_BY_MARKET[market] || STORAGE_KEY_BY_MARKET.EGX;
    localStorage.setItem(key, JSON.stringify(state));
  } catch { // silent fallback (safe-by-design)
    // ignore
  }
}

// ─── Component ────────────────────────────────────────────────────────────

export function SimulationView() {
  // Market (global — comes from the unified store, same selector as the rest of
  // the app so #crypto-simulation and #simulation share state per Rule 53
  // CRYPTO-IN-MARKETS + Rule 51 MULTI-MARKET-DUAL-TRACK).
  const currentMarket = useAppStore((s) => s.currentMarket);
  const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket] || 'ج.م';
  const marketNameAr = MARKET_NAMES_AR[currentMarket] || 'السوق';

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

  // Build the initial simulation stocks for a given list of seed rows (each
  // row has ticker / name_ar / sector / basePrice). Used both by the dynamic
  // API fetch path (Step 2) and the offline fallback (FALLBACK_SEEDS).
  const buildStocksFromSeeds = useCallback(
    (seeds: { ticker: string; name_ar: string; sector: string; basePrice: number }[]): EGXStock[] => {
      return seeds.map((s) => {
        const randomOffset = (Math.random() - 0.5) * 0.04; // ±2% initial spread
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
    [currentMarket]
  );

  // Initialize stocks from the offline fallback (instant — used while the API
  // is loading, or as the permanent source if the API is unreachable).
  const initStocks = useCallback(() => {
    const seeds = FALLBACK_SEEDS[currentMarket] || FALLBACK_SEEDS.EGX;
    setStocks(buildStocksFromSeeds(seeds));
  }, [buildStocksFromSeeds, currentMarket]);

  // Fetch stocks from /api/stocks?market=<market> (Step 2 — primary source).
  // Replaces the offline list when successful; on any failure we keep the
  // fallback seeds so the simulation never shows an empty list.
  const fetchStocksForMarket = useCallback(
    async (market: MarketType) => {
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
        // Apply a small ±2% initial spread so the simulator starts in a
        // realistic-looking state, then replace the fallback list.
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
      } catch { // silent fallback (safe-by-design)
        // Silent — fallback seeds already cover this case.
      }
    },
    []
  );

  // Load persisted state on mount + whenever the market changes (each market
  // has its own per-market localStorage key so progress is preserved).
  useEffect(() => {
    const loaded = loadState(currentMarket);
    setSimState(loaded);
    initStocks();
    // Kick off the dynamic fetch — if it succeeds, it replaces the fallback.
    fetchStocksForMarket(currentMarket);
  }, [initStocks, fetchStocksForMarket, currentMarket]);

  // Save state on change
  useEffect(() => {
    if (stocks.length > 0) {
      saveState(simState, currentMarket);
    }
  }, [simState, stocks.length, currentMarket]);

  // Price simulation tick — random walk every TICK_INTERVAL (5s).
  // Volatility is market-aware: crypto swings wider (±3%) than equities (±1.5%)
  // so the live feel matches each market's actual behavior. Decimals adapt to
  // the price magnitude so coins like XRP ($0.52) and DOGE ($0.13) don't
  // round to 0.00 after a few ticks.
  const tickPrices = useCallback(() => {
    setStocks((prev) => {
      const newFlashing: Record<string, 'up' | 'down'> = {};
      const updated = prev.map((s) => {
        // Market-aware volatility (±%). Crypto is the most volatile; US large
        // caps are the least volatile among our markets.
        const volatilityPct =
          s.market === 'CRYPTO' ? 3.0 :
          s.market === 'US' ? 1.0 :
          s.market === 'TADAWUL' ? 1.5 :
          2.0; // EGX/KSE/QSE default
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
    fetchStocksForMarket(currentMarket);
    setResetDialogOpen(false);
    toast.success('تم إعادة تعيين المحاكاة بنجاح');
  }, [initStocks, fetchStocksForMarket, currentMarket]);

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
        (s.ticker || '').toLowerCase().includes(q) ||
        (s.name_ar ?? '').includes(q) ||
        (s.sector ?? '').includes(q)
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

  // ─── UnifiedTable columns ────────────────────────────────────────────
  const stockListColumns: Column<EGXStock>[] = useMemo(() => ([
    {
      key: 'name_ar',
      header: 'السهم',
      sortable: true,
      filterable: true,
      className: 'font-medium dark:text-on-surface',
      render: (s) => s.name_ar,
    },
    {
      key: 'ticker',
      header: 'الرمز',
      sortable: true,
      filterable: true,
      width: 'w-24',
      render: (s) => <Badge variant="outline" className="stitch-num dark:font-financial dark:text-on-surface dark:border-outline-variant">{s.ticker}</Badge>,
    },
    {
      key: 'sector',
      header: 'القطاع',
      sortable: true,
      filterable: true,
      className: 'text-stitch-muted text-sm dark:text-on-surface-variant',
    },
    {
      key: 'price',
      header: 'السعر',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'stitch-num font-bold tabular-nums dark:font-financial dark:text-on-surface',
      render: (s) => formatNumber(s.price),
    },
    {
      key: 'change',
      header: 'التغير',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (s) => (
        <span className={cn('stitch-num inline-flex items-center gap-1 tabular-nums dark:font-financial', s.change >= 0 ? 'text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-error')}>
          {s.change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {s.change >= 0 ? '+' : ''}{formatNumber(s.change)}
        </span>
      ),
    },
    {
      key: 'changePercent',
      header: 'النسبة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      render: (s) => (
        <Badge
          variant={s.changePercent >= 0 ? 'default' : 'destructive'}
          className={cn(s.changePercent >= 0 ? 'bg-emerald-500/10 text-stitch-primary dark:bg-emerald-900/30 dark:text-stitch-primary dark:bg-primary-container/30 dark:text-primary dark:border dark:border-primary-container/40' : '', 'tabular-nums dark:font-financial')}
        >
          {s.changePercent >= 0 ? '+' : ''}{(s.changePercent ?? 0).toFixed(2)}%
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      align: 'center',
      width: 'w-32',
      hideable: false,
      render: (s) => (
        <div className="flex items-center justify-center gap-1">
          <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 dark:bg-primary-container dark:text-on-primary-container dark:hover:bg-primary-container/90 dark:border-transparent" onClick={(e) => { e.stopPropagation(); openTradeDialog(s, 'buy'); }}>
            <Plus className="h-3 w-3" />
            شراء
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 dark:bg-error-container dark:text-on-error-container dark:border-transparent dark:hover:bg-error-container/90" onClick={(e) => { e.stopPropagation(); openTradeDialog(s, 'sell'); }}>
            <Minus className="h-3 w-3" />
            بيع
          </Button>
        </div>
      ),
    },
  ]), [openTradeDialog]);

  const holdingsColumns: Column<Position & { _stock?: EGXStock; _currentValue?: number; _pnl?: number; _pnlPercent?: number }>[] = useMemo(() => ([
    {
      key: 'ticker',
      header: 'السهم',
      sortable: true,
      filterable: true,
      render: (p) => (
        <div>
          <p className="font-medium dark:text-on-surface">{p._stock?.name_ar || p.ticker}</p>
          <Badge variant="outline" className="stitch-num text-xs dark:font-financial dark:text-on-surface-variant dark:border-outline-variant">{p.ticker}</Badge>
        </div>
      ),
    },
    {
      key: 'shares',
      header: 'العدد',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'stitch-num tabular-nums dark:font-financial dark:text-on-surface',
    },
    {
      key: 'avgCost',
      header: 'متوسط التكلفة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      className: 'stitch-num tabular-nums dark:font-financial dark:text-on-surface',
      render: (p) => formatNumber(p.avgCost),
    },
    {
      key: '_currentPrice',
      header: 'السعر الحالي',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      className: 'stitch-num tabular-nums dark:font-financial dark:text-on-surface',
      render: (p) => formatNumber(p._stock?.price ?? 0),
    },
    {
      key: '_currentValue',
      header: 'القيمة الحالية',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-32',
      className: 'stitch-num font-bold tabular-nums dark:font-financial dark:text-on-surface',
      render: (p) => formatCurrency(p._currentValue ?? 0, currencyLabel),
    },
    {
      key: '_pnl',
      header: 'الربح/الخسارة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-36',
      render: (p) => (
        <div className={cn('stitch-num font-medium tabular-nums dark:font-financial', (p._pnl ?? 0) >= 0 ? 'text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-error')}>
          <p>{(p._pnl ?? 0) >= 0 ? '+' : ''}{formatCurrency(p._pnl ?? 0, currencyLabel)}</p>
          <p className="text-xs">({(p._pnlPercent ?? 0) >= 0 ? '+' : ''}{(p._pnlPercent ?? 0).toFixed(2)}%)</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'إجراء',
      align: 'center',
      width: 'w-24',
      hideable: false,
      render: (p) => (
        <div className="flex items-center justify-center">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 text-rose-400 hover:text-red-700 border-red-200 hover:bg-red-50 dark:bg-error-container dark:text-on-error-container dark:border-transparent dark:hover:bg-error-container/90"
            onClick={(e) => { if (p._stock) { e.stopPropagation(); openTradeDialog(p._stock, 'sell'); } }}
          >
            <Minus className="h-3 w-3" />
            بيع
          </Button>
        </div>
      ),
    },
  ]), [openTradeDialog, currencyLabel]);

  const transactionsColumns: Column<Transaction & { _stockName?: string }>[] = useMemo(() => ([
    {
      key: 'date',
      header: 'التاريخ',
      sortable: true,
      filterable: true,
      width: 'w-32',
      render: (t) => (
        <span className="text-xs text-stitch-muted whitespace-nowrap dark:text-on-surface-variant">
          {new Date(t.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'النوع',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-24',
      render: (t) => (
        <Badge variant={t.type === 'buy' ? 'default' : 'destructive'} className={cn(t.type === 'buy' ? 'bg-emerald-500/10 text-stitch-primary dark:bg-emerald-900/30 dark:text-stitch-primary dark:bg-primary-container/30 dark:text-primary dark:border dark:border-primary-container/40' : 'dark:bg-error-container/30 dark:text-error dark:border dark:border-error-container/40')}>
          {t.type === 'buy' ? (
            <span className="flex items-center gap-1"><ArrowDownRight className="h-3 w-3" /> شراء</span>
          ) : (
            <span className="flex items-center gap-1"><ArrowUpRight className="h-3 w-3" /> بيع</span>
          )}
        </Badge>
      ),
    },
    {
      key: 'ticker',
      header: 'السهم',
      sortable: true,
      filterable: true,
      render: (t) => (
        <div>
          <p className="font-medium text-sm dark:text-on-surface">{t._stockName || t.ticker}</p>
          <Badge variant="outline" className="stitch-num text-xs dark:font-financial dark:text-on-surface-variant dark:border-outline-variant">{t.ticker}</Badge>
        </div>
      ),
    },
    {
      key: 'shares',
      header: 'العدد',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-20',
      className: 'stitch-num tabular-nums dark:font-financial dark:text-on-surface',
    },
    {
      key: 'price',
      header: 'السعر',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'stitch-num tabular-nums dark:font-financial dark:text-on-surface',
      render: (t) => formatNumber(t.price),
    },
    {
      key: 'commission',
      header: 'العمولة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'stitch-num text-stitch-muted text-xs dark:font-financial dark:text-on-surface-variant tabular-nums',
      render: (t) => formatNumber(t.commission),
    },
    {
      key: 'total',
      header: 'الإجمالي',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      className: 'stitch-num font-bold tabular-nums dark:font-financial dark:text-on-surface',
      render: (t) => formatCurrency(t.total, currencyLabel),
    },
    {
      key: 'pnl',
      header: 'الربح/الخسارة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (t) => (
        t.pnl !== undefined ? (
          <span className={cn('stitch-num font-medium text-sm tabular-nums dark:font-financial', t.pnl >= 0 ? 'text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-error')}>
            {t.pnl >= 0 ? '+' : ''}{formatCurrency(t.pnl, currencyLabel)}
          </span>
        ) : (
          <span className="text-stitch-muted text-sm dark:text-on-surface-variant">-</span>
        )
      ),
    },
  ]), [currencyLabel]);

  // Pre-compute enriched holdings data for UnifiedTable
  const holdingsRows = useMemo(() => {
    return simState.positions.map((pos) => {
      const stock = stocks.find((s) => s.ticker === pos.ticker);
      if (!stock) return null;
      const currentValue = pos.shares * stock.price;
      const costValue = pos.shares * pos.avgCost;
      const pnl = currentValue - costValue;
      const pnlPercent = costValue > 0 ? (pnl / costValue) * 100 : 0;
      return { ...pos, _stock: stock, _currentValue: currentValue, _pnl: pnl, _pnlPercent: pnlPercent };
    }).filter((r): r is Position & { _stock: EGXStock; _currentValue: number; _pnl: number; _pnlPercent: number } => r !== null);
  }, [simState.positions, stocks]);

  // Pre-compute enriched transactions data for UnifiedTable (most-recent-first)
  const transactionsRows = useMemo(() => {
    return [...filteredTransactions].reverse().map((tx) => {
      const stock = stocks.find((s) => s.ticker === tx.ticker);
      return { ...tx, _stockName: stock?.name_ar };
    });
  }, [filteredTransactions, stocks]);

  // ─── Render ────────────────────────────────────────────────────────

  if (stocks.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] dark:bg-surface-container-lowest">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary dark:border-primary mx-auto" />
          <p className="text-stitch-muted dark:text-on-surface-variant">جاري تحميل المحاكاة...</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6 dark:bg-surface-container-lowest">
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl shadow-lg dark:bg-primary-container dark:from-primary-container dark:to-primary-container dark:shadow-primary-container/30">
            <Gamepad2 className="h-6 w-6 text-white dark:text-on-primary-container" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight dark:text-on-surface dark:font-outfit">محاكاة التداول الافتراضي</h1>
            <p className="text-sm text-stitch-muted dark:text-on-surface-variant">
              تدرّب على التداول بأموال افتراضية بدون أي مخاطر — {marketNameAr}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <MarketSelector size="sm" />
          <Badge
            variant={marketOpen ? 'default' : 'secondary'}
            className={cn('gap-1.5 px-3 py-1', marketOpen ? 'bg-emerald-600 hover:bg-emerald-600 dark:bg-primary-container dark:text-on-primary-container dark:hover:bg-primary-container/90' : 'bg-red-600 hover:bg-red-600 dark:bg-error-container dark:text-on-error-container dark:hover:bg-error-container/90')}
          >
            <span className={cn('h-2 w-2 rounded-full', marketOpen ? 'bg-white animate-pulse dark:bg-on-primary-container' : 'bg-red-200 dark:bg-on-error-container')} />
            {marketOpen ? 'السوق مفتوح' : 'السوق مغلق'}
          </Badge>
          <Badge variant="outline" className="gap-1.5 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface-variant">
            <Clock className="h-3.5 w-3.5" />
            {getCairoTime()} - القاهرة
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSimulationRunning((p) => !p)}
            className="gap-1.5 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high"
          >
            {isSimulationRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isSimulationRunning ? 'إيقاف' : 'تشغيل'}
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} className="gap-1.5 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high">
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
            className="gap-1.5 dark:bg-error-container dark:text-on-error-container dark:hover:bg-error-container/90 dark:border-transparent"
          >
            <RotateCcw className="h-4 w-4" />
            إعادة تعيين
          </Button>
        </div>
      </div>

      {/* ─── Tabs ─────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex flex-wrap h-auto gap-1 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <TabsTrigger value="dashboard" className="gap-1.5 dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary-container dark:text-on-surface-variant">
            <BarChart3 className="h-4 w-4" />
            لوحة التحكم
          </TabsTrigger>
          <TabsTrigger value="trading" className="gap-1.5 dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary-container dark:text-on-surface-variant">
            <ShoppingCart className="h-4 w-4" />
            التداول
          </TabsTrigger>
          <TabsTrigger value="portfolio" className="gap-1.5 dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary-container dark:text-on-surface-variant">
            <Wallet className="h-4 w-4" />
            المحفظة
          </TabsTrigger>
          <TabsTrigger value="transactions" className="gap-1.5 dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary-container dark:text-on-surface-variant">
            <History className="h-4 w-4" />
            سجل المعاملات
          </TabsTrigger>
          <TabsTrigger value="watchlist" className="gap-1.5 dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary-container dark:text-on-surface-variant">
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
            <Card className="relative overflow-hidden dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-stitch-muted dark:text-on-surface-variant">الرصيد النقدي</p>
                    <p className="text-xl font-bold tabular-nums dark:font-financial dark:text-primary">{formatCurrency(simState.balance, currencyLabel)}</p>
                  </div>
                  <div className="p-2 bg-emerald-500/10 dark:bg-emerald-900/30 dark:bg-primary-container/40 rounded-lg">
                    <Wallet className="h-5 w-5 text-stitch-primary dark:text-stitch-primary dark:text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-stitch-muted dark:text-on-surface-variant">قيمة المحفظة</p>
                    <p className="text-xl font-bold tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(portfolioValue, currencyLabel)}</p>
                  </div>
                  <div className="p-2 bg-teal-100 dark:bg-teal-900/30 dark:bg-surface-container-high rounded-lg">
                    <DollarSign className="h-5 w-5 text-teal-600 dark:text-teal-400 dark:text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={cn('relative overflow-hidden dark:bg-surface-container-low dark:border dark:border-outline-variant/30', totalPnL >= 0 ? 'border-emerald-200 dark:border-emerald-800 dark:border-primary-container/40' : 'border-red-200 dark:border-red-800 dark:border-error-container/40')}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-stitch-muted dark:text-on-surface-variant">إجمالي الربح/الخسارة</p>
                    <p className={cn('text-xl font-bold tabular-nums dark:font-financial', totalPnL >= 0 ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
                      {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL, currencyLabel)}
                    </p>
                  </div>
                  <div className={cn('p-2 rounded-lg', totalPnL >= 0 ? 'bg-emerald-500/10 dark:bg-emerald-900/30 dark:bg-primary-container/40' : 'bg-rose-500/10 dark:bg-red-900/30 dark:bg-error-container/40')}>
                    {totalPnL >= 0 ? <TrendingUp className="h-5 w-5 text-stitch-primary dark:text-primary" /> : <TrendingDown className="h-5 w-5 text-rose-400 dark:text-error" />}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-stitch-muted dark:text-on-surface-variant">نسبة الربح/الخسارة</p>
                    <p className={cn('text-xl font-bold tabular-nums dark:font-financial', totalPnLPercent >= 0 ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
                      {totalPnLPercent >= 0 ? '+' : ''}{(totalPnLPercent ?? 0).toFixed(2)}%
                    </p>
                  </div>
                  <div className={cn('p-2 rounded-lg', totalPnLPercent >= 0 ? 'bg-emerald-500/10 dark:bg-emerald-900/30 dark:bg-primary-container/40' : 'bg-rose-500/10 dark:bg-red-900/30 dark:bg-error-container/40')}>
                    <Target className="h-5 w-5 dark:text-on-surface-variant" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-stitch-muted dark:text-on-surface-variant">عدد الصفقات</p>
                    <p className="text-xl font-bold tabular-nums dark:font-financial dark:text-on-surface">{tradeCount}</p>
                  </div>
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/30 dark:bg-surface-container-high rounded-lg">
                    <Zap className="h-5 w-5 text-amber-600 dark:text-on-surface-variant" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Chart + Quick Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 dark:text-on-surface dark:font-outfit">
                  <TrendingUp className="h-4 w-4 dark:text-primary" />
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
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-stitch-muted" />
                      <YAxis tick={{ fontSize: 11 }} className="text-stitch-muted" domain={['auto', 'auto']} />
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
                  <div className="flex items-center justify-center h-[280px] text-stitch-muted">
                    <p>سيتم عرض الرسم البياني بعد أول تحديث للأسعار</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 dark:text-on-surface dark:font-outfit">
                  <Zap className="h-4 w-4 dark:text-primary" />
                  إجراءات سريعة
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm text-stitch-muted dark:text-on-surface-variant">الرصيد المتاح</p>
                  <p className="text-2xl font-bold text-stitch-primary dark:text-stitch-primary tabular-nums dark:font-financial dark:text-primary">{formatCurrency(simState.balance, currencyLabel)}</p>
                  <Progress value={((INITIAL_BALANCE - simState.balance) / INITIAL_BALANCE) * 100} className="h-2 dark:bg-surface-container-highest" />
                  <p className="text-xs text-stitch-muted dark:text-on-surface-variant">مستثمر: {formatCurrency(investedAmount, currencyLabel)} من {formatCurrency(INITIAL_BALANCE, currencyLabel)}</p>
                </div>
                <Separator className="dark:bg-outline-variant" />
                <div className="space-y-2">
                  <Button
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 dark:bg-primary-container dark:text-on-primary-container dark:hover:bg-primary-container/90"
                    onClick={() => setActiveTab('trading')}
                  >
                    <ShoppingCart className="h-4 w-4" />
                    شراء أسهم
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full gap-2 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high"
                    onClick={() => setActiveTab('portfolio')}
                  >
                    <Wallet className="h-4 w-4" />
                    عرض المحفظة
                  </Button>
                </div>
                <Separator className="dark:bg-outline-variant" />
                <div className="rounded-lg bg-[#182030]/50 p-3 space-y-1.5 dark:bg-surface-container dark:border dark:border-outline-variant/30">
                  <p className="text-xs font-medium text-stitch-muted dark:text-on-surface-variant">إحصائيات سريعة</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-stitch-muted dark:text-on-surface-variant">القيمة الإجمالية</span>
                    <span className="font-medium tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(totalValue, currencyLabel)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-stitch-muted dark:text-on-surface-variant">المركز المفتوحة</span>
                    <span className="font-medium tabular-nums dark:font-financial dark:text-on-surface">{simState.positions.length}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-stitch-muted dark:text-on-surface-variant">العمولة</span>
                    <span className="font-medium tabular-nums dark:font-financial dark:text-on-surface">0.15%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Market Overview */}
          <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 dark:text-on-surface dark:font-outfit">
                <RefreshCw className="h-4 w-4 dark:text-primary" />
                نظرة على السوق
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 max-h-[400px] overflow-y-auto">
                {stocks.slice(0, 12).map((stock) => (
                  <div
                    key={stock.ticker}
                    className={cn(
                      'rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md dark:bg-surface-container dark:border-outline-variant/30 dark:hover:bg-surface-container-high',
                      flashingTickers[stock.ticker] === 'up' && 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:bg-primary-container/20 dark:border-primary-container/40',
                      flashingTickers[stock.ticker] === 'down' && 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:bg-error-container/20 dark:border-error-container/40'
                    )}
                    onClick={() => openTradeDialog(stock, 'buy')}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm dark:font-financial dark:text-on-surface">{stock.ticker}</span>
                      <span className={cn('text-xs font-medium tabular-nums dark:font-financial', stock.change >= 0 ? 'text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-error')}>
                        {stock.change >= 0 ? '+' : ''}{stock.changePercent}%
                      </span>
                    </div>
                    <p className="text-xs text-stitch-muted truncate dark:text-on-surface-variant">{stock.name_ar}</p>
                    <p className="text-sm font-bold mt-1 tabular-nums dark:font-financial dark:text-on-surface">{formatNumber(stock.price)} {currencyLabel}</p>
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
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stitch-muted dark:text-on-surface-variant" />
            <Input
              placeholder="ابحث عن سهم بالرمز أو الاسم أو القطاع..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10 text-right dark:bg-surface-container dark:border-outline-variant dark:text-on-surface"
            />
          </div>

          {/* Stock List */}
          <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-y-auto">
                <UnifiedTable<EGXStock>
                  columns={stockListColumns}
                  data={filteredStocks}
                  keyField="ticker"
                  dense
                  columnToggle
                  filterable
                  maxHeight="max-h-[600px]"
                  rowClassName={(s) => cn(
                    'transition-colors',
                    flashingTickers[s.ticker] === 'up' && 'bg-emerald-50/50 dark:bg-emerald-950/20',
                    flashingTickers[s.ticker] === 'down' && 'bg-red-50/50 dark:bg-red-950/20',
                  )}
                />
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
            <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardContent className="p-4">
                <p className="text-sm text-stitch-muted dark:text-on-surface-variant">الرصيد النقدي</p>
                <p className="text-lg font-bold tabular-nums dark:font-financial dark:text-primary">{formatCurrency(simState.balance, currencyLabel)}</p>
              </CardContent>
            </Card>
            <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardContent className="p-4">
                <p className="text-sm text-stitch-muted dark:text-on-surface-variant">إجمالي الاستثمار</p>
                <p className="text-lg font-bold tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(investedAmount, currencyLabel)}</p>
              </CardContent>
            </Card>
            <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardContent className="p-4">
                <p className="text-sm text-stitch-muted dark:text-on-surface-variant">القيمة الحالية</p>
                <p className="text-lg font-bold tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(portfolioValue, currencyLabel)}</p>
              </CardContent>
            </Card>
            <Card className={cn(totalPnL >= 0 ? 'border-emerald-200 dark:border-emerald-800 dark:bg-surface-container-low dark:border dark:border-primary-container/40' : 'border-red-200 dark:border-red-800 dark:bg-surface-container-low dark:border dark:border-error-container/40')}>
              <CardContent className="p-4">
                <p className="text-sm text-stitch-muted dark:text-on-surface-variant">الربح/الخسارة غير المحقق</p>
                <p className={cn('text-lg font-bold tabular-nums dark:font-financial', totalPnL >= 0 ? 'text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-error')}>
                  {totalPnL >= 0 ? '+' : ''}{formatCurrency(portfolioValue - investedAmount, currencyLabel)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Holdings */}
            <Card className="lg:col-span-2 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 dark:text-on-surface dark:font-outfit">
                  <Wallet className="h-4 w-4 dark:text-primary" />
                  الأصول المحتفظ بها
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {simState.positions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-stitch-muted dark:text-on-surface-variant space-y-3">
                    <Trophy className="h-12 w-12 text-stitch-muted/30 dark:text-on-surface-variant/30" />
                    <p>لا توجد أصول محتفظ بها حالياً</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveTab('trading')}
                      className="gap-1.5 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      ابدأ التداول
                    </Button>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto">
                    <UnifiedTable
                      columns={holdingsColumns}
                      data={holdingsRows}
                      keyField="ticker"
                      dense
                      columnToggle
                      filterable
                      maxHeight="max-h-[400px]"
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sector Allocation */}
            <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 dark:text-on-surface dark:font-outfit">
                  <PieChart className="h-4 w-4 dark:text-primary" />
                  توزيع القطاعات
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sectorAllocation.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-stitch-muted dark:text-on-surface-variant space-y-2">
                    <PieChart className="h-8 w-8 text-stitch-muted/30 dark:text-on-surface-variant/30" />
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
                            formatter={(value: number) => formatCurrency(value, currencyLabel)}
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
                            <span className="text-xs truncate dark:text-on-surface-variant">{item.sector}</span>
                          </div>
                          <span className="text-xs stitch-num font-medium whitespace-nowrap dark:font-financial dark:text-on-surface tabular-nums">{(item.percent ?? 0).toFixed(1)}%</span>
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
            <h3 className="text-lg font-semibold flex items-center gap-2 dark:text-on-surface dark:font-outfit">
              <History className="h-5 w-5 dark:text-primary" />
              سجل المعاملات
            </h3>
            <Select value={transactionFilter} onValueChange={(v) => setTransactionFilter(v as 'all' | 'buy' | 'sell')}>
              <SelectTrigger className="w-36 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="dark:bg-surface-container dark:border-outline-variant">
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="buy">الشراء فقط</SelectItem>
                <SelectItem value="sell">البيع فقط</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <CardContent className="p-0">
              {filteredTransactions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-stitch-muted dark:text-on-surface-variant space-y-3">
                  <History className="h-12 w-12 text-stitch-muted/30 dark:text-on-surface-variant/30" />
                  <p>لا توجد معاملات بعد</p>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab('trading')} className="gap-1.5 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high">
                    <ShoppingCart className="h-4 w-4" />
                    ابدأ التداول
                  </Button>
                </div>
              ) : (
                <div className="max-h-[500px] overflow-y-auto">
                  <UnifiedTable
                    columns={transactionsColumns}
                    data={transactionsRows}
                    keyField="id"
                    dense
                    columnToggle
                    filterable
                    maxHeight="max-h-[500px]"
                  />
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
            <h3 className="text-lg font-semibold flex items-center gap-2 dark:text-on-surface dark:font-outfit">
              <Eye className="h-5 w-5 dark:text-primary" />
              قائمة الرغبات
              <Badge variant="outline" className="dark:bg-surface-container dark:border-outline-variant dark:text-on-surface-variant">{simState.watchlist.length}</Badge>
            </h3>
          </div>

          {simState.watchlist.length === 0 ? (
            <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <CardContent className="flex flex-col items-center justify-center py-16 text-stitch-muted dark:text-on-surface-variant space-y-3">
                <Star className="h-12 w-12 text-stitch-muted/30 dark:text-on-surface-variant/30" />
                <p>قائمة الرغبات فارغة</p>
                <p className="text-sm">أضف الأسهم التي تريد مراقبتها من صفحة التداول</p>
                <Button variant="outline" size="sm" onClick={() => setActiveTab('trading')} className="gap-1.5 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high">
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
                      'transition-all hover:shadow-md cursor-pointer dark:bg-surface-container-low dark:border dark:border-outline-variant/30 dark:hover:bg-surface-container',
                      flashingTickers[ticker] === 'up' && 'border-emerald-300 bg-emerald-50/30 dark:bg-primary-container/20 dark:border-primary-container/40',
                      flashingTickers[ticker] === 'down' && 'border-red-300 bg-red-50/30 dark:bg-error-container/20 dark:border-error-container/40'
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="stitch-num dark:font-financial dark:text-on-surface dark:border-outline-variant">{stock.ticker}</Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-primary-container/30"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleWatchlist(ticker);
                              }}
                            >
                              <Star className="h-4 w-4 fill-amber-500 dark:fill-primary dark:text-primary" />
                            </Button>
                          </div>
                          <p className="font-medium mt-1 dark:text-on-surface">{stock.name_ar}</p>
                          <p className="text-xs text-stitch-muted dark:text-on-surface-variant">{stock.sector}</p>
                        </div>
                        <div className="text-left">
                          <p className="text-lg font-bold stitch-num dark:font-financial dark:text-on-surface tabular-nums">{formatNumber(stock.price)}</p>
                          <div className={cn('flex items-center gap-0.5 justify-end text-sm font-medium tabular-nums dark:font-financial', stock.change >= 0 ? 'text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-error')}>
                            {stock.change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                            {stock.change >= 0 ? '+' : ''}{(stock.changePercent ?? 0).toFixed(2)}%
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 dark:bg-primary-container dark:text-on-primary-container dark:hover:bg-primary-container/90"
                          onClick={() => openTradeDialog(stock, 'buy')}
                        >
                          <Plus className="h-3 w-3" />
                          شراء
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-8 text-xs gap-1 dark:bg-error-container dark:text-on-error-container dark:border-transparent dark:hover:bg-error-container/90"
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
          <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 dark:text-on-surface dark:font-outfit">
                <Plus className="h-4 w-4 dark:text-primary" />
                إضافة أسهم لقائمة الرغبات
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stitch-muted dark:text-on-surface-variant" />
                <Input
                  placeholder="ابحث عن سهم..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto">
                {filteredStocks
                  .filter((s) => !simState.watchlist.includes(s.ticker))
                  .slice(0, 8)
                  .map((stock) => (
                    <div
                      key={stock.ticker}
                      className="flex items-center justify-between rounded-lg border p-3 hover:bg-[#182030]/50 transition-colors dark:bg-surface-container dark:border-outline-variant/30 dark:hover:bg-surface-container-high"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate dark:text-on-surface">{stock.name_ar}</p>
                        <p className="text-xs text-stitch-muted dark:text-on-surface-variant">{stock.ticker}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0 text-stitch-muted hover:text-amber-500 dark:text-on-surface-variant dark:hover:text-primary"
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
        <DialogContent className="sm:max-w-md dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 dark:text-on-surface dark:font-outfit">
              {tradeType === 'buy' ? (
                <span className="flex items-center gap-2 text-stitch-primary dark:text-primary">
                  <ArrowDownRight className="h-5 w-5" />
                  شراء سهم
                </span>
              ) : (
                <span className="flex items-center gap-2 text-rose-400 dark:text-error">
                  <ArrowUpRight className="h-5 w-5" />
                  بيع سهم
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedStock && (
            <div className="space-y-4">
              <div className="rounded-lg bg-[#182030]/50 p-3 space-y-1.5 dark:bg-surface-container dark:border dark:border-outline-variant/30">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stitch-muted dark:text-on-surface-variant">السهم</span>
                  <span className="font-medium dark:text-on-surface">{selectedStock.name_ar} ({selectedStock.ticker})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stitch-muted dark:text-on-surface-variant">السعر الحالي</span>
                  <span className="stitch-num font-bold tabular-nums dark:font-financial dark:text-on-surface">{formatNumber(selectedStock.price)} {currencyLabel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stitch-muted dark:text-on-surface-variant">رصيدك</span>
                  <span className="stitch-num tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(simState.balance, currencyLabel)}</span>
                </div>
                {tradeType === 'sell' && (() => {
                  const pos = simState.positions.find((p) => p.ticker === selectedStock.ticker);
                  return pos ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-stitch-muted dark:text-on-surface-variant">أسهمك</span>
                      <span className="stitch-num tabular-nums dark:font-financial dark:text-on-surface">{pos.shares} سهم</span>
                    </div>
                  ) : null;
                })()}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium dark:text-on-surface">عدد الأسهم</label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high"
                    onClick={() => setTradeQuantity((q) => Math.max(0, q - 1))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    value={tradeQuantity || ''}
                    onChange={(e) => setTradeQuantity(Math.max(0, parseInt(e.target.value) || 0))}
                    className="text-center stitch-num dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:font-financial tabular-nums"
                    placeholder="0"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high"
                    onClick={() => setTradeQuantity((q) => q + 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  {tradeType === 'buy' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 text-xs dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high"
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
                        className="h-9 text-xs dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high"
                        onClick={() => setTradeQuantity(pos.shares)}
                      >
                        الكل
                      </Button>
                    ) : null;
                  })()}
                </div>
              </div>

              {tradeQuantity > 0 && (
                <div className="rounded-lg border p-3 space-y-1.5 dark:bg-surface-container dark:border-outline-variant/30">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-stitch-muted dark:text-on-surface-variant">سعر السهم</span>
                    <span className="stitch-num tabular-nums dark:font-financial dark:text-on-surface">{formatNumber(selectedStock.price)} {currencyLabel}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-stitch-muted dark:text-on-surface-variant">عدد الأسهم</span>
                    <span className="stitch-num tabular-nums dark:font-financial dark:text-on-surface">{tradeQuantity}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-stitch-muted dark:text-on-surface-variant">المجموع الفرعي</span>
                    <span className="stitch-num tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(tradeQuantity * selectedStock.price, currencyLabel)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-stitch-muted dark:text-on-surface-variant">العمولة ({(COMMISSION_RATE * 100).toFixed(2)}%)</span>
                    <span className="stitch-num text-amber-600 tabular-nums dark:font-financial dark:text-on-surface-variant">{formatNumber(tradeQuantity * selectedStock.price * COMMISSION_RATE)} {currencyLabel}</span>
                  </div>
                  <Separator className="dark:bg-outline-variant" />
                  <div className="flex items-center justify-between font-bold dark:text-on-surface">
                    <span>{tradeType === 'buy' ? 'الإجمالي' : 'صافي الإيرادات'}</span>
                    <span className="stitch-num tabular-nums dark:font-financial dark:text-primary">
                      {tradeType === 'buy'
                        ? formatCurrency(tradeQuantity * selectedStock.price * (1 + COMMISSION_RATE), currencyLabel)
                        : formatCurrency(tradeQuantity * selectedStock.price * (1 - COMMISSION_RATE), currencyLabel)}
                    </span>
                  </div>
                </div>
              )}

              {tradeType === 'buy' && tradeQuantity > 0 && tradeQuantity * selectedStock.price * (1 + COMMISSION_RATE) > simState.balance && (
                <div className="flex items-center gap-2 text-sm text-rose-400 bg-red-50 dark:bg-red-950/30 rounded-lg p-3 dark:bg-error-container/30 dark:text-error dark:border dark:border-error-container/50">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>رصيدك غير كافي لإتمام هذه الصفقة</span>
                </div>
              )}

              {tradeType === 'sell' && (() => {
                const pos = simState.positions.find((p) => p.ticker === selectedStock.ticker);
                if (!pos) return (
                  <div className="flex items-center gap-2 text-sm text-rose-400 bg-red-50 dark:bg-red-950/30 rounded-lg p-3 dark:bg-error-container/30 dark:text-error dark:border dark:border-error-container/50">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>ليس لديك أسهم من هذا السهم لبيعها</span>
                  </div>
                );
                if (tradeQuantity > pos.shares) return (
                  <div className="flex items-center gap-2 text-sm text-rose-400 bg-red-50 dark:bg-red-950/30 rounded-lg p-3 dark:bg-error-container/30 dark:text-error dark:border dark:border-error-container/50">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>عدد الأسهم المطلوبة أكبر مما تملك ({pos.shares})</span>
                  </div>
                );
                return null;
              })()}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setTradeDialogOpen(false)} className="dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high">
              إلغاء
            </Button>
            <Button
              className={cn(
                'gap-1.5',
                tradeType === 'buy' ? 'bg-emerald-600 hover:bg-emerald-700 dark:bg-primary-container dark:text-on-primary-container dark:hover:bg-primary-container/90 dark:border-transparent' : 'bg-red-600 hover:bg-red-700 dark:bg-error-container dark:text-on-error-container dark:hover:bg-error-container/90 dark:border-transparent'
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
        <AlertDialogContent className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-on-surface dark:font-outfit">
              تأكيد {pendingTrade?.type === 'buy' ? 'الشراء' : 'البيع'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTrade && (
                <div className="space-y-2 mt-2 text-right" dir="rtl">
                  <p className="dark:text-on-surface-variant">
                    هل أنت متأكد من{' '}
                    <span className="font-bold text-stitch-on-surface dark:text-on-surface">
                      {pendingTrade.type === 'buy' ? 'شراء' : 'بيع'}
                    </span>{' '}
                    <span className="font-bold text-stitch-on-surface dark:text-on-surface">
                      {pendingTrade.quantity} سهم
                    </span>{' '}
                    من{' '}
                    <span className="font-bold text-stitch-on-surface dark:text-on-surface">
                      {pendingTrade.stock.name_ar} ({pendingTrade.stock.ticker})
                    </span>{' '}
                    بسعر{' '}
                    <span className="stitch-num font-bold text-stitch-on-surface tabular-nums dark:font-financial dark:text-primary">
                      {formatNumber(pendingTrade.stock.price)} {currencyLabel}
                    </span>
                    ؟
                  </p>
                  <Separator className="dark:bg-outline-variant" />
                  <div className="flex justify-between text-sm dark:text-on-surface-variant">
                    <span>الإجمالي (شامل العمولة)</span>
                    <span className="stitch-num font-bold tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(pendingTrade.total, currencyLabel)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-stitch-muted dark:text-on-surface-variant">
                    <span>العمولة</span>
                    <span className="stitch-num tabular-nums dark:font-financial">{formatNumber(pendingTrade.commission)} {currencyLabel}</span>
                  </div>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeTrade}
              className={cn(pendingTrade?.type === 'buy' ? 'bg-emerald-600 hover:bg-emerald-700 dark:bg-primary-container dark:text-on-primary-container dark:hover:bg-primary-container/90 dark:border-transparent' : 'bg-red-600 hover:bg-red-700 dark:bg-error-container dark:text-on-error-container dark:hover:bg-error-container/90 dark:border-transparent')}
            >
              تأكيد التنفيذ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Reset Dialog ──────────────────────────────────────────── */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 dark:text-on-surface dark:font-outfit">
              <AlertTriangle className="h-5 w-5 text-destructive dark:text-error" />
              إعادة تعيين المحاكاة
            </AlertDialogTitle>
            <AlertDialogDescription className="dark:text-on-surface-variant">
              هل أنت متأكد من إعادة تعيين المحاكاة؟ سيتم حذف جميع البيانات بما في ذلك:
              <ul className="mt-2 space-y-1 text-right mr-4 list-disc">
                <li>جميع المعاملات السابقة</li>
                <li>جميع الأصول المحتفظ بها</li>
                <li>سجل الأداء</li>
                <li>قائمة الرغبات</li>
              </ul>
              <p className="mt-2 font-bold text-stitch-on-surface dark:text-on-surface">لا يمكن التراجع عن هذا الإجراء.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high">إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={resetSimulation} className="bg-destructive hover:bg-destructive/90 dark:bg-error-container dark:text-on-error-container dark:hover:bg-error-container/90 dark:border-transparent">
              <span className="flex items-center gap-1.5"><RotateCcw className="h-4 w-4" /> إعادة تعيين</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Hidden Report Section for PDF Export ─────────────────── */}
      <div ref={setReportRef} className="hidden" dir="rtl" style={{ fontFamily: 'Arial, sans-serif', padding: '20px', color: '#333' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px', borderBottom: '3px solid #10b981', paddingBottom: '15px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>محاكاة التداول الافتراضي — {marketNameAr}</h2>
          <p style={{ fontSize: '14px', color: '#666', margin: '5px 0 0' }}>تقرير الأداء - تم الإنشاء: {new Date().toLocaleDateString('ar-EG')}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
          <div style={{ background: '#f0fdf4', padding: '12px', borderRadius: '8px' }}>
            <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>الرصيد النقدي</p>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0' }}>{formatCurrency(simState.balance, currencyLabel)}</p>
          </div>
          <div style={{ background: '#eff6ff', padding: '12px', borderRadius: '8px' }}>
            <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>قيمة المحفظة</p>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0' }}>{formatCurrency(portfolioValue, currencyLabel)}</p>
          </div>
          <div style={{ background: totalPnL >= 0 ? '#f0fdf4' : '#fef2f2', padding: '12px', borderRadius: '8px' }}>
            <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>إجمالي الربح/الخسارة</p>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0', color: totalPnL >= 0 ? '#059669' : '#dc2626' }}>
              {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL, currencyLabel)}
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
                      {pnl >= 0 ? '+' : ''}{formatCurrency(pnl, currencyLabel)}
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
                  <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>{formatCurrency(tx.total, currencyLabel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: '#999' }}>لا توجد معاملات بعد</p>
        )}

        <div style={{ marginTop: '30px', textAlign: 'center', fontSize: '12px', color: '#999', borderTop: '1px solid #e5e7eb', paddingTop: '10px' }}>
          هذا التقرير تم إنشاؤه تلقائياً من محاكاة التداول الافتراضي<br />
          جميع الأرقام افتراضية ولا تمثل صفقات حقيقية
        </div>
      </div>
    </div>
  );
}
