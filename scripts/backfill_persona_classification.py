#!/usr/bin/env python3
"""
backfill_persona_classification.py — إعادة تصنيف توقعات predictions.db على الشخصيات
===============================================================================

WHY
---
كل توقعات predictions.persona = 'balanced' لأن CL5 auto-classification في
maestro_orchestrator.py:2414-2446 بـ يفشل صامتاً (stocks.db ناقصة fundamentals:
turnover_egp, roe, pe_ratio NULL) وبي fallback لـ 'balanced'.

النتيجة: شاشة أداء التوقعات بـ تظهر 0 مضارب / 3000 متوازن / 0 مستثمر.

الحل
----
سكريبت backfill بـ يقرأ كل التوقعات + بيانات السهم من stocks.db، ويعيد التصنيف
باستخدام `classify_persona_heuristic` (single source of truth من
vps-service/core/opportunity_quality.py). ده نفس الـ logic اللي بـ يستخدمها
maestro CL5 fallback، فالتصنيف التاريخي + الجديد بـ يتطابقوا.

  - GAMBLER (مضارب): إشارة مضاربية + score ≥ 65 + confidence ≥ 55
                    (أو volume_ratio ≥ 2.0 + score ≥ 75)
  - CONSERVATIVE (مستثمر): إشارة شراء + score ≥ 60 + confidence ≥ 70
                          (أو roe ≥ 12 / fvu ≥ 10 + score ≥ 60)
                          (أو holding_days ≥ 30 + score ≥ 55 — للصفقات المقفولة)
  - BALANCED (متوازن): الـ default

🔥 SCHEMA-AWARE (P0-fix v2):
   الإنتاج بـ يستخدم signal / signal_type (مش recommendation). السكريبت دلوقتي
   بـ يفحص الأعمدة الفعلية بـ PRAGMA table_info وبـ يبني الـ SELECT ديناميكيًا.
   ده بـ يشتغل على أي schema (قديم أو جديد).

🔥 SINGLE SOURCE OF TRUTH (P0-UI-PERSONA):
   الـ classification logic بـ يجي من vps-service/core/opportunity_quality.py
   (classify_persona_heuristic). لو الـ import فشل ( standalone run بدون
   vps-service في الـ path)، بـ يـ fallback لـ copy محلية بنفس الـ logic.

Usage:
    python3 scripts/backfill_persona_classification.py --dry-run
    python3 scripts/backfill_persona_classification.py --apply

Author: P0-UI fix — persona distribution (schema-aware v2 + single-source)
"""

import os
import sys
import json
import sqlite3
import argparse
import logging
from pathlib import Path
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')

# ── Single source of truth: جرّب import من vps-service/core/opportunity_quality ──
# لو الـ import نجح → استخدم classify_persona_heuristic (نفس الـ logic اللي في
# maestro CL5 fallback). لو فشل → fallback لـ copy محلية (لـ standalone runs).
_CLASSIFY_FN = None
try:
    _VPS_CORE = str(PROJECT_ROOT / 'vps-service')
    if _VPS_CORE not in sys.path:
        sys.path.insert(0, _VPS_CORE)
    from core.opportunity_quality import classify_persona_heuristic as _classify_heuristic  # noqa: E402
    _CLASSIFY_FN = _classify_heuristic
    _USING_SHARED = True
except Exception as _import_err:
    _USING_SHARED = False
    _CLASSIFY_FN = None
    # الـ copy المحلية بتشتغل لو الـ import فشل (نفس logic بالضبط)
    pass


def _get_columns(conn, table):
    """اترجع set بأسماء الأعمدة الموجودة فعلياً في الجدول (schema-aware)."""
    try:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    except sqlite3.OperationalError:
        return set()


def _resolve_signal(pred):
    """
    استخرج "نوع الإشارة" من الصف بأي وسيلة متاحة (schema-aware).
    الأولوية: signal (granular: t1_buy/swing_buy/...) ← signal_type (BUY/SELL/...) ← recommendation.
    بـ ترجع lowercase string.
    """
    for col in ('signal', 'signal_type', 'recommendation'):
        val = pred.get(col)
        if val is not None and str(val).strip():
            return str(val).strip().lower()
    return ''


def _resolve_score(pred):
    """استخرج الـ maestro/master score (schema-aware — أسماء أعمدة مختلفة).

    🔥 P0-v5 FIX — skip القيم الـ 0/NULL:
       الـ production بـ يخزن الدرجة الحقيقية في ``master_score`` بينما
       ``maestro_score``/``score`` بـ يكونوا ``0.0`` في التوقعات القديمة.
       الـ logic القديم كان بـ يرجع ``0.0`` أول ما يلاقي قيمة (حتى لو 0) →
       ما بـ يوصلش لـ ``master_score``. دلوقتي بـ نتخطى 0 ونروح للتالي.
    """
    for col in ('master_score', 'maestro_score', 'score'):
        val = pred.get(col)
        if val is None:
            continue
        try:
            f = float(val)
        except (TypeError, ValueError):
            continue
        if f > 0:           # ← skip 0.0، fall through لـ العمود التالي
            return f
    return 0.0


