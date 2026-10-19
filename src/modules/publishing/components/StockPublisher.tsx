'use client';

/**
 * StockPublisher — مكون النشر الموحّد للسهم
 * ============================================================================
 *
 * يدمج كل البيانات المبعثرة (توقّع، خطة تداول، سيولة، فنية، أساسيات،
 * حالة السوق) في بطاقة غنية واحدة + نص منسّق جاهز للّصق على
 * Telegram / WhatsApp / Facebook / Twitter + تصدير صورة PNG.
 *
 * الـ Visual Card بيتبع نفس الـ style بتاع Smart Entry Card في MakerRadarTab
 * (الـ accent colors + الـ Progress bars + الـ Badge combinations).
 *
 * ⚠️ هذا المكوّن SPECIALIZED للأسهم. الـ UnifiedPublishButton يظل كما هو
 * للنشر العام (الأخبار، التقارير، إلخ).
 *
 * PROPS:
 * - data: StockPublishData — كل بيانات السهم المطلوبة للنشر (مطلوب)
 * - trigger?: React.ReactNode — زرار مخصص لفتح الـ Dialog
 * - variant?: 'button' | 'icon' | 'full' (default 'button')
 * - size?: 'sm' | 'md' | 'lg' (default 'md')
 * - className?: كلاسات إضافية للزرار
 *
 * Tabs:
 * - معاينة البطاقة: StockPublishCard مرئية (نفس الـ style بتاع Smart Entry Card)
 * - النص: النص العربي المنسّق جاهز للّصق
 * - صورة: تحميل البطاقة كـ PNG عبر html-to-image
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { toPng } from 'html-to-image';
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
 DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
 Share2,
 Copy,
 Download,
 Send,
 MessageCircle,
 Facebook,
 TrendingUp,
 TrendingDown,
 Target,
 Shield,
 Activity,
 Zap,
 Brain,
 AlertCircle,
 CheckCircle2,
 Loader2,
 Gauge,
 Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
import { toast } from 'sonner';
// Server-safe text generation + types re-exported from the shared module so the
// /api/telegram/publish-stock route can reuse generatePublishText server-side.
import {
 MARKET_REGIME_AR,
 generatePublishText,
 generatePublishPayload,
} from '@/modules/publishing/lib/stock-publish-text';
import { useSession } from 'next-auth/react';
import { useAppStore } from '@/lib/store';
import { isAdmin, adminFetch } from '@/lib/admin-auth';
// MERGE-LIST-CARDS + TELEGRAM-LINK: pull in StockInfographicCard so the
// "نشر على تيليجرام" button captures the unified infographic card as a PNG
// (instead of the legacy StockPublishCard) and sends image+caption to the
// Telegram bot publish route — per owner directive:
// "الكارت الموحد يكون هو بتاع التليجرام بتاع البوت الى فية تحليل السهم وبياناته".
import {
 StockInfographicCard,
 type StockInfographicCardProps,
} from './StockInfographicCard';

// ============================================================================
// Types — re-exported from the shared module (backward compat)
// ============================================================================

export type Recommendation = import('@/modules/publishing/lib/stock-publish-text').Recommendation;
export type MarketRegime = import('@/modules/publishing/lib/stock-publish-text').MarketRegime;
export type StockPublishData = import('@/modules/publishing/lib/stock-publish-text').StockPublishData;

export {
 generatePublishText,
 generatePublishPayload,
} from '@/modules/publishing/lib/stock-publish-text';

export interface StockPublisherProps {
 data: StockPublishData;
 /**
 * TELEGRAM-LINK: optional infographic payload (StockInfographicCardProps['data']).
 * When provided, the admin "نشر على تيليجرام" button renders the unified
 * StockInfographicCard off-screen, captures it as a PNG via html-to-image,
 * and sends image+caption to /api/telegram/publish-stock (multipart/form-data).
 * When omitted, falls back to the legacy text-only JSON publish.
 */
 infographicData?: StockInfographicCardProps['data'];
 trigger?: React.ReactNode;
 variant?: 'button' | 'icon' | 'full';
 size?: 'sm' | 'md' | 'lg';
 className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const RECOMMENDATION_META: Record<
 Recommendation,
 { ar: string; emoji: string; badgeClass: string; icon: React.ReactNode }
