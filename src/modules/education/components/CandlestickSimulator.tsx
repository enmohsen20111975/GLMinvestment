// P40-ACADEMY PILLAR 2: Interactive Candlestick Simulator & Builder
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
 Card,
 CardContent,
 CardDescription,
 CardHeader,
 CardTitle,
} from '@/components/ui/card';
import {
 Collapsible,
 CollapsibleContent,
 CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import {
 BookOpen,
 CandlestickChart,
 ChevronDown,
 Lightbulb,
 Minus,
 Play,
 RotateCcw,
 TrendingDown,
 TrendingUp,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Candle pattern library
// ---------------------------------------------------------------------------

export interface CandlePattern {
 name: string;
 nameAr: string;
 emoji: string;
 type: 'bullish' | 'bearish' | 'neutral';
 reliability: 'high' | 'medium' | 'low';
 description: string; // psychological explanation (Arabic)
 bullishProb: number; // 0..100
 bearishProb: number; // 0..100
 detect: (o: number, h: number, l: number, c: number) => boolean;
 preset: { o: number; h: number; l: number; c: number };
}

// Geometry helpers for single-candle detection.
const bodySize = (o: number, c: number) => Math.abs(c - o);
const upperWick = (o: number, h: number, c: number) => h - Math.max(o, c);
const lowerWick = (o: number, l: number, c: number) => Math.min(o, c) - l;
const totalRange = (h: number, l: number) => Math.max(0, h - l);

// NOTE: multi-candle patterns (Engulfing / Morning Star / Evening Star /
// Three Soldiers / Three Crows) are detected on the *representative final
// candle* of the formation, since the simulator builds a single candle.
// This is an educational approximation — descriptions explain the full shape.
export const CANDLE_PATTERNS: CandlePattern[] = [
 {
 name: 'Doji',
 nameAr: 'الدوجي',
 emoji: '➕',
 type: 'neutral',
 reliability: 'low',
 description:
 'شمعة الدوجي تفتُتح وتُغلق عند نفس السعر تقريباً، فيتلاشى الجسم وتظهر كصليب. تعكس تردداً وتوازناً تاماً بين المشتري والبائع، وكثيراً ما تنذر بنقطة تحوّل إذا ظهرت بعد ترند قوي.',
 bullishProb: 45,
 bearishProb: 45,
 detect: (o, h, l, c) =>
 bodySize(o, c) <= Math.max(1.5, totalRange(h, l) * 0.1) && totalRange(h, l) > 5,
 preset: { o: 50, h: 70, l: 30, c: 50 },
 },
 {
 name: 'Hammer',
 nameAr: 'المطرقة',
 emoji: '🔨',
 type: 'bullish',
 reliability: 'medium',
 description:
 'المطرقة تتكوّن من جسم صغير في الأعلى وفُتيل سفلي طويل. تظهر بعد ترند هابط وتُظهر رفض البائعين للأسعار المنخفضة ودخول المشترين بقوة في نهاية الجلسة — إشارة انعكاس صعودية محتملة.',
 bullishProb: 68,
 bearishProb: 22,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 const uw = upperWick(o, h, c);
 const lw = lowerWick(o, l, c);
 return b <= 8 && lw >= b * 2 && lw > 15 && uw <= b * 1.5;
 },
 preset: { o: 50, h: 52, l: 20, c: 48 },
 },
 {
 name: 'Inverted Hammer',
 nameAr: 'المطرقة المقلوبة',
 emoji: '🪃',
 type: 'bullish',
 reliability: 'low',
 description:
 'المطرقة المقلوبة لها جسم صغير في الأسفل وفُتيل علوي طويل. تظهر بعد ترند هابط وتُظهر أن المشترين حاولوا دفع السعر للأعلى لكن البائعين أعادوه — تحتاج تأكيداً بالشمعة التالية.',
 bullishProb: 55,
 bearishProb: 30,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 const uw = upperWick(o, h, c);
 const lw = lowerWick(o, l, c);
 return b <= 8 && uw >= b * 2 && uw > 15 && lw <= b * 1.2;
 },
 preset: { o: 45, h: 80, l: 43, c: 47 },
 },
 {
 name: 'Bullish Engulfing',
 nameAr: 'الابتلاع الصعودي',
 emoji: '🟢',
 type: 'bullish',
 reliability: 'high',
 description:
 'الابتلاع الصعودي شمعة خضراء كبيرة تبتلع الشمعة الحمراء السابقة بالكامل. يعكس تحوّلاً قوياً في السيطرة من البائعين إلى المشترين — إشارة انعكاس صعودية قوية وموثوقة.',
 bullishProb: 78,
 bearishProb: 12,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 return (
 c > o &&
 b > 25 &&
 upperWick(o, h, c) < b * 0.2 &&
 lowerWick(o, l, c) < b * 0.2
 );
 },
 preset: { o: 30, h: 80, l: 28, c: 78 },
 },
 {
 name: 'Bearish Engulfing',
 nameAr: 'الابتلاع الهبوطي',
 emoji: '🔴',
 type: 'bearish',
 reliability: 'high',
 description:
 'الابتلاع الهبوطي شمعة حمراء كبيرة تبتلع الشمعة الخضراء السابقة بالكامل. يعكس تحوّل القوة من المشترين إلى البائعين — إشارة انعكاس هبوطية قوية وموثوقة.',
 bullishProb: 12,
 bearishProb: 78,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 return (
 c < o &&
 b > 25 &&
 upperWick(o, h, c) < b * 0.2 &&
 lowerWick(o, l, c) < b * 0.2
 );
 },
 preset: { o: 70, h: 72, l: 22, c: 24 },
 },
 {
 name: 'Morning Star',
 nameAr: 'نجمة الصباح',
 emoji: '⭐',
 type: 'bullish',
 reliability: 'high',
 description:
 'نجمة الصباح ثلاث شموع: حمراء كبيرة → جسم صغير (تردد) → خضراء كبيرة. تعكس تلاشي قوة البائعين ثم عودة المشترين بقوة — إشارة انعكاس صعودية قوية في قاع الترند.',
 bullishProb: 75,
 bearishProb: 15,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 return (
 c > o &&
 b > 20 &&
 lowerWick(o, l, c) > 5 &&
 upperWick(o, h, c) < b * 0.3
 );
 },
 preset: { o: 35, h: 65, l: 29, c: 62 },
 },
 {
 name: 'Evening Star',
 nameAr: 'نجمة المساء',
 emoji: '🌙',
 type: 'bearish',
 reliability: 'high',
 description:
 'نجمة المساء ثلاث شموع: خضراء كبيرة → جسم صغير (تردد) → حمراء كبيرة. تعكس تلاشي قوة المشترين ثم سيطرة البائعين — إشارة انعكاس هبوطية قوية في قمة الترند.',
 bullishProb: 15,
 bearishProb: 75,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 return (
 c < o &&
 b > 20 &&
 upperWick(o, h, c) > 5 &&
 lowerWick(o, l, c) < b * 0.3
 );
 },
 preset: { o: 65, h: 73, l: 38, c: 40 },
 },
 {
 name: 'Shooting Star',
 nameAr: 'الشهاب',
 emoji: '🌠',
 type: 'bearish',
 reliability: 'medium',
 description:
 'الشهاب له جسم صغير في الأسفل وفُتيل علوي طويل جداً مع فُتيل سفلي قصير. يُظهر رفض السعر للأعلى بقوة — البائعون سيطروا بعد محاولة المشترين دفع السعر للأعلى. إشارة هبوطية.',
 bullishProb: 22,
 bearishProb: 68,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 const uw = upperWick(o, h, c);
 const lw = lowerWick(o, l, c);
 return b <= 10 && uw >= b * 2.5 && uw > 20 && lw <= b * 0.8;
 },
 preset: { o: 50, h: 85, l: 49, c: 52 },
 },
 {
 name: 'Three White Soldiers',
 nameAr: 'الجنود البيض الثلاثة',
 emoji: '⚔️',
 type: 'bullish',
 reliability: 'high',
 description:
 'الجنود البيض الثلاثة: ثلاث شموع خضراء متتالية يغلق كل واحدة أعلى من السابقة، بأجسام كبيرة وفُتايل صغيرة. تعكس ضغط شراء مستمر وقوي — إشارة استمرارية صعودية موثوقة جداً.',
 bullishProb: 80,
 bearishProb: 10,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 return (
 c > o &&
 b > 20 &&
 upperWick(o, h, c) < b * 0.25 &&
 lowerWick(o, l, c) < b * 0.25
 );
 },
 preset: { o: 30, h: 75, l: 28, c: 72 },
 },
 {
 name: 'Three Black Crows',
 nameAr: 'الغربان السود الثلاث',
 emoji: '🦅',
 type: 'bearish',
 reliability: 'high',
 description:
 'الغربان السود الثلاث: ثلاث شموع حمراء متتالية يغلق كل واحدة أقل من السابقة، بأجسام كبيرة. تعكس ضغط بيع مستمر وقوي — إشارة استمرارية هبوطية موثوقة جداً.',
 bullishProb: 10,
 bearishProb: 80,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 return (
 c < o &&
 b > 20 &&
 upperWick(o, h, c) < b * 0.25 &&
 lowerWick(o, l, c) < b * 0.25
 );
 },
 preset: { o: 70, h: 72, l: 27, c: 30 },
 },
 {
 name: 'Marubozu (Bullish)',
 nameAr: 'الماروبوزو الصعودي',
 emoji: '🟩',
 type: 'bullish',
 reliability: 'high',
 description:
 'الماروبوزو الصعودي شمعة خضراء كاملة الجسم بدون فُتايل. تعكس سيطرة مطلقة للمشترين طوال الجلسة من الفتح حتى الإغلاق — إشارة قوة صعودية شديدة.',
 bullishProb: 82,
 bearishProb: 8,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 return c > o && b > 30 && upperWick(o, h, c) < 1 && lowerWick(o, l, c) < 1;
 },
 preset: { o: 20, h: 80, l: 20, c: 80 },
 },
 {
 name: 'Marubozu (Bearish)',
 nameAr: 'الماروبوزو الهبوطي',
 emoji: '🟥',
 type: 'bearish',
 reliability: 'high',
 description:
 'الماروبوزو الهبوطي شمعة حمراء كاملة الجسم بدون فُتايل. تعكس سيطرة مطلقة للبائعين طوال الجلسة من الفتح حتى الإغلاق — إشارة قوة هبوطية شديدة.',
 bullishProb: 8,
 bearishProb: 82,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 return c < o && b > 30 && upperWick(o, h, c) < 1 && lowerWick(o, l, c) < 1;
 },
 preset: { o: 80, h: 80, l: 20, c: 20 },
 },
 {
 name: 'Spinning Top',
 nameAr: 'النخلة الدوّارة',
 emoji: '🌀',
 type: 'neutral',
 reliability: 'low',
 description:
 'النخلة الدوّارة جسم صغير مع فُتايل طويلة من الجهتين. تعكس تردداً وحيرة في السوق — لم يستطع المشتري ولا البائع السيطرة. تشير إلى احتمال انعكاس أو استراحة.',
 bullishProb: 40,
 bearishProb: 40,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 const uw = upperWick(o, h, c);
 const lw = lowerWick(o, l, c);
 return b <= 8 && uw > 10 && lw > 10 && Math.abs(uw - lw) < 8;
 },
 preset: { o: 48, h: 75, l: 25, c: 52 },
 },
 {
 name: 'Hanging Man',
 nameAr: 'الرجل المعلّق',
 emoji: '🪢',
 type: 'bearish',
 reliability: 'medium',
 description:
 'الرجل المعلّق جسم صغير في الأعلى مع فُتيل سفلي طويل، يظهر بعد ترند صاعد. يُظهر رفض السعر للأسفل مؤقتاً لكنه في قمة الترند يُعد تحذيراً من احتمال انعكاس هبوطي — يحتاج تأكيداً بالشمعة التالية.',
 bullishProb: 28,
 bearishProb: 60,
 detect: (o, h, l, c) => {
 const b = bodySize(o, c);
 const uw = upperWick(o, h, c);
 const lw = lowerWick(o, l, c);
 return b <= 10 && lw >= b * 2 && lw > 15 && uw <= b * 1;
 },
 preset: { o: 58, h: 59, l: 25, c: 56 },
 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, min: number, max: number) =>
 Math.min(max, Math.max(min, v));

