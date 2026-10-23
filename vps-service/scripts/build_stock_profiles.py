#!/usr/bin/env python3
"""
Build Stock Profiles (Stock DNA) — بناء ملفات الأسهم التكيفية
=================================================================

السكربت ده بيبني "ملف السهم التكيفي" (Stock Adaptive Profile) لكل سهم
ويسجّله في جدول `stock_adaptive_profiles` في stocks.db.

الملف ده هو الـ DNA اللي بيقول للعقل (master_analyzer.py):
  - هل السهم ده "حيّ" (alive) ولا "نائم" (dormant)؟
  - هل حجم تداوله بيعمل amplifier (تضخيم) للحركة؟
  - هل فيه volume_spike متكرر؟
  - هل التذبذب عالي ولا منخفض؟
  - ما هو الـ personality_type (مضاربي/أساسي/دفاعي)؟

لما الـ DNA يقول إن السهم "حيّ"، الـ master_analyzer.py بـ:
  1. يفك القيود (constraints) — يسمح بـ BUY signals
  2. يخفض الـ thresholds — STRONG_BUY من 80→72، BUY من 65→58
  3. يزوّد الـ confidence boost — +5 لـ 10 نقاط

المصادر:
  1. stock_daily_prices (stocks.db) — التاريخ السعري
  2. StockDNAAnalyzer — تحليل البصمة السلوكية
  3. stocks table — القطاع والاسم والسعر

المخرجات:
  - جدول `stock_adaptive_profiles` في stocks.db
  - كل صف: ticker, personality_type, volatility_level, amplifier_score,
    volume_spike_freq, is_alive, constraints_loosened, threshold_boost,
    dna_json, updated_at

Usage:
    python3 scripts/build_stock_profiles.py
    python3 scripts/build_stock_profiles.py --market EGX
    python3 scripts/build_stock_profiles.py --ticker COMI

Author: M2yDevelopers Team
@version 1.0.0 — DNA-WIRING (Axis A)
"""

import sqlite3
import json
import math
import sys
import os
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

# ─── مسارات قواعد البيانات ──────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
_VPS_SERVICE_DIR = _SCRIPT_DIR.parent
_PROJECT_ROOT = _VPS_SERVICE_DIR.parent
_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
_PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')


