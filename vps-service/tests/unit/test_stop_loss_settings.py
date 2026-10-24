"""
🔴 REGRESSION — P0.6: Stop loss settings consistency
====================================================
يمنع رجوع bug الـ `STOP_LOSS_EGX` / `STOP_LOSS_CRYPTO` hardcoded.

الـ test ده بيتأكد إن:
1. كل stock_type × market combo بيرجّع نفس قيمة `engine_settings`.
2. الـ deprecated `STOP_LOSS_EGX` / `STOP_LOSS_CRYPTO` shims بيرجّعوا نفس
   القيم (drift prevention).
3. كل المفاتيح الجديدة موجودة في `DEFAULT_SETTINGS` وفي schema الوصف.

مصدر الحقيقة الواحد (Constitution Rule 11):
    `analyzers/engine_settings.py` → `get_setting('stop_pct_<type>_<market>')`

P0.6 spec: `Documentation/03-REFACTORING_REPORT.md` §8.3 + §13 مثال 2.
"""

from __future__ import annotations

import pytest

from analyzers.engine_settings import (
    DEFAULT_SETTINGS,
    get_setting,
    get_settings_descriptions,
)
from risk_management_advanced import (
    STOP_LOSS_CRYPTO,
    STOP_LOSS_EGX,
    _STOP_LOSS_FALLBACK_CRYPTO,
    _STOP_LOSS_FALLBACK_EGX,
    calculate_stop_loss,
    get_stop_loss_pct,
)


# ---------------------------------------------------------------------------
# Constants — كل الـ stock types المتوقعة (مصدر الحقيقة)
# ---------------------------------------------------------------------------
_EGX_STOCK_TYPES = [
    'large_bank',
    'medium_bank',
    'large_real_estate',
    'small_real_estate',
    'large_industrial',
    'small_industrial',
    'speculative',
    'suspended',
]

_CRYPTO_STOCK_TYPES = [
    'bitcoin',
    'ethereum',
    'large_altcoin',
    'small_altcoin',
    'meme_coin',
]


# ═══════════════════════════════════════════════════════════════════════════
# 1. get_stop_loss_pct == get_setting — المصدر الوحيد
# ═══════════════════════════════════════════════════════════════════════════

class TestGetStopLossPctReadsFromEngineSettings:
    """كل استدعاء لـ get_stop_loss_pct لازم يقرأ من engine_settings."""

    @pytest.mark.parametrize("stock_type", _EGX_STOCK_TYPES)
    def test_egx_stock_type_matches_engine_setting(self, stock_type: str):
        """get_stop_loss_pct('large_bank', 'EGX') == get_setting('stop_pct_large_bank_egx')."""
        key = f'stop_pct_{stock_type}_egx'
        assert key in DEFAULT_SETTINGS, (
            f"Key {key!r} missing from DEFAULT_SETTINGS — did you forget to add it?"
        )
        expected = DEFAULT_SETTINGS[key]
        actual = get_stop_loss_pct(stock_type, 'EGX')
        assert actual == pytest.approx(expected), (
            f"get_stop_loss_pct({stock_type!r}, 'EGX')={actual} "
            f"!= engine_settings[{key!r}]={expected}"
        )

    @pytest.mark.parametrize("stock_type", _CRYPTO_STOCK_TYPES)
    def test_crypto_stock_type_matches_engine_setting(self, stock_type: str):
        """get_stop_loss_pct('bitcoin', 'CRYPTO') == get_setting('stop_pct_bitcoin_crypto')."""
        key = f'stop_pct_{stock_type}_crypto'
        assert key in DEFAULT_SETTINGS, (
            f"Key {key!r} missing from DEFAULT_SETTINGS — did you forget to add it?"
        )
        expected = DEFAULT_SETTINGS[key]
        actual = get_stop_loss_pct(stock_type, 'CRYPTO')
        assert actual == pytest.approx(expected), (
            f"get_stop_loss_pct({stock_type!r}, 'CRYPTO')={actual} "
            f"!= engine_settings[{key!r}]={expected}"
        )

    @pytest.mark.parametrize("stock_type", _EGX_STOCK_TYPES)
    def test_egx_case_insensitive_market(self, stock_type: str):
        """market = 'egx' (lowercase) بيرجّع نفس القيمة."""
        upper = get_stop_loss_pct(stock_type, 'EGX')
        lower = get_stop_loss_pct(stock_type, 'egx')
        assert upper == pytest.approx(lower)

    @pytest.mark.parametrize("stock_type", _CRYPTO_STOCK_TYPES)
    def test_crypto_case_insensitive_market(self, stock_type: str):
        upper = get_stop_loss_pct(stock_type, 'CRYPTO')
        lower = get_stop_loss_pct(stock_type, 'crypto')
        assert upper == pytest.approx(lower)


