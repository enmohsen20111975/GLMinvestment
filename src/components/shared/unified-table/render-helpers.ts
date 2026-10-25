// render helpers + cell formatters — extracted (Phase 3)

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
 } catch { /* ignore parse errors */ }
 try {
 const rawPresets = typeof window !== 'undefined' ? window.localStorage.getItem(presetsStorageKey) : null;
 if (rawPresets) {
 const parsed = JSON.parse(rawPresets);
 if (Array.isArray(parsed)) setPresets(parsed);
 }
 } catch { /* ignore parse errors */ }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [excelGrid]);

 // ─── Persist calculated columns ───
 useEffect(() => {
 if (!excelGrid) return;
 try {
 window.localStorage.setItem(calcStorageKey, JSON.stringify(calculatedColumns));
 } catch { /* ignore quota errors */ }
 }, [excelGrid, calculatedColumns, calcStorageKey]);

 // ─── Persist presets ───
 const persistPresets = useCallback((next: TablePreset[]) => {
 setPresets(next);
 try {
 window.localStorage.setItem(presetsStorageKey, JSON.stringify(next));
 } catch { /* ignore */ }
 }, [presetsStorageKey]);

 // ─── (Task 37) Load column widths from localStorage on mount ───
 useEffect(() => {
 try {
 const raw = typeof window !== 'undefined' ? window.localStorage.getItem(widthsStorageKey) : null;
 if (raw) {
 const parsed = JSON.parse(raw);
 if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
 setColumnWidths(parsed as Record<string, number>);
 }
 }
 } catch { /* ignore parse errors */ }
 }, [widthsStorageKey]);

 // ─── (Task 37) Persist column widths to localStorage on change ───
 useEffect(() => {
 if (Object.keys(columnWidths).length === 0) return;
 try {
 window.localStorage.setItem(widthsStorageKey, JSON.stringify(columnWidths));
 } catch { /* ignore quota errors */ }
 }, [columnWidths, widthsStorageKey]);

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
 // (UNIFIED-TABLE-SORT) default sortable=true — كل عمود قابل للترتيب ما لم يُعطَ false صراحةً.
 if (col.sortable === false) return;
 const colKey = String(col.key);
 setSortStack(prev => {
 const existing = prev.find(s => s.key === colKey);
 if (!isShift) {
 // SINGLE SORT (normal click) — استبدل الـ stack بمستوى واحد:
 // asc → desc → clear (رجوع للوضع الافتراضي).
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
 let av = col?.sortValue ? col.sortValue(a) : getCellValue(a, key);
 let bv = col?.sortValue ? col.sortValue(b) : getCellValue(b, key);

 // Fallback: If av or bv is null/undefined and col.render is available
 if (av == null && col?.render) {
 try {
 const textA = extractTextFromNode(col.render(a));
 if (textA !== '') av = textA;
 } catch { /* ignore */ }
 }
 if (bv == null && col?.render) {
 try {
 const textB = extractTextFromNode(col.render(b));
 if (textB !== '') bv = textB;
 } catch { /* ignore */ }
 }

 // Visual fallback (e.g. sparkline / chart with no text)
 if (av == null && (key === 'sparkline' || key.includes('chart') || key.includes('spark'))) {
 av = (a as Record<string, unknown>).change_percent ?? (a as Record<string, unknown>).change_pct ?? (a as Record<string, unknown>).current_price ?? 0;
 }
 if (bv == null && (key === 'sparkline' || key.includes('chart') || key.includes('spark'))) {
 bv = (b as Record<string, unknown>).change_percent ?? (b as Record<string, unknown>).change_pct ?? (b as Record<string, unknown>).current_price ?? 0;
 }

 // Task 35-F fix: nulls ALWAYS go to bottom, regardless of asc/desc.
 const aNull = av == null;
 const bNull = bv == null;
 if (aNull && bNull) continue; // both null → skip to next sort key
 if (aNull) return 1; // a is null → always bottom
 if (bNull) return -1; // b is null → always bottom
 // Both non-null → compare normally + apply direction
 const cmp = compareValues(av, bv);
 if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
 }
 return 0;
 });
 return arr;
 }, [data, mutableData, excelGrid, sortStack, columns]);

 // ─── (Task 34-A) AutoFilter helpers ───────────────────────────────────
 // (UNIFIED-TABLE-UPGRADE) Universal value extraction — respects `col.filterValue`
 // لو الـ render بيرجّع JSX، نستخدم filterValue أو extractTextFromNode عشان الفلتر يشتغل
 // على القيمة المعروضة فعلاً (مش القيمة الخام في row). كده أي عمود يشتغل.
 const getCellFilterValue = useCallback((row: T, colKey: string): unknown => {
 const col = columns.find(c => String(c.key) === colKey);
 if (col?.filterValue) {
 try { return col.filterValue(row); } catch { /* fallthrough */ }
 }
 if (col?.render) {
 try {
 const text = extractTextFromNode(col.render(row));
 if (text && text.trim() !== '') return text.trim();
 } catch { /* fallthrough */ }
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
