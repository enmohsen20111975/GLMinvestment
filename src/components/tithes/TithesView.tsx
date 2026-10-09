'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Calculator,
  BookOpen,
  Coins,
  CircleDollarSign,
  TrendingUp,
  Heart,
  Scale,
  Info,
  CheckCircle2,
  Sparkles,
  HandHeart,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Christian Symbol Components                                        */
/* ------------------------------------------------------------------ */

function Cross({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11 2v7H4v4h7v9h2v-9h7v-4h-7V2z"/>
    </svg>
  );
}

function Dove({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3c-1.5 0-3 .5-4 1.5L6 3 4.5 7c-.5 1-.5 2.5 0 3.5L6 14l-3 3 1.5 1.5L8 15l2 1.5V21h4v-4.5l2-1.5 3.5 3.5L21 17l-3-3 1.5-3.5c.5-1 .5-2.5 0-3.5L18 3l-2 1.5c-1-1-2.5-1.5-4-1.5z"/>
    </svg>
  );
}

function ChristianPattern() {
  return (
    <svg className="absolute inset-0 w-full h-full opacity-5" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="christianPattern" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M40 10 L40 30 M30 20 L50 20" stroke="currentColor" strokeWidth="1"/>
          <circle cx="40" cy="50" r="8" fill="none" stroke="currentColor" strokeWidth="0.5"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#christianPattern)"/>
    </svg>
  );
}

function OrnamentDivider() {
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      <div className="flex-1 h-px bg-gradient-to-l from-transparent via-primary/50 to-transparent"/>
      <Cross className="w-4 h-4 text-teal-500/50"/>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"/>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const TITHE = {
  rate: 0.10,
  rateDescription: '10% (العُشر)',
};

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface TitheInput {
  monthlySalary: number;
  otherIncome: number;
  bonuses: number;
  investments: number;
  gifts: number;
}

interface TitheResult {
  category: string;
  categoryAr: string;
  amount: number;
  details: string;
}

/* ------------------------------------------------------------------ */
/*  Helper Functions                                                  */
/* ------------------------------------------------------------------ */

function formatNumber(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + ' مليار';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + ' مليون';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + ' ألف';
  return (num ?? 0).toFixed(2);
}

function formatCurrency(num: number): string {
  return formatNumber(num) + ' ج.م';
}

/* ------------------------------------------------------------------ */
/*  Biblical Basis Component                                          */
/* ------------------------------------------------------------------ */

