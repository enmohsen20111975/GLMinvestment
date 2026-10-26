'use client';

/**
 * useAuthCheck — polls /api/auth/me every 60 seconds and keeps the
 * zustand store in sync with the server-side auth state.
 *
 * Strategy:
 *  1. On mount, immediately fetch /api/auth/me (no Authorization header →
 *     relies on the NextAuth session cookie set by the browser).
 *  2. If a user comes back → mark `isAuthenticated = true`, set `user`.
 *  3. If 401 → retry once after 2s. If still 401 → mark unauthenticated.
 *     This grace period prevents transient session blips from logging
 *     users out (the #1 complaint: "login prompt keeps appearing").
 *  4. Re-check every 60 seconds while the tab is visible.
 *
 * Resilience: transient errors (500, network, timeout) NEVER log the user
 * out. Only a confirmed 401 (after retry) does.
 */

import { useEffect, useRef } from 'react';
import { useSession } from '@/lib/next-auth-shim';
import { useAppStore } from '@/lib/store';

const POLL_INTERVAL_MS = 60_000;

interface AuthMeResponse {
  success: boolean;
  user?: {
    id: string;
    email?: string | null;
    username?: string | null;
    name?: string | null;
    image?: string | null;
    subscription_tier?: string | null;
    is_admin?: boolean;
    is_active?: boolean;
    default_risk_tolerance?: string | null;
    created_at?: string;
    last_login?: string | null;
  };
}

export function useAuthCheck(): void {
  const { status: sessionStatus, data: sessionData } = useSession();

  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);
  const setAuthChecked = useAppStore((s) => s.setAuthChecked);
  const apiKey = useAppStore((s) => s.apiKey);

  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const authChecked = useAppStore((s) => s.authChecked);

  // Proactive sync removed: useSession is derived from store (avoid circular loop)

  // Avoid duplicate polls overlapping
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const headers: Record<string, string> = {
          Accept: 'application/json',
        };
        // Attach bearer token if we have one (mobile-style flow)
        if (apiKey && typeof window !== 'undefined') {
          // Try localStorage first (web), fall back to store value
          const stored = localStorage.getItem('egx_api_key') || apiKey;
          if (stored) headers.Authorization = `Bearer ${stored}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
          headers,
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (cancelled) return;

        if (res.ok) {
          const data: AuthMeResponse = await res.json();
          if (data.success && data.user) {
            setUser({
              id: data.user.id,
              email: data.user.email || '',
              username: data.user.username || data.user.name || '',
              is_active: data.user.is_active ?? true,
              is_admin: data.user.is_admin ?? false,
              subscription_tier: data.user.subscription_tier || 'free',
              default_risk_tolerance: data.user.default_risk_tolerance || 'medium',
              created_at: data.user.created_at || new Date().toISOString(),
              last_login: data.user.last_login || new Date().toISOString(),
            });
            setAuthenticated(true);
            setAuthChecked(true);
            return;
          }
        }

        // Only treat explicit 401 as unauthenticated.
        // Transient errors (500, network, timeout) must NOT log the user out.
        if (res.status === 401) {
          // GRACE PERIOD: Retry once after 2s before logging the user out.
          // This fixes the "login prompt keeps appearing" complaint — a
          // transient 401 (e.g. during session refresh, DB blip, or cookie
          // not yet propagated) should NOT immediately log the user out.
          if (cancelled) return;
          await new Promise((r) => setTimeout(r, 2000));
          if (cancelled) return;

          try {
            const retryRes = await fetch('/api/auth/me', {
              method: 'GET',
              credentials: 'include',
              headers,
              cache: 'no-store',
            });
            if (cancelled) return;

            if (retryRes.ok) {
              const retryData: AuthMeResponse = await retryRes.json();
              if (retryData.success && retryData.user) {
                setUser({
                  id: retryData.user.id,
                  email: retryData.user.email || '',
                  username: retryData.user.username || retryData.user.name || '',
                  is_active: retryData.user.is_active ?? true,
                  is_admin: retryData.user.is_admin ?? false,
                  subscription_tier: retryData.user.subscription_tier || 'free',
                  default_risk_tolerance: retryData.user.default_risk_tolerance || 'medium',
                  created_at: retryData.user.created_at || new Date().toISOString(),
                  last_login: retryData.user.last_login || new Date().toISOString(),
                });
                setAuthenticated(true);
                setAuthChecked(true);
                return;
              }
            }
          } catch {
            // Retry failed — fall through to logout below
          }

          // Confirmed 401 after retry — now it's safe to log out
          if (!user) {
            setUser(null);
          }
          setAuthenticated(false);
          setAuthChecked(true);
        }
        // For 403/404/5xx: leave state untouched so the user stays logged in.
      } catch {
        if (!cancelled) {
          // Network/abort error: don't aggressively log the user out,
          // but DO mark auth as checked so the gate can show.
          setAuthChecked(true);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    // Initial check (skip if next-auth already says authenticated, the
    // SessionSync component handles that path). We still poll periodically.
    checkAuth();

    const interval = setInterval(() => {
      // Only poll when the tab is visible — avoids wasting requests
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        checkAuth();
      }
    }, POLL_INTERVAL_MS);

    const handleVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        checkAuth();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisible);
    }

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisible);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);
}
