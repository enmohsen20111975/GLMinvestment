import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
// P0-14-ASYNC fix (2026-09-27): replaced sync existsSync with async access
// from fs/promises so the repair POST handler never blocks the event loop
// on database file existence checks. (unlinkSync/renameSync/copyFileSync
// imports were unused — removed.)
import { access } from 'fs/promises';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DB_DIR = path.join(process.cwd(), 'db');

// P0-14-ASYNC fix (2026-09-27): async helper to check file existence.
async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { /* safe-by-design */ return false; }
}

interface RepairStep {
  step: string;
  status: 'success' | 'warning' | 'error' | 'skipped';
  message: string;
  details?: string;
}

function openSafely(dbPath: string, mode: 'readonly' | 'write' = 'readonly'): Database.Database | null {
  try {
    if (mode === 'readonly') {
      return new Database(dbPath, { readonly: true, fileMustExist: false });
    }
    return new Database(dbPath, { fileMustExist: false });
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

function ensureTableExists(db: Database.Database, tableName: string, createSQL: string): boolean {
  try {
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(tableName);
    if (!exists) {
      db.exec(createSQL);
      return true; // table was created
    }
    return false; // table already existed
  } catch { // silent fallback (safe-by-design)
    return false;
  }
}

/**
 * POST /api/admin/db-manager/repair
 * 
 * Repair a database:
 * 1. Integrity check
 * 2. WAL checkpoint (flush WAL to main file)
 * 3. Recreate missing tables
 * 4. Reindex all tables
 * 5. VACUUM (if safe)
 * 6. Re-sync cached_analysis from predictions.db to stocks.db (if applicable)
 * 
 * Body: { db: string, steps?: string[] }
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const { db: dbName, steps: requestedSteps } = body as { db: string; steps?: string[] };

    if (!dbName) {
      return NextResponse.json({ success: false, error: 'db is required' }, { status: 400 });
    }

    // Validate db name — prevent path traversal
    const safeName = dbName.replace(/[^a-zA-Z0-9_.-]/g, '');
    if (safeName !== dbName || dbName.includes('..')) {
      return NextResponse.json({ success: false, error: 'Invalid database name' }, { status: 400 });
    }

    const dbPath = path.join(DB_DIR, safeName);
    if (!(await pathExists(dbPath))) {
      return NextResponse.json({ success: false, error: `Database file not found: ${safeName}` }, { status: 404 });
    }

    const log: RepairStep[] = [];
    const allSteps = ['integrity', 'wal_checkpoint', 'recreate_tables', 'reindex', 'vacuum', 'sync_analysis'];
    const steps = requestedSteps?.length ? requestedSteps.filter(s => allSteps.includes(s)) : allSteps;

    // ═══ Step 1: Integrity Check ═══
    if (steps.includes('integrity')) {
      const db = openSafely(dbPath, 'readonly');
      if (db) {
        try {
          const rows = db.pragma('integrity_check') as { integrity_check: string }[];
          const ok = rows.length === 1 && rows[0].integrity_check === 'ok';
          log.push({
            step: 'integrity',
            status: ok ? 'success' : 'error',
            message: ok ? 'قاعدة البيانات سليمة' : 'توجد مشاكل في السلامة',
            details: ok ? undefined : rows.map(r => r.integrity_check).join('\n'),
          });
        } catch (e) {
          log.push({
            step: 'integrity',
            status: 'error',
            message: `فشل فحص السلامة: ${String((e as Error)?.message || e)}`,
          });
        } finally {
          db.close();
        }
      } else {
        log.push({ step: 'integrity', status: 'error', message: 'لا يمكن فتح قاعدة البيانات' });
      }
    }

    // ═══ Step 2: WAL Checkpoint ═══
    if (steps.includes('wal_checkpoint')) {
      const db = openSafely(dbPath, 'write');
      if (db) {
        try {
          db.pragma('journal_mode = WAL');
          const result = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number; log: number; checkpointed: number }[];
          const r = result[0];
          log.push({
            step: 'wal_checkpoint',
            status: r?.busy ? 'warning' : 'success',
            message: r?.busy
              ? `WAL checkpoint جزئي (مشغول) — تم تحويل ${r.checkpointed} صفحة`
              : `WAL checkpoint بنجاح — تم تحويل ${r?.checkpointed || 0} صفحة`,
            details: JSON.stringify(r),
          });
        } catch (e) {
          log.push({
            step: 'wal_checkpoint',
            status: 'warning',
            message: `فشل WAL checkpoint: ${String((e as Error)?.message || e)}`,
          });
        } finally {
          db.close();
        }
      } else {
        log.push({ step: 'wal_checkpoint', status: 'error', message: 'لا يمكن فتح قاعدة البيانات للكتابة' });
      }
    }

    // ═══ Step 3: Recreate Missing Tables ═══
    if (steps.includes('recreate_tables')) {
      const db = openSafely(dbPath, 'write');
      if (db) {
        try {
          let recreated = 0;

          if (safeName === 'stocks.db') {
            // Ensure critical tables exist in stocks.db
            const tables: Record<string, string> = {
              stocks: `CREATE TABLE IF NOT EXISTS stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT UNIQUE,
                name TEXT,
                name_ar TEXT,
                market TEXT DEFAULT 'EGX',
                sector TEXT,
                industry TEXT,
                current_price REAL,
                previous_close REAL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                change_percent REAL,
                volume INTEGER DEFAULT 0,
                market_cap REAL,
                pe_ratio REAL,
                pb_ratio REAL,
                ps_ratio REAL,
                eps REAL,
                roe REAL,
                roa REAL,
                is_halal INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                is_crypto INTEGER DEFAULT 0,
                is_egx30 INTEGER DEFAULT 0,
                is_egx70 INTEGER DEFAULT 0,
                is_egx100 INTEGER DEFAULT 0,
                last_update TEXT
              )`,
              cached_analysis: `CREATE TABLE IF NOT EXISTS cached_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT UNIQUE,
                sector TEXT,
                current_price REAL,
                recommendation TEXT,
                composite_score REAL,
                target_price REAL,
                stop_loss REAL,
                signal TEXT,
                confidence REAL,
                analysis_json TEXT,
                master_score REAL,
                risk_level TEXT,
                technical_score REAL,
                fundamental_score REAL,
                sentiment_score REAL,
                risk_score REAL,
                momentum_score REAL,
                trend TEXT,
                liquidity_level TEXT,
                volatility REAL,
                upside_potential REAL,
                is_tradeable INTEGER,
                volume_trend TEXT,
                price_strength REAL,
                created_at TEXT,
                updated_at TEXT,
                analysis_date TEXT,
                price_change_1d REAL,
                price_change_1w REAL,
                price_change_1m REAL
              )`,
              stock_daily_prices: `CREATE TABLE IF NOT EXISTS stock_daily_prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                price_date TEXT,
                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume INTEGER DEFAULT 0,
                change_percent REAL,
                fetch_time TEXT
              )`,
              predictions: `CREATE TABLE IF NOT EXISTS predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                signal TEXT,
                signal_type TEXT,
                prediction_date TEXT,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                master_score REAL,
                technical_score REAL,
                fundamental_score REAL,
                ai_pattern_score REAL,
                sentiment_score REAL,
                outcome_date TEXT,
                exit_price REAL,
                actual_return REAL,
                hit_target INTEGER,
                hit_stop INTEGER,
                is_correct INTEGER,
                holding_days INTEGER,
                notes TEXT,
                market TEXT,
                confidence REAL,
                created_at TEXT
              )`,
              signal_logs: `CREATE TABLE IF NOT EXISTS signal_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                signal_type TEXT,
                signal_value REAL,
                indicator_name TEXT,
                persona TEXT,
                signal_date TEXT,
                outcome TEXT,
                return_pct REAL,
                verified INTEGER DEFAULT 0,
                created_at TEXT,
                status TEXT DEFAULT 'active',
                pnl_pct REAL,
                persona_name TEXT,
                sector TEXT
              )`,
              outcome_logs: `CREATE TABLE IF NOT EXISTS outcome_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id INTEGER,
                close_date TEXT,
                actual_exit_price REAL,
                close_reason TEXT,
                gross_profit_loss REAL,
                net_profit_loss REAL,
                profit_loss_percent REAL,
                days_open INTEGER,
                max_favorable REAL,
                max_adverse REAL,
                mae_pct REAL,
                mfe_pct REAL,
                created_at TEXT,
                stock_id INTEGER
              )`,
            };

            for (const [name, sql] of Object.entries(tables)) {
              const created = ensureTableExists(db, name, sql);
              if (created) {
                recreated++;
                log.push({
                  step: 'recreate_tables',
                  status: 'warning',
                  message: `تم إنشاء جدول ${name} (كان مفقوداً)`,
                });
              }
            }
          } else if (safeName === 'predictions.db') {
            const tables: Record<string, string> = {
              predictions: `CREATE TABLE IF NOT EXISTS predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                signal TEXT,
                signal_type TEXT,
                prediction_date TEXT,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                master_score REAL,
                technical_score REAL,
                fundamental_score REAL,
                ai_pattern_score REAL,
                sentiment_score REAL,
                outcome_date TEXT,
                exit_price REAL,
                actual_return REAL,
                hit_target INTEGER,
                hit_stop INTEGER,
                is_correct INTEGER,
                holding_days INTEGER,
                notes TEXT,
                market TEXT,
                confidence REAL,
                created_at TEXT
              )`,
              stored_analyses: `CREATE TABLE IF NOT EXISTS stored_analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                market TEXT,
                maestro_score REAL,
                recommendation TEXT,
                recommendation_ar TEXT,
                confidence REAL,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                risk_reward REAL,
                regime TEXT,
                regime_score REAL,
                regime_confidence REAL,
                timeframe_score REAL,
                timeframe_aligned INTEGER,
                timeframe_count INTEGER,
                volume_ratio REAL,
                liquidity_rating TEXT,
                news_risk_level TEXT,
                has_cbe_news INTEGER,
                analysis_json TEXT,
                analysis_type TEXT,
                analysis_version TEXT,
                created_at TEXT,
                updated_at TEXT
              )`,
              persona_predictions: `CREATE TABLE IF NOT EXISTS persona_predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                market TEXT,
                maestro_score REAL,
                recommendation TEXT,
                recommendation_ar TEXT,
                confidence REAL,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                risk_reward REAL,
                regime TEXT,
                regime_score REAL,
                timeframe_aligned INTEGER,
                timeframe_count INTEGER,
                volume_ratio REAL,
                liquidity_rating TEXT,
                narrative_json TEXT,
                gambler_json TEXT,
                investor_json TEXT,
                context_json TEXT,
                created_at TEXT,
                updated_at TEXT
              )`,
            };

            for (const [name, sql] of Object.entries(tables)) {
              const created = ensureTableExists(db, name, sql);
              if (created) {
                recreated++;
                log.push({
                  step: 'recreate_tables',
                  status: 'warning',
                  message: `تم إنشاء جدول ${name} (كان مفقوداً)`,
                });
              }
            }
          }

          if (recreated === 0) {
            log.push({
              step: 'recreate_tables',
              status: 'success',
              message: 'كل الجداول موجودة — لا حاجة لإعادة إنشاء',
            });
          }
        } catch (e) {
          log.push({
            step: 'recreate_tables',
            status: 'error',
            message: `فشل إعادة إنشاء الجداول: ${String((e as Error)?.message || e)}`,
          });
        } finally {
          db.close();
        }
      } else {
        log.push({ step: 'recreate_tables', status: 'error', message: 'لا يمكن فتح قاعدة البيانات للكتابة' });
      }
    }

    // ═══ Step 4: Reindex ═══
    if (steps.includes('reindex')) {
      const db = openSafely(dbPath, 'write');
      if (db) {
        try {
          db.exec('REINDEX');
          log.push({ step: 'reindex', status: 'success', message: 'تم إعادة بناء الفهارس بنجاح' });
        } catch (e) {
          log.push({
            step: 'reindex',
            status: 'warning',
            message: `فشل إعادة بناء الفهارس: ${String((e as Error)?.message || e)}`,
          });
        } finally {
          db.close();
        }
      } else {
        log.push({ step: 'reindex', status: 'error', message: 'لا يمكن فتح قاعدة البيانات' });
      }
    }

    // ═══ Step 5: VACUUM ═══
    if (steps.includes('vacuum')) {
      const db = openSafely(dbPath, 'write');
      if (db) {
        try {
          // Switch to DELETE mode first to remove WAL artifacts, then VACUUM
          db.pragma('journal_mode = DELETE');
          db.exec('VACUUM');
          db.pragma('journal_mode = WAL');
          log.push({ step: 'vacuum', status: 'success', message: 'تم ضغط قاعدة البيانات بنجاح' });
        } catch (e) {
          log.push({
            step: 'vacuum',
            status: 'warning',
            message: `فشل الضغط: ${String((e as Error)?.message || e)}`,
          });
        } finally {
          db.close();
        }
      } else {
        log.push({ step: 'vacuum', status: 'error', message: 'لا يمكن فتح قاعدة البيانات' });
      }
    }

    // ═══ Step 6: Sync Analysis (stocks.db only) ═══
    if (steps.includes('sync_analysis') && safeName === 'stocks.db') {
      const stocksDb = openSafely(dbPath, 'write');
      const predPath = path.join(DB_DIR, 'predictions.db');
      const predDb = (await pathExists(predPath)) ? openSafely(predPath, 'readonly') : null;

      if (stocksDb && predDb) {
        try {
          // Get stored_analyses from predictions.db
          const analyses = predDb.prepare(`
            SELECT ticker, market, maestro_score, recommendation, recommendation_ar,
                   confidence, entry_price, target_price, stop_loss, risk_reward,
                   regime, regime_score, volume_ratio, liquidity_rating,
                   analysis_json, created_at, updated_at
            FROM stored_analyses
            WHERE maestro_score > 0
          `).all() as Record<string, any>[];

          let synced = 0;
          const upsert = stocksDb.prepare(`
            INSERT OR REPLACE INTO cached_analysis (
              ticker, sector, current_price, recommendation, composite_score,
              target_price, stop_loss, signal, confidence, analysis_json,
              master_score, risk_level, technical_score, fundamental_score,
              updated_at, analysis_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
          `);

          const insertMany = stocksDb.transaction((items: Record<string, any>[]) => {
            for (const a of items) {
              try {
                const score = a.maestro_score || 50;
                const conf = a.confidence || 50;
                const riskLevel = conf >= 70 ? 'low' : conf >= 50 ? 'medium' : conf >= 30 ? 'high' : 'very_high';
                const signal = (a.recommendation || 'hold').toUpperCase();

                upsert.run(
                  a.ticker,
                  a.market || 'EGX',
                  a.entry_price || 0,
                  a.recommendation || 'hold',
                  score,
                  a.target_price || null,
                  a.stop_loss || null,
                  signal,
                  conf,
                  a.analysis_json || null,
                  score,
                  riskLevel,
                  score * 0.6,
                  score * 0.4,
                  a.updated_at || a.created_at || null,
                );
                synced++;
              } catch { // silent fallback (safe-by-design)
                // Skip individual failures
              }
            }
          });

          insertMany(analyses);

          log.push({
            step: 'sync_analysis',
            status: synced > 0 ? 'success' : 'warning',
            message: synced > 0
              ? `تم مزامنة ${synced} تحليل من predictions.db إلى cached_analysis`
              : 'لا توجد تحليلات جديدة للمزامنة',
            details: `predictions.db had ${analyses.length} analyses, synced ${synced}`,
          });
        } catch (e) {
          log.push({
            step: 'sync_analysis',
            status: 'error',
            message: `فشلت مزامنة التحليلات: ${String((e as Error)?.message || e)}`,
          });
        } finally {
          stocksDb.close();
          predDb.close();
        }
      } else {
        if (stocksDb) stocksDb.close();
        if (predDb) predDb.close();
        log.push({
          step: 'sync_analysis',
          status: 'skipped',
          message: 'predictions.db غير متاح — تم تخطي المزامنة',
        });
      }
    }

    // Summary
    const hasErrors = log.some(l => l.status === 'error');
    const hasWarnings = log.some(l => l.status === 'warning');

    return NextResponse.json({
      success: !hasErrors,
      database: safeName,
      steps: log,
      summary: {
        total: log.length,
        success: log.filter(l => l.status === 'success').length,
        warnings: log.filter(l => l.status === 'warning').length,
        errors: log.filter(l => l.status === 'error').length,
        skipped: log.filter(l => l.status === 'skipped').length,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[POST /api/admin/db-manager/repair] Error:', error);
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}
