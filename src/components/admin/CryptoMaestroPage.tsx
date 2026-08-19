'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Activity, RefreshCw, AlertTriangle,
  Zap, Loader2, Bitcoin, DollarSign, Percent, BarChart3, AlertCircle,
  Target, StopCircle, Clock, ChevronUp, ChevronDown, Filter, Search,
  Star, XCircle, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';

// ==================== TYPES ====================

interface CryptoRegime {
  regime: string;
  btc_dominance: number;
  fear_greed_index: number;
  alt_season_score: number;
  volatility_regime: string;
  signal: string;
  reasons: string[];
  timestamp: string;
}

interface CryptoBulkResult {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change_24h: number;
  market_cap: number;
  market_cap_rank: number;
  volume_24h: number;
  ath: number;
  atl: number;
  ath_distance_pct: number;
  atl_distance_pct: number;
  signal: string;
  signal_ar: string;
  strength: string;
  opportunity_type: string;
  confidence: number;
  score: number;
  reasons: string[];
  warnings: string[];
}

interface Categories {
  strong_opportunities: Array<{symbol: string; name: string; price: number; score: number; change_24h?: number; reason: string}>;
  scalping_plays: Array<{symbol: string; name: string; price: number; change_24h: number; reason: string}>;
  value_picks: Array<{symbol: string; name: string; price: number; atl_distance: number; reason: string}>;
  momentum_plays: Array<{symbol: string; name: string; price: number; change_24h: number; reason: string}>;
  avoid: Array<{symbol: string; name: string; price: number; score?: number; reason: string}>;
  watchlist: Array<{symbol: string; name: string; price: number; score: number; reason: string}>;
}

interface BulkAnalysisResponse {
  success: boolean;
  timestamp: string;
  market_regime: {
    fear_greed: number;
    btc_dominance: number;
    volatility: string;
  };
  summary: {
    total: number;
    strong_buy: number;
    buy: number;
    hold: number;
    sell: number;
  };
  categories: Categories;
  data: CryptoBulkResult[];
}

// ==================== CONSTANTS ====================

