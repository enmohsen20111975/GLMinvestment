'use client';

/**
 * ContentStudioHub — استوديو المحتوى المتحرك
 * ====================================================================
 *
 * بديل AdGeneratorTab — بيدّي قيمة حقيقية:
 *
 * أداتين في مكان واحد:
 * 1. EducationalCardsStudio
 * - بيحوّل المحتوى التعليمي (content/education/) لكروت فيديو
 * - نصوص متحركة بتأثيرات (fade / slideUp / typewriter / marquee / glow / bounce)
 * - فيديو صامت — المستخدم بيضيف الموسيقى
 *
 * 2. TradesShowcase
 * - بياخد الصفقات الناجحة (من /api/predictions/honest-tracking/list)
 * - بيعرضها كروت متتابعة بفاصل زمني
 * - تأثيرات كتير (zoomIn للرقم + typewriter للنص + glow للربح)
 * - فيديو صامت قابل للتحميل
 *
 * الـ output: WebM صامت — جاهز للنشر على تيك-توك/ريلز
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
 GraduationCap, TrendingUp, Play, Download, Loader2, Settings2,
 Film, Copy, Check, Sparkles, Type, Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
 Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
 drawAnimatedText, drawAnimatedMultilineText, EFFECT_PRESETS, EFFECT_OPTIONS,
 type TextEffect, type TextAnimationConfig,
} from '@/lib/text-effects';

type Studio = 'educational' | 'trades';

interface Scene {
 /** مدة المشهد بالثواني */
 duration: number;
 /** نصوص المتحركة */
 texts: TextAnimationConfig[];
 /** لون الخلفية (hex) */
 bgColor?: string;
 /** emoji كبير في النص */
 emoji?: string;
}

// ─── Helper: رسم خلفية + emoji ───

function drawBackground(
 ctx: CanvasRenderingContext2D,
 W: number, H: number,
 bgColor: string,
 emoji?: string,
 progress: number = 0,
) {
 // خلفية: gradient بسيط
 const grad = ctx.createLinearGradient(0, 0, 0, H);
 grad.addColorStop(0, bgColor);
 grad.addColorStop(1, '#0f172a');
 ctx.fillStyle = grad;
 ctx.fillRect(0, 0, W, H);

 // emoji كبير في النص (مع pulse خفيف)
 if (emoji) {
 const pulse = 1 + 0.05 * Math.sin(progress * Math.PI * 2);
 ctx.save();
 ctx.font = `${Math.round(W * 0.18 * pulse)}px system-ui`;
 ctx.textAlign = 'center';
 ctx.textBaseline = 'middle';
 ctx.globalAlpha = 0.95;
 ctx.fillText(emoji, W / 2, H * 0.3);
 ctx.restore();
 }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
 const radius = Math.min(r, w / 2, h / 2);
 ctx.beginPath();
 ctx.moveTo(x + radius, y);
 ctx.arcTo(x + w, y, x + w, y + h, radius);
 ctx.arcTo(x + w, y + h, x, y + h, radius);
 ctx.arcTo(x, y + h, x, y, radius);
 ctx.arcTo(x, y, x + w, y, radius);
 ctx.closePath();
}

// ─── Educational Cards Studio ───

const EDUCATIONAL_LESSONS = [
 { id: 'psychology', title: 'سيكولوجيا التداول', emoji: '🧠', bg: '#7c3aed', points: [
 'الخوف والطمع أعداء المتداول',
 'الالتزام بالخطة أهم من الانفعالات',
 'الخسارة جزء من اللعبة — تعلّم منها',
 ]},
 { id: 'stages', title: 'تحليل المراحل', emoji: '📊', bg: '#0ea5e9', points: [
 'المرحلة 1: التجميع (الذكي يشتري)',
 'المرحلة 2: الارتداد (التأكيد)',
 'المرحلة 3: الاختراق (الانطلاق)',
 ]},
 { id: 'canslim', title: 'استراتيجية CAN SLIM', emoji: '🎯', bg: '#10b981', points: [
 'C: Current Quarterly Earnings (+25%)',
 'A: Annual Earnings Growth (+25%)',
 'N: New Products / New Highs',
 'S: Supply & Demand (Volume)',
 ]},
 { id: 'mean_reversion', title: 'Mean Reversion', emoji: '↩️', bg: '#f59e0b', points: [
 'السعر بيرجع لمتوسطه دايماً',
 'اشترِ لما السعر يبتعد عن المتوسط',
 'بِع لما يرجع للـ fair value',
 ]},
 { id: 'risk', title: 'إدارة المخاطر', emoji: '🛡️', bg: '#ef4444', points: [
 'مخاطرة 1-2% بس من رأس المال',
 'وقف الخسارة قبل ما تشتري',
 'نسبة RR ≥ 1:2 إجبارية',
 ]},
 { id: 'price_action', title: 'Price Action', emoji: '📈', bg: '#8b5cf6', points: [
 'الشموع بتروي قصة السوق',
 'الدعوم والمقاومات = خريطة السوق',
 'الفوليوم يؤكّد الحركة',
 ]},
 { id: 'legends', title: 'قصص نجاح', emoji: '🏆', bg: '#ec4899', points: [
 'وارن بافيت: استثمر في ما تفهمه',
 'بيتر لينش: استثمر في حياتك اليومية',
 'جيسي ليفرمور: التزم بالترند',
 ]},
 { id: 'crypto', title: 'أساسيات الكريبتو', emoji: '₿', bg: '#f97316', points: [
 'البيتكوين: الذهب الرقمي',
 'البلوكشين: دفتر أستاذ لامركزي',
 'مفتاحك الخاص = فلوسك',
 ]},
];

