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
  // ─── B3 (Task 2-a): new additive contract fields ──────────────────
  // Normalized classification — never fabricated. Consumers should treat
  // 'unclassified' / 'INSUFFICIENT_DATA' / 'DATA_INVALID' as "no signal"
  // (do NOT display as a trade opportunity, but also do NOT display as a
  // dead trap — they simply have no actionable classification).
  classification?: string | null;
  data_quality?: string | null;
  data_quality_status?: 'OK' | 'STALE' | 'INVALID' | 'UNAVAILABLE' | null;
  scan_timestamp?: string | null;
  reasons?: string[] | null;
  sanity_status?: string | null;
}

interface RadarSummary {
  source_count: number;
  scanned_count: number;
  valid_data_count: number;
  classified_count: number;
  unclassified_count: number;
  data_error_count: number;
  scan_timestamp: string | null;
}

interface RadarResponse {
  success: boolean;
  market: string;
  market_regime: MarketRegime | null;
  scanned_count?: number;
  source_count?: number;       // B3: source list size (no vanishing check)
  summary?: RadarSummary | null; // B3: full summary block
  phases_breakdown?: Record<string, number>;
  stocks: RadarStock[];
  results?: RadarStock[];       // B3: full scanned set (every ticker)
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
        source_count: 0,
        summary: null,
        results: [],
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

    // ─── B3 (Task 2-a): build the full scanned set from `results` ────────
    // The cache JSON now contains a NEW `results` array with EVERY scanned
    // ticker (including ones that didn't meet any classification criteria
    // or had B1 DATA_INVALID prices). The legacy list keys (quiet_list,
    // pre_surge_list, ...) are preserved as subsets — we still read them
    // for backward compatibility with Alpha's in-flight UI work, but we
    // ALSO read `results` so the UI can show the full picture (no vanishing).
    const fullResultsRaw: any[] = Array.isArray(data.results) ? data.results : [];

    // Legacy union of list keys — the stocks the UI previously saw.
    const legacyListUnion: any[] = [
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

    // Build the canonical full set: prefer `results` entries; fall back to
    // legacy list entries for tickers not in `results` (defensive — should
    // be a no-op once maker_radar.py emits `results`).
    const seenTickers = new Set<string>();
    const rawStocks: any[] = [];
    for (const r of fullResultsRaw) {
      const t = (r?.ticker || r?.symbol || '').toString().toUpperCase();
      if (!t) continue;
      if (seenTickers.has(t)) continue;
      seenTickers.add(t);
      rawStocks.push(r);
    }
    for (const s of legacyListUnion) {
      const t = (s?.ticker || s?.symbol || '').toString().toUpperCase();
      if (!t || seenTickers.has(t)) continue;
      seenTickers.add(t);
      rawStocks.push(s);
    }

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

      // B3: classification drives the `phase` display. The legacy `path`
      // value is preserved as a fallback. We do NOT fabricate a phase for
      // stocks whose classification is 'unclassified' / 'INSUFFICIENT_DATA'
      // / 'DATA_INVALID' — those should surface as "—" / "no signal"
      // rather than be misclassified as "dead" or "accumulation".
      const classification: string | null = s.classification ?? null;
      const phase: string = classification
        ?? s.path
        ?? s.life_cycle
        ?? s.pattern
        ?? 'غير معروفة';
      const phaseReason: string | null =
        s.reason
        ?? (Array.isArray(s.reasons) && s.reasons.length ? s.reasons.join(' | ') : null)
        ?? s.quiet_details?.signals_met?.join(' ، ')
        ?? null;

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
        name: s.name ?? s.company ?? null,
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
        // ─── B3: new additive fields ──────────────────────────────────
        classification: classification,
        data_quality: s.data_quality ?? null,
        data_quality_status: s.data_quality_status ?? null,
        scan_timestamp: s.scan_timestamp ?? null,
        reasons: Array.isArray(s.reasons) ? s.reasons : null,
        sanity_status: s.sanity_status ?? null,
        // ─── (ALPHA-RADAR-INTELLIGENCE — owner directive 2026-10-28): 4 طبقات ذكاء ──
        // price_action + participant_flow + continuation + data_quality من برافو.
        // كلها null-safe (Rule 27: null = null).
        price_action: s.price_action ?? null,
        price_action_evidence: s.price_action_evidence ?? null,
        participant_flow_assessment: s.participant_flow_assessment ?? null,
        participant_evidence_level: s.participant_evidence_level ?? null,
        participant_evidence: s.participant_evidence ?? null,
        continuation_assessment: s.continuation_assessment ?? null,
        data_quality_reasons: Array.isArray(s.data_quality_reasons) ? s.data_quality_reasons : null,
        classification_timestamp: s.classification_timestamp ?? null,
        // enrichment fields (from scanner)
        volume_surge: s.volume_surge ?? null,
        rsi_scanner: s.rsi_scanner ?? null,
        value_traded_official: s.value_traded_official ?? null,
        relative_volume_10d_official: s.relative_volume_10d_official ?? null,
        movement_type: s.movement_type ?? null,
        movement_desc: s.movement_desc ?? null,
      };
    });

    // B3: build the summary block. Use the cache's `summary` if present;
    // otherwise derive a minimal one from `stocks` (defensive — older
    // cache files won't have `summary`).
    const cacheSummary: any = data.summary ?? null;
    const summary: RadarSummary | null = cacheSummary
      ? {
          source_count: Number(cacheSummary.source_count ?? stocks.length),
          scanned_count: Number(cacheSummary.scanned_count ?? stocks.length),
          valid_data_count: Number(cacheSummary.valid_data_count ?? 0),
          classified_count: Number(cacheSummary.classified_count ?? 0),
          unclassified_count: Number(cacheSummary.unclassified_count ?? 0),
          data_error_count: Number(cacheSummary.data_error_count ?? 0),
          scan_timestamp: cacheSummary.scan_timestamp ?? null,
        }
      : null;

    const response: RadarResponse = {
      success: true,
      market,
      market_regime: marketRegime,
      // B3: prefer summary.scanned_count (all scanned tickers, no filter)
      // over the legacy data.total_scanned (which is price-filtered and
      // would under-report the actual scan size).
      scanned_count: cacheSummary?.scanned_count ?? data.total_scanned ?? data.scanned_count ?? stocks.length,
      source_count: cacheSummary?.source_count ?? data.total_scanned ?? stocks.length,
      summary,
      phases_breakdown: data.phases_breakdown ?? null,
      stocks,
      // B3: expose the full scanned set as `results` too (every ticker).
      results: stocks,
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
