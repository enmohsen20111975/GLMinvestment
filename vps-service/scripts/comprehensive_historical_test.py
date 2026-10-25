#!/usr/bin/env python3
"""
Comprehensive Historical Backtest — Momentum Override + Pump & Dump Guard
=========================================================================
اختبار رجعي مركّز على التعديلات الجريئة (P14) + سياج الحماية (P15).

الهدف: نقيس نسبة النجاح (Win Rate) لإشارات الـ Momentum Override على آخر
30 يوم تداول في قاعدة البيانات التاريخية، ومقارنة:
  (أ) الـ Override الخام (بدون سياج) — هل بيفجر المحفظة؟
  (ب) الـ Override + Pump & Dump Guard — هل السياج بيحمي؟

منطق الإشارة (مطابق لـ master_analyzer.py L1488-1564):
  - vol_ratio >= 2.0  (حجم اليوم / متوسط 20 يوم)
  - change_today >= 4%
  - price > SMA20
  → Momentum Override يشتغل (BUY at master_score=70)

سياج الحماية (P15):
  - لو متوسط أحجام الـ 3 أيام السابقة < 100K → ارفض الـ Override
    (سهم ميت فجأة طفر = تربية دجاج)

قياس النتيجة:
  - entry = close price يوم الإشارة
  - return_T+k = (close[D+k] - close[D]) / close[D] * 100  لـ k=1,3,5
  - Win (lenient) = return > 0
  - Win (strict, يغطي slippage) = return > +1%

Task ID: 15
"""

import sqlite3
import sys
import json
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional

# ─────────────────────────── PATHS ───────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
SANDBOX_DB = str(PROJECT_ROOT / 'db_test_sandbox' / 'price_history.db')
STOCKS_DB = str(PROJECT_ROOT / 'db_test_sandbox' / 'stocks.db')
OUTPUT_DIR = Path(__file__).resolve().parent.parent / 'backtest_results'
OUTPUT_DIR.mkdir(exist_ok=True)

# ─────────────────────── PARAMS (مطابقة لـ master_analyzer) ───────────────
VOL_RATIO_MIN = 2.0       # volume_ratio >= 2.0 (ضعف المتوسط)
CHANGE_TODAY_MIN = 4.0    # change_today >= 4%
SMA_PERIOD = 20           # SMA20
PUMP_DUMP_VOL_THRESHOLD = 100_000   # متوسط 3 أيام سابقة < 100K = سهم ميت
WIN_STRICT_PCT = 1.0      # return > +1% = win (يغطي slippage ~5min delay)
LOOKBACK_DAYS = 30        # آخر 30 يوم تداول


@dataclass
class Signal:
    ticker: str
    signal_date: str
    entry_price: float
    vol_ratio: float
    change_today: float
    sma20: float
    avg_prev3_vol: float
    override_fired: bool           # الـ Override الخام اشتغل
    guard_rejected: bool           # السياج رفضه (pump&dump signature)
    # forward returns (None لو مفيش بيانات)
    ret_t1: Optional[float] = None
    ret_t3: Optional[float] = None
    ret_t5: Optional[float] = None


def load_egx_tickers() -> List[str]:
    """نجيب رموز EGX من stocks.db (لو متاح)، وإلا نرجّع كل الرموز الأبجدية."""
    tickers = []
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(STOCKS_DB, writable=False)
        cur = conn.cursor()
        # نحاول نفلتر بـ market='EGX'
        try:
            rows = cur.execute(
                "SELECT DISTINCT symbol FROM stocks WHERE market='EGX' AND symbol IS NOT NULL"
            ).fetchall()
            tickers = [r[0] for r in rows if r[0]]
        except Exception:
            rows = cur.execute(
                "SELECT DISTINCT symbol FROM stocks WHERE symbol IS NOT NULL"
            ).fetchall()
            tickers = [r[0] for r in rows if r[0]]
        conn.close()
    except Exception as e:
        print(f"[warn] stocks.db غير متاح ({e}) — هنستخدم كل الرموز الأبجدية")
    # فلتر أبجدي فقط (نستبعد الرموز الرقمية للأسواق الخليجية)
    return [t for t in tickers if t and t[0].isalpha()]


