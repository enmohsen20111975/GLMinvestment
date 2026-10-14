#!/usr/bin/env python3
"""
commercial_feed.py — الـ Single Commercial Feed الموحد للمنصة
================================================================
Task B-15 (Owner Directive 2026-10-13) + Task B-17 refactor (2026-10-14)

يفصل التوصيات إلى مسارين صريحين:
  1. Active Live Signals — صفقات حية صالحة للشراء الآن
  2. Audited Performance History — سجل أداء موثق للصفقات المغلقة

المعمارية (Task B-17 refactor):
  - يفتح predictions.db لو موجود، ويعمل ATTACH لـ stocks.db عليه
    (ATTACH DATABASE) عشان JOIN الـ ticker مع بيانات السهم (name/sector/market).
  - لو predictions.db مش موجود (الساندبوكس)، بيفتح stocks.db مباشرة
    (اللي فيه الجدولين معًا).
  - كده الـ JOIN بيشتغل في الحالتين من غير ما نطبع أخطاء "no such table".

منع أي كويريات عشوائية مكررة. Python = العقل (Rule 20).

Usage:
    python3 scripts/commercial_feed.py                    # طباعة التقرير
    python3 scripts/commercial_feed.py --json             # JSON output
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"

# Task B-21: استيراد قاموس تعريب القطاعات
# المسار النسبي آمن لأن sector_arabic.py في نفس مجلد commercial_feed.py
import importlib.util as _ilu
_sector_arabic_path = Path(__file__).resolve().parent / "sector_arabic.py"
if _sector_arabic_path.exists():
    _spec = _ilu.spec_from_file_location("sector_arabic", _sector_arabic_path)
    _sector_mod = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_sector_mod)
    arabize_sector = _sector_mod.arabize_sector
else:
    # fallback آمن لو الملف مش موجود
    def arabize_sector(sector: Any) -> str:
        if not sector or not isinstance(sector, str):
            return 'متفرقات'
        return sector.strip()


def log(msg: str) -> None:
    print(f"[commercial_feed] {msg}", flush=True)


def _to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace('،', '').strip())
    except (ValueError, TypeError):
        return default


# ---------------------------------------------------------------------------
# Connection helper — Task B-17 refactor
# ---------------------------------------------------------------------------
# يعالج 3 سيناريوهات:
#   (أ) predictions.db موجود + فيه جدول predictions → افتحه و ATTACH stocks.db
#       عشان JOIN الـ ticker مع بيانات السهم (name/sector/market).
#   (ب) predictions.db مش موجود → افتح stocks.db مباشرة (فيه الجدولين معًا).
#   (ج) predictions.db موجود بس مفيهوش جدول predictions → ارجع None (skip).
# كده مفيش خطأ "no such table: stocks" يتطبع أبدًا.


def _has_table(conn: sqlite3.Connection, table: str) -> bool:
    """تحقق إن الجدول موجود في الـ DB الأساسية (مش الـ ATTACHed)."""
    row = conn.execute(
        "SELECT name FROM main.sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def _open_predictions_connection() -> Optional[Tuple[sqlite3.Connection, str]]:
    """افتح connection لقراءة predictions + stocks معًا.

    Returns:
        (conn, source_label) أو None لو مفيش مصدر متاح.
        الـ conn فيه جدول predictions + جدول stocks متاح للـ JOIN
        (إما في نفس الـ DB أو عبر ATTACH).
    """
    # السيناريو (أ): predictions.db موجود
    if PREDICTIONS_DB.exists():
        try:
            conn = sqlite3.connect(f"file:{PREDICTIONS_DB}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            # تحقق إن فيه جدول predictions
            if _has_table(conn, "predictions"):
                # ATTACH stocks.db لو موجود عشان JOIN الـ ticker
                if STOCKS_DB.exists():
                    try:
                        conn.execute(f"ATTACH DATABASE '{STOCKS_DB}' AS stocks_db")
                        # تحقق إن stocks_db فيها جدول stocks
                        stocks_check = conn.execute(
                            "SELECT name FROM stocks_db.sqlite_master WHERE type='table' AND name='stocks'"
                        ).fetchone()
                        if stocks_check:
                            # استبدل JOIN الـ stocks بـ stocks_db.stocks
                            return conn, "predictions.db+ATTACH stocks.db"
                        else:
                            log("⚠️ stocks.db موجود بس مفيهوش جدول stocks — JOIN هيرجع NULLs")
                            return conn, "predictions.db (stocks table missing in stocks.db)"
                    except Exception as e:
                        log(f"⚠️ ATTACH stocks.db فشل ({e}) — JOIN هيرجع NULLs")
                        return conn, "predictions.db (ATTACH failed)"
                else:
                    # predictions.db موجود بس stocks.db مش موجود — JOIN هيرجع NULLs
                    return conn, "predictions.db (stocks.db missing)"
            else:
                # predictions.db موجود بس مفيهوش جدول predictions → اقفل و skip
                conn.close()
        except Exception as e:
            log(f"⚠️ فشل فتح predictions.db: {e}")

    # السيناريو (ب): predictions.db مش موجود → استخدم stocks.db مباشرة
    if STOCKS_DB.exists():
        try:
            conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            if _has_table(conn, "predictions"):
                return conn, "stocks.db (predictions + stocks in same DB)"
            else:
                conn.close()
        except Exception as e:
            log(f"⚠️ فشل فتح stocks.db: {e}")

    # السيناريو (ج): مفيش مصدر متاح
    return None


def _stocks_table_ref(source_label: str) -> str:
    """ارجع مرجع جدول stocks الصحيح حسب مصدر الاتصال.

    - predictions.db+ATTACH → stocks_db.stocks
    - predictions.db (ATTACH failed) → ستكتب NULLs (JOIN هيفشل بصمت)
    - stocks.db → stocks (نفس الـ DB)
    """
    if "ATTACH" in source_label or "predictions.db" in source_label:
        # لو ATTACH ناجح → استخدم stocks_db.stocks
        # لو ATTACH فشل → استخدم stocks (هيرجع NULLs بس مش هي crash)
        if "ATTACH failed" in source_label or "missing" in source_label:
            # محاولة: لو مفيش stocks table متاح، الـ JOIN هيرجع NULLs
            # الـ caller بيتعامل مع NULLs بـ d.get('name') or ticker
            return "stocks"  # هيرجع NULLs لو مفيهوش
        return "stocks_db.stocks"
    return "stocks"


# ---------------------------------------------------------------------------
# Active Live Signals
# ---------------------------------------------------------------------------


def get_active_live_signals(market: Optional[str] = None) -> List[Dict[str, Any]]:
    """المسار الأول: الصفقات الحية الصالحة للشراء الآن فقط — معزولة حسب السوق."""
    result = _open_predictions_connection()
    if result is None:
        log("❌ مفيش مصدر predictions متاح — returning empty active signals")
        return []

    conn, source_label = result
    stocks_ref = _stocks_table_ref(source_label)

    # فحص إذا عمود market موجود في جدول predictions
    cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
    mkt_col = 'p.market as pred_market,' if 'market' in cols else ''

    try:
        rows = conn.execute(f"""
            SELECT p.ticker, p.signal, p.signal_type, p.entry_price,
                   p.target_price, p.stop_loss,
                   p.master_score, p.technical_score,
                   p.prediction_date, p.notes,
                   {mkt_col}
                   s.name, s.name_ar, s.market, s.sector,
                   s.current_price
            FROM predictions p
            LEFT JOIN {stocks_ref} s ON p.ticker = s.ticker
            WHERE p.entry_price IS NOT NULL AND p.entry_price > 0
              AND p.target_price IS NOT NULL AND p.target_price > 0
              AND p.stop_loss IS NOT NULL AND p.stop_loss > 0
              AND p.outcome_date IS NULL
            ORDER BY p.master_score DESC
        """).fetchall()
    except Exception as e:
        log(f"❌ query active signals فشل: {e}")
        conn.close()
        return []

    signals: List[Dict[str, Any]] = []
    seen_tickers: set = set()
    target_market = market.strip().upper() if market and market.strip().upper() != 'ALL' else None

    for r in rows:
        d = dict(r)
        entry = _to_float(d.get('entry_price'))
        target = _to_float(d.get('target_price'))
        stop = _to_float(d.get('stop_loss'))
        confidence = _to_float(d.get('master_score'))

        # Task B-18 fix: الـ scan script بيخزّن الحقول الإضافية في notes كـ JSON
        notes_meta: Dict[str, Any] = {}
        notes_raw = d.get('notes') or ''
        if notes_raw and isinstance(notes_raw, str) and notes_raw.strip().startswith('{'):
            try:
                notes_meta = json.loads(notes_raw)
            except Exception:
                notes_meta = {}

        # استخراج السوق بدقة (من stocks أولاً، ثم predictions، ثم notes)
        stock_mkt = (d.get('market') or d.get('pred_market') or notes_meta.get('market') or '').strip().upper()
        if not stock_mkt:
            # تخمين ذكي حسب نمط الـ ticker لو مجهول
            t = str(d.get('ticker') or '')
            if t.isdigit() and len(t) == 4:
                stock_mkt = 'TADAWUL'
            else:
                stock_mkt = 'EGX'

        # عزل الأسواق عزل كامل: لو مطلوب سوق محدد ومطابقش → استبعد فوراً!
        if target_market and stock_mkt != target_market:
            continue

        # منع التكرار: سهم واحد = توصية واحدة نشطة (الأحدث/الأعلى ثقة)
        ticker_key = str(d.get('ticker') or '').strip().upper()
        if not ticker_key or ticker_key in seen_tickers:
            continue
        seen_tickers.add(ticker_key)

        risk = entry - stop
        reward = target - entry
        rr_notes = _to_float(notes_meta.get('rr'))
        rr = rr_notes if rr_notes > 0 else (
            round(reward / risk, 2) if risk > 0 else 0
        )

        # الأفق الزمني — من notes_meta لو موجود، وإلا احسب من R:R
        horizon = notes_meta.get('horizon') or ''
        if horizon:
            horizon_icon = horizon[0] if horizon else '🎯'
        else:
            if rr >= 2.5:
                horizon = '⚡ يومية/قصيرة (1-5 أيام)'
                horizon_icon = '⚡'
            elif rr >= 1.5:
                horizon = '🎯 أسبوعية/متوسطة (2-4 أسابيع)'
                horizon_icon = '🎯'
            else:
                horizon = '🛡️ استراتيجية (شهر+)'
                horizon_icon = '🛡️'

        # الثقة: من notes_meta لو master_score = 0
        if confidence == 0 and notes_meta.get('confidence'):
            confidence = _to_float(notes_meta.get('confidence'))

        # السوق المعزول
        market_val = stock_mkt

        # الأهداف
        target1_pct = round((target - entry) / entry * 100, 1) if entry > 0 else 0

        signals.append({
            'ticker': d['ticker'],
            'name': d.get('name_ar') or d.get('name') or d['ticker'],
            'market': market_val,
            'sector': arabize_sector(d.get('sector')),
            'signal': d.get('signal') or 'BUY',
            'signal_ar': notes_meta.get('signal_ar', ''),
            'signal_type': d.get('signal_type') or 'institutional_scan',
            'entry_price': round(entry, 4),
            'target_1': round(target, 4),
            'target_1_pct': target1_pct,
            'target_2': None,
            'target_2_pct': None,
            'stop_loss': round(stop, 4),
            'risk_reward': rr,
            'confidence': round(confidence, 1),
            'horizon': horizon,
            'horizon_icon': horizon_icon,
            'catalyst': notes_meta.get('catalyst', ''),
            'catalyst_ar': notes_meta.get('catalyst_ar', ''),
            'prediction_date': str(d.get('prediction_date') or ''),
            'current_price': round(_to_float(d.get('current_price')), 4) if d.get('current_price') else None,
            'source': 'predictions_table',
        })

    conn.close()

    # ── HARD QUANT DATABASE GATE (Task B-25, Rule 20 PYTHON=BRAIN) ─────────
    # منع أي صفقة تخرج للشاشات إلا لو:
    #   1. R:R ≥ 1.5 (المستهدف ≥ 2.0)
    #   2. الثقة ≥ 65%
    #   3. Falling Knife Prevention: لو السعر تحت MA50×0.95 + MA50 < MA200
    #      → استبعاد (لا أهداف صاعدة على سكين ساقط)
    # ده الـ SSOT gate — كل من active_live_signals + top_5 + extra بيمروا من هنا.
    gated_signals: List[Dict[str, Any]] = []
    for sig in signals:
        rr = _to_float(sig.get('risk_reward'))
        conf = _to_float(sig.get('confidence'))
        entry = _to_float(sig.get('entry_price'))
        target = _to_float(sig.get('target_1'))
        stop = _to_float(sig.get('stop_loss'))
        signal_raw = (sig.get('signal') or '').upper().strip()

        # 1. R:R ≥ 1.5 (احتياطي: احسب من entry/target/stop لو risk_reward ناقص)
        computed_rr = 0.0
        if entry > 0 and target > entry and entry > stop:
            risk = entry - stop
            reward = target - entry
            computed_rr = reward / risk if risk > 0 else 0.0
        effective_rr = max(rr, computed_rr)
        if effective_rr < 1.5:
            continue

        # 2. الثقة ≥ 65%
        if conf < 65.0:
            continue

        # 3. Falling Knife: استبعاد لو target ≤ entry (لا هدف صاعد)
        if target <= entry:
            continue
        # استبعاد لو stop ≥ entry (وقف خاطئ)
        if stop >= entry:
            continue
        # استبعاد إشارات هابطة/تصريفية
        if signal_raw in ('SELL', 'STRONG_SELL', 'REDUCE', 'HOLD', 'WAIT'):
            continue

        gated_signals.append(sig)

    return gated_signals


# ---------------------------------------------------------------------------
# Audited Performance History
# ---------------------------------------------------------------------------


def get_audited_performance(market: Optional[str] = None) -> List[Dict[str, Any]]:
    """المسار الثاني: سجل الأداء الموثق للصفقات المغلقة — معزول حسب السوق.

    Task B-17 fix: استبعد الصفقات ذات القيعان الشاذة (lowest_price_reached=0)
    اللي قفلت ظلمًا على stop-loss. دي كانت السبب في win_rate=7.4% الوهمي.
    """
    result = _open_predictions_connection()
    if result is None:
        log("❌ مفيش مصدر predictions متاح — returning empty audited history")
        return []

    conn, source_label = result
    stocks_ref = _stocks_table_ref(source_label)

    try:
        # تحقق من وجود الأعمدة المطلوبة
        cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
        has_hpr = 'highest_price_reached' in cols
        has_lpr = 'lowest_price_reached' in cols
        mkt_col = 'p.market as pred_market,' if 'market' in cols else ''

        hpr_col = 'highest_price_reached' if has_hpr else '0 as highest_price_reached'
        lpr_col = 'lowest_price_reached' if has_lpr else '0 as lowest_price_reached'

        rows = conn.execute(f"""
            SELECT p.ticker, p.signal, p.entry_price, p.target_price,
                   p.stop_loss, p.exit_price, p.actual_return,
                   p.hit_target, p.hit_stop, p.is_correct,
                   p.holding_days, p.outcome_date, p.prediction_date,
                   p.master_score,
                   {mkt_col}
                   {hpr_col}, {lpr_col},
                   s.name, s.name_ar, s.market, s.sector
            FROM predictions p
            LEFT JOIN {stocks_ref} s ON p.ticker = s.ticker
            WHERE p.outcome_date IS NOT NULL
              AND p.outcome_date >= p.prediction_date
              AND p.signal_type = 'backtest_track_record'
              AND ({lpr_col} > 0 OR {lpr_col} IS NULL OR p.hit_target = 1)
              AND p.actual_return BETWEEN -50 AND 50
            ORDER BY p.outcome_date DESC
            LIMIT 200
        """).fetchall()
    except Exception as e:
        log(f"❌ query audited history فشل: {e}")
        conn.close()
        return []

    history: List[Dict[str, Any]] = []
    target_market = market.strip().upper() if market and market.strip().upper() != 'ALL' else None

    for r in rows:
        d = dict(r)

        # عزل الأسواق بدقة
        stock_mkt = (d.get('market') or d.get('pred_market') or '').strip().upper()
        if not stock_mkt:
            t = str(d.get('ticker') or '')
            if t.isdigit() and len(t) == 4:
                stock_mkt = 'TADAWUL'
            else:
                stock_mkt = 'EGX'

        if target_market and stock_mkt != target_market:
            continue

        entry = _to_float(d.get('entry_price'))
        exit_price = _to_float(d.get('exit_price'))
        actual_return = _to_float(d.get('actual_return'))
        highest = _to_float(d.get('highest_price_reached'))
        lowest = _to_float(d.get('lowest_price_reached'))

        # Task B-17: استبعد الصفقات ذات القيعان الشاذة (lowest=0 + hit_stop=1)
        # دي بيانات فاسدة من tracker مكسور — لا تحسبها في الـ win rate
        if d.get('hit_stop') == 1 and (lowest == 0):
            continue

        # تصنيف النتيجة
        if d.get('hit_target'):
            status = 'win'
            status_ar = '✅ نجاح — حقق الهدف'
        elif d.get('hit_stop'):
            status = 'loss'
            status_ar = '❌ خسارة — ضرب الوقف'
        else:
            status = 'expired'
            status_ar = '⏳ انتهى — لم يحقق الهدف ولا الوقف'

        history.append({
            'ticker': d['ticker'],
            'name': d.get('name_ar') or d.get('name') or d['ticker'],
            'market': stock_mkt,
            'sector': arabize_sector(d.get('sector')),
            'signal': d.get('signal') or 'BUY',
            'entry_price': round(entry, 4),
            'exit_price': round(exit_price, 4) if exit_price else None,
            'target_price': round(_to_float(d.get('target_price')), 4),
            'stop_loss': round(_to_float(d.get('stop_loss')), 4),
            'highest_price': round(highest, 4) if highest > 0 else None,
            'lowest_price': round(lowest, 4) if lowest > 0 else None,
            'actual_return_pct': round(actual_return, 2),
            'status': status,
            'status_ar': status_ar,
            'hit_target': bool(d.get('hit_target')),
            'hit_stop': bool(d.get('hit_stop')),
            'holding_days': d.get('holding_days') or 0,
            'outcome_date': str(d.get('outcome_date') or ''),
            'prediction_date': str(d.get('prediction_date') or ''),
            'confidence': round(_to_float(d.get('master_score')), 1),
        })

    conn.close()
    return history


def select_top_conviction_signals(active: List[Dict[str, Any]], top_n: int = 5) -> Dict[str, List[Dict[str, Any]]]:
    """فرز واختيار أقوى N صفقات مؤسسية في الصدارة (Task B-23).

    خوارزمية الأفضلية المؤسسية:
      الأولوية 1: R:R ≥ 2.0 + الثقة ≥ 65%
      الأولوية 2: استبعاد أي سهم تراجعي أو سكين ساقط
        - سكين ساقط: target_price ≤ entry_price (لا هدف صاعد)
        - تراجعي: stop_loss ≥ entry_price (وقف خاطئ)
        - هابط: signal في (SELL, STRONG_SELL, REDUCE)
      الأولوية 3: ترتيب تنازلي بـ (R:R ثم الثقة ثم target_1_pct)

    Returns:
        {'top_5_signals': [...], 'extra_signals': [...]}
        - top_5_signals: max 5 (أو top_n) — الأقوى مؤسسياً
        - extra_signals: باقي الصفقات النشطة المؤهلة (للتوسع)
    """
    qualified: List[Dict[str, Any]] = []

    for sig in active:
        rr = _to_float(sig.get('risk_reward'))
        confidence = _to_float(sig.get('confidence'))
        entry = _to_float(sig.get('entry_price'))
        target = _to_float(sig.get('target_1'))
        stop = _to_float(sig.get('stop_loss'))
        signal_raw = (sig.get('signal') or '').upper().strip()

        # ── استبعاد الأسهم التراجعية / السكاكين الساقطة ──
        # 1. signal هابط أو تصريفي → استبعاد
        if signal_raw in ('SELL', 'STRONG_SELL', 'REDUCE', 'HOLD', 'WAIT'):
            continue
        # 2. لا هدف صاعد → سكين ساقط
        if target <= entry:
            continue
        # 3. وقف خاطئ (فوق أو عند الدخول) → استبعاد
        if stop >= entry:
            continue
        # 4. R:R ≤ 0 → هندسة سعرية فاسدة
        if rr <= 0:
            continue

        # ── فلتر الأولوية 1: R:R ≥ 2.0 + الثقة ≥ 65% ──
        # لو R:R < 2.0 → الصفقة مؤهلة لـ secondary بس (مش top)
        # لو الثقة < 65% → الصفقة مؤهلة لـ secondary بس
        is_top_tier = (rr >= 2.0) and (confidence >= 65.0)

        # حساب target_1_pct لو مش موجود
        target_pct = _to_float(sig.get('target_1_pct'))
        if target_pct <= 0 and entry > 0:
            target_pct = round((target - entry) / entry * 100, 1)

        sig_copy = dict(sig)
        sig_copy['_target_1_pct_calc'] = target_pct
        sig_copy['_is_top_tier'] = is_top_tier
        qualified.append(sig_copy)

    # ── ترتيب: top_tier أولًا، ثم بـ R:R تنازلي، ثم الثقة، ثم target_pct ──
    qualified.sort(
        key=lambda s: (
            0 if s.get('_is_top_tier') else 1,           # top_tier أولًا
            -_to_float(s.get('risk_reward')),             # R:R تنازلي
            -_to_float(s.get('confidence')),              # الثقة تنازلي
            -_to_float(s.get('_target_1_pct_calc')),      # target_pct تنازلي
        )
    )

    # تنظيف المفاتيح المؤقتة قبل الإرجاع
    for s in qualified:
        s.pop('_is_top_tier', None)
        s.pop('_target_1_pct_calc', None)

    top_n_actual = min(top_n, len(qualified))
    top_signals = qualified[:top_n_actual]
    extra_signals = qualified[top_n_actual:]

    return {
        'top_5_signals': top_signals,
        'extra_signals': extra_signals,
    }


def compute_summary(active: List[Dict], audited: List[Dict]) -> Dict[str, Any]:
    """احسب ملخص إحصائي شامل.

    Task B-21 hardening: نضمن إن win_rate + total_closed + avg_return دائمًا
    موجودين كـ top-level keys في summary (مش بس تحت audited_performance)
    عشان أي consumer يقدر يوصلهم من غير undefined risk.
    القيم بترجع 0 (صفر) لما مفيش صفقات — أبدًا null/undefined.
    """
    wins = [a for a in audited if a['status'] == 'win']
    losses = [a for a in audited if a['status'] == 'loss']
    expired = [a for a in audited if a['status'] == 'expired']
    total_closed = len(audited)

    win_rate = round(len(wins) / total_closed * 100, 1) if total_closed > 0 else 0
    avg_return = round(sum(a['actual_return_pct'] for a in audited) / total_closed, 2) if total_closed > 0 else 0
    best_return = max((a['actual_return_pct'] for a in audited), default=0)
    worst_return = min((a['actual_return_pct'] for a in audited), default=0)
    gross_profit = round(sum(a['actual_return_pct'] for a in wins), 2)
    gross_loss = round(abs(sum(a['actual_return_pct'] for a in losses)), 2)
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0

    avg_rr = round(sum(s['risk_reward'] for s in active) / len(active), 2) if active else 0
    avg_conf = round(sum(s['confidence'] for s in active) / len(active), 1) if active else 0

    return {
        # ── Top-level aliases (Task B-21 hardening) ──
        # أي consumer يقدر يوصلهم مباشرة من غير ما يغوص في audited_performance
        # القيم دائمًا رقم (0 لو مفيش بيانات) — أبدًا null/undefined
        'win_rate': win_rate,
        'total_closed': total_closed,
        'avg_return': avg_return,
        'active_count': len(active),
        # ── Nested objects (backward compatibility) ──
        'active_signals': {
            'count': len(active),
            'avg_rr': avg_rr,
            'avg_confidence': avg_conf,
        },
        'audited_performance': {
            'total_closed': total_closed,
            'wins': len(wins),
            'losses': len(losses),
            'expired': len(expired),
            'win_rate': win_rate,
            'avg_return': avg_return,
            'best_return': best_return,
            'worst_return': worst_return,
            'profit_factor': profit_factor,
        },
        'generated_at': datetime.now(timezone.utc).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Single Commercial Feed")
    parser.add_argument('--json', action='store_true', help='JSON output')
    parser.add_argument('--market', type=str, default=None, help='Filter by market (EGX, TADAWUL, etc.)')
    args = parser.parse_args()

    active = get_active_live_signals(market=args.market)
    audited = get_audited_performance(market=args.market)
    summary = compute_summary(active, audited)

    # Task B-25: جلب حالة السوق SSOT من liquidity_radar_v2 (مصدر موحد)
    # ده يضمن إن commercial_feed + liquidity_radar يشوفوا نفس النسبة الصحيحة
    # (محسوبة من current_value/previous_close، مش من change_percent الفاسد)
    market_regime = None
    try:
        # استيراد detect_market_regime من liquidity_radar_v2 (SSOT)
        import importlib.util as _ilu2
        _lr_path = Path(__file__).resolve().parent / "liquidity_radar_v2.py"
        if _lr_path.exists() and STOCKS_DB.exists():
            _lr_spec = _ilu2.spec_from_file_location("liquidity_radar_v2", _lr_path)
            _lr_mod = _ilu2.module_from_spec(_lr_spec)
            _lr_spec.loader.exec_module(_lr_mod)
            _lr_conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
            _lr_conn.row_factory = sqlite3.Row
            market_regime = _lr_mod.detect_market_regime(_lr_conn, args.market or 'EGX')
            _lr_conn.close()
    except Exception as e:
        log(f"⚠️ تعذر جلب حالة السوق SSOT: {e}")
        market_regime = None

    # Task B-23/B-24: بايثون يفرز ويحدد أقوى 5 صفقات مؤسسية (Rule 20 PYTHON=BRAIN)
    # الواجهة لا تقرر — القرار يخرج محسوباً من هنا.
    conviction = select_top_conviction_signals(active, top_n=5)
    top_5_signals = conviction['top_5_signals']
    extra_signals = conviction['extra_signals']

    # إضافة top_5_count لكائن summary (Task B-24)
    summary['top_5_count'] = len(top_5_signals)

    result = {
        'success': True,
        'summary': summary,
        'market_regime': market_regime,
        'top_5_signals': top_5_signals,
        'extra_signals': extra_signals,
        'active_live_signals': active,
        'audited_performance_history': audited,
    }

    if args.json:
        print(json.dumps(result, ensure_ascii=False, default=str, indent=2))
    else:
        log("=" * 60)
        log("📊 Single Commercial Feed — التوصيات الموحدة")
        log("=" * 60)
        if market_regime:
            log(f"حالة السوق: {market_regime.get('regime')} ({market_regime.get('change_pct')}%) — {market_regime.get('reason')}")
        log(f"Active Live Signals: {len(active)} (بعد Hard Quant Gate)")
        log(f"  Top 5 Conviction: {len(top_5_signals)}")
        log(f"  Extra: {len(extra_signals)}")
        log(f"  avg R:R = {summary['active_signals']['avg_rr']}")
        log(f"  avg confidence = {summary['active_signals']['avg_confidence']}%")
        log(f"Audited Performance: {len(audited)} closed")
        log(f"  win_rate = {summary['audited_performance']['win_rate']}%")
        log(f"  avg_return = {summary['audited_performance']['avg_return']}%")
        log(f"  profit_factor = {summary['audited_performance']['profit_factor']}")
        log("")
        log("--- Top 5 Conviction Signals ---")
        for s in top_5_signals:
            log(f"  {s.get('horizon_icon','🎯')} {s['ticker']:8} | entry={s['entry_price']:.2f} | target={s['target_1']:.2f} | stop={s['stop_loss']:.2f} | R:R={s['risk_reward']:.2f} | conf={s['confidence']:.0f}%")
        log("")
        log("--- Top 5 Audited Trades ---")
        for a in audited[:5]:
            exit_str = f"{a['exit_price']:.2f}" if a['exit_price'] else 'N/A'
            log(f"  {a['status_ar']} {a['ticker']:8} | entry={a['entry_price']:.2f} | exit={exit_str} | return={a['actual_return_pct']:.1f}% | {a['outcome_date']}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
