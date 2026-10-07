/**
 * Root loading boundary.
 * ====================================================================
 * FIX-P3-P5-P6 (Group P6 — Fix 8)
 *
 * Next.js App Router renders `src/app/loading.tsx` as a Suspense fallback
 * while the root layout + page are being server-rendered. Without it the
 * user sees a blank white screen during the initial render — looks
 * broken, especially on slow networks.
 *
 * This component shows a centered brand-friendly skeleton with three
 * pulsing cards so the user immediately sees "the page is loading, not
 * crashed".
 *
 * Note: this is a server component — it must NOT use hooks or browser APIs.
 */

import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function Loading() {
  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center p-4 bg-background"
    >
      <div className="w-full max-w-2xl space-y-4">
        {/* Header skeleton */}
        <div className="flex items-center gap-3">
          <Skeleton className="w-12 h-12 rounded-xl" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="w-24 h-9 rounded-md" />
        </div>

        {/* Quick stats grid skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="p-4">
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-6 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main content card skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56 mt-1" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-md border border-border/40">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2 w-1/2" />
                </div>
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Footer skeleton */}
        <div className="flex justify-center">
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
    </div>
  );
}
