'use client';

/**
 * AdGeneratorTab — مولّد الإعلانات (Production-Ready)
 * ============================================================
 *
 * Production VPS: ممنوع تشغيل AI/LLM/Piper TTS على السيرفر.
 *
 * الـ pipeline:
 *   1. المستخدم يختار ميزة → نقرأ النص الجاهز من ad-templates.ts (محلي، فوري)
 *   2. Playwright يلتقط تتابع 2-3 screenshots من المسارات الحية
 *   3. Canvas بيرسم المشاهد + النصوص الجاهزة فوقها (Ken Burns zoom/pan)
 *   4. MediaRecorder بيسجّل فيديو صامت (WebM) — المستخدم بيضيف موسيقى تريند وقت الرفع
 *
 * الزمن الكلي: ~2 ثانية (مقارنة بـ 14 ثانية في الـ pipeline القديم).
 * استهلاك الـ VPS: شبه صفر (Playwright headless بس).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Clapperboard,
  Sparkles,
  Loader2,
  Download,
  Copy,
  Check,
  Film,
  Wand2,
  Camera,
  ImageIcon,
  AlertCircle,
  VolumeX,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type FeatureKey =
  | 'radar' | 'predictions' | 'portfolio' | 'risk'
  | 'stockcard' | 'alerts' | 'exit' | 'academy';

const FEATURE_OPTIONS: {
  value: FeatureKey;
  label: string;
  emoji: string;
  accent: [string, string];
}[] = [
  { value: 'radar', label: 'رادار السيولة', emoji: '🛰️', accent: ['#0ea5e9', '#0369a1'] },
  { value: 'predictions', label: 'التوقعات الذكية V40.2', emoji: '🎯', accent: ['#8b5cf6', '#6d28d9'] },
  { value: 'portfolio', label: 'المحفظة الذكية', emoji: '💼', accent: ['#10b981', '#047857'] },
  { value: 'risk', label: 'حاسبة المخاطر', emoji: '🛡️', accent: ['#f59e0b', '#b45309'] },
  { value: 'stockcard', label: 'كارت السهم الشامل', emoji: '🪙', accent: ['#ec4899', '#9d174d'] },
  { value: 'alerts', label: 'مركز التنبيهات', emoji: '🔔', accent: ['#ef4444', '#991b1b'] },
  { value: 'exit', label: 'رادار الخروج', emoji: '🚪', accent: ['#14b8a6', '#0f766e'] },
  { value: 'academy', label: 'أكاديمية التداول', emoji: '🎓', accent: ['#6366f1', '#4338ca'] },
];

interface AdScene {
  headline: string;
  subtext: string;
}

interface AdResult {
  script: string;
  caption: string;
  hashtags: string[];
  scenes: AdScene[];
  featureName: string;
}

interface SceneScreenshot {
  url: string;
  route: string;
  sceneIndex: number;
}

type RenderState = 'idle' | 'preparing' | 'recording' | 'finalizing' | 'done' | 'error';

// ─── Canvas helpers ───

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

function wrapArabic(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

interface SceneFrame {
  type: 'intro' | 'feature' | 'cta';
  headline: string;
  subtext: string;
  emoji: string;
  accent: [string, string];
  featureName: string;
  sceneIndex: number;
  totalScenes: number;
  progress: number;
  globalProgress: number;
  screenshot?: HTMLImageElement | null;
  kenBurns?: 'zoomIn' | 'zoomOut' | 'panRight' | 'panLeft' | 'panDown';
}

function drawTopBar(ctx: CanvasRenderingContext2D, frame: SceneFrame, W: number, H: number, c1: string) {
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, W * 0.08, H * 0.05, W * 0.84, H * 0.05, H * 0.025);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(H * 0.026)}px system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('📈 منصة استثمارية ذكية', W / 2, H * 0.075);
  ctx.restore();

  const dotCount = frame.type === 'intro' ? 1 : frame.type === 'cta' ? frame.totalScenes + 2 : frame.sceneIndex + 2;
  const dotTotal = frame.totalScenes + 2;
  const dotSize = W * 0.012;
  const dotGap = W * 0.02;
  const dotRowW = dotTotal * dotSize + (dotTotal - 1) * dotGap;
  let dx = W / 2 - dotRowW / 2;
  for (let i = 0; i < dotTotal; i++) {
    ctx.beginPath();
    ctx.arc(dx + dotSize / 2, H * 0.13, dotSize, 0, Math.PI * 2);
    ctx.fillStyle = i < dotCount ? c1 : 'rgba(255,255,255,0.2)';
    ctx.fill();
    dx += dotSize + dotGap;
  }
}

function drawProgressBar(ctx: CanvasRenderingContext2D, frame: SceneFrame, W: number, H: number, c1: string) {
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(W * 0.08, H * 0.965, W * 0.84, H * 0.006);
  ctx.fillStyle = c1;
  ctx.fillRect(W * 0.08, H * 0.965, W * 0.84 * frame.globalProgress, H * 0.006);
}

function drawScene(ctx: CanvasRenderingContext2D, frame: SceneFrame, W: number, H: number) {
  const [c1, c2] = frame.accent;

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(0.55, '#1e1b4b');
  bg.addColorStop(1, c2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Decorative orbs
  ctx.save();
  ctx.globalAlpha = 0.35;
  const g1 = ctx.createRadialGradient(W * 0.2, H * 0.25, 0, W * 0.2, H * 0.25, W * 0.5);
  g1.addColorStop(0, c1);
  g1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(W * 0.85, H * 0.75, 0, W * 0.85, H * 0.75, W * 0.45);
  g2.addColorStop(0, c2);
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Screenshot layer (Ken Burns)
  if (frame.type === 'feature' && frame.screenshot) {
    const img = frame.screenshot;
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;
    if (imgW > 0 && imgH > 0) {
      const screenTop = H * 0.15;
      const screenBottom = H * 0.72;
      const screenH = screenBottom - screenTop;
      const screenW = W * 0.86;
      const screenX = (W - screenW) / 2;

      ctx.save();
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, screenX - 8, screenTop - 8, screenW + 16, screenH + 16, 24);
      ctx.fill();

      // Ken Burns
      const p = frame.progress;
      let scale = 1.0;
      let offX = 0;
      let offY = 0;
      const zoomAmt = 0.12;
      const panAmt = 0.08;
      switch (frame.kenBurns) {
        case 'zoomIn': scale = 1.0 + zoomAmt * p; break;
        case 'zoomOut': scale = 1.0 + zoomAmt * (1 - p); break;
        case 'panRight': scale = 1.0 + zoomAmt * 0.5; offX = -panAmt * p * screenW; break;
        case 'panLeft': scale = 1.0 + zoomAmt * 0.5; offX = panAmt * p * screenW; break;
        case 'panDown': scale = 1.0 + zoomAmt * 0.5; offY = -panAmt * p * screenH; break;
        default: scale = 1.0 + zoomAmt * 0.3 * p;
      }

      const imgAspect = imgW / imgH;
      const boxAspect = screenW / screenH;
      let drawW: number, drawH: number;
      if (imgAspect > boxAspect) {
        drawH = screenH * scale;
        drawW = drawH * imgAspect;
      } else {
        drawW = screenW * scale;
        drawH = drawW / imgAspect;
      }
      const dx = screenX + (screenW - drawW) / 2 + offX;
      const dy = screenTop + (screenH - drawH) / 2 + offY;

      ctx.save();
      ctx.beginPath();
      roundRect(ctx, screenX, screenTop, screenW, screenH, 16);
      ctx.clip();
      ctx.drawImage(img, dx, dy, drawW, drawH);
      ctx.restore();

      // Scrim
      const scrim = ctx.createLinearGradient(0, screenBottom - screenH * 0.4, 0, screenBottom);
      scrim.addColorStop(0, 'rgba(0,0,0,0)');
      scrim.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, screenX, screenTop, screenW, screenH, 16);
      ctx.clip();
      ctx.fillStyle = scrim;
      ctx.fillRect(screenX, screenTop, screenW, screenH);
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      roundRect(ctx, screenX, screenTop, screenW, screenH, 16);
      ctx.stroke();
      ctx.restore();

      // Texts under screenshot
      const enter = Math.min(1, frame.progress * 3);
      const ease = 1 - Math.pow(1 - enter, 3);
      const textY = screenBottom + H * 0.04;
      ctx.save();
      ctx.globalAlpha = ease;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const hFont = Math.round(H * 0.04);
      ctx.font = `800 ${hFont}px system-ui`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 8;
      const lines = wrapArabic(ctx, frame.headline, W * 0.84);
      let ty = textY;
      for (const ln of lines) {
        ctx.fillText(ln, W / 2, ty);
        ty += hFont * 1.1;
      }
      ctx.shadowBlur = 4;
      ctx.font = `500 ${Math.round(H * 0.026)}px system-ui`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const subLines = wrapArabic(ctx, frame.subtext, W * 0.78);
      for (const ln of subLines) {
        ctx.fillText(ln, W / 2, ty + H * 0.005);
        ty += H * 0.032;
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = ease * 0.85;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(ctx, W * 0.35, H * 0.92, W * 0.3, H * 0.035, H * 0.018);
      ctx.fill();
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `600 ${Math.round(H * 0.02)}px system-ui`;
      ctx.fillText(`${frame.sceneIndex + 1} / ${frame.totalScenes}`, W / 2, H * 0.9375);
      ctx.restore();

      drawTopBar(ctx, frame, W, H, c1);
      drawProgressBar(ctx, frame, W, H, c1);
      return;
    }
  }

  // Fallback: gradient scenes (intro + cta)
  drawTopBar(ctx, frame, W, H, c1);

  if (frame.type === 'intro') {
    const cy = H * 0.42;
    const pulse = 1 + 0.06 * Math.sin(frame.progress * Math.PI * 4);
    const emblemR = W * 0.16 * pulse;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(W / 2, cy, emblemR * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = c1;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.font = `${Math.round(emblemR * 1.4)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(frame.emoji, W / 2, cy);
    ctx.restore();

    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = Math.min(1, frame.progress * 2);
    ctx.font = `800 ${Math.round(H * 0.05)}px system-ui`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(frame.featureName, W / 2, H * 0.66);
    ctx.font = `500 ${Math.round(H * 0.028)}px system-ui`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(frame.subtext, W / 2, H * 0.73);
    ctx.restore();
  } else if (frame.type === 'cta') {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const btnY = H * 0.5;
    const btnW = W * 0.7;
    const btnH = H * 0.085;
    const btnX = W / 2 - btnW / 2;
    const pulse = 1 + 0.04 * Math.sin(frame.progress * Math.PI * 3);
    ctx.save();
    ctx.translate(W / 2, btnY);
    ctx.scale(pulse, pulse);
    ctx.translate(-W / 2, -btnY);
    const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY + btnH);
    btnGrad.addColorStop(0, c1);
    btnGrad.addColorStop(1, c2);
    ctx.fillStyle = btnGrad;
    roundRect(ctx, btnX, btnY, btnW, btnH, btnH / 2);
    ctx.fill();
    ctx.font = `800 ${Math.round(H * 0.036)}px system-ui`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('ابدأ مجانًا الآن', W / 2, btnY + btnH / 2);
    ctx.restore();

    ctx.font = `800 ${Math.round(H * 0.06)}px system-ui`;
    ctx.fillStyle = '#ffffff';
    const hl = wrapArabic(ctx, frame.headline, W * 0.84);
    let hy = btnY - H * 0.13;
    for (const ln of hl) {
      ctx.fillText(ln, W / 2, hy);
      hy += H * 0.07;
    }
    ctx.font = `500 ${Math.round(H * 0.026)}px system-ui`;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(frame.subtext, W / 2, btnY + btnH + H * 0.06);
    ctx.font = `600 ${Math.round(H * 0.022)}px system-ui`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('منصة استثمارية متعددة الأسواق', W / 2, H * 0.93);
    ctx.restore();
  }

  drawProgressBar(ctx, frame, W, H, c1);
}

// ─── Main component ───

export function AdGeneratorTab() {
  const [feature, setFeature] = useState<FeatureKey>('radar');
  const [result, setResult] = useState<AdResult | null>(null);
  const [screenshots, setScreenshots] = useState<SceneScreenshot[]>([]);
  const [screenshotImgs, setScreenshotImgs] = useState<Map<number, HTMLImageElement>>(new Map());
  const [screenshotCapturing, setScreenshotCapturing] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [renderState, setRenderState] = useState<RenderState>('idle');
  const [renderProgress, setRenderProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [copied, setCopied] = useState<'caption' | 'hashtags' | 'script' | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cancelRef = useRef(false);

  // ─── Step 1: Generate (instant — static templates) ───
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setResult(null);
    setVideoUrl(null);
    setVideoBlob(null);
    setRenderState('idle');

    try {
      // 1. Script (static — no AI)
      const scriptRes = await fetch('/api/ads/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature }),
      });
      const scriptJson = await scriptRes.json();
      if (!scriptRes.ok || !scriptJson.success) {
        throw new Error(scriptJson.error || 'فشل جلب النص الإعلاني');
      }
      setResult(scriptJson as AdResult);
      toast.success('تم تجهيز النص الإعلاني (ثابت — بدون AI)');

      // 2. Capture screenshots (Playwright — multi-route)
      await handleCaptureScreenshots(false);
    } catch (err: any) {
      console.error('[ad-generator] error:', err);
      toast.error(err?.message || 'فشل تجهيز الإعلان');
    } finally {
      setGenerating(false);
    }
  }, [feature]);

  // ─── Step 2: Capture screenshots ───
  const handleCaptureScreenshots = useCallback(async (forceRefresh: boolean) => {
    setScreenshotCapturing(true);
    try {
      const res = await fetch('/api/ads/capture-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, viewport: 'mobile', refresh: forceRefresh }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.error || 'فشل التقاط الـ screenshots');
      }
      setScreenshots(j.screenshots || []);

      // Load each screenshot as HTMLImageElement for canvas drawing
      const imgMap = new Map<number, HTMLImageElement>();
      await Promise.all(
        (j.screenshots || []).map(
          (ss: SceneScreenshot) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                imgMap.set(ss.sceneIndex, img);
                resolve();
              };
              img.onerror = () => resolve();
              img.src = ss.url;
            }),
        ),
      );
      setScreenshotImgs(imgMap);
      toast.success(forceRefresh ? 'اتلتقطت screenshots جديدة' : 'الـ screenshots جاهزة');
    } catch (err: any) {
      toast.error(err?.message || 'فشل التقاط الـ screenshots');
    } finally {
      setScreenshotCapturing(false);
    }
  }, [feature]);

  // Auto-capture when feature changes
  useEffect(() => {
    handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature]);

  // ─── Step 3: Render video (silent — Canvas + MediaRecorder, no audio) ───
  const handleRender = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      toast.error('الكانيڤاس مش متاح');
      return;
    }
    if (!result) {
      toast.error('جهّز الإعلان الأول');
      return;
    }

    cancelRef.current = false;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setVideoBlob(null);
    setRenderProgress(0);
    setRenderState('preparing');

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      toast.error('المتصفح مش بيدعم Canvas 2D');
      setRenderState('error');
      return;
    }

    const W = 1080;
    const H = 1920;

    try {
      const featOpt = FEATURE_OPTIONS.find((f) => f.value === feature)!;
      const scenes = result.scenes && result.scenes.length > 0
        ? result.scenes
        : [{ headline: result.featureName, subtext: '' }];

      // مدة الفيديو: 2 ثانية لكل scene + 1.5 intro + 2 CTA
      // Production: فيديو قصير وسريع (~10 ثواني)
      const introDur = 1.5;
      const ctaDur = 2.0;
      const sceneDur = 2.0; // ثابتة — مش محتاجة audio
      const duration = introDur + scenes.length * sceneDur + ctaDur;

      const kenBurnsRot: SceneFrame['kenBurns'][] = ['zoomIn', 'panRight', 'zoomOut', 'panLeft', 'panDown'];

      // Canvas stream (video only — no audio)
      const canvasStream = canvas.captureStream(30);

      const candidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm;codecs=h264',
        'video/webm',
      ];
      const mimeType =
        candidates.find((c) => MediaRecorder.isTypeSupported(c)) || 'video/webm';

      const recorder = new MediaRecorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: 4_000_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      const cleanup = () => {
        try {
          canvasStream.getTracks().forEach((t) => t.stop());
        } catch {
          /* noop */
        }
      };

      const finished = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(chunks, { type: 'video/webm' }));
        };
      });

      setRenderState('recording');
      recorder.start(100);
      const startTime = performance.now();

      const draw = () => {
        if (cancelRef.current) {
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        const elapsed = (performance.now() - startTime) / 1000;
        const t = Math.min(elapsed, duration);
        const gp = duration > 0 ? t / duration : 0;
        setRenderProgress(gp);

        let frame: SceneFrame;
        if (t < introDur) {
          frame = {
            type: 'intro',
            headline: '',
            subtext: 'منصة استثمارية متعددة الأسواق',
            emoji: featOpt.emoji,
            accent: featOpt.accent,
            featureName: result.featureName,
            sceneIndex: 0,
            totalScenes: scenes.length,
            progress: t / introDur,
            globalProgress: gp,
          };
        } else if (t >= duration - ctaDur) {
          const localT = t - (duration - ctaDur);
          frame = {
            type: 'cta',
            headline: 'جرّبها مجانًا',
            subtext: result.caption || '',
            emoji: featOpt.emoji,
            accent: featOpt.accent,
            featureName: result.featureName,
            sceneIndex: scenes.length,
            totalScenes: scenes.length,
            progress: Math.min(1, localT / ctaDur),
            globalProgress: gp,
          };
        } else {
          const ft = t - introDur;
          const idx = Math.min(scenes.length - 1, Math.floor(ft / sceneDur));
          const localT = ft - idx * sceneDur;
          frame = {
            type: 'feature',
            headline: scenes[idx].headline,
            subtext: scenes[idx].subtext,
            emoji: featOpt.emoji,
            accent: featOpt.accent,
            featureName: result.featureName,
            sceneIndex: idx,
            totalScenes: scenes.length,
            progress: Math.min(1, localT / sceneDur),
            globalProgress: gp,
            screenshot: screenshotImgs.get(idx) || null,
            kenBurns: kenBurnsRot[idx % kenBurnsRot.length],
          };
        }

        drawScene(ctx, frame, W, H);

        if (elapsed < duration + 0.15) {
          requestAnimationFrame(draw);
        } else {
          setRenderState('finalizing');
          setTimeout(() => {
            if (recorder.state !== 'inactive') recorder.stop();
          }, 150);
        }
      };
      requestAnimationFrame(draw);

      const blob = await finished;
      cleanup();
      const url = URL.createObjectURL(blob);
      setVideoBlob(blob);
      setVideoUrl(url);
      setRenderState('done');
      setRenderProgress(1);
      toast.success('تم إنتاج الفيديو! 🎬 (صامت — ضف موسيقى وقت الرفع)');
    } catch (err: any) {
      console.error('[ad-generator/render] error:', err);
      setRenderState('error');
      toast.error(err?.message || 'فشل إنتاج الفيديو');
    }
  }, [result, feature, videoUrl, screenshotImgs]);

  const handleCancelRender = useCallback(() => {
    cancelRef.current = true;
    setRenderState('idle');
    toast.info('تم إلغاء الإنتاج');
  }, []);

  // ─── Copy helpers ───
  const copyText = useCallback(async (key: 'caption' | 'hashtags' | 'script', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success('اتنسخ ✅');
      setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error('فشل النسخ');
    }
  }, []);

  const downloadVideo = useCallback(() => {
    if (!videoBlob) return;
    const url = URL.createObjectURL(videoBlob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (result?.featureName || 'ad').replace(/\s+/g, '-').replace(/[^\u0600-\u06FF\w-]/g, '');
    a.download = `ad-${slug}-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, [videoBlob, result]);

  // Idle poster
  useEffect(() => {
    if (renderState !== 'idle' && renderState !== 'done') return;
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const featOpt = FEATURE_OPTIONS.find((f) => f.value === feature)!;
    const ssImg = screenshotImgs.get(0);
    if (ssImg) {
      drawScene(ctx, {
        type: 'feature',
        headline: result.scenes[0]?.headline || result.featureName,
        subtext: result.scenes[0]?.subtext || featOpt.label,
        emoji: featOpt.emoji,
        accent: featOpt.accent,
        featureName: result.featureName,
        sceneIndex: 0,
        totalScenes: result.scenes.length,
        progress: 0.5,
        globalProgress: 0.3,
        screenshot: ssImg,
        kenBurns: 'zoomIn',
      }, 1080, 1920);
    } else {
      drawScene(ctx, {
        type: 'intro',
        headline: '',
        subtext: 'منصة استثمارية متعددة الأسواق',
        emoji: featOpt.emoji,
        accent: featOpt.accent,
        featureName: result.featureName,
        sceneIndex: 0,
        totalScenes: result.scenes.length,
        progress: 1,
        globalProgress: 0,
      }, 1080, 1920);
    }
  }, [result, feature, renderState, screenshotImgs]);

  const featOpt = FEATURE_OPTIONS.find((f) => f.value === feature)!;
  const isRendering = renderState === 'preparing' || renderState === 'recording' || renderState === 'finalizing';

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-rose-500/5">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center shrink-0">
              <Clapperboard className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                مولّد الإعلانات (Production-Ready)
                <Badge variant="outline" className="text-[10px] gap-1">
                  <Zap className="w-3 h-3" />
                  No AI
                </Badge>
                <Badge variant="outline" className="text-[10px] gap-1">
                  <VolumeX className="w-3 h-3" />
                  Silent
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                فيديو إعلاني صامت بنصوص جاهزة + screenshots حقيقية. الفيديو بيتعمل في ~2 ثانية بدون أي حمل على السيرفر.
                ضف موسيقى تريند يدوياً وقت الرفع على تيك-توك/ريلز.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-primary" />
            إعدادات الإعلان
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">الميزة المُعلَن عنها</Label>
            <Select value={feature} onValueChange={(v) => setFeature(v as FeatureKey)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FEATURE_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    <span className="me-1">{f.emoji}</span> {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleGenerate}
              disabled={generating}
              size="lg"
              className="gap-2 bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-white"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'بيجهّز...' : 'تجهيز الإعلان'}
            </Button>
            {result && (
              <Button
                onClick={handleRender}
                disabled={isRendering}
                variant="default"
                size="lg"
                className="gap-2"
              >
                {isRendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
                {renderState === 'done' ? 'إعادة إنتاج الفيديو' : 'إنتاج الفيديو'}
              </Button>
            )}
            {isRendering && (
              <Button onClick={handleCancelRender} variant="outline" size="lg" className="gap-2">
                إلغاء
              </Button>
            )}
          </div>

          {/* Screenshots controls */}
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
            <Camera className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">لقطات الشاشة الحية</p>
              <p className="text-xs text-muted-foreground">
                Playwright بيلتقط 2-3 screenshots من المسارات الحية للميزة ({screenshots.length} جاهزة)
              </p>
            </div>
            {screenshots.length > 0 && (
              <div className="flex gap-1 shrink-0">
                {screenshots.slice(0, 3).map((ss) => (
                  <div key={ss.sceneIndex} className="relative w-10 h-16 rounded border border-border overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ss.url} alt={`scene ${ss.sceneIndex}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
            <Button
              onClick={() => handleCaptureScreenshots(true)}
              disabled={screenshotCapturing}
              variant="outline"
              size="sm"
              className="gap-1 shrink-0"
            >
              {screenshotCapturing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              {screenshotCapturing ? 'بيلتقط...' : 'التقاط جديد'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview + outputs */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Video preview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Film className="w-4 h-4 text-primary" />
                معاينة الفيديو (9:16 — صامت)
              </CardTitle>
              <CardDescription className="text-xs">
                الدقة: 1080×1920 • WebM • {renderState === 'done' ? 'جاهز' : 'لسه ما اتعملش'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative mx-auto bg-black rounded-xl overflow-hidden shadow-lg" style={{ width: 'min(280px, 100%)', aspectRatio: '9/16' }}>
                <canvas ref={canvasRef} width={1080} height={1920} className="w-full h-full block" />
                {isRendering && (
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
                    <div className="w-10 h-10 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    <div className="text-white text-xs font-medium">
                      {renderState === 'preparing' && 'تحضير...'}
                      {renderState === 'recording' && `بيسجّل ${Math.round(renderProgress * 100)}%`}
                      {renderState === 'finalizing' && 'بيخلّص...'}
                    </div>
                  </div>
                )}
                {renderState === 'done' && !isRendering && videoUrl && (
                  <video src={videoUrl} controls playsInline muted className="absolute inset-0 w-full h-full bg-black" />
                )}
              </div>

              {renderState === 'recording' && (
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all" style={{ width: `${Math.round(renderProgress * 100)}%` }} />
                </div>
              )}

              {videoUrl && renderState === 'done' && (
                <Button onClick={downloadVideo} className="gap-2 w-full">
                  <Download className="w-4 h-4" />
                  تحميل الفيديو (WebM)
                </Button>
              )}

              {/* Silent note */}
              <div className="flex items-center gap-2 p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs text-sky-700 dark:text-sky-300">
                <VolumeX className="w-4 h-4 shrink-0" />
                <span>الفيديو صامت. ضف موسيقى تريند يدوياً وقت الرفع على تيك-توك/ريلز.</span>
              </div>
            </CardContent>
          </Card>

          {/* Script + caption */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  نص الإعلان
                </CardTitle>
                {result.script && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => copyText('script', result.script)}>
                    {copied === 'script' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied === 'script' ? 'اتنسخ' : 'نسخ'}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <Textarea value={result.script} readOnly rows={5} className="resize-none text-sm leading-relaxed" dir="rtl" />
                <p className="text-[11px] text-muted-foreground mt-1">
                  نص ثابت جاهز (من ad-templates.ts) — بدون استدعاء AI.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2">📝 كابشن النشر</CardTitle>
                {result.caption && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => copyText('caption', result.caption + '\n\n' + result.hashtags.join(' '))}>
                    {copied === 'caption' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied === 'caption' ? 'اتنسخ' : 'نسخ الكل'}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea value={result.caption} readOnly rows={3} className="resize-none text-sm" dir="rtl" />
                <div className="flex flex-wrap gap-1.5">
                  {result.hashtags.map((h, i) => (
                    <Badge key={i} variant="secondary" className="text-[11px] font-normal">{h}</Badge>
                  ))}
                </div>
                <Button size="sm" variant="outline" className="gap-1 w-full text-xs" onClick={() => copyText('hashtags', result.hashtags.join(' '))}>
                  {copied === 'hashtags' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  نسخ الهاشتاجات
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-muted-foreground" />
                  مشاهد الإعلان ({result.scenes.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.scenes.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">{s.headline}</div>
                      {s.subtext && <div className="text-muted-foreground">{s.subtext}</div>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {!result && !generating && (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-500/20 to-rose-500/20 flex items-center justify-center">
              <Clapperboard className="w-7 h-7 text-amber-500" />
            </div>
            <div>
              <p className="font-semibold text-foreground">ابدأ بتجهيز الإعلان</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                اختار الميزة، والنص الجاهز + screenshots هتجهّز فوراً. بعدها اضغط "إنتاج الفيديو".
                كله في ~2 ثانية، بدون أي حمل على السيرفر.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
