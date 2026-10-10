"""
Unit tests for the engine_settings resolver (settings consistency).
=====================================================================
Validates that DEFAULT_SETTINGS, get_settings_descriptions(), and
cross-module consumers stay in sync — no hardcoded values, no orphan
keys, no type mismatches.
"""

from __future__ import annotations

import re
import textwrap
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# ---------------------------------------------------------------------------
# Imports from the module under test
# ---------------------------------------------------------------------------
from analyzers.engine_settings import (
    DEFAULT_SETTINGS,
    get_setting,
    get_setting_typed,
    get_settings_descriptions,
    get_all_settings,
    invalidate_cache,
    _coerce_value,
    _cache,
    _CACHE_TTL,
)

# Alias to match the task spec naming convention
_DEFAULTS = DEFAULT_SETTINGS
_SETTINGS_SCHEMA_FUNC = get_settings_descriptions

# ---------------------------------------------------------------------------
# Paths for cross-module source-file checks
# ---------------------------------------------------------------------------
_VPS_ROOT = Path(__file__).resolve().parent.parent.parent
_INSTITUTIONAL_ENGINE = _VPS_ROOT / "analyzers" / "institutional_decision_engine.py"
_BACKTEST_ENGINE = _VPS_ROOT / "engines" / "backtest_engine.py"
_STOP_MANAGER = _VPS_ROOT / "portfolio" / "stop_manager.py"


# ═══════════════════════════════════════════════════════════════════════════
# 1. Defaults Completeness Tests
# ═══════════════════════════════════════════════════════════════════════════

class TestDefaultsCompleteness:
    """Every default key must have a schema (description) entry and vice-versa."""

    @pytest.fixture(autouse=True)
    def _load_schema(self):
        self.schema = _SETTINGS_SCHEMA_FUNC()

    def test_all_defaults_have_schema(self):
        """Every key in DEFAULT_SETTINGS has a corresponding entry in the schema."""
        missing = set(_DEFAULTS.keys()) - set(self.schema.keys())
        assert missing == set(), (
            f"Keys in DEFAULTS but missing from schema: {sorted(missing)}"
        )

    def test_all_schema_keys_have_defaults(self):
        """Every key in the schema has a corresponding entry in DEFAULT_SETTINGS."""
        missing = set(self.schema.keys()) - set(_DEFAULTS.keys())
        assert missing == set(), (
            f"Keys in schema but missing from DEFAULTS: {sorted(missing)}"
        )

    def test_no_duplicate_defaults(self):
        """No duplicate keys in DEFAULT_SETTINGS (dict keys are unique by definition,
        but we verify the source code has no accidental re-assignments)."""
        source_path = Path(__file__).resolve().parent.parent.parent / "analyzers" / "engine_settings.py"
        source = source_path.read_text(encoding="utf-8")
        # Find the DEFAULT_SETTINGS dict block
        # Count key occurrences inside the DEFAULT_SETTINGS dict
        in_defaults = False
        key_counts: dict[str, int] = {}
        for line in source.splitlines():
            stripped = line.strip()
            if "DEFAULT_SETTINGS" in stripped and "{" in stripped and ":" in stripped:
                in_defaults = True
                continue
            if in_defaults and stripped.startswith("}"):
                in_defaults = False
                continue
            if in_defaults:
                m = re.match(r'^\s*"([^"]+)"\s*:', stripped)
                if m:
                    key = m.group(1)
                    key_counts[key] = key_counts.get(key, 0) + 1
        duplicates = {k: v for k, v in key_counts.items() if v > 1}
        assert duplicates == {}, f"Duplicate keys in DEFAULT_SETTINGS: {duplicates}"


# ═══════════════════════════════════════════════════════════════════════════
# 2. Risk Settings Consistency Tests (THE KEY TESTS!)
# ═══════════════════════════════════════════════════════════════════════════

