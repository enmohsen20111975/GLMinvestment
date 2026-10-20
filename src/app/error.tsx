'use client';

/**
 * Root error boundary (app-level).
 * ====================================================================
 * FIX-P3-P5-P6 (Group P6 — Fix 8)
 *
 * Next.js App Router requires a `src/app/error.tsx` file to gracefully
 * catch unexpected runtime errors anywhere in the tree. Without it, an
 * uncaught error in ANY route's render crashes the WHOLE app with the
 * default Next.js red-error page — bad UX, no Arabic copy, no retry
 * button, no way to navigate home.
 *
 * This component:
 * - Catches errors from the closest <ErrorBoundary>
 * - Shows a shadcn Card with the error message
 * - Provides:
 * • "إعادة المحاولة" button → calls `reset()` (re-runs the failed route)
 * • "العودة للرئيسية" link → navigates to /
 * - Logs the error to console (so server-side logs surface it)
 * - Does NOT auto-refresh (avoid loops when the error is deterministic)
 *
 * Note: must be a client component ('use client') — server components
 * can't catch errors via React's error-boundary mechanism.
 */

import React, { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface RootErrorProps {
 error: Error & { digest?: string };
 reset: () => void;
}

export default function RootError({ error, reset }: RootErrorProps) {
 useEffect(() => {
 // Surface the error in the server logs (the Next.js runtime forwards
 // console.error to the server process during SSR/dev).
 console.error('[RootErrorBoundary]', error);
 }, [error]);

 const isDigest = Boolean(error?.digest);

 return (
 <div
 dir="rtl"
 className="min-h-screen flex items-center justify-center p-4 bg-background"
 >
 <Card className="w-full max-w-md">
 <CardHeader className="text-center">
 <div className="mx-auto mb-3 w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
 <AlertTriangle className="w-7 h-7 text-danger" />
 </div>
 <CardTitle className="text-xl">حدث خطأ غير متوقع</CardTitle>
 <CardDescription>
 حدث خطأ أثناء تحميل الصفحة. حاول مرة أخرى أو ارجع للصفحة الرئيسية.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 {process.env.NODE_ENV === 'development' && (
 <pre
 className="text-xs bg-muted/50 dark:bg-muted/20 rounded-md p-3 overflow-x-auto text-muted-foreground"
 dir="ltr"
 >
 <div className="font-bold mb-1">{error.name}: {error.message}</div>
 {error.stack && (
 <details>
 <summary className="cursor-pointer opacity-70 hover:opacity-100">Stack trace</summary>
 <pre className="mt-2 whitespace-pre-wrap">{error.stack}</pre>
 </details>
 )}
 {isDigest && <div className="mt-2 text-[10px] opacity-60">digest: {error.digest}</div>}
 </pre>
 )}
 <div className="flex flex-col sm:flex-row gap-2">
 <Button
 onClick={reset}
 className="flex-1 gap-2"
 variant="default"
 >
 <RotateCcw className="w-4 h-4" />
 إعادة المحاولة
 </Button>
 <Button
 asChild
 variant="outline"
 className="flex-1 gap-2"
 >
 <Link href="/">
 <Home className="w-4 h-4" />
 العودة للرئيسية
 </Link>
 </Button>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}
