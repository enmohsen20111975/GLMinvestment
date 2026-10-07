#!/usr/bin/env python3
"""
Refresh Persona Flags (PROD-HOTFIX P1)
=======================================
سكريبت CLI بيعيد حساب persona flags لكل صف في stored_analyses
(is_gambler_opportunity, is_investor_opportunity, gambler_rank_score,
investor_rank_score, pe_ratio, roe, change_1d, ...) من غير ما يشغّل
التحليل الفني (Maestro) من جديد.

متى يُستخدم:
  - بعد deploy فيه تحديث لـ opportunity_quality thresholds.
  - بعد ما trigger-analysis يبقى شغّال وعاوز تتأكّد إن flags مش بصفر.
  - لما الـ live filter (volume/turnover في stocks.db) يتحدّث وعاوز تنعكس
    على flags المخزّنة من غير re-analyze.

المصدر:
  - stored_analyses (predictions.db): ticker, market, maestro_score, recommendation,
    risk_reward, confidence, volume_ratio.
  - stocks.db fundamentals (عبر _load_stocks_fundamentals_for_persona).
  - core.opportunity_quality.compute_persona_flags (المنطق الموحّد C1+C2).

التشغيل:
  python3 scripts/refresh_persona_flags.py                     # كل الأسواق
  python3 scripts/refresh_persona_flags.py --market EGX        # EGX فقط
  python3 scripts/refresh_persona_flags.py --limit 500         # أول 500 صف
  python3 scripts/refresh_persona_flags.py --dry-run           # بدون كتابة

Exit codes:
  0 — نجح
  1 — خطأ
"""
import argparse
import os
import sqlite3
import sys
from pathlib import Path

# أضف vps-service للـ path
_ROOT = Path(__file__).resolve().parent.parent
_VPS = _ROOT / 'vps-service'
sys.path.insert(0, str(_VPS))


