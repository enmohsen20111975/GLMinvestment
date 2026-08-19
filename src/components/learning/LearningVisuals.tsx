'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Lightbulb, AlertTriangle, Key, BookOpen, CheckCircle2, XCircle, TrendingUp, TrendingDown } from 'lucide-react';
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
    { company: 'البنك التجاري الدولي', price: 132, eps: 15, pe: 8.8, status: 'رخيص', color: 'text-emerald-600' },
    { company: 'أوراسكوم للتنمية', price: 734, eps: 25, pe: 29.4, status: 'مكلف', color: 'text-red-600' },
    { company: 'اتصالات مصر', price: 94, eps: 6.5, pe: 14.5, status: 'معقول', color: 'text-amber-600' },
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
    { time: '9:00', label: 'الجلسة الاستباقية', desc: 'إدخال الأوامر', color: 'bg-blue-500', active: false },
    { time: '9:45', label: 'فتح التداول', desc: 'بداية التنفيذ', color: 'bg-emerald-500', active: true },
    { time: '10:00', label: 'الجلسة الرئيسية', desc: 'أعلى سيولة', color: 'bg-emerald-600', active: true },
    { time: '14:30', label: 'إغلاق التداول', desc: 'نهاية الجلسة', color: 'bg-orange-500', active: false },
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
                <p className="text-[10px] text-muted-foreground">{s.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      <div className="mt-4 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <p className="text-xs text-amber-700 dark:text-amber-400 text-center">
          ⚠️ أعلى تقلبات: أول 30 دقيقة وآخر 30 دقيقة - ينصح المبتدئون بتجنبها
        </p>
      </div>
    </div>
  );
}

