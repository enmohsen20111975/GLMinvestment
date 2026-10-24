"""
PHASE-1A/1B/1C — Tests for Stock Alive Filter + Target/Stop guards + R:R enforcement.

These tests verify the three guards added in Phase 1:
  1أ: evaluate_stock_alive — dynamic percentile-based dead-stock filter
  1ب: validate_target_stop_direction — fix target ≤ entry bug
  1ج: enforce_min_rr — guarantee planned R:R ≥ 1.5
"""
import os
import sys
import pytest

# Add vps-service to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from core.opportunity_quality import (
    evaluate_stock_alive,
    validate_target_stop_direction,
    compute_planned_rr,
    enforce_min_rr,
    enforce_atr_based_stop,
    MIN_PLANNED_RR,
    STOCK_ALIVE_ATR_PCT_FLOOR,
    STOCK_ALIVE_VOLUME_RATIO_FLOOR,
    STOCK_ALIVE_RS_FLOOR,
    ATR_STOP_MULTIPLIERS,
    ATR_STOP_MIN_PCT,
    ATR_STOP_MAX_PCT,
    set_dynamic_thresholds,
    get_dynamic_thresholds,
)


# ──────────────────────────────────────────────────────────────────────────────
# PHASE-1B: validate_target_stop_direction (target ≤ entry bug fix)
# ──────────────────────────────────────────────────────────────────────────────

class TestValidateTargetStopDirection:
    """المرحلة 1ب: منع target ≤ entry للـ BUY (و target ≥ entry للـ SELL)."""

    def test_buy_target_above_entry_ok(self):
        """BUY صحي: target > entry → valid."""
        r = validate_target_stop_direction('BUY', 100.0, 105.0, 95.0)
        assert r['valid'] is True
        assert r['action'] == 'ok'

    def test_buy_target_equals_entry_rejected_and_fixed(self):
        """الـ bug المؤكد: BUY target = entry → fix_target."""
        r = validate_target_stop_direction('BUY', 100.0, 100.0, 95.0)
        assert r['valid'] is False
        assert r['action'] == 'fix_target'
        assert r['fixed']['target_price'] == 103.0  # entry × 1.03

    def test_buy_target_below_entry_rejected_and_fixed(self):
        """الـ bug الأسوأ: BUY target < entry → fix_target."""
        r = validate_target_stop_direction('BUY', 325.66, 322.56, 297.26)
        assert r['valid'] is False
        assert r['action'] == 'fix_target'
        # DSCW case: entry=325.66 → fixed target = 325.66 × 1.03 = 335.43
        assert r['fixed']['target_price'] == round(325.66 * 1.03, 4)

    def test_buy_stop_above_entry_fixed(self):
        """BUY stop > entry = خطأ → fix_stop."""
        r = validate_target_stop_direction('BUY', 100.0, 105.0, 102.0)
        assert r['valid'] is False
        assert r['action'] == 'fix_target'
        assert r['fixed']['stop_loss'] == 97.0  # entry × 0.97

    def test_sell_target_below_entry_ok(self):
        """SELL صحي: target < entry → valid."""
        r = validate_target_stop_direction('SELL', 100.0, 95.0, 105.0)
        assert r['valid'] is True
        assert r['action'] == 'ok'

    def test_sell_target_above_entry_fixed(self):
        """SELL target > entry = خطأ → fix_target."""
        r = validate_target_stop_direction('SELL', 100.0, 105.0, 110.0)
        assert r['valid'] is False
        assert r['action'] == 'fix_target'
        assert r['fixed']['target_price'] == 97.0  # entry × 0.97

    def test_hold_not_validated(self):
        """HOLD مفيهوش اتجاه → ok (مش directional)."""
        r = validate_target_stop_direction('HOLD', 100.0, 100.0, 100.0)
        assert r['valid'] is True
        assert r['action'] == 'ok'
        assert r['reason'] == 'non_directional'

    def test_entry_zero_rejected(self):
        """entry_price = 0 → reject."""
        r = validate_target_stop_direction('BUY', 0, 105.0, 95.0)
        assert r['valid'] is False
        assert r['action'] == 'reject'

    def test_strong_buy_treated_as_buy(self):
        """STRONG_BUY بـ يتعامل زي BUY."""
        r = validate_target_stop_direction('STRONG_BUY', 100.0, 99.0, 95.0)
        assert r['valid'] is False
        assert r['action'] == 'fix_target'


