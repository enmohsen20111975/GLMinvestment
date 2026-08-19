'use client';

/**
 * MaestroLiveLogicPanel — لوحة مخطط منطق المايسترو الحية
 * ====================================================================
 * مكوّن حي وقابل للتحكم ويعرض البيانات الفعلية، مبني على التصميم المرجعي:
 *   - قمع جمع البيانات الخام (Funnel)
 *   - ماسح تصنيف EGX30 (صاعد/متراوح/هابط)
 *   - شبكة المؤشرات الفنية السداسية (RSI/MA/ATR/BB/شموع/دعم-مقاومة)
 *   - جدول الدرجة الفنية (0–5) مع إبراز الصف النشط
 *   - مقياس Master Score (Speedometer gauge)
 *   - 5 مسارات قرار متوازية مع نسب التنفيذ و BUY/SELL/HOLD
 *   - محطة HOLD (قاطع دائرة) ثُمانية الأضلاع
 *   - مُحدِّد البرسونا (Agile/Gambler/Investor/Balanced) قابل للتحكم
 *   - لوحة P16 لتوزيع الميزات (مستمر vs مضارب)
 *   - جدول أحدث الأسهم + وسائل التحكم (تحديث/فلترة/تجميد)
 *
 * مصدر البيانات: GET /api/maestro/logic-panel
 * التحديث: يدوي + auto-refresh كل 30 ثانية (قابل للإيقاف)
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  RefreshCw, Loader2, Activity, Database, Gauge, TrendingUp, TrendingDown,
  Minus, Zap, Shield, Scale, Sparkles, Target, Pause, Hand, ChevronDown,
  Hexagon, BarChart3, Clock, DollarSign, AlertTriangle, CheckCircle2,
  XCircle, CircleDot, Layers, GitBranch, Brain, Filter, Power,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

// ==================== Types (mirror of API) ====================

type Regime = 'bull' | 'bear' | 'sideways';
type IndicatorStatus = 'bull' | 'bear' | 'neutral' | 'unknown';
type Persona = 'agile' | 'gambler' | 'investor' | 'balanced';

interface RegimeData {
  regime: Regime;
  regimeLabel: string;
  regimeConfidence: number;
  egx30Value: number | null;
  egx30Change: number | null;
  bullThreshold: number;
  bearThreshold: number;
}
interface IndicatorStat {
  key: string; label: string; labelAr: string;
  value: number | null; status: IndicatorStatus;
  unit?: string; detail?: string;
}
interface ScoringRule {
  factor: string; factorAr: string;
  bull: number; neutral: number; bear: number;
  currentValue: number | null;
  activeColumn: 'bull' | 'neutral' | 'bear' | null;
}
interface MasterScoreStats {
  avg: number; min: number; max: number; count: number;
  formula: string; formulaAr: string;
  technicalWeight: number; fundamentalWeight: number; regimeWeight: number;
}
interface SignalDistribution { buy: number; sell: number; hold: number; total: number; }
interface PersonaDistribution { gambler: number; investor: number; balanced: number; total: number; }
interface TopStock {
  ticker: string; signal: 'BUY' | 'SELL' | 'HOLD';
  masterScore: number; confidence: number; persona: Persona;
  volumeRatio: number; change1d: number; peRatio: number | null; roe: number | null;
}
interface P16Features {
  continuous: { key: string; label: string; value: number | null }[];
  speculative: { key: string; label: string; value: number | null }[];
}
interface PathStatus {
  id: number; name: string; nameAr: string;
  condition: string; conditionAr: string;
  active: boolean; signal: 'BUY' | 'SELL' | 'HOLD';
  probability: number; triggeredCount: number;
}
interface LogicPanelData {
  success: boolean; hasLiveData: boolean;
  source: 'python' | 'local' | 'demo';
  timestamp: string;
  regime: RegimeData;
  indicators: IndicatorStat[];
  scoringMatrix: ScoringRule[];
  masterScore: MasterScoreStats;
  signals: SignalDistribution;
  personas: PersonaDistribution;
  topStocks: TopStock[];
  p16: P16Features;
  paths: PathStatus[];
  holdActive: boolean;
}

// ==================== Color tokens ====================

const STATUS_COLOR: Record<IndicatorStatus, { text: string; bg: string; border: string; glow: string; hex: string }> = {
  bull: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/50', glow: 'shadow-[0_0_20px_-4px_rgba(16,185,129,0.5)]', hex: '#10b981' },
  bear: { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/50', glow: 'shadow-[0_0_20px_-4px_rgba(244,63,94,0.5)]', hex: '#f43f5e' },
  neutral: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/50', glow: 'shadow-[0_0_20px_-4px_rgba(245,158,11,0.5)]', hex: '#f59e0b' },
  unknown: { text: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-600/50', glow: '', hex: '#64748b' },
};

const PERSONA_STYLE: Record<Persona, { text: string; bg: string; border: string; glow: string; icon: React.ComponentType<{ className?: string }>; ar: string; desc: string }> = {
  agile: { text: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/50', glow: 'shadow-[0_0_24px_-6px_rgba(14,165,233,0.6)]', icon: Activity, ar: 'أجيل', desc: 'تنفيذ سريع، زخم' },
  gambler: { text: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/50', glow: 'shadow-[0_0_24px_-6px_rgba(217,70,239,0.6)]', icon: Zap, ar: 'المضارب', desc: 'مخاطرة عالية، تذبذب' },
  investor: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/50', glow: 'shadow-[0_0_24px_-6px_rgba(16,185,129,0.6)]', icon: Shield, ar: 'المستثمر', desc: 'أساسيات قوية، مدى طويل' },
  balanced: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/50', glow: 'shadow-[0_0_24px_-6px_rgba(139,92,246,0.6)]', icon: Scale, ar: 'المتوازن', desc: 'هجين مُدار المخاطر' },
};

// ==================== Master Score Gauge (SVG speedometer) ====================

function MasterScoreGauge({ value, min, max, count }: { value: number; min: number; max: number; count: number }) {
  // gauge spans 0..100, semicircle
  const v = Math.max(0, Math.min(100, value));
  const angle = -90 + (v / 100) * 180; // -90 (left) → +90 (right)
  const radius = 80;
  const cx = 100, cy = 100;
  const needleX = cx + radius * Math.cos((angle * Math.PI) / 180);
  const needleY = cy + radius * Math.sin((angle * Math.PI) / 180);

  // arc segments: red 0-35, amber 35-65, green 65-100
  const arcPath = (startPct: number, endPct: number, color: string) => {
    const a0 = -90 + (startPct / 100) * 180;
    const a1 = -90 + (endPct / 100) * 180;
    const x0 = cx + radius * Math.cos((a0 * Math.PI) / 180);
    const y0 = cy + radius * Math.sin((a0 * Math.PI) / 180);
    const x1 = cx + radius * Math.cos((a1 * Math.PI) / 180);
    const y1 = cy + radius * Math.sin((a1 * Math.PI) / 180);
    const large = endPct - startPct > 50 ? 1 : 0;
    return <path d={`M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`} stroke={color} strokeWidth={12} fill="none" strokeLinecap="round" />;
  };

  const tone = v >= 65 ? STATUS_COLOR.bull : v <= 35 ? STATUS_COLOR.bear : STATUS_COLOR.neutral;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 130" className="w-full max-w-[260px]">
        {/* track */}
        <path d={`M 20 100 A ${radius} ${radius} 0 0 1 180 100`} stroke="#1e293b" strokeWidth={14} fill="none" strokeLinecap="round" />
        {/* colored arcs */}
        {arcPath(0, 35, '#f43f5e')}
        {arcPath(35, 65, '#f59e0b')}
        {arcPath(65, 100, '#10b981')}
        {/* needle */}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={tone.hex} strokeWidth={3} strokeLinecap="round" className="drop-shadow-[0_0_6px_currentColor]" />
        <circle cx={cx} cy={cy} r={7} fill={tone.hex} className="drop-shadow-[0_0_8px_currentColor]" />
        <circle cx={cx} cy={cy} r={3} fill="#0f172a" />
        {/* labels */}
        <text x="20" y="118" fontSize="9" fill="#64748b" textAnchor="middle">0</text>
        <text x="100" y="20" fontSize="9" fill="#64748b" textAnchor="middle">50</text>
        <text x="180" y="118" fontSize="9" fill="#64748b" textAnchor="middle">100</text>
      </svg>
      <div className="flex items-baseline gap-2 -mt-2">
        <span className={cn('text-4xl font-black tabular-nums', tone.text)} style={{ textShadow: `0 0 20px ${tone.hex}66` }}>
          {v.toFixed(1)}
        </span>
        <span className="text-xs text-slate-500">/100</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
        <span>min <b className="text-rose-400">{min.toFixed(0)}</b></span>
        <span>max <b className="text-emerald-400">{max.toFixed(0)}</b></span>
        <span>n=<b className="text-slate-300">{count}</b></span>
      </div>
    </div>
  );
}

