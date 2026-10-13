#!/usr/bin/env python3
"""
multi_market_institutional_scan.py — محرك المسح المؤسسي متعدد الأسواق
=====================================================================
Task BRAVO-MULTI-MARKET-SCAN (Owner Directive 2026-10-13)

يفحص جميع الأسواق (EGX, TADAWUL, KSE, QSE, US) ويطبق الفلتر الكمي الحديدي:
  1. R:R ≥ 1.5 (المستهدف المؤسسي ≥ 2.0)
  2. الثقة ≥ 65%
  3. فوليوم مؤسسي حقيقي (≥ 1.5x متوسط 20 يوم)
  4. زخم صاعد مؤكد (ROC 10d > 0 أو RSI < 70)

يملأ جدول predictions في stocks.db بالفرص الحقيقية الطازجة لكل سوق.

Usage:
    python3 scripts/multi_market_institutional_scan.py              # فحص + تقرير
    python3 scripts/multi_market_institutional_scan.py --execute    # فحص + كتابة predictions
    python3 scripts/multi_market_institutional_scan.py --market EGX # سوق واحد
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"

# Hard Quant Kill Filter thresholds
MIN_RR = 1.5
TARGET_RR = 2.0
MIN_CONFIDENCE = 65.0
MIN_VOLUME_RATIO = 1.5
MAX_RSI = 70.0


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    icon = "✅" if level == "OK" else ("⚠️" if level == "WARN" else ("❌" if level == "ERROR" else "▸"))
    print(f"[{ts}] {icon} {msg}", flush=True)


def _to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace('،', '').strip())
    except (ValueError, TypeError):
        return default


def scan_market(conn: sqlite3.Connection, market: str) -> List[Dict[str, Any]]:
    """افحص سوقًا واحدًا وأرجع الفرص المؤسسية المؤهلة."""
    # جلب كل الأسهم النشطة في هذا السوق مع بياناتها
    rows = conn.execute("""
        SELECT ticker, name, current_price, ma_50, ma_200, support, resistance,
               change_percent, volume, rsi, pe_ratio, sector, market
        FROM stocks
        WHERE is_active = 1 AND market = ?
        AND current_price IS NOT NULL AND current_price > 0
        ORDER BY ticker
    """, (market,)).fetchall()

    opportunities = []
    skipped = 0

    for row in rows:
        d = dict(row)
        ticker = d['ticker']
        cp = _to_float(d['current_price'])
        if cp <= 0:
            continue

        # جلب آخر 20 شمعة من stock_daily_prices
        candles = conn.execute("""
            SELECT COALESCE(high, high_price) as high,
                   COALESCE(low, low_price) as low,
                   COALESCE(close, close_price) as close,
                   volume
            FROM stock_daily_prices
            WHERE ticker = ? AND COALESCE(close, close_price) IS NOT NULL
                  AND COALESCE(close, close_price) > 0
            ORDER BY price_date DESC LIMIT 20
        """, (ticker,)).fetchall()

        if len(candles) < 14:
            skipped += 1
            continue

        closes = [float(c[2] or 0) for c in reversed(candles)]
        volumes = [float(c[3] or 0) for c in reversed(candles)]
        highs = [float(c[0] or 0) for c in reversed(candles)]
        lows = [float(c[1] or 0) for c in reversed(candles)]

        # 1. ATR (14)
        tr_list = []
        for i in range(1, min(14, len(closes))):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i-1]),
                abs(lows[i] - closes[i-1])
            )
            tr_list.append(tr)
        atr = sum(tr_list) / len(tr_list) if tr_list else cp * 0.02

        # 2. RSI (14) — Wilder's smoothing
        if len(closes) >= 15:
            gains = []
            losses = []
            for i in range(1, len(closes)):
                change = closes[i] - closes[i-1]
                gains.append(max(0, change))
                losses.append(max(0, -change))
            avg_gain = sum(gains[:14]) / 14
            avg_loss = sum(losses[:14]) / 14
            if avg_loss > 0:
                rs = avg_gain / avg_loss
                rsi = 100 - (100 / (1 + rs))
            else:
                rsi = 100.0
        else:
            rsi = 50.0

        # 3. Volume ratio (today vs avg 20d)
        avg_vol_20 = sum(volumes) / len(volumes) if volumes else 1
        last_vol = volumes[-1] if volumes else 0
        vol_ratio = (last_vol / avg_vol_20) if avg_vol_20 > 0 else 0

        # 4. ROC 10d
        if len(closes) >= 11 and closes[-11] > 0:
            roc_10d = ((closes[-1] - closes[-11]) / closes[-11]) * 100
        else:
            roc_10d = 0.0

        # 5. MA50 / MA200 position
        ma50 = _to_float(d.get('ma_50'))
        ma200 = _to_float(d.get('ma_200'))

        # 6. Support / Resistance
        support = _to_float(d.get('support'))
        resistance = _to_float(d.get('resistance'))

        # ── Hard Quant Kill Filter ──
        reject_reasons = []

        # A. Falling Knife check
        is_falling_knife = False
        if ma50 > 0 and cp < ma50 * 0.95:
            if ma200 > 0 and ma50 < ma200:
                is_falling_knife = True
            elif len(closes) >= 10 and closes[-10] > 0:
                roc_10_check = ((closes[-1] - closes[-10]) / closes[-10]) * 100
                if roc_10_check < -5.0:
                    is_falling_knife = True
        if is_falling_knife:
            reject_reasons.append("Falling Knife")

        # B. RSI > 70 (تشبع شرائي)
        if rsi > MAX_RSI:
            reject_reasons.append(f"RSI={rsi:.0f}>{MAX_RSI}")

        # C. Volume < 1.5x (لا فوليوم مؤسسي)
        if vol_ratio < MIN_VOLUME_RATIO:
            reject_reasons.append(f"Vol={vol_ratio:.1f}x<{MIN_VOLUME_RATIO}x")

        # D. Momentum check: ROC 10d must be positive OR RSI < 50 (oversold bounce)
        if roc_10d < 0 and rsi > 50:
            reject_reasons.append(f"No momentum (ROC={roc_10d:.1f}%, RSI={rsi:.0f})")

        # E. Compute entry/stop/target
        entry = cp
        stop = support if (support and support > 0 and support < cp) else cp - (1.5 * atr)
        target = cp + (2.5 * atr)  # TP1 = 2.5 × ATR

        # F. R:R check
        risk = entry - stop
        reward = target - entry
        rr = (reward / risk) if risk > 0 else 0
        if rr < MIN_RR:
            reject_reasons.append(f"RR={rr:.2f}<{MIN_RR}")

        # G. Confidence score
        confidence = 50.0
        if rr >= TARGET_RR:
            confidence += 15
        elif rr >= MIN_RR:
            confidence += 10
        if vol_ratio >= 2.0:
            confidence += 10
        elif vol_ratio >= MIN_VOLUME_RATIO:
            confidence += 5
        if roc_10d > 5:
            confidence += 10
        elif roc_10d > 0:
            confidence += 5
        if rsi < 30:
            confidence += 10  # oversold bounce
        elif rsi < 50:
            confidence += 5
        if ma50 > 0 and cp > ma50:
            confidence += 5
        confidence = min(100, confidence)

        if confidence < MIN_CONFIDENCE:
            reject_reasons.append(f"Confidence={confidence:.0f}<{MIN_CONFIDENCE}")

        # ── Decision ──
        if reject_reasons:
            skipped += 1
            continue

        # ✅ ACCEPTED — فرصة مؤسسية مؤكدة
        signal = 'BUY'
        signal_type = 'institutional_scan'
        horizon = '⚡ يومية/قصيرة' if rr >= TARGET_RR else '🎯 أسبوعية/متوسطة'

        opportunities.append({
            'ticker': ticker,
            'name': d.get('name') or '',
            'market': market,
            'sector': d.get('sector') or '',
            'entry_price': round(entry, 4),
            'target_price': round(target, 4),
            'stop_loss': round(stop, 4),
            'rr': round(rr, 2),
            'confidence': round(confidence, 1),
            'rsi': round(rsi, 1),
            'roc_10d': round(roc_10d, 2),
            'vol_ratio': round(vol_ratio, 2),
            'atr': round(atr, 4),
            'horizon': horizon,
            'signal': signal,
            'signal_type': signal_type,
        })

    return opportunities, skipped, len(rows)


def write_predictions(conn: sqlite3.Connection, opportunities: List[Dict]) -> int:
    """اكتب الفرص المقبولة في جدول predictions."""
    written = 0
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    for opp in opportunities:
        try:
            conn.execute("""
                INSERT OR REPLACE INTO predictions
                (ticker, signal, signal_type, prediction_date, entry_price,
                 target_price, stop_loss, master_score, technical_score,
                 fundamental_score, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                opp['ticker'],
                opp['signal'],
                opp['signal_type'],
                now,
                opp['entry_price'],
                opp['target_price'],
                opp['stop_loss'],
                int(opp['confidence']),
                int(opp['confidence']),  # technical_score = confidence proxy
                0,  # fundamental_score (not computed in this scan)
                datetime.now(timezone.utc).isoformat(),
            ))
            written += 1
        except Exception as e:
            log(f"  INSERT failed for {opp['ticker']}: {e}", "WARN")
    conn.commit()
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description="محرك المسح المؤسسي متعدد الأسواق")
    parser.add_argument("--execute", action="store_true", help="كتابة predictions في DB")
    parser.add_argument("--market", type=str, default=None, help="سوق واحد فقط")
    args = parser.parse_args()

    log("=" * 70)
    log("🌍 محرك المسح المؤسسي متعدد الأسواق — Multi-Market Institutional Scan")
    log("=" * 70)
    log(f"Mode: {'EXECUTE (write predictions)' if args.execute else 'DRY-RUN (report only)'}")
    log(f"Filter: RR≥{MIN_RR} | Confidence≥{MIN_CONFIDENCE}% | Vol≥{MIN_VOLUME_RATIO}x | RSI<{MAX_RSI}")
    log("")

    if not STOCKS_DB.exists():
        log(f"stocks.db غير موجود: {STOCKS_DB}", "ERROR")
        return 1

    markets = [args.market] if args.market else ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US']
    conn = sqlite3.connect(str(STOCKS_DB))
    conn.row_factory = sqlite3.Row

    all_opportunities = []
    total_scanned = 0
    total_skipped = 0

    for market in markets:
        log(f"📍 مسح سوق {market}...")
        opportunities, skipped, total = scan_market(conn, market)
        all_opportunities.extend(opportunities)
        total_scanned += total
        total_skipped += skipped
        accepted = len(opportunities)
        log(f"  scanned={total} | accepted={accepted} | rejected={skipped}")

        for opp in opportunities[:5]:  # عرض أول 5 فرص
            log(f"  ✅ {opp['ticker']:8} | entry={opp['entry_price']:>10.2f} | "
                f"target={opp['target_price']:>10.2f} | stop={opp['stop_loss']:>10.2f} | "
                f"RR={opp['rr']:.2f} | conf={opp['confidence']:.0f}% | "
                f"RSI={opp['rsi']:.0f} | vol={opp['vol_ratio']:.1f}x | {opp['horizon']}")
        if len(opportunities) > 5:
            log(f"  ... و {len(opportunities) - 5} فرصة أخرى")
        log("")

    # كتابة predictions
    written = 0
    if args.execute and all_opportunities:
        log("📝 كتابة الفرص في جدول predictions...")
        written = write_predictions(conn, all_opportunities)
        log(f"  تم كتابة {written} فرصة في predictions", "OK")

    conn.close()

    # ملخص نهائي
    log("=" * 70)
    log(f"📊 الملخص النهائي:")
    log(f"  الأسواق الممسوحة: {', '.join(markets)}")
    log(f"  إجمالي الأسهم: {total_scanned}")
    log(f"  فرص مقبولة: {len(all_opportunities)}")
    log(f"  فرص مرفوضة: {total_skipped}")
    if all_opportunities:
        avg_rr = sum(o['rr'] for o in all_opportunities) / len(all_opportunities)
        avg_conf = sum(o['confidence'] for o in all_opportunities) / len(all_opportunities)
        log(f"  متوسط R:R: {avg_rr:.2f}")
        log(f"  متوسط الثقة: {avg_conf:.1f}%")
    if written:
        log(f"  تم كتابة {written} صف في predictions", "OK")
    log("=" * 70)

    return 0


if __name__ == "__main__":
    sys.exit(main())
