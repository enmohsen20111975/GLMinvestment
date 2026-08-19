'use client';

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  LayoutGrid,
  TrendingUp,
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
  Users,
  Gamepad2,
  Wallet,
  Crown,
  Bitcoin,
  HandCoins,
  Heart,
  Target,
  Trophy,
  ChevronDown,
  BarChart3,
  BookOpen,
  Smartphone,
  ExternalLink,
  Sparkles,
  Shield,
  Activity,
  RadioTower,
  MessageCircle,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { useAppStore, MARKET_NAMES_AR, MarketType } from '@/lib/store';
import { isCryptoVisible } from '@/lib/v2/persona-config';
import { useNotificationStore } from '@/lib/notification-store';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { cn } from '@/lib/utils';
import { PlatformGuide } from '@/components/help/PlatformGuide';
import type { AppView } from '@/types';
import { ExchangeSelector } from '@/components/layout/ExchangeSelector';

// ==================== TYPES ====================

interface NavItem {
  id: string;
  label: string;
  labelEn: string;
  icon: LucideIcon;
  badge?: string;
  external?: boolean;
  highlight?: boolean;
}

interface NavSection {
  id: string;
  label: string;
  labelEn: string;
  icon: LucideIcon;
  items: NavItem[];
  defaultOpen?: boolean;
  color?: string;
}

// ==================== NAVIGATION CONFIG ====================

// الأقسام الرئيسية (قابلة للتوسيع)
// ملاحظة: الصفحات اللي فيها adminOnly: true مفروض تظهر للأدمن بس

// Function to get nav sections based on current market
function getNavSections(currentMarket: MarketType): NavSection[] {
  const marketName = MARKET_NAMES_AR[currentMarket];
  
  return [
    // === السوق الحالي ===
    {
      id: 'market',
      label: marketName,
      labelEn: currentMarket,
      icon: TrendingUp,
      defaultOpen: true,
      color: 'emerald',
      items: [
        { id: 'dashboard', label: 'نظرة عامة', labelEn: 'Overview', icon: LayoutDashboard },
        { id: 'stocks', label: 'الأسهم', labelEn: 'Stocks', icon: CandlestickChart },
        { id: 'trading-chart', label: 'الشارت التفاعلي ومقارنة الأسهم', labelEn: 'Interactive Chart & Comparison', icon: TrendingUp },
        { id: 'recommendations', label: 'متابعة التوقعات', labelEn: 'Predictions Tracking', icon: Target },
        { id: 'picks-management', label: 'إدارة التوصيات', labelEn: 'Picks Management', icon: Crown },
        // sniper merged into analysis tabs (opportunities engine)
        // prediction-performance + prediction-credibility moved to Admin panel only
        // (under development — data quality issues being fixed via backtesting loop)
        // advanced-analysis REMOVED — features distributed to recommendations + specialist-analysis
        // unified-analysis moved to Admin
        { id: 'specialist-analysis', label: 'تحليل المتخصصين', labelEn: 'Specialist Analysis', icon: Sparkles },
        { id: 'reports', label: 'التقارير', labelEn: 'Reports', icon: FileBarChart },
        { id: 'learning', label: 'مركز التعلم', labelEn: 'Learning', icon: GraduationCap },
        { id: 'simulation', label: 'المحاكاة', labelEn: 'Simulation', icon: Gamepad2 },
        { id: 'academy', label: 'أكاديمية M2y', labelEn: 'M2y Academy', icon: GraduationCap },
      ],
    },
    // === إدارة الأموال (موحد - أسهم + عملات رقمية) ===
    {
      id: 'money-management',
      label: 'إدارة الأموال',
      labelEn: 'Money Management',
      icon: Wallet,
      defaultOpen: true,
      color: 'amber',
      items: [
        { id: 'portfolio', label: 'المحفظة الموحدة', labelEn: 'Unified Portfolio', icon: Wallet },
        { id: 'watchlist', label: 'قوائم المراقبة', labelEn: 'Watchlist', icon: Eye },
        { id: 'smart-confluence', label: 'تحليلات السوق', labelEn: 'Market Analysis', icon: Sparkles },
        { id: 'alerts-center', label: 'مركز التنبيهات', labelEn: 'Alerts Center', icon: Shield },
        { id: 'wealth', label: 'الأموال', labelEn: 'Funds', icon: HandCoins },
        { id: 'live-monitor', label: 'المراقبة الحية', labelEn: 'Live Monitor', icon: RadioTower },
        // trading-journal moved to Admin
        { id: 'trading-memory', label: 'ذاكرة التداول', labelEn: 'Trading Memory', icon: Brain },
      ],
    },
    // === العملات الرقمية ===
    {
      id: 'crypto',
      label: 'العملات الرقمية',
      labelEn: 'Crypto',
      icon: Bitcoin,
      defaultOpen: true,
      color: 'orange',
      items: [
        { id: 'crypto', label: 'نظرة عامة', labelEn: 'Overview', icon: LayoutDashboard },
        { id: 'crypto-live', label: 'الجدول الحي', labelEn: 'Live Table', icon: Activity },
        { id: 'crypto-recommendations', label: 'التحليلات', labelEn: 'Analysis', icon: Target },
        { id: 'crypto-analysis', label: 'التحليل المتقدم', labelEn: 'Analysis', icon: Brain },
        { id: 'crypto-learning', label: 'مركز التعلم', labelEn: 'Learning', icon: GraduationCap },
        { id: 'crypto-simulation', label: 'المحاكاة', labelEn: 'Simulation', icon: Gamepad2 },
      ],
    },

    // === حسابات دينية ===
    {
      id: 'islamic',
      label: 'حسابات دينية',
      labelEn: 'Islamic',
      icon: BookOpen,
      defaultOpen: false,
      color: 'purple',
      items: [
        { id: 'zakat', label: 'حاسبة الزكاة', labelEn: 'Zakat', icon: HandCoins },
        { id: 'tithes', label: 'حاسبة العُشر', labelEn: 'Tithes', icon: Heart },
      ],
    },
  ];
}

