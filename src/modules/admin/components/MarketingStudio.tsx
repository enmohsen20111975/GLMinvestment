'use client';

/**
 * MarketingStudio.tsx — الاستوديو الموحّد للتسويق والنشر
 * ====================================================================
 *
 * كل أدوات التسويق في **مكان واحد** (مش 3 تبويبات منفصلة):
 *
 * 📣 التسويق — Campaign Builder + Image Cards + Content Calendar
 * 🎬 الفيديو — محرر كامل شبه CapCut (frames + نصوص + تأثيرات + ألوان)
 * 🎓 المحتوى — كروت تعليمية + صفقات ناجحة (ديناميكي)
 *
 * المستخدم بيتنقّل بينهم بـ tabs جوّه نفس الصفحة — زي CapCut.
 */

import React, { useState, lazy, Suspense } from 'react';
import { Megaphone, Film, GraduationCap, Sparkles } from 'lucide-react';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LazyTabLoader } from '@/components/shared/LazyTabLoader';

// Lazy load للـ 3 مكونات (بس أول ما تتفتح بتفضل loaded)
const VideoEditor = lazy(() => import('./VideoEditor').then(m => ({ default: m.VideoEditor })));
const ContentStudioHub = lazy(() => import('./ContentStudioHub').then(m => ({ default: m.ContentStudioHub })));
const MarketingHub = lazy(() => import('./MarketingHub').then(m => ({ default: m.MarketingHub })));

type StudioTab = 'marketing' | 'video' | 'content';

const TABS: { id: StudioTab; label: string; icon: React.ReactNode; desc: string }[] = [
 { id: 'marketing', label: 'التسويق', icon: <Megaphone className="w-4 h-4" />, desc: 'حملات + كروت + تقويم' },
 { id: 'video', label: 'محرر الفيديو', icon: <Film className="w-4 h-4" />, desc: 'تحكم كامل — شبه CapCut' },
 { id: 'content', label: 'المحتوى', icon: <GraduationCap className="w-4 h-4" />, desc: 'كروت تعليمية + صفقات' },
];

export function MarketingStudio() {
 const [activeTab, setActiveTab] = useState<StudioTab>('video'); // default: محرر الفيديو

 return (
 <div className="space-y-4">
 {/* Header */}
 <WidgetCard
 title="استوديو التسويق والنشر"
 icon={Sparkles}
 className="border-whale/20 via-cyan-500/5 to-violet-500/5"
 headerClassName="pb-0"
 contentClassName="hidden"
 badge={<Badge variant="outline" className="text-xs">كل الأدوات في مكان واحد</Badge>}
 hideRefresh
 />

 {/* Tabs selector — plastic cards */}
 <div className="grid grid-cols-3 gap-2.5">
 {TABS.map((tab) => (
 <button
 key={tab.id}
 onClick={() => setActiveTab(tab.id)}
 className={cn(
 'flex items-center gap-2.5 p-3 rounded-2xl border-2 transition-all active:scale-95',
 activeTab === tab.id
 ? 'border-primary bg-primary/5 shadow-md'
 : 'border-border bg-card hover:bg-accent/30',
 )}
 >
 <div className={cn(
 'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
 activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'bg-muted',
 )}>
 {tab.icon}
 </div>
 <div className="text-right min-w-0">
 <p className="text-xs font-bold truncate">{tab.label}</p>
 <p className="text-xs text-muted-foreground truncate">{tab.desc}</p>
 </div>
 </button>
 ))}
 </div>

 {/* Active tab content */}
 <Suspense fallback={<LazyTabLoader label="بيتحمّل..." />}>
 {activeTab === 'marketing' && <MarketingHub />}
 {activeTab === 'video' && <VideoEditor />}
 {activeTab === 'content' && <ContentStudioHub />}
 </Suspense>
 </div>
 );
}
