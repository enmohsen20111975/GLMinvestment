import { NextRequest, NextResponse } from 'next/server';
import { readRadarCache } from '@/modules/radar/lib/radar-cache';
import { getStocksDb } from '@/lib/egx-db';

export const dynamic = 'force-dynamic';

interface WhaleInfo {
  net_flow_egp: number | null;
  whale_present: boolean | null;
  flow_strength: string | null;
  buy_pct?: number | null;
  sell_pct?: number | null;
}

interface MarketRegime {
  regime: string | null;
  change_pct: number | null;
  is_bear?: boolean | null;
  is_bull?: boolean | null;
}

interface EntryDefense {
  entry_level: number | null;
  defense_level: number | null;
  resistance_level?: number | null;
}

interface RadarStock {
  ticker: string;
  name?: string | null;
  sector?: string | number | null;
  current_price?: number | null;
  change_percent?: number | null;
  whale: WhaleInfo;
  market_regime: MarketRegime;
  phase: string;
  phase_reason?: string | null;
  entry_defense: EntryDefense;
  reason: string | null;
  liquidity_bucket?: string | null;
  liquidity_bucket_ar?: string | null;
  net_flow_5d?: number | null;
  volume?: number | null;
  // FRONTEND-2 Phase 1: expose hidden cache fields for the correction phase column
  correction_status?: string | null;
  drop_from_peak?: number | null;
  accumulation?: string | null;
  expected?: string | null;
  roc_10d?: number | null;
}

interface RadarResponse {
  success: boolean;
  market: string;
  market_regime: MarketRegime | null;
  scanned_count?: number;
  phases_breakdown?: Record<string, number>;
  stocks: RadarStock[];
  error?: string | null;
  message?: string | null;
}

function normalizeMarketCode(market?: string | null): string {
  const m = (market || 'EGX').trim().toUpperCase();
  return m.replace(/[^A-Z0-9_-]/g, '') || 'EGX';
}

function flowStrength(netFlow: number | null | undefined): string | null {
  if (netFlow == null || !Number.isFinite(Number(netFlow))) return null;
  const abs = Math.abs(Number(netFlow));
  if (abs >= 10_000_000) return 'قوي جداً';
  if (abs >= 1_000_000) return 'قوي';
  if (abs >= 100_000) return 'متوسط';
  if (abs > 0) return 'ضعيف';
  return 'بدون';
}

/**
 * buildSupportResistanceMap — ALPHA-UX-FIX-8: يجيب support/resistance من stocks.db
 * لكل سهم، عشان الـ defense/resistance columns في الرادار تتبقى عاملة (مش "—")
 * حتى لو الـ radar cache مفيهومش stop_loss/target_price.
 */
