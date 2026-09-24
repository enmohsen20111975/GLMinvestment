/**
 * alert-engine.ts — محرك التنبيهات الموحّد (MONEY-TIER2-REBUILD)
 * ============================================================
 *
 * محرك واحد بيفحص 3 مصادر للتنبيهات ويطلق user_notifications:
 *   1. runStockAlertsCheck    — user_stock_watchlists.alert_price_above/below
 *                              مقابل stocks.current_price
 *   2. runGoldAlertsCheck     — gold_alerts table مقابل getLiveEgyptGoldPrices()
 *   3. runPortfolioPnLCheck   — portfolio_assets لكل المستخدمين:
 *                                - خسارة > 10%  → bag_holder_warning
 *                                - ربح  > 15%  → top_up_opportunity
 *
 * قواعد:
 *   - منع التكرار: قبل INSERT، نتحقق من وجود row بنفس
 *     (user_id, type, ticker, message) خلقت في آخر 24 ساعة.
 *   - كل الـ data من SQLite مباشرة — مفيش Python.
 *   - كل function ترجع safe defaults لو DB مش متاح أو جدول ناقص.
 *   - try/catch في كل مكان — الـ engine مايمكنش يقع الطلب.
 *
 * الاستخدام:
 *   import { runAllAlerts } from '@/lib/schedulers/alert-engine';
 *   const result = await runAllAlerts(userId?);
 */

import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { getLiveEgyptGoldPrices } from '@/lib/data-engine-db';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertEngineResult {
  stock_alerts: number;
  gold_alerts: number;
  pnl_alerts: number;
  total: number;
  duration_ms: number;
  errors: string[];
}

export type AlertSeverity = 'info' | 'success' | 'warning' | 'critical';

interface InsertNotificationParams {
  user_id: string;
  type: string;
  title: string;
  message: string;
  severity?: AlertSeverity;
  payload?: string;
  ticker?: string;
}

interface WatchlistRow {
  user_id: string;
  stock_id: number;
  alert_price_above: number | null;
  alert_price_below: number | null;
  alert_change_percent: number | null;
}

interface StockRow {
  id: number;
  ticker: string;
  name: string | null;
  name_ar: string | null;
  current_price: number | null;
  previous_close: number | null;
}

interface GoldAlertRow {
  id: number;
  user_id: string;
  karat: number;
  condition: string;
  threshold_price: number | null;
  is_active: number;
}

interface PortfolioAssetRow {
  id: number;
  user_id: string;
  type: string;
  stock_ticker: string | null;
  quantity: number | null;
  avg_buy_price: number | null;
  total_invested: number | null;
  current_value: number | null;
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/**
 * يضمن إن جدول `user_notifications` موجود وفيه الأعمدة:
 *   severity, payload, read, ticker, created_at
 *
 * يعمل CREATE TABLE IF NOT EXISTS + ALTER TABLE آمن (idempotent).
 */
export function ensureUserNotifColumns(db: SqliteDatabase): void {
  // 1) Create base table if missing
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'system',
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      severity TEXT DEFAULT 'info',
      payload TEXT,
      ticker TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  // 2) ALTER TABLE for legacy schemas missing columns
  const cols = db.prepare("PRAGMA table_info(user_notifications)").all() as { name: string }[];
  const have = new Set(cols.map((c) => c.name));

  const ensureCol = (name: string, def: string): void => {
    if (!have.has(name)) {
      try {
        db.prepare(`ALTER TABLE user_notifications ADD COLUMN ${name} ${def}`).run();
      } catch {
        /* العمود موجود — تجاهل */
      }
    }
  };

  ensureCol('severity', "TEXT DEFAULT 'info'");
  ensureCol('payload', 'TEXT');
  ensureCol('read', 'INTEGER DEFAULT 0');
  ensureCol('ticker', 'TEXT');
  ensureCol('created_at', "TEXT DEFAULT (datetime('now'))");

  // 3) Index for dedup lookups (user_id, type, ticker)
  try {
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_user_notif_dedup ON user_notifications(user_id, type, ticker)`
    ).run();
  } catch {
    /* ignore */
  }
}

/**
 * يضمن وجود جدول gold_alerts + user_stock_watchlists.
 * يُستدعى من runGoldAlertsCheck + runStockAlertsCheck.
 */
function ensureGoldAlertsTable(db: SqliteDatabase): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS gold_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '',
      karat INTEGER NOT NULL DEFAULT 24,
      condition TEXT NOT NULL DEFAULT 'above',
      threshold_price REAL,
      is_active INTEGER DEFAULT 1,
      last_triggered TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
}

function ensureWatchlistTable(db: SqliteDatabase): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_stock_watchlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT DEFAULT '',
      stock_id INTEGER,
      alert_price_above REAL,
      alert_price_below REAL,
      alert_change_percent REAL,
      notes TEXT,
      added_at TEXT DEFAULT (datetime('now')),
      last_viewed TEXT,
      view_count INTEGER DEFAULT 0
    )
  `).run();

  // إضافة purchase_price و quantity لو ناقصين (نفس pattern بتاع schema route)
  const cols = db.prepare("PRAGMA table_info(user_stock_watchlists)").all() as { name: string }[];
  const have = new Set(cols.map((c) => c.name));
  if (!have.has('purchase_price')) {
    try { db.prepare('ALTER TABLE user_stock_watchlists ADD COLUMN purchase_price REAL').run(); } catch { /* exists */ }
  }
  if (!have.has('quantity')) {
    try { db.prepare('ALTER TABLE user_stock_watchlists ADD COLUMN quantity INTEGER').run(); } catch { /* exists */ }
  }
}

function ensurePortfolioAssetsTable(db: SqliteDatabase): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS portfolio_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'stock',
      name TEXT NOT NULL DEFAULT '',
      total_invested REAL NOT NULL DEFAULT 0,
      current_value REAL NOT NULL DEFAULT 0,
      stock_ticker TEXT,
      quantity REAL,
      avg_buy_price REAL,
      added_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
}

