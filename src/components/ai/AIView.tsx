'use client';

/**
 * AI View - Comprehensive AI Assistant Interface
 * واجهة المساعد الذكي الشاملة
 */

import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles,
  MessageSquare,
  TrendingUp,
  Wallet,
  BarChart3,
  Bell,
  Newspaper,
  Zap,
  Target,
  RefreshCw
} from 'lucide-react';
import { AIAssistantChat } from './AIAssistantChat';

interface AIViewProps {
  initialTab?: string;
}

// AI Feature Cards
const aiFeatures = [
  {
    id: 'chat',
    title: 'استشر المساعد',
    titleEn: 'Ask Assistant',
    description: 'اسأل أي سؤال عن الاستثمار واحصل على إجابة فورية',
    icon: MessageSquare,
    color: 'emerald',
    status: 'active'
  },
  {
    id: 'stock-analysis',
    title: 'تحليل الأسهم',
    titleEn: 'Stock Analysis',
    description: 'تحليل شامل لأي سهم مع تحليلات عملية',
    icon: TrendingUp,
    color: 'blue',
    status: 'active'
  },
  {
    id: 'portfolio-assistant',
    title: 'تحليل المحفظة',
    titleEn: 'Portfolio Analysis',
    description: 'تحليل محفظتك واقتراحات لتحسين الأداء',
    icon: Wallet,
    color: 'purple',
    status: 'active'
  },
  {
    id: 'market-insights',
    title: 'نصائح السوق',
    titleEn: 'Market Tips',
    description: 'ملخص يومي للسوق مع أبرز الفرص',
    icon: BarChart3,
    color: 'orange',
    status: 'active'
  },
  {
    id: 'smart-alerts',
    title: 'التنبيهات الذكية',
    titleEn: 'Smart Alerts',
    description: 'تنبيهات مخصصة حسب استراتيجيتك',
    icon: Bell,
    color: 'red',
    status: 'coming'
  },
  {
    id: 'news-sentiment',
    title: 'تحليل الأخبار',
    titleEn: 'News Analysis',
    description: 'تحليل الأخبار وتأثيرها على السوق',
    icon: Newspaper,
    color: 'cyan',
    status: 'coming'
  }
];

// Quick prompts for stock analysis
const stockPrompts = [
  { symbol: 'COMI', name: 'الكوميريال' },
  { symbol: 'ETAL', name: 'ايكويتا' },
  { symbol: 'HRHO', name: 'هيرميس' },
  { symbol: 'AMOC', name: 'أبوقير' },
];

export function AIView({ initialTab = 'chat' }: AIViewProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [analyzingStock, setAnalyzingStock] = useState<string | null>(null);

  const handleStockAnalysis = (symbol: string) => {
    setAnalyzingStock(symbol);
    // This will be handled by the chat component
  };

  return (
    <div className="container mx-auto p-4 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">مساعد الاستثمار</h1>
            <p className="text-sm text-muted-foreground">مساعدك الشخصي للاستثمار</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            متصل
          </Badge>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="chat" className="gap-2">
            <MessageSquare className="w-4 h-4" />
            المحادثة
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-2">
            <TrendingUp className="w-4 h-4" />
            التحليل
          </TabsTrigger>
          <TabsTrigger value="portfolio" className="gap-2">
            <Wallet className="w-4 h-4" />
            المحفظة
          </TabsTrigger>
          <TabsTrigger value="features" className="gap-2">
            <Zap className="w-4 h-4" />
            المميزات
          </TabsTrigger>
        </TabsList>

        {/* Chat Tab */}
        <TabsContent value="chat" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <AIAssistantChat />
            </div>
            <div className="space-y-4">
              {/* Quick Actions */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">أسئلة سريعة</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button 
                    variant="outline" 
                    className="w-full justify-start gap-2"
                    onClick={() => {/* Will integrate with chat */}}
                  >
                    <Bitcoin className="w-4 h-4" />
                    ما سعر البيتكوين؟
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start gap-2"
                  >
                    <BarChart3 className="w-4 h-4" />
                    ملخص سوق EGX
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start gap-2"
                  >
                    <TrendingUp className="w-4 h-4" />
                    مؤشر الخوف والطمع
                  </Button>
                </CardContent>
              </Card>

              {/* Stock Quick Analysis */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">تحليل سريع للأسهم</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                  {stockPrompts.map((stock) => (
                    <Button
                      key={stock.symbol}
                      variant="outline"
                      size="sm"
                      className="justify-start"
                      onClick={() => handleStockAnalysis(stock.symbol)}
                    >
                      {stock.symbol}
                    </Button>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Analysis Tab */}
        <TabsContent value="analysis" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                تحليل الأسهم المتقدم
              </CardTitle>
              <CardDescription>
                اختر سهم للحصول على تحليل شامل
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {stockPrompts.map((stock) => (
                  <Button
                    key={stock.symbol}
                    variant="outline"
                    className="h-auto py-4 flex flex-col gap-1"
                    onClick={() => handleStockAnalysis(stock.symbol)}
                  >
                    <span className="font-bold">{stock.symbol}</span>
                    <span className="text-xs text-muted-foreground">{stock.name}</span>
                  </Button>
                ))}
              </div>
              {analyzingStock && (
                <div className="mt-4 p-4 bg-muted rounded-lg">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>جاري تحليل {analyzingStock}...</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Portfolio Tab */}
        <TabsContent value="portfolio" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                مساعد المحفظة الذكي
              </CardTitle>
              <CardDescription>
                احصل على نصائح مخصصة لتحسين أداء محفظتك
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted rounded-lg text-center">
                <Wallet className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground">
                  قم بإضافة أسهم لمحفظتك للحصول على تحليل ذكي
                </p>
                <Button className="mt-3" onClick={() => {/* Navigate to portfolio */}}>
                  الذهاب للمحفظة
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Features Tab */}
        <TabsContent value="features" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {aiFeatures.map((feature) => {
              const Icon = feature.icon;
              const colorClass = {
                emerald: 'from-emerald-500 to-teal-600',
                blue: 'from-blue-500 to-indigo-600',
                purple: 'from-purple-500 to-pink-600',
                orange: 'from-orange-500 to-red-600',
                red: 'from-red-500 to-rose-600',
                cyan: 'from-cyan-500 to-blue-600',
              }[feature.color] || 'from-gray-500 to-gray-600';

              return (
                <Card key={feature.id} className="relative overflow-hidden">
                  {feature.status === 'coming' && (
                    <Badge className="absolute top-2 left-2" variant="secondary">
                      قريباً
                    </Badge>
                  )}
                  <CardHeader>
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colorClass} flex items-center justify-center mb-2`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                    <CardDescription>{feature.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      className="w-full"
                      variant={feature.status === 'active' ? 'default' : 'outline'}
                      disabled={feature.status === 'coming'}
                      onClick={() => {
                        if (feature.id === 'chat') setActiveTab('chat');
                        else if (feature.id === 'stock-analysis') setActiveTab('analysis');
                        else if (feature.id === 'portfolio-assistant') setActiveTab('portfolio');
                      }}
                    >
                      {feature.status === 'active' ? 'استخدام' : 'قريباً'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AIView;
