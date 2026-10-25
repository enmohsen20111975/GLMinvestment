#!/usr/bin/env python3
"""
Stock Deep Analysis Routes
==========================
Blueprint لتحليل سهم واحد بعمق — كل البيانات اللازمة لاتخاذ قرار استثماري
في أسهم المخاطر العالية (Multi-Baggers).

Endpoint:
- GET /api/stock/deep-analysis?ticker=<TICKER>&market=<MARKET>

بيرجع:
- basic_info: name, sector, market_cap, P/E, P/B, EPS, ROE, ROA, debt/equity,
              dividend yield, beta
- technical: RSI, MA50, MA200, support, resistance, 52w high/low, trend, signal,
             volume (parsed), avg_volume, change_percent
- price_history: آخر 90 يوم (open/high/low/close/volume) من price_history.db
- news: آخر 5 أخبار للسهم من news.db (بحث بالـ ticker أو الاسم في الـ title)
- predictions: آخر 5 توقعات للسهم من predictions.db (aiPrediction) مع outcome
- hunter_assessment: entry/stop/target/R-R/narrative/personas (لو السهم عدّى الفلاتر)

كل المنطق في Python — Node.js للعرض فقط.
"""

import os
import sys as _sys
from pathlib import Path as _Path
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from flask import Blueprint, request, jsonify

# ============================================================
# Blueprint setup
# ============================================================
stock_analysis_bp = Blueprint('stock_analysis', __name__, url_prefix='/api/stock')

# ضمان إن analyzers بتاعت hunting_engine تشتغل
_vps_root = _Path(__file__).parent.parent
if str(_vps_root) not in _sys.path:
    _sys.path.insert(0, str(_vps_root))

try:
    from analyzers.hunting_engine import (
        _connect, _safe_float, _safe_int, _parse_volume, _market_filter,
        _get_price_stats, _calculate_support_resistance, _get_30d_max_high,
        STOCKS_DB, PRICE_HISTORY_DB, NEWS_DB, PREDICTIONS_DB,
    )
    HUNTING_HELPERS_AVAILABLE = True
    _HELPERS_ERROR = None
    # 🔧 _MAESTRO_IMPORT_ERROR متغيّر شرطي في hunting_engine — ممكن ميكونش معرّف
    # لو MAESTRO_AVAILABLE = True (الـ except block مش هيشتغل). نستخدم getattr بأمان.
    import analyzers.hunting_engine as _he
    MAESTRO_AVAILABLE = bool(getattr(_he, 'MAESTRO_AVAILABLE', False))
    _MAESTRO_IMPORT_ERROR = getattr(_he, '_MAESTRO_IMPORT_ERROR', None)
except Exception as _e:
    HUNTING_HELPERS_AVAILABLE = False
    _HELPERS_ERROR = str(_e)
    MAESTRO_AVAILABLE = False
    _MAESTRO_IMPORT_ERROR = _HELPERS_ERROR
    # نعرف fallbacks عشان الـ endpoint ما يقعش لو hunting_engine فشل
    STOCKS_DB = str(_vps_root.parent / 'db' / 'stocks.db')
    PRICE_HISTORY_DB = str(_vps_root.parent / 'db' / 'price_history.db')
    # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
    NEWS_DB = str(_vps_root.parent / 'db' / 'news.db')
    PREDICTIONS_DB = str(_vps_root.parent / 'db' / 'predictions.db')

# ── Board of Analysts Integration ─────────────────────────────────────────
try:
    from analyzers.board_of_analysts import get_board_manager as _stock_get_board_manager
    _STOCK_BOARD_AVAILABLE = True
except Exception:
    _stock_get_board_manager = None
    _STOCK_BOARD_AVAILABLE = False
# ──────────────────────────────────────────────────────────────────────────

    def _connect(db_path):  # type: ignore
        import sqlite3
        if not os.path.exists(db_path):
            return None
        try:
            # Phase 7.1: migrated to db_manager (writable=True)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(db_path, writable=True)
            conn.row_factory = sqlite3.Row
            conn.execute('PRAGMA journal_mode=WAL;')
            conn.execute('PRAGMA busy_timeout=30000;')
            return conn
        except Exception:
            return None

    def _safe_float(v, default=0.0):  # type: ignore
        try:
            if v is None or v == '':
                return default
            return float(v)
        except Exception:
            return default

    def _safe_int(v, default=0):  # type: ignore
        try:
            if v is None or v == '':
                return default
            return int(float(v))
        except Exception:
            return default

    def _parse_volume(v, default=0):  # type: ignore
        try:
            if v is None or v == '':
                return default
            if isinstance(v, (int, float)):
                return int(v)
            s = str(v).strip().replace(',', '').upper()
            mult = 1
            if s.endswith('M'):
                mult = 1_000_000; s = s[:-1].strip()
            elif s.endswith('K'):
                mult = 1_000; s = s[:-1].strip()
            elif s.endswith('B'):
                mult = 1_000_000_000; s = s[:-1].strip()
            return int(float(s) * mult)
        except Exception:
            return default

    def _market_filter(market):  # type: ignore
        m = (market or 'EGX').upper()
        if m in ('TADAWUL', 'KSA', 'SAUDI', 'SA'):
            return 'TADAWUL'
        if m in ('EGX', 'KSE', 'QSE', 'CRYPTO'):
            return m
        return 'EGX'

    # MAESTRO_AVAILABLE و _MAESTRO_IMPORT_ERROR اتعرفوا فوق في ال except block


# ============================================================
# Helpers (محلية للـ blueprint)
# ============================================================

