'use client';

/**
 * Header — شريط الترويسة الموحد (Sovereign Terminal)
 * =================================================================
 * بناء هيكلي حقيقي per stitch_full_website_ui_design/_1/code.html
 * + trial_account_header/code.html
 *
 * Rule 1: Stitch Canvas + glassmorphic header (backdrop-blur-md)
 * Rule 2: No state changes — all hooks/props preserved
 * Rule 3: font-financial (JetBrains Mono) on currency/numbers
 * Rule 4: Live pulse dot on telemetry
 */

import React, { useState, useEffect } from 'react';
import { Search, Menu, RefreshCw, Bell, Sun, Moon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useAppStore } from '@/lib/store';
import type { DisplayCurrency } from '@/lib/store';
import { useNotificationStore } from '@/lib/notification-store';
import { MobileMoreButton } from '@/components/layout/MobileMoreSheet';
import { cn } from '@/lib/utils';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const { toggleSidebar, searchQuery, setSearchQuery, setCurrentView, loadDashboard } = useAppStore();
  const { displayCurrency, setDisplayCurrency } = useAppStore();
  const [searchFocused, setSearchFocused] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  void searchFocused;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) { setCurrentView('stocks'); }
  };

  return (
    <header
      className="sticky top-0 z-30 bg-[#0B0E14]/95 backdrop-blur-md border-b border-white/[0.06] shadow-[0_1px_8px_rgba(0,0,0,0.45)]"
      dir="rtl"
    >
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3">
        {/* Mobile "More" sections button */}
        <MobileMoreButton />

        {/* Sidebar toggle */}
        <button
          className="flex-shrink-0 p-2 rounded-lg bg-[#111622]/80 hover:bg-[#182030] text-stitch-on-surface border border-white/[0.06] transition-colors"
          onClick={toggleSidebar}
          aria-label="القائمة الجانبية"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="min-w-0 mr-auto">
          <h2 className="stitch-latin text-base sm:text-lg font-bold text-stitch-on-surface truncate">{title}</h2>
          {subtitle && (
            <p className="stitch-num text-xs text-stitch-primary truncate">{subtitle}</p>
          )}
        </div>

        {/* Dark/Light mode toggle */}
        {mounted && (
          <button
            className="flex-shrink-0 p-2 rounded-lg bg-[#111622]/80 hover:bg-[#182030] text-stitch-on-surface border border-white/[0.06] transition-colors"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label={resolvedTheme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Display Currency Toggle (EGP / USD / SAR) */}
        {mounted && (
          <div
            role="group"
            aria-label="عملة العرض"
            title="عملة العرض"
            className="flex items-center rounded-md border border-white/[0.06] overflow-hidden flex-shrink-0 bg-[#111622]/80"
          >
            {([
              { code: 'EGP' as DisplayCurrency, label: 'ج.م', title: 'الجنيه المصري' },
              { code: 'USD' as DisplayCurrency, label: '$', title: 'الدولار الأمريكي' },
              { code: 'SAR' as DisplayCurrency, label: 'ر.س', title: 'الريال السعودي' },
            ]).map((opt) => {
              const active = displayCurrency === opt.code;
              return (
                <button
                  key={opt.code}
                  type="button"
                  onClick={() => setDisplayCurrency(opt.code)}
                  aria-pressed={active}
                  aria-label={`عرض بال${opt.title}`}
                  title={`عرض بال${opt.title}`}
                  className={cn(
                    'stitch-num h-7 px-2 text-xs font-medium leading-none transition-colors',
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'bg-transparent text-stitch-muted hover:bg-[#182030] hover:text-stitch-on-surface',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Search */}
        <form onSubmit={handleSearch} className="relative hidden sm:block">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stitch-outline" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            placeholder="ابحث عن سهم..."
            className="stitch-ar w-48 md:w-64 pr-9 h-9 text-sm rounded-lg bg-[#111622]/80 border border-white/[0.06] text-stitch-on-surface placeholder:text-stitch-outline focus:outline-none focus:border-emerald-500/50"
            dir="rtl"
          />
        </form>

        {/* Notifications */}
        <HeaderNotificationBell />

        {/* Refresh */}
        <button
          className="flex-shrink-0 hidden sm:flex p-2 rounded-lg bg-[#111622]/80 hover:bg-[#182030] text-stitch-on-surface border border-white/[0.06] transition-colors"
          onClick={() => { loadDashboard(); }}
          aria-label="تحديث"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

function HeaderNotificationBell() {
  const { unreadCount, setOpen } = useNotificationStore();

  return (
    <button
      className="flex-shrink-0 relative p-2 rounded-lg bg-[#111622]/80 hover:bg-[#182030] text-stitch-on-surface border border-white/[0.06] transition-colors"
      onClick={() => setOpen(true)}
      aria-label="الإشعارات"
    >
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <span className="stitch-num absolute -top-0.5 -left-0.5 h-4 min-w-4 px-1 text-[9px] bg-rose-500 text-white border border-[#0B0E14] rounded-full animate-pulse flex items-center justify-center">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
