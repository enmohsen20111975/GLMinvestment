import os
import json
import sqlite3
from flask import Blueprint, jsonify, request
from pathlib import Path
from datetime import datetime, timedelta

# 🧠 Expert Quality Gate
try:
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from analyzers.expert_quality_gate import expert_quality_gate
    EXPERT_GATE_AVAILABLE = True
except ImportError as _expert_err:
    print(f"[stored_analysis_routes] ⚠️ Expert Quality Gate not available: {_expert_err}")
    EXPERT_GATE_AVAILABLE = False

# C1-PERSONA-OPPORTUNITY: منطق الفرص الموحّد (live filter + quality gate + investor fallback)
try:
    import sys as _sys_c1
    _sys_c1.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from core.opportunity_quality import (
        is_live_stock_strict as _c1_is_live_strict,
        is_live_stock_loose as _c1_is_live_loose,
        is_gambler_opportunity as _c1_is_gambler_opp,
        is_investor_opportunity as _c1_is_investor_opp,
        is_balanced_opportunity as _c1_is_balanced_opp,
        compute_gambler_rank_score as _c1_gambler_rank,
        compute_investor_rank_score as _c1_investor_rank,
        compute_balanced_rank_score as _c1_balanced_rank,
        compute_persona_flags as _c1_compute_persona_flags,
        # C2 — Sector Heat (دوران قطاعي للمضارب فقط)
        compute_sector_heat_map as _c2_sector_heat_map,
        apply_sector_boost_to_gambler_rank as _c2_apply_sector_boost,
        get_sector_heat_status as _c2_sector_status,
        # P6 — Sector Role (leader/mid/laggard within sector)
        classify_sector_roles as _c2_classify_sector_roles,
        apply_sector_role_to_gambler_rank as _c2_apply_sector_role,
        SECTOR_HEAT_NOTE as _C2_SECTOR_HEAT_NOTE,
        BALANCED_NOTE as _C3_BALANCED_NOTE,
        INVESTOR_FALLBACK_NOTE as _C1_INVESTOR_FALLBACK_NOTE,
        OPPORTUNITY_MIN_SCORE as _C1_OPP_MIN_SCORE,
    )
    C1_OPPORTUNITY_AVAILABLE = True
except ImportError as _c1_err:
    print(f"[stored_analysis_routes] ⚠️ opportunity_quality not available: {_c1_err}")
    C1_OPPORTUNITY_AVAILABLE = False

# Base directory dynamically resolved
BASE_DIR = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = str(BASE_DIR / 'db' / 'predictions.db')
STOCKS_DB = str(BASE_DIR / 'db' / 'stocks.db')

stored_analysis_bp = Blueprint('stored_analysis', __name__, url_prefix='/api/stored-analysis')


def _is_egx_intraday_now() -> bool:
    """هل السوق المصري مفتوح الآن (intraday session)؟

    P16-DELAY-COMPENSATION: helper لقرار تعويض تأخير البيانات 5 دقايق.
    EGX hours: الأحد-الخميس، 10:00-14:30 توقيت القاهرة (Africa/Cairo).
    بيحسب توقيت القاهرة من UTC (+2 شتاءً / +3 صيفاً DST) من غير dependency
    على pytz عشان يشتغل في أي بيئة.
    """
    try:
        from datetime import datetime, timedelta
        utc_now = datetime.utcnow()
        is_dst = 4 <= utc_now.month <= 10
        cairo_offset = 3 if is_dst else 2
        cairo_dt = utc_now + timedelta(hours=cairo_offset)
        wd = cairo_dt.weekday()  # Mon=0..Sun=6
        if wd in (4, 5):  # Fri/Sat closed
            return False
        minutes = cairo_dt.hour * 60 + cairo_dt.minute
        return 600 <= minutes < 870  # 10:00 (600) → 14:30 (870)
    except Exception:
        return False


def _get_engine_setting(key, default=None):
    """قراءة آمنة من engine_settings بدون كسر لو المشروع مش متاح.

    AXIS-7 helper: morning bell بيستخدمها لقراءة morning_bell_min_evidence
    (default=4). أي خطأ → fallback لـ default بدون crash (fail-safe).
    """
    try:
        from analyzers.engine_settings import get_setting
        val = get_setting(key, default=default if isinstance(default, (int, float)) else None)
        if val is None:
            return default
        return val
    except Exception:
        return default


# ============================================================================
# P23-PARSE-HOTFIX: parse_numeric_string() — Data Cleaning Helper
# ============================================================================
# المشكلة (إنتاجي): التوقعات بترجع فاضية بسبب:
#   ValueError: could not convert string to float: '84.32\u202fB SAR'
# السبب: TradingView و مصادر تانية بتخزن market_cap/volume كنص فيه:
#   - لاحقات وحدات: B (Billion), M (Million), K (Thousand), T (Trillion)
#   - أكواد عملات: SAR, USD, EGP, EUR, AED
#   - مسافات غريبة: U+202F (Narrow No-Break Space), U+00A0, U+200E/F (RTL marks)
#   - فواصل آلاف: ','
# الكود كان بيمرّر النص ده لـ float() مباشرة → ValueError → الـ except بياخد
# كل الـ batch → result فاضي → التوقعات فاضية.
#
# الحل: helper قوي بيorganic-ly يشفط أي نص ويرجّع رقم float صحيح.
# ============================================================================

import re as _re

# U+202F (Narrow No-Break Space), U+00A0 (No-Break Space), U+200E/F (RTL/LTR marks),
# U+202A-E (directional embedding), U+FEFF (BOM/Zero-Width No-Break Space)
_INVISIBLE_WS = _re.compile(r'[\u202f\u00a0\u200e\u200f\u202a\u202b\u202c\u202d\u202e\ufeff]')
# أكواد العملات الشائعة (بعد الأرقام) + أي حروف غير رقمية ماعدا B/M/K/T النهائية
_CURRENCY_CODES = ('SAR', 'USD', 'EGP', 'EUR', 'AED', 'GBP', 'JPY', 'CNY', 'KWD', 'QAR')


def parse_numeric_string(val) -> float:
    """حوّل نص زي '84.32\\u202fB SAR' أو '1.5M' أو '12,345.67' لرقم float.

    يدعم:
      - لاحقات المضاعفات: T=1e12, B=1e9, M=1e6, K=1e3 (case-insensitive)
      - أكواد العملات: SAR, USD, EGP, ... (بتتشال)
      - المسافات الخفية (U+202F, U+00A0, RTL/LTR marks, BOM)
      - فواصل الآلاف (',')
      - النسب المئوية: '15.3%' → 15.3
      - القيم الفاضية/None/غير الرقمية → 0.0 (بدون ما يقع)

    Args:
        val: str | int | float | None

    Returns:
        float: القيمة العددية، أو 0.0 لو المش مدخل صالح.
    """
    # Fast path: أصلًا رقم
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        try:
            return float(val)
        except (ValueError, TypeError):
            return 0.0

    # نص: نضيفه
    s = str(val).strip()
    if not s:
        return 0.0

    # شيل المسافات الخفية + العلامات الاتجاهية
    s = _INVISIBLE_WS.sub(' ', s)
    # شيل فواصل الآلاف (1,234,567 → 1234567)
    s = s.replace(',', '')
    # شيل أكواد العملات (SAR, USD, ...) — case-insensitive
    upper = s.upper()
    for code in _CURRENCY_CODES:
        upper = upper.replace(code, '')
    s = upper.strip()
    # شيل علامة النسبة المئوية
    s = s.replace('%', '').strip()

    # استخرج اللاحقة (آخر حرف B/M/K/T) والمضاعف
    multiplier = 1.0
    if s and s[-1] in ('B', 'M', 'K', 'T'):
        suffix = s[-1]
        s = s[:-1].strip()
        multiplier = {'T': 1e12, 'B': 1e9, 'M': 1e6, 'K': 1e3}[suffix]

    # شيل أي حروف متبقية (حماية إضافية — نأخذ الأرقام والنقطة والعلامة فقط)
    s = _re.sub(r'[^0-9eE+\-.]', '', s)
    if not s:
        return 0.0

    try:
        return float(s) * multiplier
    except (ValueError, TypeError):
        return 0.0


def _get_current_price(ticker: str) -> float:
    """Get the latest price for a ticker — unified via utils.live_price.get_live_price.

    تحديث سبتمبر 2026: الـ endpoint دلوقتي بـ يستخدم نفس مسار الشارت
    للحصول على السعر الحي (intraday → data_engine → stocks.egksco →
    stocks.current_price). الترقيع القديم (`previous_close × (1+change%)`)
    كان غلط لأن `previous_close` نفسه ملوّث لبعض tickers.

    Priority chain (موثّقة في utils/live_price.py):
      1. intraday.db.stock_intraday (نفس مصدر الشارت)
      2. data_engine.db.egksco_stocks.last_price (محرك البيانات الرسمي)
      3. stocks.db.egksco_stocks.last_price (mirror copy)
      4. stocks.db.stocks.current_price (مع pollution check)
    """
    try:
        from utils.live_price import get_live_price
        return get_live_price(ticker)
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"get_live_price failed for {ticker}, falling back: {e}")

    # Fallback القديم (لو utils/live_price مش متاح)
    try:
        conn = sqlite3.connect(STOCKS_DB)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        # جرّب egksco_stocks أولاً (مصدر صحيح)
        try:
            cur.execute('SELECT last_price FROM egksco_stocks WHERE symbol = ? ORDER BY last_update DESC LIMIT 1', (ticker.upper(),))
            row = cur.fetchone()
            if row and row['last_price']:
                price = float(row['last_price'])
                if price > 0:
                    conn.close()
                    return round(price, 4)
        except sqlite3.OperationalError:
            pass
        # fallback أخير: stocks.current_price (صحيح في الغالب)
        cur.execute('SELECT current_price FROM stocks WHERE ticker = ?', (ticker.upper(),))
        row = cur.fetchone()
        conn.close()
        if row and row['current_price']:
            cp = float(row['current_price'])
            if cp > 0:
                return cp
    except Exception:
        pass
    return 0.0


# ============================================================================
# P16-PERSONA-DIVERGENCE: فلترة وترتيب الأسهم بناءً على الشخصية
# ============================================================================
# المشكلة: الـ Endpoint القديم كان بيرجّع أعلى 10 أسهم بالـ maestro_score
# للاتنين البرسونا، وكل اللي بيتغيّر هو الـ verdict/signal عبر multiplier.
# النتيجة: المستثمر والمضارب شايفين نفس الأسهم. ده منطقياً غلط.
#
# الحل: لما الـ request ييجي بـ persona=gambler → نفلتر بـ volume_ratio>=1.5
# و change_1d>=2%، ونرتب بـ volatility+volume. ولما persona=investor →
# نفلتر بـ pe_ratio BETWEEN 5 AND 20، roe>=10، change_1m BETWEEN -5% AND +10%،
# ونرتب بـ fair_value_upside DESC.
#
# لو stocks.db مفيهوش change_1m مباشرة، نحسبه من stock_daily_prices (آخر 30 يوم).
# لو مفيهوش volatility، نحسبه من stdev(close_price) لآخر 20 يوم.
_STOCKS_FUNDAMENTALS_CACHE: dict = {'data': {}, 'ts': 0.0}
_STOCKS_FUNDAMENTALS_TTL = 300  # 5 دقايق


def _load_stocks_fundamentals_batch() -> dict:
    """تحميل بيانات الأسهم الأساسية والفنية دفعة واحدة من stocks.db.

    بيرجع dict: ticker → {pe_ratio, roe, change_1d, change_1m, volume,
    volume_ratio, volatility, current_price, sector, name_ar, fair_value_upside}

    النتيجة متكاشة لمدة 5 دقايق عشان نتجنب ضرب الـ DB في كل request.
    """
    import time as _time
    now = _time.time()
    if _STOCKS_FUNDAMENTALS_CACHE['data'] and (now - _STOCKS_FUNDAMENTALS_CACHE['ts']) < _STOCKS_FUNDAMENTALS_TTL:
        return _STOCKS_FUNDAMENTALS_CACHE['data']

    result: dict = {}
    try:
        conn = sqlite3.connect(STOCKS_DB)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # المحاولة الأولى: نقرأ كل الأعمدة الممكنة من stocks table (production
        # schema فيه change_1d/change_1m/volatility/fair_value_upside مباشرة).
        # لو الـ column مش موجود، SQLite هيرمي OperationalError → نعيد المحاولة
        # بأعمدة أقل (fallback للـ legacy schema).
        #
        # C1.1-PERSONA-LIVE: ضفنا last_update, is_suspended, turnover_egp, value_traded
        # عشان فلتر الأسهم الحية يشتغل في opportunity_quality.is_live_stock_strict/loose.
        #
        # C1.1-FIX (v3.48.1): الـ stocks table الفعلي مفيهوش change_1d/change_1m/
        # volatility/fair_value/change_3m columns — كان الـ SELECT الأول بيرمي
        # OperationalError وبيقع على fallback ناقص. دلوقتي بن alias change_percent
        # AS change_1d ونعمل NULL AS للباقي.
        try:
            cur.execute('''
                SELECT ticker, name, name_ar, sector, current_price, pe_ratio,
                       pb_ratio, roe, market_cap, volume, avg_volume, rsi,
                       change_percent AS change_1d,
                       NULL AS change_1m, NULL AS change_3m,
                       NULL AS volatility, beta, high_52w, low_52w, dividend_yield,
                       profit_margin, debt_to_equity, NULL AS fair_value, ma_50, ma_200,
                       last_update, is_suspended, turnover_egp, value_traded, market
                FROM stocks
                WHERE is_active = 1 OR is_active IS NULL
            ''')
            rows = cur.fetchall()
        except sqlite3.OperationalError:
            # fallback: أعمدة أقل (schema قديم)
            try:
                cur.execute('''
                    SELECT ticker, name, name_ar, sector, current_price, pe_ratio,
                           pb_ratio, roe, market_cap, volume, change_percent AS change_1d,
                           last_update, is_suspended, turnover_egp, value_traded,
                           dividend_yield, avg_volume, rsi, market
                    FROM stocks
                    WHERE current_price > 0
                ''')
                rows = cur.fetchall()
            except Exception:
                rows = []

        # حساب متوسط P/E لكل قطاع (للاستخدام في fair_value_upside)
        # P23-PARSE-HOTFIX: نستخدم parse_numeric_string بدل float() عشان pe_ratio
        # ممكن ييجي كنص زي '15.3x' أو فيه مسافات غريبة.
        sector_pes: dict = {}
        for r in rows:
            pe = r['pe_ratio'] if 'pe_ratio' in r.keys() else None
            sector = r['sector'] if 'sector' in r.keys() else None
            if pe and sector:
                pe_val = parse_numeric_string(pe)
                if pe_val > 0:
                    sector_pes.setdefault(sector, []).append(pe_val)

        sector_avg_pe = {s: sum(v) / len(v) for s, v in sector_pes.items() if v}

        for r in rows:
            d = dict(r)
            ticker = (d.get('ticker') or '').upper()
            if not ticker:
                continue

            try:
                pe = float(d.get('pe_ratio') or 0)
            except (ValueError, TypeError):
                pe = 0.0
            try:
                roe = float(d.get('roe') or 0)
            except (ValueError, TypeError):
                roe = 0.0
            try:
                change_1d = float(d.get('change_1d') or d.get('change_percent') or 0)
            except (ValueError, TypeError):
                change_1d = 0.0
            try:
                change_1m = float(d.get('change_1m') or 0)
            except (ValueError, TypeError):
                change_1m = 0.0
            try:
                volume = float(d.get('volume') or 0)
            except (ValueError, TypeError):
                volume = 0.0
            try:
                avg_volume = float(d.get('avg_volume') or 0)
            except (ValueError, TypeError):
                avg_volume = 0.0
            try:
                volatility = float(d.get('volatility') or 0)
            except (ValueError, TypeError):
                volatility = 0.0
            try:
                current_price = float(d.get('current_price') or 0)
            except (ValueError, TypeError):
                current_price = 0.0
            try:
                fair_value = float(d.get('fair_value') or 0)
            except (ValueError, TypeError):
                fair_value = 0.0

            # حساب volume_ratio لو مش موجود صراحة
            volume_ratio = 1.0
            if avg_volume and avg_volume > 0 and volume > 0:
                volume_ratio = round(volume / avg_volume, 2)

            # حساب fair_value_upside:
            # Method 1: من fair_value column (لو موجود)
            # Method 2: من sector average P/E (لو الـ stock P/E أقل من متوسط القطاع)
            fair_value_upside = 0.0
            if fair_value and current_price > 0:
                fair_value_upside = round(((fair_value - current_price) / current_price) * 100, 2)
            elif pe > 0 and current_price > 0:
                sector = d.get('sector')
                avg_pe = sector_avg_pe.get(sector, 0)
                if avg_pe > 0 and pe < avg_pe:
                    # لو الـ P/E أقل من متوسط القطاع → السهم undervalued
                    fair_value_upside = round(((avg_pe - pe) / pe) * 100, 2)

            # P23-PARSE-HOTFIX: كل float() هنا كان بيقع على قيم زي
            # '84.32\u202fB SAR' → ValueError → الـ batch كله بيرجع فاضي.
            # استبدلناها بـ parse_numeric_string() الآمنة.
            result[ticker] = {
                'ticker': ticker,
                'name': d.get('name') or '',
                'name_ar': d.get('name_ar') or d.get('name') or '',
                'sector': d.get('sector') or '',
                'current_price': current_price,
                'pe_ratio': pe,
                'pb_ratio': parse_numeric_string(d.get('pb_ratio')),
                'roe': roe,
                'market_cap': parse_numeric_string(d.get('market_cap')),
                'volume': volume,
                'avg_volume': avg_volume,
                'volume_ratio': volume_ratio,
                'change_1d': change_1d,
                'change_1m': change_1m,
                'volatility': volatility,
                'beta': parse_numeric_string(d.get('beta')),
                'rsi': parse_numeric_string(d.get('rsi')),
                'dividend_yield': parse_numeric_string(d.get('dividend_yield')),
                'fair_value': fair_value,
                'fair_value_upside': fair_value_upside,
                'high_52w': parse_numeric_string(d.get('high_52w')),
                'low_52w': parse_numeric_string(d.get('low_52w')),
                # C1.1-PERSONA-LIVE: حقول فلتر الأسهم الحية
                'last_update': d.get('last_update') or '',
                'is_suspended': parse_numeric_string(d.get('is_suspended')),
                'turnover_egp': parse_numeric_string(d.get('turnover_egp')),
                'value_traded': parse_numeric_string(d.get('value_traded')),
                # C2-SECTOR-HEAT: needed to filter heat map by market
                'market': (d.get('market') or '').upper(),
            }

        conn.close()
    except Exception as e:
        print(f"[stored_analysis_routes] خطأ في تحميل بيانات الأسهم: {e}")

    _STOCKS_FUNDAMENTALS_CACHE['data'] = result
    _STOCKS_FUNDAMENTALS_CACHE['ts'] = now
    return result


