'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Clock,
  BookOpen,
  Target,
  Shield,
  Activity,
  RefreshCw,
  XCircle,
  AlertCircle,
  Bug,
  Terminal,
  Database,
  Server,
} from 'lucide-react';

// ==================== TYPES ====================

interface SelfLearningStats {
  signals: { total: number; executed: number; pending: number };
  trades: { total: number; open: number; closed: number };
  outcomes: { wins: number; losses: number; win_rate: number; avg_profit: number; avg_loss: number };
  indicators: { active: number; reflection: number; disabled: number };
  lessons: { testing: number; validated: number; rejected: number };
}

interface IndicatorTrustScore {
  id: number;
  indicator_name: string;
  current_score: number;
  base_score: number;
  total_signals: number;
  successful_signals: number;
  failed_signals: number;
  consecutive_losses: number;
  status: 'active' | 'reflection' | 'disabled';
  last_updated: string;
}

interface LearnedLesson {
  id: number;
  lesson_type: 'direct' | 'compound' | 'environmental';
  title: string;
  description: string;
  action: string;
  confidence: number;
  occurrences: number;
  status: 'testing' | 'validated' | 'rejected';
}

interface DebugLog {
  timestamp: string;
  action: string;
  url: string;
  status: 'pending' | 'success' | 'error';
  duration?: number;
  response?: any;
  error?: string;
}

// ==================== HELPERS ====================

const safeNum = (val: any, defaultVal: number = 0): number => {
  if (val === undefined || val === null || isNaN(Number(val))) return defaultVal;
  return Number(val);
};

const safeToFixed = (val: any, decimals: number = 1, defaultVal: string = '0'): string => {
  if (val === undefined || val === null || isNaN(Number(val))) return defaultVal;
  return Number(val).toFixed(decimals);
};

// Use server-side API proxy instead of direct Python connection to avoid CORS

// ==================== MAIN COMPONENT ====================

