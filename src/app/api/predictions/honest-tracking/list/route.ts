/**
 * Honest Prediction Tracking API — List
 * =======================================
 * Updated: reads market column from predictions table with fallback.
 * Parses full analysis details from notes (technical, fundamental, patterns, S/R, volume).
 *
 * Maps predictions table columns to the schema the frontend expects.
 */

import { NextRequest, NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
// (ALPHA-DAL-WAVE4): استخدم openDbWritable من الـ DAL — ممنوع new Database().
import { openDbWritable } from '@/lib/db-manager';
import { ensureSchema } from '@/lib/honest-tracking/maestro';
import { applyProtectionFilter, isProtectionActive, getProtectionDescription, getProtectionSqlFilter } from '@/lib/protection/display-protection';
import { normalizeEgxSymbol } from '@/lib/stock-names';
import { applyValidatedTargets } from '@/lib/targets-validator';
// PHASE3-MARKET-SEGREGATION: canonical market normalization (TADAWUL ↔ KSA)
import { normalizeMarket, buildMarketFilter, NO_PREDICTIONS_MESSAGE_AR, INTERNAL_ERROR_MESSAGE_AR } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';

function openDb(): Database.Database {
  // (ALPHA-DAL-WAVE4): DAL gatekeeper — ممنوع new Database(). الـ DAL بيـ handle
  // busy_timeout + WAL. ensureSchema بيـ create predictions table لو مش موجودة.
  const db = openDbWritable('predictions.db');
  if (!db) throw new Error('predictions.db not found');
  ensureSchema(db);
  return db;
}

function inferMarket(ticker: string, marketCol: string | null): string {
  if (marketCol && marketCol !== '') return marketCol;
  if (!ticker) return 'EGX';
  if (/^\d+$/.test(ticker)) return 'TADAWUL';
  return 'EGX';
}

function inferStatus(r: any): string {
  // RL-FIX-16 (HONEST-WIN): WIN = actual_return > 0 (يتطابق مع Python API).
  // قبل الإصلاح: hit_target=1 → TARGET_HIT → WIN، حتى لو actual_return <= 0.
  // ده سبب 103 "false wins" (target ضُرب لكن الصفقة قفلت على خسارة).
  // دلوقتي: actual_return هو الفاصل الوحيد للحقيقة.
  // SCHEMA-MISMATCH-FIX: التوقعات المقفولة بـ trading pipeline (status='CLOSED' /
  // exit_type) بتتعامل زي outcome_date. قبل كده كان بتعتبر PENDING لو outcome_date
  // NULL → الـ dashboard بـ يعرضهم كمعلقين بدل مقفولين.
  const exitType = (r.exit_type || '').toString().toLowerCase();
  const statusNorm = (r.status || '').toString().trim().toUpperCase();
  const isClosed = !!r.outcome_date || statusNorm === 'CLOSED' || !!r.exit_type;
  if (!isClosed) return 'PENDING';
  const effReturn = (r.actual_return !== null && r.actual_return !== undefined)
    ? Number(r.actual_return)
    : (r.pnl_pct !== null && r.pnl_pct !== undefined ? Number(r.pnl_pct) : null);
  if (effReturn !== null && effReturn > 0) {
    return exitType === 'trailing_profit' ? 'TRAILING_PROFIT' : 'TARGET_HIT';
  }
  if (effReturn !== null && effReturn < 0) {
    return exitType === 'trailing_profit' ? 'TRAILING_PROFIT' : 'STOPPED';
  }
  // eff_return == 0 أو null → fallback للحقول المحفوظة
  if (exitType === 'trailing_profit') return 'TRAILING_PROFIT';
  if (exitType === 'target_hit') return 'TARGET_HIT';
  if (exitType === 'stop_loss' || exitType === 'stop_hit') return 'STOPPED';
  if (r.hit_target === 1) return 'TARGET_HIT';
  if (r.hit_stop === 1) return 'STOPPED';
  return 'EXPIRED';
}

function parseNotes(notes: string | null): {
  analysisMethods: string[];
  reasons: string[];
  srZone: string | null;
  srSupport: number | null;
  srResistance: number | null;
  rsiValue: number | null;
  ma20: number | null;
  ma50: number | null;
  macdHistogram: number | null;
  candlePatterns: { name: string; name_ar: string; type: string; strength: number }[];
  trendDirection: string | null;
  volumeTrend: string | null;
  volumeSpike: boolean;
  peRatio: number | null;
  roe: number | null;
  dividendYield: number | null;
  profitMargin: number | null;
  sector: string | null;
  change1m: number | null;
  bollingerWidth: number | null;
  persona: string | null;
} {
  const result = {
    analysisMethods: [] as string[],
    reasons: [] as string[],
    srZone: null as string | null,
    srSupport: null as number | null,
    srResistance: null as number | null,
    rsiValue: null as number | null,
    ma20: null as number | null,
    ma50: null as number | null,
    macdHistogram: null as number | null,
    candlePatterns: [] as { name: string; name_ar: string; type: string; strength: number }[],
    trendDirection: null as string | null,
    volumeTrend: null as string | null,
    volumeSpike: false,
    peRatio: null as number | null,
    roe: null as number | null,
    dividendYield: null as number | null,
    profitMargin: null as number | null,
    sector: null as string | null,
    change1m: null as number | null,
    bollingerWidth: null as number | null,
    persona: null as string | null,
  };

  if (!notes) return result;

  const parts = notes.split(';').map(p => p.trim());

  for (const part of parts) {
    if (part.startsWith('persona=')) {
      const persona = part.split('=')[1];
      result.persona = persona;
      result.analysisMethods.push('Maestro Persona');
      if (persona === 'gambler') result.analysisMethods.push('🎯 مغامر');
      else if (persona === 'investor') result.analysisMethods.push('💼 مستثمر');
      else if (persona === 'balanced') result.analysisMethods.push('⚖️ متوازن');
    }
    if (part.startsWith('RSI=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) {
        result.rsiValue = val;
        result.analysisMethods.push('RSI');
      }
    }
    if (part.startsWith('MA20=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) result.ma20 = val;
    }
    if (part.startsWith('MA50=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) result.ma50 = val;
    }
    if (part.startsWith('support=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) {
        result.srSupport = val;
        result.srZone = 'S/R detected';
        if (!result.analysisMethods.includes('دعوم/مقاومات')) result.analysisMethods.push('دعوم/مقاومات');
      }
    }
    if (part.startsWith('resistance=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) {
        result.srResistance = val;
        result.srZone = 'S/R detected';
        if (!result.analysisMethods.includes('دعوم/مقاومات')) result.analysisMethods.push('دعوم/مقاومات');
      }
    }
    if (part.startsWith('trend=')) {
      const trend = part.split('=')[1];
      result.trendDirection = trend;
      result.analysisMethods.push('اتجاه');
      if (trend === 'BULLISH') result.reasons.push(`اتجاه صاعد (السعر فوق المتوسطات)`);
      else if (trend === 'BEARISH') result.reasons.push(`اتجاه هابط (السعر تحت المتوسطات)`);
    }
    if (part.startsWith('candle=')) {
      const pattern = part.split('=')[1];
      const patternMap: Record<string, { name: string; name_ar: string; type: string }> = {
        'DOJI': { name: 'Doji', name_ar: 'دوجي', type: 'neutral' },
        'HAMMER': { name: 'Hammer', name_ar: 'شاكوش', type: 'bullish' },
        'HANGING_MAN': { name: 'Hanging Man', name_ar: 'رجل مشنوق', type: 'bearish' },
        'BULLISH_ENGULFING': { name: 'Bullish Engulfing', name_ar: 'ابتلاع صاعد', type: 'bullish' },
        'BEARISH_ENGULFING': { name: 'Bearish Engulfing', name_ar: 'ابتلاع هابط', type: 'bearish' },
        'MORNING_STAR': { name: 'Morning Star', name_ar: 'نجمة الصباح', type: 'bullish' },
        'EVENING_STAR': { name: 'Evening Star', name_ar: 'نجمة المساء', type: 'bearish' },
        'SHOOTING_STAR': { name: 'Shooting Star', name_ar: 'نجمة ساقطة', type: 'bearish' },
        'INVERTED_HAMMER': { name: 'Inverted Hammer', name_ar: 'شاكوش مقلوب', type: 'bullish' },
      };
      const pm = patternMap[pattern] || { name: pattern, name_ar: pattern, type: 'neutral' };
      result.candlePatterns.push({ ...pm, strength: 70 });
      result.analysisMethods.push('شموع يابانية');
    }
    if (part.startsWith('macd_h=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) {
        result.macdHistogram = val;
        result.analysisMethods.push('MACD');
      }
    }
    if (part.startsWith('vol=')) {
      const trend = part.split('=')[1];
      result.volumeTrend = trend;
      result.analysisMethods.push('حجم تداول');
      if (trend === 'increasing') result.reasons.push('حجم تداول متزايد');
      if (trend === 'spike') result.volumeSpike = true;
    }
    if (part.startsWith('BBw=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) {
        result.bollingerWidth = val;
        result.analysisMethods.push('Bollinger');
      }
    }
    if (part.startsWith('PE=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) {
        result.peRatio = val;
        result.analysisMethods.push('تحليل أساسي');
      }
    }
    if (part.startsWith('ROE=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) {
        result.roe = val;
        if (!result.analysisMethods.includes('تحليل أساسي')) result.analysisMethods.push('تحليل أساسي');
      }
    }
    if (part.startsWith('DY=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) result.dividendYield = val;
    }
    if (part.startsWith('PM=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) result.profitMargin = val;
    }
    if (part.startsWith('sector=')) {
      result.sector = part.split('=')[1];
    }
    if (part.startsWith('chg1m=')) {
      const val = parseFloat(part.split('=')[1]);
      if (!isNaN(val)) {
        result.change1m = val;
        result.analysisMethods.push('أداء شهري');
      }
    }
    if (part.startsWith('reasons=')) {
      const reasonsStr = part.split('=')[1] || '';
      const reasonsList = reasonsStr.split('|').filter(r => r.trim());
      for (const r of reasonsList) {
        if (!result.reasons.includes(r)) result.reasons.push(r);
      }
    }
  }

  return result;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'all';
  const status = searchParams.get('status') || 'all';
  const signal = searchParams.get('signal') || 'all';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 2000); // RL-FIX-8: 500 → 2000
  const offset = parseInt(searchParams.get('offset') || '0');
  const sortBy = searchParams.get('sortBy') || 'prediction_date';
  const sortOrder = searchParams.get('sortOrder') || 'DESC';

  // RL-FIX-10: فلترة الجودة — علشان الملخص ما يحسبش كل الـ 1554 توقع (3 personas ×
  // 518 سهم)، بس أفضل التوقعات بس. ده بيخلي الأرقام منطقية:
  //   - minScore: أقل درجة ثقة (master_score) يقبلها. افتراضي 70 (قوي).
  //   - topPerDay: أقصى عدد توقعات لكل (يوم، شخصية). افتراضي 5.
  // كده بدل 310 توقع في 7 أيام، بيبقى ~20-35 توقع (5/يوم × 3 personas تقريباً).
  const minScoreRaw = parseInt(searchParams.get('minScore') || '70');
  const minScore = isNaN(minScoreRaw) ? 70 : Math.max(0, Math.min(100, minScoreRaw));
  const topPerDayRaw = parseInt(searchParams.get('topPerDay') || '5');
  const topPerDay = isNaN(topPerDayRaw) ? 5 : Math.max(0, Math.min(50, topPerDayRaw));
  // qualityMode: 'top_picks' (افتراضي) = يطبّق minScore + topPerDay | 'all' = بدون فلترة
  const qualityMode = (searchParams.get('qualityMode') || 'top_picks').toLowerCase();
  const applyQuality = qualityMode !== 'all';

  // RL-FIX-8: production fallback helper — لو الـ DB المحلي فاضي أو فيه بيانات قليلة،
  // نـ fallback للإنتاج علشان الـ Executive Report يبني ملخصه على بيانات تاريخية كاملة
  // (من 1/1/2026 للآن) بدل ما يبقى محصور في بيانات اليوم الحالي فقط.
  const fallbackToProduction = async () => {
    try {
      const prodUrl = `https://invist.m2y.net/api/predictions/honest-tracking/list?market=${encodeURIComponent(market)}&status=${encodeURIComponent(status)}&signal=${encodeURIComponent(signal)}&limit=${limit}&offset=${offset}&sortBy=${encodeURIComponent(sortBy)}&sortOrder=${encodeURIComponent(sortOrder)}&minScore=${minScore}&topPerDay=${topPerDay}&qualityMode=${encodeURIComponent(qualityMode)}`;
      const prodRes = await fetch(prodUrl, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (prodRes.ok) {
        const prodJson = await prodRes.json();
        if (prodJson?.success && prodJson?.predictions?.length > 0) {
          return NextResponse.json({
            ...prodJson,
            source: 'vps-production',
          }, {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0',
              'X-Data-Source': 'vps-production',
            },
          });
        }
      }
    } catch (prodErr) {
      console.error('[honest-tracking/list] production fallback failed:', prodErr);
    }
    return null;
  };

  let allRows: any[] = [];
  // PHASE3-MARKET-SEGREGATION: declare canonicalMarket OUTSIDE the try block
  // so the response builder (which lives in a sibling try) can reference it
  // to attach the "no predictions for this market" message. Without this,
  // the empty-result branch throws `canonicalMarket is not defined` and the
  // route falls through to the error handler.
  const canonicalMarket = normalizeMarket(market);
  try {
    const db = openDb();
    // RL-FIX-10: فلترة الجودة في الـ SQL نفسه — لو qualityMode='top_picks'، نضيف
    // WHERE master_score >= minScore. ده بيقلل الـ rows من 1554 لـ ~50-100 قبل أي
    // فلترة تانية. الـ topPerDay بيتطبّق post-query (في JS) علشان SQLite ما عنوش
    // window functions بشكل افتراضي.
    // V40.2-PROTECTION: apply display protection filter (morning_bell / hide_weak) at SQL level
    // Params are numbers from our own config file (safe to interpolate)
    const protFilter = getProtectionSqlFilter();
    let protClause = protFilter.clause;
    if (protFilter.params.length > 0) {
      // Interpolate numeric params safely (they come from display_protection.json, not user input)
      protFilter.params.forEach((p) => {
        protClause = protClause.replace('?', String(Number(p)));
      });
    }
    const qualityClause = applyQuality && minScore > 0
      ? `master_score IS NOT NULL AND master_score >= ${minScore}`
      : '';
    // MARKET-FILTER-COMPLETE (Task MARKET-FILTER-COMPLETE):
    // قبل كده: الـ market filter كان بـ يتعمل في JS بعد LIMIT 500. المشكلة: لو فيه
    // 400 صف EGX + 400 صف US، الـ LIMIT بـ ياخد أول 500 → بيرجّع 400 EGX + 100 US.
    // الـ JS filter بيشيل الـ US → المستخدم بيشوف 100 صف US بس بدل 400. الحل: نضيف
    // الـ market filter للـ SQL WHERE clause قبل الـ LIMIT علشان نـ fetch الصفوف
    // الصح من البداية. ملاحظة: 'EGX' في الـ DB ممكن يكون 'EGX' أو 'مصر'.
    //
    // PHASE3-MARKET-SEGREGATION: نطبّع الـ market input (TADAWUL ↔ KSA ↔ السعودية)
    // قبل أي مقارنة. ده بيخلّي الـ API يقبل أي alias للسوق السعودي بدون ما الـ frontend
    // يحتاج يعرف "هو الـ DB بيخزن TADAWUL ولا KSA؟". بنستخدم buildMarketFilter اللي
    // بيرجّع WHERE market IN ('TADAWUL','KSA','السعودية') لكل alias سعودي.
    // ملاحظة: canonicalMarket معرّف برّا الـ try (سطر 316) علشان الـ response builder
    // يستخدمه بعدين لإضافة الـ "no predictions" message.
    const marketFilter = buildMarketFilter(canonicalMarket);
    const marketSqlParts: string[] = marketFilter.clause ? [marketFilter.clause] : [];
    const marketSqlParams: string[] = marketFilter.params;
    const whereParts = [qualityClause, protClause, ...marketSqlParts].filter(Boolean);
    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    // FIX-5D: schema-aware SELECT — نتأكد إن target_price_2 موجود قبل ما نضيفه للـ SELECT
    // (لو الـ DB محلي قديم وما عندهوش العمود، الـ query ما بـ يكسرش). الـ PRAGMA
    // table_info بيرجع صف لكل عمود فيه name field. لو العمود موجود، نضيفه للـ SELECT.
    // الأعمدة التانية (highest_price_reached, lowest_price_reached, exit_type) موجودة
    // في الـ schema migrations من قبل (maestro.ts:349-350) فبنعتبرها دايماً موجودة.
    let hasTargetPrice2 = false;
    let hasV40Fields = false;
    try {
      const cols = db.prepare("PRAGMA table_info(predictions)").all() as Array<{ name: string }>;
      hasTargetPrice2 = cols.some((c) => c.name === 'target_price_2');
      // V40.1: evidence_count, morning_bell, kill_filter_result (added by V40 generator)
      hasV40Fields = cols.some((c) => c.name === 'evidence_count')
        && cols.some((c) => c.name === 'morning_bell');
    } catch {
      hasTargetPrice2 = false;
      hasV40Fields = false;
    }
    const targetPrice2Sel = hasTargetPrice2 ? ', target_price_2' : '';
    // V40.1: evidence_count + morning_bell + kill_filter_result (schema-aware)
    const v40Sel = hasV40Fields ? ', evidence_count, morning_bell, kill_filter_result' : '';
    // FIX (Aug 2026): ضيف LIMIT في الـ SQL بدل ما نـ fetch كل الصفوف ونعمل pagination في JS
    // عشان نمنع OOM على 5000+ توقع
    const maxRows = 500; // حد أقصى للصفوف اللي بترجع من DB
    // ─── PHASE-1 (Task UNIFICATION-PHASE-1, Rule 72) ─────────────────────
    // FRESHNESS GATE: لا نعرض predictions أقدم من 7 أيام لـ PENDING (مش CLOSED).
    // قبل كده: كان 48 ساعة — بس الـ daily_predictor بيشتغل مرة/يوم، فالتوقعات
    // ممكن تكون عمرها 2-3 أيام وم لسه valid. 48 ساعة بـ يطرد توقعات لسه نشطة.
    // الحل: وسّعنا لـ 7 أيام — أي توقع نشط أقل من أسبوع لسه valid.
    // CLOSED predictions مفيهاش حداثة (تاريخها تاريخ الإغلاق، مش تاريخ القرار).
    const freshnessGate = `(
      -- CLOSED predictions: no freshness filter (historical)
      (outcome_date IS NOT NULL OR UPPER(TRIM(COALESCE(status,''))) = 'CLOSED' OR exit_type IS NOT NULL)
      OR
      -- PENDING predictions: must be fresh (≤ 7 days old)
      prediction_date >= datetime('now', '-7 days')
    )`;
    // Inject freshness gate into WHERE clause
    const whereWithFreshness = whereClause
      ? `${whereClause} AND ${freshnessGate}`
      : `WHERE ${freshnessGate}`;
    // Fetch predictions — CLOSED first (more interesting), then PENDING by date
    // LIFECYCLE-MIGRATION: `lifecycle_status` is now SELECTed alongside
    // `status` so the UI can read it for lifecycle segmentation. The
    // downstream `inferStatus` function still derives the normalized status
    // string from outcome fields, but the raw `lifecycle_status` is now
    // available for the response object.
    allRows = db.prepare(`
      SELECT
        id, ticker, market, signal, signal_type, prediction_date,
        entry_price, target_price, stop_loss,
        master_score, technical_score, fundamental_score,
        ai_pattern_score, sentiment_score,
        outcome_date, exit_price, actual_return, exit_reason,
        hit_target, hit_stop, is_correct, holding_days,
        notes, created_at, highest_price_reached, lowest_price_reached,
        atr_at_entry, risk_reward, exit_type, status, lifecycle_status, pnl_pct, closed_at,
        persona${targetPrice2Sel}${v40Sel}
        ${hasV40Fields ? ', analysis_json' : ''}
      FROM predictions
      ${whereWithFreshness}
      ORDER BY (outcome_date IS NULL AND UPPER(TRIM(COALESCE(status,''))) != 'CLOSED' AND exit_type IS NULL) DESC, prediction_date DESC, master_score DESC, outcome_date DESC, closed_at DESC, id DESC
      LIMIT ${maxRows}
    `).all(...marketSqlParams) as any[];
    db.close();
  } catch (dbErr) {
    // RL-FIX-8: لو الـ query فشل (مثلاً عمود ناقص في الـ schema المحلي)، نـ fallback فوراً
    console.error('[honest-tracking/list] local DB query failed, falling back to production:', dbErr);
    const prodResp = await fallbackToProduction();
    if (prodResp) return prodResp;
    // PHASE3-MARKET-SEGREGATION (Task B): بدل ما نرجّع 500 (اللي بيكسر الـ frontend)،
    // نرجّع 200 + empty predictions + message واضح. ده بـ يحافظ على Rule 27 (NO-FAKE-DATA)
    // وبيخلّي الـ UI يعرض "لا توجد توقعات" بدل شاشة خطأ.
    return NextResponse.json(
      {
        success: true,
        predictions: [],
        pagination: { total: 0, limit, offset, has_more: false },
        filters: { market, status, signal, sortBy, sortOrder, minScore, topPerDay, qualityMode },
        message: INTERNAL_ERROR_MESSAGE_AR,
        data_source: 'local-db-error',
        local_row_count: 0,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
          'X-Local-Row-Count': '0',
          'X-Data-Source': 'local-db-error',
        },
      }
    );
  }

  // RL-FIX-8 / HONEST-V3: لو الـ DB المحلي فاضي أو فيه بيانات قليلة، نـ fallback للإنتاج.
  // IMPORTANT FIX (المحور 3): الـ fallback الأعمى كان بـ يخفي الـ cleanup! لو بعد ما
  // المالك حذف التوقعات الكارثية بقي العدد < 100، الـ API بـ يجيب نفس القائمة
  // الإنتاجية القديمة → الواجهة تبدو "ثابتة مهما يعمل". الحل: الـ fallback بقت
  // opt-in بـ query param `?fallback=1` أو لو الـ DB فاضي تماماً (0 صفوف).
  // كمان بنضيف X-Local-Row-Count header علشان المطور يقدر يشوف العدد الحقيقي.
  const noFallback = searchParams.get('fallback') === '0'
    || searchParams.get('noFallback') === '1';
  const totalLocal = allRows.length;
  const localIsEmpty = totalLocal === 0;
  if (!noFallback && localIsEmpty) {
    const prodResp = await fallbackToProduction();
    if (prodResp) return prodResp;
  }
  // لو عندنا بيانات محلية (حتى لو قليلة) بنرجّعها + header يوضح العدد.
  // المطور يقدر يضيف ?fallback=1 لو حابب يـ force الإنتاج.

  try {
    // Transform + filter
    let predictions = allRows.map((r) => {
      const pMarket = inferMarket(r.ticker, r.market);
      const pStatus = inferStatus(r);
      const entry = Number(r.entry_price || 0);
      const target = Number(r.target_price || 0);
      const stop = Number(r.stop_loss || 0);
      const risk = entry - stop;
      const reward = target - entry;
      const riskReward = risk !== 0 ? Math.round((reward / Math.abs(risk)) * 100) / 100 : null;

      const parsed = parseNotes(r.notes);

      // CANONICAL-SYMBOL-FIX: طبّع الرمز الوارد (ISIN/مدمج/بلاحافة) → رمز نظيف + اسم عربي.
      // يحل مشكلة "رموز الأسهم غلط 100% والأسم مش باين". القاعدة 17 (مسارات نسبية).
      const norm = normalizeEgxSymbol(r.ticker);
      const stockSymbol = norm.ticker || r.ticker;
      const stockNameAr = norm.name_ar || r.ticker;

      // SCHEMA-MISMATCH-FIX: العائد الفعلي = COALESCE(actual_return, pnl_pct)
      // (الـ trading pipeline بـ يكتب pnl_pct، مش actual_return)
      const actualReturn = (r.actual_return !== null && r.actual_return !== undefined)
        ? Number(r.actual_return)
        : (r.pnl_pct !== null && r.pnl_pct !== undefined ? Number(r.pnl_pct) : null);
      // RL-FIX-9 (BUG #5): direction-aware maxProfit.
      // للـ SELL: الربح لما السعر ينزل → (entry - highest) / entry × 100
      // للـ BUY: الربح لما السعر يطلع → (highest - entry) / entry × 100
      const sigType = (r.signal_type || r.signal || 'BUY').toString().toUpperCase();
      const isSell = sigType.includes('SELL');
      const maxProfit = r.highest_price_reached !== null && entry > 0
        ? isSell
          ? ((entry - Number(r.highest_price_reached)) / entry) * 100
          : ((Number(r.highest_price_reached) - entry) / entry) * 100
        : null;
      // RL-FIX-9: كمان max_loss_percent direction-aware
      const maxLoss = r.lowest_price_reached !== null && entry > 0
        ? isSell
          ? ((entry - Number(r.lowest_price_reached)) / entry) * 100   // SELL: loss when price rises
          : ((Number(r.lowest_price_reached) - entry) / entry) * 100   // BUY: loss when price drops
        : null;

      return {
        id: String(r.id),
        stock_symbol: stockSymbol,
        stock_name_ar: stockNameAr,
        signal_type: r.signal_type || r.signal || 'HOLD',
        market: pMarket,
        entry_price: entry,
        target_price: target,
        stop_loss: stop,
        confidence: r.master_score !== null ? Number(r.master_score) : null,
        maestro_score: r.master_score !== null ? Number(r.master_score) : null,
        technical_score: r.technical_score !== null ? Number(r.technical_score) : null,
        fundamental_score: r.fundamental_score !== null ? Number(r.fundamental_score) : null,
        prediction_date: r.prediction_date,
        status: pStatus,
        // LIFECYCLE-MIGRATION: expose the raw `lifecycle_status` column so
        // the UI can segment by proven/testing/closed without relying on
        // the normalized `status` string (which is the legacy outcome
        // display value — TARGET_HIT, STOPPED, EXPIRED, PENDING).
        lifecycle_status: r.lifecycle_status ?? null,
        final_price: r.exit_price !== null ? Number(r.exit_price) : null,
        profit_loss_percent: actualReturn,
        actual_return: actualReturn,
        hit_target: r.hit_target === 1,
        hit_stop_loss: r.hit_stop === 1,
        days_to_target: r.holding_days || 0,
        holding_days: r.holding_days || 0,
        target_hit_date: r.hit_target === 1 ? (r.outcome_date || r.closed_at || null) : null,
        stop_hit_date: r.hit_stop === 1 ? (r.outcome_date || r.closed_at || null) : null,
        evaluation_date: r.outcome_date || r.closed_at || null,
        exit_reason: r.exit_reason || null,
        max_profit_percent: maxProfit !== null ? Math.round(maxProfit * 100) / 100 : null,
        max_loss_percent: maxLoss !== null ? Math.round(maxLoss * 100) / 100 : null,
        risk_reward: riskReward,
        analysis_methods: parsed.analysisMethods,
        reasons: parsed.reasons,
        trend_direction: parsed.trendDirection,
        rsi_value: parsed.rsiValue,
        macd_histogram: parsed.macdHistogram,
        candle_patterns: parsed.candlePatterns,
        sr_zone: parsed.srZone,
        sr_support: parsed.srSupport,
        sr_resistance: parsed.srResistance,
        atr_value: r.atr_at_entry !== null ? Number(r.atr_at_entry) : null,
        ma20_value: parsed.ma20,
        ma50_value: parsed.ma50,
        volume_trend: parsed.volumeTrend,
        volume_spike: parsed.volumeSpike,
        pe_ratio: parsed.peRatio,
        roe: parsed.roe,
        dividend_yield: parsed.dividendYield,
        profit_margin: parsed.profitMargin,
        sector: parsed.sector || norm.sector,
        // RL-FIX-14: prefer persona from DB column (r.persona) — all 4663 production
        // rows have persona stored correctly in the column, but the notes field
        // doesn't contain "persona=xxx" so parseNotes() returns null.
        // Fall back to notes-parsing only for legacy rows without the column.
        persona: r.persona || parsed.persona,
        change_1m: parsed.change1m,
        bollinger_width: parsed.bollingerWidth,
        data_source: 'maestro',
        created_at: r.created_at,
        updated_at: r.outcome_date,
        // FIX-5D: expose highest/lowest price reached + exit_type + target_price_2
        // للـ frontend (PredictionTrackingDashboard + ExecutiveReportView).
        // الـ TS بـ يستخدمها لـ:
        //   - عرض أعمدة "أعلى سعر" / "أقل سعر" في الجدول.
        //   - حساب أقصى ربح/خسارة direction-aware (مش نعتمد على maxProfit من الـ server).
        //   - تمييز TRAILING_PROFIT (💰 خرج بربح) بـ لون زمردي بدل WIN العادي.
        highest_price_reached: r.highest_price_reached !== null && r.highest_price_reached !== undefined
          ? Number(r.highest_price_reached) : null,
        lowest_price_reached: r.lowest_price_reached !== null && r.lowest_price_reached !== undefined
          ? Number(r.lowest_price_reached) : null,
        exit_type: r.exit_type || null,
        target_price_2: r.target_price_2 !== null && r.target_price_2 !== undefined
          ? Number(r.target_price_2) : null,
        // V40.1: Evidence-based fields (from build_institutional_decision)
        evidence_count: r.evidence_count !== null && r.evidence_count !== undefined
          ? Number(r.evidence_count) : 0,
        morning_bell: r.morning_bell === 1,
        kill_filter_result: r.kill_filter_result || null,
        // Task IMPROVEMENT-25-2026-10-07: حقول التحليل الفني الشامل للعميل
        // العميل لازم يعرف: ليه السهم ده؟ وليه الأرقام دي؟
        analysis_reason: (() => {
          // حاول تقرأ analysis_reason من analysis_json
          try {
            if (r.analysis_json) {
              const aj = JSON.parse(r.analysis_json);
              return aj.analysis_reason || aj.reason || null;
            }
          } catch {}
          // fallback: اقرأ من notes
          if (r.notes) {
            const parts = r.notes.split(';').map((p: string) => p.trim());
            const reasonPart = parts.find((p: string) => p.startsWith('reasons='));
            if (reasonPart) return reasonPart.split('=')[1] || null;
          }
          return null;
        })(),
        target_price_3: (() => {
          try {
            if (r.analysis_json) {
              const aj = JSON.parse(r.analysis_json);
              return aj.target_3 || aj.target_price_3 || null;
            }
          } catch {}
          return null;
        })(),
        who_is_buying: (() => {
          try {
            if (r.analysis_json) {
              const aj = JSON.parse(r.analysis_json);
              return aj.who_is_buying_state || null;
            }
          } catch {}
          return null;
        })(),
        hmm_regime: (() => {
          try {
            if (r.analysis_json) {
              const aj = JSON.parse(r.analysis_json);
              return aj.hmm_regime_ar || null;
            }
          } catch {}
          return null;
        })(),
        // الدعوم والمقاومات (من notes أو analysis_json)
        support_level: parsed.srSupport,
        resistance_level: parsed.srResistance,
      };
    });

    // RL-FIX-10: فلترة topPerDay — لكل (يوم، شخصية)، خد أعلى N توقع حسب
    // confidence (master_score). ده بيقلل التوقعات من ~310/أسبوع لـ ~20-35/أسبوع.
    // السبب: العميل ما يقدرش يشترى 310 سهم في أسبوع — أقصى 5 توقعات/يوم منطقي.
    // بنطبّقها بعد فلترة market/status/signal علشان الفلاتر تتم على البيانات الكاملة.
    if (applyQuality && topPerDay > 0) {
      // جمّع حسب (prediction_date, persona)
      const groupKey = (p: any) => {
        const dateStr = String(p.prediction_date || '').slice(0, 10);
        const persona = String(p.persona || 'unknown');
        return `${dateStr}__${persona}`;
      };
      const groups = new Map<string, any[]>();
      for (const p of predictions) {
        const key = groupKey(p);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p);
      }
      // لكل مجموعة: رتّب حسب V40 evidence → R-multiple → confidence (master_score)
      // V40.1: قوة الأدلة أولاً، ثم القوة النسبية (R-multiple)، ثم tech_score
      const kept: any[] = [];
      for (const [, group] of groups) {
        group.sort((a, b) => {
          const evA = Number(a.evidence_count ?? 0);
          const evB = Number(b.evidence_count ?? 0);
          if (evB !== evA) return evB - evA;
          const rrA = Number(a.risk_reward ?? 0);
          const rrB = Number(b.risk_reward ?? 0);
          if (rrB !== rrA) return rrB - rrA;
          const ca = Number(a.confidence ?? a.maestro_score ?? 0);
          const cb = Number(b.confidence ?? b.maestro_score ?? 0);
          return cb - ca;
        });
        kept.push(...group.slice(0, topPerDay));
      }
      predictions = kept;
    }

    // Apply filters
    // MARKET-FILTER-COMPLETE: market filter تم نقله للـ SQL WHERE (سطر ~328-344).
    // شيلنا JS filter القديم لإنه كان بـ يـ reject صفوف الـ 'مصر' (الـ DB بيخزن EGX
    // كـ 'EGX' أو 'مصر'). الـ SQL filter بـ يستخدم `IN ('EGX','مصر')` علشان
    // يلتقط الـ variants كلها.
    if (status !== 'all') {
      predictions = predictions.filter((p) => p.status === status.toUpperCase());
    }
    if (signal !== 'all') {
      predictions = predictions.filter((p) => p.signal_type === signal.toUpperCase());
    }

    // Sort
    const sortCol = sortBy;
    const sortDir = sortOrder.toUpperCase() === 'ASC' ? 1 : -1;
    predictions.sort((a: any, b: any) => {
      const aClosed = a.status !== 'PENDING' ? 0 : 1;
      const bClosed = b.status !== 'PENDING' ? 0 : 1;
      if (aClosed !== bClosed) return aClosed - bClosed;

      let av = a[sortCol];
      let bv = b[sortCol];
      if (av === null) av = sortDir > 0 ? Infinity : -Infinity;
      if (bv === null) bv = sortDir > 0 ? Infinity : -Infinity;
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir * av.localeCompare(bv);
      }
      return sortDir * (Number(av) - Number(bv));
    });

    // V40.2-PROTECTION: apply JS-side filter for top_confidence mode (can't be done in SQL)
    if (isProtectionActive()) {
      predictions = applyProtectionFilter(predictions);
    }

    // FIX-P4-TARGETS: signal-aware validation (fix, not just filter).
    // الـ prediction-validator اللي تحت بـ FILTER مش بـ FIX (بيرفض الـ broken بدل
    // ما يصلّحه). هنا بنستدعي applyValidatedTargets علشان نصلّح الـ targets المكسورة
    // (stop فوق entry، target تحت entry، إلخ) قبل ما الـ filter يـ discard اللي
    // ما يصلحش. الـ signal بـ يحدد اتجاه الـ validation:
    //   BUY  → stop<entry, target>entry
    //   SELL → stop>entry, target<entry
    // ده بـ يحافظ على الـ SELL signals الصحيحة رياضياً (الـ validator القديم كان
    // بـ يكسرها لأنه LONG-only).
    predictions = predictions.map((p: any) => {
      const v = applyValidatedTargets({
        signal: p.signal_type || p.signal || 'BUY',
        entry_price: p.entry_price,
        target1: p.target_price,
        target2: p.target_price_2 ?? null,
        stop_loss: p.stop_loss,
        risk_reward_ratio: p.risk_reward,
      });
      return {
        ...p,
        entry_price: v.entry_price,
        target_price: v.target1,
        target_price_2: v.target2,
        stop_loss: v.stop_loss,
        risk_reward: v.risk_reward_ratio,
      };
    });

    // PREDICTION-VALIDATOR (2026-09-02): filter out invalid predictions before client display
    // المالك: "مستحيل واجهة الموقع تحط العبط ده. أي عميل هاشوف الكلام ده هايهرب على طول."
    // الفحوصات: stop≥entry, target≤entry, daily return anomaly, exit_type consistency, dedup
    const { filterValidPredictions, deduplicatePredictions } = await import('@/lib/prediction-validator');
    const beforeValidation = predictions.length;
    predictions = deduplicatePredictions(predictions);
    const afterDedup = predictions.length;
    const validationResult = filterValidPredictions(predictions);
    predictions = validationResult.valid;
    const invalidCount = validationResult.invalid.length;

    const total = predictions.length;
    const page = predictions.slice(offset, offset + limit);

    // PHASE3-MARKET-SEGREGATION (Task B): لما تكون النتيجة فاضية لسوق غير EGX
    // (sandbox limitation: predictions.db فيها EGX فقط)، نضيف message واضح بدل ما
    // الـ UI يعرض "0 results" بدون سياق. ده بـ يحافظ على Rule 27 (NO-FAKE-DATA)
    // وبيوضّح للعميل إن السوق ده في طور التفعيل.
    const emptyMessage = (total === 0 && canonicalMarket && canonicalMarket !== 'EGX')
      ? NO_PREDICTIONS_MESSAGE_AR
      : undefined;

    return NextResponse.json({
      success: true,
      predictions: page,
      pagination: {
        total,
        limit,
        offset,
        has_more: (offset + limit) < total,
      },
      filters: { market, status, signal, sortBy, sortOrder, minScore, topPerDay, qualityMode },
      protection: isProtectionActive() ? getProtectionDescription() : undefined,
      // PREDICTION-VALIDATOR: إفصاح عن عدد التنبؤات المرفوضة
      validation: {
        before_dedup: beforeValidation,
        after_dedup: afterDedup,
        deduped_removed: beforeValidation - afterDedup,
        invalid_removed: invalidCount,
        valid_shown: predictions.length,
      },
      // HONEST-V3: إفصاح عن مصدر البيانات (local vs production fallback)
      // علشان المطور يقدر يكتشف لو الـ cleanup مش شغّال أو الـ fallback بيخبيه.
      data_source: localIsEmpty ? 'vps-production-fallback' : 'local-db',
      local_row_count: totalLocal,
      // PHASE3-MARKET-SEGREGATION: رسالة احترافية بدل ما الواجهة تفضى بدون تفسير
      ...(emptyMessage ? { message: emptyMessage } : {}),
    }, {
      // GHOST-BUSTER-024: Cache-Control: no-store عشان نمنع التخزين على كل المستويات
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Local-Row-Count': String(totalLocal),
        'X-Data-Source': localIsEmpty ? 'vps-production-fallback' : 'local-db',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:list]', error);
    // PHASE3-MARKET-SEGREGATION: نفس القاعدة — ما نرجّعش 500 للـ frontend.
    // نرجّع 200 + empty predictions + message واضح. لو الـ DB اتكسر، الـ UI
    // هيفضل شغّال بدل ما الـ tab كامل يبقى أحمر.
    return NextResponse.json(
      {
        success: true,
        predictions: [],
        pagination: { total: 0, limit, offset, has_more: false },
        message: INTERNAL_ERROR_MESSAGE_AR,
        data_source: 'error-fallback',
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'X-Data-Source': 'error-fallback',
        },
      }
    );
  }
}