# ── Local fallback copy (لو الـ import من opportunity_quality فشل) ──
# ده نفس logic classify_persona_heuristic بالضبط. لو الـ shared import اشتغل،
# الـ function دي ما بـ تستخدمش.
_GAMBLER_SIGNALS_LOCAL = frozenset({
    't1_buy', 'swing_buy', 'scalp_buy', 'momentum_buy',
    'buy', 'strong_buy', 'accumulate',
})
_INVESTOR_SIGNALS_LOCAL = frozenset({
    'buy', 'strong_buy', 'value_buy', 'long_buy', 'accumulate',
})
_BUY_SIDE_SIGNALS_LOCAL = _GAMBLER_SIGNALS_LOCAL | _INVESTOR_SIGNALS_LOCAL


def _classify_local(pred: dict, stock: dict) -> str:
    """Local fallback — نفس logic classify_persona_heuristic (لـ standalone runs).

    🔥 نفس ترتيب الـ checks بالضبط: CONSERVATIVE الأول (high-conviction) →
    GAMBLER (high-momentum) → BALANCED. ده عشان نتجنّب إن gambler بـ يبلع
    كل الـ high-score rows (المشكلة الأصلية اللي خلت conservative = 0).
    """
    sig = _resolve_signal(pred)
    score = _resolve_score(pred)
    try:
        confidence = float(pred.get('confidence') or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    # 🔥 P0-v5 FIX — confidence = NULL → استخدم master_score كـ proxy للثقة
    if confidence <= 0:
        confidence = score
    try:
        holding_days = int(pred.get('holding_days') or 0)
    except (TypeError, ValueError):
        holding_days = 0
    stock = stock or {}
    try:
        vr = float(stock.get('volume_ratio') or 0)
    except (TypeError, ValueError):
        vr = 0.0
    vr = min(vr, 50.0) if vr > 0 else 0.0
    try:
        roe = float(stock.get('roe') or 0)
    except (TypeError, ValueError):
        roe = 0.0
    try:
        fvu = float(stock.get('fair_value_upside') or 0)
    except (TypeError, ValueError):
        fvu = 0.0

    buy_side = sig in _BUY_SIDE_SIGNALS_LOCAL

    # CONSERVATIVE (check الأول — high-conviction ما يروحش gambler)
    if buy_side:
        if (roe >= 12 or fvu >= 10) and score >= 55:
            return 'conservative'
        if holding_days >= 25 and score >= 50:
            return 'conservative'
        if confidence >= 70 and score >= 55:
            return 'conservative'

    # GAMBLER (high-momentum)
    if buy_side:
        if vr >= 2.0 and score >= 70:
            return 'gambler'
        if score >= 65 and confidence >= 50:
            return 'gambler'
        if 0 < holding_days <= 4 and score >= 55:
            return 'gambler'

    # BALANCED
    return 'balanced'


def classify_prediction(pred: dict, stock: dict) -> str:
    """صنّف توقع واحد باستخدام الـ shared heuristic (أو local fallback).

    ده الـ dispatcher: لو classify_persona_heuristic متاح (من opportunity_quality)
    → استخدمه. else → استخدم _classify_local. كده الـ logic واحد مهما كان الـ path.
    """
    if _CLASSIFY_FN is not None:
        stored = {
            'volume_ratio': float(stock.get('volume_ratio') or 0) if stock else 0,
            'roe': float(stock.get('roe') or 0) if stock else 0,
            'fair_value_upside': float(stock.get('fair_value_upside') or 0) if stock else 0,
        }
        return _CLASSIFY_FN(pred, fund=(stock or {}), stored=stored)
    return _classify_local(pred, stock or {})


def main():
    parser = argparse.ArgumentParser(
        description='Backfill persona classification on predictions.db',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('--pred-db', default=PREDICTIONS_DB, help='Path to predictions.db')
    parser.add_argument('--stocks-db', default=STOCKS_DB, help='Path to stocks.db')
    parser.add_argument('--dry-run', action='store_true', help='Classify but do NOT write')
    parser.add_argument('--apply', action='store_true', help='Write classifications to DB')
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("❌ Must specify --dry-run or --apply")
        sys.exit(1)
    if args.dry_run and args.apply:
        print("❌ Cannot specify both --dry-run and --apply")
        sys.exit(1)

    print(f"\n{'='*70}")
    print(f"🎭 Persona Classification Backfill (schema-aware v2 + single-source)")
    print(f"{'='*70}")
    print(f"  pred_db   : {args.pred_db}")
    print(f"  stocks_db : {args.stocks_db}")
    print(f"  mode      : {'DRY-RUN' if args.dry_run else 'APPLY'}")
    _src = 'SHARED (vps-service/core/opportunity_quality.classify_persona_heuristic)' if _USING_SHARED else 'LOCAL fallback (standalone)'
    print(f"  classifier: {_src}")
    print(f"{'='*70}\n")

    if not os.path.exists(args.pred_db):
        print(f"❌ predictions.db not found: {args.pred_db}")
        sys.exit(1)

    conn = sqlite3.connect(args.pred_db, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA busy_timeout = 30000')

    # ── SCHEMA-AWARE: فحص الأعمدة الفعلية ──
    cols = _get_columns(conn, 'predictions')
    if not cols:
        print(f"❌ predictions table not found in {args.pred_db}")
        conn.close()
        sys.exit(1)
    print(f"📋 Detected columns ({len(cols)}): {sorted(cols)}")

    # اتأكد إن عمود persona موجود
    if 'persona' not in cols:
        print("⚠️ persona column missing — adding it...")
        conn.execute("ALTER TABLE predictions ADD COLUMN persona TEXT DEFAULT 'balanced'")
        conn.commit()
        cols.add('persona')

    # ── ابني الـ SELECT ديناميكيًا: بس الأعمدة الموجودة ──
    wanted = ['id', 'ticker', 'signal', 'signal_type', 'recommendation',
              'master_score', 'maestro_score', 'score', 'confidence',
              'holding_days', 'persona']
    select_cols = [c for c in wanted if c in cols]
    select_sql = f"SELECT {', '.join(select_cols)} FROM predictions"
    print(f"📋 SELECT columns: {select_cols}\n")

    # قبل: توزيع الـ persona الحالي
    before = dict(conn.execute(
        "SELECT persona, COUNT(*) FROM predictions GROUP BY persona"
    ).fetchall())
    print(f"📊 BEFORE: {before}")

    # اقرا كل التوقعات
    rows = conn.execute(select_sql).fetchall()
    print(f"📋 Total predictions: {len(rows)}")

    # حمّل بيانات الأسهم من stocks.db (volume_ratio / current_volume)
    stocks_map = {}
    if os.path.exists(args.stocks_db):
        try:
            sconn = sqlite3.connect(args.stocks_db, timeout=30)
            sconn.row_factory = sqlite3.Row
            scur = sconn.cursor()
            # فحص أعمدة stocks.db (schema-aware)
            scols = _get_columns(sconn, 'stocks')
            vol_col = None
            for cand in ('volume_ratio', 'current_volume', 'volume'):
                if cand in scols:
                    vol_col = cand
                    break
            if vol_col:
                srows = scur.execute(
                    f"SELECT ticker, {vol_col} AS volume_ratio FROM stocks"
                ).fetchall()
                for sr in srows:
                    stocks_map[(sr['ticker'] or '').upper()] = dict(sr)
                print(f"📋 stocks.db: loaded volume from '{vol_col}' for {len(stocks_map)} tickers")
            else:
                print("📋 stocks.db: no volume column found — volume_ratio will be 0 for all")
            sconn.close()
        except Exception as e:
            logger.warning(f"stocks.db read error: {e}")

    # صنّف
    updates = []  # (new_persona, id)
    counts = {'gambler': 0, 'balanced': 0, 'conservative': 0, 'unchanged': 0}
    for r in rows:
        ticker = (r['ticker'] or '').upper()
        stock = stocks_map.get(ticker, {})
        new_persona = classify_prediction(dict(r), stock)
        old_persona = r['persona'] or 'balanced'
        if new_persona == old_persona:
            counts['unchanged'] += 1
        else:
            counts[new_persona] += 1
            updates.append((new_persona, r['id']))

    print(f"\n📊 Classification result:")
    print(f"  → gambler     : {counts['gambler']}")
    print(f"  → balanced    : {counts['balanced']} (changed to)")
    print(f"  → conservative: {counts['conservative']}")
    print(f"  → unchanged   : {counts['unchanged']}")
    print(f"  total updates : {len(updates)}")

    if not updates:
        print("\n✅ No changes needed.")
        conn.close()
        return

    # بعد: التوزيع المتوقع
    after_g = counts['gambler'] + before.get('gambler', 0)
    after_c = counts['conservative'] + before.get('conservative', 0)
    after_b = before.get('balanced', 0) - counts['gambler'] - counts['conservative'] + counts['balanced']
    print(f"\n📊 AFTER (expected): gambler={after_g}, balanced={after_b}, conservative={after_c}")

    if args.dry_run:
        print(f"\n🔍 DRY-RUN — no writes. Sample updates (first 10):")
        for new_persona, pid in updates[:10]:
            print(f"  id={pid} → {new_persona}")
        print(f"\nTo apply: python3 scripts/backfill_persona_classification.py --apply")
    else:
        print(f"\n✏️ Applying {len(updates)} updates...")
        conn.executemany(
            "UPDATE predictions SET persona = ? WHERE id = ?",
            updates,
        )
        conn.commit()
        after_actual = dict(conn.execute(
            "SELECT persona, COUNT(*) FROM predictions GROUP BY persona"
        ).fetchall())
        print(f"\n📊 AFTER (actual): {after_actual}")
        print(f"\n✅ Done. {len(updates)} predictions reclassified.")

    conn.close()


if __name__ == '__main__':
    main()
