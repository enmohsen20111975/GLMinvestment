// honest-predictions helpers (Phase 3)

function formatPercent(val: number | null, withSign = true): string {
 if (val === null || val === undefined) return '—';
 const sign = withSign && val > 0 ? '+' : '';
 return `${sign}${val.toFixed(2)}%`;
}

function formatPrice(val: number | null): string {
 if (val === null || val === undefined) return '—';
 return val.toFixed(2);
}

// ============================================================================
// MAIN COMPONENT