def _row_to_dict(row) -> Dict[str, Any]:
    """sqlite3.Row → dict بأمان."""
    if row is None:
        return {}
    try:
        return dict(row)
    except Exception:
        return {}


def _get_data_engine_scraped_info(ticker: str) -> Dict[str, Any]:
    """Reads scraped TradingView indicators & prices from data_engine.db table stocks."""
    data_engine_db = str(_vps_root.parent / 'db' / 'data_engine.db')
    conn = _connect(data_engine_db)
    if not conn:
        return {}
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT symbol, price, change_percent, volume, market_cap, tabs_data, last_update "
            "FROM stocks WHERE symbol = ? OR symbol = ? LIMIT 1",
            (ticker.upper(), f"EGX:{ticker.upper()}")
        )
        row = cur.fetchone()
        if not row:
            return {}
        d = _row_to_dict(row)
        res: Dict[str, Any] = {}
        if d.get('price'): res['current_price'] = _safe_float(d['price'])
        if d.get('change_percent'): res['change_percent'] = _safe_float(d['change_percent'])
        if d.get('market_cap'): res['market_cap'] = _safe_float(d['market_cap'])
        
        tabs_raw = d.get('tabs_data')
        if tabs_raw:
            try:
                import json
                tabs = json.loads(tabs_raw) if isinstance(tabs_raw, str) else tabs_raw
                if isinstance(tabs, dict):
                    if tabs.get('rsi') is not None: res['rsi'] = _safe_float(tabs['rsi'])
                    if tabs.get('macd') is not None: res['macd'] = _safe_float(tabs['macd'])
                    if tabs.get('stochastic') is not None: res['stochastic'] = _safe_float(tabs['stochastic'])
                    if tabs.get('atr') is not None: res['atr'] = _safe_float(tabs['atr'])
                    if tabs.get('adx') is not None: res['adx'] = _safe_float(tabs['adx'])
            except Exception:
                pass
        return res
    except Exception:
        return {}
    finally:
        conn.close()


def _get_basic_info(ticker: str, market: str) -> Dict[str, Any]:
    """يجيب البيانات الأساسية + المالية + التقنية من stocks.db و data_engine.db."""
    result: Dict[str, Any] = {
        'ticker': ticker,
        'found': False,
    }
    conn = _connect(STOCKS_DB)
    if not conn:
        return result
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT ticker, name, name_ar, market, sector, industry, "
            "current_price, previous_close, open_price, high_price, low_price, "
            "change_percent, volume, market_cap, pe_ratio, pb_ratio, ps_ratio, "
            "eps, roe, roa, debt_to_equity, current_ratio, book_value_per_share, "
            "ma_50, ma_200, rsi, support, resistance, signal, trend, "
            "dividend_yield, profit_margin, avg_volume, beta, "
            "high_52w, low_52w, close, is_active, is_egx30, is_egx70, is_egx100, "
            "last_update "
            "FROM stocks WHERE ticker = ? AND market = ? LIMIT 1",
            (ticker, market)
        )
        row = cur.fetchone()
        if not row:
            # fallback: نحاول بدون market (لو الـ ticker موجود في سوق تاني)
            cur.execute(
                "SELECT ticker, name, name_ar, market, sector, industry, "
                "current_price, previous_close, open_price, high_price, low_price, "
                "change_percent, volume, market_cap, pe_ratio, pb_ratio, ps_ratio, "
                "eps, roe, roa, debt_to_equity, current_ratio, book_value_per_share, "
                "ma_50, ma_200, rsi, support, resistance, signal, trend, "
                "dividend_yield, profit_margin, avg_volume, beta, "
                "high_52w, low_52w, close, is_active, is_egx30, is_egx70, is_egx100, "
                "last_update "
                "FROM stocks WHERE ticker = ? LIMIT 1",
                (ticker,)
            )
            row = cur.fetchone()
        if not row:
            return result

        d = _row_to_dict(row)
        result.update({
            'found': True,
            'ticker': d.get('ticker', ticker),
            'name': d.get('name') or ticker,
            'name_ar': d.get('name_ar') or d.get('name') or ticker,
            'market': d.get('market', market),
            'sector': d.get('sector') or '',
            'industry': d.get('industry') or '',
            # سعر
            'current_price': _safe_float(d.get('current_price')),
            'previous_close': _safe_float(d.get('previous_close')),
            'open_price': _safe_float(d.get('open_price')),
            'high_price': _safe_float(d.get('high_price')),
            'low_price': _safe_float(d.get('low_price')),
            'change_percent': _safe_float(d.get('change_percent')),
            'volume_raw': d.get('volume'),
            'volume': _parse_volume(d.get('volume')),
            'avg_volume': _parse_volume(d.get('avg_volume')),
            'close': _safe_float(d.get('close')),
            'last_update': d.get('last_update'),
            # مؤشرات السوق
            'market_cap': _safe_float(d.get('market_cap')),
            # تقييم
            'pe_ratio': _safe_float(d.get('pe_ratio')),
            'pb_ratio': _safe_float(d.get('pb_ratio')),
            'ps_ratio': _safe_float(d.get('ps_ratio')),
            'eps': _safe_float(d.get('eps')),
            # ربحية
            'roe': _safe_float(d.get('roe')),
            'roa': _safe_float(d.get('roa')),
            'profit_margin': _safe_float(d.get('profit_margin')),
            'dividend_yield': _safe_float(d.get('dividend_yield')),
            # مالية
            'debt_to_equity': _safe_float(d.get('debt_to_equity')),
            'current_ratio': _safe_float(d.get('current_ratio')),
            'book_value_per_share': _safe_float(d.get('book_value_per_share')),
            'beta': _safe_float(d.get('beta')),
            # تقني
            'ma_50': _safe_float(d.get('ma_50')),
            'ma_200': _safe_float(d.get('ma_200')),
            'rsi': _safe_float(d.get('rsi')),
            'support': _safe_float(d.get('support')),
            'resistance': _safe_float(d.get('resistance')),
            'signal': d.get('signal'),
            'trend': d.get('trend'),
            'high_52w': _safe_float(d.get('high_52w')),
            'low_52w': _safe_float(d.get('low_52w')),
            # مؤشرات العضوية
            'is_active': bool(d.get('is_active')),
            'is_egx30': bool(d.get('is_egx30')),
            'is_egx70': bool(d.get('is_egx70')),
            'is_egx100': bool(d.get('is_egx100')),
        })

        # دموع بيانات السكرابر المباشرة من data_engine.db (مؤشرات TradingView REST)
        scraped_data = _get_data_engine_scraped_info(ticker)
        for k, v in scraped_data.items():
            if not result.get(k) or result.get(k) == 0:
                result[k] = v

        return result
    except Exception:
        return result
    finally:
        conn.close()


