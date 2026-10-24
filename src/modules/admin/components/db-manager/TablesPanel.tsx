'use client';

/**
 * db-manager/TablesPanel.tsx
 * ============================
 * Tables tab — lists all tables in the selected DB (UnifiedTable with
 * column toggle + filter), plus a rows preview with pagination, sort,
 * export (CSV/JSON), drop/truncate actions, and a schema dialog.
 */

import { useMemo } from 'react';
import {
  Table as TableIcon,
  RefreshCw,
  AlertCircle,
  Eraser,
  Trash2,
  Info,
  FileJson,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  ArrowDownUp,
  ArrowDown,
  ArrowUp,
  ListTree,
  KeyRound,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

import { formatCell, PAGE_SIZE } from './helpers';
import type { TablesPanelProps } from './types';

export function TablesPanel(props: TablesPanelProps) {
  const tablesListColumns: Column<import('@/hooks/useDatabaseManagerData').TableSummary>[] = useMemo(() => ([
    {
      key: 'name',
      header: 'اسم الجدول',
      sortable: true,
      filterable: true,
      className: 'font-mono text-xs',
    },
    {
      key: 'rowCount',
      header: 'الصفوف',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'text-xs',
      render: (t) => t.rowCount.toLocaleString('en-US'),
    },
    {
      key: 'columnCount',
      header: 'الأعمدة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'text-xs',
    },
    {
      key: 'sizeHuman',
      header: 'حجم تقديري',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      className: 'text-xs',
    },
    {
      key: 'actions',
      header: 'إجراءات',
      align: 'center',
      width: 'w-32',
      hideable: false,
      render: (t) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => props.onViewSchema(t.name)}
              >
                <Info className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>عرض الـ schema</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-warning hover:text-warning"
                onClick={() => props.onTruncateTable(t.name)}
              >
                <Eraser className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>تفريغ الجدول (DELETE)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => props.onDropTable(t.name)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>حذف الجدول (DROP)</TooltipContent>
          </Tooltip>
        </div>
      ),
    },
  ]), [props]);

  // Build dynamic columns for the selected-table rows based on schema
  const selectedTableColumns: Column<Record<string, unknown>>[] = useMemo(() => {
    if (!props.tableRows || props.tableRows.columns.length === 0) return [];
    return props.tableRows.columns.map((col) => ({
      key: col.name,
      header: col.name,
      sortable: true,
      filterable: true,
      align: 'right' as const,
      className: 'text-xs max-w-[240px] truncate',
      render: (row: Record<string, unknown>) => formatCell(row[col.name]),
      headerClassName: 'cursor-pointer hover:bg-accent select-none',
    }));
  }, [props.tableRows]);

  return (
    <div className="space-y-3">
      {/* Tables list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <TableIcon className="w-4 h-4" />
              جداول {props.dbName}
            </CardTitle>
            {props.tables && (
              <Badge variant="outline">{props.tables.length} جدول</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-2">
          {props.tablesLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : props.tablesError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{props.tablesError}</AlertDescription>
              <Button variant="outline" size="sm" onClick={props.onRetry} className="mt-2">
                <RefreshCw className="w-3 h-3" />
                إعادة المحاولة
              </Button>
            </Alert>
          ) : !props.tables || props.tables.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              لا توجد جداول في هذه القاعدة
            </div>
          ) : (
            <UnifiedTable
              columns={tablesListColumns}
              data={props.tables || []}
              keyField="name"
              dense
              columnToggle
              filterable
              maxHeight="max-h-72"
              rowClassName={(t) => cn(
                'cursor-pointer',
                props.selectedTable === t.name && 'bg-profit/20',
              )}
              onRowClick={(t) => props.onSelectTable(t.name)}
            />
          )}
        </CardContent>
      </Card>

      {/* Selected table rows */}
      {props.selectedTable && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TableIcon className="w-4 h-4 text-profit" />
                  {props.selectedTable}
                </CardTitle>
                {props.tableRows && (
                  <CardDescription>
                    {props.tableRows.totalRows.toLocaleString('en-US')} صف · {props.tableRows.columns.length} عمود · صفحة {props.tableRows.page} من {props.tableRows.totalPages}
                  </CardDescription>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => props.onExport('csv')}>
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => props.onExport('json')}>
                  <FileJson className="w-3.5 h-3.5" />
                  JSON
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-2">
            {props.rowsLoading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : props.rowsError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{props.rowsError}</AlertDescription>
              </Alert>
            ) : !props.tableRows ? (
              <div className="py-8 text-center text-muted-foreground text-sm">لا توجد بيانات</div>
            ) : (
              <>
                {/* Pagination */}
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => props.onPageChange(Math.max(1, props.page - 1))}
                      disabled={props.page <= 1}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                      السابق
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => props.onPageChange(Math.min(props.tableRows.totalPages, props.page + 1))}
                      disabled={props.page >= props.tableRows.totalPages}
                    >
                      التالي
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    عرض{' '}
                    {Math.min((props.page - 1) * PAGE_SIZE + 1, props.tableRows.totalRows)}
                    {' - '}
                    {Math.min(props.page * PAGE_SIZE, props.tableRows.totalRows)}
                    {' من '}
                    {props.tableRows.totalRows.toLocaleString('en-US')}
                  </span>
                </div>

                {/* Rows + Sort Control */}
                <div className="flex items-center justify-end gap-2 mb-2 px-1">
                  {props.tableRows && props.tableRows.columns.length > 0 && (
                    <Select value={props.sortBy} onValueChange={(v) => props.onSort(v)}>
                      <SelectTrigger className="w-[200px] h-8 text-xs">
                        <ArrowDownUp className="w-3 h-3 ml-1" />
                        <SelectValue placeholder="ترتيب حسب..." />
                      </SelectTrigger>
                      <SelectContent>
                        {props.tableRows.columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            {col.name} {props.sortBy === col.name ? (props.sortDir === 'asc' ? '↑' : '↓') : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {props.sortBy && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => props.onSort(props.sortBy)}
                    >
                      {props.sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {props.sortDir === 'asc' ? 'تصاعدي' : 'تنازلي'}
                    </Button>
                  )}
                </div>

                {/* Rows */}
                <div className="max-h-96 overflow-auto custom-scrollbar border rounded-md">
                  <UnifiedTable
                    columns={selectedTableColumns}
                    data={props.tableRows.rows}
                    keyField="_rowIndex"
                    dense
                    maxHeight="max-h-96"
                    emptyTextAr="لا توجد صفوف في هذا الجدول"
                    filterable
                    columnToggle
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Schema dialog */}
      <AlertDialog open={props.schemaOpen} onOpenChange={(o) => !o && props.onSchemaClose()}>
        <AlertDialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto custom-scrollbar">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ListTree className="w-5 h-5" />
              {props.schema ? `Schema: ${props.schema.table}` : 'Schema'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-foreground">
                {props.schema && (
                  <>
                    <div>
                      <div className="text-xs font-semibold mb-1 flex items-center gap-2">
                        <Info className="w-3.5 h-3.5" />
                        CREATE TABLE
                      </div>
                      <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all">
                        {props.schema.createStatement}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs font-semibold mb-1 flex items-center gap-2">
                        <TableIcon className="w-3.5 h-3.5" />
                        الأعمدة ({props.schema.columns.length})
                      </div>
                      <div className="border rounded-md">
                        <UnifiedTable
                          columns={[
                            { key: 'name', header: 'الاسم', sortable: true, filterable: true, className: 'font-mono text-xs' },
                            { key: 'type', header: 'النوع', align: 'right', sortable: true, filterable: true, width: 'w-24', className: 'text-xs', render: (c) => c.type || 'any' },
                            { key: 'notNull', header: 'NOT NULL', align: 'right', width: 'w-24', className: 'text-xs', render: (c) => c.notNull ? '✅' : '—' },
                            { key: 'pk', header: 'PK', align: 'right', width: 'w-20', className: 'text-xs', render: (c) => c.pk ? '✅' : '—' },
                            { key: 'dfltValue', header: 'افتراضي', align: 'right', sortable: true, filterable: true, className: 'font-mono text-xs', render: (c) => c.dfltValue ?? '—' },
                          ]}
                          data={props.schema.columns}
                          keyField="name"
                          dense
                          filterable
                          columnToggle
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold mb-1 flex items-center gap-2">
                        <KeyRound className="w-3.5 h-3.5" />
                        الفهارس ({props.schema.indexes.length})
                      </div>
                      {props.schema.indexes.length === 0 ? (
                        <p className="text-xs text-muted-foreground">لا توجد فهارس</p>
                      ) : (
                        <div className="space-y-1">
                          {props.schema.indexes.map((idx) => (
                            <div key={idx.name} className="border rounded p-2">
                              <div className="font-mono text-xs font-medium">{idx.name}</div>
                              <pre className="text-xs font-mono text-muted-foreground mt-1 whitespace-pre-wrap break-all">
                                {idx.sql}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إغلاق</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
