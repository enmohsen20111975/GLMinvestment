'use client';

/**
 * db-manager/HeaderBar.tsx
 * ============================
 * Top header Card — DB count + total size + integrity summary tooltip +
 * refresh button + bulk operations bar (WAL checkpoint all / export all /
 * import ZIP) + import result alert + DB search input.
 */

import {
  Database as DatabaseIcon,
  RefreshCw,
  Loader2,
  DatabaseBackup,
  Download,
  Upload,
  Search,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { formatBytes } from './helpers';
import type { HeaderBarProps } from './types';

export function HeaderBar(props: HeaderBarProps) {
  const {
    databaseCount,
    totalSizeBytes,
    integritySummary,
    walDbCount,
    dbsLoading,
    search,
    onSearchChange,
    onRefresh,
    bulkLoading,
    importFile,
    importResult,
    onImportFileChange,
    onCheckpointAll,
    onExportAll,
    onImportAll,
  } = props;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-profit/10 flex items-center justify-center">
              <DatabaseIcon className="w-6 h-6 text-profit " />
            </div>
            <div>
              <h2 className="text-xl font-bold">مدير قواعد البيانات</h2>
              <p className="text-sm text-muted-foreground">
                {databaseCount} قاعدة بيانات · {formatBytes(totalSizeBytes)} إجمالي
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Integrity summary */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs gap-1 cursor-default',
                    integritySummary.corrupt > 0
                      ? 'bg-loss/20 text-loss border-loss'
                      : integritySummary.unknown > 0
                      ? 'bg-warning/20 text-warning border-warning'
                      : 'bg-profit/20 text-profit '
                  )}
                >
                  <ShieldCheck className="w-3 h-3" />
                  {integritySummary.ok}/{integritySummary.total} سليمة
                  {integritySummary.corrupt > 0 && ` · ${integritySummary.corrupt} تالفة`}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-profit" /> سليمة: {integritySummary.ok}
                  </div>
                  {integritySummary.corrupt > 0 && (
                    <div className="flex items-center gap-1">
                      <XCircle className="w-3 h-3 text-loss" /> تالفة: {integritySummary.corrupt}
                    </div>
                  )}
                  {integritySummary.unknown > 0 && (
                    <div className="flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 text-warning" /> غير معروف: {integritySummary.unknown}
                    </div>
                  )}
                  {walDbCount > 0 && (
                    <div className="flex items-center gap-1">
                      <DatabaseBackup className="w-3 h-3 text-warning" /> WAL نشط: {walDbCount}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="h-6" />
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={dbsLoading}>
              <RefreshCw className={cn('w-4 h-4 ml-2', dbsLoading && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </div>

        {/* Bulk operations bar */}
        <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={onCheckpointAll}
            disabled={bulkLoading === 'checkpoint'}
            className="text-warning border-warning hover:bg-warning"
          >
            {bulkLoading === 'checkpoint' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <DatabaseBackup className="w-3.5 h-3.5" />
            )}
            WAL Checkpoint للكل: {walDbCount} قواعد نشطة
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onExportAll}
            disabled={bulkLoading === 'export'}
          >
            {bulkLoading === 'export' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            تصدير كل القواعد كـ ZIP
          </Button>
          <div className="relative flex items-center gap-2">
            <input
              type="file"
              accept=".zip"
              id="import-zip-input"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                onImportFileChange(f);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('import-zip-input')?.click()}
              disabled={bulkLoading === 'import'}
            >
              {bulkLoading === 'import' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {importFile ? `تم الاختيار: ${importFile.name}` : 'اختر ملف ZIP'}
            </Button>
            {importFile && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onImportAll}
                disabled={bulkLoading === 'import'}
              >
                استيراد كل القواعد
              </Button>
            )}
          </div>
        </div>

        {/* Import result */}
        {importResult && (
          <Alert variant={importResult.failed.length === 0 ? 'default' : 'destructive'} className="mt-3">
            <Info className="h-4 w-4" />
            <AlertTitle>نتيجة الاستيراد</AlertTitle>
            <AlertDescription>
              <div className="text-sm mt-1 space-y-1">
                <p className="text-profit ">
                  تم الاستيراد بنجاح: {importResult.restored.length} قواعد بيانات
                  {importResult.restored.length > 0 && ` (${importResult.restored.join(', ')})`}
                </p>
                {importResult.failed.length > 0 && (
                  <p className="text-loss ">
                    فشل: {importResult.failed.length} ({importResult.failed.join(', ')})
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  تم حفظ نسخة احتياطية تلقائية: <code>{importResult.autoBackupZip}</code>
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Search */}
        <div className="relative mt-4">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ابحث عن قاعدة بيانات..."
            className="pr-10"
          />
        </div>
      </CardContent>
    </Card>
  );
}
