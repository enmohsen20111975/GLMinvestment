'use client';

/**
 * AI Stock Analysis Widget - UNIFIED VERSION
 * 
 * Python = Source of Truth
 * هذا المكون يعرض التحليل الذكي للسهم مباشرة
 * بدون حسابات محلية أو تفسيرات عشوائية
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ShareButton } from '@/components/shared/ShareButton';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertCircle,
  Target,
  ShieldAlert,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Zap,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types - Python MasterAnalyzer Output                               */
/* ------------------------------------------------------------------ */

interface PythonAnalysis {
  ticker: string;
  signal: 'STRONG_BUY' | 'BUY' | 'ACCUMULATE' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  signal_ar: string;
  master_score: number;
  confidence: number;
  is_tradeable: boolean;
  risk_profile?: {
    entry_price?: number;
    entry_low?: number;
    entry_high?: number;
    target_price?: number;
    stop_loss_price?: number;
    risk_reward_ratio?: number;
    position_size_pct?: number;
  };
  technical_score?: number;
  fundamental_score?: number;
  momentum_score?: number;
  risk_score?: number;
  indicators?: {
    rsi?: number;
    macd_signal?: string;
    bb_position?: string;
    trend?: string;
  };
  reasons?: string[];
  warnings?: string[];
  analyzed_at?: string;
}

interface AIAnalysisWidgetProps {
  ticker: string;
  stockName?: string;
  currentPrice?: number;
}

