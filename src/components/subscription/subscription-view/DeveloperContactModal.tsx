/**
 * subscription-view/DeveloperContactModal.tsx
 * ==========================================
 * Modal overlay for the Developer / Enterprise plan contact form. Captures
 * email + name + company + use-case + plan + billing period, posts to
 * /api/subscription/developer-request, and falls back to a mailto: link if
 * the API endpoint fails.
 */
'use client';

import React, { useState } from 'react';
import { Key, Mail, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Plan } from './types';

export interface DeveloperContactModalProps {
  plan: Plan;
  billingPeriod: 'monthly' | 'yearly';
  onClose: () => void;
}

export function DeveloperContactModal({ plan, billingPeriod, onClose }: DeveloperContactModalProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [useCase, setUseCase] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!email) {
      toast.error('يرجى إدخال البريد الإلكتروني');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/subscription/developer-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name,
          company,
          useCase,
          plan: plan.id,
          billingPeriod,
          price: billingPeriod === 'yearly' ? plan.priceYearly : plan.price,
        }),
      });

      if (response.ok) {
        toast.success('تم استلام طلبك! سنتواصل معك قريباً 📧');
        onClose();
      } else {
        const subject = encodeURIComponent(`طلب اشتراك باقة المطورين - ${plan.nameAr}`);
        const body = encodeURIComponent(
          `الاسم: ${name}\n` +
          `البريد: ${email}\n` +
          `الشركة: ${company}\n` +
          `حالة الاستخدام: ${useCase}\n` +
          `الباقة: ${plan.nameAr}\n` +
          `الفترة: ${billingPeriod === 'yearly' ? 'سنوي' : 'شهري'}`
        );
        window.location.href = `mailto:support@glminvestment.com?subject=${subject}&body=${body}`;
      }
    } catch (error) {
      console.error('Developer request error:', error);
      toast.error('حدث خطأ، يرجى المحاولة مرة أخرى');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto border-2 border-violet-500/40">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl from-violet-500 to-purple-600 flex items-center justify-center mb-3 shadow-lg shadow-violet-500/30">
            <Key className="w-7 h-7 text-foreground" />
          </div>
          <CardTitle className="text-xl font-bold">باقة الشركات والمطورين (Enterprise & API)</CardTitle>
          <CardDescription className="text-xs">
            حلول مخصصة للشركات والوسطاء الماليين مع وصول API فائق السرعة
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/40 rounded-xl p-3 text-xs space-y-1.5 border">
            <p className="font-bold">مميزات باقة المطورين:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>• وصول كامل لـ API لجميع الأسواق (مصر، تداول، كويت، قطر، أمريكا، كريبتو)</li>
              <li>• Webhooks فورية لإشارات السيولة والتنبيهات</li>
              <li>• Rate Limit عالي مع مفاتيح متعددة (API Keys)</li>
              <li>• تصدير قواعد البيانات والتقارير المالية</li>
              <li>• مدير حساب مخصص ودعم فني مباشر للمؤسسات</li>
            </ul>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold mb-1 block">البريد الإلكتروني *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="developer@company.com"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-xs"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">الاسم</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="اسمك الكريم"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">اسم الشركة / المؤسسة</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="اسم شركتك"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">طبيعة الاستخدام ونطاق العمل</label>
              <textarea
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
                placeholder="كيف تخطط لاستخدام الـ API والخدمات المالية؟"
                className="w-full px-3 py-2 rounded-lg border bg-background text-foreground min-h-[70px] text-xs"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1 text-xs" onClick={onClose} disabled={submitting}>
              إلغاء
            </Button>
            <Button
              className="flex-1 from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-foreground font-bold text-xs"
              onClick={handleSubmit}
              disabled={submitting || !email}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <Mail className="w-4 h-4 ml-2" />
              )}
              {submitting ? 'جاري الإرسال...' : 'إرسال طلب الانضمام'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
