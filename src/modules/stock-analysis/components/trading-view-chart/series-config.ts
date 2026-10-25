// chart series configuration — extracted (Phase 3)

// causing lightweight-charts to collapse all candles into one giant bar.
// Rule: NO string dates ever leave this function — only integers.
//
// CHART-FIX (2026-10-01, 2nd pass): the previous version silently returned
// `Date.now()` for anything it could not parse. `Date.parse('09/01T10:30')`
// is NaN (JS only accepts ISO or US-order slashes), so every intraday candle
// carrying a 'dd/MM HH:mm' date collapsed onto the SAME timestamp — which is
// what produced the single giant bar / empty chart. Unparseable input must
// now be REJECTED, never guessed.

// Parses an EGX 'dd/MM/yyyy', 'dd/MM/yyyy HH:mm', 'dd/MM HH:mm' or
// 'yyyy-mm-dd[ HH:mm[:ss]]' date into UNIX seconds (UTC). Returns null if the
// value is unusable. Day-first ordering is explicit — never rely on
// Date.parse, which assumes month-first for slashes.
function parseSlashOrDashDate(s: string): number | null {
 // Compact 'yyyyMMdd' (EGX daily feed)
 const c = s.match(/^(\d{4})(\d{2})(\d{2})$/);
 if (c) {
 const ts = Date.UTC(+c[1], +c[2] - 1, +c[3]);
 const back = new Date(ts);
 if (back.getUTCMonth() !== +c[2] - 1 || back.getUTCDate() !== +c[3]) return null;
 return Math.floor(ts / 1000);
 }
 const m = s.match(
 /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
 );
 if (m) {
 const [, y, mo, d, hh = '0', mi = '0', ss = '0'] = m;
 return Math.floor(
 Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss) / 1000
 );
 }
 // Day-first: 'dd/MM/yyyy HH:mm[:ss]' or 'dd/MM HH:mm[:ss]'
 const d2 = s.match(
 /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
 );
 if (d2) {
 const [, dd, mm, yy, hh = '0', mi = '0', ss = '0'] = d2;
 let year = yy ? +yy : new Date().getUTCFullYear();
 if (year < 100) year += 2000;
 const month = +mm;
 const day = +dd;
 // Reject impossible calendar dates (e.g. 31/02) instead of rolling over.
 if (month < 1 || month > 12 || day < 1 || day > 31) return null;
 const ts = Date.UTC(year, month - 1, day, +hh, +mi, +ss);
 const back = new Date(ts);
 if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
 return Math.floor(ts / 1000);
 }
 return null;
}

// Strict single source of truth for a candle's x-axis coordinate.
// Returns UNIX seconds, or null when the date cannot be trusted.
function parseBarSeconds(date: unknown): number | null {
 // Already a number (UNIX seconds or milliseconds)
 if (typeof date === 'number' && isFinite(date) && date > 0) {
 const ts = date > 1e12 ? date : date * 1000;
 // Guard against ms/seconds confusion producing year-2001 style epochs.
 if (ts < 631152000000) return null; // earlier than 1990-01-01
 return Math.floor(ts / 1000);
 }
 const s = String(date ?? '').trim();
 if (!s) return null;
 // Compact 'yyyyMMdd' is all digits but is a date, not an epoch — check first.
 if (/^\d{8}$/.test(s)) {
 const compact = parseSlashOrDashDate(s);
 if (compact !== null) return compact;
 }
 // Numeric string ('1700000000' or '1700000000000')
 if (/^\d+(\.\d+)?$/.test(s)) {
 const asNum = Number(s);
 if (asNum <= 0) return null;
 return parseBarSeconds(asNum);
 }
 // ISO / EGX slash formats
 const strict = parseSlashOrDashDate(s);
 if (strict !== null) return strict;
 // Last resort: any other parseable ISO string (with explicit zone).
 const parsed = Date.parse(s.includes('T') && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)
 ? `${s}Z`
 : s);
 if (isNaN(parsed)) return null;
 const secs = Math.floor(parsed / 1000);
 if (secs * 1000 < 631152000000) return null;
 return secs;
}

function barTime(b: OhlcvBar): Time {
 return (parseBarSeconds(b.date as unknown) ?? Math.floor(Date.now() / 1000)) as Time;
}

