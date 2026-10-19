/**
 * stock-publish-text.ts — server-safe module for stock publish text generation
 * ============================================================================
 *
 * Extracted from StockPublisher.tsx so the same `generatePublishText` logic can
 * be reused by:
 * - The StockPublisher client component (visual card + share buttons)
 * - The /api/telegram/publish-stock route (sends formatted Arabic text directly
 * to the Telegram channel via the bot)
 *
 * This file MUST stay server-safe (no JSX, no 'use client', no DOM access) so
 * it can be imported from Next.js API routes.
 */

import { withOfficialLinks } from '@/modules/publishing/lib/official-links';
// CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
// Single source of truth for signal classification + Arabic label.
// Local Recommendation type was 5-level (BUY/STRONG_BUY/SELL/HOLD/INSTITUTIONAL_BUY);
// canonical-signal.ts provides the full 7-level taxonomy + signalAr() helper.
import {
 signalAr as canonicalSignalAr,
 type SignalType,
} from '@/lib/canonical-signal';

// ============================================================================
// Types
// ============================================================================

// Recommendation now aligns with canonical SignalType (7 levels) while
// preserving legacy INSTITUTIONAL_BUY for backward compatibility with
// existing callers (canonicalSignalAr() maps it → 'شراء قوي').
export type Recommendation =
 | SignalType
 | 'INSTITUTIONAL_BUY';

export type MarketRegime = 'DEFENSIVE' | 'NORMAL' | 'AGGRESSIVE';

export interface StockPublishData {
 // Basic info
 ticker: string;
 nameAr?: string;
 nameEn?: string;
 sector?: string;
 currentPrice: number;
 previousClose?: number;
 changePct?: number;

 // Recommendation
 recommendation?: Recommendation;
 recommendationAr?: string;
 confidence?: number; // 0-100
 reason?: string;

 // Trading plan
 entryPrice?: number;
 entryZoneLow?: number;
 entryZoneHigh?: number;
 targetPrice1?: number;
 targetPrice2?: number;
 stopLoss?: number;
 riskReward?: number;
 positionSize?: number; // percentage of portfolio

 // Signal strength
 signalCount?: number;
 maxSignals?: number;
 path?: string;

 // Liquidity
 buyPressure?: number; // 0-100
 sellPressure?: number; // 0-100
 netFlow?: number; // EGP
 volumeRatio?: number; // 10d vs 20d
 turnover?: number;

 // Technical
 rsi?: number;
 sma20?: number;
 sma50?: number;
 sma200?: number;
 atr?: number;

 // Fundamentals (optional)
 peRatio?: number;
 pbRatio?: number;
 roe?: number;
 marketCap?: number;

 // Analysis text
 analysisSummary?: string;
 newsImpact?: string;

 // Market context
 market?: 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'CRYPTO' | 'GOLD';
 marketRegime?: MarketRegime;

 // ── Owner directive (2026-10-05): "هذا هو المكون العام للنشر والصور" ──
 // Technical explanation (from technical_explainer.py)
 technicalExplanation?: {
 summary?: string;
 candlestick?: string;
 smc?: string;
 volume?: string;
 patterns?: string;
 proofs?: string[];
 riskNote?: string;
 fullText?: string;
 compactText?: string;
 };

 // SMC data (for expert display)
 smcData?: {
 score?: number;
 bias_ar?: string;
 nearest_ob?: { type: string; price: number; quality: string };
 nearest_fvg?: { type: string; top: number; bottom: number };
 liquidity_sweeps?: Array<{ type: string; price: number }>;
 };

 // Candlestick patterns
 candlestickPatterns?: Array<{ name: string; signal: string; name_ar: string }>;

 // Support / Resistance levels (real, not computed)
 supportLevels?: Array<{ price: number; strength: string }>;
 resistanceLevels?: Array<{ price: number; strength: string }>;

 // Liquidity footprint (POC, VAH, VAL)
 liquidity?: {
 poc_price?: number;
 vah_price?: number;
 val_price?: number;
 buy_volume?: number;
 sell_volume?: number;
 delta_volume?: number;
 buy_sell_ratio?: number;
 accumulation_label?: string;
 };
}

// ============================================================================
// Constants — server-safe subset of RECOMMENDATION_META (no JSX)
// CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
// Migrated from 5-level (STRONG_BUY/BUY/INSTITUTIONAL_BUY/HOLD/SELL) to the
// full canonical 7-level taxonomy (STRONG_BUY/BUY/ACCUMULATE/HOLD/REDUCE/
// SELL/STRONG_SELL). Arabic labels are now sourced from canonicalSignalAr()
// to guarantee consistency across screens. Emojis stay here as presentation.
// ============================================================================

