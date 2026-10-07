'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface RefreshAnalyticsButtonProps {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'glow';
  size?: 'sm' | 'default' | 'lg' | 'icon';
  className?: string;
  showLabel?: boolean;
  customLabel?: string;
  onRefreshed?: () => void;
}

export function RefreshAnalyticsButton({
  variant = 'outline',
  size = 'default',
  className,
  showLabel = true,
  customLabel = 'توليد التوقعات',
  onRefreshed,
}: RefreshAnalyticsButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { loadV2Recommendations, loadAiInsights, currentMarket } = useAppStore();

  const handleRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    const toastId = toast.loading('جاري توليد توقعات جديدة...', {
      description: 'نظام التحليل بفحص السوق ويولّد أحدث الفرص.',
    });

    try {
      // KILL-MAESTRO: V40.2 هو المحرك الوحيد
      // الزرار ده بيولّد توقعات جديدة من V40.2 (مش بيقرأ بس)
      // بيستدعي Python backend اللي بيشغل daily_predictor.py
      const res = await fetch(`/api/predictions/generate-all?market=${currentMarket}&all_markets=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: currentMarket, all_markets: true }),
      });

      const data = await res.json();

      if (data.success) {
        const displayedCount = Math.min(
          data.predictions_count || data.performance?.total_predictions || data.stats?.today || data.activePredictions?.length || 0,
          5
        );
        toast.success('تم توليد التوقعات بنجاح', {
          id: toastId,
          description: `تم فحص السوق وتوليد ${displayedCount} توقعات جديدة.`,
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
          duration: 4000,
        });

        // Reload from DB
        loadV2Recommendations();
        loadAiInsights();

        // Dispatch window event for listening components
        window.dispatchEvent(new CustomEvent('analyticsRefreshed', { detail: data }));

        if (onRefreshed) {
          onRefreshed();
        }
      } else {
        toast.error('حدث خطأ أثناء توليد التوقعات', {
          id: toastId,
          description: data.error || 'يرجى المحاولة مرة أخرى.',
          icon: <AlertCircle className="w-5 h-5 text-rose-500" />,
        });
      }
    } catch (err: any) {
      toast.error('تعذر الاتصال بمحرك التوقعات', {
        id: toastId,
        description: err?.message || 'يرجى المحاولة مرة أخرى لاحقاً.',
        icon: <AlertCircle className="w-5 h-5 text-rose-500" />,
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const isGlow = variant === 'glow';

  return (
    <Button
      variant={isGlow ? 'default' : (variant as any)}
      size={size}
      onClick={handleRefresh}
      disabled={isRefreshing}
      className={cn(
        'relative group transition-all duration-300 font-medium',
        isGlow && 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white shadow-md hover:shadow-lg hover:shadow-emerald-500/20 border-0',
        className
      )}
    >
      {isRefreshing ? (
        <RefreshCw className={cn('w-4 h-4 animate-spin', isGlow && 'text-white', showLabel && 'ml-2')} />
      ) : (
        <Zap className={cn('w-4 h-4 text-emerald-500 transition-transform duration-300 group-hover:scale-110', isGlow && 'text-white', showLabel && 'ml-2')} />
      )}

      {showLabel && (
        <span className="truncate">
          {isRefreshing ? 'جاري التوليد...' : customLabel}
        </span>
      )}
    </Button>
  );
}
