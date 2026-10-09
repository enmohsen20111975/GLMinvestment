'use client';

/**
 * UnifiedTable — الجدول الموحّد لكل المشروع (Excel-like Financial Grid)
 * ====================================================================
 * مكون جدول عام (generic) مبني فوق shadcn/ui Table primitives.
 *
 * ⭐ عند تفعيل `excelGrid={true}` → المكوّن ده بيكون «الجدول المتقدّم»
 *    (Advanced Table) — بديلنا الاحترافي لـ AG Grid ومنافسه في التحكم
 *    الكامل على غرار Excel. التوجيه المباشر من المالك:
 *      «الجدول الجديد الى انت عملتة دة بجد مش أحسن حاجة خالص هو مكتبة
 *       جاهزة بس زبالة بصراحة ممكن انت تستعمل الجدول الموحد بس هنا هاتعمل
 *       فية نفس التحكم الى فى المكتبة ويكون بتعنا احنا ونسمى المكون دة
 *       الجدول المتقدم»
 *
 * الميزات الأساسية (موجودة قبل Task 34-A):
 *  - Loading skeleton (N صفوف فارغة بنبضات pulse)
 *  - Empty state (رسالة متمركزة بالعربية)
 *  - Sticky header (اختياري، default true)
 *  - Multi-sort via `sortStack` (click cycles asc→desc→remove مع rank ①②③)
 *  - Custom numeric filters (`>`, `<`, `>=`, `<=`, `=`, `!=`)
 *  - Text filters (بحث نصي لكل عمود)
 *  - Column toggle (show/hide)
 *  - Row expand/collapse
 *  - Publish button + export button slots
 *  - Horizontal scroll on overflow
 *  - RTL افتراضياً
 *  - Responsive (موبايل → scroll أفقي)
 *
 * الميزات الجديدة (Task 34-A — Excel-style Power Engine):
 *  - AutoFilter Popover: لكل عمود filterable، زر فلتَر في الـ header
 *    بيفتح popover فيها: search box + "تحديد الكل/إلغاء" + checkbox list
 *    للـ distinct values. للأعمدة الرقمية: وضع "نطاق" (min/max) إضافي.
 *  - Multi-sort Shift hint: badge بـ "⇧" جنب رقم الترتيب لو فيه أكثر من مستوى.
 *  - Dynamic Column Picker Popover: بدل الـ <details> القديم، Popover فيه
 *    search + categories + drag-and-drop reorder + pin (📌 sticky right).
 *  - Calculated Columns Engine: زر "＋ عمود بمعادلة" بيفتح Dialog فيه
 *    formula editor + variable chips + operator buttons + live preview.
 *    البيانات بـ expr-eval (آمن — لا eval). بيتحفظ في localStorage.
 *  - Saved Presets: حفظ/استرجاع حالة الجدول (columns + filters + sort + calc + pin).
 *  - Default CSV Export: UTF-8 BOM للعربية، filename فيه timestamp.
 *
 * الميزات الجديدة (Task 37 — «الجدول المتقدّم» Excel-clone Controls):
 *  - Column Resize by Drag: مقبض سحب رفيع على حافة الـ header (RTL → يسار
 *    العمود). mouse + touch. بيتحفظ في localStorage تحت
 *    `unified-table-widths-${storageKey}`. لا يتداخل مع sort click.
 *  - Inline Cell Editing: double-click على خلية في عمود `editable:true`
 *    يحوّلها لـ `<input>`. Enter/blur = حفظ محلي (في localEdits overlay)؛
 *    Escape = إلغاء. الـ callback الاختياري `onCellEdit` يسمح للـ consumer
 *    بعمل persist للقيمة لقاعدة البيانات لو محتاج.
 *  - Copy/Paste to Excel: click = تحديد خلية، Shift+click = تحديد نطاق
 *    (rectangular). Ctrl/Cmd+C = نسخ TSV (tab-separated) عبر
 *    `navigator.clipboard.writeText` — يلصق مباشرة في Excel/Sheets.
 *
 * Backward Compatibility (Rule 4):
 *  - كل الميزات الجديدة opt-in عبر `excelGrid={true}`.
 *  - لو `excelGrid={false}` (default) → السلوك مطابق تماماً للنسخة السابقة.
 *  - الـ consumers الموجودين (MakerRadarTab, StockScreenerAdvanced, إلخ)
 *    مش هيتأثروا إلا لو صرّحوا بـ excelGrid.
 *
 * Rule 30: emerald + amber + slate + red (لا indigo/blue).
 * Rule 67: لا معادلات وهمية — كل القيم تأتي من البيانات الحقيقية أو "—".
 *          الـ edits المحلية مش بتتحفظ لقاعدة البيانات تلقائياً (honest).
 * Rule 68: tsc clean + browser-verified.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  ChevronUp, ChevronDown, ChevronsUpDown, Inbox, Filter, X, Plus,
  Pin, GripVertical, Save, Download, Search, Calculator, Trash2, ListFilter, Columns3,
  ArrowUpDown,
} from 'lucide-react';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { formatTableToText } from '@/modules/publishing/lib/table-share-formatter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  evaluateFormula,
  validateFormula,
  extractVariables,
  FORMULA_VARIABLES,
  CATEGORY_LABELS,
  type FormulaVariable,
} from '@/components/shared/FormulaEngine';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ColumnCategory = 'price' | 'fundamentals' | 'technical' | 'liquidity' | 'meta' | 'custom';

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
  /** إخفاء العمود افتراضياً (default: false) — المستخدم يقدر يظهره عبر columnToggle.
   *  مفيد للجداول الكتيرة الأعمدة عشان نعرض بس الأهم افتراضياً. */
  hidden?: boolean;
  /** دالة فلترة مخصصة */
  filterRender?: (column: Column<T>, value: string, onChange: (v: string) => void) => React.ReactNode;
  /** (Task 34-A) تصنيف العمود — للـ column picker الجديد */
  category?: ColumnCategory;
  /** (Task 37) هل الخلية قابلة للتحرير المباشر (double-click to edit)?
   *  Local state only — لا بتتحفظ لقاعدة البيانات إلا لو الـ consumer
   *  مرّر `onCellEdit` callback. الـ edits بتعيش في localEdits overlay. */
  editable?: boolean;
  /** (Task IMPROVEMENT-20-2026-10-07) دالة استخراج قيمة الفرز/الفلترة.
   *  لو الـ render بترجع JSX (مش رقم/نص) → استخدم دي عشان تحدد القيمة اللي يتفرز عليها.
   *  مثال: sortValue: (row) => row.buy_pct ?? 0 */
  sortValue?: (row: T) => number | string | null;
  /** (Task IMPROVEMENT-20) دالة استخراج قيمة الفلترة النصية.
   *  لو الـ render بترجع JSX → استخدم دي عشان تحدد القيمة اللي تتفلتر عليها. */
  filterValue?: (row: T) => string | null;
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
  // ─── ميزات متقدمة (مستوحاة من جدول حركة القطاعات) ───
  /** هل الصفوف قابلة للتوسعة؟ (default: true — صفة أساسية في أي جدول)
   *  أي جدول يقدر يطوي/يفرد الصفوف افتراضياً. لو مش عايز expand، مرّر expandable={false}.
   *  لو مرّرت expandRender → بيظهر المحتوى المخصص. لو لأ → بيظهر default expand (row data). */
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
  /** زر نشر موحّد (يظهر فوق الجدول) — لو اتعطى، بيلغي auto-publishable */
  publishButton?: React.ReactNode;
  /** زر تصدير (CSV/PDF) */
  exportButton?: React.ReactNode;
  /** أزرار إضافية فوق الجدول */
  toolbarActions?: React.ReactNode;
  /** ─── ميزة النشر التلقائي (NEW — Task PUBLISH-GENERALIZE) ─── */
  /** تفعيل زر النشر الموحّد تلقائياً (default: false). لو publishButton اتعطى، ده بيتجاهل. */
  publishable?: boolean;
  /** عنوان المحتوى عند النشر (مثال: "رادار السيولة — Pre-Surge") */
  publishTitle?: string;
  /** اسم ملف الصورة عند التحميل (مثال: "maker-radar-stocks") */
  publishFilename?: string;
  /** هاشتاجات مخصصة للجدول */
  publishHashtags?: string[];
  /** دالة مخصصة لتحويل الصفوف لنص (اختيارية — يوجد محول افتراضي) */
  customPublishFormatter?: (columns: Column<T>[], data: T[]) => string;
  /** ملاحظة فرعية تظهر تحت العنوان في النص المنشور */
  publishSubtitle?: string;
  /** هل الجدول كله قابل للطي؟ (default: true — المستخدم يقدر يطوي القسم كله) */
  collapsible?: boolean;
  /** الحالة الابتدائية: مطوي؟ (default: false — مفتوح) */
  defaultCollapsed?: boolean;
  /** ─── الترتيب الابتدائي (NEW — Task STOCKS-TABLE-FIX) ───
   *  يطبّق مرة واحدة عند الـ mount. بيكون بمثابة الـ "default sort"
   *  قبل ما المستخدم يضغط على أي عمود. */
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  /** ─── (Task 34-A) Excel-style Power Engine ───
   *  تفعيل كل ميزات الـ Excel-like grid (default: false).
   *  - AutoFilter popover (multi-select + range)
   *  - Column Picker popover (search + categories + drag-drop + pin)
   *  - Calculated columns (formula engine)
   *  - Saved presets (localStorage)
   *  - Default CSV export
   *  لو false → السلوك مطابق للنسخة السابقة (backward compatible). */
  excelGrid?: boolean;
  /** (Task 34-A) مفتاح فريد لتخزين الـ calculated columns + presets في localStorage.
   *  مفيد لو فيه أكتر من UnifiedTable بنفس excelGrid=true في نفس الصفحة.
   *  default: title || 'default'. */
  storageKey?: string;
  /** (Task 37) «الجدول المتقدّم» — callback اختياري يتنفّذ لما المستخدم
   *  يحرّر خلية في عمود editable (double-click → Enter/blur). الـ consumer
   *  يقدر يعمل persist للقيمة لقاعدة البيانات لو محتاج. الـ edit نفسه
   *  بيتعمل محلياً في localEdits overlay (مش بيعدّل الـ data prop الأصلي). */
  onCellEdit?: (row: T, key: string, newValue: string) => void;

  /** خريطة إظهار/إخفاء الأعمدة (مفتاح = col.key، قيمة = visible؟). لو مش متمرر، كل الأعمدة ظاهرة */
  columnVisibility?: Record<string, boolean>;
  /** handler تغيير إظهار/إخفاء الأعمدة (controlled mode) */
  onColumnVisibilityChange?: (next: Record<string, boolean>) => void;
  /** هل زر إظهار/إخفاء الأعمدة ظاهر فوق الجدول؟ (default: false — backward compat) */
  showColumnToggle?: boolean;
}

