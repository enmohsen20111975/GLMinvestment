// UsersManagement helpers (Phase 3)
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(dateStr)); }
  catch { return dateStr; }
}
export function tierBadge(tier: string): string {
  const map: Record<string, string> = {
    free: 'bg-muted text-muted-foreground',
    premium: 'bg-profit/10 text-profit',
    pro: 'bg-primary/10 text-primary',
    admin: 'bg-warning/10 text-warning',
  };
  return map[tier?.toLowerCase()] || map.free;
}
