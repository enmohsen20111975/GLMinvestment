#!/usr/bin/env python3
"""
Day Trading Scanner
====================
ماسح يومي للفرص الاستثمارية

يستخدم AnalysisOrchestrator V2 لفحص جميع الأسهم
ويرجع أفضل الفرص اليومية

Features:
- Scan all EGX stocks for day trading opportunities
- Score based on pipeline configuration
- Calculate target prices (2%, 5%)
- Sort by score
- Run every 15 minutes via PM2 cron

Author: دليل الاستثمار - M2Y Developers
Version: 1.0.0
"""

import os
import sys
import json
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pathlib import Path
from dataclasses import dataclass, asdict

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from analysis_engine_v2 import get_orchestrator, AnalysisOrchestrator


# ============================================================================
# CONFIGURATION
# ============================================================================

SCAN_RESULTS_FILE = Path(__file__).parent.parent / 'data' / 'day_trading_opportunities.json'
DEFAULT_PIPELINE = "egx_aggressive"
MIN_SCORE = 6.0  # Minimum score to be considered an opportunity
MAX_RESULTS = 30  # Maximum number of results to return


# ============================================================================
# DATA LOADING
# ============================================================================

def get_stocks_data() -> List[Dict]:
    """
    Load stocks data from database or cache.
    This fetches the current data for all EGX stocks.
    """
    stocks = []
    
    # Try to load from data engine database
    try:
        import sqlite3
        db_path = Path(__file__).parent.parent.parent / 'db' / 'data_engine.db'
        if not db_path.exists():
            db_path = Path(__file__).parent.parent / 'data' / 'stocks_data.json'
        
        if db_path.suffix == '.db':
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Try to get stocks with technical data
            cursor.execute("""
                SELECT ticker, name, close, open, high, low, volume,
                       pe_ratio, pb_ratio, roe, eps, profit_margin,
                       debt_to_equity, dividend_yield,
                       rsi, macd, macd_signal_line,
                       sma_20, sma_50, sma_200,
                       bb_upper, bb_lower,
                       adx, stochastic_k, stochastic_d
                FROM stocks
                WHERE close IS NOT NULL AND close > 0
                ORDER BY volume DESC
            """)
            
            rows = cursor.fetchall()
            for row in rows:
                stock = {}
                for key in row.keys():
                    val = row[key]
                    if val is not None:
                        stock[key] = val
                if 'ticker' in stock:
                    stocks.append(stock)
            
            conn.close()
        else:
            # Load from JSON
            with open(str(db_path), 'r') as f:
                data = json.load(f)
                if isinstance(data, list):
                    stocks = data
                elif isinstance(data, dict):
                    stocks = data.get('stocks', data.get('data', []))
    
    except Exception as e:
        print(f"[DayTradingScanner] Error loading stocks data: {e}")
    
    return stocks


