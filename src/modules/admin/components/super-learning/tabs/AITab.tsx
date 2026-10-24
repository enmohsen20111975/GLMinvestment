/**
 * super-learning/tabs/AITab.tsx
 * ============================
 * The "AI" tab — advanced analytical optimization + learning-from-errors.
 *
 * Card 1: AI-Enhanced auto-tuning (toggle + target win-rate slider + max
 * iterations slider + "بدء التحسين الذكي" button).
 *
 * Card 2: Learning from actual errors (mining lessons from wrong predictions +
 * applying parameter adjustments). Shows the extracted lessons as bullet points
 * + the applied adjustments as a grid of stat cards.
 */
'use client';

import React from 'react';
import {
  Sparkles, Cpu, Brain, Database, BarChart3, AlertTriangle, Activity,
  Loader2, Sliders,
} from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

export interface AITabProps {
  aiEnhanced: boolean;
  setAiEnhanced: (v: boolean) => void;
  targetWinRate: number;
  setTargetWinRate: (v: number) => void;
  maxIterations: number;
  setMaxIterations: (v: number) => void;
  isRunning: boolean;
  loading: string | null;
  runIterativeLearningSystem: () => void;
  learnFromActualFailures: () => void;
  lessons: string[];
  adjustments: Record<string, number>;
}

export function AITab(props: AITabProps) {
  const {
    aiEnhanced, setAiEnhanced,
    targetWinRate, setTargetWinRate,
    maxIterations, setMaxIterations,
    isRunning, loading,
    runIterativeLearningSystem,
    learnFromActualFailures,
    lessons, adjustments,
  } = props;

  return (
    <div className="space-y-4">
      <Card className="border-violet-200 dark:border-violet-800">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 h-4 text-violet-500" />
            التحسين التحليلي المتقدم
          </CardTitle>
          <CardDescription>
            استخدم AI لتحسين البرمترات تلقائياً عبر محاكاة دورات التعلم التكراري
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <Cpu className="w-5 h-5 text-violet-500" />
              <div>
                <p className="font-medium">التحسين التلقائي</p>
                <p className="text-xs text-muted-foreground">السماح للنظام بتحسين البرمترات</p>
              </div>
            </div>
            <Switch checked={aiEnhanced} onCheckedChange={setAiEnhanced} />
          </div>

          {aiEnhanced && (
            <div className="space-y-4 p-4 rounded-lg border border-violet-200 dark:border-violet-800">
              <div className="space-y-2">
                <Label>نسبة النجاح المستهدفة: {targetWinRate}%</Label>
                <Slider value={[targetWinRate]} onValueChange={([v]) => setTargetWinRate(v)} min={50} max={99} step={1} />
              </div>
              <div className="space-y-2">
                <Label>أقصى عدد تكرارات: {maxIterations}</Label>
                <Slider value={[maxIterations]} onValueChange={([v]) => setMaxIterations(v)} min={5} max={50} step={5} />
              </div>
              <Button
                className="w-full gap-2 bg-violet-600 hover:bg-violet-700"
                onClick={runIterativeLearningSystem}
                disabled={isRunning || loading !== null}
              >
                {loading === 'iterative' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Brain className="w-4 h-4" />
                )}
                بدء التحسين الذكي
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4 text-center">
              <Database className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="font-medium">البيانات التاريخية</p>
              <p className="text-2xl font-bold text-primary">274,574</p>
              <p className="text-xs text-muted-foreground">سجل أسعار</p>
            </Card>
            <Card className="p-4 text-center">
              <BarChart3 className="w-8 h-8 mx-auto mb-2 text-profit" />
              <p className="font-medium">الأسهم المتاحة</p>
              <p className="text-2xl font-bold text-profit">946</p>
              <p className="text-xs text-muted-foreground">سهم للتحليل</p>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* التعلم من الأخطاء الفعلية */}
      <Card className="border-warning/20 shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-warning ">
            <AlertTriangle className="h-5 w-5 text-warning" />
            تعدين الدروس والتعلم من الأخطاء الفعلية
          </CardTitle>
          <CardDescription>
            تحليل التوقعات والتوقعات الخاطئة في قاعدة البيانات النشطة واستخلاص دروس الأمان وتحديث الإعدادات تلقائياً.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-xl bg-warning/10 /10 border border-warning/20">
            <div className="space-y-1">
              <p className="font-semibold text-sm">مكافحة تكرار الأخطاء</p>
              <p className="text-xs text-muted-foreground">يقوم النظام بالربط بين المؤشرات الفنية ونظام السوق عند حدوث الفشل لتجنبه مستقبلاً.</p>
            </div>
            <Button
              onClick={learnFromActualFailures}
              disabled={isRunning || loading !== null}
              className="gap-2 bg-warning hover:bg-warning text-white shrink-0 shadow-sm"
            >
              {loading === 'errors' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Activity className="w-4 h-4" />
              )}
              تحليل الأخطاء وتعدين الدروس
            </Button>
          </div>

          {/* عرض الدروس المستخرجة */}
          {lessons.length > 0 && (
            <div className="space-y-3 mt-4 animate-in fade-in duration-300">
              <h4 className="font-semibold text-sm text-warning flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-warning animate-pulse" />
                الدروس والتحذيرات الأمنية المستخرجة:
              </h4>
              <div className="space-y-2">
                {lessons.map((lesson, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 text-xs p-3.5 bg-warning/20 /5 rounded-lg border border-warning/20 /30 text-foreground shadow-sm"
                  >
                    <Badge className="bg-warning hover:bg-warning text-xs h-5 px-1.5 shrink-0" variant="secondary">
                      قاعدة أمان
                    </Badge>
                    <span className="leading-relaxed">{lesson}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* عرض المعايير المعدلة */}
          {Object.keys(adjustments).length > 0 && (
            <div className="space-y-3 mt-4 animate-in fade-in duration-300">
              <h4 className="font-semibold text-sm text-violet-700 dark:text-violet-400 flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-violet-500" />
                المعايير المطبقة لحماية المحفظة:
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {Object.entries(adjustments).map(([key, val]) => {
                  let arabicKey = key;
                  if (key === 'min_score_buy') arabicKey = 'الحد الأدنى للشراء';
                  else if (key === 'position_size_pct') arabicKey = 'حجم الصفقة %';
                  else if (key === 'stop_max_pct') arabicKey = 'أقصى وقف خسارة %';
                  else if (key === 'rsi_overbought') arabicKey = 'تشبع الشراء RSI';
                  else if (key === 'rsi_oversold') arabicKey = 'تشبع البيع RSI';
                  else if (key === 'min_rr') arabicKey = 'نسبة العائد للمخاطرة R/R';

                  return (
                    <div
                      key={key}
                      className="flex flex-col justify-between p-3 bg-violet-50/30 dark:bg-violet-950/5 rounded-lg border border-violet-100/80 dark:border-violet-900/30"
                    >
                      <span className="text-xs text-muted-foreground font-medium mb-1">{arabicKey}</span>
                      <span className="text-sm font-bold text-violet-700 dark:text-violet-400 font-mono">{val}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