// ==================== Hexagonal Indicator ====================

function HexIndicator({ ind }: { ind: IndicatorStat }) {
  const c = STATUS_COLOR[ind.status];
  const Icon = ind.key === 'rsi' ? Activity
    : ind.key === 'ma' ? TrendingUp
    : ind.key === 'atr' ? BarChart3
    : ind.key === 'bb' ? Hexagon
    : ind.key === 'candle' ? Layers
    : Target;
  return (
    <div className={cn('group relative flex flex-col items-center gap-1.5 p-3 rounded-xl border bg-slate-900/60 transition-all hover:scale-[1.04]', c.border, c.glow)}>
      {/* hexagon shape */}
      <div className="relative">
        <svg width="48" height="48" viewBox="0 0 48 48" className={c.text}>
          <polygon points="24,3 42,13 42,35 24,45 6,35 6,13" fill="none" stroke="currentColor" strokeWidth="2"
            className="drop-shadow-[0_0_6px_currentColor]" />
        </svg>
        <Icon className={cn('absolute inset-0 m-auto w-5 h-5', c.text)} />
      </div>
      <div className={cn('text-[11px] font-bold', c.text)}>{ind.label}</div>
      {ind.value != null ? (
        <div className="text-base font-black tabular-nums text-slate-100">
          {ind.value}{ind.unit ? <span className="text-[10px] text-slate-400 ml-0.5">{ind.unit}</span> : null}
        </div>
      ) : (
        <div className="text-base font-bold text-slate-600">—</div>
      )}
      <div className="text-[9px] text-slate-500 text-center leading-tight">{ind.detail}</div>
    </div>
  );
}