# ═══════════════════════════════════════════════════════════════════════════
# 2. Default values match the originally hardcoded dicts
# ═══════════════════════════════════════════════════════════════════════════

class TestDefaultValuesMatchOriginalDict:
    """القيم في engine_settings لازم تطابق القيم الأصلية في الـ dict القديم."""

    @pytest.mark.parametrize("stock_type,expected", [
        ('large_bank', -7.0),
        ('medium_bank', -8.0),
        ('large_real_estate', -10.0),
        ('small_real_estate', -12.0),
        ('large_industrial', -8.0),
        ('small_industrial', -10.0),
        ('speculative', -5.0),
        ('suspended', 0.0),
    ])
    def test_egx_default_value(self, stock_type: str, expected: float):
        actual = get_stop_loss_pct(stock_type, 'EGX')
        assert actual == pytest.approx(expected), (
            f"EGX {stock_type}: expected {expected}, got {actual}"
        )

    @pytest.mark.parametrize("stock_type,expected", [
        ('bitcoin', -10.0),
        ('ethereum', -12.0),
        ('large_altcoin', -15.0),
        ('small_altcoin', -20.0),
        ('meme_coin', -25.0),
    ])
    def test_crypto_default_value(self, stock_type: str, expected: float):
        actual = get_stop_loss_pct(stock_type, 'CRYPTO')
        assert actual == pytest.approx(expected), (
            f"CRYPTO {stock_type}: expected {expected}, got {actual}"
        )


# ═══════════════════════════════════════════════════════════════════════════
# 3. Deprecated STOP_LOSS_EGX / STOP_LOSS_CRYPTO shims — drift prevention
# ═══════════════════════════════════════════════════════════════════════════

class TestDeprecatedShimsMatchEngineSettings:
    """الـ shims القديمة لازم بترجّع نفس القيم من engine_settings.

    ده يمنع drift: لو حد عدّل قيمة في engine_settings، الـ shim لازم
    بيرجّع نفس القيمة الجديدة (لأنها بـ read dynamically).
    """

    @pytest.mark.parametrize("stock_type", _EGX_STOCK_TYPES)
    def test_stop_loss_egx_shim_matches_engine_settings(self, stock_type: str):
        """STOP_LOSS_EGX[stock_type]['percent'] == get_stop_loss_pct(stock_type, 'EGX')."""
        shim_value = STOP_LOSS_EGX[stock_type]['percent']
        engine_value = get_stop_loss_pct(stock_type, 'EGX')
        assert shim_value == pytest.approx(engine_value), (
            f"STOP_LOSS_EGX[{stock_type!r}]['percent']={shim_value} "
            f"!= get_stop_loss_pct({stock_type!r}, 'EGX')={engine_value}"
        )

    @pytest.mark.parametrize("stock_type", _CRYPTO_STOCK_TYPES)
    def test_stop_loss_crypto_shim_matches_engine_settings(self, stock_type: str):
        """STOP_LOSS_CRYPTO[stock_type]['percent'] == get_stop_loss_pct(stock_type, 'CRYPTO')."""
        shim_value = STOP_LOSS_CRYPTO[stock_type]['percent']
        engine_value = get_stop_loss_pct(stock_type, 'CRYPTO')
        assert shim_value == pytest.approx(engine_value), (
            f"STOP_LOSS_CRYPTO[{stock_type!r}]['percent']={shim_value} "
            f"!= get_stop_loss_pct({stock_type!r}, 'CRYPTO')={engine_value}"
        )

    @pytest.mark.parametrize("stock_type", _EGX_STOCK_TYPES)
    def test_stop_loss_egx_shim_get_method(self, stock_type: str):
        """STOP_LOSS_EGX.get(stock_type, default) بيرجّع القيمة الصحيحة."""
        result = STOP_LOSS_EGX.get(stock_type)
        assert result is not None
        assert result['percent'] == pytest.approx(get_stop_loss_pct(stock_type, 'EGX'))

    def test_stop_loss_egx_shim_get_missing_key_returns_default(self):
        """STOP_LOSS_EGX.get('nonexistent_key', 'default') == 'default'."""
        assert STOP_LOSS_EGX.get('__nonexistent__', 'sentinel') == 'sentinel'

    def test_stop_loss_egx_shim_len(self):
        """الـ shim لازم بيرجّع len == 8 (عدد الـ EGX stock types)."""
        assert len(STOP_LOSS_EGX) == 8

    def test_stop_loss_crypto_shim_len(self):
        """الـ shim لازم بيرجّع len == 5 (عدد الـ CRYPTO stock types)."""
        assert len(STOP_LOSS_CRYPTO) == 5

    def test_stop_loss_egx_shim_keys(self):
        """الـ shim لازم يرجّع كل الـ EGX stock types."""
        expected_keys = set(_EGX_STOCK_TYPES)
        actual_keys = set(STOP_LOSS_EGX.keys())
        assert actual_keys == expected_keys, (
            f"STOP_LOSS_EGX keys mismatch: {actual_keys ^ expected_keys}"
        )

    def test_stop_loss_crypto_shim_keys(self):
        expected_keys = set(_CRYPTO_STOCK_TYPES)
        actual_keys = set(STOP_LOSS_CRYPTO.keys())
        assert actual_keys == expected_keys, (
            f"STOP_LOSS_CRYPTO keys mismatch: {actual_keys ^ expected_keys}"
        )


