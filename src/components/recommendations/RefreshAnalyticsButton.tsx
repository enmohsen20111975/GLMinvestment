'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
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
  customLabel = 'تحديث التحليلات',
  onRefreshed,
}: RefreshAnalyticsButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { loadV2Recommendations, loadAiInsights, currentMarket } = useAppStore();

  const handleRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    const toastId = toast.loading('جاري إعادة فحص وتحديث التحليلات والتوقعات...', {
      description: 'يتم الآن تحليل البيانات الفنية والأساسية وتوليد التوقعات لجميع الأسهم.',
    });

    try {
      const res = await fetch(`/api/predictions/generate-all?market=${currentMarket}&all_markets=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: currentMarket, all_markets: true }),
      });

      const data = await res.json();

      if (data.success) {
        // REALITY-CHECK-025: الرسالة كانت بتقول "توليد 100 توقع" (كذب)
        // الحقيقة: المنصة بتحلل كل الأسهم لكن بتعرض بس أعلى 5 توقعات دقة للعميل
        const displayedCount = Math.min(
          data.predictions_count || data.performance?.total_predictions || data.stats?.today || data.activePredictions?.length || 0,
          5
        );
        toast.success('تم تحديث التحليلات واختيار أعلى 5 توقعات دقة ⚡', {
          id: toastId,
          description: `تم فحص السوق واختيار أفضل ${displayedCount} توقعات بناءً على درجة الثقة والـ Score.`,
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
          duration: 4000,
        });

        // Trigger store reloads immediately
        loadV2Recommendations();
        loadAiInsights();

        // Dispatch window event for listening components
        window.dispatchEvent(new CustomEvent('analyticsRefreshed', { detail: data }));

        if (onRefreshed) {
          onRefreshed();
        }
      } else {
        toast.error('حدث خطأ أثناء تحديث التحليلات', {
          id: toastId,
          description: data.error || 'يرجى المحاولة مرة أخرى.',
          icon: <AlertCircle className="w-5 h-5 text-rose-500" />,
        });
      }
    } catch (err: any) {
      toast.error('تعذر الاتصال بمحرك التحليلات', {
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
      <RefreshCw
        className={cn(
          'w-4 h-4 text-emerald-500 transition-transform duration-500',
          isGlow && 'text-white',
          isRefreshing ? 'animate-spin' : 'group-hover:rotate-180',
          showLabel && 'ml-2'
        )}
      />

      {showLabel && (
        <span className="truncate">
          {isRefreshing ? 'جاري التحديث...' : customLabel}
        </span>
      )}
    </Button>
  );
}
