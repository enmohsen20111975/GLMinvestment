#!/usr/bin/env python3
"""
Build Stock Adaptive Profiles (Daily Stock DNA Builder)
========================================================
سكريبت يومي (P25-LIVING-ENGINE — أغسطس 2026) بيبني "ملف تعريف السهم الديناميكي"
(Stock DNA) لكل أسهم EGX ويحفظه في جدول `stock_adaptive_profiles` في stocks.db.

المصدر: price_history.db (الأرشيف الكامل — حتى 25 سنة بيانات على الإنتاج)،
مع fallback لـ stock_daily_prices في stocks.db لو price_history.db ناقص.

الحقول المحسوبة لكل سهم:
  - volatility_percentile_90d  : أين تذبذب 20 يوم الحالي مقابل توزيعه آخر 90 يوم.
  - avg_atr_pct                : متوسط ATR/price*100 (مدى يومي طبيعي).
  - avg_volume_20d             : متوسط حجم 20 يوم.
  - volume_spike_threshold     : متى يعتبر الحجم "زخم" (mean+2σ، clamp 1.8-4.0).
  - typical_move_1d/5d/15d     : النطاق الحقيقي اللي بيتحرك فيه.
  - reaction_to_market_crashes : defensive/resilient/correlated/amplifier.
  - personality_type_en        : نوع شخصية السهم.

التشغيل:
  python3 scripts/build_stock_profiles.py            # كل الأسهم
  python3 scripts/build_stock_profiles.py COMI AALR  # أسهم محددة
  python3 scripts/build_stock_profiles.py --limit 50 # أول 50 سهم

cron مقترح (يومي بعد إغلاق السوق):
  30 15 * * 1-5 cd ~/GLMinvestment && python3 scripts/build_stock_profiles.py >> logs/stock_dna.log 2>&1

القاعدة الذهبية: المنصة "كائن حي" يفهم طبيعة كل سهم بدل معادلات عامة ثابتة.
كل ما زادت البيانات التاريخية (25 سنة على الإنتاج)، كل ما أصبحت الـ profiles
أدقّ — خصوصاً reaction_to_market_crashes اللي بياخد عيّنة من كل الأزمات التاريخية.
"""

from __future__ import annotations

import os
import sys
import sqlite3
import time
from pathlib import Path
from datetime import datetime

# Project root: scripts/ -> project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_VPS_SERVICE = _PROJECT_ROOT / 'vps-service'
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# نجّع vps-service قابل للاستيراد (عشان نستخدم StockDNAAnalyzer)
sys.path.insert(0, str(_VPS_SERVICE))


def _log(msg: str) -> None:
    print(f"[stock-dna] {msg}")


def get_all_active_tickers(db_path: str = STOCKS_DB, market: str = 'EGX') -> list:
    """كل الأسهم النشطة من stocks.db."""
    tickers = []
    try:
        conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=15)
        cur = conn.cursor()
        cur.execute(
            "SELECT ticker FROM stocks WHERE is_active = 1 "
            "AND (market = ? OR market IS NULL) "
            "ORDER BY ticker",
            (market,)
        )
        tickers = [r[0] for r in cur.fetchall()]
        conn.close()
    except Exception as e:
        _log(f"Failed to read stocks list: {e}")
    return tickers


def build_all(tickers: list = None, db_path: str = STOCKS_DB) -> dict:
    """ابنِ الـ Stock DNA لقائمة أسهم (أو كل الأسهم لو None)."""
    from analyzers.stock_dna_analyzer import (
        StockDNAAnalyzer, invalidate_profile_cache,
    )

    if tickers is None:
        tickers = get_all_active_tickers(db_path)

    _log(f"Building Stock DNA profiles for {len(tickers)} stocks...")
    _log(f"  DB: {db_path}")

    analyzer = StockDNAAnalyzer(stocks_db=db_path)
    built, skipped, errors = 0, 0, 0
    t0 = time.time()

    for i, ticker in enumerate(tickers, 1):
        try:
            profile = analyzer.build_and_persist_profile(ticker)
            if profile:
                built += 1
                if i % 50 == 0 or i == len(tickers):
                    elapsed = time.time() - t0
                    _log(f"  [{i}/{len(tickers)}] built={built} skipped={skipped} "
                         f"errors={errors} ({elapsed:.1f}s, "
                         f"{built/max(1,elapsed):.1f} stocks/s)")
            else:
                skipped += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                _log(f"  ERROR {ticker}: {e}")

    # امسح الـ cache كله عشان المحركات تقرأ النسخ الجديدة
    invalidate_profile_cache()

    elapsed = time.time() - t0
    _log("")
    _log(f"Done in {elapsed:.1f}s — built={built}, skipped={skipped}, errors={errors}")
    return {
        'total': len(tickers),
        'built': built,
        'skipped': skipped,
        'errors': errors,
        'elapsed_sec': round(elapsed, 1),
        'timestamp': datetime.now().isoformat(timespec='seconds'),
    }


def main() -> int:
    _log("=" * 64)
    _log("Build Stock Adaptive Profiles — Daily Stock DNA Builder (P25)")
    _log("=" * 64)

    # CLI args: أسهم محددة أو --limit N
    args = sys.argv[1:]
    tickers = None
    limit = None
    skip_next = False
    for a in args:
        if skip_next:
            skip_next = False
            continue
        if a.startswith('--limit='):
            try:
                limit = int(a.split('=', 1)[1])
            except ValueError:
                pass
        elif a == '--limit':
            # --limit 50 (القيمة في الـ arg اللي بعده)
            idx = args.index(a)
            if idx + 1 < len(args):
                try:
                    limit = int(args[idx + 1])
                    skip_next = True
                except ValueError:
                    pass
        elif not a.startswith('-'):
            if tickers is None:
                tickers = []
            tickers.append(a.upper())

    if tickers is None:
        tickers = get_all_active_tickers()
    if limit and limit > 0:
        tickers = tickers[:limit]

    if not tickers:
        _log("No active stocks found. Exiting.")
        return 1

    result = build_all(tickers)

    # ملخص الـ personalities
    try:
        conn = sqlite3.connect(f'file:{STOCKS_DB}?mode=ro', uri=True, timeout=10)
        cur = conn.cursor()
        cur.execute(
            "SELECT personality_type_en, COUNT(*) FROM stock_adaptive_profiles "
            "GROUP BY personality_type_en ORDER BY COUNT(*) DESC"
        )
        _log("")
        _log("Personality distribution:")
        for p, c in cur.fetchall():
            _log(f"  {p or 'unknown':28s} {c}")
        cur.execute(
            "SELECT reaction_to_market_crashes, COUNT(*) FROM stock_adaptive_profiles "
            "GROUP BY reaction_to_market_crashes ORDER BY COUNT(*) DESC"
        )
        _log("")
        _log("Crash-reaction distribution:")
        for r, c in cur.fetchall():
            _log(f"  {r or 'unknown':28s} {c}")
        conn.close()
    except Exception:
        pass

    _log("")
    _log(f"Stock DNA build complete. {result['built']} profiles ready.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