function buildLessonScenes(lesson: typeof EDUCATIONAL_LESSONS[0]): Scene[] {
 // Scene 1: intro (5s)
 const intro: Scene = {
 duration: 5,
 bgColor: lesson.bg,
 emoji: lesson.emoji,
 texts: [
 { ...EFFECT_PRESETS.headline, text: lesson.title, color: '#ffffff' },
 { ...EFFECT_PRESETS.subtext, text: 'درس من أكاديمية التداول', color: 'rgba(255,255,255,0.8)' },
 ],
 };

 // Scene 2..N: كل نقطة (5s لكل نقطة)
 const pointScenes: Scene[] = lesson.points.map((point, i) => ({
 duration: 5,
 bgColor: lesson.bg,
 texts: [
 { ...EFFECT_PRESETS.headline, text: lesson.title, color: '#ffffff', fontSize: 40 },
 { ...EFFECT_PRESETS.number, text: `${i + 1}`, color: '#fbbf24', delay: 0.2 },
 { ...EFFECT_PRESETS.bullet, text: point, color: '#ffffff', delay: 0.5, fontSize: 32 },
 ],
 }));

 // Scene الأخير: CTA (3s)
 const cta: Scene = {
 duration: 3,
 bgColor: lesson.bg,
 emoji: '🎓',
 texts: [
 { ...EFFECT_PRESETS.cta, text: 'تعلّم أكثر في أكاديمية التداول', color: '#ffffff' },
 { ...EFFECT_PRESETS.hashtag, text: '#تعلم_التداول #أكاديمية_التداول', delay: 0.4 },
 ],
 };

 return [intro, ...pointScenes, cta];
}

// ─── Trades Showcase ───

interface SuccessfulTrade {
 ticker: string;
 entryPrice: number;
 exitPrice: number;
 returnPct: number;
 signal: string;
 daysHeld: number;
}

// بيانات تجريبية للصفقات (تُستبدل بـ API call في الإنتاج)
const SAMPLE_TRADES: SuccessfulTrade[] = [
 { ticker: 'COMI', entryPrice: 18.5, exitPrice: 22.3, returnPct: 20.5, signal: 'تجميع قوي', daysHeld: 12 },
 { ticker: 'HRHO', entryPrice: 32.1, exitPrice: 38.7, returnPct: 20.6, signal: 'اختراق مقاومة', daysHeld: 8 },
 { ticker: 'TMGH', entryPrice: 15.2, exitPrice: 17.9, returnPct: 17.8, signal: 'انفجار حجمي', daysHeld: 15 },
];

function buildTradeScenes(trades: SuccessfulTrade[]): Scene[] {
 // Scene 1: intro (4s)
 const intro: Scene = {
 duration: 4,
 bgColor: '#059669',
 emoji: '🚀',
 texts: [
 { ...EFFECT_PRESETS.headline, text: 'صفقات ناجحة', color: '#ffffff' },
 { ...EFFECT_PRESETS.subtext, text: 'من منصة استثمارية ذكية', color: 'rgba(255,255,255,0.85)' },
 ],
 };

 // لكل صفقة: scene (5s)
 const tradeScenes: Scene[] = trades.map((t, i) => ({
 duration: 5,
 bgColor: '#059669',
 emoji: '📈',
 texts: [
 { ...EFFECT_PRESETS.headline, text: t.ticker, color: '#ffffff', fontSize: 64 },
 { ...EFFECT_PRESETS.number, text: `+${(t.returnPct ?? 0).toFixed(1)}%`, color: '#fbbf24', delay: 0.3 },
 { ...EFFECT_PRESETS.bullet, text: `دخول: ${(t.entryPrice ?? 0).toFixed(2)} → خروج: ${(t.exitPrice ?? 0).toFixed(2)}`, color: '#ffffff', delay: 0.6 },
 { ...EFFECT_PRESETS.subtext, text: t.signal, color: 'rgba(255,255,255,0.85)', delay: 0.9, fontSize: 28 },
 { ...EFFECT_PRESETS.hashtag, text: `#${t.ticker} #صفقة_ناجحة`, delay: 1.2 },
 ],
 }));

 // CTA أخير (3s)
 const cta: Scene = {
 duration: 3,
 bgColor: '#059669',
 emoji: '🎯',
 texts: [
 { ...EFFECT_PRESETS.cta, text: 'احصل على إشاراتك اليومية', color: '#ffffff' },
 { ...EFFECT_PRESETS.hashtag, text: '#توقعات_الأسهم #EGX', delay: 0.4 },
 ],
 };

 return [intro, ...tradeScenes, cta];
}

