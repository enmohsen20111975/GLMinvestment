"""
Engine Settings Provider (مزود إعدادات المحرك الديناميكي)
==========================================================
DYNAMIC-SYSTEM-001: نظام الإعدادات الديناميكية المتكيف.

الفلسفة: "مفيش رقم ثابت في الكود". كل threshold (سيولة، RSI، حجم،
درجة شراء، وقف خسارة، R/R) لازم يقرأ من هنا، والأدمن يقدر يعدّله
من لوحة التحكم بدون ما يلمس الكود.

التخزين: جدول `system_settings` في stocks.db (Key-Value).
الـ Defaults: معرّفة هنا كـ fallback لو الـ DB مفيهاش القيمة.
الـ Cache: في الذاكرة (TTL = 60 ثانية) عشان ما نقرأش الـ DB في كل analyze().

Usage:
    from analyzers.engine_settings import get_setting, get_all_settings
    min_turnover = get_setting('min_turnover_egp', default=500000)
    buy_threshold = get_setting('buy_threshold_score', default=68)

الـ Admin UI بيكتب في نفس الجدول عبر API:
    GET  /api/admin/engine-settings        → يرجّع كل الإعدادات
    POST /api/admin/engine-settings        → يحدّث إعداد واحد أو أكتر
"""

from __future__ import annotations

import sqlite3
import threading
import time
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional, Union

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / "db" / "stocks.db")

_CACHE_TTL = 60  # seconds — cache settings in memory to avoid DB hits
_cache_lock = threading.Lock()
_cache: Dict[str, Any] = {
    "data": None,       # Dict[str, str] of all settings
    "ts": 0.0,          # timestamp of last load
}

# ─── CANONICAL-PRICE-SOURCE (Task PHASE-3, Rule 72) ─────────────────
# Price source hierarchy (ALL engines must follow this):
# 1. LIVE price: stocks.db.stocks.current_price (updated by scrapers every 5 min)
# 2. HISTORICAL closes: stocks.db.stock_daily_prices (EOD data, most up-to-date)
# 3. Fallback: data_engine.db.egksco_price_history (stale — only if 1+2 fail)
#
# FORBIDDEN sources:
# - price_history.db (deprecated, stale)
# - data_engine.db.historical_data (stale, 5 weeks old)
# - data_engine.db.stock_prices (4 months stale)
#
# Enforcement: any Python engine reading `current_price = closes[-1]` from a
# historical table MUST first try `stocks.db.stocks.current_price` and only
# fall back to `closes[-1]` when the live column is missing/zero.
# See master_analyzer.load_merged_history() for the canonical implementation.

# ──────────────────────────────────────────────────────────────────────────
# Default Settings — القيم الافتراضية لكل الإعدادات
# ──────────────────────────────────────────────────────────────────────────
# أي رقم في الكود لازم يكون معرّف هنا كـ default، عشان الأدمن يقدر يOverride.
# المفتاح (key) لازم يكون snake_case ووصفي.

