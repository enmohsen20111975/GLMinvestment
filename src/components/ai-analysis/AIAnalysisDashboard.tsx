'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  RefreshCw, Brain, TrendingUp, TrendingDown, Minus, 
  AlertCircle, CheckCircle, Clock, Loader2, Sparkles,
  Target, Shield, Zap, Play, Square, Settings, Newspaper,
  Server, Activity, Search, Database
} from 'lucide-react';
import { toast } from 'sonner';

// Types
interface AIRecommendation {
  ticker: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  price_target: number | null;
  stop_loss: number | null;
  reasons: string[];
  technical_analysis: string;
  fundamental_analysis: string;
  news_impact: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  time_horizon: 'SHORT' | 'MEDIUM' | 'LONG';
  timestamp: string;
}

interface AIHealth {
  status: string;
  ollama_available: boolean;
  lmstudio_available: boolean;
  ai_available: boolean;
  ai_type: string;
  model: string;
  last_analysis: string | null;
  scheduler_running: boolean;
}

interface SchedulerStatus {
  is_running: boolean;
  last_run: string | null;
  next_run: string | null;
  total_runs: number;
  model: string;
}

interface AIModel {
  name: string;
  type: string;
  size: number;
}

interface NewsItem {
  title: string;
  source: string;
  relevance: string;
  sentiment: string;
  affected_sectors: string[];
  summary: string;
}

// AI Service URL
const AI_SERVICE_URL = '/api/ai-proxy';