# ============================================================================
# Schema: stock_adaptive_profiles
# ============================================================================
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS stock_adaptive_profiles (
    ticker TEXT PRIMARY KEY,
    name TEXT,
    sector TEXT,
    market TEXT DEFAULT 'EGX',

    -- الشخصية السلوكية
    personality_type TEXT,           -- speculative_bull, defensive_stable, banking_core, etc.
    personality_type_ar TEXT,        -- سهم مضاربي صاعد، سهم دفاعي مستقر، إلخ
    volatility_level TEXT,           -- low, medium, high
    volatility_pct REAL,             -- 23.5 (annual vol %)

    -- مؤشرات النشاط (DNA Flags)
    amplifier_score REAL DEFAULT 0,  -- 0.0 to 1.0 — مدى تضخيم السهم لحركة القطاع
    volume_spike_freq REAL DEFAULT 0,-- 0.0 to 1.0 — تكرار volume spikes
    is_alive INTEGER DEFAULT 0,      -- 1 = حيّ (يستاهل قيود مفكوكة)، 0 = نائم
    momentum_score REAL DEFAULT 0,   -- 0.0 to 1.0 — قوة الزخم التاريخي

    -- تعديلات القيود (Constraints) للعقل
    constraints_loosened INTEGER DEFAULT 0,  -- 1 = أفك القيود، 0 = قيود عادية
    threshold_boost REAL DEFAULT 0,  -- كم نخصم من الـ thresholds (مثلاً -7)
    confidence_boost REAL DEFAULT 0, -- كم نزود على الـ confidence (مثلاً +5)

    -- بيانات إضافية
    annual_return REAL,
    best_months TEXT,    -- JSON array
    worst_months TEXT,   -- JSON array
    behavioral_tags TEXT,-- JSON array
    sample_days INTEGER DEFAULT 0,
    confidence TEXT DEFAULT 'منخفضة', -- منخفضة/متوسطة/عالية

    -- النص السردي الكامل
    narrative TEXT,
    summary TEXT,

    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
"""


# ============================================================================
# Helpers
# ============================================================================
def _safe_float(val, default=0.0):
    try:
        v = float(val)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def _get_all_stocks(stocks_db: str, market: str = None, ticker: str = None) -> List[Dict]:
    """يجيب كل الأسهم من stocks.db (أو سوق محدد / سهم محدد)."""
    stocks = []
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(stocks_db, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # تحقق من وجود جدول stocks
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stocks'")
        if not cur.fetchone():
            conn.close()
            return []

        # تحقق من الأعمدة المتاحة
        cur.execute("PRAGMA table_info(stocks)")
        cols = {r[1] for r in cur.fetchall()}

        select_cols = ['ticker', 'name', 'name_ar', 'sector', 'market', 'current_price']
        available = [c for c in select_cols if c in cols]
        col_str = ', '.join(available)

        if ticker:
            cur.execute(f"SELECT {col_str} FROM stocks WHERE ticker = ? COLLATE NOCASE", (ticker,))
        elif market:
            if market.upper() == 'EGX':
                cur.execute(
                    f"SELECT {col_str} FROM stocks WHERE (market = 'EGX' OR market IS NULL) AND current_price > 0"
                )
            else:
                cur.execute(
                    f"SELECT {col_str} FROM stocks WHERE market = ? AND current_price > 0", (market,)
                )
        else:
            cur.execute(f"SELECT {col_str} FROM stocks WHERE current_price > 0")

        stocks = [dict(r) for r in cur.fetchall()]
        conn.close()
    except Exception as e:
        print(f"[BuildStockProfiles] ⚠️ Error reading stocks: {e}")
    return stocks


def _get_price_history(stocks_db: str, ticker: str, limit: int = 500) -> List[Dict]:
    """يجيب التاريخ السعري لسهم معين.

    PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
    The `stocks_db` argument is kept for signature compatibility but ignored
    (the unified reader picks the right DB automatically). The `change_percent`
    field is computed from consecutive closes since the unified reader does not
    return it.
    """
    # Lazy import — avoid circular deps with analyzers.master_analyzer.
    from data.prices import load_price_history

    rows = load_price_history(ticker, limit=limit)

    # Map unified format → caller format (with change_percent recomputed).
    history: List[Dict] = []
    prev_close = 0.0
    for r in rows:
        close = _safe_float(r.get('close'))
        if prev_close > 0:
            change = ((close - prev_close) / prev_close) * 100
        else:
            change = 0.0
        history.append({
            'date': r.get('date'),
            'open': _safe_float(r.get('open')),
            'high': _safe_float(r.get('high')),
            'low': _safe_float(r.get('low')),
            'close': close,
            'volume': _safe_float(r.get('volume')),
            'change_percent': change,
        })
        prev_close = close
    return history


def _calculate_volatility(history: List[Dict]) -> Tuple[str, float]:
    """يحسب التذبذب السنوي. Returns: (level, pct)."""
    if len(history) < 10:
        return 'unknown', 0.0
    daily_returns = [h['change_percent'] for h in history if math.isfinite(h['change_percent'])]
    if not daily_returns:
        return 'unknown', 0.0
    mean_r = sum(daily_returns) / len(daily_returns)
    variance = sum((r - mean_r) ** 2 for r in daily_returns) / len(daily_returns)
    daily_vol = math.sqrt(variance)
    annual_vol = daily_vol * math.sqrt(252)
    if annual_vol > 40:
        return 'high', round(annual_vol, 1)
    elif annual_vol > 20:
        return 'medium', round(annual_vol, 1)
    else:
        return 'low', round(annual_vol, 1)


def _calculate_amplifier_score(history: List[Dict]) -> float:
    """يحسب amplifier score — مدى تضخيم السهم للحركة.

    السهم اللي تحركاته اليومية أكبر من المتوسط يكون amplifier قوي.
    Score: 0.0 (خامل) to 1.0 (تضخيم عالي).

    المعادلة: (متوسط |change%| / 3%) مقلوب لـ 1.0 max.
    لو متوسط الحركة 3% أو أكبر → amplifier = 1.0
    لو متوسط الحركة 0% → amplifier = 0.0
    """
    if len(history) < 20:
        return 0.0
    abs_changes = [abs(h['change_percent']) for h in history if math.isfinite(h['change_percent'])]
    if not abs_changes:
        return 0.0
    avg_change = sum(abs_changes) / len(abs_changes)
    # normalize: 3% daily avg = 1.0, 0% = 0.0
    score = min(avg_change / 3.0, 1.0)
    return round(score, 3)


def _calculate_volume_spike_freq(history: List[Dict]) -> float:
    """يحسب تكرار volume spikes.

    Volume spike = يوم فيه حجم تداول ≥ 1.5x متوسط آخر 20 يوم.
    Score: 0.0 (مفيش spikes) to 1.0 (نسبة عالية من الأيام فيها spikes).
    """
    if len(history) < 30:
        return 0.0
    volumes = [h['volume'] for h in history if h['volume'] > 0]
    if len(volumes) < 20:
        return 0.0

    spike_count = 0
    for i in range(20, len(volumes)):
        window = volumes[max(0, i - 20):i]
        if not window:
            continue
        avg_vol = sum(window) / len(window)
        if avg_vol > 0 and volumes[i] >= avg_vol * 1.5:
            spike_count += 1

    total_checked = max(len(volumes) - 20, 1)
    return round(spike_count / total_checked, 3)


def _calculate_momentum_score(history: List[Dict]) -> float:
    """يحسب momentum score من العائد التاريخي.

    Score: 0.0 (هابط بقوة) to 1.0 (صاعد بقوة).
    0.5 = محايد.
    """
    if len(history) < 30:
        return 0.5
    try:
        recent = history[-30:]
        first_close = recent[0]['close']
        last_close = recent[-1]['close']
        if first_close <= 0:
            return 0.5
        ret_30d = (last_close - first_close) / first_close  # نسبة
        # خريطة: +20% → 1.0, 0% → 0.5, -20% → 0.0
        score = 0.5 + (ret_30d / 0.4)  # 40% range
        return round(max(0.0, min(1.0, score)), 3)
    except Exception:
        return 0.5


def _determine_alive(amplifier: float, vol_spike: float, momentum: float, vol_level: str) -> Tuple[int, str]:
    """يحدد هل السهم "حيّ" (يستاهل قيود مفكوكة).

    السهم حيّ لو:
    - amplifier ≥ 0.4 (تحركات يومية معتبرة), أو
    - volume_spike_freq ≥ 0.15 (فيه spikes متكررة), أو
    - momentum ≥ 0.6 (زخم صاعد), أو
    - volatility = high

    Returns: (is_alive: 0|1, reason: str)
    """
    reasons = []
    if amplifier >= 0.4:
        reasons.append(f'amplifier={amplifier:.2f}')
    if vol_spike >= 0.15:
        reasons.append(f'vol_spike={vol_spike:.2f}')
    if momentum >= 0.6:
        reasons.append(f'momentum={momentum:.2f}')
    if vol_level == 'high':
        reasons.append('vol=high')

    if reasons:
        return 1, ' | '.join(reasons)
    return 0, 'dormant'


def _compute_constraint_adjustments(
    is_alive: int, amplifier: float, vol_spike: float, momentum: float, vol_level: str
) -> Tuple[int, float, float]:
    """يحسب تعديلات القيود للعقل.

    Returns: (constraints_loosened, threshold_boost, confidence_boost)
    - constraints_loosened: 1 لو أفك القيود، 0 لو عادي
    - threshold_boost: كم نخصم من thresholds (سالب = نخفض العتبة)
    - confidence_boost: كم نزود على confidence (موجب)
    """
    if not is_alive:
        return 0, 0.0, 0.0

    # السهم الحيّ ياخد boost متدرج حسب قوة النشاط
    activity = (amplifier * 0.4) + (vol_spike * 0.3) + (momentum * 0.3)

    if activity >= 0.6:
        # نشاط عالي جداً → فك القيود بالكامل + boost كبير
        return 1, -8.0, 8.0
    elif activity >= 0.4:
        # نشاط متوسط → فك القيود جزئياً
        return 1, -5.0, 5.0
    elif activity >= 0.25:
        # نشاط خفيف → boost صغير بدون فك قيود
        return 0, -3.0, 3.0
    else:
        return 0, 0.0, 0.0


def _determine_personality(sector: str, vol_level: str, annual_return: Optional[float]) -> Tuple[str, str]:
    """يحدد نوع شخصية السهم. Returns: (personality_en, personality_ar)."""
    is_financial = any(k in (sector or '') for k in ['بنك', 'مال', 'Bank', 'Financial'])
    is_real_estate = any(k in (sector or '') for k in ['عقار', 'Real', 'Estate'])

    if vol_level == 'low' and annual_return is not None and annual_return > 5:
        return 'defensive_stable', 'سهم دفاعي مستقر'
    elif vol_level == 'high' and annual_return is not None and annual_return > 15:
        return 'speculative_bull', 'سهم مضاربي صاعد'
    elif vol_level == 'high':
        return 'speculative_volatile', 'سهم مضاربي متذبذب'
    elif is_financial:
        return 'banking_core', 'سهم بنكي أساسي'
    elif is_real_estate:
        return 'real_estate', 'سهم عقاري'
    elif annual_return is not None and annual_return > 10:
        return 'growth', 'سهم نمو'
    else:
        return 'general', 'سهم عام'


# ============================================================================
# Main Builder
# ============================================================================
def build_profiles(
    stocks_db: str = _STOCKS_DB,
    market: str = None,
    ticker: str = None,
) -> Dict:
    """يبني ملفات الأسهم التكيفية ويحفظها في stock_adaptive_profiles.

    Args:
        stocks_db: مسار stocks.db
        market: فلتر بالسوق (optional)
        ticker: فلتر بسهم واحد (optional)

    Returns:
        dict: {success, total, built, alive, errors, details}
    """
    print("=" * 70)
    print("🧬 Build Stock Profiles (Stock DNA) — Axis A: DNA Wiring")
    print("=" * 70)
    print(f"  Database: {stocks_db}")
    if market:
        print(f"  Market filter: {market}")
    if ticker:
        print(f"  Ticker filter: {ticker}")
    print()

    # 1. تأكد إن الجدول موجود
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(stocks_db, writable=False).__enter__()
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        print("  ✅ Table stock_adaptive_profiles ready")
    except Exception as e:
        print(f"  ❌ Failed to create table: {e}")
        return {'success': False, 'error': str(e), 'built': 0}
    conn.close()

    # 2. اجلب قائمة الأسهم
    stocks = _get_all_stocks(stocks_db, market=market, ticker=ticker)
    if not stocks:
        print("  ⚠️ No stocks found in stocks.db (table empty or no matching rows)")
        return {
            'success': True,
            'total': 0,
            'built': 0,
            'alive': 0,
            'errors': 0,
            'message': 'No stocks in stocks.db — run data engine sync first',
        }
    print(f"  📋 Found {len(stocks)} stocks to profile")
    print()

    # 3. ابنِ الملف لكل سهم
    built = 0
    alive_count = 0
    errors = 0
    details = []

    # جرّب تستخدم StockDNAAnalyzer لو متاح (للنص السردي والوسوم)
    try:
        sys.path.insert(0, str(_VPS_SERVICE_DIR))
        from analyzers.stock_dna_analyzer import StockDNAAnalyzer
        dna_analyzer = StockDNAAnalyzer(stocks_db=stocks_db)
        use_dna_analyzer = True
        print("  ✅ StockDNAAnalyzer loaded (for narrative + behavioral tags)")
    except Exception as e:
        print(f"  ⚠️ StockDNAAnalyzer not available ({e}) — using basic profiling only")
        use_dna_analyzer = False

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(stocks_db, writable=False).__enter__()
    conn.executescript(SCHEMA_SQL)

    for i, stock in enumerate(stocks):
        ticker_sym = (stock.get('ticker') or '').upper().strip()
        if not ticker_sym:
            continue

        try:
            name = stock.get('name_ar') or stock.get('name') or ticker_sym
            sector = stock.get('sector') or 'غير محدد'
            stock_market = stock.get('market') or 'EGX'

            # اجلب التاريخ السعري
            history = _get_price_history(stocks_db, ticker_sym, limit=500)
            if len(history) < 10:
                # لو مفيش تاريخ كافي، سجّل ملف "dormant" بدل ما تكسر
                vol_level, vol_pct = 'unknown', 0.0
                amplifier, vol_spike, momentum = 0.0, 0.0, 0.5
                is_alive, alive_reason = 0, 'no_history'
                loosened, thr_boost, conf_boost = 0, 0.0, 0.0
                annual_return = None
                best_months_json, worst_months_json, tags_json = '[]', '[]', '[]'
                narrative, summary = '', f'🧬 بصمة السهم: {ticker_sym} (بيانات غير كافية)'
                personality_en, personality_ar = 'general', 'سهم عام'
            else:
                # احسب المؤشرات
                vol_level, vol_pct = _calculate_volatility(history)
                amplifier = _calculate_amplifier_score(history)
                vol_spike = _calculate_volume_spike_freq(history)
                momentum = _calculate_momentum_score(history)

                # العائد السنوي
                annual_return = None
                if len(history) >= 60:
                    try:
                        year_ago = history[-252] if len(history) >= 252 else history[0]
                        current = history[-1]
                        if year_ago['close'] > 0:
                            annual_return = round(
                                ((current['close'] - year_ago['close']) / year_ago['close']) * 100, 1
                            )
                    except Exception:
                        pass

                # الشخصية
                personality_en, personality_ar = _determine_personality(sector, vol_level, annual_return)

                # هل السهم حيّ؟
                is_alive, alive_reason = _determine_alive(amplifier, vol_spike, momentum, vol_level)

                # تعديلات القيود
                loosened, thr_boost, conf_boost = _compute_constraint_adjustments(
                    is_alive, amplifier, vol_spike, momentum, vol_level
                )

                # استخدم StockDNAAnalyzer للنص السردي والوسوم (لو متاح)
                narrative, summary = '', ''
                best_months_json, worst_months_json, tags_json = '[]', '[]', '[]'
                if use_dna_analyzer:
                    try:
                        dna_result = dna_analyzer.analyze(ticker_sym, history=history)
                        if dna_result:
                            summary = dna_result.summary or ''
                            narrative = dna_result.narrative or ''
                            best_months_json = json.dumps(
                                [{'month': m.get('month', ''), 'avg_change': m.get('avg_change', 0)}
                                 for m in (dna_result.best_months or [])],
                                ensure_ascii=False
                            )
                            worst_months_json = json.dumps(
                                [{'month': m.get('month', ''), 'avg_change': m.get('avg_change', 0)}
                                 for m in (dna_result.worst_months or [])],
                                ensure_ascii=False
                            )
                            tags_json = json.dumps(dna_result.behavioral_tags or [], ensure_ascii=False)
                    except Exception as e:
                        print(f"    ⚠️ DNA analyzer failed for {ticker_sym}: {e}")

                if not summary:
                    summary = f"🧬 بصمة السهم: {personality_ar} | قطاع {sector} | تذبذب {vol_level}"

            # الثقة
            sample_days = len(history)
            if sample_days >= 120:
                confidence = 'عالية'
            elif sample_days >= 60:
                confidence = 'متوسطة'
            else:
                confidence = 'منخفضة'

            # IDX
            if is_alive:
                alive_count += 1

            # حفظ في DB
            conn.execute("""
                INSERT OR REPLACE INTO stock_adaptive_profiles
                    (ticker, name, sector, market,
                     personality_type, personality_type_ar, volatility_level, volatility_pct,
                     amplifier_score, volume_spike_freq, is_alive, momentum_score,
                     constraints_loosened, threshold_boost, confidence_boost,
                     annual_return, best_months, worst_months, behavioral_tags,
                     sample_days, confidence, narrative, summary, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (
                ticker_sym, name, sector, stock_market,
                personality_en, personality_ar, vol_level, vol_pct,
                amplifier, vol_spike, is_alive, momentum,
                loosened, thr_boost, conf_boost,
                annual_return, best_months_json, worst_months_json, tags_json,
                sample_days, confidence, narrative, summary,
            ))
            built += 1

            # Log للأسهم الحية فقط (عشان ما نغرقش الـ output)
            if is_alive:
                print(f"  🟢 {ticker_sym:8s} ALIVE  amp={amplifier:.2f} spike={vol_spike:.2f} mom={momentum:.2f} → loosen={loosened} thr={thr_boost:+.0f} conf={conf_boost:+.0f} ({alive_reason})")

            details.append({
                'ticker': ticker_sym,
                'is_alive': is_alive,
                'amplifier': amplifier,
                'volume_spike': vol_spike,
                'momentum': momentum,
                'constraints_loosened': loosened,
                'threshold_boost': thr_boost,
                'confidence_boost': conf_boost,
            })

        except Exception as e:
            errors += 1
            print(f"  ❌ {ticker_sym}: {e}")
            continue

    conn.commit()
    conn.close()

    print()
    print("=" * 70)
    print(f"  ✅ Build complete: {built}/{len(stocks)} profiles built")
    print(f"  🟢 Alive stocks (constraints loosened): {alive_count}")
    print(f"  ❌ Errors: {errors}")
    print("=" * 70)

    return {
        'success': True,
        'total': len(stocks),
        'built': built,
        'alive': alive_count,
        'errors': errors,
        'details': details[:50],  # أول 50 تفصيل فقط
    }


# ============================================================================
# CLI
# ============================================================================
def main():
    import argparse
    parser = argparse.ArgumentParser(description='Build Stock Adaptive Profiles (DNA)')
    parser.add_argument('--market', type=str, default=None, help='Market filter (EGX, TADAWUL, etc.)')
    parser.add_argument('--ticker', type=str, default=None, help='Single ticker filter')
    args = parser.parse_args()

    result = build_profiles(market=args.market, ticker=args.ticker)

    if result['success']:
        print(f"\n🎉 Success! {result['built']} profiles built, {result['alive']} alive.")
        sys.exit(0)
    else:
        print(f"\n💥 Failed: {result.get('error', 'unknown')}")
        sys.exit(1)


if __name__ == '__main__':
    main()