function sanitizeOhlcBar(bar: OhlcvBar): OhlcvBar | null {
 const seconds = parseBarSeconds(bar.date as unknown);
 if (seconds === null) return null;
 let open = Number(bar.open);
 let high = Number(bar.high);
 let low = Number(bar.low);
 let close = Number(bar.close);
 if ([open, high, low, close].some((v) => !Number.isFinite(v))) return null;
 if (close <= 0) return null;
 if (open <= 0) open = close;
 if (high <= 0) high = Math.max(open, close);
 if (low <= 0) low = Math.min(open, close);

 // Auto-heal OHLC integrity instead of rejecting candle
 high = Math.max(high, open, close);
 low = Math.min(low > 0 ? low : open, open, close);

 // Outlier / 52w-placeholder fix:
 // e.g. low=72.0 injected when stock is trading at 250-450 EGP
 if (low < close * 0.4 && close > 10) {
 low = Math.min(open, close) * 0.98;
 }
 if (high > close * 3.0 && close > 10) {
 high = Math.max(open, close) * 1.05;
 }

 return {
 ...bar,
 open: Math.round(open * 1000) / 1000,
 high: Math.round(high * 1000) / 1000,
 low: Math.round(low * 1000) / 1000,
 close: Math.round(close * 1000) / 1000,
 volume: Number.isFinite(Number(bar.volume)) ? Number(bar.volume) : 0,
 };
}

// CHART-OVERHAUL Fix 2: Array-level sanitization filter.
// Rejects invalid OHLC + outliers (low=0, open=null, high>2x close, etc.)
// so the price scale doesn't stretch from 50 to 650 due to corrupted data.
// CHART-FIX (2026-10-01, 2nd pass): also sorts ascending and de-duplicates by
// timestamp. lightweight-charts throws on unsorted or repeated time values,
// which previously surfaced as a blank canvas.
function sanitizeCandles(candles: OhlcvBar[]): OhlcvBar[] {
 const seen = new Set<number>();
 return candles
 .map(sanitizeOhlcBar)
 .filter((bar): bar is OhlcvBar => bar !== null)
 .sort((a, b) => (parseBarSeconds(a.date as unknown) ?? 0) - (parseBarSeconds(b.date as unknown) ?? 0))
 .filter((bar) => {
 const t = parseBarSeconds(bar.date as unknown);
 if (t === null || seen.has(t)) return false;
 seen.add(t);
 return true;
 });
}

// CHART-OVERHAUL Fix 3: Cairo timezone formatters (UTC+2 / +3 with DST).
// lightweight-charts uses UTCTimestamp (seconds since epoch in UTC); the
// localization formatters below render these in Africa/Cairo so the axis
// shows 10:00-14:30 (market hours) instead of 06:00 / 16:30 / 17:45.
const cairoTimeFormatter = new Intl.DateTimeFormat('en-GB', {
 timeZone: 'Africa/Cairo',
 hour: '2-digit',
 minute: '2-digit',
 hour12: false,
});

const cairoDateFormatter = new Intl.DateTimeFormat('en-GB', {
 timeZone: 'Africa/Cairo',
 day: '2-digit',
 month: 'short',
});

// CHART-FIX (2026-10-01): Always format from numeric timestamp.
// Never fall through to safeFormatTime (which parses 'dd/MM/yyyy' as MM/DD).
function cairoTimeLabel(time: unknown): string {
 if (typeof time === 'number' && isFinite(time) && time > 0) {
 return cairoTimeFormatter.format(new Date(time * 1000));
 }
 // If it's a string, try to parse as number first
 const num = Number(time);
 if (!isNaN(num) && num > 0) {
 return cairoTimeFormatter.format(new Date(num > 1e12 ? num : num * 1000));
 }
 // Last resort: parse as date
 const d = new Date(String(time));
 if (!isNaN(d.getTime())) {
 return cairoTimeFormatter.format(d);
 }
 return '';
}

function cairoDateLabel(time: unknown): string {
 if (typeof time === 'number' && isFinite(time) && time > 0) {
 return cairoDateFormatter.format(new Date(time * 1000));
 }
 return safeFormatTime(time);
}

// CHART-OVERHAUL Fix 3: Filter intraday candles to EGX market hours
// (10:00 - 14:30 Cairo local time). Removes after-close + pre-open noise
// (e.g. 16:30, 17:45, 06:00) that corrupts the time axis.
// CHART-EMPTY-FIX: only apply to intraday timeframes. Self-defensive — if
// filtering removes > 80% of candles (likely backend already pre-filtered OR
// timezone conversion went wrong), skip the filter and return original data.
// CHART-FIX (2026-10-01): filterMarketHours DISABLED.
// This filter was destroying 90% of intraday candles due to timezone mismatch.
// The backend already returns market-hours-only data. No client-side filter needed.
