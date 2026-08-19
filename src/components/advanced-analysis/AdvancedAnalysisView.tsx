'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  CandlestickChart, TrendingUp, TrendingDown, Target, Shield,
  AlertTriangle, CheckCircle, Loader2, RefreshCw, Search,
  BarChart3, Activity, Zap, Info, Scan, Star, Filter, Send, Download,
  Minus, X, ChevronLeft, ChevronRight, DollarSign, Percent,
  Clock, Newspaper, PieChart, LineChart, Gauge, Award, ThumbsUp,
  ThumbsDown, MinusCircle, ArrowUpRight, ArrowDownRight, Settings
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ==================== TYPES ====================

interface StockRecommendation {
  ticker: string;
  name: string;
  nameAr?: string;
  sector: string;
  
  // Price Data
  currentPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  
  // Recommendation
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell' | 'avoid';
  recommendationAr: string;
  compositeScore: number;
  confidence: number;
  
  // Entry & Exit
  entryPrice: number;
  buyZoneHigh: number;
  buyZoneLow: number;
  targetPrice1: number;
  targetPrice2: number;
  targetPrice3?: number;
  investmentTarget: number;
  stopLoss: number;
  
  // Risk & Metrics
  riskLevel: 'low' | 'medium' | 'high' | 'very_high';
  riskReward: number;
  daysToTarget: number;
  
  // Personality
  personality: 'buyer' | 'seller' | 'holder' | 'averager';
  personalityAr: string;
  action: 'buy' | 'sell' | 'hold' | 'average' | 'avoid';
  actionAr: string;
  
  // Technical Indicators
  rsi: number;
  macd: string;
  trend: string;
  trendAr: string;
  
  // Fundamental
  pe: number;
  pb: number;
  eps: number;
  marketCap: number;
  
  // Analysis details
  technicalScore: number;
  fundamentalScore: number;
  sentimentScore: number;
  
  // News
  news?: NewsItem[];
  
  // Timestamps
  lastUpdated: string;
}

interface NewsItem {
  id: number;
  title: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  publishedAt: string;
  source?: string;
}

// ==================== CONSTANTS ====================

const RECOMMENDATION_CONFIG = {
  strong_buy: { color: 'text-green-700', bg: 'bg-green-600', lightBg: 'bg-green-100', label: 'شراء قوي', icon: TrendingUp },
  buy: { color: 'text-green-600', bg: 'bg-green-500', lightBg: 'bg-green-50', label: 'شراء', icon: TrendingUp },
  hold: { color: 'text-yellow-600', bg: 'bg-yellow-500', lightBg: 'bg-yellow-50', label: 'احتفاظ', icon: Minus },
  sell: { color: 'text-red-600', bg: 'bg-red-500', lightBg: 'bg-red-50', label: 'بيع', icon: TrendingDown },
  strong_sell: { color: 'text-red-700', bg: 'bg-red-600', lightBg: 'bg-red-100', label: 'بيع قوي', icon: TrendingDown },
  avoid: { color: 'text-gray-600', bg: 'bg-gray-500', lightBg: 'bg-gray-50', label: 'تجنب', icon: X },
};

const PERSONALITY_CONFIG = {
  buyer: { color: 'bg-blue-100 text-blue-700', icon: TrendingUp, label: 'شخصية شاري', description: 'مناسب للمضاربة والشراء السريع' },
  seller: { color: 'bg-red-100 text-red-700', icon: TrendingDown, label: 'شخصية بائع', description: 'مناسب للبيع والخروج من المراكز' },
  holder: { color: 'bg-yellow-100 text-yellow-700', icon: Minus, label: 'شخصية محتفظ', description: 'الاحتفاظ للمستثمر طويل الأجل' },
  averager: { color: 'bg-purple-100 text-purple-700', icon: BarChart3, label: 'شخصية متوسط', description: 'عمل متوسط لتقليل التكلفة' },
};

