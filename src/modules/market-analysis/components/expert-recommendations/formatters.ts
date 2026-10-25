// formatters + badge helpers — extracted (Phase 3)

 {
 key: 'support',
 header: 'الدعم',
 align: 'right',
 className: 'text-xs',
 render: (p) => p.support || '—',
 },
 {
 key: 'resistance',
 header: 'المقاومة',
 align: 'right',
 className: 'text-xs',
 render: (p) => p.resistance || '—',
 },
 {
 key: 'type',
 header: 'النوع',
 align: 'right',
 className: 'text-xs',
 filterable: true,
 render: (p) => p.type || '—',
 },
 {
 key: 'notes',
 header: 'ملاحظات',
 align: 'right',
 className: 'text-xs max-w-[200px] truncate',
 render: (p) => (
 <span className="block max-w-[200px] truncate" title={p.notes}>
 {p.notes || '—'}
 </span>
 ),
 },
];

const storedRecColumns: Column<StoredRec>[] = [
 {
 key: 'session_date',
 header: 'التاريخ',
 align: 'right',
 sortable: true,
 className: 'text-xs whitespace-nowrap text-muted-foreground',
 render: (r) => r.session_date || r.created_at?.slice(0, 10) || '—',
 },
 {
 key: 'expert_name',
 header: 'الخبير',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'text-xs whitespace-nowrap',
 render: (r) => r.expert_name || '—',
 },
 {
 key: 'stock_symbol',
 header: 'السهم',
 align: 'right',
 sortable: true,
 filterable: true,
 render: (r) => (
 <div className="flex items-center gap-1">
 <div className="flex flex-col">
 <span className="font-mono font-bold text-profit">
 {r.stock_symbol}
 </span>
 {r.stock_name_ar && (
 <span className="text-xs text-muted-foreground">
 {r.stock_name_ar}
 </span>
 )}
 </div>
 {r.stock_symbol && (
 <StockPublisher
 data={{
 ticker: r.stock_symbol,
 nameAr: r.stock_name_ar || undefined,
 currentPrice: Number(r.entry_price ?? 0) || 0,
 entryPrice: Number(r.entry_price ?? 0) || undefined,
 targetPrice1: Number(r.target_price ?? 0) || undefined,
 targetPrice2: Number(r.target_price_2 ?? 0) || undefined,
 stopLoss: Number(r.stop_loss ?? 0) || undefined,
 recommendation:
 r.action === 'BUY' ? 'BUY' :
 r.action === 'SELL' ? 'SELL' :
 r.action === 'HOLD' ? 'HOLD' : undefined,
 }}
 variant="icon"
 size="sm"
 />
 )}
 </div>
 ),
 },
 {
 key: 'action',
 header: 'الإجراء',
 align: 'right',
 filterable: true,
 render: (r) => actionBadge(r.action),
 },
 {
 key: 'entry_price',
 header: 'الدخول',
 align: 'right',
 sortable: true,
 className: 'text-xs font-mono',
 render: (r) => fmtNum(r.entry_price),
 },
 {
 key: 'target_price',
 header: 'الهدف',
 align: 'right',
 className: 'text-xs font-mono text-profit',
 render: (r) =>
 `${fmtNum(r.target_price)}${r.target_price_2 ? ` ← ${fmtNum(r.target_price_2)}` : ''}`,
 },
 {
 key: 'stop_loss',
 header: 'الوقف',
 align: 'right',
 className: 'text-xs font-mono text-loss',
 render: (r) => fmtNum(r.stop_loss),
 },
 {
 key: 'status',
 header: 'الحالة',
 align: 'right',
 filterable: true,
 render: (r) => statusBadge(r.status),
 },
 {
 key: 'recommendation_reason',
 header: 'السبب',
 align: 'right',
 className: 'text-xs max-w-[180px] truncate text-muted-foreground',
 render: (r) => (
 <span className="block max-w-[180px] truncate" title={r.recommendation_reason || ''}>
 {r.recommendation_reason || '—'}
 </span>
 ),
 },
 {
 key: '_chevron',
 header: '',
 align: 'right',
 className: 'text-xs',
 render: () => <ChevronLeft className="w-4 h-4 text-muted-foreground" />,
 },
];

// ============================================================================
// Helpers
// ============================================================================

function todayISO(): string {
 try {
 return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
 } catch {
 return new Date().toISOString().slice(0, 10);
 }
}

function parseNum(s: string | undefined | null): number | undefined {
 if (s == null) return undefined;
 const trimmed = String(s).trim();
 if (!trimmed) return undefined;
 // Pick first numeric chunk (handles "1.5 جنيه", "1.5-1.6", etc.)
 const m = trimmed.match(/-?\d+(?:\.\d+)?/);
 if (!m) return undefined;
 const n = parseFloat(m[0]);
 return isNaN(n) ? undefined : n;
}

function parseRange(s: string | undefined | null): { from?: number; to?: number } {
 if (!s) return {};
 const matches = String(s).match(/-?\d+(?:\.\d+)?/g);
 if (!matches || matches.length === 0) return {};
 if (matches.length === 1) {
 const n = parseFloat(matches[0]);
 return { from: n, to: n };
 }
 return { from: parseFloat(matches[0]), to: parseFloat(matches[1]) };
}

function fmtNum(n: number | undefined | null, digits = 2): string {
 if (n == null || isNaN(n)) return '—';
 return Number(n).toLocaleString('en-US', {
 minimumFractionDigits: 0,
 maximumFractionDigits: digits,
 });
}

function actionBadge(action: string) {
 const a = (action || 'BUY').toUpperCase();
 if (a === 'SELL') {
 return (
 <Badge className="bg-loss/10 text-loss border border-loss/20 hover:bg-loss border-loss">
 <TrendingDown className="w-3 h-3 ml-1" />
 بيع
 </Badge>
