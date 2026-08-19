'use client';

/**
 * MaestroLogicFlow — مخطط منطق المايسترو (Logic / Process Diagram)
 * ====================================================================
 * يحوّل "مركز قيادة المايسترو" من رسم هندسي (topology) إلى مخطط منطقي
 * يوضّح عملية اتخاذ القرار الفعلية: عملية ← اختبار (نعم/لا) ← تنفيذ.
 *
 * المصدر المرجعي للمنطق:
 *   - src/lib/honest-tracking/maestro.ts → deriveSignal() (Path 1..5 + persona)
 *   - src/lib/dynamic-analysis-engine.ts → detectBBSqueeze / getAdaptiveWeights
 *   - vps-service/analyzers/maestro_orchestrator.py → calculate_personas / gather_context
 *   - vps-service/api/stored_analysis_routes.py → P16 persona divergence filter
 *   - vps-service/analyzers/background_analyzer.py → is_gambler/investor_opportunity
 *
 * التصميم:
 *   - تدفّق رأسي (top → bottom) RTL
 *   - صناديق عملية (Process) — مستطيلات رمادية
 *   - ماسحات قرار (Decision) — مع علامة ◆ ولون كهرماني + فرعَي "نعم/لا"
 *   - محطات نهاية (Terminal) — كبسولات ملوّنة (BUY/SELL/HOLD + personas)
 *   - مسار تفاعلي: الضغط على نتيجة يُبرز كل الخطوات المؤدية إليها
 *   - نظام السوق الحي يُجلب من /api/maestro/overview ويُبرز الفرع النشط
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowDown, ArrowLeft, Check, X, Zap, Shield, Scale,
  TrendingUp, TrendingDown, Pause, Database, Brain, Target,
  Activity, Gauge, Layers, GitBranch, Sparkles, Info,
  RefreshCw, Loader2, CircleDot, Wand2, LayoutDashboard, Workflow,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MaestroLiveLogicPanel } from './MaestroLiveLogicPanel';

// ==================== أنواع العقد ====================

type NodeKind = 'start' | 'process' | 'decision' | 'terminal' | 'outcome';
type Tone = 'neutral' | 'bull' | 'bear' | 'wait' | 'gambler' | 'investor' | 'balanced' | 'info';

interface FlowNode {
  id: string;
  kind: NodeKind;
  tone: Tone;
  title: string;
  /** سطر أو أكثر من التفاصيل التقنية */
  detail?: string[];
  /** أيقونة lucide */
  icon: React.ComponentType<{ className?: string }>;
  /** للقرارات فقط: نص فرع "نعم" والنتيجة المرتبطة به */
  yes?: { label: string; leadsTo?: string; tone?: Tone };
  /** للقرارات فقط: نص فرع "لا" (يُكمل التدفّق للأسفل) */
  no?: { label: string };
  /** مُعرّفات الخطوات المؤدية لهذه النتيجة (لإبراز المسار) */
  pathFrom?: string[];
  /** كود مرجعي */
  ref?: string;
}

// ==================== لوحة الألوان ====================

