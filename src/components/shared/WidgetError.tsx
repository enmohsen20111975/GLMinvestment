'use client';

/**
 * WidgetError — حالة الخطأ الموحدة للـ widgets
 * ====================================================================
 * بدل ما كل widget يكتب:
 *   if (error) {
 *     return <Card><CardHeader>...<WifiOff/>...انقطاع الاتصال...<Button onClick={refetch}></Card>
 *   }
 *
 * دلوقتي يكتب:
 *   if (error) return <WidgetError message={error} onRetry={refetch} />
 *
 * استخدامه في 38+ ملف → توفير ~800 سطر تكرار.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WidgetErrorProps {
  /** رسالة الخطأ */
  message?: string | null;
  /** callback إعادة المحاولة */
  onRetry?: () => void;
  /** عنوان الـ widget (للـ header) */
  title?: string;
  /** class إضافي */
  className?: string;
  /** variant: "network" (انقطاع) | "generic" (خطأ عام) */
  variant?: 'network' | 'generic';
}

export function WidgetError({
  message,
  onRetry,
  title = 'خطأ',
  className,
  variant = 'network',
}: WidgetErrorProps) {
  const Icon = variant === 'network' ? WifiOff : AlertCircle;
  const displayMessage =
    message ||
    (variant === 'network'
      ? 'تعذّر جلب البيانات. يرجى المحاولة مرة أخرى.'
      : 'حدث خطأ غير متوقع.');

  return (
    <Card className={cn('border-loss/20 gap-2 py-4', className)}>
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-loss" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <Icon className="h-8 w-8 text-loss/60" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{displayMessage}</p>
          </div>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              إعادة المحاولة
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default WidgetError;
