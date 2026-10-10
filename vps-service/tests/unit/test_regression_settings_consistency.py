"""
🔴 REGRESSION — P1.8: Settings consistency + drift prevention
=============================================================
يمنع رجوع bug الـ hardcoded values في modules تانية بدل ما تـ read من
`engine_settings.py`.

الـ test ده بيتأكد إن:
1. كل المفاتيح اللي اتعملها migration في P0.6 + P1.3 + P1.4 + P1.5 موجودة في
   `DEFAULT_SETTINGS` و في schema الوصف (`get_settings_descriptions()`).
2. الـ deprecated shims بترجع نفس القيم اللي في `engine_settings`.
3. كل مفتاح ليه category معروفة (not "unknown").
4. الـ flat-key naming convention متّبع (`<prefix>_<regime_or_persona>`).

Constitution Rule 11 — single source of truth:
    `analyzers/engine_settings.py` → `DEFAULT_SETTINGS` + `get_setting()`

P1.8 spec: `Documentation/03-REFACTORING_REPORT.md` §12.
"""

from __future__ import annotations

import pytest

from analyzers.engine_settings import (
    DEFAULT_SETTINGS,
    get_setting,
    get_settings_descriptions,
)


# ============================================================================
# P0.6 — STOP_LOSS_EGX / STOP_LOSS_CRYPTO migration (13 keys per market)
# ============================================================================
P0_6_STOP_PCT_KEYS = [
    # EGX stock types (8) — note: no small_bank_egx (only medium_bank)
    "stop_pct_large_bank_egx", "stop_pct_medium_bank_egx",
    "stop_pct_large_real_estate_egx",
    "stop_pct_small_real_estate_egx", "stop_pct_large_industrial_egx",
    "stop_pct_small_industrial_egx", "stop_pct_speculative_egx",
    "stop_pct_suspended_egx",
    # CRYPTO types (5)
    "stop_pct_bitcoin_crypto", "stop_pct_ethereum_crypto",
    "stop_pct_large_altcoin_crypto", "stop_pct_small_altcoin_crypto",
    "stop_pct_meme_coin_crypto",
]


# ============================================================================
# P1.3 — REGIME_ATR_MULTIPLIERS migration (14 flat keys)
# ============================================================================
P1_3_REGIME_ATR_KEYS = []
for _regime in ("strong_bull", "weak_bull", "bull", "range", "weak_bear", "bear", "strong_bear"):
    P1_3_REGIME_ATR_KEYS.append(f"regime_atr_stop_{_regime}")
    P1_3_REGIME_ATR_KEYS.append(f"regime_atr_target_{_regime}")


# ============================================================================
# P1.4 — CONFLUENCE_MIN migration (7 flat keys)
# ============================================================================
P1_4_CONFLUENCE_MIN_KEYS = [
    f"regime_confluence_min_{_regime}"
    for _regime in ("strong_bull", "weak_bull", "bull", "range", "weak_bear", "bear", "strong_bear")
]


# ============================================================================
# P1.5 — multi_target_exit constants migration (10 flat keys)
# ============================================================================
P1_5_MULTI_TARGET_KEYS = [
    "persona_trail_atr_gambler", "persona_trail_atr_balanced", "persona_trail_atr_conservative",
    "volatility_expand_atr_threshold", "volatility_expand_stop_widen_atr",
    "volatility_expand_min_profit_pct",
    "hard_max_loss_pct", "stop_loss_sanity_cap_pct", "split_detect_ratio",
    "backtest_forward_window_days",
]


# ============================================================================
# PILLAR-3 — ATR stop clamp range migration (2 flat keys)
# ============================================================================
# المستهلك: core/opportunity_quality.py::enforce_atr_based_stop (الـ stop ATR clamp).
# رفعنا atr_stop_max_pct من 7.0 لـ 9.0 عشان الأسهم المضاربية عالية التقلب.
PILLAR_3_ATR_STOP_KEYS = [
    "atr_stop_min_pct",
    "atr_stop_max_pct",
]


# All migrated keys combined
ALL_MIGRATED_KEYS = (
    P0_6_STOP_PCT_KEYS + P1_3_REGIME_ATR_KEYS + P1_4_CONFLUENCE_MIN_KEYS
    + P1_5_MULTI_TARGET_KEYS + PILLAR_3_ATR_STOP_KEYS
)


