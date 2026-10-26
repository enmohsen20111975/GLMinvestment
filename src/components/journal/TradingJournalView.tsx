'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
 Plus, TrendingUp, TrendingDown, Minus, BarChart3, 
 Calendar, DollarSign, Target, Award, AlertCircle 
} from 'lucide-react';
import { toast } from 'sonner';

interface Trade {
 id: string;
 stock_symbol: string;
 stock_name: string | null;
 trade_type: string;
 quantity: number;
 entry_price: number;
 exit_price: number | null;
 entry_date: string;
 exit_date: string | null;
 profit_loss: number | null;
 profit_loss_pct: number | null;
 notes: string | null;
 strategy: string | null;
 result: string | null;
}

interface Stats {
 totalTrades: number;
 wins: number;
 losses: number;
 openTrades: number;
 winRate: number;
 totalProfit: number;
 avgWin: number;
 avgLoss: number;
 bestTrade: { symbol: string; pct: number } | null;
 worstTrade: { symbol: string; pct: number } | null;
 bestStocks: { symbol: string; trades: number; profit: number }[];
 worstStocks: { symbol: string; trades: number; profit: number }[];
}

const STRATEGIES = [
 'دعم SMA200',
 'اختراق مقاومة',
 'T+1',
 'ارتداد من قاع',
 'توسيط',
 'زخم شرائي',
 'تحليل أساسي',
 'أخرى'
];

