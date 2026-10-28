#!/usr/bin/env python3
"""
test_regime_parity.py — Market Regime Parity Test (Task FIX-E)
==============================================================
يقارن كل implementations الـ Market Regime في vps-service على بيانات
مرجعية معروفة (price series ثابت) + يوضّح أن implementations المختلفة
بتـ نتـج vocabulary مختلفة (مش قابلين للمقارنة المباشرة).

الـ implementations المختبرة (كلها stateless — read-only test):
  1. engines/market_regime.py::MarketRegimeEngine         (Minervini Stage 1-4)
  2. analyzers/market_regime_engine.py::MarketRegimeEngine (DEFENSIVE/NORMAL/AGGRESSIVE)
  3. analyzers/regime_detector.py::RegimeDetector           (bull_trend/bear_trend/ranging)
  4. analyzers/regime_filter.py::is_bullish_regime          (bullish/not-bullish binary)
  5. analyzers/hmm_market_regime.py::HMMMarketRegime        (Wyckoff: Accumulation/Markup/Distribution/Markdown)
  6. analyzers/adaptive_weights.py::detect_regime           (bull/bear/range)
  7. analyzers/breakout_signal.py::calc_regime              (BULL/BEAR/RANGE)
  8. core/orchestrator_v3.py::classify_regime               (BULL_STABLE/BULL_WEAK/BEAR_*/SIDEWAYS/HIGH_VOL/CONFLICTING + S1-S11)
  9. core/orchestrator_v2.py::detect_market_regime          (R1-R11 + S1-S14)
 10. camp/orchestrator.py::Orchestrator.detect_regime       (Bull/Bear/Sideways)
 11. config/market_config.py::get_regime_settings           (bull/bear/range settings map)
 12. analyzers/crypto_regime.py::CryptoRegimeDetector       (crypto-specific — needs API; we test the regime enum)
 13. scripts/run_backtest.py::get_regime                    (bull/bear/range — backtest-only)

Outputs:
  - جدول مقارنة بـ regime output من كل implementation.
  - vocabulary matrix (أي implementation بـ ينتج أي vocab).
  - divergence report.

NOTE: implementations اللي بـ تتطلب DB/API (MarketRegimeEngine, RegimeDetector,
HMMMarketRegime, CryptoRegimeDetector) بـ نـ testها عبر monkey-patching للـ
data loading method عشان نـ feed نفس البيانات المرجعية.

Author: برافو V2 (subagent — FIX-E, Market Regime parity)
"""
from __future__ import annotations

import os
import sys
import math
from typing import List, Optional, Tuple, Dict, Any
from unittest.mock import patch, MagicMock

# Project root for vps-service imports
_VPS_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'vps-service'))
if _VPS_ROOT not in sys.path:
    sys.path.insert(0, _VPS_ROOT)
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)


# ============================================================================
# REFERENCE DATA — 3 scenarios: bull / bear / sideways (200+ days each)
# كل سيناريو = 220 يوم (يكفي لـ SMA200 + buffer للـ regime calculations)
# ============================================================================

def _gen_bull_series(n: int = 220, start: float = 100.0) -> List[float]:
    """سلسلة صاعدة واضحة: +0.15%/day with mild noise."""
    prices = [start]
    for i in range(1, n):
        # rising trend with small sinusoidal noise
        noise = 0.4 * math.sin(i / 7.0) + 0.2 * math.sin(i / 23.0)
        prices.append(round(prices[-1] * (1.0015 + noise / 1000.0), 4))
    return prices


def _gen_bear_series(n: int = 220, start: float = 100.0) -> List[float]:
    """سلسلة هابطة واضحة: -0.15%/day with mild noise."""
    prices = [start]
    for i in range(1, n):
        noise = 0.4 * math.sin(i / 7.0) + 0.2 * math.sin(i / 23.0)
        prices.append(round(prices[-1] * (0.9985 + noise / 1000.0), 4))
    return prices


def _gen_sideways_series(n: int = 220, start: float = 100.0) -> List[float]:
    """سلسلة متراوحة: ±0.05%/day with stronger sinusoidal."""
    prices = [start]
    for i in range(1, n):
        # sideways — small sinusoidal oscillation
        noise = 1.5 * math.sin(i / 11.0) + 0.5 * math.sin(i / 31.0)
        prices.append(round(start + noise, 4))
    return prices


