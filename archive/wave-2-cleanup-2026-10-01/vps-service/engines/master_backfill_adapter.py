#!/usr/bin/env python3
"""
MasterBackfillAdapter — الجسر بين historical_prediction_generator والـ MasterAnalyzer
=================================================================================
(P29-MASTER-BACKFILL)

الـ historical_prediction_generator.py كان بيستخدم SmartConfluenceEngine (محرك قديم)
عشان يولّد التوقعات التاريخية. ده خلّى نتايج الـ Backfill مش بتأكسل على الـ V20
Fusion والـ Dip Buying الجديد.

الـ Adapter ده بيوفرّ نفس الـ interface اللي SmartConfluenceEngine بيوفره:
  - analyze(symbol, target_date, market_hint) → dict
  - get_historical_prices(symbol, market, up_to_date, days) → list[dict]
  - get_available_dates(market) → list[str]
  - get_stocks_at_date(date, market) → list[str]

بس تحت الـ hood بيستخدم الـ MasterAnalyzer الجديد (مع V20 Fusion + P27/P28 Dip Buying).

ده بيخلي التوقعات التاريخية تعكس العقل الحقيقي بتاع المنصة.
"""

import os
import sys
import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Paths ──
PROJECT_ROOT = Path(__file__).parent.parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'

# Ensure analyzers importable
sys.path.insert(0, str(VPS_SERVICE))


# ── Lazy-loaded MasterAnalyzer (takes ~3s to init) ──
_master_analyzer = None


def _get_master_analyzer():
    """Lazy singleton — MasterAnalyzer heavy to init (~3s)."""
    global _master_analyzer
    if _master_analyzer is None:
        from analyzers.master_analyzer import MasterAnalyzer
        _master_analyzer = MasterAnalyzer(str(STOCKS_DB))
        logger.info("[MasterBackfillAdapter] MasterAnalyzer initialized (V20 Fusion + P28 Dip Buying)")
    return _master_analyzer


# ═══════════════════════════════════════════════════════════════════════════
# Data-access methods (replace SmartConfluenceEngine's data layer)
# ═══════════════════════════════════════════════════════════════════════════

def _parse_volume(vol):
    """Parse volume ('1.2M', '3.4K', '12345') to float."""
    if not vol:
        return 0.0
    s = str(vol).strip().replace(',', '').replace('\u202f', '').replace(' ', '')
    if not s:
        return 0.0
    try:
        mult = 1.0
        if s[-1] in ('B', 'b'):
            mult, s = 1e9, s[:-1]
        elif s[-1] in ('M', 'm'):
            mult, s = 1e6, s[:-1]
        elif s[-1] in ('K', 'k'):
            mult, s = 1e3, s[:-1]
        return float(s) * mult
    except (ValueError, TypeError):
        return 0.0


def _stocks_db_conn():
    conn = sqlite3.connect(str(STOCKS_DB), timeout=15.0)
    conn.row_factory = sqlite3.Row
    return conn


# ── Market name mapping (Arabic → code) ──
_MARKET_AR_TO_CODE = {
    'مصر': 'EGX',
    'السعودية': 'TADAWUL',
    'الكويت': 'KSE',
    'قطر': 'QSE',
    'العملات الرقمية': 'CRYPTO',
}


