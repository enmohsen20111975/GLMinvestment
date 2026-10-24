'use client';

/**
 * SessionExpiredModal (P37-PHASE-4B)
 * ---------------------------------
 * Blocking modal shown when an authenticated admin/user session has expired
 * and a silent API request returned 401. The `ApiClient.request()` method in
 * `src/lib/api-client.ts` dispatches a `window` custom event
 * `auth:session-expired` whenever it sees a 401 (browser-only). This
 * component listens for that event and surfaces a single, non-dismissible
 * modal asking the user to sign in again.
 *
 * Design decisions:
 * - Module-level `modalShown` boolean guards against stacked modals when
 * multiple 401s fire in rapid succession (e.g. parallel fetches).
 * - Outside-click / Escape are blocked via `onOpenChange` guard so the
 * user must click the "تسجيل الدخول" button to proceed.
 * - The button calls next-auth `signOut({ callbackUrl: '/', redirect: true })`
 * to clear the stale session cookie and route back to the home page where
 * the AuthGate / LoginPromptModal will take over.
 * - Mounted globally inside `Providers.tsx` so it covers every route
 * (admin, root, auth, payment, …).
 *
 * Colours: amber + emerald (no indigo/blue) per design brief.
 */

import React, { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import { LogIn, AlertTriangle, Loader2 } from 'lucide-react';
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
 DialogDescription,
 DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Module-level guard: prevents multiple 401s (e.g. from concurrent fetches)
// from stacking multiple modals or re-triggering after the user has clicked.
let sessionExpiredShown = false;

export function SessionExpiredModal() {
 const [open, setOpen] = useState(false);
 const [redirecting, setRedirecting] = useState(false);

 useEffect(() => {
 if (typeof window === 'undefined') return;

 const handleSessionExpired = () => {
 // Only show once per page lifecycle. The user must reload after
 // signing back in, which resets this flag.
 if (sessionExpiredShown) return;
 sessionExpiredShown = true;
 setOpen(true);
 };

 window.addEventListener('auth:session-expired', handleSessionExpired);
 return () => {
 window.removeEventListener('auth:session-expired', handleSessionExpired);
 };
 }, []);

 const handleSignIn = async () => {
 setRedirecting(true);
 try {
 // Clear the stale next-auth session cookie, then redirect to home.
 // The root page's AuthGate will detect the unauthenticated state and
 // surface the LoginPromptModal automatically.
 await signOut({ callbackUrl: '/', redirect: true });
 } catch {
 // Fallback: hard navigation if signOut fails for any reason.
 if (typeof window !== 'undefined') {
 window.location.href = '/';
 }
 }
 };

 // Block dismissal via outside-click / Escape — only the primary button
 // closes the modal (and triggers the redirect).
 const handleOpenChange = (next: boolean) => {
 if (!next) return; // swallow close attempts
 setOpen(next);
 };

 return (
 <Dialog open={open} onOpenChange={handleOpenChange}>
 <DialogContent
 showCloseButton={false}
 className="sm:max-w-md overflow-hidden p-0 gap-0"
 onEscapeKeyDown={(e) => e.preventDefault()}
 onPointerDownOutside={(e) => e.preventDefault()}
 onInteractOutside={(e) => e.preventDefault()}
 >
 <DialogHeader className="sr-only">
 <DialogTitle>انتهت الجلسة</DialogTitle>
 <DialogDescription>
 انتهت صلاحية جلسة الدخول. يرجى تسجيل الدخول مرة أخرى للمتابعة.
 </DialogDescription>
 </DialogHeader>

 {/* Visual header (amber gradient + warning icon) */}
 <div className="relative from-warning via-warning to-loss px-6 pt-7 pb-6 text-center text-foreground">
 <div className="absolute inset-0 opacity-20 pointer-events-none">
 <div className="absolute -top-10 -right-10 size-40 rounded-full bg-white blur-3xl" />
 <div className="absolute -bottom-10 -left-10 size-40 rounded-full bg-warning blur-3xl" />
 </div>

 <div className="relative inline-flex items-center justify-center mb-3">
 <div className="size-16 rounded-2xl bg-white/15 ring-4 ring-white/30 backdrop-blur flex items-center justify-center">
 <AlertTriangle className="size-8" />
 </div>
 </div>

 <h2 className="relative text-xl font-extrabold tracking-tight">
 انتهت الجلسة
 </h2>
 <p className="relative text-sm text-foreground/90 mt-1.5 leading-relaxed">
 انتهت صلاحية جلسة الدخول. يرجى تسجيل الدخول مرة أخرى للمتابعة.
 </p>
 </div>

 {/* Footer with single primary CTA */}
 <div className="px-6 py-5 bg-background">
 <DialogFooter className="sm:justify-center">
 <Button
 onClick={handleSignIn}
 size="lg"
 disabled={redirecting}
 className="w-full h-11 text-base font-bold from-warning to-loss hover:from-warning hover:to-loss text-foreground shadow-md gap-2"
 >
 {redirecting ? (
 <Loader2 className="size-5 animate-spin" />
 ) : (
 <LogIn className="size-5" />
 )}
 تسجيل الدخول
 </Button>
 </DialogFooter>
 </div>
 </DialogContent>
 </Dialog>
 );
}
