'use client';

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
 key={i}
 initial={{ width: 0 }}
 animate={{ width: `${a.percent}%` }}
 transition={{ delay: i * 0.2, duration: 0.5 }}
 className={cn('flex items-center justify-center text-white text-xs font-bold', a.color)}
 title={`${a.sector}: ${a.percent}%`}
 >
 {a.percent}%
 </motion.div>
 ))}
 </div>
 <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
 {allocations.map((a, i) => (
 <div key={i} className="flex items-center gap-2 text-xs">
 <div className={cn('w-3 h-3 rounded', a.color)} />
 <span>{a.sector}</span>
 </div>
 ))}
 </div>
 <p className="text-xs text-muted-foreground mt-3 text-center">
 القاعدة الذهبية: لا تضع أكثر من 30% من رأس مالك في قطاع واحد
 </p>
 </div>
 );
}

/* ── 5. Risk Management Pyramid (هرم إدارة المخاطر) ── */
export function RiskPyramid() {
 const levels = [
 { level: 'عالي المخاطر', desc: '10% - مضاربات و أسهم صغيرة', color: 'bg-loss', width: 'w-1/4' },
 { level: 'متوسط المخاطر', desc: '30% - أسهم نمو و تحليل فني', color: 'bg-warning', width: 'w-1/2' },
 { level: 'منخفض المخاطر', desc: '60% - أسهم قيمة و توزيعات أرباح', color: 'bg-profit', width: 'w-3/4' },
 ];

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-4 text-center">هرم توزيع المخاطر</h4>
 <div className="flex flex-col items-center gap-1">
 {levels.map((l, i) => (
 <motion.div
 key={i}
 initial={{ opacity: 0, scale: 0.8 }}
 animate={{ opacity: 1, scale: 1 }}
 transition={{ delay: i * 0.2 }}
 className={cn('flex flex-col items-center justify-center text-white p-2 rounded', l.color, l.width)}
 >
 <p className="text-xs font-bold">{l.level}</p>
 <p className="text-xs">{l.desc}</p>
 </motion.div>
 ))}
 </div>
 </div>
 );
}

/* ── 6. Callout Box (صناديق ملاحظات) ── */
export function CalloutBox({ type, title, children }: { type: 'tip' | 'warning' | 'key' | 'example'; title: string; children: React.ReactNode }) {
 const config = {
 tip: { icon: Lightbulb, color: 'border-whale/20 bg-whale/5', iconColor: 'text-whale', titleColor: 'text-whale ' },
 warning: { icon: AlertTriangle, color: 'border-warning/20 bg-warning/5', iconColor: 'text-warning', titleColor: 'text-warning ' },
 key: { icon: Key, color: 'border-profit/20 bg-profit/5', iconColor: 'text-profit', titleColor: 'text-profit ' },
 example: { icon: BookOpen, color: 'border-purple-500/30 bg-primary/5', iconColor: 'text-primary', titleColor: 'text-primary ' },
 };
 const { icon: Icon, color, iconColor, titleColor } = config[type];

 return (
 <motion.div
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 className={cn('my-4 p-4 rounded-xl border', color)}
 >
 <div className="flex items-center gap-2 mb-2">
 <Icon className={cn('w-5 h-5', iconColor)} />
 <h4 className={cn('font-bold text-sm', titleColor)}>{title}</h4>
 </div>
 <div className="text-sm text-foreground/90 leading-relaxed">{children}</div>
 </motion.div>
 );
}

/* ── 7. Example Card (بطاقة مثال عملي) ── */
export function ExampleCard({ title, scenario, calculation, result, takeaway }: {
 title: string;
 scenario: string;
 calculation: React.ReactNode;
 result: string;
 takeaway: string;
}) {
 return (
 <motion.div
 initial={{ opacity: 0, scale: 0.95 }}
 animate={{ opacity: 1, scale: 1 }}
 className="my-4 rounded-xl border border-purple-500/30 bg-primary/5 overflow-hidden"
 >
 <div className="bg-primary/10 px-4 py-2 border-b border-purple-500/20">
 <div className="flex items-center gap-2">
 <BookOpen className="w-4 h-4 text-primary" />
 <h4 className="font-bold text-sm text-primary ">مثال عملي: {title}</h4>
 </div>
 </div>
 <div className="p-4 space-y-3">
 <div>
 <p className="text-xs font-semibold text-muted-foreground mb-1">السيناريو:</p>
 <p className="text-sm">{scenario}</p>
 </div>
 <div>
 <p className="text-xs font-semibold text-muted-foreground mb-1">الحساب:</p>
 <div className="text-sm font-mono bg-muted/30 p-2 rounded">{calculation}</div>
 </div>
 <div className="flex items-start gap-2 p-2 rounded bg-profit/10">
 <CheckCircle2 className="w-4 h-4 text-profit mt-0.5 flex-shrink-0" />
 <div>
 <p className="text-xs font-semibold text-profit ">النتيجة:</p>
 <p className="text-sm">{result}</p>
 </div>
 </div>
 <div className="flex items-start gap-2 p-2 rounded bg-whale/10">
 <Lightbulb className="w-4 h-4 text-whale mt-0.5 flex-shrink-0" />
 <div>
 <p className="text-xs font-semibold text-whale ">الدرس المستفاد:</p>
 <p className="text-sm">{takeaway}</p>
 </div>
 </div>
 </div>
 </motion.div>
 );
}

/* ── 8. RSI Gauge (مؤشر القوة النسبية) ── */
export function RSIGauge({ value = 65 }: { value?: number }) {
 const angle = (value / 100) * 180 - 90; // -90 to 90 degrees
 const zone = value >= 70 ? { label: 'تشبع شرائي', color: 'text-loss' } :
 value <= 30 ? { label: 'تشبع بيعي', color: 'text-profit' } :
 { label: 'منطقة محايدة', color: 'text-warning' };

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">مؤشر RSI - القوة النسبية</h4>
 <div className="flex flex-col items-center">
 <svg width="200" height="120" viewBox="0 0 200 120">
 {/* Background arc - green zone (0-30) */}
 <path d="M 20 100 A 80 80 0 0 1 80 30" fill="none" stroke="#10b981" strokeWidth="12" />
 {/* Yellow zone (30-70) */}
 <path d="M 80 30 A 80 80 0 0 1 120 30" fill="none" stroke="#f59e0b" strokeWidth="12" />
 {/* Red zone (70-100) */}
 <path d="M 120 30 A 80 80 0 0 1 180 100" fill="none" stroke="#ef4444" strokeWidth="12" />
 {/* Needle */}
 <motion.line
 x1="100" y1="100"
 x2="100" y2="40"
 stroke="#1f2937" strokeWidth="3" strokeLinecap="round"
 initial={{ rotate: -90 }}
 animate={{ rotate: angle }}
 transition={{ duration: 1, ease: 'easeOut' }}
 style={{ transformOrigin: '100px 100px' }}
 />
 <circle cx="100" cy="100" r="6" fill="#1f2937" />
 {/* Value text */}
 <text x="100" y="115" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#1f2937">{value}</text>
 </svg>
 <p className={cn('font-bold text-lg', zone.color)}>{zone.label}</p>
 <div className="flex gap-4 mt-2 text-xs">
 <span className="text-profit">تشبع بيعي (≤30)</span>
 <span className="text-warning">محايد (30-70)</span>
 <span className="text-loss">تشبع شرائي (≥70)</span>
 </div>
 </div>
 </div>
 );
}

/* ── 9. MACD Indicator (مؤشر MACD) ── */
export function MACDVisual() {
 // Simulated MACD data points
 const dataPoints = [
 { macd: -2, signal: -1.5, hist: -0.5 },
 { macd: -1.5, signal: -1.8, hist: 0.3 },
 { macd: -0.5, signal: -1.5, hist: 1 },
 { macd: 0.5, signal: -1, hist: 1.5 },
 { macd: 1.5, signal: -0.2, hist: 1.7 },
 { macd: 2, signal: 0.8, hist: 1.2 },
 { macd: 1.8, signal: 1.5, hist: 0.3 },
 { macd: 1, signal: 1.6, hist: -0.6 },
 { macd: 0.2, signal: 1.3, hist: -1.1 },
 ];

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">مؤشر MACD - تقاطع خط الإشارة</h4>
 <svg width="100%" height="180" viewBox="0 0 360 180">
 {/* Zero line */}
 <line x1="20" y1="90" x2="340" y2="90" stroke="#6b7280" strokeWidth="1" strokeDasharray="4" />
 <text x="345" y="94" fontSize="10" fill="#6b7280">0</text>

 {/* Histogram bars */}
 {dataPoints.map((d, i) => {
 const x = 30 + i * 38;
 const h = Math.abs(d.hist) * 18;
 const y = d.hist >= 0 ? 90 - h : 90;
 return (
 <motion.rect
 key={`h-${i}`}
 x={x} y={y} width="12" height={h}
 fill={d.hist >= 0 ? '#10b98180' : '#ef444480'}
 initial={{ height: 0 }}
 animate={{ height: h }}
 transition={{ delay: i * 0.1 }}
 />
 );
 })}

 {/* MACD line */}
 <motion.path
 d={`M ${dataPoints.map((d, i) => `${30 + i * 38} ${90 - d.macd * 18}`).join(' L ')}`}
 fill="none" stroke="#3b82f6" strokeWidth="2"
 initial={{ pathLength: 0 }}
 animate={{ pathLength: 1 }}
 transition={{ duration: 1.5 }}
 />
 {/* Signal line */}
 <motion.path
 d={`M ${dataPoints.map((d, i) => `${30 + i * 38} ${90 - d.signal * 18}`).join(' L ')}`}
 fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4"
 initial={{ pathLength: 0 }}
 animate={{ pathLength: 1 }}
 transition={{ duration: 1.5, delay: 0.3 }}
 />

 {/* Crossover annotation */}
 <circle cx="180" cy="54" r="6" fill="none" stroke="#10b981" strokeWidth="2" />
 <text x="165" y="40" fontSize="9" fill="#10b981" fontWeight="bold">تقاطع ذهبي</text>
 </svg>
 <div className="flex justify-center gap-4 mt-2 text-xs">
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-whale" /> MACD</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-warning" /> خط الإشارة</span>
 <span className="flex items-center gap-1"><span className="w-3 h-2 bg-profit/10" /> الهيستوجرام</span>
 </div>
 </div>
 );
}

/* ── 10. Support/Resistance (الدعم والمقاومة) ── */
export function SupportResistanceVisual() {
 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">مستويات الدعم والمقاومة</h4>
 <svg width="100%" height="220" viewBox="0 0 360 220">
 {/* Resistance line */}
 <motion.line
 x1="20" y1="50" x2="340" y2="50"
 stroke="#ef4444" strokeWidth="2" strokeDasharray="6"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }}
 />
 <text x="280" y="45" fontSize="11" fill="#ef4444" fontWeight="bold">مقاومة (Resistance)</text>

 {/* Support line */}
 <motion.line
 x1="20" y1="170" x2="340" y2="170"
 stroke="#10b981" strokeWidth="2" strokeDasharray="6"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.3 }}
 />
 <text x="290" y="185" fontSize="11" fill="#10b981" fontWeight="bold">دعم (Support)</text>

 {/* Price candles bouncing between support/resistance */}
 {[
 { x: 40, y: 150, h: 20 }, { x: 70, y: 140, h: 25 }, { x: 100, y: 130, h: 22 },
 { x: 130, y: 60, h: 25 }, { x: 160, y: 80, h: 30 }, { x: 190, y: 100, h: 25 },
 { x: 220, y: 160, h: 20 }, { x: 250, y: 140, h: 25 }, { x: 280, y: 70, h: 28 },
 { x: 310, y: 55, h: 22 },
 ].map((c, i) => (
 <motion.rect
 key={i}
 x={c.x} y={c.y} width="12" height={c.h}
 fill={c.y < 100 ? '#ef4444' : '#10b981'}
 initial={{ opacity: 0, scale: 0 }}
 animate={{ opacity: 1, scale: 1 }}
 transition={{ delay: i * 0.1 }}
 />
 ))}

 {/* Labels */}
 <text x="150" y="25" fontSize="10" fill="#6b7280">السعر يرتد من المقاومة لأسفل</text>
 <text x="150" y="205" fontSize="10" fill="#6b7280">السعر يرتد من الدعم لأعلى</text>
 </svg>
 <p className="text-xs text-muted-foreground mt-2 text-center">
 القاعدة: اشترِ قرب الدعم مع وقف خسارة تحته، بعْ قرب المقاومة
 </p>
 </div>
 );
}

