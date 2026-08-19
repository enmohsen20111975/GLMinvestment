'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Settings,
  Sliders,
  Save,
  RotateCcw,
  Zap,
  Shield,
  Eye,
  Brain,
  Sparkles,
  LayoutGrid,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

// ─── Types ──────────────────────────────────────────────────────────────────

export type EngineState = 'on' | 'bypass' | 'off' | 'disconnected';

export interface EngineSettings {
  engines: EngineConfig[];
  activePreset: string | null;
}

export interface EngineConfig {
  id: string;
  name: string;
  name_ar: string;
  weight: number;
  state: EngineState;
  parameters: Record<string, number>;
  parameterDefaults: Record<string, number>;
  parameterLabels: Record<string, string>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'engine-control-settings';
const WEIGHT_MIN = 0.0;
const WEIGHT_MAX = 2.0;
const WEIGHT_STEP = 0.1;
const WEIGHT_DEFAULT = 1.0;

const DEFAULT_ENGINES: EngineConfig[] = [
  {
    id: 'mr_signal',
    name: 'MR Signal',
    name_ar: 'إشارة MR',
    weight: 1.0,
    state: 'on',
    parameters: {
      rsi_period: 14,
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
    },
    parameterDefaults: {
      rsi_period: 14,
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
    },
    parameterLabels: {
      rsi_period: 'فترة RSI',
      macd_fast: 'MACD سريع',
      macd_slow: 'MACD بطيء',
      macd_signal: 'إشارة MACD',
    },
  },
  {
    id: 'quality_gate',
    name: 'Quality Gate',
    name_ar: 'بوابة الجودة',
    weight: 1.0,
    state: 'on',
    parameters: {
      min_volume_threshold: 100000,
      min_market_cap: 0,
      pe_max: 50,
    },
    parameterDefaults: {
      min_volume_threshold: 100000,
      min_market_cap: 0,
      pe_max: 50,
    },
    parameterLabels: {
      min_volume_threshold: 'حد الحد الأدنى للحجم',
      min_market_cap: 'الحد الأدنى للقيمة السوقية',
      pe_max: 'الحد الأقصى P/E',
    },
  },
  {
    id: 'event_tracker',
    name: 'Event Tracker',
    name_ar: 'متتبع الأحداث',
    weight: 1.0,
    state: 'on',
    parameters: {
      news_weight: 0.5,
      regime_weight: 0.3,
      calendar_weight: 0.2,
    },
    parameterDefaults: {
      news_weight: 0.5,
      regime_weight: 0.3,
      calendar_weight: 0.2,
    },
    parameterLabels: {
      news_weight: 'وزن الأخبار',
      regime_weight: 'وزن النظام',
      calendar_weight: 'وزن التقويم',
    },
  },
  {
    id: 'devils_adjustment',
    name: "Devil's Adjustment",
    name_ar: 'تعديل الشيطان',
    weight: 1.0,
    state: 'on',
    parameters: {
      trap_sensitivity: 0.7,
      adjustment_max: -15,
    },
    parameterDefaults: {
      trap_sensitivity: 0.7,
      adjustment_max: -15,
    },
    parameterLabels: {
      trap_sensitivity: 'حساسية الفخ',
      adjustment_max: 'الحد الأقصى للتعديل',
    },
  },
  {
    id: 'expert_memory',
    name: 'Expert Memory',
    name_ar: 'ذاكرة الخبير',
    weight: 1.0,
    state: 'on',
    parameters: {
      min_trades: 3,
      win_rate_threshold: 65,
      boost_amount: 8,
    },
    parameterDefaults: {
      min_trades: 3,
      win_rate_threshold: 65,
      boost_amount: 8,
    },
    parameterLabels: {
      min_trades: 'الحد الأدنى للصفقات',
      win_rate_threshold: 'عتبة نسبة الفوز %',
      boost_amount: 'مقدار التعزيز +',
    },
  },
];

interface PresetTemplate {
  id: string;
  name_ar: string;
  name_en: string;
  weights: Record<string, number>;
  states?: Record<string, EngineState>;
}

const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: 'default',
    name_ar: 'افتراضى',
    name_en: 'Default',
    weights: {
      mr_signal: 1.0,
      quality_gate: 1.0,
      event_tracker: 1.0,
      devils_adjustment: 1.0,
      expert_memory: 1.0,
    },
  },
  {
    id: 'conservative',
    name_ar: 'مستثمر',
    name_en: 'Conservative',
    weights: {
      mr_signal: 0.8,
      quality_gate: 1.5,
      event_tracker: 1.0,
      devils_adjustment: 1.2,
      expert_memory: 1.5,
    },
  },
  {
    id: 'aggressive',
    name_ar: 'مضارب',
    name_en: 'Aggressive',
    weights: {
      mr_signal: 1.5,
      quality_gate: 0.5,
      event_tracker: 1.0,
      devils_adjustment: 0.3,
      expert_memory: 0.5,
    },
  },
  {
    id: 'day_trader',
    name_ar: 'يومى',
    name_en: 'Day Trader',
    weights: {
      mr_signal: 1.3,
      quality_gate: 0.7,
      event_tracker: 1.8,
      devils_adjustment: 1.0,
      expert_memory: 1.0,
    },
  },
  {
    id: 'lab',
    name_ar: 'مختبر',
    name_en: 'Lab',
    weights: {
      mr_signal: 0.5,
      quality_gate: 0.5,
      event_tracker: 0.5,
      devils_adjustment: 0.5,
      expert_memory: 0.5,
    },
  },
];

