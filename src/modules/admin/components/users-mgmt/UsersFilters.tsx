/**
 * users-mgmt/UsersFilters.tsx
 * ===========================
 * Filters bar — search input + role/status/promo selects + refresh button.
 * Lifted state pattern: container owns filter state, this is pure display.
 *
 * Extracted from UsersManagement.tsx (1,543 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface UsersFiltersProps {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  roleFilter: string;
  onRoleFilterChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  promoFilter: string;
  onPromoFilterChange: (v: string) => void;
  loading: boolean;
  onRefresh: () => void;
}

export function UsersFilters({
  searchQuery,
  onSearchChange,
  roleFilter,
  onRoleFilterChange,
  statusFilter,
  onStatusFilterChange,
  promoFilter,
  onPromoFilterChange,
  loading,
  onRefresh,
}: UsersFiltersProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="flex-1 relative w-full">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="البحث بالبريد أو الاسم أو كود الخصم..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pr-9"
            />
          </div>

          <Select value={roleFilter} onValueChange={onRoleFilterChange}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="الدور" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأدوار</SelectItem>
              <SelectItem value="user">مستخدم</SelectItem>
              <SelectItem value="premium">بريميوم</SelectItem>
              <SelectItem value="admin">مدير</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="الحالة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              <SelectItem value="active">نشط</SelectItem>
              <SelectItem value="inactive">غير نشط</SelectItem>
              <SelectItem value="suspended">موقوف</SelectItem>
            </SelectContent>
          </Select>

          <Select value={promoFilter} onValueChange={onPromoFilterChange}>
            <SelectTrigger className="w-48 border-purple-500/30">
              <SelectValue placeholder="فلتر البرومو كود" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل (مع وبدون كود)</SelectItem>
              <SelectItem value="with_promo">مشتركون ببرومو كود 🎟️</SelectItem>
              <SelectItem value="active_promo">كود نشط حالياً 🟢</SelectItem>
              <SelectItem value="expired_promo">كود منتهي الصلاحية 🔴</SelectItem>
              <SelectItem value="vip">كود VIP شامل ⭐</SelectItem>
              <SelectItem value="premium">كود المحترفين 🛡️</SelectItem>
              <SelectItem value="normal">كود عادي 📘</SelectItem>
              <SelectItem value="without_promo">بدون كود خصم ⚪</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={loading}
            title="تحديث البيانات"
            className="shrink-0"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