/* ── 11. Moving Averages (المتوسطات المتحركة) ── */
export function MovingAveragesVisual() {
 const candles = [
 120, 118, 122, 125, 120, 128, 130, 126, 132, 135, 130, 138, 140, 135, 142
 ];
 // Calculate simple MAs
 const calcSMA = (data: number[], period: number) => {
 return data.map((_, i) => {
 if (i < period - 1) return null;
 const slice = data.slice(i - period + 1, i + 1);
 return slice.reduce((a, b) => a + b, 0) / period;
 });
 };
 const ma5 = calcSMA(candles, 5);
 const ma10 = calcSMA(candles, 10);

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">المتوسطات المتحركة (MA 5 و MA 10)</h4>
 <svg width="100%" height="200" viewBox="0 0 360 200">
 {/* Price candles */}
 {candles.map((c, i) => {
 const x = 20 + i * 22;
 const y = 180 - (c - 115) * 5;
 return (
 <motion.rect
 key={`c-${i}`}
 x={x} y={y} width="6" height="10"
 fill={c >= candles[i-1] ? '#10b981' : '#ef4444'}
 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
 />
 );
 })}
 {/* MA5 line */}
 <motion.path
 d={`M ${ma5.map((v, i) => v ? `${20 + i * 22} ${180 - (v - 115) * 5}` : '').filter(Boolean).join(' L ')}`}
 fill="none" stroke="#f59e0b" strokeWidth="2"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5 }}
 />
 {/* MA10 line */}
 <motion.path
 d={`M ${ma10.map((v, i) => v ? `${20 + i * 22} ${180 - (v - 115) * 5}` : '').filter(Boolean).join(' L ')}`}
 fill="none" stroke="#3b82f6" strokeWidth="2"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5, delay: 0.3 }}
 />
 </svg>
 <div className="flex justify-center gap-4 mt-2 text-xs">
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-warning" /> MA 5 (سريع)</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-whale" /> MA 10 (بطيء)</span>
 </div>
 <p className="text-xs text-muted-foreground mt-2 text-center">
 التقاطع الذهبي: MA السريع يقطع البطيء صعوداً = إشارة شراء
 </p>
 </div>
 );
}

/* ── 12. Bollinger Bands (نطاقات بولينجر) ── */
export function BollingerBandsVisual() {
 const prices = [120, 122, 118, 125, 128, 124, 130, 135, 132, 128, 125, 122, 126, 130, 134];
 const sma = prices.reduce((a, b) => a + b, 0) / prices.length;
 const upper = sma + 8;
 const lower = sma - 8;

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">نطاقات بولينجر (Bollinger Bands)</h4>
 <svg width="100%" height="200" viewBox="0 0 360 200">
 {/* Upper band */}
 <motion.path
 d={`M 20 ${180 - (upper - 115) * 5} Q 180 ${180 - (upper - 115) * 4} 340 ${180 - (upper - 115) * 5}`}
 fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }}
 />
 {/* Middle (SMA) */}
 <motion.line
 x1="20" y1={180 - (sma - 115) * 5} x2="340" y2={180 - (sma - 115) * 5}
 stroke="#6b7280" strokeWidth="1.5"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.2 }}
 />
 {/* Lower band */}
 <motion.path
 d={`M 20 ${180 - (lower - 115) * 5} Q 180 ${180 - (lower - 115) * 6} 340 ${180 - (lower - 115) * 5}`}
 fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="4"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.4 }}
 />
 {/* Price line */}
 <motion.path
 d={`M ${prices.map((p, i) => `${20 + i * 22} ${180 - (p - 115) * 5}`).join(' L ')}`}
 fill="none" stroke="#3b82f6" strokeWidth="2"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5, delay: 0.5 }}
 />
 {/* Squeeze annotation */}
 <rect x="140" y="40" width="80" height="20" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3" />
 <text x="150" y="35" fontSize="9" fill="#f59e0b" fontWeight="bold">Squeeze (تضييق)</text>
 </svg>
 <div className="flex justify-center gap-4 mt-2 text-xs flex-wrap">
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-whale" /> السعر</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-muted" /> المتوسط (SMA20)</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-loss" /> النطاق العلوي</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-profit" /> النطاق السفلي</span>
 </div>
 </div>
 );
}

/* ── 13. DCF Flow (نموذج التدفقات النقدية المخصومة) ── */
export function DCFFlowVisual() {
 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">نموذج DCF - كيف نحسب القيمة العادلة</h4>
 <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
 {/* Step 1 */}
 <motion.div
 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
 className="flex-1 p-3 rounded-lg bg-profit/10 border border-profit/20 text-center"
 >
 <p className="text-xs font-bold text-profit mb-1">1. تقدير التدفقات</p>
 <p className="text-xs">النقدية المتوقعة لـ 5 سنوات</p>
 </motion.div>
 <span className="text-profit text-center rotate-90 sm:rotate-0">←</span>
 {/* Step 2 */}
 <motion.div
 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
 className="flex-1 p-3 rounded-lg bg-whale/10 border border-whale/20 text-center"
 >
 <p className="text-xs font-bold text-whale mb-1">2. معدل الخصم</p>
 <p className="text-xs">خصم للتضخم والمخاطر</p>
 </motion.div>
 <span className="text-whale text-center rotate-90 sm:rotate-0">←</span>
 {/* Step 3 */}
 <motion.div
 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
 className="flex-1 p-3 rounded-lg bg-warning/10 border border-warning/20 text-center"
 >
 <p className="text-xs font-bold text-warning mb-1">3. القيمة الطرفية</p>
 <p className="text-xs">قيمة ما بعد 5 سنوات</p>
 </motion.div>
 <span className="text-warning text-center rotate-90 sm:rotate-0">←</span>
 {/* Step 4 */}
 <motion.div
 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
 className="flex-1 p-3 rounded-lg bg-primary/10 border border-purple-500/30 text-center"
 >
 <p className="text-xs font-bold text-primary mb-1">4. القيمة العادلة</p>
 <p className="text-xs">مجموع القيم الحالية</p>
 </motion.div>
 </div>
 <p className="text-xs text-muted-foreground mt-3 text-center">
 الفكرة: جنيه اليوم أثمن من جنيه الغد → نخصم التدفقات المستقبلية
 </p>
 </div>
 );
}

/* ── 14. ROE DuPont (تحليل العائد على حقوق الملكية) ── */
export function ROEDuPontVisual() {
 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">تحليل DuPont - فكك ROE لـ 3 مكونات</h4>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
 <motion.div
 initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}
 className="p-3 rounded-lg bg-profit/10 border border-profit/20 text-center"
 >
 <p className="text-xs font-bold text-profit">هامش الربح</p>
 <p className="text-xs text-muted-foreground mb-1">صافي الربح ÷ الإيرادات</p>
 <p className="text-lg font-bold">15%</p>
 </motion.div>
 <motion.div
 initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}
 className="p-3 rounded-lg bg-whale/10 border border-whale/20 text-center"
 >
 <p className="text-xs font-bold text-whale">دوران الأصول</p>
 <p className="text-xs text-muted-foreground mb-1">الإيرادات ÷ الأصول</p>
 <p className="text-lg font-bold">1.2x</p>
 </motion.div>
 <motion.div
 initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }}
 className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-center"
 >
 <p className="text-xs font-bold text-warning">الرافعة المالية</p>
 <p className="text-xs text-muted-foreground mb-1">الأصول ÷ حقوق الملكية</p>
 <p className="text-lg font-bold">2.0x</p>
 </motion.div>
 </div>
 <div className="mt-3 p-3 rounded-lg bg-primary/10 border border-purple-500/30 text-center">
 <p className="text-xs font-bold text-primary mb-1">ROE = هامش الربح × دوران الأصول × الرافعة</p>
 <p className="text-lg font-bold">15% × 1.2 × 2.0 = 36%</p>
 </div>
 <p className="text-xs text-muted-foreground mt-2 text-center">
 ميزة DuPont: تعرفك هل ROE العالي بسبب الكفاءة ولا بسبب الديون الكثيرة
 </p>
 </div>
 );
}

/* ── 15. Emotional Cycle (دورة المشاعر في التداول) ── */
export function EmotionalCycleVisual() {
 const emotions = [
 { phase: 'التفاؤل', color: 'bg-profit', icon: '😊' },
 { phase: 'الحماس', color: 'bg-whale', icon: '🤩' },
 { phase: 'النشوة', color: 'bg-whale', icon: '🤑' },
 { phase: 'القلق', color: 'bg-warning', icon: '😰' },
 { phase: 'الإنكار', color: 'bg-warning', icon: '😨' },
 { phase: 'الذعر', color: 'bg-loss', icon: '😱' },
 { phase: 'الاستسلام', color: 'bg-muted', icon: '😞' },
 { phase: 'الاكتئاب', color: 'bg-muted', icon: '😔' },
 ];

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">دورة المشاعر في التداول - احذرها!</h4>
 <div className="grid grid-cols-4 gap-2">
 {emotions.map((e, i) => (
 <motion.div
 key={i}
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: i * 0.1 }}
 className={`flex flex-col items-center p-2 rounded-lg ${e.color} text-white`}
 >
 <span className="text-2xl">{e.icon}</span>
 <span className="text-xs font-bold mt-1">{e.phase}</span>
 </motion.div>
 ))}
 </div>
 <p className="text-xs text-muted-foreground mt-3 text-center">
 الترتيب من اليسار لليمين: مع ارتفاع السعر (مرحلة 1-3) ثم الهبوط (4-8)
 </p>
 </div>
 );
}

/* ── 16. DCA Strategy (استراتيجية المتوسط) ── */
export function DCAStrategyVisual() {
 const months = [
 { month: 'يناير', price: 100, shares: 10, invest: 1000 },
 { month: 'فبراير', price: 80, shares: 12.5, invest: 1000 },
 { month: 'مارس', price: 60, shares: 16.67, invest: 1000 },
 { month: 'أبريل', price: 90, shares: 11.11, invest: 1000 },
 { month: 'مايو', price: 110, shares: 9.09, invest: 1000 },
 ];
 const totalShares = months.reduce((a, m) => a + m.shares, 0);
 const totalInvest = months.reduce((a, m) => a + m.invest, 0);
 const avgPrice = totalInvest / totalShares;

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">استراتيجية DCA - متوسط تكلفة الوحدات</h4>
 <div className="space-y-2">
 {months.map((m, i) => (
 <motion.div
 key={i}
 initial={{ opacity: 0, x: -20 }}
 animate={{ opacity: 1, x: 0 }}
 transition={{ delay: i * 0.15 }}
 className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-muted/30 text-xs"
 >
 <span className="font-semibold">{m.month}</span>
 <span>السعر: {m.price} ج.م</span>
 <span>استثمار: {m.invest} ج.م</span>
 <span className="font-bold text-profit">أسهم: {(m.shares ?? 0).toFixed(2)}</span>
 </motion.div>
 ))}
 </div>
 <div className="mt-3 p-3 rounded-lg bg-profit/10 border border-profit/20">
 <div className="flex justify-between text-sm">
 <span>إجمالي الاستثمار:</span>
 <span className="font-bold">{totalInvest} ج.م</span>
 </div>
 <div className="flex justify-between text-sm">
 <span>إجمالي الأسهم:</span>
 <span className="font-bold">{(totalShares ?? 0).toFixed(2)} سهم</span>
 </div>
 <div className="flex justify-between text-sm font-bold text-profit ">
 <span>متوسط السعر:</span>
 <span>{(avgPrice ?? 0).toFixed(2)} ج.م</span>
 </div>
 </div>
 <p className="text-xs text-muted-foreground mt-2 text-center">
 DCA بتقلل متوسط السعر لأنك بتشتري أسهم أكثر لما السعر ينزل
 </p>
 </div>
 );
}

/* ── 17. Diagram Dispatcher (يرسم الرسم المناسب حسب الاسم) ── */
export function DiagramRenderer({ type }: { type: string }) {
 switch (type) {
 case 'candlestick-bullish':
 return <CandlestickDiagram variant="bullish" />;
 case 'candlestick-bearish':
 return <CandlestickDiagram variant="bearish" />;
 case 'candlestick-doji':
 return <CandlestickDiagram variant="doji" />;
 case 'candlestick-hammer':
 return <CandlestickDiagram variant="hammer" />;
 case 'pe-ratio':
 return <PERatioVisual />;
 case 'market-hours':
 return <MarketHoursTimeline />;
 case 'portfolio-diversification':
 return <PortfolioDiversification />;
 case 'risk-pyramid':
 return <RiskPyramid />;
 case 'rsi-gauge':
 return <RSIGauge />;
 case 'macd':
 return <MACDVisual />;
 case 'support-resistance':
 return <SupportResistanceVisual />;
 case 'moving-averages':
 return <MovingAveragesVisual />;
 case 'bollinger-bands':
 return <BollingerBandsVisual />;
 case 'dcf-flow':
 return <DCFFlowVisual />;
 case 'roe-dupont':
 return <ROEDuPontVisual />;
 case 'emotional-cycle':
 return <EmotionalCycleVisual />;
 case 'dca-strategy':
 return <DCAStrategyVisual />;
 default:
 return null;
 }
}

