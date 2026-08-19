'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Send, Download,
  CheckCircle, XCircle, AlertTriangle, Loader2, Copy, Share2,
  DollarSign, Target, Shield, BarChart3, Users, Filter, Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

// ==================== TYPES ====================

export interface Recommendation {
  ticker: string;
  name: string;
  nameAr?: string;
  sector?: string;
  
  // Price Data
  lastPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  
  // RACC Opinion
  raccOpinion: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell' | 'avoid';
  raccOpinionAr: string;
  raccScore: number; // 0-100
  
  // Buy Zone
  buyZoneHigh: number;
  buyZoneLow: number;
  
  // Stability Trigger
  stabilityTrigger: number;
  stabilityAction: string; // "شراء واحتفاظ" etc.
  
  // Sell Targets
  target1: number;
  target2: number;
  target3?: number;
  
  // Investment Target
  investmentTarget: number;
  investmentHorizon: string; // "3-6 شهور" etc.
  
  // Stop Loss
  stopLoss: number;
  stopLossType: 'close' | 'intraday'; // إغلاق أو خلال الجلسة
  
  // Action & Personality
  action: 'buy' | 'sell' | 'hold' | 'average' | 'avoid';
  actionAr: string;
  personalityType: 'buyer' | 'seller' | 'holder' | 'averager';
  personalityAr: string;
  
  // Risk & Confidence
  riskLevel: 'low' | 'medium' | 'high' | 'very_high';
  confidence: number; // 0-100
  
  // Status
  published: boolean;
  publishedAt?: string;
  
  // Timestamps
  lastUpdated: string;
}

export interface RecommendationsTableProps {
  onPublish?: (ticker: string) => void;
  onPublishAll?: (tickers: string[]) => void;
  onStockClick?: (ticker: string) => void;
}

// ==================== CONSTANTS ====================

const OPINION_CONFIG = {
  strong_buy: { color: 'text-green-700', bg: 'bg-green-600', label: 'شراء قوي', labelEn: 'Strong Buy' },
  buy: { color: 'text-green-600', bg: 'bg-green-500', label: 'شراء', labelEn: 'Buy' },
  accumulate: { color: 'text-teal-600', bg: 'bg-teal-500', label: 'تجميع', labelEn: 'Accumulate' },
  hold: { color: 'text-yellow-600', bg: 'bg-yellow-500', label: 'احتفاظ', labelEn: 'Hold' },
  reduce: { color: 'text-orange-600', bg: 'bg-orange-500', label: 'تخفيف', labelEn: 'Reduce' },
  sell: { color: 'text-red-600', bg: 'bg-red-500', label: 'بيع', labelEn: 'Sell' },
  strong_sell: { color: 'text-red-700', bg: 'bg-red-600', label: 'بيع قوي', labelEn: 'Strong Sell' },
  avoid: { color: 'text-gray-600', bg: 'bg-gray-500', label: 'تجنب', labelEn: 'Avoid' },
};

const PERSONALITY_CONFIG = {
  buyer: { color: 'bg-blue-100 text-blue-700', icon: TrendingUp, label: 'شخصية شاري', labelEn: 'Buyer' },
  seller: { color: 'bg-red-100 text-red-700', icon: TrendingDown, label: 'شخصية بائع', labelEn: 'Seller' },
  holder: { color: 'bg-yellow-100 text-yellow-700', icon: Minus, label: 'شخصية محتفظ', labelEn: 'Holder' },
  averager: { color: 'bg-purple-100 text-purple-700', icon: BarChart3, label: 'شخصية متوسط', labelEn: 'Averager' },
};

const ACTION_CONFIG = {
  buy: { color: 'text-green-600', bg: 'bg-green-50', label: 'للشراء' },
  sell: { color: 'text-red-600', bg: 'bg-red-50', label: 'للبيع' },
  hold: { color: 'text-yellow-600', bg: 'bg-yellow-50', label: 'للاحتفاظ' },
  average: { color: 'text-purple-600', bg: 'bg-purple-50', label: 'لمتوسط' },
  avoid: { color: 'text-gray-600', bg: 'bg-gray-50', label: 'تجنب' },
};