// Back-compat: keep RECOMMENDATION_TEXT export for callers that read .ar/.emoji
// directly (e.g. StockPublisher.tsx). Now sourced from canonicalSignalAr().
export const RECOMMENDATION_TEXT: Record<
 Recommendation,
 { ar: string; emoji: string }
> = {
 STRONG_BUY: { ar: canonicalSignalAr('STRONG_BUY'), emoji: '🚀' },
 BUY: { ar: canonicalSignalAr('BUY'), emoji: '✅' },
 ACCUMULATE: { ar: canonicalSignalAr('ACCUMULATE'), emoji: '📦' },
 HOLD: { ar: canonicalSignalAr('HOLD'), emoji: '⏸️' },
 REDUCE: { ar: canonicalSignalAr('REDUCE'), emoji: '🔻' },
 SELL: { ar: canonicalSignalAr('SELL'), emoji: '🔻' },
 STRONG_SELL: { ar: canonicalSignalAr('STRONG_SELL'), emoji: '🔻' },
 INSTITUTIONAL_BUY: { ar: canonicalSignalAr('INSTITUTIONAL_BUY'), emoji: '🏛️' },
};

export const MARKET_REGIME_AR: Record<MarketRegime, string> = {
 DEFENSIVE: '🛡️ دفاعي',
 NORMAL: '⚖️ عادي',
 AGGRESSIVE: '🚀 هجومي',
};

// ============================================================================
// generatePublishText — format the data as Arabic text for Telegram/WhatsApp
// ============================================================================