def get_crypto_data() -> List[Dict]:
    """Load crypto data for scanning."""
    cryptos = []
    try:
        import sqlite3
        db_path = Path(__file__).parent.parent.parent / 'db' / 'data_engine.db'
        if db_path.exists():
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT symbol as ticker, name, close, open, high, low, volume,
                       rsi, macd, macd_signal_line,
                       sma_20, sma_50, sma_200,
                       bb_upper, bb_lower,
                       adx, stochastic_k
                FROM crypto
                WHERE close IS NOT NULL AND close > 0
            """)
            
            rows = cursor.fetchall()
            for row in rows:
                crypto = {}
                for key in row.keys():
                    val = row[key]
                    if val is not None:
                        crypto[key] = val
                if 'ticker' in crypto:
                    cryptos.append(crypto)
            
            conn.close()
    except Exception as e:
        print(f"[DayTradingScanner] Error loading crypto data: {e}")
    
    return cryptos


# ============================================================================
# SCANNER
# ============================================================================

@dataclass
class TradingOpportunity:
    """A day trading opportunity."""
    ticker: str
    name: str
    signal: str
    score: float
    confidence: float
    price: float
    target_2pct: float
    target_5pct: float
    stop_loss: float
    risk_reward_ratio: float
    reasons: List[str]
    engine_results: List[Dict]
    pipeline: str
    scanned_at: str
    
    def to_dict(self) -> Dict:
        return asdict(self)


class DayTradingScanner:
    """
    يومي ماسح الفرص
    
    Usage:
        scanner = DayTradingScanner()
        opportunities = scanner.scan()
    """
    
    def __init__(self, pipeline_name: str = DEFAULT_PIPELINE):
        self.pipeline_name = pipeline_name
        # KILL-MAESTRO: Maestro معطل — V40.2 هو العقل الوحيد
        self.orchestrator = None  # get_orchestrator() — DISABLED
        self.last_scan_time = None
        self.cached_results = None
    
    def scan(self, market: str = "egx", pipeline_name: str = None, min_score: float = None) -> List[Dict]:
        """
        Scan for day trading opportunities.
        
        Args:
            market: "egx" or "crypto"
            pipeline_name: Override default pipeline
            min_score: Override minimum score threshold
            
        Returns:
            List of TradingOpportunity dicts
        """
        pipeline = pipeline_name or self.pipeline_name
        threshold = min_score or MIN_SCORE
        
        print(f"[DayTradingScanner] Scanning {market} with pipeline '{pipeline}' (min_score={threshold})")
        start_time = time.time()
        
        # Load data
        if market == "crypto":
            stocks_data = get_crypto_data()
        else:
            stocks_data = get_stocks_data()
        
        print(f"[DayTradingScanner] Loaded {len(stocks_data)} stocks for {market}")
        
        # Run analysis on each stock
        opportunities = []
        
        for stock in stocks_data:
            ticker = stock.get('ticker', stock.get('symbol', ''))
            if not ticker:
                continue
            
            price = stock.get('close', stock.get('price', 0))
            if not price or price <= 0:
                continue
            
            try:
                # KILL-MAESTRO: orchestrator = None — skip
                if not self.orchestrator:
                    continue
                result = self.orchestrator.analyze(ticker, pipeline, stock)
                
                if result.get('score', 0) >= threshold:
                    # Calculate targets
                    target_2pct = round(price * 1.02, 2)
                    target_5pct = round(price * 1.05, 2)
                    
                    # Calculate stop loss (2% below entry)
                    stop_loss = round(price * 0.98, 2)
                    
                    # Risk/Reward ratio (target 2% / risk 2% = 1:1 minimum)
                    risk = price - stop_loss
                    reward = target_5pct - price
                    rr_ratio = round(reward / risk, 2) if risk > 0 else 0
                    
                    # Collect all reasons
                    all_reasons = []
                    for eng in result.get('engines', []):
                        if eng.get('enabled') and eng.get('reasons'):
                            all_reasons.extend(eng['reasons'])
                    
                    opp = TradingOpportunity(
                        ticker=ticker,
                        name=stock.get('name', stock.get('name_en', ticker)),
                        signal=result['signal'],
                        score=result['score'],
                        confidence=result['confidence'],
                        price=round(price, 2),
                        target_2pct=target_2pct,
                        target_5pct=target_5pct,
                        stop_loss=stop_loss,
                        risk_reward_ratio=rr_ratio,
                        reasons=all_reasons[:10],  # Top 10 reasons
                        engine_results=result.get('engines', []),
                        pipeline=pipeline,
                        scanned_at=datetime.now().isoformat(),
                    )
                    opportunities.append(opp.to_dict())
                    
            except Exception as e:
                print(f"[DayTradingScanner] Error analyzing {ticker}: {e}")
                continue
        
        # Sort by score (highest first)
        opportunities.sort(key=lambda x: x['score'], reverse=True)
        
        # Limit results
        opportunities = opportunities[:MAX_RESULTS]
        
        elapsed = time.time() - start_time
        print(f"[DayTradingScanner] Found {len(opportunities)} opportunities in {elapsed:.1f}s")
        
        # Cache results
        self.last_scan_time = datetime.now().isoformat()
        self.cached_results = opportunities
        self._save_results(opportunities, market)
        
        return opportunities
    
    def _save_results(self, results: List[Dict], market: str):
        """Save scan results to file."""
        try:
            SCAN_RESULTS_FILE.parent.mkdir(parents=True, exist_ok=True)
            
            output = {
                "market": market,
                "pipeline": self.pipeline_name,
                "scan_time": self.last_scan_time,
                "count": len(results),
                "opportunities": results,
            }
            
            with open(str(SCAN_RESULTS_FILE), 'w') as f:
                json.dump(output, f, indent=2, ensure_ascii=False)
            
        except Exception as e:
            print(f"[DayTradingScanner] Error saving results: {e}")
    
    def get_cached_results(self) -> Optional[Dict]:
        """Get cached scan results."""
        if self.cached_results is not None:
            return {
                "market": "egx",
                "pipeline": self.pipeline_name,
                "scan_time": self.last_scan_time,
                "count": len(self.cached_results),
                "opportunities": self.cached_results,
            }
        
        # Try loading from file
        try:
            if SCAN_RESULTS_FILE.exists():
                with open(str(SCAN_RESULTS_FILE), 'r') as f:
                    return json.load(f)
        except:
            pass
        
        return None


# ============================================================================
# CLI ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Day Trading Scanner")
    parser.add_argument("--market", default="egx", choices=["egx", "crypto"], help="Market to scan")
    parser.add_argument("--pipeline", default="egx_aggressive", help="Pipeline to use")
    parser.add_argument("--min-score", type=float, default=6.0, help="Minimum score threshold")
    
    args = parser.parse_args()
    
    scanner = DayTradingScanner(pipeline_name=args.pipeline)
    results = scanner.scan(market=args.market, min_score=args.min_score)
    
    print(f"\n{'='*60}")
    print(f"Day Trading Opportunities ({args.market.upper()})")
    print(f"Pipeline: {args.pipeline} | Min Score: {args.min_score}")
    print(f"{'='*60}")
    
    for i, opp in enumerate(results, 1):
        print(f"\n{i}. {opp['ticker']} ({opp['name']})")
        print(f"   Signal: {opp['signal']} | Score: {opp['score']}/10 | Confidence: {opp['confidence']}%")
        print(f"   Price: {opp['price']} | Target 2%: {opp['target_2pct']} | Target 5%: {opp['target_5pct']}")
        print(f"   Stop Loss: {opp['stop_loss']} | R:R = {opp['risk_reward_ratio']}")
        if opp['reasons']:
            print(f"   Reasons: {', '.join(opp['reasons'][:3])}")
    
    print(f"\nTotal: {len(results)} opportunities found")
