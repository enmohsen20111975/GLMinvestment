'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Wallet, TrendingUp, TrendingDown, DollarSign, Building2, Bitcoin, CreditCard, Landmark } from 'lucide-react';
import type { PortfolioAccount } from './MultiPortfolioSelector';
import { getPortfolioColorClass } from './MultiPortfolioSelector';
import { usePortfolioStore } from '@/lib/portfolio-store';

/* ============================================================
 MULTI-PORTFOLIO-032: Master Portfolio Summary Card
 ============================================================
 - Shows aggregated totals (total_value, cash, invested, net_pnl)
 - Lists each sub-portfolio with its individual performance
 - Helps the user see "where am I winning and where am I losing"
 ============================================================ */

interface AggregatedData {
 total_value: number;
 cash: number;
 invested_amount: number;
 net_pnl: number;
 net_pnl_pct: number;
 // B-2: P34 backend net-worth math — comes from /api/portfolio/master root.
 gross_assets_egp?: number;
 total_obligations_egp?: number;
 net_worth_egp?: number;
}

interface MasterPortfolioSummaryProps {
 userId: string;
 onSubPortfoliosLoaded?: (portfolios: PortfolioAccount[]) => void;
}

function formatCurrency(value: number, currency = 'EGP'): string {
 const symbol = currency === 'USDT' || currency === 'USD' ? '$' : 'ج.م';
 const formatted = value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
 return `${formatted} ${symbol}`;
}

function getPnlColor(pnl: number): string {
 if (pnl > 0) return 'text-profit';
 if (pnl < 0) return 'text-loss';
 return 'text-muted-foreground';
}

function getPnlIcon(pnl: number) {
 if (pnl > 0) return <TrendingUp className="h-3.5 w-3.5" />;
 if (pnl < 0) return <TrendingDown className="h-3.5 w-3.5" />;
 return null;
}

function getBrokerIcon(broker: string) {
 if (broker === 'Binance') return <Bitcoin className="h-4 w-4 text-warning" />;
 return <Building2 className="h-4 w-4 text-whale" />;
}