DEFAULT_SETTINGS: Dict[str, float] = {
    # ===== فلتر السيولة (Liquidity Filter) =====
    # DYNAMIC: السيولة بتتقاس كنسبة من متوسط السهم، مش رقم ثابت.
    # لو current_turnover < avg_turnover_baseline * liquidity_ratio_threshold → penalize
    "liquidity_ratio_threshold": 0.5,   # لو السيولة < 50% من المتوسط → عقاب
    "liquidity_dead_ratio": 0.1,        # لو السيولة < 10% من المتوسط → رفض تام
    # الحد الأدنى المطلق (fallback لو مفيش متوسط تاريخي):
    "min_turnover_egp": 500_000,        # كان 3M، دلوقتي 500K (admin-configurable)
    "min_volume_shares": 50_000,        # الحد الأدنى للحجم
    "min_stock_price": 1.0,             # سهم قرش (penny stock) — مرفوض دايماً

    # ===== فلتر الحجم (Volume Surge) =====
    # DYNAMIC: المضاعف بيتحرك بناءً على صخب السوق.
    # لو السوق هادي → 1.2x كفاية. لو السوق صاخب → 1.8x مطلوب.
    "volume_surge_calm_market": 1.2,    # مضاعف الحجم في السوق الهادي
    "volume_surge_busy_market": 1.8,    # مضاعف الحجم في السوق الصاخب
    "market_volatility_threshold": 2.0, # % — فوقها السوق "صاخب"

    # ===== فلتر RSI (التشبع) =====
    # DYNAMIC: عتبة التشبع بتتحرك بناءً على قوة الترند.
    # dynamic_overbought = 70 + (trend_strength * 10) → لو ترند قوي، نقبل لحد 80
    "rsi_overbought_base": 70,          # العتبة الأساسية للتشبع الشرائي
    "rsi_oversold_base": 30,            # العتبة الأساسية للتشبع البيعي
    "rsi_trend_adjustment": 10,         # كم نقطة نزودها لو الترند قوي (0..1 → 0..10)

    # ===== درجة الشراء (BUY Threshold) — CANONICAL (Task UNIFICATION-PHASE-1, Rule 72) =====
    # ─── PHASE-1 (Task UNIFICATION-PHASE-1, Rule 72 + Rule 67) ───────────
    # قبل كده: كان فيه 4 مفاتيح عتبة مختلفة (buy_threshold_base=68, institutional_strong_buy=75,
    # default_buy_threshold=75, base_buy_threshold=75) → كل engine بيستخدم key مختلف.
    # النتيجة: نفس السهم بـ يطلع signal مختلف على كل engine.
    #
    # الحل: توحيد كل الـ thresholds في مفاتيح canonical واحدة (مطابقة لـ canonical_signal.py):
    #   STRONG_BUY = 78, BUY = 65, ACCUMULATE = 55, HOLD = 40, SELL = 25, STRONG_SELL < 25
    # أي engine بـ يستخدم threshold مختلف = bug (Rule 67 + Rule 72).
    "signal_strong_buy_threshold": 78,   # CANONICAL — مطابق canonical_signal.py
    "signal_buy_threshold": 65,          # CANONICAL
    "signal_accumulate_threshold": 55,  # CANONICAL
    "signal_hold_threshold": 40,         # CANONICAL
    "signal_sell_threshold": 25,         # CANONICAL
    "signal_strong_sell_threshold": 25,  # CANONICAL (< 25)

    # DYNAMIC: العتبة بتتحرك بناءً على حالة السوق (مش thresholds signal، ده adjustment).
    # bull_market → 60 كفاية. bear_market → 75 مطلوب. range → 68 (الافتراضي).
    # ملاحظة: ده adjustment للـ buy_threshold، مش signal classification.
    "buy_threshold_base": 68,           # العتبة الأساسية
    "buy_threshold_bull_adjust": -8,    # في السوق الصاعد: خفّض 8 نقاط (60)
    "buy_threshold_bear_adjust": 7,     # في السوق الهابط: زوّد 7 نقاط (75)
    "accumulate_threshold": 50,         # عتبة ACCUMULATE (أقل من BUY) — DEPRECATED، استخدم signal_accumulate_threshold
    "hold_threshold": 35,               # عتبة HOLD (أقل من ACCUMULATE) — DEPRECATED، استخدم signal_hold_threshold
    # P4-MIN-SCORE: الحد الأدنى لتخزين توقع شراء. لو score < 60 → SKIP تماماً.
    # الباك-تست أثبت إن min_score=60 هو السحر: 51.5% WR (Gambler 63.6%).
    # التوقعات الضعيفة مش بتتحفظ في DB — مفيش لازمة لـ noise.
    "min_prediction_score": 60,         # أي score < 60 → SKIP (مايتحفظش كتوقع شراء)

    # ===== وقف الخسارة (Stop Loss) =====
    # DYNAMIC: المضاعف بيتحرك بناءً على تذبذب السهم.
    # سهم هادي → atr * 1.0. سهم صاخب → atr * 2.5.
    "atr_stop_mult_calm": 1.0,          # مضاعف ATR للوقف في السهم الهادي
    "atr_stop_mult_volatile": 2.5,      # مضاعف ATR للوقف في السهم الصاخب
    "stock_volatility_calm": 2.0,       # % — تحتها السهم "هادي"
    "stock_volatility_volatile": 6.0,   # % — فوقها السهم "صاخب"
    "max_stop_pct": 0.15,               # وقف أوسع من 15% = مرفوض
    "min_stop_pct": 0.003,              # وقف أضيق من 0.3% = مرفوض (ضوضاء)
    "default_stop_pct": 5.0,            # وقف خسارة افتراضي (كان ثابت 5%, tiered_stop كان ثابت 8%)
    "breakeven_trigger_pct": 7.0,       # ربح % لتفعيل ستوب نقطة التعادل (كان ثابت 7%)
    "max_portfolio_heat_pct": 2.0,      # أقصى حرارة محفظة لصفقة واحدة (كان ثابت 2%)
    "time_stop_days": 45,              # ستوب زمني: لو السهم متحركش ±3% في 45 يوم → مال مقيد → اخرج (0=disabled)
    "time_stop_min_movement_pct": 3.0, # أدنى حركة مطلوبة خلال فترة الستوب الزمني
    "trailing_stop_atr_mult": 2.0,        # مضاعف ATR للوقف المتحرك (كان ثابت 2.0 في stop_manager و v38_backtest)
    "tiered_stop_before_t1_pct": 8.0,     # ستوب متدرج: قبل الهدف 1 (كان ثابت 8%)
    "tiered_stop_after_t1_pct": 5.0,      # ستوب متدرج: بعد الهدف 1 (كان ثابت 5%)
    "tiered_stop_after_t2_pct": 3.0,      # ستوب متدرج: بعد الهدف 2 (كان ثابت 3%)
    "volatility_stop_atr_mult": 2.5,      # مضاعف ATR لستوب التقلبات (كان ثابت 2.5 في stop_manager)
    "position_max_stop_pct": 10.0,       # أقصى وقف خسارة لمركز واحد % (POSITION-LAYER hard cap, الإنتاج). P1.2 (REFACTORING_REPORT §8.3): مفهوم مختلف عن prediction_optimizer.max_stop_pct=3.0 (PREDICTION-TIME filter) و market_manager:349 max_stop_pct=12.0 (CRYPTO override للـ optimizer filter) و optimizer_params.json max_stop_pct=9.0 (loaded value) و risk_management_advanced:1487 max_stop_pct=15.0 (ATR-calc function default) و risk_routes:662 max_stop_pct=15.0 (API default). كلها طبقات مختلفة، ليست تناقضًا.

    # ===== Stop Loss percentages per stock type (P0.6) =====
    # migrated from risk_management_advanced.py STOP_LOSS_EGX/CRYPTO dicts.
    # قيم محفوظة كما هي من الـ dict الأصلي (لا توجد تعارضات داخلية — لكل stock_type
    # قيمة واحدة فقط). التعارض المُوثّق في 03-REFACTORING_REPORT.md §8.3 ("7 قيم مختلفة")
    # كان بين الـ per-stock-type stops وبين max_stop_pct/default_stop_pct concepts
    # المختلفة (default_stop_pct=5, position_max_stop_pct=10, etc) — تلك تُعالَج في P1.2.
    # القيم هنا هي الـ "most conservative" المتاحة لكل stock_type (i.e. tightest stop)
    # — حيث لم يُوجَد تعارض فعلي، استخدمنا القيمة الأصلية كما هي.
    "stop_pct_large_bank_egx": -7.0,            # بنوك كبيرة EGX (COMI, HRHO)
    "stop_pct_medium_bank_egx": -8.0,            # بنوك متوسطة EGX (SAUD, CAII)
    "stop_pct_large_real_estate_egx": -10.0,     # عقارات كبيرة EGX (MNHD, ORHD)
    "stop_pct_small_real_estate_egx": -12.0,     # عقارات صغيرة EGX
    "stop_pct_large_industrial_egx": -8.0,       # صناعات كبيرة EGX (SWDY, ESRS)
    "stop_pct_small_industrial_egx": -10.0,      # صناعات صغيرة EGX
    "stop_pct_speculative_egx": -5.0,            # مضاربة EGX (tightest — سريع الانهيار)
    "stop_pct_suspended_egx": 0.0,               # أسهم موقوفة — لا تدخل
    "stop_pct_bitcoin_crypto": -10.0,            # BTC (أقل تقلب)
    "stop_pct_ethereum_crypto": -12.0,           # ETH (تقلب متوسط)
    "stop_pct_large_altcoin_crypto": -15.0,       # altcoins كبيرة (تقلب عالٍ)
    "stop_pct_small_altcoin_crypto": -20.0,       # altcoins صغيرة (تقلب جامد)
    "stop_pct_meme_coin_crypto": -25.0,          # meme coins (مقامرة)

    # ===== الأهداف (Targets / R/R) =====
    # DYNAMIC: R/R بيتحرك بناءً على حالة السوق وزخم السهم.
    # bull + momentum → 1:3 أو 1:4. calm market → 1:1.5.
    # V40.3 DIRECTIVE (2026-08-17): owner mandate — absolute floor 1.5 under all conditions.
    #   bull  → 2.0  (نطمع أكتر)
    #   range → 1.5  (was 1.2 — رُفع عشان العمولات والانزلاق السعري بـ ياكل الـ edge)
    #   bear  → 1.8  (was 1.5 — صفقات الارتداد النادرة بـ تحتاج جودة أعلى؛ cash-mode veto
    #               بـ يـ handle أغلب حالات الـ bear عبر _check_market_breadth_veto)
    "min_rr_bull_market": 1.5,          # R/R أدنى في السوق الصاعد (was 2.0 — DNA-WINNER: 1.5 floor)
    "min_rr_bear_market": 1.8,          # R/R أدنى في السوق الهابط (was 1.5 — V40.3 directive)
    "min_rr_range_market": 1.5,         # R/R أدنى في السوق العادي (was 1.2 — V40.3 directive)
    "target_rr_bull": 3.0,              # هدف R/R في السوق الصاعد (1:3)
    "target_rr_range": 1.5,             # هدف R/R في السوق العادي (1:1.5)

    # ===== Regime-specific ATR multipliers (P1.3 — migrated from prediction_optimizer.py:59) =====
    # REGIME_ATR_MULTIPLIERS dict → flat keys. كل regime له stop و target multiplier.
    # المستهلك: prediction_optimizer.get_atr_mults(regime) بـ build الـ dict من المفاتيح دي.
    "regime_atr_stop_strong_bull": 3.0,   # wide stops, big targets
    "regime_atr_target_strong_bull": 5.0,
    "regime_atr_stop_weak_bull": 2.5,     # normal
    "regime_atr_target_weak_bull": 4.0,
    "regime_atr_stop_bull": 2.5,          # محرك الـ optimizer يستخدم 'bull'/'bear'/'range'
    "regime_atr_target_bull": 4.0,
    "regime_atr_stop_range": 1.5,         # tight - no clear trend
    "regime_atr_target_range": 2.5,
    "regime_atr_stop_weak_bear": 1.0,     # very tight - defensive
    "regime_atr_target_weak_bear": 2.0,
    "regime_atr_stop_bear": 1.0,          # محرك الـ optimizer يستخدم 'bull'/'bear'/'range'
    "regime_atr_target_bear": 2.0,
    "regime_atr_stop_strong_bear": 0.0,   # NO TRADING — لا تداول
    "regime_atr_target_strong_bear": 0.0,

    # ===== Regime-specific confluence minimum (P1.4 — migrated from prediction_optimizer.py:78) =====
    # CONFLUENCE_MIN dict → flat keys. الحد الأدنى للتأكيد التقني حسب حالة السوق.
    "regime_confluence_min_strong_bull": 1,  # easy entry in strong bull — دخول سهل
    "regime_confluence_min_weak_bull": 2,
    "regime_confluence_min_bull": 2,
    "regime_confluence_min_range": 2,
    "regime_confluence_min_weak_bear": 3,     # strict in bear — صارم في الهابط
    "regime_confluence_min_bear": 3,
    "regime_confluence_min_strong_bear": 99,  # impossible (no trades) — مستحيل (لا صفقات)

    # ===== Multi-target exit constants (P1.5 — migrated from portfolio/multi_target_exit.py) =====
    # 6 constants per REFACTORING_REPORT §8.6. المستهلك: multi_target_exit.py
    # (the backtest forward-window engine — different from production position management).
    # Persona trail ATR multipliers (كم ATR تحت أعلى close):
    "persona_trail_atr_gambler": 1.5,        # tight — fast exits
    "persona_trail_atr_balanced": 2.0,       # medium
    "persona_trail_atr_conservative": 2.5,   # loose — tolerate zigzag
    # Volatility-expand trigger:
    "volatility_expand_atr_threshold": 1.5,  # recent ATR > 1.5× entry ATR
    "volatility_expand_stop_widen_atr": 0.5, # widen stop by +0.5 ATR
    "volatility_expand_min_profit_pct": 2.0, # only widen if trade in profit ≥ 2%
    # RL-FIX-2 hard max-loss protection + split detection:
    "hard_max_loss_pct": 15.0,               # absolute max loss: exit at -15%
    "stop_loss_sanity_cap_pct": 30.0,        # cap unreasonable wide stops at 30%
    "split_detect_ratio": 0.3,               # if low < prev_close × 0.3 → likely split
    # Backtest forward-window horizon (different concept from production max_holding_days=30 —
    # see P1.1 doc above). 90 days to capture explosive runs (SYSTEM_STATE.md §5).
    "backtest_forward_window_days": 90,

    # ===== ATR stop clamp range (PILLAR-3) =====
    # المستهلك: core/opportunity_quality.py::enforce_atr_based_stop
    # نطاق الـ stop distance كـ % من entry. كان 3%-7% (P0-v3) → رفعنا لـ 3%-9% (PILLAR-3)
    # عشان الأسهم المضاربية المصرية (HRHO/MFPC/COMI) بتتحرك 7-9% ATR في news sessions.
    # الـ 7% cap كان بـ يـ reject صفقات بـ R/R كويسة (6 صفقات فقط في 8 أشهر).
    #
    # ── EGX-STRATEGY (2026-08-30): رفعنا atr_stop_min_pct من 3.0 لـ 5.0 ──
    # السبب: استراتيجية المالك بتقول "الحد الأدنى للوقف في EGX: مش أقل من 5% في
    # معظم الحالات (التذبذب الطبيعي عالي)". تحليل مارس-مايو أظهر إن وقف 3% بـ
    # يضرب من ضجيج السوق العادي. الـ 5% بـ يـ give breathing room للصفقة.
    "atr_stop_min_pct": 5.0,                # EGX-STRATEGY: stop distance ≥ 5% (التذبذب الطبيعي عالي في EGX)
    "atr_stop_max_pct": 9.0,                 # stop distance ≤ 9% (كان 7% — للأسهم عالية التقلب)
    # ===== تعويض تأخير الـ 5 دقائق (Delayed Data Compensation) =====
    # Close-Confirmation: استنى الشمعة تقفل فوق المقاومة بدل ما نطلب اختراق لحظي.
    "use_close_confirmation": 1,        # 1 = فعّال، 0 = مطفي
    "pullback_bonus": 5,                # درجات إضافية لو السهم بيعمل pullback (مش طلوع عمودي)
    "vertical_spike_penalty": 8,        # درجات خصم لو السهم طالع عمودي (هتلقاه في القمة)

    # ===== معاملات الأسهم الحرة (Free Float) =====
    "free_float_critical_pct": 5.0,     # % — تحتها خطير جداً
    "free_float_risky_pct": 15.0,       # % — تحتها مخاطرة عالية
    "free_float_critical_mult": 0.2,    # معامل السيولة لو free float حرج
    "free_float_risky_mult": 0.5,       # معامل السيولة لو free float مخاطر

    # ===== حدود المحرك (Engine Limits) =====
    "max_analysis_age_minutes": 15,     # التحليل يعتبر "قديم" بعد 15 دقيقة
    "min_confidence_pct": 40,           # أقل ثقة مسموح بيها لعرض توصية

    # ===== القرار المؤسسي (Institutional Decision Engine) =====
    # DYNAMIC: عتبات الشراء/البيع بتتحرك بناءً على حالة السوق.
    "institutional_buy_threshold": 65,          # CANONICAL (Task UNIFICATION-PHASE-1) — مطابق signal_buy_threshold
    "institutional_strong_buy_threshold": 78,   # CANONICAL — مطابق signal_strong_buy_threshold
    "institutional_regular_buy_threshold": 55,  # CANONICAL — مطابق signal_accumulate_threshold
    "institutional_sell_threshold": 25,         # CANONICAL — مطابق signal_sell_threshold
    "institutional_reduce_threshold": 40,       # CANONICAL — مطابق signal_hold_threshold
    "tech_score_base": 50,                      # القاعدة لدرجة التقنية (كانت ثابت 50)
    "accumulation_override_threshold": 65,      # V39.3 tightened: كان 58، رفعناها لتقليل الإشارات الضعيفة
    "vwap_premium_threshold": 5.0,              # حد القيمة العادلة +5% (كانت ثابت 5)
    "vwap_discount_threshold": -5.0,            # حد القيمة العادلة -5% (كانت ثابت -5)

    # ===== أوزان الإثباتات (Proof Weights) — V40 EVIDENCE-BASED =====
    # DYNAMIC: أوزان الإثباتات الستة — الأدمن يقدر يعدلها
    # V40: إعادة موازنة حسب أولوية EGX (تجميع مؤسسي + قوة نسبية = الأهم)
    "proof_weight_trend": 8,            # V40: EGX — الترند ضعيف (هيكل القمم/القيعان أهم من SMA200)
    "proof_weight_makers": 26,          # V40: EGX — الميكرز هو الإشارة الأهم (تجميع مؤسسي) — الأولوية 1
    "proof_weight_dna": 13,             # V40: EGX — البصمة لسه مهمة
    "proof_weight_fundamental": 8,      # V40: EGX — الأساسيات ووزن منخفض (تُستخدم كفلتر استبعاد فقط)
    "proof_weight_sector": 12,          # V40: EGX — زخم القطاع مهم في البورصة المصرية
    "proof_weight_benchmark": 24,       # V40: EGX — القوة النسبية للمؤشر هي الفلتر الأهم — الأولوية 2

    # ===== V39: إعدادات ديناميكية جديدة =====
    "volume_surge_std_mult": 1.5,       # V39: مضاعف الانحراف المعياري للحجم غير الطبيعي
    "base_buy_threshold": 75,           # V39: حد الشراء الأساسي (سيتم تكييفه)
    "self_learning_adjustment_pct": 10, # V39: نسبة تعديل الحد من التعلم الذاتي
    "dynamic_rr_outperform": 2.0,       # V39: R:R لما السهم أقوى من المؤشر
    # ── EGX-STRATEGY (2026-08-30): رفعنا dynamic_rr_normal من 1.5 لـ 1.8 ──
    # السبب: استراتيجية المالك بتقول "R/R لا يقل عن 1.8 (يفضل 2.0)".
    # تحليل مارس-مايو أظهر إن R:R=2.0 مع evidence=0/6 بـ يخسر — المشكلة كانت في
    # جودة الإشارة مش في R:R. بس رفعنا الـ floor لـ 1.8 عشان نضمن مخاطرة مجدية.
    "dynamic_rr_normal": 1.8,           # EGX-STRATEGY: R:R عادي (رفعناها من 1.5 لـ 1.8)

    # ── EGX-STRATEGY (2026-08-30): الحد الأدنى للإثباتات ──
    # استراتيجية المالك: "ندخل فقط عندما يكون الاحتمال لصالحنا بوضوح".
    # تحليل مارس-مايو أظهر إن 4 من 9 خسائر كان evidence=0/6 (بدون أي إثباتات).
    # الـ 6 إثباتات: Trend + Makers + DNA + Fundamentals + Sector + Benchmark.
    # min_evidence_count=3 يعني لازم نعلى على الأقل 3 إثباتات من 6 (50%) للدخول.
    "min_evidence_count": 3,            # EGX-STRATEGY: لازم ≥ 3 إثباتات من 6 للدخول
    "atr_stop_mult_default": 1.5,       # V39: مضاعف ATR للوقف الافتراضي
    "atr_stop_mult_high_vol": 2.5,      # V39: مضاعف ATR للوقف في تذبذب عالي
    "atr_stop_mult_low_vol": 1.0,       # V39: مضاعف ATR للوقف في تذبذب منخفض

    # ===== نسب الحجم المؤسسي (Volume Ratios) =====
    "volume_absorption_ratio": 1.5,     # نسبة الحجم للامتصاص (كانت ثابت 1.5)
    "volume_no_supply_ratio": 0.5,      # نسبة الحجم للا عرض (كانت ثابت 0.5)
    "volume_surge_institutional": 1.3,  # نسبة الحجم للزخم المؤسسي (كانت ثابت 1.3)
    "atr_wick_mult": 0.2,               # مضاعف ATR للويك (كان ثابت 0.2)
    "atr_stop_default_mult": 1.5,       # مضاعف ATR للوقف الافتراضي (كان ثابت 1.5)
    "atr_stop_ob_mult": 0.5,            # مضاعف ATR للوقف عند OB (كان ثابت 0.5)

    # ===== البولنجر باند (Bollinger Bands) =====
    "bb_period": 20,                    # فترة البولنجر (كانت ثابت 20)
    "bb_std_dev": 2.0,                  # انحراف معياري (كان ثابت 2.0)
    "bb_squeeze_threshold": 0.8,        # عتبة الضغط (كانت ثابت 0.8)
    "bb_expansion_threshold": 1.2,      # عتبة التمدد (كانت ثابت 1.2)

    # ===== التعلم الديناميكي (Adaptive Learning) =====
    "adaptive_win_rate_lower": 65,      # نسبة النجاح لخفض العتبة (كانت ثابت 65)
    "adaptive_win_rate_raise": 40,      # نسبة النجاح لرفع العتبة (كانت ثابت 40)
    "adaptive_threshold_adjustment": 5, # مقدار تعديل العتبة (كان ثابت 5)
    "default_buy_threshold": 75,        # العتبة الافتراضية للشراء (كانت ثابت 75)
    "max_holding_days": 30,             # أقصى أيام احتفاظ بالإنتاج (المصدر). Persona overrides في unified_config.py (scalper=1, trader=10, conservative=30, investor=90). P1.1: مختلف عن multi_target_exit.MAX_HOLDING_DAYS=90 (نافذة الباك-تست) و optimizer_params.json=20 (tuning منفصل RL-FIX-16).
    "min_bars_for_analysis": 200,       # أقل عدد شموع للتحليل (كان ثابت 200)

    # ===== الأساسيات (Fundamentals) =====
    "pe_strong_threshold": 15,          # P/E قوي (كان ثابت 15)
    "pe_acceptable_threshold": 25,      # P/E مقبول (كان ثابت 25)
    "roe_strong_threshold": 15,         # ROE قوي (كان ثابت 15)
    "roe_acceptable_threshold": 10,     # ROE مقبول (كان ثابت 10)
    "fund_score_strong": 60,            # درجة أساسيات قوية (كانت ثابت 60)
    "fund_score_weak": 40,              # درجة أساسيات ضعيفة (كانت ثابت 40)

    # ===== إدارة المراكز (Position Management) =====
    "partial_sell_pct": 50,             # نسبة البيع الجزئي (كانت ثابت 50%)
    "trailing_stop_activation_gain": 2.0, # V40: ربح تفعيل الوقف المتحرك أبكر (3% → 2%) لحماية الأرباح
    # CRITICAL-DIRECTIVE (2026-08-16): daily_closer Hard Loss Ceiling + Split Guard.
    # المالك: "محرك الإغلاق أعمى مش فاهم التجزئة — ANFI نزل -65% بسبب split
    # والـ daily_closer سجّلها -66% متجاهلاً سعر الوقف!"
    "hard_loss_ceiling_pct": 7.0,            # daily_closer: cap actual_return عند -7% (حد أقصى مطلق -5% لـ -7%)
    "split_drop_threshold_pct": 35.0,        # لو actual_return < -35% → تجزئة سهم → استبعاد من P&L
    "danger_pnl_threshold": -5,         # حد الخسارة الخطرة (كان ثابت -5%)
    "scale_in_pnl_threshold": 15,       # حد ربح الزيادة (كان ثابت 15%)
    "max_holding_expired_days": 14,     # أيام انتهاء الصلاحية (كان ثابت 14)
    "bear_regime_score_deduction": 15,     # V39.3: خصم من tech_score في السوق الهابط (بدل حظر كامل)
    "self_learning_min_trades": 10,         # V39.3: أدنى صفقات مطلوبة للتعلم الذاتي (كان ثابت 5)

    # ===== ثقة التوصيات (Confidence Tiers) =====
    "confidence_top_pick": 75,          # TOP_PICK ≥ 75% (كانت ثابت 80)
    "confidence_strong": 60,            # STRONG ≥ 60% (كانت ثابت 65)
    "confidence_watch": 45,             # WATCH ≥ 45% (كانت ثابت 50)
    "daily_picks_cap": 5,               # أقصى توصيات/يوم (كان ثابت 5)

    # ===== SMC (Smart Money Concepts) =====
    "smc_broke_resistance_score": 60,   # درجة كسر المقاومة (كانت ثابت 60)
    "smc_broke_support_score": 40,      # درجة كسر الدعم (كانت ثابت 40)
    "candle_prob_bullish_threshold": 55, # عتبة احتمال شموع صاعدة (كانت ثابت 55)
    "candle_prob_bearish_threshold": 45, # عتبة احتمال شموع هابطة (كانت ثابت 45)

    # ===== V40: نظام الأدلة المتوافقة (Evidence-Based Decision) =====
    # الفلسفة: قرار الإشارة بناءً على عدد الأدلة المتوافقة، مش threshold على score
    "strong_buy_evidence_count": 3,     # V40.2: 3 أدلة قوية (الـ benchmark الحقيقي يرفع الجودة فعليًا)
    "buy_evidence_count": 3,            # V40.2: 3 أدلة للشراء العادي (كان 2)
    "sell_evidence_count": 2,           # V40: 2 أدلة ضعف للبيع/التقليل (reverted from 3 — raising let weak signals through, diluted PF)
    "rs_required_for_strong_buy": 1.0,  # V40: القوة النسبية إلزامية للشراء القوي (1.0 = نعم)
    "rs_required_for_buy": 1.0,         # V40.2: القوة النسبية إلزامية للشراء العادي كمان (1.0 = نعم) — كانت 0.0
    "weak_evidence_blocks_buy": 1.0,    # V40: وجود دليل ضعف واضح يمنع الشراء (1.0 = نعم)

    # ===== V40: طبقة Kill Filters (فلاتر الاستبعاد الإجبارية) =====
    # أي سهم فاشل في أي فلتر → مفيش تحليل أصلًا (HOLD فوري)
    "kill_filter_min_turnover_egp": 3000000.0, # V40.2: 3M EGP (strict mode now prevents the 600K relaxation; was originally 3M)
    "kill_filter_min_stock_price": 1.0,        # V40: حد السعر الأدنى (1 EGP)
    "kill_filter_max_volume_volatility": 3.0,  # V40: أقصى تذبذب حجم (std/avg > 3 = تلاعب)
    "kill_filter_min_data_bars": 60,           # V40: أدنى شموع مطلوبة للتحليل (60 يوم)
    "kill_filter_min_relative_strength": -1.0, # V40.2: veto عند ضعف نسبي < -1% (الـ RS PROOF لسه بيتطلب outperformance صريح >0؛ ده veto خشن بس)

    # ===== V40: تشديد شروط Absorption / Distribution =====
    "absorption_lower_wick_pct": 0.75,        # V40: ذيل سفلي ≥ 75% من الشمعة (كان 70%)
    "distribution_upper_wick_pct": 0.65,      # V40: ذيل علوي ≥ 65% من الشمعة (كان 60%)
    "absorption_require_upper_half_close": 1.0, # V40: إغلاق في النصف العلوي إلزامي للامتصاص
    "absorption_min_volume_ratio": 1.5,       # V40.2: نسبة حجم أدنى للامتصاص (1.5x المتوسط) — أعدناها لـ 1.5 لتقليل الـ false absorption signals

    # ===== V40: الخروج الجزئي عند أول هدف =====
    "partial_exit_at_rr": 1.5,                # V40.2: trigger partial at 1.5R (was 1.0) — let winners run further to raise PF
    "partial_exit_pct": 50.0,                 # V40: نسبة الخروج الجزئي (50% من المركز)
    "partial_exit_trail_remaining": 1.0,      # V40: تفعيل trailing على الباقي بعد الخروج الجزئي (1.0 = نعم)

    # ===== V40.1: Position Sizing (مخاطرة ثابتة لكل صفقة) =====
    # كل صفقة تخاطر بنسبة ثابتة من رأس المال — حجم المركز يُحسب من المسافة بين الدخول والستوب
    "position_sizing_enabled": 1.0,           # V40.1: تفعيل Position Sizing في الباكتست (1.0 = نعم)
    "risk_per_trade_pct": 1.5,                # V40.1: نسبة المخاطرة من رأس المال لكل صفقة (1.5%)

    # ===== P41: Morning Bell (جرس الصباح) — قناة الزخم العالي =====
    # جرس الصباح = قناة عرض وإدارة مميزة داخل/فوق Gambler. أعلى مخاطر + أعلى فرص.
    # حد أقصى 5 توصيات ظاهرة في نفس الوقت، تتجدد كل 15 دقيقة أثناء الجلسة.
    "morning_bell_max_picks": 5,              # P41: أقصى عدد توصيات جرس الصباح الظاهرة (5)
    "morning_bell_refresh_minutes": 15,       # P41: دورة تجديد القائمة كل 15 دقيقة
    "morning_bell_rvol_threshold": 1.5,       # P41: بوابة RVOL — أسفلها لا يدخل المرشحين
    "morning_bell_min_extension_pct": 1.0,    # P41: أدنى امتداد يومي % (من افتتاح اليوم)
    "morning_bell_min_evidence": 4,           # P41: أدلة كحد أدنى (للـ static fallback فقط)
    "morning_bell_session_start_min": 600,    # P41: بداية الجلسة 10:00 = 600 دقيقة من منتصف الليل
    "morning_bell_session_end_min": 870,      # P41: نهاية الجلسة 14:30 = 870 دقيقة
    "morning_bell_composite_w_rvol": 0.35,    # P41: وزن RVOL في الترتيب المركّب
    "morning_bell_composite_w_extension": 0.25,  # P41: وزن امتداد اليوم المنضبط
    "morning_bell_composite_w_continuation": 0.25,  # P41: وزن حالة الاستمرار
    "morning_bell_composite_w_liquidity": 0.15,  # P41: وزن السيولة (عامل كسر التعادل)
    # محرك الخروج اللحظي
    "exit_engine_tp1_partial_pct": 0.30,      # P41: نسبة الجني الجزئي عند TP1 (30%)
    "exit_engine_tp2_exit_pct": 0.80,         # P41: نسبة الجني عند TP2 (80%)
    "exit_engine_overextended_gain_pct": 15.0,  # P41: ربح مفرط يستدعي جني أسرع
    "exit_engine_reversal_rvol_threshold": 2.0,  # P41: RVOL الذي يُفعّل إشارة انعكاس
    "exit_engine_reversal_loss_pct": -2.0,    # P41: خسارة % تستدعي خروج انعكاسي

    # ===== PHASE-C: V40.2 hardcoded thresholds → dynamic =====
    # كل القيم دي كانت hardcoded في daily_predictor.py
    # دلوقتي قابلة للتعديل من لوحة الأدمن بدون لمس الكود

    # --- V40.2 generator config ---
    "v402_max_picks_per_day": 5,             # max predictions per day
    "v402_min_ticker_days": 30,              # min historical days required
    "v402_scan_interval": 1,                 # scan every N trading days
    "v402_buy_threshold": 75,                # V38BacktestEngine buy_threshold
    "v402_min_evidence_count": 3,            # min proofs for a valid prediction

    # --- Don't Chase filter ---
    "v402_chase_daily_gain_max": 12.0,       # reject if daily gain > 12%
    "v402_chase_roc3_max": 18.0,             # reject if 3-day ROC > 18%
    "v402_chase_roc5_max": 28.0,             # reject if 5-day ROC > 28%

    # --- Near-peak filter ---
    "v402_near_peak_threshold": 95,          # reject if near peak >= 95%
    "v402_near_peak_rsi_max": 65,            # reject if RSI > 65 at peak

    # --- Drawdown filter ---
    "v402_drawdown_from_high_min": 5.0,      # flag if drawdown >= 5% from recent high

    # --- Pattern win-rate filter ---
    "v402_pattern_wr_min": 0.65,             # penalize if pattern WR < 65%
    "v402_pattern_wr_boost": 0.75,           # boost if pattern WR >= 75%

    # --- Soft surge detector ---
    "v402_soft_surge_vol_ratio": 2.0,        # volume ratio threshold for soft surge
    "v402_soft_surge_roc5_min": 3.0,         # 5-day ROC min for soft surge
    "v402_soft_surge_rr_min": 1.8,           # min R:R for soft surge picks

    # --- Fundamentals filter ---
    "v402_fund_score_min": 30.0,             # reject if fundamental score < 30

    # --- V68 probability thresholds ---
    "v402_v68_prob_strong": 70,              # V68 probability for strong signal
    "v402_v68_prob_moderate": 50,             # V68 probability for moderate signal
    "v402_v68_mag_rr_min": 2.0,              # V68 magnetude R:R minimum

    # --- Sector filter ---
    "v402_sector_min_count": 3,              # min stocks in sector for stats
    "v402_sector_decline_threshold": -1.0,   # sector avg change for decline flag
    "v402_sector_rising_pct_max": 0.25,      # max rising ratio for decline flag

    # --- Volume / liquidity guards ---
    "v402_dead_volume_threshold": 1000,       # volume below this = dead stock
    "v402_penny_stock_price": 1.0,            # price below this = penny stock
}

