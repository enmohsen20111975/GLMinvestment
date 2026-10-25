/**
 * admin-view/admin-hubs.tsx
 * ========================
 * The 6 Core Admin Hubs config (Stream C / ADMIN-HUBS-REORG).
 *
 * Originally a single `ADMIN_HUBS` constant inlined at line ~1007 inside the
 * AdminView function body (because it depends on `feedbackCount` state for the
 * "feedback" tab count badge).
 *
 * Extracted here as a builder function `buildAdminHubs(feedbackCount?)` so the
 * container stays thin and the hub taxonomy lives in one searchable place.
 *
 * Each hub: id + Arabic label + shortLabel + icon + tailwind accent classes +
 * list of tabs (each: id + label + icon + optional count + optional desc).
 *
 * Tabs map 1:1 to AdminTab union members in types.ts. Adding a new tab to the
 * nav = add an entry here + ensure the AdminView container renders it.
 */

'use client';

import React from 'react';
import {
 Activity,
 Brain,
 BarChart3,
 Clock,
 Cpu,
 Database,
 DollarSign,
 FileText,
 Gauge,
 HeartPulse,
 MessageSquareText,
 Monitor,
 Newspaper,
 Send,
 Settings,
 Shield,
 ShieldAlert,
 Sparkles,
 Ticket,
 Users,
 Zap,
} from 'lucide-react';
import type { AdminHub } from './types';

// ADMIN-CONSOLIDATION (2026-10-25): 30 tabs → 15 tabs
// دمج التبويبات المتداخلة والمكررة في تبويبات موحّدة
export function buildAdminHubs(feedbackCount?: number): AdminHub[] {
 return [
 {
 id: 'health',
 label: 'المراقبة وصحة النظام',
 shortLabel: 'المراقبة',
 icon: <Activity className="w-4 h-4" />,
 accent: 'border-profit/20 bg-profit/5',
 tabs: [
 // دمج: dashboard + problems → dashboard (نظرة عامة + صحة + مشاكل)
 { id: 'dashboard', label: 'لوحة التحكم', icon: <Activity className="w-3.5 h-3.5" />, desc: 'نظرة عامة + صحة + مشاكل النظام' },
 // دمج: system-monitor + cron-health → system-monitor (CPU/RAM/DB + cron)
 { id: 'system-monitor', label: 'مراقبة الموارد', icon: <Monitor className="w-3.5 h-3.5" />, desc: 'CPU/RAM/DB + حالة المهام' },
 ],
 },
 {
 id: 'maestro',
 label: 'المحركات والتعلم الذكي',
 shortLabel: 'المحركات',
 icon: <Zap className="w-4 h-4" />,
 accent: 'border-warning/20 bg-warning/5',
 tabs: [
 // دمج: engine-control-room + general + data-engine → engine-control
 { id: 'engine-control', label: '🎮 غرفة تحكم المحركات', icon: <Cpu className="w-3.5 h-3.5" />, desc: 'كل المحركات + كونسول + تحكم + سكرابر' },
 { id: 'engine-settings', label: 'إعدادات المحرك', icon: <Settings className="w-3.5 h-3.5" />, desc: 'أوزان + بارامترات' },
 { id: 'learning', label: 'التعلم الذكي', icon: <Brain className="w-3.5 h-3.5" />, desc: 'تعلّم + توقعات' },
 // دمج: backtest + platform-performance → performance
 { id: 'performance', label: 'الأداء والاختبار', icon: <Gauge className="w-3.5 h-3.5" />, desc: 'باك تست + كفاءة المنصة' },
 ],
 },
 {
 id: 'data',
 label: 'البيانات وقواعد البيانات',
 shortLabel: 'البيانات',
 icon: <Database className="w-4 h-4" />,
 accent: 'border-sky-500/40 bg-sky-500/5',
 tabs: [
 // دمج: data-health + validation-monitor → data-health
 { id: 'data-health', label: 'صحة البيانات', icon: <HeartPulse className="w-3.5 h-3.5" />, desc: 'طزاجة + تحقق + حقول باطلة' },
 { id: 'investors-entry', label: 'تدفق المستثمرين', icon: <Users className="w-3.5 h-3.5" />, desc: 'إدخال يدوي بيانات مصريين/عرب/أجانب' },
 // دمج: databases + db-backup → databases
 { id: 'databases', label: 'قواعد البيانات', icon: <Database className="w-3.5 h-3.5" />, desc: 'إدارة DBs + نسخ احتياطي' },
 { id: 'system-control', label: 'تحكم شامل', icon: <Settings className="w-3.5 h-3.5" />, desc: 'scraper + sync + cron' },
 // دمج: news-control + news-health → news
 { id: 'news', label: 'الأخبار', icon: <Newspaper className="w-3.5 h-3.5" />, desc: 'إدارة + صحة مصادر' },
 // دمج: source-authority + sharia → quality
 { id: 'quality', label: 'الفحص والجودة', icon: <Shield className="w-3.5 h-3.5" />, desc: 'سلطة المصادر + فحص شرعي' },
 ],
 },
 {
 id: 'users',
 label: 'المستخدمين والاشتراكات',
 shortLabel: 'المستخدمين',
 icon: <Users className="w-4 h-4" />,
 accent: 'border-loss/20 bg-loss/5',
 tabs: [
 // دمج: user-management + users → users
 { id: 'users', label: 'المستخدمين', icon: <Users className="w-3.5 h-3.5" />, desc: 'إدارة + تحليلات + behavior' },
 // دمج: pricing + promo-codes → subscriptions
 { id: 'subscriptions', label: 'الاشتراكات', icon: <DollarSign className="w-3.5 h-3.5" />, desc: 'تسعير + أكواد خصم + بوابات' },
 { id: 'feedback', label: 'آراء المستخدمين', icon: <MessageSquareText className="w-3.5 h-3.5" />, count: feedbackCount, desc: 'ملاحظات + شكاوى' },
 ],
 },
 {
 id: 'telegram',
 label: 'أدوات التسويق والنشر',
 shortLabel: 'التسويق',
 icon: <Send className="w-4 h-4" />,
 accent: 'border-whale/20 bg-whale/5',
 tabs: [
 { id: 'marketing-studio', label: 'استوديو التسويق', icon: <Sparkles className="w-3.5 h-3.5" />, desc: 'فيديو + كروت + حملات + تقويم' },
 { id: 'reports', label: 'التقارير الذكية', icon: <FileText className="w-3.5 h-3.5" />, desc: 'يومية + أسبوعية + PDF' },
 // دمج: telegram + telegram-predictions → telegram
 { id: 'telegram', label: 'تيليجرام', icon: <Send className="w-3.5 h-3.5" />, desc: 'bot + نشر + تدقيق توقعات' },
 ],
 },
 ];
}