export function MasterPortfolioSummary({ userId, onSubPortfoliosLoaded }: MasterPortfolioSummaryProps) {
 const [loading, setLoading] = useState(true);
 const [aggregated, setAggregated] = useState<AggregatedData | null>(null);
 const [subPortfolios, setSubPortfolios] = useState<PortfolioAccount[]>([]);
 const [equityCurve, setEquityCurve] = useState<Array<{ date: string; total_value: number; pnl: number }>>([]);

 // P30 TASK 8: Subscribe to the unified store — if another screen (e.g.
 // EnhancedPortfolioView) already fetched master data, we show it instantly.
 const storeMaster = usePortfolioStore((s) => s.masterSummary);
 const storeSubPortfolios = usePortfolioStore((s) => s.subPortfolios);

 const fetchMaster = useCallback(async () => {
 setLoading(true);
 try {
 const res = await fetch(`/api/portfolio/master?user_id=${encodeURIComponent(userId)}&days=90`, { cache: 'no-store' });
 const data = await res.json();
 if (data.success) {
 // B-2: Merge P34 root-level net-worth fields into aggregated so the
 // summary cards read backend math instead of recomputing locally.
 setAggregated({
 ...(data.aggregated || {}),
 net_worth_egp: data.net_worth_egp,
 total_obligations_egp: data.total_obligations_egp,
 gross_assets_egp: data.gross_assets_egp,
 });
 setSubPortfolios(data.sub_portfolios || []);
 setEquityCurve(data.equity_curve || []);
 onSubPortfoliosLoaded?.(data.sub_portfolios || []);
 // P30 TASK 8: Push to unified store
 usePortfolioStore.getState().updateMaster(data);
 }
 } catch {
 // silent
 } finally {
 setLoading(false);
 }
 }, [userId, onSubPortfoliosLoaded]);

 useEffect(() => {
 fetchMaster();
 }, [fetchMaster]);

 if (loading) {
 return (
 <Card className="border-profit/20">
 <CardContent className="p-4 space-y-3">
 <Skeleton className="h-5 w-40" />
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
 {[...Array(4)].map((_, i) => (
 <Skeleton key={i} className="h-16" />
 ))}
 </div>
 </CardContent>
 </Card>
 );
 }

 if (!aggregated) {
 return (
 <Card className="bg-muted/30 border-border">
 <CardContent className="p-4 text-center text-sm text-muted-foreground">
 لا توجد بيانات محفظة. أنشئ محفظة فرعية للبدء.
 </CardContent>
 </Card>
 );
 }

 return (
 <div className="space-y-3">
 {/* Aggregated Summary Card */}
 <Card className="border-profit/20">
 <CardContent className="p-4 space-y-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <div className="w-8 h-8 rounded-full bg-profit/20 flex items-center justify-center">
 <Wallet className="h-4 w-4 text-profit" />
 </div>
 <div>
 <h3 className="text-sm font-bold text-foreground">المحفظة الأم (المجمّعة)</h3>
 <p className="text-xs text-muted-foreground">إجمالي كل المحافظ الفرعية</p>
 </div>
 </div>
 <Badge variant="outline" className="text-xs text-profit border-profit">
 {subPortfolios.length} محفظة فرعية
 </Badge>
 </div>

 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
 <div className="p-2.5 rounded-lg bg-background/50 border border-border/50">
 <div className="flex items-center gap-1 mb-0.5 text-muted-foreground">
 <Landmark className="h-3 w-3" />
 <p className="text-xs">إجمالي الأصول</p>
 </div>
 <p className="text-base font-bold text-foreground">{formatCurrency(aggregated.gross_assets_egp ?? aggregated.total_value)}</p>
 </div>
 <div className="p-2.5 rounded-lg bg-background/50 border border-border/50">
 <div className="flex items-center gap-1 mb-0.5 text-muted-foreground">
 <CreditCard className="h-3 w-3 text-warning" />
 <p className="text-xs">إجمالي الديون</p>
 </div>
 <p className="text-base font-bold text-warning">{formatCurrency(aggregated.total_obligations_egp ?? 0)}</p>
 </div>
 <div className="p-2.5 rounded-lg bg-profit/10 border border-profit/20 ring-1 ring-profit/20">
 <div className="flex items-center gap-1 mb-0.5 text-muted-foreground">
 <Wallet className="h-3 w-3 text-profit" />
 <p className="text-xs">صافي الثروة</p>
 </div>
 <p className="text-base font-bold text-profit">{formatCurrency(aggregated.net_worth_egp ?? aggregated.total_value)}</p>
 </div>
 <div className="p-2.5 rounded-lg bg-background/50 border border-border/50">
 <p className="text-xs text-muted-foreground mb-0.5">صافي الربح/الخسارة</p>
 <div className={`flex items-center gap-1 text-base font-bold ${getPnlColor(aggregated.net_pnl)}`}>
 {getPnlIcon(aggregated.net_pnl)}
 {formatCurrency(aggregated.net_pnl)}
 </div>
 <p className={`text-xs ${getPnlColor(aggregated.net_pnl_pct)}`}>
 {aggregated.net_pnl_pct > 0 ? '+' : ''}{aggregated.net_pnl_pct}%
 </p>
 </div>
 </div>

 {equityCurve.length > 0 && (
 <p className="text-xs text-muted-foreground text-center">
 📈 منحنى رأس المال: {equityCurve.length} نقطة على مدى 90 يوم
 </p>
 )}
 </CardContent>
 </Card>

 {/* Per-Broker Breakdown */}
 {subPortfolios.length > 0 && (
 <Card className="bg-card border-border">
 <CardContent className="p-4 space-y-2">
 <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
 <DollarSign className="h-4 w-4 text-profit" />
 أداء كل محفظة فرعية
 </h4>
 <div className="space-y-1.5">
 {subPortfolios.map((sp) => {
 const colorStyle = getPortfolioColorClass(sp.color);
 const pnlVal = sp.pnl || 0;
 const pnlPct = sp.pnl_pct || 0;
 return (
 <div
 key={sp.id}
 className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/40"
 >
 <div className="flex items-center gap-2 min-w-0">
 <div className={`flex items-center justify-center w-8 h-8 rounded-full ${colorStyle}`}>
 {getBrokerIcon(sp.broker || '')}
 </div>
 <div className="min-w-0">
 <div className="flex items-center gap-1.5">
 <p className="text-sm font-medium truncate">{sp.name}</p>
 <Badge variant="outline" className={`text-xs px-1.5 py-0 ${colorStyle}`}>
 {sp.color || 'blue'}
 </Badge>
 </div>
 <p className="text-xs text-muted-foreground">
 {sp.broker} • {sp.market} • {sp.positions_count || 0} أصل
 </p>
 </div>
 </div>
 <div className="flex items-center gap-3 text-right">
 <div>
 <p className="text-sm font-bold">{formatCurrency(sp.current_value || 0, sp.currency)}</p>
 <div className={`text-xs font-semibold flex items-center justify-end gap-1 ${getPnlColor(pnlVal)}`}>
 {getPnlIcon(pnlVal)}
 <span>{pnlVal > 0 ? '+' : ''}{formatCurrency(pnlVal, sp.currency)}</span>
 <span className="text-xs">({pnlPct > 0 ? '+' : ''}{pnlPct}%)</span>
 </div>
 </div>
 </div>
 </div>
 );
 })}
 </div>
 <p className="text-xs text-muted-foreground text-center pt-1">
 💡 نصيحة: ركّز على الوسيط الذي تحقق فيه أعلى ربح، وقلّل النشاط في الذي تخسر فيه.
 </p>
 </CardContent>
 </Card>
 )}
 </div>
 );
}
