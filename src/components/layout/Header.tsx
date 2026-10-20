'use client';

import React, { useState, useEffect } from 'react';
import { Search, Menu, RefreshCw, Bell, Sun, Moon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useAppStore } from '@/lib/store';
import type { DisplayCurrency } from '@/lib/store';
import { useNotificationStore } from '@/lib/notification-store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
// // PersonaSelector import — UNIFIED-BALANCED-ONLY: معطل
import { MobileMoreButton } from '@/components/layout/MobileMoreSheet';

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

 // Fix hydration error - only render theme-dependent content after mount
 useEffect(() => {
 setMounted(true);
 }, []);

 // Acknowledge focus state (used to control future autocomplete dropdown)
 void searchFocused;

 const handleSearch = (e: React.FormEvent) => {
 e.preventDefault();
 if (searchQuery.trim()) {
 setCurrentView('stocks');
 }
 };

 return (
 <header className="sticky top-0 z-30 glass-header">
 <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3">
 {/* Mobile "More" sections button — replaces the bottom bar's 6th item (P5-MOBILE-UX) */}
 <MobileMoreButton />

 {/* Sidebar toggle — visible on ALL screens (was hidden md:flex) */}
 <Button
 variant="ghost"
 size="icon"
 className="flex-shrink-0"
 onClick={toggleSidebar}
 aria-label="القائمة الجانبية"
 >
 <Menu className="w-5 h-5" />
 </Button>

 {/* Title */}
 <div className="min-w-0 mr-auto">
 <h2 className="text-base sm:text-lg font-bold text-foreground truncate">{title}</h2>
 {subtitle && (
 <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
 )}
 </div>

 {/* Persona Selector - Compact */}
 <div className="hidden md:block">
 {/* PersonaSelector — معطل */}
 </div>

 {/* Dark/Light mode toggle - only render after mount to avoid hydration error */}
 {mounted && (
 <Button
 variant="ghost"
 size="icon"
 className="flex-shrink-0"
 onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
 aria-label={resolvedTheme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
 >
 {resolvedTheme === 'dark' ? (
 <Sun className="w-4 h-4 text-warning" />
 ) : (
 <Moon className="w-4 h-4" />
 )}
 </Button>
 )}

 {/* P37-PHASE-2A: Display Currency Toggle (EGP / USD / SAR) — inlined
 to avoid any HMR/function-resolution issue. */}
 {mounted && (
 <div
 role="group"
 aria-label="عملة العرض"
 title="عملة العرض"
 className="flex items-center rounded-md border border-border overflow-hidden flex-shrink-0"
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
 className={
 'h-7 px-2 text-xs font-medium leading-none transition-colors ' +
 (active
 ? 'bg-primary text-primary-foreground'
 : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground')
 }
 >
 {opt.label}
 </button>
 );
 })}
 </div>
 )}

 {/* Search */}
 <form onSubmit={handleSearch} className="relative hidden sm:block">
 <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
 <Input
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 onFocus={() => setSearchFocused(true)}
 onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
 placeholder="ابحث عن سهم..."
 className="w-48 md:w-64 pr-9 h-9 text-sm"
 dir="rtl"
 />
 </form>

 {/* Notifications */}
 <HeaderNotificationBell />

 {/* Refresh */}
 <Button
 variant="ghost"
 size="icon"
 className="flex-shrink-0 hidden sm:flex"
 onClick={() => {
 loadDashboard();
 }}
 aria-label="تحديث"
 >
 <RefreshCw className="w-4 h-4" />
 </Button>
 </div>
 </header>
 );
}

/** P37-PHASE-2A: Compact 3-button segmented control for display currency.
 * Short codes fit on every screen size (mobile + desktop). */
function DisplayCurrencyToggle({
 value,
 onChange,
}: {
 value: DisplayCurrency;
 onChange: (c: DisplayCurrency) => void;
}) {
 const options: { code: DisplayCurrency; label: string; title: string }[] = [
 { code: 'EGP', label: 'ج.م', title: 'الجنيه المصري' },
 { code: 'USD', label: '$', title: 'الدولار الأمريكي' },
 { code: 'SAR', label: 'ر.س', title: 'الريال السعودي' },
 ];

 return (
 <div
 role="group"
 aria-label="عملة العرض"
 title="عملة العرض"
 className="flex items-center rounded-md border border-border overflow-hidden flex-shrink-0"
 >
 {options.map((opt) => {
 const active = value === opt.code;
 return (
 <button
 key={opt.code}
 type="button"
 onClick={() => onChange(opt.code)}
 aria-pressed={active}
 aria-label={`عرض بال${opt.title}`}
 title={`عرض بال${opt.title}`}
 className={
 'h-7 px-2 text-xs font-medium leading-none transition-colors ' +
 (active
 ? 'bg-primary text-primary-foreground'
 : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground')
 }
 >
 {opt.label}
 </button>
 );
 })}
 </div>
 );
}

function HeaderNotificationBell() {
 const { unreadCount, setOpen } = useNotificationStore();

 return (
 <Button
 variant="ghost"
 size="icon"
 className="flex-shrink-0 relative"
 onClick={() => setOpen(true)}
 aria-label="الإشعارات"
 >
 <Bell className="w-4 h-4" />
 {unreadCount > 0 && (
 <Badge className="absolute -top-0.5 -left-0.5 h-4 min-w-4 px-1 text-xs bg-loss text-white border-0 animate-pulse">
 {unreadCount > 99 ? '99+' : unreadCount}
 </Badge>
 )}
 </Button>
 );
}
