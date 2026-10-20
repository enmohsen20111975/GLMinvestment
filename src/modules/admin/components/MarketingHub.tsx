'use client';

/**
 * MarketingHub — محرّك التسويق المتكامل
 * ====================================================================
 *
 * "اجمع كل التيم" — التسويق + المبيعات + الـ CTO
 *
 * 4 أدوات قوية في مكان واحد:
 * 1. Campaign Builder — ولّد حملة كاملة بضغطة زر (كروت + نصوص + فيديو)
 * 2. Video Ad Generator — فيديو صامت بـ screenshots حقيقية + Ken Burns
 * 3. Image Cards — 3 مقاسات (مربع + ستوري + أفقي) للسوشيال
 * 4. Content Calendar — جدولة إعلانات يومية/أسبوعية + نصوص جاهزة
 *
 * كل أداة بتستخدم:
 * - ad-templates.ts (نصوص ثابتة)
 * - hashtag-library.ts (هاشتاجات منظمة)
 * - cta-templates.ts (CTAs مجرّبة)
 * - ad-card-generator.ts (كروت Canvas → PNG)
 * - Playwright (screenshots حقيقية)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
 Megaphone, Film, Image as ImageIcon, Calendar, Download, Copy, Check,
 Sparkles, Loader2, Clapperboard, Zap, Hash, Target, ChevronRight, TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
 Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AD_TEMPLATES, getAdTemplate } from '@/lib/ad-templates';
import { getHashtags, getInstagramHashtags, getTelegramHashtags, MARKET_OPTIONS, type Market } from '@/lib/hashtag-library';
import { getCTA, getCTAsByGoal, CTA_GOALS, type CTAGoal } from '@/lib/cta-templates';
import { generateCardSet, type CardFormat } from '@/lib/ad-card-generator';

type FeatureKey = keyof typeof AD_TEMPLATES;
type Tool = 'campaign' | 'video' | 'cards' | 'calendar';

const FEATURE_OPTIONS: { value: FeatureKey; label: string; emoji: string; accent: [string, string] }[] = [
 { value: 'radar', label: 'رادار السيولة', emoji: '🛰️', accent: ['#0ea5e9', '#0369a1'] },
 { value: 'predictions', label: 'التوقعات الذكية', emoji: '🎯', accent: ['#8b5cf6', '#6d28d9'] },
 { value: 'portfolio', label: 'المحفظة الذكية', emoji: '💼', accent: ['#10b981', '#047857'] },
 { value: 'risk', label: 'حاسبة المخاطر', emoji: '🛡️', accent: ['#f59e0b', '#b45309'] },
 { value: 'stockcard', label: 'كارت السهم', emoji: '🪙', accent: ['#ec4899', '#9d174d'] },
 { value: 'alerts', label: 'مركز التنبيهات', emoji: '🔔', accent: ['#ef4444', '#991b1b'] },
 { value: 'exit', label: 'رادار الخروج', emoji: '🚪', accent: ['#14b8a6', '#0f766e'] },
 { value: 'academy', label: 'أكاديمية التداول', emoji: '🎓', accent: ['#6366f1', '#4338ca'] },
];

const TOOLS: { id: Tool; label: string; icon: React.ReactNode; desc: string }[] = [
 { id: 'campaign', label: 'بناء حملة', icon: <Megaphone className="w-4 h-4" />, desc: 'كروت + نصوص + فيديو بضغطة زر' },
 { id: 'video', label: 'فيديو إعلاني', icon: <Film className="w-4 h-4" />, desc: 'صامت + screenshots + Ken Burns' },
 { id: 'cards', label: 'كروت صور', icon: <ImageIcon className="w-4 h-4" />, desc: '3 مقاسات للسوشيال' },
 { id: 'calendar', label: 'تقويم محتوى', icon: <Calendar className="w-4 h-4" />, desc: 'جدولة يومية/أسبوعية' },
];

// ─── Campaign Builder ───

function CampaignBuilder({ feature, market, ctaGoal }: { feature: FeatureKey; market: Market; ctaGoal: CTAGoal }) {
 const [generating, setGenerating] = useState(false);
 const [cards, setCards] = useState<{ format: CardFormat; dataUrl: string; filename: string }[]>([]);
 const [textPost, setTextPost] = useState<string>('');
 const [caption, setCaption] = useState<string>('');
 const [hashtags, setHashtags] = useState<string[]>([]);
 const [copied, setCopied] = useState<string | null>(null);

 const template = getAdTemplate(feature);
 const cta = getCTA(ctaGoal, 'intermediate');

 const generate = useCallback(() => {
 setGenerating(true);
 try {
 const featOpt = FEATURE_OPTIONS.find((f) => f.value === feature)!;

 // 1. Generate image cards (3 formats)
 const cardSet = generateCardSet({
 featureName: template.featureName,
 tagline: template.tagline,
 emoji: featOpt.emoji,
 accent: featOpt.accent,
 benefits: template.scenes.slice(0, 3).map((s) => s.headline),
 cta: cta.text,
 date: new Date().toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }),
 });
 setCards(cardSet);

 // 2. Generate text post (Telegram/Twitter ready)
 const tags = getTelegramHashtags(feature, market);
 setHashtags(tags);
 const post = `📊 ${template.featureName}\n\n${template.script}\n\n${cta.text}\n\n${tags.join(' ')}`;
 setTextPost(post);

 // 3. Caption (Instagram/Facebook)
 setCaption(`${template.caption}\n\n${cta.text}\n\n${getInstagramHashtags(feature, market).join(' ')}`);

 toast.success('تم بناء الحملة! كروت + نصوص + هاشتاجات جاهزة');
 } catch (err: any) {
 toast.error(err?.message || 'فشل بناء الحملة');
 } finally {
 setGenerating(false);
 }
 }, [feature, market, ctaGoal, template, cta]);

 const copyText = async (key: string, text: string) => {
 try {
 await navigator.clipboard.writeText(text);
 setCopied(key);
 toast.success('اتنسخ ✅');
 setTimeout(() => setCopied(null), 1800);
 } catch {
 toast.error('فشل النسخ');
 }
 };

 const downloadCard = (dataUrl: string, filename: string) => {
 const a = document.createElement('a');
 a.href = dataUrl;
 a.download = filename;
 a.click();
 };

 const downloadAll = () => {
 cards.forEach((c, i) => setTimeout(() => downloadCard(c.dataUrl, c.filename), i * 300));
 toast.success('جارٍ تحميل كل الكروت...');
 };

 return (
 <div className="space-y-6">
 {/* Generate button */}
 <div className="flex flex-wrap items-center gap-3">
 <Button
 onClick={generate}
 disabled={generating}
 size="lg"
 className="gap-2 bg-gradient-to-r from-warning to-loss hover:from-warning hover:to-loss text-foreground"
 >
 {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
 {generating ? 'بيبني الحملة...' : 'ابنِ الحملة كاملة'}
 </Button>
 {cards.length > 0 && (
 <Button onClick={downloadAll} variant="outline" size="lg" className="gap-2">
 <Download className="w-4 h-4" />
 تحميل كل الكروت (3)
 </Button>
 )}
 </div>

 {cards.length > 0 && (
 <>
 {/* Image Cards */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 <ImageIcon className="w-4 h-4 text-primary" />
 كروت الصور (3 مقاسات)
 </CardTitle>
 <CardDescription className="text-xs">
 مربع (إنستجرام) • عمودي (ستوري/ريلز) • أفقي (فيسبوك)
 </CardDescription>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
 {cards.map((card) => (
 <div key={card.format} className="space-y-2">
 <div className="relative rounded-lg overflow-hidden border border-border bg-black">
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img src={card.dataUrl} alt={card.format} className="w-full h-auto" />
 </div>
 <div className="flex items-center justify-between gap-2">
 <span className="text-xs text-muted-foreground capitalize">{card.format}</span>
 <Button size="sm" variant="outline" onClick={() => downloadCard(card.dataUrl, card.filename)} className="gap-1 h-7 text-xs">
 <Download className="w-3 h-3" />
 تحميل
 </Button>
 </div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Text Post */}
 <Card>
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-base">📝 نص للنشر (تيليجرام/تويتر)</CardTitle>
 <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => copyText('post', textPost)}>
 {copied === 'post' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
 {copied === 'post' ? 'اتنسخ' : 'نسخ'}
 </Button>
 </CardHeader>
 <CardContent>
 <Textarea value={textPost} readOnly rows={6} className="resize-none text-sm leading-relaxed" dir="rtl" />
 </CardContent>
 </Card>

 {/* Caption */}
 <Card>
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-base">📸 كابشن (إنستجرام/فيسبوك)</CardTitle>
 <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => copyText('caption', caption)}>
 {copied === 'caption' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
 {copied === 'caption' ? 'اتنسخ' : 'نسخ'}
 </Button>
 </CardHeader>
 <CardContent>
 <Textarea value={caption} readOnly rows={4} className="resize-none text-sm" dir="rtl" />
 </CardContent>
 </Card>

 {/* Hashtags */}
 <Card>
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-base flex items-center gap-2">
 <Hash className="w-4 h-4 text-primary" />
 هاشتاجات ({hashtags.length})
 </CardTitle>
 <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => copyText('tags', hashtags.join(' '))}>
 {copied === 'tags' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
 نسخ الكل
 </Button>
 </CardHeader>
 <CardContent>
 <div className="flex flex-wrap gap-1.5">
 {hashtags.map((h, i) => (
 <Badge key={i} variant="secondary" className="text-xs font-normal cursor-pointer hover:bg-primary/10" onClick={() => copyText(`tag-${i}`, h)}>
 {h}
 </Badge>
 ))}
 </div>
 </CardContent>
 </Card>
 </>
 )}

 {cards.length === 0 && !generating && (
 <Card className="border-dashed">
 <CardContent className="py-10 flex flex-col items-center text-center gap-3">
 <div className="w-12 h-12 rounded-full bg-gradient-to-br from-warning/20 to-loss/20 flex items-center justify-center">
 <Megaphone className="w-6 h-6 text-warning" />
 </div>
 <div>
 <p className="font-semibold">ابنِ حملة كاملة بضغطة زر</p>
 <p className="text-sm text-muted-foreground mt-1 max-w-md">
 3 كروت صور (مربع + ستوري + أفقي) + نص للنشر + كابشن + هاشتاجات.
 كله جاهز للتحميل والنشر المباشر.
 </p>
 </div>
 </CardContent>
 </Card>
 )}
 </div>
 );
}

// ─── Content Calendar ───

interface CalendarItem {
 day: string;
 feature: FeatureKey;
 type: 'video' | 'image' | 'text';
 goal: CTAGoal;
}

function ContentCalendar({ market }: { market: Market }) {
 const [schedule, setSchedule] = useState<CalendarItem[]>([]);

 const generateSchedule = useCallback(() => {
 const days = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
 const features: FeatureKey[] = ['radar', 'predictions', 'portfolio', 'risk', 'alerts', 'exit', 'academy'];
 const types: ('video' | 'image' | 'text')[] = ['video', 'image', 'text', 'image', 'video', 'text', 'image'];
 const goals: CTAGoal[] = ['signup', 'trial', 'follow', 'share', 'learn', 'subscribe', 'signup'];

 const newSchedule: CalendarItem[] = days.map((day, i) => ({
 day,
 feature: features[i % features.length],
 type: types[i],
 goal: goals[i],
 }));
 setSchedule(newSchedule);
 toast.success('اتعمل تقويم محتوى لأسبوع كامل');
 }, []);

 const copyDayContent = (item: CalendarItem) => {
 const template = getAdTemplate(item.feature);
 const cta = getCTA(item.goal);
 const tags = getHashtags(item.feature, market, item.type === 'video' ? 'video' : 'image', 10);
 const content = `📊 ${template.featureName}\n\n${template.script}\n\n${cta.text}\n\n${tags.join(' ')}`;
 navigator.clipboard.writeText(content);
 toast.success(`${item.day}: ${template.featureName} — اتنسخ ✅`);
 };

 const typeIcons = { video: <Film className="w-3.5 h-3.5" />, image: <ImageIcon className="w-3.5 h-3.5" />, text: <Copy className="w-3.5 h-3.5" /> };
 const typeLabels = { video: 'فيديو', image: 'كارت صورة', text: 'نص' };

 return (
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <p className="text-sm text-muted-foreground">جدول محتوى لأسبوع كامل — كل يوم ميزة + نوع + هدف</p>
 <Button onClick={generateSchedule} size="sm" variant="outline" className="gap-2">
 <Calendar className="w-4 h-4" />
 ولّد تقويم
 </Button>
 </div>

 {schedule.length === 0 ? (
 <Card className="border-dashed">
 <CardContent className="py-10 flex flex-col items-center text-center gap-3">
 <Calendar className="w-8 h-8 text-muted-foreground" />
 <p className="text-sm text-muted-foreground">اضغط "ولّد تقويم" لإنشاء جدول محتوى لأسبوع كامل</p>
 </CardContent>
 </Card>
 ) : (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
 {schedule.map((item, i) => {
 const template = getAdTemplate(item.feature);
 const featOpt = FEATURE_OPTIONS.find((f) => f.value === item.feature)!;
 return (
 <Card key={i} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => copyDayContent(item)}>
 <CardContent className="p-3">
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-bold text-muted-foreground">{item.day}</span>
 <Badge variant="outline" className="text-xs gap-1">
 {typeIcons[item.type]}
 {typeLabels[item.type]}
 </Badge>
 </div>
 <div className="flex items-center gap-2">
 <span className="text-lg">{featOpt.emoji}</span>
 <div className="min-w-0">
 <p className="text-sm font-semibold truncate">{template.featureName}</p>
 <p className="text-xs text-muted-foreground truncate">{template.tagline}</p>
 </div>
 </div>
 <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
 <Target className="w-3 h-3" />
 {CTA_GOALS.find((g) => g.value === item.goal)?.label}
 </div>
 </CardContent>
 </Card>
 );
 })}
 </div>
 )}
 </div>
 );
}

// ─── Main MarketingHub component ───

export function MarketingHub() {
 const [tool, setTool] = useState<Tool>('campaign');
 const [feature, setFeature] = useState<FeatureKey>('radar');
 const [market, setMarket] = useState<Market>('egx');
 const [ctaGoal, setCtaGoal] = useState<CTAGoal>('signup');

 return (
 <div className="space-y-6">
 {/* Header */}
 <Card className="border-whale/20 bg-gradient-to-br from-whale/5 via-cyan-500/5 to-sky-500/5">
 <CardHeader>
 <div className="flex items-start gap-3">
 <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-whale to-cyan-500 flex items-center justify-center shrink-0">
 <Megaphone className="w-6 h-6 text-foreground" />
 </div>
 <div className="flex-1 min-w-0">
 <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
 محرّك التسويق المتكامل
 <Badge variant="outline" className="text-xs gap-1">
 <TrendingUp className="w-3 h-3" />
 Marketing Hub
 </Badge>
 </CardTitle>
 <CardDescription className="mt-1">
 ولّد إعلانات احترافية بضغطة زر — كروت صور + فيديو + نصوص + هاشتاجات + تقويم محتوى.
 </CardDescription>
 </div>
 </div>
 </CardHeader>
 </Card>

 {/* Controls: feature + market + CTA goal */}
 <Card>
 <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
 <div className="space-y-2">
 <Label className="text-sm">الميزة المُعلَن عنها</Label>
 <Select value={feature} onValueChange={(v) => setFeature(v as FeatureKey)}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 {FEATURE_OPTIONS.map((f) => (
 <SelectItem key={f.value} value={f.value}>
 <span className="me-1">{f.emoji}</span> {f.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-2">
 <Label className="text-sm">السوق المستهدف</Label>
 <Select value={market} onValueChange={(v) => setMarket(v as Market)}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 {MARKET_OPTIONS.map((m) => (
 <SelectItem key={m.value} value={m.value}>
 <span className="me-1">{m.flag}</span> {m.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-2">
 <Label className="text-sm">هدف الإعلان (CTA)</Label>
 <Select value={ctaGoal} onValueChange={(v) => setCtaGoal(v as CTAGoal)}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 {CTA_GOALS.map((g) => (
 <SelectItem key={g.value} value={g.value}>
 <span className="me-1">{g.icon}</span> {g.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </CardContent>
 </Card>

 {/* Tool selector — plastic cards */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
 {TOOLS.map((t) => (
 <button
 key={t.id}
 onClick={() => setTool(t.id)}
 className={cn(
 'flex flex-col items-start gap-2 p-3 rounded-2xl border-2 text-right transition-all active:scale-95',
 tool === t.id
 ? 'border-primary bg-primary/5 shadow-md'
 : 'border-border bg-card hover:bg-accent/30',
 )}
 >
 <div className={cn(
 'w-9 h-9 rounded-xl flex items-center justify-center',
 tool === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted',
 )}>
 {t.icon}
 </div>
 <div>
 <p className="text-xs font-bold">{t.label}</p>
 <p className="text-xs text-muted-foreground leading-tight mt-0.5">{t.desc}</p>
 </div>
 </button>
 ))}
 </div>

 {/* Tool content */}
 {tool === 'campaign' && <CampaignBuilder feature={feature} market={market} ctaGoal={ctaGoal} />}

 {tool === 'calendar' && <ContentCalendar market={market} />}

 {tool === 'cards' && (
 <Card className="border-dashed">
 <CardContent className="py-10 flex flex-col items-center text-center gap-3">
 <ImageIcon className="w-10 h-10 text-muted-foreground" />
 <div>
 <p className="font-semibold">كروت صور فردية</p>
 <p className="text-sm text-muted-foreground mt-1">
 استخدم "بناء حملة" لتوليد 3 كروت بضغطة زر. كل كارت بـ 3 مقاسات (مربع + ستوري + أفقي).
 </p>
 </div>
 <Button onClick={() => setTool('campaign')} variant="outline" size="sm" className="gap-2 mt-2">
 <ChevronRight className="w-4 h-4" />
 روح لبناء حملة
 </Button>
 </CardContent>
 </Card>
 )}

 {tool === 'video' && (
 <Card className="border-dashed">
 <CardContent className="py-10 flex flex-col items-center text-center gap-3">
 <Film className="w-10 h-10 text-muted-foreground" />
 <div>
 <p className="font-semibold">فيديو إعلاني صامت</p>
 <p className="text-sm text-muted-foreground mt-1 max-w-md">
 الفيديو بيتحقّق من المتصفح (MediaRecorder + Canvas). افتح تبويب "مولّد الإعلانات" في لوحة الأدمن
 عشان تولّد الفيديو بـ screenshots حقيقية + Ken Burns + نصوص متحركة.
 </p>
 </div>
 <Button onClick={() => setTool('campaign')} variant="outline" size="sm" className="gap-2 mt-2">
 <ChevronRight className="w-4 h-4" />
 ولّد كروت أول
 </Button>
 </CardContent>
 </Card>
 )}
 </div>
 );
}
