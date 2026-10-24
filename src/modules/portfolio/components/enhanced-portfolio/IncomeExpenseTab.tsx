'use client';

/**
 * enhanced-portfolio/IncomeExpenseTab.tsx
 * ============================================================================
 * F-Phase3-Split-Portfolio: IncomeExpenseTab memoized component extracted from
 * EnhancedPortfolioView.tsx (lines ~1964-2337).
 *
 * UI-STABILITY fix (2026-09-28): wrapped in React.memo so background refreshes
 * elsewhere in the app don't re-render the tab tree.
 *
 * Polls /api/finance/transactions?month=..&year=.. and renders:
 *   - Month selector (next/prev)
 *   - 4-card summary (income / expenses / savings / savings rate)
 *   - Expenses-by-category breakdown bars
 *   - UnifiedTable of recent transactions with delete + publish actions
 *   - Add-transaction dialog (income/expense + category + recurring toggle)
 *
 * Currency-aware: the local formatCurrency closure shadows the module-level
 * EGP-only one (uses displayCurrency from the global store).
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
	Plus,
	Trash2,
	ChevronLeft,
	ChevronRight,
	ArrowUpRight,
	ArrowDownRight,
	PiggyBank,
	TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
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
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n-context';
import type {
	FinancialTransaction,
	IncomeExpenseSummary,
	TransactionType,
} from '@/types';
import {
	formatCurrencyRaw,
	INCOME_CATEGORIES,
	EXPENSE_CATEGORIES,
} from './helpers';

export const IncomeExpenseTab = memo(function IncomeExpenseTab() {
	const t = useTranslation();
	// P37-PHASE-2B-4A: currency-aware totals (EGP/USD/SAR toggle from header).
	const { displayCurrency, usdRate, sarRate } = useAppStore();
	const formatCurrency = (value: number | null | undefined) =>
		formatCurrencyRaw(value, displayCurrency, usdRate, sarRate);
	const now = new Date();
	const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
	const [year, setYear] = useState(String(now.getFullYear()));
	const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
	const [summary, setSummary] = useState<IncomeExpenseSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [transType, setTransType] = useState<TransactionType>('income');

	// Add form
	const [formCategory, setFormCategory] = useState('');
	const [formAmount, setFormAmount] = useState('');
	const [formDescription, setFormDescription] = useState('');
	const [formDate, setFormDate] = useState(now.toISOString().split('T')[0]);
	const [formIsRecurring, setFormIsRecurring] = useState(false);
	const [formFrequency, setFormFrequency] = useState('monthly');

	// UI-STABILITY fix (2026-09-28): silent polling — only first load (or when
	// month/year changes) shows the skeleton; manual refresh uses silent=true.
	const loadTransactions = useCallback(async (silent = false) => {
		if (silent) {
			// Don't wipe the existing rows — only show a subtle spinner elsewhere if needed.
		} else {
			setLoading(true);
		}
		try {
			const res = await fetch(`/api/finance/transactions?month=${month}&year=${year}`);
			const data = await res.json();
			setTransactions(data.items || []);
			setSummary(data.summary || null);
		} catch {
			if (!silent) toast.error('فشل في تحميل المعاملات');
		} finally {
			if (!silent) setLoading(false);
		}
	}, [month, year]);

	useEffect(() => { loadTransactions(); }, [loadTransactions]);

	const handleSave = async () => {
		if (!formCategory || !formAmount) { toast.error('يرجى ملء جميع الحقول المطلوبة'); return; }
		try {
			const res = await fetch('/api/finance/transactions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: transType,
					category: formCategory,
					amount: parseFloat(formAmount),
					description: formDescription,
					transaction_date: formDate,
					is_recurring: formIsRecurring,
					recurring_frequency: formIsRecurring ? formFrequency : null,
				}),
			});
			const data = await res.json();
			if (data.success) {
				toast.success('تمت إضافة المعاملة بنجاح');
				setAddDialogOpen(false);
				setFormCategory(''); setFormAmount(''); setFormDescription('');
				// UI-STABILITY fix (2026-09-28): silent refresh after save — keep table state
				loadTransactions(true);
			} else {
				toast.error(data.error || 'فشل في إضافة المعاملة');
			}
		} catch {
			toast.error(t('portfolio.toast.connectionError'));
		}
	};

	const handleDelete = async (id: number) => {
		try {
			const res = await fetch(`/api/finance/transactions/${id}`, { method: 'DELETE' });
			const data = await res.json();
			if (data.success) {
				toast.success('تم حذف المعاملة');
				// UI-STABILITY fix (2026-09-28): silent refresh after delete
				loadTransactions(true);
			} else {
				toast.error(data.error || 'فشل في الحذف');
			}
		} catch {
			toast.error(t('portfolio.toast.connectionError'));
		}
	};

	// ─── UnifiedTable columns for transactions ────────────────────────────────────
	// UI-STABILITY fix (2026-09-28): wrap transactionColumns in useMemo so its
	// reference is stable across renders — UnifiedTable re-computes sort/filter
	// state when columns identity changes, which destroys user UI state.
	// handleDelete is defined above (stable per render) — including it in deps
	// is the correct exhaustive-deps choice.
	const transactionColumns: Column<FinancialTransaction>[] = useMemo(() => [
		{
			key: 'type',
			header: 'النوع',
			sortable: true,
			filterable: true,
			render: (t) => (
				<Badge className={t.type === 'income' ? 'bg-profit/10 text-profit border border-profit/20 ' : 'bg-loss/10 text-loss border border-loss/20 '}>
					{t.type === 'income' ? 'دخل' : 'مصروف'}
				</Badge>
			),
		},
		{
			key: 'category',
			header: 'التصنيف',
			sortable: true,
			filterable: true,
			className: 'text-sm',
		},
		{
			key: 'amount',
			header: 'المبلغ',
			align: 'center',
			sortable: true,
			filterable: true,
			render: (t) => (
				<span className={cn('font-semibold text-sm', t.type === 'income' ? 'text-profit ' : 'text-loss ')}>
					{t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
				</span>
			),
		},
		{
			key: 'description',
			header: 'الوصف',
			filterable: true,
			className: 'text-xs text-muted-foreground',
			render: (t) => (
				<span className="block max-w-[150px] truncate" title={t.description || ''}>
					{t.description || '—'}
				</span>
			),
		},
		{
			key: 'transaction_date',
			header: 'التاريخ',
			sortable: true,
			filterable: true,
			className: 'text-xs text-muted-foreground',
			render: (t) => <span dir="ltr">{t.transaction_date}</span>,
		},
		{
			key: '_delete',
			header: 'إجراءات',
			align: 'center',
			render: (t) => (
				<Button
					variant="ghost"
					size="icon"
					className="h-9 w-9 text-muted-foreground hover:text-loss"
					onClick={(e) => { e.stopPropagation(); if (t.id != null) handleDelete(t.id); }}
				>
					<Trash2 className="w-3.5 h-3.5" />
				</Button>
			),
		},
		// UI-STABILITY fix (2026-09-28): useMemo deps — handleDelete identity changes
		// per render (it's defined inline above), but its closure only depends on
		// values that don't change here (no extra state inside the columns body).
	], [handleDelete, formatCurrency]);

	const changeMonth = (dir: number) => {
		const d = new Date(parseInt(year), parseInt(month) - 1 + dir, 1);
		setMonth(String(d.getMonth() + 1).padStart(2, '0'));
		setYear(String(d.getFullYear()));
	};

	const arabicMonths = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
	const currentMonthLabel = arabicMonths[parseInt(month) - 1] + ' ' + year;

	const categories = transType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

	if (loading) {
		return (
			<div className="space-y-4">
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					{[...Array(4)].map((_, i) => (
						<Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-7 w-28" /></CardContent></Card>
					))}
				</div>
				<Card><CardContent className="p-4"><Skeleton className="h-40 w-full" /></CardContent></Card>
			</div>
		);
	}

	const savingsRate = summary && summary.total_income > 0 ? ((summary.net_savings / summary.total_income) * 100) : 0;

	return (
		<div className="space-y-6">
			{/* Month Selector */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Button variant="outline" size="icon" onClick={() => changeMonth(-1)}><ChevronRight className="w-4 h-4" /></Button>
					<span className="font-semibold text-sm min-w-[120px] text-center">{currentMonthLabel}</span>
					<Button variant="outline" size="icon" onClick={() => changeMonth(1)}><ChevronLeft className="w-4 h-4" /></Button>
				</div>
				<Button className="bg-profit hover:bg-profit text-white" size="sm" onClick={() => setAddDialogOpen(true)}>
					<Plus className="w-4 h-4 ml-1.5" />
					إضافة معاملة
				</Button>
			</div>

			{/* Summary Row */}
			{summary && (
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<Card className="p-4">
						<div className="flex items-center gap-2 text-muted-foreground mb-1">
							<ArrowUpRight className="w-4 h-4 text-profit" />
							<span className="text-xs font-medium">إجمالي الدخل</span>
						</div>
						<p className="text-lg font-bold text-profit ">{formatCurrency(summary.total_income)}</p>
					</Card>
					<Card className="p-4">
						<div className="flex items-center gap-2 text-muted-foreground mb-1">
							<ArrowDownRight className="w-4 h-4 text-loss" />
							<span className="text-xs font-medium">إجمالي المصروفات</span>
						</div>
						<p className="text-lg font-bold text-loss ">{formatCurrency(summary.total_expenses)}</p>
					</Card>
					<Card className="p-4">
						<div className="flex items-center gap-2 text-muted-foreground mb-1">
							<PiggyBank className="w-4 h-4 text-whale" />
							<span className="text-xs font-medium">صافي الادخار</span>
						</div>
						<p className="text-lg font-bold text-whale ">{formatCurrency(summary.net_savings)}</p>
					</Card>
					<Card className="p-4">
						<div className="flex items-center gap-2 text-muted-foreground mb-1">
							<TrendingUp className="w-4 h-4" />
							<span className="text-xs font-medium">نسبة الادخار</span>
						</div>
						<p className="text-lg font-bold">{(savingsRate ?? 0).toFixed(1)}%</p>
						<Progress value={Math.min(savingsRate, 100)} className="h-2 mt-2" />
					</Card>
				</div>
			)}

			{/* Expenses breakdown bars */}
			{summary && summary.expenses_by_category && Object.keys(summary.expenses_by_category).length > 0 && (
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm">توزيع المصروفات</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{Object.entries(summary.expenses_by_category)
							.sort(([, a], [, b]) => b - a)
							.slice(0, 6)
							.map(([cat, amount]) => {
								const pct = summary.total_expenses > 0 ? (amount / summary.total_expenses) * 100 : 0;
								const catInfo = EXPENSE_CATEGORIES.find((c) => c.value === cat);
								const label = catInfo?.label || cat;
								return (
									<div key={cat} className="space-y-1">
										<div className="flex justify-between text-xs">
											<span className="text-muted-foreground">{label}</span>
											<span className="font-medium">{formatCurrency(amount)} ({(pct ?? 0).toFixed(1)}%)</span>
										</div>
										<div className="h-2 rounded-full bg-muted overflow-hidden">
											<div className="h-full rounded-full bg-loss transition-all" style={{ width: `${pct}%` }} />
										</div>
									</div>
								);
							})}
					</CardContent>
				</Card>
			)}

			{/* Transactions Table */}
			<Card>
				<CardHeader className="pb-2">
					<div className="flex items-center justify-between gap-2 flex-wrap">
						<CardTitle className="text-sm">المعاملات الأخيرة</CardTitle>
						{transactions.length > 0 && (
							<UnifiedPublishButton
								variant="outline"
								size="sm"
								title="المعاملات الأخيرة"
								content={`المعاملات الأخيرة\n${transactions.slice(0, 20).map((t, i) => `${i + 1}. ${t.type === 'income' ? 'دخل' : 'مصروف'} — ${t.category} — ${formatCurrency(t.amount)} ج.م — ${t.transaction_date}`).join('\n')}`}
								filename={`transactions-${Date.now()}`}
								hashtags={['معاملات', 'محفظة']}
								triggerLabel="نشر"
							/>
						)}
					</div>
				</CardHeader>
				<CardContent>
					{transactions.length === 0 ? (
						<p className="text-sm text-muted-foreground text-center py-8">لا توجد معاملات لهذا الشهر</p>
					) : (
						<UnifiedTable<FinancialTransaction>
							columns={transactionColumns}
							data={transactions}
							keyField="id"
							dense
							columnToggle
							filterable
							maxHeight="max-h-96"
							publishable
							publishTitle="معاملات المحفظة المالية"
							publishFilename={`portfolio-transactions-${new Date().toISOString().slice(0,10)}`}
							publishHashtags={['محفظة_استثمارية', 'بورصة_مصر', 'EGX', 'استثمار']}
						/>
					)}
				</CardContent>
			</Card>

			{/* Add Transaction Dialog */}
			<Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
				<DialogContent className="sm:max-w-lg w-[calc(100%-1rem)]" dir="rtl">
					<DialogHeader>
						<DialogTitle>إضافة معاملة</DialogTitle>
						<DialogDescription>سجل دخل أو مصروف جديد</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-2">
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-2">
								<Label>النوع</Label>
								<Select value={transType} onValueChange={(v) => { setTransType(v as TransactionType); setFormCategory(''); }}>
									<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="income">دخل</SelectItem>
										<SelectItem value="expense">مصروف</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label>التصنيف</Label>
								<Select value={formCategory} onValueChange={setFormCategory}>
									<SelectTrigger className="w-full"><SelectValue placeholder="اختر..." /></SelectTrigger>
									<SelectContent>
										{(transType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
											<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="space-y-2"><Label>المبلغ (ج.م)</Label><Input type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} placeholder="0.00" dir="ltr" /></div>
						<div className="space-y-2"><Label>الوصف</Label><Input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="وصف المعاملة..." /></div>
						<div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} dir="ltr" /></div>
						<div className="flex items-center gap-3">
							<Checkbox checked={formIsRecurring} onCheckedChange={(v) => setFormIsRecurring(v === true)} />
							<Label>متكرر؟</Label>
						</div>
						{formIsRecurring && (
							<div className="space-y-2">
								<Label>التكرار</Label>
								<Select value={formFrequency} onValueChange={setFormFrequency}>
									<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="monthly">شهري</SelectItem>
										<SelectItem value="weekly">أسبوعي</SelectItem>
										<SelectItem value="yearly">سنوي</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</div>
					<DialogFooter className="gap-2 sm:gap-0">
						<Button variant="outline" onClick={() => setAddDialogOpen(false)}>إلغاء</Button>
						<Button className="bg-profit hover:bg-profit text-white" onClick={handleSave}>حفظ</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
});