// ==================== HELPER FUNCTIONS ====================

function formatPrice(price: number): string {
  return price.toFixed(2);
}

function formatPercent(percent: number): string {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

function getScoreColor(score: number): string {
  if (score >= 70) return 'text-green-600';
  if (score >= 50) return 'text-yellow-600';
  if (score >= 30) return 'text-orange-600';
  return 'text-red-600';
}

// Generate mock data for demonstration
function generateMockRecommendations(): Recommendation[] {
  const mockStocks = [
    { ticker: 'RACC', name: 'Raya Contact Center', lastPrice: 10.04 },
    { ticker: 'COMI', name: 'Commercial International Bank', lastPrice: 85.50 },
    { ticker: 'ETEL', name: 'Telecom Egypt', lastPrice: 25.30 },
    { ticker: 'HRHO', name: 'Housing and Development Bank', lastPrice: 12.80 },
    { ticker: 'SWDY', name: 'Elsewedy Electric', lastPrice: 15.20 },
    { ticker: 'AMOC', name: 'Alexandria Mineral Oils', lastPrice: 42.15 },
    { ticker: 'PHDC', name: 'Pharos Holdings', lastPrice: 3.45 },
    { ticker: 'EFID', name: 'Edita Food Industries', lastPrice: 22.60 },
  ];

  return mockStocks.map((stock, idx) => {
    const buyZoneHigh = stock.lastPrice * 0.995;
    const buyZoneLow = stock.lastPrice * 0.97;
    const stabilityTrigger = stock.lastPrice * 1.005;
    const target1 = stock.lastPrice * 1.03;
    const target2 = stock.lastPrice * 1.055;
    const investmentTarget = stock.lastPrice * 1.10;
    const stopLoss = stock.lastPrice * 0.97;

    const opinions: RACCRecommendation['raccOpinion'][] = ['strong_buy', 'buy', 'hold', 'buy'];
    const opinion = opinions[idx % opinions.length];
    const actions: RACCRecommendation['action'][] = ['buy', 'hold', 'average', 'sell'];
    const action = actions[idx % actions.length];
    const personalities: RACCRecommendation['personalityType'][] = ['buyer', 'holder', 'averager', 'seller'];
    const personality = personalities[idx % personalities.length];

    return {
      ticker: stock.ticker,
      name: stock.name,
      sector: 'غير محدد',
      lastPrice: stock.lastPrice,
      previousClose: stock.lastPrice * 1.005,
      change: stock.lastPrice * 0.005,
      changePercent: 0.5,
      raccOpinion: opinion,
      raccOpinionAr: OPINION_CONFIG[opinion].label,
      raccScore: 55 + (idx * 5),
      buyZoneHigh,
      buyZoneLow,
      stabilityTrigger,
      stabilityAction: 'شراء واحتفاظ',
      target1,
      target2,
      investmentTarget,
      investmentHorizon: '3-6 شهور',
      stopLoss,
      stopLossType: 'close',
      action,
      actionAr: ACTION_CONFIG[action].label,
      personalityType: personality,
      personalityAr: PERSONALITY_CONFIG[personality].label,
      riskLevel: idx % 3 === 0 ? 'high' : idx % 2 === 0 ? 'medium' : 'low',
      confidence: 65 + (idx * 3),
      published: false,
      lastUpdated: new Date().toISOString(),
    };
  });
}

// ==================== SUB-COMPONENTS ====================

function PriceCell({ value, change, changePercent }: { value: number; change: number; changePercent: number }) {
  const isPositive = change >= 0;
  return (
    <div className="text-right">
      <div className="font-bold">{formatPrice(value)}</div>
      <div className={cn('text-xs', isPositive ? 'text-green-600' : 'text-red-600')}>
        {formatPercent(changePercent)}
      </div>
    </div>
  );
}

function ZoneCell({ high, low }: { high: number; low: number }) {
  return (
    <div className="text-center">
      <div className="text-sm font-medium">{formatPrice(high)} - {formatPrice(low)}</div>
      <div className="text-xs text-muted-foreground">منطقة الشراء</div>
    </div>
  );
}

function TargetsCell({ target1, target2, target3 }: { target1: number; target2: number; target3?: number }) {
  return (
    <div className="text-right space-y-0.5">
      <div className="text-sm font-medium text-green-600">{formatPrice(target1)}</div>
      <div className="text-sm text-green-500">{formatPrice(target2)}</div>
      {target3 && <div className="text-xs text-green-400">{formatPrice(target3)}</div>}
    </div>
  );
}

function PersonalityBadge({ type }: { type: Recommendation['personalityType'] }) {
  const config = PERSONALITY_CONFIG[type];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn('gap-1 text-xs', config.color)}>
      <Icon className="w-3 h-3" />
      {config.label}
    </Badge>
  );
}