class TestRiskSettingsConsistency:
    """Verify that risk-related default values match their expected constants."""

    def test_tech_score_base_default_50(self):
        assert _DEFAULTS["tech_score_base"] == 50

    def test_default_stop_pct_consistent(self):
        assert _DEFAULTS["default_stop_pct"] == 5.0

    def test_tiered_stop_before_t1_is_8(self):
        """Before T1, tiered stop is 8% (was hardcoded [8,5,3])."""
        assert _DEFAULTS["tiered_stop_before_t1_pct"] == 8.0

    def test_tiered_stop_after_t1_is_5(self):
        assert _DEFAULTS["tiered_stop_after_t1_pct"] == 5.0

    def test_tiered_stop_after_t2_is_3(self):
        assert _DEFAULTS["tiered_stop_after_t2_pct"] == 3.0

    def test_trailing_stop_atr_mult_is_2(self):
        assert _DEFAULTS["trailing_stop_atr_mult"] == 2.0

    def test_trailing_stop_activation_gain_is_2(self):
        assert _DEFAULTS["trailing_stop_activation_gain"] == 2.0

    def test_breakeven_trigger_is_7(self):
        assert _DEFAULTS["breakeven_trigger_pct"] == 7.0

    def test_max_portfolio_heat_is_2(self):
        assert _DEFAULTS["max_portfolio_heat_pct"] == 2.0

    def test_position_max_stop_is_10(self):
        assert _DEFAULTS["position_max_stop_pct"] == 10.0

    def test_volatility_stop_atr_mult_is_2_5(self):
        assert _DEFAULTS["volatility_stop_atr_mult"] == 2.5


# ═══════════════════════════════════════════════════════════════════════════
# 3. Cross-Module Consistency Tests
# ═══════════════════════════════════════════════════════════════════════════

class TestCrossModuleConsistency:
    """Verify that default values in engine_settings match what other modules
    read from it (no drifting copies)."""

    def test_tech_score_base_matches_institutional_engine(self):
        """Same default used in engine_settings and institutional_decision_engine."""
        source = _INSTITUTIONAL_ENGINE.read_text(encoding="utf-8")
        # The institutional engine should read tech_score_base via get_setting
        # with default=50, matching our DEFAULT_SETTINGS value
        expected_default = _DEFAULTS["tech_score_base"]
        # Look for: get_setting('tech_score_base', default=50)
        pattern = rf"get_setting\s*\(\s*['\"]tech_score_base['\"],\s*default\s*=\s*{expected_default}\s*\)"
        assert re.search(pattern, source), (
            f"institutional_decision_engine does not read tech_score_base "
            f"with default={expected_default}"
        )

    def test_trailing_stop_matches_backtest(self):
        """trailing_stop_atr_mult default matches backtest_engine's value."""
        source = _BACKTEST_ENGINE.read_text(encoding="utf-8")
        expected = _DEFAULTS["trailing_stop_atr_mult"]
        # Look for: get_setting('trailing_stop_atr_mult', default=2.0)
        # (2.0 may appear as 2 or 2.0 in source)
        pattern = rf"get_setting\s*\(\s*['\"]trailing_stop_atr_mult['\"],\s*default\s*=\s*(?:2\.0|2)\s*\)"
        assert re.search(pattern, source), (
            f"backtest_engine does not read trailing_stop_atr_mult "
            f"with default={expected}"
        )

    def test_tiered_stop_thresholds_match_old_hardcoded(self):
        """New settings [8,5,3] match the old hardcoded values."""
        assert _DEFAULTS["tiered_stop_before_t1_pct"] == 8.0
        assert _DEFAULTS["tiered_stop_after_t1_pct"] == 5.0
        assert _DEFAULTS["tiered_stop_after_t2_pct"] == 3.0


# ═══════════════════════════════════════════════════════════════════════════
# 4. Settings Type Tests
# ═══════════════════════════════════════════════════════════════════════════

