/**
 * users-mgmt/AddUserDialog.tsx
 * ============================
 * Add-user dialog (visible state lifted to container).
 * Posts to /api/admin/users with {email, username, name, password, role}.
 *
 * Extracted from UsersManagement.tsx (1,543 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import { Loader2, UserPlus } from 'lucide-react';
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
  DialogTrigger,
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
type NewUserForm = any;

export interface AddUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newUser: NewUserForm;
  onUserChange: (user: NewUserForm) => void;
  onAdded: () => void;
}

export function AddUserDialog({
  open,
  onOpenChange,
  newUser,
  onUserChange,
  onAdded,
}: AddUserDialogProps) {
  const [isAdding, setIsAdding] = React.useState(false);

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.username || !newUser.password) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    setIsAdding(true);
    try {
      const res = await adminFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      const data = await res.json();

      if (data.success) {
        toast.success('تم إضافة المستخدم بنجاح');
        onOpenChange(false);
        onUserChange({
          email: '',
          username: '',
          name: '',
          password: '',
          role: 'user',
        });
        onAdded();
      } else {
        toast.error(data.error || 'فشل في إضافة المستخدم');
      }
    } catch (error) {
      toast.error('خطأ في إضافة المستخدم');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <UserPlus className="w-4 h-4" />
          إضافة مستخدم
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>إضافة مستخدم جديد</DialogTitle>
          <DialogDescription>أدخل بيانات المستخدم الجديد</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="email">البريد الإلكتروني *</Label>
            <Input
              id="email"
              type="email"
              value={newUser.email}
              onChange={(e) => onUserChange({ ...newUser, email: e.target.value })}
              placeholder="user@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">اسم المستخدم *</Label>
            <Input
              id="username"
              value={newUser.username}
              onChange={(e) => onUserChange({ ...newUser, username: e.target.value })}
              placeholder="username"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">الاسم الكامل</Label>
            <Input
              id="name"
              value={newUser.name}
              onChange={(e) => onUserChange({ ...newUser, name: e.target.value })}
              placeholder="الاسم الكامل"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">كلمة المرور *</Label>
            <Input
              id="password"
              type="password"
              value={newUser.password}
              onChange={(e) => onUserChange({ ...newUser, password: e.target.value })}
              placeholder="********"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">الدور</Label>
            <Select
              value={newUser.role}
              onValueChange={(value: 'user' | 'premium' | 'admin') =>
                onUserChange({ ...newUser, role: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">مستخدم عادي</SelectItem>
                <SelectItem value="premium">بريميوم</SelectItem>
                <SelectItem value="admin">مدير</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={handleAddUser} disabled={isAdding}>
            {isAdding ? (
              <>
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                جاري الإضافة...
              </>
            ) : (
              'إضافة'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
