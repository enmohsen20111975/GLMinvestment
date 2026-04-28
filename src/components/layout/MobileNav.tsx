'use client';

import React, { useState } from 'react';
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  Eye,
  Brain,
  LogIn,
  Bell,
  Search,
  X,
  Menu,
  Settings,
  GraduationCap,
  Gamepad2,
  User,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useNotificationStore } from '@/lib/notification-store';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { StockSelector } from '@/components/stocks/StockSelector';
import type { AppView } from '@/types';

/* Main 5 tab items shown in the bottom bar */
const mainNavItems = [
  { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'stocks', label: 'الأسهم', icon: TrendingUp },
  { id: 'portfolio', label: 'المحفظة', icon: BarChart3 },
  { id: 'watchlist', label: 'المراقبة', icon: Eye },
  { id: 'recommendations', label: 'التحليلات', icon: Brain },
];

/* Extra items shown inside the "More" menu */
const moreNavItems = [
  { id: 'learning', label: 'تعلم', icon: GraduationCap },
  { id: 'simulation', label: 'محاكاة', icon: Gamepad2 },
  { id: 'settings', label: 'إعدادات', icon: Settings },
];

export function MobileNav() {
  const { currentView, setCurrentView, user } = useAppStore();
  const notifUnreadCount = useNotificationStore((s) => s.unreadCount);
  const openNotifPanel = useNotificationStore((s) => s.setOpen);
  const [showSearch, setShowSearch] = useState(false);
  const [showMore, setShowMore] = useState(false);

  return (
    <>
      {/* Search Overlay */}
      {showSearch && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 animate-in fade-in-0 duration-150"
            onClick={() => setShowSearch(false)}
          />
          <div className="absolute bottom-16 left-0 right-0 bg-background rounded-t-2xl border-t border-border shadow-2xl p-4 animate-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between mb-3" dir="rtl">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold">بحث عن سهم</span>
              </div>
              <button
                onClick={() => setShowSearch(false)}
                className="h-7 w-7 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <StockSelector
              placeholder="ابحث بالرمز أو الاسم..."
              onSelect={() => setShowSearch(false)}
            />
          </div>
        </div>
      )}

      {/* More Menu Overlay */}
      {showMore && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 animate-in fade-in-0 duration-150"
            onClick={() => setShowMore(false)}
          />
          <div className="absolute bottom-16 left-0 right-0 bg-card rounded-t-2xl border-t border-border shadow-2xl p-4 animate-in slide-in-from-bottom-4 duration-200" dir="rtl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">المزيد</span>
              <button
                onClick={() => setShowMore(false)}
                className="h-7 w-7 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              {/* Notifications */}
              <button
                onClick={() => { openNotifPanel(true); setShowMore(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors text-right"
              >
                <div className="relative">
                  <Bell className="w-5 h-5 text-muted-foreground" />
                  {notifUnreadCount > 0 && (
                    <Badge className="absolute -top-1.5 -left-2 h-3.5 min-w-3.5 px-1 text-[9px] bg-red-500 text-white border-0 animate-pulse">
                      {notifUnreadCount > 99 ? '99+' : notifUnreadCount}
                    </Badge>
                  )}
                </div>
                <span className="text-sm font-medium">الإشعارات</span>
                {notifUnreadCount > 0 && (
                  <Badge variant="secondary" className="mr-auto text-xs">{notifUnreadCount}</Badge>
                )}
              </button>
              {/* Extra nav items */}
              {moreNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setCurrentView(item.id as AppView); setShowMore(false); }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors text-right',
                      currentView === item.id && 'bg-muted text-primary'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar — 5 main + search + more + account */}
      <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-card/95 backdrop-blur-sm border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-center justify-around py-1.5">
          {/* Search */}
          <button
            onClick={() => setShowSearch(true)}
            className={cn(
              'flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-lg transition-colors',
              'text-muted-foreground hover:text-primary'
            )}
          >
            <Search className="w-5 h-5" />
            <span className="text-[10px] font-medium">بحث</span>
          </button>

          {/* 5 main tabs */}
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id as AppView)}
                className={cn(
                  'flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-lg transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          })}

          {/* More menu (notifications, learning, simulation, settings) */}
          <button
            onClick={() => setShowMore(true)}
            className={cn(
              'flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-lg transition-colors relative',
              'text-muted-foreground hover:text-primary'
            )}
          >
            <div className="relative">
              <Menu className="w-5 h-5" />
              {notifUnreadCount > 0 && (
                <Badge className="absolute -top-1.5 -left-2 h-3.5 min-w-3.5 px-1 text-[9px] bg-red-500 text-white border-0 animate-pulse">
                  {notifUnreadCount > 99 ? '99+' : notifUnreadCount}
                </Badge>
              )}
            </div>
            <span className="text-[10px] font-medium">المزيد</span>
          </button>

          {/* Account / Login */}
          <button
            onClick={() => setCurrentView(user ? 'settings' : 'auth')}
            className={cn(
              'flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-lg transition-colors',
              currentView === 'auth' || currentView === 'settings' ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            {user ? <User className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
            <span className="text-[10px] font-medium">{user ? 'حسابي' : 'دخول'}</span>
          </button>
        </div>
      </div>
    </>
  );
}