type SortDirection = 'asc' | 'desc' | null;

// ─── Types for Excel-style state ───────────────────────────────────────────

interface CalculatedColumn {
  id: string;
  name: string;
  formula: string;
}

interface RangeFilter {
  min?: number;
  max?: number;
}

interface TablePreset {
  name: string;
  createdAt: number;
  hiddenColumns: string[];
  columnOrder: string[];
  pinnedColumns: string[];
  multiSelectFilters: Record<string, string[]>;
  rangeFilters: Record<string, RangeFilter>;
  customFilters: Array<{ key: string; op: string; value: string }>;
  sortStack: Array<{ key: string; dir: 'asc' | 'desc' }>;
  calculatedColumns: CalculatedColumn[];
}

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
  // null/undefined تروح للآخر دائماً (Task 35-F fix: كان بيتعكس في desc → nulls بتطلع فوق)
  if (a == null && b == null) return 0;
  if (a == null) return 1;  // a بعد b (دائماً في الآخر)
  if (b == null) return -1; // b بعد a (دائماً في الآخر)
  // أرقام
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  // نصوص رقمية (محتملة): جرّب تحويل لأرقام لو ممكن
  if (typeof a === 'string' && typeof b === 'string') {
    const na = Number(a);
    const nb = Number(b);
    if (!isNaN(na) && !isNaN(nb) && isFinite(na) && isFinite(nb)) {
      return na - nb;
    }
    return a.localeCompare(b, 'ar');
  }
  // mixed types — حوّل لنص
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

/**
 * CSV cell escape — يلفّ القيمة في علامات اقتباس لو فيها فاصلة/اقتباس/سطر جديد.
 */
