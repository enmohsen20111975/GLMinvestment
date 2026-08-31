'use client';

import { useState, useEffect, useCallback } from 'react';
import { Share2, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ShareButton } from '@/components/share/ShareButton';

interface Recommendation {
  id: string;
  ticker: string;
  name_ar: string | null;
  recommendation: string;
  recommendation_ar: string | null;
  confidence: number;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  current_price: number | null;
  current_profit_loss: number | null;
  status: string;
  days_active: number;
  hit_target: boolean;
  hit_stop_loss: boolean;
  recommendation_date: string;
}

interface RecommendationHistoryProps {
  limit?: number;
  showShareButton?: boolean;
}

export function RecommendationHistory({ limit = 20, showShareButton = true }: RecommendationHistoryProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all' | 'hit_target' | 'stopped'>('active');

  const fetchRecommendations = useCallback(async () => {
    try {
      const response = await fetch(`/api/recommendations?status=${filter}&limit=${limit}`);
      const data = await response.json();
      if (data.success) {
        setRecommendations(data.recommendations);
      }
    } catch (error) {
      console.error('Failed to fetch recommendations:', error);
    } finally {
      setLoading(false);
    }
  }, [filter, limit]);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'hit_target':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'stopped':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'active':
        return <Clock className="h-4 w-4 text-teal-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      active: { variant: 'default', label: 'نشط' },
      hit_target: { variant: 'default', label: 'حقق الهدف 🎯' },
      stopped: { variant: 'destructive', label: 'وقف خسارة' },
      expired: { variant: 'secondary', label: 'منتهي' },
    };
    const config = variants[status] || { variant: 'outline', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case 'Strong Buy':
        return 'text-green-600 bg-green-100 dark:bg-green-900/30';
      case 'Buy':
        return 'text-green-500 bg-green-50 dark:bg-green-900/20';
      case 'Hold':
        return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30';
      case 'Avoid':
        return 'text-red-500 bg-red-50 dark:bg-red-900/20';
      case 'Strong Avoid':
        return 'text-red-600 bg-red-100 dark:bg-red-900/30';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-right">سجل التحليلات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-muted rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-right text-lg">سجل التحليلات</CardTitle>
          <div className="flex gap-1">
            {(['active', 'all', 'hit_target'] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setFilter(f)}
                className="text-xs"
              >
                {f === 'active' ? 'النشطة' : f === 'all' ? 'الكل' : 'الناجحة'}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {recommendations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            لا توجد تحليلات {filter === 'active' ? 'نشطة' : filter === 'hit_target' ? 'ناجحة' : ''}
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="divide-y divide-border">
              {recommendations.map((rec) => {
                const profitLoss = rec.current_profit_loss ?? 0;
                const isProfit = profitLoss >= 0;
                
                return (
                  <div key={rec.id} className="p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      {/* Main Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-lg">{rec.ticker}</span>
                          {getStatusIcon(rec.status)}
                          {getStatusBadge(rec.status)}
                        </div>
                        
                        {rec.name_ar && (
                          <p className="text-sm text-muted-foreground truncate">{rec.name_ar}</p>
                        )}
                        
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getRecommendationColor(rec.recommendation)}`}>
                            {rec.recommendation_ar || rec.recommendation}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ثقة: {rec.confidence}%
                          </span>
                        </div>
                      </div>
                      
                      {/* Price & P/L */}
                      <div className="text-left shrink-0">
                        <div className="text-sm text-muted-foreground">
                          سعر الدخول: {rec.entry_price.toFixed(2)} ج
                        </div>
                        {rec.current_price && (
                          <div className="text-sm">
                            الحالي: {rec.current_price.toFixed(2)} ج
                          </div>
                        )}
                        {rec.target_price && (
                          <div className="text-xs text-green-600">
                            الهدف: {rec.target_price.toFixed(2)} ج
                          </div>
                        )}
                        
                        {/* Profit/Loss Display */}
                        {rec.current_price && (
                          <div className={`flex items-center gap-1 mt-1 font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                            {isProfit ? (
                              <TrendingUp className="h-4 w-4" />
                            ) : (
                              <TrendingDown className="h-4 w-4" />
                            )}
                            <span>{isProfit ? '+' : ''}{profitLoss.toFixed(2)}%</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Share Button */}
                      {showShareButton && (
                        <ShareButton
                          type="recommendation"
                          data={{
                            ticker: rec.ticker,
                            nameAr: rec.name_ar || undefined,
                            recommendation: rec.recommendation,
                            recommendationAr: rec.recommendation_ar || undefined,
                            buyPrice: rec.entry_price,
                            currentPrice: rec.current_price || undefined,
                            targetPrice: rec.target_price || undefined,
                            confidence: rec.confidence,
                            date: rec.recommendation_date,
                          }}
                          size="sm"
                        />
                      )}
                    </div>
                    
                    {/* Date & Days Active */}
                    <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                      <span>
                        📅 {new Date(rec.recommendation_date).toLocaleDateString('ar-EG', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      {rec.status === 'active' && (
                        <span>⏱️ {rec.days_active} يوم</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
