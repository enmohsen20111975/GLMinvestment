'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Target, TrendingUp, Settings, RefreshCw, Clock, Shield, Crosshair } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OpportunityCard } from './OpportunityCard';
import { PerformanceTracker } from './PerformanceTracker';

// ============================================================================
// Types
// ============================================================================

interface SniperResult {
  ticker: string;
  market: string;
  sniper_score: number;
  signal: string;
  signal_ar: string;
  confidence: number;
  entry_price: number;
  stop_loss: number;
  target_price: number;
  risk_reward: number;
  rsi: number;
  support: number | null;
  resistance: number | null;
  price_vs_sr: string;
  volume_ratio: number;
  liquidity_rating: string;
  candlestick_pattern: string;
  gate_1_liquidity: boolean;
  gate_2_trend: boolean;
  gate_3_sr: boolean;
  gate_4_rr: boolean;
  gate_5_confirmation: boolean;
  gates_passed: number;
  warnings_ar: string[];
}

// ============================================================================
// Main Component
// ============================================================================

export function SniperView() {
  const [opportunities, setOpportunities] = useState<SniperResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [market, setMarket] = useState('EGX');
  const [persona, setPersona] = useState('balanced');
  const [pendingCount, setPendingCount] = useState(0);
  const [activeTab, setActiveTab] = useState('opportunities');
  const [closerRunning, setCloserRunning] = useState(false);

  const fetchOpportunities = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/sniper/scan?market=${market}&persona=${persona}&min_gates=3&limit=10&XTransformPort=8010`
      );
      const data = await res.json();
      if (data.success) {
        setOpportunities(data.results || []);
      }
    } catch (err) {
      console.error('Error fetching sniper opportunities:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingCount = async () => {
    try {
      const res = await fetch('/api/sniper/closer/pending?XTransformPort=8010');
      const data = await res.json();
      if (data.success) {
        setPendingCount(data.count || 0);
      }
    } catch (err) {
      console.error('Error fetching pending count:', err);
    }
  };

  useEffect(() => {
    fetchOpportunities();
    fetchPendingCount();
  }, [market, persona]);

  // Signal distribution stats
  const signalCounts = opportunities.reduce(
    (acc, opp) => {
      const s = opp.signal.toLowerCase();
      if (s.includes('strong_buy')) acc.strongBuy++;
      else if (s.includes('buy')) acc.buy++;
      else if (s.includes('hold')) acc.hold++;
      else if (s.includes('sell')) acc.sell++;
      return acc;
    },
    { strongBuy: 0, buy: 0, hold: 0, sell: 0 }
  );

  return (
    <div className="space-y-4 p-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Crosshair className="h-7 w-7 text-primary" />
          <h2 className="text-2xl font-bold">القناص</h2>
          <Badge variant="outline" className="text-xs">
            {opportunities.length} فرصة
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              <Clock className="h-3 w-3 ml-1" />
              {pendingCount} معلق
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOpportunities}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ml-1 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
        </div>
      </div>

      {/* Market / Persona selector */}
      <div className="flex gap-2 flex-wrap">
        {['EGX', 'TADAWUL', 'KSE', 'QSE'].map((m) => (
          <Button
            key={m}
            variant={market === m ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMarket(m)}
          >
            {m}
          </Button>
        ))}
        <Separator orientation="vertical" className="h-8 mx-1" />
        {[
          { key: 'balanced', label: 'متوازن' },
          { key: 'gambler', label: 'مضارب' },
          { key: 'investor', label: 'مستثمر' },
        ].map((p) => (
          <Button
            key={p.key}
            variant={persona === p.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPersona(p.key)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Quick signal distribution bar */}
      {opportunities.length > 0 && (
        <div className="flex gap-2 items-center text-xs text-muted-foreground flex-wrap">
          {signalCounts.strongBuy > 0 && (
            <Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800 text-[10px]">
              شراء قوي: {signalCounts.strongBuy}
            </Badge>
          )}
          {signalCounts.buy > 0 && (
            <Badge className="bg-green-50 text-green-600 border-green-200 dark:bg-green-950/50 dark:text-green-500 dark:border-green-800 text-[10px]">
              شراء: {signalCounts.buy}
            </Badge>
          )}
          {signalCounts.hold > 0 && (
            <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800 text-[10px]">
              احتفاظ: {signalCounts.hold}
            </Badge>
          )}
          {signalCounts.sell > 0 && (
            <Badge className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800 text-[10px]">
              بيع: {signalCounts.sell}
            </Badge>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="opportunities">
            <Target className="h-4 w-4 ml-1" />
            فرص اليوم
          </TabsTrigger>
          <TabsTrigger value="performance">
            <TrendingUp className="h-4 w-4 ml-1" />
            تتبع الأداء
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 ml-1" />
            إعدادات
          </TabsTrigger>
        </TabsList>

        {/* Opportunities Tab */}
        <TabsContent value="opportunities" className="space-y-4 mt-4">
          {loading ? (
            <Card>
              <CardContent className="text-center py-12">
                <RefreshCw className="h-10 w-10 mx-auto text-muted-foreground animate-spin mb-3" />
                <p className="text-muted-foreground">جاري البحث عن فرص...</p>
                <p className="text-xs text-muted-foreground mt-1">
                  القناص بيفحص البوابات الخمس لكل سهم
                </p>
              </CardContent>
            </Card>
          ) : opportunities.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <Shield className="h-14 w-14 mx-auto text-muted-foreground mb-3" />
                <p className="text-lg font-medium text-muted-foreground">لا توجد فرص حالياً</p>
                <p className="text-sm text-muted-foreground mt-1">
                  القناص بيبحث عن أفضل الفرص — بس اللي تعدي البوابات
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={fetchOpportunities}
                >
                  <RefreshCw className="h-4 w-4 ml-1" />
                  إعادة البحث
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {opportunities.map((opp, idx) => (
                <OpportunityCard key={`${opp.ticker}-${opp.market}-${idx}`} opportunity={opp} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="mt-4">
          <PerformanceTracker />
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="mt-4">
          <div className="space-y-4">
            {/* Gate Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  بوابات التصفية
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">الحد الأدنى للبوابات</label>
                  <p className="text-xs text-muted-foreground">
                    عدد البوابات اللي لازم تعديها الفرصة عشان تتقبل (من 5)
                  </p>
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map((g) => (
                      <Badge
                        key={g}
                        variant={g <= 3 ? 'default' : 'outline'}
                        className="cursor-default"
                      >
                        {g}
                      </Badge>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <label className="text-sm font-medium">وصف البوابات</label>
                  <div className="space-y-2">
                    {[
                      { num: 1, name: 'بوابة السيولة', desc: 'تأكد إن السهم يتداول بسيولة كافية' },
                      { num: 2, name: 'بوابة الاتجاه', desc: 'تأكد إن الاتجاه معاك مش عليك' },
                      { num: 3, name: 'بوابة الدعم/المقاومة', desc: 'تأكد إن السعر قريب من مستوى دعم أو مقاومة مهم' },
                      { num: 4, name: 'بوابة المخاطرة/العائد', desc: 'تأكد إن نسبة العائد للمخاطرة مقبولة' },
                      { num: 5, name: 'بوابة التأكيد', desc: 'تأكد إن في تأكيد من الشموع أو المؤشرات' },
                    ].map((gate) => (
                      <div
                        key={gate.num}
                        className="flex items-start gap-2 p-2 rounded-md bg-muted/50"
                      >
                        <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">
                          {gate.num}
                        </Badge>
                        <div>
                          <div className="text-sm font-medium">{gate.name}</div>
                          <div className="text-xs text-muted-foreground">{gate.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Persona Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" />
                  الشخصية
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  كل شخصية ليها معايير مختلفة للدخول والخروج — اختار اللي يناسبك
                </p>
                <div className="space-y-2">
                  {[
                    {
                      key: 'gambler',
                      label: 'مضارب',
                      desc: 'بيقبل مخاطرة أكبر — R/R ≥ 1.5',
                      color: 'text-red-600 dark:text-red-400',
                    },
                    {
                      key: 'balanced',
                      label: 'متوازن',
                      desc: 'توازن بين المخاطرة والعائد — R/R ≥ 2.0',
                      color: 'text-yellow-600 dark:text-yellow-400',
                    },
                    {
                      key: 'investor',
                      label: 'مستثمر',
                      desc: 'مخاطرة أقل وعائد أأمن — R/R ≥ 2.5',
                      color: 'text-green-600 dark:text-green-400',
                    },
                  ].map((p) => (
                    <div
                      key={p.key}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                        persona === p.key
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                      onClick={() => setPersona(p.key)}
                    >
                      <div className={cn('text-lg font-bold', p.color)}>{p.label}</div>
                      <div className="text-xs text-muted-foreground">{p.desc}</div>
                      {persona === p.key && (
                        <Badge variant="default" className="mr-auto text-[10px]">نشط</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Manual Closer */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  إغلاق التوقعات
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  تشغيل إغلاق التوقعات يدوياً — القناص هيفحص كل التوقعات المعلقة ويقفل اللي وصلت لهدفها أو وقفها
                </p>
                {pendingCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {pendingCount} توقع معلق
                  </Badge>
                )}
                <Button
                  variant="outline"
                  disabled={closerRunning}
                  onClick={async () => {
                    setCloserRunning(true);
                    try {
                      await fetch('/api/sniper/closer/run?XTransformPort=8010', {
                        method: 'POST',
                      });
                      await fetchPendingCount();
                    } catch (e) {
                      console.error(e);
                    } finally {
                      setCloserRunning(false);
                    }
                  }}
                >
                  {closerRunning ? (
                    <>
                      <RefreshCw className="h-4 w-4 ml-1 animate-spin" />
                      جاري الإغلاق...
                    </>
                  ) : (
                    <>
                      <Target className="h-4 w-4 ml-1" />
                      تشغيل إغلاق التوقعات يدوياً
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