> = {
 STRONG_BUY: {
 ar: 'شراء قوي',
 emoji: '',
 badgeClass:
 'bg-profit text-profit border-profit /60 ',
 icon: <TrendingUp className="h-3.5 w-3.5" />,
 },
 BUY: {
 ar: 'شراء',
 emoji: '✅',
 badgeClass:
 'bg-profit text-profit border-profit /40 /60',
 icon: <TrendingUp className="h-3.5 w-3.5" />,
 },
 INSTITUTIONAL_BUY: {
 ar: 'شراء مؤسسي',
 emoji: '🏛️',
 badgeClass:
 'bg-primary text-primary border-primary /40 /60',
 icon: <Shield className="h-3.5 w-3.5" />,
 },
 HOLD: {
 ar: 'احتفاظ',
 emoji: '⏸️',
 badgeClass:
 'bg-warning text-warning border-warning /40 /60',
 icon: <Activity className="h-3.5 w-3.5" />,
 },
 SELL: {
 ar: 'بيع',
 emoji: '🔻',
 badgeClass:
 'bg-loss text-loss border-loss /40 /60',
 icon: <TrendingDown className="h-3.5 w-3.5" />,
 },
};

// (MARKET_REGIME_AR is imported from @/modules/publishing/lib/stock-publish-text above)

// ============================================================================
// Component — StockPublisher (main entry)
// ============================================================================

