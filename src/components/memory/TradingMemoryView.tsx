'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Search,
  Trophy,
  AlertTriangle,
  BarChart3,
  RefreshCw
} from 'lucide-react';
import { ExpertMemoryPanel } from './ExpertMemoryPanel';
import { PortfolioIntelligencePanel } from '@/components/portfolio/PortfolioIntelligencePanel';
import { SmartAssistantPanel } from '@/components/portfolio/SmartAssistantPanel';
import { SmartAlertsPanel } from '@/components/alerts/SmartAlertsPanel';
import { ProfessionalWatchlistView } from '@/components/watchlist/ProfessionalWatchlistView';
import { cn } from '@/lib/utils';

interface PatternStats {
  pattern: string;
  total: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_pnl: number;
}

interface OverallStats {
  patterns: PatternStats[];
  top_tickers: Array<{
    ticker: string;
    total: number;
    wins: number;
    losses: number;
    win_rate: number;
  }>;
  worst_tickers: Array<{
    ticker: string;
    total: number;
    wins: number;
    losses: number;
    win_rate: number;
  }>;
  total_patterns: number;
  generated_at: string;
}

export function TradingMemoryView() {
  const [stats, setStats] = useState<OverallStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTicker, setSearchTicker] = useState('');
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/python/v4/stats');
      const data = await response.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    if (searchTicker.trim()) {
      setSelectedTicker(searchTicker.trim().toUpperCase());
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            ذاكرة التداول
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            تاريخ صفقاتك وأنماطك - النظام يتعلم منك
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStats}>
          <RefreshCw className="h-4 w-4 ml-2" />
          تحديث
        </Button>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-2">
            <Input
              placeholder="ابحث عن سهم (مثال: COMI)"
              value={searchTicker}
              onChange={(e) => setSearchTicker(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch}>
              <Search className="h-4 w-4 ml-2" />
              بحث
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* قائمة المراقبة الاحترافية */}
      <ProfessionalWatchlistView />

      {/* المساعد المالى الذكى - Smart Assistant */}
      <SmartAssistantPanel />

      {/* التنبيهات الذكية - Smart Alerts */}
      <SmartAlertsPanel />

      {/* Portfolio Intelligence - ذكاء المحفظة */}
      <PortfolioIntelligencePanel />

      {/* Selected Ticker Panel */}
      {selectedTicker && (
        <ExpertMemoryPanel
          ticker={selectedTicker}
          onRecordTrade={() => {
            // TODO: Open trade recording dialog
            alert('سيتم إضافة نافذة تسجيل الصفقات قريباً');
          }}
        />
      )}

      {/* Stats Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Pattern Stats */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                إحصائيات الأنماط
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stats.patterns.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    لا توجد أنماط مسجلة
                  </p>
                ) : (
                  stats.patterns.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{p.pattern}</span>
                        <Badge variant="outline" className="text-xs">
                          {p.total} صفقة
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        {p.avg_pnl !== 0 && (
                          <span className={cn(
                            "text-sm font-medium",
                            p.avg_pnl > 0 ? "text-green-600" : "text-red-600"
                          )}>
                            {p.avg_pnl > 0 ? '+' : ''}{p.avg_pnl.toFixed(1)}%
                          </span>
                        )}
                        <Badge
                          variant={p.win_rate >= 50 ? 'success' : 'destructive'}
                        >
                          {p.win_rate.toFixed(0)}%
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ملخص</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center py-4">
                <div className="text-4xl font-bold text-primary">
                  {stats.total_patterns}
                </div>
                <p className="text-sm text-muted-foreground mt-1">نمط مسجل</p>
              </div>

              {/* Quick Stats */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">إجمالي الأنماط:</span>
                  <span className="font-medium">{stats.patterns.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">أفضل الأسهم:</span>
                  <span className="font-medium">{stats.top_tickers.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Tickers */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Trophy className="h-4 w-4 text-yellow-500" />
                أفضل الأسهم
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stats.top_tickers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    لا توجد بيانات كافية
                  </p>
                ) : (
                  stats.top_tickers.slice(0, 5).map((t, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedTicker(t.ticker)}
                    >
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-600" />
                        <span className="font-medium">{t.ticker}</span>
                      </div>
                      <Badge variant="success" className="text-xs">
                        {t.win_rate.toFixed(0)}%
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Worst Tickers */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                أسوأ الأسهم
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stats.worst_tickers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    لا توجد بيانات كافية
                  </p>
                ) : (
                  stats.worst_tickers.slice(0, 5).map((t, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedTicker(t.ticker)}
                    >
                      <div className="flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-red-600" />
                        <span className="font-medium">{t.ticker}</span>
                      </div>
                      <Badge variant="destructive" className="text-xs">
                        {t.win_rate.toFixed(0)}%
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Brain className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">كيف تعمل ذاكرة التداول؟</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• النظام يتعلم من صفقاتك وتحليلاتك السابقة</li>
                <li>• كلما سجلت المزيد، زادت دقة الاقتراحات</li>
                <li>• ابحث عن سهم لمعرفة تاريخك معه</li>
                <li>• سجل صفقاتك الجديدة لتبناء ذاكرتك</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