// ─── Video Renderer (canvas + MediaRecorder) ───

function useVideoRenderer() {
 const canvasRef = useRef<HTMLCanvasElement>(null);
 const [renderState, setRenderState] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
 const [renderProgress, setRenderProgress] = useState(0);
 const [videoUrl, setVideoUrl] = useState<string | null>(null);
 const cancelRef = useRef(false);

 const render = useCallback(async (scenes: Scene[]) => {
 const canvas = canvasRef.current;
 if (!canvas) {
 toast.error('الكانيڤاس مش متاح');
 return;
 }
 const ctx = canvas.getContext('2d');
 if (!ctx) {
 toast.error('المتصفح مش بيدعم Canvas 2D');
 setRenderState('error');
 return;
 }

 cancelRef.current = false;
 setRenderState('rendering');
 setRenderProgress(0);
 if (videoUrl) URL.revokeObjectURL(videoUrl);
 setVideoUrl(null);

 const W = 1080;
 const H = 1920;
 const totalDuration = scenes.reduce((s, sc) => s + sc.duration, 0);

 const stream = canvas.captureStream(30);
 const mimeCandidates = [
 'video/webm;codecs=vp9',
 'video/webm;codecs=vp8',
 'video/webm;codecs=h264',
 'video/webm',
 ];
 const mimeType = mimeCandidates.find((c) => MediaRecorder.isTypeSupported(c)) || 'video/webm';

 const recorder = new MediaRecorder(stream, {
 mimeType,
 videoBitsPerSecond: 4_000_000,
 });
 const chunks: Blob[] = [];
 recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

 const finished = new Promise<Blob>((resolve) => {
 recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
 });

 recorder.start(100);
 const startTime = performance.now();

 const draw = () => {
 if (cancelRef.current) {
 if (recorder.state !== 'inactive') recorder.stop();
 return;
 }
 const elapsed = (performance.now() - startTime) / 1000;
 const t = Math.min(elapsed, totalDuration);
 const gp = totalDuration > 0 ? t / totalDuration : 0;
 setRenderProgress(gp);

 // نلاقي الـ scene الحالي
 let acc = 0;
 let currentScene: Scene | null = null;
 let sceneStart = 0;
 for (const sc of scenes) {
 if (t < acc + sc.duration) {
 currentScene = sc;
 sceneStart = acc;
 break;
 }
 acc += sc.duration;
 }
 if (!currentScene) {
 currentScene = scenes[scenes.length - 1];
 sceneStart = totalDuration - currentScene.duration;
 }

 const sceneProgress = (t - sceneStart) / currentScene.duration;

 // رسم
 ctx.clearRect(0, 0, W, H);
 drawBackground(ctx, W, H, currentScene.bgColor || '#1e1b4b', currentScene.emoji, sceneProgress);

 // رسم النصوص
 const centerY = H * 0.55;
 currentScene.texts.forEach((textConfig, i) => {
 const yOffset = (i - (currentScene!.texts.length - 1) / 2) * H * 0.08;
 drawAnimatedText(ctx, textConfig, W / 2, centerY + yOffset, sceneProgress, currentScene!.duration);
 });

 // progress bar سفلي
 ctx.fillStyle = 'rgba(255,255,255,0.12)';
 ctx.fillRect(W * 0.08, H * 0.965, W * 0.84, H * 0.006);
 ctx.fillStyle = '#ffffff';
 ctx.fillRect(W * 0.08, H * 0.965, W * 0.84 * gp, H * 0.006);

 if (elapsed < totalDuration + 0.1) {
 requestAnimationFrame(draw);
 } else {
 setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 150);
 }
 };
 requestAnimationFrame(draw);

 const blob = await finished;
 stream.getTracks().forEach((t) => t.stop());
 const url = URL.createObjectURL(blob);
 setVideoUrl(url);
 setRenderState('done');
 setRenderProgress(1);
 toast.success('تم إنتاج الفيديو! 🎬');
 }, [videoUrl]);

 const cancel = useCallback(() => {
 cancelRef.current = true;
 setRenderState('idle');
 toast.info('تم الإلغاء');
 }, []);

 const download = useCallback((filename: string) => {
 if (!videoUrl) return;
 const a = document.createElement('a');
 a.href = videoUrl;
 a.download = filename;
 a.click();
 }, [videoUrl]);

 return { canvasRef, renderState, renderProgress, videoUrl, render, cancel, download };
}

