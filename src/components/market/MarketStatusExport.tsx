'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Download, Send, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore, MARKET_NAMES_AR, MarketType } from '@/lib/store';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';
import {
 MarketStatusImageCard,
 MarketStatusStock,
} from '@/components/market/MarketStatusImageCard';

/* ------------------------------------------------------------------ */
/* Constants */
/* ------------------------------------------------------------------ */

const MARKET_CODES: Record<MarketType, string> = {
 EGX: 'EGX',
 TADAWUL: 'KSA',
 KSE: 'KSE',
 QSE: 'QSE',
 US: 'US',
 CRYPTO: 'CRYPTO',
};

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

/**
 * MarketStatusExport
 *
 * Wrapper around MarketStatusImageCard يقوم بـ:
 * 1. جلب بيانات السوق من /api/stocks (نفس مصدر التاب الأصلي)
 * 2. عرض البطاقة (للـ preview)
 * 3. زر "تحميل صورة" — يحوّل البطاقة إلى PNG عبر html-to-image
 * 4. زر "نشر على تيليجرام" — يحوّل البطاقة إلى PNG ثم يرسلها للـ backend
 * عبر /api/market/publish-status-image
 */
export function MarketStatusExport() {
 const currentMarket = useAppStore((s) => s.currentMarket);

 const [stocks, setStocks] = useState<MarketStatusStock[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [lastUpdate, setLastUpdate] = useState<string>('');

 const [downloading, setDownloading] = useState(false);
 const [publishing, setPublishing] = useState(false);

 const cardRef = useRef<HTMLDivElement>(null);

 /* ---------- data fetch ---------- */
 const fetchData = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 const marketCode = MARKET_CODES[currentMarket] === 'KSA' ? 'TADAWUL' : MARKET_CODES[currentMarket];
 const res = await fetch(
 `/api/stocks?market=${marketCode}&limit=500`,
 { cache: 'no-store' },
 );
 if (res.ok) {
 const data = await res.json();
 setStocks(data.stocks || []);
 setLastUpdate(new Date().toLocaleTimeString('ar-EG'));
 } else {
 setError('فشل في تحميل بيانات السوق');
 }
 } catch (err) {
 console.error('[MarketStatusExport] fetch error:', err);
 setError('فشل في الاتصال بالخادم');
 } finally {
 setLoading(false);
 }
 }, [currentMarket]);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 /* ---------- toPng helper ---------- */
 const captureCard = useCallback(async (): Promise<string | null> => {
 if (!cardRef.current) {
 toast.error('لا يمكن التقاط الصورة — البطاقة غير متاحة');
 return null;
 }
 try {
 const dataUrl = await toPng(cardRef.current, {
 quality: 0.95,
 pixelRatio: 2,
 backgroundColor: '#fff7ed',
 cacheBust: true,
 // skipFonts: true يمنع محاولة fetch fonts خارجية ويسرّع الـ snapshot
 skipFonts: true,
 style: {
 transform: 'scale(1)',
 transformOrigin: 'top right',
 },
 });
 return dataUrl;
 } catch (err) {
 console.error('[MarketStatusExport] toPng error:', err);
 toast.error('فشل في توليد الصورة');
 return null;
 }
 }, []);

 /* ---------- download ---------- */
 const handleDownload = useCallback(async () => {
 setDownloading(true);
 try {
 const dataUrl = await captureCard();
 if (!dataUrl) return;

 const now = new Date();
 const yyyy = now.getFullYear();
 const mm = String(now.getMonth() + 1).padStart(2, '0');
 const dd = String(now.getDate()).padStart(2, '0');
 const filename = `market-status-${currentMarket}-${yyyy}-${mm}-${dd}.png`;

 const link = document.createElement('a');
 link.download = filename;
 link.href = dataUrl;
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);

 toast.success('تم تحميل الصورة', {
 description: filename,
 });
 } finally {
 setDownloading(false);
 }
 }, [captureCard, currentMarket]);

 /* ---------- publish to telegram ---------- */
 const handlePublish = useCallback(async () => {
 setPublishing(true);
 try {
 const dataUrl = await captureCard();
 if (!dataUrl) return;

 const marketName = MARKET_NAMES_AR[currentMarket];
 const now = new Date();
 const dateStr = now.toLocaleDateString('ar-EG', {
 weekday: 'long',
 year: 'numeric',
 month: 'long',
 day: 'numeric',
 });
 // استخدام الـ caption الغني من MarketStatusTab لو موجود (يوليو 2026)
 // بيحتوي: stats, top gainer/loser, most active, breadth, adv/dec ratio
 const richCaption = typeof window !== 'undefined'
 ? (window as any).__marketStatusCaption as string | undefined
 : undefined;
 const baseCaption = richCaption || `📊 حالة السوق — ${marketName}\n📅 ${dateStr}`;
 const caption = `${baseCaption}\n\n${OFFICIAL_LINKS_BLOCK.trim()}`;

 const res = await fetch('/api/market/publish-status-image', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 image: dataUrl,
 market: currentMarket,
 caption,
 }),
 });

 const data = await res.json().catch(() => ({}));

 if (res.ok && data.success) {
 toast.success('تم النشر على تيليجرام', {
 description: data.message_id
 ? `رسالة #${data.message_id}`
 : undefined,
 });
 } else {
 const errMsg =
 data?.error_ar ||
 data?.error ||
 'فشل في النشر على تيليجرام';
 toast.error('فشل النشر', { description: errMsg });
 }
 } finally {
 setPublishing(false);
 }
 }, [captureCard, currentMarket]);

 /* ---------- UI ---------- */
 if (loading) {
 return (
 <Card className="border-orange-200">
 <CardContent className="p-4 space-y-3">
 <div className="flex items-center justify-between">
 <Skeleton className="h-6 w-48" />
 <Skeleton className="h-9 w-32" />
 </div>
 <Skeleton className="h-64 w-full" />
 </CardContent>
 </Card>
 );
 }

 if (error) {
 return (
 <Card className="border-destructive">
 <CardContent className="p-4 text-center">
 <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
 <p className="text-destructive mb-3 text-sm">{error}</p>
 <Button variant="outline" size="sm" onClick={fetchData}>
 <RefreshCw className="h-4 w-4 ml-2" />
 إعادة المحاولة
 </Button>
 </CardContent>
 </Card>
 );
 }

 const busy = downloading || publishing;

 return (
 <Card className="border-orange-200 from-orange-50 via-warning to-orange-100/40">
 <CardContent className="p-4 space-y-4">
 {/* العنوان + الأزرار */}
 <div className="flex items-center justify-between flex-wrap gap-3">
 <div>
 <h3 className="text-base font-bold text-warning flex items-center gap-2">
 <span className="text-xl">🖼️</span>
 بطاقة حالة السوق (قابلة للمشاركة)
 </h3>
 <p className="text-xs text-warning/80 mt-1">
 حمّل صورة جاهزة للنشر أو انشرها مباشرة على قناة تيليجرام
 </p>
 </div>
 <div className="flex items-center gap-2 flex-wrap">
 <Button
 variant="outline"
 size="sm"
 onClick={fetchData}
 disabled={busy}
 className="border-orange-300 text-warning hover:bg-warning"
 >
 <RefreshCw className="h-4 w-4 ml-1" />
 تحديث
 </Button>
 <Button
 size="sm"
 onClick={handleDownload}
 disabled={busy}
 className="bg-warning hover:bg-warning text-white"
 >
 {downloading ? (
 <Loader2 className="h-4 w-4 ml-1 animate-spin" />
 ) : (
 <Download className="h-4 w-4 ml-1" />
 )}
 تحميل صورة
 </Button>
 <Button
 size="sm"
 onClick={handlePublish}
 disabled={busy}
 className="bg-profit hover:bg-profit text-white"
 >
 {publishing ? (
 <Loader2 className="h-4 w-4 ml-1 animate-spin" />
 ) : (
 <Send className="h-4 w-4 ml-1" />
 )}
 نشر على تيليجرام
 </Button>
 </div>
 </div>

 {/* معاينة البطاقة — نضعها في scroll-container عشان الـ 800px
 ما يكسرش الـ layout على الموبايل */}
 <div className="overflow-x-auto rounded-xl bg-white/40 p-2">
 <div className="flex justify-center">
 <MarketStatusImageCard
 ref={cardRef}
 market={currentMarket}
 stocks={stocks}
 lastUpdate={lastUpdate}
 />
 </div>
 </div>
 </CardContent>
 </Card>
 );
}
