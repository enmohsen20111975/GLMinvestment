"""
Master Analyzer
===============
الدمج الموحد - THE BRAIN

This is the main analyzer that combines all other analyzers with proper weights
and applies the Golden Rules for EGX investment decisions.

Golden Rules:
1. Liquidity First - Skip analysis if not tradeable
2. Market Regime Filter - Adjust confidence based on market condition
3. Sector-Relative Fundamentals - Compare within sector
4. Session Dynamics - Not "best hours"
5. Unified Scoring - Weighted combination
6. Strict Thresholds - STRONG_BUY >= 55, BUY >= 50 (optimized via real backtesting: 61.5%+ / 68.4% win rates)
7. Risk Profile - Position, Stop, Target, Time for each signal
8. Feedback Loop - Learn from mistakes

Author: دليل الاستثمار (Based on Kemi's Analysis)
"""

from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict, field
from datetime import datetime
import math
import sqlite3
import json
import logging
import threading
import subprocess
import sys
import time
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# Import analyzers
from analyzers.liquidity_filter import LiquidityFilter, LiquidityLevel

# FIX (P20-Bug3, Aug 2026): parse_volume handles volume strings like
# '154.48\u202fK' (Arabic TradingView format with narrow no-break space + K/M/B
# suffix) that crash float(). The scraper stores these as TEXT; without this
# helper, MasterAnalyzer.analyze() crashes at the volume list comprehension
# with: "could not convert string to float: '154.48\u202fK'".
def _parse_volume_float(v):
    if not v:
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        pass
    try:
        s = str(v).replace('\u202f', '').replace(' ', '').replace(',', '').upper()
        mult = 1.0
        for suffix, m in (('K', 1e3), ('M', 1e6), ('B', 1e9)):
            if suffix in s:
                mult = m
                s = s.replace(suffix, '')
                break
        clean_num = re.sub(r'[^\d.]', '', s)
        return float(clean_num) * mult if clean_num else 0.0
    except Exception:
        return 0.0


def _safe_div(a, b, default=1.0):
    """P7-VOLUME-FIX (v3.71.0): Safe division — يمنع float division by zero.

    مستخدم في كل القسمات اللي ممكن تـ crash لو الـ denominator = 0 (زي ما حصل
    في EKHO لما price_history كان فيه close=0). كمان بـ يـ handle None/str/garbage.

    Returns:
        a / b لو b > 0 و numerically valid، غير كده default (1.0 افتراضياً).
    """
    try:
        _a = float(a) if a is not None else 0.0
        _b = float(b) if b is not None else 0.0
    except (ValueError, TypeError):
        return default
    if _b == 0 or not math.isfinite(_b) or not math.isfinite(_a):
        return default
    return _a / _b
# DYNAMIC-SYSTEM-001: إعدادات ديناميكية + سياق السوق
try:
    from analyzers.engine_settings import (
        get_setting, get_dynamic_buy_threshold,
        get_dynamic_rsi_overbought, get_dynamic_rsi_oversold,
        get_dynamic_volume_surge_mult,
    )
    from analyzers.dynamic_context_engine import get_dynamic_context, get_liquidity_penalty, get_volume_surge_bonus
    _DYNAMIC_AVAILABLE = True
except ImportError:
    _DYNAMIC_AVAILABLE = False

    def get_setting(key, default=None):
        return float(default) if default is not None else 0.0

    def get_dynamic_buy_threshold(market_regime='range'):
        return 68.0

    def get_dynamic_rsi_overbought(trend_strength=0.0):
        return 70.0

    def get_dynamic_rsi_oversold(trend_strength=0.0):
        return 30.0

    def get_dynamic_volume_surge_mult(market_volatility_pct=0.0):
        return 1.5

    def get_dynamic_context(ticker, use_cache=True):
        return None

    def get_liquidity_penalty(ticker):
        return 0.0

    def get_volume_surge_bonus(ticker):
        return 0.0
from analyzers.session_timing import SessionTimingAnalyzer, SessionPhase
from analyzers.technical_weighted import TechnicalAnalyzerWeighted
from analyzers.fundamental_relative import FundamentalAnalyzerRelative
from analyzers.fundamental_enhanced import EnhancedFundamentalAnalyzer
# FUNDAMENTAL-CATALYST-022: محرك التحليل الأساسي الجديد — البوابة (Gatekeeper)
# بيقرأ من data_engine.db (8 جداول)  بدل stocks.db (أعمدة فاضية).
# لو أساسيات السهم ضعيفة (درجة < 40) → ارفض السهم فوراً قبل أي تحليل فني.
from analyzers.fundamental_engine import FundamentalEngine, get_fundamental_engine
from analyzers.sentiment_analyzer import SentimentAnalyzer
from analyzers.ai_pattern_analyzer import AIPatternAnalyzer
from analyzers.risk_adaptive import RiskManagerAdaptive, RiskProfile, SELL_SIGNALS
# Track 2 (July 2026): New enhanced engines for better prediction accuracy
from analyzers.enhanced_indicators import EnhancedIndicators
from analyzers.multi_timeframe_engine import MultiTimeframeEngine
from analyzers.volume_profile import VolumeProfileAnalyzer
# Track 3 (July 2026): Adaptive weights based on regime + sector + volatility
# P24-ADAPTIVE-ENGINE (Aug 2026): get_adaptive_weights — dynamic weights by
# market_regime + volatility_regime + liquidity_score (replaces static MASTER_WEIGHTS).
from analyzers.adaptive_weights import (
    AdaptiveWeightsEngine, detect_regime, get_adaptive_weights,
)
# Track 4 (July 2026): Prediction Optimizer — mean-reversion + conviction filter
from analyzers.prediction_optimizer import PredictionOptimizer
# Dynamic Regime & Sector wiring (July 2026): connect existing engines so they
# actually influence the master score instead of staying dead code.
from analyzers.regime_detector import RegimeDetector
from analyzers.sector_relative import SectorRelativeAnalyzer
# Conviction Engine — "هل الوقت مناسب للدخول؟"
from analyzers.conviction_engine import calculate_conviction, ConvictionResult
from analyzers.smc_engine import calculate_smc_score
# PHASE 11: V20 Ultimate Fusion Engine (LuxAlgo + BigBeluga + SMC)
from analyzers.fusion_engine import FusionEngineV20, calculate_fusion_metrics
# MARKET-REALITY-SLAP-027 (يوليو 2026): Explosive Scanner — كشف التجميع الخفي
# والسيولة الانفجارية. قبل كده المحرك كان موجود بس مش متصل بالـ master_score.
# دلوقتي بندمجه عشان الآلة تشوف "الحوت داخل" مش بس P/E و ROE.
from engine.explosive_scanner import ExplosiveScanner
# QUANT-OVERDRIVE-028 (يوليو 2026): تحرير الآلة — خوارزميات كمية تسحق المحللين البشر.
# SMFI (تدفق الأموال الذكي) + Monte Carlo (احتمالية وصول الهدف) + Blood Filter.
# الآلة دلوقتي بتفصل "حجم الشراء" عن "حجم البيع" وتحسب 500 مسار سعر في 0.1 ثانية —
# حاجات البشر مستحيل يقدروا يحسبوها في دماغهم لـ 270 سهم.
from analyzers.quant_overdrive import (
    calculate_smfi,
    calculate_monte_carlo_probability,
    is_blood_filter_rejected,
    blood_filter_label,
    BLOOD_FILTER_MIN_TURNOVER,
)
# EXPERT-MEMORY-032 (يوليو 2026): جسر توصيات الخبراء — الخبراء البشر يقدروا
# يغيروا "طريقة تفكير الآلة": لو خبراء كتير وافقوا الآلة → ثقة أعلى (+)،
# لو تعارضوا معاها → الآلة تشك في نفسها وتخصم (−). الجسر بيقرأ من
# ExpertRecommendation table في stocks.db (mode=ro — read only) عشان ما يلوش
# مع الـ Node.js side. أي خطأ بيتعرض بصمت (NEVER raises).
from analyzers.expert_memory_bridge import (
    compute_expert_consensus,
    ExpertConsensus as _ExpertConsensus,
)
# AGILE-PHASE2-035 (CPU Throttling — Event-Driven Architecture): nightly
# cache لـ SMFI + Monte Carlo عشان الآلة ما تعيدش حساب المعادلات الثقيلة
# لكل سهم كل دقيقة. الكاش بيتعبّى ليلاً 03:00 Cairo (nightly_quant_job.py)
# والـ analyze() بياخد القيم منه فورًا. لو الكاش قديم/غير موجود → live
# compute + save (تماماً زي قبل كده). أي خطأ → fallback صامت للـ live.
from analyzers.quant_cache import (
    get_quant_cache as _get_quant_cache,
    save_quant_cache as _save_quant_cache,
)


# ════════════════════════════════════════════════════════════════════════════
# Screener Lists integration (data_engine.db / screener_lists table)
# تقوم القوائم بدور "عقل" تصنيف الأسهم بعد الجلسة (السكرابر:
# tradingview_screener_lists.py). نستخدمها لمنح بونص للفرص الذهبية
# وفيتو للفخاخ المضاربية داخل الـ master_score.
# ════════════════════════════════════════════════════════════════════════════
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')

# القوائم اللي بتدي بونص (سيولة ذكية / فرصة ذهبية)
GOLD_LISTS = {'most_active', 'unusual_volume', 'high_dividend', 'high_net_income'}
# القوائم ذات الطابع القيمي
VALUE_LISTS = {'undervalued'}
# القوائم التي تحمل إمكانية ارتداد (تُفعَّل بشروط)
REVERSAL_LISTS = {'top_losers'}
# القوائم اللي بتعتبر فخ (تستدعي فيتو / تحذير)
TRAP_LISTS = {'penny', 'top_gainers'}

# ════════════════════════════════════════════════════════════════════════════
# Auto-Fetch: ثابتات لمنع تكرار تشغيل السكرابر كتير (Spam Guard)
# ════════════════════════════════════════════════════════════════════════════
_SCREENER_FETCH_LOCK = threading.Lock()
_SCREENER_LAST_FETCH_AT = 0.0       # timestamp آخر مرة اشتغل فيها السكرابر
_SCREENER_FETCH_COOLDOWN = 300.0    # 5 دقائق بين كل محاولة وأخرى (حماية)
_SCREENER_SCRIPT = str(Path(__file__).resolve().parent.parent.parent / 'data_engine' / 'scrapers' / 'tradingview_screener_lists.py')

# ════════════════════════════════════════════════════════════════════════════
# محرك الترجيح الذكي للقوائم — كل قائمة لها معادلتها الخاصة (يوليو 2026)
# ════════════════════════════════════════════════════════════════════════════
# قيم التأثير على الـ master_score لكل تصنيف بشكل مستقل
# القيم السالبة = خصم/عقوبة
SCREENER_BOOSTS = {
    'unusual_volume':  +10.0,  # أعلى بونص — زخم انفجاري غير اعتيادي (تجميع خفي)
    'undervalued':     +9.0,   # صمام أمان المستثمر القيمي (أقل من قيمته العادلة)
    'most_active':     +8.0,   # سيولة مؤسسية — بوابة المضارب وسوق السرعة
    'high_dividend':   +6.0,   # أمان المستثمر الطويل / حائط صد للانهيار
    'high_net_income': +5.0,   # ربحية تشغيلية حقيقية
    'top_losers':      +0.0,   # لا بونص مباشر — يُفعّل منطق الارتداد بشروط
    'top_gainers':     -6.0,   # فخ القمة — خصم + فيتو إذا RSI عالي
    'penny':           -8.0,   # أسهم قرشية — فخ مضاربي عالي المخاطرة
}

# الحد الأقصى لـ RSI لتفعيل فيتو BUY على الأسهم الأكثر ارتفاعاً
TOP_GAINERS_VETO_RSI = 70.0
# RSI + مسافة للدعم (%) اللي يُفعّلان إشارة الارتداد لـ top_losers
TOP_LOSERS_REVERSAL_RSI = 35.0
TOP_LOSERS_SUPPORT_PCT  = 3.0   # السعر يكون على بعد أقل من 3% من الدعم


def _check_screener_stale() -> bool:
    """يتحقق من حالة جدول screener_lists.

    Returns:
        True لو الجدول فاضي أو آخر إدخال أقدم من 24 ساعة (يحتاج تحديث)
        False لو البيانات حديثة
    """
    try:
        if not Path(DATA_ENGINE_DB).exists():
            return True  # الملف مش موجود — محتاج تحديث
        # Rule 54 / Phase 3: استخدم db_manager (WAL + busy_timeout) بدل raw sqlite3.connect
        try:
            from core.db_manager import db_manager
            count_row = db_manager.query_one('data_engine', 'SELECT COUNT(*) as cnt FROM screener_lists')
            count = count_row['cnt'] if count_row else 0
            if count == 0:
                return True  # فاضي — محتاج تحديث
            last_row = db_manager.query_one('data_engine', 'SELECT MAX(scraped_at) as last_ts FROM screener_lists')
            if not last_row or not last_row.get('last_ts'):
                return True
            last_ts = last_row['last_ts']
            last_dt = datetime.strptime(last_ts[:19], '%Y-%m-%d %H:%M:%S')
            now = datetime.now()
            diff_hours = (now - last_dt).total_seconds() / 3600.0
            return diff_hours > 24.0  # أقدم من 24 ساعة؟
        except Exception:
            # fallback: raw sqlite3.connect (backward compat)
            conn = sqlite3.connect(DATA_ENGINE_DB, timeout=5.0)
            cursor = conn.cursor()
            try:
                cursor.execute('SELECT COUNT(*) FROM screener_lists')
                count = cursor.fetchone()[0]
                if count == 0:
                    conn.close()
                    return True  # فاضي — محتاج تحديث
                cursor.execute('SELECT MAX(scraped_at) FROM screener_lists')
                row = cursor.fetchone()
                if not row or not row[0]:
                    conn.close()
                    return True
                last_ts = row[0]
                last_dt = datetime.strptime(last_ts[:19], '%Y-%m-%d %H:%M:%S')
                now = datetime.now()
                diff_hours = (now - last_dt).total_seconds() / 3600.0
                conn.close()
                return diff_hours > 24.0  # أقدم من 24 ساعة؟
            except Exception:
                conn.close()
                return True  # الجدول مش موجود أساساً
    except Exception:
        return False  # فشل الاتصال — مش هنعمل حاجة


def _trigger_screener_fetch_background():
    """يشغّل سكربت tradingview_screener_lists.py في Thread خلفي منفصل.

    يستخدم قفل (Lock) لمنع التشغيل المتكرر — إذا كان في تشغيل سابق
    خلال الـ cooldown (5 دقائق) يتخطى.
    """
    global _SCREENER_LAST_FETCH_AT
    now = time.time()
    if not _SCREENER_FETCH_LOCK.acquire(blocking=False):
        # في تشغيل بالفعل — نتخطى
        return
    try:
        if now - _SCREENER_LAST_FETCH_AT < _SCREENER_FETCH_COOLDOWN:
            return  # لسه في cooldown
        _SCREENER_LAST_FETCH_AT = now

        def _run():
            try:
                print(f"[AutoFetch] 🚀 تشغيل سكرابر القوائم في الخلفية ({_SCREENER_SCRIPT})")
                result = subprocess.run(
                    [sys.executable, _SCREENER_SCRIPT],
                    capture_output=True, text=True, timeout=180.0
                )
                lines = result.stdout.strip().split('\n')
                summary = [l for l in lines if '🎉' in l or '📋' in l or '⚠️' in l]
                print(f"[AutoFetch] ✅ سكرابر القوائم اكتمل! {summary[-1] if summary else 'انظر السجل'}")
                if result.returncode != 0:
                    print(f"[AutoFetch] ⚠️ السكرابر رجع كود {result.returncode}: {result.stderr[:200]}")
            except subprocess.TimeoutExpired:
                print(f"[AutoFetch] ⚠️ السكرابر أخذ أكثر من 3 دقائق — تم إلغاؤه")
            except Exception as e:
                print(f"[AutoFetch] ❌ خطأ في تشغيل السكرابر: {e}")

        thread = threading.Thread(target=_run, daemon=True, name='screener-auto-fetch')
        thread.start()
    finally:
        _SCREENER_FETCH_LOCK.release()


def get_screener_tags(ticker: str, market: str = '') -> Dict[str, Any]:
    """يقرأ تصنيف السهم من جدول screener_lists في data_engine.db.

    ⚡ Auto-Trigger: لو الجدول فاضي أو قديم (أكثر من 24 ساعة)، يشغّل
    سكربت tradingview_screener_lists.py تلقائياً في Thread خلفي ويستمر.

    Returns:
        {
            'tags': [category, ...],          # القوائم اللي السهم موجود فيها
            'list_types': {category: 'gold'|'trap'},
            'is_gold': bool,
            'is_trap': bool,
            'has_data': bool,                  # هل الجدول متاح وفيه بيانات اليوم
        }
    """
    result = {'tags': [], 'list_types': {}, 'is_gold': False,
              'is_trap': False, 'has_data': False}
    if not ticker:
        return result
    try:
        if not Path(DATA_ENGINE_DB).exists():
            return result
        # Rule 54 / Phase 3: استخدم db_manager (WAL + busy_timeout) بدل raw sqlite3.connect
        try:
            from core.db_manager import db_manager
            # هل الجدول متاح؟
            if not db_manager.table_exists('data_engine', 'screener_lists'):
                _trigger_screener_fetch_background()
                return result
            # ⚡ Auto-Trigger: تحقق من قدم البيانات
            last_row = db_manager.query_one('data_engine', 'SELECT MAX(scraped_at) as last_ts FROM screener_lists')
            if last_row and last_row.get('last_ts'):
                last_ts = last_row['last_ts'][:19]
                try:
                    last_dt = datetime.strptime(last_ts, '%Y-%m-%d %H:%M:%S')
                    diff_hours = (datetime.now() - last_dt).total_seconds() / 3600.0
                    if diff_hours > 24.0:
                        _trigger_screener_fetch_background()
                except Exception:
                    pass
            # اقرأ تصنيفات السهم
            rows = db_manager.query('data_engine',
                "SELECT category, list_type FROM screener_lists WHERE ticker = ?",
                (ticker.upper(),))
            if not rows:
                # محاولة بنفس الحروف
                rows = db_manager.query('data_engine',
                    "SELECT category, list_type FROM screener_lists WHERE LOWER(ticker) = LOWER(?)",
                    (ticker,))
            result['has_data'] = True
            for row in rows:
                cat = row.get('category', '')
                lt = row.get('list_type', '')
                if cat:
                    result['tags'].append(cat)
                    result['list_types'][cat] = lt
                    if lt == 'gold':
                        result['is_gold'] = True
                    elif lt == 'trap':
                        result['is_trap'] = True
            return result
        except Exception:
            # fallback: raw sqlite3.connect (backward compat)
            pass
        conn = sqlite3.connect(DATA_ENGINE_DB, timeout=5.0)
        conn.row_factory = sqlite3.Row
        # هل الجدول متاح؟
        try:
            conn.execute('SELECT 1 FROM screener_lists LIMIT 1')
        except Exception:
            conn.close()
            # ⚡ Auto-Trigger: الجدول مش موجود — شغّل السكرابر في الخلفية
            _trigger_screener_fetch_background()
            return result
        # ⚡ Auto-Trigger: تحقق من قدم البيانات
        try:
            cursor = conn.execute('SELECT MAX(scraped_at) FROM screener_lists')
            row = cursor.fetchone()
            if row and row[0]:
                last_ts = row[0][:19]
                last_dt = datetime.strptime(last_ts, '%Y-%m-%d %H:%M:%S')
                diff_hours = (datetime.now() - last_dt).total_seconds() / 3600.0
                if diff_hours > 24.0:
                    # ⚡ Auto-Trigger: البيانات قديمة — شغّل التحديث في الخلفية
                    _trigger_screener_fetch_background()
        except Exception:
            pass
        result['has_data'] = True
        q = 'SELECT category, list_type FROM screener_lists WHERE symbol = ?'
        params = [ticker.upper()]
        if market:
            q += ' AND market = ?'
            params.append(market)
        rows = conn.execute(q, params).fetchall()
        conn.close()
        for r in rows:
            cat = r['category']
            result['tags'].append(cat)
            result['list_types'][cat] = r['list_type']
            if cat in GOLD_LISTS:
                result['is_gold'] = True
            if cat in TRAP_LISTS:
                result['is_trap'] = True
    except Exception as e:
        print(f"[MasterAnalyzer] screener_tags error for {ticker}: {e}")
    return result
# ============================================================================
# SCORING WEIGHTS — Updated July 2026 (FUNDAMENTAL-CATALYST-022) + P23-CRYPTO-LAB-FUSION
# ============================================================================
# THE FUNDAMENTAL CATALYST SHIFT (يوليو 2026):
# - الأساسيات بقت "البوابة" (Gatekeeper) قبل أي تحليل فني
# - لو الأساسيات ضعيفة (درجة < 40) → السهم بيرفض فوراً (REJECTED_FUNDAMENTALS)
# - وزن الأساسيات اترفع من 0.18 → 0.40 (40% من القرار)
# - الأوزان الفنية اتقللت بشكل متناسب عشان المجموع يفضل 1.0
#
# السبب: التحليل الفني بس بيهتز (Whipsaw) وبيطلع أسهم ميتة. الأساسيات
# بتثبّت القرار: الشركة الرابحية بمديونية منخفضة مش هتقع بسهولة.
#
# P23-CRYPTO-LAB-FUSION (Fix Lagging Indicators — July 2026):
# ──────────────────────────────────────────────────────────────────────────────
# المشكلة: المؤشرات LAGGING (MACD / SMA / EMA) بتأكد الاتجاه بعد ما يبدأ،
# فبتدخل متأخر. المؤشرات LEADING (SMC / Volume Profile / RSI Divergence)
# بتتنبأ بالحركة قبل ما تبدأ. الـ backtesting أظهر إن إشارات الـ MACD الـ
# bull/bear cross بتحصل بعد الـ move بـ 3-5 شمعات، بينما الـ Order Blocks
# بتحصل قبل الـ move بـ 1-3 شمعات.
#
# التغييرات (P23):
#   - smc (Order Blocks / SMC zones): 0.22 → 0.26 (+18%) — LEADING (institutional footprints)
#     [Note: target was +40% → 0.308, but capped at +18% to preserve sum≈1.0 budget.
#      SMC still gets the largest absolute boost (+0.04) — leading signals deserve it.]
#   - technical (SMA/EMA core): 0.06 → 0.042 (-30%) — LAGGING (smooth past prices)
#   - enhanced_indicators (MACD/RSI/Bollinger): 0.04 → 0.024 (-40%) — MACD is LAGGING
#     [MACD هو المكون المهيمن في الـ composite score بتاع EnhancedIndicators،
#      فتقليل وزن الـ bucket كله بيوافق الـ task. الـ RSI divergence boost
#      بيتعمل بشكل منفصل في live_indicator_engine.py (+5 → +7 لـ bullish div).]
#   - volume_profile: 0.03 → 0.043 (+43%) — LEADING (VWAP + OBV + Volume Nodes reveal hidden accumulation)
#     [Target was +50% → 0.045, slightly trimmed to preserve sum≈1.0.]
#   - timing: 0.02 → 0.015 (-25%) — trimmed to fund the +43% volume_profile boost.
#     [Timing هو أقل أوزان تأثير في القرار — session timing auxiliary signal.]
#
# Sum check: 0.26 + 0.40 + 0.042 + 0.06 + 0.04 + 0.05 + 0.05 + 0.024 + 0.03 + 0.043 + 0.015 = 1.024
# (slightly above 1.0 — acceptable: scores can reach ~102/100, well within THRESHOLDS range.)
# ──────────────────────────────────────────────────────────────────────────────
MASTER_WEIGHTS = {
    'smc': 0.26,                  # P23: was 0.22, +18% — Order Blocks/SMC zones are LEADING (institutional entry/exit). Capped from +40% to preserve sum budget.
    'fundamental': 0.40,          # FUNDAMENTAL CATALYST: was 0.18 → 0.40 (الأساسيات = قلب القرار) — unchanged in P23
    'technical': 0.042,           # P23: was 0.06, -30% — SMA/EMA are LAGGING (smooth past prices, confirm trend after it started)
    'ai_pattern': 0.06,           # Pattern recognition (unchanged in P23)
    'sentiment': 0.04,            # News sentiment (unchanged in P23)
    'market_regime': 0.05,        # Real market regime (unchanged in P23)
    'sector_relative': 0.05,      # Stock vs sector (unchanged in P23)
    'enhanced_indicators': 0.024, # P23: was 0.04, -40% — MACD is the dominant component and is LAGGING (crossover happens after the move). RSI divergence handled separately in live_indicator_engine.
    'multi_timeframe': 0.03,      # Daily/weekly/monthly confluence (unchanged in P23)
    'volume_profile': 0.043,      # P23: was 0.03, +43% — Volume Profile (VWAP + OBV + Volume Nodes) is LEADING — reveals hidden accumulation
    'timing': 0.015,              # P23: was 0.02, -25% — trimmed to fund the +43% volume_profile boost (timing is the least critical weight)
}

# Decision Thresholds (OPTIMIZED based on REAL BACKTESTING + dynamic wiring July 2026)
# Backtest Results: Score>50 = 61.5% win rate!
# BUY signals = 68.4% win rate, +3.77% return
# July 2026: with sector_relative + real market regime now wired in, the score
# distribution shifted up for genuine leaders, so thresholds are eased slightly
# to surface quality BUY/ACCUMULATE signals that were previously buried under
# the all-killing spark filter (the "70% wait" problem).
#
# Task IMPROVEMENT-04-2026-10-06 (Rule 71): خفض STRONG_BUY من 80 → 78
# السبب: 97 توقع عندها score 78-79 حالياً بتتصنف BUY بدل STRONG_BUY
# الهدف: تنوع الإشارات + إثراء قائمة الـ Morning Bells
THRESHOLDS = {
    'STRONG_BUY': 78,
    'BUY': 65,
    'ACCUMULATE': 55,
    'HOLD_LOW': 45,
    'HOLD_HIGH': 55,
    'REDUCE': 35,
    'SELL': 20,
    'STRONG_SELL': 10,
}


# ============================================================================
# MAESTRO-UNIFY-015: 8-LAYER CONFLUENCE THRESHOLDS (chart_routes parity)
# ============================================================================
# الـ 8 layers (Macro + SMA50 + RSI + Volume + Bollinger + MACD + Candlestick +
# Fibonacci) بتجمع max ~135 pts (مش 100). العتبات الجديدة:
#   STRONG_BUY >= 80 | BUY >= 55 | HOLD >= 45 | SELL < 45
# دي parallels للـ THRESHOLDS dict (اللي هو للـ master_score 0-100).
# الـ confluence_score بنفس منطق chart_full_analysis في chart_routes.py.
CONFLUENCE_THRESHOLDS = {
    'STRONG_BUY': 80,   # دخول فائق الأمان
    'BUY': 55,          # فرصة شراء قوية (was 65)
    'HOLD': 45,         # محايد (was 35)
    'SELL': 45,         # إشارة سلبية (< 45)
}



# ============================================================================
# MAESTRO-UNIFY-015: 8-LAYER CONFLUENCE HELPERS (نسخة طبق الأصل من chart_routes)
# ============================================================================
# منعًا للـ circular import (chart_routes بستورد من analyzers)، ننسخ الـ helpers
# لـ master_analyzer.py مباشرة. الـ 4 helpers دول بنفس signatures بتوع chart_routes.

def _ema_seeded(values, period):
    """Exponential Moving Average (SMA-seeded) — standard for MACD.

    Returns array same length as `values`, with None for indices < period-1
    (before enough data to seed the SMA), then SMA at index period-1, then EMA
    onward.
    """
    n = len(values)
    if n < period:
        return [None] * n
    multiplier = 2.0 / (period + 1)
    ema = [None] * (period - 1)
    sma = sum(values[:period]) / period
    ema.append(sma)
    for i in range(period, n):
        ema_val = (values[i] - ema[-1]) * multiplier + ema[-1]
        ema.append(ema_val)
    return ema


def _calc_macd(closes, fast=12, slow=26, signal=9):
    """حساب MACD line + signal line + histogram as arrays.

    Mirrors chart_routes._calc_macd semantics (SMA-seeded EMA + signal EMA).
    Returns: (macd_line, signal_line, histogram) — each same length as closes.
    """
    n = len(closes)
    if n < slow + signal:
        return [None] * n, [None] * n, [None] * n
    ema_fast = _ema_seeded(closes, fast)
    ema_slow = _ema_seeded(closes, slow)
    macd_line = []
    for f, s in zip(ema_fast, ema_slow):
        if f is None or s is None:
            macd_line.append(None)
        else:
            macd_line.append(f - s)
    # Seed signal EMA with macd_line values (replace None with 0 for EMA calc)
    macd_for_signal = [v if v is not None else 0 for v in macd_line]
    signal_line_raw = _ema_seeded(macd_for_signal, signal)
    # Align: signal_line is None wherever macd_line is None.
    signal_line = []
    for m, s in zip(macd_line, signal_line_raw):
        if m is None or s is None:
            signal_line.append(None)
        else:
            signal_line.append(s)
    histogram = []
    for m, s in zip(macd_line, signal_line):
        if m is None or s is None:
            histogram.append(None)
        else:
            histogram.append(m - s)
    return macd_line, signal_line, histogram


def _detect_candlestick_patterns(ohlcv):
    """كشف أنماط الشموع اليابانية على آخر شمعتين.

    يُرجع قائمة من dicts: {name, name_ar, signal, strength}.
    signal: 'bullish' | 'bearish' | 'neutral'
    strength: 'weak' | 'medium' | 'strong'
    """
    patterns = []
    if len(ohlcv) < 2:
        return patterns
    last = ohlcv[-1]
    prev = ohlcv[-2]

    o, c = float(last.get('open', 0)), float(last.get('close', 0))
    h, l = float(last.get('high', 0)), float(last.get('low', 0))
    po, pc = float(prev.get('open', 0)), float(prev.get('close', 0))

    body = abs(c - o)
    range_ = h - l
    if range_ <= 0:
        return patterns

    lower_wick = min(o, c) - l
    upper_wick = h - max(o, c)

    # Doji (تردد)
    if body / range_ < 0.1:
        patterns.append({'name': 'Doji', 'name_ar': 'دوجي',
                         'signal': 'neutral', 'strength': 'weak'})

    # Hammer (مطرقة - إيجابي عند القاع)
    if body > 0 and lower_wick > 2 * body and upper_wick < body * 0.5:
        patterns.append({'name': 'Hammer', 'name_ar': 'مطرقة',
                         'signal': 'bullish', 'strength': 'medium'})

    # Shooting Star (نجم هابط - سلبي عند القمة)
    if body > 0 and upper_wick > 2 * body and lower_wick < body * 0.5:
        patterns.append({'name': 'Shooting Star', 'name_ar': 'نجم هابط',
                         'signal': 'bearish', 'strength': 'medium'})

    # Bullish Engulfing (ابتلاع صعودي)
    if po > 0 and pc < po and c > o:
        if c >= po and o <= pc:
            patterns.append({'name': 'Bullish Engulfing', 'name_ar': 'ابتلاع صعودي',
                             'signal': 'bullish', 'strength': 'strong'})

    # Bearish Engulfing (ابتلاع هبوطي)
    if po > 0 and pc > po and c < o:
        if o >= pc and c <= po:
            patterns.append({'name': 'Bearish Engulfing', 'name_ar': 'ابتلاع هبوطي',
                             'signal': 'bearish', 'strength': 'strong'})

    return patterns


def _calc_fibonacci_levels(closes, highs, lows, lookback=30):
    """حساب مستويات فيبوناتشي (0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%).

    يحدد آخر swing high/low خلال آخر `lookback` شمعة ثم يحسب المستويات بينهما.
    لو مفيش بيانات كافية → يرجع None.
    المستويات تُحسب نسبةً للاتجاه (up/down):
      - لو close[-1] > midpoint → uptrend: low=0%, high=100%
      - عكسه → downtrend: high=0%, low=100%
    """
    n = len(closes)
    if n < 5 or not highs or not lows:
        return None
    window = min(lookback, n)
    sub_highs = highs[-window:]
    sub_lows = lows[-window:]
    swing_high = max(sub_highs) if sub_highs else None
    swing_low = min(sub_lows) if sub_lows else None
    if swing_high is None or swing_low is None or swing_high <= swing_low:
        return None

    diff = swing_high - swing_low
    last_close = closes[-1]
    direction = 'up' if last_close >= (swing_high + swing_low) / 2.0 else 'down'

    fib_ratios = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
    levels = {}
    for r in fib_ratios:
        if direction == 'up':
            price = swing_high - diff * r
        else:
            price = swing_low + diff * r
        levels[f'{int(r * 1000) / 10}%'] = round(price, 4)
    levels['swing_high'] = round(swing_high, 4)
    levels['swing_low'] = round(swing_low, 4)
    levels['direction'] = direction
    levels['lookback_window'] = window
    return levels


