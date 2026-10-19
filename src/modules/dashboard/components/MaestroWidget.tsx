'use client';

// ============================================================================
// MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
// ----------------------------------------------------------------------------
// This widget is DEPRECATED and no longer imported anywhere in the active
// UI tree (Phase 0 UNIFICATION-PHASE-0 already removed the import from
// DashboardView.tsx and from `src/modules/dashboard/index.ts`). The file is
// retained only for backward compatibility per Rule 4 (NO-DELETION).
//
// The previous implementation called `/api/maestro/overview` — that call has
// been commented out below. The component now renders nothing (returns null)
// so any accidental re-import will not produce a runtime maestro fetch.
// ============================================================================

import React, { useState, useEffect } from 'react';
import { Zap, TrendingUp, TrendingDown, Minus, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

interface MaestroOverview {
  totalStocks: number;
  lastAnalysis: string | null;
  marketRegime: 'bull' | 'bear' | 'range';
  regimeConfidence: number;
  recentSignals: number;
  avgScore: number;
}

const REGIME_CONFIG = {
  bull: { color: 'text-profit', bg: 'bg-success dark:bg-success/30', icon: TrendingUp, label: 'صاعد' },
  bear: { color: 'text-loss', bg: 'bg-loss dark:bg-loss/30', icon: TrendingDown, label: 'هابط' },
  range: { color: 'text-warning', bg: 'bg-warning dark:bg-warning/30', icon: Minus, label: 'متراوح' }
};

export function MaestroWidget() {
  // MAESTRO-DISABLED: widget is deprecated. Render nothing.
  // Original implementation called `/api/maestro/overview` — removed per
  // Rule 73 (SINGLE-DISPLAY-SOURCE) and Task PHASE-2-MAESTRO-KILL.
  // Use MarketPulseWidget / MarketSummary from the unified dashboard instead.
  return null;

  // ── Legacy implementation (kept commented for traceability) ──────────────
  // const [loading, setLoading] = useState(true);
  // const [overview, setOverview] = useState<MaestroOverview | null>(null);
  // const [refreshing, setRefreshing] = useState(false);
  //
  // const fetchData = async () => {
  //   try {
  //     // MAESTRO-DISABLED: original call was:
  //     //   const res = await fetch(`/api/maestro/overview?market=${encodeURIComponent(useAppStore.getState().currentMarket)}`);
  //     return;
  //   } catch (e) {
  //     console.error('Error fetching Maestro overview:', e);
  //   } finally {
  //     setLoading(false);
  //     setRefreshing(false);
  //   }
  // };
  //
  // useEffect(() => { fetchData(); }, []);
  // const handleRefresh = () => { setRefreshing(true); fetchData(); };
  // if (loading) { /* ...skeleton... */ }
  // if (!overview) { return null; }
  // /* ...render... */
  // unreachable code below — TypeScript needs an infinite loop guard removed
  void useState; void useEffect; void useAppStore; void cn; void Card; void CardContent;
  void CardHeader; void CardTitle; void CardDescription; void Button; void Badge; void Progress;
  void Zap; void TrendingUp; void TrendingDown; void Minus; void ExternalLink; void Loader2; void RefreshCw;
  void REGIME_CONFIG;

  // ── Legacy JSX render (kept commented for traceability) ──────────────────
  // const regimeConfig = REGIME_CONFIG[overview.marketRegime] || REGIME_CONFIG.range;
  // const RegimeIcon = regimeConfig.icon;
  //
  // return (
  //   <Card className="overflow-hidden hover:shadow-md transition-shadow">
  //     <CardHeader className="pb-2">
  //       ...
  //       <a href="/maestro"> {/* legacy link to removed /maestro page */}
  //       ...
  //     </CardHeader>
  //     <CardContent>...</CardContent>
  //   </Card>
  // );
}
