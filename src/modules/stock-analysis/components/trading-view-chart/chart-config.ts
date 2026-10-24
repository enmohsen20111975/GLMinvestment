// TradingViewChart chart config — extracted (Phase 3)

): { k: (number | null)[]; d: (number | null)[] } {
 const kValues: (number | null)[] = [];
 
 for (let i = 0; i < closes.length; i++) {
 if (i < kPeriod - 1) {
 kValues.push(null);
 continue;
 }
 
 let highestHigh = -Infinity;
 let lowestLow = Infinity;
 
 for (let j = i - kPeriod + 1; j <= i; j++) {
 highestHigh = Math.max(highestHigh, highs[j]);
 lowestLow = Math.min(lowestLow, lows[j]);
 }
 
 if (highestHigh === lowestLow) {
 kValues.push(50);
 } else {
 kValues.push(((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100);
 }
 }
 
 const dValues: (number | null)[] = new Array(closes.length).fill(null);
 
 for (let i = 0; i < closes.length; i++) {
 if (kValues[i] === null) continue;
 
 const windowStart = i - dPeriod + 1;
 if (windowStart < 0) continue;
 
 let sum = 0;
 let count = 0;
 for (let j = windowStart; j <= i; j++) {
 if (kValues[j] !== null) {
 sum += kValues[j]!;
 count++;
 }
 }
 
 if (count === dPeriod) {
 dValues[i] = sum / dPeriod;
 }
 }
 
 return { k: kValues, d: dValues };
}

function calcATR(highs: number[], lows: number[], closes: number[], period: number = 14): (number | null)[] {
 const tr: number[] = [];
 
 for (let i = 1; i < closes.length; i++) {
 const h = highs[i] - lows[i];
 const hc = Math.abs(highs[i] - closes[i - 1]);
 const lc = Math.abs(lows[i] - closes[i - 1]);
 tr.push(Math.max(h, hc, lc));
 }
 
 return calcSMA(tr, period);
}

function calcOBV(closes: number[], volumes: number[]): (number | null)[] {
 const result: (number | null)[] = [0];
 
 for (let i = 1; i < closes.length; i++) {
 const prevClose = closes[i - 1];
 const currClose = closes[i];
 const volume = volumes[i] || 0;
 
 if (currClose > prevClose) {
 result.push((result[i - 1] || 0) + volume);
 } else if (currClose < prevClose) {
 result.push((result[i - 1] || 0) - volume);
 } else {
 result.push(result[i - 1] || 0);
 }
 }
 
 return result;
}

// CHART-FIX (2026-10-01): removed normalizeDate(). It rewrote valid timestamps
// into 'DD/MM HH:mm' strings that the rest of the file could not parse back,
// and nothing needs it now that sanitizeOhlcBar preserves the source date.
function safeFormatTime(timeVal: any): string {
 if (!timeVal) return '';

 let date: Date | null = null;
 let isDateOnly = false;

 if (typeof timeVal === 'string') {
 const trimmed = timeVal.trim();
 if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
 isDateOnly = true;
 const [y, m, d] = trimmed.split('-').map(Number);
 date = new Date(y, m - 1, d);
 } else if (/^\d{2}\/\d{2}/.test(trimmed)) {
 // CHART-FIX (2026-10-01): `new Date('09/01/26 10:30')` is parsed as
 // MM/DD by V8 and a missing century becomes 2001 — this is where the
 // bogus '09/01/2001' axis/tooltip label came from. Use the strict
 // day-first parser instead.
 const secs = parseSlashOrDashDate(trimmed);
 if (secs !== null) date = new Date(secs * 1000);
 } else {
 const num = Number(trimmed);
 if (!isNaN(num) && /^\d+(\.\d+)?$/.test(trimmed)) {
 date = new Date(num > 1e11 ? num : num * 1000);
 } else {
 date = new Date(trimmed);
 }
 }
 } else if (typeof timeVal === 'number') {
 date = new Date(timeVal > 1e11 ? timeVal : timeVal * 1000);
 } else if (timeVal && typeof timeVal === 'object' && 'year' in timeVal) {
 date = new Date(timeVal.year, timeVal.month - 1, timeVal.day);
 isDateOnly = true;
 } else {
 date = new Date(timeVal);
 }

 if (!date || isNaN(date.getTime())) return typeof timeVal === 'string' ? timeVal : '';

 const day = String(date.getDate()).padStart(2, '0');
 const month = String(date.getMonth() + 1).padStart(2, '0');
 const year = date.getFullYear();

 if (isDateOnly) {
 return `${year}-${month}-${day}`;
 }

 const hours = date.getHours();
 const minutes = date.getMinutes();

 if (hours === 0 && minutes === 0) {
 return `${year}-${month}-${day}`;
 }

 const hourStr = String(hours).padStart(2, '0');
 const minStr = String(minutes).padStart(2, '0');
 return `${day}/${month} ${hourStr}:${minStr}`;
}

const fmtDateLabel = safeFormatTime;

// P35-FIX: Convert ANY date representation (number, numeric string, 'yyyy-mm-dd',
// 'dd/MM HH:mm', 'dd/MM/yyyy HH:mm', 'dd/MM/yyyy') to a UNIX-seconds integer Time.
// lightweight-charts REJECTS intraday string dates with "Invalid date string" —
// every series MUST pass a numeric Time. This is the single source of truth.
// CHART-FIX (2026-10-01): barTime now ALWAYS returns a UNIX-seconds integer.
// Previous version mixed string dates ('yyyy-mm-dd' as Time) with numeric timestamps
