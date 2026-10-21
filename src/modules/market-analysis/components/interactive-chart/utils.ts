import type { Time } from 'lightweight-charts';
import type { ChartData, IndicatorData } from './types';

function toTime(timeVal: string | number): Time {
 if (typeof timeVal === 'number') {
 return timeVal as Time;
 }
 if (!timeVal) {
 return Math.floor(Date.now() / 1000) as Time;
 }
 const s = String(timeVal).trim();
 const asNum = Number(s);
 if (!isNaN(asNum) && /^\d+(\.\d+)?$/.test(s)) {
 return Math.floor(asNum) as Time;
 }
 if (s.length === 10 && s[4] === '-' && s[7] === '-') {
 return s as Time;
 }
 if (s.includes('/')) {
 const parts = s.split(' ');
 const dateParts = parts[0].split('/');
 const timeParts = parts[1] ? parts[1].split(':') : ['00', '00'];
 const now = new Date();
 const day = parseInt(dateParts[0], 10);
 const month = parseInt(dateParts[1], 10) - 1;
 const year = dateParts[2] ? parseInt(dateParts[2], 10) : now.getFullYear();
 const hours = parseInt(timeParts[0], 10) || 0;
 const mins = parseInt(timeParts[1], 10) || 0;
 const d = new Date(year, month, day, hours, mins);
 if (!isNaN(d.getTime())) {
 return Math.floor(d.getTime() / 1000) as Time;
 }
 }
 const parsed = Date.parse(s.replace(' ', 'T'));
 if (!isNaN(parsed)) {
 return Math.floor(parsed / 1000) as Time;
 }
 return s as Time;
}

// ── P32 TASK 1+2: time → numeric seconds (for sort/dedup) ──
// lightweight-charts requires strictly ascending, unique times. Mixed string/number
// times (daily 'yyyy-mm-dd' vs intraday unix-seconds) must be comparable.
function timeToNumber(t: Time): number {
 if (typeof t === 'number') return t;
 const s = String(t);
 const p = s.split('-');
 if (p.length === 3 && p[0].length === 4) {
 const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
 return Math.floor(d.getTime() / 1000);
 }
 const parsed = Date.parse(s.replace(' ', 'T'));
 return isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

// ── P32 TASK 2: Sanitize OHLCV before setData() ──
// Drops candles with null/NaN/non-finite OHLC (prevents "Value is null" crash),
// drops candles with unparseable time (prevents "Invalid date string=26/07 09:00"),
// sorts ascending by time, and dedupes by time (keeps last).
// This is the exact filter the client requested: no null candle may reach the chart.
function sanitizeCandles(data: ChartData[]): ChartData[] {
 const cleaned: ChartData[] = [];
 for (const d of data) {
 const o = Number(d.open);
 const h = Number(d.high);
 const l = Number(d.low);
 const c = Number(d.close);
 if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
 if (o <= 0 || c <= 0) continue;

 // Outlier suppression (e.g. 52-week low/high dumped into daily candle)
 let safeHigh = Math.max(h, o, c);
 let safeLow = Math.min(l, o, c);
 if (c > 10 && safeLow < c * 0.4) {
 safeLow = Math.min(o, c) * 0.98;
 }
 if (c > 10 && safeHigh > c * 3.0) {
 safeHigh = Math.max(o, c) * 1.05;
 }

 const tnum = timeToNumber(toTime(d.time));
 if (tnum <= 0) continue; // unparseable time → drop (prevents "Invalid date string")
 cleaned.push({
 time: d.time,
 open: Math.round(o * 1000) / 1000,
 high: Math.round(safeHigh * 1000) / 1000,
 low: Math.round(safeLow * 1000) / 1000,
 close: Math.round(c * 1000) / 1000,
 volume: Number(d.volume) || 0,
 });
 }
 cleaned.sort((a, b) => timeToNumber(toTime(a.time)) - timeToNumber(toTime(b.time)));
 // Dedupe by time (keep last occurrence's values)
 const out: ChartData[] = [];
 let lastKey = 0;
 for (const d of cleaned) {
 const key = timeToNumber(toTime(d.time));
 if (out.length > 0 && key === lastKey) {
 out[out.length - 1] = d;
 } else {
 out.push(d);
 lastKey = key;
 }
 }
 return out;
}

function fmtDateLabel(timeVal: string | number): string {
 let date: Date;
 if (typeof timeVal === 'number') {
 date = new Date(timeVal * 1000);
 } else {
 const d = new Date(timeVal);
 date = isNaN(d.getTime()) ? new Date(Number(timeVal) * 1000) : d;
 }
 const day = String(date.getDate()).padStart(2, '0');
 const month = String(date.getMonth() + 1).padStart(2, '0');
 const hour = String(date.getHours()).padStart(2, '0');
 const minute = String(date.getMinutes()).padStart(2, '0');
 return `${day}/${month} ${hour}:${minute}`;
}

function formatLineData(data: IndicatorData[]) {
 return data
 .filter((d) => d.value !== null && d.value !== undefined && !isNaN(d.value))
 .map((d) => ({
 time: toTime(d.time),
 value: d.value,
 }));
}

function formatVolumeData(data: ChartData[]) {
 return data.map((d) => ({
 time: toTime(d.time),
 value: d.volume,
 color: d.close >= d.open ? UP_COLOR + '40' : DOWN_COLOR + '40',
 }));
}

// ─── Client-Side Calculation Functions ────────────────────────────────────────

