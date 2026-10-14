#!/usr/bin/env python3
"""
multi_market_institutional_scan.py — محرك المسح المؤسسي متعدد الأسواق (V2 SSOT Canonical)
========================================================================================
يقوم بفحص كافة الأسواق (EGX, TADAWUL, KSE, QSE, US) بالربط المباشر مع:
  1. db/stocks.db (سجل الأسهم والأسعار الحالية والدعوم والمقاومات)
  2. db/price_history.db (تاريخ الشموع الموحد لأكثر من مليون شمعة)
  3. db/data_engine.db (شموع السوق الأمريكي والأصول العالمية)
  4. db/predictions.db (الوعاء المعتمد الوحيد لكتابة التوصيات المؤسسية)

الفلتر الكمي الحديدي (Hard Quant Kill Filter):
  - R:R ≥ 1.5 (المستهدف المؤسسي ≥ 2.0)
  - الثقة ≥ 65% (شراء ≥ 65%، شراء قوي ≥ 78%)
  - فوليوم مؤسسي حقيقي ≥ 1.3x
  - RSI < 70 (منع مطاردة القمم والتشبع الشرائي)
  - منع السكاكين الساقطة (Falling Knife Prevention)
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
PRICE_HISTORY_DB = PROJECT_ROOT / "db" / "price_history.db"
DATA_ENGINE_DB = PROJECT_ROOT / "db" / "data_engine.db"
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"

MIN_RR = 1.5
TARGET_RR = 2.0
MIN_CONFIDENCE = 65.0
MIN_VOLUME_RATIO = 1.3
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


def get_stock_candles(conn: sqlite3.Connection, ticker: str, market: str) -> List[Tuple]:
    """جلب شموع السهم التاريخية المدمجة من كافة قواعد البيانات المتاحة.

    Task B-17 fix (2026-10-14): بناء الاستعلام ديناميكيًا حسب الجداول
    المتاحة فعلًا. الساندبوكس قد لا يحتوي على price_history.db أو
    data_engine.db (فارغ)، فلا نُضمّن UNION لجداول غير موجودة وإلا
    نحصل على OperationalError. نكتشف الجداول المرفقة (ATTACHed) أولًا.
    """
    # اكتشف الجداول المتاحة فعلاً في الـ connection
    available_tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    # الجداول المرفقة تظهر بـ prefix.schema_name
    attached_dbs = {row[1] for row in conn.execute("PRAGMA database_list").fetchall()}
    has_ph = 'ph' in attached_dbs and bool(conn.execute(
        "SELECT name FROM ph.sqlite_master WHERE type='table' AND name='price_history'"
    ).fetchall()) if 'ph' in attached_dbs else False
    has_de = 'de' in attached_dbs and bool(conn.execute(
        "SELECT name FROM de.sqlite_master WHERE type='table' AND name='historical_data'"
    ).fetchall()) if 'de' in attached_dbs else False

    parts = []
    params: List[Any] = []
    # المصدر الأساسي دائمًا متاح: stock_daily_prices في stocks.db
    parts.append("""
        SELECT price_date as d,
               COALESCE(open, open_price) as open,
               COALESCE(high, high_price) as high,
               COALESCE(low, low_price) as low,
               COALESCE(close, close_price) as close,
               volume
        FROM stock_daily_prices
        WHERE ticker = ? AND COALESCE(close, close_price) > 0
    """)
    params.append(ticker)
    if has_ph:
        parts.append("""
            SELECT date as d, open_price as open, high_price as high, low_price as low, close_price as close, volume
            FROM ph.price_history
            WHERE ticker = ? AND close_price > 0
        """)
        params.append(ticker)
    if has_de:
        parts.append("""
            SELECT date as d, open, high, low, close, volume
            FROM de.historical_data
            WHERE symbol = ? AND close > 0
        """)
        params.append(ticker)

    union_query = " UNION ".join(parts)
    query = f"SELECT d, open, high, low, close, volume FROM ({union_query}) ORDER BY d DESC LIMIT 30"
    return conn.execute(query, params).fetchall()


def scan_market(conn: sqlite3.Connection, market: str) -> Tuple[List[Dict[str, Any]], int, int]:
    """افحص سوقًا واحدًا وأرجع الفرص المؤسسية المؤهلة."""
    if market == 'US':
        # السوق الأمريكي من data_engine.db — تحقق من توفره أولًا
        has_de = 'de' in {row[1] for row in conn.execute("PRAGMA database_list").fetchall()}
        if has_de:
            try:
                de_tables = [r[0] for r in conn.execute(
                    "SELECT name FROM de.sqlite_master WHERE type='table'"
                ).fetchall()]
            except Exception:
                de_tables = []
        else:
            de_tables = []
        if not has_de or 'historical_data' not in de_tables:
            log(f"  [{market}] data_engine.db غير متاح أو فارغ — تخطي السوق", "WARN")
            return [], 0, 0
        rows = conn.execute("""
            SELECT DISTINCT symbol as ticker, name, close as current_price,
                   'US' as market, 'US Equities' as sector,
                   NULL as ma_50, NULL as ma_200, NULL as support, NULL as resistance,
                   0 as change_percent, volume, NULL as rsi
            FROM de.historical_data
            WHERE market = 'US'
            GROUP BY symbol
            ORDER BY symbol
        """).fetchall()
    else:
        # الأسواق العربية من جدول stocks في stocks.db (فلترة حديدية لمنع أكواد الـ ISIN والأسهم المجهولة وسوق نمو)
        rows = conn.execute("""
            SELECT ticker, name, name_ar, current_price, ma_50, ma_200, support, resistance,
                   change_percent, volume, rsi, pe_ratio, sector, market
            FROM stocks
            WHERE is_active = 1 AND market = ?
              AND current_price IS NOT NULL AND current_price > 0
              AND ticker NOT LIKE 'EGS%' AND ticker NOT LIKE 'EGX%'
              AND length(ticker) <= 6
              AND (market != 'TADAWUL' OR (ticker NOT LIKE '95%' AND ticker NOT LIKE '96%'))
              AND (name_ar IS NOT NULL AND trim(name_ar) != '' AND name_ar != ticker)
            ORDER BY COALESCE(volume, 0) DESC, ticker
        """, (market,)).fetchall()

    opportunities = []
    skipped = 0

    for row in rows:
        d = dict(row)
        ticker = d['ticker']
        cp = _to_float(d.get('current_price'))
        if cp <= 0:
            skipped += 1
            continue

        candles = get_stock_candles(conn, ticker, market)
        if len(candles) < 10:
            skipped += 1
            continue

        closes = [float(c[4] or 0) for c in reversed(candles)]
        highs = [float(c[2] or 0) for c in reversed(candles)]
        lows = [float(c[3] or 0) for c in reversed(candles)]
        volumes = [float(c[5] or 0) for c in reversed(candles)]

        # 1. حساب ATR (14)
        tr_list = []
        for i in range(1, len(closes)):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i-1]),
                abs(lows[i] - closes[i-1])
            )
            tr_list.append(tr)
        atr_window = min(14, len(tr_list))
        atr = (sum(tr_list[-atr_window:]) / atr_window) if tr_list else (cp * 0.02)
        if atr <= 0:
            atr = cp * 0.02

        # 2. حساب RSI (14)
        if len(closes) >= 11:
            gains, losses = [], []
            for i in range(1, len(closes)):
                chg = closes[i] - closes[i-1]
                gains.append(max(0.0, chg))
                losses.append(max(0.0, -chg))
            window = min(14, len(gains))
            avg_gain = sum(gains[-window:]) / window
            avg_loss = sum(losses[-window:]) / window
            if avg_loss > 0:
                rs = avg_gain / avg_loss
                rsi = 100.0 - (100.0 / (1.0 + rs))
            else:
                rsi = 100.0 if avg_gain > 0 else 50.0
        else:
            rsi = _to_float(d.get('rsi'), 50.0)

        # 3. حساب معدل الفوليوم المؤسسي (Volume Ratio)
        valid_vols = [v for v in volumes if v > 100]
        if len(valid_vols) >= 5:
            avg_vol = sum(valid_vols) / len(valid_vols)
            last_vol = valid_vols[-1]
            vol_ratio = (last_vol / avg_vol) if avg_vol > 0 else 1.0
        else:
            vol_ratio = 1.0

        # 4. حساب الزخم (ROC 10d)
        if len(closes) >= 10 and closes[-10] > 0:
            roc_10d = ((closes[-1] - closes[-10]) / closes[-10]) * 100.0
        else:
            roc_10d = _to_float(d.get('change_percent'), 0.0)

        # 5. مستويات الدعم والمقاومة
        ma50 = _to_float(d.get('ma_50'))
        ma200 = _to_float(d.get('ma_200'))
        support = _to_float(d.get('support'))
        resistance = _to_float(d.get('resistance'))

        # ── Hard Quant Kill Filter ──
        reject_reasons = []

        # A. كشف السكين الساقطة (Falling Knife)
        if ma50 > 0 and cp < ma50 * 0.92 and ma200 > 0 and ma50 < ma200:
            reject_reasons.append("Falling Knife")
        if roc_10d < -12.0:
            reject_reasons.append("Severe negative momentum")

        # B. منع التشبع الشرائي (Overbought)
        if rsi > MAX_RSI:
            reject_reasons.append(f"RSI={rsi:.0f}>{MAX_RSI}")

        # C. حساب مستويات الدخول والوقف والهدف
        entry = cp

        # وقف الخسارة: معتمد على الدعم إن وُجد وكان واقعياً (يبعد عن السعر بما لا يقل عن 0.8 ATR)
        if support > 0 and (cp - (0.8 * atr)) > support >= (cp - (2.5 * atr)):
            stop = support
        else:
            stop = cp - (1.5 * atr)

        # الهدف: معتمد على المقاومة إن وُجدت وكانت توفر عائداً أعلى من 1.5 ATR
        if resistance > (cp + (1.2 * atr)) and resistance <= (cp + (4.0 * atr)):
            target = resistance
        else:
            target = cp + (2.5 * atr)

        # تأكيد أن ATR لا يقل عن 1% من السعر لمنع انهيار الحسابات
        if atr < (cp * 0.01):
            atr = cp * 0.01

        # D. التحقق الرياضي الصارم من الهندسة السعرية بعد التقريب (DEV-13 trigger compliance)
        rounded_entry = round(entry, 4)
        rounded_target = round(target, 4)
        rounded_stop = round(stop, 4)

        if rounded_entry <= 0 or rounded_stop <= 0 or rounded_target <= rounded_entry or rounded_stop >= rounded_entry:
            reject_reasons.append(f"Invalid price geometry (entry={rounded_entry}, stop={rounded_stop}, target={rounded_target})")

        # E. حساب نسبة المخاطرة للعائد (R:R)
        risk = rounded_entry - rounded_stop
        reward = rounded_target - rounded_entry
        rr = (reward / risk) if risk > 0 else 0.0

        if rr < MIN_RR:
            reject_reasons.append(f"RR={rr:.2f}<{MIN_RR}")

        # E. قياس الثقة المؤسسية (Confidence Score)
        confidence = 50.0
        if rr >= TARGET_RR:
            confidence += 15.0
        elif rr >= MIN_RR:
            confidence += 10.0

        if vol_ratio >= 1.8:
            confidence += 10.0
        elif vol_ratio >= MIN_VOLUME_RATIO:
            confidence += 5.0

        if roc_10d > 2.0:
            confidence += 10.0
        elif roc_10d >= 0.0:
            confidence += 5.0

        if rsi < 35.0:
            confidence += 10.0  # ارتداد من تشبع بيعي
        elif rsi < 55.0:
            confidence += 5.0

        if ma50 > 0 and cp > ma50:
            confidence += 5.0

        confidence = min(95.0, confidence)

        if confidence < MIN_CONFIDENCE:
            reject_reasons.append(f"Confidence={confidence:.0f}<{MIN_CONFIDENCE}")

        # رفض السهم إذا فشل في أي معيار
        if reject_reasons:
            skipped += 1
            continue

        # تحديد نوع الإشارة والمدى الزمني
        if confidence >= 78.0:
            signal = 'STRONG_BUY'
            signal_ar = 'شراء قوي'
        else:
            signal = 'BUY'
            signal_ar = 'شراء'

        horizon = '⚡ يومية/قصيرة' if rr >= TARGET_RR else '🎯 أسبوعية/متوسطة'

        # Task B-20b: حساب الدافع الفني (Catalyst) لكل صفقة
        # يربط شروط الدخول بـ RVOL + ارتداد من دعوم + اختراق مقاومات
        catalyst_en, catalyst_ar = _build_catalyst(
            cp=cp, support=support, resistance=resistance,
            vol_ratio=vol_ratio, rsi=rsi, roc_10d=roc_10d,
            ma50=ma50, ma200=ma200, atr=atr, rr=rr
        )

        opportunities.append({
            'ticker': ticker,
            'name': d.get('name') or ticker,
            'market': market,
            'sector': d.get('sector') or 'General',
            'entry_price': rounded_entry,
            'target_price': rounded_target,
            'stop_loss': rounded_stop,
            'rr': round(rr, 2),
            'confidence': round(confidence, 1),
            'rsi': round(rsi, 1),
            'roc_10d': round(roc_10d, 2),
            'vol_ratio': round(vol_ratio, 2),
            'atr': round(atr, 4),
            'horizon': horizon,
            'signal': signal,
            'signal_ar': signal_ar,
            'catalyst': catalyst_en,
            'catalyst_ar': catalyst_ar,
        })

    return opportunities, skipped, len(rows)


def _build_catalyst(cp: float, support: float, resistance: float,
                    vol_ratio: float, rsi: float, roc_10d: float,
                    ma50: float, ma200: float, atr: float, rr: float) -> tuple:
    """Task B-20b: بناء وصف الدافع الفني (Catalyst) لكل صفقة.

    يربط شروط الدخول بـ:
      - حجم تداول نسبي مضاعف (RVOL)
      - ارتداد من دعوم رئيسية
      - اختراق نطاق تجميعي / مقاومات
    يرجع tuple (catalyst_en, catalyst_ar).
    """
    parts_en = []
    parts_ar = []

    # RVOL
    if vol_ratio >= 2.5:
        parts_en.append(f"RVOL {vol_ratio:.1f}x (institutional surge)")
        parts_ar.append(f"فوليوم مؤسسي {vol_ratio:.1f}x")
    elif vol_ratio >= 1.8:
        parts_en.append(f"RVOL {vol_ratio:.1f}x")
        parts_ar.append(f"فوليوم {vol_ratio:.1f}x المتوسط")

    # ارتداد من دعم
    if support > 0 and cp >= support and (cp - support) / cp * 100 <= 5.0:
        parts_en.append(f"rebound from support {support:.2f}")
        parts_ar.append(f"ارتداد من دعم {support:.2f}")

    # اختراق مقاومة
    if resistance > 0 and cp > resistance:
        parts_en.append(f"breakout above resistance {resistance:.2f}")
        parts_ar.append(f"اختراق مقاومة {resistance:.2f}")

    # فوق MA50 (تأكيد الاتجاه)
    if ma50 > 0 and cp > ma50:
        parts_en.append("above MA50 (uptrend)")
        parts_ar.append("فوق MA50")

    # فوق MA200 (ترند صاعد طويل الأجل)
    if ma200 > 0 and cp > ma200:
        parts_en.append("above MA200 (long-term uptrend)")
        parts_ar.append("فوق MA200")

    # RSI
    if rsi < 35:
        parts_en.append(f"RSI={rsi:.0f} (oversold rebound)")
        parts_ar.append(f"RSI={rsi:.0f} تشبع بيعي")
    elif rsi < 55:
        parts_en.append(f"RSI={rsi:.0f}")
        parts_ar.append(f"RSI={rsi:.0f}")

    # ROC
    if roc_10d > 5.0:
        parts_en.append(f"ROC10d=+{roc_10d:.1f}% (momentum)")
        parts_ar.append(f"زخم +{roc_10d:.1f}%")

    # fallback لو مفيش عناصر
    if not parts_en:
        parts_en.append(f"R:R={rr:.2f} with ATR-based entry")
        parts_ar.append(f"R:R={rr:.2f} مع دخول مبني على ATR")

    catalyst_en = " | ".join(parts_en[:4])  # أول 4 عناصر عشان الاختصار
    catalyst_ar = " | ".join(parts_ar[:4])
    return catalyst_en, catalyst_ar


def write_predictions_canonical(opportunities: List[Dict[str, Any]]) -> int:
    """كتابة الفرص المعتمدة في جدول predictions (SSOT).

    استراتيجية اختيار الـ DB (Task B-21 audit):
      1. جرّب predictions.db أولًا (لو موجود + فيه جدول predictions)
      2. لو مش موجود/فاضي → fallback لـ stocks.db (الساندبوكس)
      3. الحقول الإضافية (rr, confidence, market, horizon, catalyst) تُخزَّن
         في عمود notes كـ JSON لأن schema predictions لا يحتوي على أعمدة منفصلة لها.

    Task B-20b: أضفنا حقل catalyst + catalyst_ar للـ notes JSON.
    """
    import json as _json

    if not STOCKS_DB.exists():
        log(f"stocks.db غير موجود: {STOCKS_DB}", "ERROR")
        return 0

    target_db = PREDICTIONS_DB if PREDICTIONS_DB.exists() else STOCKS_DB
    try:
        test_conn = sqlite3.connect(str(target_db))
        has_pred = bool(test_conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='predictions'").fetchall())
        test_conn.close()
        if not has_pred and target_db == PREDICTIONS_DB and STOCKS_DB.exists():
            target_db = STOCKS_DB
    except Exception:
        target_db = STOCKS_DB

    conn_pred = sqlite3.connect(str(target_db))
    written = 0
    now_date = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    now_iso = datetime.now(timezone.utc).isoformat()

    # تحقق من أعمدة predictions في قاعدة البيانات الهدف
    cols = [r[1] for r in conn_pred.execute("PRAGMA table_info(predictions)").fetchall()]
    has_highest = 'highest_price_reached' in cols
    has_lowest = 'lowest_price_reached' in cols

    for opp in opportunities:
        try:
            # حذف أي إشارة سابقة بنفس الـ ticker واليوم ونوع institutional_scan
            # لمنع التكرار عند إعادة التشغيل (idempotent)
            conn_pred.execute("""
                DELETE FROM predictions
                WHERE ticker = ? AND prediction_date = ? AND signal_type = 'institutional_scan'
            """, (opp['ticker'], now_date))

            # بناء عمود notes يحوي كل المعلومات الكمية الإضافية كـ JSON
            notes_payload = _json.dumps({
                'rr': opp['rr'],
                'confidence': opp['confidence'],
                'market': opp['market'],
                'horizon': opp['horizon'],
                'signal_ar': opp.get('signal_ar', ''),
                'catalyst': opp.get('catalyst', ''),
                'catalyst_ar': opp.get('catalyst_ar', ''),
                'rsi': opp['rsi'],
                'vol_ratio': opp['vol_ratio'],
                'roc_10d': opp.get('roc_10d', 0),
                'atr': opp.get('atr', 0),
                'source': 'institutional_quant_scan_v2',
            }, ensure_ascii=False)

            # إدراج بأعمدة stocks.db.predictions الفعلية
            if has_highest and has_lowest:
                conn_pred.execute("""
                    INSERT INTO predictions (
                        ticker, signal, signal_type, prediction_date,
                        entry_price, target_price, stop_loss,
                        master_score, technical_score, fundamental_score,
                        notes, created_at,
                        highest_price_reached, lowest_price_reached
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                """, (
                    opp['ticker'],
                    opp['signal'],
                    'institutional_scan',
                    now_date,
                    opp['entry_price'],
                    opp['target_price'],
                    opp['stop_loss'],
                    opp['confidence'],
                    opp['confidence'],
                    0.0,
                    notes_payload,
                    now_iso,
                ))
            else:
                conn_pred.execute("""
                    INSERT INTO predictions (
                        ticker, signal, signal_type, prediction_date,
                        entry_price, target_price, stop_loss,
                        master_score, technical_score, fundamental_score,
                        notes, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    opp['ticker'],
                    opp['signal'],
                    'institutional_scan',
                    now_date,
                    opp['entry_price'],
                    opp['target_price'],
                    opp['stop_loss'],
                    opp['confidence'],
                    opp['confidence'],
                    0.0,
                    notes_payload,
                    now_iso,
                ))
            written += 1
        except Exception as e:
            log(f"INSERT failed for {opp['ticker']}: {e}", "WARN")

    conn_pred.commit()
    conn_pred.close()
    return written


