/**
 * engine-control/HeaderBar.tsx
 * ===========================
 * Header + Quick Actions Bar for the Engine Control Room.
 *
 * Renders the main `Card` (border-warning/20) containing:
 * - The title "غرفة تحكم المحركات" with a CPU icon.
 * - A summary badge (online/total services + errors-only count).
 * - The Quick Actions Bar (start-all, stop-all-with-confirm, full-check,
 *   export report, manual refresh).
 *
 * Extracted from the container so the container stays < 500 LOC.
 */
'use client';

import React from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Cpu, Play, Square, RefreshCw, Download, AlertTriangle, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgoBrief } from './helpers';
import type { EngineLogsResponse } from '@/hooks/useEngineControlRoomData';

export interface HeaderBarProps {
  summary: { online: number; total: number; score: number } | null;
  logs: EngineLogsResponse | null;
  batchLoading: 'start' | 'stop' | 'check' | null;
  loadingStatus: boolean;
  loadingLogs: boolean;
  onStartAll: () => void;
  onStopAll: () => void;
  onFullCheck: () => void;
  onExport: () => void;
  onManualRefresh: () => void;
}

export function HeaderBar({
  summary,
  logs,
  batchLoading,
  loadingStatus,
  loadingLogs,
  onStartAll,
  onStopAll,
  onFullCheck,
  onExport,
  onManualRefresh,
}: HeaderBarProps) {
  return (
    <Card className="border-warning/20">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Cpu className="w-5 h-5 text-warning" />
              غرفة تحكم المحركات
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              كل المحركات + كونسول الأخطاء + تحكم (تشغيل/إيقاف/إعادة) + مراقبة حية.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {summary && (
              <Badge variant="outline" className="text-xs">
                {summary.online}/{summary.total} خدمة شغّالة
              </Badge>
            )}
            {logs?.errors_only && logs.errors_only.length > 0 && (
              <Badge variant="outline" className="text-xs border-loss text-loss">
                <AlertTriangle className="w-3 h-3 ml-1" />
                {logs.errors_only.length} خطأ
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Quick Actions Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1 border-profit text-profit hover:bg-profit"
            disabled={!!batchLoading}
            onClick={onStartAll}
          >
            {batchLoading === 'start' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            تشغيل كل المحركات
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 border-loss text-loss hover:bg-loss"
                disabled={!!batchLoading}
              >
                {batchLoading === 'stop' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                إيقاف كل المحركات
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>تأكيد إيقاف كل المحركات</AlertDialogTitle>
                <AlertDialogDescription>
                  هتوقف كل المحركات (البيانات / الأخبار / التوقعات / التعلّم / الفحص الشرعي). متأكد؟
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onStopAll}
                  className="bg-loss hover:bg-loss text-white"
                >
                  نعم، أوقف الكل
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button
            size="sm"
            variant="outline"
            className="gap-1 border-warning text-warning hover:bg-warning"
            disabled={!!batchLoading}
            onClick={onFullCheck}
          >
            {batchLoading === 'check' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            فحص شامل
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={onExport}
          >
            <Download className="w-3 h-3" />
            تصدير التقرير
          </Button>

          <div className="flex-1" />

          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={onManualRefresh}
            disabled={loadingStatus || loadingLogs}
          >
            <RefreshCw className={cn('w-3 h-3', (loadingStatus || loadingLogs) && 'animate-spin')} />
            تحديث
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Re-export for callers that want the helper (avoids a separate import).
export { timeAgoBrief };
