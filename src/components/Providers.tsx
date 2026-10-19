'use client';

import React, { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import { SessionProvider } from 'next-auth/react';
import { SessionExpiredModal } from '@/components/auth/SessionExpiredModal';
// FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01): cookie-based i18n context.
// I18nProvider reads the NEXT_LOCALE cookie, loads messages/{locale}.json,
// and exposes useTranslation() to all client components via React Context.
import { I18nProvider } from '@/lib/i18n-context';

export function Providers({ children }: { children: React.ReactNode }) {
 useEffect(() => {
 // Keepalive ping to prevent server auto-shutdown on Hostinger
 if (process.env.NODE_ENV === 'production') {
 const ping = () => {
 fetch('/api/keepalive').catch(() => { /* silent */ });
 };
 ping(); // initial ping
 const interval = setInterval(ping, 60_000); // every 60 seconds
 return () => clearInterval(interval);
 }
 }, []);

 // ANALYTICS-FIX (2026-10-01): global page-view tracking.
 // The app uses hash-based routing (#recommendations, #stocks, #dashboard, …)
 // so we watch `hashchange` events and fire a `page_view` beacon to /api/track.
 // - Uses navigator.sendBeacon (non-blocking, survives page unload).
 // - Throttled to max 1 event per 10 seconds per route to avoid spamming.
 // - Replaces the old "only AdminView tracks" behaviour so real users now
 // show up in the admin dashboard + analytics tables.
 useEffect(() => {
 if (typeof window === 'undefined') return;
 const THROTTLE_MS = 10_000;
 const lastSent: Record<string, number> = {};

 const sendPageView = (route: string) => {
 const now = Date.now();
 const last = lastSent[route] || 0;
 if (now - last < THROTTLE_MS) return; // throttled
 lastSent[route] = now;

 const payload = JSON.stringify({
 event: 'page_view',
 route,
 timestamp: now,
 // legacy-shape fields kept for parity with AdminView callers
 type: 'page_view',
 view: route,
 });
 try {
 if (navigator.sendBeacon) {
 navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
 } else {
 // Fallback for browsers without sendBeacon
 fetch('/api/track', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: payload,
 keepalive: true,
 }).catch(() => { /* silent */ });
 }
 } catch {
 // tracking is fire-and-forget — never break UX
 }
 };

 const trackCurrent = () => {
 const hash = window.location.hash || '#dashboard';
 const route = hash.replace(/^#\/?/, '') || 'dashboard';
 sendPageView(route);
 };

 trackCurrent(); // initial page view
 window.addEventListener('hashchange', trackCurrent);
 return () => window.removeEventListener('hashchange', trackCurrent);
 }, []);

 return (
 <SessionProvider>
 <I18nProvider>
 <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
 {children}
 {/* P37-PHASE-4B: global session-expired modal — listens for the
 `auth:session-expired` window event dispatched by ApiClient on 401.
 Mounted here so it covers every route (admin, root, auth, …) and
 sits inside SessionProvider so it can call next-auth `signOut`. */}
 <SessionExpiredModal />
 </ThemeProvider>
 </I18nProvider>
 </SessionProvider>
 );
}
