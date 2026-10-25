/**
 * subscription-view/TopBar.tsx
 * ==========================
 * Sticky top bar with the dismiss button ("إغلاق والعودة للمنصة"), the
 * "تخطي وتجربة المنصة" hint, and the auth / welcome badge (login button if
 * logged-out, "مرحباً {username}" badge if logged-in).
 */
'use client';

import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import type { User as AppUser } from '@/types';

export interface TopBarProps {
  isLoggedIn: boolean;
  user: AppUser | null;
  onDismiss: () => void;
  onGoAuth: () => void;
}

export function TopBar({ isLoggedIn, user, onDismiss, onGoAuth }: TopBarProps) {
  return (
    <div className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border/80 px-4 py-2.5 shadow-sm">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onDismiss}
            className="gap-2 border-profit/20 hover:bg-profit/10 text-white font-bold transition-all shadow-sm"
            title="إغلاق والعودة للشاشة السابقة"
          >
            <X className="w-4 h-4 text-profit" />
            <span>إغلاق والعودة للمنصة</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onDismiss();
              toast.info('يمكنك تصفح المنصة وتجربة التحليلات والأسهم مجاناً');
            }}
            className="text-xs text-muted-foreground hover:text-foreground hidden sm:flex"
          >
            تخطي وتجربة المنصة
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {!isLoggedIn ? (
            <Button
              variant="default"
              size="sm"
              onClick={onGoAuth}
              className="bg-profit hover:bg-profit text-white gap-1.5 text-xs font-bold shadow-md shadow-emerald-600/20"
            >
              <span>تسجيل الدخول / إنشاء حساب</span>
            </Button>
          ) : (
            <Badge variant="outline" className="text-xs border-profit/20 text-profit bg-profit/5">
              مرحباً {user?.username || user?.email?.split('@')[0]}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