/* ============================================================
 PREMIUM SVG GRAPHICS — Task ID 30-A (Visual Battalion)
 Owner: "ASCII art is not professional — convert to beautiful
 eye-dazzling graphics that are almost natural"
 Replaces ASCII art in markdown lessons at render time
 (source MD files stay readable for editors).
 ============================================================ */

/* ── 18. Loss Aversion Curve (منحنى Loss Aversion / Prospect Theory) ──
 Kahneman & Tversky 1979: الخسارة تؤلم 2.25× أكثر من فرحة نفس المبلغ.
 Gain curve: concave, emerald gradient.
 Loss curve: steeper convex, red gradient. */
export function LossAversionCurve() {
 // Plot geometry inside viewBox 0 0 600 380
 const ORIGIN_X = 300;
 const ORIGIN_Y = 200;
 // Gain curve: origin → far right, peak joy. Concave (flattening).
 const gainPath = `M ${ORIGIN_X} ${ORIGIN_Y} C 330 110, 450 96, 530 96`;
 const gainFill = `${gainPath} L 530 ${ORIGIN_Y} L ${ORIGIN_X} ${ORIGIN_Y} Z`;
 // Loss curve: origin → far left, peak pain. STEEPER than gain (2.25×).
 const lossPath = `M ${ORIGIN_X} ${ORIGIN_Y} C 270 318, 160 332, 70 332`;
 const lossFill = `${lossPath} L 70 ${ORIGIN_Y} L ${ORIGIN_X} ${ORIGIN_Y} Z`;

 // Marker positions on curves
 const lossMarker = { x: 200, y: 322 }; // point on loss curve
 const gainMarker = { x: 500, y: 100 }; // point on gain curve

 return (
 <div dir="rtl" className="my-6 overflow-hidden rounded-2xl border border-slate-200 from-white to-slate-50 p-3 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
 <svg
 width="100%"
 height="380"
 viewBox="0 0 600 380"
 xmlns="http://www.w3.org/2000/svg"
 role="img"
 aria-label="منحنى Loss Aversion — نظرية التوقع"
 style={{ maxWidth: '100%', height: 'auto' }}
 >
 <defs>
 {/* Emerald gradient (gain) */}
 <linearGradient id="laGainFill" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="#10b981" stopOpacity="0.55" />
 <stop offset="100%" stopColor="#059669" stopOpacity="0.10" />
 </linearGradient>
 <linearGradient id="laGainStroke" x1="0" y1="0" x2="1" y2="0">
 <stop offset="0%" stopColor="#059669" />
 <stop offset="100%" stopColor="#10b981" />
 </linearGradient>
 {/* Red gradient (loss) */}
 <linearGradient id="laLossFill" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="#ef4444" stopOpacity="0.10" />
 <stop offset="100%" stopColor="#dc2626" stopOpacity="0.55" />
 </linearGradient>
 <linearGradient id="laLossStroke" x1="0" y1="0" x2="1" y2="0">
 <stop offset="0%" stopColor="#dc2626" />
 <stop offset="100%" stopColor="#ef4444" />
 </linearGradient>
 {/* Soft drop shadow */}
 <filter id="laShadow" x="-20%" y="-20%" width="140%" height="140%">
 <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" />
 <feOffset dx="0" dy="2" result="offsetblur" />
 <feComponentTransfer>
 <feFuncA type="linear" slope="0.18" />
 </feComponentTransfer>
 <feMerge>
 <feMergeNode />
 <feMergeNode in="SourceGraphic" />
 </feMerge>
 </filter>
 </defs>

 {/* Title */}
 <text
 x="300"
 y="26"
 textAnchor="middle"
 fontFamily="system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif"
 fontSize="17"
 fontWeight="700"
 fill="#0f172a"
 direction="rtl"
 >
 منحنى Loss Aversion — نظرية التوقع
 </text>

 {/* Subtle grid */}
 {Array.from({ length: 7 }).map((_, i) => {
 const y = 80 + i * 30;
 return (
 <line
 key={`gh-${i}`}
 x1="60"
 y1={y}
 x2="540"
 y2={y}
 stroke="#e2e8f0"
 strokeWidth="0.5"
 strokeDasharray="3 4"
 />
 );
 })}
 {Array.from({ length: 9 }).map((_, i) => {
 const x = 80 + i * 55;
 return (
 <line
 key={`gv-${i}`}
 x1={x}
 y1="70"
 x2={x}
 y2="335"
 stroke="#e2e8f0"
 strokeWidth="0.5"
 strokeDasharray="3 4"
 />
 );
 })}

 {/* Y-axis */}
 <line x1="300" y1="60" x2="300" y2="340" stroke="#94a3b8" strokeWidth="1.4" />
 {/* X-axis */}
 <line x1="60" y1="200" x2="540" y2="200" stroke="#94a3b8" strokeWidth="1.4" />
 {/* Axis arrows */}
 <polygon points="300,58 296,66 304,66" fill="#94a3b8" />
 <polygon points="542,200 534,196 534,204" fill="#94a3b8" />

 {/* LOSS CURVE (steeper, red) */}
 <path d={lossFill} fill="url(#laLossFill)" filter="url(#laShadow)" />
 <path d={lossPath} fill="none" stroke="url(#laLossStroke)" strokeWidth="3.4" strokeLinecap="round" />

 {/* GAIN CURVE (concave, emerald) */}
 <path d={gainFill} fill="url(#laGainFill)" filter="url(#laShadow)" />
 <path d={gainPath} fill="none" stroke="url(#laGainStroke)" strokeWidth="3.4" strokeLinecap="round" />

 {/* Origin dot */}
 <circle cx={ORIGIN_X} cy={ORIGIN_Y} r="4.5" fill="#0f172a" />
 <text x={ORIGIN_X + 8} y={ORIGIN_Y - 8} fontSize="11" fill="#475569" direction="rtl">
 0 (مرجع)
 </text>

 {/* LOSS marker: خسارة 1000ج (ألم = 2.25) */}
 <line
 x1={lossMarker.x}
 y1={ORIGIN_Y}
 x2={lossMarker.x}
 y2={lossMarker.y}
 stroke="#dc2626"
 strokeWidth="1.2"
 strokeDasharray="3 3"
 />
 <line
 x1={lossMarker.x}
 y1={lossMarker.y}
 x2={lossMarker.x - 24}
 y2={lossMarker.y}
 stroke="#dc2626"
 strokeWidth="1.2"
 strokeDasharray="3 3"
 />
 <circle cx={lossMarker.x} cy={lossMarker.y} r="4.5" fill="#dc2626" stroke="#fff" strokeWidth="1.5" />
 <g direction="rtl">
 <rect
 x="40"
 y={lossMarker.y - 8}
 width="132"
 height="32"
 rx="8"
 fill="#fef2f2"
 stroke="#dc2626"
 strokeOpacity="0.4"
 />
 <text x="48" y={lossMarker.y + 5} fontSize="11.5" fontWeight="600" fill="#991b1b" direction="rtl">
 خسارة 1000ج
 </text>
 <text x="48" y={lossMarker.y + 18} fontSize="10.5" fill="#b91c1c" direction="rtl">
 (ألم = 2.25)
 </text>
 </g>

 {/* GAIN marker: ربح 2250ج (فرحة = 1.0) */}
 <line
 x1={gainMarker.x}
 y1={ORIGIN_Y}
 x2={gainMarker.x}
 y2={gainMarker.y}
 stroke="#059669"
 strokeWidth="1.2"
 strokeDasharray="3 3"
 />
 <line
 x1={gainMarker.x}
 y1={gainMarker.y}
 x2={gainMarker.x + 24}
 y2={gainMarker.y}
 stroke="#059669"
 strokeWidth="1.2"
 strokeDasharray="3 3"
 />
 <circle cx={gainMarker.x} cy={gainMarker.y} r="4.5" fill="#059669" stroke="#fff" strokeWidth="1.5" />
 <g direction="rtl">
 <rect
 x="430"
 y={gainMarker.y - 16}
 width="132"
 height="32"
 rx="8"
 fill="#ecfdf5"
 stroke="#059669"
 strokeOpacity="0.4"
 />
 <text x="438" y={gainMarker.y - 3} fontSize="11.5" fontWeight="600" fill="#065f46" direction="rtl">
 ربح 2250ج
 </text>
 <text x="438" y={gainMarker.y + 10} fontSize="10.5" fill="#047857" direction="rtl">
 (فرحة = 1.0)
 </text>
 </g>

 {/* Axis labels */}
 {/* X-axis label */}
 <text
 x="300"
 y="358"
 textAnchor="middle"
 fontFamily="system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif"
 fontSize="12"
 fontWeight="600"
 fill="#475569"
 direction="rtl"
 >
 الربح / الخسارة (جنيه)
 </text>
 {/* Y-axis label (rotated) */}
 <g transform="rotate(-90 22 200)">
 <text
 x="22"
 y="200"
 textAnchor="middle"
 fontFamily="system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif"
 fontSize="12"
 fontWeight="600"
 fill="#475569"
 direction="rtl"
 >
 القيمة النفسية (فرحة ▲ / ألم ▼)
 </text>
 </g>

 {/* Curve legends */}
 <g direction="rtl">
 <rect x="370" y="148" width="148" height="44" rx="8" fill="#ffffff" fillOpacity="0.85" stroke="#10b981" strokeOpacity="0.35" />
 <line x1="380" y1="160" x2="402" y2="160" stroke="#10b981" strokeWidth="3" />
 <text x="408" y="164" fontSize="10.5" fontWeight="600" fill="#065f46" direction="rtl">
 Gain Curve (فرحة)
 </text>
 <text x="380" y="180" fontSize="9.5" fill="#047857" direction="rtl">
 ميل لطيف — تقليل الحساسية
 </text>
 </g>
 <g direction="rtl">
 <rect x="78" y="246" width="158" height="44" rx="8" fill="#ffffff" fillOpacity="0.85" stroke="#dc2626" strokeOpacity="0.35" />
 <line x1="88" y1="258" x2="110" y2="258" stroke="#dc2626" strokeWidth="3" />
 <text x="116" y="262" fontSize="10.5" fontWeight="600" fill="#991b1b" direction="rtl">
 Loss Curve (ألم 2.25×)
 </text>
 <text x="88" y="278" fontSize="9.5" fill="#b91c1c" direction="rtl">
 ميل حاد — ألم أعمق
 </text>
 </g>
 </svg>

 <p className="mt-2 text-center text-xs text-muted-foreground" dir="rtl">
 الخسارة تؤلم <span className="font-bold text-loss">2.25×</span> أكثر من فرحة نفس المبلغ —{' '}
 <span dir="ltr" className="font-mono text-xs">
 Kahneman &amp; Tversky 1979
 </span>
 </p>
 </div>
 );
}

/* ── 19. SOP Pipeline Flow (الـ SOP Pipeline) ──
 Standard Operating Procedure flowchart with 4 stages
 + weekly feedback loop. Replaces ASCII box drawing. */
type IconType = typeof Lightbulb;
type SopStage = {
 icon: IconType;
 iconBg: string;
 iconColor: string;
 title: string;
 subtitle: string;
 items: string[];
};

const SOP_STAGES: SopStage[] = [
 {
 icon: ClipboardCheck,
 iconBg: 'bg-profit/10',
 iconColor: 'text-profit ',
 title: 'Pre-trade Checklist',
 subtitle: 'قبل الصفقة',
 items: ['Entry / Stop', 'Position size', 'Contra-thesis', 'Exit plan'],
 },
 {
 icon: Zap,
 iconBg: 'bg-warning/10',
 iconColor: 'text-warning ',
 title: 'Execute Trade',
 subtitle: 'تنفيذ',
 items: ['Hard rules', 'No override', 'Stop آلي'],
 },
 {
 icon: NotebookPen,
 iconBg: 'bg-profit/10',
 iconColor: 'text-profit ',
 title: 'Journal Entry',
 subtitle: 'يوميات',
 items: ['تفسير القرار', 'المشاعر', 'النتيجة'],
 },
 {
 icon: TrendingUp,
 iconBg: 'bg-warning/10',
 iconColor: 'text-warning ',
 title: 'Review Weekly',
 subtitle: 'مراجعة',
 items: ['win rate', 'avg R', 'تعديل SOP'],
 },
];