function BiblicalBasis() {
  return (
    <Card className="relative overflow-hidden border-teal-500/30 bg-gradient-to-br from-blue-50 via-white to-teal-50 dark:from-blue-950/30 dark:via-background dark:to-teal-950/30">
      <ChristianPattern />
      <div className="relative z-10">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-2">
            <Cross className="w-8 h-8 text-teal-600"/>
          </div>
          <CardTitle className="flex items-center justify-center gap-2 text-xl font-bold text-teal-700 dark:text-teal-400">
            <BookOpen className="w-6 h-6"/>
            الأساس الكتابي للعُشر
          </CardTitle>
          <OrnamentDivider />
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-3">
            <div className="p-4 bg-gradient-to-r from-purple-50 to-teal-50 dark:from-purple-950/30 dark:to-teal-950/30 rounded-xl border border-purple-200 dark:border-purple-800/50 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">ع.ق</div>
                <span className="font-bold text-purple-700 dark:text-purple-400">من العهد القديم</span>
              </div>
              <p className="text-base leading-relaxed text-purple-800 dark:text-purple-200">
                "أَقَدِّمُ كُلَّ عُشْرِ الأَرْضِ لِلرَّبِّ" (تكوين 28: 22)
              </p>
              <p className="text-base leading-relaxed text-purple-800 dark:text-purple-200 mt-2">
                "اِئْتُوا بِكُلِّ الْعُشْرِ إِلَى الْخِزَانَةِ" (ملاخي 3: 10)
              </p>
            </div>
            
            <div className="p-4 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 rounded-xl border border-teal-200 dark:border-teal-800/50 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-xs font-bold">ع.ج</div>
                <span className="font-bold text-teal-700 dark:text-teal-400">من العهد الجديد</span>
              </div>
              <p className="text-base leading-relaxed text-teal-800 dark:text-teal-200">
                "أَعْطُوا الَّذِي لِقَيْصَرَ لِقَيْصَرَ وَالَّذِي لِلَّهِ لِلَّهِ" (متى 22: 21)
              </p>
              <p className="text-base leading-relaxed text-teal-800 dark:text-teal-200 mt-2">
                "مُبَارَكٌ الْعَطَاءُ أَكْثَرَ مِنَ الأَخْذِ" (أعمال الرسل 20: 35)
              </p>
            </div>
            
            <div className="p-4 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30 rounded-xl border border-amber-200 dark:border-amber-800/50 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-bold">١٠٪</div>
                <span className="font-bold text-amber-700 dark:text-amber-400">مقدار العُشر</span>
              </div>
              <p className="text-base leading-relaxed text-amber-800 dark:text-amber-200">
                العُشر هو 10% من الدخل - إيماءً بأن كل ما نملك هو من الله
              </p>
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Tithe Info Component                                              */
/* ------------------------------------------------------------------ */

function TitheInfo() {
  return (
    <Card className="relative overflow-hidden border-teal-500/30 bg-gradient-to-br from-blue-50/50 via-white to-teal-50/50 dark:from-blue-950/20 dark:via-background dark:to-teal-950/20">
      <ChristianPattern />
      <div className="relative z-10">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-xl">
            <Scale className="w-6 h-6 text-teal-600"/>
            ما هو العُشر؟
          </CardTitle>
          <CardDescription className="text-base">الإيمان بالعطاء بنعمة</CardDescription>
          <OrnamentDivider />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-400 to-teal-500 rounded-2xl opacity-10 group-hover:opacity-15 transition-opacity"/>
              <div className="relative p-6 bg-gradient-to-br from-blue-50 to-teal-50 dark:from-blue-950/40 dark:to-teal-950/40 rounded-2xl border-2 border-teal-300 dark:border-teal-700/50 shadow-lg text-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-teal-500 flex items-center justify-center shadow-lg mx-auto mb-4">
                  <Coins className="w-8 h-8 text-white"/>
                </div>
                <h3 className="text-lg font-bold text-teal-700 dark:text-teal-300 mb-2">العُشر</h3>
                <p className="text-4xl font-bold text-teal-600 dark:text-teal-400 mb-2">10%</p>
                <p className="text-sm text-muted-foreground">من إجمالي الدخل</p>
              </div>
            </div>
            
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-400 to-pink-500 rounded-2xl opacity-10 group-hover:opacity-15 transition-opacity"/>
              <div className="relative p-6 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/40 dark:to-pink-950/40 rounded-2xl border-2 border-purple-300 dark:border-purple-700/50 shadow-lg text-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center shadow-lg mx-auto mb-4">
                  <Heart className="w-8 h-8 text-white"/>
                </div>
                <h3 className="text-lg font-bold text-purple-700 dark:text-purple-300 mb-2">الهدف</h3>
                <p className="text-base font-medium text-purple-600 dark:text-purple-400 mb-3">دعم الكنيسة والخدمة</p>
                <p className="text-sm text-muted-foreground">مساعدة المحتاجين</p>
              </div>
            </div>
          </div>
          
          <Alert className="mt-6 border-teal-300 bg-gradient-to-r from-blue-50 to-teal-50 dark:from-blue-950/30 dark:to-teal-950/30">
            <Dove className="w-5 h-5 text-teal-600"/>
            <AlertTitle className="text-teal-700 dark:text-teal-400 font-bold">بركة العطاء</AlertTitle>
            <AlertDescription className="text-sm text-teal-800 dark:text-teal-200">
              "اِحْفَظُوا الْخَمِيرَةَ الْقَدِيمَةَ" (1 كورنثوس 5: 8)
            </AlertDescription>
          </Alert>
        </CardContent>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Tithe Calculator Component                                        */
/* ------------------------------------------------------------------ */

function TitheCalculator() {
  const [inputs, setInputs] = useState<TitheInput>({
    monthlySalary: 0, otherIncome: 0, bonuses: 0, investments: 0, gifts: 0,
  });
  
  const updateInput = (key: keyof TitheInput, value: number) => {
    setInputs(prev => ({ ...prev, [key]: value }));
  };
  
  const results = useMemo(() => {
    const res: TitheResult[] = [];
    if (inputs.monthlySalary > 0) {
      res.push({ category: 'salary', categoryAr: 'الراتب الشهري', amount: inputs.monthlySalary * TITHE.rate, details: `الراتب: ${formatCurrency(inputs.monthlySalary)}` });
    }
    const totalOther = inputs.otherIncome + inputs.bonuses + inputs.investments + inputs.gifts;
    if (totalOther > 0) {
      res.push({ category: 'other', categoryAr: 'دخل آخر', amount: totalOther * TITHE.rate, details: `إجمالي الدخل الآخر: ${formatCurrency(totalOther)}` });
    }
    return res;
  }, [inputs]);
  
  const totalIncome = inputs.monthlySalary + inputs.otherIncome + inputs.bonuses + inputs.investments + inputs.gifts;
  const totalTithe = results.reduce((sum, r) => sum + r.amount, 0);
  const annualTithe = totalTithe * 12;
  
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="relative overflow-hidden border-2 border-teal-300 dark:border-teal-700/50 bg-gradient-to-br from-blue-50/50 to-teal-50/50 dark:from-blue-950/20 dark:to-teal-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3 text-lg">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-teal-500 flex items-center justify-center">
                <CircleDollarSign className="w-5 h-5 text-white"/>
              </div>
              <div>
                <span className="text-teal-700 dark:text-teal-300">الراتب الشهري</span>
                <p className="text-xs text-muted-foreground font-normal">الدخل الرئيسي</p>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <label className="text-xs font-medium text-teal-700 dark:text-teal-300">الراتب الشهري (ج.م)</label>
              <Input type="number" placeholder="0" value={inputs.monthlySalary || ''} onChange={(e) => updateInput('monthlySalary', parseFloat(e.target.value) || 0)} className="border-teal-200 focus:border-teal-400"/>
            </div>
          </CardContent>
        </Card>
        
        <Card className="relative overflow-hidden border-2 border-purple-300 dark:border-purple-700/50 bg-gradient-to-br from-purple-50/50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3 text-lg">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white"/>
              </div>
              <div>
                <span className="text-purple-700 dark:text-purple-300">دخل إضافي</span>
                <p className="text-xs text-muted-foreground font-normal">مكافآت، هبات، استثمارات</p>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-purple-700 dark:text-purple-300">دخل آخر</label>
                <Input type="number" placeholder="0" value={inputs.otherIncome || ''} onChange={(e) => updateInput('otherIncome', parseFloat(e.target.value) || 0)} className="border-purple-200 focus:border-purple-400"/>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-purple-700 dark:text-purple-300">مكافآت</label>
                <Input type="number" placeholder="0" value={inputs.bonuses || ''} onChange={(e) => updateInput('bonuses', parseFloat(e.target.value) || 0)} className="border-purple-200 focus:border-purple-400"/>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-purple-700 dark:text-purple-300">استثمارات</label>
                <Input type="number" placeholder="0" value={inputs.investments || ''} onChange={(e) => updateInput('investments', parseFloat(e.target.value) || 0)} className="border-purple-200 focus:border-purple-400"/>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-purple-700 dark:text-purple-300">هبات</label>
                <Input type="number" placeholder="0" value={inputs.gifts || ''} onChange={(e) => updateInput('gifts', parseFloat(e.target.value) || 0)} className="border-purple-200 focus:border-purple-400"/>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {results.length > 0 && (
        <Card className="relative overflow-hidden border-2 border-teal-300 dark:border-teal-700/50 bg-gradient-to-br from-blue-50/30 to-teal-50/30 dark:from-blue-950/20 dark:to-teal-950/20">
          <ChristianPattern />
          <div className="relative z-10">
            <CardHeader className="text-center">
              <CardTitle className="flex items-center justify-center gap-2 text-xl">
                <Calculator className="w-6 h-6 text-teal-600"/>
                نتيجة حساب العُشر
              </CardTitle>
              <OrnamentDivider />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {results.map((result, index) => (
                  <div key={index} className="p-4 rounded-xl border-2 bg-gradient-to-l from-blue-100 to-teal-50 dark:from-blue-900/30 dark:to-teal-900/30 border-teal-300 dark:border-teal-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center">
                          <CheckCircle2 className="w-5 h-5 text-white"/>
                        </div>
                        <div>
                          <p className="font-bold text-lg">{result.categoryAr}</p>
                          <p className="text-sm text-muted-foreground">{result.details}</p>
                        </div>
                      </div>
                      <div className="text-left">
                        <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">{formatCurrency(result.amount)}</p>
                        <Badge className="text-xs bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300">عُشر شهري</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              <Separator className="my-6"/>
              
              <div className="relative p-8 bg-gradient-to-br from-primary via-teal-500 to-purple-500 rounded-2xl shadow-xl overflow-hidden text-center text-white">
                <Dove className="w-10 h-10 mx-auto mb-2 opacity-80"/>
                <p className="text-sm opacity-90 mb-1">العُشر الشهري</p>
                <p className="text-4xl font-bold mb-2">{formatCurrency(totalTithe)}</p>
                <div className="flex items-center justify-center gap-2 text-sm opacity-80">
                  <Heart className="w-4 h-4"/>
                  <span>العُشر السنوي: {formatCurrency(annualTithe)}</span>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mt-6">
                <div className="text-center p-4 rounded-xl bg-teal-50 dark:bg-teal-900/30">
                  <p className="text-xs text-muted-foreground mb-1">إجمالي الدخل</p>
                  <p className="text-lg font-bold text-teal-600">{formatCurrency(totalIncome)}</p>
                </div>
                <div className="text-center p-4 rounded-xl bg-teal-50 dark:bg-teal-900/30">
                  <p className="text-xs text-muted-foreground mb-1">العُشر الشهري</p>
                  <p className="text-lg font-bold text-teal-600">{formatCurrency(totalTithe)}</p>
                </div>
                <div className="text-center p-4 rounded-xl bg-purple-50 dark:bg-purple-900/30">
                  <p className="text-xs text-muted-foreground mb-1">العُشر السنوي</p>
                  <p className="text-lg font-bold text-purple-600">{formatCurrency(annualTithe)}</p>
                </div>
              </div>
            </CardContent>
          </div>
        </Card>
      )}
      
      {results.length === 0 && (
        <Card className="border-dashed border-2">
          <CardContent className="py-16 text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-muted/30 flex items-center justify-center mb-4">
              <Calculator className="w-10 h-10 text-muted-foreground"/>
            </div>
            <p className="text-lg text-muted-foreground">أدخل دخلك لحساب العُشر</p>
            <p className="text-sm text-muted-foreground mt-2">سيتم حساب العُشر تلقائياً (10%)</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Giving Guide Component                                            */
/* ------------------------------------------------------------------ */

function GivingGuide() {
  const guides = [
    { title: 'العُشر', icon: Coins, color: 'blue', content: '10% من الدخل - أساس العطاء المسيحي' },
    { title: 'العطاء بسرور', icon: Heart, color: 'red', content: '"اَللَّهَ يُحِبُّ الْمُعْطِيَ الْمَسْرُورَ" (2 كورنثوس 9: 7)' },
    { title: 'العطاء بالإيمان', icon: Sparkles, color: 'amber', content: 'العطاء إيمان بأن الله هو المصدر' },
    { title: 'بركة العطاء', icon: HandHeart, color: 'purple', content: '"مُبَارَكٌ الْعَطَاءُ أَكْثَرَ مِنَ الأَخْذِ"' },
  ];
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {guides.map((guide, index) => {
        const Icon = guide.icon;
        return (
          <Card key={index} className={cn(
            'relative overflow-hidden border-r-4',
            guide.color === 'blue' && 'border-r-primary bg-gradient-to-l from-blue-50/50 to-transparent dark:from-blue-950/20',
            guide.color === 'red' && 'border-r-red-500 bg-gradient-to-l from-red-50/50 to-transparent dark:from-red-950/20',
            guide.color === 'amber' && 'border-r-amber-500 bg-gradient-to-l from-amber-50/50 to-transparent dark:from-amber-950/20',
            guide.color === 'purple' && 'border-r-purple-500 bg-gradient-to-l from-purple-50/50 to-transparent dark:from-purple-950/20',
          )}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center',
                  guide.color === 'blue' && 'bg-teal-500',
                  guide.color === 'red' && 'bg-red-500',
                  guide.color === 'amber' && 'bg-amber-500',
                  guide.color === 'purple' && 'bg-purple-500',
                )}>
                  <Icon className="w-5 h-5 text-white"/>
                </div>
                <div>
                  <h4 className="font-bold">{guide.title}</h4>
                  <p className="text-sm text-muted-foreground">{guide.content}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  B-3 TASK: Auto Tithes Card — Automatic Tithe from Portfolio       */
/* ------------------------------------------------------------------ */
// Fetches the user's monthly income & obligations and computes the tithe:
//   tithableIncome = salary + investmentYield + otherIncome - monthlyDebts
//   titheDue       = tithableIncome * 0.10
// No nisab threshold — the tithe applies to any net monthly income.
// Sources:
//   /api/finance/calculate-values  -> smart_math.monthly_yield_egp (investment yield)
//   /api/finance/reports           -> monthly income (salary)
//   /api/finance/obligations?status=active -> sum of monthly_payment (debts)

interface AutoTithesBreakdown {
  salary: number;          // monthly income from /api/finance/reports
  investmentYield: number; // smart_math.monthly_yield_egp from calculate-values
  otherIncome: number;     // sum of any other income fields if present
  monthlyDebts: number;    // sum of active obligations monthly_payment
}

function AutoTithesCard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<AutoTithesBreakdown | null>(null);
  const [tithable, setTithable] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      // 1) Portfolio values — primary source; handles 401 (auth required)
      const calcRes = await fetch('/api/finance/calculate-values', { cache: 'no-store' });
      if (calcRes.status === 401) {
        setError('يجب تسجيل الدخول لحساب العُشر تلقائياً من محفظتك');
        setBreakdown(null);
        setTithable(0);
        return;
      }
      if (!calcRes.ok) throw new Error('فشل تحميل بيانات المحفظة');
      const calcData = await calcRes.json();
      if (!calcData.success) throw new Error(calcData.error || 'فشل تحميل بيانات المحفظة');
      const investmentYield = Number(calcData.smart_math?.monthly_yield_egp || 0);

      // 2) Reports — monthly income (salary). Defensive: read multiple paths.
      let salary = 0;
      try {
        const repRes = await fetch('/api/finance/reports', { cache: 'no-store' });
        if (repRes.ok) {
          const repData = await repRes.json();
          if (repData.success) {
            const rep = repData.report || repData.summary || {};
            salary = Number(
              rep.summary?.monthly_income ??
              rep.transactions_summary?.total_income ??
              rep.monthly_income ??
              0
            );
          }
        }
      } catch { /* reports endpoint optional — fail soft */ }

      // 3) Active obligations — monthly debts to deduct from gross income.
      let monthlyDebts = 0;
      try {
        const oblRes = await fetch('/api/finance/obligations?status=active', { cache: 'no-store' });
        if (oblRes.ok) {
          const oblData = await oblRes.json();
          if (oblData.success) {
            const items: any[] = oblData.items || [];
            monthlyDebts = items.reduce(
              (sum, o) => sum + Number(o.monthly_payment || 0),
              0
            );
          }
        }
      } catch { /* obligations endpoint optional — fail soft */ }

      // otherIncome: reserved for future income fields; currently 0.
      const otherIncome = 0;
      const netTithable = Math.max(
        0,
        salary + investmentYield + otherIncome - monthlyDebts
      );
      setBreakdown({ salary, investmentYield, otherIncome, monthlyDebts });
      setTithable(netTithable);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ أثناء تحميل البيانات');
      setBreakdown(null);
      setTithable(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const titheDue = tithable * TITHE.rate;

  return (
    <Card className="relative overflow-hidden border-2 border-teal-400 dark:border-teal-700/50 bg-gradient-to-br from-blue-50/60 via-white to-teal-50/60 dark:from-blue-950/30 dark:via-background dark:to-teal-950/30 shadow-lg">
      <ChristianPattern />
      <div className="relative z-10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-teal-600 flex items-center justify-center shadow">
                <Sparkles className="w-5 h-5 text-white"/>
              </div>
              <div>
                <span className="text-teal-700 dark:text-teal-300 text-lg">العُشر التلقائي من محفظتك</span>
                <p className="text-xs text-muted-foreground font-normal">محسوب من دخلك الشهري — بعد خصم الأقساط</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(true)}
              disabled={refreshing}
              className="border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-300"
            >
              <RefreshCw className={cn('w-4 h-4 ml-1', refreshing && 'animate-spin')}/>
              تحديث
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full"/>
              <Skeleton className="h-24 w-full"/>
              <Skeleton className="h-12 w-full"/>
            </div>
          )}

          {error && !loading && (
            <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
              <AlertTriangle className="w-4 h-4 text-amber-600"/>
              <AlertDescription className="text-sm text-amber-700 dark:text-amber-300">{error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && breakdown && (
            <>
              {/* Breakdown of income sources & deductions */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                <BreakdownRow icon={<CircleDollarSign className="w-4 h-4"/>} label="الراتب الشهري" value={breakdown.salary} color="blue"/>
                <BreakdownRow icon={<TrendingUp className="w-4 h-4"/>} label="عائد الاستثمار" value={breakdown.investmentYield} color="green"/>
                <BreakdownRow icon={<HandHeart className="w-4 h-4"/>} label="دخل آخر" value={breakdown.otherIncome} color="purple"/>
                <BreakdownRow icon={<AlertTriangle className="w-4 h-4"/>} label="أقساط تُطرح" value={-breakdown.monthlyDebts} color="red"/>
              </div>

              <Separator/>

              {/* Note: tithe is on NET income after deducting installments */}
              <div className="flex items-start gap-2 p-3 rounded-xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/50">
                <Info className="w-4 h-4 text-teal-600 mt-0.5 shrink-0"/>
                <p className="text-xs text-teal-800 dark:text-teal-200 leading-relaxed">
                  العُشر يُحتسب على صافي الدخل الشهري بعد خصم الأقساط.
                  المعادلة: (راتب + عائد استثمار + دخل آخر − أقساط شهرية) × 10%.
                </p>
              </div>

              {/* Tithable income summary */}
              <div className="flex items-center justify-between flex-wrap gap-2 p-3 rounded-xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/50">
                <div className="flex items-center gap-2">
                  <Scale className="w-5 h-5 text-teal-600"/>
                  <div>
                    <p className="text-xs text-muted-foreground">صافي الدخل الشهري الخاضع للعُشر</p>
                    <p className="font-bold text-teal-700 dark:text-teal-300">{formatCurrency(tithable)}</p>
                  </div>
                </div>
                <div className="text-left">
                  <p className="text-xs text-muted-foreground">نسبة العُشر</p>
                  <p className="font-bold text-teal-700 dark:text-teal-300">10%</p>
                </div>
              </div>

              {/* Result block — green gradient if tithe due, blue info if no income */}
              {tithable > 0 ? (
                <div className="relative p-6 bg-gradient-to-br from-primary via-teal-500 to-purple-500 rounded-2xl shadow-xl overflow-hidden text-center text-white">
                  <div className="absolute inset-0 opacity-20">
                    <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <pattern id="autoTithesStars" width="10" height="10" patternUnits="userSpaceOnUse">
                        <circle cx="5" cy="5" r="1" fill="white"/>
                      </pattern>
                      <rect width="100%" height="100%" fill="url(#autoTithesStars)"/>
                    </svg>
                  </div>
                  <div className="relative">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-2"/>
                    <p className="text-sm opacity-90 mb-1">العُشر المستحق هذا الشهر</p>
                    <p className="text-4xl font-bold mb-2">{formatCurrency(titheDue)}</p>
                    <p className="text-xs opacity-80">نسبة 10% من صافي الدخل {formatCurrency(tithable)}</p>
                  </div>
                </div>
              ) : (
                <Alert className="border-teal-300 bg-teal-50 dark:bg-teal-950/30">
                  <Info className="w-5 h-5 text-teal-600"/>
                  <AlertDescription className="text-sm text-teal-800 dark:text-teal-200">
                    سجّل دخلك الشهري أو أضف أصولاً ذات عائد لمحفظتك ليتم حساب العُشر تلقائياً.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </div>
    </Card>
  );
}

function BreakdownRow({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'text-teal-600 dark:text-teal-400',
    green: 'text-green-600 dark:text-green-400',
    purple: 'text-purple-600 dark:text-purple-400',
    red: 'text-red-600 dark:text-red-400',
  };
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-white/60 dark:bg-background/40 border border-muted">
      <div className="flex items-center gap-1.5">
        <span className={colorMap[color] || colorMap.blue}>{icon}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className={cn('text-xs font-bold', colorMap[color] || colorMap.blue)}>{formatCurrency(Math.abs(value))}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export function TithesView() {
  const [activeTab, setActiveTab] = useState('calculator');
  
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50/30 via-white to-teal-50/30 dark:from-blue-950/10 dark:via-background dark:to-teal-950/10" dir="rtl">
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-30">
        <ChristianPattern />
      </div>
      
      <div className="sticky top-0 z-10 bg-gradient-to-r from-blue-50/95 via-white/95 to-teal-50/95 dark:from-blue-950/95 dark:via-background/95 dark:to-teal-950/95 backdrop-blur border-b border-teal-200 dark:border-teal-800/50">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary via-teal-500 to-purple-500 flex items-center justify-center shadow-lg">
                <Cross className="w-7 h-7 text-white"/>
              </div>
              <Dove className="absolute -top-1 -left-1 w-5 h-5 text-teal-500"/>
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">حاسبة العُشر</h1>
              <p className="text-sm text-muted-foreground">حساب العُشر حسب التعليم المسيحي</p>
            </div>
          </div>
        </div>
      </div>
      
      <main className="relative flex-1 max-w-6xl mx-auto w-full p-4 md:p-6 space-y-6">
        <BiblicalBasis />
        <TitheInfo />
        <AutoTithesCard />
        
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 h-12">
            <TabsTrigger value="calculator" className="text-base">
              <Calculator className="w-5 h-5 ml-2"/>
              حاسبة العُشر
            </TabsTrigger>
            <TabsTrigger value="guide" className="text-base">
              <BookOpen className="w-5 h-5 ml-2"/>
              دليل العطاء
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="calculator" className="mt-6">
            <TitheCalculator />
          </TabsContent>
          
          <TabsContent value="guide" className="mt-6">
            <GivingGuide />
          </TabsContent>
        </Tabs>
        
        <Card className="relative overflow-hidden border-teal-300/50 bg-gradient-to-r from-blue-50 to-teal-50 dark:from-blue-950/30 dark:to-teal-950/30">
          <ChristianPattern />
          <CardContent className="relative z-10 p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-teal-500/20 flex items-center justify-center">
                <Info className="w-6 h-6 text-teal-600"/>
              </div>
              <div>
                <p className="font-bold text-teal-700 dark:text-teal-400 text-lg mb-2">ملاحظة</p>
                <p className="text-teal-800 dark:text-teal-200 leading-relaxed">
                  هذه الحاسبة أداة مساعدة. العطاء بقلب فرح وإيمان أهم من النسبة المحددة.
                  "اَللَّهَ يُحِبُّ الْمُعْطِيَ الْمَسْرُورَ" (2 كورنثوس 9: 7)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