const TYPE_META: Record<
 CandlePattern['type'],
 { label: string; className: string; icon: typeof TrendingUp }
> = {
 bullish: {
 label: 'صعودي',
 className: 'bg-profit/15 text-profit border-profit/20',
 icon: TrendingUp,
 },
 bearish: {
 label: 'هبوطي',
 className: 'bg-loss/15 text-loss border-loss/20',
 icon: TrendingDown,
 },
 neutral: {
 label: 'محايد',
 className: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
 icon: Minus,
 },
};

const RELIABILITY_META: Record<
 CandlePattern['reliability'],
 { label: string; className: string }
> = {
 high: {
 label: 'موثوقية عالية',
 className: 'bg-warning/15 text-warning border-warning/20',
 },
 medium: {
 label: 'موثوقية متوسطة',
 className: 'bg-slate-400/15 text-slate-600 dark:text-slate-300 border-slate-400/40',
 },
 low: {
 label: 'موثوقية منخفضة',
 className: 'bg-warning/15 text-warning border-orange-700/40',
 },
};

// ---------------------------------------------------------------------------
// SVG candle renderer
// ---------------------------------------------------------------------------

interface CandleSvgProps {
 o: number;
 h: number;
 l: number;
 c: number;
}

function CandleSvg({ o, h, l, c }: CandleSvgProps) {
 // viewBox: 0 0 200 300 — chart area: x 40..140, y 20..280
 const CHART_LEFT = 40;
 const CHART_RIGHT = 140;
 const CHART_TOP = 20;
 const CHART_BOTTOM = 280;
 const CHART_H = CHART_BOTTOM - CHART_TOP;
 const CANDLE_X = (CHART_LEFT + CHART_RIGHT) / 2;
 const BODY_W = 30;

 const priceToY = (p: number) =>
 CHART_TOP + (100 - clamp(p, 0, 100)) * (CHART_H / 100);

 const yHigh = priceToY(h);
 const yLow = priceToY(l);
 const yOpen = priceToY(o);
 const yClose = priceToY(c);

 const bodyTop = Math.min(yOpen, yClose);
 const bodyBottom = Math.max(yOpen, yClose);
 const bodyHeight = Math.max(2, bodyBottom - bodyTop);

 const isGreen = c > o;
 const isRed = c < o;
 const isDoji = Math.abs(c - o) < 0.75;

 const bodyColor = isDoji
 ? '#64748b'
 : isGreen
 ? '#10b981'
 : '#ef4444';
 const wickColor = isDoji ? '#475569' : bodyColor;

 // Grid lines at 0, 25, 50, 75, 100
 const gridPrices = [0, 25, 50, 75, 100];

 return (
 <svg
 viewBox="0 0 200 300"
 className="w-full max-w-[260px] mx-auto"
 role="img"
 aria-label="مخطط الشمعة اليابانية"
 style={{ direction: 'ltr' }}
 >
 {/* Background grid */}
 {gridPrices.map((p) => {
 const y = priceToY(p);
 return (
 <g key={p}>
 <line
 x1={CHART_LEFT}
 y1={y}
 x2={CHART_RIGHT}
 y2={y}
 stroke="currentColor"
 strokeWidth={0.5}
 className="text-muted-foreground/30"
 />
 <text
 x={CHART_RIGHT + 6}
 y={y + 3}
 fontSize={9}
 fill="currentColor"
 className="text-muted-foreground"
 >
 {(p ?? 0).toFixed(0)}
 </text>
 </g>
 );
 })}

 {/* Vertical axis */}
 <line
 x1={CHART_RIGHT}
 y1={CHART_TOP}
 x2={CHART_RIGHT}
 y2={CHART_BOTTOM}
 stroke="currentColor"
 strokeWidth={0.75}
 className="text-muted-foreground/50"
 />

 {/* Wick (high → low) */}
 <line
 x1={CANDLE_X}
 y1={yHigh}
 x2={CANDLE_X}
 y2={yLow}
 stroke={wickColor}
 strokeWidth={2}
 strokeLinecap="round"
 />

 {/* Body */}
 {isDoji ? (
 // Doji: horizontal cross bar
 <line
 x1={CANDLE_X - BODY_W / 2}
 y1={yOpen}
 x2={CANDLE_X + BODY_W / 2}
 y2={yOpen}
 stroke={bodyColor}
 strokeWidth={3}
 strokeLinecap="round"
 />
 ) : (
 <rect
 x={CANDLE_X - BODY_W / 2}
 y={bodyTop}
 width={BODY_W}
 height={bodyHeight}
 fill={bodyColor}
 stroke={bodyColor}
 strokeWidth={1}
 rx={1.5}
 />
 )}

 {/* Price reference labels (Open / High / Low / Close) */}
 <PriceTag y={yHigh} x={CHART_LEFT - 4} color="#6366f1" label="H" value={h} align="end" />
 <PriceTag y={yOpen} x={CHART_LEFT - 4} color="#0ea5e9" label="O" value={o} align="end" />
 <PriceTag y={yClose} x={CHART_LEFT - 4} color={bodyColor} label="C" value={c} align="end" />
 <PriceTag y={yLow} x={CHART_LEFT - 4} color="#a855f7" label="L" value={l} align="end" />
 </svg>
 );
}