class MasterBackfillAdapter:
    """
    Adapter wrapping MasterAnalyzer to provide the same interface as
    SmartConfluenceEngine, so historical_prediction_generator.py can use
    the NEW V20 Fusion + Dip Buying engine without code changes.
    """

    def __init__(self):
        self._market_hint_cache: Dict[str, str] = {}

    # ───────────────────────────────────────────────────────────────────────
    # Data access (mirror SmartConfluenceEngine interface)
    # ───────────────────────────────────────────────────────────────────────

    def get_historical_prices(self, symbol: str, market: str,
                              up_to_date: str, days: int = 60) -> List[Dict]:
        """Load price history up to up_to_date (inclusive), most recent `days`."""
        try:
            conn = _stocks_db_conn()
            rows = conn.execute('''
                SELECT price_date, open_price, high_price, low_price, close_price, volume
                FROM stock_daily_prices
                WHERE ticker = ? AND price_date <= ?
                ORDER BY price_date DESC
                LIMIT ?
            ''', (symbol, up_to_date, days)).fetchall()
            conn.close()
            # Return in chronological order (oldest first) — matches SmartConfluenceEngine
            prices = []
            for r in reversed(rows):
                prices.append({
                    'date': r['price_date'],
                    'open': float(r['open_price'] or 0),
                    'high': float(r['high_price'] or 0),
                    'low': float(r['low_price'] or 0),
                    'close': float(r['close_price'] or 0),
                    'volume': _parse_volume(r['volume']),
                })
            return prices
        except Exception as e:
            logger.debug(f"[MasterBackfillAdapter] get_historical_prices({symbol}): {e}")
            return []

    def get_available_dates(self, market: str) -> List[str]:
        """Get distinct trading dates available in stock_daily_prices."""
        try:
            conn = _stocks_db_conn()
            market_code = _MARKET_AR_TO_CODE.get(market, market)
            # stock_daily_prices has all markets; filter by ticker pattern if needed
            # EGX tickers are alphabetic, TADAWUL numeric, etc.
            if market_code == 'TADAWUL':
                rows = conn.execute('''
                    SELECT DISTINCT price_date FROM stock_daily_prices
                    WHERE ticker GLOB '[0-9]*'
                    ORDER BY price_date ASC
                ''').fetchall()
            else:
                rows = conn.execute('''
                    SELECT DISTINCT price_date FROM stock_daily_prices
                    WHERE ticker GLOB '[A-Z]*'
                    ORDER BY price_date ASC
                ''').fetchall()
            conn.close()
            return [r['price_date'] for r in rows]
        except Exception as e:
            logger.debug(f"[MasterBackfillAdapter] get_available_dates({market}): {e}")
            return []

    def get_stocks_at_date(self, date: str, market: str) -> List[str]:
        """Get list of tickers that have price data on the given date."""
        try:
            conn = _stocks_db_conn()
            market_code = _MARKET_AR_TO_CODE.get(market, market)
            if market_code == 'TADAWUL':
                rows = conn.execute('''
                    SELECT DISTINCT ticker FROM stock_daily_prices
                    WHERE price_date = ? AND ticker GLOB '[0-9]*'
                ''', (date,)).fetchall()
            else:
                rows = conn.execute('''
                    SELECT DISTINCT ticker FROM stock_daily_prices
                    WHERE price_date = ? AND ticker GLOB '[A-Z]*'
                ''', (date,)).fetchall()
            conn.close()
            return [r['ticker'] for r in rows]
        except Exception as e:
            logger.debug(f"[MasterBackfillAdapter] get_stocks_at_date({date}): {e}")
            return []

    # ───────────────────────────────────────────────────────────────────────
    # Analysis (the core: delegates to MasterAnalyzer)
    # ───────────────────────────────────────────────────────────────────────

    def analyze(self, symbol: str, target_date: str = None,
                market_hint: str = None) -> Optional[Dict]:
        """
        Run MasterAnalyzer on data UP TO target_date (blind — no future leakage).

        Returns a dict matching the SmartConfluenceEngine output shape so the
        existing historical_prediction_generator._save_prediction() works unchanged:
          signal, confidence, entry_price, target_price, stop_loss,
          technical_score, fundamental_score, volume_seasonal_score,
          confluence_score, rsi, macd_signal, pe_ratio, roe,
          technical_rating, phase_scores, name, market
        """
        try:
            # 1. Load price history up to target_date (blind)
            history = self.get_historical_prices(
                symbol, market_hint or 'EGX', target_date, days=200
            )
            if not history or len(history) < 5:
                return None

            # 2. Run MasterAnalyzer with the blind history
            ma = _get_master_analyzer()
            analysis = ma.analyze(symbol, history=history)

            # 3. Convert MasterAnalysis dataclass → dict (SmartConfluenceEngine shape)
            signal = getattr(analysis, 'signal', 'HOLD')
            master_score = float(getattr(analysis, 'master_score', 0) or 0)
            confidence = float(getattr(analysis, 'confidence', 0) or 0)
            technical_score = float(getattr(analysis, 'technical_score', 0) or 0)
            fundamental_score = float(getattr(analysis, 'fundamental_score', 0) or 0)

            # Risk profile (V20 outputs entry, stop_loss_price, target_price, target_price_2)
            risk = getattr(analysis, 'risk_profile', {}) or {}
            entry_price = float(risk.get('entry_price') or history[-1]['close'] or 0)
            target_price = float(risk.get('target_price') or 0)
            stop_loss = float(risk.get('stop_loss_price') or 0)

            # Fusion metrics (V20 score)
            fusion = getattr(analysis, 'fusion_metrics', {}) or {}
            fusion_score = float(fusion.get('score', 0) or 0)

            # SMC score
            smc_score = float(getattr(analysis, 'smc_score', 0) or 0)

            # Dip buying (P27/P28)
            dip_qualified = bool(risk.get('dip_buy_qualified', False))
            dip_reason = str(risk.get('dip_buy_reason', '') or '')

            # Build the dict matching SmartConfluenceEngine output shape
            result = {
                'symbol': symbol,
                'name': symbol,  # filled by caller from stocks table
                'market': market_hint or 'EGX',
                'signal': signal,
                'confidence': round(confidence),
                'entry_price': round(entry_price, 4),
                'target_price': round(target_price, 4) if target_price > 0 else 0,
                'stop_loss': round(stop_loss, 4) if stop_loss > 0 else 0,
                'technical_score': round(technical_score),
                'fundamental_score': round(fundamental_score),
                'volume_seasonal_score': 50,  # not computed by MasterAnalyzer
                'confluence_score': round(fusion_score),  # V20 fusion score replaces confluence
                'rsi': float(getattr(analysis, 'rsi', 50) or 50),
                'macd_signal': str(getattr(analysis, 'macd_signal', 'NEUTRAL') or 'NEUTRAL'),
                'pe_ratio': float(getattr(analysis, 'pe_ratio', 0) or 0),
                'roe': float(getattr(analysis, 'roe', 0) or 0),
                'technical_rating': str(getattr(analysis, 'technical_rating', '') or ''),
                'phase_scores': {
                    'fusion_score': round(fusion_score, 2),
                    'smc_score': round(smc_score, 2),
                    'dip_buy_qualified': dip_qualified,
                    'dip_buy_reason': dip_reason,
                    'master_score': round(master_score, 2),
                    'v20_ready': bool(fusion.get('ready', False)),
                },
            }

            # Log V20 + Dip info for traceability
            if dip_qualified:
                logger.info(
                    f"[MasterBackfillAdapter] {symbol} @ {target_date}: DIP-BUY qualified "
                    f"(score={master_score:.0f}, fusion={fusion_score:.0f})"
                )

            return result

        except Exception as e:
            logger.error(f"[MasterBackfillAdapter] analyze({symbol}, {target_date}): {e}")
            return None


