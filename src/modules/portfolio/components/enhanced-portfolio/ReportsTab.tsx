'use client';

/**
 * enhanced-portfolio/ReportsTab.tsx
 * ============================================================================
 * F-Phase3-Split-Portfolio: ReportsTab memoized component extracted from
 * EnhancedPortfolioView.tsx (lines ~2717-3108).
 *
 * UI-STABILITY fix (2026-09-28): wrapped in React.memo so background refreshes
 * elsewhere don't re-render the reports tab tree.
 *
 * Fetches /api/finance/reports once on mount and renders:
 *   - Portfolio overview card (assets / liabilities / net worth / monthly savings)
 *   - Investment returns card (bank / certificate / fund / total monthly)
 *   - Income vs Expenses card with savings rate
 *   - Alerts list (danger/warning/info)
 *   - Assets distribution card
 *   - Economic expert recommendations card (portfolio health score + 4-tile plan)
 *   - Empty state when no reports
 *
 * Currency-aware: the local formatCurrency closure shadows the module-level
 * EGP-only one (uses displayCurrency from the global store).
 * ============================================================================
 */

import { useState, useEffect, memo } from 'react';
import {
	AlertTriangle,
	Wallet,
	TrendingUp,
	Coins,
	Zap,
	XCircle,
	AlertCircle,
	CheckCircle2,
	Info,
	PiggyBank,
	FileText,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n-context';
import type { PortfolioSummary, FinancialAlert, AssetType } from '@/types';
import {
	formatCurrencyRaw,
	ASSET_TYPE_LABELS,
	ASSET_TYPE_COLORS,
} from './helpers';

export const ReportsTab = memo(function ReportsTab() {
	// P37-PHASE-2B-4A: currency-aware totals (EGP/USD/SAR toggle from header).
	const { displayCurrency, usdRate, sarRate } = useAppStore();
	const formatCurrency = (value: number | null | undefined) =>
		formatCurrencyRaw(value, displayCurrency, usdRate, sarRate);
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

	// Safe access guards
	const safeAlerts = alerts || [];
	const investmentReturns = reports?.investment_returns;

	const maxAssetTypeValue = Math.max(...(Object.values(assetsByType) as number[]), 1);

	return (
		<div className="space-y-6">
			{/* Portfolio Summary Card */}
			<WidgetCard
				title="نظرة عامة على الحالة المالية"
				icon={Wallet}
				iconColor="text-profit"
				iconSize="w-5 h-5"
				titleClassName="text-base"
				contentClassName="space-y-4"
			>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
						<div className="text-center p-3 rounded-lg bg-profit/20">
							<p className="text-xs text-muted-foreground mb-1">إجمالي الأصول</p>
							<p className="text-lg font-bold text-profit ">{formatCurrency(totalAssets)}</p>
							<p className="text-xs text-muted-foreground mt-1">أسهم + ذهب + بنك + شهادات + صناديق</p>
						</div>
						<div className="text-center p-3 rounded-lg bg-loss/20">
							<p className="text-xs text-muted-foreground mb-1">إجمالي الالتزامات</p>
							<p className="text-lg font-bold text-loss ">{formatCurrency(totalLiabilities)}</p>
							<p className="text-xs text-muted-foreground mt-1">قروض + أقساط + ديون</p>
						</div>
						<div className="text-center p-3 rounded-lg bg-primary/20">
							<p className="text-xs text-muted-foreground mb-1">صافي الثروة</p>
							<p className={cn('text-lg font-bold', netWorth >= 0 ? 'text-whale ' : 'text-loss ')}>
								{formatCurrency(netWorth)}
							</p>
							<p className="text-xs text-muted-foreground mt-1">الأصول - الالتزامات</p>
						</div>
						<div className="text-center p-3 rounded-lg bg-warning/20">
							<p className="text-xs text-muted-foreground mb-1">المدخرات الشهرية</p>
							<p className={cn('text-lg font-bold', (reports?.monthly_savings ?? 0) >= 0 ? 'text-warning ' : 'text-loss ')}>
								{formatCurrency(reports?.monthly_savings ?? 0)}
							</p>
							<p className="text-xs text-muted-foreground mt-1">الدخل - المصروفات</p>
						</div>
					</div>
			</WidgetCard>

			{/* Investment Returns - NEW */}
			{investmentReturns && investmentReturns.total_monthly > 0 && (
				<WidgetCard
					title="عوائد الاستثمارات الشهرية"
					icon={TrendingUp}
					iconColor="text-profit"
					iconSize="w-5 h-5"
					titleClassName="text-base"
					className="border-profit "
					contentClassName="space-y-4"
				>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
							{investmentReturns.bank_monthly > 0 && (
								<div className="p-3 rounded-lg bg-primary/20 text-center">
									<p className="text-xs text-muted-foreground mb-1">عائد البنك الشهري</p>
									<p className="text-base font-bold text-whale ">{formatCurrency(investmentReturns.bank_monthly)}</p>
								</div>
							)}
							{investmentReturns.certificate_monthly > 0 && (
								<div className="p-3 rounded-lg bg-primary/20 text-center">
									<p className="text-xs text-muted-foreground mb-1">عائد الشهادات الشهري</p>
									<p className="text-base font-bold text-primary ">{formatCurrency(investmentReturns.certificate_monthly)}</p>
								</div>
							)}
							{investmentReturns.fund_monthly > 0 && (
								<div className="p-3 rounded-lg bg-warning/20 text-center">
									<p className="text-xs text-muted-foreground mb-1">عائد الصناديق الشهري</p>
									<p className="text-base font-bold text-warning ">{formatCurrency(investmentReturns.fund_monthly)}</p>
								</div>
							)}
							<div className="p-3 rounded-lg bg-profit/20 text-center">
								<p className="text-xs text-muted-foreground mb-1">إجمالي العائد الشهري</p>
								<p className="text-base font-bold text-profit ">{formatCurrency(investmentReturns.total_monthly)}</p>
							</div>
						</div>
						<div className="flex items-center justify-between pt-2 border-t">
							<span className="text-sm text-muted-foreground">العائد السنوي المتوقع</span>
							<span className="font-bold text-profit ">{formatCurrency(investmentReturns.total_yearly)}</span>
						</div>
				</WidgetCard>
			)}

			{/* Income vs Expenses */}
			{reports && (
				<WidgetCard
					title="الدخل مقابل المصروفات (الشهر الحالي)"
					icon={TrendingUp}
					iconColor="text-profit"
					iconSize="w-5 h-5"
					titleClassName="text-base"
					contentClassName="space-y-3"
				>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<div className="flex justify-between text-sm mb-1">
									<span className="text-muted-foreground">إجمالي الدخل</span>
									<span className="font-medium text-profit ">{formatCurrency(reports.monthly_income)}</span>
								</div>
								<div className="h-3 rounded-full bg-muted overflow-hidden">
									<div className="h-full rounded-full bg-profit" style={{ width: '100%' }} />
								</div>
								{investmentReturns && investmentReturns.total_monthly > 0 && (
									<p className="text-xs text-muted-foreground mt-1">
										يشمل {formatCurrency(investmentReturns.total_monthly)} عوائد استثمارات
									</p>
								)}
							</div>
							<div>
								<div className="flex justify-between text-sm mb-1">
									<span className="text-muted-foreground">إجمالي المصروفات</span>
									<span className="font-medium text-loss ">{formatCurrency(reports.monthly_expenses)}</span>
								</div>
								<div className="h-3 rounded-full bg-muted overflow-hidden">
									<div className="h-full rounded-full bg-loss" style={{ width: `${reports.monthly_income > 0 ? Math.min((reports.monthly_expenses / reports.monthly_income) * 100, 100) : 0}%` }} />
								</div>
							</div>
						</div>
						<div className="flex items-center justify-between pt-2 border-t">
							<span className="text-sm text-muted-foreground">نسبة الادخار</span>
							<div className="flex items-center gap-2">
								<Progress value={Math.min(Math.max(reports.savings_rate ?? 0, 0), 100)} className="h-2 w-24" />
								<span className="font-bold text-sm">{(reports.savings_rate ?? 0).toFixed(1)}%</span>
							</div>
						</div>
						<div className="flex items-center justify-between pt-2 border-t">
							<span className="text-sm text-muted-foreground">صافي الادخار الشهري</span>
							<span className={cn('font-bold', (reports.monthly_savings ?? 0) >= 0 ? 'text-profit ' : 'text-loss ')}>
								{formatCurrency(reports.monthly_savings)}
							</span>
						</div>
				</WidgetCard>
			)}

			{/* Alerts */}
			{safeAlerts.length > 0 && (
				<WidgetCard
					title="تنبيهات وتحليلات مالية"
					icon={AlertTriangle}
					iconColor="text-warning"
					iconSize="w-5 h-5"
					titleClassName="text-base"
					contentClassName="space-y-3"
				>
						{safeAlerts.map((alert: FinancialAlert, idx: number) => (
							<div
								key={idx}
								className={cn(
									'flex items-start gap-3 p-3 rounded-lg border',
									alert.type === 'danger' && 'bg-loss border-loss/20 /50',
									alert.type === 'warning' && 'bg-warning border-yellow-200 /20 dark:border-yellow-900/50',
									alert.type === 'info' && 'bg-primary border-whale/20 /50'
								)}
							>
								{alert.type === 'danger' && <XCircle className="w-5 h-5 text-loss mt-0.5 flex-shrink-0" />}
								{alert.type === 'warning' && <AlertCircle className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />}
								{alert.type === 'info' && <CheckCircle2 className="w-5 h-5 text-whale mt-0.5 flex-shrink-0" />}
								<div className="flex-1 min-w-0">
									<p className="text-sm font-medium" dir="rtl">{alert.message}</p>
								</div>
							</div>
						))}
				</WidgetCard>
			)}

			{/* Assets Distribution */}
			{Object.keys(assetsByType).length > 0 && (
				<WidgetCard
					title="توزيع الأصول"
					icon={Coins}
					iconColor="text-profit"
					iconSize="w-5 h-5"
					titleClassName="text-base"
					contentClassName="space-y-3"
				>
						{(Object.entries(assetsByType) as [string, number][])
							.sort(([, a], [, b]) => b - a)
							.map(([type, value]) => {
								const pct = totalAssets > 0 ? (value / totalAssets) * 100 : 0;
								const label = ASSET_TYPE_LABELS[type as AssetType] || type;
								const colorClass = ASSET_TYPE_COLORS[type as AssetType] || 'bg-muted';
								const barColor = type === 'stock' ? 'bg-profit' : type === 'gold' ? 'bg-warning' : type === 'bank' ? 'bg-whale' : type === 'certificate' ? 'bg-primary' : type === 'fund' ? 'bg-warning' : 'bg-whale';
								return (
									<div key={type} className="space-y-1">
										<div className="flex justify-between text-xs">
											<div className="flex items-center gap-2">
												<Badge className={cn('text-xs px-1.5', colorClass)}>{label}</Badge>
											</div>
											<span className="font-medium">{formatCurrency(value)} ({(pct ?? 0).toFixed(1)}%)</span>
										</div>
										<div className="h-2.5 rounded-full bg-muted overflow-hidden">
											<div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${(value / maxAssetTypeValue) * 100}%` }} />
										</div>
									</div>
								);
							})}
				</WidgetCard>
			)}

			{/* Economic Expert Recommendations */}
			{reports && totalAssets > 0 && (
				<WidgetCard
					title="تحليلات خبير اقتصادي"
					icon={Zap}
					iconColor="text-warning"
					iconSize="w-5 h-5"
					titleClassName="text-base"
					className="border-warning "
					contentClassName="space-y-4"
				>
						{/* Portfolio Health Score */}
						<div className="p-3 rounded-lg from-profit to-primary /20 dark:">
							<div className="flex items-center justify-between mb-2">
								<span className="font-medium text-sm">تقييم صحة المحفظة</span>
								<span className="text-2xl font-bold text-profit ">
									{Math.min(100, Math.round(
										(netWorth > 0 ? 25 : 0) +
										((investmentReturns?.total_yearly || 0) > 0 ? 25 : 0) +
										(Object.keys(assetsByType).filter(t => (assetsByType as Record<string, number>)[t] > 0).length >= 3 ? 25 : 10) +
										((reports?.savings_rate || 0) >= 20 ? 25 : (reports?.savings_rate || 0) >= 10 ? 15 : 5)
									))}%
								</span>
							</div>
							<Progress value={Math.min(100, Math.round(
								(netWorth > 0 ? 25 : 0) +
								((investmentReturns?.total_yearly || 0) > 0 ? 25 : 0) +
								(Object.keys(assetsByType).filter(t => (assetsByType as Record<string, number>)[t] > 0).length >= 3 ? 25 : 10) +
								((reports?.savings_rate || 0) >= 20 ? 25 : (reports?.savings_rate || 0) >= 10 ? 15 : 5)
							))} className="h-2" />
						</div>

						{/* Recommendations Grid */}
						<div className="grid gap-3">
							{/* Diversification Check */}
							{(() => {
								const assetTypes = Object.keys(assetsByType).filter(t => (assetsByType as Record<string, number>)[t] > 0);
								const stockPercent = totalAssets > 0 ? (((assetsByType as Record<string, number>).stock || 0) / totalAssets) * 100 : 0;
								const bankPercent = totalAssets > 0 ? (((assetsByType as Record<string, number>).bank || 0) / totalAssets) * 100 : 0;
								const goldPercent = totalAssets > 0 ? (((assetsByType as Record<string, number>).gold || 0) / totalAssets) * 100 : 0;

								return (
									<>
										{/* Warning: High Stock Concentration */}
										{stockPercent > 50 && (
											<div className="flex items-start gap-3 p-3 rounded-lg bg-warning/20 border border-yellow-200 dark:border-yellow-800">
												<AlertCircle className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
												<div>
													<p className="text-sm font-medium text-warning ">تنويع المحفظة</p>
													<p className="text-xs text-muted-foreground mt-1">
														الأسهم تمثل {(stockPercent ?? 0).toFixed(1)}% من محفظتك. يُنصح بتقليل النسبة إلى 30-40% وتوزيع الباقي على شهادات وصناديق استثمار.
													</p>
												</div>
											</div>
										)}

										{/* Good: High Bank Returns */}
										{bankPercent > 60 && investmentReturns && investmentReturns.bank_monthly > 0 && (
											<div className="flex items-start gap-3 p-3 rounded-lg bg-primary/20 border border-whale ">
												<CheckCircle2 className="w-5 h-5 text-whale mt-0.5 flex-shrink-0" />
												<div>
													<p className="text-sm font-medium text-whale ">عوائد بنكية ممتازة</p>
													<p className="text-xs text-muted-foreground mt-1">
														لديك {formatCurrency(investmentReturns.bank_monthly)} دخل شهري من البنك. هذا يوفر استقرار مالي جيد.
													</p>
												</div>
											</div>
										)}

										{/* Suggestion: Add Gold */}
										{goldPercent < 5 && totalAssets > 100000 && (
											<div className="flex items-start gap-3 p-3 rounded-lg bg-warning/20 border border-warning ">
												<Info className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
												<div>
													<p className="text-sm font-medium text-warning ">إضافة الذهب</p>
													<p className="text-xs text-muted-foreground mt-1">
														يُنصح بتخصيص 5-10% من محفظتك للذهب كتحوط ضد التضخم.
													</p>
												</div>
											</div>
										)}

										{/* Suggestion: Emergency Fund */}
										{investmentReturns && investmentReturns.total_monthly > 0 && (
											<div className="flex items-start gap-3 p-3 rounded-lg bg-profit/20 border border-profit ">
												<PiggyBank className="w-5 h-5 text-profit mt-0.5 flex-shrink-0" />
												<div>
													<p className="text-sm font-medium text-profit ">صندوق الطوارئ</p>
													<p className="text-xs text-muted-foreground mt-1">
														ادخار 3-6 أشهر من المصروفات ({formatCurrency((reports?.monthly_expenses || 0) * 3)} - {formatCurrency((reports?.monthly_expenses || 0) * 6)}) في حساب منفصل للطوارئ.
													</p>
												</div>
											</div>
										)}
									</>
								);
							})()}
						</div>

						{/* Money Distribution Plan */}
						<div className="mt-4 p-4 rounded-lg from-profit via-primary to-purple-50 /20 dark:dark:to-purple-900/20 border">
							<h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
								<Coins className="w-4 h-4" />
								خطة توزيع الأموال المقترحة
							</h4>
							<div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
								<div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
									<p className="font-bold text-profit">50%</p>
									<p className="text-muted-foreground">احتياجات أساسية</p>
									<p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.5)}</p>
								</div>
								<div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
									<p className="font-bold text-whale">20%</p>
									<p className="text-muted-foreground">ادخار واستثمار</p>
									<p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.2)}</p>
								</div>
								<div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
									<p className="font-bold text-primary">20%</p>
									<p className="text-muted-foreground">تطوير وترفيه</p>
									<p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.2)}</p>
								</div>
								<div className="text-center p-2 rounded bg-white/50 dark:bg-black/20">
									<p className="font-bold text-warning">10%</p>
									<p className="text-muted-foreground">تبرعات وزكاة</p>
									<p className="font-medium">{formatCurrency((reports?.monthly_income || 0) * 0.1)}</p>
								</div>
							</div>
						</div>
				</WidgetCard>
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
});
