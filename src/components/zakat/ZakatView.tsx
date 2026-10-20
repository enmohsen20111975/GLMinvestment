'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
 Calculator,
 BookOpen,
 Coins,
 CircleDollarSign,
 TrendingUp,
 Package,
 HandCoins,
 Scale,
 Info,
 AlertTriangle,
 CheckCircle2,
 ChevronDown,
 ChevronUp,
 Sparkles,
 BarChart3,
 RefreshCw,
 Heart,
 Star,
 Moon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Islamic Pattern SVG Components */
/* ------------------------------------------------------------------ */

function IslamicPattern() {
 return (
 <svg className="absolute inset-0 w-full h-full opacity-5" xmlns="http://www.w3.org/2000/svg">
 <defs>
 <pattern id="islamicPattern" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
 <path d="M30 0 L60 30 L30 60 L0 30 Z" fill="none" stroke="currentColor" strokeWidth="0.5"/>
 <circle cx="30" cy="30" r="10" fill="none" stroke="currentColor" strokeWidth="0.5"/>
 <path d="M30 20 L30 40 M20 30 L40 30" stroke="currentColor" strokeWidth="0.3"/>
 </pattern>
 </defs>
 <rect width="100%" height="100%" fill="url(#islamicPattern)"/>
 </svg>
 );
}

function IslamicBorder() {
 return (
 <svg className="w-full h-4" viewBox="0 0 400 16" preserveAspectRatio="none">
 <defs>
 <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="0%">
 <stop offset="0%" stopColor="#d4af37" stopOpacity="0.3"/>
 <stop offset="50%" stopColor="#d4af37" stopOpacity="1"/>
 <stop offset="100%" stopColor="#d4af37" stopOpacity="0.3"/>
 </linearGradient>
 </defs>
 <path d="M0 8 Q50 0 100 8 T200 8 T300 8 T400 8" fill="none" stroke="url(#borderGrad)" strokeWidth="1"/>
 <circle cx="0" cy="8" r="2" fill="#d4af37"/>
 <circle cx="100" cy="8" r="2" fill="#d4af37"/>
 <circle cx="200" cy="8" r="2" fill="#d4af37"/>
 <circle cx="300" cy="8" r="2" fill="#d4af37"/>
 <circle cx="400" cy="8" r="2" fill="#d4af37"/>
 </svg>
 );
}

function OrnamentDivider() {
 return (
 <div className="flex items-center justify-center gap-2 py-2">
 <div className="flex-1 h-px from-transparent to-transparent"/>
 <Star className="w-4 h-4 text-warning/50"/>
 <div className="flex-1 h-px from-transparent to-transparent"/>
 </div>
 );
}

function CrescentMoon({ className }: { className?: string }) {
 return (
 <svg className={className} viewBox="0 0 24 24" fill="currentColor">
 <path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>
 </svg>
 );
}

function MosqueSilhouette({ className }: { className?: string }) {
 return (
 <svg className={className} viewBox="0 0 100 40" fill="currentColor">
 <path d="M0 40 L0 30 L5 30 L5 25 Q10 15 15 25 L15 30 L20 30 L20 20 Q25 5 30 20 L30 30 L35 30 L35 25 Q40 10 45 25 L45 30 L50 30 L50 15 Q55 -5 60 15 L60 30 L65 30 L65 25 Q70 10 75 25 L75 30 L80 30 L80 20 Q85 5 90 20 L90 30 L95 30 L95 30 L100 30 L100 40 Z"/>
 <rect x="47" y="32" width="6" height="8" fill="currentColor"/>
 <circle cx="50" cy="12" r="3"/>
 </svg>
 );
}

/* ------------------------------------------------------------------ */
/* Constants - Islamic Nisab Values */
/* ------------------------------------------------------------------ */

const NISAB = {
 gold: {
 grams: 85,
 description: '85 جرام ذهب عيار 24',
 dalil: 'عن علي رضي الله عنه: "ليس فيما دون خمس أواق صدقة" (متفق عليه)'
 },
 silver: {
 grams: 595,
 description: '595 جرام فضة',
 dalil: 'عن النبي صلى الله عليه وسلم: "ليس فيما دون خمس أواق من الورق صدقة" (متفق عليه)'
 },
 rate: 0.025,
 rateDescription: '2.5% (ربع العشر)',
};

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

interface ZakatInput {
 gold24Grams: number;
 gold21Grams: number;
 gold18Grams: number;
 goldValue: number;
 silverGrams: number;
 silverValue: number;
 cash: number;
 bankBalance: number;
 foreignCurrency: number;
 stocksForTrade: number;
 stocksForInvestment: number;
 tradeGoods: number;
 receivables: number;
 debtsOwed: number;
 agriculturalProduce: number;
 irrigationType: 'rain' | 'artificial' | 'mixed';
}

interface ZakatResult {
 category: string;
 categoryAr: string;
 amount: number;
 nisabMet: boolean;
 nisabValue: number;
 details: string;
}

/* ------------------------------------------------------------------ */
/* Helper Functions */
/* ------------------------------------------------------------------ */

function formatNumber(num: number | null | undefined): string {
 if (num == null || !Number.isFinite(num)) return '0';
 if (num >= 1e9) return (num / 1e9).toFixed(2) + ' مليار';
 if (num >= 1e6) return (num / 1e6).toFixed(2) + ' مليون';
 if (num >= 1e3) return (num / 1e3).toFixed(2) + ' ألف';
 return (num ?? 0).toFixed(2);
}

function formatCurrency(num: number | null | undefined): string {
 return formatNumber(num) + ' ج.م';
}

/* ------------------------------------------------------------------ */
/* Islamic Legal Basis Component - Enhanced */
/* ------------------------------------------------------------------ */