# ============================================================================
# Test 1: All migrated keys exist in DEFAULT_SETTINGS
# ============================================================================
class TestMigratedKeysExist:
    """كل المفاتيح المُهاجرة لازم تكون موجودة في DEFAULT_SETTINGS."""

    @pytest.mark.parametrize("key", ALL_MIGRATED_KEYS)
    def test_key_in_default_settings(self, key):
        """المفتاح موجود في DEFAULT_SETTINGS بقيمة non-None."""
        assert key in DEFAULT_SETTINGS, (
            f"P1.8 regression: {key} مش في DEFAULT_SETTINGS. "
            f"غالبًا حد شال المفتاح بالغلط بعد migration."
        )
        assert DEFAULT_SETTINGS[key] is not None, f"{key} موجود لكن قيمته None"

    @pytest.mark.parametrize("key", ALL_MIGRATED_KEYS)
    def test_key_has_schema_description(self, key):
        """المفتاح ليه description في get_settings_descriptions()."""
        schema = get_settings_descriptions()
        assert key in schema, (
            f"P1.8 regression: {key} مش في schema descriptions. "
            f"الـ admin UI مش هيعرضه."
        )
        assert "description" in schema[key], f"{key} مش عنده description"
        assert "category" in schema[key], f"{key} مش عنده category"
        assert schema[key]["description"], f"{key} description فاضية"


# ============================================================================
# Test 2: get_setting() returns the DEFAULT_SETTINGS value (no DB override)
# ============================================================================
class TestGetSettingReturnsDefault:
    """get_setting(key) بدون default= لازم يرجّع DEFAULT_SETTINGS[key]."""

    @pytest.mark.parametrize("key", ALL_MIGRATED_KEYS)
    def test_get_setting_returns_default(self, key):
        """get_setting(key) بيرجّع نفس قيمة DEFAULT_SETTINGS[key]."""
        expected = float(DEFAULT_SETTINGS[key])
        actual = get_setting(key)
        assert actual == pytest.approx(expected, abs=1e-9), (
            f"{key}: get_setting() بيرجّع {actual}، DEFAULT_SETTINGS بيقول {expected}. "
            f"فيه DB override شايل القيمة؟ ولا الـ default logic مكسور؟"
        )


# ============================================================================
# Test 3: P1.3 — REGIME_ATR_MULTIPLIERS shim returns same values
# ============================================================================
class TestRegimeAtrMultipliersShim:
    """الـ deprecated REGIME_ATR_MULTIPLIERS shim بيرجّع نفس القيم."""

    @pytest.mark.parametrize("regime,expected_stop,expected_target", [
        ("strong_bull", 3.0, 5.0),
        ("weak_bull", 2.5, 4.0),
        ("bull", 2.5, 4.0),
        ("range", 1.5, 2.5),
        ("weak_bear", 1.0, 2.0),
        ("bear", 1.0, 2.0),
        ("strong_bear", 0.0, 0.0),
    ])
    def test_regime_atr_value(self, regime, expected_stop, expected_target):
        """REGIME_ATR_MULTIPLIERS[regime] بيرجّع stop و target matching engine_settings."""
        from analyzers.prediction_optimizer import REGIME_ATR_MULTIPLIERS, get_atr_mults

        # Direct dict access
        actual = REGIME_ATR_MULTIPLIERS[regime]
        assert actual["stop"] == pytest.approx(expected_stop, abs=1e-9), (
            f"REGIME_ATR_MULTIPLIERS['{regime}']['stop'] = {actual['stop']}، "
            f"expected {expected_stop}"
        )
        assert actual["target"] == pytest.approx(expected_target, abs=1e-9), (
            f"REGIME_ATR_MULTIPLIERS['{regime}']['target'] = {actual['target']}، "
            f"expected {expected_target}"
        )

        # Function call
        actual_via_fn = get_atr_mults(regime)
        assert actual_via_fn["stop"] == pytest.approx(expected_stop, abs=1e-9)
        assert actual_via_fn["target"] == pytest.approx(expected_target, abs=1e-9)

        # Verify matches engine_settings flat keys
        expected_stop_setting = get_setting(f"regime_atr_stop_{regime}")
        expected_target_setting = get_setting(f"regime_atr_target_{regime}")
        assert actual["stop"] == pytest.approx(expected_stop_setting, abs=1e-9), (
            f"REGIME_ATR_MULTIPLIERS['{regime}']['stop'] = {actual['stop']} "
            f"≠ engine_settings regime_atr_stop_{regime} = {expected_stop_setting}"
        )

    def test_regime_atr_unknown_falls_back_to_range(self):
        """get_atr_mults('unknown') بيرجّع fallback لـ range."""
        from analyzers.prediction_optimizer import get_atr_mults

        result = get_atr_mults("nonexistent_regime")
        assert result["stop"] == pytest.approx(1.5, abs=1e-9)  # range stop
        assert result["target"] == pytest.approx(2.5, abs=1e-9)  # range target


