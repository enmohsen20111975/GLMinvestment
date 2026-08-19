'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Activity, Zap, BarChart3
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfluencePick {
  ticker: string;
  market: string;
  recommendation: string;
  recommendation_ar: string;
  score: number;
  confidence: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  risk_reward: number;
  sector: string;
  name_ar: string;
}

function getScoreColor(score: number): string {
  if (score >= 75) return 'text-green-500';
  if (score >= 60) return 'text-emerald-400';
  if (score >= 45) return 'text-yellow-500';
  if (score >= 30) return 'text-orange-400';
  return 'text-red-500';
}

function getRecBadge(rec: string) {
  const lower = rec.toLowerCase();
  if (lower.includes('strong_buy') || lower.includes('شراء قوي')) {
    return <Badge className="bg-green-500 hover:bg-green-600">شراء قوي</Badge>;
  }
  if (lower.includes('buy') || lower.includes('شراء')) {
    return <Badge className="bg-emerald-400 hover:bg-emerald-500">شراء</Badge>;
  }
  if (lower.includes('swing_buy') || lower.includes('ت Swing')) {
    return <Badge className="bg-cyan-500 hover:bg-cyan-600">شراء متأرجح</Badge>;
  }
  if (lower.includes('hold') || lower.includes('حيادية')) {
    return <Badge className="bg-yellow-500 hover:bg-yellow-600">حيادية</Badge>;
  }
  if (lower.includes('sell') || lower.includes('بيع')) {
    return <Badge className="bg-red-500 hover:bg-red-600">بيع</Badge>;
  }
  return <Badge variant="outline">{rec || 'غير محدد'}</Badge>;
}

const MARKET_NAMES: Record<string, string> = {
  eg: 'مصر',
  sa: 'السعودية',
  kw: 'الكويت',
  qa: 'قطر',
  egx: 'مصر',
};

export function SmartConfluenceView() {
  const [predictions, setPredictions] = useState<ConfluencePick[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('predictions');

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const res = await fetch('/api/finance/smart-confluence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markets: ['EGX', 'EG', 'SAU', 'KWT', 'QAT'], perMarket: 5, totalLimit: 20 })
        });
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setPredictions(json.data);
        }
      } catch (e) {
        console.error('Error fetching confluence data:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const buyPicks = predictions.filter(p => {
    const r = p.recommendation.toLowerCase();
    return r.includes('buy') || r.includes('شراء');
  });

  const holdPicks = predictions.filter(p => {
    const r = p.recommendation.toLowerCase();
    return r.includes('hold') || r.includes('حيادية');
  });

  const sellPicks = predictions.filter(p => {
    const r = p.recommendation.toLowerCase();
    return r.includes('sell') || r.includes('بيع');
  });

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">تحليلات السوق</h1>
          <p className="text-muted-foreground">التوصيات الذكية من البيانات التاريخية</p>
        </div>
        <Button onClick={() => window.location.reload()} variant="outline" size="sm">
          <Activity className="h-4 w-4 ml-2" />
          تحديث
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">شراء</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold text-green-500">{buyPicks.length}</div></CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-yellow-500/10 to-amber-500/10">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">حيادية</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold text-yellow-500">{holdPicks.length}</div></CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-500/10 to-orange-500/10">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">بيع</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold text-red-500">{sellPicks.length}</div></CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">الكل</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold">{predictions.length}</div></CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="predictions">التوصيات</TabsTrigger>
          <TabsTrigger value="buy">شراء ({buyPicks.length})</TabsTrigger>
          <TabsTrigger value="sell">بيع ({sellPicks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="predictions" className="space-y-3 mt-4">
          {predictions.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
                <h3 className="text-lg font-bold mb-2">لا توجد توصيات متاحة حالياً</h3>
                <p className="text-muted-foreground">جاري تحديث قاعدة البيانات بالتوصيات الجديدة</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {predictions.map((pick, idx) => (
                <Card key={idx} className="border-white/10 bg-white/5">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-lg">{pick.ticker}</span>
                        <Badge variant="outline">{pick.market}</Badge>
                      </div>
                      {getRecBadge(pick.recommendation_ar || pick.recommendation)}
                    </div>
                    <div className="text-sm text-muted-foreground">{pick.name_ar}</div>
                    {pick.sector && (
                      <div className="text-xs text-muted-foreground">القطاع: {pick.sector}</div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">النقاط</span>
                        <div className={cn("font-bold", getScoreColor(pick.score))}>{pick.score}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">الثقة</span>
                        <div className="font-bold">{pick.confidence}%</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">R:R</span>
                        <div className="font-bold">{pick.risk_reward?.toFixed(2) || '0.00'}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">دخول</span>
                        <div className="font-bold">{pick.entry_price?.toFixed(2) || '0.00'}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">هدف</span>
                        <div className="font-bold text-green-500">{pick.target_price?.toFixed(2) || '0.00'}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">وقف</span>
                        <div className="font-bold text-red-500">{pick.stop_loss?.toFixed(2) || '0.00'}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="buy" className="space-y-3 mt-4">
          {buyPicks.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">لا توجد توصيات شراء حالياً</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {buyPicks.map((pick, idx) => (
                <Card key={idx} className="border-green-500/20 bg-green-500/5">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-lg">{pick.ticker}</span>
                      {getRecBadge(pick.recommendation_ar || pick.recommendation)}
                    </div>
                    <div className="text-sm text-muted-foreground">{pick.name_ar}</div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className={cn("font-bold", getScoreColor(pick.score))}>النقاط: {pick.score}</span>
                      <span className="text-muted-foreground">الثقة: {pick.confidence}%</span>
                      <span className="text-muted-foreground">R:R: {pick.risk_reward?.toFixed(2) || '0.00'}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sell" className="space-y-3 mt-4">
          {sellPicks.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">لا توجد توصيات بيع حالياً</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sellPicks.map((pick, idx) => (
                <Card key={idx} className="border-red-500/20 bg-red-500/5">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-lg">{pick.ticker}</span>
                      {getRecBadge(pick.recommendation_ar || pick.recommendation)}
                    </div>
                    <div className="text-sm text-muted-foreground">{pick.name_ar}</div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className={cn("font-bold", getScoreColor(pick.score))}>النقاط: {pick.score}</span>
                      <span className="text-muted-foreground">الثقة: {pick.confidence}%</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default SmartConfluenceView;