def _is_gambler_opportunity(fund: dict, stored: dict) -> bool:
    """هل السهم فرصة للمضارب؟ (زخم + حجم تداول عالي)

    C1-PERSONA-OPPORTUNITY (v3.48.0): بيوكل المنطق لـ core.opportunity_quality
    اللي بيطبّق:
      - فلتر أسهم حية strict (last_update<24h, volume≥10k, turnover≥500k)
      - quality gate (score≥65, RR≥1.5, confidence≥55, recommendation∈BUY_FAMILY)
      - gambler confirmation (vr≥1.5 OR score≥80 OR |change_1d|≥3%)

    لو الـ module مش متاح، بيرجع legacy logic (vr≥1.5 AND |chg|≥2%).
    """
    if C1_OPPORTUNITY_AVAILABLE and isinstance(stored, dict):
        # محاكاة rec من stored (الـ caller بينادي من within get_results)
        rec = {
            'recommendation': stored.get('recommendation', ''),
            'maestro_score': stored.get('maestro_score', 0),
            'risk_reward': stored.get('risk_reward', 0),
            'confidence': stored.get('confidence', 0),
            'turnover_egp': stored.get('turnover_egp'),
        }
        try:
            return _c1_is_gambler_opp(rec, fund or {}, stored)
        except Exception:
            pass  # وقوع لـ legacy
    # Legacy
    if not fund:
        return False
    vr = float(fund.get('volume_ratio') or 0)
    chg_1d = float(fund.get('change_1d') or 0)
    stored_vr = float(stored.get('volume_ratio') or 0)
    return (vr >= 1.5 and abs(chg_1d) >= 2.0) or (stored_vr >= 1.5 and abs(chg_1d) >= 1.5)


def _is_investor_opportunity(fund: dict, stored: dict) -> bool:
    """هل السهم فرصة للمستثمر؟ (أساسيات قوية + استقرار)

    C1-PERSONA-OPPORTUNITY (v3.48.0): بيوكل المنطق لـ core.opportunity_quality
    اللي بيطبّق:
      - فلتر أسهم حية loose (last_update<7d, علامة حياة)
      - quality gate (نفس بوابة المضارب)
      - investor fundamental: pe∈[5,20]+roe≥10 OR fallback لما pe_ratio فاضي
        (roe≥12, fvu≥15, chg_1m∈[-10,+15], div≥0.5, volat≤40)
    """
    if C1_OPPORTUNITY_AVAILABLE and isinstance(stored, dict):
        rec = {
            'recommendation': stored.get('recommendation', ''),
            'maestro_score': stored.get('maestro_score', 0),
            'risk_reward': stored.get('risk_reward', 0),
            'confidence': stored.get('confidence', 0),
            'turnover_egp': stored.get('turnover_egp'),
        }
        try:
            return _c1_is_investor_opp(rec, fund or {}, stored)
        except Exception:
            pass  # وقوع لـ legacy
    # Legacy
    if not fund:
        return False
    pe = float(fund.get('pe_ratio') or 0)
    roe = float(fund.get('roe') or 0)
    chg_1m = float(fund.get('change_1m') or 0)
    return (5 <= pe <= 20) and (roe >= 10) and (-5 <= chg_1m <= 10)


def _compute_gambler_rank_score(fund: dict, stored: dict) -> float:
    """درجة ترتيب المضارب: زخم + حجم + تقلب + RSI edge. الأعلى = الأفضل للمضاربة.

    C1-PERSONA-OPPORTUNITY: بيوكل لـ opportunity_quality.compute_gambler_rank_score.
    """
    if C1_OPPORTUNITY_AVAILABLE:
        try:
            return _c1_gambler_rank(fund or {}, stored)
        except Exception:
            pass
    vr = float(fund.get('volume_ratio') or stored.get('volume_ratio') or 0)
    chg = abs(float(fund.get('change_1d') or 0))
    vol = float(fund.get('volatility') or 0)
    rsi = float(fund.get('rsi') or 50)
    rsi_edge = abs(rsi - 50) * 2
    return round(vr * 10 + chg * 3 + vol * 0.5 + rsi_edge, 2)


def _compute_investor_rank_score(fund: dict, stored: dict) -> float:
    """درجة ترتيب المستثمر: قيمة عادلة + ربحية + توزيعات + استقرار. الأعلى = الأفضل للاستثمار.

    C1-PERSONA-OPPORTUNITY: بيوكل لـ opportunity_quality.compute_investor_rank_score
    (الـ rank دلوقتي فيه stability_bonus إضافي).
    """
    if C1_OPPORTUNITY_AVAILABLE:
        try:
            return _c1_investor_rank(fund or {}, stored)
        except Exception:
            pass
    fvu = float(fund.get('fair_value_upside') or 0)
    roe = float(fund.get('roe') or 0)
    pe = float(fund.get('pe_ratio') or 0)
    div = float(fund.get('dividend_yield') or 0)
    pe_score = (20 - pe) * 2 if 0 < pe <= 20 else 0
    return round(fvu * 1.5 + roe * 1.2 + div * 5 + pe_score, 2)


def _is_balanced_opportunity(fund: dict, stored: dict) -> bool:
    """هل السهم فرصة متوازنة؟ (تقاطع موزون ديناميكي بين gambler و investor)

    C3-BALANCED (v3.67.0): بيوكل لـ core.opportunity_quality.is_balanced_opportunity
    اللي بيطبّق:
      - فلتر أسهم حية strict (نفس gambler — محتاج سيولة حقيقية)
      - quality gate (نفس بوابة المضارب والمستثمر)
      - balanced confirmation: زخم معتدل AND أساسيات مش في القاع
    """
    if C1_OPPORTUNITY_AVAILABLE and isinstance(stored, dict):
        rec = {
            'recommendation': stored.get('recommendation', ''),
            'maestro_score': stored.get('maestro_score', 0),
            'risk_reward': stored.get('risk_reward', 0),
            'confidence': stored.get('confidence', 0),
            'turnover_egp': stored.get('turnover_egp'),
        }
        try:
            return _c1_is_balanced_opp(rec, fund or {}, stored)
        except Exception:
            pass  # وقوع لـ legacy
    # Legacy fallback: لو الـ module مش متاح
    if not fund:
        return False
    # متوازن = عنده زخم معتدل + أساسيات مقبولة نسبياً
    chg_1d = float(fund.get('change_1d') or 0)
    vr = float(fund.get('volume_ratio') or stored.get('volume_ratio') or 0)
    roe = float(fund.get('roe') or 0)
    fvu = float(fund.get('fair_value_upside') or 0)
    chg_1m = float(fund.get('change_1m') or 0)
    momentum_ok = chg_1d >= 0.5 or vr >= 1.2
    fundamental_ok = roe >= 8 or fvu >= 5 or chg_1m >= -5
    return momentum_ok and fundamental_ok


def _compute_balanced_rank_score(fund: dict, stored: dict) -> float:
    """درجة ترتيب المتوازن: مزيج معتدل بين المضارب والمستثمر.

    C3-BALANCED (v3.67.0): بيوكل لـ opportunity_quality.compute_balanced_rank_score.
    المتوازن = 0.5 × gambler_rank + 0.5 × investor_rank.
    """
    if C1_OPPORTUNITY_AVAILABLE:
        try:
            return _c1_balanced_rank(fund or {}, stored)
        except Exception:
            pass
    g_rank = _compute_gambler_rank_score(fund, stored)
    i_rank = _compute_investor_rank_score(fund, stored)
    return round(g_rank * 0.5 + i_rank * 0.5, 2)


def _build_persona_reason(persona: str, fund: dict, stored: dict, rr_info: dict) -> str:
    """صياغة سبب توصية مختلف لكل persona (للمستخدم يحس إن الشخصيات مختلفة).

    C5-PERSONA-REASON (v3.67.0):
      - gambler (مضارب): زخم + حجم نسبي + نوع DNA (amplifier…) + ليه الـ trailing مفتوح.
      - balanced (متوازن): جملة تربط الزخم + الأساسيات النسبية للقطاع، وليه الصفقة "وسط".
      - conservative (مستثمر): P/E أو ROE نسبةً للقطاع، خصم القيمة العادلة، قطاع، ليه الوقف محافظ.
    """
    fund = fund or {}
    stored = stored or {}
    rr_info = rr_info or {}
    try:
        chg_1d = float(fund.get('change_1d') or stored.get('change_1d') or 0)
        vr = float(fund.get('volume_ratio') or stored.get('volume_ratio') or 0)
        score = float(stored.get('maestro_score') or 0)
        roe = float(fund.get('roe') or stored.get('roe') or 0)
        pe = float(fund.get('pe_ratio') or stored.get('pe_ratio') or 0)
        fvu = float(fund.get('fair_value_upside') or stored.get('fair_value_upside') or 0)
        div = float(fund.get('dividend_yield') or 0)
        chg_1m = float(fund.get('change_1m') or stored.get('change_1m') or 0)
        sector = fund.get('sector') or stored.get('sector') or 'القطاع'
        horizon = rr_info.get('horizon', '')
        target_pct = rr_info.get('target_pct', 0)
        stop_pct = rr_info.get('stop_pct', 0)
        method = rr_info.get('method', '')

        if persona == 'gambler':
            # مضارب: زخم + حجم نسبي + amplifier + trailing مفتوح
            parts = []
            if abs(chg_1d) >= 3.0:
                parts.append(f"زخم قوي {chg_1d:+.1f}% اليوم")
            elif chg_1d >= 0.5:
                parts.append(f"حركة موجبة {chg_1d:+.1f}%")
            if vr >= 1.5:
                parts.append(f"حجم تداول {vr:.1f}× المتوسط")
            elif vr >= 1.2:
                parts.append(f"حجم فوق المتوسط ({vr:.1f}×)")
            if score >= 80:
                parts.append("إشارة maestro قوية")
            # نوع DNA (crash class) — لو متاح
            crash_class = (fund.get('reaction_to_market_crashes')
                           or stored.get('reaction_to_market_crashes') or '')
            if crash_class == 'amplifier':
                parts.append("DNA amplifier (يتضخّم مع السوق)")
            # trailing مفتوح
            if method == 'dna_typical_move':
                parts.append(f"هدف مفتوح {target_pct:.1f}% من حركة اليوم")
            else:
                parts.append(f"هدف {target_pct:.1f}% — trailing مفتوح")
            return ' · '.join(parts) if parts else f"فرصة مضاربة · هدف {target_pct:.1f}%"

        elif persona == 'conservative':
            # مستثمر: P/E + ROE نسبي للقطاع + خصم القيمة العادلة + قطاع + وقف محافظ
            parts = []
            if pe > 0:
                parts.append(f"P/E {pe:.1f}")
            if roe > 0:
                parts.append(f"ROE {roe:.1f}%")
            if fvu >= 15:
                parts.append(f"خصم {fvu:.0f}% عن القيمة العادلة")
            elif fvu > 0:
                parts.append(f"خصم {fvu:.1f}%")
            if div > 0:
                parts.append(f"توزيعات {div:.1f}%")
            parts.append(f"قطاع {sector}")
            # وقف محافظ
            if method == 'dna_typical_move':
                parts.append(f"وقف محافظ {stop_pct:.1f}%")
            else:
                parts.append(f"وقف {stop_pct:.1f}% (حماية رأس المال)")
            return ' · '.join(parts)

        else:  # balanced
            # متوازن: زخم معتدل + أساسيات نسبية مقبولة للقطاع + ليه الصفقة "وسط"
            parts = []
            if chg_1d >= 0.5:
                parts.append(f"زخم معتدل {chg_1d:+.1f}%")
            if vr >= 1.2:
                parts.append(f"حجم {vr:.1f}×")
            if roe >= 8:
                parts.append(f"ROE {roe:.0f}%")
            if fvu > 0:
                parts.append(f"خصم {fvu:.0f}%")
            parts.append(f"قطاع {sector}")
            parts.append(f"هدف وسط {target_pct:.1f}% · وقف {stop_pct:.1f}%")
            return ' · '.join(parts)
    except Exception:
        return ''


def _build_fundamentals_with_sector_heat(fund: dict, stored: dict, sector_heat_map: dict, sector_roles: dict = None) -> dict | None:
    """ابني fundamentals dict مع حقول Sector Heat (C2) + Sector Role (P6).

    بيرجع نفس الـ fundamentals dict اللي كان بيتعمل قبل كده، + حقول:
      - sector_heat: 'hot' | 'dead' | 'neutral'  (للـ UI يعرض 🔥/❄️)
      - sector_heat_boost: الـ delta المُطبَّق من سخونة القطاع (+0.15, -0.10, 0.0)
      - sector_role: 'leader' | 'mid' | 'laggard'  (P6 — دور السهم في قطاعه)
      - sector_role_boost: الـ delta المُطبَّق من دور القطاع (+0.05, -0.05, 0.0)
      - gambler_rank_score_boosted: الدرجة بعد الـ heat boost + role boost

    المستثمر: مبيحصلش أي boost — investor_rank_score بيفضل زي ما هو (مش ثيم مضاربة).
    لو opportunity_quality module مش متاح، الـ sector fields بترجع neutral/0/mid.
    """
    if not fund:
        return None

    # الـ rank scores الأصلية (زي ما كانت بتتحسب قبل C2)
    g_rank = _compute_gambler_rank_score(fund, stored)
    i_rank = _compute_investor_rank_score(fund, stored)
    b_rank = _compute_balanced_rank_score(fund, stored)

    # C2: Sector Heat — boost للمضارب بس (سخونة القطاع كله)
    sector = fund.get('sector', '')
    _ticker = fund.get('ticker') or stored.get('ticker') or ''
    if C1_OPPORTUNITY_AVAILABLE and sector_heat_map:
        sector_heat_status = _c2_sector_status(sector, sector_heat_map)
        g_rank_after_heat, sector_boost_delta = _c2_apply_sector_boost(g_rank, sector, sector_heat_map)
    else:
        sector_heat_status = 'neutral'
        g_rank_after_heat = g_rank
        sector_boost_delta = 0.0

    # P6: Sector Role — حقن خفيف إضافي للمضارب (دور السهم جوه قطاعه)
    # بيتطبّق فوق الـ heat boost. المضارب بيفضّل قائد قطاع ساخن، بيتجنّب laggard متأخر.
    sector_role = 'mid'
    sector_role_boost = 0.0
    g_rank_final = g_rank_after_heat
    if C1_OPPORTUNITY_AVAILABLE and sector_roles:
        sector_role = sector_roles.get(_ticker, 'mid')
        g_rank_final, sector_role_boost = _c2_apply_sector_role(
            g_rank_after_heat, sector_role, sector_heat_status
        )
        # لوج [SECTOR_ROLE] عشان grep يلاقيه ونعرف التصنيف + التعديل لكل سهم
        if sector_role != 'mid' or sector_role_boost != 0.0:
            print(f"[SECTOR_ROLE] ticker={_ticker} sector={sector} role={sector_role} "
                  f"status={sector_heat_status} rank_adj={sector_role_boost:+.3f} "
                  f"g_rank={g_rank:.1f}->heat{g_rank_after_heat:.1f}->final{g_rank_final:.1f}")

    return {
        'pe_ratio': fund.get('pe_ratio', 0),
        'roe': fund.get('roe', 0),
        'volume_ratio': fund.get('volume_ratio', 0),
        'change_1d': fund.get('change_1d', 0),
        'change_1m': fund.get('change_1m', 0),
        'volatility': fund.get('volatility', 0),
        'fair_value_upside': fund.get('fair_value_upside', 0),
        'sector': sector,
        'dividend_yield': fund.get('dividend_yield', 0),
        'rsi': fund.get('rsi', 0),
        'is_gambler_opportunity': _is_gambler_opportunity(fund, stored),
        'is_investor_opportunity': _is_investor_opportunity(fund, stored),
        'is_balanced_opportunity': _is_balanced_opportunity(fund, stored),
        'gambler_rank_score': g_rank,
        'investor_rank_score': i_rank,
        'balanced_rank_score': b_rank,
        # C2 — Sector Heat (دوران قطاعي للمضارب فقط)
        'sector_heat': sector_heat_status,
        'sector_heat_boost': sector_boost_delta,
        # P6 — Sector Role (دور السهم جوه قطاعه + حقن خفيف للمضارب)
        'sector_role': sector_role,
        'sector_role_boost': sector_role_boost,
        'gambler_rank_score_boosted': g_rank_final,
    }


