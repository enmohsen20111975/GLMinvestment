'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
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
  RefreshCw,
  Clock,
  Brain,
  Sparkles,
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
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { StockPublisher, type StockPublishData } from '@/modules/publishing/components/StockPublisher';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n-context';
import { toast } from 'sonner';
import type { EnhancedWatchlistItem } from '@/types';
import { WatchlistIntelligenceSection } from '@/components/intelligence/WatchlistIntelligenceSection';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { StockDetailSheet } from '@/components/shared/StockDetailSheet';

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

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '0.00 ج.م';
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' ج.م';
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value ?? 0).toFixed(2)}%`;
}

function abbreviateNumber(value: number): string {
  if (value == null || !Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return (value ?? 0).toFixed(2);
}

// ==================== ADD STOCK DIALOG ====================

function AddStockDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const t = useTranslation();
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
    } catch { // silent fallback (safe-by-design)
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
      toast.error(t('watchlist.dialog.searchRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/watchlist-enhanced?market=${useAppStore.getState().currentMarket || 'EGX'}`, {
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
        toast.success(t('watchlist.dialog.addSuccess'));
        resetAndClose();
        onSaved();
      } else {
        toast.error(data.error || t('watchlist.dialog.addFailed'));
      }
    } catch { // silent fallback (safe-by-design)
      toast.error(t('watchlist.dialog.connectionError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else onOpenChange(true); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{t('watchlist.dialog.addTitle')}</DialogTitle>
          <DialogDescription>{t('watchlist.dialog.addDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Ticker search with dropdown */}
          <div className="space-y-2 relative" ref={dropdownRef}>
            <Label htmlFor="ws-stock-search">{t('watchlist.dialog.tickerLabel')}</Label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground dark:text-on-surface-variant" />
              <Input
                id="ws-stock-search"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
                placeholder={t('watchlist.dialog.searchPlaceholder')}
                className="pr-9 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface"
                dir="rtl"
              />
              {searching && (
                <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin dark:text-on-surface-variant" />
              )}
              {query && !searching && (
                <button
                  type="button"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground dark:text-on-surface-variant dark:hover:text-on-surface"
                  onClick={() => { setQuery(''); setSelectedStock(null); setResults([]); }}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {showDropdown && (
              <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border/60 rounded-md shadow-lg max-h-48 overflow-y-auto dark:bg-surface-container dark:border-outline-variant">
                {results.map((stock) => (
                  <button
                    key={stock.id}
                    type="button"
                    className={cn(
                      'w-full px-3 py-2 text-right flex items-center gap-3 hover:bg-accent transition-colors dark:hover:bg-surface-container-high',
                      selectedStock?.id === stock.id && 'bg-accent dark:bg-surface-container-high'
                    )}
                    onClick={() => handleSelectStock(stock)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm dark:text-on-surface dark:font-financial">{stock.ticker}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5">{stock.sector}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate dark:text-on-surface-variant">{stock.name_ar}</p>
                    </div>
                    <span className="text-sm font-medium tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(stock.current_price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected stock info */}
          {selectedStock && (
            <div className="p-3 rounded-lg bg-secondary/50 border border-border/60/50 dark:bg-surface-container dark:border-outline-variant/30">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm dark:text-on-surface dark:font-financial">{selectedStock.ticker}</span>
                <span className="text-xs text-muted-foreground dark:text-on-surface-variant">{selectedStock.name_ar}</span>
              </div>
              <p className="text-xs text-muted-foreground dark:text-on-surface-variant tabular-nums dark:font-financial">{t('watchlist.dialog.currentPrice')}: {formatCurrency(selectedStock.current_price)}</p>
            </div>
          )}

          {/* Purchase price & quantity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ws-purchase-price">{t('watchlist.dialog.purchasePrice')}</Label>
              <Input
                id="ws-purchase-price"
                type="number"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="0.00"
                dir="ltr"
                className="dark:bg-surface-container dark:border-outline-variant dark:text-on-surface tabular-nums dark:font-financial"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-quantity">{t('watchlist.dialog.quantity')}</Label>
              <Input
                id="ws-quantity"
                type="number"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                dir="ltr"
                className="dark:bg-surface-container dark:border-outline-variant dark:text-on-surface tabular-nums dark:font-financial"
              />
            </div>
          </div>

          {/* Alert prices */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ws-alert-above">{t('watchlist.dialog.alertAbove')}</Label>
              <Input
                id="ws-alert-above"
                type="number"
                step="0.01"
                value={alertPriceAbove}
                onChange={(e) => setAlertPriceAbove(e.target.value)}
                placeholder="0.00"
                dir="ltr"
                className="dark:bg-surface-container dark:border-outline-variant dark:text-on-surface tabular-nums dark:font-financial"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-alert-below">{t('watchlist.dialog.alertBelow')}</Label>
              <Input
                id="ws-alert-below"
                type="number"
                step="0.01"
                value={alertPriceBelow}
                onChange={(e) => setAlertPriceBelow(e.target.value)}
                placeholder="0.00"
                dir="ltr"
                className="dark:bg-surface-container dark:border-outline-variant dark:text-on-surface tabular-nums dark:font-financial"
              />
            </div>
          </div>

          {/* Alert change percent */}
          <div className="space-y-2">
            <Label htmlFor="ws-alert-change">{t('watchlist.dialog.alertChange')}</Label>
            <Input
              id="ws-alert-change"
              type="number"
              step="0.1"
              value={alertChangePercent}
              onChange={(e) => setAlertChangePercent(e.target.value)}
              placeholder="0.0"
              dir="ltr"
              className="dark:bg-surface-container dark:border-outline-variant dark:text-on-surface tabular-nums dark:font-financial"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="ws-notes">{t('watchlist.dialog.notesOptional')}</Label>
            <Textarea
              id="ws-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('watchlist.dialog.notesPlaceholder')}
              rows={2}
              dir="rtl"
              className="dark:bg-surface-container dark:border-outline-variant dark:text-on-surface"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={resetAndClose}>{t('watchlist.buttons.cancel')}</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90"
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
  const t = useTranslation();
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
      const res = await fetch(`/api/watchlist-enhanced/${item.id}?market=${useAppStore.getState().currentMarket || 'EGX'}`, {
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
    } catch { // silent fallback (safe-by-design)
      toast.error(t('watchlist.dialog.connectionError'));
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
              placeholder={t('watchlist.dialog.notesPlaceholder')}
              rows={2}
              dir="rtl"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-600 text-white"
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

// ==================== MOBILE CARD COMPONENT ====================

// UI-STABILITY fix (2026-09-28): wrap WatchlistMobileCard in React.memo so
// background price refreshes don't re-render every mobile card that hasn't
// changed (only rows whose `item` reference changed will re-render).
const WatchlistMobileCard = memo(function WatchlistMobileCard({
  item,
  hasGainLoss,
  onEdit,
  onDelete,
  onAnalyze
}: {
  item: EnhancedWatchlistItem;
  hasGainLoss: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAnalyze: () => void;
}) {
  const hasAlertAbove = item.alert_price_above !== null;
  const hasAlertBelow = item.alert_price_below !== null;
  const hasAlertChange = item.alert_change_percent !== null;
  const hasAnyAlert = hasAlertAbove || hasAlertBelow || hasAlertChange;

  const isAboveTriggered = hasAlertAbove && item.current_price >= item.alert_price_above!;
  const isBelowTriggered = hasAlertBelow && item.current_price <= item.alert_price_below!;

  const isProfitable = item.gain_loss >= 0;

  return (
    <Card className={cn(
      'overflow-hidden dark:bg-surface-container-low dark:border dark:border-outline-variant/30',
      hasGainLoss && item.purchase_price && item.quantity && isProfitable && 'border-emerald-500/30 dark:border-emerald-500/30 dark:border-primary-container/40',
      hasGainLoss && item.purchase_price && item.quantity && !isProfitable && 'border-rose-500/30 dark:border-rose-500/30 dark:border-error-container/40'
    )}>
      <CardContent className="p-4">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 dark:bg-emerald-600/80/30 dark:bg-primary-container/30 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-primary dark:text-primary dark:text-primary dark:font-financial">
                {(item.ticker || '').slice(0, 2)}
              </span>
            </div>
            <div className="min-w-0">
              <p className="font-bold dark:text-on-surface dark:font-financial">{item.ticker}</p>
              <p className="text-xs text-muted-foreground truncate dark:text-on-surface-variant">{item.name_ar}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {hasAnyAlert && (
              <div className="relative">
                <Bell className="w-4 h-4 text-amber-500" />
                {(isAboveTriggered || isBelowTriggered) && (
                  <span className="absolute -top-1 -left-1 w-2 h-2 bg-rose-500 rounded-full" />
                )}
              </div>
            )}
            <StockPublisher
              data={{
                ticker: item.ticker,
                nameAr: item.name_ar,
                nameEn: item.name,
                sector: item.sector,
                currentPrice: Number(item.current_price ?? 0),
                changePct: Number(item.price_change_percent ?? 0),
                entryPrice: Number(item.purchase_price ?? 0) || undefined,
              }}
              variant="icon"
              size="sm"
            />
          </div>
        </div>

        {/* Price Section */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-secondary/50 rounded-lg p-2.5 dark:bg-surface-container">
            <p className="text-xs text-muted-foreground dark:text-on-surface-variant mb-0.5">السعر الحالي</p>
            <p className="font-bold text-lg tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(item.current_price)}</p>
            <div className="flex items-center gap-1 mt-1">
              {item.price_change >= 0 ? (
                <TrendingUp className="w-3 h-3 text-primary dark:text-primary" />
              ) : (
                <TrendingDown className="w-3 h-3 text-rose-400 dark:text-error" />
              )}
              <span className={cn(
                'text-xs font-semibold tabular-nums dark:font-financial',
                item.price_change >= 0 ? 'text-primary dark:text-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error'
              )}>
                {formatPercent(item.price_change_percent)}
              </span>
            </div>
          </div>

          {hasGainLoss && item.purchase_price && item.quantity && (
            <div className={cn(
              'rounded-lg p-2.5',
              isProfitable ? 'bg-emerald-50 dark:bg-emerald-600/60/30 dark:bg-primary-container/20' : 'bg-red-50 dark:bg-rose-500/60/30 dark:bg-error-container/20'
            )}>
              <p className="text-xs text-muted-foreground dark:text-on-surface-variant mb-0.5">الربح/الخسارة</p>
              <p className={cn(
                'font-bold text-lg tabular-nums dark:font-financial',
                isProfitable ? 'text-primary dark:text-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error'
              )}>
                {formatCurrency(Math.abs(item.gain_loss))}
              </p>
              <Badge className={cn(
                'text-[10px] px-1.5 mt-1 tabular-nums dark:font-financial',
                isProfitable
                  ? 'bg-emerald-500/10 text-primary dark:bg-emerald-600/80/30 dark:text-primary dark:bg-primary-container/30 dark:text-primary'
                  : 'bg-rose-500/10 text-rose-400 dark:bg-rose-500/60/30 dark:text-rose-400 dark:bg-error-container/30 dark:text-error'
              )}>
                {formatPercent(item.gain_loss_percent)}
              </Badge>
            </div>
          )}
        </div>

        <div className="mb-3">
          <MiniSparkline ticker={item.ticker} height={28} width={160} showArea />
        </div>

        {/* Details Row */}
        {hasGainLoss && item.purchase_price && (
          <div className="grid grid-cols-3 gap-2 text-xs mb-3">
            <div>
              <p className="text-muted-foreground dark:text-on-surface-variant">سعر الشراء</p>
              <p className="font-medium tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(item.purchase_price)}</p>
            </div>
            <div>
              <p className="text-muted-foreground dark:text-on-surface-variant">الكمية</p>
              <p className="font-medium tabular-nums dark:font-financial dark:text-on-surface">{item.quantity?.toLocaleString('ar-EG') || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground dark:text-on-surface-variant">المستثمر</p>
              <p className="font-medium tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(item.total_invested)}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border/60 dark:border-outline-variant/30">
          <Button
            variant="outline"
            size="sm"
            onClick={onAnalyze}
            className="h-9 border-primary text-primary hover:bg-primary/10 dark:border-primary-container dark:text-primary dark:hover:bg-primary-container/20"
            title="مستشار الصفقة"
          >
            <Sparkles className="w-3.5 h-3.5 ml-1.5" />
            مستشار
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            className="h-9 dark:bg-surface-container dark:border-outline-variant dark:text-on-surface"
          >
            <Pencil className="w-3.5 h-3.5 ml-1.5" />
            تعديل
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            className="h-9 text-rose-400 hover:text-rose-400 hover:bg-red-50 dark:hover:bg-rose-500/60/20 dark:text-error dark:hover:bg-error-container/20 dark:border-error-container/40"
          >
            <Trash2 className="w-3.5 h-3.5 ml-1.5" />
            حذف
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

// ==================== MAIN VIEW ====================

export function EnhancedWatchlistView() {
  const t = useTranslation();
  const [items, setItems] = useState<EnhancedWatchlistItem[]>([]);
  const [summary, setSummary] = useState<WatchlistSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<EnhancedWatchlistItem | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showIntelligence, setShowIntelligence] = useState(false);
  // UI-FIX-P2-P3 issue 2.10: track API failure separately from "empty watchlist"
  // so we can show a retry button + support link instead of a misleading "empty" state.
  const [loadError, setLoadError] = useState<boolean>(false);
  const { currentMarket } = useAppStore();
  const { setDealAdvisorPrefill, setCurrentView } = useAppStore();
  const [selectedSheetTicker, setSelectedSheetTicker] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await fetch(`/api/watchlist-enhanced?market=${useAppStore.getState().currentMarket || 'EGX'}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WatchlistResponse = await res.json();
      setItems(data.items || []);
      setSummary(data.summary || null);
      setLastUpdate(new Date());
      setLoadError(false);
    } catch { // silent fallback (safe-by-design)
      if (!isRefresh) {
        toast.error('فشل في تحميل قائمة المراقبة');
        setLoadError(true);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData(true);
    }, 30000);
    return () => clearInterval(interval);
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
    } catch { // silent fallback (safe-by-design)
      toast.error(t('watchlist.dialog.connectionError'));
    }
  };

  const handleEdit = (item: EnhancedWatchlistItem) => {
    setEditItem(item);
    setEditDialogOpen(true);
  };

  // hooks must be called unconditionally before any early return (Rules of Hooks).
  const hasGainLoss = items.some((i) => i.purchase_price && i.quantity);

  // UI-STABILITY fix (2026-09-28): wrap watchlistColumns in useMemo so the
  // columns array reference is stable across renders. Without this, every
  // background price refresh created a NEW columns array → UnifiedTable threw
  // away its sort/filter state and recomputed everything.
  // Depends on: hasGainLoss (column visibility), and the action handlers
  // (setDealAdvisorPrefill / setCurrentView / handleEdit / setDeleteId) which
  // are stable references from useState/useCallback/setter — including them
  // in deps is safe and won't cause unnecessary re-creation.
  const watchlistColumns: Column<EnhancedWatchlistItem>[] = useMemo(() => [
    {
      key: 'ticker',
      header: t('watchlist.columns.stock'),
      sortable: true,
      filterable: true,
      render: (item) => (
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-emerald-500/10 dark:bg-emerald-600/80/30 dark:bg-primary-container/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-primary dark:text-primary dark:text-primary dark:font-financial">
              {(item.ticker || '').slice(0, 2)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm dark:text-on-surface dark:font-financial">{item.ticker}</p>
            <p className="text-xs text-muted-foreground truncate max-w-[120px] dark:text-on-surface-variant">{item.name_ar}</p>
          </div>
          <StockPublisher
            data={{
              ticker: item.ticker,
              nameAr: item.name_ar,
              nameEn: item.name,
              sector: item.sector,
              currentPrice: Number(item.current_price ?? 0),
              changePct: Number(item.price_change_percent ?? 0),
              entryPrice: Number(item.purchase_price ?? 0) || undefined,
            }}
            variant="icon"
            size="sm"
          />
        </div>
      ),
    },
    {
      key: 'current_price',
      header: t('watchlist.columns.currentPrice'),
      align: 'center',
      sortable: true,
      filterable: true,
      render: (item) => <p className="font-semibold text-sm tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(item.current_price)}</p>,
    },
    {
      key: 'sparkline',
      header: t('watchlist.columns.chart7d'),
      align: 'center',
      hideable: true,
      render: (item) => (
        <div className="w-32 mx-auto" dir="ltr">
          <MiniSparkline ticker={item.ticker} days={7} height={28} width={120} showArea />
        </div>
      ),
    },
    {
      key: 'purchase_price',
      header: t('watchlist.columns.purchasePrice'),
      align: 'center',
      sortable: true,
      filterable: true,
      hideable: true,
      render: (item) => (
        <p className="text-sm text-muted-foreground dark:text-on-surface-variant tabular-nums dark:font-financial">
          {item.purchase_price ? formatCurrency(item.purchase_price) : '—'}
        </p>
      ),
    },
    {
      key: 'quantity',
      header: t('watchlist.columns.quantity'),
      align: 'center',
      sortable: true,
      filterable: true,
      hideable: true,
      render: (item) => (
        <p className="text-sm tabular-nums dark:font-financial dark:text-on-surface">
          {item.quantity ? item.quantity.toLocaleString('ar-EG') : '—'}
        </p>
      ),
    },
    {
      key: 'total_invested',
      header: t('watchlist.columns.investor'),
      align: 'center',
      sortable: true,
      filterable: true,
      hideable: true,
      render: (item) => <p className="text-sm font-medium tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(item.total_invested)}</p>,
    },
    {
      key: 'current_value',
      header: t('watchlist.columns.currentValue'),
      align: 'center',
      sortable: true,
      filterable: true,
      hideable: true,
      render: (item) => <p className="text-sm font-medium tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(item.current_value)}</p>,
    },
    {
      key: 'gain_loss',
      header: t('watchlist.columns.pnl'),
      align: 'center',
      sortable: true,
      filterable: true,
      hideable: true,
      render: (item) => {
        const isProfitable = item.gain_loss >= 0;
        return (
          <div className="flex flex-col items-center gap-0.5">
            <span className={cn(
              'text-sm font-semibold tabular-nums dark:font-financial',
              isProfitable ? 'text-primary dark:text-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error'
            )}>
              {formatCurrency(Math.abs(item.gain_loss))}
            </span>
            <Badge className={cn(
              'text-[10px] px-1.5 tabular-nums dark:font-financial',
              isProfitable
                ? 'bg-emerald-500/10 text-primary dark:bg-emerald-600/80/30 dark:text-primary dark:bg-primary-container/30 dark:text-primary'
                : 'bg-rose-500/10 text-rose-400 dark:bg-rose-500/60/30 dark:text-rose-400 dark:bg-error-container/30 dark:text-error'
            )}>
              {formatPercent(item.gain_loss_percent)}
            </Badge>
          </div>
        );
      },
    },
    {
      key: 'price_change',
      header: t('watchlist.columns.change'),
      align: 'center',
      sortable: true,
      filterable: true,
      render: (item) => (
        <div className="flex items-center justify-center gap-1">
          {item.price_change >= 0 ? (
            <TrendingUp className="w-3.5 h-3.5 text-primary dark:text-primary" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-rose-400 dark:text-error" />
          )}
          <span className={cn(
            'text-xs font-semibold tabular-nums dark:font-financial',
            item.price_change >= 0 ? 'text-primary dark:text-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error'
          )}>
            {formatPercent(item.price_change_percent)}
          </span>
        </div>
      ),
    },
    {
      key: 'alerts',
      header: t('watchlist.columns.alerts'),
      align: 'center',
      render: (item) => {
        const hasAlertAbove = item.alert_price_above !== null;
        const hasAlertBelow = item.alert_price_below !== null;
        const hasAlertChange = item.alert_change_percent !== null;
        const hasAnyAlert = hasAlertAbove || hasAlertBelow || hasAlertChange;
        const isAboveTriggered = hasAlertAbove && item.current_price >= item.alert_price_above!;
        const isBelowTriggered = hasAlertBelow && item.current_price <= item.alert_price_below!;
        return (
          <div className="flex items-center justify-center gap-1">
            {hasAnyAlert ? (
              <div className="relative">
                <Bell className="w-4 h-4 text-amber-500" />
                {(isAboveTriggered || isBelowTriggered) && (
                  <span className="absolute -top-1 -left-1 w-2 h-2 bg-rose-500 dark:bg-error rounded-full" />
                )}
              </div>
            ) : (
              <BellOff className="w-4 h-4 text-muted-foreground dark:text-on-surface-variant" />
            )}
          </div>
        );
      },
    },
    {
      key: '_actions',
      header: t('watchlist.columns.actions'),
      align: 'center',
      render: (item) => (
        <div className="flex items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-primary hover:bg-primary/10"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedSheetTicker(item.ticker);
              setDealAdvisorPrefill({
                ticker: item.ticker,
                entryPrice: item.purchase_price ?? null,
                entryQty: item.quantity ?? null,
                source: 'watchlist',
              });
              setCurrentView('trading-chart');
            }}
            title="مستشار الصفقة"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
            onClick={(e) => { e.stopPropagation(); handleEdit(item); }}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-rose-400 hover:bg-red-50 dark:hover:bg-rose-500/60/20"
            onClick={(e) => { e.stopPropagation(); setDeleteId(item.id); }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ),
    },
  ], [
    // UI-STABILITY fix (2026-09-28): columns array dependencies.
    // - hasGainLoss: toggles visibility of gain/loss, purchase_price, quantity, etc.
    // - setDealAdvisorPrefill / setCurrentView / handleEdit / setDeleteId: stable
    //   references from useState setters / useCallback — they don't change identity
    //   between renders, but listing them satisfies the exhaustive-deps rule.
    hasGainLoss, setDealAdvisorPrefill, setCurrentView, handleEdit, setDeleteId,
  ]);

  // ==================== LOADING STATE ====================
  // NOTE: must be AFTER all hook calls (useMemo above) to satisfy Rules of Hooks.
  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-background dark:bg-surface-container-lowest">
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

  return (
    <div dir="rtl" className="min-h-screen bg-background dark:bg-surface-container-lowest">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 dark:bg-emerald-600/80/30 dark:bg-primary-container/30 flex items-center justify-center">
              <Eye className="w-5 h-5 text-primary dark:text-primary dark:text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold dark:text-on-surface dark:font-outfit">{t('watchlist.title')}</h1>
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground dark:text-on-surface-variant">{t('watchlist.subtitle')}</p>
                {lastUpdate && (
                  <span className="text-xs text-muted-foreground dark:text-on-surface-variant flex items-center gap-1 tabular-nums dark:font-financial">
                    <Clock className="w-3 h-3" />
                    {lastUpdate.toLocaleTimeString('ar-EG')}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showIntelligence ? "default" : "outline"}
              size="sm"
              onClick={() => setShowIntelligence(!showIntelligence)}
            >
              <Brain className="w-4 h-4 ml-1.5" />
              {showIntelligence ? t('watchlist.toggle.regular') : t('watchlist.toggle.smart')}
            </Button>
            <UnifiedPublishButton
              variant="outline"
              size="sm"
              className="h-8"
              title="قائمة المراقبة"
              content={`قائمة المراقبة — ${items.length} سهم${lastUpdate ? `\nآخر تحديث: ${lastUpdate.toLocaleString('ar-EG')}` : ''}\n\n${items.slice(0, 15).map((w, i) => `${i + 1}. ${w.ticker} — ${w.name_ar || w.name || ''}${w.current_price ? ` — ${w.current_price}` : ''}${w.price_change_percent != null ? ` (${w.price_change_percent >= 0 ? '+' : ''}${w.price_change_percent.toFixed(2)}%)` : ''}`).join('\n')}`}
              filename={`watchlist-${Date.now()}`}
              hashtags={['مراقبة', 'أسهم', 'بورصة']}
              triggerLabel="نشر"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData(true)}
              disabled={refreshing}
            >
              <RefreshCw className={cn("w-4 h-4 ml-1.5", refreshing && "animate-spin")} />
              تحديث
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90"
              size="sm"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="w-4 h-4 ml-1.5" />
              إضافة سهم
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        {/* UI-STABILITY fix (2026-09-28): stable key prevents unmount/remount on silent refresh */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" key="watchlist-summary-cards">
            <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <div className="flex items-center gap-2 text-muted-foreground dark:text-on-surface-variant mb-1">
                <BarChart3 className="w-4 h-4" />
                <span className="text-xs font-medium">{t('watchlist.stats.count')}</span>
              </div>
              <p className="text-xl font-bold tabular-nums dark:font-financial dark:text-on-surface">{(summary.total_items ?? 0).toLocaleString('ar-EG')}</p>
            </Card>
            <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <div className="flex items-center gap-2 text-muted-foreground dark:text-on-surface-variant mb-1">
                <Wallet className="w-4 h-4" />
                <span className="text-xs font-medium">{t('watchlist.stats.totalInvested')}</span>
              </div>
              <p className="text-xl font-bold tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(summary.total_invested)}</p>
            </Card>
            <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <div className="flex items-center gap-2 text-muted-foreground dark:text-on-surface-variant mb-1">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs font-medium">{t('watchlist.stats.currentValue')}</span>
              </div>
              <p className="text-xl font-bold tabular-nums dark:font-financial dark:text-on-surface">{formatCurrency(summary.total_current_value)}</p>
            </Card>
            <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
              <div className="flex items-center gap-2 text-muted-foreground dark:text-on-surface-variant mb-1">
                {summary.total_gain_loss >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-primary dark:text-primary" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-rose-400 dark:text-error" />
                )}
                <span className="text-xs font-medium">{t('watchlist.stats.pnl')}</span>
              </div>
              <div className="flex items-center gap-2">
                <p className={cn(
                  'text-xl font-bold tabular-nums dark:font-financial',
                  summary.total_gain_loss >= 0 ? 'text-primary dark:text-primary dark:text-primary' : 'text-rose-400 dark:text-rose-400 dark:text-error'
                )}>
                  {formatCurrency(Math.abs(summary.total_gain_loss))}
                </p>
                <Badge className={cn(
                  'text-xs',
                  summary.total_gain_loss >= 0
                    ? 'bg-emerald-500/10 text-primary dark:bg-emerald-600/80/30 dark:text-primary dark:bg-primary-container/30 dark:text-primary'
                    : 'bg-rose-500/10 text-rose-400 dark:bg-rose-500/60/30 dark:text-rose-400 dark:bg-error-container/30 dark:text-error'
                )}>
                  {formatPercent(summary.total_gain_loss_percent)}
                </Badge>
              </div>
            </Card>
          </div>
        )}

        {/* Intelligence Section */}
        {/* UI-STABILITY fix (2026-09-28): stable key on conditional section */}
        {showIntelligence && (
          <WatchlistIntelligenceSection key="watchlist-intelligence-section" />
        )}

        {/* Empty State */}
        {/* UI-STABILITY fix (2026-09-28): stable key on conditional section */}
        {/* UI-FIX-P2-P3 issue 2.10: hide empty-state when API failed; show error card instead */}
        {!showIntelligence && !loadError && items.length === 0 && (
          <Card className="border-dashed dark:bg-surface-container-low dark:border-outline-variant" key="watchlist-empty-state">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4 dark:bg-surface-container">
                <EyeOff className="w-8 h-8 text-muted-foreground dark:text-on-surface-variant" />
              </div>
              <h3 className="text-lg font-semibold mb-2 dark:text-on-surface dark:font-outfit">{t('watchlist.empty.title')}</h3>
              <p className="text-sm text-muted-foreground dark:text-on-surface-variant max-w-sm">
                {t('watchlist.empty.body')}
              </p>
              <Button
                className="mt-6 bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90"
                onClick={() => setAddDialogOpen(true)}
              >
                <Plus className="w-4 h-4 ml-2" />
                {t('watchlist.empty.addButton')}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Error State — UI-FIX-P2-P3 issue 2.10: actionable retry + support link */}
        {!showIntelligence && loadError && (
          <Card className="border-destructive/30 bg-destructive/5 dark:bg-surface-container-low dark:border-error-container/40 dark:bg-error-container/10" key="watchlist-error-state">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4 dark:bg-error-container/20">
                <AlertCircle className="w-8 h-8 text-destructive dark:text-error" />
              </div>
              <h3 className="text-lg font-semibold mb-2 dark:text-on-surface dark:font-outfit">{t('watchlist.error.title')}</h3>
              <p className="text-sm text-muted-foreground dark:text-on-surface-variant max-w-sm mb-6">
                {t('watchlist.error.body')}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="default"
                  className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-primary dark:text-on-primary dark:hover:bg-primary/90"
                  onClick={() => fetchData(false)}
                  disabled={loading}
                >
                  <RefreshCw className={cn('w-4 h-4 ml-2', loading && 'animate-spin')} />
                  {t('watchlist.buttons.retry')}
                </Button>
                <a
                  href="mailto:support@invist.m2y.net"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors text-sm font-medium dark:bg-surface-container dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high"
                >
                  {t('watchlist.buttons.support')}
                </a>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Watchlist - Mobile Cards View */}
        {/* UI-STABILITY fix (2026-09-28): stable key on conditional section */}
        {!showIntelligence && items.length > 0 && (
          <div className="md:hidden space-y-3 dark:bg-transparent" key="watchlist-mobile-cards">
            {items.map((item) => (
              <WatchlistMobileCard
                key={item.id}
                item={item}
                hasGainLoss={hasGainLoss}
                onEdit={() => handleEdit(item)}
                onDelete={() => setDeleteId(item.id)}
                onAnalyze={() => {
                  setDealAdvisorPrefill({
                    ticker: item.ticker,
                    entryPrice: item.purchase_price ?? null,
                    entryQty: item.quantity ?? null,
                    source: 'watchlist',
                  });
                  setCurrentView('trading-chart');
                }}
              />
            ))}
          </div>
        )}

        {/* Watchlist - Desktop Table View */}
        {/* UI-STABILITY fix (2026-09-28): stable key + silent refresh */}
        {!showIntelligence && items.length > 0 && (
          <Card className="hidden md:block dark:bg-surface-container-low dark:border dark:border-outline-variant/30" key="watchlist-desktop-table">
            <CardContent className="p-0">
              <UnifiedTable<EnhancedWatchlistItem>
                columns={watchlistColumns}
                data={items}
                keyField="id"
                dense
                columnToggle
                filterable
                rowClassName={(item) => cn(
                  'hover:bg-secondary/50',
                  hasGainLoss && item.purchase_price && item.quantity && item.gain_loss >= 0 && 'bg-emerald-50/50 dark:bg-emerald-600/60/10 dark:bg-primary-container/10',
                  hasGainLoss && item.purchase_price && item.quantity && item.gain_loss < 0 && 'bg-red-50/50 dark:bg-rose-500/60/10 dark:bg-error-container/10',
                )}
              />
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
            <DialogTitle className="flex items-center gap-2 text-rose-400 dark:text-error">
              <AlertTriangle className="w-5 h-5" />
              {t('watchlist.delete.title')}
            </DialogTitle>
            <DialogDescription>
              {t('watchlist.delete.body')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t('watchlist.buttons.cancel')}</Button>
            <Button
              className="bg-rose-500 hover:bg-rose-500/80 text-white dark:bg-error dark:text-on-error dark:hover:bg-error/90"
              onClick={handleDelete}
            >
              {t('watchlist.buttons.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    
      <StockDetailSheet
        ticker={selectedSheetTicker}
        stockData={null}
        onClose={() => setSelectedSheetTicker(null)}
      />
</div>
  );
}