export function StockPublisher({
 data,
 infographicData,
 trigger,
 variant = 'button',
 size = 'md',
 className,
}: StockPublisherProps) {
 const [open, setOpen] = useState(false);
 const [activeTab, setActiveTab] = useState<'preview' | 'text' | 'image'>(
 'preview'
 );
 const [copied, setCopied] = useState(false);
 const [publishing, setPublishing] = useState<string | null>(null);
 const [capturingImage, setCapturingImage] = useState(false);
 const [sendingToTelegramBot, setSendingToTelegramBot] = useState(false);
 const cardRef = useRef<HTMLDivElement>(null);
 // TELEGRAM-LINK: separate ref for the off-screen StockInfographicCard so the
 // admin "نشر على تيليجرام" button can capture the unified card as PNG.
 const infographicCardRef = useRef<HTMLDivElement>(null);

 // Admin check — the "نشر على تيليجرام" (channel bot) button is admin-only.
 // Regular users still get Telegram/WhatsApp/Facebook share-URL buttons.
 const { data: session } = useSession();
 const storeUser = useAppStore((s) => s.user);
 const userEmail = storeUser?.email || session?.user?.email || '';
 const username =
 (storeUser as { username?: string; name?: string } | null)?.username ||
 (storeUser as { username?: string; name?: string } | null)?.name ||
 (session?.user as { username?: string; name?: string } | null)?.username ||
 (session?.user as { username?: string; name?: string } | null)?.name ||
 '';
 const isAdminUser =
 (storeUser as { is_admin?: boolean } | null)?.is_admin === true ||
 (storeUser as { subscription_tier?: string } | null)?.subscription_tier === 'admin' ||
 (session?.user as { is_admin?: boolean } | null)?.is_admin === true ||
 (session?.user as { subscription_tier?: string } | null)?.subscription_tier === 'admin' ||
 isAdmin(userEmail, username) ||
 isAdmin(username, userEmail);

 // Generate the rich text card (Arabic, formatted for Telegram/WhatsApp)
 const publishText = useMemo(() => generatePublishText(data), [data]);

 const handleCopy = useCallback(async () => {
 try {
 await navigator.clipboard.writeText(publishText);
 setCopied(true);
 toast.success('تم نسخ نص التحليل إلى الحافظة');
 setTimeout(() => setCopied(false), 1800);
 } catch (e) {
 console.error('[StockPublisher] copy failed:', e);
 toast.error('فشل نسخ النص — حاول مرة تانية');
 }
 }, [publishText]);

 const handlePublish = useCallback(
 async (channel: 'telegram' | 'facebook' | 'whatsapp' | 'twitter') => {
 setPublishing(channel);
 try {
 const encodedText = encodeURIComponent(publishText);
 const shareUrl = encodeURIComponent(window.location.href);
 let url = '';
 if (channel === 'telegram') {
 url = `https://t.me/share/url?url=${shareUrl}&text=${encodedText}`;
 } else if (channel === 'whatsapp') {
 url = `https://wa.me/?text=${encodedText}`;
 } else if (channel === 'facebook') {
 url = `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}&quote=${encodedText}`;
 } else if (channel === 'twitter') {
 url = `https://twitter.com/intent/tweet?text=${encodedText}`;
 }
 window.open(url, '_blank', 'noopener,noreferrer,width=600,height=600');
 toast.success(`تم فتح ${channel} للنشر`);
 } catch (e) {
 console.error('[StockPublisher] publish failed:', e);
 toast.error('فشل فتح منصة النشر');
 } finally {
 setTimeout(() => setPublishing(null), 800);
 }
 },
 [publishText]
 );

 const handleDownloadImage = useCallback(async () => {
 if (!cardRef.current) {
 toast.error('البطاقة غير متاحة للالتقاط');
 return;
 }
 setCapturingImage(true);
 try {
 const dataUrl = await toPng(cardRef.current, {
 cacheBust: true,
 pixelRatio: 2,
 backgroundColor: '#ffffff',
 skipFonts: true,
 });
 const now = new Date();
 const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
 const link = document.createElement('a');
 link.download = `${data.ticker}-publish-${stamp}.png`;
 link.href = dataUrl;
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 toast.success('تم تحميل بطاقة السهم كصورة PNG');
 } catch (e) {
 console.error('[StockPublisher] image capture failed:', e);
 toast.error('فشل التقاط الصورة — حاول مرة تانية');
 } finally {
 setCapturingImage(false);
 }
 }, [data.ticker]);

 const sizeButtonClasses =
 size === 'sm' ? 'h-8 px-3 text-xs gap-1.5' : size === 'lg' ? 'h-11 px-6 text-base gap-2' : 'h-9 px-4 text-sm gap-2';

 // ─── Publish directly to the Telegram bot (channel post) ───
 // Admin-only. Sends the rich Arabic text to the configured Telegram channel
 // via the backend /api/telegram/publish-stock route (which calls the bot API).
 //
 // TELEGRAM-LINK: when `infographicData` is provided, capture the unified
 // StockInfographicCard as a PNG (via the off-screen infographicCardRef) and
 // send image+caption as multipart/form-data — the route uses Telegram
 // sendPhoto to deliver the full infographic card to subscribers.
 // When omitted, fall back to the legacy JSON text-only publish.
 const handlePublishToTelegramBot = useCallback(async () => {
 setSendingToTelegramBot(true);
 try {
 const ticker = data.ticker;
 const market = data.market || 'EGX';
 const caption = publishText;

 // ── Branch A: infographic available → multipart image+caption publish ──
 if (infographicData && infographicCardRef.current) {
 const el = infographicCardRef.current;
 const saved = {
 overflow: el.style.overflow,
 height: el.style.height,
 width: el.style.width,
 maxHeight: el.style.maxHeight,
 transform: el.style.transform,
 };
 let dataUrl: string | null = null;
 try {
 // Expand + reset transforms so the full 800px-wide card is captured
 // without clipping (the off-screen container scales it down to 0.35
 // for visual hiding — we must undo that during capture).
 el.style.overflow = 'visible';
 el.style.height = `${el.scrollHeight}px`;
 el.style.width = `${el.scrollWidth}px`;
 el.style.maxHeight = 'none';
 el.style.transform = 'none';
 void el.offsetWidth; // force reflow

 dataUrl = await toPng(el, {
 cacheBust: true,
 pixelRatio: 2.5,
 backgroundColor: '#070b13',
 width: el.scrollWidth,
 height: el.scrollHeight,
 style: { transform: 'none', margin: '0' },
 skipFonts: false,
 });
 } catch (err) {
 console.error('[StockPublisher] infographic capture failed:', err);
 toast.error('فشل التقاط صورة الكارت الموحد — سيتم إرسال النص فقط');
 } finally {
 el.style.overflow = saved.overflow;
 el.style.height = saved.height;
 el.style.width = saved.width;
 el.style.maxHeight = saved.maxHeight;
 el.style.transform = saved.transform;
 }

 if (dataUrl) {
 const blobRes = await fetch(dataUrl);
 const blob = await blobRes.blob();
 const formData = new FormData();
 formData.append('ticker', ticker);
 formData.append('name_ar', infographicData.name_ar || data.nameAr || ticker);
 formData.append('market', market);
 formData.append('caption', caption);
 formData.append('image', blob, `${ticker}-infographic.png`);

 const res = await adminFetch('/api/telegram/publish-stock', {
 method: 'POST',
 body: formData,
 });
 const json = await res.json().catch(() => ({} as Record<string, unknown>));
 if (!res.ok || !json?.success) {
 const errMsg =
 (json?.error as string | undefined) ||
 `فشل النشر على تيليجرام (HTTP ${res.status})`;
 toast.error(errMsg);
 return;
 }
 const msgId = json?.message_id;
 const sentAsPhoto = json?.sent_as_photo === true;
 toast.success(
 msgId
 ? `تم نشر ${ticker} على قناة تيليجرام ✅ (message_id: ${msgId}${sentAsPhoto ? ' · صورة' : ''})`
 : `تم نشر ${ticker} على قناة تيليجرام ✅`
 );
 return;
 }
 // capture returned null → fall through to text-only publish below
 }

 // ── Branch B: text-only JSON publish (fallback) ──
 const res = await adminFetch('/api/telegram/publish-stock', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 ticker,
 market,
 caption,
 }),
 });
 const json = await res.json().catch(() => ({} as Record<string, unknown>));
 if (!res.ok || !json?.success) {
 const errMsg =
 (json?.error as string | undefined) ||
 `فشل النشر على تيليجرام (HTTP ${res.status})`;
 toast.error(errMsg);
 return;
 }
 const msgId = json?.message_id;
 toast.success(
 msgId
 ? `تم نشر ${ticker} على قناة تيليجرام ✅ (message_id: ${msgId})`
 : `تم نشر ${ticker} على قناة تيليجرام ✅`
 );
 } catch (e) {
 console.error('[StockPublisher] telegram bot publish failed:', e);
 toast.error('فشل الاتصال بالبوت — حاول مرة تانية');
 } finally {
 setSendingToTelegramBot(false);
 }
 }, [data.ticker, data.market, data.nameAr, infographicData, publishText]);

 return (
 <Dialog open={open} onOpenChange={setOpen}>
 <DialogTrigger asChild>
 {trigger || (
 <Button
 variant="default"
 size="sm"
 className={cn(sizeButtonClasses, className)}
 aria-label="نشر تحليل السهم"
 >
 <Share2 className="h-4 w-4" />
 {variant !== 'icon' && <span>نشر السهم</span>}
 </Button>
 )}
 </DialogTrigger>
 <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" dir="rtl">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-lg">
 <Share2 className="h-5 w-5 text-profit " />
 نشر تحليل:{' '}
 <span className="font-mono text-profit ">
 {data.ticker}
 </span>
 </DialogTitle>
 </DialogHeader>

 <Tabs
 value={activeTab}
 onValueChange={(v) => setActiveTab(v as 'preview' | 'text' | 'image')}
 >
 <TabsList className="grid w-full grid-cols-3">
 <TabsTrigger value="preview">
 <Layers className="h-3.5 w-3.5 ml-1.5" />
 معاينة البطاقة
 </TabsTrigger>
 <TabsTrigger value="text">
 <Copy className="h-3.5 w-3.5 ml-1.5" />
 النص
 </TabsTrigger>
 <TabsTrigger value="image">
 <Download className="h-3.5 w-3.5 ml-1.5" />
 صورة
 </TabsTrigger>
 </TabsList>

 {/* Preview Tab — rich visual card */}
 <TabsContent value="preview" className="mt-4">
 <div ref={cardRef}>
 <StockPublishCard data={data} />
 </div>
 </TabsContent>

 {/* Text Tab — raw text for copy/paste */}
 <TabsContent value="text" className="mt-4">
 <Card className="bg-muted/30">
 <CardContent className="p-3">
 <pre
 className="text-xs sm:text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground/90"
 dir="rtl"
 >
 {publishText}
 </pre>
 </CardContent>
 </Card>
 </TabsContent>

 {/* Image Tab — download as image */}
 <TabsContent value="image" className="mt-4">
 <Card className="p-4 text-center">
 <Download className="h-12 w-12 mx-auto mb-2 text-muted-foreground" />
 <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
 حمّل البطاقة كصورة PNG عالية الجودة (×2) جاهزة للنشر على أي
 منصة.
 </p>
 <Button
 onClick={handleDownloadImage}
 variant="default"
 disabled={capturingImage}
 className="gap-2"
 >
 {capturingImage ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <Download className="h-4 w-4" />
 )}
 {capturingImage ? 'جارٍ الالتقاط...' : 'تحميل كصورة PNG'}
 </Button>
 </Card>
 </TabsContent>
 </Tabs>

 {/* Publishing actions */}
 <div className="flex items-center gap-2 flex-wrap pt-4 border-t border-border">
 <Button
 onClick={handleCopy}
 variant="outline"
 size="sm"
 className="gap-1.5"
 >
 {copied ? (
 <CheckCircle2 className="h-4 w-4 text-profit" />
 ) : (
 <Copy className="h-4 w-4" />
 )}
 {copied ? 'تم النسخ' : 'نسخ النص'}
 </Button>

 <Button
 onClick={() => handlePublish('telegram')}
 variant="outline"
 size="sm"
 disabled={publishing === 'telegram'}
 className="gap-1.5"
 >
 {publishing === 'telegram' ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <Send className="h-4 w-4 text-sky-500" />
 )}
 تيليجرام
 </Button>

 <Button
 onClick={() => handlePublish('whatsapp')}
 variant="outline"
 size="sm"
 disabled={publishing === 'whatsapp'}
 className="gap-1.5"
 >
 {publishing === 'whatsapp' ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <MessageCircle className="h-4 w-4 text-profit" />
 )}
 واتساب
 </Button>

 <Button
 onClick={() => handlePublish('facebook')}
 variant="outline"
 size="sm"
 disabled={publishing === 'facebook'}
 className="gap-1.5"
 >
 {publishing === 'facebook' ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <Facebook className="h-4 w-4 text-primary" />
 )}
 فيسبوك
 </Button>

 {/* Admin-only: publish directly to the Telegram channel via the bot */}
 {isAdminUser && (
 <Button
 onClick={handlePublishToTelegramBot}
 variant="default"
 size="sm"
 disabled={sendingToTelegramBot}
 className="gap-1.5 bg-sky-600 hover:bg-sky-700 text-foreground"
 title="ينشر التحليل مباشرة على قناة تيليجرام عبر البوت"
 >
 {sendingToTelegramBot ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <Send className="h-4 w-4" />
 )}
 نشر على تيليجرام
 </Button>
 )}
 </div>

 {/* TELEGRAM-LINK: off-screen StockInfographicCard mount.
 Rendered only when `infographicData` is provided so the admin
 "نشر على تيليجرام" button can capture it as PNG via html-to-image.
 The container is visually hidden (absolute + scaled down) but
 kept in the layout so the card renders fully with real dimensions
 (html-to-image needs the DOM node to be live, not display:none). */}
 {infographicData && (
 <div
 aria-hidden
 style={{
 position: 'absolute',
 left: '-99999px',
 top: 0,
 width: '800px',
 pointerEvents: 'none',
 opacity: 1,
 }}
 >
 <div
 style={{
 transform: 'scale(0.5)',
 transformOrigin: 'top left',
 width: '800px',
 }}
 >
 <StockInfographicCard data={infographicData} cardRef={infographicCardRef} />
 </div>
 </div>
 )}
 </DialogContent>
 </Dialog>
 );
}

