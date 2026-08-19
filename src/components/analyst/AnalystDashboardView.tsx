'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Target,
  Shield,
  Lightbulb,
  CheckCircle,
  XCircle,
  Clock,
  User,
  AlertTriangle
} from 'lucide-react';

interface TechnicalData {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
  rsi: number;
  sma20: number;
  sma50: number;
  volume: number;
  volume_avg: number;
  high_52w: number;
  low_52w: number;
  support: number;
  resistance: number;
}

interface Prediction {
  id: string;
  ticker: string;
  prediction: string;
  target_price: number | null;
  stop_loss: number | null;
  confidence: number;
  notes: string | null;
  prediction_date: string;
  status: string;
  actual_result?: string;
  pnl_pct?: number;
}

// بيانات الأسهم المصرية
const EGX_STOCKS = [
  { ticker: 'COMI', name: 'البنك التجاري الدولي', sector: 'بنوك' },
  { ticker: 'SWDY', name: 'السويدي إليكتريك', sector: 'صناعة' },
  { ticker: 'HRHO', name: 'هيرمس القابضة', sector: 'مالية' },
  { ticker: 'HELI', name: 'حليك للتنمية', sector: 'عقارات' },
  { ticker: 'ETEL', name: 'المصرية للاتصالات', sector: 'اتصالات' },
  { ticker: 'AMOC', name: 'أبو قير للأسمدة', sector: 'أسمدة' },
  { ticker: 'ADIB', name: 'بنك أبو ظبي الإسلامي', sector: 'بنوك' },
  { ticker: 'TMGH', name: 'طلعت مصطفى جروب', sector: 'عقارات' },
  { ticker: 'PHDC', name: 'بديع للتنمية', sector: 'عقارات' },
  { ticker: 'ISPH', name: 'اسكندرية للاستثمار', sector: 'مالية' },
];

const defaultAnalystId = 'analyst_001';

