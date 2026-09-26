'use client';

/**
 * UnifiedTable — الجدول الموحّد لكل المشروع
 * ===================================================
 * مكون جدول عام (generic) مبني فوق shadcn/ui Table primitives.
 * يستخدم في كل الشاشات اللي بتعرض بيانات جدولية عشان يكون الـ UI متجانس.
 *
 * الميزات:
 *  - Loading skeleton (N صفوف فارغة بنبضات pulse)
 *  - Empty state (رسالة متمركزة بالعربية)
 *  - Sticky header (اختياري، default true)
 *  - Sortable columns (اضغط على الهيدر للترتيب asc/desc مع سهم مؤشر)
 *  - Horizontal scroll على الـ overflow (overflow-x-auto + custom-scrollbar)
 *  - Row hover highlight
 *  - Row click handler
 *  - Dense mode (padding أصغر للجداول المضغوطة)
 *  - RTL افتراضياً
 *  - Responsive: الموبايل بيعمل scroll أفقي والـ columns بتفضل بـ min-width
 *
 * الاستخدام:
 *   <UnifiedTable
 *     columns={[
 *       { key: 'name', header: 'الاسم', sortable: true },
 *       { key: 'price', header: 'السعر', align: 'left', render: (r) => r.price?.toFixed(2) },
 *     ]}
 *     data={rows}
 *     loading={loading}
 *     keyField="id"
 *     onRowClick={(row) => setSelected(row)}
 *   />
 */

import React, { useState, useMemo, useCallback } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Inbox } from 'lucide-react';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Column<T> {
  /** مفتاح الحقل في الـ row (يدعم keyof T أو string للحقول المتداخلة) */
  key: keyof T | string;
  /** عنوان العمود */
  header: string;
  /** عنوان بديل بالعربية (اختياري - لو الـ header بالإنجليزي) */
  headerAr?: string;
  /** دالة render مخصصة للخلية */
  render?: (row: T) => React.ReactNode;
  /** هل العمود قابل للترتيب؟ (default: false) */
  sortable?: boolean;
  /** عرض العمود (Tailwind class fragment) مثلاً: 'w-24' أو 'min-w-[120px]' */
  width?: string;
  /** محاذاة النص: 'right' (default RTL) / 'center' / 'left' */
  align?: 'right' | 'center' | 'left';
  /** كلاسات إضافية للخلية */
  className?: string;
  /** كلاسات إضافية للهيدر */
  headerClassName?: string;
  /** هل العمود قابل للإخفاء؟ (default: false) */
  hideable?: boolean;
  /** هل العمود يدعم الفلترة؟ (default: false) */
  filterable?: boolean;
  /** دالة فلترة مخصصة */
  filterRender?: (column: Column<T>, value: string, onChange: (v: string) => void) => React.ReactNode;
}

export interface UnifiedTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /** حالة التحميل — بيعرض skeleton */
  loading?: boolean;
  /** عدد صفوف الـ skeleton (default: 5) */
  loadingRows?: number;
  /** نص الـ empty state */
  emptyText?: string;
  emptyTextAr?: string;
  /** أقصى ارتفاع للجدول مع scroll عمودي (Tailwind class) مثلاً: 'max-h-96' */
  maxHeight?: string;
  /** هل الهيدر sticky؟ (default: true) */
  stickyHeader?: boolean;
  /** handler الضغط على صف (single click) */
  onRowClick?: (row: T) => void;
  /** handler double-click على صف (desktop) — لفتح شاشة التفاصيل الكاملة */
  onRowDoubleClick?: (row: T) => void;
  /** handler long-press على صف (mobile) — بديل الـ double-click على الموبايل */
  onRowLongPress?: (row: T) => void;
  /** حقل المفتاح الفريد للـ row (default: أول عمود key) */
  keyField?: keyof T | string;
  /** وضع مضغوط (padding أصغر) */
  dense?: boolean;
  /** اتجاه الجدول (default: 'rtl') */
  dir?: 'rtl' | 'ltr';
  /** كلاسات إضافية للـ table wrapper */
  className?: string;
  /** كلاسات إضافية للصف */
  rowClassName?: (row: T, index: number) => string | undefined;
  /** ─── ميزات متقدمة (مستوحاة من جدول حركة القطاعات) ─── */
  /** هل الصفوف قابلة للتوسعة؟ (expandable rows مثل SectorTrackingTab) */
  expandable?: boolean;
  /** دالة render للمحتوى الموسّع (يظهر تحت الصف عند الضغط) */
  expandRender?: (row: T) => React.ReactNode;
  /** حقل يحدد إن كان الصف موسّعاً افتراضياً */
  defaultExpandedKey?: string;
  /** هل الجدول يدعم إخفاء/إظهار الأعمدة؟ (default: false) */
  columnToggle?: boolean;
  /** هل الجدول يدعم الفلترة؟ (default: false) */
  filterable?: boolean;
  /** عنوان الجدول (لعرضه فوق الـ column toggle) */
  title?: string;
  /** زر نشر موحّد (يظهر فوق الجدول) */
  publishButton?: React.ReactNode;
  /** زر تصدير (CSV/PDF) */
  exportButton?: React.ReactNode;
  /** أزرار إضافية فوق الجدول */
  toolbarActions?: React.ReactNode;
}