# ============================================================================
# إصلاح قرار البرسونا (المضارب/المستثمر)
# ============================================================================
# محرك الـ persona القديم كان بيولّد verdict=#39;ابعد'/'انتظر' بـ entry=null و signal=HOLD
# لأغلب الأسهم رغم إن التوصية الأصلية (recommendation) فيها BUY/SELL حقيقي
# بأسعار دخول/وقف/هدف صحيحة. هنا بنولّد قرار صحيح من التوصية الأصلية
# لو كائن البرسونا المخزّن معطوب — عشان تبويب المضارب يورّي شراء/بيع فعلي.
#
# 🔧 إصلاح (يوليو 2026): الـ version القديم كان بيرجع نفس النتيجة للـ persona الاتنين
# (نفس entry/target/stop/score) مع اختلاف الـ verdict بس. ده خلّى نفس الأسهم تظهر
# في المضارب والمستثمر، وكلهم شراء، و R/R ضعيف. دلوقتي كل persona ليها فلاتر
# مختلفة تفرّق بينهم بجد:
#
#   Gambler (المضارب):
#     - BUY لو score >= 50 و R/R >= 1.2 (أكثر عدوانية)
#     - SELL لو recommendation = SELL (المضارب يبيع)
#     - HOLD غير كده
#
#   Investor (المستثمر):
#     - BUY لو score >= 60 و R/R >= 1.5 (أكثر تحفظاً)
#     - ما يقبلش SELL (المستثمر مش ببيع على المدى الطويل)
#     - HOLD غير كده
def _derive_persona_action(persona: str, row: dict, fund: dict = None) -> dict:
    rec = (row.get('recommendation') or '').lower()
    score = float(row.get('maestro_score') or 0)
    entry = row.get('entry_price')
    target = row.get('target_price')
    stop = row.get('stop_loss')
    rr = row.get('risk_reward')

    # P16-PERSONA-DIVERGENCE: بيانات الأساسيات/المومنتم من stocks.db
    # لو الـ caller مرّرها، نستخدمها في صياغة الـ reason لتبقى مختلفة جذرياً
    # لكل persona.
    fund = fund or {}
    pe = float(fund.get('pe_ratio') or 0)
    roe = float(fund.get('roe') or 0)
    vr_fund = float(fund.get('volume_ratio') or row.get('volume_ratio') or 1.0)
    chg_1d = float(fund.get('change_1d') or 0)
    chg_1m = float(fund.get('change_1m') or 0)
    fvu = float(fund.get('fair_value_upside') or 0)
    volatility = float(fund.get('volatility') or 0)
    sector = fund.get('sector') or ''

    try:
        e = float(entry) if entry not in (None, 0, 0.0) else 0.0
        t = float(target) if target not in (None, 0, 0.0) else 0.0
        s = float(stop) if stop not in (None, 0, 0.0) else 0.0
    except (ValueError, TypeError):
        e, t, s = 0.0, 0.0, 0.0

    # ATR-based dynamic risk calculation if stop is missing or unrealistic
    atr_est = e * 0.03 if e > 0 else 1.0
    if s == 0 or s >= e:
        s = round(e - (atr_est * 1.2), 2) if e > 0 else 0.0

    risk = e - s if (e > 0 and s > 0 and e > s) else (e * 0.04 if e > 0 else 0.0)
    
    # Calculate TP1 (1.5x) and TP2 (3.0x) according to PineScript rules
    tp1 = round(e + (risk * 1.5), 2) if e > 0 else t
    tp2 = round(e + (risk * 3.0), 2) if e > 0 else round(t * 1.1, 2)

    # Use TP1 as default target if stored target is missing or unrealistic (> 50% above entry)
    if t == 0 or (e > 0 and t > e * 1.4):
        t = tp1

    if risk > 0 and (t - e) > 0:
        rr = round((t - e) / risk, 2)
    else:
        rr = 1.5 if persona == 'gambler' else 2.0

    timeframe = 'يومي-أسبوعي' if persona == 'gambler' else '6-12 شهر'

    # Volume & Liquidity metrics
    try:
        vol_ratio_val = float(row.get('volume_ratio') or 1.0)
    except (ValueError, TypeError):
        vol_ratio_val = 1.0

    turnover_egp = float(row.get('turnover_egp') or 0.0)
    # FIX (PREDICTION-INTEGRITY 2026-10-11): لو turnover_egp = 0 → لا نعرض "سيولة ممتازة"
    # السبب: fallback لـ vol_ratio_val كان بيخلي "1.0M ج.م" يتعرض لكل الأسهم (بيانات مضللة).
    # Rule 27 (NO-FAKE-DATA): لو مفيش بيانات سيولة حقيقية → اعرض "بيانات السيولة غير متاحة".
    turnover_m = turnover_egp / 1_000_000.0 if turnover_egp > 0 else 0.0

    def _smc_reason() -> str:
        parts = []
        if turnover_m > 0:
            if turnover_m >= 1.0:
                parts.append(f"سيولة ممتازة ({turnover_m:.1f}M ج.م)")
            elif turnover_m >= 0.5:
                parts.append(f"سيولة جيدة ({turnover_m:.1f}M ج.م)")
            else:
                parts.append(f"سيولة محدودة ({turnover_m:.2f}M ج.م)")
        elif vol_ratio_val >= 1.5:
            parts.append(f"حجم تداول مرتفع ({vol_ratio_val:.1f}x)")
        elif vol_ratio_val > 0:
            parts.append(f"سيولة اعتيادية (حجم {vol_ratio_val:.1f}x)")
        else:
            parts.append("بيانات السيولة غير متاحة")

        if persona == 'gambler':
            parts.append(f"هدف أول 1.5x ({tp1:.2f}) | هدف ثانٍ 3x ({tp2:.2f})")
            parts.append(f"وقف ATR ديناميكي عند {s:.2f}")
        else:
            parts.append(f"هدف مستثمر ({tp1:.2f})")
            parts.append(f"وقف أمان عند {s:.2f}")

        return " — ".join(parts) + f" (R/R {rr:.2f}:1)."

    reason_text = _smc_reason()

    # P16-PERSONA-DIVERGENCE: صياغة سبب مختلف جذرياً لكل persona.
    # المضارب بيفكر بـ: زخم + حجم تداول + اختراق مقاومة + تقلب.
    # المستثمر بيفكر بـ: أساسيات (P/E, ROE) + قيمة عادلة + استقرار.
    def _gambler_signature_reason(prefix: str = '') -> str:
        momentum_parts = []
        if vr_fund and vr_fund >= 1.5:
            momentum_parts.append(f"زخم قوي (حجم {vr_fund:.1f}x)")
        elif vol_ratio_val and vol_ratio_val >= 1.5:
            momentum_parts.append(f"زخم قوي (حجم {vol_ratio_val:.1f}x)")
        if abs(chg_1d) >= 2.0:
            direction = 'صاعد' if chg_1d > 0 else 'هابط'
            momentum_parts.append(f"حركة سعرية {direction}ة ({chg_1d:+.1f}%)")
        if volatility > 0:
            momentum_parts.append(f"تقلب {volatility:.1f}%")
        if not momentum_parts:
            momentum_parts.append("زخم محايد — مراقبة الاختراق")
        sig = " — ".join(momentum_parts)
        if prefix:
            return f"{prefix} — {sig}. {reason_text}"
        return f"{sig}. {reason_text}"

    def _investor_signature_reason(prefix: str = '') -> str:
        fund_parts = []
        if pe > 0:
            fund_parts.append(f"P/E {pe:.1f}")
        if roe > 0:
            fund_parts.append(f"ROE {roe:.0f}%")
        if sector:
            fund_parts.append(f"قطاع {sector}")
        if fvu > 0:
            fund_parts.append(f"خصم {fvu:.1f}% عن القيمة العادلة")
        elif pe > 0 and pe <= 15:
            fund_parts.append("يتداول قرب قيمته العادلة")
        if not fund_parts:
            fund_parts.append("أساسيات متوازنة")
        sig = " — ".join(fund_parts)
        if prefix:
            return f"{prefix} — سهم قوي أساسياً ({sig}). {reason_text}"
        return f"سهم قوي أساسياً ({sig}). {reason_text}"

    # GAMBLER (المضارب)
    if persona == 'gambler':
        if rec in ('strong_sell', 'sell'):
            return {
                'verdict': 'بيع', 'signal': 'SELL', 'score': score,
                'entry': e if e > 0 else None, 'target': t if t > 0 else None, 'stop': s if s > 0 else None,
                'tp1': tp1, 'tp2': tp2, 'risk_reward': rr, 'timeframe': timeframe,
                'reason': _gambler_signature_reason('توصية بيع — زخم هابط واختراق دعم'),
            }
        if rec in ('strong_buy', 'buy', 'swing_buy', 't1_buy') or score >= 50:
            if score >= 55 and rr >= 1.2:
                return {
                    'verdict': 'شراء قوي', 'signal': 'BUY', 'score': score,
                    'entry': e if e > 0 else None, 'target': tp1 if tp1 > 0 else None, 'stop': s if s > 0 else None,
                    'tp1': tp1, 'tp2': tp2, 'risk_reward': rr, 'timeframe': timeframe,
                    'reason': _gambler_signature_reason('شراء مضاربي قوي — اختراق مقاومة'),
                }
            elif score >= 40:
                return {
                    'verdict': 'شراء', 'signal': 'BUY', 'score': score,
                    'entry': e if e > 0 else None, 'target': tp1 if tp1 > 0 else None, 'stop': s if s > 0 else None,
                    'tp1': tp1, 'tp2': tp2, 'risk_reward': rr, 'timeframe': timeframe,
                    'reason': _gambler_signature_reason('فرصة دخول مضاربي'),
                }
            elif rr < 1.0 and e > 0:
                return {
                    'verdict': 'ابعد', 'signal': 'HOLD', 'score': score,
                    'entry': None, 'target': None, 'stop': None,
                    'tp1': None, 'tp2': None, 'risk_reward': rr, 'timeframe': timeframe,
                    'reason': f"R/R {rr:.2f}:1 — المخاطرة أعلى من العائد. تجنب الدخول.",
                }
            else:
                return {
                    'verdict': 'انتظر', 'signal': 'HOLD', 'score': score,
                    'entry': None, 'target': None, 'stop': None,
                    'tp1': None, 'tp2': None, 'risk_reward': rr, 'timeframe': timeframe,
                    'reason': _gambler_signature_reason('مراقبة — انتظار تأكيد الاختراق الهيكلي'),
                }
        else:
            return {
                'verdict': 'انتظر', 'signal': 'HOLD', 'score': score,
                'entry': None, 'target': None, 'stop': None,
                'tp1': None, 'tp2': None, 'risk_reward': rr, 'timeframe': timeframe,
                'reason': _gambler_signature_reason('انتظار اشارة مؤكدة من صانع السوق'),
            }

    # INVESTOR (المستثمر)
    else:
        if rec in ('strong_sell', 'sell'):
            return {
                'verdict': 'انتظر', 'signal': 'HOLD', 'score': score,
                'entry': None, 'target': None, 'stop': None,
                'tp1': None, 'tp2': None, 'risk_reward': rr, 'timeframe': timeframe,
                'reason': 'المستثمر طويل الأجل لا يبيع في القيعان — انتظار تحسن الاتجاه.',
            }
        if rec in ('strong_buy', 'buy', 'swing_buy', 't1_buy') or score >= 55:
            if score >= 60 and rr >= 1.5:
                return {
                    'verdict': 'شراء قوي', 'signal': 'BUY', 'score': score,
                    'entry': e if e > 0 else None, 'target': tp1 if tp1 > 0 else None, 'stop': s if s > 0 else None,
                    'tp1': tp1, 'tp2': tp2, 'risk_reward': rr, 'timeframe': timeframe,
                    'reason': _investor_signature_reason('فرصة استثمار ممتازة'),
                }
            elif score >= 45:
                return {
                    'verdict': 'شراء', 'signal': 'BUY', 'score': score,
                    'entry': e if e > 0 else None, 'target': tp1 if tp1 > 0 else None, 'stop': s if s > 0 else None,
                    'tp1': tp1, 'tp2': tp2, 'risk_reward': rr, 'timeframe': timeframe,
                    'reason': _investor_signature_reason('تجميع استثماري'),
                }
            elif rr < 1.0 and e > 0:
                return {
                    'verdict': 'ابعد', 'signal': 'HOLD', 'score': score,
                    'entry': None, 'target': None, 'stop': None,
                    'tp1': None, 'tp2': None, 'risk_reward': rr, 'timeframe': timeframe,
                    'reason': f"R/R {rr:.2f}:1 — غير مناسب للاستثمار في المرحلة الحالية.",
                }
            else:
                return {
                    'verdict': 'انتظر', 'signal': 'HOLD', 'score': score,
                    'entry': None, 'target': None, 'stop': None,
                    'tp1': None, 'tp2': None, 'risk_reward': rr, 'timeframe': timeframe,
                    'reason': _investor_signature_reason('مؤشرات استثمارية محدودة — انتظار استقرار'),
                }
        else:
            return {
                'verdict': 'انتظر', 'signal': 'HOLD', 'score': score,
                'entry': None, 'target': None, 'stop': None,
                'tp1': None, 'tp2': None, 'risk_reward': rr, 'timeframe': timeframe,
                'reason': _investor_signature_reason('لا توجد إشارة تجميع استثمارية واضحة'),
            }


def _heal_persona_json(analysis_json: dict, row: dict, fund: dict = None) -> dict:
    """يصلح كائنات gambler/investor المعطوبة من التوصية الأصلية ويطبّق قواعد SMC الديناميكية.

    P16-PERSONA-DIVERGENCE: بقى يقبل fund (بيانات stocks.db للسهم) عشان
    الـ reason يكون مختلف جذرياً لكل persona (مضارب: زخم/حجم، مستثمر: P/E/ROE).
    """
    if not isinstance(analysis_json, dict):
        analysis_json = {}
    for p in ('gambler', 'investor'):
        po = analysis_json.get(p) or {}
        derived = _derive_persona_action(p, row, fund=fund)
        # دمج النتيجة: القواعد الديناميكية الجديدة تطغى على النصوص القديمة والقوالب الميكانيكية
        analysis_json[p] = {**po, **derived}
    return analysis_json

# ذاكرة كاش لتخزين فحص الجودة للخبير لمنع الحساب المتكرر بكل طلب
_EXPERT_VERDICT_CACHE = {}

def get_predictions_db():
    conn = sqlite3.connect(PREDICTIONS_DB)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    # RL-FIX-6: auto-migrate target_price_2 column (المستهدف الثاني)
    # لو العمود مش موجود، أضفه. ده علشان الـ API يشتغل حتى لو daily_closer
    # ما شغلناش على الـ VPS (الـ schema migration بـ يحدث تلقائياً).
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()}
        if 'target_price_2' not in cols:
            conn.execute("ALTER TABLE predictions ADD COLUMN target_price_2 REAL")
            conn.commit()
    except Exception:
        pass
    return conn

