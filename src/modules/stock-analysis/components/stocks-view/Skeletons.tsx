/**
 * stocks-view/Skeletons.tsx
 * ============================================================================
 * F-Phase3-Split-StocksView: loading-state skeleton rows.
 *
 * 3 sub-components بـ تـrender وقت الـ initial loading:
 *   - TableSkeleton  (desktop rows preview)
 *   - CardGridSkeleton (mobile card preview — currently unused but kept for future)
 *   - SummarySkeleton (overview summary bar preview)
 * ============================================================================
 */

import { Skeleton } from '@/components/ui/skeleton';

export function TableSkeleton() {
  return (
    <div className="hidden md:block">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0 px-4">
          <Skeleton className="h-5 w-14 flex-shrink-0" />
          <Skeleton className="h-5 w-28 flex-1" />
          <Skeleton className="h-5 w-20 flex-shrink-0" />
          <Skeleton className="h-5 w-16 flex-shrink-0" />
          <Skeleton className="h-5 w-16 flex-shrink-0" />
          <Skeleton className="h-5 w-20 flex-shrink-0" />
          <Skeleton className="h-5 w-16 flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-52 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-28 rounded-lg" />
      ))}
    </div>
  );
}