// ─── Real data fetching (NEW — uses actual APIs) ───

interface RealLesson {
 id: string;
 title: string;
 emoji: string;
 level: string;
 duration: string;
 tagline: string;
 keyPoints: string[];
 sections: { heading: string; content: string }[];
}

interface RealTrade {
 id: string;
 ticker: string;
 signal: string;
 entryPrice: number;
 exitPrice: number;
 targetPrice: number;
 stopLoss: number;
 returnPct: number;
 confidence: number;
 market: string;
 holdingDays: number;
 riskReward: number;
 exitReason: string;
 hitTarget: boolean;
}

// Fallback بيانات لو الـ API فشل (للـ sandbox بدون DB)
const FALLBACK_LESSONS = [
 { id: '01', title: 'التمويل السلوكي + SOPs', emoji: '🧠', bg: '#7c3aed', points: ['Loss Aversion (2.25×)', '5 Cognitive Biases', 'بروتوكولات تنفيذية'] },
 { id: '04', title: 'Mean Reversion الرياضي', emoji: '↩️', bg: '#f59e0b', points: ['Z-Score', 'التوزيع الطبيعي', 'Kurtosis + Fat Tails'] },
 { id: '05', title: 'إدارة المخاطر الكمية', emoji: '🛡️', bg: '#ef4444', points: ['Kelly Criterion', 'Sharpe + Sortino', 'Maximum Drawdown'] },
 { id: '06', title: 'Wyckoff + Auction Theory', emoji: '📈', bg: '#8b5cf6', points: ['Spring / Shakeout', 'امتصاص السيولة', 'Value Area + POC'] },
];

// ─── Main component ───

