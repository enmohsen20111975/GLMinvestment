'use client';

import React from 'react';
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  Eye,
  Brain,
  FileBarChart,
  GraduationCap,
  Settings,
  LogIn,
  LogOut,
  ChevronRight,
  ChevronLeft,
  CandlestickChart,
  User,
  Gamepad2,
  Shield,
  Wallet,
  SearchCode,
  Crown,
} from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { useAppStore } from '@/lib/store';
import { useNotificationStore } from '@/lib/notification-store';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { isAdmin } from '@/lib/admin-auth';
import { cn } from '@/lib/utils';

const navItems = [
  { id: 'dashboard' as const, label: 'لوحة التحكم', labelEn: 'Dashboard', icon: LayoutDashboard },
  { id: 'stocks' as const, label: 'الأسهم', labelEn: 'Stocks', icon: CandlestickChart },
  { id: 'portfolio' as const, label: 'المحفظة', labelEn: 'Portfolio', icon: BarChart3 },
  { id: 'watchlist' as const, label: 'قائمة المراقبة', labelEn: 'Watchlist', icon: Eye },
  { id: 'finance' as const, label: 'المحفظة المالية', labelEn: 'Finance', icon: Wallet },
  { id: 'recommendations' as const, label: 'التحليلات', labelEn: 'Analyses', icon: Brain },
  { id: 'analysis' as const, label: 'تحليل شامل', labelEn: 'Deep Analysis', icon: SearchCode },
  { id: 'reports' as const, label: 'التقارير', labelEn: 'Reports', icon: FileBarChart },
  { id: 'learning' as const, label: 'مركز التعلم', labelEn: 'Learning', icon: GraduationCap },
  { id: 'simulation' as const, label: 'المحاكاة', labelEn: 'Simulation', icon: Gamepad2 },
  { id: 'subscription' as const, label: 'الباقات والاشتراكات', labelEn: 'Subscription', icon: Crown },
  { id: 'settings' as const, label: 'الإعدادات', labelEn: 'Settings', icon: Settings },
];

export function Sidebar() {
  const { data: session } = useSession();
  const { currentView, setCurrentView, sidebarOpen, toggleSidebar, logout, user } = useAppStore();
  const openNotificationPanel = useNotificationStore((s) => s.setOpen);
  // Prefer session user data if available, fall back to store user
  const displayName = user?.username || (session?.user?.name || '');
  const displayEmail = user?.email || (session?.user?.email || '');
  const isLoggedIn = !!user || session?.status === 'authenticated';

  const handleNav = (viewId: string) => {
    setCurrentView(viewId as AppView);
  };

  const handleLogout = async () => {
    // Clear local store state
    logout();
    // Sign out from NextAuth (clears JWT session + cookies)
    await signOut({ redirect: false });
  };

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      <aside
        className={cn(
          'fixed top-0 right-0 z-50 h-full bg-card border-l border-border transition-all duration-300 flex flex-col',
          'w-64',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0 lg:w-16'
        )}
        dir="rtl"
      >
        {/* Logo */}
        <div className="flex items-center gap-3 p-4 border-b border-border min-h-[64px]">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-foreground truncate">منصة استثمار EGX</h1>
              <p className="text-[10px] text-muted-foreground truncate">Egyptian Investment Platform</p>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            className="mr-auto lg:hidden p-1.5 rounded-md hover:bg-muted transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}

          {/* Admin link — only visible to admin users */}
          {isAdmin(displayEmail) && (
            <div className="pt-2 mt-2 border-t border-border">
              <button
                onClick={() => handleNav('admin')}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm',
                  currentView === 'admin'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                )}
              >
                <Shield className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span className="truncate">لوحة الإدارة</span>}
              </button>
            </div>
          )}
        </nav>

        {/* User Info */}
        <div className="px-2 py-1.5 border-t border-border">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/50">
            {session?.user?.image ? (
              <img
                src={session.user.image}
                alt={displayName}
                className="w-7 h-7 rounded-full flex-shrink-0 object-cover"
              />
            ) : (
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
                isLoggedIn
                  ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                  : 'bg-gradient-to-br from-gray-400 to-gray-500'
              )}>
                {isLoggedIn ? (
                  <span className="text-white text-[10px] font-bold">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <User className="w-3.5 h-3.5 text-white" />
                )}
              </div>
            )}
            {sidebarOpen && (
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground truncate">
                  {isLoggedIn ? displayName : 'زائر'}
                </p>
                <p className="text-[9px] text-muted-foreground truncate">
                  {isLoggedIn ? displayEmail : 'سجل دخولك للميزات الكاملة'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Notifications & Auth */}
        <div className="p-2 border-t border-border space-y-1">
          {/* Notifications */}
          <NotificationBell onOpenPanel={() => openNotificationPanel(true)} />

          {/* Auth */}
          {isLoggedIn ? (
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
            >
              <LogOut className="w-5 h-5" />
              {sidebarOpen && <span>تسجيل الخروج</span>}
            </button>
          ) : (
            <button
              onClick={() => setCurrentView('auth')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
            >
              <LogIn className="w-5 h-5" />
              {sidebarOpen && <span>تسجيل الدخول</span>}
            </button>
          )}
        </div>

        {/* Toggle button (desktop) */}
        <button
          onClick={toggleSidebar}
          className="hidden lg:flex items-center justify-center p-2 border-t border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          {sidebarOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>
    </>
  );
}

// Need to import AppView type
import type { AppView } from '@/types';
