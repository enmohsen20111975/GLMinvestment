'use client';

/**
 * db-manager/OverviewPanel.tsx
 * ==============================
 * Overview tab — shows DB name, path, size, table count, total rows,
 * last modified, integrity card, WAL/SHM card, and a "Create backup" button.
 */

import {
  Database as DatabaseIcon,
  HardDrive,
  Table as TableIcon,
  Clock,
  ListTree,
  ShieldCheck,
  DatabaseBackup,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

import { formatBytes, formatDateTime } from './helpers';
import { IntegrityBadge, StatCard } from './SharedComponents';
import type { OverviewPanelProps } from './types';

export function OverviewPanel({ overview, onBackup }: OverviewPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon className="w-5 h-5 text-profit" />
          {overview.name}
        </CardTitle>
        <CardDescription>المسار: {overview.path}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={HardDrive} label="الحجم" value={overview.sizeHuman} />
          <StatCard icon={TableIcon} label="عدد الجداول" value={overview.tableCount.toLocaleString('en-US')} />
          <StatCard icon={ListTree} label="إجمالي الصفوف" value={overview.totalRows.toLocaleString('en-US')} />
          <StatCard
            icon={Clock}
            label="آخر تعديل"
            value={formatDateTime(overview.lastModified)}
          />
        </div>

        <Separator />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  السلامة (Integrity)
                </span>
                <IntegrityBadge integrity={overview.integrity} />
              </div>
              {overview.integrityMessage && overview.integrity !== 'ok' && (
                <p className="text-xs text-muted-foreground break-all font-mono">
                  {overview.integrityMessage}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-2">
                  <DatabaseBackup className="w-4 h-4" />
                  ملفات WAL/SHM
                </span>
                <div className="flex gap-1">
                  {overview.walPresent ? (
                    <Badge variant="outline" className="text-xs bg-warning/20 text-warning ">
                      WAL {formatBytes(overview.walSizeBytes)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">لا WAL</Badge>
                  )}
                  {overview.shmPresent && (
                    <Badge variant="outline" className="text-xs">SHM</Badge>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {overview.walPresent
                  ? 'يوجد ملف WAL — تغييرات غير مدمجة بعد. استخدم WAL Checkpoint لدمجها.'
                  : 'لا توجد تغييرات معلّقة في WAL.'}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onBackup} variant="default" size="sm">
            <DatabaseBackup className="w-4 h-4" />
            إنشاء نسخة احتياطية
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
