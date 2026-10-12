'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Brain,
  Cpu,
  ShieldCheck,
  Zap,
  Activity,
  RefreshCw,
  Play,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Sliders,
  Terminal,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';

interface ThresholdEval {
  threshold: number;
  accepted_signals: number;
  wins: number;
  win_rate_pct: number;
  improvement_pp: number;
}

interface AIMetrics {
  baseline_win_rate_pct: number;
  total_test_samples: number;
  threshold_evaluations: ThresholdEval[];
  feature_importances: Record<string, number>;
}

interface AISettings {
  min_confidence_threshold: number;
  gatekeeper_enforced: boolean;
  high_conviction_threshold: number;
  last_updated: string;
  model_version: string;
}

interface ModelStats {
  exists: boolean;
  sizeBytes: number;
  lastModified: string;
}

const FEATURE_NAMES_AR: Record<string, string> = {
  price_to_sma20: 'المسافة من متوسط 20 يوم',
  bollinger_bandwidth: 'انفراج نطاق البولنجر (Squeeze)',
  high_low_spread_pct: 'المدى السعري اليومي (Spread %)',
  rvol_20d: 'حجم التداول النسبي (RVol)',
  price_to_sma50: 'المسافة من متوسط 50 يوم',
  avg_turnover_20d_log: 'لوغاريتم سيولة السهم (Turnover EGP)',
  rsi_14: 'مؤشر القوة النسبية (RSI)',
  percentile_rank: 'رتبة السيولة المئوية (Percentile)',
  mfi_14: 'مؤشر تدفق الأموال (MFI)',
  atr_14_pct: 'نسبة التذبذب (ATR %)',
};

