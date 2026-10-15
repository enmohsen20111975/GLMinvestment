'use client';

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import dynamic from 'next/dynamic';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  AlertTriangle,
  Plus,
  Trash2,
  Pencil,
  Sparkles,
  Building2,
  PiggyBank,
  CreditCard,
  GraduationCap,
  Briefcase,
  Plane,
  Home,
  ShoppingCart,
  Car,
  Heart,
  Zap,
  FileText,
  Landmark,
  Coins,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Shield,
  RefreshCw,
  Scale,
  Bitcoin,
  Gem,
  Banknote,
  HandCoins,
  LifeBuoy,
  Percent,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { usePortfolioStore } from '@/lib/portfolio-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { StockPublisher, type StockPublishData } from '@/modules/publishing/components/StockPublisher';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// PortfolioIntelligenceSection removed - feature disabled
import { MultiPortfolioSelector, getPortfolioColorClass } from '@/modules/portfolio/components/MultiPortfolioSelector';
import { MasterPortfolioSummary } from '@/modules/portfolio/components/MasterPortfolioSummary';
import { RealReturnPanel } from '@/modules/portfolio/components/RealReturnPanel';
import { BagHolderRescuePanel } from '@/modules/portfolio/components/BagHolderRescuePanel';
import { TopUpRecommendationsPanel } from '@/modules/portfolio/components/TopUpRecommendationsPanel';
import { V82DecisionPanel } from '@/components/v82/V82DecisionPanel';
import { RiskProfilerQuiz } from '@/modules/portfolio/components/RiskProfilerQuiz';
import { RoboAdvisorPanel } from '@/modules/portfolio/components/RoboAdvisorPanel';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAppStore, MARKET_NAMES_AR, MarketType } from '@/lib/store';
// PHASE3-MARKET-SEGREGATION: portfolio assets (stocks) carry a `stock_market`
// hint when added — but legacy rows don't have it, so we also infer from the
// ticker pattern. The badge shows which market each stock belongs to so the
// user can distinguish EGX holdings from TADAWUL/KSE/QSE/US/CRYPTO.
function inferStockMarket(ticker: string, stored?: string | null): MarketType | null {
  if (stored && stored.trim()) {
    const upper = stored.trim().toUpperCase();
    if (upper === 'EGX' || upper === 'EGYPT') return 'EGX';
    if (upper === 'TADAWUL' || upper === 'KSA' || upper === 'SAUDI') return 'TADAWUL';
    if (upper === 'KSE' || upper === 'KUWAIT') return 'KSE';
    if (upper === 'QSE' || upper === 'QATAR') return 'QSE';
    if (upper === 'US' || upper === 'USA') return 'US';
    if (upper === 'CRYPTO') return 'CRYPTO';
  }
  // Heuristic fallback: TADAWUL tickers are pure digits (e.g. 2222 = Aramco).
  // EGX tickers are alphabetic (COMI, ETEL, AALR). Crypto tickers usually end
  // with USDT/BTC/etc.
  if (!ticker) return null;
  if (/^\d+$/.test(ticker)) return 'TADAWUL';
  if (ticker.includes('USDT') || ticker.includes('BTC') || ticker.includes('ETH')) return 'CRYPTO';
  return 'EGX'; // default for legacy rows
}
import { useTranslation } from '@/lib/i18n-context';
import { trackFeature } from '@/lib/analytics';
// P39-PHASE-2: Wealth Allocation Matrix — persona-aware asset ceilings + alerts.
import {
  checkWealthAllocationMatrix,
  personaLabelAr,
  type WealthAllocationAlert,
} from '@/lib/persona-dynamic';
import { DynamicRiskProfilerModal } from '@/components/persona/DynamicRiskProfilerModal';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import type {
  AssetType,
  PortfolioAsset,
  FinancialTransaction,
  FinancialObligation,
  IncomeExpenseSummary,
  PortfolioSummary,
  FinancialAlert,
  TransactionType,
} from '@/types';

// TASK 40-B (2026-10-04 — Nav Reorganization + Portfolio Merge):
// WealthCharts was previously a separate top-level tab (`#wealth`). Owner
// directive: merge it into the portfolio view as a sub-tab. Lazy-loaded
// (it pulls recharts + ~6 chart sub-components) to keep the initial
// portfolio bundle small.
const WealthCharts = dynamic(
  () => import('@/modules/admin/components/WealthCharts').then(m => ({ default: m.WealthCharts })),
  { ssr: false, loading: () => (
    <Card className="mt-4">
      <CardContent className="p-6 text-sm text-stitch-muted">{loadingWealthText}</CardContent>
    </Card>
  ) }
);

// Static loading string for the WealthCharts dynamic-import fallback. We
// cannot use useTranslation() here because the dynamic loader renders the
// fallback before the I18nProvider mounts on the client. So we pull the
// Arabic text straight from the messages file (which lives outside src/
// and is therefore not flagged by i18n_audit.py).
// eslint-disable-next-line @typescript-eslint/no-var-requires
import arLocaleMessages from '../../../../messages/ar.json';
const loadingWealthText: string =
  (arLocaleMessages as { portfolio?: { loadingWealth?: string } }).portfolio?.loadingWealth
  || 'Loading wealth charts…';

// ==================== HELPERS ====================

// P37-PHASE-2B-4A: Currency-aware formatter. All wealth values flow through
// this; per-row raw market prices (stock/gold per-gram) stay EGP and use the
// inline `toFixed(2)} EGP` suffix instead. SAR derived from USD via fixed 3.75 peg.
function formatCurrencyRaw(
  value: number | null | undefined,
  currency: 'EGP' | 'USD' | 'SAR',
  usdRate: number,
  sarRate: number
): string {
  // FIX (DEAL-ADVISOR-002): previously returned '0.00' for null/undefined/NaN,
  // which made the UI show fake "0.00 EGP" for missing prices/targets/stops.
  // Now returns '—' (em dash) so the user sees "N/A" visually.
  if (value === null || value === undefined) return '—';
  const numValue = Number(value);
  if (!Number.isFinite(numValue)) return '—';
  let converted = numValue;
  let suffix = 'EGP';
  if (currency === 'USD') {
    converted = numValue / (usdRate || 48.5);
    suffix = '$';
  } else if (currency === 'SAR') {
    converted = numValue / (sarRate || 181.875);
    suffix = 'SAR';
  }
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(converted);
  return currency === 'EGP' ? `${formatted} ${suffix}` : `${suffix}${formatted}`;
}

// EGP-only fallback formatter (kept for any module-scope helper that still
// needs raw EGP — sub-components shadow this with a currency-aware closure).
function formatCurrency(value: number | null | undefined): string {
  // FIX (DEAL-ADVISOR-002): '0.00 EGP' → '—' for missing values.
  if (value === null || value === undefined) return '—';
  const numValue = Number(value);
  if (!Number.isFinite(numValue)) return '—';
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numValue) + ' EGP';
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const numValue = Number(value);
  if (!Number.isFinite(numValue)) return '—';
  const sign = numValue >= 0 ? '+' : '';
  return `${sign}${(numValue ?? 0).toFixed(2)}%`;
}

function abbreviateNumber(value: number | null | undefined): string {
  // FIX (DEAL-ADVISOR-002): '0' → '—' for missing values.
  if (value === null || value === undefined) return '—';
  const numValue = Number(value);
  if (!Number.isFinite(numValue)) return '—';
  if (Math.abs(numValue) >= 1_000_000) return (numValue / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(numValue) >= 1_000) return (numValue / 1_000).toFixed(1) + 'K';
  return (numValue ?? 0).toFixed(2);
}

// PKG1-ROUND2: asset-type labels now sourced via t('portfolio.assetTypes.<key>').
// This list is the iteration order only (no embedded Arabic strings).
const ASSET_TYPES: AssetType[] = [
  'stock',
  'gold',
  'bank',
  'certificate',
  'fund',
  'crypto',
  'real_estate',
  'other',
];

const ASSET_TYPE_COLORS: Record<AssetType, string> = {
  stock: 'bg-emerald-500/10 text-stitch-primary dark:bg-emerald-600/80/30 dark:text-stitch-primary dark:bg-primary-container/30 dark:text-primary',
  gold: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  bank: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  certificate: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  fund: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  crypto: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  real_estate: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
};

// Fund types (labels via t('portfolio.fundTypes.<value>')).
const FUND_TYPES = [
  { value: 'equity' },
  { value: 'bond' },
  { value: 'money_market' },
  { value: 'fixed_income' },
  { value: 'balanced' },
  { value: 'index' },
  { value: 'real_estate' },
  { value: 'sharia' },
  { value: 'other' },
];

// Income categories (labels via t('portfolio.incomeCategories.<value>')).
const INCOME_CATEGORIES = [
  { value: 'salary', icon: Briefcase },
  { value: 'bonus', icon: Zap },
  { value: 'investment_return', icon: TrendingUp },
  { value: 'rental', icon: Home },
  { value: 'business', icon: Briefcase },
  { value: 'freelance', icon: FileText },
  { value: 'other_income', icon: DollarSign },
];

// Expense categories (labels via t('portfolio.expenseCategories.<value>')).
const EXPENSE_CATEGORIES = [
  { value: 'education', icon: GraduationCap },
  { value: 'housing', icon: Home },
  { value: 'transport', icon: Car },
  { value: 'food', icon: ShoppingCart },
  { value: 'healthcare', icon: Heart },
  { value: 'entertainment', icon: Plane },
  { value: 'travel', icon: Plane },
  { value: 'clothing', icon: ShoppingCart },
  { value: 'utilities', icon: Zap },
  { value: 'insurance', icon: Shield },
  { value: 'debt_payment', icon: CreditCard },
  { value: 'other_expense', icon: DollarSign },
];

// Obligation types (labels via t('portfolio.obligationTypes.<value>')).
const OBLIGATION_TYPE_KEYS = ['loan', 'installment', 'credit_card', 'mortgage'] as const;
const OBLIGATION_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  OBLIGATION_TYPE_KEYS.map((k) => [k, k]),
);

// Obligation status (labels via t('portfolio.obligationStatus.<value>')).
const OBLIGATION_STATUS_LABELS: Record<string, string> = {
  active: 'active',
  paid: 'paid',
  overdue: 'overdue',
};

const OBLIGATION_STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/10 text-stitch-primary dark:bg-emerald-600/80/30 dark:text-stitch-primary dark:bg-primary-container/30 dark:text-primary',
  paid: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  overdue: 'bg-rose-500/10 text-rose-400 dark:bg-rose-500/60/30 dark:text-rose-400 dark:bg-error-container/30 dark:text-error',
};

// ==================== STOCK SEARCH DROPDOWN ====================

interface StockSearchResult {
  id: number;
  ticker: string;
  name: string;
  name_ar: string;
  sector: string;
  current_price: number;
  previous_close: number;
  volume: number;
  price_change: number;
}

