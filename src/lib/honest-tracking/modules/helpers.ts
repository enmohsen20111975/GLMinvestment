// maestro helper functions — extracted (Phase 3)

  target_hits?: number | string | null;
  stopped?: number | string | null;
  profit_taken?: number | string | null;
  expired?: number | string | null;
  wins?: number | string | null;
  buys?: number | string | null;
  sells?: number | string | null;
  avg_return?: number | string | null;
  avg_profit?: number | string | null;
  avg_loss?: number | string | null;
  net_pl?: number | string | null;
  avg_rr?: number | string | null;
  avg_holding_days?: number | string | null;
  avg_confidence?: number | string | null;
}

/** Per-market aggregation row used internally by computeComprehensiveStats. */
interface MarketAgg {
  total: number;
  wins: number;
  losses: number;
  closed: number;
  active: number;
  pending: number;
  net_pl: number;
  sr_adoption: number;
  candle_adoption: number;
}

export interface ByMarketRow {
  market: string;
  total: number;
  wins: number;
  losses: number;
  closed: number;
  active: number;
  pending: number;
  win_rate: number;
  net_pl: number;
  avg_return: number | null;
  sr_adoption: number;
  candle_adoption: number;
}

export interface CandlestickPatternStat {
  name: string;
  count: number;
  wins: number;
  losses: number;
  win_rate: number;
}

/** Lesson row — produced by extractLessons and stored in prediction_lessons. */
export interface PredictionLesson {
  type: string;
  category: string;
  rule: string;
  evidence: string;
  failure_rate: number;
  sample_size: number;
  recommendation: string;
  created_at?: string;
}

export function computeDynamicParams(
  baseParams: MaestroParams,
  stock: StockRow | null | undefined,
  ind: Indicators | null,
): MaestroParams {
  const p: MaestroParams = { ...baseParams };
  if (!ind) return p;

  const sector = (stock?.sector || '').toLowerCase();
  const fastSectors = ['technology', 'tech', 'تكنولوجيا', 'pharma', 'أدوية', 'financial', 'مصرفي', 'banking', 'بنوك'];
  const slowSectors = ['utilities', 'مرافق', 'real estate', 'عقارات', 'consumer staples', 'سلع استهلاكية', 'cement', 'أسمنت'];

  // 1) Market regime (stock-level trend)
  if (ind.trend === 'BULLISH') {
    p.rsiOverbought = Math.max(50, p.rsiOverbought - 5);
    p.rsiOversold = Math.max(0, p.rsiOversold - 3);
    p.minRiskReward = Math.max(0.5, p.minRiskReward - 0.2);
  } else if (ind.trend === 'BEARISH') {
    p.rsiOverbought = Math.min(100, p.rsiOverbought + 5);
    p.rsiOversold = Math.min(50, p.rsiOversold + 3);
    p.minRiskReward = Math.min(10, p.minRiskReward + 0.3);
  }

  // 2) Volatility regime
  if (ind.atr && ind.close && ind.close > 0) {
    const atrPct = (ind.atr / ind.close) * 100;
    if (atrPct > 5) {
      p.swingLookback = Math.min(100, p.swingLookback + 5);
      p.atrPeriod = Math.min(100, p.atrPeriod + 2);
      p.rsiPeriod = Math.min(30, p.rsiPeriod + 2);
    } else if (atrPct < 1.5) {
      p.swingLookback = Math.max(5, p.swingLookback - 3);
      p.rsiPeriod = Math.max(5, p.rsiPeriod - 1);
    }
  }

  // 3) Volume regime
  if (ind.volumeTrend === 'spike' || ind.volumeTrend === 'increasing') {
    p.swingLookback = Math.max(5, p.swingLookback - 2);
  }

  // 4) Sector regime
  if (fastSectors.some(s => sector.includes(s))) {
    p.swingLookback = Math.max(5, p.swingLookback - 2);
    p.atrPeriod = Math.max(2, p.atrPeriod - 1);
    p.rsiPeriod = Math.max(5, p.rsiPeriod - 1);
  } else if (slowSectors.some(s => sector.includes(s))) {
    p.swingLookback = Math.min(100, p.swingLookback + 3);
    p.rsiPeriod = Math.min(30, p.rsiPeriod + 1);
  }

  // 5) Profit-taking thresholds
  if (ind.atr && ind.close && ind.close > 0) {
    const atrPct = (ind.atr / ind.close) * 100;
    if (atrPct > 5) {
      p.trailingStopPct = Math.min(0.15, p.trailingStopPct + 0.02);
      p.minProfitPct = Math.min(0.10, p.minProfitPct + 0.02);
    } else if (atrPct < 1.5) {
      p.trailingStopPct = Math.max(0.02, p.trailingStopPct - 0.01);
      p.minProfitPct = Math.max(0.01, p.minProfitPct - 0.01);
    }
  }

  return p;
}