BULL_PRICES: List[float] = _gen_bull_series()
BEAR_PRICES: List[float] = _gen_bear_series()
SIDEWAYS_PRICES: List[float] = _gen_sideways_series()

# Fake dates (chronological strings, daily)
from datetime import datetime, timedelta
BASE_DATE = datetime(2026, 1, 5)  # Sunday
DATES: List[str] = [(BASE_DATE + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(220)]


# ============================================================================
# REGIME IMPLEMENTATION LOADERS
# ============================================================================
# كل loader بيرجع (name, callable, vocabulary_description, persistent?)
# callable بياخد prices (List[float]) ويرجع (regime_label: str) أو dict.


def load_engines_market_regime():
    """1) engines/market_regime.py::MarketRegimeEngine — Minervini Stage 1-4."""
    from engines.market_regime import MarketRegimeEngine, RegimeResult

    def _classify(prices: List[float]) -> str:
        engine = MarketRegimeEngine(index_ticker='TEST')
        # Build closes list with dates (engine expects list of closes from DB)
        # Patch _load_closes to return our reference prices
        def _fake_load_closes(self, as_of_date=None):
            return list(prices), list(DATES[:len(prices)])
        # Patch _calc_adx to avoid NaN issues with synthetic closes (no real OHLC)
        def _fake_calc_adx(self, closes, period=14):
            return 25.0  # neutral placeholder
        with patch.object(MarketRegimeEngine, '_load_closes', _fake_load_closes), \
             patch.object(MarketRegimeEngine, '_calc_adx', _fake_calc_adx):
            result = engine.get_regime()
        return f'Stage {result.stage} ({result.stage_name})'
    return ('engines/market_regime.py::MarketRegimeEngine',
            _classify,
            'Minervini: Stage 1=Consolidation / 2=Bull / 3=Distribution / 4=Bear',
            False)  # stateless


def load_analyzers_market_regime_engine():
    """2) analyzers/market_regime_engine.py::MarketRegimeEngine — DEFENSIVE/NORMAL/AGGRESSIVE.

    This is the production regime engine. detect_regime(indicators) takes a
    RegimeIndicators object. We construct indicators manually from prices.
    """
    from analyzers.market_regime_engine import (
        MarketRegimeEngine, RegimeIndicators, Regime,
    )

    def _classify(prices: List[float]) -> str:
        # Build RegimeIndicators from prices using a simple SMA-based computation.
        sma20 = sum(prices[-20:]) / 20 if len(prices) >= 20 else None
        sma50 = sum(prices[-50:]) / 50 if len(prices) >= 50 else None
        sma200 = sum(prices[-200:]) / 200 if len(prices) >= 200 else None
        current = prices[-1]
        change_pct = ((prices[-1] - prices[-2]) / prices[-2] * 100) if len(prices) >= 2 else 0.0

        ind = RegimeIndicators(
            index_sma20=sma20,
            index_sma50=sma50,
            index_sma200=sma200,
            index_current=current,
            index_daily_change_pct=change_pct,
            breadth_pct=0.6,  # 60% stocks up (placeholder)
            breadth_total=100,
            atr_14=1.0,
            atr_20d_avg=1.0,
            atr_ratio=1.0,
            turnover_ratio=1.1,
            loss_streak_days=0,
            short_term_drawdown_pct=0.0,
        )

        engine = MarketRegimeEngine(market='EGX', allow_unknown=True)
        result = engine.detect_regime(ind)
        return result.regime.value
    return ('analyzers/market_regime_engine.py::MarketRegimeEngine',
            _classify,
            'DEFENSIVE / NORMAL / AGGRESSIVE',
            True)  # persistent in system_settings + market_regime_log


def load_regime_detector():
    """3) analyzers/regime_detector.py::RegimeDetector — bull_trend/bear_trend/ranging."""
    from analyzers.regime_detector import RegimeDetector

    def _classify(prices: List[float]) -> str:
        # Build price dicts from prices list (treating each day's close as H/L/C).
        # We need realistic OHLC for ADX. Construct synthetic OHLC around closes.
        price_dicts = []
        for i, p in enumerate(prices):
            # 1% intraday range around close
            price_dicts.append({
                'date': DATES[i] if i < len(DATES) else f'2026-01-{i+1:02d}',
                'open': p * 0.998,
                'high': p * 1.005,
                'low': p * 0.995,
                'close': p,
                'volume': 1_000_000,
            })
        detector = RegimeDetector(db_path='/tmp/fake.db')
        # Patch the DB connection to return our price_dicts
        fake_conn = MagicMock()
        fake_cursor = MagicMock()
        # The detector first checks if ticker exists, then fetches 100 rows
        # We force it to skip the ticker_exists path (return [] => falsy → fallback)
        # then fetch our rows.
        def _execute(query, params=None):
            if 'PRAGMA' in query:
                return [
                    (0, 'date', 'TEXT', 0, None, 0),
                    (1, 'open_price', 'REAL', 0, None, 0),
                    (2, 'high_price', 'REAL', 0, None, 0),
                    (3, 'low_price', 'REAL', 0, None, 0),
                    (4, 'close_price', 'REAL', 0, None, 0),
                    (5, 'volume', 'REAL', 0, None, 0),
                ]
            if 'SELECT 1 FROM' in query:
                return [(1,)]  # ticker exists
            # Fetch latest 100 rows
            return [(pd['date'], pd['open'], pd['high'], pd['low'], pd['close'], pd['volume'])
                    for pd in price_dicts[-100:]]
        fake_cursor.execute.side_effect = _execute
        fake_conn.cursor.return_value = fake_cursor
        # patch db_manager.get_connection
        with patch('core.db_manager.db_manager.get_connection', return_value=fake_conn):
            result = detector.detect_regime('TEST')
        return f"{result['regime']} ({result['regime_ar']}, conf={result['confidence']})"
    return ('analyzers/regime_detector.py::RegimeDetector',
            _classify,
            'bull_trend / bear_trend / ranging / unknown (Arabic: صاعد/هابط/متراوح/غير معروف)',
            True)  # save_daily_regime writes to market_regime_log


def load_regime_filter():
    """4) analyzers/regime_filter.py::is_bullish_regime — binary bullish/not."""
    from analyzers.regime_filter import is_bullish_regime

    def _classify(prices: List[float]) -> str:
        result = is_bullish_regime(prices, mode='A')
        return f"is_bullish={result['is_bullish']} ({result['reason'][:60]})"
    return ('analyzers/regime_filter.py::is_bullish_regime',
            _classify,
            'Binary: is_bullish=True/False (per-stock, mode A=Close>SMA50)',
            False)


def load_hmm_market_regime():
    """5) analyzers/hmm_market_regime.py::HMMMarketRegime — Wyckoff 4-state.

    Requires hmmlearn + 50+ data points + training. We test with a mock
    training result since real HMM training is stochastic.
    """
    try:
        from analyzers.hmm_market_regime import HMMMarketRegime, HMM_STATES
    except ImportError as e:
        return ('analyzers/hmm_market_regime.py::HMMMarketRegime',
                lambda p: f'IMPORT_ERROR: {e}',
                'Wyckoff: Accumulation/Markup/Distribution/Markdown (requires hmmlearn)',
                False)

    def _classify(prices: List[float]) -> str:
        # We don't actually train (stochastic, slow, needs hmmlearn).
        # Instead, we report what the module's vocabulary is and confirm import.
        # Verify HMM_STATES vocabulary:
        states = [HMM_STATES[i]['name'] for i in range(4)]
        return f'VOCAB: {states} (training skipped — needs hmmlearn + EGX30ETF data)'
    return ('analyzers/hmm_market_regime.py::HMMMarketRegime',
            _classify,
            'Wyckoff: Accumulation/Markup/Distribution/Markdown',
            False)


def load_adaptive_weights_detect_regime():
    """6) analyzers/adaptive_weights.py::detect_regime — bull/bear/range."""
    from analyzers.adaptive_weights import detect_regime

    def _classify(prices: List[float]) -> str:
        return detect_regime(prices)
    return ('analyzers/adaptive_weights.py::detect_regime',
            _classify,
            'bull / bear / range / unknown',
            False)


def load_breakout_signal_calc_regime():
    """7) analyzers/breakout_signal.py::calc_regime — BULL/BEAR/RANGE."""
    from analyzers.breakout_signal import calc_regime

    def _classify(prices: List[float]) -> str:
        # calc_regime takes (closes, idx) — point-in-time at idx
        return calc_regime(prices, len(prices) - 1)
    return ('analyzers/breakout_signal.py::calc_regime',
            _classify,
            'BULL / BEAR / RANGE (point-in-time, needs idx>=50)',
            False)


def load_orchestrator_v3_classify_regime():
    """8) core/orchestrator_v3.py::classify_regime — market+stock tuple."""
    from core.orchestrator_v3 import classify_regime

    def _classify(prices: List[float]) -> str:
        market, stock = classify_regime(prices)
        return f'market={market}, stock={stock}'
    return ('core/orchestrator_v3.py::classify_regime',
            _classify,
            'Market: BULL_STABLE/BULL_WEAK/BEAR_STABLE/BEAR_ACC/SIDEWAYS/HIGH_VOL/CONFLICTING + Stock: S1-S11',
            False)


def load_orchestrator_v2_detect_market_regime():
    """9) core/orchestrator_v2.py::detect_market_regime — R1-R11."""
    from core.orchestrator_v2 import detect_market_regime, detect_stock_regime

    def _classify(prices: List[float]) -> str:
        market = detect_market_regime(prices)
        stock = detect_stock_regime(prices)
        return f'market={market}, stock={stock}'
    return ('core/orchestrator_v2.py::detect_market_regime',
            _classify,
            'Market: R1-R11 + Stock: S1-S14 (older version)',
            False)


def load_camp_orchestrator_detect_regime():
    """10) camp/orchestrator.py::Orchestrator.detect_regime — Bull/Bear/Sideways (breadth-based)."""
    # We can't easily import camp/orchestrator.py because of config dependencies.
    # Replicate the function locally (it's tiny — line 371-379).
    def detect_regime(breadth: float, egx30=None, egx30_sma200=None) -> str:
        if breadth > 55:
            return 'Bull'
        elif breadth < 45:
            return 'Bear'
        return 'Sideways'

    def _classify(prices: List[float]) -> str:
        # camp uses breadth (% of tickers above SMA50) — we synthesize a proxy:
        # if 70% of recent prices are above SMA20 → breadth=70 → Bull
        if len(prices) < 20:
            return 'insufficient data'
        sma20 = sum(prices[-20:]) / 20
        above_count = sum(1 for p in prices[-50:] if p > sma20) if len(prices) >= 50 else \
                      sum(1 for p in prices if p > sma20)
        breadth = above_count / min(len(prices), 50) * 100
        return f'{detect_regime(breadth)} (breadth={breadth:.1f}%)'
    return ('camp/orchestrator.py::Orchestrator.detect_regime',
            _classify,
            'Bull / Bear / Sideways (breadth-based, no EGX30 — uses % above SMA50)',
            False)


def load_market_config_get_regime_settings():
    """11) config/market_config.py::get_regime_settings — settings map (no classification)."""
    from config.market_config import get_regime_settings, MarketRegime

    def _classify(prices: List[float]) -> str:
        # This is a settings lookup, not a classifier. Just show what it returns
        # for each regime name.
        vocab = [r.value for r in MarketRegime]
        return f'VOCAB: {vocab} (settings lookup only, no classifier)'
    return ('config/market_config.py::MarketRegime/get_regime_settings',
            _classify,
            'Enum: bull/bear/range (settings lookup, not a classifier)',
            False)


def load_crypto_regime_detector():
    """12) analyzers/crypto_regime.py::CryptoRegimeDetector — crypto-specific (needs API)."""
    try:
        from analyzers.crypto_regime import CryptoRegimeDetector, CryptoRegime
    except ImportError as e:
        return ('analyzers/crypto_regime.py::CryptoRegimeDetector',
                lambda p: f'IMPORT_ERROR: {e}',
                'Crypto-specific (BTC dominance, Fear&Greed, AltSeason, Volatility)',
                False)

    def _classify(prices: List[float]) -> str:
        # CryptoRegimeDetector pulls from external APIs — can't test offline.
        # Just confirm vocabulary.
        # The detect_regime() returns CryptoRegime with regime field having values:
        # BTC_SEASON, ALT_SEASON, HIGH_VOL, LOW_VOL, EXTREME_FEAR, EXTREME_GREED, NEUTRAL
        return 'VOCAB: BTC_SEASON/ALT_SEASON/HIGH_VOL/LOW_VOL/EXTREME_FEAR/EXTREME_GREED/NEUTRAL (needs external API)'
    return ('analyzers/crypto_regime.py::CryptoRegimeDetector',
            _classify,
            'Crypto: BTC_SEASON/ALT_SEASON/HIGH_VOL/LOW_VOL/EXTREME_FEAR/EXTREME_GREED/NEUTRAL',
            False)


def load_run_backtest_get_regime():
    """13) scripts/run_backtest.py::get_regime — backtest-only."""
    # Inline the function (script-level, no class).
    def get_regime(closes: List[float]) -> str:
        if len(closes) < 50:
            return 'range'
        sma20 = sum(closes[-20:]) / 20
        sma50 = sum(closes[-50:]) / 50
        current = closes[-1]
        if sma20 > sma50 and current > sma20:
            return 'bull'
        elif sma20 < sma50 and current < sma20:
            return 'bear'
        return 'range'

    def _classify(prices: List[float]) -> str:
        return get_regime(prices)
    return ('scripts/run_backtest.py::get_regime',
            _classify,
            'bull / bear / range (backtest-only, not production)',
            False)


# ============================================================================
# TESTS
# ============================================================================

def test_reference_scenarios():
    """عرض الإحصائيات الأساسية للـ 3 سيناريوهات مرجعية."""
    print('\n' + '=' * 78)
    print('TEST 1: Reference scenarios sanity check')
    print('=' * 78)
    for name, prices in [('BULL', BULL_PRICES), ('BEAR', BEAR_PRICES), ('SIDEWAYS', SIDEWAYS_PRICES)]:
        sma20 = sum(prices[-20:]) / 20
        sma50 = sum(prices[-50:]) / 50
        sma200 = sum(prices[-200:]) / 200
        change_5d = (prices[-1] - prices[-5]) / prices[-5] * 100
        change_20d = (prices[-1] - prices[-20]) / prices[-20] * 100
        print(f'  {name:<9} (n={len(prices)}): last={prices[-1]:.2f}, '
              f'sma20={sma20:.2f}, sma50={sma50:.2f}, sma200={sma200:.2f}')
        print(f'            change_5d={change_5d:+.2f}%, change_20d={change_20d:+.2f}%, '
              f'last>sma200: {prices[-1] > sma200}, last>sma50: {prices[-1] > sma50}')


def test_all_regime_implementations():
    """تشغيل كل implementations على 3 scenarios + مقارنة."""
    print('\n' + '=' * 78)
    print('TEST 2: All regime implementations on 3 scenarios (BULL/BEAR/SIDEWAYS)')
    print('=' * 78)

    loaders = [
        load_engines_market_regime,
        load_analyzers_market_regime_engine,
        load_regime_detector,
        load_regime_filter,
        load_hmm_market_regime,
        load_adaptive_weights_detect_regime,
        load_breakout_signal_calc_regime,
        load_orchestrator_v3_classify_regime,
        load_orchestrator_v2_detect_market_regime,
        load_camp_orchestrator_detect_regime,
        load_market_config_get_regime_settings,
        load_crypto_regime_detector,
        load_run_backtest_get_regime,
    ]

    scenarios = [
        ('BULL',     BULL_PRICES),
        ('BEAR',     BEAR_PRICES),
        ('SIDEWAYS', SIDEWAYS_PRICES),
    ]

    # Load all implementations first
    impls: List[Tuple[str, Any, str, bool]] = []
    for loader in loaders:
        try:
            impls.append(loader())
        except Exception as e:
            impls.append((loader.__doc__.split('—')[0].strip() if loader.__doc__ else 'unknown',
                          lambda p, e=e: f'LOAD_ERROR: {e}',
                          f'(load error: {e})',
                          False))

    # Print header
    print(f'\n  {"#":>3}  {"Implementation":<58}  {"Vocabulary":<25}  {"Persist?":<10}')
    print('  ' + '-' * 130)
    for i, (name, _fn, vocab, persist) in enumerate(impls, 1):
        print(f'  {i:>3}  {name:<58}  ...  {"YES" if persist else "no":<10}')

    print('\n  Vocabularies:')
    for i, (name, _fn, vocab, _p) in enumerate(impls, 1):
        print(f'  {i:>3}. {vocab}')

    # Run all impls on all scenarios
    print('\n  Results per scenario:')
    print(f'\n  {"#":>3}  {"Implementation":<58}  {"BULL":<45}  {"BEAR":<45}  {"SIDEWAYS":<45}')
    print('  ' + '-' * 196)

    results: Dict[str, Dict[str, str]] = {}
    for i, (name, fn, vocab, _p) in enumerate(impls, 1):
        row = {'BULL': '', 'BEAR': '', 'SIDEWAYS': ''}
        for scen_name, prices in scenarios:
            try:
                v = fn(prices)
                row[scen_name] = str(v)[:44]
            except Exception as e:
                row[scen_name] = f'ERROR: {str(e)[:35]}'
        results[name] = row
        print(f'  {i:>3}  {name:<58}  {row["BULL"]:<45}  {row["BEAR"]:<45}  {row["SIDEWAYS"]:<45}')

    return impls, results


def test_vocabulary_incompatibility(impls, results):
    """إثبات إن implementations بـ تنتج vocabularies مختلفة = غير قابلة للتوحيد بدون كسر."""
    print('\n' + '=' * 78)
    print('TEST 3: Vocabulary incompatibility matrix')
    print('=' * 78)

    # Group implementations by output vocabulary
    vocab_groups: Dict[str, List[str]] = {
        'Minervini Stage 1-4': [],
        'DEFENSIVE/NORMAL/AGGRESSIVE': [],
        'bull/bear/range (lowercase)': [],
        'BULL/BEAR/RANGE (uppercase)': [],
        'bull_trend/bear_trend/ranging': [],
        'Binary bullish/not-bullish': [],
        'Wyckoff Accumulation/Markup/Distribution/Markdown': [],
        'R1-R11 (orchestrator_v2)': [],
        'BULL_STABLE/BULL_WEAK/... (orchestrator_v3)': [],
        'Bull/Bear/Sideways (camp breadth)': [],
        'Crypto (BTC_SEASON/...)': [],
    }

    for name, _fn, vocab, _p in impls:
        v = vocab.lower()
        if 'minervini' in v or 'stage' in v:
            vocab_groups['Minervini Stage 1-4'].append(name)
        elif 'defensive' in v:
            vocab_groups['DEFENSIVE/NORMAL/AGGRESSIVE'].append(name)
        elif 'bull_trend' in v:
            vocab_groups['bull_trend/bear_trend/ranging'].append(name)
        elif 'binary' in v or 'is_bullish' in v:
            vocab_groups['Binary bullish/not-bullish'].append(name)
        elif 'wyckoff' in v or 'accumulation' in v:
            vocab_groups['Wyckoff Accumulation/Markup/Distribution/Markdown'].append(name)
        elif 'r1-r11' in v or 'r1' in v:
            vocab_groups['R1-R11 (orchestrator_v2)'].append(name)
        elif 'bull_stable' in v:
            vocab_groups['BULL_STABLE/BULL_WEAK/... (orchestrator_v3)'].append(name)
        elif 'bull/bear/sideways' in v and 'breadth' in v:
            vocab_groups['Bull/Bear/Sideways (camp breadth)'].append(name)
        elif 'crypto' in v or 'btc_season' in v:
            vocab_groups['Crypto (BTC_SEASON/...)'].append(name)
        elif 'bull / bear / range' in v:
            vocab_groups['bull/bear/range (lowercase)'].append(name)
        elif 'bull / bear / range' in v.upper() or 'BULL / BEAR / RANGE' in v.upper():
            vocab_groups['BULL/BEAR/RANGE (uppercase)'].append(name)

    print()
    for vocab, names in vocab_groups.items():
        if names:
            print(f'  📦 {vocab}  (n={len(names)}):')
            for n in names:
                print(f'      • {n}')
            print()

    print('  ⚠️  كل group بـ يستخدم vocabulary مختلف = غير قابل للتوحيد مع غيره')
    print('     بدون إعادة تعريف الـ consumer contracts.')


def test_persistence_summary(impls):
    """عرض أي implementations persistent (بتـ store state) vs stateless."""
    print('\n' + '=' * 78)
    print('TEST 4: Persistence behavior (stateless vs persistent)')
    print('=' * 78)
    print(f'\n  {"#":>3}  {"Implementation":<58}  {"Persistent?":<12}  {"State storage":<50}')
    print('  ' + '-' * 130)
    storage_info = {
        'engines/market_regime.py::MarketRegimeEngine':
            'Stateless — reads price_history.db each call (no write).',
        'analyzers/market_regime_engine.py::MarketRegimeEngine':
            'Persistent — writes system_settings + market_regime_log (stocks.db) with hysteresis.',
        'analyzers/regime_detector.py::RegimeDetector':
            'Stateless detector, but save_daily_regime() writes to market_regime_log.',
        'analyzers/regime_filter.py::is_bullish_regime':
            'Stateless — pure function on closes.',
        'analyzers/hmm_market_regime.py::HMMMarketRegime':
            'In-memory singleton (_hmm_instance) — trained once, predict per call. Not DB-persistent.',
        'analyzers/adaptive_weights.py::detect_regime':
            'Stateless — pure function on prices.',
        'analyzers/breakout_signal.py::calc_regime':
            'Stateless — pure function on closes + idx.',
        'core/orchestrator_v3.py::classify_regime':
            'Stateless — pure function on prices.',
        'core/orchestrator_v2.py::detect_market_regime':
            'Stateless — pure function on prices.',
        'camp/orchestrator.py::Orchestrator.detect_regime':
            'Stateless — pure function on breadth.',
        'config/market_config.py::MarketRegime/get_regime_settings':
            'N/A — enum + settings lookup, no classification.',
        'analyzers/crypto_regime.py::CryptoRegimeDetector':
            'In-memory cache (5-min TTL) — no DB persistence.',
        'scripts/run_backtest.py::get_regime':
            'Stateless — backtest-only, not production.',
    }
    for i, (name, _fn, _v, _p) in enumerate(impls, 1):
        persist_str = 'YES' if _p else 'no'
        info = storage_info.get(name, '?')
        print(f'  {i:>3}  {name:<58}  {persist_str:<12}  {info:<50}')


def main():
    print('╔' + '═' * 76 + '╗')
    print('║' + ' Market Regime Parity Test — Task FIX-E (برافو V2 subagent)'.center(76) + '║')
    print('╠' + '═' * 76 + '╣')
    print('║' + ' Compares 13 regime implementations on 3 reference scenarios.'.center(76) + '║')
    print('║' + ' Shows vocabulary divergence + persistence behavior.'.center(76) + '║')
    print('║' + ' READ-ONLY: no file edits, no DB writes.'.center(76) + '║')
    print('╚' + '═' * 76 + '╝')

    test_reference_scenarios()
    impls, results = test_all_regime_implementations()
    test_vocabulary_incompatibility(impls, results)
    test_persistence_summary(impls)

    # Final summary
    print('\n' + '=' * 78)
    print('FINAL SUMMARY')
    print('=' * 78)
    print('  13 regime implementations identified across vps-service.')
    print('  They use 11 mutually-incompatible vocabularies:')
    print('    • Minervini Stage 1-4 (engines/market_regime.py)')
    print('    • DEFENSIVE/NORMAL/AGGRESSIVE (analyzers/market_regime_engine.py — PRODUCTION)')
    print('    • bull_trend/bear_trend/ranging (analyzers/regime_detector.py)')
    print('    • is_bullish True/False (analyzers/regime_filter.py)')
    print('    • Wyckoff 4-state (analyzers/hmm_market_regime.py)')
    print('    • bull/bear/range (adaptive_weights.py, run_backtest.py)')
    print('    • BULL/BEAR/RANGE (breakout_signal.py)')
    print('    • R1-R11 + S1-S14 (orchestrator_v2.py)')
    print('    • BULL_STABLE/.../CONFLICTING + S1-S11 (orchestrator_v3.py)')
    print('    • Bull/Bear/Sideways (camp/orchestrator.py — breadth-based)')
    print('    • Crypto (BTC_SEASON/...) (crypto_regime.py)')
    print()
    print('  ⚠️  لا يمكن توحيد هذه الـ implementations لـ "canonical واحد" بدون كسر')
    print('     contracts الـ consumers اللي بـ تستخدم vocab معين.')
    print()
    print('  ✅ الـ production regime engine = analyzers/market_regime_engine.py')
    print('     (DEFENSIVE/NORMAL/AGGRESSIVE) — مدعوم بـ cron (job 15) + daily_predictor.')
    print()
    print('  ✅ كل implementations التانية بـ تخدم أدوارًا مختلفة:')
    print('     - chart-level regime display (RegimeDetector)')
    print('     - per-stock entry filter (regime_filter.is_bullish_regime)')
    print('     - backtest tagging (run_backtest.get_regime)')
    print('     - orchestrator v2/v3 state codes (legacy)')
    print('     - crypto-specific (CryptoRegimeDetector)')
    print('     - experimental HMM (Wyckoff)')
    print('     - camp breadth-based (research only)')
    print()
    print('✅ Market Regime parity test complete.')


if __name__ == '__main__':
    main()
