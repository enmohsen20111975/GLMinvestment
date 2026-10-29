'use client';

/**
 * hooks/usePortfolioData.ts
 * ============================================================================
 * F-Strangler-Portfolio: Strangler Pattern extraction from EnhancedPortfolioView
 * ----------------------------------------------------------------------------
 * قبل كده: EnhancedPortfolioView.tsx (3,376 LOC) كان فيه 6 useState + 2 useEffect
 * + custom loadAssets callback + fallback fetch logic + portfoliosMap session-
 * based fetch + useVisibilityAwarePolling. كل ده inline في الـ widget.
 *
 * دلوقتي: الـ data logic كله here. الـ widget (AssetsTab) بقا render-only.
 *   const { assets, obligations, netWorthData, loading, refreshing,
 *          portfoliosMap, goldPrices, refetch } = usePortfolioData();
 *
 * الـ hook بيستخدم useApiQuery (TanStack Query + canonical apiGet) لـ:
 *   - /api/finance/calculate-values (primary — assets + net-worth + gold + FX)
 *   - /api/finance/assets (fallback — only when calculate-values fails)
 *   - /api/finance/obligations?status=active
 *   - /api/auth/session → /api/portfolio/accounts?user_id=X (portfoliosMap)
 *
 * Side effects preserved:
 *   - `setFxRates(usd)` into the global Zustand store (P37-PHASE-2A)
 *   - `usePortfolioStore.updateFromCalcValues(data)` (P30 TASK 8) — so
 *     MasterPortfolioSummary + RealReturnPanel auto-update from the same
 *     fetch (no separate /api/portfolio/master call needed here).
 *
 * Polling: silent refetch every 30s when the tab is visible (via
 * useVisibilityAwarePolling) — no skeleton flicker on the polling path.
 * ============================================================================
 */

import { useCallback, useEffect, useState } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';
import { useAppStore } from '@/lib/store';
import { usePortfolioStore } from '@/lib/portfolio-store';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import { useTranslation } from '@/lib/i18n-context';
import { toast } from 'sonner';
import type { PortfolioAsset, FinancialObligation } from '@/types';

// ============================================================
// Types
// ============================================================

/** Portfolio asset row (loose — backend may attach extra fields). */
export type PortfolioAssetRow = PortfolioAsset & Record<string, unknown>;

/** Backend-provided net-worth math (P34) — comes straight from calculate-values. */
export interface NetWorthData {
  gross: number;
  debts: number;
  net: number;
  monthlyYield: number;
  annualYield: number;
}

/** Gold prices per karat (24/21/18) — also comes from calculate-values. */
export interface GoldPrices {
  '24k': number;
  '21k': number;
  '18k': number;
}

/** Map of portfolio id → { name, color } — used for the MultiPortfolioSelector badges. */
export type PortfoliosMap = Record<string, { name: string; color: string }>;

// Loose API response shapes (backend uses snake_case + optional fields + extra
// debug keys we don't care about — index-signature `[k: string]: unknown`
// absorbs them so we never lie to TypeScript).
interface CalcValuesResp {
  success?: boolean;
  items?: PortfolioAssetRow[];
  assets?: PortfolioAssetRow[];
  gold_prices?: GoldPrices | null;
  exchange_rates?: { USD?: number | string };
  gross_assets_egp?: number;
  total_current_value?: number;
  total_obligations_egp?: number;
  net_worth_egp?: number;
  smart_math?: { monthly_yield_egp?: number; annual_yield_egp?: number };
  [k: string]: unknown;
}

interface ObligationsResp {
  items?: FinancialObligation[];
  [k: string]: unknown;
}

interface AssetsFallbackResp {
  items?: PortfolioAssetRow[];
  assets?: PortfolioAssetRow[];
  [k: string]: unknown;
}

interface SessionResp {
  user?: { id?: string };
  [k: string]: unknown;
}

interface PortfolioAccountsResp {
  success?: boolean;
  portfolios?: Array<{ id: string | number; name?: string; color?: string }>;
  [k: string]: unknown;
}

// ============================================================
// Hook result
// ============================================================

