"""
opportunity_quality.py  (v2 — PHASE-C2)
========================================
منطق موحّد لتحديد "فرص المضارب" و"فرص المستثمر" + فلتر الأسهم الحية + دوران قطاعي.

المشكلة (قبل C1):
  - 192 إشارة BUY (83 strong_buy + 103 buy + 6 t1_buy) — تشوّش على المستخدم.
  - 66/90 (73%) من توصيات BUY ضعيفة (عائد فعلي ≤ 0 أو < 1/3 الهدف).
  - Coverage منخفض: Gambler 26.7%، Investor 0%.
  - is_investor_opportunity = 0 دائماً لأن pe_ratio مفقود لـ 1036/1039 سهم في EGX.

حلول C1 (الثلاثة معاً في هذا الملف):
  C1.1 فلتر أسهم حية:
      - strict (للمضارب): last_update < 24h + volume ≥ 10k + turnover_egp ≥ 500k + suspended=0
      - loose  (للمستثمر): last_update < 7d  + (volume>0 OR price>0) + suspended=0
      (الفرق: المضارب محتاج سيولة لحظية، المستثمر يكفيه إن السهم مش ميت.)
  C1.2 تقليل ضوضاء BUY — "Opportunity Quality Gate":
      الفرصة (أي persona) لازم تجتاز:
        - maestro_score ≥ 65
        - risk_reward ≥ 1.5
        - confidence ≥ 55
        - turnover_egp ≥ 500,000 (سيولة)
        - recommendation ∈ ('buy','strong_buy','t1_buy','swing_buy')
        - AND تأكيد (confirmation):
            * gambler:  volume_ratio ≥ 1.5 OR maestro_score ≥ 80 OR |change_1d| ≥ 3%
            * investor: roe ≥ 12 OR fair_value_upside ≥ 15 OR dividend_yield ≥ 2
      الإشارات اللي فوق عتبة recommendation بس مش بتجتاز الـ gate بتظهر كـ BUY
      عادي في النتائج، لكن مبتحصلش is_*_opportunity=1 → مش بتطلع في قائمة الفرص.
  C1.3 Fallback للمستثمر لما pe_ratio فاضي:
      pe_ratio = 0/NULL لـ 1036/1039 سهم EGX → ما ينفعش نعتمد عليه لوحده.
      لما pe_ratio مفقود، المستثمر بيتحدد بـ:
        - roe ≥ 12                (ربحية)
        - fair_value_upside ≥ 15  (سعر أقل من القيمة)
        - change_1m في [-10, +15] (استقرار نسبي)
        - dividend_yield ≥ 0.5    (توزيعات)
        - volatility ≤ 40         (مش متقلب جداً)
      known limitation: لما pe_ratio مفقود، precision أقل بـ ~15-20%. موثّق.

إضافات C2 — Sector Heat (دوران قطاعي للمضارب فقط):
  C2.1 compute_sector_heat_map(fundamentals_batch):
      بيحسب لكل قطاع: n_stocks, avg_change_1d, rising_ratio, total_volume.
      القطاع بيتصنّف:
        - 'hot'     لو avg_chg ≥ SECTOR_HEAT_MIN_AVG_CHG (1.0%)
                     AND rising_ratio ≥ SECTOR_HEAT_MIN_RISING_RATIO (60%)
                     AND n ≥ SECTOR_HEAT_MIN_SIZE (3)
        - 'dead'    لو avg_chg ≤ SECTOR_HEAT_DEAD_AVG_CHG (-1.0%)
                     AND rising_ratio ≤ SECTOR_HEAT_DEAD_RISING_RATIO (25%)
                     AND n ≥ SECTOR_HEAT_MIN_SIZE (3)
        - 'neutral' غير كده.
      القطاعات الـ junk ('—', 'Diversified', '', None) بتتتجاهل.
  C2.2 apply_sector_boost_to_gambler_rank(rank, sector, heat_map):
      - 'hot' sector → rank *= (1 + SECTOR_HEAT_BOOST)        (+15%)
      - 'dead' sector → rank *= (1 - SECTOR_HEAT_PENALTY)      (-10%، إزالة لا)
      - 'neutral'/unknown → rank بدون تغيير.
      المستثمر: مبيحصلش أي boost (هو مش ثيم مضاربة). ده مذكور صراحةً في الـ docstring.
      السهم الكويس فنياً في قطاع ميت بيتفضّل (penalty) بس مبيتمش إجبارياً (مفيش filter).

استخدام:
  from core.opportunity_quality import (
      is_live_stock_strict, is_live_stock_loose,
      is_gambler_opportunity, is_investor_opportunity,
      compute_gambler_rank_score, compute_investor_rank_score,
      compute_sector_heat_map, apply_sector_boost_to_gambler_rank,
      INVESTOR_FALLBACK_NOTE, OPPORTUNITY_MIN_SCORE,
  )

  # write-time (background_analyzer):
  flags = compute_persona_flags(rec_dict, fund_dict, stored_vol_ratio)

  # read-time (stored_analysis_routes):
  heat_map = compute_sector_heat_map(fundamentals_batch)   # مرّة واحدة لكل request
  if is_gambler_opportunity(rec, fund, stored): ...
  boosted_rank, boost_delta = apply_sector_boost_to_gambler_rank(rank, sector, heat_map)
"""

from __future__ import annotations

from typing import Any, Dict, Optional


# ──────────────────────────────────────────────────────────────────────────────
# C1.2 — Opportunity Quality Gate thresholds
# ──────────────────────────────────────────────────────────────────────────────
# P0-DYNAMIC (v3.68.0): الفلورات اتنزّلت لـ واقع EGX. قبل كده كانت 500K turnover
# + 10K volume + |chg_1d|≥3% → 542/542 صف g=0 و i=0 على الإنتاج لأن أغلب أسهم
# EGX مبتوصلش 500K EGP تيرنوفر يومي. الـ floors الجديدة (50K / 1K / 1.0%) لسه
# بوابات حقيقية (مش penny/junk) بسها مناسبة لسيولة EGX. فوق الـ floor ده،
# set_dynamic_thresholds() بترفع العتبة لو السوق نشط (percentile-based).
#
# P0-SCORE-EGX (v3.69.0): OPPORTUNITY_MIN_SCORE اتنزل 65 → 45 و CONFIDENCE
# 55 → 45. السبب: maestro_orchestrator بيـ produce scores محافظة جداً على EGX
# (أغلب BUY signals بـ score 35-55 بسبب تقلب EGX المعتدل). عتبة 65 كانت بتـ
# رفض كل الإشارات → 542/542 صف g=0. الـ floors الجديدة (45/45) لسه بوابات
# حقيقية (بتـ reject الـ bottom ~35%) لكنها مناسبة لـ reality EGX. باقي البوابات
# (RR≥1.5, turnover dynamic, rec∈BUY_FAMILY, gambler-confirmation) لسه بـ تعمل
# فلتر الضجيج — فـ تخفيض الـ score مش بـ يـ flood بإشارات ضعيفة.
OPPORTUNITY_MIN_SCORE = 45.0        # maestro_score ≥ 45 (was 65 — EGX-realistic)
OPPORTUNITY_MIN_RR = 1.5            # risk_reward ≥ 1.5
OPPORTUNITY_MIN_TURNOVER = 50_000   # EGP floor (was 500K — very few EGX stocks pass)
OPPORTUNITY_MIN_CONFIDENCE = 45.0   # confidence ≥ 45 (was 55 — EGX-realistic)

BUY_FAMILY = ('buy', 'strong_buy', 't1_buy', 'swing_buy', 'accumulate')


# ──────────────────────────────────────────────────────────────────────────────
# C1.1 — Live Stock Filter thresholds
# ──────────────────────────────────────────────────────────────────────────────
# P0-DYNAMIC: floors اتنزلت 10x. 10K volume كان بيرفض أغلب أسهم EGX الثانوية
# اللي حجمها 1K-5K بس سهميتها شرعية. 1K floor لسه بيستبعد الـ junk الميت.
LIVE_STRICT_MAX_AGE_HOURS = 24      # gambler: آخر تحديث خلال 24 ساعة
LIVE_STRICT_MIN_VOLUME = 1_000      # gambler: حجم ≥ 1k سهم (was 10k — EGX-realistic)
LIVE_STRICT_MIN_TURNOVER = 50_000   # gambler: تيرنوفر ≥ 50k EGP (was 500k)
LIVE_LOOSE_MAX_AGE_DAYS = 7         # investor: آخر تحديث خلال 7 أيام (مش ميت)


# ──────────────────────────────────────────────────────────────────────────────
# P0-DYNAMIC — Dynamic thresholds (percentile-based, set per-batch)
# ──────────────────────────────────────────────────────────────────────────────
# المشكلة: ثوابت 500K/10K/3% قاسية جداً على EGX → 542/542 g=0/i=0. الحل:
# set_dynamic_thresholds(batch_funds) بيحسب percentiles من الـ batch الحالي
# ويخزّنها module-level. البوابات بتستخدم max(FLOOR, percentile*factor) —
# كده في سوق هاديء الـ floor بيفوز (50K)، وفي سوق نشط الـ percentile بيرفع
# العتبة عشان نفلتر الضجيج. الـ read path (per-stock بدون batch) بـ يستخدم
# الـ floors بس — ده مقبول لأن الأعلام اتكتبت وقت الكتابة بالـ dynamic.
import threading as _thr

_DYNAMIC_LOCK = _thr.Lock()
_DYNAMIC = {
    'turnover_min': OPPORTUNITY_MIN_TURNOVER,      # effective turnover floor
    'volume_min': LIVE_STRICT_MIN_VOLUME,          # effective volume floor
    'chg_1d_confirm': 1.0,                         # gambler confirmation |chg_1d|
    'turnover_p40': 0.0,                           # diagnostic: p40 of batch turnover
    'volume_p40': 0.0,                             # diagnostic: p40 of batch volume
    'chg_abs_p60': 0.0,                            # diagnostic: p60 of |chg_1d|
    # PHASE-1A additions: Stock Alive Filter percentiles
    'atr_pct_p40': 0.0,                            # p40 of avg_atr_pct (stock_adaptive_profiles)
    'atr_pct_p50': 0.0,                            # p50 (median) of avg_atr_pct — Rule 8 ATR gate
    'volume_ratio_p60': 0.0,                       # p60 of volume_ratio (maestro, capped 50)
    'market_change_5d': 0.0,                       # EGX30 change_5d (batch median, for RS)
    'chg5d_p40': 0.0,                              # p40 of per-stock change_5d — Rule 8 mean-rev gate
    'batch_size': 0,                               # n stocks in the batch
    'populated': False,                            # has set_dynamic_thresholds run?
}