def _get_price_history(ticker: str, days: int = 90) -> List[Dict[str, Any]]:
    """آخر `days` يوم من price_history.db للسهم. بيرجع list مرتب ASC (أقدم → أحدث)."""
    # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth
    from data.prices import load_price_history
    return load_price_history(ticker, limit=days)


def _get_recent_news(ticker: str, name_ar: str = '', limit: int = 5) -> List[Dict[str, Any]]:
    """آخر `limit` خبر للسهم من news.db.

    استراتيجية البحث (لتجنّب false positives زي "upcoming" ليها "comi"):
    1) SQL: نفلتر بالـ LIKE مبدئي (عشان نستفيد من الـ index)
    2) Python: نطبّق word-boundary regex على الـ ticker (\\bTICKER\\b)
    3) Python: كمان نقبل الاسم العربي كـ substring (لأنه عادةً يكون جملة مميزة)
    """
    import re
    conn = _connect(NEWS_DB)
    if not conn:
        return []
    try:
        cur = conn.cursor()
        # SQL مبدئي: نعمنّ عشان نجيب candidates (هتفلترهم Python بعد كده)
        conditions = "title LIKE ?"
        params: List[Any] = [f'%{ticker}%']
        if name_ar and len(name_ar) >= 3:
            # نستخرج كلمات مهمة من الاسم العربي (4+ حروف عربية) ونضيفها للبحث
            arabic_words = [w for w in (name_ar or '').split() if len(w) >= 4]
            for w in arabic_words[:3]:  # أول 3 كلمات
                conditions += " OR title LIKE ?"
                params.append(f'%{w}%')
        # ناخد ضعف الـ limit عشان بعد الفلترة بالـ regex يفضل فيه عدد كافي
        params.append(limit * 5)
        # FIX-WAVE-2-DATA (AUDIT-DEEP-5 #4): table renamed news_articles → market_news per Rule 44.
        # Column mapping to actual market_news schema:
        #   summary→summary_ar, source_url→url, category→impact_type, language→NULL.
        query = (
            "SELECT title, summary_ar AS summary, source, url AS source_url, "
            "published_at, impact_type AS category, NULL AS language "
            f"FROM market_news WHERE ({conditions}) "
            "ORDER BY published_at DESC LIMIT ?"
        )
        cur.execute(query, params)
        rows = cur.fetchall()

        # بناء word-boundary regex للـ ticker (case-insensitive)
        # \b في regex العادي بيميّز حروف/أرقام vs غيرها — كده "upcoming" ما بتمتش
        ticker_re = re.compile(rf'\b{re.escape(ticker)}\b', re.IGNORECASE) if ticker else None

        # استخراج كلمات عربية مهمة للفلترة
        arabic_words = [w for w in (name_ar or '').split() if len(w) >= 4] if name_ar else []

        results: List[Dict[str, Any]] = []
        for r in rows:
            d = _row_to_dict(r)
            title = d.get('title', '') or ''
            # قبول الخبر لو: (ticker ظهر كلمة مستقلة) OR (أي كلمة عربية مهمة موجودة)
            matches = False
            if ticker_re and ticker_re.search(title):
                matches = True
            if not matches and arabic_words:
                for w in arabic_words:
                    if w in title:
                        matches = True
                        break
            if not matches:
                continue
            results.append({
                'title': title,
                'summary': d.get('summary', ''),
                'source': d.get('source', ''),
                'url': d.get('source_url', ''),
                'published_at': d.get('published_at', ''),
                'category': d.get('category', ''),
                'language': d.get('language', 'ar'),
            })
            if len(results) >= limit:
                break
        return results
    except Exception:
        return []
    finally:
        conn.close()