function buildSupportResistanceMap(): Record<string, { support: number | null; resistance: number | null }> {
  const map: Record<string, { support: number | null; resistance: number | null }> = {};
  try {
    const db = getStocksDb();
    const rows = db.prepare(
      'SELECT ticker, support, resistance FROM stocks WHERE support IS NOT NULL OR resistance IS NOT NULL'
    ).all() as Array<{ ticker: string; support: number | null; resistance: number | null }>;
    for (const r of rows) {
      if (r.ticker) map[r.ticker.toUpperCase()] = {
        support: r.support != null ? Number(r.support) : null,
        resistance: r.resistance != null ? Number(r.resistance) : null,
      };
    }
  } catch { /* stocks.db unavailable → empty map → columns stay "—" (honest) */ }
  return map;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const market = normalizeMarketCode(url.searchParams.get('market'));

    const cache = readRadarCache(market);
    if (!cache || !cache.data) {
      const regime: MarketRegime = { regime: 'غير معروفة', change_pct: null, is_bear: false, is_bull: false };
      const response: RadarResponse = {
        success: true,
        market,
        market_regime: regime,
        scanned_count: 0,
        stocks: [],
        message: 'لا توجد بيانات رادار مخزنة لهذا السوق بعد',
      };
      return NextResponse.json(response);
    }

    const data: any = cache.data;
    const rawRegime = data.market_regime ?? {};
    const marketRegime: MarketRegime = {
      regime: rawRegime.regime ?? rawRegime.effective_regime ?? 'غير معروفة',
      change_pct: rawRegime.index_daily_change_pct ?? null,
      is_bear: rawRegime.regime === 'DEFENSIVE' || rawRegime.effective_regime === 'DEFENSIVE',
      is_bull: rawRegime.regime === 'AGGRESSIVE' || rawRegime.effective_regime === 'AGGRESSIVE',
    };

    const rawStocks: any[] = [
      ...(data.quiet_list ?? []),
      ...(data.pre_surge_list ?? []),
      ...(data.explosive_list ?? []),
      ...(data.early_break_list ?? []),
      ...(data.distribution_list ?? []),
      ...(data.under_microscope ?? []),
      ...(data.stocks ?? []),
    ].filter((s, i, arr) =>
      // deduplicate by ticker
      i === arr.findIndex(x => (x.ticker || x.symbol) === (s.ticker || s.symbol))
    );
    // ALPHA-UX-FIX-8: support/resistance map من stocks.db (fallback لـ defense/resistance)
    const srMap = buildSupportResistanceMap();
    const stocks: RadarStock[] = rawStocks.map((s) => {
      const netFlow = s.net_flow_egp ?? s.net_flow ?? null;
      const whale: WhaleInfo = {
        net_flow_egp: netFlow,
        whale_present: netFlow != null && Math.abs(Number(netFlow)) > 0,
        flow_strength: flowStrength(netFlow),
        buy_pct: s.buy_pct ?? null,
        sell_pct: s.sell_pct ?? null,
      };

      const phase: string = s.path ?? s.life_cycle ?? s.pattern ?? 'غير معروفة';
      const phaseReason: string | null = s.reason ?? s.quiet_details?.signals_met?.join(' ، ') ?? null;

      // ISSUE-3 FIX: removed fabricated entry*0.97 / entry+1.5*risk fallback.
      // Only return real values from cache or stocks.db. NULL if unavailable.
      const _srSupport = srMap[(s.ticker || '').toUpperCase()]?.support ?? null;
      const _srResistance = srMap[(s.ticker || '').toUpperCase()]?.resistance ?? null;
      const entryDefense: EntryDefense = {
        entry_level: s.entry_price ?? s.current_price ?? null,
        defense_level: s.stop_loss ?? _srSupport ?? null,  // no fabrication
        resistance_level: s.target_price ?? _srResistance ?? null,  // no fabrication
      };

      return {
        ticker: s.ticker ?? '',
        name: s.name ?? null,
        sector: s.sector ?? null,
        current_price: s.current_price ?? s.live_price ?? null,
        change_percent: s.change_percent ?? s.live_change_percent ?? s.change_1d ?? null,
        whale,
        market_regime: marketRegime,
        phase,
        phase_reason: phaseReason,
        entry_defense: entryDefense,
        reason: s.reason ?? null,
        liquidity_bucket: s.liquidity_bucket ?? null,
        liquidity_bucket_ar: s.liquidity_bucket_ar ?? null,
        net_flow_5d: netFlow,
        volume: s.volume ?? s.avg_volume_20d ?? s.avg_volume_10d ?? null,
        // FRONTEND-2 Phase 1: surface hidden cache fields for the correction phase column
        correction_status: s.correction_status ?? null,
        drop_from_peak: s.drop_from_peak ?? null,
        accumulation: s.accumulation ?? null,
        expected: s.expected ?? null,
        roc_10d: s.roc_10d ?? null,
      };
    });

    const response: RadarResponse = {
      success: true,
      market,
      market_regime: marketRegime,
      scanned_count: data.total_scanned ?? data.scanned_count ?? stocks.length,
      phases_breakdown: data.phases_breakdown ?? null,
      stocks,
      error: null,
      message: null,
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error('[api:v2:liquidity-radar]', e);
    return NextResponse.json({
      success: false,
      market: 'EGX',
      market_regime: null,
      stocks: [],
      error: 'internal_error',
    }, { status: 500 });
  }
}