// ============================================================================
// StockPublishCard — rich visual card (reference: radar_card_publisher + Smart Entry Card)
// ============================================================================

function StockPublishCard({ data }: { data: StockPublishData }) {
 const isUp = (data.changePct ?? 0) >= 0;
 const recMeta = data.recommendation
 ? RECOMMENDATION_META[data.recommendation]
 : null;

 const buyPressure = data.buyPressure ?? 0;
 const sellPressure = data.sellPressure ?? 0;
 const totalPressure = buyPressure + sellPressure;
 const buyPct = totalPressure > 0 ? (buyPressure / totalPressure) * 100 : 50;

 const signalCount = data.signalCount ?? 0;
 const maxSignals = data.maxSignals ?? 6;
 const signalPct = maxSignals > 0 ? (signalCount / maxSignals) * 100 : 0;

 const rsi = data.rsi;
 const rsiState =
 rsi == null
 ? null
 : rsi > 70
 ? 'overbought'
 : rsi < 30
 ? 'oversold'
 : 'neutral';

 return (
 <Card className="border-2 border-profit/60 /40 overflow-hidden">
 {/* Header — gradient + ticker + recommendation */}
 <div className="bg-profit /40 px-4 py-3 border-b border-profit /30">
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-2">
 <div className="h-9 w-9 rounded-lg bg-profit flex items-center justify-center text-foreground font-bold text-sm font-mono shadow-sm">
 {data.ticker.slice(0, 2)}
 </div>
 <div>
 <div className="flex items-center gap-1.5">
 <span className="font-bold text-base text-foreground">
 {data.ticker}
 </span>
 {data.sector && (
 <Badge variant="outline" className="text-xs h-4 px-1.5">
 <Layers className="h-2.5 w-2.5 ml-0.5" />
 {data.sector}
 </Badge>
 )}
 </div>
 {data.nameAr && (
 <div className="text-xs text-muted-foreground truncate max-w-[220px]">
 {data.nameAr}
 </div>
 )}
 </div>
 </div>
 {recMeta && (
 <Badge
 variant="outline"
 className={cn(
 'text-xs h-7 px-2.5 gap-1 font-semibold',
 recMeta.badgeClass
 )}
 >
 {recMeta.icon}
 {recMeta.emoji} {recMeta.ar}
 {data.confidence != null && data.confidence > 0 && (
 <span className="opacity-80 font-mono">
 · {(data.confidence ?? 0).toFixed(0)}%
 </span>
 )}
 </Badge>
 )}
 </div>
 </div>

 <CardContent className="p-4 space-y-3">
 {/* Price + change */}
 <div className="flex items-end justify-between">
 <div>
 <div className="text-xs text-muted-foreground mb-0.5">
 السعر الحالي
 </div>
 <div className="text-2xl font-bold font-mono">
 {fmtNum(data.currentPrice)}
 <span className="text-xs text-muted-foreground mr-1.5 font-normal">
 EGP
 </span>
 </div>
 </div>
 {data.changePct != null && (
 <div
 className={cn(
 'flex items-center gap-1 font-bold font-mono text-sm',
 isUp
 ? 'text-profit '
 : 'text-loss '
 )}
 >
 {isUp ? (
 <TrendingUp className="h-4 w-4" />
 ) : (
 <TrendingDown className="h-4 w-4" />
 )}
 {isUp ? '+' : ''}
 {(data.changePct ?? 0).toFixed(2)}%
 </div>
 )}
 </div>

 {/* Reason */}
 {data.reason && (
 <div className="bg-muted/40 rounded-md p-2 text-xs leading-relaxed text-foreground/90">
 <span className="font-semibold ml-1">📝 السبب:</span>
 {data.reason}
 </div>
 )}

 {/* Trading Plan grid */}
 {(data.entryPrice != null ||
 data.targetPrice1 != null ||
 data.targetPrice2 != null ||
 data.stopLoss != null) && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
 <TradingTile
 label="نقطة الدخول"
 value={data.entryPrice != null ? fmtNum(data.entryPrice) : null}
 sub={
 data.entryZoneLow != null && data.entryZoneHigh != null
 ? `${fmtNum(data.entryZoneLow)} - ${fmtNum(data.entryZoneHigh)}`
 : undefined
 }
 accent="blue"
 icon={<Target className="h-3 w-3" />}
 />
 <TradingTile
 label="الهدف 1"
 value={data.targetPrice1 != null ? fmtNum(data.targetPrice1) : null}
 sub={
 data.targetPrice1 != null && data.currentPrice
 ? `+${((data.targetPrice1 - data.currentPrice) / data.currentPrice * 100).toFixed(1)}%`
 : undefined
 }
 accent="emerald"
 icon={<TrendingUp className="h-3 w-3" />}
 />
 <TradingTile
 label="الهدف 2"
 value={data.targetPrice2 != null ? fmtNum(data.targetPrice2) : null}
 sub={
 data.targetPrice2 != null && data.currentPrice
 ? `+${((data.targetPrice2 - data.currentPrice) / data.currentPrice * 100).toFixed(1)}%`
 : undefined
 }
 accent="emerald"
 icon={<TrendingUp className="h-3 w-3" />}
 />
 <TradingTile
 label="وقف الخسارة"
 value={data.stopLoss != null ? fmtNum(data.stopLoss) : null}
 sub={
 data.stopLoss != null && data.currentPrice
 ? `${((data.stopLoss - data.currentPrice) / data.currentPrice * 100).toFixed(1)}%`
 : undefined
 }
 accent="rose"
 icon={<Shield className="h-3 w-3" />}
 />
 </div>
 )}

 {/* Risk-Reward + Position Size */}
 {(data.riskReward != null || data.positionSize != null) && (
 <div className="flex items-center gap-3 flex-wrap text-xs">
 {data.riskReward != null && (
 <Badge
 variant="outline"
 className="gap-1 font-mono font-semibold text-warning bg-warning/50 /20 border-warning /50"
 >
 <Gauge className="h-3 w-3" />
 R:R {(data.riskReward ?? 0).toFixed(1)}:1
 </Badge>
 )}
 {data.positionSize != null && (
 <Badge
 variant="outline"
 className="gap-1 font-mono font-semibold bg-muted/50"
 >
 <Activity className="h-3 w-3" />
 حجم المركز: {(data.positionSize ?? 0).toFixed(1)}%
 </Badge>
 )}
 </div>
 )}

 {/* Signal Strength */}
 {(data.signalCount != null || data.path) && (
 <div className="bg-primary/60 /20 rounded-md p-2.5 space-y-1.5 border border-primary/60 /30">
 <div className="flex items-center justify-between text-xs">
 <span className="font-semibold text-primary flex items-center gap-1">
 <Zap className="h-3.5 w-3.5" />
 قوة الإشارة
 </span>
 <span className="font-mono font-bold">
 {signalCount}/{maxSignals}
 {data.path && (
 <span className="text-muted-foreground mr-1 text-xs">
 · {data.path}
 </span>
 )}
 </span>
 </div>
 {data.signalCount != null && (
 <Progress value={signalPct} className="h-1.5" />
 )}
 </div>
 )}

 {/* Liquidity — buy/sell pressure + net flow */}
 {(data.buyPressure != null ||
 data.sellPressure != null ||
 data.netFlow != null ||
 data.volumeRatio != null) && (
 <div className="bg-muted/30 rounded-md p-2.5 space-y-2 border border-border/50">
 <div className="flex items-center justify-between text-xs">
 <span className="font-semibold flex items-center gap-1">
 <Activity className="h-3.5 w-3.5 text-primary " />
 حركة السيولة
 </span>
 {data.netFlow != null && (
 <span
 className={cn(
 'font-mono text-xs font-bold',
 data.netFlow >= 0
 ? 'text-profit '
 : 'text-loss '
 )}
 >
 {data.netFlow >= 0 ? '+' : '-'}
 {Math.abs(data.netFlow / 1e6).toFixed(1)}M EGP
 </span>
 )}
 </div>
 {(data.buyPressure != null || data.sellPressure != null) && (
 <div className="space-y-1">
 <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
 <div
 className="bg-profit "
 style={{ width: `${buyPct}%` }}
 />
 <div
 className="bg-loss "
 style={{ width: `${100 - buyPct}%` }}
 />
 </div>
 <div className="flex items-center justify-between text-xs font-mono">
 <span className="text-profit ">
 شراء {(buyPressure ?? 0).toFixed(0)}%
 </span>
 <span className="text-loss ">
 بيع {(sellPressure ?? 0).toFixed(0)}%
 </span>
 </div>
 </div>
 )}
 {data.volumeRatio != null && (
 <div className="flex items-center justify-between text-xs text-muted-foreground">
 <span>نسبة الحجم (10d/20d)</span>
 <span
 className={cn(
 'font-mono font-semibold',
 data.volumeRatio >= 1.5
 ? 'text-profit font-bold'
 : data.volumeRatio < 0.7
 ? 'text-loss font-bold'
 : 'text-foreground'
 )}
 >
 {(data.volumeRatio ?? 0).toFixed(2)}×
 </span>
 </div>
 )}
 </div>
 )}

 {/* Technical indicators */}
 {(rsi != null ||
 data.sma20 != null ||
 data.sma50 != null ||
 data.sma200 != null ||
 data.atr != null) && (
 <div className="bg-muted/30 rounded-md p-2.5 space-y-1.5 border border-border/50">
 <div className="text-xs font-semibold flex items-center gap-1 mb-1">
 <Gauge className="h-3.5 w-3.5 text-primary " />
 المؤشرات الفنية
 </div>
 <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1 text-xs">
 {rsi != null && (
 <IndicatorRow
 label="RSI(14)"
 value={(rsi ?? 0).toFixed(1)}
 state={
 rsiState === 'overbought'
 ? '⚠️ تشبع شرائي'
 : rsiState === 'oversold'
 ? '⚠️ تشبع بيعي'
 : '✅ محايد'
 }
 stateClass={
 rsiState === 'overbought'
 ? 'text-loss '
 : rsiState === 'oversold'
 ? 'text-warning '
 : 'text-muted-foreground'
 }
 />
 )}
 {data.sma20 != null && (
 <IndicatorRow
 label="SMA20"
 value={(data.sma20 ?? 0).toFixed(2)}
 />
 )}
 {data.sma50 != null && (
 <IndicatorRow
 label="SMA50"
 value={(data.sma50 ?? 0).toFixed(2)}
 />
 )}
 {data.sma200 != null && (
 <IndicatorRow
 label="SMA200"
 value={(data.sma200 ?? 0).toFixed(2)}
 />
 )}
 {data.atr != null && (
 <IndicatorRow label="ATR" value={(data.atr ?? 0).toFixed(2)} />
 )}
 </div>
 </div>
 )}

 {/* Fundamentals */}
 {(data.peRatio != null ||
 data.pbRatio != null ||
 data.roe != null ||
 data.marketCap != null) && (
 <div className="bg-muted/30 rounded-md p-2.5 space-y-1.5 border border-border/50">
 <div className="text-xs font-semibold flex items-center gap-1 mb-1">
 <Brain className="h-3.5 w-3.5 text-warning " />
 الأساسيات
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-xs">
 {data.peRatio != null && (
 <IndicatorRow label="P/E" value={(data.peRatio ?? 0).toFixed(1)} />
 )}
 {data.pbRatio != null && (
 <IndicatorRow label="P/B" value={(data.pbRatio ?? 0).toFixed(1)} />
 )}
 {data.roe != null && (
 <IndicatorRow
 label="ROE"
 value={`${(data.roe ?? 0).toFixed(1)}%`}
 />
 )}
 {data.marketCap != null && (
 <IndicatorRow
 label="القيمة السوقية"
 value={`${fmtMoney(data.marketCap)} EGP`}
 />
 )}
 </div>
 </div>
 )}

 {/* Analysis summary */}
 {data.analysisSummary && (
 <div className="bg-primary/40 /15 rounded-md p-2.5 text-xs leading-relaxed border border-purple-100/50 dark:border-purple-900/30">
 <div className="font-semibold text-primary mb-1 flex items-center gap-1 text-xs">
 <Brain className="h-3.5 w-3.5" />
 ملخص التحليل
 </div>
 <p className="text-foreground/90">{data.analysisSummary}</p>
 </div>
 )}

 {/* Market regime */}
 {data.marketRegime && (
 <div className="flex items-center justify-between text-xs">
 <span className="text-muted-foreground">حالة السوق</span>
 <Badge variant="outline" className="text-xs h-6 px-2">
 {MARKET_REGIME_AR[data.marketRegime]}
 </Badge>
 </div>
 )}
 </CardContent>

 {/* Footer */}
 <div className="bg-muted/40 border-t border-border/50 px-4 py-2 text-center text-xs text-muted-foreground">
 📍 منصة دليل الاستثمار — {OFFICIAL_LINKS.website}
 </div>
 </Card>
 );
}

