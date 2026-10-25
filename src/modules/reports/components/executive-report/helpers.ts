/**
 * executive-report/helpers.ts
 * ===========================
 * Pure utility functions used by the ExecutiveReportView container + sub-cards.
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 *
 * Nothing here touches React state — safe to test in isolation.
 */

import type {
  ComputedStats,
  LivePredictionItem,
  PersonaStatsItem,
} from './types';

// RL-FIX-15: يختار التوقع الممثّل لمجموعة (ticker, entryDate) واحدة.
// أولوية الاختيار: balanced → أعلى score → أول صف.
export function pickRepresentative(group: LivePredictionItem[]): LivePredictionItem {
  if (group.length === 1) return group[0];
  const balanced = group.find((p) => p.persona === 'balanced');
  if (balanced) return balanced;
  return [...group].sort(
    (a, b) =>
      Number(b.confidence ?? b.maestroScore ?? 0) -
      Number(a.confidence ?? a.maestroScore ?? 0),
  )[0];
}

// RL-FIX-15: دالة حساب الإحصائيات من أي قائمة توقعات (قابلة لإعادة الاستخدام)
// بنستخدمها مرتين: مرة على uniqueStocks (للقياس العام)، ومرة على allPredictions
// (للقياس حسب الشخصية — statsByPersona).
export function computeStats(list: LivePredictionItem[]): ComputedStats {
  const closed = list.filter((p) => p.outcome === 'WIN' || p.outcome === 'LOSS');
  const wins = list.filter((p) => p.outcome === 'WIN');
  const losses = list.filter((p) => p.outcome === 'LOSS');
  const pending = list.filter((p) => p.outcome === 'PENDING');
  const expired = list.filter((p) => p.outcome === 'EXPIRED');

  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgWinPct =
    wins.length > 0
      ? wins.reduce((s, p) => s + Number(p.returnPct || 0), 0) / wins.length
      : 0;
  const avgLossPct =
    losses.length > 0
      ? losses.reduce((s, p) => s + Number(p.returnPct || 0), 0) / losses.length
      : 0;
  const grossWin = wins.reduce((s, p) => s + Math.abs(Number(p.returnPct || 0)), 0);
  const grossLoss = losses.reduce((s, p) => s + Math.abs(Number(p.returnPct || 0)), 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  const totalProfit = closed.reduce((s, p) => s + Number(p.returnPct || 0), 0);

  const byPersona = (
    ['gambler', 'balanced', 'conservative'] as const
  ).reduce((acc, personaId) => {
    const personaPreds = list.filter((p) => p.persona === personaId);
    const personaClosed = personaPreds.filter(
      (p) => p.outcome === 'WIN' || p.outcome === 'LOSS',
    );
    const personaWins = personaPreds.filter((p) => p.outcome === 'WIN');
    const personaLosses = personaPreds.filter((p) => p.outcome === 'LOSS');
    const pGrossWin = personaWins.reduce(
      (s, p) => s + Math.abs(Number(p.returnPct || 0)),
      0,
    );
    const pGrossLoss = personaLosses.reduce(
      (s, p) => s + Math.abs(Number(p.returnPct || 0)),
      0,
    );
    acc[personaId] = {
      total: personaPreds.length,
      wins: personaWins.length,
      losses: personaLosses.length,
      pending: personaPreds.filter((p) => p.outcome === 'PENDING').length,
      settled: personaClosed.length,
      winRate:
        personaClosed.length > 0
          ? (personaWins.length / personaClosed.length) * 100
          : 0,
      avgWinPct:
        personaWins.length > 0
          ? personaWins.reduce((s, p) => s + Number(p.returnPct || 0), 0) /
            personaWins.length
          : 0,
      avgLossPct:
        personaLosses.length > 0
          ? personaLosses.reduce((s, p) => s + Number(p.returnPct || 0), 0) /
            personaLosses.length
          : 0,
      profitFactor: pGrossLoss > 0 ? pGrossWin / pGrossLoss : pGrossWin > 0 ? 999 : 0,
      closedCount: personaClosed.length,
    } as PersonaStatsItem;
    return acc;
  }, {} as Record<'gambler' | 'balanced' | 'conservative', PersonaStatsItem>);

  return {
    total: list.length,
    wins: wins.length,
    losses: losses.length,
    pending: pending.length,
    expired: expired.length,
    settled: closed.length,
    winRate,
    avgWinPct,
    avgLossPct,
    profitFactor,
    totalProfit,
    closedCount: closed.length,
    statsByPersona: byPersona,
  };
}

// Helper used by MissedOppCard — class-string for a signal badge.
export function signalBadgeClass(signal: string): string {
  const s = (signal || '').toUpperCase();
  if (s === 'BUY' || s === 'STRONG_BUY') {
    return 'text-profit border-profit/20 bg-profit/10';
  }
  if (s === 'SELL' || s === 'STRONG_SELL') {
    return 'text-loss border-loss/20 bg-loss/10';
  }
  return 'text-foreground border-white/20 bg-white/5';
}
