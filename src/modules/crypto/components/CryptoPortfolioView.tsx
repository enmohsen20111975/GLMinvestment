'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
 RefreshCw,
 TrendingUp,
 TrendingDown,
 Bitcoin,
 Wallet,
 Plus,
 Trash2,
 AlertCircle,
 DollarSign,
 Percent,
 PieChart,
 BarChart3,
 Search,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
 Dialog,
 DialogContent,
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
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

interface CryptoPosition {
 id: string;
 symbol: string;
 name: string;
 quantity: number;
 avgBuyPrice: number;
}

interface LiveCoin {
 symbol: string;
 name: string;
 price_usd: number;
 change_24h: number;
 market_cap_rank: number;
}

interface PositionWithLive extends CryptoPosition {
 currentPrice: number;
 currentValue: number;
 costBasis: number;
 profitLoss: number;
 profitLossPercent: number;
 change24h: number;
}

interface PortfolioSummary {
 totalValue: number;
 totalCost: number;
 totalProfitLoss: number;
 totalProfitLossPercent: number;
 positions: PositionWithLive[];
}

/* ------------------------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------------------------ */

function formatPrice(price: number | null | undefined): string {
 if (price == null || Number.isNaN(price)) return '$0.00';
 if (price >= 1) return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
 if (price >= 0.01) return '$' + (price ?? 0).toFixed(4);
 return '$' + (price ?? 0).toFixed(8);
}

function formatNumber(num: number | null | undefined): string {
 if (num == null || Number.isNaN(num)) return '0';
 if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
 if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
 if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
 return (num ?? 0).toFixed(2);
}

/* ------------------------------------------------------------------ */
/* Skeleton Loading */
/* ------------------------------------------------------------------ */

