/**
 * nav-config.ts — المصدر الوحيد للقوائم الثلاث (TopBar / MobileNav / MobileMoreSheet)
 * =====================================================================
 * الترتيب المطلوب من المالك (2026-10-19):
 *
 * TopBar → 6 بوابات:
 * 1. home — الرئيسية → dashboard
 * 2. market — السوق → stocks / liquidity-radar / trading-chart
 * 3. analysis — التحليل → recommendations / market-depth ★
 * 4. portfolio — محفظتي → portfolio / watchlist / alerts-center / bagholder-rescue
 * 5. education — التعلّم → academy / simulation
 * 6. more — المزيد → news / subscription ★ / settings / sharia 🇪🇬 / zakat / tithes / about
 *
 * MobileNav → 5 أزرار (بدون تغيير):
 * dashboard / stocks / recommendations / portfolio / market-depth
 *
 * MobileMoreSheet → أقسام أخرى (بدون تغيير):
 * bagholder-rescue / watchlist / simulation / academy / news / subscription / zakat / tithes / settings / about
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
 * TopBar — 6 بوابات (الترتيب المطلوب من المالك)
 * ════════════════════════════════════════════════════════════════════════ */
export const navSections: NavSection[] = [
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
      { id: 'liquidity-radar', label: 'رادار السيولة', icon: Activity },
      { id: 'trading-chart', label: 'الشارت التفاعلي', icon: BarChart3 },
      // ALPHA-UX-FIX-7: اتنقلوا من #recommendations tabs لروابط مستقلة تحت السوق
      { id: 'market-status', label: 'حالة السوق', icon: Activity },
      { id: 'historical-trades', label: 'الصفقات التاريخية', icon: History },
    ],
  },
  {
    id: 'analysis',
    label: 'التحليل',
    icon: Target,
    items: [
      { id: 'recommendations', label: 'التحليلات', icon: Target },
      { id: 'market-depth', label: 'سيولة المستثمرين', icon: Activity, highlight: true },
    ],
  },
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
  {
    id: 'education',
    label: 'التعلّم',
    icon: GraduationCap,
    items: [
      { id: 'academy', label: 'الأكاديمية', icon: GraduationCap },
      { id: 'simulation', label: 'المحاكاة', icon: Gamepad2 },
    ],
  },
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
