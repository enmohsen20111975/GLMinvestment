'use client';

/**
 * P39 — Phase 1: Dynamic Risk Profiler (استبيان الأهداف الديناميكي)
 * ====================================================================
 * نافذة منبثقة تفاعلية تحسب `Risk Tolerance Score` (1..100) بناءً على 10 أسئلة
 * وتحدد المتغير `active_persona` (conservative / balanced / aggressive).
 *
 * - تظهر تلقائياً عند أول تسجيل دخول (riskProfilerCompleted === false).
 * - يمكن إعادة فتحها يدوياً من زر "إعادة الاختبار" في إعدادات الشخصية.
 * - كل سؤال له 4 خيارات بأوزان (0..10) — المجموع النهائي = sum × 1 (0..100).
 * - عند الحفظ: setRiskToleranceScore(score) ← lazy import persona-dynamic.ts
 * ← scoreToPersona() ← setPersona() ← loadV2Recommendations().
 */

import React, { useState, useMemo } from 'react';
import {
 Dialog, DialogContent, DialogHeader, DialogTitle,
 DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
 Shield, Scale, Flame, ArrowRight, ArrowLeft, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { scoreToPersona, personaLabelAr } from '@/lib/persona-dynamic';
import { cn } from '@/lib/utils';

interface Question {
 id: number;
 text: string;
 options: { label: string; score: number }[];
}

const QUESTIONS: Question[] = [
 {
 id: 1,
 text: 'ما نسبة رأس مالك المستعد لخسارته في صفقة واحدة؟',
 options: [
 { label: 'أقل من 1%', score: 1 },
 { label: 'من 1% إلى 3%', score: 4 },
 { label: 'من 3% إلى 6%', score: 7 },
 { label: 'أكثر من 6%', score: 10 },
 ],
 },
 {
 id: 2,
 text: 'إذا انخفض سهمك 15% خلال أسبوع، ماذا تفعل؟',
 options: [
 { label: 'أبيع فوراً وأقطع الخسارة', score: 1 },
 { label: 'أراجع التحليل وأعيد التقييم', score: 4 },
 { label: 'أعمل متوسط للسهم', score: 7 },
 { label: 'أشتري المزيد بحماس', score: 10 },
 ],
 },
 {
 id: 3,
 text: 'ما الأصل الذي تفضّل الاستثمار فيه؟',
 options: [
 { label: 'الذهب والسندات فقط', score: 1 },
 { label: 'أسهم EGX الكبرى فقط', score: 4 },
 { label: 'أسهم + كريبتو (BTC/ETH)', score: 7 },
 { label: 'كريبتو + أسهم صغيرة المعدّل', score: 10 },
 ],
 },
 {
 id: 4,
 text: 'ما أفق استثمارك الزمني؟',
 options: [
 { label: 'أقل من 3 أشهر', score: 2 },
 { label: 'من 3 إلى 12 شهر', score: 5 },
 { label: 'من 1 إلى 3 سنوات', score: 8 },
 { label: 'أكثر من 3 سنوات', score: 10 },
 ],
 },
 {
 id: 5,
 text: 'كيف تتعامل مع التقلبات اليومية للسوق؟',
 options: [
 { label: 'تقلقني جداً وأتابعها كل ساعة', score: 1 },
 { label: 'أتابعها يومياً بهدوء', score: 5 },
 { label: 'أتابعها أسبوعياً', score: 8 },
 { label: 'لا أهتم — أثق بخطتي', score: 10 },
 ],
 },
 {
 id: 6,
 text: 'ما نسبة دخلك الموظّف المخصّصة للاستثمار؟',
 options: [
 { label: 'أقل من 5%', score: 2 },
 { label: 'من 5% إلى 15%', score: 5 },
 { label: 'من 15% إلى 30%', score: 8 },
 { label: 'أكثر من 30%', score: 10 },
 ],
 },
 {
 id: 7,
 text: 'هل لديك صندوق طوارئ منفصل عن الاستثمار؟',
 options: [
 { label: 'نعم، يكفي 12 شهر+', score: 10 },
 { label: 'نعم، يكفي 6 أشهر', score: 7 },
 { label: 'نعم، يكفي 3 أشهر', score: 4 },
 { label: 'لا، أعتمد على الاستثمار', score: 1 },
 ],
 },
 {
 id: 8,
 text: 'ما رد فعلك لو حققت ربحاً 30% في شهر؟',
 options: [
 { label: 'أبيع الكل وأضمن الربح', score: 1 },
 { label: 'أبيع نصف الكمية', score: 5 },
 { label: 'أرفع الهدف وأنتظر', score: 8 },
 { label: 'أضاعف الرهان', score: 10 },
 ],
 },
 {
 id: 9,
 text: 'ما مدى معرفتك بالتحليل الفني (SMC / Quant)؟',
 options: [
 { label: 'لا أعرف anything', score: 1 },
 { label: 'أساسيات بسيطة', score: 4 },
 { label: 'متوسط — أقرأ الشارت', score: 7 },
 { label: 'متقدّم — أحلل بنفسي', score: 10 },
 ],
 },
 {
 id: 10,
 text: 'لو خُيّرت بين عائدين متوقّعين، أيهما تختار؟',
 options: [
 { label: '8% سنوياً عائد ثابت (شهادات إيداع)', score: 1 },
 { label: '12% سنوياً بتقلب منخفض', score: 4 },
 { label: '20% سنوياً بتقلب متوسط', score: 7 },
 { label: '40% سنوياً بتقلب عالٍ جداً', score: 10 },
 ],
 },
];

const MAX_SCORE = QUESTIONS.reduce((sum, q) => sum + Math.max(...q.options.map((o) => o.score)), 0);

interface DynamicRiskProfilerModalProps {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 /** Called after the user submits the questionnaire with the final score. */
 onComplete?: (score: number) => void;
}

export function DynamicRiskProfilerModal({
 open, onOpenChange, onComplete,
}: DynamicRiskProfilerModalProps) {
 const [step, setStep] = useState(0); // 0..QUESTIONS.length (last = summary)
 const [answers, setAnswers] = useState<Record<number, number>>({});
 const setRiskToleranceScore = useAppStore((s) => s.setRiskToleranceScore);
 const setRiskProfilerCompleted = useAppStore((s) => s.setRiskProfilerCompleted);

 const currentScore = useMemo(() => {
 return Object.values(answers).reduce((sum, s) => sum + s, 0);
 }, [answers]);

 const normalizedScore = useMemo(() => {
 // Map raw 0..MAX_SCORE → 1..100
 if (MAX_SCORE <= 0) return 50;
 return Math.max(1, Math.min(100, Math.round((currentScore / MAX_SCORE) * 100)));
 }, [currentScore]);

 const derivedPersona = useMemo(() => scoreToPersona(normalizedScore), [normalizedScore]);

 const handleSelect = (questionId: number, score: number) => {
 setAnswers((prev) => ({ ...prev, [questionId]: score }));
 // Auto-advance after a short delay
 setTimeout(() => {
 setStep((s) => Math.min(s + 1, QUESTIONS.length));
 }, 180);
 };

 const handleBack = () => setStep((s) => Math.max(0, s - 1));

 const handleRestart = () => {
 setAnswers({});
 setStep(0);
 };

 const handleFinish = () => {
 setRiskToleranceScore(normalizedScore);
 setRiskProfilerCompleted(true);
 onComplete?.(normalizedScore);
 onOpenChange(false);
 };

 const isLastStep = step >= QUESTIONS.length;
 const currentQuestion = QUESTIONS[step];
 const progress = (step / (QUESTIONS.length + 1)) * 100;

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto" dir="rtl">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-lg">
 <Scale className="h-5 w-5 text-primary" />
 استبيان تحمّل المخاطر الديناميكي
 </DialogTitle>
 <DialogDescription className="text-xs">
 10 أسئلة تحدّد شخصيتك الاستثمارية وتضبط محرك التحليلات أوتوماتيكياً وفقاً لإجاباتك.
 </DialogDescription>
 </DialogHeader>

 <div className="space-y-4">
 {/* Progress */}
 <div className="space-y-1">
 <div className="flex justify-between text-xs text-muted-foreground">
 <span>السؤال {Math.min(step + 1, QUESTIONS.length)} من {QUESTIONS.length}</span>
 <span>{Math.round(progress)}%</span>
 </div>
 <Progress value={progress} className="h-2" />
 </div>

 {!isLastStep ? (
 <Card className="p-4 space-y-3 border-border">
 <div className="flex items-start gap-2">
 <Badge variant="secondary" className="mt-0.5">{currentQuestion.id}</Badge>
 <h3 className="text-sm font-semibold leading-relaxed">{currentQuestion.text}</h3>
 </div>
 <RadioGroup
 value={String(answers[currentQuestion.id] ?? '')}
 onValueChange={(val) => handleSelect(currentQuestion.id, Number(val))}
 className="space-y-2"
 >
 {currentQuestion.options.map((opt, idx) => {
 const isSelected = answers[currentQuestion.id] === opt.score;
 return (
 <Label
 key={idx}
 htmlFor={`q${currentQuestion.id}-opt${idx}`}
 className={cn(
 'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
 isSelected
 ? 'border-primary bg-primary/5'
 : 'border-border hover:bg-muted/50',
 )}
 >
 <RadioGroupItem
 id={`q${currentQuestion.id}-opt${idx}`}
 value={String(opt.score)}
 className="flex-shrink-0"
 />
 <span className="text-sm flex-1">{opt.label}</span>
 </Label>
 );
 })}
 </RadioGroup>
 </Card>
 ) : (
 <Card className="p-5 space-y-4 border-primary/30 bg-primary/5">
 <div className="flex items-center gap-2">
 <CheckCircle2 className="h-5 w-5 text-profit" />
 <h3 className="font-bold">اكتمل الاستبيان</h3>
 </div>

 {/* Score gauge */}
 <div className="text-center space-y-1 py-2">
 <div className="text-5xl font-bold tabular-nums">{normalizedScore}</div>
 <div className="text-xs text-muted-foreground">من 100</div>
 <Progress value={normalizedScore} className="h-3 mx-auto max-w-xs" />
 </div>

 {/* Derived persona */}
 <div className="flex flex-col items-center gap-2 py-2">
 <div className="text-sm text-muted-foreground">الشخصية المُستنتَجة:</div>
 <div className="flex items-center gap-2 text-lg font-bold">
 {derivedPersona === 'conservative' && <Shield className="h-5 w-5 text-whale" />}
 {derivedPersona === 'balanced' && <Scale className="h-5 w-5 text-warning" />}
 {derivedPersona === 'gambler' && <Flame className="h-5 w-5 text-loss" />}
 {personaLabelAr(derivedPersona)}
 </div>
 <p className="text-xs text-muted-foreground text-center max-w-sm">
 {derivedPersona === 'conservative' && 'حماية رأس المال أولاً — وقف خسارة ضيق (0.8×ATR) وحد مخاطفة 1%.'}
 {derivedPersona === 'balanced' && 'توازن بين العائد والمخاطر — معاملات قياسية (1.0×ATR) وحد مخاطفة 2%.'}
 {derivedPersona === 'gambler' && 'مخاطر عالية جداً مع وعي — وقف واسع (1.5×ATR) وحد مخاطفة 4.5%.'}
 </p>
 </div>

 <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 text-center">
 سيتم تطبيق الشخصية فوراً على جميع شاشات التحليلات والمحفظة والتوقعات.
 </div>
 </Card>
 )}
 </div>

 <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
 <div className="flex gap-2">
 {step > 0 && !isLastStep && (
 <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1">
 <ArrowRight className="h-4 w-4" />
 رجوع
 </Button>
 )}
 {isLastStep && (
 <Button variant="ghost" size="sm" onClick={handleRestart} className="gap-1">
 <RefreshCw className="h-3.5 w-3.5" />
 إعادة
 </Button>
 )}
 </div>
 <div className="flex gap-2">
 <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
 إلغاء
 </Button>
 {isLastStep && (
 <Button size="sm" onClick={handleFinish} className="gap-1">
 تطبيق الشخصية
 <ArrowLeft className="h-4 w-4" />
 </Button>
 )}
 </div>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}

export default DynamicRiskProfilerModal;
