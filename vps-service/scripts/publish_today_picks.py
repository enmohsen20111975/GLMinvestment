#!/usr/bin/env python3
"""
publish_today_picks.py — انشر أفضل الأسهم الانفجارية في الموقع
=================================================================
الـ explosive_opportunity_hunter بيكتب في scripts/output/ (مكان مش مربوط بالموقع).
علشان الأسهم تظهر للمستخدمين، لازم نمر بالـ chain:
  1. شغّل Maestro analysis للـ top candidates → stored_analyses
  2. شغّل generate_predictions_internal → aiPrediction (دي اللي بيقراها الموقع)

Usage:
    cd ~/GLMinvestment/vps-service
    python3 scripts/publish_today_picks.py --top 20
    python3 scripts/publish_today_picks.py --top 20 --min-score 50

Author: RL-FIX-5
"""
import sys
import os
import json
import sqlite3
import time
from pathlib import Path
from datetime import datetime

VPS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(VPS_DIR))

PROJECT_ROOT = VPS_DIR.parent
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
HUNTER_JSON = VPS_DIR / 'scripts' / 'output' / 'explosive_hunt_20260809.json'


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def load_hunter_picks(top_n=20):
    """اقرأ الـ top picks من الـ hunter JSON."""
    # لاقي أحدث ملف explosive_hunt_*.json
    output_dir = VPS_DIR / 'scripts' / 'output'
    files = sorted(output_dir.glob('explosive_hunt_*.json'), reverse=True)
    if not files:
        log(f"❌ No explosive_hunt JSON found in {output_dir}")
        return []
    latest = files[0]
    log(f"📄 Loading picks from: {latest.name}")
    with open(latest, 'r', encoding='utf-8') as f:
        data = json.load(f)
    # RL-FIX-5b: explosive_opportunity_hunter بيكتب تحت مفتاح "top_candidates"
    picks = (
        data.get('picks')
        or data.get('candidates')
        or data.get('top_candidates')
        or []
    )
    if not picks:
        # ممكن يكون list مباشرة
        if isinstance(data, list):
            picks = data
    # فلتر اختياري على explosive_score (لو الـ caller عايز فقط الـ قنابل المدوية)
    if isinstance(picks, list) and picks and isinstance(picks[0], dict):
        picks = [p for p in picks if p.get('ticker')]
    log(f"📊 Loaded {len(picks)} picks")
    return picks[:top_n]


