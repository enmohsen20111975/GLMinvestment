'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Eye,
  EyeOff,
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Search,
  Loader2,
  X,
  ArrowUpCircle,
  ArrowDownCircle,
  Bell,
  BellOff,
  Wallet,
  DollarSign,
  BarChart3,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { EnhancedWatchlistItem } from '@/types';

// ==================== TYPES ====================

interface StockSearchResult {
  id: number;
  ticker: string;
  name: string;
  name_ar: string;
  current_price: number;
  sector: string;
}

interface WatchlistSummary {
  total_items: number;
  total_invested: number;
  total_current_value: number;
  total_gain_loss: number;
  total_gain_loss_percent: number;
}

interface WatchlistResponse {
  items: EnhancedWatchlistItem[];
  summary: WatchlistSummary;
}

// ==================== HELPERS ====================

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' ج.م';
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function abbreviateNumber(value: number): string {
  if (value == null || !Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return value.toFixed(2);
}

// ==================== ADD STOCK DIALOG ====================

function AddStockDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null);
  const [purchasePrice, setPurchasePrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [alertPriceAbove, setAlertPriceAbove] = useState('');
  const [alertPriceBelow, setAlertPriceBelow] = useState('');
  const [alertChangePercent, setAlertChangePercent] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  const searchStocks = useCallback(async (q: string) => {
    if (q.trim().length < 1) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/stocks?query=${encodeURIComponent(q.trim())}&page_size=10`);
      const data = await res.json();
      const stocks: StockSearchResult[] = (data.stocks || []).map((s: Record<string, unknown>) => ({
        id: s.id as number,
        ticker: (s.ticker as string) || '',
        name: (s.name as string) || '',
        name_ar: (s.name_ar as string) || '',
        current_price: (s.current_price as number) || 0,
        sector: (s.sector as string) || '',
      }));
      setResults(stocks);
      setShowDropdown(stocks.length > 0);
    } catch {
      setResults([]);
      setShowDropdown(false);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedStock(null);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (value.trim().length >= 1) {
      searchTimeoutRef.current = setTimeout(() => searchStocks(value), 300);
    } else {
      setResults([]);
      setShowDropdown(false);
    }
  };

  const handleSelectStock = (stock: StockSearchResult) => {
    setSelectedStock(stock);
    setQuery(stock.ticker);
    setShowDropdown(false);
  };

  const resetAndClose = () => {
    setQuery('');
    setResults([]);
    setSelectedStock(null);
    setPurchasePrice('');
    setQuantity('');
    setAlertPriceAbove('');
    setAlertPriceBelow('');
    setAlertChangePercent('');
    setNotes('');
    setShowDropdown(false);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!selectedStock) {
      toast.error('يرجى اختيار سهم من القائمة');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/watchlist-enhanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_id: selectedStock.id,
          ticker: selectedStock.ticker,
          purchase_price: purchasePrice ? parseFloat(purchasePrice) : null,
          quantity: quantity ? parseInt(quantity) : null,
          alert_price_above: alertPriceAbove ? parseFloat(alertPriceAbove) : null,
          alert_price_below: alertPriceBelow ? parseFloat(alertPriceBelow) : null,
          alert_change_percent: alertChangePercent ? parseFloat(alertChangePercent) : null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تمت إضافة السهم إلى قائمة المراقبة');
        resetAndClose();
        onSaved();
      } else {
        toast.error(data.error || 'فشل في إضافة السهم');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else onOpenChange(true); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>إضافة سهم إلى قائمة المراقبة</DialogTitle>
          <DialogDescription>ابحث عن السهم وأضفه مع سعر الشراء والتنبيهات</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Ticker search with dropdown */}
          <div className="space-y-2 relative" ref={dropdownRef}>
            <Label htmlFor="ws-stock-search">رمز السهم</Label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="ws-stock-search"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
                placeholder="ابحث بالرمز أو الاسم..."
                className="pr-9"
                dir="rtl"
              />
              {searching && (
                <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
              )}
              {query && !searching && (
                <button
                  type="button"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => { setQuery(''); setSelectedStock(null); setResults([]); }}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {showDropdown && (
              <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                {results.map((stock) => (
                  <button
                    key={stock.id}
                    type="button"
                    className={cn(
                      'w-full px-3 py-2 text-right flex items-center gap-3 hover:bg-accent transition-colors',
                      selectedStock?.id === stock.id && 'bg-accent'
                    )}
                    onClick={() => handleSelectStock(stock)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{stock.ticker}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5">{stock.sector}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{stock.name_ar}</p>
                    </div>
                    <span className="text-sm font-medium">{formatCurrency(stock.current_price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected stock info */}
          {selectedStock && (
            <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm">{selectedStock.ticker}</span>
                <span className="text-xs text-muted-foreground">{selectedStock.name_ar}</span>
              </div>
              <p className="text-xs text-muted-foreground">السعر الحالي: {formatCurrency(selectedStock.current_price)}</p>
            </div>
          )}

          {/* Purchase price & quantity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ws-purchase-price">سعر الشراء (ج.م)</Label>
              <Input
                id="ws-purchase-price"
                type="number"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="0.00"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-quantity">الكمية</Label>
              <Input
                id="ws-quantity"
                type="number"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                dir="ltr"
              />
            </div>
          </div>

          {/* Alert prices */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ws-alert-above">تنبيه إذا أعلى من</Label>
              <Input
                id="ws-alert-above"
                type="number"
                step="0.01"
                value={alertPriceAbove}
                onChange={(e) => setAlertPriceAbove(e.target.value)}
                placeholder="0.00"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-alert-below">تنبيه إذا أقل من</Label>
              <Input
                id="ws-alert-below"
                type="number"
                step="0.01"
                value={alertPriceBelow}
                onChange={(e) => setAlertPriceBelow(e.target.value)}
                placeholder="0.00"
                dir="ltr"
              />
            </div>
          </div>

          {/* Alert change percent */}
          <div className="space-y-2">
            <Label htmlFor="ws-alert-change">تنبيه عند تغير بنسبة (%)</Label>
            <Input
              id="ws-alert-change"
              type="number"
              step="0.1"
              value={alertChangePercent}
              onChange={(e) => setAlertChangePercent(e.target.value)}
              placeholder="0.0"
              dir="ltr"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="ws-notes">ملاحظات (اختياري)</Label>
            <Textarea
              id="ws-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أضف ملاحظاتك هنا..."
              rows={2}
              dir="rtl"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={resetAndClose}>إلغاء</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleSubmit}
            disabled={submitting || !selectedStock}
          >
            {submitting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            إضافة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== EDIT STOCK DIALOG ====================

function EditStockDialog({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: EnhancedWatchlistItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [purchasePrice, setPurchasePrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [alertPriceAbove, setAlertPriceAbove] = useState('');
  const [alertPriceBelow, setAlertPriceBelow] = useState('');
  const [alertChangePercent, setAlertChangePercent] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (item && open) {
      setPurchasePrice(item.purchase_price !== null ? String(item.purchase_price) : '');
      setQuantity(item.quantity !== null ? String(item.quantity) : '');
      setAlertPriceAbove(item.alert_price_above !== null ? String(item.alert_price_above) : '');
      setAlertPriceBelow(item.alert_price_below !== null ? String(item.alert_price_below) : '');
      setAlertChangePercent(item.alert_change_percent !== null ? String(item.alert_change_percent) : '');
      setNotes(item.notes || '');
    }
  }, [item, open]);

  if (!item) return null;

  const handleSave = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/watchlist-enhanced/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchase_price: purchasePrice ? parseFloat(purchasePrice) : null,
          quantity: quantity ? parseInt(quantity) : null,
          alert_price_above: alertPriceAbove ? parseFloat(alertPriceAbove) : null,
          alert_price_below: alertPriceBelow ? parseFloat(alertPriceBelow) : null,
          alert_change_percent: alertChangePercent ? parseFloat(alertChangePercent) : null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم تحديث السهم بنجاح');
        onOpenChange(false);
        onSaved();
      } else {
        toast.error(data.error || 'فشل في تحديث السهم');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل السهم</DialogTitle>
          <DialogDescription>
            {item.ticker} — {item.name_ar}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="we-purchase-price">سعر الشراء (ج.م)</Label>
              <Input
                id="we-purchase-price"
                type="number"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="0.00"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="we-quantity">الكمية</Label>
              <Input
                id="we-quantity"
                type="number"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                dir="ltr"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="we-alert-above">تنبيه إذا أعلى من</Label>
              <Input
                id="we-alert-above"
                type="number"
                step="0.01"
                value={alertPriceAbove}
                onChange={(e) => setAlertPriceAbove(e.target.value)}
                placeholder="0.00"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="we-alert-below">تنبيه إذا أقل من</Label>
              <Input
                id="we-alert-below"
                type="number"
                step="0.01"
                value={alertPriceBelow}
                onChange={(e) => setAlertPriceBelow(e.target.value)}
                placeholder="0.00"
                dir="ltr"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="we-alert-change">تنبيه عند تغير بنسبة (%)</Label>
            <Input
              id="we-alert-change"
              type="number"
              step="0.1"
              value={alertChangePercent}
              onChange={(e) => setAlertChangePercent(e.target.value)}
              placeholder="0.0"
              dir="ltr"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="we-notes">ملاحظات</Label>
            <Textarea
              id="we-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أضف ملاحظاتك هنا..."
              rows={2}
              dir="rtl"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleSave}
            disabled={submitting}
          >
            {submitting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== MAIN VIEW ====================

export function EnhancedWatchlistView() {
  const [items, setItems] = useState<EnhancedWatchlistItem[]>([]);
  const [summary, setSummary] = useState<WatchlistSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<EnhancedWatchlistItem | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/watchlist-enhanced');
      const data: WatchlistResponse = await res.json();
      setItems(data.items || []);
      setSummary(data.summary || null);
    } catch {
      toast.error('فشل في تحميل قائمة المراقبة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/watchlist-enhanced/${deleteId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('تم حذف السهم من قائمة المراقبة');
        setDeleteId(null);
        fetchData();
      } else {
        toast.error(data.error || 'فشل في حذف السهم');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    }
  };

  const handleEdit = (item: EnhancedWatchlistItem) => {
    setEditItem(item);
    setEditDialogOpen(true);
  };

  // ==================== LOADING STATE ====================
  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-background">
        <div className="p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-9 w-32" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-7 w-28" /></CardContent></Card>
            ))}
          </div>
          {[...Array(3)].map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-5 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const hasGainLoss = items.some((i) => i.purchase_price && i.quantity);

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Eye className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">قائمة المراقبة</h1>
              <p className="text-sm text-muted-foreground">تتبع الأسهم المفضلة وأرباحك</p>
            </div>
          </div>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            size="sm"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="w-4 h-4 ml-1.5" />
            إضافة سهم
          </Button>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <BarChart3 className="w-4 h-4" />
                <span className="text-xs font-medium">عدد الأسهم</span>
              </div>
              <p className="text-xl font-bold">{summary.total_items.toLocaleString('ar-EG')}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Wallet className="w-4 h-4" />
                <span className="text-xs font-medium">إجمالي المستثمر</span>
              </div>
              <p className="text-xl font-bold">{formatCurrency(summary.total_invested)}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs font-medium">القيمة الحالية</span>
              </div>
              <p className="text-xl font-bold">{formatCurrency(summary.total_current_value)}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                {summary.total_gain_loss >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                )}
                <span className="text-xs font-medium">الربح/الخسارة</span>
              </div>
              <div className="flex items-center gap-2">
                <p className={cn(
                  'text-xl font-bold',
                  summary.total_gain_loss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                )}>
                  {formatCurrency(Math.abs(summary.total_gain_loss))}
                </p>
                <Badge className={cn(
                  'text-xs',
                  summary.total_gain_loss >= 0
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                )}>
                  {formatPercent(summary.total_gain_loss_percent)}
                </Badge>
              </div>
            </Card>
          </div>
        )}

        {/* Empty State */}
        {items.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <EyeOff className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">قائمة المراقبة فارغة</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                أضف الأسهم التي تريد مراقبتها لعرضها هنا. يمكنك إضافة أسهم من صفحة الأسهم أو بالضغط على زر &quot;إضافة سهم&quot;.
              </p>
              <Button
                className="mt-6 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setAddDialogOpen(true)}
              >
                <Plus className="w-4 h-4 ml-2" />
                إضافة سهم
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Watchlist Table */}
        {items.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">السهم</TableHead>
                      <TableHead className="text-xs text-center">السعر الحالي</TableHead>
                      {hasGainLoss && <TableHead className="text-xs text-center">سعر الشراء</TableHead>}
                      {hasGainLoss && <TableHead className="text-xs text-center">الكمية</TableHead>}
                      {hasGainLoss && <TableHead className="text-xs text-center">المستثمر</TableHead>}
                      {hasGainLoss && <TableHead className="text-xs text-center">القيمة الحالية</TableHead>}
                      {hasGainLoss && <TableHead className="text-xs text-center">الربح/الخسارة</TableHead>}
                      <TableHead className="text-xs text-center">التغير</TableHead>
                      <TableHead className="text-xs text-center">التنبيهات</TableHead>
                      <TableHead className="text-xs text-center">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const hasAlertAbove = item.alert_price_above !== null;
                      const hasAlertBelow = item.alert_price_below !== null;
                      const hasAlertChange = item.alert_change_percent !== null;
                      const hasAnyAlert = hasAlertAbove || hasAlertBelow || hasAlertChange;

                      const isAboveTriggered = hasAlertAbove && item.current_price >= item.alert_price_above!;
                      const isBelowTriggered = hasAlertBelow && item.current_price <= item.alert_price_below!;

                      const isProfitable = item.gain_loss >= 0;

                      return (
                        <TableRow
                          key={item.id}
                          className={cn(
                            'hover:bg-muted/50',
                            hasGainLoss && item.purchase_price && item.quantity && isProfitable && 'bg-emerald-50/50 dark:bg-emerald-950/10',
                            hasGainLoss && item.purchase_price && item.quantity && !isProfitable && 'bg-red-50/50 dark:bg-red-950/10'
                          )}
                        >
                          {/* Stock Name */}
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                  {(item.ticker || '').slice(0, 2)}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-sm">{item.ticker}</p>
                                <p className="text-xs text-muted-foreground truncate max-w-[120px]">{item.name_ar}</p>
                              </div>
                            </div>
                          </TableCell>

                          {/* Current Price */}
                          <TableCell className="text-center">
                            <p className="font-semibold text-sm">{formatCurrency(item.current_price)}</p>
                          </TableCell>

                          {/* Purchase Price */}
                          {hasGainLoss && (
                            <TableCell className="text-center">
                              <p className="text-sm text-muted-foreground">
                                {item.purchase_price ? formatCurrency(item.purchase_price) : '—'}
                              </p>
                            </TableCell>
                          )}

                          {/* Quantity */}
                          {hasGainLoss && (
                            <TableCell className="text-center">
                              <p className="text-sm">
                                {item.quantity ? item.quantity.toLocaleString('ar-EG') : '—'}
                              </p>
                            </TableCell>
                          )}

                          {/* Invested */}
                          {hasGainLoss && (
                            <TableCell className="text-center">
                              <p className="text-sm font-medium">
                                {formatCurrency(item.total_invested)}
                              </p>
                            </TableCell>
                          )}

                          {/* Current Value */}
                          {hasGainLoss && (
                            <TableCell className="text-center">
                              <p className="text-sm font-medium">
                                {formatCurrency(item.current_value)}
                              </p>
                            </TableCell>
                          )}

                          {/* Gain/Loss */}
                          {hasGainLoss && (
                            <TableCell className="text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className={cn(
                                  'text-sm font-semibold',
                                  isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                                )}>
                                  {formatCurrency(Math.abs(item.gain_loss))}
                                </span>
                                <Badge className={cn(
                                  'text-[10px] px-1.5',
                                  isProfitable
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                )}>
                                  {formatPercent(item.gain_loss_percent)}
                                </Badge>
                              </div>
                            </TableCell>
                          )}

                          {/* Price Change */}
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              {item.price_change >= 0 ? (
                                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                              )}
                              <span className={cn(
                                'text-xs font-semibold',
                                item.price_change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                              )}>
                                {formatPercent(item.price_change_percent)}
                              </span>
                            </div>
                          </TableCell>

                          {/* Alerts */}
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              {hasAnyAlert ? (
                                <div className="relative">
                                  <Bell className="w-4 h-4 text-amber-500" />
                                  {(isAboveTriggered || isBelowTriggered) && (
                                    <span className="absolute -top-1 -left-1 w-2 h-2 bg-red-500 rounded-full" />
                                  )}
                                </div>
                              ) : (
                                <BellOff className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                onClick={() => handleEdit(item)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                                onClick={() => setDeleteId(item.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Stock Dialog */}
      <AddStockDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSaved={fetchData}
      />

      {/* Edit Stock Dialog */}
      <EditStockDialog
        item={editItem}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSaved={fetchData}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              تأكيد الحذف
            </DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف هذا السهم من قائمة المراقبة؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteId(null)}>إلغاء</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDelete}
            >
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