# ============================================================================
# Test 4: P1.4 — CONFLUENCE_MIN shim returns same values
# ============================================================================
class TestConfluenceMinShim:
    """الـ deprecated CONFLUENCE_MIN shim بيرجّع نفس القيم."""

    @pytest.mark.parametrize("regime,expected", [
        ("strong_bull", 1),
        ("weak_bull", 2),
        ("bull", 2),
        ("range", 2),
        ("weak_bear", 3),
        ("bear", 3),
        ("strong_bear", 99),
    ])
    def test_confluence_min_value(self, regime, expected):
        """CONFLUENCE_MIN[regime] بيرجّع القيمة matching engine_settings."""
        from analyzers.prediction_optimizer import CONFLUENCE_MIN, get_confluence_min

        # Direct dict access
        actual = CONFLUENCE_MIN[regime]
        assert actual == pytest.approx(float(expected), abs=1e-9), (
            f"CONFLUENCE_MIN['{regime}'] = {actual}، expected {expected}"
        )

        # Function call
        actual_via_fn = get_confluence_min(regime)
        assert actual_via_fn == pytest.approx(float(expected), abs=1e-9)

        # Verify matches engine_settings flat key
        expected_setting = get_setting(f"regime_confluence_min_{regime}")
        assert actual == pytest.approx(expected_setting, abs=1e-9), (
            f"CONFLUENCE_MIN['{regime}'] = {actual} "
            f"≠ engine_settings regime_confluence_min_{regime} = {expected_setting}"
        )

    def test_confluence_min_unknown_falls_back_to_range(self):
        """get_confluence_min('unknown') بيرجّع fallback لـ range=2."""
        from analyzers.prediction_optimizer import get_confluence_min

        result = get_confluence_min("nonexistent_regime")
        assert result == pytest.approx(2.0, abs=1e-9)


# ============================================================================
# Test 5: P1.5 — multi_target_exit constants read from engine_settings
# ============================================================================
class TestMultiTargetExitConstantsFromSettings:
    """multi_target_exit constants بـ read من engine_settings."""

    @pytest.mark.parametrize("constant_name,setting_key,expected", [
        ("VOLATILITY_EXPAND_ATR_THRESHOLD", "volatility_expand_atr_threshold", 1.5),
        ("VOLATILITY_EXPAND_STOP_WIDEN_ATR", "volatility_expand_stop_widen_atr", 0.5),
        ("VOLATILITY_EXPAND_MIN_PROFIT_PCT", "volatility_expand_min_profit_pct", 2.0),
        ("MAX_HOLDING_DAYS", "backtest_forward_window_days", 90),
        ("HARD_MAX_LOSS_PCT", "hard_max_loss_pct", 15.0),
        ("STOP_LOSS_SANITY_CAP_PCT", "stop_loss_sanity_cap_pct", 30.0),
        ("SPLIT_DETECT_RATIO", "split_detect_ratio", 0.3),
    ])
    def test_constant_matches_setting(self, constant_name, setting_key, expected):
        """الـ constant بـ read من engine_settings و بيوافق القيمة المتوقعة."""
        from portfolio import multi_target_exit as mte

        actual = getattr(mte, constant_name)
        # MAX_HOLDING_DAYS should be int (cast in module)
        if constant_name == "MAX_HOLDING_DAYS":
            assert isinstance(actual, int), f"{constant_name} لازم يكون int، got {type(actual).__name__}"
            assert actual == expected
        else:
            assert actual == pytest.approx(expected, abs=1e-9)

        # Verify the constant matches the engine_settings value
        setting_val = get_setting(setting_key)
        if constant_name == "MAX_HOLDING_DAYS":
            assert actual == int(setting_val)
        else:
            assert actual == pytest.approx(setting_val, abs=1e-9)

    @pytest.mark.parametrize("persona,expected", [
        ("gambler", 1.5),
        ("balanced", 2.0),
        ("conservative", 2.5),
    ])
    def test_persona_trail_atr_dict(self, persona, expected):
        """PERSONA_TRAIL_ATR[persona] بيرجّع القيمة matching engine_settings."""
        from portfolio.multi_target_exit import PERSONA_TRAIL_ATR

        actual = PERSONA_TRAIL_ATR[persona]
        assert actual == pytest.approx(expected, abs=1e-9), (
            f"PERSONA_TRAIL_ATR['{persona}'] = {actual}، expected {expected}"
        )

        # Verify matches engine_settings flat key
        setting_val = get_setting(f"persona_trail_atr_{persona}")
        assert actual == pytest.approx(setting_val, abs=1e-9)