@dataclass
class MasterAnalysis:
    """Complete analysis result."""
    ticker: str
    signal: str
    signal_ar: str
    confidence: float
    master_score: float
    
    # Components
    technical_score: float
    fundamental_score: float
    timing_score: float
    pattern_score: float
    market_regime_score: float
    
    # Liquidity
    liquidity_level: str
    is_tradeable: bool
    liquidity_warning: Optional[str]
    
    # Session
    session_phase: str
    
    # Risk Profile
    risk_profile: Optional[Dict]
    
    # Details
    technical_summary: str
    fundamental_summary: str
    
    # Timestamp
    timestamp: str
    
    # Volatility (with default - after all non-default fields)
    volatility_20d: float = 3.0
    
    # Market info (with defaults - must be at the end)
    market: str = ''
    name: str = ''
    
    # Dynamic regime & sector (wired July 2026)
    market_regime_ar: str = 'غير معروف'
    market_regime_strength: float = 0.0
    sector_relative_score: float = 50.0
    
    # Conviction scoring
    conviction_score: float = 0.0,
    conviction_level: str = '',
    conviction_level_ar: str = '',
    conviction_action: str = '',
    conviction_position_size: float = 0.0,
    conviction_narrative: str = '',
    
    # AI News Sentiment (keyword + Ollama)
    news_sentiment_score: float = 50.0,

    # ⚡ Screener Lists tags (data_engine.db / screener_lists) — وارد July 2026
    # يصنّف السهم اليوم: فرصة ذهبية (gold) أو فخ مضاربي (trap)
    screener_tags: Dict[str, Any] = field(default_factory=dict),
    
    # ⚡ Market Pulse (new — real-time propagation)
    pulse_regime: str = 'unknown'
    pulse_breadth: float = 0.5
    pulse_risk: str = 'medium'
    pulse_timestamp: str = ''

    # ── MAESTRO-UNIFY-015: 8-LAYER CONFLUENCE (chart_routes parity) ──
    # الـ score الكلي من 8 layers (max ~135 pts) — بنفس منطق chart_full_analysis.
    # الـ 3 layers الجديدة (MACD + Candlestick + Fibonacci) بيتضافوا للـ master
    # عشان الـ BackgroundAnalyzer والشارت يستخدموا نفس الـ scoring.
    macd_score: float = 0.0
    candlestick_score: float = 0.0
    fibonacci_score: float = 0.0
    smc_score: float = 0.0
    candlestick_patterns: list = field(default_factory=list)
    fibonacci_levels: dict = field(default_factory=dict)
    confluence_score: float = 0.0
    confluence_breakdown: dict = field(default_factory=dict)
    confluence_signal: str = ''
    # BRIEF-045: SMC zones + macro regime for frontend
    smc_zones: list = field(default_factory=list)
    macro_regime: str = 'NEUTRAL'
    ob_stop_method: str = ''
    # BRIEF-046: MTF + Position Sizing + POC
    mtf_tag: str = ''
    mtf_weekly_trend: str = 'NEUTRAL'
    suggested_position_size: float = 5.0
    cbe_news_veto: bool = False  # V39.2: Hard veto من أخبار البنك المركزي
    poc_price: float = 0.0
    poc_tag: str = ''
    # PHASE 8: Quant Engine metrics
    quant_z_score: float = 0.0
    quant_vsa_absorption: bool = False
    quant_ttm_squeeze: bool = False
    quant_score: int = 0
    # PHASE 11: V20 Ultimate Fusion Engine (LuxAlgo + BigBeluga + SMC)
    # fusion_metrics: dict فيه score, signal, fair_value, fair_premium, bigbeluga, risk
    # لو None → الـ Fusion Engine ما اشتغلش (insufficient data)
    fusion_metrics: Optional[Dict[str, Any]] = None

    # QUANT-OVERDRIVE-028: خوارزميات التفوق الكمي (Smart Money + Monte Carlo)
    # SMFI: -100% (بيع كامل) إلى +100% (شراء كامل). > 60% = حيتان بتجمع.
    # monte_carlo_prob: احتمالية وصول السعر للهدف خلال 5 أيام (0-100%).
    # quant_overdrive_notes: قائمة ملاحظات الـ log (SMFI + Monte Carlo + Blood Filter).
    smfi: float = 0.0
    smfi_label: str = ''
    monte_carlo_prob: float = 0.0
    monte_carlo_label: str = ''
    monte_carlo_horizon: int = 5
    quant_overdrive_notes: list = field(default_factory=list)

    # EXPERT-MEMORY-032: توصيات الخبراء تعدّل ثقة الآلة (تغيير طريقة التفكير)
    # expert_consensus: dict فيه {count, buy_count, sell_count, hold_count,
    #   consensus_action, agreed, conflicted, score_adjustment} أو None لو مفيش توصيات.
    # expert_count: عدد التوصيات النشطة للسهم في آخر 30 يوم.
    # expert_agreed: True لو الأغلبية وافقت إشارة الآلة.
    # expert_notes: ملاحظات عربية للواجهة (توافق/تعارض/مستويات أسعار الخبراء).
    expert_consensus: Optional[Dict[str, Any]] = None
    expert_count: int = 0
    expert_agreed: bool = False
    expert_notes: list = field(default_factory=list)

    def to_dict(self) -> Dict:
        """تحويل الـ dataclass لـ dict آمن للتخزين في DB / JSON.

        asdict() بيفشل لو فيه nested objects مش picklable (زي mappingproxy
        منfusion_metrics أو risk_profile). ده بيكسر الـ live_refresh وبيخلي
        الأسهم ما تتحدثش. الحل: try asdict الأول، ولو فشل، ابني الـ dict يدوياً.
        """
        # محاولة سريعة بـ asdict (الأسرع لو نفع)
        try:
            return asdict(self)
        except Exception:
            pass
        # fallback: بناء يدوي آمن — كل field نحوّله لـ primitive
        import dataclasses as _dc
        def _safe(v):
            try:
                if v is None or isinstance(v, (str, int, float, bool)):
                    return v
                if isinstance(v, list):
                    return [_safe(x) for x in v]
                if isinstance(v, dict):
                    return {str(k): _safe(val) for k, val in v.items()}
                if isinstance(v, tuple):
                    return [_safe(x) for x in v]
                # أي حاجة تانية (mappingproxy, custom objects) → str
                return str(v)
            except Exception:
                return str(v)
        out: Dict[str, Any] = {}
        for f in _dc.fields(self):
            try:
                out[f.name] = _safe(getattr(self, f.name))
            except Exception:
                out[f.name] = None
        return out


# ============================================================================
# Task IMPROVEMENT-05-2026-10-06 (Rule 71): WHO IS BUYING detector
# مصدر الإلهام: data/pine_scripts/EGX_Pro_Institutional_Engine_V60_2_Who_Is_Buying.pine (lines 670-760)
# الهدف: كشف نوع المُتداول (مؤسساتي vs أفراد) من 8 عوامل OHLCV
# الميزة دي مش موجودة في Python — بتضاف كـ canonical في master_analyzer.py (Rule 67)
# ============================================================================
def detect_who_is_buying(
    closes: List[float],
    volumes: List[float],
    highs: List[float],
    lows: List[float],
    opens: List[float] = None,
    lookback: int = 20,
    mfi_length: int = 14,
) -> Dict[str, Any]:
    """كشف نوع المُتداول المسيطر على السيولة (مؤسساتي / أفراد).

    المرجع: EGX_Pro Pine script (V60.2) lines 670-760.
    المنطق: TradingView OHLCV لا يحدد هوية المُتداول مباشرة، لكن نقدر نقدّرها
    من الحجم + الاستمرارية + الامتصاص + VWAP + MFI/CMF/OBV + delta proxy.

    Returns:
        {
            'institutional_buy_score': int (0-100),
            'institutional_sell_score': int (0-100),
            'retail_buy_score': int (0-100),
            'retail_sell_score': int (0-100),
            'who_state': str (عربي + إيموجي),
            'who_color': str (bull/bear/neutral/yellow/cyan/orange),
            'who_buying_score': int (institutional_buy - institutional_sell),
            'details': dict,
        }
    """
    result = {
        'institutional_buy_score': 0,
        'institutional_sell_score': 0,
        'retail_buy_score': 0,
        'retail_sell_score': 0,
        'who_state': '⚪ مختلط/غير واضح',
        'who_color': 'neutral',
        'who_buying_score': 0,
        'details': {},
    }

    if not closes or not volumes or len(closes) < max(lookback, mfi_length, 20):
        return result

    try:
        # 1) VWAP (volume-weighted average price) — rolling 20-period
        recent_vols = volumes[-lookback:]
        recent_closes = closes[-lookback:]
        vol_sum = sum(recent_vols)
        vwap = sum(c * v for c, v in zip(recent_closes, recent_vols)) / vol_sum if vol_sum > 0 else closes[-1]

        # 2) Volume ratio (current vs avg 20)
        avg_vol_20 = sum(volumes[-21:-1]) / 20 if len(volumes) >= 21 else (sum(volumes) / len(volumes) if volumes else 1)
        volume_ratio = volumes[-1] / avg_vol_20 if avg_vol_20 > 0 else 0

        # 3) Pressure score (CLV + body pressure) — proxy for delta direction
        # CLV = ((close - low) - (high - close)) / (high - low)
        flow_range = max(highs[-1] - lows[-1], 0.0001)
        clv = ((closes[-1] - lows[-1]) - (highs[-1] - closes[-1])) / flow_range
        clv = max(-1.0, min(1.0, clv))
        if opens and len(opens) > 0:
            body_pressure = (closes[-1] - opens[-1]) / flow_range
        else:
            body_pressure = clv  # fallback
        body_pressure = max(-1.0, min(1.0, body_pressure))
        pressure_score = clv * 0.65 + body_pressure * 0.35
        pressure_score = max(-1.0, min(1.0, pressure_score))

        # 4) Delta proxy + CVD (cumulative volume delta)
        delta = volumes[-1] * pressure_score
        # CVD = sum of recent deltas
        deltas = []
        recent_n = min(lookback, len(closes))
        for i in range(-recent_n, 0):
            try:
                if highs[i] and lows[i] and closes[i] and volumes[i] is not None:
                    fr = max(highs[i] - lows[i], 0.0001)
                    clv_i = ((closes[i] - lows[i]) - (highs[i] - closes[i])) / fr
                    clv_i = max(-1.0, min(1.0, clv_i))
                    if opens and len(opens) >= abs(i):
                        bp_i = (closes[i] - opens[i]) / fr
                    else:
                        bp_i = clv_i
                    bp_i = max(-1.0, min(1.0, bp_i))
                    ps_i = clv_i * 0.65 + bp_i * 0.35
                    deltas.append(volumes[i] * ps_i)
                else:
                    deltas.append(0)
            except Exception:
                deltas.append(0)
        cvd = sum(deltas)
        cvd_ema = sum(deltas[-lookback:]) / max(1, len(deltas[-lookback:]))
        delta_avg = sum(deltas) / max(1, len(deltas))

        # 5) MFI (Money Flow Index) — 14-period
        # MFI = 100 - (100 / (1 + money_flow_ratio))
        # money_flow_ratio = positive_money_flow / negative_money_flow
        if len(closes) >= mfi_length + 1 and len(volumes) >= mfi_length + 1 and len(highs) >= mfi_length + 1 and len(lows) >= mfi_length + 1:
            typical_prices = [(h + l + c) / 3 for h, l, c in zip(highs[-mfi_length-1:], lows[-mfi_length-1:], closes[-mfi_length-1:])]
            raw_money_flows = [tp * v for tp, v in zip(typical_prices[1:], volumes[-mfi_length:])]
            positive_flow = 0
            negative_flow = 0
            for i in range(len(raw_money_flows)):
                if typical_prices[i+1] > typical_prices[i]:
                    positive_flow += raw_money_flows[i]
                elif typical_prices[i+1] < typical_prices[i]:
                    negative_flow += raw_money_flows[i]
            if negative_flow > 0:
                mfi = 100 - (100 / (1 + positive_flow / negative_flow))
            else:
                mfi = 100 if positive_flow > 0 else 50
        else:
            mfi = 50

        # 6) CMF (Chaikin Money Flow) — 20-period
        # CMF = SMA(MFV, period) / SMA(Volume, period)
        # MFV = CLV × Volume
        if len(closes) >= lookback + 1:
            mfv_values = []
            for i in range(-lookback, 0):
                try:
                    fr_i = max(highs[i] - lows[i], 0.0001)
                    clv_i = ((closes[i] - lows[i]) - (highs[i] - closes[i])) / fr_i
                    mfv_i = clv_i * volumes[i]
                    mfv_values.append(mfv_i)
                except Exception:
                    mfv_values.append(0)
            cmf = sum(mfv_values) / max(1, len(mfv_values)) / max(avg_vol_20, 1) * 100
            # normalize CMF to [-1, 1] range (typical CMF is -0.3 to 0.3)
            cmf = max(-1.0, min(1.0, cmf / 100))
        else:
            cmf = 0

        # 7) OBV (On Balance Volume)
        obv_values = [0]
        for i in range(1, len(closes)):
            if closes[i] > closes[i-1]:
                obv_values.append(obv_values[-1] + volumes[i])
            elif closes[i] < closes[i-1]:
                obv_values.append(obv_values[-1] - volumes[i])
            else:
                obv_values.append(obv_values[-1])
        obv = obv_values[-1]
        obv_ema = sum(obv_values[-lookback:]) / max(1, len(obv_values[-lookback:]))

        # 8) Large order detection
        who_volume_threshold = 1.50  # 1.5× average
        who_large_buy = volume_ratio >= who_volume_threshold and delta > 0 and closes[-1] >= (opens[-1] if opens else closes[-1])
        who_large_sell = volume_ratio >= who_volume_threshold and delta < 0 and (closes[-1] <= (opens[-1] if opens else closes[-1]) if opens else True)
        who_vwap_bull = closes[-1] > vwap
        who_vwap_bear = closes[-1] < vwap
        who_cvd_bull = cvd > cvd_ema and delta_avg > 0
        who_cvd_bear = cvd < cvd_ema and delta_avg < 0
        who_volume_factor = min(volume_ratio / who_volume_threshold, 2.0) * 50.0

        # === INSTITUTIONAL BUY SCORE (8 factors) ===
        institutional_buy_score = 0
        institutional_buy_score += 25 if who_large_buy else 0
        institutional_buy_score += 15 if who_volume_factor >= 50 else 0
        institutional_buy_score += 10 if who_vwap_bull else 0
        institutional_buy_score += 15 if who_cvd_bull else 0
        institutional_buy_score += 10 if mfi >= 55 else 0
        institutional_buy_score += 10 if cmf > 0 else 0
        institutional_buy_score += 10 if obv > obv_ema else 0
        # 8th factor: absorption (close near low on red candle + volume surge)
        is_red = closes[-1] < (opens[-1] if opens else closes[-1])
        candle_range = highs[-1] - lows[-1]
        lower_wick = (min(closes[-1], opens[-1] if opens else closes[-1]) - lows[-1]) if opens else 0
        is_absorption = is_red and (lower_wick / max(candle_range, 0.0001)) > 0.50 and volume_ratio >= 1.30
        institutional_buy_score += 15 if is_absorption else 0
        institutional_buy_score = min(institutional_buy_score, 100)

        # === INSTITUTIONAL SELL SCORE (8 factors) ===
        institutional_sell_score = 0
        institutional_sell_score += 25 if who_large_sell else 0
        institutional_sell_score += 15 if who_volume_factor >= 50 else 0
        institutional_sell_score += 10 if who_vwap_bear else 0
        institutional_sell_score += 15 if who_cvd_bear else 0
        institutional_sell_score += 10 if mfi <= 45 else 0
        institutional_sell_score += 10 if cmf < 0 else 0
        institutional_sell_score += 10 if obv < obv_ema else 0
        # 8th factor: distribution (close near high on green candle + volume surge)
        upper_wick = (highs[-1] - max(closes[-1], opens[-1] if opens else closes[-1])) if opens else 0
        is_distribution = (not is_red) and (upper_wick / max(candle_range, 0.0001)) > 0.50 and volume_ratio >= 1.30
        institutional_sell_score += 15 if is_distribution else 0
        institutional_sell_score = min(institutional_sell_score, 100)

        # === RETAIL SCORE (inferred when institutional evidence is weak) ===
        retail_buy_score = 0
        retail_buy_score += 20 if delta > 0 else 0
        retail_buy_score += 20 if volume_ratio < who_volume_threshold else 0
        retail_buy_score += 10 if who_vwap_bull else 0
        retail_buy_score += 10 if mfi >= 55 else 0
        retail_buy_score += 10 if not who_large_buy else 0
        retail_buy_score += 10 if not who_cvd_bull else 0
        retail_buy_score = min(retail_buy_score, 100)

        retail_sell_score = 0
        retail_sell_score += 20 if delta < 0 else 0
        retail_sell_score += 20 if volume_ratio < who_volume_threshold else 0
        retail_sell_score += 10 if who_vwap_bear else 0
        retail_sell_score += 10 if mfi <= 45 else 0
        retail_sell_score += 10 if not who_large_sell else 0
        retail_sell_score += 10 if not who_cvd_bear else 0
        retail_sell_score = min(retail_sell_score, 100)

        who_buying_score = institutional_buy_score - institutional_sell_score

        # === Determine state (5 categories from Pine script) ===
        who_inst_threshold = 65
        who_retail_threshold = 65

        if institutional_buy_score >= who_inst_threshold and institutional_buy_score > institutional_sell_score + 10:
            who_state = '🏦 شراء مؤسساتي محتمل'
            who_color = 'bull'
        elif institutional_sell_score >= who_inst_threshold and institutional_sell_score > institutional_buy_score + 10:
            who_state = '🏦 بيع/تصريف مؤسساتي محتمل'
            who_color = 'bear'
        elif retail_buy_score >= who_retail_threshold and retail_buy_score > institutional_buy_score + 5:
            who_state = '👤 شراء أفراد محتمل'
            who_color = 'cyan'
        elif retail_sell_score >= who_retail_threshold and retail_sell_score > institutional_sell_score + 5:
            who_state = '👤 بيع أفراد محتمل'
            who_color = 'orange'
        elif who_buying_score >= 15:
            who_state = '🟢 ميل شرائي مختلط'
            who_color = 'bull'
        elif who_buying_score <= -15:
            who_state = '🔴 ميل بيعي مختلط'
            who_color = 'bear'
        else:
            who_state = '⚪ مختلط/غير واضح'
            who_color = 'neutral'

        result.update({
            'institutional_buy_score': institutional_buy_score,
            'institutional_sell_score': institutional_sell_score,
            'retail_buy_score': retail_buy_score,
            'retail_sell_score': retail_sell_score,
            'who_state': who_state,
            'who_color': who_color,
            'who_buying_score': who_buying_score,
            'details': {
                'vwap': round(vwap, 4),
                'volume_ratio': round(volume_ratio, 2),
                'mfi': round(mfi, 1),
                'cmf': round(cmf, 3),
                'obv': obv,
                'delta': round(delta, 0),
                'cvd': round(cvd, 0),
                'cvd_ema': round(cvd_ema, 0),
                'pressure_score': round(pressure_score, 3),
                'large_buy': who_large_buy,
                'large_sell': who_large_sell,
                'absorption': is_absorption,
                'distribution': is_distribution,
            },
        })

    except Exception:
        pass  # safe-by-design

    return result


# ============================================================================
# Task IMPROVEMENT-07-2026-10-06 (Rule 71): GENERATE ANALYSIS REASON
# مصدر الإلهام: data/pine_scripts/EGX_Pro_Institutional_Engine_V60_2_Who_Is_Buying.pine (lines 919-935)
# الهدف: توليد نص عربي يشرح سبب القرار — يُستخدم في:
#   - تقارير التليجرام (telegram_comprehensive_report.py)
#   - الواجهة (UI displays the reason)
#   - الـ predictions.db (column: analysis_reason)
# ============================================================================
def generate_analysis_reason(
    signal: str,
    score: float,
    entry: float,
    target: float,
    target_2: float = 0,
    target_3: float = 0,
    stop: float = 0,
    who_is_buying_state: str = '',
    radar_money_flow: str = '',
    radar_path: str = '',
    proofs: Dict[str, Any] = None,
    ticker: str = '',
) -> str:
    """توليد نص تحليلي بالعربي يشرح سبب القرار.

    المرجع: EGX_Pro Pine script (V60.2) lines 919-935.
    المنطق: ينشئ نص تراكمي يوضح:
      - السبب الرئيسي للقرار
      - الحالة المؤسساتية (WHO IS BUYING)
      - تدفق السيولة (Money Flow)
      - مسار الرادار (A_pre_surge / B_quiet_strong / etc)
      - الأهداف (target_1, target_2, target_3) + الستوب

    Returns:
        str: نص عربي متعدد الأسطر
    """
    if proofs is None:
        proofs = {}

    reason_lines = []

    # 1) Header
    if signal in ('STRONG_BUY', 'INSTITUTIONAL_BUY'):
        reason_lines.append(f"📊 أسباب التوصية القوية ({signal}):")
    elif signal == 'BUY':
        reason_lines.append("📊 أسباب التوصية:")
    elif signal == 'HOLD':
        reason_lines.append("📊 أسباب الترقب (HOLD):")
    elif signal == 'WAIT':
        reason_lines.append("⏸️ أسباب الانتظار (WAIT):")
    elif signal == 'SELL':
        reason_lines.append("🔴 أسباب البيع:")
    else:
        reason_lines.append(f"📊 أسباب القرار ({signal}):")

    # 2) Score
    reason_lines.append(f"• Score: {score:.0f}/100")

    # 3) WHO IS BUYING (الأهم)
    if who_is_buying_state:
        if 'مؤسساتي' in who_is_buying_state and 'شراء' in who_is_buying_state:
            reason_lines.append(f"• 🏦 {who_is_buying_state} — تأكيد قوي للشراء")
        elif 'مؤسساتي' in who_is_buying_state and 'بيع' in who_is_buying_state:
            reason_lines.append(f"• ⚠️ {who_is_buying_state} — خطر التصريف")
        elif 'أفراد' in who_is_buying_state:
            reason_lines.append(f"• 👤 {who_is_buying_state} — إشارة أضعف")
        else:
            reason_lines.append(f"• {who_is_buying_state}")

    # 4) Radar Money Flow
    if radar_money_flow:
        if '🔥 دخول' in radar_money_flow:
            reason_lines.append(f"• 💰 {radar_money_flow} — تأكيد سيولة")
        elif '🔥 خروج' in radar_money_flow:
            reason_lines.append(f"• ⚠️ {radar_money_flow} — خطر خروج سيولة")
        elif '🟢 سيولة داخلة' in radar_money_flow:
            reason_lines.append(f"• {radar_money_flow}")
        elif '🔴 سيولة خارجة' in radar_money_flow:
            reason_lines.append(f"• {radar_money_flow}")

    # 5) Radar Path (A_pre_surge / B_quiet_strong / etc)
    if radar_path:
        path_map = {
            'A_pre_surge': '🚀 تجميع مبكر (Pre-Surge)',
            'B_quiet_accumulation_strong': '🎯 تجميع قوي هادئ',
            'C_quiet_accumulation_weak': '🟡 تجميع ضعيف',
            'D_explosive_surge': '🔥 انفجار حجمي',
            'E_early_break': '⚡ اختراق مبكر',
        }
        path_label = path_map.get(radar_path, radar_path)
        reason_lines.append(f"• {path_label}")

    # 6) Proofs (الإثباتات الأخرى)
    proof_keys_to_show = [
        'trend_aligned', 'rsi_oversold', 'macd_bullish', 'ichimoku_bull',
        'sma_bullish', 'volume_surge', 'smc_bullish', 'dna_egx30_down_bypass',
        'safe_mode', 'v76_golden_retest',
    ]
    for key in proof_keys_to_show:
        val = proofs.get(key)
        if val:
            if isinstance(val, str):
                reason_lines.append(f"• {val}")
            elif val is True:
                key_ar = {
                    'trend_aligned': 'الاتجاه صاعد',
                    'rsi_oversold': 'RSI في تشبع بيعي',
                    'macd_bullish': 'MACD إيجابي',
                    'ichimoku_bull': 'فوق سحابة الإيشيموكو',
                    'sma_bullish': 'المتوسطات صاعدة',
                    'volume_surge': 'حجم مرتفع',
                    'smc_bullish': 'SMC إيجابي',
                    'dna_egx30_down_bypass': 'تجميع في سوق هابط',
                    'safe_mode': 'وضع آمن (حجم مخفّض)',
                    'v76_golden_retest': 'إعادة اختبار ذهبية V76',
                }.get(key, key)
                reason_lines.append(f"• ✅ {key_ar}")

    # 7) Risk/Reward + Targets
    if entry and target and stop and entry > 0 and (entry - stop) > 0:
        rr = (target - entry) / (entry - stop)
        reason_lines.append(f"• نقطة الدخول: {entry:.2f}")
        reason_lines.append(f"• الستوب: {stop:.2f} ({(stop-entry)/entry*100:+.1f}%)")
        reason_lines.append(f"• الهدف 1: {target:.2f} ({(target-entry)/entry*100:+.1f}%) — R:R={rr:.2f}")
        if target_2:
            reason_lines.append(f"• الهدف 2: {target_2:.2f} ({(target_2-entry)/entry*100:+.1f}%)")
        if target_3:
            reason_lines.append(f"• الهدف 3 (DNA projection): {target_3:.2f} ({(target_3-entry)/entry*100:+.1f}%)")

    return "\n".join(reason_lines)