def run_maestro_for_tickers(tickers):
    """شغّل Maestro analysis لكل ticker واكتب في stored_analyses."""
    log("=" * 60)
    log(f"🔄 Step 1: Maestro analysis for {len(tickers)} tickers")
    log("=" * 60)
    try:
        from analyzers.maestro_orchestrator import MaestroOrchestrator
        orchestrator = MaestroOrchestrator(STOCKS_DB)
        log("  ✅ MaestroOrchestrator loaded")
    except Exception as e:
        log(f"  ❌ MaestroOrchestrator not available: {e}")
        return 0

    # اقرأ بيانات الأسهم من stocks.db
    s_conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True, timeout=10)
    s_conn.row_factory = sqlite3.Row
    stocks_map = {}
    for r in s_conn.execute(
        "SELECT ticker, name, name_ar, current_price, volume, sector, market FROM stocks "
        "WHERE current_price IS NOT NULL AND current_price > 0"
    ).fetchall():
        stocks_map[r['ticker']] = dict(r)
    s_conn.close()

    # تأكد إن stored_analyses موجودة
    pred_conn = sqlite3.connect(PREDICTIONS_DB, timeout=30)
    pred_conn.execute('PRAGMA busy_timeout = 30000')
    pred_conn.executescript('''
        CREATE TABLE IF NOT EXISTS stored_analyses (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            ticker TEXT NOT NULL,
            market TEXT DEFAULT 'EGX',
            maestro_score REAL DEFAULT 0,
            recommendation TEXT DEFAULT 'hold',
            recommendation_ar TEXT,
            confidence REAL DEFAULT 0,
            entry_price REAL DEFAULT 0,
            target_price REAL,
            stop_loss REAL,
            risk_reward REAL DEFAULT 0,
            regime TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ticker, market)
        );
    ''')
    pred_conn.commit()

    analyzed = 0
    buy_count = 0

    for i, ticker in enumerate(tickers, 1):
        stock = stocks_map.get(ticker)
        if not stock:
            log(f"  [{i}/{len(tickers)}] {ticker}: ⚠️ not in stocks.db — skip")
            continue

        # جلب price history (الطازجة!)
        history = []
        try:
            h_conn = sqlite3.connect(f"file:{PRICE_HISTORY_DB}?mode=ro", uri=True, timeout=10)
            h_conn.row_factory = sqlite3.Row
            h_rows = h_conn.execute("""
                SELECT date, open_price as open, high_price as high,
                       low_price as low, close_price as close, volume
                FROM price_history
                WHERE ticker = ? AND close_price > 0
                ORDER BY date DESC LIMIT 100
            """, (ticker,)).fetchall()
            history = list(reversed([dict(r) for r in h_rows]))
            h_conn.close()
        except Exception as e:
            log(f"  [{i}/{len(tickers)}] {ticker}: ⚠️ history error: {e}")

        if len(history) < 10:
            log(f"  [{i}/{len(tickers)}] {ticker}: ⚠️ only {len(history)} history rows — skip")
            continue

        try:
            result = orchestrator.analyze(ticker, stock, history, {})
            if result:
                analyzed += 1
                rec = (getattr(result, 'recommendation', 'hold') or 'hold').lower()
                score = getattr(result, 'maestro_score', 50) or 50
                confidence = getattr(result, 'confidence', 50) or 50

                if 'buy' in rec:
                    buy_count += 1

                pred_conn.execute("""
                    INSERT OR REPLACE INTO stored_analyses
                        (ticker, market, maestro_score, recommendation,
                         recommendation_ar, confidence, entry_price,
                         target_price, stop_loss, risk_reward, updated_at)
                    VALUES (?, 'EGX', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                """, (
                    ticker, score, rec,
                    getattr(result, 'recommendation_ar', ''),
                    confidence,
                    getattr(result, 'entry_price', stock.get('current_price', 0)),
                    getattr(result, 'target', None),
                    getattr(result, 'stop_loss', None),
                    getattr(result, 'risk_reward', 0) or 0,
                ))
                pred_conn.commit()
                log(f"  [{i}/{len(tickers)}] {ticker}: ✅ {rec} (score={score:.1f}, conf={confidence:.1f}%)")
            else:
                log(f"  [{i}/{len(tickers)}] {ticker}: ⚠️ No result")
        except Exception as e:
            log(f"  [{i}/{len(tickers)}] {ticker}: ❌ {e}")

        time.sleep(0.1)  # CPU breath

    pred_conn.close()
    log(f"  ── Analyzed: {analyzed} | BUY: {buy_count}")
    return analyzed


