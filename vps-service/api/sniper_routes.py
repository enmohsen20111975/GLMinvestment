#!/usr/bin/env python3
"""
Sniper API Routes — مسارات القناص
==================================
API endpoints for the Sniper Engine, Daily Closer, and Learning Engine.
"""

import os
import sqlite3
import logging
from datetime import datetime
from pathlib import Path
from flask import Blueprint, request, jsonify

# v3.29.0: Holiday-aware prediction dates — prevents predictions on Fri/Sat/holidays
try:
    from utils.trading_calendar import get_prediction_date_str, is_trading_day
except ImportError:
    def get_prediction_date_str(dt=None, market='EGX'):
        return (dt or datetime.now()).strftime('%Y-%m-%d')
    def is_trading_day(dt=None, market='EGX'):
        return (dt or datetime.now()).weekday() not in [4, 5]

# 🔥 VERIFY-FIX-4: Unified guard chain — same functions the Maestro uses.
# Before this, the Sniper /track path did a raw SQL INSERT bypassing all guards
# (ATR-based stop normalization, direction check, R/R ≥ 1.5). Now the Sniper
# tab uses the SAME guard chain as the Maestro tab, so the same stock gets
# consistent stop/target across tabs and R/R ≥ 1.5 is guaranteed everywhere.
import sys as _sys
_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in _sys.path:
    _sys.path.insert(0, str(_VPS_ROOT))
try:
    from core.opportunity_quality import (
        enforce_atr_based_stop,
        validate_target_stop_direction,
        enforce_min_rr,
        compute_planned_rr,
    )
    _GUARDS_AVAILABLE = True
except ImportError as _guard_imp_err:
    logger.warning(f"[Sniper] Guard chain unavailable (opportunity_quality import failed): {_guard_imp_err}")
    _GUARDS_AVAILABLE = False

logger = logging.getLogger(__name__)

sniper_bp = Blueprint('sniper', __name__, url_prefix='/api/sniper')

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')


def _is_ath_breakout(ticker: str) -> bool:
    """فحص الاختراق التاريخي (All-Time High breakout) — P15 (أغسطس 2026).

    السهم في حالة "اختراق تاريخي" لو السعر الحالي ضمن 2% من أعلى سعر تاريخي
    (close_price) للسهم. ده الاستثناء الوحيد اللي يسمح ببوابة قناص واحدة (min_gates=1)
    بدل الـ 2 (gambler) أو 3 (investor).

    Schema-resilient: بيكتشف الجدول/الـ view المتاح (price_history TABLE أو
    stock_price_history VIEW) عشان يشتغل على الإنتاج والـ sandbox.
    """
    try:
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('price_history', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=10.0)
        cur = conn.cursor()
        tabs = [r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view') "
            "AND name IN ('price_history','stock_price_history') ORDER BY name"
        ).fetchall()]
        conn.close()
        if not tabs:
            return False
        tbl = tabs[0]
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('price_history', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=10.0)
        cur = conn.cursor()
        row = cur.execute(
            f"SELECT close_price FROM {tbl} WHERE ticker=? ORDER BY date DESC LIMIT 1",
            (ticker,)
        ).fetchone()
        ath_row = cur.execute(
            f"SELECT MAX(close_price) FROM {tbl} WHERE ticker=?", (ticker,)
        ).fetchone()
        conn.close()
        if not row or not ath_row or ath_row[0] is None or row[0] is None:
            return False
        current = float(row[0])
        ath = float(ath_row[0])
        if ath <= 0:
            return False
        # ضمن 2% من أعلى سعر تاريخي = اختراق تاريخي
        return current >= (ath * 0.98)
    except Exception:
        return False

# بوابات قطاعية — كل قطاع له شروطه الخاصة
# البوابات الثابتة (5) متشركة، لكن البوابة الخامسة بتختلف حسب القطاع
SECTOR_GATES = {
    'banks': {
        'min_pe': 5, 'max_pe': 18,
        'min_roe': 12, 'max_debt_equity': 3.0,
        'min_dividend': 0.02,  # 2% minimum
        'gate_5_label': 'NIM trend',  # Net Interest Margin
        'description': 'البنوك: P/E 5-18، ROE > 12%، ديون/حقوق < 3'
    },
    'real_estate': {
        'min_pe': 3, 'max_pe': 12,
        'min_roe': 8, 'max_debt_equity': 5.0,
        'min_dividend': 0.03,
        'gate_5_label': 'sales_growth',
        'description': 'العقار: P/E 3-12، ROE > 8%، توزيعات > 3%'
    },
    'tourism': {
        'min_pe': 8, 'max_pe': 30,
        'min_roe': 10, 'max_debt_equity': 4.0,
        'min_dividend': 0.0,  # tourism may not pay dividends
        'gate_5_label': 'occupancy_rate',
        'description': 'السياحة: P/E 8-30، ROE > 10%'
    },
    'chemicals': {
        'min_pe': 4, 'max_pe': 15,
        'min_roe': 10, 'max_debt_equity': 3.5,
        'min_dividend': 0.02,
        'gate_5_label': 'capacity_utilization',
        'description': 'الكيماويات: P/E 4-15، ROE > 10%'
    },
    'food': {
        'min_pe': 6, 'max_pe': 25,
        'min_roe': 12, 'max_debt_equity': 2.5,
        'min_dividend': 0.03,
        'gate_5_label': 'revenue_growth',
        'description': 'الأغذية: P/E 6-25، ROE > 12%'
    },
    'default': {
        'min_pe': 3, 'max_pe': 40,
        'min_roe': 5, 'max_debt_equity': 10.0,
        'min_dividend': 0.0,
        'gate_5_label': 'general',
        'description': 'افتراضي: شروط واسعة'
    }
}

# Signal Arabic translation map
SIGNAL_AR = {
    'STRONG_BUY': 'شراء قوي',
    'BUY': 'شراء',
    'HOLD': 'احتفاظ',
    'REDUCE': 'تخفيض',
    'SELL': 'بيع',
    'STRONG_SELL': 'بيع قوي',
    'ACCUMULATE': 'تجميع',
}