class TestSettingsTypes:
    """All default values must be numeric; stop percentages must be positive."""

    def test_all_defaults_are_numeric(self):
        """Every value in DEFAULT_SETTINGS is int or float."""
        non_numeric = {
            k: type(v).__name__
            for k, v in _DEFAULTS.items()
            if not isinstance(v, (int, float))
        }
        assert non_numeric == {}, f"Non-numeric defaults: {non_numeric}"

    def test_stop_pcts_are_positive(self):
        """All stop percentage values > 0."""
        stop_keys = [
            "default_stop_pct",
            "tiered_stop_before_t1_pct",
            "tiered_stop_after_t1_pct",
            "tiered_stop_after_t2_pct",
            "breakeven_trigger_pct",
            "max_portfolio_heat_pct",
            "position_max_stop_pct",
            "trailing_stop_activation_gain",
            "time_stop_min_movement_pct",
        ]
        for key in stop_keys:
            assert _DEFAULTS[key] > 0, f"{key} = {_DEFAULTS[key]} is not positive"

    def test_thresholds_are_reasonable(self):
        """Buy thresholds > sell threshold, stop pcts < 100, etc."""
        # Buy > Sell (institutional)
        assert _DEFAULTS["institutional_buy_threshold"] > _DEFAULTS["institutional_sell_threshold"]
        # Strong buy > regular buy
        assert _DEFAULTS["institutional_strong_buy_threshold"] > _DEFAULTS["institutional_regular_buy_threshold"]
        # Stop percentages < 100
        for key in ("default_stop_pct", "position_max_stop_pct",
                     "tiered_stop_before_t1_pct", "tiered_stop_after_t1_pct",
                     "tiered_stop_after_t2_pct"):
            assert _DEFAULTS[key] < 100, f"{key} = {_DEFAULTS[key]} >= 100"
        # Tiered stop: before_t1 > after_t1 > after_t2 (tightens as price advances)
        assert _DEFAULTS["tiered_stop_before_t1_pct"] > _DEFAULTS["tiered_stop_after_t1_pct"]
        assert _DEFAULTS["tiered_stop_after_t1_pct"] > _DEFAULTS["tiered_stop_after_t2_pct"]
        # Proof weights sum should be roughly 80-100 (sanity check)
        proof_sum = sum(
            _DEFAULTS[k] for k in _DEFAULTS
            if k.startswith("proof_weight_")
        )
        assert 50 <= proof_sum <= 120, f"Proof weights sum = {proof_sum}, outside [50, 120]"


# ═══════════════════════════════════════════════════════════════════════════
# 5. get_setting Function Tests (with mock DB)
# ═══════════════════════════════════════════════════════════════════════════

class TestGetSettingFunction:
    """Test get_setting behaviour with mocked DB layer."""

    def setup_method(self):
        """Invalidate cache before each test to avoid stale data."""
        invalidate_cache()

    def test_get_setting_returns_default_when_no_db(self):
        """When DB is unavailable (returns empty dict), returns default."""
        with patch("analyzers.engine_settings._get_all_raw", return_value={}):
            invalidate_cache()
            result = get_setting("tech_score_base")
            assert result == float(_DEFAULTS["tech_score_base"])

    def test_get_setting_returns_db_value_when_present(self):
        """When DB has a value, it overrides the default."""
        with patch("analyzers.engine_settings._get_all_raw", return_value={"tech_score_base": "75"}):
            invalidate_cache()
            result = get_setting("tech_score_base")
            assert result == 75.0

    def test_get_setting_caching(self):
        """Second call returns cached value (within TTL).
        We patch _load_all_from_db (the DB-hit function) so the real
        _get_all_raw caching logic runs on top of the mock."""
        call_count = 0
        original_raw = {"tech_score_base": "55"}

        def mock_load_from_db():
            nonlocal call_count
            call_count += 1
            return original_raw

        with patch("analyzers.engine_settings._load_all_from_db", side_effect=mock_load_from_db):
            invalidate_cache()
            result1 = get_setting("tech_score_base")
            result2 = get_setting("tech_score_base")
            assert result1 == 55.0
            assert result2 == 55.0
            # _load_all_from_db should have been called only once due to caching
            # (the first call populates the cache; the second uses it)
            assert call_count == 1

    def test_get_setting_type_coercion(self):
        """String values from DB are coerced to float by get_setting."""
        with patch("analyzers.engine_settings._get_all_raw", return_value={"default_stop_pct": "3.5"}):
            invalidate_cache()
            result = get_setting("default_stop_pct")
            assert isinstance(result, float)
            assert result == 3.5

    def test_get_setting_typed_preserves_int(self):
        """get_setting_typed preserves int type for int defaults."""
        with patch("analyzers.engine_settings._get_all_raw", return_value={"tech_score_base": "60"}):
            invalidate_cache()
            result = get_setting_typed("tech_score_base")
            assert isinstance(result, int)
            assert result == 60

    def test_get_setting_typed_preserves_float(self):
        """get_setting_typed preserves float type for float defaults."""
        with patch("analyzers.engine_settings._get_all_raw", return_value={"default_stop_pct": "4.2"}):
            invalidate_cache()
            result = get_setting_typed("default_stop_pct")
            assert isinstance(result, float)
            assert result == 4.2


