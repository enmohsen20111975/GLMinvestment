"""
Persona Screener — شاشة فرز الأسهم حسب الشخصية
=================================================
@version 1.0.0

المشكلة: لما الواجهة بتعرض صفحة التوصيات، الشخصيتين (المستثمر والمغامر)
بيظهروا نفس قائمة الأسهم بس بإسامي مختلفة.

الحل: Screener بيفرز كل الأسهم من الداتابيز، وبيشغل التحليل المناسب
لكل شخصية، وبيطبق فلاتر صارمة (hard filters) قبل التقييم، ويرجع
فقط الأسهم اللي تطابق معايير كل شخصية.

كده المستثمر والمغامر هياخدوا قوائم مختلفة فعلاً.

Investor Hard Filters (لازم تعدّي الكل):
  - Piotroski Score ≥ 6
  - Altman Z-Score > 1.1
  - FCF > 0
  - Revenue Growth ≥ 0

Gambler Hard Filters (لازم تعدّي الكل):
  - RSI < 30 (تشبع بيعي)
  - Volume Spike ≥ 1.5x
  - Above SMA20
  - R/R > 1.5

لو مفيش بيانات كافية للفلاتر الصارمة → fallback على
analyze_investor / analyze_gambler بشرط Score ≥ عتبة معينة.
"""

from __future__ import annotations

import sqlite3
import time
import re
import os
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass

# ─── استيراد محركات الشخصية الموجودة ───
from analyzers.persona_investor import analyze_investor, InvestorResult
from analyzers.persona_gambler import analyze_gambler, GamblerResult
from analyzers.support_resistance_calculator import calculate_support_resistance
from analyzers.indicators.ma import sma as _canonical_sma
from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi

# ─── مسارات الداتابيز ───
_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')

# ─── إعدادات الكاش ───
_CACHE_TTL = 300  # 5 دقايق بالثواني
_cache: Dict[str, Any] = {
    'stock_list': None,
    'stock_list_ts': 0.0,
    'fundamentals': {},
    'fundamentals_ts': 0.0,
    'technicals': {},
    'technicals_ts': 0.0,
}


# ═══════════════════════════════════════════════════════════
#  أدوات مساعدة — Utility Functions
# ═══════════════════════════════════════════════════════════

def _safe_float(val: Any, default: float = 0.0) -> float:
    """تحويل قيمة لـ float بأمان — بيتعامل مع None و strings."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        try:
            # إزالة Unicode narrow spaces أولاً (قبل المعالجة)
            cleaned = val.replace('\u202f', ' ')
            # إزالة علامات النسبة المئوية
            cleaned = cleaned.rstrip('%')
            # إزالة علامات + و − (Unicode minus)
            cleaned = cleaned.replace('+', '').replace('−', '-').replace('–', '-')
            # إزالة الفواصل
            cleaned = cleaned.replace(',', '')
            # إزالة الوحدات مثل "B EGP", "M SAR", "K EGP", إلخ
            # النمط: رقم بعده B/M/K وبعده عملة/وحدة
            multiplier = 1.0
            # نبحث عن T/B/M/K بعد الرقم (قبل إزالة الحروف)
            # T = Trillion, B = Billion, M = Million, K = Thousand
            # كمان بنشوف إشارة سالب قبل الرقم
            unit_match = re.search(r'(-?\d+(?:\.\d+)?)\s*([TBMK])\b', cleaned, re.IGNORECASE)
            if unit_match:
                # الرقم نفسه
                number_part = unit_match.group(1)
                unit = unit_match.group(2).upper()
                if unit == 'T':
                    multiplier = 1_000_000_000_000
                elif unit == 'B':
                    multiplier = 1_000_000_000
                elif unit == 'M':
                    multiplier = 1_000_000
                elif unit == 'K':
                    multiplier = 1_000
                # استبدل الجزء كله بالرقم فقط
                cleaned = number_part
            else:
                # مفيش وحدة — إزالة أي حروف متبقية (عملات إلخ)
                cleaned = re.sub(r'[A-Za-z\u0600-\u06FF]+', '', cleaned).strip()

            # إزالة مسافات متبقية
            cleaned = cleaned.strip()
            if cleaned in ('', '-', '.'):
                return default
            return float(cleaned) * multiplier
        except (ValueError, TypeError):
            return default
    return default


def _parse_percentage(val: Any, default: float = 0.0) -> float:
    """تحويل نسبة مئوية نصية لرقم — مثال: '57.75%' → 57.75."""
    result = _safe_float(val, default=None)
    if result is not None:
        return result
    return default


def _parse_financial_value(val: Any, default: float = 0.0) -> float:
    """تحويل قيمة مالية نصية لرقم — مثال: '44.02 B EGP' → 44020000000."""
    return _safe_float(val, default=default)


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    """حصر القيمة بين حد أدنى وأعلى."""
    return max(lo, min(hi, v))


# ═══════════════════════════════════════════════════════════
#  قراءة الأسهم من الداتابيز — Stock List Loading
# ═══════════════════════════════════════════════════════════

def _load_all_stocks(market: str = None) -> List[Dict[str, Any]]:
    """
    تحميل كل الأسهم النشطة من stocks.db.
    النتيجة متكاشة لمدة 5 دقايق.
    """
    now = time.time()
    if _cache['stock_list'] is not None and (now - _cache['stock_list_ts']) < _CACHE_TTL:
        return _cache['stock_list']

    try:
        conn = sqlite3.connect(STOCKS_DB)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        
        query = '''
            SELECT
                ticker, name, name_ar, sector, current_price,
                pe_ratio, pb_ratio, roe, roa, dividend_yield,
                profit_margin, debt_to_equity, current_ratio,
                book_value_per_share, market_cap, eps,
                rsi, support, resistance, avg_volume, volume,
                ma_50, ma_200, beta, high_52w, low_52w,
                change_percent, is_egx30, is_egx70, is_egx100, market
            FROM stocks
            WHERE is_active = 1 AND current_price > 0
        '''
        params = []
        if market:
            query += ' AND market = ?'
            params.append(market)
        query += ' ORDER BY ticker'
        
        cur.execute(query, params)
        rows = cur.fetchall()
        conn.close()

        stocks = []
        for r in rows:
            d = dict(r)
            # تنظيف volume (ممكن يكون نص مثل "2.28 M")
            d['volume'] = _safe_float(d.get('volume'), default=0)
            d['current_price'] = _safe_float(d.get('current_price'), default=0)
            d['market_cap'] = _safe_float(d.get('market_cap'), default=0)
            stocks.append(d)

        _cache['stock_list'] = stocks
        _cache['stock_list_ts'] = now
        return stocks

    except Exception as e:
        print(f"[PersonaScreener] خطأ في تحميل الأسهم: {e}")
        return _cache.get('stock_list') or []


# ═══════════════════════════════════════════════════════════
#  قراءة البيانات الأساسية من data_engine.db
# ═══════════════════════════════════════════════════════════

def _load_fundamentals_batch(tickers: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    تحميل البيانات الأساسية لكل الأسهم مرة واحدة من data_engine.db.
    بيرجع dict: ticker → {profitability, valuation, balance_sheet, cash_flow, income, performance}
    """
    now = time.time()
    if _cache['fundamentals'] and (now - _cache['fundamentals_ts']) < _CACHE_TTL:
        return _cache['fundamentals']

    result: Dict[str, Dict[str, Any]] = {}

    try:
        if not os.path.exists(DATA_ENGINE_DB):
            return result

        conn = sqlite3.connect(DATA_ENGINE_DB)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # ─── tab_profitability ───
        # Symbols in data_engine.db might have Arabic appended (e.g. "AALRالعامة")
        # We'll load ALL Egyptian market rows and match by prefix
        cur.execute("SELECT * FROM tab_profitability WHERE market = 'مصر'")
        for row in cur.fetchall():
            r = dict(row)
            symbol = r.get('symbol', '')
            # استخراج الـ ticker الإنجليزي (قبل أي حرف عربي)
            ticker = re.match(r'^([A-Z]+)', symbol)
            if ticker:
                t = ticker.group(1)
                if t not in result:
                    result[t] = {}
                result[t]['profitability'] = {
                    'gross_margin': _parse_percentage(r.get('gross_margin')),
                    'operating_margin': _parse_percentage(r.get('operating_margin')),
                    'net_margin': _parse_percentage(r.get('net_margin')),
                    'fcf_margin': _parse_percentage(r.get('fcf_margin')),
                    'roa': _parse_percentage(r.get('roa')),
                    'roe': _parse_percentage(r.get('roe')),
                    'roc': _parse_percentage(r.get('roc')),
                }

        # ─── tab_valuation ───
        cur.execute("SELECT * FROM tab_valuation WHERE market = 'مصر'")
        for row in cur.fetchall():
            r = dict(row)
            symbol = r.get('symbol', '')
            ticker = re.match(r'^([A-Z]+)', symbol)
            if ticker:
                t = ticker.group(1)
                if t not in result:
                    result[t] = {}
                result[t]['valuation'] = {
                    'pe_ratio': _safe_float(r.get('pe_ratio')),
                    'pb_ratio': _safe_float(r.get('pb_ratio')),
                    'ps_ratio': _safe_float(r.get('ps_ratio')),
                    'market_cap': _parse_financial_value(r.get('market_cap')),
                    'ev': _parse_financial_value(r.get('ev')),
                }

        # ─── tab_balance_sheet ───
        cur.execute("SELECT * FROM tab_balance_sheet WHERE market = 'مصر'")
        for row in cur.fetchall():
            r = dict(row)
            symbol = r.get('symbol', '')
            ticker = re.match(r'^([A-Z]+)', symbol)
            if ticker:
                t = ticker.group(1)
                if t not in result:
                    result[t] = {}
                # خذ أحدث سجل (fiscal_end عادة الأحدث)
                if 'balance_sheet' not in result[t]:
                    result[t]['balance_sheet'] = {
                        'total_assets': _parse_financial_value(r.get('total_assets')),
                        'total_liabilities': _parse_financial_value(r.get('total_liabilities')),
                        'total_equity': _parse_financial_value(r.get('total_equity')),
                        'current_assets': _parse_financial_value(r.get('current_assets')),
                        'current_liabilities': _parse_financial_value(r.get('current_liabilities')),
                        'cash': _parse_financial_value(r.get('cash')),
                        'debt': _parse_financial_value(r.get('debt')),
                        'shares_outstanding': _parse_financial_value(r.get('shares_outstanding')),
                    }

        # ─── tab_cash_flow ───
        cur.execute("SELECT * FROM tab_cash_flow WHERE market = 'مصر'")
        for row in cur.fetchall():
            r = dict(row)
            symbol = r.get('symbol', '')
            ticker = re.match(r'^([A-Z]+)', symbol)
            if ticker:
                t = ticker.group(1)
                if t not in result:
                    result[t] = {}
                if 'cash_flow' not in result[t]:
                    result[t]['cash_flow'] = {
                        'operating_cf': _parse_financial_value(r.get('operating_cf')),
                        'free_cf': _parse_financial_value(r.get('free_cf')),
                        'investing_cf': _parse_financial_value(r.get('investing_cf')),
                        'financing_cf': _parse_financial_value(r.get('financing_cf')),
                    }

        # ─── tab_income_statement ───
        cur.execute("SELECT * FROM tab_income_statement WHERE market = 'مصر'")
        for row in cur.fetchall():
            r = dict(row)
            symbol = r.get('symbol', '')
            ticker = re.match(r'^([A-Z]+)', symbol)
            if ticker:
                t = ticker.group(1)
                if t not in result:
                    result[t] = {}
                if 'income' not in result[t]:
                    result[t]['income'] = {
                        'revenue': _parse_financial_value(r.get('revenue')),
                        'revenue_growth': _parse_percentage(r.get('revenue_growth')),
                        'gross_profit': _parse_financial_value(r.get('gross_profit')),
                        'operating_income': _parse_financial_value(r.get('operating_income')),
                        'net_income': _parse_financial_value(r.get('net_income')),
                    }

        # ─── tab_performance ───
        cur.execute("SELECT * FROM tab_performance WHERE market = 'مصر'")
        for row in cur.fetchall():
            r = dict(row)
            symbol = r.get('symbol', '')
            ticker = re.match(r'^([A-Z]+)', symbol)
            if ticker:
                t = ticker.group(1)
                if t not in result:
                    result[t] = {}
                result[t]['performance'] = {
                    'perf_1w': _parse_percentage(r.get('perf_1w')),
                    'perf_1m': _parse_percentage(r.get('perf_1m')),
                    'perf_3m': _parse_percentage(r.get('perf_3m')),
                    'perf_6m': _parse_percentage(r.get('perf_6m')),
                    'perf_1y': _parse_percentage(r.get('perf_1y')),
                }

        # ─── tab_dividends ───
        cur.execute("SELECT * FROM tab_dividends WHERE market = 'مصر'")
        for row in cur.fetchall():
            r = dict(row)
            symbol = r.get('symbol', '')
            ticker = re.match(r'^([A-Z]+)', symbol)
            if ticker:
                t = ticker.group(1)
                if t not in result:
                    result[t] = {}
                result[t]['dividends'] = {
                    'div_yield': _parse_percentage(r.get('div_yield')),
                    'div_yield_fwd': _parse_percentage(r.get('div_yield_fwd')),
                    'payout_ratio': _parse_percentage(r.get('payout_ratio')),
                    'dps_growth': _parse_percentage(r.get('dps_growth')),
                }

        conn.close()

    except Exception as e:
        print(f"[PersonaScreener] خطأ في تحميل البيانات الأساسية: {e}")

    _cache['fundamentals'] = result
    _cache['fundamentals_ts'] = now
    return result


