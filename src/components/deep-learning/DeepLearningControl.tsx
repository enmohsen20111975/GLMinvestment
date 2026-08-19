'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Brain,
  Play,
  Square,
  RefreshCw,
  Target,
  Activity,
  Zap,
  Database,
  Cpu,
  Settings,
  BarChart3,
  LineChart,
  CheckCircle,
} from 'lucide-react';

// ==================== TYPES ====================

interface LearningProgress {
  status: 'idle' | 'running' | 'completed' | 'error' | 'not_installed';
  current_trial: number;
  total_trials: number;
  best_score: number;
  best_params: Record<string, any>;
  message: string;
  history: Array<{
    trial: number;
    score: number;
    params: Record<string, any>;
  }>;
}

interface ModelInfo {
  model_exists: boolean;
  timestamp?: string;
  version?: string;
  params?: Record<string, any>;
}

interface TradingSignal {
  signal: 'buy' | 'sell' | 'hold' | 'insufficient_data';
  confidence: number;
  indicators?: Record<string, { action: string; weight: number }>;
  price?: number;
  rsi?: number;
  macd?: number;
  timestamp?: string;
}

// ==================== MAIN COMPONENT ====================

export function DeepLearningControl() {
  const [progress, setProgress] = useState<LearningProgress>({ status: 'idle', current_trial: 0, total_trials: 0, best_score: 0, best_params: {}, message: '', history: [] });
  const [modelInfo, setModelInfo] = useState<ModelInfo>({ model_exists: false });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('control');

  // Learning Config
  const [config, setConfig] = useState({
    target_win_rate: 65,
    max_iterations: 100,
    n_trials: 50,
    min_data_points: 100,
  });

  // Signal Testing
  const [testSymbol, setTestSymbol] = useState('COMI');
  const [signal, setSignal] = useState<TradingSignal | null>(null);

  // Python backend على port 8010 — نوصله عبر Caddy gateway (XTransformPort)
  // مش http://127.0.0.1:8010 مباشرة عشان متصفح المستخدم مش هيوصله
  const xform = (path: string) =>
    path.includes('?') ? `${path}&XTransformPort=8010` : `${path}?XTransformPort=8010`;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [progressRes, modelRes] = await Promise.all([
        fetch(xform('/api/deep-learning/progress')),
        fetch(xform('/api/deep-learning/model-info')),
      ]);

      const progressData = await progressRes.json();
      const modelData = await modelRes.json();

      if (progressData.success) setProgress(progressData.progress);
      if (modelData.success) setModelInfo(modelData);
    } catch (error) {
      console.error('Error fetching deep learning data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 5 seconds if running
    const interval = setInterval(() => {
      if (progress.status === 'running') {
        fetchData();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchData, progress.status]);

  const startLearning = async () => {
    try {
      const res = await fetch(xform('/api/deep-learning/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.success) {
        setTimeout(fetchData, 1000);
      }
    } catch (error) {
      console.error('Error starting learning:', error);
    }
  };

  const stopLearning = async () => {
    try {
      const res = await fetch(xform('/api/deep-learning/stop'), { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (error) {
      console.error('Error stopping learning:', error);
    }
  };

  const testSignal = async () => {
    try {
      const res = await fetch(xform(`/api/deep-learning/signal/${testSymbol}`));
      const data = await res.json();
      if (data.success) {
        setSignal(data);
      }
    } catch (error) {
      console.error('Error getting signal:', error);
    }
  };

  const getStatusBadge = () => {
    switch (progress.status) {
      case 'running':
        return <Badge className="bg-green-500 animate-pulse">جاري التعلّم</Badge>;
      case 'completed':
        return <Badge className="bg-blue-500">مكتمل</Badge>;
      case 'error':
        return <Badge variant="destructive">خطأ</Badge>;
      case 'not_installed':
        return <Badge variant="secondary">غير مثبت</Badge>;
      default:
        return <Badge variant="outline">في الانتظار</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2">جاري تحميل بيانات التعلّم العميق...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Brain className="w-10 h-10 text-primary animate-pulse" />
            نظام التعلّم العميق
            <Badge variant="secondary" className="text-sm">v2.0</Badge>
          </h1>
          <p className="text-muted-foreground mt-1">
            Bayesian Optimization + Deep Neural Networks للبورصة المصرية
          </p>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge()}
          <Button onClick={fetchData} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">التجارب</p>
                <p className="text-2xl font-bold">{progress.current_trial}/{progress.total_trials}</p>
              </div>
              <Activity className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">أفضل نتيجة</p>
                <p className="text-2xl font-bold">{(progress.best_score * 100).toFixed(1)}%</p>
              </div>
              <Target className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">حالة النموذج</p>
                <p className="text-lg font-bold">{modelInfo.model_exists ? 'مدرب' : 'غير مدرب'}</p>
              </div>
              <Cpu className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">الأسهم المتاحة</p>
                <p className="text-2xl font-bold">452</p>
              </div>
              <Database className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Bar */}
      {progress.status === 'running' && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <RefreshCw className="w-6 h-6 animate-spin text-green-500" />
              <div className="flex-1">
                <div className="flex justify-between mb-2">
                  <span className="font-medium">{progress.message}</span>
                  <span>{Math.round((progress.current_trial / progress.total_trials) * 100)}%</span>
                </div>
                <Progress value={(progress.current_trial / progress.total_trials) * 100} className="h-3" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="control">
            <Settings className="w-4 h-4 ml-2" />
            التحكم
          </TabsTrigger>
          <TabsTrigger value="results">
            <BarChart3 className="w-4 h-4 ml-2" />
            النتائج
          </TabsTrigger>
          <TabsTrigger value="signals">
            <Zap className="w-4 h-4 ml-2" />
            الإشارات
          </TabsTrigger>
          <TabsTrigger value="model">
            <Cpu className="w-4 h-4 ml-2" />
            النموذج
          </TabsTrigger>
        </TabsList>

        {/* Control Tab */}
        <TabsContent value="control" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  إعدادات التعلّم
                </CardTitle>
                <CardDescription>تحديد معلمات Bayesian Optimization</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>هدف معدل النجاح: {config.target_win_rate}%</Label>
                  </div>
                  <Slider
                    value={[config.target_win_rate]}
                    onValueChange={([v]) => setConfig({ ...config, target_win_rate: v })}
                    min={50}
                    max={90}
                    step={5}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>عدد التجارب: {config.n_trials}</Label>
                  </div>
                  <Slider
                    value={[config.n_trials]}
                    onValueChange={([v]) => setConfig({ ...config, n_trials: v })}
                    min={10}
                    max={200}
                    step={10}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>الحد الأدنى للبيانات: {config.min_data_points}</Label>
                  </div>
                  <Slider
                    value={[config.min_data_points]}
                    onValueChange={([v]) => setConfig({ ...config, min_data_points: v })}
                    min={50}
                    max={300}
                    step={25}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Play className="w-5 h-5" />
                  التحكم في التعلّم
                </CardTitle>
                <CardDescription>بدء أو إيقاف عملية التعلّم</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Button
                    onClick={startLearning}
                    disabled={progress.status === 'running'}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    <Play className="w-4 h-4 ml-2" />
                    بدء التعلّم
                  </Button>
                  <Button
                    onClick={stopLearning}
                    disabled={progress.status !== 'running'}
                    variant="destructive"
                    className="flex-1"
                  >
                    <Square className="w-4 h-4 ml-2" />
                    إيقاف
                  </Button>
                </div>

                <div className="p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">التقنيات المستخدمة:</h4>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Bayesian Optimization (Optuna)
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      XGBoost / LightGBM
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Cross-Validation (5-Fold)
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Feature Engineering (18 features)
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Results Tab */}
        <TabsContent value="results" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LineChart className="w-5 h-5" />
                تاريخ التحسين
              </CardTitle>
            </CardHeader>
            <CardContent>
              {progress.history.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>لا توجد نتائج بعد</p>
                  <p className="text-sm">ابدأ التعلّم لرؤية النتائج</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {progress.history.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">Trial {item.trial}</Badge>
                        <span className="font-medium">{(item.score * 100).toFixed(1)}%</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {item.params.model_type || 'N/A'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Best Parameters */}
          {Object.keys(progress.best_params).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-green-500" />
                  أفضل المعلمات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(progress.best_params).map(([key, value]) => (
                    <div key={key} className="p-3 bg-green-500/10 rounded-lg">
                      <p className="text-sm text-muted-foreground">{key}</p>
                      <p className="font-bold">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Signals Tab */}
        <TabsContent value="signals" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5" />
                اختبار الإشارات
              </CardTitle>
              <CardDescription>احصل على إشارة تداول متقدمة</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Input
                  value={testSymbol}
                  onChange={(e) => setTestSymbol(e.target.value.toUpperCase())}
                  placeholder="رمز السهم"
                  className="w-32"
                />
                <Button onClick={testSignal}>
                  <Zap className="w-4 h-4 ml-2" />
                  احصل على إشارة
                </Button>
              </div>

              {signal && (
                <div className="p-6 bg-muted rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold">{testSymbol}</span>
                      <Badge
                        className={
                          signal.signal === 'buy' ? 'bg-green-500' :
                          signal.signal === 'sell' ? 'bg-red-500' : 'bg-gray-500'
                        }
                      >
                        {signal.signal === 'buy' ? 'شراء' :
                         signal.signal === 'sell' ? 'بيع' : 'انتظار'}
                      </Badge>
                    </div>
                    <div className="text-left">
                      <p className="text-sm text-muted-foreground">الثقة</p>
                      <p className="text-xl font-bold">{(signal.confidence * 100).toFixed(0)}%</p>
                    </div>
                  </div>

                  {signal.indicators && (
                    <div className="grid grid-cols-3 gap-3">
                      {Object.entries(signal.indicators).map(([name, data]) => (
                        <div key={name} className="p-3 bg-background rounded">
                          <p className="font-medium">{name.toUpperCase()}</p>
                          <p className={`text-sm ${data.action === 'buy' ? 'text-green-500' : data.action === 'sell' ? 'text-red-500' : 'text-gray-500'}`}>
                            {data.action}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {signal.price && (
                    <div className="mt-4 flex justify-between text-sm">
                      <span>السعر: {signal.price.toFixed(2)} جنيه</span>
                      <span>RSI: {signal.rsi?.toFixed(1)}</span>
                      <span>MACD: {signal.macd?.toFixed(4)}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Model Tab */}
        <TabsContent value="model" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="w-5 h-5" />
                معلومات النموذج
              </CardTitle>
            </CardHeader>
            <CardContent>
              {modelInfo.model_exists ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg">
                    <CheckCircle className="w-8 h-8 text-green-500" />
                    <div>
                      <p className="font-bold text-lg">النموذج جاهز للاستخدام</p>
                      <p className="text-sm text-muted-foreground">
                        تم التدريب: {modelInfo.timestamp}
                      </p>
                    </div>
                  </div>

                  {modelInfo.params && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {Object.entries(modelInfo.params).map(([key, value]) => (
                        <div key={key} className="p-3 bg-muted rounded-lg">
                          <p className="text-sm text-muted-foreground">{key}</p>
                          <p className="font-medium">{String(value)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Cpu className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>لا يوجد نموذج مدرب</p>
                  <p className="text-sm">ابدأ التعلّم لإنشاء النموذج</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
