#!/usr/bin/env python3
"""
Live Signal Recorder
====================
يسجل كل الإشارات مع timestamp علشان نحسب النتيجة بعدين

Usage:
    python live_signals/recorder.py --crypto
    python live_signals/recorder.py --egx
    python live_signals/recorder.py --all
"""

import sys
import os
import json
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory
sys.path.insert(0, str(Path(__file__).parent.parent))

# ============================================================================
# CONFIGURATION
# ============================================================================

SIGNALS_DIR = Path(__file__).parent
CRYPTO_SIGNALS_FILE = SIGNALS_DIR / "crypto_signals.json"
EGX_SIGNALS_FILE = SIGNALS_DIR / "egx_signals.json"

# Coins to track
CRYPTO_COINS = ["bitcoin", "ethereum", "solana", "binancecoin", "cardano"]

# ============================================================================
# CRYPTO RECORDER
# ============================================================================

def record_crypto_signals():
    """تسجيل إشارات الكريبتو"""
    # MAESTRO-KILL (2026-10-12): crypto_maestro archived to archive/maestro-dead-code-20261012/
    # Per Rule 35 (ENGINE-UNIFY) + owner directive. This function is now a no-op.
    # Crypto predictions are handled by V40.2 CRYPTO path (currently disabled
    # per Rule 35 — see daily_predictor.py L3906 RULE35-DISABLED).
    print("=" * 60)
    print("⚠️  CRYPTO SIGNALS RECORDER — DISABLED (MAESTRO-KILL 2026-10-12)")
    print("=" * 60)
    print("CryptoMaestroOrchestrator archived. V40.2 is the canonical writer.")
    return
    
    # Get market regime
    regime = maestro.regime_detector.detect_regime()
    print(f"\n📊 Market Regime: {regime.regime}")
    print(f"📊 Fear & Greed: {regime.fear_greed_index}")
    print(f"📊 BTC Dominance: {regime.btc_dominance:.1f}%")
    
    # Load existing signals
    signals = []
    if CRYPTO_SIGNALS_FILE.exists():
        with open(CRYPTO_SIGNALS_FILE, 'r') as f:
            signals = json.load(f)
    
    # Record new signals
    new_signals = []
    for coin in CRYPTO_COINS:
        try:
            result = maestro.analyze(coin)
            if result:
                signal_data = {
                    "id": f"CRYPTO_{coin}_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                    "timestamp": datetime.now().isoformat(),
                    "coin_id": result.coin_id,
                    "symbol": result.symbol,
                    "name": result.name,
                    "current_price": result.current_price,
                    "signal": result.signal,
                    "signal_ar": result.signal_ar,
                    "maestro_score": result.maestro_score,
                    "entry_price": result.entry_price,
                    "stop_loss": result.stop_loss,
                    "target": result.target,
                    "risk_reward": result.risk_reward,
                    "position_size_pct": result.position_size_pct,
                    "market_regime": result.market_regime,
                    "fear_greed": result.fear_greed,
                    "btc_dominance": result.btc_dominance,
                    "reasons": result.reasons[:3],
                    "outcome": None,  # Will be filled later
                    "outcome_price": None,
                    "outcome_timestamp": None,
                    "outcome_pct": None,
                    "outcome_success": None
                }
                new_signals.append(signal_data)
                
                print(f"\n💰 {result.name} (${result.current_price:,.2f})")
                print(f"   Signal: {result.signal_ar} (Score: {result.maestro_score})")
                print(f"   Entry: ${result.entry_price:,.2f} | Target: ${result.target:,.2f} | SL: ${result.stop_loss:,.2f}")
                
        except Exception as e:
            print(f"❌ Error analyzing {coin}: {e}")
    
    # Save signals
    signals.extend(new_signals)
    with open(CRYPTO_SIGNALS_FILE, 'w') as f:
        json.dump(signals, f, indent=2)
    
    print(f"\n✅ Recorded {len(new_signals)} new signals")
    print(f"📁 Saved to: {CRYPTO_SIGNALS_FILE}")
    
    return new_signals