def _get_predictions(ticker: str, limit: int = 5) -> List[Dict[str, Any]]:
    """آخر `limit` توقع للسهم من predictions.db (aiPrediction) مع outcome."""
    conn = _connect(PREDICTIONS_DB)
    if not conn:
        return []
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT stock_symbol, stock_name_ar, signal_type, entry_price, "
            "target_price, stop_loss, regime, prediction_date, status, "
            "final_price, profit_loss_percent, hit_target, hit_stop_loss, "
            "days_to_target, market, created_at, updated_at "
            "FROM aiPrediction WHERE stock_symbol = ? "
            "ORDER BY prediction_date DESC, created_at DESC LIMIT ?",
            (ticker, limit)
        )
        rows = cur.fetchall()
        results: List[Dict[str, Any]] = []
        for r in rows:
            d = _row_to_dict(r)
            status = (d.get('status') or '').upper()
            # outcome مُشتق من status
            if d.get('hit_target') == 1 or status == 'TARGET_HIT':
                outcome = 'TARGET_HIT'
                outcome_ar = 'وصل للهدف ✅'
            elif d.get('hit_stop_loss') == 1 or status == 'STOP_HIT':
                outcome = 'STOP_HIT'
                outcome_ar = 'ضرب الوقف ❌'
            elif status == 'CLOSED':
                outcome = 'CLOSED'
                outcome_ar = 'مُغلقة'
            elif status == 'PENDING':
                outcome = 'PENDING'
                outcome_ar = 'قيد التنفيذ'
            else:
                outcome = status or 'UNKNOWN'
                outcome_ar = 'غير معروف'
            results.append({
                'signal_type': d.get('signal_type', ''),
                'entry_price': _safe_float(d.get('entry_price')),
                'target_price': _safe_float(d.get('target_price')),
                'stop_loss': _safe_float(d.get('stop_loss')),
                'prediction_date': d.get('prediction_date', ''),
                'status': status,
                'outcome': outcome,
                'outcome_ar': outcome_ar,
                'final_price': _safe_float(d.get('final_price')),
                'profit_loss_percent': _safe_float(d.get('profit_loss_percent')),
                'hit_target': bool(d.get('hit_target')),
                'hit_stop_loss': bool(d.get('hit_stop_loss')),
                'days_to_target': d.get('days_to_target'),
                'market': d.get('market', ''),
            })
        return results
    except Exception:
        return []
    finally:
        conn.close()


