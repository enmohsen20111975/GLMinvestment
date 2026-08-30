'use client';

/**
 * ROBO-ADVISOR-P4: RiskProfilerQuiz — محرك تقييم المخاطر
 * ======================================================
 * Task 6 (Live Portfolio Overhaul):
 *  - Added (X) hide button — persists in localStorage.
 *  - Accepts `currentAllocation` prop to compare actual vs ideal.
 *  - Shows concrete rebalance warning + buy/sell suggestions.
 *
 * Quiz من 5 أسئلة يحدد شخصية العميل:
 *  - محافظ (Conservative)
 *  - متوازن (Balanced)
 *  - مغامر (Aggressive)
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Shield, Gauge, Flame, RotateCcw, CheckCircle2, ArrowLeft, X, AlertTriangle, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Question {
  id: string;
  text: string;
  options: { value: number; label: string }[];
}

const QUESTIONS: Question[] = [
  {
    id: 'horizon',
    text: 'إيه المدة اللي هتفضل مستثمر فيها فلوسك قبل ما تحتاجها؟',
    options: [
      { value: 1, label: 'أقل من سنة (محتاج الفلوس قريب)' },
      { value: 2, label: 'من سنة لـ 3 سنين' },
      { value: 3, label: 'من 3 لـ 7 سنين' },
      { value: 4, label: 'أكتر من 7 سنين (استثمار طويل الأمد)' },
    ],
  },
  {
    id: 'reaction_loss',
    text: 'لو محفظتك نزلت 20% في شهر واحد، تعمل إيه؟',
    options: [
      { value: 1, label: 'أبيع كل حاجة فوراً — ما أقدرش أخسر أكتر' },
      { value: 2, label: 'أبيع جزء وأحتفظ بالباقي' },
      { value: 3, label: 'أسيبها زي ما هي وأستنى' },
      { value: 4, label: 'أشتري أكتر — دي فرصة الدخول' },
    ],
  },
  {
    id: 'income',
    text: 'دخلك الشهري الثابت (بعد المصاريف) بيغطي ادخار قد إيه؟',
    options: [
      { value: 1, label: 'بأكل كل اللي بيدخل — ما بوفرش' },
      { value: 2, label: 'بوفر 10-20% من الدخل' },
      { value: 3, label: 'بوفر 20-40% من الدخل' },
      { value: 4, label: 'بوفر أكتر من 40% من الدخل' },
    ],
  },
  {
    id: 'experience',
    text: 'إيه خبرتك في الاستثمار في البورصة؟',
    options: [
      { value: 1, label: 'مبتدئ — أول مرة أستثمر' },
      { value: 2, label: 'عندي خبرة بسيطة (أقل من سنتين)' },
      { value: 3, label: 'خبرة متوسطة (2-5 سنين)' },
      { value: 4, label: 'خبير (أكتر من 5 سنين)' },
    ],
  },
  {
    id: 'allocation',
    text: 'لو معاك 100 ألف جنيه، هتوزعها إزاي؟',
    options: [
      { value: 1, label: 'كلها شهادات إيداع / بنك (عائد ثابت)' },
      { value: 2, label: '70% بنك + 30% أسهم' },
      { value: 3, label: '50% أسهم + 30% بنك + 20% ذهب' },
      { value: 4, label: '70% أسهم + 20% ذهب + 10% بنك بس للطوارئ' },
    ],
  },
];

interface RiskProfile {
  score: number;
  maxScore: number;
  percentage: number;
  type: 'conservative' | 'balanced' | 'aggressive';
  typeAr: string;
  icon: typeof Shield;
  color: string;
  idealAllocation: { asset: string; pct: number; ar: string }[];
  description: string;
}

/** Current portfolio allocation passed from the parent (EnhancedPortfolioView). */
export interface CurrentAllocation {
  stocks: number;   // % of total in stocks
  gold: number;     // % of total in gold
  cash: number;     // % of total in bank/cert/fund/cash
  crypto: number;   // % of total in crypto
  totalValue: number; // total portfolio value (EGP)
}

interface RiskProfilerQuizProps {
  /** Live portfolio allocation — enables smart rebalance alerts (Task 6) */
  currentAllocation?: CurrentAllocation;
}

