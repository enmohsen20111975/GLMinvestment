/**
 * query-client.ts — F2.1 (TanStack Query setup)
 * ====================================================================
 * Centralized QueryClient configuration for the whole app.
 *
 * Design decisions:
 *   - staleTime: 60s — data stays fresh for 1 minute (was 30s in Providers.tsx).
 *     Most market data updates every 10s via WebSocket (LiveMonitor), so
 *     React Query doesn't need to refetch that often. 60s balances freshness
 *     with backend load.
 *   - gcTime: 5 min — unused query data stays in cache for 5 minutes (default
 *     is 5 min, but we make it explicit for documentation purposes).
 *   - retry: 2 — retry failed queries twice (default is 3, but 2 is enough
 *     for our API which is mostly fast Python backend).
 *   - refetchOnWindowFocus: false — don't refetch when user switches tabs.
 *     The app uses polling + WebSocket for live data, so focus refetch is
 *     redundant and wastes backend resources.
 *
 * Usage:
 *   import { queryClient } from '@/lib/query-client';
 *   // In providers:
 *   <QueryClientProvider client={queryClient}>
 *
 * Rule 20 (Python=Brain): this is config only — no business logic.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // F2.1: 60s stale — data stays fresh for 1 minute.
      // Market data updates via WebSocket (LiveMonitor), so this is fine.
      staleTime: 60_000,
      // F2.1: 5 min garbage collection — unused data stays cached for 5 min.
      gcTime: 5 * 60_000,
      // F2.1: retry twice on failure (was 1 in Providers.tsx — too aggressive).
      retry: 2,
      // F2.1: don't refetch on window focus — we have polling + WebSocket.
      refetchOnWindowFocus: false,
      // F2.1: don't refetch on reconnect if data is still fresh.
      refetchOnReconnect: 'always',
      // F2.1: structuralSharing enabled by default — efficient updates.
      // (keeps referential equality for unchanged data)
    },
    mutations: {
      // F2.1: retry mutations once (network blips happen on mobile).
      retry: 1,
    },
  },
});
