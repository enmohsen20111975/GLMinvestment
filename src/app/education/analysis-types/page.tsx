'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { 
  TrendingUp, TrendingDown, Activity, BarChart3, CandlestickChart, 
  LineChart, PieChart, Target, Brain, Users, Shield, Zap, BookOpen,
  ChevronRight, CheckCircle2, AlertTriangle, Info
} from 'lucide-react';

// Analysis Types Data
const analysisCategories = [
  {
    id: 'technical',
    name: 'التحليل الفني',
    nameEn: 'Technical Analysis',
    icon: TrendingUp,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    description: 'تحليل حركة السعر والأنماط للتنبؤ بالاتجاهات المستقبلية',
    successRate: '30-80%',
    tools: [
      { name: 'الشموع اليابانية', successRate: '65-78%', difficulty: 'سهل' },
      { name: 'فيبوناتشي', successRate: '65-70%', difficulty: 'متوسط' },
      { name: 'أنماط الرسم البياني', successRate: '60-83%', difficulty: 'متوسط' },
      { name: 'المؤشرات الفنية', successRate: '55-86%', difficulty: 'سهل' },
      { name: 'الهارمونيك', successRate: '60-75%', difficulty: 'صعب' },
      { name: 'إشيموكو', successRate: '70-78%', difficulty: 'متوسط' },
      { name: 'الدعم والمقاومة', successRate: '80-85%', difficulty: 'سهل' },
    ],
  },
  {
    id: 'fundamental',
    name: 'التحليل الأساسي',
    nameEn: 'Fundamental Analysis',
    icon: BarChart3,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    description: 'تحليل القيمة الجوهرية للشركة من خلال البيانات المالية',
    successRate: '60-75%',
    tools: [
      { name: 'Piotroski F-Score', successRate: '23% سنوياً', difficulty: 'متوسط' },
      { name: 'DCF', successRate: 'عالي طويل الأجل', difficulty: 'صعب' },
      { name: 'النسب المالية', successRate: '70%+', difficulty: 'سهل' },
      { name: 'تحليل الخندق الاقتصادي', successRate: 'عالي', difficulty: 'متوسط' },
    ],
  },
  {
    id: 'sentiment',
    name: 'التحليل المعنوي',
    nameEn: 'Sentiment Analysis',
    icon: Brain,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    description: 'تحليل مشاعر المستثمرين وسيكولوجية السوق',
    successRate: '71-86%',
    tools: [
      { name: 'Put-Call Ratio', successRate: '70-80%', difficulty: 'سهل' },
      { name: 'TRIN/Arms Index', successRate: '65-75%', difficulty: 'سهل' },
      { name: 'Breadth Thrust', successRate: '100%*', difficulty: 'متوسط' },
      { name: 'Social Sentiment', successRate: '84-86%', difficulty: 'متوسط' },
    ],
  },
  {
    id: 'institutional',
    name: 'التحليل المؤسسي',
    nameEn: 'Institutional Analysis',
    icon: Users,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    description: 'تتبع حركات المؤسسات الكبرى والنقود الذكية',
    successRate: '65-80%',
    tools: [
      { name: 'Dark Pool Analysis', successRate: '68%', difficulty: 'صعب' },
      { name: 'COT Report', successRate: '70-80%', difficulty: 'متوسط' },
      { name: 'Options Flow', successRate: '65-72%', difficulty: 'صعب' },
      { name: 'Insider Trading', successRate: '70-75%', difficulty: 'سهل' },
      { name: 'Gamma Exposure', successRate: 'عالي', difficulty: 'صعب' },
    ],
  },
];

// Candlestick Patterns Data
const candlestickPatterns = [
  { name: 'الابتلاع الصاعد/الهابط', successRate: 72, type: 'انعكاسي', difficulty: 'سهل' },
  { name: 'النجمة الصباحية/المسائية', successRate: 78, type: 'انعكاسي', difficulty: 'متوسط' },
  { name: 'المطرقة/الرجل المشنوق', successRate: 65, type: 'انعكاسي', difficulty: 'سهل' },
  { name: 'ثلاثة جنود بيض/غربان سوداء', successRate: 82, type: 'انعكاسي', difficulty: 'سهل' },
  { name: 'الدوجي', successRate: 55, type: 'تحذيري', difficulty: 'سهل' },
  { name: 'الحرامي', successRate: 62, type: 'انعكاسي', difficulty: 'سهل' },
  { name: 'الخط المخترق/الغطاء السحابي', successRate: 68, type: 'انعكاسي', difficulty: 'متوسط' },
];