export function SopPipelineFlow() {
 // Card geometry in viewBox 0 0 900 320
 const cardW = 188;
 const cardH = 158;
 const cardY = 70;
 const xs = [22, 240, 458, 676]; // left edges of 4 cards
 const gapX1 = xs[0] + cardW; // 210
 const gapX2 = xs[1] + cardW; // 428
 const gapX3 = xs[2] + cardW; // 646
 // Feedback loop endpoints
 const loopStartX = xs[3] + cardW / 2; // 770
 const loopEndX = xs[0] + cardW / 2; // 116

 return (
 <div dir="rtl" className="my-6 overflow-hidden rounded-2xl border border-slate-200 from-white to-slate-50 p-3 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
 <svg
 width="100%"
 height="320"
 viewBox="0 0 900 320"
 xmlns="http://www.w3.org/2000/svg"
 role="img"
 aria-label="SOP Pipeline — Standard Operating Procedure"
 style={{ maxWidth: '100%', height: 'auto' }}
 >
 <defs>
 <linearGradient id="sopArrow" x1="0" y1="0" x2="1" y2="0">
 <stop offset="0%" stopColor="#10b981" />
 <stop offset="100%" stopColor="#f59e0b" />
 </linearGradient>
 <linearGradient id="sopArrowRev" x1="0" y1="0" x2="1" y2="0">
 <stop offset="0%" stopColor="#f59e0b" />
 <stop offset="100%" stopColor="#10b981" />
 </linearGradient>
 <linearGradient id="sopLoopArrow" x1="1" y1="0" x2="0" y2="0">
 <stop offset="0%" stopColor="#10b981" />
 <stop offset="100%" stopColor="#f59e0b" />
 </linearGradient>
 <linearGradient id="sopCardGlow" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="#ffffff" />
 <stop offset="100%" stopColor="#f8fafc" />
 </linearGradient>
 <filter id="sopShadow" x="-20%" y="-20%" width="140%" height="140%">
 <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
 <feOffset dx="0" dy="3" result="offsetblur" />
 <feComponentTransfer>
 <feFuncA type="linear" slope="0.16" />
 </feComponentTransfer>
 <feMerge>
 <feMergeNode />
 <feMergeNode in="SourceGraphic" />
 </feMerge>
 </filter>
 {/* Arrowhead markers */}
 <marker id="sopArrowHead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
 <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
 </marker>
 <marker id="sopLoopHead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
 <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
 </marker>
 </defs>

 {/* Title */}
 <text
 x="450"
 y="26"
 textAnchor="middle"
 fontFamily="system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif"
 fontSize="17"
 fontWeight="700"
 fill="#0f172a"
 direction="rtl"
 >
 SOP Pipeline — Standard Operating Procedure
 </text>
 <text
 x="450"
 y="48"
 textAnchor="middle"
 fontFamily="system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif"
 fontSize="12"
 fill="#64748b"
 direction="rtl"
 >
 إجراءات قياسية تمنع التدخل العاطفي
 </text>

 {/* Connector arrows between cards (drawn first, behind cards) */}
 <line x1={gapX1} y1={cardY + cardH / 2} x2={xs[1] - 4} y2={cardY + cardH / 2} stroke="url(#sopArrow)" strokeWidth="3.4" markerEnd="url(#sopArrowHead)" />
 <line x1={gapX2} y1={cardY + cardH / 2} x2={xs[2] - 4} y2={cardY + cardH / 2} stroke="url(#sopArrow)" strokeWidth="3.4" markerEnd="url(#sopArrowHead)" />
 <line x1={gapX3} y1={cardY + cardH / 2} x2={xs[3] - 4} y2={cardY + cardH / 2} stroke="url(#sopArrow)" strokeWidth="3.4" markerEnd="url(#sopArrowHead)" />

 {/* Feedback loop: from card 4 bottom → curve down → back to card 1 bottom */}
 <path
 d={`M ${loopStartX} ${cardY + cardH} C ${loopStartX} ${cardY + cardH + 56}, ${loopEndX} ${cardY + cardH + 56}, ${loopEndX} ${cardY + cardH + 4}`}
 fill="none"
 stroke="url(#sopLoopArrow)"
 strokeWidth="3"
 strokeDasharray="6 4"
 markerEnd="url(#sopLoopHead)"
 />
 <text
 x={450}
 y={cardY + cardH + 48}
 textAnchor="middle"
 fontSize="11"
 fontWeight="600"
 fill="#0f766e"
 direction="rtl"
 >
 (loop أسبوعي — تعديل الـ SOP كل أسبوع)
 </text>

 {/* Cards (foreignObject with HTML for clean layout) */}
 {SOP_STAGES.map((stage, i) => {
 const Icon = stage.icon;
 return (
 <foreignObject
 key={i}
 x={xs[i]}
 y={cardY}
 width={cardW}
 height={cardH}
 >
 <div
 // @ts-expect-error xmlns is valid on div in JSX for foreignObject context
 xmlns="http://www.w3.org/1999/xhtml"
 className="flex h-full w-full flex-col rounded-xl border border-profit/70 bg-white p-2.5 shadow-sm /60 dark:bg-slate-900"
 >
 <div className="flex items-center gap-2">
 <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${stage.iconBg}`}>
 <Icon className={`h-4 w-4 ${stage.iconColor}`} strokeWidth={2.2} />
 </div>
 <div className="min-w-0 flex-1" dir="ltr">
 <p className="truncate text-xs font-bold leading-tight text-slate-900 dark:text-slate-100">
 {stage.title}
 </p>
 <p className="text-[9.5px] text-muted-foreground" dir="rtl">
 {stage.subtitle}
 </p>
 </div>
 </div>
 <div className="mt-2 space-y-1" dir="rtl">
 {stage.items.map((item, j) => (
 <div key={j} className="flex items-start gap-1 text-xs leading-tight">
 <span className="mt-[1px] text-profit">✓</span>
 <span className="flex-1 text-slate-700 dark:text-slate-300">{item}</span>
 </div>
 ))}
 </div>
 <div className="mt-auto flex items-center justify-between pt-1">
 <span className="rounded-full bg-profit px-1.5 py-[1px] text-xs font-bold text-profit/40 ">
 {String(i + 1).padStart(2, '0')}
 </span>
 <span className="text-[8.5px] text-slate-400" dir="ltr">
 stage
 </span>
 </div>
 </div>
 </foreignObject>
 );
 })}
 </svg>
 </div>
 );
}

/* ── 20. Trading System Pipeline (الخريطة المنطقية لنظام التداول الآلي) ──
 Owner's #1 ask: "الربط البرمجي/الخوارزمي يحتاج أن يتحول إلى رسم منطقي جميل"
 Dark premium dashboard aesthetic, 8 stages + feedback loop. */
type PipelineStage = {
 num: number;
 icon: IconType;
 titleAr: string;
 titleEn: string;
 desc: string;
 accent: 'emerald' | 'amber' | 'red' | 'cyan' | 'purple';
 live?: boolean;
};

const PIPELINE_STAGES: PipelineStage[] = [
 {
 num: 1,
 icon: Database,
 titleAr: 'استيعاب البيانات',
 titleEn: 'DATA INGESTION',
 desc: 'EGX / TADAWUL / Crypto / Gold feeds',
 accent: 'emerald',
 live: true,
 },
 {
 num: 2,
 icon: ShieldCheck,
 titleAr: 'حارس المصادر',
 titleEn: 'SOURCE AUTHORITY GUARD',
 desc: 'ي validate المصدر ويرفض المصادر الممنوعة',
 accent: 'emerald',
 live: true,
 },
 {
 num: 3,
 icon: ShieldCheck,
 titleAr: 'طبقة التحقق',
 titleEn: 'DATA VALIDATION LAYER',
 desc: 'current_price>0 · 52w sanity · S/R sanity',
 accent: 'amber',
 live: true,
 },
 {
 num: 4,
 icon: Signal,
 titleAr: 'توليد الإشارة',
 titleEn: 'SIGNAL GENERATION',
 desc: 'technical + fundamental scoring → master_score',
 accent: 'amber',
 },
 {
 num: 5,
 icon: Lock,
 titleAr: 'بوابة المخاطر',
 titleEn: 'RISK GATE',
 desc: 'position sizing · Kelly fraction · max drawdown',
 accent: 'red',
 },
 {
 num: 6,
 icon: Send,
 titleAr: 'التنفيذ',
 titleEn: 'EXECUTION',
 desc: 'paper trade · live alert · Telegram publish',
 accent: 'cyan',
 },
 {
 num: 7,
 icon: FileText,
 titleAr: 'يوميات التداول',
 titleEn: 'JOURNAL',
 desc: 'log entry · emotion · thesis',
 accent: 'purple',
 },
 {
 num: 8,
 icon: RefreshCw,
 titleAr: 'المراجعة والـ Feedback',
 titleEn: 'REVIEW & FEEDBACK LOOP',
 desc: 'weekly win rate · avg R · تعديل SOP → feeds Risk Gate',
 accent: 'purple',
 },
];

const ACCENT_STYLES: Record<PipelineStage['accent'], { ring: string; badge: string; glow: string; text: string; border: string }> = {
 emerald: {
 ring: 'ring-profit/30',
 badge: 'bg-profit/15 text-profit border-profit/20',
 glow: 'shadow-[0_0_18px_-4px_rgba(16,185,129,0.55)]',
 text: 'text-profit',
 border: 'border-profit/20',
 },
 amber: {
 ring: 'ring-warning/30',
 badge: 'bg-warning/15 text-warning border-warning/20',
 glow: 'shadow-[0_0_18px_-4px_rgba(245,158,11,0.55)]',
 text: 'text-warning',
 border: 'border-warning/20',
 },
 red: {
 ring: 'ring-loss/30',
 badge: 'bg-loss/15 text-loss border-loss/20',
 glow: 'shadow-[0_0_18px_-4px_rgba(239,68,68,0.55)]',
 text: 'text-loss',
 border: 'border-loss/20',
 },
 cyan: {
 ring: 'ring-cyan-500/30',
 badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
 glow: 'shadow-[0_0_18px_-4px_rgba(34,211,238,0.55)]',
 text: 'text-cyan-300',
 border: 'border-cyan-700/50',
 },
 purple: {
 ring: 'ring-purple-500/30',
 badge: 'bg-primary/15 text-primary border-purple-500/30',
 glow: 'shadow-[0_0_18px_-4px_rgba(168,85,247,0.55)]',
 text: 'text-primary',
 border: 'border-purple-700/50',
 },
};

export function TradingSystemPipeline() {
 return (
 <motion.div
 initial={{ opacity: 0, y: 12 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.5 }}
 dir="rtl"
 className="my-6 overflow-hidden rounded-2xl border border-slate-700/60 from-slate-950 via-slate-900 to-slate-950 p-4 shadow-xl sm:p-6"
 >
 {/* Header */}
 <div className="mb-4 text-center">
 <h3 className="text-base font-bold text-slate-100 sm:text-lg">
 الخريطة المنطقية لنظام التداول الآلي
 </h3>
 <p className="mt-1 text-xs text-slate-400 sm:text-sm">
 من الإشارة إلى التنفيذ إلى المراجعة —{' '}
 <span dir="ltr" className="font-mono">
 signal → execution → review
 </span>
 </p>
 </div>

 {/* Stage grid: 1 col mobile, 2 col sm, 4 col lg */}
 <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4 lg:gap-4" dir="ltr">
 {PIPELINE_STAGES.map((stage, i) => {
 const Icon = stage.icon;
 const acc = ACCENT_STYLES[stage.accent];
 // Connector between stages: small arrow shown on the right of each card except last
 const isRowEnd = (i + 1) % 4 === 0; // row end on lg
 const isLast = i === PIPELINE_STAGES.length - 1;
 const showConnector = !isLast && !isRowEnd;
 // Special: feedback loop arrow from stage 8 → stage 5 (rendered as a separate badge on stage 8)
 const isFeedbackSource = stage.num === 8;
 return (
 <div key={stage.num} className="relative">
 <motion.div
 initial={{ opacity: 0, scale: 0.95 }}
 animate={{ opacity: 1, scale: 1 }}
 transition={{ delay: i * 0.08, duration: 0.4 }}
 className={cn(
 'group relative flex h-full flex-col rounded-xl border bg-slate-900/80 p-3 ring-1 backdrop-blur-sm',
 acc.border,
 acc.ring,
 acc.glow,
 )}
 >
 {/* Stage number badge */}
 <div className="mb-2 flex items-center justify-between" dir="ltr">
 <span
 className={cn(
 'flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold',
 acc.badge,
 )}
 >
 {String(stage.num).padStart(2, '0')}
 </span>
 {stage.live ? (
 <span className="flex items-center gap-1 text-xs font-semibold text-profit">
 <span className="relative flex h-2 w-2">
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit opacity-75" />
 <span className="relative inline-flex h-2 w-2 rounded-full bg-profit" />
 </span>
 LIVE
 </span>
 ) : (
 <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
 stage
 </span>
 )}
 </div>

 {/* Icon */}
 <div className="mb-2 flex justify-center">
 <div className={cn('flex h-10 w-10 items-center justify-center rounded-full border', acc.border, 'bg-slate-950/60')}>
 <Icon className={cn('h-5 w-5', acc.text)} strokeWidth={2.0} />
 </div>
 </div>

 {/* Titles */}
 <p className="text-center text-xs font-bold uppercase tracking-wider text-slate-400" dir="ltr">
 {stage.titleEn}
 </p>
 <p className="mt-0.5 text-center text-[13px] font-bold text-slate-100" dir="rtl">
 {stage.titleAr}
 </p>
 <p className="mt-1.5 text-center text-[10.5px] leading-snug text-slate-400" dir="rtl">
 {stage.desc}
 </p>

 {/* Feedback source marker */}
 {isFeedbackSource && (
 <div className="mt-2 rounded-md border border-purple-500/30 bg-primary/10 px-1.5 py-1 text-center text-xs font-semibold text-primary" dir="rtl">
 ↻ feedback → المرحلة 5
 </div>
 )}
 </motion.div>

 {/* Inline connector arrow (desktop only, between cards in same row) */}
 {showConnector && (
 <div className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 lg:block">
 <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
 <defs>
 <linearGradient id={`conn-${i}`} x1="0" y1="0" x2="1" y2="0">
 <stop offset="0%" stopColor="#10b981" />
 <stop offset="100%" stopColor="#f59e0b" />
 </linearGradient>
 </defs>
 <path d="M 0 7 L 12 7 M 8 3 L 12 7 L 8 11" stroke={`url(#conn-${i})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
 </svg>
 </div>
 )}
 </div>
 );
 })}
 </div>

 {/* Row connector + feedback loop visualization */}
 <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3" dir="rtl">
 <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
 <div className="flex items-center gap-2 text-xs text-slate-300">
 <RefreshCw className="h-3.5 w-3.5 text-primary" />
 <span>
 <span className="font-semibold text-primary">حلقة المراجعة:</span>{' '}
 ناتج المرحلة 8 (win rate + avg R) بيعدّل حدود المرحلة 5 (Risk Gate) أسبوعياً.
 </span>
 </div>
 <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary" dir="ltr">
 stage 8 → stage 5 (weekly)
 </span>
 </div>
 </div>

 {/* Legend */}
 <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:gap-x-5 sm:text-xs" dir="rtl">
 <span className="flex items-center gap-1 text-profit">
 <span className="h-2 w-2 rounded-full bg-profit" /> بيانات حية
 </span>
 <span className="flex items-center gap-1 text-warning">
 <span className="h-2 w-2 rounded-full bg-warning" /> تحقق
 </span>
 <span className="flex items-center gap-1 text-loss">
 <span className="h-2 w-2 rounded-full bg-loss" /> بوابة
 </span>
 <span className="flex items-center gap-1 text-cyan-300">
 <span className="h-2 w-2 rounded-full bg-cyan-500" /> تنفيذ
 </span>
 <span className="flex items-center gap-1 text-primary">
 <span className="h-2 w-2 rounded-full bg-primary" /> مراجعة
 </span>
 </div>
 </motion.div>
 );
}