/* ── 4. Portfolio Diversification (تنويع المحفظة) ── */
export function PortfolioDiversification() {
  const allocations = [
    { sector: 'البنوك', percent: 30, color: 'bg-emerald-500' },
    { sector: 'العقارات', percent: 25, color: 'bg-blue-500' },
    { sector: 'الاتصالات', percent: 20, color: 'bg-purple-500' },
    { sector: 'الصناعة', percent: 15, color: 'bg-amber-500' },
    { sector: 'نقدية', percent: 10, color: 'bg-gray-400' },
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
    { level: 'عالي المخاطر', desc: '10% - مضاربات و أسهم صغيرة', color: 'bg-red-500', width: 'w-1/4' },
    { level: 'متوسط المخاطر', desc: '30% - أسهم نمو و تحليل فني', color: 'bg-amber-500', width: 'w-1/2' },
    { level: 'منخفض المخاطر', desc: '60% - أسهم قيمة و توزيعات أرباح', color: 'bg-emerald-500', width: 'w-3/4' },
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
            <p className="text-[10px]">{l.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ── 6. Callout Box (صناديق ملاحظات) ── */
export function CalloutBox({ type, title, children }: { type: 'tip' | 'warning' | 'key' | 'example'; title: string; children: React.ReactNode }) {
  const config = {
    tip: { icon: Lightbulb, color: 'border-blue-500/30 bg-blue-500/5', iconColor: 'text-blue-500', titleColor: 'text-blue-700 dark:text-blue-400' },
    warning: { icon: AlertTriangle, color: 'border-amber-500/30 bg-amber-500/5', iconColor: 'text-amber-500', titleColor: 'text-amber-700 dark:text-amber-400' },
    key: { icon: Key, color: 'border-emerald-500/30 bg-emerald-500/5', iconColor: 'text-emerald-500', titleColor: 'text-emerald-700 dark:text-emerald-400' },
    example: { icon: BookOpen, color: 'border-purple-500/30 bg-purple-500/5', iconColor: 'text-purple-500', titleColor: 'text-purple-700 dark:text-purple-400' },
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
      className="my-4 rounded-xl border border-purple-500/30 bg-purple-500/5 overflow-hidden"
    >
      <div className="bg-purple-500/10 px-4 py-2 border-b border-purple-500/20">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-purple-500" />
          <h4 className="font-bold text-sm text-purple-700 dark:text-purple-400">مثال عملي: {title}</h4>
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
        <div className="flex items-start gap-2 p-2 rounded bg-emerald-500/10">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">النتيجة:</p>
            <p className="text-sm">{result}</p>
          </div>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-blue-500/10">
          <Lightbulb className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">الدرس المستفاد:</p>
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
  const zone = value >= 70 ? { label: 'تشبع شرائي', color: 'text-red-500' } :
               value <= 30 ? { label: 'تشبع بيعي', color: 'text-emerald-500' } :
               { label: 'منطقة محايدة', color: 'text-amber-500' };

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
          <span className="text-emerald-600">تشبع بيعي (≤30)</span>
          <span className="text-amber-600">محايد (30-70)</span>
          <span className="text-red-600">تشبع شرائي (≥70)</span>
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
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500" /> MACD</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500" /> خط الإشارة</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-500/50" /> الهيستوجرام</span>
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
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500" /> MA 5 (سريع)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500" /> MA 10 (بطيء)</span>
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
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500" /> السعر</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-gray-500" /> المتوسط (SMA20)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500" /> النطاق العلوي</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500" /> النطاق السفلي</span>
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
          className="flex-1 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center"
        >
          <p className="text-xs font-bold text-emerald-600 mb-1">1. تقدير التدفقات</p>
          <p className="text-[10px]">النقدية المتوقعة لـ 5 سنوات</p>
        </motion.div>
        <span className="text-emerald-500 text-center rotate-90 sm:rotate-0">←</span>
        {/* Step 2 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="flex-1 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-center"
        >
          <p className="text-xs font-bold text-blue-600 mb-1">2. معدل الخصم</p>
          <p className="text-[10px]">خصم للتضخم والمخاطر</p>
        </motion.div>
        <span className="text-blue-500 text-center rotate-90 sm:rotate-0">←</span>
        {/* Step 3 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="flex-1 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-center"
        >
          <p className="text-xs font-bold text-amber-600 mb-1">3. القيمة الطرفية</p>
          <p className="text-[10px]">قيمة ما بعد 5 سنوات</p>
        </motion.div>
        <span className="text-amber-500 text-center rotate-90 sm:rotate-0">←</span>
        {/* Step 4 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
          className="flex-1 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 text-center"
        >
          <p className="text-xs font-bold text-purple-600 mb-1">4. القيمة العادلة</p>
          <p className="text-[10px]">مجموع القيم الحالية</p>
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
          className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center"
        >
          <p className="text-xs font-bold text-emerald-600">هامش الربح</p>
          <p className="text-[10px] text-muted-foreground mb-1">صافي الربح ÷ الإيرادات</p>
          <p className="text-lg font-bold">15%</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}
          className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-center"
        >
          <p className="text-xs font-bold text-blue-600">دوران الأصول</p>
          <p className="text-[10px] text-muted-foreground mb-1">الإيرادات ÷ الأصول</p>
          <p className="text-lg font-bold">1.2x</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }}
          className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-center"
        >
          <p className="text-xs font-bold text-amber-600">الرافعة المالية</p>
          <p className="text-[10px] text-muted-foreground mb-1">الأصول ÷ حقوق الملكية</p>
          <p className="text-lg font-bold">2.0x</p>
        </motion.div>
      </div>
      <div className="mt-3 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 text-center">
        <p className="text-xs font-bold text-purple-600 mb-1">ROE = هامش الربح × دوران الأصول × الرافعة</p>
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
    { phase: 'التفاؤل', color: 'bg-emerald-500', icon: '😊' },
    { phase: 'الحماس', color: 'bg-teal-500', icon: '🤩' },
    { phase: 'النشوة', color: 'bg-blue-500', icon: '🤑' },
    { phase: 'القلق', color: 'bg-amber-500', icon: '😰' },
    { phase: 'الإنكار', color: 'bg-orange-500', icon: '😨' },
    { phase: 'الذعر', color: 'bg-red-500', icon: '😱' },
    { phase: 'الاستسلام', color: 'bg-gray-500', icon: '😞' },
    { phase: 'الاكتئاب', color: 'bg-gray-700', icon: '😔' },
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
            <span className="font-bold text-emerald-600">أسهم: {m.shares.toFixed(2)}</span>
          </motion.div>
        ))}
      </div>
      <div className="mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
        <div className="flex justify-between text-sm">
          <span>إجمالي الاستثمار:</span>
          <span className="font-bold">{totalInvest} ج.م</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>إجمالي الأسهم:</span>
          <span className="font-bold">{totalShares.toFixed(2)} سهم</span>
        </div>
        <div className="flex justify-between text-sm font-bold text-emerald-700 dark:text-emerald-400">
          <span>متوسط السعر:</span>
          <span>{avgPrice.toFixed(2)} ج.م</span>
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
