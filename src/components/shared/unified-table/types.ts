// UnifiedTable types — extracted (Phase 3)

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
 /** هل العمود قابل للترتيب؟ (default: true — كل عمود sortable ما لم يُعطَ false صراحةً) */
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
 * مفيد للجداول الكتيرة الأعمدة عشان نعرض بس الأهم افتراضياً. */
 hidden?: boolean;
 /** دالة فلترة مخصصة */
 filterRender?: (column: Column<T>, value: string, onChange: (v: string) => void) => React.ReactNode;
 /** (Task 34-A) تصنيف العمود — للـ column picker الجديد */
 category?: ColumnCategory;
 /** (Task 37) هل الخلية قابلة للتحرير المباشر (double-click to edit)?
 * Local state only — لا بتتحفظ لقاعدة البيانات إلا لو الـ consumer
 * مرّر `onCellEdit` callback. الـ edits بتعيش في localEdits overlay. */
 editable?: boolean;
 /** (Task IMPROVEMENT-20-2026-10-07) دالة استخراج قيمة الفرز/الفلترة.
 * لو الـ render بترجع JSX (مش رقم/نص) → استخدم دي عشان تحدد القيمة اللي يتفرز عليها.
 * مثال: sortValue: (row) => row.buy_pct ?? 0 */
 sortValue?: (row: T) => number | string | null;
 /** (Task IMPROVEMENT-20) دالة استخراج قيمة الفلترة النصية.
 * لو الـ render بترجع JSX → استخدم دي عشان تحدد القيمة اللي تتفلتر عليها. */
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
 * أي جدول يقدر يطوي/يفرد الصفوف افتراضياً. لو مش عايز expand، مرّر expandable={false}.
 * لو مرّرت expandRender → بيظهر المحتوى المخصص. لو لأ → بيظهر default expand (row data). */
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
 * يطبّق مرة واحدة عند الـ mount. بيكون بمثابة الـ "default sort"
 * قبل ما المستخدم يضغط على أي عمود. */
 initialSort?: { key: string; dir: 'asc' | 'desc' };
 /** ─── (Task 34-A) Excel-style Power Engine ───
 * تفعيل كل ميزات الـ Excel-like grid (default: false).
 * - AutoFilter popover (multi-select + range)
 * - Column Picker popover (search + categories + drag-drop + pin)
 * - Calculated columns (formula engine)
 * - Saved presets (localStorage)
 * - Default CSV export
 * لو false → السلوك مطابق للنسخة السابقة (backward compatible). */
 excelGrid?: boolean;
 /** (Task 34-A) مفتاح فريد لتخزين الـ calculated columns + presets في localStorage.
 * مفيد لو فيه أكتر من UnifiedTable بنفس excelGrid=true في نفس الصفحة.
 * default: title || 'default'. */
 storageKey?: string;
 /** (Task 37) «الجدول المتقدّم» — callback اختياري يتنفّذ لما المستخدم
 * يحرّر خلية في عمود editable (double-click → Enter/blur). الـ consumer
 * يقدر يعمل persist للقيمة لقاعدة البيانات لو محتاج. الـ edit نفسه
 * بيتعمل محلياً في localEdits overlay (مش بيعدّل الـ data prop الأصلي). */
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

