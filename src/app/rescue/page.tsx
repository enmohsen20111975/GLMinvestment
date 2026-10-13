'use client';

import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle, Activity, TrendingDown, TrendingUp, Clock,
  Heart, Skull, Stethoscope, Lightbulb, ArrowRight, Target,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'next/navigation';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RescueResult {
  verdict: 'CUT_LOSS' | 'AVERAGE_DOWN' | 'HOLD';
  lossPct: number;
  lossEgp: number;
  currentPrice: number;
  entryPrice: number;
  qty: number;
  diagnosis: string;
  assetHealth: {
    liquidity: 'high' | 'medium' | 'low';
    supportLevel: number | null;
    exitLevel: number | null;
    trend: 'up' | 'down' | 'sideways';
  };
  actionPlan: { step: string; detail: string }[];
  lessons: string[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RescuePage() {
  const searchParams = useSearchParams();
  const initialTicker = searchParams.get('ticker') || '';

  const [ticker, setTicker] = useState(initialTicker);
  const [entryPrice, setEntryPrice] = useState('');
  const [qty, setQty] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RescueResult | null>(null);

  const handleDiagnose = useCallback(async () => {
    if (!ticker.trim()) {
      toast.error('أدخل رمز السهم');
      return;
    }
    if (!entryPrice || Number(entryPrice) <= 0) {
      toast.error('أدخل سعر الشراء الأصلي');
      return;
    }
    setLoading(true);
    setResult(null);

    try {
      // Fetch current price from /api/stocks/[ticker]/comprehensive
      const res = await fetch(`/api/stocks/${encodeURIComponent(ticker.trim())}/comprehensive`, { cache: 'no-store' });
      const json = await res.json();

      const currentPrice = Number(json?.stock?.current_price ?? json?.stats?.lastClose ?? 0);
      const entry = Number(entryPrice);
      const quantity = Number(qty) || 1;

      if (currentPrice <= 0) {
        toast.error('تعذر جلب السعر الحالي — تأكد من رمز السهم');
        setLoading(false);
        return;
      }

      const lossPct = ((currentPrice - entry) / entry) * 100;
      const lossEgp = (currentPrice - entry) * quantity;

      // Determine verdict
      let verdict: RescueResult['verdict'] = 'HOLD';
      let diagnosis = '';

      if (lossPct <= -15) {
        verdict = 'CUT_LOSS';
        diagnosis = `خسارة حادة (${lossPct.toFixed(1)}%) — السهم كسر مستويات الدعم الرئيسية والمخاطرة تتصاعد مع استمرار الهبوط.`;
      } else if (lossPct <= -7) {
        verdict = 'AVERAGE_DOWN';
        diagnosis = `خسارة متوسطة (${lossPct.toFixed(1)}%) — يمكن تخفيض متوسط التكلفة بشروط استقرار السهم عند الدعم الحالي.`;
      } else if (lossPct < 0) {
        verdict = 'HOLD';
        diagnosis = `خسارة محدودة (${lossPct.toFixed(1)}%) — السهم في نطاق تذبذب طبيعي. الصبر مبرر.`;
      } else {
        verdict = 'HOLD';
        diagnosis = `الصفقة رابحة (${lossPct.toFixed(1)}%) — لا حاجة لإنقاذ. راقب الهدف.`;
      }

      // Asset health (from API data)
      const stockInfo = json?.stock || {};
      const turnover = Number(stockInfo.turnover_egp ?? stockInfo.avg_turnover_20d ?? 0);
      const liquidity: 'high' | 'medium' | 'low' =
        turnover > 5_000_000 ? 'high' : turnover > 1_000_000 ? 'medium' : 'low';

      const supportLevel = Number(stockInfo.support ?? stockInfo.low_52w ?? 0) || null;
      const exitLevel = Number(stockInfo.resistance ?? stockInfo.high_52w ?? 0) || null;

      const changePct = Number(stockInfo.change_percent ?? 0);
      const trend: 'up' | 'down' | 'sideways' = changePct > 1 ? 'up' : changePct < -1 ? 'down' : 'sideways';

      // Action plan
      const actionPlan: { step: string; detail: string }[] = [];
      if (verdict === 'CUT_LOSS') {
        actionPlan.push({ step: '1️⃣ اقطع الخسارة', detail: `بِع ${quantity} سهم عند ${currentPrice.toFixed(2)} ج.م — الخسارة ${lossEgp.toFixed(2)} ج.م` });
        actionPlan.push({ step: '2️⃣ أعد توجيه الكاش', detail: `استثمر ${Math.abs(lossEgp).toFixed(0)} ج.م المتبقية في سهم صاعد ذي سيولة عالية` });
        actionPlan.push({ step: '3️⃣ تعافى نفسياً', detail: 'لا تطارد الخسارة — انتظر فرصة مؤكدة قبل العودة للسوق' });
      } else if (verdict === 'AVERAGE_DOWN') {
        const avgPrice = (entry + currentPrice) / 2;
        actionPlan.push({ step: '1️⃣ اشتر دفعة تبريد', detail: `اشترِ ${quantity} سهم إضافي عند ${currentPrice.toFixed(2)} لتخفيض المتوسط إلى ${avgPrice.toFixed(2)}` });
        actionPlan.push({ step: '2️⃣ ضع وقفاً صارماً', detail: `وقف عند ${supportLevel ? supportLevel.toFixed(2) : (currentPrice * 0.95).toFixed(2)} ج.م` });
        actionPlan.push({ step: '3️⃣ راقب الدعم', detail: `إذا كسر ${supportLevel ? supportLevel.toFixed(2) : 'الدعم الحالي'} — اقطع فوراً` });
      } else {
        actionPlan.push({ step: '1️⃣ اصبر', detail: 'الصفقة في نطاق آمن — راقب الأداء دون توتر' });
        actionPlan.push({ step: '2️⃣ راقب الهدف', detail: `الهدف القريب: ${exitLevel ? exitLevel.toFixed(2) : '—'} ج.م` });
        actionPlan.push({ step: '3️⃣ حدّث الوقف', detail: 'ارفع وقف الخسارة تدريجياً مع ارتقاء السعر' });
      }

      // Lessons
      const lessons = [
        verdict === 'CUT_LOSS' ? '🧠 الخسارة جزء من التداول — القطع المبكر أفضل من الانتظار حتى القاع' : '✅ الصبر على الصفقات الرابحة أساس النجاح',
        '📊 لا تشتري أبداً في قمة شمعة انفجارية (ذروة شراء)',
        '🛑 ضع وقف الخسارة قبل الدخول — وليس بعد فوات الأوان',
        '💡 حجم الصفقة لا يتجاوز 5% من رأس المال',
      ];

      setResult({
        verdict,
        lossPct,
        lossEgp,
        currentPrice,
        entryPrice: entry,
        qty: quantity,
        diagnosis,
        assetHealth: { liquidity, supportLevel, exitLevel, trend },
        actionPlan,
        lessons,
      });
    } catch {
      toast.error('فشل التشخيص — تحقق من الاتصال وحاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  }, [ticker, entryPrice, qty]);

  const verdictConfig = useMemo(() => {
    if (!result) return null;
    const configs = {
      CUT_LOSS: {
        label: 'اقطع الخسارة فوراً',
        icon: Skull,
        color: 'text-red-600 dark:text-red-400',
        bg: 'bg-red-50 dark:bg-red-950/30',
        border: 'border-red-300 dark:border-red-800',
        badge: 'bg-red-600 text-white',
      },
      AVERAGE_DOWN: {
        label: 'اعمل متوسط بحساب دقيق',
        icon: Activity,
        color: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-50 dark:bg-blue-950/30',
        border: 'border-blue-300 dark:border-blue-800',
        badge: 'bg-blue-600 text-white',
      },
      HOLD: {
        label: 'اصبر',
        icon: Clock,
        color: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-50 dark:bg-emerald-950/30',
        border: 'border-emerald-300 dark:border-emerald-800',
        badge: 'bg-emerald-600 text-white',
      },
    };
    return configs[result.verdict];
  }, [result]);

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-black flex items-center justify-center gap-2">
            🚑 عيادة إنقاذ الصفقات المتعثرة
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            تشخيص تشريحي للمراكز الخاسرة، كشف أسباب التعثر، وحسم القرار بين القطع أو التبريد أو الصبر بخطة تعافي دقيقة
          </p>
        </div>

        {/* Input Card */}
        <Card className="border-2 border-primary/20">
          <CardContent className="p-4 md:p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">رمز السهم</Label>
                <Input
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  placeholder="مثال: COMI"
                  className="h-10 font-mono"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">سعر الشراء الأصلي (ج.م)</Label>
                <Input
                  type="number"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  placeholder="مثال: 25.50"
                  className="h-10 font-mono"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">الكمية المملوكة</Label>
                <Input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="مثال: 1000"
                  className="h-10 font-mono"
                  dir="ltr"
                />
              </div>
            </div>
            <Button
              onClick={handleDiagnose}
              disabled={loading}
              className="w-full h-11 text-sm font-bold gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  جاري التشخيص...
                </>
              ) : (
                <>
                  <Stethoscope className="w-4 h-4" />
                  🩺 تشخيص الصفقة وإصدار قرار الإنقاذ
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        )}

        {result && verdictConfig && !loading && (
          <div className="space-y-4">
            {/* Verdict Banner */}
            <Card className={cn('border-2', verdictConfig.border, verdictConfig.bg)}>
              <CardContent className="p-4 md:p-5 flex items-center gap-4">
                <div className={cn('w-12 h-12 rounded-full flex items-center justify-center shrink-0', verdictConfig.badge)}>
                  <verdictConfig.icon className="w-6 h-6 text-white" />
                </div>
                <div className="min-w-0">
                  <p className={cn('text-lg md:text-xl font-black', verdictConfig.color)}>
                    {verdictConfig.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{result.diagnosis}</p>
                </div>
              </CardContent>
            </Card>

            {/* Trade Autopsy + Asset Health */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Trade Autopsy */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Skull className="w-4 h-4 text-red-500" />
                    تشريح الصفقة
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">نسبة الخسارة</span>
                    <span className={cn('font-bold font-mono', result.lossPct < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                      {result.lossPct >= 0 ? '+' : ''}{result.lossPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">قيمة الخسارة</span>
                    <span className={cn('font-bold font-mono', result.lossEgp < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                      {result.lossEgp >= 0 ? '+' : ''}{result.lossEgp.toFixed(2)} ج.م
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">سعر الشراء</span>
                    <span className="font-mono font-semibold">{result.entryPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">السعر الحالي</span>
                    <span className="font-mono font-semibold">{result.currentPrice.toFixed(2)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Asset Health */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Heart className="w-4 h-4 text-emerald-500" />
                    حيوية الأصل والسيولة
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">السيولة المؤسسية</span>
                    <Badge variant="outline" className={cn(
                      'text-[10px] h-5',
                      result.assetHealth.liquidity === 'high' && 'border-emerald-500 text-emerald-600',
                      result.assetHealth.liquidity === 'medium' && 'border-blue-500 text-blue-600',
                      result.assetHealth.liquidity === 'low' && 'border-amber-500 text-amber-600',
                    )}>
                      {result.assetHealth.liquidity === 'high' ? 'عالية' : result.assetHealth.liquidity === 'medium' ? 'متوسطة' : 'منخفضة'}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الاتجاه</span>
                    <span className="font-semibold flex items-center gap-1">
                      {result.assetHealth.trend === 'up' ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : result.assetHealth.trend === 'down' ? <TrendingDown className="w-3 h-3 text-red-500" /> : <Activity className="w-3 h-3 text-amber-500" />}
                      {result.assetHealth.trend === 'up' ? 'صاعد' : result.assetHealth.trend === 'down' ? 'هابط' : 'عرضي'}
                    </span>
                  </div>
                  {result.assetHealth.supportLevel && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">مستوى الدعم</span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{result.assetHealth.supportLevel.toFixed(2)}</span>
                    </div>
                  )}
                  {result.assetHealth.exitLevel && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">مستوى الخروج</span>
                      <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">{result.assetHealth.exitLevel.toFixed(2)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Action Plan */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Target className="w-4 h-4 text-primary" />
                  خطة العمل والتعافي
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.actionPlan.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                    <span className="text-sm font-bold shrink-0">{step.step}</span>
                    <span className="text-xs text-muted-foreground">{step.detail}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Lessons Learned */}
            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                  الدروس المستفادة
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {result.lessons.map((lesson, i) => (
                  <p key={i} className="text-xs text-muted-foreground leading-relaxed">{lesson}</p>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