export function ContentStudioHub() {
 const [studio, setStudio] = useState<Studio>('educational');
 const [realLessons, setRealLessons] = useState<RealLesson[]>([]);
 const [realTrades, setRealTrades] = useState<RealTrade[]>([]);
 const [selectedLesson, setSelectedLesson] = useState<string>('');
 const [loadingData, setLoadingData] = useState(true);

 // ─── ديناميكية: اختيار المحتوى + التخصيص (NEW — Team collaboration) ───
 const [selectedTradeIds, setSelectedTradeIds] = useState<Set<string>>(new Set());
 const [selectedPointIndices, setSelectedPointIndices] = useState<Set<number>>(new Set([0, 1, 2, 3]));
 const [sceneDuration, setSceneDuration] = useState(5); // ثواني لكل scene
 const [introDuration, setIntroDuration] = useState(4);
 const [ctaDuration, setCtaDuration] = useState(3);
 const [includeIntro, setIncludeIntro] = useState(true);
 const [includeCTA, setIncludeCTA] = useState(true);
 const [previewSceneIdx, setPreviewSceneIdx] = useState<number | null>(null);

 const renderer = useVideoRenderer();

 // جلب الدروس الحقيقية من API
 useEffect(() => {
 fetch('/api/ads/educational-lessons')
 .then((r) => r.json())
 .then((j) => {
 if (j.success && j.lessons?.length > 0) {
 setRealLessons(j.lessons);
 setSelectedLesson(j.lessons[0].id);
 }
 })
 .catch(() => {/* fallback بيستخدم FALLBACK_LESSONS */})
 .finally(() => setLoadingData(false));
 }, []);

 // جلب الصفقات الناجحة الحقيقية من API
 useEffect(() => {
 fetch('/api/ads/successful-trades?limit=10')
 .then((r) => r.json())
 .then((j) => {
 if (j.success && j.trades?.length > 0) {
 setRealTrades(j.trades);
 }
 })
 .catch(() => {/* fallback: مفيش صفقات */});
 }, []);

 // بناء scenes من درس حقيقي (أو fallback) — ديناميكي بالاختيارات
 const buildScenes = useCallback((): Scene[] => {
 if (studio === 'educational') {
 if (realLessons.length > 0) {
 const lesson = realLessons.find((l) => l.id === selectedLesson) || realLessons[0];
 return buildRealLessonScenes(lesson, selectedPointIndices, sceneDuration, introDuration, ctaDuration, includeIntro, includeCTA);
 }
 const lesson = FALLBACK_LESSONS[0];
 return buildLessonScenes({
 id: lesson.id, title: lesson.title, emoji: lesson.emoji, bg: lesson.bg, points: lesson.points,
 });
 }
 // trades — ديناميكي بالاختيارات
 if (realTrades.length > 0) {
 const selectedTrades = realTrades.filter((t) => selectedTradeIds.has(t.id));
 if (selectedTrades.length === 0) return buildRealTradeScenes(realTrades, sceneDuration, introDuration, ctaDuration, includeIntro, includeCTA);
 return buildRealTradeScenes(selectedTrades, sceneDuration, introDuration, ctaDuration, includeIntro, includeCTA);
 }
 return buildTradeScenes(SAMPLE_TRADES);
 }, [studio, realLessons, realTrades, selectedLesson, selectedTradeIds, selectedPointIndices, sceneDuration, introDuration, ctaDuration, includeIntro, includeCTA]);

 const handleRender = useCallback(() => {
 const scenes = buildScenes();
 renderer.render(scenes);
 }, [buildScenes, renderer]);

 // بناء scenes من درس حقيقي — ديناميكي بالاختيارات
 function buildRealLessonScenes(
 lesson: RealLesson,
 selectedPoints: Set<number>,
 sceneDur: number,
 introDur: number,
 ctaDur: number,
 showIntro: boolean,
 showCTA: boolean,
 ): Scene[] {
 const bgColors: Record<string, string> = {
 '01': '#7c3aed', '02': '#0ea5e9', '03': '#10b981', '04': '#f59e0b',
 '05': '#ef4444', '06': '#8b5cf6', '07': '#ec4899', '08': '#f97316',
 };
 const bg = bgColors[lesson.id] || '#6366f1';

 const allPoints = lesson.keyPoints.length > 0 ? lesson.keyPoints : lesson.sections.map(s => s.heading);
 // فلترة النقاط المختارة فقط
 const points = allPoints.filter((_, i) => selectedPoints.has(i));
 const finalPoints = points.length > 0 ? points : allPoints.slice(0, 4); // fallback لو مفيش اختيار

 const scenes: Scene[] = [];

 // Intro (اختياري)
 if (showIntro) {
 scenes.push({
 duration: introDur,
 bgColor: bg,
 emoji: lesson.emoji,
 texts: [
 { ...EFFECT_PRESETS.headline, text: lesson.title, color: '#ffffff' },
 { ...EFFECT_PRESETS.subtext, text: lesson.level + ' • ' + lesson.duration, color: 'rgba(255,255,255,0.8)' },
 ],
 });
 }

 // Scenes للنقاط المختارة
 finalPoints.slice(0, 8).forEach((point, i) => {
 scenes.push({
 duration: sceneDur,
 bgColor: bg,
 texts: [
 { ...EFFECT_PRESETS.headline, text: lesson.title, color: '#ffffff', fontSize: 40 },
 { ...EFFECT_PRESETS.number, text: `${i + 1}`, color: '#fbbf24', delay: 0.2 },
 { ...EFFECT_PRESETS.bullet, text: point, color: '#ffffff', delay: 0.5, fontSize: 32 },
 ],
 });
 });

 // CTA (اختياري)
 if (showCTA) {
 scenes.push({
 duration: ctaDur,
 bgColor: bg,
 emoji: '🎓',
 texts: [
 { ...EFFECT_PRESETS.cta, text: 'تعلّم أكثر في أكاديمية التداول', color: '#ffffff' },
 { ...EFFECT_PRESETS.hashtag, text: '#تعلم_التداول #أكاديمية_التداول', delay: 0.4 },
 ],
 });
 }

 return scenes;
 }

 // بناء scenes من صفقات حقيقية — ديناميكي بالاختيارات
 function buildRealTradeScenes(
 trades: RealTrade[],
 sceneDur: number,
 introDur: number,
 ctaDur: number,
 showIntro: boolean,
 showCTA: boolean,
 ): Scene[] {
 const scenes: Scene[] = [];

 if (showIntro) {
 scenes.push({
 duration: introDur,
 bgColor: '#059669',
 emoji: '🚀',
 texts: [
 { ...EFFECT_PRESETS.headline, text: 'صفقات ناجحة', color: '#ffffff' },
 { ...EFFECT_PRESETS.subtext, text: `${trades.length} صفقة من منصة استثمارية ذكية`, color: 'rgba(255,255,255,0.85)' },
 ],
 });
 }

 trades.slice(0, 12).forEach((t) => {
 scenes.push({
 duration: sceneDur,
 bgColor: '#059669',
 emoji: '📈',
 texts: [
 { ...EFFECT_PRESETS.headline, text: t.ticker, color: '#ffffff', fontSize: 64 },
 { ...EFFECT_PRESETS.number, text: `+${(t.returnPct ?? 0).toFixed(1)}%`, color: '#fbbf24', delay: 0.3 },
 { ...EFFECT_PRESETS.bullet, text: `دخول: ${(t.entryPrice ?? 0).toFixed(2)} → خروج: ${(t.exitPrice ?? 0).toFixed(2)}`, color: '#ffffff', delay: 0.6 },
 { ...EFFECT_PRESETS.subtext, text: t.signal || 'إشارة قوية', color: 'rgba(255,255,255,0.85)', delay: 0.9, fontSize: 28 },
 { ...EFFECT_PRESETS.hashtag, text: `#${t.ticker} #صفقة_ناجحة #${t.market}`, delay: 1.2 },
 ],
 });
 });

 if (showCTA) {
 scenes.push({
 duration: ctaDur,
 bgColor: '#059669',
 emoji: '🎯',
 texts: [
 { ...EFFECT_PRESETS.cta, text: 'احصل على إشاراتك اليومية', color: '#ffffff' },
 { ...EFFECT_PRESETS.hashtag, text: '#توقعات_الأسهم #EGX', delay: 0.4 },
 ],
 });
 }

 return scenes;
 }

 const currentLessons = realLessons.length > 0 ? realLessons : FALLBACK_LESSONS.map(f => ({
 id: f.id, title: f.title, emoji: f.emoji, level: 'متقدم', duration: '25 دقيقة',
 tagline: '', keyPoints: f.points, sections: [],
 }));
 const currentTrades = realTrades.length > 0 ? realTrades : [];

 // ─── helper functions للاختيار الديناميكي ───
 const toggleTrade = useCallback((tradeId: string) => {
 setSelectedTradeIds((prev) => {
 const next = new Set(prev);
 if (next.has(tradeId)) next.delete(tradeId);
 else next.add(tradeId);
 return next;
 });
 }, []);

 const selectAllTrades = useCallback(() => {
 setSelectedTradeIds(new Set(currentTrades.map((t) => t.id)));
 }, [currentTrades]);

 const clearTradeSelection = useCallback(() => {
 setSelectedTradeIds(new Set());
 }, []);

 const togglePoint = useCallback((idx: number) => {
 setSelectedPointIndices((prev) => {
 const next = new Set(prev);
 if (next.has(idx)) next.delete(idx);
 else next.add(idx);
 return next;
 });
 }, []);

 // حساب إجمالي مدة الفيديو المتوقّعة
 const estimatedScenes = buildScenes();
 const totalDuration = estimatedScenes.reduce((s, sc) => s + sc.duration, 0);

 return (
 <div className="space-y-6">
 {/* Header */}
 <Card className="border-violet-500/30 from-violet-500/5 to-fuchsia-500/5">
 <CardHeader>
 <div className="flex items-start gap-3">
 <div className="w-11 h-11 rounded-xl from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
 <Film className="w-6 h-6 text-foreground" />
 </div>
 <div className="flex-1 min-w-0">
 <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
 استوديو المحتوى المتحرك
 <Badge variant="outline" className="text-xs gap-1">
 <Type className="w-3 h-3" />
 نصوص متحركة
 </Badge>
 </CardTitle>
 <CardDescription className="mt-1">
 حوّل المحتوى التعليمي والصفقات الناجحة لكروت فيديو بنصوص متحركة. صامت — ضف الموسيقى بنفسك.
 </CardDescription>
 </div>
 </div>
 </CardHeader>
 </Card>

 {/* Studio selector */}
 <div className="grid grid-cols-2 gap-2.5">
 <button
 onClick={() => setStudio('educational')}
 className={cn(
 'flex items-center gap-3 p-3 rounded-2xl border-2 transition-all active:scale-95',
 studio === 'educational' ? 'border-violet-500 bg-violet-500/5 shadow-md' : 'border-border bg-card hover:bg-accent/30',
 )}
 >
 <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', studio === 'educational' ? 'bg-violet-500 text-foreground' : 'bg-muted')}>
 <GraduationCap className="w-5 h-5" />
 </div>
 <div className="text-right">
 <p className="text-sm font-bold">كروت تعليمية</p>
 <p className="text-xs text-muted-foreground">8 دروس بنصوص متحركة</p>
 </div>
 </button>
 <button
 onClick={() => setStudio('trades')}
 className={cn(
 'flex items-center gap-3 p-3 rounded-2xl border-2 transition-all active:scale-95',
 studio === 'trades' ? 'border-profit bg-profit/5 shadow-md' : 'border-border bg-card hover:bg-accent/30',
 )}
 >
 <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', studio === 'trades' ? 'bg-profit text-white' : 'bg-muted')}>
 <TrendingUp className="w-5 h-5" />
 </div>
 <div className="text-right">
 <p className="text-sm font-bold">عرض الصفقات</p>
 <p className="text-xs text-muted-foreground">صفقات ناجحة متتابعة</p>
 </div>
 </button>
 </div>

 {/* Content selector + customization + render button */}
 <Card>
 <CardContent className="space-y-4 pt-4">
 {studio === 'educational' ? (
 <div className="space-y-3">
 <Label className="text-sm">اختر الدرس ({currentLessons.length} متاح — من content/education/)</Label>
 <Select value={selectedLesson} onValueChange={(v) => { setSelectedLesson(v); setSelectedPointIndices(new Set([0, 1, 2, 3])); }}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 {currentLessons.map((l) => (
 <SelectItem key={l.id} value={l.id}>
 <span className="me-1">{l.emoji}</span> {l.title}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 {/* اختيار النقاط */}
 {currentLessons.length > 0 && (() => {
 const lesson = currentLessons.find((l) => l.id === selectedLesson) || currentLessons[0];
 const allPoints = lesson.keyPoints.length > 0 ? lesson.keyPoints : lesson.sections.map(s => s.heading);
 return (
 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <Label className="text-xs font-semibold">اختر النقاط اللي عايز تضمّنها ({selectedPointIndices.size}/{allPoints.length})</Label>
 <button onClick={() => setSelectedPointIndices(new Set(allPoints.map((_, i) => i)))} className="text-xs text-primary hover:underline">اختر الكل</button>
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
 {allPoints.map((p, i) => (
 <label key={i} className={cn('flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all text-xs', selectedPointIndices.has(i) ? 'border-violet-500 bg-violet-500/5' : 'border-border hover:bg-muted/30')}>
 <input type="checkbox" checked={selectedPointIndices.has(i)} onChange={() => togglePoint(i)} className="w-3.5 h-3.5 mt-0.5 accent-violet-500" />
 <span className="leading-tight">{i + 1}. {p}</span>
 </label>
 ))}
 </div>
 </div>
 );
 })()}
 </div>
 ) : (
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <Label className="text-sm">
 {currentTrades.length > 0
 ? `الصفقات الناجحة (${currentTrades.length} — من predictions.db)`
 : 'مفيش صفقات ناجحة في الـ DB — استخدم fallback'}
 </Label>
 {currentTrades.length > 0 && (
 <div className="flex gap-2">
 <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={selectAllTrades}>اختر الكل</Button>
 <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={clearTradeSelection}>مسح الاختيار</Button>
 </div>
 )}
 </div>
 {currentTrades.length > 0 ? (
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
 {currentTrades.map((t, i) => (
 <label key={t.id || i} className={cn('flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all', selectedTradeIds.has(t.id) ? 'border-profit bg-profit/5' : 'border-border hover:bg-muted/30')}>
 <input type="checkbox" checked={selectedTradeIds.has(t.id)} onChange={() => toggleTrade(t.id)} className="w-3.5 h-3.5 accent-profit shrink-0" />
 <div className="min-w-0 flex-1">
 <div className="flex items-center justify-between">
 <span className="font-bold text-sm">{t.ticker}</span>
 <Badge className="bg-profit text-white text-xs">+{(t.returnPct ?? 0).toFixed(1)}%</Badge>
 </div>
 <p className="text-xs text-muted-foreground truncate">{t.signal || 'إشارة قوية'}</p>
 <p className="text-xs text-muted-foreground">{(t.entryPrice ?? 0).toFixed(2)} → {(t.exitPrice ?? 0).toFixed(2)} • {t.holdingDays}يوم</p>
 </div>
 </label>
 ))}
 </div>
 ) : (
 <p className="text-xs text-warning p-2 rounded bg-warning/20 border border-warning ">
 ℹ️ مفيش صفقات ناجحة في الـ DB. الفيديو هياخد بيانات تجريبية.
 </p>
 )}
 {selectedTradeIds.size > 0 && (
 <p className="text-xs text-profit ">
 ✅ اخترت {selectedTradeIds.size} صفقة للفيديو
 </p>
 )}
 </div>
 )}

 {/* تخصيص المدة + الهيكل */}
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-muted/30 border border-border">
 <div className="space-y-1.5">
 <Label className="text-xs font-semibold">مدة كل مشهد: {sceneDuration}ث</Label>
 <input type="range" min={3} max={8} value={sceneDuration} onChange={(e) => setSceneDuration(Number(e.target.value))} className="w-full accent-violet-500" />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs font-semibold">مقدمة: {introDuration}ث</Label>
 <input type="range" min={2} max={6} value={introDuration} onChange={(e) => setIntroDuration(Number(e.target.value))} className="w-full accent-violet-500" />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs font-semibold">ختام (CTA): {ctaDuration}ث</Label>
 <input type="range" min={2} max={5} value={ctaDuration} onChange={(e) => setCtaDuration(Number(e.target.value))} className="w-full accent-violet-500" />
 </div>
 <label className="flex items-center gap-2 text-xs cursor-pointer">
 <input type="checkbox" checked={includeIntro} onChange={(e) => setIncludeIntro(e.target.checked)} className="w-3.5 h-3.5 accent-violet-500" />
 إظهار المقدمة
 </label>
 <label className="flex items-center gap-2 text-xs cursor-pointer">
 <input type="checkbox" checked={includeCTA} onChange={(e) => setIncludeCTA(e.target.checked)} className="w-3.5 h-3.5 accent-violet-500" />
 إظهار الختام (CTA)
 </label>
 </div>

 {/* ملخص الفيديو */}
 <div className="flex items-center gap-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
 <Clock className="w-4 h-4 text-primary shrink-0" />
 <div className="flex-1 text-xs">
 <span className="font-bold">{estimatedScenes.length} مشهد</span>
 <span className="text-muted-foreground"> • </span>
 <span className="font-bold">{totalDuration}ث</span>
 <span className="text-muted-foreground"> ≈ {Math.floor(totalDuration / 60)}:{String(totalDuration % 60).padStart(2, '0')} دقيقة</span>
 </div>
 </div>

 <div className="flex flex-wrap items-center gap-2">
 <Button
 onClick={handleRender}
 disabled={renderer.renderState === 'rendering'}
 size="lg"
 className="gap-2 from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-foreground"
 >
 {renderer.renderState === 'rendering' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
 {renderer.renderState === 'rendering' ? 'بيشتغل...' : 'أنتج الفيديو'}
 </Button>
 {renderer.renderState === 'rendering' && (
 <Button onClick={renderer.cancel} variant="outline" size="lg">إلغاء</Button>
 )}
 {renderer.renderState === 'done' && renderer.videoUrl && (
 <Button onClick={() => renderer.download(`content-${studio}-${Date.now()}.webm`)} variant="default" size="lg" className="gap-2">
 <Download className="w-4 h-4" />
 تحميل الفيديو
 </Button>
 )}
 </div>
 </CardContent>
 </Card>

 {/* Preview */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 <Film className="w-4 h-4 text-primary" />
 معاينة الفيديو (9:16 — صامت)
 </CardTitle>
 <CardDescription className="text-xs">
 الدقة: 1080×1920 • WebM • ضف الموسيقى بنفسك وقت النشر
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="relative mx-auto bg-black rounded-xl overflow-hidden shadow-lg" style={{ width: 'min(280px, 100%)', aspectRatio: '9/16' }}>
 <canvas ref={renderer.canvasRef} width={1080} height={1920} className="w-full h-full block" />
 {renderer.renderState === 'rendering' && (
 <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
 <div className="w-10 h-10 rounded-full border-2 border-white/30 border-t-white animate-spin" />
 <div className="text-foreground text-xs font-medium">بيسجّل {Math.round(renderer.renderProgress * 100)}%</div>
 </div>
 )}
 {renderer.renderState === 'done' && renderer.videoUrl && (
 <video src={renderer.videoUrl} controls playsInline muted className="absolute inset-0 w-full h-full bg-black" />
 )}
 </div>

 {renderer.renderState === 'rendering' && (
 <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
 <div className="h-full from-violet-500 to-fuchsia-500 transition-all" style={{ width: `${Math.round(renderer.renderProgress * 100)}%` }} />
 </div>
 )}

 {/* Effects reference */}
 <div className="p-3 rounded-lg bg-muted/30 border border-border">
 <p className="text-xs font-semibold mb-2 flex items-center gap-1">
 <Sparkles className="w-3.5 h-3.5 text-violet-500" />
 التأثيرات المتاحة:
 </p>
 <div className="flex flex-wrap gap-1.5">
 {EFFECT_OPTIONS.map((e) => (
 <Badge key={e.value} variant="outline" className="text-xs gap-1" title={e.desc}>
 {e.label}
 </Badge>
 ))}
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}
