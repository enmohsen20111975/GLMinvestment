/**
 * Admin Engine Settings API (proxy to Python backend)
 * ====================================================
 * DYNAMIC-ADMIN-UI: نظام الإعدادات الديناميكية للمحرك.
 *
 * الـ Backend logic موجود في vps-service/analyzers/engine_settings.py
 * وبيتعامل مع جدول `system_settings` في stocks.db.
 *
 * الـ Next.js route ده مجرد proxy — بيحوّل الطلبات للـ Python backend
 * على `PYTHON_BACKEND_URL` (default: http://localhost:8010) ولو الباك-إند
 * مش متاح، بيرجّع fallback بالإعدادات الافتراضية.
 *
 *  - GET  → { success, settings: {...}, descriptions: {...} }
 *  - POST → body { updates: { key: value, ... } } → { success, results: { key: bool } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

/** Timeout for proxying to the Python backend (ms). */
const PROXY_TIMEOUT_MS = 5000;

// ============== Fallback Defaults ==============
// نسخة محلية من DEFAULT_SETTINGS (defined in vps-service/analyzers/engine_settings.py)
// لو الـ Python backend مش متاح، نرجّع القيم دي عشان الـ UI يفضل شغّال.

const FALLBACK_SETTINGS: Record<string, number> = {
  // Liquidity
  liquidity_ratio_threshold: 0.5,
  liquidity_dead_ratio: 0.1,
  min_turnover_egp: 500_000,
  min_volume_shares: 50_000,
  min_stock_price: 1.0,
  // Volume Surge
  volume_surge_calm_market: 1.2,
  volume_surge_busy_market: 1.8,
  market_volatility_threshold: 2.0,
  // RSI
  rsi_overbought_base: 70,
  rsi_oversold_base: 30,
  rsi_trend_adjustment: 10,
  // BUY Threshold
  buy_threshold_base: 68,
  buy_threshold_bull_adjust: -8,
  buy_threshold_bear_adjust: 7,
  accumulate_threshold: 50,
  hold_threshold: 35,
  // Stop Loss / Risk
  atr_stop_mult_calm: 1.0,
  atr_stop_mult_volatile: 2.5,
  stock_volatility_calm: 2.0,
  stock_volatility_volatile: 6.0,
  max_stop_pct: 0.15,
  min_stop_pct: 0.003,
  // Targets / R/R
  min_rr_bull_market: 2.0,
  min_rr_bear_market: 1.8,
  min_rr_range_market: 1.5,
  target_rr_bull: 3.0,
  target_rr_range: 1.5,
  // Delayed Data Compensation
  use_close_confirmation: 1,
  pullback_bonus: 5,
  vertical_spike_penalty: 8,
  // Free Float
  free_float_critical_pct: 5.0,
  free_float_risky_pct: 15.0,
  free_float_critical_mult: 0.2,
  free_float_risky_mult: 0.5,
  // Engine Limits
  max_analysis_age_minutes: 15,
  min_confidence_pct: 40,
};

/** Minimal fallback descriptions (category + description) used when Python is down. */
const FALLBACK_DESCRIPTIONS: Record<string, { description: string; category: string }> = {
  liquidity_ratio_threshold: { description: 'نسبة السيولة من المتوسط — تحتها يتم خصم درجات (0.5 = 50%)', category: 'liquidity' },
  liquidity_dead_ratio: { description: 'نسبة السيولة الميتة — تحتها يتم رفض السهم تماماً (0.1 = 10%)', category: 'liquidity' },
  min_turnover_egp: { description: 'الحد الأدنى المطلق للدوران (جنيه)', category: 'liquidity' },
  min_volume_shares: { description: 'الحد الأدنى للحجم (عدد أسهم)', category: 'liquidity' },
  min_stock_price: { description: 'الحد الأدنى لسعر السهم — تحته يعتبر سهم قرش', category: 'liquidity' },
  volume_surge_calm_market: { description: 'مضاعف الحجم في السوق الهادي', category: 'volume' },
  volume_surge_busy_market: { description: 'مضاعف الحجم في السوق الصاخب', category: 'volume' },
  market_volatility_threshold: { description: 'حد تذبذب السوق — فوقه يعتبر صاخب (%)', category: 'volume' },
  rsi_overbought_base: { description: 'عتبة التشبع الشرائي الأساسية (70)', category: 'rsi' },
  rsi_oversold_base: { description: 'عتبة التشبع البيعي الأساسية (30)', category: 'rsi' },
  rsi_trend_adjustment: { description: 'كم نقطة نزودها لو الترند قوي (0..10)', category: 'rsi' },
  buy_threshold_base: { description: 'عتبة درجة الشراء الأساسية (68)', category: 'scoring' },
  buy_threshold_bull_adjust: { description: 'تعديل عتبة الشراء في السوق الصاعد (-8 → 60)', category: 'scoring' },
  buy_threshold_bear_adjust: { description: 'تعديل عتبة الشراء في السوق الهابط (+7 → 75)', category: 'scoring' },
  accumulate_threshold: { description: 'عتبة درجة التجميع (50)', category: 'scoring' },
  hold_threshold: { description: 'عتبة درجة الاحتفاظ (35)', category: 'scoring' },
  atr_stop_mult_calm: { description: 'مضاعف ATR للوقف في السهم الهادي (1.0)', category: 'risk' },
  atr_stop_mult_volatile: { description: 'مضاعف ATR للوقف في السهم الصاخب (2.5)', category: 'risk' },
  stock_volatility_calm: { description: 'حد التذبذب — تحته السهم هادي (%)', category: 'risk' },
  stock_volatility_volatile: { description: 'حد التذبذب — فوقه السهم صاخب (%)', category: 'risk' },
  max_stop_pct: { description: 'أقصى عرض للوقف (0.15 = 15%)', category: 'risk' },
  min_stop_pct: { description: 'أدنى عرض للوقف (0.003 = 0.3%)', category: 'risk' },
  min_rr_bull_market: { description: 'R/R الأدنى في السوق الصاعد (2.0)', category: 'targets' },
  min_rr_bear_market: { description: 'R/R الأدنى في السوق الهابط (1.5)', category: 'targets' },
  min_rr_range_market: { description: 'R/R الأدنى في السوق العادي (1.2)', category: 'targets' },
  target_rr_bull: { description: 'هدف R/R في السوق الصاعد (3.0 = 1:3)', category: 'targets' },
  target_rr_range: { description: 'هدف R/R في السوق العادي (1.5 = 1:1.5)', category: 'targets' },
  use_close_confirmation: { description: 'تفعيل تأكيد الإغلاق (1 = فعّال، 0 = مطفي)', category: 'delayed_data' },
  pullback_bonus: { description: 'درجات إضافية لو السهم بيعمل pullback', category: 'delayed_data' },
  vertical_spike_penalty: { description: 'درجات خصم لو السهم طالع عمودي', category: 'delayed_data' },
  free_float_critical_pct: { description: 'نسبة الأسهم الحرة الحرجة — تحتها خطير جداً (%)', category: 'free_float' },
  free_float_risky_pct: { description: 'نسبة الأسهم الحرة المخاطرة — تحتها مخاطرة عالية (%)', category: 'free_float' },
  free_float_critical_mult: { description: 'معامل السيولة لو free float حرج (0.2)', category: 'free_float' },
  free_float_risky_mult: { description: 'معامل السيولة لو free float مخاطر (0.5)', category: 'free_float' },
  max_analysis_age_minutes: { description: 'عمر التحليل قبل ما يعتبر قديم (دقايق)', category: 'limits' },
  min_confidence_pct: { description: 'أقل ثقة مسموح بيها لعرض توصية (%)', category: 'limits' },
};