def _apply_sector_gate(stock_data: dict, sector: str) -> tuple:
    """
    يطبق البوابة القطاعية الخامسة على السهم.
    يرجع (passed: bool, reason: str)
    البوابة بتشيك: P/E, ROE, Debt/Equity, Dividend حسب القطاع
    """
    try:
        # نشوف القطاع في القاموس — لو مش موجود نستخدم الافتراضي
        gate = SECTOR_GATES.get(sector, SECTOR_GATES['default'])
        ticker = stock_data.get('ticker', stock_data.get('symbol', '???'))

        # نشيك لو الأساسيات موجودة
        fundamentals = stock_data.get('fundamentals') or stock_data.get('financials')
        if not fundamentals:
            # لو مفيش بيانات أساسية — نمرره (ما نشلّش السهم عشان داتا ناقصة)
            return (True, f'البوابة القطاعية: سهم {ticker} في القطاع {sector} — مفيش بيانات أساسية، تم التجاوز')

        # الأساسيات ممكن تكون dict أو object — نحاول نقرأ منها
        if isinstance(fundamentals, dict):
            pe_ratio = fundamentals.get('pe_ratio') or fundamentals.get('pe')
            roe = fundamentals.get('roe')
            debt_equity = fundamentals.get('debt_equity') or fundamentals.get('debt_to_equity')
            dividend_yield = fundamentals.get('dividend_yield') or fundamentals.get('dividend') or 0
        else:
            # object / dataclass
            pe_ratio = getattr(fundamentals, 'pe_ratio', None) or getattr(fundamentals, 'pe', None)
            roe = getattr(fundamentals, 'roe', None)
            debt_equity = getattr(fundamentals, 'debt_equity', None) or getattr(fundamentals, 'debt_to_equity', None)
            dividend_yield = getattr(fundamentals, 'dividend_yield', None) or getattr(fundamentals, 'dividend', 0) or 0

        # تشيكات البوابات القطاعية
        failures = []

        # 1. P/E range
        if pe_ratio is not None:
            try:
                pe_val = float(pe_ratio)
                if pe_val < gate['min_pe']:
                    failures.append(f'P/E = {pe_val:.1f} أقل من الحد الأدنى {gate["min_pe"]}')
                elif pe_val > gate['max_pe']:
                    failures.append(f'P/E = {pe_val:.1f} أعلى من الحد الأقصى {gate["max_pe"]}')
            except (ValueError, TypeError):
                pass  # لو مش رقم نتجاوزه

        # 2. ROE minimum
        if roe is not None:
            try:
                roe_val = float(roe)
                if roe_val < gate['min_roe']:
                    failures.append(f'ROE = {roe_val:.1f}% أقل من الحد الأدنى {gate["min_roe"]}%')
            except (ValueError, TypeError):
                pass

        # 3. Debt/Equity maximum
        if debt_equity is not None:
            try:
                de_val = float(debt_equity)
                if de_val > gate['max_debt_equity']:
                    failures.append(f'ديون/حقوق = {de_val:.1f} أعلى من الحد {gate["max_debt_equity"]}')
            except (ValueError, TypeError):
                pass

        # 4. Dividend minimum
        try:
            div_val = float(dividend_yield)
            if div_val < gate['min_dividend']:
                failures.append(f'التوزيعات = {div_val:.2f}% أقل من الحد الأدنى {gate["min_dividend"]*100:.0f}%')
        except (ValueError, TypeError):
            pass

        if failures:
            reason = f'البوابة القطاعية ({sector}): سهم {ticker} رفض — ' + ' | '.join(failures)
            return (False, reason)

        return (True, f'البوابة القطاعية: سهم {ticker} في القطاع {sector} يحقق الشروط')

    except Exception as e:
        logger.warning(f'خطأ في البوابة القطاعية لسهم {stock_data.get("ticker", "?")}: {e}')
        # في حال أي خطأ — نمرر السهم (أمان أول)
        return (True, f'البوابة القطاعية: تجاوز بسبب خطأ — {str(e)}')


def check_sector_gate_pre(ticker: str, sector: str, fundamentals: dict = None) -> dict:
    """
    فحص بوابة القطاع كـ PRE-FILTER — قبل أي حساب تسجيل.

    لو السهم مش بيلبي شروط قطاعه الأساسية → نرفضه فوراً من غير ما نحسب score.
    ده بيوفر وقت (مش بنحسب 10 محللات لسهم هنرفضه).

    Args:
        ticker: رمز السهم
        sector: اسم القطاع (banks, real_estate, tourism, etc.)
        fundamentals: بيانات أساسية (pe_ratio, roe, debt_equity, dividend_yield)

    Returns:
        dict: {
            'passed': bool,
            'reason': str,  # سبب الرفض بالعربي (فارغ لو passed)
            'gate_name': str,  # اسم البوابة اللي رفضت
            'sector': str,
            'criteria_checked': list,
        }
    """
    result = {
        'passed': True,
        'reason': '',
        'gate_name': '',
        'sector': sector,
        'criteria_checked': [],
    }

    if not sector or not fundamentals:
        result['passed'] = False
        result['reason'] = 'مفيش بيانات قطاع أو أساسية'
        return result

    sector_key = sector.lower().strip()

    # محاولة مطابقة القطاع
    if sector_key not in SECTOR_GATES:
        # محاولة مطابقة جزئية
        for sk in SECTOR_GATES:
            if sk in sector_key or sector_key in sk:
                sector_key = sk
                break
        else:
            # قطاع مش معروف — نسمح بيه (مفيش gate)
            result['passed'] = True
            result['reason'] = f'قطاع {sector} مش معروف — بدون بوابة'
            return result

    gate = SECTOR_GATES[sector_key]
    pe = fundamentals.get('pe_ratio', 0) or 0
    roe = fundamentals.get('roe', 0) or 0
    debt_eq = fundamentals.get('debt_equity', 0) or 0
    div_yield = fundamentals.get('dividend_yield', 0) or 0

    # فحص 1: P/E Range
    min_pe = gate.get('min_pe', 0)
    max_pe = gate.get('max_pe', 999)
    if pe > 0:  # بس لو P/E متوفر
        result['criteria_checked'].append(f'P/E={pe:.1f} (مطلوب {min_pe}-{max_pe})')
        if pe < min_pe or pe > max_pe:
            result['passed'] = False
            result['gate_name'] = 'P/E Range'
            result['reason'] = f'P/E={pe:.1f} خارج النطاق المطلوب ({min_pe}-{max_pe}) لقطاع {sector}'
            return result

    # فحص 2: ROE minimum
    min_roe = gate.get('min_roe', 0)
    if roe > 0:  # بس لو ROE متوفر
        result['criteria_checked'].append(f'ROE={roe:.1f}% (مطلوب >{min_roe}%)')
        if roe < min_roe:
            result['passed'] = False
            result['gate_name'] = 'ROE'
            result['reason'] = f'ROE={roe:.1f}% أقل من المطلوب ({min_roe}%) لقطاع {sector}'
            return result

    # فحص 3: Debt/Equity maximum
    max_de = gate.get('max_debt_equity', 999)
    if debt_eq > 0:  # بس لو debt_equity متوفر
        result['criteria_checked'].append(f'D/E={debt_eq:.1f} (مطلوب <{max_de})')
        if debt_eq > max_de:
            result['passed'] = False
            result['gate_name'] = 'Debt/Equity'
            result['reason'] = f'D/E={debt_eq:.1f} أعلى من المسموح ({max_de}) لقطاع {sector}'
            return result

    # فحص 4: Dividend yield minimum
    min_div = gate.get('min_dividend', 0)
    if min_div > 0 and div_yield > 0:
        result['criteria_checked'].append(f'Div Yield={div_yield:.1f}% (مطلوب >{min_div}%)')
        if div_yield < min_div:
            result['passed'] = False
            result['gate_name'] = 'Dividend Yield'
            result['reason'] = f'توزيعات={div_yield:.1f}% أقل من المطلوب ({min_div}%) لقطاع {sector}'
            return result

    return result


