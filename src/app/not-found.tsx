/**
 * Root 404 page.
 * ====================================================================
 * FIX-P3-P5-P6 (Group P6 — Fix 8)
 *
 * Next.js App Router renders `src/app/not-found.tsx` whenever:
 * - A route doesn't exist
 * - A `notFound()` is thrown from any server component
 * - The user types a wrong URL
 *
 * Without this file, Next.js shows a blank "404 This page could not be
 * found" with no styling and no navigation. This component shows a
 * friendly Arabic 404 with a link back home.
 *
 * Note: this is a server component (no 'use client') so it can be static-
 * rendered at build time.
 */

import Link from 'next/link';
import { Compass, Home } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function NotFound() {
 return (
 <div
 dir="rtl"
 className="min-h-screen flex items-center justify-center p-4 bg-background"
 >
 <Card className="w-full max-w-md text-center">
 <CardHeader>
 <div className="mx-auto mb-3 w-16 h-16 rounded-full bg-warning/10 dark:bg-warning/20 flex items-center justify-center">
 <Compass className="w-8 h-8 text-warning" />
 </div>
 <CardTitle className="text-3xl font-bold">٤٠٤</CardTitle>
 <CardDescription className="text-base">
 الصفحة غير موجودة
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <p className="text-sm text-muted-foreground">
 الصفحة التي تبحث عنها غير موجودة أو تم نقلها. يرجى العودة للصفحة الرئيسية.
 </p>
 <Button asChild className="w-full gap-2">
 <Link href="/">
 <Home className="w-4 h-4" />
 العودة للرئيسية
 </Link>
 </Button>
 </CardContent>
 </Card>
 </div>
 );
}