def load_price_series(conn, ticker: str) -> List[Dict]:
    """نحمّل سلسلة أسعار سهم مرتبة تصاعدياً حسب التاريخ."""
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT date, close_price, volume FROM price_history "
        "WHERE ticker=? AND close_price IS NOT NULL AND close_price > 0 "
        "ORDER BY date ASC", (ticker,)
    ).fetchall()
    return [{'date': r[0], 'close': float(r[1]), 'volume': int(r[2] or 0)} for r in rows]


def evaluate_override(series: List[Dict], idx: int) -> Optional[Signal]:
    """نقيّم إشارة الـ Override في اليوم idx (بتطابق منطق master_analyzer)."""
    if idx < 20:  # محتاجين 20 يوم لـ SMA20 + 3 أيام سابقة
        return None
    today = series[idx]
    prev = series[idx - 1]
    closes = [s['close'] for s in series]
    vols = [s['volume'] for s in series]

    sma20 = sum(closes[idx - 20:idx + 1]) / 20.0
    avg_vol_20 = sum(vols[idx - 20:idx + 1]) / 20.0
    today_vol = vols[idx]
    vol_ratio = (today_vol / avg_vol_20) if avg_vol_20 > 0 else 1.0
    change_today = ((today['close'] - prev['close']) / prev['close'] * 100) if prev['close'] > 0 else 0.0

    # شرط الـ Override
    override = (vol_ratio >= VOL_RATIO_MIN
                and change_today >= CHANGE_TODAY_MIN
                and today['close'] > sma20)
    if not override:
        return None

    # سياج Pump & Dump Guard
    prev3_vols = vols[idx - 3:idx]  # الـ 3 أيام قبل اليوم الحالي
    avg_prev3 = sum(prev3_vols) / 3.0 if len(prev3_vols) == 3 else today_vol
    guard_rejected = avg_prev3 < PUMP_DUMP_VOL_THRESHOLD

    # forward returns
    ret_t1 = ret_t3 = ret_t5 = None
    if idx + 1 < len(series):
        ret_t1 = (series[idx + 1]['close'] - today['close']) / today['close'] * 100
    if idx + 3 < len(series):
        ret_t3 = (series[idx + 3]['close'] - today['close']) / today['close'] * 100
    if idx + 5 < len(series):
        ret_t5 = (series[idx + 5]['close'] - today['close']) / today['close'] * 100

    return Signal(
        ticker=series[0].get('ticker', ''),
        signal_date=today['date'],
        entry_price=round(today['close'], 4),
        vol_ratio=round(vol_ratio, 2),
        change_today=round(change_today, 2),
        sma20=round(sma20, 4),
        avg_prev3_vol=round(avg_prev3, 0),
        override_fired=True,
        guard_rejected=guard_rejected,
        ret_t1=round(ret_t1, 2) if ret_t1 is not None else None,
        ret_t3=round(ret_t3, 2) if ret_t3 is not None else None,
        ret_t5=round(ret_t5, 2) if ret_t5 is not None else None,
    )


def win_rate(signals: List[Signal], horizon: str, strict: bool) -> Dict:
    """نحسب نسبة النجاح لـ horizon معين (t1/t3/t5)."""
    key = f'ret_{horizon}'
    valid = [s for s in signals if getattr(s, key) is not None]
    if not valid:
        return {'count': 0, 'wins': 0, 'losses': 0, 'neutrals': 0,
                'win_rate': 0.0, 'loss_rate': 0.0, 'avg_return': 0.0}
    threshold = WIN_STRICT_PCT if strict else 0.0
    wins = [s for s in valid if getattr(s, key) > threshold]
    losses = [s for s in valid if getattr(s, key) < -threshold]
    neutrals = [s for s in valid if -threshold <= getattr(s, key) <= threshold]
    avg_ret = sum(getattr(s, key) for s in valid) / len(valid)
    return {
        'count': len(valid),
        'wins': len(wins),
        'losses': len(losses),
        'neutrals': len(neutrals),
        'win_rate': round(len(wins) / len(valid) * 100, 1),
        'loss_rate': round(len(losses) / len(valid) * 100, 1),
        'avg_return': round(avg_ret, 2),
    }


