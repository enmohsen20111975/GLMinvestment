'use client';

/**
 * db-manager/DailyBackupsPanel.tsx
 * ====================================
 * Daily Backups tab — lists historical daily/weekly/monthly backup snapshots
 * (last 7 days + weekly + monthly). Each entry shows date, day-of-week,
 * DB count, total size, integrity summary, and per-DB integrity badges.
 * Supports restore-all / delete actions.
 */

import {
  History,
  RefreshCw,
  Upload,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { DailyBackupsPanelProps } from './types';

export function DailyBackupsPanel(props: DailyBackupsPanelProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="w-4 h-4" />
              النسخ الاحتياطية اليومية (آخر 7 أيام + الأسبوعية + الشهرية)
            </CardTitle>
            <Button variant="outline" size="sm" onClick={props.onRefresh} disabled={props.loading}>
              <RefreshCw className={cn('w-3.5 h-3.5', props.loading && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-2">
          {props.loading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : props.error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{props.error}</AlertDescription>
            </Alert>
          ) : props.backups.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <History className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>لا توجد نسخ احتياطية يومية حتى الآن.</p>
              <p className="text-xs mt-2 text-muted-foreground">
                شغّل سكربت <code>vps-service/scripts/daily_backup.py</code> عبر cron لإضافة النسخ اليومية.
              </p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto custom-scrollbar space-y-3">
              {props.backups.map((backup) => (
                <div
                  key={backup.id}
                  className={cn(
                    'border rounded-lg p-4',
                    backup.corruptCount > 0
                      ? 'border-loss bg-loss/10 /10'
                      : 'border-border bg-card'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{backup.dateDisplay}</span>
                        <Badge variant="outline" className="text-xs">
                          {backup.dayOfWeek}
                        </Badge>
                        {backup.hasSummary ? (
                          <Badge variant="outline" className="text-xs bg-profit/20 text-profit ">
                            <CheckCircle2 className="w-3 h-3" />
                            مُلخّص
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-warning/20 text-warning ">
                            <AlertCircle className="w-3 h-3" />
                            مفحوص يدوياً
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                        <span>{backup.dbCount} قاعدة بيانات</span>
                        <span>{backup.totalSizeHuman}</span>
                        <span className={cn(backup.corruptCount > 0 ? 'text-loss ' : 'text-profit ')}>
                          <CheckCircle2 className="w-3 h-3 inline" /> {backup.okCount} سليمة
                          {backup.corruptCount > 0 && (
                            <>
                              {' · '}
                              <XCircle className="w-3 h-3 inline" /> {backup.corruptCount} تالفة
                            </>
                          )}
                        </span>
                      </div>
                      {backup.databases.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {backup.databases.map((db) => (
                            <Tooltip key={db.name}>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-xs gap-1 cursor-default',
                                    db.integrity === 'ok'
                                      ? 'bg-profit/20 text-profit '
                                      : 'bg-loss/20 text-loss '
                                  )}
                                >
                                  {db.integrity === 'ok' ? (
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                  ) : (
                                    <XCircle className="w-2.5 h-2.5" />
                                  )}
                                  {db.name}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-xs">
                                  <p>{db.name}</p>
                                  <p>{db.sizeHuman}</p>
                                  <p className={db.integrity === 'ok' ? 'text-profit' : 'text-loss'}>
                                    {db.integrity === 'ok' ? 'سليمة' : db.integrityMsg || 'تالفة'}
                                  </p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-warning hover:text-warning border-warning hover:bg-warning"
                            onClick={() => props.onRestore(backup.id)}
                            disabled={backup.corruptCount > 0}
                          >
                            <Upload className="w-3.5 h-3.5" />
                            استعادة الكل
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {backup.corruptCount > 0
                            ? 'لا يمكن الاستعادة — توجد قواعد بيانات تالفة'
                            : 'استعادة جميع قواعد البيانات من هذه النسخة'}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-destructive hover:text-destructive"
                            onClick={() => props.onDelete(backup.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>حذف النسخة</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {props.restoreResult && (
        <Alert variant={props.restoreResult.failed.length === 0 ? 'default' : 'destructive'}>
          <Info className="h-4 w-4" />
          <AlertTitle>نتيجة الاستعادة</AlertTitle>
          <AlertDescription>
            <div className="text-sm mt-1 space-y-1">
              <p className="text-profit ">
                تم الاستعادة بنجاح: {props.restoreResult.restored.length} قواعد بيانات
                {props.restoreResult.restored.length > 0 && ` (${props.restoreResult.restored.join(', ')})`}
              </p>
              {props.restoreResult.failed.length > 0 && (
                <p className="text-loss ">
                  فشل: {props.restoreResult.failed.length} ({props.restoreResult.failed.join(', ')})
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                تم حفظ نسخة احتياطية تلقائية: <code>{props.restoreResult.autoBackupZip}</code>
              </p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          النسخ اليومية تُنشأ تلقائياً عبر سكربت cron. يتم الاحتفاظ بـ 7 نسخ يومية + 4 نسخ أسبوعية (الأحد) + 3 نسخ شهرية (أول الشهر).{' '}
          النسخ تُفحص تلقائياً قبل الحفظ، والنسخة التالفة تُعلّم ولا تسمح بالاستعادة منها.
        </AlertDescription>
      </Alert>
    </div>
  );
}
