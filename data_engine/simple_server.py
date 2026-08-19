#!/usr/bin/env python3
"""Simple Data Engine Server"""
import sqlite3
import json
from pathlib import Path
from datetime import datetime
from flask import Flask, jsonify, request
import threading

_HERE = Path(__file__).resolve().parent
DATA_DIR = _HERE / 'data'
DATA_ENGINE_DB = str(DATA_DIR / 'data_engine.db')
_PROJECT_ROOT = _HERE.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

app = Flask(__name__)

# Global state
engine_state = {
    'running': True,
    'scheduler_active': True,
    'last_stocks_update': datetime.now().isoformat(),
    'last_crypto_update': datetime.now().isoformat(),
    'last_metals_update': datetime.now().isoformat(),
    'last_sync': datetime.now().isoformat(),
    'logs': ['🚀 Server started'],
    'errors': []
}

def get_db_stats():
    stats = {'data_engine': {}, 'stocks_db': {}}
    try:
        conn = sqlite3.connect(DATA_ENGINE_DB)
        c = conn.cursor()
        for table, key in [('stocks', 'stocks'), ('crypto_prices', 'crypto'),
                           ('gold_prices', 'gold'), ('silver_prices', 'silver'),
                           ('exchange_rates', 'forex')]:
            try:
                c.execute(f'SELECT COUNT(*) FROM {table}')
                stats['data_engine'][key] = c.fetchone()[0]
            except: pass
        conn.close()
    except: pass
    
    try:
        conn = sqlite3.connect(STOCKS_DB)
        c = conn.cursor()
        c.execute('SELECT COUNT(*) FROM stocks')
        stats['stocks_db']['stocks'] = c.fetchone()[0]
        conn.close()
    except: pass
    return stats

@app.route('/')
def index():
    return jsonify({'name': '🔥 Data Engine', 'status': 'running', 'port': 5000})

@app.route('/health')
def health():
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

@app.route('/status')
def status():
    return jsonify({'success': True, 'engine': engine_state, 'db_stats': get_db_stats()})

@app.route('/trigger/stocks', methods=['POST'])
def trigger_stocks():
    engine_state['logs'].append(f'[{datetime.now().strftime("%H:%M:%S")}] 📊 Stocks triggered')
    engine_state['last_stocks_update'] = datetime.now().isoformat()
    return jsonify({'success': True, 'message': 'Stocks scraper triggered'})

@app.route('/trigger/crypto', methods=['POST'])
def trigger_crypto():
    engine_state['logs'].append(f'[{datetime.now().strftime("%H:%M:%S")}] ₿ Crypto triggered')
    engine_state['last_crypto_update'] = datetime.now().isoformat()
    return jsonify({'success': True, 'message': 'Crypto fetcher triggered'})

@app.route('/trigger/metals', methods=['POST'])
def trigger_metals():
    engine_state['logs'].append(f'[{datetime.now().strftime("%H:%M:%S")}] 🥇 Metals triggered')
    engine_state['last_metals_update'] = datetime.now().isoformat()
    return jsonify({'success': True, 'message': 'Metals fetcher triggered'})

@app.route('/trigger/sync', methods=['POST'])
def trigger_sync():
    engine_state['logs'].append(f'[{datetime.now().strftime("%H:%M:%S")}] 🔄 Sync triggered')
    engine_state['last_sync'] = datetime.now().isoformat()
    return jsonify({'success': True, 'message': 'Sync triggered'})

if __name__ == '__main__':
    print('🔥 Data Engine on port 5000')
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