function evaluateProfile(totalScore: number): RiskProfile {
  const maxScore = QUESTIONS.length * 4; // 20
  const pct = Math.round((totalScore / maxScore) * 100);

  let type: RiskProfile['type'] = 'balanced';
  let typeAr = 'متوازن';
  let Icon = Gauge;
  let color = 'text-blue-600';
  let description = '';
  let idealAllocation: RiskProfile['idealAllocation'] = [];

  if (totalScore <= 8) {
    type = 'conservative';
    typeAr = 'محافظ';
    Icon = Shield;
    color = 'text-emerald-600';
    description =
      'أنت مستثمر محافظ — بتفضل الأمان والحفاظ على رأس المال. مناسبتك شهادات الإيداع والصناديق ذات الدخل الثابت، مع نسبة صغيرة من الأسهم القيادية المستقرة.';
    idealAllocation = [
      { asset: 'cash', pct: 60, ar: 'شهادات إيداع / بنك' },
      { asset: 'stocks', pct: 25, ar: 'أسهم قيادية مستقرة' },
      { asset: 'gold', pct: 15, ar: 'ذهب' },
    ];
  } else if (totalScore <= 14) {
    type = 'balanced';
    typeAr = 'متوازن';
    Icon = Gauge;
    color = 'text-blue-600';
    description =
      'أنت مستثمر متوازن — بتعرف تخاطب المخاطر بس مش بتقمط. التوزيع المثالي ليك توازن بين الأسهم والثابت، مع نسبة ذهب كتحوّط.';
    idealAllocation = [
      { asset: 'stocks', pct: 50, ar: 'أسهم متنوعة' },
      { asset: 'cash', pct: 35, ar: 'شهادات إيداع / بنك' },
      { asset: 'gold', pct: 15, ar: 'ذهب' },
    ];
  } else {
    type = 'aggressive';
    typeAr = 'مغامر';
    Icon = Flame;
    color = 'text-rose-600';
    description =
      'أنت مستثمر مغامر — بتقبل المخاطر عشان عوائد أعلى. مناسبتك الأسهم النمو والأسهم الصغيرة سريعة الزخم، مع نسبة بسيطة من الثابت للطوارئ بس.';
    idealAllocation = [
      { asset: 'stocks', pct: 75, ar: 'أسهم نمو وزخم' },
      { asset: 'gold', pct: 15, ar: 'ذهب' },
      { asset: 'cash', pct: 10, ar: 'بنك (طوارئ فقط)' },
    ];
  }

  return {
    score: totalScore,
    maxScore,
    percentage: pct,
    type,
    typeAr,
    icon: Icon,
    color,
    idealAllocation,
    description,
  };
}

const STORAGE_KEY = 'robo_advisor_risk_profile';
const HIDDEN_KEY = 'robo_advisor_risk_profile_hidden';

/** Maps the user's current allocation to the 3 ideal categories. */
function mapCurrentToIdeal(curr: CurrentAllocation) {
  // Crypto counts as "stocks" (high-risk growth) for risk-profile comparison.
  return {
    stocks: curr.stocks + curr.crypto,
    gold: curr.gold,
    cash: curr.cash,
  };
}

/** Computes rebalance suggestions — what to buy/sell to match the ideal. */
function computeRebalanceSuggestions(
  ideal: { asset: string; pct: number; ar: string }[],
  curr: CurrentAllocation
): { asset: string; ar: string; action: 'buy' | 'sell' | 'hold'; amount: number; deltaPct: number }[] {
  const mapped = mapCurrentToIdeal(curr);
  const suggestions: { asset: string; ar: string; action: 'buy' | 'sell' | 'hold'; amount: number; deltaPct: number }[] = [];

  for (const idealItem of ideal) {
    const currentPct = mapped[idealItem.asset as keyof typeof mapped] ?? 0;
    const deltaPct = idealItem.pct - currentPct;
    const amount = Math.abs(deltaPct / 100) * curr.totalValue;

    if (Math.abs(deltaPct) > 10) {
      suggestions.push({
        asset: idealItem.asset,
        ar: idealItem.ar,
        action: deltaPct > 0 ? 'buy' : 'sell',
        amount: Math.round(amount),
        deltaPct: Math.round(deltaPct * 10) / 10,
      });
    } else {
      suggestions.push({
        asset: idealItem.asset,
        ar: idealItem.ar,
        action: 'hold',
        amount: 0,
        deltaPct: Math.round(deltaPct * 10) / 10,
      });
    }
  }

  return suggestions;
}

