/**
 * GET /api/maker-radar/stock?ticker=X&days=Y
 * ===========================================
 * Directive P1 (API Routes Decoupling): NO direct SQLite access in Next.js
 * routes. This route proxies to Python `/api/maker-radar/stock` ONLY. If
 * Python is unreachable → honest empty (Rule 27 NO-FAKE-DATA).
 *
 * Previously this route opened `db/stocks.db` + `db/predictions.db` directly
 * via the radar-db lib + a dynamic `await import('better-sqlite3')`. That has
 * been removed — the radar-db lib and all SQL are now Python's responsibility
 * (Rule 4: Python = brain).
 *
 * The only local state preserved is the tracking JSON file
 * (`db/maker_radar_tracking.json`) — this is local app state written by
 * `/api/maker-radar/track`, NOT a SQLite database, so reading it here is Rule
 * 4-compliant.
 *
 * Rule 4  (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 * FIX-P4-TARGETS: applyValidatedTargets (SSOT validator, no DB) is kept so the
 *                 Python-proxied prediction is still validated signal-aware
 *                 before being returned to the UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFile, access } from 'fs/promises';
import path from 'path';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
// FIX-P4-TARGETS: validator for prediction enrichment (signal-aware).
// SSOT lib — does NOT open SQLite.
import { applyValidatedTargets } from '@/lib/targets-validator';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const TRACKING_FILE = path.join(PROJECT_ROOT, 'db', 'maker_radar_tracking.json');

interface TrackedStock {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  addedAt: string;
  notes?: string;
}

// P0-14-ASYNC fix (2026-09-27): loadTracking is async.
async function loadTracking(): Promise<Record<string, TrackedStock>> {
  try {
    try {
      await access(TRACKING_FILE);
    } catch { // silent fallback (safe-by-design)
      return {};
    }
    const data = await readFile(TRACKING_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error('[maker-radar/stock] load tracking error:', e);
  }
  return {};
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  const days = url.searchParams.get('days') || '30';

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker query param is required' },
      { status: 400 }
    );
  }

  const qs = url.searchParams.toString();

  // ── Python canonical endpoints (primary + direct fallback) ────────────
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/maker-radar/stock${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:8010/api/maker-radar/stock${qs ? `?${qs}` : ''}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.success) {
          // ── Tracking enrichment (local JSON file — NOT SQLite) ────────
          // If the user is tracking this ticker, attach tracking info +
          // re-validate the Python-provided prediction signal-aware so the
          // UI's amber "data missing" badge logic still works.
          try {
            const tracking = await loadTracking();
            const tracked = tracking[ticker];
            if (tracked && typeof data.prediction === 'object' && data.prediction) {
              const lastClose =
                data.stats?.lastClose != null
                  ? Number(data.stats.lastClose)
                  : (data.prediction.entry_price != null
                      ? Number(data.prediction.entry_price)
                      : 0);
              if (tracked.entryPrice > 0 && lastClose > 0) {
                const changeSinceTracking =
                  ((lastClose - tracked.entryPrice) / tracked.entryPrice) * 100;
                data.tracking = {
                  isTracked: true,
                  entryDate: tracked.entryDate,
                  entryPrice: tracked.entryPrice,
                  currentPrice: lastClose,
                  changeSinceTracking: Math.round(changeSinceTracking * 100) / 100,
                  daysTracked: Math.floor(
                    (Date.now() - new Date(tracked.entryDate).getTime()) / (1000 * 60 * 60 * 24)
                  ),
                };
              }
              // FIX-P4-TARGETS: signal-aware validation on the Python-provided
              // prediction. SSOT adapter — does NOT open any DB.
              const v = applyValidatedTargets({
                signal: data.prediction.signal || data.prediction.signal_type || 'BUY',
                entry_price: data.prediction.entry_price,
                current_price: lastClose || data.prediction.entry_price,
                target1: data.prediction.target_price,
                target2: data.prediction.target_price_2 ?? null,
                stop_loss: data.prediction.stop_loss,
                risk_reward_ratio: data.prediction.risk_reward,
              });
              data.prediction = {
                ...data.prediction,
                entry_price: v.entry_price,
                target_price: v.target1,
                target_price_2: v.target2,
                stop_loss: v.stop_loss,
                risk_reward: v.risk_reward_ratio,
                targets_validated: v.adjusted,
              };
            }
          } catch (enrichErr) {
            // Enrichment is best-effort — never fail the whole request.
            console.error('[maker-radar/stock] tracking/prediction enrichment error:', enrichErr);
          }

          return NextResponse.json(data);
        }
      }
    } catch { // silent fallback (safe-by-design) → try next URL
      // Try next fallback URL.
    }
  }

  // Rule 27: honest empty — NO fabricated prices/volumes/MFI/predictions.
  return NextResponse.json(
    {
      success: false,
      error: 'تعذّر جلب بيانات السهم من المحرك الكنسي',
      ticker,
      stock_info: null,
      prices: [],
      stats: {
        lastClose: 0,
        changePct: 0,
        roc10d: 0,
        avgVolume20: 0,
        avgTurnover20: 0,
        max20: 0,
        min20: 0,
        range20Pct: 0,
        dataPoints: 0,
        mfi: null,
      },
      tracking: null,
      prediction: null,
      db_source: null,
    },
    { status: 503 }
  );
}