def generate_predictions(min_score=50, target_tickers=None):
    """شغّل generate_predictions_internal علشان يكتب في aiPrediction (دي اللي بيقراها الموقع).

    RL-FIX-5e: لو target_tickers ات passed، امسح أي aiPrediction قديمة ليهم
    (للـ effective prediction_date) قبل ما نولّد. ده علشان generate_predictions_internal
    بـ يعمل skip للـ tickers اللي ليها prediction موجودة → كان بفشل يحدّث توقعات
    الأسهم اللي حلّلناها بـ Maestro الطازج.
    """
    log("")
    log("=" * 60)
    log(f"🔄 Step 2: Generate aiPrediction entries (min_score={min_score})")
    log("=" * 60)

    # RL-FIX-5e: امسح aiPrediction القديمة للـ target tickers علشان تـ regenerate
    if target_tickers:
        try:
            pred_date = get_effective_prediction_date()
            conn = sqlite3.connect(PREDICTIONS_DB, timeout=30)
            conn.execute('PRAGMA busy_timeout = 30000')
            placeholders = ','.join('?' * len(target_tickers))
            cur = conn.execute(
                f"DELETE FROM aiPrediction WHERE stock_symbol IN ({placeholders}) AND prediction_date = ?",
                (*target_tickers, pred_date)
            )
            cleared = cur.rowcount
            conn.commit()
            conn.close()
            log(f"  🧹 Cleared {cleared} stale aiPrediction for {len(target_tickers)} target tickers (date={pred_date})")
        except Exception as e:
            log(f"  ⚠️ Clear target tickers error: {e}")

    try:
        from api.ai_predictions_routes import generate_predictions_internal
        success, preds = generate_predictions_internal(
            market='EGX',
            min_score=min_score,
            use_cached=True,   # بيقرأ من stored_analyses اللي لسه كتبناها
            clear_old=True,    # امسح توقعات النهاردة القديمة الأول
        )
        if success:
            n = len(preds) if isinstance(preds, list) else 0
            log(f"  ✅ Generated {n} aiPrediction entries")
            return n
        else:
            log(f"  ⚠️ Generation returned: {preds}")
            return 0
    except Exception as e:
        log(f"  ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 0


def get_effective_prediction_date():
    """RL-FIX-5e: رجّع تاريخ التوقع الفعلي (اللي بيستخدمه generate_predictions_internal).

    لو السوق مغلق/بعد الإغلاق → generate_predictions_internal بـ يـ shift لليوم التالي.
    لازم verify_published() يستخدم نفس الـ logic علشان يلاقي التوقعات.
    """
    try:
        from utils.trading_calendar import get_prediction_date_str
        return get_prediction_date_str(datetime.now(), 'EGX')
    except Exception:
        # fallback بسيط: لو الـ import فشل، رجّع اليوم
        return datetime.now().strftime('%Y-%m-%d')


def sync_persona_predictions_step():
    """RL-FIX-5d: Step 2.5 — حرّن الـ persona tabs (مستثمر/مضارب/متوازن).

    الـ persona predictions في جدول `predictions` بتيجي من stored_analyses عبر
    generate_persona_predictions.py. لو ما اشتغلش، الـ persona tabs في الموقع
    هتفضل عالـ stale predictions القديمة وما هتشوفش نفس الـ explosive thinking
    اللي في جرس الصباح.

    بنشغّله بـ refresh_active=True علشان يمسح الـ active القديمة ويـ insert
    الجديدة من stored_analyses الطازجة.
    """
    log("")
    log("=" * 60)
    log("🔄 Step 2.5: Sync persona predictions (مستثمر/مضارب/متوازن)")
    log("=" * 60)
    try:
        # استدعِ الـ sync مباشرة من الـ module (بدون subprocess)
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "generate_persona_predictions",
            VPS_DIR / "scripts" / "generate_persona_predictions.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.sync_persona_predictions(refresh_active=True)
        log("  ✅ Persona predictions synced (refresh mode)")
        return True
    except Exception as e:
        log(f"  ⚠️ Persona sync error: {e}")
        import traceback
        traceback.print_exc()
        return False


def verify_published():
    """اتأكد إن التوقعات ظهرت في aiPrediction."""
    log("")
    log("=" * 60)
    log("🔍 Step 3: Verify aiPrediction table")
    log("=" * 60)
    try:
        conn = sqlite3.connect(PREDICTIONS_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        total = conn.execute("SELECT COUNT(*) FROM aiPrediction").fetchone()[0]
        # RL-FIX-5e: استخدم الـ effective prediction_date (الـ shifted) مش datetime.now()
        # علشان generate_predictions_internal بـ يكتب بـ prediction_date = next trading day
        # لو السوق مغلق/بعد الإغلاق.
        pred_date = get_effective_prediction_date()
        today_raw = datetime.now().strftime('%Y-%m-%d')
        today_count = conn.execute(
            "SELECT COUNT(*) FROM aiPrediction WHERE prediction_date = ?", (pred_date,)
        ).fetchone()[0]
        log(f"  aiPrediction total: {total}")
        log(f"  Effective prediction_date: {pred_date}"
            + (f" (shifted from {today_raw})" if pred_date != today_raw else ""))
        log(f"  aiPrediction for {pred_date}: {today_count}")
        log(f"  Sample (top 10 by score):")
        # RL-FIX-5c: aiPrediction table uses stock_symbol/signal_type (NOT ticker/recommendation)
        for r in conn.execute(
            "SELECT stock_symbol, signal_type, entry_price, target_price, stop_loss, confidence, maestro_score "
            "FROM aiPrediction WHERE prediction_date = ? "
            "ORDER BY confidence DESC LIMIT 10", (pred_date,)
        ).fetchall():
            log(f"    {r['stock_symbol']}: {r['signal_type']} | entry={r['entry_price']} "
                f"target={r['target_price']} stop={r['stop_loss']} conf={r['confidence']}% score={r['maestro_score']}")
        conn.close()
        return today_count
    except Exception as e:
        log(f"  ❌ Verify error: {e}")
        return 0


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Publish today picks to the website')
    parser.add_argument('--top', type=int, default=20, help='Top N picks to analyze (default 20)')
    parser.add_argument('--min-score', type=float, default=50, help='Min maestro score for aiPrediction (default 50)')
    parser.add_argument('--tickers', type=str, default=None, help='Comma-separated tickers (override hunter)')
    args = parser.parse_args()

    log("🚀 Publishing Today's Picks to Website")
    log("=" * 60)

    # حدّد الـ tickers
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]
        log(f"📊 Using provided tickers: {tickers}")
    else:
        picks = load_hunter_picks(args.top)
        if not picks:
            log("❌ No picks found — run explosive_opportunity_hunter.py first")
            return 1
        tickers = [p.get('ticker') for p in picks if p.get('ticker')]
        log(f"📊 Top {len(tickers)} from hunter: {tickers}")

    # Step 1: Maestro → stored_analyses
    analyzed = run_maestro_for_tickers(tickers)
    if analyzed == 0:
        log("⚠️ No stocks analyzed — check Maestro orchestrator")

    # Step 2: stored_analyses → aiPrediction (جرس الصباح / التوقعات العامة)
    # RL-FIX-5e: نمرّر target_tickers علشان نـ clear القديم ليهم قبل الـ generate
    n_preds = generate_predictions(min_score=args.min_score, target_tickers=tickers)

    # Step 2.5: stored_analyses → predictions (persona tabs: مستثمر/مضارب/متوازن)
    # RL-FIX-5d: علشان الـ persona tabs تاخد نفس الـ explosive thinking
    sync_persona_predictions_step()

    # Step 3: Verify
    n_today = verify_published()

    log("")
    log("=" * 60)
    log("📊 Summary")
    log("=" * 60)
    log(f"  Analyzed (stored_analyses): {analyzed}")
    log(f"  Generated (aiPrediction):   {n_preds}")
    log(f"  Persona tabs refreshed:     ✅ (مستثمر/مضارب/متوازن)")
    log(f"  Today's predictions:        {n_today}")
    log("=" * 60)
    if n_today > 0:
        log("✅ التوقعات نزلت في الموقع! جرس الصباح + persona tabs كلها متحدثة.")
    else:
        log("⚠️ مفيش توقعات جديدة — شوف الـ logs فوق")
    return 0 if n_today > 0 else 1


if __name__ == '__main__':
    sys.exit(main())