export function generatePublishText(data: StockPublishData): string {
 const lines: string[] = [];

 // Header
 lines.push(
 `📊 تحليل سهم: ${data.ticker}${data.nameAr ? ` — ${data.nameAr}` : ''}`
 );
 if (data.nameEn) {
 lines.push(`📊 Stock Analysis: ${data.ticker} — ${data.nameEn}`);
 }
 if (data.sector) {
 lines.push(`🏷️ القطاع: ${data.sector}`);
 }
 lines.push('');

 // Recommendation
 if (data.recommendation) {
 const meta = RECOMMENDATION_TEXT[data.recommendation];
 const recLabel = `${meta.emoji} ${meta.ar}`;
 const confidenceLabel =
 data.confidence != null && data.confidence > 0
 ? ` (ثقة ${data.confidence.toFixed(0)}%)`
 : '';
 lines.push(`🎯 التوقّع: ${recLabel}${confidenceLabel}`);
 if (data.recommendationAr) {
 lines.push(` ${data.recommendationAr}`);
 }
 if (data.reason) {
 lines.push(`📝 السبب: ${data.reason}`);
 }
 lines.push('');
 }

 // Price
 const changeLabel =
 data.changePct != null
 ? ` (${data.changePct >= 0 ? '+' : ''}${data.changePct.toFixed(2)}%)`
 : '';
 lines.push(`💰 السعر الحالي: ${fmtNum(data.currentPrice)} EGP${changeLabel}`);

 // Trading plan
 if (data.entryPrice != null) {
 const zone =
 data.entryZoneLow != null && data.entryZoneHigh != null
 ? `${fmtNum(data.entryZoneLow)} → ${fmtNum(data.entryZoneHigh)}`
 : `${fmtNum(data.entryPrice)}`;
 lines.push(`🎯 منطقة الدخول: ${zone}`);
 }
 if (data.targetPrice1 != null) {
 const pct = data.currentPrice
 ? ` (+${((data.targetPrice1 - data.currentPrice) / data.currentPrice * 100).toFixed(1)}%)`
 : '';
 lines.push(`🎯 الهدف الأول: ${fmtNum(data.targetPrice1)}${pct}`);
 }
 if (data.targetPrice2 != null) {
 const pct = data.currentPrice
 ? ` (+${((data.targetPrice2 - data.currentPrice) / data.currentPrice * 100).toFixed(1)}%)`
 : '';
 lines.push(`🎯 الهدف الثاني: ${fmtNum(data.targetPrice2)}${pct}`);
 }
 if (data.stopLoss != null) {
 const pct = data.currentPrice
 ? ` (${((data.stopLoss - data.currentPrice) / data.currentPrice * 100).toFixed(1)}%)`
 : '';
 lines.push(`🛑 وقف الخسارة: ${fmtNum(data.stopLoss)}${pct}`);
 }
 if (data.riskReward != null) {
 lines.push(`⚖️ العائد/المخاطرة: ${data.riskReward.toFixed(1)}:1`);
 }
 if (data.positionSize != null) {
 lines.push(`📊 حجم المركز: ${data.positionSize.toFixed(0)}% من المحفظة`);
 }

 // Signal strength
 if (data.signalCount != null) {
 const max = data.maxSignals ?? 6;
 const stars = '⭐'.repeat(
 Math.max(1, Math.ceil((data.signalCount / max) * 5))
 );
 lines.push(`📈 قوة الإشارة: ${data.signalCount}/${max} ${stars}`);
 if (data.path) {
 lines.push(` المسار: ${data.path}`);
 }
 }

 // Liquidity
 if (
 data.buyPressure != null ||
 data.sellPressure != null ||
 data.netFlow != null ||
 data.volumeRatio != null
 ) {
 lines.push('');
 lines.push('💧 حركة السيولة:');
 if (data.buyPressure != null) lines.push(` 🟢 ضغط شراء: ${data.buyPressure.toFixed(0)}%`);
 if (data.sellPressure != null) lines.push(` 🔴 ضغط بيع: ${data.sellPressure.toFixed(0)}%`);
 if (data.netFlow != null) {
 const sign = data.netFlow >= 0 ? '+' : '-';
 lines.push(
 ` 💵 صافي التدفق: ${sign}${Math.abs(data.netFlow / 1e6).toFixed(1)}M EGP`
 );
 }
 if (data.volumeRatio != null) {
 lines.push(` 📊 نسبة الحجم (10d/20d): ${data.volumeRatio.toFixed(2)}×`);
 }
 }

 // Technical
 if (
 data.rsi != null ||
 data.sma20 != null ||
 data.sma50 != null ||
 data.sma200 != null ||
 data.atr != null
 ) {
 lines.push('');
 lines.push('📈 المؤشرات الفنية:');
 if (data.rsi != null) {
 const state =
 data.rsi > 70
 ? ' ⚠️ تشبع شرائي'
 : data.rsi < 30
 ? ' ⚠️ تشبع بيعي'
 : ' ✅ محايد';
 lines.push(` RSI(14): ${data.rsi.toFixed(1)}${state}`);
 }
 if (data.sma20 != null) lines.push(` SMA20: ${data.sma20.toFixed(2)}`);
 if (data.sma50 != null) lines.push(` SMA50: ${data.sma50.toFixed(2)}`);
 if (data.sma200 != null) lines.push(` SMA200: ${data.sma200.toFixed(2)}`);
 if (data.atr != null) lines.push(` ATR: ${data.atr.toFixed(2)}`);
 }

 // Fundamentals
 if (
 data.peRatio != null ||
 data.pbRatio != null ||
 data.roe != null ||
 data.marketCap != null
 ) {
 lines.push('');
 lines.push('📋 الأساسيات:');
 if (data.peRatio != null) lines.push(` P/E: ${data.peRatio.toFixed(1)}`);
 if (data.pbRatio != null) lines.push(` P/B: ${data.pbRatio.toFixed(1)}`);
 if (data.roe != null) lines.push(` ROE: ${data.roe.toFixed(1)}%`);
 if (data.marketCap != null) {
 lines.push(` القيمة السوقية: ${fmtMoney(data.marketCap)} EGP`);
 }
 }

 // Analysis summary
 if (data.analysisSummary) {
 lines.push('');
 lines.push(`🧠 ملخص التحليل: ${data.analysisSummary}`);
 }

 // Market regime
 if (data.marketRegime) {
 lines.push('');
 lines.push(`🏛️ حالة السوق: ${MARKET_REGIME_AR[data.marketRegime]}`);
 }

 // ── Owner directive (2026-10-05): "هذا هو المكون العام للنشر" ──
 // Technical explanation (compact, for Telegram)
 if (data.technicalExplanation?.compactText) {
 lines.push('');
 lines.push('📝 التحليل الفني:');
 lines.push(data.technicalExplanation.compactText);
 } else if (data.technicalExplanation?.summary) {
 lines.push('');
 lines.push('📝 السبب: ' + data.technicalExplanation.summary);
 if (data.technicalExplanation.candlestick) {
 lines.push('🕯️ ' + data.technicalExplanation.candlestick);
 }
 if (data.technicalExplanation.smc) {
 lines.push('🐋 ' + data.technicalExplanation.smc);
 }
 if (data.technicalExplanation.volume) {
 lines.push('📊 ' + data.technicalExplanation.volume);
 }
 }

 // SMC data (for experts)
 if (data.smcData?.bias_ar) {
 lines.push('');
 lines.push('🏛️ تحليل السيولة (SMC):');
 lines.push(` الاتجاه: ${data.smcData.bias_ar}`);
 if (data.smcData.nearest_ob) {
 lines.push(` Order Block: ${data.smcData.nearest_ob.price} (${data.smcData.nearest_ob.type})`);
 }
 if (data.smcData.nearest_fvg) {
 lines.push(` FVG: ${data.smcData.nearest_fvg.bottom} - ${data.smcData.nearest_fvg.top}`);
 }
 }

 // Candlestick patterns
 if (data.candlestickPatterns && data.candlestickPatterns.length > 0) {
 lines.push('');
 lines.push('🕯️ الأنماط:');
 for (const p of data.candlestickPatterns.slice(0, 3)) {
 lines.push(` ${p.name_ar || p.name}: ${p.signal}`);
 }
 }

 // Liquidity footprint
 if (data.liquidity?.poc_price) {
 lines.push('');
 lines.push('💧 بصمة السيولة:');
 lines.push(` POC: ${data.liquidity.poc_price}`);
 if (data.liquidity.buy_sell_ratio) {
 lines.push(` شراء/بيع: ${data.liquidity.buy_sell_ratio.toFixed(2)}×`);
 }
 if (data.liquidity.accumulation_label) {
 lines.push(` الحالة: ${data.liquidity.accumulation_label}`);
 }
 }

 // Footer
 lines.push('');
 lines.push('━'.repeat(20));
 lines.push('📍 منصة دليل الاستثمار — invist.m2y.net');
 lines.push('⚠️ تحليل تلقائي — ليس نصيحة استثمارية');

 return withOfficialLinks(lines.join('\n'));
}