function PortfolioSkeleton() {
 return (
 <div className="space-y-5 p-4 md:p-6" dir="rtl">
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 {Array.from({ length: 4 }).map((_, i) => (
 <Skeleton key={i} className="h-24 w-full rounded-xl" />
 ))}
 </div>
 <Skeleton className="h-64 w-full rounded-xl" />
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* CSS Pie Chart */
/* ------------------------------------------------------------------ */

const PIE_COLORS = [
 '#f97316', '#10b981', '#f43f5e', '#eab308',
 '#a855f7', '#06b6d4', '#ec4899', '#84cc16',
 '#f59e0b', '#14b8a6',
];

function AllocationPieChart({ positions }: { positions: PositionWithLive[] }) {
 const total = positions.reduce((sum, p) => sum + p.currentValue, 0);
 if (total <= 0 || positions.length === 0) return null;

 let cumulative = 0;
 const slices = positions.slice(0, 10).map((p, idx) => {
 const pct = (p.currentValue / total) * 100;
 const start = cumulative;
 cumulative += pct;
 return {
 symbol: p.symbol,
 pct,
 start,
 end: cumulative,
 color: PIE_COLORS[idx % PIE_COLORS.length],
 };
 });

 // Build conic-gradient string
 const gradientStops = slices
 .map(s => `${s.color} ${s.start}% ${s.end}%`)
 .join(', ');

 return (
 <div className="flex flex-col md:flex-row items-center gap-6 p-4">
 <div
 className="w-40 h-40 rounded-full flex-shrink-0 relative shadow-inner"
 style={{ background: `conic-gradient(${gradientStops})` }}
 aria-label="توزيع المحفظة"
 >
 <div className="absolute inset-6 rounded-full bg-background flex items-center justify-center">
 <div className="text-center">
 <p className="text-xs text-muted-foreground">إجمالي</p>
 <p className="text-xs font-bold" dir="ltr">{formatPrice(total)}</p>
 </div>
 </div>
 </div>

 <div className="flex-1 w-full space-y-1.5">
 {slices.map(s => (
 <div key={s.symbol} className="flex items-center gap-2 text-xs">
 <span
 className="w-3 h-3 rounded-sm flex-shrink-0"
 style={{ backgroundColor: s.color }}
 />
 <span className="font-semibold font-mono">{s.symbol}</span>
 <span className="text-muted-foreground mr-auto">{(s.pct ?? 0).toFixed(1)}%</span>
 <span className="text-muted-foreground" dir="ltr">{formatPrice(positions.find(p => p.symbol === s.symbol)?.currentValue)}</span>
 </div>
 ))}
 </div>
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Main Component */
/* ------------------------------------------------------------------ */

export function CryptoPortfolioView() {
 const [positions, setPositions] = useState<CryptoPosition[]>([]);
 const [allCoins, setAllCoins] = useState<LiveCoin[]>([]);
 const [livePriceMap, setLivePriceMap] = useState<Record<string, { price: number; change: number; name: string }>>({});
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [addDialogOpen, setAddDialogOpen] = useState(false);
 const [search, setSearch] = useState('');
 const [newCoin, setNewCoin] = useState({
 symbol: '',
 name: '',
 quantity: '',
 avgBuyPrice: '',
 });

 // Load positions from localStorage
 useEffect(() => {
 try {
 const saved = localStorage.getItem('crypto_portfolio');
 if (saved) {
 const parsed = JSON.parse(saved);
 if (Array.isArray(parsed)) setPositions(parsed);
 }
 } catch (e) {
 console.error('Error loading portfolio:', e);
 }
 setLoading(false);
 }, []);

 // Save positions to localStorage when they change
 useEffect(() => {
 try {
 localStorage.setItem('crypto_portfolio', JSON.stringify(positions));
 } catch (e) {
 console.error('Error saving portfolio:', e);
 }
 }, [positions]);

 // Fetch live prices from Python backend
 const fetchPrices = useCallback(async (showRefresh = false) => {
 if (showRefresh) setRefreshing(true);
 setError(null);

 try {
 const response = await fetch('/api/crypto/live', {
 signal: AbortSignal.timeout(15000),
 });
 const data = await response.json();

 if (data?.success && data?.data?.all_cryptos) {
 const all: LiveCoin[] = data.data.all_cryptos.map((c: any) => ({
 symbol: String(c.symbol || '').toUpperCase(),
 name: String(c.name || c.symbol || ''),
 price_usd: Number(c.price_usd ?? 0),
 change_24h: Number(c.change_24h ?? 0),
 market_cap_rank: Number(c.market_cap_rank ?? 999),
 }));
 setAllCoins(all);

 const priceMap: Record<string, { price: number; change: number; name: string }> = {};
 for (const c of all) {
 priceMap[c.symbol] = {
 price: c.price_usd,
 change: c.change_24h,
 name: c.name,
 };
 }
 setLivePriceMap(priceMap);
 } else {
 setError(data?.error || 'فشل تحميل الأسعار الحية');
 }
 } catch (e) {
 console.error('Error fetching prices:', e);
 setError('خطأ في الاتصال بالخادم');
 } finally {
 setRefreshing(false);
 }
 }, []);

 // Initial fetch + 60s auto-refresh
 useEffect(() => {
 fetchPrices();
 const interval = setInterval(() => fetchPrices(), 60000);
 return () => clearInterval(interval);
 }, [fetchPrices]);

 // Merge positions with live prices
 const livePositions: PositionWithLive[] = positions.map(pos => {
 const live = livePriceMap[pos.symbol];
 const currentPrice = live?.price ?? pos.avgBuyPrice;
 const costBasis = pos.quantity * pos.avgBuyPrice;
 const currentValue = pos.quantity * currentPrice;
 const profitLoss = currentValue - costBasis;
 const profitLossPercent = costBasis > 0 ? (profitLoss / costBasis) * 100 : 0;
 return {
 ...pos,
 currentPrice,
 currentValue,
 costBasis,
 profitLoss,
 profitLossPercent,
 change24h: live?.change ?? 0,
 };
 });

 // Calculate summary
 const summary: PortfolioSummary = {
 totalValue: livePositions.reduce((sum, p) => sum + p.currentValue, 0),
 totalCost: livePositions.reduce((sum, p) => sum + p.costBasis, 0),
 totalProfitLoss: 0,
 totalProfitLossPercent: 0,
 positions: livePositions,
 };
 summary.totalProfitLoss = summary.totalValue - summary.totalCost;
 summary.totalProfitLossPercent = summary.totalCost > 0
 ? (summary.totalProfitLoss / summary.totalCost) * 100
 : 0;

 // Add position
 const handleAddPosition = () => {
 if (!newCoin.symbol || !newCoin.quantity || !newCoin.avgBuyPrice) return;

 const position: CryptoPosition = {
 id: Date.now().toString(),
 symbol: newCoin.symbol.toUpperCase(),
 name: newCoin.name || newCoin.symbol.toUpperCase(),
 quantity: parseFloat(newCoin.quantity),
 avgBuyPrice: parseFloat(newCoin.avgBuyPrice),
 };

 setPositions(prev => [...prev, position]);
 setNewCoin({ symbol: '', name: '', quantity: '', avgBuyPrice: '' });
 setSearch('');
 setAddDialogOpen(false);
 };

 // Remove position
 const handleRemovePosition = (id: string) => {
 setPositions(prev => prev.filter(p => p.id !== id));
 };

 // When user selects a symbol from the dropdown, auto-fill name
 const handleSymbolSelect = (symbol: string) => {
 const coin = allCoins.find(c => c.symbol === symbol);
 setNewCoin(prev => ({
 ...prev,
 symbol,
 name: coin?.name || prev.name,
 }));
 };

 if (loading) {
 return <PortfolioSkeleton />;
 }

 // Coins available for selection (filtered by search)
 const availableCoins = allCoins
 .filter(c =>
 search.trim() === '' ||
 c.symbol.toLowerCase().includes(search.toLowerCase()) ||
 c.name.toLowerCase().includes(search.toLowerCase())
 )
 .sort((a, b) => a.market_cap_rank - b.market_cap_rank);

 return (
 <div className="min-h-screen flex flex-col bg-background" dir="rtl">
 {/* Header */}
 <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
 <div className="max-w-7xl mx-auto px-4 py-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-xl from-orange-500 to-yellow-500 flex items-center justify-center">
 <Wallet className="w-6 h-6 text-foreground" />
 </div>
 <div>
 <h1 className="text-xl font-bold text-foreground">محفظة العملات الرقمية</h1>
 <p className="text-xs text-muted-foreground">Crypto Portfolio · أسعار حية</p>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
 <Plus className="w-4 h-4" />
 إضافة عملة
 </Button>
 <Button
 variant="outline"
 size="icon"
 onClick={() => fetchPrices(true)}
 disabled={refreshing}
 >
 <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
 </Button>
 </div>
 </div>
 </div>
 </div>

 {/* Content */}
 <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-5">
 {error && (
 <div className="p-4 rounded-lg bg-loss/20 border border-loss flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-loss mt-0.5 flex-shrink-0" />
 <div>
 <p className="text-sm font-medium text-loss ">خطأ في تحميل الأسعار</p>
 <p className="text-xs text-loss mt-1">{error}</p>
 <p className="text-xs text-loss mt-1">
 يتم استخدام آخر سعر محفوظ مؤقتاً. اضغط زر التحديث لإعادة المحاولة.
 </p>
 </div>
 </div>
 )}

 {/* Summary Cards */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <Card className="border-border/60">
 <CardContent className="p-4 flex flex-col items-center gap-1">
 <DollarSign className="w-5 h-5 text-profit" />
 <span className="text-lg font-bold" dir="ltr">{formatPrice(summary.totalValue)}</span>
 <span className="text-xs text-muted-foreground">إجمالي القيمة</span>
 </CardContent>
 </Card>
 <Card className="border-border/60">
 <CardContent className="p-4 flex flex-col items-center gap-1">
 <BarChart3 className="w-5 h-5 text-warning" />
 <span className="text-lg font-bold" dir="ltr">{formatPrice(summary.totalCost)}</span>
 <span className="text-xs text-muted-foreground">إجمالي التكلفة</span>
 </CardContent>
 </Card>
 <Card className="border-border/60">
 <CardContent className="p-4 flex flex-col items-center gap-1">
 {summary.totalProfitLoss >= 0 ? (
 <TrendingUp className="w-5 h-5 text-profit" />
 ) : (
 <TrendingDown className="w-5 h-5 text-loss" />
 )}
 <span className={cn(
 'text-lg font-bold',
 summary.totalProfitLoss >= 0 ? 'text-profit' : 'text-loss'
 )} dir="ltr">
 {summary.totalProfitLoss >= 0 ? '+' : '-'}{formatPrice(Math.abs(summary.totalProfitLoss))}
 </span>
 <span className="text-xs text-muted-foreground">الربح/الخسارة</span>
 </CardContent>
 </Card>
 <Card className="border-border/60">
 <CardContent className="p-4 flex flex-col items-center gap-1">
 <Percent className="w-5 h-5 text-warning" />
 <span className={cn(
 'text-lg font-bold',
 summary.totalProfitLossPercent >= 0 ? 'text-profit' : 'text-loss'
 )}>
 {summary.totalProfitLossPercent >= 0 ? '+' : ''}{(summary.totalProfitLossPercent ?? 0).toFixed(2)}%
 </span>
 <span className="text-xs text-muted-foreground">نسبة التغير</span>
 </CardContent>
 </Card>
 </div>

 {/* Allocation Pie Chart */}
 {livePositions.length > 0 && (
 <Card>
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <PieChart className="w-5 h-5" />
 توزيع المحفظة
 </CardTitle>
 </CardHeader>
 <CardContent>
 <AllocationPieChart positions={livePositions} />
 </CardContent>
 </Card>
 )}

 {/* Positions List */}
 <Card>
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <Bitcoin className="w-5 h-5 text-warning" />
 العملات في المحفظة ({positions.length})
 </CardTitle>
 </CardHeader>
 <CardContent>
 {positions.length === 0 ? (
 <div className="text-center py-12 text-muted-foreground">
 <Bitcoin className="w-12 h-12 mx-auto mb-4 opacity-50" />
 <p>لا توجد عملات في المحفظة</p>
 <p className="text-sm mt-1">اضغط "إضافة عملة" للبدء</p>
 <Button
 variant="outline"
 size="sm"
 className="mt-4"
 onClick={() => setAddDialogOpen(true)}
 >
 <Plus className="w-4 h-4 ml-1" />
 إضافة أول مركز
 </Button>
 </div>
 ) : (
 <div className="space-y-3">
 {livePositions.map((position) => {
 const isProfit = position.profitLoss >= 0;
 return (
 <div
 key={position.id}
 className="flex items-center justify-between p-4 rounded-lg border border-border/60 hover:bg-muted/30 transition-colors"
 >
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
 <Bitcoin className="w-5 h-5 text-warning" />
 </div>
 <div>
 <p className="font-bold">{position.symbol}</p>
 <p className="text-xs text-muted-foreground">
 {position.quantity} عملة @ {formatPrice(position.avgBuyPrice)}
 </p>
 </div>
 </div>

 <div className="text-left">
 <p className="font-semibold" dir="ltr">{formatPrice(position.currentValue)}</p>
 <p className={cn(
 'text-xs flex items-center gap-1 justify-end',
 isProfit ? 'text-profit' : 'text-loss'
 )} dir="ltr">
 {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
 {isProfit ? '+' : '-'}{formatPrice(Math.abs(position.profitLoss))} ({isProfit ? '+' : ''}{(position.profitLossPercent ?? 0).toFixed(2)}%)
 </p>
 <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">
 سعر: {formatPrice(position.currentPrice)} ({position.change24h >= 0 ? '+' : ''}{(position.change24h ?? 0).toFixed(2)}%)
 </p>
 </div>

 <Button
 variant="ghost"
 size="icon"
 onClick={() => handleRemovePosition(position.id)}
 className="text-loss hover:text-loss hover:bg-loss"
 title="حذف المركز"
 >
 <Trash2 className="w-4 h-4" />
 </Button>
 </div>
 );
 })}
 </div>
 )}
 </CardContent>
 </Card>

 {/* Disclaimer */}
 <div className="p-4 rounded-lg bg-warning/20 border border-warning ">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-warning mt-0.5" />
 <div>
 <p className="text-sm font-medium text-warning ">
 تنبيه هام
 </p>
 <p className="text-xs text-warning mt-1">
 هذه المحفظة للأغراض التعليمية فقط ولا تمثل نصيحة استثمارية. استشر مستشار مالي قبل اتخاذ أي قرارات استثمارية.
 </p>
 </div>
 </div>
 </div>
 </main>

 {/* Add Position Dialog */}
 <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
 <DialogContent dir="rtl" className="max-w-md">
 <DialogHeader>
 <DialogTitle>إضافة عملة للمحفظة</DialogTitle>
 </DialogHeader>
 <div className="space-y-4">
 <div className="space-y-2">
 <label className="text-sm font-medium">ابحث عن عملة</label>
 <div className="relative">
 <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
 <Input
 placeholder="مثال: BTC, ETH, Bitcoin..."
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 className="pr-9"
 />
 </div>
 </div>

 <div className="space-y-2">
 <label className="text-sm font-medium">اختر العملة ({availableCoins.length} متاحة)</label>
 <Select
 value={newCoin.symbol}
 onValueChange={handleSymbolSelect}
 >
 <SelectTrigger>
 <SelectValue placeholder="اختر من قائمة العملات" />
 </SelectTrigger>
 <SelectContent className="max-h-72">
 {availableCoins.slice(0, 111).map((coin) => (
 <SelectItem key={coin.symbol} value={coin.symbol}>
 <span className="font-mono font-semibold">{coin.symbol}</span>
 <span className="text-muted-foreground mx-2">·</span>
 <span className="text-xs">{coin.name}</span>
 <span className="ml-auto text-xs text-muted-foreground" dir="ltr">
 {formatPrice(coin.price_usd)}
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-2">
 <label className="text-sm font-medium">الكمية</label>
 <Input
 type="number"
 placeholder="0.00"
 value={newCoin.quantity}
 onChange={(e) => setNewCoin(prev => ({ ...prev, quantity: e.target.value }))}
 />
 </div>
 <div className="space-y-2">
 <label className="text-sm font-medium">سعر الشراء ($)</label>
 <Input
 type="number"
 placeholder="0.00"
 value={newCoin.avgBuyPrice}
 onChange={(e) => setNewCoin(prev => ({ ...prev, avgBuyPrice: e.target.value }))}
 />
 </div>
 </div>

 {newCoin.symbol && livePriceMap[newCoin.symbol] && (
 <div className="text-xs text-muted-foreground p-2 rounded-md bg-muted/30">
 السعر الحالي لـ {newCoin.symbol}: <span className="font-semibold" dir="ltr">{formatPrice(livePriceMap[newCoin.symbol].price)}</span>
 <span className={cn('mr-2', livePriceMap[newCoin.symbol].change >= 0 ? 'text-profit' : 'text-loss')} dir="ltr">
 ({livePriceMap[newCoin.symbol].change >= 0 ? '+' : ''}{(livePriceMap[newCoin.symbol].change ?? 0).toFixed(2)}%)
 </span>
 </div>
 )}

 {allCoins.length === 0 && (
 <p className="text-xs text-warning flex items-center gap-1">
 <AlertCircle className="w-3 h-3" />
 جارٍ تحميل قائمة العملات من الخادم...
 </p>
 )}

 <Button
 onClick={handleAddPosition}
 disabled={!newCoin.symbol || !newCoin.quantity || !newCoin.avgBuyPrice}
 className="w-full"
 >
 <Plus className="w-4 h-4 ml-1" />
 إضافة للمحفظة
 </Button>
 </div>
 </DialogContent>
 </Dialog>
 </div>
 );
}