type SortDirection = 'asc' | 'desc' | null;

// ─── Helpers ───────────────────────────────────────────────────────────────

function getCellValue<T>(row: T, key: keyof T | string): unknown {
  if (typeof key === 'string' && key.includes('.')) {
    return key.split('.').reduce<unknown>((acc, k) => {
      if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[k];
      }
      return undefined;
    }, row);
  }
  return (row as Record<string, unknown>)[key as string];
}

function compareValues(a: unknown, b: unknown): number {
  // null/undefined تروح للآخر
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const aStr = String(a);
  const bStr = String(b);
  return aStr.localeCompare(bStr, 'ar');
}

function alignClass(align?: 'right' | 'center' | 'left'): string {
  switch (align) {
    case 'center': return 'text-center';
    case 'left': return 'text-left';
    case 'right':
    default: return 'text-right';
  }
}

// ─── Component ─────────────────────────────────────────────────────────────

export function UnifiedTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  loadingRows = 5,
  emptyText,
  emptyTextAr = 'لا توجد بيانات للعرض',
  maxHeight,
  stickyHeader = true,
  onRowClick,
  onRowDoubleClick,
  onRowLongPress,
  keyField,
  dense = false,
  dir = 'rtl',
  className,
  rowClassName,
  // ميزات متقدمة
  expandable = false,
  expandRender,
  defaultExpandedKey,
  columnToggle = false,
  filterable = false,
  title,
  publishButton,
  exportButton,
  toolbarActions,
}: UnifiedTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(defaultExpandedKey || null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

  const handleSort = useCallback((col: Column<T>) => {
    if (!col.sortable) return;
    const colKey = String(col.key);
    if (sortKey !== colKey) {
      setSortKey(colKey);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      // إعادة للوضع الافتراضي
      setSortKey(null);
      setSortDir(null);
    } else {
      setSortDir('asc');
    }
  }, [sortKey, sortDir]);

  const sortedData = useMemo(() => {
    if (!sortKey || !sortDir) return data;
    const arr = [...data];
    arr.sort((a, b) => {
      const av = getCellValue(a, sortKey);
      const bv = getCellValue(b, sortKey);
      const cmp = compareValues(av, bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  // فلترة البيانات حسب الـ filter values
  const filteredData = useMemo(() => {
    if (!filterable || Object.keys(filterValues).length === 0) return sortedData;
    return sortedData.filter(row => {
      for (const [colKey, filterVal] of Object.entries(filterValues)) {
        if (!filterVal) continue;
        const val = getCellValue(row, colKey);
        if (val == null) continue;
        if (!String(val).toLowerCase().includes(filterVal.toLowerCase())) return false;
      }
      return true;
    });
  }, [sortedData, filterValues, filterable]);

  // الأعمدة المرئية (بعد إخفاء المختارة)
  const visibleColumns = useMemo(() => {
    if (!columnToggle) return columns;
    return columns.filter(col => !hiddenColumns.has(String(col.key)));
  }, [columns, hiddenColumns, columnToggle]);

  const toggleColumn = useCallback((colKey: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(colKey)) next.delete(colKey);
      else next.add(colKey);
      return next;
    });
  }, []);

  const cellPadding = dense ? 'px-2 py-1' : 'px-3 py-2';
  const headerPadding = dense ? 'px-2 py-1.5' : 'px-3 py-2.5';

  const wrapperCls = cn(
    'relative w-full overflow-x-auto custom-scrollbar',
    maxHeight,
    className,
  );

  const headerCls = cn(
    stickyHeader && 'sticky top-0 z-10 bg-background/95 backdrop-blur shadow-sm',
  );

  // ─── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={wrapperCls} dir={dir}>
        <Table className="text-xs">
          <TableHeader className={headerCls}>
            <TableRow className="hover:bg-transparent">
              {columns.map((col, i) => (
                <TableHead
                  key={`h-skel-${i}`}
                  className={cn(
                    headerPadding,
                    'whitespace-nowrap text-[11px] font-bold text-muted-foreground',
                    alignClass(col.align),
                    col.width,
                    col.headerClassName,
                  )}
                >
                  {col.headerAr || col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: loadingRows }).map((_, ri) => (
              <TableRow key={`skel-row-${ri}`} className="border-b border-border/30">
                {columns.map((col, ci) => (
                  <TableCell
                    key={`skel-cell-${ri}-${ci}`}
                    className={cn(cellPadding, alignClass(col.align), col.width, col.className)}
                  >
                    <Skeleton className="h-3 w-full max-w-[120px]" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  // ─── Empty state ────────────────────────────────────────────────────────
  if (!data || data.length === 0) {
    const msg = emptyText || emptyTextAr;
    return (
      <div className={wrapperCls} dir={dir}>
        <Table className="text-xs">
          <TableHeader className={headerCls}>
            <TableRow className="hover:bg-transparent">
              {columns.map((col, i) => (
                <TableHead
                  key={`h-empty-${i}`}
                  className={cn(
                    headerPadding,
                    'whitespace-nowrap text-[11px] font-bold text-muted-foreground',
                    alignClass(col.align),
                    col.width,
                    col.headerClassName,
                  )}
                >
                  {col.headerAr || col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="text-center text-muted-foreground py-10"
              >
                <div className="flex flex-col items-center gap-2">
                  <Inbox className="w-6 h-6 opacity-40" />
                  <span className="text-xs">{msg}</span>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  // ─── Normal render ──────────────────────────────────────────────────────
  return (
    <div className="space-y-2" dir={dir}>
      {/* Toolbar: publish + export + column toggle + title */}
      {(title || publishButton || exportButton || toolbarActions || columnToggle) && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {title && <span className="text-sm font-bold">{title}</span>}
            {toolbarActions}
          </div>
          <div className="flex items-center gap-2">
            {columnToggle && (
              <details className="relative">
                <summary className="cursor-pointer text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors list-none">
                  الأعمدة ▼
                </summary>
                <div className="absolute right-0 mt-1 z-20 bg-background border border-border rounded-lg shadow-lg p-2 min-w-[160px] max-h-60 overflow-y-auto">
                  {columns.map(col => {
                    const colKey = String(col.key);
                    const isHidden = hiddenColumns.has(colKey);
                    return (
                      <label key={colKey} className="flex items-center gap-2 py-1 cursor-pointer text-xs hover:bg-muted/40 px-1 rounded">
                        <input
                          type="checkbox"
                          checked={!isHidden}
                          onChange={() => toggleColumn(colKey)}
                          className="w-3 h-3"
                        />
                        <span>{col.headerAr || col.header}</span>
                      </label>
                    );
                  })}
                </div>
              </details>
            )}
            {exportButton}
            {publishButton}
          </div>
        </div>
      )}

      <div className={wrapperCls}>
        <Table className="text-xs">
          <TableHeader className={headerCls}>
            <TableRow className="bg-muted/40 hover:bg-transparent">
              {visibleColumns.map((col, i) => {
                const colKey = String(col.key);
                const isActiveSort = sortKey === colKey && sortDir != null;
                return (
                  <TableHead
                    key={`h-${colKey}-${i}`}
                    className={cn(
                      headerPadding,
                      'whitespace-nowrap text-[11px] font-bold text-muted-foreground',
                      alignClass(col.align),
                      col.width,
                      col.sortable && 'cursor-pointer select-none hover:bg-muted/60 transition-colors',
                      col.headerClassName,
                    )}
                    onClick={col.sortable ? () => handleSort(col) : undefined}
                    aria-sort={isActiveSort ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.headerAr || col.header}
                      {col.sortable && (
                        <span className="inline-flex shrink-0">
                          {isActiveSort ? (
                            sortDir === 'asc'
                              ? <ChevronUp className="w-3 h-3 text-foreground" />
                              : <ChevronDown className="w-3 h-3 text-foreground" />
                          ) : (
                            <ChevronsUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </span>
                      )}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
            {/* Filter row */}
            {filterable && (
              <TableRow className="hover:bg-transparent border-b border-border/50">
                {visibleColumns.map((col, i) => {
                  const colKey = String(col.key);
                  return (
                    <TableHead key={`f-${colKey}-${i}`} className={cn(headerPadding, 'py-1')}>
                      {col.filterable && (
                        <input
                          type="text"
                          placeholder="فلتر..."
                          value={filterValues[colKey] || ''}
                          onChange={(e) => setFilterValues(prev => ({ ...prev, [colKey]: e.target.value }))}
                          className="w-full h-6 text-[10px] px-1 rounded border border-border/50 bg-background/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                        />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {filteredData.map((row, ri) => {
              const rk = keyField
                ? String(getCellValue(row, keyField) ?? ri)
                : String(ri);
              const extraCls = rowClassName?.(row, ri);
              const isExpanded = expandable && expandedKey === rk;
              return (
                <React.Fragment key={`row-frag-${rk}`}>
                  <TableRow
                    key={`row-${rk}`}
                    className={cn(
                      'border-b border-border/30 transition-colors',
                      (onRowClick || expandable) && 'cursor-pointer hover:bg-muted/40',
                      isExpanded && 'bg-muted/20',
                      extraCls,
                    )}
                    onClick={(e) => {
                      if (expandable) {
                        setExpandedKey(isExpanded ? null : rk);
                      }
                      if (onRowClick) onRowClick(row);
                    }}
                    onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                    onContextMenu={(e) => {
                      if (onRowLongPress) {
                        e.preventDefault();
                        onRowLongPress(row);
                      }
                    }}
                    onTouchStart={(e) => {
                      if (onRowLongPress) {
                        const touch = e.touches[0];
                        const timer = setTimeout(() => {
                          onRowLongPress(row);
                        }, 600);
                        (e.currentTarget as HTMLElement).dataset.longPressTimer = String(timer);
                      }
                    }}
                    onTouchEnd={(e) => {
                      if (onRowLongPress) {
                        const timer = (e.currentTarget as HTMLElement).dataset.longPressTimer;
                        if (timer) {
                          clearTimeout(Number(timer));
                          delete (e.currentTarget as HTMLElement).dataset.longPressTimer;
                        }
                      }
                    }}
                    onTouchMove={(e) => {
                      if (onRowLongPress) {
                        const timer = (e.currentTarget as HTMLElement).dataset.longPressTimer;
                        if (timer) {
                          clearTimeout(Number(timer));
                          delete (e.currentTarget as HTMLElement).dataset.longPressTimer;
                        }
                      }
                    }}
                  >
                    {visibleColumns.map((col, ci) => {
                      const cellKey = `cell-${rk}-${ci}`;
                      const content = col.render
                        ? col.render(row)
                        : (getCellValue(row, col.key) as React.ReactNode);
                      return (
                        <TableCell
                          key={cellKey}
                          className={cn(
                            cellPadding,
                            'whitespace-nowrap',
                            alignClass(col.align),
                            col.width,
                            col.className,
                          )}
                        >
                          {content == null || content === '' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            content
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {/* Expandable content row */}
                  {isExpanded && expandRender && (
                    <TableRow key={`expand-${rk}`} className="bg-muted/10 hover:bg-muted/10">
                      <TableCell colSpan={visibleColumns.length} className="p-2">
                        {expandRender(row)}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default UnifiedTable;