def _load_fundamentals_for_gate(ticker: str) -> dict:
    """
    يجيب البيانات الأساسية لسهم معين من data_engine.db (egx_fundamentals).
    يرجع dict بأهم الحقول للـ gate: pe_ratio, roe, debt_equity, dividend_yield.
    """
    fundamentals = {}
    try:
        de_db = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
        if not os.path.exists(de_db):
            return fundamentals
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('data_engine', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(de_db, timeout=5.0)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            'SELECT pe_ratio, roe, debt_equity, dividend_yield FROM egx_fundamentals WHERE ticker = ?',
            (ticker.upper(),)
        ).fetchone()
        if row:
            fundamentals = {
                'pe_ratio': row['pe_ratio'] or 0,
                'roe': row['roe'] or 0,
                'debt_equity': row['debt_equity'] or 0,
                'dividend_yield': row['dividend_yield'] or 0,
            }
        conn.close()
    except Exception as e:
        logger.warning(f'خطأ في جلب fundamentals لـ {ticker}: {e}')
    return fundamentals


def _ensure_predictions_table():
    """Ensure the predictions table has all required columns."""
    db_path = PREDICTIONS_DB
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    try:
        from core.db_manager import db_manager
        conn = db_manager.connection('predictions', writable=True).__enter__()
    except Exception:
        conn = sqlite3.connect(db_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Create table if it doesn't exist with full schema
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT DEFAULT 'EGX',
            signal TEXT,
            signal_ar TEXT,
            confidence REAL DEFAULT 0,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            risk_reward REAL DEFAULT 0,
            persona TEXT DEFAULT 'balanced',
            status TEXT DEFAULT 'PENDING',
            maestro_score REAL DEFAULT 0,
            actual_return REAL,
            actual_exit_price REAL,
            highest_price REAL,
            lowest_price REAL,
            days_to_close INTEGER,
            pnl_pct REAL,
            closed_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    # Migrate: add missing columns (ignore errors if they already exist)
    migrations = [
        ('market', 'TEXT DEFAULT "EGX"'),
        ('signal_ar', 'TEXT'),
        ('risk_reward', 'REAL DEFAULT 0'),
        ('persona', 'TEXT DEFAULT "balanced"'),
        ('status', 'TEXT DEFAULT "PENDING"'),
        ('maestro_score', 'REAL DEFAULT 0'),
        ('actual_return', 'REAL'),
        ('actual_exit_price', 'REAL'),
        ('highest_price', 'REAL'),
        ('lowest_price', 'REAL'),
        ('days_to_close', 'INTEGER'),
        ('pnl_pct', 'REAL'),
        ('closed_at', 'TEXT'),
    ]
    for col_name, col_type in migrations:
        try:
            cursor.execute(f'ALTER TABLE predictions ADD COLUMN {col_name} {col_type}')
        except sqlite3.OperationalError:
            pass  # Column already exists

    conn.commit()
    conn.close()


def _get_sniper_engine():
    """Get or create SniperEngine instance"""
    try:
        from analyzers.sniper_engine import SniperEngine
        return SniperEngine()
    except Exception as e:
        logger.error(f"Failed to create SniperEngine: {e}")
        return None


def _get_daily_closer():
    """Get or create DailyCloser instance"""
    try:
        from jobs.daily_closer import DailyCloser
        return DailyCloser()
    except Exception as e:
        logger.error(f"Failed to create DailyCloser: {e}")
        return None


def _get_learning_engine():
    """Get or create LearningEngine instance"""
    try:
        from jobs.learning_engine import LearningEngine
        return LearningEngine()
    except Exception as e:
        logger.error(f"Failed to create LearningEngine: {e}")
        return None


def _get_market_scheduler():
    """Get the MarketScheduler singleton"""
    try:
        from jobs.market_scheduler import MarketScheduler
        # Return a new instance (or use a global singleton if available)
        return MarketScheduler()
    except Exception as e:
        logger.error(f"Failed to create MarketScheduler: {e}")
        return None


# ═══════════════════════════════════════════════════════
# SNIPER ENGINE ROUTES
# ═══════════════════════════════════════════════════════

@sniper_bp.route('/analyze/<ticker>', methods=['GET'])
def analyze_ticker(ticker: str):
    """Analyze a single ticker using SniperEngine"""
    market = request.args.get('market', 'EGX')
    persona = request.args.get('persona', 'balanced')
    ticker_upper = ticker.upper()

    # ⚡ PRE-FILTER: فحص بوابة القطاع قبل أي حساب تسجيل
    # ده بيشتغل قبل engine.analyze() عشان نوفر وقت لو السهم مش بيلبي شروط قطاعه
    try:
        from api.misc_routes import _get_stock_name
        stock_info = _get_stock_name(ticker_upper)
        sector = stock_info.get('sector', '') or ''
        sector_key = _match_sector_key(sector)

        if sector_key != 'default' or sector:
            fundamentals = _load_fundamentals_for_gate(ticker_upper)
            if fundamentals:
                gate_result = check_sector_gate_pre(ticker_upper, sector_key, fundamentals)
                if not gate_result['passed']:
                    logger.info(f'[PRE-FILTER] {ticker_upper} مرفوض من بوابة {gate_result["gate_name"]}: {gate_result["reason"]}')
                    return jsonify({
                        'success': True,
                        'signal': 'HOLD',
                        'score': 0,
                        'verdict': 'مستبعد',
                        'reason': gate_result['reason'],
                        'gate_rejection': True,
                        'gate_name': gate_result['gate_name'],
                        'sector': sector,
                        'criteria_checked': gate_result['criteria_checked'],
                        'pre_filtered': True,
                        'timestamp': datetime.now().isoformat()
                    })
    except Exception as pre_err:
        logger.warning(f'[PRE-FILTER] خطأ في فحص بوابة القطاع لـ {ticker_upper}: {pre_err}')
        # في حال أي خطأ في الـ pre-filter — كمّل التحليل العادي

    engine = _get_sniper_engine()
    if not engine:
        return jsonify({'error': 'SniperEngine not available'}), 503
    
    try:
        result = engine.analyze(ticker_upper, market=market)
        if result is None:
            return jsonify({'error': f'No data for ticker {ticker}'}), 404
        
        # Convert dataclass to dict + إضافة الاسم (يوليو 2026)
        from dataclasses import asdict
        from api.misc_routes import _get_stock_name
        result_dict = asdict(result)
        stock_info = _get_stock_name(result_dict.get('ticker', ''))
        result_dict['name'] = stock_info['name']
        result_dict['name_ar'] = stock_info['name_ar']
        result_dict['sector'] = stock_info.get('sector', '') or result_dict.get('sector', '')
        # FIX-RECOMMENDATIONS (يوليو 2026): أضفنا logo_url
        result_dict['logo_url'] = stock_info.get('logo_url', '')

        return jsonify({
            'success': True,
            'result': result_dict,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error analyzing {ticker}: {e}")
        return jsonify({'error': str(e)}), 500


@sniper_bp.route('/scan', methods=['GET'])
def scan_market():
    """Scan a market for opportunities using SniperEngine with 5-gate filter.

    مراجعة (يوليو 2026): min_gates بقى persona-aware
    مراجعة (أغسطس 2026 — P14): فُتحت البوابات (gambler=1, investor=2) — خطر
    مراجعة (أغسطس 2026 — P15 SAFETY): رجّعنا البوابات الآمنة + استثناء ATH
    - gambler  → min_gates=2 (المضارب يقبل بوابتين — أمان من فخاخ الـ slippage)
    - balanced → min_gates=3 (لم يتغير)
    - investor → min_gates=3 (المستثمر 3 بوابات — قرار متين)
    استثناء: لو السهم في حالة "اختراق تاريخي" (ATH breakout) → min_gates=1
    مسموح. المستخدم ممكن يحدد min_gates صراحةً ويبقى override.
    """
    market = request.args.get('market', 'EGX')
    persona = request.args.get('persona', 'balanced')
    # P15: رجّعنا البوابات الآمنة (gambler=2, investor=3) عشان منعش فخاخ
    # الـ pump & dump مع تأخير 5 دقايق. بوابة واحدة مسموحة بس للاختراق التاريخي.
    persona_default_gates = {'gambler': 2, 'balanced': 3, 'investor': 3}
    default_gates = persona_default_gates.get(persona, 3)
    _user_set_min_gates = request.args.get('min_gates') is not None
    min_gates = int(request.args.get('min_gates', str(default_gates)))
    limit = int(request.args.get('limit', '10'))

    engine = _get_sniper_engine()
    if not engine:
        return jsonify({'error': 'SniperEngine not available'}), 503

    try:
        # لو المستخدم حدد min_gates صراحةً → نحترمه زي ما هو.
        # لو لا (استخدمنا persona default) → نفحص بـ min_gates=1 داخلياً
        # ونطبّق استثناء "الاختراق التاريخي" (ATH breakout): سهم ببوابة واحدة
        # بس يعدّي لو هو في حالة اختراق تاريخي (within 2% of all-time high).
        if _user_set_min_gates:
            results = engine.scan_market(market=market, persona=persona, min_gates=min_gates)
        else:
            _raw_results = engine.scan_market(market=market, persona=persona, min_gates=1)
            results = []
            for _r in _raw_results:
                if _r.gates_passed >= default_gates:
                    results.append(_r)
                elif _r.gates_passed >= 1 and _is_ath_breakout(_r.ticker):
                    # 🏆 اختراق تاريخي — استثناء بوابة واحدة
                    try:
                        _r.warnings_ar = (_r.warnings_ar or []) + [
                            '🏆 اختراق تاريخي (ATH) — استثناء بوابة واحدة'
                        ]
                    except Exception:
                        pass
                    results.append(_r)
        # Limit results
        results = results[:limit]

        from dataclasses import asdict
        # إضافة name + name_ar + sector + تنظيف ticker (يوليو 2026)
        # المستخدم طلب عرض الأسماء العربية بجانب الرموز
        from api.misc_routes import _get_stock_name
        import re as _re

        def _clean_ticker(t):
            """ينضّف الـ ticker من الـ suffixes العربية والـ D/N/etc."""
            if not t:
                return ''
            # شيل أي حروف عربية + الـ D/N suffixes
            t = _re.sub(r'[^\x00-\x7F]', '', t)  # شيل غير ASCII (عربي)
            t = _re.sub(r'\s+', '', t)            # شيل مسافات
            t = t.split('.')[0]                   # شيل .CA, .SR, إلخ
            return t.upper().strip()

        enriched_results = []
        for r in results:
            d = asdict(r)
            # نضّف الـ ticker الأول
            raw_ticker = d.get('ticker', '')
            clean_ticker = _clean_ticker(raw_ticker)
            d['ticker'] = clean_ticker
            d['symbol'] = clean_ticker

            stock_info = _get_stock_name(clean_ticker)
            # لو الاسم لسه = ticker (مش لاقيناه)، جرّب الـ raw_ticker
            if stock_info['name'] == clean_ticker and raw_ticker != clean_ticker:
                stock_info = _get_stock_name(raw_ticker)

            d['name'] = stock_info['name']
            d['name_ar'] = stock_info['name_ar']
            # لو الاسم = ticker، شيله من الـ name عشان الـ frontend يعرض الـ ticker
            if d['name'] == clean_ticker:
                d['name'] = clean_ticker
                d['name_ar'] = clean_ticker
            d['sector'] = stock_info.get('sector', '') or d.get('sector', '')
            # FIX-RECOMMENDATIONS (يوليو 2026): أضفنا logo_url
            d['logo_url'] = stock_info.get('logo_url', '')

            # ── البوابة القطاعية الخامسة ──
            # نطبق شروط القطاع على السهم ونعلّم النتيجة (من غير ما نشيله)
            try:
                sector_name = d.get('sector', '') or ''
                # نحاول نطابق اسم القطاع مع مفاتيح SECTOR_GATES
                sector_key = _match_sector_key(sector_name)
                gate_passed, gate_reason = _apply_sector_gate(d, sector_key)
                d['sector_gate_passed'] = gate_passed
                d['sector_gate_reason'] = gate_reason
                d['sector_gate_config'] = SECTOR_GATES.get(sector_key, SECTOR_GATES['default'])['description']
            except Exception as sg_err:
                logger.warning(f'خطأ في تطبيق البوابة القطاعية: {sg_err}')
                d['sector_gate_passed'] = True
                d['sector_gate_reason'] = f'تجاوز بسبب خطأ: {str(sg_err)}'
                d['sector_gate_config'] = ''

            enriched_results.append(d)

        return jsonify({
            'success': True,
            'count': len(enriched_results),
            'results': enriched_results,
            'market': market,
            'persona': persona,
            'min_gates': min_gates,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error scanning market {market}: {e}")
        return jsonify({'error': str(e)}), 500


# ═══════════════════════════════════════════════════════
# TRACK (SAVE PREDICTION) ROUTE
# ═══════════════════════════════════════════════════════

@sniper_bp.route('/track', methods=['POST'])
def track_ticker():
    """Track a ticker — run SniperEngine analysis and save as PENDING prediction."""
    ticker = request.args.get('ticker', '').upper()
    market = request.args.get('market', 'EGX')
    persona = request.args.get('persona', 'balanced')

    if not ticker:
        return jsonify({'error': 'ticker query parameter is required'}), 400

    # Run SniperEngine analysis
    engine = _get_sniper_engine()
    if not engine:
        return jsonify({'error': 'SniperEngine not available'}), 503

    try:
        result = engine.analyze(ticker, market=market)
    except Exception as e:
        logger.error(f"Error analyzing {ticker} for track: {e}")
        return jsonify({'error': f'Analysis failed: {str(e)}'}), 500

    if result is None:
        return jsonify({'error': f'No data available for ticker {ticker}'}), 404

    # 🔥 VERIFY-FIX-4: Unified guard chain (same as Maestro).
    # قبل كده كان الـ /track بـ يعمل INSERT مباشر بـ skip كل الـ guards.
    # ده معناه إن تبويب الـ Sniper ممكن يـ record صفقة بـ R/R < 1.5 أو بـ stop
    # مختلف تماماً عن تبويب المايسترو لنفس السهم. دلوقتي بنـ apply نفس الـ
    # guard chain: ATR-based stop (يوحّد الـ SL مع المايسترو) → direction check
    # → R/R ≥ 1.5. لو أي guard رفض → نـ return 422 بدل ما نـ record صفقة خطيرة.
    _sig = (result.signal or '').upper()
    _is_actionable = _sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY',
                              'SELL', 'STRONG_SELL', 'REDUCE')
    if _GUARDS_AVAILABLE and _is_actionable and result.entry_price > 0:
        _entry = float(result.entry_price)
        _stop = float(result.stop_loss or 0)
        _target = float(result.target_price or 0)
        _atr = float(result.atr or 0)
        _persona = persona or 'balanced'

        # Guard 1: ATR-based stop normalization (unifies Sniper SL with Maestro SL).
        # الـ Sniper كان بـ يستخدم ATR×{2.0/2.5/3.0} bounded 0.5-15% — مختلف
        # عن المايسترو (ATR×{1.0/1.5/2.0} bounded 3-7%). دلوقتي كلاهما يستخدم
        # نفس الدالة → نفس الـ stop لنفس السهم.
        if _atr > 0 and _stop > 0:
            _atr_check = enforce_atr_based_stop(_sig, _entry, _stop, _atr, _persona)
            if _atr_check['action'] == 'replace_stop' and _atr_check['fixed']:
                _old_stop = _stop
                _stop = _atr_check['fixed']['stop_loss']
                logger.info(f"[Sniper/track] {ticker} ATR-stop normalize: {_old_stop}->{_stop} ({_atr_check['reason']})")

        # Guard 2: direction check
        _dir_check = validate_target_stop_direction(_sig, _entry, _target, _stop)
        if _dir_check['action'] == 'fix_target' and _dir_check['fixed']:
            if 'target_price' in _dir_check['fixed']:
                _target = _dir_check['fixed']['target_price']
            if 'stop_loss' in _dir_check['fixed']:
                _stop = _dir_check['fixed']['stop_loss']
        elif _dir_check['action'] == 'reject':
            logger.info(f"[Sniper/track] {ticker} REJECTED (direction): {_dir_check['reason']}")
            return jsonify({
                'error': f'Guard reject (direction): {_dir_check["reason"]}',
                'guard': 'validate_target_stop_direction',
            }), 422

        # Guard 3: R/R ≥ 1.5 (load min_rr from optimizer_params like the Maestro)
        _min_rr = 1.5
        try:
            from api.optimizer_params_routes import get_optimizer_params
            _opt = get_optimizer_params()
            _min_rr = float(_opt.get('min_rr_ratio', 1.5) or 1.5)
        except Exception:
            pass  # fallback to 1.5
        _rr_check = enforce_min_rr(_sig, _entry, _target, _stop, min_rr=_min_rr)
        if _rr_check['action'] == 'widen_target' and _rr_check['fixed']:
            _old_target = _target
            _target = _rr_check['fixed']['target_price']
            logger.info(f"[Sniper/track] {ticker} R/R widen: {_old_target}->{_target} (rr={_rr_check['rr']}, was {_rr_check['reason']})")
        elif _rr_check['action'] == 'reject':
            logger.info(f"[Sniper/track] {ticker} REJECTED (R/R): {_rr_check['reason']}")
            return jsonify({
                'error': f'Guard reject (R/R < {_min_rr}): {_rr_check["reason"]}',
                'guard': 'enforce_min_rr',
                'rr': _rr_check.get('rr', 0),
            }), 422

        # Write the GUARDED values back to the result so the INSERT uses them
        result.stop_loss = _stop
        result.target_price = _target
        result.risk_reward = compute_planned_rr(_sig, _entry, _target, _stop)

    # Ensure predictions table exists
    _ensure_predictions_table()

    # 🔥 MASTER DIRECTIVE المحور 3 (HARD GEOMETRY GATE) — قبل INSERT المباشر.
    # sniper_routes بـ يعمل INSERT مباشر (مش عبر record_prediction) فلازم نضيف
    # الحراسة هنا كمان. لو أي قاعدة فشلت → SKIP الحفظ.
    try:
        from analyzers.prediction_tracker import enforce_geometry_guard
        enforce_geometry_guard(result.signal, result.entry_price,
                               result.target_price, result.stop_loss)
    except AssertionError as _geo_err:
        logger.warning(
            f"[GEOMETRY-REJECT] sniper ticker={result.ticker} signal={result.signal} "
            f"entry={result.entry_price} target={result.target_price} "
            f"stop={result.stop_loss} | {_geo_err}"
        )
        return None
    except Exception as _geo_imp:
        logger.warning(
            f"[GEOMETRY-UNAVAILABLE] sniper ticker={result.ticker} "
            f"guard failed ({_geo_imp}) → SKIP (fail-safe)"
        )
        return None

    # Save as PENDING prediction via PredictionTracker.record_prediction()
    # ─────────────────────────────────────────────────────────────────────
    # 🔥 BATCH-1.1 (v3.69.x): استبدال الـ INSERT المباشر بـ record_prediction.
    # قبل كده الـ /track كان بـ يعمل INSERT بـ 13 عمود فقط، فبـ يـ bypass:
    #   - dedup (ticker, persona) → تراكم صفوف مكررة
    #   - cap (5 per persona) → 44+ PENDING
    #   - W-quality rules (data_quality_rules W1–W9)
    #   - 22+ column (atr_at_entry, target_price_2, explosive_*, evidence_count,
    #     morning_bell, kill_filter_result, signal_type, master_score, ...)
    # دلوقتي نفس مسار الـ Maestro: record_prediction بـ يكتب كل الأعمدة ويطبّق
    # كل الـ guards الـ write-time. لو رجع None → الـ guards رفضت التوقع.
    #
    # ── RULE 35 HARD GATE (2026-10-12 — PRED-WRITE-GUARD) ─────────────────
    # Sniper routes are NOT a sanctioned prediction writer per Rule 35
    # (ENGINE-UNIFY). Only V40.2 (daily_predictor.py EGX + intraday_scanner.py)
    # and dual_track_generator.py (Rule 49) may write to predictions.
    #
    # The previous code (L812-833) called record_prediction with:
    #   - evidence_count=0  (no V40.2 evidence pipeline)
    #   - kill_filter_result=''  (no V40.2 kill filters)
    #   - morning_bell=0  (hardcoded)
    # → placeholder predictions polluted the DB (Rule 27 NO-FAKE-DATA breach).
    #
    # The PREDICTION-WRITE-GUARD in record_prediction() will now REJECT these
    # calls anyway, but we add this explicit 422 here so:
    #   1. The frontend gets a clear "Rule 35 violation" message
    #   2. The DB never sees the rogue INSERT attempt
    #   3. Logs are explicit about why the call was rejected
    return jsonify({
        'success': False,
        'rejected': True,
        'reason': 'Rule 35 violation: /api/sniper/track is no longer a '
                  'sanctioned prediction writer. Predictions must originate '
                  'from V40.2 (daily_predictor.py) or V40.2-intraday '
                  '(intraday_scanner.py). Sniper engine output is for '
                  'radar/screener display only, not for prediction INSERT.',
        'rule': 'ENGINE-UNIFY (Rule 35)',
        'reference': 'Documentation/00-CONSTITUTION.md §35 + §21 + §27',
        'fix': 'If you need a prediction for this ticker, run V40.2 generator: '
               'python3 vps-service/jobs/daily_predictor.py --today-only',
    }), 422

    #pylint: disable=unreachable
    # The code below is preserved for historical reference (Rule 16 VERIFY-BEFORE-DELETE).
    # It is now UNREACHABLE due to the Rule 35 hard gate above.
    try:
        from analyzers.prediction_tracker import PredictionTracker
        tracker = PredictionTracker(PREDICTIONS_DB)
        prediction_id = tracker.record_prediction(
            ticker=result.ticker,
            signal=result.signal,
            entry_price=result.entry_price,
            target_price=result.target_price,
            stop_loss=result.stop_loss,
            master_score=result.sniper_score,
            technical_score=result.technical_score,
            fundamental_score=result.fundamental_score,
            ai_pattern_score=None,   # SniperEngine لا ينتجه → default 50
            sentiment_score=None,    # SniperEngine لا ينتجه → default 50
            notes='',
            persona=persona,
            atr_at_entry=result.atr,
            target_price_2=None,     # Sniper لا يحسب T2
            explosive_score=0.0,
            explosive_label='',
            prediction_date=None,    # record_prediction بـ يحسبه
            evidence_count=0,
            morning_bell=0,
            kill_filter_result='',
        )

        if prediction_id is None:
            # record_prediction رجع None → الـ guards رفضت (geometry / W-rule /
            # cap 5-per-persona). نرجع 422 بدل ما نـ record صفحة ناقصة.
            logger.info(
                f"[Track] {ticker} NOT saved — record_prediction rejected "
                f"(geometry/W-rule/cap). signal={result.signal}"
            )
            return jsonify({
                'success': False,
                'rejected': True,
                'reason': 'record_prediction guards rejected the prediction',
            }), 422

        logger.info(f"[Track] Saved prediction #{prediction_id} for {ticker} ({result.signal})")
        return jsonify({'success': True, 'prediction_id': prediction_id})
    except Exception as e:
        logger.error(f"Error saving prediction for {ticker}: {e}")
        return jsonify({'error': str(e)}), 500


# ═══════════════════════════════════════════════════════
# DAILY CLOSER ROUTES
# ═══════════════════════════════════════════════════════

@sniper_bp.route('/closer/run', methods=['POST'])
def run_daily_closer():
    """Manually trigger the daily closer"""
    closer = _get_daily_closer()
    if not closer:
        return jsonify({'error': 'DailyCloser not available'}), 503
    
    try:
        result = closer.run()
        return jsonify({
            'success': True,
            'result': result,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error running daily closer: {e}")
        return jsonify({'error': str(e)}), 500


@sniper_bp.route('/closer/pending', methods=['GET'])
def get_pending_predictions():
    """Get count of pending predictions"""
    closer = _get_daily_closer()
    if not closer:
        return jsonify({'error': 'DailyCloser not available'}), 503
    
    try:
        pending = closer.get_pending_predictions()
        return jsonify({
            'success': True,
            'count': len(pending),
            'predictions': pending[:50],  # Limit to 50
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error getting pending predictions: {e}")
        return jsonify({'error': str(e)}), 500


# ═══════════════════════════════════════════════════════
# LEARNING ENGINE ROUTES
# ═══════════════════════════════════════════════════════

@sniper_bp.route('/learning/run', methods=['POST'])
def run_learning_engine():
    """Manually trigger the learning engine"""
    period_days = int(request.args.get('period_days', '7'))
    
    engine = _get_learning_engine()
    if not engine:
        return jsonify({'error': 'LearningEngine not available'}), 503
    
    try:
        report = engine.run(period_days=period_days)
        from dataclasses import asdict
        return jsonify({
            'success': True,
            'report': asdict(report),
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error running learning engine: {e}")
        return jsonify({'error': str(e)}), 500


@sniper_bp.route('/learning/lessons', methods=['GET'])
def get_lessons():
    """Get learned lessons"""
    engine = _get_learning_engine()
    if not engine:
        return jsonify({'error': 'LearningEngine not available'}), 503
    
    try:
        import sqlite3
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('predictions', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(engine.predictions_db, timeout=15.0)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Check if table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='learned_lessons'")
        if not cursor.fetchone():
            conn.close()
            return jsonify({'success': True, 'lessons': [], 'count': 0})
        
        cursor.execute("SELECT * FROM learned_lessons ORDER BY updated_at DESC LIMIT 100")
        rows = cursor.fetchall()
        conn.close()
        
        return jsonify({
            'success': True,
            'lessons': [dict(r) for r in rows],
            'count': len(rows),
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error getting lessons: {e}")
        return jsonify({'error': str(e)}), 500


@sniper_bp.route('/learning/performance', methods=['GET'])
def get_performance():
    """Get performance metrics computed from predictions table.

    Returns format expected by PerformanceTracker.tsx:
      { success, metrics: {...}, recent_closed: [...], lessons: [...] }
    """
    _ensure_predictions_table()

    empty_metrics = {
        'win_rate': 0.0, 'profit_factor': 0.0, 'avg_win_pct': 0.0,
        'avg_loss_pct': 0.0, 'total_predictions': 0, 'total_wins': 0,
        'total_losses': 0, 'total_breakeven': 0, 'best_trade_pct': 0.0,
        'worst_trade_pct': 0.0, 'avg_hold_days': 0,
    }

    try:
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('predictions', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(PREDICTIONS_DB, timeout=15.0)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # ── 1. Compute metrics from closed predictions ──────────────────
        cursor.execute("""
            SELECT id, ticker, market, signal, signal_ar,
                   entry_price, target_price, stop_loss,
                   actual_return, actual_exit_price,
                   status, days_to_close, pnl_pct,
                   created_at, closed_at
            FROM predictions
            WHERE status IN ('TARGET_HIT', 'STOPPED', 'EXPIRED')
        """)
        closed_rows = cursor.fetchall()

        if not closed_rows:
            # No closed predictions yet — return empty structure
            recent_closed = []
            lessons = _get_lessons_from_db(cursor)
            conn.close()
            return jsonify({
                'success': True,
                'metrics': empty_metrics,
                'recent_closed': recent_closed,
                'lessons': lessons,
                'sector_stats': [],
            })

        total = len(closed_rows)
        wins = []       # pnl_pct > 0
        losses = []     # pnl_pct < 0
        breakeven = []  # pnl_pct == 0
        all_pnls = []
        hold_days = []

        for row in closed_rows:
            # Compute pnl_pct: prefer stored value, else derive from actual_return
            pnl = row['pnl_pct'] if row['pnl_pct'] is not None else row['actual_return']
            if pnl is None:
                # Derive from status as a fallback
                if row['status'] == 'TARGET_HIT':
                    pnl = 0.0  # will be refined below
                elif row['status'] == 'STOPPED':
                    pnl = 0.0
                else:
                    pnl = 0.0
            pnl = float(pnl)
            all_pnls.append(pnl)

            if pnl > 0.5:
                wins.append(pnl)
            elif pnl < -0.5:
                losses.append(pnl)
            else:
                breakeven.append(pnl)

            if row['days_to_close'] is not None and row['days_to_close'] > 0:
                hold_days.append(int(row['days_to_close']))

        total_wins = len(wins)
        total_losses = len(losses)
        total_breakeven = len(breakeven)

        win_rate = round(total_wins / total * 100, 1) if total > 0 else 0.0
        avg_win_pct = round(sum(wins) / len(wins), 2) if wins else 0.0
        avg_loss_pct = round(sum(losses) / len(losses), 2) if losses else 0.0

        gross_profit = sum(wins) if wins else 0.0
        gross_loss = abs(sum(losses)) if losses else 0.001  # avoid division by zero
        profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0.0

        best_trade_pct = round(max(all_pnls), 2) if all_pnls else 0.0
        worst_trade_pct = round(min(all_pnls), 2) if all_pnls else 0.0
        avg_hold = round(sum(hold_days) / len(hold_days)) if hold_days else 0

        metrics = {
            'win_rate': win_rate,
            'profit_factor': profit_factor,
            'avg_win_pct': avg_win_pct,
            'avg_loss_pct': avg_loss_pct,
            'total_predictions': total,
            'total_wins': total_wins,
            'total_losses': total_losses,
            'total_breakeven': total_breakeven,
            'best_trade_pct': best_trade_pct,
            'worst_trade_pct': worst_trade_pct,
            'avg_hold_days': avg_hold,
        }

        # ── 2. Recent 20 closed predictions ────────────────────────────
        cursor.execute("""
            SELECT id, ticker, market, signal, signal_ar,
                   entry_price, target_price, stop_loss,
                   actual_return, actual_exit_price,
                   status, days_to_close, pnl_pct,
                   created_at, closed_at
            FROM predictions
            WHERE status IN ('TARGET_HIT', 'STOPPED', 'EXPIRED')
            ORDER BY closed_at DESC
            LIMIT 20
        """)
        recent_rows = cursor.fetchall()

        recent_closed = []
        for row in recent_rows:
            pnl = row['pnl_pct'] if row['pnl_pct'] is not None else row['actual_return']
            if pnl is None:
                pnl = 0.0
            pnl = float(pnl)

            # Determine result
            if pnl > 0.5:
                result = 'win'
            elif pnl < -0.5:
                result = 'loss'
            else:
                result = 'breakeven'

            signal_ar = row['signal_ar'] or SIGNAL_AR.get(row['signal'] or '', row['signal'] or '')
            hold_d = int(row['days_to_close']) if row['days_to_close'] is not None else None

            recent_closed.append({
                'id': str(row['id']),
                'ticker': row['ticker'] or '',
                'market': row['market'] or 'EGX',
                'signal': row['signal'] or '',
                'signal_ar': signal_ar,
                'entry_price': float(row['entry_price'] or 0),
                'target_price': float(row['target_price'] or 0),
                'stop_loss': float(row['stop_loss'] or 0),
                'actual_exit_price': float(row['actual_exit_price']) if row['actual_exit_price'] is not None else None,
                'result': result,
                'pnl_pct': round(pnl, 2),
                'opened_at': row['created_at'] or '',
                'closed_at': row['closed_at'] or None,
                'hold_days': hold_d,
            })

        # ── 3. Lessons ─────────────────────────────────────────────────
        lessons = _get_lessons_from_db(cursor)

        # ── 4. Sector-level stats ───────────────────────────────────────
        # نحسب أداء التنبؤات حسب القطاع عشان نعرّف أنسب قطاع
        sector_stats = _compute_sector_stats(cursor)

        conn.close()

        return jsonify({
            'success': True,
            'metrics': metrics,
            'recent_closed': recent_closed,
            'lessons': lessons,
            'sector_stats': sector_stats,
        })

    except Exception as e:
        logger.error(f"Error getting performance: {e}")
        return jsonify({'error': str(e)}), 500


def _get_lessons_from_db(cursor) -> list:
    """Fetch lessons from learned_lessons table in the format the frontend expects."""
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='learned_lessons'")
    if not cursor.fetchone():
        return []

    try:
        cursor.execute("SELECT * FROM learned_lessons ORDER BY updated_at DESC LIMIT 50")
        rows = cursor.fetchall()
    except Exception:
        return []

    lessons = []
    for row in rows:
        d = dict(row) if hasattr(row, 'keys') else dict(row)
        # Map DB columns to frontend format
        lesson_text = (
            d.get('recommendation')
            or d.get('condition')
            or d.get('outcome')
            or ''
        )
        if d.get('condition') and d.get('outcome'):
            lesson_text = f"{d['condition']} → {d['outcome']}"

        category = d.get('lesson_type', 'technical')
        if category in ('pattern_failure', 'pattern_success'):
            category = 'technical'
        elif category in ('filter_rule', 'weight_adjustment'):
            category = 'risk'
        elif category in ('market_analysis',):
            category = 'behavioral'

        lessons.append({
            'id': str(d.get('id', '')),
            'lesson': lesson_text,
            'category': category,
            'frequency': int(d.get('occurrences', 0) or 0),
            'last_seen': d.get('updated_at') or d.get('created_at') or '',
        })
    return lessons


def _match_sector_key(sector_name: str) -> str:
    """
    يطابق اسم القطاع (سواء عربي أو إنجليزي) مع مفتاح في SECTOR_GATES.
    يرجع المفتاح المطابق أو 'default' لو ملقناش.
    """
    if not sector_name:
        return 'default'
    sector_lower = sector_name.strip().lower()

    # خريطة المطابقة — أسماء القطاعات الممكنة (عربي + إنجليزي)
    sector_map = {
        'banks': ['بنوك', 'bank', 'banks', 'banking'],
        'real_estate': ['عقار', 'عقارات', 'real estate', 'realestate', 'property'],
        'tourism': ['سياحة', 'فنادق', 'tourism', 'hotel', 'hotels', 'travel'],
        'chemicals': ['كيماويات', 'chemical', 'chemicals', 'petrochemical'],
        'food': ['أغذية', 'غذاء', 'food', 'foods', 'consumer'],
    }

    for key, aliases in sector_map.items():
        for alias in aliases:
            if alias in sector_lower:
                return key

    return 'default'


def _compute_sector_stats(cursor) -> list:
    """
    يحسب إحصائيات الأداء حسب القطاع من جدول التنبؤات المغلقة.
    يرجع list من dicts: [{sector, total, wins, losses, win_rate}, ...]
    """
    try:
        cursor.execute("""
            SELECT ticker, status, pnl_pct, actual_return
            FROM predictions
            WHERE status IN ('TARGET_HIT', 'STOPPED', 'EXPIRED')
        """)
        rows = cursor.fetchall()

        if not rows:
            return []

        # نجمع حسب القطاع — نشيك القطاع من الـ ticker
        from api.misc_routes import _get_stock_name
        sector_data = {}  # sector_key -> {total, wins, losses, pnl_sum}

        for row in rows:
            ticker = row['ticker'] or ''
            pnl = float(row['pnl_pct'] if row['pnl_pct'] is not None else row['actual_return'] or 0)

            try:
                stock_info = _get_stock_name(ticker)
                sector_name = stock_info.get('sector', '') or ''
                sector_key = _match_sector_key(sector_name)
            except Exception:
                sector_key = 'default'

            if sector_key not in sector_data:
                sector_data[sector_key] = {'total': 0, 'wins': 0, 'losses': 0, 'pnl_sum': 0.0}

            sector_data[sector_key]['total'] += 1
            sector_data[sector_key]['pnl_sum'] += pnl
            if pnl > 0.5:
                sector_data[sector_key]['wins'] += 1
            elif pnl < -0.5:
                sector_data[sector_key]['losses'] += 1

        # نرتّب حسب عدد التنبؤات (الأكتر أول)
        result = []
        for key in sorted(sector_data.keys(), key=lambda k: sector_data[k]['total'], reverse=True):
            data = sector_data[key]
            win_rate = round(data['wins'] / data['total'] * 100, 1) if data['total'] > 0 else 0.0
            avg_pnl = round(data['pnl_sum'] / data['total'], 2) if data['total'] > 0 else 0.0
            gate_desc = SECTOR_GATES.get(key, SECTOR_GATES['default'])['description']
            result.append({
                'sector': key,
                'description': gate_desc,
                'total': data['total'],
                'wins': data['wins'],
                'losses': data['losses'],
                'win_rate': win_rate,
                'avg_pnl_pct': avg_pnl,
            })

        return result

    except Exception as e:
        logger.warning(f'خطأ في حساب إحصائيات القطاعات: {e}')
        return []


@sniper_bp.route('/sector-gate/<ticker>', methods=['GET'])
def check_sector_gate_endpoint(ticker):
    """فحص بوابة القطاع لسهم معين (pre-filter check)."""
    try:
        from api.misc_routes import _get_stock_name

        # جلب القطاع
        stock_info = _get_stock_name(ticker.upper())
        sector = stock_info.get('sector', '') or ''
        sector_key = _match_sector_key(sector)

        # جلب الأساسيات
        fundamentals = _load_fundamentals_for_gate(ticker.upper())

        result = check_sector_gate_pre(ticker.upper(), sector_key, fundamentals)
        result['ticker'] = ticker.upper()
        result['fundamentals'] = fundamentals
        result['gate_config'] = SECTOR_GATES.get(sector_key, {})

        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e), 'passed': True}), 500


@sniper_bp.route('/sector-gates', methods=['GET'])
def get_sector_gates():
    """
    يرجع إعدادات البوابات القطاعية كلها.
    مفيد للـ admin dashboard عشان يعرض الشروط.
    """
    try:
        # نرجّع نسخة من SECTOR_GATES مع إضافة ملاحظات
        result = {}
        for key, config in SECTOR_GATES.items():
            result[key] = dict(config)
            result[key]['key'] = key

        return jsonify({
            'success': True,
            'sectors': result,
            'total_sectors': len(result),
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        logger.error(f'خطأ في جلب إعدادات البوابات القطاعية: {e}')
        return jsonify({'error': str(e)}), 500


# ═══════════════════════════════════════════════════════
# SCHEDULER ROUTES
# ═══════════════════════════════════════════════════════

@sniper_bp.route('/scheduler/status', methods=['GET'])
def get_scheduler_status():
    """Get current scheduler status"""
    scheduler = _get_market_scheduler()
    if not scheduler:
        return jsonify({'error': 'MarketScheduler not available'}), 503
    
    try:
        return jsonify({
            'success': True,
            'status': scheduler.get_status(),
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error getting scheduler status: {e}")
        return jsonify({'error': str(e)}), 500
