'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Plus,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Target,
  Shield,
  Lightbulb,
  DollarSign,
  Package,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Position {
  id: string;
  stock_symbol: string;
  stock_name?: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  status: string;
  status_ar: string;
  support: number | null;
  resistance: number | null;
  fair_value: number | null;
  upside_to_fair_value: number | null;
  rsi: number | null;
  trailing_stop: number;
  recommendation: string;
  recommendation_ar: string;
  confidence: number;
  reasoning: string;
  actions: string[];
  entry_date: string;
  avg_down_count: number;
}

interface PortfolioSummary {
  total_positions: number;
  total_cost_basis: number;
  total_market_value: number;
  total_unrealized_pnl: number;
  total_unrealized_pnl_percent: number;
  winning_count: number;
  losing_count: number;
}

interface PortfolioData {
  success: boolean;
  positions: Position[];
  summary: PortfolioSummary;
  by_recommendation?: {
    HOLD: number;
    ADD: number;
    REDUCE: number;
    SELL: number;
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function StatusBadge({ status, statusAr }: { status: string; statusAr: string }) {
  const colors: Record<string, string> = {
    heavy_loss: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    moderate_loss: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
    slight_loss: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
    slight_gain: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
    moderate_gain: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    heavy_gain: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400',
  };

  return (
    <Badge className={`${colors[status] || 'bg-gray-100'} border-0`}>
      {statusAr}
    </Badge>
  );
}

function RecommendationBadge({ recommendation, recommendationAr }: { recommendation: string; recommendationAr: string }) {
  const colors: Record<string, string> = {
    HOLD: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    ADD: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
    REDUCE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    SELL: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  };

  const icons: Record<string, React.ReactNode> = {
    HOLD: <Minus className="w-3 h-3" />,
    ADD: <Plus className="w-3 h-3" />,
    REDUCE: <ChevronDown className="w-3 h-3" />,
    SELL: <XCircle className="w-3 h-3" />,
  };

  return (
    <Badge className={`${colors[recommendation] || ''} gap-1 border-0`}>
      {icons[recommendation]}
      {recommendationAr}
    </Badge>
  );
}

function PositionCard({ position, onRefresh }: { position: Position; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const isProfit = position.unrealized_pnl >= 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-lg">{position.stock_symbol}</h3>
              <StatusBadge status={position.status} statusAr={position.status_ar} />
            </div>
            <p className="text-sm text-muted-foreground">{position.stock_name || position.stock_symbol}</p>
          </div>
          <RecommendationBadge
            recommendation={position.recommendation}
            recommendationAr={position.recommendation_ar}
          />
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-2 text-sm mb-3">
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-muted-foreground text-xs">الكمية</p>
            <p className="font-bold">{position.shares.toLocaleString()}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-muted-foreground text-xs">متوسط التكلفة</p>
            <p className="font-bold" dir="ltr">{position.avg_cost.toFixed(2)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-muted-foreground text-xs">السعر الحالي</p>
            <p className="font-bold" dir="ltr">{position.current_price.toFixed(2)}</p>
          </div>
        </div>

        {/* P&L */}
        <div className={`p-3 rounded-lg ${isProfit ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'bg-red-50 dark:bg-red-950/20'}`}>
          <div className="flex justify-between items-center">
            <span className="text-sm">الربح/الخسارة</span>
            <div className="text-left" dir="ltr">
              <p className={`font-bold ${isProfit ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(position.unrealized_pnl)}
              </p>
              <p className={`text-sm ${isProfit ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatPercent(position.unrealized_pnl_percent)}
              </p>
            </div>
          </div>
        </div>

        {/* Expand button */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 gap-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {expanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
        </Button>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-3 pt-3 border-t space-y-3">
            {/* Support/Resistance */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              {position.support && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الدعم:</span>
                  <span className="font-medium text-green-600" dir="ltr">{position.support.toFixed(2)}</span>
                </div>
              )}
              {position.resistance && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">المقاومة:</span>
                  <span className="font-medium text-red-600" dir="ltr">{position.resistance.toFixed(2)}</span>
                </div>
              )}
              {position.trailing_stop && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">وقف الخسارة:</span>
                  <span className="font-medium" dir="ltr">{position.trailing_stop.toFixed(2)}</span>
                </div>
              )}
              {position.upside_to_fair_value && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">فرصة الصعود:</span>
                  <span className="font-medium text-emerald-600">{formatPercent(position.upside_to_fair_value)}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            {position.actions && position.actions.length > 0 && (
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                  <Lightbulb className="w-3 h-3" />
                  الإجراءات المقترحة
                </p>
                <ul className="text-sm space-y-1">
                  {position.actions.map((action, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-emerald-500">•</span>
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Confidence */}
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">مستوى الثقة:</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${position.confidence}%` }}
                  />
                </div>
                <span className="font-medium">{position.confidence}%</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddPositionDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    stock_symbol: '',
    shares: '',
    avg_cost: '',
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_symbol: form.stock_symbol.toUpperCase(),
          shares: parseFloat(form.shares),
          avg_cost: parseFloat(form.avg_cost),
          notes: form.notes || undefined,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(data.is_new ? 'تم إضافة السهم للمحفظة' : 'تم تحديث السهم في المحفظة');
        setForm({ stock_symbol: '', shares: '', avg_cost: '', notes: '' });
        setOpen(false);
        onAdded();
      } else {
        throw new Error(data.error || 'حدث خطأ');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الإضافة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-4 h-4" />
          إضافة سهم
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة سهم للمحفظة</DialogTitle>
          <DialogDescription>
            أدخل بيانات الصفقة لإضافتها لمحفظتك
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="symbol">رمز السهم</Label>
            <Input
              id="symbol"
              value={form.stock_symbol}
              onChange={(e) => setForm({ ...form, stock_symbol: e.target.value.toUpperCase() })}
              placeholder="مثال: HRHO"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="shares">عدد الأسهم</Label>
              <Input
                id="shares"
                type="number"
                step="1"
                value={form.shares}
                onChange={(e) => setForm({ ...form, shares: e.target.value })}
                placeholder="100"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avg_cost">متوسط التكلفة</Label>
              <Input
                id="avg_cost"
                type="number"
                step="0.01"
                value={form.avg_cost}
                onChange={(e) => setForm({ ...form, avg_cost: e.target.value })}
                placeholder="25.50"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات (اختياري)</Label>
            <Input
              id="notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="ملاحظات..."
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                جارٍ الإضافة...
              </>
            ) : (
              'إضافة للمحفظة'
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PortfolioPage() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPortfolio = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/portfolio/analyze');
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        throw new Error(json.error || 'حدث خطأ');
      }
    } catch (err) {
      toast.error('حدث خطأ أثناء جلب المحفظة');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  if (loading) {
    return (
      <div className="container max-w-4xl mx-auto p-4 space-y-4" dir="rtl">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container max-w-4xl mx-auto p-4" dir="rtl">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">لا توجد بيانات</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { positions, summary, by_recommendation } = data;

  return (
    <div className="container max-w-4xl mx-auto p-4 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6 text-emerald-600" />
            محفظتي
          </h1>
          <p className="text-muted-foreground">
            إدارة وتحليل الأسهم في محفظتك
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchPortfolio} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>
          <AddPositionDialog onAdded={fetchPortfolio} />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">عدد الأسهم</p>
            <p className="text-xl font-bold">{summary.total_positions}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">القيمة السوقية</p>
            <p className="text-xl font-bold" dir="ltr">{formatCurrency(summary.total_market_value)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">التكلفة</p>
            <p className="text-xl font-bold" dir="ltr">{formatCurrency(summary.total_cost_basis)}</p>
          </CardContent>
        </Card>
        <Card className={summary.total_unrealized_pnl >= 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">الربح/الخسارة</p>
            <p className={`text-xl font-bold ${summary.total_unrealized_pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`} dir="ltr">
              {formatCurrency(summary.total_unrealized_pnl)}
            </p>
            <p className={`text-sm ${summary.total_unrealized_pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatPercent(summary.total_unrealized_pnl_percent)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recommendation Summary */}
      {by_recommendation && (
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
            <p className="text-xs text-muted-foreground">امسك</p>
            <p className="font-bold text-blue-600">{by_recommendation.HOLD}</p>
          </div>
          <div className="text-center p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
            <p className="text-xs text-muted-foreground">أضف/متوسط</p>
            <p className="font-bold text-emerald-600">{by_recommendation.ADD}</p>
          </div>
          <div className="text-center p-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
            <p className="text-xs text-muted-foreground">بيع جزئي</p>
            <p className="font-bold text-amber-600">{by_recommendation.REDUCE}</p>
          </div>
          <div className="text-center p-2 bg-red-50 dark:bg-red-950/20 rounded-lg">
            <p className="text-xs text-muted-foreground">بيع</p>
            <p className="font-bold text-red-600">{by_recommendation.SELL}</p>
          </div>
        </div>
      )}

      {/* Positions */}
      {positions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Package className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground mb-4">لا توجد أسهم في محفظتك</p>
            <AddPositionDialog onAdded={fetchPortfolio} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {positions.map((position) => (
            <PositionCard
              key={position.id}
              position={position}
              onRefresh={fetchPortfolio}
            />
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-xs text-muted-foreground text-center p-4 border-t">
        <p>⚠️ هذه التحليلات للأغراض التعليمية فقط وليست توصية استثمارية</p>
      </div>
    </div>
  );
}
