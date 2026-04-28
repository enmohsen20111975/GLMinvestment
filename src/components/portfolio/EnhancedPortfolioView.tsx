'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  AlertTriangle,
  Plus,
  Trash2,
  Pencil,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
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

// ==================== HELPERS ====================

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' ج.م';
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function abbreviateNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return value.toFixed(2);
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  stock: 'أسهم',
  gold: 'ذهب',
  bank: 'بنك',
  certificate: 'شهادات إيداع',
  fund: 'صناديق استثمار',
  real_estate: 'عقارات',
  other: 'أخرى',
};

const ASSET_TYPE_COLORS: Record<AssetType, string> = {
  stock: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  gold: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  bank: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  certificate: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  fund: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  real_estate: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
};

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
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  paid: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
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
            <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
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
                <div className="text-sm font-semibold" dir="ltr">{stock.current_price > 0 ? stock.current_price.toFixed(2) : '—'}</div>
                <div className={cn('text-xs font-medium', stock.price_change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                  {stock.price_change >= 0 ? '+' : ''}{stock.price_change.toFixed(2)}%
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== ASSETS TAB ====================

function AssetsTab() {
  const [assets, setAssets] = useState<(PortfolioAsset & Record<string, unknown>)[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<(PortfolioAsset & Record<string, unknown>) | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

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
    setFormTicker(''); setFormQuantity(''); setFormAvgBuyPrice(''); setFormSelectedPrice(null);
  };

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/assets');
      const data = await res.json();
      setAssets(data.items || []);
    } catch {
      toast.error('فشل في تحميل الأصول');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  const addToWatchlist = async (ticker: string) => {
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      toast.success(`تمت إضافة ${ticker} إلى قائمة المراقبة`);
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
      toast.error('يرجى اختيار السهم من القائمة');
      return;
    }
    if (!formName || formName.trim().length === 0) {
      toast.error('يرجى إدخال اسم الأصل');
      return;
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      type: formType,
      name: formName,
      total_invested: formTotalInvested ? parseFloat(formTotalInvested) : 0,
      current_value: formCurrentValue ? parseFloat(formCurrentValue) : 0,
      notes: formNotes.trim() || null,
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
    }
    if (formType === 'stock') {
      payload.stock_ticker = formTicker;
      payload.quantity = formQuantity ? parseInt(formQuantity) : null;
      payload.avg_buy_price = formAvgBuyPrice ? parseFloat(formAvgBuyPrice) : null;
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
        toast.error(`خطأ في الخادم (${res.status}) — تحقق من الكونسول`, { duration: 10000 });
        return;
      }
      if (data.success) {
        toast.success('تمت إضافة الأصل بنجاح');
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
        toast.error(String(data.error || 'فشل في إضافة الأصل') + detailMsg, { duration: 10000 });
      }
    } catch (fetchErr) {
      console.error('[Asset Add] Fetch error:', fetchErr);
      toast.error('حدث خطأ في الاتصال بالخادم');
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
    try {
      const res = await fetch(`/api/finance/assets/${editAsset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم تحديث الأصل بنجاح');
        setEditDialogOpen(false);
        loadAssets();
      } else {
        toast.error(data.error || 'فشل في تحديث الأصل');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
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
        toast.success('تم حذف الأصل بنجاح');
        setDeleteId(null);
        loadAssets();
      } else {
        toast.error(data.error || 'فشل في حذف الأصل');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
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
    setEditDialogOpen(true);
  };

  const filteredAssets = filterType === 'all'
    ? assets
    : assets.filter((a) => a.type === filterType);

  const totalAssets = assets.reduce((s, a) => s + a.current_value, 0);
  const totalInvested = assets.reduce((s, a) => s + a.total_invested, 0);
  const totalGainLoss = totalAssets - totalInvested;
  const totalReturnPercent = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;

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
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Landmark className="w-4 h-4" />
            <span className="text-xs font-medium">إجمالي الأصول</span>
          </div>
          <p className="text-lg md:text-xl font-bold">{formatCurrency(totalAssets)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Wallet className="w-4 h-4" />
            <span className="text-xs font-medium">صافي الثروة</span>
          </div>
          <p className="text-lg md:text-xl font-bold">{formatCurrency(totalAssets)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            {totalGainLoss >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
            <span className="text-xs font-medium">العائد الإجمالي</span>
          </div>
          <p className={cn('text-lg md:text-xl font-bold', totalGainLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
            {formatCurrency(Math.abs(totalGainLoss))}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs font-medium">العائد %</span>
          </div>
          <p className={cn('text-lg md:text-xl font-bold', totalReturnPercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
            {formatPercent(totalReturnPercent)}
          </p>
        </Card>
      </div>

      {/* Filter & Add */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={filterType === 'all' ? 'default' : 'outline'} onClick={() => setFilterType('all')}>الكل</Button>
          {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map((type) => (
            <Button key={type} size="sm" variant={filterType === type ? 'default' : 'outline'} onClick={() => setFilterType(type)}>
              {ASSET_TYPE_LABELS[type]}
            </Button>
          ))}
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" size="sm" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
          <Plus className="w-4 h-4 ml-1.5" />
          إضافة أصل
        </Button>
      </div>

      {/* Assets List */}
      {filteredAssets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Landmark className="w-10 h-10 text-muted-foreground mb-3" />
            <h3 className="text-lg font-semibold mb-1">لا توجد أصول</h3>
            <p className="text-sm text-muted-foreground">أضف أصولك المالية لتتبعها هنا</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAssets.map((asset) => {
            const gl = asset.current_value - asset.total_invested;
            const glPct = asset.total_invested > 0 ? (gl / asset.total_invested) * 100 : 0;
            const marketPrice = Number(asset.market_price) || 0;
            const marketChange = Number(asset.market_change_percent) || 0;
            const marketValue = Number(asset.market_value) || 0;
            const qty = Number(asset.quantity) || 0;
            const avgBuy = Number(asset.avg_buy_price) || 0;
            const isStock = asset.type === 'stock';
            const stockGl = isStock && qty > 0 && marketPrice > 0 ? (marketPrice - avgBuy) * qty : 0;
            const stockGlPct = isStock && avgBuy > 0 ? ((marketPrice - avgBuy) / avgBuy) * 100 : 0;
            return (
              <Card key={asset.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Badge className={ASSET_TYPE_COLORS[asset.type]}>{ASSET_TYPE_LABELS[asset.type]}</Badge>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm truncate">{asset.name}</h3>
                        {isStock && asset.stock_ticker && (
                          <span className="text-xs text-muted-foreground" dir="ltr">{asset.stock_ticker}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => openEdit(asset)} title="تعديل"><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="outline" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => setDeleteId(asset.id!)} title="حذف"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">المستثمر</span>
                      <span className="font-medium">{formatCurrency(asset.total_invested)}</span>
                    </div>
                    {isStock && marketPrice > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">السعر الحالي</span>
                        <span className="font-medium" dir="ltr">{marketPrice.toFixed(2)} ج.م</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">القيمة الحالية</span>
                      <span className="font-medium">{isStock && marketValue > 0 ? formatCurrency(marketValue) : formatCurrency(asset.current_value)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{isStock ? 'الربح/الخسارة (سوق)' : 'الربح/الخسارة'}</span>
                      <span className={cn('font-semibold',
                        isStock ? (stockGl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400') : (gl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')
                      )}>
                        {isStock
                          ? `${formatCurrency(Math.abs(stockGl))} (${formatPercent(stockGlPct)})`
                          : `${formatCurrency(Math.abs(gl))} (${formatPercent(glPct)})`
                        }
                      </span>
                    </div>
                    {isStock && marketPrice > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">تغيير اليوم</span>
                        <span className={cn('font-medium', marketChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                          {formatPercent(marketChange)}
                        </span>
                      </div>
                    )}
                  </div>
                  {isStock && qty > 0 && (
                    <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                      {qty} سهم @ {avgBuy.toFixed(2)} ج.م {asset.stock_sector ? `| ${asset.stock_sector}` : ''}
                    </div>
                  )}
                  {asset.type === 'gold' && (
                    <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                      {asset.weight_grams ? `${asset.weight_grams} جرام` : ''} {asset.karat ? `عيار ${asset.karat}` : ''}
                    </div>
                  )}
                  {asset.type === 'bank' && (
                    <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                      {asset.bank_name || ''} {asset.interest_rate ? `| فائدة ${asset.interest_rate}%` : ''}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
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
                    <span className="font-semibold" dir="ltr">{formSelectedPrice.toFixed(2)} ج.م</span>
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
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-md px-3 py-2 text-sm">
                    <span className="text-muted-foreground">إجمالي التكلفة: </span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(parseFloat(formTotalInvested))}</span>
                  </div>
                )}
              </>
            )}

            {/* Gold specific */}
            {formType === 'gold' && (
              <>
                <div className="space-y-2"><Label>اسم الأصل</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: سوار ذهب، خاتم" /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2"><Label>الوزن (جرام)</Label><Input type="number" value={formWeight} onChange={(e) => setFormWeight(e.target.value)} placeholder="0" dir="ltr" /></div>
                  <div className="space-y-2"><Label>العيار</Label>
                    <Select value={formKarat} onValueChange={setFormKarat}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="18">١٨</SelectItem><SelectItem value="21">٢١</SelectItem><SelectItem value="24">٢٤</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>سعر الجرام</Label><Input type="number" value={formPricePerGram} onChange={(e) => setFormPricePerGram(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>المبلغ المستثمر</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                  <div className="space-y-2"><Label>القيمة الحالية</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                </div>
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
                  <div className="space-y-2"><Label>نوع الصندوق</Label><Input value={formFundType} onChange={(e) => setFormFundType(e.target.value)} placeholder="أسهم / سندات" /></div>
                  <div className="space-y-2"><Label>المبلغ المستثمر</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                </div>
                <div className="space-y-2"><Label>القيمة الحالية</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} placeholder="0.00" dir="ltr" /></div>
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

            <div className="space-y-2"><Label>ملاحظات (اختياري)</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="أضف ملاحظاتك..." rows={2} /></div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { resetForm(); setAddDialogOpen(false); }}>إلغاء</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSave} disabled={saving}>
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
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleEditSave} disabled={saving}>
              {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin ml-1.5" /> جاري الحفظ...</> : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="w-5 h-5" /> تأكيد الحذف</DialogTitle>
            <DialogDescription>هل أنت متأكد من حذف هذا الأصل؟ لا يمكن التراجع عن هذا الإجراء.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteId(null)}>إلغاء</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete}>حذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== INCOME & EXPENSES TAB ====================

function IncomeExpenseTab() {
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

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/transactions?month=${month}&year=${year}`);
      const data = await res.json();
      setTransactions(data.items || []);
      setSummary(data.summary || null);
    } catch {
      toast.error('فشل في تحميل المعاملات');
    } finally {
      setLoading(false);
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
        loadTransactions();
      } else {
        toast.error(data.error || 'فشل في إضافة المعاملة');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/finance/transactions/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('تم حذف المعاملة');
        loadTransactions();
      } else {
        toast.error(data.error || 'فشل في الحذف');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    }
  };

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
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" size="sm" onClick={() => setAddDialogOpen(true)}>
          <Plus className="w-4 h-4 ml-1.5" />
          إضافة معاملة
        </Button>
      </div>

      {/* Summary Row */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <ArrowUpRight className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-medium">إجمالي الدخل</span>
            </div>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(summary.total_income)}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <ArrowDownRight className="w-4 h-4 text-red-500" />
              <span className="text-xs font-medium">إجمالي المصروفات</span>
            </div>
            <p className="text-lg font-bold text-red-600 dark:text-red-400">{formatCurrency(summary.total_expenses)}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <PiggyBank className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-medium">صافي الادخار</span>
            </div>
            <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{formatCurrency(summary.net_savings)}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs font-medium">نسبة الادخار</span>
            </div>
            <p className="text-lg font-bold">{savingsRate.toFixed(1)}%</p>
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
                      <span className="font-medium">{formatCurrency(amount)} ({pct.toFixed(1)}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-red-400 transition-all" style={{ width: `${pct}%` }} />
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
          <CardTitle className="text-sm">المعاملات الأخيرة</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">لا توجد معاملات لهذا الشهر</p>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">النوع</TableHead>
                    <TableHead className="text-xs">التصنيف</TableHead>
                    <TableHead className="text-xs text-center">المبلغ</TableHead>
                    <TableHead className="text-xs">الوصف</TableHead>
                    <TableHead className="text-xs">التاريخ</TableHead>
                    <TableHead className="text-xs text-center">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Badge className={t.type === 'income' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}>
                          {t.type === 'income' ? 'دخل' : 'مصروف'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{t.category}</TableCell>
                      <TableCell className={cn('text-center font-semibold text-sm', t.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                        {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{t.description || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground" dir="ltr">{t.transaction_date}</TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500" onClick={() => handleDelete(t.id!)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Transaction Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-lg" dir="rtl">
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
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSave}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== OBLIGATIONS TAB ====================

function ObligationsTab() {
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

  const loadObligations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/obligations?status=active');
      const data = await res.json();
      setObligations(data.items || []);
    } catch {
      toast.error('فشل في تحميل الالتزامات');
    } finally {
      setLoading(false);
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
        loadObligations();
      } else {
        toast.error(data.error || 'فشل في إضافة الالتزام');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
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
        loadObligations();
      } else {
        toast.error(data.error || 'فشل في التحديث');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
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
        loadObligations();
      } else {
        toast.error(data.error || 'فشل في الحذف');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
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
        loadObligations();
      } else {
        toast.error(data.error || 'فشل في تسجيل الدفعة');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
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

  const totalDebt = obligations.reduce((s, o) => s + o.remaining_amount, 0);
  const monthlyPayments = obligations.reduce((s, o) => s + o.monthly_payment, 0);
  const activeLoans = obligations.filter((o) => o.status === 'active').length;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
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
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1"><CreditCard className="w-4 h-4" /><span className="text-xs font-medium">إجمالي المديونية</span></div>
          <p className="text-lg font-bold text-red-600 dark:text-red-400">{formatCurrency(totalDebt)}</p>
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
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" size="sm" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
          <Plus className="w-4 h-4 ml-1.5" />
          إضافة التزام
        </Button>
      </div>

      {/* Obligations List */}
      {obligations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CreditCard className="w-10 h-10 text-muted-foreground mb-3" />
            <h3 className="text-lg font-semibold mb-1">لا توجد التزامات</h3>
            <p className="text-sm text-muted-foreground">أضف التزاماتك المالية لتتبعها</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {obligations.map((ob) => {
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
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(ob)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500" onClick={() => setDeleteId(ob.id!)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><span className="text-muted-foreground">الدائن:</span> <span className="font-medium">{ob.creditor}</span></div>
                    <div><span className="text-muted-foreground">المتبقي:</span> <span className="font-medium text-red-600 dark:text-red-400">{formatCurrency(ob.remaining_amount)}</span></div>
                    <div><span className="text-muted-foreground">القسط الشهري:</span> <span className="font-medium">{formatCurrency(ob.monthly_payment)}</span></div>
                    {ob.interest_rate && <div><span className="text-muted-foreground">الفائدة:</span> <span className="font-medium">{ob.interest_rate}%</span></div>}
                  </div>
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">تم السداد</span>
                      <span className="font-medium">{paidPercent.toFixed(1)}%</span>
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
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSave}>إضافة</Button>
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
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handlePayment}>تسجيل</Button>
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
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleEditSave}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="w-5 h-5" /> تأكيد الحذف</DialogTitle>
            <DialogDescription>هل أنت متأكد من حذف هذا الالتزام؟</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteId(null)}>إلغاء</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete}>حذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== REPORTS TAB ====================

function ReportsTab() {
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

  const maxAssetTypeValue = Math.max(...Object.values(assetsByType), 1);

  return (
    <div className="space-y-6">
      {/* Portfolio Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            نظرة عامة على الحالة المالية
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">إجمالي الأصول</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalAssets)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">إجمالي الالتزامات</p>
              <p className="text-lg font-bold text-red-600 dark:text-red-400">{formatCurrency(totalLiabilities)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">صافي الثروة</p>
              <p className={cn('text-lg font-bold', netWorth >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400')}>
                {formatCurrency(netWorth)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">المدخرات الشهرية</p>
              <p className={cn('text-lg font-bold', (reports?.monthly_savings ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                {formatCurrency(reports?.monthly_savings ?? 0)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Income vs Expenses */}
      {reports && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              الدخل مقابل المصروفات (الشهر الحالي)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">إجمالي الدخل</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(reports.monthly_income)}</span>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-400" style={{ width: '100%' }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">إجمالي المصروفات</span>
                  <span className="font-medium text-red-600 dark:text-red-400">{formatCurrency(reports.monthly_expenses)}</span>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${reports.monthly_income > 0 ? (reports.monthly_expenses / reports.monthly_income) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-muted-foreground">نسبة الادخار</span>
              <div className="flex items-center gap-2">
                <Progress value={Math.min(reports.savings_rate, 100)} className="h-2 w-24" />
                <span className="font-bold text-sm">{reports.savings_rate.toFixed(1)}%</span>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-muted-foreground">صافي الادخار الشهري</span>
              <span className={cn('font-bold', (reports.monthly_savings ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                {formatCurrency(reports.monthly_savings)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              تنبيهات وتوصيات مالية
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((alert: FinancialAlert, idx: number) => (
              <div
                key={idx}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border',
                  alert.type === 'danger' && 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900/50',
                  alert.type === 'warning' && 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-900/50',
                  alert.type === 'info' && 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900/50'
                )}
              >
                {alert.type === 'danger' && <XCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />}
                {alert.type === 'warning' && <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />}
                {alert.type === 'info' && <CheckCircle2 className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />}
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
              <Coins className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              توزيع الأصول
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(assetsByType)
              .sort(([, a], [, b]) => b - a)
              .map(([type, value]) => {
                const pct = totalAssets > 0 ? (value / totalAssets) * 100 : 0;
                const label = ASSET_TYPE_LABELS[type as AssetType] || type;
                const colorClass = ASSET_TYPE_COLORS[type as AssetType] || 'bg-gray-400';
                const barColor = type === 'stock' ? 'bg-emerald-400' : type === 'gold' ? 'bg-yellow-400' : type === 'bank' ? 'bg-blue-400' : type === 'certificate' ? 'bg-purple-400' : type === 'fund' ? 'bg-orange-400' : 'bg-teal-400';
                return (
                  <div key={type} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Badge className={cn('text-[10px] px-1.5', colorClass)}>{label}</Badge>
                      </div>
                      <span className="font-medium">{formatCurrency(value)} ({pct.toFixed(1)}%)</span>
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
}

// ==================== MAIN VIEW ====================

export function EnhancedPortfolioView() {
  return (
    <div dir="rtl" className="min-h-screen bg-background pb-20 lg:pb-4">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">المحفظة المالية</h1>
              <p className="text-sm text-muted-foreground">إدارة أصولك، دخل ومصروفاتك، والتزاماتك</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="assets">
          <TabsList className="flex w-full">
            <TabsTrigger value="assets" className="flex-1">الأصول</TabsTrigger>
            <TabsTrigger value="income-expense" className="flex-1">الدخل والمصروفات</TabsTrigger>
            <TabsTrigger value="obligations" className="flex-1">الالتزامات</TabsTrigger>
            <TabsTrigger value="reports" className="flex-1">الحالة المالية</TabsTrigger>
          </TabsList>

          <TabsContent value="assets">
            <AssetsTab />
          </TabsContent>

          <TabsContent value="income-expense">
            <IncomeExpenseTab />
          </TabsContent>

          <TabsContent value="obligations">
            <ObligationsTab />
          </TabsContent>

          <TabsContent value="reports">
            <ReportsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