# ──────────────────────────────────────────────────────────────────────────
# Schema Management
# ──────────────────────────────────────────────────────────────────────────

def _ensure_schema(conn: sqlite3.Connection) -> None:
    """Create the system_settings table if it doesn't exist (idempotent)."""
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                value_type TEXT DEFAULT 'float',
                description TEXT,
                category TEXT DEFAULT 'general',
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_by TEXT DEFAULT 'system'
            )
        """)
        conn.commit()
    except sqlite3.Error as e:
        logger.warning("Failed to ensure system_settings schema: %s", e)


def _coerce_value(raw: str, key: str) -> Union[float, int, str]:
    """Convert a stored string value back to its typed form."""
    default = DEFAULT_SETTINGS.get(key)
    if isinstance(default, bool):
        return raw.lower() in ("1", "true", "yes")
    if isinstance(default, int):
        try:
            return int(float(raw))
        except (ValueError, TypeError):
            return default if default is not None else 0
    if isinstance(default, float):
        try:
            return float(raw)
        except (ValueError, TypeError):
            return default if default is not None else 0.0
    return raw


# ──────────────────────────────────────────────────────────────────────────
# Cache + DB Loading
# ──────────────────────────────────────────────────────────────────────────

def _load_all_from_db() -> Dict[str, str]:
    """Load all settings from the DB (raw string values)."""
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(STOCKS_DB, writable=False)
        _ensure_schema(conn)
        cur = conn.execute("SELECT key, value FROM system_settings")
        result = {row[0]: row[1] for row in cur.fetchall()}
        conn.close()
        return result
    except sqlite3.Error as e:
        logger.warning("Failed to load system_settings: %s — using defaults", e)
        return {}


def _get_all_raw() -> Dict[str, str]:
    """Get all settings (cached). Returns raw string values from DB."""
    now = time.time()
    with _cache_lock:
        if _cache["data"] is not None and (now - _cache["ts"]) < _CACHE_TTL:
            return _cache["data"]
        data = _load_all_from_db()
        _cache["data"] = data
        _cache["ts"] = now
        return data


def invalidate_cache() -> None:
    """Force a reload on next access (call after admin updates a setting)."""
    with _cache_lock:
        _cache["data"] = None
        _cache["ts"] = 0.0


# ──────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────

def get_setting(key: str, default: Optional[float] = None) -> float:
    """
    Get a single setting by key. Returns the default if not found.

    The default falls back to DEFAULT_SETTINGS[key] if `default` is None.
    """
    if default is None:
        default = DEFAULT_SETTINGS.get(key, 0.0)
    raw_all = _get_all_raw()
    raw = raw_all.get(key)
    if raw is None or raw == "":
        return float(default)
    try:
        return float(raw)
    except (ValueError, TypeError):
        return float(default)


def get_setting_typed(key: str) -> Union[float, int, str, bool]:
    """Get a setting with its proper type (int/float/bool/str)."""
    raw_all = _get_all_raw()
    raw = raw_all.get(key)
    if raw is None:
        default = DEFAULT_SETTINGS.get(key, "")
        return default
    return _coerce_value(raw, key)


def get_all_settings() -> Dict[str, Any]:
    """
    Get ALL settings (DB overrides + defaults) as a typed dict.
    Used by the Admin UI to display current values.
    """
    raw_all = _get_all_raw()
    result: Dict[str, Any] = {}
    # Start with defaults
    for key, default_val in DEFAULT_SETTINGS.items():
        raw = raw_all.get(key)
        if raw is not None and raw != "":
            result[key] = _coerce_value(raw, key)
        else:
            result[key] = default_val
    # Include any extra keys in the DB that aren't in defaults
    for key, raw in raw_all.items():
        if key not in result:
            result[key] = _coerce_value(raw, key)
    return result


def get_settings_descriptions() -> Dict[str, Dict[str, str]]:
    """
    Return metadata (description, category) for each setting key.
    Used by the Admin UI to render labeled fields.
    """
    return {
        # Liquidity
        "liquidity_ratio_threshold": {
            "description": "نسبة السيولة من المتوسط — تحتها يتم خصم درجات (0.5 = 50%)",
            "category": "liquidity",
        },
        "liquidity_dead_ratio": {
            "description": "نسبة السيولة الميتة — تحتها يتم رفض السهم تماماً (0.1 = 10%)",
            "category": "liquidity",
        },
        "min_turnover_egp": {
            "description": "الحد الأدنى المطلق للدوران (جنيه) — fallback لو مفيش متوسط تاريخي",
            "category": "liquidity",
        },
        "min_volume_shares": {
            "description": "الحد الأدنى للحجم (عدد أسهم)",
            "category": "liquidity",
        },
        "min_stock_price": {
            "description": "الحد الأدنى لسعر السهم — تحته يعتبر سهم قرش (مرفوض)",
            "category": "liquidity",
        },
        # Volume Surge
        "volume_surge_calm_market": {
            "description": "مضاعف الحجم في السوق الهادي (1.2 = 20% فوق المتوسط)",
            "category": "volume",
        },
        "volume_surge_busy_market": {
            "description": "مضاعف الحجم في السوق الصاخب (1.8 = 80% فوق المتوسط)",
            "category": "volume",
        },
        "market_volatility_threshold": {
            "description": "حد تذبذب السوق — فوقه يعتبر صاخب (%)",
            "category": "volume",
        },
        # RSI
        "rsi_overbought_base": {
            "description": "عتبة التشبع الشرائي الأساسية (70)",
            "category": "rsi",
        },
        "rsi_oversold_base": {
            "description": "عتبة التشبع البيعي الأساسية (30)",
            "category": "rsi",
        },
        "rsi_trend_adjustment": {
            "description": "كم نقطة نزودها لو الترند قوي (0..10)",
            "category": "rsi",
        },
        # BUY Threshold
        "buy_threshold_base": {
            "description": "عتبة درجة الشراء الأساسية (68)",
            "category": "scoring",
        },
        "buy_threshold_bull_adjust": {
            "description": "تعديل عتبة الشراء في السوق الصاعد (-8 → 60)",
            "category": "scoring",
        },
        "buy_threshold_bear_adjust": {
            "description": "تعديل عتبة الشراء في السوق الهابط (+7 → 75)",
            "category": "scoring",
        },
        "accumulate_threshold": {
            "description": "عتبة درجة التجميع (50) — أقل من الشراء",
            "category": "scoring",
        },
        "hold_threshold": {
            "description": "عتبة درجة الاحتفاظ (35) — أقل من التجميع",
            "category": "scoring",
        },
        # Stop Loss
        "atr_stop_mult_calm": {
            "description": "مضاعف ATR للوقف في السهم الهادي (1.0)",
            "category": "risk",
        },
        "atr_stop_mult_volatile": {
            "description": "مضاعف ATR للوقف في السهم الصاخب (2.5)",
            "category": "risk",
        },
        "stock_volatility_calm": {
            "description": "حد التذبذب — تحته السهم هادي (%)",
            "category": "risk",
        },
        "stock_volatility_volatile": {
            "description": "حد التذبذب — فوقه السهم صاخب (%)",
            "category": "risk",
        },
        "max_stop_pct": {
            "description": "أقصى عرض للوقف (0.15 = 15%) — أوسع منه = مرفوض",
            "category": "risk",
        },
        "min_stop_pct": {
            "description": "أدنى عرض للوقف (0.003 = 0.3%) — أضيق منه = ضوضاء",
            "category": "risk",
        },
        # Targets
        "min_rr_bull_market": {
            "description": "R/R الأدنى في السوق الصاعد (2.0)",
            "category": "targets",
        },
        "min_rr_bear_market": {
            "description": "R/R الأدنى في السوق الهابط (1.5 — نسارع للخروج)",
            "category": "targets",
        },
        "min_rr_range_market": {
            "description": "R/R الأدنى في السوق العادي (1.2)",
            "category": "targets",
        },
        "target_rr_bull": {
            "description": "هدف R/R في السوق الصاعد (3.0 = 1:3)",
            "category": "targets",
        },
        "target_rr_range": {
            "description": "هدف R/R في السوق العادي (1.5 = 1:1.5)",
            "category": "targets",
        },
        # P1.3: Regime-specific ATR multipliers (migrated from prediction_optimizer.py:59)
        "regime_atr_stop_strong_bull": {"description": "مضاعف ATR للوقف في strong_bull (3.0)", "category": "regime"},
        "regime_atr_target_strong_bull": {"description": "مضاعف ATR للهدف في strong_bull (5.0)", "category": "regime"},
        "regime_atr_stop_weak_bull": {"description": "مضاعف ATR للوقف في weak_bull (2.5)", "category": "regime"},
        "regime_atr_target_weak_bull": {"description": "مضاعف ATR للهدف في weak_bull (4.0)", "category": "regime"},
        "regime_atr_stop_bull": {"description": "مضاعف ATR للوقف في bull (2.5)", "category": "regime"},
        "regime_atr_target_bull": {"description": "مضاعف ATR للهدف في bull (4.0)", "category": "regime"},
        "regime_atr_stop_range": {"description": "مضاعف ATR للوقف في range (1.5)", "category": "regime"},
        "regime_atr_target_range": {"description": "مضاعف ATR للهدف في range (2.5)", "category": "regime"},
        "regime_atr_stop_weak_bear": {"description": "مضاعف ATR للوقف في weak_bear (1.0)", "category": "regime"},
        "regime_atr_target_weak_bear": {"description": "مضاعف ATR للهدف في weak_bear (2.0)", "category": "regime"},
        "regime_atr_stop_bear": {"description": "مضاعف ATR للوقف في bear (1.0)", "category": "regime"},
        "regime_atr_target_bear": {"description": "مضاعف ATR للهدف في bear (2.0)", "category": "regime"},
        "regime_atr_stop_strong_bear": {"description": "مضاعف ATR للوقف في strong_bear (0.0 = NO TRADING)", "category": "regime"},
        "regime_atr_target_strong_bear": {"description": "مضاعف ATR للهدف في strong_bear (0.0 = NO TRADING)", "category": "regime"},
        # P1.4: Regime-specific confluence minimum (migrated from prediction_optimizer.py:78)
        "regime_confluence_min_strong_bull": {"description": "أدنى تأكيد تقني في strong_bull (1)", "category": "regime"},
        "regime_confluence_min_weak_bull": {"description": "أدنى تأكيد تقني في weak_bull (2)", "category": "regime"},
        "regime_confluence_min_bull": {"description": "أدنى تأكيد تقني في bull (2)", "category": "regime"},
        "regime_confluence_min_range": {"description": "أدنى تأكيد تقني في range (2)", "category": "regime"},
        "regime_confluence_min_weak_bear": {"description": "أدنى تأكيد تقني في weak_bear (3)", "category": "regime"},
        "regime_confluence_min_bear": {"description": "أدنى تأكيد تقني في bear (3)", "category": "regime"},
        "regime_confluence_min_strong_bear": {"description": "أدنى تأكيد تقني في strong_bear (99 = مستحيل)", "category": "regime"},
        # P1.5: Multi-target exit constants (migrated from portfolio/multi_target_exit.py)
        "persona_trail_atr_gambler": {"description": "ATR trail للوقف في persona gambler (1.5)", "category": "regime"},
        "persona_trail_atr_balanced": {"description": "ATR trail للوقف في persona balanced (2.0)", "category": "regime"},
        "persona_trail_atr_conservative": {"description": "ATR trail للوقف في persona conservative (2.5)", "category": "regime"},
        "volatility_expand_atr_threshold": {"description": "عتبة تمدد التقلب: ATR الحالي > 1.5× ATR الدخول (1.5)", "category": "regime"},
        "volatility_expand_stop_widen_atr": {"description": "توسيع الوقف بـ +0.5 ATR عند تمدد التقلب (0.5)", "category": "regime"},
        "volatility_expand_min_profit_pct": {"description": "توسيع الوقف فقط لو الربح ≥ 2% (2.0)", "category": "regime"},
        "hard_max_loss_pct": {"description": "أقصى خسارة مطلقة: خروج عند -15% (RL-FIX-2)", "category": "risk"},
        "stop_loss_sanity_cap_pct": {"description": "كاب الوقف غير المعقول عند 30% من entry (30.0)", "category": "risk"},
        "split_detect_ratio": {"description": "نسبة كشف split: لو low < prev_close × 0.3 → skip bar (0.3)", "category": "risk"},
        "backtest_forward_window_days": {"description": "نافذة الباك-تست الأمامية (90 يوم) — مفهوم مختلف عن max_holding_days=30 الإنتاج", "category": "regime"},
        # ATR stop clamp range (PILLAR-3)
        "atr_stop_min_pct": {
            "description": "أدنى مسافة وقف ATR كـ % من entry (3.0) — تحتها العمولات تاكل الـ edge",
            "category": "risk",
        },
        "atr_stop_max_pct": {
            "description": "أقصى مسافة وقف ATR كـ % من entry (9.0 — كان 7.0 قبل PILLAR-3) — للأسهم عالية التقلب",
            "category": "risk",
        },
        # Delayed Data
        "use_close_confirmation": {
            "description": "تفعيل تأكيد الإغلاق (1 = فعّال، 0 = مطفي) — لتعويض تأخير 5 دقايق",
            "category": "delayed_data",
        },
        "pullback_bonus": {
            "description": "درجات إضافية لو السهم بيعمل pullback (مش طلوع عمودي)",
            "category": "delayed_data",
        },
        "vertical_spike_penalty": {
            "description": "درجات خصم لو السهم طالع عمودي (هتلقاه في القمة)",
            "category": "delayed_data",
        },
        # Free Float
        "free_float_critical_pct": {
            "description": "نسبة الأسهم الحرة الحرجة — تحتها خطير جداً (%)",
            "category": "free_float",
        },
        "free_float_risky_pct": {
            "description": "نسبة الأسهم الحرة المخاطرة — تحتها مخاطرة عالية (%)",
            "category": "free_float",
        },
        "free_float_critical_mult": {
            "description": "معامل السيولة لو free float حرج (0.2)",
            "category": "free_float",
        },
        "free_float_risky_mult": {
            "description": "معامل السيولة لو free float مخاطر (0.5)",
            "category": "free_float",
        },
        # Engine Limits
        "max_analysis_age_minutes": {
            "description": "عمر التحليل قبل ما يعتبر قديم (دقايق)",
            "category": "limits",
        },
        "min_confidence_pct": {
            "description": "أقل ثقة مسموح بيها لعرض توصية (%)",
            "category": "limits",
        },
        # Institutional Decision Engine
        "institutional_buy_threshold": {
            "description": "عتبة شراء مؤسسي — tech_score ≥ هذا = شراء (65)",
            "category": "institutional",
        },
        "institutional_strong_buy_threshold": {
            "description": "عتبة شراء قوي — tech_score ≥ هذا = شراء قوي (70)",
            "category": "institutional",
        },
        "institutional_regular_buy_threshold": {
            "description": "عتبة شراء عادي — tech_score ≥ هذا = شراء عادي (55)",
            "category": "institutional",
        },
        "institutional_sell_threshold": {
            "description": "عتبة بيع — tech_score ≤ هذا = بيع وتجنب (25)",
            "category": "institutional",
        },
        "institutional_reduce_threshold": {
            "description": "عتبة تقليل — tech_score ≤ هذا = تقليل مركز (40)",
            "category": "institutional",
        },
        "tech_score_base": {
            "description": "القاعدة لدرجة التقنية قبل الإثباتات (50)",
            "category": "institutional",
        },
        "vwap_premium_threshold": {
            "description": "حد القيمة العادلة — فوقها غالي (+5%)",
            "category": "institutional",
        },
        "vwap_discount_threshold": {
            "description": "حد القيمة العادلة — تحتها رخيص (-5%)",
            "category": "institutional",
        },
        # Proof Weights
        "proof_weight_trend": {
            "description": "وزن إثبات الترند — EGX محسّن (10)",
            "category": "proofs",
        },
        "proof_weight_makers": {
            "description": "وزن إثبات الميكرز — EGX محسّن (25)",
            "category": "proofs",
        },
        "proof_weight_dna": {
            "description": "وزن إثبات البصمة المستقبلية — EGX محسّن (13)",
            "category": "proofs",
        },
        "proof_weight_fundamental": {
            "description": "وزن إثبات الأساسيات — EGX محسّن (13)",
            "category": "proofs",
        },
        "proof_weight_sector": {
            "description": "وزن إثبات القطاع — EGX محسّن (12)",
            "category": "proofs",
        },
        # Volume Ratios
        "volume_absorption_ratio": {
            "description": "نسبة الحجم للامتصاص — فوقها ميكرز بيشتري (1.5)",
            "category": "volume",
        },
        "volume_no_supply_ratio": {
            "description": "نسبة الحجم للا عرض — تحتها مفيش عرض (0.5)",
            "category": "volume",
        },
        "volume_surge_institutional": {
            "description": "نسبة الحجم للزخم المؤسسي (1.3)",
            "category": "volume",
        },
        "atr_wick_mult": {
            "description": "مضاعف ATR للويك (0.2)",
            "category": "risk",
        },
        "atr_stop_default_mult": {
            "description": "مضاعف ATR للوقف الافتراضي (1.5)",
            "category": "risk",
        },
        "atr_stop_ob_mult": {
            "description": "مضاعف ATR للوقف عند Order Block (0.5)",
            "category": "risk",
        },
        "default_stop_pct": {
            "description": "وقف خسارة افتراضي — يستخدم في tiered_stop و fixed_stop (5%)",
            "category": "risk",
        },
        "breakeven_trigger_pct": {
            "description": "ربح % لتفعيل ستوب نقطة التعادل — بعده الوقف ينتقل للدخول (7%)",
            "category": "risk",
        },
        "max_portfolio_heat_pct": {
            "description": "أقصى حرارة محفظة مسموح بيها لصفقة واحدة (2%)",
            "category": "risk",
        },
        "trailing_stop_atr_mult": {
            "description": "مضاعف ATR للوقف المتحرك — يستخدم في stop_manager و v38_backtest (2.0)",
            "category": "risk",
        },
        "tiered_stop_before_t1_pct": {
            "description": "ستوب متدرج: عرض الوقف قبل الهدف الأول (8%)",
            "category": "risk",
        },
        "tiered_stop_after_t1_pct": {
            "description": "ستوب متدرج: عرض الوقف بعد الهدف الأول (5%)",
            "category": "risk",
        },
        "tiered_stop_after_t2_pct": {
            "description": "ستوب متدرج: عرض الوقف بعد الهدف الثاني (3%)",
            "category": "risk",
        },
        "volatility_stop_atr_mult": {
            "description": "مضاعف ATR لستوب التقلبات (Volatility Stop) (2.5)",
            "category": "risk",
        },
        "position_max_stop_pct": {
            "description": "أقصى وقف خسارة لمركز واحد — أوسع منه = مرفوض (10%)",
            "category": "risk",
        },
        # P0.6: per-stock-type stop loss percentages (migrated from
        # risk_management_advanced.py STOP_LOSS_EGX/STOP_LOSS_CRYPTO dicts).
        "stop_pct_large_bank_egx": {
            "description": "P0.6: وقف خسارة % لبنوك EGX الكبيرة (COMI, HRHO) = -7%",
            "category": "risk",
        },
        "stop_pct_medium_bank_egx": {
            "description": "P0.6: وقف خسارة % لبنوك EGX المتوسطة (SAUD, CAII) = -8%",
            "category": "risk",
        },
        "stop_pct_large_real_estate_egx": {
            "description": "P0.6: وقف خسارة % لعقارات EGX الكبيرة (MNHD, ORHD) = -10%",
            "category": "risk",
        },
        "stop_pct_small_real_estate_egx": {
            "description": "P0.6: وقف خسارة % لعقارات EGX الصغيرة = -12%",
            "category": "risk",
        },
        "stop_pct_large_industrial_egx": {
            "description": "P0.6: وقف خسارة % لصناعات EGX الكبيرة (SWDY, ESRS) = -8%",
            "category": "risk",
        },
        "stop_pct_small_industrial_egx": {
            "description": "P0.6: وقف خسارة % لصناعات EGX الصغيرة = -10%",
            "category": "risk",
        },
        "stop_pct_speculative_egx": {
            "description": "P0.6: وقف خسارة % لأسهم المضاربة EGX (tightest) = -5%",
            "category": "risk",
        },
        "stop_pct_suspended_egx": {
            "description": "P0.6: وقف خسارة % للأسهم الموقوفة EGX = 0 (لا تدخل)",
            "category": "risk",
        },
        "stop_pct_bitcoin_crypto": {
            "description": "P0.6: وقف خسارة % لبيتكوين (أقل تقلب) = -10%",
            "category": "risk",
        },
        "stop_pct_ethereum_crypto": {
            "description": "P0.6: وقف خسارة % لإيثيريوم (تقلب متوسط) = -12%",
            "category": "risk",
        },
        "stop_pct_large_altcoin_crypto": {
            "description": "P0.6: وقف خسارة % لـ altcoins الكبيرة = -15%",
            "category": "risk",
        },
        "stop_pct_small_altcoin_crypto": {
            "description": "P0.6: وقف خسارة % لـ altcoins الصغيرة = -20%",
            "category": "risk",
        },
        "stop_pct_meme_coin_crypto": {
            "description": "P0.6: وقف خسارة % لـ meme coins (مقامرة) = -25%",
            "category": "risk",
        },
        # Bollinger Bands
        "bb_period": {
            "description": "فترة البولنجر باند (20)",
            "category": "technical",
        },
        "bb_std_dev": {
            "description": "انحراف معياري للبولنجر (2.0)",
            "category": "technical",
        },
        "bb_squeeze_threshold": {
            "description": "عتبة ضغط البولنجر — تحتها سكوييز (0.8)",
            "category": "technical",
        },
        "bb_expansion_threshold": {
            "description": "عتبة تمدد البولنجر — فوقها انفجار (1.2)",
            "category": "technical",
        },
        # Adaptive Learning
        "adaptive_win_rate_lower": {
            "description": "نسبة النجاح لخفض العتبة — فوقها نخفض (65%)",
            "category": "adaptive",
        },
        "adaptive_win_rate_raise": {
            "description": "نسبة النجاح لرفع العتبة — تحتها نرفع (40%)",
            "category": "adaptive",
        },
        "adaptive_threshold_adjustment": {
            "description": "مقدار تعديل العتبة ديناميكياً (5 نقاط)",
            "category": "adaptive",
        },
        "default_buy_threshold": {
            "description": "العتبة الافتراضية للشراء (75)",
            "category": "adaptive",
        },
        "max_holding_days": {
            "description": "أقصى أيام احتفاظ بالإنتاج (30). Persona overrides: scalper=1, trader=10, conservative=30, investor=90 (موثّقة في unified_config.py). الباك-تست بيستخدم نافذة مختلفة (multi_target_exit.MAX_HOLDING_DAYS=90) — مفهوم مختلف.",
            "category": "adaptive",
        },
        "min_bars_for_analysis": {
            "description": "أقل عدد شموع للتحليل (200)",
            "category": "adaptive",
        },
        # Fundamentals
        "pe_strong_threshold": {
            "description": "P/E قوي — تحته أساسيات ممتازة (15)",
            "category": "fundamentals",
        },
        "pe_acceptable_threshold": {
            "description": "P/E مقبول — تحته أساسيات معقولة (25)",
            "category": "fundamentals",
        },
        "roe_strong_threshold": {
            "description": "ROE قوي — فوقه ربحية ممتازة (15%)",
            "category": "fundamentals",
        },
        "roe_acceptable_threshold": {
            "description": "ROE مقبول — فوقه ربحية معقولة (10%)",
            "category": "fundamentals",
        },
        "fund_score_strong": {
            "description": "درجة أساسيات قوية (60)",
            "category": "fundamentals",
        },
        "fund_score_weak": {
            "description": "درجة أساسيات ضعيفة — تحتها خصم (40)",
            "category": "fundamentals",
        },
        # Position Management
        "partial_sell_pct": {
            "description": "نسبة البيع الجزئي عند T1 (50%)",
            "category": "position",
        },
        "trailing_stop_activation_gain": {
            "description": "ربح تفعيل الوقف المتحرك (2%) — V40: تم خفضه من 3% لـ 2% لحماية الأرباح أبكر",
            "category": "position",
        },
        "hard_loss_ceiling_pct": {
            "description": "CRITICAL-DIRECTIVE: daily_closer hard ceiling — cap actual_return عند -7% (أصرم من multi_target_exit)",
            "category": "risk",
        },
        "split_drop_threshold_pct": {
            "description": "CRITICAL-DIRECTIVE: لو actual_return < -35% من entry → تجزئة سهم → استبعاد من P&L (35.0)",
            "category": "risk",
        },
        "danger_pnl_threshold": {
            "description": "حد الخسارة الخطرة — تحتها بيع فوري (-5%)",
            "category": "position",
        },
        "scale_in_pnl_threshold": {
            "description": "حد ربح الزيادة — فوقها نزود المركز (15%)",
            "category": "position",
        },
        "max_holding_expired_days": {
            "description": "أيام انتهاء الصلاحية بدون حركة (14)",
            "category": "position",
        },
        "bear_regime_score_deduction": {
            "description": "خصم من tech_score في السوق الهابط بدل حظر كامل (15 نقطة)",
            "category": "risk",
        },
        "accumulation_override_threshold": {
            "description": "حد شراء بالتجميع المؤسسي — لو maker+benchmark قوي → شراء عند هذا الحد (58)",
            "category": "risk",
        },
        # Confidence Tiers
        "confidence_top_pick": {
            "description": "عتبة TOP_PICK — أعلى توصية (75%)",
            "category": "confidence",
        },
        "confidence_strong": {
            "description": "عتبة STRONG — توصية قوية (60%)",
            "category": "confidence",
        },
        "confidence_watch": {
            "description": "عتبة WATCH — مراقبة فقط (45%)",
            "category": "confidence",
        },
        "daily_picks_cap": {
            "description": "أقصى عدد توصيات في اليوم (5)",
            "category": "confidence",
        },
        # SMC
        "smc_broke_resistance_score": {
            "description": "درجة SMC لكسر المقاومة (60)",
            "category": "smc",
        },
        "smc_broke_support_score": {
            "description": "درجة SMC لكسر الدعم (40)",
            "category": "smc",
        },
        "candle_prob_bullish_threshold": {
            "description": "عتبة احتمال شموع صاعدة (55%)",
            "category": "smc",
        },
        "candle_prob_bearish_threshold": {
            "description": "عتبة احتمال شموع هابطة (45%)",
            "category": "smc",
        },
        # Missing V39 / extra keys that were in DEFAULTS but not in schema
        "min_prediction_score": {
            "description": "أقل درجة توقع مسموح بيها — تحتها SKIP تماماً (60)",
            "category": "scoring",
        },
        "time_stop_days": {
            "description": "ستوب زمني: لو السهم متحركش في الكام يوم ده → مال مقيد → اخرج (45)",
            "category": "risk",
        },
        "time_stop_min_movement_pct": {
            "description": "أدنى حركة مطلوبة خلال فترة الستوب الزمني (3%)",
            "category": "risk",
        },
        "proof_weight_benchmark": {
            "description": "وزن إثبات القوة النسبية للمؤشر — EGX محسّن (22)",
            "category": "proofs",
        },
        "volume_surge_std_mult": {
            "description": "مضاعف الانحراف المعياري للحجم غير الطبيعي — V39 (1.5)",
            "category": "volume",
        },
        "base_buy_threshold": {
            "description": "حد الشراء الأساسي — سيتم تكييفه ديناميكياً — V39 (75)",
            "category": "adaptive",
        },
        "self_learning_adjustment_pct": {
            "description": "نسبة تعديل الحد من التعلم الذاتي — V39 (10%)",
            "category": "adaptive",
        },
        "self_learning_min_trades": {
            "description": "أدنى عدد صفقات مطلوبة للتعلم الذاتي (10)",
            "category": "adaptive",
        },
        "dynamic_rr_outperform": {
            "description": "R:R لما السهم أقوى من المؤشر — V39 (2.0)",
            "category": "targets",
        },
        "dynamic_rr_normal": {
            "description": "R:R عادي — V39 (1.5)",
            "category": "targets",
        },
        "atr_stop_mult_default": {
            "description": "مضاعف ATR للوقف الافتراضي — V39 (1.5)",
            "category": "risk",
        },
        "atr_stop_mult_high_vol": {
            "description": "مضاعف ATR للوقف في تذبذب عالي — V39 (2.5)",
            "category": "risk",
        },
        "atr_stop_mult_low_vol": {
            "description": "مضاعف ATR للوقف في تذبذب منخفض — V39 (1.0)",
            "category": "risk",
        },
        # V40: Evidence-Based Decision
        "strong_buy_evidence_count": {
            "description": "V40: أدنى عدد أدلة قوية للشراء القوي (3 من 6)",
            "category": "evidence",
        },
        "buy_evidence_count": {
            "description": "V40: أدنى عدد أدلة قوية للشراء العادي (2 من 6)",
            "category": "evidence",
        },
        "sell_evidence_count": {
            "description": "V40: أدنى عدد أدلة ضعف للبيع/التقليل (2 أدلة سلبية)",
            "category": "evidence",
        },
        "rs_required_for_strong_buy": {
            "description": "V40: القوة النسبية إلزامية للشراء القوي (1.0 = نعم)",
            "category": "evidence",
        },
        "rs_required_for_buy": {
            "description": "V40: القوة النسبية إلزامية للشراء العادي (0.0 = لا)",
            "category": "evidence",
        },
        "weak_evidence_blocks_buy": {
            "description": "V40: وجود دليل ضعف واضح يمنع الشراء (1.0 = نعم)",
            "category": "evidence",
        },
        # V40: Kill Filters
        "kill_filter_min_turnover_egp": {
            "description": "V40: حد السيولة الأدنى لفلاتر الاستبعاد (3M EGP)",
            "category": "kill_filter",
        },
        "kill_filter_min_stock_price": {
            "description": "V40: حد السعر الأدنى لفلاتر الاستبعاد (1 EGP)",
            "category": "kill_filter",
        },
        "kill_filter_max_volume_volatility": {
            "description": "V40: أقصى تذبذب حجم مسموح — فوقه = تلاعب (3.0)",
            "category": "kill_filter",
        },
        "kill_filter_min_data_bars": {
            "description": "V40: أدنى شموع مطلوبة للتحليل (60 يوم)",
            "category": "kill_filter",
        },
        "kill_filter_min_relative_strength": {
            "description": "V40: أقصى ضعف نسبي مسموح مقابل المؤشر (-2%)",
            "category": "kill_filter",
        },
        # V40: Absorption / Distribution tightening
        "absorption_lower_wick_pct": {
            "description": "V40: ذيل سفلي ≥ هذه النسبة للامتصاص (0.75)",
            "category": "absorption",
        },
        "distribution_upper_wick_pct": {
            "description": "V40: ذيل علوي ≥ هذه النسبة للتصريف (0.65)",
            "category": "absorption",
        },
        "absorption_require_upper_half_close": {
            "description": "V40: إغلاق في النصف العلوي إلزامي للامتصاص (1.0 = نعم)",
            "category": "absorption",
        },
        "absorption_min_volume_ratio": {
            "description": "V40: نسبة حجم أدنى للامتصاص (1.5) — V40.2 أرجعتها لـ 1.5 لتقليل الـ false absorption signals",
            "category": "absorption",
        },
        # V40: Partial Exit
        "partial_exit_at_rr": {
            "description": "V40.2: الخروج الجزئي عند الوصول لـ 1.5R (1.5) — تم رفعه من 1.0 لـ 1.5 لـ let winners run further ورفع PF",
            "category": "exit",
        },
        "partial_exit_pct": {
            "description": "V40: نسبة الخروج الجزئي من المركز (50%)",
            "category": "exit",
        },
        "partial_exit_trail_remaining": {
            "description": "V40: تفعيل trailing على الباقي بعد الخروج الجزئي (1.0 = نعم)",
            "category": "exit",
        },
        # V40.1: Position Sizing
        "position_sizing_enabled": {
            "description": "V40.1: تفعيل Position Sizing في الباكتست (1.0 = نعم)",
            "category": "position",
        },
        "risk_per_trade_pct": {
            "description": "V40.1: نسبة المخاطرة من رأس المال لكل صفقة (1.5%)",
            "category": "position",
        },
        # P41: Morning Bell + Exit Engine
        "morning_bell_max_picks": {"description": "P41: أقصى توصيات جرس الصباح (5)", "category": "morning_bell"},
        "morning_bell_refresh_minutes": {"description": "P41: دورة تجديد القائمة (15 دقيقة)", "category": "morning_bell"},
        "morning_bell_rvol_threshold": {"description": "P41: بوابة RVOL (1.5×)", "category": "morning_bell"},
        "morning_bell_min_extension_pct": {"description": "P41: أدنى امتداد يومي %", "category": "morning_bell"},
        "morning_bell_min_evidence": {"description": "P41: أدلة كحد أدنى للـ static fallback", "category": "morning_bell"},
        "morning_bell_session_start_min": {"description": "P41: بداية الجلسة (600 = 10:00)", "category": "morning_bell"},
        "morning_bell_session_end_min": {"description": "P41: نهاية الجلسة (870 = 14:30)", "category": "morning_bell"},
        "morning_bell_composite_w_rvol": {"description": "P41: وزن RVOL في الترتيب", "category": "morning_bell"},
        "morning_bell_composite_w_extension": {"description": "P41: وزن امتداد اليوم", "category": "morning_bell"},
        "morning_bell_composite_w_continuation": {"description": "P41: وزن حالة الاستمرار", "category": "morning_bell"},
        "morning_bell_composite_w_liquidity": {"description": "P41: وزن السيولة", "category": "morning_bell"},
        "exit_engine_tp1_partial_pct": {"description": "P41: نسبة الجني عند TP1 (0.30)", "category": "exit_engine"},
        "exit_engine_tp2_exit_pct": {"description": "P41: نسبة الجني عند TP2 (0.80)", "category": "exit_engine"},
        "exit_engine_overextended_gain_pct": {"description": "P41: ربح مفرط يستدعي جني (15%)", "category": "exit_engine"},
        "exit_engine_reversal_rvol_threshold": {"description": "P41: RVOL انعكاسي (2.0×)", "category": "exit_engine"},
        "exit_engine_reversal_loss_pct": {"description": "P41: خسارة انعكاسية (-2%)", "category": "exit_engine"},
        # ===== CANONICAL signal_*_threshold keys (Task UNIFICATION-PHASE-1) =====
        "signal_strong_buy_threshold": {"description": "CANONICAL: عتبة الشراء القوي (78) — مطابقة canonical_signal.py", "category": "scoring"},
        "signal_buy_threshold": {"description": "CANONICAL: عتبة الشراء العادي (65) — مطابقة canonical_signal.py", "category": "scoring"},
        "signal_accumulate_threshold": {"description": "CANONICAL: عتبة التجميع (55) — مطابقة canonical_signal.py", "category": "scoring"},
        "signal_hold_threshold": {"description": "CANONICAL: عتبة الاحتفاظ (40) — مطابقة canonical_signal.py", "category": "scoring"},
        "signal_sell_threshold": {"description": "CANONICAL: عتبة البيع (25) — مطابقة canonical_signal.py", "category": "scoring"},
        "signal_strong_sell_threshold": {"description": "CANONICAL: عتبة البيع القوي (<25) — مطابقة canonical_signal.py", "category": "scoring"},
        # ===== EGX-STRATEGY: min evidence count =====
        "min_evidence_count": {"description": "EGX-STRATEGY: أدنى عدد أدلة لازمة للدخول (3 من 6)", "category": "evidence"},
        # ===== PHASE-C: V40.2 generator config (daily_predictor thresholds → dynamic) =====
        "v402_max_picks_per_day": {"description": "V40.2: أقصى عدد توقعات في اليوم (5)", "category": "confidence"},
        "v402_min_ticker_days": {"description": "V40.2: أدنى أيام تاريخية لازمة للسهم (30)", "category": "limits"},
        "v402_scan_interval": {"description": "V40.2: فترة الفحص كل N أيام تداول (1)", "category": "limits"},
        "v402_buy_threshold": {"description": "V40.2: عتبة شراء V38BacktestEngine (75)", "category": "scoring"},
        "v402_min_evidence_count": {"description": "V40.2: أدنى أدلة لتوقع صالح (3)", "category": "evidence"},
        # --- Don't Chase filter ---
        "v402_chase_daily_gain_max": {"description": "V40.2: رفض لو daily gain > 12%", "category": "kill_filter"},
        "v402_chase_roc3_max": {"description": "V40.2: رفض لو 3-day ROC > 18%", "category": "kill_filter"},
        "v402_chase_roc5_max": {"description": "V40.2: رفض لو 5-day ROC > 28%", "category": "kill_filter"},
        # --- Near-peak filter ---
        "v402_near_peak_threshold": {"description": "V40.2: رفض لو القرب من القمة ≥ 95%", "category": "kill_filter"},
        "v402_near_peak_rsi_max": {"description": "V40.2: رفض لو RSI > 65 عند القمة", "category": "kill_filter"},
        # --- Drawdown filter ---
        "v402_drawdown_from_high_min": {"description": "V40.2: علم لو الانخفاض من القمة ≥ 5%", "category": "kill_filter"},
        # --- Pattern win-rate filter ---
        "v402_pattern_wr_min": {"description": "V40.2: عقّم لو pattern WR < 65%", "category": "kill_filter"},
        "v402_pattern_wr_boost": {"description": "V40.2: عزّز لو pattern WR ≥ 75%", "category": "kill_filter"},
        # --- Soft surge detector ---
        "v402_soft_surge_vol_ratio": {"description": "V40.2: عتبة نسبة الحجم للـ soft surge (2.0×)", "category": "volume"},
        "v402_soft_surge_roc5_min": {"description": "V40.2: أدنى 5-day ROC للـ soft surge (3.0)", "category": "volume"},
        "v402_soft_surge_rr_min": {"description": "V40.2: أدنى R:R لاختيارات soft surge (1.8)", "category": "targets"},
        # --- Fundamentals filter ---
        "v402_fund_score_min": {"description": "V40.2: رفض لو درجة الأساسيات < 30", "category": "fundamentals"},
        # --- V68 probability thresholds ---
        "v402_v68_prob_strong": {"description": "V40.2: احتمال V68 لإشارة قوية (70)", "category": "scoring"},
        "v402_v68_prob_moderate": {"description": "V40.2: احتمال V68 لإشارة متوسطة (50)", "category": "scoring"},
        "v402_v68_mag_rr_min": {"description": "V40.2: أدنى R:R للمغناطيسية V68 (2.0)", "category": "targets"},
        # --- Sector filter ---
        "v402_sector_min_count": {"description": "V40.2: أدنى عدد أسهم في القطاع للإحصاء (3)", "category": "kill_filter"},
        "v402_sector_decline_threshold": {"description": "V40.2: متوسط تغير القطاع لعلم الانخفاض (-1.0)", "category": "kill_filter"},
        "v402_sector_rising_pct_max": {"description": "V40.2: أقصى نسبة صاعدة لعلم انخفاض القطاع (0.25)", "category": "kill_filter"},
        # --- Volume / liquidity guards ---
        "v402_dead_volume_threshold": {"description": "V40.2: حجم تحته يعتبر السهم ميت (1000)", "category": "liquidity"},
        "v402_penny_stock_price": {"description": "V40.2: سعر تحته يعتبر سهم قرش (1.0)", "category": "liquidity"},
    }


def update_setting(key: str, value: Any, updated_by: str = "admin") -> bool:
    """
    Insert or update a single setting. Returns True on success.
    Invalidates the cache so the new value is visible immediately.
    """
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        # FIX (BRAVO-DISASTER 2026-10-28): was writable=False but update_setting does CREATE TABLE + INSERT + commit (get_setting at 511 stays read-only)
        conn = db_manager.get_connection(STOCKS_DB, writable=True)
        _ensure_schema(conn)
        # Determine type
        if isinstance(value, bool):
            value_str = "1" if value else "0"
            vtype = "bool"
        elif isinstance(value, int):
            value_str = str(value)
            vtype = "int"
        elif isinstance(value, float):
            value_str = str(value)
            vtype = "float"
        else:
            value_str = str(value)
            vtype = "str"

        meta = get_settings_descriptions().get(key, {})
        description = meta.get("description", "")
        category = meta.get("category", "general")

        conn.execute(
            """INSERT INTO system_settings (key, value, value_type, description, category, updated_at, updated_by)
               VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
               ON CONFLICT(key) DO UPDATE SET
                   value = excluded.value,
                   value_type = excluded.value_type,
                   description = excluded.description,
                   category = excluded.category,
                   updated_at = CURRENT_TIMESTAMP,
                   updated_by = excluded.updated_by""",
            (key, value_str, vtype, description, category, updated_by),
        )
        conn.commit()
        conn.close()
        invalidate_cache()
        return True
    except sqlite3.Error as e:
        logger.error("Failed to update setting %s: %s", key, e)
        return False


def update_many(updates: Dict[str, Any], updated_by: str = "admin") -> Dict[str, bool]:
    """Update multiple settings at once. Returns {key: success_bool}."""
    results: Dict[str, bool] = {}
    for key, value in updates.items():
        results[key] = update_setting(key, value, updated_by=updated_by)
    return results


def reset_to_defaults() -> bool:
    """Reset ALL settings to their hardcoded defaults. Returns True on success."""
    try:
        results = update_many(dict(DEFAULT_SETTINGS), updated_by="system-reset")
        return all(results.values())
    except Exception as e:
        logger.error("Failed to reset settings: %s", e)
        return False


# ──────────────────────────────────────────────────────────────────────────
# Convenience helpers — للـ thresholds الديناميكية المعقدة
# ──────────────────────────────────────────────────────────────────────────

def get_dynamic_buy_threshold(market_regime: str = "range") -> float:
    """
    احسب عتبة الشراء الديناميكية بناءً على حالة السوق.
    - bull  → buy_threshold_base + buy_threshold_bull_adjust (أقل = أسهل)
    - bear  → buy_threshold_base + buy_threshold_bear_adjust (أعلى = أصعب)
    - range → buy_threshold_base (الافتراضي)
    """
    base = get_setting("buy_threshold_base")
    regime = (market_regime or "range").lower()
    if "bull" in regime:
        return base + get_setting("buy_threshold_bull_adjust")
    if "bear" in regime:
        return base + get_setting("buy_threshold_bear_adjust")
    return base


def get_dynamic_atr_stop_mult(stock_volatility_pct: float = 0.0) -> float:
    """
    احسب مضاعف ATR للوقف بناءً على تذبذب السهم.
    - هادي (< calm threshold) → atr_stop_mult_calm
    - صاخب (> volatile threshold) → atr_stop_mult_volatile
    - بينهم → interpolation خطية
    """
    calm_mult = get_setting("atr_stop_mult_calm")
    volatile_mult = get_setting("atr_stop_mult_volatile")
    calm_thresh = get_setting("stock_volatility_calm")
    vol_thresh = get_setting("stock_volatility_volatile")
    if stock_volatility_pct <= calm_thresh:
        return calm_mult
    if stock_volatility_pct >= vol_thresh:
        return volatile_mult
    # Linear interpolation between calm and volatile
    ratio = (stock_volatility_pct - calm_thresh) / max(vol_thresh - calm_thresh, 0.01)
    return calm_mult + ratio * (volatile_mult - calm_mult)


def get_dynamic_min_rr(market_regime: str = "range") -> float:
    """
    احسب R/R الأدنى بناءً على حالة السوق.
    - bull  → min_rr_bull_market (أعلى = نطمع أكتر)
    - bear  → min_rr_bear_market (أعلى الآن = 1.8 — صفقات الارتداد النادرة)
    - range → min_rr_range_market (1.5 — was 1.2)

    V40.3 DIRECTIVE (2026-08-17): hard floor 1.5 مطلقًا — ممنوع إصدار أي توصية
    شراء بـ R:R < 1.5 تحت أي ظرف (العمولات + الانزلاق السعري بـ ياكل الـ edge).
    """
    regime = (market_regime or "range").lower()
    if "bull" in regime:
        rr = get_setting("min_rr_bull_market")
    elif "bear" in regime:
        rr = get_setting("min_rr_bear_market")
    else:
        rr = get_setting("min_rr_range_market")
    # Absolute floor — V40.3 directive: never below 1.5
    return max(1.5, float(rr))


def get_dynamic_rsi_overbought(trend_strength: float = 0.0) -> float:
    """
    احسب عتبة التشبع الشرائي الديناميكية.
    trend_strength: 0..1 (0 = لا ترند، 1 = ترند قوي جداً)
    → 70 + (trend_strength * 10) = 70..80
    """
    base = get_setting("rsi_overbought_base")
    adj = get_setting("rsi_trend_adjustment")
    return base + max(0.0, min(1.0, trend_strength)) * adj


def get_dynamic_rsi_oversold(trend_strength: float = 0.0) -> float:
    """
    احسب عتبة التشبع البيعي الديناميكية.
    → 30 - (trend_strength * 10) = 30..20 (في الترند الهابط نقبل لـ 20)
    """
    base = get_setting("rsi_oversold_base")
    adj = get_setting("rsi_trend_adjustment")
    return base - max(0.0, min(1.0, trend_strength)) * adj


def get_dynamic_volume_surge_mult(market_volatility_pct: float = 0.0) -> float:
    """
    احسب مضاعف الحجم المطلوب بناءً على صخب السوق.
    - هادي → 1.2x كفاية
    - صاخب → 1.8x مطلوب
    """
    calm_mult = get_setting("volume_surge_calm_market")
    busy_mult = get_setting("volume_surge_busy_market")
    thresh = get_setting("market_volatility_threshold")
    if market_volatility_pct <= thresh:
        return calm_mult
    return busy_mult


def get_dynamic_institutional_threshold(market_regime: str = "range") -> float:
    """
    احسب عتبة الشراء المؤسسي الديناميكية بناءً على حالة السوق.
    - bull  → institutional_buy_threshold - 5 (أسهل في السوق الصاعد)
    - bear  → institutional_buy_threshold + 5 (أصعب في السوق الهابط)
    - range → institutional_buy_threshold (الافتراضي)

    ده أهم عتبة في النظام — بيحدد امتى نشتري ونحن متأخرين 5 دقايق.
    """
    base = get_setting("institutional_buy_threshold")
    adj = get_setting("adaptive_threshold_adjustment")
    regime = (market_regime or "range").lower()
    if "bull" in regime:
        return max(50, base - adj)  # أسهل في السوق الصاعد
    if "bear" in regime:
        return min(85, base + adj)  # أصعب في السوق الهابط
    return base


def get_dynamic_proof_weights() -> Dict[str, float]:
    """
    احسب أوزان الإثباتات الستة ديناميكياً (V39).
    الأدمن يقدر يعدلها من لوحة التحكم.
    """
    return {
        "trend": get_setting("proof_weight_trend"),
        "makers": get_setting("proof_weight_makers"),
        "dna": get_setting("proof_weight_dna"),
        "fundamental": get_setting("proof_weight_fundamental"),
        "sector": get_setting("proof_weight_sector"),
        "benchmark": get_setting("proof_weight_benchmark"),  # V39
    }


# ──────────────────────────────────────────────────────────────────────────
# Self-test
# ──────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 70)
    print("🧪 Engine Settings Provider — اختبار ذاتي")
    print("=" * 70)
    settings = get_all_settings()
    print(f"\n📊 Total settings: {len(settings)}")
    print(f"   DB path: {STOCKS_DB}")
    for key in list(DEFAULT_SETTINGS.keys())[:8]:
        val = settings.get(key)
        print(f"   {key} = {val}")
    print("\n📊 Dynamic helpers:")
    print(f"   buy_threshold (bull)  = {get_dynamic_buy_threshold('bull')}")
    print(f"   buy_threshold (bear)  = {get_dynamic_buy_threshold('bear')}")
    print(f"   buy_threshold (range) = {get_dynamic_buy_threshold('range')}")
    print(f"   atr_stop_mult (calm 1%)    = {get_dynamic_atr_stop_mult(1.0)}")
    print(f"   atr_stop_mult (mid 4%)     = {get_dynamic_atr_stop_mult(4.0)}")
    print(f"   atr_stop_mult (volatile 8%)= {get_dynamic_atr_stop_mult(8.0)}")
    print(f"   min_rr (bull)  = {get_dynamic_min_rr('bull')}")
    print(f"   min_rr (bear)  = {get_dynamic_min_rr('bear')}")
    print(f"   rsi_overbought (trend=0.5) = {get_dynamic_rsi_overbought(0.5)}")
    print(f"   rsi_overbought (trend=1.0) = {get_dynamic_rsi_overbought(1.0)}")
    print(f"   volume_surge (calm 1%) = {get_dynamic_volume_surge_mult(1.0)}")
    print(f"   volume_surge (busy 3%)= {get_dynamic_volume_surge_mult(3.0)}")
    print("\n" + "=" * 70)
    print("✅ Engine Settings Provider جاهز")