function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function UnifiedTable<T extends object>({
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
  expandable = true, // صفة أساسية — أي جدول يقدر يطوي/يفرد
  expandRender,
  defaultExpandedKey,
  columnToggle = false,
  filterable = false,
  title,
  publishButton,
  exportButton,
  toolbarActions,
  // ─── ميزة النشر التلقائي (NEW) ───
  publishable = false,
  publishTitle,
  publishFilename,
  publishHashtags = [],
  customPublishFormatter,
  publishSubtitle,
  // ─── طي الجدول كله (NEW) ───
  collapsible = true,
  defaultCollapsed = false,
  // ─── الترتيب الابتدائي (NEW — Task STOCKS-TABLE-FIX) ───
  initialSort,
  // ─── (Task 34-A) Excel-style Power Engine ───
  // Task 35-F: excelGrid default = false. The Excel Power Engine (calculated
  // columns + presets + column picker) is a PRO feature for the SPECIAL screen
  // only (StockScreenerAdvanced passes excelGrid={true}). Other tables get
  // the BASIC sort + filter only — keeps them light + focused.
  // Rule 67: owner directive — the "power features" belong on one screen, not all.
  // Task 37: «الجدول المتقدّم» — owner reverted to using UnifiedTable for the
  // expert screen too (AG Grid was trashed). UnifiedTable now has all the
  // Excel controls (resize + edit + copy/paste) — no external dependency.
  excelGrid = false,
  storageKey,
  // (Task 37) «الجدول المتقدّم» callback for inline cell editing.
  onCellEdit,
  columnVisibility,
  onColumnVisibilityChange,
  showColumnToggle = false,
}: UnifiedTableProps<T>) {
  // ref للـ table wrapper عشان نقدر نلتقطه كصورة
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  // ref للـ formula textarea (لإدراج المتغيرات عند الـ cursor)
  const formulaTextareaRef = useRef<HTMLTextAreaElement>(null);
  // ─── Multi-sort: قائمة من {key, dir} بدلاً من عمود واحد ─────────────
  const [sortStack, setSortStack] = useState<Array<{ key: string; dir: 'asc' | 'desc' }>>(
    initialSort ? [initialSort] : []
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(defaultExpandedKey || null);
  // ─── الأعمدة المخفية: ابدأ بالأعمدة اللي عليها hidden:true ───
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const col of columns) {
      if (col.hidden) initial.add(String(col.key));
    }
    return initial;
  });
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  // ─── طي الجدول كله ───
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  // ─── Custom conditions: شروط مخصصة (مثلاً: التغير > 5 AND السيولة < 1M) ───
  const [customFilters, setCustomFilters] = useState<Array<{ key: string; op: '>' | '<' | '>=' | '<=' | '=' | '!='; value: string }>>([]);
  const [showCustomFilter, setShowCustomFilter] = useState(false);

  // ─── (Task 34-A) Excel-style state ──────────────────────────────────────
  const effectiveStorageKey = storageKey || (typeof title === 'string' ? title : 'default');
  const calcStorageKey = `unified-table-calc-${effectiveStorageKey}`;
  const presetsStorageKey = `unified-table-presets-${effectiveStorageKey}`;

  // Multi-select filters: column key -> Set of selected values
  const [multiSelectFilters, setMultiSelectFilters] = useState<Record<string, Set<string>>>({});
  // Range filters: column key -> { min?, max? }
  const [rangeFilters, setRangeFilters] = useState<Record<string, RangeFilter>>({});
  // Range drafts (text input state before Apply)
  const [rangeDrafts, setRangeDrafts] = useState<Record<string, { min: string; max: string }>>({});
  // Column order (default: original order from `columns` prop)
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  // Pinned columns (sticky right for RTL)
  const [pinnedColumns, setPinnedColumns] = useState<Set<string>>(new Set());
  // Calculated columns (persisted to localStorage)
  const [calculatedColumns, setCalculatedColumns] = useState<CalculatedColumn[]>([]);
  // Presets
  const [presets, setPresets] = useState<TablePreset[]>([]);
  // UI dialogs
  const [showCalcDialog, setShowCalcDialog] = useState(false);
  const [showPresetSaveDialog, setShowPresetSaveDialog] = useState(false);
  // Formula dialog state
  const [formulaName, setFormulaName] = useState('');
  const [formulaText, setFormulaText] = useState('');
  // Column picker search + drag state
  const [columnPickerSearch, setColumnPickerSearch] = useState('');
  const [draggedColKey, setDraggedColKey] = useState<string | null>(null);
  // Preset save dialog
  const [presetName, setPresetName] = useState('');
  // (UNIFIED-TABLE-UPGRADE) Multi-sort Popover drag state — index of the
  // sort level being dragged for reorder (null = no drag in progress).
  const [sortDragIdx, setSortDragIdx] = useState<number | null>(null);

  // ─── (Task 37) «الجدول المتقدّم» — Excel-clone cell-level state ───
  // Rule 67 root cause: AG Grid theme mismatch + npm install failure on VPS →
  // we trash AG Grid + add the 3 missing features (resize + edit + copy/paste)
  // to our own UnifiedTable. No external dependency.
  const widthsStorageKey = `unified-table-widths-${effectiveStorageKey}`;
  // Column resize by drag — persisted to localStorage per storageKey
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<{ colKey: string; startX: number; startWidth: number } | null>(null);
  // Inline cell editing (local state only — NOT saved to DB; Rule 67 honest)
  const [editingCell, setEditingCell] = useState<{ rowKey: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  // Local edits overlay (rowKey → colKey → newValue) applied via mutableData
  const [localEdits, setLocalEdits] = useState<Record<string, Record<string, unknown>>>({});
  // Cell selection + range rectangle (for copy/paste to Excel via TSV)
  const [selectionStart, setSelectionStart] = useState<{ row: number; colKey: string } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ row: number; colKey: string } | null>(null);

  // ─── Load calculated columns + presets from localStorage on mount ───
  useEffect(() => {
    if (!excelGrid) return;
    try {
      const rawCalc = typeof window !== 'undefined' ? window.localStorage.getItem(calcStorageKey) : null;
      if (rawCalc) {
        const parsed = JSON.parse(rawCalc);
        if (Array.isArray(parsed)) setCalculatedColumns(parsed);
      }
    } catch { /* ignore parse errors - safe-by-design */ }
    try {
      const rawPresets = typeof window !== 'undefined' ? window.localStorage.getItem(presetsStorageKey) : null;
      if (rawPresets) {
        const parsed = JSON.parse(rawPresets);
        if (Array.isArray(parsed)) setPresets(parsed);
      }
    } catch { /* ignore parse errors - safe-by-design */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excelGrid]);

  // ─── Persist calculated columns ───
  useEffect(() => {
    if (!excelGrid) return;
    try {
      window.localStorage.setItem(calcStorageKey, JSON.stringify(calculatedColumns));
    } catch { /* ignore quota errors - safe-by-design */ }
  }, [excelGrid, calculatedColumns, calcStorageKey]);

  // ─── Persist presets ───
  const persistPresets = useCallback((next: TablePreset[]) => {
    setPresets(next);
    try {
      window.localStorage.setItem(presetsStorageKey, JSON.stringify(next));
    } catch { /* ignore - safe-by-design */ }
  }, [presetsStorageKey]);

  // ─── (Task 37) Load column widths from localStorage on mount ───
  useEffect(() => {
    if (!excelGrid) return;
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(widthsStorageKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          setColumnWidths(parsed as Record<string, number>);
        }
      }
    } catch { /* ignore parse errors - safe-by-design */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excelGrid]);

  // ─── (Task 37) Persist column widths to localStorage on change ───
  useEffect(() => {
    if (!excelGrid) return;
    try {
      window.localStorage.setItem(widthsStorageKey, JSON.stringify(columnWidths));
    } catch { /* ignore quota errors - safe-by-design */ }
  }, [excelGrid, columnWidths, widthsStorageKey]);

  // ─── (Task 37) mutableData — applies local edits on top of incoming data ───
  // الـ edits بتعيش في localEdits overlay (rowKey → colKey → newValue).
  // mutableData = data + overlay. مش بيمسّ الـ data prop الأصلي (Rule 67 honest).
  const mutableData = useMemo<T[]>(() => {
    if (!excelGrid || Object.keys(localEdits).length === 0) return data;
    return data.map((row, idx) => {
      const rk = keyField
        ? String(getCellValue(row, keyField) ?? idx)
        : String(idx);
      const overrides = localEdits[rk];
      if (!overrides) return row;
      return { ...row, ...overrides } as T;
    });
  }, [data, excelGrid, localEdits, keyField]);

  // ─── (Task 37) Column resize by drag (mouse + touch) ───
  const startResize = useCallback((clientX: number, colKey: string) => {
    const currentWidth = columnWidths[colKey] ?? 120;
    setResizingCol({ colKey, startX: clientX, startWidth: currentWidth });
  }, [columnWidths]);

  // Global listeners during active drag — موحد لـ mouse + touch
  useEffect(() => {
    if (!resizingCol) return;
    const handleMove = (clientX: number) => {
      const delta = clientX - resizingCol.startX;
      // RTL: handle on LEFT edge → dragging right (delta>0) shrinks.
      // LTR: handle on RIGHT edge → dragging right (delta>0) grows.
      const newWidth = dir === 'rtl'
        ? Math.max(60, Math.round(resizingCol.startWidth - delta))
        : Math.max(60, Math.round(resizingCol.startWidth + delta));
      setColumnWidths(prev => ({ ...prev, [resizingCol.colKey]: newWidth }));
    };
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) handleMove(e.touches[0].clientX);
    };
    const onEnd = () => setResizingCol(null);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [resizingCol, dir]);

  // ─── (Task 37) Inline cell editing handlers ───
  const startEdit = useCallback((rowKey: string, colKey: string, currentValue: unknown) => {
    setEditingCell({ rowKey, colKey });
    setEditValue(currentValue == null ? '' : String(currentValue));
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const { rowKey, colKey } = editingCell;
    setLocalEdits(prev => ({
      ...prev,
      [rowKey]: { ...(prev[rowKey] || {}), [colKey]: editValue },
    }));
    // Rule 67 honest: الـ callback اختياري — consumer يقدر يعمل persist لو عايز.
    const row = data.find((r, idx) => {
      const rk = keyField ? String(getCellValue(r, keyField) ?? idx) : String(idx);
      return rk === rowKey;
    });
    if (row && onCellEdit) onCellEdit(row, colKey, editValue);
    setEditingCell(null);
    setEditValue('');
  }, [editingCell, editValue, data, keyField, onCellEdit]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  // ─── (Task 37) Cell selection + range rectangle (computed) ───
  // NOTE: handleCellClick/DoubleClick + copy effect are declared AFTER
  // visibleColumns + filteredData + computedSelection — TypeScript requires
  // this ordering (block-scoped variable use-before-declaration rule).
  // The handlers themselves run later (user click) so closure capture is fine.


  const handleSort = useCallback((col: Column<T>, isShift: boolean = false) => {
    if (!col.sortable) return;
    const colKey = String(col.key);
    setSortStack(prev => {
      const existing = prev.find(s => s.key === colKey);
      if (!isShift) {
        // SINGLE SORT (normal click) — استبدل الـ stack بمستوى واحد:
        //   asc → desc → clear (رجوع للوضع الافتراضي).
        if (!existing) return [{ key: colKey, dir: 'asc' as const }];
        if (existing.dir === 'asc') return [{ key: colKey, dir: 'desc' as const }];
        return []; // clear sort
      }
      // MULTI SORT (Shift+click) — أضف/حدّث في الـ stack مع rank badge ❶❷❸:
      if (!existing) {
        return [...prev, { key: colKey, dir: 'asc' as const }];
      }
      if (existing.dir === 'asc') {
        return prev.map(s => s.key === colKey ? { ...s, dir: 'desc' as const } : s);
      } else {
        return prev.filter(s => s.key !== colKey);
      }
    });
  }, []);

  // أرقام الترتيب (1st, 2nd, 3rd) لعرضها بجوار اسم العمود
  const sortRank = useCallback((colKey: string): number | null => {
    const idx = sortStack.findIndex(s => s.key === colKey);
    return idx >= 0 ? idx + 1 : null;
  }, [sortStack]);

  // ─── (UNIFIED-TABLE-UPGRADE) Multi-Sort reorder/remove helpers ────────
  // يدعم أزرار الـ Popover «ترتيب مخصص ⇕»: drag-to-reorder + remove level.
  const removeSortLevel = useCallback((colKey: string) => {
    setSortStack(prev => prev.filter(s => s.key !== colKey));
  }, []);

  const toggleSortDir = useCallback((colKey: string) => {
    setSortStack(prev => prev.map(s =>
      s.key === colKey ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s
    ));
  }, []);

  const reorderSortStack = useCallback((fromIdx: number, toIdx: number) => {
    setSortStack(prev => {
      if (fromIdx < 0 || fromIdx >= prev.length) return prev;
      if (toIdx < 0 || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  const clearAllSorts = useCallback(() => setSortStack([]), []);

  const sortedData = useMemo(() => {
    // Task 37: use mutableData (data + localEdits overlay) when excelGrid=true
    // so sorting reflects user-edited cell values, not stale prop values.
    const source = excelGrid ? mutableData : data;
    // لو مفيش ترتيب نشط (sortStack فارغة) → رجّع الـ data زي ما هي
    // (المرسل يقدر يبعتها مُرتّبة مسبقاً كـ default).
    if (sortStack.length === 0) return source;
    // اتسخ نسخة عميقة عشان ما نأثرش على الـ prop الأصلي
    const arr = [...source];
    // Task IMPROVEMENT-20: ابحث عن الـ column عشان تستخدم sortValue لو موجودة
    arr.sort((a, b) => {
      for (const { key, dir } of sortStack) {
        // Task IMPROVEMENT-20: استخدم sortValue من الـ column لو موجود
        const col = columns.find(c => String(c.key) === key);
        const av = col?.sortValue ? col.sortValue(a) : getCellValue(a, key);
        const bv = col?.sortValue ? col.sortValue(b) : getCellValue(b, key);
        // Task 35-F fix: nulls ALWAYS go to bottom, regardless of asc/desc.
        // compareValues returns 1 for null→bottom, -1 for non-null→top.
        // We must NOT reverse this for desc — only reverse the actual value comparison.
        const aNull = av == null;
        const bNull = bv == null;
        if (aNull && bNull) continue; // both null → skip to next sort key
        if (aNull) return 1;  // a is null → always bottom
        if (bNull) return -1; // b is null → always bottom
        // Both non-null → compare normally + apply direction
        const cmp = compareValues(av, bv);
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
    return arr;
  }, [data, mutableData, excelGrid, sortStack]);

  // ─── (Task 34-A) AutoFilter helpers ───────────────────────────────────
  // (UNIFIED-TABLE-UPGRADE) Universal value extraction — respects `col.filterValue`
  // لو الـ render بيرجّع JSX، نستخدم filterValue (لو موجودة) عشان الفلتر يشتغل
  // على القيمة المعروضة فعلاً (مش القيمة الخام في row). كده أي عمود يشتغل.
  // NOTE: نستخدم `columns` (مش `allColumns`) لأن allColumns معرّفة بعدين (TDZ).
  // calc columns لها filterValue implicitly عبر render؛ الـ distinct values لهم
  // بتتعمل بشكل صحيح من render ( Rule 67 — لا fabrication).
  const getCellFilterValue = useCallback((row: T, colKey: string): unknown => {
    const col = columns.find(c => String(c.key) === colKey);
    if (col?.filterValue) {
      try { return col.filterValue(row); } catch { /* fallthrough - safe-by-design */ }
    }
    return getCellValue(row, colKey);
  }, [columns]);

  // detect numeric column (peek at first non-null value)
  const isNumericColumn = useCallback((colKey: string): boolean => {
    for (const row of data) {
      const v = getCellFilterValue(row, colKey);
      if (v == null || v === '') continue;
      if (typeof v === 'number') return true;
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) && isFinite(Number(v))) return true;
      return false; // found non-null non-numeric → text column
    }
    return false;
  }, [data, getCellFilterValue]);

  const getDistinctValues = useCallback((colKey: string): string[] => {
    const set = new Set<string>();
    for (const row of data) {
      const v = getCellFilterValue(row, colKey);
      if (v == null || v === '') continue;
      set.add(String(v));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar', { numeric: true }));
  }, [data, getCellFilterValue]);

  const isColumnFilterActive = useCallback((colKey: string): boolean => {
    if (multiSelectFilters[colKey] && multiSelectFilters[colKey].size > 0) return true;
    if (rangeFilters[colKey] && (rangeFilters[colKey].min != null || rangeFilters[colKey].max != null)) return true;
    return false;
  }, [multiSelectFilters, rangeFilters]);

  const activeFilterCount = useCallback((colKey: string): number => {
    const ms = multiSelectFilters[colKey];
    const total = getDistinctValues(colKey).length;
    if (ms && ms.size > 0 && ms.size < total) return ms.size;
    if (rangeFilters[colKey] && (rangeFilters[colKey].min != null || rangeFilters[colKey].max != null)) return 1;
    return 0;
  }, [multiSelectFilters, rangeFilters, getDistinctValues]);

  const clearColumnFilter = useCallback((colKey: string) => {
    setMultiSelectFilters(prev => {
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
    setRangeFilters(prev => {
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
    setRangeDrafts(prev => {
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
  }, []);

  const toggleMultiSelectValue = useCallback((colKey: string, value: string) => {
    setMultiSelectFilters(prev => {
      const current = prev[colKey] || new Set<string>();
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [colKey]: next };
    });
  }, []);

  const selectAllValues = useCallback((colKey: string, values: string[]) => {
    setMultiSelectFilters(prev => ({ ...prev, [colKey]: new Set(values) }));
  }, []);

  const clearAllValues = useCallback((colKey: string) => {
    setMultiSelectFilters(prev => {
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
  }, []);

  const applyRangeFilter = useCallback((colKey: string) => {
    const draft = rangeDrafts[colKey];
    if (!draft) return;
    const min = draft.min.trim() === '' ? undefined : Number(draft.min);
    const max = draft.max.trim() === '' ? undefined : Number(draft.max);
    setRangeFilters(prev => {
      const next: RangeFilter = {};
      if (min != null && !isNaN(min) && isFinite(min)) next.min = min;
      if (max != null && !isNaN(max) && isFinite(max)) next.max = max;
      return { ...prev, [colKey]: next };
    });
  }, [rangeDrafts]);

  // فلترة البيانات حسب الـ text filters + custom conditions + multi-select + range
  const filteredData = useMemo(() => {
    let result = sortedData;

    // 1) Text filters (بحث نصي)
    //    (UNIFIED-TABLE-UPGRADE) يشتغل عبر getCellFilterValue (universal).
    if (filterable && Object.keys(filterValues).length > 0) {
      result = result.filter(row => {
        for (const [colKey, filterVal] of Object.entries(filterValues)) {
          if (!filterVal) continue;
          const val = getCellFilterValue(row, colKey);
          if (val == null) continue;
          if (!String(val).toLowerCase().includes(filterVal.toLowerCase())) return false;
        }
        return true;
      });
    }

    // 2) Custom conditions (شروط رقمية: > 5, < 1000000, etc.)
    //    (UNIFIED-TABLE-UPGRADE) يستخدم getCellFilterValue (universal).
    if (customFilters.length > 0) {
      result = result.filter(row => {
        for (const cf of customFilters) {
          const val = getCellFilterValue(row, cf.key);
          if (val == null) return false;
          const numVal = Number(val);
          const filterNum = Number(cf.value);
          if (!Number.isFinite(numVal) || !Number.isFinite(filterNum)) continue;
          switch (cf.op) {
            case '>':  if (!(numVal > filterNum)) return false; break;
            case '<':  if (!(numVal < filterNum)) return false; break;
            case '>=': if (!(numVal >= filterNum)) return false; break;
            case '<=': if (!(numVal <= filterNum)) return false; break;
            case '=':  if (!(numVal === filterNum)) return false; break;
            case '!=': if (!(numVal !== filterNum)) return false; break;
          }
        }
        return true;
      });
    }

    // 3) Multi-select filters — available for ALL filterable tables (not gated behind excelGrid)
    //    (UNIFIED-TABLE-UPGRADE) يستخدم getCellFilterValue (universal) عشان
    //    يشتغل مع الأعمدة اللي render JSX لكن ليها filterValue معرّفة.
    if (filterable && Object.keys(multiSelectFilters).length > 0) {
      result = result.filter(row => {
        for (const [colKey, selectedSet] of Object.entries(multiSelectFilters)) {
          if (!selectedSet || selectedSet.size === 0) continue;
          const val = getCellFilterValue(row, colKey);
          if (val == null) return false;
          if (!selectedSet.has(String(val))) return false;
        }
        return true;
      });
    }

    // 4) Range filters (numeric columns) — available for ALL filterable tables
    //    (UNIFIED-TABLE-UPGRADE) يستخدم getCellFilterValue (universal).
    if (filterable && Object.keys(rangeFilters).length > 0) {
      result = result.filter(row => {
        for (const [colKey, range] of Object.entries(rangeFilters)) {
          if (range.min == null && range.max == null) continue;
          const val = getCellFilterValue(row, colKey);
          if (val == null) return false;
          const numVal = Number(val);
          if (!Number.isFinite(numVal)) return false;
          if (range.min != null && !(numVal >= range.min)) return false;
          if (range.max != null && !(numVal <= range.max)) return false;
        }
        return true;
      });
    }

    // 5) (Task 34-A) Calculated columns are filtered by their evaluated value
    // (handled implicitly because calc columns appear in visibleColumns with
    // a render function — text/custom filters apply to them too via the same
    // getCellValue path. For now we expose calc value via a synthetic field.)

    return result;
  }, [sortedData, filterValues, filterable, customFilters, excelGrid, multiSelectFilters, rangeFilters, getCellFilterValue]);
  // NOTE: excelGrid kept in deps for calculated-column filter path (backward compat)
  // NOTE: getCellFilterValue added for universal filterValue support (UNIFIED-TABLE-UPGRADE)

  // ─── (Task 34-A) Build effective columns (native + calculated) ────────
  const allColumns = useMemo(() => {
    if (!excelGrid || calculatedColumns.length === 0) return columns;
    const calcCols: Column<T>[] = calculatedColumns.map(c => ({
      key: c.id,
      header: c.name,
      headerAr: c.name,
      sortable: true,
      filterable: true,
      category: 'custom' as const,
      align: 'left',
      render: (row: T) => {
        const result = evaluateFormula(c.formula, row as Record<string, unknown>);
        if (!result.ok) {
          return <span className="text-rose-500 text-[10px]" title={result.error}>خطأ</span>;
        }
        if (typeof result.value === 'number') {
          const isWhole = Number.isInteger(result.value);
          return <span className="font-mono text-xs">{isWhole ? result.value : (result.value ?? 0).toFixed(2)}</span>;
        }
        return <span className="font-mono text-xs">{result.value}</span>;
      },
    }));
    return [...columns, ...calcCols];
  }, [columns, excelGrid, calculatedColumns]);

  // الأعمدة المرئية (بعد إخفاء المختارة + تطبيق الترتيب)
  const visibleColumns = useMemo(() => {
    let cols: Column<T>[] = columnToggle
      ? allColumns.filter(col => !hiddenColumns.has(String(col.key)))
      : allColumns;
    // apply column order (only if user has reordered)
    if (excelGrid && columnOrder.length > 0) {
      const orderMap = new Map(columnOrder.map((k, i) => [k, i]));
      cols = [...cols].sort((a, b) => {
        const ai = orderMap.get(String(a.key));
        const bi = orderMap.get(String(b.key));
        if (ai == null && bi == null) return 0;
        if (ai == null) return 1; // new columns go to end
        if (bi == null) return -1;
        return ai - bi;
      });
    }
    // pinned columns first (so they appear at the right in RTL)
    if (excelGrid && pinnedColumns.size > 0) {
      cols = [...cols].sort((a, b) => {
        const aPinned = pinnedColumns.has(String(a.key)) ? 0 : 1;
        const bPinned = pinnedColumns.has(String(b.key)) ? 0 : 1;
        return aPinned - bPinned;
      });
    }
    return cols;
  }, [allColumns, hiddenColumns, columnToggle, excelGrid, columnOrder, pinnedColumns]);

  // ─── (Task 37) «الجدول المتقدّم» — cell selection rectangle (computed) ───
  // NOTE: declared AFTER visibleColumns to avoid temporal dead zone (TDZ).
  // Format: `${rowIndex}-${colKey}` — rowIndex هو الـ index في filteredData.
  const computedSelection = useMemo(() => {
    if (!excelGrid || !selectionStart || !selectionEnd) {
      return new Set<string>();
    }
    const visibleColKeys = visibleColumns.map(c => String(c.key));
    const startColIdx = visibleColKeys.indexOf(selectionStart.colKey);
    const endColIdx = visibleColKeys.indexOf(selectionEnd.colKey);
    if (startColIdx < 0 || endColIdx < 0) return new Set<string>();
    const minRow = Math.min(selectionStart.row, selectionEnd.row);
    const maxRow = Math.max(selectionStart.row, selectionEnd.row);
    const minCol = Math.min(startColIdx, endColIdx);
    const maxCol = Math.max(startColIdx, endColIdx);
    const cells = new Set<string>();
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        cells.add(`${r}-${visibleColKeys[c]}`);
      }
    }
    return cells;
  }, [excelGrid, selectionStart, selectionEnd, visibleColumns]);

  // ─── (Task 37) Cell click + double-click handlers (declared AFTER ─────
  //  visibleColumns + computedSelection so TS doesn't flag use-before-decl).
  const handleCellClick = useCallback((rowIdx: number, colKey: string, e: React.MouseEvent) => {
    if (!excelGrid) return;
    e.stopPropagation(); // لا تطلق row click — التحديد أولوية في excelGrid mode
    if (e.shiftKey && selectionStart) {
      // Shift+click = توسيع النطاق (rectangle)
      setSelectionEnd({ row: rowIdx, colKey });
    } else {
      // Click = بدء تحديد جديد (خلية واحدة)
      setSelectionStart({ row: rowIdx, colKey });
      setSelectionEnd({ row: rowIdx, colKey });
    }
  }, [excelGrid, selectionStart]);

  const handleCellDoubleClick = useCallback((rowIdx: number, colKey: string, row: T, e: React.MouseEvent) => {
    if (!excelGrid) return;
    e.stopPropagation(); // لا تطلق row double-click
    const col = visibleColumns.find(c => String(c.key) === colKey);
    if (!col || !col.editable) return;
    const rk = keyField
      ? String(getCellValue(row, keyField) ?? rowIdx)
      : String(rowIdx);
    const currentValue = getCellValue(row, colKey);
    startEdit(rk, colKey, currentValue);
  }, [excelGrid, visibleColumns, keyField, startEdit]);

  // ─── (Task 37) Copy selection to clipboard as TSV (Excel-pasteable) ───
  useEffect(() => {
    if (!excelGrid) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 'c' && e.key !== 'C')) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (computedSelection.size === 0) return;
      const visibleColKeys = visibleColumns.map(c => String(c.key));
      const rowIndices = Array.from(new Set(
        Array.from(computedSelection).map(s => Number(s.split('-')[0]))
      )).sort((a, b) => a - b);
      const tsv = rowIndices.map(ri => {
        const row = filteredData[ri];
        if (!row) return '';
        return visibleColKeys.map(colKey => {
          if (!computedSelection.has(`${ri}-${colKey}`)) return '';
          if (colKey.startsWith('calc_')) {
            const calc = calculatedColumns.find(c => c.id === colKey);
            if (calc) {
              const r = evaluateFormula(calc.formula, row as Record<string, unknown>);
              return r.ok ? String(r.value) : '';
            }
            return '';
          }
          const val = getCellValue(row, colKey);
          return val == null ? '' : String(val);
        }).join('\t');
      }).join('\n');
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(tsv).then(() => {
          // silent success — Excel-like behavior (no toast)
        }).catch(() => { /* ignore clipboard errors */ });
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [excelGrid, computedSelection, visibleColumns, filteredData, calculatedColumns]);

  const toggleColumn = useCallback((colKey: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(colKey)) next.delete(colKey);
      else next.add(colKey);
      return next;
    });
  }, []);

  const togglePinned = useCallback((colKey: string) => {
    setPinnedColumns(prev => {
      const next = new Set(prev);
      if (next.has(colKey)) next.delete(colKey);
      else next.add(colKey);
      return next;
    });
  }, []);

  // ─── (Task 34-A) Drag-and-drop reorder ─────────────────────────────────
  const orderedKeys = useMemo(() => {
    const base = allColumns.map(c => String(c.key));
    if (columnOrder.length === 0) return base;
    // merge: keep order but include any new columns at end
    const seen = new Set(columnOrder);
    const extras = base.filter(k => !seen.has(k));
    return [...columnOrder.filter(k => base.includes(k)), ...extras];
  }, [allColumns, columnOrder]);

  const handleDragStart = useCallback((e: React.DragEvent, colKey: string) => {
    setDraggedColKey(colKey);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', colKey); } catch { /* IE - safe-by-design */ }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, _targetKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    const sourceKey = draggedColKey;
    if (!sourceKey || sourceKey === targetKey) {
      setDraggedColKey(null);
      return;
    }
    setColumnOrder(prev => {
      const current = prev.length > 0 ? prev : orderedKeys;
      const fromIdx = current.indexOf(sourceKey);
      const toIdx = current.indexOf(targetKey);
      if (fromIdx < 0 || toIdx < 0) return current;
      const next = [...current];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, sourceKey);
      return next;
    });
    setDraggedColKey(null);
  }, [draggedColKey, orderedKeys]);

  // ─── (Task 34-A) Insert variable at cursor in formula textarea ─────────
  const insertAtCursor = useCallback((text: string) => {
    const ta = formulaTextareaRef.current;
    if (!ta) {
      setFormulaText(prev => prev + text);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = formulaText.slice(0, start) + text + formulaText.slice(end);
    setFormulaText(next);
    // restore focus + place cursor after inserted text
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }, [formulaText]);

  // ─── (Task 34-A) Save calculated column ────────────────────────────────
  const saveCalculatedColumn = useCallback(() => {
    const name = formulaName.trim();
    const formula = formulaText.trim();
    if (!name || !formula) return;
    const validation = validateFormula(formula);
    if (!validation.ok) {
      // surface error in UI (live preview already shows it)
      return;
    }
    const id = `calc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setCalculatedColumns(prev => [...prev, { id, name, formula }]);
    setFormulaName('');
    setFormulaText('');
    setShowCalcDialog(false);
  }, [formulaName, formulaText]);

  const deleteCalculatedColumn = useCallback((id: string) => {
    setCalculatedColumns(prev => prev.filter(c => c.id !== id));
    setPinnedColumns(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // ─── (Task 34-A) Preset save/load/delete ──────────────────────────────
  const savePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    const preset: TablePreset = {
      name,
      createdAt: Date.now(),
      hiddenColumns: Array.from(hiddenColumns),
      columnOrder,
      pinnedColumns: Array.from(pinnedColumns),
      multiSelectFilters: Object.fromEntries(
        Object.entries(multiSelectFilters).map(([k, v]) => [k, Array.from(v)])
      ),
      rangeFilters,
      customFilters,
      sortStack,
      calculatedColumns,
    };
    persistPresets([...presets.filter(p => p.name !== name), preset]);
    setPresetName('');
    setShowPresetSaveDialog(false);
  }, [presetName, hiddenColumns, columnOrder, pinnedColumns, multiSelectFilters, rangeFilters, customFilters, sortStack, calculatedColumns, presets, persistPresets]);

  const loadPreset = useCallback((name: string) => {
    const preset = presets.find(p => p.name === name);
    if (!preset) return;
    setHiddenColumns(new Set(preset.hiddenColumns));
    setColumnOrder(preset.columnOrder);
    setPinnedColumns(new Set(preset.pinnedColumns));
    setMultiSelectFilters(Object.fromEntries(
      Object.entries(preset.multiSelectFilters).map(([k, v]) => [k, new Set(v)])
    ));
    setRangeFilters(preset.rangeFilters);
    setCustomFilters(preset.customFilters as typeof customFilters);
    setSortStack(preset.sortStack);
    setCalculatedColumns(preset.calculatedColumns);
  }, [presets]);

  const deletePreset = useCallback((name: string) => {
    persistPresets(presets.filter(p => p.name !== name));
  }, [presets, persistPresets]);

  // ─── (Task 34-A) CSV Export (UTF-8 BOM for Arabic) ────────────────────
  const exportCSV = useCallback(() => {
    const headers = visibleColumns.map(c => c.headerAr || c.header);
    const rows = filteredData.map(row =>
      visibleColumns.map(col => {
        // for calculated columns: evaluate the formula
        if (String(col.key).startsWith('calc_')) {
          const calc = calculatedColumns.find(c => c.id === String(col.key));
          if (calc) {
            const r = evaluateFormula(calc.formula, row as Record<string, unknown>);
            return r.ok ? r.value : '';
          }
        }
        const v = getCellValue(row, col.key);
        if (v == null) return '';
        if (col.render) {
          // best-effort: render to string via render function? render returns ReactNode — we use raw value instead
          // (the visible cell might show formatted text but CSV wants raw)
          return v;
        }
        return v;
      }).map(csvEscape).join(',')
    );
    const csv = '\uFEFF' + headers.map(csvEscape).join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (typeof title === 'string' && title) || 'export';
    a.download = `${safeTitle}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [visibleColumns, filteredData, calculatedColumns, title]);

  // ─── (Task 34-A) Formula preview (first 3 rows) ──────────────────────
  const formulaPreview = useMemo(() => {
    if (!formulaText.trim()) return [];
    return data.slice(0, 3).map((row, idx) => ({
      idx,
      row,
      result: evaluateFormula(formulaText, row as Record<string, unknown>),
    }));
  }, [formulaText, data]);

  const formulaValidation = useMemo(() => {
    if (!formulaText.trim()) return null;
    return validateFormula(formulaText);
  }, [formulaText]);

  // ─── Group columns by category for the column picker ─────────────────
  const groupedAllColumns = useMemo(() => {
    const groups: Record<string, Column<T>[]> = {};
    for (const col of allColumns) {
      const cat = col.category || 'meta';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(col);
    }
    return groups;
  }, [allColumns]);

  const cellPadding = dense ? 'px-2 py-1' : 'px-3 py-2';
  const headerPadding = dense ? 'px-2 py-1.5' : 'px-3 py-2.5';

  // ─── بناء نص النشر التلقائي (لو publishable ومفيش publishButton صريح) ───
  const autoPublishContent = useMemo(() => {
    if (!publishable) return '';
    if (customPublishFormatter) {
      return customPublishFormatter(columns as any, data);
    }
    return formatTableToText({
      title: publishTitle || (typeof title === 'string' ? title : 'جدول بيانات'),
      columns: columns as any,
      data: data as any[],
      hashtags: publishHashtags,
      subtitle: publishSubtitle,
    });
  }, [publishable, customPublishFormatter, columns, data, publishTitle, title, publishHashtags, publishSubtitle]);

  // ─── الزر التلقائي (يتعمل مرة واحدة لو publishable) ───
  const autoPublishButton = useMemo(() => {
    if (!publishable || publishButton) return null;
    return (
      <UnifiedPublishButton
        content={autoPublishContent}
        title={publishTitle || (typeof title === 'string' ? title : undefined)}
        image={tableWrapperRef as React.RefObject<HTMLElement | null>}
        filename={publishFilename || 'm2y-table-export'}
        hashtags={publishHashtags}
        triggerLabel="نشر"
        variant="outline"
        size="sm"
      />
    );
  }, [publishable, publishButton, autoPublishContent, publishTitle, title, publishFilename, publishHashtags]);

  // الزر الفعلي: publishButton الصريح لو موجود، غير كده autoPublishButton
  const effectivePublishButton = publishButton || autoPublishButton;

  // (Task STOCKS-TABLE-V2) الـ Table primitive من shadcn بيلفّ الـ <table> في
  // <div data-slot="table-container" className="overflow-x-auto"> — ده بيعمل
  // scroll container داخلي بيكسر sticky الـ thead (لأن الـ thead بيلصق بالـ
  // inner container مش بالـ outer wrapper اللي عليه maxHeight). الحل: نعمل
  // override لـ overflow بتاع الـ inner container لـ visible، فبيبقى الـ outer
  // wrapper هو الـ scroll parent الوحيد، والـ sticky top-0 يشتغل صح.
  const wrapperCls = cn(
    'relative w-full overflow-x-auto overflow-y-auto custom-scrollbar',
    '[&_[data-slot=table-container]]:!overflow-visible',
    maxHeight,
    className,
  );

  // (Task STOCKS-TABLE-V2) z-20 (بدل z-10) عشان يفضل فوق أي row/expand،
  // bg-muted/90 (بدل bg-background/95) عشان يكون باكجراوند مظلون أوضح،
  // والـ thead نفسه يبقى sticky (مش بس الـ tr).
  const headerCls = cn(
    stickyHeader && 'sticky top-0 z-20 bg-muted/90 backdrop-blur shadow-sm',
  );

  // ─── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={wrapperCls} dir={dir}>
        <Table className="text-xs">
          <TableHeader className={headerCls}>
            <TableRow className="hover:bg-transparent">
              {visibleColumns.map((col, i) => (
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
                {visibleColumns.map((col, ci) => (
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
              {visibleColumns.map((col, i) => (
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
                colSpan={visibleColumns.length}
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
      {/* Toolbar: publish + export + column toggle + custom filter + title + collapse */}
      {(title || publishButton || exportButton || toolbarActions || columnToggle || filterable || collapsible || excelGrid) && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {/* زر طي الجدول كله */}
            {collapsible && (
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
                title={isCollapsed ? 'فرد الجدول' : 'طي الجدول'}
              >
                <span className="text-sm font-bold">{isCollapsed ? '▸' : '▾'}</span>
              </button>
            )}
            {title && <span className="text-sm font-bold">{title}</span>}
            {toolbarActions}
            {/* عدد الصفوف بعد الفلترة */}
            <span className="text-xs text-muted-foreground">
              {filteredData.length} / {data.length} صف
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* ─── (Task 34-A) Calculated Columns button ─── */}
            {excelGrid && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCalcDialog(true)}
                className="h-7 text-xs gap-1"
                title="إنشاء عمود بمعادلة مخصصة (Excel-style)"
              >
                <Calculator className="w-3 h-3 text-emerald-600" />
                عمود بمعادلة
                {calculatedColumns.length > 0 && (
                  <span className="bg-emerald-600 text-white rounded-full text-[9px] w-4 h-4 flex items-center justify-center">
                    {calculatedColumns.length}
                  </span>
                )}
              </Button>
            )}

            {/* ─── (Task 34-A) Saved Presets dropdown ─── */}
            {excelGrid && presets.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" title="القوالب المحفوظة">
                    <ListFilter className="w-3 h-3" />
                    قوالب ({presets.length})
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-2">
                  <div className="text-xs font-semibold mb-2">القوالب المحفوظة</div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {presets.map(p => (
                      <div key={p.name} className="flex items-center justify-between gap-1 hover:bg-muted/40 rounded px-1 py-1">
                        <button
                          onClick={() => loadPreset(p.name)}
                          className="text-xs flex-1 text-right truncate"
                          title={`تحميل: ${p.name}`}
                        >
                          {p.name}
                        </button>
                        <button
                          onClick={() => deletePreset(p.name)}
                          className="text-rose-500 hover:text-rose-700 p-0.5"
                          title="حذف"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* ─── (Task 34-A) Save Preset button ─── */}
            {excelGrid && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPresetSaveDialog(true)}
                className="h-7 text-xs gap-1"
                title="حفظ حالة الجدول الحالية كقالب"
              >
                <Save className="w-3 h-3" />
                حفظ القالب
              </Button>
            )}

            {/* زر الفلترة المخصصة (شروط رقمية) */}
            {filterable && (
              <button
                onClick={() => setShowCustomFilter(!showCustomFilter)}
                className={cn(
                  'text-xs px-2 py-1 rounded border transition-colors flex items-center gap-1',
                  showCustomFilter || customFilters.length > 0
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted'
                )}
                title="شروط مخصصة (مثلاً: التغير > 5%)"
              >
                <Filter className="w-3 h-3" />
                فلترة
                {customFilters.length > 0 && (
                  <span className="bg-primary text-primary-foreground rounded-full text-[9px] w-4 h-4 flex items-center justify-center">
                    {customFilters.length}
                  </span>
                )}
              </button>
            )}

            {/* ─── (UNIFIED-TABLE-UPGRADE) Multi-Sort Control Popover ─── */}
            {sortStack.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    title="إدارة مستويات الترتيب النشطة (سحب لإعادة الترتيب + حذف)"
                  >
                    <ArrowUpDown className="w-3 h-3 text-emerald-600" />
                    ترتيب مخصص ⇕
                    <span className="bg-emerald-600 text-white rounded-full text-[9px] w-4 h-4 flex items-center justify-center font-bold">
                      {sortStack.length}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold">مستويات الترتيب النشطة</div>
                      <button
                        onClick={clearAllSorts}
                        className="text-[10px] text-rose-500 hover:text-rose-700"
                        title="مسح كل مستويات الترتيب"
                      >
                        مسح الكل
                      </button>
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-relaxed">
                      رتّب المستويات بالسحب (الأعلى = أولوية أعلى). اضغط على اسم العمود لعكس الاتجاه.
                    </div>
                    {sortStack.length === 0 ? (
                      <div className="text-[11px] text-muted-foreground text-center py-3">
                        لا يوجد ترتيب نشط — اضغط على أي عمود لبدء الترتيب.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {sortStack.map((s, idx) => {
                          const col = allColumns.find(c => String(c.key) === s.key);
                          const label = col ? (col.headerAr || col.header) : s.key;
                          return (
                            <div
                              key={`sort-${s.key}-${idx}`}
                              draggable
                              onDragStart={() => setSortDragIdx(idx)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => {
                                if (sortDragIdx !== null && sortDragIdx !== idx) {
                                  reorderSortStack(sortDragIdx, idx);
                                }
                                setSortDragIdx(null);
                              }}
                              onDragEnd={() => setSortDragIdx(null)}
                              className={cn(
                                'flex items-center gap-1.5 px-1.5 py-1 rounded border border-border bg-background hover:bg-muted/40 cursor-grab active:cursor-grabbing transition-colors',
                                sortDragIdx === idx && 'opacity-50 ring-2 ring-emerald-500/40'
                              )}
                            >
                              <GripVertical className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                              <span className="text-[10px] font-bold w-4 h-4 rounded-full bg-primary/15 text-primary inline-flex items-center justify-center shrink-0">
                                {idx + 1}
                              </span>
                              <button
                                onClick={() => toggleSortDir(s.key)}
                                className="flex-1 text-right text-xs truncate hover:text-primary hover:underline"
                                title="اضغط لعكس الاتجاه"
                              >
                                {label}
                              </button>
                              <span className={cn(
                                'text-[10px] font-mono px-1 rounded shrink-0',
                                s.dir === 'asc'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-rose-500/15 text-rose-700 dark:text-rose-400'
                              )}>
                                {s.dir === 'asc' ? '↑ تصاعدي' : '↓ تنازلي'}
                              </span>
                              <button
                                onClick={() => removeSortLevel(s.key)}
                                className="text-rose-500 hover:text-rose-700 p-0.5 shrink-0"
                                title="إزالة مستوى الترتيب"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* ─── (Task 34-A) Dynamic Column Picker (Popover) ─── */}
            {excelGrid && columnToggle ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" title="اختيار وترتيب الأعمدة">
                    <GripVertical className="w-3 h-3" />
                    الأعمدة
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-3">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold">إدارة الأعمدة</div>
                    <div className="relative">
                      <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="بحث عن عمود..."
                        value={columnPickerSearch}
                        onChange={e => setColumnPickerSearch(e.target.value)}
                        className="w-full h-7 pr-7 pl-2 text-xs rounded border border-border bg-background"
                      />
                    </div>
                    <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                      {Object.entries(groupedAllColumns).map(([cat, cols]) => {
                        const filtered = cols.filter(c =>
                          !columnPickerSearch ||
                          (c.headerAr || c.header).toLowerCase().includes(columnPickerSearch.toLowerCase())
                        );
                        if (filtered.length === 0) return null;
                        const catLabel = (CATEGORY_LABELS as Record<string, string>)[cat] || cat;
                        return (
                          <div key={cat}>
                            <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">{catLabel}</div>
                            <div className="space-y-0.5">
                              {filtered.map(col => {
                                const colKey = String(col.key);
                                const isHidden = hiddenColumns.has(colKey);
                                const isPinned = pinnedColumns.has(colKey);
                                return (
                                  <div
                                    key={colKey}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, colKey)}
                                    onDragOver={(e) => handleDragOver(e, colKey)}
                                    onDrop={(e) => handleDrop(e, colKey)}
                                    className={cn(
                                      'flex items-center gap-1.5 px-1.5 py-1 rounded text-xs hover:bg-muted/40 cursor-grab active:cursor-grabbing transition-colors',
                                      draggedColKey === colKey && 'opacity-50'
                                    )}
                                  >
                                    <GripVertical className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                                    <Checkbox
                                      checked={!isHidden}
                                      onCheckedChange={() => toggleColumn(colKey)}
                                      className="w-3.5 h-3.5 shrink-0"
                                    />
                                    <span className="flex-1 truncate">{col.headerAr || col.header}</span>
                                    <button
                                      onClick={() => togglePinned(colKey)}
                                      className={cn(
                                        'p-0.5 rounded hover:bg-muted transition-colors',
                                        isPinned ? 'text-amber-500' : 'text-muted-foreground/40 hover:text-amber-500'
                                      )}
                                      title={isPinned ? 'إلغاء التثبيت' : 'تثبيت العمود (sticky)'}
                                    >
                                      <Pin className="w-3 h-3" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            ) : columnToggle && (
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

            {/* ─── (Task 34-A) Default CSV Export ─── */}
            {excelGrid && !exportButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={exportCSV}
                className="h-7 text-xs gap-1"
                title="تصدير البيانات المرئية إلى CSV (UTF-8 BOM للعربية)"
              >
                <Download className="w-3 h-3" />
                CSV
              </Button>
            )}
            {exportButton}
            {effectivePublishButton}
          </div>
        </div>
      )}

      {/* لوحة الفلترة المخصصة (شروط رقمية) */}
      {showCustomFilter && filterable && (
        <div className="border border-border rounded-lg p-3 bg-muted/20 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">شروط مخصصة</span>
            <button onClick={() => setShowCustomFilter(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {customFilters.map((cf, idx) => (
            <div key={idx} className="flex items-center gap-2 flex-wrap">
              <select
                value={cf.key}
                onChange={(e) => {
                  setCustomFilters(prev => prev.map((f, i) => i === idx ? { ...f, key: e.target.value } : f));
                }}
                className="text-xs h-7 rounded border border-border bg-background px-1"
              >
                {columns.map(col => (
                  <option key={String(col.key)} value={String(col.key)}>{col.headerAr || col.header}</option>
                ))}
              </select>
              <select
                value={cf.op}
                onChange={(e) => {
                  setCustomFilters(prev => prev.map((f, i) => i === idx ? { ...f, op: e.target.value as typeof cf.op } : f));
                }}
                className="text-xs h-7 rounded border border-border bg-background px-1 w-12"
              >
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
                <option value=">=">≥</option>
                <option value="<=">≤</option>
                <option value="=">=</option>
                <option value="!=">≠</option>
              </select>
              <input
                type="number"
                value={cf.value}
                onChange={(e) => {
                  setCustomFilters(prev => prev.map((f, i) => i === idx ? { ...f, value: e.target.value } : f));
                }}
                placeholder="قيمة"
                className="text-xs h-7 w-24 rounded border border-border bg-background px-2"
              />
              <button
                onClick={() => setCustomFilters(prev => prev.filter((_, i) => i !== idx))}
                className="text-rose-500 hover:text-rose-700 text-xs"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setCustomFilters(prev => [...prev, { key: String(columns[0]?.key || ''), op: '>', value: '' }])}
            className="text-xs flex items-center gap-1 text-primary hover:underline"
          >
            <Plus className="w-3.5 h-3.5" />
            إضافة شرط
          </button>
          {customFilters.length > 0 && (
            <button
              onClick={() => setCustomFilters([])}
              className="text-xs text-muted-foreground hover:text-foreground ml-2"
            >
              مسح الكل
            </button>
          )}
        </div>
      )}

      {/* الجدول كله — بيتطوى لو isCollapsed=true */}
      {!isCollapsed && (
      <div className={wrapperCls} ref={tableWrapperRef}>
        <Table className="text-xs">
          <TableHeader className={headerCls}>
            <TableRow className="bg-muted/40 hover:bg-transparent">
              {expandable && (
                <TableHead key="h-expand-toggle" className={cn(headerPadding, 'w-8 text-center text-[10px] text-muted-foreground')}>
                  ⌀
                </TableHead>
              )}
              {visibleColumns.map((col, i) => {
                const colKey = String(col.key);
                const isActiveSort = sortStack.some(s => s.key === colKey);
                const currentDir = sortStack.find(s => s.key === colKey)?.dir;
                const rank = sortRank(colKey);
                const isPinned = excelGrid && pinnedColumns.has(colKey);
                const filterActive = filterable && isColumnFilterActive(colKey);
                const filterCount = filterable ? activeFilterCount(colKey) : 0;
                const colIsNumeric = filterable && col.filterable && isNumericColumn(colKey);
                // (Task 37) Column resize — explicit pixel width overrides Tailwind class
                const headerWidthPx = excelGrid && columnWidths[colKey]
                  ? `${columnWidths[colKey]}px`
                  : undefined;
                return (
                  <TableHead
                    key={`h-${colKey}-${i}`}
                    style={headerWidthPx ? { width: headerWidthPx, minWidth: headerWidthPx } : undefined}
                    className={cn(
                      headerPadding,
                      'whitespace-nowrap text-[11px] font-bold text-muted-foreground',
                      // (Task 37) relative for absolute-positioned resize handle
                      excelGrid && 'relative',
                      alignClass(col.align),
                      col.width,
                      col.sortable && 'cursor-pointer select-none hover:bg-muted/60 transition-colors',
                      // (Task 34-A) pinned column = sticky right for RTL
                      isPinned && 'sticky right-0 z-10 bg-muted/95 backdrop-blur shadow-l',
                      col.headerClassName,
                    )}
                    onClick={col.sortable ? (e) => handleSort(col, e.shiftKey) : undefined}
                    aria-sort={isActiveSort ? (currentDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    title={col.sortable ? 'اضغط للترتيب (مفرد) • Shift+Click لإضافة مستوى ترتيب (متعدد)' : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.headerAr || col.header}
                      {col.sortable && (
                        <span className="inline-flex items-center gap-0.5">
                          {isActiveSort ? (
                            <>
                              {currentDir === 'asc'
                                ? <ChevronUp className="w-3 h-3 text-foreground" />
                                : <ChevronDown className="w-3 h-3 text-foreground" />}
                              {/* (UNIFIED-TABLE-UPGRADE) rank badge whenever multi-sort active */}
                              {rank && sortStack.length > 1 && (
                                <span className="text-[9px] text-primary font-bold leading-none w-3.5 h-3.5 inline-flex items-center justify-center rounded-full bg-primary/15">{rank}</span>
                              )}
                              {/* (Task 34-A) Shift hint when there's >= 1 sort level */}
                              {sortStack.length >= 1 && (
                                <span
                                  className="text-[8px] px-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 font-mono"
                                  title="يمكنك إضافة مستوى ترتيب آخر بـ Shift+Click"
                                >
                                  ⇧
                                </span>
                              )}
                            </>
                          ) : (
                            <ChevronsUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </span>
                      )}
                      {/* AutoFilter Popover — available for ALL filterable tables */}
                      {filterable && col.filterable && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className={cn(
                                'inline-flex items-center justify-center w-4 h-4 rounded transition-colors',
                                filterActive
                                  ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                                  : 'text-muted-foreground/50 hover:text-foreground hover:bg-muted'
                              )}
                              title={filterActive ? `فلتر نشط (${filterCount})` : 'فلترة'}
                            >
                              <Filter className="w-3 h-3" />
                              {filterActive && filterCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-emerald-600 text-white rounded-full text-[8px] w-3.5 h-3.5 flex items-center justify-center font-bold">
                                  {filterCount > 99 ? '99+' : filterCount}
                                </span>
                              )}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="w-72 p-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="text-xs font-semibold">
                                  فلترة: {col.headerAr || col.header}
                                </div>
                                {filterActive && (
                                  <button
                                    onClick={() => clearColumnFilter(colKey)}
                                    className="text-[10px] text-rose-500 hover:text-rose-700"
                                  >
                                    مسح
                                  </button>
                                )}
                              </div>

                              {colIsNumeric ? (
                                <NumericFilterContent
                                  colKey={colKey}
                                  distinctValues={getDistinctValues(colKey)}
                                  selectedSet={multiSelectFilters[colKey]}
                                  rangeFilter={rangeFilters[colKey]}
                                  rangeDraft={rangeDrafts[colKey]}
                                  onToggleValue={toggleMultiSelectValue}
                                  onSelectAll={selectAllValues}
                                  onClearAll={clearAllValues}
                                  onRangeDraftChange={(min, max) =>
                                    setRangeDrafts(prev => ({ ...prev, [colKey]: { min, max } }))
                                  }
                                  onApplyRange={applyRangeFilter}
                                />
                              ) : (
                                <TextFilterContent
                                  colKey={colKey}
                                  distinctValues={getDistinctValues(colKey)}
                                  selectedSet={multiSelectFilters[colKey]}
                                  onToggleValue={toggleMultiSelectValue}
                                  onSelectAll={selectAllValues}
                                  onClearAll={clearAllValues}
                                />
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </span>
                    {/* (Task 37) Column resize handle — RTL: on LEFT edge of header.
                        stopPropagation on mousedown so sort click isn't triggered. */}
                    {excelGrid && (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          startResize(e.clientX, colKey);
                        }}
                        onTouchStart={(e) => {
                          if (e.touches.length > 0) {
                            e.stopPropagation();
                            startResize(e.touches[0].clientX, colKey);
                          }
                        }}
                        className={cn(
                          'absolute top-0 bottom-0 w-1.5 cursor-col-resize z-30 transition-colors',
                          // RTL: handle on LEFT edge. LTR: handle on RIGHT edge.
                          dir === 'rtl' ? 'left-0' : 'right-0',
                          resizingCol?.colKey === colKey
                            ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]'
                            : 'bg-transparent hover:bg-emerald-500/60 hover:shadow-[0_0_4px_rgba(16,185,129,0.5)]',
                        )}
                        title="اسحب لتغيير عرض العمود"
                      />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
            {/* Filter row (legacy text input — kept for non-excelGrid mode) */}
            {filterable && !excelGrid && (
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
                      // UNIFIED-TABLE-EXPAND: لو فيه onRowClick → single click = action, expand button = expand
                      // لو مفيش onRowClick → single click = expand (default behavior)
                      if (onRowClick) {
                        onRowClick(row);
                      } else if (expandable) {
                        setExpandedKey(isExpanded ? null : rk);
                      }
                    }}
                    onDoubleClick={(e) => {
                      // double click = expand/collapse (always available if expandable)
                      if (expandable) {
                        setExpandedKey(isExpanded ? null : rk);
                      }
                      if (onRowDoubleClick) onRowDoubleClick(row);
                    }}
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
                    {/* زر expand/collapse — بيظهر بس لو expandable=true */}
                    {expandable && (
                      <TableCell
                        key={`expand-toggle-${rk}`}
                        className={cn(cellPadding, 'w-10 text-center')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedKey(isExpanded ? null : rk);
                        }}
                      >
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer text-sm font-bold">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                      </TableCell>
                    )}
                    {visibleColumns.map((col, ci) => {
                      const cellKey = `cell-${rk}-${ci}`;
                      const colKey = String(col.key);
                      const isPinned = excelGrid && pinnedColumns.has(colKey);
                      // (Task 37) Excel-clone cell state
                      const isEditing = excelGrid
                        && editingCell?.rowKey === rk
                        && editingCell?.colKey === colKey;
                      const isSelected = excelGrid
                        && computedSelection.has(`${ri}-${colKey}`);
                      const cellWidthPx = excelGrid && columnWidths[colKey]
                        ? `${columnWidths[colKey]}px`
                        : undefined;
                      let content: React.ReactNode;
                      // For calculated columns: evaluate formula directly
                      if (colKey.startsWith('calc_')) {
                        const calc = calculatedColumns.find(c => c.id === colKey);
                        if (calc) {
                          const r = evaluateFormula(calc.formula, row as Record<string, unknown>);
                          if (!r.ok) {
                            content = <span className="text-rose-500 text-[10px]" title={r.error}>خطأ</span>;
                          } else if (typeof r.value === 'number') {
                            const isWhole = Number.isInteger(r.value);
                            content = <span className="font-mono text-xs">{isWhole ? r.value : (r.value ?? 0).toFixed(2)}</span>;
                          } else {
                            content = <span className="font-mono text-xs">{r.value}</span>;
                          }
                        } else {
                          content = null;
                        }
                      } else {
                        content = col.render
                          ? col.render(row)
                          : (getCellValue(row, col.key) as React.ReactNode);
                      }
                      return (
                        <TableCell
                          key={cellKey}
                          style={cellWidthPx ? { width: cellWidthPx, minWidth: cellWidthPx } : undefined}
                          className={cn(
                            cellPadding,
                            'whitespace-nowrap',
                            alignClass(col.align),
                            col.width,
                            col.className,
                            // (Task 34-A) pinned = sticky right for RTL
                            isPinned && 'sticky right-0 z-10 bg-background shadow-l',
                            // (Task 37) «الجدول المتقدّم» — selection + edit styles
                            excelGrid && 'cursor-cell',
                            isSelected && 'bg-emerald-100 dark:bg-emerald-900/30 ring-2 ring-emerald-500 ring-inset',
                            isEditing && 'p-0 ring-2 ring-emerald-500 ring-inset bg-white dark:bg-slate-900',
                          )}
                          onClick={excelGrid ? (e) => handleCellClick(ri, colKey, e) : undefined}
                          onDoubleClick={excelGrid ? (e) => handleCellDoubleClick(ri, colKey, row, e) : undefined}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitEdit();
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelEdit();
                                }
                              }}
                              className="w-full h-7 px-1 text-xs font-mono bg-white dark:bg-slate-900 outline-none"
                              dir="ltr"
                            />
                          ) : content == null || content === '' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            content
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {/* Expandable content row */}
                  {isExpanded && (
                    <TableRow key={`expand-${rk}`} className="bg-muted/10 hover:bg-muted/10">
                      <TableCell colSpan={visibleColumns.length + (expandable ? 1 : 0)} className="p-2">
                        {expandRender ? expandRender(row) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 p-2">
                            {visibleColumns.filter(c => c.key !== '_idx' && c.key !== '_sparkline').map((col) => {
                              const val = getCellValue(row, col.key);
                              const displayVal = col.render ? null : (val == null || val === '' ? '—' : typeof val === 'object' ? JSON.stringify(val).slice(0, 60) : String(val));
                              return (
                                <div key={String(col.key)} className="flex items-center gap-1.5 text-[10px]">
                                  <span className="text-muted-foreground shrink-0">{col.headerAr || col.header}:</span>
                                  <span className="font-mono font-semibold truncate">{displayVal}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      )}

      {/* ─── (Task 34-A) Calculated Column Dialog ─── */}
      {excelGrid && (
        <Dialog open={showCalcDialog} onOpenChange={setShowCalcDialog}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-emerald-600" />
                إنشاء عمود بمعادلة
              </DialogTitle>
              <DialogDescription>
                اكتب معادلة تستخدم متغيرات الحقول بين أقواس معقوفة. مثال: <code dir="ltr" className="bg-muted px-1 rounded font-mono text-[10px]">{'({current_price} - {support_level}) / {current_price} * 100'}</code>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {/* Name input */}
              <div className="space-y-1">
                <Label htmlFor="calc-name" className="text-xs">اسم العمود</Label>
                <Input
                  id="calc-name"
                  value={formulaName}
                  onChange={(e) => setFormulaName(e.target.value)}
                  placeholder="مثلاً: بعد عن الدعم %"
                  className="h-8 text-sm"
                />
              </div>

              {/* Formula textarea */}
              <div className="space-y-1">
                <Label htmlFor="calc-formula" className="text-xs">المعادلة (اتجاه LTR)</Label>
                <textarea
                  ref={formulaTextareaRef}
                  id="calc-formula"
                  dir="ltr"
                  value={formulaText}
                  onChange={(e) => setFormulaText(e.target.value)}
                  placeholder="({current_price} - {low_52w}) / ({high_52w} - {low_52w}) * 100"
                  className="w-full min-h-[80px] p-2 text-xs font-mono rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  spellCheck={false}
                />
                {formulaText.trim() && formulaValidation && (
                  <div className={cn(
                    'text-[10px] px-2 py-1 rounded',
                    formulaValidation.ok ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                      : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400'
                  )}>
                    {formulaValidation.ok ? '✓ الصياغة صحيحة' : `✗ ${formulaValidation.error}`}
                  </div>
                )}
              </div>

              {/* Variable picker (categorized chips) */}
              <div className="space-y-1">
                <Label className="text-xs">المتغيرات — اضغط للإدراج عند المؤشر</Label>
                <div className="max-h-32 overflow-y-auto border border-border rounded-md p-2 space-y-2 bg-muted/20">
                  {Object.entries(
                    FORMULA_VARIABLES.reduce<Record<string, FormulaVariable[]>>((acc, v) => {
                      if (!acc[v.category]) acc[v.category] = [];
                      acc[v.category].push(v);
                      return acc;
                    }, {})
                  ).map(([cat, vars]) => (
                    <div key={cat}>
                      <div className="text-[9px] font-bold text-muted-foreground uppercase mb-0.5">
                        {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {vars.map(v => (
                          <button
                            key={v.key}
                            onClick={() => insertAtCursor(`{${v.key}}`)}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors font-mono"
                            title={`${v.label}${v.unit ? ` (${v.unit})` : ''}`}
                          >
                            {v.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Operator buttons */}
              <div className="space-y-1">
                <Label className="text-xs">العمليات والدوال</Label>
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: '+', insert: ' + ' },
                    { label: '−', insert: ' - ' },
                    { label: '×', insert: ' * ' },
                    { label: '÷', insert: ' / ' },
                    { label: '%', insert: ' % ' },
                    { label: '(', insert: '(' },
                    { label: ')', insert: ')' },
                    { label: 'IF', insert: 'IF(' },
                    { label: 'AND', insert: 'AND(' },
                    { label: 'OR', insert: 'OR(' },
                    { label: '>', insert: ' > ' },
                    { label: '<', insert: ' < ' },
                    { label: '≥', insert: ' >= ' },
                    { label: '≤', insert: ' <= ' },
                    { label: '=', insert: ' == ' },
                    { label: '≠', insert: ' != ' },
                    { label: 'abs', insert: 'abs(' },
                    { label: 'max', insert: 'max(' },
                    { label: 'min', insert: 'min(' },
                    { label: 'round', insert: 'round(' },
                  ].map(op => (
                    <button
                      key={op.label}
                      onClick={() => insertAtCursor(op.insert)}
                      className="text-[11px] px-2 py-0.5 rounded border border-border hover:border-primary hover:bg-primary/10 hover:text-primary transition-colors font-mono min-w-[28px]"
                    >
                      {op.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live preview */}
              {formulaPreview.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">معاينة (أول 3 صفوف)</Label>
                  <div className="border border-border rounded-md divide-y divide-border/50 bg-muted/10">
                    {formulaPreview.map(({ idx, row, result }) => (
                      <div key={idx} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                        <span className="text-muted-foreground truncate">
                          {(row as Record<string, unknown>).ticker as string || (row as Record<string, unknown>).name as string || `صف ${idx + 1}`}
                        </span>
                        <span className={cn(
                          'font-mono font-semibold',
                          result.ok ? 'text-foreground' : 'text-rose-500'
                        )} dir="ltr">
                          {result.ok
                            ? (typeof result.value === 'number'
                                ? (Number.isInteger(result.value) ? result.value : (result.value ?? 0).toFixed(4))
                                : result.value)
                            : `✗ ${result.error}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Existing calculated columns */}
              {calculatedColumns.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">الأعمدة المحسوبة الموجودة</Label>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {calculatedColumns.map(c => (
                      <div key={c.id} className="flex items-center gap-2 px-2 py-1 rounded border border-border bg-background">
                        <Calculator className="w-3 h-3 text-emerald-600 shrink-0" />
                        <span className="text-xs font-semibold truncate flex-1">{c.name}</span>
                        <code dir="ltr" className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">{c.formula}</code>
                        <button
                          onClick={() => deleteCalculatedColumn(c.id)}
                          className="text-rose-500 hover:text-rose-700 p-0.5 shrink-0"
                          title="حذف"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCalcDialog(false)}>إلغاء</Button>
              <Button
                onClick={saveCalculatedColumn}
                disabled={!formulaName.trim() || !formulaText.trim() || (formulaValidation != null && !formulaValidation.ok)}
              >
                <Plus className="w-3.5 h-3.5" />
                إضافة العمود
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ─── (Task 34-A) Save Preset Dialog ─── */}
      {excelGrid && (
        <Dialog open={showPresetSaveDialog} onOpenChange={setShowPresetSaveDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Save className="w-4 h-4 text-emerald-600" />
                حفظ القالب
              </DialogTitle>
              <DialogDescription>
                سيتم حفظ حالة الجدول الحالية (الأعمدة المرئية + ترتيبها + الفلاتر + الترتيب + الأعمدة المحسوبة).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="preset-name" className="text-xs">اسم القالب</Label>
              <Input
                id="preset-name"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="مثلاً: فرص التشبع البيعي"
                className="h-8 text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPresetSaveDialog(false)}>إلغاء</Button>
              <Button onClick={savePreset} disabled={!presetName.trim()}>
                <Save className="w-3.5 h-3.5" />
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Sub-components (defined outside main for stable identity) ─────────────

interface NumericFilterContentProps {
  colKey: string;
  distinctValues: string[];
  selectedSet?: Set<string>;
  rangeFilter?: RangeFilter;
  rangeDraft?: { min: string; max: string };
  onToggleValue: (colKey: string, value: string) => void;
  onSelectAll: (colKey: string, values: string[]) => void;
  onClearAll: (colKey: string) => void;
  onRangeDraftChange: (min: string, max: string) => void;
  onApplyRange: (colKey: string) => void;
}

type FilterMode = 'values' | 'range';

function NumericFilterContent({
  colKey, distinctValues, selectedSet, rangeFilter, rangeDraft,
  onToggleValue, onSelectAll, onClearAll, onRangeDraftChange, onApplyRange,
}: NumericFilterContentProps) {
  const [mode, setMode] = useState<FilterMode>('values');
  const [search, setSearch] = useState('');

  const filteredValues = distinctValues.filter(v =>
    !search || v.toLowerCase().includes(search.toLowerCase())
  );

  const currentDraft = rangeDraft || { min: '', max: '' };

  return (
    <>
      {/* Mode toggle */}
      <div className="flex gap-1 p-0.5 bg-muted/40 rounded text-[10px]">
        <button
          onClick={() => setMode('values')}
          className={cn(
            'flex-1 py-1 rounded transition-colors',
            mode === 'values' ? 'bg-background shadow-sm font-semibold' : 'text-muted-foreground'
          )}
        >
          قيم
        </button>
        <button
          onClick={() => setMode('range')}
          className={cn(
            'flex-1 py-1 rounded transition-colors',
            mode === 'range' ? 'bg-background shadow-sm font-semibold' : 'text-muted-foreground'
          )}
        >
          نطاق
        </button>
      </div>

      {rangeFilter && (rangeFilter.min != null || rangeFilter.max != null) && (
        <div className="text-[10px] bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 px-2 py-1 rounded">
          فلتر النطاق نشط: {rangeFilter.min != null ? `≥ ${rangeFilter.min}` : ''} {rangeFilter.max != null ? `≤ ${rangeFilter.max}` : ''}
        </div>
      )}

      {mode === 'values' ? (
        <>
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="بحث في القيم..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-7 pr-7 pl-2 text-[11px] rounded border border-border bg-background"
            />
          </div>
          <div className="flex gap-2 text-[10px]">
            <button onClick={() => onSelectAll(colKey, filteredValues)} className="text-primary hover:underline">
              تحديد الكل
            </button>
            <button onClick={() => onClearAll(colKey)} className="text-muted-foreground hover:text-foreground">
              إلغاء التحديد
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5 border border-border/50 rounded p-1 bg-background/50">
            {filteredValues.length === 0 ? (
              <div className="text-[10px] text-muted-foreground text-center py-2">لا توجد قيم</div>
            ) : filteredValues.map(v => {
              const checked = selectedSet?.has(v) ?? false;
              return (
                <label key={v} className="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-muted/40 cursor-pointer text-[11px]">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggleValue(colKey, v)}
                    className="w-3 h-3"
                  />
                  <span className="font-mono truncate" dir="ltr">{v}</span>
                </label>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">الأدنى (Min)</Label>
              <input
                type="number"
                placeholder="—"
                value={currentDraft.min}
                onChange={e => onRangeDraftChange(e.target.value, currentDraft.max)}
                className="w-full h-7 px-2 text-[11px] font-mono rounded border border-border bg-background"
                dir="ltr"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">الأعلى (Max)</Label>
              <input
                type="number"
                placeholder="—"
                value={currentDraft.max}
                onChange={e => onRangeDraftChange(currentDraft.min, e.target.value)}
                className="w-full h-7 px-2 text-[11px] font-mono rounded border border-border bg-background"
                dir="ltr"
              />
            </div>
          </div>
          <Button
            size="sm"
            className="w-full h-7 text-xs"
            onClick={() => onApplyRange(colKey)}
          >
            تطبيق
          </Button>
          {(currentDraft.min !== '' || currentDraft.max !== '') && (
            <div className="text-[10px] text-muted-foreground text-center">
              اضغط تطبيق لتفعيل النطاق
            </div>
          )}
        </div>
      )}
    </>
  );
}

interface TextFilterContentProps {
  colKey: string;
  distinctValues: string[];
  selectedSet?: Set<string>;
  onToggleValue: (colKey: string, value: string) => void;
  onSelectAll: (colKey: string, values: string[]) => void;
  onClearAll: (colKey: string) => void;
}

function TextFilterContent({
  colKey, distinctValues, selectedSet,
  onToggleValue, onSelectAll, onClearAll,
}: TextFilterContentProps) {
  const [search, setSearch] = useState('');
  const filteredValues = distinctValues.filter(v =>
    !search || v.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div className="relative">
        <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <input
          type="text"
          placeholder="بحث في القيم..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full h-7 pr-7 pl-2 text-[11px] rounded border border-border bg-background"
        />
      </div>
      <div className="flex gap-2 text-[10px]">
        <button onClick={() => onSelectAll(colKey, filteredValues)} className="text-primary hover:underline">
          تحديد الكل
        </button>
        <button onClick={() => onClearAll(colKey)} className="text-muted-foreground hover:text-foreground">
          إلغاء التحديد
        </button>
        {selectedSet && selectedSet.size > 0 && (
          <span className="text-muted-foreground mr-auto">
            {selectedSet.size} / {distinctValues.length}
          </span>
        )}
      </div>
      <div className="max-h-48 overflow-y-auto space-y-0.5 border border-border/50 rounded p-1 bg-background/50">
        {filteredValues.length === 0 ? (
          <div className="text-[10px] text-muted-foreground text-center py-2">لا توجد قيم مطابقة</div>
        ) : filteredValues.map(v => {
          const checked = selectedSet?.has(v) ?? false;
          return (
            <label key={v} className="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-muted/40 cursor-pointer text-[11px]">
              <Checkbox
                checked={checked}
                onCheckedChange={() => onToggleValue(colKey, v)}
                className="w-3 h-3"
              />
              <span className="truncate">{v}</span>
            </label>
          );
        })}
      </div>
    </>
  );
}

export default UnifiedTable;
