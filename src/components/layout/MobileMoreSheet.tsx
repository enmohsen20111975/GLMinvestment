'use client';

/**
 * MobileMoreSheet — "أقسام أخرى" (Other Sections) quick-access sheet.
 * Triggered from the mobile Header (LayoutGrid / Menu icon button) so the
 * bottom navigation bar can stay at exactly 5 icons (P5-MOBILE-UX Part A).
 *
 * Renders the same items that previously lived inside the MobileNav "More"
 * menu (crypto, learning, simulation, about, watchlist, search,
 * notifications, account) plus a "العودة للرئيسية" entry point.
 *
 * Uses Zustand `mobileMoreOpen` state so any component can open it.
 */

import React, { useState } from 'react';
import {
  Search,
  X,
  Settings,
  GraduationCap,
  Gamepad2,
  User,
  Eye,
  Sparkles,
  LogIn,
  Bell,
  LayoutGrid,
  ShieldCheck,
  LifeBuoy,
  Newspaper,
  FileText,
  Microscope,
  Layers,
  Wallet,
  Calculator,
  Calendar,
  History,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useNotificationStore } from '@/lib/notification-store';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StockSelector } from '@/modules/stock-analysis/components/StockSelector';
import type { AppView } from '@/types';

/* Extra items shown inside the "More" menu */
const moreNavItems: Array<{ id: AppView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  // TASK 31-C — Disaster Stock Rescue: prominent entry at the top of the
  // mobile More sheet so users can find the screen the owner flagged as
  // hidden + weak.
  { id: 'bagholder-rescue', label: '🆘 إنقاذ سهم خسران', icon: LifeBuoy },
  { id: 'watchlist', label: 'قوائم المراقبة', icon: Eye },
  { id: 'news', label: 'الأخبار الاقتصادية', icon: Newspaper },
  { id: 'alerts-center', label: 'مركز التنبيهات', icon: Bell },
  { id: 'reports', label: 'التقارير', icon: FileText },
  { id: 'specialist-analysis', label: 'تحليل المتخصصين', icon: Microscope },
  { id: 'market-depth', label: 'عمق السوق', icon: Layers },
  { id: 'wealth', label: 'إدارة الثروة', icon: Wallet },
  { id: 'zakat', label: 'حاسبة الزكاة', icon: Calculator },
  { id: 'sharia', label: 'التوافق الشرعي', icon: ShieldCheck },
  { id: 'seasonality', label: 'الموسمية', icon: Calendar },
  { id: 'smart-confluence', label: 'التوافق الذكي', icon: Sparkles },
  { id: 'backtesting', label: 'الاختبار الخلفي', icon: History },
  { id: 'simulation', label: 'المحاكاة', icon: Gamepad2 },
  { id: 'academy', label: 'الأكاديمية', icon: GraduationCap },
  { id: 'about', label: 'من نحن', icon: Sparkles },
];

/**
 * Hook that exposes a stable open() function. Components can use this on
 * a button (e.g. inside the Header) without caring about implementation.
 */
export function useMobileMoreSheet() {
  const open = React.useCallback(() => {
    // Set state via store-less approach: dispatch a CustomEvent so any
    // MobileMoreSheet instance mounted anywhere can open itself.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('egx:open-mobile-more'));
    }
  }, []);
  return { open };
}

/**
 * Small icon button meant to live in the mobile Header. Triggers the sheet.
 */
export function MobileMoreButton({ className }: { className?: string }) {
  const { open } = useMobileMoreSheet();
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      onClick={open}
      className={cn('md:hidden flex-shrink-0', className)}
      aria-label="أقسام أخرى"
    >
      <LayoutGrid className="w-5 h-5" />
    </Button>
  );
}

export function MobileMoreSheet() {
  const { currentView, setCurrentView, setCurrentMarket, currentMarket, user } = useAppStore();
  const notifUnreadCount = useNotificationStore((s) => s.unreadCount);
  const openNotifPanel = useNotificationStore((s) => s.setOpen);
  const [open, setOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Listen for "egx:open-mobile-more" events dispatched by trigger buttons.
  React.useEffect(() => {
    function handler() { setOpen(true); }
    if (typeof window !== 'undefined') {
      window.addEventListener('egx:open-mobile-more', handler);
      return () => window.removeEventListener('egx:open-mobile-more', handler);
    }
    return undefined;
  }, []);

  const closeAll = () => {
    setOpen(false);
    setShowSearch(false);
  };

  if (!open && !showSearch) return null;

  return (
    <div className="fixed inset-0 z-40 md:hidden" dir="rtl" role="dialog" aria-modal="true" aria-label="أقسام أخرى">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 animate-in fade-in-0 duration-150"
        onClick={closeAll}
      />

      {/* Search panel (renders above the More sheet) */}
      {showSearch && (
        <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl border-t border-border shadow-2xl p-4 animate-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-semibold">بحث عن سهم</span>
            </div>
            <button
              onClick={() => setShowSearch(false)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <StockSelector
            placeholder="ابحث بالرمز أو الاسم..."
            onSelect={() => setShowSearch(false)}
          />
        </div>
      )}

      {/* More sheet */}
      {!showSearch && (
        <div className="absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl border-t border-border shadow-2xl p-4 max-h-[75vh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold">أقسام أخرى</span>
            <button
              onClick={closeAll}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-1">
            {/* Search */}
            <button
              onClick={() => setShowSearch(true)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted transition-colors text-right min-h-[44px]"
            >
              <Search className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm font-medium">بحث عن سهم</span>
            </button>

            {/* Notifications */}
            <button
              onClick={() => { openNotifPanel(true); closeAll(); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted transition-colors text-right min-h-[44px]"
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

            {/* Extra nav items (crypto, learning, simulation, about, watchlist) */}
            {moreNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    // UI-mirror protocol: crypto items force CRYPTO market
                    if (typeof item.id === 'string' && item.id.startsWith('crypto')) {
                      if (currentMarket !== 'CRYPTO') setCurrentMarket('CRYPTO');
                    } else if (['stocks','stock-detail','recommendations','watchlist','portfolio','dashboard'].includes(item.id)) {
                      if (currentMarket === 'CRYPTO') setCurrentMarket('EGX');
                    }
                    setCurrentView(item.id); closeAll();
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted transition-colors text-right min-h-[44px]',
                    currentView === item.id && 'bg-muted text-primary'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              );
            })}

            {/* Settings shortcut */}
            <button
              onClick={() => { setCurrentView('settings'); closeAll(); }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted transition-colors text-right min-h-[44px]',
                currentView === 'settings' && 'bg-muted text-primary'
              )}
            >
              <Settings className="w-5 h-5" />
              <span className="text-sm font-medium">الإعدادات</span>
            </button>

            {/* Account / Login */}
            <div className="my-2 border-t border-border" />
            <button
              onClick={() => { setCurrentView(user ? 'settings' : 'auth'); closeAll(); }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted transition-colors text-right min-h-[44px]',
                (currentView === 'auth') && 'bg-muted text-primary'
              )}
            >
              {user ? <User className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
              <span className="text-sm font-medium">{user ? 'حسابي' : 'تسجيل الدخول'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MobileMoreSheet;
