// ExpertRecommendations helpers — extracted (Phase 3)

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
