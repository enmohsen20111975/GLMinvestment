/**
 * GET /api/mobile/crypto/analysis
 * ==============================
 * Crypto analysis — falls back to data_engine.db crypto_prices when Python down.
 * Returns latest snapshot + computed simple momentum metrics from history.
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/crypto/live${qs ? `?${qs}` : ''}`;

  // 1) Try Python first
  try {
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — data_engine.db crypto_prices
  try {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const deDbPath = path.join(process.cwd(), 'db', 'data_engine.db');
    if (!fs.existsSync(deDbPath)) {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        analysis: [],
        message_ar: 'قاعدة بيانات الكريبتو غير متوفرة',
        timestamp: new Date().toISOString(),
      });
    }
    const db = new Database(deDbPath, { readonly: true });

    // Latest snapshot per coin (use DISTINCT symbol + recent timestamp)
    const latest: any = db
      .prepare(
        `SELECT timestamp FROM crypto_prices
         WHERE timestamp IS NOT NULL
         ORDER BY timestamp DESC LIMIT 1`
      )
      .get();

    if (!latest) {
      db.close();
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        analysis: [],
        message_ar: 'لا توجد بيانات كريبتو مخزّنة',
        timestamp: new Date().toISOString(),
      });
    }

    // Top coins by market_cap
    const coins: any[] = db
      .prepare(
        `SELECT symbol, name, price_usd, price_change_24h, price_change_7d,
                market_cap, total_volume, circulating_supply, market_cap_rank
         FROM crypto_prices
         WHERE timestamp = ?
         ORDER BY market_cap_rank ASC
         LIMIT 20`
      )
      .all(latest.timestamp);

    // Compute momentum / classification from real numbers (not mock)
    const analysis = coins.map((c: any) => {
      const change24h = c.price_change_24h != null ? Number(c.price_change_24h) : 0;
      const change7d = c.price_change_7d != null ? Number(c.price_change_7d) : 0;
      // Derived signal classification
      let signal = 'HOLD';
      let signal_ar = 'احتفاظ';
      let strength = 'NEUTRAL';
      if (change24h >= 5 && change7d >= 0) {
        signal = 'STRONG_BUY';
        signal_ar = 'شراء قوي';
        strength = change24h >= 10 ? 'STRONG' : 'MODERATE';
      } else if (change24h >= 2) {
        signal = 'BUY';
        signal_ar = 'شراء';
        strength = 'MODERATE';
      } else if (change24h <= -5) {
        signal = 'SELL';
        signal_ar = 'بيع';
        strength = change24h <= -10 ? 'STRONG' : 'MODERATE';
      }
      // Confidence score: derived from magnitude of change
      const confidence = Math.min(100, Math.abs(change24h) * 10);
      return {
        symbol: c.symbol,
        name: c.name,
        name_ar: c.name,
        price: Number(c.price_usd || 0),
        change_24h: change24h,
        change_7d: change7d,
        market_cap: c.market_cap != null ? Number(c.market_cap) : null,
        volume_24h: c.total_volume != null ? Number(c.total_volume) : null,
        circulating_supply:
          c.circulating_supply != null ? Number(c.circulating_supply) : null,
        rank: c.market_cap_rank,
        signal,
        signal_ar,
        strength,
        confidence: Number(confidence.toFixed(2)),
        reasons: [
          `تغيّر 24 ساعة: ${change24h.toFixed(2)}%`,
          `تغيّر 7 أيام: ${change7d.toFixed(2)}%`,
        ],
        warnings: ['التحليل التفصيلي يتطلب Python Backend'],
      };
    });

    // Aggregate market regime
    const advancing = analysis.filter((a) => a.change_24h > 0).length;
    const declining = analysis.filter((a) => a.change_24h < 0).length;
    const sentiment =
      advancing > declining * 1.5
        ? 'BULLISH'
        : declining > advancing * 1.5
        ? 'BEARISH'
        : 'NEUTRAL';

    db.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      timestamp: latest.timestamp,
      market_regime: {
        sentiment,
        advancing,
        declining,
        source: 'sqlite_fallback',
      },
      analysis,
      count: analysis.length,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[mobile:crypto:analysis]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