// العناصر السفلية (غير قابلة للتوسيع)
const bottomNavItems: NavItem[] = [
  { id: 'subscription', label: 'الباقات والاشتراكات', labelEn: 'Subscription', icon: Crown, highlight: true },
  { id: 'about', label: 'من نحن', labelEn: 'About', icon: Sparkles },
  { id: 'settings', label: 'الإعدادات', labelEn: 'Settings', icon: Settings },
];

// عنصر الأدمن - بيظهر بس للمستخدمين اللي ليهم صلاحية أدمن
const adminNavItem: NavItem = {
  id: 'admin',
  label: 'لوحة الأدمن',
  labelEn: 'Admin Panel',
  icon: Shield,
};

// روابط خارجية
const externalLinks = [
  {
    id: 'android-app',
    label: 'تحميل التطبيق',
    labelEn: 'Download App',
    url: 'https://play.google.com/store/apps/details?id=com.egx.investment',
    icon: Smartphone,
  },
];

// روابط إضافية للأدمن فقط (تفتح في tab جديد)
const adminExternalLinks: Array<{ id: string; label: string; labelEn: string; url: string; icon: any }> = [];

// ==================== COMPONENT ====================

export function Sidebar() {
  const { data: session } = useSession();
  const { currentView, setCurrentView, setCurrentMarket, sidebarOpen, toggleSidebar, logout, user, persona, currentMarket } = useAppStore();
  
  // Get nav sections based on current market
  const navSections = getNavSections(currentMarket);
  
  // Crypto is always visible for all users
  const showCrypto = true;
  const openNotificationPanel = useNotificationStore((s) => s.setOpen);

  // State for collapsible sections - Money Management is open by default
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    market: true,
    crypto: true,
    'money-management': true,
    islamic: false,
  });

  // ONBOARDING-033: Interactive Help Center
  const [guideOpen, setGuideOpen] = useState(false);

  // Auto-close sidebar on mobile mount
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    if (mq.matches && sidebarOpen) {
      toggleSidebar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefer session user data if available, fall back to store user
  const displayName = user?.username || (session?.user?.name || '');
  const displayEmail = user?.email || (session?.user?.email || '');
  const isLoggedIn = !!user || session?.status === 'authenticated';

  // خطة الاشتراك الحالية لعرضها كبادجة بجوار "الباقات والاشتراكات"
  const tier = user?.subscription_tier || 'free';
  const tierLabel =
    tier === 'free' ? 'مجاني'
      : tier === 'normal' ? 'عادي'
        : tier === 'premium' ? 'مميز'
          : tier === 'admin' ? 'أدمن'
            : tier;

  const handleNav = (viewId: string) => {
    setCurrentView(viewId as AppView);
    // ── UI-mirror protocol ────────────────────────────────────────────
    // Any crypto section forces the CRYPTO market so the unified stocks
    // components (StocksView / CryptoAnalysisView) load crypto data.
    // Stocks sections restore a stocks market if we were in CRYPTO.
    if (typeof viewId === 'string' && viewId.startsWith('crypto')) {
      if (currentMarket !== 'CRYPTO') setCurrentMarket('CRYPTO');
    } else if (
      viewId === 'stocks' || viewId === 'stock-detail' || viewId === 'recommendations' ||
      viewId === 'watchlist' || viewId === 'portfolio' || viewId === 'dashboard'
    ) {
      if (currentMarket === 'CRYPTO') setCurrentMarket('EGX');
    }
  };

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const handleLogout = async () => {
    logout();
    await signOut({ redirect: false });
  };

  const renderNavItem = (item: NavItem, depth: number = 0) => {
    const Icon = item.icon;
    const isActive = currentView === item.id;
    
    // Handle external links (like Maestro)
    if (item.external) {
      return (
        <a
          key={item.id}
          href={`/${item.id}`}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm cursor-pointer min-h-[44px]',
            depth > 0 && 'mr-4',
            'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Icon className="w-4 h-4 flex-shrink-0" />
          {sidebarOpen && (
            <>
              <span className="truncate flex-1">{item.label}</span>
              {item.badge && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  {item.badge}
                </span>
              )}
              <ExternalLink className="w-3 h-3 opacity-50" />
            </>
          )}
        </a>
      );
    }

    const href = item.id === 'dashboard' ? '/' : `/#${item.id}`;

    return (
      <a
        key={item.id}
        href={href}
        onClick={(e) => {
          e.preventDefault();
          handleNav(item.id);
        }}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm cursor-pointer min-h-[44px]',
          depth > 0 && 'mr-4',
          isActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : item.highlight
              ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 font-medium'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Icon className={cn('w-4 h-4 flex-shrink-0', item.highlight && 'text-amber-500')} />
        {sidebarOpen && (
          <>
            <span className="truncate flex-1">{item.label}</span>
            {item.badge && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {item.badge}
              </span>
            )}
            {item.highlight && !item.badge && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold">
                {tierLabel}
              </span>
            )}
          </>
        )}
      </a>
    );
  };

  const renderNavSection = (section: NavSection) => {
    const Icon = section.icon;
    const isOpen = openSections[section.id];
    const hasActiveChild = section.items.some((item) => currentView === item.id);

    // Determine color class
    const colorClass = {
      emerald: 'text-emerald-600 dark:text-emerald-400',
      orange: 'text-orange-600 dark:text-orange-400',
      purple: 'text-purple-600 dark:text-purple-400',
      blue: 'text-blue-600 dark:text-blue-400',
      amber: 'text-amber-600 dark:text-amber-400',
      cyan: 'text-cyan-600 dark:text-cyan-400',
    }[section.color || 'emerald'];

    const activeBgClass = {
      emerald: 'bg-emerald-50 dark:bg-emerald-950/30',
      orange: 'bg-orange-50 dark:bg-orange-950/30',
      purple: 'bg-purple-50 dark:bg-purple-950/30',
      blue: 'bg-blue-50 dark:bg-blue-950/30',
      amber: 'bg-amber-50 dark:bg-amber-950/30',
      cyan: 'bg-cyan-50 dark:bg-cyan-950/30',
    }[section.color || 'emerald'];

    return (
      <div key={section.id} className="space-y-1">
        {/* Section Header */}
        <button
          onClick={() => toggleSection(section.id)}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 text-sm cursor-pointer min-h-[44px]',
            hasActiveChild
              ? `${activeBgClass} text-foreground`
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Icon className={cn('w-5 h-5 flex-shrink-0', hasActiveChild && colorClass)} />
          {sidebarOpen && (
            <>
              <span className="truncate flex-1 text-right font-medium">{section.label}</span>
              <ChevronDown
                className={cn('w-4 h-4 transition-transform duration-200', isOpen && 'rotate-180')}
              />
            </>
          )}
        </button>

        {/* Section Items */}
        {sidebarOpen && isOpen && (
          <div className="mr-2 space-y-0.5 border-r-2 border-border pr-2">
            {section.items.map((item) => renderNavItem(item, 1))}
          </div>
        )}

        {/* Show active child even when collapsed */}
        {!sidebarOpen && hasActiveChild && (
          <div className="mr-2 border-r-2 border-border pr-2">
            {section.items
              .filter((item) => currentView === item.id)
              .map((item) => renderNavItem(item, 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={toggleSidebar} />
      )}

      <aside
        className={cn(
          'fixed top-0 right-0 z-50 h-full bg-card border-l border-border transition-all duration-300 flex flex-col',
          'w-64',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0 md:w-16'
        )}
        dir="rtl"
      >
        {/* Logo */}
        <div className="flex items-center gap-3 p-4 border-b border-border min-h-[64px]">
          <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-amber-500/30">
            <img src="/logo-square.png" alt="دليل الاستثمار" className="w-full h-full object-cover" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-bold text-foreground truncate">دليل الاستثمار</h1>
              <p className="text-[10px] text-muted-foreground truncate">Investment Guide</p>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            className="mr-auto md:hidden p-2 rounded-md hover:bg-muted transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Market Selector */}
        {sidebarOpen && (
          <div className="px-3 py-2 border-b border-border">
            <ExchangeSelector className="w-full" />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {/* Main Sections - Filter crypto based on persona */}
          {navSections
            .filter((section) => section.id !== 'crypto' || showCrypto)
            .map((section) => renderNavSection(section))}

          {/* Divider */}
          <div className="my-2 border-t border-border" />

          {/* Admin Panel - يظهر بس للأدمن */}
          {user?.is_admin && (
            <button
              onClick={() => setCurrentView('admin')}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-3 rounded-lg text-sm font-medium transition-colors min-h-[44px]',
                currentView === 'admin'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-muted'
              )}
            >
              <Shield className="size-4 flex-shrink-0" />
              {sidebarOpen && <span>لوحة الأدمن</span>}
            </button>
          )}

          {/* Admin External Tools - أدوات إضافية للأدمن (تفتح في tab جديد) */}
          {user?.is_admin && sidebarOpen && adminExternalLinks.length > 0 && (
            <div className="space-y-0.5 pt-1">
              {adminExternalLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm cursor-pointer bg-gradient-to-l from-amber-600/10 to-emerald-600/10 text-amber-700 dark:text-amber-400 hover:from-amber-600/20 hover:to-emerald-600/20 border border-amber-500/20"
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate flex-1">{link.label}</span>
                    <ExternalLink className="w-3 h-3 opacity-50" />
                  </a>
                );
              })}
            </div>
          )}

          {/* Bottom Items */}
          {bottomNavItems.map((item) => renderNavItem(item))}

          {/* External Links */}
          {sidebarOpen && externalLinks.length > 0 && (
            <div className="pt-2 mt-2 border-t border-border">
              {externalLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 text-sm cursor-pointer bg-gradient-to-l from-emerald-600/10 to-teal-600/10 text-emerald-700 dark:text-emerald-400 hover:from-emerald-600/20 hover:to-teal-600/20 border border-emerald-500/20 min-h-[44px]"
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <span className="truncate flex-1">{link.label}</span>
                    <ExternalLink className="w-4 h-4 opacity-50" />
                  </a>
                );
              })}
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
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
                  isLoggedIn
                    ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                    : 'bg-gradient-to-br from-gray-400 to-gray-500'
                )}
              >
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
          {/* ONBOARDING-033: Help Center button */}
          <button
            onClick={() => setGuideOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all min-h-[44px]"
          >
            <HelpCircle className="w-5 h-5" />
            {sidebarOpen && <span>كيف أستخدم المنصة؟</span>}
          </button>

          <NotificationBell onOpenPanel={() => openNotificationPanel(true)} />

          {isLoggedIn ? (
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all min-h-[44px]"
            >
              <LogOut className="w-5 h-5" />
              {sidebarOpen && <span>تسجيل الخروج</span>}
            </button>
          ) : (
            <button
              onClick={() => setCurrentView('auth')}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all min-h-[44px]"
            >
              <LogIn className="w-5 h-5" />
              {sidebarOpen && <span>تسجيل الدخول</span>}
            </button>
          )}
        </div>

        {/* ONBOARDING-033: Platform Guide Panel */}
        <PlatformGuide open={guideOpen} onOpenChange={setGuideOpen} />

        {/* Toggle button (desktop) */}
        <button
          onClick={toggleSidebar}
          className="hidden md:flex items-center justify-center p-2 border-t border-border text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
        >
          {sidebarOpen ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </aside>
    </>
  );
}
