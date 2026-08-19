'use client';

import React, { useState, useEffect } from 'react';
import {
  Play, Calendar, RefreshCw, Loader2, Brain, Send, Settings, Target,
  CheckCircle, XCircle, Trash2, Server, Wifi, WifiOff, Database
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

// ==================== TYPES ====================

interface Prediction {
  id: string;
  ticker: string;
  name?: string;
  market: string;
  prediction_type: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  source: string;
  status: string;
  created_at: string;
  target_date?: string;
  technical_score?: number;
  rsi?: number;
  macd?: number;
  sma_20?: number;
  sma_50?: number;
}

interface DatabaseStatus {
  status: string;
  stocks_count?: number;
  records_count?: number;
  predictions_count?: number;
  error?: string;
}

interface ServiceHealth {
  status: string;
  service: string;
  version: string;
  port: number;
  databases: {
    stocks_db: DatabaseStatus;
    price_history_db: DatabaseStatus;
    predictions_db: DatabaseStatus;
  };
}

const MARKETS = [
  { id: 'egx', name: 'البورصة المصرية', icon: '🇪🇬' },
  { id: 'ksa', name: 'السعودية', icon: '🇸🇦' },
  { id: 'kse', name: 'الكويت', icon: '🇰🇼' },
  { id: 'dfm', name: 'دبي', icon: '🇦🇪' },
  { id: 'crypto', name: 'العملات الرقمية', icon: '₿' },
  { id: 'forex', name: 'العملات الأجنبية', icon: '💱' },
];

const PERIODS = [
  { id: '1m', name: 'شهر واحد' },
  { id: '3m', name: '3 أشهر' },
  { id: '6m', name: '6 أشهر' },
  { id: '1y', name: 'سنة كاملة' },
];

// Python Service URL helper (port 8010 — standard Python backend port)
const getPythonServiceUrl = (path: string) => `${path}?XTransformPort=8010`;

export function AdminPredictionGenerator() {
  const [selectedMarket, setSelectedMarket] = useState<string>('egx');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('1m');
  const [generating, setGenerating] = useState(false);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [stats, setStats] = useState({ total: 0, successful: 0, failed: 0 });
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth | null>(null);
  const [checkingService, setCheckingService] = useState(false);

  // Check Python service health
  const checkServiceHealth = async () => {
    setCheckingService(true);
    try {
      const response = await fetch(getPythonServiceUrl('/health'), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      setServiceHealth(data);
    } catch (error) {
      console.error('Service health check failed:', error);
      setServiceHealth(null);
    } finally {
      setCheckingService(false);
    }
  };

  useEffect(() => {
    checkServiceHealth();
  }, []);

  // Check if service is ready (local databases connected)
  const isServiceReady = () => {
    if (!serviceHealth) return false;
    const stocksDb = serviceHealth.databases?.stocks_db;
    const priceHistoryDb = serviceHealth.databases?.price_history_db;
    return stocksDb?.status === 'connected' && priceHistoryDb?.status === 'connected';
  };

  const generatePredictions = async () => {
    if (!isServiceReady()) {
      toast.error('خدمة Python غير متصلة بقواعد البيانات المحلية');
      await checkServiceHealth();
      return;
    }

    setGenerating(true);
    try {
      const response = await fetch(getPythonServiceUrl('/api/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: selectedMarket,
          period: selectedPeriod,
          source: 'ai',
          limit: 15,  // Generate up to 15 predictions
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast.success(`تم توليد ${result.predictions_count} تنبؤ من البيانات المحلية`);
        if (result.predictions) {
          setPredictions(result.predictions);
          setStats({
            total: result.predictions_count,
            successful: result.predictions.filter((p: Prediction) => p.prediction_type === 'buy').length,
            failed: result.predictions.filter((p: Prediction) => p.prediction_type === 'sell').length,
          });
        }
      } else {
        toast.error(result.error || 'فشل في توليد التوقعات');
      }
    } catch (error) {
      console.error('Generate error:', error);
      toast.error('خطأ في الاتصال بخدمة التوليد');
    } finally {
      setGenerating(false);
    }
  };

  const clearPredictions = async () => {
    if (!confirm('هل أنت متأكد من حذف كل التوقعات؟')) return;
    setPredictions([]);
    setStats({ total: 0, successful: 0, failed: 0 });
    toast.success('تم مسح التوقعات');
  };

  // Render database status badge
  const renderDbStatus = (name: string, db: DatabaseStatus) => {
    const isConnected = db.status === 'connected';
    const count = db.stocks_count || db.records_count || db.predictions_count || 0;
    
    return (
      <div className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
        isConnected 
          ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
          : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
      )}>
        {isConnected ? (
          <CheckCircle className="w-4 h-4" />
        ) : (
          <XCircle className="w-4 h-4" />
        )}
        <span>{name}: {isConnected ? `${count} سجل` : 'خطأ'}</span>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="w-7 h-7 text-purple-500" />
            توليد التوقعات والتحليلات
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            🔥 Python Brain = كل الحسابات من البيانات المحلية | 273,750+ سجل تاريخي
          </p>
        </div>
      </div>

      {/* ===== حالة الخدمة ===== */}
      <Card className={cn(
        "border-2",
        isServiceReady() 
          ? "border-emerald-300 dark:border-emerald-700" 
          : "border-red-300 dark:border-red-700"
      )}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {isServiceReady() ? (
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <Database className="w-5 h-5 text-emerald-500" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <WifiOff className="w-5 h-5 text-red-500" />
                </div>
              )}
              <div>
                <p className="font-bold">
                  {isServiceReady() 
                    ? '✅ متصل بقواعد البيانات المحلية' 
                    : '❌ خدمة Python غير متاحة'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {serviceHealth?.version || 'v2.0.0'} | Port: {serviceHealth?.port || 3010}
                </p>
              </div>
            </div>
            <Button
              onClick={checkServiceHealth}
              disabled={checkingService}
              variant="outline"
              size="sm"
            >
              {checkingService ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>
          
          {/* Database Status */}
          {serviceHealth?.databases && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {renderDbStatus('الأسهم', serviceHealth.databases.stocks_db)}
              {renderDbStatus('البيانات التاريخية', serviceHealth.databases.price_history_db)}
              {renderDbStatus('التوقعات', serviceHealth.databases.predictions_db)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== لوحة التحكم ===== */}
      <Card className="border-purple-200 dark:border-purple-800">
        <CardHeader className="bg-purple-50 dark:bg-purple-900/20 pb-3">
          <CardTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-300">
            <Settings className="w-5 h-5" />
            إعدادات التوليد
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* اختيار السوق */}
            <div className="space-y-2">
              <Label>السوق</Label>
              <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETS.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.icon} {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* اختيار الفترة */}
            <div className="space-y-2">
              <Label>الفترة الزمنية</Label>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      📅 {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* زر التوليد */}
            <div className="space-y-2">
              <Label>الإجراءات</Label>
              <Button
                onClick={generatePredictions}
                disabled={generating || !isServiceReady()}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {generating ? (
                  <><Loader2 className="w-4 h-4 ml-2 animate-spin" />جاري التوليد...</>
                ) : (
                  <><Play className="w-4 h-4 ml-2" />توليد التوقعات</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== إحصائيات سريعة ===== */}
      {stats.total > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3 text-center">
            <p className="text-2xl font-bold text-purple-600">{stats.total}</p>
            <p className="text-xs text-muted-foreground">إجمالي التوقعات</p>
          </Card>
          <Card className="p-3 text-center bg-emerald-50 dark:bg-emerald-950/20">
            <p className="text-2xl font-bold text-emerald-600">{stats.successful}</p>
            <p className="text-xs text-muted-foreground">📈 شراء</p>
          </Card>
          <Card className="p-3 text-center bg-red-50 dark:bg-red-950/20">
            <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
            <p className="text-xs text-muted-foreground">📉 بيع</p>
          </Card>
        </div>
      )}

      {/* ===== قائمة التوقعات ===== */}
      {predictions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-purple-500" />
                التوقعات المولدة ({predictions.length})
              </CardTitle>
              <Button
                onClick={clearPredictions}
                disabled={predictions.length === 0}
                variant="destructive"
                size="sm"
              >
                <Trash2 className="w-4 h-4 ml-1" />حذف
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {predictions.map((pred, i) => (
                  <div key={pred.id || i} className="p-3 rounded-lg border hover:bg-muted/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold",
                          pred.prediction_type === 'buy' ? "bg-emerald-500" : "bg-red-500"
                        )}>
                          {pred.prediction_type === 'buy' ? '↑' : '↓'}
                        </div>
                        <div>
                          <div className="font-bold">{pred.ticker}</div>
                          <div className="text-xs text-muted-foreground">
                            {pred.name || pred.market}
                          </div>
                        </div>
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">دخول:</span>
                          <span className="font-bold">{pred.entry_price?.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">هدف:</span>
                          <span className="font-bold text-emerald-600">{pred.target_price?.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Technical indicators */}
                    {pred.technical_score && (
                      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                        <span>النتيجة: <strong>{pred.technical_score}</strong></span>
                        {pred.rsi && <span>RSI: <strong>{pred.rsi?.toFixed(1)}</strong></span>}
                        {pred.sma_20 && <span>SMA20: <strong>{pred.sma_20?.toFixed(2)}</strong></span>}
                      </div>
                    )}
                    
                    {/* شريط الثقة */}
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground">الثقة</span>
                        <span>{pred.confidence?.toFixed(0)}%</span>
                      </div>
                      <Progress value={pred.confidence} className="h-2" />
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* ===== رسالة إذا لا توجد توقعات ===== */}
      {predictions.length === 0 && !generating && (
        <div className="text-center p-8">
          <div className="w-20 h-20 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mx-auto mb-4">
            <Brain className="w-10 h-10 text-purple-400" />
          </div>
          <h3 className="text-lg font-bold mb-2">لا توجد توقعات مولدة</h3>
          <p className="text-muted-foreground mb-4">
            اختر السوق والفترة الزمنية ثم اضغط "توليد" لإنشاء تحليلات AI
          </p>
          <p className="text-xs text-muted-foreground">
            ⚡ Python Brain = كل الحسابات من {273750}+ سجل تاريخي محلي
          </p>
        </div>
      )}
    </div>
  );
}