# ──────────────────────────────────────────────────────────────────────────────
# PHASE-1C: compute_planned_rr + enforce_min_rr
# ──────────────────────────────────────────────────────────────────────────────

class TestComputePlannedRR:
    """المرحلة 1ج: حساب الـ R:R المخطط."""

    def test_buy_rr_2(self):
        """BUY: entry=100, target=110, stop=95 → RR = 10/5 = 2.0"""
        rr = compute_planned_rr('BUY', 100.0, 110.0, 95.0)
        assert rr == 2.0

    def test_buy_rr_inverted_zero(self):
        """BUY target < entry + stop < entry → risk negative → rr=0."""
        rr = compute_planned_rr('BUY', 100.0, 95.0, 105.0)
        assert rr == 0.0

    def test_sell_rr_2(self):
        """SELL: entry=100, target=90, stop=105 → RR = 10/5 = 2.0"""
        rr = compute_planned_rr('SELL', 100.0, 90.0, 105.0)
        assert rr == 2.0

    def test_hold_rr_zero(self):
        rr = compute_planned_rr('HOLD', 100.0, 100.0, 100.0)
        assert rr == 0.0

    def test_missing_values_zero(self):
        rr = compute_planned_rr('BUY', 100.0, None, 95.0)
        assert rr == 0.0


class TestEnforceMinRR:
    """المرحلة 1ج: ضامن R:R ≥ 1.5."""

    def test_rr_above_min_ok(self):
        """RR = 2.0 ≥ 1.5 → ok."""
        r = enforce_min_rr('BUY', 100.0, 110.0, 95.0, min_rr=1.5)
        assert r['action'] == 'ok'
        assert r['rr'] == 2.0

    def test_rr_below_min_widen_target(self):
        """RR = 0.5 < 1.5 → widen target لـ 1.5 × risk."""
        # entry=100, target=102, stop=95 → risk=5, reward=2, RR=0.4
        r = enforce_min_rr('BUY', 100.0, 102.0, 95.0, min_rr=1.5)
        assert r['action'] == 'widen_target'
        # new target = 100 + 1.5 × 5 = 107.5
        assert r['fixed']['target_price'] == 107.5
        assert r['rr'] == 1.5

    def test_rr_inverted_reject(self):
        """RR ≤ 0 (inverted) → reject."""
        r = enforce_min_rr('BUY', 100.0, 95.0, 105.0, min_rr=1.5)
        assert r['action'] == 'reject'

    def test_sell_rr_below_min_widen_target(self):
        """SELL: entry=100, target=98, stop=105 → risk=5, reward=2, RR=0.4 → widen."""
        r = enforce_min_rr('SELL', 100.0, 98.0, 105.0, min_rr=1.5)
        assert r['action'] == 'widen_target'
        # new target = 100 - 1.5 × 5 = 92.5
        assert r['fixed']['target_price'] == 92.5
        assert r['rr'] == 1.5

    def test_rr_exactly_min_ok(self):
        """RR = 1.5 (بالظبط) → ok."""
        # entry=100, target=107.5, stop=95 → risk=5, reward=7.5, RR=1.5
        r = enforce_min_rr('BUY', 100.0, 107.5, 95.0, min_rr=1.5)
        assert r['action'] == 'ok'


# ──────────────────────────────────────────────────────────────────────────────
# PHASE-1A-v2: evaluate_stock_alive (Rule 8 — data-driven redesign)
# ──────────────────────────────────────────────────────────────────────────────