// ============== Helpers ==============

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = PROXY_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* ignore JSON parse errors */
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function fallbackResponse() {
  return NextResponse.json({
    success: true,
    settings: FALLBACK_SETTINGS,
    descriptions: FALLBACK_DESCRIPTIONS,
    count: Object.keys(FALLBACK_SETTINGS).length,
    timestamp: new Date().toISOString(),
    source: 'fallback (python backend unreachable)',
    warning: 'تعذّر الوصول للـ Python backend — يتم عرض القيم الافتراضية المحلية',
  });
}

// ============== GET Handler ==============

export async function GET(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const result = await fetchWithTimeout(
      `${PYTHON_BACKEND_URL}/api/admin/engine-settings`,
      { method: 'GET' },
    );

    if (!result.ok || !result.data || typeof result.data !== 'object') {
      // Python backend unreachable — return local fallback so the UI still works.
      return fallbackResponse();
    }

    const payload = result.data as {
      success?: boolean;
      settings?: Record<string, number | string>;
      descriptions?: Record<string, { description: string; category: string }>;
    };

    if (!payload.success || !payload.settings) {
      return fallbackResponse();
    }

    return NextResponse.json({
      success: true,
      settings: payload.settings,
      descriptions: payload.descriptions || FALLBACK_DESCRIPTIONS,
      count: Object.keys(payload.settings).length,
      timestamp: new Date().toISOString(),
      source: 'python-backend',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[engine-settings GET] error:', message);
    return fallbackResponse();
  }
}

// ============== POST Handler ==============

interface PostBody {
  updates?: Record<string, number | string | boolean>;
}

export async function POST(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const body = (await request.json().catch(() => null)) as PostBody | null;
    if (!body || typeof body !== 'object' || !body.updates) {
      return NextResponse.json(
        { success: false, error: 'invalid body — expected { updates: { key: value } }' },
        { status: 400 },
      );
    }

    const updates = body.updates;
    if (typeof updates !== 'object' || Array.isArray(updates) || Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'updates must be a non-empty object' },
        { status: 400 },
      );
    }

    // Proxy to the Python backend
    const result = await fetchWithTimeout(
      `${PYTHON_BACKEND_URL}/api/admin/engine-settings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      },
      8000,
    );

    if (!result.ok || !result.data || typeof result.data !== 'object') {
      return NextResponse.json(
        {
          success: false,
          results: {},
          error: 'Python backend unreachable — تعذّر تحديث الإعدادات',
        },
        { status: 502 },
      );
    }

    const payload = result.data as {
      success?: boolean;
      results?: Record<string, boolean>;
      updated_count?: number;
      total_count?: number;
    };

    return NextResponse.json({
      success: Boolean(payload.success),
      results: payload.results || {},
      updated_count: payload.updated_count,
      total_count: payload.total_count,
      timestamp: new Date().toISOString(),
      source: 'python-backend',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[engine-settings POST] error:', message);
    return NextResponse.json(
      { success: false, results: {}, error: message },
      { status: 500 },
    );
  }
}