function PriceTag({
 y,
 x,
 color,
 label,
 value,
 align,
}: {
 y: number;
 x: number;
 color: string;
 label: string;
 value: number;
 align: 'start' | 'end';
}) {
 return (
 <g>
 <text
 x={x}
 y={y - 2}
 fontSize={8.5}
 fill={color}
 textAnchor={align}
 fontWeight={700}
 >
 {label}
 </text>
 <text
 x={x}
 y={y + 7}
 fontSize={8.5}
 fill="currentColor"
 className="text-muted-foreground"
 textAnchor={align}
 >
 {(value ?? 0).toFixed(1)}
 </text>
 </g>
 );
}

// ---------------------------------------------------------------------------
// Probability split bar
// ---------------------------------------------------------------------------

function ProbabilityBar({ pattern }: { pattern: CandlePattern }) {
 const bull = clamp(pattern.bullishProb, 0, 100);
 const bear = clamp(pattern.bearishProb, 0, 100);
 const neutral = Math.max(0, 100 - bull - bear);
 return (
 <div className="space-y-1.5" dir="ltr">
 <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
 <div
 className="bg-profit transition-all duration-300"
 style={{ width: `${bull}%` }}
 title={`صعودي: ${bull}%`}
 />
 <div
 className="bg-slate-400/60 transition-all duration-300"
 style={{ width: `${neutral}%` }}
 title={`محايد: ${neutral}%`}
 />
 <div
 className="bg-loss transition-all duration-300"
 style={{ width: `${bear}%` }}
 title={`هبوطي: ${bear}%`}
 />
 </div>
 <div className="flex justify-between text-xs text-muted-foreground">
 <span className="text-profit ">▲ {bull}%</span>
 <span className="text-loss ">{bear}% ▼</span>
 </div>
 </div>
 );
}

