'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Eye,
  Bell,
  BellOff,
  TrendingUp,
  TrendingDown,
  Trash2,
  AlertCircle,
  EyeOff,
  Plus,
  Pencil,
  ArrowUpCircle,
  ArrowDownCircle,
  Search,
  Loader2,
  X,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn, safeNum } from '@/lib/utils';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ShareButton } from '@/components/share/ShareButton';
import { SmartTip } from '@/components/smart-tips/SmartTip';
import { toast } from 'sonner';
import type { WatchlistItem } from '@/types';

// ==================== TYPES ====================

interface StockSearchResult {
  id: number;
  ticker: string;
  name: string;
  name_ar: string;
  current_price: number;
  sector: string;
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
  const sign = safeNum(value) >= 0 ? '+' : '';
  return `${sign}${safeNum(value).toFixed(2)}%`;
}

// ==================== ADD STOCK DIALOG ====================

function AddStockDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null);
  const [alertPriceAbove, setAlertPriceAbove] = useState('');
  const [alertPriceBelow, setAlertPriceBelow] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
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

  const handleSubmit = async () => {
    if (!selectedStock) {
      toast.error('يرجى اختيار سهم من القائمة');
      return;
    }
    setSubmitting(true);
    const { addToWatchlist } = useAppStore.getState();
    const result = await addToWatchlist(selectedStock.ticker, {
      alert_price_above: alertPriceAbove ? parseFloat(alertPriceAbove) : null,
      alert_price_below: alertPriceBelow ? parseFloat(alertPriceBelow) : null,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (result.success) {
      toast.success('تمت إضافة السهم إلى قائمة المراقبة');
      resetAndClose();
    } else {
      toast.error(result.error || 'فشل في إضافة السهم');
    }
  };

  const resetAndClose = () => {
    setQuery('');
    setResults([]);
    setSelectedStock(null);
    setAlertPriceAbove('');
    setAlertPriceBelow('');
    setNotes('');
    setShowDropdown(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else onOpenChange(true); }}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>إضافة سهم إلى قائمة المراقبة</DialogTitle>
          <DialogDescription>ابحث عن السهم وأضفه إلى قائمة المراقبة مع تنبيهات اختيارية</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Ticker search with dropdown */}
          <div className="space-y-2 relative" ref={dropdownRef}>
            <Label htmlFor="stock-search">رمز السهم</Label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="stock-search"
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

            {/* Search results dropdown */}
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

          {/* Alert prices */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="alert-above">سعر تنبيه أعلى (اختياري)</Label>
              <Input
                id="alert-above"
                type="number"
                step="0.01"
                value={alertPriceAbove}
                onChange={(e) => setAlertPriceAbove(e.target.value)}
                placeholder="0.00"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="alert-below">سعر تنبيه أدنى (اختياري)</Label>
              <Input
                id="alert-below"
                type="number"
                step="0.01"
                value={alertPriceBelow}
                onChange={(e) => setAlertPriceBelow(e.target.value)}
                placeholder="0.00"
                dir="ltr"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="add-notes">ملاحظات (اختياري)</Label>
            <Textarea
              id="add-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أضف ملاحظاتك هنا..."
              rows={2}
              dir="rtl"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={resetAndClose}>
            إلغاء
          </Button>
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

// ==================== EDIT ALERT DIALOG ====================

function EditAlertDialog({
  item,
  open,
  onOpenChange,
}: {
  item: WatchlistItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!item) return null;

  // Use key={item.id + open} on the inner component to force remount when item changes
  return (
    <EditAlertDialogInner
      key={`${item.id}-${open}`}
      item={item}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

function EditAlertDialogInner({
  item,
  open,
  onOpenChange,
}: {
  item: WatchlistItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [alertPriceAbove, setAlertPriceAbove] = useState(
    item.alert_price_above !== null ? String(item.alert_price_above) : ''
  );
  const [alertPriceBelow, setAlertPriceBelow] = useState(
    item.alert_price_below !== null ? String(item.alert_price_below) : ''
  );
  const [alertChangePercent, setAlertChangePercent] = useState(
    item.alert_change_percent !== null ? String(item.alert_change_percent) : ''
  );
  const [notes, setNotes] = useState(item.notes || '');
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    setSubmitting(true);
    const { updateWatchlistItem } = useAppStore.getState();
    const result = await updateWatchlistItem(item.id, {
      alert_price_above: alertPriceAbove ? parseFloat(alertPriceAbove) : null,
      alert_price_below: alertPriceBelow ? parseFloat(alertPriceBelow) : null,
      alert_change_percent: alertChangePercent ? parseFloat(alertChangePercent) : null,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (result.success) {
      toast.success('تم تحديث التنبيهات بنجاح');
      onOpenChange(false);
    } else {
      toast.error(result.error || 'فشل في التحديث');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل تنبيهات السهم</DialogTitle>
          <DialogDescription>
            {item.stock?.ticker} — {item.stock?.name_ar}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-alert-above">سعر تنبيه أعلى</Label>
              <Input
                id="edit-alert-above"
                type="number"
                step="0.01"
                value={alertPriceAbove}
                onChange={(e) => setAlertPriceAbove(e.target.value)}
                placeholder="0.00"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-alert-below">سعر تنبيه أدنى</Label>
              <Input
                id="edit-alert-below"
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
            <Label htmlFor="edit-alert-change">نسبة التغير للتنبيه (%)</Label>
            <Input
              id="edit-alert-change"
              type="number"
              step="0.1"
              value={alertChangePercent}
              onChange={(e) => setAlertChangePercent(e.target.value)}
              placeholder="0.0"
              dir="ltr"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-notes">ملاحظات</Label>
            <Textarea
              id="edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أضف ملاحظاتك هنا..."
              rows={2}
              dir="rtl"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
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

export function WatchlistView() {
  const { watchlist, isLoading, loadWatchlist } = useAppStore();
  const [localWatchlist, setLocalWatchlist] = useState(watchlist);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<WatchlistItem | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  useEffect(() => {
    setLocalWatchlist(watchlist);
  }, [watchlist]);

  const handleRemove = async (id: number) => {
    const { removeFromWatchlist } = useAppStore.getState();
    const result = await removeFromWatchlist(id);
    if (!result.success) {
      toast.error(result.error || 'فشل في إزالة السهم من القائمة');
    } else {
      toast.success('تمت إزالة السهم من قائمة المراقبة');
    }
  };

  const handleEdit = (item: WatchlistItem) => {
    setEditItem(item);
    setEditDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div dir="rtl" className="min-h-screen bg-background">
        <Header title="قائمة المراقبة" subtitle="تتبع الأسهم المفضلة" />
        <div className="p-4 md:p-6 space-y-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-8 w-8 rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <Header title="قائمة المراقبة" subtitle="تتبع الأسهم المفضلة" />
      <div className="p-4 md:p-6">
        {/* Smart Tip */}
        <SmartTip trigger="add_watchlist" category="risk" />

        {/* Summary header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium text-muted-foreground">
              {localWatchlist.length} سهم في القائمة
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              size="sm"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="w-4 h-4 ml-1.5" />
              إضافة سهم
            </Button>
            {localWatchlist.length > 0 && localWatchlist[0]?.stock && (
              <ShareButton
                iconOnly={false}
                variant="outline"
                size="sm"
                stockData={{
                  ticker: localWatchlist[0].stock.ticker,
                  name: localWatchlist[0].stock.name_ar,
                  nameAr: localWatchlist[0].stock.name_ar,
                  price: localWatchlist[0].stock.current_price,
                  change: localWatchlist[0].stock.price_change ?? 0,
                  sector: localWatchlist[0].stock.sector,
                }}
              />
            )}
          </div>
        </div>

        {/* Empty State */}
        {localWatchlist.length === 0 && (
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

        {/* Watchlist Items */}
        <div className="space-y-3">
          {localWatchlist.map((item) => {
            const stock = item.stock;
            if (!stock) return null;

            const priceChange = stock.price_change ?? 0;
            const hasAlertAbove = item.alert_price_above !== null;
            const hasAlertBelow = item.alert_price_below !== null;
            const hasAlertChange = item.alert_change_percent !== null;
            const hasAnyAlert = hasAlertAbove || hasAlertBelow || hasAlertChange;

            const isPriceAboveTriggered = hasAlertAbove && stock.current_price >= item.alert_price_above!;
            const isPriceBelowTriggered = hasAlertBelow && stock.current_price <= item.alert_price_below!;

            return (
              <Card key={item.id} className="overflow-hidden transition-all hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Stock info */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                          {stock.ticker.slice(0, 2)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{stock.ticker}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5">
                            {stock.sector}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{stock.name_ar}</p>
                      </div>
                    </div>

                    {/* Price info */}
                    <div className="text-left flex-shrink-0">
                      <p className="font-bold text-sm">{formatCurrency(stock.current_price)}</p>
                      <div className="flex items-center gap-1 justify-end">
                        {priceChange >= 0 ? (
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                        )}
                        <span className={cn(
                          'text-xs font-semibold',
                          priceChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                        )}>
                          {formatPercent(priceChange)}
                        </span>
                      </div>
                    </div>

                    {/* Alerts */}
                    <div className="flex-shrink-0 hidden sm:flex flex-col items-end gap-1">
                      {hasAlertAbove && (
                        <div className={cn(
                          'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded',
                          isPriceAboveTriggered
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            : 'bg-muted text-muted-foreground'
                        )}>
                          <ArrowUpCircle className="w-3 h-3" />
                          {formatCurrency(item.alert_price_above!)}
                        </div>
                      )}
                      {hasAlertBelow && (
                        <div className={cn(
                          'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded',
                          isPriceBelowTriggered
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-muted text-muted-foreground'
                        )}>
                          <ArrowDownCircle className="w-3 h-3" />
                          {formatCurrency(item.alert_price_below!)}
                        </div>
                      )}
                      {hasAlertChange && (
                        <div className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          <AlertCircle className="w-3 h-3" />
                          تحرك {item.alert_change_percent}%
                        </div>
                      )}
                    </div>

                    {/* Alert indicator */}
                    <div className="flex-shrink-0">
                      {hasAnyAlert ? (
                        <div className="relative">
                          <Bell className="w-4 h-4 text-amber-500" />
                          {(isPriceAboveTriggered || isPriceBelowTriggered) && (
                            <span className="absolute -top-1 -left-1 w-2 h-2 bg-red-500 rounded-full" />
                          )}
                        </div>
                      ) : (
                        <BellOff className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>

                    {/* Edit button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="flex-shrink-0 text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                      onClick={() => handleEdit(item)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>

                    {/* Remove button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="flex-shrink-0 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                      onClick={() => handleRemove(item.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Notes display */}
                  {item.notes && (
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <p className="text-xs text-muted-foreground">{item.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Add Stock Dialog */}
      <AddStockDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      {/* Edit Alert Dialog */}
      <EditAlertDialog
        item={editItem}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />
    </div>
  );
}
