/**
 * Engines Status API
 * ==================
 * يحتوي على حالة المحركات الثلاثة:
 * - Data Engine (سحب الأسعار) - port 5000
 * - Analysis Engine (التحليلات) - port 8010 /api/analyzer/status
 * - Prediction Engine (التوقعات) - port 8010 /api/ai-predictions
 *
 * كل محرك يعرض:
 * - running (هل يعمل)
 * - connection (حالة الاتصال)
 * - last_update (آخر تحديث)
 * - errors (الأخطاء)
 * - uptime / latency
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
// P0-14-ASYNC fix (2026-09-27): replaced sync fs.existsSync/fs.readFileSync with
// async fs/promises equivalents in loadJsonFile so the engines-status handlers
// never block the event loop on JSON status file reads.
import { access, readFile } from 'fs/promises';
import path from 'path';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

// ============== Config ==============
const DB_DIR = path.join(process.cwd(), 'db');
const STOCKS_DB = path.join(DB_DIR, 'stocks.db');
const PREDICTIONS_DB = path.join(DB_DIR, 'predictions.db');
const DATA_ENGINE_DB = path.join(DB_DIR, 'data_engine.db');
const ENGINE_STATUS_FILE = path.join(DB_DIR, 'engine_status.json');
const AUTO_REFRESH_STATUS_FILE = path.join(DB_DIR, 'auto_refresh_status.json');

const DATA_ENGINE_URL = process.env.DATA_ENGINE_URL || 'http://localhost:5000';
const VPS_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

// ============== Helpers ==============

async function fetchWithTimeout(url: string, timeoutMs = 3000): Promise<{ ok: boolean; status: number; data: any; latency: number }> {
    const start = Date.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        const latency = Date.now() - start;
        let data: any = null;
        try { data = await res.json(); } catch { }
        return { ok: res.ok, status: res.status, data, latency };
    } catch {
        return { ok: false, status: 0, data: null, latency: Date.now() - start };
    }
}

function safeDbQuery<T>(dbPath: string, query: string, params: any[] = []): T | null {
    try {
        const db = new Database(dbPath, { readonly: true, timeout: 3000 });
        db.pragma('busy_timeout = 3000');
        const result = db.prepare(query).get(...params) as T;
        db.close();
        return result;
    } catch {
        return null;
    }
}

function safeDbQueryAll<T>(dbPath: string, query: string, params: any[] = []): T[] {
    try {
        const db = new Database(dbPath, { readonly: true, timeout: 3000 });
        db.pragma('busy_timeout = 3000');
        const result = db.prepare(query).all(...params) as T[];
        db.close();
        return result;
    } catch {
        return [];
    }
}

// P0-14-ASYNC fix (2026-09-27): loadJsonFile is now async.
async function loadJsonFile(filePath: string): Promise<any | null> {
    try {
        try {
            await access(filePath);
        } catch {
            return null;
        }
        const raw = await readFile(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch { return null; }
}

// ============== Engine Checkers ==============

async function checkDataEngine() {
    const health = await fetchWithTimeout(`${DATA_ENGINE_URL}/health`, 3000);

    let lastUpdate: string | null = null;
    let errorsCount = 0;
    let logs: string[] = [];
    let schedulerActive = false;
    let stocksRunning = false;
    let cryptoRunning = false;
    let metalsRunning = false;

    // Try Flask /status endpoint
    if (health.ok && health.data) {
        const statusRes = await fetchWithTimeout(`${DATA_ENGINE_URL}/status`, 3000);
        if (statusRes.ok && statusRes.data?.engine) {
            const eng = statusRes.data.engine;
            lastUpdate = eng.last_stocks_update || eng.last_crypto_update || eng.last_metals_update || eng.last_sync || null;
            errorsCount = eng.errors?.length || 0;
            logs = eng.logs?.slice(-20) || [];
            schedulerActive = eng.scheduler_active || eng.running || false;
            stocksRunning = eng.stocks_running || false;
            cryptoRunning = eng.crypto_running || false;
            metalsRunning = eng.metals_running || false;
        }
    }

    // Fallback: load from status file
    if (!lastUpdate) {
        const saved = await loadJsonFile(ENGINE_STATUS_FILE);
        if (saved) {
            lastUpdate = saved.last_stocks_update || saved.last_crypto_update || saved.last_metals_update || saved.last_sync || null;
            errorsCount = saved.errors?.length || 0;
            logs = saved.logs?.slice(-20) || [];
            schedulerActive = saved.scheduler_active || saved.running || false;
            stocksRunning = saved.stocks_running || false;
            cryptoRunning = saved.crypto_running || false;
            metalsRunning = saved.metals_running || false;
        }

        // Also try auto_refresh_status.json
        const autoRefresh = await loadJsonFile(AUTO_REFRESH_STATUS_FILE);
        if (autoRefresh) {
            if (!schedulerActive) schedulerActive = autoRefresh.running || false;
            if (autoRefresh.last_run && (!lastUpdate || new Date(autoRefresh.last_run) > new Date(lastUpdate))) {
                lastUpdate = autoRefresh.last_run;
            }
            if (autoRefresh.logs?.length) {
                logs = autoRefresh.logs.slice(-20);
            }
        }
    }

    // Get data counts from DB
    let stocksCount = 0;
    let cryptoCount = 0;
    let goldCount = 0;
    try {
        const r = safeDbQuery<{ count: number }>(DATA_ENGINE_DB, 'SELECT COUNT(*) as count FROM stocks');
        stocksCount = r?.count || 0;
    } catch { }
    try {
        const r = safeDbQuery<{ count: number }>(DATA_ENGINE_DB, 'SELECT COUNT(*) as count FROM crypto_prices');
        cryptoCount = r?.count || 0;
    } catch { }
    try {
        const r = safeDbQuery<{ count: number }>(DATA_ENGINE_DB, 'SELECT COUNT(*) as count FROM gold_prices');
        goldCount = r?.count || 0;
    } catch { }

    // Check price_history freshness (last inserted row) — now reads from data_engine.db.egksco_price_history
    let priceHistoryLastUpdate: string | null = null;
    try {
        const r = safeDbQuery<{ latest: string }>(DATA_ENGINE_DB, 'SELECT MAX(price_date) as latest FROM egksco_price_history');
        priceHistoryLastUpdate = r?.latest || null;
    } catch { }

    // Calculate staleness (minutes since last update)
    const minutesAgo = lastUpdate
        ? Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 60000)
        : null;

    let staleness: 'fresh' | 'stale' | 'old' | 'unknown' = 'unknown';
    if (minutesAgo !== null) {
        if (minutesAgo <= 15) staleness = 'fresh';
        else if (minutesAgo <= 60) staleness = 'stale';
        else staleness = 'old';
    }

    return {
        name: 'Data Engine',
        name_ar: 'محرك البيانات',
        port: 5000,
        url: DATA_ENGINE_URL,
        running: health.ok,
        // FIX: When Data Engine service is down but DB has data, show 'has-data'
        // instead of 'disconnected' — the data exists, it's just not being refreshed.
        connection: health.ok ? 'connected' : (stocksCount > 0 || cryptoCount > 0 ? 'has-data' : 'disconnected'),
        latency_ms: health.latency,
        last_update: lastUpdate,
        minutes_ago: minutesAgo,
        staleness,
        scheduler_active: schedulerActive,
        scrapers: {
            stocks: { running: stocksRunning, count: stocksCount },
            crypto: { running: cryptoRunning, count: cryptoCount },
            metals: { running: metalsRunning, count: goldCount },
        },
        price_history_last_date: priceHistoryLastUpdate,
        errors_count: errorsCount,
        recent_logs: logs,
        description: 'سحب الأسعار من المصادر (TradingView, Crypto, Metals, Forex)',
        update_interval: '5-10 minutes',
    };
}

async function checkAnalysisEngine() {
    // The analysis engine is part of VPS service (port 8010)
    const health = await fetchWithTimeout(`${VPS_URL}/health`, 3000);
    const analyzerStatus = await fetchWithTimeout(`${VPS_URL}/api/analyzer/status`, 3000);

    let lastUpdate: string | null = null;
    let errorsCount = 0;
    let logs: string[] = [];
    let running = false;
    let lastAnalysis: string | null = null;
    let analysisCount = 0;

    if (analyzerStatus.ok && analyzerStatus.data?.success && analyzerStatus.data?.data) {
        const data = analyzerStatus.data.data;
        // FIX: support both camelCase (isRunning, lastRun, lastFullAnalysis) and snake_case
        running = data.isRunning || data.running || data.is_running || false;
        lastUpdate = data.lastRun || data.last_run || data.last_analysis || data.lastFullAnalysis || data.last_full_analysis || data.timestamp || null;
        lastAnalysis = data.lastFullAnalysis || data.last_run || data.last_analysis || data.lastRun || null;
        analysisCount = data.totalAnalyzed || data.total_analyzed || data.analysis_count || 0;
        errorsCount = data.errorCount || data.errors?.length || data.error_count || 0;
        logs = data.recent_logs || data.logs?.slice(-20) || [];
    }

    // Also check /api/analysis for stored analysis freshness
    try {
        const r = safeDbQuery<{ latest: string; count: number }>(
            STOCKS_DB,
            `SELECT MAX(updated_at) as latest, COUNT(*) as count FROM stocks WHERE updated_at IS NOT NULL`
        );
        if (r) {
            analysisCount = r.count || analysisCount;
            if (!lastUpdate && r.latest) lastUpdate = r.latest;
        }
    } catch { }

    // If VPS is up but analyzer endpoint didn't respond, still mark as running
    if (health.ok && !running) {
        running = true; // VPS itself is running
    }

    const minutesAgo = lastUpdate
        ? Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 60000)
        : null;

    let staleness: 'fresh' | 'stale' | 'old' | 'unknown' = 'unknown';
    if (minutesAgo !== null) {
        if (minutesAgo <= 60) staleness = 'fresh';
        else if (minutesAgo <= 180) staleness = 'stale';
        else staleness = 'old';
    }

    return {
        name: 'Analysis Engine',
        name_ar: 'محرك التحليلات',
        port: 8010,
        url: VPS_URL,
        running,
        connection: health.ok ? 'connected' : 'disconnected',
        latency_ms: health.latency,
        last_update: lastUpdate,
        last_analysis: lastAnalysis,
        minutes_ago: minutesAgo,
        staleness,
        analysis_count: analysisCount,
        errors_count: errorsCount,
        recent_logs: logs,
        background_analyzer: analyzerStatus.ok,
        description: 'محرك التحليل الفني والأساسي (Technical + Fundamental + Patterns)',
        update_interval: 'every hour (full) + every 5 min (incremental)',
    };
}

async function checkPredictionEngine() {
    // Predictions are in predictions.db + VPS /api/ai-predictions
    const health = await fetchWithTimeout(`${VPS_URL}/health`, 3000);

    let lastUpdate: string | null = null;
    let predictionCount = 0;
    let todayCount = 0;
    let errorsCount = 0;
    let logs: string[] = [];

    // Check predictions DB directly
    try {
        const today = new Date().toISOString().split('T')[0];

        const total = safeDbQuery<{ count: number }>(
            PREDICTIONS_DB,
            'SELECT COUNT(*) as count FROM predictions'
        );
        predictionCount = total?.count || 0;

        const todayRes = safeDbQuery<{ count: number }>(
            PREDICTIONS_DB,
            'SELECT COUNT(*) as count FROM predictions WHERE prediction_date = ?',
            [today]
        );
        todayCount = todayRes?.count || 0;

        const latest = safeDbQuery<{ latest: string; created: string }>(
            PREDICTIONS_DB,
            'SELECT prediction_date as latest, MAX(created_at) as created FROM predictions'
        );
        if (latest) {
            lastUpdate = latest.created || latest.latest || null;
        }

        // Get signal distribution
        const signals = safeDbQueryAll<{ signal: string; count: number }>(
            PREDICTIONS_DB,
            `SELECT signal, COUNT(*) as count FROM predictions
       WHERE prediction_date = ?
       GROUP BY signal`,
            [today]
        );

        // Try fetching from VPS for live status
        const vpsPred = await fetchWithTimeout(`${VPS_URL}/api/ai-predictions/status`, 3000);
        if (vpsPred.ok && vpsPred.data) {
            errorsCount = vpsPred.data.errors?.length || vpsPred.data.error_count || 0;
            logs = vpsPred.data.recent_logs || vpsPred.data.logs?.slice(-20) || [];
        }

        const minutesAgo = lastUpdate
            ? Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 60000)
            : null;

        let staleness: 'fresh' | 'stale' | 'old' | 'unknown' = 'unknown';
        if (minutesAgo !== null) {
            if (minutesAgo <= 15) staleness = 'fresh';
            else if (minutesAgo <= 60) staleness = 'stale';
            else staleness = 'old';
        }

        return {
            name: 'Prediction Engine',
            name_ar: 'محرك التوقعات',
            port: 8010,
            url: VPS_URL,
            running: health.ok,
            connection: health.ok ? 'connected' : 'disconnected',
            latency_ms: health.latency,
            last_update: lastUpdate,
            minutes_ago: minutesAgo,
            staleness,
            total_predictions: predictionCount,
            today_predictions: todayCount,
            signal_distribution: signals,
            errors_count: errorsCount,
            recent_logs: logs,
            description: 'توليد التوقعات والإشارات (STRONG_BUY, BUY, HOLD, SELL)',
            update_interval: '15 minutes (expected)',
        };
    } catch {
        return {
            name: 'Prediction Engine',
            name_ar: 'محرك التوقعات',
            port: 8010,
            url: VPS_URL,
            running: false,
            connection: 'error',
            latency_ms: 0,
            last_update: null,
            minutes_ago: null,
            staleness: 'unknown' as const,
            total_predictions: 0,
            today_predictions: 0,
            signal_distribution: [],
            errors_count: 1,
            recent_logs: ['Cannot access predictions database'],
            description: 'توليد التوقعات والإشارات',
            update_interval: '15 minutes (expected)',
        };
    }
}

// ============== Main Handler ==============

export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

    try {
        const [dataEngine, analysisEngine, predictionEngine] = await Promise.all([
            checkDataEngine(),
            checkAnalysisEngine(),
            checkPredictionEngine(),
        ]);

        // Overall summary
        const allRunning = dataEngine.running && analysisEngine.running && predictionEngine.running;
        const anyRunning = dataEngine.running || analysisEngine.running || predictionEngine.running;
        const totalErrors = dataEngine.errors_count + analysisEngine.errors_count + predictionEngine.errors_count;

        return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            summary: {
                all_running: allRunning,
                any_running: anyRunning,
                total_errors: totalErrors,
                engines_count: 3,
                running_count: [dataEngine, analysisEngine, predictionEngine].filter(e => e.running).length,
            },
            engines: {
                data: dataEngine,
                analysis: analysisEngine,
                prediction: predictionEngine,
            },
        });
    } catch (error: any) {
        return NextResponse.json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
        }, { status: 500 });
    }
}