/**
 * computeDynamicParamsV2 — Enhanced version using the Gemini Dynamic Analysis Engine.
 * Calls the existing computeDynamicParams first, then overlays Gemini engine parameters:
 *   • RSI thresholds (overbought/oversold) from Gemini
 *   • ATR multipliers (stop/target) from Gemini
 *   • minRiskReward from Gemini
 * Base atrPeriod / rsiPeriod / swingLookback are kept from the existing function.
 */
export function computeDynamicParamsV2(
  baseParams: MaestroParams,
  stock: StockRow | null | undefined,
  ind: Indicators | null,
): MaestroParams {
  // Step 1: Get the existing dynamic params as the base
  const base = computeDynamicParams(baseParams, stock, ind);
  if (!ind) return base;

  // Step 2: Determine regime / volatility / sector speed for the Gemini engine
  const atrPct = (ind.atr && ind.close && ind.close > 0) ? (ind.atr / ind.close) * 100 : 2;
  const regime = detectStockRegime(
    ind.trend,
    ind.rsi,
    null, // ADX not available in Indicators
    ind.ma20 && ind.close ? ((ind.close - ind.ma20) / ind.ma20) * 100 : null,
    ind.ma50 && ind.close ? ((ind.close - ind.ma50) / ind.ma50) * 100 : null,
  );
  const volatility = classifyVolatility(atrPct);
  const sectorSpeed = classifySectorSpeed(stock?.sector || '');

  // Step 3: Get Gemini engine params
  const gemini = getGeminiDynamicParams(regime, volatility, sectorSpeed);

  // Step 4: Merge — Gemini RSI thresholds, ATR multipliers, minRiskReward override;
  //          keep existing atrPeriod, rsiPeriod, swingLookback
  base.rsiOverbought = gemini.rsiOverbought;
  base.rsiOversold = gemini.rsiOversold;
  base.minRiskReward = gemini.minRiskReward;
  base.atrStopMultiplier = gemini.atrStopMultiplier;
  base.atrTargetMultiplier = gemini.atrTargetMultiplier;

  return base;
}

const MIN_HISTORY_DAYS = 35;        // need >= 35 days to compute RSI14 + ATR14 + MA20 + S/R
const TARGET_MULT = 2.0;            // target = entry ± TARGET_MULT * ATR
const STOP_MULT = 1.5;              // stop   = entry ∓ STOP_MULT * ATR
const EVAL_WINDOW_DAYS = 30;        // verify window
const RECENT_FALLBACK_DAYS = 7;     // use current_price for predictions < 7 days old
const SPLIT_RATIO = 5;              // >5x price jump = stock split (skip)

// ============================================================================
// DB OPENING
// ============================================================================

export function openPredictionsDb(writable = true): Database.Database {
  try {
    return new Database(PRED_DB_PATH, {
      readonly: !writable,
      timeout: 5000,
      fileMustExist: false,
    });
  } catch {
    return new Database(`file:${PRED_DB_PATH}?immutable=1`, {
      readonly: true,
      timeout: 5000,
    });
  }
}

