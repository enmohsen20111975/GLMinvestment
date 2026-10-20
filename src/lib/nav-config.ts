/**
 * nav-config.ts — المصدر الوحيد للقوائم الثلاث (TopBar / MobileNav / MobileMoreSheet)
 * =====================================================================
 * ALPHA-FIX Task 4 (2026-10-20): إعادة هيكلة لـ 4 بوابات استثمارية واضحة:
 *
 * TopBar → 6 بوابات (4 رئيسية + 2 مساعدة):
 * 1. 📊 نبض السوق (Market Pulse) — dashboard + liquidity-radar + sectors + market-status + historical-trades
 * 2. 🎯 الفرص والتربص (Picks & Stalking) — recommendations + market-depth + picks-management + specialist-analysis
 * 3. 🔬 مجهر الأسهم (Stock DNA) — stocks + stock-filters + screener + trading-chart + smart-confluence
 * 4. 💼 الصفقات والمحفظة (Portfolio) — portfolio + watchlist + alerts-center + bagholder-rescue
 * 5. 🎓 التعلّم (Education) — academy + simulation
 * 6. ⋯ المزيد (More) — news + subscription + settings + sharia + zakat + tithes + about
 *
 * MobileNav → 5 أزرار (بدون تغيير):
 * dashboard / stocks / recommendations / portfolio / market-depth
 *
 * MobileMoreSheet → أقسام أخرى (بدون تغيير)
 */

import {
  LayoutDashboard,
  CandlestickChart,
  Activity,
  Target,
  Wallet,
  Eye,
  Bell,
  LifeBuoy,
  GraduationCap,
  Gamepad2,
  Menu,
  Newspaper,
  Crown,
  Settings,
  Info,
  ShieldCheck,
  BarChart3,
  History,
  TrendingUp,
  Landmark,
  Layers,
  Microscope,
  type LucideIcon,
} from 'lucide-react';
import type { AppView } from '@/types';

export interface NavItem {
  id: AppView;
  label: string;
  icon: LucideIcon;
  highlight?: boolean;
}

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

/* ════════════════════════════════════════════════════════════════════════
 * TopBar — 6 بوابات (4 رئيسية + 2 مساعدة)
 * ALPHA-FIX Task 4: إعادة هيكلة لـ 4 بوابات استثمارية واضحة
 * ════════════════════════════════════════════════════════════════════════ */
export const navSections: NavSection[] = [
  // ─── (1) 📊 نبض السوق ───
  {
    id: 'market-pulse',
    label: 'نبض السوق',
    icon: Activity,
    items: [
      { id: 'dashboard', label: 'نظرة عامة', icon: LayoutDashboard },
      { id: 'liquidity-radar', label: 'رادار السيولة', icon: Activity },
      { id: 'sectors', label: 'حركة القطاعات', icon: Layers },
      { id: 'market-status', label: 'حالة السوق', icon: Activity },
      { id: 'historical-trades', label: 'الصفقات التاريخية', icon: History },
    ],
  },
  // ─── (2) 🎯 الفرص والتربص ───
  {
    id: 'picks-stalking',
    label: 'الفرص والتربص',
    icon: Target,
    items: [
      { id: 'recommendations', label: 'التحليلات', icon: Target },
      { id: 'market-depth', label: 'سيولة المستثمرين', icon: Activity, highlight: true },
      { id: 'picks-management', label: 'إدارة الصفقات', icon: TrendingUp },
      { id: 'specialist-analysis', label: 'التحليل المتخصص', icon: Microscope },
    ],
  },
  // ─── (3) 🔬 مجهر الأسهم ───
  {
    id: 'stock-dna',
    label: 'مجهر الأسهم',
    icon: Microscope,
    items: [
      { id: 'stocks', label: 'الأسهم', icon: CandlestickChart },
      { id: 'stock-filters', label: 'الفلاتر الذكية', icon: Target },
      { id: 'screener', label: 'الفرز المتقدم', icon: BarChart3 },
      { id: 'trading-chart', label: 'الشارت التفاعلي', icon: BarChart3 },
      { id: 'smart-confluence', label: 'الذكاء الموحد', icon: TrendingUp },
    ],
  },
  // ─── (4) 💼 الصفقات والمحفظة ───
  {
    id: 'portfolio',
    label: 'محفظتي',
    icon: Wallet,
    items: [
      { id: 'portfolio', label: 'المحفظة', icon: Wallet },
      { id: 'watchlist', label: 'قائمة المتابعة', icon: Eye },
      { id: 'alerts-center', label: 'مركز التنبيهات', icon: Bell },
      { id: 'bagholder-rescue', label: '🆘 إنقاذ سهم خاسر', icon: LifeBuoy },
    ],
  },
  // ─── (5) 🎓 التعلّم ───
  {
    id: 'education',
    label: 'التعلّم',
    icon: GraduationCap,
    items: [
      { id: 'academy', label: 'الأكاديمية', icon: GraduationCap },
      { id: 'simulation', label: 'المحاكاة', icon: Gamepad2 },
    ],
  },
  // ─── (6) ⋯ المزيد ───
  {
    id: 'more',
    label: 'المزيد',
    icon: Menu,
    items: [
      { id: 'news', label: 'الأخبار', icon: Newspaper },
      { id: 'subscription', label: 'الاشتراك', icon: Crown, highlight: true },
      { id: 'settings', label: 'الإعدادات', icon: Settings },
      { id: 'sharia', label: 'التوافق الشرعي 🇪🇬', icon: ShieldCheck },
      { id: 'zakat', label: 'الزكاة', icon: Landmark },
      { id: 'tithes', label: 'العُشر', icon: Landmark },
      { id: 'about', label: 'من نحن', icon: Info },
    ],
  },
];

/* ════════════════════════════════════════════════════════════════════════
 * MobileNav — 5 أزرار سفلية (بدون تغيير)
 * ════════════════════════════════════════════════════════════════════════ */
export const bottomNavItems: NavItem[] = [
  { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'stocks', label: 'الأسهم', icon: CandlestickChart },
  { id: 'recommendations', label: 'التحليلات', icon: TrendingUp },
  { id: 'portfolio', label: 'المحفظة', icon: Wallet },
  { id: 'market-depth', label: 'السيولة', icon: Activity },
];

/* ════════════════════════════════════════════════════════════════════════
 * MobileMoreSheet — أقسام أخرى (بدون تغيير)
 * ════════════════════════════════════════════════════════════════════════ */
export const moreNavItems: NavItem[] = [
  { id: 'bagholder-rescue', label: '🆘 إنقاذ سهم خاسر', icon: LifeBuoy },
  { id: 'watchlist', label: 'قوائم المراقبة', icon: Eye },
  { id: 'simulation', label: 'المحاكاة', icon: Gamepad2 },
  { id: 'academy', label: 'الأكاديمية', icon: GraduationCap },
  { id: 'news', label: 'الأخبار', icon: Newspaper },
  { id: 'subscription', label: 'الاشتراك', icon: Crown, highlight: true },
  { id: 'zakat', label: 'الزكاة', icon: Landmark },
  { id: 'tithes', label: 'العُشر', icon: Landmark },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
  { id: 'about', label: 'من نحن', icon: Info },
];