class TestEvaluateStockAlive:
    """المرحلة 1أ (إعادة تصميم): فلتر السهم الحي — Rule 8.

    القاعدة: alive = (ATR ≥ batch median) AND (change_5d ≤ batch p40)
    - ATR ≥ median: السهم متقلب بما يكفي ليتحرك (Spearman +0.28 مع high%)
    - chg5d ≤ p40: mean-reversion (Spearman -0.32 — اللي نزل بيرتد)
    - VR اتشال كـ gate (Spearman +0.02 = صفر قوة تنبؤية) — diagnostic بس
    """

    def setup_method(self):
        """reset dynamic thresholds before each test."""
        set_dynamic_thresholds([])  # clear

    def test_alive_stock_passes_no_batch(self):
        """بدون batch (live read path): ATR فوق الـ floor (0.5%) → alive.
        الـ mean-rev gate بـ skip لأن chg5d_p40=0 (مش populated)."""
        fund = {
            'avg_atr_pct': 3.0,        # فوق floor 0.5%
            'change_5d': 5.0,
            'market_change_5d': 1.0,
            'volume_ratio': 2.0,
        }
        stored = {'volume_ratio': 2.0}
        r = evaluate_stock_alive(fund, stored)
        assert r['alive'] is True
        assert r['reason'] == 'ALIVE'

    def test_dead_stock_low_atr_rejected(self):
        """سهم ميت: ATR تحت الـ floor (0.5%) → REJECT.
        (VR مش gate بعد كده — بيتسجل بس للـ diagnostic.)"""
        fund = {
            'avg_atr_pct': 0.3,        # تحت floor 0.5%
            'change_5d': 0.0,
            'market_change_5d': 0.0,
            'volume_ratio': 0.5,
        }
        stored = {'volume_ratio': 0.5}
        r = evaluate_stock_alive(fund, stored)
        assert r['alive'] is False
        assert 'atr' in r['reason']  # REJECT(atr=0.30<0.50)

    def test_mean_reversion_stock_passes(self):
        """Rule 8: ATR ≥ median AND chg5d ≤ p40 → alive.
        سهم متقلب (ATR عالي) + نزل آخر 5 أيام (mean-reversion candidate)."""
        batch = [
            {'avg_atr_pct': 4.0, 'change_5d': -2.0, 'volume_ratio': 1.2, 'turnover_egp': 1000000, 'volume': 50000, 'change_1d': -1.0},
            {'avg_atr_pct': 3.0, 'change_5d': +3.0, 'volume_ratio': 0.8, 'turnover_egp': 500000, 'volume': 20000, 'change_1d': +2.0},
            {'avg_atr_pct': 5.0, 'change_5d': -5.0, 'volume_ratio': 1.5, 'turnover_egp': 2000000, 'volume': 80000, 'change_1d': -3.0},
        ]
        set_dynamic_thresholds(batch)
        dyn = get_dynamic_thresholds()
        assert dyn['atr_pct_p50'] == 4.0  # median
        assert dyn['chg5d_p40'] == -2.0   # p40 of [-5, -2, +3]
        # ATR=4.5 ≥ 4.0 ✓, chg5d=-3.0 ≤ -2.0 ✓ → alive
        fund = {'avg_atr_pct': 4.5, 'change_5d': -3.0, 'volume_ratio': 1.0}
        r = evaluate_stock_alive(fund, {})
        assert r['alive'] is True
        assert r['reason'] == 'ALIVE'

    def test_momentum_stock_rejected_by_mean_rev(self):
        """Rule 8: سهم طلع كتير (chg5d > p40) → REJECT (mean reversion).
        ده الاكتشاف الحاسم: chg5d Spearman -0.32 مع high%."""
        batch = [
            {'avg_atr_pct': 4.0, 'change_5d': -2.0, 'volume_ratio': 1.2, 'turnover_egp': 1000000, 'volume': 50000, 'change_1d': -1.0},
            {'avg_atr_pct': 3.0, 'change_5d': +3.0, 'volume_ratio': 0.8, 'turnover_egp': 500000, 'volume': 20000, 'change_1d': +2.0},
            {'avg_atr_pct': 5.0, 'change_5d': -5.0, 'volume_ratio': 1.5, 'turnover_egp': 2000000, 'volume': 80000, 'change_1d': -3.0},
        ]
        set_dynamic_thresholds(batch)
        # ATR=4.5 ≥ 4.0 ✓, chg5d=+5.0 > -2.0 → REJECT (mean-rev)
        fund = {'avg_atr_pct': 4.5, 'change_5d': 5.0, 'volume_ratio': 2.0}
        r = evaluate_stock_alive(fund, {})
        assert r['alive'] is False
        assert 'chg5d' in r['reason']

    def test_low_atr_rejected_even_with_mean_rev(self):
        """Rule 8: ATR تحت median → REJECT حتى لو chg5d ≤ p40.
        السهم لازم يكون متقلب بما يكفي (ATR) + mean-reversion."""
        batch = [
            {'avg_atr_pct': 4.0, 'change_5d': -2.0, 'volume_ratio': 1.2, 'turnover_egp': 1000000, 'volume': 50000, 'change_1d': -1.0},
            {'avg_atr_pct': 3.0, 'change_5d': +3.0, 'volume_ratio': 0.8, 'turnover_egp': 500000, 'volume': 20000, 'change_1d': +2.0},
            {'avg_atr_pct': 5.0, 'change_5d': -5.0, 'volume_ratio': 1.5, 'turnover_egp': 2000000, 'volume': 80000, 'change_1d': -3.0},
        ]
        set_dynamic_thresholds(batch)
        # ATR=2.0 < 4.0 → REJECT ( حتى لو chg5d=-3.0 ≤ -2.0)
        fund = {'avg_atr_pct': 2.0, 'change_5d': -3.0, 'volume_ratio': 1.5}
        r = evaluate_stock_alive(fund, {})
        assert r['alive'] is False
        assert 'atr' in r['reason']

    def test_metrics_returned(self):
        """الـ metrics بترجع للـ log (شامل ATR, VR diagnostic, chg5d, RS)."""
        fund = {'avg_atr_pct': 2.0, 'change_5d': 1.0, 'market_change_5d': 0.5, 'volume_ratio': 1.5}
        stored = {'volume_ratio': 1.5}
        r = evaluate_stock_alive(fund, stored)
        assert 'metrics' in r
        assert 'atr_pct' in r['metrics']
        assert 'volume_ratio' in r['metrics']   # diagnostic (not a gate)
        assert 'change_5d' in r['metrics']
        assert 'eff_atr_median' in r['metrics']
        assert 'eff_chg5d_p40' in r['metrics']

    def test_dynamic_thresholds_raise_atr_median_in_active_market(self):
        """في سوق نشط (ATR عالي)، الـ median بيرفع العتبة → سهم كان هيعدى بقى يُرفض."""
        batch = [{'avg_atr_pct': 5.0, 'volume_ratio': 3.0, 'change_5d': 2.0, 'turnover_egp': 1000000, 'volume': 50000, 'change_1d': 2.0}] * 20
        set_dynamic_thresholds(batch)
        dyn = get_dynamic_thresholds()
        assert dyn['populated'] is True
        assert dyn['atr_pct_p50'] == 5.0  # median
        # eff_atr = max(0.5, 5.0) = 5.0
        # سهم atr=2.0 < 5.0 → REJECT
        fund = {'avg_atr_pct': 2.0, 'change_5d': 0.0, 'volume_ratio': 1.0}
        r = evaluate_stock_alive(fund, {})
        assert r['alive'] is False
        assert 'atr' in r['reason']

    def test_empty_inputs_not_crash(self):
        """مدخلات فاضية مش تـ crash."""
        r = evaluate_stock_alive({}, {})
        assert r['alive'] is True or r['alive'] is False  # مش crash
        assert 'metrics' in r


