/**
 * GET /api/admin/engines/logs
 * ===========================
 * Task 33 (Engine Control Room Radical Fix Battalion):
 *   Returns the tail of one (or all) engine's log file(s) from /tmp/*.log.
 *
 *   Two modes:
 *     (A) Per-engine mode  — `?engine=data_engine&limit=50`
 *         Returns:  { engine, label, lines, total_lines, fetched_at, file_exists, files }
 *         Lines from ALL log files mapped to that engine are concatenated and tailed
 *         to `limit` lines, oldest-first. New format used by the Live Log Console.
 *
 *     (B) All-engines mode — `?limit=50` (no engine query param)
 *         Returns the existing EngineLogsResponse shape that EngineControlRoomTab
 *         already consumes (backward-compat for the deep-view sub-tabs +
 *         aggregated error console):
 *         {
 *           success, timestamp,
 *           engines: { [engineKey]: { label, files: EngineLogResult[] } },
 *           errors_only: [{ engine, path, line, mtime }]
 *         }
 *
 *   Rule 67 (ROOT-CAUSE-FIRST): the Task 31-B agent CLAIMED to build this route
 *   but the file never existed on disk → the UI's `fetch('/api/admin/engines/logs')`
 *   was 404-ing silently and the entire Live Log Console + error console was
 *   showing empty states. This file is the root-cause fix.
 *
 *   Rule 68 (AGENT-QUALITY-GATE): file existence verified via `test -f` +
 *   curl test (200/401) before claiming done.
 *
 *   Rule 20: read-only — only `fs.promises.readFile` + `stat`. No writes.
 *   Rule 30: palette handled in UI; this route emits JSON only.
 *   Auth: admin only (requireAdminAsync).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { readFile, stat, open } from 'fs/promises';

export const dynamic = 'force-dynamic';

// ----------------------------------------------------------------------------
// Engine → log file(s) mapping — Single Source of Truth.
//
// Mirrors the crontab.txt log redirections + the control route's log_file
// fields so the UI's status pills + Live Log Console + Error Console all
// read from the same files the engines actually write to.
// ----------------------------------------------------------------------------
interface EngineLogSpec {
  label: string;
  /** Multiple log files per engine are tail-merged in the per-engine mode. */
  files: string[];
}

const ENGINE_LOG_FILES: Record<string, EngineLogSpec> = {
  data_engine: {
    label: 'محرك البيانات',
    files: [
      '/tmp/data_engine.log',          // Flask server stdout (the actual daemon)
      '/tmp/multi_scraper.log',        // hourly multi-market scraper
      '/tmp/tradingview.log',          // 5-min TradingView EGX scraper
      '/tmp/price_updater_morning.log',// 09:00 Cairo daily OHLC updater
    ],
  },
  news: {
    label: 'محرك الأخبار',
    files: ['/tmp/news_collector.log'],
  },
  predictions: {
    label: 'محرك التوقعات V40.2',
    files: [
      '/tmp/v40_2_morning.log',        // 03:00 UTC — pre-open predictions
      '/tmp/v40_2_evening.log',        // 13:30 UTC — post-close predictions
      '/tmp/v40_2_intraday.log',      // every 5 min — intraday scanner
    ],
  },
  learning: {
    label: 'محرك التعلّم الذكي',
    files: ['/tmp/learning_engine.log'],
  },
  sharia: {
    label: 'الفحص الشرعي',
    files: ['/tmp/sharia_scraper.log'],
  },
};

const VALID_ENGINES = new Set(Object.keys(ENGINE_LOG_FILES));

// ----------------------------------------------------------------------------
// Read a log file's tail safely.
//   - Returns `{ exists: false, lines: [], mtime: null, size: 0 }` on ENOENT.
//   - Returns `{ exists: true, lines: [...], mtime, size }` on success.
//   - NEVER throws — missing log files are a normal state (engine never ran).
// ----------------------------------------------------------------------------
interface LogReadResult {
  path: string;
  exists: boolean;
  mtime: string | null;
  size: number;
  lines: string[];
  error?: string;
}