/* ============================================================
 TASK 36-B — NEW INTERACTIVE VISUALS (5 components)
 Owner directive: «محتاجين رفع كفائة التعليم... نزود فى المساعدات
 التعليمية من صور ومحاكيات ورسوم بيانية ورسوم توضيحية»
 Palette: emerald + amber + slate + red (Rule 30).
 Each visual teaches ONE specific concept (Rule 67 — no stubs).
 ============================================================ */

/* ── 21. Market Stages Visual (مراحل السوق — Weinstein + Wyckoff) ──
 4 stages horizontal flow:
 Stage 1 — Base / Accumulation (smart money buys quietly)
 Stage 2 — Advance / Uptrend (public begins to buy)
 Stage 3 — Top / Distribution (smart money sells into strength)
 Stage 4 — Decline / Downtrend (public panics, sells low)
 Overlay: typical price curve shape across the 4 stages.
 Teaches WHEN to be in the market vs. in cash. */
export function MarketStagesVisual() {
 const stages = [
 {
 id: 1,
 name: 'التجميع',
 nameEn: 'Accumulation',
 color: '#10b981',
 bg: 'bg-profit/10',
 border: 'border-profit/20',
 action: 'شراء تدريجي',
 actionEn: 'Buy',
 icon: '📥',
 desc: 'السعر يتحرك أفقيًا في نطاق ضيق بعد نزول طويل. الصناع يجمعون السهم بصمت.',
 characteristics: ['تذبذب منخفض', 'حجم متناقص', 'اختراقات كاذبة'],
 },
 {
 id: 2,
 name: 'الصعود',
 nameEn: 'Advance',
 color: '#059669',
 bg: 'bg-profit/10',
 border: 'border-profit/20',
 action: 'احتفاظ / إضافة',
 actionEn: 'Hold',
 icon: '🚀',
 desc: 'السعر يكسر القمة ويصعد بزخم. الجمهور يبدأ بالانتباه والدخول.',
 characteristics: ['قمم أعلى وقيعان أعلى', 'حجم متصاعد', 'اختراقات مؤكدة'],
 },
 {
 id: 3,
 name: 'التوزيع',
 nameEn: 'Distribution',
 color: '#f59e0b',
 bg: 'bg-warning/10',
 border: 'border-warning/20',
 action: 'بيع تدريجي',
 actionEn: 'Sell',
 icon: '📤',
 desc: 'السعر يصل للقمة ويتحرك أفقيًا بتذبذب عالٍ. الصناع يبيعون على القمة.',
 characteristics: ['تذبذب عالٍ', 'حجم مرتفع', 'تباعد سلبي RSI'],
 },
 {
 id: 4,
 name: 'الهبوط',
 nameEn: 'Decline',
 color: '#ef4444',
 bg: 'bg-loss/10',
 border: 'border-loss/20',
 action: 'بيع / قصر',
 actionEn: 'Short',
 icon: '📉',
 desc: 'السعر يكسر القاع وينزل بزخم. الجمهور يذعر ويبيع بخسارة.',
 characteristics: ['قمم أدنى وقيعان أدنى', 'حجم متصاعد على الهبوط', 'ارتجاعات كاذبة'],
 },
 ];

 // Typical price curve overlay (in viewBox coords 0..800 x 0..130):
 // Stage1: flat (low) → Stage2: rising → Stage3: flat (high, choppy) → Stage4: falling
 const pricePath =
 'M 30 95 L 200 95 Q 240 92 270 80 L 320 65 L 380 45 Q 430 38 500 40 L 620 42 Q 660 48 680 60 L 720 85 L 770 110';

 return (
 <motion.div
 dir="rtl"
 initial={{ opacity: 0, y: 12 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.45 }}
 className="my-6 overflow-hidden rounded-2xl border border-slate-200 from-white to-slate-50 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950"
 >
 <div className="mb-3 flex items-center gap-2" dir="rtl">
 <Layers className="h-5 w-5 text-profit " />
 <h4 className="text-base font-bold sm:text-lg">
 مراحل السوق الأربعة — نظرية Weinstein + Wyckoff
 </h4>
 </div>
 <p className="mb-4 text-xs text-muted-foreground sm:text-sm">
 السوق لا يصعد للأبد ولا يهبط للأبد — يدور في 4 مراحل. معرفة المرحلة الحالية
 تحدد القرار الصحيح: متى تشتري، متى تحتفظ، متى تبيع، ومتى تجلس على الحياد.
 </p>

 {/* Price curve overlay SVG */}
 <svg
 width="100%"
 viewBox="0 0 800 130"
 xmlns="http://www.w3.org/2000/svg"
 role="img"
 aria-label="منحنى السعر عبر مراحل السوق الأربع"
 style={{ maxWidth: '100%', height: 'auto' }}
 className="rounded-lg border border-slate-200 bg-slate-50/40 dark:border-slate-700 dark:bg-slate-950/40"
 >
 <defs>
 <linearGradient id="stagePriceFill" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
 <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.20" />
 <stop offset="100%" stopColor="#ef4444" stopOpacity="0.30" />
 </linearGradient>
 <linearGradient id="stagePriceStroke" x1="0" y1="0" x2="1" y2="0">
 <stop offset="0%" stopColor="#10b981" />
 <stop offset="40%" stopColor="#059669" />
 <stop offset="65%" stopColor="#f59e0b" />
 <stop offset="100%" stopColor="#ef4444" />
 </linearGradient>
 </defs>

 {/* Stage vertical dividers */}
 <line x1="210" y1="10" x2="210" y2="125" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />
 <line x1="500" y1="10" x2="500" y2="125" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />
 <line x1="620" y1="10" x2="620" y2="125" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />

 {/* Price curve */}
 <path d={`${pricePath} L 770 125 L 30 125 Z`} fill="url(#stagePriceFill)" />
 <path d={pricePath} fill="none" stroke="url(#stagePriceStroke)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

 {/* Stage labels under curve */}
 <text x="115" y="118" textAnchor="middle" fontSize="10" fill="#10b981" fontWeight="700">المرحلة 1</text>
 <text x="355" y="118" textAnchor="middle" fontSize="10" fill="#059669" fontWeight="700">المرحلة 2</text>
 <text x="560" y="118" textAnchor="middle" fontSize="10" fill="#f59e0b" fontWeight="700">المرحلة 3</text>
 <text x="700" y="118" textAnchor="middle" fontSize="10" fill="#ef4444" fontWeight="700">المرحلة 4</text>
 </svg>

 {/* Stage cards */}
 <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
 {stages.map((s, i) => (
 <motion.div
 key={s.id}
 initial={{ opacity: 0, y: 14 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: i * 0.1 }}
 className={cn(
 'flex flex-col rounded-xl border bg-card p-3 shadow-sm',
 s.border,
 s.bg,
 )}
 dir="rtl"
 >
 <div className="mb-2 flex items-center justify-between">
 <span className="text-2xl" role="img" aria-label={s.nameEn}>
 {s.icon}
 </span>
 <span
 className="rounded-full px-2 py-0.5 text-xs font-bold text-white"
 style={{ backgroundColor: s.color }}
 >
 {s.action}
 </span>
 </div>
 <h5 className="text-sm font-bold" style={{ color: s.color }}>
 المرحلة {s.id} — {s.name}
 </h5>
 <p className="mt-0.5 text-xs text-muted-foreground ltr:text-left" dir="ltr">
 {s.nameEn}
 </p>
 <p className="mt-2 text-xs leading-relaxed text-foreground">{s.desc}</p>
 <ul className="mt-2 space-y-0.5" dir="rtl">
 {s.characteristics.map((c, idx) => (
 <li key={idx} className="flex items-center gap-1 text-xs text-muted-foreground">
 <span className="h-1 w-1 rounded-full" style={{ backgroundColor: s.color }} />
 {c}
 </li>
 ))}
 </ul>
 </motion.div>
 ))}
 </div>

 {/* Educational takeaway */}
 <div className="mt-4 rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs leading-relaxed text-warning " dir="rtl">
 <span className="font-bold">قاعدة عامة:</span> لا تشترِ في المرحلة 4، ولا تبع في
 المرحلة 2. أفضل نقطة شراء = نهاية المرحلة 1، وأفضل نقطة بيع = بداية المرحلة 3.
 التحرّك ضدّ المرحلة = خسارة شبه مؤكدة.
 </div>
 </motion.div>
 );
}

/* ── 22. Order Flow Visual (تدفّق الأوامر) ──
 Bid/Ask ladder with resting limit orders + market-order arrows.
 Teaches WHY prices move:
 - Buy market orders lift the ask → price up
 - Sell market orders hit the bid → price down
 - Imbalance between aggressive buyers/sellers = direction */