export function SelfLearningView() {
  const [stats, setStats] = useState<SelfLearningStats | null>(null);
  const [indicators, setIndicators] = useState<IndicatorTrustScore[]>([]);
  const [lessons, setLessons] = useState<LearnedLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('debug');
  const [tradingStatus, setTradingStatus] = useState<{ can_trade: boolean; halt_reason?: string }>({ can_trade: true });
  
  // Debug state
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [pythonHealth, setPythonHealth] = useState<any>(null);
  const [rawResponse, setRawResponse] = useState<any>(null);

  const addLog = (log: Omit<DebugLog, 'timestamp'>) => {
    setDebugLogs(prev => [...prev.slice(-19), { ...log, timestamp: new Date().toISOString() }]);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setDebugLogs([]);
    
    // 1. Check Python Health via server-side API (avoids CORS)
    addLog({ action: 'HEALTH CHECK', url: '/api/market/connections', status: 'pending' });
    const healthStart = Date.now();
    try {
      const healthRes = await fetch('/api/market/connections');
      const healthData = await healthRes.json();
      const vpsOk = healthData?.sources?.vps_python?.available === true;
      if (vpsOk) {
        setPythonHealth({ status: 'ok', latency: healthData?.sources?.vps_python?.latency_ms });
        addLog({
          action: 'HEALTH CHECK',
          url: '/api/market/connections',
          status: 'success',
          duration: Date.now() - healthStart,
          response: healthData?.sources?.vps_python
        });
      } else {
        setPythonHealth(null);
        addLog({
          action: 'HEALTH CHECK',
          url: '/api/market/connections',
          status: 'error',
          duration: Date.now() - healthStart,
          error: healthData?.sources?.vps_python?.message || 'Not available'
        });
      }
    } catch (err: any) {
      addLog({
        action: 'HEALTH CHECK',
        url: '/api/market/connections',
        status: 'error',
        duration: Date.now() - healthStart,
        error: err.message
      });
    }

    // 2. Fetch Stats
    const statsUrl = '/api/self-learning?action=stats';
    addLog({ action: 'FETCH STATS', url: statsUrl, status: 'pending' });
    const statsStart = Date.now();
    try {
      const statsRes = await fetch(statsUrl);
      const statsData = await statsRes.json();
      setRawResponse(statsData);
      addLog({
        action: 'FETCH STATS',
        url: statsUrl,
        status: statsData.success ? 'success' : 'error',
        duration: Date.now() - statsStart,
        response: statsData
      });
      if (statsData.success) setStats(statsData.data);
    } catch (err: any) {
      addLog({
        action: 'FETCH STATS',
        url: statsUrl,
        status: 'error',
        duration: Date.now() - statsStart,
        error: err.message
      });
    }

    // 3. Fetch Indicators
    const indicatorsUrl = '/api/self-learning?action=indicators';
    addLog({ action: 'FETCH INDICATORS', url: indicatorsUrl, status: 'pending' });
    try {
      const indicatorsRes = await fetch(indicatorsUrl);
      const indicatorsData = await indicatorsRes.json();
      addLog({
        action: 'FETCH INDICATORS',
        url: indicatorsUrl,
        status: indicatorsData.success ? 'success' : 'error',
        duration: Date.now() - statsStart,
        response: indicatorsData.data?.slice?.(0, 2) || indicatorsData
      });
      if (indicatorsData.success) setIndicators(indicatorsData.data || []);
    } catch (err: any) {
      addLog({
        action: 'FETCH INDICATORS',
        url: indicatorsUrl,
        status: 'error',
        error: err.message
      });
    }

    // 4. Fetch Lessons
    const lessonsUrl = '/api/self-learning?action=lessons';
    addLog({ action: 'FETCH LESSONS', url: lessonsUrl, status: 'pending' });
    try {
      const lessonsRes = await fetch(lessonsUrl);
      const lessonsData = await lessonsRes.json();
      addLog({
        action: 'FETCH LESSONS',
        url: lessonsUrl,
        status: lessonsData.success ? 'success' : 'error',
        response: { count: lessonsData.data?.length || 0, first: lessonsData.data?.[0] }
      });
      if (lessonsData.success) setLessons(lessonsData.data || []);
    } catch (err: any) {
      addLog({
        action: 'FETCH LESSONS',
        url: lessonsUrl,
        status: 'error',
        error: err.message
      });
    }

    // 5. Fetch Trading Status
    try {
      const statusRes = await fetch('/api/self-learning?action=trading-status');
      const statusData = await statusRes.json();
      if (statusData.success) setTradingStatus(statusData.data);
    } catch (err) {
      console.error('Error fetching trading status:', err);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Brain className="w-8 h-8 text-primary" />
            نظام التعلّم الذاتي
          </h1>
          <p className="text-muted-foreground mt-1">
            المرحلة الثانية - تعلّم من الأخطاء وتحسين الأداء تلقائياً
          </p>
        </div>
        <Button onClick={fetchData} variant="outline">
          <RefreshCw className={`w-4 h-4 ml-2 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      {/* Debug Panel - ALWAYS VISIBLE */}
      <Card className="border-2 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-yellow-700">
            <Bug className="w-5 h-5" />
            Debug Terminal - لوحة التشخيص
          </CardTitle>
          <CardDescription>
            الاتصال عبر Server-side API (تجنب CORS)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Python Health Status */}
          <div className="mb-4 p-3 bg-white dark:bg-gray-900 rounded-lg border">
            <div className="flex items-center gap-2 mb-2">
              <Server className="w-4 h-4" />
              <span className="font-bold">حالة الباكند البايثون:</span>
              {pythonHealth ? (
                <Badge variant="default" className="bg-green-500">متصل ✓</Badge>
              ) : (
                <Badge variant="destructive">غير متصل ✗</Badge>
              )}
            </div>
            {pythonHealth && (
              <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-32">
                {JSON.stringify(pythonHealth, null, 2)}
              </pre>
            )}
          </div>

          {/* API Calls Log */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-bold">
              <Terminal className="w-4 h-4" />
              سجل استدعاءات API:
            </div>
            <div className="bg-gray-900 text-green-400 p-3 rounded-lg font-mono text-sm max-h-64 overflow-auto">
              {debugLogs.length === 0 ? (
                <span className="text-gray-500">في انتظار البيانات...</span>
              ) : (
                debugLogs.map((log, idx) => (
                  <div key={idx} className={`mb-2 pb-2 border-b border-gray-700 ${log.status === 'error' ? 'text-red-400' : log.status === 'success' ? 'text-green-400' : 'text-yellow-400'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">[{log.timestamp.split('T')[1]?.slice(0, 8)}]</span>
                      <span className="text-cyan-400">{log.action}</span>
                      <span className={`px-1 rounded ${log.status === 'success' ? 'bg-green-900' : log.status === 'error' ? 'bg-red-900' : 'bg-yellow-900'}`}>
                        {log.status.toUpperCase()}
                      </span>
                      {log.duration && <span className="text-gray-500">({log.duration}ms)</span>}
                    </div>
                    <div className="text-gray-400 text-xs truncate">{log.url}</div>
                    {log.error && <div className="text-red-500 text-xs mt-1">ERROR: {log.error}</div>}
                    {log.response && (
                      <pre className="text-xs text-gray-300 mt-1 bg-gray-800 p-1 rounded overflow-auto max-h-20">
                        {typeof log.response === 'string' ? log.response : JSON.stringify(log.response, null, 1).slice(0, 300)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Overview - BIG NUMBERS */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-2">
            <CardHeader className="pb-2">
              <CardDescription>الإشارات</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{stats.signals.total.toLocaleString()}</div>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline">{stats.signals.executed} منفذة</Badge>
                <Badge variant="secondary">{stats.signals.pending} معلقة</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2">
            <CardHeader className="pb-2">
              <CardDescription>الصفقات</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">{stats.trades.total.toLocaleString()}</div>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline">{stats.trades.open} مفتوحة</Badge>
                <Badge variant="secondary">{stats.trades.closed} مغلقة</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-2 ${safeNum(stats?.outcomes?.win_rate) >= 55 ? 'border-green-500' : 'border-red-500'}`}>
            <CardHeader className="pb-2">
              <CardDescription>معدل النجاح</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold flex items-center gap-2">
                <span className={safeNum(stats?.outcomes?.win_rate) >= 55 ? 'text-green-600' : 'text-red-600'}>
                  {safeToFixed(stats?.outcomes?.win_rate, 1)}%
                </span>
                {safeNum(stats?.outcomes?.win_rate) >= 55 ? (
                  <TrendingUp className="w-6 h-6 text-green-500" />
                ) : (
                  <TrendingDown className="w-6 h-6 text-red-500" />
                )}
              </div>
              <div className="flex gap-2 mt-1 text-sm">
                <span className="text-green-600">{stats.outcomes.wins} رابحة</span>
                <span className="text-red-600">{stats.outcomes.losses} خاسرة</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2">
            <CardHeader className="pb-2">
              <CardDescription>الدروس المستفادة</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-600">{stats.lessons.validated}</div>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline">{stats.lessons.testing} اختبار</Badge>
                <Badge variant="destructive">{stats.lessons.rejected} مرفوض</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Raw Response - للتشخيص */}
      {rawResponse && (
        <Card className="border border-gray-300">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="w-4 h-4" />
              Raw API Response (للتشخيص)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-gray-100 dark:bg-gray-900 p-3 rounded overflow-auto max-h-40 font-mono">
              {JSON.stringify(rawResponse, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Trading Status Alert */}
      {!tradingStatus.can_trade && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="w-6 h-6 text-red-500" />
            <div>
              <p className="font-bold text-red-700">التداول متوقف!</p>
              <p className="text-red-600">السبب: {tradingStatus.halt_reason}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="debug">
            <Bug className="w-4 h-4 ml-1" />
            تشخيص
          </TabsTrigger>
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="indicators">المؤشرات</TabsTrigger>
          <TabsTrigger value="lessons">الدروس</TabsTrigger>
        </TabsList>

        {/* Debug Tab */}
        <TabsContent value="debug" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                اختبار اتصال مباشر بالباكند
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Button
                  onClick={async () => {
                    addLog({ action: 'API TEST', url: '/api/self-learning?action=status', status: 'pending' });
                    try {
                      const res = await fetch('/api/self-learning?action=status');
                      const data = await res.json();
                      addLog({ action: 'API TEST', url: '/api/self-learning?action=status', status: 'success', response: data });
                    } catch (err: any) {
                      addLog({ action: 'API TEST', url: '/api/self-learning?action=status', status: 'error', error: err.message });
                    }
                  }}
                  variant="outline"
                  className="gap-2"
                >
                  <Server className="w-4 h-4" />
                  اختبار Learning Status
                </Button>

                <Button
                  onClick={async () => {
                    addLog({ action: 'API TEST', url: '/api/market/connections', status: 'pending' });
                    try {
                      const res = await fetch('/api/market/connections');
                      const data = await res.json();
                      addLog({ action: 'API TEST', url: '/api/market/connections', status: 'success', response: data?.sources });
                    } catch (err: any) {
                      addLog({ action: 'API TEST', url: '/api/market/connections', status: 'error', error: err.message });
                    }
                  }}
                  variant="outline"
                  className="gap-2"
                >
                  <Activity className="w-4 h-4" />
                  اختبار Connections
                </Button>

                <Button
                  onClick={async () => {
                    addLog({ action: 'API TEST', url: '/api/admin/stats', status: 'pending' });
                    try {
                      const res = await fetch('/api/admin/stats');
                      const data = await res.json();
                      addLog({ action: 'API TEST', url: '/api/admin/stats', status: 'success', response: { stocks: data?.stocks?.total, users: data?.users?.total } });
                    } catch (err: any) {
                      addLog({ action: 'API TEST', url: '/api/admin/stats', status: 'error', error: err.message });
                    }
                  }}
                  variant="outline"
                  className="gap-2"
                >
                  <Database className="w-4 h-4" />
                  اختبار Stats
                </Button>

                <Button
                  onClick={async () => {
                    addLog({ action: 'API TEST', url: '/api/v2/scan', status: 'pending' });
                    try {
                      const res = await fetch('/api/v2/scan');
                      const data = await res.json();
                      addLog({ action: 'API TEST', url: '/api/v2/scan', status: 'success', response: { count: data?.signals?.length || 0 } });
                    } catch (err: any) {
                      addLog({ action: 'API TEST', url: '/api/v2/scan', status: 'error', error: err.message });
                    }
                  }}
                  variant="outline"
                  className="gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  اختبار Scanner
                </Button>
              </div>

              {/* Environment Info */}
              <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-900 rounded-lg">
                <h4 className="font-bold mb-2">معلومات البيئة:</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>API Mode: <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">Server-side Proxy</code></div>
                  <div>NODE_ENV: <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">{process.env.NODE_ENV}</code></div>
                  <div>Next.js Port: <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">3000</code></div>
                  <div>Python Backend: <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">VPS YOUR_VPS_IP:8010</code></div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {stats && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    تحليل الأداء
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span>معدل النجاح</span>
                      <span className="font-bold">{safeToFixed(stats?.outcomes?.win_rate, 1)}%</span>
                    </div>
                    <Progress value={safeNum(stats?.outcomes?.win_rate)} className="h-3" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                      <p className="text-sm text-muted-foreground">متوسط الربح</p>
                      <p className="text-xl font-bold text-green-600">
                        +{safeToFixed(stats?.outcomes?.avg_profit, 2)}%
                      </p>
                    </div>
                    <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
                      <p className="text-sm text-muted-foreground">متوسط الخسارة</p>
                      <p className="text-xl font-bold text-red-600">
                        -{safeToFixed(stats?.outcomes?.avg_loss, 2)}%
                      </p>
                    </div>
                  </div>

                  <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <p className="text-sm text-muted-foreground">الدروس المستفادة</p>
                    <div className="flex gap-2 mt-1">
                      <Badge>{stats.lessons.testing} قيد الاختبار</Badge>
                      <Badge variant="default" className="bg-green-500">{stats.lessons.validated} معتمدة</Badge>
                      <Badge variant="destructive">{stats.lessons.rejected} مرفوضة</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Indicators Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  حالة المؤشرات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {indicators.slice(0, 6).map((ind) => (
                    <div key={ind.indicator_name} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900 rounded">
                      <span className="font-medium">{ind.indicator_name}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{ind.current_score}</span>
                        <Badge variant={ind.status === 'active' ? 'default' : ind.status === 'reflection' ? 'secondary' : 'destructive'}>
                          {ind.status === 'active' ? 'نشط' : ind.status === 'reflection' ? 'تأمل' : 'معطل'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Indicators Tab */}
        <TabsContent value="indicators" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                درجات الثقة للمؤشرات
              </CardTitle>
              <CardDescription>
                كل مؤشر لديه "رصيد ثقة" يتغير بناءً على الأداء
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {indicators.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    لا توجد بيانات مؤشرات
                  </div>
                ) : (
                  indicators.map((indicator) => (
                    <div key={indicator.indicator_name} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-lg">{indicator.indicator_name}</span>
                          <Badge
                            variant={
                              indicator.status === 'active' ? 'default' :
                              indicator.status === 'reflection' ? 'secondary' : 'destructive'
                            }
                          >
                            {indicator.status === 'active' ? 'نشط' :
                             indicator.status === 'reflection' ? 'في التأمل' : 'معطل'}
                          </Badge>
                        </div>
                        <span className="text-2xl font-bold">
                          {safeToFixed(indicator?.current_score, 0)}
                        </span>
                      </div>

                      <Progress
                        value={safeNum(indicator?.current_score)}
                        max={200}
                        className="h-2 mb-2"
                      />

                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>{indicator.successful_signals} نجاح / {indicator.failed_signals} فشل</span>
                        <span>
                          {indicator.consecutive_losses > 0 && (
                            <span className="text-red-500">
                              {indicator.consecutive_losses} خسائر متتالية
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Lessons Tab */}
        <TabsContent value="lessons" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                الدروس المستفادة ({lessons.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lessons.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>لا توجد دروس مستفادة بعد</p>
                  <p className="text-sm">سيتم استخراج الدروس تلقائياً بعد تراكم الصفقات</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {lessons.map((lesson) => (
                    <div key={lesson.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <Badge
                            variant={
                              lesson.lesson_type === 'direct' ? 'default' :
                              lesson.lesson_type === 'compound' ? 'secondary' : 'outline'
                            }
                            className="mb-2"
                          >
                            {lesson.lesson_type === 'direct' ? 'مباشر' :
                             lesson.lesson_type === 'compound' ? 'مركب' : 'بيئي'}
                          </Badge>
                          <h3 className="font-bold">{lesson.title}</h3>
                        </div>
                        <Badge
                          variant={
                            lesson.status === 'validated' ? 'default' :
                            lesson.status === 'testing' ? 'secondary' : 'destructive'
                          }
                        >
                          {lesson.status === 'validated' ? 'معتمد' :
                           lesson.status === 'testing' ? 'قيد الاختبار' : 'مرفوض'}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground">{lesson.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
