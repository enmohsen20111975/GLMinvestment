// render + badge helpers — extracted (Phase 3)

 setImportingTable(false);
 }
 };

 // ========================================================================
 // Text mode handlers
 // ========================================================================

 const handleParse = async () => {
 if (!rawText.trim()) {
 toast.error('الصق النص أولًا');
 return;
 }
 setParsing(true);
 setParsedRecs(null);
 try {
 const res = await fetch('/api/parse-recommendations', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ text: rawText, format: 'json' }),
 });
 const data = await res.json();
 if (!res.ok || !data.success) {
 throw new Error(data.error || 'فشل التحليل');
 }
 const recs: ParsedTextRec[] = data.recommendations || [];
 setParsedRecs(recs);
 if (recs.length === 0) {
 toast.info('لم يتم العثور على توقعات في النص — تأكد من التنسيق');
 } else {
 toast.success(`تم تحليل ${recs.length} توقع من النص`);
 }
 } catch (e) {
 toast.error('خطأ في التحليل: ' + String(e));
 } finally {
 setParsing(false);
 }
 };

 const buildImportFromParsed = (): ImportRec[] => {
 if (!parsedRecs) return [];
 const out: ImportRec[] = [];
 for (const p of parsedRecs) {
 const sym = (p.code || '').trim().toUpperCase();
 if (!sym) continue;
 // entry_price: من buyPrice أو الدعم كاحتياط
 let entry = parseNum(p.buyPrice);
 if (entry == null) entry = parseNum(p.support);
 if (entry == null || entry <= 0) continue;

 const range = parseRange(p.buyPrice);
 out.push({
 stock_symbol: sym,
 stock_name_ar: p.stock?.trim() || undefined,
 entry_price: entry,
 entry_price_from: range.from,
 entry_price_to: range.to,
 target_price: parseNum(p.target1),
 target_price_2: parseNum(p.target2),
 stop_loss: parseNum(p.stopLoss),
 support_level: parseNum(p.support),
 resistance_level: parseNum(p.resistance),
 action: 'BUY',
 recommendation_reason:
 [p.type, p.notes].filter(Boolean).join(' — ') || undefined,
 expected_duration: p.expectedReturn || undefined,
 });
 }
 return out;
 };

 const handleConfirmImport = async () => {
 if (!expertName.trim()) {
 toast.error('اكتب اسم الخبير أولًا');
 return;
 }
 if (!sessionDate) {
 toast.error('اختر تاريخ الجلسة');
 return;
 }
 const recs = buildImportFromParsed();
 if (recs.length === 0) {
 toast.error('لا توجد توقعات قابلة للاستيراد بعد التحليل');
 return;
 }
 setConfirming(true);
 try {
 const res = await fetch('/api/expert-recommendations/import', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 session_date: sessionDate,
 session_type: sessionType,
 expert_name: expertName.trim(),
 expert_source: expertSource.trim() || 'manual',
 recommendations: recs,
 }),
 });
 const data = await res.json();
 if (!res.ok || !data.success) {
 throw new Error(data.error || 'فشل الاستيراد');
 }
 const imported = data.imported ?? recs.length;
 toast.success(`تم استيراد ${imported} توقع من النص المحلَّل`);
 // Reset text mode
 setRawText('');
 setParsedRecs(null);
 // Refresh stored
 fetchStored();
 } catch (e) {
 toast.error('خطأ في الاستيراد: ' + String(e));
 } finally {
 setConfirming(false);
 }
 };

 // ========================================================================
 // Stored recommendations
 // ========================================================================

 const fetchStored = useCallback(async () => {
 setStoredLoading(true);
 try {
 const params = new URLSearchParams({ limit: '50' });
 if (statusFilter !== 'all') {
 if (statusFilter === 'PENDING') {
 params.set('status', 'PENDING');
 } else if (statusFilter === 'closed') {
 // closed = not pending; we'll filter client-side below because API only filters exact status
 }
 }
 const res = await fetch(`/api/expert-recommendations?${params.toString()}`, {
 cache: 'no-store',
 });
 const data = await res.json();
 const list: StoredRec[] = data.recommendations || data.data || [];
 setStored(list);
 } catch (e) {
 console.error('fetchStored error', e);
 setStored([]);
 } finally {
 setStoredLoading(false);
 }
 }, [statusFilter]);

 useEffect(() => {
 fetchStored();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 const filteredStored = useMemo(() => {
 let list = stored;
 if (statusFilter === 'PENDING') {
 list = list.filter((r) => (r.status || 'PENDING').toUpperCase() === 'PENDING');
 } else if (statusFilter === 'closed') {
 list = list.filter(
 (r) => (r.status || 'PENDING').toUpperCase() !== 'PENDING',
 );
 }
 const q = searchSymbol.trim().toUpperCase();
 if (q) {
 list = list.filter(
 (r) =>
 r.stock_symbol?.toUpperCase().includes(q) ||
 r.stock_name_ar?.includes(searchSymbol.trim()),
 );
 }
 return list;
 }, [stored, statusFilter, searchSymbol]);

 const openDetails = (rec: StoredRec) => {
 setSelectedRec(rec);
 setSheetOpen(true);
 };

 // ========================================================================
 // UnifiedTable — editable grid columns + data with _idx
 // ========================================================================

 const rowsWithIdx: TableRecWithIdx[] = rows.map((r, i) => ({ ...r, _idx: i }));

 const tableEditorColumns: Column<TableRecWithIdx>[] = [
 {
 key: '_idx',
 header: '#',
 align: 'right',
 className: 'text-xs text-muted-foreground',
 render: (r) => r._idx + 1,
 },
 {
 key: 'stock_symbol',
 header: 'الرمز',
 render: (r) => (
 <Input
 value={r.stock_symbol}
 onChange={(e) => updateRow(r._idx, 'stock_symbol', e.target.value)}
 placeholder="COMI"
 className="h-9 w-24 font-mono"
 />
 ),
 },
 {
 key: 'stock_name_ar',
 header: 'الاسم (عربي)',
 render: (r) => (
 <Input
 value={r.stock_name_ar}
 onChange={(e) => updateRow(r._idx, 'stock_name_ar', e.target.value)}
 placeholder="التعمير"
 className="h-9 w-32"
 />
 ),
 },
 {
 key: 'entry_price',
 header: 'سعر الدخول',
 align: 'right',
 render: (r) => (
 <Input
 type="number"
 inputMode="decimal"
 value={r.entry_price}
 onChange={(e) => updateRow(r._idx, 'entry_price', e.target.value)}
 placeholder="1.91"
 className="h-9 w-20"
 />
 ),
 },
 {
 key: 'target_price',
 header: 'الهدف ١',
 align: 'right',
 render: (r) => (
 <Input
 type="number"
 inputMode="decimal"
 value={r.target_price}
 onChange={(e) => updateRow(r._idx, 'target_price', e.target.value)}
 placeholder="2.20"
 className="h-9 w-20"
 />
 ),
 },
 {
 key: 'target_price_2',
 header: 'الهدف ٢',
 align: 'right',
 render: (r) => (
 <Input
 type="number"
 inputMode="decimal"
 value={r.target_price_2}
 onChange={(e) => updateRow(r._idx, 'target_price_2', e.target.value)}
 placeholder="2.50"
 className="h-9 w-20"
 />
 ),
 },
 {
 key: 'stop_loss',
 header: 'وقف الخسارة',
 align: 'right',
 render: (r) => (
 <Input
 type="number"
 inputMode="decimal"
 value={r.stop_loss}
 onChange={(e) => updateRow(r._idx, 'stop_loss', e.target.value)}
 placeholder="1.75"
 className="h-9 w-20"
 />
 ),
 },
 {
 key: 'support_level',
 header: 'الدعم',
 align: 'right',
 render: (r) => (
 <Input
 type="number"
 inputMode="decimal"
 value={r.support_level}
 onChange={(e) => updateRow(r._idx, 'support_level', e.target.value)}
 placeholder="1.80"
 className="h-9 w-20"
 />
 ),
 },
 {
 key: 'resistance_level',
 header: 'المقاومة',
 align: 'right',
 render: (r) => (
 <Input
 type="number"
 inputMode="decimal"
 value={r.resistance_level}
 onChange={(e) => updateRow(r._idx, 'resistance_level', e.target.value)}
 placeholder="2.00"
 className="h-9 w-20"
