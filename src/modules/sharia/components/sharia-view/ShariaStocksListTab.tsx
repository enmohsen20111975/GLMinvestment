/**
 * sharia-view/ShariaStocksListTab.tsx
 * =================================
 * Stocks list tab — fetches /api/sharia?limit=1000&… and renders the
 * stats strip + filters (search/consensus/status chips) + sources
 * legend + paginated grid of ShariaStockRowCard + StatPill primitives.
 *
 * Extracted from ShariaView.tsx (1,478 LOC) in Task F-Phase3-FinalPush.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  Building2,
  Filter,
  Info,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { UnifiedPagination } from '@/components/shared/ui';
import {
  STATUS_BADGE_CLASS,
  type ShariaRow,
} from './types';
type ShariaListResponse = any;
import { Alert, deriveOverallStatus } from './helpers';
import { ShariaStockRowCard } from './ShariaStockRowCard';

export interface StocksListTabProps {
  onOpenDetail: (symbol: string) => void;
}

export function ShariaStocksListTab({ onOpenDetail }: StocksListTabProps) {
  const [rows, setRows] = useState<ShariaRow[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    consensus_count: number;
    with_sp_rate: number;
    latest_source_update: string | null;
  } | null>(null);
  const [sources, setSources] = useState<
    Array<{ source_key: string; name_ar: string; methodology: string; is_active: number }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [consensusOnly, setConsensusOnly] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'compliant' | 'doubtful' | 'non_compliant'>('all');

  // Pagination
  const [page, setPage] = useState(0);
  const pageSize = 24;

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: '1000',
        offset: '0',
      });
      if (consensusOnly) params.set('consensus', 'true');
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/sharia?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ShariaListResponse;
      if (!json.success) throw new Error('استجابة غير صالحة');
      setRows(json.rows || []);
      setStats(json.stats || null);
      setSources(json.sources || []);
    } catch (e) {
      setError(String((e as Error).message || e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [consensusOnly, search]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Client-side filter by status (server doesn't filter by exact status field).
  const filteredRows = useMemo(() => {
    if (filterStatus === 'all') return rows;
    return rows.filter((r) => deriveOverallStatus(r) === filterStatus);
  }, [rows, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filteredRows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const consensusPct =
    stats && stats.total > 0
      ? Math.round((stats.consensus_count / stats.total) * 100)
      : null;

  return (
    <div className="space-y-3">
      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatPill label="إجمالي الأسهم" value={stats?.total?.toString() ?? '—'} icon={<Building2 className="w-3.5 h-3.5" />} accent="emerald" />
        <StatPill label="متوافق (إجماع)" value={stats?.consensus_count?.toString() ?? '—'} icon={<ShieldCheck className="w-3.5 h-3.5" />} accent="emerald" />
        <StatPill label="نسبة الإجماع" value={consensusPct != null ? `${consensusPct}%` : '—'} icon={<Award className="w-3.5 h-3.5" />} accent="amber" />
        <StatPill label="آخر تحديث مصدر" value={stats?.latest_source_update ? stats.latest_source_update.slice(0, 10) : '—'} icon={<Info className="w-3.5 h-3.5" />} accent="emerald" />
      </div>

      {/* Filters */}
      <Card className="border-profit ">
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="بحث بالرمز أو الاسم العربي..."
                className="pr-9"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={consensusOnly ? 'default' : 'outline'}
                onClick={() => {
                  setConsensusOnly((v) => !v);
                  setPage(0);
                }}
                className={cn(
                  'gap-1.5 text-xs h-9',
                  consensusOnly && 'bg-profit hover:bg-profit text-white',
                )}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                الإجماع فقط
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={fetchList}
                disabled={loading}
                className="h-9 w-9"
                aria-label="تحديث"
              >
                <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { id: 'all', label: 'الكل', color: 'bg-muted text-foreground' },
              { id: 'compliant', label: '🟢 متوافق', color: STATUS_BADGE_CLASS.compliant },
              { id: 'doubtful', label: '🟡 مشمول', color: STATUS_BADGE_CLASS.doubtful },
              { id: 'non_compliant', label: '🔴 غير متوافق', color: STATUS_BADGE_CLASS.non_compliant },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  setFilterStatus(opt.id);
                  setPage(0);
                }}
                className={cn(
                  'text-xs px-2 py-1 rounded-full border transition-all',
                  opt.color,
                  filterStatus === opt.id
                    ? 'ring-2 ring-offset-1 ring-profit font-bold'
                    : 'opacity-70 hover:opacity-100',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Sources legend */}
          {sources.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" />
                المصادر الشرعية الثمانية ({sources.filter((s) => s.is_active === 1).length} نشط)
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-1.5 p-2 rounded-md bg-muted/40">
                {sources.map((s) => (
                  <div key={s.source_key} className="flex items-center justify-between text-xs">
                    <span className="font-medium">{s.name_ar}</span>
                    <span className="text-muted-foreground">
                      {s.is_active === 1 ? 'نشط' : 'متوقف'} · {s.methodology}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : pageRows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <Filter className="w-8 h-8 mx-auto mb-2 opacity-40" />
            لا توجد أسهم مطابقة للفلتر الحالي.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {pageRows.map((row) => (
              <ShariaStockRowCard key={row.symbol} row={row} onOpenDetail={onOpenDetail} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <span className="text-xs text-muted-foreground">
                صفحة {safePage + 1} من {totalPages} · إجمالي {filteredRows.length} سهماً
              </span>
              <div className="flex gap-1">
                {/* P0-COMPONENT-UNIFICATION Phase 2.4: UnifiedPagination بدل inline buttons */}
                <UnifiedPagination
                  page={safePage}
                  totalPages={totalPages}
                  onChange={setPage}
                  size="sm"
                  variant="compact"
                  showCounter={false}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function StatPill({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: 'emerald' | 'amber';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-2 flex items-center gap-2',
        accent === 'emerald'
          ? 'border-profit bg-profit/10 /20'
          : 'border-warning bg-warning/10 /20',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full',
          accent === 'emerald'
            ? 'bg-profit/10 text-profit border border-profit/20 '
            : 'bg-warning/10 text-warning dark:text-warning border border-warning/20 ',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p
          className={cn(
            'text-sm font-bold tabular-nums',
            accent === 'emerald'
              ? 'text-profit '
              : 'text-warning ',
          )}
          dir="ltr"
        >
          {value}
        </p>
      </div>
    </div>
  );
}