export function TradingJournalView() {
 const [trades, setTrades] = useState<Trade[]>([]);
 const [stats, setStats] = useState<Stats | null>(null);
 const [loading, setLoading] = useState(true);
 const [dialogOpen, setDialogOpen] = useState(false);
 const [editingTrade, setEditingTrade] = useState<Trade | null>(null);

 // Form state
 const [formData, setFormData] = useState({
 stock_symbol: '',
 stock_name: '',
 trade_type: 'BUY',
 quantity: '',
 entry_price: '',
 exit_price: '',
 entry_date: new Date().toISOString().split('T')[0],
 exit_date: '',
 notes: '',
 strategy: ''
 });

 const fetchData = async () => {
 try {
 const [tradesRes, statsRes] = await Promise.all([
 fetch('/api/trading-journal'),
 fetch('/api/trading-journal/stats')
 ]);
 
 if (tradesRes.ok) {
 const data = await tradesRes.json();
 setTrades(data.trades || []);
 }
 
 if (statsRes.ok) {
 const data = await statsRes.json();
 setStats(data);
 }
 } catch (error) {
 console.error('Error fetching data:', error);
 toast.error('حدث خطأ في تحميل البيانات');
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchData();
 }, []);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 
 if (!formData.stock_symbol || !formData.quantity || !formData.entry_price) {
 toast.error('يرجى ملء الحقول المطلوبة');
 return;
 }

 try {
 const url = editingTrade 
 ? `/api/trading-journal/${editingTrade.id}`
 : '/api/trading-journal';
 
 const method = editingTrade ? 'PUT' : 'POST';
 
 const res = await fetch(url, {
 method,
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 ...formData,
 quantity: parseFloat(formData.quantity),
 entry_price: parseFloat(formData.entry_price),
 exit_price: formData.exit_price ? parseFloat(formData.exit_price) : null
 })
 });

 if (res.ok) {
 toast.success(editingTrade ? 'تم تحديث الصفقة' : 'تم إضافة الصفقة');
 setDialogOpen(false);
 resetForm();
 fetchData();
 } else {
 toast.error('حدث خطأ');
 }
 } catch (error) {
 console.error('Error saving trade:', error);
 toast.error('حدث خطأ في الحفظ');
 }
 };

 const resetForm = () => {
 setFormData({
 stock_symbol: '',
 stock_name: '',
 trade_type: 'BUY',
 quantity: '',
 entry_price: '',
 exit_price: '',
 entry_date: new Date().toISOString().split('T')[0],
 exit_date: '',
 notes: '',
 strategy: ''
 });
 setEditingTrade(null);
 };

 const getResultBadge = (result: string | null) => {
 switch (result) {
 case 'WIN':
 return <Badge className="bg-success/20 text-success">ربح</Badge>;
 case 'LOSS':
 return <Badge className="bg-loss/20 text-loss">خسارة</Badge>;
 default:
 return <Badge className="bg-warning/20 text-warning">مفتوحة</Badge>;
 }
 };

 if (loading) {
 return (
 <div className="flex items-center justify-center h-64">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
 </div>
 );
 }

 return (
 <div className="p-4 md:p-6 space-y-6" dir="rtl">
 {/* Header */}
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
 <div>
 <h1 className="text-2xl font-bold">يوميات التداول</h1>
 <p className="text-muted-foreground">سجل صفقاتك وتتبع أدائك</p>
 </div>
 
 <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
 <DialogTrigger asChild>
 <Button onClick={resetForm}>
 <Plus className="w-4 h-4 ml-2" />
 صفقة جديدة
 </Button>
 </DialogTrigger>
 <DialogContent className="max-w-md">
 <DialogHeader>
 <DialogTitle>{editingTrade ? 'تعديل الصفقة' : 'إضافة صفقة جديدة'}</DialogTitle>
 </DialogHeader>
 <form onSubmit={handleSubmit} className="space-y-4 mt-4">
 <div className="grid grid-cols-2 gap-4">
 <div>
 <Label>رمز السهم *</Label>
 <Input
 value={formData.stock_symbol}
 onChange={(e) => setFormData({...formData, stock_symbol: e.target.value.toUpperCase()})}
 placeholder="COMI"
 />
 </div>
 <div>
 <Label>اسم السهم</Label>
 <Input
 value={formData.stock_name}
 onChange={(e) => setFormData({...formData, stock_name: e.target.value})}
 placeholder="القاهرة للتجارة"
 />
 </div>
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <Label>نوع الصفقة</Label>
 <Select 
 value={formData.trade_type} 
 onValueChange={(v) => setFormData({...formData, trade_type: v})}
 >
 <SelectTrigger>
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="BUY">شراء</SelectItem>
 <SelectItem value="SELL">بيع</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div>
 <Label>الاستراتيجية</Label>
 <Select 
 value={formData.strategy} 
 onValueChange={(v) => setFormData({...formData, strategy: v})}
 >
 <SelectTrigger>
 <SelectValue placeholder="اختر..." />
 </SelectTrigger>
 <SelectContent>
 {STRATEGIES.map(s => (
 <SelectItem key={s} value={s}>{s}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>

 <div className="grid grid-cols-3 gap-4">
 <div>
 <Label>الكمية *</Label>
 <Input
 type="number"
 value={formData.quantity}
 onChange={(e) => setFormData({...formData, quantity: e.target.value})}
 placeholder="100"
 />
 </div>
 <div>
 <Label>سعر الدخول *</Label>
 <Input
 type="number"
 step="0.01"
 value={formData.entry_price}
 onChange={(e) => setFormData({...formData, entry_price: e.target.value})}
 placeholder="128.00"
 />
 </div>
 <div>
 <Label>سعر الخروج</Label>
 <Input
 type="number"
 step="0.01"
 value={formData.exit_price}
 onChange={(e) => setFormData({...formData, exit_price: e.target.value})}
 placeholder="132.00"
 />
 </div>
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <Label>تاريخ الدخول</Label>
 <Input
 type="date"
 value={formData.entry_date}
 onChange={(e) => setFormData({...formData, entry_date: e.target.value})}
 />
 </div>
 <div>
 <Label>تاريخ الخروج</Label>
 <Input
 type="date"
 value={formData.exit_date}
 onChange={(e) => setFormData({...formData, exit_date: e.target.value})}
 />
 </div>
 </div>

 <div>
 <Label>ملاحظات</Label>
 <Textarea
 value={formData.notes}
 onChange={(e) => setFormData({...formData, notes: e.target.value})}
 placeholder="سبب الدخول، الهدف، الوقف..."
 rows={2}
 />
 </div>

 <div className="flex gap-2 justify-end">
 <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
 إلغاء
 </Button>
 <Button type="submit">
 {editingTrade ? 'تحديث' : 'إضافة'}
 </Button>
 </div>
 </form>
 </DialogContent>
 </Dialog>
 </div>

 {/* Stats Cards */}
 {stats && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <Card>
 <CardContent className="pt-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground">إجمالي الصفقات</p>
 <p className="text-2xl font-bold">{stats.totalTrades}</p>
 </div>
 <BarChart3 className="w-8 h-8 text-muted-foreground" />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="pt-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground">نسبة النجاح</p>
 <p className="text-2xl font-bold text-success">
 {(stats.winRate ?? 0).toFixed(1)}%
 </p>
 </div>
 <Target className="w-8 h-8 text-success" />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="pt-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground">إجمالي الربح/الخسارة</p>
 <p className={`text-2xl font-bold ${stats.totalProfit >= 0 ? 'text-success' : 'text-loss'}`}>
 {stats.totalProfit >= 0 ? '+' : ''}{(stats.totalProfit ?? 0).toFixed(2)}%
 </p>
 </div>
 <DollarSign className={`w-8 h-8 ${stats.totalProfit >= 0 ? 'text-success' : 'text-loss'}`} />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="pt-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground">رابح / خاسر</p>
 <p className="text-2xl font-bold">
 <span className="text-success">{stats.wins}</span>
 <span className="text-muted-foreground"> / </span>
 <span className="text-loss">{stats.losses}</span>
 </p>
 </div>
 <Award className="w-8 h-8 text-muted-foreground" />
 </div>
 </CardContent>
 </Card>
 </div>
 )}

 {/* Tabs */}
 <Tabs defaultValue="trades" className="w-full">
 <TabsList className="grid w-full grid-cols-3">
 <TabsTrigger value="trades">الصفقات</TabsTrigger>
 <TabsTrigger value="stats">إحصائيات</TabsTrigger>
 <TabsTrigger value="analysis">تحليل</TabsTrigger>
 </TabsList>

 <TabsContent value="trades" className="mt-4">
 <Card>
 <CardContent className="p-0">
 <div className="overflow-x-auto max-h-96 overflow-y-auto">
 <table className="w-full">
 <thead className="bg-muted/50 sticky top-0">
 <tr>
 <th className="p-3 text-right">السهم</th>
 <th className="p-3 text-right">النوع</th>
 <th className="p-3 text-right">الكمية</th>
 <th className="p-3 text-right">الدخول</th>
 <th className="p-3 text-right">الخروج</th>
 <th className="p-3 text-right">النتيجة</th>
 <th className="p-3 text-right">%</th>
 </tr>
 </thead>
 <tbody>
 {trades.length === 0 ? (
 <tr>
 <td colSpan={7} className="p-8 text-center text-muted-foreground">
 <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
 <p>لا توجد صفقات بعد</p>
 <p className="text-sm">اضغط "صفقة جديدة" للبدء</p>
 </td>
 </tr>
 ) : (
 trades.map((trade) => (
 <tr key={trade.id} className="border-t hover:bg-muted/30">
 <td className="p-3">
 <div>
 <p className="font-medium">{trade.stock_symbol}</p>
 {trade.stock_name && (
 <p className="text-xs text-muted-foreground">{trade.stock_name}</p>
 )}
 </div>
 </td>
 <td className="p-3">
 <Badge variant="outline">
 {trade.trade_type === 'BUY' ? 'شراء' : 'بيع'}
 </Badge>
 </td>
 <td className="p-3">{trade.quantity}</td>
 <td className="p-3">{trade.entry_price ? trade.entry_price.toFixed(2) : "—"}</td>
 <td className="p-3">
 {trade.exit_price ? (trade.exit_price ?? 0).toFixed(2) : '-'}
 </td>
 <td className="p-3">{getResultBadge(trade.result)}</td>
 <td className="p-3">
 {trade.profit_loss_pct !== null ? (
 <span className={(trade.profit_loss_pct ?? 0) >= 0 ? 'text-success' : 'text-loss'}>
 {(trade.profit_loss_pct ?? 0) >= 0 ? '+' : ''}{(trade.profit_loss_pct ?? 0).toFixed(2)}%
 </span>
 ) : '-'}
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="stats" className="mt-4">
 {stats && (
 <div className="grid md:grid-cols-2 gap-4">
 <WidgetCard title="أفضل الأسهم" titleClassName="text-lg">

 {stats.bestStocks.length > 0 ? (
 <div className="space-y-2">
 {stats.bestStocks.slice(0, 5).map((s, i) => (
 <div key={i} className="flex justify-between items-center p-2 bg-success/10 rounded">
 <span className="font-medium">{s.symbol}</span>
 <div className="text-left">
 <span className="text-success">+{(s.profit ?? 0).toFixed(2)}%</span>
 <span className="text-xs text-muted-foreground mr-2">({s.trades} صفقة)</span>
 </div>
 </div>
 ))}
 </div>
 ) : (
 <p className="text-muted-foreground text-center py-4">لا توجد بيانات</p>
 )}
 </WidgetCard>

 <WidgetCard title="أسوأ الأسهم" titleClassName="text-lg">

 {stats.worstStocks.length > 0 ? (
 <div className="space-y-2">
 {stats.worstStocks.slice(0, 5).map((s, i) => (
 <div key={i} className="flex justify-between items-center p-2 bg-loss/10 rounded">
 <span className="font-medium">{s.symbol}</span>
 <div className="text-left">
 <span className="text-loss">{(s.profit ?? 0).toFixed(2)}%</span>
 <span className="text-xs text-muted-foreground mr-2">({s.trades} صفقة)</span>
 </div>
 </div>
 ))}
 </div>
 ) : (
 <p className="text-muted-foreground text-center py-4">لا توجد بيانات</p>
 )}
 </WidgetCard>

 <WidgetCard title="متوسط الربح/الخسارة" titleClassName="text-lg">

 <div className="grid grid-cols-2 gap-4">
 <div className="text-center p-4 bg-success/10 rounded">
 <p className="text-sm text-muted-foreground">متوسط الربح</p>
 <p className="text-2xl font-bold text-success">
 +{(stats.avgWin ?? 0).toFixed(2)}%
 </p>
 </div>
 <div className="text-center p-4 bg-loss/10 rounded">
 <p className="text-sm text-muted-foreground">متوسط الخسارة</p>
 <p className="text-2xl font-bold text-loss">
 {(stats.avgLoss ?? 0).toFixed(2)}%
 </p>
 </div>
 </div>
 </WidgetCard>

 <WidgetCard title="أفضل/أسوأ صفقة" titleClassName="text-lg">

 <div className="space-y-3">
 {stats.bestTrade && (
 <div className="flex justify-between items-center p-3 bg-success/10 rounded">
 <span>أفضل صفقة</span>
 <div>
 <span className="font-medium">{stats.bestTrade.symbol}</span>
 <span className="text-success mr-2">+{(stats.bestTrade.pct ?? 0).toFixed(2)}%</span>
 </div>
 </div>
 )}
 {stats.worstTrade && (
 <div className="flex justify-between items-center p-3 bg-loss/10 rounded">
 <span>أسوأ صفقة</span>
 <div>
 <span className="font-medium">{stats.worstTrade.symbol}</span>
 <span className="text-loss mr-2">{(stats.worstTrade.pct ?? 0).toFixed(2)}%</span>
 </div>
 </div>
 )}
 </div>
 </WidgetCard>
 </div>
 )}
 </TabsContent>

 <TabsContent value="analysis" className="mt-4">
 <WidgetCard title="تحليل الأداء" titleClassName="text-lg">

 <div className="text-center py-8 text-muted-foreground">
 <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
 <p>تحليل الأداء الشهري</p>
 <p className="text-sm">سيظهر هنا بعد تسجيل المزيد من الصفقات</p>
 </div>
 </WidgetCard>
 </TabsContent>
 </Tabs>
 </div>
 );
}
