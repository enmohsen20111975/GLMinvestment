'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Ticket,
  Plus,
  Copy,
  Check,
  Power,
  Trash2,
  RefreshCw,
  Sparkles,
  Calendar,
  Users,
  ShieldCheck,
  Award,
  Zap,
  Clock,
  Gift,
  Key,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PromoCodeItem {
  id: string;
  code: string;
  plan_tier: string;
  premium_days: number;
  max_uses: number;
  current_uses: number;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  redeemed_by: string | null;
}

interface PromoStats {
  total_codes: number;
  active_codes: number;
  total_redemptions: number;
}

export function PromoCodesAdmin() {
  const [codes, setCodes] = useState<PromoCodeItem[]>([]);
  const [stats, setStats] = useState<PromoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Form State
  const [customCode, setCustomCode] = useState('');
  const [planTier, setPlanTier] = useState<string>('all');
  const [durationPreset, setDurationPreset] = useState<string>('30'); // '7', '14', '30', '90', '365', 'custom'
  const [customDays, setCustomDays] = useState<number>(30);
  const [maxUsesPreset, setMaxUsesPreset] = useState<string>('100'); // '1', '10', '50', '100', 'unlimited'
  const [customMaxUses, setCustomMaxUses] = useState<number>(100);
  const [expiryDays, setExpiryDays] = useState<number>(30);

  const fetchPromoCodes = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/promo-codes', { credentials: 'same-origin' });
      const data = await res.json();

      if (data.success) {
        setCodes(data.promo_codes || []);
        setStats(data.stats || null);
      } else {
        toast.error(data.error || 'فشل في جلب أكواد الخصم');
      }
    } catch (err) {
      console.error('Fetch promo codes error:', err);
      toast.error('حدث خطأ في جلب البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPromoCodes();
  }, [fetchPromoCodes]);

  const handleGenerateRandom = () => {
    const prefix = planTier === 'all' || planTier === 'developer' ? 'VIP' : 'PRO';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let randomStr = '';
    for (let i = 0; i < 6; i++) {
      randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCustomCode(`${prefix}-${randomStr}`);
  };

  const handleCreatePromoCode = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);

      const days = durationPreset === 'custom' ? customDays : parseInt(durationPreset, 10);
      const maxUses = maxUsesPreset === 'unlimited' ? 999999 : parseInt(maxUsesPreset, 10);

      // Expiry date calculation
      let expiryDate: string | null = null;
      if (expiryDays > 0) {
        const d = new Date();
        d.setDate(d.getDate() + expiryDays);
        expiryDate = d.toISOString();
      }

      const payload = {
        code: customCode,
        plan_tier: planTier,
        duration_days: days,
        max_uses: maxUses,
        expires_at: expiryDate,
      };

      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      });

      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'تم إنشاء كود الخصم بنجاح!');
        setCustomCode('');
        fetchPromoCodes();
      } else {
        toast.error(data.error || 'فشل في إنشاء كود الخصم');
      }
    } catch (err) {
      console.error('Create promo code error:', err);
      toast.error('حدث خطأ أثناء الإنشاء');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      const res = await fetch('/api/admin/promo-codes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !currentStatus }),
        credentials: 'same-origin',
      });
      const data = await res.json();

      if (data.success) {
        toast.success(data.message || 'تم تحديث حالة الكود');
        setCodes((prev) =>
          prev.map((c) => (c.id === id ? { ...c, is_active: !currentStatus } : c))
        );
      } else {
        toast.error(data.error || 'فشل التحديث');
      }
    } catch {
      toast.error('حدث خطأ في التحديث');
    }
  };

  const handleDeleteCode = async (id: string, codeStr: string) => {
    if (!confirm(`هل أنت تأكد من رغبتك في حذف الكود (${codeStr})؟`)) return;

    try {
      const res = await fetch(`/api/admin/promo-codes?id=${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json();

      if (data.success) {
        toast.success('تم حذف كود الخصم بنجاح');
        setCodes((prev) => prev.filter((c) => c.id !== id));
      } else {
        toast.error(data.error || 'فشل في الحذف');
      }
    } catch {
      toast.error('حدث خطأ أثناء الحذف');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    toast.success(`تم نسخ الكود: ${text}`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'all':
      case 'developer':
        return { label: 'جميع المميزات (كامل)', color: 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/40' };
      case 'premium':
        return { label: 'باقة المحترفين', color: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40' };
      case 'normal':
        return { label: 'الباقة العادية', color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40' };
      default:
        return { label: tier, color: 'bg-muted text-muted-foreground border-border' };
    }
  };

  const formatDays = (days: number) => {
    if (days >= 999) return 'دائم / مفتوح ♾️';
    if (days === 365) return 'سنة كاملة (12 شهر)';
    if (days === 90) return '3 أشهر (90 يوم)';
    if (days === 30) return 'شهر واحد (30 يوم)';
    if (days === 14) return 'أسبوعين (14 يوم)';
    if (days === 7) return 'أسبوع واحد (7 أيام)';
    return `${days} يوم`;
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header & Stats Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/60 pb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-foreground">
            <Ticket className="w-6 h-6 text-emerald-500" />
            مولّد وإدارة أكواد الخصم والاشتراكات (Promo Codes)
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            أنشئ أكواد وترقيات لمستخدمي المنصة مع خيارات تحديد الباقات، المدة الزمنية، وعدد الاستخدامات.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchPromoCodes}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          تحديث الأكواد
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card border-border/60">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500">
              <Ticket className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">إجمالي الأكواد</div>
              <div className="text-2xl font-bold font-mono">{stats?.total_codes ?? codes.length}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/60">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-500">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">الأكواد المفوّضة النشطة</div>
              <div className="text-2xl font-bold font-mono text-blue-500">
                {stats?.active_codes ?? codes.filter((c) => c.is_active).length}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/60">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-500">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">إجمالي مرات التفعيل</div>
              <div className="text-2xl font-bold font-mono text-purple-500">
                {stats?.total_redemptions ?? codes.reduce((acc, c) => acc + c.current_uses, 0)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create Code Form */}
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <Sparkles className="w-5 h-5" />
            إنشاء كود خصم وتفعيل جديد
          </CardTitle>
          <CardDescription className="text-xs">
            حدد الباقات المتاحة، مدة الصلاحية، وأقصى عدد تفعيلات لكل كود.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreatePromoCode} className="space-y-4">
            {/* Code Input */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-foreground flex justify-between">
                  <span>اسم أو رمز الكود (Promo Code):</span>
                  <span className="text-[10px] text-muted-foreground">مثال: WELCOME2026 أو VIP7DAYS</span>
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="أدخل اسم الكود (اتركه فارغاً للتوليد التلقائي)"
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                    className="font-mono uppercase font-bold text-sm bg-background"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGenerateRandom}
                    className="shrink-0 text-xs gap-1.5"
                  >
                    <Key className="w-3.5 h-3.5" />
                    توليد عشوائي
                  </Button>
                </div>
              </div>

              {/* Plan Tier Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">نوع الباقة / المميزات المفتوحة:</label>
                <select
                  value={planTier}
                  onChange={(e) => setPlanTier(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="all">⭐ جميع المميزات (All Features / Full Access)</option>
                  <option value="developer">💻 باقة المطورين (Developer Tier)</option>
                  <option value="premium">💎 باقة المحترفين (Premium Tier)</option>
                  <option value="normal">📊 الباقة العادية (Standard Tier)</option>
                </select>
              </div>
            </div>

            {/* Duration & Limits Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              {/* Duration Options */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-emerald-500" />
                  مدة صلاحية الاشتراك للمستخدم:
                </label>
                <select
                  value={durationPreset}
                  onChange={(e) => setDurationPreset(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="7">أسبوع واحد (7 أيام)</option>
                  <option value="14">أسبوعين (14 يوم)</option>
                  <option value="30">شهر واحد (30 يوم)</option>
                  <option value="90">3 أشهر (90 يوم)</option>
                  <option value="365">سنة كاملة (365 يوم)</option>
                  <option value="1000">مفتوح / دائم (Lifetime)</option>
                  <option value="custom">مخصص (إدخال عدد الأيام)</option>
                </select>
                {durationPreset === 'custom' && (
                  <Input
                    type="number"
                    min="1"
                    placeholder="عدد الأيام"
                    value={customDays}
                    onChange={(e) => setCustomDays(parseInt(e.target.value) || 1)}
                    className="mt-1 font-mono text-xs bg-background"
                  />
                )}
              </div>

              {/* Max Redemptions */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-blue-500" />
                  أقصى عدد مرات التفعيل (Max Uses):
                </label>
                <select
                  value={maxUsesPreset}
                  onChange={(e) => setMaxUsesPreset(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="1">استخدام واحد (مستخدم شخصي واحد 1x)</option>
                  <option value="10">10 استخدامات</option>
                  <option value="50">50 استخدام</option>
                  <option value="100">100 استخدام (حملة تسويقية)</option>
                  <option value="unlimited">غير محدود (Unlimited)</option>
                </select>
              </div>

              {/* Expiry Date of Code itself */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-amber-500" />
                  مدة صلاحية رمز الكود نفسه:
                </label>
                <select
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(parseInt(e.target.value))}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value={7}>ينتهي بعد أسبوع (7 أيام)</option>
                  <option value={30}>ينتهي بعد شهر (30 يوم)</option>
                  <option value={90}>ينتهي بعد 3 أشهر (90 يوم)</option>
                  <option value={365}>ينتهي بعد سنة (365 يوم)</option>
                  <option value={0}>دائم بدون تاريخ انتهاء</option>
                </select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-2 px-6 shadow-sm"
              >
                {submitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                إنشاء وتفعيل الكود
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Promo Codes List Table */}
      <Card className="bg-card border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-teal-500" />
              سجل أكواد الخصم المفوضة ({codes.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">جاري تحميل الأكواد...</div>
          ) : codes.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              لا توجد أكواد خصم حالية. استخدم النموذج أعلاه لإنشاء كود جديد.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-muted/40 text-muted-foreground border-y border-border/60 font-bold">
                  <tr>
                    <th className="p-3">رمز الكود</th>
                    <th className="p-3">المميزات / الباقة</th>
                    <th className="p-3">مدة الاشتراط</th>
                    <th className="p-3">الاستخدامات (المُستهلك / الأقصى)</th>
                    <th className="p-3">صلاحية الكود</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {codes.map((item) => {
                    const tierInfo = getTierLabel(item.plan_tier);
                    const isExhausted = item.current_uses >= item.max_uses;
                    const isExpired = item.expires_at && new Date(item.expires_at).getTime() <= Date.now();

                    return (
                      <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                        {/* Code + Copy */}
                        <td className="p-3 font-mono font-black text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-foreground tracking-wider bg-muted/60 px-2 py-1 rounded border border-border">
                              {item.code}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(item.code)}
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              title="نسخ الكود"
                            >
                              {copiedCode === item.code ? (
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </Button>
                          </div>
                        </td>

                        {/* Tier */}
                        <td className="p-3">
                          <Badge variant="outline" className={cn('text-xs font-bold', tierInfo.color)}>
                            {tierInfo.label}
                          </Badge>
                        </td>

                        {/* Duration */}
                        <td className="p-3 font-semibold text-foreground">
                          {formatDays(item.premium_days)}
                        </td>

                        {/* Redemptions */}
                        <td className="p-3">
                          <div className="flex items-center gap-1.5 font-mono">
                            <span className={cn('font-bold', isExhausted ? 'text-rose-500' : 'text-emerald-500')}>
                              {item.current_uses}
                            </span>
                            <span className="text-muted-foreground">/</span>
                            <span className="text-foreground font-bold">
                              {item.max_uses >= 999999 ? '♾️' : item.max_uses}
                            </span>
                          </div>
                        </td>

                        {/* Expiry */}
                        <td className="p-3 text-[11px] text-muted-foreground">
                          {item.expires_at ? (
                            <span className={cn(isExpired && 'text-rose-500 font-bold')}>
                              {new Date(item.expires_at).toLocaleDateString('ar-EG')}
                            </span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">دائم</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="p-3">
                          {isExpired ? (
                            <Badge variant="outline" className="bg-rose-500/10 text-rose-500 border-rose-500/30">
                              منتهي الصلاحية
                            </Badge>
                          ) : isExhausted ? (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
                              مكتمل الاستخدام
                            </Badge>
                          ) : item.is_active ? (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                              مفعّل وفعّال
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-muted text-muted-foreground">
                              معطّل
                            </Badge>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleStatus(item.id, item.is_active)}
                              className={cn(
                                'h-7 px-2 text-xs font-semibold gap-1',
                                item.is_active ? 'text-amber-500 hover:bg-amber-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'
                              )}
                              title={item.is_active ? 'تعطيل الكود' : 'تفعيل الكود'}
                            >
                              <Power className="w-3.5 h-3.5" />
                              {item.is_active ? 'تعطيل' : 'تفعيل'}
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteCode(item.id, item.code)}
                              className="h-7 w-7 p-0 text-rose-500 hover:bg-rose-500/10"
                              title="حذف الكود"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
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
    </div>
  );
}