async function readLogTail(filePath: string, limit = 50): Promise<LogReadResult> {
  try {
    const st = await stat(filePath);
    // Don't read huge files in full — read the last 256 KiB only (≈ 2000 lines).
    const TAIL_BYTES = 256 * 1024;
    let raw: string;
    if (st.size > TAIL_BYTES) {
      const fh = await open(filePath, 'r');
      try {
        const buf = Buffer.alloc(TAIL_BYTES);
        await fh.read(buf, 0, TAIL_BYTES, st.size - TAIL_BYTES);
        raw = buf.toString('utf-8');
        // If we sliced mid-line, drop the first (likely partial) line.
        const firstNewline = raw.indexOf('\n');
        if (firstNewline > 0) raw = raw.slice(firstNewline + 1);
      } finally {
        await fh.close();
      }
    } else {
      raw = await readFile(filePath, 'utf-8');
    }
    const allLines = raw.split('\n').filter(l => l !== '');
    const lines = allLines.slice(-limit);
    return {
      path: filePath,
      exists: true,
      mtime: st.mtime.toISOString(),
      size: st.size,
      lines,
    };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return { path: filePath, exists: false, mtime: null, size: 0, lines: [] };
    }
    return {
      path: filePath,
      exists: false,
      mtime: null,
      size: 0,
      lines: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function looksLikeError(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /\b(error|traceback|exception|fail|crash|denied|refused|timeout|unreachable|critical)\b/i.test(t);
}

// ----------------------------------------------------------------------------
// GET handler — see file-header docstring for the two modes.
// ----------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const engine = url.searchParams.get('engine');
    const limitRaw = url.searchParams.get('limit');
    const limit = Math.min(Math.max(parseInt(limitRaw || '50', 10) || 50, 1), 500);
    const errorsOnly = url.searchParams.get('errors_only') === '1' || url.searchParams.get('errors_only') === 'true';

    // -------------------------------------------------------------------------
    // (A) Per-engine mode — single engine, flat `lines` array.
    // -------------------------------------------------------------------------
    if (engine) {
      if (!VALID_ENGINES.has(engine)) {
        return NextResponse.json(
          {
            success: false,
            error: 'invalid_engine',
            valid: Array.from(VALID_ENGINES),
            provided: engine,
          },
          { status: 400 },
        );
      }
      const spec = ENGINE_LOG_FILES[engine];
      const fileResults = await Promise.all(spec.files.map(f => readLogTail(f, limit)));

      // Merge all files' lines into one flat list (preserving file order, then
      // chronological order within each file — assumes each file is append-only).
      const merged: Array<{ line: string; path: string; mtime: string | null }> = [];
      for (const r of fileResults) {
        if (!r.exists) continue;
        for (const line of r.lines) {
          merged.push({ line, path: r.path, mtime: r.mtime });
        }
      }
      // Tail to `limit` (we may have many files each contributing up to `limit`
      // lines, but the UI only wants the most recent `limit` overall).
      const tail = merged.slice(-limit);
      const lines = tail.map(t => t.line);

      // Pick the latest mtime across files for "last update" display.
      const mtimes = fileResults.map(r => r.mtime).filter(Boolean) as string[];
      const latestMtime = mtimes.length > 0
        ? mtimes.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
        : null;

      const anyExists = fileResults.some(r => r.exists);

      return NextResponse.json({
        success: true,
        engine,
        label: spec.label,
        lines,
        total_lines: lines.length,
        fetched_at: new Date().toISOString(),
        file_exists: anyExists,
        latest_mtime: latestMtime,
        files: fileResults.map(r => ({
          path: r.path,
          exists: r.exists,
          mtime: r.mtime,
          size: r.size,
          line_count: r.lines.length,
          error: r.error,
        })),
      });
    }

    // -------------------------------------------------------------------------
    // (B) All-engines mode — backward-compatible with Task 31-B UI shape.
    //     Returns `engines: Record<engineKey, { label, files: EngineLogResult[] }>`
    //     plus `errors_only` for the aggregated error console.
    // -------------------------------------------------------------------------
    const entries = await Promise.all(
      Object.entries(ENGINE_LOG_FILES).map(async ([key, spec]) => {
        const files = await Promise.all(spec.files.map(f => readLogTail(f, limit)));
        return { key, label: spec.label, files };
      }),
    );

    const engines: Record<string, { label: string; files: LogReadResult[] }> = {};
    const errorsOnlyCollected: Array<{ engine: string; path: string; line: string; mtime: string | null }> = [];
    for (const entry of entries) {
      engines[entry.key] = { label: entry.label, files: entry.files };
      for (const f of entry.files) {
        if (!f.exists) continue;
        for (const line of f.lines) {
          if (errorsOnly && looksLikeError(line)) {
            errorsOnlyCollected.push({ engine: entry.key, path: f.path, line, mtime: f.mtime });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      engines,
      errors_only: errorsOnlyCollected.slice(-100),
    });
  } catch (err) {
    console.error('[GET /api/admin/engines/logs]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// NOTE: do NOT export symbols from this file — Next.js's route type checker
// (`.next/types/...`) enforces that route.ts only export Next-recognized
// handlers (GET/POST/etc.) + Next config exports. Shared constants are
// duplicated in sibling route files (small enough to be worth the trade-off
// for Rule 68 type-safety).
