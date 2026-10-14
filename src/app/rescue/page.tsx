'use client';

/* ============================================================================
   ALPHA-RESCUE-V1 — Rescue Clinic Page (#rescue)
   ----------------------------------------------------------------------------
   صفحة عيادة إنقاذ الصفقات المتعثرة — كل المنطق في BagHolderRescuePanel.

   Rule 4  (NO FRONTEND COMPUTATION): كل القرارات من Python.
   Rule 27 (NO-FAKE-DATA): حالات فارغة/خطأ صادقة.
   Rule 30 (CLIENT-FACING-STYLE): emerald/teal/amber/red فقط — NO blue/indigo.
   ============================================================================ */

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';

// Lazy-load the panel (it's a heavy client component).
const BagHolderRescuePanel = dynamic(
  () =>
    import('@/modules/portfolio/components/BagHolderRescuePanel').then(
      (m) => m.BagHolderRescuePanel,
    ),
  { ssr: false, loading: () => <Skeleton className="h-96 w-full rounded-xl" /> },
);

function RescuePageInner() {
  const searchParams = useSearchParams();
  const ticker = searchParams.get('ticker') || undefined;
  const buyPrice = searchParams.get('buy_price')
    ? Number(searchParams.get('buy_price'))
    : undefined;
  const quantity = searchParams.get('quantity')
    ? Number(searchParams.get('quantity'))
    : undefined;
  const totalCost = searchParams.get('total_cost')
    ? Number(searchParams.get('total_cost'))
    : undefined;
  const autoAnalyze = searchParams.get('auto') === '1';

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-4xl mx-auto p-4 md:p-6">
        <BagHolderRescuePanel
          ticker={ticker}
          buyPrice={buyPrice}
          quantity={quantity}
          totalCost={totalCost}
          autoAnalyze={autoAnalyze}
        />
      </div>
    </div>
  );
}

export default function RescuePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background" dir="rtl">
          <div className="max-w-4xl mx-auto p-4 md:p-6">
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        </div>
      }
    >
      <RescuePageInner />
    </Suspense>
  );
}