// Cache for analysis (5 minutes TTL)
const analysisCache = new Map<string, { data: PythonAnalysis; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const SIGNAL_CONFIG = {
  'STRONG_BUY': { label: 'شراء قوي', color: 'bg-emerald-500', textColor: 'text-emerald-500', trend: 'bullish' },
  'BUY': { label: 'شراء', color: 'bg-emerald-400', textColor: 'text-emerald-400', trend: 'bullish' },
  'ACCUMULATE': { label: 'تجميع', color: 'bg-amber-400', textColor: 'text-amber-400', trend: 'bullish' },
  'HOLD': { label: 'احتفاظ', color: 'bg-amber-500', textColor: 'text-amber-500', trend: 'neutral' },
  'SELL': { label: 'بيع', color: 'bg-red-400', textColor: 'text-red-400', trend: 'bearish' },
  'STRONG_SELL': { label: 'بيع قوي', color: 'bg-red-500', textColor: 'text-red-500', trend: 'bearish' },
};

export function AIAnalysisWidget({ ticker, stockName, currentPrice }: AIAnalysisWidgetProps) {
  const [analysis, setAnalysis] = useState<PythonAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const shareCardRef = useRef<HTMLDivElement>(null);

  const fetchAnalysis = useCallback(async (forceRefresh = false) => {
    if (!ticker) return;

    // Check cache first
    const cached = analysisCache.get(ticker);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setAnalysis(cached.data);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Call Python MasterAnalyzer - THE ONLY SOURCE OF TRUTH
      const response = await fetch(`/api/python/v2/cached-analysis/${ticker}?XTransformPort=8010`);

      if (!response.ok) {
        throw new Error('فشل تحميل التحليل');
      }

      const data = await response.json();

      if (data.success && data.data) {
        setAnalysis(data.data);
        analysisCache.set(ticker, { data: data.data, timestamp: Date.now() });
      } else {
        // If no cached analysis, try to trigger a fresh one
        try {
          const analyzeResponse = await fetch(`/api/python/v2/analyze/${ticker}?XTransformPort=8010`);
          const analyzeData = await analyzeResponse.json();
          
          if (analyzeData.success && analyzeData.data) {
            setAnalysis(analyzeData.data);
            analysisCache.set(ticker, { data: analyzeData.data, timestamp: Date.now() });
          } else {
            setError('لا يوجد تحليل متاح لهذا السهم حالياً.');
            setAnalysis(null);
          }
        } catch (analyzeErr) {
          console.error('Failed to trigger analysis:', analyzeErr);
          setError('فشل في تشغيل التحليل.');
          setAnalysis(null);
        }
      }
    } catch (err) {
      console.error('Analysis error:', err);
      setError('تعذر تحميل التحليل. حاول مرة أخرى.');
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  const getSignalConfig = () => {
    if (!analysis) return null;
    return SIGNAL_CONFIG[analysis.signal] || SIGNAL_CONFIG['HOLD'];
  };

  const getTrendIcon = () => {
    const config = getSignalConfig();
    if (!config) return <Minus className="w-5 h-5" />;
    
    switch (config.trend) {
      case 'bullish':
        return <TrendingUp className="w-5 h-5 text-emerald-500" />;
      case 'bearish':
        return <TrendingDown className="w-5 h-5 text-red-500" />;
      default:
        return <Minus className="w-5 h-5 text-amber-500" />;
    }
  };

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="pb-2 bg-gradient-to-l from-primary/5 to-transparent">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary animate-pulse" />
            التحليل الذكي للسهم
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show error if no analysis
  if (error || !analysis) {
    return (
      <Card className="overflow-hidden border-amber-200 bg-amber-50 dark:bg-amber-900/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-amber-600">
            <AlertCircle className="w-5 h-5" />
            التحليل الذكي للسهم
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground mb-3">
            {error || 'لا يوجد تحليل متاح لهذا السهم حالياً.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchAnalysis(true)}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            طلب التحليل
          </Button>
        </CardContent>
      </Card>
    );
  }

  const signalConfig = getSignalConfig();

  return (
    <Card className="overflow-hidden border-primary/20" ref={shareCardRef}>
      <CardHeader className="pb-2 bg-gradient-to-l from-primary/5 to-transparent">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            التحليل الذكي للسهم
            <Badge variant="outline" className="text-[10px] font-normal">
              {analysis.confidence?.toFixed(0) || '--'}% ثقة
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <ShareButton
              targetRef={shareCardRef}
              title={`تحليل ${stockName || ticker}`}
              description={`إشارة: ${analysis?.signal_ar || 'غير محدد'} - الدرجة: ${analysis?.master_score?.toFixed(0) || '--'}`}
              variant="ghost"
              size="icon"
              customTrigger={
                <Button variant="ghost" size="icon" className="h-8 w-8" title="مشاركة">
                  <Sparkles className="w-4 h-4" />
                </Button>
              }
            />
            {analysis.is_tradeable && (
              <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-500/50">
                <CheckCircle className="w-3 h-3 ml-1" />
                قابل للتداول
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => fetchAnalysis(true)}
              title="تحديث التحليل"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-4">
        {/* Score & Signal */}
        <div className="flex items-center gap-4 mb-4">
          <div className={cn("w-14 h-14 rounded-full flex items-center justify-center", signalConfig?.color)}>
            <span className="text-white text-xl font-bold">{(analysis.master_score ?? 0).toFixed(0)}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              {getTrendIcon()}
              <span className="text-sm font-medium">{signalConfig?.trend === 'bullish' ? 'صعودي' : signalConfig?.trend === 'bearish' ? 'هبوطي' : 'محايد'}</span>
            </div>
            <Badge className={cn('text-sm px-3 py-1 mt-1', signalConfig?.color)}>
              {analysis.signal_ar || signalConfig?.label}
            </Badge>
          </div>
        </div>

        {/* Risk Profile - Entry, Target, Stop Loss */}
        {analysis.risk_profile && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-muted/50 rounded-lg p-2 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">منطقة الدخول</p>
              <p className="text-sm font-bold text-primary">
                {analysis.risk_profile.entry_low && analysis.risk_profile.entry_high
                  ? `${analysis.risk_profile.entry_low.toFixed(2)}-${analysis.risk_profile.entry_high.toFixed(2)}`
                  : analysis.risk_profile.entry_price?.toFixed(2) || '--'}
              </p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">الهدف</p>
              <p className="text-sm font-bold text-emerald-600">
                {analysis.risk_profile.target_price?.toFixed(2) || '--'}
              </p>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">وقف الخسارة</p>
              <p className="text-sm font-bold text-red-600">
                {analysis.risk_profile.stop_loss_price?.toFixed(2) || '--'}
              </p>
            </div>
          </div>
        )}

        {/* R:R Ratio */}
        {analysis.risk_profile?.risk_reward_ratio && (
          <div className="flex items-center justify-center gap-2 mb-4 text-sm">
            <span className="text-muted-foreground">نسبة المخاطرة/العائد:</span>
            <Badge variant="outline" className={cn(
              analysis.risk_profile.risk_reward_ratio >= 2 ? 'text-emerald-500 border-emerald-500/50' :
              analysis.risk_profile.risk_reward_ratio >= 1.5 ? 'text-amber-500 border-amber-500/50' :
              'text-red-500 border-red-500/50'
            )}>
              {analysis.risk_profile.risk_reward_ratio.toFixed(2)}:1
            </Badge>
          </div>
        )}

        {/* Expandable Details */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>
              <ChevronUp className="w-4 h-4 ml-1" />
              إخفاء التفاصيل
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4 ml-1" />
              عرض التفاصيل
            </>
          )}
        </Button>

        {expanded && (
          <div className="mt-4 space-y-4 border-t pt-4">
            {/* Score Breakdown */}
            <div>
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
                <Target className="w-3.5 h-3.5" />
                تفصيل الدرجات
              </h4>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-muted/30 rounded p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">الفني</p>
                  <p className={cn("text-xs font-bold", (analysis.technical_score || 50) >= 60 ? "text-emerald-500" : (analysis.technical_score || 50) < 40 ? "text-red-500" : "text-amber-500")}>
                    {analysis.technical_score?.toFixed(0) || '--'}
                  </p>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">الأساسي</p>
                  <p className={cn("text-xs font-bold", (analysis.fundamental_score || 50) >= 60 ? "text-emerald-500" : (analysis.fundamental_score || 50) < 40 ? "text-red-500" : "text-amber-500")}>
                    {analysis.fundamental_score?.toFixed(0) || '--'}
                  </p>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">الزخم</p>
                  <p className={cn("text-xs font-bold", (analysis.momentum_score || 50) >= 60 ? "text-emerald-500" : (analysis.momentum_score || 50) < 40 ? "text-red-500" : "text-amber-500")}>
                    {analysis.momentum_score?.toFixed(0) || '--'}
                  </p>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">المخاطر</p>
                  <p className={cn("text-xs font-bold", (analysis.risk_score || 50) >= 60 ? "text-emerald-500" : (analysis.risk_score || 50) < 40 ? "text-red-500" : "text-amber-500")}>
                    {analysis.risk_score?.toFixed(0) || '--'}
                  </p>
                </div>
              </div>
            </div>

            {/* Reasons */}
            {analysis.reasons && analysis.reasons.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold mb-2 flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Lightbulb className="w-3.5 h-3.5" />
                  أسباب الإشارة
                </h4>
                <ul className="space-y-1">
                  {analysis.reasons.map((reason, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                      <CheckCircle className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings */}
            {analysis.warnings && analysis.warnings.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold mb-2 flex items-center gap-1 text-red-600 dark:text-red-400">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  تحذيرات
                </h4>
                <ul className="space-y-1">
                  {analysis.warnings.map((warning, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                      <AlertCircle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Source Badge */}
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="w-3 h-3 text-primary" />
          <span>التحليل الآلي للسهم</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default AIAnalysisWidget;