def set_dynamic_thresholds(batch_funds: list) -> dict:
    """احسب عتبات ديناميكية من batch بيانات الأسهم وخزّنها module-level.

    بتتستدعى مرة واحدة في بداية run_analysis_batch / _analyze_batch. بتحسب:
      - turnover_p40: الـ 40th percentile للـ turnover_egp في الـ batch
      - volume_p40:   الـ 40th percentile للـ volume
      - chg_abs_p60:  الـ 60th percentile لـ |change_1d|
    وبعدها البوابات بتستخدم max(FLOOR, percentile) عشان:
      - سوق هاديء (low turnover): الـ floor بيفوز → أسهم فوق 50K بتمر
      - سوق نشط (high turnover): الـ percentile بيرفع العتبة → فلتر ضجيج

    Args:
        batch_funds: list of fund dicts (each from stocks.db) — {turnover_egp,
                     volume, change_1d, ...}. ممكن يكون فيه None/0 values.

    Returns:
        dict بالـ thresholds الفعّالة (للـ log/diagnostic).
    """
    global _DYNAMIC
    if not batch_funds:
        with _DYNAMIC_LOCK:
            _DYNAMIC['populated'] = False
            _DYNAMIC['batch_size'] = 0
        return dict(_DYNAMIC)

    turnovers = []
    volumes = []
    chg_abs = []
    atr_pcts = []          # PHASE-1A: avg_atr_pct من stock_adaptive_profiles
    volume_ratios = []     # PHASE-1A: volume_ratio من maestro (capped 50)
    market_chgs_5d = []    # PHASE-1A: change_5d للسوق (median للـ RS)
    for f in batch_funds:
        if not f:
            continue
        t = _f(f.get('turnover_egp'), 0) or _f(f.get('value_traded'), 0)
        if t > 0:
            turnovers.append(t)
        v = _f(f.get('volume'), 0)
        if v > 0:
            volumes.append(v)
        c = abs(_f(f.get('change_1d'), 0))
        if c > 0:
            chg_abs.append(c)
        # PHASE-1A: اجمع atr_pct + volume_ratio + change_5d
        atr = _f(f.get('avg_atr_pct'), 0) or _f(f.get('atr_at_entry_pct'), 0)
        if atr > 0:
            atr_pcts.append(atr)
        vr_raw = _f(f.get('volume_ratio'), 0)
        if vr_raw > 0:
            vr = min(vr_raw, 50.0)  # cap (نفس compute_gambler_rank_score)
            volume_ratios.append(vr)
        chg5 = _f(f.get('change_5d'), 0)
        if chg5 != 0:
            market_chgs_5d.append(chg5)

    def _pct(sorted_list, pct):
        if not sorted_list:
            return 0.0
        sorted_list = sorted(sorted_list)
        k = max(0, min(len(sorted_list) - 1, int(round((pct / 100.0) * (len(sorted_list) - 1)))))
        return float(sorted_list[k])

    def _median(sorted_list):
        if not sorted_list:
            return 0.0
        sorted_list = sorted(sorted_list)
        n = len(sorted_list)
        if n % 2 == 1:
            return float(sorted_list[n // 2])
        return float((sorted_list[n // 2 - 1] + sorted_list[n // 2]) / 2)

    t_p40 = _pct(turnovers, 40)
    v_p40 = _pct(volumes, 40)
    c_p60 = _pct(chg_abs, 60)
    atr_p40 = _pct(atr_pcts, 40)        # PHASE-1A (legacy diagnostic)
    atr_p50 = _median(atr_pcts)         # PHASE-1A-v2: Rule 8 ATR gate (median)
    vr_p60 = _pct(volume_ratios, 60)    # PHASE-1A (legacy diagnostic)
    mkt_chg5d = _median(market_chgs_5d)  # PHASE-1A: median كـ proxy للسوق
    chg5d_p40 = _pct(market_chgs_5d, 40)  # PHASE-1A-v2: Rule 8 mean-rev gate (bottom 40%)

    # effective = max(FLOOR, percentile) — الـ floor يضمن حد أدنى، الـ percentile
    # يرفع لو السوق نشط. عامل 0.7 على الـ percentile عشان الـ floor يفضل له weight.
    eff_turnover = max(OPPORTUNITY_MIN_TURNOVER, t_p40 * 0.7)
    eff_volume = max(LIVE_STRICT_MIN_VOLUME, v_p40 * 0.7)
    eff_chg = max(1.0, c_p60 * 0.7)

    with _DYNAMIC_LOCK:
        _DYNAMIC.update({
            'turnover_min': eff_turnover,
            'volume_min': eff_volume,
            'chg_1d_confirm': eff_chg,
            'turnover_p40': t_p40,
            'volume_p40': v_p40,
            'chg_abs_p60': c_p60,
            # PHASE-1A: Stock Alive Filter percentiles
            'atr_pct_p40': atr_p40,
            'atr_pct_p50': atr_p50,         # Rule 8 ATR gate
            'volume_ratio_p60': vr_p60,
            'market_change_5d': mkt_chg5d,
            'chg5d_p40': chg5d_p40,         # Rule 8 mean-rev gate
            'batch_size': len(batch_funds),
            'populated': True,
        })
    print(f"[PERSONA_THRESHOLDS] batch={len(batch_funds)} "
          f"turnover_min={eff_turnover:.0f} (p40={t_p40:.0f}) "
          f"volume_min={eff_volume:.0f} (p40={v_p40:.0f}) "
          f"chg_1d_confirm={eff_chg:.2f} (p60={c_p60:.2f}) "
          f"atr_p40={atr_p40:.2f} atr_p50={atr_p50:.2f} "
          f"vr_p60={vr_p60:.2f} mkt5d={mkt_chg5d:+.2f} chg5d_p40={chg5d_p40:+.2f}")
    return dict(_DYNAMIC)


def get_dynamic_thresholds() -> dict:
    """إقرأ الـ thresholds الديناميكية الحالية (للـ diagnostic/tests)."""
    with _DYNAMIC_LOCK:
        return dict(_DYNAMIC)


# ──────────────────────────────────────────────────────────────────────────────
# PHASE-1A-v2 — Stock Alive Filter (data-driven redesign, Rule 8)
# ──────────────────────────────────────────────────────────────────────────────
# المرحلة 1أ (إعادة تصميم): فلتر "السهم الحي" — مبني على تحليل ارتباطي صارم
# على 603 صفقة مقفولة (بعد استبعاد anomalies).
#
# الاكتشاف الحاسم (correlation مع high%):
#   - atr_at_entry_pct  Spearman +0.28  → المقياس الوحيد الإيجابي (يتنبأ بالـ upside)
#   - volume_ratio      Spearman +0.02  → صفر تماماً (لا قوة تنبؤية)
#   - change_5d         Spearman -0.32  → mean reversion (اللي نزل بيرتد)
#   - change_1d         Spearman -0.40  → mean reversion أقوى
#
# القاعدة 8 الفائزة (gap +1.77pp, pass% 22.4%, إيجابي في كل الـ personas):
#   alive = (ATR ≥ batch median)  AND  (change_5d ≤ batch p40)
#   - ATR ≥ median: السهم متقلب بما يكفي ليتحرك (التقلب = فرصة)
#   - chg5d ≤ p40:  السهم في نطاق mean-reversion (نزل آخر 5 أيام → مرشح للارتداد)
#   - VR اتشال كـ gate (صفر قوة تنبؤية) — بيتسجل بس للـ diagnostic
#
# المبدأ الحاكم (من الـ user): "كل شيىء لازم يكون ديناميكى مع السوق" — كل
# العتبات percentiles من الـ batch الحالي، مفيش نسب ثابتة. الـ floor الوحيد
# هو حماية بيانات (ATR < 0.5% = السهم حرفياً ميت/متوقف).
# ──────────────────────────────────────────────────────────────────────────────

# Floors (حد أدنى بيانات — مش عتبة تداول. حماية من الـ junk الميت تماماً)
STOCK_ALIVE_ATR_PCT_FLOOR = 0.5       # ATR < 0.5% = السهم متوقف/ميت حرفياً
STOCK_ALIVE_VOLUME_RATIO_FLOOR = 1.0  # legacy diagnostic (مش gate بعد كده)
STOCK_ALIVE_RS_FLOOR = -3.0           # legacy diagnostic (مش gate بعد كده)

# Enforcement flag — لما False، الفلتر بـ log بس وما بيـ downgrade الـ persona.
#
# الحالة الحالية: LOG ONLY (enforce=False) — قرار المالك بعد تقرير الإنتاج.
# Rule 8 (ATR≥median AND chg5d≤p40) اتقاس على 584 صفقة نظيفة على جهاز الإنتاج:
#   - median gap = +0.64pp بس (تحت عتبة +1.0pp المطلوبة)
#   - avg high% للمرور أسوأ من المرفوض (بسبب رفض momentum بـ high% عالي زي DMNH)
#   - avg_return للمرور أسوأ (-3.21% vs -2.58%)
#   - الارتباطات ضعيفة على الإنتاج (ATR Spearman ≈ −0.04, chg5d ≈ 0)
# → الفلتر مش بيضيف قيمة تمييزية كافية كـ ENFORCE على المضارب دلوقتي.
# بيفضل شغّال كـ LOG عشان نجمع بيانات ونختار التعريف النهائي للحي بعد:
#   (1) محاكاة الخروج (phase1a_exit_simulation) و (2) bucket ثنائي momentum/mean-rev.
# لو الـ exit-sim أثبت إن المشكلة = exit مش entry، نرجّع نراجع التعريف مع Phase 2.
STOCK_ALIVE_ENFORCE = False


def evaluate_stock_alive(fund: dict, stored: dict) -> dict:
    """قيّم هل السهم "حي" بما يكفي للمضاربة — Rule 8 (data-driven).

    القاعدة: alive = (ATR ≥ batch median) AND (change_5d ≤ batch p40)
    - ATR ≥ median: السهم متقلب بما يكفي ليتحرك
    - chg5d ≤ p40:  mean-reversion (نزل آخر 5 أيام → مرشح للارتداد)
    VR اتشال كـ gate (Spearman +0.02 = صفر قوة تنبؤية) — بيتسجل بس.

    Args:
        fund: dict من stocks.db (فيه change_5d, avg_atr_pct, ...)
        stored: dict من stored_analyses/maestro (فيه volume_ratio, atr_at_entry_pct, ...)

    Returns:
        dict:
          'alive': bool
          'reason': str — للـ log
          'metrics': dict — القيم المقيسة
    """
    # اجمع metrics
    atr_pct = (
        _f(stored.get('atr_at_entry_pct'), 0)
        or _f(stored.get('avg_atr_pct'), 0)
        or _f(fund.get('avg_atr_pct'), 0)
    )
    vr_raw = _f(stored.get('volume_ratio'), 0) or _f(fund.get('volume_ratio'), 0)
    vr = min(vr_raw, 50.0) if vr_raw > 0 else 0.0  # cap + diagnostic

    stock_chg_5d = _f(fund.get('change_5d'), 0) or _f(stored.get('change_5d'), 0)
    market_chg_5d = _f(fund.get('market_change_5d'), 0)
    rs_vs_market = stock_chg_5d - market_chg_5d if (stock_chg_5d or market_chg_5d) else 0.0

    # Dynamic thresholds from the batch (percentiles — NO fixed ratios)
    _dyn = get_dynamic_thresholds()
    atr_median = _dyn.get('atr_pct_p50', 0)    # Rule 8 ATR gate
    chg5d_p40 = _dyn.get('chg5d_p40', 0)       # Rule 8 mean-rev gate

    # Effective ATR threshold = max(data_floor, batch_median).
    # الـ floor (0.5%) بياخد بس لما الـ batch فاضي/مش مت popul‌ated — عادي.
    eff_atr = max(STOCK_ALIVE_ATR_PCT_FLOOR, atr_median)

    # Rule 8: AND gate
    # 1) ATR ≥ median  (upside predictor — Spearman +0.28)
    # 2) chg5d ≤ p40   (mean-reversion — Spearman -0.32)
    reasons = []
    if atr_pct < eff_atr:
        reasons.append(f"atr={atr_pct:.2f}<{eff_atr:.2f}")
    if chg5d_p40 != 0 and stock_chg_5d > chg5d_p40:
        reasons.append(f"chg5d={stock_chg_5d:+.2f}>{chg5d_p40:+.2f}")
    # لو الـ batch مش مت popul‌ated (chg5d_p40=0)، نـ skip الـ mean-rev gate
    # بدل ما نرفض الكل — ده يحمي الـ live path لو set_dynamic_thresholds ماتركنش.

    alive = len(reasons) == 0
    return {
        'alive': alive,
        'reason': 'ALIVE' if alive else 'REJECT(' + ', '.join(reasons) + ')',
        'metrics': {
            'atr_pct': round(atr_pct, 3),
            'volume_ratio': round(vr, 3),        # diagnostic only (not a gate)
            'change_5d': round(stock_chg_5d, 3),
            'rs_vs_market': round(rs_vs_market, 3),  # diagnostic only
            'eff_atr_median': round(eff_atr, 3),
            'eff_chg5d_p40': round(chg5d_p40, 3),
        }
    }


# ──────────────────────────────────────────────────────────────────────────────
# PHASE-1B — Target/Stop sanity guards (fix target ≤ entry bug)
# ──────────────────────────────────────────────────────────────────────────────
# المرحلة 1ب: منع أي صفقة BUY بـ target_price ≤ entry_price (أو SELL بـ target ≥ entry).
#
# السبب الجذري (من EXPLORE-1B): DynamicTargetEngine بـ يحسب target من candles
# قديمة، بينما entry_price من live price → لو السهم طلع فوق الـ resistance القديم،
# الـ target بيطلع تحت الـ entry. الحل: guard صريح قبل record_prediction.
# ──────────────────────────────────────────────────────────────────────────────

# الحد الأدنى للـ R:R المخطط (Phase 1ج — لازم ≥ 1.5)
MIN_PLANNED_RR = 1.5

# الحد الأدنى للحركة المتوقعة (1% — أقل من كده الـ target ملوش معنى بعد العمولات)
MIN_TARGET_UPSIDE_PCT = 1.0


def validate_target_stop_direction(
    signal: str,
    entry_price: float,
    target_price: float,
    stop_loss: float,
) -> dict:
    """تحقّق إن الـ target/stop في الاتجاه الصح لكل من BUY و SELL.

    Phase 1ب: منع target ≤ entry للـ BUY (و target ≥ entry للـ SELL).

    Returns:
        dict: {'valid': bool, 'action': str, 'reason': str, 'fixed': dict|None}
        action ∈ {'ok', 'fix_target', 'reject'}
        fixed: القيم المصححة لو action='fix_target'
    """
    if not entry_price or entry_price <= 0:
        return {'valid': False, 'action': 'reject', 'reason': 'entry_price<=0', 'fixed': None}

    sig = (signal or '').upper().strip()
    is_buy = sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
    is_sell = sig in ('SELL', 'STRONG_SELL', 'REDUCE')

    if not is_sell:
        # Treat everything else (BUY, HOLD, UNKNOWN) as long bias because we only do LONG in EGX
        if target_price and target_price <= entry_price:
            fixed_target = round(entry_price * 1.03, 4)
            return {
                'valid': False,
                'action': 'fix_target',
                'reason': f'BUY/HOLD target={target_price}<=entry={entry_price}',
                'fixed': {'target_price': fixed_target},
            }
        if stop_loss and stop_loss >= entry_price:
            fixed_stop = round(entry_price * 0.97, 4)
            return {
                'valid': False,
                'action': 'fix_target',
                'reason': f'BUY/HOLD stop={stop_loss}>=entry={entry_price}',
                'fixed': {'stop_loss': fixed_stop},
            }
    else:  # SELL
        if target_price and target_price >= entry_price:
            fixed_target = round(entry_price * 0.97, 4)
            return {
                'valid': False,
                'action': 'fix_target',
                'reason': f'SELL target={target_price}>=entry={entry_price}',
                'fixed': {'target_price': fixed_target},
            }
        if stop_loss and stop_loss <= entry_price:
            fixed_stop = round(entry_price * 1.03, 4)
            return {
                'valid': False,
                'action': 'fix_target',
                'reason': f'SELL stop={stop_loss}<=entry={entry_price}',
                'fixed': {'stop_loss': fixed_stop},
            }

    return {'valid': True, 'action': 'ok', 'reason': 'direction_ok', 'fixed': None}


def compute_planned_rr(
    signal: str,
    entry_price: float,
    target_price: float,
    stop_loss: float,
) -> float:
    """احسب الـ R:R المخطط. سالب = خطأ. < 1.5 = ضعيف."""
    if not all([entry_price, target_price, stop_loss]):
        return 0.0
    if entry_price <= 0:
        return 0.0
    sig = (signal or '').upper().strip()
    is_buy = sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
    is_sell = sig in ('SELL', 'STRONG_SELL', 'REDUCE')
    if is_buy:
        risk = entry_price - stop_loss
        reward = target_price - entry_price
    elif is_sell:
        risk = stop_loss - entry_price
        reward = entry_price - target_price
    else:
        return 0.0
    if risk <= 0:
        return 0.0
    return round(reward / risk, 3)


def enforce_min_rr(
    signal: str,
    entry_price: float,
    target_price: float,
    stop_loss: float,
    min_rr: float = MIN_PLANNED_RR,
) -> dict:
    """Phase 1ج: ضامن إن planned R:R ≥ min_rr. لو أقل → وسّع الـ target.

    Returns:
        dict: {'rr': float, 'action': str, 'reason': str, 'fixed': dict|None}
        action ∈ {'ok', 'widen_target', 'reject'}
    """
    rr = compute_planned_rr(signal, entry_price, target_price, stop_loss)
    if rr <= 0:
        return {'rr': rr, 'action': 'reject', 'reason': 'rr<=0 (inverted)', 'fixed': None}
    if rr >= min_rr:
        return {'rr': rr, 'action': 'ok', 'reason': f'rr={rr}>={min_rr}', 'fixed': None}

    # لو R:R < min_rr → وسّع الـ target لـ entry + min_rr × risk
    sig = (signal or '').upper().strip()
    is_buy = sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
    is_sell = sig in ('SELL', 'STRONG_SELL', 'REDUCE')
    if is_buy and stop_loss < entry_price:
        risk = entry_price - stop_loss
        new_target = round(entry_price + min_rr * risk, 4)
        new_rr = compute_planned_rr(signal, entry_price, new_target, stop_loss)
        return {
            'rr': new_rr,
            'action': 'widen_target',
            'reason': f'rr={rr}<{min_rr} → target {target_price}->{new_target}',
            'fixed': {'target_price': new_target},
        }
    if is_sell and stop_loss > entry_price:
        risk = stop_loss - entry_price
        new_target = round(entry_price - min_rr * risk, 4)
        new_rr = compute_planned_rr(signal, entry_price, new_target, stop_loss)
        return {
            'rr': new_rr,
            'action': 'widen_target',
            'reason': f'rr={rr}<{min_rr} → target {target_price}->{new_target}',
            'fixed': {'target_price': new_target},
        }
    return {'rr': rr, 'action': 'reject', 'reason': 'cannot_fix_rr', 'fixed': None}


# ──────────────────────────────────────────────────────────────────────────────
# PRIORITY-1 — ATR-based Stop (يحل محل الـ fixed-% P26 stop)
# ──────────────────────────────────────────────────────────────────────────────
# قرار المالك بعد محاكاة الخروج (exit_simulation):
#   - محاكاة "التقاط 50% من القمة" قلبت الـ expectancy موجبة لكل المجموعات
#     (PASS / REJECT / ALL) بنفس الدرجة ≈ +5.65pp.
#   - ده أثبت إن المشكلة = EXIT مش entry. لكن الـ EXIT بيبدأ من الـ stop نفسه.
#   - الـ P26-PERSONA-RR الحالي بيستخدم نسب ثابتة:
#       gambler      stop -2%..-3%,   target +3%..+6%
#       balanced     stop -5%..-7%,   target +8%..+14%
#       conservative stop -10%..-15%, target +20%..+35%
#   - الـ conservative stop (-10%..-15%) واسع جداً → R:R مقلوب لو الـ target صغير.
#   - المطلوب: stop مربوط بـ ATR (يتكيف مع تذبذب السهم)، مش نسبة ثابتة.
#
# الحل: enforce_atr_based_stop() — بيحسب stop = entry - k × ATR
#   حيث k = مضاعف الـ persona:
#     gambler      k=1.0  (1 ATR — وقف ضيق، يقبل ضجيج intraday عشان السرعة)
#     balanced     k=1.5  (1.5 ATR — توازن بين الحماية والمساحة)
#     conservative k=2.0  (2 ATR — وقف أوسع، يتحمّل ضجيج لأفق أطول)
#
# Floor  = 1.0% (تحت كده العمولات بتاكل الصفقة)
# Ceiling = 8.0% (فوق كده السهم متطاير جداً — نـ cap علشان الـ risk مش يخرج عن السيطرة)
#
# لو ATR = 0 (غير متاح): بـ skip وبيـ سيّب الـ P26 stop كما هو (backward compat).
# بعدها enforce_min_rr بـ يتكفل بـ R:R ≥ 1.5 بتوسيع الـ target.
# ──────────────────────────────────────────────────────────────────────────────

# مضاعفات ATR لكل persona (كام ATR تحت الـ entry)
ATR_STOP_MULTIPLIERS = {
    'gambler': 1.0,       # 1 ATR — وقف ضيق (سرعة)
    'balanced': 1.5,      # 1.5 ATR — توازن
    'conservative': 2.0,  # 2 ATR — وقف أوسع (أفق طويل)
}

# حماية بيانات (مش عتبات تداول)
# 🔥 P0-v3 (تكليف المالك 2026-08-09): نطاق واقعي 3%-9% بدل 1%-8%.
# السبب: stop 1% بـ يضرب من العمولات + الـ spread، و stop 9% للأسهم المضاربية عالية التقلب.
# النطاق الجديد بـ يخلّي الـ stop ATR-based دايماً في نطاق تداول واقعي.
# 🔥 PILLAR-3 (تكليف المالك 2026-08-10): رفعنا ATR_STOP_MAX_PCT من 7% لـ 9% —
# الأسهم المضاربية المصرية كتير بتتحرك 7-9% ATR (HRHO, MFPC, COMI في news-driven
# sessions) و الـ 7% cap كان بـ يـ reject صفقات بـ R/R كويسة. الـ 9% بـ يـ allow
# الـ signal يـ accept + الـ kill-filter بـ يـ ensure الجودة بعدها.
ATR_STOP_MIN_PCT = 3.0   # PILLAR-3: stop distance ≥ 3% (تحت كده العمولات بـ تاكل الـ edge)
ATR_STOP_MAX_PCT = 9.0   # PILLAR-3: stop distance ≤ 9% (كان 7% — رفعناه للأسهم المضاربية عالية التقلب)


def _get_atr_stop_min_pct() -> float:
    """PILLAR-3: ATR_STOP_MIN_PCT settings-driven (engine_settings.py).

    Constitution Rule 11 — engine_settings.py هو المصدر الوحيد للحقيقة. الـ constant
    أعلاه بقى fallback فقط. الـ admin يقدر يـ tune القيمة من الـ UI بدون تعديل كود.
    """
    try:
        from analyzers.engine_settings import get_setting
        return float(get_setting('atr_stop_min_pct', default=ATR_STOP_MIN_PCT))
    except Exception:
        return ATR_STOP_MIN_PCT


def _get_atr_stop_max_pct() -> float:
    """PILLAR-3: ATR_STOP_MAX_PCT settings-driven (engine_settings.py).

    Constitution Rule 11 — engine_settings.py هو المصدر الوحيد للحقيقة. الـ constant
    أعلاه بقى fallback فقط. الـ admin يقدر يـ tune القيمة من الـ UI بدون تعديل كود.
    """
    try:
        from analyzers.engine_settings import get_setting
        return float(get_setting('atr_stop_max_pct', default=ATR_STOP_MAX_PCT))
    except Exception:
        return ATR_STOP_MAX_PCT


def enforce_atr_based_stop(
    signal: str,
    entry_price: float,
    stop_loss: float,
    atr: float,
    persona_type: str = 'balanced',
    lows: list = None,
) -> dict:
    """Priority 1: استبدل الـ fixed-% stop بـ ATR-based stop + swing low (ديناميكي).

    EGX-STRATEGY-DYNAMIC (المرحلة 1 — 2026-08-30):
    الوقف بقا ديناميكي — بـ يعتمد على آخر قاع واضح (swing low) + ATR.
    - لو في swing low واضح → stop = swing_low - 0.5×ATR (buffer تحت القاع).
    - لو مفيش → stop = entry - 1.5×ATR (المنطق القديم).
    - clamp لـ [5%, 9%] (PILLAR-3).

    stop = min(swing_low - buffer, entry - k×ATR)  ← نختار الأبعد (الأضيق لكن الآمن للسهم)

    Args:
        signal: BUY / STRONG_BUY / ACCUMULATE / ... / SELL
        entry_price: سعر الدخول
        stop_loss: الـ stop الحالي (من P26)
        atr: قيمة ATR المطلقة (من price_history)
        persona_type: gambler / balanced / conservative
        lows: list of recent lows (للـ swing low detection) — optional

    Returns:
        dict: {'action': str, 'reason': str, 'fixed': dict|None, 'atr_stop_pct': float, 'k': float}
        action ∈ {'replace_stop', 'skip'}
    """
    if not entry_price or entry_price <= 0:
        return {'action': 'skip', 'reason': 'entry<=0', 'fixed': None, 'atr_stop_pct': 0.0, 'k': 0.0}

    sig = (signal or '').upper().strip()
    is_buy = sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
    if not is_buy:
        return {'action': 'skip', 'reason': f'not_buy({sig})', 'fixed': None, 'atr_stop_pct': 0.0, 'k': 0.0}

    if not atr or atr <= 0:
        atr = entry_price * 0.015

    # ── UNIFIED-BALANCED-ONLY: k=1.5 ثابت ──
    persona = 'balanced'
    k = 1.5

    if entry_price <= 0:
        return None

    # ── EGX-STRATEGY-DYNAMIC: swing low detection ──
    # ابحث عن آخر قاع واضح في آخر 10-20 يوم
    swing_low = None
    swing_low_source = 'none'
    if lows and len(lows) >= 10:
        # خد آخر 10-20 low
        recent_lows = [l for l in lows[-20:] if l and l > 0]
        if len(recent_lows) >= 5:
            # swing low = أقل قاع في آخر 10 شموع
            swing_low_candidate = min(recent_lows[-10:]) if len(recent_lows) >= 10 else min(recent_lows)
            # تأكد إن القاع منطقي (تحت الدخول + مش بعيد أكتر من 12%)
            if swing_low_candidate > 0 and swing_low_candidate < entry_price:
                dist_pct = ((entry_price - swing_low_candidate) / entry_price) * 100
                if dist_pct <= 12.0:  # مش بعيد أكتر من 12% (وإلا الوقف هيبقى واسع جداً)
                    swing_low = swing_low_candidate
                    swing_low_source = f'swing_low={swing_low:.4f} (dist={dist_pct:.2f}%)'

    # حساب الـ stop الديناميكي
    if swing_low:
        # stop = swing_low - 0.5×ATR (buffer تحت القاع)
        buffer = 0.5 * atr
        dynamic_stop = swing_low - buffer
        dynamic_stop_pct = ((entry_price - dynamic_stop) / entry_price) * 100.0
        stop_source = f'swing_low ({swing_low_source}) + 0.5×ATR buffer'
    else:
        # fallback: ATR stop (المنطق القديم)
        dynamic_stop = entry_price - (atr * k)
        dynamic_stop_pct = (atr * k / entry_price) * 100.0
        stop_source = f'ATR fallback (k={k})'

    # Clamp لـ [5%, 9%] (PILLAR-3)
    _min_pct = _get_atr_stop_min_pct()
    _max_pct = _get_atr_stop_max_pct()
    clamped = False
    if dynamic_stop_pct < _min_pct:
        dynamic_stop = entry_price * (1 - _min_pct / 100.0)
        dynamic_stop_pct = _min_pct
        clamped = True
        stop_source += f' [CLAMPED to {_min_pct}%]'
    elif dynamic_stop_pct > _max_pct:
        dynamic_stop = entry_price * (1 - _max_pct / 100.0)
        dynamic_stop_pct = _max_pct
        clamped = True
        stop_source += f' [CLAMPED to {_max_pct}%]'

    new_stop = round(dynamic_stop, 4)
    old_stop_pct = 0.0
    if stop_loss and stop_loss > 0:
        old_stop_pct = ((entry_price - stop_loss) / entry_price) * 100.0

    _clamp_tag = ' [CLAMPED]' if clamped else ''
    return {
        'action': 'replace_stop',
        'reason': f'{stop_source} → stop_dist={dynamic_stop_pct:.2f}% (P26 was {old_stop_pct:.2f}%){_clamp_tag}',
        'fixed': {'stop_loss': new_stop},
        'atr_stop_pct': round(dynamic_stop_pct, 3),
        'k': k,
        'swing_low': swing_low,
        'stop_source': stop_source,
    }


def compute_dynamic_target(
    entry_price: float,
    stop_price: float,
    atr: float,
    highs: list = None,
    min_rr: float = 1.8,
) -> dict:
    """EGX-STRATEGY-DYNAMIC (المرحلة 1): حساب هدف ديناميكي مرتبط بمقاومة واضحة.

    المنطق:
    - لو في swing high (مقاومة) واضح قريب → target = swing_high.
    - لو مفيش → target = entry + 2×ATR (R:R = 2.0 تقريباً).
    - لازم R:R ≥ min_rr (1.8 default).
    - target_2 (Runner) = target × 1.5 أو entry + 5×ATR.

    Args:
        entry_price: سعر الدخول.
        stop_price: سعر الوقف (بعد enforce_atr_based_stop).
        atr: قيمة ATR.
        highs: list of recent highs (للـ swing high detection).
        min_rr: الحد الأدنى لـ R:R (1.8 default).

    Returns:
        {
            'target': float,
            'target_2': float (Runner),
            'rr': float,
            'source': str (swing_high / ATR fallback),
        }
    """
    if not entry_price or entry_price <= 0 or not stop_price or stop_price >= entry_price:
        return {'target': 0, 'target_2': 0, 'rr': 0, 'source': 'invalid'}

    risk = entry_price - stop_price
    if risk <= 0:
        return {'target': 0, 'target_2': 0, 'rr': 0, 'source': 'invalid'}

    # ── swing high detection ──
    swing_high = None
    swing_high_source = 'none'
    if highs and len(highs) >= 10:
        recent_highs = [h for h in highs[-50:] if h and h > 0]
        if len(recent_highs) >= 5:
            # swing high = أعلى قمة في آخر 20-50 شمعة (المقاومة القريبة)
            swing_high_candidate = max(recent_highs[-20:]) if len(recent_highs) >= 20 else max(recent_highs)
            # تأكد إن المقاومة فوق الدخول + مش بعيدة أكتر من 30%
            if swing_high_candidate > entry_price:
                dist_pct = ((swing_high_candidate - entry_price) / entry_price) * 100
                if dist_pct <= 30.0 and dist_pct >= 5.0:
                    swing_high = swing_high_candidate
                    swing_high_source = f'swing_high={swing_high:.4f} (dist=+{dist_pct:.2f}%)'

    # حساب الـ target
    if swing_high:
        target = swing_high
        rr = (target - entry_price) / risk
        target_source = f'swing_high ({swing_high_source})'
        # لو R:R أقل من min_rr → وسّع الـ target بـ ATR
        if rr < min_rr:
            target = entry_price + (2.0 * atr)
            rr = (target - entry_price) / risk
            target_source = f'swing_high R:R<{min_rr} → ATR fallback (2×ATR)'
    else:
        # fallback: ATR target (R:R = 2.0)
        target = entry_price + (2.0 * atr)
        rr = (target - entry_price) / risk
        target_source = 'ATR fallback (2×ATR)'

    # target_2 (Runner) = target × 1.5 أو entry + 5×ATR
    target_2_atr = entry_price + (5.0 * atr)
    target_2_mult = target * 1.5
    target_2 = max(target_2_atr, target_2_mult)
    target_2_source = f'max(target×1.5, entry+5×ATR)'

    return {
        'target': round(target, 4),
        'target_2': round(target_2, 4),
        'rr': round(rr, 3),
        'source': target_source,
        'target_2_source': target_2_source,
        'swing_high': swing_high,
    }


# ──────────────────────────────────────────────────────────────────────────────
# EGX-STRATEGY-STAGE2: رادار نوع السيولة (ميكرز vs مضاربة)
# ──────────────────────────────────────────────────────────────────────────────

def classify_liquidity(
    closes: list,
    volumes: list,
    opens: list = None,
    highs: list = None,
    lows: list = None,
) -> dict:
    """EGX-STRATEGY-STAGE2 (المرحلة 2): تصنيف نوع السيولة.

    يفرّق بين:
    - smart_accumulation: تجميع ذكي (ميكرز/مؤسسي) — حجم متدرج + سعر مستقر/صاعد
    - speculative_pump: ضخ مضاربي — حجم مفاجئ + سعر طلع بسرعة (هش)
    - neutral: سيولة عادية
    - weak: سيولة ضعيفة

    المنطق:
    1. حجم متدرج (3 أيام تصاعدي + فوق المتوسط) → smart_accumulation
    2. حجم مفاجئ (vol_ratio > 3x + ROC5 > 10%) → speculative_pump
    3. حجم ضعيف (vol_ratio < 0.7) → weak
    4. غير كده → neutral

    Returns:
        {
            'type': str (smart_accumulation / speculative_pump / neutral / weak),
            'type_ar': str,
            'score': float (0-100),  # قوة السيولة
            'vol_ratio': float,
            'vol_trend': str (increasing / decreasing / stable),
            'delta_vol': float,  # فرق الحجم الصاعد عن الهابط
            'recommendation': str,  # نصيحة للتعامل
            'position_size_mult': float,  # مضاعف حجم الصفقة
            'hold_multiplier': float,  # مضاعف مدة الاحتفاظ
        }
    """
    if not closes or not volumes or len(closes) < 10 or len(volumes) < 10:
        return {
            'type': 'neutral', 'type_ar': 'محايد', 'score': 50,
            'vol_ratio': 1.0, 'vol_trend': 'stable', 'delta_vol': 0,
            'recommendation': 'بيانات غير كافية', 'position_size_mult': 1.0, 'hold_multiplier': 1.0,
        }

    # حسابات أساسية
    avg_vol_20 = sum(volumes[-20:]) / min(20, len(volumes)) if len(volumes) >= 20 else sum(volumes) / len(volumes)
    last_vol = volumes[-1] if volumes[-1] else 0
    vol_ratio = (last_vol / avg_vol_20) if avg_vol_20 > 0 else 1.0

    # اتجاه الحجم (آخر 3 أيام)
    vols_3 = volumes[-3:] if len(volumes) >= 3 else volumes
    vol_trend = 'stable'
    if len(vols_3) >= 3:
        if vols_3[0] > 0 and vols_3[1] > 0 and vols_3[2] > 0:
            if vols_3[0] < vols_3[1] < vols_3[2]:
                vol_trend = 'increasing'
            elif vols_3[0] > vols_3[1] > vols_3[2]:
                vol_trend = 'decreasing'

    # delta_vol: فرق الحجم في الشموع الصاعدة عن الهابطة (آخر 5 أيام)
    delta_vol = 0
    if opens and len(opens) >= 5 and len(closes) >= 5:
        buy_vol = 0
        sell_vol = 0
        for i in range(-5, 0):
            if abs(i) <= len(volumes) and abs(i) <= len(closes) and abs(i) <= len(opens):
                is_green = closes[i] >= opens[i]
                vol = volumes[i] if volumes[i] else 0
                if is_green:
                    buy_vol += vol
                else:
                    sell_vol += vol
        delta_vol = buy_vol - sell_vol

    # ROC5
    roc5 = 0
    if len(closes) >= 6 and closes[-6] > 0:
        roc5 = ((closes[-1] - closes[-6]) / closes[-6]) * 100

    # تقييم الاستمرارية (هل الحركة مستمرة ولا هشة؟)
    # استمرارية = حجم متدرج + سعر مستقر (مش نزل بعد الصعود)
    sustained = False
    if vol_trend == 'increasing' and len(closes) >= 5:
        # آخر 3 شموع: مفيش نزلة كبيرة بعد الصعود
        max_drop = 0
        for i in range(-3, 0):
            if abs(i) <= len(closes) and closes[i-1] > 0:
                drop = ((closes[i-1] - closes[i]) / closes[i-1]) * 100
                if drop > max_drop:
                    max_drop = drop
        sustained = max_drop < 3.0  # مفيش نزلة أكبر من 3%

    # ── التصنيف ──
    liquidity_type = 'neutral'
    type_ar = 'محايد'
    score = 50
    recommendation = 'سيولة عادية'
    position_size_mult = 1.0
    hold_multiplier = 1.0

    # 1) smart_accumulation: حجم متدرج + استمرارية + vol_ratio > 1.2
    if vol_trend == 'increasing' and sustained and vol_ratio > 1.2:
        liquidity_type = 'smart_accumulation'
        type_ar = 'تجميع ذكي'
        score = 80
        recommendation = 'سيولة مؤسسية — دخول كامل + احتفاظ أطول'
        position_size_mult = 1.0  # حجم كامل
        hold_multiplier = 1.3  # احتفاظ أطول (الحركة مستمرة)

    # 2) speculative_pump: حجم مفاجئ + ROC5 > 10% (هش)
    elif vol_ratio > 3.0 and roc5 > 10.0:
        liquidity_type = 'speculative_pump'
        type_ar = 'ضخ مضاربي'
        score = 40
        recommendation = 'سيولة مضاربية هشة — حجم مقلل + خروج مبكر'
        position_size_mult = 0.6  # حجم مقلل 40%
        hold_multiplier = 0.7  # خروج مبكر (الحركة هشة)

    # 3) speculative_pump (أخف): vol_ratio > 2.5 + ROC5 > 7%
    elif vol_ratio > 2.5 and roc5 > 7.0:
        liquidity_type = 'speculative_pump'
        type_ar = 'ضخ مضاربي'
        score = 55
        recommendation = 'سيولة مضاربية — حجم مقلل قليلاً'
        position_size_mult = 0.8  # حجم مقلل 20%
        hold_multiplier = 0.85  # خروج مبكر نسبياً

    # 4) weak: حجم ضعيف
    elif vol_ratio < 0.7:
        liquidity_type = 'weak'
        type_ar = 'سيولة ضعيفة'
        score = 25
        recommendation = 'سيولة ضعيفة — حذر شديد'
        position_size_mult = 0.5  # حجم مقلل 50%
        hold_multiplier = 0.8

    # 5) smart_accumulation (أخف): delta_vol > 0 + vol_ratio > 1.0 + استمرارية
    elif delta_vol > 0 and vol_ratio > 1.0 and sustained:
        liquidity_type = 'smart_accumulation'
        type_ar = 'تجميع ذكي'
        score = 70
        recommendation = 'سيولة إيجابية — حجم طبيعي'
        position_size_mult = 1.0
        hold_multiplier = 1.15

    return {
        'type': liquidity_type,
        'type_ar': type_ar,
        'score': score,
        'vol_ratio': round(vol_ratio, 2),
        'vol_trend': vol_trend,
        'delta_vol': round(delta_vol, 0),
        'roc5': round(roc5, 2),
        'sustained': sustained,
        'recommendation': recommendation,
        'position_size_mult': position_size_mult,
        'hold_multiplier': hold_multiplier,
    }


# ──────────────────────────────────────────────────────────────────────────────
# C1.3 — Investor fallback (when pe_ratio missing)
# ──────────────────────────────────────────────────────────────────────────────
# واقع البيانات EGX: pe_ratio = NULL/0 لـ 1036/1039 سهم، roe=15.0 (default placeholder)
# لمعظمهم، fair_value column غير موجودة → fair_value_upside = 0 دائماً. لو اعتمدنا
# على fvu≥15 هيفشل دائماً. فصلنا الـ fallback لطبقتين:
#   Layer A (stability): change_1m ∈ [-10, +15] AND volatility ≤ 40 — المختلف الحقيقي
#       بين المستثمر (استقرار) والمضارب (زخم).
#   Layer B (proxy fundamental): roe ≥ 12 OR dividend_yield ≥ 0.5 (إشارة إن السهم
#       "شركة حقيقية" مش penny stock). ملاحظة: roe=15 و div=6 هما default لمصدر
#       بيانات EGX، مش قيم حقيقية — الـ Layer A هو الفعّال فعلياً.
INVESTOR_FALLBACK_ROE_MIN = 12.0
INVESTOR_FALLBACK_CHG_1M_MIN = -10.0
INVESTOR_FALLBACK_CHG_1M_MAX = 15.0
INVESTOR_FALLBACK_DIV_MIN = 0.5
INVESTOR_FALLBACK_VOLAT_MAX = 40.0

# Investor مع pe_ratio (المسار الأساسي)
INVESTOR_PRIMARY_PE_MIN = 5.0
INVESTOR_PRIMARY_PE_MAX = 20.0
INVESTOR_PRIMARY_ROE_MIN = 10.0
INVESTOR_PRIMARY_CHG_1M_MIN = -5.0
INVESTOR_PRIMARY_CHG_1M_MAX = 10.0


# ──────────────────────────────────────────────────────────────────────────────
# C3 — Balanced (المتوازن — تقاطع موزون ديناميكي بين gambler و investor)
# ──────────────────────────────────────────────────────────────────────────────
# المتوازن = مش محرك رابع. هو تقاطع موزون ديناميكي بين منطق الصيد (المضارب)
# ومنطق القيمة (المستثمر). الهدف: السهم اللي عنده زخم معتدل + أساسيات مقبولة
# نسبياً → فرصة متوازنة. مش حاد زي المضارب (مش محتاج |chg_1d|≥3%)، مش صارم
# زي المستثمر (مش محتاج pe∈[5,20] + roe≥10).
#
# الشرط المزدوج المرن (ديناميكي من السوق، مش أرقام ثابتة في الكود):
#   - زخم فوق متوسط السوق الحالي (أحد الثلاثة كافٍ):
#       change_1d ≥ +0.5%   (حركة intraday معتدلة)
#       OR volume_ratio ≥ 1.2  (حجم فوق المتوسط)
#       OR maestro_score ≥ 65  (إشارة maestro قوية)
#   - AND أساسيات مش في القاع النسبي للقطاع (أحد الأربعة كافٍ):
#       roe ≥ 8            (مش ضعيف ربحياً)
#       OR fair_value_upside ≥ 5%  (خصم بسيط عن القيمة)
#       OR dividend_yield ≥ 0.3%   (توزيعات موجودة)
#       OR change_1m ≥ -5%         (مش في قاع شهري)
#
# عتبات منخفضة عمدًا — المتوازن بياخد "الوسط". لو رفعناها → بقت investor.
# لو خفّضناها → بقت gambler. الوسط = تقاطع موزون.
BALANCED_MOMENTUM_CHG_1D_MIN = 0.5     # change_1d ≥ +0.5% (زخم معتدل)
BALANCED_MOMENTUM_VR_MIN = 1.2         # volume_ratio ≥ 1.2 (حجم فوق المتوسط)
BALANCED_MOMENTUM_SCORE_MIN = 65.0     # maestro_score ≥ 65 (إشارة قوية)
BALANCED_FUND_ROE_MIN = 8.0            # roe ≥ 8 (مش ضعيف ربحياً)
BALANCED_FUND_FVU_MIN = 5.0            # fair_value_upside ≥ 5% (خصم بسيط)
BALANCED_FUND_DIV_MIN = 0.3            # dividend_yield ≥ 0.3%
BALANCED_FUND_CHG_1M_MIN = -5.0        # change_1m ≥ -5% (مش في قاع شهري)

BALANCED_NOTE = (
    "Balanced (C3): تقاطع موزون ديناميكي بين المضارب والمستثمر. مش محرك رابع. "
    "الشرط المزدوج المرن: زخم معتدل (chg_1d≥0.5% OR vr≥1.2 OR score≥65) AND "
    "أساسيات مش في القاع (roe≥8 OR fvu≥5 OR div≥0.3 OR chg_1m≥-5). العتبات "
    "منخفضة عمدًا — المتوازن بياخد الوسط. لو رفّعناها → بقت investor. لو "
    "خفّضناها → بقت gambler. درجة الترتيب = 0.5×gambler_rank + 0.5×investor_rank."
)

# توثيق النقص المعروف (C1.3)
INVESTOR_FALLBACK_NOTE = (
    "نقص بيانات pe_ratio معروف: 1036/1039 سهم EGX عندهم pe_ratio = NULL/0 في stocks.db. "
    "لما pe_ratio مفقود، قرار المستثمر بيتحسب بـ fallback من طبقتين: "
    "(A) stability: change_1m ∈ [-10,+15] AND volatility ≤ 40 — المختلف الحقيقي بين "
    "المستثمر (استقرار) والمضارب (زخم). "
    "(B) proxy: roe ≥ 12 OR dividend_yield ≥ 0.5 (إشارة إن السهم شركة حقيقية). "
    "ملاحظة: roe=15.0 و div=6.0 هما default placeholder لمصدر بيانات EGX، مش قيم "
    "حقيقية. الـ Layer A هو الفعّال فعلياً. الـ fallback أقل دقة بـ ~15-20% من "
    "المسار الأساسي (pe-based). الإصلاح الجذري محتاج مصدر fundamentals كامل."
)

# FVU threshold used by investor fallback (Layer B) — present for documentation/__all__
INVESTOR_FALLBACK_FVU_MIN = 15.0


# ──────────────────────────────────────────────────────────────────────────────
# C2 — Sector Heat (دوران قطاعي — للمضارب فقط)
# ──────────────────────────────────────────────────────────────────────────────
# الواقع: EGX بيتحرك كقطاعات (أدوية/مطاحن/بنوك/عقارات). المضارب الذكي بيدور
# على القطاع السخن ويركّز سلّته جواه. النظام قبل C2 كان بيشوف السهم كأنه
# جزيرة معزولة — مفيش "قطاع سخن → ارفع أولوية أبناء القطاع".
#
# الحل (خفيف وع قابل للضبط):
#   1) compute_sector_heat_map() بيجمّع change_1d + عدد الصاعد/الهابط لكل قطاع.
#   2) القطاع "سخن" لو avg_chg ≥ 1% AND ≥60% صاعد AND n≥3.
#   3) القطاع "ميت" لو avg_chg ≤ -1% AND ≤25% صاعد AND n≥3.
#   4) في ترتيب المضارب بس: سهم في قطاع سخن → +15% boost، قطاع ميت → -10% penalty.
#   5) المستثمر: مبيحصلش أي boost (هو مش ثيم مضاربة — مذكور صراحةً في الطلب).
#   6) السهم في قطاع ميت مبيتمش إجبارياً (penalty بس، مش filter) — عشان C2 خفيف.
#
# الـ thresholds قابلة للضبط. السوق في الساندبوكس دلوقتي flat (مفيش قطاع ≥ +2%)،
# فعتبة +1% بتجيب قطاعين (الخدمات الصناعية، خدمات التوزيع) — ده معقول للـ seed.
# في الإنتاج لما قطاع الأدوية يسخن (+3-5%)، العتبة هتمسكه بسهولة.
SECTOR_HEAT_MIN_SIZE = 3           # أقل عدد أسهم عشان نسمّيها "قطاع"
SECTOR_HEAT_MIN_AVG_CHG = 1.0      # avg change_1d ≥ +1% → مرشّح للسخونة
SECTOR_HEAT_MIN_RISING_RATIO = 0.60  # ≥ 60% صاعد → مرشّح للسخونة
SECTOR_HEAT_DEAD_AVG_CHG = -1.0    # avg change_1d ≤ -1% → مرشّح للموت
SECTOR_HEAT_DEAD_RISING_RATIO = 0.25  # ≤ 25% صاعد → مرشّح للموت
SECTOR_HEAT_BOOST = 0.15           # +15% لدرجة المضارب في قطاع سخن
SECTOR_HEAT_PENALTY = 0.10         # -10% لدرجة المضارب في قطاع ميت (مش إزالة)

# قطاعات junk في stocks.db — بتتتجاهل في حساب السخونة (مش قطاعات حقيقية)
SECTOR_HEAT_EXCLUDE = {
    '', None, '—', 'Diversified', 'diversified', 'غير مصنف', 'N/A', 'nan',
}

# توثيق قرارات C2 للقطاع
SECTOR_HEAT_NOTE = (
    "Sector Heat (C2): دوران قطاعي للمضارب فقط. القطاع 'سخن' لو avg_chg≥1% AND "
    "≥60% صاعد AND n≥3. القطاع 'ميت' لو avg_chg≤-1% AND ≤25% صاعد AND n≥3. "
    "سهم المضارب في قطاع سخن → +15% boost على gambler_rank_score. سهم في قطاع "
    "ميت → -10% penalty (مش إزالة — السهم الكويس فنياً بيفضل، بس بيتفضّل). "
    "المستثمر: مبيحصلش أي boost (مش ثيم مضاربة). "
    "ملاحظة: بيانات الساندبوكس flat (مفيش قطاع ≥ +2% دلوقتي)، فعتبة +1% بتمسك "
    "قطاعين. في الإنتاج (أدوية/مطاحن تسخن +3-5%) العتبة شغّالة بسهولة. "
    "الـ thresholds قابلة للضبط في opportunity_quality.py."
)


# ──────────────────────────────────────────────────────────────────────────────
# helpers
# ──────────────────────────────────────────────────────────────────────────────
def _f(v: Any, default: float = 0.0) -> float:
    """parse numeric safe."""
    if v is None:
        return default
    try:
        return float(v)
    except (ValueError, TypeError):
        return default


def _parse_last_update_age_hours(last_update: Any) -> Optional[float]:
    """تحويل last_update (ISO text) لـ age in hours. None لو غير قابل للparse."""
    if not last_update:
        return None
    s = str(last_update).strip()
    if not s:
        return None
    # جرّب صيغ ISO الشائعة
    from datetime import datetime, timezone
    # SQLite/Timestamp variants
    for fmt in (
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%dT%H:%M:%S.%f',
        '%Y-%m-%d %H:%M:%S.%f',
    ):
        try:
            dt = datetime.strptime(s.replace('Z', ''), fmt)
            now = datetime.now()
            age = (now - dt).total_seconds() / 3600.0
            return max(age, 0.0)
        except ValueError:
            continue
    return None


def _newest_age_hours(*candidates: Any) -> Optional[float]:
    """أصغر (أحدث) age صالح من بين عدة مصادر timestamp.

    PERSONA-FLAGS-FIX (v3.57.0): is_live_stock_strict/loose كانوا بياخدوا
    ``fund['last_update'] or stored['updated_at']`` — أي لو ``last_update``
    في stocks.db نص صالح بس قديم (>24h)، الفلتر كان بيرفض السهم حتى لو
    الـ analysis row اتكتب دلوقتي (stored.updated_at = now). ده خلى كل
    الـ BUY flags = 0 على الإنتاج رغم إن التحليل طازج.

    الحل: نختار أحدث (أصغر age) إشارة متاحة. وقت الكتابة stored.updated_at=now
    فبيفوز → السهم الطازج بيمر. وقت القراءة stored.updated_at بيشيخ طبيعي
    → السهم القديم بيتعرض صح.
    """
    best: Optional[float] = None
    for c in candidates:
        if not c:
            continue
        age = _parse_last_update_age_hours(c)
        if age is None:
            continue
        if best is None or age < best:
            best = age
    return best


def _is_suspended(fund: dict, stored: dict) -> bool:
    """سهم موقوف؟ نتحقق من fund.is_suspended و stored (احتياطي)."""
    if _f(fund.get('is_suspended'), 0) >= 1:
        return True
    if _f(stored.get('is_suspended'), 0) >= 1:
        return True
    return False


# ──────────────────────────────────────────────────────────────────────────────
# C1.1 — Live Stock Filter
# ──────────────────────────────────────────────────────────────────────────────
def is_live_stock_strict(fund: dict, stored: dict) -> bool:
    """فلتر أسهم حية صارم — إلزامي للمضارب.

    معايير:
      - مش موقوف (is_suspended = 0)
      - آخر تحديث خلال 24 ساعة (بيانات طازجة)
      - volume ≥ 10,000 سهم (سيولة حقيقية)
      - turnover_egp ≥ 500,000 EGP (قيمة متداولة كافية)
      - current_price > 0
    """
    if not fund and not stored:
        return False
    if _is_suspended(fund, stored):
        return False
    # last_update age — PERSONA-FLAGS-FIX (v3.57.0): أحدث إشارة freshness
    # تفوز (stored.updated_at وقت الكتابة = now، fund.last_update وقت
    # القراءة). ده بيخلّي السهم اللي اتحلل دلوقتي يمر حتى لو stocks.db
    # last_update قديم/فاضي.
    age_h = _newest_age_hours(
        fund.get('last_update'),
        stored.get('updated_at'),
        stored.get('last_update'),
    )
    if age_h is None or age_h > LIVE_STRICT_MAX_AGE_HOURS:
        return False
    # P0-DYNAMIC: volume/turnover floors ديناميكية (max(FLOOR, p40*0.7))
    _dyn_vol = _DYNAMIC['volume_min'] if _DYNAMIC['populated'] else LIVE_STRICT_MIN_VOLUME
    _dyn_turn = _DYNAMIC['turnover_min'] if _DYNAMIC['populated'] else LIVE_STRICT_MIN_TURNOVER
    # volume (prefer fund, fallback to stored)
    volume = _f(fund.get('volume'), 0) or _f(stored.get('volume'), 0)
    if volume < _dyn_vol:
        return False
    # turnover (prefer stored.turnover_egp, fallback to fund.value_traded)
    turnover = (
        _f(stored.get('turnover_egp'), 0)
        or _f(fund.get('turnover_egp'), 0)
        or _f(fund.get('value_traded'), 0)
    )
    if turnover < _dyn_turn:
        return False
    # price sanity (prefer fund, fallback to stored — PERSONA-FLAGS-FIX v3.57.0)
    price = _f(fund.get('current_price'), 0) or _f(stored.get('current_price'), 0)
    if price <= 0:
        return False
    return True


def is_live_stock_loose(fund: dict, stored: dict) -> bool:
    """فلتر أسهم حية خفيف — للمستثمر (استبعاد الميت فقط).

    معايير:
      - مش موقوف
      - آخر تحديث خلال 7 أيام (مش ميت/متوقف)
      - (volume > 0 OR current_price > 0) — علامة حياة
    """
    if not fund and not stored:
        return False
    if _is_suspended(fund, stored):
        return False
    # PERSONA-FLAGS-FIX (v3.57.0): أحدث إشارة freshness تفوز (نفس strict).
    age_h = _newest_age_hours(
        fund.get('last_update'),
        stored.get('updated_at'),
        stored.get('last_update'),
    )
    if age_h is None or age_h > (LIVE_LOOSE_MAX_AGE_DAYS * 24):
        return False
    # علامة حياة: volume OR current_price (مع fallback لـ stored)
    volume = _f(fund.get('volume'), 0) or _f(stored.get('volume'), 0)
    price = _f(fund.get('current_price'), 0) or _f(stored.get('current_price'), 0)
    if volume <= 0 and price <= 0:
        return False
    return True


# ──────────────────────────────────────────────────────────────────────────────
# C1.2 — Opportunity Quality Gate (shared by both personas)
# ──────────────────────────────────────────────────────────────────────────────
def _passes_quality_gate(rec: dict, fund: dict, stored: dict) -> bool:
    """البوابة المشتركة: لازم تجتازها أي فرصة (gambler أو investor).

    معايير:
      - recommendation ∈ BUY_FAMILY
      - maestro_score ≥ 65
      - risk_reward ≥ 1.5
      - confidence ≥ 55
      - turnover_egp ≥ dynamic floor (max(50K, p40*0.7) — P0-DYNAMIC)
    """
    rec_lower = (rec.get('recommendation') or '').lower()
    if rec_lower not in BUY_FAMILY:
        return False
    if _f(rec.get('maestro_score')) < OPPORTUNITY_MIN_SCORE:
        return False
    if _f(rec.get('risk_reward')) < OPPORTUNITY_MIN_RR:
        return False
    if _f(rec.get('confidence')) < OPPORTUNITY_MIN_CONFIDENCE:
        return False
    turnover = (
        _f(stored.get('turnover_egp'), 0)
        or _f(fund.get('turnover_egp'), 0)
        or _f(fund.get('value_traded'), 0)
    )
    # P0-DYNAMIC: استخدم الـ turnover floor الديناميكي (max(FLOOR, p40*0.7))
    _dyn_turn = _DYNAMIC['turnover_min'] if _DYNAMIC['populated'] else OPPORTUNITY_MIN_TURNOVER
    if turnover < _dyn_turn:
        return False
    return True


def _passes_gambler_confirmation(rec: dict, fund: dict, stored: dict) -> bool:
    """تأكيد المضارب: زخم حقيقي + حجم انفجاري + قوة نسبية.

    🔥 P0-v6 FIX #4 (MOMENTUM-AND-GATE):
       المالك اشتكى إن المضارب بيدخل في أسهم ميتة ويفوّت الأسهم اللي بتطير.
       الـ logic القديم كان OR-gate ضعيف: (chg≥1% OR score≥80 OR 1.5≤vr≤50).
       ده كان بيـ let dead stocks تـ qualify لو بس score≥80 (سهل).

       الـ logic الجديد AND-gate صارم (3 شروط مجتمعة):
         (1) Volume Spike ≥ 2.0x المتوسط (vr ≥ 2.0) — وقود للحركة
         (2) Breakout proxy: |chg_1d| ≥ 1.5% OR chg_1w ≥ 4% — السهم بيتحرّك فعلاً
         (3) Relative Strength ≥ 0 vs batch-median — السهم أقوى من السوق

       استثناء: لو score ≥ 90 (إشارة maestro استثنائية) → اقبل حتى لو أحد الشروط
       ناقص (defense-in-depth — ما نرفضش فرصة خرافية بس لأن vr=1.8 بدل 2.0).

       ده بـ يـ ban الأسهم الميتة (vr≈1, chg≈0, rs<0) من persona المضارب.
    """
    chg_1d = _f(fund.get('change_1d'), 0) or _f(stored.get('change_1d'), 0)
    chg_1w = _f(fund.get('change_1w'), 0) or _f(stored.get('change_1w'), 0) or _f(fund.get('change_5d'), 0) or _f(stored.get('change_5d'), 0)
    score = _f(rec.get('maestro_score'), 0)
    vr = _f(stored.get('volume_ratio'), 0) or _f(fund.get('volume_ratio'), 0)
    rs_vs_market = _f(stored.get('rs_vs_market'), 0) or _f(fund.get('rs_vs_market'), 0)

    # استثناء: score استثنائي (≥90) → اقبل حتى لو نقص شرط
    if score >= 90:
        return True

    # الشرط 1: Volume Spike ≥ 2.0x
    cond_volume = vr >= 2.0
    # الشرط 2: Breakout proxy (intraday OR weekly)
    cond_breakout = (abs(chg_1d) >= 1.5) or (chg_1w >= 4.0)
    # الشرط 3: Relative Strength ≥ 0 (السهم أقوى من أو يساوي السوق)
    cond_rs = rs_vs_market >= 0

    return cond_volume and cond_breakout and cond_rs


def _passes_investor_fundamental(rec: dict, fund: dict, stored: dict) -> bool:
    """تأكيد المستثمر: الأساسيات (مع fallback لما pe_ratio مفقود).

    المسار الأساسي (pe_ratio متوفر):
        pe ∈ [5, 20] AND roe ≥ 10 AND change_1m ∈ [-5, +10]

    Fallback (pe_ratio مفقود — C1.3):
        Layer A (stability — المختلف الحقيقي بين المستثمر والمضارب):
            |change_1d| <= 5 (مش متقلب بشدة intraday)
            AND (volatility ≤ 40 OR volatility unknown)
            AND change_1m ∈ [-10, +15] OR change_1m unknown
        Layer B (proxy fundamental): roe ≥ 12 OR dividend_yield ≥ 0.5
        الاتنين Layer A و Layer B لازم يبقوا True.
    """
    pe = _f(fund.get('pe_ratio'), 0) or _f(stored.get('pe_ratio'), 0)
    roe = _f(fund.get('roe'), 0) or _f(stored.get('roe'), 0)
    chg_1d = _f(fund.get('change_1d'), 0) or _f(stored.get('change_1d'), 0)
    chg_1m = _f(fund.get('change_1m'), 0) or _f(stored.get('change_1m'), 0)
    div = _f(fund.get('dividend_yield'), 0)
    volat = _f(fund.get('volatility'), 0) or _f(stored.get('volatility'), 0)

    # المسار الأساسي: pe_ratio متوفر
    if pe > 0:
        return (
            INVESTOR_PRIMARY_PE_MIN <= pe <= INVESTOR_PRIMARY_PE_MAX
            and roe >= INVESTOR_PRIMARY_ROE_MIN
            and INVESTOR_PRIMARY_CHG_1M_MIN <= chg_1m <= INVESTOR_PRIMARY_CHG_1M_MAX
        )

    # المسار البديل (fallback): pe_ratio مفقود — C1.3
    # Layer A: stability (المختلف الحقيقي بين المستثمر والمضارب)
    # |change_1d| صغير = السهم مش متقلب بشدة → مناسب للمستثمر
    layer_a = (
        abs(chg_1d) <= 5.0
        and (volat == 0 or volat <= INVESTOR_FALLBACK_VOLAT_MAX)
        and (chg_1m == 0 or INVESTOR_FALLBACK_CHG_1M_MIN <= chg_1m <= INVESTOR_FALLBACK_CHG_1M_MAX)
    )
    # Layer B: proxy fundamental (إشارة إن السهم شركة حقيقية)
    layer_b = (roe >= INVESTOR_FALLBACK_ROE_MIN) or (div >= INVESTOR_FALLBACK_DIV_MIN)
    return layer_a and layer_b


# ──────────────────────────────────────────────────────────────────────────────
# C1.2 + C1.1 + C1.3 — Final opportunity decisions
# ──────────────────────────────────────────────────────────────────────────────
def is_gambler_opportunity(rec: dict, fund: dict, stored: dict) -> bool:
    """فرصة مضاربة؟
    strict live + quality gate + gambler confirmation (momentum/volume/score).
    """
    if not is_live_stock_strict(fund, stored):
        return False
    if not _passes_quality_gate(rec, fund, stored):
        return False
    if not _passes_gambler_confirmation(rec, fund, stored):
        return False
    return True


def is_investor_opportunity(rec: dict, fund: dict, stored: dict) -> bool:
    """فرصة استثمار؟
    loose live + quality gate + investor fundamental (with pe_ratio fallback).
    """
    if not is_live_stock_loose(fund, stored):
        return False
    if not _passes_quality_gate(rec, fund, stored):
        return False
    if not _passes_investor_fundamental(rec, fund, stored):
        return False
    return True


def _passes_balanced_confirmation(rec: dict, fund: dict, stored: dict) -> bool:
    """تأكيد المتوازن: تقاطع موزون ديناميكي بين gambler و investor.

    الشرط المزدوج المرن (ديناميكي من السوق، مش أرقام ثابتة):
      - زخم فوق متوسط السوق الحالي (أحد الثلاثة كافٍ):
          change_1d ≥ +0.5%   (حركة intraday معتدلة)
          OR volume_ratio ≥ 1.2  (حجم فوق المتوسط)
          OR maestro_score ≥ 65  (إشارة maestro قوية)
      - AND أساسيات مش في القاع النسبي للقطاع (أحد الأربعة كافٍ):
          roe ≥ 8            (مش ضعيف ربحياً)
          OR fair_value_upside ≥ 5%  (خصم بسيط)
          OR dividend_yield ≥ 0.3%   (توزيعات)
          OR change_1m ≥ -5%         (مش في قاع شهري)

    المتوازن بياخد "الوسط" — مش حاد زي المضارب (مش محتاج |chg_1d|≥3%)،
    مش صارم زي المستثمر (مش محتاج pe∈[5,20] + roe≥10).
    """
    chg_1d = _f(fund.get('change_1d'), 0) or _f(stored.get('change_1d'), 0)
    score = _f(rec.get('maestro_score'), 0)
    # P7-VR-ORDER-FIX (v3.71.1): swap or-order — stored.volume_ratio الأول
    # (نفس gambler_confirmation). fund.volume_ratio=1.0 default كان بـ يطغي.
    vr = _f(stored.get('volume_ratio'), 0) or _f(fund.get('volume_ratio'), 0)
    # P7-VOLUME-FIX: cap vr عند 50 (نفس compute_gambler_rank_score). لو vr خرافي
    # (155008.53 بسبب unit mismatch بين stocks.volume و price_history.volume)،
    # الـ maestro_orchestrator بـ يـ clamp عند 50 + print [VOLUME_RATIO_CLAMP].
    # بس لو الـ value وصل هنا من path تاني (stored.volume_ratio قديم)، نـ cap
    # محلياً عشان نمنع false positive: "vr>=1.2" كان بـ يبقى true بشكل وهمي
    # للأسهم اللي مفيهاش زخم حقيقي.
    vr = min(vr, 50.0) if vr > 0 else 0.0
    roe = _f(fund.get('roe'), 0) or _f(stored.get('roe'), 0)
    fvu = _f(fund.get('fair_value_upside'), 0) or _f(stored.get('fair_value_upside'), 0)
    div = _f(fund.get('dividend_yield'), 0)
    chg_1m = _f(fund.get('change_1m'), 0) or _f(stored.get('change_1m'), 0)

    # الشرط المزدوج المرن (ديناميكي)
    momentum_ok = (
        chg_1d >= BALANCED_MOMENTUM_CHG_1D_MIN
        or vr >= BALANCED_MOMENTUM_VR_MIN
        or score >= BALANCED_MOMENTUM_SCORE_MIN
    )
    fundamental_ok = (
        roe >= BALANCED_FUND_ROE_MIN
        or fvu >= BALANCED_FUND_FVU_MIN
        or div >= BALANCED_FUND_DIV_MIN
        or chg_1m >= BALANCED_FUND_CHG_1M_MIN
    )
    return momentum_ok and fundamental_ok


def is_balanced_opportunity(rec: dict, fund: dict, stored: dict) -> bool:
    """فرصة متوازنة؟

    live strict (نفس gambler — محتاج سيولة حقيقية) + quality gate + balanced
    confirmation. المتوازن مش بيتساهل في السيولة زي المستثمر (محتاج strict)،
    لكنه بيتساهل في التأكيد (مش محتاج زخم حاد ولا أساسيات صارمة).
    """
    if not is_live_stock_strict(fund, stored):
        return False
    if not _passes_quality_gate(rec, fund, stored):
        return False
    if not _passes_balanced_confirmation(rec, fund, stored):
        return False
    return True


# ──────────────────────────────────────────────────────────────────────────────
# P0-UI-PERSONA: Heuristic persona classifier (single source of truth)
# ──────────────────────────────────────────────────────────────────────────────
# المشكلة: الـ strict gates (is_gambler/investor/balanced_opportunity) بتفشل
# صامتاً لـ معظم أسهم EGX لأن stocks.db ناقصة fundamentals (pe_ratio NULL لـ
# 1036/1039 سهم، roe NULL، turnover_egp NULL). النتيجة: كل توقعات persona =
# 'balanced' → شاشة متابعة التوقعات بـ تظهر 0 مضارب / 3000 متوازن / 0 مستثمر.
#
# الحل: classifier إرشادي بسيط ما بـ يعتمدش على fundamentals. بـ يستخدم:
#   - signal / signal_type / recommendation (schema-aware)
#   - maestro_score / master_score / score (schema-aware)
#   - confidence
#   - volume_ratio (من stored أو fund، capped عند 50)
#   - holding_days (optional — للصفقات المقفولة فقط)
#   - roe / fair_value_upside / pe_ratio (optional — لو متاحة بتـ refine)
#
# بيـستخدم في مكانين (single source of truth):
#   1. maestro_orchestrator.py CL5 fallback (لما الـ strict gates كلها ترجع False)
#   2. scripts/backfill_persona_classification.py (إعادة تصنيف الـ 3000 صفقة قديمة)
#
# كده التوقعات الجديدة + القديمة بـ تتوزع بنفس المنطق على الـ 3 شخصيات.
# ──────────────────────────────────────────────────────────────────────────────

# إشارات مضاربية (granular + generic). الـ production بـ يستخدم 'signal' column
# القيم الممكنة: t1_buy, swing_buy, scalp_buy, momentum_buy, buy, strong_buy,
# accumulate, hold, reduce, sell, strong_sell.
_GAMBLER_SIGNALS = frozenset({
    't1_buy', 'swing_buy', 'scalp_buy', 'momentum_buy',
    'buy', 'strong_buy', 'accumulate',
})
# إشارات استثمارية (طويلة الأجل). نفس إشارات BUY بس بـ context مختلف (horizon/score).
_INVESTOR_SIGNALS = frozenset({
    'buy', 'strong_buy', 'value_buy', 'long_buy', 'accumulate',
})
# Union — كل إشارات BUY-side (للـ buy_side check الموحّد).
_BUY_SIDE_SIGNALS = _GAMBLER_SIGNALS | _INVESTOR_SIGNALS


def _resolve_signal_str(rec: dict) -> str:
    """استخرج نوع الإشارة من السجل (schema-aware). الأولوية: signal > signal_type > recommendation."""
    for col in ('signal', 'signal_type', 'recommendation'):
        val = rec.get(col)
        if val is not None and str(val).strip():
            return str(val).strip().lower()
    return ''


def _resolve_score_val(rec: dict) -> float:
    """استخرج الـ score (schema-aware): master_score > maestro_score > score.

    🔥 P0-v5 FIX — skip القيم الـ 0/NULL:
       الـ production بـ يخزن الدرجة الحقيقية في ``master_score`` (71.5, 75.0,
       100.0) بينما ``maestro_score`` و ``score`` بـ يكونوا ``0.0`` في التوقعات
       القديمة. الـ logic القديم كان بـ يـ check ``if val is not None`` فقط،
       فلما ``maestro_score = 0.0`` كان بـ يرجع ``0.0`` فوراً وما بـ يوصلش لـ
       ``master_score`` → كل rows بـ تفضل balanced (الـ bug الأصلي).

       الإصلاح: بـ نتخطى أي قيمة ``<= 0`` ونروح للعمود اللي بعده. كمان رتّبنا
       الأولوية لـ ``master_score`` الأول لأنه المصدر الحقيقي في الإنتاج.
    """
    for col in ('master_score', 'maestro_score', 'score'):
        val = rec.get(col)
        if val is None:
            continue
        try:
            f = float(val)
        except (TypeError, ValueError):
            continue
        if f > 0:           # ← skip 0.0، fall through لـ العمود التالي
            return f
    return 0.0


def classify_persona_heuristic(rec: dict, fund: dict = None, stored: dict = None) -> str:
    """صنّف توقع واحد على persona (gambler / balanced / conservative).

    Classifier إرشادي بسيط — ما بـ يحتاجش fundamentals (pe_ratio/roe). بـ يشتغل
    حتى لو stocks.db ناقصة. ده الـ single source of truth لـ:
      - maestro CL5 write-time fallback
      - backfill_persona_classification.py (إعادة تصنيف تاريخي)

    🔥 تصميم الـ split (P0-UI-PERSONA):
       المشكلة الأصلية كانت إن gambler_signals و investor_signals بـ يتداخلوا
       تماماً للـ production signals (buy/strong_buy/accumulate في الـ setين).
       فلما gambler كان بـ يـ check الأول بـ thresholds أقل (score≥65, conf≥55)،
       كان بـ يبلع كل الـ high-score rows → conservative بـ يفضل 0.

       الحل: نـ check CONSERVATIVE الأول للـ high-conviction rows (confidence هو
       إشارة المستثمر)، وبعدين GAMBLER للـ high-momentum rows (score هو إشارة
       المضارب). كده:
         - confidence عالي (≥70) + score جيد (≥55) → CONSERVATIVE (قناعة)
         - score عالي (≥65) + confidence معتدل (≥50) → GAMBLER (زخم)
         - score عالي + confidence عالي → CONSERVATIVE (القناعة بـ تكسب —
           المستثمر الواثق أقوى من المضارب المتحمس)
         - الاتنين معتدل → BALANCED

    Args:
        rec: سجل التوقع (signal/signal_type/recommendation, maestro_score,
             master_score, score, confidence, holding_days).
        fund: بيانات السهم الأساسية من stocks.db (optional — roe, pe_ratio,
              fair_value_upside, change_1d, volume_ratio).
        stored: بيانات حية (optional — volume_ratio, current_price, change_1d).

    Returns:
        'gambler' | 'balanced' | 'conservative'
    """
    fund = fund or {}
    stored = stored or {}

    sig = _resolve_signal_str(rec)
    score = _resolve_score_val(rec)
    try:
        confidence = float(rec.get('confidence') or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    # 🔥 P0-v5 FIX — confidence = NULL شائع في التوقعات القديمة (3590 صفقة).
    #    لما confidence فاضي، نـستخدم master_score كـ proxy للثقة: الدرجة العالية
    #    تعني قناعة عالية. ده بـ يـ restore الـ split الطبيعي:
    #      - score ≥ 70 → conservative (قناعة عالية = مستثمر واثق)
    #      - score 65-69 → gambler (زخم معتدل = مضارب)
    #      - score < 65 → balanced
    if confidence <= 0:
        confidence = score
    try:
        holding_days = int(rec.get('holding_days') or 0)
    except (TypeError, ValueError):
        holding_days = 0

    # volume_ratio — prefer stored (live), fall back to fund. cap عند 50 (نفس
    # compute_gambler_rank_score) عشان نمنع false positive من unit mismatch.
    vr = 0.0
    for src in (stored, fund):
        for col in ('volume_ratio', 'current_volume', 'volume'):
            val = src.get(col)
            if val is not None:
                try:
                    _v = float(val)
                    if _v > 0:
                        vr = _v
                        break
                except (TypeError, ValueError):
                    continue
        if vr > 0:
            break
    vr = min(vr, 50.0) if vr > 0 else 0.0

    # Fundamentals (optional — لو متاحة بتـ refine الـ conservative classification)
    try:
        roe = float(fund.get('roe') or stored.get('roe') or 0)
    except (TypeError, ValueError):
        roe = 0.0
    try:
        fvu = float(fund.get('fair_value_upside') or stored.get('fair_value_upside') or 0)
    except (TypeError, ValueError):
        fvu = 0.0

    # إشارات SELL/HOLD/REDUCE → balanced (مش فرصة BUY-side)
    buy_side = sig in _BUY_SIDE_SIGNALS

    # ── CONSERVATIVE (مستثمر): قناعة + صبر + قيمة ──
    # check الأول عشان high-conviction BUYs ما يروحوش gambler.
    if buy_side:
        # (1) أساسيات قوية (value investor) — roe ≥ 12 أو fair_value_upside ≥ 10
        if (roe >= 12 or fvu >= 10) and score >= 55:
            return 'conservative'
        # (2) holding طويل (closed trade — اتمسك 25+ يوم = سلوك مستثمر صبور)
        if holding_days >= 25 and score >= 50:
            return 'conservative'
        # (3) قناعة عالية (confidence إشارة المستثمر الأساسية) — conf ≥ 70 + score ≥ 55
        if confidence >= 70 and score >= 55:
            return 'conservative'

    # ── GAMBLER (مضارب): زخم + حجم + سرعة ──
    if buy_side:
        # (1) حجم فوق المتوسط بـ ضغط (vr ≥ 2.0) + score عالي (≥ 70) — momentum مدعوم بحجم
        if vr >= 2.0 and score >= 70:
            return 'gambler'
        # (2) زخم قوي (score إشارة المضارب الأساسية) — score ≥ 65 + confidence ≥ 50
        if score >= 65 and confidence >= 50:
            return 'gambler'
        # (3) quick flip (closed trade — خرج ≤ 4 أيام = سلوك مضارب سريع)
        if 0 < holding_days <= 4 and score >= 55:
            return 'gambler'

    # ── BALANCED (متوازن): الـ default — أي حاجة ماحققش شروط المضارب ولا المستثمر ──
    return 'balanced'


# ──────────────────────────────────────────────────────────────────────────────
# Phase 3: Wash Trading Guard (WIRING — uses existing liquidity_filter data)
# ──────────────────────────────────────────────────────────────────────────────
def detect_wash_trading(fund: dict, stored: dict) -> dict:
    """كشف تداول وهمي: حجم طفر بس السعر ثابت.

    لو volume_ratio >= 2.0 بس change_1d < 1.0% → غالباً wash trading.
    ده بيستخدم الدوال الموجودة (volume_ratio من liquidity_filter، change_1d
    من fundamentals) — مش محرك جديد.

    Returns:
        {'is_wash_trading': bool, 'reason': str, 'penalty': float}
    """
    vr_raw = _f(stored.get('volume_ratio'), 0) or _f(fund.get('volume_ratio'), 0)
    vr = min(vr_raw, 50.0)
    chg_1d = _f(fund.get('change_1d'), 0) or _f(stored.get('change_1d'), 0)
    if vr >= 2.0 and abs(chg_1d) < 1.0:
        return {
            'is_wash_trading': True,
            'reason': f'vr={vr:.1f}x but chg_1d={chg_1d:+.2f}% (flat)',
            'penalty': 15.0,  # Phase 3: Tech Score penalty
        }
    return {'is_wash_trading': False, 'reason': '', 'penalty': 0.0}


# ──────────────────────────────────────────────────────────────────────────────
# Rank scores (for sorting)
# ──────────────────────────────────────────────────────────────────────────────
def compute_gambler_rank_score(fund: dict, stored: dict) -> float:
    """درجة المضارب: زخم + حجم + تقلب + RSI edge. الأعلى = الأفضل للمضاربة.

    C1.2-RANK-FIX (v3.48.1): بنـ capped volume_ratio عند 50 عشان avg_volume
    مش بنفس وحدة volume في stocks.db (بيطلع vr بملايين بدون cap).

    Phase 3: Wash trading penalty — لو volume_ratio >= 2.0 و change_1d < 1.0%
    → خصم 15 نقطة من الـ Tech Score.
    """
    # P7-VR-ORDER-FIX (v3.71.1): swap or-order — stored.volume_ratio الأول.
    vr_raw = _f(stored.get('volume_ratio'), 0) or _f(fund.get('volume_ratio'), 0)
    vr = min(vr_raw, 50.0)  # cap عشان الـ rank يبقى مفهوم
    chg = abs(_f(fund.get('change_1d'), 0) or _f(stored.get('change_1d'), 0))
    vol = _f(fund.get('volatility'), 0) or _f(stored.get('volatility'), 0)
    rsi = _f(fund.get('rsi'), 50)
    rsi_edge = abs(rsi - 50) * 2
    _base_score = vr * 10 + chg * 3 + vol * 0.5 + rsi_edge
    # Phase 3: Wash trading penalty — خصم 15 نقطة لو volume طفر بس السعر ثابت
    _wt = detect_wash_trading(fund, stored)
    if _wt['is_wash_trading']:
        _base_score -= _wt['penalty']
    return round(_base_score, 2)


def compute_investor_rank_score(fund: dict, stored: dict) -> float:
    """درجة المستثمر: قيمة عادلة + ربحية + توزيعات + استقرار. الأعلى = الأفضل للاستثمار."""
    fvu = _f(fund.get('fair_value_upside'), 0) or _f(stored.get('fair_value_upside'), 0)
    roe = _f(fund.get('roe'), 0) or _f(stored.get('roe'), 0)
    pe = _f(fund.get('pe_ratio'), 0) or _f(stored.get('pe_ratio'), 0)
    div = _f(fund.get('dividend_yield'), 0)
    volat = _f(fund.get('volatility'), 0) or _f(stored.get('volatility'), 0)
    # P/E score: pe منخفض (لكن > 0) = أفضل
    pe_score = (20 - pe) * 2 if 0 < pe <= 20 else 0
    # stability bonus: تقلب منخفض = استقرار
    stability_bonus = max(0, (30 - volat)) * 0.3 if volat > 0 else 0
    return round(fvu * 1.5 + roe * 1.2 + div * 5 + pe_score + stability_bonus, 2)


def compute_balanced_rank_score(fund: dict, stored: dict) -> float:
    """درجة المتوازن: مزيج معتدل بين المضارب والمستثمر.

    المتوازن = 0.5 × gambler_rank + 0.5 × investor_rank
    ده بيخلّي السهم اللي عنده زخم + أساسيات كويسة يطلع أعلى،
    والسهم اللي عنده واحد من الاتنين بس ينزل للنص.
    ده ترجمة "تقاطع موزون ديناميكي" — مش محرك رابع.
    """
    g_rank = compute_gambler_rank_score(fund, stored)
    i_rank = compute_investor_rank_score(fund, stored)
    return round(g_rank * 0.5 + i_rank * 0.5, 2)


# ──────────────────────────────────────────────────────────────────────────────
# C2 — Sector Heat Map (read-time, market-wide, cached per request)
# ──────────────────────────────────────────────────────────────────────────────
def compute_sector_heat_map(fundamentals_batch: Dict[str, dict]) -> Dict[str, dict]:
    """احسب خريطة سخونة القطاعات من batch بيانات الأسهم.

    بيتحسب مرة واحدة لكل request (مش per-stock) لأنه measure نسبي للسوق كله.

    Args:
        fundamentals_batch: dict من ticker → fund dict (زي اللي بيرجّعه
            _load_stocks_fundamentals_batch في stored_analysis_routes). كل fund
            لازم يكون فيه: 'sector', 'change_1d', 'volume' (الـ volume اختياري).

    Returns:
        {sector_name: {
            'status': 'hot' | 'dead' | 'neutral',
            'n': int,
            'avg_chg': float,
            'rising_ratio': float,   # 0..1
            'rising': int,
            'falling': int,
            'total_volume': float,
            'boost': float,          # +SECTOR_HEAT_BOOST / -SECTOR_HEAT_PENALTY / 0
        }}
        القطاعات الـ junk (في SECTOR_HEAT_EXCLUDE) مش بترجع في الـ map خالص.
    """
    # 1) جمّع per-sector stats
    agg: Dict[str, dict] = {}
    for ticker, fund in (fundamentals_batch or {}).items():
        if not isinstance(fund, dict):
            continue
        sector = fund.get('sector')
        # فلترة junk sectors
        if sector in SECTOR_HEAT_EXCLUDE:
            continue
        if sector is None:
            continue
        sector_str = str(sector).strip()
        if not sector_str or sector_str in SECTOR_HEAT_EXCLUDE:
            continue
        chg = _f(fund.get('change_1d'), 0)
        vol = _f(fund.get('volume'), 0)

        bucket = agg.setdefault(sector_str, {
            'n': 0, 'sum_chg': 0.0, 'rising': 0, 'falling': 0, 'total_volume': 0.0,
        })
        bucket['n'] += 1
        bucket['sum_chg'] += chg
        if chg > 0:
            bucket['rising'] += 1
        elif chg < 0:
            bucket['falling'] += 1
        bucket['total_volume'] += vol

    # 2) صنّف كل قطاع
    heat_map: Dict[str, dict] = {}
    for sector, b in agg.items():
        n = b['n']
        if n < SECTOR_HEAT_MIN_SIZE:
            # قطاع صغير جداً — مفيش إحصائية معنوية، اعتبره neutral
            heat_map[sector] = {
                'status': 'neutral',
                'n': n,
                'avg_chg': round(b['sum_chg'] / n, 3) if n else 0.0,
                'rising_ratio': round(b['rising'] / n, 3) if n else 0.0,
                'rising': b['rising'],
                'falling': b['falling'],
                'total_volume': round(b['total_volume'], 2),
                'boost': 0.0,
            }
            continue
        avg_chg = b['sum_chg'] / n
        rising_ratio = b['rising'] / n

        if avg_chg >= SECTOR_HEAT_MIN_AVG_CHG and rising_ratio >= SECTOR_HEAT_MIN_RISING_RATIO:
            status = 'hot'
            boost = SECTOR_HEAT_BOOST
        elif avg_chg <= SECTOR_HEAT_DEAD_AVG_CHG and rising_ratio <= SECTOR_HEAT_DEAD_RISING_RATIO:
            status = 'dead'
            boost = -SECTOR_HEAT_PENALTY  # سالب
        else:
            status = 'neutral'
            boost = 0.0

        heat_map[sector] = {
            'status': status,
            'n': n,
            'avg_chg': round(avg_chg, 3),
            'rising_ratio': round(rising_ratio, 3),
            'rising': b['rising'],
            'falling': b['falling'],
            'total_volume': round(b['total_volume'], 2),
            'boost': round(boost, 3),
        }

    return heat_map


def apply_sector_boost_to_gambler_rank(
    rank_score: float,
    sector: Any,
    heat_map: Dict[str, dict],
) -> tuple:
    """طبّق boost القطاع على درجة المضارب.

    Args:
        rank_score: gambler_rank_score الأصلي (من compute_gambler_rank_score).
        sector: اسم القطاع للسهم.
        heat_map: الـ map اللي بيرجّعه compute_sector_heat_map.

    Returns:
        (boosted_rank, boost_delta):
            boosted_rank: الدرجة بعد الـ boost (rank * (1 + boost)).
            boost_delta: الـ boost المُطبَّق (مثلاً +0.15، -0.10، 0.0).

    ملاحظة: المستثمر مبيحصلش أي boost — الـ caller مبيستدعيش الـ function دي
    في مسار المستثمر. ده تصميم متعمّد (مش bug).
    """
    if not heat_map or not sector:
        return rank_score, 0.0
    sector_str = str(sector).strip()
    info = heat_map.get(sector_str)
    if not info:
        return rank_score, 0.0
    boost = _f(info.get('boost'), 0)
    if boost == 0:
        return rank_score, 0.0
    boosted = rank_score * (1 + boost)
    return round(boosted, 2), round(boost, 3)


def get_sector_heat_status(sector: Any, heat_map: Dict[str, dict]) -> str:
    """هل القطاع سخن/ميت/محايد؟ helper سريع للـ UI/التوثيق."""
    if not heat_map or not sector:
        return 'neutral'
    info = heat_map.get(str(sector).strip())
    return info.get('status', 'neutral') if info else 'neutral'


# ──────────────────────────────────────────────────────────────────────────────
# P6 — Sector Role (leader/mid/laggard within sector) + light persona injection
# ──────────────────────────────────────────────────────────────────────────────
# EGX بيتحرك قطاعياً. جوا كل قطاع فيه أسهم بتقود الحركة (leaders) وأسهم بتتأخر
# (laggards). المضارب الذكي بيفضّل قائد قطاع ساخن (بيشارك في السخونة) وبيتجنّب
# laggard متأخر (مش بيلحق السوق). ده "حقن خفيف" — تعديل صغير على درجة المضارب،
# مش محرك جديد منفصل عن المايسترو.
#
# التصنيف (dynamic من الـ batch، زي الـ heat map بالظبط):
#   - جوه كل قطاع (n >= SECTOR_HEAT_MIN_SIZE=3): رتّب الأسهم بـ change_1d
#       top 1/3   -> 'leader'   (بتقود حركة القطاع)
#       وسط 1/3   -> 'mid'
#       bottom 1/3 -> 'laggard' (متأخرة عن القطاع)
#   - قطاع صغير (n < 3): الكل 'mid' (مفيش إحصائية معنوية)
#
# الحقن (light، على درجة المضارب بس — المستثمر مش بيتأثر):
#   hot  + leader   -> +5%   (قطاع ساخن + السهم بيقود = فرصة مضاربة قوية)
#   hot  + laggard  -> -5%   (قطاع ساخن بس السهم مش بيلحق = فرصة ضعيفة)
#   dead + laggard  -> -5%   (قطاع ميت + السهم متأخر = تجنّب)
#   dead + leader   -> +3%   (قطاع ميت بس السهم صامد = قد يكون فرصة عكسية)
#   neutral / mid   ->  0
SECTOR_ROLE_LEADER_BOOST_HOT = 0.05
SECTOR_ROLE_LAGGARD_PENALTY_HOT = -0.05
SECTOR_ROLE_LAGGARD_PENALTY_DEAD = -0.05
SECTOR_ROLE_LEADER_BOOST_DEAD = 0.03


def classify_sector_roles(fundamentals_batch: Dict[str, dict]) -> Dict[str, str]:
    """صنّف دور كل سهم جوه قطاعه (leader/mid/laggard) من change_1d.

    بيتحسب مرة واحدة لكل request (زي compute_sector_heat_map). التصنيف نسبي
    جوه القطاع — leader = top 1/3 change_1d في القطاع، laggard = bottom 1/3.

    Args:
        fundamentals_batch: dict من ticker -> fund dict (كل fund فيه 'sector'
            و 'change_1d').

    Returns:
        {ticker: 'leader' | 'mid' | 'laggard'}. الأسهم في قطاعات صغيرة (n<3)
        أو قطاعات junk بترجع 'mid' / مش في الـ map خالص.
    """
    # 1) جمّع per-sector: [(ticker, change_1d), ...]
    by_sector: Dict[str, list] = {}
    for ticker, fund in (fundamentals_batch or {}).items():
        if not isinstance(fund, dict):
            continue
        sector = fund.get('sector')
        if sector in SECTOR_HEAT_EXCLUDE or sector is None:
            continue
        sector_str = str(sector).strip()
        if not sector_str or sector_str in SECTOR_HEAT_EXCLUDE:
            continue
        chg = _f(fund.get('change_1d'), 0)
        by_sector.setdefault(sector_str, []).append((ticker, chg))

    # 2) لكل قطاع، رتّب تنازلياً بـ change_1د وصنّف لـ thirds
    roles: Dict[str, str] = {}
    for _sector, items in by_sector.items():
        n = len(items)
        if n < SECTOR_HEAT_MIN_SIZE:
            for ticker, _ in items:
                roles[ticker] = 'mid'
            continue
        items_sorted = sorted(items, key=lambda x: x[1], reverse=True)
        third = max(1, n // 3)
        for i, (ticker, _) in enumerate(items_sorted):
            if i < third:
                roles[ticker] = 'leader'
            elif i >= n - third:
                roles[ticker] = 'laggard'
            else:
                roles[ticker] = 'mid'
    return roles


def apply_sector_role_to_gambler_rank(
    rank_score: float,
    role: Any,
    sector_status: str,
) -> tuple:
    """طبّق تعديل دور القطاع على درجة المضارب (حقن خفيف).

    Args:
        rank_score: gambler_rank_score (بعد sector heat boost أو قبله — الـ caller
            يقرر الترتيب). المهم إن التعديل ده مستقل وصغير.
        role: 'leader' | 'mid' | 'laggard' (من classify_sector_roles).
        sector_status: 'hot' | 'dead' | 'neutral' (من get_sector_heat_status).

    Returns:
        (adjusted_rank, delta): الدرجة بعد التعديل + الـ delta المُطبَّق
        (مثلاً +0.05، -0.05، 0.0). المستثمر مبيستدعيش الـ function دي.
    """
    if not role or role == 'mid':
        return rank_score, 0.0
    if not sector_status or sector_status == 'neutral':
        return rank_score, 0.0
    delta = 0.0
    if sector_status == 'hot':
        if role == 'leader':
            delta = SECTOR_ROLE_LEADER_BOOST_HOT
        elif role == 'laggard':
            delta = SECTOR_ROLE_LAGGARD_PENALTY_HOT
    elif sector_status == 'dead':
        if role == 'laggard':
            delta = SECTOR_ROLE_LAGGARD_PENALTY_DEAD
        elif role == 'leader':
            delta = SECTOR_ROLE_LEADER_BOOST_DEAD
    if delta == 0:
        return rank_score, 0.0
    adjusted = rank_score * (1 + delta)
    return round(adjusted, 2), round(delta, 3)


# ──────────────────────────────────────────────────────────────────────────────
# Convenience: full flag computation (write-time, used by background_analyzer)
# ──────────────────────────────────────────────────────────────────────────────
def compute_persona_flags(
    rec: dict,
    fund: dict,
    stored_vol_ratio: float = 0.0,
) -> dict:
    """احسب كل الـ persona flags + rank scores + fundamentals لسهم واحد.

    Args:
        rec: {ticker, recommendation, maestro_score, risk_reward, confidence, ...}
        fund: بيانات stocks.db للسهم (pe, roe, volume_ratio, change_*, ...)
        stored_vol_ratio: volume_ratio من stored_analyses (احتياطي)

    Returns:
        dict متوافق مع schema stored_analyses:
        {is_gambler, is_investor, gambler_rank, investor_rank,
         pe_ratio, roe, change_1d, change_1m, volatility, fair_value_upside}
    """
    stored = {
        'volume_ratio': stored_vol_ratio,
        'turnover_egp': rec.get('turnover_egp') if isinstance(rec, dict) else None,
        # PERSONA-FLAGS-FIX (v3.57.0): إشارات live-stock من الـ analysis row
        # عشان is_live_stock_strict/loose يلاقوا fallback لو stocks.db ناقص/
        # قديم. وقت الكتابة updated_at=now (طازج)، volume/current_price من
        # الـ result. لو الـ caller ما مرّرش القيم دي → None → fallback لـ fund.
        'updated_at': rec.get('updated_at') if isinstance(rec, dict) else None,
        'last_update': rec.get('last_update') if isinstance(rec, dict) else None,
        'volume': rec.get('volume') if isinstance(rec, dict) else None,
        'current_price': rec.get('current_price') if isinstance(rec, dict) else None,
        'is_suspended': rec.get('is_suspended') if isinstance(rec, dict) else None,
    }
    # ادمج fund + stored للـ rank score
    fund_for_rank = fund or {}

    is_g = is_gambler_opportunity(rec, fund_for_rank, stored)
    is_i = is_investor_opportunity(rec, fund_for_rank, stored)
    is_b = is_balanced_opportunity(rec, fund_for_rank, stored)
    g_rank = compute_gambler_rank_score(fund_for_rank, stored)
    i_rank = compute_investor_rank_score(fund_for_rank, stored)
    b_rank = compute_balanced_rank_score(fund_for_rank, stored)

    pe = _f(fund_for_rank.get('pe_ratio'), 0)
    roe = _f(fund_for_rank.get('roe'), 0)
    chg_1d = _f(fund_for_rank.get('change_1d'), 0)
    chg_1m = _f(fund_for_rank.get('change_1m'), 0)
    volat = _f(fund_for_rank.get('volatility'), 0)
    fvu = _f(fund_for_rank.get('fair_value_upside'), 0)

    # P0-DYNAMIC: لوج إلزامي بالصيغة اللي طلبها المالك — عشان grep يلاقيه
    # ونعرف ليه كل صف g=0/i=0 (لو لسه كله صفر، اللوج هيقول السبب: turnover/vol/chg).
    _tk = (rec.get('ticker') if isinstance(rec, dict) else None) or (fund_for_rank.get('ticker') or '?')
    _turn = (_f(stored.get('turnover_egp'), 0) or _f(fund_for_rank.get('turnover_egp'), 0)
             or _f(fund_for_rank.get('value_traded'), 0))
    _vol = _f(fund_for_rank.get('volume'), 0) or _f(stored.get('volume'), 0)
    _vr = _f(fund_for_rank.get('volume_ratio'), 0) or _f(stored.get('volume_ratio'), 0)
    _score = _f(rec.get('maestro_score'), 0) if isinstance(rec, dict) else 0
    print(f"[PERSONA_FLAGS] ticker={_tk} g={int(is_g)} i={int(is_i)} b={int(is_b)} "
          f"turn={_turn:.0f} vol={_vol:.0f} vol_ratio={_vr:.2f} "
          f"chg_1d={chg_1d:.2f} score={_score:.1f} pe={pe:.1f} roe={roe:.1f}")

    return {
        'is_gambler': 1 if is_g else 0,
        'is_investor': 1 if is_i else 0,
        'is_balanced': 1 if is_b else 0,
        'gambler_rank': g_rank,
        'investor_rank': i_rank,
        'balanced_rank': b_rank,
        'pe_ratio': pe if pe > 0 else None,
        'roe': roe if roe > 0 else None,
        'change_1d': chg_1d if chg_1d != 0 else None,
        'change_1m': chg_1m if chg_1m != 0 else None,
        'volatility': volat if volat > 0 else None,
        'fair_value_upside': fvu if fvu != 0 else None,
    }


__all__ = [
    # thresholds (للاختبار والعرض)
    'OPPORTUNITY_MIN_SCORE',
    'OPPORTUNITY_MIN_RR',
    'OPPORTUNITY_MIN_TURNOVER',
    'OPPORTUNITY_MIN_CONFIDENCE',
    'LIVE_STRICT_MAX_AGE_HOURS',
    'LIVE_STRICT_MIN_VOLUME',
    'LIVE_STRICT_MIN_TURNOVER',
    'LIVE_LOOSE_MAX_AGE_DAYS',
    'INVESTOR_FALLBACK_NOTE',
    'INVESTOR_FALLBACK_ROE_MIN',
    'INVESTOR_FALLBACK_FVU_MIN',
    'BUY_FAMILY',
    # C3 — Balanced
    'BALANCED_MOMENTUM_CHG_1D_MIN',
    'BALANCED_MOMENTUM_VR_MIN',
    'BALANCED_MOMENTUM_SCORE_MIN',
    'BALANCED_FUND_ROE_MIN',
    'BALANCED_FUND_FVU_MIN',
    'BALANCED_FUND_DIV_MIN',
    'BALANCED_FUND_CHG_1M_MIN',
    'BALANCED_NOTE',
    # C2 — Sector Heat
    'SECTOR_HEAT_MIN_SIZE',
    'SECTOR_HEAT_MIN_AVG_CHG',
    'SECTOR_HEAT_MIN_RISING_RATIO',
    'SECTOR_HEAT_DEAD_AVG_CHG',
    'SECTOR_HEAT_DEAD_RISING_RATIO',
    'SECTOR_HEAT_BOOST',
    'SECTOR_HEAT_PENALTY',
    'SECTOR_HEAT_EXCLUDE',
    'SECTOR_HEAT_NOTE',
    # functions
    'is_live_stock_strict',
    'is_live_stock_loose',
    'is_gambler_opportunity',
    'is_investor_opportunity',
    'is_balanced_opportunity',
    # P0-UI-PERSONA: heuristic classifier (no fundamentals dependency)
    'classify_persona_heuristic',
    'compute_gambler_rank_score',
    'compute_investor_rank_score',
    'compute_balanced_rank_score',
    'compute_persona_flags',
    # P0-DYNAMIC — dynamic thresholds
    'set_dynamic_thresholds',
    'get_dynamic_thresholds',
    # C2 — Sector Heat functions
    'compute_sector_heat_map',
    'apply_sector_boost_to_gambler_rank',
    'get_sector_heat_status',
    # P6 — Sector Role functions
    'classify_sector_roles',
    'apply_sector_role_to_gambler_rank',
    'SECTOR_ROLE_LEADER_BOOST_HOT',
    'SECTOR_ROLE_LAGGARD_PENALTY_HOT',
    'SECTOR_ROLE_LAGGARD_PENALTY_DEAD',
    'SECTOR_ROLE_LEADER_BOOST_DEAD',
    # Phase 3 — Wash Trading Guard
    'detect_wash_trading',
]