# ──────────────────────────────────────────────────────────────────────────────
# PHASE-1B+1C: Integration (the golden path from the analysis)
# ──────────────────────────────────────────────────────────────────────────────

class TestGoldenPathIntegration:
    """السيناريو الذهبي: صفقة DSCW (entry=325.66, target=322.56, stop=297.26).

    ده مثال حقيقي من بيانات الإنتاج للـ bug اللي Phase 1ب/1ج بـ يصلحه.
    """

    def test_dscw_bug_caught_and_fixed(self):
        """DSCW: target < entry → fix_target، ثم R:R بـ يتحقق."""
        entry = 325.66
        target = 322.56  # الـ bug: تحت الـ entry
        stop = 297.26

        # 1ب: direction guard
        dir_r = validate_target_stop_direction('BUY', entry, target, stop)
        assert dir_r['action'] == 'fix_target'
        fixed_target = dir_r['fixed']['target_price']
        assert fixed_target > entry  # بقى فوق الـ entry

        # 1ج: enforce R:R على القيم المصححة
        rr_r = enforce_min_rr('BUY', entry, fixed_target, stop)
        # risk = 325.66 - 297.26 = 28.4
        # fixed_target = 325.66 × 1.03 = 335.43
        # reward = 335.43 - 325.66 = 9.77
        # RR = 9.77 / 28.4 = 0.34 → < 1.5 → widen_target
        assert rr_r['action'] == 'widen_target'
        final_target = rr_r['fixed']['target_price']
        # final = 325.66 + 1.5 × 28.4 = 325.66 + 42.6 = 368.26
        assert final_target > fixed_target
        assert rr_r['rr'] >= 1.5

    def test_good_trade_passes_all_guards(self):
        """صفقة كويسة: entry=100, target=115, stop=95 → كل الـ guards ok."""
        entry = 100.0
        target = 115.0
        stop = 95.0

        dir_r = validate_target_stop_direction('BUY', entry, target, stop)
        assert dir_r['action'] == 'ok'

        rr_r = enforce_min_rr('BUY', entry, target, stop)
        assert rr_r['action'] == 'ok'
        assert rr_r['rr'] == 3.0  # reward=15, risk=5, RR=3