# ============================================================================
# EGX RECORDER
# ============================================================================

def record_egx_signals():
    """تسجيل إشارات EGX"""
    # MAESTRO-KILL (2026-10-12): maestro_orchestrator archived to archive/maestro-dead-code-20261012/
    # Per Rule 35 (ENGINE-UNIFY) + owner directive. This function is now a no-op.
    # EGX predictions are handled by V40.2 (daily_predictor.py) — the canonical writer.
    from core.database import DatabaseManager
    
    print("=" * 60)
    print("⚠️  EGX SIGNALS RECORDER — DISABLED (MAESTRO-KILL 2026-10-12)")
    print("=" * 60)
    print("MaestroOrchestrator archived. V40.2 (daily_predictor.py) is the canonical writer.")
    return
    print("=" * 60)
    
    db = DatabaseManager()
    maestro = MaestroOrchestrator()
    
    # Get active stocks
    stocks_query = """
        SELECT s.ticker, s.name, sph.close_price 
        FROM stocks s
        JOIN stock_price_history sph ON s.id = sph.stock_id
        WHERE s.is_active = 1
        ORDER BY sph.date DESC
        LIMIT 50
    """
    
    # Get latest prices
    cursor = db.conn.cursor()
    cursor.execute("""
        SELECT DISTINCT s.ticker, s.name, sph.close_price, sph.date
        FROM stocks s
        JOIN stock_price_history sph ON s.id = sph.stock_id
        WHERE sph.date = (SELECT MAX(date) FROM stock_price_history)
        LIMIT 30
    """)
    stocks = cursor.fetchall()
    
    print(f"\n📊 Analyzing {len(stocks)} stocks...")
    
    # Load existing signals
    signals = []
    if EGX_SIGNALS_FILE.exists():
        with open(EGX_SIGNALS_FILE, 'r') as f:
            signals = json.load(f)
    
    new_signals = []
    for ticker, name, price, date in stocks:
        try:
            # Simple signal generation based on price
            # In real system, this would use Maestro
            signal_data = {
                "id": f"EGX_{ticker}_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                "timestamp": datetime.now().isoformat(),
                "ticker": ticker,
                "name": name,
                "current_price": price,
                "signal": "HOLD",  # Placeholder - would use Maestro
                "signal_ar": "احتفاظ",
                "maestro_score": 50,
                "entry_price": price * 0.99,
                "stop_loss": price * 0.92,
                "target": price * 1.08,
                "risk_reward": 1.5,
                "date": date,
                "outcome": None,
                "outcome_price": None,
                "outcome_timestamp": None,
                "outcome_pct": None,
                "outcome_success": None
            }
            new_signals.append(signal_data)
            
        except Exception as e:
            print(f"❌ Error analyzing {ticker}: {e}")
    
    # Save signals
    signals.extend(new_signals)
    with open(EGX_SIGNALS_FILE, 'w') as f:
        json.dump(signals, f, indent=2)
    
    print(f"\n✅ Recorded {len(new_signals)} new signals")
    print(f"📁 Saved to: {EGX_SIGNALS_FILE}")
    
    return new_signals


# ============================================================================
# OUTCOME CHECKER
# ============================================================================

