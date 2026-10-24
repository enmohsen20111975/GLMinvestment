import sys
import os

# Apply SQLite WAL and timeout patches globally to prevent DB locks
import sqlite3
_original_connect = sqlite3.connect
def _patched_connect(*args, **kwargs):
    if len(args) > 1:
        args = list(args)
        args[1] = max(args[1], 30.0)
        args = tuple(args)
    else:
        if 'timeout' not in kwargs:
            kwargs['timeout'] = 30.0
        else:
            kwargs['timeout'] = max(kwargs['timeout'], 30.0)
            
    conn = _original_connect(*args, **kwargs)
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=30000')
    except Exception:
        pass
    return conn
sqlite3.connect = _patched_connect

from analyzers.master_analyzer import MasterAnalyzer

def main():
    import sys
    print("Initializing sub-components of MasterAnalyzer step-by-step...")
    sys.stdout.flush()
    
    from config import DATABASE_PATH
    db_path = DATABASE_PATH
    print(f"DB Path: {db_path}")
    sys.stdout.flush()
    
    from analyzers.liquidity_filter import LiquidityFilter
    lf = LiquidityFilter(db_path)
    print("1. LiquidityFilter initialized")
    sys.stdout.flush()
    
    from analyzers.session_timing import SessionTimingAnalyzer
    sta = SessionTimingAnalyzer()
    print("2. SessionTimingAnalyzer initialized")
    sys.stdout.flush()
    
    from analyzers.fundamental_enhanced import EnhancedFundamentalAnalyzer
    efa = EnhancedFundamentalAnalyzer(db_path)
    print("3. EnhancedFundamentalAnalyzer initialized")
    sys.stdout.flush()
    
    from analyzers.ai_pattern_analyzer import AIPatternAnalyzer
    aip = AIPatternAnalyzer(db_path)
    print("4. AIPatternAnalyzer initialized")
    sys.stdout.flush()
    
    from analyzers.sentiment_analyzer import SentimentAnalyzer
    sa = SentimentAnalyzer(db_path)
    print("5. SentimentAnalyzer initialized")
    sys.stdout.flush()
    
    from analyzers.prediction_optimizer import PredictionOptimizer
    po = PredictionOptimizer()
    print("6. PredictionOptimizer initialized")
    sys.stdout.flush()
    
    from analyzers.regime_detector import RegimeDetector
    rd = RegimeDetector(db_path)
    print("7. RegimeDetector initialized")
    sys.stdout.flush()
    
    print("8. Detecting market regime...")
    sys.stdout.flush()
    mri = rd.detect_market_regime()
    print(f"   Market regime: {mri.get('regime')}")
    sys.stdout.flush()
    
    from analyzers.sector_relative import SectorRelativeAnalyzer
    sra = SectorRelativeAnalyzer(db_path)
    print("9. SectorRelativeAnalyzer initialized")
    sys.stdout.flush()
    
    print("10. Initializing full MasterAnalyzer...")
    sys.stdout.flush()
    analyzer = MasterAnalyzer()
    print("Full MasterAnalyzer initialized successfully!")
    sys.stdout.flush()
    
    tickers = analyzer._get_all_tickers()
    print(f"Total active tickers: {len(tickers)}")
    sys.stdout.flush()
    
    if not tickers:
        print("No tickers found! Exiting.")
        return
        
    for ticker in tickers[:5]:
        print(f"\nAnalyzing {ticker}...")
        sys.stdout.flush()
        try:
            res = analyzer.analyze(ticker)
            print(f"Result for {ticker}:")
            print(f"  Signal: {res.signal}")
            print(f"  Score: {res.master_score}")
            if res.risk_profile:
                print(f"  Target: {res.risk_profile.get('target_price')} (Method: {res.risk_profile.get('target_method')})")
                print(f"  Stop Loss: {res.risk_profile.get('stop_loss_price')} (Method: {res.risk_profile.get('stop_method')})")
                print(f"  Risk Profile R/R: {res.risk_profile.get('risk_reward_ratio')}")
            sys.stdout.flush()
        except Exception as e:
            print(f"  Failed: {e}")
            sys.stdout.flush()

if __name__ == '__main__':
    main()
