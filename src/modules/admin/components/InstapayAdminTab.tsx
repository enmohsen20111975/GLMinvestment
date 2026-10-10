'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Coins,
  FileImage,
  User,
  Calendar,
} from 'lucide-react';
import { getAdminToken } from '@/lib/admin-auth';

interface InstapayPayment {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  tier: string;
  market: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  sender_phone: string | null;
  receipt_url: string;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export function InstapayAdminTab() {
  const [payments, setPayments] = useState<InstapayPayment[]>([]);
  const [counts, setCounts] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  
  // Receipt Viewer Modal
  const [viewingReceipt, setViewingReceipt] = useState<InstapayPayment | null>(null);

  // Action State
  const [actionTarget, setActionTarget] = useState<{ payment: InstapayPayment; type: 'approve' | 'reject' } | null>(null);
  const [rejectReason, setRejectReason] = useState('لم يصل التحويل في الحساب');
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const adminToken = await getAdminToken();
      const headers: Record<string, string> = {};
      if (adminToken) headers['x-admin-token'] = adminToken;

      const res = await fetch(`/api/admin/instapay?status=${statusFilter}`, {
        headers,
      });
      const data = await res.json();
      if (data.success) {
        setPayments(data.payments || []);
        if (data.counts) {
          setCounts(data.counts);
        }
      } else {
        toast.error(data.error || 'فشل جلب بيانات الدفع');
      }
    } catch (err: any) {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleActionConfirm = async () => {
    if (!actionTarget) return;

    setIsProcessing(true);
    try {
      const adminToken = await getAdminToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (adminToken) headers['x-admin-token'] = adminToken;

      const res = await fetch(`/api/admin/instapay/${actionTarget.payment.id}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: actionTarget.type,
          reason: actionTarget.type === 'reject' ? rejectReason : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشلت معالجة الطلب');
      }

      toast.success(data.message || 'تمت معالجة الطلب بنجاح');
      setActionTarget(null);
      fetchPayments();
    } catch (err: any) {
      toast.error(err?.message || 'حدث خطأ أثناء تنفيذ الإجراء');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredPayments = payments.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.user_email.toLowerCase().includes(q) ||
      (p.user_name && p.user_name.toLowerCase().includes(q)) ||
      (p.sender_phone && p.sender_phone.includes(q)) ||
      p.tier.toLowerCase().includes(q)
    );
  });

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('ar-EG', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header and Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">إجمالي الطلبات</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              <span>{counts.total}</span>
              <Coins className="w-5 h-5 text-muted-foreground opacity-60" />
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className={counts.pending > 0 ? 'border-amber-500/50 bg-amber-500/5' : 'border-border'}>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              قيد المراجعة ⏳
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-600 dark:text-amber-400 flex items-center justify-between">
              <span>{counts.pending}</span>
              <Clock className="w-5 h-5" />
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              تم التفعيل بنجاح ✅
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
              <span>{counts.approved}</span>
              <CheckCircle2 className="w-5 h-5" />
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs text-rose-500 font-medium">
              مرفوضة ❌
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-rose-500 flex items-center justify-between">
              <span>{counts.rejected}</span>
              <XCircle className="w-5 h-5" />
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-3 min-w-[280px]">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="بحث بالإيميل أو الاسم أو رقم الهاتف..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-9 text-xs"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px] text-xs">
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات ({counts.total})</SelectItem>
                  <SelectItem value="pending">قيد المراجعة ({counts.pending})</SelectItem>
                  <SelectItem value="approved">تم التفعيل ({counts.approved})</SelectItem>
                  <SelectItem value="rejected">مرفوض ({counts.rejected})</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={fetchPayments}
              disabled={loading}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              تحديث
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            طلبات التحويل عبر إنستاباي
          </CardTitle>
          <CardDescription className="text-xs">
            قم بمراجعة صورة الإيصال واضغط تأكيد لتفعيل الاشتراك فوراً في قاعدة البيانات وتحديث صلاحيات العميل.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground space-y-2">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
              <p className="text-xs">جاري تحميل سجلات الدفع...</p>
            </div>
          ) : filteredPayments.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground space-y-2">
              <Coins className="w-8 h-8 mx-auto opacity-40" />
              <p className="text-sm font-medium">لا توجد طلبات دفع مطابقة لهذا الفلتر</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead>
                  <tr className="border-b bg-muted/30 text-muted-foreground font-semibold">
                    <th className="p-3">المستخدم / البريد</th>
                    <th className="p-3">الباقة المطلوبة</th>
                    <th className="p-3">المبلغ</th>
                    <th className="p-3">بيانات المحول</th>
                    <th className="p-3">الإيصال</th>
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredPayments.map((p) => {
                    const isPending = p.status === 'pending';
                    const isApproved = p.status === 'approved';
                    const isRejected = p.status === 'rejected';

                    return (
                      <tr
                        key={p.id}
                        className={`hover:bg-muted/30 transition-colors ${
                          isPending ? 'bg-amber-500/[0.02]' : ''
                        }`}
                      >
                        {/* User email and name */}
                        <td className="p-3">
                          <div className="font-bold text-foreground font-mono">{p.user_email}</div>
                          {p.user_name && (
                            <div className="text-[11px] text-muted-foreground">{p.user_name}</div>
                          )}
                        </td>

                        {/* Plan */}
                        <td className="p-3">
                          <Badge variant="outline" className="font-bold">
                            {p.tier}
                          </Badge>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {p.billing_cycle === 'yearly' ? 'سنوي (365 يوم)' : 'شهري (30 يوم)'} • {p.market}
                          </div>
                        </td>

                        {/* Amount */}
                        <td className="p-3">
                          <span className="font-bold text-foreground text-sm">
                            {p.amount}
                          </span>{' '}
                          <span className="text-[10px] text-muted-foreground">{p.currency}</span>
                        </td>

                        {/* Sender info */}
                        <td className="p-3">
                          <div className="font-medium text-foreground">
                            {p.sender_phone || '—'}
                          </div>
                          {p.notes && (
                            <div className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={p.notes}>
                              {p.notes}
                            </div>
                          )}
                        </td>

                        {/* Receipt Thumbnail */}
                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => setViewingReceipt(p)}
                            className="group relative block w-12 h-12 rounded-lg overflow-hidden border border-border hover:border-primary transition-all bg-muted/40 shadow-sm"
                            title="اضغط لمعاينة وتكبير الإيصال"
                          >
                            <img
                              src={p.receipt_url}
                              alt="Receipt"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                              <Eye className="w-4 h-4" />
                            </div>
                          </button>
                        </td>

                        {/* Date */}
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          {formatDate(p.created_at)}
                        </td>

                        {/* Status */}
                        <td className="p-3">
                          {isPending && (
                            <Badge className="bg-amber-500/15 text-amber-600 border border-amber-500/30 text-[10px]">
                              ⏳ قيد المراجعة
                            </Badge>
                          )}
                          {isApproved && (
                            <Badge className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 text-[10px]">
                              ✅ مفعل
                            </Badge>
                          )}
                          {isRejected && (
                            <Badge className="bg-rose-500/15 text-rose-600 border border-rose-500/30 text-[10px]">
                              ❌ مرفوض
                            </Badge>
                          )}
                        </td>

                        {/* Action buttons */}
                        <td className="p-3 text-center">
                          {isPending ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <Button
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 px-2.5 text-xs font-bold gap-1"
                                onClick={() => setActionTarget({ payment: p, type: 'approve' })}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                تأكيد وتفعيل
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-500/30 text-rose-600 hover:bg-rose-500/10 h-7 px-2 text-xs"
                                onClick={() => setActionTarget({ payment: p, type: 'reject' })}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                رفض
                              </Button>
                            </div>
                          ) : isApproved ? (
                            <span className="text-[11px] text-muted-foreground">
                              فعل بواسطة: {p.reviewed_by?.split('@')[0] || 'الأدمن'}
                            </span>
                          ) : (
                            <span className="text-[11px] text-rose-500" title={p.admin_notes || ''}>
                              {p.admin_notes || 'مرفوض'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receipt Viewer Modal */}
      <Dialog open={!!viewingReceipt} onOpenChange={(open) => !open && setViewingReceipt(null)}>
        <DialogContent className="max-w-3xl w-full p-4" dir="rtl">
          <DialogHeader className="text-right pb-2 border-b">
            <DialogTitle className="text-base font-bold flex items-center justify-between">
              <span>إشعار تحويل إنستاباي — {viewingReceipt?.user_email}</span>
              <Badge variant="outline">{viewingReceipt?.amount} {viewingReceipt?.currency}</Badge>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              باقة: {viewingReceipt?.tier} • رقم المحول: {viewingReceipt?.sender_phone || 'غير مسجل'}
            </DialogDescription>
          </DialogHeader>

          {viewingReceipt && (
            <div className="py-2 space-y-3">
              <div className="rounded-xl overflow-hidden border bg-black/5 flex items-center justify-center max-h-[70vh]">
                <img
                  src={viewingReceipt.receipt_url}
                  alt="Receipt Preview"
                  className="max-h-[68vh] w-auto object-contain rounded-lg"
                />
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <a
                  href={viewingReceipt.receipt_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline flex items-center gap-1 font-medium"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> فتح الصورة بالحجم الكامل في نافذة جديدة
                </a>

                {viewingReceipt.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 gap-1 font-bold"
                      onClick={() => {
                        const cur = viewingReceipt;
                        setViewingReceipt(null);
                        setActionTarget({ payment: cur, type: 'approve' });
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      تأكيد وتفعيل الاشتراك
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-rose-500/30 text-rose-600 hover:bg-rose-500/10 text-xs h-8"
                      onClick={() => {
                        const cur = viewingReceipt;
                        setViewingReceipt(null);
                        setActionTarget({ payment: cur, type: 'reject' });
                      }}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      رفض الطلب
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog (Approve or Reject) */}
      <Dialog open={!!actionTarget} onOpenChange={(open) => !open && setActionTarget(null)}>
        <DialogContent className="max-w-md w-full p-5" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              {actionTarget?.type === 'approve' ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  تأكيد تفعيل اشتراك المستخدم
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-rose-500" />
                  رفض طلب التحويل
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground text-right mt-1">
              {actionTarget?.type === 'approve'
                ? `سيتم ترقية الحساب فوراً إلى باقة [${actionTarget.payment.tier}] وتحديث صلاحياته وقاعدة البيانات.`
                : 'سيتم وضع علامة مرفوض على الطلب دون ترقية المستخدم.'}
            </DialogDescription>
          </DialogHeader>

          {actionTarget && (
            <div className="space-y-3 py-2 text-xs">
              <div className="p-3 rounded-lg bg-muted/50 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">البريد:</span>
                  <span className="font-mono font-bold text-foreground">{actionTarget.payment.user_email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الباقة:</span>
                  <span className="font-bold text-foreground">{actionTarget.payment.tier} ({actionTarget.payment.billing_cycle})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">المبلغ:</span>
                  <span className="font-bold text-emerald-600">{actionTarget.payment.amount} {actionTarget.payment.currency}</span>
                </div>
              </div>

              {actionTarget.type === 'reject' && (
                <div className="space-y-1.5">
                  <label className="font-medium text-foreground">سبب الرفض (اختياري):</label>
                  <Input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="اكتب سبب الرفض هنا..."
                    className="text-xs"
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionTarget(null)}
              disabled={isProcessing}
            >
              إلغاء
            </Button>
            <Button
              size="sm"
              onClick={handleActionConfirm}
              disabled={isProcessing}
              className={
                actionTarget?.type === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white font-bold'
                  : 'bg-rose-600 hover:bg-rose-700 text-white font-bold'
              }
            >
              {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin ml-1.5" />}
              {actionTarget?.type === 'approve' ? 'تأكيد التفعيل الفوري' : 'تأكيد الرفض'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