// ============================================================================
// Sub-components
// ============================================================================

interface TradingTileProps {
 label: string;
 value: string | null;
 sub?: string;
 accent: 'blue' | 'emerald' | 'rose';
 icon?: React.ReactNode;
}

function TradingTile({ label, value, sub, accent, icon }: TradingTileProps) {
 const colors: Record<
 TradingTileProps['accent'],
 { bg: string; text: string; border: string }
 > = {
 blue: {
 bg: 'bg-primary/70 /30',
 text: 'text-primary ',
 border: 'border-primary/60 /40',
 },
 emerald: {
 bg: 'bg-profit/70 /30',
 text: 'text-profit ',
 border: 'border-profit/60 /40',
 },
 rose: {
 bg: 'bg-loss/70 /30',
 text: 'text-loss ',
 border: 'border-loss/60 /40',
 },
 };
 const c = colors[accent];
 return (
 <div
 className={cn(
 'rounded-md p-2 border text-center',
 c.bg,
 c.text,
 c.border
 )}
 >
 <div className="flex items-center justify-center gap-1 text-xs mb-0.5 opacity-80">
 {icon}
 {label}
 </div>
 <div className="font-mono font-bold text-sm">
 {value ?? '—'}
 </div>
 {sub && (
 <div className="text-xs opacity-70 mt-0.5 font-mono">{sub}</div>
 )}
 </div>
 );
}

