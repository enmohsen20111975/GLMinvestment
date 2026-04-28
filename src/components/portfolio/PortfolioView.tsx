'use client';

import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  AlertTriangle,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Target,
  Download,
  Plus,
  Trash2,
  Pencil,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ShareButton } from '@/components/share/ShareButton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' ج.م';
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function PortfolioView() {
  const { portfolioImpact, isLoading, loadPortfolio } = useAppStore();
  const [exporting, setExporting] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<Record<string, unknown> | null>(null);
  // Add holding form
  const [addTicker, setAddTicker] = useState('');
  const [addQuantity, setAddQuantity] = useState('');
  const [addAvgPrice, setAddAvgPrice] = useState('');
  // Edit holding form
  const [editQuantity, setEditQuantity] = useState('');
  const [editAvgPrice, setEditAvgPrice] = useState('');

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const element = document.getElementById('portfolio-export');
      if (!element) {
        toast.error('لم يتم العثور على محتوى المحفظة');
        return;
      }
      await exportToPdf(element, {
        filename: `portfolio_report_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  if (isLoading || !portfolioImpact) {
    return (
      <div dir="rtl" className="min-h-screen bg-background">
        <Header title="المحفظة" subtitle="تتبع استثماراتك" />
        <div className="p-4 md:p-6 space-y-6">
          {/* Summary skeleton */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-4 w-24 mb-2" />
                  <Skeleton className="h-8 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
          {/* Recommendation skeleton */}
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-6 w-48 mb-4" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-2 w-full" />
            </CardContent>
          </Card>
          {/* Table skeleton */}
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-6 w-48 mb-4" />
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex gap-4 mb-3">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 flex-1" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const { summary, recommendation, risk_alerts, top_positive, top_negative, items } = portfolioImpact;

  const handleAddHolding = async () => {
    const qty = parseFloat(addQuantity);
    const avg = parseFloat(addAvgPrice);
    if (!addTicker.trim()) { toast.error('يرجى إدخال رمز السهم'); return; }
    if (isNaN(qty) || qty <= 0) { toast.error('الكمية يجب أن تكون أكبر من صفر'); return; }
    if (isNaN(avg) || avg < 0) { toast.error('متوسط سعر الشراء غير صالح'); return; }
    const { addToPortfolio } = useAppStore.getState();
    const result = await addToPortfolio(addTicker.trim().toUpperCase(), qty, avg);
    if (result.success) {
      toast.success('تمت إضافة السهم إلى المحفظة بنجاح');
      setShowAddDialog(false);
      setAddTicker(''); setAddQuantity(''); setAddAvgPrice('');
    } else {
      toast.error(result.error || 'فشل في إضافة السهم');
    }
  };

  const handleRemoveHolding = async (id: number) => {
    const { removeFromPortfolio } = useAppStore.getState();
    const result = await removeFromPortfolio(id);
    if (result.success) {
      toast.success('تم حذف السهم من المحفظة');
    } else {
      toast.error(result.error || 'فشل في حذف السهم');
    }
  };

  const handleEditHolding = (item: Record<string, unknown>) => {
    setEditingItem(item);
    setEditQuantity(String(item.quantity || ''));
    setEditAvgPrice(String(item.invested_value ? (Number(item.invested_value) / Number(item.quantity || 1)).toFixed(2) : ''));
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const qty = parseFloat(editQuantity);
    const avg = parseFloat(editAvgPrice);
    if (isNaN(qty) || qty <= 0) { toast.error('الكمية غير صالحة'); return; }
    if (isNaN(avg) || avg < 0) { toast.error('متوسط سعر الشراء غير صالح'); return; }
    const { updatePortfolioItem } = useAppStore.getState();
    const result = await updatePortfolioItem(Number(editingItem.asset_id), { quantity: qty, avg_buy_price: avg });
    if (result.success) {
      toast.success('تم تحديث السهم بنجاح');
      setShowEditDialog(false);
    } else {
      toast.error(result.error || 'فشل في تحديث السهم');
    }
  };

  // Empty state
  if (!isLoading && !portfolioImpact) {
    return (
      <div dir="rtl" className="min-h-screen bg-background">
        <Header title="المحفظة" subtitle="تتبع استثماراتك" />
        <div className="p-4 md:p-6">
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Wallet className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">المحفظة فارغة</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                أضف الأسهم إلى محفظتك لتتبع أدائها وأرباحك وخسائرك.
              </p>
              <Button className="mt-6 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowAddDialog(true)}>
                <Plus className="w-4 h-4 ml-2" />
                إضافة سهم
              </Button>
            </CardContent>
          </Card>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent dir="rtl" className="sm:max-w-md">
            <DialogHeader><DialogTitle>إضافة سهم إلى المحفظة</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>رمز السهم</Label><Input placeholder="مثال: CIBC" value={addTicker} onChange={(e) => setAddTicker(e.target.value)} className="mt-1" /></div>
              <div><Label>الكمية</Label><Input type="number" placeholder="0" min="1" value={addQuantity} onChange={(e) => setAddQuantity(e.target.value)} className="mt-1" /></div>
              <div><Label>متوسط سعر الشراء (ج.م)</Label><Input type="number" placeholder="0.00" min="0" step="0.01" value={addAvgPrice} onChange={(e) => setAddAvgPrice(e.target.value)} className="mt-1" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>إلغاء</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleAddHolding}>إضافة</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <Header title="المحفظة" subtitle="تتبع استثماراتك" />
      <div className="px-4 md:px-6 print:hidden">
        <div className="flex items-center gap-2">
          <ShareButton
            iconOnly={false}
            variant="outline"
            size="sm"
            stockData={{
              ticker: 'PORTFOLIO',
              name: 'Portfolio Summary',
              nameAr: 'ملخص المحفظة',
              price: summary.total_market_value,
              change: summary.total_gain_loss_percent,
              recommendation: recommendation.action_label_ar,
              recommendationAr: recommendation.action_label_ar,
              confidence: recommendation.confidence * 100,
              sector: `محفظة بـ${summary.assets_count} أصل`,
            }}
          />
          <Button onClick={handleExportPDF} disabled={exporting} variant="outline" size="sm" className="gap-2">
            <Download className="w-4 h-4" />
            {exporting ? 'جارٍ التصدير...' : 'تصدير PDF'}
          </Button>
        </div>
      </div>
      <div id="portfolio-export" className="p-4 md:p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Market Value */}
          <Card className="p-4 gap-2">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-xs font-medium">القيمة السوقية</span>
            </div>
            <p className="text-xl md:text-2xl font-bold text-foreground">
              {formatCurrency(summary.total_market_value)}
            </p>
          </Card>

          {/* Total Invested */}
          <Card className="p-4 gap-2">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Wallet className="w-4 h-4" />
              <span className="text-xs font-medium">إجمالي المستثمر</span>
            </div>
            <p className="text-xl md:text-2xl font-bold text-foreground">
              {formatCurrency(summary.total_invested)}
            </p>
          </Card>

          {/* Total Gain/Loss */}
          <Card className="p-4 gap-2">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              {summary.total_gain_loss >= 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span className="text-xs font-medium">إجمالي الربح/الخسارة</span>
            </div>
            <div className="flex items-center gap-2">
              <p className={cn(
                'text-xl md:text-2xl font-bold',
                summary.total_gain_loss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              )}>
                {formatCurrency(Math.abs(summary.total_gain_loss))}
              </p>
              <span className={cn(
                'text-xs font-semibold px-1.5 py-0.5 rounded',
                summary.total_gain_loss >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              )}>
                {formatPercent(summary.total_gain_loss_percent)}
              </span>
            </div>
          </Card>

          {/* Day Impact */}
          <Card className="p-4 gap-2">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <BarChart3 className="w-4 h-4" />
              <span className="text-xs font-medium">التأثير اليومي</span>
            </div>
            <div className="flex items-center gap-2">
              <p className={cn(
                'text-xl md:text-2xl font-bold',
                summary.day_impact_value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              )}>
                {summary.day_impact_value >= 0 ? '+' : ''}{formatCurrency(Math.abs(summary.day_impact_value))}
              </p>
              <span className={cn(
                'text-xs font-semibold px-1.5 py-0.5 rounded',
                summary.day_impact_value >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              )}>
                {formatPercent(summary.day_impact_percent)}
              </span>
            </div>
          </Card>
        </div>

        {/* Recommendation Card */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base">التحليل الذكي</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-base px-4 py-1.5">
                {recommendation.action_label_ar}
              </Badge>
              <span className="text-sm text-muted-foreground">
                الثقة: {(recommendation.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {recommendation.reason_ar}
            </p>
            <Progress
              value={recommendation.confidence * 100}
              className="h-3"
            />
          </CardContent>
        </Card>

        {/* Risk Alerts */}
        {risk_alerts.length > 0 && (
          <Card className="border-red-200 dark:border-red-900/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <CardTitle className="text-base text-red-600 dark:text-red-400">تنبيهات المخاطر</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {risk_alerts.map((item) => (
                  <div
                    key={item.asset_id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/20"
                  >
                    <Shield className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{item.name_ar}</span>
                        <Badge variant="outline" className="text-xs border-red-300 text-red-600 dark:border-red-700 dark:text-red-400">
                          {item.ticker}
                        </Badge>
                      </div>
                      {item.is_concentration_alert && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          تركز مرتفع: {item.weight_percent}% من المحفظة (الحد: {portfolioImpact.thresholds.concentration_alert_percent}%)
                        </p>
                      )}
                      {item.is_day_loss_alert && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          خسارة يومية تجاوزت {portfolioImpact.thresholds.day_loss_alert_percent}%
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top Performers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Top Positive */}
          {top_positive.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <CardTitle className="text-base">أفضل أداء اليوم</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {top_positive.map((item) => (
                    <div
                      key={item.asset_id}
                      className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm">{item.ticker}</span>
                        <span className="text-xs text-muted-foreground truncate">{item.name_ar}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                          {formatPercent(item.day_impact_percent)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(item.day_impact_value)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Negative */}
          {top_negative.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <ArrowDownRight className="w-5 h-5 text-red-600 dark:text-red-400" />
                  <CardTitle className="text-base">أسوأ أداء اليوم</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {top_negative.map((item) => (
                    <div
                      key={item.asset_id}
                      className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm">{item.ticker}</span>
                        <span className="text-xs text-muted-foreground truncate">{item.name_ar}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-medium text-red-600 dark:text-red-400">
                          {formatPercent(item.day_impact_percent)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(item.day_impact_value)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Holdings Table */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base">تفاصيل المحفظة</CardTitle>
              <div className="flex items-center gap-2 mr-auto">
                <Badge variant="secondary" className="text-xs">
                  {summary.assets_count} أصل
                </Badge>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1" onClick={() => setShowAddDialog(true)}>
                  <Plus className="w-3.5 h-3.5" />
                  إضافة
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto -mx-6 px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">الرمز</TableHead>
                    <TableHead className="text-xs">الاسم</TableHead>
                    <TableHead className="text-xs text-center">الكمية</TableHead>
                    <TableHead className="text-xs text-left">القيمة السوقية</TableHead>
                    <TableHead className="text-xs text-center">التأثير اليومي</TableHead>
                    <TableHead className="text-xs text-center">إجمالي الربح/الخسارة</TableHead>
                    <TableHead className="text-xs text-center">الوزن</TableHead>
                    <TableHead className="text-xs text-center">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.asset_id} className="hover:bg-muted/50">
                      <TableCell className="font-semibold text-sm">{item.ticker}</TableCell>
                      <TableCell className="text-sm">{item.name_ar}</TableCell>
                      <TableCell className="text-sm text-center">{item.quantity.toLocaleString('ar-EG')}</TableCell>
                      <TableCell className="text-sm text-left font-medium">
                        {formatCurrency(item.market_value)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={cn(
                          'text-sm font-medium',
                          item.day_impact_percent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                        )}>
                          {formatPercent(item.day_impact_percent)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={cn(
                            'text-sm font-medium',
                            item.total_gain_loss_value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                          )}>
                            {formatCurrency(Math.abs(item.total_gain_loss_value))}
                          </span>
                          <span className={cn(
                            'text-xs',
                            item.total_gain_loss_percent >= 0 ? 'text-emerald-500' : 'text-red-500'
                          )}>
                            {formatPercent(item.total_gain_loss_percent)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Progress value={item.weight_percent} className="h-2 w-12" />
                          <span className="text-xs text-muted-foreground">{item.weight_percent}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-blue-500" onClick={() => handleEditHolding(item)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500" onClick={() => handleRemoveHolding(item.asset_id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {/* Add Dialog */}
                <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                  <DialogContent dir="rtl" className="sm:max-w-md">
                    <DialogHeader><DialogTitle>إضافة سهم إلى المحفظة</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                      <div><Label>رمز السهم</Label><Input placeholder="مثال: CIBC" value={addTicker} onChange={(e) => setAddTicker(e.target.value)} className="mt-1" /></div>
                      <div><Label>الكمية</Label><Input type="number" placeholder="0" min="1" value={addQuantity} onChange={(e) => setAddQuantity(e.target.value)} className="mt-1" /></div>
                      <div><Label>متوسط سعر الشراء (ج.م)</Label><Input type="number" placeholder="0.00" min="0" step="0.01" value={addAvgPrice} onChange={(e) => setAddAvgPrice(e.target.value)} className="mt-1" /></div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowAddDialog(false)}>إلغاء</Button>
                      <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleAddHolding}>إضافة</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                {/* Edit Dialog */}
                <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                  <DialogContent dir="rtl" className="sm:max-w-md">
                    <DialogHeader><DialogTitle>تعديل الحيازة - {editingItem?.ticker}</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                      <div><Label>الكمية</Label><Input type="number" min="1" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} className="mt-1" /></div>
                      <div><Label>متوسط سعر الشراء (ج.م)</Label><Input type="number" min="0" step="0.01" value={editAvgPrice} onChange={(e) => setEditAvgPrice(e.target.value)} className="mt-1" /></div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowEditDialog(false)}>إلغاء</Button>
                      <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSaveEdit}>حفظ</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
