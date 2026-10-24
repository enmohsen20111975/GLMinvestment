// constants + types — extracted (Phase 3)

'use client';

// TODO(F-Strangler-LearningVisuals): Strangler Pattern extraction skipped.
// Audit performed 2025-01-XX: this file (2,621 LOC, 24 visual components +
// 1 mulberry32 RNG helper) contains NO data-fetching logic — zero `fetch()`
// calls, zero `useEffect`, zero `/api/*` invocations, zero `useApiQuery`.
// The only React state/hooks present are UI-interaction state, not data state:
//   - Lines 2123-2126 (RiskRewardVisual): entry/stop/target drag + dragging
//     handle — interactive SVG price-chart drag state.
//   - Line 2423 (PortfolioAllocationVisual): `active` Asset slice — donut
//     wheel click/hover selection state.
//   - Lines 2111, 2115 (RiskRewardVisual): `priceToY`/`yToPrice` — pure math
//     helpers for SVG coordinate ↔ price conversion.
// All other "data" (P/E examples, market sessions, asset allocations, candle
// variants) are hardcoded educational constants, NOT API responses — moving
// them to a `useLearningVisualsData` hook would either (a) leave the hook
// with zero `useApiQuery` calls (violating the Strangler migration mandate
// that requires TanStack Query for fetches) or (b) invent fake API endpoints
// that don't exist. Neither is acceptable. File is already render-only and
// has no imperative fetch+state to migrate. Strangler target should be
// re-routed to a file with actual fetch logic (e.g. /modules/education/
// components/LearningDashboard.tsx or similar container that loads data
// from /api/* and renders these visuals).
// Status: SKIPPED — no code change. HTTP 200 baseline preserved.

import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Lightbulb, AlertTriangle, Key, BookOpen, CheckCircle2, XCircle, TrendingUp, TrendingDown, ClipboardCheck, Zap, NotebookPen, ShieldCheck, Database, Signal, Lock, Send, FileText, RefreshCw, Layers, ArrowUp, ArrowDown, Scale, PieChart, Crosshair } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ============================================================
 LEARNING VISUAL COMPONENTS
 مكونات رسوم توضيحية تفاعلية للجزء التعليمي
 ============================================================ */

/* ── 1. Candlestick Diagram (شموع يابانية) ── */
export function CandlestickDiagram({ variant = 'bullish' }: { variant?: 'bullish' | 'bearish' | 'doji' | 'hammer' }) {
 const candles: Record<string, { open: number; close: number; high: number; low: number; color: string }> = {
 bullish: { open: 40, close: 20, high: 10, low: 50, color: '#10b981' },
 bearish: { open: 20, close: 40, high: 10, low: 50, color: '#ef4444' },
 doji: { open: 30, close: 32, high: 10, low: 50, color: '#6b7280' },
 hammer: { open: 35, close: 25, high: 20, low: 65, color: '#10b981' },
 };
 const c = candles[variant];
 const labels: Record<string, string> = {
 bullish: 'شمعة صاعدة (Bullish) - السعر ارتفع',
 bearish: 'شمعة هابطة (Bearish) - السعر انخفض',
 doji: 'شمعة الدوجي (Doji) - تردد في السوق',
 hammer: 'شمعة المطرقة (Hammer) - انعكاس محتمل',
 };

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-12 h-auto sm:h-48">
 {/* Candle visualization */}
 <svg width="80" height="180" viewBox="0 0 80 180" className="flex-shrink-0">
 {/* Wick (high to low) */}
 <line x1="40" y1={c.high} x2="40" y2={c.low} stroke={c.color} strokeWidth="2" />
 {/* Body (open to close) */}
 <rect
 x="25"
 y={Math.min(c.open, c.close)}
 width="30"
 height={Math.abs(c.close - c.open) || 4}
 fill={c.color}
 rx="2"
 />
 {/* Labels */}
 <line x1="60" y1={c.high} x2="70" y2={c.high} stroke="#6b7280" strokeWidth="1" strokeDasharray="2" />
 <text x="72" y={c.high + 4} fontSize="10" fill="#6b7280">أعلى</text>
 <line x1="60" y1={c.low} x2="70" y2={c.low} stroke="#6b7280" strokeWidth="1" strokeDasharray="2" />
 <text x="72" y={c.low + 4} fontSize="10" fill="#6b7280">أدنى</text>
 <line x1="10" y1={c.open} x2="25" y2={c.open} stroke="#6b7280" strokeWidth="1" strokeDasharray="2" />
 <text x="0" y={c.open + 4} fontSize="10" fill="#6b7280">افتتاح</text>
 <line x1="10" y1={c.close} x2="25" y2={c.close} stroke="#6b7280" strokeWidth="1" strokeDasharray="2" />
 <text x="0" y={c.close + 4} fontSize="10" fill="#6b7280">إغلاق</text>
 </svg>

 {/* Description */}
 <div className="flex-1 max-w-xs text-center sm:text-right">
 <h4 className="font-bold text-lg mb-2" style={{ color: c.color }}>{labels[variant]}</h4>
 <div className="space-y-1 text-sm text-muted-foreground">
 <p>• <span className="font-semibold">الجسم (Body):</span> بين سعر الافتتاح والإغلاق</p>
 <p>• <span className="font-semibold">الظل (Wick):</span> من أعلى سعر لأدنى سعر</p>
 <p>• <span className="font-semibold">اللون الأخضر:</span> الإغلاق أعلى من الافتتاح</p>
 <p>• <span className="font-semibold">اللون الأحمر:</span> الإغلاق أقل من الافتتاح</p>
 </div>
 </div>
 </div>
 </div>
 );
}