function IndicatorRow({
 label,
 value,
 state,
 stateClass,
}: {
 label: string;
 value: string;
 state?: string;
 stateClass?: string;
}) {
 return (
 <div className="flex items-baseline justify-between">
 <span className="text-muted-foreground">{label}</span>
 <span className="font-mono font-semibold">
 {value}
 {state && (
 <span className={cn('mr-1 text-xs', stateClass || '')}>
 {state}
 </span>
 )}
 </span>
 </div>
 );
}

// ============================================================================
// Helpers (used by StockPublishCard visual rendering — fmtNum + fmtMoney)
// ============================================================================
// generatePublishText + generatePublishPayload now live in the server-safe
// @/modules/publishing/lib/stock-publish-text module (re-exported above) so the Telegram bot
// API route can reuse them without importing a 'use client' file.
// ============================================================================

function fmtNum(n: number | null | undefined, digits = 2): string {
 if (n == null || !Number.isFinite(n as number)) return '—';
 return Number(n).toLocaleString('en-US', {
 maximumFractionDigits: digits,
 minimumFractionDigits: 0,
 });
}

function fmtMoney(n: number | null | undefined): string {
 if (n == null || !Number.isFinite(n as number)) return '—';
 const num = Number(n);
 if (Math.abs(num) >= 1_000_000_000)
 return `${(num / 1_000_000_000).toFixed(2)}B`;
 if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
 if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
 return (num ?? 0).toFixed(0);
}

export default StockPublisher;