export function OrderFlowVisual() {
 // Price levels (top → bottom). Best ask is 100.0; best bid is 99.9 (0.1 spread).
 const levels = [
 { price: 100.4, side: 'ask' as const, size: 120 },
 { price: 100.3, side: 'ask' as const, size: 280 },
 { price: 100.2, side: 'ask' as const, size: 450 },
 { price: 100.1, side: 'ask' as const, size: 820 },
 { price: 100.0, side: 'ask' as const, size: 1100, best: true },
 { price: 99.9, side: 'bid' as const, size: 980, best: true },
 { price: 99.8, side: 'bid' as const, size: 640 },
 { price: 99.7, side: 'bid' as const, size: 410 },
 { price: 99.6, side: 'bid' as const, size: 230 },
 { price: 99.5, side: 'bid' as const, size: 150 },
 ];
 const maxSize = Math.max(...levels.map((l) => l.size));
 const totalAsk = levels.filter((l) => l.side === 'ask').reduce((a, b) => a + b.size, 0);
 const totalBid = levels.filter((l) => l.side === 'bid').reduce((a, b) => a + b.size, 0);
 const imbalance = (totalBid - totalAsk) / (totalBid + totalAsk); // -1..+1

 return (
 <motion.div
 dir="rtl"
 initial={{ opacity: 0, y: 12 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.45 }}
 className="my-6 overflow-hidden rounded-2xl border border-slate-200 from-white to-slate-50 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950"
 >
 <div className="mb-3 flex items-center gap-2" dir="rtl">
 <Scale className="h-5 w-5 text-profit " />
 <h4 className="text-base font-bold sm:text-lg">تدفّق الأوامر — لماذا يتحرك السعر؟</h4>
 </div>
 <p className="mb-4 text-xs text-muted-foreground sm:text-sm">
 السعر بيتحرك لما الطلبات السوقية (Market Orders) تخبط في طلبات
 الـ Limit المتراكمة على السُلّم. لما الشراء السوقي &gt; البيع السوقي →
 السعر يصعد. والعكس صحيح.
 </p>

 <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
 {/* Ladder SVG */}
 <svg
 width="100%"
 viewBox="0 0 540 440"
 xmlns="http://www.w3.org/2000/svg"
 role="img"
 aria-label="سلم تسعير الـ Bid/Ask مع تدفقات الأوامر"
 style={{ maxWidth: '100%', height: 'auto' }}
 className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
 >
 {/* Column headers */}
 <text x="80" y="20" textAnchor="middle" fontSize="11" fontWeight="700" fill="#ef4444">طلبات البيع (Ask)</text>
 <text x="270" y="20" textAnchor="middle" fontSize="11" fontWeight="700" fill="#475569">السعر</text>
 <text x="460" y="20" textAnchor="middle" fontSize="11" fontWeight="700" fill="#10b981">طلبات الشراء (Bid)</text>

 {/* Each level */}
 {levels.map((lvl, idx) => {
 const y = 40 + idx * 36;
 const isAsk = lvl.side === 'ask';
 const barWidth = Math.max(4, (lvl.size / maxSize) * 180);
 const barColor = isAsk ? '#ef4444' : '#10b981';
 const barX = isAsk ? 270 - barWidth - 8 : 290;
 return (
 <g key={lvl.price}>
 {/* Ask bar (grows leftward from center) */}
 {isAsk && (
 <rect x={barX} y={y} width={barWidth} height={26} fill={barColor} opacity={lvl.best ? 0.85 : 0.45} rx="2" />
 )}
 {/* Bid bar (grows rightward from center) */}
 {!isAsk && (
 <rect x={barX} y={y} width={barWidth} height={26} fill={barColor} opacity={lvl.best ? 0.85 : 0.45} rx="2" />
 )}
 {/* Price (center) */}
 <rect x="240" y={y} width="60" height={26} fill={lvl.best ? '#fef3c7' : '#f1f5f9'} stroke={lvl.best ? '#f59e0b' : 'transparent'} strokeWidth={lvl.best ? 1.5 : 0} rx="2" />
 <text x="270" y={y + 17} textAnchor="middle" fontSize="11" fontWeight={lvl.best ? 700 : 500} fill="#0f172a">{(lvl.price ?? 0).toFixed(1)}</text>
 {/* Size label on bar */}
 <text x={isAsk ? barX + 4 : barX + barWidth - 4} y={y + 17} textAnchor={isAsk ? 'start' : 'end'} fontSize="9" fill={isAsk ? '#7f1d1d' : '#064e3b'} fontWeight="600">{lvl.size}</text>
 </g>
 );
 })}

 {/* Spread indicator */}
 <line x1="180" y1="222" x2="240" y2="222" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3,2" />
 <line x1="300" y1="222" x2="360" y2="222" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3,2" />
 <text x="270" y="237" textAnchor="middle" fontSize="9" fill="#92400e" fontWeight="700">سبيرد = 0.1</text>

 {/* Market buy order arrow (hits ask) */}
 <g>
 <path d="M 470 80 L 320 100" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />
 <path d="M 320 100 L 326 92 M 320 100 L 332 102" stroke="#10b981" strokeWidth="2" strokeLinecap="round" fill="none" />
 <text x="475" y="76" textAnchor="end" fontSize="10" fill="#10b981" fontWeight="700">شراء سوقي</text>
 </g>

 {/* Market sell order arrow (hits bid) */}
 <g>
 <path d="M 70 360 L 220 320" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
 <path d="M 220 320 L 213 322 M 220 320 L 213 314" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" fill="none" />
 <text x="65" y="375" textAnchor="start" fontSize="10" fill="#ef4444" fontWeight="700">بيع سوقي</text>
 </g>
 </svg>

 {/* Imbalance + explanation */}
 <div className="flex flex-col gap-3" dir="rtl">
 {/* Order book totals */}
 <div className="grid grid-cols-2 gap-2">
 <div className="rounded-lg border border-loss/20 bg-loss/10 p-3 text-center">
 <div className="text-xs font-semibold text-loss ">إجمالي Ask</div>
 <div className="text-lg font-bold text-loss ">{totalAsk.toLocaleString()}</div>
 </div>
 <div className="rounded-lg border border-profit/20 bg-profit/10 p-3 text-center">
 <div className="text-xs font-semibold text-profit ">إجمالي Bid</div>
 <div className="text-lg font-bold text-profit ">{totalBid.toLocaleString()}</div>
 </div>
 </div>

 {/* Imbalance bar */}
 <div className="rounded-lg border border-slate-300 bg-muted/40 p-3 dark:border-slate-700">
 <div className="mb-1 flex items-center justify-between text-xs">
 <span className="text-loss ">بيع &lt;&lt;</span>
 <span className="font-semibold">عدم التوازن (Imbalance)</span>
 <span className="text-profit ">&gt;&gt; شراء</span>
 </div>
 <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
 <div
 className="absolute top-0 h-3"
 style={{
 left: imbalance < 0 ? `${50 + imbalance * 50}%` : '50%',
 width: `${Math.abs(imbalance) * 50}%`,
 backgroundColor: imbalance >= 0 ? '#10b981' : '#ef4444',
 }}
 />
 <div className="absolute left-1/2 top-0 h-3 w-0.5 -translate-x-1/2 bg-slate-400" />
 </div>
 <div className="mt-2 text-center text-xs font-bold" style={{ color: imbalance >= 0 ? '#10b981' : '#ef4444' }}>
 {imbalance >= 0 ? 'الشراء أقوى → السعر يصعد' : 'البيع أقوى → السعر ينخفض'}
 {' '}({(imbalance * 100).toFixed(1)}%)
 </div>
 </div>

 {/* Educational key */}
 <div className="rounded-lg border border-profit/20 bg-profit/10 p-3 text-xs leading-relaxed text-profit ">
 <div className="mb-2 font-bold">القاعدة الذهبية لتدفّق الأوامر:</div>
 <ul className="space-y-1">
 <li>• <span className="font-semibold">Limit Order:</span> أمر بانتظار سعر معيّن (يخلق سيولة).</li>
 <li>• <span className="font-semibold">Market Buy:</span> يشتري فورًا من أعلى سعر Ask متاح (يرفع السعر).</li>
 <li>• <span className="font-semibold">Market Sell:</span> يبيع فورًا في أدنى سعر Bid متاح (يخفض السعر).</li>
 <li>• لو الـ Ask تراكم أكثر من الـ Bid → ضغط بيعي.</li>
 <li>• لو الـ Bid تراكم أكثر من الـ Ask → ضغط شرائي.</li>
 </ul>
 </div>
 </div>
 </div>
 </motion.div>
 );
}

/* ── 23. Candlestick Patterns Grid (أنماط الشموع المتقدمة) ──
 6 candlestick patterns with mini SVG charts:
 Doji, Hammer, Bullish Engulfing, Shooting Star, Morning Star, Evening Star
 Each: SVG candle(s) + Arabic name + signal (bullish/bearish/neutral) + when it appears.
 Teaches pattern recognition — the most-asked beginner topic. */
export function CandlestickPatternsVisual() {
 // Each candle: { o, h, l, c } in SVG Y coords (smaller Y = higher price).
 type C = { o: number; h: number; l: number; c: number };
 const patterns: {
 id: string;
 name: string;
 nameEn: string;
 signal: 'bullish' | 'bearish' | 'neutral';
 appears: string;
 candles: C[];
 desc: string;
 }[] = [
 {
 id: 'doji',
 name: 'الدوجي',
 nameEn: 'Doji',
 signal: 'neutral',
 appears: 'بعد ترند قوي',
 candles: [{ o: 50, h: 30, l: 70, c: 50 }],
 desc: 'افتتاح = إغلاق. تردد تام بين المشتري والبائع. غالبًا ينذر بانعكاس.',
 },
 {
 id: 'hammer',
 name: 'المطرقة',
 nameEn: 'Hammer',
 signal: 'bullish',
 appears: 'في قاع ترند هابط',
 candles: [{ o: 55, h: 50, l: 85, c: 48 }],
 desc: 'جسم صغير أعلى الشمعة مع ظل سفلي طويل. المشترون رفضوا الأسعار المنخفضة.',
 },
 {
 id: 'engulfing',
 name: 'الابتلاع الصاعد',
 nameEn: 'Bullish Engulfing',
 signal: 'bullish',
 appears: 'في قاع ترند هابط',
 candles: [
 { o: 40, h: 35, l: 65, c: 60 },
 { o: 65, h: 25, l: 70, c: 30 },
 ],
 desc: 'شمعة خضراء كبيرة تبتلع الشمعة الحمراء السابقة بالكامل. زخم شرائي قوي.',
 },
 {
 id: 'shooting-star',
 name: 'النجم الهابط',
 nameEn: 'Shooting Star',
 signal: 'bearish',
 appears: 'في قمة ترند صاعد',
 candles: [{ o: 55, h: 25, l: 60, c: 50 }],
 desc: 'جسم صغير أسفل الشمعة مع ظل علوي طويل. البائعون رفضوا الأسعار المرتفعة.',
 },
 {
 id: 'morning-star',
 name: 'نجمة الصباح',
 nameEn: 'Morning Star',
 signal: 'bullish',
 appears: 'في قاع ترند هابط',
 candles: [
 { o: 30, h: 28, l: 60, c: 58 },
 { o: 56, h: 52, l: 62, c: 54 },
 { o: 50, h: 30, l: 55, c: 32 },
 ],
 desc: 'ثلاث شمعات: حمراء كبيرة، صغيرة مترددة، خضراء كبيرة. تأكيد انعكاس صاعد.',
 },
 {
 id: 'evening-star',
 name: 'نجمة المساء',
 nameEn: 'Evening Star',
 signal: 'bearish',
 appears: 'في قمة ترند صاعد',
 candles: [
 { o: 50, h: 28, l: 55, c: 30 },
 { o: 32, h: 28, l: 38, c: 35 },
 { o: 38, h: 60, l: 62, c: 58 },
 ],
 desc: 'ثلاث شمعات: خضراء كبيرة، صغيرة مترددة، حمراء كبيرة. تأكيد انعكاس هابط.',
 },
 ];

 const signalBadge: Record<string, { label: string; cls: string }> = {
 bullish: { label: 'صاعد', cls: 'bg-profit/15 text-profit border-profit/20' },
 bearish: { label: 'هابط', cls: 'bg-loss/15 text-loss border-loss/20' },
 neutral: { label: 'محايد', cls: 'bg-warning/15 text-warning border-warning/20' },
 };

 function MiniCandle({ c, idx }: { c: C; idx: number }) {
 const x = 30 + idx * 40;
 const isBull = c.c < c.o; // smaller Y = higher price → bullish (close above open)
 const color = isBull ? '#10b981' : '#ef4444';
 const bodyTop = Math.min(c.o, c.c);
 const bodyH = Math.max(2, Math.abs(c.c - c.o));
 return (
 <g>
 {/* Wick */}
 <line x1={x} y1={c.h} x2={x} y2={c.l} stroke={color} strokeWidth="1.5" />
 {/* Body */}
 <rect x={x - 8} y={bodyTop} width="16" height={bodyH} fill={color} rx="1.5" />
 </g>
 );
 }

 return (
 <motion.div
 dir="rtl"
 initial={{ opacity: 0, y: 12 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.45 }}
 className="my-6 overflow-hidden rounded-2xl border border-slate-200 from-white to-slate-50 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950"
 >
 <div className="mb-3 flex items-center gap-2" dir="rtl">
 <Crosshair className="h-5 w-5 text-profit " />
 <h4 className="text-base font-bold sm:text-lg">أنماط الشموع اليابانية المتقدمة</h4>
 </div>
 <p className="mb-4 text-xs text-muted-foreground sm:text-sm">
 6 أنماط أساسية لازم كل متداول يعرفها. الأهم مش شكل النمط بس،
 مكانه: نفس النمط في قاع مختلف يعطي إشارة مختلفة تمامًا.
 </p>

 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
 {patterns.map((p, i) => {
 const w = Math.max(80, p.candles.length * 40 + 20);
 const badge = signalBadge[p.signal];
 return (
 <motion.div
 key={p.id}
 initial={{ opacity: 0, scale: 0.95 }}
 animate={{ opacity: 1, scale: 1 }}
 transition={{ delay: i * 0.08 }}
 className="flex flex-col rounded-xl border border-slate-200 bg-card p-3 shadow-sm dark:border-slate-700"
 dir="rtl"
 >
 <div className="mb-2 flex items-center justify-between">
 <h5 className="text-sm font-bold">{p.name}</h5>
 <span className={cn('rounded-full border px-2 py-0.5 text-xs font-bold', badge.cls)}>
 {badge.label}
 </span>
 </div>

 {/* Mini SVG */}
 <svg
 width="100%"
 viewBox={`0 0 ${w} 100`}
 xmlns="http://www.w3.org/2000/svg"
 role="img"
 aria-label={`نمط ${p.name}`}
 style={{ maxWidth: '100%', height: 'auto' }}
 className="rounded-md bg-slate-50 dark:bg-slate-950"
 >
 {/* Subtle baseline */}
 <line x1="0" y1="50" x2={w} y2="50" stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="2,2" />
 {p.candles.map((c, idx) => (
 <MiniCandle key={idx} c={c} idx={idx} />
 ))}
 </svg>

 <p className="mt-2 text-xs leading-relaxed text-foreground">{p.desc}</p>
 <div className="mt-2 text-xs text-muted-foreground">
 <span className="font-semibold">يظهر:</span> {p.appears}
 </div>
 <div className="mt-0.5 text-xs text-muted-foreground ltr:text-left" dir="ltr">
 {p.nameEn}
 </div>
 </motion.div>
 );
 })}
 </div>

 <div className="mt-4 rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs leading-relaxed text-warning " dir="rtl">
 <span className="font-bold">تحذير مهم:</span> الأنماط وحدها لا تكفي. ادمجها مع
 المستويات (دعم/مقاومة)، السياق (مرحلة السوق)، وحجم التداول. شمعة مطرقة في
 فراغ = مجرد ضجيج.
 </div>
 </motion.div>
 );
}