function ensureStocksTable(db: SqliteDatabase): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      name TEXT,
      name_ar TEXT,
      current_price REAL,
      previous_close REAL
    )
  `).run();
}

// ---------------------------------------------------------------------------
// Core: insertNotification (with 24h dedup)
// ---------------------------------------------------------------------------

/**
 * يُدرج تنبيه في user_notifications — بعد التحقق من عدم وجود تنبيه مكرر
 * بنفس (user_id, type, ticker, message) في آخر 24 ساعة.
 *
 * Returns: true لو أُدرج row جديد، false لو مكرر (skipped).
 */
function insertNotification(db: SqliteDatabase, p: InsertNotificationParams): boolean {
  try {
    // dedup: نفس user_id + type + ticker + message في آخر 24 ساعة؟
    const dedupSql = `
      SELECT 1 FROM user_notifications
      WHERE user_id = ?
        AND type = ?
        AND ticker IS ?
        AND message = ?
        AND created_at > datetime('now', '-24 hours')
      LIMIT 1
    `;
    const tickerParam = p.ticker ?? null;
    const existing = db.prepare(dedupSql).get(p.user_id, p.type, tickerParam, p.message);
    if (existing) return false;

    db.prepare(`
      INSERT INTO user_notifications (user_id, type, title, message, severity, payload, ticker, read)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      p.user_id,
      p.type,
      p.title,
      p.message,
      p.severity || 'info',
      p.payload || null,
      p.ticker || null,
    );
    return true;
  } catch (err) {
    console.error('[alert-engine] insertNotification failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1) Stock alerts — user_stock_watchlists × stocks.current_price
// ---------------------------------------------------------------------------

/**
 * يفحص كل (أو لمستخدم محدد) صفوف user_stock_watchlists ضد stocks.current_price.
 * لو alert_price_above محدد والسعر الحالي >= العتبة → تنبيه "stock_price" (severity=success).
 * لو alert_price_below محدد والسعر الحالي <= العتبة → تنبيه "stock_price" (severity=warning).
 *
 * Returns: عدد التنبيهات الجديدة اللي اتلقت.
 */
export async function runStockAlertsCheck(userId?: string): Promise<number> {
  try {
    const db = await getFinanceDb();
    ensureWatchlistTable(db);
    ensureStocksTable(db);
    ensureUserNotifColumns(db);

    // جلب الـ watchlist rows (فلترة بـ user_id لو موجود)
    const wlRows: WatchlistRow[] = userId
      ? (db.prepare(
          `SELECT w.user_id, w.stock_id, w.alert_price_above, w.alert_price_below, w.alert_change_percent
           FROM user_stock_watchlists w
           WHERE w.user_id = ?
             AND (w.alert_price_above IS NOT NULL OR w.alert_price_below IS NOT NULL)`
        ).all(userId) as WatchlistRow[])
      : (db.prepare(
          `SELECT w.user_id, w.stock_id, w.alert_price_above, w.alert_price_below, w.alert_change_percent
           FROM user_stock_watchlists w
           WHERE (w.alert_price_above IS NOT NULL OR w.alert_price_below IS NOT NULL)`
        ).all() as WatchlistRow[]);

    if (wlRows.length === 0) return 0;

    let fired = 0;
    for (const w of wlRows) {
      if (!w.stock_id) continue;

      const stock = db.prepare(
        `SELECT id, ticker, name, name_ar, current_price, previous_close
         FROM stocks WHERE id = ? LIMIT 1`
      ).get(w.stock_id) as StockRow | undefined;

      if (!stock || !stock.ticker) continue;

      const currentPrice = Number(stock.current_price || stock.previous_close || 0);
      if (currentPrice <= 0) continue;

      const displayName = stock.name_ar || stock.name || stock.ticker;

      // 1) alert_price_above
      if (w.alert_price_above && Number(w.alert_price_above) > 0 && currentPrice >= Number(w.alert_price_above)) {
        const msg = `سهم ${displayName} (${stock.ticker}) وصل لسعر ${currentPrice.toFixed(2)} ج.م — تجاوز العتبة العليا ${Number(w.alert_price_above).toFixed(2)}`;
        const ok = insertNotification(db, {
          user_id: w.user_id,
          type: 'stock_price',
          title: 'تجاوز السعر المستهدف',
          message: msg,
          severity: 'success',
          ticker: stock.ticker,
          payload: JSON.stringify({ current_price: currentPrice, threshold: Number(w.alert_price_above), direction: 'above' }),
        });
        if (ok) fired++;
      }

      // 2) alert_price_below
      if (w.alert_price_below && Number(w.alert_price_below) > 0 && currentPrice <= Number(w.alert_price_below)) {
        const msg = `سهم ${displayName} (${stock.ticker}) نزل لسعر ${currentPrice.toFixed(2)} ج.م — كسر العتبة السفلى ${Number(w.alert_price_below).toFixed(2)}`;
        const ok = insertNotification(db, {
          user_id: w.user_id,
          type: 'stock_price',
          title: 'انخفاض تحت العتبة',
          message: msg,
          severity: 'warning',
          ticker: stock.ticker,
          payload: JSON.stringify({ current_price: currentPrice, threshold: Number(w.alert_price_below), direction: 'below' }),
        });
        if (ok) fired++;
      }
    }

    return fired;
  } catch (err) {
    console.error('[alert-engine] runStockAlertsCheck failed:', err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// 2) Gold alerts — gold_alerts × getLiveEgyptGoldPrices()
// ---------------------------------------------------------------------------

/**
 * يفحص gold_alerts table مقابل الأسعار اللحظية للذهب في مصر.
 * لو condition='above' والسعر الحالي >= threshold_price → تنبيه "gold_price".
 * لو condition='below' والسعر الحالي <= threshold_price → تنبيه "gold_price".
 *
 * Returns: عدد التنبيهات الجديدة.
 */
export async function runGoldAlertsCheck(userId?: string): Promise<number> {
  try {
    const db = await getFinanceDb();
    ensureGoldAlertsTable(db);
    ensureUserNotifColumns(db);

    // جلب الأسعار اللحية للذهب
    const livePrices = getLiveEgyptGoldPrices();
    if (!livePrices) {
      console.warn('[alert-engine] runGoldAlertsCheck: لا توجد أسعار ذهب متاحة — تخطّي');
      return 0;
    }

    const priceFor = (karat: number): number => {
      if (karat === 24) return Number(livePrices['24k']) || 0;
      if (karat === 21) return Number(livePrices['21k']) || 0;
      if (karat === 18) return Number(livePrices['18k']) || 0;
      return 0;
    };

    // جلب gold_alerts النشطة (فلترة بـ user_id لو موجود)
    const rows: GoldAlertRow[] = userId
      ? (db.prepare(
          `SELECT id, user_id, karat, condition, threshold_price, is_active
           FROM gold_alerts
           WHERE user_id = ? AND is_active = 1`
        ).all(userId) as GoldAlertRow[])
      : (db.prepare(
          `SELECT id, user_id, karat, condition, threshold_price, is_active
           FROM gold_alerts
           WHERE is_active = 1`
        ).all() as GoldAlertRow[]);

    if (rows.length === 0) return 0;

    let fired = 0;
    for (const a of rows) {
      const currentPrice = priceFor(a.karat);
      if (currentPrice <= 0) continue;
      const threshold = Number(a.threshold_price || 0);
      if (threshold <= 0) continue;

      const karatLabel = `عيار ${a.karat}`;
      let triggered = false;

      if (a.condition === 'above' && currentPrice >= threshold) {
        triggered = true;
      } else if (a.condition === 'below' && currentPrice <= threshold) {
        triggered = true;
      }

      if (!triggered) continue;

      const direction = a.condition === 'above' ? 'فوق' : 'تحت';
      const msg = `سعر ذهب ${karatLabel} وصل ${currentPrice.toFixed(2)} ج.م/جرام — ${direction} العتبة ${threshold.toFixed(2)}`;
      const ok = insertNotification(db, {
        user_id: a.user_id,
        type: 'gold_price',
        title: a.condition === 'above' ? 'ارتفاع سعر الذهب' : 'انخفاض سعر الذهب',
        message: msg,
        severity: a.condition === 'above' ? 'success' : 'warning',
        ticker: `GOLD-${a.karat}K`,
        payload: JSON.stringify({ karat: a.karat, condition: a.condition, threshold_price: threshold, current_price: currentPrice }),
      });
      if (ok) {
        fired++;
        // تحديث last_triggered
        try {
          db.prepare(`UPDATE gold_alerts SET last_triggered = datetime('now') WHERE id = ?`).run(a.id);
        } catch { /* ignore */ }
      }
    }

    return fired;
  } catch (err) {
    console.error('[alert-engine] runGoldAlertsCheck failed:', err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// 3) Portfolio P&L — bag_holder_warning + top_up_opportunity
// ---------------------------------------------------------------------------

/**
 * يفحص portfolio_assets (stocks) لكل المستخدمين أو لمستخدم محدد.
 *
 * لكل أصل نوعه 'stock' وفيه stock_ticker + avg_buy_price + quantity:
 *   - نجيب current_price من stocks.current_price
 *   - نحسب pnl_pct = (current_price - avg_buy_price) / avg_buy_price × 100
 *   - لو pnl_pct <= -10  → bag_holder_warning (severity=critical)
 *   - لو pnl_pct >= +15  → top_up_opportunity (severity=success)
 *
 * Returns: عدد التنبيهات الجديدة.
 */
export async function runPortfolioPnLCheck(userId?: string): Promise<number> {
  try {
    const db = await getFinanceDb();
    ensurePortfolioAssetsTable(db);
    ensureStocksTable(db);
    ensureUserNotifColumns(db);

    // جلب كل أسهم المحفظة (فلترة بـ user_id لو موجود)
    const assets: PortfolioAssetRow[] = userId
      ? (db.prepare(
          `SELECT id, user_id, type, stock_ticker, quantity, avg_buy_price, total_invested, current_value
           FROM portfolio_assets
           WHERE user_id = ? AND type = 'stock' AND stock_ticker IS NOT NULL`
        ).all(userId) as PortfolioAssetRow[])
      : (db.prepare(
          `SELECT id, user_id, type, stock_ticker, quantity, avg_buy_price, total_invested, current_value
           FROM portfolio_assets
           WHERE type = 'stock' AND stock_ticker IS NOT NULL`
        ).all() as PortfolioAssetRow[]);

    if (assets.length === 0) return 0;

    // نبني map من ticker → current_price عشان نقلل الـ queries
    const tickerSet = new Set<string>();
    for (const a of assets) {
      if (a.stock_ticker) tickerSet.add(a.stock_ticker.toUpperCase());
    }
    const priceMap = new Map<string, number>();
    if (tickerSet.size > 0) {
      const tickers = Array.from(tickerSet);
      const placeholders = tickers.map(() => '?').join(',');
      const stockRows = db.prepare(
        `SELECT ticker, current_price, previous_close FROM stocks WHERE UPPER(ticker) IN (${placeholders})`
      ).all(...tickers) as { ticker: string; current_price: number | null; previous_close: number | null }[];
      for (const s of stockRows) {
        const price = Number(s.current_price || s.previous_close || 0);
        if (price > 0) priceMap.set(s.ticker.toUpperCase(), price);
      }
    }

    let fired = 0;
    for (const a of assets) {
      const ticker = (a.stock_ticker || '').toUpperCase();
      const avgBuy = Number(a.avg_buy_price || 0);
      const qty = Number(a.quantity || 0);
      if (!ticker || avgBuy <= 0 || qty <= 0) continue;

      const currentPrice = priceMap.get(ticker) || 0;
      if (currentPrice <= 0) continue;

      const pnlPct = ((currentPrice - avgBuy) / avgBuy) * 100;

      // 1) bag_holder_warning — خسارة > 10%
      if (pnlPct <= -10) {
        const lossEgp = (currentPrice - avgBuy) * qty;
        const msg = `سهم ${ticker} خسران ${Math.abs(pnlPct).toFixed(1)}% (خسارة ${Math.abs(lossEgp).toFixed(0)} ج.م) — فكّر في إنقاذه`;
        const ok = insertNotification(db, {
          user_id: a.user_id,
          type: 'bag_holder_warning',
          title: '⚠️ سهم مزنوق يحتاج إنقاذ',
          message: msg,
          severity: 'critical',
          ticker,
          payload: JSON.stringify({ avg_buy_price: avgBuy, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct, loss_egp: lossEgp }),
        });
        if (ok) fired++;
      }

      // 2) top_up_opportunity — ربح > 15%
      if (pnlPct >= 15) {
        const profitEgp = (currentPrice - avgBuy) * qty;
        const msg = `سهم ${ticker} رابح ${pnlPct.toFixed(1)}% (ربح ${profitEgp.toFixed(0)} ج.م) — فرصة لزيادة المركز`;
        const ok = insertNotification(db, {
          user_id: a.user_id,
          type: 'top_up_opportunity',
          title: '🚀 فرصة زيادة مركز',
          message: msg,
          severity: 'success',
          ticker,
          payload: JSON.stringify({ avg_buy_price: avgBuy, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct, profit_egp: profitEgp }),
        });
        if (ok) fired++;
      }
    }

    return fired;
  } catch (err) {
    console.error('[alert-engine] runPortfolioPnLCheck failed:', err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Master: runAllAlerts
// ---------------------------------------------------------------------------

/**
 * يشغّل الـ 3 engines + يرجّع ملخص.
 *
 * @param userId لو محدد، بيفحص المستخدم ده بس. لو undefined، بيفحص الكل.
 *
 * Returns:
 *   {
 *     stock_alerts, gold_alerts, pnl_alerts,
 *     total, duration_ms, errors
 *   }
 */
export async function runAllAlerts(userId?: string): Promise<AlertEngineResult> {
  const start = Date.now();
  const errors: string[] = [];

  let stockAlerts = 0;
  let goldAlerts = 0;
  let pnlAlerts = 0;

  // 1) Stock alerts
  try {
    stockAlerts = await runStockAlertsCheck(userId);
  } catch (err) {
    errors.push(`stock: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2) Gold alerts
  try {
    goldAlerts = await runGoldAlertsCheck(userId);
  } catch (err) {
    errors.push(`gold: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3) Portfolio P&L
  try {
    pnlAlerts = await runPortfolioPnLCheck(userId);
  } catch (err) {
    errors.push(`pnl: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    stock_alerts: stockAlerts,
    gold_alerts: goldAlerts,
    pnl_alerts: pnlAlerts,
    total: stockAlerts + goldAlerts + pnlAlerts,
    duration_ms: Date.now() - start,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Convenience: runAllAlertsForCurrentUser
// ---------------------------------------------------------------------------

/**
 * يحلّل المستخدم الحالي من الـ session، ويشغّل runAllAlerts له.
 * لو مفيش session، يرجع result فاضي + error في errors.
 */
export async function runAllAlertsForCurrentUser(): Promise<AlertEngineResult & { user_id: string | null }> {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return {
        stock_alerts: 0,
        gold_alerts: 0,
        pnl_alerts: 0,
        total: 0,
        duration_ms: 0,
        errors: ['no_session'],
        user_id: null,
      };
    }
    const result = await runAllAlerts(userId);
    return { ...result, user_id: userId };
  } catch (err) {
    return {
      stock_alerts: 0,
      gold_alerts: 0,
      pnl_alerts: 0,
      total: 0,
      duration_ms: 0,
      errors: [`session_error: ${err instanceof Error ? err.message : String(err)}`],
      user_id: null,
    };
  }
}
