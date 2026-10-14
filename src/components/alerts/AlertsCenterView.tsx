'use client';

import React, { useState, useEffect } from 'react';
import {
  Bell,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Bitcoin,
  Shield,
  RefreshCw,
  Eye,
  Clock,
  DollarSign,
  Percent,
  Target,
  Calendar,
  CreditCard,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from '@/lib/i18n-context';

// ==================== TYPES ====================

interface PriceAlert {
  id: string;
  type: 'stock' | 'crypto';
  ticker: string;
  name: string;
  name_ar: string;
  current_price: number;
  target_price: number;
  condition: 'above' | 'below';
  triggered: boolean;
  created_at: string;
}

interface PortfolioAlert {
  id: string;
  asset_type: 'stock' | 'crypto' | 'gold' | 'bank' | 'certificate' | 'fund';
  name: string;
  alert_type: 'profit' | 'loss' | 'change';
  value: number;
  percent: number;
  message: string;
  severity: 'info' | 'warning' | 'danger';
  created_at: string;
}

interface MarketAlert {
  id: string;
  type: 'market_open' | 'market_close' | 'earnings' | 'dividend' | 'news';
  title: string;
  message: string;
  related_ticker?: string;
  severity: 'info' | 'warning' | 'danger';
  created_at: string;
}

interface ObligationAlert {
  id: string;
  obligationId: number;
  name: string;
  creditor: string;
  monthly_payment: number;
  remaining_amount: number;
  next_payment_date: string;
  daysUntilDue: number;
  severity: 'overdue' | 'critical' | 'warning' | 'info';
}

// ==================== HELPERS ====================

function formatCurrency(value: number, isCrypto: boolean = false): string {
  if (isCrypto) {
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' ج.م';
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value ?? 0).toFixed(2)}%`;
}

function formatTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  return `منذ ${diffDays} يوم`;
}

// ==================== COMPONENTS ====================

function PriceAlertCard({ alert }: { alert: PriceAlert }) {
  const isAbove = alert.condition === 'above';
  const distance = alert.current_price > 0 
    ? ((alert.target_price - alert.current_price) / alert.current_price) * 100 
    : 0;

  return (
    <Card className={cn(
      'transition-all duration-200 hover:shadow-md dark:bg-surface-container-low dark:border dark:border-outline-variant/30',
      alert.triggered && 'border-emerald-500 dark:border-primary bg-emerald-50/50 dark:bg-primary-container/20'
    )}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center dark:bg-surface-container-high',
              alert.type === 'crypto' 
                ? 'bg-orange-100 dark:bg-surface-container-high' 
                : 'bg-emerald-100 dark:bg-surface-container-high'
            )}>
              {alert.type === 'crypto' 
                ? <Bitcoin className="w-5 h-5 text-orange-600 dark:text-primary" />
                : <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-primary" />
              }
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm dark:text-on-surface dark:font-financial tabular-nums">{alert.ticker}</span>
                <Badge variant="outline" className="text-[10px] dark:border-outline-variant dark:text-on-surface-variant">
                  {alert.type === 'crypto' ? 'عملة رقمية' : 'سهم'}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground dark:text-on-surface-variant">{alert.name_ar}</span>
            </div>
          </div>
          {alert.triggered && (
            <Badge className="bg-emerald-500 text-white text-[10px] dark:bg-primary-container dark:text-on-primary">
              <CheckCircle2 className="w-3 h-3 ml-1" />
              تم التفعيل
            </Badge>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="p-2 rounded-lg bg-muted/50 dark:bg-surface-container dark:border dark:border-outline-variant/30">
            <span className="text-xs text-muted-foreground dark:text-on-surface-variant">السعر الحالي</span>
            <p className="font-semibold tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{formatCurrency(alert.current_price, alert.type === 'crypto')}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/50 dark:bg-surface-container dark:border dark:border-outline-variant/30">
            <span className="text-xs text-muted-foreground dark:text-on-surface-variant">
              {isAbove ? 'السعر المستهدف (أعلى)' : 'السعر المستهدف (أقل)'}
            </span>
            <p className="font-semibold tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{formatCurrency(alert.target_price, alert.type === 'crypto')}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground dark:text-on-surface-variant">
            <Clock className="w-3.5 h-3.5" />
            {formatTimeAgo(alert.created_at)}
          </div>
          <div className={cn(
            'flex items-center gap-1 text-xs font-medium tabular-nums dark:font-financial',
            distance > 0 ? 'text-emerald-600 dark:text-primary' : 'text-red-600 dark:text-error'
          )}>
            {isAbove ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            المسافة: {formatPercent(Math.abs(distance))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PortfolioAlertCard({ alert }: { alert: PortfolioAlert }) {
  const severityColors = {
    info: 'border-teal-200 dark:border-teal-800 bg-slate-50/50 dark:bg-slate-900/20',
    warning: 'border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/20',
    danger: 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20',
  };

  const severityIconColors = {
    info: 'text-teal-600 dark:text-teal-400 bg-teal-100 dark:bg-teal-900/30',
    warning: 'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30',
    danger: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30',
  };

  const typeLabels: Record<string, string> = {
    stock: 'أسهم',
    crypto: 'عملات رقمية',
    gold: 'ذهب',
    bank: 'بنك',
    certificate: 'شهادات',
    fund: 'صناديق',
  };

  return (
    <Card className={cn('transition-all duration-200 hover:shadow-md dark:bg-surface-container-low dark:border dark:border-outline-variant/30', severityColors[alert.severity])}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 dark:bg-surface-container-high',
            severityIconColors[alert.severity]
          )}>
            {alert.alert_type === 'profit' ? (
              <TrendingUp className="w-5 h-5" />
            ) : alert.alert_type === 'loss' ? (
              <TrendingDown className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm dark:text-on-surface">{alert.name}</span>
              <Badge variant="outline" className="text-[10px] dark:border-outline-variant dark:text-on-surface-variant">{typeLabels[alert.asset_type]}</Badge>
            </div>
            <p className="text-sm text-muted-foreground dark:text-on-surface-variant">{alert.message}</p>
            <div className="mt-2 flex items-center gap-3">
              <span className={cn(
                'font-bold text-lg tabular-nums dark:font-financial',
                alert.percent >= 0 ? 'text-emerald-600 dark:text-primary' : 'text-red-600 dark:text-error'
              )}>
                {formatPercent(alert.percent)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums dark:font-financial dark:text-on-surface-variant">
                {formatCurrency(alert.value)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MarketAlertCard({ alert }: { alert: MarketAlert }) {
  const severityColors = {
    info: 'border-teal-200 dark:border-teal-800 bg-slate-50/50 dark:bg-slate-900/20',
    warning: 'border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/20',
    danger: 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20',
  };

  return (
    <Card className={cn('transition-all duration-200 hover:shadow-md dark:bg-surface-container-low dark:border dark:border-outline-variant/30', severityColors[alert.severity])}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted flex-shrink-0 dark:bg-surface-container-high">
            <Bell className="w-5 h-5 text-muted-foreground dark:text-on-surface-variant" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm mb-1 dark:text-on-surface">{alert.title}</h4>
            <p className="text-sm text-muted-foreground dark:text-on-surface-variant">{alert.message}</p>
            {alert.related_ticker && (
              <Badge variant="outline" className="mt-2 text-[10px] dark:border-outline-variant dark:text-on-surface-variant">{alert.related_ticker}</Badge>
            )}
            <div className="mt-2 text-xs text-muted-foreground dark:text-on-surface-variant flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimeAgo(alert.created_at)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ObligationAlertCard({ alert }: { alert: ObligationAlert }) {
  const severityColors: Record<ObligationAlert['severity'], string> = {
    overdue: 'border-red-500 dark:border-red-400 bg-red-50/60 dark:bg-red-950/30',
    critical: 'border-red-400 dark:border-red-500 bg-red-50/40 dark:bg-red-950/20',
    warning: 'border-amber-400 dark:border-amber-500 bg-amber-50/60 dark:bg-amber-950/20',
    info: 'border-teal-400 dark:border-teal-500 bg-slate-50/60 dark:bg-slate-900/20',
  };

  const severityBadge: Record<ObligationAlert['severity'], string> = {
    overdue: 'bg-red-500 text-white',
    critical: 'bg-red-500 text-white',
    warning: 'bg-amber-500 text-white',
    info: 'bg-teal-500 text-white',
  };

  const dueLabel = alert.daysUntilDue < 0
    ? `متأخر ${Math.abs(alert.daysUntilDue)} يوم`
    : `خلال ${alert.daysUntilDue} يوم`;

  let formattedDate = alert.next_payment_date;
  try {
    const d = new Date(alert.next_payment_date);
    if (!isNaN(d.getTime())) {
      formattedDate = d.toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  } catch { /* keep raw - safe-by-design */ }

  return (
    <Card className={cn('transition-all duration-200 hover:shadow-md dark:bg-surface-container-low dark:border dark:border-outline-variant/30', severityColors[alert.severity])}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted flex-shrink-0 dark:bg-surface-container-high">
              <CreditCard className="w-5 h-5 text-muted-foreground dark:text-on-surface-variant" />
            </div>
            <div>
              <span className="font-bold text-sm dark:text-on-surface">{alert.name}</span>
              {alert.creditor && (
                <span className="block text-xs text-muted-foreground dark:text-on-surface-variant">{alert.creditor}</span>
              )}
            </div>
          </div>
          <Badge className={cn('text-[10px] dark:font-financial tabular-nums', severityBadge[alert.severity])}>
            <Clock className="w-3 h-3 ml-1" />
            {dueLabel}
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="p-2 rounded-lg bg-muted/50 dark:bg-surface-container dark:border dark:border-outline-variant/30">
            <span className="text-xs text-muted-foreground dark:text-on-surface-variant">القسط الشهري</span>
            <p className="font-semibold tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{formatCurrency(alert.monthly_payment)}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/50 dark:bg-surface-container dark:border dark:border-outline-variant/30">
            <span className="text-xs text-muted-foreground dark:text-on-surface-variant">المتبقي</span>
            <p className="font-semibold tabular-nums dark:font-financial dark:text-on-surface" dir="ltr">{formatCurrency(alert.remaining_amount)}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground dark:text-on-surface-variant">
          <Calendar className="w-3.5 h-3.5" />
          تاريخ الاستحقاق القادم: {formattedDate}
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== MAIN COMPONENT ====================

export function AlertsCenterView() {
  const t = useTranslation();
  const [loading, setLoading] = useState(true);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [portfolioAlerts, setPortfolioAlerts] = useState<PortfolioAlert[]>([]);
  const [marketAlerts, setMarketAlerts] = useState<MarketAlert[]>([]);
  const [obligationAlerts, setObligationAlerts] = useState<ObligationAlert[]>([]);
  const [filter, setFilter] = useState<'all' | 'stocks' | 'crypto'>('all');

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      // Load price alerts from watchlist
      const [stockWatchlistRes, cryptoWatchlistRes, portfolioRes, obligationsRes] = await Promise.all([
        fetch('/api/watchlist'),
        fetch('/api/crypto/watchlist').catch(() => ({ ok: false, json: () => Promise.resolve({ items: [] }) })),
        fetch('/api/finance/reports'),
        fetch('/api/finance/obligations?status=active').catch(() => ({ ok: false, json: () => Promise.resolve({ items: [] }) })),
      ]);

      const stockWatchlist = await stockWatchlistRes.json();
      const cryptoWatchlist = await cryptoWatchlistRes.json();
      const portfolioData = await portfolioRes.json();
      const obligationsData = await obligationsRes.json();

      // Convert stock watchlist to price alerts
      const stockAlerts: PriceAlert[] = (stockWatchlist.items || []).map((item: Record<string, unknown>) => ({
        id: `stock-${item.id}`,
        type: 'stock' as const,
        ticker: (item.ticker || (item.stock as Record<string, unknown>)?.ticker || '') as string,
        name: ((item.stock as Record<string, unknown>)?.name || '') as string,
        name_ar: ((item.stock as Record<string, unknown>)?.name_ar || '') as string,
        current_price: ((item.stock as Record<string, unknown>)?.current_price || 0) as number,
        target_price: (item.alert_price_above ?? null) as number | null,
        condition: 'above' as const,
        triggered: false,
        created_at: (item.added_at || new Date().toISOString()) as string,
      }));

      // Convert crypto watchlist to price alerts
      const cryptoAlerts: PriceAlert[] = (cryptoWatchlist.items || []).map((item: Record<string, unknown>) => ({
        id: `crypto-${item.id}`,
        type: 'crypto' as const,
        ticker: (item.symbol || '') as string,
        name: (item.name || '') as string,
        name_ar: (item.name || '') as string,
        current_price: (item.current_price || 0) as number,
        target_price: (item.alert_price ?? null) as number | null,
        condition: 'above' as const,
        triggered: false,
        created_at: new Date().toISOString(),
      }));

      setPriceAlerts([...stockAlerts, ...cryptoAlerts]);

      // Generate portfolio alerts
      const alerts: PortfolioAlert[] = [];
      if (portfolioData.summary?.alerts) {
        for (const alert of portfolioData.summary.alerts) {
          alerts.push({
            id: `portfolio-${Date.now()}-${Math.random()}`,
            asset_type: 'stock',
            name: 'المحفظة',
            alert_type: alert.category.includes('loss') ? 'loss' : 'profit',
            value: alert.value || 0,
            percent: alert.value || 0,
            message: alert.message,
            severity: alert.type === 'danger' ? 'danger' : alert.type === 'warning' ? 'warning' : 'info',
            created_at: new Date().toISOString(),
          });
        }
      }
      setPortfolioAlerts(alerts);

      // Mock market alerts
      setMarketAlerts([
        {
          id: 'market-1',
          type: 'market_open',
          title: 'افتتاح الجلسة',
          message: 'جلسة تداول البورصة المصرية تبدأ اليوم',
          severity: 'info',
          created_at: new Date().toISOString(),
        },
      ]);

      // Process payment-due obligations (only those due within 30 days)
      const obligationItems: Record<string, unknown>[] = obligationsData?.items || [];
      const dueAlerts: ObligationAlert[] = [];
      const nowMs = Date.now();
      for (const item of obligationItems) {
        const nextDateRaw = item.next_payment_date;
        if (!nextDateRaw) continue;
        const nextMs = new Date(String(nextDateRaw)).getTime();
        if (isNaN(nextMs)) continue;
        const daysUntilDue = Math.ceil((nextMs - nowMs) / 86400000);
        if (daysUntilDue > 30) continue;
        let severity: ObligationAlert['severity'];
        if (daysUntilDue < 0) severity = 'overdue';
        else if (daysUntilDue <= 3) severity = 'critical';
        else if (daysUntilDue <= 7) severity = 'warning';
        else severity = 'info';
        dueAlerts.push({
          id: `obl-${item.id}`,
          obligationId: Number(item.id) || 0,
          name: String(item.name || 'التزام'),
          creditor: String(item.creditor || ''),
          monthly_payment: Number(item.monthly_payment) || 0,
          remaining_amount: Number(item.remaining_amount) || 0,
          next_payment_date: String(nextDateRaw),
          daysUntilDue,
          severity,
        });
      }
      dueAlerts.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
      setObligationAlerts(dueAlerts);

    } catch (error) {
      console.error('Error loading alerts:', error);
      toast.error(t('alertsCenter.toast.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const filteredPriceAlerts = priceAlerts.filter(a => 
    filter === 'all' || a.type === filter.replace('s', '')
  );

  const stats = {
    total: priceAlerts.length + portfolioAlerts.length + marketAlerts.length + obligationAlerts.length,
    price: priceAlerts.length,
    portfolio: portfolioAlerts.length,
    market: marketAlerts.length,
    obligations: obligationAlerts.length,
    stocks: priceAlerts.filter(a => a.type === 'stock').length,
    crypto: priceAlerts.filter(a => a.type === 'crypto').length,
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4 dark:bg-surface-container-lowest" dir="rtl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30"><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
        <Card className="dark:bg-surface-container-low dark:border dark:border-outline-variant/30"><CardContent className="p-4"><Skeleton className="h-40 w-full" /></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-screen pb-20 dark:bg-surface-container-lowest" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-surface-container-high flex items-center justify-center">
            <Shield className="w-5 h-5 text-amber-600 dark:text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold dark:text-on-surface dark:font-outfit">{t('alertsCenter.title')}</h1>
            <p className="text-sm text-muted-foreground dark:text-on-surface-variant">{t('alertsCenter.subtitle')}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadAlerts} className="dark:border-outline-variant dark:text-on-surface dark:hover:bg-surface-container-high">
          <RefreshCw className="w-4 h-4 ml-1.5" />
          {t('alertsCenter.buttons.refresh')}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1 dark:text-on-surface-variant">
            <Bell className="w-4 h-4" />
            <span className="text-xs font-medium">{t('alertsCenter.stats.total')}</span>
          </div>
          <p className="text-2xl font-bold tabular-nums dark:font-financial dark:text-on-surface">{stats.total}</p>
        </Card>
        <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1 dark:text-on-surface-variant">
            <TrendingUp className="w-4 h-4 text-emerald-500 dark:text-primary" />
            <span className="text-xs font-medium">{t('alertsCenter.stats.stocks')}</span>
          </div>
          <p className="text-2xl font-bold text-emerald-600 dark:text-primary tabular-nums dark:font-financial">{stats.stocks}</p>
        </Card>
        <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1 dark:text-on-surface-variant">
            <Bitcoin className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-medium">{t('alertsCenter.stats.crypto')}</span>
          </div>
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400 tabular-nums dark:font-financial">{stats.crypto}</p>
        </Card>
        <Card className="p-4 dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-1 dark:text-on-surface-variant">
            <Target className="w-4 h-4 text-teal-500 dark:text-secondary" />
            <span className="text-xs font-medium">{t('alertsCenter.stats.portfolio')}</span>
          </div>
          <p className="text-2xl font-bold text-teal-600 dark:text-secondary tabular-nums dark:font-financial">{stats.portfolio}</p>
        </Card>
      </div>

      {/* Alerts Tabs */}
      <Tabs defaultValue="price" className="w-full">
        <TabsList className="flex w-full dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
          <TabsTrigger value="price" className="flex-1 gap-1 md:gap-2 dark:text-on-surface-variant dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary-container">
            <DollarSign className="w-4 h-4" />
            <span className="hidden sm:inline">{t('alertsCenter.tabs.price')}</span>
            <span className="sm:hidden">{t('alertsCenter.tabs.priceShort')}</span>
            <Badge variant="secondary" className="ml-1 tabular-nums dark:font-financial">{stats.price}</Badge>
          </TabsTrigger>
          <TabsTrigger value="portfolio" className="flex-1 gap-1 md:gap-2 dark:text-on-surface-variant dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary-container">
            <Target className="w-4 h-4" />
            <span className="hidden sm:inline">{t('alertsCenter.tabs.portfolio')}</span>
            <Badge variant="secondary" className="ml-1 tabular-nums dark:font-financial">{stats.portfolio}</Badge>
          </TabsTrigger>
          <TabsTrigger value="market" className="flex-1 gap-1 md:gap-2 dark:text-on-surface-variant dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary-container">
            <Bell className="w-4 h-4" />
            <span className="hidden sm:inline">{t('alertsCenter.tabs.market')}</span>
            <Badge variant="secondary" className="ml-1 tabular-nums dark:font-financial">{stats.market}</Badge>
          </TabsTrigger>
          <TabsTrigger value="obligations" className="flex-1 gap-1 md:gap-2 dark:text-on-surface-variant dark:data-[state=active]:bg-primary-container dark:data-[state=active]:text-on-primary-container">
            <Calendar className="w-4 h-4" />
            <span className="hidden sm:inline">{t('alertsCenter.tabs.obligations')}</span>
            <span className="sm:hidden">{t('alertsCenter.tabs.obligationsShort')}</span>
            <Badge variant="secondary" className="ml-1 tabular-nums dark:font-financial">{stats.obligations}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="price" className="space-y-4 mt-4">
          {/* Filter */}
          <div className="flex gap-2">
            <Button 
              size="sm" 
              variant={filter === 'all' ? 'default' : 'outline'}
              onClick={() => setFilter('all')}
              className="dark:data-[variant=default]:bg-primary-container dark:data-[variant=default]:text-on-primary-container dark:data-[variant=outline]:border-outline-variant dark:data-[variant=outline]:text-on-surface-variant"
            >
              {t('alertsCenter.buttons.all')}
            </Button>
            <Button 
              size="sm" 
              variant={filter === 'stocks' ? 'default' : 'outline'}
              onClick={() => setFilter('stocks')}
              className="dark:data-[variant=default]:bg-primary-container dark:data-[variant=default]:text-on-primary-container dark:data-[variant=outline]:border-outline-variant dark:data-[variant=outline]:text-on-surface-variant"
            >
              {t('alertsCenter.buttons.stocks')}
            </Button>
            <Button 
              size="sm" 
              variant={filter === 'crypto' ? 'default' : 'outline'}
              onClick={() => setFilter('crypto')}
              className="dark:data-[variant=default]:bg-primary-container dark:data-[variant=default]:text-on-primary-container dark:data-[variant=outline]:border-outline-variant dark:data-[variant=outline]:text-on-surface-variant"
            >
              {t('alertsCenter.buttons.crypto')}
            </Button>
          </div>

          {/* Alerts List */}
          {filteredPriceAlerts.length === 0 ? (
            <Card className="border-dashed dark:bg-surface-container-low dark:border-outline-variant/30">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Eye className="w-10 h-10 text-muted-foreground mb-3 dark:text-on-surface-variant" />
                <h3 className="text-lg font-semibold mb-1 dark:text-on-surface">{t('alertsCenter.empty.priceTitle')}</h3>
                <p className="text-sm text-muted-foreground dark:text-on-surface-variant">{t('alertsCenter.empty.priceBody')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredPriceAlerts.map((alert) => (
                <PriceAlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="portfolio" className="space-y-4 mt-4">
          {portfolioAlerts.length === 0 ? (
            <Card className="border-dashed dark:bg-surface-container-low dark:border-outline-variant/30">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Target className="w-10 h-10 text-muted-foreground mb-3 dark:text-on-surface-variant" />
                <h3 className="text-lg font-semibold mb-1 dark:text-on-surface">{t('alertsCenter.empty.portfolioTitle')}</h3>
                <p className="text-sm text-muted-foreground dark:text-on-surface-variant">{t('alertsCenter.empty.portfolioBody')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {portfolioAlerts.map((alert) => (
                <PortfolioAlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="market" className="space-y-4 mt-4">
          {marketAlerts.length === 0 ? (
            <Card className="border-dashed dark:bg-surface-container-low dark:border-outline-variant/30">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Bell className="w-10 h-10 text-muted-foreground mb-3 dark:text-on-surface-variant" />
                <h3 className="text-lg font-semibold mb-1 dark:text-on-surface">{t('alertsCenter.empty.marketTitle')}</h3>
                <p className="text-sm text-muted-foreground dark:text-on-surface-variant">{t('alertsCenter.empty.marketBody')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {marketAlerts.map((alert) => (
                <MarketAlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="obligations" className="space-y-4 mt-4">
          {obligationAlerts.length === 0 ? (
            <Card className="border-dashed dark:bg-surface-container-low dark:border-outline-variant/30">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3 dark:text-primary" />
                <h3 className="text-lg font-semibold mb-1 dark:text-on-surface">{t('alertsCenter.empty.obligationsTitle')}</h3>
                <p className="text-sm text-muted-foreground dark:text-on-surface-variant">{t('alertsCenter.empty.obligationsBody')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {obligationAlerts.map((alert) => (
                <ObligationAlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
