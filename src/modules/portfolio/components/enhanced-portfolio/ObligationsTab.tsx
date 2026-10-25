'use client';

/**
 * enhanced-portfolio/ObligationsTab.tsx
 * ============================================================================
 * F-Phase3-Split-Portfolio: ObligationsTab memoized component extracted from
 * EnhancedPortfolioView.tsx (lines ~2342-2712).
 *
 * UI-STABILITY fix (2026-09-28): wrapped in React.memo so background refreshes
 * elsewhere don't re-render the obligations tab tree.
 *
 * Polls /api/finance/obligations?status=active and renders:
 *   - 3-card summary (total debt / monthly payments / active loans)
 *   - Add-obligation button
 *   - List of obligations with progress bar (paid %)
 *   - 4 dialogs: add / record payment / edit / delete confirmation
 *
 * Currency-aware: the local formatCurrency closure shadows the module-level
 * EGP-only one (uses displayCurrency from the global store).
 * ============================================================================
 */

import { useState, useEffect, useCallback, memo } from 'react';
import {
	AlertTriangle,
	Plus,
	Trash2,
	Pencil,
	CreditCard,
	CalendarDays,
	FileText,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n-context';
import type { FinancialObligation } from '@/types';
import {
	formatCurrencyRaw,
	OBLIGATION_TYPE_LABELS,
	OBLIGATION_STATUS_LABELS,
	OBLIGATION_STATUS_COLORS,
} from './helpers';

export const ObligationsTab = memo(function ObligationsTab() {
	const t = useTranslation();
	// P37-PHASE-2B-4A: currency-aware totals (EGP/USD/SAR toggle from header).
	const { displayCurrency, usdRate, sarRate } = useAppStore();
	const formatCurrency = (value: number | null | undefined) =>
		formatCurrencyRaw(value, displayCurrency, usdRate, sarRate);
	const [obligations, setObligations] = useState<FinancialObligation[]>([]);
	const [loading, setLoading] = useState(true);
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
	const [paymentObligation, setPaymentObligation] = useState<FinancialObligation | null>(null);
	const [editItem, setEditItem] = useState<FinancialObligation | null>(null);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [deleteId, setDeleteId] = useState<number | null>(null);

	// Add form
	const [formType, setFormType] = useState('loan');
	const [formName, setFormName] = useState('');
	const [formCreditor, setFormCreditor] = useState('');
	const [formTotalAmount, setFormTotalAmount] = useState('');
	const [formRemainingAmount, setFormRemainingAmount] = useState('');
	const [formMonthlyPayment, setFormMonthlyPayment] = useState('');
	const [formInterestRate, setFormInterestRate] = useState('');
	const [formStartDate, setFormStartDate] = useState('');
	const [formEndDate, setFormEndDate] = useState('');
	const [formNextPaymentDate, setFormNextPaymentDate] = useState('');
	const [formNotes, setFormNotes] = useState('');

	// Payment form
	const [payAmount, setPayAmount] = useState('');
	const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
	const [payPrincipal, setPayPrincipal] = useState('');
	const [payInterest, setPayInterest] = useState('');

	const loadObligations = useCallback(async (silent = false) => {
		// UI-STABILITY fix (2026-09-28): silent polling — only first load shows skeleton
		if (!silent) setLoading(true);
		try {
			const res = await fetch('/api/finance/obligations?status=active');
			const data = await res.json();
			setObligations(data.items || []);
		} catch {
			if (!silent) toast.error('فشل في تحميل الالتزامات');
		} finally {
			if (!silent) setLoading(false);
		}
	}, []);

	useEffect(() => { loadObligations(); }, [loadObligations]);

	const resetForm = () => {
		setFormType('loan'); setFormName(''); setFormCreditor('');
		setFormTotalAmount(''); setFormRemainingAmount(''); setFormMonthlyPayment('');
		setFormInterestRate(''); setFormStartDate(''); setFormEndDate('');
		setFormNextPaymentDate(''); setFormNotes('');
	};

	const handleSave = async () => {
		try {
			const res = await fetch('/api/finance/obligations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: formType, name: formName, creditor: formCreditor,
					total_amount: parseFloat(formTotalAmount),
					remaining_amount: parseFloat(formRemainingAmount),
					monthly_payment: parseFloat(formMonthlyPayment),
					interest_rate: formInterestRate ? parseFloat(formInterestRate) : null,
					start_date: formStartDate,
					end_date: formEndDate || null,
					next_payment_date: formNextPaymentDate || null,
					notes: formNotes.trim() || null,
				}),
			});
			const data = await res.json();
			if (data.success) {
				toast.success('تمت إضافة الالتزام بنجاح');
				setAddDialogOpen(false);
				resetForm();
				// UI-STABILITY fix (2026-09-28): silent refresh after add — keep table state
				loadObligations(true);
			} else {
				toast.error(data.error || 'فشل في إضافة الالتزام');
			}
		} catch {
			toast.error(t('portfolio.toast.connectionError'));
		}
	};

	const handleEditSave = async () => {
		if (!editItem?.id) return;
		try {
			const res = await fetch(`/api/finance/obligations/${editItem.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: formName, remaining_amount: parseFloat(formRemainingAmount),
					monthly_payment: parseFloat(formMonthlyPayment),
					notes: formNotes.trim() || null,
				}),
			});
			const data = await res.json();
			if (data.success) {
				toast.success('تم تحديث الالتزام');
				setEditDialogOpen(false);
				// UI-STABILITY fix (2026-09-28): silent refresh after edit
				loadObligations(true);
			} else {
				toast.error(data.error || 'فشل في التحديث');
			}
		} catch {
			toast.error(t('portfolio.toast.connectionError'));
		}
	};

	const handleDelete = async () => {
		if (!deleteId) return;
		try {
			const res = await fetch(`/api/finance/obligations/${deleteId}`, { method: 'DELETE' });
			const data = await res.json();
			if (data.success) {
				toast.success('تم حذف الالتزام');
				setDeleteId(null);
				// UI-STABILITY fix (2026-09-28): silent refresh after delete
				loadObligations(true);
			} else {
				toast.error(data.error || 'فشل في الحذف');
			}
		} catch {
			toast.error(t('portfolio.toast.connectionError'));
		}
	};

	const handlePayment = async () => {
		if (!paymentObligation?.id) return;
		try {
			const res = await fetch('/api/finance/obligations/payments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					obligation_id: paymentObligation.id,
					amount: parseFloat(payAmount),
					payment_date: payDate,
					principal_amount: payPrincipal ? parseFloat(payPrincipal) : null,
					interest_amount: payInterest ? parseFloat(payInterest) : null,
				}),
			});
			const data = await res.json();
			if (data.success) {
				toast.success('تم تسجيل الدفعة بنجاح');
				setPaymentDialogOpen(false);
				// UI-STABILITY fix (2026-09-28): silent refresh after payment
				loadObligations(true);
			} else {
				toast.error(data.error || 'فشل في تسجيل الدفعة');
			}
		} catch {
			toast.error(t('portfolio.toast.connectionError'));
		}
	};

	const openPayment = (ob: FinancialObligation) => {
		setPaymentObligation(ob);
		setPayAmount(String(ob.monthly_payment));
		setPayDate(new Date().toISOString().split('T')[0]);
		setPayPrincipal('');
		setPayInterest('');
		setPaymentDialogOpen(true);
	};

	const openEdit = (ob: FinancialObligation) => {
		setEditItem(ob);
		setFormName(ob.name); setFormRemainingAmount(String(ob.remaining_amount));
		setFormMonthlyPayment(String(ob.monthly_payment)); setFormNotes(ob.notes || '');
		setEditDialogOpen(true);
	};

	const totalDebt = (obligations || []).reduce((s, o) => s + (o.remaining_amount || 0), 0);
	const monthlyPayments = (obligations || []).reduce((s, o) => s + (o.monthly_payment || 0), 0);
	const activeLoans = (obligations || []).filter((o) => o.status === 'active').length;

	if (loading) {
		return (
			<div className="space-y-4">
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
					{[...Array(3)].map((_, i) => (
						<Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-7 w-28" /></CardContent></Card>
					))}
				</div>
				{[...Array(2)].map((_, i) => (
					<Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
				))}
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Summary */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<Card className="p-4">
					<div className="flex items-center gap-2 text-muted-foreground mb-1"><CreditCard className="w-4 h-4" /><span className="text-xs font-medium">إجمالي المديونية</span></div>
					<p className="text-lg font-bold text-loss ">{formatCurrency(totalDebt)}</p>
				</Card>
				<Card className="p-4">
					<div className="flex items-center gap-2 text-muted-foreground mb-1"><CalendarDays className="w-4 h-4" /><span className="text-xs font-medium">الأقساط الشهرية</span></div>
					<p className="text-lg font-bold">{formatCurrency(monthlyPayments)}</p>
				</Card>
				<Card className="p-4">
					<div className="flex items-center gap-2 text-muted-foreground mb-1"><FileText className="w-4 h-4" /><span className="text-xs font-medium">القروض النشطة</span></div>
					<p className="text-lg font-bold">{activeLoans}</p>
				</Card>
			</div>

			{/* Add Button */}
			<div className="flex justify-end">
				<Button className="bg-profit hover:bg-profit text-white" size="sm" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
					<Plus className="w-4 h-4 ml-1.5" />
					إضافة التزام
				</Button>
			</div>

			{/* Obligations List */}
			{(obligations || []).length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center justify-center py-12 text-center">
						<CreditCard className="w-10 h-10 text-muted-foreground mb-3" />
						<h3 className="text-lg font-semibold mb-1">لا توجد التزامات</h3>
						<p className="text-sm text-muted-foreground">أضف التزاماتك المالية لتتبعها</p>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-4">
					{(obligations || []).map((ob) => {
						const paidPercent = ob.total_amount > 0 ? ((ob.total_amount - ob.remaining_amount) / ob.total_amount) * 100 : 0;
						return (
							<Card key={ob.id} className="hover:shadow-md transition-shadow">
								<CardContent className="p-4">
									<div className="flex items-start justify-between mb-3">
										<div className="flex items-center gap-2">
											<Badge className={OBLIGATION_STATUS_COLORS[ob.status]}>{OBLIGATION_STATUS_LABELS[ob.status]}</Badge>
											<Badge variant="outline">{OBLIGATION_TYPE_LABELS[ob.type] || ob.type}</Badge>
											<h3 className="font-semibold text-sm">{ob.name}</h3>
										</div>
										<div className="flex items-center gap-1">
											<Button variant="outline" size="sm" onClick={() => openPayment(ob)}>تسجيل دفعة</Button>
											<Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(ob)}><Pencil className="w-3.5 h-3.5" /></Button>
											<Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-loss" onClick={() => setDeleteId(ob.id!)}><Trash2 className="w-3.5 h-3.5" /></Button>
										</div>
									</div>
									<div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
										<div><span className="text-muted-foreground">الدائن:</span> <span className="font-medium">{ob.creditor}</span></div>
										<div><span className="text-muted-foreground">المتبقي:</span> <span className="font-medium text-loss ">{formatCurrency(ob.remaining_amount)}</span></div>
										<div><span className="text-muted-foreground">القسط الشهري:</span> <span className="font-medium">{formatCurrency(ob.monthly_payment)}</span></div>
										{ob.interest_rate && <div><span className="text-muted-foreground">الفائدة:</span> <span className="font-medium">{ob.interest_rate}%</span></div>}
									</div>
									<div className="mt-3 space-y-1">
										<div className="flex justify-between text-xs">
											<span className="text-muted-foreground">تم السداد</span>
											<span className="font-medium">{(paidPercent ?? 0).toFixed(1)}%</span>
										</div>
										<Progress value={paidPercent} className="h-2" />
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			{/* Add Obligation Dialog */}
			<Dialog open={addDialogOpen} onOpenChange={(v) => { if (!v) resetForm(); setAddDialogOpen(v); }}>
				<DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
					<DialogHeader>
						<DialogTitle>إضافة التزام جديد</DialogTitle>
						<DialogDescription>سجل قرض أو التزام مالي</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-2">
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-2">
								<Label>النوع</Label>
								<Select value={formType} onValueChange={setFormType}>
									<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
									<SelectContent>
										{Object.entries(OBLIGATION_TYPE_LABELS).map(([k, v]) => (
											<SelectItem key={k} value={k}>{v}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2"><Label>اسم الالتزام</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="قرض شخصي" /></div>
						</div>
						<div className="space-y-2"><Label>الدائن</Label><Input value={formCreditor} onChange={(e) => setFormCreditor(e.target.value)} placeholder="البنك / الشخص" /></div>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-2"><Label>إجمالي المبلغ</Label><Input type="number" value={formTotalAmount} onChange={(e) => setFormTotalAmount(e.target.value)} placeholder="0.00" dir="ltr" /></div>
							<div className="space-y-2"><Label>المبلغ المتبقي</Label><Input type="number" value={formRemainingAmount} onChange={(e) => setFormRemainingAmount(e.target.value)} placeholder="0.00" dir="ltr" /></div>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-2"><Label>القسط الشهري</Label><Input type="number" value={formMonthlyPayment} onChange={(e) => setFormMonthlyPayment(e.target.value)} placeholder="0.00" dir="ltr" /></div>
							<div className="space-y-2"><Label>سعر الفائدة %</Label><Input type="number" value={formInterestRate} onChange={(e) => setFormInterestRate(e.target.value)} placeholder="0" dir="ltr" /></div>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-2"><Label>تاريخ البداية</Label><Input type="date" value={formStartDate} onChange={(e) => setFormStartDate(e.target.value)} dir="ltr" /></div>
							<div className="space-y-2"><Label>تاريخ النهاية</Label><Input type="date" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} dir="ltr" /></div>
						</div>
						<div className="space-y-2"><Label>تاريخ القسط القادم</Label><Input type="date" value={formNextPaymentDate} onChange={(e) => setFormNextPaymentDate(e.target.value)} dir="ltr" /></div>
						<div className="space-y-2"><Label>ملاحظات</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} /></div>
					</div>
					<DialogFooter className="gap-2 sm:gap-0">
						<Button variant="outline" onClick={() => { resetForm(); setAddDialogOpen(false); }}>إلغاء</Button>
						<Button className="bg-profit hover:bg-profit text-white" onClick={handleSave}>إضافة</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Record Payment Dialog */}
			<Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
				<DialogContent className="sm:max-w-md" dir="rtl">
					<DialogHeader>
						<DialogTitle>تسجيل دفعة — {paymentObligation?.name}</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-2">
						<div className="space-y-2"><Label>المبلغ</Label><Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} dir="ltr" /></div>
						<div className="space-y-2"><Label>تاريخ الدفع</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} dir="ltr" /></div>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-2"><Label>مبلغ الأصل</Label><Input type="number" value={payPrincipal} onChange={(e) => setPayPrincipal(e.target.value)} placeholder="اختياري" dir="ltr" /></div>
							<div className="space-y-2"><Label>مبلغ الفائدة</Label><Input type="number" value={payInterest} onChange={(e) => setPayInterest(e.target.value)} placeholder="اختياري" dir="ltr" /></div>
						</div>
					</div>
					<DialogFooter className="gap-2 sm:gap-0">
						<Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>إلغاء</Button>
						<Button className="bg-profit hover:bg-profit text-white" onClick={handlePayment}>تسجيل</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Edit Dialog */}
			<Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
				<DialogContent className="sm:max-w-md" dir="rtl">
					<DialogHeader><DialogTitle>تعديل الالتزام — {editItem?.name}</DialogTitle></DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2"><Label>الاسم</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-2"><Label>المبلغ المتبقي</Label><Input type="number" value={formRemainingAmount} onChange={(e) => setFormRemainingAmount(e.target.value)} dir="ltr" /></div>
							<div className="space-y-2"><Label>القسط الشهري</Label><Input type="number" value={formMonthlyPayment} onChange={(e) => setFormMonthlyPayment(e.target.value)} dir="ltr" /></div>
						</div>
						<div className="space-y-2"><Label>ملاحظات</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} /></div>
					</div>
					<DialogFooter className="gap-2 sm:gap-0">
						<Button variant="outline" onClick={() => setEditDialogOpen(false)}>إلغاء</Button>
						<Button className="bg-profit hover:bg-profit text-white" onClick={handleEditSave}>حفظ</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation */}
			<Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
				<DialogContent className="sm:max-w-sm" dir="rtl">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-loss"><AlertTriangle className="w-5 h-5" /> تأكيد الحذف</DialogTitle>
						<DialogDescription>هل أنت متأكد من حذف هذا الالتزام؟</DialogDescription>
					</DialogHeader>
					<DialogFooter className="gap-2 sm:gap-0">
						<Button variant="outline" onClick={() => setDeleteId(null)}>إلغاء</Button>
						<Button className="bg-loss hover:bg-loss text-white" onClick={handleDelete}>حذف</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
});