const TONE_STYLES: Record<Tone, { ring: string; bg: string; text: string; border: string; dot: string }> = {
  neutral: { ring: 'ring-slate-400/40', bg: 'bg-slate-500/5', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-300 dark:border-slate-700', dot: 'bg-slate-400' },
  bull: { ring: 'ring-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-400/60 dark:border-emerald-600/60', dot: 'bg-emerald-500' },
  bear: { ring: 'ring-rose-500/40', bg: 'bg-rose-500/10', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-400/60 dark:border-rose-600/60', dot: 'bg-rose-500' },
  wait: { ring: 'ring-amber-500/40', bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-400/60 dark:border-amber-600/60', dot: 'bg-amber-500' },
  gambler: { ring: 'ring-fuchsia-500/40', bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-700 dark:text-fuchsia-300', border: 'border-fuchsia-400/60 dark:border-fuchsia-600/60', dot: 'bg-fuchsia-500' },
  investor: { ring: 'ring-sky-500/40', bg: 'bg-sky-500/10', text: 'text-sky-700 dark:text-sky-300', border: 'border-sky-400/60 dark:border-sky-600/60', dot: 'bg-sky-500' },
  balanced: { ring: 'ring-violet-500/40', bg: 'bg-violet-500/10', text: 'text-violet-700 dark:text-violet-300', border: 'border-violet-400/60 dark:border-violet-600/60', dot: 'bg-violet-500' },
  info: { ring: 'ring-cyan-500/40', bg: 'bg-cyan-500/10', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-400/60 dark:border-cyan-600/60', dot: 'bg-cyan-500' },
};

// ==================== تعريف التدفّق الكامل ====================
// مرتّب من الأعلى للأسفل. كل قرار له فرع "نعم" (جانبي → نتيجة) وفرع "لا" (يُكمل للأسفل).

const FLOW: FlowNode[] = [
  // ---- المرحلة 1: جمع السياق ----
  {
    id: 'start',
    kind: 'start',
    tone: 'info',
    title: 'طلب تحليل سهم 📥',
    detail: ['نقطة الدخول: سهم + سوق (EGX/Crypto)', 'يبدأ المحلّل (orchestrator) دورة التحليل'],
    icon: CircleDot,
  },
  {
    id: 'gather',
    kind: 'process',
    tone: 'neutral',
    title: 'اجمع السياق الكامل',
    detail: [
      'السياق الزمني: السعر الحالي، أعلى/أدنى 52 أسبوع، تغيّر 1أ/1ش/3ش/1س',
      'سياق القطاع: أداء القطاع مقابل السهم',
      'السياق السلوكي: volume_ratio، حكم السيولة',
      'سياق السوق: قيمة وتغيّر EGX30',
    ],
    icon: Database,
    ref: 'gather_context() — maestro_orchestrator.py:289',
  },
  {
    id: 'regime',
    kind: 'decision',
    tone: 'wait',
    title: 'ما نظام السوق (EGX30)؟',
    detail: ['يُحدَّد من تغيّر EGX30:', '> +10% → صاعد', '< −10% → هابط', 'بينهما → متراوح'],
    icon: Gauge,
    yes: { label: 'صاعد 🐂', tone: 'bull' },
    no: { label: 'متراوح/هابط' },
    ref: 'market_context.regime — maestro_orchestrator.py:388',
  },
  // ---- المرحلة 2: المؤشرات والدرجات ----
  {
    id: 'indicators',
    kind: 'process',
    tone: 'neutral',
    title: 'احسب المؤشرات الفنية',
    detail: [
      'RSI, MA20, MA50, ATR, عرض بولنجر',
      'نماذج الشموع اليابانية (HAMMER/ENGULFING…)',
      'الدعم/المقاومة، اتجاه الحجم (increasing/spike/decreasing)',
      'كشف انضغاط بولنجر (BB Squeeze)',
    ],
    icon: Activity,
    ref: 'computeIndicators() + detectBBSqueeze()',
  },
  {
    id: 'techscore',
    kind: 'process',
    tone: 'neutral',
    title: 'احسب الدرجة الفنية (تبدأ من 50)',
    detail: [
      'اتجاه صاعد +15 / هابط −15',
      'RSI تشبع بيعي +12 / شرائي −12 / محايد +4',
      'شمعة صاعدة +8 / هابطة −8',
      'حجم متزايد +5 / طفرة +7 / متناقص −3',
      'قرب الدعم +8 / المقاومة −6',
      'انضغاط بولنجر +10 (مع حجم/زخم)',
    ],
    icon: Layers,
    ref: 'deriveSignal() — maestro.ts:656',
  },
  {
    id: 'master',
    kind: 'process',
    tone: 'info',
    title: 'احسب Master Score',
    detail: [
      'Master = فني × 60% + أساسي × 30% + نظام × 10%',
      'درجة موحّدة (0–100) تجمع كل المحاور',
    ],
    icon: Gauge,
    ref: 'maestro.ts:715',
  },
  // ---- المرحلة 3: شجرة قرار الإشارة (5 مسارات) ----
  {
    id: 'path1',
    kind: 'decision',
    tone: 'wait',
    title: 'Path 1 — اتجاه + تأكيد؟',
    detail: [
      'صاعد + (شمعة صاعدة | RSI<45 | حجم متزايد) وغير مشبع شرائياً → BUY',
      'هابط + (شمعة هابطة | RSI>55 | حجم متزايد) وغير مشبع بيعياً → SELL',
    ],
    icon: GitBranch,
    yes: { label: 'نعم → إشارة', tone: 'bull' },
    no: { label: 'لا → المسار التالي' },
    ref: 'maestro.ts:729',
  },
  {
    id: 'path2',
    kind: 'decision',
    tone: 'wait',
    title: 'Path 2 — RSI متطرف (ارتداد)؟',
    detail: [
      'تشبع بيعي + ليس هابطاً → BUY (ارتداد)',
      'تشبع شرائي + ليس صاعداً → SELL',
    ],
    icon: GitBranch,
    yes: { label: 'نعم → إشارة', tone: 'bull' },
    no: { label: 'لا → المسار التالي' },
    ref: 'maestro.ts:735',
  },
  {
    id: 'path3',
    kind: 'decision',
    tone: 'wait',
    title: 'Path 3 — شمعة قوية عند دعم/مقاومة؟',
    detail: [
      'شمعة صاعدة عند الدعم (<5%) → BUY',
      'شمعة هابطة عند المقاومة (<5%) → SELL',
    ],
    icon: GitBranch,
    yes: { label: 'نعم → إشارة', tone: 'bull' },
    no: { label: 'لا → المسار التالي' },
    ref: 'maestro.ts:743',
  },
  {
    id: 'path4',
    kind: 'decision',
    tone: 'wait',
    title: 'Path 4 — Master Score حاسم؟',
    detail: ['Master ≥ 65 + صاعد → BUY', 'Master ≤ 35 + هابط → SELL'],
    icon: GitBranch,
    yes: { label: 'نعم → إشارة', tone: 'bull' },
    no: { label: 'لا → المسار التالي' },
    ref: 'maestro.ts:751',
  },
  {
    id: 'path5',
    kind: 'decision',
    tone: 'wait',
    title: 'Path 5 — انضغاط بولنجر + حجم + اتجاه؟',
    detail: [
      'انضغاط + طفرة حجم + صاعد (غير مشبع) → BUY',
      'انضغاط + طفرة حجم + هابط (غير مشبع) → SELL',
      ' otherwise → HOLD',
    ],
    icon: GitBranch,
    yes: { label: 'نعم → إشارة', tone: 'bull' },
    no: { label: 'لا' },
    ref: 'maestro.ts:757',
  },
  // ---- محطة HOLD ----
  {
    id: 'hold',
    kind: 'terminal',
    tone: 'wait',
    title: 'HOLD — انتظار ⏸️',
    detail: ['لا توجد إشارة كافية من أي مسار', 'يُنصح بالانتظار حتى تتضح الإشارات'],
    icon: Pause,
    pathFrom: ['path1', 'path2', 'path3', 'path4', 'path5'],
  },
  // ---- المرحلة 4: تصنيف البرسونا (لو الإشارة ≠ HOLD) ----
  {
    id: 'persona',
    kind: 'decision',
    tone: 'info',
    title: 'تصنيف البرسونا (لو الإشارة ≠ HOLD)',
    detail: ['يُحدِّد جمهور التوصية المناسب لكل سهم'],
    icon: Wand2,
    yes: { label: 'Master≥75 و أساسي≥60', tone: 'investor' },
    no: { label: 'تحقّق من المضارب' },
    ref: 'maestro.ts:769',
  },
  // ---- النتائج (Personas) ----
  {
    id: 'gambler',
    kind: 'terminal',
    tone: 'gambler',
    title: '⚡ GAMBLER — مضارب',
    detail: ['Master ≥ 65 + (طفرة حجم | شمعة صاعدة)', 'سهم فيه زخم/تذبذب عالٍ'],
    icon: Zap,
    pathFrom: ['persona'],
  },
  {
    id: 'investor',
    kind: 'terminal',
    tone: 'investor',
    title: '🛡️ INVESTOR — مستثمر',
    detail: ['Master ≥ 75 و الأساسي ≥ 60', 'سهم أساسياته قوية وقرب القيمة العادلة'],
    icon: Shield,
    pathFrom: ['persona'],
  },
  {
    id: 'balanced',
    kind: 'terminal',
    tone: 'balanced',
    title: '⚖️ BALANCED — متوازن',
    detail: ['لا يحقّق شروط المضارب ولا المستثمر بحدّة', 'توصية عامة لكل الجمهور'],
    icon: Scale,
    pathFrom: ['persona'],
  },
  // ---- المرحلة 5: P16 — توزيع البرسونا (فصل جذري) ----
  {
    id: 'p16',
    kind: 'process',
    tone: 'info',
    title: 'P16 — توزيع البرسونا (فصل جذري للأسهم)',
    detail: [
      '🎰 مضارب: volume_ratio ≥ 1.5 و |change_1d| ≥ 2% — مرتب حسب الزخم/التذبذب',
      '🏦 مستثمر: pe_ratio بين 5–20 و roe ≥ 10 و change_1m بين −5%..+10% — مرتب حسب fair_value_upside',
      'كل 15 دقيقة: is_gambler_opportunity / is_investor_opportunity يُحسبان باستقلال',
      'البرسونا بقت تشوف أسهم مختلفة من الأساس — مش نفس القائمة بتغيير الإشارة فقط',
    ],
    icon: Sparkles,
    ref: 'stored_analysis_routes.py + background_analyzer.py (P16)',
  },
  // ---- المخرجات النهائية ----
  {
    id: 'output',
    kind: 'terminal',
    tone: 'bull',
    title: 'المخرجات النهائية 🎯',
    detail: [
      'الإشارة (BUY/SELL/HOLD) + Master Score + الثقة',
      'الهدف (ATR أو هيكلي) + وقف الخسارة',
      'الأسباب (reasons) بالعربية + البرسونا',
      'تُخزَّن في stored_analyses وتُقدَّم لكل persona قائمتها المستقلة',
    ],
    icon: Target,
  },
];

// خريطة المسارات: لكل نتيجة، أي الخطوات تؤدي إليها (للإبراز التفاعلي)
const OUTCOME_PATHS: Record<string, string[]> = {
  hold: ['start', 'gather', 'regime', 'indicators', 'techscore', 'master', 'path1', 'path2', 'path3', 'path4', 'path5', 'hold'],
  gambler: ['start', 'gather', 'regime', 'indicators', 'techscore', 'master', 'path1', 'persona', 'gambler'],
  investor: ['start', 'gather', 'regime', 'indicators', 'techscore', 'master', 'path1', 'persona', 'investor'],
  balanced: ['start', 'gather', 'regime', 'indicators', 'techscore', 'master', 'path1', 'persona', 'balanced'],
  output: ['start', 'gather', 'regime', 'indicators', 'techscore', 'master', 'path1', 'persona', 'p16', 'output'],
};

// ==================== مكوّنات العقد ====================

function NodeIcon({ node, active }: { node: FlowNode; active: boolean }) {
  const Icon = node.icon;
  const t = TONE_STYLES[node.tone];
  return (
    <div className={cn('flex items-center justify-center rounded-lg w-9 h-9 shrink-0 ring-1', t.bg, t.ring, active && 'scale-110 transition-transform')}>
      <Icon className={cn('w-4.5 h-4.5', t.text)} />
    </div>
  );
}

function FlowNodeCard({
  node,
  active,
  dimmed,
  onSelect,
}: {
  node: FlowNode;
  active: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
}) {
  const t = TONE_STYLES[node.tone];
  const isDecision = node.kind === 'decision';
  const isTerminal = node.kind === 'terminal' || node.kind === 'outcome';
  const isStart = node.kind === 'start';

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={cn(
        'group relative w-full text-right transition-all duration-200 rounded-xl border p-3 sm:p-4',
        'hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        t.bg, t.border,
        active && cn('ring-2 shadow-lg scale-[1.015]', t.ring),
        dimmed && 'opacity-35 hover:opacity-70',
        isStart && 'rounded-full',
        isTerminal && 'rounded-full font-semibold',
      )}
    >
      <div className="flex items-start gap-3">
        <NodeIcon node={node} active={active} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isDecision && (
              <span className={cn('inline-flex items-center justify-center w-5 h-5 rotate-45 rounded-[3px] border', t.border, t.bg)} title="قرار">
                <span className={cn('-rotate-45 text-[9px] font-bold', t.text)}>؟</span>
              </span>
            )}
            <h4 className={cn('text-sm sm:text-[15px] font-bold leading-tight', t.text)}>{node.title}</h4>
          </div>
          {node.detail && node.detail.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[11px] sm:text-xs leading-relaxed text-muted-foreground">
              {node.detail.map((d, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className={cn('mt-1 inline-block w-1 h-1 rounded-full shrink-0', t.dot)} />
                  <span className="break-words">{d}</span>
                </li>
              ))}
            </ul>
          )}
          {node.ref && (
            <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/70 bg-background/60 rounded px-1.5 py-0.5">
              <Info className="w-2.5 h-2.5" />
              {node.ref}
            </div>
          )}
        </div>
      </div>

      {/* فروع القرار */}
      {isDecision && node.yes && (
        <div className="mt-3 flex items-stretch gap-2">
          <div className={cn('flex-1 rounded-lg border px-2 py-1.5 flex items-center gap-1.5', TONE_STYLES[node.yes.tone || 'bull'].border, TONE_STYLES[node.yes.tone || 'bull'].bg)}>
            <Check className={cn('w-3.5 h-3.5 shrink-0', TONE_STYLES[node.yes.tone || 'bull'].text)} />
            <span className={cn('text-[11px] font-semibold', TONE_STYLES[node.yes.tone || 'bull'].text)}>{node.yes.label}</span>
          </div>
          {node.no && (
            <div className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-500/5 px-2 py-1.5 flex items-center gap-1.5">
              <X className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground">{node.no.label}</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

// سهم رأسي يربط بين عقدتين
function Connector({ label, tone = 'neutral', active }: { label?: string; tone?: Tone; active?: boolean }) {
  const t = TONE_STYLES[tone];
  return (
    <div className="flex items-center justify-center gap-1.5 my-0.5 select-none">
      {label && (
        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-background border', t.border, t.text)}>{label}</span>
      )}
      <ArrowDown className={cn('w-3.5 h-3.5', active ? t.text : 'text-muted-foreground/60', active && 'animate-pulse')} />
    </div>
  );
}

// ==================== المكوّن الرئيسي ====================

export function MaestroLogicFlow() {
  const [selected, setSelected] = useState<string | null>(null);
  const [regime, setRegime] = useState<string | null>(null);
  const [regimeConfidence, setRegimeConfidence] = useState<number | null>(null);
  const [loadingRegime, setLoadingRegime] = useState(false);
  // واجهة العرض: 'live' = اللوحة الحية الكاملة، 'flow' = التدفّق المنطقي التفصيلي، 'both' = الاثنان معاً
  const [view, setView] = useState<'live' | 'flow' | 'both'>('live');

  // جلب نظام السوق الحي من الـ backend
  const fetchRegime = useCallback(async () => {
    setLoadingRegime(true);
    try {
      const res = await fetch('/api/maestro/overview', { cache: 'no-store' });
      const data = await res.json();
      if (data?.success && data?.data) {
        const r = data.data.marketRegime;
        const label = r === 'bull' ? 'BULL' : r === 'bear' ? 'BEAR' : 'SIDEWAYS';
        setRegime(label);
        setRegimeConfidence(data.data.regimeConfidence ?? null);
      }
    } catch {
      // الواجهة تعمل بدون بيانات حية — الإبراز يبقى تفاعلياً
    } finally {
      setLoadingRegime(false);
    }
  }, []);

  useEffect(() => {
    fetchRegime();
  }, [fetchRegime]);

  // المسار النشط لإبرازه
  const activePath = useMemo(() => {
    if (!selected) return null;
    if (OUTCOME_PATHS[selected]) return new Set(OUTCOME_PATHS[selected]);
    // لو العنصر المختار ليس نتيجة طرفية، أبرزه هو فقط + المسارات المؤدية إليه
    const set = new Set<string>();
    set.add(selected);
    // أبرز كل الخطوات قبلها (من start حتى هذا العنصر)
    const idx = FLOW.findIndex((n) => n.id === selected);
    if (idx >= 0) for (let i = 0; i <= idx; i++) set.add(FLOW[i].id);
    return set;
  }, [selected]);

  const handleSelect = (id: string) => {
    setSelected((prev) => (prev === id ? null : id));
  };

  const outcomes = FLOW.filter((n) => n.kind === 'terminal');

  // خرائط الربط بين العقد لرسم الأسهم
  const nextOf = (id: string): string | null => {
    const idx = FLOW.findIndex((n) => n.id === id);
    if (idx < 0 || idx >= FLOW.length - 1) return null;
    return FLOW[idx + 1].id;
  };

  // نظام السوق الحي يُبرز فرع regime
  const regimeActiveTone: Tone = regime === 'BULL' ? 'bull' : regime === 'BEAR' ? 'bear' : 'wait';

  return (
    <div className="space-y-4">
      {/* الترويسة + مبدّل الواجهة */}
      <Card className="overflow-hidden">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/30 w-11 h-11 shrink-0">
                <Brain className="w-5.5 h-5.5 text-primary" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold leading-tight">مخطط منطق المايسترو</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  لوحة حية + مخطط منطقي تفصيلي — مرتبط بالكود الفعلي للمحرّك وبيانات stored_analyses.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* مبدّل الواجهة */}
              <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
                {([
                  { id: 'live', label: 'اللوحة الحية', icon: LayoutDashboard },
                  { id: 'flow', label: 'التدفّق المنطقي', icon: Workflow },
                  { id: 'both', label: 'الاثنان', icon: Layers },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setView(opt.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all',
                      view === opt.id
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <opt.icon className="w-3.5 h-3.5" />
                    {opt.label}
                  </button>
                ))}
              </div>
              <Badge variant="outline" className="gap-1 text-[11px]">
                <Activity className="w-3 h-3" />
                {loadingRegime ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : regime ? (
                  <span className={TONE_STYLES[regimeActiveTone].text}>
                    السوق: {regime === 'BULL' ? 'صاعد 🐂' : regime === 'BEAR' ? 'هابط 🐻' : 'متراوح ➡️'}
                    {regimeConfidence != null && ` (${regimeConfidence}%)`}
                  </span>
                ) : (
                  <span className="text-muted-foreground">السوق: —</span>
                )}
              </Badge>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={fetchRegime} disabled={loadingRegime}>
                <RefreshCw className={cn('w-3.5 h-3.5', loadingRegime && 'animate-spin')} />
                تحديث
              </Button>
              {selected && (
                <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={() => setSelected(null)}>
                  <X className="w-3.5 h-3.5" />
                  مسح التحديد
                </Button>
              )}
            </div>
          </div>

          {/* مفتاح الألوان — يظهر فقط في وضع التدفّق */}
          {view !== 'live' && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
              <span className="font-semibold">المفتاح:</span>
              <LegendDot tone="neutral" label="عملية" shape="rect" />
              <LegendDot tone="wait" label="قرار ◆" shape="diamond" />
              <LegendDot tone="bull" label="نتيجة شراء" shape="pill" />
              <LegendDot tone="bear" label="نتيجة بيع" shape="pill" />
              <LegendDot tone="gambler" label="مضارب" shape="pill" />
              <LegendDot tone="investor" label="مستثمر" shape="pill" />
              <span className="text-muted-foreground/70">— اضغط على أي نتيجة بالأسفل لإبراز مسارها الكامل</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* اللوحة الحية الكاملة — تظهر في وضع 'live' أو 'both' */}
      {view !== 'flow' && (
        <MaestroLiveLogicPanel />
      )}

      {/* التدفّق المنطقي التفصيلي — يظهر في وضع 'flow' أو 'both' */}
      {view !== 'live' && (
      <>
      {/* أزرار النتائج السريعة (إبراز المسار) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">إبراز مسار:</span>
        {outcomes.map((o) => {
          const t = TONE_STYLES[o.tone];
          const isSel = selected === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => handleSelect(o.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all',
                t.border, t.bg, t.text,
                isSel ? cn('ring-2 scale-105', t.ring) : 'hover:scale-105',
              )}
            >
              <o.icon className="w-3.5 h-3.5" />
              {o.title.split('—')[0].trim()}
            </button>
          );
        })}
      </div>

      {/* التدفّق الرأسي */}
      <div className="relative mx-auto max-w-2xl">
        {FLOW.map((node, idx) => {
          const isActive = activePath ? activePath.has(node.id) : false;
          const isDimmed = activePath ? !activePath.has(node.id) : false;
          const next = nextOf(node.id);
          // إبراز فرع نظام السوق الحي
          const isRegimeNode = node.id === 'regime';
          const showConnector = idx < FLOW.length - 1 && next;

          // اختيار لون السهم: لو نظام السوق حي والعقدة regime، أبرز بلون النظام
          let connTone: Tone = 'neutral';
          let connLabel: string | undefined;
          if (showConnector) {
            // لو العقدة الحالية قرار، السهم للأسفل هو فرع "لا"
            if (node.kind === 'decision' && node.no) {
              connLabel = node.no.label.includes('لا') ? 'لا' : undefined;
              connTone = 'neutral';
            }
            // إبراز خاص لنظام السوق
            if (isRegimeNode && regime) {
              connTone = regimeActiveTone;
              connLabel = regime === 'BULL' ? 'صاعد' : regime === 'BEAR' ? 'هابط' : 'متراوح';
            }
          }
          const connActive = isActive && activePath?.has(next || '');

          return (
            <React.Fragment key={node.id}>
              <FlowNodeCard
                node={node}
                active={isActive || (isRegimeNode && !!regime)}
                dimmed={isDimmed && !isRegimeNode}
                onSelect={handleSelect}
              />
              {showConnector && <Connector label={connLabel} tone={connTone} active={connActive} />}
            </React.Fragment>
          );
        })}
      </div>

      {/* لوحة المسار المُبرز */}
      {selected && activePath && (
        <Card className="border-primary/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="w-4 h-4 text-primary" />
              <h4 className="text-sm font-bold">المسار المُبرز</h4>
              <Badge variant="secondary" className="text-[10px]">{activePath.size} خطوة</Badge>
            </div>
            <ol className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {FLOW.filter((n) => activePath.has(n.id)).map((n, i, arr) => (
                <li key={n.id} className="flex items-center gap-1.5">
                  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', TONE_STYLES[n.tone].border, TONE_STYLES[n.tone].bg, TONE_STYLES[n.tone].text)}>
                    <n.icon className="w-3 h-3" />
                    {n.title.split('—')[0].split('📥')[0].split('🎯')[0].trim()}
                  </span>
                  {i < arr.length - 1 && <ArrowLeft className="w-3 h-3 text-muted-foreground/50" />}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* حاشية توضيحية */}
      <p className="text-[11px] text-muted-foreground/70 text-center px-4">
        هذا المخطط يعكس منطق الكود الفعلي في <code className="font-mono">deriveSignal()</code> و
        <code className="font-mono"> calculate_personas()</code> وفلتر <code className="font-mono">P16</code> —
        أي تعديل في الكود يجب أن يُعكس هنا.
      </p>
      </>
      )}
    </div>
  );
}

function LegendDot({ tone, label, shape }: { tone: Tone; label: string; shape: 'rect' | 'diamond' | 'pill' }) {
  const t = TONE_STYLES[tone];
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          'inline-block border',
          shape === 'rect' && 'w-3 h-2.5 rounded-sm',
          shape === 'diamond' && 'w-2.5 h-2.5 rotate-45 rounded-[1px]',
          shape === 'pill' && 'w-3.5 h-2 rounded-full',
          t.border, t.bg,
        )}
      />
      {label}
    </span>
  );
}

export default MaestroLogicFlow;