/* ── 24. Risk/Reward Visualizer (مخاطرة/عائد — Interactive) ──
 Draggable Entry / Stop / Target lines on a price chart.
 Real-time calculation of Risk, Reward, R:R ratio.
 Teaches position sizing: your stop placement DICTATES your position size. */
export function RiskRewardVisual() {
 const MIN_P = 80;
 const MAX_P = 140;
 const SVG_W = 600;
 const SVG_H = 340;
 const PAD_TOP = 30;
 const PAD_BOT = 40;

 const priceToY = useCallback(
 (p: number) => PAD_TOP + ((MAX_P - p) / (MAX_P - MIN_P)) * (SVG_H - PAD_TOP - PAD_BOT),
 [],
 );
 const yToPrice = useCallback(
 (y: number) => {
 const clamped = Math.max(PAD_TOP, Math.min(SVG_H - PAD_BOT, y));
 return MAX_P - ((clamped - PAD_TOP) / (SVG_H - PAD_TOP - PAD_BOT)) * (MAX_P - MIN_P);
 },
 [],
 );

 const [entry, setEntry] = useState(100);
 const [stop, setStop] = useState(95);
 const [target, setTarget] = useState(115);
 const [dragging, setDragging] = useState<'entry' | 'stop' | 'target' | null>(null);

 const risk = Math.max(0, entry - stop); // long setup
 const reward = Math.max(0, target - entry);
 const rr = risk > 0 ? reward / risk : 0;

 // Background candlesticks for context (deterministic seed)
 const candles = useMemo(() => {
 const rng = mulberry32(42);
 let price = 92;
 const out: { x: number; o: number; h: number; l: number; c: number }[] = [];
 for (let i = 0; i < 30; i++) {
 const open = price;
 const drift = (rng() - 0.48) * 3.5;
 const close = Math.max(MIN_P + 1, Math.min(MAX_P - 1, open + drift));
 const high = Math.max(open, close) + rng() * 1.5;
 const low = Math.min(open, close) - rng() * 1.5;
 out.push({ x: 30 + i * 19, o: open, h: high, l: low, c: close });
 price = close;
 }
 return out;
 }, []);

 function handlePointerDown(e: React.PointerEvent<SVGRectElement>, which: 'entry' | 'stop' | 'target') {
 e.currentTarget.setPointerCapture(e.pointerId);
 setDragging(which);
 }
 function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
 if (!dragging) return;
 const rect = e.currentTarget.getBoundingClientRect();
 const ySvg = ((e.clientY - rect.top) / rect.height) * SVG_H;
 const newPrice = Math.round(yToPrice(ySvg) * 10) / 10;
 if (dragging === 'entry') {
 setEntry(Math.max(MIN_P + 1, Math.min(MAX_P - 1, newPrice)));
 } else if (dragging === 'stop') {
 setStop(Math.max(MIN_P + 1, Math.min(entry - 0.5, newPrice)));
 } else {
 setTarget(Math.max(entry + 0.5, Math.min(MAX_P - 1, newPrice)));
 }
 }
 function handlePointerUp() {
 setDragging(null);
 }

 const entryY = priceToY(entry);
 const stopY = priceToY(stop);
 const targetY = priceToY(target);

 return (
 <motion.div
 dir="rtl"
 initial={{ opacity: 0, y: 12 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.45 }}
 className="my-6 overflow-hidden rounded-2xl border border-slate-200 from-white to-slate-50 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950"
 >
 <div className="mb-3 flex items-center gap-2" dir="rtl">
 <Scale className="h-5 w-5 text-profit " />
 <h4 className="text-base font-bold sm:text-lg">حاسبة المخاطرة/العائد — تفاعلية</h4>
 </div>
 <p className="mb-4 text-xs text-muted-foreground sm:text-sm">
 اسحب الخطوط لتعديل entry / stop / target. الـ R:R بيتحدّث فورًا.
 القاعدة: لا تدخل صفقة R:R &lt; 2:1 — معناه بتخاطر بـ 1 جنيه علشان تكسب جنيه واحد.
 </p>

 <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
 {/* SVG chart */}
 <div className="lg:col-span-2">
 <svg
 width="100%"
 viewBox={`0 0 ${SVG_W} ${SVG_H}`}
 xmlns="http://www.w3.org/2000/svg"
 role="img"
 aria-label="رسم تفاعلي للمخاطرة والعائد"
 style={{ maxWidth: '100%', height: 'auto', touchAction: 'none' }}
 className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
 onPointerMove={handlePointerMove}
 onPointerUp={handlePointerUp}
 onPointerLeave={handlePointerUp}
 >
 {/* Price axis labels (right side) */}
 {[80, 90, 100, 110, 120, 130, 140].map((p) => {
 const y = priceToY(p);
 return (
 <g key={p}>
 <line x1="0" y1={y} x2={SVG_W} y2={y} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="3,3" />
 <text x={SVG_W - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#64748b">{p}</text>
 </g>
 );
 })}

 {/* Background candlesticks */}
 {candles.map((c, i) => {
 const isBull = c.c < c.o; // smaller Y = higher price
 const color = isBull ? '#10b981' : '#ef4444';
 const bodyTop = priceToY(Math.max(c.o, c.c));
 const bodyBot = priceToY(Math.min(c.o, c.c));
 const highY = priceToY(c.h);
 const lowY = priceToY(c.l);
 return (
 <g key={i} opacity="0.45">
 <line x1={c.x} y1={highY} x2={c.x} y2={lowY} stroke={color} strokeWidth="1" />
 <rect x={c.x - 4} y={bodyTop} width="8" height={Math.max(1, bodyBot - bodyTop)} fill={color} rx="0.5" />
 </g>
 );
 })}

 {/* Risk shaded zone (entry → stop) */}
 <rect
 x="0"
 y={Math.min(entryY, stopY)}
 width={SVG_W}
 height={Math.abs(stopY - entryY)}
 fill="#ef4444"
 opacity="0.10"
 />
 {/* Reward shaded zone (entry → target) */}
 <rect
 x="0"
 y={Math.min(entryY, targetY)}
 width={SVG_W}
 height={Math.abs(targetY - entryY)}
 fill="#10b981"
 opacity="0.10"
 />

 {/* Stop line (red) */}
 <line x1="0" y1={stopY} x2={SVG_W - 60} y2={stopY} stroke="#ef4444" strokeWidth="2" strokeDasharray="6,3" />
 <rect x={SVG_W - 60} y={stopY - 9} width="58" height="18" fill="#ef4444" rx="2" />
 <text x={SVG_W - 31} y={stopY + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">Stop {(stop ?? 0).toFixed(1)}</text>
 {/* Draggable Stop handle */}
 <rect
 x="0"
 y={stopY - 8}
 width={SVG_W}
 height="16"
 fill="transparent"
 style={{ cursor: 'ns-resize' }}
 onPointerDown={(e) => handlePointerDown(e, 'stop')}
 />

 {/* Entry line (slate) */}
 <line x1="0" y1={entryY} x2={SVG_W - 60} y2={entryY} stroke="#475569" strokeWidth="2" />
 <rect x={SVG_W - 60} y={entryY - 9} width="58" height="18" fill="#475569" rx="2" />
 <text x={SVG_W - 31} y={entryY + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">Entry {(entry ?? 0).toFixed(1)}</text>
 <rect
 x="0"
 y={entryY - 8}
 width={SVG_W}
 height="16"
 fill="transparent"
 style={{ cursor: 'ns-resize' }}
 onPointerDown={(e) => handlePointerDown(e, 'entry')}
 />

 {/* Target line (emerald) */}
 <line x1="0" y1={targetY} x2={SVG_W - 60} y2={targetY} stroke="#10b981" strokeWidth="2" strokeDasharray="6,3" />
 <rect x={SVG_W - 60} y={targetY - 9} width="58" height="18" fill="#10b981" rx="2" />
 <text x={SVG_W - 31} y={targetY + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">Tgt {(target ?? 0).toFixed(1)}</text>
 <rect
 x="0"
 y={targetY - 8}
 width={SVG_W}
 height="16"
 fill="transparent"
 style={{ cursor: 'ns-resize' }}
 onPointerDown={(e) => handlePointerDown(e, 'target')}
 />
 </svg>
 <p className="mt-2 text-xs text-muted-foreground">
 💡 اسحب الخطوط الأفقية لتعديل الأسعار. أو استخدم المنزلقات بالأسفل.
 </p>
 </div>

 {/* Metrics + sliders */}
 <div className="flex flex-col gap-3" dir="rtl">
 <div className="grid grid-cols-3 gap-2">
 <div className="rounded-lg border border-loss/20 bg-loss/10 p-3 text-center">
 <div className="text-xs text-loss ">المخاطرة</div>
 <div className="text-lg font-bold text-loss ">{(risk ?? 0).toFixed(1)}</div>
 <div className="text-xs text-muted-foreground">({(risk / entry * 100).toFixed(1)}%)</div>
 </div>
 <div className="rounded-lg border border-profit/20 bg-profit/10 p-3 text-center">
 <div className="text-xs text-profit ">العائد</div>
 <div className="text-lg font-bold text-profit ">{(reward ?? 0).toFixed(1)}</div>
 <div className="text-xs text-muted-foreground">({(reward / entry * 100).toFixed(1)}%)</div>
 </div>
 <div className="rounded-lg border border-slate-400/40 bg-slate-500/10 p-3 text-center">
 <div className="text-xs text-slate-700 dark:text-slate-300">R:R</div>
 <div className="text-lg font-bold text-slate-700 dark:text-slate-300">{(rr ?? 0).toFixed(2)}</div>
 <div className="text-xs text-muted-foreground">1 : {(rr ?? 0).toFixed(1)}</div>
 </div>
 </div>

 {/* Verdict */}
 <div
 className={cn(
 'rounded-lg border p-3 text-center text-xs font-bold',
 rr >= 2
 ? 'border-profit/20 bg-profit/15 text-profit '
 : rr >= 1
 ? 'border-warning/20 bg-warning/15 text-warning '
 : 'border-loss/20 bg-loss/15 text-loss ',
 )}
 >
 {rr >= 2 ? '✅ صفقة مقبولة — R:R ≥ 2:1' : rr >= 1 ? '⚠️ صفقة هامشية — R:R بين 1 و 2' : '❌ صفقة مرفوضة — R:R < 1'}
 </div>

 {/* Sliders for accessibility */}
 <div className="space-y-3 rounded-lg border border-slate-200 bg-muted/30 p-3 dark:border-slate-700" dir="rtl">
 <div>
 <div className="mb-1 flex justify-between text-xs">
 <span className="font-semibold text-slate-700 dark:text-slate-300">سعر الدخول (Entry)</span>
 <span className="text-slate-600 dark:text-slate-400">{(entry ?? 0).toFixed(1)}</span>
 </div>
 <input
 type="range"
 min={MIN_P}
 max={MAX_P}
 step={0.5}
 value={entry}
 onChange={(e) => setEntry(Number(e.target.value))}
 className="w-full accent-slate-600"
 />
 </div>
 <div>
 <div className="mb-1 flex justify-between text-xs">
 <span className="font-semibold text-loss ">الوقف (Stop)</span>
 <span className="text-slate-600 dark:text-slate-400">{(stop ?? 0).toFixed(1)}</span>
 </div>
 <input
 type="range"
 min={MIN_P}
 max={entry - 0.5}
 step={0.5}
 value={stop}
 onChange={(e) => setStop(Number(e.target.value))}
 className="w-full accent-loss"
 />
 </div>
 <div>
 <div className="mb-1 flex justify-between text-xs">
 <span className="font-semibold text-profit ">الهدف (Target)</span>
 <span className="text-slate-600 dark:text-slate-400">{(target ?? 0).toFixed(1)}</span>
 </div>
 <input
 type="range"
 min={entry + 0.5}
 max={MAX_P}
 step={0.5}
 value={target}
 onChange={(e) => setTarget(Number(e.target.value))}
 className="w-full accent-profit"
 />
 </div>
 </div>

 {/* Position sizing lesson */}
 <div className="rounded-lg border border-profit/20 bg-profit/10 p-3 text-xs leading-relaxed text-profit " dir="rtl">
 <div className="mb-1 font-bold">حجم الصفقة (Position Size):</div>
 لو مخاطرك المسموحة = 2% من رأس المال (مثلاً 1000 ج.م من 50,000)،
 والمخاطرة لكل سهم = {(risk ?? 0).toFixed(1)} ج.م →
 <div className="mt-1 text-center font-bold text-profit ">
 عدد الأسهم = {Math.floor(1000 / Math.max(0.1, risk))} سهم
 </div>
 </div>
 </div>
 </div>
 </motion.div>
 );
}

/* ── 25. Portfolio Allocation Donut (توزيع المحفظة عبر الأسواق) ──
 Interactive SVG donut with 6 asset classes.
 Click slice → detail panel: expected return, volatility, role.
 Teaches diversification across markets (EGX/TADAWUL/US/Crypto/Gold/Cash). */
export function PortfolioAllocationVisual() {
 type Asset = {
 id: string;
 name: string;
 nameEn: string;
 pct: number;
 color: string;
 expectedReturn: number; // % per year (educational estimate)
 volatility: number; // % annual stdev
 role: string;
 note: string;
 };
 const assets: Asset[] = [
 { id: 'egx', name: 'أسهم مصرية', nameEn: 'EGX', pct: 40, color: '#10b981', expectedReturn: 14, volatility: 24, role: 'محرك النمو الأساسي', note: 'السوق المحلي — تقلبات عالية لكن فرص نمو كبيرة.' },
 { id: 'tadawul', name: 'أسهم سعودية', nameEn: 'TADAWUL', pct: 15, color: '#059669', expectedReturn: 10, volatility: 18, role: 'تنويع إقليمي', note: 'سوق خليجي مستقر، قطاعات بنكية وبتروكيماوية.' },
 { id: 'us', name: 'أسهم أمريكية', nameEn: 'US Stocks', pct: 15, color: '#f59e0b', expectedReturn: 9, volatility: 15, role: 'تنويع دولي + تحوّط عملة', note: 'وصول لشركات عالمية كبرى، يُحمّل مخاطر صرف الدولار.' },
 { id: 'crypto', name: 'عملات رقمية', nameEn: 'Crypto', pct: 10, color: '#64748b', expectedReturn: 30, volatility: 70, role: 'مضاربة عالية المخاطر', note: 'بيتكوين أساسًا. تخصيص صغير فقط بسبب التقلبات الشديدة.' },
 { id: 'gold', name: 'ذهب', nameEn: 'Gold', pct: 15, color: '#d97706', expectedReturn: 6, volatility: 12, role: 'ملاذ آمن + تحوّط تضخمي', note: 'يحافظ على القوة الشرائية في فترات التضخم والركود.' },
 { id: 'cash', name: 'نقدية', nameEn: 'Cash', pct: 5, color: '#94a3b8', expectedReturn: 8, volatility: 0, role: 'مخزن فرص', note: 'شهادات إيداع — عائد ثابت. متاحة لاقتناص الفرص عند انخفاض الأسواق.' },
 ];

 const [active, setActive] = useState<Asset>(assets[0]);

 // Donut geometry
 const CX = 160;
 const CY = 160;
 const R_OUT = 130;
 const R_IN = 78;

 function polar(cx: number, cy: number, r: number, angleDeg: number) {
 const rad = (angleDeg - 90) * Math.PI / 180;
 return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
 }
 function arcPath(startAngle: number, endAngle: number, isActive: boolean) {
 const rO = isActive ? R_OUT + 8 : R_OUT;
 const rI = R_IN;
 const so = polar(CX, CY, rO, endAngle);
 const eo = polar(CX, CY, rO, startAngle);
 const si = polar(CX, CY, rI, startAngle);
 const ei = polar(CX, CY, rI, endAngle);
 const large = endAngle - startAngle <= 180 ? 0 : 1;
 return `M ${so.x} ${so.y} A ${rO} ${rO} 0 ${large} 0 ${eo.x} ${eo.y} L ${si.x} ${si.y} A ${rI} ${rI} 0 ${large} 1 ${ei.x} ${ei.y} Z`;
 }

 // Compute slice angles
 let cursor = 0;
 const slices = assets.map((a) => {
 const start = cursor;
 const sweep = (a.pct / 100) * 360;
 cursor += sweep;
 return { ...a, start, end: cursor };
 });

 // Weighted average expected return (portfolio)
 const portfolioReturn = assets.reduce((s, a) => s + (a.pct / 100) * a.expectedReturn, 0);
 const portfolioVol = Math.sqrt(
 assets.reduce((s, a) => s + Math.pow((a.pct / 100) * a.volatility, 2), 0),
 ); // simplified (assumes uncorrelated — educational approximation)
 const sharpe = portfolioVol > 0 ? (portfolioReturn - 8) / portfolioVol : 0; // risk-free = 8% (EGX deposits)

 return (
 <motion.div
 dir="rtl"
 initial={{ opacity: 0, y: 12 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.45 }}
 className="my-6 overflow-hidden rounded-2xl border border-slate-200 from-white to-slate-50 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950"
 >
 <div className="mb-3 flex items-center gap-2" dir="rtl">
 <PieChart className="h-5 w-5 text-profit " />
 <h4 className="text-base font-bold sm:text-lg">توزيع المحفظة عبر الأسواق — عجلة تفاعلية</h4>
 </div>
 <p className="mb-4 text-xs text-muted-foreground sm:text-sm">
 اضغط على أي قطاع في العجلة لتشاهد تفاصيله. التوزيع المقترح تعليمي وبيمثل
 مثالًا لمحفظة متنوعة عبر 6 أسواق لتقليل المخاطر الإجمالية.
 </p>

 <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
 {/* Donut SVG */}
 <div className="flex flex-col items-center">
 <svg
 width="100%"
 viewBox="0 0 320 320"
 xmlns="http://www.w3.org/2000/svg"
 role="img"
 aria-label="عجلة توزيع المحفظة"
 style={{ maxWidth: '320px', height: 'auto' }}
 >
 {slices.map((s) => {
 const isActive = s.id === active.id;
 return (
 <path
 key={s.id}
 d={arcPath(s.start, s.end, isActive)}
 fill={s.color}
 opacity={isActive ? 1 : 0.78}
 stroke="#fff"
 strokeWidth="2"
 style={{ cursor: 'pointer' }}
 onClick={() => setActive(s)}
 onMouseEnter={() => setActive(s)}
 >
 <title>{s.name}: {s.pct}%</title>
 </path>
 );
 })}
 {/* Center label */}
 <text x={CX} y={CY - 6} textAnchor="middle" fontSize="11" fill="#64748b" fontWeight="600">العائد المتوقع</text>
 <text x={CX} y={CY + 14} textAnchor="middle" fontSize="22" fill="#10b981" fontWeight="800">+{(portfolioReturn ?? 0).toFixed(1)}%</text>
 <text x={CX} y={CY + 32} textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="500">سنويًا</text>
 </svg>

 {/* Legend */}
 <div className="mt-3 grid w-full max-w-sm grid-cols-2 gap-1.5 text-xs" dir="rtl">
 {assets.map((a) => (
 <button
 key={a.id}
 onClick={() => setActive(a)}
 className={cn(
 'flex items-center gap-1.5 rounded-md border px-2 py-1 text-right transition',
 active.id === a.id
 ? 'border-slate-300 bg-muted/60 dark:border-slate-600'
 : 'border-transparent hover:bg-muted/30',
 )}
 >
 <span className="h-3 w-3 flex-shrink-0 rounded-sm" style={{ backgroundColor: a.color }} />
 <span className="truncate font-medium">{a.name}</span>
 <span className="text-muted-foreground">{a.pct}%</span>
 </button>
 ))}
 </div>
 </div>

 {/* Detail + portfolio stats */}
 <div className="flex flex-col gap-3" dir="rtl">
 {/* Selected asset details */}
 <div
 className="rounded-xl border-2 p-4"
 style={{ borderColor: active.color + '60', backgroundColor: active.color + '0D' }}
 >
 <div className="mb-2 flex items-center justify-between">
 <h5 className="text-base font-bold" style={{ color: active.color }}>
 {active.name}
 </h5>
 <span
 className="rounded-full px-3 py-1 text-xs font-bold text-white"
 style={{ backgroundColor: active.color }}
 >
 {active.pct}%
 </span>
 </div>
 <p className="mb-2 text-xs text-muted-foreground ltr:text-left" dir="ltr">{active.nameEn}</p>
 <p className="text-xs leading-relaxed text-foreground">{active.note}</p>
 <div className="mt-3 grid grid-cols-3 gap-2 text-center">
 <div className="rounded-md bg-muted/40 p-2">
 <div className="text-xs text-muted-foreground">العائد المتوقع</div>
 <div className="text-sm font-bold text-profit ">+{active.expectedReturn}%</div>
 </div>
 <div className="rounded-md bg-muted/40 p-2">
 <div className="text-xs text-muted-foreground">التقلب السنوي</div>
 <div className="text-sm font-bold text-warning ">±{active.volatility}%</div>
 </div>
 <div className="rounded-md bg-muted/40 p-2">
 <div className="text-xs text-muted-foreground">الدور</div>
 <div className="text-xs font-bold text-slate-700 dark:text-slate-300">{active.role}</div>
 </div>
 </div>
 </div>

 {/* Portfolio aggregate stats */}
 <div className="rounded-lg border border-slate-300 bg-muted/30 p-3 dark:border-slate-700">
 <div className="mb-2 text-center text-xs font-semibold text-slate-700 dark:text-slate-300">
 إحصائيات المحفظة الكاملة
 </div>
 <div className="grid grid-cols-3 gap-2 text-center">
 <div>
 <div className="text-xs text-muted-foreground">عائد متوقع</div>
 <div className="text-base font-bold text-profit ">+{(portfolioReturn ?? 0).toFixed(1)}%</div>
 </div>
 <div>
 <div className="text-xs text-muted-foreground">تقلب إجمالي</div>
 <div className="text-base font-bold text-warning ">±{(portfolioVol ?? 0).toFixed(1)}%</div>
 </div>
 <div>
 <div className="text-xs text-muted-foreground">Sharpe</div>
 <div className="text-base font-bold text-slate-700 dark:text-slate-300">{(sharpe ?? 0).toFixed(2)}</div>
 </div>
 </div>
 </div>

 <div className="rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs leading-relaxed text-warning " dir="rtl">
 <span className="font-bold">درس التنويع:</span> المحفظة دي بتدي عائد
 متوقع +{(portfolioReturn ?? 0).toFixed(0)}% لكن بتقلب ±{(portfolioVol ?? 0).toFixed(0)}% فقط —
 أقل من وضع 100% في Crypto (±70%) أو 100% في EGX (±24%). التنويع بيوازن
 بين العائد والمخاطرة.
 </div>
 </div>
 </div>
 </motion.div>
 );
}

/* ============================================================
 Seeded RNG (mulberry32) — deterministic, no Math.random().
 Used by visuals + simulators that need reproducible
 "random" data seeded by user input (Rule 67 — no synthetic
 Math.random in educational sims; output must be reproducible).
 Exported so simulators in other files can reuse it.
 ============================================================ */
export function mulberry32(seed: number): () => number {
 let s = seed >>> 0;
 return function () {
 s = (s + 0x6d2b79f5) >>> 0;
 let t = s;
 t = Math.imul(t ^ (t >>> 15), t | 1);
 t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
 return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}