def load_merged_history(ticker: str, db_path: str, limit: int = 100) -> List[Dict[str, Any]]:
    """
    تحميل تاريخ الأسعار المدمج (يومي + لحظي) لرمز معين.
    1. يقرأ التاريخ اليومي من price_history.db (مع فلترة وتطبيع المصادر)
    2. يقرأ لقطات intraday من intraday.db للرمز الجديد
    3. يدمجهم زمنياً مع تجميع الـ intraday لشموع يومية
    4. يعتمد على fallback من stocks.db لو البيانات غير متوفرة لليوم

    فلترة المصادر (DATA-FIX-001):
    - عند توفر بيانات `egksco` لسهم، تُعتبر هي المرجع الصحيح.
    - تُحسب نسبة التطبيع = (أول close من egksco) / (آخر close من egx_investment_migration).
    - لو النسبة بين 0.5 و 2.0: نُطبِّع الأسعار القديمة (نضرب OHLC في النسبة، نقسم الأحجام).
    - لو النسبة خارج هذا النطاق: نتجاهل البيانات القديمة لهذا السهم (غير موثوقة).
    - لو لا توجد بيانات egksco: نستخدم البيانات القديمة كما هي.
    """
    import sqlite3
    import os
    from datetime import datetime
    from pathlib import Path
    
    # 1. تحديد مسارات قواعد البيانات
    db_dir = Path(db_path).parent
    price_history_db = str(db_dir / 'price_history.db')
    intraday_db = str(db_dir / 'intraday.db')
    stocks_db = str(db_dir / 'stocks.db')
    
    # تطبيع الرمز: نشيل اللاحقات مثل .CA, .SR, .KW قبل الاستعلام
    ticker_upper = ticker.upper().strip()
    base_ticker = ticker_upper.split('.')[0] if '.' in ticker_upper else ticker_upper
    
    from utils.helpers import parse_volume
    daily_candles = []
    
    # 2. تحميل التاريخ اليومي من price_history.db (مع فلترة المصادر)
    if os.path.exists(price_history_db):
        try:
            conn = sqlite3.connect(price_history_db)
            cursor = conn.cursor()

            # 2أ. تحقق من توفر بيانات egksco لهذا السهم
            has_egksco = False
            egksco_rows = []
            migration_rows = []
            other_rows = []  # مصادر أخرى (مثل 'system')
            yahoo_clean_rows = []  # DATA-SURGERY: priority 1 (clean Yahoo history, max + unadjusted)
            has_source_col = False
            try:
                cursor.execute("PRAGMA table_info(price_history)")
                cols = [c[1] for c in cursor.fetchall()]
                has_source_col = 'source' in cols
            except Exception:
                has_source_col = False

            try:
                if has_source_col:
                    # جلب آخر `limit` سجل من egksco (المرجع الصحيح)
                    cursor.execute('''
                        SELECT date, open_price, high_price, low_price, close_price, volume
                        FROM price_history
                        WHERE ticker = ? AND source = 'egksco'
                        ORDER BY date DESC
                        LIMIT ?
                    ''', (base_ticker, limit))
                    egksco_rows = cursor.fetchall()

                    # جلب آخر `limit` سجل من egx_investment_migration (المرجع المشكوك فيه)
                    cursor.execute('''
                        SELECT date, open_price, high_price, low_price, close_price, volume
                        FROM price_history
                        WHERE ticker = ? AND source = 'egx_investment_migration'
                        ORDER BY date DESC
                        LIMIT ?
                    ''', (base_ticker, limit))
                    migration_rows = cursor.fetchall()

                    # جلب أي مصدر آخر (system، إلخ) — نعتبره موثوق
                    # DATA-SURGERY: استثنينا yahoo_clean من other_rows عشان نعالجه لوحده بالأولوية الأولى
                    cursor.execute('''
                        SELECT date, open_price, high_price, low_price, close_price, volume, source
                        FROM price_history
                        WHERE ticker = ? AND source NOT IN ('egksco', 'egx_investment_migration', 'yahoo_clean')
                        ORDER BY date DESC
                        LIMIT ?
                    ''', (base_ticker, limit))
                    other_rows = cursor.fetchall()
                    has_egksco = len(egksco_rows) > 0

                    # ── DATA-SURGERY: Priority 1 — yahoo_clean (تاريخ ياهو النظيف، period=max + auto_adjust=False) ──
                    cursor.execute('''
                        SELECT date, open_price, high_price, low_price, close_price, volume
                        FROM price_history
                        WHERE ticker = ? AND source = 'yahoo_clean'
                        ORDER BY date DESC
                        LIMIT ?
                    ''', (base_ticker, limit))
                    yahoo_clean_rows = cursor.fetchall()
                else:
                    # لا يوجد عمود source — سلوك قديم (نأخذ آخر limit سجل)
                    cursor.execute('''
                        SELECT date, open_price, high_price, low_price, close_price, volume
                        FROM price_history
                        WHERE ticker = ?
                        ORDER BY date DESC
                        LIMIT ?
                    ''', (base_ticker, limit))
                    other_rows = cursor.fetchall()
            except sqlite3.OperationalError:
                # محاولة استخدام أسماء الأعمدة البديلة
                try:
                    cursor.execute('''
                        SELECT date, open, high, low, close, volume
                        FROM price_history
                        WHERE ticker = ?
                        ORDER BY date DESC
                        LIMIT ?
                    ''', (base_ticker, limit))
                    other_rows = cursor.fetchall()
                except Exception:
                    pass
            conn.close()

            # 2ب. تطبيق فلترة وتطبيع المصادر
            # ── DATA-SURGERY: أولوية المصادر (yahoo_clean → egksco → migration) ──
            # 1) yahoo_clean (لو موجود) = تاريخ ياهو النظيف (5+ سنوات، RAW unadjusted)
            # 2) egksco = المرجع اللحظي (شمعة النهارده من TradingView/EGKSCO)
            # 3) migration = آخر ملجأ (بيانات قديمة مشكوك فيها)
            normalized_candles = []  # قائمة نهائية من السجلات المعالَجة

            if has_source_col and yahoo_clean_rows:
                # ✅ yahoo_clean متوفر — استخدمه كتاريخ رئيسي (5+ سنوات RAW)
                yahoo_clean_dates = set()
                for row in yahoo_clean_rows:
                    yahoo_clean_dates.add(row[0])
                    normalized_candles.append({
                        'date': row[0],
                        'open': float(row[1] if row[1] is not None else row[4] or 0),
                        'high': float(row[2] if row[2] is not None else row[4] or 0),
                        'low': float(row[3] if row[3] is not None else row[4] or 0),
                        'close': float(row[4] if row[4] is not None else 0),
                        'volume': parse_volume(row[5])
                    })

                # ضيف شمعة النهارده من egksco (لو أحدث من yahoo_clean) — سعر لحظي من TradingView/EGKSCO
                appended_live = 0
                if egksco_rows:
                    yc_sorted = sorted(yahoo_clean_rows, key=lambda r: r[0])
                    latest_yc_date = yc_sorted[-1][0] if yc_sorted else '1970-01-01'
                    for row in sorted(egksco_rows, key=lambda r: r[0]):
                        if row[0] > latest_yc_date and row[0] not in yahoo_clean_dates:
                            normalized_candles.append({
                                'date': row[0],
                                'open': float(row[1] if row[1] is not None else row[4] or 0),
                                'high': float(row[2] if row[2] is not None else row[4] or 0),
                                'low': float(row[3] if row[3] is not None else row[4] or 0),
                                'close': float(row[4] if row[4] is not None else 0),
                                'volume': parse_volume(row[5])
                            })
                            appended_live += 1

                print(f"[MergedHistory] ✅ {base_ticker}: using yahoo_clean ({len(yahoo_clean_rows)} rows) + {appended_live} live egksco candle(s) as primary history")

            elif has_source_col and has_egksco:
                # السيناريو الرئيسي: egksco متوفر → تطبيق التطبيع على migration
                # 1) نضيف سجلات egksco أولاً (المرجع)
                egksco_dates = set()
                for row in egksco_rows:
                    egksco_dates.add(row[0])
                    normalized_candles.append({
                        'date': row[0],
                        'open': float(row[1] if row[1] is not None else row[4] or 0),
                        'high': float(row[2] if row[2] is not None else row[4] or 0),
                        'low': float(row[3] if row[3] is not None else row[4] or 0),
                        'close': float(row[4] if row[4] is not None else 0),
                        'volume': parse_volume(row[5])
                    })

                # 2) حساب نسبة التطبيع
                # أول close من egksco (مرتبة تصاعدياً)
                egksco_sorted = sorted(egksco_rows, key=lambda r: r[0])
                first_egksco_close = float(egksco_sorted[0][4] or 0) if egksco_sorted else 0.0
                # آخر close من migration (مرتبة تصاعدياً)
                migration_sorted = sorted(migration_rows, key=lambda r: r[0])
                last_mig_close = float(migration_sorted[-1][4] or 0) if migration_sorted else 0.0

                if first_egksco_close > 0 and last_mig_close > 0:
                    ratio = first_egksco_close / last_mig_close
                else:
                    ratio = 1.0

                # 3) تطبيق التطبيع أو التجاهل
                if 0.5 <= ratio <= 2.0:
                    # تطبيع: ضرب الأسعار في النسبة، قسمة الأحجام على النسبة
                    added = 0
                    for row in migration_sorted:
                        # تجاهل التواريخ الموجودة في egksco (تفادي التداخل)
                        if row[0] in egksco_dates:
                            continue
                        o = float(row[1] if row[1] is not None else row[4] or 0)
                        h = float(row[2] if row[2] is not None else row[4] or 0)
                        l = float(row[3] if row[3] is not None else row[4] or 0)
                        c = float(row[4] if row[4] is not None else 0)
                        v = parse_volume(row[5])
                        normalized_candles.append({
                            'date': row[0],
                            'open': round(o * ratio, 4),
                            'high': round(h * ratio, 4),
                            'low': round(l * ratio, 4),
                            'close': round(c * ratio, 4),
                            'volume': int(v / ratio) if ratio > 0 else v
                        })
                        added += 1
                    print(f"[MergedHistory] ✅ {base_ticker}: normalized {added} migration records with ratio={ratio:.4f} (egksco_first={first_egksco_close:.2f}, mig_last={last_mig_close:.2f})")
                else:
                    # نسبة غير موثوقة — تجاهل بيانات migration لهذا السهم
                    print(f"[MergedHistory] ⚠️ {base_ticker}: discarded {len(migration_rows)} migration records (ratio={ratio:.4f} outside [0.5, 2.0]) — keeping only {len(egksco_rows)} egksco records")

                # 4) إضافة سجلات المصادر الأخرى (موثوقة)
                for row in other_rows:
                    # تخطي التواريخ المكررة
                    if row[0] in egksco_dates:
                        continue
                    normalized_candles.append({
                        'date': row[0],
                        'open': float(row[1] if row[1] is not None else row[4] or 0),
                        'high': float(row[2] if row[2] is not None else row[4] or 0),
                        'low': float(row[3] if row[3] is not None else row[4] or 0),
                        'close': float(row[4] if row[4] is not None else 0),
                        'volume': parse_volume(row[5])
                    })
            else:
                # لا يوجد egksco — استخدم كل المصادر كما هي (سلوك قديم)
                # لو عندنا migration فقط (سهم قديم بدون egksco) — نحذّر بس نستخدم
                if has_source_col and len(migration_rows) > 0 and not has_egksco:
                    print(f"[MergedHistory] ℹ️ {base_ticker}: no egksco data — using {len(migration_rows)} migration + {len(other_rows)} other records as-is (no normalization)")
                    # نضيف migration + other
                    for row in migration_rows:
                        normalized_candles.append({
                            'date': row[0],
                            'open': float(row[1] if row[1] is not None else row[4] or 0),
                            'high': float(row[2] if row[2] is not None else row[4] or 0),
                            'low': float(row[3] if row[3] is not None else row[4] or 0),
                            'close': float(row[4] if row[4] is not None else 0),
                            'volume': parse_volume(row[5])
                        })
                for row in other_rows:
                    # other_rows قد تحتوي على 6 أو 7 أعمدة (حسب has_source_col)
                    normalized_candles.append({
                        'date': row[0],
                        'open': float(row[1] if row[1] is not None else row[4] or 0),
                        'high': float(row[2] if row[2] is not None else row[4] or 0),
                        'low': float(row[3] if row[3] is not None else row[4] or 0),
                        'close': float(row[4] if row[4] is not None else 0),
                        'volume': parse_volume(row[5])
                    })

            # 2ج. ترتيب زمنياً + أخذ آخر `limit` سجل
            normalized_candles.sort(key=lambda x: x['date'])
            if len(normalized_candles) > limit:
                normalized_candles = normalized_candles[-limit:]

            daily_candles = normalized_candles
        except Exception as e:
            print(f"[MergedHistory] Error loading daily history for {ticker}: {e}")
            
    # ── FIX-1 (P0, Step 3): FALLBACK to data_engine.db.egksco_price_history ──
    # Per Rule 46 (DB-CLEANUP-WAVE-3, 2026-09-03): production price data moved
    # from price_history.db → data_engine.db.egksco_price_history. The legacy
    # query above may return EMPTY if price_history.db is missing or has been
    # migrated (the production DB no longer has price_history table at all).
    # This fallback reads the CANONICAL source directly.
    # Reference: engines/backtest_engine.py:1289-1308 (already correct).
    #
    # REAL DATA ONLY — no placeholder (per owner directive + Rule 24).
    # "مانستعملش بيانات وهمية خالص تحت اى ظرف" — empty `[]` is honest, fake is forbidden.
    if not daily_candles:
        egksco_db_path = str(db_dir / 'data_engine.db')
        if not os.path.exists(egksco_db_path):
            # Per owner directive: log honestly — NO placeholder data
            print(f"[MergedHistory] ⚠️ {base_ticker}: data_engine.db not found — "
                  f"returning empty (no placeholder per Rule 24)")
        else:
            egksco_conn = None
            try:
                egksco_conn = sqlite3.connect(egksco_db_path, timeout=3)
                egksco_cur = egksco_conn.cursor()
                # Detect column name (canonical schema: price_date; legacy scraper: date)
                egksco_cur.execute("PRAGMA table_info(egksco_price_history)")
                egksco_cols = [r[1] for r in egksco_cur.fetchall()]
                if not egksco_cols:
                    print(f"[MergedHistory] ⚠️ {base_ticker}: egksco_price_history table "
                          f"not found in data_engine.db — no data (no placeholder per Rule 24)")
                else:
                    _date_col = 'price_date' if 'price_date' in egksco_cols else 'date'
                    egksco_cur.execute(
                        f"SELECT {_date_col}, open_price, high_price, low_price, close_price, volume "
                        f"FROM egksco_price_history "
                        f"WHERE symbol = ? "
                        f"ORDER BY {_date_col} DESC LIMIT ?",
                        (base_ticker, limit),
                    )
                    egksco_rows = egksco_cur.fetchall()
                    if egksco_rows:
                        # Build candles oldest-first
                        for row in reversed(egksco_rows):
                            d, o, h, l, c, v = row
                            if c is None or c <= 0:
                                continue  # skip corrupt rows
                            daily_candles.append({
                                'date': d,
                                'open': float(o) if o is not None else float(c),
                                'high': float(h) if h is not None else float(c),
                                'low': float(l) if l is not None else float(c),
                                'close': float(c),
                                'volume': parse_volume(v),
                            })
                        print(f"[MergedHistory] ✅ {base_ticker}: loaded {len(daily_candles)} rows "
                              f"from data_engine.db.egksco_price_history (PRIMARY per Rule 46) — "
                              f"price_history.db was empty/missing")
                    else:
                        print(f"[MergedHistory] ⚠️ {base_ticker}: egksco_price_history has 0 rows "
                              f"for symbol={base_ticker} — no data (no placeholder per Rule 24)")
            except Exception as e:
                print(f"[MergedHistory] Error loading from data_engine.db for {ticker}: {e} "
                      f"— no placeholder per Rule 24")
            finally:
                if egksco_conn is not None:
                    try:
                        egksco_conn.close()
                    except Exception:
                        pass
    
    # 3. الحصول على آخر تاريخ متوفر في البيانات اليومية (مع استبعاد تاريخ اليوم إذا كان موجوداً لتفادي حجب البيانات اللحظية)
    today_str = datetime.now().strftime('%Y-%m-%d')
    today_daily_candle = None
    if daily_candles and daily_candles[-1]['date'] == today_str:
        today_daily_candle = daily_candles.pop()
        
    last_daily_date = daily_candles[-1]['date'] if daily_candles else '1970-01-01'
    
    # 4. كشف نوع الأصل لتحديد الجدول المناسب في intraday.db
    ticker_upper = ticker.upper().strip()
    base_ticker = ticker_upper.split('.')[0] if '.' in ticker_upper else ticker_upper
    
    asset_type = 'stock'
    if os.path.exists(intraday_db):
        try:
            conn = sqlite3.connect(intraday_db)
            c = conn.cursor()
            
            # فحص جداول الأسهم أولاً
            c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='stock_intraday'")
            if c.fetchone()[0] > 0:
                c.execute("SELECT COUNT(*) FROM stock_intraday WHERE ticker = ?", (base_ticker,))
                if c.fetchone()[0] > 0:
                    asset_type = 'stock'
                else:
                    # فحص العملات الرقمية
                    c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='crypto_intraday'")
                    if c.fetchone()[0] > 0:
                        c.execute("SELECT COUNT(*) FROM crypto_intraday WHERE symbol = ?", (ticker_upper,))
                        if c.fetchone()[0] > 0:
                            asset_type = 'crypto'
                        else:
                            # فحص السلع
                            c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='commodity_intraday'")
                            if c.fetchone()[0] > 0:
                                c.execute("SELECT COUNT(*) FROM commodity_intraday WHERE symbol = ?", (ticker_upper,))
                                if c.fetchone()[0] > 0:
                                    asset_type = 'commodity'
            conn.close()
        except Exception as e:
            print(f"[MergedHistory] Error querying intraday tables: {e}")
            
    # كشف تلقائي بالاسم كبديل احتياطي
    if asset_type == 'stock':
        crypto_set = {'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX', 'MATIC', 'LINK', 'TON', 'LTC', 'BCH', 'NEAR'}
        comm_set = {'GOLD', 'SILVER', 'OIL', 'WTI', 'BRENT', 'EUR_USD', 'GBP_USD', 'USD_JPY'}
        if base_ticker in crypto_set or 'BITCOIN' in ticker_upper or 'ETHEREUM' in ticker_upper:
            asset_type = 'crypto'
        elif base_ticker in comm_set or base_ticker.startswith('GOLD_') or base_ticker.startswith('SILVER_'):
            asset_type = 'commodity'

    # 5. جلب بيانات intraday الأحدث من تاريخ آخر شمعة يومية
    intraday_candles = []
    if os.path.exists(intraday_db):
        try:
            conn = sqlite3.connect(intraday_db)
            c = conn.cursor()
            
            rows = []
            if asset_type == 'stock':
                c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='stock_intraday'")
                if c.fetchone()[0] > 0:
                    c.execute('''
                        SELECT timestamp, price, volume
                        FROM stock_intraday
                        WHERE ticker = ? AND SUBSTR(timestamp, 1, 10) > ?
                        ORDER BY timestamp ASC
                    ''', (base_ticker, last_daily_date))
                    rows = c.fetchall()
            elif asset_type == 'crypto':
                c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='crypto_intraday'")
                if c.fetchone()[0] > 0:
                    c.execute('''
                        SELECT timestamp, price_usd, volume_24h
                        FROM crypto_intraday
                        WHERE symbol = ? AND SUBSTR(timestamp, 1, 10) > ?
                        ORDER BY timestamp ASC
                    ''', (ticker_upper, last_daily_date))
                    rows = c.fetchall()
            elif asset_type == 'commodity':
                c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='commodity_intraday'")
                if c.fetchone()[0] > 0:
                    c.execute('''
                        SELECT timestamp, price, 0
                        FROM commodity_intraday
                        WHERE symbol = ? AND SUBSTR(timestamp, 1, 10) > ?
                        ORDER BY timestamp ASC
                    ''', (ticker_upper, last_daily_date))
                    rows = c.fetchall()
            conn.close()
            
            # تجميع البيانات اللحظية حسب اليوم YYYY-MM-DD
            if rows:
                by_date = {}
                for row in rows:
                    dt_str = row[0][:10]
                    price = float(row[1] or 0)
                    vol = int(row[2] or 0)
                    if dt_str not in by_date:
                        by_date[dt_str] = []
                    by_date[dt_str].append((price, vol))
                
                for dt_str, prices_vols in sorted(by_date.items()):
                    prices = [pv[0] for pv in prices_vols if pv[0] > 0]
                    vols = [pv[1] for pv in prices_vols]
                    if prices:
                        intraday_candles.append({
                            'date': dt_str,
                            'open': prices[0],
                            'high': max(prices),
                            'low': min(prices),
                            'close': prices[-1],
                            'volume': vols[-1] if vols else 0
                        })
        except Exception as e:
            print(f"[MergedHistory] Error loading intraday data: {e}")
            
    # 6. بناء الشمعة اللحظية الحية (Live Developing Candle) لليوم الحالي من stocks.db
    live_stock_candle = None
    if os.path.exists(stocks_db):
        try:
            conn = sqlite3.connect(stocks_db)
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(stocks)")
            cols = [col[1] for col in cursor.fetchall()]
            
            if 'current_price' in cols:
                select_cols = ['current_price']
                for col in ['open_price', 'high_price', 'low_price', 'volume']:
                    if col in cols:
                        select_cols.append(col)
                
                # استخدام الرمز المطبّع (بدون لاحقة) للاستعلام من stocks
                cursor.execute(f'''
                    SELECT {", ".join(select_cols)}
                    FROM stocks
                    WHERE ticker = ?
                ''', (base_ticker,))
                stock_row = cursor.fetchone()
                
                if stock_row:
                    row_dict = dict(zip(select_cols, stock_row))
                    price = float(row_dict.get('current_price') or 0)
                    if price > 0:
                        op = float(row_dict.get('open_price') or price)
                        hi = float(row_dict.get('high_price') or price)
                        lo = float(row_dict.get('low_price') or price)
                        # OHLC integrity guard
                        hi = max(hi, op, price)
                        lo = min(lo if lo > 0 else price, op, price)
                        if lo < price * 0.4 and price > 10:
                            lo = min(op, price) * 0.98
                        if hi > price * 3.0 and price > 10:
                            hi = max(op, price) * 1.05
                        live_stock_candle = {
                            'date': today_str,
                            'open': op,
                            'high': hi,
                            'low': lo,
                            'close': price,
                            'volume': parse_volume(row_dict.get('volume'))
                        }
            conn.close()
        except Exception as e:
            print(f"[MergedHistory] Error getting fallback from stocks: {e}")

    # دمج مصادر شمعة اليوم للحصول على شمعة لحظية حية متكاملة
    today_candle = None
    today_intraday_candle = None
    for c in list(intraday_candles):
        if c['date'] == today_str:
            today_intraday_candle = c
            intraday_candles.remove(c)
            break

    if today_intraday_candle or live_stock_candle or today_daily_candle:
        # تحديد الإغلاق (السعر اللحظي الحالي الأحدث)
        close_val = 0.0
        if live_stock_candle:
            close_val = live_stock_candle['close']
        elif today_intraday_candle:
            close_val = today_intraday_candle['close']
        elif today_daily_candle:
            close_val = today_daily_candle['close']
            
        if close_val > 0:
            # تحديد الافتتاح
            open_val = close_val
            if live_stock_candle and live_stock_candle['open'] > 0:
                open_val = live_stock_candle['open']
            elif today_intraday_candle and today_intraday_candle['open'] > 0:
                open_val = today_intraday_candle['open']
            elif today_daily_candle and today_daily_candle['open'] > 0:
                open_val = today_daily_candle['open']
                
            # تحديد الأعلى والأسفل
            high_candidates = [close_val, open_val]
            low_candidates = [close_val, open_val]
            
            if live_stock_candle:
                high_candidates.append(live_stock_candle['high'])
                low_candidates.append(live_stock_candle['low'])
            if today_intraday_candle:
                high_candidates.append(today_intraday_candle['high'])
                low_candidates.append(today_intraday_candle['low'])
            if today_daily_candle:
                high_candidates.append(today_daily_candle['high'])
                low_candidates.append(today_daily_candle['low'])
                
            high_val = max([h for h in high_candidates if h > 0] or [close_val])
            low_val = min([l for l in low_candidates if l > 0] or [close_val])
            
            # تحديد الحجم
            vol_val = 0
            if live_stock_candle and live_stock_candle['volume'] > 0:
                vol_val = live_stock_candle['volume']
            elif today_intraday_candle and today_intraday_candle['volume'] > 0:
                vol_val = today_intraday_candle['volume']
            elif today_daily_candle and today_daily_candle['volume'] > 0:
                vol_val = today_daily_candle['volume']
                
            today_candle = {
                'date': today_str,
                'open': open_val,
                'high': high_val,
                'low': low_val,
                'close': close_val,
                'volume': vol_val
            }
                
    # 7. دمج وترتيب الشموع اليومية والتاريخية واللحظية
    merged = daily_candles + intraday_candles + ([today_candle] if today_candle else [])
    merged.sort(key=lambda x: x['date'])

    # 8. كشف وتصحيح انقسام السهم (Stock Split Normalization)
    # لو حصل قفزة حادة في السعر (>50% في يوم واحد) دي غالباً انقسام سهم
    # بنعدّل كل الأسعار القديمة عشان تتطابق مع المقياس الجديد
    if len(merged) >= 10:
        # نرجع من آخر شمعة لفوق عشان نلاقي أول قفزة
        current_price = merged[-1].get('close', 0)
        if current_price > 0:
            for i in range(len(merged) - 2, -1, -1):
                prev_close = merged[i].get('close', 0)
                next_close = merged[i + 1].get('close', 0)
                if prev_close <= 0 or next_close <= 0:
                    continue
                # نسبة التغير بين يومين متتاليين
                day_change = abs(next_close - prev_close) / prev_close
                if day_change > 0.5:  # قفزة أكتر من 50% = انقسام سهم
                    # نسبة التعديل: السعر الجديد / السعر القديم
                    ratio = next_close / prev_close
                    if 0.01 < ratio < 1.0:  # تصحيح منطقي (تقسيم)
                        # نعدّل كل الشموع من البداية لحد الشمعة دي
                        for j in range(i + 1):
                            for key in ('open', 'high', 'low', 'close'):
                                old_val = merged[j].get(key, 0)
                                if old_val > 0:
                                    merged[j][key] = round(old_val * ratio, 4)
                        print(f"[MergedHistory] ✅ Detected stock split at {merged[i+1].get('date')} — normalized {i+1} candles by ratio {ratio:.4f} (old scale → {current_price:.2f})")
                        break  # نكفي بتصحيح أول انقسام نلاقيه

    # Force merge: correct any fake "today" candle when stocks.db hasn't actually
    # been updated today. Use the truthful last_update date from stocks.db.
    if os.path.exists(stocks_db):
        try:
            conn = sqlite3.connect(stocks_db)
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(stocks)")
            cols = [col[1] for col in cursor.fetchall()]

            if 'current_price' in cols:
                select_cols = ['current_price']
                for col in ['open_price', 'high_price', 'low_price', 'volume', 'last_update']:
                    if col in cols:
                        select_cols.append(col)

                cursor.execute(f'''
                    SELECT {", ".join(select_cols)}
                    FROM stocks
                    WHERE ticker = ?
                ''', (base_ticker,))
                stock_row = cursor.fetchone()

                if stock_row:
                    row_dict = dict(zip(select_cols, stock_row))
                    live_price = float(row_dict.get('current_price') or 0)
                    if live_price > 0:
                        last_update = row_dict.get('last_update', '') or ''
                        today = datetime.now().strftime('%Y-%m-%d')
                        candle_date = today
                        if last_update:
                            try:
                                update_dt = datetime.strptime(last_update[:10], '%Y-%m-%d')
                                if (datetime.now() - update_dt).days > 1:
                                    candle_date = update_dt.strftime('%Y-%m-%d')
                            except Exception:
                                pass

                        real_candle = {
                            'date': candle_date,
                            'open': float(row_dict.get('open_price') or live_price),
                            'high': float(row_dict.get('high_price') or live_price),
                            'low': float(row_dict.get('low_price') or live_price),
                            'close': live_price,
                            'volume': parse_volume(row_dict.get('volume'))
                        }

                        # Remove any fake today candle from the original logic.
                        today_str = datetime.now().strftime('%Y-%m-%d')
                        if merged and merged[-1]['date'] == today_str and today_str != candle_date:
                            merged.pop()

                        # Update existing candle for the same date, or append.
                        existing_idx = None
                        for idx in range(len(merged) - 1, -1, -1):
                            if merged[idx]['date'] == candle_date:
                                existing_idx = idx
                                break

                        if existing_idx is not None:
                            merged[existing_idx] = real_candle
                        else:
                            merged.append(real_candle)
            conn.close()
        except Exception as e:
            print(f"[MergedHistory] Error in force merge for {ticker}: {e}")

    return merged


