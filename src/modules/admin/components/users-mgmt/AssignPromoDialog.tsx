/**
 * users-mgmt/AssignPromoDialog.tsx
 * =================================
 * Assign / update promo-code modal. POSTs {plan_tier, duration_days, code?}
 * to /api/admin/users/:id/promo. Triggered from the row dropdown or
 * from inside the user details dialog.
 *
 * Extracted from UsersManagement.tsx (1,543 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import { Loader2, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { toast } from 'sonner';
import { adminFetch } from './helpers';
import type { AvailablePromoCode, UserDetails } from './types';

export interface AssignPromoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUser: UserDetails | null;
  availablePromoCodes: AvailablePromoCode[];
  selectedPromoCode: string;
  onSelectedPromoCodeChange: (code: string) => void;
  customPromoTier: string;
  onCustomPromoTierChange: (tier: string) => void;
  customPromoDays: number;
  onCustomPromoDaysChange: (days: number) => void;
  customPromoCodeInput: string;
  onCustomPromoCodeInputChange: (code: string) => void;
  onAssigned: (updatedUser?: UserDetails) => void;
}

export function AssignPromoDialog({
  open,
  onOpenChange,
  targetUser,
  availablePromoCodes,
  selectedPromoCode,
  onSelectedPromoCodeChange,
  customPromoTier,
  onCustomPromoTierChange,
  customPromoDays,
  onCustomPromoDaysChange,
  customPromoCodeInput,
  onCustomPromoCodeInputChange,
  onAssigned,
}: AssignPromoDialogProps) {
  const [isAssigning, setIsAssigning] = React.useState(false);

  const handleAssignPromo = async () => {
    if (!targetUser) return;
    setIsAssigning(true);
    try {
      const payload: Record<string, unknown> = {
        plan_tier: customPromoTier,
        duration_days: customPromoDays,
      };
      if (selectedPromoCode && selectedPromoCode !== 'custom') {
        payload.code = selectedPromoCode;
      } else if (customPromoCodeInput.trim()) {
        payload.code = customPromoCodeInput.trim();
      }

      const res = await adminFetch(`/api/admin/users/${targetUser.id}/promo`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'تم تفعيل كود الخصم بنجاح');
        onOpenChange(false);
        onAssigned(
          data.promo
            ? {
                ...targetUser,
                promoCode: data.promo,
                role:
                  data.promo.plan_tier === 'developer' || data.promo.plan_tier === 'all'
                    ? 'user'
                    : 'premium',
              }
            : undefined,
        );
      } else {
        toast.error(data.error || 'فشل تفعيل كود الخصم');
      }
    } catch (e) {
      toast.error('حدث خطأ أثناء تفعيل كود الخصم');
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <Ticket className="w-5 h-5 text-primary" />
            تفعيل / تعديل برومو كود للمستخدم
          </DialogTitle>
          <DialogDescription className="text-xs">
            تطبيق ترقية فورية للمستخدم:{' '}
            <strong className="text-foreground font-mono">
              {targetUser?.username || targetUser?.email}
            </strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {/* Pick from existing active codes */}
          {availablePromoCodes.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">اختيار كود متاح مسبقاً</Label>
              <Select
                value={selectedPromoCode}
                onValueChange={(val) => {
                  onSelectedPromoCodeChange(val);
                  const found = availablePromoCodes.find((p) => p.code === val);
                  if (found) {
                    onCustomPromoTierChange(found.plan_tier || 'all');
                    onCustomPromoDaysChange(found.premium_days || 30);
                  }
                }}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="اختر كود من القائمة أو حدد كود مخصص" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">-- إنشاء أو كتابة كود مخصص --</SelectItem>
                  {availablePromoCodes.map((p) => (
                    <SelectItem key={p.id} value={p.code}>
                      <span className="font-mono font-bold">{p.code}</span> (
                      {p.plan_tier === 'all' || p.plan_tier === 'developer'
                        ? 'VIP شامل'
                        : p.plan_tier === 'premium'
                          ? 'محترفين'
                          : 'عادي'}{' '}
                      - {p.premium_days} يوم)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Custom code name */}
          {(selectedPromoCode === 'custom' ||
            selectedPromoCode === '' ||
            availablePromoCodes.length === 0) && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                رمز الكود (اختياري - اتركه فارغاً للتوليد التلقائي)
              </Label>
              <Input
                placeholder="مثال: VIP-SPECIAL2026"
                value={customPromoCodeInput}
                onChange={(e) =>
                  onCustomPromoCodeInputChange(e.target.value.toUpperCase().replace(/\s+/g, ''))
                }
                className="font-mono uppercase text-xs"
              />
            </div>
          )}

          {/* Plan Tier */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">نوع ومميزات الباقة</Label>
            <Select value={customPromoTier} onValueChange={onCustomPromoTierChange}>
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">VIP شامل (جميع الأسواق والمميزات كاملة)</SelectItem>
                <SelectItem value="premium">باقة المحترفين (Premium)</SelectItem>
                <SelectItem value="normal">الباقة العادية</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">مدة الصلاحية</Label>
            <Select
              value={String(customPromoDays)}
              onValueChange={(val) => onCustomPromoDaysChange(parseInt(val, 10))}
            >
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">أسبوع واحد (7 أيام)</SelectItem>
                <SelectItem value="14">أسبوعين (14 يوم)</SelectItem>
                <SelectItem value="30">شهر كامل (30 يوم)</SelectItem>
                <SelectItem value="90">3 أشهر (90 يوم)</SelectItem>
                <SelectItem value="180">6 أشهر (180 يوم)</SelectItem>
                <SelectItem value="365">سنة كاملة (365 يوم)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            size="sm"
            onClick={handleAssignPromo}
            disabled={isAssigning}
            className="bg-primary hover:bg-primary text-white font-bold gap-1.5"
          >
            {isAssigning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري التفعيل...
              </>
            ) : (
              <>
                <Ticket className="w-4 h-4" />
                تفعيل وترقية المستخدم
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