// ==================== Regime Diamond ====================

function RegimeDiamond({ regime }: { regime: RegimeData }) {
  const branches: { label: string; tone: Regime; cond: string; active: boolean }[] = [
    { label: 'صاعد 🐂', tone: 'bull', cond: `> +${regime.bullThreshold}%`, active: regime.regime === 'bull' },
    { label: 'متراوح ➡️', tone: 'sideways', cond: 'بينهما', active: regime.regime === 'sideways' },
    { label: 'هابط 🐻', tone: 'bear', cond: `< ${regime.bearThreshold}%`, active: regime.regime === 'bear' },
  ];
  const activeColor = STATUS_COLOR[regime.regime === 'sideways' ? 'neutral' : regime.regime];
  return (
    <div className="flex flex-col items-center gap-3">
      {/* diamond */}
      <div className={cn('relative rotate-45 w-24 h-24 rounded-2xl border-2 flex items-center justify-center',
        activeColor.border, activeColor.bg, activeColor.glow)}>
        <div className="-rotate-45 text-center">
          <div className={cn('text-[10px] font-bold', activeColor.text)}>EGX30</div>
          {regime.egx30Value != null ? (
            <div className="text-sm font-black text-slate-100 tabular-nums">{regime.egx30Value.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
          ) : (
            <div className="text-sm font-bold text-slate-500">—</div>
          )}
          {regime.egx30Change != null && (
            <div className={cn('text-[10px] font-bold tabular-nums', regime.egx30Change >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
              {regime.egx30Change >= 0 ? '+' : ''}{regime.egx30Change.toFixed(2)}%
            </div>
          )}
        </div>
      </div>
      {/* branches */}
      <div className="flex items-center gap-2">
        {branches.map((b) => {
          const c = b.tone === 'bull' ? STATUS_COLOR.bull : b.tone === 'bear' ? STATUS_COLOR.bear : STATUS_COLOR.neutral;
          return (
            <div key={b.tone} className={cn('flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg border text-[10px] font-semibold transition-all',
              c.border, c.bg, b.active ? cn('scale-110 ring-1', c.glow) : 'opacity-40')}>
              <span className={c.text}>{b.label}</span>
              <span className="text-slate-500">{b.cond}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
        <Gauge className="w-3 h-3" />
        الثقة: <b className={activeColor.text}>{regime.regimeConfidence}%</b>
      </div>
    </div>
  );
}

// ==================== Scoring Matrix Table ====================

function ScoringMatrix({ rules }: { rules: ScoringRule[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-slate-900/80 text-slate-400">
            <th className="text-right p-2 font-semibold">العامل</th>
            <th className="p-2 font-semibold text-rose-400">هابط</th>
            <th className="p-2 font-semibold text-amber-400">محايد</th>
            <th className="p-2 font-semibold text-emerald-400">صاعد</th>
            <th className="p-2 font-semibold text-slate-300">الحالي</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.factor} className="border-t border-slate-800/60 hover:bg-slate-900/40">
              <td className="p-2 font-semibold text-slate-200">{r.factorAr}</td>
              <td className={cn('p-2 text-center tabular-nums', r.activeColumn === 'bear' ? 'bg-rose-500/20 text-rose-300 font-bold' : 'text-slate-400')}>{r.bear}</td>
              <td className={cn('p-2 text-center tabular-nums', r.activeColumn === 'neutral' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400')}>{r.neutral}</td>
              <td className={cn('p-2 text-center tabular-nums', r.activeColumn === 'bull' ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'text-slate-400')}>{r.bull}</td>
              <td className="p-2 text-center tabular-nums font-bold text-slate-100">
                {r.currentValue != null ? r.currentValue : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==================== Decision Path Column ====================

function DecisionPath({ path }: { path: PathStatus }) {
  const sigColor = path.signal === 'BUY' ? STATUS_COLOR.bull : path.signal === 'SELL' ? STATUS_COLOR.bear : STATUS_COLOR.neutral;
  const Icon = path.signal === 'BUY' ? TrendingUp : path.signal === 'SELL' ? TrendingDown : Pause;
  return (
    <div className={cn('flex flex-col items-center gap-2 p-2 rounded-xl border transition-all',
      path.active ? cn('bg-slate-800/60', sigColor.border, sigColor.glow, 'scale-[1.03]') : 'border-slate-800 bg-slate-900/40 opacity-70')}>
      <div className={cn('text-[10px] font-bold', path.active ? sigColor.text : 'text-slate-400')}>{path.name}</div>
      <div className="text-[10px] text-slate-400 text-center leading-tight min-h-[28px]">{path.nameAr}</div>
      {/* IF gate diamond */}
      <div className={cn('rotate-45 w-10 h-10 rounded-md border-2 flex items-center justify-center',
        path.active ? cn(sigColor.border, sigColor.bg) : 'border-slate-700 bg-slate-800/40')}>
        <span className="-rotate-45 text-[9px] font-bold text-slate-300">IF</span>
      </div>
      {/* condition */}
      <div className="text-[9px] text-slate-500 text-center min-h-[28px] leading-tight">{path.conditionAr}</div>
      {/* probability bar */}
      <div className="w-full">
        <div className="flex justify-between text-[9px] text-slate-500 mb-0.5">
          <span>تنفيذ</span>
          <span className="tabular-nums">{path.probability}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', sigColor.bg.replace('/10', '/80'))} style={{ width: `${Math.max(2, path.probability)}%` }} />
        </div>
      </div>
      <div className="text-[9px] text-slate-500">n=<b className="text-slate-300">{path.triggeredCount}</b></div>
      {/* terminal */}
      <div className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 border-2 font-bold text-[11px]',
        sigColor.border, sigColor.bg, sigColor.text)}>
        <Icon className="w-3.5 h-3.5" />
        {path.signal}
      </div>
    </div>
  );
}

// ==================== HOLD Circuit Breaker ====================

function HoldBreaker({ active }: { active: boolean }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 transition-all', active ? 'scale-105' : 'opacity-50')}>
      <div className={cn('relative w-20 h-20 flex items-center justify-center',
        active && 'animate-pulse')}>
        {/* octagon */}
        <svg width="80" height="80" viewBox="0 0 80 80" className={active ? 'text-amber-400 drop-shadow-[0_0_16px_currentColor]' : 'text-slate-600'}>
          <polygon points="28,4 52,4 76,28 76,52 52,76 28,76 4,52 4,28"
            fill={active ? 'rgba(245,158,11,0.12)' : 'rgba(30,41,59,0.4)'}
            stroke="currentColor" strokeWidth="3" />
        </svg>
        <Hand className={cn('absolute w-7 h-7', active ? 'text-amber-400' : 'text-slate-600')} />
      </div>
      <div className={cn('text-sm font-black', active ? 'text-amber-400' : 'text-slate-500')}>HOLD</div>
      <div className="text-[10px] text-slate-500 text-center max-w-[120px] leading-tight">
        {active ? 'قاطع الدائرة نشط — لا إشارة كافية' : 'الإشارات نشطة'}
      </div>
    </div>
  );
}

// ==================== Persona Card ====================

function PersonaCard({
  persona, count, total, selected, onSelect,
}: {
  persona: Persona; count: number; total: number; selected: boolean; onSelect: () => void;
}) {
  const s = PERSONA_STYLE[persona];
  const Icon = s.icon;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn('group relative flex flex-col items-center gap-1.5 p-3 rounded-xl border bg-slate-900/60 transition-all hover:scale-[1.03]',
        s.border, selected ? cn('ring-2 scale-[1.04]', s.glow) : 'opacity-80')}
    >
      {/* avatar circle */}
      <div className={cn('relative w-12 h-12 rounded-full border-2 flex items-center justify-center', s.border, s.bg, selected && s.glow)}>
        <Icon className={cn('w-6 h-6', s.text)} />
        {selected && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary border-2 border-slate-900" />
        )}
      </div>
      <div className={cn('text-[11px] font-bold', s.text)}>{s.ar}</div>
      <div className="text-[9px] text-slate-500 text-center leading-tight">{s.desc}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-black tabular-nums text-slate-100">{count}</span>
        <span className="text-[9px] text-slate-500">سهم</span>
      </div>
      <div className="w-full h-1 rounded-full bg-slate-800 overflow-hidden">
        <div className={cn('h-full rounded-full', s.bg.replace('/10', '/80'))} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="text-[9px] text-slate-500 tabular-nums">{pct}%</div>
    </button>
  );
}

// ==================== P16 Feature Panel ====================

function P16Panel({ p16 }: { p16: P16Features }) {
  const FeatureRow = ({ f, tone }: { f: { key: string; label: string; value: number | null }; tone: string }) => (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/40">
      <div className="flex items-center gap-1.5 min-w-0">
        <BarChart3 className={cn('w-3 h-3 shrink-0', tone)} />
        <span className="text-[10px] font-mono text-slate-400 truncate">{f.key}</span>
      </div>
      <span className={cn('text-[11px] font-bold tabular-nums', f.value != null ? 'text-slate-100' : 'text-slate-600')}>
        {f.value != null ? f.value : '—'}
      </span>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/10 p-2">
        <div className="flex items-center gap-1.5 mb-1.5 px-1">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[11px] font-bold text-emerald-400">مستمر (Investor)</span>
        </div>
        <div className="space-y-0.5">
          {p16.continuous.map((f) => <FeatureRow key={f.key} f={f} tone="text-emerald-400" />)}
        </div>
      </div>
      <div className="rounded-xl border border-fuchsia-900/40 bg-fuchsia-950/10 p-2">
        <div className="flex items-center gap-1.5 mb-1.5 px-1">
          <Zap className="w-3.5 h-3.5 text-fuchsia-400" />
          <span className="text-[11px] font-bold text-fuchsia-400">مضارب (Gambler)</span>
        </div>
        <div className="space-y-0.5">
          {p16.speculative.map((f) => <FeatureRow key={f.key} f={f} tone="text-fuchsia-400" />)}
        </div>
      </div>
    </div>
  );
}

// ==================== Data Funnel ====================

function DataFunnel({ data }: { data: LogicPanelData }) {
  const inputs = [
    { label: 'إغلاق', icon: CircleDot, value: data.signals.total },
    { label: 'EGX30', icon: Gauge, value: data.regime.egx30Value },
    { label: 'Master', icon: Brain, value: data.masterScore.avg },
    { label: 'حجم', icon: BarChart3, value: data.masterScore.count },
  ];
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="grid grid-cols-2 gap-1.5">
        {inputs.map((inp) => (
          <div key={inp.label} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50">
            <inp.icon className="w-3 h-3 text-cyan-400" />
            <div className="flex flex-col">
              <span className="text-[8px] text-slate-500 leading-none">{inp.label}</span>
              <span className="text-[10px] font-bold text-slate-200 tabular-nums leading-tight">
                {inp.value != null && inp.value !== 0 ? (typeof inp.value === 'number' ? inp.value.toLocaleString('en-US', { maximumFractionDigits: 1 }) : inp.value) : '—'}
              </span>
            </div>
          </div>
        ))}
      </div>
      {/* funnel svg */}
      <svg width="120" height="40" viewBox="0 0 120 40" className="text-cyan-500">
        <defs>
          <linearGradient id="funnelGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <path d="M 10 2 L 110 2 L 75 38 L 45 38 Z" fill="url(#funnelGrad)" stroke="#06b6d4" strokeWidth="1" />
      </svg>
      <div className="text-[10px] text-slate-400 flex items-center gap-1">
        <Database className="w-3 h-3" />
        {data.signals.total} تحليل مُخزَّن
      </div>
    </div>
  );
}

// ==================== Top Stocks Table ====================

function TopStocksTable({ stocks, personaFilter }: { stocks: TopStock[]; personaFilter: Persona | null }) {
  const filtered = personaFilter ? stocks.filter((s) => s.persona === personaFilter) : stocks;
  const sigColor = (sig: string) => sig === 'BUY' ? 'text-emerald-400 bg-emerald-500/10' : sig === 'SELL' ? 'text-rose-400 bg-rose-500/10' : 'text-amber-400 bg-amber-500/10';
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 max-h-[280px] overflow-y-auto">
      <table className="w-full text-[10px]">
        <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
          <tr className="text-slate-400">
            <th className="text-right p-1.5 font-semibold">السهم</th>
            <th className="p-1.5 font-semibold">إشارة</th>
            <th className="p-1.5 font-semibold">Master</th>
            <th className="p-1.5 font-semibold">ثقة</th>
            <th className="p-1.5 font-semibold">برسونا</th>
            <th className="p-1.5 font-semibold">حجم</th>
            <th className="p-1.5 font-semibold">1يوم</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={7} className="text-center p-4 text-slate-600 text-[11px]">لا توجد أسهم مطابقة</td></tr>
          ) : filtered.map((s, i) => (
            <tr key={i} className="border-t border-slate-800/60 hover:bg-slate-800/40">
              <td className="p-1.5 font-bold text-slate-100">{s.ticker}</td>
              <td className="p-1.5 text-center">
                <span className={cn('inline-block px-1.5 py-0.5 rounded font-bold', sigColor(s.signal))}>{s.signal}</span>
              </td>
              <td className="p-1.5 text-center tabular-nums text-slate-200">{s.masterScore}</td>
              <td className="p-1.5 text-center tabular-nums text-slate-300">{s.confidence}%</td>
              <td className="p-1.5 text-center">
                <span className={cn('text-[9px] font-semibold', PERSONA_STYLE[s.persona].text)}>{PERSONA_STYLE[s.persona].ar}</span>
              </td>
              <td className="p-1.5 text-center tabular-nums text-slate-300">{s.volumeRatio}</td>
              <td className={cn('p-1.5 text-center tabular-nums font-semibold', s.change1d >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                {s.change1d >= 0 ? '+' : ''}{s.change1d}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==================== Main Component ====================

export function MaestroLiveLogicPanel() {
  const [data, setData] = useState<LogicPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/maestro/logic-panel', { cache: 'no-store' });
      const json = await res.json();
      if (json?.success) setData(json);
    } catch {
      // silent — keep last data
    } finally {
      setLoading(false);
      setLastUpdated(new Date());
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(fetchData, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, fetchData]);

  const regime = data?.regime;
  const sourceBadge = data?.source === 'python' ? { text: 'حي (Python)', tone: 'text-emerald-400 bg-emerald-500/10' }
    : data?.source === 'local' ? { text: 'محلي', tone: 'text-cyan-400 bg-cyan-500/10' }
    : { text: 'تجريبي', tone: 'text-amber-400 bg-amber-500/10' };

  return (
    <div className="rounded-2xl bg-slate-950 text-slate-100 border border-slate-800 overflow-hidden">
      {/* ===== Header ===== */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/30">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-xl bg-cyan-500/15 ring-1 ring-cyan-500/40 w-11 h-11 shrink-0 shadow-[0_0_24px_-6px_rgba(6,182,212,0.6)]">
            <Brain className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold leading-tight">مخطط منطق المايسترو — حي</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              نظام تحليل تقني متقدم — قمع ← تصنيف ← مؤشرات ← درجة ← مسارات ← برسونا
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data && (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border border-slate-700', sourceBadge.tone)}>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              {sourceBadge.text}
            </span>
          )}
          {regime && (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border',
              STATUS_COLOR[regime.regime === 'sideways' ? 'neutral' : regime.regime].border,
              STATUS_COLOR[regime.regime === 'sideways' ? 'neutral' : regime.regime].bg,
              STATUS_COLOR[regime.regime === 'sideways' ? 'neutral' : regime.regime].text)}>
              <Gauge className="w-3 h-3" />
              السوق: {regime.regimeLabel} ({regime.regimeConfidence}%)
            </span>
          )}
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <span>تلقائي</span>
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-75" />
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-slate-300 hover:text-slate-100 hover:bg-slate-800" onClick={fetchData} disabled={loading}>
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            تحديث
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : !data ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <AlertTriangle className="w-6 h-6 ml-2" />
          تعذّر تحميل البيانات
        </div>
      ) : (
        <div className="p-3 sm:p-4 space-y-4">
          {/* ===== Row 1: Funnel → Regime → Indicators → Gauge ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* Funnel */}
            <Card className="lg:col-span-2 bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2 text-cyan-400">
                  <Database className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">جمع البيانات</span>
                </div>
                <DataFunnel data={data} />
              </CardContent>
            </Card>

            {/* Regime */}
            <Card className="lg:col-span-2 bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2 text-amber-400">
                  <Gauge className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">تصنيف EGX30</span>
                </div>
                <RegimeDiamond regime={data.regime} />
              </CardContent>
            </Card>

            {/* Indicators hex grid */}
            <Card className="lg:col-span-5 bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2 text-violet-400">
                  <Hexagon className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">المؤشرات الفنية المدمجة</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {data.indicators.map((ind) => <HexIndicator key={ind.key} ind={ind} />)}
                </div>
              </CardContent>
            </Card>

            {/* Master Score gauge */}
            <Card className="lg:col-span-3 bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2 text-emerald-400">
                  <Gauge className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">الدرجة الرئيسية (Master Score)</span>
                </div>
                <MasterScoreGauge value={data.masterScore.avg} min={data.masterScore.min} max={data.masterScore.max} count={data.masterScore.count} />
                <div className="mt-2 text-center text-[9px] text-slate-500 font-mono leading-tight">
                  {data.masterScore.formulaAr}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ===== Row 2: Scoring Matrix + 5 Paths + HOLD ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* Scoring matrix */}
            <Card className="lg:col-span-4 bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2 text-sky-400">
                  <Layers className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">الدرجة الفنية (0–5)</span>
                </div>
                <ScoringMatrix rules={data.scoringMatrix} />
              </CardContent>
            </Card>

            {/* 5 Decision paths */}
            <Card className="lg:col-span-6 bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2 text-cyan-400">
                  <GitBranch className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">مسارات اتخاذ القرار (5)</span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {data.paths.map((p) => <DecisionPath key={p.id} path={p} />)}
                </div>
              </CardContent>
            </Card>

            {/* HOLD breaker */}
            <Card className="lg:col-span-2 bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2 text-amber-400">
                  <Power className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">قاطع الدائرة</span>
                </div>
                <HoldBreaker active={data.holdActive} />
              </CardContent>
            </Card>
          </div>

          {/* ===== Row 3: Personas + P16 + Top Stocks ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* Persona selector */}
            <Card className="lg:col-span-4 bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-fuchsia-400">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-bold">تحديد البرسونا</span>
                  </div>
                  {selectedPersona && (
                    <button onClick={() => setSelectedPersona(null)} className="text-[9px] text-slate-500 hover:text-slate-300">إلغاء الفلتر ✕</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['agile', 'gambler', 'investor', 'balanced'] as Persona[]).map((p) => {
                    const count = p === 'gambler' ? data.personas.gambler
                      : p === 'investor' ? data.personas.investor
                      : p === 'balanced' ? data.personas.balanced
                      : 0; // agile not separately tracked
                    return (
                      <PersonaCard
                        key={p}
                        persona={p}
                        count={count}
                        total={data.personas.total}
                        selected={selectedPersona === p}
                        onSelect={() => setSelectedPersona((prev) => (prev === p ? null : p))}
                      />
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* P16 */}
            <Card className="lg:col-span-4 bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2 text-violet-400">
                  <Filter className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">توزيع الميزات (P16)</span>
                </div>
                <P16Panel p16={data.p16} />
              </CardContent>
            </Card>

            {/* Top stocks */}
            <Card className="lg:col-span-4 bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <Target className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-bold">أحدث الأسهم</span>
                  </div>
                  {selectedPersona && (
                    <Badge variant="outline" className="text-[9px] border-slate-700 text-slate-400">
                      فلتر: {PERSONA_STYLE[selectedPersona].ar}
                    </Badge>
                  )}
                </div>
                <TopStocksTable stocks={data.topStocks} personaFilter={selectedPersona} />
              </CardContent>
            </Card>
          </div>

          {/* ===== Footer: signal distribution + feature legend ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Signal distribution */}
            <Card className="bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2 text-slate-300">
                  <Activity className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">توزيع الإشارات</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'BUY', val: data.signals.buy, color: STATUS_COLOR.bull, icon: TrendingUp },
                    { label: 'SELL', val: data.signals.sell, color: STATUS_COLOR.bear, icon: TrendingDown },
                    { label: 'HOLD', val: data.signals.hold, color: STATUS_COLOR.neutral, icon: Pause },
                    { label: 'الإجمالي', val: data.signals.total, color: STATUS_COLOR.unknown, icon: Layers },
                  ].map((s) => (
                    <div key={s.label} className={cn('flex flex-col items-center gap-1 p-2 rounded-lg border', s.color.border, s.color.bg)}>
                      <s.icon className={cn('w-4 h-4', s.color.text)} />
                      <span className="text-xl font-black tabular-nums text-slate-100">{s.val}</span>
                      <span className={cn('text-[9px] font-bold', s.color.text)}>{s.label}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Feature legend */}
            <Card className="bg-slate-900/40 border-slate-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2 text-slate-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">العوامل المؤثرة</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                  {[
                    { icon: CheckCircle2, label: 'الإشارة', val: data.signals.total > 0 ? `${data.signals.buy + data.signals.sell}/${data.signals.total}` : '—', tone: 'text-emerald-400' },
                    { icon: Gauge, label: 'Master Score', val: data.masterScore.avg.toFixed(0), tone: 'text-amber-400' },
                    { icon: Activity, label: 'مستوى القوة', val: `${data.regime.regimeConfidence}%`, tone: 'text-cyan-400' },
                    { icon: Clock, label: 'آخر تحديث', val: lastUpdated ? lastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—', tone: 'text-slate-300' },
                    { icon: DollarSign, label: 'الأسعار', val: 'EGP', tone: 'text-emerald-400' },
                    { icon: Filter, label: 'البرسونا', val: `${data.personas.gambler + data.personas.investor + data.personas.balanced}`, tone: 'text-fuchsia-400' },
                  ].map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <f.icon className={cn('w-3 h-3 shrink-0', f.tone)} />
                      <span className="text-slate-400">{f.label}:</span>
                      <span className="font-bold text-slate-200 tabular-nums">{f.val}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ===== Status bar ===== */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-[9px] text-slate-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><CircleDot className="w-2.5 h-2.5" /> المصدر: <b className="text-slate-300">{sourceBadge.text}</b></span>
              <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> {lastUpdated ? lastUpdated.toLocaleString('ar-EG') : '—'}</span>
              <span className="flex items-center gap-1"><Database className="w-2.5 h-2.5" /> {data.masterScore.count} تحليل</span>
            </div>
            <span className="font-mono">/api/maestro/logic-panel · auto-refresh 30s</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default MaestroLiveLogicPanel;