export function RiskProfilerQuiz({ currentAllocation }: RiskProfilerQuizProps) {
  const [step, setStep] = useState(0); // 0-4 questions, 5 = result
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [savedProfile, setSavedProfile] = useState<RiskProfile | null>(null);
  const [hidden, setHidden] = useState(false);

  // حمّل الملف المحفوظ + حالة الإخفاء
  useEffect(() => {
    try {
      if (localStorage.getItem(HIDDEN_KEY) === '1') {
        setHidden(true);
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.score) setSavedProfile(evaluateProfile(parsed.score));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleHide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDDEN_KEY, '1');
    } catch {
      /* ignore */
    }
    toast.success('تم إخفاء الاستبيان. تقدر تظهره من زرار "إظهار الاستبيان"');
  };

  const handleShow = () => {
    setHidden(false);
    try {
      localStorage.removeItem(HIDDEN_KEY);
    } catch {
      /* ignore */
    }
  };

  const currentQ = QUESTIONS[step];
  const isLastQ = step === QUESTIONS.length - 1;
  const progressPct = (step / QUESTIONS.length) * 100;

  const handleAnswer = (value: number) => {
    const newAnswers = { ...answers, [currentQ.id]: value };
    setAnswers(newAnswers);
    setTimeout(() => {
      if (isLastQ) {
        const total = Object.values(newAnswers).reduce((a, b) => a + b, 0);
        const profile = evaluateProfile(total);
        setSavedProfile(profile);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ score: total, date: new Date().toISOString() }));
        } catch {
          /* ignore */
        }
        setStep(QUESTIONS.length); // result screen
        toast.success(`شخصيتك الاستثمارية: ${profile.typeAr}`);
      } else {
        setStep((s) => s + 1);
      }
    }, 250);
  };

  const reset = () => {
    setStep(0);
    setAnswers({});
    setSavedProfile(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  // ── Hidden state: show a small "show" button ──────────────────
  if (hidden) {
    return (
      <Card className="border-dashed" dir="rtl">
        <CardContent className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Gauge className="h-4 w-4" />
            <span>استبيان المخاطر مخفي</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleShow} className="text-xs">
            إظهار الاستبيان
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Rebalance suggestions (Task 6) ────────────────────────────
  const rebalanceSuggestions = (savedProfile && currentAllocation && currentAllocation.totalValue > 0)
    ? computeRebalanceSuggestions(savedProfile.idealAllocation, currentAllocation)
    : null;
  const hasRebalanceWarning = rebalanceSuggestions
    ? rebalanceSuggestions.some((s) => s.action !== 'hold')
    : false;

  // ─── شاشة النتيجة ──────────────────────────────────────────────
  if (step === QUESTIONS.length && savedProfile) {
    const Icon = savedProfile.icon;
    return (
      <Card className="border-2" dir="rtl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="h-5 w-5" />
                ملف المخاطر الخاص بيك
              </CardTitle>
              <CardDescription className="mt-1">
                نتايج الـ Risk Profiler — شخصيتك الاستثمارية والتوزيع المثالي
              </CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="h-4 w-4 ml-1" />
                إعادة
              </Button>
              <Button variant="ghost" size="sm" onClick={handleHide} aria-label="إخفاء">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* نوع الشخصية */}
          <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
            <Icon className={cn('h-10 w-10', savedProfile.color)} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{savedProfile.typeAr}</span>
                <Badge variant="secondary">{savedProfile.percentage}%</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                النتيجة: {savedProfile.score} من {savedProfile.maxScore}
              </p>
            </div>
          </div>

          {/* الوصف */}
          <p className="text-sm leading-relaxed">{savedProfile.description}</p>

          {/* التوزيع المثالي + التوزيع الحالي (لو متوفر) */}
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              التوزيع المثالي لمحفظتك:
            </h4>
            <div className="space-y-2">
              {savedProfile.idealAllocation.map((a) => {
                const currentPct = currentAllocation
                  ? mapCurrentToIdeal(currentAllocation)[a.asset as keyof ReturnType<typeof mapCurrentToIdeal>] ?? 0
                  : null;
                return (
                  <div key={a.asset} className="flex items-center gap-2">
                    <span className="text-sm w-40 shrink-0">{a.ar}</span>
                    <div className="flex-1 relative">
                      <Progress value={a.pct} className="h-2" />
                      {currentPct !== null && (
                        <div
                          className="absolute top-0 h-2 w-1 bg-blue-600 rounded"
                          style={{ right: `${100 - currentPct}%` }}
                          title={`الحالي: ${currentPct.toFixed(0)}%`}
                        />
                      )}
                    </div>
                    <span className="text-sm font-bold w-12 text-left">{a.pct}%</span>
                    {currentPct !== null && (
                      <span className="text-xs text-muted-foreground w-12 text-left">
                        ({currentPct.toFixed(0)}%)
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {currentAllocation && (
              <p className="text-xs text-muted-foreground mt-2">
                الأرقام بين قوسين = توزيعك الحالي. الكريبتو محسوب ضمن الأسهم (مخاطر عالية).
              </p>
            )}
          </div>

          {/* ── تنبيه إعادة التوازن (Task 6) ── */}
          {rebalanceSuggestions && hasRebalanceWarning && (
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700">
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                    توزيعك الحالي مخالف لشخصيتك الاستثمارية!
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    علشان ترجع للتقسيمة الصح، اتبع التوصيات دي:
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {rebalanceSuggestions.filter((s) => s.action !== 'hold').map((s) => (
                  <div
                    key={s.asset}
                    className={cn(
                      'flex items-center justify-between p-2 rounded-md text-sm',
                      s.action === 'sell'
                        ? 'bg-red-100 dark:bg-red-900/30'
                        : 'bg-green-100 dark:bg-green-900/30'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Scale className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{s.ar}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={s.action === 'sell'
                          ? 'border-red-400 text-red-700 dark:text-red-300'
                          : 'border-green-400 text-green-700 dark:text-green-300'
                        }
                      >
                        {s.action === 'sell' ? '↓ بيع' : '↑ شراء'}
                      </Badge>
                      <span className="font-bold">
                        {new Intl.NumberFormat('ar-EG').format(s.amount)} ج.م
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({s.deltaPct > 0 ? '+' : ''}{s.deltaPct}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* توقع Rebalancing (static hint — kept for context) */}
          {!currentAllocation && (
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                💡 <strong>توقع الروبو-أدفايزر:</strong> قارن التوزيع الحالي لمحفظتك بالتوزيع المثالي فوق.
                لو فرق أي أصل أكتر من 10%، اعمل Rebalancing (بيع الزايد واشتري الناقص) عشان تفضل في نطاق شخصيتك الاستثمارية.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ─── شاشة الأسئلة ──────────────────────────────────────────────
  return (
    <Card className="border-2" dir="rtl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5" />
              محرك تقييم المخاطر
            </CardTitle>
            <CardDescription className="mt-1">
              5 أسئلة لتحديد شخصيتك الاستثمارية والتوزيع المثالي
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            {step > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                <ArrowLeft className="h-4 w-4 ml-1" />
                السابق
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleHide} aria-label="إخفاء">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Progress value={progressPct} className="h-1.5 mt-2" />
      </CardHeader>
      <CardContent>
        <div className="mb-2 text-xs text-muted-foreground">
          سؤال {step + 1} من {QUESTIONS.length}
        </div>
        <h3 className="text-base font-semibold mb-4 leading-relaxed">{currentQ.text}</h3>
        <RadioGroup
          value={answers[currentQ.id]?.toString() || ''}
          onValueChange={(v) => handleAnswer(Number(v))}
          className="space-y-2"
        >
          {currentQ.options.map((opt) => (
            <div
              key={opt.value}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-muted/50',
                answers[currentQ.id] === opt.value && 'border-primary bg-primary/5'
              )}
            >
              <RadioGroupItem value={opt.value.toString()} id={`${currentQ.id}-${opt.value}`} />
              <Label
                htmlFor={`${currentQ.id}-${opt.value}`}
                className="flex-1 cursor-pointer text-sm"
              >
                {opt.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
