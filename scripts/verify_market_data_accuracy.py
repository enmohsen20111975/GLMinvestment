import sqlite3
import os
import sys
import json
import urllib.request

sys.path.insert(0, os.path.abspath('vps-service'))
from analyzers.master_analyzer import MasterAnalyzer

print("=" * 70)
print("🔍 COMPREHENSIVE DATA & TECHNICAL ANALYSIS ACCURACY AUDIT")
print("=" * 70)

def fetch_yahoo_quote(symbol):
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read().decode())
            meta = data['chart']['result'][0]['meta']
            return {
                'price': meta.get('regularMarketPrice'),
                'previous_close': meta.get('previousClose') or meta.get('chartPreviousClose'),
                'high': meta.get('regularMarketDayHigh'),
                'low': meta.get('regularMarketDayLow')
            }
    except Exception as e:
        return {'error': str(e)}

# 1. Price comparison
print("\n--- 1. REAL-WORLD PRICE COMPARISON (Yahoo Live vs DB) ---")
test_assets = [
    ('COMI', 'COMI.CA', 'EGX'),
    ('SWDY', 'SWDY.CA', 'EGX'),
    ('ETEL', 'ETEL.CA', 'EGX'),
    ('AMOC', 'AMOC.CA', 'EGX'),
    ('FWRY', 'FWRY.CA', 'EGX'),
    ('2222', '2222.SR', 'TADAWUL'),
    ('AAPL', 'AAPL', 'US'),
    ('BTC', 'BTC-USD', 'CRYPTO'),
]

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn_stocks = db_manager.connection('db/stocks.db', writable=False).__enter__()
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn_crypto = db_manager.connection('db/data_engine.db', writable=False).__enter__()

for ticker, yf_symbol, market in test_assets:
    yf_data = fetch_yahoo_quote(yf_symbol)
    db_price = None
    db_close = None
    
    if market == 'CRYPTO':
        row = conn_crypto.execute("SELECT price_usd FROM crypto_prices WHERE symbol = ? OR symbol = ?", (ticker, f"{ticker}/USDT")).fetchone()
        if row: db_price = row[0]
    else:
        row = conn_stocks.execute("SELECT current_price, close FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
        if row:
            db_price = row[0]
            db_close = row[1]
            
    yf_price = yf_data.get('price')
    if yf_price and db_price:
        diff_pct = abs(db_price - yf_price) / yf_price * 100
        match_status = "✅ MATCH (<2%)" if diff_pct < 2.0 else f"⚠️ DIFF: {diff_pct:.1f}%"
        print(f"  [{market:7s}] {ticker:6s}: DB Price={db_price:10.2f} | Yahoo={yf_price:10.2f} | {match_status}")
    else:
        print(f"  [{market:7s}] {ticker:6s}: DB Price={db_price} | Yahoo={yf_price} (Fetch note: {yf_data.get('error', 'ok')})")

conn_stocks.close()
conn_crypto.close()

# 2. Technical Analysis Evaluation
print("\n--- 2. TECHNICAL ANALYSIS ACCURACY & SANITY CHECK ---")
ma = MasterAnalyzer()

sample_analysis = ['COMI', 'SWDY', 'ETEL', 'AMOC']
for t in sample_analysis:
    try:
        res = ma.analyze(t, market='EGX')
        print(f"\n📈 Stock: {t} ({res.name})")
        print(f"   - Signal: {res.signal} (Confidence: {res.confidence}%) | Master Score: {res.master_score:.2f}")
        print(f"   - Technical Summary: {res.technical_summary}")
        
        # Check Indicators sanity
        ti = res.risk_profile.get('indicators', {}) if hasattr(res, 'risk_profile') else {}
        print(f"   - Market Regime: {res.market_regime_ar} (Strength: {res.market_regime_strength})")
        print(f"   - Conviction: {res.conviction_level_ar} | Action: {res.conviction_action}")
        
        # Sanity Checks
        assert res.master_score >= 0, "Score cannot be negative"
        assert res.signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL'], f"Unknown signal: {res.signal}"
        print(f"   - Status: ✅ Passed All Technical Integrity Checks")
    except Exception as e:
        print(f"   - ❌ Analysis Error for {t}: {e}")

print("\n" + "=" * 70)
print("✅ ACCURACY AUDIT COMPLETE")
print("=" * 70)
