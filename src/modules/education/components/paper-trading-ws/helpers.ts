/**
 * paper-trading-ws/helpers.ts
 * ============================
 * Pure helpers + formatters for the PaperTradingWorkstation split
 * (Task F-Phase3-FinalPush — split from 1,550 LOC).
 *
 * Exports:
 *   - fmtEgp / fmtNum / fmtPct — Arabic locale formatters
 *   - pnlColor / rowBgClass — color class helpers for P&L display
 *   - timeAgoAr / dateTimeAr — Arabic date formatters (relative / absolute)
 *
 * Rule 30 (CLIENT-FACING-STYLE): Arabic labels + ar-EG locale.
 */

const egpFmt = new Intl.NumberFormat('ar-EG', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const numFmt = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });

export function fmtEgp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return egpFmt.format(v);
}

export function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return numFmt.format(v);
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return pctFmt.format(v);
}

export function pnlColor(v: number | null | undefined): string {
  if (v == null) return 'text-muted-foreground';
  if (v > 0) return 'text-profit ';
  if (v < 0) return 'text-loss ';
  return 'text-muted-foreground';
}

export function rowBgClass(v: number | null | undefined): string {
  if (v == null) return '';
  if (v > 0) return 'bg-profit/10 /20';
  if (v < 0) return 'bg-loss/10 /20';
  return '';
}

/** Format ISO date as a relative Arabic string (e.g. "منذ 5 دقائق"). */
export function timeAgoAr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '—';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'الآن';
  const min = Math.floor(sec / 60);
  if (min < 60) return `منذ ${min} دقيقة`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `منذ ${hr} ساعة`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `منذ ${day} يوم`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `منذ ${mon} شهر`;
  return `منذ ${Math.floor(mon / 12)} سنة`;
}

/** Format ISO date as dd/MM/yyyy HH:mm (Arabic digits). */
export function dateTimeAr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return new Intl.NumberFormat('ar-EG').format(
    parseInt(`${dd}${mm}${yyyy}${hh}${mi}`, 10),
  ).replace(/(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})/, '$1/$2/$3 $4:$5');
}
