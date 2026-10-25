'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BarChart3 } from 'lucide-react';
import { PredictionCard } from '@/components/shared/PredictionCard';
import { cn } from '@/lib/utils';

interface Prediction {
  id: string;
  symbol: string;
  name: string;
  signal: string;
  signal_ar: string;
  market: string;
  prediction_date: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  score: number;
  confidence: number;
  reasons: string[];
  created_at: string;
}

interface PredictionStats {
  total: number;
  avg_score: number;
  avg_confidence: number;
  by_signal: Record<string, number>;
  by_market: Record<string, number>;
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-500';
  if (score >= 70) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-500';
  if (score >= 50) return 'text-orange-400';
  return 'text-red-500';
}

function getMarketFromTicker(ticker: string): string {
  if (ticker.includes('بنك') || ticker.includes('الاسكندرية') || ticker.includes('الشرقية')) return '🇪🇬';
  if (/^\d{4}$/.test(ticker)) return '🇸🇦';
  if (ticker.includes('D') || ticker.includes('الإسلامية')) return '🇶🇦';
  if (ticker.includes('الشركة') || ticker.includes('التجارة')) return '🇰🇼';
  return '📈';
}

export function PublishedPredictions() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [stats, setStats] = useState<PredictionStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPredictions = useCallback(async () => {
    try {
      const response = await fetch('/api/unified/predictions?signal=BUY&limit=20');
      const data = await response.json();
      if (data.success) {
        setPredictions(data.predictions);
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching predictions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPredictions();
    const interval = setInterval(fetchPredictions, 300000);
    return () => clearInterval(interval);
  }, [fetchPredictions]);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (predictions.length === 0) {
    return (
      <div className="p-8 text-center">
        <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-bold">لا توجد توقعات منشورة</h3>
        <p className="text-muted-foreground">سيتم نشر التوقعات قريباً</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-2 p-4 bg-muted/50 rounded-lg">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-500">{stats.total}</div>
            <div className="text-xs text-muted-foreground">توقع</div>
          </div>
          <div className="text-center">
            <div className={cn("text-2xl font-bold", getScoreColor(stats.avg_score))}>{stats.avg_score}</div>
            <div className="text-xs text-muted-foreground">متوسط النقاط</div>
          </div>
          <div className="text-center">
            <div className={cn("text-2xl font-bold", getScoreColor(stats.avg_confidence))}>{stats.avg_confidence}</div>
            <div className="text-xs text-muted-foreground">الثقة</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-500">{stats.by_signal?.BUY || 0}</div>
            <div className="text-xs text-muted-foreground">شراء</div>
          </div>
        </div>
      )}

      {/* Predictions List — migrated to shared PredictionCard */}
      <ScrollArea className="flex-1">
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {predictions.map((pred) => (
            <PredictionCard
              key={pred.id}
              ticker={pred.symbol}
              name={pred.name}
              signal={pred.signal}
              signalAr={pred.signal_ar}
              entryPrice={pred.entry_price}
              targetPrice={pred.target_price}
              stopLoss={pred.stop_loss}
              confidence={pred.confidence}
              masterScore={pred.score}
              compact
              showTechnical={false}
              footer={
                <div className="space-y-1.5">
                  {pred.reasons && pred.reasons.length > 0 && (
                    <div className="text-xs text-muted-foreground leading-relaxed">
                      {pred.reasons.join(' | ')}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      السوق: <span className="font-semibold">{getMarketFromTicker(pred.symbol)}</span>
                    </span>
                    {pred.prediction_date && (
                      <span className="text-muted-foreground">
                        التاريخ:{' '}
                        <span className="font-semibold">
                          {new Date(pred.prediction_date).toLocaleDateString('en-GB')}
                        </span>
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] font-bold', getScoreColor(pred.score))}
                    >
                      النقاط: {pred.score}%
                    </Badge>
                  </div>
                </div>
              }
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export default PublishedPredictions;
