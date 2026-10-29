/**
 * users-mgmt/UserDetailsDialog.tsx
 * =================================
 * User details dialog — renders basic info, promo-code section, activity
 * stats, usage stats (with top sections/features bar charts), preferences.
 *
 * Extracted from UsersManagement.tsx (1,543 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import {
  Activity,
  Bell,
  Calendar,
  Check,
  Clock,
  Copy,
  Mail,
  Ticket,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  formatDate,
  formatDateTime,
  getInitials,
  getRoleBadge,
  getStatusBadge,
  copyToClipboard,
} from './helpers';
import type { UserDetails } from './types';

export interface UserDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserDetails | null;
  copiedCode: string | null;
  onCopiedCode: (code: string | null) => void;
  onEditPromo: (user: UserDetails) => void;
  onRevokePromo: (userId: string) => void;
  onAskDelete: (user: UserDetails) => void;
}

export function UserDetailsDialog({
  open,
  onOpenChange,
  user,
  copiedCode,
  onCopiedCode,
  onEditPromo,
  onRevokePromo,
  onAskDelete,
}: UserDetailsDialogProps) {
  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user.image ?? undefined} />
              <AvatarFallback>
                {getInitials(user.name || '', user.email)}
              </AvatarFallback>
            </Avatar>
            {user.name || user.username}
            {getRoleBadge(user.role)}
            {getStatusBadge(user.status)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-muted-foreground">البريد الإلكتروني</Label>
              <p className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                {user.email}
                {user.emailVerified && (
                  <Badge variant="outline" className="text-profit text-xs">
                    موثق
                  </Badge>
                )}
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-muted-foreground">اسم المستخدم</Label>
              <p>@{user.username}</p>
            </div>

            <div className="space-y-1">
              <Label className="text-muted-foreground">تاريخ التسجيل</Label>
              <p className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                {formatDate(user.createdAt)}
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-muted-foreground">آخر تسجيل دخول</Label>
              <p className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'لم يسجل دخول بعد'}
              </p>
            </div>
          </div>

          {/* Promo Code Section */}
          <div className="rounded-xl border border-purple-500/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm flex items-center gap-2 text-primary">
                <Ticket className="w-4 h-4 text-primary" />
                بيانات كود الخصم والترقية (Promo Code)
              </h4>
              {user.promoCode ? (
                <Badge
                  className={
                    user.promoCode.is_active
                      ? 'bg-profit/20 text-profit border-profit/20'
                      : 'bg-loss/20 text-loss border-loss/20'
                  }
                >
                  {user.promoCode.is_active
                    ? `نشط (متبقي ${user.promoCode.days_left} يوم)`
                    : 'منتهي الصلاحية'}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  لا يوجد كود مفعل
                </Badge>
              )}
            </div>

            {user.promoCode ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
                <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 space-y-1">
                  <span className="text-muted-foreground block text-xs">رمز الكود</span>
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-sm text-foreground tracking-wider">
                      {user.promoCode.code}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(user.promoCode!.code, (c) => onCopiedCode(c))
                      }
                      className="h-6 w-6 p-0"
                    >
                      {copiedCode === user.promoCode.code ? (
                        <Check className="w-3 h-3 text-profit" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 space-y-1">
                  <span className="text-muted-foreground block text-xs">نوع وترقية الباقة</span>
                  <span className="font-bold text-foreground block">
                    {user.promoCode.plan_label}
                  </span>
                </div>

                <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 space-y-1">
                  <span className="text-muted-foreground block text-xs">المدة الممنوحة</span>
                  <span className="font-bold text-foreground block">
                    {user.promoCode.premium_days} يوم
                  </span>
                </div>

                <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 space-y-1">
                  <span className="text-muted-foreground block text-xs">تاريخ التفعيل</span>
                  <span className="text-foreground block">
                    {formatDate(user.promoCode.redeemed_at)}
                  </span>
                </div>

                <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 space-y-1">
                  <span className="text-muted-foreground block text-xs">تاريخ الانتهاء</span>
                  <span className="text-foreground block">
                    {user.promoCode.expires_at
                      ? formatDate(user.promoCode.expires_at)
                      : 'مفتوح / دائم'}
                  </span>
                </div>

                <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 text-primary border-purple-500/40 hover:bg-primary/10"
                    onClick={() => onEditPromo(user)}
                  >
                    تعديل
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 text-loss border-loss/20 hover:bg-loss/10"
                    onClick={() => onRevokePromo(user.id)}
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between bg-background/40 p-3 rounded-lg border border-border/60">
                <span className="text-xs text-muted-foreground">
                  هذا المستخدم يعمل بالباقة العادية بدون برومو كود.
                </span>
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary text-white text-xs h-8 gap-1.5"
                  onClick={() => onEditPromo(user)}
                >
                  <Ticket className="w-3.5 h-3.5" />
                  تفعيل برومو كود الآن
                </Button>
              </div>
            )}
          </div>

          <Separator />

          {/* Activity Stats */}
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              نشاط المستخدم
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold text-profit">
                  {user._count?.watchlist ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">قائمة المراقبة</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold text-primary">
                  {user._count?.portfolio ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">محفظة</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold text-warning">
                  {user._count?.alerts ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">تنبيهات</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold text-primary">
                  {user.loginCount ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">مرات الدخول</div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Usage Stats */}
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              إحصائيات الاستخدام
            </h4>
            {user.usage ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-primary">
                      {user.usage.pageViews}
                    </div>
                    <div className="text-xs text-muted-foreground">مشاهدات</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-warning">
                      {user.usage.featureUses}
                    </div>
                    <div className="text-xs text-muted-foreground">استخدام ميزات</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-loss">
                      {user.usage.errors}
                    </div>
                    <div className="text-xs text-muted-foreground">أخطاء</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-primary">
                      {user.usage.totalEvents}
                    </div>
                    <div className="text-xs text-muted-foreground">إجمالي الأحداث</div>
                  </div>
                </div>

                {user.usage.lastActive && (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    آخر نشاط: {new Date(user.usage.lastActive).toLocaleString('ar-EG')}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h5 className="text-sm font-medium mb-2">الأقسام الأكثر زيارة</h5>
                    {user.usage.topSections.length > 0 ? (
                      <div className="space-y-2">
                        {user.usage.topSections.map((section, idx) => {
                          const maxCount = Math.max(
                            ...user.usage!.topSections.map((s) => s.count),
                            1,
                          );
                          const pct = (section.count / maxCount) * 100;
                          return (
                            <div key={idx} className="space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <span className="truncate ml-2">{section.section || 'غير محدد'}</span>
                                <span className="text-xs text-muted-foreground">{section.count}</span>
                              </div>
                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">لا توجد بيانات</p>
                    )}
                  </div>
                  <div>
                    <h5 className="text-sm font-medium mb-2">الميزات الأكثر استخداماً</h5>
                    {user.usage.topFeatures.length > 0 ? (
                      <div className="space-y-2">
                        {user.usage.topFeatures.map((feature, idx) => {
                          const maxCount = Math.max(
                            ...user.usage!.topFeatures.map((f) => f.count),
                            1,
                          );
                          const pct = (feature.count / maxCount) * 100;
                          return (
                            <div key={idx} className="space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <span className="truncate ml-2">{feature.feature || 'غير محدد'}</span>
                                <span className="text-xs text-muted-foreground">{feature.count}</span>
                              </div>
                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-warning rounded-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">لا توجد بيانات</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">لا توجد بيانات استخدام متاحة</p>
            )}
          </div>

          <Separator />

          {/* Preferences */}
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Bell className="w-4 h-4" />
              الإعدادات
            </h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span>الإشعارات</span>
                <Badge variant={user.preferences?.notifications ? 'default' : 'secondary'}>
                  {user.preferences?.notifications ? 'مفعلة' : 'معطلة'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>الوضع الداكن</span>
                <Badge variant={user.preferences?.darkMode ? 'default' : 'secondary'}>
                  {user.preferences?.darkMode ? 'مفعلة' : 'معطلة'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>اللغة</span>
                <Badge variant="outline">
                  {user.preferences?.language === 'ar'
                    ? 'العربية'
                    : user.preferences?.language === 'en'
                      ? 'English'
                      : user.preferences?.language || 'غير محدد'}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onAskDelete(user);
            }}
          >
            <Trash2 className="w-4 h-4 ml-2" />
            حذف المستخدم
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