# ═══════════════════════════════════════════════════════════
#  قراءة البيانات التقنية من price_history.db
# ═══════════════════════════════════════════════════════════

def _load_price_history(ticker: str, days: int = 60) -> List[Dict[str, Any]]:
    """تحميل آخر N يوم من بيانات السعر لسهم معين."""
    try:
        if not os.path.exists(PRICE_HISTORY_DB):
            return []

        conn = sqlite3.connect(PRICE_HISTORY_DB)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute('''
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ?
            ORDER BY date DESC
            LIMIT ?
        ''', (ticker.upper(), days))
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        return rows

    except Exception:
        return []


def _compute_sma(prices: List[float], period: int) -> float:
    """حساب المتوسط المتحرك البسيط (SMA).

    BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.sma.
    Keeps backward-compat fallback (0.0) on insufficient data.

    Note: caller passes prices in DESC order (latest first); canonical sma
    expects latest at the end — so we reverse before delegating.
    """
    if len(prices) < period:
        return 0.0
    sma_val = _canonical_sma(list(reversed(prices)), period)
    return sma_val if sma_val is not None else 0.0


def _compute_rsi_from_prices(closes: List[float], period: int = 14) -> float:
    """
    حساب RSI من قائمة أسعار الإغلاق.
    closes: مرتبة من الأحدث للأقدم (زي ما بتيجي من DB).

    BRAVO UNIFY: delegates to canonical analyzers.indicators.rsi.calc_rsi (Wilder's smoothing).
    Keeps backward-compat fallback (0.0) on insufficient data.
    """
    if len(closes) < period + 1:
        return 0.0
    # عكس الترتيب: من الأقدم للأحدث (canonical expects latest at end)
    closes_asc = list(reversed(closes))
    rsi = _canonical_calc_rsi(closes_asc, period=period)
    return rsi if rsi is not None else 0.0


def _compute_volume_ratio(ticker: str) -> Tuple[float, float]:
    """
    حساب نسبة حجم اليوم مقارنة بمتوسط آخر 20 يوم.
    Returns: (today_volume, volume_ratio)
    """
    try:
        rows = _load_price_history(ticker, days=25)
        if not rows or len(rows) < 2:
            return 0.0, 1.0

        # today's volume (الأحدث)
        today_vol = float(rows[0].get('volume') or 0)

        # متوسط آخر 20 يوم (نبدأ من الثاني لأن الأول هو اليوم)
        recent_vols = []
        for r in rows[1:21]:
            v = float(r.get('volume') or 0)
            if v > 0:
                recent_vols.append(v)

        if not recent_vols:
            return today_vol, 1.0

        avg_vol = sum(recent_vols) / len(recent_vols)
        ratio = today_vol / avg_vol if avg_vol > 0 else 1.0
        return today_vol, round(ratio, 2)

    except Exception:
        return 0.0, 1.0


# ═══════════════════════════════════════════════════════════
#  Piotroski F-Score — حساب مبسط
# ═══════════════════════════════════════════════════════════

