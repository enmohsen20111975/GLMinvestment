'use client';

/**
 * TopBar — القائمة العلوية المرتبة
 * =================================
 * بديل الـ Sidebar القديم. قائمة علوية بـ 5 أقسام رئيسية:
 *
 * 1. الرئيسية → dashboard
 * 2. السوق → stocks / stock-filters / trading-chart / screener / smart-confluence
 * 3. التوقعات → recommendations / picks-management / specialist-analysis / reports
 * 4. أموالي → portfolio / watchlist / alerts-center / live-monitor / trading-memory
 * 5. المزيد → news / learning / simulation / academy / crypto / zakat / settings
 *
 * Task 40-B (2026-10-04 — Nav Reorganization + Portfolio Merge):
 * - Removed `wealth` from the visible finance section (merged INTO portfolio
 * as a sub-tab — EnhancedPortfolioView now hosts المحفظة | الأموال | إنقاذ سهم).
 * - Removed the disaster-rescue entry from the visible "More" menu (also merged
 * INTO portfolio as a sub-tab). The old hash links for wealth + rescue +
 * advanced-portfolio still work — those literals remain in
 * VALID_VIEWS + the renderView() switch in page.tsx (backwards-compat
 * preserved per Rule 67), just no longer surfaced as top-level nav items.
 *
 * Features:
 * - RTL + responsive (يدعم الموبايل)
 * - Dropdown menus لكل قسم
 * - Active state highlighting
 * - Currency selector + theme toggle + notifications
 * - Safe-area-inset support
 *
 * UNIFIED-MARKET-UX (Task 1):
 * - Market Switcher dropdown بجانب الـ logo يبدّل السوق بين:
 * 🇪🇬 EGX / 🇸🇦 TADAWUL / 🇰🇼 KSE / 🇶🇦 QSE / 🪙 CRYPTO
 * - لما المستخدم يغيّر → setCurrentMarket(newMarket) + redirect لـ #dashboard
 * - currency label بيتحدّث تلقائياً من MARKET_CURRENCY_LABEL
 */

import React, { useState, useEffect, useRef } from 'react';
import {
 Menu, X, ChevronDown,
 Sun, Moon, Globe,
 Settings, LogIn, LogOut, Shield,
} from 'lucide-react';
import { useSession, signOut } from '@/lib/next-auth-shim';
import { useTheme } from 'next-themes';
// FOCUS-5-TASKS — i18n Phase 2 (2026-10-01): LanguageToggle component.
// Adds a language switcher (عربى ↔ English) next to the theme toggle.
import { LanguageToggle } from '@/components/LanguageToggle';
// FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01): useTranslation hook.
import { useTranslation } from '@/lib/i18n-context';
import {
 useAppStore,
 MarketType,
 MARKET_NAMES_AR,
 MARKET_CURRENCY_LABEL,
} from '@/lib/store';
import { cn } from '@/lib/utils';
// ALPHA-FIX Task 2: market session badge (مباشر/مغلق) from market-hours.ts
import { getMarketStatus } from '@/lib/market-hours';
import type { AppView } from '@/types';
// SCREENS-REORG: nav config — المصدر الوحيد للـ TopBar/MobileNav/MobileMoreSheet.
// التوحيد + عدم التكرار: أي تعديل في القوائم يبقى في مكان واحد (src/lib/nav-config.ts).
import { navSections } from '@/lib/nav-config';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { RoboNotifierToggle } from '@/components/notifications/RoboNotifierToggle';
import { toast } from 'sonner';

// ── خيارات السوق للـ Market Switcher ─────────────────────────────────────
// 5 أسواق مدعومة بالبيانات الفعلية (see store.ts MarketType union)
interface MarketOption {
 value: MarketType;
 label: string;
 flag: string;
 currency: string;
}
const MARKET_OPTIONS: MarketOption[] = [
 { value: 'EGX', label: 'مصر', flag: '🇪🇬', currency: 'EGP' },
 { value: 'TADAWUL', label: 'السعودية', flag: '🇸🇦', currency: 'SAR' },
 { value: 'KSE', label: 'الكويت', flag: '🇰🇼', currency: 'KWD' },
 { value: 'QSE', label: 'قطر', flag: '🇶🇦', currency: 'QAR' },
 { value: 'US', label: 'أمريكا', flag: '🇺🇸', currency: 'USD' },
 { value: 'CRYPTO', label: 'كريبتو', flag: '🪙', currency: 'USD' },
];