# ═══════════════════════════════════════════════════════════════════════════
# 4. Unknown stock types — fallback behavior
# ═══════════════════════════════════════════════════════════════════════════

class TestUnknownStockTypeFallback:
    """لو stock_type غير معروف، لازم نرجّع fallback معقول (matching original behavior)."""

    def test_unknown_egx_falls_back_to_speculative(self):
        """unknown EGX → speculative (-5.0) — نفس سلوك الـ dict الأصلي."""
        assert get_stop_loss_pct('__unknown__', 'EGX') == pytest.approx(-5.0)

    def test_unknown_crypto_falls_back_to_large_altcoin(self):
        """unknown CRYPTO → large_altcoin (-15.0) — نفس سلوك الـ dict الأصلي."""
        assert get_stop_loss_pct('__unknown__', 'CRYPTO') == pytest.approx(-15.0)

    def test_empty_stock_type_egx(self):
        """empty stock_type EGX → fallback speculative."""
        assert get_stop_loss_pct('', 'EGX') == pytest.approx(-5.0)

    def test_unknown_market_treated_as_egx(self):
        """أي قيمة غير 'CRYPTO' بتـ تتعامل كـ EGX."""
        val = get_stop_loss_pct('large_bank', 'NASDAQ')
        assert val == pytest.approx(get_stop_loss_pct('large_bank', 'EGX'))


# ═══════════════════════════════════════════════════════════════════════════
# 5. Schema completeness — كل المفاتيح الجديدة موصوفة
# ═══════════════════════════════════════════════════════════════════════════

class TestSchemaCompleteness:
    """كل مفتاح في DEFAULT_SETTINGS لازم يكون موصوف في الـ schema."""

    @pytest.mark.parametrize("stock_type", _EGX_STOCK_TYPES)
    def test_egx_key_has_schema_entry(self, stock_type: str):
        key = f'stop_pct_{stock_type}_egx'
        schema = get_settings_descriptions()
        assert key in schema, f"Schema missing key: {key!r}"
        assert schema[key].get('category') == 'risk', (
            f"Key {key!r} should be in 'risk' category, got {schema[key].get('category')!r}"
        )
        assert schema[key].get('description'), f"Empty description for {key!r}"

    @pytest.mark.parametrize("stock_type", _CRYPTO_STOCK_TYPES)
    def test_crypto_key_has_schema_entry(self, stock_type: str):
        key = f'stop_pct_{stock_type}_crypto'
        schema = get_settings_descriptions()
        assert key in schema, f"Schema missing key: {key!r}"
        assert schema[key].get('category') == 'risk', (
            f"Key {key!r} should be in 'risk' category, got {schema[key].get('category')!r}"
        )
        assert schema[key].get('description'), f"Empty description for {key!r}"


