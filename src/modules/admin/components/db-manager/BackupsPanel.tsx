'use client';

/**
 * db-manager/BackupsPanel.tsx
 * ===============================
 * Backups tab — lists all backup files for the selected DB with
 * restore / delete actions, plus a create-new-backup button.
 */

import { toast } from 'sonner';
import {
  DatabaseBackup,
  HardDrive,
  Clock,
  RefreshCw,
  Upload,
  Download,
  Trash2,
  AlertCircle,
  Info,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { formatDateTime } from './helpers';
import type { BackupsPanelProps } from './types';

export function BackupsPanel(props: BackupsPanelProps) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DatabaseBackup className="w-4 h-4" />
              النسخ الاحتياطية
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={props.onRefresh} disabled={props.loading}>
                <RefreshCw className={cn('w-3.5 h-3.5', props.loading && 'animate-spin')} />
                تحديث
              </Button>
              <Button size="sm" onClick={props.onBackup}>
                <Upload className="w-3.5 h-3.5" />
                إنشاء نسخة من {props.dbName}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-2">
          {props.loading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : props.error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{props.error}</AlertDescription>
            </Alert>
          ) : props.backups.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <DatabaseBackup className="w-10 h-10 mx-auto mb-2 opacity-40" />
              لا توجد نسخ احتياطية بعد. اضغط "إنشاء نسخة" للبدء.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scrollbar space-y-2">
              {props.backups.map((b) => (
                <div
                  key={b.name}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium font-mono truncate" title={b.name}>
                      {b.name}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                      <HardDrive className="w-3 h-3" />
                      {b.sizeHuman}
                      <Clock className="w-3 h-3" />
                      {formatDateTime(b.createdAt)}
                      {b.db && (
                        <Badge variant="outline" className="text-xs">{b.db}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => {
                            // Trigger a download by hitting the backup file directly via a fetch
                            // Since backups live outside /public, we re-list & download through the export API path.
                            // For now, just inform the user that restore is the supported path.
                            toast.info('للحصول على ملف، استخدم زر "استعادة" أو انسخه من مجلد db/backups/');
                          }}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>معلومات التنزيل</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-warning hover:text-warning border-warning hover:bg-warning"
                          onClick={() => props.onRestore(b.name)}
                        >
                          <Upload className="w-3.5 h-3.5" />
                          استعادة
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>استعادة هذه النسخة إلى {props.dbName}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-destructive hover:text-destructive"
                          onClick={() => props.onDelete(b.name)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>حذف النسخة</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          النسخ الاحتياطية تُخزَّن في مجلد <code>db/backups/</code>. كل نسخة تشمل ملف الـ .db الرئيسي وأي ملفات -wal/-shm مرافقة.
          عند الاستعادة، يتم عمل نسخة تلقائية للوضع الحالي أولاً.
        </AlertDescription>
      </Alert>
    </div>
  );
}