def _compute_hunter_assessment(basic: Dict[str, Any], price_history: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    يحسب entry/stop/target/R-R للسهم باستخدام منطق hunting_engine.

    مش بيشتغل pipeline كامل (ده لسهم واحد)، بس بياخد السعر الحالي
    ويطبّق نفس منطق stage3_boss_pick:
    - support/resistance من _calculate_support_resistance
    - stop = support × 0.98 (fallback -4%)
    - target = max(high_30d, current) × 1.05 (fallback +15%)
    - risk_reward = reward / risk

    بيرجع dict فيه: entry, stop, target, risk_reward, support, resistance,
    risk_pct, reward_pct, entry_trigger, timeframe, narrative, eligible
    """
    result: Dict[str, Any] = {
        'available': False,
        'eligible': False,
        'entry': 0.0,
        'stop': 0.0,
        'target': 0.0,
        'risk_reward': 0.0,
        'support': 0.0,
        'resistance': 0.0,
        'risk_pct': 0.0,
        'reward_pct': 0.0,
        'entry_trigger': '',
        'timeframe': '',
        'narrative': [],
        'reason': '',
    }

    if not basic.get('found'):
        return result

    ticker = basic.get('ticker', '')
    current_price = _safe_float(basic.get('current_price'))
    if current_price <= 0:
        return result

    # السعر الصحيح من price_history (آخر close) لو متوفر
    if price_history:
        last_close = _safe_float(price_history[-1].get('close'))
        # نطبّق prices_compatible check: ratio ضمن 0.5–2.0
        if last_close > 0:
            ratio = last_close / current_price if current_price > 0 else 1.0
            if 0.5 <= ratio <= 2.0:
                current_price = last_close

    # نستدعي دوال hunting_engine
    stock_support = _safe_float(basic.get('support'))
    stock_resistance = _safe_float(basic.get('resistance'))

    try:
        support, resistance = _calculate_support_resistance(
            ticker, current_price, stock_support, stock_resistance, days=30
        )
        max_high_30d = _get_30d_max_high(ticker, current_price)
    except Exception:
        support = current_price * 0.96
        resistance = current_price * 1.12
        max_high_30d = 0.0

    # stop = support × 0.98 (fallback -4%)
    if 0 < support < current_price:
        stop = support * 0.98
    else:
        stop = current_price * 0.96

    # target = max(high_30d, current) × 1.05 (fallback +15%)
    # Task FINALIZE-UNIFICATION (Rule 27 — NO-FAKE-DATA):
    # Previously fabricated target as ref_high * 1.05 / current * 1.15.
    # Now: use the real 30-day high as the target (resistance ceiling),
    # or NULL when no 30-day high data. Downstream skips risk_reward if None.
    #
    # ── Task BRAVO-P0-QUANT-LOGIC-NO-FALLING-KNIFE (Step 1 — Owner Directive) ──
    # Falling Knife Guard: لو السهم في مسار هابط (price < MA50 - 5% + MA50 < MA200)
    # → يُمنع اعتبار القمم السابقة كـ target_price للشراء.
    # القمم = مقاومات تصريف (Resistance / Exit Zones)، NOT أهداف ربح.
    ma50 = _safe_float(basic.get('ma_50'))
    ma200 = _safe_float(basic.get('ma_200'))
    falling_knife_guard = None
    try:
        from analyzers.institutional_levels import detect_falling_knife
        falling_knife_guard = detect_falling_knife(price_history, ma50, ma200)
    except Exception:
        pass

    if falling_knife_guard and falling_knife_guard.get('is_falling_knife'):
        # 🚨 Falling Knife — لا أهداف شراء. القمم = مقاومات تصريف فقط.
        target = None
        entry = None
        risk_reward = None
        risk = 0
        reward = 0
        risk_pct = 0
        reward_pct = 0
        entry_trigger = f"🚨 {falling_knife_guard.get('reason', 'Falling Knife')} — تجنب الشراء. القمم السابقة = مقاومات تصريف."
        timeframe = "غير متاح (مسار هابط)"
        result['available'] = True
        result['eligible'] = False
        result['entry'] = None
        result['stop'] = None
        result['target'] = None
        result['risk_reward'] = None
        result['support'] = round(support, 2) if support > 0 else 0.0
        result['resistance'] = round(resistance, 2) if resistance > 0 else 0.0
        result['risk_pct'] = 0.0
        result['reward_pct'] = 0.0
        result['entry_trigger'] = entry_trigger
        result['timeframe'] = timeframe
        result['narrative'] = [
            f"🚨 تحذير: السهم في مسار هابط (Falling Knife).",
            f"السعر {falling_knife_guard.get('price_vs_ma50_pct', 0):.1f}% أدنى من MA50.",
            f"القمم السابقة = مقاومات تصريف ({falling_knife_guard.get('resistance_zones', [])})، NOT أهداف ربح.",
            f"لا توجد صفقة شراء موصى بها (Rule 27 — لا اختلاق أهداف وهمية).",
        ]
        result['reason'] = 'falling_knife_guard_active'
        result['falling_knife'] = falling_knife_guard
        return result

    # لو not falling knife → احسب target بشكل طبيعي
    if max_high_30d > 0:
        ref_high = max(max_high_30d, current_price)
        target = ref_high  # real 30-day high as the resistance ceiling (no *1.05)
    else:
        # Rule 27: no 30-day high → NULL target (was current * 1.15).
        target = None

    entry = current_price
    # Rule 27: if target is None, cannot compute a real risk_reward → leave None.
    if target is None:
        risk = 0
        reward = 0
        risk_reward = None
    else:
        risk = entry - stop
        reward = target - entry
        if risk <= 0:
            return result
        risk_reward = reward / risk
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            risk_reward = compute_risk_reward(entry, target, stop, fallback=risk_reward)
        except Exception:
            pass  # keep inline risk_reward computed above
    risk_pct = (risk / entry) * 100
    reward_pct = (reward / entry) * 100

    # entry_trigger
    if support > 0 and current_price <= support * 1.05:
        entry_trigger = f"ادخل من {current_price:.2f} (عند الدعم)"
    elif resistance > 0 and current_price >= resistance * 0.95:
        entry_trigger = f"ادخل لو كسر {resistance:.2f} بسيولة"
    elif support > 0 and resistance > 0:
        entry_trigger = f"استنى لحد ما يوصل {support:.2f} أو يكسر {resistance:.2f}"
    else:
        entry_trigger = f"ادخل من {current_price:.2f}"

    # timeframe
    if reward_pct >= 15:
        timeframe = "3-6 أسابيع"
    elif reward_pct >= 8:
        timeframe = "2-4 أسابيع"
    else:
        timeframe = "1-2 أسبوع"

    # narrative بسيط
    narrative: List[str] = []
    change_1d = _safe_float(basic.get('change_percent'))
    line1_parts = [f"السهم بسعر {current_price:.2f}"]
    if change_1d > 5:
        line1_parts.append(f"طالع {change_1d:.1f}% — حركة قوية")
    elif change_1d < -5:
        line1_parts.append(f"نزل {abs(change_1d):.1f}% — مرتبك حالياً")
    elif change_1d != 0:
        line1_parts.append(f"تغير {change_1d:.1f}%")
    narrative.append(' — '.join(line1_parts))

    line2: List[str] = []
    if basic.get('sector'):
        line2.append(f"القطاع: {basic.get('sector')}")
    high_52w = _safe_float(basic.get('high_52w'))
    low_52w = _safe_float(basic.get('low_52w'))
    if high_52w > 0 and current_price > 0:
        dh = ((high_52w - current_price) / high_52w) * 100
        if dh > 30:
            line2.append(f"بعيد {dh:.0f}% عن قمة السنة")
        elif dh < 10:
            line2.append(f"قرب القمة ({dh:.0f}%)")
    if line2:
        narrative.append(' — '.join(line2))

    line3: List[str] = []
    if risk_reward >= 3.0:
        line3.append(f"R/R = 1:{risk_reward:.1f} (ممتاز)")
    elif risk_reward >= 2.0:
        line3.append(f"R/R = 1:{risk_reward:.1f} (مقبول)")
    else:
        line3.append(f"R/R = 1:{risk_reward:.1f} (ضعيف — وقف بعيد أو هدف قريب)")
    if entry_trigger:
        line3.append(entry_trigger)
    if line3:
        narrative.append(' — '.join(line3))

    # eligible: نفس معايير hunting_engine (R/R >= 3.0, risk in [4%, 30%], reward <= 20%)
    eligible = (
        risk_reward >= 3.0
        and 4.0 <= risk_pct <= 30.0
        and 0.0 < reward_pct <= 20.0
        and stop < entry
        and target > entry
    )

    # reason
    reason_parts: List[str] = []
    if eligible:
        reason_parts.append("عدّى فلاتر الصياد (R/R ≥ 3.0)")
    else:
        if risk_reward < 3.0:
            reason_parts.append(f"R/R = {risk_reward:.1f} (أقل من 3.0 المطلوبة)")
        if risk_pct < 4.0:
            reason_parts.append("الوقف قريب جداً من الدخول")
        if risk_pct > 30.0:
            reason_parts.append("الوقف بعيد جداً (سهم شديد التذبذب)")
        if reward_pct > 20.0:
            reason_parts.append("الهدف بعيد (> 20% — غير واقعي)")
    if basic.get('sector'):
        reason_parts.append(f"القطاع: {basic.get('sector')}")

    result.update({
        'available': True,
        'eligible': eligible,
        'entry': round(entry, 2),
        'stop': round(stop, 2),
        'target': round(target, 2),
        'risk_reward': round(risk_reward, 2),
        'support': round(support, 2),
        'resistance': round(resistance, 2),
        'risk_pct': round(risk_pct, 1),
        'reward_pct': round(reward_pct, 1),
        'entry_trigger': entry_trigger,
        'timeframe': timeframe,
        'narrative': narrative,
        'reason': ' — '.join([p for p in reason_parts if p]),
    })
    return result


def _compute_fallback_technical_indicators(price_history: List[Dict[str, Any]], current_price: float = 0.0) -> Dict[str, Any]:
    """Computes RSI, MA50, MA200, Support, Resistance, Trend, 52W High/Low dynamically from price history with strict financial sanity."""
    if not price_history or len(price_history) < 2:
        cp = current_price if current_price > 0 else 0.0
        if cp > 0:
            return {
                # Task FINALIZE-UNIFICATION (Rule 27): previously fabricated
                # as rsi=50.0, support=cp*0.95, resistance=cp*1.05 when no
                # price history. Now: NULL for all derived indicators. ma_50/
                # ma_200 = cp (real current price, neutral signal).
                'rsi': None,
                'ma_50': cp,
                'ma_200': cp,
                'support': None,
                'resistance': None,
                # Rule 67 — never fabricate 52w values. null when missing; frontend shows "—".
                'high_52w': None,
                'low_52w': None,
                'trend': 'عرضي',
            }
        return {}

    closes = [h['close'] for h in price_history if h.get('close') and h['close'] > 0]
    highs = [h['high'] for h in price_history if h.get('high') and h['high'] > 0]
    lows = [h['low'] for h in price_history if h.get('low') and h['low'] > 0]

    if not closes:
        return {}

    cp = current_price if current_price > 0 else closes[-1]

    # Calculate RSI (14) — CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67)
    # Backward-compatible wrapper: previously SMA-based (BUG per Rule 67).
    rsi = 50.0
    if len(closes) >= 15:
        # CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing
        from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
        _rsi_val = _canonical_calc_rsi(closes, 14)
        if _rsi_val is not None:
            rsi = _rsi_val

    # Calculate MA50 & MA200
    ma_50 = round(sum(closes[-50:]) / min(len(closes), 50), 2) if len(closes) >= 5 else cp
    ma_200 = round(sum(closes[-200:]) / min(len(closes), 200), 2) if len(closes) >= 20 else ma_50

    # Calculate ATR (14) for dynamic support/resistance
    atr = cp * 0.03
    if len(highs) >= 14 and len(lows) >= 14:
        trs = []
        for i in range(1, min(len(highs), len(lows), len(closes))):
            tr = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
            trs.append(tr)
        if trs:
            atr = sum(trs[-14:]) / min(len(trs), 14)

    # Support & Resistance:
    recent_highs = highs[-30:] if highs else closes[-30:]
    recent_lows = lows[-30:] if lows else closes[-30:]

    # Distinct swing levels (at least 1.5% away to avoid intraday noise)
    overhead_highs = [h for h in recent_highs if h >= cp * 1.015]
    underneath_lows = [l for l in recent_lows if l <= cp * 0.985]

    if overhead_highs:
        resistance = round(min(overhead_highs), 2)
    else:
        resistance = round(max(cp * 1.04, cp + 1.2 * atr), 2)

    if underneath_lows:
        support = round(max(underneath_lows), 2)
    else:
        support = round(min(cp * 0.96, cp - 1.2 * atr), 2)

    # Strict Financial Sanity Enforcement
    # Task FINALIZE-UNIFICATION (Rule 27 — NO-FAKE-DATA):
    # Previously fabricated as cp * 1.05 / * 0.95 in degenerate cases
    # (resistance below cp, support above cp, support >= resistance).
    # Now: set to None when the calculated values are nonsensical. The
    # caller (_compute_fallback_technical_indicators) is a FALLBACK path
    # used only when the main analyzer doesn't return values — None is
    # preferred over fabricated values per Rule 27.
    if resistance <= cp:
        resistance = None
    if support is not None and (support >= cp or support <= 0):
        support = None
    if support is not None and resistance is not None and support >= resistance:
        support = None
        resistance = None

    # 52-week High/Low — Rule 67: never fabricate. Real from price_history or None.
    # (CRST real range 0.35 → 4.09 must NOT be replaced by cp * 0.85 = 2.57.)
    high_52w = round(max(max(highs), cp), 2) if highs else None
    low_52w = round(min(min(lows), cp), 2) if lows else None

    # Trend
    trend = 'صاعد' if cp >= ma_50 else 'هابط'

    return {
        'rsi': rsi,
        'ma_50': ma_50,
        'ma_200': ma_200,
        'support': support,
        'resistance': resistance,
        'high_52w': high_52w,
        'low_52w': low_52w,
        'trend': trend,
    }


# ============================================================
# Endpoint: /api/stock/deep-analysis
# ============================================================

@stock_analysis_bp.route('/deep-analysis', methods=['GET'])
def deep_analysis():
    """
    تحليل عميق لسهم واحد — كل البيانات اللازمة لقرار استثماري.

    Query params:
    - ticker: رمز السهم (مطلوب) — مثال: COMI, EGTS, AALR
    - market: السوق (اختياري، default: EGX) — EGX, TADAWUL, KSE, QSE
    """
    ticker = (request.args.get('ticker') or '').strip().upper()
    market = _market_filter(request.args.get('market', 'EGX'))

    if not ticker:
        return jsonify({
            'success': False,
            'error': 'ticker مطلوب. مثال: /api/stock/deep-analysis?ticker=EGTS&market=EGX',
        }), 400

    start_time = datetime.now()

    # 1) basic_info + technical + financial metrics from stocks.db
    basic = _get_basic_info(ticker, market)
    if not basic.get('found'):
        return jsonify({
            'success': False,
            'error': f"السهم '{ticker}' مش موجود في السوق '{market}'",
            'ticker': ticker,
            'market': market,
        }), 404

    # 2) price_history (آخر 90 يوم) من price_history.db / data.prices
    price_history = _get_price_history(ticker, days=90)

    # Financial Sanity Gate: التأكد من صحة الدعم والمقاومة ومدى 52 أسبوع
    cp = _safe_float(basic.get('current_price'))
    sup = _safe_float(basic.get('support'))
    res = _safe_float(basic.get('resistance'))
    h52 = _safe_float(basic.get('high_52w'))
    l52 = _safe_float(basic.get('low_52w'))

    # تعديل منطقي لو السعر الحالي تجاوز المدى التاريخي
    if cp > 0:
        if h52 > 0 and h52 < cp:
            h52 = cp
            basic['high_52w'] = cp
        if l52 > 0 and l52 > cp:
            l52 = cp
            basic['low_52w'] = cp

    # الدعم والمقاومة صالحين فقط إذا كان الدعم أقل من السعر والمقاومة أعلى من السعر
    is_sr_valid = (
        cp > 0 and sup > 0 and res > 0 and
        sup < cp and res > cp and
        sup < res
    )
    is_52w_valid = (
        cp > 0 and h52 > 0 and l52 > 0 and
        h52 >= cp and l52 <= cp and h52 >= l52 and
        h52 <= cp * 50.0 and (cp / l52 <= 100.0)
    )

    # حساب المؤشرات الفنية فورياً من تاريخ الأسعار
    fallback_tech = {}
    if price_history:
        fallback_tech = _compute_fallback_technical_indicators(price_history, cp)
        for k, v in fallback_tech.items():
            if k in ('support', 'resistance') and not is_sr_valid:
                basic[k] = v
            elif k in ('high_52w', 'low_52w') and not is_52w_valid:
                basic[k] = v
            elif not basic.get(k) or basic.get(k) == 0:
                basic[k] = v
    else:
        # Fallback if no history exists
        # Task FINALIZE-UNIFICATION (Rule 27): was fabricated as cp * 0.95/1.05.
        # Now: NULL when no real S/R data (consistent with the empty-history
        # branch in _compute_fallback_technical_indicators above).
        if not is_sr_valid and cp > 0:
            basic['support'] = None
            basic['resistance'] = None
        if not is_52w_valid:
            # Rule 67 — never fabricate 52w values when real data is missing/invalid. Honest null.
            basic['high_52w'] = None
            basic['low_52w'] = None

    # Final absolute financial sanity guarantee
    # Task FINALIZE-UNIFICATION (Rule 27): was fabricated as cp * 0.95/1.05
    # in degenerate cases. Now: NULL when the calculated values are
    # nonsensical (support above cp, resistance below cp, etc.).
    if cp > 0:
        cur_sup = _safe_float(basic.get('support'))
        cur_res = _safe_float(basic.get('resistance'))
        if cur_sup >= cp or cur_sup <= 0:
            basic['support'] = None
        if cur_res <= cp:
            basic['resistance'] = None
        # Re-fetch after possible nullification.
        cur_sup2 = _safe_float(basic.get('support'))
        cur_res2 = _safe_float(basic.get('resistance'))
        if cur_sup2 > 0 and cur_res2 > 0 and cur_sup2 >= cur_res2:
            basic['support'] = None
            basic['resistance'] = None

        # 52-week High/Low: Single source of truth from stocks.db (never overwrite with 90-day fallback)
        cur_h52 = _safe_float(basic.get('high_52w'))
        cur_l52 = _safe_float(basic.get('low_52w'))
        if cur_h52 > 0:
            basic['high_52w'] = max(cur_h52, cp)
        else:
            # Rule 67 — no fabrication. Real from price_history (or null if no history).
            basic['high_52w'] = fallback_tech.get('high_52w')

        if cur_l52 > 0:
            basic['low_52w'] = min(cur_l52, cp)
        else:
            # Rule 67 — no fabrication. Real from price_history (or null if no history).
            basic['low_52w'] = fallback_tech.get('low_52w')

    # 3) recent news (آخر 5)
    news = _get_recent_news(ticker, name_ar=basic.get('name_ar', ''), limit=5)

    # 4) past predictions (آخر 5 مع outcome)
    predictions = _get_predictions(ticker, limit=5)

    # 5) hunter assessment (entry/stop/target/R-R)
    hunter = _compute_hunter_assessment(basic, price_history)

    # ── Task BRAVO-P0-QUANT-LOGIC-NO-FALLING-KNIFE (Step 3 — Signal-Target Consistency) ──
    # لو التوصية AVOID/SELL/STRONG_SELL أو لا يوجد نموذج كمي مكتمل:
    # لا توليد entry_price/stop_loss توحي بصفقة شراء (Rule 27 — لا اختلاق).
    _signal_upper = str(basic.get('signal', '')).upper()
    _avoid_signals = ('AVOID', 'SELL', 'STRONG_SELL', 'WAIT', '')
    if _signal_upper in _avoid_signals:
        if hunter.get('eligible'):
            hunter['eligible'] = False
            hunter['entry'] = None
            hunter['stop'] = None
            hunter['target'] = None
            hunter['risk_reward'] = None
            hunter['risk_pct'] = 0.0
            hunter['reward_pct'] = 0.0
            hunter['entry_trigger'] = f"لا توجد صفقة شراء — الإشارة: {basic.get('signal', 'N/A')}"
            hunter['timeframe'] = "غير متاح"
            hunter['reason'] = 'signal_target_consistency_avoid_sell'
            hunter['narrative'] = [
                f"الإشارة الفنية: {basic.get('signal', 'N/A')} — لا يوجد نموذج كمي مكتمل لصفقة شراء.",
                f"Rule 27: لا اختلاق entry_price/stop_loss لواجح للشراء.",
            ]

    elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)

    # نبني التقسيم النهائي للـ response
    response = {
        'success': True,
        'ticker': basic['ticker'],
        'market': basic['market'],
        'name': basic['name'],
        'name_ar': basic['name_ar'],
        'timestamp': datetime.now().isoformat(),
        'elapsed_ms': elapsed_ms,

        # basic_info: بيانات تعريفية + سوق
        'basic_info': {
            'ticker': basic['ticker'],
            'name': basic['name'],
            'name_ar': basic['name_ar'],
            'market': basic['market'],
            'sector': basic['sector'],
            'industry': basic['industry'],
            'is_active': basic['is_active'],
            'is_egx30': basic['is_egx30'],
            'is_egx70': basic['is_egx70'],
            'is_egx100': basic['is_egx100'],
            'last_update': basic.get('last_update'),
        },

        # price: الأسعار اليومية + التغير
        'price': {
            'current_price': basic['current_price'],
            'previous_close': basic['previous_close'],
            'open_price': basic['open_price'],
            'high_price': basic['high_price'],
            'low_price': basic['low_price'],
            'change_percent': basic['change_percent'],
            'volume': basic['volume'],
            'volume_raw': basic.get('volume_raw'),
            'avg_volume': basic['avg_volume'],
            'close': basic['close'],
        },

        # key_metrics: مؤشرات التقييم + الربحية + المالية
        'key_metrics': {
            'market_cap': basic['market_cap'],
            'pe_ratio': basic['pe_ratio'],
            'pb_ratio': basic['pb_ratio'],
            'ps_ratio': basic['ps_ratio'],
            'eps': basic['eps'],
            'roe': basic['roe'],
            'roa': basic['roa'],
            'profit_margin': basic['profit_margin'],
            'dividend_yield': basic['dividend_yield'],
            'debt_to_equity': basic['debt_to_equity'],
            'current_ratio': basic['current_ratio'],
            'book_value_per_share': basic['book_value_per_share'],
            'beta': basic['beta'],
        },

        # technical: المؤشرات التقنية + الدعم/المقاومة + المدى
        'technical': {
            'rsi': basic['rsi'],
            'ma_50': basic['ma_50'],
            'ma_200': basic['ma_200'],
            'support': basic['support'],
            'resistance': basic['resistance'],
            'signal': basic['signal'],
            'trend': basic['trend'],
            'high_52w': basic['high_52w'],
            'low_52w': basic['low_52w'],
        },

        # price_history: آخر 90 يوم (للرسم البياني)
        'price_history': price_history,

        # news: آخر 5 أخبار
        'news': news,

        # predictions: آخر 5 توقعات مع outcome
        'predictions': predictions,

        # hunter_assessment: تقييم الصياد (entry/stop/target/R-R)
        'hunter_assessment': hunter,

        # meta
        'meta': {
            'hunting_helpers_available': HUNTING_HELPERS_AVAILABLE,
            'maestro_available': MAESTRO_AVAILABLE,
            'helpers_error': _HELPERS_ERROR,
            'maestro_error': None if MAESTRO_AVAILABLE else _MAESTRO_IMPORT_ERROR,
            'price_history_count': len(price_history),
            'news_count': len(news),
            'predictions_count': len(predictions),
            'hunter_available': hunter.get('available', False),
            'hunter_eligible': hunter.get('eligible', False),
        },
    }

    # ── Board of Analysts section ──────────────────────────────────────────
    market_hint = request.args.get('market', '').upper()
    if not market_hint:
        t = ticker.upper()
        if t.isdigit():
            market_hint = 'TADAWUL'
        elif t.startswith('BTC') or t.startswith('ETH') or len(t) <= 4:
            market_hint = 'EGX'
        else:
            market_hint = 'EGX'

    if _STOCK_BOARD_AVAILABLE and _stock_get_board_manager:
        try:
            _board_mgr = _stock_get_board_manager(market_hint)
            _board_rpt = _board_mgr.generate_final_report(ticker)
            response['board_analysis'] = {
                'available': True,
                'signal': _board_rpt.get('signal', 'HOLD'),
                'signal_ar': _board_rpt.get('signal_ar', ''),
                'confidence': _board_rpt.get('confidence', 50),
                'master_score': _board_rpt.get('master_score', 50),
                'market': _board_rpt.get('market', market_hint),
                'opinions': _board_rpt.get('opinions', {}),
                'sell_strategy': _board_rpt.get('sell_strategy', ''),
                'sell_strategy_desc': _board_rpt.get('sell_strategy_desc', ''),
                'entry_price': _board_rpt.get('entry_price'),
                'target_price': _board_rpt.get('target_price'),
                'stop_loss': _board_rpt.get('stop_loss'),
                'reason_ar': _board_rpt.get('reason_ar', ''),
            }
        except Exception as _be:
            response['board_analysis'] = {'available': False, 'error': str(_be)}
    else:
        response['board_analysis'] = {'available': False}
    # ──────────────────────────────────────────────────────────────────────

    return jsonify(response)