// Chart Patterns Data
const chartPatterns = [
  { name: 'الرأس والكتفين', successRate: 83, type: 'انعكاسي', direction: 'هابط' },
  { name: 'الرأس والكتفين المعكوس', successRate: 83, type: 'انعكاسي', direction: 'صاعد' },
  { name: 'القمة/القاع المزدوج', successRate: 78, type: 'انعكاسي', direction: 'كلاهما' },
  { name: 'المثلث الصاعد', successRate: 73, type: 'استمراري', direction: 'صاعد' },
  { name: 'المثلث الهابط', successRate: 70, type: 'استمراري', direction: 'هابط' },
  { name: 'العلم الصاعد/الهابط', successRate: 67, type: 'استمراري', direction: 'كلاهما' },
  { name: 'الوتد الصاعد', successRate: 68, type: 'انعكاسي', direction: 'هابط' },
  { name: 'الوتد الهابط', successRate: 74, type: 'انعكاسي', direction: 'صاعد' },
];

// Indicators Data
const indicators = [
  { name: 'RSI', successRate: { alone: 55, confirmed: 73 }, type: 'زخم' },
  { name: 'MACD', successRate: { alone: 40, confirmed: 86 }, type: 'زخم' },
  { name: 'Bollinger Bands', successRate: { alone: 60, confirmed: 70 }, type: 'تقلب' },
  { name: 'Moving Averages', successRate: { alone: 65, confirmed: 75 }, type: 'اتجاه' },
  { name: 'ADX', successRate: { alone: 60, confirmed: 70 }, type: 'قوة الاتجاه' },
  { name: 'Stochastic', successRate: { alone: 55, confirmed: 65 }, type: 'زخم' },
];

