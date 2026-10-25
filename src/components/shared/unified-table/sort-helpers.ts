// sort + filter helpers — extracted (Phase 3)

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
 // ref للـ <table> element (للـ auto-size + DOM queries)
 const tableRef = useRef<HTMLTableElement>(null);
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
 const columnsSignature = useMemo(() => {
   return columns.map(c => String(c.key)).slice(0, 6).join('-');
 }, [columns]);
 const effectiveStorageKey = storageKey || (typeof title === 'string' && title.trim() ? title.trim() : `table-${columnsSignature}`);
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
 const [editingCalcId, setEditingCalcId] = useState<string | null>(null);
 // Column picker search + drag state
 const [columnPickerSearch, setColumnPickerSearch] = useState('');
 const [draggedColKey, setDraggedColKey] = useState<string | null>(null);
 // Preset save dialog
 const [presetName, setPresetName] = useState('');
 // (UNIFIED-TABLE-UPGRADE) Multi-sort Popover drag state — index of the
 // sort level being dragged for reorder (null = no drag in progress).
 const [sortDragIdx, setSortDragIdx] = useState<number | null>(null);
 // (EXCEL-MULTI-SORT) New sort level draft in multi-sort Popover
 const [newSortColKey, setNewSortColKey] = useState<string>('');
 const [newSortDir, setNewSortDir] = useState<'asc' | 'desc'>('desc');

 // ─── (Task 37) «الجدول المتقدّم» — Excel-clone cell-level state ───
 // Rule 67 root cause: AG Grid theme mismatch + npm install failure on VPS →
 // we trash AG Grid + add the 3 missing features (resize + edit + copy/paste)
 // to our own UnifiedTable. No external dependency.
 const widthsStorageKey = `unified-table-widths-${effectiveStorageKey}`;
 // Column resize by drag — persisted to localStorage per storageKey
 const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
