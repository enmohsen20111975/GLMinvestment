'use client';

/**
 * WidgetCard — المكوّن الموحد لكل widget في المشروع
 * ====================================================================
 * بدل ما كل widget يكتب:
 *   <Card><CardHeader><CardTitle><icon/> عنوان </CardTitle>
 *   <Button refresh /></CardHeader><CardContent>...</CardContent></Card>
 *
 * دلوقتي يكتب:
 *   <WidgetCard title="عنوان" icon={Bitcoin} loading={isLoading}
 *    onRefresh={refetch} refreshing={isFetching}>
 *     {content}
 *   </WidgetCard>
 *
 * استخدامه في 105+ ملف → توفير ~2000 سطر تكرار في المشروع كله.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WidgetCardProps {
  /** عنوان الـ widget (عربي) */
  title: string;
  /** أيقونة الـ widget (من lucide-react) */
  icon?: LucideIcon;
  /** لون الأيقونة (Tailwind class) */
  iconColor?: string;
  /** خلفية الأيقونة (Tailwind class) */
  iconBg?: string;
  /** حجم الأيقونة (default: h-4 w-4) */
  iconSize?: string;
  /** حالة التحميل → بيعرض Skeleton */
  loading?: boolean;
  /** صفوف الـ skeleton (default: 3) */
  skeletonRows?: number;
  /** ارتفاع صف الـ skeleton (default: h-16) */
  skeletonHeight?: string;
  /** callback زر التحديث */
  onRefresh?: () => void;
  /** حالة التحديث (بيـ spin الـ icon) */
  refreshing?: boolean;
  /** إخفاء زر التحديث */
  hideRefresh?: boolean;
  /** class إضافي للـ Card */
  className?: string;
  /** class إضافي للـ CardHeader */
  headerClassName?: string;
  /** class إضافي للـ CardTitle */
  titleClassName?: string;
  /** class إضافي للـ CardContent */
  contentClassName?: string;
  /** محتوى الـ widget */
  children?: React.ReactNode;
  /** badge بسيط جنب العنوان (optional) */
  badge?: React.ReactNode;
}

export function WidgetCard({
  title,
  icon: Icon,
  iconColor = 'text-primary',
  iconBg = 'bg-primary/10',
  iconSize = 'h-4 w-4',
  loading = false,
  skeletonRows = 3,
  skeletonHeight = 'h-16',
  onRefresh,
  refreshing = false,
  hideRefresh = false,
  className,
  headerClassName,
  titleClassName,
  contentClassName,
  children,
  badge,
}: WidgetCardProps) {
  return (
    <Card className={cn('border-border', className)}>
      <CardHeader className={cn('pb-2', headerClassName)}>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className={cn('text-sm font-semibold flex items-center gap-2', titleClassName)}>
            {Icon && (
              <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', iconBg)}>
                <Icon className={cn(iconSize, iconColor)} />
              </div>
            )}
            {title}
          </CardTitle>
          <div className="flex items-center gap-2">
            {badge}
            {!hideRefresh && onRefresh && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onRefresh}
                disabled={refreshing}
                aria-label="تحديث"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn('space-y-3', contentClassName)}>
        {loading ? (
          Array.from({ length: skeletonRows }).map((_, i) => (
            <Skeleton key={i} className={cn('w-full', skeletonHeight)} />
          ))
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export default WidgetCard;
