'use client';

/**
 * VideoEditor.tsx — محرر فيديو كامل (شبه CapCut)
 * ====================================================================
 *
 * تحكم كامل في كل frame:
 * - إضافة / حذف / ترتيب frames (drag)
 * - تحرير نص كل frame (نص + حجم + لون + موقع Y)
 * - اختيار تأثير لكل نص (8 تأثيرات)
 * - تخصيص مدة كل frame
 * - معاينة frame واحدة
 * - اختيار visual template (ألوان + gradient)
 * - إنتاج الفيديو الكامل
 *
 * كل frame = scene مستقلة بـ:
 * { id, duration, emoji, texts: [{ text, effect, fontSize, color, y, delay, duration }] }
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
 Settings,
 Plus, Trash2, GripVertical, Play, Download, Loader2, Copy,
 Eye, ArrowUp, ArrowDown, Film, Type, Clock, Palette, Wand2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
 Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { drawAnimatedText, EFFECT_OPTIONS, EFFECT_PRESETS, type TextEffect } from '@/lib/text-effects';
import { getVisualTemplate, TEMPLATE_LIST, type VisualTemplate } from '@/lib/visual-templates';

// ─── Types ───

interface EditorText {
 id: string;
 text: string;
 effect: TextEffect;
 fontSize: number;
 color: string;
 yOffset: number; // نسبة من الارتفاع (0-1)
 delay: number;
 duration: number;
}

interface EditorFrame {
 id: string;
 duration: number;
 emoji?: string;
 texts: EditorText[];
}

// ─── Canvas drawing (visual template based) ───

function drawFrame(
 ctx: CanvasRenderingContext2D,
 frame: EditorFrame,
 template: VisualTemplate,
 progress: number,
 W: number,
 H: number,
) {
 // Background gradient
 const stops = template.gradient.split(', ');
 const bg = ctx.createLinearGradient(0, 0, W, H);
 stops.forEach((color, i) => {
 bg.addColorStop(i / (stops.length - 1), color.trim());
 });
 ctx.fillStyle = bg;
 ctx.fillRect(0, 0, W, H);

 // Decorative orbs
 ctx.save();
 ctx.globalAlpha = 0.25;
 const orb1 = ctx.createRadialGradient(W * 0.2, H * 0.2, 0, W * 0.2, H * 0.2, W * 0.5);
 orb1.addColorStop(0, template.accentColor);
 orb1.addColorStop(1, 'rgba(0,0,0,0)');
 ctx.fillStyle = orb1;
 ctx.fillRect(0, 0, W, H);
 ctx.restore();

 // Emoji (big, center-top)
 if (frame.emoji) {
 const pulse = 1 + 0.05 * Math.sin(progress * Math.PI * 2);
 ctx.save();
 ctx.font = `${Math.round(W * 0.15 * pulse)}px system-ui`;
 ctx.textAlign = 'center';
 ctx.textBaseline = 'middle';
 ctx.fillText(frame.emoji, W / 2, H * 0.25);
 ctx.restore();
 }

 // Texts
 frame.texts.forEach((t) => {
 const y = H * (0.4 + t.yOffset);
 drawAnimatedText(ctx, {
 text: t.text,
 effect: t.effect,
 fontSize: t.fontSize,
 color: t.color,
 delay: t.delay,
 duration: t.duration,
 easing: 'easeOut',
 }, W / 2, y, progress, frame.duration);
 });

 // Brand watermark
 ctx.save();
 ctx.font = `500 ${Math.round(H * 0.018)}px system-ui`;
 ctx.fillStyle = 'rgba(255,255,255,0.3)';
 ctx.textAlign = 'center';
 ctx.fillText('invist.m2y.net', W / 2, H * 0.96);
 ctx.restore();
}

// ─── Main component ───

let frameIdCounter = 0;
function genId() { return `frame_${Date.now()}_${frameIdCounter++}`; }

export function VideoEditor() {
 const [template, setTemplate] = useState<VisualTemplate>(TEMPLATE_LIST[0]);
 const [frames, setFrames] = useState<EditorFrame[]>([]);
 const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
 const [renderState, setRenderState] = useState<'idle' | 'rendering' | 'done'>('idle');
 const [renderProgress, setRenderProgress] = useState(0);
 const [videoUrl, setVideoUrl] = useState<string | null>(null);
 const [previewProgress, setPreviewProgress] = useState(0);
 const [isPreviewing, setIsPreviewing] = useState(false);
 const canvasRef = useRef<HTMLCanvasElement>(null);
 const cancelRef = useRef(false);
 const previewRAFRef = useRef<number | null>(null);

 // ─── Frame operations ───

 const addFrame = useCallback(() => {
 const newFrame: EditorFrame = {
 id: genId(),
 duration: 5,
 emoji: template.emoji,
 texts: [
 {
 id: genId(),
 text: 'نص جديد',
 effect: 'zoomIn',
 fontSize: 48,
 color: template.textColor,
 yOffset: 0,
 delay: 0,
 duration: 0.8,
 },
 ],
 };
 setFrames((prev) => [...prev, newFrame]);
 setSelectedFrameId(newFrame.id);
 }, [template]);

 const deleteFrame = useCallback((id: string) => {
 setFrames((prev) => prev.filter((f) => f.id !== id));
 }, []);

 const duplicateFrame = useCallback((id: string) => {
 setFrames((prev) => {
 const idx = prev.findIndex((f) => f.id === id);
 if (idx === -1) return prev;
 const copy = { ...prev[idx], id: genId(), texts: prev[idx].texts.map((t) => ({ ...t, id: genId() })) };
 const next = [...prev];
 next.splice(idx + 1, 0, copy);
 return next;
 });
 }, []);

 const moveFrame = useCallback((id: string, dir: 'up' | 'down') => {
 setFrames((prev) => {
 const idx = prev.findIndex((f) => f.id === id);
 if (idx === -1) return prev;
 const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
 if (swapIdx < 0 || swapIdx >= prev.length) return prev;
 const next = [...prev];
 [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
 return next;
 });
 }, []);

 const updateFrame = useCallback((id: string, updates: Partial<EditorFrame>) => {
 setFrames((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
 }, []);

 const updateText = useCallback((frameId: string, textId: string, updates: Partial<EditorText>) => {
 setFrames((prev) => prev.map((f) => f.id === frameId ? {
 ...f,
 texts: f.texts.map((t) => (t.id === textId ? { ...t, ...updates } : t)),
 } : f));
 }, []);

 const addText = useCallback((frameId: string) => {
 setFrames((prev) => prev.map((f) => f.id === frameId ? {
 ...f,
 texts: [...f.texts, {
 id: genId(),
 text: 'نص جديد',
 effect: 'fade' as TextEffect,
 fontSize: 32,
 color: template.textColor,
 yOffset: f.texts.length * 0.1,
 delay: 0.2,
 duration: 0.6,
 }],
 } : f));
 }, [template]);

 const deleteText = useCallback((frameId: string, textId: string) => {
 setFrames((prev) => prev.map((f) => f.id === frameId ? {
 ...f,
 texts: f.texts.filter((t) => t.id !== textId),
 } : f));
 }, []);

 // ─── Preview single frame ───

 const previewFrame = useCallback((frame: EditorFrame) => {
 const canvas = canvasRef.current;
 if (!canvas) return;
 const ctx = canvas.getContext('2d');
 if (!ctx) return;

 cancelRef.current = false;
 setIsPreviewing(true);
 const startTime = performance.now();

 const draw = () => {
 if (cancelRef.current) {
 setIsPreviewing(false);
 return;
 }
 const elapsed = (performance.now() - startTime) / 1000;
 const progress = Math.min(elapsed / frame.duration, 1);
 setPreviewProgress(progress);

 ctx.clearRect(0, 0, 1080, 1920);
 drawFrame(ctx, frame, template, progress, 1080, 1920);

 if (elapsed < frame.duration) {
 previewRAFRef.current = requestAnimationFrame(draw);
 } else {
 setIsPreviewing(false);
 }
 };
 draw();
 }, [template]);

 // ─── Render full video ───

 const renderVideo = useCallback(async () => {
 const canvas = canvasRef.current;
 if (!canvas || frames.length === 0) {
 toast.error('مفيش frames — أضف frame الأول');
 return;
 }
 const ctx = canvas.getContext('2d');
 if (!ctx) return;

 cancelRef.current = false;
 setRenderState('rendering');
 setRenderProgress(0);
 if (videoUrl) URL.revokeObjectURL(videoUrl);
 setVideoUrl(null);

 const W = 1080, H = 1920;
 const totalDuration = frames.reduce((s, f) => s + f.duration, 0);

 const stream = canvas.captureStream(30);
 const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((c) => MediaRecorder.isTypeSupported(c)) || 'video/webm';
 const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
 const chunks: Blob[] = [];
 recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
 const finished = new Promise<Blob>((resolve) => { recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); });

 recorder.start(100);
 const startTime = performance.now();

 const draw = () => {
 if (cancelRef.current) { if (recorder.state !== 'inactive') recorder.stop(); return; }
 const elapsed = (performance.now() - startTime) / 1000;
 const t = Math.min(elapsed, totalDuration);
 const gp = totalDuration > 0 ? t / totalDuration : 0;
 setRenderProgress(gp);

 // find current frame
 let acc = 0;
 let currentFrame: EditorFrame | null = null;
 let frameStart = 0;
 for (const f of frames) {
 if (t < acc + f.duration) { currentFrame = f; frameStart = acc; break; }
 acc += f.duration;
 }
 if (!currentFrame) { currentFrame = frames[frames.length - 1]; frameStart = totalDuration - currentFrame.duration; }
 const frameProgress = (t - frameStart) / currentFrame.duration;

 ctx.clearRect(0, 0, W, H);
 drawFrame(ctx, currentFrame, template, frameProgress, W, H);

 // progress bar
 ctx.fillStyle = 'rgba(255,255,255,0.12)';
 ctx.fillRect(W * 0.08, H * 0.965, W * 0.84, H * 0.006);
 ctx.fillStyle = template.accentColor;
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
 }, [frames, template, videoUrl]);

 const cancelRender = useCallback(() => {
 cancelRef.current = true;
 setRenderState('idle');
 }, []);

 const downloadVideo = useCallback(() => {
 if (!videoUrl) return;
 const a = document.createElement('a');
 a.href = videoUrl;
 a.download = `video-${Date.now()}.webm`;
 a.click();
 }, [videoUrl]);

 // Cleanup
 useEffect(() => {
 return () => {
 if (previewRAFRef.current) cancelAnimationFrame(previewRAFRef.current);
 };
 }, []);

 // Draw idle state
 useEffect(() => {
 if (isPreviewing || renderState === 'rendering') return;
 const canvas = canvasRef.current;
 if (!canvas) return;
 const ctx = canvas.getContext('2d');
 if (!ctx) return;
 const selectedFrame = frames.find((f) => f.id === selectedFrameId);
 if (selectedFrame) {
 drawFrame(ctx, selectedFrame, template, 0.5, 1080, 1920);
 } else {
 // empty state
 ctx.fillStyle = '#0f172a';
 ctx.fillRect(0, 0, 1080, 1920);
 ctx.fillStyle = 'rgba(255,255,255,0.3)';
 ctx.font = '40px system-ui';
 ctx.textAlign = 'center';
 ctx.fillText('أضف frame للبدء', 540, 960);
 }
 }, [frames, selectedFrameId, template, isPreviewing, renderState]);

 const totalDuration = frames.reduce((s, f) => s + f.duration, 0);
 const selectedFrame = frames.find((f) => f.id === selectedFrameId);

 return (
 <div className="space-y-4">
 {/* Header */}
 <Card className="border-violet-500/30 from-violet-500/5 to-fuchsia-500/5">
 <CardHeader className="pb-3">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-xl from-violet-500 to-fuchsia-500 flex items-center justify-center">
 <Film className="w-5 h-5 text-foreground" />
 </div>
 <div>
 <CardTitle className="text-base">محرر الفيديو الكامل</CardTitle>
 <p className="text-xs text-muted-foreground">تحكم كامل في كل frame + نص + تأثير — زي CapCut</p>
 </div>
 </div>
 </CardHeader>
 </Card>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
 {/* LEFT: Timeline + Frames */}
 <div className="lg:col-span-1 space-y-3">
 {/* Template selector */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Palette className="w-4 h-4" />
 القالب البصري
 </CardTitle>
 </CardHeader>
 <CardContent>
 <Select value={template.id} onValueChange={(v) => setTemplate(getVisualTemplate(v))}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 {TEMPLATE_LIST.map((t) => (
 <SelectItem key={t.id} value={t.id}>
 <span className="me-1">{t.emoji}</span> {t.name}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 {/* Color preview */}
 <div className="flex gap-1 mt-2">
 <div className="w-6 h-6 rounded" style={{ background: template.accentColor }} title="Accent" />
 <div className="w-6 h-6 rounded" style={{ background: template.accentColor2 }} title="Accent 2" />
 <div className="w-6 h-6 rounded" style={{ background: template.numberColor }} title="Number" />
 <div className="w-6 h-6 rounded border" style={{ background: template.textColor, borderColor: template.borderColor }} title="Text" />
 </div>
 </CardContent>
 </Card>

 {/* Timeline */}
 <Card>
 <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-sm flex items-center gap-2">
 <Film className="w-4 h-4" />
 Timeline ({frames.length} frame)
 </CardTitle>
 <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={addFrame}>
 <Plus className="w-3 h-3" />
 Frame
 </Button>
 </CardHeader>
 <CardContent className="space-y-2 max-h-80 overflow-y-auto">
 {frames.length === 0 ? (
 <p className="text-xs text-muted-foreground text-center py-4">أضف frame للبدء</p>
 ) : (
 frames.map((frame, idx) => (
 <div
 key={frame.id}
 className={cn(
 'rounded-lg border p-2 transition-all cursor-pointer',
 selectedFrameId === frame.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border hover:bg-muted/30',
 )}
 onClick={() => setSelectedFrameId(frame.id)}
 >
 <div className="flex items-center gap-2">
 <GripVertical className="w-3 h-3 text-muted-foreground shrink-0" />
 <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>
 <span className="text-lg">{frame.emoji || '📄'}</span>
 <span className="text-xs flex-1 truncate">
 {frame.texts[0]?.text?.slice(0, 20) || 'فاضي'}
 </span>
 <Badge variant="outline" className="text-xs gap-1">
 <Clock className="w-2.5 h-2.5" />
 {frame.duration}ث
 </Badge>
 </div>
 <div className="flex gap-1 mt-1.5">
 <button onClick={(e) => { e.stopPropagation(); moveFrame(frame.id, 'up'); }} className="p-1 rounded hover:bg-muted" title="لأعلى">
 <ArrowUp className="w-3 h-3" />
 </button>
 <button onClick={(e) => { e.stopPropagation(); moveFrame(frame.id, 'down'); }} className="p-1 rounded hover:bg-muted" title="لأسفل">
 <ArrowDown className="w-3 h-3" />
 </button>
 <button onClick={(e) => { e.stopPropagation(); previewFrame(frame); }} className="p-1 rounded hover:bg-muted text-primary" title="معاينة">
 <Eye className="w-3 h-3" />
 </button>
 <button onClick={(e) => { e.stopPropagation(); duplicateFrame(frame.id); }} className="p-1 rounded hover:bg-muted" title="نسخ">
 <Copy className="w-3 h-3" />
 </button>
 <button onClick={(e) => { e.stopPropagation(); deleteFrame(frame.id); }} className="p-1 rounded hover:bg-loss/10 text-loss" title="حذف">
 <Trash2 className="w-3 h-3" />
 </button>
 </div>
 </div>
 ))
 )}
 </CardContent>
 </Card>

 {/* Summary + Render */}
 <Card>
 <CardContent className="pt-3 space-y-2">
 <div className="flex items-center justify-between text-xs">
 <span className="text-muted-foreground">المدة الكلية:</span>
 <span className="font-bold">{totalDuration}ث ≈ {Math.floor(totalDuration / 60)}:{String(totalDuration % 60).padStart(2, '0')}</span>
 </div>
 <Button
 onClick={renderVideo}
 disabled={renderState === 'rendering' || frames.length === 0}
 className="w-full gap-2 from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-foreground"
 >
 {renderState === 'rendering' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
 {renderState === 'rendering' ? `بيسجّل ${Math.round(renderProgress * 100)}%` : 'أنتج الفيديو'}
 </Button>
 {renderState === 'rendering' && (
 <Button onClick={cancelRender} variant="outline" size="sm" className="w-full">إلغاء</Button>
 )}
 {renderState === 'done' && videoUrl && (
 <Button onClick={downloadVideo} variant="default" className="w-full gap-2">
 <Download className="w-4 h-4" /> تحميل الفيديو
 </Button>
 )}
 </CardContent>
 </Card>
 </div>

 {/* CENTER: Canvas preview */}
 <div className="lg:col-span-1">
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Eye className="w-4 h-4" />
 معاينة {isPreviewing && <Badge variant="default" className="text-xs animate-pulse">Live</Badge>}
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="relative mx-auto bg-black rounded-xl overflow-hidden shadow-lg" style={{ width: 'min(280px, 100%)', aspectRatio: '9/16' }}>
 <canvas ref={canvasRef} width={1080} height={1920} className="w-full h-full block" />
 {isPreviewing && (
 <div className="absolute bottom-2 left-2 right-2">
 <div className="bg-black/50 rounded-full h-1.5 overflow-hidden">
 <div className="h-full bg-primary transition-all" style={{ width: `${previewProgress * 100}%` }} />
 </div>
 </div>
 )}
 </div>
 {selectedFrame && (
 <p className="text-xs text-muted-foreground text-center mt-2">
 Frame #{frames.indexOf(selectedFrame) + 1} • {selectedFrame.texts.length} نص
 </p>
 )}
 </CardContent>
 </Card>
 </div>

 {/* RIGHT: Frame editor */}
 <div className="lg:col-span-1 space-y-3">
 {selectedFrame ? (
 <>
 {/* Frame settings */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Settings className="w-4 h-4" />
 إعدادات Frame
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="space-y-1.5">
 <Label className="text-xs">المدة: {selectedFrame.duration}ث</Label>
 <input type="range" min={2} max={10} value={selectedFrame.duration} onChange={(e) => updateFrame(selectedFrame.id, { duration: Number(e.target.value) })} className="w-full accent-violet-500" />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">Emoji</Label>
 <Input
 value={selectedFrame.emoji || ''}
 onChange={(e) => updateFrame(selectedFrame.id, { emoji: e.target.value })}
 placeholder="🛰️"
 maxLength={4}
 />
 </div>
 </CardContent>
 </Card>

 {/* Text elements */}
 <Card>
 <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-sm flex items-center gap-2">
 <Type className="w-4 h-4" />
 النصوص ({selectedFrame.texts.length})
 </CardTitle>
 <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => addText(selectedFrame.id)}>
 <Plus className="w-3 h-3" />
 نص
 </Button>
 </CardHeader>
 <CardContent className="space-y-3 max-h-96 overflow-y-auto">
 {selectedFrame.texts.map((text, ti) => (
 <div key={text.id} className="space-y-2 p-2.5 rounded-lg border border-border bg-muted/20">
 <div className="flex items-center justify-between">
 <span className="text-xs font-bold text-muted-foreground">نص #{ti + 1}</span>
 <button onClick={() => deleteText(selectedFrame.id, text.id)} className="p-1 rounded hover:bg-loss/10 text-loss">
 <Trash2 className="w-3 h-3" />
 </button>
 </div>
 <Textarea
 value={text.text}
 onChange={(e) => updateText(selectedFrame.id, text.id, { text: e.target.value })}
 rows={2}
 className="resize-none text-xs"
 dir="rtl"
 />
 <div className="grid grid-cols-2 gap-2">
 <div className="space-y-1">
 <Label className="text-xs">التأثير</Label>
 <Select value={text.effect} onValueChange={(v) => updateText(selectedFrame.id, text.id, { effect: v as TextEffect })}>
 <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
 <SelectContent>
 {EFFECT_OPTIONS.map((e) => (
 <SelectItem key={e.value} value={e.value} className="text-xs">{e.label}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1">
 <Label className="text-xs">الحجم: {text.fontSize}</Label>
 <input type="range" min={16} max={80} value={text.fontSize} onChange={(e) => updateText(selectedFrame.id, text.id, { fontSize: Number(e.target.value) })} className="w-full accent-violet-500" />
 </div>
 </div>
 <div className="grid grid-cols-2 gap-2">
 <div className="space-y-1">
 <Label className="text-xs">الموقع Y: {Math.round(text.yOffset * 100)}%</Label>
 <input type="range" min={-0.3} max={0.5} step={0.05} value={text.yOffset} onChange={(e) => updateText(selectedFrame.id, text.id, { yOffset: Number(e.target.value) })} className="w-full accent-violet-500" />
 </div>
 <div className="space-y-1">
 <Label className="text-xs">التأخير: {text.delay}ث</Label>
 <input type="range" min={0} max={3} step={0.1} value={text.delay} onChange={(e) => updateText(selectedFrame.id, text.id, { delay: Number(e.target.value) })} className="w-full accent-violet-500" />
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Label className="text-xs">اللون:</Label>
 <input type="color" value={text.color} onChange={(e) => updateText(selectedFrame.id, text.id, { color: e.target.value })} className="w-8 h-8 rounded cursor-pointer border border-border" />
 <button onClick={() => updateText(selectedFrame.id, text.id, { color: template.accentColor })} className="text-xs text-primary hover:underline">لون القالب</button>
 <button onClick={() => updateText(selectedFrame.id, text.id, { color: template.numberColor })} className="text-xs text-warning hover:underline">لون الأرقام</button>
 </div>
 </div>
 ))}
 </CardContent>
 </Card>
 </>
 ) : (
 <Card className="border-dashed">
 <CardContent className="py-12 flex flex-col items-center text-center gap-3">
 <Wand2 className="w-8 h-8 text-muted-foreground" />
 <p className="text-sm text-muted-foreground">اختر frame من الـ timeline أو أضف frame جديد</p>
 <Button onClick={addFrame} size="sm" variant="outline" className="gap-2">
 <Plus className="w-4 h-4" />
 أضف Frame أول
 </Button>
 </CardContent>
 </Card>
 )}
 </div>
 </div>
 </div>
 );
}
