/**
 * GET /api/sharia — بيانات التوافق الشرعي + نسب التطهير (EGX)
 * ==========================================================
 * القراءة مباشرة من data_engine.db (better-sqlite3) — مفيش Python هنا لأن
 * دي قراءة بحتة. الحساب نفسه (حاسبة التطهير) في /api/sharia/purification.
 *
 * مصدر البيانات: data_engine/scrapers/sharia_compliance_scraper.py
 *   (المصدر الخارجي stocks.templatesnippet.com — JSON ثابت، تحديث أسبوعي)
 *
 * Query:
 *   ?symbol=ABUK        تفاصيل سهم واحد + تفصيل كل المصادر
 *   ?search=بنك         بحث بالرمز أو الاسم العربي
 *   ?consensus=true     بس الأسهم المتوافقة في 6 مصادر أو أكتر (من 8)
 *   ?method=S&P         فلترة على منهجية التطهير
 *   ?source=musaffa     تفصيل حكم مصدر واحد
 *   ?review=true        بس الحالات اللي محتاجة مراجعة يدوية (رمز مختلف / تعارض)
 *   ?limit=100&offset=0
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATA_ENGINE_DB = path.join(process.cwd(), 'db', 'data_engine.db');

const CONSENSUS_MIN = 6;

type SqliteDb = {
  prepare: (sql: string) => {
    get: (...p: unknown[]) => Record<string, unknown> | undefined;
    all: (...p: unknown[]) => Record<string, unknown>[];
  };
  exec: (sql: string) => void;
  pragma: (p: string) => unknown;
  close: () => void;
};

function dbOpen(): SqliteDb | null {
  const fs = require('fs');
  if (!fs.existsSync(DATA_ENGINE_DB)) return null;
  const Database = require('better-sqlite3');
  const db = new Database(DATA_ENGINE_DB, { readonly: true, fileMustExist: true, timeout: 15000 });
  db.pragma('busy_timeout = 15000');
  return db as SqliteDb;
}

function tableExists(db: SqliteDb, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(name);
  return Boolean(row);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  const search = (url.searchParams.get('search') || '').trim();
  const consensusOnly = url.searchParams.get('consensus') === 'true';
  const method = (url.searchParams.get('method') || '').trim();
  const source = (url.searchParams.get('source') || '').trim();
  const limit = Math.max(1, Math.min(1000, parseInt(url.searchParams.get('limit') || '100', 10) || 100));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  let db: SqliteDb | null;
  try {
    db = dbOpen();
  } catch (e) {
    return NextResponse.json(
      { success: false, error: 'db_open_failed', detail: String(e) },
      { status: 500 }
    );
  }
  if (!db) {
    return NextResponse.json(
      { success: false, error: 'data_engine_db_missing', path: DATA_ENGINE_DB },
      { status: 503 }
    );
  }

  try {
    for (const t of ['sharia_metrics', 'sharia_source_status', 'sharia_purification_rates']) {
      if (!tableExists(db, t)) {
        return NextResponse.json(
          {
            success: false,
            error: 'sharia_not_scraped',
            missing_table: t,
            hint: 'python3 data_engine/scrapers/sharia_compliance_scraper.py',
          },
          { status: 503 }
        );
      }
    }

    // ── تفاصيل سهم واحد ──
    if (symbol) {
      const metric = db.prepare('SELECT * FROM sharia_metrics WHERE UPPER(symbol) = ?').get(symbol);
      if (!metric) {
        // FIX (Task FINAL-FIX): بدل ما نرجّع 404 (اللي بـ يسبب console spam)،
        // نرجّع 200 بـ status='not_available' — الـ ShariaBadge بـ يتعامل معاه.
        return NextResponse.json({
          success: true,
          symbol,
          status: 'not_available',
          metric: null,
          sources: [],
          purification_rates: [],
          price: null,
          generated_at: new Date().toISOString(),
        });
      }
      const sources = db
        .prepare(
          `SELECT s.source_key, COALESCE(src.name_ar, s.source_key) AS source_name_ar,
                  s.status, s.percentage, s.note, s.sector, s.grade,
                  s.statement_date, s.source_updated, src.methodology, src.is_active
           FROM sharia_source_status s
           LEFT JOIN sharia_sources src ON src.source_key = s.source_key
           WHERE UPPER(s.symbol) = ?
           ORDER BY s.status, s.source_key`
        )
        .all(symbol);
      const rates = db
        .prepare(
          `SELECT method_key, method_name_ar, rate_pct, basis, is_primary, source_updated
           FROM sharia_purification_rates WHERE symbol = ? ORDER BY is_primary DESC`
        )
        .all(symbol);
      const price = (() => {
        const fs = require('fs');
        const stocksDb = path.join(process.cwd(), 'db', 'stocks.db');
        if (!fs.existsSync(stocksDb)) return null;
        const D = require('better-sqlite3');
        const sdb = new D(stocksDb, { readonly: true, timeout: 10000 });
        const row = sdb
          .prepare('SELECT ticker, name, current_price, dividend_yield, sector FROM stocks WHERE UPPER(ticker) = ?')
          .get(symbol);
        sdb.close();
        return row ?? null;
      })();

      return NextResponse.json({
        success: true,
        symbol,
        metric,
        sources,
        purification_rates: rates,
        price,
        generated_at: new Date().toISOString(),
      });
    }

    // ── قائمة ──
    const where: string[] = [];
    const params: unknown[] = [];
    if (consensusOnly) {
      where.push('m.is_halal_consensus = 1');
    }
    if (search) {
      where.push('(UPPER(m.symbol) LIKE ? OR m.name_ar LIKE ?)');
      params.push(`%${search.toUpperCase()}%`, `%${search}%`);
    }
    if (method) {
      where.push(
        `EXISTS (SELECT 1 FROM sharia_purification_rates r
                 WHERE r.symbol = m.symbol AND UPPER(r.method_key) = ?)`
      );
      params.push(method.toUpperCase());
    }
    if (source) {
      where.push(
        `EXISTS (SELECT 1 FROM sharia_source_status s2
                 WHERE s2.symbol = m.symbol AND s2.source_key = ? AND s2.status = 'compliant')`
      );
      params.push(source);
    }
    if (url.searchParams.get('review') === 'true') {
      where.push('m.needs_review = 1');
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (
      db.prepare(`SELECT COUNT(*) AS n FROM sharia_metrics m ${clause}`).get(params) as { n: number }
    ).n;

    const rows = db
      .prepare(
        `SELECT m.symbol, m.name_ar, m.category_ar, m.category, m.market,
                m.sp_haram_earning_pct, m.haram_earnings_pct, m.loans_pct,
                m.zakat_per_share, m.dividend, m.dividend_yield,
                m.core_activity_ok, m.cash_liquidity_ok, m.haram_investments_ok,
                m.compliant_sources_count, m.active_sources_count, m.is_halal_consensus,
                m.source_updated_max, m.synced_at,
                m.raw_symbol, m.alias_method, m.alias_confidence, m.needs_review,
                (SELECT rate_pct FROM sharia_purification_rates r
                  WHERE r.symbol = m.symbol AND r.is_primary = 1) AS purification_rate,
                (SELECT group_concat(DISTINCT s2.source_key)
                   FROM sharia_source_status s2
                  WHERE s2.symbol = m.symbol AND s2.status = 'compliant') AS compliant_sources
         FROM sharia_metrics m
         ${clause}
         ORDER BY m.is_halal_consensus DESC, m.compliant_sources_count DESC, m.symbol ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Record<string, unknown>[];

    const stats = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN is_halal_consensus = 1 THEN 1 ELSE 0 END) AS consensus_count,
                SUM(CASE WHEN sp_haram_earning_pct IS NOT NULL THEN 1 ELSE 0 END) AS with_sp_rate,
                MAX(source_updated_max) AS latest_source_update
         FROM sharia_metrics`
      )
      .get();

    const sources = db
      .prepare(
        `SELECT source_key, name_ar, methodology, is_active FROM sharia_sources ORDER BY name_ar`
      )
      .all();

    // Alias map — كل الحالات اللي الرمز فيها مختلف أو تعارض، للمراجعة اليدوية
    const aliasMap = db
      .prepare(
        `SELECT source_symbol, resolved_ticker, match_method, confidence, needs_review,
                source_name_ar, matched_in, resolved_at
         FROM sharia_symbol_map WHERE needs_review = 1 OR confidence IS NULL OR confidence != 'high'
         ORDER BY confidence DESC, source_symbol`
      )
      .all();

    const aliasTotals = db
      .prepare(
        `SELECT match_method, confidence, needs_review, COUNT(*) AS n
         FROM sharia_symbol_map GROUP BY 1,2,3 ORDER BY n DESC`
      )
      .all();

    return NextResponse.json({
      success: true,
      source: 'data_engine.db.sharia_metrics',
      upstream: 'https://stocks.templatesnippet.com/data/stocks_merged.json',
      primary_method: 'S&P',
      consensus_min: CONSENSUS_MIN,
      filters: { symbol: symbol || null, search: search || null, consensusOnly, method: method || null, source: source || null },
      stats,
      sources,
      alias_map: {
        totals: aliasTotals,
        review_queue: aliasMap,
      },
      total,
      count: rows.length,
      offset,
      limit,
      rows,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/sharia] Error:', e);
    return NextResponse.json({ success: false, error: 'internal_error', detail: String(e) }, { status: 500 });
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}