# ═══════════════════════════════════════════════════════════════════════════
# Factory (mirrors SmartConfluenceEngine.get_engine pattern)
# ═══════════════════════════════════════════════════════════════════════════

_adapter_instance = None


def get_engine():
    """Singleton factory — mirrors SmartConfluenceEngine.get_engine()."""
    global _adapter_instance
    if _adapter_instance is None:
        _adapter_instance = MasterBackfillAdapter()
        logger.info("[MasterBackfillAdapter] Adapter ready — using MasterAnalyzer (V20 Fusion + P28 Dip Buying)")
    return _adapter_instance


# Market map (for compatibility — historical_prediction_generator doesn't use it directly
# but some callers might)
MARKET_MAP = _MARKET_AR_TO_CODE
NON_STOCK_MARKETS = ['العملات الرقمية']


if __name__ == '__main__':
    # Quick smoke test
    logging.basicConfig(level=logging.INFO)
    adapter = get_engine()
    print("✓ MasterBackfillAdapter ready")
    print(f"  Stocks DB: {STOCKS_DB}")
    print(f"  Engine: MasterAnalyzer (V20 Fusion + P28 Dip Buying)")
    # Try a sample analyze
    result = adapter.analyze('COMI', '2026-07-15', 'EGX')
    if result:
        print(f"\n  Sample: COMI @ 2026-07-15 → signal={result['signal']}, score={result['confluence_score']}")
    else:
        print("\n  Sample: COMI → no data (expected in sandbox)")
