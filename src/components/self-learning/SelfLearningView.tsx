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

interface ExpectancyResult {
  indicator: string;
  regime: string;
  total_trades: number;
  win_rate: number;
  avg_win_percent: number;
  avg_loss_percent: number;
  expectancy: number;
  recommendation: string;
}

// ==================== MAIN COMPONENT ====================

export function SelfLearningView() {
  const [stats, setStats] = useState<SelfLearningStats | null>(null);
  const [indicators, setIndicators] = useState<IndicatorTrustScore[]>([]);
  const [lessons, setLessons] = useState<LearnedLesson[]>([]);
  const [expectancy, setExpectancy] = useState<ExpectancyResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [tradingStatus, setTradingStatus] = useState<{ can_trade: boolean; halt_reason?: string }>({ can_trade: true });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, indicatorsRes, lessonsRes, expectancyRes, statusRes] = await Promise.all([
        fetch('/api/self-learning?action=stats'),
        fetch('/api/self-learning?action=indicators'),
        fetch('/api/self-learning?action=lessons'),
        fetch('/api/self-learning?action=expectancy'),
        fetch('/api/self-learning?action=trading-status'),
      ]);

      const [statsData, indicatorsData, lessonsData, expectancyData, statusData] = await Promise.all([
        statsRes.json(),
        indicatorsRes.json(),
        lessonsRes.json(),
        expectancyRes.json(),
        statusRes.json(),
      ]);

      if (statsData.success) setStats(statsData.data);
      if (indicatorsData.success) setIndicators(indicatorsData.data);
      if (lessonsData.success) setLessons(lessonsData.data);
      if (expectancyData.success) setExpectancy(expectancyData.data);
      if (statusData.success) setTradingStatus(statusData.data);
    } catch (error) {
      console.error('Error fetching self-learning data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const runReview = async (type: 'daily' | 'weekly' | 'monthly') => {
    try {
      const res = await fetch('/api/self-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: `${type}-review` }),
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        fetchData();
      }
    } catch (error) {
      console.error('Error running review:', error);
    }
  };

  const mineNewLessons = async () => {
    try {
      const res = await fetch('/api/self-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mine-lessons' }),
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        fetchData();
      }
    } catch (error) {
      console.error('Error mining lessons:', error);
    }
  };

  const adjustWeights = async () => {
    try {
      const res = await fetch('/api/self-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adjust-weights' }),
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        fetchData();
      }
    } catch (error) {
      console.error('Error adjusting weights:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2">جاري تحميل بيانات التعلّم الذاتي...</span>
      </div>
    );
  }

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
          <RefreshCw className="w-4 h-4 ml-2" />
          تحديث
        </Button>
      </div>

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

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>الإشارات</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.signals.total}</div>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline">{stats.signals.executed} منفذة</Badge>
                <Badge variant="secondary">{stats.signals.pending} معلقة</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>الصفقات</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.trades.total}</div>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline">{stats.trades.open} مفتوحة</Badge>
                <Badge variant="secondary">{stats.trades.closed} مغلقة</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>معدل النجاح</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center gap-2">
                {stats.outcomes.win_rate.toFixed(1)}%
                {stats.outcomes.win_rate >= 55 ? (
                  <TrendingUp className="w-5 h-5 text-green-500" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-red-500" />
                )}
              </div>
              <div className="flex gap-2 mt-1 text-sm">
                <span className="text-green-600">{stats.outcomes.wins} رابحة</span>
                <span className="text-red-600">{stats.outcomes.losses} خاسرة</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>المؤشرات</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Badge variant="default" className="bg-green-500">
                  {stats.indicators.active} نشط
                </Badge>
                <Badge variant="secondary" className="bg-yellow-500 text-black">
                  {stats.indicators.reflection} تأمل
                </Badge>
                <Badge variant="destructive">
                  {stats.indicators.disabled} معطل
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="indicators">المؤشرات</TabsTrigger>
          <TabsTrigger value="lessons">الدروس</TabsTrigger>
          <TabsTrigger value="actions">الإجراءات</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Win/Loss Analysis */}
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
                      <span>{stats.outcomes.win_rate.toFixed(1)}%</span>
                    </div>
                    <Progress value={stats.outcomes.win_rate} className="h-3" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                      <p className="text-sm text-muted-foreground">متوسط الربح</p>
                      <p className="text-xl font-bold text-green-600">
                        +{stats.outcomes.avg_profit.toFixed(2)}%
                      </p>
                    </div>
                    <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
                      <p className="text-sm text-muted-foreground">متوسط الخسارة</p>
                      <p className="text-xl font-bold text-red-600">
                        -{stats.outcomes.avg_loss.toFixed(2)}%
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

            {/* Top Indicators by Expectancy */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  أفضل المؤشرات (Expectancy)
                </CardTitle>
                <CardDescription>القيمة المتوقعة لكل مؤشر</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {expectancy.slice(0, 5).map((exp, idx) => (
                    <div key={exp.indicator} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-muted-foreground">#{idx + 1}</span>
                        <span className="font-medium">{exp.indicator}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={exp.expectancy > 2 ? 'default' : exp.expectancy > 0 ? 'secondary' : 'destructive'}
                        >
                          {exp.expectancy.toFixed(2)}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {exp.win_rate.toFixed(0)}% نجاح
                        </span>
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
                {indicators.map((indicator) => (
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
                        {indicator.current_score.toFixed(0)}
                      </span>
                    </div>

                    <Progress
                      value={indicator.current_score}
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
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Lessons Tab */}
        <TabsContent value="lessons" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  الدروس المستفادة
                </CardTitle>
                <CardDescription>
                  دروس تم استخراجها تلقائياً من تحليل الأنماط
                </CardDescription>
              </div>
              <Button onClick={mineNewLessons} variant="outline">
                <RefreshCw className="w-4 h-4 ml-2" />
                استخراج دروس جديدة
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {lessons.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>لا توجد دروس مستفادة بعد</p>
                    <p className="text-sm">سيتم استخراج الدروس تلقائياً بعد تراكم الصفقات</p>
                  </div>
                ) : (
                  lessons.map((lesson) => (
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

                      <p className="text-muted-foreground mb-2">{lesson.description}</p>

                      <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg mb-2">
                        <p className="text-sm font-medium">الإجراء المقترح:</p>
                        <p className="text-sm">{lesson.action}</p>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CheckCircle className="w-4 h-4" />
                          الثقة: {lesson.confidence}%
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          التكرارات: {lesson.occurrences}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Actions Tab */}
        <TabsContent value="actions" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Review Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  المراجعات الدورية
                </CardTitle>
                <CardDescription>
                  تشغيل المراجعات اليدوية
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button onClick={() => runReview('daily')} className="w-full" variant="outline">
                  <RefreshCw className="w-4 h-4 ml-2" />
                  مراجعة يومية
                </Button>
                <Button onClick={() => runReview('weekly')} className="w-full" variant="outline">
                  <RefreshCw className="w-4 h-4 ml-2" />
                  مراجعة أسبوعية
                </Button>
                <Button onClick={() => runReview('monthly')} className="w-full" variant="outline">
                  <RefreshCw className="w-4 h-4 ml-2" />
                  مراجعة شهرية
                </Button>
              </CardContent>
            </Card>

            {/* Weight Adjustment */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  تعديل الأوزان
                </CardTitle>
                <CardDescription>
                  تعديل أوزان المؤشرات بناءً على الأداء
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button onClick={adjustWeights} className="w-full">
                  <Activity className="w-4 h-4 ml-2" />
                  تعديل الأوزان الشهرية
                </Button>
                <p className="text-sm text-muted-foreground">
                  سيتم حساب Expectancy لكل مؤشر وتعديل أوزانه بناءً على أدائه
                </p>
              </CardContent>
            </Card>

            {/* Overfitting Protection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  الحماية من الإفراط في التحسين
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span>تقسيم البيانات 60/40 للتحقق</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span>فترة اختبار 3 شهور للتعديلات</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span>الحد الأقصى لتغيير الوزن 15%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Fatal Error Recovery */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  التعامل مع الغلطة القاتلة
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <p>في حالة:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>خسارة أكثر من 5% من رأس المال</li>
                    <li>3 صفقات خاسرة متتالية (أكثر من 3% لكل منها)</li>
                  </ul>
                  <div className="mt-3 p-2 bg-red-50 dark:bg-red-950/20 rounded-lg">
                    <p className="font-medium text-red-700">النتيجة:</p>
                    <p className="text-red-600">إيقاف التداول 3 أيام + مراجعة طوارئ</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Egyptian Market Specifics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                خصائص السوق المصري
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg">
                  <p className="font-medium">العمولة والضريبة</p>
                  <p className="text-sm text-muted-foreground">
                    كل صفقة كاملة تكلف ~1.5%
                  </p>
                  <p className="text-xs mt-1">عمولة 0.5% + ضريبة 0.5% + سبريد 0.5%</p>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                  <p className="font-medium">الحد الأدنى للربح</p>
                  <p className="text-sm text-muted-foreground">
                    الربح المتوقع يجب أن يكون 4%+
                  </p>
                  <p className="text-xs mt-1">ليستحق الصفقة المخاطرة</p>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                  <p className="font-medium">الوقف المثالي</p>
                  <p className="text-sm text-muted-foreground">
                    3-5% في السوق المصري
                  </p>
                  <p className="text-xs mt-1">أقل = ضوضاء، أكثر = خسارة كبيرة</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