def _calculate_piotroski(
    stock: Dict[str, Any],
    fundamentals: Dict[str, Any],
) -> float:
    """
    حساب Piotroski F-Score مبسط (0-9).

    المعايير التسعة:
    1. ROA > 0 (+1)
    2. Operating Cash Flow > 0 (+1)
    3. ROA current > ROA prior (+1) — نقدرها من ROE trend
    4. Operating CF > Net Income (accruals) (+1)
    5. Long-term debt ratio decrease (+1) — نقدرها من debt_to_equity
    6. Current ratio increase (+1) — من current_ratio
    7. Shares outstanding decrease or same (+1) — صعب نحسبها، بنفترض +0.5
    8. Gross margin increase (+1) — من profitability data
    9. Asset turnover increase (+1) — نقدرها من revenue / total_assets

    لو البيانات ناقصة، بنحسب اللي نقدر عليه فقط.
    """
    score = 0.0

    # ─── 1. ROA > 0 ───
    roa = _safe_float(stock.get('roa'), default=None)
    if roa is None:
        # جرب من fundamentals
        prof = fundamentals.get('profitability', {})
        roa = prof.get('roa', None)
    if roa is not None and roa > 0:
        score += 1

    # ─── 2. Operating Cash Flow > 0 ───
    cf = fundamentals.get('cash_flow', {})
    operating_cf = cf.get('operating_cf', 0)
    if operating_cf > 0:
        score += 1

    # ─── 3. ROA current > ROA prior (estimated from ROE) ───
    # مفيش بيانات سابقة مباشرة، لكن لو ROE كويس (أكتر من 10%) بنعتبره إيجابي
    roe = _safe_float(stock.get('roe'), default=None)
    if roe is None:
        prof = fundamentals.get('profitability', {})
        roe = prof.get('roe', None)
    if roe is not None and roe > 10:
        score += 1

    # ─── 4. Operating CF > Net Income (quality of earnings) ───
    net_income = 0
    inc = fundamentals.get('income', {})
    net_income = inc.get('net_income', 0)
    if operating_cf > 0 and net_income > 0 and operating_cf > net_income:
        score += 1
    elif operating_cf > 0 and net_income <= 0:
        # لو الـ CF إيجابي بس الـ Net Income سالب = مش كويس
        pass

    # ─── 5. Long-term debt ratio decrease ───
    # بنستخدم debt_to_equity كمؤشر — لو أقل من 1.0 = كويس
    dte = _safe_float(stock.get('debt_to_equity'), default=None)
    if dte is not None and 0 < dte < 1.0:
        score += 1

    # ─── 6. Current ratio increase ───
    # لو current_ratio > 1.5 = كويس
    cr = _safe_float(stock.get('current_ratio'), default=None)
    bs = fundamentals.get('balance_sheet', {})
    if cr is None:
        ca = bs.get('current_assets', 0)
        cl = bs.get('current_liabilities', 0)
        if ca > 0 and cl > 0:
            cr = ca / cl
    if cr is not None and cr > 1.5:
        score += 1

    # ─── 7. Shares outstanding same or decrease ───
    # صعب نحسبها بدون بيانات تاريخية — بنفترض 0.5 (محايد)
    shares = bs.get('shares_outstanding', 0)
    if shares > 0:
        # لو فيه shares data بندي نص نقطة (محايد)
        score += 0.5
    else:
        # مفيش بيانات = محايد
        score += 0.5

    # ─── 8. Gross margin increase ───
    # لو gross_margin كويس (أكتر من 30%) بنعتبره إيجابي
    prof = fundamentals.get('profitability', {})
    gm = prof.get('gross_margin', 0)
    if gm > 0:
        # بنستخدم القيمة المطلقة — لو موجب بنعتبره كويس
        if gm > 20:
            score += 1
        elif gm > 0:
            score += 0.5
    else:
        # لو مفيش gross_margin، بنشوف operating_margin أو net_margin
        om = prof.get('operating_margin', 0)
        nm = prof.get('net_margin', 0)
        if om > 15 or nm > 10:
            score += 1

    # ─── 9. Asset turnover increase ───
    # revenue / total_assets — لو > 0.5 = كويس
    inc = fundamentals.get('income', {})
    revenue = inc.get('revenue', 0)
    total_assets = bs.get('total_assets', 0)
    if revenue > 0 and total_assets > 0:
        turnover = revenue / total_assets
        if turnover > 0.5:
            score += 1
        elif turnover > 0:
            score += 0.5

    return round(score, 1)


# ═══════════════════════════════════════════════════════════
#  Altman Z-Score — حساب مبسط
# ═══════════════════════════════════════════════════════════

def _calculate_altman_z(
    stock: Dict[str, Any],
    fundamentals: Dict[str, Any],
) -> float:
    """
    حساب Altman Z-Score مبسط.

    Z = 1.2×(WC/TA) + 1.4×(RE/TA) + 3.3×(EBIT/TA) + 0.6×(MC/TL) + 1.0×(Sales/TA)

    حيث:
    - WC = Working Capital = Current Assets - Current Liabilities
    - RE = Retained Earnings ≈ Total Equity - Shares Outstanding × Book Value
    - EBIT ≈ Operating Income
    - MC = Market Cap
    - TL = Total Liabilities
    - Sales = Revenue
    - TA = Total Assets

    Z > 2.99: Safe zone (آمن)
    1.81 < Z < 2.99: Grey zone (رمادي)
    Z < 1.81: Distress zone (خطر)
    """
    bs = fundamentals.get('balance_sheet', {})
    inc = fundamentals.get('income', {})
    cf = fundamentals.get('cash_flow', {})

    # Total Assets
    total_assets = bs.get('total_assets', 0)
    if total_assets <= 0:
        # محاولة تقدير من market_cap
        market_cap = _safe_float(stock.get('market_cap'), default=0)
        if market_cap > 0:
            total_assets = market_cap * 2  # تقدير تقريبي
        else:
            return 0.0

    # ─── X1 = Working Capital / Total Assets ───
    current_assets = bs.get('current_assets', 0)
    current_liabilities = bs.get('current_liabilities', 0)
    working_capital = current_assets - current_liabilities
    x1 = working_capital / total_assets if total_assets > 0 else 0

    # ─── X2 = Retained Earnings / Total Assets ───
    # تقدير: Retained Earnings ≈ Total Equity (تبسيط)
    total_equity = bs.get('total_equity', 0)
    retained_earnings = total_equity  # تبسيط
    x2 = retained_earnings / total_assets if total_assets > 0 else 0

    # ─── X3 = EBIT / Total Assets ───
    # تقدير: EBIT ≈ Operating Income من tab_income_statement
    ebit = inc.get('operating_income', 0)
    if ebit <= 0:
        # fallback: net_income + interest + tax (مش متاحة) ≈ net_income * 1.2
        net_income = inc.get('net_income', 0)
        if net_income > 0:
            ebit = net_income * 1.2
    x3 = ebit / total_assets if total_assets > 0 else 0

    # ─── X4 = Market Cap / Total Liabilities ───
    market_cap = _safe_float(stock.get('market_cap'), default=0)
    total_liabilities = bs.get('total_liabilities', 0)
    if total_liabilities <= 0:
        # fallback: تقدير من debt
        total_liabilities = bs.get('debt', 0) + current_liabilities
    x4 = market_cap / total_liabilities if total_liabilities > 0 else 0

    # ─── X5 = Sales / Total Assets ───
    sales = inc.get('revenue', 0)
    x5 = sales / total_assets if total_assets > 0 else 0

    # ─── Z-Score Calculation ───
    z = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5

    return round(z, 2)


# ═══════════════════════════════════════════════════════════
#  حساب FCF — Free Cash Flow
# ═══════════════════════════════════════════════════════════

def _check_fcf_positive(
    stock: Dict[str, Any],
    fundamentals: Dict[str, Any],
) -> Tuple[bool, float]:
    """
    فحص هل FCF إيجابي.
    Returns: (is_positive, fcf_value)
    """
    # ─── Method 1: من tab_cash_flow ───
    cf = fundamentals.get('cash_flow', {})
    free_cf = cf.get('free_cf', 0)
    if free_cf != 0:
        return free_cf > 0, free_cf

    # ─── Method 2: Operating CF - Investing CF ───
    op_cf = cf.get('operating_cf', 0)
    inv_cf = abs(cf.get('investing_cf', 0))  # investing_cf سالب عادة
    if op_cf > 0:
        estimated_fcf = op_cf - inv_cf
        return estimated_fcf > 0, estimated_fcf

    # ─── Method 3: من fcf_margin في tab_profitability ───
    prof = fundamentals.get('profitability', {})
    fcf_margin = prof.get('fcf_margin', 0)
    if fcf_margin > 0:
        return True, fcf_margin

    # ─── Method 4: تقدير من البيانات المتاحة ───
    # لو مفيش أي بيانات FCF، بنفترض إنه محايد
    return True, 0.0  # محايد — مش عقاب


# ═══════════════════════════════════════════════════════════
#  حساب Revenue Growth — نمو الإيرادات
# ═══════════════════════════════════════════════════════════

def _check_revenue_growth(
    stock: Dict[str, Any],
    fundamentals: Dict[str, Any],
) -> Tuple[bool, float]:
    """
    فحص هل Revenue Growth ≥ 0.
    Returns: (is_positive, growth_value)
    """
    # ─── Method 1: من tab_income_statement ───
    inc = fundamentals.get('income', {})
    rg = inc.get('revenue_growth', None)
    if rg is not None and rg != 0:
        return rg >= 0, rg

    # ─── Method 2: من tab_performance (perf_1y كـ تقريب) ───
    perf = fundamentals.get('performance', {})
    perf_1y = perf.get('perf_1y', None)
    if perf_1y is not None:
        return perf_1y >= 0, perf_1y

    # ─── Method 3: محايد ───
    return True, 0.0  # محايد — مش عقاب


