'use client';

/**
 * MaestroCommandCenter (مركز قيادة المايسترو)
 * =============================================
 * Visual dashboard showing the COMPLETE system architecture:
 * 
 * - 4 Prediction Engines
 * - 3 Personas (Conservative, Balanced, Gambler)
 * - Maestro Orchestrator (The Brain)
 * - 6 Analysis Phases
 * - 4 Databases
 * - Background Analyzer
 * - Expert Memory + Feedback Loop
 * 
 * RTL Arabic interface with live data from /api/maestro/command-center
 */

import React, { useState, useEffect } from 'react';
import {
  Brain, Shield, Zap, Activity, Clock, BarChart3,
  Newspaper, Users, Database, Heart, TrendingUp,
  Target, RefreshCw, Loader2, CheckCircle2, AlertCircle,
  XCircle, ArrowDown, Cpu, Sparkles, GitMerge,
  BookOpen, CircleDot, Layers, Server, Wifi,
  ArrowRight, ChevronDown, ChevronUp, Info,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

// ==================== TYPES ====================

interface EngineStatus {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  icon: string;
  status: 'active' | 'idle' | 'error' | 'unknown';
  lastRun: string | null;
  recordsProcessed: number;
  color: string;
}

interface PersonaInfo {
  id: string;
  name: string;
  nameAr: string;
  emoji: string;
  description: string;
  descriptionAr: string;
  buyThreshold: number;
  riskTolerance: number;
  stopLossPercent: number;
  targetMultiplier: number;
  color: string;
}

interface PhaseInfo {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  icon: string;
  order: number;
  color: string;
}

interface DatabaseInfo {
  id: string;
  name: string;
  nameAr: string;
  icon: string;
  tables: string[];
  sizeKB: number;
  exists: boolean;
  lastModified: string | null;
  status: 'healthy' | 'missing' | 'empty';
  color: string;
}

interface CommandCenterData {
  success: boolean;
  timestamp: string;
  system: {
    name: string;
    nameAr: string;
    version: string;
    status: string;
    uptime: number;
  };
  stats: {
    totalStocks: number;
    totalPredictions: number;
    totalPersonaPredictions: number;
    marketRegime: string;
    regimeConfidence: number;
    lastAnalysisTime: string | null;
    expertMemoryCount: number;
    feedbackAdjustments: number;
  };
  engines: EngineStatus[];
  personas: PersonaInfo[];
  phases: PhaseInfo[];
  databases: DatabaseInfo[];
  architecture: {
    layers: Array<{
      id: string;
      nameAr: string;
      items: string[];
    }>;
  };
}

// ==================== HELPERS ====================

const ICON_MAP: Record<string, React.ElementType> = {
  Brain, Shield: Shield, Zap, Activity, Clock, BarChart3,
  Newspaper, Users, Database, Heart, TrendingUp, Target,
  Cpu, Sparkles, GitMerge, BookOpen, CircleDot, Layers,
  Server, Wifi,
};

function getIcon(name: string): React.ElementType {
  return ICON_MAP[name] || Activity;
}

const REGIME_CONFIG = {
  bull: { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/30', label: 'صاعد 📈', labelEn: 'Bull' },
  bear: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30', label: 'هابط 📉', labelEn: 'Bear' },
  range: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30', label: 'متراوح ↔️', labelEn: 'Range' },
};

const STATUS_CONFIG = {
  active: { color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30', icon: CheckCircle2, label: 'نشط' },
  idle: { color: 'text-amber-600', bg: 'bg-amber-100 dark:bg-amber-900/30', icon: Clock, label: 'خامل' },
  error: { color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30', icon: XCircle, label: 'خطأ' },
  unknown: { color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-gray-900/30', icon: AlertCircle, label: 'غير معروف' },
};

const COLOR_CLASSES: Record<string, { bg: string; border: string; text: string; light: string }> = {
  emerald: { bg: 'bg-emerald-500', border: 'border-emerald-500/30', text: 'text-emerald-600 dark:text-emerald-400', light: 'bg-emerald-50 dark:bg-emerald-950/30' },
  teal: { bg: 'bg-teal-500', border: 'border-teal-500/30', text: 'text-teal-600 dark:text-teal-400', light: 'bg-teal-50 dark:bg-teal-950/30' },
  cyan: { bg: 'bg-cyan-500', border: 'border-cyan-500/30', text: 'text-cyan-600 dark:text-cyan-400', light: 'bg-cyan-50 dark:bg-cyan-950/30' },
  amber: { bg: 'bg-amber-500', border: 'border-amber-500/30', text: 'text-amber-600 dark:text-amber-400', light: 'bg-amber-50 dark:bg-amber-950/30' },
  orange: { bg: 'bg-orange-500', border: 'border-orange-500/30', text: 'text-orange-600 dark:text-orange-400', light: 'bg-orange-50 dark:bg-orange-950/30' },
  red: { bg: 'bg-red-500', border: 'border-red-500/30', text: 'text-red-600 dark:text-red-400', light: 'bg-red-50 dark:bg-red-950/30' },
  purple: { bg: 'bg-purple-500', border: 'border-purple-500/30', text: 'text-purple-600 dark:text-purple-400', light: 'bg-purple-50 dark:bg-purple-950/30' },
  blue: { bg: 'bg-blue-500', border: 'border-blue-500/30', text: 'text-blue-600 dark:text-blue-400', light: 'bg-blue-50 dark:bg-blue-950/30' },
  yellow: { bg: 'bg-yellow-500', border: 'border-yellow-500/30', text: 'text-yellow-600 dark:text-yellow-400', light: 'bg-yellow-50 dark:bg-yellow-950/30' },
};

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return 'غير متوفر';
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'الآن';
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    return `منذ ${days} يوم`;
  } catch {
    return 'غير متوفر';
  }
}

function formatSize(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} ساعة ${minutes} دقيقة`;
  return `${minutes} دقيقة`;
}

// ==================== COMPONENT ====================

export default function MaestroCommandCenter() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    orchestrator: true,
    engines: true,
    personas: true,
    phases: true,
    databases: true,
    learning: true,
    flow: false,
  });

  const fetchData = async () => {
    try {
      const res = await fetch('/api/maestro/command-center');
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (e) {
      console.error('Error fetching command center data:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" dir="rtl">
        <div className="text-center space-y-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto animate-pulse">
              <Brain className="w-8 h-8 text-white" />
            </div>
            <Loader2 className="w-5 h-5 animate-spin text-emerald-600 absolute -bottom-1 -right-1 bg-background rounded-full" />
          </div>
          <p className="text-muted-foreground font-medium">جاري تحميل مركز القيادة...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" dir="rtl">
        <div className="text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">لم يتم العثور على بيانات</p>
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 ml-2" />
            إعادة المحاولة
          </Button>
        </div>
      </div>
    );
  }

  const regime = REGIME_CONFIG[(data.stats.marketRegime as keyof typeof REGIME_CONFIG)] || REGIME_CONFIG.range;

  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      {/* ===== HEADER ===== */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{data.system.nameAr}</h1>
            <p className="text-sm text-muted-foreground">مركز التحليل v{data.system.version}</p>
          </div>
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3 ml-1" />
            يعمل
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground text-left">
            <span>آخر تحديث: {formatTimeAgo(data.timestamp)}</span>
            <br />
            <span>وقت التشغيل: {formatUptime(data.system.uptime)}</span>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* ===== QUICK STATS ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span className="text-xs text-muted-foreground">إجمالي الأسهم</span>
            </div>
            <div className="text-2xl font-bold">{data.stats.totalStocks}</div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-amber-600" />
              <span className="text-xs text-muted-foreground">التوقعات</span>
            </div>
            <div className="text-2xl font-bold">{data.stats.totalPredictions}</div>
          </CardContent>
        </Card>
        <Card className={cn('overflow-hidden', regime.bg)}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className={cn('w-4 h-4', regime.color)} />
              <span className="text-xs text-muted-foreground">حالة السوق</span>
            </div>
            <div className={cn('text-xl font-bold', regime.color)}>{regime.label}</div>
            <Progress value={data.stats.regimeConfidence} className="h-1.5 mt-1" />
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-purple-600" />
              <span className="text-xs text-muted-foreground">توقعات الشخصيات</span>
            </div>
            <div className="text-2xl font-bold">{data.stats.totalPersonaPredictions}</div>
          </CardContent>
        </Card>
      </div>

      {/* ===== SYSTEM ORCHESTRATOR ===== */}
      <Card className={cn('border-2', COLOR_CLASSES.emerald.border)}>
        <CardHeader className="cursor-pointer" onClick={() => toggleSection('orchestrator')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">🎶 نظام المايسترو — الموحد</CardTitle>
                <CardDescription>محرك التحليل الموحد</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-500/20">
                <Zap className="w-3 h-3 ml-1" />
                نشط
              </Badge>
              {expandedSections.orchestrator ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardHeader>
        {expandedSections.orchestrator && (
          <CardContent>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                المايسترو هو القائد الأوركسترالي للنظام — ينسق بين جميع مراحل التحليل الستة ويخرج بالتوقع النهائي لكل شخصية.
                يبدأ بكشف حالة السوق، ثم يوافق الإشارات عبر الأطر الزمنية، يحلل الحجم والأخبار، يحسب الدرجة النهائية، ويخصصها لكل شخصية.
              </p>
              
              {/* Flow Visualization */}
              <div className="flex flex-wrap items-center justify-center gap-2 py-3">
                {data.phases.map((phase, i) => {
                  const colors = COLOR_CLASSES[phase.color] || COLOR_CLASSES.emerald;
                  return (
                    <React.Fragment key={phase.id}>
                      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border', colors.light, colors.border)}>
                        <span className="text-lg font-bold text-muted-foreground/50">{phase.order}</span>
                        <span className={cn('text-sm font-medium', colors.text)}>{phase.nameAr}</span>
                      </div>
                      {i < data.phases.length - 1 && (
                        <ArrowDown className="w-4 h-4 text-muted-foreground rotate-[-90deg] hidden sm:block" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <div className="text-xl font-bold text-emerald-600">{data.stats.totalStocks}</div>
                  <div className="text-xs text-muted-foreground">سهم محلل</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <div className="text-xl font-bold text-amber-600">{data.stats.totalPredictions}</div>
                  <div className="text-xs text-muted-foreground">توقع</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <div className="text-xl font-bold text-purple-600">{data.stats.totalPersonaPredictions}</div>
                  <div className="text-xs text-muted-foreground">توقع شخصي</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <div className="text-xl font-bold text-teal-600">{data.phases.length}</div>
                  <div className="text-xs text-muted-foreground">مراحل تحليل</div>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== 4 PREDICTION ENGINES ===== */}
      <Card className={cn('border-2', COLOR_CLASSES.teal.border)}>
        <CardHeader className="cursor-pointer" onClick={() => toggleSection('engines')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">🧠 محركات التوقع الأربعة</CardTitle>
                <CardDescription>4 Prediction Engines — The Analysis Core</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{data.engines.length} محرك</Badge>
              {expandedSections.engines ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardHeader>
        {expandedSections.engines && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.engines.map(engine => {
                const colors = COLOR_CLASSES[engine.color] || COLOR_CLASSES.emerald;
                const statusCfg = STATUS_CONFIG[engine.status] || STATUS_CONFIG.unknown;
                const StatusIcon = statusCfg.icon;
                const EngineIcon = getIcon(engine.icon);

                return (
                  <div key={engine.id} className={cn('rounded-xl border p-4 transition-all hover:shadow-md', colors.border, colors.light)}>
                    <div className="flex items-start gap-3">
                      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', colors.bg)}>
                        <EngineIcon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm">{engine.name}</span>
                          <Badge variant="outline" className={cn('text-[10px]', statusCfg.bg, statusCfg.color)}>
                            <StatusIcon className="w-3 h-3 ml-0.5" />
                            {statusCfg.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">{engine.nameAr}</p>
                        <p className="text-xs text-muted-foreground">{engine.descriptionAr}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>التوقعات: {engine.recordsProcessed}</span>
                          {engine.lastRun && <span>آخر تشغيل: {formatTimeAgo(engine.lastRun)}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== 3 PERSONAS ===== */}
      <Card className={cn('border-2', COLOR_CLASSES.purple.border)}>
        <CardHeader className="cursor-pointer" onClick={() => toggleSection('personas')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">🎭 الشخصيات الثلاث</CardTitle>
                <CardDescription>3 Personas — Risk-Adjusted Recommendations</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {data.personas.map(p => (
                <span key={p.id} className="text-lg">{p.emoji}</span>
              ))}
              {expandedSections.personas ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardHeader>
        {expandedSections.personas && (
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              كل شخصية تأخذ نفس التوقعات ولكن بمعايير مختلفة — عتبة الشراء، نسبة وقف الخسارة، ومضاعف الهدف تتغير حسب مستوى المخاطرة.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {data.personas.map(persona => {
                const colors = COLOR_CLASSES[persona.color] || COLOR_CLASSES.purple;
                return (
                  <div key={persona.id} className={cn('rounded-xl border-2 p-4 transition-all hover:shadow-md', colors.border)}>
                    <div className="text-center mb-3">
                      <span className="text-3xl">{persona.emoji}</span>
                      <h3 className="font-bold mt-1">{persona.nameAr}</h3>
                      <p className="text-xs text-muted-foreground">{persona.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground text-center mb-3">{persona.descriptionAr}</p>
                    <Separator className="my-3" />
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">عتبة الشراء</span>
                        <span className={cn('font-bold', persona.buyThreshold >= 70 ? 'text-blue-600' : persona.buyThreshold >= 60 ? 'text-amber-600' : 'text-red-600')}>
                          {persona.buyThreshold}%
                        </span>
                      </div>
                      <Progress value={persona.buyThreshold} className="h-2" />
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">تحمل المخاطرة</span>
                        <span className="font-bold">{persona.riskTolerance}/10</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">وقف الخسارة</span>
                        <span className="font-bold text-red-600">-{persona.stopLossPercent}%</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">مضاعف الهدف</span>
                        <span className="font-bold text-emerald-600">+{Math.round((persona.targetMultiplier - 1) * 100)}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== 6 PHASES ===== */}
      <Card className={cn('border-2', COLOR_CLASSES.orange.border)}>
        <CardHeader className="cursor-pointer" onClick={() => toggleSection('phases')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
                <Layers className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">⚡ مراحل التحليل الست</CardTitle>
                <CardDescription>6 Analysis Phases — Pipeline Architecture</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">6 مراحل</Badge>
              {expandedSections.phases ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardHeader>
        {expandedSections.phases && (
          <CardContent>
            <div className="space-y-3">
              {data.phases.map((phase, i) => {
                const colors = COLOR_CLASSES[phase.color] || COLOR_CLASSES.emerald;
                const PhaseIcon = getIcon(phase.icon);
                return (
                  <React.Fragment key={phase.id}>
                    <div className={cn('flex items-center gap-4 rounded-xl border p-4 transition-all hover:shadow-sm', colors.border, colors.light)}>
                      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', colors.bg)}>
                        <PhaseIcon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs px-1.5 py-0">
                            المرحلة {phase.order}
                          </Badge>
                          <span className={cn('font-bold text-sm', colors.text)}>{phase.nameAr}</span>
                          <span className="text-xs text-muted-foreground">{phase.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{phase.descriptionAr}</p>
                      </div>
                      {i < data.phases.length - 1 && (
                        <ArrowDown className="w-4 h-4 text-muted-foreground rotate-[-90deg] hidden md:block" />
                      )}
                    </div>
                    {i < data.phases.length - 1 && (
                      <div className="flex justify-center">
                        <ArrowDown className="w-4 h-4 text-muted-foreground md:hidden" />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== DATABASES ===== */}
      <Card className={cn('border-2', COLOR_CLASSES.red.border)}>
        <CardHeader className="cursor-pointer" onClick={() => toggleSection('databases')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center">
                <Database className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">💾 قواعد البيانات</CardTitle>
                <CardDescription>4 Databases — Data Persistence Layer</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {data.databases.filter(d => d.exists).length}/{data.databases.length} متصلة
              </Badge>
              {expandedSections.databases ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardHeader>
        {expandedSections.databases && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.databases.map(db => {
                const colors = COLOR_CLASSES[db.color] || COLOR_CLASSES.emerald;
                const DbIcon = getIcon(db.icon);
                const isHealthy = db.status === 'healthy';
                const statusIcon = isHealthy ? CheckCircle2 : db.status === 'missing' ? XCircle : AlertCircle;
                const StatusIcon = statusIcon;

                return (
                  <div key={db.id} className={cn('rounded-xl border p-4 transition-all hover:shadow-md', colors.border)}>
                    <div className="flex items-start gap-3">
                      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', isHealthy ? colors.bg : 'bg-gray-400')}>
                        <DbIcon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm">{db.nameAr}</span>
                          <Badge variant="outline" className={cn('text-[10px]', isHealthy ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400')}>
                            <StatusIcon className="w-3 h-3 ml-0.5" />
                            {isHealthy ? 'متصل' : 'غير متصل'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{db.name}</p>
                        
                        {isHealthy && (
                          <>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                              <span>الحجم: {formatSize(db.sizeKB)}</span>
                              <span>الجداول: {db.tables.length}</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {db.tables.slice(0, 6).map(table => (
                                <Badge key={table} variant="outline" className="text-[9px] px-1.5 py-0">
                                  {table}
                                </Badge>
                              ))}
                              {db.tables.length > 6 && (
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                                  +{db.tables.length - 6}
                                </Badge>
                              )}
                            </div>
                          </>
                        )}
                        {db.lastModified && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            آخر تعديل: {formatTimeAgo(db.lastModified)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== CONTINUOUS LEARNING ===== */}
      <Card className={cn('border-2', COLOR_CLASSES.cyan.border)}>
        <CardHeader className="cursor-pointer" onClick={() => toggleSection('learning')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-sky-600 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">📚 التعلم المستمر</CardTitle>
                <CardDescription>Expert Memory + Feedback Loop — Self-Improving System</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {expandedSections.learning ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardHeader>
        {expandedSections.learning && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Expert Memory */}
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-50 dark:bg-cyan-950/30 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500 flex items-center justify-center">
                    <Brain className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">ذاكرة الخبير</h4>
                    <p className="text-[10px] text-muted-foreground">Expert Memory</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  تتعلم من التوقعات السابقة — تحفظ الأنماط الناجحة وتتجنب الفاشلة.
                  كل توقع يُغلق يُضاف لقاعدة المعرفة.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">سجلات محفوظة</span>
                  <Badge variant="outline" className="bg-cyan-100 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-400">
                    {data.stats.expertMemoryCount} سجل
                  </Badge>
                </div>
              </div>

              {/* Feedback Loop */}
              <div className="rounded-xl border border-teal-500/30 bg-teal-50 dark:bg-teal-950/30 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center">
                    <RefreshCw className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">حلقة التغذية الراجعة</h4>
                    <p className="text-[10px] text-muted-foreground">Feedback Loop</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  تعدل الدرجات بناءً على الدقة التاريخية — تقلل التوقعات ضعيفة الأداء حتى 10 نقاط
                  وتزيد الجيدة حتى 5 نقاط.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">تعديلات مسجلة</span>
                  <Badge variant="outline" className="bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400">
                    {data.stats.feedbackAdjustments} تعديل
                  </Badge>
                </div>
              </div>
            </div>

            {/* Learning Cycle Visualization */}
            <div className="mt-4 p-4 rounded-xl bg-muted/50 border">
              <h5 className="text-sm font-bold mb-3 text-center">🔄 دورة التعلم المستمر</h5>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <div className="px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                  تحليل جديد
                </div>
                <ArrowDown className="w-3 h-3 text-muted-foreground rotate-[-90deg]" />
                <div className="px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs font-medium">
                  توقع
                </div>
                <ArrowDown className="w-3 h-3 text-muted-foreground rotate-[-90deg]" />
                <div className="px-3 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 text-xs font-medium">
                  مراقبة
                </div>
                <ArrowDown className="w-3 h-3 text-muted-foreground rotate-[-90deg]" />
                <div className="px-3 py-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-400 text-xs font-medium">
                  إغلاق + تقييم
                </div>
                <ArrowDown className="w-3 h-3 text-muted-foreground rotate-[-90deg]" />
                <div className="px-3 py-1.5 rounded-lg bg-teal-100 dark:bg-teal-950/30 text-teal-700 dark:text-teal-400 text-xs font-medium">
                  تعديل الدرجات
                </div>
                <ArrowDown className="w-3 h-3 text-muted-foreground rotate-[-90deg]" />
                <div className="px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                  تحليل أفضل ↓
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== SYSTEM ARCHITECTURE FLOW ===== */}
      <Card className="border-2 border-gray-300 dark:border-gray-700">
        <CardHeader className="cursor-pointer" onClick={() => toggleSection('flow')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center">
                <Server className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">🏗️ البنية المعمارية الكاملة</CardTitle>
                <CardDescription>Full System Architecture — 8 Layers</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {expandedSections.flow ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardHeader>
        {expandedSections.flow && (
          <CardContent>
            <div className="space-y-3">
              {data.architecture.layers.map((layer, i) => {
                const layerColors = [
                  'emerald', 'teal', 'red', 'amber', 'orange', 'purple', 'cyan', 'blue'
                ];
                const color = COLOR_CLASSES[layerColors[i % layerColors.length]] || COLOR_CLASSES.emerald;
                return (
                  <div key={layer.id} className="space-y-1">
                    <div className={cn('rounded-xl border p-3', color.border, color.light)}>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="text-[10px]">Layer {i}</Badge>
                        <span className={cn('font-bold text-sm', color.text)}>{layer.nameAr}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {layer.items.map((item, j) => (
                          <Badge key={j} variant="outline" className="text-xs">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    {i < data.architecture.layers.length - 1 && (
                      <div className="flex justify-center">
                        <ArrowDown className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== BACKGROUND ANALYZER ===== */}
      <Card className="border border-dashed">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center animate-pulse">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-sm">🔄 المحلل الخلفي — Background Analyzer</h4>
              <p className="text-xs text-muted-foreground">
                يعمل بشكل مستمر في الخلفية — يحدّث الأسعار، يُنشئ التوقعات، يُغلق المنتهية، ويُغذي حلقة التعلم المستمر.
              </p>
            </div>
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
              <Activity className="w-3 h-3 ml-1" />
              يعمل 24/7
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