def main():
    parser = argparse.ArgumentParser(description='Refresh persona flags in stored_analyses')
    parser.add_argument('--market', default='', help='فلتر بالسوق (EGX, TADAWUL, ...). افتراضي: الكل')
    parser.add_argument('--limit', type=int, default=2000, help='حد أقصى للصفوف (افتراضي 2000)')
    parser.add_argument('--dry-run', action='store_true', help='احسب بس من غير كتابة')
    parser.add_argument('--db-dir', default=str(_ROOT / 'db'), help='مسار مجلد الـ DBs')
    args = parser.parse_args()

    stocks_db = os.path.join(args.db_dir, 'stocks.db')
    predictions_db = os.path.join(args.db_dir, 'predictions.db')

    if not os.path.exists(predictions_db):
        print(f"[ERROR] predictions.db not found: {predictions_db}")
        sys.exit(1)
    if not os.path.exists(stocks_db):
        print(f"[ERROR] stocks.db not found: {stocks_db}")
        sys.exit(1)

    # imports من vps-service
    try:
        from analyzers.background_analyzer import (
            _ensure_stored_analyses_columns,
            _load_stocks_fundamentals_for_persona,
            _compute_persona_opportunity_flags,
        )
    except Exception as e:
        print(f"[ERROR] cannot import from background_analyzer: {e}")
        sys.exit(1)

    # 1) تأكّد إن أعمدة persona موجودة
    conn = sqlite3.connect(predictions_db, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        _ensure_stored_analyses_columns(conn)
    except Exception as e:
        print(f"[WARN] ensure columns: {e}")

    # 2) اقرأ كل صفوف stored_analyses
    market_filter = args.market.upper().strip()
    if market_filter:
        rows = conn.execute("""
            SELECT ticker, market, maestro_score, recommendation,
                   risk_reward, confidence, entry_price, volume_ratio
            FROM stored_analyses
            WHERE market = ?
            ORDER BY maestro_score DESC NULLS LAST
            LIMIT ?
        """, (market_filter, args.limit)).fetchall()
    else:
        rows = conn.execute("""
            SELECT ticker, market, maestro_score, recommendation,
                   risk_reward, confidence, entry_price, volume_ratio
            FROM stored_analyses
            ORDER BY maestro_score DESC NULLS LAST
            LIMIT ?
        """, (args.limit,)).fetchall()

    print(f"[refresh-flags] found {len(rows)} rows in stored_analyses"
          + (f" for market={market_filter}" if market_filter else ""))

    if not rows:
        print("[refresh-flags] nothing to do.")
        conn.close()
        sys.exit(0)

    # 3) حمّل fundamentals (cached)
    print("[refresh-flags] loading fundamentals from stocks.db ...")
    fund_map = _load_stocks_fundamentals_for_persona() or {}
    print(f"[refresh-flags] loaded {len(fund_map)} fundamentals entries")

    # 4) أعيد حساب flags لكل صف و UPDATE
    updated = 0
    skipped = 0
    errors = []
    gambler_count = 0
    investor_count = 0
    both_count = 0

    for r in rows:
        ticker = (r['ticker'] or '').upper()
        if not ticker:
            skipped += 1
            continue
        try:
            rec = {
                'ticker': ticker,
                'recommendation': r['recommendation'] or 'hold',
                'maestro_score': float(r['maestro_score'] or 0),
                'risk_reward': float(r['risk_reward'] or 0),
                'confidence': float(r['confidence'] or 0),
            }
            stored_vol_ratio = float(r['volume_ratio'] or 0)
            flags = _compute_persona_opportunity_flags(
                ticker, stored_vol_ratio, rec=rec,
            )
            if not args.dry_run:
                conn.execute("""
                    UPDATE stored_analyses SET
                        is_gambler_opportunity = ?,
                        is_investor_opportunity = ?,
                        gambler_rank_score = ?,
                        investor_rank_score = ?,
                        pe_ratio = ?,
                        roe = ?,
                        change_1d = ?,
                        change_1m = ?,
                        volatility = ?,
                        fair_value_upside = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE ticker = ? AND (market = ? OR ? = '')
                """, (
                    int(flags.get('is_gambler', 0)),
                    int(flags.get('is_investor', 0)),
                    float(flags.get('gambler_rank', 0.0) or 0),
                    float(flags.get('investor_rank', 0.0) or 0),
                    flags.get('pe_ratio'),
                    flags.get('roe'),
                    flags.get('change_1d'),
                    flags.get('change_1m'),
                    flags.get('volatility'),
                    flags.get('fair_value_upside'),
                    ticker,
                    r['market'] or '',
                    r['market'] or '',
                ))
            updated += 1
            if flags.get('is_gambler'):
                gambler_count += 1
            if flags.get('is_investor'):
                investor_count += 1
            if flags.get('is_gambler') and flags.get('is_investor'):
                both_count += 1
        except Exception as e:
            errors.append(f'{ticker}: {e}')

    if not args.dry_run:
        conn.commit()

    # 5) إحصائيات نهائية من DB
    db_gambler = gambler_count
    db_investor = investor_count
    db_total = len(rows)
    if not args.dry_run:
        try:
            stats = conn.execute("""
                SELECT
                    SUM(is_gambler_opportunity) AS g,
                    SUM(is_investor_opportunity) AS i,
                    COUNT(*) AS total
                FROM stored_analyses
            """).fetchone()
            db_gambler = int(stats['g'] or 0) if stats else 0
            db_investor = int(stats['i'] or 0) if stats else 0
            db_total = int(stats['total'] or 0) if stats else 0
        except Exception:
            pass

    conn.close()

    mode = "[DRY-RUN]" if args.dry_run else "[DONE]"
    print("")
    print(f"{mode} refreshed={updated} skipped={skipped} errors={len(errors)}")
    print(f"  gambler (this run) = {gambler_count}")
    print(f"  investor (this run)= {investor_count}")
    print(f"  both               = {both_count}")
    if not args.dry_run:
        print(f"  DB totals: stored={db_total}, gambler={db_gambler}, investor={db_investor}")
    if errors:
        print("  first errors:")
        for e in errors[:5]:
            print(f"    - {e}")
    sys.exit(0)


if __name__ == '__main__':
    main()