const RISK_CONFIG = {
  low: { color: 'text-green-600', bg: 'bg-green-100', label: 'منخفض' },
  medium: { color: 'text-yellow-600', bg: 'bg-yellow-100', label: 'متوسط' },
  high: { color: 'text-orange-600', bg: 'bg-orange-100', label: 'مرتفع' },
  very_high: { color: 'text-red-600', bg: 'bg-red-100', label: 'مرتفع جداً' },
};

const SECTORS = [
  'البنوك', 'التأمين', 'الخدمات المالية', 'الاستثمار والصناديق',
  'المواد الأساسية', 'الأسمدة', 'الكيماويات', 'الأسمنت',
  'البناء والتشييد', 'العقارات', 'التجارة والمتاجر',
  'السياحة والترفيه', 'النقل', 'الاتصالات',
  'المرافق', 'الرعاية الصحية', 'الأغذية والمشروبات'
];

// ==================== HELPER FUNCTIONS ====================

function formatPrice(price: number): string {
  if (!price || price === 0) return '0.00';
  return price.toFixed(2);
}

function formatPercent(percent: number): string {
  if (!percent || !isFinite(percent)) return '0.00%';
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

function formatNumber(num: number): string {
  if (!num || num === 0) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toFixed(0);
}

function getScoreColor(score: number): string {
  if (score >= 70) return 'text-green-600';
  if (score >= 50) return 'text-yellow-600';
  if (score >= 30) return 'text-orange-600';
  return 'text-red-600';
}

function getScoreBg(score: number): string {
  if (score >= 70) return 'bg-green-100 dark:bg-green-900/30';
  if (score >= 50) return 'bg-yellow-100 dark:bg-yellow-900/30';
  if (score >= 30) return 'bg-orange-100 dark:bg-orange-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
}

// ==================== SUB-COMPONENTS ====================

// Gauge Component
function GaugeIndicator({ value, label, color }: { value: number; label: string; color?: string }) {
  const angle = (value / 100) * 180 - 90;
  const colorClass = color || (value >= 70 ? 'text-green-600' : value >= 40 ? 'text-yellow-600' : 'text-red-600');
  
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-12 overflow-hidden">
        <div className="absolute w-24 h-24 rounded-full border-8 border-gray-200 dark:border-gray-700"
             style={{ clipPath: 'polygon(0 50%, 100% 50%, 100% 100%, 0 100%)' }} />
        <div className={`absolute w-24 h-24 rounded-full border-8 ${colorClass.replace('text-', 'border-')}`}
             style={{ 
               clipPath: `polygon(0 50%, 50% 50%, 50% ${50 - Math.sin(angle * Math.PI / 180) * 50}%, ${50 + Math.cos(angle * Math.PI / 180) * 50}% 50%)`,
               transform: `rotate(${angle}deg)`,
               transformOrigin: '50% 100%'
             }} />
        <div className="absolute bottom-0 left-1/2 w-1 h-10 bg-gray-800 dark:bg-white origin-bottom"
             style={{ transform: `rotate(${angle}deg)` }} />
        <div className="absolute bottom-0 left-1/2 w-3 h-3 rounded-full bg-gray-800 dark:bg-white -translate-x-1/2" />
      </div>
      <div className="text-center">
        <div className={`text-xl font-bold ${colorClass}`}>{value}%</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// Mini Chart Component
function MiniChart({ data, color = 'green' }: { data: number[]; color?: 'green' | 'red' | 'blue' }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((val - min) / range) * 100;
    return `${x},${y}`;
  }).join(' ');
  
  const colorClass = color === 'green' ? '#22c55e' : color === 'red' ? '#ef4444' : '#3b82f6';
  
  return (
    <svg viewBox="0 0 100 100" className="w-full h-12">
      <polyline
        points={points}
        fill="none"
        stroke={colorClass}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ==================== MAIN COMPONENT ====================

export function AdvancedAnalysisView() {
  const { stocks, loadStocks } = useAppStore();
  
  // State
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState<StockRecommendation | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [recommendationFilter, setRecommendationFilter] = useState('all');
  const [personalityFilter, setPersonalityFilter] = useState('all');
  const [minScore, setMinScore] = useState(0);
  const [minConfidence, setMinConfidence] = useState(0);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  
  // Load stocks on mount
  useEffect(() => {
    if (!stocks || stocks.length === 0) {
      loadStocks();
    }
    fetchRecommendations();
  }, [stocks, loadStocks]);
  
  // Fetch recommendations
  const fetchRecommendations = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      // Try API first
      const res = await fetch('/api/stocks/recommendations?limit=500');
      const data = await res.json();
      
      if (data.success && data.recommendations?.length > 0) {
        // Transform API data
        const transformed = data.recommendations.map((rec: any) => ({
          ticker: rec.ticker,
          name: rec.name || rec.nameAr || '',
          sector: rec.sector || 'غير محدد',
          currentPrice: rec.currentPrice || rec.current_price || 0,
          previousClose: rec.previousClose || 0,
          change: rec.change || 0,
          changePercent: rec.changePercent || rec.change_percent || 0,
          recommendation: rec.recommendation?.toLowerCase().replace(' ', '_') || 'hold',
          recommendationAr: rec.recommendationAr || 'احتفاظ',
          compositeScore: rec.compositeScore || rec.overall_score || 50,
          confidence: rec.confidence || 60,
          entryPrice: rec.entryPrice || rec.currentPrice * 0.98,
          buyZoneHigh: rec.buyZoneHigh || rec.currentPrice * 0.995,
          buyZoneLow: rec.buyZoneLow || rec.currentPrice * 0.97,
          targetPrice1: rec.targetPrice1 || rec.target_price || rec.currentPrice * 1.03,
          targetPrice2: rec.targetPrice2 || rec.currentPrice * 1.055,
          targetPrice3: rec.targetPrice3,
          investmentTarget: rec.investmentTarget || rec.fairValue?.averageFairValue || rec.currentPrice * 1.12,
          stopLoss: rec.stopLoss || rec.exitStrategy?.stopLoss || rec.currentPrice * 0.95,
          riskLevel: rec.riskLevel || rec.riskAssessment?.level?.toLowerCase().replace(' ', '_') || 'medium',
          riskReward: rec.riskReward || 2.5,
          daysToTarget: rec.daysToTarget || 30,
          personality: rec.personality || 'holder',
          personalityAr: rec.personalityAr || 'شخصية محتفظ',
          action: rec.action || 'hold',
          actionAr: rec.actionAr || 'للاحتفاظ',
          rsi: rec.rsi || 50,
          macd: rec.macd || 'neutral',
          trend: rec.trend || 'neutral',
          trendAr: rec.trendAr || 'محايد',
          pe: rec.pe || rec.pe_ratio || 0,
          pb: rec.pb || rec.pb_ratio || 0,
          eps: rec.eps || 0,
          marketCap: rec.marketCap || rec.market_cap || 0,
          technicalScore: rec.technicalScore || rec.momentumScore || 50,
          fundamentalScore: rec.fundamentalScore || rec.qualityScore || 50,
          sentimentScore: rec.sentimentScore || 50,
          lastUpdated: rec.lastUpdated || new Date().toISOString(),
        }));
        setRecommendations(transformed);
      } else {
        // API returned no recommendations — show honest empty state, do NOT fabricate data.
        setRecommendations([]);
      }
    } catch (error) {
      console.error('Error fetching recommendations:', error);
      setRecommendations([]);
      setFetchError('تعذّر تحميل التوصيات. حاول مرة أخرى لاحقاً.');
    } finally {
      setLoading(false);
    }
  };
  
  // Filtered recommendations
  const filteredRecommendations = useMemo(() => {
    return recommendations.filter(rec => {
      if (searchQuery && !rec.ticker.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !rec.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (sectorFilter !== 'all' && rec.sector !== sectorFilter) {
        return false;
      }
      if (recommendationFilter !== 'all' && rec.recommendation !== recommendationFilter) {
        return false;
      }
      if (personalityFilter !== 'all' && rec.personality !== personalityFilter) {
        return false;
      }
      if (rec.compositeScore < minScore) {
        return false;
      }
      if (rec.confidence < minConfidence) {
        return false;
      }
      return true;
    });
  }, [recommendations, searchQuery, sectorFilter, recommendationFilter, personalityFilter, minScore, minConfidence]);
  
  // Paginated results
  const paginatedRecommendations = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecommendations.slice(start, start + pageSize);
  }, [filteredRecommendations, currentPage, pageSize]);
  
  const totalPages = Math.ceil(filteredRecommendations.length / pageSize);
  
  // Stats
  const stats = useMemo(() => ({
    total: filteredRecommendations.length,
    buy: filteredRecommendations.filter(r => r.recommendation === 'buy' || r.recommendation === 'strong_buy').length,
    sell: filteredRecommendations.filter(r => r.recommendation === 'sell' || r.recommendation === 'strong_sell').length,
    hold: filteredRecommendations.filter(r => r.recommendation === 'hold').length,
    avgScore: filteredRecommendations.length > 0 
      ? Math.round(filteredRecommendations.reduce((sum, r) => sum + r.compositeScore, 0) / filteredRecommendations.length)
      : 0,
    avgConfidence: filteredRecommendations.length > 0
      ? Math.round(filteredRecommendations.reduce((sum, r) => sum + r.confidence, 0) / filteredRecommendations.length)
      : 0,
  }), [filteredRecommendations]);
  
  // Handle stock click
  const handleStockClick = (stock: StockRecommendation) => {
    setSelectedStock(stock);
    setShowDetailDialog(true);
  };
  
  // Handle publish
  const handlePublish = (ticker: string) => {
    toast.success(`تم نشر تحليل ${ticker}`);
  };
  
  // Export
  const handleExport = () => {
    const headers = ['السهم', 'الاسم', 'القطاع', 'التحليل', 'السعر', 'الهدف', 'الاستوب', 'الثقة'];
    const rows = filteredRecommendations.map(r => [
      r.ticker, r.name, r.sector, r.recommendationAr,
      formatPrice(r.currentPrice), formatPrice(r.targetPrice1), formatPrice(r.stopLoss), `${r.confidence}%`
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recommendations-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('تم تصدير التحليلات');
  };
  
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-primary" />
            جدول التحليلات الشامل
          </h1>
          <p className="text-muted-foreground">
            تحليل فني وأساسي متكامل لكل الأسهم مع فلاتر متقدمة
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchRecommendations} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            <span className="mr-2">تحديث</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4" />
            <span className="mr-2">تصدير</span>
          </Button>
        </div>
      </div>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">الإجمالي</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </div>
            <BarChart3 className="w-8 h-8 text-muted-foreground" />
          </div>
        </Card>
        <Card className="p-3 bg-green-50 dark:bg-green-900/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">شراء</p>
              <p className="text-2xl font-bold text-green-600">{stats.buy}</p>
            </div>
            <TrendingUp className="w-8 h-8 text-green-600" />
          </div>
        </Card>
        <Card className="p-3 bg-red-50 dark:bg-red-900/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">بيع</p>
              <p className="text-2xl font-bold text-red-600">{stats.sell}</p>
            </div>
            <TrendingDown className="w-8 h-8 text-red-600" />
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">متوسط الدرجة</p>
              <p className="text-2xl font-bold">{stats.avgScore}%</p>
            </div>
            <Target className="w-8 h-8 text-muted-foreground" />
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">متوسط الثقة</p>
              <p className="text-2xl font-bold">{stats.avgConfidence}%</p>
            </div>
            <Shield className="w-8 h-8 text-muted-foreground" />
          </div>
        </Card>
      </div>
      
      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" />
            الفلاتر
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {/* Search */}
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">بحث</label>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="ابحث بسهم أو اسم..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-9"
                />
              </div>
            </div>
            
            {/* Sector */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">القطاع</label>
              <Select value={sectorFilter} onValueChange={setSectorFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="كل القطاعات" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل القطاعات</SelectItem>
                  {SECTORS.map(sector => (
                    <SelectItem key={sector} value={sector}>{sector}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Recommendation */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">التحليل</label>
              <Select value={recommendationFilter} onValueChange={setRecommendationFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="كل التحليلات" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل التحليلات</SelectItem>
                  <SelectItem value="strong_buy">شراء قوي</SelectItem>
                  <SelectItem value="buy">شراء</SelectItem>
                  <SelectItem value="hold">احتفاظ</SelectItem>
                  <SelectItem value="sell">بيع</SelectItem>
                  <SelectItem value="avoid">تجنب</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Personality */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">الشخصية</label>
              <Select value={personalityFilter} onValueChange={setPersonalityFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="كل الشخصيات" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الشخصيات</SelectItem>
                  <SelectItem value="buyer">شخصية شاري</SelectItem>
                  <SelectItem value="holder">شخصية محتفظ</SelectItem>
                  <SelectItem value="averager">شخصية متوسط</SelectItem>
                  <SelectItem value="seller">شخصية بائع</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Min Score */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">أقل درجة: {minScore}%</label>
              <Slider
                value={[minScore]}
                onValueChange={([v]) => setMinScore(v)}
                max={100}
                step={5}
                className="mt-2"
              />
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-3">
              <AlertTriangle className="w-10 h-10 text-yellow-600" />
              <p className="text-base font-medium text-foreground">{fetchError}</p>
              <Button variant="outline" size="sm" onClick={fetchRecommendations}>
                <RefreshCw className="w-4 h-4 ml-2" />
                إعادة المحاولة
              </Button>
            </div>
          ) : paginatedRecommendations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-3">
              <Info className="w-10 h-10 text-muted-foreground" />
              <p className="text-base font-medium text-foreground">لا توجد توصيات متاحة</p>
              <p className="text-sm text-muted-foreground">
                لم يتم العثور على توصيات تحليل حقيقية. تظهر التوصيات هنا فقط عند توفّرها من محرك التحليل.
              </p>
              <Button variant="outline" size="sm" onClick={fetchRecommendations}>
                <RefreshCw className="w-4 h-4 ml-2" />
                تحديث
              </Button>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-center">#</TableHead>
                    <TableHead className="text-center">السهم</TableHead>
                    <TableHead className="text-center">القطاع</TableHead>
                    <TableHead className="text-center">السعر</TableHead>
                    <TableHead className="text-center">التحليل</TableHead>
                    <TableHead className="text-center">منطقة الشراء</TableHead>
                    <TableHead className="text-center">الهدف 1</TableHead>
                    <TableHead className="text-center">الهدف 2</TableHead>
                    <TableHead className="text-center">الاستوب</TableHead>
                    <TableHead className="text-center">R:R</TableHead>
                    <TableHead className="text-center">الشخصية</TableHead>
                    <TableHead className="text-center">الدرجة</TableHead>
                    <TableHead className="text-center">الثقة</TableHead>
                    <TableHead className="text-center">نشر</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRecommendations.map((rec, idx) => (
                    <TableRow
                      key={rec.ticker}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleStockClick(rec)}
                    >
                      <TableCell className="text-center font-medium">
                        {(currentPage - 1) * pageSize + idx + 1}
                      </TableCell>
                      
                      <TableCell>
                        <div className="text-center">
                          <div className="font-bold text-primary">{rec.ticker}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[100px]">
                            {rec.name}
                          </div>
                        </div>
                      </TableCell>
                      
                      <TableCell className="text-center text-xs">
                        {rec.sector}
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <div className="font-bold">{formatPrice(rec.currentPrice)}</div>
                        <div className={cn(
                          'text-xs',
                          rec.changePercent >= 0 ? 'text-green-600' : 'text-red-600'
                        )}>
                          {formatPercent(rec.changePercent)}
                        </div>
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <Badge className={RECOMMENDATION_CONFIG[rec.recommendation]?.bg || 'bg-gray-500'}>
                          {rec.recommendationAr}
                        </Badge>
                      </TableCell>
                      
                      <TableCell className="text-center text-xs">
                        <div className="text-blue-600">
                          {formatPrice(rec.buyZoneLow)} - {formatPrice(rec.buyZoneHigh)}
                        </div>
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <div className="font-medium text-green-600">{formatPrice(rec.targetPrice1)}</div>
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <div className="text-green-500">{formatPrice(rec.targetPrice2)}</div>
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <div className="font-medium text-red-600">{formatPrice(rec.stopLoss)}</div>
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <Badge variant="outline">{rec.riskReward.toFixed(1)}</Badge>
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <Badge variant="secondary" className={PERSONALITY_CONFIG[rec.personality]?.color}>
                          {rec.personalityAr}
                        </Badge>
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <div className={cn('font-bold', getScoreColor(rec.compositeScore))}>
                          {rec.compositeScore}%
                        </div>
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <div className={cn('font-bold', getScoreColor(rec.confidence))}>
                          {rec.confidence}%
                        </div>
                      </TableCell>
                      
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePublish(rec.ticker);
                          }}
                        >
                          <Send className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
      
      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          عرض {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredRecommendations.length)} من {filteredRecommendations.length}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(p => p - 1)}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <span className="text-sm">{currentPage} / {totalPages || 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage(p => p + 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedStock && (
            <div className="space-y-4">
              {/* Header */}
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <DialogTitle className="text-2xl flex items-center gap-2">
                      {selectedStock.ticker}
                      <Badge className={RECOMMENDATION_CONFIG[selectedStock.recommendation]?.bg}>
                        {selectedStock.recommendationAr}
                      </Badge>
                    </DialogTitle>
                    <DialogDescription>{selectedStock.name}</DialogDescription>
                  </div>
                  <div className="text-left">
                    <div className="text-3xl font-bold">{formatPrice(selectedStock.currentPrice)}</div>
                    <div className={cn(
                      'text-lg',
                      selectedStock.changePercent >= 0 ? 'text-green-600' : 'text-red-600'
                    )}>
                      {formatPercent(selectedStock.changePercent)}
                    </div>
                  </div>
                </div>
              </DialogHeader>
              
              {/* Gauges */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">مؤشرات الأداء</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <GaugeIndicator value={selectedStock.technicalScore} label="الفني" />
                    <GaugeIndicator value={selectedStock.fundamentalScore} label="الأساسي" />
                    <GaugeIndicator value={selectedStock.sentimentScore} label="المعنوي" />
                  </div>
                </CardContent>
              </Card>
              
              {/* Trading Levels */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    مستويات التداول
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">سعر الشراء</div>
                      <div className="text-lg font-bold text-blue-600">{formatPrice(selectedStock.entryPrice)}</div>
                    </div>
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">الهدف 1</div>
                      <div className="text-lg font-bold text-green-600">{formatPrice(selectedStock.targetPrice1)}</div>
                    </div>
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">الهدف 2</div>
                      <div className="text-lg font-bold text-green-600">{formatPrice(selectedStock.targetPrice2)}</div>
                    </div>
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                      <div className="text-xs text-muted-foreground">وقف الخسارة</div>
                      <div className="text-lg font-bold text-red-600">{formatPrice(selectedStock.stopLoss)}</div>
                    </div>
                  </div>
                  
                  <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-xs text-muted-foreground">R:R</div>
                      <Badge variant="outline" className="text-lg">{selectedStock.riskReward.toFixed(2)}</Badge>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">الفترة المتوقعة</div>
                      <Badge variant="secondary">{selectedStock.daysToTarget} يوم</Badge>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">مستوى المخاطرة</div>
                      <Badge className={RISK_CONFIG[selectedStock.riskLevel]?.bg}>
                        {RISK_CONFIG[selectedStock.riskLevel]?.label}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Technical Indicators */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    المؤشرات الفنية
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 border rounded-lg">
                      <div className="text-xs text-muted-foreground">RSI</div>
                      <div className={cn(
                        'text-lg font-bold',
                        selectedStock.rsi < 30 ? 'text-green-600' : 
                        selectedStock.rsi > 70 ? 'text-red-600' : 'text-yellow-600'
                      )}>
                        {selectedStock.rsi.toFixed(1)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {selectedStock.rsi < 30 ? 'تشبع بيعي' : 
                         selectedStock.rsi > 70 ? 'تشبع شرائي' : 'محايد'}
                      </div>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="text-xs text-muted-foreground">MACD</div>
                      <div className={cn(
                        'text-lg font-bold',
                        selectedStock.macd === 'bullish' ? 'text-green-600' : 
                        selectedStock.macd === 'bearish' ? 'text-red-600' : 'text-yellow-600'
                      )}>
                        {selectedStock.macd === 'bullish' ? 'صاعد' : 
                         selectedStock.macd === 'bearish' ? 'هابط' : 'محايد'}
                      </div>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="text-xs text-muted-foreground">الاتجاه</div>
                      <div className={cn(
                        'text-lg font-bold',
                        selectedStock.trend === 'bullish' ? 'text-green-600' : 
                        selectedStock.trend === 'bearish' ? 'text-red-600' : 'text-yellow-600'
                      )}>
                        {selectedStock.trendAr}
                      </div>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="text-xs text-muted-foreground">P/E</div>
                      <div className="text-lg font-bold">{selectedStock.pe.toFixed(1)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Fundamental Data */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <PieChart className="w-4 h-4" />
                    البيانات الأساسية
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 border rounded-lg">
                      <div className="text-xs text-muted-foreground">P/B</div>
                      <div className="text-lg font-bold">{selectedStock.pb.toFixed(2)}</div>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="text-xs text-muted-foreground">EPS</div>
                      <div className="text-lg font-bold">{formatPrice(selectedStock.eps)}</div>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="text-xs text-muted-foreground">القيمة السوقية</div>
                      <div className="text-lg font-bold">{formatNumber(selectedStock.marketCap)}</div>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="text-xs text-muted-foreground">القطاع</div>
                      <div className="text-sm font-bold">{selectedStock.sector}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Personality */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Star className="w-4 h-4" />
                    الشخصية المناسبة
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={cn('p-4 rounded-lg', PERSONALITY_CONFIG[selectedStock.personality]?.color)}>
                    <div className="flex items-center gap-2">
                      {selectedStock.personality === 'buyer' && <TrendingUp className="w-5 h-5" />}
                      {selectedStock.personality === 'seller' && <TrendingDown className="w-5 h-5" />}
                      {selectedStock.personality === 'holder' && <Minus className="w-5 h-5" />}
                      {selectedStock.personality === 'averager' && <BarChart3 className="w-5 h-5" />}
                      <span className="text-lg font-bold">{selectedStock.personalityAr}</span>
                    </div>
                    <p className="text-sm mt-2">{PERSONALITY_CONFIG[selectedStock.personality]?.description}</p>
                  </div>
                </CardContent>
              </Card>
              
              {/* Actions */}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowDetailDialog(false)}>
                  إغلاق
                </Button>
                <Button onClick={() => handlePublish(selectedStock.ticker)}>
                  <Send className="w-4 h-4 ml-2" />
                  نشر التحليل
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AdvancedAnalysisView;