def main():
    print("=" * 78)
    print("  COMPREHENSIVE HISTORICAL BACKTEST — Momentum Override + Pump&Dump Guard")
    print("  Task ID: 15  |  Target: Win Rate validation for P14+P15 changes")
    print("=" * 78)

    if not Path(SANDBOX_DB).exists():
        print(f"[FATAL] sandbox DB not found: {SANDBOX_DB}")
        print("        شغّل: unzip db/price_history.db.zip -d db_test_sandbox/")
        sys.exit(1)

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(SANDBOX_DB, writable=False)

    # آخر 30 يوم تداول
    trading_days = [r[0] for r in conn.execute(
        "SELECT DISTINCT date FROM price_history ORDER BY date DESC LIMIT ?",
        (LOOKBACK_DAYS,)
    ).fetchall()]
    trading_days.sort()
    print(f"\n[1] نطاق الاختبار: آخر {LOOKBACK_DAYS} يوم تداول")
    print(f"    من {trading_days[0]} إلى {trading_days[-1]}")

    # الرموز
    tickers = load_egx_tickers()
    if not tickers:
        # fallback: كل الرموز الأبجدية في price_history
        tickers = [r[0] for r in conn.execute(
            "SELECT DISTINCT ticker FROM price_history WHERE ticker GLOB '[A-Z]*'"
        ).fetchall()]
    print(f"[2] عدد الرموز المرشحة: {len(tickers)}")

    # نفحص كل سهم في كل يوم
    all_signals: List[Signal] = []
    start_date = trading_days[0]
    for i, tk in enumerate(tickers):
        series = load_price_series(conn, tk)
        if len(series) < 25:
            continue
        for idx in range(20, len(series)):
            if series[idx]['date'] < start_date:
                continue
            if series[idx]['date'] > trading_days[-1]:
                break
            sig = evaluate_override(series, idx)
            if sig:
                sig.ticker = tk
                all_signals.append(sig)
    conn.close()

    print(f"[3] إجمالي إشارات الـ Momentum Override (خام): {len(all_signals)}")

    if not all_signals:
        print("\n[!] مفيش إشارات override في النطاق — السوق كان هادي أو البيانات محدودة.")
        print("    ده نفسه نتيجة مهمة: الـ Override مش هيفجر المحفظة.")
        _save_report(all_signals, {'note': 'no signals in range'})
        return

    # ── تقسيم: خام vs مع السياج ──
    raw_signals = all_signals  # كل الإشارات (بدون سياج)
    guarded_signals = [s for s in all_signals if not s.guard_rejected]
    rejected_by_guard = [s for s in all_signals if s.guard_rejected]

    print(f"    - إشارات اشتغل فيها الـ Override الخام: {len(raw_signals)}")
    print(f"    - إشارات رفضها السياج (Pump&Dump): {len(rejected_by_guard)}")
    print(f"    - إشارات قبلها السياج (نهائية): {len(guarded_signals)}")

    print("\n" + "─" * 78)
    print("  (أ) Override الخام — بدون سياج (المخاطرة الكاملة)")
    print("─" * 78)
    for horizon, label in [('t1', 'T+1 (يوم)'), ('t3', 'T+3 (أيام)'), ('t5', 'T+5 (أيام)')]:
        wr_lenient = win_rate(raw_signals, horizon, strict=False)
        wr_strict = win_rate(raw_signals, horizon, strict=True)
        print(f"  {label:14s} | lenient(>0%): win={wr_lenient['win_rate']}% "
              f"avg={wr_lenient['avg_return']:+.2f}% (n={wr_lenient['count']})")
        print(f"  {'':14s} | strict(>+1%): win={wr_strict['win_rate']}% "
              f"loss={wr_strict['loss_rate']}% (n={wr_strict['count']})")

    print("\n" + "─" * 78)
    print("  (ب) Override + Pump&Dump Guard — مع السياج (الآمن)")
    print("─" * 78)
    if guarded_signals:
        for horizon, label in [('t1', 'T+1 (يوم)'), ('t3', 'T+3 (أيام)'), ('t5', 'T+5 (أيام)')]:
            wr_lenient = win_rate(guarded_signals, horizon, strict=False)
            wr_strict = win_rate(guarded_signals, horizon, strict=True)
            print(f"  {label:14s} | lenient(>0%): win={wr_lenient['win_rate']}% "
                  f"avg={wr_lenient['avg_return']:+.2f}% (n={wr_lenient['count']})")
            print(f"  {'':14s} | strict(>+1%): win={wr_strict['win_rate']}% "
                  f"loss={wr_strict['loss_rate']}% (n={wr_strict['count']})")
    else:
        print("  [!] السياج رفض كل الإشارات — مفيش نهائية لقياسها.")

    print("\n" + "─" * 78)
    print("  (ج) فحص السياج — هل رفض الصح؟")
    print("─" * 78)
    if rejected_by_guard:
        print(f"  الإشارات اللي رفضها السياج ({len(rejected_by_guard)}):")
        for horizon, label in [('t1', 'T+1'), ('t3', 'T+3'), ('t5', 'T+5')]:
            wr = win_rate(rejected_by_guard, horizon, strict=False)
            print(f"    {label}: avg_return={wr['avg_return']:+.2f}% "
                  f"win={wr['win_rate']}% (n={wr['count']})")
        # لو متوسط العوائد سلبي → السياج كان محق (رفض إشارات خسرانية)
        t3_wr = win_rate(rejected_by_guard, 't3', strict=False)
        if t3_wr['avg_return'] < 0:
            print(f"  ✅ السياج كان محق: الإشارات المرفوضة متوسط عائدها سلبي "
                  f"({t3_wr['avg_return']:+.2f}%) = تربية دجاج فعلية.")
        else:
            print(f"  ⚠️ السياج كان حذر زايد: الإشارات المرفوضة متوسط عائدها موجب "
                  f"({t3_wr['avg_return']:+.2f}%) — ممكن نرخّف الحد.")
    else:
        print("  مفيش إشارات رفضها السياج — كل الـ overrides كانت على أسهم بيتداول بشكل طبيعي.")

    # ── الحكم النهائي ──
    print("\n" + "=" * 78)
    print("  الحكم النهائي")
    print("=" * 78)
    t3_raw = win_rate(raw_signals, 't3', strict=False)
    t3_guarded = win_rate(guarded_signals, 't3', strict=False) if guarded_signals else t3_raw
    target = 60.0
    print(f"  هدف Win Rate (T+3, lenient): >= {target}%")
    print(f"  Override خام:      {t3_raw['win_rate']}% (avg {t3_raw['avg_return']:+.2f}%)")
    print(f"  Override + سياج:   {t3_guarded['win_rate']}% (avg {t3_guarded['avg_return']:+.2f}%)")
    if t3_guarded['win_rate'] >= 65:
        verdict = "🟢 ممتاز — التعديلات آمنة، نقدر نطلقها للعملاء"
    elif t3_guarded['win_rate'] >= target:
        verdict = "🟡 مقبول — فوق الـ 60% بس أقل من 65%، نراقبها بعد الإطلاق"
    else:
        verdict = "🔴 خطر — Win Rate تحت 60%، التعديلات بتفجر المحفظة — ارجع التخفيفات"
    print(f"  الحكم: {verdict}")

    _save_report(all_signals, {
        'raw_t3': t3_raw,
        'guarded_t3': t3_guarded,
        'verdict': verdict,
        'total_raw': len(raw_signals),
        'total_rejected': len(rejected_by_guard),
        'total_guarded': len(guarded_signals),
    })


def _save_report(signals: List[Signal], summary: Dict):
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    out = OUTPUT_DIR / f'comprehensive_backtest_{ts}.json'
    report = {
        'timestamp': datetime.now().isoformat(),
        'params': {
            'vol_ratio_min': VOL_RATIO_MIN,
            'change_today_min': CHANGE_TODAY_MIN,
            'pump_dump_vol_threshold': PUMP_DUMP_VOL_THRESHOLD,
            'lookback_days': LOOKBACK_DAYS,
            'win_strict_pct': WIN_STRICT_PCT,
        },
        'summary': summary,
        'signals': [asdict(s) for s in signals[:200]],  # أول 200 للتفحص
    }
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"\n[💾] التقرير الكامل محفوظ: {out}")


if __name__ == '__main__':
    main()