def main() -> int:
    global MIN_RR, MIN_CONFIDENCE, TARGET_RR
    parser = argparse.ArgumentParser(description="محرك المسح المؤسسي متعدد الأسواق — النسخة المعتمدة")
    parser.add_argument("--execute", action="store_true", help="كتابة التوصيات في stocks.db.predictions (SSOT)")
    parser.add_argument("--market", type=str, default=None, help="فحص سوق محدد (EGX, TADAWUL, KSE, QSE, US)")
    parser.add_argument("--strict", action="store_true",
                        help="الفلتر المؤسسي الصارم: R:R ≥ 2.0 + الثقة ≥ 78% (STRONG_BUY فقط)")
    parser.add_argument("--min-rr", type=float, default=None, help="تجاوز الحد الأدنى لـ R:R (default 1.5)")
    parser.add_argument("--min-confidence", type=float, default=None, help="تجاوز الحد الأدنى للثقة (default 65)")
    parser.add_argument("--top", type=int, default=0,
                        help="اقتصر على أعلى N فرصة فقط بعد الترتيب بالثقة ثم R:R (0 = الكل)")
    parser.add_argument("--strong-only", action="store_true",
                        help="اكتب STRONG_BUY فقط (confidence ≥ 78%) في الـ DB")
    args = parser.parse_args()

    # تطبيق الفلاتر الصارمة
    if args.strict:
        MIN_RR = 2.0
        MIN_CONFIDENCE = 78.0
        TARGET_RR = 2.0
    if args.min_rr is not None:
        MIN_RR = args.min_rr
    if args.min_confidence is not None:
        MIN_CONFIDENCE = args.min_confidence

    log("=" * 75)
    log("🌍 محرك المسح المؤسسي متعدد الأسواق — Multi-Market Institutional Quant Engine")
    log("=" * 75)
    log(f"Mode: {'⚡ EXECUTE (Write to stocks.db.predictions)' if args.execute else '🔍 DRY-RUN (Audit Report Only)'}")
    log(f"Filters: R:R ≥ {MIN_RR} | Confidence ≥ {MIN_CONFIDENCE}% | Volume ≥ {MIN_VOLUME_RATIO}x | RSI < {MAX_RSI}")
    if args.strict:
        log("🔒 STRICT MODE مفعّل — STRONG_BUY فقط (R:R ≥ 2.0 + ثقة ≥ 78%)")
    if args.top:
        log(f"🔝 TOP filter: سيتم اقتضاء أعلى {args.top} فرصة فقط")
    log("")

    if not STOCKS_DB.exists():
        log(f"stocks.db غير موجود: {STOCKS_DB}", "ERROR")
        return 1

    conn = sqlite3.connect(str(STOCKS_DB))
    conn.row_factory = sqlite3.Row

    # ربط قواعد البيانات التاريخية
    if PRICE_HISTORY_DB.exists():
        conn.execute(f"ATTACH DATABASE '{PRICE_HISTORY_DB}' AS ph")
    if DATA_ENGINE_DB.exists():
        conn.execute(f"ATTACH DATABASE '{DATA_ENGINE_DB}' AS de")

    markets = [args.market] if args.market else ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US']
    all_opportunities = []
    market_stats = {}

    for market in markets:
        log(f"📍 جاري مسح سوق {market}...")
        opportunities, skipped, total = scan_market(conn, market)
        all_opportunities.extend(opportunities)
        market_stats[market] = {
            'scanned': total,
            'accepted': len(opportunities),
            'rejected': skipped
        }
        log(f"  [{market}] تم فحص {total} سهم | قُبلت {len(opportunities)} فرصة | رُفضت {skipped}")

        for opp in opportunities[:4]:
            log(f"  ▸ {opp['ticker']:<8} | دخول: {opp['entry_price']:<9.2f} | هدف: {opp['target_price']:<9.2f} | "
                f"وقف: {opp['stop_loss']:<9.2f} | R:R: {opp['rr']:<4.2f} | ثقة: {opp['confidence']:.0f}% | "
                f"RSI: {opp['rsi']:<3.0f} | {opp['signal']}")
        if len(opportunities) > 4:
            log(f"  ... و {len(opportunities) - 4} فرصة أخرى معتمدة")
        log("")

    conn.close()

    # فلترة STRONG_BUY فقط لو طُلب
    if args.strong_only:
        all_opportunities = [o for o in all_opportunities if o['signal'] == 'STRONG_BUY']
        log(f"🔒 فلتر STRONG_BUY فقط: تبقى {len(all_opportunities)} فرصة")

    # اقتضاء أعلى N فرصة بعد الترتيب بالثقة ثم R:R
    if args.top and args.top > 0 and len(all_opportunities) > args.top:
        all_opportunities.sort(key=lambda o: (o['confidence'], o['rr']), reverse=True)
        all_opportunities = all_opportunities[:args.top]
        log(f"🔝 TOP {args.top}: تم اقتضاء أفضل {len(all_opportunities)} فرصة بالثقة ثم R:R")

    # كتابة الفرص في قاعدة بيانات predictions المعتمدة (stocks.db)
    written_count = 0
    if args.execute and all_opportunities:
        log("📝 جاري كتابة الفرص في db/stocks.db.predictions (SSOT)...")
        written_count = write_predictions_canonical(all_opportunities)
        log(f"تمت كتابة {written_count} فرصة بنجاح في جدول predictions المعتمد!", "OK")
    elif not args.execute:
        log("ℹ️ تشغيل تجريبي (Dry-run). لتثبيت التوصيات في قاعدة البيانات، شغّل الأمر مع: --execute")

    # التقرير الختامي
    log("=" * 75)
    log("📊 التقرير النهائي للمسح المؤسسي:")
    for m, st in market_stats.items():
        acc = st['accepted']
        tot = st['scanned']
        rate = (acc / tot * 100) if tot > 0 else 0
        log(f"  - {m:<8}: فُحص {tot:<4} | قُبل {acc:<3} ({rate:.1f}%) | رُفض {st['rejected']}")

    total_scanned = sum(s['scanned'] for s in market_stats.values())
    total_accepted = len(all_opportunities)
    avg_rr = (sum(o['rr'] for o in all_opportunities) / total_accepted) if total_accepted > 0 else 0.0
    avg_conf = (sum(o['confidence'] for o in all_opportunities) / total_accepted) if total_accepted > 0 else 0.0

    log("-" * 75)
    log(f"  إجمالي الأسهم الممسوحة: {total_scanned}")
    log(f"  إجمالي الفرص المعتمدة: {total_accepted}")
    log(f"  متوسط نسبة العائد للمخاطرة (R:R): {avg_rr:.2f}")
    log(f"  متوسط الثقة المؤسسية: {avg_conf:.1f}%")
    log("=" * 75)

    return 0


if __name__ == "__main__":
    sys.exit(main())