/* ── 2. P/E Ratio Visual (نسبة السعر إلى الأرباح) ── */
export function PERatioVisual() {
 const examples = [
 { company: 'البنك التجاري الدولي', price: 132, eps: 15, pe: 8.8, status: 'رخيص', color: 'text-profit' },
 { company: 'أوراسكوم للتنمية', price: 734, eps: 25, pe: 29.4, status: 'مكلف', color: 'text-loss' },
 { company: 'اتصالات مصر', price: 94, eps: 6.5, pe: 14.5, status: 'معقول', color: 'text-warning' },
 ];

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">أمثلة عملية: حساب P/E لأسهم مصرية</h4>
 <div className="space-y-3">
 {examples.map((ex, i) => (
 <motion.div
 key={i}
 initial={{ opacity: 0, x: -20 }}
 animate={{ opacity: 1, x: 0 }}
 transition={{ delay: i * 0.15 }}
 className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
 >
 <div className="flex-1">
 <p className="font-semibold text-sm">{ex.company}</p>
 <p className="text-xs text-muted-foreground">
 السعر: {ex.price} ج.م | EPS: {ex.eps} ج.م
 </p>
 </div>
 <div className="flex items-center gap-3">
 <div className="text-center">
 <p className="text-xs text-muted-foreground">P/E</p>
 <p className="font-bold text-lg">{ex.pe}</p>
 </div>
 <Badge color={ex.color}>{ex.status}</Badge>
 </div>
 </motion.div>
 ))}
 </div>
 <p className="text-xs text-muted-foreground mt-3 text-center">
 القاعدة: P/E &lt; 10 رخيص | 10-20 معقول | &gt; 30 مكلف
 </p>
 </div>
 );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
 return <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', color)}>{children}</span>;
}

/* ── 3. Market Hours Timeline (ساعات التداول) ── */
export function MarketHoursTimeline() {
 const sessions = [
 { time: '9:00', label: 'الجلسة الاستباقية', desc: 'إدخال الأوامر', color: 'bg-whale', active: false },
 { time: '9:45', label: 'فتح التداول', desc: 'بداية التنفيذ', color: 'bg-profit', active: true },
 { time: '10:00', label: 'الجلسة الرئيسية', desc: 'أعلى سيولة', color: 'bg-profit', active: true },
 { time: '14:30', label: 'إغلاق التداول', desc: 'نهاية الجلسة', color: 'bg-warning', active: false },
 ];

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-4 text-center">ساعات عمل البورصة المصرية (بتوقيت القاهرة)</h4>
 <div className="relative">
 {/* Timeline line */}
 <div className="absolute top-6 right-0 left-0 h-0.5 bg-border" />
 <div className="relative flex justify-between">
 {sessions.map((s, i) => (
 <motion.div
 key={i}
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: i * 0.2 }}
 className="flex flex-col items-center gap-2 flex-1"
 >
 <div className={cn('w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xs z-10', s.color)}>
 {s.time}
 </div>
 <div className="text-center">
 <p className="text-xs font-semibold">{s.label}</p>
 <p className="text-xs text-muted-foreground">{s.desc}</p>
 </div>
 </motion.div>
 ))}
 </div>
 </div>
 <div className="mt-4 p-2 rounded-lg bg-warning/10 border border-warning/20">
 <p className="text-xs text-warning text-center">
 ⚠️ أعلى تقلبات: أول 30 دقيقة وآخر 30 دقيقة - ينصح المبتدئون بتجنبها
 </p>
 </div>
 </div>
 );
}

/* ── 4. Portfolio Diversification (تنويع المحفظة) ── */
export function PortfolioDiversification() {
 const allocations = [
 { sector: 'البنوك', percent: 30, color: 'bg-profit' },
 { sector: 'العقارات', percent: 25, color: 'bg-whale' },
 { sector: 'الاتصالات', percent: 20, color: 'bg-primary' },
 { sector: 'الصناعة', percent: 15, color: 'bg-warning' },
 { sector: 'نقدية', percent: 10, color: 'bg-muted' },
 ];

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-4 text-center">مثال: توزيع محفظة استثمارية متنوعة</h4>
 <div className="flex h-12 rounded-lg overflow-hidden">
 {allocations.map((a, i) => (
 <motion.div
