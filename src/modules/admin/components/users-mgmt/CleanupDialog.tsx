/**
 * users-mgmt/CleanupDialog.tsx
 * ============================
 * Cleanup-expired-users dialog. POSTs {dryRun} to
 * /api/admin/users/cleanup-expired. Triggered from the cleanup button
 * in the header row.
 *
 * Extracted from UsersManagement.tsx (1,543 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { adminFetch } from './helpers';

export interface CleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

export function CleanupDialog({ open, onOpenChange, onDone }: CleanupDialogProps) {
  const [isCleaningUp, setIsCleaningUp] = React.useState(false);

  const handleCleanupExpired = async (dryRun = false) => {
    setIsCleaningUp(true);
    try {
      const res = await adminFetch('/api/admin/users/cleanup-expired', {
        method: 'POST',
        body: JSON.stringify({ dryRun: dryRun ? true : false }),
      });
      const data = await res.json();

      if (data.success) {
        if (dryRun && data.users?.length > 0) {
          toast.success(`سيتم حذف ${data.users.length} مستخدم. قم بتشغيل العملية بدون dryRun للحذف الفعلي.`);
        } else if (!dryRun) {
          toast.success(data.message || 'تم تنظيف المستخدمين منتهي الفترة');
          onDone();
        } else {
          toast.success(data.message || 'لا يوجد مستخدمين للحذف');
        }
      } else {
        toast.error(data.error || 'فشل في التنظيف');
      }
    } catch (error) {
      toast.error('خطأ في التنظيف');
    } finally {
      setIsCleaningUp(false);
      onOpenChange(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="gap-2" onClick={() => onOpenChange(true)}>
        <Trash2 className="w-4 h-4" />
        تنظيف المنتهي الفترة
      </Button>

      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تنظيف المستخدمين منتهي الفترة</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف جميع المستخدمين المجانيين الذين انتهت فترة تجربتهم (30 يوم + 7 يوم تحذير) ولم يشتركوا.
              <br />
              <span className="text-loss text-sm">هذا الإجراء سيحذف بياناتهم نهائياً من كل قواعد البيانات ولا يمكن التراجع عنه.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <Button variant="outline" onClick={() => handleCleanupExpired(true)} disabled={isCleaningUp}>
              معاينة
            </Button>
            <AlertDialogAction
              onClick={() => handleCleanupExpired(false)}
              disabled={isCleaningUp}
              className="bg-loss hover:bg-loss"
            >
              {isCleaningUp ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  جاري الحذف...
                </>
              ) : (
                'حذف نهائي'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