export interface UsePortfolioDataResult {
  assets: PortfolioAssetRow[];
  obligations: FinancialObligation[];
  netWorthData: NetWorthData | null;
  loading: boolean;
  refreshing: boolean;
  portfoliosMap: PortfoliosMap;
  goldPrices: GoldPrices | null;
  /** Re-fetch all data (used by add/edit/delete handlers + polling). */
  refetch: () => Promise<void>;
}

// ============================================================
// Hook
// ============================================================

/**
 * usePortfolioData — owns all portfolio data-fetching logic for EnhancedPortfolioView.
 *
 * @param selectedPortfolioId - 'master' (default, no portfolio_id query param)
 *   or a specific portfolio id to scope the calculate-values + assets-fallback
 *   fetches (matches the original `?portfolio_id=X` query string).
 *
 * @example
 * const { assets, obligations, netWorthData, loading, refreshing, portfoliosMap, refetch } = usePortfolioData(selectedPortfolioId);
 */
export function usePortfolioData(
  selectedPortfolioId: number | 'master' = 'master'
): UsePortfolioDataResult {
  const t = useTranslation();
  const setFxRates = useAppStore((s) => s.setFxRates);

  // ── Local derived state (assets + obligations + netWorth + gold + pmap) ──
  // The raw query data lives in TanStack Query cache; these states are derived
  // views (after side effects) so the widget can render synchronously.
  const [assets, setAssets] = useState<PortfolioAssetRow[]>([]);
  const [obligations, setObligations] = useState<FinancialObligation[]>([]);
  const [netWorthData, setNetWorthData] = useState<NetWorthData | null>(null);
  const [goldPrices, setGoldPrices] = useState<GoldPrices | null>(null);
  const [portfoliosMap, setPortfoliosMap] = useState<PortfoliosMap>({});
  // P30 TASK 7: only show the error toast on the very first failure, not on
  // every 30s silent poll. This flag flips to true after the first toast and
  // never resets (component lifetime).
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);

  // ── Portfolio-id query params (matches original `?portfolio_id=X` shape) ──
  const portfolioParams =
    selectedPortfolioId && selectedPortfolioId !== 'master'
      ? { portfolio_id: String(selectedPortfolioId) }
      : undefined;

  // ── Session fetch (for user_id — needed before /api/portfolio/accounts) ──
  // F1.3 — cleanup 'default' legacy: use authenticated session, not user_id=default.
  // (the /api/portfolio/accounts route now requires auth — F1.2 fix)
  const sessionQ = useApiQuery<SessionResp>('/api/auth/session', {
    queryOptions: { staleTime: 5 * 60 * 1000 }, // 5 min — session rarely changes
  }) as any;
  const userId = sessionQ.data?.user?.id;

  // ── Portfolio accounts (portfoliosMap — depends on session.user.id) ──
  const accountsQ = useApiQuery<PortfolioAccountsResp>('/api/portfolio/accounts', {
    params: userId ? { user_id: userId } : undefined,
    queryOptions: { enabled: !!userId },
  }) as any;

  // ── Primary data: calculate-values + obligations ──
  // B-1 FIX: Only fetch assets + obligations. Crypto is ALREADY returned by
  // /api/finance/calculate-values (FX-converted to EGP). Fetching
  // /api/crypto/portfolio again here used to (1) double-count crypto and
  // (2) treat USD prices as EGP — both inflating the total.
  const calcQ = useApiQuery<CalcValuesResp>('/api/finance/calculate-values', {
    params: portfolioParams,
  }) as any;
  const obligationsQ = useApiQuery<ObligationsResp>('/api/finance/obligations', {
    params: { status: 'active' },
  }) as any;

  // ── Fallback: /api/finance/assets only fires if calculate-values fails ──
  // Preserves the original fallback branch (legacy API support).
  const calcFailed = calcQ.isSuccess && !calcQ.data?.success;
  const fallbackAssetsQ = useApiQuery<AssetsFallbackResp>('/api/finance/assets', {
    params: portfolioParams,
    queryOptions: { enabled: calcFailed },
  }) as any;

  // ── Build portfoliosMap from accounts ──
  useEffect(() => {
    const d = accountsQ.data;
    if (!d) return;
    if (d.success && Array.isArray(d.portfolios)) {
      const pmap: PortfoliosMap = {};
      for (const p of d.portfolios) {
        pmap[String(p.id)] = { name: p.name || '', color: p.color || 'blue' };
      }
      setPortfoliosMap(pmap);
    }
  }, [accountsQ.data]);

  // ── Process calculate-values response (assets + netWorthData + side effects) ──
  useEffect(() => {
    const d = calcQ.data;
    if (!d || !d.success) return;

    const allAssets: PortfolioAssetRow[] = [...(d.items || d.assets || [])];
    setAssets(allAssets);
    setGoldPrices(d.gold_prices || null);

    // P37-PHASE-2A: Refresh the global USD→EGP FX rate so the header
    // display-currency toggle (EGP/USD/SAR) converts totals correctly.
    // SAR is derived (usdRate * 3.75 fixed peg) inside setFxRates.
    try {
      const usd = Number(d.exchange_rates?.USD);
      if (Number.isFinite(usd) && usd > 0) setFxRates(usd);
    } catch { /* silent — fall back to default 48.5 */ }

    // B-1: Backend P34 net-worth math — no local recomputation.
    setNetWorthData({
      gross: d.gross_assets_egp || d.total_current_value || 0,
      debts: d.total_obligations_egp || 0,
      net: d.net_worth_egp || 0,
      monthlyYield: d.smart_math?.monthly_yield_egp || 0,
      annualYield: d.smart_math?.annual_yield_egp || 0,
    });

    // P30 TASK 8: Push to unified store so MasterPortfolioSummary +
    // RealReturnPanel auto-update from the same fetch.
    try {
      usePortfolioStore.getState().updateFromCalcValues(d);
    } catch { /* silent — store is best-effort */ }
  }, [calcQ.data, setFxRates]);

  // ── Fallback branch: when calculate-values fails, fetch /api/finance/assets ──
  useEffect(() => {
    if (!calcFailed) return;
    const d = fallbackAssetsQ.data;
    if (!d) return;
    const allAssets: PortfolioAssetRow[] = [...(d.items || d.assets || [])];
    setAssets(allAssets);
    setNetWorthData(null); // legacy API doesn't return net-worth math
  }, [calcFailed, fallbackAssetsQ.data]);

  // ── Obligations ──
  useEffect(() => {
    const d = obligationsQ.data;
    if (!d) return;
    setObligations(d.items || []);
  }, [obligationsQ.data]);

  // ── Initial-error toast (only on first failure, not on silent polls) ──
  // Mirrors the original `if (!silent) toast.error(...)` behavior — the
  // silent polling path swallows errors so the UI doesn't flicker every 30s.
  useEffect(() => {
    if (calcQ.isError && !initialLoadFailed) {
      setInitialLoadFailed(true);
      toast.error(t('portfolio.toast.loadAssetsFailed'));
    }
  }, [calcQ.isError, initialLoadFailed, t]);

  // ── Loading / refreshing derived from TanStack Query state ──
  // loading:   true on the very first fetch (no data cached yet).
  // refreshing: true on any subsequent fetch (data may be stale but present).
  // This mirrors the original `setLoading(true)` (initial) vs
  // `setRefreshing(true)` (silent poll) distinction.
  const loading =
    (!calcQ.data && calcQ.isLoading) ||
    (!obligationsQ.data && obligationsQ.isLoading);
  const refreshing =
    (calcQ.isFetching || obligationsQ.isFetching || accountsQ.isFetching) &&
    !loading;

  // ── Refetch: re-run all queries in parallel (used by add/edit/delete + polling) ──
  const refetch = useCallback(async () => {
    await Promise.all([
      calcQ.refetch(),
      obligationsQ.refetch(),
      sessionQ.refetch(),
      accountsQ.refetch(),
    ]);
  }, [calcQ, obligationsQ, sessionQ, accountsQ]);

  // ── Polling: silent refresh every 30s, pause when tab is hidden ──
  // P30 TASK 7 / P37-PHASE-2B-4A: Silent background update — no skeleton on
  // polls, only on the initial load. Stops entirely when the tab is hidden
  // (saves CPU/battery) and fires immediately when the tab becomes visible.
  useVisibilityAwarePolling(
    () => { void refetch(); },
    30_000,
    [selectedPortfolioId]
  );

  return {
    assets,
    obligations,
    netWorthData,
    loading,
    refreshing,
    portfoliosMap,
    goldPrices,
    refetch,
  };
}