// ============================================================================
// generatePublishPayload — JSON payload for API publishing
// ============================================================================

export function generatePublishPayload(data: StockPublishData) {
 return {
 ticker: data.ticker,
 market: data.market || 'EGX',
 name_ar: data.nameAr,
 name_en: data.nameEn,
 sector: data.sector,
 current_price: data.currentPrice,
 change_pct: data.changePct,
 recommendation: data.recommendation,
 recommendation_ar: data.recommendationAr,
 confidence: data.confidence,
 reason: data.reason,
 entry_price: data.entryPrice,
 entry_zone: data.entryZoneLow != null && data.entryZoneHigh != null
 ? { low: data.entryZoneLow, high: data.entryZoneHigh }
 : undefined,
 target_price_1: data.targetPrice1,
 target_price_2: data.targetPrice2,
 stop_loss: data.stopLoss,
 risk_reward: data.riskReward,
 position_size: data.positionSize,
 signal_count: data.signalCount,
 max_signals: data.maxSignals,
 path: data.path,
 liquidity: {
 buy_pressure: data.buyPressure,
 sell_pressure: data.sellPressure,
 net_flow: data.netFlow,
 volume_ratio: data.volumeRatio,
 turnover: data.turnover,
 },
 technical: {
 rsi: data.rsi,
 sma20: data.sma20,
 sma50: data.sma50,
 sma200: data.sma200,
 atr: data.atr,
 },
 fundamentals: {
 pe_ratio: data.peRatio,
 pb_ratio: data.pbRatio,
 roe: data.roe,
 market_cap: data.marketCap,
 },
 analysis_summary: data.analysisSummary,
 market_regime: data.marketRegime,
 generated_at: new Date().toISOString(),
 source: 'stock-publisher',
 };
}

// ============================================================================
// Helpers
// ============================================================================

function fmtNum(n: number | null | undefined, digits = 2): string {
 if (n == null || !Number.isFinite(n as number)) return '—';
 return Number(n).toLocaleString('en-US', {
 maximumFractionDigits: digits,
 minimumFractionDigits: 0,
 });
}

function fmtMoney(n: number | null | undefined): string {
 if (n == null || !Number.isFinite(n as number)) return '—';
 const num = Number(n);
 if (Math.abs(num) >= 1_000_000_000)
 return `${(num / 1_000_000_000).toFixed(2)}B`;
 if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
 if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
 return num.toFixed(0);
}

// ============================================================================
// escapeHtmlForTelegram — escape HTML special chars for Telegram parse_mode=HTML
// ============================================================================

export function escapeHtmlForTelegram(text: string): string {
 return text
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;');
}