# ═══════════════════════════════════════════════════════════
#  PersonaScreener — الكلاس الرئيسي
# ═══════════════════════════════════════════════════════════

class PersonaScreener:
    """
    شاشة فرز الأسهم حسب الشخصية.
    المستثمر والمغامر كل واحد ليه فلاتر صارمة مختلفة
    عشان يطلعوا قوائم مختلفة فعلاً.
    
    تحسين مهم (v1.1): قبل ما نحسب مؤشرات غالية (price_history لكل سهم)،
    بنعمل pre-filter باستخدام البيانات اللي أصلاً موجودة في stocks.db.
    ده بيقلل عدد الأسهم اللي بنحسبلها price_history من ~200 لـ ~5-10.
    """

    def __init__(self, market: str = None):
        """تهيئة الـ Screener."""
        self._stock_list: Optional[List[Dict]] = None
        self._fundamentals: Optional[Dict[str, Dict]] = None
        self._market = market
        # كاش لبيانات price_history عشان نحملها مرة واحدة بس
        self._price_history_cache: Dict[str, List[Dict]] = {}

    def _ensure_data(self) -> None:
        """تحميل البيانات لو مش محملة."""
        if self._stock_list is None:
            self._stock_list = _load_all_stocks(self._market)
            tickers = [s['ticker'] for s in self._stock_list]
            self._fundamentals = _load_fundamentals_batch(tickers)

    def _get_price_history(self, ticker: str, days: int = 60) -> List[Dict[str, Any]]:
        """تحميل price_history مع كاش — كل ticker بيتحمل مرة واحدة بس.

        PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
        ملاحظة: بنحافظ على نفس الـ return format (close_price/high_price/...)
        ونفس الترتيب (DESC = الأحدث أول) عشان الـ callers جوّه الملف بيتوقعوا
        rows[0] = أحدث يوم.
        """
        cache_key = f"{ticker}_{days}"
        if cache_key not in self._price_history_cache:
            # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth
            from data.prices import load_price_history
            # load_price_history returns oldest-first with keys {close, high, low, ...}.
            # Callers هنا بيتوقعوا newest-first + close_price/high_price/... (legacy keys).
            # فعكسنا الترتيب واعملنا mapping للـ keys.
            history = load_price_history(ticker, limit=days)
            mapped = [
                {
                    'date': r.get('date'),
                    'open_price': r.get('open'),
                    'high_price': r.get('high'),
                    'low_price': r.get('low'),
                    'close_price': r.get('close'),
                    'volume': r.get('volume'),
                }
                for r in history
            ]
            mapped.reverse()  # newest first (callers use rows[0] as today)
            self._price_history_cache[cache_key] = mapped
        return self._price_history_cache.get(cache_key, [])

    # ═══════════════════════════════════════════════════════
    #  PRE-FILTER — فلتر مبدئي رخيص (من stocks.db بس)
    # ═══════════════════════════════════════════════════════

    def _prefilter_investor(self, stock: Dict[str, Any]) -> bool:
        """
        فلتر مبدئي للمستثمر — بيتحقق من بيانات موجودة في stocks.db.
        لو السهم فشل هنا، مش محتاجين نحسب Piotroski ولا Altman Z.
        
        الشروط المبدئية (رخيصة — من columns في stocks.db):
        - ROE > 0 (أساس الاستثمار)
        - profit_margin > 0 أو ROA > 0
        - current_ratio > 0.5 (مش ميت ماليًا)
        - volume > 100000 (في سيولة)
        """
        # ROE
        roe = _safe_float(stock.get('roe'), default=0)
        if roe <= 0:
            return False
        
        # Volume (سيولة)
        volume = _safe_float(stock.get('volume'), default=0)
        avg_volume = _safe_float(stock.get('avg_volume'), default=0)
        effective_volume = max(volume, avg_volume)
        if effective_volume < 100000:
            return False
        
        # Current Ratio (مش ميت ماليًا)
        cr = _safe_float(stock.get('current_ratio'), default=0)
        if cr > 0 and cr < 0.5:
            return False
        
        # ROA or profit_margin (واحد على الأقل إيجابي)
        roa = _safe_float(stock.get('roa'), default=0)
        pm = _safe_float(stock.get('profit_margin'), default=0)
        if roa <= 0 and pm <= 0:
            return False
        
        return True

    def _prefilter_gambler(self, stock: Dict[str, Any]) -> bool:
        """
        فلتر مبدئي للصياد — بيتحقق من بيانات موجودة في stocks.db.
        لو السهم فشل هنا، مش محتاجين نحسب RSI من price_history.
        
        الشروط المبدئية (رخيصة):
        - RSI من stocks.db < 35 (في فرصة تشبع بيعي)
          (لو RSI مش موجود في DB = 0، بنفترض إنه محتاج فحص أعمق)
        - volume > 200000 (في سيولة عالية — للمغامر محتاج سيولة)
        - change_percent ≠ 0 (في حركة سعر)
        """
        # RSI من stocks.db
        rsi = _safe_float(stock.get('rsi'), default=0)
        if rsi > 35:
            # RSI أعلى من 35 → مش تشبع بيعي → ارفض
            return False
        # لو RSI = 0 (مش موجود في DB) → بنفترض محتاج فحص أعمق → بنخليه يعدّي
        
        # Volume (سيولة عالية — للمغامر لازم في حجم كبير)
        volume = _safe_float(stock.get('volume'), default=0)
        avg_volume = _safe_float(stock.get('avg_volume'), default=0)
        effective_volume = max(volume, avg_volume)
        if effective_volume < 200000:
            return False
        
        # Change percent (في حركة سعر)
        change = _safe_float(stock.get('change_percent'), default=0)
        # لو التغير صفر تمامًا، مش مهم للمغامر
        if change == 0 and rsi == 0:
            return False
        
        return True

    # ═══════════════════════════════════════════════════════
    #  Investor Screener — شاشة المستثمر
    # ═══════════════════════════════════════════════════════

    def screen_investor(self, limit: int = 10, market: str = None) -> List[Dict[str, Any]]:
        """
        فرز أسهم المستثمر.

        Hard Filters (لازم تعدّي الكل):
        - Piotroski Score ≥ 6
        - Altman Z-Score > 1.1
        - FCF > 0
        - Revenue Growth ≥ 0

        لو مفيش بيانات كافية للفلاتر الصارمة → fallback على
        analyze_investor بشرط Score ≥ 40.

        Returns: List[Dict] مرتبة بالـ score (الأعلى أول)
        """
        if market:
            screener = PersonaScreener(market=market)
            return screener.screen_investor(limit=limit, market=market)
        
        self._ensure_data()
        if not self._stock_list:
            return []

        results: List[Dict[str, Any]] = []

        for stock in self._stock_list:
            ticker = stock.get('ticker', '')
            if not ticker:
                continue

            current_price = _safe_float(stock.get('current_price'), default=0)
            if current_price <= 0:
                continue

            # ─── PRE-FILTER: فلتر مبدئي رخيص من stocks.db ───
            if not self._prefilter_investor(stock):
                continue

            fundamentals = (self._fundamentals or {}).get(ticker, {})

            # ─── حساب المؤشرات ───
            piotroski = _calculate_piotroski(stock, fundamentals)
            altman_z = _calculate_altman_z(stock, fundamentals)
            fcf_positive, fcf_value = _check_fcf_positive(stock, fundamentals)
            rev_growth_ok, rev_growth = _check_revenue_growth(stock, fundamentals)

            # ─── Hard Filter Check ───
            hard_filter_pass = True
            hard_filter_reasons: List[str] = []

            if piotroski < 6:
                hard_filter_pass = False
                hard_filter_reasons.append(f'Piotroski {piotroski:.1f} < 6')

            if altman_z <= 1.1:
                hard_filter_pass = False
                hard_filter_reasons.append(f'Altman Z {altman_z:.2f} ≤ 1.1')

            if not fcf_positive:
                hard_filter_pass = False
                hard_filter_reasons.append(f'FCF سالب ({fcf_value:.2f})')

            if not rev_growth_ok:
                hard_filter_pass = False
                hard_filter_reasons.append(f'Revenue Growth سالب ({rev_growth:.2f}%)')

            # ─── لو عدّى الفلاتر الصارمة ───
            if hard_filter_pass:
                result = self._build_investor_result(
                    stock, fundamentals, piotroski, altman_z, fcf_value, rev_growth,
                    passed_hard_filter=True,
                )
                if result:
                    results.append(result)
                continue

            # ─── Fallback: شغّل analyze_investor وشوف Score ───
            # حد أقصى لعدد fallback analyses لحماية الذاكرة
            if len(results) >= limit:
                break
            investor_result = self._run_investor_analysis(ticker, stock)
            if investor_result and investor_result.score >= 40:
                result = self._build_investor_result(
                    stock, fundamentals, piotroski, altman_z, fcf_value, rev_growth,
                    passed_hard_filter=False,
                    investor_result=investor_result,
                )
                if result:
                    results.append(result)

        results.sort(key=lambda x: x.get('score', 0), reverse=True)
        return results[:limit]

    def _build_investor_result(
        self,
        stock: Dict[str, Any],
        fundamentals: Dict[str, Any],
        piotroski: float,
        altman_z: float,
        fcf_value: float,
        rev_growth: float,
        passed_hard_filter: bool,
        fallback_result: Optional[InvestorResult] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        بناء نتيجة المستثمر الكاملة.
        """
        ticker = stock.get('ticker', '')
        current_price = _safe_float(stock.get('current_price'), default=0)
        if current_price <= 0:
            return None

        # ─── لو عدّى الفلاتر الصارمة — نحسب score من المؤشرات ───
        if passed_hard_filter:
            score = self._compute_investor_score_from_filters(
                piotroski, altman_z, fcf_value, rev_growth, stock, fundamentals,
            )
        else:
            # Fallback score من analyze_investor
            if fallback_result is None:
                return None
            score = fallback_result.score

        # ─── تحديد verdict ───
        if score >= 60:
            verdict = 'شراء قوي'
            signal = 'BUY'
        elif score >= 40:
            verdict = 'شراء'
            signal = 'BUY'
        else:
            # لو مش BUY خلاص — مش هيتضيف
            return None

        # ─── حساب entry/target/stop من S/R ───
        entry = round(current_price, 2)
        target, stop, rr = self._compute_target_stop_rr(
            ticker, current_price, persona='investor',
        )

        # لو الـ R/R ضعيف — مش فرصة للمستثمر
        if target and stop and rr is not None and rr < 2.0:
            # لو عدّى الفلاتر الصارمة بس R/R ضعيف — نخفض الـ verdict
            if passed_hard_filter:
                verdict = 'شراء'
            else:
                return None

        # ─── بناء reason ───
        reason = self._build_investor_reason(
            passed_hard_filter, piotroski, altman_z, fcf_value, rev_growth, score,
        )

        # ─── بناء conditions ───
        conditions = self._build_investor_conditions(
            stock, fundamentals, piotroski, altman_z, fcf_value, rev_growth,
            passed_hard_filter,
        )

        # ─── Fundamentals dict ───
        pe_ratio = _safe_float(stock.get('pe_ratio'), default=0)
        if pe_ratio <= 0:
            val = fundamentals.get('valuation', {})
            pe_ratio = val.get('pe_ratio', 0)

        pb_ratio = _safe_float(stock.get('pb_ratio'), default=0)
        if pb_ratio <= 0:
            val = fundamentals.get('valuation', {})
            pb_ratio = val.get('pb_ratio', 0)

        roe = _safe_float(stock.get('roe'), default=0)
        if roe <= 0:
            prof = fundamentals.get('profitability', {})
            roe = prof.get('roe', 0)

        dividend_yield = _safe_float(stock.get('dividend_yield'), default=0)
        if dividend_yield <= 0:
            div = fundamentals.get('dividends', {})
            dividend_yield = div.get('div_yield', 0)

        fcf_margin = 0.0
        prof = fundamentals.get('profitability', {})
        fcf_margin = prof.get('fcf_margin', 0)

        return {
            'ticker': ticker,
            'name': stock.get('name_ar') or stock.get('name') or ticker,
            'sector': stock.get('sector') or '',
            'current_price': current_price,
            'score': round(score, 1),
            'verdict': verdict,
            'signal': signal,
            'entry': entry,
            'target': target,
            'stop': stop,
            'rr': rr,
            'timeframe': '6-12 شهر',
            'reason': reason,
            'conditions': conditions,
            'fundamentals': {
                'pe_ratio': round(pe_ratio, 2),
                'pb_ratio': round(pb_ratio, 2),
                'roe': round(roe, 2),
                'dividend_yield': round(dividend_yield, 2),
                'fcf_margin': round(fcf_margin, 2),
                'piotroski': round(piotroski, 1),
                'altman_z': round(altman_z, 2),
                'revenue_growth': round(rev_growth, 2),
            },
        }

    def _compute_investor_score_from_filters(
        self,
        piotroski: float,
        altman_z: float,
        fcf_value: float,
        rev_growth: float,
        stock: Dict[str, Any],
        fundamentals: Dict[str, Any],
    ) -> float:
        """حساب score المستثمر من مؤشرات الفلاتر الصارمة."""
        score = 0.0

        # ─── Piotroski (0-9) → score component ───
        if piotroski >= 8:
            score += 25
        elif piotroski >= 6:
            score += 18
        elif piotroski >= 4:
            score += 8

        # ─── Altman Z ───
        if altman_z > 2.99:
            score += 20  # Safe zone
        elif altman_z > 1.81:
            score += 12  # Grey zone
        elif altman_z > 1.1:
            score += 5   # Barely above distress

        # ─── FCF ───
        if fcf_value > 0:
            score += 15

        # ─── Revenue Growth ───
        if rev_growth > 20:
            score += 15
        elif rev_growth > 10:
            score += 10
        elif rev_growth >= 0:
            score += 5

        # ─── Bonus: ROE ───
        roe = _safe_float(stock.get('roe'), default=0)
        if roe <= 0:
            prof = fundamentals.get('profitability', {})
            roe = prof.get('roe', 0)
        if roe >= 20:
            score += 10
        elif roe >= 15:
            score += 6

        # ─── Bonus: Dividend Yield ───
        dy = _safe_float(stock.get('dividend_yield'), default=0)
        if dy >= 5:
            score += 8
        elif dy >= 3:
            score += 4

        # ─── Bonus: P/B ───
        pb = _safe_float(stock.get('pb_ratio'), default=0)
        if 0 < pb < 1.0:
            score += 8
        elif 0 < pb < 1.5:
            score += 4

        return _clamp(score, 0, 100)

    def _build_investor_reason(
        self,
        passed_hard_filter: bool,
        piotroski: float,
        altman_z: float,
        fcf_value: float,
        rev_growth: float,
        score: float,
    ) -> str:
        """بناء سبب التوصية بالعربي."""
        if passed_hard_filter:
            parts = []
            if piotroski >= 7:
                parts.append('أساسيات قوية (Piotroski عالي)')
            elif piotroski >= 6:
                parts.append('أساسيات كويسة')
            if altman_z > 2.99:
                parts.append('شركة مستقرة ماليًا')
            elif altman_z > 1.81:
                parts.append('استقرار مالي متوسط')
            if fcf_value > 0:
                parts.append('تدفقات نقدية حرة إيجابية')
            if rev_growth > 10:
                parts.append(f'نمو إيرادات {rev_growth:.1f}%')
            elif rev_growth >= 0:
                parts.append('إيرادات مستقرة')
            return ' — '.join(parts) if parts else 'السهم جتاز الفلاتر الصارمة للمستثمر.'
        else:
            return 'السهم فيه مؤشرات إيجابية كافية رغم نقص بعض البيانات.'

    def _build_investor_conditions(
        self,
        stock: Dict[str, Any],
        fundamentals: Dict[str, Any],
        piotroski: float,
        altman_z: float,
        fcf_value: float,
        rev_growth: float,
        passed_hard_filter: bool,
    ) -> List[str]:
        """بناء قائمة الشروط بالعربي."""
        conditions: List[str] = []

        if passed_hard_filter:
            conditions.append(f'✅ Piotroski {piotroski:.1f}/9')
        else:
            conditions.append(f'⚠️ Piotroski {piotroski:.1f}/9 (فلاتر صارمة: مش معدّي)')

        if altman_z > 2.99:
            conditions.append(f'✅ Altman Z {altman_z:.2f} (منطقة آمنة)')
        elif altman_z > 1.81:
            conditions.append(f'⚠️ Altman Z {altman_z:.2f} (منطقة رمادية)')
        else:
            conditions.append(f'❌ Altman Z {altman_z:.2f} (منطقة خطر)')

        if fcf_value > 0:
            conditions.append(f'✅ FCF إيجابي ({fcf_value:.2f})')
        else:
            conditions.append(f'❌ FCF سالب ({fcf_value:.2f})')

        if rev_growth >= 0:
            conditions.append(f'✅ Revenue Growth {rev_growth:.1f}%')
        else:
            conditions.append(f'❌ Revenue Growth {rev_growth:.1f}%')

        # إضافة شروط من fundamentals
        roe = _safe_float(stock.get('roe'), default=0)
        if roe >= 15:
            conditions.append(f'ROE {roe:.1f}% — ربحية كويسة')

        dy = _safe_float(stock.get('dividend_yield'), default=0)
        if dy >= 5:
            conditions.append(f'توزيعات {dy:.1f}% 💰')

        pb = _safe_float(stock.get('pb_ratio'), default=0)
        if 0 < pb < 1.0:
            conditions.append(f'P/B {pb:.2f} — يتداول تحت القيمة الدفترية')

        return conditions

    # ═══════════════════════════════════════════════════════
    #  Gambler Screener — شاشة المغامر
    # ═══════════════════════════════════════════════════════

    def screen_gambler(self, limit: int = 15, market: str = None) -> List[Dict[str, Any]]:
        """
        فرز أسهم المغامر.

        Hard Filters (لازم تعدّي الكل):
        - RSI < 30 (تشبع بيعي — oversold)
        - Volume Spike: today's volume ≥ 1.5x average
        - Above SMA20: current_price > SMA20
        - R/R > 1.5: potential reward/risk ratio

        لو مفيش بيانات كافية للفلاتر الصارمة → fallback على
        analyze_gambler بشرط Score ≥ 50.

        Returns: List[Dict] مرتبة بالـ score (الأعلى أول)
        """
        if market:
            screener = PersonaScreener(market=market)
            return screener.screen_gambler(limit=limit, market=market)
        
        self._ensure_data()
        if not self._stock_list:
            return []

        # مسح كاش price_history عشان نضمن بيانات جديدة
        self._price_history_cache.clear()

        results: List[Dict[str, Any]] = []

        for stock in self._stock_list:
            ticker = stock.get('ticker', '')
            if not ticker:
                continue

            current_price = _safe_float(stock.get('current_price'), default=0)
            if current_price <= 0:
                continue

            # ─── PRE-FILTER: فلتر مبدئي رخيص من stocks.db ───
            if not self._prefilter_gambler(stock):
                continue

            # ─── حساب المؤشرات التقنية ───
            rsi = self._compute_rsi_for_stock(ticker, stock)
            today_vol, volume_ratio = self._compute_volume_ratio_cached(ticker)
            sma20, sma50 = self._compute_sma_for_stock(ticker, stock)
            above_sma20 = current_price > sma20 if sma20 > 0 else False

            # ─── S/R for R/R calculation ───
            sr = self._compute_sr_rr(ticker, current_price)
            support = sr.get('support', 0)
            resistance = sr.get('resistance', 0)
            rr = sr.get('rr', None)

            # ─── Hard Filter Check ───
            hard_filter_pass = True
            hard_filter_reasons: List[str] = []

            if rsi <= 0 or rsi >= 30:
                if rsi <= 0:
                    # مفيش RSI → مش عدّى الفلتر (مفيش بيانات)
                    hard_filter_pass = False
                    hard_filter_reasons.append(f'RSI غير متاح')
                elif rsi >= 30:
                    hard_filter_pass = False
                    hard_filter_reasons.append(f'RSI {rsi:.1f} ≥ 30')

            if volume_ratio < 1.5:
                hard_filter_pass = False
                hard_filter_reasons.append(f'Volume Ratio {volume_ratio:.1f}x < 1.5x')

            if not above_sma20:
                hard_filter_pass = False
                hard_filter_reasons.append(f'السعر تحت SMA20 ({sma20:.2f})')

            if rr is None or rr < 1.5:
                hard_filter_pass = False
                rr_str = f'{rr:.2f}' if rr is not None else 'N/A'
                hard_filter_reasons.append(f'R/R {rr_str} < 1.5')

            # ─── لو عدّى الفلاتر الصارمة ───
            if hard_filter_pass:
                result = self._build_gambler_result(
                    stock, rsi, volume_ratio, sma20, sma50,
                    above_sma20, support, resistance, rr,
                    hard_filter_reasons=hard_filter_reasons,
                    passed_hard_filter=True,
                )
                if result:
                    results.append(result)
                continue

            # ─── Fallback: شغّل analyze_gambler ───
            if len(results) >= limit:
                break
            gambler_result = self._run_gambler_analysis(ticker, stock)
            if gambler_result and gambler_result.score >= 50:
                result = self._build_gambler_result(
                    stock, rsi, volume_ratio, sma20, sma50,
                    above_sma20, support, resistance, rr,
                    hard_filter_reasons=hard_filter_reasons,
                    passed_hard_filter=False,
                    gambler_result=gambler_result,
                )
                if result:
                    results.append(result)

        results.sort(key=lambda x: x.get('score', 0), reverse=True)
        return results[:limit]

    def _build_gambler_result(
        self,
        stock: Dict[str, Any],
        rsi: float,
        volume_ratio: float,
        sma20: float,
        sma50: float,
        above_sma20: bool,
        support: float,
        resistance: float,
        rr: Optional[float],
        passed_hard_filter: bool,
        hard_filter_reasons: Optional[List[str]] = None,
        gambler_result: Optional[GamblerResult] = None,
    ) -> Optional[Dict[str, Any]]:
        """بناء نتيجة المغامر الكاملة."""
        ticker = stock.get('ticker', '')
        current_price = _safe_float(stock.get('current_price'), default=0)
        if current_price <= 0:
            return None

        # ─── Score ───
        if passed_hard_filter:
            score = self._compute_gambler_score_from_filters(
                rsi, volume_ratio, above_sma20, rr, stock,
            )
        else:
            if gambler_result is None:
                return None
            score = gambler_result.score

        # ─── تحديد verdict ───
        if score >= 60:
            verdict = 'شراء قوي'
            signal = 'BUY'
        elif score >= 50:
            verdict = 'شراء'
            signal = 'BUY'
        else:
            return None

        # ─── حساب entry/target/stop ───
        entry = round(current_price, 2)
        if passed_hard_filter and support > 0 and resistance > 0:
            stop = round(support * 0.98, 2)
            target = round(resistance, 2)
            if rr is None:
                risk = current_price - stop
                reward = target - current_price
                rr = round(reward / risk, 2) if risk > 0 else 0
                # Rule 54: استخدم canonical compute_risk_reward
                try:
                    from utils.risk_reward import compute_risk_reward
                    rr = compute_risk_reward(current_price, target, stop, fallback=rr)
                except Exception:
                    pass  # keep inline rr computed above
        elif gambler_result and gambler_result.entry:
            stop = gambler_result.stop
            target = gambler_result.target
            rr = gambler_result.rr
        elif gambler_result and gambler_result.entry:
            stop = gambler_result.stop
            target = gambler_result.target
            rr = gambler_result.rr
        else:
            stop = round(current_price * 0.92, 2)
            target = round(current_price * 1.08, 2)
            rr = round((target - current_price) / (current_price - stop), 2) if (current_price - stop) > 0 else 0
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                rr = compute_risk_reward(current_price, target, stop, fallback=rr)
            except Exception:
                pass  # keep inline rr computed above

        # ─── Reason ───
        reason = self._build_gambler_reason(
            passed_hard_filter, rsi, volume_ratio, above_sma20, rr,
        )

        # ─── Conditions ───
        conditions = self._build_gambler_conditions(
            rsi, volume_ratio, sma20, sma50, above_sma20, support, resistance, rr,
            passed_hard_filter,
        )

        return {
            'ticker': ticker,
            'name': stock.get('name_ar') or stock.get('name') or ticker,
            'sector': stock.get('sector') or '',
            'current_price': current_price,
            'score': round(score, 1),
            'verdict': verdict,
            'signal': signal,
            'entry': entry,
            'target': target,
            'stop': stop,
            'rr': rr,
            'timeframe': 'يومي-أسبوعي',
            'reason': reason,
            'conditions': conditions,
            'technicals': {
                'rsi': round(rsi, 2),
                'volume_ratio': round(volume_ratio, 2),
                'sma20': round(sma20, 2),
                'sma50': round(sma50, 2),
                'above_sma20': above_sma20,
                'support': round(support, 2),
                'resistance': round(resistance, 2),
            },
        }

    def _compute_gambler_score_from_filters(
        self,
        rsi: float,
        volume_ratio: float,
        above_sma20: bool,
        rr: Optional[float],
        stock: Dict[str, Any],
    ) -> float:
        """حساب score المغامر من مؤشرات الفلاتر الصارمة."""
        score = 0.0

        # ─── RSI (تشبع بيعي = فرصة) ───
        if 0 < rsi < 20:
            score += 30  # تشبع بيعي حاد جداً
        elif 0 < rsi < 25:
            score += 25
        elif 0 < rsi < 30:
            score += 20  # تشبع بيعي

        # ─── Volume Spike ───
        if volume_ratio >= 3.0:
            score += 25  # السيولة ولعت
        elif volume_ratio >= 2.0:
            score += 20
        elif volume_ratio >= 1.5:
            score += 15

        # ─── Above SMA20 ───
        if above_sma20:
            score += 15

        # ─── R/R ───
        if rr is not None:
            if rr >= 3.0:
                score += 20
            elif rr >= 2.0:
                score += 15
            elif rr >= 1.5:
                score += 10

        # ─── Bonus: price momentum ───
        change = _safe_float(stock.get('change_percent'), default=0)
        if abs(change) >= 5:
            score += 8  # حركة قوية

        return _clamp(score, 0, 100)

    def _build_gambler_reason(
        self,
        passed_hard_filter: bool,
        rsi: float,
        volume_ratio: float,
        above_sma20: bool,
        rr: Optional[float],
    ) -> str:
        """بناء سبب التوصية بالعربي للمغامر."""
        if passed_hard_filter:
            parts = []
            if 0 < rsi < 20:
                parts.append('تشبع بيعي حاد (RSI تحت 20) — السهم ناضي جداً')
            elif 0 < rsi < 30:
                parts.append(f'تشبع بيعي (RSI {rsi:.0f}) — فرصة ارتداد')
            if volume_ratio >= 2.0:
                parts.append(f'السيولة ولعت ({volume_ratio:.1f}x) 🔥')
            elif volume_ratio >= 1.5:
                parts.append(f'سيولة مرتفعة ({volume_ratio:.1f}x)')
            if above_sma20:
                parts.append('فوق SMA20 — زخم إيجابي')
            if rr and rr >= 2.0:
                parts.append(f'R/R ممتاز ({rr:.2f}:1)')
            elif rr and rr >= 1.5:
                parts.append(f'R/R كويس ({rr:.2f}:1)')
            return ' — '.join(parts) if parts else 'السهم جتاز الفلاتر الصارمة للمغامر.'
        else:
            return 'السهم فيه إشارات مغامرة قوية رغم عدم اجتياز كل الفلاتر.'

    def _build_gambler_conditions(
        self,
        rsi: float,
        volume_ratio: float,
        sma20: float,
        sma50: float,
        above_sma20: bool,
        support: float,
        resistance: float,
        rr: Optional[float],
        passed_hard_filter: bool,
    ) -> List[str]:
        """بناء قائمة شروط المغامر."""
        conditions: List[str] = []

        # ─── RSI ───
        if 0 < rsi < 30:
            conditions.append(f'✅ RSI {rsi:.1f} — تشبع بيعي (فرصة شراء)')
        elif 30 <= rsi < 40:
            conditions.append(f'⚠️ RSI {rsi:.1f} — قرب التشبع البيعي')
        elif rsi >= 70:
            conditions.append(f'❌ RSI {rsi:.1f} — تشبع شرائي')
        else:
            conditions.append(f'RSI {rsi:.1f}')

        # ─── Volume ───
        if volume_ratio >= 2.0:
            conditions.append(f'✅ Volume {volume_ratio:.1f}x — السيولة ولعت 🔥')
        elif volume_ratio >= 1.5:
            conditions.append(f'✅ Volume {volume_ratio:.1f}x — سيولة مرتفعة')
        else:
            conditions.append(f'❌ Volume {volume_ratio:.1f}x — سيولة عادية')

        # ─── SMA ───
        if above_sma20:
            conditions.append(f'✅ فوق SMA20 ({sma20:.2f})')
        else:
            conditions.append(f'❌ تحت SMA20 ({sma20:.2f})')

        # ─── R/R ───
        if rr is not None:
            if rr >= 2.0:
                conditions.append(f'✅ R/R {rr:.2f}:1 — ممتاز')
            elif rr >= 1.5:
                conditions.append(f'✅ R/R {rr:.2f}:1 — كويس')
            else:
                conditions.append(f'❌ R/R {rr:.2f}:1 — ضعيف')

        # ─── S/R ───
        if support > 0:
            conditions.append(f'دعم {support:.2f}')
        if resistance > 0:
            conditions.append(f'مقاومة {resistance:.2f}')

        return conditions

    # ═══════════════════════════════════════════════════════
    #  Helper Methods — أدوات مساعدة
    # ═══════════════════════════════════════════════════════

    def _compute_rsi_for_stock(self, ticker: str, stock: Dict[str, Any]) -> float:
        """حساب RSI للسهم — من stocks.db أو من price_history (مع كاش).

        BRAVO UNIFY: transitively delegates to canonical analyzers.indicators.rsi.calc_rsi
        via _compute_rsi_from_prices (Wilder's smoothing). Keeps backward-compat
        fallback (0.0) on insufficient data.
        """
        # ─── Method 1: من stocks.db ───
        rsi = _safe_float(stock.get('rsi'), default=0)
        if rsi > 0:
            return rsi

        # ─── Method 2: حساب من price_history (مع كاش) ───
        try:
            rows = self._get_price_history(ticker, days=30)
            if len(rows) >= 15:
                closes = [float(r.get('close_price') or 0) for r in rows
                          if float(r.get('close_price') or 0) > 0]
                return _compute_rsi_from_prices(closes, period=14)
        except Exception:
            pass

        return 0.0

    def _compute_volume_ratio_cached(self, ticker: str) -> Tuple[float, float]:
        """حساب نسبة الحجم — باستخدام price_history cache."""
        try:
            rows = self._get_price_history(ticker, days=25)
            if not rows or len(rows) < 2:
                return 0.0, 1.0

            # today's volume (الأحدث)
            today_vol = float(rows[0].get('volume') or 0)

            # متوسط آخر 20 يوم
            recent_vols = []
            for r in rows[1:21]:
                v = float(r.get('volume') or 0)
                if v > 0:
                    recent_vols.append(v)

            if not recent_vols:
                return today_vol, 1.0

            avg_vol = sum(recent_vols) / len(recent_vols)
            ratio = today_vol / avg_vol if avg_vol > 0 else 1.0
            return today_vol, round(ratio, 2)

        except Exception:
            return 0.0, 1.0

    def _compute_sma_for_stock(
        self, ticker: str, stock: Dict[str, Any],
    ) -> Tuple[float, float]:
        """حساب SMA20 و SMA50 — من price_history (مع كاش).

        BRAVO UNIFY: transitively delegates to canonical analyzers.indicators.ma.sma
        via _compute_sma. Keeps backward-compat fallback (0.0) on insufficient data.
        """
        try:
            rows = self._get_price_history(ticker, days=60)
            if rows:
                closes = [float(r.get('close_price') or 0) for r in rows
                          if float(r.get('close_price') or 0) > 0]
                sma20 = _compute_sma(closes, 20) if len(closes) >= 20 else 0
                sma50 = _compute_sma(closes, 50) if len(closes) >= 50 else 0

                # Fallback على stocks.db MA values
                if sma20 <= 0:
                    sma20 = _safe_float(stock.get('ma_50'), default=0)
                if sma50 <= 0:
                    sma50 = _safe_float(stock.get('ma_50'), default=0)

                return sma20, sma50
        except Exception:
            pass

        # Fallback من stocks.db
        sma50 = _safe_float(stock.get('ma_50'), default=0)
        return 0.0, sma50

    def _compute_sr_rr(
        self, ticker: str, current_price: float,
    ) -> Dict[str, Any]:
        """حساب الدعم/المقاومة و R/R — بيقبل بيانات قديمة كمان."""
        result: Dict[str, Any] = {
            'support': 0.0,
            'resistance': 0.0,
            'rr': None,
        }
        try:
            sr = calculate_support_resistance(ticker)
            # نقبل بيانات قديمة كمان — مش لازم تكون fresh
            if sr and sr.get('levels_count', 0) > 0:
                support = sr.get('support', 0)
                resistance = sr.get('resistance', 0)
                result['support'] = support
                result['resistance'] = resistance

                # حساب R/R
                if support > 0 and resistance > 0 and current_price > 0:
                    stop = support * 0.98
                    target = resistance
                    risk = current_price - stop
                    reward = target - current_price
                    if risk > 0:
                        result['rr'] = round(reward / risk, 2)
                        # Rule 54: استخدم canonical compute_risk_reward
                        try:
                            from utils.risk_reward import compute_risk_reward
                            result['rr'] = compute_risk_reward(current_price, target, stop, fallback=result['rr'])
                        except Exception:
                            pass  # keep inline rr computed above
        except Exception:
            pass

        return result

    def _compute_target_stop_rr(
        self, ticker: str, current_price: float, persona: str = 'investor',
    ) -> Tuple[Optional[float], Optional[float], Optional[float]]:
        """حساب target/stop/R/R للسهم — بيقبل بيانات قديمة."""
        try:
            sr = calculate_support_resistance(ticker, days=180 if persona == 'investor' else 90)
            # نقبل بيانات قديمة كمان — مش لازم تكون fresh
            if not sr or sr.get('levels_count', 0) == 0:
                # Fallback: تقدير نسبة بسيطة
                return self._compute_fallback_target_stop(current_price, persona)

            support = sr.get('support', 0)
            resistance = sr.get('resistance', 0)

            if support <= 0 and resistance <= 0:
                return self._compute_fallback_target_stop(current_price, persona)

            # Target
            if persona == 'investor':
                target = sr.get('far_resistance') or resistance or current_price * 1.15
            else:
                target = resistance or current_price * 1.08

            # Stop — لو مفيش دعم، نستخدم نسبة من السعر
            if support > 0:
                stop_buffer = 0.97 if persona == 'investor' else 0.98
                stop = round(support * stop_buffer, 2)
            else:
                stop_pct = 0.90 if persona == 'investor' else 0.92
                stop = round(current_price * stop_pct, 2)

            # R/R
            risk = current_price - stop
            reward = target - current_price
            if risk <= 0:
                return round(target, 2), stop, None

            rr = round(reward / risk, 2)
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                rr = compute_risk_reward(current_price, target, stop, fallback=rr)
            except Exception:
                pass  # keep inline rr computed above
            return round(target, 2), stop, rr

        except Exception:
            return self._compute_fallback_target_stop(current_price, persona)

    @staticmethod
    def _compute_fallback_target_stop(
        current_price: float, persona: str = 'investor',
    ) -> Tuple[Optional[float], Optional[float], Optional[float]]:
        """تقدير target/stop بنسبة بسيطة لو مفيش S/R."""
        if persona == 'investor':
            target = round(current_price * 1.15, 2)   # +15% target
            stop = round(current_price * 0.90, 2)     # -10% stop
        else:
            target = round(current_price * 1.08, 2)   # +8% target
            stop = round(current_price * 0.92, 2)     # -8% stop
        risk = current_price - stop
        reward = target - current_price
        rr = round(reward / risk, 2) if risk > 0 else None
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            rr = compute_risk_reward(current_price, target, stop, fallback=rr)
        except Exception:
            pass  # keep inline rr computed above
        return target, stop, rr

    def _run_investor_analysis(
        self, ticker: str, stock: Dict[str, Any],
    ) -> Optional[InvestorResult]:
        """تشغيل analyze_investor كـ fallback."""
        try:
            # بناء context بسيط
            context = {
                'time_context': {},
                'market_context': {'regime': 'SIDEWAYS'},
                'sector_context': {},
                'behavioral_context': {},
            }
            return analyze_investor(ticker, stock, context)
        except Exception:
            return None

    def _run_gambler_analysis(
        self, ticker: str, stock: Dict[str, Any],
    ) -> Optional[GamblerResult]:
        """تشغيل analyze_gambler كـ fallback."""
        try:
            # بناء context بسيط
            # screener_most_active: لو السهم في قائمة most_active → يُخفّف min_rr
            from analyzers.master_analyzer import get_screener_tags
            _screener = get_screener_tags(ticker, market=stock.get('market', ''))
            context = {
                'time_context': {},
                'market_context': {'regime': 'SIDEWAYS'},
                'sector_context': {},
                'behavioral_context': {},
                'screener_most_active': 'most_active' in _screener.get('tags', []),
            }
            return analyze_gambler(ticker, stock, context)
        except Exception:
            return None

    # ═══════════════════════════════════════════════════════
    #  Cache Management — إدارة الكاش
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def clear_cache() -> None:
        """مسح الكاش — عشان إعادة التحميل."""
        _cache['stock_list'] = None
        _cache['stock_list_ts'] = 0.0
        _cache['fundamentals'] = {}
        _cache['fundamentals_ts'] = 0.0
        _cache['technicals'] = {}
        _cache['technicals_ts'] = 0.0


# ═══════════════════════════════════════════════════════════
#  Convenience Functions — دوال سهلة للاستخدام المباشر
# ═══════════════════════════════════════════════════════════

_screener_instance: Optional[PersonaScreener] = None


def _get_screener(market: str = None) -> PersonaScreener:
    """الحصول على singleton screener instance."""
    global _screener_instance
    if _screener_instance is None or getattr(_screener_instance, '_market', None) != market:
        _screener_instance = PersonaScreener(market=market)
    return _screener_instance


def screen_investor_stocks(limit: int = 10, market: str = None) -> List[Dict[str, Any]]:
    """
    فرز أسهم المستثمر — دالة سهلة للاستخدام المباشر.
    Returns: List[Dict] مرتبة بالـ score (الأعلى أول)
    """
    return _get_screener(market=market).screen_investor(limit=limit, market=market)


def screen_gambler_stocks(limit: int = 15, market: str = None) -> List[Dict[str, Any]]:
    """
    فرز أسهم المغامر — دالة سهلة للاستخدام المباشر.
    Returns: List[Dict] مرتبة بالـ score (الأعلى أول)
    """
    return _get_screener(market=market).screen_gambler(limit=limit, market=market)


# ═══════════════════════════════════════════════════════════
#  Self-Test — اختبار ذاتي
# ═══════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("=" * 70)
    print("🧪 PersonaScreener — اختبار ذاتي")
    print("=" * 70)

    # ─── Test 1: Investor Screener ───
    print("\n📊 Test 1: Investor Screener")
    print("-" * 50)
    try:
        investor_stocks = screen_investor_stocks(limit=5)
        if investor_stocks:
            print(f"✅ لقينا {len(investor_stocks)} أسهم للمستثمر:")
            for s in investor_stocks:
                print(f"  📈 {s['ticker']} — {s['name']}")
                print(f"     Score: {s['score']} | Verdict: {s['verdict']}")
                print(f"     Entry: {s['entry']} | Target: {s['target']} | Stop: {s['stop']}")
                print(f"     R/R: {s['rr']} | Piotroski: {s['fundamentals']['piotroski']}")
                print(f"     Altman Z: {s['fundamentals']['altman_z']}")
                print()
        else:
            print("⚠️ مفيش أسهم عدّت فلاتر المستثمر — ممكن البيانات ناقصة")
    except Exception as e:
        print(f"❌ خطأ: {e}")

    # ─── Test 2: Gambler Screener ───
    print("\n🎰 Test 2: Gambler Screener")
    print("-" * 50)
    try:
        gambler_stocks = screen_gambler_stocks(limit=5)
        if gambler_stocks:
            print(f"✅ لقينا {len(gambler_stocks)} أسهم للمغامر:")
            for s in gambler_stocks:
                print(f"  🎲 {s['ticker']} — {s['name']}")
                print(f"     Score: {s['score']} | Verdict: {s['verdict']}")
                print(f"     Entry: {s['entry']} | Target: {s['target']} | Stop: {s['stop']}")
                print(f"     R/R: {s['rr']} | RSI: {s['technicals']['rsi']}")
                print(f"     Volume Ratio: {s['technicals']['volume_ratio']}x")
                print(f"     Above SMA20: {s['technicals']['above_sma20']}")
                print()
        else:
            print("⚠️ مفيش أسهم عدّت فلاتر المغامر — ممكن البيانات ناقصة")
    except Exception as e:
        print(f"❌ خطأ: {e}")

    # ─── Test 3: Utility Functions ───
    print("\n🔧 Test 3: Utility Functions")
    print("-" * 50)

    # Test _safe_float
    test_values = [
        ('57.75%', 57.75),
        ('44.02 B EGP', 44020000000),
        ('314.16 M SAR', 314160000),
        ('−5.28%', -5.28),
        ('+30.70%', 30.70),
        (None, 0.0),
        ('', 0.0),
        (42.5, 42.5),
    ]
    for val, expected in test_values:
        result = _safe_float(val)
        ok = '✅' if abs(result - expected) < 1 else '❌'
        print(f"  {ok} _safe_float({val!r}) = {result} (expected ~{expected})")

    # Test _parse_percentage
    pct_tests = [
        ('57.75%', 57.75),
        ('−5.28%', -5.28),
        (None, 0.0),
    ]
    for val, expected in pct_tests:
        result = _parse_percentage(val)
        ok = '✅' if abs(result - expected) < 0.01 else '❌'
        print(f"  {ok} _parse_percentage({val!r}) = {result} (expected {expected})")

    # ─── Test 4: Piotroski & Altman Z ───
    print("\n📈 Test 4: Piotroski & Altman Z for COMI")
    print("-" * 50)
    try:
        stocks = _load_all_stocks()
        comi = next((s for s in stocks if s['ticker'] == 'COMI'), None)
        if comi:
            fund = _load_fundamentals_batch(['COMI']).get('COMI', {})
            piotroski = _calculate_piotroski(comi, fund)
            altman_z = _calculate_altman_z(comi, fund)
            print(f"  COMI Piotroski: {piotroski}/9")
            print(f"  COMI Altman Z: {altman_z}")
        else:
            print("  ⚠️ COMI مش موجود في قائمة الأسهم")
    except Exception as e:
        print(f"  ❌ خطأ: {e}")

    print("\n" + "=" * 70)
    print("🏁 انتهى الاختبار")
    print("=" * 70)
