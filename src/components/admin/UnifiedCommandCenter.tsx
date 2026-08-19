'use client';

/**
 * مركز القيادة الموحّد — Unified Command Center
 * ============================================================
 * Merges 4 existing tools into one screen plus live chart:
 *   1. مركز القيادة V6 (Command Center) — Pipeline/engine control
 *   2. استوديو المحركات (Engine Studio) — Visual ReactFlow pipeline
 *   3. المخطط الحي (Live Chart) — Live status bar
 *   4. الشخصيات (Personas) — Investor 🏦 vs Gambler 🎰 live stats
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Activity, Zap, BarChart3,
  Play, RefreshCw, Save, Loader2,
  CheckCircle2, XCircle, ArrowUpRight, ArrowDownRight,
  Minus, Settings2, Sparkles, Target,
  Shield, Radio, LayoutDashboard,
  Landmark, Dice1, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  LiveStatusBar,
  LiveDot,
  useLivePolling,
  formatLiveSeconds,
  formatLiveClock,
} from '@/components/admin/live-chart';
import { FlowCanvas } from '@/components/studio/FlowCanvas';

// ============================================================================
// TYPES
// ============================================================================

interface PipelineEngine {
  enabled: boolean;
  weight: number;
}

interface PipelineInfo {
  name: string;
  display_name: string;
  description: string;
  is_custom?: boolean;
  engines: Record<string, PipelineEngine>;
}

interface AnalysisResult {
  signal: string;
  score: number;
  confidence: number;
  engines: EngineResult[];
  pipeline: string;
  pipeline_display_name: string;
  ticker: string;
  timestamp: string;
  signal_counts?: Record<string, number>;
}

interface EngineResult {
  name: string;
  enabled: boolean;
  signal: string;
  score: number;
  confidence: number;
  weight: number;
  weighted_score?: number;
  details?: Record<string, any>;
  reasons?: string[];
  error?: string;
}

interface DayTradingOpportunity {
  ticker: string;
  name: string;
  signal: string;
  score: number;
  confidence: number;
  price: number;
  target_2pct: number;
  target_5pct: number;
  stop_loss: number;
  risk_reward_ratio: number;
  reasons: string[];
  pipeline: string;
  scanned_at: string;
}

interface HealthData {
  status: string;
  pipelines_count: number;
  vps_status?: string;
  data_age?: string;
  engines_online?: number;
  engines_total?: number;
}

// ---- Persona Types (Investor 🏦 vs Gambler 🎰) ----

interface PersonaWeightSet {
  technical: number;
  fundamental: number;
  timing: number;
  ai_pattern: number;
  sentiment: number;
  market_regime: number;
}

interface PersonaStat {
  persona_type: string;
  name_ar: string;
  emoji: string;
  category: 'investor' | 'gambler' | 'balanced';
  weights: PersonaWeightSet;
  cached: boolean;
  count: number;
  win_rate?: number;
  total_signals?: number;
  recent_signal?: string;
  recent_ticker?: string;
  quality_gate_pass?: boolean;
  mr_signal_triggered?: boolean;
}

interface PersonaStatusResponse {
  all_personas_cached: boolean;
  date: string;
  status: Record<string, { cached: boolean; count: number }>;
}

// ============================================================================
// ENGINE & SIGNAL VISUAL CONFIG
// ============================================================================

const ENGINE_CONFIG: Record<string, {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  label: string;
  labelAr: string;
}> = {
  fundamental: {
    icon: <BarChart3 className="h-5 w-5" />,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    label: 'Fundamental',
    labelAr: 'الأساسي',
  },
  technical: {
    icon: <Activity className="h-5 w-5" />,
    color: 'text-sky-600',
    bgColor: 'bg-sky-50 dark:bg-sky-950/30',
    label: 'Technical',
    labelAr: 'الفني',
  },
  candlestick: {
    icon: <Zap className="h-5 w-5" />,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    label: 'Candlestick',
    labelAr: 'الشموع',
  },
  mean_reversion: {
    icon: <TrendingDown className="h-5 w-5" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    label: 'Mean Reversion',
    labelAr: 'عودة للمتوسط',
  },
};

const SIGNAL_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  BUY: { color: 'text-emerald-700', bg: 'bg-emerald-100 dark:bg-emerald-900/40', icon: <ArrowUpRight className="h-4 w-4" /> },
  SELL: { color: 'text-red-700', bg: 'bg-red-100 dark:bg-red-900/40', icon: <ArrowDownRight className="h-4 w-4" /> },
  HOLD: { color: 'text-yellow-700', bg: 'bg-yellow-100 dark:bg-yellow-900/40', icon: <Minus className="h-4 w-4" /> },
};

// ============================================================================
// PERSONA CONFIG — Investor 🏦 vs Gambler 🎰
// ============================================================================

const PERSONA_CONFIG: Record<string, {
  category: 'investor' | 'gambler' | 'balanced';
  nameAr: string;
  emoji: string;
  description: string;
  weights: PersonaWeightSet;
  color: string;
  bgColor: string;
  borderColor: string;
  targetPct: string;
  stopLossPct: string;
  timeHorizon: string;
  screenerPreset: string;
  keyEngine: string;
}> = {
  conservative: {
    category: 'investor', nameAr: 'المستثمر', emoji: '🛡️',
    description: 'حماية رأس المال أولاً — Quality Gate يجب يمر',
    weights: { technical: 0.10, fundamental: 0.40, timing: 0.05, ai_pattern: 0.15, sentiment: 0.15, market_regime: 0.15 },
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderColor: 'border-emerald-300 dark:border-emerald-700',
    targetPct: '+10%', stopLossPct: '-12%', timeHorizon: '90-180 يوم',
    screenerPreset: 'value', keyEngine: 'MasterAnalyzer + Quality Gate',
  },
  cautious: {
    category: 'investor', nameAr: 'الحذر', emoji: '🐢',
    description: 'عائد معقول مع حذر — Quality Gate يجب يمر',
    weights: { technical: 0.10, fundamental: 0.40, timing: 0.05, ai_pattern: 0.15, sentiment: 0.15, market_regime: 0.15 },
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderColor: 'border-emerald-300 dark:border-emerald-700',
    targetPct: '+10%', stopLossPct: '-12%', timeHorizon: '90-180 يوم',
    screenerPreset: 'value', keyEngine: 'MasterAnalyzer + Quality Gate',
  },
  hedger: {
    category: 'investor', nameAr: 'المتحوط', emoji: '🏛️',
    description: 'حماية من التضخم — Quality Gate يجب يمر',
    weights: { technical: 0.10, fundamental: 0.40, timing: 0.05, ai_pattern: 0.15, sentiment: 0.15, market_regime: 0.15 },
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderColor: 'border-emerald-300 dark:border-emerald-700',
    targetPct: '+10%', stopLossPct: '-12%', timeHorizon: '90-180 يوم',
    screenerPreset: 'value', keyEngine: 'MasterAnalyzer + Quality Gate',
  },
  investor: {
    category: 'investor', nameAr: 'المستثمر', emoji: '🏦',
    description: 'استثمار طويل المدى — fundamental 0.40 + Quality Gate',
    weights: { technical: 0.10, fundamental: 0.40, timing: 0.05, ai_pattern: 0.15, sentiment: 0.15, market_regime: 0.15 },
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderColor: 'border-emerald-300 dark:border-emerald-700',
    targetPct: '+10%', stopLossPct: '-12%', timeHorizon: '90-180 يوم',
    screenerPreset: 'value', keyEngine: 'MasterAnalyzer + Quality Gate',
  },
  gambler: {
    category: 'gambler', nameAr: 'المضارب', emoji: '🎰',
    description: 'مخاطر عالية جداً — MR Signal + فني 0.50',
    weights: { technical: 0.50, fundamental: 0.05, timing: 0.05, ai_pattern: 0.15, sentiment: 0.05, market_regime: 0.20 },
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    borderColor: 'border-red-300 dark:border-red-700',
    targetPct: '+4%', stopLossPct: '-8%', timeHorizon: '5 أيام',
    screenerPreset: 'day_trader', keyEngine: 'CoreScoring + MR Signal (F_MR_TIGHT)',
  },
  adventurer: {
    category: 'gambler', nameAr: 'المضارب', emoji: '🎲',
    description: 'مخاطر عالية — MR Signal + سيولة مطلوبة',
    weights: { technical: 0.50, fundamental: 0.05, timing: 0.05, ai_pattern: 0.15, sentiment: 0.05, market_regime: 0.20 },
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    borderColor: 'border-red-300 dark:border-red-700',
    targetPct: '+4%', stopLossPct: '-8%', timeHorizon: '5 أيام',
    screenerPreset: 'day_trader', keyEngine: 'CoreScoring + MR Signal (F_MR_TIGHT)',
  },
  active_trader: {
    category: 'gambler', nameAr: 'المضارب', emoji: '🎯',
    description: 'تداول نشط — MR Signal + انضباط',
    weights: { technical: 0.50, fundamental: 0.05, timing: 0.05, ai_pattern: 0.15, sentiment: 0.05, market_regime: 0.20 },
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    borderColor: 'border-red-300 dark:border-red-700',
    targetPct: '+4%', stopLossPct: '-8%', timeHorizon: '5 أيام',
    screenerPreset: 'day_trader', keyEngine: 'CoreScoring + MR Signal (F_MR_TIGHT)',
  },
  balanced: {
    category: 'balanced', nameAr: 'المتوازن', emoji: '⚖️',
    description: 'توازن بين العائد والمخاطر — أوزان متساوية',
    weights: { technical: 0.20, fundamental: 0.30, timing: 0.10, ai_pattern: 0.20, sentiment: 0.10, market_regime: 0.10 },
    color: 'text-sky-700 dark:text-sky-400',
    bgColor: 'bg-sky-50 dark:bg-sky-950/30',
    borderColor: 'border-sky-300 dark:border-sky-700',
    targetPct: '+8%', stopLossPct: '-10%', timeHorizon: '30-60 يوم',
    screenerPreset: 'balanced', keyEngine: 'MasterAnalyzer (Default)',
  },
};

// Weight labels for display
const WEIGHT_LABELS: Record<keyof PersonaWeightSet, { ar: string; short: string }> = {
  technical: { ar: 'الفني', short: 'TEC' },
  fundamental: { ar: 'الأساسي', short: 'FUND' },
  timing: { ar: 'التوقيت', short: 'TIM' },
  ai_pattern: { ar: 'الذكاء', short: 'AI' },
  sentiment: { ar: 'المشاعر', short: 'SEN' },
  market_regime: { ar: 'النظام', short: 'REG' },
};

// ============================================================================
// API HELPER
// ============================================================================

async function apiCall<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json();
    return data?.data ?? data;
  } catch {
    return null;
  }
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// ---------- Persona Weight Bar ----------

function PersonaWeightBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-8 text-muted-foreground font-mono">{label}</span>
      <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono text-muted-foreground">{pct}%</span>
    </div>
  );
}

// ---------- Persona Card ----------

function PersonaCard({ personaKey, statusData }: {
  personaKey: string;
  statusData?: { cached: boolean; count: number };
}) {
  const config = PERSONA_CONFIG[personaKey];
  if (!config) return null;

  const isInvestor = config.category === 'investor';
  const isGambler = config.category === 'gambler';

  const weightBarColors: Record<keyof PersonaWeightSet, string> = {
    technical: isGambler ? 'bg-red-500' : isInvestor ? 'bg-emerald-400' : 'bg-sky-500',
    fundamental: isInvestor ? 'bg-emerald-600' : isGambler ? 'bg-red-300' : 'bg-sky-600',
    timing: 'bg-amber-500',
    ai_pattern: 'bg-purple-500',
    sentiment: 'bg-pink-500',
    market_regime: isGambler ? 'bg-red-600' : 'bg-teal-500',
  };

  return (
    <Card className={cn('border-2 transition-all duration-300', config.borderColor, config.bgColor)}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{config.emoji}</span>
            <div>
              <h4 className={cn('font-bold text-sm', config.color)}>{config.nameAr}</h4>
              <p className="text-[10px] text-muted-foreground">{personaKey}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isInvestor && (
              <Badge className="bg-emerald-600 text-white text-[10px] gap-1">
                <Landmark className="h-3 w-3" /> 🏦 Investor
              </Badge>
            )}
            {isGambler && (
              <Badge className="bg-red-600 text-white text-[10px] gap-1">
                <Dice1 className="h-3 w-3" /> 🎰 Gambler
              </Badge>
            )}
            {!isInvestor && !isGambler && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Users className="h-3 w-3" /> ⚖️ Balanced
              </Badge>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground mb-3">{config.description}</p>

        {/* Weights */}
        <div className="space-y-1.5 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">الأوزان</span>
            <span className="text-[10px] font-mono text-muted-foreground">
              ∑ = {Object.values(config.weights).reduce((a, b) => a + b, 0).toFixed(2)}
            </span>
          </div>
          {(Object.entries(config.weights) as [keyof PersonaWeightSet, number][]).map(([key, val]) => (
            <PersonaWeightBar
              key={key}
              label={WEIGHT_LABELS[key].short}
              value={val}
              color={weightBarColors[key]}
            />
          ))}
        </div>

        {/* Key params */}
        <div className="grid grid-cols-3 gap-2 text-center mb-3">
          <div className="p-1.5 rounded bg-muted/50">
            <div className="text-xs font-bold text-emerald-700">{config.targetPct}</div>
            <div className="text-[10px] text-muted-foreground">هدف</div>
          </div>
          <div className="p-1.5 rounded bg-muted/50">
            <div className="text-xs font-bold text-red-700">{config.stopLossPct}</div>
            <div className="text-[10px] text-muted-foreground">وقف</div>
          </div>
          <div className="p-1.5 rounded bg-muted/50">
            <div className="text-xs font-bold">{config.timeHorizon}</div>
            <div className="text-[10px] text-muted-foreground">أمد</div>
          </div>
        </div>

        {/* Engine + Preset */}
        <div className="space-y-1 mb-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">المحرك الرئيسي:</span>
            <span className={cn('font-semibold', config.color)}>{config.keyEngine}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">ماسح الأسهم:</span>
            <Badge variant="outline" className="text-[10px] font-mono">{config.screenerPreset}</Badge>
          </div>
        </div>

        {/* Cache status */}
        <div className="flex items-center justify-between pt-2 border-t border-current/10">
          <div className="flex items-center gap-1.5 text-xs">
            {statusData?.cached ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-emerald-600">كاش جاهز ({statusData.count} سهم)</span>
              </>
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">كاش فاضي</span>
              </>
            )}
          </div>
          {isInvestor && (
            <Badge variant="outline" className="text-[10px] gap-1 border-emerald-400">
              <Shield className="h-3 w-3" /> QG≥60
            </Badge>
          )}
          {isGambler && (
            <Badge variant="outline" className="text-[10px] gap-1 border-red-400">
              <Activity className="h-3 w-3" /> MR Signal
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Engine Card ----------

function EngineCard({
  engineName,
  config,
  onToggle,
  onWeightChange,
  result,
}: {
  engineName: string;
  config: PipelineEngine;
  onToggle: (enabled: boolean) => void;
  onWeightChange: (weight: number) => void;
  result?: EngineResult;
}) {
  const ec = ENGINE_CONFIG[engineName] || ENGINE_CONFIG.technical;
  const signal = result?.signal || 'HOLD';
  const sc = SIGNAL_CONFIG[signal] || SIGNAL_CONFIG.HOLD;

  return (
    <Card className={cn(
      ec.bgColor, 'border-2 transition-all duration-300',
      config.enabled ? 'border-current/30 shadow-md' : 'border-dashed opacity-60'
    )}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={ec.color}>{ec.icon}</div>
            <div>
              <h4 className="font-semibold text-sm">{ec.label}</h4>
              <p className="text-xs text-muted-foreground">{ec.labelAr}</p>
            </div>
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={onToggle}
            aria-label={`Toggle ${ec.label}`}
          />
        </div>

        {config.enabled && (
          <div className="space-y-2 mb-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">الوزن (Weight)</Label>
              <Badge variant="outline" className="text-xs font-mono">
                {config.weight.toFixed(1)}x
              </Badge>
            </div>
            <Slider
              value={[config.weight]}
              onValueChange={([v]) => onWeightChange(v)}
              min={0}
              max={5}
              step={0.5}
              disabled={!config.enabled}
              className="w-full"
            />
          </div>
        )}

        {result && config.enabled && (
          <div className="space-y-2 pt-2 border-t border-current/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Badge className={cn(sc.bg, sc.color, 'text-xs font-bold')}>
                  {sc.icon} {signal}
                </Badge>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold">{result.score.toFixed(1)}/10</div>
                <div className="text-xs text-muted-foreground">{result.confidence.toFixed(0)}%</div>
              </div>
            </div>
            {result.reasons && result.reasons.length > 0 && (
              <div className="space-y-0.5">
                {result.reasons.slice(0, 2).map((r, i) => (
                  <p key={i} className="text-xs text-muted-foreground truncate">• {r}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {!config.enabled && (
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs mt-1">
            <XCircle className="h-3 w-3" />
            <span>معطل</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Analysis Result Card ----------

function AnalysisResultCard({ result }: { result: AnalysisResult }) {
  const sc = SIGNAL_CONFIG[result.signal] || SIGNAL_CONFIG.HOLD;

  return (
    <Card className="border-2 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge className={cn(sc.bg, sc.color, 'text-lg px-3 py-1 font-bold')}>
              {sc.icon} {result.signal}
            </Badge>
            <span className="text-2xl font-bold">{result.ticker}</span>
          </div>
          <Badge variant="outline">{result.pipeline_display_name}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="text-3xl font-bold">{result.score.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">Score /10</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="text-3xl font-bold">{result.confidence.toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">Confidence</div>
          </div>
        </div>

        {result.signal_counts && (
          <div className="flex gap-2 mb-4">
            {Object.entries(result.signal_counts).map(([sig, count]) => {
              const s = SIGNAL_CONFIG[sig] || SIGNAL_CONFIG.HOLD;
              return (
                <Badge key={sig} className={cn(s.bg, s.color, 'text-xs')}>
                  {sig}: {count as number}
                </Badge>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-1">
            <Settings2 className="h-4 w-4" /> نتائج المحركات
          </h4>
          {result.engines.map((eng) => {
            const ec = ENGINE_CONFIG[eng.name];
            const esc = SIGNAL_CONFIG[eng.signal] || SIGNAL_CONFIG.HOLD;
            return (
              <div key={eng.name} className={cn('flex items-center justify-between p-2 rounded-md', ec?.bgColor || 'bg-muted')}>
                <div className="flex items-center gap-2">
                  <span className={ec?.color}>{ec?.icon}</span>
                  <span className="text-sm font-medium">{ec?.label || eng.name}</span>
                  {!eng.enabled && (
                    <Badge variant="outline" className="text-xs opacity-50">OFF</Badge>
                  )}
                </div>
                {eng.enabled ? (
                  <div className="flex items-center gap-3">
                    <Badge className={cn(esc.bg, esc.color, 'text-xs')}>{eng.signal}</Badge>
                    <span className="text-sm font-mono">{eng.score.toFixed(1)}</span>
                    <span className="text-xs text-muted-foreground">x{eng.weight}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Opportunity Card ----------

function OpportunityCard({ opp }: { opp: DayTradingOpportunity }) {
  const sc = SIGNAL_CONFIG[opp.signal] || SIGNAL_CONFIG.HOLD;
  const profit5 = ((opp.target_5pct - opp.price) / opp.price * 100).toFixed(1);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg">{opp.ticker}</span>
            <Badge className={cn(sc.bg, sc.color, 'text-xs font-bold')}>
              {sc.icon} {opp.signal}
            </Badge>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">{opp.score.toFixed(1)}/10</div>
            <div className="text-xs text-muted-foreground">{opp.confidence.toFixed(0)}%</div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-2">{opp.name}</p>

        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="text-center p-1.5 rounded bg-muted/50">
            <div className="font-semibold">{opp.price.toFixed(2)}</div>
            <div className="text-muted-foreground">السعر</div>
          </div>
          <div className="text-center p-1.5 rounded bg-emerald-50 dark:bg-emerald-950/30">
            <div className="font-semibold text-emerald-700">{opp.target_2pct.toFixed(2)}</div>
            <div className="text-emerald-600">هدف 2%</div>
          </div>
          <div className="text-center p-1.5 rounded bg-emerald-50 dark:bg-emerald-950/30">
            <div className="font-semibold text-emerald-700">{opp.target_5pct.toFixed(2)}</div>
            <div className="text-emerald-600">هدف 5%</div>
          </div>
          <div className="text-center p-1.5 rounded bg-red-50 dark:bg-red-950/30">
            <div className="font-semibold text-red-700">{opp.stop_loss.toFixed(2)}</div>
            <div className="text-red-600">وقف</div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-2 text-xs">
          <span className="text-muted-foreground">R:R = {opp.risk_reward_ratio}</span>
          <Badge variant="outline" className="text-xs">
            <Target className="h-3 w-3 mr-1" /> {profit5}%
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

type SubTab = 'engines' | 'personas' | 'visual';

export default function UnifiedCommandCenter() {
  // ---- Sub-tab state ----
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('engines');

  // ---- Persona state ----
  const [personaStatus, setPersonaStatus] = useState<PersonaStatusResponse | null>(null);
  const [maestroStats, setMaestroStats] = useState<{ win_rate: number; total_signals: number; wins: number; losses: number } | null>(null);

  // ---- Pipeline/Engine state ----
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [activePipeline, setActivePipeline] = useState<string>('egx_balanced');
  const [engineConfigs, setEngineConfigs] = useState<Record<string, PipelineEngine>>({});
  const [ticker, setTicker] = useState('');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [opportunities, setOpportunities] = useState<DayTradingOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [oppLoading, setOppLoading] = useState(false);
  const [engineHealth, setEngineHealth] = useState<HealthData | null>(null);
  const [dataStatusInfo, setDataStatusInfo] = useState<{
    summary: { total: number; fresh: number; stale: number; old: number; error: number; health_score: number };
    categories: { category: string; count: number; status: string; minutes_ago: number | null }[];
  } | null>(null);
  const [presetName, setPresetName] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  // ---- Live polling for health data ----
  const livePoll = useLivePolling<HealthData>(
    async () => {
      const data = await apiCall<HealthData>('/api/v2/health');
      return data || { status: 'unknown', pipelines_count: 0 };
    },
    15000,
    {
      onSuccess: (data) => {
        setEngineHealth(data);
      },
    }
  );

  // ---- Data-status polling (for real health metrics) ----
  const dataStatusPoll = useLivePolling<{
    summary: { total: number; fresh: number; stale: number; old: number; error: number; health_score: number };
    categories: { category: string; count: number; status: string; minutes_ago: number | null }[];
  }>(
    async () => {
      const res = await fetch('/api/data-status');
      const data = await res.json();
      return data;
    },
    30000,
    {
      onSuccess: (data) => {
        if (data?.summary) {
          setDataStatusInfo({ summary: data.summary, categories: data.categories || [] });
        }
      },
    }
  );

  // ---- Persona status polling (Investor 🏦 vs Gambler 🎰) ----
  const personaPoll = useLivePolling<PersonaStatusResponse>(
    async () => {
      const res = await fetch('/api/python/v2/persona/status?XTransformPort=8010');
      const data = await res.json();
      return data;
    },
    60000,
    {
      onSuccess: (data) => {
        if (data) setPersonaStatus(data);
      },
    }
  );

  // ---- Maestro stats polling (win rate) ----
  const maestroPoll = useLivePolling<{ statistics: { win_rate: number; total_signals: number; wins: number; losses: number }; success: boolean }>(
    async () => {
      const res = await fetch('/api/maestro/overview');
      const data = await res.json();
      return data;
    },
    60000,
    {
      onSuccess: (data) => {
        if (data?.statistics) {
          setMaestroStats(data.statistics);
        }
      },
    }
  );

  // ---- Load pipelines on mount ----
  useEffect(() => {
    loadPipelines();
  }, []);

  const loadPipelines = useCallback(async () => {
    const data = await apiCall<PipelineInfo[]>('/api/v2/pipelines');
    if (data && Array.isArray(data)) {
      setPipelines(data);
    }
  }, []);

  // ---- Update engine configs when pipeline changes ----
  useEffect(() => {
    const pipeline = pipelines.find(p => p.name === activePipeline);
    if (pipeline) {
      setEngineConfigs(pipeline.engines);
    }
  }, [activePipeline, pipelines]);

  // ---- Engine toggle/weight handlers ----
  const handleToggleEngine = useCallback(async (engineName: string, enabled: boolean) => {
    setEngineConfigs(prev => ({ ...prev, [engineName]: { ...prev[engineName], enabled } }));
    await apiCall(`/api/v2/pipeline/${activePipeline}/engine/${engineName}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }, [activePipeline]);

  const handleWeightChange = useCallback(async (engineName: string, weight: number) => {
    setEngineConfigs(prev => ({ ...prev, [engineName]: { ...prev[engineName], weight } }));
    await apiCall(`/api/v2/pipeline/${activePipeline}/engine/${engineName}/weight`, {
      method: 'PUT',
      body: JSON.stringify({ weight }),
    });
  }, [activePipeline]);

  // ---- Analyze ----
  const handleAnalyze = useCallback(async () => {
    if (!ticker.trim()) return;
    setLoading(true);
    try {
      const result = await apiCall<AnalysisResult>('/api/v2/analyze', {
        method: 'POST',
        body: JSON.stringify({ ticker: ticker.trim().toUpperCase(), pipeline: activePipeline }),
      });
      if (result) {
        setAnalysisResult(result);
      }
    } finally {
      setLoading(false);
    }
  }, [ticker, activePipeline]);

  // ---- Scan Opportunities ----
  const handleScanOpportunities = useCallback(async () => {
    setOppLoading(true);
    try {
      const data = await apiCall<{ opportunities: DayTradingOpportunity[] }>(
        '/api/v2/day-trading-opportunities?market=egx&pipeline=' + activePipeline
      );
      if (data?.opportunities) {
        setOpportunities(data.opportunities);
      }
    } finally {
      setOppLoading(false);
    }
  }, [activePipeline]);

  // ---- Save Preset ----
  const handleSavePreset = useCallback(async () => {
    if (!presetName.trim()) return;
    const result = await apiCall<{ preset_name: string; message: string }>('/api/v2/pipeline/save-preset', {
      method: 'POST',
      body: JSON.stringify({ pipeline: activePipeline, preset_name: presetName.trim() }),
    });
    if (result) {
      setSaveMessage(`تم حفظ: ${result.preset_name}`);
      setPresetName('');
      loadPipelines();
      setTimeout(() => setSaveMessage(''), 3000);
    }
  }, [presetName, activePipeline, loadPipelines]);

  // ---- Derived data ----
  const currentPipeline = pipelines.find(p => p.name === activePipeline);

  // Health score calculation — additive from REAL metrics (consistent with AdminView)
  const healthScore = useMemo(() => {
    let score = 0;

    // Data Engine health (30 points) — engine running + data status
    if (engineHealth) {
      if (engineHealth.status === 'healthy') score += 20;
      else if (engineHealth.status === 'degraded') score += 10;
      else if (engineHealth.status !== 'stopped') score += 5;
    }
    // Stock/crypto counts from data-status categories
    if (dataStatusInfo) {
      const totalRecords = dataStatusInfo.categories.reduce((sum, c) => sum + (c.count || 0), 0);
      if (totalRecords > 5000) score += 10;
      else if (totalRecords > 500) score += 5;
      else if (totalRecords > 0) score += 2;
    }

    // Data freshness (20 points) — from engineHealth.data_age or data-status
    if (engineHealth?.data_age) {
      const ageMinutes = parseInt(engineHealth.data_age, 10);
      if (!isNaN(ageMinutes)) {
        if (ageMinutes < 30) score += 20;
        else if (ageMinutes < 120) score += 10;
        else if (ageMinutes < 1440) score += 5;
      }
    } else if (dataStatusInfo?.summary) {
      const freshRatio = dataStatusInfo.summary.fresh / (dataStatusInfo.summary.total || 1);
      if (freshRatio >= 0.7) score += 20;
      else if (freshRatio >= 0.4) score += 10;
      else if (freshRatio > 0) score += 5;
    }

    // Predictions health (20 points) — engines online indicates prediction capability
    if (engineHealth) {
      const onlineRatio = (engineHealth.engines_online ?? 0) / (engineHealth.engines_total || 1);
      if (onlineRatio >= 0.8) score += 20;
      else if (onlineRatio >= 0.5) score += 10;
      else if (onlineRatio > 0) score += 5;
    }

    // Services connectivity (15 points)
    if (engineHealth?.status === 'healthy' || engineHealth?.status === 'degraded') score += 8;
    if (engineHealth?.vps_status === 'connected') score += 7;

    // Analysis freshness (15 points) — from data-status health_score
    if (dataStatusInfo?.summary?.health_score) {
      score += Math.round((dataStatusInfo.summary.health_score / 100) * 15);
    }

    return Math.max(0, Math.min(100, score));
  }, [engineHealth, dataStatusInfo]);

  // ---- Live status bar counts ----
  const liveCounts = useMemo(() => [
    { label: 'محركات', value: String(engineHealth?.pipelines_count ?? '—'), tone: 'emerald' as const },
    { label: 'شخصيات', value: String(personaStatus ? Object.keys(personaStatus.status).length : '7'), tone: 'emerald' as const },
    { label: 'Win%', value: maestroStats ? `${maestroStats.win_rate}%` : '—', tone: (maestroStats?.win_rate ?? 0) >= 60 ? 'emerald' as const : 'amber' as const },
  ], [engineHealth, personaStatus, maestroStats]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div dir="rtl" className={cn('h-[calc(100vh-12rem)] flex flex-col gap-0 overflow-hidden')}>
      {/* ===== LIVE STATUS BAR ===== */}
      <div className="flex-shrink-0">
        <LiveStatusBar
          title="مركز القيادة الموحّد"
          now={livePoll.now}
          lastUpdate={livePoll.lastUpdate}
          refreshing={livePoll.refreshing}
          onRefresh={() => { livePoll.refresh(); dataStatusPoll.refresh(); personaPoll.refresh(); maestroPoll.refresh(); }}
          intervalMs={15000}
          secondsUntilNext={livePoll.secondsUntilNext}
          healthScore={healthScore}
          counts={liveCounts}
          badge={engineHealth?.status === 'healthy' ? 'متصل' : engineHealth?.status === 'degraded' ? 'بطيء' : undefined}
        />
      </div>

      {/* ===== SUB-TABS ===== */}
      <div className="flex-shrink-0 mt-3 px-1">
        <div className="flex items-center gap-1 border-b pb-0">
          {([

            { key: 'engines' as SubTab, label: 'محركات', labelEn: 'Engines', icon: Settings2 },
            { key: 'personas' as SubTab, label: 'شخصيات', labelEn: 'Personas', icon: Users },
            { key: 'visual' as SubTab, label: 'مخطط بصري', labelEn: 'Visual', icon: LayoutDashboard },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveSubTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-200',
                activeSubTab === tab.key
                  ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
              )}
            >
              <tab.icon className="h-4 w-4" />
              <span>{tab.label}</span>
              <span className="text-[10px] text-muted-foreground">{tab.labelEn}</span>
            </button>
          ))}

          {/* Health badge in tab bar */}
          <div className="mr-auto flex items-center gap-2">
            {engineHealth && (
              <div className="flex items-center gap-1.5">
                <LiveDot status={engineHealth.status === 'healthy' ? 'running' : engineHealth.status === 'degraded' ? 'degraded' : 'stopped'} />
                <span className="text-xs text-muted-foreground">
                  {engineHealth.status === 'healthy' ? 'المحركات تعمل' :
                   engineHealth.status === 'degraded' ? 'بطيء' : 'متوقف'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== CONTENT AREA ===== */}
      <div className="flex-1 min-h-0 flex gap-4 mt-3 overflow-hidden">
        {/* ---- Main content ---- */}
        <div className={cn(
          'flex-1 min-w-0 min-h-0 overflow-y-auto',
          analysisResult && activeSubTab !== 'visual' ? '' : ''
        )}>

          {/* ===== ENGINES VIEW ===== */}
          {activeSubTab === 'engines' && (
            <div className="space-y-4 pb-6">
              {/* Pipeline selector + preset */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Settings2 className="h-5 w-5" />
                    إعدادات Pipeline
                  </CardTitle>
                  <CardDescription>اختر Pipeline وعدّل المحركات والأوزان</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-1.5 flex-1 min-w-[200px]">
                      <Label>Pipeline</Label>
                      <Select value={activePipeline} onValueChange={setActivePipeline}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pipelines.map(p => (
                            <SelectItem key={p.name} value={p.name}>
                              <span className="flex items-center gap-2">
                                {p.display_name}
                                {p.is_custom && <Badge variant="outline" className="text-[10px]">Custom</Badge>}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {currentPipeline && (
                        <p className="text-xs text-muted-foreground">{currentPipeline.description}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label>حفظ كـ Preset</Label>
                      <div className="flex gap-2">
                        <Input
                          value={presetName}
                          onChange={e => setPresetName(e.target.value)}
                          placeholder="اسم الـ Preset"
                          className="w-40"
                        />
                        <Button onClick={handleSavePreset} disabled={!presetName.trim()} size="sm">
                          <Save className="h-4 w-4 mr-1" /> حفظ
                        </Button>
                      </div>
                      {saveMessage && (
                        <p className="text-xs text-emerald-600">{saveMessage}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Engine cards grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(engineConfigs).map(([name, config]) => {
                  const engResult = analysisResult?.engines?.find(e => e.name === name);
                  return (
                    <EngineCard
                      key={name}
                      engineName={name}
                      config={config}
                      onToggle={(enabled) => handleToggleEngine(name, enabled)}
                      onWeightChange={(weight) => handleWeightChange(name, weight)}
                      result={engResult}
                    />
                  );
                })}
              </div>

              <Separator />

              {/* Analysis section */}
              <Tabs defaultValue="analyze" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="analyze" className="gap-2">
                    <Play className="h-4 w-4" /> تحليل سهم
                  </TabsTrigger>
                  <TabsTrigger value="opportunities" className="gap-2">
                    <Zap className="h-4 w-4" /> فرص يومية
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="analyze" className="space-y-4 mt-4">
                  <div className="flex gap-2">
                    <Input
                      value={ticker}
                      onChange={e => setTicker(e.target.value.toUpperCase())}
                      placeholder="أدخل رمز السهم (مثال: ABUK)"
                      className="max-w-xs"
                      onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
                    />
                    <Button onClick={handleAnalyze} disabled={loading || !ticker.trim()}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      تحليل
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="opportunities" className="space-y-4 mt-4">
                  <div className="flex items-center gap-3">
                    <Button onClick={handleScanOpportunities} disabled={oppLoading}>
                      {oppLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                      مسح الفرص اليومية
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {opportunities.length > 0 ? `${opportunities.length} فرصة` : ''}
                    </span>
                  </div>

                  {opportunities.length > 0 && (
                    <ScrollArea className="max-h-96">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {opportunities.map(opp => (
                          <OpportunityCard key={opp.ticker} opp={opp} />
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* ===== PERSONAS VIEW (Investor 🏦 vs Gambler 🎰) ===== */}
          {activeSubTab === 'personas' && (
            <div className="space-y-4 pb-6">
              {/* Maestro Stats Overview */}
              <Card className="border-2 border-primary/20 bg-gradient-to-l from-primary/5 to-transparent">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-amber-500" />
                      <h3 className="font-bold text-sm">إحصائيات التوقعات — Maestro</h3>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {personaStatus?.date || '—'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                      <div className="text-2xl font-bold text-emerald-700">
                        {maestroStats ? `${maestroStats.win_rate}%` : '—'}
                      </div>
                      <div className="text-[10px] text-muted-foreground">نسبة النجاح</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-muted/50">
                      <div className="text-2xl font-bold">
                        {maestroStats?.total_signals ?? '—'}
                      </div>
                      <div className="text-[10px] text-muted-foreground">إجمالي الإشارات</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                      <div className="text-2xl font-bold text-emerald-600">
                        {maestroStats?.wins ?? '—'}
                      </div>
                      <div className="text-[10px] text-muted-foreground">نجاح</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/30">
                      <div className="text-2xl font-bold text-red-600">
                        {maestroStats?.losses ?? '—'}
                      </div>
                      <div className="text-[10px] text-muted-foreground">خسارة</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Investor vs Gambler Comparison */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Investor Column */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Landmark className="h-5 w-5 text-emerald-600" />
                    <h3 className="font-bold text-emerald-700 dark:text-emerald-400">المستثمر 🏦 Investor</h3>
                    <Badge variant="outline" className="text-[10px] border-emerald-400">Quality Gate ≥ 60</Badge>
                  </div>
                  <div className="space-y-3">
                    {Object.entries(PERSONA_CONFIG)
                      .filter(([, cfg]) => cfg.category === 'investor')
                      .map(([key]) => (
                        <PersonaCard
                          key={key}
                          personaKey={key}
                          statusData={personaStatus?.status?.[key]}
                        />
                      ))}
                  </div>
                </div>

                {/* Gambler Column */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Dice1 className="h-5 w-5 text-red-600" />
                    <h3 className="font-bold text-red-700 dark:text-red-400">المضارب 🎰 Gambler</h3>
                    <Badge variant="outline" className="text-[10px] border-red-400">MR Signal (F_MR_TIGHT)</Badge>
                  </div>
                  <div className="space-y-3">
                    {Object.entries(PERSONA_CONFIG)
                      .filter(([, cfg]) => cfg.category === 'gambler')
                      .map(([key]) => (
                        <PersonaCard
                          key={key}
                          personaKey={key}
                          statusData={personaStatus?.status?.[key]}
                        />
                      ))}
                  </div>
                </div>
              </div>

              {/* Balanced */}
              <div className="max-w-md">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-5 w-5 text-sky-600" />
                  <h3 className="font-bold text-sky-700 dark:text-sky-400">المتوازن ⚖️ Balanced</h3>
                </div>
                {Object.entries(PERSONA_CONFIG)
                  .filter(([, cfg]) => cfg.category === 'balanced')
                  .map(([key]) => (
                    <PersonaCard
                      key={key}
                      personaKey={key}
                      statusData={personaStatus?.status?.[key]}
                    />
                  ))}
              </div>

              {/* MR Signal Conditions */}
              <Card className="border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-400">
                    <Activity className="h-5 w-5" />
                    MR Signal Conditions (F_MR_TIGHT) — 🎰 Gambler Trigger
                  </CardTitle>
                  <CardDescription>عند تحقق كل الشروط → STRONG_BUY override للمضارب</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="flex items-start gap-2 p-2 rounded bg-white/50 dark:bg-black/20">
                      <Badge variant="outline" className="text-[10px] mt-0.5 border-red-400">1</Badge>
                      <div>
                        <p className="font-semibold">RSI(2) ≤ 10</p>
                        <p className="text-xs text-muted-foreground">مؤشر القوة النسبية لمدة يومين أقل من 10</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-2 rounded bg-white/50 dark:bg-black/20">
                      <Badge variant="outline" className="text-[10px] mt-0.5 border-red-400">2</Badge>
                      <div>
                        <p className="font-semibold">Close &gt; SMA20</p>
                        <p className="text-xs text-muted-foreground">الإغلاق أعلى من المتوسط المتحرك 20 يوم</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-2 rounded bg-white/50 dark:bg-black/20">
                      <Badge variant="outline" className="text-[10px] mt-0.5 border-red-400">3</Badge>
                      <div>
                        <p className="font-semibold">شمعة خضراء</p>
                        <p className="text-xs text-muted-foreground">آخر شمعة إغلاق أعلى من افتتاح</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-2 rounded bg-white/50 dark:bg-black/20">
                      <Badge variant="outline" className="text-[10px] mt-0.5 border-red-400">4</Badge>
                      <div>
                        <p className="font-semibold">Conviction ≥ 3/5</p>
                        <p className="text-xs text-muted-foreground">ثقة 3 أو أكثر من 5 (تخطي Dead Zone = 4)</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ===== VISUAL VIEW (FlowCanvas) ===== */}
          {activeSubTab === 'visual' && (
            <div className="h-full min-h-0">
              <FlowCanvas />
            </div>
          )}
        </div>

        {/* ===== RIGHT PANEL: Analysis Results (visible when analysis exists and not in visual tab) ===== */}
        {analysisResult && activeSubTab !== 'visual' && (
          <div className="w-80 flex-shrink-0 overflow-y-auto border-l pl-4 hidden lg:block">
            <div className="space-y-4 pb-6">
              <h3 className="text-sm font-semibold flex items-center gap-2 sticky top-0 bg-background py-2 z-10">
                <Sparkles className="h-4 w-4 text-amber-500" />
                نتائج التحليل
              </h3>
              <AnalysisResultCard result={analysisResult} />

              {/* Opportunities shortcut */}
              {opportunities.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                    <Target className="h-3 w-3" /> فرص يومية ({opportunities.length})
                  </h4>
                  <ScrollArea className="max-h-72">
                    <div className="space-y-2">
                      {opportunities.slice(0, 5).map(opp => (
                        <div key={opp.ticker} className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{opp.ticker}</span>
                            <Badge className={cn(
                              SIGNAL_CONFIG[opp.signal]?.bg || '',
                              SIGNAL_CONFIG[opp.signal]?.color || '',
                              'text-[10px]'
                            )}>
                              {opp.signal}
                            </Badge>
                          </div>
                          <div className="text-left">
                            <div className="font-mono">{opp.score.toFixed(1)}/10</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
