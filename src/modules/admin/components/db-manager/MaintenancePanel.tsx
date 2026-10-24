'use client';

/**
 * db-manager/MaintenancePanel.tsx
 * ===================================
 * Maintenance tab — VACUUM / INTEGRITY_CHECK / WAL_CHECKPOINT / REINDEX
 * operation cards plus a result card showing duration + message + full report.
 */

import {
  Activity,
  ShieldCheck,
  DatabaseBackup,
  ListTree,
  Zap,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

import type { MaintenancePanelProps } from './types';

export function MaintenancePanel(props: MaintenancePanelProps) {
  const operations: {
    key: string;
    label: string;
    description: string;
    icon: React.ElementType;
    onClick: () => void;
    destructive: boolean;
  }[] = [
    {
      key: 'VACUUM',
      label: 'VACUUM',
      description: 'إعادة بناء الملف لاستعادة المساحة غير المستخدمة. مفيد بعد حذف كميات كبيرة من البيانات.',
      icon: Zap,
      onClick: props.onVacuum,
      destructive: true,
    },
    {
      key: 'INTEGRITY_CHECK',
      label: 'فحص السلامة',
      description: 'PRAGMA integrity_check — يتحقق من سلامة بنية B-Tree والصفحات. آمن (للقراءة فقط).',
      icon: ShieldCheck,
      onClick: props.onIntegrity,
      destructive: false,
    },
    {
      key: 'WAL_CHECKPOINT',
      label: 'WAL Checkpoint',
      description: 'يدمج التغييرات المعلّقة في ملف الـ WAL إلى الملف الرئيسي ثم يقتطع الـ WAL.',
      icon: DatabaseBackup,
      onClick: props.onWalCheckpoint,
      destructive: false,
    },
    {
      key: 'REINDEX',
      label: 'REINDEX',
      description: 'يعيد بناء كل الفهارس في القاعدة. مفيد بعد تعديلات كبيرة لتحسين الأداء.',
      icon: ListTree,
      onClick: props.onReindex,
      destructive: false,
    },
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            عمليات الصيانة — <span className="font-mono text-profit">{props.dbName}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {operations.map((op) => (
            <div key={op.key} className="border rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <op.icon
                  className={cn(
                    'w-5 h-5 flex-shrink-0 mt-0.5',
                    op.destructive ? 'text-warning' : 'text-profit'
                  )}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">{op.label}</div>
                  <p className="text-xs text-muted-foreground mt-1">{op.description}</p>
                </div>
              </div>
              <Button
                onClick={op.onClick}
                disabled={!!props.loading}
                size="sm"
                variant={op.destructive ? 'outline' : 'default'}
                className={cn(
                  op.destructive &&
                    'text-warning border-warning hover:bg-warning hover:text-warning'
                )}
              >
                {props.loading === op.key ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <op.icon className="w-3.5 h-3.5" />
                )}
                {op.label}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {props.result && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {props.result.success ? (
                <CheckCircle2 className="w-4 h-4 text-profit" />
              ) : (
                <XCircle className="w-4 h-4 text-destructive" />
              )}
              نتيجة {props.result.operation}
            </CardTitle>
            <CardDescription>
              الزمن: {props.result.durationMs} ms
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Alert variant={props.result.success ? 'default' : 'destructive'}>
              <AlertDescription>{props.result.message}</AlertDescription>
            </Alert>
            {props.result.report && (
              <div>
                <div className="text-xs font-semibold mb-1">التقرير الكامل:</div>
                <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap max-h-72 overflow-y-auto custom-scrollbar">
                  {Array.isArray(props.result.report)
                    ? props.result.report.join('\n')
                    : props.result.report}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
