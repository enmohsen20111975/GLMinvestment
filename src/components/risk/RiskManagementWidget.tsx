'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Shield, Target, Clock, Calculator, PieChart, Zap,
  CheckCircle, Info, RefreshCw, AlertTriangle, Lock,
  TrendingUp, ShieldAlert, Scale
} from 'lucide-react';
import { toast } from 'sonner';
import { getRRVerdict } from '@/lib/utils';

// Python Backend URL (through gateway)
const PYTHON_BACKEND = '/api/risk';

interface TradingTime {
  market: string;
  is_open: boolean;
  current_time: string;
  day: string;
  status: string;
  action: string;
  day_score?: number;
  is_best_time?: boolean;
}

interface StopLossResult {
  stop_price: number;
  stop_percent: number;
  risk_percent: number;
  stock_type: string;
  reason: string;
  warning: string;
}

interface PositionResult {
  position_size: number;
  percentage_of_capital: number;
  action: string;
  reason: string;
  max_acceptable_loss: number;
}

interface TargetResult {
  targets: Array<{
    target_number: number;
    price: number;
    profit_percent: number;
    sell_percent: number;
  }>;
  summary: {
    best_case: string;
  };
}

export function RiskManagementWidget() {
  const [tradingTime, setTradingTime] = useState<TradingTime | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Position Sizing
  const [capital, setCapital] = useState(100000);
  const [confidenceScore, setConfidenceScore] = useState(5);
  const [positionResult, setPositionResult] = useState<PositionResult | null>(null);
  
  // Stop Loss
  const [entryPrice, setEntryPrice] = useState(10);
  const [stockSymbol, setStockSymbol] = useState('COMI');
  const [market, setMarket] = useState<'egx' | 'crypto'>('egx');
  const [stopLossResult, setStopLossResult] = useState<StopLossResult | null>(null);
  
  // Targets
  const [stopPrice, setStopPrice] = useState(9.3);
  const [targetResult, setTargetResult] = useState<TargetResult | null>(null);

  // ── حاسبة الصفقة الذكية (الأنظمة الخمسة) ──
  const [calcCapital, setCalcCapital] = useState(100000);
  const [calcEntry, setCalcEntry] = useState(25);
  const [calcStop, setCalcStop] = useState(23);
  const [calcTarget, setCalcTarget] = useState(30);
  const [calcRisk, setCalcRisk] = useState(2);          // نسبة المخاطرة %
  const [calcConfidence, setCalcConfidence] = useState(5);
  const [calcCurrent, setCalcCurrent] = useState(25);   // السعر الحالي (للمراقبة)
  const [origStop, setOrigStop] = useState(23);         // الوقف الأصلي (للتأكد إنه ما نزلش)
  const [hlConfirmed, setHlConfirmed] = useState(false); // Higher Low ×2
  const [rsiConfirmed, setRsiConfirmed] = useState(false); // تأكيد RSI
  const [rsiValue, setRsiValue] = useState<number | ''>('');

  useEffect(() => {
    fetchTradingTime();
    const interval = setInterval(fetchTradingTime, 60000);
    return () => clearInterval(interval);
  }, [market]);

  const fetchTradingTime = async () => {
    try {
      const response = await fetch(`/api/trading/time?market=${market}`);
      // Guard against HTML responses
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.error('Trading time API returned non-JSON response:', response.status);
        return;
      }
      const data = await response.json();
      if (data.success) {
        setTradingTime(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch trading time:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculatePosition = async () => {
    try {
      const response = await fetch(`/api/risk/position-size?XTransformPort=8010`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capital, confidence_score: confidenceScore })
      });
      const data = await response.json();
      if (data.success) {
        setPositionResult(data.data);
        toast.success('تم حساب حجم الصفقة');
      }
    } catch (error) {
      toast.error('فشل في الحساب');
    }
  };

  const calculateStopLoss = async () => {
    try {
      const response = await fetch(`/api/risk/stop-loss?XTransformPort=8010`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_price: entryPrice, symbol: stockSymbol, market })
      });
      const data = await response.json();
      if (data.success) {
        setStopLossResult(data.data);
        setStopPrice(data.data.stop_price);
        toast.success('تم حساب Stop Loss');
      }
    } catch (error) {
      toast.error('فشل في الحساب');
    }
  };

  const calculateTargets = async () => {
    try {
      const response = await fetch(`/api/risk/targets?XTransformPort=8010`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_price: entryPrice, stop_price: stopPrice })
      });
      const data = await response.json();
      if (data.success) {
        setTargetResult(data.data);
        toast.success('تم حساب الأهداف');
      }
    } catch (error) {
      toast.error('فشل في الحساب');
    }
  };

  const calculateFullPlan = async () => {
    await calculateStopLoss();
    await new Promise(r => setTimeout(r, 200));
    await calculateTargets();
    await new Promise(r => setTimeout(r, 200));
    await calculatePosition();
    toast.success('تم حساب خطة التداول الكاملة');
  };

  // ── حسابات حاسبة الصفقة الذكية (كله محلي - بدون اعتماد على الـ proxy) ──
  const riskPerShare = calcEntry - calcStop;
  const maxLossAllowed = calcCapital * (calcRisk / 100);
  const safeShares = riskPerShare > 0 ? Math.floor(maxLossAllowed / riskPerShare) : 0;
  const calcPositionValue = safeShares * calcEntry;
  const calcMaxLoss = safeShares * riskPerShare;
  const calcRR = riskPerShare > 0 && calcTarget > calcEntry
    ? (calcTarget - calcEntry) / riskPerShare : 0;
  const rrVerdict = getRRVerdict(calcRR);

  const priceOK = calcEntry > 0 && calcStop > 0 && calcTarget > calcEntry && calcStop < calcEntry;
  const calcVerdict =
    !priceOK ? '❌ تأكد إن: الوقف < الدخول < الهدف'
      : safeShares <= 0 ? '❌ الخسارة المحتملة تتجاوز حد المخاطرة'
        : calcRR < 1.5 ? '⚠️ صفقة ضعيفة - R:R أقل من 1.5'
          : calcRR >= 3 ? '✅ صفقة ممتازة' : '✅ صفقة مسموحة';

  // نظام لا تشتري نازل (Anti-Falling-Knife)
  const rsiNum = typeof rsiValue === 'number' ? rsiValue : NaN;
  const rsiTrap = !isNaN(rsiNum) && rsiNum < 30 && !rsiConfirmed;
  const buySafe = hlConfirmed && !rsiTrap;

  // نظام لا تحتفظ بالخسارة (Forced Exit)
  const distToStop = calcEntry > 0 ? ((calcCurrent - calcStop) / calcEntry) * 100 : 0;
  const pnlPct = calcEntry > 0 ? ((calcCurrent - calcEntry) / calcEntry) * 100 : 0;
  const stopLowered = calcStop < origStop;
  const forcedExit = pnlPct <= -8 || calcCurrent <= calcStop;
  const alertLevel =
    stopLowered ? 'violation'
      : forcedExit ? 'critical'
        : distToStop <= 3 ? 'warning'
          : distToStop <= 6 ? 'caution' : 'safe';

  return (
    <div className="space-y-4" dir="rtl">
      {/* Trading Time */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="w-5 h-5 text-blue-600" />
            وقت التداول - {market === 'egx' ? 'البورصة المصرية' : 'العملات الرقمية'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>جاري التحميل...</span>
            </div>
          ) : tradingTime ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge className={tradingTime.is_open ? 'bg-green-500' : 'bg-gray-500'}>
                    {tradingTime.is_open ? '🟢 مفتوح' : '🔴 مغلق'}
                  </Badge>
                  <span className="text-sm">{tradingTime.day}</span>
                  <span className="font-medium">{tradingTime.current_time}</span>
                </div>
                <Select value={market} onValueChange={(v: any) => setMarket(v)}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="egx">EGX</SelectItem>
                    <SelectItem value="crypto">Crypto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="p-3 rounded-lg bg-white dark:bg-gray-800">
                <p className="font-medium">{tradingTime.status}</p>
                <p className="text-sm text-muted-foreground">{tradingTime.action}</p>
              </div>
              {tradingTime.day_score !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">تقييم اليوم:</span>
                  <div className="flex-1 h-2 bg-gray-200 rounded-full">
                    <div className={`h-full rounded-full ${tradingTime.day_score >= 7 ? 'bg-green-500' : 'bg-amber-500'}`}
                      style={{ width: `${tradingTime.day_score * 10}%` }} />
                  </div>
                  <span className="text-sm font-medium">{tradingTime.day_score}/10</span>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Tabs */}
       <Tabs defaultValue="position">
         <TabsList className="grid w-full grid-cols-4">
           <TabsTrigger value="position" className="gap-1"><PieChart className="w-4 h-4" /> حجم الصفقة</TabsTrigger>
           <TabsTrigger value="stoploss" className="gap-1"><Shield className="w-4 h-4" /> Stop Loss</TabsTrigger>
           <TabsTrigger value="targets" className="gap-1"><Target className="w-4 h-4" /> الأهداف</TabsTrigger>
           <TabsTrigger value="calculator" className="gap-1"><Calculator className="w-4 h-4" /> حاسبة الصفقة</TabsTrigger>
         </TabsList>

        <TabsContent value="position" className="space-y-4">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>رأس المال (جنيه)</Label>
                  <Input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label>درجة الثقة: {confidenceScore}</Label>
                  <Slider value={[confidenceScore]} onValueChange={(v) => setConfidenceScore(v[0])} min={-10} max={10} step={0.5} />
                </div>
              </div>
              <Button onClick={calculatePosition} className="w-full"><Calculator className="w-4 h-4 ml-2" /> احسب</Button>
              {positionResult && (
                <div className="p-4 rounded-lg bg-muted space-y-2">
                  <div className="flex justify-between"><span>القرار:</span><Badge>{positionResult.action}</Badge></div>
                  <div className="flex justify-between"><span>حجم الصفقة:</span><span className="text-xl font-bold text-primary">{positionResult.position_size.toLocaleString()} ج</span></div>
                  <div className="flex justify-between"><span>النسبة:</span><span>{positionResult.percentage_of_capital}%</span></div>
                  <p className="text-sm text-muted-foreground">{positionResult.reason}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stoploss" className="space-y-4">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>السهم</Label>
                  <Input value={stockSymbol} onChange={(e) => setStockSymbol(e.target.value.toUpperCase())} />
                </div>
                <div className="space-y-2">
                  <Label>سعر الدخول</Label>
                  <Input type="number" value={entryPrice} onChange={(e) => setEntryPrice(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label>السوق</Label>
                  <Select value={market} onValueChange={(v: any) => setMarket(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="egx">EGX</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={calculateStopLoss} className="w-full"><Shield className="w-4 h-4 ml-2" /> احسب</Button>
              {stopLossResult && (
                <div className="p-4 rounded-lg bg-muted space-y-2">
                  <div className="flex justify-between"><span>نوع السهم:</span><Badge variant="outline">{stopLossResult.stock_type}</Badge></div>
                  <div className="flex justify-between"><span>Stop Loss:</span><span className="text-xl font-bold text-red-500">{stopLossResult.stop_price}</span></div>
                  <div className="flex justify-between"><span>النسبة:</span><span className="text-red-500">{stopLossResult.stop_percent}%</span></div>
                  <p className="text-sm">{stopLossResult.reason}</p>
                  <p className="text-sm font-medium">{stopLossResult.warning}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="targets" className="space-y-4">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>سعر الدخول</Label>
                  <Input type="number" value={entryPrice} onChange={(e) => setEntryPrice(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label>Stop Loss</Label>
                  <Input type="number" value={stopPrice} onChange={(e) => setStopPrice(Number(e.target.value))} />
                </div>
              </div>
              <Button onClick={calculateTargets} className="w-full"><Target className="w-4 h-4 ml-2" /> احسب</Button>
              {targetResult && (
                <div className="space-y-3">
                  {targetResult.targets.map((t) => (
                    <div key={t.target_number} className="p-3 rounded-lg bg-muted">
                      <div className="flex justify-between mb-1">
                        <span className="font-medium">الهدف {t.target_number}</span>
                        <Badge>بيع {t.sell_percent}%</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>السعر:</span>
                        <span className="text-lg font-bold text-green-600">{t.price}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>الربح:</span>
                        <span className="text-green-600">+{t.profit_percent}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────── حاسبة الصفقة الذكية (الأنظمة الخمسة) ───────────── */}
        <TabsContent value="calculator" className="space-y-4">
          {/* المدخلات */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="w-4 h-4 text-primary" /> مدخلات الصفقة
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>رأس المال (جنيه)</Label>
                  <Input type="number" value={calcCapital} onChange={(e) => setCalcCapital(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>سعر الدخول</Label>
                  <Input type="number" value={calcEntry} onChange={(e) => setCalcEntry(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>وقف الخسارة</Label>
                  <Input type="number" value={calcStop} onChange={(e) => setCalcStop(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>الهدف</Label>
                  <Input type="number" value={calcTarget} onChange={(e) => setCalcTarget(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>السعر الحالي (للمراقبة)</Label>
                  <Input type="number" value={calcCurrent} onChange={(e) => setCalcCurrent(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>الوقف الأصلي (للتأكد)</Label>
                  <Input type="number" value={origStop} onChange={(e) => setOrigStop(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>نسبة المخاطرة: {calcRisk}%</Label>
                  <Slider value={[calcRisk]} onValueChange={(v) => setCalcRisk(v[0])} min={0.5} max={5} step={0.5} />
                </div>
                <div className="space-y-1">
                  <Label>درجة الثقة: {calcConfidence}</Label>
                  <Slider value={[calcConfidence]} onValueChange={(v) => setCalcConfidence(v[0])} min={-10} max={10} step={0.5} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>RSI الحالي (اختياري)</Label>
                <Input type="number" value={rsiValue} onChange={(e) => setRsiValue(e.target.value === '' ? '' : Number(e.target.value))} placeholder="مثال: 28" />
              </div>
            </CardContent>
          </Card>

          {/* 1) حاسبة حجم الصفقة + 5) مؤشر R:R */}
          <Card className="border-primary/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="w-4 h-4 text-primary" /> 1) حاسبة حجم الصفقة + مؤشر R:R
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">عدد الأسهم المسموح</p>
                  <p className="text-xl font-bold text-primary">{safeShares.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">قيمة الصفقة</p>
                  <p className="text-xl font-bold">{calcPositionValue.toLocaleString()} ج</p>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">أقصى خسارة (حد {calcRisk}%)</p>
                  <p className="text-xl font-bold text-red-500">{calcMaxLoss.toLocaleString()} ج</p>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">المخاطرة للسهم</p>
                  <p className="text-xl font-bold">{riskPerShare.toFixed(2)} ج</p>
                </div>
              </div>

              {/* مؤشر R:R المرئي */}
              <div className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: 'transparent' }}>
                <span className="text-sm">المخاطرة/العائد (R:R):</span>
                <span className={`inline-flex items-center gap-1 rounded-md border px-3 py-1 text-lg font-bold ${rrVerdict.badgeClass}`}>
                  <span>{rrVerdict.emoji}</span> 1:{calcRR.toFixed(1)}
                  <span className="text-xs font-medium opacity-80">{rrVerdict.label_ar}</span>
                </span>
              </div>
              <p className={`text-center font-bold ${priceOK && safeShares > 0 && calcRR >= 1.5 ? 'text-green-600' : 'text-red-500'}`}>
                {calcVerdict}
              </p>
            </CardContent>
          </Card>

          {/* 2) نظام لا تشتري نازل (Anti-Falling-Knife) */}
          <Card className="border-amber-300/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> 2) نظام "لا تشتري نازل"
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={hlConfirmed} onChange={(e) => setHlConfirmed(e.target.checked)}
                  className="w-4 h-4 accent-amber-500" />
                <span className="text-sm">السهم عمل Higher Low مرتين على الأقل ✅</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={rsiConfirmed} onChange={(e) => setRsiConfirmed(e.target.checked)}
                  className="w-4 h-4 accent-amber-500" />
                <span className="text-sm">تأكيد الحجم أو شمعة انعكاس (لو RSI منخفض)</span>
              </label>
              {!isNaN(rsiNum) && rsiNum < 30 && (
                <div className={`p-2 rounded-lg text-sm ${rsiTrap ? 'bg-red-50 text-red-700 dark:bg-red-950/40' : 'bg-green-50 text-green-700 dark:bg-green-950/40'}`}>
                  {rsiTrap
                    ? '⚠️ RSI < 30 بس = مش سبب كافي للشراء — محتاج تأكيد حجم أو شمعة انعكاس'
                    : '✅ RSI منخفض بس فيه تأكيد — تمام'}
                </div>
              )}
              <div className={`p-2 rounded-lg text-sm font-medium ${buySafe ? 'bg-green-50 text-green-700 dark:bg-green-950/40' : 'bg-red-50 text-red-700 dark:bg-red-950/40'}`}>
                {buySafe ? '✅ آمن للشراء المدروس' : '🛑 لسه مفيش قاع مؤكد — راقب أكتر'}
              </div>
            </CardContent>
          </Card>

          {/* 3) نظام لا تبيع في القاع (Trailing Stop Visualizer) */}
          <Card className="border-indigo-300/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="w-4 h-4 text-indigo-500" /> 3) الـ Trailing Stop (بيصعد بس!)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                الوقف المتحرك بيطلع مع السعر لفوق بس — وما بينزلش لما السعر ينزل. يعني متخافش تبيع في القاع.
              </p>
              <div className="relative h-12 rounded-lg bg-gradient-to-l from-red-100 via-amber-50 to-green-100 dark:from-red-950/40 dark:via-amber-950/20 dark:to-green-950/40 flex items-center">
                <div className="absolute inset-y-0 left-2 flex flex-col items-center justify-center text-[10px] text-red-600">
                  <span>وقف</span><span className="font-bold">{calcStop}</span>
                </div>
                <div className="absolute inset-y-0 right-2 flex flex-col items-center justify-center text-[10px] text-green-600">
                  <span>هدف</span><span className="font-bold">{calcTarget}</span>
                </div>
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center text-[10px] text-primary">
                  <span>دخول</span><span className="font-bold">{calcEntry}</span>
                </div>
                <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-indigo-500" style={{ left: '50%' }}>
                  <span className="absolute -top-0.5 left-1 text-[9px] text-indigo-500">▲ فقط لأعلى</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                🔒 لو السهم طلع والوقف اتحرك لـ {Math.max(calcStop, calcEntry).toFixed(2)}، ونزل السهم بعدها — الوقف يفضل {Math.max(calcStop, calcEntry).toFixed(2)} (ما بينزلش).
              </p>
            </CardContent>
          </Card>

          {/* 4) نظام لا تحتفظ بالخسارة (Forced Exit Enforcement) */}
          <Card className="border-red-300/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="w-4 h-4 text-red-500" /> 4) إنفاذ وقف الخسارة (إجباري)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">البعد عن الوقف</p>
                  <p className={`text-xl font-bold ${distToStop <= 3 ? 'text-red-500' : distToStop <= 6 ? 'text-amber-500' : 'text-green-600'}`}>
                    {distToStop.toFixed(1)}%
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">الخسارة الحالية</p>
                  <p className={`text-xl font-bold ${pnlPct <= 0 ? 'text-red-500' : 'text-green-600'}`}>
                    {pnlPct > 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* حالة التنبيه */}
              <div className={`p-3 rounded-lg text-sm font-medium ${
                alertLevel === 'violation' ? 'bg-red-100 text-red-800 dark:bg-red-950/60'
                  : alertLevel === 'critical' ? 'bg-red-50 text-red-700 dark:bg-red-950/40'
                    : alertLevel === 'warning' ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/40'
                      : alertLevel === 'caution' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40'
                        : 'bg-green-50 text-green-700 dark:bg-green-950/40'
              }`}>
                {stopLowered
                  ? '🚨 خطر: الوقف اتغير لتحت — ممنوع! رجّعه لسعره الأصلي'
                  : forcedExit
                    ? `🚨 اخرج فوراً! الخسارة وصلت ${pnlPct.toFixed(1)}% (الحد -8%)`
                    : alertLevel === 'warning'
                      ? `⚠️ السهم قريب من الوقف (${distToStop.toFixed(1)}% فقط) — راقب بقوة`
                      : alertLevel === 'caution'
                        ? `🟡 السهم على بُعد ${distToStop.toFixed(1)}% من الوقف — انتبه`
                        : '✅ بعيد عن الوقف — الوضع آمن'}
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="w-3.5 h-3.5 text-green-600" />
                <span>الخسارة ثابتة، الربح متغير — الوقف ما يتغيرش لتحت أبداً</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Button onClick={calculateFullPlan} className="w-full" size="lg">
        <Zap className="w-5 h-5 ml-2" /> احسب الخطة الكاملة
      </Button>
    </div>
  );
}