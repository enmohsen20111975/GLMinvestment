'use client';

import React, { useState } from 'react';
import {
  Settings as SettingsIcon,
  User,
  Shield,
  Globe,
  Info,
  ChevronLeft,
  ShieldAlert,
  ShieldCheck,
  ShieldMinus,
  Save,
  Download,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { DataManager } from '@/components/reports/DataManager';
import { AdminPanel } from '@/components/admin/AdminPanel';

export function SettingsView() {
  const { user } = useAppStore();
  const [riskTolerance, setRiskTolerance] = useState(user?.default_risk_tolerance || 'medium');
  const [language, setLanguage] = useState('ar');
  const handleSave = () => {
    toast.success('تم حفظ الإعدادات بنجاح');
  };

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
                {user?.subscription_tier && (
                  <Badge variant="secondary" className="mt-1 text-xs">
                    {user.subscription_tier === 'free' ? 'مجاني' : user.subscription_tier === 'pro' ? 'احترافي' : 'مميز'}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Risk Tolerance */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base">تحمل المخاطر</CardTitle>
            </div>
            <CardDescription>حدد مستوى المخاطر المناسب لاستثماراتك</CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={riskTolerance}
              onValueChange={setRiskTolerance}
              className="space-y-3"
            >
              {/* Low Risk */}
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer">
                <RadioGroupItem value="low" id="risk-low" />
                <Label htmlFor="risk-low" className="flex items-center gap-3 flex-1 cursor-pointer">
                  <ShieldCheck className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">منخفض</p>
                    <p className="text-xs text-muted-foreground">استثمارات محافظة مع عوائد ثابتة</p>
                  </div>
                </Label>
              </div>

              {/* Medium Risk */}
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer">
                <RadioGroupItem value="medium" id="risk-medium" />
                <Label htmlFor="risk-medium" className="flex items-center gap-3 flex-1 cursor-pointer">
                  <ShieldMinus className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">متوسط</p>
                    <p className="text-xs text-muted-foreground">توازن بين العوائد والمخاطر</p>
                  </div>
                </Label>
              </div>

              {/* High Risk */}
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer">
                <RadioGroupItem value="high" id="risk-high" />
                <Label htmlFor="risk-high" className="flex items-center gap-3 flex-1 cursor-pointer">
                  <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">مرتفع</p>
                    <p className="text-xs text-muted-foreground">استثمارات جريئة مع عوائد أعلى محتملة</p>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

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

        {/* Admin Panel */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base">لوحة الإدارة</CardTitle>
            </div>
            <CardDescription>إدارة أسعار الذهب والعملات والتحليلات (يتطلب كلمة مرور)</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminPanel />
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
                <span className="text-sm font-medium">منصة استثمار EGX</span>
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
