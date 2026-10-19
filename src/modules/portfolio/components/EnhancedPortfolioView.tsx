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
 if (upper === 'EGX' || upper === 'مصر' || upper === 'EGYPT') return 'EGX';
 if (upper === 'TADAWUL' || upper === 'KSA' || upper === 'SAUDI' || upper === 'السعودية') return 'TADAWUL';
 if (upper === 'KSE' || upper === 'KUWAIT' || upper === 'الكويت') return 'KSE';
 if (upper === 'QSE' || upper === 'QATAR' || upper === 'قطر') return 'QSE';
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
import { AlertsCenterView } from '@/components/alerts/AlertsCenterView';
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
 <CardContent className="p-6 text-sm text-muted-foreground">جاري تحميل رسوم الأموال…</CardContent>
 </Card>
 ) }
);

// ==================== HELPERS ====================

// P37-PHASE-2B-4A: Currency-aware formatter. All wealth values flow through
// this; per-row raw market prices (stock/gold per-gram) stay EGP and use the
// inline `toFixed(2)} ج.م` suffix instead. SAR derived from USD via fixed 3.75 peg.
function formatCurrencyRaw(
 value: number | null | undefined,
 currency: 'EGP' | 'USD' | 'SAR',
 usdRate: number,
 sarRate: number
): string {
 // FIX (DEAL-ADVISOR-002): previously returned '0.00' for null/undefined/NaN,
 // which made the UI show fake "0.00 ج.م" for missing prices/targets/stops.
 // Now returns '—' (em dash) so the user sees "غير متاح" visually.
 if (value === null || value === undefined) return '—';
 const numValue = Number(value);
 if (!Number.isFinite(numValue)) return '—';
 let converted = numValue;
 let suffix = 'ج.م';
 if (currency === 'USD') {
 converted = numValue / (usdRate || 48.5);
 suffix = '$';
 } else if (currency === 'SAR') {
 converted = numValue / (sarRate || 181.875);
 suffix = 'ر.س';
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
 // FIX (DEAL-ADVISOR-002): '0.00 ج.م' → '—' for missing values.
 if (value === null || value === undefined) return '—';
 const numValue = Number(value);
 if (!Number.isFinite(numValue)) return '—';
 return new Intl.NumberFormat('ar-EG', {
 style: 'decimal',
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 }).format(numValue) + ' ج.م';
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

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
 stock: 'أسهم',
 gold: 'ذهب',
 bank: 'بنك',
 certificate: 'شهادات إيداع',
 fund: 'صناديق استثمار',
 crypto: 'عملات رقمية',
 real_estate: 'عقارات',
 other: 'أخرى',
};

const ASSET_TYPE_COLORS: Record<AssetType, string> = {
 stock: 'bg-profit text-profit /30 ',
 gold: 'bg-warning text-warning /30 ',
 bank: 'bg-whale text-whale /30 ',
 certificate: 'bg-primary text-primary /30 ',
 fund: 'bg-warning text-warning /30 ',
 crypto: 'bg-warning text-warning /30 ',
 real_estate: 'bg-whale text-whale /30 ',
 other: 'bg-muted text-muted-foreground /30 ',
};

// Fund types with Arabic labels
const FUND_TYPES = [
 { value: 'equity', label: 'صندوق أسهم' },
 { value: 'bond', label: 'صندوق سندات' },
 { value: 'money_market', label: 'صندوق نقدي' },
 { value: 'fixed_income', label: 'صندوق دخل ثابت' },
 { value: 'balanced', label: 'صندوق متوازن' },
 { value: 'index', label: 'صندوق مؤشر' },
 { value: 'real_estate', label: 'صندوق عقاري' },
 { value: 'sharia', label: 'صندوق إسلامي' },
 { value: 'other', label: 'نوع آخر' },
];

const INCOME_CATEGORIES = [
 { value: 'salary', label: 'راتب', icon: Briefcase },
 { value: 'bonus', label: 'مكافآت', icon: Zap },
 { value: 'investment_return', label: 'عوائد استثمار', icon: TrendingUp },
 { value: 'rental', label: 'إيجار', icon: Home },
 { value: 'business', label: 'أعمال حرة', icon: Briefcase },
 { value: 'freelance', label: 'أعمال مستقلة', icon: FileText },
 { value: 'other_income', label: 'أخرى', icon: DollarSign },
];

const EXPENSE_CATEGORIES = [
 { value: 'education', label: 'تعليم', icon: GraduationCap },
 { value: 'housing', label: 'سكن', icon: Home },
 { value: 'transport', label: 'مواصلات', icon: Car },
 { value: 'food', label: 'طعام', icon: ShoppingCart },
 { value: 'healthcare', label: 'صحة', icon: Heart },
 { value: 'entertainment', label: 'ترفيه', icon: Plane },
 { value: 'travel', label: 'رحلات', icon: Plane },
 { value: 'clothing', label: 'ملابس', icon: ShoppingCart },
 { value: 'utilities', label: 'فواتير', icon: Zap },
 { value: 'insurance', label: 'تأمين', icon: Shield },
 { value: 'debt_payment', label: 'أقساط', icon: CreditCard },
 { value: 'other_expense', label: 'أخرى', icon: DollarSign },
];

const OBLIGATION_TYPE_LABELS: Record<string, string> = {
 loan: 'قرض',
 installment: 'قسط',
 credit_card: 'بطاقة ائتمان',
 mortgage: 'رهن عقاري',
};

const OBLIGATION_STATUS_LABELS: Record<string, string> = {
 active: 'نشط',
 paid: 'مسدد',
 overdue: 'متأخر',
};

const OBLIGATION_STATUS_COLORS: Record<string, string> = {
 active: 'bg-profit text-profit /30 ',
 paid: 'bg-whale text-whale /30 ',
 overdue: 'bg-loss text-loss /30 ',
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
 } catch {
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
 placeholder="ابحث عن السهم بالاسم أو الرمز..."
 dir="rtl"
 onFocus={() => { if (results.length > 0) setOpen(true); }}
 />
 {loading && (
 <div className="absolute left-2 top-1/2 -translate-y-1/2">
 <div className="w-4 h-4 border-2 border-profit border-t-transparent rounded-full animate-spin" />
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
 <div className="text-xs text-muted-foreground" dir="ltr">{stock.ticker} | {stock.name}</div>
 </div>
 <div className="text-left flex-shrink-0">
 <div className="text-sm font-semibold" dir="ltr">{(stock.current_price ?? 0) > 0 ? (stock.current_price ?? 0).toFixed(2) : '—'}</div>
 <div className={cn('text-xs font-medium', (stock.price_change ?? 0) >= 0 ? 'text-profit ' : 'text-loss ')}>
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
 } catch {
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
 placeholder="ابحث عن عملة (BTC, ETH, Bitcoin...)"
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
 <div className="text-xs text-muted-foreground" dir="ltr">{coin.symbol}</div>
 </div>
 <div className="text-left flex-shrink-0">
 <div className="text-sm font-semibold" dir="ltr">${coin.price_usd > 0 ? (coin.price_usd ?? 0).toFixed(2) : '—'}</div>
 <div className={cn('text-xs font-medium', coin.change_24h >= 0 ? 'text-profit ' : 'text-loss ')}>
 {coin.change_24h >= 0 ? '+' : ''}{(coin.change_24h ?? 0).toFixed(2)}%
 </div>
 </div>
 </button>
 ))}
 </div>
 )}
 {open && !loading && filtered.length === 0 && allCoins.length > 0 && query.trim() && (
 <div className="absolute z-50 w-full mt-1 rounded-md border bg-popover shadow-lg p-3 text-sm text-muted-foreground text-center">
 لا توجد عملات مطابقة لـ "{query}"
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
 // P39-PHASE-2: state for the DynamicRiskProfilerModal (إعادة الاختبار button).
 const [profilerOpen, setProfilerOpen] = useState(false);
 // P37-PHASE-2B-4A: local currency-aware formatter — shadows the module-level
 // EGP-only version so every wealth value rendered inside this tab follows
 // the header's EGP/USD/SAR toggle. Per-row raw market prices (stock/gold
 // per-gram) intentionally keep their inline `toFixed(2)} ج.م` suffix.
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
 } catch {}
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
 } catch { /* silent — fall back to default 48.5 */ }
 // B-1: Read the backend P34 net-worth math directly — no local recomputation.
 setNetWorthData({
 gross: assetsData.gross_assets_egp || assetsData.total_current_value || 0,
 debts: assetsData.total_obligations_egp || 0,
 net: assetsData.net_worth_egp || 0,
 monthlyYield: assetsData.smart_math?.monthly_yield_egp || 0,
 annualYield: assetsData.smart_math?.annual_yield_egp || 0,
 });
 } else {
 // fallback للـ API القديم
 setNetWorthData(null);
 try {
 const fallbackRes = await fetch(`/api/finance/assets${pidQs}`);
 const fallbackData = await fallbackRes.json();
 allAssets.push(...(fallbackData.items || fallbackData.assets || []));
 } catch {
 // both APIs failed — continue with empty
 }
 }
 
 setAssets(allAssets);
 setObligations(obligationsData?.items || []);
 // P30 TASK 8: Push to unified store so MasterPortfolioSummary + RealReturnPanel auto-update
 usePortfolioStore.getState().updateFromCalcValues(assetsData);
 } catch {
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
 } catch {
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
 } catch {
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
 } catch {
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
 } catch {
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
 const assetLabels: Record<string, string> = {
 egx: 'الأسهم',
 crypto: 'العملات الرقمية',
 gold: 'الذهب',
 };
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
 const ticker = String(top.stock_ticker || top.name || 'الأصل');
 const overflowValueEGP = (alert.overflow / 100) * portfolioNetWorthEGP;
 const price = Number(top.current_stock_price || top.current_value || 0);
 const sellQty = price > 0 ? Math.ceil(overflowValueEGP / price) : 0;
 const qtyLabel = sellQty > 0 ? `${sellQty.toLocaleString('ar-EG')} وحدة من ` : '';
 toast.warning(
 `بيع ${qtyLabel}${ticker} لتقليل نسبة ${assetLabels[alert.asset] || alert.asset} من ${(alert.currentPercent ?? 0).toFixed(1)}% إلى ${alert.ceilingPercent}%`,
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
 className="w-full text-right rounded-lg border-2 border-loss bg-loss /40 p-4 animate-pulse hover:bg-loss dark:hover:bg-loss/60 transition-colors"
 title="اضغط للحصول على خطة إنقاذ فورية"
 >
 <div className="flex items-center gap-3 flex-wrap">
 <span className="text-2xl">🚨</span>
 <div className="flex-1 min-w-0">
 <div className="font-bold text-loss text-sm md:text-base">
 تنبيه: أنت مزنوق في {severeLossPositions.length} {severeLossPositions.length === 1 ? 'سهم' : 'أسهم'} بخسارة 15% أو أكبر
 </div>
 <div className="text-xs text-loss mt-0.5">
 أسوأها: <span dir="ltr" className="font-bold">{worst.stock_ticker}</span> بخسارة {(lossPct ?? 0).toFixed(1)}% — اضغط هنا للحصول على خطة الإنقاذ الفورية
 </div>
 </div>
 </div>
 </button>
 );
 })()}

 {/* ROBO-ADVISOR-P3: محرك العائد الحقيقي (التضخم) */}
 <RealReturnPanel />

 {/* ROBO-ADVISOR-P4: محرك تقييم المخاطر + Rebalancing */}
 {/* Task 6: Pass live allocation so the quiz can show smart rebalance alerts */}
 <RiskProfilerQuiz currentAllocation={currentAllocation} />

 {/* ROBO-ADVISOR-P4: محرك إنقاذ الأسهم المزنوقة */}
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

 {/* MONEY-TIER2.9: توقعات زيادة المركز — الأسهم الرابحة ≥ 10% */}
 <TopUpRecommendationsPanel />

 {/* P37-PHASE-2B-4A: Currency badge — tells users which currency the
 aggregate wealth totals below are displayed in. Per-row raw market
 prices (stock/gold per-gram) stay in EGP and use the inline suffix.
 P39-PHASE-2: persona badge + "إعادة اختبار الشخصية" button on the
 other side — opens DynamicRiskProfilerModal to recompute the persona. */}
 <div className="flex items-center justify-between gap-2 flex-wrap" dir="rtl">
 <div className="flex items-center gap-2">
 <Badge className="text-xs gap-1 bg-profit text-profit /30 border-profit ">
 <Shield className="w-3 h-3" />
 {t('portfolio.persona.label', { persona: personaLabelAr(persona) })}
 </Badge>
 <Button
 size="sm"
 variant="ghost"
 className="h-7 px-2 text-xs text-muted-foreground hover:text-profit"
 onClick={() => setProfilerOpen(true)}
 >
 <RefreshCw className="w-3 h-3 ml-1" />
 {t('portfolio.persona.retest')}
 </Button>
 </div>
 <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
 {t('portfolio.currency.label', { currency: displayCurrency })}
 </Badge>
 </div>

 {/* Summary Cards — B-1: Backend P34 net-worth math (gross / debts / net / monthly yield) */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <Card className="p-4">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <Landmark className="w-4 h-4" />
 <span className="text-xs font-medium">{t('portfolio.summary.totalAssets')}</span>
 </div>
 <p className="text-lg md:text-xl font-bold">{formatCurrency(netWorthData?.gross ?? totalAssets)}</p>
 </Card>
 <Card className="p-4">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <CreditCard className="w-4 h-4 text-warning" />
 <span className="text-xs font-medium">{t('portfolio.summary.totalLiabilities')}</span>
 </div>
 <p className="text-lg md:text-xl font-bold text-warning ">
 {formatCurrency(netWorthData?.debts ?? totalLiabilities)}
 </p>
 {totalLiabilities > 0 && (netWorthData?.debts ?? 0) === 0 && (
 <p className="text-xs text-muted-foreground mt-1">{t('portfolio.summary.afterDeduction', { amount: formatCurrency(totalLiabilities) })}</p>
 )}
 </Card>
 <Card className="p-4 ring-1 ring-profit/30 bg-profit/5">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <Wallet className="w-4 h-4 text-profit" />
 <span className="text-xs font-medium">{t('portfolio.summary.netWorth')}</span>
 </div>
 <p className={cn('text-lg md:text-xl font-bold', (netWorthData?.net ?? netWealth) >= 0 ? 'text-profit ' : 'text-loss ')}>
 {formatCurrency(netWorthData?.net ?? netWealth)}
 </p>
 </Card>
 <Card className="p-4">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <Coins className="w-4 h-4 text-profit" />
 <span className="text-xs font-medium">{t('portfolio.summary.monthlyYield')}</span>
 </div>
 <p className="text-lg md:text-xl font-bold text-profit ">
 {formatCurrency(netWorthData?.monthlyYield ?? 0)}
 </p>
 {netWorthData && netWorthData.annualYield > 0 && (
 <p className="text-xs text-muted-foreground mt-1">{t('portfolio.summary.annualYield', { amount: formatCurrency(netWorthData.annualYield) })}</p>
 )}
 </Card>
 </div>

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
 {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map((type) => (
 <Button key={type} size="sm" variant={filterType === type ? 'default' : 'outline'} onClick={() => setFilterType(type)}>
 {t(`portfolio.assetTypes.${type}`)}
 </Button>
 ))}
 </div>
 <div className="flex items-center gap-2">
 {refreshing && (
 <span className="text-xs text-muted-foreground flex items-center gap-1 animate-pulse">
 <RefreshCw className="w-3 h-3 animate-spin" />
 {t('portfolio.buttons.liveRefresh')}
 </span>
 )}
 <Button className="bg-profit hover:bg-profit text-white" size="sm" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
 <Plus className="w-4 h-4 ml-1.5" />
 {t('portfolio.buttons.addAsset')}
 </Button>
 </div>
 </div>

 {/* Assets List - Grouped by Type */}
 {filteredAssets.length === 0 ? (
 <Card className="border-dashed">
 <CardContent className="flex flex-col items-center justify-center py-12 text-center">
 <Landmark className="w-10 h-10 text-muted-foreground mb-3" />
 <h3 className="text-lg font-semibold mb-1">{t('portfolio.empty.noAssets')}</h3>
 <p className="text-sm text-muted-foreground">أضف أصولك المالية لتتبعها هنا</p>
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
 <AccordionItem key={groupType} value={groupType} className="border rounded-lg bg-card px-4">
 {/* Group Header — P30 TASK 6: Accordion trigger */}
 <AccordionTrigger className="hover:no-underline bg-muted/30 rounded-lg px-3 py-3 hover:bg-muted/50">
 <div className="flex items-center gap-2">
 <Badge className={ASSET_TYPE_COLORS[groupType]}>{ASSET_TYPE_LABELS[groupType]}</Badge>
 <span className="text-sm text-muted-foreground">({groupAssets.length})</span>
 </div>
 <div className="flex items-center gap-4 text-sm">
 <div className="text-left">
 <span className="text-muted-foreground">القيمة: </span>
 <span className="font-semibold">{formatCurrency(groupCurrentValue)}</span>
 </div>
 <div className={cn('text-left font-semibold', groupProfitLoss >= 0 ? 'text-profit ' : 'text-loss ')}>
 {formatPercent(groupProfitLossPercent)}
 </div>
 {/* Show interest for bank/certificate/fund */}
 {['bank', 'certificate', 'fund'].includes(groupType) && groupYearlyInterest > 0 && (
 <div className="text-left text-profit ">
 <span className="text-xs">عائد سنوي: </span>
 <span className="font-semibold">{formatCurrency(groupYearlyInterest)}</span>
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
 // UNIFY-FIX (Rule 27 NO-FAKE-DATA): أزلت أسعار الذهب الوهمية (4200/3675/3150)
 // لو goldPrices = null → اعرض "— بيانات غير متاحة" بدل القيم الوهمية
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
 <Card key={asset.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => { if (isStock && asset.stock_ticker) loadStockDetail(asset.stock_ticker); }}>
 <CardContent className="p-4">
 <div className="flex items-start justify-between mb-3">
 <div className="flex items-center gap-2 min-w-0 flex-1">
 <div className="min-w-0">
 <h3 className="font-semibold text-sm truncate">{asset.name}</h3>
 {isStock && asset.stock_ticker && (
 <span className="text-xs text-muted-foreground block" dir="ltr">{asset.stock_ticker}</span>
 )}
 {isStock && asset.stock_ticker && (() => {
 // PHASE3-MARKET-SEGREGATION (Task F): أضف badge بـ
 // سوق السهم علشان العميل يفرّق بين EGX و TADAWUL و US.
 // لو المحفظة فيها أسهم من أسواق مختلفة، الـ badge بـ يوضّح
 // كل سهم بتاع أي سوق بدل ما يبقوا مخلوطين بدون تمييز.
 const m = inferStockMarket(String(asset.stock_ticker), String((asset as Record<string, unknown>).stock_market ?? ''));
 if (!m || m === 'EGX') return null; // EGX هو الافتراضي — ما نظهرش badge
 const label = MARKET_NAMES_AR[m];
 return (
 <Badge variant="outline" className="text-xs px-1.5 py-0 mt-1 ml-1 inline-flex items-center gap-1 bg-primary /40 border-primary text-primary ">
 🏛️ {label}
 </Badge>
 );
 })()}
 {Boolean(asset.portfolio_id) && String(asset.portfolio_id) !== 'default' && (
 <Badge
 variant="outline"
 className={cn(
 "text-xs px-1.5 py-0 mt-1 inline-flex items-center gap-1",
 getPortfolioColorClass(portfoliosMap[String(asset.portfolio_id)]?.color)
 )}
 >
 📁 {portfoliosMap[String(asset.portfolio_id)]?.name || `محفظة #${asset.portfolio_id}`}
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
 className="h-7 px-2 mr-1 text-xs font-bold border-loss text-loss bg-loss /40 hover:bg-loss dark:hover:bg-loss/60 animate-pulse"
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
 title="هذا السهم مزنوق بخسارة — اضغط للإنقاذ الفوري"
 >
 🚨 مزنوق
 </Button>
 )}
 {/* Deal Advisor button — opens #trading-chart with prefill
 (ticker + avg_buy_price + quantity) so the user lands
 directly on the Deal Advisor panel for this position. */}
 {isStock && asset.stock_ticker && (
 <Button
 variant="outline"
 size="sm"
 className="h-7 px-2 mr-1 text-xs font-bold border-primary text-primary hover:bg-primary/10"
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
 title="افتح مستشار الصفقة لهذا المركز"
 >
 <Sparkles className="w-3 h-3 ml-1" />
 مستشار
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
 <Button variant="outline" size="icon" className="h-9 w-9" onClick={(e) => { e.stopPropagation(); e.preventDefault(); openEdit(asset); }} title="تعديل"><Pencil className="w-3.5 h-3.5" /></Button>
 <Button variant="outline" size="icon" className="h-7 w-7 text-muted-foreground hover:text-loss hover:border-loss hover:bg-loss dark:hover:bg-loss/30" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setDeleteId(asset.id!); }} title="حذف"><Trash2 className="w-3.5 h-3.5" /></Button>
 </div>
 </div>
 
 <div className="space-y-2">
 <div className="flex justify-between text-sm">
 <span className="text-muted-foreground">المستثمر</span>
 <span className="font-medium">{formatCurrency(invested)}</span>
 </div>
 
 {/* Stock: Show current price */}
 {isStock && currentPrice > 0 && (
 <div className="flex justify-between text-sm">
 <span className="text-muted-foreground">السعر الحالي</span>
 <span className="font-medium" dir="ltr">{(currentPrice ?? 0).toFixed(2)} ج.م</span>
 </div>
 )}
 
 <div className="flex justify-between text-sm">
 <span className="text-muted-foreground">القيمة الحالية</span>
 <span className="font-medium">{formatCurrency(currVal)}</span>
 </div>
 
 {/* Profit/Loss */}
 <div className="flex justify-between text-sm">
 <span className="text-muted-foreground">الربح/الخسارة</span>
 <span className={cn('font-semibold', gl >= 0 ? 'text-profit ' : 'text-loss ')}>
 {gl >= 0 ? '+' : ''}{formatCurrency(gl)} ({formatPercent(glPct)})
 </span>
 </div>
 
 {/* Stock: Daily change */}
 {isStock && currentPrice > 0 && (
 <div className="flex justify-between text-sm">
 <span className="text-muted-foreground">تغيير اليوم</span>
 <span className={cn('font-medium', priceChange >= 0 ? 'text-profit ' : 'text-loss ')}>
 {formatPercent(priceChange)}
 </span>
 </div>
 )}
 
 {/* Interest-bearing assets: Show interest breakdown */}
 {isInterestBearing && (rate > 0 || yearlyInterest > 0) && (
 <>
 <div className="flex justify-between text-sm text-profit pt-1 border-t border-dashed">
 <span className="text-muted-foreground">العائد السنوي المتوقع</span>
 <span className="font-semibold">{formatCurrency(yearlyInterest)}</span>
 </div>
 <div className="flex justify-between text-xs text-muted-foreground">
 <span>شهري</span>
 <span>{formatCurrency(monthlyInterest)}</span>
 </div>
 <div className="flex justify-between text-xs text-muted-foreground">
 <span>يومي</span>
 <span>{formatCurrency(dailyInterest)}</span>
 </div>
 {accruedInterest > 0 && (
 <div className="mt-2 p-2 bg-profit /20 rounded text-xs">
 <div className="flex justify-between">
 <span className="text-muted-foreground">الفائدة المكتسبة</span>
 <span className="font-semibold text-profit ">
 {formatCurrency(accruedInterest)}
 </span>
 </div>
 {daysElapsed > 0 && (
 <div className="text-muted-foreground mt-1">منذ {daysElapsed} يوم</div>
 )}
 </div>
 )}
 </>
 )}
 </div>
 
 {/* Footer info */}
 {isStock && qty > 0 && (
 <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
 {qty.toLocaleString('ar-EG')} سهم @ {(avgBuy ?? 0).toFixed(2)} ج.م
 </div>
 )}
 {asset.type === 'gold' && (
 <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
 {weightGrams ? `${weightGrams.toLocaleString('ar-EG')} جرام` : ''} {karat ? `عيار ${karat}` : ''}
 {livePricePerGram > 0 && (
 <span className="block mt-1 text-profit ">
 سعر الجرام الحالي: {(livePricePerGram ?? 0).toFixed(2)} ج.م
 </span>
 )}
 </div>
 )}
 {(asset.type === 'bank' || (asset.type as string) === 'deposit') && (
 <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
 {asset.bank_name || ''} {rate > 0 ? `| فائدة ${rate}% سنوياً` : ''}
 </div>
 )}
 {asset.type === 'certificate' && (
 <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
 {asset.certificate_duration_months ? `${asset.certificate_duration_months} شهر` : ''} 
 {rate > 0 ? ` | فائدة ${rate}% سنوياً` : ''}
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
 <DialogTitle>إضافة أصل جديد</DialogTitle>
 <DialogDescription>أضف أصلًا ماليًا إلى محفظتك المتنوعة</DialogDescription>
 </DialogHeader>
 <div className="space-y-4 py-2">
 <div className="space-y-2">
 <Label>نوع الأصل</Label>
 <Select value={formType} onValueChange={(v) => { setFormType(v as AssetType); if (v !== 'stock') { setFormTicker(''); setFormSelectedPrice(null); } }}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map((t) => (
 <SelectItem key={t} value={t}>{ASSET_TYPE_LABELS[t]}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 {/* Stock specific with search dropdown */}
 {formType === 'stock' && (
 <>
 <div className="space-y-2">
 <Label>اختر السهم <span className="text-xs text-muted-foreground">(سيتم إضافته تلقائيًا لقائمة المراقبة)</span></Label>
 <StockSearchDropdown
 value={formTicker ? `${formTicker} - ${formName}` : ''}
 onSelect={(ticker, name, price) => handleStockSelect(ticker, name, price)}
 />
 </div>
 {formSelectedPrice && formSelectedPrice > 0 && (
 <div className="bg-muted rounded-md px-3 py-2 text-xs flex justify-between">
 <span className="text-muted-foreground">السعر الحالي للسهم</span>
 <span className="font-semibold" dir="ltr">{(formSelectedPrice ?? 0).toFixed(2)} ج.م</span>
 </div>
 )}
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2"><Label>الكمية</Label><Input type="number" value={formQuantity} onChange={(e) => {
 setFormQuantity(e.target.value);
 // Auto-calculate total invested
 const qty = parseInt(e.target.value) || 0;
 const buy = parseFloat(formAvgBuyPrice) || 0;
 if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
 }} placeholder="0" dir="ltr" /></div>
 <div className="space-y-2"><Label>متوسط سعر الشراء</Label><Input type="number" value={formAvgBuyPrice} onChange={(e) => {
 setFormAvgBuyPrice(e.target.value);
 const qty = parseInt(formQuantity) || 0;
 const buy = parseFloat(e.target.value) || 0;
 if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
 }} placeholder="0.00" dir="ltr" /></div>
 </div>
 {formQuantity && formAvgBuyPrice && parseFloat(formTotalInvested) > 0 && (
 <div className="bg-profit /20 border border-profit rounded-md px-3 py-2 text-sm">
 <span className="text-muted-foreground">إجمالي التكلفة: </span>
 <span className="font-bold text-profit ">{formatCurrency(parseFloat(formTotalInvested))}</span>
 </div>
 )}
 </>
 )}

 {/* Gold specific */}
 {formType === 'gold' && (
 <>
 <div className="space-y-2"><Label>اسم الأصل</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: سوار ذهب، خاتم" /></div>
 {goldPrices && (
 <div className="bg-warning /20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3 text-sm">
 <div className="font-semibold text-warning mb-2">أسعار الذهب الحالية (للجرام):</div>
 <div className="grid grid-cols-3 gap-2 text-xs">
 <div>عيار ٢٤: <span className="font-bold text-warning ">{goldPrices['24k']?.toFixed(2) || '—'} ج.م</span></div>
 <div>عيار ٢١: <span className="font-bold text-warning ">{goldPrices['21k']?.toFixed(2) || '—'} ج.م</span></div>
 <div>عيار ١٨: <span className="font-bold text-warning ">{goldPrices['18k']?.toFixed(2) || '—'} ج.م</span></div>
 </div>
 </div>
 )}
 <div className="grid grid-cols-3 gap-3">
 <div className="space-y-2"><Label>الوزن (جرام)</Label><Input type="number" value={formWeight} onChange={(e) => {
 setFormWeight(e.target.value);
 // حساب تلقائي: الوزن × سعر الجرام الحالي
 const weight = parseFloat(e.target.value) || 0;
 const karatVal = parseInt(formKarat) || 21;
 let gramPrice = goldPrices?.['21k'] || 0;
 if (karatVal === 24) gramPrice = goldPrices?.['24k'] || 0;
 else if (karatVal === 18) gramPrice = goldPrices?.['18k'] || 0;
 if (weight > 0 && gramPrice > 0) {
 setFormCurrentValue(String((weight * gramPrice).toFixed(2)));
 }
 }} placeholder="0" dir="ltr" /></div>
 <div className="space-y-2"><Label>العيار</Label>
 <Select value={formKarat} onValueChange={(v) => {
 setFormKarat(v);
 // إعادة الحساب عند تغيير العيار
 const weight = parseFloat(formWeight) || 0;
 let gramPrice = goldPrices?.['21k'] || 0;
 if (v === '24') gramPrice = goldPrices?.['24k'] || 0;
 else if (v === '18') gramPrice = goldPrices?.['18k'] || 0;
 if (weight > 0 && gramPrice > 0) {
 setFormCurrentValue(String((weight * gramPrice).toFixed(2)));
 }
 }}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent><SelectItem value="18">١٨</SelectItem><SelectItem value="21">٢١</SelectItem><SelectItem value="24">٢٤</SelectItem></SelectContent>
 </Select>
 </div>
 <div className="space-y-2"><Label>سعر الشراء/جرام</Label><Input type="number" value={formPricePerGram} onChange={(e) => {
 setFormPricePerGram(e.target.value);
 const weight = parseFloat(formWeight) || 0;
 const price = parseFloat(e.target.value) || 0;
 if (weight > 0 && price > 0) {
 setFormTotalInvested(String((weight * price).toFixed(2)));
 }
 }} placeholder="0.00" dir="ltr" /></div>
 </div>
 {formWeight && formPricePerGram && (
 <div className="bg-muted rounded-md px-3 py-2 text-sm flex justify-between">
 <span className="text-muted-foreground">تكلفة الشراء (المستثمر):</span>
 <span className="font-bold">{formatCurrency(parseFloat(formWeight) * parseFloat(formPricePerGram))}</span>
 </div>
 )}
 {formWeight && formCurrentValue && parseFloat(formCurrentValue) > 0 && (
 <div className="bg-profit /20 border border-profit rounded-md px-3 py-2 text-sm flex justify-between">
 <span className="text-muted-foreground">القيمة الحالية:</span>
 <span className="font-bold text-profit ">{formatCurrency(parseFloat(formCurrentValue))}</span>
 </div>
 )}
 </>
 )}

 {/* Bank specific */}
 {formType === 'bank' && (
 <>
 <div className="space-y-2"><Label>اسم الأصل</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: حساب التوفير" /></div>
 <div className="space-y-2"><Label>اسم البنك</Label><Input value={formBankName} onChange={(e) => setFormBankName(e.target.value)} placeholder="مثال: البنك الأهلي" /></div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2"><Label>الرصيد</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
 <div className="space-y-2"><Label>سعر الفائدة %</Label><Input type="number" value={formInterestRate} onChange={(e) => setFormInterestRate(e.target.value)} placeholder="0" dir="ltr" /></div>
 </div>
 </>
 )}

 {/* Certificate specific */}
 {formType === 'certificate' && (
 <>
 <div className="space-y-2"><Label>اسم الشهادة</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="شهادة التوفير" /></div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2"><Label>المبلغ</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
 <div className="space-y-2"><Label>المدة (شهر)</Label><Input type="number" value={formDuration} onChange={(e) => setFormDuration(e.target.value)} placeholder="0" dir="ltr" /></div>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2"><Label>العائد %</Label><Input type="number" value={formReturnRate} onChange={(e) => setFormReturnRate(e.target.value)} placeholder="0" dir="ltr" /></div>
 <div className="space-y-2"><Label>تاريخ الاستحقاق</Label><Input type="date" value={formMaturityDate} onChange={(e) => setFormMaturityDate(e.target.value)} dir="ltr" /></div>
 </div>
 </>
 )}

 {/* Fund specific */}
 {formType === 'fund' && (
 <>
 <div className="space-y-2"><Label>اسم الأصل</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: صندوق مصر" /></div>
 <div className="space-y-2"><Label>اسم الصندوق</Label><Input value={formFundName} onChange={(e) => setFormFundName(e.target.value)} placeholder="صندوق الأسهم" /></div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2">
 <Label>نوع الصندوق</Label>
 <Select value={formFundType} onValueChange={setFormFundType}>
 <SelectTrigger className="w-full"><SelectValue placeholder="اختر نوع الصندوق" /></SelectTrigger>
 <SelectContent>
 {FUND_TYPES.map((ft) => (
 <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-2"><Label>المبلغ المستثمر</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
 </div>
 <div className="space-y-2"><Label>القيمة الحالية</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} placeholder="0.00" dir="ltr" /></div>
 {formFundType === 'fixed_income' && (
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-profit /30 rounded-lg border border-profit ">
 <div className="space-y-2">
 <Label className="text-profit ">العائد السنوي %</Label>
 <Input type="number" step="0.01" value={formAnnualReturn} onChange={(e) => setFormAnnualReturn(e.target.value)} placeholder="مثال: 15.5" dir="ltr" />
 </div>
 <div className="space-y-2">
 <Label className="text-profit ">نوع العائد</Label>
 <Select value={formReturnType} onValueChange={(v) => setFormReturnType(v as 'annual' | 'monthly' | 'daily')}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="annual">سنوي</SelectItem>
 <SelectItem value="monthly">شهري</SelectItem>
 <SelectItem value="daily">يومي</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-2">
 <Label className="text-profit ">تاريخ الشراء</Label>
 <Input type="date" value={formPurchaseDate} onChange={(e) => setFormPurchaseDate(e.target.value)} dir="ltr" />
 </div>
 <p className="text-xs text-muted-foreground sm:col-span-3">
 سيتم حساب القيمة الحالية تلقائياً: القيمة الحالية = المبلغ المستثمر + (العائد اليومي × عدد الأيام منذ الشراء)
 </p>
 </div>
 )}
 </>
 )}

 {/* Other / default name + invested + current */}
 {(formType === 'real_estate' || formType === 'other') && (
 <>
 <div className="space-y-2"><Label>الاسم</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={formType === 'real_estate' ? 'اسم العقار' : 'اسم الأصل'} /></div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2"><Label>المبلغ المستثمر</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
 <div className="space-y-2"><Label>القيمة الحالية</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} placeholder="0.00" dir="ltr" /></div>
 </div>
 </>
 )}

 {/* ── Task 3: Crypto add-asset form (Live Portfolio Overhaul) ── */}
 {formType === 'crypto' && (
 <>
 <div className="space-y-2">
 <Label>اختر العملة <span className="text-xs text-muted-foreground">(من Binance)</span></Label>
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
 <div className="bg-warning /20 border border-orange-200 dark:border-orange-800 rounded-md px-3 py-2 text-xs flex justify-between">
 <span className="text-muted-foreground">السعر الحالي (USD)</span>
 <span className="font-semibold text-warning " dir="ltr">${(formSelectedPrice ?? 0).toFixed(2)}</span>
 </div>
 )}
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2">
 <Label>الكمية</Label>
 <Input type="number" value={formQuantity} onChange={(e) => {
 setFormQuantity(e.target.value);
 const qty = parseFloat(e.target.value) || 0;
 const buy = parseFloat(formAvgBuyPrice) || 0;
 if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
 }} placeholder="0.00" dir="ltr" />
 </div>
 <div className="space-y-2">
 <Label>سعر الشراء (USD)</Label>
 <Input type="number" value={formAvgBuyPrice} onChange={(e) => {
 setFormAvgBuyPrice(e.target.value);
 const qty = parseFloat(formQuantity) || 0;
 const buy = parseFloat(e.target.value) || 0;
 if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
 }} placeholder="0.00" dir="ltr" />
 </div>
 </div>
 {formQuantity && formAvgBuyPrice && parseFloat(formTotalInvested) > 0 && (
 <div className="bg-profit /20 border border-profit rounded-md px-3 py-2 text-sm">
 <span className="text-muted-foreground">إجمالي التكلفة (USD): </span>
 <span className="font-bold text-profit ">${parseFloat(formTotalInvested).toFixed(2)}</span>
 </div>
 )}
 <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
 💡 السعر بالدولار. القيمة الحالية هتتحدث تلقائياً من Binance كل 30 ثانية.
 </p>
 </>
 )}

 <div className="space-y-2"><Label>ملاحظات (اختياري)</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="أضف ملاحظاتك..." rows={2} /></div>
 </div>
 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" onClick={() => { resetForm(); setAddDialogOpen(false); }}>إلغاء</Button>
 <Button className="bg-profit hover:bg-profit text-white" onClick={handleSave} disabled={saving}>
 {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin ml-1.5" /> جاري الإضافة...</> : 'إضافة'}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Edit Dialog */}
 <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
 <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
 <DialogHeader><DialogTitle>تعديل الأصل</DialogTitle></DialogHeader>
 <div className="space-y-4">
 <div className="space-y-2">
 <Label>نوع الأصل</Label>
 <Input value={ASSET_TYPE_LABELS[formType] || formType} disabled className="bg-muted" />
 </div>
 {formType === 'stock' && editAsset?.stock_ticker && (
 <div className="space-y-2">
 <Label>السهم</Label>
 <Input value={`${editAsset.stock_ticker} - ${editAsset.name}`} disabled className="bg-muted" dir="ltr" />
 </div>
 )}
 {formType !== 'stock' && (
 <div className="space-y-2"><Label>الاسم</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
 )}
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2">
 <Label>{formType === 'stock' ? 'متوسط سعر الشراء' : 'المبلغ المستثمر'}</Label>
 <Input type="number" value={formAvgBuyPrice || formTotalInvested} onChange={(e) => {
 if (formType === 'stock') setFormAvgBuyPrice(e.target.value);
 else setFormTotalInvested(e.target.value);
 }} dir="ltr" />
 </div>
 {formType === 'stock' ? (
 <div className="space-y-2"><Label>الكمية</Label><Input type="number" value={formQuantity} onChange={(e) => setFormQuantity(e.target.value)} dir="ltr" /></div>
 ) : (
 <div className="space-y-2"><Label>القيمة الحالية</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} dir="ltr" /></div>
 )}
 </div>
 {formType === 'stock' && (
 <div className="space-y-2">
 <Label>القيمة الحالية (تلقائية من السوق)</Label>
 <Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} dir="ltr" placeholder="0.00" />
 </div>
 )}
 <div className="space-y-2"><Label>ملاحظات</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} /></div>
 </div>
 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" onClick={() => setEditDialogOpen(false)}>إلغاء</Button>
 <Button className="bg-profit hover:bg-profit text-white" onClick={handleEditSave} disabled={saving}>
 {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin ml-1.5" /> جاري الحفظ...</> : 'حفظ'}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Delete Confirmation */}
 <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
 <DialogContent className="sm:max-w-sm" dir="rtl">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-loss"><AlertTriangle className="w-5 h-5" /> تأكيد الحذف</DialogTitle>
 <DialogDescription>هل أنت متأكد من حذف هذا الأصل؟ لا يمكن التراجع عن هذا الإجراء.</DialogDescription>
 </DialogHeader>
 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" onClick={() => setDeleteId(null)}>إلغاء</Button>
 <Button className="bg-loss hover:bg-loss text-white" onClick={handleDelete}>حذف</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* P39-PHASE-2: DynamicRiskProfilerModal — mounted at the end so the
 "إعادة اختبار الشخصية" button can open it. On complete it just closes;
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
 const assetMeta: Record<WealthAllocationAlert['asset'], { label: string; icon: React.ReactNode }> = {
 egx: { label: 'الأسهم المصرية', icon: <TrendingUp className="w-4 h-4" /> },
 crypto: { label: 'العملات الرقمية', icon: <Bitcoin className="w-4 h-4" /> },
 gold: { label: 'الذهب', icon: <Gem className="w-4 h-4" /> },
 cash: { label: 'السيولة', icon: <Banknote className="w-4 h-4" /> },
 };
 const severityBorder: Record<WealthAllocationAlert['severity'], string> = {
 ok: 'border-profit /60',
 warning: 'border-warning /60',
 critical: 'border-loss /70',
 };
 const severityText: Record<WealthAllocationAlert['severity'], string> = {
 ok: 'text-profit ',
 warning: 'text-warning ',
 critical: 'text-loss ',
 };
 const orderedAssets: WealthAllocationAlert['asset'][] = ['egx', 'crypto', 'gold', 'cash'];
 const visibleAlerts = alerts.filter((a) => a.severity !== 'ok');

 return (
 <Card dir="rtl" className="border-2 border-profit/20">
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <CardTitle className="text-sm md:text-base font-bold flex items-center gap-2">
 <Scale className="w-4 h-4 text-profit" />
 مصفوفة توزيع الثروة — شخصية: {personaLabel}
 </CardTitle>
 <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
 <Shield className="w-3 h-3" />
 سقوف {personaLabel}
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
 className={cn('rounded-lg border-2 p-3 bg-card', severityBorder[alert.severity])}
 >
 <div className="flex items-center gap-2 mb-2">
 <span className={cn('flex-shrink-0', severityText[alert.severity])}>{meta.icon}</span>
 <span className="text-xs font-semibold truncate">{meta.label}</span>
 </div>
 <div className="flex items-baseline gap-1.5 mb-2">
 <span className={cn('text-2xl font-bold', severityText[alert.severity])}>
 {(alert.currentPercent ?? 0).toFixed(1)}%
 </span>
 <span className="text-xs text-muted-foreground">
 / سقف {alert.ceilingPercent}%
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
 alert.severity === 'critical' && '[&>[data-slot=progress-indicator]]:bg-loss',
 alert.severity === 'warning' && '[&>[data-slot=progress-indicator]]:bg-warning',
 alert.severity === 'ok' && '[&>[data-slot=progress-indicator]]:bg-profit',
 )}
 />
 {/* Vertical red line at the ceiling position */}
 {ceilingPos > 0 && ceilingPos < 100 && (
 <div
 className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-loss rounded-full"
 style={{ left: `${ceilingPos}%` }}
 title={`السقف: ${alert.ceilingPercent}%`}
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
 ? 'bg-loss /30 text-loss '
 : 'bg-warning /30 text-warning ',
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
 إعادة التوازن التلقائي
 </Button>
 {visibleAlerts.length === 0 && (
 <span className="text-xs text-profit flex items-center gap-1">
 <CheckCircle2 className="w-3.5 h-3.5" />
 المحفظة متوازنة وفقاً لشخصيتك الاستثمارية
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
 } catch {
 if (!silent) toast.error('فشل في تحميل المعاملات');
 } finally {
 if (!silent) setLoading(false);
 }
 }, [month, year]);

 useEffect(() => { loadTransactions(); }, [loadTransactions]);

 const handleSave = async () => {
 if (!formCategory || !formAmount) { toast.error('يرجى ملء جميع الحقول المطلوبة'); return; }
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
 toast.success('تمت إضافة المعاملة بنجاح');
 setAddDialogOpen(false);
 setFormCategory(''); setFormAmount(''); setFormDescription('');
 // UI-STABILITY fix (2026-09-28): silent refresh after save — keep table state
 loadTransactions(true);
 } else {
 toast.error(data.error || 'فشل في إضافة المعاملة');
 }
 } catch {
 toast.error(t('portfolio.toast.connectionError'));
 }
 };

 const handleDelete = async (id: number) => {
 try {
 const res = await fetch(`/api/finance/transactions/${id}`, { method: 'DELETE' });
 const data = await res.json();
 if (data.success) {
 toast.success('تم حذف المعاملة');
 // UI-STABILITY fix (2026-09-28): silent refresh after delete
 loadTransactions(true);
 } else {
 toast.error(data.error || 'فشل في الحذف');
 }
 } catch {
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
 header: 'النوع',
 sortable: true,
 filterable: true,
 render: (t) => (
 <Badge className={t.type === 'income' ? 'bg-profit text-profit /30 ' : 'bg-loss text-loss /30 '}>
 {t.type === 'income' ? 'دخل' : 'مصروف'}
 </Badge>
 ),
 },
 {
 key: 'category',
 header: 'التصنيف',
 sortable: true,
 filterable: true,
 className: 'text-sm',
 },
 {
 key: 'amount',
 header: 'المبلغ',
 align: 'center',
 sortable: true,
 filterable: true,
 render: (t) => (
 <span className={cn('font-semibold text-sm', t.type === 'income' ? 'text-profit ' : 'text-loss ')}>
 {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
 </span>
 ),
 },
 {
 key: 'description',
 header: 'الوصف',
 filterable: true,
 className: 'text-xs text-muted-foreground',
 render: (t) => (
 <span className="block max-w-[150px] truncate" title={t.description || ''}>
 {t.description || '—'}
 </span>
 ),
 },
 {
 key: 'transaction_date',
 header: 'التاريخ',
 sortable: true,
 filterable: true,
 className: 'text-xs text-muted-foreground',
 render: (t) => <span dir="ltr">{t.transaction_date}</span>,
 },
 {
 key: '_delete',
 header: 'إجراءات',
 align: 'center',
 render: (t) => (
 <Button
 variant="ghost"
 size="icon"
 className="h-9 w-9 text-muted-foreground hover:text-loss"
 onClick={(e) => { e.stopPropagation(); if (t.id != null) handleDelete(t.id); }}
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

 const arabicMonths = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
 const currentMonthLabel = arabicMonths[parseInt(month) - 1] + ' ' + year;

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
 <Button className="bg-profit hover:bg-profit text-white" size="sm" onClick={() => setAddDialogOpen(true)}>
 <Plus className="w-4 h-4 ml-1.5" />
 إضافة معاملة
 </Button>
 </div>

 {/* Summary Row */}
 {summary && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <Card className="p-4">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <ArrowUpRight className="w-4 h-4 text-profit" />
 <span className="text-xs font-medium">إجمالي الدخل</span>
 </div>
 <p className="text-lg font-bold text-profit ">{formatCurrency(summary.total_income)}</p>
 </Card>
 <Card className="p-4">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <ArrowDownRight className="w-4 h-4 text-loss" />
 <span className="text-xs font-medium">إجمالي المصروفات</span>
 </div>
 <p className="text-lg font-bold text-loss ">{formatCurrency(summary.total_expenses)}</p>
 </Card>
 <Card className="p-4">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <PiggyBank className="w-4 h-4 text-whale" />
 <span className="text-xs font-medium">صافي الادخار</span>
 </div>
 <p className="text-lg font-bold text-whale ">{formatCurrency(summary.net_savings)}</p>
 </Card>
 <Card className="p-4">
 <div className="flex items-center gap-2 text-muted-foreground mb-1">
 <TrendingUp className="w-4 h-4" />
 <span className="text-xs font-medium">نسبة الادخار</span>
 </div>
 <p className="text-lg font-bold">{(savingsRate ?? 0).toFixed(1)}%</p>
 <Progress value={Math.min(savingsRate, 100)} className="h-2 mt-2" />
 </Card>
 </div>
 )}

 {/* Expenses breakdown bars */}
 {summary && summary.expenses_by_category && Object.keys(summary.expenses_by_category).length > 0 && (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm">توزيع المصروفات</CardTitle>
 </CardHeader>
 <CardContent className="space-y-2">
 {Object.entries(summary.expenses_by_category)
 .sort(([, a], [, b]) => b - a)
 .slice(0, 6)
 .map(([cat, amount]) => {
 const pct = summary.total_expenses > 0 ? (amount / summary.total_expenses) * 100 : 0;
 const catInfo = EXPENSE_CATEGORIES.find((c) => c.value === cat);
 const label = catInfo?.label || cat;
 return (
 <div key={cat} className="space-y-1">
 <div className="flex justify-between text-xs">
 <span className="text-muted-foreground">{label}</span>
 <span className="font-medium">{formatCurrency(amount)} ({(pct ?? 0).toFixed(1)}%)</span>
 </div>
 <div className="h-2 rounded-full bg-muted overflow-hidden">
 <div className="h-full rounded-full bg-loss transition-all" style={{ width: `${pct}%` }} />
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
 <CardTitle className="text-sm">المعاملات الأخيرة</CardTitle>
 {transactions.length > 0 && (
 <UnifiedPublishButton
 variant="outline"
 size="sm"
 title="المعاملات الأخيرة"
 content={`المعاملات الأخيرة\n${transactions.slice(0, 20).map((t, i) => `${i + 1}. ${t.type === 'income' ? 'دخل' : 'مصروف'} — ${t.category} — ${formatCurrency(t.amount)} ج.م — ${t.transaction_date}`).join('\n')}`}
 filename={`transactions-${Date.now()}`}
 hashtags={['معاملات', 'محفظة']}
 triggerLabel="نشر"
 />
 )}
 </div>
 </CardHeader>
 <CardContent>
 {transactions.length === 0 ? (
 <p className="text-sm text-muted-foreground text-center py-8">لا توجد معاملات لهذا الشهر</p>
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
 publishTitle="معاملات المحفظة المالية"
 publishFilename={`portfolio-transactions-${new Date().toISOString().slice(0,10)}`}
 publishHashtags={['محفظة_استثمارية', 'بورصة_مصر', 'EGX', 'استثمار']}
 />
 )}
 </CardContent>
 </Card>

 {/* Add Transaction Dialog */}
 <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
 <DialogContent className="sm:max-w-lg w-[calc(100%-1rem)]" dir="rtl">
 <DialogHeader>
 <DialogTitle>إضافة معاملة</DialogTitle>
 <DialogDescription>سجل دخل أو مصروف جديد</DialogDescription>
 </DialogHeader>
 <div className="space-y-4 py-2">
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2">
 <Label>النوع</Label>
 <Select value={transType} onValueChange={(v) => { setTransType(v as TransactionType); setFormCategory(''); }}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="income">دخل</SelectItem>
 <SelectItem value="expense">مصروف</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-2">
 <Label>التصنيف</Label>
 <Select value={formCategory} onValueChange={setFormCategory}>
 <SelectTrigger className="w-full"><SelectValue placeholder="اختر..." /></SelectTrigger>
 <SelectContent>
 {(transType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
 <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>
 <div className="space-y-2"><Label>المبلغ (ج.م)</Label><Input type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} placeholder="0.00" dir="ltr" /></div>
 <div className="space-y-2"><Label>الوصف</Label><Input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="وصف المعاملة..." /></div>
 <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} dir="ltr" /></div>
 <div className="flex items-center gap-3">
 <Checkbox checked={formIsRecurring} onCheckedChange={(v) => setFormIsRecurring(v === true)} />
 <Label>متكرر؟</Label>
 </div>
 {formIsRecurring && (
 <div className="space-y-2">
 <Label>التكرار</Label>
 <Select value={formFrequency} onValueChange={setFormFrequency}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="monthly">شهري</SelectItem>
 <SelectItem value="weekly">أسبوعي</SelectItem>
 <SelectItem value="yearly">سنوي</SelectItem>
 </SelectContent>
 </Select>
 </div>
 )}
 </div>
 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" onClick={() => setAddDialogOpen(false)}>إلغاء</Button>
 <Button className="bg-profit hover:bg-profit text-white" onClick={handleSave}>حفظ</Button>
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
 } catch {
 if (!silent) toast.error('فشل في تحميل الالتزامات');
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
 toast.success('تمت إضافة الالتزام بنجاح');
 setAddDialogOpen(false);
 resetForm();
 // UI-STABILITY fix (2026-09-28): silent refresh after add — keep table state
 loadObligations(true);
 } else {
 toast.error(data.error || 'فشل في إضافة الالتزام');
 }
 } catch {
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
 toast.success('تم تحديث الالتزام');
 setEditDialogOpen(false);
 // UI-STABILITY fix (2026-09-28): silent refresh after edit
 loadObligations(true);
 } else {
 toast.error(data.error || 'فشل في التحديث');
 }
 } catch {
 toast.error(t('portfolio.toast.connectionError'));
 }
 };

 const handleDelete = async () => {
 if (!deleteId) return;
 try {
 const res = await fetch(`/api/finance/obligations/${deleteId}`, { method: 'DELETE' });
 const data = await res.json();
 if (data.success) {
 toast.success('تم حذف الالتزام');
 setDeleteId(null);
 // UI-STABILITY fix (2026-09-28): silent refresh after delete
 loadObligations(true);
 } else {
 toast.error(data.error || 'فشل في الحذف');
 }
 } catch {
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
 toast.success('تم تسجيل الدفعة بنجاح');
 setPaymentDialogOpen(false);
 // UI-STABILITY fix (2026-09-28): silent refresh after payment
 loadObligations(true);
 } else {
 toast.error(data.error || 'فشل في تسجيل الدفعة');
 }
 } catch {
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
 <Card className="p-4">
 <div className="flex items-center gap-2 text-muted-foreground mb-1"><CreditCard className="w-4 h-4" /><span className="text-xs font-medium">إجمالي المديونية</span></div>
 <p className="text-lg font-bold text-loss ">{formatCurrency(totalDebt)}</p>
 </Card>
 <Card className="p-4">
 <div className="flex items-center gap-2 text-muted-foreground mb-1"><CalendarDays className="w-4 h-4" /><span className="text-xs font-medium">الأقساط الشهرية</span></div>
 <p className="text-lg font-bold">{formatCurrency(monthlyPayments)}</p>
 </Card>
 <Card className="p-4">
 <div className="flex items-center gap-2 text-muted-foreground mb-1"><FileText className="w-4 h-4" /><span className="text-xs font-medium">القروض النشطة</span></div>
 <p className="text-lg font-bold">{activeLoans}</p>
 </Card>
 </div>

 {/* Add Button */}
 <div className="flex justify-end">
 <Button className="bg-profit hover:bg-profit text-white" size="sm" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
 <Plus className="w-4 h-4 ml-1.5" />
 إضافة التزام
 </Button>
 </div>

 {/* Obligations List */}
 {(obligations || []).length === 0 ? (
 <Card className="border-dashed">
 <CardContent className="flex flex-col items-center justify-center py-12 text-center">
 <CreditCard className="w-10 h-10 text-muted-foreground mb-3" />
 <h3 className="text-lg font-semibold mb-1">لا توجد التزامات</h3>
 <p className="text-sm text-muted-foreground">أضف التزاماتك المالية لتتبعها</p>
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
 <Badge className={OBLIGATION_STATUS_COLORS[ob.status]}>{OBLIGATION_STATUS_LABELS[ob.status]}</Badge>
 <Badge variant="outline">{OBLIGATION_TYPE_LABELS[ob.type] || ob.type}</Badge>
 <h3 className="font-semibold text-sm">{ob.name}</h3>
 </div>
 <div className="flex items-center gap-1">
 <Button variant="outline" size="sm" onClick={() => openPayment(ob)}>تسجيل دفعة</Button>
 <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(ob)}><Pencil className="w-3.5 h-3.5" /></Button>
 <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-loss" onClick={() => setDeleteId(ob.id!)}><Trash2 className="w-3.5 h-3.5" /></Button>
 </div>
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
 <div><span className="text-muted-foreground">الدائن:</span> <span className="font-medium">{ob.creditor}</span></div>
 <div><span className="text-muted-foreground">المتبقي:</span> <span className="font-medium text-loss ">{formatCurrency(ob.remaining_amount)}</span></div>
 <div><span className="text-muted-foreground">القسط الشهري:</span> <span className="font-medium">{formatCurrency(ob.monthly_payment)}</span></div>
 {ob.interest_rate && <div><span className="text-muted-foreground">الفائدة:</span> <span className="font-medium">{ob.interest_rate}%</span></div>}
 </div>
 <div className="mt-3 space-y-1">
 <div className="flex justify-between text-xs">
 <span className="text-muted-foreground">تم السداد</span>
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
 <DialogTitle>إضافة التزام جديد</DialogTitle>
 <DialogDescription>سجل قرض أو التزام مالي</DialogDescription>
 </DialogHeader>
 <div className="space-y-4 py-2">
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2">
 <Label>النوع</Label>
 <Select value={formType} onValueChange={setFormType}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 {Object.entries(OBLIGATION_TYPE_LABELS).map(([k, v]) => (
 <SelectItem key={k} value={k}>{v}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-2"><Label>اسم الالتزام</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="قرض شخصي" /></div>
 </div>
 <div className="space-y-2"><Label>الدائن</Label><Input value={formCreditor} onChange={(e) => setFormCreditor(e.target.value)} placeholder="البنك / الشخص" /></div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2"><Label>إجمالي المبلغ</Label><Input type="number" value={formTotalAmount} onChange={(e) => setFormTotalAmount(e.target.value)} placeholder="0.00" dir="ltr" /></div>
 <div className="space-y-2"><Label>المبلغ المتبقي</Label><Input type="number" value={formRemainingAmount} onChange={(e) => setFormRemainingAmount(e.target.value)} placeholder="0.00" dir="ltr" /></div>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2"><Label>القسط الشهري</Label><Input type="number" value={formMonthlyPayment} onChange={(e) => setFormMonthlyPayment(e.target.value)} placeholder="0.00" dir="ltr" /></div>
 <div className="space-y-2"><Label>سعر الفائدة %</Label><Input type="number" value={formInterestRate} onChange={(e) => setFormInterestRate(e.target.value)} placeholder="0" dir="ltr" /></div>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2"><Label>تاريخ البداية</Label><Input type="date" value={formStartDate} onChange={(e) => setFormStartDate(e.target.value)} dir="ltr" /></div>
 <div className="space-y-2"><Label>تاريخ النهاية</Label><Input type="date" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} dir="ltr" /></div>
 </div>
 <div className="space-y-2"><Label>تاريخ القسط القادم</Label><Input type="date" value={formNextPaymentDate} onChange={(e) => setFormNextPaymentDate(e.target.value)} dir="ltr" /></div>
 <div className="space-y-2"><Label>ملاحظات</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} /></div>
 </div>
 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" onClick={() => { resetForm(); setAddDialogOpen(false); }}>إلغاء</Button>
 <Button className="bg-profit hover:bg-profit text-white" onClick={handleSave}>إضافة</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Record Payment Dialog */}
 <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
 <DialogContent className="sm:max-w-md" dir="rtl">
 <DialogHeader>
 <DialogTitle>تسجيل دفعة — {paymentObligation?.name}</DialogTitle>
 </DialogHeader>
 <div className="space-y-4 py-2">
 <div className="space-y-2"><Label>المبلغ</Label><Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} dir="ltr" /></div>
 <div className="space-y-2"><Label>تاريخ الدفع</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} dir="ltr" /></div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2"><Label>مبلغ الأصل</Label><Input type="number" value={payPrincipal} onChange={(e) => setPayPrincipal(e.target.value)} placeholder="اختياري" dir="ltr" /></div>
 <div className="space-y-2"><Label>مبلغ الفائدة</Label><Input type="number" value={payInterest} onChange={(e) => setPayInterest(e.target.value)} placeholder="اختياري" dir="ltr" /></div>
 </div>
 </div>
 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>إلغاء</Button>
 <Button className="bg-profit hover:bg-profit text-white" onClick={handlePayment}>تسجيل</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Edit Dialog */}
 <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
 <DialogContent className="sm:max-w-md" dir="rtl">
 <DialogHeader><DialogTitle>تعديل الالتزام — {editItem?.name}</DialogTitle></DialogHeader>
 <div className="space-y-4">
 <div className="space-y-2"><Label>الاسم</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2"><Label>المبلغ المتبقي</Label><Input type="number" value={formRemainingAmount} onChange={(e) => setFormRemainingAmount(e.target.value)} dir="ltr" /></div>
 <div className="space-y-2"><Label>القسط الشهري</Label><Input type="number" value={formMonthlyPayment} onChange={(e) => setFormMonthlyPayment(e.target.value)} dir="ltr" /></div>
 </div>
 <div className="space-y-2"><Label>ملاحظات</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} /></div>
 </div>
 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" onClick={() => setEditDialogOpen(false)}>إلغاء</Button>
 <Button className="bg-profit hover:bg-profit text-white" onClick={handleEditSave}>حفظ</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Delete Confirmation */}
 <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
 <DialogContent className="sm:max-w-sm" dir="rtl">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-loss"><AlertTriangle className="w-5 h-5" /> تأكيد الحذف</DialogTitle>
 <DialogDescription>هل أنت متأكد من حذف هذا الالتزام؟</DialogDescription>
 </DialogHeader>
 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" onClick={() => setDeleteId(null)}>إلغاء</Button>
 <Button className="bg-loss hover:bg-loss text-white" onClick={handleDelete}>حذف</Button>
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
 } catch {
 toast.error('فشل في تحميل الحالة المالية');
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
 <Wallet className="w-5 h-5 text-profit " />
 نظرة عامة على الحالة المالية
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div className="text-center p-3 rounded-lg bg-profit /20">
 <p className="text-xs text-muted-foreground mb-1">إجمالي الأصول</p>
 <p className="text-lg font-bold text-profit ">{formatCurrency(totalAssets)}</p>
 <p className="text-xs text-muted-foreground mt-1">أسهم + ذهب + بنك + شهادات + صناديق</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-loss /20">
 <p className="text-xs text-muted-foreground mb-1">إجمالي الالتزامات</p>
 <p className="text-lg font-bold text-loss ">{formatCurrency(totalLiabilities)}</p>
 <p className="text-xs text-muted-foreground mt-1">قروض + أقساط + ديون</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-primary /20">
 <p className="text-xs text-muted-foreground mb-1">صافي الثروة</p>
 <p className={cn('text-lg font-bold', netWorth >= 0 ? 'text-whale ' : 'text-loss ')}>
 {formatCurrency(netWorth)}
 </p>
 <p className="text-xs text-muted-foreground mt-1">الأصول - الالتزامات</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-warning /20">
 <p className="text-xs text-muted-foreground mb-1">المدخرات الشهرية</p>
 <p className={cn('text-lg font-bold', (reports?.monthly_savings ?? 0) >= 0 ? 'text-warning ' : 'text-loss ')}>
 {formatCurrency(reports?.monthly_savings ?? 0)}
 </p>
 <p className="text-xs text-muted-foreground mt-1">الدخل - المصروفات</p>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Investment Returns - NEW */}
 {investmentReturns && investmentReturns.total_monthly > 0 && (
 <Card className="border-profit ">
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <TrendingUp className="w-5 h-5 text-profit " />
 عوائد الاستثمارات الشهرية
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 {investmentReturns.bank_monthly > 0 && (
 <div className="p-3 rounded-lg bg-primary /20 text-center">
 <p className="text-xs text-muted-foreground mb-1">عائد البنك الشهري</p>
 <p className="text-base font-bold text-whale ">{formatCurrency(investmentReturns.bank_monthly)}</p>
 </div>
 )}
 {investmentReturns.certificate_monthly > 0 && (
 <div className="p-3 rounded-lg bg-primary /20 text-center">
 <p className="text-xs text-muted-foreground mb-1">عائد الشهادات الشهري</p>
 <p className="text-base font-bold text-primary ">{formatCurrency(investmentReturns.certificate_monthly)}</p>
 </div>
 )}
 {investmentReturns.fund_monthly > 0 && (
 <div className="p-3 rounded-lg bg-warning /20 text-center">
 <p className="text-xs text-muted-foreground mb-1">عائد الصناديق الشهري</p>
 <p className="text-base font-bold text-warning ">{formatCurrency(investmentReturns.fund_monthly)}</p>
 </div>
 )}
 <div className="p-3 rounded-lg bg-profit /20 text-center">
 <p className="text-xs text-muted-foreground mb-1">إجمالي العائد الشهري</p>
 <p className="text-base font-bold text-profit ">{formatCurrency(investmentReturns.total_monthly)}</p>
 </div>
 </div>
 <div className="flex items-center justify-between pt-2 border-t">
 <span className="text-sm text-muted-foreground">العائد السنوي المتوقع</span>
 <span className="font-bold text-profit ">{formatCurrency(investmentReturns.total_yearly)}</span>
 </div>
 </CardContent>
 </Card>
 )}

 {/* Income vs Expenses */}
 {reports && (
 <Card>
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <TrendingUp className="w-5 h-5 text-profit " />
 الدخل مقابل المصروفات (الشهر الحالي)
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid grid-cols-2 gap-4">
 <div>
 <div className="flex justify-between text-sm mb-1">
 <span className="text-muted-foreground">إجمالي الدخل</span>
 <span className="font-medium text-profit ">{formatCurrency(reports.monthly_income)}</span>
 </div>
 <div className="h-3 rounded-full bg-muted overflow-hidden">
 <div className="h-full rounded-full bg-profit" style={{ width: '100%' }} />
 </div>
 {investmentReturns && investmentReturns.total_monthly > 0 && (
 <p className="text-xs text-muted-foreground mt-1">
 يشمل {formatCurrency(investmentReturns.total_monthly)} عوائد استثمارات
 </p>
 )}
 </div>
 <div>
 <div className="flex justify-between text-sm mb-1">
 <span className="text-muted-foreground">إجمالي المصروفات</span>
 <span className="font-medium text-loss ">{formatCurrency(reports.monthly_expenses)}</span>
 </div>
 <div className="h-3 rounded-full bg-muted overflow-hidden">
 <div className="h-full rounded-full bg-loss" style={{ width: `${reports.monthly_income > 0 ? Math.min((reports.monthly_expenses / reports.monthly_income) * 100, 100) : 0}%` }} />
 </div>
 </div>
 </div>
 <div className="flex items-center justify-between pt-2 border-t">
 <span className="text-sm text-muted-foreground">نسبة الادخار</span>
 <div className="flex items-center gap-2">
 <Progress value={Math.min(Math.max(reports.savings_rate ?? 0, 0), 100)} className="h-2 w-24" />
 <span className="font-bold text-sm">{(reports.savings_rate ?? 0).toFixed(1)}%</span>
 </div>
 </div>
 <div className="flex items-center justify-between pt-2 border-t">
 <span className="text-sm text-muted-foreground">صافي الادخار الشهري</span>
 <span className={cn('font-bold', (reports.monthly_savings ?? 0) >= 0 ? 'text-profit ' : 'text-loss ')}>
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
 <AlertTriangle className="w-5 h-5 text-warning" />
 تنبيهات وتحليلات مالية
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 {safeAlerts.map((alert: FinancialAlert, idx: number) => (
 <div
 key={idx}
 className={cn(
 'flex items-start gap-3 p-3 rounded-lg border',
 alert.type === 'danger' && 'bg-loss border-loss /20 /50',
 alert.type === 'warning' && 'bg-warning border-yellow-200 /20 dark:border-yellow-900/50',
 alert.type === 'info' && 'bg-primary border-whale /20 /50'
 )}
 >
 {alert.type === 'danger' && <XCircle className="w-5 h-5 text-loss mt-0.5 flex-shrink-0" />}
 {alert.type === 'warning' && <AlertCircle className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />}
 {alert.type === 'info' && <CheckCircle2 className="w-5 h-5 text-whale mt-0.5 flex-shrink-0" />}
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
 <Coins className="w-5 h-5 text-profit " />
 توزيع الأصول
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 {(Object.entries(assetsByType) as [string, number][])
 .sort(([, a], [, b]) => b - a)
 .map(([type, value]) => {
 const pct = totalAssets > 0 ? (value / totalAssets) * 100 : 0;
 const label = ASSET_TYPE_LABELS[type as AssetType] || type;
 const colorClass = ASSET_TYPE_COLORS[type as AssetType] || 'bg-muted';
 const barColor = type === 'stock' ? 'bg-profit' : type === 'gold' ? 'bg-warning' : type === 'bank' ? 'bg-whale' : type === 'certificate' ? 'bg-primary' : type === 'fund' ? 'bg-warning' : 'bg-whale';
 return (
 <div key={type} className="space-y-1">
 <div className="flex justify-between text-xs">
 <div className="flex items-center gap-2">
 <Badge className={cn('text-xs px-1.5', colorClass)}>{label}</Badge>
 </div>
 <span className="font-medium">{formatCurrency(value)} ({(pct ?? 0).toFixed(1)}%)</span>
 </div>
 <div className="h-2.5 rounded-full bg-muted overflow-hidden">
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
 <Card className="border-warning ">
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <Zap className="w-5 h-5 text-warning" />
 تحليلات خبير اقتصادي
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 {/* Portfolio Health Score */}
 <div className="p-3 rounded-lg bg-gradient-to-r from-profit to-primary /20 dark:to-primary/20">
 <div className="flex items-center justify-between mb-2">
 <span className="font-medium text-sm">تقييم صحة المحفظة</span>
 <span className="text-2xl font-bold text-profit ">
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
 <div className="flex items-start gap-3 p-3 rounded-lg bg-warning /20 border border-yellow-200 dark:border-yellow-800">
 <AlertCircle className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
 <div>
 <p className="text-sm font-medium text-warning ">تنويع المحفظة</p>
 <p className="text-xs text-muted-foreground mt-1">
 الأسهم تمثل {(stockPercent ?? 0).toFixed(1)}% من محفظتك. يُنصح بتقليل النسبة إلى 30-40% وتوزيع الباقي على شهادات وصناديق استثمار.
 </p>
 </div>
 </div>
 )}

 {/* Good: High Bank Returns */}
 {bankPercent > 60 && investmentReturns && investmentReturns.bank_monthly > 0 && (
 <div className="flex items-start gap-3 p-3 rounded-lg bg-primary /20 border border-whale ">
 <CheckCircle2 className="w-5 h-5 text-whale mt-0.5 flex-shrink-0" />
 <div>
 <p className="text-sm font-medium text-whale ">عوائد بنكية ممتازة</p>
 <p className="text-xs text-muted-foreground mt-1">
 لديك {formatCurrency(investmentReturns.bank_monthly)} دخل شهري من البنك. هذا يوفر استقرار مالي جيد.
 </p>
 </div>
 </div>
 )}

 {/* Suggestion: Add Gold */}
 {goldPercent < 5 && totalAssets > 100000 && (
 <div className="flex items-start gap-3 p-3 rounded-lg bg-warning /20 border border-warning ">
 <Info className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
 <div>
 <p className="text-sm font-medium text-warning ">إضافة الذهب</p>
 <p className="text-xs text-muted-foreground mt-1">
 يُنصح بتخصيص 5-10% من محفظتك للذهب كتحوط ضد التضخم.
 </p>
 </div>
 </div>
 )}

 {/* Suggestion: Emergency Fund */}
 {investmentReturns && investmentReturns.total_monthly > 0 && (
 <div className="flex items-start gap-3 p-3 rounded-lg bg-profit /20 border border-profit ">
 <PiggyBank className="w-5 h-5 text-profit mt-0.5 flex-shrink-0" />
 <div>
 <p className="text-sm font-medium text-profit ">صندوق الطوارئ</p>
 <p className="text-xs text-muted-foreground mt-1">
 ادخار 3-6 أشهر من المصروفات ({formatCurrency((reports?.monthly_expenses || 0) * 3)} - {formatCurrency((reports?.monthly_expenses || 0) * 6)}) في حساب منفصل للطوارئ.
 </p>
 </div>
 </div>
 )}
 </>
 );
 })()}
 </div>

 {/* Money Distribution Plan */}
 <div className="mt-4 p-4 rounded-lg bg-gradient-to-r from-profit via-primary to-purple-50 /20 dark:via-primary/20 dark:to-purple-900/20 border">
 <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
 <Coins className="w-4 h-4" />
 خطة توزيع الأموال المقترحة
 </h4>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
 <div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
 <p className="font-bold text-profit">50%</p>
 <p className="text-muted-foreground">احتياجات أساسية</p>
 <p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.5)}</p>
 </div>
 <div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
 <p className="font-bold text-whale">20%</p>
 <p className="text-muted-foreground">ادخار واستثمار</p>
 <p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.2)}</p>
 </div>
 <div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
 <p className="font-bold text-primary">20%</p>
 <p className="text-muted-foreground">تطوير وترفيه</p>
 <p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.2)}</p>
 </div>
 <div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
 <p className="font-bold text-warning">10%</p>
 <p className="text-muted-foreground">تبرعات وزكاة</p>
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
 <FileText className="w-10 h-10 text-muted-foreground mb-3" />
 <h3 className="text-lg font-semibold mb-1">لا توجد بيانات كافية</h3>
 <p className="text-sm text-muted-foreground">أضف أصول ومعاملات مالية (دخل ومصروفات) لعرض الحالة المالية</p>
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
 // view as sub-tabs so the user has ONE entry point (المحفظة) for everything
 // money-related. The 3-way segmented control below switches between:
 // • portfolio — the existing 4-tab portfolio experience (assets / income / obligations / reports)
 // • wealth — the WealthCharts dashboard (was previously its own top-level tab #wealth)
 // • rescue — BagHolderRescuePanel (was previously in the "More" menu as 🆘 إنقاذ سهم)
 // Hash links #wealth, #bagholder-rescue, #advanced-portfolio still route
 // through page.tsx's switch (backwards-compat preserved per Rule 67).
 const [portfolioMode, setPortfolioMode] = useState<'portfolio' | 'wealth' | 'rescue'>('portfolio');

 return (
 <div dir="rtl" className="min-h-screen bg-background pb-20 lg:pb-4">
 <div className="p-4 md:p-6 space-y-6">
 {/* Header */}
 <div className="flex items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-profit /30 flex items-center justify-center">
 {portfolioMode === 'portfolio' && <Wallet className="w-5 h-5 text-profit " />}
 {portfolioMode === 'wealth' && <HandCoins className="w-5 h-5 text-warning " />}
 {portfolioMode === 'rescue' && <LifeBuoy className="w-5 h-5 text-loss " />}
 </div>
 <div>
 <h1 className="text-xl font-bold">
 {portfolioMode === 'portfolio' && t('portfolio.title')}
 {portfolioMode === 'wealth' && 'إدارة الأموال'}
 {portfolioMode === 'rescue' && '🆘 إنقاذ سهم خسران'}
 </h1>
 <p className="text-sm text-muted-foreground">
 {portfolioMode === 'portfolio' && t('portfolio.subtitle')}
 {portfolioMode === 'wealth' && 'الرسوم البيانية لتطور الثروة وتوزيع الأصول'}
 {portfolioMode === 'rescue' && 'محرك إنقاذ الأسهم المزنوقة — تحليل عميق وخطط خروج'}
 </p>
 </div>
 </div>
 </div>

 {/* TASK 40-B: 3-way segmented control — المحفظة | الأموال | إنقاذ سهم */}
 {/* Rule 30: emerald/amber/red accent only (no indigo/blue). */}
 <div className="flex w-full rounded-lg border border-border bg-muted/40 p-1" role="tablist" aria-label="أقسام المحفظة">
 <button
 type="button"
 role="tab"
 aria-selected={portfolioMode === 'portfolio'}
 onClick={() => setPortfolioMode('portfolio')}
 className={cn(
 'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
 portfolioMode === 'portfolio'
 ? 'bg-background text-profit shadow-sm'
 : 'text-muted-foreground hover:text-foreground'
 )}
 >
 <Wallet className="w-4 h-4" />
 المحفظة
 </button>
 <button
 type="button"
 role="tab"
 aria-selected={portfolioMode === 'wealth'}
 onClick={() => setPortfolioMode('wealth')}
 className={cn(
 'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
 portfolioMode === 'wealth'
 ? 'bg-background text-warning shadow-sm'
 : 'text-muted-foreground hover:text-foreground'
 )}
 >
 <HandCoins className="w-4 h-4" />
 الأموال
 </button>
 <button
 type="button"
 role="tab"
 aria-selected={portfolioMode === 'rescue'}
 onClick={() => setPortfolioMode('rescue')}
 className={cn(
 'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
 portfolioMode === 'rescue'
 ? 'bg-background text-loss shadow-sm'
 : 'text-muted-foreground hover:text-foreground'
 )}
 >
 <LifeBuoy className="w-4 h-4" />
 إنقاذ سهم
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

 {/* Master Portfolio Summary (الإجمالي العام من المحفظة الشاملة) */}
 <MasterPortfolioSummary userId={userId} />

 {selectedPortfolioId !== 'master' && (
 <Card className="bg-profit/20 border-profit/40">
 <CardContent className="p-3 flex items-center justify-between text-xs text-profit">
 <span>{t('portfolio.subPortfolio.banner')}</span>
 <Badge variant="outline" className="text-profit border-profit">
 {t('portfolio.subPortfolio.badge', { id: selectedPortfolioId })}
 </Badge>
 </CardContent>
 </Card>
 )}

 {/* Tabs */}
 {/* UI-STABILITY fix (2026-09-28): stable keys on each TabsContent so
 switching tabs doesn't unmount/remount the others unexpectedly. */}
 <Tabs defaultValue="assets">
 <TabsList className="flex w-full">
 <TabsTrigger value="assets" className="flex-1">{t('portfolio.tabs.assets')}</TabsTrigger>
 <TabsTrigger value="income-expense" className="flex-1">{t('portfolio.tabs.incomeExpense')}</TabsTrigger>
 <TabsTrigger value="obligations" className="flex-1">{t('portfolio.tabs.obligations')}</TabsTrigger>
 <TabsTrigger value="reports" className="flex-1">{t('portfolio.tabs.reports')}</TabsTrigger>
 {/* RESTRUCT-A-P2: alerts merged from #alerts-center top-level */}
 <TabsTrigger value="alerts" className="flex-1">التنبيهات</TabsTrigger>

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

 {/* RESTRUCT-A-P2: alerts merged from #alerts-center top-level */}
 <TabsContent value="alerts" key="portfolio-tab-alerts">
 <AlertsCenterView />
 </TabsContent>


 </Tabs>
 </>)}
 </div>
 </div>
 );
}