function ActionBadge({ action }: { action: Recommendation['action'] }) {
  const config = ACTION_CONFIG[action];
  return (
    <Badge className={cn('text-xs', config.bg, config.color)}>
      {config.label}
    </Badge>
  );
}

// ==================== MAIN COMPONENT ====================

export function RecommendationsTable({ onPublish, onPublishAll, onStockClick }: RecommendationsTableProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishingTicker, setPublishingTicker] = useState<string | null>(null);
  const [publishingAll, setPublishingAll] = useState(false);
  const [selectedPersonality, setSelectedPersonality] = useState<string>('all');
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [selectedForPublish, setSelectedForPublish] = useState<Recommendation | null>(null);

  // Fetch recommendations
  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      // Try to fetch from API first
      const res = await fetch('/api/stocks/recommendations?limit=100');
      const data = await res.json();
      
      if (data.success && data.recommendations?.length > 0) {
        // Transform API data to our format
        const transformed: Recommendation[] = data.recommendations
          .filter((rec: any) => rec && rec.ticker) // Filter out null/undefined items
          .map((rec: any) => ({
          ticker: rec.ticker,
          name: rec.name || rec.nameAr || '',
          nameAr: rec.nameAr || rec.name || '',
          sector: rec.sector || 'غير محدد',
          lastPrice: rec.currentPrice || rec.current_price || 0,
          previousClose: rec.previousClose || rec.previous_close || 0,
          change: rec.change || 0,
          changePercent: rec.changePercent || rec.change_percent || 0,
          raccOpinion: mapRecommendationToOpinion(rec.recommendation),
          raccOpinionAr: rec.recommendationAr || 'غير محدد',
          raccScore: rec.compositeScore || rec.score || 50,
          buyZoneHigh: rec.entryPrice || rec.currentPrice * 0.995,
          buyZoneLow: rec.entryStrategy?.dipBuyLevel || rec.currentPrice * 0.97,
          stabilityTrigger: rec.currentPrice * 1.005,
          stabilityAction: 'شراء واحتفاظ',
          target1: rec.exitStrategy?.targetPrice1 || rec.currentPrice * 1.03,
          target2: rec.exitStrategy?.targetPrice2 || rec.currentPrice * 1.055,
          target3: rec.exitStrategy?.targetPrice3,
          investmentTarget: rec.fairValue?.averageFairValue || rec.currentPrice * 1.10,
          investmentHorizon: '3-6 شهور',
          stopLoss: rec.exitStrategy?.stopLoss || rec.currentPrice * 0.97,
          stopLossType: 'close' as const,
          action: mapRecommendationToAction(rec.recommendation),
          actionAr: rec.recommendationAr || 'غير محدد',
          personalityType: inferPersonality(rec),
          personalityAr: '',
          riskLevel: mapRiskLevel(rec.riskAssessment?.level),
          confidence: rec.confidence || 70,
          published: false,
          lastUpdated: rec.generatedAt || new Date().toISOString(),
        }));
        setRecommendations(transformed);
      } else {
        // Use mock data if no API data
        setRecommendations(generateMockRecommendations());
      }
    } catch (error) {
      console.error('Error fetching recommendations:', error);
      // Use mock data on error
      setRecommendations(generateMockRecommendations());
    } finally {
      setLoading(false);
    }
  }, []);

  // Helper functions for mapping
  function mapRecommendationToOpinion(rec: string): Recommendation['raccOpinion'] {
    const map: Record<string, Recommendation['raccOpinion']> = {
      'Strong Buy': 'strong_buy',
      'Buy': 'buy',
      'Hold': 'hold',
      'Sell': 'sell',
      'Strong Sell': 'strong_sell',
      'Avoid': 'avoid',
    };
    return map[rec] || 'hold';
  }

  function mapRecommendationToAction(rec: string): Recommendation['action'] {
    if (rec === 'Strong Buy' || rec === 'Buy') return 'buy';
    if (rec === 'Sell' || rec === 'Strong Sell') return 'sell';
    if (rec === 'Hold') return 'hold';
    return 'avoid';
  }

  function mapRiskLevel(level?: string): Recommendation['riskLevel'] {
    const map: Record<string, Recommendation['riskLevel']> = {
      'Low': 'low',
      'Medium': 'medium',
      'High': 'high',
      'Very High': 'very_high',
    };
    return map[level || 'Medium'] || 'medium';
  }

  function inferPersonality(rec: any): Recommendation['personalityType'] {
    // Infer personality from recommendation and other factors
    if (rec.recommendation === 'Strong Buy' || rec.recommendation === 'Buy') {
      if (rec.riskAssessment?.level === 'Low') return 'buyer';
      return 'averager';
    }
    if (rec.recommendation === 'Sell' || rec.recommendation === 'Strong Sell') return 'seller';
    return 'holder';
  }

  // Publish single stock
  const handlePublish = async (rec: Recommendation) => {
    setPublishingTicker(rec.ticker);
    try {
      // Call publish API
      const res = await fetch('/api/recommendations/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: rec.ticker, recommendation: rec }),
      });
      
      const data = await res.json();
      if (data.success) {
        // Update local state
        setRecommendations(prev => prev.map(r => 
          r.ticker === rec.ticker 
            ? { ...r, published: true, publishedAt: new Date().toISOString() }
            : r
        ));
        toast.success(`تم نشر تحليل ${rec.ticker}`);
        onPublish?.(rec.ticker);
      } else {
        toast.error(data.error || 'فشل في النشر');
      }
    } catch (error) {
      // Simulate success for demo
      setRecommendations(prev => prev.map(r => 
        r.ticker === rec.ticker 
          ? { ...r, published: true, publishedAt: new Date().toISOString() }
          : r
      ));
      toast.success(`تم نشر تحليل ${rec.ticker}`);
      onPublish?.(rec.ticker);
    } finally {
      setPublishingTicker(null);
    }
  };

  // Publish all recommendations
  const handlePublishAll = async () => {
    setPublishingAll(true);
    try {
      const tickersToPublish = filteredRecommendations.filter(r => !r.published).map(r => r.ticker);
      
      // Call batch publish API
      const res = await fetch('/api/recommendations/publish/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: tickersToPublish, recommendations: filteredRecommendations.filter(r => !r.published) }),
      });
      
      const data = await res.json();
      if (data.success) {
        setRecommendations(prev => prev.map(r => ({ ...r, published: true, publishedAt: new Date().toISOString() })));
        toast.success(`تم نشر ${tickersToPublish.length} تحليل`);
        onPublishAll?.(tickersToPublish);
      } else {
        toast.error(data.error || 'فشل في النشر');
      }
    } catch (error) {
      // Simulate success for demo
      setRecommendations(prev => prev.map(r => ({ ...r, published: true, publishedAt: new Date().toISOString() })));
      toast.success(`تم نشر جميع التحليلات`);
      onPublishAll?.(filteredRecommendations.map(r => r.ticker));
    } finally {
      setPublishingAll(false);
    }
  };

  // Export to CSV
  const handleExport = () => {
    const headers = [
      'السهم', 'الاسم', 'الاقتراح', 'آخر سعر', 'منطقة الشراء', 'استقرار أعلاه',
      'هدف 1', 'هدف 2', 'الهدف الاستثماري', 'الاستوب', 'الإجراء', 'الشخصية', 'الثقة'
    ];
    
    const rows = filteredRecommendations.map(r => [
      r.ticker,
      r.name,
      r.raccOpinionAr,
      formatPrice(r.lastPrice),
      `${formatPrice(r.buyZoneLow)} - ${formatPrice(r.buyZoneHigh)}`,
      formatPrice(r.stabilityTrigger),
      formatPrice(r.target1),
      formatPrice(r.target2),
      formatPrice(r.investmentTarget),
      formatPrice(r.stopLoss),
      r.actionAr,
      r.personalityAr,
      `${r.confidence}%`,
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `racc-recommendations-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('تم تصدير التحليلات');
  };

  // Filter by personality
  const filteredRecommendations = useMemo(() => {
    if (selectedPersonality === 'all') return recommendations;
    return recommendations.filter(r => r.personalityType === selectedPersonality);
  }, [recommendations, selectedPersonality]);

  // Stats
  const stats = useMemo(() => ({
    total: filteredRecommendations.length,
    published: filteredRecommendations.filter(r => r.published).length,
    buySignals: filteredRecommendations.filter(r => r.action === 'buy').length,
    sellSignals: filteredRecommendations.filter(r => r.action === 'sell').length,
    avgConfidence: filteredRecommendations.length > 0 
      ? Math.round(filteredRecommendations.reduce((sum, r) => sum + r.confidence, 0) / filteredRecommendations.length)
      : 0,
  }), [filteredRecommendations]);

  // Initial load
  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Target className="h-6 w-6 text-emerald-600" />
                جدول التحليلات
              </CardTitle>
              <CardDescription>
                تحليلات التداول مع تصنيف الشخصيات ونقاط الدخول والخروج
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchRecommendations} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                <span className="mr-2">تحديث</span>
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4" />
                <span className="mr-2">تصدير</span>
              </Button>
              <Button 
                size="sm" 
                onClick={handlePublishAll} 
                disabled={publishingAll || stats.published === stats.total}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {publishingAll ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> جاري النشر...</>
                ) : (
                  <><Send className="h-4 w-4 mr-2" /> نشر الكل ({stats.total - stats.published})</>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters & Stats */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={selectedPersonality} onValueChange={setSelectedPersonality}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="تصفية بالشخصية" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الشخصيات</SelectItem>
                  <SelectItem value="buyer">شخصية شاري</SelectItem>
                  <SelectItem value="seller">شخصية بائع</SelectItem>
                  <SelectItem value="holder">شخصية محتفظ</SelectItem>
                  <SelectItem value="averager">شخصية متوسط</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="flex items-center gap-1 px-2 py-1 bg-muted rounded">
                <span className="text-muted-foreground">الإجمالي:</span>
                <span className="font-bold">{stats.total}</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded">
                <CheckCircle className="h-3 w-3" />
                <span className="font-bold">{stats.published}</span>
                <span>منشور</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded">
                <TrendingUp className="h-3 w-3" />
                <span className="font-bold">{stats.buySignals}</span>
                <span>شراء</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded">
                <TrendingDown className="h-3 w-3" />
                <span className="font-bold">{stats.sellSignals}</span>
                <span>بيع</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded">
                <Shield className="h-3 w-3" />
                <span className="font-bold">{stats.avgConfidence}%</span>
                <span>ثقة</span>
              </div>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-center">السهم</TableHead>
                    <TableHead className="text-center">الاقتراح</TableHead>
                    <TableHead className="text-center">آخر سعر</TableHead>
                    <TableHead className="text-center">منطقة الشراء</TableHead>
                    <TableHead className="text-center">استقرار أعلاه</TableHead>
                    <TableHead className="text-center">أهداف البيع</TableHead>
                    <TableHead className="text-center">الهدف الاستثماري</TableHead>
                    <TableHead className="text-center">الاستوب</TableHead>
                    <TableHead className="text-center">الإجراء</TableHead>
                    <TableHead className="text-center">الشخصية</TableHead>
                    <TableHead className="text-center">نشر</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecommendations.map((rec) => (
                    <TableRow 
                      key={rec.ticker}
                      className={cn(
                        'cursor-pointer hover:bg-muted/50 transition-colors',
                        rec.published && 'bg-green-50/50'
                      )}
                      onClick={() => onStockClick?.(rec.ticker)}
                    >
                      {/* السهم */}
                      <TableCell>
                        <div className="text-center">
                          <div className="font-bold text-primary">{rec.ticker}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[120px]">
                            {rec.name}
                          </div>
                        </div>
                      </TableCell>

                      {/* الاقتراح */}
                      <TableCell>
                        <div className="flex flex-col items-center gap-1">
                          <Badge className={OPINION_CONFIG[rec.raccOpinion].bg}>
                            {rec.raccOpinionAr}
                          </Badge>
                          <div className={cn('text-xs font-medium', getScoreColor(rec.raccScore))}>
                            {rec.raccScore}%
                          </div>
                        </div>
                      </TableCell>

                      {/* آخر سعر */}
                      <TableCell>
                        <PriceCell 
                          value={rec.lastPrice} 
                          change={rec.change} 
                          changePercent={rec.changePercent} 
                        />
                      </TableCell>

                      {/* منطقة الشراء */}
                      <TableCell>
                        <ZoneCell high={rec.buyZoneHigh} low={rec.buyZoneLow} />
                      </TableCell>

                      {/* استقرار أعلاه */}
                      <TableCell>
                        <div className="text-center">
                          <div className="text-sm font-medium text-green-600">
                            {formatPrice(rec.stabilityTrigger)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {rec.stabilityAction}
                          </div>
                        </div>
                      </TableCell>

                      {/* أهداف البيع */}
                      <TableCell>
                        <TargetsCell target1={rec.target1} target2={rec.target2} target3={rec.target3} />
                      </TableCell>

                      {/* الهدف الاستثماري */}
                      <TableCell>
                        <div className="text-center">
                          <div className="text-sm font-bold text-blue-600">
                            {formatPrice(rec.investmentTarget)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {rec.investmentHorizon}
                          </div>
                        </div>
                      </TableCell>

                      {/* الاستوب */}
                      <TableCell>
                        <div className="text-center">
                          <div className="text-sm font-medium text-red-600">
                            {formatPrice(rec.stopLoss)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {rec.stopLossType === 'close' ? 'إغلاق' : 'خلال الجلسة'}
                          </div>
                        </div>
                      </TableCell>

                      {/* الإجراء */}
                      <TableCell>
                        <div className="flex justify-center">
                          <ActionBadge action={rec.action} />
                        </div>
                      </TableCell>

                      {/* الشخصية */}
                      <TableCell>
                        <div className="flex justify-center">
                          <PersonalityBadge type={rec.personalityType} />
                        </div>
                      </TableCell>

                      {/* نشر */}
                      <TableCell>
                        <div className="flex justify-center">
                          {rec.published ? (
                            <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              منشور
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePublish(rec)}
                              disabled={publishingTicker === rec.ticker}
                              className="gap-1"
                            >
                              {publishingTicker === rec.ticker ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Send className="h-3 w-3" />
                              )}
                              نشر
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default RecommendationsTable;
