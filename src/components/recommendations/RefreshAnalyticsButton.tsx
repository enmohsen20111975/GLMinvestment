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
  customLabel = 'تحديث التوقعات',
  onRefreshed,
}: RefreshAnalyticsButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { loadV2Recommendations, loadAiInsights, currentMarket } = useAppStore();

  const handleRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    const toastId = toast.loading('جاري تحميل التوقعات الحالية...', {
      description: 'يتم عرض أحدث التوقعات من قاعدة البيانات.',
    });

    try {
      // KILL-MAESTRO (2026-08-31): لا نولّد توقعات جديدة عند الضغط على الزرار
      // التوقعات تُولّد تلقائياً بـ V40.2 عبر cron (3:00 صباحاً + 3:30 عصراً)
      // الزرار ده بس بيـ reload التوقعات الموجودة من DB
      //
      // قبل كده كان بيستدعي /api/predictions/generate-all اللي بيولّد توقعات
      // جديدة كل مرة → كان بيدّي إحساس إن التوقعات عشوائية.
      // دلوقتي بس بيـ reload من DB → نفس التوقعات تتعرض.

      // Trigger store reloads — يقرأ من DB بدون توليد جديد
      loadV2Recommendations();
      loadAiInsights();

      // Dispatch window event for listening components
      window.dispatchEvent(new CustomEvent('analyticsRefreshed'));

      toast.success('تم تحميل أحدث التوقعات', {
        id: toastId,
        description: 'التوقعات تتولّد تلقائياً بعد إغلاق السوق. اضغط لتحديث العرض.',
        icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
        duration: 3000,
      });

      if (onRefreshed) {
        onRefreshed();
      }
    } catch (err: any) {
      toast.error('تعذر تحميل التوقعات', {
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
          {isRefreshing ? 'جاري التحميل...' : customLabel}
        </span>
      )}
    </Button>
  );
}