# ═══════════════════════════════════════════════════════════════════════════
# 6. calculate_stop_loss يقرأ من engine_settings (end-to-end)
# ═══════════════════════════════════════════════════════════════════════════

class TestCalculateStopLossEndToEnd:
    """calculate_stop_loss لازم يقرأ نسبة الـ stop من engine_settings."""

    def test_egx_large_bank_stop_loss(self):
        """large_bank EGX: entry=100 → stop=93 (−7%)."""
        result = calculate_stop_loss(entry_price=100.0, stock_type='large_bank', market='egx')
        assert result['stop_percent'] == pytest.approx(-7.0)
        assert result['stop_price'] == pytest.approx(93.0)
        assert result['stock_type'] == 'large_bank'

    def test_crypto_bitcoin_stop_loss(self):
        """bitcoin CRYPTO: entry=100 → stop=90 (−10%)."""
        result = calculate_stop_loss(entry_price=100.0, stock_type='bitcoin', market='crypto')
        assert result['stop_percent'] == pytest.approx(-10.0)
        assert result['stop_price'] == pytest.approx(90.0)

    def test_custom_percent_overrides_engine_setting(self):
        """custom_percent لازم يـ override أي قيمة من engine_settings."""
        result = calculate_stop_loss(
            entry_price=100.0,
            stock_type='large_bank',
            market='egx',
            custom_percent=-12.5,
        )
        assert result['stop_percent'] == pytest.approx(-12.5)
        assert result['stop_price'] == pytest.approx(87.5)

    def test_unknown_stock_type_egx_uses_fallback(self):
        """لو stock_type غريب EGX، لازم يرجّع fallback speculative (-5%)."""
        result = calculate_stop_loss(entry_price=100.0, stock_type='__weird__', market='egx')
        assert result['stop_percent'] == pytest.approx(-5.0)

    def test_unknown_stock_type_crypto_uses_fallback(self):
        """لو stock_type غريب CRYPTO، لازم يرجّع fallback large_altcoin (-15%)."""
        result = calculate_stop_loss(entry_price=100.0, stock_type='__weird__', market='crypto')
        assert result['stop_percent'] == pytest.approx(-15.0)


# ═══════════════════════════════════════════════════════════════════════════
# 7. Backward compat — الفallback dict values لازم تطابق engine_settings
# ═══════════════════════════════════════════════════════════════════════════

class TestFallbackDictsMatchEngineSettings:
    """الـ _STOP_LOSS_FALLBACK_EGX/CRYPTO dicts (fallback لو engine_settings مش متاح)
    لازم تطابق DEFAULT_SETTINGS — عشان ما يحصلش drift لو engine_settings قفل.
    """

    @pytest.mark.parametrize("stock_type", _EGX_STOCK_TYPES)
    def test_egx_fallback_matches_engine_setting(self, stock_type: str):
        key = f'stop_pct_{stock_type}_egx'
        fallback_value = _STOP_LOSS_FALLBACK_EGX[stock_type]['percent']
        engine_value = DEFAULT_SETTINGS[key]
        assert fallback_value == pytest.approx(engine_value), (
            f"Fallback for {stock_type!r} ({fallback_value}) != engine_settings "
            f"[{key!r}] ({engine_value}) — drift detected"
        )

    @pytest.mark.parametrize("stock_type", _CRYPTO_STOCK_TYPES)
    def test_crypto_fallback_matches_engine_setting(self, stock_type: str):
        key = f'stop_pct_{stock_type}_crypto'
        fallback_value = _STOP_LOSS_FALLBACK_CRYPTO[stock_type]['percent']
        engine_value = DEFAULT_SETTINGS[key]
        assert fallback_value == pytest.approx(engine_value), (
            f"Fallback for {stock_type!r} ({fallback_value}) != engine_settings "
            f"[{key!r}] ({engine_value}) — drift detected"
        )