function IslamicBasis() {
 return (
 <Card className="relative overflow-hidden border-warning/20 from-warning via-white to-warning dark:dark:via-background dark:">
 <IslamicPattern />
 <div className="relative z-10">
 <CardHeader className="text-center pb-2">
 <div className="flex justify-center mb-2">
 <CrescentMoon className="w-8 h-8 text-warning"/>
 </div>
 <CardTitle className="flex items-center justify-center gap-2 text-xl font-bold text-warning ">
 <BookOpen className="w-6 h-6" />
 السند الشرعي للزكاة
 </CardTitle>
 <OrnamentDivider />
 </CardHeader>
 <CardContent className="space-y-4 text-sm">
 <div className="space-y-3">
 <div className="p-4 from-success to-profit dark:/30 rounded-xl border border-success dark:border-success/20 shadow-sm">
 <div className="flex items-center gap-2 mb-2">
 <div className="w-8 h-8 rounded-full bg-success text-white flex items-center justify-center text-xs font-bold">ق</div>
 <span className="font-bold text-success ">من القرآن الكريم</span>
 </div>
 <p className="text-lg leading-relaxed text-success font-arabic">
 ﴿وَأَقِيمُوا الصَّلَاةَ وَآتُوا الزَّكَاةَ وَارْكَعُوا مَعَ الرَّاكِعِينَ﴾
 </p>
 <p className="text-xs text-muted-foreground mt-2 text-left">سورة البقرة: 43</p>
 </div>
 
 <div className="p-4 from-primary to-whale dark:dark:rounded-xl border border-whale/20 shadow-sm">
 <div className="flex items-center gap-2 mb-2">
 <div className="w-8 h-8 rounded-full bg-whale text-white flex items-center justify-center text-xs font-bold">س</div>
 <span className="font-bold text-whale ">من السنة النبوية</span>
 </div>
 <p className="text-base leading-relaxed text-whale ">
 "بُنِيَ الإِسْلَامُ عَلَى خَمْسٍ: شَهَادَةِ أَنْ لَا إِلَهَ إِلَّا اللَّهُ وَأَنَّ مُحَمَّدًا رَسُولُ اللَّهِ، وَإِقَامِ الصَّلَاةِ، وَإِيتَاءِ الزَّكَاةِ، وَالْحَجِّ، وَصَوْمِ رَمَضَانَ"
 </p>
 <p className="text-xs text-muted-foreground mt-2 text-left">متفق عليه</p>
 </div>
 
 <div className="p-4 from-warning to-yellow-50 dark:dark:to-yellow-950/30 rounded-xl border border-warning/20 shadow-sm">
 <div className="flex items-center gap-2 mb-2">
 <div className="w-8 h-8 rounded-full bg-warning text-white flex items-center justify-center text-xs font-bold">٢.٥</div>
 <span className="font-bold text-warning ">مقدار الزكاة</span>
 </div>
 <p className="text-base leading-relaxed text-warning ">
 "وَفِي الرِّقَابِ رُبْعُ الْعُشْرِ" <span className="text-warning">(2.5%)</span>
 </p>
 <p className="text-xs text-muted-foreground mt-2">في الذهب والفضة والنقود وعروض التجارة - رواه البخاري</p>
 </div>
 </div>
 </CardContent>
 </div>
 </Card>
 );
}

/* ------------------------------------------------------------------ */
/* Nisab Info Component - Enhanced */
/* ------------------------------------------------------------------ */

function NisabInfo({ goldPrice, silverPrice }: { goldPrice: number; silverPrice: number }) {
 const goldNisabValue = goldPrice * NISAB.gold.grams;
 const silverNisabValue = silverPrice * NISAB.silver.grams;
 
 return (
 <Card className="relative overflow-hidden border-warning/20 via-white to-yellow-50/50 dark:dark:via-background dark:to-yellow-950/20">
 <IslamicPattern />
 <div className="relative z-10">
 <CardHeader className="text-center">
 <CardTitle className="flex items-center justify-center gap-2 text-xl">
 <Scale className="w-6 h-6 text-warning"/>
 النصاب الشرعي
 </CardTitle>
 <CardDescription className="text-base">الحد الأدنى الذي تجب معه الزكاة</CardDescription>
 <OrnamentDivider />
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 {/* Gold Nisab */}
 <div className="relative group">
 <div className="absolute inset-0 from-yellow-400 to-warning rounded-2xl opacity-10 group-hover:opacity-15 transition-opacity"/>
 <div className="relative p-6 from-yellow-50 to-warning dark:from-yellow-950/40 dark:rounded-2xl border-2 border-yellow-300 dark:border-yellow-700/50 shadow-lg">
 <div className="flex items-center justify-center mb-4">
 <div className="w-16 h-16 rounded-full from-yellow-400 to-warning flex items-center justify-center shadow-lg">
 <Sparkles className="w-8 h-8 text-foreground"/>
 </div>
 </div>
 <h3 className="text-center text-lg font-bold text-warning mb-2">نصاب الذهب</h3>
 <p className="text-center text-4xl font-bold text-warning mb-2">
 {NISAB.gold.grams} <span className="text-lg">جرام</span>
 </p>
 <div className="text-center p-2 bg-warning/10 /30 rounded-lg mb-3">
 <span className="text-sm text-warning ">القيمة الحالية:</span>
 <span className="block text-lg font-bold text-warning">{formatCurrency(goldNisabValue)}</span>
 </div>
 <p className="text-xs text-center text-muted-foreground">
 عيار 24 (عيار 21 ≈ 98.8 جرام)
 </p>
 </div>
 </div>
 
 {/* Silver Nisab */}
 <div className="relative group">
 <div className="absolute inset-0 from-gray-300 to-gray-500 rounded-2xl opacity-10 group-hover:opacity-15 transition-opacity"/>
 <div className="relative p-6 from-gray-50 to-slate-100 dark:from-gray-950/40 dark:to-slate-950/40 rounded-2xl border-2 border-border /50 shadow-lg">
 <div className="flex items-center justify-center mb-4">
 <div className="w-16 h-16 rounded-full from-gray-300 to-gray-500 flex items-center justify-center shadow-lg">
 <Coins className="w-8 h-8 text-foreground"/>
 </div>
 </div>
 <h3 className="text-center text-lg font-bold text-muted-foreground mb-2">نصاب الفضة</h3>
 <p className="text-center text-4xl font-bold text-muted-foreground mb-2">
 {NISAB.silver.grams} <span className="text-lg">جرام</span>
 </p>
 <div className="text-center p-2 bg-muted/50 /30 rounded-lg mb-3">
 <span className="text-sm text-muted-foreground ">القيمة الحالية:</span>
 <span className="block text-lg font-bold text-muted-foreground">{formatCurrency(silverNisabValue)}</span>
 </div>
 <p className="text-xs text-center text-muted-foreground">
 يُستخدم للنقود (أرفق بالفقراء)
 </p>
 </div>
 </div>
 </div>
 
 <Alert className="mt-6 border-warning from-warning to-yellow-50 dark:dark:to-yellow-950/30">
 <Moon className="w-5 h-5 text-warning"/>
 <AlertTitle className="text-warning font-bold">ملاحظة فقهية</AlertTitle>
 <AlertDescription className="text-sm text-warning ">
 يُرجح كثير من العلماء استخدام نصاب الفضة للنقود لأنه أرفق بالفقراء وأكثر إحقاقاً لمصلحة الزكاة.
 </AlertDescription>
 </Alert>
 </CardContent>
 </div>
 </Card>
 );
}