// ─── Engine Icon Map ────────────────────────────────────────────────────────

const ENGINE_ICONS: Record<string, React.ElementType> = {
  mr_signal: Zap,
  quality_gate: Shield,
  event_tracker: Eye,
  devils_adjustment: Sparkles,
  expert_memory: Brain,
};

// ─── State Configuration ────────────────────────────────────────────────────

const ENGINE_STATE_CONFIG: Record<
  EngineState,
  { label_ar: string; emoji: string; color: string; bgClass: string; borderClass: string }
> = {
  on: {
    label_ar: 'مفعّل',
    emoji: '🟢',
    color: 'text-emerald-600',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
  },
  bypass: {
    label_ar: 'تجاوز',
    emoji: '🟡',
    color: 'text-amber-600',
    bgClass: 'bg-amber-50 dark:bg-amber-950/30',
    borderClass: 'border-amber-200 dark:border-amber-800',
  },
  off: {
    label_ar: 'معطّل',
    emoji: '🔴',
    color: 'text-red-600',
    bgClass: 'bg-red-50 dark:bg-red-950/30',
    borderClass: 'border-red-200 dark:border-red-800',
  },
  disconnected: {
    label_ar: 'غير متصل',
    emoji: '⚫',
    color: 'text-gray-500',
    bgClass: 'bg-gray-50 dark:bg-gray-900/30',
    borderClass: 'border-gray-200 dark:border-gray-700',
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getWeightColorClass(weight: number): string {
  if (weight > 1.0) return 'text-emerald-600 dark:text-emerald-400';
  if (weight < 0.8) return 'text-amber-600 dark:text-amber-400';
  return 'text-foreground';
}

function getWeightBadgeVariant(weight: number): { label: string; className: string } {
  if (weight > 1.0) {
    return { label: 'معزّز', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' };
  }
  if (weight < 0.8) {
    return { label: 'مخفّض', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800' };
  }
  return { label: 'عادى', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700' };
}

function getSliderTrackClass(weight: number): string {
  if (weight > 1.0) return '[&_[data-slot=slider-range]]:bg-emerald-500 [&_[data-slot=slider-thumb]]:border-emerald-500';
  if (weight < 0.8) return '[&_[data-slot=slider-range]]:bg-amber-500 [&_[data-slot=slider-thumb]]:border-amber-500';
  return '[&_[data-slot=slider-range]]:bg-gray-400 [&_[data-slot=slider-thumb]]:border-gray-400';
}

function loadSettings(): EngineSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EngineSettings;
  } catch {
    return null;
  }
}

function saveSettings(settings: EngineSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save engine settings:', err);
  }
}

function buildInitialEngines(): EngineConfig[] {
  const saved = loadSettings();
  if (!saved?.engines) return DEFAULT_ENGINES.map((e) => ({ ...e, parameters: { ...e.parameters } }));

  return DEFAULT_ENGINES.map((def) => {
    const savedEngine = saved.engines.find((se) => se.id === def.id);
    if (!savedEngine) return { ...def, parameters: { ...def.parameters } };

    return {
      ...def,
      weight: savedEngine.weight ?? def.weight,
      state: savedEngine.state ?? def.state,
      parameters: { ...def.parameters, ...savedEngine.parameters },
    };
  });
}

function buildInitialPreset(): string | null {
  const saved = loadSettings();
  return saved?.activePreset ?? 'default';
}

function matchesPreset(engines: EngineConfig[], preset: PresetTemplate): boolean {
  return engines.every((e) => {
    const presetWeight = preset.weights[e.id];
    return presetWeight !== undefined && Math.abs(e.weight - presetWeight) < 0.001;
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function UnifiedControlTab() {
  const [engines, setEngines] = useState<EngineConfig[]>(buildInitialEngines);
  const [activePreset, setActivePreset] = useState<string | null>(buildInitialPreset);
  const [paramSheetEngineId, setParamSheetEngineId] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Hydration guard
  useEffect(() => {
    setMounted(true);
  }, []);

  // Detect which preset is active
  const detectedPreset = useMemo(() => {
    for (const preset of PRESET_TEMPLATES) {
      if (matchesPreset(engines, preset)) return preset.id;
    }
    return null;
  }, [engines]);

  const isCustom = detectedPreset === null;

  // Persist on change
  useEffect(() => {
    if (!mounted) return;
    saveSettings({ engines, activePreset });
  }, [engines, activePreset, mounted]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleWeightChange = useCallback((engineId: string, newWeight: number[]) => {
    const w = Math.round(newWeight[0] * 10) / 10;
    setEngines((prev) =>
      prev.map((e) => (e.id === engineId ? { ...e, weight: w } : e))
    );
  }, []);

  const handleStateChange = useCallback((engineId: string, newState: EngineState) => {
    setEngines((prev) =>
      prev.map((e) => (e.id === engineId ? { ...e, state: newState } : e))
    );
  }, []);

  const handleParameterChange = useCallback(
    (engineId: string, paramKey: string, value: number) => {
      setEngines((prev) =>
        prev.map((e) =>
          e.id === engineId
            ? { ...e, parameters: { ...e.parameters, [paramKey]: value } }
            : e
        )
      );
    },
    []
  );

  const handleParameterReset = useCallback(
    (engineId: string, paramKey: string) => {
      setEngines((prev) =>
        prev.map((e) => {
          if (e.id !== engineId) return e;
          const defaultValue = e.parameterDefaults[paramKey];
          return {
            ...e,
            parameters: { ...e.parameters, [paramKey]: defaultValue },
          };
        })
      );
      toast.success('تم استعادة القيمة الافتراضية');
    },
    []
  );

  const handleResetAllParameters = useCallback((engineId: string) => {
    setEngines((prev) =>
      prev.map((e) => {
        if (e.id !== engineId) return e;
        return { ...e, parameters: { ...e.parameterDefaults } };
      })
    );
    toast.success('تم استعادة جميع المعلمات الافتراضية');
  }, []);

  const applyPreset = useCallback((preset: PresetTemplate) => {
    setEngines((prev) =>
      prev.map((e) => ({
        ...e,
        weight: preset.weights[e.id] ?? e.weight,
        state: preset.states?.[e.id] ?? e.state,
      }))
    );
    setActivePreset(preset.id);
    toast.success(`تم تطبيق القالب: ${preset.name_ar}`);
  }, []);

  const handleSaveAsCustom = useCallback(() => {
    setActivePreset(null);
    saveSettings({ engines, activePreset: null });
    toast.success('تم حفظ الإعدادات كقالب مخصص');
  }, [engines]);

  const handleRestoreTemplate = useCallback(() => {
    const targetPresetId = activePreset ?? 'default';
    const preset = PRESET_TEMPLATES.find((p) => p.id === targetPresetId);
    if (preset) {
      applyPreset(preset);
    }
  }, [activePreset, applyPreset]);

  const openParameterSheet = useCallback((engineId: string) => {
    setParamSheetEngineId(engineId);
    setIsSheetOpen(true);
  }, []);

  // ─── Derived ────────────────────────────────────────────────────────────

  const activeEngine = useMemo(
    () => engines.find((e) => e.id === paramSheetEngineId) ?? null,
    [engines, paramSheetEngineId]
  );

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!mounted) {
    return (
      <div className="flex items-center justify-center py-20" dir="rtl">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Sliders className="size-5 animate-pulse" />
          <span>جارٍ تحميل لوحة التحكم...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <LayoutGrid className="size-6 text-emerald-600" />
          <h2 className="text-xl font-bold">لوحة التحكم الموحدة</h2>
        </div>
        {isCustom && (
          <Badge
            className={cn(
              'gap-1 border text-xs font-medium',
              'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700'
            )}
          >
            <AlertTriangle className="size-3" />
            مخصصة
          </Badge>
        )}
      </div>

      {/* ── Preset Templates ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sliders className="size-4 text-emerald-500" />
            قوالب جاهزة
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESET_TEMPLATES.map((preset) => {
              const isActive = detectedPreset === preset.id;
              return (
                <Button
                  key={preset.id}
                  variant={isActive ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    'gap-1.5 text-xs transition-all',
                    isActive
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                      : 'hover:border-emerald-300 hover:text-emerald-600'
                  )}
                >
                  {isActive && <span className="size-1.5 rounded-full bg-white" />}
                  {preset.name_ar}
                  <span className="text-[10px] opacity-60">({preset.name_en})</span>
                </Button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestoreTemplate}
              className="gap-1.5 text-xs"
            >
              <RotateCcw className="size-3.5" />
              استعادة القالب
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveAsCustom}
              className="gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/30"
            >
              <Save className="size-3.5" />
              حفظ كقالب مخصص
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Engine Cards ────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {engines.map((engine) => {
          const IconComponent = ENGINE_ICONS[engine.id] ?? Zap;
          const stateConfig = ENGINE_STATE_CONFIG[engine.state];
          const weightBadge = getWeightBadgeVariant(engine.weight);
          const isDisconnected = engine.state === 'disconnected';

          return (
            <Card
              key={engine.id}
              className={cn(
                'transition-all duration-200',
                isDisconnected && 'opacity-60'
              )}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-lg',
                        stateConfig.bgClass,
                        stateConfig.borderClass,
                        'border'
                      )}
                    >
                      <IconComponent className={cn('size-4', stateConfig.color)} />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm leading-tight truncate">
                        {engine.name_ar}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground truncate">
                        {engine.name}
                      </p>
                    </div>
                  </div>

                  {/* Parameter gear button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={() => openParameterSheet(engine.id)}
                    aria-label={`إعدادات ${engine.name_ar}`}
                  >
                    <Settings className="size-4 text-muted-foreground hover:text-foreground" />
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Four-State Toggle */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">حالة المحرك</Label>
                  <Select
                    value={engine.state}
                    onValueChange={(val: EngineState) =>
                      handleStateChange(engine.id, val)
                    }
                    disabled={isDisconnected}
                  >
                    <SelectTrigger
                      className={cn(
                        'w-full text-xs',
                        stateConfig.bgClass,
                        stateConfig.borderClass,
                        'border'
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(ENGINE_STATE_CONFIG) as [
                          EngineState,
                          (typeof ENGINE_STATE_CONFIG)[EngineState],
                        ][]
                      ).map(([stateKey, config]) => (
                        <SelectItem key={stateKey} value={stateKey} className="text-xs">
                          <span className="flex items-center gap-2">
                            <span>{config.emoji}</span>
                            <span>{config.label_ar}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Weight Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">الوزن</Label>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn('text-[10px] px-1.5 py-0', weightBadge.className)}
                      >
                        {weightBadge.label}
                      </Badge>
                      <span
                        className={cn(
                          'text-sm font-bold tabular-nums min-w-[2.5rem] text-left',
                          getWeightColorClass(engine.weight)
                        )}
                      >
                        {engine.weight.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <Slider
                    value={[engine.weight]}
                    min={WEIGHT_MIN}
                    max={WEIGHT_MAX}
                    step={WEIGHT_STEP}
                    onValueChange={(val) => handleWeightChange(engine.id, val)}
                    disabled={engine.state === 'off' || isDisconnected}
                    className={cn('w-full', getSliderTrackClass(engine.weight))}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
                    <span>0.0</span>
                    <span className="text-emerald-500/70">1.0</span>
                    <span>2.0</span>
                  </div>
                </div>

                {/* State Indicator Row */}
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs',
                    stateConfig.bgClass,
                    stateConfig.borderClass,
                    'border'
                  )}
                >
                  <span className="text-base leading-none">{stateConfig.emoji}</span>
                  <span className={cn('font-medium', stateConfig.color)}>
                    {stateConfig.label_ar}
                  </span>
                  {isDisconnected && (
                    <span className="mr-auto text-[10px] text-gray-400">
                      غير متاح حاليًا
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Parameter Editor Sheet ──────────────────────────────────────── */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
          {activeEngine && (
            <>
              <SheetHeader className="space-y-1 pb-2">
                <div className="flex items-center gap-2.5">
                  {(() => {
                    const Icon = ENGINE_ICONS[activeEngine.id] ?? Zap;
                    return <Icon className="size-5 text-emerald-600" />;
                  })()}
                  <SheetTitle className="text-base">
                    {activeEngine.name_ar}
                  </SheetTitle>
                </div>
                <p className="text-xs text-muted-foreground">
                  {activeEngine.name} — تحرير المعلمات
                </p>
              </SheetHeader>

              <Separator className="my-3" />

              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <Label className="text-xs text-muted-foreground">
                    المعلمات ({Object.keys(activeEngine.parameters).length})
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleResetAllParameters(activeEngine.id)}
                    className="gap-1 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 h-7"
                  >
                    <RotateCcw className="size-3" />
                    إعادة تعيين الكل
                  </Button>
                </div>
              </div>

              <ScrollArea className="flex-1 -mx-1">
                <div className="space-y-4 px-1 pb-6">
                  {Object.entries(activeEngine.parameters).map(
                    ([paramKey, currentValue]) => {
                      const defaultValue =
                        activeEngine.parameterDefaults[paramKey] ?? currentValue;
                      const label = activeEngine.parameterLabels[paramKey] ?? paramKey;
                      const isModified = currentValue !== defaultValue;

                      return (
                        <div
                          key={paramKey}
                          className={cn(
                            'rounded-lg border p-3 space-y-2 transition-colors',
                            isModified
                              ? 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
                              : 'border-border bg-card'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">{label}</Label>
                            {isModified && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700"
                              >
                                معدّل
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              value={currentValue}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val)) {
                                  handleParameterChange(
                                    activeEngine.id,
                                    paramKey,
                                    val
                                  );
                                }
                              }}
                              className="h-8 text-sm tabular-nums"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 text-muted-foreground hover:text-red-500"
                              onClick={() =>
                                handleParameterReset(activeEngine.id, paramKey)
                              }
                              disabled={!isModified}
                              aria-label={`إعادة تعيين ${label}`}
                              title="إعادة تعيين إلى الافتراضي"
                            >
                              <RotateCcw className="size-3.5" />
                            </Button>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>
                              الافتراضي: <span className="tabular-nums">{defaultValue}</span>
                            </span>
                            {isModified && (
                              <span className="text-amber-600 dark:text-amber-400 tabular-nums">
                                الفرق: {currentValue > defaultValue ? '+' : ''}
                                {(currentValue - defaultValue).toFixed(
                                  Number.isInteger(defaultValue) ? 0 : 1
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </ScrollArea>

              {/* Sheet Footer */}
              <div className="border-t pt-3 mt-auto space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
                  <span>
                    التغييرات تُحفظ تلقائيًا في المتصفح
                  </span>
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={() => handleResetAllParameters(activeEngine.id)}
                >
                  <RotateCcw className="size-4" />
                  استعادة جميع القيم الافتراضية
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