export function AIAnalysisDashboard() {
  // State
  const [health, setHealth] = useState<AIHealth | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [models, setModels] = useState<AIModel[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('control');
  
  // Config state
  const [selectedModel, setSelectedModel] = useState('glm-4-flash');
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [tickerInput, setTickerInput] = useState('');
  const [newsQuery, setNewsQuery] = useState('EGX');

  // Fetch AI health
  const fetchHealth = useCallback(async () => {
    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/ai/health`);
      const data = await response.json();
      setHealth(data);
    } catch (error) {
      console.error('Failed to fetch AI health:', error);
      setHealth({
        status: 'error',
        ollama_available: false,
        lmstudio_available: false,
        ai_available: false,
        ai_type: 'none',
        model: 'unknown',
        last_analysis: null,
        scheduler_running: false
      });
    }
  }, []);

  // Fetch scheduler status
  const fetchSchedulerStatus = useCallback(async () => {
    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/ai/status`);
      const data = await response.json();
      setSchedulerStatus(data);
    } catch (error) {
      console.error('Failed to fetch scheduler status:', error);
    }
  }, []);

  // Fetch recommendations
  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/ai/recommendations?limit=20`);
      const data = await response.json();
      if (data.success) {
        setRecommendations(data.results || []);
      }
    } catch (error) {
      console.error('Failed to fetch recommendations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch available models
  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/ai/models`);
      const data = await response.json();
      setModels(data.models || []);
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  }, []);

  // Start scheduler
  const startScheduler = async () => {
    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/ai/scheduler/start`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        toast.success('تم تشغيل الجدولة');
        fetchSchedulerStatus();
        fetchHealth();
      } else {
        toast.error(data.message || 'فشل التشغيل');
      }
    } catch (error) {
      toast.error('خطأ في الاتصال');
    }
  };

  // Stop scheduler
  const stopScheduler = async () => {
    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/ai/scheduler/stop`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        toast.success('تم إيقاف الجدولة');
        fetchSchedulerStatus();
        fetchHealth();
      } else {
        toast.error(data.message || 'فشل الإيقاف');
      }
    } catch (error) {
      toast.error('خطأ في الاتصال');
    }
  };

  // Update config
  const updateConfig = async () => {
    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/ai/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          interval_minutes: intervalMinutes
        })
      });
      const data = await response.json();
      if (data.success) {
        toast.success('تم تحديث الإعدادات');
        fetchHealth();
      }
    } catch (error) {
      toast.error('فشل تحديث الإعدادات');
    }
  };

  // Run analysis manually
  const runAnalysis = async (tickers?: string[]) => {
    setLoading(true);
    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/ai/run-hourly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers })
      });
      const data = await response.json();
      if (data.success) {
        toast.success(`تم تحليل ${data.analyzed_count} سهم بنجاح`);
        fetchRecommendations();
        fetchSchedulerStatus();
      } else {
        toast.error('فشل في التحليل');
      }
    } catch (error) {
      toast.error('خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  };

  // Analyze single stock
  const analyzeStock = async (ticker: string) => {
    setAnalyzing(ticker);
    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/ai/analyze/${ticker}`);
      const data = await response.json();
      if (data.action) {
        toast.success(`تحليل ${ticker}: ${data.action}`);
        fetchRecommendations();
      }
    } catch (error) {
      toast.error('فشل التحليل');
    } finally {
      setAnalyzing(null);
    }
  };

  // Search news
  const searchNews = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/ai/news/search?query=${encodeURIComponent(newsQuery)}`);
      const data = await response.json();
      if (data.success && data.headlines) {
        setNews(data.headlines);
        toast.success(`تم العثور على ${data.headlines.length} خبر`);
      } else {
        setNews([]);
        toast.info('لا توجد أخبار');
      }
    } catch (error) {
      toast.error('فشل البحث');
    } finally {
      setLoading(false);
    }
  };

  // Run custom tickers analysis
  const runCustomAnalysis = () => {
    const tickers = tickerInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (tickers.length > 0) {
      runAnalysis(tickers);
    } else {
      toast.error('أدخل رموز الأسهم');
    }
  };

  // Initial load
  useEffect(() => {
    // Run initial data fetch
    let mounted = true;
    
    const loadInitialData = async () => {
      if (!mounted) return;
      await Promise.all([
        fetchHealth(),
        fetchSchedulerStatus(),
        fetchRecommendations(),
        fetchModels()
      ]);
    };
    
    loadInitialData();
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      if (mounted) {
        fetchHealth();
        fetchSchedulerStatus();
      }
    }, 30000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Action badge color
  const getActionBadge = (action: string) => {
    switch (action) {
      case 'BUY':
        return <Badge className="bg-green-500 text-white gap-1"><TrendingUp className="w-3 h-3" /> شراء</Badge>;
      case 'SELL':
        return <Badge className="bg-red-500 text-white gap-1"><TrendingDown className="w-3 h-3" /> بيع</Badge>;
      default:
        return <Badge className="bg-gray-500 text-white gap-1"><Minus className="w-3 h-3" /> انتظار</Badge>;
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Brain className="w-8 h-8 text-emerald-500" />
          <div>
            <h2 className="text-2xl font-bold">التحليل المتقدم</h2>
            <p className="text-muted-foreground text-sm">نظام تحليل الاستثمار المتقدم</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          {/* AI Status */}
          {health && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted">
              {health.ai_available ? (
                <><CheckCircle className="w-4 h-4 text-green-500" /><span className="text-sm">النظام متصل</span></>
              ) : (
                <><AlertCircle className="w-4 h-4 text-red-500" /><span className="text-sm">النظام غير متصل</span></>
              )}
            </div>
          )}
          
          <Button onClick={() => runAnalysis()} disabled={loading || !health?.ai_available}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="mr-2">تحليل جديد</span>
          </Button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* AI Status Card */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Server className={`w-8 h-8 ${health?.ai_available ? 'text-green-500' : 'text-red-500'}`} />
              <div>
                <p className="text-sm text-muted-foreground">حالة النظام</p>
                <p className="font-bold">{health?.ai_available ? 'متصل' : 'غير متصل'}</p>
                <p className="text-xs text-muted-foreground">{health?.ai_type || 'none'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scheduler Status */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Activity className={`w-8 h-8 ${schedulerStatus?.is_running ? 'text-green-500' : 'text-gray-400'}`} />
              <div>
                <p className="text-sm text-muted-foreground">الجدولة</p>
                <p className="font-bold">{schedulerStatus?.is_running ? 'تعمل' : 'متوقفة'}</p>
                <p className="text-xs text-muted-foreground">{schedulerStatus?.total_runs || 0} تحليل</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Model Info */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Sparkles className="w-8 h-8 text-purple-500" />
              <div>
                <p className="text-sm text-muted-foreground">النموذج</p>
                <p className="font-bold truncate">{health?.model || 'غير محدد'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recommendations Count */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Database className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-sm text-muted-foreground">التحليلات</p>
                <p className="font-bold">{recommendations.length}</p>
                <p className="text-xs text-muted-foreground">
                  شراء: {recommendations.filter(r => r.action === 'BUY').length} | 
                  بيع: {recommendations.filter(r => r.action === 'SELL').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="control" className="gap-2"><Settings className="w-4 h-4" /> التحكم</TabsTrigger>
          <TabsTrigger value="recommendations" className="gap-2"><Target className="w-4 w-4" /> التحليلات</TabsTrigger>
          <TabsTrigger value="news" className="gap-2"><Newspaper className="w-4 h-4" /> الأخبار</TabsTrigger>
          <TabsTrigger value="analysis" className="gap-2"><Activity className="w-4 h-4" /> التحليل</TabsTrigger>
        </TabsList>

        {/* Control Tab */}
        <TabsContent value="control" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Scheduler Control */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  التحكم في الجدولة
                </CardTitle>
                <CardDescription>تشغيل وإيقاف التحليل التلقائي</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div className="flex items-center gap-3">
                    {schedulerStatus?.is_running ? (
                      <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                    ) : (
                      <div className="w-3 h-3 rounded-full bg-gray-400" />
                    )}
                    <div>
                      <p className="font-medium">حالة الجدولة</p>
                      <p className="text-sm text-muted-foreground">
                        {schedulerStatus?.is_running ? 'تعمل الآن' : 'متوقفة'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    {!schedulerStatus?.is_running ? (
                      <Button onClick={startScheduler} className="gap-2">
                        <Play className="w-4 h-4" /> تشغيل
                      </Button>
                    ) : (
                      <Button onClick={stopScheduler} variant="destructive" className="gap-2">
                        <Square className="w-4 h-4" /> إيقاف
                      </Button>
                    )}
                  </div>
                </div>

                {schedulerStatus?.last_run && (
                  <div className="text-sm">
                    <p>آخر تحليل: {new Date(schedulerStatus.last_run).toLocaleString('ar-EG')}</p>
                    {schedulerStatus.next_run && (
                      <p>التحليل القادم: {new Date(schedulerStatus.next_run).toLocaleString('ar-EG')}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  إعدادات AI
                </CardTitle>
                <CardDescription>تكوين النموذج التحليلي الفني</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>نموذج AI</Label>
                  <Select value={selectedModel} onValueChange={setSelectedModel}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {models.length > 0 ? (
                        models.map(m => (
                          <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="glm-4-flash">glm-4-flash</SelectItem>
                          <SelectItem value="llama3.1">llama3.1</SelectItem>
                          <SelectItem value="deepseek-coder">deepseek-coder</SelectItem>
                          <SelectItem value="qwen2.5">qwen2.5</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>فترة التحليل (دقائق)</Label>
                  <Select value={String(intervalMinutes)} onValueChange={(v) => setIntervalMinutes(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 دقيقة</SelectItem>
                      <SelectItem value="60">ساعة</SelectItem>
                      <SelectItem value="120">ساعتين</SelectItem>
                      <SelectItem value="240">4 ساعات</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button onClick={updateConfig} className="w-full">حفظ الإعدادات</Button>
              </CardContent>
            </Card>

            {/* Manual Analysis */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="w-5 h-5" />
                  تحليل يدوي
                </CardTitle>
                <CardDescription>تحليل أسهم محددة</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>رموز الأسهم (مفصولة بفاصلة)</Label>
                  <Input 
                    placeholder="COMI, ETEL, TMGH..."
                    value={tickerInput}
                    onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                  />
                </div>
                <Button onClick={runCustomAnalysis} className="w-full gap-2" disabled={loading || !health?.ai_available}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  تحليل الأسهم
                </Button>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  إجراءات سريعة
                </CardTitle>
                <CardDescription>تحليلات سريعة</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-2"
                  onClick={() => runAnalysis()}
                  disabled={loading || !health?.ai_available}
                >
                  <Activity className="w-4 h-4" />
                  تحليل أهم المتحركات
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-2"
                  onClick={fetchRecommendations}
                  disabled={loading}
                >
                  <Database className="w-4 h-4" />
                  تحديث التحليلات
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-2"
                  onClick={() => { fetchHealth(); fetchSchedulerStatus(); fetchModels(); }}
                >
                  <Server className="w-4 h-4" />
                  تحديث الحالة
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* AI Not Available Warning */}
          {health && !health.ai_available && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>AI غير متصل</AlertTitle>
              <AlertDescription>
                يرجى تشغيل خادم التحليل لتفعيل التحليل الفني المتقدم.
                <br />
                <code className="text-xs bg-muted p-1 rounded mt-2 inline-block">
                  ollama serve
                </code>
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* Recommendations Tab */}
        <TabsContent value="recommendations" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">التحليلات المحفوظة</h3>
            <Button variant="outline" onClick={fetchRecommendations} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span className="mr-2">تحديث</span>
            </Button>
          </div>

          <ScrollArea className="h-[600px]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pr-4">
              {recommendations.map((rec, idx) => (
                <RecommendationCard 
                  key={idx} 
                  recommendation={rec} 
                  onAnalyze={analyzeStock} 
                  analyzing={analyzing} 
                />
              ))}
            </div>
          </ScrollArea>

          {recommendations.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">لا توجد تحليلات. اضغط "تحليل جديد" للبدء.</p>
            </Card>
          )}
        </TabsContent>

        {/* News Tab */}
        <TabsContent value="news" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5" />
                البحث عن الأخبار
              </CardTitle>
              <CardDescription>البحث عن أخبار السوق باستخدام AI</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input 
                  placeholder="البحث عن..."
                  value={newsQuery}
                  onChange={(e) => setNewsQuery(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={searchNews} disabled={loading || !health?.ai_available}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  <span className="mr-2">بحث</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {news.map((item, idx) => (
              <Card key={idx}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm">{item.title}</CardTitle>
                    <Badge variant={item.sentiment === 'إيجابي' ? 'default' : item.sentiment === 'سلبي' ? 'destructive' : 'secondary'}>
                      {item.sentiment}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-2">{item.summary}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{item.source}</Badge>
                    <Badge variant="outline">{item.relevance}</Badge>
                    {item.affected_sectors?.map((s, i) => (
                      <Badge key={i} variant="secondary">{s}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {news.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">أدخل كلمة بحث للعثور على الأخبار</p>
            </Card>
          )}
        </TabsContent>

        {/* Analysis Tab */}
        <TabsContent value="analysis" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>تحليل سهم محدد</CardTitle>
              <CardDescription>أدخل رمز السهم للتحليل</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input 
                  placeholder="رمز السهم (مثل: COMI)"
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                  className="flex-1"
                />
                <Button 
                  onClick={() => {
                    if (tickerInput) analyzeStock(tickerInput);
                  }}
                  disabled={!tickerInput || analyzing || !health?.ai_available}
                >
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                  <span className="mr-2">تحليل</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Analysis Result would show here */}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Recommendation Card Component
function RecommendationCard({ 
  recommendation, 
  onAnalyze, 
  analyzing 
}: { 
  recommendation: AIRecommendation;
  onAnalyze: (ticker: string) => void;
  analyzing: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-xl">{recommendation.ticker}</CardTitle>
            {recommendation.action === 'BUY' && (
              <Badge className="bg-green-500 text-white gap-1"><TrendingUp className="w-3 h-3" /> شراء</Badge>
            )}
            {recommendation.action === 'SELL' && (
              <Badge className="bg-red-500 text-white gap-1"><TrendingDown className="w-3 h-3" /> بيع</Badge>
            )}
            {recommendation.action === 'HOLD' && (
              <Badge className="bg-gray-500 text-white gap-1"><Minus className="w-3 h-3" /> انتظار</Badge>
            )}
          </div>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => onAnalyze(recommendation.ticker)}
            disabled={analyzing === recommendation.ticker}
          >
            {analyzing === recommendation.ticker ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Confidence */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span>مستوى الثقة</span>
            <span className="font-bold">{recommendation.confidence}%</span>
          </div>
          <Progress 
            value={recommendation.confidence} 
            className={`h-2 ${
              recommendation.confidence >= 70 ? '[&>div]:bg-green-500' : 
              recommendation.confidence >= 50 ? '[&>div]:bg-yellow-500' : '[&>div]:bg-red-500'
            }`}
          />
        </div>

        {/* Price targets row */}
        <div className="flex items-center gap-4 flex-wrap">
          {recommendation.price_target && (
            <div className="flex items-center gap-2 text-sm bg-green-50 dark:bg-green-950 px-3 py-1.5 rounded-lg">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <span>الهدف: <strong>{recommendation.price_target.toFixed(2)}</strong></span>
            </div>
          )}
          {recommendation.stop_loss && (
            <div className="flex items-center gap-2 text-sm bg-red-50 dark:bg-red-950 px-3 py-1.5 rounded-lg">
              <Shield className="w-4 h-4 text-red-600" />
              <span>وقف: <strong>{recommendation.stop_loss.toFixed(2)}</strong></span>
            </div>
          )}
        </div>

        {/* Reasons */}
        {recommendation.reasons && recommendation.reasons.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">الأسباب:</p>
            <ul className="space-y-1">
              {recommendation.reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Zap className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Expand button */}
        <Button 
          variant="ghost" 
          size="sm" 
          className="w-full"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
        </Button>

        {/* Expanded details */}
        {expanded && (
          <div className="space-y-3 pt-2 border-t">
            {recommendation.technical_analysis && (
              <div>
                <p className="text-sm font-medium mb-1">التحليل الفني:</p>
                <p className="text-sm text-muted-foreground">{recommendation.technical_analysis}</p>
              </div>
            )}
            {recommendation.fundamental_analysis && (
              <div>
                <p className="text-sm font-medium mb-1">التحليل الأساسي:</p>
                <p className="text-sm text-muted-foreground">{recommendation.fundamental_analysis}</p>
              </div>
            )}
            {recommendation.news_impact && (
              <div>
                <p className="text-sm font-medium mb-1">تأثير الأخبار:</p>
                <p className="text-sm text-muted-foreground">{recommendation.news_impact}</p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-2 flex-wrap">
            {recommendation.risk_level === 'LOW' && (
              <Badge variant="outline" className="border-green-500 text-green-500">مخاطرة منخفضة</Badge>
            )}
            {recommendation.risk_level === 'MEDIUM' && (
              <Badge variant="outline" className="border-yellow-500 text-yellow-600">مخاطرة متوسطة</Badge>
            )}
            {recommendation.risk_level === 'HIGH' && (
              <Badge variant="outline" className="border-red-500 text-red-500">مخاطرة عالية</Badge>
            )}
            {recommendation.time_horizon === 'SHORT' && <Badge variant="secondary">قصير</Badge>}
            {recommendation.time_horizon === 'MEDIUM' && <Badge variant="secondary">متوسط</Badge>}
            {recommendation.time_horizon === 'LONG' && <Badge variant="secondary">طويل</Badge>}
          </div>
          <span className="text-xs text-muted-foreground">
            <Clock className="w-3 h-3 inline mr-1" />
            {new Date(recommendation.timestamp).toLocaleString('ar-EG')}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default AIAnalysisDashboard;
