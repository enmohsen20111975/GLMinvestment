// table column definitions — extracted (Phase 3)

 );
 }
 if (a === 'HOLD') {
 return (
 <Badge className="bg-warning/10 text-warning dark:text-warning border border-warning/20 hover:bg-warning border-warning">
 <Clock className="w-3 h-3 ml-1" />
 انتظار
 </Badge>
 );
 }
 return (
 <Badge className="bg-profit/10 text-profit border border-profit/20 hover:bg-profit border-profit">
 <TrendingUp className="w-3 h-3 ml-1" />
 شراء
 </Badge>
 );
}

function statusBadge(status: string) {
 const s = (status || 'PENDING').toUpperCase();
 if (s === 'TARGET_HIT') {
 return (
 <Badge className="bg-profit/10 text-profit border border-profit/20 hover:bg-profit border-profit">
 <CheckCircle2 className="w-3 h-3 ml-1" />
 ضرب الهدف
 </Badge>
 );
 }
 if (s === 'STOPPED') {
 return (
 <Badge className="bg-loss/10 text-loss border border-loss/20 hover:bg-loss border-loss">
 <AlertTriangle className="w-3 h-3 ml-1" />
 ضرب الوقف
 </Badge>
 );
 }
 if (s === 'EXPIRED' || s === 'CLOSED') {
 return (
 <Badge className="bg-zinc-200 text-zinc-700 hover:bg-zinc-200 border-zinc-300">
 <Clock className="w-3 h-3 ml-1" />
 منتهية
 </Badge>
 );
 }
 return (
 <Badge className="bg-warning/10 text-warning dark:text-warning border border-warning/20 hover:bg-warning border-warning">
 <Clock className="w-3 h-3 ml-1" />
 قيد التنفيذ
 </Badge>
 );
}

function emptyRow(): TableRec {
 return {
 stock_symbol: '',
 stock_name_ar: '',
 entry_price: '',
 target_price: '',
 target_price_2: '',
 stop_loss: '',
 support_level: '',
 resistance_level: '',
 action: 'BUY',
 recommendation_reason: '',
 };
}

/** خريطة لتطبيق الوضع الافتراضي للسوق على اسم المصدر */
function defaultSourceForMarket(market: MarketType): string {
 switch (market) {
 case 'EGX':
 return 'مباشر للأوراق المالية';
 case 'TADAWUL':
 return 'تداول السعودية';
 case 'KSE':
 return 'بورصة الكويت';
 case 'QSE':
 return 'بورصة قطر';
 default:
 return 'مباشر للأوراق المالية';
 }
}

// ============================================================================
// Component
// ============================================================================

export function ExpertRecommendationsPanel({ market }: { market: MarketType }) {
 const [mode, setMode] = useState<'table' | 'text'>('table');

 // Common inputs
 const [sessionDate, setSessionDate] = useState<string>(todayISO());
 const [sessionType, setSessionType] = useState<string>('صباحية');
 const [expertName, setExpertName] = useState<string>('');
 const [expertSource, setExpertSource] = useState<string>(defaultSourceForMarket(market));

 // Table mode state
 const [rows, setRows] = useState<TableRec[]>([emptyRow(), emptyRow()]);
 const [importingTable, setImportingTable] = useState(false);

 // Text mode state
 const [rawText, setRawText] = useState<string>('');
 const [parsedRecs, setParsedRecs] = useState<ParsedTextRec[] | null>(null);
 const [parsing, setParsing] = useState(false);
 const [confirming, setConfirming] = useState(false);

 // Stored recommendations
 const [stored, setStored] = useState<StoredRec[]>([]);
 const [storedLoading, setStoredLoading] = useState(false);
 const [statusFilter, setStatusFilter] = useState<string>('all');
 const [searchSymbol, setSearchSymbol] = useState<string>('');
 const [selectedRec, setSelectedRec] = useState<StoredRec | null>(null);
 const [sheetOpen, setSheetOpen] = useState(false);

 // Reset defaults when market changes
 useEffect(() => {
 setExpertSource(defaultSourceForMarket(market));
 }, [market]);

 // ========================================================================
 // Table mode handlers
 // ========================================================================

 const updateRow = (idx: number, field: keyof TableRec, value: string) => {
 setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
 };

 const addRow = () => setRows((prev) => [...prev, emptyRow()]);

 const removeRow = (idx: number) => {
 setRows((prev) => prev.filter((_, i) => i !== idx));
 };

 const buildImportFromTable = (): ImportRec[] => {
 const out: ImportRec[] = [];
 for (const r of rows) {
 const sym = r.stock_symbol.trim().toUpperCase();
 if (!sym) continue;
 const entry = parseNum(r.entry_price);
 if (entry == null || entry <= 0) continue;
 out.push({
 stock_symbol: sym,
 stock_name_ar: r.stock_name_ar.trim() || undefined,
 entry_price: entry,
 target_price: parseNum(r.target_price),
 target_price_2: parseNum(r.target_price_2),
 stop_loss: parseNum(r.stop_loss),
 support_level: parseNum(r.support_level),
 resistance_level: parseNum(r.resistance_level),
 action: r.action || 'BUY',
 recommendation_reason: r.recommendation_reason.trim() || undefined,
 });
 }
 return out;
 };

 const handleTableImport = async () => {
 if (!expertName.trim()) {
 toast.error('اكتب اسم الخبير أولًا');
 return;
 }
 if (!sessionDate) {
 toast.error('اختر تاريخ الجلسة');
 return;
 }
 const recs = buildImportFromTable();
 if (recs.length === 0) {
 toast.error('لا توجد صفوف صالحة للاستيراد — تأكد من إدخال رمز السهم وسعر الدخول');
 return;
 }
 setImportingTable(true);
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
 const errs: string[] = data.errors || [];
 toast.success(`تم استيراد ${imported} توقع بنجاح`);
 if (errs.length > 0) {
 toast.warning(`${errs.length} صف تم تخطيه`);
 }
 // Clear table
 setRows([emptyRow(), emptyRow()]);
 // Refresh stored
 fetchStored();
 } catch (e) {
 toast.error('خطأ في الاستيراد: ' + String(e));
 } finally {