# ═══════════════════════════════════════════════════════════════════════════
# 6. No Hardcoded Values Regression Tests
# ═══════════════════════════════════════════════════════════════════════════

class TestNoHardcodedValuesRegression:
    """REGRESSION: Ensure old hardcoded values have been replaced by
    get_setting() calls.  These tests grep the actual source files."""

    def test_no_hardcoded_25_in_tech_score(self):
        """REGRESSION: No hardcoded 25 for tech_score_base in institutional
        decision engine (the old bug).  It should read from get_setting."""
        source = _INSTITUTIONAL_ENGINE.read_text(encoding="utf-8")
        # Old bug: score = 25 + ...
        # Fixed: score = get_setting('tech_score_base', default=50) + ...
        # We check that there's no "score = 25" or "score=25" pattern
        bad_pattern = re.search(r"score\s*=\s*25\s*\+", source)
        assert bad_pattern is None, (
            "Found hardcoded 'score = 25 +' in institutional_decision_engine — "
            "should use get_setting('tech_score_base') instead"
        )

    def test_no_hardcoded_8_5_3_in_stop_manager(self):
        """REGRESSION: No [8,5,3] hardcoded list in stop_manager.
        The tiered stop thresholds should come from engine_settings."""
        source = _STOP_MANAGER.read_text(encoding="utf-8")
        # Look for patterns like [8, 5, 3] or (8, 5, 3) which would indicate
        # a hardcoded tiered stop list
        bad_pattern = re.search(r"[\[(]\s*8\s*,\s*5\s*,\s*3\s*[\])]", source)
        assert bad_pattern is None, (
            "Found hardcoded [8, 5, 3] in stop_manager — "
            "should use get_setting() for tiered stop thresholds"
        )

    def test_no_hardcoded_trailing_in_backtest(self):
        """REGRESSION: No standalone TRAILING_STOP_ATR_MULT = 2.0
        constant in backtest_engine (should use get_setting)."""
        source = _BACKTEST_ENGINE.read_text(encoding="utf-8")
        # Look for: TRAILING_STOP_ATR_MULT = 2.0 (without get_setting)
        bad_pattern = re.search(
            r"TRAILING_STOP_ATR_MULT\s*=\s*2\.0\s*$",
            source,
            re.MULTILINE,
        )
        assert bad_pattern is None, (
            "Found hardcoded 'TRAILING_STOP_ATR_MULT = 2.0' in backtest_engine — "
            "should use get_setting('trailing_stop_atr_mult') instead"
        )


# ═══════════════════════════════════════════════════════════════════════════
# 7. Schema Integrity Tests
# ═══════════════════════════════════════════════════════════════════════════

class TestSchemaIntegrity:
    """Validate the schema (descriptions) structure itself."""

    @pytest.fixture(autouse=True)
    def _load_schema(self):
        self.schema = _SETTINGS_SCHEMA_FUNC()

    def test_schema_entries_have_description(self):
        """Every schema entry must have a non-empty 'description' field."""
        bad = [
            k for k, v in self.schema.items()
            if not v.get("description")
        ]
        assert bad == [], f"Schema keys missing description: {sorted(bad)}"

    def test_schema_entries_have_category(self):
        """Every schema entry must have a non-empty 'category' field."""
        bad = [
            k for k, v in self.schema.items()
            if not v.get("category")
        ]
        assert bad == [], f"Schema keys missing category: {sorted(bad)}"

    def test_schema_categories_are_known(self):
        """All categories should be from a known set."""
        known_categories = {
            "liquidity", "volume", "rsi", "scoring", "risk", "targets",
            "delayed_data", "free_float", "limits", "institutional",
            "proofs", "technical", "adaptive", "fundamentals", "position",
            "confidence", "smc", "general",
            # P1.3/P1.4: categories used by V40 keys + regime-specific settings
            "evidence", "exit", "kill_filter", "absorption", "regime",
        }
        unknown = {
            v["category"] for v in self.schema.values()
            if v.get("category") not in known_categories
        }
        assert unknown == set(), f"Unknown categories: {sorted(unknown)}"