# ──────────────────────────────────────────────────────────────────────────────
# PRIORITY-1: enforce_atr_based_stop (ATR-based stop replaces fixed-% P26 stop)
# ──────────────────────────────────────────────────────────────────────────────

class TestEnforceAtrBasedStop:
    """Priority 1: استبدل الـ fixed-% stop بـ ATR-based stop.

    stop = entry - k × ATR  حيث k = persona multiplier:
      gambler=1.0, balanced=1.5, conservative=2.0
    """

    def test_gambler_uses_1_atr(self):
        """gambler: k=1.0 → stop = entry - 1×ATR."""
        entry = 100.0
        atr = 3.0  # 3% ATR
        result = enforce_atr_based_stop('BUY', entry, stop_loss=95.0, atr=atr, persona_type='gambler')
        assert result['action'] == 'replace_stop'
        # stop = 100 - 1.0 × 3 = 97
        assert result['fixed']['stop_loss'] == 97.0
        assert result['k'] == 1.0
        assert result['atr_stop_pct'] == 3.0

    def test_balanced_uses_1_5_atr(self):
        """balanced: k=1.5 → stop = entry - 1.5×ATR."""
        entry = 100.0
        atr = 2.0  # 2% ATR
        result = enforce_atr_based_stop('BUY', entry, stop_loss=93.0, atr=atr, persona_type='balanced')
        assert result['action'] == 'replace_stop'
        # stop = 100 - 1.5 × 2 = 97
        assert result['fixed']['stop_loss'] == 97.0
        assert result['k'] == 1.5
        assert result['atr_stop_pct'] == 3.0

    def test_conservative_uses_2_atr(self):
        """conservative: k=2.0 → stop = entry - 2×ATR (wider, not fixed 10-15%)."""
        entry = 100.0
        atr = 2.5  # 2.5% ATR
        result = enforce_atr_based_stop('BUY', entry, stop_loss=85.0, atr=atr, persona_type='conservative')
        assert result['action'] == 'replace_stop'
        # stop = 100 - 2.0 × 2.5 = 95
        # ده 5% stop — مش 10-15% زي الـ P26 القديم!
        assert result['fixed']['stop_loss'] == 95.0
        assert result['k'] == 2.0
        assert result['atr_stop_pct'] == 5.0

    def test_conservative_not_10_percent(self):
        """الـ conservative stop لازم يكون ATR-based، مش 10%+ ثابت.
        ده الفرق الأساسي: ATR=3% → stop=6% (مش 10-15%).
        """
        entry = 100.0
        atr = 3.0  # 3% ATR
        result = enforce_atr_based_stop('BUY', entry, stop_loss=85.0, atr=atr, persona_type='conservative')
        assert result['action'] == 'replace_stop'
        # stop = 100 - 2.0 × 3 = 94 → 6% stop
        # الـ P26 القديم كان بـ يدّي 10-15% stop → ده أصلاح جذري
        assert result['fixed']['stop_loss'] == 94.0
        stop_pct = (entry - result['fixed']['stop_loss']) / entry * 100
        assert stop_pct == 6.0
        assert stop_pct < 10.0  # مش 10%+ زي قبل كده

    def test_atr_zero_skips(self):
        """ATR=0 → skip (keep P26 stop, backward compat)."""
        result = enforce_atr_based_stop('BUY', 100.0, stop_loss=93.0, atr=0, persona_type='balanced')
        assert result['action'] == 'skip'
        assert 'atr<=0' in result['reason']

    def test_sell_skips(self):
        """SELL signals → skip (P26 logic for SELL is different)."""
        result = enforce_atr_based_stop('SELL', 100.0, stop_loss=105.0, atr=3.0, persona_type='balanced')
        assert result['action'] == 'skip'
        assert 'not_buy' in result['reason']

    def test_floor_clamped(self):
        """ATR very small → clamp to 3.0% floor (commission + spread guard).

        🔥 P0-v3: الـ floor اترفع من 1.0% لـ 3.0% بناءً على تكليف المالك —
        stop 1% بـ يضرب من العمولات + الـ spread، فـ 3% هو الـ floor الواقعي.
        """
        entry = 100.0
        atr = 0.2  # 0.2% ATR — very calm stock
        result = enforce_atr_based_stop('BUY', entry, stop_loss=99.5, atr=atr, persona_type='gambler')
        assert result['action'] == 'replace_stop'
        # k=1.0, atr=0.2 → 0.2% → clamped to 3.0%
        # stop = 100 - 3.0 = 97.0
        assert result['fixed']['stop_loss'] == 97.0
        assert result['atr_stop_pct'] == 3.0  # clamped to new floor

    def test_ceiling_clamped(self):
        """ATR very large → clamp to 7.0% ceiling (volatility guard).

        🔥 P0-v3: الـ ceiling اتخفّض من 8.0% لـ 7.0% بناءً على تكليف المالك —
        خسارة 8% كبيرة أوي على صفقة واحدة، 7% هو الـ cap الواقعي.
        """
        entry = 100.0
        atr = 10.0  # 10% ATR — very volatile
        result = enforce_atr_based_stop('BUY', entry, stop_loss=80.0, atr=atr, persona_type='conservative')
        assert result['action'] == 'replace_stop'
        # k=2.0, atr=10 → 20% → clamped to 7.0%
        # stop = 100 - 7.0 = 93.0
        assert result['fixed']['stop_loss'] == 93.0
        assert result['atr_stop_pct'] == 7.0  # clamped to new ceiling

    def test_investor_alias(self):
        """investor → treated as conservative."""
        entry = 100.0
        atr = 2.0
        result = enforce_atr_based_stop('BUY', entry, stop_loss=90.0, atr=atr, persona_type='investor')
        assert result['action'] == 'replace_stop'
        assert result['k'] == 2.0  # conservative multiplier

    def test_entry_zero_skip(self):
        """entry=0 → skip."""
        result = enforce_atr_based_stop('BUY', 0, stop_loss=0, atr=3.0, persona_type='gambler')
        assert result['action'] == 'skip'

    def test_strong_buy_treated_as_buy(self):
        """STRONG_BUY → same as BUY."""
        entry = 100.0
        atr = 3.0
        result = enforce_atr_based_stop('STRONG_BUY', entry, stop_loss=95.0, atr=atr, persona_type='gambler')
        assert result['action'] == 'replace_stop'
        assert result['fixed']['stop_loss'] == 97.0

    def test_atr_stop_then_rr_guard_integration(self):
        """Golden path: ATR stop → direction guard → R:R guard.

        سيناريو: conservative persona بـ P26 stop 85% (15% stop — الـ bug القديم).
        بعد ATR guard: stop بيبقى 6% (ATR-based).
        بعد R:R guard: target بـ يتوسّع لـ R:R ≥ 1.5.
        """
        entry = 100.0
        target = 108.0  # 8% target (من P26)
        stop_p26 = 85.0  # 15% stop (الـ bug القديم لـ conservative)
        atr = 3.0

        # Priority 1: ATR-based stop
        atr_r = enforce_atr_based_stop('BUY', entry, stop_loss=stop_p26, atr=atr, persona_type='conservative')
        assert atr_r['action'] == 'replace_stop'
        new_stop = atr_r['fixed']['stop_loss']
        # stop = 100 - 2.0 × 3 = 94 (6%)
        assert new_stop == 94.0
        stop_pct = (entry - new_stop) / entry * 100
        assert stop_pct == 6.0  # مش 15% زي قبل كده!

        # 1ب: direction guard (بـ validate الـ ATR stop)
        dir_r = validate_target_stop_direction('BUY', entry, target, new_stop)
        assert dir_r['action'] == 'ok'  # target > entry, stop < entry → ok

        # 1ج: R:R enforcement
        rr_r = enforce_min_rr('BUY', entry, target, new_stop)
        # risk = 100 - 94 = 6, reward = 108 - 100 = 8, RR = 8/6 = 1.33 → < 1.5 → widen
        assert rr_r['action'] == 'widen_target'
        final_target = rr_r['fixed']['target_price']
        # final = 100 + 1.5 × 6 = 109
        assert final_target == 109.0
        assert rr_r['rr'] >= 1.5