// SCREENS-REORG-VISION: الـ navSections دلوقتي بتتيجي من src/lib/nav-config.ts
// (6 بوابات: الرئيسية/السوق/التحليل/محفظتي/التعلّم/المزيد). شوف nav-config.ts
// للتعليقات الكاملة على كل بوابة وعنصر.

export function TopBar() {
 const { currentView, setCurrentView, currentMarket, setCurrentMarket } = useAppStore();
 const t = useTranslation();
 const { data: session, status } = useSession();
 const { theme, setTheme } = useTheme();

 // ALPHA-FIX Task 2: Market session status badge (مباشر / مغلق)
 const marketStatus = getMarketStatus(currentMarket);
 const [mounted, setMounted] = useState(false);
 const [activeSection, setActiveSection] = useState<string | null>(null);
 const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
 const [marketMenuOpen, setMarketMenuOpen] = useState(false);
 const [userMenuOpen, setUserMenuOpen] = useState(false);
 const dropdownRef = useRef<HTMLDivElement>(null);
 const marketMenuRef = useRef<HTMLDivElement>(null);
 const userMenuRef = useRef<HTMLDivElement>(null);

 // حالة المستخدم وصلاحيات الأدمن
 const storeUser = useAppStore((s) => s.user);
 const storeAuth = useAppStore((s) => s.isAuthenticated);
 const isAuthenticated = (status === 'authenticated' && !!session?.user) || storeAuth || !!storeUser;
 const userDisplayName = (session?.user as Record<string, unknown>)?.name as string || (session?.user as Record<string, unknown>)?.email as string || storeUser?.name || storeUser?.email || storeUser?.username || null;
 const userInitial = userDisplayName ? userDisplayName.charAt(0).toUpperCase() : '?';

 const uEmail = ((session?.user?.email as string) || storeUser?.email || '').toLowerCase();
 const uName = ((session?.user?.name as string) || (session?.user as Record<string, unknown>)?.username as string || storeUser?.username || '').toLowerCase();
 const isUserAdmin =
 storeUser?.is_admin === true ||
 storeUser?.subscription_tier === 'admin' ||
 (session?.user as Record<string, unknown>)?.is_admin === true ||
 (session?.user as Record<string, unknown>)?.subscription_tier === 'admin' ||
 ['mohseny', 'admin'].includes(uName) ||
 ['mohseny@m2y.net', 'enmohsen20111975@gmail.com', 'enmohsen2011975@gmail.com', 'ceo@m2y.net'].includes(uEmail);

 // mount check للـ theme (next-themes بتحتاج client-side)
 useEffect(() => { setMounted(true); }, []);
 const isDark = theme === 'dark';

 // إغلاق الـ dropdown لما تضغط خارجها
 useEffect(() => {
 function handleClickOutside(e: MouseEvent) {
 if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
 setActiveSection(null);
 }
 if (marketMenuRef.current && !marketMenuRef.current.contains(e.target as Node)) {
 setMarketMenuOpen(false);
 }
 if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
 setUserMenuOpen(false);
 }
 }
 document.addEventListener('mousedown', handleClickOutside);
 return () => document.removeEventListener('mousedown', handleClickOutside);
 }, []);

 // تحديد القسم النشط بناءً على currentView
 const getActiveSection = (): string => {
 for (const section of navSections) {
 if (section.items.some(item => item.id === currentView)) {
 return section.id;
 }
 }
 return 'home';
 };

 const activeSec = getActiveSection();

 const handleNavClick = (view: AppView) => {
 setCurrentView(view);
 setActiveSection(null);
 setMobileMenuOpen(false);
 if (typeof window !== 'undefined') {
 window.location.hash = view;
 }
 };

 // ─── UNIFIED-MARKET-UX: تبديل السوق ─────────────────────────────────────
 // 1) setCurrentMarket(newMarket) في الـ store → كل الـ components بيتحدّثوا تلقائياً
 // 2) redirect لـ #dashboard (الرئيسية) زي ما العميل طلب
 // 3) currency label بيتحدّث من MARKET_CURRENCY_LABEL تلقائياً
 const handleMarketChange = (market: MarketType) => {
 setCurrentMarket(market);
 setMarketMenuOpen(false);
 setMobileMenuOpen(false);
 // ننتقل للرئيسية عشان المستخدم يشوف بيانات السوق الجديد من الصفر
 setCurrentView('dashboard');
 if (typeof window !== 'undefined') {
 window.location.hash = 'dashboard';
 }
 };

 const activeMarketOption = MARKET_OPTIONS.find(m => m.value === currentMarket) ?? MARKET_OPTIONS[0];
 const activeMarketCurrency = MARKET_CURRENCY_LABEL[currentMarket];

 return (
 <>
 <header
 className="sticky top-0 z-40 w-full border-b border-border/80 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 shadow-[0_1px_0_0_hsl(var(--primary)/0.06)]"
 dir="rtl"
 >
 <div className="flex h-14 items-center justify-between px-3 md:px-6">
 {/* Logo + Brand + Market Switcher */}
 <div className="flex items-center gap-2 md:gap-3">
 <button
 onClick={() => handleNavClick('dashboard')}
 className="flex items-center gap-2 font-bold text-sm md:text-base hover:opacity-80 transition-opacity"
 aria-label="الرئيسية"
 >
 <img
 src="/logo-square.png"
 alt="دليل الاستثمار"
 className="h-8 w-8 rounded-lg object-contain shadow-sm border border-border/40 bg-card"
 />
 <span className="hidden sm:inline">دليل الاستثمار</span>
 </button>

 {/* Market Switcher (UNIFIED-MARKET-UX Task 1) */}
 <div className="relative" ref={marketMenuRef}>
 <button
 onClick={() => setMarketMenuOpen(!marketMenuOpen)}
 className={cn(
 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs font-medium transition-colors',
 marketMenuOpen
 ? 'bg-primary/10 text-primary border-primary/20'
 : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
 )}
 aria-expanded={marketMenuOpen}
 aria-haspopup="true"
 aria-label="تبديل السوق"
 title={`السوق الحالي: ${MARKET_NAMES_AR[currentMarket]}`}
 >
 <Globe className="h-3.5 w-3.5" />
 <span className="text-base leading-none">{activeMarketOption.flag}</span>
 <span className="hidden sm:inline">{activeMarketOption.label}</span>
 <span className="text-xs font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
 {activeMarketCurrency}
 </span>
 {/* ALPHA-FIX Task 2: Market session badge — مباشر/مغلق بمواعيد البورصة الرسمية */}
 <span
 className={cn(
 'hidden md:inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border',
 marketStatus.isOpen
 ? 'bg-profit/10 text-profit border-profit/20'
 : 'bg-muted text-muted-foreground border-border'
 )}
 title={marketStatus.reason}
 >
 {marketStatus.isOpen ? '🔴' : '⚪'}
 {marketStatus.isOpen ? 'مباشر' : 'مغلق'}
 </span>
 <ChevronDown
 className={cn(
 'h-3 w-3 transition-transform',
 marketMenuOpen && 'rotate-180'
 )}
 />
 </button>

 {marketMenuOpen && (
 <div className="absolute top-full right-0 mt-1 w-52 rounded-md border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95 z-50">
 <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 border-b border-border mb-1">
 اختر السوق
 </div>
 {MARKET_OPTIONS.map((opt) => (
 <button
 key={opt.value}
 onClick={() => handleMarketChange(opt.value)}
 className={cn(
 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors',
 currentMarket === opt.value
 ? 'bg-primary/10 text-primary font-medium'
 : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
 )}
 >
 <span className="text-base leading-none">{opt.flag}</span>
 <span className="flex-1 text-right">{opt.label}</span>
 <span className="text-xs font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
 {opt.currency}
 </span>
 {currentMarket === opt.value && (
 <span className="w-1.5 h-1.5 rounded-full bg-primary" />
 )}
 </button>
 ))}
 </div>
 )}
 </div>
 </div>

 {/* Desktop Navigation */}
 <nav className="hidden md:flex items-center gap-1" ref={dropdownRef}>
 {navSections.map((section) => (
 <div key={section.id} className="relative">
 <button
 onClick={() =>
 setActiveSection(activeSection === section.id ? null : section.id)
 }
 className={cn(
 'flex items-center gap-1.5 px-3 py-2 text-xs md:text-sm font-medium rounded-md transition-colors',
 activeSec === section.id
 ? 'bg-primary/10 text-primary'
 : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
 )}
 aria-expanded={activeSection === section.id}
 aria-haspopup="true"
 >
 <section.icon className="h-4 w-4" />
 <span>{section.label}</span>
 <ChevronDown
 className={cn(
 'h-3 w-3 transition-transform',
 activeSection === section.id && 'rotate-180'
 )}
 />
 </button>

 {/* Dropdown */}
 {activeSection === section.id && (
 <div className="absolute top-full right-0 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95">
 {section.items.map((item) => (
 <button
 key={item.id}
 onClick={() => handleNavClick(item.id)}
 className={cn(
 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors',
 currentView === item.id
 ? 'bg-primary/10 text-primary font-medium'
 : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
 item.highlight && 'text-warning font-medium'
 )}
 >
 <item.icon className="h-3.5 w-3.5" />
 <span className="flex-1 text-right">{item.label}</span>
 </button>
 ))}
 </div>
 )}
 </div>
 ))}
 </nav>

 {/* Right Side: Search + Notifications + Theme + Currency */}
 <div className="flex items-center gap-1 md:gap-2">
 {/* Mobile menu trigger */}
 <button
 onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
 className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
 aria-label="القائمة"
 aria-expanded={mobileMenuOpen}
 >
 {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
 </button>

 {/* Notifications */}
 <NotificationCenter />

 {/* Robo toggle */}
 <div className="hidden sm:block">
 <RoboNotifierToggle />
 </div>

 {/* Theme toggle — ثابت في كل الشاشات (light/dark) */}
 {mounted && (
 <button
 onClick={() => setTheme(isDark ? 'light' : 'dark')}
 className="flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-background transition-all hover:bg-accent hover:border-primary/20 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
 aria-label={isDark ? t('theme.light') : t('theme.dark')}
 title={isDark ? t('theme.light') : t('theme.dark')}
 >
 {isDark ? (
 <Sun className="h-4 w-4 text-warning" />
 ) : (
 <Moon className="h-4 w-4 text-muted-foreground" />
 )}
 </button>
 )}

 {/* FOCUS-5-TASKS — i18n Phase 2 (2026-10-01): Language toggle.
 بيبدّل بين العربى والإنجليزى عن طريق تغيير cookie NEXT_LOCALE. */}
 {mounted && <LanguageToggle variant="outline" size="icon" />}

 {/* N9: تسجيل الدخول/الخروج + اسم المستخدم */}
 {isUserAdmin && (
 <button
 onClick={() => { setCurrentView('admin'); window.location.hash = 'admin'; }}
 className="flex items-center gap-1.5 rounded-lg border border-warning/20 bg-warning/10 px-2.5 py-1.5 text-xs font-bold text-warning hover:bg-warning/10 transition-all shadow-sm"
 title="لوحة الإدارة"
 >
 <Shield className="h-3.5 w-3.5" />
 <span className="hidden md:inline">لوحة الإدارة</span>
 </button>
 )}
 {isAuthenticated ? (
 <div className="relative" ref={userMenuRef}>
 <button
 onClick={() => setUserMenuOpen(!userMenuOpen)}
 className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs transition-all hover:bg-accent hover:border-primary/20 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
 aria-label="حساب المستخدم"
 >
 <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm ring-2 ring-primary/20">
 {userInitial}
 </span>
 <span className="hidden sm:inline font-medium text-foreground max-w-[120px] truncate">
 {userDisplayName}
 </span>
 <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', userMenuOpen && 'rotate-180')} />
 </button>
 {userMenuOpen && (
 <div className="absolute left-0 mt-2 w-48 rounded-lg border border-border bg-popover p-1 shadow-lg z-50" dir="rtl">
 <div className="px-3 py-2 border-b border-border mb-1">
 <p className="text-xs font-semibold text-foreground truncate">{userDisplayName}</p>
 <p className="text-xs text-muted-foreground">{isUserAdmin ? 'مدير النظام (Admin)' : 'مسجّل الدخول'}</p>
 </div>
 {isUserAdmin && (
 <button
 onClick={() => { setCurrentView('admin'); setUserMenuOpen(false); window.location.hash = 'admin'; }}
 className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-bold text-warning hover:bg-warning/10 transition-colors border-b border-border mb-1"
 >
 <Shield className="h-3.5 w-3.5 text-warning" />
 لوحة تحكم الإدارة
 </button>
 )}
 <button
 onClick={() => { setCurrentView('settings'); setUserMenuOpen(false); window.location.hash = 'settings'; }}
 className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-foreground hover:bg-accent transition-colors"
 >
 <Settings className="h-3.5 w-3.5" />
 {t('nav.settings')}
 </button>
 <button
 onClick={() => { signOut({ callbackUrl: '/' }); toast.info('تم تسجيل الخروج بنجاح'); }}
 className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-loss hover:bg-loss dark:hover:bg-loss/10 transition-colors"
 >
 <LogOut className="h-3.5 w-3.5" />
 {t('common.logout')}
 </button>
 </div>
 )}
 </div>
 ) : (
 <button
 onClick={() => { setCurrentView('auth'); window.location.hash = 'auth'; }}
 className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.98]"
 >
 <LogIn className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">تسجيل الدخول</span>
 </button>
 )}
 </div>
 </div>

 {/* Mobile Menu (collapsible) */}
 {mobileMenuOpen && (
 <div className="md:hidden border-t border-border bg-background">
 <nav className="grid gap-1 p-3" dir="rtl">
 {/* Market Switcher (mobile) */}
 <div className="space-y-1 pb-2 border-b border-border mb-2">
 <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
 <Globe className="h-3 w-3" />
 اختر السوق
 </div>
 <div className="grid grid-cols-1 gap-1">
 {MARKET_OPTIONS.map((opt) => (
 <button
 key={opt.value}
 onClick={() => handleMarketChange(opt.value)}
 className={cn(
 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors',
 currentMarket === opt.value
 ? 'bg-primary/10 text-primary font-medium'
 : 'text-muted-foreground hover:bg-accent'
 )}
 >
 <span className="text-base leading-none">{opt.flag}</span>
 <span className="flex-1 text-right">{opt.label}</span>
 <span className="text-xs font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
 {opt.currency}
 </span>
 </button>
 ))}
 </div>
 </div>
 {navSections.map((section) => (
 <div key={section.id} className="space-y-1">
 <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
 <section.icon className="h-3 w-3" />
 {section.label}
 </div>
 {section.items.map((item) => (
 <button
 key={item.id}
 onClick={() => handleNavClick(item.id)}
 className={cn(
 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors',
 currentView === item.id
 ? 'bg-primary/10 text-primary font-medium'
 : 'text-muted-foreground hover:bg-accent'
 )}
 >
 <item.icon className="h-3.5 w-3.5" />
 <span className="flex-1 text-right">{item.label}</span>
 </button>
 ))}
 </div>
 ))}

 {/* Theme toggle في قائمة الموبايل */}
 {mounted && (
 <div className="space-y-1 pt-2 border-t border-border">
 <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
 {isDark ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
 المظهر
 </div>
 <button
 onClick={() => setTheme(isDark ? 'light' : 'dark')}
 className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors"
 >
 {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
 <span className="flex-1 text-right">{isDark ? t('theme.light') : t('theme.dark')}</span>
 </button>
 </div>
 )}
 </nav>
 </div>
 )}
 </header>
 </>
 );
}
