'use client';

/**
 * TopBar — القائمة العلوية المرتبة
 * =================================
 * بديل الـ Sidebar القديم. قائمة علوية بـ 5 أقسام رئيسية:
 *
 *   1. الرئيسية     → dashboard
 *   2. السوق        → stocks / stock-filters / trading-chart / screener / smart-confluence
 *   3. التوقعات     → recommendations / picks-management / specialist-analysis / reports
 *   4. أموالي       → portfolio / watchlist / alerts-center / live-monitor / trading-memory
 *   5. المزيد       → news / learning / simulation / academy / crypto / zakat / settings
 *
 * Task 40-B (2026-10-04 — Nav Reorganization + Portfolio Merge):
 *   - Removed `wealth` from the visible finance section (merged INTO portfolio
 *     as a sub-tab — EnhancedPortfolioView now hosts المحفظة | الأموال | إنقاذ سهم).
 *   - Removed the disaster-rescue entry from the visible "More" menu (also merged
 *     INTO portfolio as a sub-tab). The old hash links for wealth + rescue +
 *     advanced-portfolio still work — those literals remain in
 *     VALID_VIEWS + the renderView() switch in page.tsx (backwards-compat
 *     preserved per Rule 67), just no longer surfaced as top-level nav items.
 *
 * Features:
 *   - RTL + responsive (يدعم الموبايل)
 *   - Dropdown menus لكل قسم
 *   - Active state highlighting
 *   - Currency selector + theme toggle + notifications
 *   - Safe-area-inset support
 *
 * UNIFIED-MARKET-UX (Task 1):
 *   - Market Switcher dropdown بجانب الـ logo يبدّل السوق بين:
 *     🇪🇬 EGX / 🇸🇦 TADAWUL / 🇰🇼 KSE / 🇶🇦 QSE / 🪙 CRYPTO
 *   - لما المستخدم يغيّر → setCurrentMarket(newMarket) + redirect لـ #dashboard
 *   - currency label بيتحدّث تلقائياً من MARKET_CURRENCY_LABEL
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard, CandlestickChart, Target,
  Crown, Newspaper, GraduationCap,
  Wallet, Eye,
  Activity, Settings, Menu, X, ChevronDown,
  Bell, Sun, Moon, DollarSign, Search, Globe, LogIn, LogOut, UserCircle,
  type LucideIcon,
} from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
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
import type { AppView } from '@/types';
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
  { value: 'EGX',      label: 'مصر',        flag: '🇪🇬', currency: 'EGP' },
  { value: 'TADAWUL',  label: 'السعودية',   flag: '🇸🇦', currency: 'SAR' },
  { value: 'KSE',      label: 'الكويت',     flag: '🇰🇼', currency: 'KWD' },
  { value: 'QSE',      label: 'قطر',        flag: '🇶🇦', currency: 'QAR' },
  { value: 'US',       label: 'أمريكا',     flag: '🇺🇸', currency: 'USD' },
  { value: 'CRYPTO',   label: 'كريبتو',     flag: '🪙', currency: 'USD' },
];

interface NavItem {
  id: AppView;
  label: string;
  icon: LucideIcon;
  highlight?: boolean;
}

interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

// ── الأقسام الخمسة الرئيسية — RESTRUCT-A-P1: ≤10 top-level (CEO John directive) ─
// Items removed from MENU (not from routing — hash links still work per Rule 67):
// - stock-filters → tab inside StocksView (A-P2)
// - trading-chart → sub-view inside StockDetail (mandate)
// - market-depth → deep-link #market-depth
// - specialist-analysis → tab/drawer inside StockDetail (mandate)
// - reports → tab inside MarketAnalysisView (A-P2)
// - live-monitor → deep-link #live-monitor
// - trading-memory → deep-link #trading-memory
// - simulation → deep-link #simulation
// - sharia/rescue/zakat/tithes/about → Settings section or deep-link
const navSections: NavSection[] = [
  {
    id: 'home',
    label: 'الرئيسية',
    icon: LayoutDashboard,
    items: [
      { id: 'dashboard', label: 'نظرة عامة', icon: LayoutDashboard },
    ],
  },
  {
    id: 'market',
    label: 'السوق',
    icon: CandlestickChart,
    items: [
      { id: 'stocks', label: 'الأسهم', icon: CandlestickChart },
      { id: 'liquidity-radar', label: 'رادار السيولة', icon: Activity, highlight: true },
    ],
  },
  {
    id: 'predictions',
    label: 'التحليل',
    icon: Target,
    items: [
      { id: 'recommendations', label: 'التوصيات', icon: Target },
    ],
  },
  {
    id: 'finance',
    label: 'محفظتي',
    icon: Wallet,
    items: [
      { id: 'portfolio', label: 'المحفظة', icon: Wallet },
      { id: 'watchlist', label: 'قائمة المتابعة', icon: Eye },
    ],
  },
  {
    id: 'more',
    label: 'المزيد',
    icon: Menu,
    items: [
      { id: 'academy', label: 'الأكاديمية', icon: GraduationCap },
      { id: 'news', label: 'الأخبار', icon: Newspaper },
      { id: 'subscription', label: 'الاشتراك', icon: Crown, highlight: true },
      { id: 'settings', label: 'الإعدادات', icon: Settings },
    ],
  },
];

export function TopBar() {
  const { currentView, setCurrentView, currentMarket, setCurrentMarket } = useAppStore();
  const t = useTranslation();
  const { data: session, status } = useSession();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [marketMenuOpen, setMarketMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const marketMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // حالة المستخدم
  const isAuthenticated = status === 'authenticated' && !!session?.user;
  const userDisplayName = (session?.user as Record<string, unknown>)?.name as string || (session?.user as Record<string, unknown>)?.email as string || (session?.user as Record<string, unknown>)?.username as string || null;
  const userInitial = userDisplayName ? userDisplayName.charAt(0).toUpperCase() : '?';

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
                    ? 'bg-primary/10 text-primary border-primary/30'
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
                <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {activeMarketCurrency}
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
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 border-b border-border mb-1">
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
                      <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
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
                          item.highlight && 'text-warning dark:text-warning font-medium'
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
                className="flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-background transition-all hover:bg-accent hover:border-primary/30 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                aria-label={isDark ? t('theme.light') : t('theme.dark')}
                title={isDark ? t('theme.light') : t('theme.dark')}
              >
                {isDark ? (
                  <Sun className="h-4 w-4 text-warning" />
                ) : (
                  <Moon className="h-4 w-4 text-slate-600" />
                )}
              </button>
            )}

            {/* FOCUS-5-TASKS — i18n Phase 2 (2026-10-01): Language toggle.
                بيبدّل بين العربى والإنجليزى عن طريق تغيير cookie NEXT_LOCALE. */}
            {mounted && <LanguageToggle variant="outline" size="icon" />}

            {/* N9: تسجيل الدخول/الخروج + اسم المستخدم */}
            {isAuthenticated ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs transition-all hover:bg-accent hover:border-primary/30 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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
                      <p className="text-[10px] text-muted-foreground">مسجّل الدخول</p>
                    </div>
                    <button
                      onClick={() => { setCurrentView('settings' as AppView); setUserMenuOpen(false); window.location.hash = 'settings'; }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-foreground hover:bg-accent transition-colors"
                    >
                      <Settings className="h-3.5 w-3.5" />
                      {t('nav.settings')}
                    </button>
                    <button
                      onClick={() => { signOut({ callbackUrl: '/' }); toast.info('تم تسجيل الخروج بنجاح'); }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-loss hover:bg-loss dark:hover:bg-loss/30 transition-colors"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      {t('common.logout')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => { setCurrentView('auth' as AppView); window.location.hash = 'auth'; }}
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
                <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
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
                      <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {opt.currency}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              {navSections.map((section) => (
                <div key={section.id} className="space-y-1">
                  <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
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
                  <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
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