class MasterAnalyzer:
    """
    المحلل الرئيسي - الدمج الموحد
    
    This is THE BRAIN that makes the final decision.
    
    Flow:
    1. Check Liquidity → If not tradeable, return EXCLUDED
    2. Analyze Session → Adjust confidence
    3. Technical Analysis → Weighted score
    4. Fundamental Analysis → Sector-relative score
    5. Pattern Confirmation → With volume
    6. Market Regime Filter → Adjust confidence
    7. Calculate Master Score → Weighted combination
    8. Generate Risk Profile → Position, Stop, Target
    
    Usage:
        analyzer = MasterAnalyzer(db_path)
        result = analyzer.analyze('COMI')
        print(f"Signal: {result.signal}")
        print(f"Score: {result.master_score}")
    """
    
    def __init__(self, db_path: str = None):
        # MAESTRO-UNIFY-015: db_path optional — default to PROJECT_ROOT/db/stocks.db
        # so callers (tests, sandbox scripts) can do MasterAnalyzer() without args.
        if db_path is None or db_path == '':
            db_path = str(PROJECT_ROOT / 'db' / 'stocks.db')
        self.db_path = db_path
        
        # Initialize sub-analyzers
        self.liquidity_filter = LiquidityFilter(db_path)
        self.session_analyzer = SessionTimingAnalyzer()
        self.technical_analyzer = TechnicalAnalyzerWeighted()
        # Use Enhanced Fundamental Analyzer (Phase 2)
        self.fundamental_analyzer = EnhancedFundamentalAnalyzer(db_path)
        self.fundamental_analyzer_legacy = FundamentalAnalyzerRelative()  # Fallback
        # FUNDAMENTAL-CATALYST-022: المحرك الأساسي الجديد (البوابة)
        # بيقرأ من data_engine.db (8 جداول) بدل stocks.db (أعمدة فاضية).
        # هو اللي بيقرر هل السهم يستاهل التحليل الفني ولا لأ.
        self.fundamental_engine = get_fundamental_engine()
        # Phase 3: AI Pattern Analyzer & Sentiment Analyzer
        self.ai_pattern_analyzer = AIPatternAnalyzer(db_path)
        self.sentiment_analyzer = SentimentAnalyzer(db_path)
        self.risk_manager = RiskManagerAdaptive()
        # Track 2 (July 2026): New enhanced engines
        self.enhanced_indicators = EnhancedIndicators()
        self.mtf_engine = MultiTimeframeEngine()
        self.volume_analyzer = VolumeProfileAnalyzer()
        # Track 3 (July 2026): Adaptive weights
        self.adaptive_weights_engine = AdaptiveWeightsEngine()
        # P24-ADAPTIVE-RR: cached SMC zones for the orchestrator's Surgical Stop.
        self._last_smc_ob_zones = []
        self._last_smc_fvg_zones = []
        self._last_smc_sweep_levels = []
        # Track 4 (July 2026): Prediction Optimizer (61.9% win rate in backtest)
        self.prediction_optimizer = PredictionOptimizer()
        # Dynamic Regime & Sector wiring (July 2026): the engines below already
        # existed but were NOT connected to the master score. We now wire them in.
        # Market regime is detected ONCE per analyzer instance (it's a market-wide
        # signal, not per-stock) and reused for every stock analyzed.
        self.regime_detector = RegimeDetector(db_path)
        self.market_regime_info = self._detect_market_regime_cached()
        # Sector-relative analyzer: compares each stock to its own sector.
        self.sector_analyzer = SectorRelativeAnalyzer(db_path)
        # MARKET-REALITY-SLAP-027: Explosive Scanner — كشف التجميع الخفي والزخم
        self.explosive_scanner = ExplosiveScanner(db_path)
        # DNA-WIRING (Axis A): Stock Adaptive Profiles cache.
        # الـ DNA بيقول للعقل هل السهم "حيّ" (alive) ولا "نائم" (dormant).
        # السهم الحيّ ياخد threshold_boost (سالب) + confidence_boost (موجب)
        # عشان يطلع BUY signals اللي كانت بتتدفن تحت الـ static thresholds.
        self._dna_cache: Dict[str, Dict] = {}
        self._dna_cache_ts = 0  # epoch — invalidate كل 5 دقايق

    # ─── DNA-WIRING (Axis A): Load stock DNA profile ──────────────────
    def _load_stock_dna(self, ticker: str) -> Dict:
        """يحمّل ملف السهم التكيفي (DNA) من stock_adaptive_profiles.

        الـ DNA بيقول:
          - is_alive: هل السهم "حيّ" (amplifier/volume_spike/momentum عالي)
          - constraints_loosened: هل نفك القيود (thresholds أدنى)
          - threshold_boost: كم نخصم من الـ thresholds (سالب)
          - confidence_boost: كم نزود على confidence (موجب)

        النتيجة متكاشة لمدة 5 دقايق عشان ما نقرأش DB في كل analyze call.
        Returns: dict (فاضي لو مفيش DNA للسهم)
        """
        import time as _time
        now = _time.time()
        # invalidate cache كل 5 دقايق (300s)
        if now - self._dna_cache_ts > 300:
            self._dna_cache.clear()
            self._dna_cache_ts = now

        ticker_upper = (ticker or '').upper().strip()
        if not ticker_upper:
            return {}

        if ticker_upper in self._dna_cache:
            return self._dna_cache[ticker_upper]

        dna = {}
        try:
            import sqlite3 as _sql
            conn = _sql.connect(f'file:{self.db_path}?mode=ro', uri=True, timeout=10)
            conn.row_factory = _sql.Row
            cur = conn.cursor()
            cur.execute(
                """SELECT ticker, is_alive, constraints_loosened, threshold_boost,
                          confidence_boost, amplifier_score, volume_spike_freq,
                          momentum_score, volatility_level, personality_type,
                          personality_type_ar
                   FROM stock_adaptive_profiles
                   WHERE ticker = ? LIMIT 1""",
                (ticker_upper,)
            )
            row = cur.fetchone()
            conn.close()
            if row:
                dna = dict(row)
        except Exception:
            # الجدول مش موجود أو خطأ → نرجّع فاضي (آمن)
            pass

        self._dna_cache[ticker_upper] = dna
        return dna

    def analyze(self, ticker: str, prices: List[float] = None, volumes: List[float] = None, market_pulse: dict = None, history: List[Dict] = None, disable_lessons: bool = False, **kwargs) -> MasterAnalysis:
        """
        Perform complete analysis for a stock.
        
        Args:
            ticker: Stock symbol
            prices: Price history (optional - will fetch from DB)
            volumes: Volume history (optional)
            market_pulse: Real-time market pulse dict (optional - propagated from market_scheduler)
            history: Full OHLCV history list-of-dicts (optional — MAESTRO-UNIFY-015).
                When provided, used directly to derive opens/highs/lows/closes/volumes
                so the 8-layer confluence (MACD + Candlestick + Fibonacci) has the
                raw OHLC it needs. Avoids the redundant DB call inside
                _get_full_price_data.
            
        Returns:
            MasterAnalysis: Complete analysis result
        """
        timestamp = datetime.now().isoformat()

        # ═══════════════════════════════════════════════════════════════════
        # SOURCE AUTHORITY CHECK (Task 26, Rule 66 — 2026-10-03)
        # Per owner directive: "البيانات النهائية تكون واحدة بس مش كذا مكان"
        # Verify the price data source is canonical before analysis.
        # ═══════════════════════════════════════════════════════════════════
        _source_warned = False
        try:
            from data.source_authority import get_canonical_source, is_source_banned
            _market = kwargs.get('market', stock_market if 'stock_market' in dir() else 'EGX')
            _canonical = get_canonical_source(_market)
            # Log which canonical source is expected for this market
            logger.debug(f"[SOURCE-AUTHORITY] {ticker}: market={_market}, canonical={_canonical}")
        except ImportError:
            pass  # source_authority module not available in sandbox
        except Exception as _sa_err:
            logger.debug(f"[SOURCE-AUTHORITY] {ticker}: check skipped ({_sa_err})")

        # ⚡ نبض السوق — لو موجود وحديث، نستخدمه
        effective_pulse = market_pulse
        if effective_pulse is None:
            # نحاول ناخده من الـ background_analyzer لو متاح
            try:
                from analyzers.background_analyzer import get_background_analyzer
                bg = get_background_analyzer()
                if bg and hasattr(bg, '_current_market_pulse') and bg._current_market_pulse:
                    effective_pulse = bg._current_market_pulse
            except Exception:
                pass
        
        # حساب الأوزان التكييفية بناءً على نبض السوق
        pulse_regime = effective_pulse.get('regime', 'unknown') if effective_pulse else 'unknown'
        pulse_breadth = effective_pulse.get('breadth', 0.5) if effective_pulse else 0.5
        pulse_risk = effective_pulse.get('risk_level', 'medium') if effective_pulse else 'medium'
        
        # Get stock market and name from database
        stock_market, stock_name = self._get_stock_market_and_name(ticker)

        # ⚡ Screener Lists tags — تصنيف السهم من قوائم TradingView (بعد الجلسة)
        screener = get_screener_tags(ticker, market=stock_market)
        
        # 1. LIQUIDITY CHECK (First Priority) — includes Blood Filter (حق النفو)
        liquidity_profile = self.liquidity_filter.analyze(ticker)

        if not liquidity_profile.is_tradeable:
            # QUANT-OVERDRIVE-028: فلتر الدماء (Blood Filter / حق النفو)
            # لو الرفض بسبب الدوران اليومي < 3M EGP → REJECTED_LIQUIDITY (سهم ميت)
            # لو بسبب سعر قرشي أو حجم صغير → EXCLUDED (عام)
            _is_blood_reject = is_blood_filter_rejected(liquidity_profile.avg_daily_turnover)
            # لو الـ warning صريح عن السيولة (3M EGP) → أكيد blood filter
            _warn = liquidity_profile.warning or ''
            if '3M EGP' in _warn or 'سيولة ضعيفة' in _warn or 'معدل الدوران' in _warn:
                _is_blood_reject = True
            if _is_blood_reject and 'قرش' not in _warn:
                _rej_signal = 'REJECTED_LIQUIDITY'
                _rej_signal_ar = (f'🩸 ابتعد — سهم ميت لا توجد سيولة '
                                  f'(الدوران {liquidity_profile.avg_daily_turnover:,.0f} جنيه < 3M). '
                                  f'الآلة تلعب فقط في مياه الحيتان')
                _rej_tech = 'مرفوض — فلتر الدماء (سيولة < 3M EGP/day)'
                _rej_fund = blood_filter_label(liquidity_profile.avg_daily_turnover)
            else:
                _rej_signal = 'EXCLUDED'
                _rej_signal_ar = 'مستبعد'
                _rej_tech = 'لا يوجد تحليل - سيولة ضعيفة'
                _rej_fund = 'لا يوجد تحليل - سيولة ضعيفة'

            return MasterAnalysis(
                ticker=ticker,
                signal=_rej_signal,
                signal_ar=_rej_signal_ar,
                confidence=0,
                master_score=0,
                market=stock_market,
                name=stock_name,
                technical_score=50,
                fundamental_score=50,
                timing_score=50,
                pattern_score=50,
                market_regime_score=50,
                liquidity_level=liquidity_profile.level.value,
                is_tradeable=False,
                liquidity_warning=liquidity_profile.warning,
                session_phase='N/A',
                risk_profile=None,
                technical_summary=_rej_tech,
                fundamental_summary=_rej_fund,
                timestamp=timestamp,
                volatility_20d=3.0,
                smc_score=0.0,
                pulse_regime=pulse_regime,
                pulse_breadth=pulse_breadth,
                pulse_risk=pulse_risk,
                pulse_timestamp=effective_pulse.get('timestamp', '') if effective_pulse else '',
            )

        # =====================================================================
        # FUNDAMENTAL-CATALYST-022: البوابة الأساسية (The Fundamental Gatekeeper)
        # ---------------------------------------------------------------------
        # قبل أي تحليل فني، بنفحص الأساسيات من data_engine.db:
        # - لو فيه بيانات والدرجة < 40 → السهم ضعيف (خسران/غالي/مديونيته عالية)
        #   → ارفضه فوراً (REJECTED_FUNDAMENTALS). الشارت مش مهم لو الشركة مريضة.
        # - لو مفيش بيانات → سيب الفني يحكم (الـ background_analyzer بيعمل
        #   blue-chip filter منفصل لرفض الأسهم اللي مفيهاش بيانات خالص).
        # - لو الدرجة >= 40 → كمّل للتحليل الفني.
        #
        # السبب: التحليل الفني بس بيهتز (Whipsaw) وبيطلع أسهم ميتة. الأساسيات
        # بتثبّت القرار وتمنع التخبط.
        # =====================================================================
        # =====================================================================
        # 🔥 MOMENTUM OVERRIDE (P14 — أغسطس 2026)
        # السوق المصري (EGX) بيتحكم فيه "الزخم اللحظي" (Pump) والسيولة المفاجئة.
        # بوابة الأساسيات بترفض أسهم زي EOUI / EZDK لما بتطير بحجم تداول عالي،
        # فالمنصة بتفوت فرص 10%-20% في يوم. هنا بنعمل Check قبل الرفض:
        #   لو volume_ratio >= 2.0 (ضعف المتوسط)
        #   و change_today >= 4% (السهم طالع 4%+)
        #   و price > SMA20 (فوق المتوسط المتحرك)
        # → تجاهل بوابة الأساسيات تماماً، وادّي درجة 70 (BUY) بعدين.
        # =====================================================================
        _momentum_override = False
        _momentum_override_notes = []
        try:
            _fund_verdict = self.fundamental_engine.get_fundamental_breakdown(ticker)
            if _fund_verdict.has_data and not _fund_verdict.is_healthy:
                # ── فحص الزخم اللحظي قبل الرفض ──
                _mom_prices, _mom_highs, _mom_lows, _mom_volumes = self._get_full_price_data(ticker)
                if _mom_prices and len(_mom_prices) >= 20 and _mom_volumes and len(_mom_volumes) >= 20:
                    try:
                        _mom_cur = float(_mom_prices[-1] or 0)
                        _mom_prev = float(_mom_prices[-2] or _mom_prices[-1] or 0)
                        _mom_sma20 = sum(float(p or 0) for p in _mom_prices[-20:]) / 20.0
                        _avg_vol_20 = sum(float(v or 0) for v in _mom_volumes[-20:]) / 20.0
                        _today_vol = float(_mom_volumes[-1] or 0)
                        _vol_ratio = (_today_vol / _avg_vol_20) if _avg_vol_20 > 0 else 1.0
                        _change_today = ((_mom_cur - _mom_prev) / _mom_prev * 100) if _mom_prev > 0 else 0.0

                        # ── P24-CONDITIONAL-FUNDAMENTAL-GATE (Aug 2026) ──
                        # بوابة الأساسيات بقت "Conditional": السهم اللي درجته الأساسية
                        # < 40 مش بيترفض تلقائياً لو عنده زخم قوي + سيولة طارئة + بنية
                        # SMC صعودية. ده بيمثّل واقع السوق المصري (pumps بحجم عالي).
                        #
                        # شرط الـ override الـ P14 الأصلي (للتوافق الخلفي):
                        #   vol_ratio >= 2.0 و change_today >= 4% و price > SMA20
                        # شرط بديل جديد (P24 — أكثر دقة):
                        #   momentum_score > 75 و volume_spike > 2.0 و smc_bullish = True
                        _mom_p14_pass = (_vol_ratio >= 2.0 and _change_today >= 4.0 and _mom_cur > _mom_sma20)

                        # momentum_score proxy (0-100): مزيج من volume_spike + change + trend
                        _mom_score = min(100.0, 30.0 + (_vol_ratio * 12.0) + (max(0.0, _change_today) * 3.0)
                                         + (15.0 if _mom_cur > _mom_sma20 else 0.0))

                        # smc_bullish proxy: بنية SMC صعودية = السعر فوق آخر swing low
                        # وبيصنع higher-low (ارتداد من قاع سابق). ده proxy سريع للـ OB.
                        _smc_bullish = False
                        try:
                            _lows_recent = [float(x or 0) for x in _mom_lows[-15:]] if _mom_lows else []
                            _lows_recent = [x for x in _lows_recent if x > 0]
                            if len(_lows_recent) >= 6 and _mom_cur > 0:
                                _swing_low_1 = min(_lows_recent[-5:])   # أحدث قاع
                                _swing_low_2 = min(_lows_recent[-10:-5]) # القاع اللي قبله
                                # bullish structure: current > آخر swing low، وآخر swing low > القاع السابق (higher low)
                                _smc_bullish = (_mom_cur > _swing_low_1 * 1.005) and (_swing_low_1 >= _swing_low_2 * 0.995)
                        except Exception:
                            _smc_bullish = False

                        # شرط P24 البديل: momentum قوي + volume spike + smc bullish
                        _mom_p24_pass = (_mom_score > 75.0 and _vol_ratio > 2.0 and _smc_bullish)

                        if _mom_p14_pass or _mom_p24_pass:
                            _momentum_override = True
                            _override_reason = 'P14-vol-change' if _mom_p14_pass else 'P24-momentum-smc'
                            _momentum_override_notes.append(
                                f'🔥 زخم لحظي - تجاوز أساسي [{_override_reason}] '
                                f'(vol_ratio={_vol_ratio:.1f}x, change={_change_today:+.1f}%, '
                                f'mom_score={_mom_score:.0f}, smc_bullish={_smc_bullish})'
                            )
                            print(f"[MasterAnalyzer] 🚀 MOMENTUM OVERRIDE ({_override_reason}) for {ticker}: "
                                  f"vol_ratio={_vol_ratio:.1f}x, change={_change_today:+.1f}%, "
                                  f"mom_score={_mom_score:.0f}, smc_bullish={_smc_bullish} — "
                                  f"bypassing fundamental gate (was: {_fund_verdict.rejection_reason})")
                    except Exception as _mom_err:
                        print(f"[MasterAnalyzer] Momentum check error for {ticker}: {_mom_err}")

                # =================================================================
                # 🛑 PUMP & DUMP GUARD (P15 — أغسطس 2026)
                # -----------------------------------------------------------------
                # سياج حماية: الـ Momentum Override الجريء ممكن يخلّي المنصة تلتقط
                # أسهم "تربية دجاج" (Pump & Dump) — سهم كان ميت وثابت أيام، وفجأة
                # طفر +4% بحجم. مع تأخير 5 دقايق، العميل بيشتري في القمة ويتقفش
                # عليه الوقف. القاعدة:
                #   لو الـ Override اشتغل، نفحص أحجام الـ 3 أيام اللي قبل اليوم.
                #   لو متوسطها < 100K → السهم كان "ميت" → ارفض الـ Override وخلّي
                #   البوابة الأساسية تقرر. الـ Override يشتغل بس لو السهم أصلاً
                #   كان بيتداول بشكل طبيعي (Volume > 100K) في الأيام اللي فاتت.
                # =================================================================
                if _momentum_override and _mom_volumes and len(_mom_volumes) >= 4:
                    try:
                        _prev_3_vols = [float(v or 0) for v in _mom_volumes[-4:-1]]
                        _avg_prev_3_vol = sum(_prev_3_vols) / 3.0
                        # كمان نتحقق إن السعر كان "ثابت" في الـ 3 أيام السابقة
                        _prev_3_prices = [float(p or 0) for p in _mom_prices[-4:-1]]
                        _max_abs_daily_change_prev3 = 0.0
                        for _pi in range(1, len(_prev_3_prices)):
                            if _prev_3_prices[_pi - 1] > 0:
                                _dc = abs((_prev_3_prices[_pi] - _prev_3_prices[_pi - 1])
                                          / _prev_3_prices[_pi - 1] * 100)
                                if _dc > _max_abs_daily_change_prev3:
                                    _max_abs_daily_change_prev3 = _dc
                        # شرط الرفض: حجم ميت (< 100K) في الـ 3 أيام السابقة
                        # (سهم ميت فجأة طفر = تربية دجاج)
                        if _avg_prev_3_vol < 100000:
                            _momentum_override = False
                            _momentum_override_notes = [
                                f'🛑 Pump & Dump Guard: السهم كان ميت (avg vol 3d='
                                f'{_avg_prev_3_vol:,.0f} < 100K، max change='
                                f'{_max_abs_daily_change_prev3:.1f}%) ثم طفر — '
                                f'اترفض التجاوز، البوابة الأساسية تقرر'
                            ]
                            print(f"[MasterAnalyzer] 🛑 PUMP & DUMP GUARD tripped for {ticker}: "
                                  f"avg_3d_vol={_avg_prev_3_vol:,.0f} < 100K, "
                                  f"max_daily_change={_max_abs_daily_change_prev3:.1f}% — "
                                  f"override REJECTED (pump&dump signature), fundamental gate decides")
                    except Exception as _pdg_err:
                        print(f"[MasterAnalyzer] Pump&Dump guard error for {ticker}: {_pdg_err}")

                if not _momentum_override:
                    # السهم ضعيف أساسياً ومفيهوش زخم → ارفضه فوراً
                    return MasterAnalysis(
                        ticker=ticker,
                        signal='REJECTED_FUNDAMENTALS',
                        signal_ar=f'ابتعد - أساسيات ضعيفة ({_fund_verdict.rejection_reason})',
                        confidence=0,
                        master_score=0,
                        market=stock_market,
                        name=stock_name,
                        technical_score=50,
                        fundamental_score=round(_fund_verdict.score, 2),
                        timing_score=50,
                        pattern_score=50,
                        market_regime_score=50,
                        liquidity_level=liquidity_profile.level.value,
                        is_tradeable=True,
                        liquidity_warning=None,
                        session_phase='N/A',
                        risk_profile=None,
                        technical_summary='مرفوض - الأساسيات ضعيفة',
                        fundamental_summary=f'{_fund_verdict.signal_ar} — {_fund_verdict.rejection_reason}',
                        timestamp=timestamp,
                        volatility_20d=3.0,
                        smc_score=0.0,
                        pulse_regime=pulse_regime,
                        pulse_breadth=pulse_breadth,
                        pulse_risk=pulse_risk,
                        pulse_timestamp=effective_pulse.get('timestamp', '') if effective_pulse else '',
                    )
        except Exception as _fe:
            print(f"[MasterAnalyzer] Fundamental gatekeeper error for {ticker}: {_fe}")
            # لو الـ gatekeeper فشل، سيب التحليل يكمّل (آمن — مش بنرفض بسبب خطأ)

        # Get price data if not provided
        # MAESTRO-UNIFY-015: prefer `history` (full OHLCV list-of-dicts) when
        # provided so we can compute MACD + Candlestick + Fibonacci with proper
        # opens/highs/lows. Falls back to _get_full_price_data (no opens) when
        # neither history nor prices is provided. In that fallback path, we
        # synthesize opens from the previous close (acceptable approximation
        # for daily candles).
        opens = []
        if history is not None and len(history) > 0:
            # Use provided history directly (caller already loaded it via
            # load_merged_history — saves a redundant DB hit).
            prices = [float(h.get('close', h.get('close_price', 0)) or 0) for h in history]
            highs = [float(h.get('high', h.get('high_price', 0)) or 0) for h in history]
            lows = [float(h.get('low', h.get('low_price', 0)) or 0) for h in history]
            # FIX (P20-Bug3, Aug 2026): Use _parse_volume_float instead of float()
            # to handle volume strings like '154.48\u202fK' from Arabic TradingView.
            # float('154.48\u202fK') crashes with ValueError, breaking the entire
            # analysis batch. This is the PRIMARY crash site for Bug 3.
            volumes = [_parse_volume_float(h.get('volume', 0)) for h in history]
            opens = [float(h.get('open', h.get('open_price', 0)) or 0) for h in history]
        elif prices is None:
            prices, highs, lows, volumes = self._get_full_price_data(ticker)
            # opens not returned by _get_full_price_data — synthesize from
            # previous close (open[i] = close[i-1]; open[0] = close[0]).
            if prices:
                opens = [prices[0]] + [prices[i] for i in range(len(prices) - 1)]
        else:
            highs = prices
            lows = prices
            # opens synthesized from previous close
            if prices:
                opens = [prices[0]] + [prices[i] for i in range(len(prices) - 1)]
            else:
                opens = []
        
        # 🔥 RELAXED: Allow analysis with limited data
        # If we have at least the current price, we can provide basic analysis
        if not prices or len(prices) == 0:
            return MasterAnalysis(
                ticker=ticker,
                signal='INSUFFICIENT_DATA',
                signal_ar='بيانات غير كافية',
                confidence=0,
                master_score=0,
                market=stock_market,
                name=stock_name,
                technical_score=50,
                fundamental_score=50,
                timing_score=50,
                pattern_score=50,
                market_regime_score=50,
                liquidity_level=liquidity_profile.level.value,
                is_tradeable=True,
                liquidity_warning=None,
                session_phase='N/A',
                risk_profile=None,
                technical_summary='لا توجد بيانات سعرية',
                fundamental_summary='لا يوجد تحليل',
                timestamp=timestamp,
                volatility_20d=3.0,
                smc_score=0.0,
                pulse_regime=pulse_regime,
                pulse_breadth=pulse_breadth,
                pulse_risk=pulse_risk,
                pulse_timestamp=effective_pulse.get('timestamp', '') if effective_pulse else '',
            )
        
        current_price = prices[-1]
        
        # 🔥 LIMITED DATA MODE: If we have less than 50 data points
        # Provide basic analysis with available data
        if len(prices) < 50:
            # Use available data for limited analysis
            # Still provide risk profile with correct price
            from analyzers.scoring_fix import calculate_real_target_stop
            
            # Get stock data for fundamental analysis
            stock_data = self._get_stock_data(ticker)
            
            # Calculate basic scores
            technical_score = 50  # Neutral
            fundamental_score = 50
            timing_score = 50
            pattern_score = 50
            market_regime_score = 50
            
            # Master score (LIMITED DATA path — no sentiment/enhanced/mtf/volume available)
            # FIX 1.1 (July 2026): was MASTER_WEIGHTS['pattern'] → KeyError.
            # Track 2 (July 2026): new engines not available with <50 prices,
            # so we use neutral 50 for their scores but keep their weights.
            master_score = (
                technical_score * MASTER_WEIGHTS['technical'] +
                fundamental_score * MASTER_WEIGHTS['fundamental'] +
                timing_score * MASTER_WEIGHTS['timing'] +
                pattern_score * MASTER_WEIGHTS['ai_pattern'] +
                50 * MASTER_WEIGHTS['sentiment'] +
                market_regime_score * MASTER_WEIGHTS['market_regime'] +
                50 * MASTER_WEIGHTS['enhanced_indicators'] +
                50 * MASTER_WEIGHTS['multi_timeframe'] +
                50 * MASTER_WEIGHTS['volume_profile']
            )
            
            # Apply liquidity multiplier
            liquidity_mult = self.liquidity_filter.get_liquidity_multiplier(liquidity_profile.level)
            master_score *= liquidity_mult
            
            signal = 'HOLD'  # Conservative signal for limited data
            signal_ar = 'احتفاظ'
            confidence = 30  # Low confidence
            
            # Calculate risk profile with correct price
            risk_params = calculate_real_target_stop(
                entry_price=current_price,
                score=master_score,
                support=None,
                resistance=None,
                volatility=3.0
            )
            
            risk_profile = {
                'entry_price': current_price,
                'target_price': risk_params['target_price'],
                'target_pct': risk_params['target_pct'],
                'stop_loss_price': risk_params['stop_loss'],
                'stop_pct': risk_params['stop_pct'],
                'risk_reward_ratio': risk_params['risk_reward'],
                'position_size_pct': 3.0,
                'max_shares': 0,
                'stop_type': 'LIMITED_DATA',
                'time_stop_days': 30,
                'volatility_adjustment': 0,
                'liquidity_adjustment': 0,
                'warnings': ['تحليل محدود - بيانات تاريخية غير كافية'],
                'is_valid_trade': True
            }

            # MAESTRO-UNIFY-015: حتى في الـ LIMITED_DATA path، نحسب الـ 8-layer
            # confluence score (RSI/Bollinger inline) عشان الـ BackgroundAnalyzer
            # يخزّن نفس الـ scoring اللي الشارت بيعرضه.
            _conf_ld = self._compute_8_layer_confluence(
                ticker=ticker,
                prices=prices, highs=highs, lows=lows,
                volumes=volumes, opens=opens,
                tech_indicators=None,  # not available in LIMITED_DATA path
                ohlcv=None,
            )

            return MasterAnalysis(
                ticker=ticker,
                signal=signal,
                signal_ar=signal_ar,
                confidence=confidence,
                master_score=round(master_score, 2),
                market=stock_market,
                name=stock_name,
                technical_score=technical_score,
                fundamental_score=fundamental_score,
                timing_score=timing_score,
                pattern_score=pattern_score,
                market_regime_score=market_regime_score,
                liquidity_level=liquidity_profile.level.value,
                is_tradeable=True,
                liquidity_warning=None,
                session_phase='N/A',
                risk_profile=risk_profile,
                technical_summary=f'تحليل محدود ({len(prices)} نقطة سعرية)',
                fundamental_summary='لا يوجد تحليل أساسي',
                timestamp=timestamp,
                volatility_20d=3.0,
                smc_score=0.0,
                pulse_regime=pulse_regime,
                pulse_breadth=pulse_breadth,
                pulse_risk=pulse_risk,
                pulse_timestamp=effective_pulse.get('timestamp', '') if effective_pulse else '',
                # MAESTRO-UNIFY-015: 8-layer confluence (computed inline above)
                macd_score=_conf_ld['macd_score'],
                candlestick_score=_conf_ld['candlestick_score'],
                fibonacci_score=_conf_ld['fibonacci_score'],
                candlestick_patterns=_conf_ld['candlestick_patterns'],
                fibonacci_levels=_conf_ld['fibonacci_levels'],
                confluence_score=_conf_ld['confluence_score'],
                confluence_breakdown=_conf_ld['confluence_breakdown'],
                confluence_signal=_conf_ld['confluence_signal'],
            )
        
        current_price = prices[-1]
        
        # CRITICAL FIX: Validate current_price is reasonable
        # If price > 10000, it's likely wrong (volume or market_cap read incorrectly)
        if current_price > 10000:
            print(f"[MasterAnalyzer] WARNING: Invalid price for {ticker}: {current_price}")
            # Get correct price from stocks table
            try:
                conn2 = sqlite3.connect(self.db_path)
                cursor2 = conn2.cursor()
                cursor2.execute('SELECT current_price FROM stocks WHERE ticker = ?', (ticker,))
                row = cursor2.fetchone()
                conn2.close()
                if row and row[0] and row[0] < 10000:
                    current_price = row[0]
                    print(f"[MasterAnalyzer] Corrected price for {ticker}: {current_price}")
            except:
                pass
        
        # 2. SESSION ANALYSIS
        session = self.session_analyzer.analyze()
        timing_score = session.confidence_adjustment * 100
        
        # 3. TECHNICAL ANALYSIS (Weighted)
        tech_indicators = self.technical_analyzer.analyze(prices, volumes)
        technical_score = tech_indicators.weighted_score
        
        # Adjust technical score based on session
        if session.current_phase == SessionPhase.OPENING:
            # Volume spikes in opening are not reliable
            technical_score *= 0.7
        elif session.current_phase == SessionPhase.MAIN:
            # Technical analysis most reliable in main session
            technical_score *= 1.0
        
        # 4. FUNDAMENTAL ANALYSIS (FUNDAMENTAL-CATALYST-022 — The New Engine)
        # -----------------------------------------------------------------
        # المحرك الجديد بيقرأ من data_engine.db (8 جداول: valuation,
        # profitability, income, balance_sheet, dividends, performance,
        # technical_analysis) بدل EnhancedFundamentalAnalyzer اللي كان
        # بيقرأ من stocks.db (أعمدة pe_ratio/roe فاضية لـ 99% من الأسهم).
        #
        # الـ gatekeeper فوق لقى فحص الأساسيات، هنا بنستخدم الدرجة للحساب.
        # لو مفيش بيانات → fundamental_score=50 (محايد) عشان مش بنعاقب السهم
        # على نقص البيانات (الـ background_analyzer بيعمل blue-chip filter).
        try:
            # نعيد استخدام الـ verdict اللي اتطبق في الـ gatekeeper (لو موجود)
            if '_fund_verdict' in dir() and _fund_verdict is not None:
                _fund_score_raw = _fund_verdict.score
            else:
                _fund_score_raw = self.fundamental_engine.get_fundamental_score(ticker)

            if _fund_score_raw > 0:
                # عندنا بيانات أساسية → استخدم الدرجة الحقيقية
                fundamental_score = float(_fund_score_raw)
            else:
                # مفيش بيانات → 0.0 (مش placeholder 50 — per owner directive + Rule 24)
                # matched canonical NO_DATA_SCORE = 0.0 in fundamental_engine.py:59
                # REAL DATA ONLY — no placeholder (per owner directive + Rule 24)
                fundamental_score = 0.0

            # بنبني fund_metrics وهمي عشان الـ _build_fundamental_summary يشتغل
            # (الكود القديم بيعتمد عليه في بناء الـ summary)
            fund_metrics = self.fundamental_engine.get_fundamental_breakdown(ticker)
        except Exception as e:
            print(f"[MasterAnalyzer] FundamentalEngine failed for {ticker}: {e} — fallback to Enhanced")
            # Fallback للـ EnhancedAnalyzer القديم (يقرأ من stocks.db)
            try:
                fund_metrics = self.fundamental_analyzer.analyze(ticker)
                fundamental_score = fund_metrics.weighted_score
                if hasattr(fund_metrics, 'confidence') and fund_metrics.confidence < 50:
                    fundamental_score = 50 + (fundamental_score - 50) * (fund_metrics.confidence / 100)
            except Exception as e2:
                print(f"[MasterAnalyzer] Enhanced fundamental also failed for {ticker}: {e2}")
                stock_data = self._get_stock_data(ticker)
                fund_metrics = self.fundamental_analyzer_legacy.analyze(stock_data, stock_data.get('sector'))
                fundamental_score = fund_metrics.weighted_score
        
        # 5. AI PATTERN ANALYSIS (Phase 3)
        # ========================================
        # REAL DATA ONLY — no placeholder (per owner directive + Rule 24).
        # If AI pattern analyzer fails → 0.0 (no contribution to weighted score),
        # NOT 50 (which would inflate the score with fake neutrality).
        ai_pattern_score = 0.0
        ai_pattern_adjustment = 0
        
        try:
            ai_pattern_result = self.ai_pattern_analyzer.analyze(
                ticker=ticker,
                prices=prices,
                volumes=volumes
            )
            ai_pattern_score = ai_pattern_result.overall_score
            ai_pattern_adjustment = ai_pattern_result.score_adjustment
            
            # Use AI-detected support/resistance if available and better
            if ai_pattern_result.support_levels and not tech_indicators.support_level:
                tech_indicators.support_level = ai_pattern_result.support_levels[0] if ai_pattern_result.support_levels else None
            if ai_pattern_result.resistance_levels and not tech_indicators.resistance_level:
                tech_indicators.resistance_level = ai_pattern_result.resistance_levels[0] if ai_pattern_result.resistance_levels else None
                
        except Exception as e:
            print(f"[MasterAnalyzer] AI Pattern analysis failed for {ticker}: {e}")
            # REAL DATA ONLY — no placeholder (per owner directive + Rule 24)
            ai_pattern_score = 0.0
            ai_pattern_adjustment = 0
        
        # 6. MARKET REGIME SCORE
        # FIX (July 2026): Use the REAL market regime detected once per analyzer
        # instance (EGX30 / top-liquid stocks via RegimeDetector) instead of a
        # per-stock pseudo-regime. The per-stock check below made every strong
        # stock look "bullish" and every weak stock "bearish" — cancelling out
        # across the market. The market-wide regime is what should shift the
        # confidence of ALL signals together.
        market_regime_score = float(self.market_regime_info.get('score', 50.0))
        market_regime_label = self.market_regime_info.get('regime_ar', 'غير معروف')
        market_regime_strength = float(self.market_regime_info.get('confidence', 0.0))
        
        # ========================================
        # 7. SENTIMENT ANALYSIS (moved before master score)
        # ========================================
        # FIX 1.2 (July 2026): sentiment was applied as a raw additive adjustment
        # (master_score += sentiment_adjustment) which could swing the score ±20
        # points and overpower the other 5 components. Now properly included in
        # the weighted sum with its declared 0.10 weight. MASTER_WEIGHTS now
        # sums to 1.0 (was 0.9 — sentiment weight was dead code).
        stock_data = self._get_stock_data(ticker)
        sector = stock_data.get('sector', 'DEFAULT')

        sentiment_score = 50
        sentiment_label = 'NEUTRAL'
        try:
            sentiment_result = self.sentiment_analyzer.analyze(
                ticker=ticker,
                prices=prices,
                volumes=volumes,
                sector=sector
            )
            sentiment_score = sentiment_result.overall_sentiment
            sentiment_label = sentiment_result.sentiment_label
        except Exception as e:
            print(f"[MasterAnalyzer] Sentiment analysis failed for {ticker}: {e}")

        # ========================================
        # 7a. SECTOR-RELATIVE SCORE (wired July 2026)
        # ========================================
        # Compares the stock to its OWN sector (P/E, ROE, momentum, rank).
        # This was previously dead code (only used in seasonality engine). Now it
        # is a real component of the master score so a cheap, high-ROE leader in
        # its sector is rewarded regardless of the absolute market regime.
        sector_relative_score = 50
        sector_relative_info = {}
        try:
            sec_result = self.sector_analyzer.analyze(ticker)
            sector_relative_score = sec_result.relative_score
            sector_relative_info = sec_result.to_dict()
        except Exception as e:
            print(f"[MasterAnalyzer] Sector-relative analysis failed for {ticker}: {e}")

        # ========================================
        # 7b. ENHANCED INDICATORS (Track 2 — July 2026)
        # ========================================
        # MACD + Bollinger + Stochastic + ADX + Williams %R
        enhanced_score = 50
        try:
            enhanced_result = self.enhanced_indicators.analyze(prices)
            enhanced_score = enhanced_result.composite_score
        except Exception as e:
            print(f"[MasterAnalyzer] Enhanced indicators failed for {ticker}: {e}")

        # ========================================
        # 7c. MULTI-TIMEFRAME CONFLUENCE (Track 2 — July 2026)
        # ========================================
        # Daily + Weekly + Monthly alignment
        mtf_score = 50
        try:
            mtf_result = self.mtf_engine.analyze(prices)
            mtf_score = mtf_result.confluence_score
        except Exception as e:
            print(f"[MasterAnalyzer] Multi-timeframe failed for {ticker}: {e}")

        # ========================================
        # 7d. VOLUME PROFILE (Track 2 — July 2026)
        # ========================================
        # VWAP + OBV + accumulation/distribution
        volume_score = 50
        try:
            vol_result = self.volume_analyzer.analyze(prices, volumes or [])
            volume_score = vol_result.score if hasattr(vol_result, 'score') else (vol_result.composite_score if hasattr(vol_result, 'composite_score') else 50)
        except Exception as e:
            print(f"[MasterAnalyzer] Volume profile failed for {ticker}: {e}")

        # ========================================
        # 8. CALCULATE MASTER SCORE (10-component ADAPTIVE weighted sum — Track 3 + July 2026)
        # ========================================
        # Track 3 (July 2026): Instead of static MASTER_WEIGHTS, compute adaptive
        # weights based on market regime + sector + volatility. This fixes the
        # baseline finding that "higher scores = worse performance" — the static
        # weights were wrong for certain regimes/sectors.
        volatility_pct = 0.0
        if len(prices) >= 20 and current_price > 0:
            recent = prices[-20:]
            volatility_pct = (max(recent) - min(recent)) / current_price * 100

        # FIX (July 2026): use the REAL market regime (EGX30 / top-liquid probe)
        # instead of the per-stock pseudo-regime from detect_regime(prices).
        # Map the detected regime to the bull/bear/range vocabulary the adaptive
        # weights engine expects.
        _reg = self.market_regime_info.get('regime', 'unknown')
        regime = {  # market_regime_detector -> adaptive_weights vocabulary
            'bull_trend': 'bull',
            'bear_trend': 'bear',
            'ranging': 'range',
        }.get(_reg, 'unknown')

        # حساب market breadth و sector momentum للـ adaptive weights
        #breadth = نسبة الأسهم الصاعدة / إجمالي الأسهم (1.0 = كلهم صاعدين)
        #sector_mom = أداء القطاع مقابل السوق في آخر 20 يوم (%)
        market_breadth = 0.5  # default — لو مفيش بيانات
        sector_momentum = 0.0  # default
        stock_rank = 5  # default — وسط القطاع
        try:
            # ⚡ لو فيه نبض سوق حقيقي من market_scheduler، نفضله على الـ cached regime
            if effective_pulse and effective_pulse.get('breadth') is not None:
                market_breadth = float(effective_pulse['breadth'])
            # جرب تجيب market breadth من الـ market_regime_info (fallback)
            elif self.market_regime_info.get('breadth'):
                market_breadth = float(self.market_regime_info['breadth'])
            # جرب تجيب sector momentum من الـ sector_relative_info
            if sector_relative_info and isinstance(sector_relative_info, dict):
                sector_momentum = float(sector_relative_info.get('vs_sector', 0))
                stock_rank = int(sector_relative_info.get('rank', 5))
        except Exception:
            pass

        adaptive_weights = self.adaptive_weights_engine.compute_weights(
            regime=regime,
            sector=sector,
            volatility_pct=volatility_pct,
            market_breadth=market_breadth,
            sector_momentum=sector_momentum,
            stock_rank=stock_rank,
        )
        w = adaptive_weights.weights

        # =====================================================================
        # P24-ADAPTIVE-ENGINE (Aug 2026): Dynamic & Adaptive weights overlay.
        # ---------------------------------------------------------------------
        # بدل ما نعتمد على أوزان ثابتة (شيت إكسل عقيم)، بنحسب أوزان ديناميكية
        # من 3 محاور: market_regime (strong_bull/bull/range/bear/crash) +
        # volatility_regime (low/normal/high/extreme) + liquidity_score (0..1).
        #
        # القواعد:
        #   - strong_bull/momentum: tech×1.8, smc×1.4, vol_profile×1.5, fund×0.6
        #   - bear/high_vol: fund×1.3, tech×0.7
        #   - liquidity منخفض → تقليل شامل (كاش)
        #
        # النتيجة بتتكمل فوق الـ sector-adaptive weights اللي اتحسبت فوق (نأخذ
        # المتوسط المرجّح) عشان نحافظ على ذكاء القطاع ونضيف ذكاء الـ regime/vol.
        # =====================================================================
        try:
            # بناءمدخل الـ regime الثرّ للدالة الجديدة:
            # لو market_breadth > 0.7 و regime == bull → strong_bull (موجة عريضة)
            _p24_regime = regime  # 'bull'/'bear'/'range'/'unknown'
            if _p24_regime == 'bull' and market_breadth > 0.70:
                _p24_regime = 'strong_bull'
            if _p24_regime == 'unknown':
                _p24_regime = 'range'

            # volatility_regime: percentile من الـ volatility_pct (0-100).
            # EGX يومي عادي ~2-4%، فوق 8% = high، فوق 15% = extreme.
            if volatility_pct >= 15.0:
                _p24_vol_regime = 'extreme'
            elif volatility_pct >= 8.0:
                _p24_vol_regime = 'high'
            elif volatility_pct >= 2.0:
                _p24_vol_regime = 'normal'
            else:
                _p24_vol_regime = 'low'

            # liquidity_score: من الـ liquidity_mult (0.0..1.1) — نطبّعه لـ 0..1.
            _p24_liq_score = max(0.0, min(1.0, float(getattr(liquidity_profile, 'liquidity_mult', 1.0))))

            # P25-LIVING-ENGINE: اقرأ ملف تعريف السهم (Stock DNA) من
            # stock_adaptive_profiles. ده اللي بيخلّي الأوزان تفهم "طبيعة"
            # السهم الخاص (تقلبه، رد فعله في الأزمات، شخصيته) بدل معادلات عامة.
            _p25_profile = None
            try:
                from analyzers.stock_dna_analyzer import get_stock_profile
                _p25_profile = get_stock_profile(ticker)
            except Exception:
                _p25_profile = None

            _p24_w = get_adaptive_weights(_p24_regime, _p24_vol_regime, _p24_liq_score,
                                          stock_profile=_p25_profile)

            # دمج: 60% من الـ regime/vol/liquidity-adaptive + 40% من الـ sector-adaptive.
            # كده بنحافظ على تخصص القطاع ونعطي وزن أكبر للسياق العام للسوق.
            for _wk in w:
                if _wk in _p24_w:
                    w[_wk] = (w[_wk] * 0.40) + (_p24_w[_wk] * 0.60)
            # أضف 'smc' لو مش موجود (الـ sector-adaptive BASE_WEIGHTS ما كانوش فيه)
            if 'smc' not in w and 'smc' in _p24_w:
                w['smc'] = _p24_w['smc']

            # إعادة التطبيع بعد الدمج
            _wsum = sum(w.values())
            if _wsum > 0:
                w = {k: v / _wsum for k, v in w.items()}
        except Exception as _p24_err:
            logger.debug(f"[P24] get_adaptive_weights overlay failed: {_p24_err}")

        # لو فيه توصيات أوزان من الـ learning engine، طبقها
        try:
            from jobs.learning_engine import LearningEngine
            le = LearningEngine()
            weight_recs = le.get_weight_recommendations()
            if weight_recs and regime in weight_recs:
                rec = weight_recs[regime]
                # زود أوزان العناصر اللي اتعلمت إنها مهمة في الـ regime ده
                for inc_key in rec.get('increase', []):
                    if inc_key in w:
                        w[inc_key] *= 1.15  # زود 15%
                # قلل أوزان العناصر اللي اتعلمت إنها مش مهمة
                for dec_key in rec.get('decrease', []):
                    if dec_key in w:
                        w[dec_key] *= 0.85  # قلل 15%
        except Exception:
            pass  # Learning engine مش متاح — مش مشكلة

        master_score = (
            technical_score * w.get('technical', 0.14) +
            fundamental_score * w.get('fundamental', 0.23) +
            timing_score * w.get('timing', 0.05) +
            ai_pattern_score * w.get('ai_pattern', 0.14) +
            sentiment_score * w.get('sentiment', 0.05) +
            market_regime_score * w.get('market_regime', 0.07) +
            sector_relative_score * w.get('sector_relative', 0.08) +
            enhanced_score * w.get('enhanced_indicators', 0.14) +
            mtf_score * w.get('multi_timeframe', 0.05) +
            volume_score * w.get('volume_profile', 0.05)
        )

        # ── SMC BLEND: ادمج SMC Score كـ أولوية قصوى (60% SMC Priority) ──
        # FIX-2 (Rule 24 + owner directive): was `smc_score_for_blend = 50.0` (placeholder
        # for missing SMC data). Now None — only blended into master_score if SMC
        # engine actually computed a score. If SMC computation fails or history is
        # too short, master_score stays unchanged (no fake neutral 50.0 blended in).
        smc_score_for_blend: Optional[float] = None
        _smc_ob_zones = []  # BRIEF-045: حفظ OB zones للـ stop loss الجراحي
        _smc_fvg_zones = []
        _smc_sweep_levels = []
        if history and len(history) >= 10:
            try:
                _blend_smc = calculate_smc_score(
                    ohlcv=history,
                    current_price=prices[-1] if prices else 0,
                    # P7-VOLUME-FIX: _safe_div بدل القسمة المباشرة (defensive ضد
                    # min(20,len)=0 أو sum=0 اللي الـ guard قد يفوته).
                    volume_ratio=_safe_div(volumes[-1], (sum(volumes[-20:]) / min(20, len(volumes))) if volumes else 0, default=1.0) if len(volumes) >= 5 and sum(volumes[-20:]) > 0 else 1.0,
                    rsi=float(getattr(tech_indicators, 'rsi', 50) or 50),
                    sma200=float(getattr(tech_indicators, 'sma200', 0) or 0),
                )
                # FIX-2: was `.get('score', 50)` placeholder fallback — now `.get('score')`
                # so missing 'score' key returns None (don't fake neutral 50).
                _smc_score_raw = _blend_smc.get('score')
                if _smc_score_raw is not None:
                    smc_score_for_blend = float(_smc_score_raw)
                # SMC HAS TOP PRIORITY — but the blend ratio is now ADAPTIVE (P24).
                # بدل ما يكون ثابت 60/40، نسبة الـ SMC بتتحسب من w['smc']:
                #   - base (range): smc≈0.25 → blend_ratio ≈ 0.55 (قريب من 60% القديم)
                #   - strong_bull: smc≈0.34 → blend_ratio ≈ 0.72 (SMC يقود الزخم)
                #   - bear:        smc≈0.21 → blend_ratio ≈ 0.50 (تخفيف SMC لصالح الأساسي)
                # clamp بين 0.40 و 0.75 عشان نحافظ على أولوية SMC كأداة LEADING.
                # FIX-2: only blend if smc_score_for_blend is not None (no fake 50.0).
                if smc_score_for_blend is not None:
                    _smc_blend_ratio = max(0.40, min(0.75, float(w.get('smc', 0.26)) * 2.2))
                    master_score = master_score * (1.0 - _smc_blend_ratio) + smc_score_for_blend * _smc_blend_ratio
                else:
                    logger.debug(f"[MasterAnalyzer] SMC blend skipped for {ticker}: no SMC score computed (no placeholder 50.0 per Rule 24)")

                # BRIEF-045: Pillar 1 - احفظ OB zones للـ Surgical Stop Loss
                _smc_ob_zones = _blend_smc.get('order_blocks', [])
                _smc_fvg_zones = _blend_smc.get('fvgs', [])
                _smc_sweep_levels = _blend_smc.get('sweeps', [])
                # P24-ADAPTIVE-RR: اعرض الـ OB zones على الـ instance عشان الـ
                # MaestroOrchestrator يقدر يقراها ويستخدمها للـ Surgical Stop.
                self._last_smc_ob_zones = _smc_ob_zones
                self._last_smc_fvg_zones = _smc_fvg_zones
                self._last_smc_sweep_levels = _smc_sweep_levels
            except Exception as e:
                logger.error(f"[MasterAnalyzer] SMC Blend error: {e}")
                self._last_smc_ob_zones = []
                self._last_smc_fvg_zones = []
                self._last_smc_sweep_levels = []

        # =====================================================================
        # 🔥 MOMENTUM OVERRIDE — Score Boost (P14)
        # لو الـ override اشتغل فوق (السهم عنده زخم لحظي رغم ضعف الأساسيات)،
        # هنرفع الدرجة لـ 70 على الأقل (BUY) ونسجل التاج في signal_ar / notes.
        # المنصة لازم تلتقط أسهم الـ Pump بدل ما تستبعدها.
        # =====================================================================
        if _momentum_override:
            if master_score < 70.0:
                master_score = 70.0
            print(f"[MasterAnalyzer] 🚀 {ticker}: MOMENTUM OVERRIDE active — "
                  f"master_score boosted to {master_score:.1f} (BUY floor)")

        # Phase 9: STALE PRICE VETO - لو الأسعار أقدم من 24 ساعة
        try:
            # HOTFIX-P25: المتغير الصحيح هو stock_data (معرّف عند السطر ~1739)
            # مش stock اللي كان بيوقع بـ "name 'stock' is not defined".
            _stock_data = stock_data if isinstance(stock_data, dict) else {}
            _last_update = _stock_data.get('last_update') or _stock_data.get('last_updated') or ''
            if _last_update:
                from datetime import datetime as _dt_veto
                _parsed_date = None
                for _fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d'):
                    try:
                        _parsed_date = _dt_veto.strptime(str(_last_update)[:19], _fmt)
                        break
                    except ValueError:
                        continue
                if _parsed_date:
                    _hours_old = (_dt_veto.now() - _parsed_date).total_seconds() / 3600
                    if _hours_old > 24:
                        logger.warning(f"[STALE-VETO] {ticker}: data is {_hours_old:.0f}h old → rejecting")
                        return MasterAnalysis(
                            ticker=ticker, signal='WAIT', signal_ar='انتظار - بيانات قديمة',
                            confidence=0, master_score=0,
                            market=stock_market, name=stock_name,
                            technical_score=0, fundamental_score=0,
                            timing_score=0, pattern_score=0,
                            market_regime_score=50,
                            liquidity_level='UNKNOWN',
                            is_tradeable=False,
                            liquidity_warning='البيانات أقدم من 24 ساعة - محرك البيانات متوقف',
                            session_phase='N/A',
                            risk_profile={'stop_loss_price': 0, 'stop_pct': 0, 'target_price': 0},
                            technical_summary='محرك البيانات متوقف',
                            fundamental_summary='لا يوجد تحليل - بيانات قديمة',
                            timestamp=timestamp,
                        )
        except Exception as _stale_err:
            logger.debug(f"[STALE-VETO] Error: {_stale_err}")

        # Apply liquidity multiplier
        liquidity_mult = self.liquidity_filter.get_liquidity_multiplier(liquidity_profile.level)
        master_score *= liquidity_mult

        # Clamp master score
        master_score = max(0, min(100, master_score))

        # ========================================
        # 8b. PREDICTION OPTIMIZER OVERRIDE (Track 4 — July 2026)
        # ========================================
        # The PredictionOptimizer uses mean-reversion + conviction filter + regime-adaptive
        # logic. In backtesting it achieved 61.9% win rate (vs 41.3% baseline).
        # If it produces a high-conviction signal, override the default signal.
        optimizer_signal = 'HOLD'
        optimizer_score = master_score
        optimizer_target = None
        optimizer_stop = None
        optimizer_rr = 0
        optimizer_conviction = []
        optimizer_regime = 'unknown'
        try:
            opt_result = self.prediction_optimizer.analyze(prices, highs, lows, volumes or [])
            optimizer_signal = opt_result.signal
            optimizer_score = opt_result.score
            optimizer_target = opt_result.target
            optimizer_stop = opt_result.stop
            optimizer_rr = opt_result.risk_reward
            optimizer_conviction = opt_result.conviction_factors
            optimizer_regime = opt_result.regime
            # FIX (يوليو 2026): بدل ما نستبدل الـ score بالكامل، نعمل BLEND
            # الـ optimizer بيجيب رأي تاني — لو اتفق مع الـ master score، نستخدمه
            # لو اختلف كتير، نفضل الـ master score (أعمق تحليلاً)
            if opt_result.signal in ('BUY', 'SELL'):
                score_diff = abs(opt_result.score - master_score)
                if score_diff < 15:
                    # اتفاق نسبي — نأخذ المتوسط مع ميل لصالح الـ optimizer
                    master_score = master_score * 0.4 + opt_result.score * 0.6
                else:
                    # اختلاف كبير — نفضل الـ master score (أعمق) بس نعدله شوية
                    master_score = master_score * 0.7 + opt_result.score * 0.3
        except Exception as e:
            print(f"[MasterAnalyzer] Prediction optimizer failed for {ticker}: {e}")

        # ⚡ Screener Lists Bonus / Veto — وارد July 2026
        # بونص للفرص الذهبية (most_active / unusual_volume / عوائد / أرباح)،
        # خصم للفخاخ (penny / top_gainers). كل القوائم مأخوذة من جدول
        # screener_lists في data_engine.db بعد جدولتها المسائية.
        # ══════════════════════════════════════════════════════════════
        # ⚡ محرك الترجيح الذكي للقوائم (Smart Screener Conviction Booster)
        # يوليو 2026: كل قائمة لها معادلة ترجيح مستقلة بدلاً من بونص موحّد
        # ══════════════════════════════════════════════════════════════
        screener_veto_buy = False
        screener_reversal_signal = False
        screener_gambler_easy_rr = False   # يُخفّف min_rr للمضارب من 1.3 → 1.2
        screener_boost_notes = []

        if screener.get('has_data') and screener.get('tags'):
            tags = screener['tags']
            rsi_val = getattr(tech_indicators, 'rsi', None) or 50.0

            for tag in tags:
                boost = SCREENER_BOOSTS.get(tag, 0.0)

                # ── 1. unusual_volume: أعلى بونص — زخم انفجاري غير اعتيادي
                if tag == 'unusual_volume':
                    master_score = min(100.0, master_score + boost)
                    screener_boost_notes.append(f"unusual_volume +{boost:.0f}pts (زخم انفجاري)")

                # ── 2. undervalued: بونص قيمي — صمام أمان المستثمر
                elif tag == 'undervalued':
                    master_score = min(100.0, master_score + boost)
                    screener_boost_notes.append(f"undervalued +{boost:.0f}pts (أقل من قيمته العادلة)")

                # ── 3. most_active: بونص سيولة + تخفيف min_rr للمضارب
                elif tag == 'most_active':
                    master_score = min(100.0, master_score + boost)
                    screener_gambler_easy_rr = True   # → gambler.min_rr = 1.2
                    screener_boost_notes.append(f"most_active +{boost:.0f}pts (سيولة مؤسسية — min_rr مضارب→1.2)")

                # ── 4. high_dividend + high_net_income: بونص مالي
                elif tag in ('high_dividend', 'high_net_income'):
                    master_score = min(100.0, master_score + boost)
                    label_ar = 'توزيعات عالية' if tag == 'high_dividend' else 'صافي دخل مرتفع'
                    screener_boost_notes.append(f"{tag} +{boost:.0f}pts ({label_ar})")

                # ── 5. top_losers + RSI < 35 + دعم قريب = ارتداد محتمل
                elif tag == 'top_losers':
                    support_val = getattr(tech_indicators, 'support_level', None)
                    dist_pct = (
                        abs(current_price - support_val) / current_price * 100
                        if support_val and support_val > 0 else 999.0
                    )
                    if rsi_val < TOP_LOSERS_REVERSAL_RSI and dist_pct < TOP_LOSERS_SUPPORT_PCT:
                        master_score = min(100.0, master_score + 5.0)
                        screener_reversal_signal = True
                        screener_boost_notes.append(
                            f"top_losers +5pts: RSI={rsi_val:.0f}<{TOP_LOSERS_REVERSAL_RSI}"
                            f" + دعم على بعد {dist_pct:.1f}% → ارتداد محتمل"
                        )
                    else:
                        screener_boost_notes.append(
                            f"top_losers: شروط الارتداد لم تكتمل "
                            f"(RSI={rsi_val:.0f}, dist_support={dist_pct:.1f}%)"
                        )

                # ── 6. top_gainers: خصم + فيتو RSI
                elif tag == 'top_gainers':
                    master_score = max(0.0, master_score + boost)   # boost = -6
                    screener_boost_notes.append(f"top_gainers {boost:.0f}pts (فخ القمة)")
                    if rsi_val >= TOP_GAINERS_VETO_RSI:
                        screener_veto_buy = True
                        screener_boost_notes.append(
                            f"top_gainers VETO: RSI={rsi_val:.0f}≥{TOP_GAINERS_VETO_RSI} → BUY ممنوع"
                        )

                # ── 7. penny: خصم أسهم قرشية
                elif tag == 'penny':
                    master_score = max(0.0, master_score + boost)   # boost = -8
                    screener_boost_notes.append(f"penny {boost:.0f}pts (أسهم قرشية)")

            if screener_boost_notes:
                print(f"[MasterAnalyzer] {ticker}: screener → {' | '.join(screener_boost_notes)}")


        # ========================================
        # DNA-WIRING (Axis A): تطبيق ملف السهم التكيفي (Stock DNA)
        # ========================================
        # الـ DNA بيقول للعقل: هل السهم ده "حيّ" (alive) ولا "نائم"؟
        # السهم الحيّ (amplifier عالي / volume_spike متكرر / momentum قوي)
        # يستاهل إننا نفك القيود (constraints) ونخفض الـ thresholds
        # عشان BUY signals اللي تستاهل تطلع برّه بدل ما تتدفن.
        #
        # الـ threshold_boost قيمة سالبة (مثلاً -8) → بنخفض بيها العتبات.
        # الـ confidence_boost قيمة موجبة (مثلاً +8) → بنزودها على الـ confidence.
        # ========================================
        dna_profile = self._load_stock_dna(ticker)
        dna_threshold_boost = 0.0
        dna_confidence_boost = 0.0
        dna_notes = []
        if dna_profile and dna_profile.get('is_alive'):
            dna_threshold_boost = float(dna_profile.get('threshold_boost') or 0)
            dna_confidence_boost = float(dna_profile.get('confidence_boost') or 0)
            _loosened = int(dna_profile.get('constraints_loosened') or 0)
            _amp = float(dna_profile.get('amplifier_score') or 0)
            _spike = float(dna_profile.get('volume_spike_freq') or 0)
            _mom = float(dna_profile.get('momentum_score') or 0)
            _pers = dna_profile.get('personality_type_ar') or ''
            if _loosened:
                dna_notes.append(
                    f"DNA ALIVE: amp={_amp:.2f} spike={_spike:.2f} mom={_mom:.2f} "
                    f"→ thr{dna_threshold_boost:+.0f} conf{dna_confidence_boost:+.0f}"
                    f" ({_pers})"
                )
            elif dna_threshold_boost != 0:
                dna_notes.append(
                    f"DNA boost: thr{dna_threshold_boost:+.0f} conf{dna_confidence_boost:+.0f}"
                )
            if dna_notes:
                print(f"[MasterAnalyzer] {ticker}: {' | '.join(dna_notes)}")

        # Determine signal — مع تعديل الـ thresholds بالـ DNA boost
        signal = self._get_signal_from_score(master_score, threshold_boost=dna_threshold_boost)

        # تطبيق الفيتو: لو السهم top_gainers ذروة شرائية، نحوّل BUY → HOLD
        if screener_veto_buy and signal in ('BUY', 'STRONG_BUY'):
            signal = 'HOLD'
            print(f"[MasterAnalyzer] {ticker}: signal downgraded BUY→HOLD (top_gainers veto)")
        
        # CRITICAL FIX: Calculate real target/stop using TechnicalTargetEngine
        # This engine integrates: swing-based S/R + candlestick patterns + ATR + 30d high/low
        from analyzers.technical_target_engine import TechnicalTargetEngine
        tt_engine = TechnicalTargetEngine(db_path=self.db_path)

        # Calculate ATR for candlestick-based stop/target
        from analyzers.core_scoring_engine import calc_atr
        highs_list = [h for h in tech_indicators.highs] if hasattr(tech_indicators, 'highs') and tech_indicators.highs else []
        lows_list = [l for l in tech_indicators.lows] if hasattr(tech_indicators, 'lows') and tech_indicators.lows else []
        atr_value = calc_atr(highs_list, lows_list, prices) if highs_list and lows_list else None
        atr_pct_value = (atr_value / current_price * 100) if atr_value and current_price > 0 else None

        # Calculate 30-day high/low for additional reference
        high_30d = max(prices[-30:]) if len(prices) >= 30 else (max(prices) if prices else None)
        low_30d = min(prices[-30:]) if len(prices) >= 30 else (min(prices) if prices else None)

        # Bollinger Band levels (for additional target/stop context)
        bb_lower = tech_indicators.bb_lower if hasattr(tech_indicators, 'bb_lower') else None
        bb_upper = tech_indicators.bb_upper if hasattr(tech_indicators, 'bb_upper') else None
        rsi_value = tech_indicators.rsi if hasattr(tech_indicators, 'rsi') else None

        # Use TechnicalTargetEngine — integrates S/R + candlestick + ATR + price history
        tt_result = tt_engine.calculate(
            ticker=ticker,
            entry_price=current_price,
            score=master_score,
            support=tech_indicators.support_level,
            resistance=tech_indicators.resistance_level,
            volatility=self._calculate_volatility(prices),
            atr=atr_value,
            atr_pct=atr_pct_value,
            high_30d=high_30d,
            low_30d=low_30d,
            rsi=rsi_value,
            bb_lower=bb_lower,
            bb_upper=bb_upper,
        )
        risk_params = {
            'target_price': tt_result.target_price,
            'target_pct': tt_result.target_pct,
            'stop_loss': tt_result.stop_price,
            'stop_pct': tt_result.stop_pct,
            'risk_reward': tt_result.risk_reward,
            'entry_price': tt_result.entry_price,
            'stop_method': tt_result.stop_method,
            'target_method': tt_result.target_method,
        }

        # If TechnicalTargetEngine didn't find good S/R, fall back to scoring_fix
        if tt_result.stop_method == 'VOLATILITY' and tt_result.target_method == 'VOLATILITY':
            from analyzers.scoring_fix import calculate_real_target_stop
            fallback = calculate_real_target_stop(
                entry_price=current_price,
                score=master_score,
                support=tech_indicators.support_level,
                resistance=tech_indicators.resistance_level,
                volatility=self._calculate_volatility(prices),
                atr=atr_value,
                atr_pct=atr_pct_value,
                high_30d=high_30d,
                low_30d=low_30d,
            )
            # Use whichever gives better R:R
            if fallback['risk_reward'] > risk_params['risk_reward']:
                risk_params = fallback

        # ═══════════════════════════════════════════════════════════════════
        # BRIEF-045 Pillar 1: OB-BASED SURGICAL STOP LOSS
        # ═══════════════════════════════════════════════════════════════════
        # وقف الخسارة الجراحي: بدل ATR عشوائي، استخدم ob_bottom تحت الـ Order Block
        # لو السعر كسر الـ OB = الحوت خرج = الصفقة فشلت
        _ob_stop_method = risk_params.get('stop_method', 'ATR')
        if _smc_ob_zones and current_price > 0:
            # ابحث عن أقرب Bullish OB تحت السعر الحالي (للصفقات الشرائية)
            _nearest_bullish_ob = None
            _min_distance = float('inf')
            for ob in _smc_ob_zones:
                if ob.get('type') == 'bullish_ob' and ob.get('bottom', 0) < current_price:
                    _dist = current_price - ob['bottom']
                    if _dist < _min_distance and _dist > 0:
                        _min_distance = _dist
                        _nearest_bullish_ob = ob

            if _nearest_bullish_ob:
                _ob_bottom = float(_nearest_bullish_ob['bottom'])
                # الـ stop loss أسفل الـ OB بـ 0.5% buffer
                _ob_stop = _ob_bottom * (1 - 0.005)
                _ob_stop_pct = round(abs(current_price - _ob_stop) / current_price * 100, 2)

                # استخدم OB stop لو أعقل من ATR stop (مش أبعد من 10%)
                if _ob_stop_pct <= 10 and _ob_stop < current_price:
                    risk_params['stop_loss'] = round(_ob_stop, 2)
                    risk_params['stop_pct'] = _ob_stop_pct
                    risk_params['stop_method'] = 'OB_BASED'
                    risk_params['ob_zone'] = {
                        'top': float(_nearest_bullish_ob['top']),
                        'bottom': _ob_bottom,
                        'type': 'bullish_ob'
                    }
                    # أعد حساب R/R
                    if risk_params.get('target_price') and risk_params['target_price'] > current_price:
                        _risk = current_price - _ob_stop
                        _reward = risk_params['target_price'] - current_price
                        if _risk > 0:
                            risk_params['risk_reward'] = round(_reward / _risk, 2)
                            # Rule 54: استخدم canonical compute_risk_reward
                            try:
                                from utils.risk_reward import compute_risk_reward
                                risk_params['risk_reward'] = compute_risk_reward(current_price, risk_params['target_price'], _ob_stop, fallback=risk_params['risk_reward'])
                            except Exception:
                                pass  # keep inline risk_reward computed above
                    logger.info(f"[BRIEF-045] {ticker}: OB-based SL = {_ob_stop:.2f} "
                                f"(ob_bottom={_ob_bottom:.2f}, pct={_ob_stop_pct}%)")

        # ═══════════════════════════════════════════════════════════════════
        # MARKET-REALITY-SLAP-027: 3 قوانين لصحوة الآلة من الأكاديمية للسوق
        # ═══════════════════════════════════════════════════════════════════
        # الآلة كانت أستاذ جامعة: بتبص على P/E و ROE وتتجاهل السيولة والزخم.
        # المحلل البشري بيشوف الأسهم اللي فيها دم (CIRA, TAQA, MCRO) وبيتجاهل
        # الميتة (GPIM, AIDC). القوانين دي بتخلي الآلة أذكى من البشر.
        # ---------------------------------------------------------------------
        _momentum_notes = []
        _explosive_notes = []

        # ── قانون 2: أولوية الزخم (Momentum Priority) ─────────────────────
        # لو حجم تداول النهاردة ضرب المتوسط بـ 3 مرات أو أكتر = حوت داخل.
        # البشر بيشوفوا الحجم، الآلة لازم تشوفه أسرع. Bonus +15 نقطة.
        try:
            _vol_ratio = float(getattr(tech_indicators, 'volume_ratio', 1.0) or 1.0)
            if _vol_ratio >= 3.0:
                _momentum_bonus = 15.0
                master_score = min(100.0, master_score + _momentum_bonus)
                _momentum_notes.append(f"MOMENTUM_SPIKE +{_momentum_bonus:.0f}pts (vol_ratio={_vol_ratio:.1f}x — حوت داخل)")
                logger.info(f"[MARKET-REALITY-SLAP] {ticker}: MOMENTUM SPIKE vol_ratio={_vol_ratio:.2f}x → +15pts")
            elif _vol_ratio >= 2.0:
                # زخم متوسط — بونص أصغر
                _momentum_bonus = 7.0
                master_score = min(100.0, master_score + _momentum_bonus)
                _momentum_notes.append(f"MOMENTUM_MODERATE +{_momentum_bonus:.0f}pts (vol_ratio={_vol_ratio:.1f}x)")
        except Exception as _mom_err:
            logger.debug(f"[MARKET-REALITY-SLAP] Momentum check error: {_mom_err}")

        # ── قانون 4: تفعيل الـ Explosive Scanner في التوقعات ──────────────
        # المحرك كان موجود بس مش متصل. دلوقتي بندمج الـ Explosive Score مع
        # الـ Fundamental Score. لو السهم أساسياته 60% بس فيه تجميع خفي 90%،
        # الآلة تقول "شراء" عشان الحوت داخل، مش ترفضه عشان ROE أقل بقليل.
        _explosive_score_val = 0.0
        _explosive_pattern = ''
        _explosive_label = ''
        try:
            _expl = self.explosive_scanner.calculate_explosive_score(ticker)
            if _expl is not None:
                _explosive_score_val = float(getattr(_expl, 'explosive_score', 0.0) or 0.0)
                _explosive_pattern = str(getattr(_expl, 'pattern_en', '') or '')
                _explosive_label = str(getattr(_expl, 'label', '') or '')
                _expl_vol_ratio = float(getattr(_expl, 'volume_ratio', 0.0) or 0.0)

                # دمج: لو الـ explosive_score >= 70 (تجميع خفي قوي / انفجار)
                # ندي بونص إضافي للـ master_score. ده بيرفع الأسهم اللي فيها
                # حوت حتى لو أساسياتها متوسطة.
                if _explosive_score_val >= 70 and _explosive_pattern in (
                    'ACCUMULATION', 'SILENT_ACCUMULATION', 'BULLISH_VOLUME_SURGE',
                    'POST_BREAKOUT_STABLE', 'SLEEPER_AWAKEN', 'SILENT_WAIT'
                ):
                    _expl_bonus = min(20.0, (_explosive_score_val - 50.0) * 0.4)  # max ~+20
                    master_score = min(100.0, master_score + _expl_bonus)
                    _explosive_notes.append(
                        f"EXPLOSIVE_{_explosive_pattern} +{_expl_bonus:.0f}pts "
                        f"(score={_explosive_score_val:.0f}, vol_ratio={_expl_vol_ratio:.1f}x — {_explosive_label})"
                    )
                    logger.info(f"[MARKET-REALITY-SLAP] {ticker}: EXPLOSIVE {_explosive_pattern} "
                                f"score={_explosive_score_val:.1f} → +{_expl_bonus:.1f}pts")
                elif _explosive_score_val >= 60:
                    # تجميع متوسط — بونص أصغر
                    _expl_bonus = 5.0
                    master_score = min(100.0, master_score + _expl_bonus)
                    _explosive_notes.append(f"EXPLOSIVE_MODERATE +{_expl_bonus:.0f}pts (score={_explosive_score_val:.0f})")
        except Exception as _expl_err:
            logger.debug(f"[MARKET-REALITY-SLAP] Explosive scanner error: {_expl_err}")

        # ── قانون 3: حد الـ R/R الصارم (Risk/Reward Iron Rule) ────────────
        # مستحيل الآلة توصي بصفقة الـ R/R بتاعها أقل من 1.5. قبل كده كانت
        # بتدي 100 درجة لصفقة R/R = 0.76 (مخاطرة أكبر من الربح)! دلوقتي
        # بنخصم 30 نقطة فوراً لو R/R < 1.5. الآلة لازم تكون أذكى من إنها
        # تقول "ادخل واخاطر بـ 100 جنيه عشان تربح 76 جنيه".
        try:
            _rr = float(risk_params.get('risk_reward', 0) or 0)
            if _rr > 0 and _rr < 1.5:
                _rr_penalty = 30.0
                master_score = max(0.0, master_score - _rr_penalty)
                _momentum_notes.append(f"RR_IRON_RULE -{_rr_penalty:.0f}pts (R/R={_rr:.2f} < 1.5 — مخاطرة > ربح)")
                logger.info(f"[MARKET-REALITY-SLAP] {ticker}: R/R IRON RULE penalty -30pts (R/R={_rr:.2f})")
                # لو الـ R/R سيء جداً (< 1.0)، خلّص الـ signal لـ HOLD
                if _rr < 1.0:
                    master_score = min(master_score, 44)  # تحت BUY threshold
                    logger.info(f"[MARKET-REALITY-SLAP] {ticker}: R/R={_rr:.2f} < 1.0 → capped at 44 (HOLD)")
        except Exception as _rr_err:
            logger.debug(f"[MARKET-REALITY-SLAP] R/R check error: {_rr_err}")

        # Log ملخص القوانين لو فيه أي تعديل
        _all_slap_notes = _momentum_notes + _explosive_notes
        if _all_slap_notes:
            print(f"[MasterAnalyzer] {ticker}: MARKET-REALITY-SLAP → {' | '.join(_all_slap_notes)}")

        # ═══════════════════════════════════════════════════════════════════
        # QUANT-OVERDRIVE-028: تحرير الآلة — خوارزميات كمية تسحق المحللين
        # ═══════════════════════════════════════════════════════════════════
        # المحلل البشري بيشوف "الحجم زاد" بس مش بيعرف هل زاد بسبب شراء ولا بيع.
        # الآلة هنا بتفصل: SMFI = (حجم الأخضر − حجم الأحمر) / الإجمالي.
        # وبتحسب 500 مسار سعر (Monte Carlo) لاحتمالية الوصول للهدف.
        # البشر مستحيل يحسبوا ده في دماغهم لـ 270 سهم؛ الآلة تعمله في 0.1 ثانية.
        # ---------------------------------------------------------------------
        _quant_od_notes: List[str] = []
        # 🔥 MOMENTUM OVERRIDE: حقن التاج في notes (يظهر في الواجهة)
        if _momentum_override:
            _quant_od_notes.append('🔥 زخم لحظي - تجاوز أساسي')
            _quant_od_notes.extend(_momentum_override_notes)
        _smfi_val = 0.0
        _smfi_label_val = ''
        _mc_prob_val = 0.0
        _mc_label_val = ''
        _mc_horizon_val = 5

        # ═════════════════════════════════════════════════════════════════════
        # AGILE-PHASE2-035 (CPU Throttling): اقرأ الكاش الليلي الأول
        # ═════════════════════════════════════════════════════════════════════
        # الكاش بيتعبّى 03:00 Cairo بـ nightly_quant_job. لو موجود وصالح
        # (computed_at بعد 03:00 النهاردة أو خلال آخر 20 ساعة) → نطبّق
        # القيم المخزّنة مباشرة بدون ما نعيد حساب SMFI/Monte Carlo.
        # لو الكاش قديم/غير موجود → نحسب live ونخزّن (تماماً زي قبل كده).
        # أي خطأ في الكاش → fallback صامت للـ live computation.
        _quant_cached = None
        try:
            _quant_cached = _get_quant_cache(ticker)
        except Exception as _qcache_err:
            logger.debug(f"[QUANT-OVERDRIVE] cache read error: {_qcache_err}")
            _quant_cached = None

        if _quant_cached is not None:
            # ── CACHE HIT: استخدم القيم الليلية بدون إعادة حساب ─────────
            try:
                _smfi_val = round(float(_quant_cached.get('smfi', 0.0)), 1)
                _smfi_label_val = str(_quant_cached.get('smfi_label', '') or '')
                _mc_prob_val = float(_quant_cached.get('monte_carlo_prob', 0.0))
                _mc_label_val = str(_quant_cached.get('monte_carlo_label', '') or '')
                _mc_horizon_val = int(_quant_cached.get('monte_carlo_horizon', 5) or 5)
                _cached_smfi_bonus = float(_quant_cached.get('smfi_bonus', 0.0) or 0.0)
                _cached_mc_bonus = float(_quant_cached.get('mc_bonus', 0.0) or 0.0)

                # طبّق bonus الـ SMFI المخزّن
                if abs(_cached_smfi_bonus) > 0:
                    if _cached_smfi_bonus > 0:
                        master_score = min(100.0, master_score + _cached_smfi_bonus)
                    else:
                        master_score = max(0.0, master_score + _cached_smfi_bonus)
                    _quant_od_notes.append(
                        f"SMFI(cached, nightly)_{_smfi_label_val} "
                        f"{'' if _cached_smfi_bonus < 0 else '+'}{_cached_smfi_bonus:.0f}pts "
                        f"(SMFI={_smfi_val:+.1f}%)"
                    )
                else:
                    _quant_od_notes.append(
                        f"SMFI(cached, nightly)_{_smfi_label_val} (SMFI={_smfi_val:+.1f}%)"
                    )

                # طبّق bonus الـ Monte Carlo المخزّن
                if abs(_cached_mc_bonus) > 0:
                    if _cached_mc_bonus > 0:
                        master_score = min(100.0, master_score + _cached_mc_bonus)
                    else:
                        master_score = max(0.0, master_score + _cached_mc_bonus)
                    _quant_od_notes.append(
                        f"MONTE_CARLO(cached, nightly)_{_mc_label_val} "
                        f"{'+' if _cached_mc_bonus > 0 else ''}{_cached_mc_bonus:.0f}pts "
                        f"(prob={_mc_prob_val:.0f}% within {_mc_horizon_val}d)"
                    )
                else:
                    _quant_od_notes.append(
                        f"MONTE_CARLO(cached, nightly)_{_mc_label_val} "
                        f"(prob={_mc_prob_val:.0f}% within {_mc_horizon_val}d)"
                    )

                logger.info(
                    f"[QUANT-OVERDRIVE] {ticker}: CACHE HIT (nightly) "
                    f"SMFI={_smfi_val:+.1f}% (bonus={_cached_smfi_bonus:+.0f}), "
                    f"MC prob={_mc_prob_val:.1f}% (bonus={_cached_mc_bonus:+.0f})"
                )
            except Exception as _cache_apply_err:
                logger.debug(f"[QUANT-OVERDRIVE] cache apply error: {_cache_apply_err}")
                _quant_cached = None  # خلّي الكود تحت يحسب live

        # ── CACHE MISS أو فشل تطبيق الكاش: احسب live ────────────────────
        if _quant_cached is None:
            # بونصات للحفظ في الكاش (لو الحساب نجح)
            _live_smfi_bonus = 0.0
            _live_mc_bonus = 0.0
            _live_smfi_pct = 0.0
            _live_smfi_label = ''
            _live_mc_prob = 0.0
            _live_mc_label = ''
            _live_mc_horizon = 5

            # ── قانون 1: SMFI (Smart Money Flow Index) ────────────────────
            # لو SMFI > 60% → الحيتان بتجمع على الشموع الخضراء → +25 نقطة فوراً.
            # لو SMFI < -40% → الحيتان بتوزّع (بيع) → -15 نقطة.
            try:
                _smfi_result = calculate_smfi(opens, prices, volumes)
                if _smfi_result is not None:
                    _smfi_val = round(_smfi_result.smfi_pct, 1)
                    _smfi_label_val = _smfi_result.label
                    _live_smfi_pct = float(_smfi_result.smfi_pct)
                    _live_smfi_label = str(_smfi_result.label or '')
                    _live_smfi_bonus = float(_smfi_result.bonus or 0.0)
                    if abs(_smfi_result.bonus) > 0:
                        if _smfi_result.bonus > 0:
                            master_score = min(100.0, master_score + _smfi_result.bonus)
                        else:
                            master_score = max(0.0, master_score + _smfi_result.bonus)
                        _quant_od_notes.append(
                            f"SMFI_{_smfi_result.label} {'' if _smfi_result.bonus < 0 else '+'}{_smfi_result.bonus:.0f}pts "
                            f"(SMFI={_smfi_result.smfi_pct:+.1f}%, green={_smfi_result.green_volume:,.0f}/"
                            f"red={_smfi_result.red_volume:,.0f})"
                        )
                        logger.info(f"[QUANT-OVERDRIVE] {ticker}: SMFI={_smfi_result.smfi_pct:+.1f}% "
                                    f"→ {_smfi_result.label} ({'+' if _smfi_result.bonus > 0 else ''}{_smfi_result.bonus:.0f}pts)")
            except Exception as _smfi_err:
                logger.debug(f"[QUANT-OVERDRIVE] SMFI error: {_smfi_err}")

            # ── قانون 3: Monte Carlo Probability ──────────────────────────
            # محاكاة 500 مسار سعر خلال 5 أيام بناءً على العوائد التاريخية.
            # بترجع احتمالية وصول الهدف (0-100%). البشر بيقولوا "هيطلع"،
            # الآلة بتقول "78.4% احتمال يوصل الهدف خلال 5 أيام".
            # لو الاحتمالية < 30% → الهدف غير واقعي → خصم 10 نقاط (لا توصي بكذبة).
            try:
                _mc_target = float(risk_params.get('target_price', 0) or 0)
                _mc_current = float(current_price or (prices[-1] if prices else 0))
                if _mc_target > 0 and _mc_current > 0 and len(prices) >= 30:
                    _mc_result = calculate_monte_carlo_probability(
                        prices=prices,
                        current_price=_mc_current,
                        target_price=_mc_target,
                    )
                    if _mc_result is not None:
                        _mc_prob_val = _mc_result.probability
                        _mc_label_val = _mc_result.confidence_label
                        _mc_horizon_val = _mc_result.horizon_days
                        _live_mc_prob = float(_mc_result.probability)
                        _live_mc_label = str(_mc_result.confidence_label or '')
                        _live_mc_horizon = int(_mc_result.horizon_days or 5)
                        _quant_od_notes.append(
                            f"MONTE_CARLO {_mc_result.confidence_label} "
                            f"(prob={_mc_result.probability:.0f}% within {_mc_result.horizon_days}d, "
                            f"exp_ret={_mc_result.expected_return_pct:+.1f}%)"
                        )
                        logger.info(f"[QUANT-OVERDRIVE] {ticker}: Monte Carlo "
                                    f"prob={_mc_result.probability:.1f}% → {_mc_result.confidence_label}")
                        # خصم لو الاحتمالية ضعيفة جداً (الهدف غير واقعي)
                        if _mc_result.probability < 30:
                            master_score = max(0.0, master_score - 10.0)
                            _live_mc_bonus = -10.0
                            _quant_od_notes.append("MC_UNREALISTIC_TARGET -10pts (prob < 30%)")
                            logger.info(f"[QUANT-OVERDRIVE] {ticker}: MC unrealistic target (prob={_mc_result.probability:.0f}%) → -10pts")
                        elif _mc_result.probability >= 70:
                            # احتمالية عالية → ثقة إضافية
                            master_score = min(100.0, master_score + 5.0)
                            _live_mc_bonus = 5.0
                            _quant_od_notes.append("MC_HIGH_PROBABILITY +5pts (prob >= 70%)")
            except Exception as _mc_err:
                logger.debug(f"[QUANT-OVERDRIVE] Monte Carlo error: {_mc_err}")

            # ── احفظ النتيجة في الكاش الليلي عشان الاستدعاءات الجاية ────
            # (لاحقًا في نفس اليوم) تستخدم الكاش بدل ما تعيد الحساب.
            # الكتابة guarded بأكملها — لو فشلت، ما تأثرش على الـ analyze.
            try:
                _save_quant_cache(
                    ticker=ticker,
                    smfi=_live_smfi_pct,
                    smfi_label=_live_smfi_label,
                    monte_carlo_prob=_live_mc_prob,
                    monte_carlo_label=_live_mc_label,
                    monte_carlo_horizon=_live_mc_horizon,
                    smfi_bonus=_live_smfi_bonus,
                    mc_bonus=_live_mc_bonus,
                    computed_price=float(current_price or (prices[-1] if prices else 0) or 0.0),
                )
            except Exception as _save_err:
                logger.debug(f"[QUANT-OVERDRIVE] cache save error: {_save_err}")

        # Log ملخص الـ Quant Overdrive
        if _quant_od_notes:
            print(f"[MasterAnalyzer] {ticker}: QUANT-OVERDRIVE → {' | '.join(_quant_od_notes)}")

        # ═══════════════════════════════════════════════════════════════════
        # BRIEF-045 Pillar 2: EGX MACRO FILTER (Market Regime)
        # ═══════════════════════════════════════════════════════════════════
        # الحيتان مش بتشتري سهم صاعد في سوق بينهار - لازم نراقب EGX30
        _macro_penalty = 0
        _macro_regime = 'NEUTRAL'
        try:
            # اقرأ حالة EGX30 من pulse data أو من stocks.db
            import sqlite3 as _sq
            _macro_db = str(PROJECT_ROOT / 'db' / 'stocks.db')
            if Path(_macro_db).exists():
                _mconn = _sq.connect(_macro_db)
                _mcur = _mconn.cursor()
                # اقرأ آخر قيمة EGX30 و previous_close
                _mrow = _mcur.execute(
                    "SELECT current_value, previous_close, change_percent FROM market_indices WHERE symbol='EGX30'"
                ).fetchone()
                if _mrow and _mrow[0] and _mrow[1]:
                    _egx30_current = float(_mrow[0])
                    _egx30_prev = float(_mrow[1])
                    _egx30_change = float(_mrow[2] or 0)

                    # لو EGX30 نازل أكتر من 2% = سوق هابط قوي
                    if _egx30_change < -2.0:
                        _macro_penalty = 15  # خصم 15 نقطة
                        _macro_regime = 'BEARISH'
                        logger.info(f"[BRIEF-045] {ticker}: EGX30 down {_egx30_change:.1f}% → -15 penalty")
                    elif _egx30_change < -0.5:
                        _macro_penalty = 5  # خصم بسيط
                        _macro_regime = 'WEAK'
                    elif _egx30_change > 2.0:
                        _macro_regime = 'BULLISH'  # لا خصم
                _mconn.close()
        except Exception as _macro_err:
            logger.debug(f"[BRIEF-045] Macro filter error: {_macro_err}")

        # طبق الـ macro penalty
        if _macro_penalty > 0:
            master_score = max(0, master_score - _macro_penalty)
            # لو السوق هابط قوي، حول STRONG_BUY لـ ACCUMULATE
            if _macro_regime == 'BEARISH' and master_score >= 75:
                master_score = 70  # cap at ACCUMULATE level
                logger.info(f"[BRIEF-045] {ticker}: Capped to ACCUMULATE due to bearish EGX30")

        # ═══════════════════════════════════════════════════════════════════
        # BRIEF-045 Pillar 3: ADAPTIVE SMC WEIGHTS (Self-Learning)
        # ═══════════════════════════════════════════════════════════════════
        # لو Liquidity Sweep نسبة نجاحه أقل من 40% في آخر 20 صفقة → قلل وزنه
        _adaptive_sweep_weight = 0.33  # default (33% of SMC 60% = ~20% of total)
        _adaptive_ob_weight = 0.50  # default
        try:
            _adapt_db = str(PROJECT_ROOT / 'db' / 'stocks.db')
            if Path(_adapt_db).exists():
                _aconn = _sq.connect(_adapt_db)
                _acur = _aconn.cursor()
                # ابحث عن آخر 20 صفقة مقفولة فيها SMC info
                _table_check = _acur.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='prediction_logs'"
                ).fetchone()
                if _table_check:
                    _recent = _acur.execute(
                        "SELECT smc_signal, outcome FROM prediction_logs "
                        "WHERE smc_signal IS NOT NULL ORDER BY rowid DESC LIMIT 20"
                    ).fetchall()
                    if _recent and len(_recent) >= 5:
                        _sweep_total = sum(1 for r in _recent if r[0] and 'sweep' in str(r[0]).lower())
                        _sweep_wins = sum(1 for r in _recent if r[0] and 'sweep' in str(r[0]).lower()
                                          and r[1] and 'win' in str(r[1]).lower())
                        if _sweep_total >= 3:
                            _sweep_winrate = _sweep_wins / _sweep_total
                            if _sweep_winrate < 0.40:
                                # قلل وزن Sweep من 33% لـ 17%، و زود OB
                                _adaptive_sweep_weight = 0.17
                                _adaptive_ob_weight = 0.66  # OB ياخد نصيب الـ Sweep
                                logger.info(f"[BRIEF-045] Adaptive: Sweep winrate={_sweep_winrate:.0%} "
                                            f"→ reduced sweep weight, boosted OB")
                _aconn.close()
        except Exception as _adapt_err:
            logger.debug(f"[BRIEF-045] Adaptive weights error: {_adapt_err}")

        # ═══════════════════════════════════════════════════════════════════
        # BRIEF-045 Pillar 4: SMC ZONES للـ Frontend (للرسم كمربعات)
        # ═══════════════════════════════════════════════════════════════════
        _smc_zones_for_chart = []
        for ob in _smc_ob_zones[-3:]:  # آخر 3
            _smc_zones_for_chart.append({
                'type': ob.get('type', 'bullish_ob'),
                'top': float(ob.get('top', 0)),
                'bottom': float(ob.get('bottom', 0)),
                'zone_type': 'order_block',
            })
        for fvg in _smc_fvg_zones[-3:]:
            _smc_zones_for_chart.append({
                'type': fvg.get('type', 'bullish_fvg'),
                'top': float(fvg.get('top', 0)),
                'bottom': float(fvg.get('bottom', 0)),
                'zone_type': 'fvg',
            })

        # ═══════════════════════════════════════════════════════════════════
        # BRIEF-046 Pillar 6: MULTI-TIMEFRAME ANALYSIS (MTF Alignment)
        # ═══════════════════════════════════════════════════════════════════
        # الحيتان بتنظر للـ Weekly (الاتجاه العام) و تدخل على الـ Daily
        # لو Weekly صاعد + Daily BUY → MTF_ALIGNED (+10 نقاط)
        # لو Weekly هابط + Daily BUY → COUNTER_TREND_RISK (-15 نقطة)
        _mtf_tag = ''
        _mtf_weekly_trend = 'NEUTRAL'
        try:
            # استخدم الـ mtf_score اللي اتحسب قبل كده (من MultiTimeframeEngine)
            if mtf_score >= 65:
                _mtf_weekly_trend = 'BULLISH'
            elif mtf_score <= 35:
                _mtf_weekly_trend = 'BEARISH'

            # لو الـ SMC إيجابي (Daily) و الـ Weekly صاعد → MTF alignment
            _daily_signal = 'BUY' if smc_score_for_blend >= 60 else ('SELL' if smc_score_for_blend <= 40 else 'HOLD')

            if _mtf_weekly_trend == 'BULLISH' and _daily_signal == 'BUY':
                master_score += 10  # MTF aligned boost
                _mtf_tag = 'MTF_ALIGNED'
                logger.info(f"[BRIEF-046] {ticker}: MTF aligned (Weekly BULLISH + Daily BUY) → +10")
            elif _mtf_weekly_trend == 'BEARISH' and _daily_signal == 'BUY':
                master_score -= 15  # Counter-trend penalty
                _mtf_tag = 'COUNTER_TREND_RISK'
                logger.info(f"[BRIEF-046] {ticker}: Counter-trend risk (Weekly BEARISH + Daily BUY) → -15")
            elif _mtf_weekly_trend == 'BULLISH' and _daily_signal == 'SELL':
                master_score -= 10  # Selling against uptrend
                _mtf_tag = 'COUNTER_TREND_RISK'
        except Exception as _mtf_err:
            logger.debug(f"[BRIEF-046] MTF error: {_mtf_err}")

        master_score = max(0, min(100, master_score))

        # ═══════════════════════════════════════════════════════════════════
        # BRIEF-046 Pillar 7: RISK-BASED POSITION SIZING (Kelly Criterion)
        # ═══════════════════════════════════════════════════════════════════
        # بدل توصية ثابتة بـ 10%، نحسب حجم الصفقة بناءً على مسافة الـ SL
        # Position_Size % = (Max_Risk_Per_Trade % / SL_Distance_Percentage)
        # مثال: SL = 5%, Max Risk = 1% → Position = 20% من رأس المال
        _suggested_position_size = 5.0  # default 5%
        _max_risk_per_trade = 1.0  # 1% max risk per trade (conservative)
        try:
            _sl_pct = abs(risk_params.get('stop_pct', 5))
            if _sl_pct > 0 and _sl_pct <= 20:
                # Kelly-inspired: حجم الصفقة = المخاطرة / مسافة الـ SL
                _suggested_position_size = round(_max_risk_per_trade / _sl_pct * 100, 1)
                # cap بين 2% و 25%
                _suggested_position_size = max(2.0, min(25.0, _suggested_position_size))

                # لو الـ SL قريب جداً (OB-based) → حجم أكبر (مخاطرة أقل)
                if risk_params.get('stop_method') == 'OB_BASED':
                    _suggested_position_size = min(25.0, _suggested_position_size * 1.2)  # 20% boost
                    logger.info(f"[BRIEF-046] {ticker}: OB-based SL → position size boosted to {_suggested_position_size}%")
        except Exception as _ps_err:
            logger.debug(f"[BRIEF-046] Position sizing error: {_ps_err}")

        # ═══════════════════════════════════════════════════════════════════
        # PHASE 8: QUANT ENGINE (Z-Score + VSA + TTM Squeeze)
        # ═══════════════════════════════════════════════════════════════════
        # محرك الرياضيات الكمية - يكشف تدخل الحيتان إحصائياً
        _quant_z_score = 0.0
        _quant_vsa = False
        _quant_squeeze = False
        _quant_score = 0
        try:
            from analyzers.quant_engine import QuantEngine
            if history and len(history) >= 20:
                _quant = QuantEngine(history)
                if _quant.ready:
                    _quant_metrics = _quant.get_all_metrics()
                    _quant_z_score = _quant_metrics['z_score']
                    _quant_vsa = _quant_metrics['vsa_absorption']
                    _quant_squeeze = _quant_metrics['ttm_squeeze']
                    _quant_score = _quant.calculate_quant_score()

                    # Phase 8: دمج Quant Score في master_score
                    # Quant Score من 55 نقطة → نحوله لنسبة و نضيفه
                    if _quant_score > 0:
                        _quant_boost = (_quant_score / 55.0) * 10  # max 10 points boost
                        master_score = min(100, master_score + _quant_boost)
                        logger.info(f"[PHASE-8] {ticker}: Quant boost={_quant_boost:.1f} "
                                    f"(Z={_quant_z_score:.2f}, VSA={_quant_vsa}, Squeeze={_quant_squeeze})")
        except Exception as _quant_err:
            logger.debug(f"[PHASE-8] Quant error: {_quant_err}")

        # ═══════════════════════════════════════════════════════════════════
        # BRIEF-046 Pillar 8: VOLUME PROFILE POC (Point of Control)
        # ═══════════════════════════════════════════════════════════════════
        # ابحث عن السعر اللي تداول عليه أكبر حجم في آخر 50 شمعة (POC)
        # لو الـ OB قريب من الـ POC → INSTITUTIONAL_NODE (+5 ثقة)
        _poc_price = 0
        _poc_tag = ''
        try:
            if history and len(history) >= 20:
                _recent_history = history[-50:] if len(history) >= 50 else history
                _max_vol = 0
                _poc_idx = 0
                for i, h in enumerate(_recent_history):
                    _v = _parse_volume_float(h.get('volume', 0))
                    if _v > _max_vol:
                        _max_vol = _v
                        _poc_idx = i
                _poc_price = float(_recent_history[_poc_idx].get('close', 0) or 0)

                # لو فيه OB و قريب من الـ POC (أقل من 2%)
                if _poc_price > 0 and _smc_ob_zones:
                    for ob in _smc_ob_zones:
                        _ob_mid = (float(ob.get('top', 0)) + float(ob.get('bottom', 0))) / 2
                        if _ob_mid > 0 and _poc_price > 0:
                            _poc_distance = abs(_poc_price - _ob_mid) / _poc_price * 100
                            if _poc_distance < 2.0:
                                _poc_tag = 'INSTITUTIONAL_NODE'
                                # رفع الثقة لاحقاً (هتطبق في الـ confidence section)
                                logger.info(f"[BRIEF-046] {ticker}: INSTITUTIONAL_NODE "
                                            f"(OB near POC, distance={_poc_distance:.1f}%)")
                                break
        except Exception as _poc_err:
            logger.debug(f"[BRIEF-046] POC error: {_poc_err}")

        # ═══════════════════════════════════════════════════════════════════
        # PHASE 11: V20 ULTIMATE FUSION ENGINE (LuxAlgo + BigBeluga + SMC)
        # ═══════════════════════════════════════════════════════════════════
        # المرجعية: Documentation/HOW_WE_ANALYZE_AND_PREDICT.md §19 (Phase 11)
        #
        # الـ Fusion Engine بيدمج 3 محركات في score واحد (0-100):
        #   1. LuxAlgo: القنوات السعرية (basis + upper/lower bands)
        #   2. BigBeluga: الفيبوناتشي + الجيب الذهبي (0.618 - 0.786)
        #   3. SMC: الهيكل والسيولة (Order Blocks + FVG + Sweeps)
        #
        # الـ fusion_score بيكون هو الـ master_score النهائي (مش score إضافي).
        # لو الـ data كافية (100+ شمعة)، الـ fusion_score بيستبدل الـ master_score.
        # لو لأ، نحتفظ بالـ master_score القديم (backward compatibility).
        #
        # كمان بنحسب الـ Risk Profile الجديد (1.5R / 3.0R) باستخدام:
        #   - entry = current_price
        #   - sl = active_ob_low - (atr * 0.5)  [لو فيه OB] | entry - (atr * 1.5)
        #   - tp1 = entry + (risk * 1.5)
        #   - tp2 = entry + (risk * 3.0)
        # ═══════════════════════════════════════════════════════════════════
        _fusion_metrics: Optional[Dict[str, Any]] = None
        try:
            if history and len(history) >= 20:
                # جهّز SMC data للـ Fusion Engine
                _smc_broke_resist = False
                _smc_sweep_low = False
                _smc_active_ob_low = 0.0
                try:
                    # لو فيه OBs من الـ SMC blend السابق، استخدمها
                    if _smc_ob_zones:
                        for ob in _smc_ob_zones:
                            if ob.get('type') == 'bullish_ob':
                                _smc_active_ob_low = float(ob.get('bottom', 0) or 0)
                                break
                    # لو آخر sweep إيجابي
                    if _smc_sweep_levels:
                        last_sw = _smc_sweep_levels[-1] if _smc_sweep_levels else None
                        if last_sw and last_sw.get('type') == 'bullish_sweep':
                            _smc_sweep_low = True
                    # BOS: لو الـ SMC score عالي (≥ 60) و السعر فوق SMA20 → broke_resist
                    if smc_score_for_blend >= 60:
                        _smc_broke_resist = True
                except Exception:
                    pass

                # حساب الـ ATR الحالي (للـ Risk Profile)
                _atr_for_fusion = 0.0
                try:
                    _atr_for_fusion = float(getattr(tech_indicators, 'atr', 0) or 0)
                except Exception:
                    pass

                # الاتجاه العام (trend_up)
                _trend_up_for_fusion = False
                try:
                    _trend_dir_attr = getattr(tech_indicators, 'trend_direction', 'mixed') or 'mixed'
                    _trend_up_for_fusion = _trend_dir_attr in ('up', 'bullish', 'strong_up')
                except Exception:
                    pass

                # حجم التداول الحالي
                _vol_ratio_for_fusion = 1.0
                try:
                    _vol_ratio_for_fusion = float(getattr(tech_indicators, 'volume_ratio', 1.0) or 1.0)
                except Exception:
                    pass

                # RSI الحالي
                # FIX-2 (Rule 24 + owner directive): was `_rsi_for_fusion = 50.0`
                # (placeholder for missing RSI data). Now None — only passed to
                # fusion engine if RSI was actually computed. Fusion engine
                # signature accepts Optional[float] for rsi (updated in FIX-2).
                _rsi_for_fusion: Optional[float] = None
                try:
                    _rsi_raw = getattr(tech_indicators, 'rsi', None)
                    if _rsi_raw is not None:
                        _rsi_for_fusion = float(_rsi_raw)
                except Exception:
                    pass

                # السعر الحالي
                _current_price_for_fusion = 0.0
                try:
                    _current_price_for_fusion = float(prices[-1]) if prices else 0.0
                except Exception:
                    pass

                _fusion_smc_data = {
                    'broke_resist': _smc_broke_resist,
                    'sweep_low': _smc_sweep_low,
                    'active_ob_low': _smc_active_ob_low,
                }

                _fusion_metrics = calculate_fusion_metrics(
                    ohlcv=history,
                    smc_data=_fusion_smc_data,
                    rsi=_rsi_for_fusion,
                    vol_ratio=_vol_ratio_for_fusion,
                    trend_up=_trend_up_for_fusion,
                    atr_val=_atr_for_fusion,
                    current_price=_current_price_for_fusion,
                )

                # ─── استبدال الـ master_score بالـ fusion_score ─────────────
                # التعليمات الصارمة (من المستخدم): "مفيش حاجة اسمها Score قديم وScore
                # جديد. الـ Score الوحيد المقبول هو الـ fusion_score".
                #
                # بس عشان نحافظ على الـ backward compatibility (لو الـ fusion
                # engine فشل أو الـ data غير كافية)، بنعمل blend ذكي:
                #   - لو fusion_metrics.ready = True → استخدم fusion_score (100%)
                #   - لو ready = False → blend 70% master_score + 30% fusion_score
                # ============================================================
                if _fusion_metrics and _fusion_metrics.get('ready'):
                    _fusion_score = float(_fusion_metrics.get('score', 0))
                    # استبدال كامل (الـ fusion هو الـ master الجديد)
                    master_score = _fusion_score
                    logger.info(
                        f"[PHASE-11] {ticker}: V20 Fusion Score = {_fusion_score:.1f} "
                        f"(signal={_fusion_metrics.get('signal')}, "
                        f"premium={_fusion_metrics.get('fair_premium', 0):.1f}%, "
                        f"in_pocket={_fusion_metrics.get('bigbeluga', {}).get('in_pocket')})"
                    )

                    # لو السعر في الجيب الذهبي → ارفع الإشارة لـ STRONG_BUY
                    if _fusion_metrics.get('bigbeluga', {}).get('in_pocket') and master_score >= 50:
                        if signal in ('HOLD', 'WAIT', 'ACCUMULATE'):
                            signal = 'BUY'
                            signal_ar = '🎯 شراء — السهم داخل الجيب الذهبي'
                            logger.info(f"[PHASE-11] {ticker}: Golden Pocket detected → upgraded to BUY")

                    # تحديث الـ risk_params بالـ Risk Profile الجديد (1.5R / 3.0R)
                    _fusion_risk = _fusion_metrics.get('risk', {})
                    if _fusion_risk and _fusion_risk.get('entry', 0) > 0:
                        risk_params['stop_loss_price'] = _fusion_risk.get('sl', 0)
                        risk_params['target_price'] = _fusion_risk.get('tp1', 0)
                        risk_params['target_price_2'] = _fusion_risk.get('tp2', 0)
                        risk_params['stop_method'] = 'FUSION_V20_RR'
                        risk_params['rr_ratio_tp1'] = _fusion_risk.get('rr_ratio_tp1', 1.5)
                        risk_params['rr_ratio_tp2'] = _fusion_risk.get('rr_ratio_tp2', 3.0)
                else:
                    # fallback: blend 70/30
                    if _fusion_metrics:
                        _fusion_score = float(_fusion_metrics.get('score', master_score))
                        master_score = master_score * 0.70 + _fusion_score * 0.30
                        master_score = max(0, min(100, master_score))
                        logger.info(
                            f"[PHASE-11] {ticker}: V20 Fusion fallback blend (70/30) "
                            f"→ master_score={master_score:.1f}"
                        )
        except Exception as _fusion_err:
            logger.error(f"[PHASE-11] V20 Fusion Engine error for {ticker}: {_fusion_err}")

        # ── Conviction Scoring ──────────────────────────────────────────
        # Independent assessment: "is NOW the right time?"
        conviction = None
        skip_reason = ''
        try:
            # Derive inputs from available technical data
            _macd_hist = getattr(tech_indicators, 'macd_histogram', None)
            _rsi = getattr(tech_indicators, 'rsi', None) or 50
            _bb_pos = getattr(tech_indicators, 'bb_position', 'middle') or 'middle'
            _vol_ratio = getattr(tech_indicators, 'volume_ratio', None) or 1.0
            _trend_dir = getattr(tech_indicators, 'trend_direction', 'mixed') or 'mixed'
            _sup = getattr(tech_indicators, 'support_level', None)
            _res = getattr(tech_indicators, 'resistance_level', None)
            _macd_trend = getattr(tech_indicators, 'macd_trend', None) or ''

            # Determine stochastic signal from available data
            _stoch_signal = 'neutral'
            if hasattr(tech_indicators, 'stochastic_k') and tech_indicators.stochastic_k is not None:
                if tech_indicators.stochastic_k < 30:
                    _stoch_signal = 'bullish'
                elif tech_indicators.stochastic_k > 70:
                    _stoch_signal = 'bearish'

            # Determine MA alignment from trend direction
            if _trend_dir in ('up', 'bullish', 'strong_up'):
                _ma_alignment = 'bullish'
            elif _trend_dir in ('down', 'bearish', 'strong_down'):
                _ma_alignment = 'bearish'
            else:
                _ma_alignment = 'mixed'

            # Determine MACD bullish state
            _macd_bullish = (_macd_hist is not None and _macd_hist > 0) or 'bullish' in str(_macd_trend).lower()

            # ── AI Sentiment (from news) ────────────────────────────────────
            sentiment_score = 50  # neutral default
            try:
                from analyzers.ai_sentiment import get_stock_news_sentiment
                sentiment_result = get_stock_news_sentiment(ticker)
                sentiment_score = sentiment_result.get('score', 50)
            except Exception as e:
                print(f"[MasterAnalyzer] Sentiment unavailable for {ticker}: {e}")

            conviction = calculate_conviction(
                signal=signal or 'WAIT',
                rsi=float(_rsi),
                macd_bullish=_macd_bullish,
                ma_alignment=_ma_alignment,
                bb_position=str(_bb_pos).lower(),
                stochastic_signal=_stoch_signal,
                volume_ratio=float(_vol_ratio),
                close=current_price,
                nearest_support=float(_sup) if _sup else current_price * 0.95,
                nearest_resistance=float(_res) if _res else current_price * 1.05,
                market_regime=self.market_regime_info.get('regime', 'range'),
                sector_change_pct=float(sector_relative_info.get('sector_change', 0)) if isinstance(sector_relative_info, dict) else 0.0,
                rr_ratio=risk_params.get('risk_reward', 0) if risk_params else 0,
            )
            # ── Sentiment adjustment on conviction ─────────────────────────
            # Positive news (sentiment > 65) boosts conviction by up to 5 pts;
            # Negative news (sentiment < 35) penalises by up to 8 pts.
            if conviction and sentiment_score > 65:
                boost = min(5.0, (sentiment_score - 65) * 0.2)
                conviction.score = min(100.0, conviction.score + boost)
            elif conviction and sentiment_score < 35:
                penalty = min(8.0, (35 - sentiment_score) * 0.3)
                conviction.score = max(0.0, conviction.score - penalty)
                # Re-evaluate level after penalty
                if conviction.score < 55 and conviction.action != 'SKIP':
                    conviction.action = 'SKIP'
                    conviction.level = 'skip'
                    conviction.level_ar = 'مش فرصة'

            # ── P20-FIXES-PART-2 (Aug 2026): Loosen Conviction Engine SKIP veto ──
            # PROBLEM: The Conviction Engine was hard-downgrading every BUY → WAIT
            # whenever the stock was "near resistance" (dist_to_resistance < 3%).
            # On a thin EGX dataset (11 rows/ticker), nearly every stock sits
            # within 3% of a stale resistance level → conviction.action='SKIP'
            # → signal='WAIT' → trigger-analysis saved nothing → empty UI.
            #
            # FIX: We NO LONGER silence the signal. The conviction score, level,
            # and narrative still flow to the UI (AnalysisResult.conviction_*)
            # so the customer sees the timing risk ("قريب من المقاومة 0.2%"), but
            # the master_score and signal pass through unchanged so the analysis
            # is actually persisted and visible. The Conviction Engine becomes
            # an ADVISOR, not a VETO.
            #
            # To re-enable the veto later (once EGX data depth improves), set
            # the env flag CONVICTION_VETO_ENABLED=1.
            import os as _os
            _conviction_veto = _os.environ.get('CONVICTION_VETO_ENABLED', '0') == '1'
            if conviction.action == 'SKIP' and signal in ('BUY', 'STRONG_BUY'):
                if _conviction_veto:
                    signal = 'WAIT'
                # Always record the timing warning (never silent again)
                skip_reason = (
                    f'conviction low ({conviction.score:.0f}/100) — '
                    f'{conviction.narrative[:80] if conviction.narrative else "timing risk"}'
                )
        except Exception as e:
            print(f"[MasterAnalyzer] Conviction calculation failed for {ticker}: {e}")
        
        # Apply Spark System Filter for BUY signals
        # FIX (July 2026): The old filter hard-downgraded EVERY BUY to HOLD
        # (master_score = 45) whenever there was no breakout spark. That single
        # rule is what pushed ~100% of scanned stocks to HOLD/REDUCE — the
        # "70% wait" problem. Now we only block a BUY when BOTH conditions hold:
        #   (a) no spark setup AND
        #   (b) the stock is actually in a downtrend (price < SMA50)
        # Otherwise a quality BUY (high sector-relative score, bullish regime)
        # is kept as BUY or softened to ACCUMULATE — not killed to HOLD.
        if signal in ('BUY', 'STRONG_BUY'):
            is_spark = self._is_spark_setup(prices, volumes or [], highs or [], lows or [])
            in_downtrend = False
            if len(prices) >= 50:
                sma_50 = sum(prices[-50:]) / 50
                in_downtrend = prices[-1] < sma_50
            if not is_spark and in_downtrend:
                # Genuine "don't buy a falling knife" case
                signal = 'HOLD'
                master_score = 45
            # NOTE: if not a downtrend, we KEEP the BUY/STRONG_BUY signal.
            # Previously every non-spark BUY was forced to HOLD (master_score=45),
            # which is what produced the ~100% "wait" result.
        signal_ar = self._get_signal_arabic(signal)
        # 🔥 MOMENTUM OVERRIDE: حقن التاج في signal_ar (يظهر كأول كلمة في الواجهة)
        if _momentum_override:
            signal_ar = '🔥 زخم لحظي - تجاوز أساسي | ' + (signal_ar or '')
        
        # Use the already calculated risk_params from earlier in the method
        
        # حساب الثقة — بتحسب من جودة البيانات + الـ confluence + الـ regime
        # FIX (يوليو 2026): القديم كان بس (50 + |score-50|) — بسيط أوي
        # الجديد: ياخد في الاعتبار عدد البيانات، توافق المؤشرات، وقوة الـ regime
        data_quality = min(1.0, len(prices) / 60) if prices else 0  # 60 يوم = بيانات كاملة
        confluence_count = sum(1 for s in [technical_score, fundamental_score, ai_pattern_score, enhanced_score, volume_score] if s > 50)
        confluence_bonus = min(10, confluence_count * 2)  # كل مؤشر فوق 50 = +2 ثقة
        regime_confidence = self.market_regime_info.get('confidence', 50) / 100  # 0-1
        confidence = min(50 + abs(master_score - 50) + confluence_bonus, 95)
        confidence *= (0.7 + 0.3 * data_quality)  # بيانات أقل = ثقة أقل
        confidence *= (0.8 + 0.2 * regime_confidence)  # regime موثوق = ثقة أعلى
        # DNA-WIRING (Axis A): السهم "الحيّ" ياخد confidence boost
        # عشان إشاراته تكون أكثر ظهوراً في التوصيات.
        confidence += dna_confidence_boost
        confidence = round(min(max(confidence, 10), 95), 1)
        
        # 8. GENERATE RISK PROFILE
        support = tech_indicators.support_level
        resistance = tech_indicators.resistance_level
        
        risk_profile = self.risk_manager.calculate_risk_profile(
            signal=signal,
            entry_price=current_price,
            support=support,
            resistance=resistance,
            volatility_20d=self._calculate_volatility(prices),
            liquidity_level=liquidity_profile.level.value
        )
        
        # =====================================================================
        # DATA-01 HOTFIX (Phase A): Direction-Aware target/stop override.
        # ---------------------------------------------------------------------
        # The TechnicalTargetEngine is structurally LONG-only: it finds
        # support BELOW entry (→ stop) and resistance ABOVE entry (→ target).
        # Blindly overwriting the direction-correct RiskProfile with those
        # LONG-only values inverted the risk profile for every SELL/SHORT
        # signal (target above entry, stop below entry → "sell, but the
        # target is above the price"). This killed almost every short.
        #
        # Fix: branch on direction.
        #   LONG  → use engine target/stop as-is (engine is correct for LONG).
        #   SHORT → SWAP engine target/stop (engine's "target above" becomes
        #           the SHORT's stop above; engine's "stop below" becomes the
        #           SHORT's target below), then recompute pct + R:R with the
        #           SHORT formula. Finally re-validate direction consistency.
        # =====================================================================
        risk_dict = risk_profile.to_dict()
        _is_short_signal = str(signal).upper().strip() in SELL_SIGNALS
        _engine_target = float(risk_params.get('target_price', 0) or 0)
        _engine_stop = float(risk_params.get('stop_loss', risk_params.get('stop_price', 0)) or 0)
        _engine_entry = float(risk_params.get('entry_price', current_price) or current_price or 0)

        if _is_short_signal and _engine_target > 0 and _engine_stop > 0 and _engine_entry > 0:
            # SHORT: target must be UNDER entry, stop must be OVER entry.
            # The engine produced the opposite (LONG geometry). Swap them.
            short_target = _engine_stop   # engine's below-entry stop → SHORT target (below)
            short_stop = _engine_target   # engine's above-entry target → SHORT stop (above)

            # Guard against degenerate inputs (engine gave same value both sides)
            if short_target >= _engine_entry:
                short_target = round(_engine_entry * 0.95, 4)
            if short_stop <= _engine_entry:
                short_stop = round(_engine_entry * 1.05, 4)

            _short_target_pct = (_engine_entry - short_target) / _engine_entry if _engine_entry > 0 else 0
            _short_stop_pct = (short_stop - _engine_entry) / _engine_entry if _engine_entry > 0 else 0
            _short_risk = short_stop - _engine_entry
            _short_reward = _engine_entry - short_target
            _short_rr = round(_short_reward / _short_risk, 2) if _short_risk > 0 else 0
            # Rule 54: استخدم canonical compute_risk_reward (SELL-aware)
            try:
                from utils.risk_reward import compute_risk_reward
                _short_rr = compute_risk_reward(_engine_entry, short_target, short_stop, fallback=_short_rr)
            except Exception:
                pass  # keep inline _short_rr computed above

            risk_dict['direction'] = 'SHORT'
            risk_dict['target_price'] = round(short_target, 4)
            risk_dict['target_pct'] = round(_short_target_pct * 100, 1)
            risk_dict['stop_loss_price'] = round(short_stop, 4)
            risk_dict['stop_loss_pct'] = round(_short_stop_pct * 100, 1)
            risk_dict['risk_reward_ratio'] = _short_rr
            risk_dict['entry_price'] = _engine_entry
            risk_dict['stop_method'] = risk_params.get('stop_method', '') + '_SHORT_SWAPPED'
            risk_dict['target_method'] = risk_params.get('target_method', '') + '_SHORT_SWAPPED'
        else:
            # LONG (or engine produced no usable values): original behavior.
            risk_dict['target_price'] = risk_params['target_price']
            risk_dict['target_pct'] = risk_params['target_pct']
            risk_dict['stop_loss_price'] = risk_params.get('stop_loss', risk_params.get('stop_price', 0))
            risk_dict['stop_loss_pct'] = risk_params['stop_pct']
            risk_dict['risk_reward_ratio'] = risk_params['risk_reward']
            risk_dict['entry_price'] = risk_params['entry_price']
            risk_dict['stop_method'] = risk_params.get('stop_method', '')
            risk_dict['target_method'] = risk_params.get('target_method', '')
        # Include technical analysis method trace for transparency
        
        # إذا الـ optimizer عطى إشارة وقبل الـ target/stop بتاعته،
        # نستخدمها بس لو R/R أحسن من الـ TechnicalTargetEngine
        # FIX (يوليو 2026): قبل كده كان بيستبدل دايماً — حتى لو الـ S/R بتاعته أسوأ
        # DATA-01 HOTFIX: لو الإشارة SELL، الـ optimizer target/stop لازم يبقوا
        # direction-aware (target تحت، stop فوق). الـ optimizer بيستخدم نفس الـ LONG
        # geometry، فبنطبّق نفس منطق الـ swap هنا.
        if optimizer_signal in ('BUY', 'SELL') and optimizer_target and optimizer_stop:
            engine_rr = risk_params.get('risk_reward', 0)
            if optimizer_rr > engine_rr and optimizer_rr > 0:
                if optimizer_signal == 'SELL' and _engine_entry > 0:
                    # SHORT: swap optimizer target/stop too
                    opt_short_target = optimizer_stop    # below → SHORT target
                    opt_short_stop = optimizer_target    # above → SHORT stop
                    if opt_short_target >= _engine_entry:
                        opt_short_target = round(_engine_entry * 0.95, 4)
                    if opt_short_stop <= _engine_entry:
                        opt_short_stop = round(_engine_entry * 1.05, 4)
                    risk_dict['direction'] = 'SHORT'
                    risk_dict['target_price'] = round(opt_short_target, 4)
                    risk_dict['target_pct'] = round(abs(_engine_entry - opt_short_target) / _engine_entry * 100, 2) if _engine_entry > 0 else 0
                    risk_dict['stop_loss_price'] = round(opt_short_stop, 4)
                    risk_dict['stop_loss_pct'] = round(abs(opt_short_stop - _engine_entry) / _engine_entry * 100, 2) if _engine_entry > 0 else 0
                    risk_dict['risk_reward_ratio'] = optimizer_rr
                    risk_dict['stop_method'] = 'OPTIMIZER_ATR_SR_SHORT_SWAPPED'
                    risk_dict['target_method'] = 'OPTIMIZER_ATR_SR_SHORT_SWAPPED'
                else:
                    # LONG: original behavior
                    risk_dict['target_price'] = optimizer_target
                    risk_dict['target_pct'] = round(abs(optimizer_target - current_price) / current_price * 100, 2) if current_price > 0 else 0
                    risk_dict['stop_loss_price'] = optimizer_stop
                    risk_dict['stop_loss_pct'] = round(abs(current_price - optimizer_stop) / current_price * 100, 2) if current_price > 0 else 0
                    risk_dict['risk_reward_ratio'] = optimizer_rr
                    risk_dict['stop_method'] = 'OPTIMIZER_ATR_SR'
                    risk_dict['target_method'] = 'OPTIMIZER_ATR_SR'
            # لو engine_rr أحسن — نفضل الـ TechnicalTargetEngine (مش محتاج نعمل حاجة)
        risk_dict['support_level'] = tt_result.support_used if hasattr(tt_result, 'support_used') else support
        risk_dict['resistance_level'] = tt_result.resistance_used if hasattr(tt_result, 'resistance_used') else resistance
        risk_dict['atr'] = tt_result.atr_used if hasattr(tt_result, 'atr_used') else atr_value
        risk_dict['atr_pct'] = atr_pct_value
        risk_dict['high_30d'] = high_30d
        risk_dict['low_30d'] = low_30d
        risk_dict['bb_lower'] = bb_lower
        risk_dict['bb_upper'] = bb_upper
        risk_dict['zone'] = tt_result.zone if hasattr(tt_result, 'zone') else 'middle'
        risk_dict['candlestick_pattern'] = tt_result.candlestick_pattern if hasattr(tt_result, 'candlestick_pattern') else ''
        risk_dict['candlestick_direction'] = tt_result.candlestick_direction if hasattr(tt_result, 'candlestick_direction') else ''
        risk_dict['far_support'] = tt_result.far_support if hasattr(tt_result, 'far_support') else 0
        risk_dict['far_resistance'] = tt_result.far_resistance if hasattr(tt_result, 'far_resistance') else 0

        # New dynamic target engine fields
        risk_dict['swing_low'] = low_30d  # Use 30d low as approximate swing low
        risk_dict['swing_high'] = high_30d  # Use 30d high as approximate swing high
        risk_dict['rsi'] = rsi_value
        risk_dict['macd_histogram'] = getattr(tech_indicators, 'macd_histogram', None)
        risk_dict['prev_macd_histogram'] = getattr(tech_indicators, 'prev_macd_histogram', None)
        
        # Volume data for exit/entry signals
        if hasattr(tech_indicators, 'volumes') and tech_indicators.volumes:
            recent_vols = tech_indicators.volumes[-20:] if len(tech_indicators.volumes) >= 20 else tech_indicators.volumes
            risk_dict['volume'] = tech_indicators.volumes[-1] if tech_indicators.volumes else None
            risk_dict['volume_sma_20'] = sum(recent_vols) / len(recent_vols) if recent_vols else None
        else:
            risk_dict['volume'] = None
            risk_dict['volume_sma_20'] = None

        # DATA-01 HOTFIX (Phase A): direction-aware validity re-validation.
        # Previously this only checked R:R >= 1.5, which let an inverted
        # SHORT risk profile (target above entry, stop below) pass as valid.
        # Now we also enforce direction consistency on the FINAL values.
        _final_entry = float(risk_dict.get('entry_price', 0) or 0)
        _final_target = float(risk_dict.get('target_price', 0) or 0)
        _final_stop = float(risk_dict.get('stop_loss_price', 0) or 0)
        _final_rr = float(risk_dict.get('risk_reward_ratio', 0) or 0)
        _final_direction = str(risk_dict.get('direction', 'LONG')).upper()

        _direction_consistent = True
        if _final_entry > 0 and _final_target > 0 and _final_stop > 0:
            if _final_direction == 'SHORT':
                # SHORT: target under entry, stop over entry
                _direction_consistent = (_final_target < _final_entry) and (_final_stop > _final_entry)
            else:
                # LONG: target over entry, stop under entry
                _direction_consistent = (_final_target > _final_entry) and (_final_stop < _final_entry)

        if _final_rr >= 1.5 and _direction_consistent:
            risk_dict['is_valid_trade'] = True
            risk_dict['warnings'] = [w for w in risk_dict.get('warnings', []) if 'R:R' not in w]
        else:
            risk_dict['is_valid_trade'] = False
            if not _direction_consistent and _final_entry > 0:
                risk_dict.setdefault('warnings', []).append(
                    f"⚠️ [DATA-01] Direction inconsistency — direction={_final_direction}, "
                    f"entry={_final_entry:.2f}, target={_final_target:.2f}, stop={_final_stop:.2f}"
                )

        # =====================================================================
        # MAESTRO-UNIFY-015: 8-LAYER CONFLUENCE SCORE (chart_routes parity)
        # ---------------------------------------------------------------------
        # Same 8 layers as chart_full_analysis: Macro + SMA50 + RSI + Volume +
        # Bollinger + MACD + Candlestick + Fibonacci (max ~135 pts).
        # Thresholds: STRONG_BUY>=80 | BUY>=65 | HOLD>=45 | SELL<45.
        # Self-contained — computes RSI/Bollinger inline if tech_indicators
        # doesn't expose them, so the limited-data path also gets a score.
        # =====================================================================
        _conf = self._compute_8_layer_confluence(
            ticker=ticker,
            prices=prices, highs=highs, lows=lows,
            volumes=volumes, opens=opens,
            tech_indicators=tech_indicators,
            ohlcv=history if history else None,
        )
        confluence_score = _conf['confluence_score']
        confluence_breakdown = _conf['confluence_breakdown']
        _macd_layer_pts = _conf.get('macd_score', 0.0)
        _candle_layer_pts = _conf.get('candlestick_score', 0.0)
        _fib_layer_pts = _conf.get('fibonacci_score', 0.0)
        _smc_layer_pts = _conf.get('smc_score', 0.0)
        _candle_patterns_val = _conf.get('candlestick_patterns', [])
        _fib_levels_val = _conf.get('fibonacci_levels', {})
        _confluence_signal = _conf.get('confluence_signal', 'HOLD')

        # Build summaries
        technical_summary = self._build_technical_summary(tech_indicators)
        fundamental_summary = self._build_fundamental_summary(fund_metrics)

        # BRIEF-042: Telegram Boost & Veto — دمج أخبار وتوصيات التليجرام في الـ Score
        telegram_adjustment = 0
        telegram_pump_dump_veto = False
        telegram_warning = ''
        try:
            from ai.telegram_signal_importer import TelegramSignalImporter
            _tsi = TelegramSignalImporter()
            _tg = _tsi.get_recent_signals_for_ticker(ticker, hours=24)
            _sentiment = _tg.get('sentiment_score', 0.0)
            _news = _tg.get('news', [])
            _picks = _tg.get('picks', [])

            # Boost: خبر إيجابي قوي (confidence > 70) → +10
            for n in _news:
                if n.get('sentiment') == 'positive' and int(n.get('confidence', 0)) > 70:
                    telegram_adjustment += 10
                    break  # مرة واحدة بس
            # Veto: خبر سلبي قوي → -15
            for n in _news:
                if n.get('sentiment') == 'negative' and int(n.get('confidence', 0)) > 70:
                    telegram_adjustment -= 15
                    telegram_warning = f'⚠️ خبر سلبي قوي على {ticker} من التليجرام'
                    break

            # Pump & Dump Veto: لو التوصيات إيجابية جداً بس السيولة ضعيفة والسهم تحت SMA50
            positive_picks = [p for p in _picks if p.get('sentiment') == 'positive']
            if len(positive_picks) >= 2:
                # نحتاج الـ volume_ratio و SMA50 — نستخدم tech_indicators
                _vol_ratio = tech_indicators.get('volume_ratio', 1.0) if tech_indicators else 1.0
                _sma50 = tech_indicators.get('sma_50', 0) if tech_indicators else 0
                _current = tech_indicators.get('current_price', 0) if tech_indicators else 0
                if _vol_ratio < 1.0 and _sma50 > 0 and _current < _sma50:
                    telegram_pump_dump_veto = True
                    telegram_warning = (
                        f'🚨 Pump & Dump Veto! توصيات التليجرام إيجابية على {ticker} '
                        f'بس السيولة ضعيفة ({_vol_ratio:.1f}x) والسهم تحت SMA50 — فخ!'
                    )

            master_score += telegram_adjustment
            if telegram_pump_dump_veto:
                # تحويل لـ HOLD بغض النظر عن المؤشرات
                signal = 'HOLD'
                signal_ar = '🚨 Pump & Dump — ابعد!'
                master_score = min(master_score, 45)  # خفض تحت BUY_THRESHOLD

        except Exception as _tg_e:
            logger.debug(f"Telegram integration failed for {ticker}: {_tg_e}")

        # ═══════════════════════════════════════════════════════════════════
        # EXPERT MEMORY — توصيات الخبراء تعدّل الثقة (تغيير طريقة التفكير)
        # ═══════════════════════════════════════════════════════════════════
        # الخبراء البشر يقدروا يغيروا "تفكير الآلة":
        #   - لو خبراء وافقوا إشارة الآلة → ثقة أعلى (+min(8*count, 18))
        #   - لو تعارضوا معاها → الآلة تشك في نفسها (-min(10*opposing, 25))
        #   - لو مفيش توصيات → silent (no adjustment, no crash)
        # الجسر بيقرأ ExpertRecommendation من stocks.db (mode=ro).
        # أي خطأ يتم ابتلاعه صامتًا — ما يكسرش التحليل أبدًا.
        # ---------------------------------------------------------------------
        _expert_consensus: Optional[Dict[str, Any]] = None
        _expert_count: int = 0
        _expert_agreed: bool = False
        _expert_notes: List[str] = []
        try:
            _ec = compute_expert_consensus(ticker, signal, days=30)
            if _ec is not None and _ec.count > 0:
                # طبّق تعديل الثقة (مقصور بين 0 و 100)
                if _ec.score_adjustment != 0.0:
                    master_score = max(0.0, min(100.0, master_score + _ec.score_adjustment))
                # جهّز الـ dict للـ frontend
                _expert_consensus = {
                    "count": _ec.count,
                    "buy_count": _ec.buy_count,
                    "sell_count": _ec.sell_count,
                    "hold_count": _ec.hold_count,
                    "consensus_action": _ec.consensus_action,
                    "agreed": _ec.agreed,
                    "conflicted": _ec.conflicted,
                    "score_adjustment": round(_ec.score_adjustment, 2),
                }
                _expert_count = _ec.count
                _expert_agreed = _ec.agreed
                _expert_notes = list(_ec.notes)
                # Log ملخص لو فيه أي تعديل
                if _ec.score_adjustment != 0.0 or _ec.notes:
                    _adj_str = f"{'+' if _ec.score_adjustment >= 0 else ''}{_ec.score_adjustment:.0f}"
                    print(
                        f"[MasterAnalyzer] {ticker}: EXPERT-MEMORY → "
                        f"count={_ec.count} buy={_ec.buy_count} sell={_ec.sell_count} "
                        f"hold={_ec.hold_count} consensus={_ec.consensus_action} "
                        f"adj={_adj_str}"
                    )
        except Exception as _exp_e:
            # NEVER let expert memory break the analysis
            logger.debug(f"[EXPERT-MEMORY] {ticker} consensus error: {_exp_e}")

        # ═══════════════════════════════════════════════════════════════════
        # PHASE-5.1: HARD VETO SYSTEM (حق النفو) — Brain Tuning
        # ═══════════════════════════════════════════════════════════════════
        # المشكلة: العقل بيجمع النقاط (أساسيات 40 + فني 30 + حيتان 20 = 90
        # فيبقى شراء). ده بيخلي سهم ميت سيولة يطلع توصية شراء لأن أساسياته
        # حلوة! نظام الفيتو بدل المتوسط: 3 ممرات أمن صارمة.
        #
        # ممر السيولة: موجود بالفعل (REJECTED_LIQUIDITY عند turnover < 3M).
        # ممر الأساسيات: موجود بالفعل (REJECTED_FUNDAMENTALS عند score < 40).
        # ممر العائد/المخاطرة + ممر حالة السوق: بنطبقهم هنا كـ Hard Veto.
        # ---------------------------------------------------------------------
        _veto_reason = ''
        _veto_applied = False

        # ── ممر 2: حق النفو — العائد/المخاطرة (R/R Iron Veto) ──────────────
        # لو الـ R/R أقل من 1.5 → REJECTED_RR فوراً. مفيش أي حسابات تانية.
        # مستحيل الآلة توصي بصفقة الـ R/R بتاعها أقل من 1.5.
        try:
            _final_rr = float(risk_params.get('risk_reward', 0) or 0)
            if signal in ('BUY', 'STRONG_BUY') and _final_rr > 0 and _final_rr < 1.5:
                signal = 'REJECTED_RR'
                signal_ar = (
                    f'🚫 مرفوض — مخاطرة أكبر من الربح '
                    f'(R/R={_final_rr:.2f} < 1.5). الآلة مبتخاطرش بـ 100 عشان تربح {_final_rr*100:.0f}'
                )
                master_score = 0
                confidence = 0
                _veto_reason = f'REJECTED_RR (R/R={_final_rr:.2f} < 1.5)'
                _veto_applied = True
                logger.info(
                    f"[PHASE-5-VETO] {ticker}: R/R hard veto → REJECTED_RR "
                    f"(R/R={_final_rr:.2f}, was {signal})"
                )
        except Exception as _rr_veto_err:
            logger.debug(f"[PHASE-5-VETO] R/R veto error: {_rr_veto_err}")

        # ── ممر 3: حق النفو — حالة السوق (Macro Regime Veto) ───────────────
        # لو مؤشر EGX30 نازل 2% أو أكبر في اليوم → VETO على أي توصية BUY
        # جديدة. العقل ميسمحش بالشراء في سوق هابط.
        #
        # ════════════════════════════════════════════════════════════════════
        # P27-DIP-BUY: استثناء "الشراء الذكي وقت الهبوط" (Context-Aware Dip Buying)
        # ════════════════════════════════════════════════════════════════════
        # المحلل الخبير مبيعش من الخوف وقت الهبوط — بيشتري الأسهم اللي "نزلت
        # غصب عنها" مع السوق. قبل ما الـ Macro Veto يفرض الشرط، بنفحص:
        #   (أ) السهم في قاعه التاريخي (distance_from_low < 15%)
        #   (ب) السهم مش في قمته (distance_from_high > 10% — مش تصريف)
        #   (ج) فيه سيولة حقيقية (volume > 0 + turnover)
        #   (د) الحيتان بتتشرى (SMC Order Blocks bullish + _smc_layer_pts ≥ 10)
        #   (هـ) الأساسيات قوية (PE < 20 + ROE > 10) أو fundamental_score ≥ 65
        # لو كل الشروط اتحققت → نشيل الـ veto ونرقّي الإشارة لـ STRONG_BUY
        # مع سبب عربي واضح. ده بيحوّل المنصة من "آلة حاسبة" لـ "محلل خبير".
        # ---------------------------------------------------------------------
        _dip_buy_qualified = False
        _dip_buy_reason = ''
        # P28-STOCK-DIP: Per-stock dip trigger — مش بس EGX30
        # لو السهم نفسه نزل >= 3% اليوم → ده سهم في هبوط (حتى لو EGX30 مش نازل).
        # بيحل مشكلة إن EGX30 مش بيتحدث فيستار الوقت والـ dip buying ميتفعلش.
        _change_1d_pct = 0.0
        try:
            if prices and len(prices) >= 2 and prices[-2] and prices[-2] > 0:
                _change_1d_pct = (prices[-1] - prices[-2]) / prices[-2] * 100
            elif stock_data and stock_data.get('change_percent') is not None:
                _change_1d_pct = float(stock_data.get('change_percent', 0) or 0)
        except Exception:
            pass
        _stock_dropped = _change_1d_pct <= -3.0
        _market_dropped = _macro_regime == 'BEARISH'
        _dip_trigger = _stock_dropped or _market_dropped
        if _dip_trigger and signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'HOLD'):
            try:
                # (أ)+(ب) المسافة من القمة/القاع التاريخي من الـ history
                _dip_high = max(prices) if prices and len(prices) > 0 else 0
                _dip_low = min(prices) if prices and len(prices) > 0 else 0
                _dip_current = prices[-1] if prices and len(prices) > 0 else 0
                _dist_from_high_pct = (
                    abs(_dip_high - _dip_current) / _dip_high * 100
                    if _dip_high > 0 else 100
                )
                _dist_from_low_pct = (
                    abs(_dip_current - _dip_low) / _dip_low * 100
                    if _dip_low > 0 else 100
                )
                # في القاع التاريخي: السعر قريب من أقل قيمة (أو أقل بـ <15%)
                _near_low = _dist_from_low_pct < 15
                # مش في القمة: بعيد عن أعلى قيمة بأكتر من 10%
                _not_near_high = _dist_from_high_pct > 10

                # (ج) السيولة — لو volumes فاضية، استخدم history
                _dip_volume = 0
                if volumes and len(volumes) > 0:
                    _dip_volume = float(volumes[-1] or 0)
                elif history and len(history) > 0:
                    try:
                        _dip_volume = _parse_volume_float(history[-1].get('volume', 0))
                    except Exception:
                        pass

                # (د) الحيتان — SMC OB + score
                _has_bullish_ob = False
                try:
                    for _ob in (_smc_ob_zones or []):
                        if _ob.get('type') == 'bullish_ob':
                            _has_bullish_ob = True
                            break
                except Exception:
                    pass
                _smc_strong = float(_smc_layer_pts or 0) >= 10

                # (هـ) الأساسيات
                _dip_pe = 0.0
                _dip_roe = 0.0
                try:
                    _dip_pe = float(stock_data.get('pe_ratio', 0) or 0)
                    _dip_roe = float(stock_data.get('roe', 0) or 0)
                except Exception:
                    pass
                _fund_strong = (
                    (_dip_pe > 0 and _dip_pe < 20 and _dip_roe > 10)
                    or float(fundamental_score or 0) >= 65
                )

                # P28-FAST-PATH: السهم نزل 3%+ وهو في قاعه التاريخي → STRONG_BUY فوراً
                # المسار الأساسي: drop + at_low = فرصة شراء ذكية (مش محتاج كل الـ 5 شروط).
                # ده المنطق اللي طلبه اليوزر: السهم نزل مع السوق بدون سبب أساسي.
                if _stock_dropped and _near_low:
                    _dip_buy_qualified = True
                    _dip_buy_reason = (
                        f'🔥 شراء ذكي وقت الهبوط: السهم نزل {_change_1d_pct:.1f}% اليوم '
                        f'وهو في قاعه التاريخي (بُعد عن القاع {_dist_from_low_pct:.1f}%). '
                        f'النزول ده مع السوق بدون سبب أساسي — فرصة شراء ذكية.'
                    )
                    logger.info(
                        f"[P28-STOCK-DIP] {ticker}: FAST-PATH QUALIFIED — change_1d={_change_1d_pct:.1f}% "
                        f"dist_low={_dist_from_low_pct:.1f}% (stock dropped + at historical low)"
                    )

                # القرار النهائي — كل الشروط لازم تتحقق مع بعض (premium path)
                if _near_low and _not_near_high and _dip_volume > 0 and _has_bullish_ob and _smc_strong and _fund_strong:
                    _dip_buy_qualified = True
                    _dip_buy_reason = (
                        f'🔥 شراء ذكي وقت الهبوط: السهم نزل مع السوق (EGX30) '
                        f'بس في قاعه التاريخي (بُعد عن القاع {_dist_from_low_pct:.1f}%)، '
                        f'الحيتان بتدخل (OB bullish + SMC {_smc_layer_pts:.0f})، '
                        f'والأساسيات قوية (PE={_dip_pe:.1f}, ROE={_dip_roe:.1f}%). '
                        f'السيولة محققة (vol={_dip_volume:,.0f}).'
                    )
                    logger.info(
                        f"[P27-DIP-BUY] {ticker}: QUALIFIED — dist_low={_dist_from_low_pct:.1f}% "
                        f"dist_high={_dist_from_high_pct:.1f}% vol={_dip_volume:.0f} "
                        f"OB={_has_bullish_ob} SMC={_smc_layer_pts:.0f} PE={_dip_pe:.1f} ROE={_dip_roe:.1f}"
                    )
            except Exception as _dip_err:
                logger.debug(f"[P27-DIP-BUY] {ticker}: evaluation error: {_dip_err}")

        # لو الـ Dip Buy اشتغل → نشيل الـ veto المرتّب ونرقّي الإشارة
        if _dip_buy_qualified:
            signal = 'STRONG_BUY'
            signal_ar = _dip_buy_reason
            master_score = max(master_score, 85)  # P28: ارفع الـ score إجباري لـ 85
            confidence = max(confidence, 75)
            _veto_reason = ''  # امسح أي veto سابق
            _veto_applied = False
            # سجّل في risk_profile للواجهة
            try:
                if risk_dict is not None:
                    risk_dict['dip_buy_qualified'] = True
                    risk_dict['dip_buy_reason'] = _dip_buy_reason
                    risk_dict['veto_applied'] = False
            except Exception:
                pass
            logger.info(f"[P27-DIP-BUY] {ticker}: upgraded to STRONG_BUY (smart dip buy)")

        if not _veto_applied and not _dip_buy_qualified and signal in ('BUY', 'STRONG_BUY') and _macro_regime == 'BEARISH':
            signal = 'REJECTED_MACRO'
            signal_ar = (
                '🚫 مرفوض — السوق هابط (EGX30 نازل 2%+ اليوم). '
                'ممنوع الشراء في سوق منهار — استنى الاستقرار'
            )
            master_score = 0
            confidence = 0
            _veto_reason = 'REJECTED_MACRO (EGX30 down >= 2% today)'
            _veto_applied = True
            logger.info(
                f"[PHASE-5-VETO] {ticker}: Macro hard veto → REJECTED_MACRO "
                f"(EGX30 bearish, regime={_macro_regime})"
            )

        # سجّل سبب الفيتو في risk_profile للواجهة عشان العميل يشوف ليه اترفض
        if _veto_applied:
            try:
                if risk_dict is not None:
                    risk_dict['veto_reason'] = _veto_reason
                    risk_dict['veto_applied'] = True
            except Exception:
                pass

        # ═══════════════════════════════════════════════════════════════════════
        # DYNAMIC-SYSTEM-001: Post-Processing ديناميكي (Admin-configurable)
        # ═══════════════════════════════════════════════════════════════════════
        # 1. عتبة الشراء الديناميكية: لو master_score < dynamic_buy_threshold
        #    والحالة مش BEARISH veto، ن downgrade الإشارة لـ ACCUMULATE أو HOLD.
        # 2. عقاب السيولة الديناميكية: لو turnover_ratio < 0.5، ننقص درجات.
        # 3. مكافأة الزخم الديناميكية: لو volume_ratio >= 1.5، نزود درجات.
        # 4. close-confirmation: لو use_close_confirmation=1، نعاقب الطلوع العمودي.
        # كل القيم دي admin-configurable via /api/admin/engine-settings.
        try:
            if _DYNAMIC_AVAILABLE and signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'HOLD'):
                _ctx = get_dynamic_context(ticker)
                _regime = _ctx.market_regime if _ctx else 'range'
                _dyn_buy_thresh = get_dynamic_buy_threshold(_regime)
                _accumulate_thresh = get_setting('accumulate_threshold', default=50)
                _hold_thresh = get_setting('hold_threshold', default=35)

                # 1. عقاب السيولة الديناميكية
                if _ctx and _ctx.has_history:
                    _liq_pen = get_liquidity_penalty(ticker)
                    if _liq_pen < 0:
                        master_score = max(0, master_score + _liq_pen)
                        logger.debug(f"[DYNAMIC] {ticker}: liquidity penalty {_liq_pen} → score={master_score:.1f}")

                # 2. مكافأة الزخم الديناميكية
                if _ctx and _ctx.has_history:
                    _vol_bonus = get_volume_surge_bonus(ticker)
                    if _vol_bonus > 0:
                        master_score = min(100, master_score + _vol_bonus)
                        logger.debug(f"[DYNAMIC] {ticker}: volume surge bonus +{_vol_bonus} → score={master_score:.1f}")

                # 3. close-confirmation: عاقب الطلوع العمودي (انت هتلقاه في القمة)
                _use_close_conf = get_setting('use_close_confirmation', default=1)
                if _use_close_conf >= 1 and _ctx and _ctx.has_history:
                    _vertical_penalty = get_setting('vertical_spike_penalty', default=8)
                    _pullback_bonus = get_setting('pullback_bonus', default=5)
                    # لو volume_ratio >= 2.5 AND price change كبير → طلوع عمودي
                    if _ctx.volume_ratio >= 2.5:
                        master_score = max(0, master_score - _vertical_penalty)
                        logger.debug(f"[DYNAMIC] {ticker}: vertical spike penalty -{_vertical_penalty} → score={master_score:.1f}")
                    # لو السهم بيعمل pullback (volume_ratio < 1.0 بس trend up) → مكافأة
                    elif _ctx.volume_ratio < 1.0 and _ctx.trend_direction == 'up':
                        master_score = min(100, master_score + _pullback_bonus)
                        logger.debug(f"[DYNAMIC] {ticker}: pullback bonus +{_pullback_bonus} → score={master_score:.1f}")

                # 4. عتبة الشراء الديناميكية
                if signal in ('BUY', 'STRONG_BUY') and master_score < _dyn_buy_thresh:
                    if master_score >= _accumulate_thresh:
                        signal = 'ACCUMULATE'
                        signal_ar = '📊 تجميع — السهم كويس بس الدرجة تحت عتبة الشراء الديناميكية'
                        logger.info(f"[DYNAMIC] {ticker}: BUY→ACCUMULATE (score {master_score:.1f} < dynamic threshold {_dyn_buy_thresh:.1f}, regime={_regime})")
                    elif master_score >= _hold_thresh:
                        signal = 'HOLD'
                        signal_ar = '⏳ احتفاظ — استنى تحسن الدرجة'
                        logger.info(f"[DYNAMIC] {ticker}: BUY→HOLD (score {master_score:.1f} < accumulate threshold {_accumulate_thresh:.1f})")
        except Exception as _dyn_err:
            logger.debug(f"[DYNAMIC] post-processing failed for {ticker}: {_dyn_err}")

        # ═══════════════════════════════════════════════════════════════════
        # V39.2: CBE NEWS GUARD — Hard Veto لما فيه خبر بنك مركزي
        # ═══════════════════════════════════════════════════════════════════
        # لو فيه خبر بنك مركزي (CBE) في آخر 24 ساعة:
        #   - إشارات الشراء الجديدة → HOLD (max_position=0)
        #   - حجم المركز → 0% (لا إضافة)
        #   - إشارات البيع → تبقى (لحماية رأس المال)
        _cbe_news_veto = False
        try:
            _news_db_path = str(Path(__file__).resolve().parent.parent / 'db' / 'news.db')
            if os.path.exists(_news_db_path):
                from analyzers.news_stop_filter import has_recent_cbe_news
                _cbe_news_veto = has_recent_cbe_news(_news_db_path, days_back=1)
                if _cbe_news_veto and signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE'):
                    _original_signal = signal
                    signal = 'HOLD'
                    signal_ar = '⚠️ قرار بنك مركزي قريب — إشارات الشراء معطلة (CBE News Guard)'
                    _suggested_position_size = 0.0  # Hard veto — max_position=0
                    master_score = min(master_score, 40)  # Cap score
                    logger.info(f"[CBE-GUARD] {ticker}: {_original_signal}→HOLD (CBE news within 24h, position_size=0%)")
        except Exception as _cbe_err:
            logger.debug(f"[CBE-GUARD] News check failed for {ticker}: {_cbe_err}")

        # ═══════════════════════════════════════════════════════════════════
        # DATA VALIDATION LAYER (Task 21-B, 2026-10-03)
        # Per owner directive: "اعمل Data Validation Layer مركزية"
        # Per Rule 24: no fake data — INVALID > fake
        # This runs BEFORE the final return to catch any impossible values.
        # If a field is INVALID → it's set to None (not used in score/recommendation).
        # ═══════════════════════════════════════════════════════════════════
        try:
            from data.validation import validate_stock_data, get_validated_value
            _vd = validate_stock_data(
                ticker=ticker,
                current_price=current_price if current_price > 0 else None,
                high_52w=getattr(tech_indicators, 'high_52w', None) if tech_indicators else None,
                low_52w=getattr(tech_indicators, 'low_52w', None) if tech_indicators else None,
                support=getattr(tech_indicators, 'support_level', None) if tech_indicators else None,
                resistance=getattr(tech_indicators, 'resistance_level', None) if tech_indicators else None,
                ma50=getattr(tech_indicators, 'sma50', None) if tech_indicators else None,
                ma200=getattr(tech_indicators, 'sma200', None) if tech_indicators else None,
                rsi=getattr(tech_indicators, 'rsi', None) if tech_indicators else None,
            )
            # If critical fields are INVALID → nullify them (don't pass garbage downstream)
            if not _vd.is_field_valid('support') and tech_indicators:
                tech_indicators.support_level = None
                logger.warning(f"[VALIDATION] {ticker}: support INVALID → nullified")
            if not _vd.is_field_valid('resistance') and tech_indicators:
                tech_indicators.resistance_level = None
                logger.warning(f"[VALIDATION] {ticker}: resistance INVALID → nullified")
            if not _vd.is_field_valid('high_52w') and tech_indicators:
                if hasattr(tech_indicators, 'high_52w'):
                    tech_indicators.high_52w = None
                logger.warning(f"[VALIDATION] {ticker}: high_52w INVALID (stale) → nullified")
            if not _vd.is_field_valid('low_52w') and tech_indicators:
                if hasattr(tech_indicators, 'low_52w'):
                    tech_indicators.low_52w = None
                logger.warning(f"[VALIDATION] {ticker}: low_52w INVALID → nullified")
            # If current_price itself is INVALID → skip this stock entirely
            if not _vd.is_field_valid('current_price'):
                logger.error(f"[VALIDATION] {ticker}: current_price INVALID — skipping analysis")
                return MasterAnalysis(
                    ticker=ticker,
                    signal='HOLD',
                    signal_ar='تجنب — بيانات غير موثوقة',
                    confidence=0,
                    master_score=0,
                    market=stock_market,
                    name=stock_name,
                    technical_score=0,
                    fundamental_score=0,
                    timing_score=0,
                    pattern_score=0,
                    market_regime_score=0,
                    liquidity_level='UNKNOWN',
                    is_tradeable=False,
                    liquidity_warning='البيانات غير موثوقة — تم رفض التحليل',
                    session_phase='',
                    risk_profile={},
                    technical_summary='تم رفض التحليل بسبب بيانات غير صحيحة',
                    fundamental_summary='',
                    timestamp=timestamp,
                    volatility_20d=0,
                    market_regime_ar='',
                    market_regime_strength=0,
                    sector_relative_score=0,
                    pulse_regime='',
                    pulse_breadth='',
                    pulse_risk='',
                    pulse_timestamp='',
                    conviction_score=0,
                    conviction_level='',
                    conviction_level_ar='',
                    conviction_action='',
                    conviction_position_size=0,
                    conviction_narrative='',
                    news_sentiment_score=0,
                    screener_tags='',
                    macd_score=0,
                    candlestick_score=0,
                    fibonacci_score=0,
                    smc_score=0,
                    candlestick_patterns='',
                    fibonacci_levels='',
                )
        except ImportError:
            logger.debug("[VALIDATION] data.validation module not available — skipping")
        except Exception as _vd_err:
            logger.warning(f"[VALIDATION] {ticker}: validation error: {_vd_err}")

        return MasterAnalysis(
            ticker=ticker,
            signal=signal,
            signal_ar=signal_ar,
            confidence=confidence,
            master_score=round(master_score, 2),
            market=stock_market,
            name=stock_name,
            technical_score=round(technical_score, 2),
            fundamental_score=round(fundamental_score, 2),
            timing_score=round(timing_score, 2),
            pattern_score=round(ai_pattern_score, 2),  # Phase 3: AI Pattern Score
            market_regime_score=round(market_regime_score, 2),
            liquidity_level=liquidity_profile.level.value,
            is_tradeable=True,
            liquidity_warning=None,
            session_phase=session.phase_name_ar,
            risk_profile=risk_dict,
            technical_summary=technical_summary,
            fundamental_summary=fundamental_summary,
            timestamp=timestamp,
            volatility_20d=self._calculate_volatility(prices),
            market_regime_ar=market_regime_label,
            market_regime_strength=market_regime_strength,
            sector_relative_score=round(sector_relative_score, 2),
            pulse_regime=pulse_regime,
            pulse_breadth=pulse_breadth,
            pulse_risk=pulse_risk,
            pulse_timestamp=effective_pulse.get('timestamp', '') if effective_pulse else '',
            conviction_score=conviction.score if conviction else 0.0,
            conviction_level=conviction.level if conviction else '',
            conviction_level_ar=conviction.level_ar if conviction else '',
            conviction_action=conviction.action if conviction else '',
            conviction_position_size=conviction.position_size_pct if conviction else 0.0,
            conviction_narrative=conviction.narrative if conviction else '',
            news_sentiment_score=sentiment_score,
            screener_tags=screener,
            # MAESTRO-UNIFY-015: 8-layer confluence fields
            macd_score=round(_macd_layer_pts, 2),
            candlestick_score=round(_candle_layer_pts, 2),
            fibonacci_score=round(_fib_layer_pts, 2),
            smc_score=round(_smc_layer_pts, 2),
            candlestick_patterns=_candle_patterns_val,
            fibonacci_levels=_fib_levels_val,
            confluence_score=round(confluence_score, 2),
            confluence_breakdown=confluence_breakdown,
            confluence_signal=_confluence_signal,
            # BRIEF-045: SMC zones + macro regime
            smc_zones=_smc_zones_for_chart,
            macro_regime=_macro_regime,
            ob_stop_method=risk_params.get('stop_method', ''),
            # BRIEF-046: MTF + Position Sizing + POC
            mtf_tag=_mtf_tag,
            mtf_weekly_trend=_mtf_weekly_trend,
            suggested_position_size=_suggested_position_size,
            cbe_news_veto=_cbe_news_veto,  # V39.2: CBE News Guard
            poc_price=_poc_price,
            poc_tag=_poc_tag,
            # PHASE 8: Quant Engine
            quant_z_score=_quant_z_score,
            quant_vsa_absorption=_quant_vsa,
            quant_ttm_squeeze=_quant_squeeze,
            quant_score=_quant_score,
            # PHASE 11: V20 Ultimate Fusion Engine (LuxAlgo + BigBeluga + SMC)
            fusion_metrics=_fusion_metrics,
            # QUANT-OVERDRIVE-028: Smart Money Flow Index + Monte Carlo Probability
            # SMFI: -100% (بيع) إلى +100% (شراء). > 60% = حيتان بتجمع (+25pts).
            # Monte Carlo: احتمالية وصول الهدف خلال 5 أيام (0-100%).
            smfi=_smfi_val,
            smfi_label=_smfi_label_val,
            monte_carlo_prob=_mc_prob_val,
            monte_carlo_label=_mc_label_val,
            monte_carlo_horizon=_mc_horizon_val,
            quant_overdrive_notes=_quant_od_notes,
            # EXPERT-MEMORY-032: توصيات الخبراء تعدّل ثقة الآلة
            # لو مفيش توصيات → expert_count=0, expert_consensus=None, expert_notes=[] (silent)
            expert_consensus=_expert_consensus,
            expert_count=_expert_count,
            expert_agreed=_expert_agreed,
            expert_notes=_expert_notes,
        )
    
    def _get_price_data(self, ticker: str) -> Tuple[List[float], List[float]]:
        """Get price and volume data from database (merged daily + real-time intraday)."""
        try:
            # Load merged daily and real-time history
            history = load_merged_history(ticker, self.db_path)
            if not history:
                return [], []
                
            raw_prices = [h['close'] for h in history]
            volumes = [h['volume'] for h in history]
            
            if len(raw_prices) >= 20:
                return raw_prices, volumes
                
            print(f"[MasterAnalyzer] {ticker}: Insufficient price history ({len(raw_prices)} points)")
            return raw_prices, volumes
            
        except Exception as e:
            print(f"[MasterAnalyzer] Error getting price data for {ticker}: {e}")
            return [], []

    def _get_full_price_data(self, ticker: str) -> Tuple[List[float], List[float], List[float], List[float]]:
        """Get close, high, low, and volume data from database (merged daily + real-time intraday)."""
        try:
            # Load merged daily and real-time history
            history = load_merged_history(ticker, self.db_path)
            if not history:
                return [], [], [], []
                
            raw_prices = [h['close'] for h in history]
            raw_highs = [h['high'] for h in history]
            raw_lows = [h['low'] for h in history]
            volumes = [h['volume'] for h in history]
            
            if len(raw_prices) >= 20:
                return raw_prices, raw_highs, raw_lows, volumes
                
            print(f"[MasterAnalyzer] {ticker}: Insufficient price history ({len(raw_prices)} points)")
            return raw_prices, raw_highs, raw_lows, volumes
            
        except Exception as e:
            print(f"[MasterAnalyzer] Error getting full price data for {ticker}: {e}")
            return [], [], [], []
    
    # =====================================================================
    # MAESTRO-UNIFY-015: 8-LAYER CONFLUENCE (chart_routes parity)
    # ---------------------------------------------------------------------
    # نفس منطق chart_full_analysis في chart_routes.py — يحسب 8 layers بـ max ~135 pts.
    # Self-contained — لو tech_indicators مش متاح (LIMITED_DATA path)، بيحسب
    # RSI و Bollinger inline من prices.
    # =====================================================================

    @staticmethod
    def _inline_rsi(closes, period=14):
        """Simple Wilder's RSI for inline use (no tech_indicators needed)."""
        if not closes or len(closes) < period + 1:
            return 50.0
        gains = []
        losses = []
        for i in range(1, len(closes)):
            change = closes[i] - closes[i - 1]
            gains.append(max(0, change))
            losses.append(max(0, -change))
        if len(gains) < period:
            return 50.0
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period
        for i in range(period, len(gains)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return round(100.0 - (100.0 / (1.0 + rs)), 2)

    @staticmethod
    def _inline_bollinger(closes, period=20, mult=2.0):
        """Simple Bollinger Bands — returns (lower, middle, upper) for the last point."""
        if not closes or len(closes) < period:
            return None, None, None
        window = closes[-period:]
        mean = sum(window) / period
        variance = sum((x - mean) ** 2 for x in window) / period
        std = math.sqrt(variance)
        return round(mean - mult * std, 4), round(mean, 4), round(mean + mult * std, 4)

    def _compute_8_layer_confluence(self, ticker: str, prices: List[float],
                                     highs: List[float], lows: List[float],
                                     volumes: List[float], opens: List[float],
                                     tech_indicators=None,
                                     ohlcv: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Compute the 8-layer confluence score (chart_routes parity).

        Returns dict with keys: confluence_score, confluence_breakdown,
        macd_score, candlestick_score, fibonacci_score, candlestick_patterns,
        fibonacci_levels, confluence_signal.

        Self-contained — falls back to inline RSI/Bollinger when tech_indicators
        is None or doesn't expose the needed attributes (LIMITED_DATA path).
        """
        out = {
            'confluence_score': 0.0,
            'confluence_breakdown': {},
            'macd_score': 0.0,
            'candlestick_score': 0.0,
            'fibonacci_score': 0.0,
            'smc_score': 0.0,
            'candlestick_patterns': [],
            'fibonacci_levels': {},
            'confluence_signal': '',
        }
        try:
            closes_arr = list(prices) if prices else []
            highs_arr = list(highs) if highs else closes_arr
            lows_arr = list(lows) if lows else closes_arr
            vols_arr = list(volumes) if volumes else []
            opens_arr = list(opens) if opens else []
            if ohlcv is None and closes_arr:
                ohlcv = []
                for idx in range(len(closes_arr)):
                    ohlcv.append({
                        'date': idx,
                        'open': opens_arr[idx] if idx < len(opens_arr) else closes_arr[idx],
                        'high': highs_arr[idx] if idx < len(highs_arr) else closes_arr[idx],
                        'low': lows_arr[idx] if idx < len(lows_arr) else closes_arr[idx],
                        'close': closes_arr[idx],
                        'volume': vols_arr[idx] if idx < len(vols_arr) else 0,
                    })
            cp_8l = closes_arr[-1] if closes_arr else 0.0
            confluence_score = 0.0
            confluence_breakdown = {}

            # ── Layer 1: Macro Trend (25 pts) ──
            macro_regime_8l = self.market_regime_info.get('regime', 'unknown')
            if macro_regime_8l == 'bull_trend':
                _macro_pts = 25
                _macro_detail = f'السوق صعودي (ثقة {self.market_regime_info.get("confidence", 0):.0f}%)'
            elif macro_regime_8l == 'ranging':
                _macro_pts = 10
                _macro_detail = 'السوق عرضي - محايد'
            elif macro_regime_8l == 'bear_trend':
                _macro_pts = 0
                _macro_detail = f'السوق هبوطي (ثقة {self.market_regime_info.get("confidence", 0):.0f}%)'
            else:
                _macro_pts = 12
                _macro_detail = 'نظام غير محدد'
            confluence_score += _macro_pts
            confluence_breakdown['macro_trend'] = {
                'passed': _macro_pts >= 15, 'points': _macro_pts, 'max': 25,
                'detail': _macro_detail, 'regime': macro_regime_8l,
            }

            # ── Layer 2: Price vs SMA50 (15 pts) ──
            if len(closes_arr) >= 50:
                _sma50_8l = sum(closes_arr[-50:]) / 50.0
                if cp_8l > _sma50_8l:
                    _sma50_pts = 15
                    _sma50_detail = f'السعر ({cp_8l:.2f}) > SMA50 ({_sma50_8l:.2f})'
                else:
                    _sma50_pts = 3
                    _sma50_detail = f'السعر ({cp_8l:.2f}) < SMA50 ({_sma50_8l:.2f})'
            else:
                _sma50_pts = 5
                _sma50_detail = f'بيانات غير كافية لـ SMA50 ({len(closes_arr)} شمعة)'
            confluence_score += _sma50_pts
            confluence_breakdown['price_vs_sma50'] = {
                'passed': _sma50_pts >= 10, 'points': _sma50_pts, 'max': 15,
                'detail': _sma50_detail,
            }

            # ── Layer 3: RSI (20 pts) ──
            # Prefer tech_indicators.rsi; fall back to inline RSI when missing.
            _rsi_8l = None
            if tech_indicators is not None:
                _rsi_8l = getattr(tech_indicators, 'rsi', None)
            if _rsi_8l is None:
                _rsi_8l = self._inline_rsi(closes_arr, 14)
            _rsi_8l = float(_rsi_8l or 50.0)
            if 40 <= _rsi_8l <= 65:
                _rsi_pts = 20
                _rsi_detail = f'RSI = {_rsi_8l:.1f} (منطقة مثالية)'
            elif 30 <= _rsi_8l < 40:
                _rsi_pts = 15
                _rsi_detail = f'RSI = {_rsi_8l:.1f} (قرب التشبع البيعي)'
            elif 65 < _rsi_8l <= 75:
                _rsi_pts = 10
                _rsi_detail = f'RSI = {_rsi_8l:.1f} (قرب التشبع الشرائي)'
            elif _rsi_8l < 30:
                _rsi_pts = 12
                _rsi_detail = f'RSI = {_rsi_8l:.1f} (تشبع بيعي - فرصة ارتداد)'
            else:
                _rsi_pts = 3
                _rsi_detail = f'RSI = {_rsi_8l:.1f} (تشبع شرائي شديد)'
            confluence_score += _rsi_pts
            confluence_breakdown['rsi'] = {
                'passed': _rsi_pts >= 15, 'points': _rsi_pts, 'max': 20,
                'detail': _rsi_detail, 'value': round(_rsi_8l, 2),
            }

            # ── Layer 4: Volume (20 pts) ──
            _avg_vol_8l = sum(vols_arr[-20:]) / min(20, len(vols_arr)) if vols_arr else 0
            _recent_vol_8l = sum(vols_arr[-5:]) / min(5, len(vols_arr)) if vols_arr else 0
            _vol_ratio_8l = _recent_vol_8l / _avg_vol_8l if _avg_vol_8l > 0 else 1.0
            if _vol_ratio_8l >= 1.3:
                _vol_pts = 20
                _vol_detail = f'حجم مرتفع ({_vol_ratio_8l:.1f}x المتوسط)'
            elif _vol_ratio_8l >= 1.0:
                _vol_pts = 14
                _vol_detail = f'حجم طبيعي ({_vol_ratio_8l:.1f}x المتوسط)'
            else:
                _vol_pts = 6
                _vol_detail = f'حجم منخفض ({_vol_ratio_8l:.1f}x المتوسط)'
            confluence_score += _vol_pts
            confluence_breakdown['volume'] = {
                'passed': _vol_pts >= 14, 'points': _vol_pts, 'max': 20,
                'detail': _vol_detail, 'ratio': round(_vol_ratio_8l, 2),
            }

            # ── Layer 5: Bollinger (20 pts) ──
            # Prefer tech_indicators.bb_lower/bb_upper; fall back to inline calc.
            _bb_l_8l = getattr(tech_indicators, 'bb_lower', None) if tech_indicators is not None else None
            _bb_u_8l = getattr(tech_indicators, 'bb_upper', None) if tech_indicators is not None else None
            if _bb_l_8l is None or _bb_u_8l is None:
                _bb_l_8l, _bb_m_8l, _bb_u_8l = self._inline_bollinger(closes_arr, 20, 2.0)
            if _bb_l_8l is not None and _bb_u_8l is not None:
                _bb_range_8l = _bb_u_8l - _bb_l_8l
                if _bb_range_8l > 0 and cp_8l > 0:
                    _bb_pos_8l = (cp_8l - _bb_l_8l) / _bb_range_8l
                    if 0.2 <= _bb_pos_8l <= 0.5:
                        _bb_pts = 20
                        _bb_detail = f'قرب الباند السفلي (فرصة شراء) - {_bb_pos_8l:.0%}'
                    elif 0.5 < _bb_pos_8l <= 0.7:
                        _bb_pts = 12
                        _bb_detail = f'في النصف العلوي - {_bb_pos_8l:.0%}'
                    elif _bb_pos_8l > 0.7:
                        _bb_pts = 5
                        _bb_detail = f'قرب الباند العلوي (خطر) - {_bb_pos_8l:.0%}'
                    else:
                        _bb_pts = 15
                        _bb_detail = f'أسفل الباند السفلي (تشبع بيعي) - {_bb_pos_8l:.0%}'
                else:
                    _bb_pts = 10
                    _bb_detail = 'لا يمكن حساب موقع البولنجر'
            else:
                _bb_pts = 10
                _bb_detail = 'بيانات Bollinger غير كافية'
            confluence_score += _bb_pts
            confluence_breakdown['bollinger'] = {
                'passed': _bb_pts >= 15, 'points': _bb_pts, 'max': 20,
                'detail': _bb_detail,
            }

            # ── Build OHLCV tail for candlestick detection (last 3 candles) ──
            _ohlcv_tail_8l = []
            _tail_len_8l = min(len(closes_arr), 3)
            for _i in range(len(closes_arr) - _tail_len_8l, len(closes_arr)):
                if closes_arr[_i] > 0:
                    _o_i = opens_arr[_i] if _i < len(opens_arr) and opens_arr[_i] > 0 else closes_arr[_i]
                    _h_i = highs_arr[_i] if _i < len(highs_arr) and highs_arr[_i] > 0 else closes_arr[_i]
                    _l_i = lows_arr[_i] if _i < len(lows_arr) and lows_arr[_i] > 0 else closes_arr[_i]
                    _ohlcv_tail_8l.append({
                        'open': _o_i, 'high': _h_i,
                        'low': _l_i, 'close': closes_arr[_i],
                    })

            # ── Layer 6: MACD (15 pts) — مع فلتر volume لتأكيد التقاطع ──
            # BACKTEST-ENHANCE-014: لو volume_ratio < 1.0، نقصّل النقاط (يمنع false crossovers مثل ABUK)
            _macd_line_arr, _macd_signal_arr, _macd_hist_arr = _calc_macd(closes_arr, 12, 26, 9)
            _last_macd_hist = _macd_hist_arr[-1] if _macd_hist_arr else None
            _last_macd_line = _macd_line_arr[-1] if _macd_line_arr else None
            _last_macd_sig = _macd_signal_arr[-1] if _macd_signal_arr else None
            if _last_macd_hist is not None and _last_macd_line is not None and _last_macd_sig is not None:
                _vol_confirmed_8l = _vol_ratio_8l >= 1.0
                if _last_macd_hist > 0 and _last_macd_line > _last_macd_sig:
                    if _vol_confirmed_8l:
                        _macd_pts = 15
                        _macd_detail = f'MACD صعودي مؤكد (hist={_last_macd_hist:.4f}, vol={_vol_ratio_8l:.1f}x)'
                    else:
                        _macd_pts = 8
                        _macd_detail = f'MACD صعودي ضعيف الإشارة (vol={_vol_ratio_8l:.1f}x < 1.0x)'
                elif _last_macd_hist > 0:
                    _macd_pts = 6
                    _macd_detail = f'MACD يتعافى (hist={_last_macd_hist:.4f})'
                elif _last_macd_hist < 0 and _last_macd_line < _last_macd_sig:
                    _macd_pts = 0
                    _macd_detail = f'MACD هبوطي (hist={_last_macd_hist:.4f})'
                else:
                    _macd_pts = 4
                    _macd_detail = f'MACD يتعافى من هبوط (hist={_last_macd_hist:.4f})'
            else:
                _macd_pts = 5
                _macd_detail = 'MACD غير محسوب (بيانات غير كافية)'
            _macd_layer_pts = float(_macd_pts)
            confluence_score += _macd_pts
            confluence_breakdown['macd'] = {
                'passed': _macd_pts >= 10, 'points': _macd_pts, 'max': 15,
                'detail': _macd_detail,
                'hist': round(_last_macd_hist, 6) if _last_macd_hist is not None else None,
                'line': round(_last_macd_line, 6) if _last_macd_line is not None else None,
                'signal': round(_last_macd_sig, 6) if _last_macd_sig is not None else None,
            }

            # ── Layer 7: Candlestick Patterns (10 pts) ──
            _candle_patterns_val = _detect_candlestick_patterns(_ohlcv_tail_8l) if _ohlcv_tail_8l else []
            if _candle_patterns_val:
                _best_pattern_8l = None
                for p in _candle_patterns_val:
                    if p.get('signal') == 'bullish' and p.get('strength') == 'strong':
                        _best_pattern_8l = p
                        break
                    elif p.get('signal') == 'bullish' and p.get('strength') == 'medium':
                        if not _best_pattern_8l or _best_pattern_8l.get('strength') != 'strong':
                            _best_pattern_8l = p
                    elif p.get('signal') == 'neutral' and not _best_pattern_8l:
                        _best_pattern_8l = p
                    elif p.get('signal') == 'bearish' and not _best_pattern_8l:
                        _best_pattern_8l = p
                if _best_pattern_8l:
                    if _best_pattern_8l.get('signal') == 'bullish':
                        _candle_pts = 10 if _best_pattern_8l.get('strength') == 'strong' else 7
                        _candle_detail = f'نمط صعودي: {_best_pattern_8l.get("name_ar", _best_pattern_8l.get("name"))}'
                    elif _best_pattern_8l.get('signal') == 'neutral':
                        _candle_pts = 3
                        _candle_detail = f'نمط محايد: {_best_pattern_8l.get("name_ar", _best_pattern_8l.get("name"))}'
                    else:
                        _candle_pts = 0
                        _candle_detail = f'نمط هبوطي: {_best_pattern_8l.get("name_ar", _best_pattern_8l.get("name"))}'
                else:
                    _candle_pts = 3
                    _candle_detail = 'لا يوجد نمط واضح'
            else:
                _candle_pts = 3
                _candle_detail = 'لا يوجد نمط شموع واضح'
            _candle_layer_pts = float(_candle_pts)
            confluence_score += _candle_pts
            confluence_breakdown['candlestick'] = {
                'passed': _candle_pts >= 7, 'points': _candle_pts, 'max': 10,
                'detail': _candle_detail,
                'patterns': _candle_patterns_val,
            }

            # ── Layer 8: Fibonacci Confluence (10 pts) ──
            _fib_levels_val = _calc_fibonacci_levels(closes_arr, highs_arr, lows_arr, lookback=30) or {}
            _fib_618_8l = _fib_levels_val.get('61.8%')
            if _fib_618_8l and cp_8l > 0:
                _dist_pct_8l = abs(cp_8l - _fib_618_8l) / cp_8l * 100
                if _dist_pct_8l < 2.0:
                    _fib_pts = 10
                    _fib_detail = f'السعر قرب 61.8% فيبوناتشي ({_fib_618_8l:.2f}) — دعم قوي'
                elif _dist_pct_8l < 5.0:
                    _fib_pts = 5
                    _fib_detail = f'السعر قرب 61.8% فيبوناتشي ({_fib_618_8l:.2f}) — دعم متوسط'
                else:
                    _fib_pts = 2
                    _fib_detail = f'السعر بعيد عن 61.8% فيبوناتشي ({_fib_618_8l:.2f})'
            else:
                _fib_pts = 3
                _fib_detail = 'فيبوناتشي غير محسوب'
            _fib_layer_pts = float(_fib_pts)
            confluence_score += _fib_pts
            confluence_breakdown['fibonacci'] = {
                'passed': _fib_pts >= 5, 'points': _fib_pts, 'max': 10,
                'detail': _fib_detail,
                'levels': _fib_levels_val,
            }

            # ── Layer 9: Smart Money Concepts (SMC) — Order Blocks + FVG + Sweeps (25 pts) ──
            _smc_layer_pts = 0.0
            _smc_detail = 'SMC غير متاح'
            if ohlcv and len(ohlcv) >= 10:
                try:
                    _smc_result = calculate_smc_score(
                        ohlcv=ohlcv,
                        current_price=cp_8l,
                        # P7-VOLUME-FIX: _safe_div defensive ضد zero/nan denominators.
                        volume_ratio=_safe_div(vols_arr[-5], (sum(vols_arr[-20:]) / min(20, len(vols_arr))) if vols_arr else 0, default=1.0) if len(vols_arr) >= 5 and sum(vols_arr[-20:]) > 0 else 1.0,
                        rsi=float(getattr(tech_indicators, 'rsi', 50) or 50),
                        sma200=float(getattr(tech_indicators, 'sma200', 0) or 0),
                    )
                    _smc_raw = float(_smc_result.get('score', 0))
                    # Map 0-100 SMC score to 0-25 confluence points
                    _smc_layer_pts = max(0.0, min(25.0, _smc_raw / 4.0))
                    _smc_detail = f'SMC Score {_smc_raw:.0f}/100 (OBs={len(_smc_result.get("order_blocks", []))}, FVGs={len(_smc_result.get("fvgs", []))}, Sweeps={len(_smc_result.get("sweeps", []))})'
                except Exception as _smc_err:
                    _smc_detail = f'SMC Error: {_smc_err}'
            confluence_score += _smc_layer_pts
            confluence_breakdown['smc'] = {
                'passed': _smc_layer_pts >= 15,
                'points': _smc_layer_pts,
                'max': 25,
                'detail': _smc_detail,
            }

            # ── Confluence signal (9-layer thresholds) ──
            if confluence_score >= CONFLUENCE_THRESHOLDS['STRONG_BUY']:
                _confluence_signal = 'STRONG_BUY'
            elif confluence_score >= CONFLUENCE_THRESHOLDS['BUY']:
                _confluence_signal = 'BUY'
            elif confluence_score >= CONFLUENCE_THRESHOLDS['HOLD']:
                _confluence_signal = 'HOLD'
            else:
                _confluence_signal = 'SELL'

            out['confluence_score'] = round(confluence_score, 2)
            out['confluence_breakdown'] = confluence_breakdown
            out['macd_score'] = round(_macd_layer_pts, 2)
            out['candlestick_score'] = round(_candle_layer_pts, 2)
            out['fibonacci_score'] = round(_fib_layer_pts, 2)
            out['smc_score'] = round(_smc_layer_pts, 2)
            out['candlestick_patterns'] = _candle_patterns_val
            out['fibonacci_levels'] = _fib_levels_val
            out['confluence_signal'] = _confluence_signal
        except Exception as _confluence_err:
            print(f"[MasterAnalyzer] 8-layer confluence failed for {ticker}: {_confluence_err}")
            out['confluence_breakdown'] = {'error': str(_confluence_err)}
        return out

    def _get_stock_market_and_name(self, ticker: str) -> Tuple[str, str]:
        """Get stock market and name from database.
        
        Returns:
            Tuple[str, str]: (market, name) - defaults to ('EGX', '') if not found
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute('SELECT market, name FROM stocks WHERE ticker = ?', (ticker,))
            row = cursor.fetchone()
            conn.close()
            
            if row:
                market = row[0] or 'EGX'
                name = row[1] or ''
                return (market, name)
        except Exception as e:
            print(f"[MasterAnalyzer] Error getting market/name for {ticker}: {e}")
        
        return ('EGX', '')
    
    def _get_stock_data(self, ticker: str) -> Dict:
        """Get stock fundamental data - handles missing columns gracefully."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Check which columns exist first
            cursor.execute("PRAGMA table_info(stocks)")
            available_cols = [row[1] for row in cursor.fetchall()]
            
            # Build query with only available columns
            possible_cols = {
                'pe_ratio': 'pe_ratio',
                'roe': 'roe',
                'eps': 'eps',
                'dividend_yield': 'dividend_yield',
                'sector': 'sector',
                'profit_margin': 'profit_margin',
                'debt_to_equity': 'debt_to_equity',
                'pb_ratio': 'pb_ratio',
                'market_cap': 'market_cap',
                'beta': 'beta',
            }
            
            cols_to_select = []
            col_names = []
            for col, name in possible_cols.items():
                if col in available_cols:
                    cols_to_select.append(col)
                    col_names.append(name)
            
            if not cols_to_select:
                conn.close()
                return {'sector': 'Unknown'}
            
            cursor.execute(f'''
                SELECT {', '.join(cols_to_select)}
                FROM stocks
                WHERE ticker = ?
            ''', (ticker,))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                result = {}
                for i, col in enumerate(cols_to_select):
                    result[col] = row[i]
                return result
            
        except Exception as e:
            print(f"[MasterAnalyzer] Error getting stock data for {ticker}: {e}")
        
        return {'sector': 'Unknown'}
    
    def _get_market_regime_score(self) -> float:
        """Get market regime score (simplified)."""
        # In production, this would check EGX30 vs MA200
        # For now, return neutral
        return 50.0

    def _detect_market_regime_cached(self) -> Dict[str, Any]:
        """
        كشف حالة السوق الحقيقية مرة واحدة (Bull/Bear/Ranging + القوة).

        يستخدم RegimeDetector.detect_market_regime() اللي بيحلل EGX30 أو
        أعلى الأسهم سيولة — ده غير detect_regime(prices) اللي بيحلل السهم
        لوحده. النتيجة بتتحفظ في self.market_regime_info وتتوزع على كل
        الأسهم بدل ما تتحسب لكل سهم على حدة.

        في حالة فشل كشف السوق (قاعدة بايظة/بيانات ناقصة) نرجع لـ
        detect_regime(prices) المحلي كـ fallback بدل 50 ثابت عشان
        الأسهم القوية تفضل تاخد score أعلى.
        """
        try:
            result = self.regime_detector.detect_market_regime()
            regime = result.get('regime', 'unknown')
            confidence = result.get('confidence', 0)
            regime_score_map = {
                'bull_trend': 70,
                'bear_trend': 30,
                'ranging': 50,
                'unknown': 50,
            }
            score = regime_score_map.get(regime, 50)
            return {
                'regime': regime,
                'regime_ar': result.get('regime_ar', 'غير معروف'),
                'confidence': confidence,
                'score': score,
                'indicators': result.get('indicators', {}),
            }
        except Exception as e:
            print(f"[MasterAnalyzer] Market regime detection failed: {e}")
            # Fallback: derive a per-instance neutral regime from recent market
            # breadth if available, otherwise leave neutral. The per-stock
            # detect_regime(prices) is applied later only as an adaptive-weight
            # hint, not as the regime score.
            return {
                'regime': 'unknown',
                'regime_ar': 'غير معروف',
                'confidence': 0,
                'score': 50,
                'indicators': {},
            }
    
    def _calculate_volatility(self, prices: List[float]) -> float:
        """Calculate 20-day volatility."""
        if len(prices) < 21:
            return 3.0
        
        returns = [(prices[i] - prices[i-1]) / prices[i-1] * 100 
                   for i in range(len(prices)-20, len(prices))]
        
        if not returns:
            return 3.0
        
        mean = sum(returns) / len(returns)
        variance = sum((r - mean) ** 2 for r in returns) / len(returns)
        return round((variance ** 0.5), 2)
    
    def _get_signal_from_score(self, score: float, threshold_boost: float = 0.0) -> str:
        """Convert score to signal - Updated thresholds.

        DNA-WIRING (Axis A): threshold_boost قيمة سالبة (مثلاً -8) بتخفض
        الـ thresholds عشان السهم "الحيّ" (alive) يطلع BUY signals بدل ما
        تتدفن. الـ boost بيتم طرحها من كل threshold (لأنها سالبة → بتقلل العتبة).
        """
        # طبّق الـ DNA boost (سالب → يخفض العتبة، موجب → يرفعها)
        adj = threshold_boost  # عادة سالبة
        if score >= THRESHOLDS['STRONG_BUY'] + adj:
            return 'STRONG_BUY'
        elif score >= THRESHOLDS['BUY'] + adj:
            return 'BUY'
        elif score >= THRESHOLDS['ACCUMULATE'] + adj:
            return 'ACCUMULATE'
        elif score >= THRESHOLDS.get('HOLD_LOW', 35) + adj:
            return 'HOLD'
        elif score >= THRESHOLDS['REDUCE'] + adj:
            return 'REDUCE'
        elif score >= THRESHOLDS['SELL'] + adj:
            return 'SELL'
        else:
            return 'STRONG_SELL'
    
    def _get_signal_arabic(self, signal: str) -> str:
        """Get Arabic signal name."""
        translations = {
            'STRONG_BUY': 'شراء قوي',
            'BUY': 'شراء',
            'ACCUMULATE': 'تجميع',
            'HOLD': 'احتفاظ',
            'REDUCE': 'تخفيف',
            'SELL': 'بيع',
            'STRONG_SELL': 'بيع قوي',
            'EXCLUDED': 'مستبعد',
            'INSUFFICIENT_DATA': 'بيانات غير كافية',
            # PHASE-5.1: Hard Veto signals (حق النفو)
            'REJECTED_LIQUIDITY': '🩸 مرفوض — سهم ميت (سيولة ضعيفة)',
            'REJECTED_FUNDAMENTALS': 'مرفوض — أساسيات ضعيفة',
            'REJECTED_RR': '🚫 مرفوض — مخاطرة أكبر من الربح (R/R < 1.5)',
            'REJECTED_MACRO': '🚫 مرفوض — السوق هابط (EGX30 نازل 2%+)',
        }
        return translations.get(signal, signal)
    
    def _build_technical_summary(self, indicators) -> str:
        """Build technical summary."""
        parts = []
        
        if indicators.rsi:
            rsi_desc = f"RSI: {indicators.rsi:.1f}"
            if indicators.rsi_signal:
                rsi_desc += f" ({indicators.rsi_signal})"
            parts.append(rsi_desc)
        
        if indicators.macd_trend:
            parts.append(f"MACD: {indicators.macd_trend}")
        
        if indicators.trend_direction:
            parts.append(f"الاتجاه: {indicators.trend_direction}")
        
        return " | ".join(parts) if parts else "لا توجد بيانات فنية كافية"
    
    def _build_fundamental_summary(self, metrics) -> str:
        """Build fundamental summary - enhanced version.

        Handles two types:
        1. EnhancedFundamentalAnalyzer metrics (legacy — direct attributes)
        2. FundamentalVerdict (FUNDAMENTAL-CATALYST-022 — metrics dict + breakdown dict)
        """
        parts = []

        # FUNDAMENTAL-CATALYST-022: FundamentalVerdict path (المحرك الجديد)
        if hasattr(metrics, 'breakdown') and hasattr(metrics, 'metrics') and isinstance(metrics.metrics, dict):
            # ده FundamentalVerdict من fundamental_engine.py
            raw = metrics.metrics
            if raw.get('pe_ratio') is not None:
                parts.append(f"P/E: {raw['pe_ratio']:.1f}")
            if raw.get('roe') is not None:
                parts.append(f"ROE: {raw['roe']:.1f}%")
            if raw.get('net_margin') is not None:
                parts.append(f"صافي الربح: {raw['net_margin']:.1f}%")
            if raw.get('debt_to_equity') is not None and raw['debt_to_equity'] > 0:
                parts.append(f"ديون/حقوق: {raw['debt_to_equity']:.2f}")

            bd = metrics.breakdown
            if isinstance(bd, dict):
                if 'valuation' in bd:
                    parts.append(f"التقييم: {bd['valuation']:.0f}")
                if 'profitability' in bd:
                    parts.append(f"الربحية: {bd['profitability']:.0f}")
                if 'growth' in bd:
                    parts.append(f"النمو: {bd['growth']:.0f}")
                if 'dividend' in bd:
                    parts.append(f"التوزيعات: {bd['dividend']:.0f}")

            # الإشارة والثقة
            if hasattr(metrics, 'signal_ar') and metrics.signal_ar:
                parts.append(metrics.signal_ar)
            if hasattr(metrics, 'confidence'):
                parts.append(f"ثقة: {metrics.confidence:.0f}%")

            return " | ".join(parts) if parts else "لا توجد بيانات أساسية كافية"

        # Legacy path: EnhancedFundamentalAnalyzer metrics (direct attributes)
        if hasattr(metrics, 'pe_ratio') and metrics.pe_ratio:
            parts.append(f"P/E: {metrics.pe_ratio:.1f}")

        if hasattr(metrics, 'roe') and metrics.roe is not None:
            parts.append(f"ROE: {metrics.roe:.1f}%")

        # Enhanced scores (if available)
        if hasattr(metrics, 'valuation_score'):
            parts.append(f"التقييم: {metrics.valuation_score:.0f}")

        if hasattr(metrics, 'profitability_score'):
            parts.append(f"الربحية: {metrics.profitability_score:.0f}")

        if hasattr(metrics, 'financial_health_score'):
            parts.append(f"الصحة المالية: {metrics.financial_health_score:.0f}")

        # Buy/Sell reasons
        if hasattr(metrics, 'buy_reasons') and metrics.buy_reasons:
            parts.append(f"إيجابيات: {len(metrics.buy_reasons)}")

        if hasattr(metrics, 'sell_reasons') and metrics.sell_reasons:
            parts.append(f"سلبيات: {len(metrics.sell_reasons)}")

        # Confidence
        if hasattr(metrics, 'confidence'):
            parts.append(f"ثقة: {metrics.confidence:.0f}%")

        return " | ".join(parts) if parts else "لا توجد بيانات أساسية كافية"
    
    def scan_market(self, limit: int = 200, strict_rr: bool = False, market: str = 'EGX') -> List[MasterAnalysis]:
        """
        Scan tradeable stocks for a specific market and return sorted by score.

        🔥 FIXED: NO MORE STRICT R:R FILTER
        - Returns ALL tradeable stocks sorted by score
        - R:R filter is optional (strict_rr=True for conservative mode)
        - NO MORE HOLD exclusion - let the user decide
        - NO MORE 50 LIMIT CAP - default is now 200
        - Market filtering: defaults to EGX, pass market=None for all markets

        Args:
            limit: Maximum stocks to return (default: 200)
            strict_rr: If True, filter by R:R >= 1.5 (default: False)
            market: Market code (EGX, TADAWUL, KSE, QSE, DFM, ADX, BSE).
                    Defaults to 'EGX'. Pass None to scan all markets.

        Returns:
            List of MasterAnalysis sorted by master_score
        """
        # Get all tickers, optionally filtered by market
        tickers = self._get_all_tickers(market=market)

        # Filter by liquidity (includes penny stock check)
        tradeable, excluded = self.liquidity_filter.filter_stocks(tickers)

        print(f"[MasterAnalyzer] Scanning {len(tradeable)} tradeable stocks for market={market or 'ALL'} (limit: {limit}, strict_rr: {strict_rr})")

        results = []
        for ticker in tradeable:
            try:
                analysis = self.analyze(ticker)
                # Only exclude non-tradeable and insufficient data
                if analysis.is_tradeable and analysis.signal not in ['EXCLUDED', 'INSUFFICIENT_DATA']:
                    # Optional R:R check (disabled by default)
                    if strict_rr and analysis.risk_profile:
                        rr = analysis.risk_profile.get('risk_reward_ratio', 0)
                        if rr < 1.5:
                            continue  # Skip if strict mode and R:R < 1.5
                    results.append(analysis)
            except Exception as e:
                logger.error(f"[MasterAnalyzer] Error scanning stock {ticker}: {e}")
                continue

        # Sort by master_score descending
        results.sort(key=lambda x: x.master_score, reverse=True)

        print(f"[MasterAnalyzer] Found {len(results)} tradeable stocks for market={market or 'ALL'}")

        return results[:limit]
    
    def _get_all_tickers(self, market: str = 'EGX') -> List[str]:
        """Get all active tickers, optionally filtered by market.

        Args:
            market: Market code (EGX, TADAWUL, KSE, QSE, DFM, ADX, BSE).
                    Defaults to 'EGX'. Pass None for all markets.
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            if market:
                cursor.execute(
                    "SELECT ticker FROM stocks WHERE (market = ? OR market IS NULL) AND (is_active = 1 OR is_active IS NULL)",
                    (market,)
                )
            else:
                cursor.execute(
                    "SELECT ticker FROM stocks WHERE is_active = 1 OR is_active IS NULL"
                )
            tickers = [row[0] for row in cursor.fetchall()]
            conn.close()
            return tickers
        except:
            return []
    
    def _get_learned_lessons(self, ticker: str) -> List[Dict]:
        """
        الحصول على الدروس المستفادة لسهم معين.

        B2 (Closed-Loop) fix: الـ schema القديم كان بـ يستعلم أعمدة غير موجودة
        (description, trigger_conditions, action, title, status, ...) → silent
        failure بـ يرجّع []. دلوقتي بنقرأ من مخزن الدروس الموحّد اللي بـ يستخدم
        الـ schema الفعلي (lesson_type, condition, outcome, recommendation, ...).

        بنحوّل ملخص الدروس لـ الشكل اللي `_apply_learned_adjustments` بـ يتوقعه
        (confidence_adjustment / target_adjustment / stop_adjustment) بناءً على
        lesson_code:
          - STOP_TOO_TIGHT  → stop_adjustment > 0  (وسّع الوقف)
          - LATE_MOMENTUM   → confidence_adjustment < 0 (قلّل الثقة)
          - TARGET_HIT_OK   → confidence_adjustment > 0  (عزّز الثقة)
        """
        try:
            from utils.lesson_store import get_ticker_lesson_summary
            summ = get_ticker_lesson_summary(ticker, days=90)
            if summ['total'] == 0:
                return []
            lessons = []
            for code, bucket in summ['by_code'].items():
                # خريط lesson_code → adjustments قابلة للقياس
                conf_adj = 0
                tgt_adj = 0
                stop_adj = 0
                if code == 'STOP_TOO_TIGHT':
                    stop_adj = min(5 * bucket['count'], 15)  # وسّع الوقف
                elif code == 'LATE_MOMENTUM':
                    conf_adj = -min(3 * bucket['count'], 10)  # قلّل الثقة
                elif code == 'TARGET_HIT_OK':
                    conf_adj = min(2 * bucket['count'], 8)   # عزّز الثقة
                elif code in ('STOPPED_OUT', 'EXPIRED_LOSS'):
                    conf_adj = -min(2 * bucket['count'], 6)
                lessons.append({
                    'lesson_type': 'ticker_outcome',
                    'description': f"{code} ({bucket['count']}×, avg {bucket['avg_return']:.1f}%)",
                    'trigger_conditions': {'code': code, 'count': bucket['count']},
                    'action': 'adjust',
                    'confidence_adjustment': conf_adj,
                    'target_adjustment': tgt_adj,
                    'stop_adjustment': stop_adj,
                    'occurrences': bucket['count'],
                })
            return lessons
        except Exception:
            return []
    
    def _apply_learned_adjustments(self, ticker: str, master_score: float, 
                                    risk_profile: Optional[Dict]) -> Tuple[float, Optional[Dict], List[str]]:
        """
        تطبيق التعديلات المستفادة من التاريخ
        
        Returns:
            - adjusted_score: الدرجة بعد التعديل
            - adjusted_risk_profile: الـ risk profile بعد التعديل
            - applied_lessons: قائمة الدروس المطبقة
        """
        lessons = self._get_learned_lessons(ticker)
        
        adjusted_score = master_score
        adjusted_risk = risk_profile.copy() if risk_profile else {}
        applied_lessons = []
        
        for lesson in lessons:
            # Apply confidence adjustment
            if lesson['confidence_adjustment'] != 0:
                adjusted_score += lesson['confidence_adjustment']
                applied_lessons.append(f"Lesson: {lesson['description'][:50]}...")
            
            # Apply target adjustment
            if lesson['target_adjustment'] != 0 and adjusted_risk:
                if 'target_price' in adjusted_risk and adjusted_risk['target_price']:
                    adjusted_risk['target_price'] *= (1 + lesson['target_adjustment'] / 100)
                    adjusted_risk['target_adjusted_by_lesson'] = lesson['target_adjustment']
            
            # Apply stop adjustment
            if lesson['stop_adjustment'] != 0 and adjusted_risk:
                if 'stop_loss' in adjusted_risk and adjusted_risk['stop_loss']:
                    adjusted_risk['stop_loss'] *= (1 - lesson['stop_adjustment'] / 100)
                    adjusted_risk['stop_adjusted_by_lesson'] = lesson['stop_adjustment']
        
        # Clamp score
        adjusted_score = max(0, min(100, adjusted_score))
        
        return adjusted_score, adjusted_risk, applied_lessons
    
    def analyze_with_learning(self, ticker: str, prices: List[float] = None, 
                              volumes: List[float] = None) -> MasterAnalysis:
        """
        تحليل سهم مع تطبيق التعلم من الماضي
        
        This is the enhanced version of analyze() that incorporates:
        1. Historical lessons learned
        2. Per-stock calibration
        3. Dynamic adjustments based on past behavior
        """
        # First run standard analysis
        analysis = self.analyze(ticker, prices, volumes)
        
        # Apply learned adjustments if tradeable
        if analysis.is_tradeable and analysis.signal not in ['EXCLUDED', 'INSUFFICIENT_DATA']:
            adjusted_score, adjusted_risk, applied_lessons = self._apply_learned_adjustments(
                ticker, 
                analysis.master_score, 
                analysis.risk_profile
            )
            
            # Update analysis with adjustments
            analysis.master_score = round(adjusted_score, 2)
            
            # Re-evaluate signal based on adjusted score
            new_signal = self._get_signal_from_score(adjusted_score)
            if new_signal != analysis.signal:
                analysis.signal = new_signal
                analysis.signal_ar = self._get_signal_arabic(new_signal)
            
            # Update risk profile
            if adjusted_risk:
                analysis.risk_profile = adjusted_risk
            
            # Store lessons applied (add to timestamp for now)
            if applied_lessons:
                analysis.timestamp += f" | Lessons applied: {len(applied_lessons)}"
        
        return analysis

    def _is_spark_setup(self, prices: List[float], volumes: List[float], highs: List[float], lows: List[float]) -> bool:
        """تحليل نمط الشرارة (Spark Setup)"""
        if not prices or len(prices) < 30:
            return False
            
        # 1. 20-day average volume
        vol_20d_avg = sum(volumes[-20:]) / 20.0 if volumes else 0
        if vol_20d_avg <= 0:
            return False
            
        # 3-day volume average (excluding today)
        vol_3d_avg = sum(volumes[-4:-1]) / 3.0 if len(volumes) >= 4 else 0
        
        # 3-day price range (excluding today)
        # P7-VOLUME-FIX: use _safe_div — لو min(recent_closes)=0 (بيانات price_history
        # ناقصة زي EKHO) كان بـ يـ crash بـ float division by zero.
        recent_closes = prices[-4:-1] if len(prices) >= 4 else []
        if recent_closes:
            _rc_min = min(recent_closes)
            _rc_max = max(recent_closes)
            # لو min=0 → الـ range meaningless (بيانات ناقصة) → استخدم 100 (نفس
            # default الـ "no recent_closes" branch). غير كده احسب النسبة الطبيعية.
            if _rc_min > 0:
                price_range_3d = _safe_div(_rc_max - _rc_min, _rc_min, default=1.0) * 100
            else:
                price_range_3d = 100
        else:
            price_range_3d = 100
        
        # 30-day resistance (excluding today)
        recent_highs = [h if h is not None else c for h, c in zip(highs[-31:-1], prices[-31:-1])] if len(prices) >= 31 else []
        resistance_30d = max(recent_highs) if recent_highs else 0
        
        # Accumulation check
        # P7-VOLUME-FIX: use _safe_div for vol_3d_avg / vol_20d_avg (vol_20d_avg
        # guarded above but defensive).
        accumulation = (_safe_div(vol_3d_avg, vol_20d_avg, default=0.0) > 1.5) and (price_range_3d < 4.0)
        
        # Today's Spark breakout
        today_high = highs[-1] if highs else prices[-1]
        today_volume = volumes[-1] if volumes else 0
        
        spark = (today_high > resistance_30d * 1.02) and (today_volume > vol_20d_avg * 1.8)
        
        # Confirmation check
        confirmation = prices[-1] > resistance_30d
        
        return accumulation or (spark and confirmation)