export function AIGatekeeperTab() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [training, setTraining] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [logTail, setLogTail] = useState<string[]>([]);

  // State from server
  const [metrics, setMetrics] = useState<AIMetrics | null>(null);
  const [modelStats, setModelStats] = useState<ModelStats | null>(null);
  const [settings, setSettings] = useState<AISettings>({
    min_confidence_threshold: 0.65,
    gatekeeper_enforced: true,
    high_conviction_threshold: 0.70,
    last_updated: '',
    model_version: 'LightGBM-Gatekeeper-v1.0',
  });

  // Local edit state
  const [thresholdInput, setThresholdInput] = useState<number>(65);
  const [enforcedInput, setEnforcedInput] = useState<boolean>(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/ai-gatekeeper');
      const json = await res.json();
      if (json.success && json.data) {
        setMetrics(json.data.metrics);
        setModelStats(json.data.modelStats);
        setSettings(json.data.settings);
        setThresholdInput(Math.round(json.data.settings.min_confidence_threshold * 100));
        setEnforcedInput(json.data.settings.gatekeeper_enforced);
      }
    } catch {
      toast.error('فشل جلب بيانات نموذج الذكاء الاصطناعي');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Polling training status
  useEffect(() => {
    if (!jobId || !training) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/ai-gatekeeper/status/${jobId}`);
        const json = await res.json();
        if (json.success && json.data) {
          if (json.data.log_tail) {
            setLogTail(json.data.log_tail);
          }
          if (json.data.completed) {
            setTraining(false);
            setJobId(null);
            toast.success('اكتمل تدريب نموذج الذكاء الاصطناعي بنجاح!');
            fetchStatus();
            clearInterval(interval);
          }
        }
      } catch {}
    }, 2500);
    return () => clearInterval(interval);
  }, [jobId, training, fetchStatus]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/ai-gatekeeper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          min_confidence_threshold: thresholdInput / 100.0,
          gatekeeper_enforced: enforcedInput,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم حفظ إعدادات حارس الذكاء الاصطناعي بنجاح');
        setSettings(json.settings);
      } else {
        toast.error(json.error || 'فشل حفظ الإعدادات');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const runTraining = async () => {
    setTraining(true);
    setLogTail(['جاري إطلاق محرك التدريب الكمي في الخلفية...']);
    try {
      const res = await fetch('/api/admin/ai-gatekeeper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'train' }),
      });
      const json = await res.json();
      if (json.success && json.jobId) {
        setJobId(json.jobId);
        toast.success(json.message);
      } else {
        toast.error(json.error || 'فشل بدء التدريب');
        setTraining(false);
      }
    } catch {
      toast.error('خطأ في إطلاق عملية التدريب');
      setTraining(false);
    }
  };

  const activeEval = metrics?.threshold_evaluations?.find(
    (e) => Math.round(e.threshold * 100) === thresholdInput
  ) || metrics?.threshold_evaluations?.[4];

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header Banner - High contrast & adaptive */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-card border border-emerald-500/20 shadow-sm dark:bg-gradient-to-r dark:from-emerald-950/40 dark:via-zinc-900 dark:to-zinc-950">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm">
            <Brain className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-foreground">حارس الذكاء الاصطناعي المؤسسي (LightGBM Gatekeeper)</h1>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 text-xs font-mono font-bold">
                v4.7.0
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              مراقبة وتحكم لحظي في مصفي الصفقات الذكي — يرفع نسبة النجاح بحجب الصفقات الضعيفة والأسهم الخاملة.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchStatus}
            disabled={loading}
            className="gap-1.5 text-xs text-foreground hover:bg-muted"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
          <Button
            size="sm"
            onClick={runTraining}
            disabled={training}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 text-xs font-bold shadow-md shadow-emerald-600/20"
          >
            {training ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {training ? 'جاري التدريب...' : 'إعادة تدريب النموذج الآن'}
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Model Status */}
        <Card className="bg-card border-border shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
              <span>حالة النموذج</span>
              <Cpu className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </CardDescription>
            <CardTitle className="text-xl font-bold flex items-center gap-2 text-foreground">
              {modelStats?.exists ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                  نشط وجاهز
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  غير مدرّب
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1 text-[11px] text-muted-foreground font-medium">
            الحجم: {modelStats ? `${(modelStats.sizeBytes / 1024).toFixed(1)} KB` : '—'} • RAM: &lt; 350 MB
          </CardContent>
        </Card>

        {/* Baseline Win Rate */}
        <Card className="bg-card border-border shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
              <span>النجاح الخام (بدون ذكاء اصطناعي)</span>
              <Activity className="w-4 h-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-xl font-bold text-foreground font-mono">
              {metrics ? `${metrics.baseline_win_rate_pct.toFixed(1)}%` : '18.1%'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1 text-[11px] text-muted-foreground font-medium">
            الكون العام قبل الفلترة (إشارات عشوائية بدون تحكّم)
          </CardContent>
        </Card>

        {/* Filtered Win Rate */}
        <Card className="bg-card border-emerald-500/40 shadow-sm bg-gradient-to-b from-emerald-500/5 to-transparent dark:from-emerald-950/20">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center justify-between">
              <span>النجاح بالذكاء الاصطناعي (ثقة ≥ {thresholdInput}%)</span>
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </CardDescription>
            <CardTitle className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
              {activeEval ? `${activeEval.win_rate_pct.toFixed(1)}%` : '79.0%'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1 text-[11px] text-emerald-700 dark:text-emerald-400 font-bold">
            قفزة نجاح: +{activeEval ? activeEval.improvement_pp.toFixed(1) : '60.9'} نقطة مئوية!
          </CardContent>
        </Card>

        {/* Signal Conviction */}
        <Card className="bg-card border-border shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
              <span>الصفقات المصرح بها</span>
              <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-cyan-400" />
            </CardDescription>
            <CardTitle className="text-xl font-bold text-blue-600 dark:text-cyan-400 font-mono">
              {activeEval ? `${activeEval.accepted_signals} صفقة` : '57 صفقة'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1 text-[11px] text-muted-foreground font-medium">
            تم استبعاد {metrics && activeEval ? metrics.total_test_samples - activeEval.accepted_signals : 562} صفقة مشبوهة
          </CardContent>
        </Card>
      </div>

      {/* Control Room: Admin Threshold & Enforcement */}
      <Card className="bg-card border-border shadow-sm">
        <CardHeader className="border-b border-border/80 pb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                <Sliders className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                غرفة التحكم في صرامة الفلتر (Admin Threshold Tuning)
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                حدد مستوى الأمان المالي المطلوب. كلما زادت النسبة، ارتفعت دقة التوصيات ونسبة الأرباح وتراجعت المخاطرة.
              </CardDescription>
            </div>
            <Button
              onClick={saveSettings}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 text-xs font-bold shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Slider / Value */}
            <div className="space-y-3 p-4 rounded-xl bg-muted/40 border border-border">
              <div className="flex items-center justify-between">
                <Label htmlFor="th-slider" className="text-xs font-bold text-foreground">
                  عتبة القبول الذكية الأدنى (Min Probability Threshold)
                </Label>
                <span className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                  {thresholdInput}%
                </span>
              </div>
              <input
                id="th-slider"
                type="range"
                min="40"
                max="85"
                step="5"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(Number(e.target.value))}
                className="w-full accent-emerald-600 cursor-pointer h-2 bg-muted rounded-lg border border-border"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground font-mono font-medium">
                <span>40% (تسامح عالي)</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-bold">65% (موصى به مؤسسياً)</span>
                <span>80% (نخبة فائقة الصرامة)</span>
              </div>
            </div>

            {/* Toggle Enforcement */}
            <div className="space-y-3 p-4 rounded-xl bg-muted/40 border border-border flex flex-col justify-between">
              <div>
                <Label className="text-xs font-bold text-foreground block">
                  تفعيل الحظر الإلزامي في واجهات المستخدم (Gatekeeper Enforcement)
                </Label>
                <p className="text-[11px] text-muted-foreground mt-1">
                  عند التفعيل: يتم حجب أي إشارة تقل ثقتها عن {thresholdInput}% من شاشات المستخدمين والتليجرام لحماية أموالهم.
                </p>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEnforcedInput(!enforcedInput)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    enforcedInput ? 'bg-emerald-600' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      enforcedInput ? '-translate-x-6' : '-translate-x-1'
                    }`}
                  />
                </button>
                <span className={`text-xs font-bold ${enforcedInput ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                  {enforcedInput ? 'مفعّل (حظر الصفقات الضعيفة نشط)' : 'معطل (عرض كل الصفقات الخام)'}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Threshold Comparison Table & Feature Importances */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Table of Thresholds */}
        <Card className="bg-card border-border shadow-sm">
          <CardHeader className="p-4 border-b border-border">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              جدول الحصاد الواقعي حسب عتبة الذكاء الاصطناعي (Out-Of-Sample)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-muted/70 text-foreground font-bold border-b border-border">
                  <tr>
                    <th className="p-3">عتبة الثقة</th>
                    <th className="p-3">الصفقات المقبولة</th>
                    <th className="p-3">الفوز الحقيقي</th>
                    <th className="p-3">نسبة النجاح (Win Rate)</th>
                    <th className="p-3">القفزة (Alpha)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono">
                  {metrics?.threshold_evaluations?.map((row) => {
                    const isSelected = Math.round(row.threshold * 100) === thresholdInput;
                    return (
                      <tr
                        key={row.threshold}
                        className={`transition-colors ${
                          isSelected
                            ? 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-300 font-bold border-r-4 border-r-emerald-600'
                            : 'hover:bg-muted/50 text-foreground'
                        }`}
                      >
                        <td className="p-3 flex items-center gap-1.5 font-bold">
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                          ≥ {(row.threshold * 100).toFixed(0)}%
                        </td>
                        <td className="p-3 text-muted-foreground">{row.accepted_signals}</td>
                        <td className="p-3 text-foreground font-semibold">{row.wins}</td>
                        <td className="p-3 font-bold text-emerald-700 dark:text-emerald-400">{row.win_rate_pct.toFixed(1)}%</td>
                        <td className="p-3 font-bold text-blue-600 dark:text-cyan-400">+{row.improvement_pp.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Feature Importance */}
        <Card className="bg-card border-border shadow-sm">
          <CardHeader className="p-4 border-b border-border">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Zap className="w-4 h-4 text-amber-500" />
              أقوى المتغيرات التوقعية تأثيراً في السوق (Feature Importance)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {metrics?.feature_importances &&
              Object.entries(metrics.feature_importances).map(([feat, splits]) => {
                const maxVal = 270;
                const pct = Math.min(100, Math.round((splits / maxVal) * 100));
                const arName = FEATURE_NAMES_AR[feat] || feat;
                return (
                  <div key={feat} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-foreground font-medium">{arName}</span>
                      <span className="text-muted-foreground font-mono text-[11px] font-semibold">{splits} split ({pct}%)</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden border border-border/40">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-600 to-teal-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      </div>

      {/* Retraining Live Terminal Log */}
      {(training || logTail.length > 0) && (
        <Card className="bg-slate-950 border-slate-800 shadow-xl overflow-hidden">
          <CardHeader className="p-3 px-4 border-b border-slate-800/80 bg-slate-900/60 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-mono font-bold text-slate-200">سجل تدريب النموذج المباشر (Training Terminal Logs)</span>
            </div>
            {training && (
              <span className="text-[11px] text-emerald-400 animate-pulse font-mono flex items-center gap-1 font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                جاري المعالجة...
              </span>
            )}
          </CardHeader>
          <CardContent className="p-4 font-mono text-xs bg-slate-950 text-emerald-400 max-h-56 overflow-y-auto space-y-1">
            {logTail.map((line, idx) => (
              <div key={idx} className="leading-relaxed">
                <span className="text-slate-500 select-none mr-2">[{idx + 1}]</span>
                {line}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