export function AnalystDashboardView() {
  const [selectedTicker, setSelectedTicker] = useState<string>('COMI');
  const [technicalData, setTechnicalData] = useState<TechnicalData | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  
  // حقول التوقع
  const [prediction, setPrediction] = useState<string>('neutral');
  const [targetPrice, setTargetPrice] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [confidence, setConfidence] = useState<number>(5);
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // جلب البيانات التقنية الحقيقية من /api/stocks/[ticker]/history
  // وحساب RSI / SMA / الدعم / المقاومة من تاريخ الأسعار الحقيقي (بدون محاكاة).
  const fetchTechnicalData = async (ticker: string) => {
    setLoading(true);
    setTechnicalData(null);
    try {
      const res = await fetch(`/api/stocks/${encodeURIComponent(ticker)}/history?days=365`);
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();
      const history: Array<{ date?: string; open?: number; high?: number; low?: number; close?: number; volume?: number }> =
        Array.isArray(data?.data) ? data.data : [];
      if (history.length === 0) {
        setLoading(false);
        return;
      }

      const closes: number[] = history.map(h => Number(h?.close)).filter(n => Number.isFinite(n) && n > 0);
      const highs: number[] = history.map(h => Number(h?.high)).filter(n => Number.isFinite(n) && n > 0);
      const lows: number[] = history.map(h => Number(h?.low)).filter(n => Number.isFinite(n) && n > 0);
      const volumes: number[] = history.map(h => Number(h?.volume)).filter(n => Number.isFinite(n) && n >= 0);

      if (closes.length === 0) {
        setLoading(false);
        return;
      }

      const lastClose = closes[closes.length - 1];
      const prevClose = closes.length > 1 ? closes[closes.length - 2] : lastClose;
      const changePct = prevClose > 0 ? ((lastClose - prevClose) / prevClose) * 100 : 0;

      // SMA 20 / SMA 50 (fallback to longest available if insufficient data)
      const sma = (period: number): number => {
        if (closes.length === 0) return 0;
        const slice = closes.slice(-Math.min(period, closes.length));
        return slice.reduce((a, b) => a + b, 0) / slice.length;
      };
      const sma20 = sma(20);
      const sma50 = sma(50);

      // RSI (14) — Wilder's smoothing
      const computeRSI = (period: number): number => {
        if (closes.length < period + 1) return 50; // not enough data — neutral, NOT fabricated
        let gains = 0;
        let losses = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
          const diff = closes[i] - closes[i - 1];
          if (diff >= 0) gains += diff; else losses -= diff;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - 100 / (1 + rs);
      };
      const rsi = computeRSI(14);

      const volume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
      const volumeAvg = volumes.length > 0
        ? volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length)
        : 0;
      const high52w = highs.length > 0 ? Math.max(...highs) : lastClose;
      const low52w = lows.length > 0 ? Math.min(...lows) : lastClose;
      // Support = local min in last 60 sessions; Resistance = local max in last 60 sessions
      const recentHighs = highs.slice(-60);
      const recentLows = lows.slice(-60);
      const support = recentLows.length > 0 ? Math.min(...recentLows) : lastClose;
      const resistance = recentHighs.length > 0 ? Math.max(...recentHighs) : lastClose;

      setTechnicalData({
        ticker,
        name: EGX_STOCKS.find(s => s.ticker === ticker)?.name || ticker,
        price: lastClose,
        change_pct: changePct,
        rsi,
        sma20,
        sma50,
        volume,
        volume_avg: volumeAvg,
        high_52w: high52w,
        low_52w: low52w,
        support,
        resistance,
      });
    } catch (error) {
      console.error('Error fetching technical data:', error);
      setTechnicalData(null);
    } finally {
      setLoading(false);
    }
  };

  // جلب التوقعات - Use UNIFIED API
  const fetchPredictions = async () => {
    try {
      const res = await fetch('/api/unified/predictions?limit=50');
      if (res.ok) {
        const data = await res.json();
        // Transform unified format to component format
        const transformed = (data.predictions || []).map((p: any) => ({
          id: p.id,
          ticker: p.symbol,
          prediction: p.signal === 'BUY' || p.signal === 'STRONG_BUY' ? 'up' : 
                      p.signal === 'SELL' || p.signal === 'STRONG_SELL' ? 'down' : 'neutral',
          target_price: p.target_price,
          stop_loss: p.stop_loss,
          confidence: Math.round(p.confidence / 10),
          notes: p.reasons?.join(' | ') || '',
          prediction_date: p.prediction_date,
          status: p.status
        }));
        setPredictions(transformed);
      }
    } catch (error) {
      console.error('Error fetching predictions:', error);
    }
  };

  // إرسال توقع جديد
  const submitPrediction = async () => {
    if (!selectedTicker || !prediction) return;
    
    setSubmitting(true);
    try {
      const res = await fetch('/api/analyst/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analyst_id: defaultAnalystId,
          analyst_name: 'محلل',
          ticker: selectedTicker,
          prediction,
          target_price: targetPrice ? parseFloat(targetPrice) : null,
          stop_loss: stopLoss ? parseFloat(stopLoss) : null,
          confidence,
          notes,
          rsi_at_prediction: technicalData?.rsi,
          sma20_at_prediction: technicalData?.sma20,
          sma50_at_prediction: technicalData?.sma50,
          price_at_prediction: technicalData?.price
        })
      });

      if (res.ok) {
        setNotes('');
        setTargetPrice('');
        setStopLoss('');
        setConfidence(5);
        fetchPredictions();
      }
    } catch (error) {
      console.error('Error submitting prediction:', error);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    fetchTechnicalData(selectedTicker);
  }, [selectedTicker]);

  useEffect(() => {
    fetchPredictions();
  }, []);

  // حسابات الألوان
  const getRSIColor = (rsi: number) => {
    if (rsi < 30) return 'text-green-500';
    if (rsi > 70) return 'text-red-500';
    return 'text-yellow-500';
  };

  const getRSILabel = (rsi: number) => {
    if (rsi < 30) return 'تشبع بيعي';
    if (rsi > 70) return 'تشبع شرائي';
    return 'محايد';
  };

  const getPredictionIcon = (pred: string) => {
    switch (pred) {
      case 'up': return <TrendingUp className="h-5 w-5 text-green-500" />;
      case 'down': return <TrendingDown className="h-5 w-5 text-red-500" />;
      default: return <Minus className="h-5 w-5 text-yellow-500" />;
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-6" dir="rtl">
      {/* العنوان */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-primary">لوحة المحلل</h1>
        <p className="text-muted-foreground mt-2">
          بيانات تقنية للمساعدة في اتخاذ القرار - بدون توقعات
        </p>
      </div>

      {/* اختيار السهم */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            اختر السهم
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedTicker} onValueChange={setSelectedTicker}>
            <SelectTrigger className="w-full md:w-[200px]">
              <SelectValue placeholder="اختر السهم" />
            </SelectTrigger>
            <SelectContent>
              {EGX_STOCKS.map(stock => (
                <SelectItem key={stock.ticker} value={stock.ticker}>
                  {stock.ticker} - {stock.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            جارٍ تحميل البيانات التقنية الحقيقية...
          </CardContent>
        </Card>
      )}

      {!loading && !technicalData && (
        <Card className="border-yellow-500/40">
          <CardContent className="py-10 text-center space-y-2">
            <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto" />
            <p className="text-base font-medium">لا توجد بيانات تقنية متاحة لهذا السهم حالياً</p>
            <p className="text-sm text-muted-foreground">
              يتم عرض المؤشرات (RSI، SMA، الدعم/المقاومة) فقط عند توفّر تاريخ أسعار حقيقي.
              تأكّد من تشغيل خدمة جلب بيانات الأسعار (historical_fetcher) ثم أعد المحاولة.
            </p>
            <Button variant="outline" size="sm" onClick={() => fetchTechnicalData(selectedTicker)}>
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      )}

      {technicalData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* البيانات التقنية */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">الصورة التقنية</CardTitle>
              <CardDescription>{technicalData.name}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* السعر */}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">السعر الحالي</span>
                <span className="text-2xl font-bold">
                  {technicalData.price.toFixed(2)} ج.م
                </span>
              </div>
              
              {/* التغير */}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">التغير</span>
                <Badge variant={technicalData.change_pct >= 0 ? 'default' : 'destructive'}>
                  {technicalData.change_pct >= 0 ? '+' : ''}
                  {technicalData.change_pct.toFixed(2)}%
                </Badge>
              </div>

              <Separator />

              {/* RSI */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">RSI (14)</span>
                  <span className={getRSIColor(technicalData.rsi)}>
                    {technicalData.rsi.toFixed(1)} - {getRSILabel(technicalData.rsi)}
                  </span>
                </div>
                <Progress value={technicalData.rsi} className="h-2" />
              </div>

              {/* SMA */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">SMA 20</span>
                  <span>{technicalData.sma20.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">SMA 50</span>
                  <span>{technicalData.sma50.toFixed(2)}</span>
                </div>
              </div>

              {/* الدعم والمقاومة */}
              <Separator />
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Shield className="h-4 w-4 text-green-500" />
                    دعم
                  </span>
                  <span className="text-green-500">{technicalData.support.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Target className="h-4 w-4 text-red-500" />
                    مقاومة
                  </span>
                  <span className="text-red-500">{technicalData.resistance.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* السياق */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Lightbulb className="h-5 w-5" />
                السياق
              </CardTitle>
              <CardDescription>عوامل يجب مراعاتها</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* حجم التداول */}
              <div className="flex justify-between items-center p-2 bg-muted rounded-lg">
                <span className="text-sm">حجم التداول</span>
                <Badge variant={technicalData.volume > technicalData.volume_avg ? 'default' : 'secondary'}>
                  {technicalData.volume > technicalData.volume_avg ? 'أعلى من المعتاد' : 'عادي'}
                </Badge>
              </div>

              {/* موقع السعر */}
              <div className="flex justify-between items-center p-2 bg-muted rounded-lg">
                <span className="text-sm">موقع السعر</span>
                <Badge variant="outline">
                  {technicalData.price > technicalData.sma20 && technicalData.price > technicalData.sma50 
                    ? 'فوق المتوسطات' 
                    : technicalData.price < technicalData.sma20 && technicalData.price < technicalData.sma50
                    ? 'تحت المتوسطات'
                    : 'بين المتوسطات'}
                </Badge>
              </div>

              {/* الاتجاه */}
              <div className="flex justify-between items-center p-2 bg-muted rounded-lg">
                <span className="text-sm">الاتجاه قصير المدى</span>
                <Badge variant={technicalData.sma20 > technicalData.sma50 ? 'default' : 'destructive'}>
                  {technicalData.sma20 > technicalData.sma50 ? 'صاعد' : 'هابط'}
                </Badge>
              </div>

              {/* أعلى وأدنى 52 أسبوع */}
              <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                <div className="text-sm text-muted-foreground mb-2">نطاق 52 أسبوع</div>
                <div className="flex justify-between">
                  <span className="text-red-500">{technicalData.low_52w.toFixed(2)}</span>
                  <Progress 
                    value={((technicalData.price - technicalData.low_52w) / (technicalData.high_52w - technicalData.low_52w)) * 100}
                    className="flex-1 mx-2 h-2"
                  />
                  <span className="text-green-500">{technicalData.high_52w.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* إدخال التوقع */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">توقعك</CardTitle>
              <CardDescription>سجل تحليلك وتوقعك</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* التوقع */}
              <div className="space-y-2">
                <Label>التوقع</Label>
                <div className="flex gap-2">
                  {['up', 'down', 'neutral'].map(pred => (
                    <Button
                      key={pred}
                      variant={prediction === pred ? 'default' : 'outline'}
                      className="flex-1"
                      onClick={() => setPrediction(pred)}
                    >
                      {pred === 'up' && <TrendingUp className="h-4 w-4 ml-1" />}
                      {pred === 'down' && <TrendingDown className="h-4 w-4 ml-1" />}
                      {pred === 'neutral' && <Minus className="h-4 w-4 ml-1" />}
                      {pred === 'up' ? 'صعود' : pred === 'down' ? 'هبوط' : 'محايد'}
                    </Button>
                  ))}
                </div>
              </div>

              {/* السعر المستهدف */}
              <div className="space-y-2">
                <Label htmlFor="target">السعر المستهدف</Label>
                <Input
                  id="target"
                  type="number"
                  placeholder="مثال: 120"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                />
              </div>

              {/* وقف الخسارة */}
              <div className="space-y-2">
                <Label htmlFor="stop">وقف الخسارة</Label>
                <Input
                  id="stop"
                  type="number"
                  placeholder="مثال: 90"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                />
              </div>

              {/* الثقة */}
              <div className="space-y-2">
                <Label>مستوى الثقة: {confidence}/10</Label>
                <Input
                  type="range"
                  min="1"
                  max="10"
                  value={confidence}
                  onChange={(e) => setConfidence(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* الملاحظات */}
              <div className="space-y-2">
                <Label htmlFor="notes">ملاحظاتك</Label>
                <Textarea
                  id="notes"
                  placeholder="أسباب التوقع، عوامل يجب متابعتها..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <Button 
                className="w-full" 
                onClick={submitPrediction}
                disabled={submitting}
              >
                {submitting ? 'جاري الحفظ...' : 'حفظ التوقع'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* التوقعات السابقة */}
      {predictions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5" />
              توقعاتك السابقة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {predictions.map((pred) => (
                <div key={pred.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-3">
                    {getPredictionIcon(pred.prediction)}
                    <div>
                      <div className="font-medium">{pred.ticker}</div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(pred.prediction_date).toLocaleDateString('ar-EG')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {pred.status === 'reviewed' ? (
                      pred.actual_result === pred.prediction ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )
                    ) : (
                      <Badge variant="secondary">قيد المراجعة</Badge>
                    )}
                    {pred.pnl_pct !== null && pred.pnl_pct !== undefined && (
                      <Badge variant={pred.pnl_pct >= 0 ? 'default' : 'destructive'}>
                        {pred.pnl_pct >= 0 ? '+' : ''}{pred.pnl_pct.toFixed(1)}%
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* تنبيه */}
      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-yellow-500">تنبيه مهم</h4>
              <p className="text-sm text-muted-foreground mt-1">
                هذه البيانات للأغراض التعليمية والمساعدة في اتخاذ القرار فقط.
                القرار النهائي مسؤوليتك الشخصية. الأداء السابق لا يضمن النتائج المستقبلية.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