export default function AnalysisTypesPage() {
  const [selectedCategory, setSelectedCategory] = useState('technical');
  const [progress, setProgress] = useState(0);

  return (
    <div className="container mx-auto py-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">أنواع التحليلات المالية</h1>
        <p className="text-muted-foreground text-lg max-w-3xl mx-auto">
          دليل شامل لجميع أنواع التحليلات المستخدمة في توقع أسعار الأسهم والعملات
          مع نسب النجاح العملية من الدراسات والأبحاث
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-500">70+</p>
              <p className="text-sm text-muted-foreground">أداة تحليل</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-green-500">83%</p>
              <p className="text-sm text-muted-foreground">أعلى نسبة نجاح</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-purple-500">5</p>
              <p className="text-sm text-muted-foreground">فروع رئيسية</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-amber-500">98%</p>
              <p className="text-sm text-muted-foreground">نجاح التكامل</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="categories" className="space-y-6">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl mx-auto">
          <TabsTrigger value="categories">الفئات</TabsTrigger>
          <TabsTrigger value="candlesticks">الشموع</TabsTrigger>
          <TabsTrigger value="patterns">الأنماط</TabsTrigger>
          <TabsTrigger value="indicators">المؤشرات</TabsTrigger>
        </TabsList>

        {/* Categories Tab */}
        <TabsContent value="categories" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {analysisCategories.map((category) => {
              const Icon = category.icon;
              return (
                <Card 
                  key={category.id}
                  className={`cursor-pointer transition-all hover:shadow-lg ${
                    selectedCategory === category.id ? 'ring-2 ring-primary' : ''
                  }`}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-3 rounded-lg ${category.bgColor}`}>
                          <Icon className={`w-6 h-6 ${category.color}`} />
                        </div>
                        <div>
                          <CardTitle>{category.name}</CardTitle>
                          <CardDescription>{category.nameEn}</CardDescription>
                        </div>
                      </div>
                      <Badge variant="outline">{category.successRate}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground mb-4">{category.description}</p>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">الأدوات الرئيسية:</p>
                      <div className="flex flex-wrap gap-2">
                        {category.tools.map((tool) => (
                          <Badge key={tool.name} variant="secondary">
                            {tool.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Candlesticks Tab */}
        <TabsContent value="candlesticks" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CandlestickChart className="w-5 h-5 text-blue-500" />
                أنماط الشموع اليابانية
              </CardTitle>
              <CardDescription>
                نسب النجاح العملية من الدراسات والأبحاث
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {candlestickPatterns.map((pattern) => (
                  <div key={pattern.name} className="flex items-center gap-4 p-4 rounded-lg border">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">{pattern.name}</span>
                        <div className="flex gap-2">
                          <Badge variant={pattern.type === 'انعكاسي' ? 'default' : 'outline'}>
                            {pattern.type}
                          </Badge>
                          <Badge variant="secondary">{pattern.difficulty}</Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Progress value={pattern.successRate} className="flex-1" />
                        <span className="text-sm font-bold text-green-500">
                          {pattern.successRate}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="mt-6 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-500 mt-0.5" />
                  <div>
                    <p className="font-medium">نصيحة مهمة</p>
                    <p className="text-sm text-muted-foreground">
                      الشموع اليابانية لوحدها ضعيفة (50-60% نجاح)، لكن مع تأكيد من مؤشر آخر
                      ترتفع النسبة إلى 65-78%
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Patterns Tab */}
        <TabsContent value="patterns" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LineChart className="w-5 h-5 text-purple-500" />
                أنماط الرسم البياني
              </CardTitle>
              <CardDescription>
                من بحث 10 سنوات و 200,000 نمط - الرأس والكتفين لديه أعلى نسبة نجاح 83%
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {chartPatterns.map((pattern) => (
                  <div key={pattern.name} className="p-4 rounded-lg border">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium">{pattern.name}</span>
                      <Badge 
                        variant={pattern.successRate >= 80 ? 'default' : 'secondary'}
                        className={pattern.successRate >= 80 ? 'bg-green-500' : ''}
                      >
                        {pattern.successRate}%
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline">{pattern.type}</Badge>
                      <Badge 
                        variant={pattern.direction === 'صاعد' ? 'default' : 
                                pattern.direction === 'هابط' ? 'destructive' : 'secondary'}
                      >
                        {pattern.direction}
                      </Badge>
                    </div>
                    <Progress value={pattern.successRate} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Indicators Tab */}
        <TabsContent value="indicators" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-amber-500" />
                المؤشرات الفنية
              </CardTitle>
              <CardDescription>
                مقارنة بين نجاح المؤشر لوحده مقابل مع تأكيدات
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {indicators.map((indicator) => (
                  <div key={indicator.name} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{indicator.name}</span>
                        <Badge variant="outline">{indicator.type}</Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                        <p className="text-sm text-muted-foreground mb-1">لوحده</p>
                        <div className="flex items-center gap-2">
                          <Progress value={indicator.successRate.alone} className="flex-1" />
                          <span className="font-bold text-red-500">{indicator.successRate.alone}%</span>
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                        <p className="text-sm text-muted-foreground mb-1">مع تأكيد</p>
                        <div className="flex items-center gap-2">
                          <Progress value={indicator.successRate.confirmed} className="flex-1" />
                          <span className="font-bold text-green-500">{indicator.successRate.confirmed}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="mt-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="font-medium">تحذير مهم</p>
                    <p className="text-sm text-muted-foreground">
                      MACD لوحده لديه فقط 40% نجاح، لكن مع فلاتر زمنية واتجاهية يرتفع إلى 86%!
                      لا تعتمد على مؤشر واحد أبداً.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Golden Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            القواعد الذهبية للتحليل الناجح
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="rule1">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  التأكيد (Confluence)
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-muted-foreground">
                  عند تجميع 3-5 إشارات متفقة من أدوات مختلفة، تصل نسبة النجاح إلى 98%.
                  على سبيل المثال: دعم قوي + مستوى فيبوناتشي 61.8% + شمعة مطرقة + RSI في تشبع بيعي.
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="rule2">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-blue-500" />
                  إدارة المخاطر
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-muted-foreground">
                  لا توجد طريقة مضمونة 100%. نجاح التحليل يعتمد على: مهارة المحلل (30%)، 
                  إدارة المخاطر (40%)، علم النفس التداولي (20%)، التنويع (10%).
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="rule3">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-500" />
                  الإطار الزمني
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-muted-foreground">
                  الدعم والمقاومة على الإطار اليومي لديه 80-85% نجاح، بينما على ساعة واحدة
                  فقط 50-55%. كلما كان الإطار أكبر، كانت الإشارات أقوى وأكثر موثوقية.
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="rule4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-purple-500" />
                  التخصص
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-muted-foreground">
                  المحترف الحقيقي لا يعرف كل شيء! يختار 3-5 أدوات يتقنها تماماً ويبني
                  نظامه الخاص عليها. المبتدئ يبدأ بالدعم/المقاومة + الشموع + RSI.
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-center gap-4">
        <Card className="cursor-pointer hover:shadow-lg transition-all w-64">
          <CardContent className="pt-6 text-center">
            <BookOpen className="w-8 h-8 mx-auto mb-2 text-primary" />
            <p className="font-medium">ابدأ التعلم</p>
            <p className="text-sm text-muted-foreground">دروس تفاعلية</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-lg transition-all w-64">
          <CardContent className="pt-6 text-center">
            <Activity className="w-8 h-8 mx-auto mb-2 text-green-500" />
            <p className="font-medium">المحاكاة</p>
            <p className="text-sm text-muted-foreground">تدرب عملياً</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
