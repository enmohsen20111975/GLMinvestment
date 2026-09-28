'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  User,
  Shield,
  Globe,
  Info,
  ChevronLeft,
  Save,
  Download,
  Crown,
  Zap,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { DataManager } from '@/modules/reports/components/DataManager';
import { SubscriptionView } from '@/components/subscription/SubscriptionView';
import { PersonaSelector, usePersona, PERSONAS } from '@/components/persona/PersonaSelector';

export function SettingsView() {
  const { user, setCurrentView } = useAppStore();
  const { personaId, personaInfo } = usePersona();
  const [language, setLanguage] = useState('ar');
  const [showSubscription, setShowSubscription] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<{name: string; name_ar: string} | null>(null);

  // Fetch current subscription
  useEffect(() => {
    if (user) {
      fetch('/api/subscription/current')
        .then(res => res.json())
        .then(data => {
          if (data.success && data.subscription) {
            setCurrentPlan({
              name: data.subscription.plan_name,
              name_ar: data.subscription.plan_name_ar,
            });
          }
        })
        .catch(() => {});
    }
  }, [user]);

  const handleSave = () => {
    toast.success('تم حفظ الإعدادات بنجاح');
  };

  // If showing subscription view
  if (showSubscription) {
    return (
      <div dir="rtl" className="min-h-screen bg-background">
        <div className="p-4 md:p-6 max-w-2xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => setShowSubscription(false)}
            className="mb-4 gap-2"
          >
            <ChevronLeft className="w-4 h-4" />
            العودة للإعدادات
          </Button>
          <SubscriptionView />
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <Header title="الإعدادات" subtitle="تخصيص تجربتك" />
      <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
        {/* Profile Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base">الملف الشخصي</CardTitle>
            </div>
            <CardDescription>معلومات حسابك الأساسية</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                <span className="text-xl font-bold text-white">
                  {user?.username?.charAt(0).toUpperCase() || 'م'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg">{user?.username || 'مستخدم زائر'}</h3>
                <p className="text-sm text-muted-foreground truncate">
                  {user?.email || 'لم يتم تسجيل الدخول'}
                </p>
                {(currentPlan || user?.subscription_tier) && (
                  <Badge variant="secondary" className="mt-1 text-xs gap-1">
                    <Zap className="w-3 h-3" />
                    {currentPlan?.name_ar || (user?.subscription_tier === 'free' ? 'مجاني' : user?.subscription_tier === 'normal' ? 'عادي' : user?.subscription_tier === 'premium' ? 'مميز' : 'مجاني')}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subscription Section */}
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base">الاشتراك والباقات</CardTitle>
            </div>
            <CardDescription>إدارة اشتراكك والترقية لباقات أعلى</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <p className="text-sm font-medium">باقتك الحالية</p>
                <p className="text-xs text-muted-foreground">
                  {currentPlan?.name_ar || (user?.subscription_tier === 'free' ? 'مجاني' : user?.subscription_tier === 'normal' ? 'عادي' : user?.subscription_tier === 'premium' ? 'مميز' : 'مجاني')}
                </p>
              </div>
              <Button
                onClick={() => setShowSubscription(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                <Crown className="w-4 h-4" />
                عرض الباقات
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Investor Persona Selection — UNIFIED-BALANCED-ONLY: متعطل */}
        {/* النظام بيشتغل بـ Balanced فقط — مش محتاج اختيار شخصية */}

        {/* Language */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base">اللغة</CardTitle>
            </div>
            <CardDescription>اختر لغة واجهة التطبيق</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-3 rounded-lg border border-border">
              <span className="text-sm font-medium">لغة العرض</span>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ar">العربية</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base">إدارة البيانات</CardTitle>
            </div>
            <CardDescription>تصدير بيانات الأسهم والتحليلات (للاشتراكات المدفوعة)</CardDescription>
          </CardHeader>
          <CardContent>
            <DataManager />
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base">حول التطبيق</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-muted-foreground">اسم التطبيق</span>
                <span className="text-sm font-medium">دليل الاستثمار</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-muted-foreground">الإصدار</span>
                <Badge variant="outline">v1.0.0</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-muted-foreground">البورصة</span>
                <span className="text-sm font-medium">البورصة المصرية (EGX)</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-muted-foreground">آخر تحديث</span>
                <span className="text-sm text-muted-foreground">2026</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <Button
          onClick={handleSave}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-5 text-sm font-semibold"
        >
          <Save className="w-4 h-4 ml-2" />
          حفظ الإعدادات
        </Button>
      </div>
    </div>
  );
}