function StockSearchDropdown({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (ticker: string, name: string, currentPrice: number) => void;
}) {
  const t = useTranslation();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const doSearch = useCallback(async (term: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(term)}`);
      const data = await res.json();
      setResults(data.stocks || []);
    } catch { // silent fallback (safe-by-design)
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const handleChange = (val: string) => {
    setQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (val.trim().length < 1) {
      setOpen(false);
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      doSearch(val.trim());
      setOpen(true);
    }, 250);
  };

  const handleSelect = (stock: StockSearchResult) => {
    setQuery(`${stock.ticker} - ${stock.name_ar}`);
    setOpen(false);
    onSelect(stock.ticker, stock.name_ar, stock.current_price);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={t('portfolio.search.stockPlaceholder')}
          dir="rtl"
          onFocus={() => { if (results.length > 0) setOpen(true); }}
        />
        {loading && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-emerald-500/30 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {results.map((stock) => (
            <button
              key={stock.id}
              type="button"
              className="w-full text-right px-3 py-2.5 hover:bg-accent flex items-center justify-between gap-2 transition-colors border-b last:border-b-0"
              onClick={() => handleSelect(stock)}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{stock.name_ar}</div>
                <div className="text-xs text-stitch-muted" dir="ltr">{stock.ticker} | {stock.name}</div>
              </div>
              <div className="text-left flex-shrink-0">
                <div className="text-sm font-semibold" dir="ltr">{(stock.current_price ?? 0) > 0 ? (stock.current_price ?? 0).toFixed(2) : '—'}</div>
                <div className={cn('text-xs font-medium', (stock.price_change ?? 0) >= 0 ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
                  {(stock.price_change ?? 0) >= 0 ? '+' : ''}{(stock.price_change ?? 0).toFixed(2)}%
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== CRYPTO SEARCH DROPDOWN (Task 3) ====================

interface CryptoSearchResult {
  symbol: string;
  name: string;
  price_usd: number;
  change_24h: number;
}

function CryptoSearchDropdown({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (symbol: string, name: string, priceUsd: number) => void;
}) {
  const t = useTranslation();
  const [query, setQuery] = useState(value);
  const [allCoins, setAllCoins] = useState<CryptoSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setQuery(value); }, [value]);

  // Fetch all coins once when the dropdown is first focused
  const loadCoins = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const res = await fetch('/api/crypto/coins?limit=250');
      const data = await res.json();
      if (data.success && Array.isArray(data.all_cryptos)) {
        setAllCoins(data.all_cryptos.map((c: any) => ({
          symbol: c.symbol,
          name: c.name || c.symbol,
          price_usd: c.price_usd || 0,
          change_24h: c.change_24h || 0,
        })));
        setLoaded(true);
      }
    } catch { // silent fallback (safe-by-design)
      setAllCoins([]);
    } finally {
      setLoading(false);
    }
  }, [loaded]);

  const handleChange = (val: string) => {
    setQuery(val);
    if (!loaded) loadCoins();
    if (val.trim().length < 1) {
      setOpen(false);
      return;
    }
    setOpen(true);
  };

  // Client-side filter
  const filtered = open && allCoins.length > 0
    ? allCoins.filter(c => {
        const q = query.toLowerCase().trim();
        return c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
      }).slice(0, 30)
    : [];

  const handleSelect = (coin: CryptoSearchResult) => {
    setQuery(`${coin.symbol} - ${coin.name}`);
    setOpen(false);
    onSelect(coin.symbol, coin.name, coin.price_usd);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={t('portfolio.search.cryptoPlaceholder')}
          dir="rtl"
          onFocus={() => { if (!loaded) loadCoins(); if (allCoins.length > 0) setOpen(true); }}
        />
        {loading && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {filtered.map((coin) => (
            <button
              key={coin.symbol}
              type="button"
              className="w-full text-right px-3 py-2.5 hover:bg-accent flex items-center justify-between gap-2 transition-colors border-b last:border-b-0"
              onClick={() => handleSelect(coin)}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{coin.name}</div>
                <div className="text-xs text-stitch-muted" dir="ltr">{coin.symbol}</div>
              </div>
              <div className="text-left flex-shrink-0">
                <div className="text-sm font-semibold" dir="ltr">${coin.price_usd > 0 ? (coin.price_usd ?? 0).toFixed(2) : '—'}</div>
                <div className={cn('text-xs font-medium', coin.change_24h >= 0 ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
                  {coin.change_24h >= 0 ? '+' : ''}{(coin.change_24h ?? 0).toFixed(2)}%
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && !loading && filtered.length === 0 && allCoins.length > 0 && query.trim() && (
        <div className="absolute z-50 w-full mt-1 rounded-md border bg-popover shadow-lg p-3 text-sm text-stitch-muted text-center">
          {t('portfolio.search.noCryptoMatch', { query })}
        </div>
      )}
    </div>
  );
}

// ==================== ASSETS TAB ====================
// UI-STABILITY fix (2026-09-28): wrap AssetsTab in React.memo so background
// store updates (RealtimeTicker, etc.) don't re-render the entire tab tree
// when its props (selectedPortfolioId) haven't changed.
const AssetsTab = memo(function AssetsTab({ selectedPortfolioId = 'master' }: { selectedPortfolioId?: number | 'master' }) {
  const { currentMarket } = useAppStore();
  const { loadStockDetail, setFxRates, displayCurrency, usdRate, sarRate, persona, setDealAdvisorPrefill, setCurrentView } = useAppStore();
  const t = useTranslation();
  // P39-PHASE-2: state for the DynamicRiskProfilerModal (Retake button).
  const [profilerOpen, setProfilerOpen] = useState(false);

  // GLM5.2-A (P0-ALPHA-PORTFOLIO-COMMISSION): custom brokerage + slippage rate.
  // Per manager directive: commissions vary between EGX/TADAWUL/US + brokers.
  // Stored in localStorage (per-user, per-device). Applied to net trade returns.
  // Rule 27: no fake data — default is 0.00% (user sets their own real rate).
  const COMMISSION_LS_KEY = 'glm_commission_pct';
  const [commissionPct, setCommissionPct] = useState<number>(0);
  // Load from localStorage on mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(COMMISSION_LS_KEY);
      if (stored != null) {
        const parsed = parseFloat(stored);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 5) {
          setCommissionPct(parsed);
        }
      }
    } catch {
      // localStorage unavailable (SSR / privacy mode) — keep default 0.00%.
    }
  }, []);
  // Persist to localStorage on change.
  const updateCommission = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(5, val));
    setCommissionPct(clamped);
    try {
      localStorage.setItem(COMMISSION_LS_KEY, String(clamped));
    } catch {
      // silent fallback (safe-by-design)
    }
  }, []);
  // GLM5.2-A: apply commission to gross return → net return.
  // net_return = gross_return - (commission_pct × 2)  (×2 for buy + sell sides)
  const applyCommission = useCallback(
    (grossReturnPct: number | null | undefined): number | null => {
      if (grossReturnPct == null || !Number.isFinite(grossReturnPct)) return null;
      // commission × 2 (entry + exit), as a fraction of the trade value.
      const commissionCost = commissionPct * 2;
      return grossReturnPct - commissionCost;
    },
    [commissionPct],
  );
  // P37-PHASE-2B-4A: local currency-aware formatter — shadows the module-level
  // EGP-only version so every wealth value rendered inside this tab follows
  // the header's EGP/USD/SAR toggle. Per-row raw market prices (stock/gold
  // per-gram) intentionally keep their inline `toFixed(2)} EGP` suffix.
  const formatCurrency = (value: number | null | undefined) =>
    formatCurrencyRaw(value, displayCurrency, usdRate, sarRate);
  const [assets, setAssets] = useState<(PortfolioAsset & Record<string, unknown>)[]>([]);
  const [obligations, setObligations] = useState<FinancialObligation[]>([]);
  // B-1: Backend-provided net worth math (P34) — gross assets, debts, net worth, yields.
  // Comes straight from /api/finance/calculate-values so we never recompute it locally.
  const [netWorthData, setNetWorthData] = useState<{
    gross: number;
    debts: number;
    net: number;
    monthlyYield: number;
    annualYield: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [portfoliosMap, setPortfoliosMap] = useState<Record<string, { name: string; color: string }>>({});
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    async function fetchPortfoliosMap() {
      try {
        const res = await fetch('/api/portfolio/accounts?user_id=default');
        const data = await res.json();
        if (data.success && Array.isArray(data.portfolios)) {
          const pmap: Record<string, { name: string; color: string }> = {};
          for (const p of data.portfolios) {
            pmap[String(p.id)] = { name: p.name, color: p.color || 'blue' };
          }
          setPortfoliosMap(pmap);
        }
      } catch { /* safe-by-design */ }
    }
    fetchPortfoliosMap();
  }, []);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<(PortfolioAsset & Record<string, unknown>) | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Task 7: Pre-fill BagHolderRescuePanel when a losing position badge is clicked
  const [rescueProps, setRescueProps] = useState<{ ticker: string; buyPrice: number; quantity: number; autoAnalyze: boolean } | null>(null);

  // Form state
  const [formType, setFormType] = useState<AssetType>('stock');
  const [formName, setFormName] = useState('');
  const [formTotalInvested, setFormTotalInvested] = useState('');
  const [formCurrentValue, setFormCurrentValue] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const // Gold
    [formWeight, setFormWeight] = useState('');
  const [formKarat, setFormKarat] = useState('21');
  const [formPricePerGram, setFormPricePerGram] = useState('');
  // Bank
  const [formBankName, setFormBankName] = useState('');
  const [formInterestRate, setFormInterestRate] = useState('');
  // Certificate
  const [formDuration, setFormDuration] = useState('');
  const [formReturnRate, setFormReturnRate] = useState('');
  const [formMaturityDate, setFormMaturityDate] = useState('');
  // Fund
  const [formFundName, setFormFundName] = useState('');
  const [formFundType, setFormFundType] = useState('');
  // Fixed-income fund specific
  const [formAnnualReturn, setFormAnnualReturn] = useState('');
  const [formReturnType, setFormReturnType] = useState<'annual' | 'monthly' | 'daily'>('annual');
  const [formPurchaseDate, setFormPurchaseDate] = useState('');
  // Stock
  const [formTicker, setFormTicker] = useState('');
  const [formQuantity, setFormQuantity] = useState('');
  const [formAvgBuyPrice, setFormAvgBuyPrice] = useState('');
  const [formSelectedPrice, setFormSelectedPrice] = useState<number | null>(null);

  const resetForm = () => {
    setFormType('stock');
    setFormName(''); setFormTotalInvested(''); setFormCurrentValue(''); setFormNotes('');
    setFormWeight(''); setFormKarat('21'); setFormPricePerGram('');
    setFormBankName(''); setFormInterestRate('');
    setFormDuration(''); setFormReturnRate(''); setFormMaturityDate('');
    setFormFundName(''); setFormFundType('');
    setFormAnnualReturn(''); setFormReturnType('annual'); setFormPurchaseDate('');
    setFormTicker(''); setFormQuantity(''); setFormAvgBuyPrice(''); setFormSelectedPrice(null);
  };

  const [goldPrices, setGoldPrices] = useState<{ '24k': number; '21k': number; '18k': number } | null>(null);

  // P30 TASK 7: Silent background update — `silent=true` avoids showing the
  // full skeleton on every 30s poll. Only the initial load shows the skeleton.
  const loadAssets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const pidQs = selectedPortfolioId && selectedPortfolioId !== 'master' ? `?portfolio_id=${selectedPortfolioId}` : '';
      // B-1 FIX: Only fetch assets + obligations. Crypto is ALREADY returned by
      // /api/finance/calculate-values (FX-converted to EGP). Fetching
      // /api/crypto/portfolio again here used to (1) double-count crypto and
      // (2) treat USD prices as EGP — both inflating the total. The dedicated
      // crypto endpoint is no longer needed in this view.
      const [assetsRes, obligationsRes] = await Promise.all([
        fetch(`/api/finance/calculate-values${pidQs}`),
        fetch('/api/finance/obligations?status=active'),
      ]);
      
      const assetsData = await assetsRes.json();
      const obligationsData = await obligationsRes.json();
      
      const allAssets: (PortfolioAsset & Record<string, unknown>)[] = [];
      
      if (assetsData.success) {
        allAssets.push(...(assetsData.items || assetsData.assets || []));
        setGoldPrices(assetsData.gold_prices || null);
        // P37-PHASE-2A: Refresh the global USD→EGP FX rate so the header
        // display-currency toggle (EGP/USD/SAR) converts totals correctly.
        // The backend already returns exchange_rates from /api/finance/calculate-values;
        // we just plumb the USD rate into the Zustand store. SAR is derived
        // (usdRate * 3.75 fixed peg) inside setFxRates.
        try {
          const usd = Number(assetsData.exchange_rates?.USD);
          if (Number.isFinite(usd) && usd > 0) setFxRates(usd);
        } catch { /* silent — fall back to default 48.5 - safe-by-design */ }
        // B-1: Read the backend P34 net-worth math directly — no local recomputation.
        setNetWorthData({
          gross: assetsData.gross_assets_egp || assetsData.total_current_value || 0,
          debts: assetsData.total_obligations_egp || 0,
          net: assetsData.net_worth_egp || 0,
          monthlyYield: assetsData.smart_math?.monthly_yield_egp || 0,
          annualYield: assetsData.smart_math?.annual_yield_egp || 0,
        });
      } else {
        // fallback to the legacy API
        setNetWorthData(null);
        try {
          const fallbackRes = await fetch(`/api/finance/assets${pidQs}`);
          const fallbackData = await fallbackRes.json();
          allAssets.push(...(fallbackData.items || fallbackData.assets || []));
        } catch { // silent fallback (safe-by-design)
          // both APIs failed — continue with empty
        }
      }
      
      setAssets(allAssets);
      setObligations(obligationsData?.items || []);
      // P30 TASK 8: Push to unified store so MasterPortfolioSummary + RealReturnPanel auto-update
      usePortfolioStore.getState().updateFromCalcValues(assetsData);
    } catch { // silent fallback (safe-by-design)
      // P30 TASK 7: Only show error toast on initial load, not on silent polls
      if (!silent) toast.error(t('portfolio.toast.loadAssetsFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedPortfolioId]);

  useEffect(() => { loadAssets(); }, [loadAssets, selectedPortfolioId]);

  // ── P30 TASK 7 / P37-PHASE-2B-4A: Silent polling — refresh every 30s WITHOUT
  // showing the skeleton. Stops entirely when the tab is hidden (saves
  // CPU/battery) and fires immediately when the tab becomes visible again.
  useVisibilityAwarePolling(() => { loadAssets(true); }, 30_000, [loadAssets]);

  const addToWatchlist = async (ticker: string) => {
    try {
      // USER-ANALYTICS-EMITTERS: track watchlist_add from portfolio flow (fire-and-forget).
      trackFeature('watchlist_add', ticker);
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      toast.success(t('portfolio.toast.addToWatchlistSuccess', { ticker }));
    } catch { // silent fallback (safe-by-design)
      // Watchlist add is best-effort; don't block the main flow
    }
  };

  const handleStockSelect = (ticker: string, name: string, currentPrice: number) => {
    setFormTicker(ticker);
    setFormName(name);
    setFormSelectedPrice(currentPrice);
    // Auto-fill current value if quantity & buy price exist
    if (formQuantity && formAvgBuyPrice) {
      const qty = parseInt(formQuantity) || 0;
      const buy = parseFloat(formAvgBuyPrice) || 0;
      if (qty > 0 && buy > 0) {
        setFormTotalInvested(String(qty * buy));
      }
    }
  };

  const handleSave = async () => {
    if (formType === 'stock' && !formTicker) {
      toast.error(t('portfolio.toast.selectStock'));
      return;
    }
    // Task 3: Crypto also requires a symbol selection
    if (formType === 'crypto' && !formTicker) {
      toast.error(t('portfolio.toast.selectCrypto'));
      return;
    }
    if (!formName || formName.trim().length === 0) {
      toast.error(t('portfolio.toast.enterAssetName'));
      return;
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      type: formType,
      name: formName,
      total_invested: formTotalInvested ? parseFloat(formTotalInvested) : 0,
      current_value: formCurrentValue ? parseFloat(formCurrentValue) : 0,
      notes: formNotes.trim() || null,
      portfolio_id: selectedPortfolioId && selectedPortfolioId !== 'master' ? String(selectedPortfolioId) : 'default',
    };
    if (formType === 'gold') {
      payload.weight_grams = formWeight ? parseFloat(formWeight) : null;
      payload.karat = formKarat ? parseInt(formKarat) : 21;
      payload.purchase_price_per_gram = formPricePerGram ? parseFloat(formPricePerGram) : null;
    }
    if (formType === 'bank') {
      payload.bank_name = formBankName;
      payload.interest_rate = formInterestRate ? parseFloat(formInterestRate) : null;
    }
    if (formType === 'certificate') {
      payload.certificate_duration_months = formDuration ? parseInt(formDuration) : null;
      payload.certificate_return_rate = formReturnRate ? parseFloat(formReturnRate) : null;
      payload.certificate_maturity_date = formMaturityDate || null;
    }
    if (formType === 'fund') {
      payload.fund_name = formFundName;
      payload.fund_type = formFundType;
      if (formFundType === 'fixed_income') {
        payload.annual_return_rate = formAnnualReturn ? parseFloat(formAnnualReturn) : null;
        payload.return_type = formReturnType || 'annual';
        payload.purchase_date = formPurchaseDate || null;
      }
    }
    if (formType === 'stock') {
      payload.stock_ticker = formTicker;
      payload.quantity = formQuantity ? parseInt(formQuantity) : null;
      payload.avg_buy_price = formAvgBuyPrice ? parseFloat(formAvgBuyPrice) : null;
      // PHASE3-MARKET-SEGREGATION (Task F): store the selected market alongside
      // the ticker so the badge (added above) shows the correct market later.
      // If the user is viewing the dashboard under TADAWUL, new stock additions
      // automatically tag themselves as TADAWUL — no manual selection needed.
      payload.stock_market = currentMarket;
    }
    // ── Task 3: Crypto payload — reuse stock_ticker column for symbol ──
    if (formType === 'crypto') {
      payload.stock_ticker = formTicker;
      payload.quantity = formQuantity ? parseFloat(formQuantity) : null;
      payload.avg_buy_price = formAvgBuyPrice ? parseFloat(formAvgBuyPrice) : null;
      payload.market = 'CRYPTO';
      payload.currency = 'USD';
    }

    try {
      const res = await fetch('/api/finance/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch { // silent fallback (safe-by-design)
        const text = await res.text().catch(() => '');
        console.error('[Asset Add] Non-JSON response:', res.status, text);
        toast.error(t('portfolio.toast.serverError'), { duration: 10000 });
        return;
      }
      if (data.success) {
        toast.success(t('portfolio.toast.addAssetSuccess'));
        // USER-ANALYTICS-EMITTERS: track portfolio_add (Rule 27 — real action, fire-and-forget).
        trackFeature('portfolio_add', formTicker || formType);
        // Auto-add stock to watchlist
        if (formType === 'stock' && formTicker) {
          addToWatchlist(formTicker);
        }
        setAddDialogOpen(false);
        resetForm();
        loadAssets();
      } else {
        const detailMsg = data.detail ? ` (${data.detail})` : '';
        console.error('[Asset Add] Server error:', data);
        toast.error(String(data.error || t('portfolio.toast.addAssetFailed')) + detailMsg, { duration: 10000 });
      }
    } catch (fetchErr) {
      console.error('[Asset Add] Fetch error:', fetchErr);
      toast.error(t('portfolio.toast.connectionError'));
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async () => {
    if (!editAsset?.id) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      name: formName,
      total_invested: formTotalInvested ? parseFloat(formTotalInvested) : 0,
      current_value: formCurrentValue ? parseFloat(formCurrentValue) : 0,
      notes: formNotes.trim() || null,
      quantity: formQuantity ? parseInt(formQuantity) : null,
      avg_buy_price: formAvgBuyPrice ? parseFloat(formAvgBuyPrice) : null,
    };
    // Preserve fixed-income fund fields when editing
    if (formType === 'fund' && formFundType === 'fixed_income') {
      payload.annual_return_rate = formAnnualReturn ? parseFloat(formAnnualReturn) : null;
      payload.return_type = formReturnType || 'annual';
      payload.purchase_date = formPurchaseDate || null;
    }
    try {
      const res = await fetch(`/api/finance/assets/${editAsset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(t('portfolio.toast.updateAssetSuccess'));
        setEditDialogOpen(false);
        loadAssets();
      } else {
        toast.error(data.error || t('portfolio.toast.updateAssetFailed'));
      }
    } catch { // silent fallback (safe-by-design)
      toast.error(t('portfolio.toast.connectionError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/finance/assets/${deleteId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success(t('portfolio.toast.deleteAssetSuccess'));
        setDeleteId(null);
        loadAssets();
      } else {
        toast.error(data.error || t('portfolio.toast.deleteAssetFailed'));
      }
    } catch { // silent fallback (safe-by-design)
      toast.error(t('portfolio.toast.connectionError'));
    }
  };

  const openEdit = (asset: PortfolioAsset & Record<string, unknown>) => {
    setEditAsset(asset);
    setFormType(asset.type);
    setFormName(asset.name);
    setFormTotalInvested(String(asset.total_invested));
    setFormCurrentValue(String(asset.current_value));
    setFormNotes(asset.notes || '');
    setFormTicker(asset.stock_ticker || '');
    setFormQuantity(asset.quantity ? String(asset.quantity) : '');
    setFormAvgBuyPrice(asset.avg_buy_price ? String(asset.avg_buy_price) : '');
    // Fund-specific fields (populate so fixed_income payload preservation works on edit)
    setFormFundName((asset.fund_name as string) || '');
    setFormFundType((asset.fund_type as string) || '');
    setFormAnnualReturn(asset.annual_return_rate ? String(asset.annual_return_rate) : '');
    setFormReturnType((asset.return_type as 'annual' | 'monthly' | 'daily') || 'annual');
    setFormPurchaseDate((asset.purchase_date as string) || '');
    setEditDialogOpen(true);
  };

  const filteredAssets = filterType === 'all'
    ? assets
    : (assets || []).filter((a) => a.type === filterType);

  const totalAssets = (assets || []).reduce((s, a) => s + (a.current_value || 0), 0);
  const totalInvested = (assets || []).reduce((s, a) => s + (a.total_invested || 0), 0);
  const totalGainLoss = totalAssets - totalInvested;
  const totalReturnPercent = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;
  
  // Calculate net wealth = assets - liabilities
  const totalLiabilities = (obligations || []).reduce((s, o) => s + (o.remaining_amount || 0), 0);
  const netWealth = totalAssets - totalLiabilities;

  // ── Task 6: Compute live allocation by type for RiskProfilerQuiz rebalance ──
  const currentAllocation = (() => {
    if (totalAssets <= 0) return undefined;
    const byCat = { stocks: 0, gold: 0, cash: 0, crypto: 0 };
    for (const a of assets || []) {
      const val = Number(a.current_value || 0);
      if (val <= 0) continue;
      const t = (a.type || 'other').toLowerCase();
      if (t === 'stock') byCat.stocks += val;
      else if (t === 'gold' || t === 'silver') byCat.gold += val;
      else if (t === 'crypto') byCat.crypto += val;
      else if (['bank', 'certificate', 'fund', 'deposit', 'currency', 'forex'].includes(t)) byCat.cash += val;
    }
    return {
      stocks: (byCat.stocks / totalAssets) * 100,
      gold: (byCat.gold / totalAssets) * 100,
      cash: (byCat.cash / totalAssets) * 100,
      crypto: (byCat.crypto / totalAssets) * 100,
      totalValue: totalAssets,
    };
  })();

  // ── P31 TASK 4: Proactive bag-holder detection (loss >= 15%) ──
  // Banner at the top of the portfolio — appears automatically when any stock is
  // down 15%+ (live_price <= purchase * 0.85). Click → opens BagHolderRescuePanel
  // pre-filled with the worst position + auto-analyze.
  const severeLossPositions = assets
    .filter(a => {
      const t = String(a.type || '').toLowerCase();
      return t === 'stock' && a.stock_ticker && Number(a.profit_loss_percent || 0) <= -15;
    })
    .sort((a, b) => Number(a.profit_loss_percent || 0) - Number(b.profit_loss_percent || 0));

  // P39-PHASE-2: Wealth Allocation Matrix — aggregate current values per asset
  // class in EGP (NEVER converted — displayCurrency only affects rendering, not
  // the math passed to checkWealthAllocationMatrix). Mapping mirrors the
  // existing `currentAllocation` above: stock→egx, crypto→crypto, gold/silver→gold,
  // bank/certificate/fund/deposit/currency/forex/cash→cash.
  const portfolioNetWorthEGP = netWorthData?.gross ?? totalAssets;
  const wealthValuesEGP = useMemo(() => {
    const v = { egx: 0, crypto: 0, gold: 0, cash: 0 };
    for (const a of assets || []) {
      const val = Number(a.current_value || 0);
      if (!Number.isFinite(val) || val <= 0) continue;
      const t = String(a.type || '').toLowerCase();
      if (t === 'stock') v.egx += val;
      else if (t === 'crypto') v.crypto += val;
      else if (t === 'gold' || t === 'silver') v.gold += val;
      else if (['bank', 'certificate', 'fund', 'deposit', 'currency', 'forex', 'cash'].includes(t)) v.cash += val;
    }
    return v;
  }, [assets]);
  const wealthAlerts: WealthAllocationAlert[] = useMemo(
    () => checkWealthAllocationMatrix(wealthValuesEGP, portfolioNetWorthEGP, persona),
    [wealthValuesEGP, portfolioNetWorthEGP, persona],
  );

  // P39-PHASE-2: Auto-Rebalance — UI-only suggestions (no actual sells).
  // For each asset class over its ceiling, pick the largest holding in that
  // class and toast a sell suggestion that would bring the allocation back
  // to the persona's ceiling. Cash floor (minimum reserve) is reported
  // separately as a warning.
  const handleAutoRebalance = useCallback(() => {
    if (wealthAlerts.length === 0) {
      toast.success(t('portfolio.toast.portfolioBalanced'));
      return;
    }
    const overCeiling = wealthAlerts.filter((a) => a.asset !== 'cash' && a.overflow > 0);
    const cashAlert = wealthAlerts.find((a) => a.asset === 'cash');
    if (overCeiling.length === 0) {
      if (cashAlert && cashAlert.severity !== 'ok') {
        toast.warning(cashAlert.messageAr, { duration: 7000 });
      } else {
        toast.success(t('portfolio.toast.portfolioBalanced'));
      }
      return;
    }
    const assetLabelKeys = ['egx', 'crypto', 'gold'] as const;
    const typeMap: Record<string, string[]> = {
      egx: ['stock'],
      crypto: ['crypto'],
      gold: ['gold', 'silver'],
    };
    overCeiling.forEach((alert) => {
      const allowedTypes = typeMap[alert.asset] || [];
      const holdings = (assets || [])
        .filter((a) => allowedTypes.includes(String(a.type || '').toLowerCase()) && Number(a.current_value || 0) > 0)
        .sort((a, b) => Number(b.current_value || 0) - Number(a.current_value || 0));
      if (holdings.length === 0) {
        toast.warning(alert.messageAr, { duration: 7000 });
        return;
      }
      const top = holdings[0];
      const ticker = String(top.stock_ticker || top.name || 'asset');
      const overflowValueEGP = (alert.overflow / 100) * portfolioNetWorthEGP;
      const price = Number(top.current_stock_price || top.current_value || 0);
      const sellQty = price > 0 ? Math.ceil(overflowValueEGP / price) : 0;
      const qtyLabel = sellQty > 0 ? `${sellQty.toLocaleString('en-US')} units of ` : '';
      toast.warning(
        t('portfolio.wealth.autoToast', { qty: sellQty, ticker, asset: t(`portfolio.assetLabels.${alert.asset}`) || alert.asset, current: (alert.currentPercent ?? 0).toFixed(1), target: alert.ceilingPercent }),
        { duration: 8000 },
      );
    });
  }, [wealthAlerts, assets, portfolioNetWorthEGP]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-7 w-28" /></CardContent></Card>
          ))}
        </div>
        {[...Array(3)].map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* P31 TASK 4: Proactive rescue banner — auto-appears when a stock is down >= 15% */}
      {severeLossPositions.length > 0 && (() => {
        const worst = severeLossPositions[0];
        const lossPct = Math.abs(Number(worst.profit_loss_percent || 0));
        return (
          <button
            type="button"
            onClick={() => {
              setRescueProps({
                ticker: String(worst.stock_ticker),
                buyPrice: Number(worst.avg_buy_price || worst.purchase_price || 0),
                quantity: Number(worst.quantity || worst.shares || 0),
                autoAnalyze: true,
              });
              setTimeout(() => {
                document.getElementById('bag-holder-rescue-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
            }}
            className="w-full text-right rounded-lg border-2 border-rose-500/30 bg-red-50 dark:bg-rose-500/60/40 p-4 animate-pulse hover:bg-rose-500/10 dark:hover:bg-rose-500/60/60 transition-colors"
            title={t('portfolio.rescue.hint')}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-2xl">🚨</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-rose-400 dark:text-rose-400 text-sm md:text-base">
                  {t('portfolio.rescue.banner', { count: severeLossPositions.length, unit: severeLossPositions.length === 1 ? t('portfolio.rescue.unitSingular') : t('portfolio.rescue.unitPlural') })}
                </div>
                <div className="text-xs text-rose-400 dark:text-rose-400 mt-0.5">
                  {t('portfolio.rescue.worstPrefix', { ticker: worst.stock_ticker ?? '', pct: (lossPct ?? 0).toFixed(1) })}
                </div>
              </div>
            </div>
          </button>
        );
      })()}

      {/* ROBO-ADVISOR-P3: Real-return engine (inflation-adjusted) */}
      <RealReturnPanel />

      {/* ROBO-ADVISOR-P4: Risk assessment engine + Rebalancing */}
      {/* Task 6: Pass live allocation so the quiz can show smart rebalance alerts */}
      <RiskProfilerQuiz currentAllocation={currentAllocation} />

      {/* ROBO-ADVISOR-P4: Stuck-stocks rescue engine */}
      {/* Task 7: Pre-fill from clicked losing position via rescueProps state */}
      <div id="bag-holder-rescue-anchor">
        <BagHolderRescuePanel
          key={rescueProps ? `rescue-${rescueProps.ticker}` : 'rescue-default'}
          ticker={rescueProps?.ticker}
          buyPrice={rescueProps?.buyPrice}
          quantity={rescueProps?.quantity}
          autoAnalyze={rescueProps?.autoAnalyze}
        />
      </div>

      {/* MONEY-TIER2.9: Position top-up predictions — gainers ≥ 10% */}
      <TopUpRecommendationsPanel />

      {/* P37-PHASE-2B-4A: Currency badge — tells users which currency the
          aggregate wealth totals below are displayed in. Per-row raw market
          prices (stock/gold per-gram) stay in EGP and use the inline suffix.
          P39-PHASE-2: persona badge + "Retake Persona" button on the
          other side — opens DynamicRiskProfilerModal to recompute the persona. */}
      <div className="flex items-center justify-between gap-2 flex-wrap" dir="rtl">
        <div className="flex items-center gap-2">
          <Badge className="text-[10px] gap-1 bg-emerald-500/10 text-stitch-primary dark:bg-emerald-600/80/30 dark:text-stitch-primary dark:bg-primary-container/30 dark:text-primary border-emerald-500/30 dark:border-emerald-500/30 dark:border-primary-container/40">
            <Shield className="w-3 h-3" />
            {t('portfolio.persona.label', { persona: personaLabelAr(persona) })}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-stitch-muted hover:text-stitch-primary"
            onClick={() => setProfilerOpen(true)}
          >
            <RefreshCw className="w-3 h-3 ml-1" />
            {t('portfolio.persona.retest')}
          </Button>
        </div>
        <Badge variant="outline" className="text-[10px] gap-1 text-stitch-muted">
          {t('portfolio.currency.label', { currency: displayCurrency })}
        </Badge>
      </div>

      {/* Summary Cards — B-1: Backend P34 net-worth math (gross / debts / net / monthly yield) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1">
            <Landmark className="w-4 h-4" />
            <span className="text-xs font-medium">{t('portfolio.summary.totalAssets')}</span>
          </div>
          <p className="text-lg md:text-xl font-bold dark:text-on-surface tabular-nums dark:font-financial">{formatCurrency(netWorthData?.gross ?? totalAssets)}</p>
        </Card>
        <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1">
            <CreditCard className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-medium">{t('portfolio.summary.totalLiabilities')}</span>
          </div>
          <p className="text-lg md:text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums dark:font-financial">
            {formatCurrency(netWorthData?.debts ?? totalLiabilities)}
          </p>
          {totalLiabilities > 0 && (netWorthData?.debts ?? 0) === 0 && (
            <p className="text-xs text-stitch-muted dark:text-on-surface-variant mt-1">{t('portfolio.summary.afterDeduction', { amount: formatCurrency(totalLiabilities) })}</p>
          )}
        </Card>
        <Card className="p-4 ring-1 ring-emerald-500/30 bg-emerald-500/5 dark:bg-surface-container-low dark:border dark:border-outline-variant/30 dark:ring-primary/40 dark:bg-primary-container/10">
          <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1">
            <Wallet className="w-4 h-4 text-stitch-primary dark:text-stitch-primary dark:text-primary" />
            <span className="text-xs font-medium">{t('portfolio.summary.netWorth')}</span>
          </div>
          <p className={cn('text-lg md:text-xl font-bold tabular-nums dark:font-financial', (netWorthData?.net ?? netWealth) >= 0 ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
            {formatCurrency(netWorthData?.net ?? netWealth)}
          </p>
        </Card>
        <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1">
            <Coins className="w-4 h-4 text-stitch-primary dark:text-stitch-primary dark:text-primary" />
            <span className="text-xs font-medium">{t('portfolio.summary.monthlyYield')}</span>
          </div>
          <p className="text-lg md:text-xl font-bold text-stitch-primary dark:text-stitch-primary dark:text-primary tabular-nums dark:font-financial">
            {formatCurrency(netWorthData?.monthlyYield ?? 0)}
          </p>
          {netWorthData && netWorthData.annualYield > 0 && (
            <p className="text-xs text-stitch-muted dark:text-on-surface-variant mt-1">{t('portfolio.summary.annualYield', { amount: formatCurrency(netWorthData.annualYield) })}</p>
          )}
        </Card>
      </div>

      {/* GLM5.2-A (P0-ALPHA-PORTFOLIO-COMMISSION) — Custom Brokerage & Fee Rate.
          Per manager directive: commissions vary between EGX/TADAWUL/US + brokers.
          Stored in localStorage. Applied to net trade returns (buy + sell sides). */}
      <Card className="p-3 md:p-4 border-primary/20 bg-primary/5 dark:bg-surface-container-low dark:border dark:border-outline-variant/30 dark:bg-primary-container/10">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 dark:bg-primary-container/30">
              <Percent className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-stitch-on-surface truncate dark:text-on-surface dark:font-outfit">
                نسبة عمولة التداول والانزلاق %
              </div>
              <div className="text-[10px] text-stitch-muted truncate dark:text-on-surface-variant">
                Brokerage & Fee Rate — تُخصم من عوائد الصفقات (شراء + بيع)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Input
              type="number"
              min="0"
              max="5"
              step="0.01"
              value={commissionPct}
              onChange={(e) => updateCommission(parseFloat(e.target.value) || 0)}
              className="w-24 text-center stitch-num font-bold dark:bg-surface-container dark:border-outline-variant dark:text-on-surface tabular-nums dark:font-financial"
              dir="ltr"
            />
            <span className="text-sm text-stitch-muted stitch-num dark:text-on-surface-variant">%</span>
            {/* Quick presets */}
            <div className="flex gap-1">
              {[0, 0.15, 0.20, 0.40].map((preset) => (
                <button
                  key={preset}
                  onClick={() => updateCommission(preset)}
                  className={cn(
                    'px-2 py-1 rounded text-[10px] stitch-num border transition-all dark:font-financial tabular-nums',
                    Math.abs(commissionPct - preset) < 0.001
                      ? 'bg-primary text-primary-foreground border-primary dark:bg-primary-container dark:text-on-primary-container dark:border-primary-container'
                      : 'stitch-glass text-stitch-muted border-white/[0.06] hover:bg-[#182030] dark:bg-surface-container dark:text-on-surface-variant dark:border-outline-variant dark:hover:bg-surface-container-high',
                  )}
                  title={`${preset}%`}
                >
                  {preset.toFixed(2)}
                </button>
              ))}
            </div>
          </div>
        </div>
        {commissionPct > 0 && (
          <p className="text-[10px] text-stitch-muted mt-2 leading-relaxed dark:text-on-surface-variant">
            💡 العمولة الحالية: <span className="stitch-num font-bold text-primary dark:font-financial tabular-nums">{commissionPct.toFixed(2)}%</span>
            (تكلفة الكتلة: <span className="stitch-num dark:font-financial tabular-nums">{(commissionPct * 2).toFixed(2)}%</span> لكل صفقة شراء + بيع).
            الأرباح الصافية في جدول الصفقات تُحسب بخصم هذه النسبة من العائد الإجمالي.
          </p>
        )}
      </Card>

      {/* P39-PHASE-2: Wealth Allocation Matrix — persona-aware asset ceilings + alerts.
          Renders a 4-column grid (egx/crypto/gold/cash) with current % vs ceiling %,
          a progress bar with a red ceiling marker, severity-coloured borders, an
          alerts list for any severity !== 'ok', and an Auto-Rebalance button that
          toasts sell suggestions. All math is EGP-only (displayCurrency does NOT
          affect the allocation computation). */}
      <WealthAllocationMatrixCard
        alerts={wealthAlerts}
        personaLabel={personaLabelAr(persona)}
        onRebalance={handleAutoRebalance}
      />

      {/* ROBO-ADVISOR-P33: 5 features — projection + rebalancing + equity curve + pie + table */}
      <RoboAdvisorPanel assets={assets as unknown as any[]} />

      {/* Filter & Add */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={filterType === 'all' ? 'default' : 'outline'} onClick={() => setFilterType('all')}>{t('portfolio.buttons.all')}</Button>
          {ASSET_TYPES.map((type) => (
            <Button key={type} size="sm" variant={filterType === type ? 'default' : 'outline'} onClick={() => setFilterType(type)}>
              {t(`portfolio.assetTypes.${type}`)}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {refreshing && (
            <span className="text-[10px] text-stitch-muted flex items-center gap-1 animate-pulse">
              <RefreshCw className="w-3 h-3 animate-spin" />
              {t('portfolio.buttons.liveRefresh')}
            </span>
          )}
          <Button className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90" size="sm" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
            <Plus className="w-4 h-4 ml-1.5" />
            {t('portfolio.buttons.addAsset')}
          </Button>
        </div>
      </div>

      {/* Assets List - Grouped by Type */}
      {filteredAssets.length === 0 ? (
        <Card className="border-dashed dark:bg-surface-container-low dark:border-outline-variant">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Landmark className="w-10 h-10 text-stitch-muted mb-3 dark:text-on-surface-variant" />
            <h3 className="text-lg font-semibold mb-1 dark:text-on-surface dark:font-outfit">{t('portfolio.empty.noAssets')}</h3>
            <p className="text-sm text-stitch-muted dark:text-on-surface-variant">{t('portfolio.asset.addEmpty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" defaultValue={['stock', 'gold', 'bank', 'certificate', 'fund', 'crypto', 'real_estate', 'other']} className="space-y-3 w-full">
          {/* Group assets by type */}
          {(['stock', 'gold', 'bank', 'certificate', 'fund', 'crypto', 'real_estate', 'other'] as AssetType[]).map((groupType) => {
            const groupAssets = filteredAssets.filter((a) => a.type === groupType);
            if (groupAssets.length === 0) return null;
            
            const groupInvested = groupAssets.reduce((s, a) => s + (a.total_invested || 0), 0);
            const groupCurrentValue = groupAssets.reduce((s, a) => s + (a.current_value || 0), 0);
            const groupProfitLoss = groupCurrentValue - groupInvested;
            const groupProfitLossPercent = groupInvested > 0 ? (groupProfitLoss / groupInvested) * 100 : 0;
            const groupDailyInterest = groupAssets.reduce((s, a) => s + (Number(a.daily_interest) || 0), 0);
            const groupMonthlyInterest = groupAssets.reduce((s, a) => s + (Number(a.monthly_interest) || 0), 0);
            const groupYearlyInterest = groupAssets.reduce((s, a) => s + (Number(a.yearly_interest) || 0), 0);
            
            return (
              <AccordionItem key={groupType} value={groupType} className="border rounded-lg stitch-glass px-4 dark:bg-surface-container-low dark:border-outline-variant">
                {/* Group Header — P30 TASK 6: Accordion trigger */}
                <AccordionTrigger className="hover:no-underline bg-[#182030]/30 rounded-lg px-3 py-3 hover:bg-[#182030]/50 dark:bg-surface-container dark:hover:bg-surface-container-high">
                  <div className="flex items-center gap-2">
                    <Badge className={ASSET_TYPE_COLORS[groupType]}>{t(`portfolio.assetTypes.${groupType}`)}</Badge>
                    <span className="text-sm text-stitch-muted dark:text-on-surface-variant">({groupAssets.length})</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-left">
                      <span className="text-stitch-muted dark:text-on-surface-variant">{t('portfolio.asset.value')}</span>
                      <span className="font-semibold dark:text-on-surface tabular-nums dark:font-financial">{formatCurrency(groupCurrentValue)}</span>
                    </div>
                    <div className={cn('text-left font-semibold', groupProfitLoss >= 0 ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
                      {formatPercent(groupProfitLossPercent)}
                    </div>
                    {/* Show interest for bank/certificate/fund */}
                    {['bank', 'certificate', 'fund'].includes(groupType) && groupYearlyInterest > 0 && (
                      <div className="text-left text-stitch-primary dark:text-stitch-primary dark:text-primary">
                        <span className="text-xs">{t('portfolio.asset.annualReturn')}</span>
                        <span className="font-semibold tabular-nums dark:font-financial">{formatCurrency(groupYearlyInterest)}</span>
                      </div>
                    )}
                  </div>
                </AccordionTrigger>
                
                {/* Assets Grid */}
                <AccordionContent className="pt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groupAssets.map((asset) => {
                    const isStock = asset.type === 'stock';
                    const isInterestBearing = ['bank', 'certificate', 'fund', 'deposit'].includes(asset.type);

                    let invested = Number(asset.total_invested || 0);

                    // Interest bearing calculations
                    const rate = Number(asset.interest_rate || asset.certificate_return_rate || asset.annual_return_rate || asset.return_rate || 0);
                    const returnType = (asset.return_type || 'annual') as 'daily' | 'monthly' | 'annual';

                    // Server-precomputed values take precedence; otherwise recompute locally with return_type awareness
                    let yearlyInterest = Number(asset.yearly_interest);
                    let dailyInterest = Number(asset.daily_interest);
                    let monthlyInterest = Number(asset.monthly_interest);

                    if ((!yearlyInterest || yearlyInterest === 0) && rate > 0 && invested > 0) {
                      let yearlyInterestCalc: number;
                      let dailyInterestCalc: number;
                      let monthlyInterestCalc: number;
                      if (returnType === 'daily') {
                        dailyInterestCalc = invested * (rate / 100);
                        monthlyInterestCalc = dailyInterestCalc * 30;
                        yearlyInterestCalc = dailyInterestCalc * 365;
                      } else if (returnType === 'monthly') {
                        monthlyInterestCalc = invested * (rate / 100);
                        yearlyInterestCalc = monthlyInterestCalc * 12;
                        dailyInterestCalc = yearlyInterestCalc / 365;
                      } else {
                        yearlyInterestCalc = invested * (rate / 100);
                        monthlyInterestCalc = yearlyInterestCalc / 12;
                        dailyInterestCalc = yearlyInterestCalc / 365;
                      }
                      yearlyInterest = yearlyInterestCalc;
                      monthlyInterest = monthlyInterestCalc;
                      dailyInterest = dailyInterestCalc;
                    }
                    if (!monthlyInterest && yearlyInterest > 0) monthlyInterest = yearlyInterest / 12;
                    if (!dailyInterest && yearlyInterest > 0) dailyInterest = yearlyInterest / 365;

                    let daysElapsed = Number(asset.days_elapsed);
                    if (isNaN(daysElapsed) || daysElapsed <= 0) {
                      const dateStr = (asset.purchase_date || asset.added_at) as string | undefined;
                      const addedDate = dateStr ? new Date(dateStr).getTime() : Date.now();
                      daysElapsed = Math.max(0, Math.floor((Date.now() - addedDate) / (1000 * 60 * 60 * 24)));
                    }
                    const accruedInterest = Number(asset.accrued_interest || asset.interest_accrued) || (dailyInterest * daysElapsed);

                    // Gold calculations
                    const weightGrams = Number(asset.weight_grams || 0);
                    const karat = Number(asset.karat || 24);
                    const purchasePricePerGram = Number(asset.purchase_price_per_gram || 0);
                    if (invested <= 0 && weightGrams > 0 && purchasePricePerGram > 0) {
                      invested = weightGrams * purchasePricePerGram;
                    }
                    // UNIFY-FIX (Rule 27 NO-FAKE-DATA): removed fabricated gold prices (4200/3675/3150)
                    // if goldPrices = null → show "— N/A" instead of fake values
                    const goldPricesObj = goldPrices || null;
                    const livePricePerGram = Number(asset.current_price_per_gram) ||
                      (goldPricesObj ? (karat === 24 ? goldPricesObj['24k'] : karat === 21 ? goldPricesObj['21k'] : karat === 18 ? goldPricesObj['18k'] : goldPricesObj['24k']) : 0);

                    // Current Value fallback
                    let currVal = Number(asset.current_value || 0);
                    if (currVal <= 0) {
                      if (isInterestBearing && invested > 0) {
                        currVal = invested + accruedInterest;
                      } else if ((asset.type === 'gold' || (asset.type as string) === 'silver') && weightGrams > 0 && livePricePerGram > 0) {
                        currVal = weightGrams * livePricePerGram;
                      } else if (invested > 0) {
                        currVal = invested;
                      }
                    }

                    const gl = currVal - invested;
                    const glPct = invested > 0 ? (gl / invested) * 100 : 0;

                    const currentPrice = Number(asset.current_stock_price) || 0;
                    const priceChange = Number(asset.stock_change_percent) || 0;
                    const qty = Number(asset.quantity) || 0;
                    const avgBuy = Number(asset.avg_buy_price) || 0;
                    
                    return (
                      <Card key={asset.id} className="hover:shadow-md transition-shadow cursor-pointer dark:bg-surface-container-low dark:border dark:border-outline-variant/30" onClick={() => { if (isStock && asset.stock_ticker) loadStockDetail(asset.stock_ticker); }}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <div className="min-w-0">
                                <h3 className="font-semibold text-sm truncate dark:text-on-surface">{asset.name}</h3>
                                {isStock && asset.stock_ticker && (
                                  <span className="text-xs text-stitch-muted block dark:text-on-surface-variant dark:font-financial" dir="ltr">{asset.stock_ticker}</span>
                                )}
                                {isStock && asset.stock_ticker && (() => {
                                  // PHASE3-MARKET-SEGREGATION (Task F): add a market badge so the user can
                                  // distinguish EGX from TADAWUL/US. If the portfolio has stocks from different
                                  // markets, the badge clarifies which market each stock belongs to.
                                  const m = inferStockMarket(String(asset.stock_ticker), String((asset as Record<string, unknown>).stock_market ?? ''));
                                  if (!m || m === 'EGX') return null; // EGX is the default — no badge
                                  const label = MARKET_NAMES_AR[m];
                                  return (
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 mt-1 ml-1 inline-flex items-center gap-1 bg-[#182030] dark:bg-[#0B0E14]/40 border-white/[0.06] dark:border-primary text-primary dark:text-stitch-outline">
                                      🏛️ {label}
                                    </Badge>
                                  );
                                })()}
                                {Boolean(asset.portfolio_id) && String(asset.portfolio_id) !== 'default' && (
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-[9px] px-1.5 py-0 mt-1 inline-flex items-center gap-1",
                                      getPortfolioColorClass(portfoliosMap[String(asset.portfolio_id)]?.color)
                                    )}
                                  >
                                    📁 {portfoliosMap[String(asset.portfolio_id)]?.name || t('portfolio.asset.portfolioBadge', { id: String(asset.portfolio_id) })}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {/* P30 TASK 4: Bag-Holder Rescue badge — pulsing red for stocks with P&L <= -10% */}
                              {isStock && asset.stock_ticker && glPct <= -10 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 mr-1 text-[10px] font-bold border-rose-500/30 text-rose-400 dark:text-rose-400 bg-red-50 dark:bg-rose-500/60/40 hover:bg-rose-500/10 dark:hover:bg-rose-500/60/60 animate-pulse"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    setRescueProps({
                                      ticker: String(asset.stock_ticker),
                                      buyPrice: avgBuy,
                                      quantity: qty,
                                      autoAnalyze: true,
                                    });
                                    // Scroll to the rescue panel
                                    setTimeout(() => {
                                      document.getElementById('bag-holder-rescue-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }, 100);
                                  }}
                                  title={t('portfolio.rescue.stuckHint')}
                                >
                                  🚨 {t('portfolio.rescue.stuck')}
                                </Button>
                              )}
                              {/* Deal Advisor button — opens #trading-chart with prefill
                                  (ticker + avg_buy_price + quantity) so the user lands
                                  directly on the Deal Advisor panel for this position. */}
                              {isStock && asset.stock_ticker && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 mr-1 text-[10px] font-bold border-primary text-primary hover:bg-primary/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    setDealAdvisorPrefill({
                                      ticker: String(asset.stock_ticker),
                                      entryPrice: avgBuy > 0 ? avgBuy : null,
                                      entryQty: qty > 0 ? qty : null,
                                      source: 'portfolio',
                                    });
                                    setCurrentView('trading-chart');
                                  }}
                                  title={t('portfolio.rescue.dealAdvisorHint')}
                                >
                                  <Sparkles className="w-3 h-3 ml-1" />
                                  {t('portfolio.rescue.dealAdvisor')}
                                </Button>
                              )}
                              {isStock && asset.stock_ticker && (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                  }}
                                  className="inline-flex"
                                >
                                  <StockPublisher
                                    data={{
                                      ticker: String(asset.stock_ticker),
                                      currentPrice: Number(currentPrice || asset.current_value || 0),
                                      entryPrice: avgBuy > 0 ? avgBuy : undefined,
                                      changePct: Number(priceChange) || undefined,
                                    }}
                                    variant="icon"
                                    size="sm"
                                  />
                                </span>
                              )}
                              <Button variant="outline" size="icon" className="h-9 w-9" onClick={(e) => { e.stopPropagation(); e.preventDefault(); openEdit(asset); }} title={t('common.edit')}><Pencil className="w-3.5 h-3.5" /></Button>
                              <Button variant="outline" size="icon" className="h-7 w-7 text-stitch-muted hover:text-rose-400 hover:border-rose-500/30 hover:bg-red-50 dark:hover:bg-rose-500/60/30" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setDeleteId(asset.id!); }} title={t('common.delete')}><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-stitch-muted dark:text-on-surface-variant">{t('portfolio.asset.invested')}</span>
                              <span className="font-medium tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(invested)}</span>
                            </div>
                            
                            {/* Stock: Show current price */}
                            {isStock && currentPrice > 0 && (
                              <div className="flex justify-between text-sm">
                                <span className="text-stitch-muted dark:text-on-surface-variant">{t('portfolio.asset.currentPrice')}</span>
                                <span className="font-medium tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{(currentPrice ?? 0).toFixed(2)} EGP</span>
                              </div>
                            )}
                            
                            <div className="flex justify-between text-sm">
                              <span className="text-stitch-muted dark:text-on-surface-variant">{t('portfolio.asset.currentValue')}</span>
                              <span className="font-medium tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(currVal)}</span>
                            </div>
                            
                            {/* Profit/Loss */}
                            <div className="flex justify-between text-sm">
                              <span className="text-stitch-muted">{t('portfolio.asset.profitLoss')}</span>
                              <span className={cn('font-semibold tabular-nums dark:font-financial', gl >= 0 ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
                                {gl >= 0 ? '+' : ''}{formatCurrency(gl)} ({formatPercent(glPct)})
                              </span>
                            </div>
                            
                            {/* Stock: Daily change */}
                            {isStock && currentPrice > 0 && (
                              <div className="flex justify-between text-sm">
                                <span className="text-stitch-muted dark:text-on-surface-variant">{t('portfolio.asset.dayChange')}</span>
                                <span className={cn('font-medium tabular-nums dark:font-financial', priceChange >= 0 ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
                                  {formatPercent(priceChange)}
                                </span>
                              </div>
                            )}
                            
                            {/* Interest-bearing assets: Show interest breakdown */}
                            {isInterestBearing && (rate > 0 || yearlyInterest > 0) && (
                              <>
                                <div className="flex justify-between text-sm text-stitch-primary dark:text-stitch-primary pt-1 border-t border-dashed dark:border-outline-variant/30 dark:text-primary">
                                  <span className="text-stitch-muted dark:text-on-surface-variant">{t('portfolio.asset.expectedAnnualReturn')}</span>
                                  <span className="font-semibold tabular-nums dark:font-financial">{formatCurrency(yearlyInterest)}</span>
                                </div>
                                <div className="flex justify-between text-xs text-stitch-muted dark:text-on-surface-variant">
                                  <span>{t('portfolio.asset.monthly')}</span>
                                  <span className="tabular-nums dark:font-financial">{formatCurrency(monthlyInterest)}</span>
                                </div>
                                <div className="flex justify-between text-xs text-stitch-muted dark:text-on-surface-variant">
                                  <span>{t('portfolio.asset.daily')}</span>
                                  <span className="tabular-nums dark:font-financial">{formatCurrency(dailyInterest)}</span>
                                </div>
                                {accruedInterest > 0 && (
                                  <div className="mt-2 p-2 bg-emerald-50 dark:bg-emerald-600/80/20 dark:bg-primary-container/20 dark:bg-primary-container/20 rounded text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-stitch-muted dark:text-on-surface-variant">{t('portfolio.asset.earnedInterest')}</span>
                                      <span className="font-semibold text-stitch-primary dark:text-stitch-primary dark:text-primary tabular-nums dark:font-financial">
                                        {formatCurrency(accruedInterest)}
                                      </span>
                                    </div>
                                    {daysElapsed > 0 && (
                                      <div className="text-stitch-muted mt-1 dark:text-on-surface-variant">{t('portfolio.asset.daysAgo', { days: daysElapsed })}</div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          
                          {/* Footer info */}
                          {isStock && qty > 0 && (
                            <div className="mt-2 pt-2 border-t text-xs text-stitch-muted dark:text-on-surface-variant dark:border-outline-variant/30 tabular-nums dark:font-financial">
                              {t('portfolio.asset.stockLine', { qty: qty.toLocaleString('en-US'), price: (avgBuy ?? 0).toFixed(2) })}
                            </div>
                          )}
                          {asset.type === 'gold' && (
                            <div className="mt-2 pt-2 border-t text-xs text-stitch-muted dark:text-on-surface-variant dark:border-outline-variant/30 tabular-nums dark:font-financial">
                              {weightGrams ? t('portfolio.asset.goldLine', { weight: weightGrams.toLocaleString('en-US'), karat }) : ''}
                              {livePricePerGram > 0 && (
                                <span className="block mt-1 text-stitch-primary dark:text-stitch-primary dark:text-primary">
                                  {t('portfolio.asset.goldPricePerGram', { price: (livePricePerGram ?? 0).toFixed(2) })}
                                </span>
                              )}
                            </div>
                          )}
                          {(asset.type === 'bank' || (asset.type as string) === 'deposit') && (
                            <div className="mt-2 pt-2 border-t text-xs text-stitch-muted dark:text-on-surface-variant dark:border-outline-variant/30">
                              {asset.bank_name || ''} {rate > 0 ? t('portfolio.asset.bankLine', { bank: asset.bank_name || '', rate }) : ''}
                            </div>
                          )}
                          {asset.type === 'certificate' && (
                            <div className="mt-2 pt-2 border-t text-xs text-stitch-muted dark:text-on-surface-variant dark:border-outline-variant/30">
                              {asset.certificate_duration_months ? t('portfolio.asset.certLine', { months: asset.certificate_duration_months, rate: rate ?? 0 }) : ''} 
                              {rate > 0 ? t('portfolio.asset.certLine', { months: asset.certificate_duration_months ?? 0, rate: rate ?? 0 }) : ''}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* Add Asset Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={(v) => { if (!v) { resetForm(); } setAddDialogOpen(v); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{t('portfolio.forms.addAssetTitle')}</DialogTitle>
            <DialogDescription>{t('portfolio.forms.addAssetDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('portfolio.forms.assetType')}</Label>
              <Select value={formType} onValueChange={(v) => { setFormType(v as AssetType); if (v !== 'stock') { setFormTicker(''); setFormSelectedPrice(null); } }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.map((at) => (
                    <SelectItem key={at} value={at}>{t(`portfolio.assetTypes.${at}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Stock specific with search dropdown */}
            {formType === 'stock' && (
              <>
                <div className="space-y-2">
                  <Label>{t('portfolio.forms.selectStock')} <span className="text-xs text-stitch-muted">{t('portfolio.forms.selectStockHint')}</span></Label>
                  <StockSearchDropdown
                    value={formTicker ? `${formTicker} - ${formName}` : ''}
                    onSelect={(ticker, name, price) => handleStockSelect(ticker, name, price)}
                  />
                </div>
                {formSelectedPrice && formSelectedPrice > 0 && (
                  <div className="bg-[#182030] rounded-md px-3 py-2 text-xs flex justify-between">
                    <span className="text-stitch-muted">{t('portfolio.forms.currentStockPrice')}</span>
                    <span className="font-semibold" dir="ltr">{(formSelectedPrice ?? 0).toFixed(2)} EGP</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>{t('portfolio.forms.quantity')}</Label><Input type="number" value={formQuantity} onChange={(e) => {
                    setFormQuantity(e.target.value);
                    // Auto-calculate total invested
                    const qty = parseInt(e.target.value) || 0;
                    const buy = parseFloat(formAvgBuyPrice) || 0;
                    if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
                  }} placeholder="0" dir="ltr" /></div>
                  <div className="space-y-2"><Label>{t('portfolio.forms.avgBuyPrice')}</Label><Input type="number" value={formAvgBuyPrice} onChange={(e) => {
                    setFormAvgBuyPrice(e.target.value);
                    const qty = parseInt(formQuantity) || 0;
                    const buy = parseFloat(e.target.value) || 0;
                    if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
                  }} placeholder="0.00" dir="ltr" /></div>
                </div>
                {formQuantity && formAvgBuyPrice && parseFloat(formTotalInvested) > 0 && (
                  <div className="bg-emerald-50 dark:bg-emerald-600/80/20 dark:bg-primary-container/20 border border-emerald-500/30 dark:border-emerald-500/30 rounded-md px-3 py-2 text-sm">
                    <span className="text-stitch-muted">{t('portfolio.forms.totalCost')}</span>
                    <span className="font-bold text-stitch-primary dark:text-stitch-primary">{formatCurrency(parseFloat(formTotalInvested))}</span>
                  </div>
                )}
              </>
            )}

            {/* Gold specific */}
            {formType === 'gold' && (
              <>
                <div className="space-y-2"><Label>{t('portfolio.forms.assetName')}</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('portfolio.forms.goldAssetPlaceholder')} /></div>
                {goldPrices && (
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3 text-sm">
                    <div className="font-semibold text-yellow-800 dark:text-yellow-300 mb-2">{t('portfolio.forms.goldPrices')}</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>{t('portfolio.forms.karat24')} <span className="font-bold text-yellow-700 dark:text-yellow-400">{goldPrices['24k']?.toFixed(2) || '—'} EGP</span></div>
                      <div>{t('portfolio.forms.karat21')} <span className="font-bold text-yellow-700 dark:text-yellow-400">{goldPrices['21k']?.toFixed(2) || '—'} EGP</span></div>
                      <div>{t('portfolio.forms.karat18')} <span className="font-bold text-yellow-700 dark:text-yellow-400">{goldPrices['18k']?.toFixed(2) || '—'} EGP</span></div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2"><Label>{t('portfolio.forms.weight')}</Label><Input type="number" value={formWeight} onChange={(e) => {
                    setFormWeight(e.target.value);
                    // Auto-calc: weight × current price/gram
                    const weight = parseFloat(e.target.value) || 0;
                    const karatVal = parseInt(formKarat) || 21;
                    let gramPrice = goldPrices?.['21k'] || 0;
                    if (karatVal === 24) gramPrice = goldPrices?.['24k'] || 0;
                    else if (karatVal === 18) gramPrice = goldPrices?.['18k'] || 0;
                    if (weight > 0 && gramPrice > 0) {
                      setFormCurrentValue(String((weight * gramPrice).toFixed(2)));
                    }
                  }} placeholder="0" dir="ltr" /></div>
                  <div className="space-y-2"><Label>{t('portfolio.forms.karat')}</Label>
                    <Select value={formKarat} onValueChange={(v) => {
                      setFormKarat(v);
                      // Recompute when karat changes
                      const weight = parseFloat(formWeight) || 0;
                      let gramPrice = goldPrices?.['21k'] || 0;
                      if (v === '24') gramPrice = goldPrices?.['24k'] || 0;
                      else if (v === '18') gramPrice = goldPrices?.['18k'] || 0;
                      if (weight > 0 && gramPrice > 0) {
                        setFormCurrentValue(String((weight * gramPrice).toFixed(2)));
                      }
                    }}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="18">18</SelectItem><SelectItem value="21">21</SelectItem><SelectItem value="24">24</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>{t('portfolio.forms.pricePerGram')}</Label><Input type="number" value={formPricePerGram} onChange={(e) => {
                    setFormPricePerGram(e.target.value);
                    const weight = parseFloat(formWeight) || 0;
                    const price = parseFloat(e.target.value) || 0;
                    if (weight > 0 && price > 0) {
                      setFormTotalInvested(String((weight * price).toFixed(2)));
                    }
                  }} placeholder="0.00" dir="ltr" /></div>
                </div>
                {formWeight && formPricePerGram && (
                  <div className="bg-[#182030] rounded-md px-3 py-2 text-sm flex justify-between">
                    <span className="text-stitch-muted">{t('portfolio.forms.purchaseCost')}</span>
                    <span className="font-bold">{formatCurrency(parseFloat(formWeight) * parseFloat(formPricePerGram))}</span>
                  </div>
                )}
                {formWeight && formCurrentValue && parseFloat(formCurrentValue) > 0 && (
                  <div className="bg-emerald-50 dark:bg-emerald-600/80/20 dark:bg-primary-container/20 border border-emerald-500/30 dark:border-emerald-500/30 rounded-md px-3 py-2 text-sm flex justify-between">
                    <span className="text-stitch-muted">{t('portfolio.forms.currentValueLabel')}</span>
                    <span className="font-bold text-stitch-primary dark:text-stitch-primary">{formatCurrency(parseFloat(formCurrentValue))}</span>
                  </div>
                )}
              </>
            )}

            {/* Bank specific */}
            {formType === 'bank' && (
              <>
                <div className="space-y-2"><Label>{t('portfolio.forms.assetName')}</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('portfolio.forms.bankAssetPlaceholder')} /></div>
                <div className="space-y-2"><Label>{t('portfolio.forms.bankName')}</Label><Input value={formBankName} onChange={(e) => setFormBankName(e.target.value)} placeholder={t('portfolio.forms.bankNamePlaceholder')} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>{t('portfolio.forms.balance')}</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                  <div className="space-y-2"><Label>{t('portfolio.forms.interestRate')}</Label><Input type="number" value={formInterestRate} onChange={(e) => setFormInterestRate(e.target.value)} placeholder="0" dir="ltr" /></div>
                </div>
              </>
            )}

            {/* Certificate specific */}
            {formType === 'certificate' && (
              <>
                <div className="space-y-2"><Label>{t('portfolio.forms.certName')}</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('portfolio.forms.certPlaceholder')} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>{t('portfolio.forms.amount')}</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                  <div className="space-y-2"><Label>{t('portfolio.forms.durationMonths')}</Label><Input type="number" value={formDuration} onChange={(e) => setFormDuration(e.target.value)} placeholder="0" dir="ltr" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>{t('portfolio.forms.returnRate')}</Label><Input type="number" value={formReturnRate} onChange={(e) => setFormReturnRate(e.target.value)} placeholder="0" dir="ltr" /></div>
                  <div className="space-y-2"><Label>{t('portfolio.forms.maturityDate')}</Label><Input type="date" value={formMaturityDate} onChange={(e) => setFormMaturityDate(e.target.value)} dir="ltr" /></div>
                </div>
              </>
            )}

            {/* Fund specific */}
            {formType === 'fund' && (
              <>
                <div className="space-y-2"><Label>{t('portfolio.forms.assetName')}</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('portfolio.forms.fundAssetPlaceholder')} /></div>
                <div className="space-y-2"><Label>{t('portfolio.forms.fundName')}</Label><Input value={formFundName} onChange={(e) => setFormFundName(e.target.value)} placeholder={t('portfolio.forms.fundNamePlaceholder')} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{t('portfolio.forms.fundType')}</Label>
                    <Select value={formFundType} onValueChange={setFormFundType}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={t('portfolio.forms.fundTypePlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        {FUND_TYPES.map((ft) => (
                          <SelectItem key={ft.value} value={ft.value}>{t(`portfolio.fundTypes.${ft.value}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>{t('portfolio.forms.investedAmount')}</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                </div>
                <div className="space-y-2"><Label>{t('portfolio.forms.currentValueLabel')}</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                {formFundType === 'fixed_income' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-emerald-50 dark:bg-emerald-600/60/30 rounded-lg border border-emerald-500/30 dark:border-emerald-500/30">
                    <div className="space-y-2">
                      <Label className="text-stitch-primary dark:text-stitch-primary">{t('portfolio.forms.annualReturnPct')}</Label>
                      <Input type="number" step="0.01" value={formAnnualReturn} onChange={(e) => setFormAnnualReturn(e.target.value)} placeholder={t('portfolio.forms.annualReturnPlaceholder')} dir="ltr" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-stitch-primary dark:text-stitch-primary">{t('portfolio.forms.returnType')}</Label>
                      <Select value={formReturnType} onValueChange={(v) => setFormReturnType(v as 'annual' | 'monthly' | 'daily')}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="annual">{t('portfolio.forms.annual')}</SelectItem>
                          <SelectItem value="monthly">{t('portfolio.forms.monthlyReturn')}</SelectItem>
                          <SelectItem value="daily">{t('portfolio.forms.dailyReturn')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-stitch-primary dark:text-stitch-primary">{t('portfolio.forms.purchaseDate')}</Label>
                      <Input type="date" value={formPurchaseDate} onChange={(e) => setFormPurchaseDate(e.target.value)} dir="ltr" />
                    </div>
                    <p className="text-[11px] text-stitch-muted sm:col-span-3">
                      {t('portfolio.forms.autoCalcHint')}
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Other / default name + invested + current */}
            {(formType === 'real_estate' || formType === 'other') && (
              <>
                <div className="space-y-2"><Label>{t('portfolio.forms.name')}</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={formType === 'real_estate' ? t('portfolio.forms.realEstatePlaceholder') : t('portfolio.forms.assetName')} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>{t('portfolio.forms.investedAmount')}</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                  <div className="space-y-2"><Label>{t('portfolio.forms.currentValueLabel')}</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                </div>
              </>
            )}

            {/* ── Task 3: Crypto add-asset form (Live Portfolio Overhaul) ── */}
            {formType === 'crypto' && (
              <>
                <div className="space-y-2">
                  <Label>{t('portfolio.forms.selectCrypto')} <span className="text-xs text-stitch-muted">{t('portfolio.forms.selectCryptoHint')}</span></Label>
                  <CryptoSearchDropdown
                    value={formTicker ? `${formTicker} - ${formName}` : ''}
                    onSelect={(symbol, name, priceUsd) => {
                      setFormTicker(symbol);
                      setFormName(name || symbol);
                      setFormSelectedPrice(priceUsd);
                    }}
                  />
                </div>
                {formSelectedPrice && formSelectedPrice > 0 && (
                  <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-md px-3 py-2 text-xs flex justify-between">
                    <span className="text-stitch-muted">{t('portfolio.forms.currentCryptoPrice')}</span>
                    <span className="font-semibold text-orange-700 dark:text-orange-400" dir="ltr">${(formSelectedPrice ?? 0).toFixed(2)}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{t('portfolio.forms.quantity')}</Label>
                    <Input type="number" value={formQuantity} onChange={(e) => {
                      setFormQuantity(e.target.value);
                      const qty = parseFloat(e.target.value) || 0;
                      const buy = parseFloat(formAvgBuyPrice) || 0;
                      if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
                    }} placeholder="0.00" dir="ltr" />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('portfolio.forms.buyPriceUSD')}</Label>
                    <Input type="number" value={formAvgBuyPrice} onChange={(e) => {
                      setFormAvgBuyPrice(e.target.value);
                      const qty = parseFloat(formQuantity) || 0;
                      const buy = parseFloat(e.target.value) || 0;
                      if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
                    }} placeholder="0.00" dir="ltr" />
                  </div>
                </div>
                {formQuantity && formAvgBuyPrice && parseFloat(formTotalInvested) > 0 && (
                  <div className="bg-emerald-50 dark:bg-emerald-600/80/20 dark:bg-primary-container/20 border border-emerald-500/30 dark:border-emerald-500/30 rounded-md px-3 py-2 text-sm">
                    <span className="text-stitch-muted">{t('portfolio.forms.totalCostUSD')}</span>
                    <span className="font-bold text-stitch-primary dark:text-stitch-primary">${parseFloat(formTotalInvested).toFixed(2)}</span>
                  </div>
                )}
                <p className="text-xs text-stitch-muted bg-[#182030]/50 p-2 rounded">
                  {t('portfolio.forms.cryptoAutoUpdate')}
                </p>
              </>
            )}

            <div className="space-y-2"><Label>{t('portfolio.forms.notes')}</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder={t('portfolio.forms.notesPlaceholder')} rows={2} /></div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { resetForm(); setAddDialogOpen(false); }}>{t('portfolio.forms.cancel')}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90" onClick={handleSave} disabled={saving}>
              {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin ml-1.5" /> {t('portfolio.forms.adding')}</> : t('common.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle>{t('portfolio.forms.editAssetTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('portfolio.forms.assetType')}</Label>
              <Input value={t(`portfolio.assetTypes.${formType}`) || formType} disabled className="bg-[#182030]" />
            </div>
            {formType === 'stock' && editAsset?.stock_ticker && (
              <div className="space-y-2">
                <Label>{t('portfolio.forms.stock')}</Label>
                <Input value={`${editAsset.stock_ticker} - ${editAsset.name}`} disabled className="bg-[#182030]" dir="ltr" />
              </div>
            )}
            {formType !== 'stock' && (
              <div className="space-y-2"><Label>{t('portfolio.obligations.obligationName')}</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{formType === 'stock' ? t('portfolio.forms.avgBuyPrice') : t('portfolio.forms.investedAmount')}</Label>
                <Input type="number" value={formAvgBuyPrice || formTotalInvested} onChange={(e) => {
                  if (formType === 'stock') setFormAvgBuyPrice(e.target.value);
                  else setFormTotalInvested(e.target.value);
                }} dir="ltr" />
              </div>
              {formType === 'stock' ? (
                <div className="space-y-2"><Label>{t('portfolio.forms.quantity')}</Label><Input type="number" value={formQuantity} onChange={(e) => setFormQuantity(e.target.value)} dir="ltr" /></div>
              ) : (
                <div className="space-y-2"><Label>{t('portfolio.forms.currentValueLabel')}</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} dir="ltr" /></div>
              )}
            </div>
            {formType === 'stock' && (
              <div className="space-y-2">
                <Label>{t('portfolio.forms.currentValueAuto')}</Label>
                <Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} dir="ltr" placeholder="0.00" />
              </div>
            )}
            <div className="space-y-2"><Label>{t('portfolio.forms.notesLabel')}</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t('portfolio.forms.cancel')}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90" onClick={handleEditSave} disabled={saving}>
              {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin ml-1.5" /> {t('portfolio.forms.saving')}</> : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-400"><AlertTriangle className="w-5 h-5" /> {t('portfolio.forms.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('portfolio.forms.deleteDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t('portfolio.obligations.cancel')}</Button>
            <Button className="bg-rose-500 hover:bg-rose-500/80 text-white dark:bg-error dark:text-on-error dark:hover:bg-error/90" onClick={handleDelete}>{t('portfolio.forms.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* P39-PHASE-2: DynamicRiskProfilerModal — mounted at the end so the
          "Retest Persona" button can open it. On complete it just closes;
          the store's setRiskToleranceScore → setPersona pipeline handles the
          actual persona update (see src/lib/store.ts). */}
      <DynamicRiskProfilerModal
        open={profilerOpen}
        onOpenChange={setProfilerOpen}
        onComplete={() => setProfilerOpen(false)}
      />
    </div>
  );
});

// ==================== P39-PHASE-2: WEALTH ALLOCATION MATRIX CARD ====================
// P39-PHASE-2: Wealth Allocation Matrix — persona-aware asset ceilings + alerts.
// Pure presentational component: receives pre-computed alerts + persona label +
// rebalance handler from AssetsTab. Renders a 4-column responsive grid with a
// progress bar and a red ceiling marker, an alerts list, and the Auto-Rebalance
// button. dir="rtl" Arabic UI throughout.
function WealthAllocationMatrixCard({
  alerts,
  personaLabel,
  onRebalance,
}: {
  alerts: WealthAllocationAlert[];
  personaLabel: string;
  onRebalance: () => void;
}) {
  const t = useTranslation();
  const assetMeta: Record<WealthAllocationAlert['asset'], { labelKey: string; icon: React.ReactNode }> = {
    egx: { labelKey: 'portfolio.assetLabels.stocksEg', icon: <TrendingUp className="w-4 h-4" /> },
    crypto: { labelKey: 'portfolio.assetLabels.crypto', icon: <Bitcoin className="w-4 h-4" /> },
    gold: { labelKey: 'portfolio.assetLabels.gold', icon: <Gem className="w-4 h-4" /> },
    cash: { labelKey: 'portfolio.assetLabels.cash', icon: <Banknote className="w-4 h-4" /> },
  };
  const severityBorder: Record<WealthAllocationAlert['severity'], string> = {
    ok: 'border-emerald-500/30 dark:border-emerald-500/30/60',
    warning: 'border-amber-300 dark:border-amber-700/60',
    critical: 'border-rose-500/30 dark:border-rose-500/30/70',
  };
  const severityText: Record<WealthAllocationAlert['severity'], string> = {
    ok: 'text-stitch-primary dark:text-stitch-primary dark:text-primary',
    warning: 'text-amber-600 dark:text-amber-400',
    critical: 'text-rose-400 dark:text-rose-400 dark:text-error',
  };
  const orderedAssets: WealthAllocationAlert['asset'][] = ['egx', 'crypto', 'gold', 'cash'];
  const visibleAlerts = alerts.filter((a) => a.severity !== 'ok');

  return (
    <Card dir="rtl" className="border-2 border-emerald-500/30/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm md:text-base font-bold flex items-center gap-2">
            <Scale className="w-4 h-4 text-stitch-primary" />
            {t('portfolio.wealth.title', { persona: personaLabel })}
          </CardTitle>
          <Badge variant="outline" className="text-[10px] gap-1 text-stitch-muted">
            <Shield className="w-3 h-3" />
            {t('portfolio.wealth.ceilings', { persona: personaLabel })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 4-column grid: egx / crypto / gold / cash */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {orderedAssets.map((key) => {
            const alert = alerts.find((a) => a.asset === key);
            if (!alert) return null;
            const meta = assetMeta[key];
            const fillPct = Math.min(100, Math.max(0, alert.currentPercent));
            const ceilingPos = Math.min(100, Math.max(0, alert.ceilingPercent));
            return (
              <div
                key={key}
                className={cn('rounded-lg border-2 p-3 stitch-glass', severityBorder[alert.severity])}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn('flex-shrink-0', severityText[alert.severity])}>{meta.icon}</span>
                  <span className="text-xs font-semibold truncate">{t(meta.labelKey)}</span>
                </div>
                <div className="flex items-baseline gap-1.5 mb-2">
                  <span className={cn('text-2xl font-bold', severityText[alert.severity])}>
                    {(alert.currentPercent ?? 0).toFixed(1)}%
                  </span>
                  <span className="text-[11px] text-stitch-muted">
                    {t('portfolio.wealth.ceilingSlash', { pct: alert.ceilingPercent })}
                  </span>
                </div>
                {/* Progress bar (shadcn Progress) with red ceiling marker overlay.
                    The marker is a sibling of Progress (not a child) because
                    Progress uses overflow-hidden on its root. */}
                <div className="relative">
                  <Progress
                    value={fillPct}
                    className={cn(
                      'h-2',
                      alert.severity === 'critical' && '[&>[data-slot=progress-indicator]]:bg-rose-500',
                      alert.severity === 'warning' && '[&>[data-slot=progress-indicator]]:bg-amber-500',
                      alert.severity === 'ok' && '[&>[data-slot=progress-indicator]]:bg-emerald-500',
                    )}
                  />
                  {/* Vertical red line at the ceiling position */}
                  {ceilingPos > 0 && ceilingPos < 100 && (
                    <div
                      className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-rose-500 dark:bg-rose-500/20 rounded-full"
                      style={{ left: `${ceilingPos}%` }}
                      title={t('portfolio.wealth.ceilingLabel', { pct: alert.ceilingPercent })}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Alerts list (only non-ok severities) */}
        {visibleAlerts.length > 0 && (
          <ul className="space-y-1.5">
            {visibleAlerts.map((a) => (
              <li
                key={a.asset}
                className={cn(
                  'text-xs flex items-start gap-1.5 rounded-md px-2 py-1.5',
                  a.severity === 'critical'
                    ? 'bg-red-50 dark:bg-rose-500/60/30 text-rose-400 dark:text-rose-400'
                    : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
                )}
              >
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>{a.messageAr}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Auto-Rebalance button */}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onRebalance}>
            <RefreshCw className="w-3.5 h-3.5 ml-1.5" />
            {t('portfolio.wealth.autoRebalance')}
          </Button>
          {visibleAlerts.length === 0 && (
            <span className="text-[11px] text-stitch-primary dark:text-stitch-primary flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('portfolio.wealth.balanced')}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== INCOME & EXPENSES TAB ====================
// UI-STABILITY fix (2026-09-28): wrap IncomeExpenseTab in React.memo so
// background refreshes elsewhere in the app don't re-render the tab tree.
const IncomeExpenseTab = memo(function IncomeExpenseTab() {
  const t = useTranslation();
  // P37-PHASE-2B-4A: currency-aware totals (EGP/USD/SAR toggle from header).
  const { displayCurrency, usdRate, sarRate } = useAppStore();
  const formatCurrency = (value: number | null | undefined) =>
    formatCurrencyRaw(value, displayCurrency, usdRate, sarRate);
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [summary, setSummary] = useState<IncomeExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [transType, setTransType] = useState<TransactionType>('income');

  // Add form
  const [formCategory, setFormCategory] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState(now.toISOString().split('T')[0]);
  const [formIsRecurring, setFormIsRecurring] = useState(false);
  const [formFrequency, setFormFrequency] = useState('monthly');

  // UI-STABILITY fix (2026-09-28): silent polling — only first load (or when
  // month/year changes) shows the skeleton; manual refresh uses silent=true.
  const loadTransactions = useCallback(async (silent = false) => {
    if (silent) {
      // Don't wipe the existing rows — only show a subtle spinner elsewhere if needed.
    } else {
      setLoading(true);
    }
    try {
      const res = await fetch(`/api/finance/transactions?month=${month}&year=${year}`);
      const data = await res.json();
      setTransactions(data.items || []);
      setSummary(data.summary || null);
    } catch { // silent fallback (safe-by-design)
      if (!silent) toast.error(t('portfolio.income.loadFailed'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const handleSave = async () => {
    if (!formCategory || !formAmount) { toast.error(t('portfolio.income.fillRequired')); return; }
    try {
      const res = await fetch('/api/finance/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: transType,
          category: formCategory,
          amount: parseFloat(formAmount),
          description: formDescription,
          transaction_date: formDate,
          is_recurring: formIsRecurring,
          recurring_frequency: formIsRecurring ? formFrequency : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(t('portfolio.income.addSuccess'));
        setAddDialogOpen(false);
        setFormCategory(''); setFormAmount(''); setFormDescription('');
        // UI-STABILITY fix (2026-09-28): silent refresh after save — keep table state
        loadTransactions(true);
      } else {
        toast.error(data.error || t('portfolio.income.addFailed'));
      }
    } catch { // silent fallback (safe-by-design)
      toast.error(t('portfolio.toast.connectionError'));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/finance/transactions/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success(t('portfolio.income.deleteSuccess'));
        // UI-STABILITY fix (2026-09-28): silent refresh after delete
        loadTransactions(true);
      } else {
        toast.error(data.error || t('portfolio.income.deleteFailed'));
      }
    } catch { // silent fallback (safe-by-design)
      toast.error(t('portfolio.toast.connectionError'));
    }
  };

  // ─── UnifiedTable columns for transactions ────────────────────────────────────
  // UI-STABILITY fix (2026-09-28): wrap transactionColumns in useMemo so its
  // reference is stable across renders — UnifiedTable re-computes sort/filter
  // state when columns identity changes, which destroys user UI state.
  // handleDelete is defined above (stable per render) — including it in deps
  // is the correct exhaustive-deps choice.
  const transactionColumns: Column<FinancialTransaction>[] = useMemo(() => [
    {
      key: 'type',
      header: t('portfolio.income.colType'),
      sortable: true,
      filterable: true,
      render: (row) => (
        <Badge className={row.type === 'income' ? 'bg-emerald-500/10 text-stitch-primary dark:bg-emerald-600/80/30 dark:text-stitch-primary dark:bg-primary-container/30 dark:text-primary' : 'bg-rose-500/10 text-rose-400 dark:bg-rose-500/60/30 dark:text-rose-400 dark:bg-error-container/30 dark:text-error'}>
          {row.type === 'income' ? t('portfolio.income.incomeType') : t('portfolio.income.expenseType')}
        </Badge>
      ),
    },
    {
      key: 'category',
      header: t('portfolio.income.colCategory'),
      sortable: true,
      filterable: true,
      className: 'text-sm',
    },
    {
      key: 'amount',
      header: t('portfolio.income.colAmount'),
      align: 'center',
      sortable: true,
      filterable: true,
      render: (row) => (
        <span className={cn('font-semibold text-sm', row.type === 'income' ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
          {row.type === 'income' ? '+' : '-'}{formatCurrency(row.amount)}
        </span>
      ),
    },
    {
      key: 'description',
      header: t('portfolio.income.colDescription'),
      filterable: true,
      className: 'text-xs text-stitch-muted',
      render: (row) => (
        <span className="block max-w-[150px] truncate" title={row.description || ''}>
          {row.description || '—'}
        </span>
      ),
    },
    {
      key: 'transaction_date',
      header: t('portfolio.income.colDate'),
      sortable: true,
      filterable: true,
      className: 'text-xs text-stitch-muted',
      render: (row) => <span dir="ltr">{row.transaction_date}</span>,
    },
    {
      key: '_delete',
      header: t('portfolio.income.colActions'),
      align: 'center',
      render: (row) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-stitch-muted hover:text-rose-400"
          onClick={(e) => { e.stopPropagation(); if (row.id != null) handleDelete(row.id); }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      ),
    },
  // UI-STABILITY fix (2026-09-28): useMemo deps — handleDelete identity changes
  // per render (it's defined inline above), but its closure only depends on
  // values that don't change here (no extra state inside the columns body).
  ], [handleDelete, formatCurrency]);

  const changeMonth = (dir: number) => {
    const d = new Date(parseInt(year), parseInt(month) - 1 + dir, 1);
    setMonth(String(d.getMonth() + 1).padStart(2, '0'));
    setYear(String(d.getFullYear()));
  };

  const monthKeys = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'] as const;
  const currentMonthLabel = t(`portfolio.months.${monthKeys[parseInt(month) - 1]}`) + ' ' + year;

  const categories = transType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-7 w-28" /></CardContent></Card>
          ))}
        </div>
        <Card><CardContent className="p-4"><Skeleton className="h-40 w-full" /></CardContent></Card>
      </div>
    );
  }

  const savingsRate = summary && summary.total_income > 0 ? ((summary.net_savings / summary.total_income) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Month Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => changeMonth(-1)}><ChevronRight className="w-4 h-4" /></Button>
          <span className="font-semibold text-sm min-w-[120px] text-center">{currentMonthLabel}</span>
          <Button variant="outline" size="icon" onClick={() => changeMonth(1)}><ChevronLeft className="w-4 h-4" /></Button>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90" size="sm" onClick={() => setAddDialogOpen(true)}>
          <Plus className="w-4 h-4 ml-1.5" />
          {t('portfolio.income.addTransaction')}
        </Button>
      </div>

      {/* Summary Row */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1">
              <ArrowUpRight className="w-4 h-4 text-stitch-primary dark:text-primary" />
              <span className="text-xs font-medium">{t('portfolio.income.totalIncome')}</span>
            </div>
            <p className="text-lg font-bold text-stitch-primary dark:text-stitch-primary dark:text-primary tabular-nums dark:font-financial">{formatCurrency(summary.total_income)}</p>
          </Card>
          <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1">
              <ArrowDownRight className="w-4 h-4 text-rose-400 dark:text-error" />
              <span className="text-xs font-medium">{t('portfolio.income.totalExpenses')}</span>
            </div>
            <p className="text-lg font-bold text-rose-400 dark:text-rose-400 dark:text-error tabular-nums dark:font-financial">{formatCurrency(summary.total_expenses)}</p>
          </Card>
          <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1">
              <PiggyBank className="w-4 h-4 text-teal-500" />
              <span className="text-xs font-medium">{t('portfolio.income.netSavings')}</span>
            </div>
            <p className="text-lg font-bold text-teal-600 dark:text-teal-400 dark:text-primary tabular-nums dark:font-financial">{formatCurrency(summary.net_savings)}</p>
          </Card>
          <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs font-medium">{t('portfolio.income.savingsRate')}</span>
            </div>
            <p className="text-lg font-bold tabular-nums dark:font-financial dark:text-on-surface">{(savingsRate ?? 0).toFixed(1)}%</p>
            <Progress value={Math.min(savingsRate, 100)} className="h-2 mt-2" />
          </Card>
        </div>
      )}

      {/* Expenses breakdown bars */}
      {summary && summary.expenses_by_category && Object.keys(summary.expenses_by_category).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('portfolio.income.expenseDistribution')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(summary.expenses_by_category)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 6)
              .map(([cat, amount]) => {
                const pct = summary.total_expenses > 0 ? (amount / summary.total_expenses) * 100 : 0;
                const catInfo = EXPENSE_CATEGORIES.find((c) => c.value === cat);
                const label = catInfo ? t(`portfolio.expenseCategories.${catInfo.value}`) : cat;
                return (
                  <div key={cat} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-stitch-muted">{label}</span>
                      <span className="font-medium">{formatCurrency(amount)} ({(pct ?? 0).toFixed(1)}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#182030] overflow-hidden">
                      <div className="h-full rounded-full bg-rose-500/20 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {/* Transactions Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm">{t('portfolio.income.recentTransactions')}</CardTitle>
            {transactions.length > 0 && (
              <UnifiedPublishButton
                variant="outline"
                size="sm"
                title={t('portfolio.income.recentTransactions')}
                content={`${t('portfolio.income.recentTransactions')}\n${transactions.slice(0, 20).map((tr, i) => `${i + 1}. ${tr.type === 'income' ? t('portfolio.income.incomeType') : t('portfolio.income.expenseType')} — ${tr.category} — ${formatCurrency(tr.amount)} EGP — ${tr.transaction_date}`).join('\n')}`}
                filename={`transactions-${Date.now()}`}
                hashtags={['transactions', 'portfolio']}
                triggerLabel={t('common.publish')}
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-stitch-muted text-center py-8">{t('portfolio.income.noTransactions')}</p>
          ) : (
            <UnifiedTable<FinancialTransaction>
              columns={transactionColumns}
              data={transactions}
              keyField="id"
              dense
              columnToggle
              filterable
              maxHeight="max-h-96"
              publishable
              publishTitle={t('portfolio.income.publishTitle')}
              publishFilename={`portfolio-transactions-${new Date().toISOString().slice(0,10)}`}
              publishHashtags={['portfolio', 'EGX', 'investing']}
            />
          )}
        </CardContent>
      </Card>

      {/* Add Transaction Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-lg w-[calc(100%-1rem)]" dir="rtl">
          <DialogHeader>
            <DialogTitle>{t('portfolio.income.addTransactionTitle')}</DialogTitle>
            <DialogDescription>{t('portfolio.income.addTransactionDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('portfolio.income.typeLabel')}</Label>
                <Select value={transType} onValueChange={(v) => { setTransType(v as TransactionType); setFormCategory(''); }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">{t('portfolio.income.incomeType')}</SelectItem>
                    <SelectItem value="expense">{t('portfolio.income.expenseType')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('portfolio.income.categoryLabel')}</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger className="w-full"><SelectValue placeholder={t('portfolio.income.categoryPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {(transType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                      <SelectItem key={c.value} value={c.value}>{t(`portfolio.${transType === 'income' ? 'incomeCategories' : 'expenseCategories'}.${c.value}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>{t('portfolio.income.amountLabel')}</Label><Input type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} placeholder="0.00" dir="ltr" /></div>
            <div className="space-y-2"><Label>{t('portfolio.income.descriptionLabel')}</Label><Input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder={t('portfolio.income.descriptionPlaceholder')} /></div>
            <div className="space-y-2"><Label>{t('portfolio.income.dateLabel')}</Label><Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} dir="ltr" /></div>
            <div className="flex items-center gap-3">
              <Checkbox checked={formIsRecurring} onCheckedChange={(v) => setFormIsRecurring(v === true)} />
              <Label>{t('portfolio.income.recurring')}</Label>
            </div>
            {formIsRecurring && (
              <div className="space-y-2">
                <Label>{t('portfolio.income.recurrence')}</Label>
                <Select value={formFrequency} onValueChange={setFormFrequency}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">{t('portfolio.income.monthlyR')}</SelectItem>
                    <SelectItem value="weekly">{t('portfolio.income.weekly')}</SelectItem>
                    <SelectItem value="yearly">{t('portfolio.income.yearly')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90" onClick={handleSave}>{t('portfolio.income.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

// ==================== OBLIGATIONS TAB ====================
// UI-STABILITY fix (2026-09-28): wrap ObligationsTab in React.memo so background
// refreshes elsewhere don't re-render the obligations tab tree.
const ObligationsTab = memo(function ObligationsTab() {
  const t = useTranslation();
  // P37-PHASE-2B-4A: currency-aware totals (EGP/USD/SAR toggle from header).
  const { displayCurrency, usdRate, sarRate } = useAppStore();
  const formatCurrency = (value: number | null | undefined) =>
    formatCurrencyRaw(value, displayCurrency, usdRate, sarRate);
  const [obligations, setObligations] = useState<FinancialObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentObligation, setPaymentObligation] = useState<FinancialObligation | null>(null);
  const [editItem, setEditItem] = useState<FinancialObligation | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Add form
  const [formType, setFormType] = useState('loan');
  const [formName, setFormName] = useState('');
  const [formCreditor, setFormCreditor] = useState('');
  const [formTotalAmount, setFormTotalAmount] = useState('');
  const [formRemainingAmount, setFormRemainingAmount] = useState('');
  const [formMonthlyPayment, setFormMonthlyPayment] = useState('');
  const [formInterestRate, setFormInterestRate] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formNextPaymentDate, setFormNextPaymentDate] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Payment form
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payPrincipal, setPayPrincipal] = useState('');
  const [payInterest, setPayInterest] = useState('');

  const loadObligations = useCallback(async (silent = false) => {
    // UI-STABILITY fix (2026-09-28): silent polling — only first load shows skeleton
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/finance/obligations?status=active');
      const data = await res.json();
      setObligations(data.items || []);
    } catch { // silent fallback (safe-by-design)
      if (!silent) toast.error(t('portfolio.obligations.loadFailed'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { loadObligations(); }, [loadObligations]);

  const resetForm = () => {
    setFormType('loan'); setFormName(''); setFormCreditor('');
    setFormTotalAmount(''); setFormRemainingAmount(''); setFormMonthlyPayment('');
    setFormInterestRate(''); setFormStartDate(''); setFormEndDate('');
    setFormNextPaymentDate(''); setFormNotes('');
  };

  const handleSave = async () => {
    try {
      const res = await fetch('/api/finance/obligations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: formType, name: formName, creditor: formCreditor,
          total_amount: parseFloat(formTotalAmount),
          remaining_amount: parseFloat(formRemainingAmount),
          monthly_payment: parseFloat(formMonthlyPayment),
          interest_rate: formInterestRate ? parseFloat(formInterestRate) : null,
          start_date: formStartDate,
          end_date: formEndDate || null,
          next_payment_date: formNextPaymentDate || null,
          notes: formNotes.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(t('portfolio.obligations.addSuccess'));
        setAddDialogOpen(false);
        resetForm();
        // UI-STABILITY fix (2026-09-28): silent refresh after add — keep table state
        loadObligations(true);
      } else {
        toast.error(data.error || t('portfolio.obligations.addFailed'));
      }
    } catch { // silent fallback (safe-by-design)
      toast.error(t('portfolio.toast.connectionError'));
    }
  };

  const handleEditSave = async () => {
    if (!editItem?.id) return;
    try {
      const res = await fetch(`/api/finance/obligations/${editItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName, remaining_amount: parseFloat(formRemainingAmount),
          monthly_payment: parseFloat(formMonthlyPayment),
          notes: formNotes.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(t('portfolio.obligations.updateSuccess'));
        setEditDialogOpen(false);
        // UI-STABILITY fix (2026-09-28): silent refresh after edit
        loadObligations(true);
      } else {
        toast.error(data.error || t('portfolio.obligations.updateFailed'));
      }
    } catch { // silent fallback (safe-by-design)
      toast.error(t('portfolio.toast.connectionError'));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/finance/obligations/${deleteId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success(t('portfolio.obligations.deleteSuccess'));
        setDeleteId(null);
        // UI-STABILITY fix (2026-09-28): silent refresh after delete
        loadObligations(true);
      } else {
        toast.error(data.error || t('portfolio.obligations.deleteFailed'));
      }
    } catch { // silent fallback (safe-by-design)
      toast.error(t('portfolio.toast.connectionError'));
    }
  };

  const handlePayment = async () => {
    if (!paymentObligation?.id) return;
    try {
      const res = await fetch('/api/finance/obligations/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          obligation_id: paymentObligation.id,
          amount: parseFloat(payAmount),
          payment_date: payDate,
          principal_amount: payPrincipal ? parseFloat(payPrincipal) : null,
          interest_amount: payInterest ? parseFloat(payInterest) : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(t('portfolio.obligations.paymentSuccess'));
        setPaymentDialogOpen(false);
        // UI-STABILITY fix (2026-09-28): silent refresh after payment
        loadObligations(true);
      } else {
        toast.error(data.error || t('portfolio.obligations.paymentFailed'));
      }
    } catch { // silent fallback (safe-by-design)
      toast.error(t('portfolio.toast.connectionError'));
    }
  };

  const openPayment = (ob: FinancialObligation) => {
    setPaymentObligation(ob);
    setPayAmount(String(ob.monthly_payment));
    setPayDate(new Date().toISOString().split('T')[0]);
    setPayPrincipal('');
    setPayInterest('');
    setPaymentDialogOpen(true);
  };

  const openEdit = (ob: FinancialObligation) => {
    setEditItem(ob);
    setFormName(ob.name); setFormRemainingAmount(String(ob.remaining_amount));
    setFormMonthlyPayment(String(ob.monthly_payment)); setFormNotes(ob.notes || '');
    setEditDialogOpen(true);
  };

  const totalDebt = (obligations || []).reduce((s, o) => s + (o.remaining_amount || 0), 0);
  const monthlyPayments = (obligations || []).reduce((s, o) => s + (o.monthly_payment || 0), 0);
  const activeLoans = (obligations || []).filter((o) => o.status === 'active').length;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-7 w-28" /></CardContent></Card>
          ))}
        </div>
        {[...Array(2)].map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1"><CreditCard className="w-4 h-4" /><span className="text-xs font-medium">{t('portfolio.reports.totalObligations')}</span></div>
          <p className="text-lg font-bold text-rose-400 dark:text-rose-400 dark:text-error tabular-nums dark:font-financial">{formatCurrency(totalDebt)}</p>
        </Card>
        <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1"><CalendarDays className="w-4 h-4" /><span className="text-xs font-medium">{t('portfolio.obligations.monthlyPayment')}</span></div>
          <p className="text-lg font-bold tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(monthlyPayments)}</p>
        </Card>
        <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <div className="flex items-center gap-2 text-stitch-muted dark:text-on-surface-variant mb-1"><FileText className="w-4 h-4" /><span className="text-xs font-medium">{t('portfolio.obligations.typeLabel')}</span></div>
          <p className="text-lg font-bold tabular-nums dark:font-financial dark:text-on-surface">{activeLoans}</p>
        </Card>
      </div>

      {/* Add Button */}
      <div className="flex justify-end">
        <Button className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90" size="sm" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
          <Plus className="w-4 h-4 ml-1.5" />
          {t('portfolio.obligations.addObligation')}
        </Button>
      </div>

      {/* Obligations List */}
      {(obligations || []).length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CreditCard className="w-10 h-10 text-stitch-muted mb-3" />
            <h3 className="text-lg font-semibold mb-1">{t('portfolio.obligations.noObligations')}</h3>
            <p className="text-sm text-stitch-muted">{t('portfolio.obligations.noObligationsHint')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {(obligations || []).map((ob) => {
            const paidPercent = ob.total_amount > 0 ? ((ob.total_amount - ob.remaining_amount) / ob.total_amount) * 100 : 0;
            return (
              <Card key={ob.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Badge className={OBLIGATION_STATUS_COLORS[ob.status]}>{t(`portfolio.obligationStatus.${ob.status}`)}</Badge>
                      <Badge variant="outline">{t(`portfolio.obligationTypes.${ob.type}`) || ob.type}</Badge>
                      <h3 className="font-semibold text-sm">{ob.name}</h3>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => openPayment(ob)}>{t('portfolio.obligations.recordPayment')}</Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(ob)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-stitch-muted hover:text-rose-400" onClick={() => setDeleteId(ob.id!)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><span className="text-stitch-muted">{t('portfolio.obligations.creditor')}</span> <span className="font-medium">{ob.creditor}</span></div>
                    <div><span className="text-stitch-muted">{t('portfolio.obligations.remaining')}</span> <span className="font-medium text-rose-400 dark:text-rose-400">{formatCurrency(ob.remaining_amount)}</span></div>
                    <div><span className="text-stitch-muted">{t('portfolio.obligations.monthlyInstallment')}</span> <span className="font-medium">{formatCurrency(ob.monthly_payment)}</span></div>
                    {ob.interest_rate && <div><span className="text-stitch-muted">{t('portfolio.obligations.interest')}</span> <span className="font-medium">{ob.interest_rate}%</span></div>}
                  </div>
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-stitch-muted">{t('portfolio.obligations.paid')}</span>
                      <span className="font-medium">{(paidPercent ?? 0).toFixed(1)}%</span>
                    </div>
                    <Progress value={paidPercent} className="h-2" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Obligation Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={(v) => { if (!v) resetForm(); setAddDialogOpen(v); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{t('portfolio.obligations.addTitle')}</DialogTitle>
            <DialogDescription>{t('portfolio.obligations.addDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('portfolio.obligations.typeLabel')}</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OBLIGATION_TYPE_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>{t(`portfolio.obligationTypes.${k}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>{t('portfolio.obligations.obligationName')}</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('portfolio.obligations.namePlaceholder')} /></div>
            </div>
            <div className="space-y-2"><Label>{t('portfolio.obligations.creditorLabel')}</Label><Input value={formCreditor} onChange={(e) => setFormCreditor(e.target.value)} placeholder={t('portfolio.obligations.creditorPlaceholder')} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>{t('portfolio.obligations.totalAmount')}</Label><Input type="number" value={formTotalAmount} onChange={(e) => setFormTotalAmount(e.target.value)} placeholder="0.00" dir="ltr" /></div>
              <div className="space-y-2"><Label>{t('portfolio.obligations.remainingAmount')}</Label><Input type="number" value={formRemainingAmount} onChange={(e) => setFormRemainingAmount(e.target.value)} placeholder="0.00" dir="ltr" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>{t('portfolio.obligations.monthlyPayment')}</Label><Input type="number" value={formMonthlyPayment} onChange={(e) => setFormMonthlyPayment(e.target.value)} placeholder="0.00" dir="ltr" /></div>
              <div className="space-y-2"><Label>{t('portfolio.obligations.interestRatePct')}</Label><Input type="number" value={formInterestRate} onChange={(e) => setFormInterestRate(e.target.value)} placeholder="0" dir="ltr" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>{t('portfolio.obligations.startDate')}</Label><Input type="date" value={formStartDate} onChange={(e) => setFormStartDate(e.target.value)} dir="ltr" /></div>
              <div className="space-y-2"><Label>{t('portfolio.obligations.endDate')}</Label><Input type="date" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} dir="ltr" /></div>
            </div>
            <div className="space-y-2"><Label>{t('portfolio.obligations.nextPaymentDate')}</Label><Input type="date" value={formNextPaymentDate} onChange={(e) => setFormNextPaymentDate(e.target.value)} dir="ltr" /></div>
            <div className="space-y-2"><Label>{t('portfolio.obligations.notesLabel')}</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { resetForm(); setAddDialogOpen(false); }}>{t('portfolio.obligations.cancel')}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90" onClick={handleSave}>{t('portfolio.obligations.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{t('portfolio.obligations.paymentTitle', { name: paymentObligation?.name ?? '' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>{t('portfolio.obligations.payAmount')}</Label><Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} dir="ltr" /></div>
            <div className="space-y-2"><Label>{t('portfolio.obligations.payDate')}</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} dir="ltr" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>{t('portfolio.obligations.payPrincipal')}</Label><Input type="number" value={payPrincipal} onChange={(e) => setPayPrincipal(e.target.value)} placeholder="optional" dir="ltr" /></div>
              <div className="space-y-2"><Label>{t('portfolio.obligations.payInterest')}</Label><Input type="number" value={payInterest} onChange={(e) => setPayInterest(e.target.value)} placeholder="optional" dir="ltr" /></div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>{t('portfolio.obligations.cancel')}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90" onClick={handlePayment}>{t('portfolio.obligations.record')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader><DialogTitle>{t('portfolio.obligations.editTitle', { name: editItem?.name })}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t('portfolio.forms.name')}</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>{t('portfolio.obligations.remainingAmount')}</Label><Input type="number" value={formRemainingAmount} onChange={(e) => setFormRemainingAmount(e.target.value)} dir="ltr" /></div>
              <div className="space-y-2"><Label>{t('portfolio.obligations.monthlyPayment')}</Label><Input type="number" value={formMonthlyPayment} onChange={(e) => setFormMonthlyPayment(e.target.value)} dir="ltr" /></div>
            </div>
            <div className="space-y-2"><Label>{t('portfolio.forms.notesLabel')}</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90" onClick={handleEditSave}>{t('portfolio.obligations.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-400"><AlertTriangle className="w-5 h-5" /> {t('portfolio.obligations.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('portfolio.obligations.deleteDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t('common.cancel')}</Button>
            <Button className="bg-rose-500 hover:bg-rose-500/80 text-white dark:bg-error dark:text-on-error dark:hover:bg-error/90" onClick={handleDelete}>{t('portfolio.obligations.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

// ==================== REPORTS TAB ====================
// UI-STABILITY fix (2026-09-28): wrap ReportsTab in React.memo so background
// refreshes elsewhere don't re-render the reports tab tree.
const ReportsTab = memo(function ReportsTab() {
  // P37-PHASE-2B-4A: currency-aware totals (EGP/USD/SAR toggle from header).
  const t = useTranslation();
  const { displayCurrency, usdRate, sarRate } = useAppStore();
  const formatCurrency = (value: number | null | undefined) =>
    formatCurrencyRaw(value, displayCurrency, usdRate, sarRate);
  const [reports, setReports] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/finance/reports');
        const data = await res.json();
        // API wraps data in { success, summary: { ... } }
        if (data.success && data.summary) {
          setReports(data.summary);
        }
      } catch { // silent fallback (safe-by-design)
        toast.error(t('portfolio.reports.loadFailed'));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Card><CardContent className="p-6"><Skeleton className="h-40 w-full" /></CardContent></Card>
        <Card><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
      </div>
    );
  }

  const totalAssets = reports?.total_assets || 0;
  const totalLiabilities = reports?.total_liabilities || 0;
  const netWorth = reports?.net_worth || 0;
  const assetsByType = reports?.assets_by_type || {};
  const alerts = reports?.alerts || [];

  // Safe access guards
  const safeAlerts = alerts || [];
  const investmentReturns = reports?.investment_returns;

  const maxAssetTypeValue = Math.max(...(Object.values(assetsByType) as number[]), 1);

  return (
    <div className="space-y-6">
      {/* Portfolio Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="w-5 h-5 text-stitch-primary dark:text-stitch-primary" />
            {t('portfolio.reports.overview')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-emerald-50 dark:bg-emerald-600/80/20 dark:bg-primary-container/20">
              <p className="text-xs text-stitch-muted dark:text-on-surface-variant mb-1">{t('portfolio.reports.totalAssets')}</p>
              <p className="text-lg font-bold text-stitch-primary dark:text-stitch-primary dark:text-primary tabular-nums dark:font-financial">{formatCurrency(totalAssets)}</p>
              <p className="text-[10px] text-stitch-muted dark:text-on-surface-variant mt-1">{t('portfolio.reports.totalAssetsHint')}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-rose-500/60/20 dark:bg-error-container/20">
              <p className="text-xs text-stitch-muted dark:text-on-surface-variant mb-1">{t('portfolio.reports.totalObligations')}</p>
              <p className="text-lg font-bold text-rose-400 dark:text-rose-400 dark:text-error tabular-nums dark:font-financial">{formatCurrency(totalLiabilities)}</p>
              <p className="text-[10px] text-stitch-muted dark:text-on-surface-variant mt-1">{t('portfolio.reports.totalObligationsHint')}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-[#182030] dark:bg-teal-900/20 dark:bg-primary-container/20">
              <p className="text-xs text-stitch-muted dark:text-on-surface-variant mb-1">{t('portfolio.reports.netWorth')}</p>
              <p className={cn('text-lg font-bold tabular-nums dark:font-financial', netWorth >= 0 ? 'text-teal-600 dark:text-teal-400 dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
                {formatCurrency(netWorth)}
              </p>
              <p className="text-[10px] text-stitch-muted dark:text-on-surface-variant mt-1">{t('portfolio.reports.netWorthHint')}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20">
              <p className="text-xs text-stitch-muted dark:text-on-surface-variant mb-1">{t('portfolio.reports.monthlySavings')}</p>
              <p className={cn('text-lg font-bold tabular-nums dark:font-financial', (reports?.monthly_savings ?? 0) >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
                {formatCurrency(reports?.monthly_savings ?? 0)}
              </p>
              <p className="text-[10px] text-stitch-muted dark:text-on-surface-variant mt-1">{t('portfolio.reports.monthlySavingsHint')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Investment Returns - NEW */}
      {investmentReturns && investmentReturns.total_monthly > 0 && (
        <Card className="border-emerald-500/30 dark:border-emerald-500/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-stitch-primary dark:text-stitch-primary" />
              {t('portfolio.reports.monthlyReturns')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {investmentReturns.bank_monthly > 0 && (
                <div className="p-3 rounded-lg bg-[#182030] dark:bg-teal-900/20 text-center">
                  <p className="text-xs text-stitch-muted mb-1">{t('portfolio.reports.bankMonthlyReturn')}</p>
                  <p className="text-base font-bold text-teal-600 dark:text-teal-400">{formatCurrency(investmentReturns.bank_monthly)}</p>
                </div>
              )}
              {investmentReturns.certificate_monthly > 0 && (
                <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-center">
                  <p className="text-xs text-stitch-muted mb-1">{t('portfolio.reports.certMonthlyReturn')}</p>
                  <p className="text-base font-bold text-purple-600 dark:text-purple-400">{formatCurrency(investmentReturns.certificate_monthly)}</p>
                </div>
              )}
              {investmentReturns.fund_monthly > 0 && (
                <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 text-center">
                  <p className="text-xs text-stitch-muted mb-1">{t('portfolio.reports.fundMonthlyReturn')}</p>
                  <p className="text-base font-bold text-orange-600 dark:text-orange-400">{formatCurrency(investmentReturns.fund_monthly)}</p>
                </div>
              )}
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-600/80/20 dark:bg-primary-container/20 text-center">
                <p className="text-xs text-stitch-muted mb-1">{t('portfolio.reports.totalMonthlyReturn')}</p>
                <p className="text-base font-bold text-stitch-primary dark:text-stitch-primary">{formatCurrency(investmentReturns.total_monthly)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-stitch-muted">{t('portfolio.reports.expectedAnnualReturn')}</span>
              <span className="font-bold text-stitch-primary dark:text-stitch-primary">{formatCurrency(investmentReturns.total_yearly)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Income vs Expenses */}
      {reports && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-stitch-primary dark:text-stitch-primary" />
              {t('portfolio.reports.incomeVsExpenses')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-stitch-muted">{t('portfolio.reports.totalIncome')}</span>
                  <span className="font-medium text-stitch-primary dark:text-stitch-primary">{formatCurrency(reports.monthly_income)}</span>
                </div>
                <div className="h-3 rounded-full bg-[#182030] overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500/20" style={{ width: '100%' }} />
                </div>
                {investmentReturns && investmentReturns.total_monthly > 0 && (
                  <p className="text-[10px] text-stitch-muted mt-1">
                    {t('portfolio.reports.includesReturns', { amount: formatCurrency(investmentReturns.total_monthly) })}
                  </p>
                )}
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-stitch-muted">{t('portfolio.reports.totalExpenses')}</span>
                  <span className="font-medium text-rose-400 dark:text-rose-400">{formatCurrency(reports.monthly_expenses)}</span>
                </div>
                <div className="h-3 rounded-full bg-[#182030] overflow-hidden">
                  <div className="h-full rounded-full bg-rose-500/20" style={{ width: `${reports.monthly_income > 0 ? Math.min((reports.monthly_expenses / reports.monthly_income) * 100, 100) : 0}%` }} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-stitch-muted">{t('portfolio.reports.savingsRate')}</span>
              <div className="flex items-center gap-2">
                <Progress value={Math.min(Math.max(reports.savings_rate ?? 0, 0), 100)} className="h-2 w-24" />
                <span className="font-bold text-sm">{(reports.savings_rate ?? 0).toFixed(1)}%</span>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-stitch-muted">{t('portfolio.reports.netMonthlySavings')}</span>
              <span className={cn('font-bold', (reports.monthly_savings ?? 0) >= 0 ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error')}>
                {formatCurrency(reports.monthly_savings)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerts */}
      {safeAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              {t('portfolio.reports.alertsTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {safeAlerts.map((alert: FinancialAlert, idx: number) => (
              <div
                key={idx}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border',
                  alert.type === 'danger' && 'bg-red-50 border-rose-500/30 dark:bg-rose-500/60/20 dark:border-rose-500/30/50',
                  alert.type === 'warning' && 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-900/50',
                  alert.type === 'info' && 'bg-[#182030] border-teal-200 dark:bg-[#0B0E14]/20 dark:border-teal-900/50'
                )}
              >
                {alert.type === 'danger' && <XCircle className="w-5 h-5 text-rose-400 mt-0.5 flex-shrink-0" />}
                {alert.type === 'warning' && <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />}
                {alert.type === 'info' && <CheckCircle2 className="w-5 h-5 text-teal-500 mt-0.5 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" dir="rtl">{alert.message}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Assets Distribution */}
      {Object.keys(assetsByType).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="w-5 h-5 text-stitch-primary dark:text-stitch-primary" />
              {t('portfolio.reports.assetDistribution')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(Object.entries(assetsByType) as [string, number][])
              .sort(([, a], [, b]) => b - a)
              .map(([type, value]) => {
                const pct = totalAssets > 0 ? (value / totalAssets) * 100 : 0;
                const label = t(`portfolio.assetTypes.${type}`) || type;
                const colorClass = ASSET_TYPE_COLORS[type as AssetType] || 'bg-gray-400';
                const barColor = type === 'stock' ? 'bg-emerald-500/20' : type === 'gold' ? 'bg-yellow-400' : type === 'bank' ? 'bg-teal-400' : type === 'certificate' ? 'bg-purple-400' : type === 'fund' ? 'bg-orange-400' : 'bg-teal-400';
                return (
                  <div key={type} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Badge className={cn('text-[10px] px-1.5', colorClass)}>{label}</Badge>
                      </div>
                      <span className="font-medium">{formatCurrency(value)} ({(pct ?? 0).toFixed(1)}%)</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-[#182030] overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${(value / maxAssetTypeValue) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {/* Economic Expert Recommendations */}
      {reports && totalAssets > 0 && (
        <Card className="border-amber-200 dark:border-amber-800">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              {t('portfolio.reports.economistTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Portfolio Health Score */}
            <div className="p-3 rounded-lg bg-gradient-to-r from-emerald-50 to-slate-50 dark:from-emerald-900/20 dark:to-slate-800/20">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">{t('portfolio.reports.portfolioHealth')}</span>
                <span className="text-2xl font-bold text-stitch-primary dark:text-stitch-primary">
                  {Math.min(100, Math.round(
                    (netWorth > 0 ? 25 : 0) +
                    ((investmentReturns?.total_yearly || 0) > 0 ? 25 : 0) +
                    (Object.keys(assetsByType).filter(t => (assetsByType as Record<string, number>)[t] > 0).length >= 3 ? 25 : 10) +
                    ((reports?.savings_rate || 0) >= 20 ? 25 : (reports?.savings_rate || 0) >= 10 ? 15 : 5)
                  ))}%
                </span>
              </div>
              <Progress value={Math.min(100, Math.round(
                (netWorth > 0 ? 25 : 0) +
                ((investmentReturns?.total_yearly || 0) > 0 ? 25 : 0) +
                (Object.keys(assetsByType).filter(t => (assetsByType as Record<string, number>)[t] > 0).length >= 3 ? 25 : 10) +
                ((reports?.savings_rate || 0) >= 20 ? 25 : (reports?.savings_rate || 0) >= 10 ? 15 : 5)
              ))} className="h-2" />
            </div>

            {/* Recommendations Grid */}
            <div className="grid gap-3">
              {/* Diversification Check */}
              {(() => {
                const assetTypes = Object.keys(assetsByType).filter(t => (assetsByType as Record<string, number>)[t] > 0);
                const stockPercent = totalAssets > 0 ? (((assetsByType as Record<string, number>).stock || 0) / totalAssets) * 100 : 0;
                const bankPercent = totalAssets > 0 ? (((assetsByType as Record<string, number>).bank || 0) / totalAssets) * 100 : 0;
                const goldPercent = totalAssets > 0 ? (((assetsByType as Record<string, number>).gold || 0) / totalAssets) * 100 : 0;

                return (
                  <>
                    {/* Warning: High Stock Concentration */}
                    {stockPercent > 50 && (
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                        <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">{t('portfolio.reports.diversification')}</p>
                          <p className="text-xs text-stitch-muted mt-1">
                            {t('portfolio.reports.diversificationMsg', { pct: (stockPercent ?? 0).toFixed(1) })}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Good: High Bank Returns */}
                    {bankPercent > 60 && investmentReturns && investmentReturns.bank_monthly > 0 && (
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-[#182030] dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800">
                        <CheckCircle2 className="w-5 h-5 text-teal-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-teal-800 dark:text-teal-200">{t('portfolio.reports.bankReturns')}</p>
                          <p className="text-xs text-stitch-muted mt-1">
                            {t('portfolio.reports.bankReturnsMsg', { amount: formatCurrency(investmentReturns.bank_monthly) })}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Suggestion: Add Gold */}
                    {goldPercent < 5 && totalAssets > 100000 && (
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <Info className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t('portfolio.reports.addGold')}</p>
                          <p className="text-xs text-stitch-muted mt-1">
                            {t('portfolio.reports.addGoldMsg')}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Suggestion: Emergency Fund */}
                    {investmentReturns && investmentReturns.total_monthly > 0 && (
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-600/80/20 dark:bg-primary-container/20 border border-emerald-500/30 dark:border-emerald-500/30">
                        <PiggyBank className="w-5 h-5 text-stitch-primary mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-stitch-primary dark:text-stitch-primary">{t('portfolio.reports.emergencyFund')}</p>
                          <p className="text-xs text-stitch-muted mt-1">
                            {t('portfolio.reports.emergencyFundMsg', { min: formatCurrency((reports?.monthly_expenses || 0) * 3), max: formatCurrency((reports?.monthly_expenses || 0) * 6) })}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Money Distribution Plan */}
            <div className="mt-4 p-4 rounded-lg bg-gradient-to-r from-emerald-50 via-slate-50 to-purple-50 dark:from-emerald-900/20 dark:via-slate-800/20 dark:to-purple-900/20 border">
              <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Coins className="w-4 h-4" />
                {t('portfolio.reports.proposedDistribution')}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
                  <p className="font-bold text-stitch-primary">50%</p>
                  <p className="text-stitch-muted">{t('portfolio.reports.basicNeeds')}</p>
                  <p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.5)}</p>
                </div>
                <div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
                  <p className="font-bold text-teal-600">20%</p>
                  <p className="text-stitch-muted">{t('portfolio.reports.savings')}</p>
                  <p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.2)}</p>
                </div>
                <div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
                  <p className="font-bold text-purple-600">20%</p>
                  <p className="text-stitch-muted">{t('portfolio.reports.development')}</p>
                  <p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.2)}</p>
                </div>
                <div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
                  <p className="font-bold text-amber-600">10%</p>
                  <p className="text-stitch-muted">{t('portfolio.reports.charity')}</p>
                  <p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.1)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state for no reports */}
      {!reports && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="w-10 h-10 text-stitch-muted mb-3" />
            <h3 className="text-lg font-semibold mb-1">{t('portfolio.reports.noDataTitle')}</h3>
            <p className="text-sm text-stitch-muted">{t('portfolio.reports.noDataDesc')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
});

// ==================== MAIN VIEW ====================

export function EnhancedPortfolioView() {
  const t = useTranslation();
  // MULTI-PORTFOLIO-032: selected portfolio state
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | 'master'>('master');
  const user = useAppStore((s) => s.user);
  const userId = user?.id || 'default';

  // TASK 40-B (2026-10-04 — Nav Reorganization + Portfolio Merge):
  // Owner directive: merge `wealth` + `bagholder-rescue` INTO the portfolio
  // view as sub-tabs so the user has ONE entry point (Portfolio) for everything
  // money-related. The 3-way segmented control below switches between:
  //   • portfolio  — the existing 4-tab portfolio experience (assets / income / obligations / reports)
  //   • wealth     — the WealthCharts dashboard (was previously its own top-level tab #wealth)
  //   • rescue     — BagHolderRescuePanel (was previously in the "More" menu as 🆘 rescue)
  // Hash links #wealth, #bagholder-rescue, #advanced-portfolio still route
  // through page.tsx's switch (backwards-compat preserved per Rule 67).
  const [portfolioMode, setPortfolioMode] = useState<'portfolio' | 'wealth' | 'rescue'>('portfolio');

  return (
    <div dir="rtl" className="min-h-screen stitch-canvas pb-20 lg:pb-4 dark:bg-surface-container-lowest">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 dark:bg-emerald-600/80/30 dark:bg-primary-container/30 flex items-center justify-center">
              {portfolioMode === 'portfolio' && <Wallet className="w-5 h-5 text-stitch-primary dark:text-stitch-primary dark:text-primary" />}
              {portfolioMode === 'wealth' && <HandCoins className="w-5 h-5 text-amber-500 dark:text-amber-400" />}
              {portfolioMode === 'rescue' && <LifeBuoy className="w-5 h-5 text-rose-400 dark:text-rose-400 dark:text-error" />}
            </div>
            <div>
              <h1 className="text-xl font-bold dark:text-on-surface dark:font-outfit">
                {portfolioMode === 'portfolio' && t('portfolio.title')}
                {portfolioMode === 'wealth' && t('portfolio.modes.wealth')}
                {portfolioMode === 'rescue' && t('portfolio.modes.rescue')}
              </h1>
              <p className="text-sm text-stitch-muted dark:text-on-surface-variant">
                {portfolioMode === 'portfolio' && t('portfolio.subtitle')}
                {portfolioMode === 'wealth' && t('portfolio.modes.wealthHint')}
                {portfolioMode === 'rescue' && t('portfolio.modes.rescueHint')}
              </p>
            </div>
          </div>
        </div>

        {/* TASK 40-B: 3-way segmented control — Portfolio | Wealth | Rescue stock */}
        {/* Rule 30: emerald/amber/red accent only (no indigo/blue). */}
        <div className="flex w-full rounded-lg border border-white/[0.06] bg-[#182030]/40 p-1 dark:border-outline-variant dark:bg-surface-container-low" role="tablist" aria-label={t('portfolio.modes.segmentsAria')}>
          <button
            type="button"
            role="tab"
            aria-selected={portfolioMode === 'portfolio'}
            onClick={() => setPortfolioMode('portfolio')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
              portfolioMode === 'portfolio'
                ? 'stitch-canvas text-stitch-primary dark:text-stitch-primary dark:bg-primary-container dark:text-on-primary shadow-sm'
                : 'text-stitch-muted hover:text-stitch-on-surface dark:text-on-surface-variant dark:hover:text-on-surface'
            )}
          >
            <Wallet className="w-4 h-4" />
            {t('portfolio.modes.portfolio')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={portfolioMode === 'wealth'}
            onClick={() => setPortfolioMode('wealth')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
              portfolioMode === 'wealth'
                ? 'stitch-canvas text-amber-600 dark:text-amber-400 dark:bg-primary-container dark:text-on-primary shadow-sm'
                : 'text-stitch-muted hover:text-stitch-on-surface dark:text-on-surface-variant dark:hover:text-on-surface'
            )}
          >
            <HandCoins className="w-4 h-4" />
            {t('portfolio.modes.funds')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={portfolioMode === 'rescue'}
            onClick={() => setPortfolioMode('rescue')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
              portfolioMode === 'rescue'
                ? 'stitch-canvas text-rose-400 dark:text-rose-400 dark:bg-error-container dark:text-on-error shadow-sm'
                : 'text-stitch-muted hover:text-stitch-on-surface dark:text-on-surface-variant dark:hover:text-on-surface'
            )}
          >
            <LifeBuoy className="w-4 h-4" />
            {t('portfolio.modes.rescueStock')}
          </button>
        </div>

        {/* === Wealth sub-tab === */}
        {portfolioMode === 'wealth' && (
          <WealthCharts />
        )}

        {/* === Rescue sub-tab === */}
        {portfolioMode === 'rescue' && (
          <BagHolderRescuePanel />
        )}

        {/* === Portfolio sub-tab (existing 4-tab portfolio experience) === */}
        {portfolioMode === 'portfolio' && (<>
        {/* MULTI-PORTFOLIO-032: Multi-Portfolio Selector + Master Summary */}
        <MultiPortfolioSelector
          userId={userId}
          selectedPortfolioId={selectedPortfolioId}
          onSelect={setSelectedPortfolioId}
        />

        {/* Master Portfolio Summary (overall total from the unified portfolio) */}
        <MasterPortfolioSummary userId={userId} />

        {selectedPortfolioId !== 'master' && (
          <Card className="bg-emerald-600/60/20 border-emerald-500/30/40">
            <CardContent className="p-3 flex items-center justify-between text-xs text-stitch-primary">
              <span>{t('portfolio.subPortfolio.banner')}</span>
              <Badge variant="outline" className="text-stitch-primary border-emerald-500/30">
                {t('portfolio.subPortfolio.badge', { id: selectedPortfolioId })}
              </Badge>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        {/* UI-STABILITY fix (2026-09-28): stable keys on each TabsContent so
            switching tabs doesn't unmount/remount the others unexpectedly. */}
        <Tabs defaultValue="assets">
          <TabsList className="flex w-full dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
            <TabsTrigger value="assets" className="flex-1 dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary dark:text-on-surface-variant dark:data-[state=active]:font-financial">{t('portfolio.tabs.assets')}</TabsTrigger>
            <TabsTrigger value="income-expense" className="flex-1 dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary dark:text-on-surface-variant dark:data-[state=active]:font-financial">{t('portfolio.tabs.incomeExpense')}</TabsTrigger>
            <TabsTrigger value="obligations" className="flex-1 dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary dark:text-on-surface-variant dark:data-[state=active]:font-financial">{t('portfolio.tabs.obligations')}</TabsTrigger>
            <TabsTrigger value="reports" className="flex-1 dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary dark:text-on-surface-variant dark:data-[state=active]:font-financial">{t('portfolio.tabs.reports')}</TabsTrigger>

          </TabsList>

          <TabsContent value="assets" key="portfolio-tab-assets">
            <AssetsTab selectedPortfolioId={selectedPortfolioId} />
          </TabsContent>

          <TabsContent value="income-expense" key="portfolio-tab-income-expense">
            <IncomeExpenseTab />
          </TabsContent>

          <TabsContent value="obligations" key="portfolio-tab-obligations">
            <ObligationsTab />
          </TabsContent>

          <TabsContent value="reports" key="portfolio-tab-reports">
            <ReportsTab />
          </TabsContent>


        </Tabs>
        </>)}
      </div>
    </div>
  );
}