# ============================================================================
# Test 5b: PILLAR-3 — opportunity_quality ATR stop clamp reads from engine_settings
# ============================================================================
class TestPillar3AtrStopFromSettings:
    """PILLAR-3: ATR_STOP_MIN/MAX_PCT بـ read من engine_settings."""

    def test_constants_match_settings_defaults(self):
        """constants في opportunity_quality.py = DEFAULT_SETTINGS."""
        from core.opportunity_quality import (
            ATR_STOP_MIN_PCT, ATR_STOP_MAX_PCT,
        )
        assert ATR_STOP_MIN_PCT == pytest.approx(get_setting("atr_stop_min_pct"), abs=1e-9)
        assert ATR_STOP_MAX_PCT == pytest.approx(get_setting("atr_stop_max_pct"), abs=1e-9)

    def test_max_pct_is_9_not_7(self):
        """PILLAR-3 key assertion: ATR_STOP_MAX_PCT = 9.0 (was 7.0 before)."""
        from core.opportunity_quality import ATR_STOP_MAX_PCT
        assert ATR_STOP_MAX_PCT == 9.0, (
            f"ATR_STOP_MAX_PCT = {ATR_STOP_MAX_PCT}, expected 9.0 (PILLAR-3)"
        )

    def test_min_pct_is_3(self):
        """PILLAR-3 key assertion: ATR_STOP_MIN_PCT = 3.0 (unchanged)."""
        from core.opportunity_quality import ATR_STOP_MIN_PCT
        assert ATR_STOP_MIN_PCT == 3.0, (
            f"ATR_STOP_MIN_PCT = {ATR_STOP_MIN_PCT}, expected 3.0"
        )

    def test_getters_return_settings_values(self):
        """_get_atr_stop_min_pct / _get_atr_stop_max_pct بترجّع settings."""
        from core.opportunity_quality import (
            _get_atr_stop_min_pct, _get_atr_stop_max_pct,
        )
        assert _get_atr_stop_min_pct() == pytest.approx(get_setting("atr_stop_min_pct"), abs=1e-9)
        assert _get_atr_stop_max_pct() == pytest.approx(get_setting("atr_stop_max_pct"), abs=1e-9)

    def test_clamp_uses_settings_driven_values(self):
        """enforce_atr_based_stop بـ respect الـ settings-driven clamp."""
        from core.opportunity_quality import enforce_atr_based_stop
        # Build a synthetic case where ATR is huge → should clamp to max (9.0%)
        # entry=100, atr=20.0, persona=balanced (k=1.5) → atr_dist=30 → pct=30% → clamp to 9%
        result = enforce_atr_based_stop(
            signal='BUY', entry_price=100.0, stop_loss=90.0, atr=20.0, persona_type='balanced',
        )
        assert result['action'] == 'replace_stop'
        assert result['atr_stop_pct'] == pytest.approx(9.0, abs=1e-3), (
            f"atr_stop_pct={result['atr_stop_pct']}, expected 9.0 (PILLAR-3 clamp)"
        )
        # new_stop = entry - (entry × 9/100) = 100 - 9 = 91
        assert result['fixed']['stop_loss'] == pytest.approx(91.0, abs=1e-3)