const FEAR_GREED_CONFIG = {
  extreme_fear: { min: 0, max: 25, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30', label: 'خوف شديد', labelEn: 'Extreme Fear', signal: 'فرصة شراء' },
  fear: { min: 26, max: 45, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30', label: 'خوف', labelEn: 'Fear', signal: 'حذر' },
  neutral: { min: 46, max: 55, color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30', label: 'محايد', labelEn: 'Neutral', signal: 'انتظار' },
  greed: { min: 56, max: 75, color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30', label: 'طمع', labelEn: 'Greed', signal: 'حذر' },
  extreme_greed: { min: 76, max: 100, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30', label: 'طمع شديد', labelEn: 'Extreme Greed', signal: 'خطر' }
};

const SIGNAL_CONFIG = {
  STRONG_BUY: { color: 'text-green-700', bg: 'bg-green-600', label: 'شراء قوي', icon: '🟢' },
  BUY: { color: 'text-green-600', bg: 'bg-green-500', label: 'شراء', icon: '🟢' },
  HOLD: { color: 'text-yellow-600', bg: 'bg-yellow-500', label: 'احتفاظ', icon: '🟡' },
  SELL: { color: 'text-red-600', bg: 'bg-red-500', label: 'بيع', icon: '🔴' },
  STRONG_SELL: { color: 'text-red-700', bg: 'bg-red-600', label: 'بيع قوي', icon: '🔴' }
};

const STRENGTH_CONFIG = {
  STRONG: { color: 'text-green-600', bg: 'bg-green-100', label: 'قوي' },
  MODERATE: { color: 'text-yellow-600', bg: 'bg-yellow-100', label: 'متوسط' },
  WEAK: { color: 'text-red-600', bg: 'bg-red-100', label: 'ضعيف' }
};

const OPPORTUNITY_CONFIG = {
  INVESTMENT: { color: 'text-blue-600', bg: 'bg-blue-100', label: 'استثمار', icon: '💼' },
  SWING: { color: 'text-purple-600', bg: 'bg-purple-100', label: 'سوينج', icon: '📊' },
  SCALPING: { color: 'text-orange-600', bg: 'bg-orange-100', label: 'سكالبينج', icon: '⚡' }
};

// ==================== HELPER FUNCTIONS ====================

function getFearGreedConfig(value: number) {
  if (value <= 25) return FEAR_GREED_CONFIG.extreme_fear;
  if (value <= 45) return FEAR_GREED_CONFIG.fear;
  if (value <= 55) return FEAR_GREED_CONFIG.neutral;
  if (value <= 75) return FEAR_GREED_CONFIG.greed;
  return FEAR_GREED_CONFIG.extreme_greed;
}

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(6)}`;
}

function formatMarketCap(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toLocaleString()}`;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

// ==================== MAIN COMPONENT ====================

export function CryptoMaestroPage() {
  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [bulkData, setBulkData] = useState<BulkAnalysisResponse | null>(null);
  const [filteredData, setFilteredData] = useState<CryptoBulkResult[]>([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [signalFilter, setSignalFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [limit, setLimit] = useState(100);

  // Check backend connection
  const checkBackendHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/python/health');
      const data = await res.json();
      setBackendConnected(data.status === 'ok' || data.status === 'healthy');
      return data.status === 'ok' || data.status === 'healthy';
    } catch (e) {
      console.error('Backend health check failed:', e);
      setBackendConnected(false);
      return false;
    }
  }, []);

  // Fetch bulk analysis
  const fetchBulkAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/python/crypto/bulk-analysis?limit=${limit}`);
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      
      const data = await res.json();
      
      if (data.success) {
        setBulkData(data);
        setFilteredData(data.data || []);
      } else {
        setError(data.error || 'فشل في جلب البيانات');
      }
    } catch (e: any) {
      console.error('Error fetching bulk analysis:', e);
      setError('فشل الاتصال بالخادم - تأكد من تشغيل Python Backend');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  // Filter data
  useEffect(() => {
    if (!bulkData) return;
    
    let filtered = [...bulkData.data];
    
    // Signal filter
    if (signalFilter !== 'ALL') {
      if (signalFilter === 'BUY') {
        filtered = filtered.filter(c => c.signal === 'STRONG_BUY' || c.signal === 'BUY');
      } else {
        filtered = filtered.filter(c => c.signal === signalFilter);
      }
    }
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c => 
        c.symbol.toLowerCase().includes(query) || 
        c.name.toLowerCase().includes(query)
      );
    }
    
    setFilteredData(filtered);
  }, [bulkData, signalFilter, searchQuery]);

  // Refresh all
  const handleRefresh = async () => {
    await fetchBulkAnalysis();
  };

  // Initial load
  useEffect(() => {
    const init = async () => {
      const isHealthy = await checkBackendHealth();
      if (isHealthy) {
        await fetchBulkAnalysis();
      } else {
        setLoading(false);
      }
    };
    init();
  }, [checkBackendHealth, fetchBulkAnalysis]);

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">جاري تحليل العملات الرقمية...</p>
        <p className="text-sm text-muted-foreground mt-2">تحليل {limit} عملة</p>
      </div>
    );
  }

  // Backend disconnected
  if (backendConnected === false) {
    return (
      <Alert variant="destructive" className="max-w-2xl mx-auto">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>⚠️ Python Backend غير متصل</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>الـ Python Backend (Port 8010) مش شغال.</p>
          <div className="p-3 bg-red-950/30 rounded-lg text-sm font-mono">
            <p className="font-bold text-red-400 mb-2">لتشغيل الباكند:</p>
            <code className="block text-green-400">cd vps-service && python3 main.py</code>
          </div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { checkBackendHealth(); fetchBulkAnalysis(); }}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة التحقق
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const regime = bulkData?.market_regime;
  const summary = bulkData?.summary;
  const categories = bulkData?.categories;
  const fearGreedConfig = regime ? getFearGreedConfig(regime.fear_greed) : null;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Bitcoin className="h-6 w-6 text-orange-500" />
                نظام الكريبتو - التحليل الشامل
              </CardTitle>
              <CardDescription>
                تحليل {summary?.total || 0} عملة رقمية - تصنيف الفرص
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="px-3 py-1 border rounded-lg text-sm"
              >
                <option value={50}>50 عملة</option>
                <option value={100}>100 عملة</option>
                <option value={200}>200 عملة</option>
              </select>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                <span className="mr-2">تحديث</span>
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Market Regime Cards */}
      {regime && fearGreedConfig && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Fear & Greed Index */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm text-muted-foreground">الخوف والطمع</p>
                  <p className="text-3xl font-bold">{regime.fear_greed}</p>
                </div>
                <div className={cn('rounded-full p-3', fearGreedConfig.bg)}>
                  {regime.fear_greed <= 45 ? (
                    <TrendingDown className={cn('h-6 w-6', fearGreedConfig.color)} />
                  ) : regime.fear_greed >= 55 ? (
                    <TrendingUp className={cn('h-6 w-6', fearGreedConfig.color)} />
                  ) : (
                    <Minus className={cn('h-6 w-6', fearGreedConfig.color)} />
                  )}
                </div>
              </div>
              <div className={cn('text-center p-2 rounded-lg', fearGreedConfig.bg)}>
                <p className={cn('font-bold', fearGreedConfig.color)}>{fearGreedConfig.label}</p>
              </div>
              <Progress value={regime.fear_greed} className="mt-3 h-2" />
            </CardContent>
          </Card>

          {/* BTC Dominance */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm text-muted-foreground">هيمنة BTC</p>
                  <p className="text-3xl font-bold">{regime.btc_dominance.toFixed(1)}%</p>
                </div>
                <div className="rounded-full bg-orange-100 dark:bg-orange-900/30 p-3">
                  <Bitcoin className="h-6 w-6 text-orange-500" />
                </div>
              </div>
              <Progress value={regime.btc_dominance} className="h-2" />
            </CardContent>
          </Card>

          {/* Volatility */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm text-muted-foreground">التقلب</p>
                  <p className="text-xl font-bold">{regime.volatility}</p>
                </div>
                <div className="rounded-full bg-purple-100 dark:bg-purple-900/30 p-3">
                  <Activity className="h-6 w-6 text-purple-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          {summary && (
            <Card>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded">
                    <p className="text-xs text-muted-foreground">شراء</p>
                    <p className="font-bold text-green-600">{summary.strong_buy + summary.buy}</p>
                  </div>
                  <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded">
                    <p className="text-xs text-muted-foreground">احتفاظ</p>
                    <p className="font-bold text-yellow-600">{summary.hold}</p>
                  </div>
                  <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded">
                    <p className="text-xs text-muted-foreground">بيع</p>
                    <p className="font-bold text-red-600">{summary.sell}</p>
                  </div>
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded">
                    <p className="text-xs text-muted-foreground">الكل</p>
                    <p className="font-bold text-blue-600">{summary.total}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="categories">التصنيفات</TabsTrigger>
          <TabsTrigger value="all">كل العملات</TabsTrigger>
          <TabsTrigger value="opportunities">الفرص</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {/* Quick Categories */}
          {categories && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Strong Opportunities */}
              <Card className="border-green-200 dark:border-green-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-green-600">
                    <Star className="h-5 w-5" />
                    فرص قوية ({categories.strong_opportunities.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {categories.strong_opportunities.length > 0 ? (
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2">
                        {categories.strong_opportunities.map((coin, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-900/20 rounded">
                            <div>
                              <span className="font-bold">{coin.symbol}</span>
                              <span className="text-xs text-muted-foreground mr-2">{coin.name}</span>
                            </div>
                            <div className="text-left">
                              <span className="font-bold text-green-600">{coin.score}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">لا توجد فرص قوية حالياً</p>
                  )}
                </CardContent>
              </Card>

              {/* Scalping Plays */}
              <Card className="border-orange-200 dark:border-orange-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-orange-600">
                    <Zap className="h-5 w-5" />
                    سكالبينج ({categories.scalping_plays.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {categories.scalping_plays.length > 0 ? (
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2">
                        {categories.scalping_plays.map((coin, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-orange-50 dark:bg-orange-900/20 rounded">
                            <div>
                              <span className="font-bold">{coin.symbol}</span>
                              <span className="text-xs text-muted-foreground mr-2">{coin.name}</span>
                            </div>
                            <span className={cn('text-sm', coin.change_24h >= 0 ? 'text-green-600' : 'text-red-600')}>
                              {formatPercent(coin.change_24h)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">لا توجد فرص سكالبينج</p>
                  )}
                </CardContent>
              </Card>

              {/* Value Picks */}
              <Card className="border-blue-200 dark:border-blue-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-blue-600">
                    <Target className="h-5 w-5" />
                    قرب ATL ({categories.value_picks.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {categories.value_picks.length > 0 ? (
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2">
                        {categories.value_picks.map((coin, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                            <div>
                              <span className="font-bold">{coin.symbol}</span>
                              <span className="text-xs text-muted-foreground mr-2">{coin.name}</span>
                            </div>
                            <span className="text-sm text-blue-600">{coin.atl_distance.toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">لا توجد عملات قرب ATL</p>
                  )}
                </CardContent>
              </Card>

              {/* Momentum Plays */}
              <Card className="border-purple-200 dark:border-purple-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-purple-600">
                    <TrendingUp className="h-5 w-5" />
                    حركة صاعدة ({categories.momentum_plays.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {categories.momentum_plays.length > 0 ? (
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2">
                        {categories.momentum_plays.map((coin, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-purple-50 dark:bg-purple-900/20 rounded">
                            <div>
                              <span className="font-bold">{coin.symbol}</span>
                              <span className="text-xs text-muted-foreground mr-2">{coin.name}</span>
                            </div>
                            <span className="text-sm text-green-600">{formatPercent(coin.change_24h)}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">لا توجد حركات صاعدة</p>
                  )}
                </CardContent>
              </Card>

              {/* Avoid */}
              <Card className="border-red-200 dark:border-red-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-red-600">
                    <XCircle className="h-5 w-5" />
                    تجنب ({categories.avoid.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {categories.avoid.length > 0 ? (
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2">
                        {categories.avoid.map((coin, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-900/20 rounded">
                            <div>
                              <span className="font-bold">{coin.symbol}</span>
                              <span className="text-xs text-muted-foreground mr-2">{coin.name}</span>
                            </div>
                            <span className="text-xs text-red-600">{coin.reason}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">لا توجد عملات للتجنب</p>
                  )}
                </CardContent>
              </Card>

              {/* Watchlist */}
              {categories.watchlist && categories.watchlist.length > 0 && (
                <Card className="border-gray-200 dark:border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-gray-600">
                      <Activity className="h-5 w-5" />
                      تحت المراقبة ({categories.watchlist.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2">
                        {categories.watchlist.map((coin, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900/20 rounded">
                            <div>
                              <span className="font-bold">{coin.symbol}</span>
                              <span className="text-xs text-muted-foreground mr-2">{coin.name}</span>
                            </div>
                            <span className="text-sm text-gray-600">{coin.score}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>تصنيف العملات حسب نوع الفرصة</CardTitle>
              <CardDescription>
                تصنيف ذكي بناءً على التحليل الفني والأساسي وحالة السوق
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-green-600">شراء قوي</Badge>
                    <span className="text-sm text-muted-foreground">درجة ≥ 65</span>
                  </div>
                  <p className="text-sm">عملات بإشارة شراء قوية - فرصة استثمار ممتازة</p>
                </div>
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-green-500">شراء</Badge>
                    <span className="text-sm text-muted-foreground">درجة 55-64</span>
                  </div>
                  <p className="text-sm">عملات بإشارة شراء - فرصة جيدة للدخول</p>
                </div>
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-yellow-500">احتفاظ</Badge>
                    <span className="text-sm text-muted-foreground">درجة 45-54</span>
                  </div>
                  <p className="text-sm">عملات محايدة - انتظار فرصة أفضل</p>
                </div>
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-red-500">بيع</Badge>
                    <span className="text-sm text-muted-foreground">درجة 35-44</span>
                  </div>
                  <p className="text-sm">عملات بإشارة بيع - توخي الحذر</p>
                </div>
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-red-600">بيع قوي</Badge>
                    <span className="text-sm text-muted-foreground">درجة {'<'} 35</span>
                  </div>
                  <p className="text-sm">عملات بخطر عالي - تجنب</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* All Coins Tab */}
        <TabsContent value="all" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div>
                  <CardTitle>كل العملات</CardTitle>
                  <CardDescription>{filteredData.length} عملة</CardDescription>
                </div>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="بحث..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pr-9 w-40"
                    />
                  </div>
                  <select
                    value={signalFilter}
                    onChange={(e) => setSignalFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg"
                  >
                    <option value="ALL">الكل</option>
                    <option value="BUY">شراء</option>
                    <option value="HOLD">احتفاظ</option>
                    <option value="SELL">بيع</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>العملة</TableHead>
                      <TableHead>السعر</TableHead>
                      <TableHead>24h</TableHead>
                      <TableHead>الإشارة</TableHead>
                      <TableHead>القوة</TableHead>
                      <TableHead>الدرجة</TableHead>
                      <TableHead>النوع</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredData.map((coin, i) => (
                      <TableRow key={coin.id} className="cursor-pointer hover:bg-muted/50">
                        <TableCell className="font-mono text-muted-foreground">{coin.market_cap_rank}</TableCell>
                        <TableCell>
                          <div className="font-bold">{coin.symbol}</div>
                          <div className="text-xs text-muted-foreground">{coin.name}</div>
                        </TableCell>
                        <TableCell>{formatPrice(coin.price)}</TableCell>
                        <TableCell className={cn(coin.change_24h >= 0 ? 'text-green-600' : 'text-red-600')}>
                          <div className="flex items-center gap-1">
                            {coin.change_24h >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                            {formatPercent(coin.change_24h)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={cn('text-white', SIGNAL_CONFIG[coin.signal as keyof typeof SIGNAL_CONFIG]?.bg || 'bg-gray-500')}>
                            {SIGNAL_CONFIG[coin.signal as keyof typeof SIGNAL_CONFIG]?.icon} {coin.signal_ar}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STRENGTH_CONFIG[coin.strength as keyof typeof STRENGTH_CONFIG]?.bg}>
                            {STRENGTH_CONFIG[coin.strength as keyof typeof STRENGTH_CONFIG]?.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className={cn('font-bold', coin.score >= 60 ? 'text-green-600' : coin.score >= 40 ? 'text-yellow-600' : 'text-red-600')}>
                            {coin.score}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{OPPORTUNITY_CONFIG[coin.opportunity_type as keyof typeof OPPORTUNITY_CONFIG]?.icon}</span>
                          <span className="text-xs mr-1">{OPPORTUNITY_CONFIG[coin.opportunity_type as keyof typeof OPPORTUNITY_CONFIG]?.label}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Opportunities Tab */}
        <TabsContent value="opportunities" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                أفضل الفرص
              </CardTitle>
              <CardDescription>
                العملات ذات إشارة شراء مرتبة حسب الدرجة
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredData.filter(c => c.signal === 'STRONG_BUY' || c.signal === 'BUY').length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredData
                    .filter(c => c.signal === 'STRONG_BUY' || c.signal === 'BUY')
                    .slice(0, 12)
                    .map((coin) => (
                      <Card key={coin.id} className={cn(
                        "border-2",
                        coin.signal === 'STRONG_BUY' ? 'border-green-500' : 'border-green-300'
                      )}>
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <h4 className="font-bold text-lg">{coin.symbol}</h4>
                              <p className="text-sm text-muted-foreground">{coin.name}</p>
                            </div>
                            <Badge className={cn('text-white', SIGNAL_CONFIG[coin.signal as keyof typeof SIGNAL_CONFIG]?.bg)}>
                              {coin.signal_ar}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">السعر:</span>
                              <span className="font-bold mr-1">{formatPrice(coin.price)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">24h:</span>
                              <span className={cn('font-bold mr-1', coin.change_24h >= 0 ? 'text-green-600' : 'text-red-600')}>
                                {formatPercent(coin.change_24h)}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">الدرجة:</span>
                              <span className="font-bold text-green-600 mr-1">{coin.score}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">الثقة:</span>
                              <span className="font-bold mr-1">{coin.confidence}%</span>
                            </div>
                          </div>
                          {coin.reasons.length > 0 && (
                            <div className="mt-3 pt-3 border-t">
                              <p className="text-xs text-green-600">✅ {coin.reasons[0]}</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  <Star className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>لا توجد فرص شراء قوية حالياً</p>
                  <p className="text-sm mt-2">تحقق من حالة السوق وانتظر فرصاً أفضل</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>خطأ</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default CryptoMaestroPage;