function openReadonly(p: string): Database.Database | null {
  try {
    return new Database(p, { readonly: true, timeout: 5000, fileMustExist: true });
  } catch {
    return null;
  }
}

export function ensureSchema(db: Database.Database): void {
  // Create every table first. SQLite leaves existing tables untouched.
  const tableSql = SCHEMA_SQL.filter(s => s.startsWith('CREATE TABLE'));
  for (const sql of tableSql) {
    db.exec(sql);
  }

  const ensureColumns = (table: string, migrations: Array<[string, string]>) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.length === 0) throw new Error(`Schema setup failed: ${table} was not created`);
    const names = new Set(rows.map(row => row.name));
    for (const [column, sql] of migrations) {
      if (!names.has(column)) {
        try {
          db.exec(sql);
          names.add(column);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/duplicate column name/i.test(message)) {
            throw new Error(`Schema migration failed for ${table}.${column}: ${message}`);
          }
        }
      }
    }
  };

  // Support both fresh installations and every legacy schema previously
  // shipped to production. These are the fields used by insert/verify/stats.
  ensureColumns('predictions', [
    ['market', "ALTER TABLE predictions ADD COLUMN market TEXT DEFAULT 'EGX'"],
    ['signal', "ALTER TABLE predictions ADD COLUMN signal TEXT DEFAULT 'HOLD'"],
    ['signal_type', "ALTER TABLE predictions ADD COLUMN signal_type TEXT DEFAULT 'HOLD'"],
    ['prediction_date', 'ALTER TABLE predictions ADD COLUMN prediction_date TEXT'],
    ['entry_price', 'ALTER TABLE predictions ADD COLUMN entry_price REAL'],
    ['target_price', 'ALTER TABLE predictions ADD COLUMN target_price REAL'],
    ['stop_loss', 'ALTER TABLE predictions ADD COLUMN stop_loss REAL'],
    ['master_score', 'ALTER TABLE predictions ADD COLUMN master_score REAL'],
    ['technical_score', 'ALTER TABLE predictions ADD COLUMN technical_score REAL'],
    ['fundamental_score', 'ALTER TABLE predictions ADD COLUMN fundamental_score REAL'],
    ['ai_pattern_score', 'ALTER TABLE predictions ADD COLUMN ai_pattern_score REAL'],
    ['sentiment_score', 'ALTER TABLE predictions ADD COLUMN sentiment_score REAL'],
    ['outcome_date', 'ALTER TABLE predictions ADD COLUMN outcome_date TEXT'],
    ['exit_price', 'ALTER TABLE predictions ADD COLUMN exit_price REAL'],
    ['actual_return', 'ALTER TABLE predictions ADD COLUMN actual_return REAL'],
    ['hit_target', 'ALTER TABLE predictions ADD COLUMN hit_target INTEGER DEFAULT 0'],
    ['hit_stop', 'ALTER TABLE predictions ADD COLUMN hit_stop INTEGER DEFAULT 0'],
    ['is_correct', 'ALTER TABLE predictions ADD COLUMN is_correct INTEGER'],
    ['holding_days', 'ALTER TABLE predictions ADD COLUMN holding_days INTEGER'],
    ['notes', 'ALTER TABLE predictions ADD COLUMN notes TEXT'],
    ['exit_reason', 'ALTER TABLE predictions ADD COLUMN exit_reason TEXT'],
    ['risk_reward', 'ALTER TABLE predictions ADD COLUMN risk_reward REAL'],
    ['atr_at_entry', 'ALTER TABLE predictions ADD COLUMN atr_at_entry REAL'],
    ['highest_price_reached', 'ALTER TABLE predictions ADD COLUMN highest_price_reached REAL'],
    ['lowest_price_reached', 'ALTER TABLE predictions ADD COLUMN lowest_price_reached REAL'],
    ['is_trend_following', 'ALTER TABLE predictions ADD COLUMN is_trend_following INTEGER DEFAULT 0'],
    ['trailing_stop_atr_mult', 'ALTER TABLE predictions ADD COLUMN trailing_stop_atr_mult REAL'],
    ['initial_stop_atr_mult', 'ALTER TABLE predictions ADD COLUMN initial_stop_atr_mult REAL'],
    ['confidence', 'ALTER TABLE predictions ADD COLUMN confidence REAL'],
    // HONEST-TRACKING-FIX: الأعمدة اللي كانت ناقصة وبتسبب خطأ "no such column"
    ['exit_type', 'ALTER TABLE predictions ADD COLUMN exit_type TEXT'],
    ['persona', 'ALTER TABLE predictions ADD COLUMN persona TEXT'],
    ['target_price_2', 'ALTER TABLE predictions ADD COLUMN target_price_2 REAL'],
    // SCHEMA-MISMATCH-FIX (أغسطس 2026): الـ trading pipeline (daily_closer.py +
    // prediction_tracker.py) بـ يكتب status='CLOSED' + exit_type + pnl_pct لكن
    // مش بـ يكتب outcome_date/actual_return/is_correct. بدون الأعمدة دي، الـ
    // honest-tracking APIs بـ تحسب التوقعات المقفولة دي كـ PENDING → الـ dashboard
    // بـ يعرض 0% win rate و 2 صفقة مقفولة بس (بدل 97). بنضيف status + pnl_pct +
    // closed_at لـ ensureSchema علشان أي DB (حتى الفريش) يبقى عندهم.
    ['status', 'ALTER TABLE predictions ADD COLUMN status TEXT'],
    ['pnl_pct', 'ALTER TABLE predictions ADD COLUMN pnl_pct REAL'],
    ['closed_at', 'ALTER TABLE predictions ADD COLUMN closed_at TEXT'],
    // FIX-P2-PREDICTIONS (AUDIT-1-PREDICTIONS): audit trail columns so the
    // system can prove a recommendation was actually published to Telegram
    // BEFORE the price moved. Stats + missed-opportunities endpoints filter
    // on `was_published = 1` so test/backfill rows don't inflate the win
    // rate. `target_hit_at` + `stop_hit_at` are kept separate from
    // `outcome_date` so the temporal ordering between target/stop hits can
    // be reconstructed. See prisma/predictions-schema.prisma for full notes.
    ['published_at', 'ALTER TABLE predictions ADD COLUMN published_at TEXT'],
    ['telegram_message_id', 'ALTER TABLE predictions ADD COLUMN telegram_message_id TEXT'],
    ['was_published', 'ALTER TABLE predictions ADD COLUMN was_published INTEGER DEFAULT 0'],
    ['target_hit_at', 'ALTER TABLE predictions ADD COLUMN target_hit_at TEXT'],
    ['stop_hit_at', 'ALTER TABLE predictions ADD COLUMN stop_hit_at TEXT'],
  ]);

  ensureColumns('stored_analyses', [
    ['market', "ALTER TABLE stored_analyses ADD COLUMN market TEXT DEFAULT 'EGX'"],
    ['signal', "ALTER TABLE stored_analyses ADD COLUMN signal TEXT DEFAULT 'HOLD'"],
    ['maestro_score', 'ALTER TABLE stored_analyses ADD COLUMN maestro_score REAL DEFAULT 0'],
    ['confidence', 'ALTER TABLE stored_analyses ADD COLUMN confidence REAL DEFAULT 0'],
    ['entry_price', 'ALTER TABLE stored_analyses ADD COLUMN entry_price REAL'],
    ['target_price', 'ALTER TABLE stored_analyses ADD COLUMN target_price REAL'],
    ['stop_loss', 'ALTER TABLE stored_analyses ADD COLUMN stop_loss REAL'],