/* ------------------------------------------------------------------ */
/* Zakat Calculator Component - Enhanced */
/* ------------------------------------------------------------------ */

interface ZakatCalculatorProps {
 goldPrice: number;
 silverPrice: number;
 gold21Price: number;
 gold18Price: number;
}

function ZakatCalculator({ goldPrice, silverPrice, gold21Price, gold18Price }: ZakatCalculatorProps) {
 const [inputs, setInputs] = useState<ZakatInput>({
 gold24Grams: 0, gold21Grams: 0, gold18Grams: 0, goldValue: 0,
 silverGrams: 0, silverValue: 0, cash: 0, bankBalance: 0, foreignCurrency: 0,
 stocksForTrade: 0, stocksForInvestment: 0, tradeGoods: 0, receivables: 0, debtsOwed: 0,
 agriculturalProduce: 0, irrigationType: 'rain',
 });

 // معيار النصاب: الذهب (85جرام) أو الفضة (595جرام) — اختيار فقهي يحدد نصاب النقود وعروض التجارة
 const [nisabMetal, setNisabMetal] = useState<'gold' | 'silver'>('gold');
 // سعر جرام الفضة بالجنيه — يُستخدم عند اختيار نصاب الفضة، يمكن للمستخدم تعديله يدوياً
 const [silverPricePerGram, setSilverPricePerGram] = useState<number>(38);

 // قراءة معيار النصاب المحفوظ عند التحميل (client-side فقط لتجنب SSR mismatch)
 useEffect(() => {
 try {
 const saved = localStorage.getItem('zakat_nisab_metal');
 if (saved === 'gold' || saved === 'silver') setNisabMetal(saved);
 } catch {
 // localStorage غير متاح — نُبقي القيمة الافتراضية
 }
 }, []);

 // حفظ معيار النصاب عند كل تغيير
 useEffect(() => {
 try {
 localStorage.setItem('zakat_nisab_metal', nisabMetal);
 } catch {
 // تجاهل أخطاء الكتابة
 }
 }, [nisabMetal]);

 // مزامنة سعر الفضة من الـ prop (القادم من /api/gold-silver) مع state المحلي
 useEffect(() => {
 if (silverPrice && silverPrice > 0) setSilverPricePerGram(silverPrice);
 }, [silverPrice]);

 const goldNisabValue = goldPrice * NISAB.gold.grams;
 const silverNisabValue = silverPricePerGram * NISAB.silver.grams;
 // قيمة النصاب الفعّالة بناءً على اختيار المستخدم — تُطبَّق على النقود وعروض التجارة والأسهم
 const nisabValue = nisabMetal === 'gold' ? goldNisabValue : silverNisabValue;

 const updateInput = (key: keyof ZakatInput, value: number | string) => {
 setInputs(prev => ({ ...prev, [key]: value }));
 };
 
 const results = useMemo(() => {
 const res: ZakatResult[] = [];
 
 const goldValue = (inputs.gold24Grams * goldPrice) + (inputs.gold21Grams * gold21Price) + (inputs.gold18Grams * gold18Price) + inputs.goldValue;
 if (goldValue > 0) {
 const nisabMet = goldValue >= goldNisabValue;
 res.push({ category: 'gold', categoryAr: 'الذهب', amount: nisabMet ? goldValue * NISAB.rate : 0, nisabMet, nisabValue: goldNisabValue, details: `إجمالي قيمة الذهب: ${formatCurrency(goldValue)}` });
 }
 
 const totalSilverValue = (inputs.silverGrams * silverPricePerGram) + inputs.silverValue;
 if (totalSilverValue > 0) {
 const nisabMet = totalSilverValue >= silverNisabValue;
 res.push({ category: 'silver', categoryAr: 'الفضة', amount: nisabMet ? totalSilverValue * NISAB.rate : 0, nisabMet, nisabValue: silverNisabValue, details: `إجمالي قيمة الفضة: ${formatCurrency(totalSilverValue)}` });
 }
 
 const totalCash = inputs.cash + inputs.bankBalance + inputs.foreignCurrency;
 if (totalCash > 0) {
 const nisabMet = totalCash >= nisabValue;
 res.push({ category: 'cash', categoryAr: 'النقود والودائع البنكية', amount: nisabMet ? totalCash * NISAB.rate : 0, nisabMet, nisabValue: nisabValue, details: `إجمالي النقود: ${formatCurrency(totalCash)}` });
 }
 
 if (inputs.stocksForTrade > 0) {
 const totalAssets = inputs.stocksForTrade + inputs.tradeGoods + inputs.receivables - inputs.debtsOwed;
 const netAssets = Math.max(0, totalAssets);
 const nisabMet = netAssets >= nisabValue;
 res.push({ category: 'trade', categoryAr: 'عروض التجارة والأسهم', amount: nisabMet ? netAssets * NISAB.rate : 0, nisabMet, nisabValue: nisabValue, details: `صافي أصول التجارة: ${formatCurrency(netAssets)}` });
 }
 
 if (inputs.stocksForInvestment > 0) {
 const nisabMet = inputs.stocksForInvestment >= nisabValue;
 res.push({ category: 'investment', categoryAr: 'الأسهم الاستثمارية', amount: nisabMet ? inputs.stocksForInvestment * NISAB.rate : 0, nisabMet, nisabValue: nisabValue, details: `قيمة الأسهم: ${formatCurrency(inputs.stocksForInvestment)}` });
 }
 
 return res;
 }, [inputs, goldPrice, silverPricePerGram, gold21Price, gold18Price, goldNisabValue, silverNisabValue, nisabValue]);
 
 const totalZakat = results.reduce((sum, r) => sum + r.amount, 0);
 
 return (
 <div className="space-y-6">
 {/* Nisab Standard Selector — اختيار المعدن الذي يُحسب على أساسه نصاب النقود وعروض التجارة */}
 <Card className="relative overflow-hidden border-2 border-warning/20 to-yellow-50/50 dark:dark:to-yellow-950/20">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-3 text-lg">
 <div className="w-10 h-10 rounded-xl from-warning to-yellow-500 flex items-center justify-center">
 <Scale className="w-5 h-5 text-foreground"/>
 </div>
 <div>
 <span className="text-warning ">معيار النصاب</span>
 <p className="text-xs text-muted-foreground font-normal">اختر المعدن الذي يُحسب على أساسه نصاب النقود وعروض التجارة</p>
 </div>
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <ToggleGroup
 type="single"
 value={nisabMetal}
 onValueChange={(v) => { if (v === 'gold' || v === 'silver') setNisabMetal(v); }}
 variant="outline"
 className="w-full"
 aria-label="معيار النصاب"
 >
 <ToggleGroupItem value="gold" aria-label="نصاب الذهب">
 <Sparkles className="w-4 h-4 ml-1.5 text-warning"/>
 <span className="text-sm font-medium">نصاب الذهب (85 جرام عيار 24)</span>
 </ToggleGroupItem>
 <ToggleGroupItem value="silver" aria-label="نصاب الفضة">
 <Coins className="w-4 h-4 ml-1.5 text-muted-foreground"/>
 <span className="text-sm font-medium">نصاب الفضة (595 جرام)</span>
 </ToggleGroupItem>
 </ToggleGroup>

 <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-warning/70 /30 border border-warning/20">
 <div className="flex items-center gap-2">
 <Scale className="w-5 h-5 text-warning shrink-0"/>
 <div>
 <p className="text-xs text-muted-foreground">قيمة النصاب الحالية</p>
 <p className="font-bold text-warning ">
 {formatCurrency(nisabValue)}
 <span className="text-xs font-normal text-muted-foreground mr-2">
 (بناءً على {nisabMetal === 'gold' ? 'الذهب 85 جرام' : 'الفضة 595 جرام'})
 </span>
 </p>
 </div>
 </div>
 {nisabMetal === 'silver' && (
 <div className="flex items-center gap-2">
 <label htmlFor="silver-price-input" className="text-xs text-muted-foreground whitespace-nowrap">سعر جرام الفضة (ج.م)</label>
 <Input
 id="silver-price-input"
 type="number"
 min={0}
 step={0.1}
 value={silverPricePerGram || ''}
 onChange={(e) => setSilverPricePerGram(parseFloat(e.target.value) || 0)}
 className="w-24 h-8 text-sm"
 />
 </div>
 )}
 </div>

 <Alert className="border-warning bg-warning/10 /30">
 <Info className="w-4 h-4 text-warning shrink-0"/>
 <AlertDescription className="text-xs text-warning ">
 نصاب الفضة أقل من الذهب، فيجب إخراج الزكاة لعدد أكبر من الناس. راجع مذهبك الفقهي.
 </AlertDescription>
 </Alert>
 </CardContent>
 </Card>

 {/* Input Section */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Gold Section */}
 <Card className="relative overflow-hidden border-2 border-yellow-300 dark:border-yellow-700/50 from-yellow-50/50 dark:from-yellow-950/20 dark:">
 <div className="absolute top-0 right-0 w-20 h-20 bg-warning/10 rounded-full -translate-y-1/2 translate-x-1/2"/>
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-3 text-lg">
 <div className="w-10 h-10 rounded-xl from-yellow-400 to-warning flex items-center justify-center">
 <Sparkles className="w-5 h-5 text-foreground"/>
 </div>
 <div>
 <span className="text-warning ">الزكاة على الذهب</span>
 <p className="text-xs text-muted-foreground font-normal">عيار24 = {formatCurrency(goldPrice)} | عيار21 = {formatCurrency(gold21Price)}</p>
 </div>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1">
 <label className="text-xs font-medium text-warning ">ذهب عيار 24 (جرام)</label>
 <Input type="number" placeholder="0" value={inputs.gold24Grams || ''} onChange={(e) => updateInput('gold24Grams', parseFloat(e.target.value) || 0)} className="border-yellow-200 focus:border-yellow-400"/>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-warning ">ذهب عيار 21 (جرام)</label>
 <Input type="number" placeholder="0" value={inputs.gold21Grams || ''} onChange={(e) => updateInput('gold21Grams', parseFloat(e.target.value) || 0)} className="border-yellow-200 focus:border-yellow-400"/>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-warning ">ذهب عيار 18 (جرام)</label>
 <Input type="number" placeholder="0" value={inputs.gold18Grams || ''} onChange={(e) => updateInput('gold18Grams', parseFloat(e.target.value) || 0)} className="border-yellow-200 focus:border-yellow-400"/>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-warning ">قيمة أخرى (ج.م)</label>
 <Input type="number" placeholder="0" value={inputs.goldValue || ''} onChange={(e) => updateInput('goldValue', parseFloat(e.target.value) || 0)} className="border-yellow-200 focus:border-yellow-400"/>
 </div>
 </div>
 </CardContent>
 </Card>
 
 {/* Silver Section */}
 <Card className="relative overflow-hidden border-2 border-border /50 from-gray-50/50 to-slate-50/50 dark:from-gray-950/20 dark:to-slate-950/20">
 <div className="absolute top-0 right-0 w-20 h-20 bg-muted/10 rounded-full -translate-y-1/2 translate-x-1/2"/>
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-3 text-lg">
 <div className="w-10 h-10 rounded-xl from-gray-300 to-gray-500 flex items-center justify-center">
 <Coins className="w-5 h-5 text-foreground"/>
 </div>
 <div>
 <span className="text-muted-foreground ">الزكاة على الفضة</span>
 <p className="text-xs text-muted-foreground font-normal">سعر الجرام: {formatCurrency(silverPricePerGram)}</p>
 </div>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1">
 <label className="text-xs font-medium text-muted-foreground ">فضة (جرام)</label>
 <Input type="number" placeholder="0" value={inputs.silverGrams || ''} onChange={(e) => updateInput('silverGrams', parseFloat(e.target.value) || 0)} className="border-border focus:border-border"/>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-muted-foreground ">قيمة فضة (ج.م)</label>
 <Input type="number" placeholder="0" value={inputs.silverValue || ''} onChange={(e) => updateInput('silverValue', parseFloat(e.target.value) || 0)} className="border-border focus:border-border"/>
 </div>
 </div>
 </CardContent>
 </Card>
 
 {/* Cash Section */}
 <Card className="relative overflow-hidden border-2 border-success dark:border-success/20 dark:/20">
 <div className="absolute top-0 right-0 w-20 h-20 bg-success/10 rounded-full -translate-y-1/2 translate-x-1/2"/>
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-3 text-lg">
 <div className="w-10 h-10 rounded-xl from-success to-profit flex items-center justify-center">
 <CircleDollarSign className="w-5 h-5 text-foreground"/>
 </div>
 <div>
 <span className="text-success ">الزكاة على النقود</span>
 <p className="text-xs text-muted-foreground font-normal">يُستخدم نصاب {nisabMetal === 'gold' ? 'الذهب' : 'الفضة'}</p>
 </div>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1">
 <label className="text-xs font-medium text-success ">نقد باليد (ج.م)</label>
 <Input type="number" placeholder="0" value={inputs.cash || ''} onChange={(e) => updateInput('cash', parseFloat(e.target.value) || 0)} className="border-success focus:border-success"/>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-success ">رصيد البنك (ج.م)</label>
 <Input type="number" placeholder="0" value={inputs.bankBalance || ''} onChange={(e) => updateInput('bankBalance', parseFloat(e.target.value) || 0)} className="border-success focus:border-success"/>
 </div>
 <div className="col-span-2 space-y-1">
 <label className="text-xs font-medium text-success ">عملات أجنبية (محولة للج.م)</label>
 <Input type="number" placeholder="0" value={inputs.foreignCurrency || ''} onChange={(e) => updateInput('foreignCurrency', parseFloat(e.target.value) || 0)} className="border-success focus:border-success"/>
 </div>
 </div>
 </CardContent>
 </Card>
 
 {/* Stocks & Trade Section */}
 <Card className="relative overflow-hidden border-2 border-whale/20 dark:dark:">
 <div className="absolute top-0 right-0 w-20 h-20 bg-whale/10 rounded-full -translate-y-1/2 translate-x-1/2"/>
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-3 text-lg">
 <div className="w-10 h-10 rounded-xl from-primary to-whale flex items-center justify-center">
 <TrendingUp className="w-5 h-5 text-foreground"/>
 </div>
 <div>
 <span className="text-whale ">الأسهم والتجارة</span>
 <p className="text-xs text-muted-foreground font-normal">يختلف الحكم حسب النية</p>
 </div>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1">
 <label className="text-xs font-medium text-whale ">أسهم للتجارة</label>
 <Input type="number" placeholder="0" value={inputs.stocksForTrade || ''} onChange={(e) => updateInput('stocksForTrade', parseFloat(e.target.value) || 0)} className="border-whale focus:border-whale"/>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-whale ">أسهم استثمارية</label>
 <Input type="number" placeholder="0" value={inputs.stocksForInvestment || ''} onChange={(e) => updateInput('stocksForInvestment', parseFloat(e.target.value) || 0)} className="border-whale focus:border-whale"/>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-whale ">بضاعة تجارية</label>
 <Input type="number" placeholder="0" value={inputs.tradeGoods || ''} onChange={(e) => updateInput('tradeGoods', parseFloat(e.target.value) || 0)} className="border-whale focus:border-whale"/>
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-whale ">ديون لك</label>
 <Input type="number" placeholder="0" value={inputs.receivables || ''} onChange={(e) => updateInput('receivables', parseFloat(e.target.value) || 0)} className="border-whale focus:border-whale"/>
 </div>
 <div className="col-span-2 space-y-1">
 <label className="text-xs font-medium text-loss ">ديون عليك (تُطرح)</label>
 <Input type="number" placeholder="0" value={inputs.debtsOwed || ''} onChange={(e) => updateInput('debtsOwed', parseFloat(e.target.value) || 0)} className="border-loss focus:border-loss"/>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 
 {/* Results Section */}
 {results.length > 0 && (
 <Card className="relative overflow-hidden border-2 border-profit/20 /20 dark:">
 <IslamicPattern />
 <div className="relative z-10">
 <CardHeader className="text-center">
 <CardTitle className="flex items-center justify-center gap-2 text-xl">
 <Calculator className="w-6 h-6 text-profit"/>
 نتيجة حساب الزكاة
 </CardTitle>
 <OrnamentDivider />
 </CardHeader>
 <CardContent>
 <div className="space-y-3">
 {results.map((result, index) => (
 <div key={index} className={cn(
 'p-4 rounded-xl border-2 transition-all duration-300',
 result.nisabMet
 ? 'from-profit to-success /30 dark:border-profit '
 : 'from-warning to-yellow-50 dark:dark:to-yellow-900/30 border-warning '
 )}>
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className={cn(
 'w-10 h-10 rounded-full flex items-center justify-center',
 result.nisabMet ? 'bg-profit' : 'bg-warning'
 )}>
 {result.nisabMet ? (
 <CheckCircle2 className="w-5 h-5 text-foreground"/>
 ) : (
 <AlertTriangle className="w-5 h-5 text-foreground"/>
 )}
 </div>
 <div>
 <p className="font-bold text-lg">{result.categoryAr}</p>
 <p className="text-sm text-muted-foreground">{result.details}</p>
 </div>
 </div>
 <div className="text-left">
 <p className={cn(
 'text-2xl font-bold',
 result.nisabMet ? 'text-profit ' : 'text-warning '
 )}>
 {formatCurrency(result.amount)}
 </p>
 <Badge className={cn(
 'text-xs',
 result.nisabMet ? 'bg-profit text-profit/50 ' : 'bg-warning text-warning/50 '
 )}>
 {result.nisabMet ? '✓ تجب الزكاة' : '✗ لم يبلغ النصاب'}
 </Badge>
 </div>
 </div>
 </div>
 ))}
 </div>
 
 <Separator className="my-6"/>
 
 {/* Total Zakat */}
 <div className="relative p-8 from-profit via-success to-whale rounded-2xl shadow-xl overflow-hidden">
 <div className="absolute inset-0 opacity-20">
 <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
 <pattern id="stars" width="10" height="10" patternUnits="userSpaceOnUse">
 <circle cx="5" cy="5" r="1" fill="white"/>
 </pattern>
 <rect width="100%" height="100%" fill="url(#stars)"/>
 </svg>
 </div>
 <div className="relative text-center text-foreground">
 <p className="text-sm opacity-90 mb-1">إجمالي الزكاة الواجبة</p>
 <p className="text-4xl font-bold mb-2">{formatCurrency(totalZakat)}</p>
 <div className="flex items-center justify-center gap-2 text-sm opacity-80">
 <Heart className="w-4 h-4"/>
 <span>نسبة الزكاة: 2.5% (ربع العشر)</span>
 </div>
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
 <p className="text-lg text-muted-foreground">أدخل قيم أموالك لحساب الزكاة الواجبة</p>
 <p className="text-sm text-muted-foreground mt-2">سيتم حساب الزكاة تلقائياً</p>
 </CardContent>
 </Card>
 )}
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Calculation Methods Component - Enhanced */
/* ------------------------------------------------------------------ */

function CalculationMethods() {
 const methods = [
 { title: 'زكاة الذهب والفضة', icon: Sparkles, color: 'yellow', rules: [
 { text: 'النصاب: 85 جرام للذهب، 595 جرام للفضة', dalil: 'حديث علي رضي الله عنه' },
 { text: 'النسبة: 2.5% (ربع العشر)', dalil: '"وفي الرقة ربع العشر"' },
 { text: 'تُضم أنواع الذهب بعضها لبعض', dalil: 'إجماع العلماء' },
 ]},
 { title: 'زكاة النقود', icon: CircleDollarSign, color: 'green', rules: [
 { text: 'النصاب: قيمة 595 جرام فضة', dalil: 'قول ابن باز وابن عثيمين' },
 { text: 'النسبة: 2.5%', dalil: 'النقود في حكم الفضة' },
 { text: 'تضم النقود جميعاً', dalil: 'اتحاد الجنس يوجب الضم' },
 ]},
 { title: 'زكاة الأسهم', icon: TrendingUp, color: 'blue', rules: [
 { text: 'أسهم للتجارة: 2.5%', dalil: 'حكم عروض التجارة' },
 { text: 'أسهم للاستثمار: القيمة السوقية', dalil: 'قول الجمهور' },
 ]},
 { title: 'زكاة عروض التجارة', icon: Package, color: 'purple', rules: [
 { text: 'تُقوّم البضاعة بسعر السوق', dalil: '"قوّموا أموالكم"' },
 { text: 'تُطرح الديون الحالة', dalil: 'اتفاق الفقهاء' },
 ]},
 { title: 'زكاة الزروع والثمار', icon: HandCoins, color: 'emerald', rules: [
 { text: 'سقي بالمطر: 10%', dalil: '"وآتوا حقه يوم حصاده"' },
 { text: 'سقي صناعي: 5%', dalil: '"فيما سقت السماء العشر"' },
 { text: 'سقي مشترك: 7.5%', dalil: 'الجمع بين الحديثين' },
 ]},
 ];
 
 return (
 <div className="space-y-4">
 {methods.map((method, index) => {
 const Icon = method.icon;
 return (
 <Card key={index} className={cn(
 'relative overflow-hidden border-r-4',
 method.color === 'yellow' && 'border-r-yellow-500 from-yellow-50/50 to-transparent dark:from-yellow-950/20',
 method.color === 'green' && 'border-r-green-500 to-transparent dark:',
 method.color === 'blue' && 'border-r-blue-500 to-transparent dark:',
 method.color === 'purple' && 'border-r-purple-500 from-purple-50/50 to-transparent dark:from-purple-950/20',
 method.color === 'emerald' && 'border-r-emerald-500 to-transparent /20',
 )}>
 <CardHeader className="pb-2">
 <CardTitle className="flex items-center gap-3 text-lg">
 <div className={cn(
 'w-10 h-10 rounded-xl flex items-center justify-center',
 method.color === 'yellow' && 'bg-warning',
 method.color === 'green' && 'bg-success',
 method.color === 'blue' && 'bg-whale',
 method.color === 'purple' && 'bg-primary',
 method.color === 'emerald' && 'bg-profit',
 )}>
 <Icon className="w-5 h-5 text-foreground"/>
 </div>
 {method.title}
 </CardTitle>
 </CardHeader>
 <CardContent>
 <ul className="space-y-2">
 {method.rules.map((rule, i) => (
 <li key={i} className="flex items-start gap-2 text-sm">
 <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 flex-shrink-0"/>
 <div>
 <span className="text-foreground">{rule.text}</span>
 <span className="text-xs text-muted-foreground mr-1">({rule.dalil})</span>
 </div>
 </li>
 ))}
 </ul>
 </CardContent>
 </Card>
 );
 })}
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* P34 TASK 4: Auto Zakat Card — Automatic Zakat from Portfolio */
/* ------------------------------------------------------------------ */
// Fetches the user's portfolio from /api/finance/calculate-values and
// computes zakat-eligible wealth automatically:
// eligible = (cash + bank + stocks + gold + crypto) - active debts
// nisab = 85 g x live 24k gold price per gram
// if eligible >= nisab -> zakat = 2.5% x eligible
// The gold nisab is already linked to live gold prices (passed as prop).

interface AutoZakatBreakdown {
 cash: number;
 bank: number;
 stocks: number;
 gold: number;
 crypto: number;
 debts: number;
}

function AutoZakatCard({ goldPrice }: { goldPrice: number }) {
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [breakdown, setBreakdown] = useState<AutoZakatBreakdown | null>(null);
 const [eligible, setEligible] = useState(0);
 const [refreshing, setRefreshing] = useState(false);

 const load = async (silent = false) => {
 if (silent) setRefreshing(true); else setLoading(true);
 setError(null);
 try {
 const res = await fetch('/api/finance/calculate-values', { cache: 'no-store' });
 if (res.status === 401) {
 setError('يجب تسجيل الدخول لحساب الزكاة تلقائياً من محفظتك');
 setBreakdown(null);
 setEligible(0);
 return;
 }
 if (!res.ok) throw new Error('فشل تحميل بيانات المحفظة');
 const data = await res.json();
 if (!data.success) throw new Error(data.error || 'فشل تحميل بيانات المحفظة');

 const items: any[] = data.items || [];
 const debts = Number(data.total_obligations_egp || data.smart_math?.total_obligations_egp || 0);
 let cash = 0, bank = 0, stocks = 0, gold = 0, crypto = 0;
 for (const a of items) {
 const t = String(a.type || '').toLowerCase();
 const cv = Number(a.current_value || 0);
 if (t === 'currency' || t === 'forex') cash += cv;
 else if (['bank', 'certificate', 'fund', 'deposit', 'savings_account', 'bond'].includes(t)) bank += cv;
 else if (t === 'stock') stocks += cv;
 else if (t === 'gold' || t === 'silver') gold += cv;
 else if (t === 'crypto') crypto += cv;
 }
 const totalEligible = Math.max(0, cash + bank + stocks + gold + crypto - debts);
 setBreakdown({ cash, bank, stocks, gold, crypto, debts });
 setEligible(totalEligible);
 } catch (e) {
 setError(e instanceof Error ? e.message : 'حدث خطأ أثناء تحميل المحفظة');
 setBreakdown(null);
 setEligible(0);
 } finally {
 setLoading(false);
 setRefreshing(false);
 }
 };

 useEffect(() => { load(); }, []);

 const goldNisabValue = goldPrice * NISAB.gold.grams;
 const nisabMet = eligible >= goldNisabValue && eligible > 0;
 const zakatDue = nisabMet ? eligible * NISAB.rate : 0;
 const shortfall = goldNisabValue - eligible;

 return (
 <Card className="relative overflow-hidden border-2 border-profit/20 via-white /30 dark:via-background dark:shadow-lg">
 <IslamicPattern />
 <div className="relative z-10">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center justify-between gap-3 flex-wrap">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-xl from-profit to-success flex items-center justify-center shadow">
 <Sparkles className="w-5 h-5 text-foreground"/>
 </div>
 <div>
 <span className="text-profit text-lg">الزكاة التلقائية من محفظتك</span>
 <p className="text-xs text-muted-foreground font-normal">محسوبة من أصولك الفعلية — ناقص الديون النشطة</p>
 </div>
 </div>
 <Button
 variant="outline"
 size="sm"
 onClick={() => load(true)}
 disabled={refreshing}
 className="border-profit text-profit hover:bg-profit "
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
 <Alert className="border-warning bg-warning/10">
 <AlertTriangle className="w-4 h-4 text-warning"/>
 <AlertDescription className="text-sm text-warning ">{error}</AlertDescription>
 </Alert>
 )}

 {!loading && !error && breakdown && (
 <>
 {/* Breakdown */}
 <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
 <BreakdownRow icon={<CircleDollarSign className="w-4 h-4"/>} label="نقد وعملات" value={breakdown.cash} color="green"/>
 <BreakdownRow icon={<HandCoins className="w-4 h-4"/>} label="بنك وشهادات" value={breakdown.bank} color="emerald"/>
 <BreakdownRow icon={<TrendingUp className="w-4 h-4"/>} label="أسهم مضاربة" value={breakdown.stocks} color="blue"/>
 <BreakdownRow icon={<Sparkles className="w-4 h-4"/>} label="ذهب وفضة" value={breakdown.gold} color="yellow"/>
 <BreakdownRow icon={<Coins className="w-4 h-4"/>} label="كريبتو" value={breakdown.crypto} color="orange"/>
 <BreakdownRow icon={<AlertTriangle className="w-4 h-4"/>} label="ديون تُطرح" value={-breakdown.debts} color="red"/>
 </div>

 <Separator/>

 {/* Nisab comparison */}
 <div className="flex items-center justify-between flex-wrap gap-2 p-3 rounded-xl bg-profit/70 /30 border border-profit/20">
 <div className="flex items-center gap-2">
 <Scale className="w-5 h-5 text-profit"/>
 <div>
 <p className="text-xs text-muted-foreground">النصاب (85 جرام عيار 24)</p>
 <p className="font-bold text-profit ">{formatCurrency(goldNisabValue)}</p>
 </div>
 </div>
 <div className="text-left">
 <p className="text-xs text-muted-foreground">ثروتك الخاضعة للزكاة</p>
 <p className="font-bold text-profit ">{formatCurrency(eligible)}</p>
 </div>
 </div>

 {/* Result */}
 {nisabMet ? (
 <div className="relative p-6 from-profit via-success to-whale rounded-2xl shadow-xl overflow-hidden text-center">
 <div className="absolute inset-0 opacity-20">
 <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
 <pattern id="autoStars" width="10" height="10" patternUnits="userSpaceOnUse">
 <circle cx="5" cy="5" r="1" fill="white"/>
 </pattern>
 <rect width="100%" height="100%" fill="url(#autoStars)"/>
 </svg>
 </div>
 <div className="relative text-foreground">
 <CheckCircle2 className="w-10 h-10 mx-auto mb-2"/>
 <p className="text-sm opacity-90 mb-1">بلغت ثروتك النصاب — تجب عليك الزكاة</p>
 <p className="text-4xl font-bold mb-2">{formatCurrency(zakatDue)}</p>
 <p className="text-xs opacity-80">نسبة 2.5% (ربع العشر) من {formatCurrency(eligible)}</p>
 </div>
 </div>
 ) : eligible > 0 ? (
 <Alert className="border-warning bg-warning/10">
 <AlertTriangle className="w-5 h-5 text-warning"/>
 <AlertTitle className="text-warning font-bold">لم يبلغ النصاب بعد</AlertTitle>
 <AlertDescription className="text-sm text-warning ">
 ثروتك الخاضعة للزكاة {formatCurrency(eligible)} أقل من النصاب ({formatCurrency(goldNisabValue)}).
 ينقصك {formatCurrency(shortfall)} لبلوغ النصاب. لا تجب الزكاة الآن — استمر في الادخار.
 </AlertDescription>
 </Alert>
 ) : (
 <Alert className="border-whale bg-primary/10">
 <Info className="w-5 h-5 text-whale"/>
 <AlertDescription className="text-sm text-whale ">
 أضف أصولاً لمحفظتك (نقد، أسهم، ذهب، كريبتو) من قسم المحفظة ليتم حساب الزكاة تلقائياً.
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
 green: 'text-success ',
 emerald: 'text-profit ',
 blue: 'text-whale ',
 yellow: 'text-warning ',
 orange: 'text-warning ',
 red: 'text-loss ',
 };
 return (
 <div className="flex items-center justify-between p-2 rounded-lg bg-white/60 /40 border border-muted">
 <div className="flex items-center gap-1.5">
 <span className={colorMap[color] || colorMap.green}>{icon}</span>
 <span className="text-xs text-muted-foreground">{label}</span>
 </div>
 <span className={cn('text-xs font-bold', colorMap[color] || colorMap.green)}>{formatCurrency(Math.abs(value))}</span>
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Main Component */
/* ------------------------------------------------------------------ */

export function ZakatView() {
 const [goldPrice, setGoldPrice] = useState(0);
 const [gold21Price, setGold21Price] = useState(0);
 const [gold18Price, setGold18Price] = useState(0);
 const [silverPrice, setSilverPrice] = useState(0);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [activeTab, setActiveTab] = useState('calculator');
 
 useEffect(() => {
 const fetchPrices = async () => {
 setLoading(true);
 try {
 const response = await fetch('/api/gold-silver');
 const data = await response.json();
 const gold24 = data.data?.gold?.price || 3200;
 setGoldPrice(gold24);
 setGold21Price(gold24 * 0.875);
 setGold18Price(gold24 * 0.75);
 setSilverPrice(data.data?.silver?.price || 32);
 } catch (e) {
 setGoldPrice(3200);
 setGold21Price(2800);
 setGold18Price(2400);
 setSilverPrice(32);
 setError('لم نتمكن من تحميل أسعار الذهب والفضة الحالية');
 } finally {
 setLoading(false);
 }
 };
 fetchPrices();
 }, []);
 
 if (loading) {
 return (
 <div className="min-h-screen flex flex-col bg-background p-4" dir="rtl">
 <div className="space-y-4">
 <Skeleton className="h-12 w-64"/>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <Skeleton className="h-40"/>
 <Skeleton className="h-40"/>
 </div>
 <Skeleton className="h-96"/>
 </div>
 </div>
 );
 }
 
 return (
 <div className="min-h-screen flex flex-col via-white to-yellow-50/30 dark:dark:via-background dark:to-yellow-950/10" dir="rtl">
 {/* Decorative Background */}
 <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-30">
 <IslamicPattern />
 </div>
 
 {/* Header */}
 <div className="sticky top-0 z-10 to-yellow-50/95 dark:dark:dark:to-yellow-950/95 backdrop-blur border-b border-warning/20">
 <div className="max-w-6xl mx-auto px-4 py-4">
 <div className="flex items-center gap-4">
 <div className="relative">
 <div className="w-14 h-14 rounded-2xl from-warning via-yellow-500 to-warning flex items-center justify-center shadow-lg">
 <HandCoins className="w-7 h-7 text-foreground"/>
 </div>
 <CrescentMoon className="absolute -top-1 -left-1 w-5 h-5 text-warning"/>
 </div>
 <div>
 <h1 className="text-2xl font-bold from-warning to-yellow-600 bg-clip-text text-transparent">حاسبة الزكاة</h1>
 <p className="text-sm text-muted-foreground">حساب زكاة المال حسب الشريعة الإسلامية</p>
 </div>
 </div>
 </div>
 <IslamicBorder />
 </div>
 
 {/* Content */}
 <main className="relative flex-1 max-w-6xl mx-auto w-full p-4 md:p-6 space-y-6">
 {error && (
 <Alert className="border-warning bg-warning/10">
 <AlertTriangle className="w-4 h-4 text-warning"/>
 <AlertDescription className="text-sm text-warning ">{error}</AlertDescription>
 </Alert>
 )}
 
 <IslamicBasis />
 <NisabInfo goldPrice={goldPrice} silverPrice={silverPrice}/>
 <AutoZakatCard goldPrice={goldPrice}/>
 
 <Tabs value={activeTab} onValueChange={setActiveTab}>
 <TabsList className="grid w-full grid-cols-2 h-12">
 <TabsTrigger value="calculator" className="text-base">
 <Calculator className="w-5 h-5 ml-2"/>
 حاسبة الزكاة
 </TabsTrigger>
 <TabsTrigger value="methods" className="text-base">
 <BookOpen className="w-5 h-5 ml-2"/>
 طرق الحساب
 </TabsTrigger>
 </TabsList>
 
 <TabsContent value="calculator" className="mt-6">
 <ZakatCalculator goldPrice={goldPrice} silverPrice={silverPrice} gold21Price={gold21Price} gold18Price={gold18Price}/>
 </TabsContent>
 
 <TabsContent value="methods" className="mt-6">
 <CalculationMethods />
 </TabsContent>
 </Tabs>
 
 {/* Footer */}
 <Card className="relative overflow-hidden border-warning/20 from-warning to-yellow-50 dark:dark:to-yellow-950/30">
 <IslamicPattern />
 <CardContent className="relative z-10 p-6">
 <div className="flex items-start gap-4">
 <div className="w-12 h-12 rounded-xl bg-warning/20 flex items-center justify-center">
 <Info className="w-6 h-6 text-warning"/>
 </div>
 <div>
 <p className="font-bold text-warning text-lg mb-2">ملاحظة مهمة</p>
 <p className="text-warning leading-relaxed">
 هذه الحاسبة أداة مساعدة فقط. يُستحب استشارة أهل العلم في مسائل الزكاة المعقدة.
 تختلف بعض الأحكام بين المذاهب الفقهية، وقد تم اعتماد الراجح من أقوال أهل العلم.
 </p>
 </div>
 </div>
 </CardContent>
 </Card>
 
 {/* Mosque Silhouette */}
 <div className="flex justify-center opacity-10">
 <MosqueSilhouette className="w-64 h-16 text-warning"/>
 </div>
 </main>
 </div>
 );
}