# ============================================================================
# Test 6: P0.6 — STOP_LOSS_EGX/CRYPTO shims read from engine_settings
# ============================================================================
class TestStopLossShimConsistency:
    """الـ deprecated STOP_LOSS_EGX/CRYPTO shims بترجّع نفس القيم."""

    @pytest.mark.parametrize("stock_type,market", [
        # EGX
        ("large_bank", "egx"), ("medium_bank", "egx"),
        ("large_real_estate", "egx"), ("small_real_estate", "egx"),
        ("large_industrial", "egx"), ("small_industrial", "egx"),
        ("speculative", "egx"), ("suspended", "egx"),
        # CRYPTO
        ("bitcoin", "crypto"), ("ethereum", "crypto"),
        ("large_altcoin", "crypto"), ("small_altcoin", "crypto"),
        ("meme_coin", "crypto"),
    ])
    def test_stop_loss_shim_matches_setting(self, stock_type, market):
        """STOP_LOSS_EGX/CRYPTO shim بيرجّع نفس القيمة من engine_settings.

        الـ shim بيرجّع dict {percent, reason} — فاحصين على ['percent'].
        """
        from risk_management_advanced import STOP_LOSS_CRYPTO, STOP_LOSS_EGX, get_stop_loss_pct

        # Shim dict access — shim returns {'percent': ..., 'reason': ...}
        if market == "egx":
            shim_entry = STOP_LOSS_EGX.get(stock_type)
        else:
            shim_entry = STOP_LOSS_CRYPTO.get(stock_type)
        assert shim_entry is not None, f"STOP_LOSS_{market.upper()}[{stock_type}] = None"
        assert isinstance(shim_entry, dict), f"shim for {stock_type}/{market} مش dict"
        assert "percent" in shim_entry, f"shim['percent'] مش موجود"
        shim_value = shim_entry["percent"]

        # Function call
        fn_value = get_stop_loss_pct(stock_type, market)

        # engine_settings value
        setting_key = f"stop_pct_{stock_type}_{market}"
        setting_value = get_setting(setting_key)

        # All three must match
        assert shim_value == pytest.approx(setting_value, abs=1e-9), (
            f"shim['percent']={shim_value} ≠ setting={setting_value} for {stock_type}/{market}"
        )
        assert fn_value == pytest.approx(setting_value, abs=1e-9), (
            f"get_stop_loss_pct={fn_value} ≠ setting={setting_value} for {stock_type}/{market}"
        )


# ============================================================================
# Test 7: P1.1 — MAX_HOLDING_DAYS documentation consistency
# ============================================================================
class TestMaxHoldingDaysDocumentation:
    """تأكيد إن MAX_HOLDING_DAYS المختلفة ليست contradiction — هي 3 مفاهيم."""

    def test_engine_settings_max_holding_days_is_30(self):
        """engine_settings.max_holding_days = 30 (الإنتاج الافتراضي)."""
        assert DEFAULT_SETTINGS["max_holding_days"] == 30
        assert get_setting("max_holding_days") == 30

    def test_backtest_forward_window_is_90(self):
        """backtest_forward_window_days = 90 (نافذة الباك-تست، مفهوم مختلف)."""
        assert DEFAULT_SETTINGS["backtest_forward_window_days"] == 90
        assert int(get_setting("backtest_forward_window_days")) == 90

    def test_multi_target_max_holding_days_matches_setting(self):
        """multi_target_exit.MAX_HOLDING_DAYS بـ read من backtest_forward_window_days."""
        from portfolio.multi_target_exit import MAX_HOLDING_DAYS

        assert MAX_HOLDING_DAYS == 90
        assert MAX_HOLDING_DAYS == int(get_setting("backtest_forward_window_days"))


# ============================================================================
# Test 8: All categories are known
# ============================================================================
class TestAllCategoriesKnown:
    """كل الـ categories في schema معروفة (يمنع typo/unknown category)."""

    KNOWN_CATEGORIES = {
        "liquidity", "volume", "rsi", "scoring", "risk", "targets",
        "delayed_data", "free_float", "limits", "institutional",
        "proofs", "technical", "adaptive", "fundamentals", "position",
        "confidence", "smc", "general",
        # P1.3/P1.4/P1.5 categories
        "evidence", "exit", "kill_filter", "absorption", "regime",
    }

    def test_no_unknown_categories(self):
        """مفيش category مش معروفة في الـ schema."""
        schema = get_settings_descriptions()
        unknown = {
            v["category"] for v in schema.values()
            if v.get("category") not in self.KNOWN_CATEGORIES
        }
        assert unknown == set(), f"Unknown categories: {sorted(unknown)}"


# ============================================================================
# Test 9: Naming convention — flat keys, not nested dicts
# ============================================================================
class TestFlatKeyNamingConvention:
    """كل المفاتيح المُهاجرة بتتبع naming convention المسطح (لا dicts متداخلة)."""

    @pytest.mark.parametrize("key", ALL_MIGRATED_KEYS)
    def test_key_is_string_primitive(self, key):
        """كل مفتاح قيمته primitive (int/float/str)، مش dict/list."""
        value = DEFAULT_SETTINGS[key]
        assert isinstance(value, (int, float, str, bool)), (
            f"{key} قيمته {type(value).__name__} — لازم primitive per Constitution Rule."
        )
        # Ensure key is snake_case (lowercase with underscores)
        assert key == key.lower(), f"{key} لازم lowercase"
        assert " " not in key, f"{key} فيه spaces — لازم snake_case"