// ---------------------------------------------------------------------------
// Slider row
// ---------------------------------------------------------------------------

interface SliderRowProps {
 label: string;
 value: number;
 onChange: (v: number) => void;
 color: string;
}

function SliderRow({ label, value, onChange, color }: SliderRowProps) {
 return (
 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-sm font-medium">{label}</span>
 <span
 className="rounded-md px-2 py-0.5 text-xs font-bold tabular-nums text-foreground"
 style={{ backgroundColor: color }}
 >
 {(value ?? 0).toFixed(1)}
 </span>
 </div>
 <Slider
 value={[value]}
 min={0}
 max={100}
 step={0.5}
 onValueChange={(v) => onChange(v[0])}
 />
 </div>
 );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CandlestickSimulator() {
 const [openV, setOpenV] = useState(50);
 const [highV, setHighV] = useState(70);
 const [lowV, setLowV] = useState(30);
 const [closeV, setCloseV] = useState(60);

 // Animation state: when animating, effClose interpolates from open → close.
 const [animClose, setAnimClose] = useState<number | null>(null);
 const [animating, setAnimating] = useState(false);
 const [galleryOpen, setGalleryOpen] = useState(false);
 const rafRef = useRef<number | null>(null);

 // Effective close = animated value while animating, else real close.
 const effClose = animClose !== null ? animClose : closeV;

 // Enforce OHLC constraints: High ≥ max(Open, Close), Low ≤ min(Open, Close).
 const effHigh = Math.max(highV, openV, effClose);
 const effLow = Math.min(lowV, openV, effClose);

 // Pattern detection (recompute only when OHLC changes).
 const matchedPatterns = useMemo(
 () => CANDLE_PATTERNS.filter((p) => p.detect(openV, effHigh, effLow, effClose)),
 [openV, effHigh, effLow, effClose],
 );

 // Slider change handlers with auto-adjustment.
 const handleOpen = useCallback(
 (nv: number) => {
 setOpenV(nv);
 setHighV((prev) => Math.max(prev, nv, closeV));
 setLowV((prev) => Math.min(prev, nv, closeV));
 },
 [closeV],
 );

 const handleHigh = useCallback(
 (nv: number) => {
 setHighV(Math.max(nv, openV, effClose));
 },
 [openV, effClose],
 );

 const handleLow = useCallback(
 (nv: number) => {
 setLowV(Math.min(nv, openV, effClose));
 },
 [openV, effClose],
 );

 const handleClose = useCallback(
 (nv: number) => {
 setCloseV(nv);
 setHighV((prev) => Math.max(prev, nv, openV));
 setLowV((prev) => Math.min(prev, nv, openV));
 },
 [openV],
 );

 const cancelAnim = useCallback(() => {
 if (rafRef.current !== null) {
 cancelAnimationFrame(rafRef.current);
 rafRef.current = null;
 }
 setAnimating(false);
 setAnimClose(null);
 }, []);

 // Animate the candle forming: close interpolates open → target over 2s.
 const handleAnimate = useCallback(() => {
 if (animating) return;
 cancelAnimationFrame(rafRef.current ?? 0);
 const start = openV;
 const target = closeV;
 const duration = 2000;
 const startTime = performance.now();
 setAnimating(true);
 setAnimClose(start);

 const step = (now: number) => {
 const elapsed = now - startTime;
 const t = Math.min(1, elapsed / duration);
 // easeOutCubic — feels like the buyer/seller battle settling.
 const eased = 1 - Math.pow(1 - t, 3);
 const current = start + (target - start) * eased;
 setAnimClose(current);
 // Keep high/low constraints satisfied during animation.
 setHighV((prev) => (prev < current ? current : prev));
 setLowV((prev) => (prev > current ? current : prev));
 if (t < 1) {
 rafRef.current = requestAnimationFrame(step);
 } else {
 rafRef.current = null;
 setAnimating(false);
 setAnimClose(null);
 }
 };
 rafRef.current = requestAnimationFrame(step);
 }, [animating, openV, closeV]);

 const handleReset = useCallback(() => {
 cancelAnim();
 setOpenV(50);
 setHighV(70);
 setLowV(30);
 setCloseV(60);
 }, [cancelAnim]);

 const applyPreset = useCallback(
 (p: CandlePattern) => {
 cancelAnim();
 setOpenV(p.preset.o);
 setHighV(p.preset.h);
 setLowV(p.preset.l);
 setCloseV(p.preset.c);
 },
 [cancelAnim],
 );

 // Cleanup on unmount.
 useEffect(() => {
 return () => {
 if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
 };
 }, []);

 return (
 <Card dir="rtl" className="w-full">
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-lg">
 <CandlestickChart className="size-5 text-primary" />
 محاكي الشموع اليابانية التفاعلي
 </CardTitle>
 <CardDescription>
 حرّك المؤشرات لبناء شمعة OHLC خاصّة بك، وسيكتشف المحرّك تلقائياً اسم النمط
 ونوعه وموثوقيّته وسيكولوجيته واحتمالاته الصعودية/الهبوطية.
 </CardDescription>
 </CardHeader>

 <CardContent className="space-y-6">
 {/* Main builder grid: sliders (left) + SVG (right) */}
 <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
 {/* Left: sliders */}
 <div className="space-y-5">
 <SliderRow label="الافتتاح (Open)" value={openV} onChange={handleOpen} color="#0ea5e9" />
 <SliderRow label="الأعلى (High)" value={effHigh} onChange={handleHigh} color="#6366f1" />
 <SliderRow label="الأدنى (Low)" value={effLow} onChange={handleLow} color="#a855f7" />
 <SliderRow label="الإغلاق (Close)" value={closeV} onChange={handleClose} color={closeV >= openV ? '#10b981' : '#ef4444'} />

 <Separator />

 <div className="flex flex-wrap gap-2">
 <Button onClick={handleAnimate} disabled={animating} className="gap-2">
 <Play className="size-4" />
 {animating ? 'جارِ التشكيل…' : 'تشكيل الشمعة'}
 </Button>
 <Button onClick={handleReset} variant="outline" className="gap-2">
 <RotateCcw className="size-4" />
 إعادة الضبط
 </Button>
 </div>

 <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
 <Lightbulb className="mb-1 inline size-3.5 text-warning" />
 {' '}
 القيد: يجب أن يكون <strong>الأعلى ≥ الافتتاح والإغلاق</strong>، و
 <strong> الأدنى ≤ الافتتاح والإغلاق</strong>. عند مخالفة ذلك يُضبط
 تلقائياً.
 </div>
 </div>

 {/* Right: live SVG candle */}
 <div className="flex flex-col items-center justify-center rounded-lg border from-background p-4">
 <CandleSvg o={openV} h={effHigh} l={effLow} c={effClose} />
 <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
 <span className="inline-flex items-center gap-1 rounded-md bg-profit/15 px-2 py-0.5 text-profit ">
 <span className="inline-block size-2 rounded-sm bg-profit" />
 جسم أخضر = سيطرة المشتري
 </span>
 <span className="inline-flex items-center gap-1 rounded-md bg-loss/15 px-2 py-0.5 text-loss ">
 <span className="inline-block size-2 rounded-sm bg-loss" />
 جسم أحمر = سيطرة البائع
 </span>
 </div>
 </div>
 </div>

 <Separator />

 {/* Matched patterns */}
 <div className="space-y-3">
 <div className="flex items-center gap-2">
 <BookOpen className="size-4 text-primary" />
 <h3 className="text-sm font-semibold">
 الأنماط المُكتشَفة ({matchedPatterns.length})
 </h3>
 </div>

 {matchedPatterns.length === 0 ? (
 <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
 لا يوجد نمط كلاسيكي مطابق لهذه الشمعة. جرّب تحريك المؤشرات أو اختر
 نمطاً من المعرض بالأسفل.
 </div>
 ) : (
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 {matchedPatterns.map((p) => {
 const tm = TYPE_META[p.type];
 const rm = RELIABILITY_META[p.reliability];
 const TypeIcon = tm.icon;
 return (
 <Card key={p.name} className="gap-3 py-4">
 <CardHeader className="pb-0">
 <CardTitle className="flex items-center justify-between gap-2 text-base">
 <span className="flex items-center gap-2">
 <span className="text-xl">{p.emoji}</span>
 <span>{p.nameAr}</span>
 </span>
 <span className="text-xs font-normal text-muted-foreground">
 {p.name}
 </span>
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="flex flex-wrap gap-1.5">
 <Badge variant="outline" className={`gap-1 ${tm.className}`}>
 <TypeIcon className="size-3" />
 {tm.label}
 </Badge>
 <Badge variant="outline" className={rm.className}>
 {rm.label}
 </Badge>
 </div>

 <p className="text-xs leading-relaxed text-muted-foreground">
 {p.description}
 </p>

 <div>
 <div className="mb-1 text-xs font-medium text-muted-foreground">
 احتمالات الحركة المتوقّعة
 </div>
 <ProbabilityBar pattern={p} />
 </div>
 </CardContent>
 </Card>
 );
 })}
 </div>
 )}
 </div>

 <Separator />

 {/* Pattern gallery (collapsible) */}
 <Collapsible open={galleryOpen} onOpenChange={setGalleryOpen}>
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <CandlestickChart className="size-4 text-primary" />
 <h3 className="text-sm font-semibold">
 معرض الأنماط ({CANDLE_PATTERNS.length})
 </h3>
 </div>
 <CollapsibleTrigger asChild>
 <Button variant="ghost" size="sm" className="gap-1">
 {galleryOpen ? 'إخفاء' : 'عرض'}
 <ChevronDown
 className={`size-4 transition-transform ${galleryOpen ? 'rotate-180' : ''}`}
 />
 </Button>
 </CollapsibleTrigger>
 </div>

 <CollapsibleContent className="mt-3">
 <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
 {CANDLE_PATTERNS.map((p) => {
 const tm = TYPE_META[p.type];
 const TypeIcon = tm.icon;
 return (
 <button
 key={p.name}
 type="button"
 onClick={() => applyPreset(p)}
 className="group flex flex-col items-start gap-1.5 rounded-lg border bg-card p-3 text-right transition-all hover:border-primary hover:shadow-sm"
 >
 <div className="flex w-full items-center justify-between">
 <span className="text-2xl">{p.emoji}</span>
 <TypeIcon className={`size-4 ${tm.className.split(' ').find((c) => c.startsWith('text')) ?? ''}`} />
 </div>
 <div className="text-sm font-semibold leading-tight">{p.nameAr}</div>
 <div className="text-xs text-muted-foreground">{p.name}</div>
 <Badge variant="outline" className={`mt-0.5 text-xs ${tm.className}`}>
 {tm.label}
 </Badge>
 </button>
 );
 })}
 </div>
 <p className="mt-2 text-xs text-muted-foreground">
 اضغط على أي نمط لتحميل قيم OHLC النموذجية في المؤشرات.
 </p>
 </CollapsibleContent>
 </Collapsible>

 <Separator />

 {/* Educational footer */}
 <div className="rounded-lg border bg-muted/30 p-4">
 <div className="mb-2 flex items-center gap-2">
 <Lightbulb className="size-4 text-warning" />
 <h4 className="text-sm font-semibold">السيكولوجيا خلف الشموع</h4>
 </div>
 <p className="text-xs leading-relaxed text-muted-foreground">
 الشموع اليابانية تعكس صراع المشتري والبائع خلال الجلسة. الجسم الأخضر
 يعني أن المشتري سيطر، والأحمر يعني أن البائع سيطر. الفتيل العلوي يُظهر
 رفض السعر للأعلى، والسفلي يُظهر رفض السعر للأسفل.
 </p>
 </div>
 </CardContent>
 </Card>
 );
}

export default CandlestickSimulator;
