// honest-predictions helpers — extracted from page.tsx (Phase 3)

export function formatPercent(val: number | null, withSign = true): string {
 if (val == null || isNaN(val)) return '—';
 const s = val > 0 ? '+' : '';
 return s + val.toFixed(2) + '%';
}

export function formatPrice(val: number | null): string {
 if (val == null || isNaN(val)) return '—';
 return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