def check_crypto_outcomes():
    """فحص نتائج إشارات الكريبتو"""
    from analyzers.crypto_analyzer import CryptoAnalyzer
    
    print("=" * 60)
    print("📊 CHECKING CRYPTO OUTCOMES")
    print("=" * 60)
    
    if not CRYPTO_SIGNALS_FILE.exists():
        print("❌ No signals file found")
        return
    
    with open(CRYPTO_SIGNALS_FILE, 'r') as f:
        signals = json.load(f)
    
    analyzer = CryptoAnalyzer()
    updated = 0
    
    for signal in signals:
        if signal.get("outcome") is None:
            # Get current price
            try:
                cryptos = analyzer.fetcher.get_top_cryptos(50)
                coin = next((c for c in cryptos if c.coin_id == signal["coin_id"]), None)
                
                if coin:
                    current_price = coin.current_price
                    entry = signal["entry_price"]
                    pct_change = ((current_price - entry) / entry) * 100
                    
                    signal["outcome_price"] = current_price
                    signal["outcome_timestamp"] = datetime.now().isoformat()
                    signal["outcome_pct"] = round(pct_change, 2)
                    
                    # Determine success
                    if signal["signal"] in ["BUY", "STRONG_BUY"]:
                        signal["outcome_success"] = pct_change > 0
                        if pct_change > 0:
                            signal["outcome"] = "WIN"
                        else:
                            signal["outcome"] = "LOSS"
                    else:
                        signal["outcome_success"] = pct_change < 0
                        if pct_change < 0:
                            signal["outcome"] = "WIN"
                        else:
                            signal["outcome"] = "LOSS"
                    
                    updated += 1
                    print(f"💰 {signal['symbol']}: {signal['outcome']} ({pct_change:+.2f}%)")
                    
            except Exception as e:
                print(f"❌ Error checking {signal['coin_id']}: {e}")
    
    # Save updated signals
    with open(CRYPTO_SIGNALS_FILE, 'w') as f:
        json.dump(signals, f, indent=2)
    
    print(f"\n✅ Updated {updated} outcomes")


# ============================================================================
# STATS
# ============================================================================

def get_stats():
    """إحصائيات الإشارات"""
    print("=" * 60)
    print("📊 SIGNAL STATISTICS")
    print("=" * 60)
    
    # Crypto stats
    if CRYPTO_SIGNALS_FILE.exists():
        with open(CRYPTO_SIGNALS_FILE, 'r') as f:
            crypto_signals = json.load(f)
        
        total = len(crypto_signals)
        with_outcome = len([s for s in crypto_signals if s.get("outcome")])
        wins = len([s for s in crypto_signals if s.get("outcome") == "WIN"])
        losses = len([s for s in crypto_signals if s.get("outcome") == "LOSS"])
        
        print(f"\n🚀 CRYPTO:")
        print(f"   Total signals: {total}")
        print(f"   With outcome: {with_outcome}")
        if with_outcome > 0:
            print(f"   Wins: {wins} | Losses: {losses}")
            print(f"   Win Rate: {wins/with_outcome*100:.1f}%")
    
    # EGX stats
    if EGX_SIGNALS_FILE.exists():
        with open(EGX_SIGNALS_FILE, 'r') as f:
            egx_signals = json.load(f)
        
        total = len(egx_signals)
        with_outcome = len([s for s in egx_signals if s.get("outcome")])
        wins = len([s for s in egx_signals if s.get("outcome") == "WIN"])
        losses = len([s for s in egx_signals if s.get("outcome") == "LOSS"])
        
        print(f"\n🇪🇬 EGX:")
        print(f"   Total signals: {total}")
        print(f"   With outcome: {with_outcome}")
        if with_outcome > 0:
            print(f"   Wins: {wins} | Losses: {losses}")
            print(f"   Win Rate: {wins/with_outcome*100:.1f}%")


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Live Signal Recorder")
    parser.add_argument("--crypto", action="store_true", help="Record crypto signals")
    parser.add_argument("--egx", action="store_true", help="Record EGX signals")
    parser.add_argument("--all", action="store_true", help="Record all signals")
    parser.add_argument("--check", action="store_true", help="Check outcomes")
    parser.add_argument("--stats", action="store_true", help="Show statistics")
    
    args = parser.parse_args()
    
    if args.crypto or args.all:
        record_crypto_signals()
    
    if args.egx or args.all:
        record_egx_signals()
    
    if args.check:
        check_crypto_outcomes()
    
    if args.stats:
        get_stats()
    
    if not any([args.crypto, args.egx, args.all, args.check, args.stats]):
        parser.print_help()