@stored_analysis_bp.route('/status', methods=['GET'])
def get_status():
    try:
        # P40-MARKET-ISOLATION: فلتر stats حسب السوق عشان ما يتداخلوش.
        # قبل كده كان الـ query بيجيب stats من كل الأسواق، فكان سهم سعودي بيظهر
        # في إحصائيات EGX. دلوقتي بنقبل ?market=EGX ونبني WHERE ديناميكي.
        market = (request.args.get('market') or '').upper().strip()
        conn = get_predictions_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM analysis_engine_status WHERE id = ?', ('main',))
        status_row = cursor.fetchone()

        # بناء شرط السوق: لو market محدد → فلتر، غير كده → كل الأسواق (backward compat).
        _market_clause = ''
        _market_args = []
        if market:
            _market_clause = ' WHERE market = ?'
            _market_args = [market]

        cursor.execute(f'''
            SELECT 
                COUNT(*) as total_analyses,
                SUM(CASE WHEN recommendation = 'buy' THEN 1 ELSE 0 END) as buy_signals,
                SUM(CASE WHEN recommendation = 'strong_buy' THEN 1 ELSE 0 END) as strong_buy_signals,
                AVG(maestro_score) as avg_score
            FROM stored_analyses
            {_market_clause}
        ''', _market_args)
        # FRESHNESS-CHECK (Task PHASE-3, Rule 72)
        # TODO: Add `AND updated_at >= datetime('now', '-2 days')` to filter stale analyses
        #       from these stats (so old predictions don't inflate counts).
        stats_row = cursor.fetchone()
        
        cursor.execute(f'''
            SELECT ticker, market, maestro_score, recommendation, updated_at
            FROM stored_analyses
            {_market_clause}
            ORDER BY updated_at DESC
            LIMIT 5
        ''', _market_args)
        # FRESHNESS-CHECK (Task PHASE-3, Rule 72)
        # TODO: Add `AND updated_at >= datetime('now', '-2 days')` to filter stale analyses
        recent = [dict(r) for r in cursor.fetchall()]
        conn.close()
        
        return jsonify({
            'success': True,
            'status': dict(status_row) if status_row else {},
            'stats': dict(stats_row) if stats_row else {},
            'recent': recent,
            'market': market or 'ALL',
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@stored_analysis_bp.route('/results', methods=['GET'])
def get_results():
    try:
        market = request.args.get('market', 'EGX').upper()
        recommendation = request.args.get('recommendation')
        min_score = float(request.args.get('minScore', 0))
        limit = int(request.args.get('limit', 100))
        offset = int(request.args.get('offset', 0))
        # P16-PERSONA-DIVERGENCE: اقبل persona param للفلترة والترتيب
        # P26-PERSONA-SEPARATION: بقى يقبل 3 شخصيات (gambler/balanced/conservative).
        #   - gambler:      يفلتر بـ is_gambler_opportunity (زخم/حجم).
        #   - conservative: يفلتر بـ is_investor_opportunity (أساسيات/قيمة عادلة) —
        #                    نفس منطق المستثمر القديم (أفق طويل).
        #   - balanced:     مفيش فلتر SQL — بيرجّع الكل مرتّب بالـ score (عرض عام).
        #   - investor (legacy alias لـ conservative):backward compat.
        persona = (request.args.get('persona') or '').lower().strip()
        if persona == 'investor':
            persona = 'conservative'  # alias
        if persona not in ('conservative', 'gambler', 'balanced'):
            persona = None

        conn = get_predictions_db()
        cursor = conn.cursor()

        query = '''
            SELECT 
                id, ticker, market, maestro_score, recommendation, recommendation_ar,
                confidence, entry_price, target_price, stop_loss, risk_reward,
                regime, regime_score, timeframe_aligned, timeframe_count,
                volume_ratio, liquidity_rating, analysis_json, updated_at,
                turnover_egp
            FROM stored_analyses
            WHERE market = ?
        '''
        # FRESHNESS-CHECK (Task PHASE-3, Rule 72)
        # TODO: Append `AND updated_at >= datetime('now', '-2 days')` after the WHERE clause
        #       so stale analyses are excluded from /stored-analysis/results.
        params = [market]

        if recommendation:
            query += ' AND recommendation = ?'
            params.append(recommendation)

        if min_score > 0:
            query += ' AND maestro_score >= ?'
            params.append(min_score)

        # P16-PERSONA-DIVERGENCE: لو persona محددة، نفلتر بـ is_gambler_opportunity
        # أو is_investor_opportunity (لو الأعمدة موجودة في stored_analyses).
        # الأعمدة دي بتتعمل migration آمن في background_analyzer.py._ensure_stored_analyses_columns.
        # لو الـ column مش موجود بعد (production قبل deploy)، نتجاهل الفلتر بس
        # نطبّقه post-query في Python.
        persona_filter_applied_in_sql = False
        # P26-PERSONA-SEPARATION: بنعطّل الـ SQL persona filter عمداً. السبب:
        # الـ manual trigger (trigger-analysis) ما بيسيطرش is_gambler_opportunity /
        # is_investor_opportunity flags، فكان الـ SQL filter بيرجّع 0 صفوف → واجهة
        # فاضية. دلوقتي بنجيب كل الأسهم من SQL وبنفلتر/نرتّب في Python (مع fallback
        # لو الفلتر رجّع فاضي). الـ persona_rr هو اللي بيفردل الأرقام مختلفة.
        # (الـ flags لسه بتت setter بواسطة background_analyzer للـ scheduled runs.)
        if False and persona:
            try:
                cursor.execute("PRAGMA table_info(stored_analyses)")
                existing_cols = {row[1] for row in cursor.fetchall()}
                if persona == 'gambler' and 'is_gambler_opportunity' in existing_cols:
                    query += ' AND (is_gambler_opportunity = 1)'
                    persona_filter_applied_in_sql = True
                elif persona == 'conservative' and 'is_investor_opportunity' in existing_cols:
                    query += ' AND (is_investor_opportunity = 1)'
                    persona_filter_applied_in_sql = True
            except Exception:
                pass

        # لو persona محددة وماقدرناش نفلتر في SQL، نزود الـ limit ونفلتر في Python
        effective_limit = limit * 5 if (persona and not persona_filter_applied_in_sql) else limit
        query += ' ORDER BY maestro_score DESC LIMIT ? OFFSET ?'
        params.extend([effective_limit, offset])

        cursor.execute(query, params)
        results = [dict(r) for r in cursor.fetchall()]

        # Total count
        count_query = 'SELECT COUNT(*) as total FROM stored_analyses WHERE market = ?'
        count_params = [market]
        if recommendation:
            count_query += ' AND recommendation = ?'
            count_params.append(recommendation)
        if min_score > 0:
            count_query += ' AND maestro_score >= ?'
            count_params.append(min_score)

        cursor.execute(count_query, count_params)
        total = cursor.fetchone()['total']

        cursor.execute('SELECT MAX(updated_at) as last_updated FROM stored_analyses WHERE market = ?', (market,))
        last_updated = cursor.fetchone()['last_updated']
        conn.close()

        # P16-PERSONA-DIVERGENCE: تحميل بيانات الأسهم من stocks.db دفعة واحدة
        # (لو persona محددة أو حتى لو مش محددة — عشان نسمّع الـ reason)
        stocks_fund = _load_stocks_fundamentals_batch()

        # C2-SECTOR-HEAT: احسب خريطة سخونة القطاعات مرّة واحدة لكل request.
        # ده measure نسبي للسوق كله (بيتغيّر كل دقيقة) → لازم يتحسب read-time،
        # مش write-time. الـ heat_map بتتحقّق: avg_chg + rising_ratio لكل قطاع.
        # boost بيتطبّق على ترتيب المضارب بس (المستثمر مش ثيم مضاربة).
        # مهم: لازم نفلتر للـ market المطلوب فقط — الـ batch فيه كل الأسهم من
        # كل الأسواق (EGX + TADAWUL + ...). لو مافلترناش، قطاع زي "الخدمات
        # الصناعية" هيجمع 31 سهم (EGX+السعودية) بدل 15 EGX بس → avg_chg بيهبط.
        market_fund = {
            t: f for t, f in stocks_fund.items()
            if (f.get('market') or '').upper() == market or not f.get('market')
        } if market else stocks_fund
        sector_heat_map = _c2_sector_heat_map(market_fund) if C1_OPPORTUNITY_AVAILABLE else {}
        # P6-SECTOR-ROLE: صنّف دور كل سهم جوه قطاعه (leader/mid/laggard) من
        # change_1d. بيتحسب من نفس الـ market_fund batch (مرة واحدة لكل request).
        # الحقن خفيف: +5% للمضارب في قطاع ساخن قائد، -5% لـ laggard متأخر.
        sector_roles = _c2_classify_sector_roles(market_fund) if C1_OPPORTUNITY_AVAILABLE else {}
        # ملخّص القطاعات السخنة والميتة للـ meta (للـ UI يعرضه لو حابب)
        hot_sectors = [
            {'sector': s, 'avg_chg': v['avg_chg'], 'rising_ratio': v['rising_ratio'],
             'n': v['n'], 'boost': v['boost']}
            for s, v in sector_heat_map.items() if v.get('status') == 'hot'
        ]
        hot_sectors.sort(key=lambda x: -x['avg_chg'])
        dead_sectors = [
            {'sector': s, 'avg_chg': v['avg_chg'], 'rising_ratio': v['rising_ratio'],
             'n': v['n'], 'boost': v['boost']}
            for s, v in sector_heat_map.items() if v.get('status') == 'dead'
        ]
        dead_sectors.sort(key=lambda x: x['avg_chg'])

        # P6-SECTOR-SUMMARY: ملخّص قطاعي ديناميكي كامل (حرارة + اتساع + rank).
        # لكل قطاع: status, n, avg_chg, rising_ratio, leaders/mid/laggards counts,
        # top_leader (أعلى change_1d), top_laggard (أقل change_1d). ده اللي طلبها
        # المالك في P6: "ملخص قطاعي ديناميكي (حرارة، اتساع، rank)". بيتحسب من نفس
        # الـ market_fund batch (مرة واحدة لكل request).
        sector_summary = []
        if C1_OPPORTUNITY_AVAILABLE:
            # جمّع per-sector: list of (ticker, chg, role)
            _per_sector = {}
            for t, f in market_fund.items():
                if not isinstance(f, dict):
                    continue
                sec = f.get('sector')
                if sec in (None, '', '—', 'Diversified', 'diversified', 'غير مصنف', 'N/A', 'nan'):
                    continue
                sec_str = str(sec).strip()
                if not sec_str or sec_str in ('—', 'Diversified', 'diversified', 'غير مصنف', 'N/A', 'nan'):
                    continue
                chg = float(f.get('change_1d') or 0)
                role = sector_roles.get(t, 'mid')
                _per_sector.setdefault(sec_str, []).append((t, chg, role))
            for sec_str, items in _per_sector.items():
                hm = sector_heat_map.get(sec_str, {})
                leaders = [it for it in items if it[2] == 'leader']
                laggards = [it for it in items if it[2] == 'laggard']
                mids = [it for it in items if it[2] == 'mid']
                top_leader = max(items, key=lambda x: x[1]) if items else None
                top_laggard = min(items, key=lambda x: x[1]) if items else None
                sector_summary.append({
                    'sector': sec_str,
                    'status': hm.get('status', 'neutral'),
                    'n': len(items),
                    'avg_chg': hm.get('avg_chg', 0.0),
                    'rising_ratio': hm.get('rising_ratio', 0.0),
                    'boost': hm.get('boost', 0.0),
                    'leaders': len(leaders),
                    'mids': len(mids),
                    'laggards': len(laggards),
                    'top_leader': top_leader[0] if top_leader else None,
                    'top_leader_chg': round(top_leader[1], 2) if top_leader else 0.0,
                    'top_laggard': top_laggard[0] if top_laggard else None,
                    'top_laggard_chg': round(top_laggard[1], 2) if top_laggard else 0.0,
                })
            # رتّب: السخنة الأول، بعدين أعلى avg_chg
            _status_order = {'hot': 0, 'neutral': 1, 'dead': 2}
            sector_summary.sort(key=lambda x: (_status_order.get(x['status'], 1), -x['avg_chg']))

        formatted = []
        for r in results:
            ticker = r['ticker']
            ticker_upper = (ticker or '').upper()
            fund = stocks_fund.get(ticker_upper, {})
            current_price = fund.get('current_price') or _get_current_price(ticker)
            recommendation = (r.get('recommendation') or '').lower()
            is_buy = recommendation in ('buy', 'strong_buy', 't1_buy', 'swing_buy')

            # P26-PERSONA-SEPARATION: اقرأ analysis_json بدري عشان نلاقي persona_rr
            # (target_pct/stop_pct لكل persona). ده اللي بيخلي المضارب والمستثمر
            # يطلعوا أرقام مختلفة — بنطبّق نسب الشخصية المطلوبة على السعر الحي.
            _parsed_aj = {}
            if r.get('analysis_json'):
                try:
                    _parsed_aj = json.loads(r['analysis_json']) or {}
                except Exception:
                    _parsed_aj = {}
            _persona_rr = _parsed_aj.get('persona_rr') or {}
            # الشخصية الفعّالة: الـ persona المطلوبة من الـ request، أو 'balanced'.
            _active_persona = persona or 'balanced'
            # لو الـ persona المطلوبة مش في persona_rr، جرّب 'balanced' كـ fallback.
            _rr_for_persona = _persona_rr.get(_active_persona) or _persona_rr.get('balanced') or {}

            # =====================================================================
            # P26-PERSONA-SEPARATION: حساب entry/target/stop persona-aware.
            # ---------------------------------------------------------------------
            # قبل كده كان الكود بيحسب entry/target/stop بنسب ثابتة (8% وقف / 10% هدف)
            # لكل الأسهم وكل الشخصيات — ده كان الـ "Fallback الموحد" اللي بيخلي
            # المضارب والمستثمر يطلعوا نفس الأرقام. دلوقتي:
            #   1. لو عندنا persona_rr للشخصية المطلوبة → نطبّق نسبها على السعر الحي.
            #   2. غير كده → نستخدم القيم المخزّنة (target_price/stop_loss columns).
            #   3. كـ آخر احتياط → نسب ثابتة (backward compat للـ rows القديمة).
            # =====================================================================
            _tp_pct = None
            _sl_pct = None
            if _rr_for_persona:
                try:
                    _tp_pct = float(_rr_for_persona.get('target_pct') or 0)
                    _sl_pct = float(_rr_for_persona.get('stop_pct') or 0)
                except (TypeError, ValueError):
                    _tp_pct = None
                    _sl_pct = None

            if current_price > 0 and _tp_pct and _sl_pct and _tp_pct > 0 and _sl_pct > 0:
                # P26: نسب الشخصية المطلوبة مطبّقة على السعر الحي.
                entry_price = round(current_price * 0.995, 3) if is_buy else round(current_price, 3)
                stop_loss = round(entry_price * (1 - _sl_pct / 100.0), 3)
                target_price = round(entry_price * (1 + _tp_pct / 100.0), 3)
            elif current_price > 0:
                # fallback: نسب ثابتة (للـ rows القديمة اللي مفيهاش persona_rr).
                if is_buy:
                    entry_price = round(current_price * 0.995, 3)
                    stop_loss = round(entry_price * (1 - 8.0 / 100), 3)
                    target_price = round(entry_price * (1 + 10.0 / 100), 3)
                else:
                    entry_price = round(current_price, 3)
                    stop_loss = round(entry_price * 0.92, 3)
                    target_price = round(entry_price * 1.10, 3)
            else:
                entry_price = r['entry_price']
                stop_loss = r['stop_loss']
                target_price = r['target_price']

            risk_reward = round((target_price - entry_price) / (entry_price - stop_loss), 2) if (entry_price > 0 and stop_loss > 0 and entry_price > stop_loss) else 0.0

            # P16-DELAY-COMPENSATION: تعويض تأخير البيانات 5 دقايق (EGX intraday BUY)
            _delay_comp = False
            if is_buy and _is_egx_intraday_now():
                try:
                    if entry_price > 0 and stop_loss > 0 and stop_loss < entry_price:
                        _risk_dist = entry_price - stop_loss
                        stop_loss = round(entry_price - (_risk_dist * 0.85), 3)
                    if entry_price > 0 and target_price > entry_price:
                        _reward_dist = target_price - entry_price
                        target_price = round(entry_price + (_reward_dist * 1.05), 3)
                    risk_reward = round((target_price - entry_price) / (entry_price - stop_loss), 2) if (entry_price > 0 and stop_loss > 0 and entry_price > stop_loss) else 0.0
                    _delay_comp = True
                except Exception:
                    _delay_comp = False

            item = {
                'id': r['id'],
                'ticker': r['ticker'],
                'market': r['market'],
                'maestroScore': r['maestro_score'],
                'recommendation': r['recommendation'],
                'recommendationAr': r['recommendation_ar'] or get_recommendation_ar(r['recommendation']),
                'confidence': r['confidence'],
                'entry': {
                    'price': entry_price,
                    'target': target_price,
                    'stopLoss': stop_loss,
                    'riskReward': risk_reward,
                    'delayCompensation': _delay_comp
                },
                'regime': {
                    'phase': r['regime'] or 'range',
                    'score': r['regime_score'] or 50
                },
                'timeframe': {
                    'aligned': bool(r['timeframe_aligned']),
                    'count': r['timeframe_count']
                },
                'volume': {
                    'ratio': r['volume_ratio'],
                    'liquidityRating': r['liquidity_rating']
                },
                'updatedAt': r['updated_at'],
                # P26-PERSONA-SEPARATION: الأفق الزمني للشخصية الفعّالة (للواجهة).
                'personaHorizon': _rr_for_persona.get('horizon', '') if _rr_for_persona else '',
                # C5-PERSONA-REASON (v3.67.0): سبب التوصية مختلف لكل persona.
                'personaReason': _build_persona_reason(
                    persona or 'balanced', fund, r, _rr_for_persona or {}
                ),
                # P16-PERSONA-DIVERGENCE: نعرض بيانات الأساسيات/المومنتم للـ frontend
                'fundamentals': _build_fundamentals_with_sector_heat(fund, r, sector_heat_map, sector_roles),
            }

            # 🔥 P0-UI FIX: STALE/MISMATCH validation
            # الـ frontend بـ يخلط current_price (live من stocks.db) مع
            # entry/target/stop (stale من stored_analyses). لو السعر الحي
            # بعيد عن entry بـ >20% → التوصية قديمة. لو BUY والسعر فوق target
            # → الهدف اتحقق فعلاً ومفروض ما تظهرش كفرصة جديدة.
            _stored_entry = float(r.get('entry_price') or 0)
            _stored_target = float(r.get('target_price') or 0)
            _stored_stop = float(r.get('stop_loss') or 0)
            item['stale'] = False
            item['stalePct'] = 0.0
            item['priceTargetMismatch'] = False
            item['staleReason'] = ''
            if current_price > 0 and _stored_entry > 0:
                _stale_pct = abs(current_price - _stored_entry) / _stored_entry * 100.0
                item['stalePct'] = round(_stale_pct, 1)
                if _stale_pct > 20.0:
                    item['stale'] = True
                    item['staleReason'] = (
                        f"السعر الحي ({current_price:.2f}) بعيد عن سعر الدخول المسجّل "
                        f"({_stored_entry:.2f}) بنسبة {_stale_pct:.1f}% — التوصية قديمة"
                    )
                # BUY: لو السعر الحالي فوق الهدف → الهدف اتحقق، التوصية منتهية
                if is_buy and _stored_target > 0 and current_price >= _stored_target:
                    item['priceTargetMismatch'] = True
                    item['staleReason'] = (
                        f"السعر الحالي ({current_price:.2f}) ≥ الهدف ({_stored_target:.2f}) "
                        f"— الهدف محقّق فعلاً، التوصية منتهية"
                    )
                # SELL: لو السعر الحالي تحت الهدف → الهدف اتحقق
                elif (not is_buy) and _stored_target > 0 and current_price <= _stored_target:
                    item['priceTargetMismatch'] = True
                    item['staleReason'] = (
                        f"السعر الحالي ({current_price:.2f}) ≤ الهدف ({_stored_target:.2f}) "
                        f"— الهدف محقّق فعلاً، التوصية منتهية"
                    )

            if _parsed_aj:
                item['analysisJson'] = _heal_persona_json(_parsed_aj, r, fund=fund)
            elif r.get('analysis_json'):
                try:
                    parsed = json.loads(r['analysis_json'])
                except Exception:
                    parsed = {}
                item['analysisJson'] = _heal_persona_json(parsed, r, fund=fund)

            formatted.append(item)

        # P16-PERSONA-DIVERGENCE: لو persona محددة، نطبّق فلتر Python وترتيب مختلف
        # C1-PERSONA-OPPORTUNITY (v3.48.0): فلتر صارم بـ is_*_opportunity فقط —
        # شلنا الـ fallback القديم `OR volume_ratio >= 1.5` و `OR pe∈[5,20]+roe>=10`
        # لأنه كان بيفلّر جودة الـ quality gate. لو النتيجة 0، بيرجع لكل الأسهم
        # مرتّب بالـ persona rank (للـ UX — الواجهة متفضّش فاضية).
        # C2-SECTOR-HEAT (v3.49.0): ترتيب المضارب بقت بـ gambler_rank_score_boosted
        # (الأصلي × (1 + boost القطاع)). المستثمر بيفضل بـ investor_rank_score زي ما هو.
        if persona:
            if persona == 'gambler':
                # فلتر: is_gambler_opportunity فقط (بتشمل live filter + quality gate + confirmation)
                if not persona_filter_applied_in_sql:
                    filtered = [
                        it for it in formatted
                        if it.get('fundamentals') and it['fundamentals'].get('is_gambler_opportunity')
                    ]
                else:
                    filtered = formatted
                # ترتيب: درجة المضارب المُعزَّزة بالقطاع (C2). لو الـ boosted مش موجود
                # (module مش متاح)، نرجع للـ raw rank — الـ fallback شفاف.
                filtered.sort(
                    key=lambda it: (it.get('fundamentals') or {}).get(
                        'gambler_rank_score_boosted'
                    ) or (it.get('fundamentals') or {}).get('gambler_rank_score', 0),
                    reverse=True,
                )
            elif persona == 'conservative':
                # P26: conservative = المستثمر طويل الأجل (أساسيات + قيمة عادلة).
                # فلتر: is_investor_opportunity فقط (بتشمل live filter + quality gate + fundamental/fallback)
                if not persona_filter_applied_in_sql:
                    filtered = [
                        it for it in formatted
                        if it.get('fundamentals') and it['fundamentals'].get('is_investor_opportunity')
                    ]
                else:
                    filtered = formatted
                # ترتيب: درجة المستثمر (قيمة عادلة + أساسيات + استقرار) تنازلياً.
                # C2: مفيش sector boost للمستثمر (مش ثيم مضاربة).
                filtered.sort(
                    key=lambda it: (it.get('fundamentals') or {}).get('investor_rank_score', 0),
                    reverse=True,
                )
            else:  # balanced — فلتر بـ is_balanced_opportunity + ترتيب بـ balanced_rank_score
                # C3-BALANCED (v3.67.0): المتوازن بقى له فلتر وترتيب خاصين،
                # مش بس "عرض عام". ده اللي بيخلّي الشخصيات الثلاثة مميزة فعلياً.
                if not persona_filter_applied_in_sql:
                    filtered = [
                        it for it in formatted
                        if it.get('fundamentals') and it['fundamentals'].get('is_balanced_opportunity')
                    ]
                else:
                    filtered = formatted
                # ترتيب: درجة المتوازن (0.5×gambler + 0.5×investor) تنازلياً.
                filtered.sort(
                    key=lambda it: (it.get('fundamentals') or {}).get('balanced_rank_score', 0),
                    reverse=True,
                )
            # P26-PERSONA-SEPARATION: لو الفلتر رجّع 0 نتائج (مثلاً الـ opportunity
            # flags مش مت setters على rows الـ manual trigger)، ارجع لكل الأسهم
            # مرتّبة بالـ persona rank. ده بيضمن إن الواجهة دايماً بتعرض بيانات،
            # والـ persona_rr بيفردل الأرقام مختلفة لكل persona.
            if not filtered:
                filtered = formatted
                if persona == 'gambler':
                    filtered.sort(
                        key=lambda it: (it.get('fundamentals') or {}).get(
                            'gambler_rank_score_boosted'
                        ) or (it.get('fundamentals') or {}).get('gambler_rank_score', 0),
                        reverse=True,
                    )
                elif persona == 'conservative':
                    filtered.sort(
                        key=lambda it: (it.get('fundamentals') or {}).get('investor_rank_score', 0),
                        reverse=True,
                    )
                else:  # balanced fallback — ترتيب بـ balanced_rank_score
                    filtered.sort(
                        key=lambda it: (it.get('fundamentals') or {}).get('balanced_rank_score', 0),
                        reverse=True,
                    )
            formatted = filtered[:limit]
            total = len(filtered)

        return jsonify({
            'success': True,
            'data': formatted,
            'meta': {
                'total': total,
                'market': market,
                'lastUpdated': last_updated,
                # P16-PERSONA-DIVERGENCE: metadata للشفافية
                'persona': persona,
                'personaFilterApplied': bool(persona),
                'personaDivergence': True,
                # C2-SECTOR-HEAT: ملخّص القطاعات السخنة/الميتة للـ UI.
                # الـ UI يقدر يعرض "🔥 القطاعات السخنة" banner من hot_sectors.
                'sectorHeat': {
                    'hot': hot_sectors,
                    'dead': dead_sectors,
                    'totalSectors': len(sector_heat_map),
                    'note': _C2_SECTOR_HEAT_NOTE if C1_OPPORTUNITY_AVAILABLE else '',
                } if C1_OPPORTUNITY_AVAILABLE else None,
                # P6-SECTOR-SUMMARY: ملخّص قطاعي ديناميكي كامل (حرارة + اتساع + rank).
                # لكل قطاع: status, n, avg_chg, rising_ratio, leaders/mid/laggards,
                # top_leader/top_laggard. الـ UI يقدر يبني منه "لوحة القطاعات".
                'sectorSummary': sector_summary if C1_OPPORTUNITY_AVAILABLE else [],
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# LIVE-TRACKING (v3.66.9): لوحة متابعة التوقعات الحية
# ============================================================================
# المشكلة (إنتاجي — invist.m2y.net): الـ #recommendations screen ما بتتحدثش
# خلال الجلسة. الأسعار والتوقعات ثابتة. السبب:
#   1. الـ frontend كان بيعمل N+1 requests (3 persona + N per-ticker price fetches)
#   2. الـ frontend كان بيحسب WIN/LOSS/PENDING في المتصفح (مخالف لقاعدة "Node = display only")
#   3. الـ auto-refresh كان كل 5 دقايق (بطيء جداً للـ live tracking)
#
# الحل: endpoint واحد بيرجع كل حاجة pre-computed من Python:
#   - predictions: { conservative: [5], balanced: [5], gambler: [5] }
#   - stats: { total, wins, losses, pending, win_rate }
#   - market_session: { is_open, server_time, next_refresh_seconds }
#   - last_updated: ISO timestamp
#
# الـ frontend بـ poll ده كل 60 ثانية خلال الجلسة / 300 ثانية بعدها — display only.
# ============================================================================

def _compute_prediction_outcome(current_price, entry_price, target_price, stop_loss, signal=''):
    """يحسب نتيجة التوقع (WIN/LOSS/PENDING) + PnL% — كل المنطق في Python.

    قواعد الحساب (direction-aware — Closed-Loop A5):
      BUY/STRONG_BUY/ACCUMULATE:
        - WIN  (كسب):   current_price >= target_price  (الهدف فوق الدخول)
        - LOSS (خسر):   current_price <= stop_loss      (الوقف تحت الدخول)
        - PnL  = (current - entry) / entry × 100
      SELL/STRONG_SELL/REDUCE:
        - WIN  (كسب):   current_price <= target_price  (الهدف تحت الدخول)
        - LOSS (خسر):   current_price >= stop_loss      (الوقف فوق الدخول)
        - PnL  = (entry - current) / entry × 100
      PENDING: بين الهدف والوقف (أو نقص بيانات)

    ملاحظة مهمة: قبل كده كانت الدالة بـ تفترض BUY دايماً → SELL بـ يطلّع WIN
    خاطئ لأن target تحت entry فـ current >= target دايماً صح. ده كان بـ يكسر
    معيار القبول #5 (لا WIN على SELL عندما السعر يتحرك ضد البيع).
    """
    try:
        cp = float(current_price) if current_price else 0.0
        ep = float(entry_price) if entry_price else 0.0
        tp = float(target_price) if target_price else 0.0
        sl = float(stop_loss) if stop_loss else 0.0
    except (TypeError, ValueError):
        return 'PENDING', None

    if cp <= 0 or ep <= 0:
        return 'PENDING', None

    sig = (signal or '').upper().strip()
    is_buy = sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')

    if is_buy:
        pnl_pct = round(((cp - ep) / ep) * 100, 2)
        if tp > 0 and cp >= tp:
            return 'WIN', pnl_pct
        if sl > 0 and cp <= sl:
            return 'LOSS', pnl_pct
    else:  # SELL / STRONG_SELL / REDUCE
        pnl_pct = round(((ep - cp) / ep) * 100, 2)
        if tp > 0 and cp <= tp:
            return 'WIN', pnl_pct
        if sl > 0 and cp >= sl:
            return 'LOSS', pnl_pct
    return 'PENDING', pnl_pct


def _calc_freshness_minutes(updated_at_str):
    """يحسب كم دقيقة مضت منذ updated_at — None لو التاريخ مش صالح."""
    if not updated_at_str:
        return None
    try:
        # stored_analyses.updated_at بتتبقى بصيغة 'YYYY-MM-DD HH:MM:SS' (SQLite)
        updated = datetime.strptime(str(updated_at_str)[:19], '%Y-%m-%d %H:%M:%S')
        diff = datetime.now() - updated
        minutes = int(diff.total_seconds() / 60)
        return max(0, minutes)
    except Exception:
        return None


@stored_analysis_bp.route('/live-tracking', methods=['GET'])
def get_live_tracking():
    """لوحة متابعة التوقعات الحية — كل المنطق في Python، Node = display only.

    المصدر الوحيد للحقيقة: جدول `predictions` (append-only + persona + outcome
    columns + daily_closer بيقفله). الشاشة بـ تعرض:
      - التوقعات المقفولة (WIN/LOSS/EXPIRED) بالعائد الفعلي المحفوظ.
      - التوقعات المفتوحة (PENDING) بالحالة الحية من السعر الحالي.
    النسبة والإحصاءات بـ تتحسب على المقفل فقط (مش على المعلّق).

    Query params:
      - market (default EGX)
      - days   (default 30 — 7/30/90 — نافذة زمنية على تاريخ التوقع)
      - limit  (default 10 — max predictions per persona)

    Response:
      {
        "success": true,
        "predictions": { "gambler": [...], "balanced": [...], "conservative": [...] },
        "stats": { total, wins, losses, pending, settled, winRate, avgWinPct,
                   avgLossPct, profitFactor, closedCount },
        "statsByPersona": { gambler: {...}, balanced: {...}, conservative: {...} },
        "market_session": { is_open, server_time, next_refresh_seconds, session_name },
        "last_updated": "ISO",
        "source": "python-live-tracking-v2"
      }

    كل item:
      { ticker, nameAr, persona, signal, entryDate, entryPrice, targetPrice,
        stopLoss, currentPrice, outcome, returnPct, daysSinceEntry, closedAt,
        exitPrice, maestroScore, confidence, reason }
    """
    try:
        market = (request.args.get('market') or 'EGX').upper().strip()
        try:
            days_window = int(request.args.get('days', 30))
        except (ValueError, TypeError):
            days_window = 30
        # RL-FIX-8: رفعنا الـ per-persona cap من 200 لـ 2000 علشان الـ Executive Report
        # يقدر يبني ملخصه على بيانات تاريخية كاملة (من 1/1/2026 للآن) بدل ما يبقى
        # محصور في أحدث 200 سطر بس (اللي كلها من نفس اليوم → الأرقام ما بتتغيرش
        # مع تغيير الفترة الزمنية). limit=0 معناها "بدون حد أقصى" (لحد 5000).
        try:
            _req_limit = int(request.args.get('limit', 50))
            if _req_limit <= 0:
                limit_per_persona = 5000  # "all" mode for summary report
            else:
                limit_per_persona = max(1, min(2000, _req_limit))
        except (ValueError, TypeError):
            limit_per_persona = 50

        conn = get_predictions_db()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # 🔥 P0-fix v2: schema-safe data_quality + HARD return cap (defense-in-depth).
        # الـ toxic rows (actual_return ≈ -10814%) بقت تـ exclude من win/loss COUNT
        # + averages عبر HARD cap |actual_return| <= 50 في WHERE نفسها (مش بس في
        # حساب المتوسطات). data_quality clause اختياري (schema-aware) — لو العمود
        # مش موجود (قبل purge) الـ route ما بـ يكسرش، بـ ي relied على الـ HARD cap.
        try:
            _cols = {r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()}
        except Exception:
            _cols = set()
        _has_dq = 'data_quality' in _cols
        # RL-FIX-6: schema-safe target_price_2 select (المستهدف الثاني)
        _has_tp2 = 'target_price_2' in _cols
        # FIX-5A: schema-safe highest/lowest price reached — لعرض أقصى ربح/خسارة
        # في الـ frontend. الأعمدة دي موجودة في production (migrated من daily_closer)
        # بس مش بالضرورة موجودة في كل DB محلي.
        _has_hpr = 'highest_price_reached' in _cols
        _has_lpr = 'lowest_price_reached' in _cols
        _dq_sel = ", data_quality" if _has_dq else ""
        _tp2_sel = ", target_price_2" if _has_tp2 else ""
        _hpr_sel = ", highest_price_reached" if _has_hpr else ""
        _lpr_sel = ", lowest_price_reached" if _has_lpr else ""
        _dq_where = " AND (data_quality = 'clean' OR data_quality IS NULL)" if _has_dq else ""
        _cap_where = " AND (actual_return IS NULL OR ABS(actual_return) <= 50)"

        # CL7-UI-SECTORS (Time Filter Truth): النافذة الزمنية بـ تتطبّق على
        # الحقل الصحيح حسب حالة الصفقة:
        #   - المقفولة (outcome_date IS NOT NULL) → فلتر على outcome_date
        #     (تاريخ الإغلاق الرسمي). كده صفقة اتقفلت النهارده بس دخلتها من 60 يوم
        #     تظهر في نافذة 7/30 يوم لو الإغلاق داخل النافذة.
        #   - المعلّقة (outcome_date IS NULL) → فلتر على created_at
        #     (تاريخ التوقع). كده التوقعات القديمة المفتوحة تختفي من النافذة.
        # قبل كده كان الفلتر على (created_at OR prediction_date) للكل → صفقات مقفولة
        # حديثاً بس دخولها قديم كانت بتختفي غلط، وتوقعات معلّقة من شهر كانت بتظهر
        # في نافذة 7 أيام غلط.
        _m_sql = "1=1"
        _m_params = []
        if market in ('EGX', 'EGYPT', 'مصر'):
            _m_sql = "((market IN ('EGX', 'EGYPT', 'مصر') OR (market IS NULL AND ticker NOT GLOB '[0-9]*')) AND ticker NOT GLOB '[0-9]*')"
        elif market in ('TADAWUL', 'KSA', 'SAUDI', 'السعودية'):
            _m_sql = "(market IN ('TADAWUL', 'KSA', 'SAUDI', 'السعودية') OR ticker GLOB '[0-9]*')"
        elif market in ('KSE', 'KWT', 'KUWAIT', 'الكويت'):
            _m_sql = "market IN ('KSE', 'KWT', 'KUWAIT', 'الكويت')"
        elif market in ('QSE', 'QATAR', 'قطر'):
            _m_sql = "market IN ('QSE', 'QATAR', 'قطر')"
        elif market in ('CRYPTO', 'BINANCE'):
            _m_sql = "market IN ('CRYPTO', 'BINANCE')"
        elif market in ('US', 'USA', 'NASDAQ', 'NYSE'):
            _m_sql = "market IN ('US', 'USA', 'NASDAQ', 'NYSE')"
        elif market not in ('ALL', ''):
            _m_sql = "market = ?"
            _m_params.append(market)

        if days_window > 0 and days_window < 999:
            cutoff = (datetime.now() - timedelta(days=days_window)).strftime('%Y-%m-%d')
            cursor.execute(
                "SELECT id, ticker, persona, signal, signal_type, "
                "prediction_date, created_at, entry_price, target_price, stop_loss, "
                "master_score, confidence, market, "
                "outcome_date, actual_return, actual_exit_price, is_correct, "
                f"exit_type, holding_days{_dq_sel}{_tp2_sel}{_hpr_sel}{_lpr_sel} "
                "FROM predictions "
                f"WHERE {_m_sql} "
                "  AND ( "
                "        (outcome_date IS NOT NULL AND substr(outcome_date, 1, 10) >= ?"
                f"{_dq_where}{_cap_where}) "
                "        OR "
                "        (outcome_date IS NULL AND substr(created_at, 1, 10) >= ?) "
                "      ) "
                "ORDER BY created_at DESC "
                "LIMIT 15000",
                tuple(_m_params + [cutoff, cutoff]),
            )
        else:
            cursor.execute(
                "SELECT id, ticker, persona, signal, signal_type, "
                "prediction_date, created_at, entry_price, target_price, stop_loss, "
                "master_score, confidence, market, "
                "outcome_date, actual_return, actual_exit_price, is_correct, "
                f"exit_type, holding_days{_dq_sel}{_tp2_sel}{_hpr_sel}{_lpr_sel} "
                "FROM predictions "
                f"WHERE {_m_sql} "
                "  AND ( "
                "        (outcome_date IS NOT NULL"
                f"{_dq_where}{_cap_where}) "
                "        OR outcome_date IS NULL "
                "      ) "
                "ORDER BY created_at DESC "
                "LIMIT 20000",
                tuple(_m_params),
            )
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()

        # Batch-load stocks data (name) from stocks.db
        stocks_fund = _load_stocks_fundamentals_batch()
        tickers = [r.get('ticker', '') for r in rows]
        names_map = {}
        try:
            sconn = sqlite3.connect(STOCKS_DB)
            sconn.row_factory = sqlite3.Row
            scur = sconn.cursor()
            if tickers:
                placeholders = ','.join(['?'] * len(tickers))
                scur.execute(
                    "SELECT ticker, name_ar, name FROM stocks WHERE ticker IN (" + placeholders + ")",
                    tickers,
                )
                for sr in scur.fetchall():
                    names_map[sr['ticker']] = sr['name_ar'] or sr['name'] or sr['ticker']
            sconn.close()
        except Exception:
            pass

        # Build items + classify by persona
        buckets = {'gambler': [], 'balanced': [], 'conservative': []}
        all_items = []

        for r in rows:
            ticker = r.get('ticker', '')
            current_price = _get_current_price(ticker)
            entry_price = float(r.get('entry_price') or 0)
            target_price = float(r.get('target_price') or 0)
            # RL-FIX-6: المستهدف الثاني (target_price_2) — schema-safe
            target_price_2 = float(r.get('target_price_2') or 0)
            stop_loss = float(r.get('stop_loss') or 0)
            persona = (r.get('persona') or 'balanced').strip().lower()
            if persona == 'investor':
                persona = 'conservative'
            if persona not in ('gambler', 'balanced', 'conservative'):
                persona = 'balanced'

            # Determine outcome + returnPct + exit info
            # ── CLOSED-LOOP RULE (إلزامي — القاعدة 2 و5): ──
            # WIN/LOSS النهائي يُعلن فقط من الحقول المحفوظة بعد closer
            # (outcome_date + exit_type + actual_return). ما دام outcome_date
            # فاضي → الحالة PENDING فقط. الـ live PnL يُعرض كـ "preview" ولا
            # يدخل في نسبة النجاح. ده يمنع "شهادة زائفة" WIN + closedAt=null.
            #
            # RL-FIX-6: أضفنا liveOutcome كـ "preview" منفصل عن outcome الرسمي.
            # ده علشان المالك يقدر يشوف حالة الصفقة الحية (WIN/LOSS/PENDING)
            # بناءً على السعر الحالي — بدون ما نعلن WIN رسمي قبل الـ daily_closer.
            outcome_date = r.get('outcome_date')
            exit_type = (r.get('exit_type') or '').strip().lower()
            if outcome_date:
                # CLOSED — use persisted outcome (المصدر الوحيد للحقيقة)
                # HONEST-WIN (RL-FIX-16): WIN = actual_return > 0 (ربح فعلي، مش مجرد
                # ضرب الهدف). ده يمنع "شهادة زائفة" لما target يضرب لكن الصفقة تقفل
                # على خسارة (trailing stop خاسر، أو ارتداد بعد الهدف). قبل الإصلاح:
                # 103 توقع اتصنّفوا WIN كاذبة (exit_type=target_hit لكن actual_return<=0)
                # → winRate وهمي 53% بدل الحقيقي 36%. دلوقتي Python API يطابق Next.js.
                return_pct = float(r.get('actual_return') or 0)
                if return_pct > 0:
                    outcome = 'WIN'
                elif return_pct < 0:
                    outcome = 'LOSS'
                elif exit_type == 'expired':
                    outcome = 'EXPIRED'
                else:
                    # actual_return == 0 → fallback لـ is_correct
                    outcome = 'WIN' if r.get('is_correct') == 1 else ('LOSS' if r.get('is_correct') == 0 else 'EXPIRED')
                exit_price = float(r.get('actual_exit_price') or 0)
                closed_at = outcome_date
                days_since = int(r.get('holding_days') or 0)
                # LIVE preview = official outcome for closed trades
                live_outcome = outcome
            else:
                # OPEN — PENDING فقط (ممنوع إعلان WIN/LOSS على الهواء).
                # نحسب live PnL للعرض الحي كـ "preview" لكن الـ outcome يظل PENDING.
                live_outcome, live_pnl = _compute_prediction_outcome(
                    current_price, entry_price, target_price, stop_loss,
                    signal=r.get('signal') or '',
                )
                # الـ live_pnl للعرض فقط — الـ outcome دايماً PENDING لما مفيش إغلاق رسمي
                outcome = 'PENDING'
                return_pct = live_pnl if live_pnl is not None else 0.0
                exit_price = 0
                closed_at = None
                try:
                    created = r.get('created_at') or r.get('prediction_date') or ''
                    created_dt = datetime.strptime(str(created)[:19].replace('T', ' '), '%Y-%m-%d %H:%M:%S')
                    days_since = max(0, (datetime.now() - created_dt).days)
                except Exception:
                    days_since = 0

            # Build reason (Arabic, from Python)
            if outcome == 'WIN':
                reason = f'هدف محقّق +{return_pct:.1f}%'
            elif outcome == 'LOSS':
                reason = f'ضرب وقف الخسارة {return_pct:.1f}%'
            elif outcome == 'EXPIRED':
                reason = f'انتهاء المدة ({days_since} يوم) — العائد {return_pct:.1f}%'
            else:
                # PENDING — live PnL للعرض فقط (مش إعلان WIN/LOSS)
                sign = '+' if return_pct >= 0 else ''
                reason = f'بانتظار الإغلاق الرسمي — الحالي {sign}{return_pct:.1f}% (غير محسوم)'

            item = {
                'ticker': ticker,
                'nameAr': names_map.get(ticker, ticker),
                'persona': persona,
                'signal': r.get('signal') or '',
                'entryDate': (r.get('prediction_date') or str(r.get('created_at') or '')[:10]),
                'entryPrice': round(entry_price, 3) if entry_price else 0,
                'targetPrice': round(target_price, 3) if target_price else 0,
                # RL-FIX-6: المستهدف الثاني (target_price_2)
                'targetPrice2': round(target_price_2, 3) if target_price_2 else 0,
                'stopLoss': round(stop_loss, 3) if stop_loss else 0,
                'currentPrice': round(current_price, 3) if current_price else 0,
                'outcome': outcome,
                # RL-FIX-6: live outcome preview (WIN/LOSS/PENDING) من السعر الحالي
                'liveOutcome': live_outcome,
                'returnPct': round(return_pct, 2),
                'daysSinceEntry': days_since,
                'closedAt': closed_at,
                # RL-FIX-6: تاريخ التنفيذ (alias واضح لـ closedAt)
                'executionDate': closed_at,
                'exitPrice': round(exit_price, 3) if exit_price else 0,
                'maestroScore': float(r.get('master_score') or 0),
                'confidence': float(r.get('confidence') or 0),
                'reason': reason,
                # FIX-5A: highest/lowest price reached + exit_type — لعرض أقصى ربح/خسارة
                # في الـ frontend. الـ exit_type بيـ يستخدم لتمييز TRAILING_PROFIT (💰 خرج
                # بربح) عن WIN العادي. الـ highest/lowest بـ يدخلوا في حساب maxProfit/maxLoss.
                'highest_price_reached': float(r.get('highest_price_reached') or 0),
                'lowest_price_reached': float(r.get('lowest_price_reached') or 0),
                'exit_type': exit_type,
                # FIX-5A: المستهدف الثاني (target_price_2) بـ صيغة snake_case للتوافق مع
                # الـ honest-tracking/list endpoint. الـ TS بـ يستخدم targetPrice2.
                'target_price_2': round(target_price_2, 3) if target_price_2 else 0,
            }

            all_items.append(item)
            if len(buckets[persona]) < limit_per_persona:
                buckets[persona].append(item)

        # Compute honest stats — on CLOSED only (WIN + LOSS; EXPIRED لا يدخل في النسبة)
        # 🔥 P0-UI FIX: defense-in-depth — حتى لو data_quality='clean'، بنضرب cap
        # على |return_pct| بـ 50% في حساب الـ averages. ده يمنع أي toxic متأقّل
        # من إنه يخرب المتوسطات. الـ raw returnPct بيفضل يظهر في الجدول للأمانة.
        _RETURN_CAP = 50.0  # نسبة %
        def _stats(items):
            wins = [i for i in items if i['outcome'] == 'WIN']
            losses = [i for i in items if i['outcome'] == 'LOSS']
            expired = [i for i in items if i['outcome'] == 'EXPIRED']
            pending = [i for i in items if i['outcome'] == 'PENDING']
            settled = wins + losses
            total = len(items)
            closed_count = len(settled)
            win_rate = round((len(wins) / closed_count) * 100, 1) if closed_count > 0 else 0.0
            # cap الـ returns في حساب الـ averages بس (مش في عرض الجدول)
            capped_wins = [max(-_RETURN_CAP, min(_RETURN_CAP, i['returnPct'])) for i in wins]
            capped_losses = [max(-_RETURN_CAP, min(_RETURN_CAP, i['returnPct'])) for i in losses]
            avg_win = round(sum(capped_wins) / len(capped_wins), 2) if capped_wins else 0.0
            avg_loss = round(sum(capped_losses) / len(capped_losses), 2) if capped_losses else 0.0
            gross_profit = sum(capped_wins)
            gross_loss = abs(sum(capped_losses))
            profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)
            # عدّ toxic rows اللي اتعدّلت (للشفافية)
            toxic_wins = sum(1 for i in wins if abs(i['returnPct']) > _RETURN_CAP)
            toxic_losses = sum(1 for i in losses if abs(i['returnPct']) > _RETURN_CAP)
            return {
                'total': total,
                'wins': len(wins),
                'losses': len(losses),
                'expired': len(expired),
                'pending': len(pending),
                'settled': closed_count,
                'winRate': win_rate,
                'avgWinPct': avg_win,
                'avgLossPct': avg_loss,
                'profitFactor': profit_factor,
                'closedCount': closed_count,
                'cappedReturns': toxic_wins + toxic_losses,  # شفافية: كم صف اتعمله cap
                'returnCap': _RETURN_CAP,  # للعرض في الـ UI
            }

        stats = _stats(all_items)
        stats_by_persona = {
            'gambler': _stats([i for i in all_items if i['persona'] == 'gambler']),
            'balanced': _stats([i for i in all_items if i['persona'] == 'balanced']),
            'conservative': _stats([i for i in all_items if i['persona'] == 'conservative']),
        }

        # Market session info
        is_open = _is_egx_intraday_now()
        server_time = datetime.now().isoformat()
        next_refresh = 60 if is_open else 300

        return jsonify({
            'success': True,
            'predictions': buckets,
            'stats': stats,
            'statsByPersona': stats_by_persona,
            'market_session': {
                'is_open': is_open,
                'server_time': server_time,
                'next_refresh_seconds': next_refresh,
                'session_name': 'EGX Intraday' if is_open else 'Closed',
            },
            'last_updated': server_time,
            'source': 'python-live-tracking-v2',
            'market': market,
            'daysWindow': days_window,
        })
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc().splitlines()[-5:],
        }), 500


@stored_analysis_bp.route('/ticker/<ticker>', methods=['GET'])
def get_ticker_analysis(ticker):
    try:
        # P40-MARKET-ISOLATION: فلتر اختياري بالسوق (?market=EGX) عشان نضمن إن
        # السهم اللي بيرجع من السوق المطلوب بس. لو market مش محدد، backward compat.
        market = (request.args.get('market') or '').upper().strip()
        conn = get_predictions_db()
        cursor = conn.cursor()
        if market:
            cursor.execute(
                'SELECT * FROM stored_analyses WHERE ticker = ? AND market = ?',
                (ticker.upper(), market),
            )
        else:
            cursor.execute('SELECT * FROM stored_analyses WHERE ticker = ?', (ticker.upper(),))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return jsonify({'success': False, 'error': f'No analysis found for {ticker}'}), 404
            
        return jsonify({'success': True, 'data': dict(row)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ─── P17 Morning Bell: جرس الصباح — أعلى 3 فرص EGX ────────────────────
# المدير التقني طلب "جرس البورصة الصباحي": العميل يفتح المنصة قبل الجلسة
# بـ 15 دقيقة ويلقى أهم 3 فرص متاحة جاهزة. الـ Endpoint ده بيرجّع أعلى 3
# أسهم EGX من stored_analyses (كل سهم له صف واحد = آخر تحليل) مرتبين بـ
# maestro_score، مع تطبيق تعويض التأخير (P16) لو السوق مفتوح + كشف ATH
# Breakout (P15) للبادج الخضرا في الواجهة.

# استيراد ATH helper من sniper_routes (schema-resilient ضد price_history.db)
try:
    from api.sniper_routes import _is_ath_breakout as _sniper_is_ath_breakout
    _ATH_HELPER_AVAILABLE = True
except Exception as _ath_err:
    print(f"[stored_analysis_routes] ⚠️ _is_ath_breakout not importable: {_ath_err}")
    _ATH_HELPER_AVAILABLE = False

# Blueprint جديد لـ summary endpoints على مستوى السوق (URL: /api/market/*)
market_bp = Blueprint('market', __name__, url_prefix='/api/market')


def _check_morning_bell_market_veto():
    """AXIS-7: فحص فيتو السوق لجرس الصباح — هل السوق هابط؟

    Elite 3 upgrade: لو السوق هابط (EGX30 bear OR breadth < 40%)
    نرجّع True عشان الـ morning bell يبقى في وضع Cash Mode.

    المصادر (مرتّبة حسب الأولوية):
      1. market_regime المخزّن في db/data_engine.db (لو متاح)
      2. benchmark_change من stored_analyses (متوسط stock_roc - benchmark_change)
      3. لو _check_market_breadth_veto مش متاحة في institutional_decision_engine
         → fallback fail-safe (no veto).

    Returns:
        tuple[bool, str]: (vetoed, reason_ar)
            vetoed=True + reason لو السوق هابط (Cash Mode).
            vetoed=False + '' لو السوق سالم (استمر في الشراء).
    """
    try:
        from analyzers.institutional_decision_engine import _check_market_breadth_veto
        # حاول نقرأ market_regime من data_engine.db
        market_regime = None
        benchmark_change = 0.0
        try:
            import os
            de_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                'db', 'data_engine.db'
            )
            if os.path.exists(de_path):
                conn_de = sqlite3.connect(de_path)
                conn_de.row_factory = sqlite3.Row
                cur_de = conn_de.cursor()
                try:
                    cur_de.execute(
                        "SELECT trend, confidence FROM market_regime "
                        "ORDER BY updated_at DESC LIMIT 1"
                    )
                    row = cur_de.fetchone()
                    if row:
                        market_regime = {
                            'trend': row['trend'],
                            'confidence': float(row['confidence'] or 0),
                        }
                except Exception:
                    pass
                conn_de.close()
        except Exception:
            pass

        # fallback: احسب benchmark_change من stored_analyses
        try:
            conn = get_predictions_db()
            cur = conn.cursor()
            cur.execute(
                "SELECT AVG(COALESCE(stock_roc,0) - COALESCE(benchmark_change,0)) "
                "AS avg_diff FROM stored_analyses WHERE market='EGX' LIMIT 50"
            )
            row = cur.fetchone()
            if row and row['avg_diff'] is not None:
                # negative avg_diff = السوق تحت الـ benchmark = هابط
                benchmark_change = -float(row['avg_diff'])
            conn.close()
        except Exception:
            pass

        vetoed, reason = _check_market_breadth_veto(market_regime, benchmark_change)
        return bool(vetoed), str(reason or '')
    except ImportError:
        # _check_market_breadth_veto مش متاحة لسه — no veto (fail-safe)
        return False, ''
    except Exception:
        # أي خطأ تاني — fail-safe (no veto)
        return False, ''


def _get_morning_bell_data(limit: int = 3) -> dict:
    """Core logic لجرس الصباح — بيرجّع dict (بدون Flask dependency).

    P17 Morning Bell: بيجيب أعلى N أسهم EGX من stored_analyses مرتبين بـ
    maestro_score، مفلترين بـ BUY/STRONG_BUY/T1_BUY/SWING_BUY. بيطبّق تعويض
    التأخير (P16) لو السوق مفتوح intraday + بيوفّر flag الـ ATH Breakout
    (P15). لو السوق مقفول → بيرجّع أعلى N من آخر تحليل كـ "فرص الغد".

    بيستخدمها:
    - الـ HTTP endpoint /api/market/morning-bell (للواجهة — P17)
    - الـ Telegram scheduler (للنشر الصباحي 9:45 — P18 Morning Bell Telegram)
    عشان نتجنب تكرار المنطق (DRY) — العقل واحد (Python = THE BRAIN).
    """
    is_live = _is_egx_intraday_now()
    label_ar = '🎯 فرص النهاردة' if is_live else '🌅 فرص الغد (من آخر إغلاق)'

    # AXIS-7: Market veto — لو السوق هابط، ارجع قائمة فاضية (Cash Mode)
    market_vetoed, veto_reason = _check_morning_bell_market_veto()
    if market_vetoed:
        return {
            'success': True,
            'market_status': 'live' if is_live else 'closed',
            'label_ar': '🛡️ وضع الكاش — السوق هابط',
            'stocks': [],
            'note_ar': (
                f'🚫 فيتو السوق: {veto_reason} — لا توصيات شراء اليوم. '
                'احتفظ بالسيولة لحين تحسن السوق.'
            ),
            'market_vetoed': True,
            'veto_reason': veto_reason,
        }

    conn = get_predictions_db()
    cur = conn.cursor()
    # الـ stored_analyses متعبّية أصلاً بفلترة المحلل الأساسي (السيولة +
    # Pump & Dump Guard شغّالة جوه master_analyzer). هنفصل BUY/STRONG_BUY بس.
    # AXIS-7: نجيب 3× limit من المرشحين، بعدين نصفّي بـ 4-evidence + composite scoring.
    # بياخد top `limit` بعد الترتيب بالـ composite score.
    cur.execute('''
        SELECT ticker, market, maestro_score, recommendation,
               recommendation_ar, confidence, entry_price, target_price,
               stop_loss, risk_reward, volume_ratio, liquidity_rating,
               turnover_egp, updated_at, analysis_json
        FROM stored_analyses
        WHERE market = 'EGX'
          AND recommendation IN ('buy', 'strong_buy', 't1_buy', 'swing_buy')
          AND maestro_score IS NOT NULL
        ORDER BY maestro_score DESC
        LIMIT ?
    ''', (limit * 3,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    # AXIS-7: Filter to ≥4 strong evidences + composite scoring
    _min_evidence = int(_get_engine_setting('morning_bell_min_evidence', default=4) or 4)
    scored_candidates = []
    for r in rows:
        ticker = r['ticker']
        # parse analysis_json for evidence count
        evidence_count = 0
        try:
            aj = json.loads(r.get('analysis_json') or '{}')
            # evidence may be nested under 'institutional' or top-level
            inst = aj.get('institutional') or aj
            ev = inst.get('evidence') or {}
            evidence_count = int(ev.get('strong_count', 0) or 0)
        except Exception:
            evidence_count = 0

        if evidence_count < _min_evidence:
            continue  # skip — not enough evidence (Elite 3 requirement)

        # Composite score: 0.4*maestro + 0.3*RR + 0.2*volume_ratio + 0.1*liquidity
        maestro = float(r.get('maestro_score') or 0)
        rr = float(r.get('risk_reward') or 0)
        vr = float(r.get('volume_ratio') or 0)
        # normalize volume_ratio (cap at 3.0 → /3.0*100)
        vr_norm = min(vr, 3.0) / 3.0 * 100 if vr > 0 else 0
        # normalize liquidity_rating (assume 0-100; fallback 50 لو null/غريب)
        lr_raw = r.get('liquidity_rating')
        try:
            lr = float(lr_raw) if lr_raw is not None else 50.0
        except (TypeError, ValueError):
            lr = 50.0
        composite = (
            0.4 * maestro
            + 0.3 * (min(rr, 5.0) / 5.0 * 100)
            + 0.2 * vr_norm
            + 0.1 * lr
        )
        scored_candidates.append((composite, r, evidence_count))

    # Sort by composite score DESC, take top `limit`
    scored_candidates.sort(key=lambda x: x[0], reverse=True)
    top_candidates = scored_candidates[:limit]

    if not top_candidates:
        return {
            'success': True,
            'market_status': 'live' if is_live else 'closed',
            'label_ar': label_ar,
            'stocks': [],
            'note_ar': (
                'مفيش فرص شراء متاحة دلوقتي بـ 4 أدلة كحد أدنى. '
                'المحلل لسه بيشتغل — حاول تاني بعد دقايق.'
            ),
            'market_vetoed': False,
        }

    # نحمّل fundamentals عشان نجيب name_ar لكل سهم
    fund_batch = _load_stocks_fundamentals_batch()

    stocks = []
    for composite, r, ev_count in top_candidates:
        ticker = r['ticker']
        fund = fund_batch.get(ticker, {}) or {}
        name_ar = fund.get('name_ar') or ticker

        # ATH breakout detection (P15)
        ath_breakout = False
        if _ATH_HELPER_AVAILABLE:
            try:
                ath_breakout = bool(_sniper_is_ath_breakout(ticker))
            except Exception:
                ath_breakout = False

        # Signal
        rec = (r['recommendation'] or 'hold').lower()
        signal_ar = r['recommendation_ar'] or get_recommendation_ar(rec)

        # Entry / Target / Stop + P16 delay compensation
        entry_price = float(r.get('entry_price') or 0)
        target_price = float(r.get('target_price') or 0)
        stop_loss = float(r.get('stop_loss') or 0)
        risk_reward = float(r.get('risk_reward') or 0)
        delay_comp = False

        is_buy = rec in ('buy', 'strong_buy', 't1_buy', 'swing_buy')
        if is_live and is_buy and entry_price > 0 and stop_loss > 0 and target_price > 0:
            # نفس منطق P16: وقف أقرب بـ 15% + هدف أبعد بـ 5%
            sl_dist = entry_price - stop_loss
            tp_dist = target_price - entry_price
            if sl_dist > 0:
                stop_loss = entry_price - sl_dist * 0.85  # -15%
            if tp_dist > 0:
                target_price = entry_price + tp_dist * 1.05  # +5%
            new_risk = entry_price - stop_loss
            new_reward = target_price - entry_price
            if new_risk > 0:
                risk_reward = round(new_reward / new_risk, 2)
                # Rule 54: استخدم canonical compute_risk_reward
                try:
                    from utils.risk_reward import compute_risk_reward
                    risk_reward = compute_risk_reward(entry_price, target_price, stop_loss, fallback=risk_reward)
                except Exception:
                    pass  # keep inline risk_reward computed above
            delay_comp = True

        stocks.append({
            'ticker': ticker,
            'name_ar': name_ar,
            'signal': rec,
            'signal_ar': signal_ar,
            'entry': round(entry_price, 4),
            'target': round(target_price, 4),
            'stop': round(stop_loss, 4),
            'risk_reward': risk_reward,
            'score': round(float(r.get('maestro_score') or 0), 1),
            'composite_score': round(float(composite), 1),  # AXIS-7: composite ranking
            'evidence_count': int(ev_count),               # AXIS-7: ≥4 required
            'ath_breakout': ath_breakout,
            'delay_compensation_applied': delay_comp,
            'updated_at': r.get('updated_at'),
        })

    return {
        'success': True,
        'market_status': 'live' if is_live else 'closed',
        'label_ar': label_ar,
        'stocks': stocks,
        'market_vetoed': False,
    }


@market_bp.route('/morning-bell', methods=['GET'])
def morning_bell():
    """🔔 جرس الصباح — أعلى 3 فرص EGX للنهاردة (HTTP wrapper).

    بيرجّع أعلى 3 أسهم EGX من stored_analyses (كل سهم له صف واحد = آخر تحليل
    مسجل) مرتبين بـ maestro_score. بيطبّق تعويض التأخير (P16) لو السوق مفتوح
    intraday + بيوفّر flag الـ ATH Breakout (P15) للواجهة.

    لو السوق مقفول → بيرجّع أعلى 3 من آخر تحليل مسجل كـ "فرص الغد".

    الـ core logic في `_get_morning_bell_data()` عشان الـ Telegram scheduler
    (P18) يستخدمه بدون HTTP roundtrip (Python = THE BRAIN).
    """
    try:
        limit = max(1, min(int(request.args.get('limit', 3)), 10))
        # P41: استخدم النسخة اللحظية دايماً لما live=1 — بترجع حالة السوق (closed/vetoed/live)
        use_live = request.args.get('live', '1') in ('1', 'true', 'yes')
        if use_live:
            live_data = _get_morning_bell_live(limit=limit)
            # لو الـ live رجّع picks أو حالة سوق واضحة (closed/vetoed) → اعرضها
            if live_data.get('stocks') or live_data.get('market_status') == 'closed' or live_data.get('market_vetoed'):
                return jsonify(live_data)
            # fallback للـ static لو الـ live فشل بجد (مفيش بيانات intraday نهائياً)
        return jsonify(_get_morning_bell_data(limit))
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# P41 — جرس الصباح اللحظي (Live Morning Bell) + محرك الاستمرار + محرك الخروج
# ============================================================================

# In-memory cache لدورة 15 دقيقة — (timestamp, picks_list)
_MORNING_BELL_LIVE_CACHE: dict = {'ts': None, 'picks': [], 'market_status': 'closed'}


def _get_egx_intraday_candidates(limit: int = 60) -> list:
    """اسحب مرشحي EGX من intraday.db — آخر لقطة لكل سهم بالأمس/اليوم.

    بيرجّع قائمة dicts: {ticker, price, volume, open, high, low, change_percent, timestamp}
    مرتّبة بأحدث timestamp أولاً.
    """
    import sqlite3 as _sql
    from pathlib import Path as _P
    _db = str(_P(__file__).resolve().parents[2] / 'db' / 'intraday.db')
    out = []
    try:
        conn = _sql.connect('file:' + _db + '?mode=ro', uri=True, timeout=15.0)
        conn.row_factory = _sql.Row
        # آخر صف لكل ticker (آخر لقطة) — نأخذ أحدث 60 سهم
        rows = conn.execute(
            'SELECT s.ticker, s.market, s.timestamp, s.price, s.change_percent, '
            's.volume, s.open, s.high, s.low '
            'FROM stock_intraday s '
            'INNER JOIN (SELECT ticker, MAX(timestamp) as max_ts '
            '            FROM stock_intraday GROUP BY ticker) m '
            'ON s.ticker = m.ticker AND s.timestamp = m.max_ts '
            'WHERE s.volume > 0 AND s.price > 0 '
            'ORDER BY s.volume DESC LIMIT ?', (limit,)
        ).fetchall()
        for r in rows:
            out.append({
                'ticker': r['ticker'],
                'market': r['market'] or 'EGX',
                'timestamp': r['timestamp'],
                'price': float(r['price'] or 0),
                'change_percent': float(r['change_percent'] or 0),
                'volume': int(r['volume'] or 0),
                'open': float(r['open'] or 0),
                'high': float(r['high'] or 0),
                'low': float(r['low'] or 0),
            })
        conn.close()
    except Exception as _e:
        print(f"[morning_bell_live] intraday scan failed: {_e}")
    return out


def _compute_continuation_for_ticker(ticker: str, current_price: float,
                                      day_open: float, day_high: float) -> dict:
    """احسب metrics الاستمرار لسهم باستخدام SmartExitEngine + بيانات price_history.

    بيرجّع dict فيه كل حقول compute_continuation_metrics أو {} لو مفيش بيانات كافية.
    """
    try:
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from portfolio.smart_exit_engine import SmartExitEngine
        from utils.live_price import get_recent_price_history, compute_rvol
        engine = SmartExitEngine()
        hist = get_recent_price_history(ticker, 20)
        if not hist or len(hist.get('highs', [])) < 5:
            return {}
        rvol = compute_rvol(ticker)
        # entry = day_open (افتتاح اليوم) لو موجود، وإلا current_price
        entry = day_open if day_open > 0 else current_price
        highest = max(day_high if day_high > 0 else current_price, max(hist['highs']))
        # recent_highs/lows: آخر 3-5 من price_history (محدثة الأول للأسفل)
        recent_highs = list(reversed(hist['highs'][-5:]))
        recent_lows = list(reversed(hist['lows'][-5:]))
        recent_volumes = list(reversed(hist['volumes'][-10:]))
        metrics = engine.compute_continuation_metrics(
            current_price=current_price,
            entry_price=entry,
            highest_price=highest,
            recent_highs=recent_highs,
            recent_lows=recent_lows,
            recent_volumes=recent_volumes,
            avg_volume_20=hist['avg_volume_20'],
            atr=hist['atr'],
            rvol=rvol,
            sma_20=hist['sma_20'],
        )
        return metrics
    except Exception as _e:
        print(f"[continuation] {ticker} failed: {_e}")
        return {}


def _get_morning_bell_live(limit: int = 5) -> dict:
    """P41 Live Morning Bell — جرس الصباح اللحظي.

    المنطق:
    1. امسح intraday.db لآخر لقطات EGX (أعلى 60 حجم)
    2. بوابة RVOL (>= morning_bell_rvol_threshold) + امتداد يومي (>= min_extension)
    3. لكل مرشح: شغّل continuation engine (3 احتمالات + TP/SL متحركة + risk_flag)
    4. رتّب بـ composite score (RVOL + امتداد + استمرار + سيولة)
    5. خذ أعلى `limit` (افتراضي 5)
    6. cache لـ 15 دقيقة (morning_bell_refresh_minutes)

    الإحصائيات منفصلة تماماً عن balanced/conservative — لا تُكتب لـ predictions DB.
    """
    import time as _time
    max_picks = int(_get_engine_setting('morning_bell_max_picks', default=5) or 5)
    refresh_min = float(_get_engine_setting('morning_bell_refresh_minutes', default=15) or 15)
    rvol_thresh = float(_get_engine_setting('morning_bell_rvol_threshold', default=1.5) or 1.5)
    min_ext = float(_get_engine_setting('morning_bell_min_extension_pct', default=1.0) or 1.0)
    w_rvol = float(_get_engine_setting('morning_bell_composite_w_rvol', default=0.35) or 0.35)
    w_ext = float(_get_engine_setting('morning_bell_composite_w_extension', default=0.25) or 0.25)
    w_cont = float(_get_engine_setting('morning_bell_composite_w_continuation', default=0.25) or 0.25)
    w_liq = float(_get_engine_setting('morning_bell_composite_w_liquidity', default=0.15) or 0.15)
    limit = max(1, min(int(limit), max_picks))

    # --- cache check ---
    now_ts = _time.time()
    cache = _MORNING_BELL_LIVE_CACHE
    if cache['ts'] and (now_ts - cache['ts']) < refresh_min * 60:
        if cache.get('picks'):
            # رجّع الكاش مع تحديث limit
            cached = cache['picks'][:limit]
            return {
                'success': True,
                'market_status': cache['market_status'],
                'label_ar': '🔔 جرس الصباح (مباشر)',
                'channel': 'morning_bell',
                'stocks': cached,
                'stats_separated': True,
                'cached': True,
                'cache_age_seconds': int(now_ts - cache['ts']),
                'refresh_interval_minutes': int(refresh_min),
                'max_picks': max_picks,
                'market_vetoed': False,
                'updated_at': datetime.utcnow().isoformat() + 'Z',
            }

    is_live = _is_egx_intraday_now()
    if not is_live:
        return {
            'success': True,
            'market_status': 'closed',
            'label_ar': '🌅 السوق مقفول — استخدم فرص الغد (static)',
            'channel': 'morning_bell',
            'stocks': [],
            'stats_separated': True,
            'market_vetoed': False,
            'note_ar': 'جلسة EGX مقفولة. جرس الصباح اللحظي يعمل أثناء 10:00-14:30 القاهرة.',
        }

    # --- فيتو السوق ---
    market_vetoed, veto_reason = _check_morning_bell_market_veto()
    if market_vetoed:
        return {
            'success': True,
            'market_status': 'live',
            'label_ar': '🛡️ وضع الكاش — السوق هابط',
            'channel': 'morning_bell',
            'stocks': [],
            'stats_separated': True,
            'note_ar': f'🚫 فيتو السوق: {veto_reason}',
            'market_vetoed': True,
            'veto_reason': veto_reason,
        }

    # --- امسح المرشحين ---
    candidates = _get_egx_intraday_candidates(limit=60)
    if not candidates:
        return {
            'success': True,
            'market_status': 'live',
            'label_ar': '🔔 جرس الصباح (مباشر)',
            'channel': 'morning_bell',
            'stocks': [],
            'stats_separated': True,
            'note_ar': 'مفيش بيانات intraday متاحة دلوقتي.',
        }

    fund_batch = _load_stocks_fundamentals_batch()

    scored = []
    for c in candidates:
        ticker = c['ticker']
        # RVOL
        try:
            from utils.live_price import compute_rvol
            rvol = compute_rvol(ticker)
        except Exception:
            rvol = 1.0
        if rvol < rvol_thresh:
            continue  # بوابة RVOL

        # امتداد يومي
        ext = c['change_percent'] or 0.0
        if c['open'] > 0 and c['price'] > 0:
            ext = ((c['price'] - c['open']) / c['open']) * 100
        if ext < min_ext:
            continue  # بوابة الامتداد

        # continuation engine
        metrics = _compute_continuation_for_ticker(
            ticker, c['price'], c['open'], c['high']
        )
        if not metrics:
            continue

        # composite score
        rvol_norm = min(rvol, 5.0) / 5.0 * 100
        ext_norm = min(abs(ext), 10.0) / 10.0 * 100
        cont_map = {'continuing': 100, 'weakening': 55, 'exhausted': 20}
        cont_score = cont_map.get(metrics['continuation_state'], 50)
        liq_norm = min(c['volume'], 5_000_000) / 5_000_000 * 100
        composite = (
            w_rvol * rvol_norm
            + w_ext * ext_norm
            + w_cont * cont_score
            + w_liq * liq_norm
        )

        fund = fund_batch.get(ticker, {}) or {}
        name_ar = fund.get('name_ar') or ticker

        pick = {
            'ticker': ticker,
            'name_ar': name_ar,
            'price': round(c['price'], 4),
            'extension_pct_day': round(ext, 2),
            'rvol': round(rvol, 2),
            'volume': c['volume'],
            'continuation_state': metrics['continuation_state'],
            'prob_continue_up': metrics['prob_continue_up'],
            'prob_mild_pullback': metrics['prob_mild_pullback'],
            'prob_sharp_drop': metrics['prob_sharp_drop'],
            'suggested_tp1': metrics['suggested_tp1'],
            'suggested_tp2': metrics['suggested_tp2'],
            'suggested_stop': metrics['suggested_stop'],
            'risk_flag': metrics['risk_flag'],
            'client_responsibility_required': True,
            'action': 'BUY',
            'signal': 'morning_bell_buy',
            'signal_ar': '🔔 شراء جرس الصباح',
            'composite_score': round(composite, 1),
            'confidence': metrics['confidence'],
            'momentum_alive': metrics['momentum_alive'],
            'trajectory': metrics['trajectory'],
            'plain_ar_warning': (
                'تحذير: جرس الصباح — توصية عالية المخاطر على مسؤوليتك. '
                'استخدم الوقف. الخسارة بعد تجاهل خطة الخروج لا تُحسب على أداء المسار المنضبط.'
            ),
            'reason_ar': metrics['reason_ar'],
            'updated_at': datetime.utcnow().isoformat() + 'Z',
        }
        scored.append(pick)

    # رتّب بـ composite score تنازلياً
    scored.sort(key=lambda x: x['composite_score'], reverse=True)
    top_picks = scored[:max_picks]

    # --- حدّث الـ cache ---
    _MORNING_BELL_LIVE_CACHE['ts'] = now_ts
    _MORNING_BELL_LIVE_CACHE['picks'] = top_picks
    _MORNING_BELL_LIVE_CACHE['market_status'] = 'live'

    return {
        'success': True,
        'market_status': 'live',
        'label_ar': '🔔 جرس الصباح (مباشر)',
        'channel': 'morning_bell',
        'stocks': top_picks[:limit],
        'stats_separated': True,
        'cached': False,
        'refresh_interval_minutes': int(refresh_min),
        'max_picks': max_picks,
        'total_candidates_scanned': len(candidates),
        'total_passed_gate': len(scored),
        'market_vetoed': False,
        'updated_at': datetime.utcnow().isoformat() + 'Z',
    }


@market_bp.route('/morning-bell/live', methods=['GET'])
def morning_bell_live():
    """🔔 جرس الصباح اللحظي — أعلى 5 فرص زخم عالي (RVOL + continuation)."""
    try:
        limit = max(1, min(int(request.args.get('limit', 5)), 10))
        return jsonify(_get_morning_bell_live(limit))
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@market_bp.route('/continuation/<ticker>', methods=['GET'])
def continuation_metrics(ticker: str):
    """P41: قياس استمرار الحركة لسهم — 3 احتمالات + TP/SL متحركة + risk_flag."""
    try:
        from utils.live_price import get_live_price, get_intraday_snapshot
        ticker = ticker.upper().strip()
        price = get_live_price(ticker, use_cache=True)
        snap = get_intraday_snapshot(ticker)
        if price <= 0:
            return jsonify({'success': False, 'error': f'no price for {ticker}'}), 404
        day_open = snap.get('open', 0.0) or price
        day_high = snap.get('high', 0.0) or price
        metrics = _compute_continuation_for_ticker(ticker, price, day_open, day_high)
        if not metrics:
            return jsonify({'success': False, 'error': f'insufficient history for {ticker}'}), 404
        return jsonify({
            'success': True,
            'ticker': ticker,
            'current_price': round(price, 4),
            'day_open': round(day_open, 4),
            'day_high': round(day_high, 4),
            'continuation': metrics,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@market_bp.route('/exit-status', methods=['GET'])
def exit_status():
    """P41: حالة الخروج اللحظي للتوصيات النشطة (EXIT/TAKE_PROFIT/REDUCE/HOLD).

    بيرجّع قائمة بالتوصيات النشطة من predictions table (persona=balanced,
    status PENDING) مع قرار الخروج اللحظي لكل واحدة.

    Query params:
        limit: أقصى عدد (default 20)
        ticker: فلترة بسهم محدد (optional)
    """
    try:
        from utils.live_price import get_live_price, get_recent_price_history, compute_rvol
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from portfolio.smart_exit_engine import SmartExitEngine
        engine = SmartExitEngine()
        limit = max(1, min(int(request.args.get('limit', 20)), 100))
        ticker_filter = (request.args.get('ticker') or '').upper().strip()

        conn = get_predictions_db()
        cur = conn.cursor()
        # Schema-aware: اكتشف أعمدة الإشارة المتاحة (signal / signal_type / recommendation)
        # دستور Rule 5: COALESCE(signal, signal_type, recommendation) — بس نتجاهل الأعمدة المش موجودة
        cur.execute("PRAGMA table_info(predictions)")
        available_cols = {row[1] for row in cur.fetchall()}
        signal_cols = [c for c in ('signal', 'signal_type', 'recommendation') if c in available_cols]
        if not signal_cols:
            return jsonify({'success': False, 'error': 'no signal column found in predictions table'}), 500
        signal_expr = 'COALESCE(' + ', '.join(signal_cols) + ')'
        # trailing_stop: استخدم trailing_stop لو موجود، وإلا None
        trailing_col = 'trailing_stop' if 'trailing_stop' in available_cols else 'NULL as trailing_stop'
        highest_col = 'highest_price_reached' if 'highest_price_reached' in available_cols else 'NULL as highest_price_reached'
        # التوصيات النشطة: outcome_date IS NULL + persona=balanced + BUY signals
        q = f'''
            SELECT id, ticker, {signal_expr} as signal_raw,
                   entry_price, target_price, stop_loss, prediction_date, persona,
                   {trailing_col}, {highest_col}
            FROM predictions
            WHERE (outcome_date IS NULL OR outcome_date = '')
              AND {signal_expr} IN ('BUY','STRONG_BUY','INSTITUTIONAL_BUY')
              AND entry_price > 0 AND stop_loss > 0 AND stop_loss < entry_price
        '''
        params = []
        if ticker_filter:
            q += ' AND ticker = ?'
            params.append(ticker_filter)
        q += ' ORDER BY prediction_date DESC LIMIT ?'
        params.append(limit)
        cur.execute(q, params)
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()

        results = []
        for r in rows:
            ticker = r['ticker']
            entry = float(r['entry_price'] or 0)
            target = float(r['target_price'] or 0)
            stop = float(r['stop_loss'] or 0)
            if entry <= 0 or stop <= 0:
                continue
            current = get_live_price(ticker, use_cache=True)
            if current <= 0:
                current = entry  # fallback
            hist = get_recent_price_history(ticker, 20)
            if not hist or len(hist.get('highs', [])) < 5:
                continue
            rvol = compute_rvol(ticker)
            highest = float(r.get('highest_price_reached') or 0)
            if highest <= 0:
                highest = max(current, max(hist['highs']))
            trailing = float(r.get('trailing_stop') or 0) or None
            decision = engine.decide_exit_action(
                current_price=current,
                entry_price=entry,
                highest_price=highest,
                atr=hist['atr'],
                recent_highs=list(reversed(hist['highs'][-5:])),
                recent_lows=list(reversed(hist['lows'][-5:])),
                recent_volumes=list(reversed(hist['volumes'][-10:])),
                avg_volume_20=hist['avg_volume_20'],
                client_stop=stop,
                trailing_stop_price=trailing,
                tp1=target,
                tp2=target * 1.10 if target > 0 else None,
                sma_20=hist['sma_20'],
                rvol=rvol,
            )
            results.append({
                'id': r['id'],
                'ticker': ticker,
                'prediction_date': r.get('prediction_date'),
                'persona': r.get('persona') or 'balanced',
                'entry_price': round(entry, 4),
                'current_price': round(current, 4),
                'target_price': round(target, 4),
                'stop_loss': round(stop, 4),
                'action': decision['action'],
                'reason_code': decision['reason_code'],
                'reason_ar': decision['reason_ar'],
                'new_stop': decision['new_stop'],
                'new_tp': decision['new_tp'],
                'exit_pct': decision['exit_pct'],
                'current_gain_pct': decision['current_gain_pct'],
                'confidence': decision['confidence'],
                'continuation': decision['continuation'],
                'timestamp': decision['timestamp'],
            })

        # ملخص الإجراءات
        summary = {'HOLD': 0, 'TAKE_PROFIT': 0, 'REDUCE': 0, 'EXIT': 0}
        for x in results:
            summary[x['action']] = summary.get(x['action'], 0) + 1

        return jsonify({
            'success': True,
            'total': len(results),
            'summary': summary,
            'predictions': results,
            'channel': 'exit_engine',
            'stats_separated': True,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@market_bp.route('/morning-bell/stats', methods=['GET'])
def morning_bell_stats():
    """P41: إحصائيات جرس الصباح — منفصلة تماماً عن balanced/conservative.

    ملاحظة: جرس الصباح لحظي (لا يُكتب لـ predictions DB) فالإحصائيات الحالية
    محدودة. هذه الـ endpoint بتثبت فصل القناة وتوفّر هيكل للتتبع المستقبلي.
    """
    try:
        import time as _time
        cache = _MORNING_BELL_LIVE_CACHE
        picks = cache.get('picks', [])
        return jsonify({
            'success': True,
            'channel': 'morning_bell',
            'stats_separated': True,
            'note_ar': 'إحصائيات جرس الصباح منفصلة عن balanced/conservative. جرس الصباح لحظي ولا يُكتب في predictions DB.',
            'current_picks_count': len(picks),
            'max_picks': int(_get_engine_setting('morning_bell_max_picks', default=5) or 5),
            'refresh_interval_minutes': int(_get_engine_setting('morning_bell_refresh_minutes', default=15) or 15),
            'cache_age_seconds': int((_time.time() - cache['ts'])) if cache.get('ts') else None,
            'market_status': cache.get('market_status', 'closed'),
            'picks_tickers': [p['ticker'] for p in picks],
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@stored_analysis_bp.route('/trigger', methods=['POST'])
def trigger_analysis():
    try:
        conn = get_predictions_db()
        cursor = conn.cursor()
        cursor.execute('SELECT is_running FROM analysis_engine_status WHERE id = ?', ('main',))
        row = cursor.fetchone()
        
        if row and row['is_running']:
            conn.close()
            return jsonify({'success': False, 'message': 'Analysis already running'})
            
        cursor.execute('''
            UPDATE analysis_engine_status 
            SET is_running = 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = 'main'
        ''')
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'message': 'Analysis triggered'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

def get_recommendation_ar(rec: str) -> str:
    mapping = {
        'strong_buy': 'شراء قوي',
        'buy': 'شراء',
        'hold': 'احتفاظ',
        'sell': 'بيع',
        'strong_sell': 'بيع قوي'
    }
    return mapping.get(rec, 'احتفاظ')
