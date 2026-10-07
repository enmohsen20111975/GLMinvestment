#!/usr/bin/env python3
"""
Auto Refresh Scheduler
======================
تشغيل تلقائي كل 10 دقائق لـ:
- سحب الأسهم (Scraping)
- الذهب والعملات
- العملات الرقمية

البيانات التاريخية: تعمل مرة واحدة في اليوم
"""

import json
import sys
import os
import time
import asyncio
import subprocess
from datetime import datetime
from pathlib import Path

# Paths - all unified in /db folder
DATA_DIR = Path(__file__).parent.parent.parent / 'db'
STATUS_FILE = DATA_DIR / 'auto_refresh_status.json'

# Interval in seconds
INTERVAL = 10 * 60  # 10 minutes

# Scripts to run
SCRIPTS = {
    'metals_forex': {
        'script': 'metals_forex_fetcher.py',
        'name': 'الذهب والعملات',
        'last_run': None,
        'status': 'idle'
    },
    'crypto': {
        'script': 'crypto_fetcher.py',
        'name': 'العملات الرقمية',
        'last_run': None,
        'status': 'idle'
    },
    'stocks': {
        'script': 'tradingview_scraper.py',
        'name': 'سحب الأسهم',
        'last_run': None,
        'status': 'idle'
    }
}

def update_status(status_update):
    """Update status file"""
    try:
        with open(STATUS_FILE, 'r') as f:
            status = json.load(f)
    except:
        status = {
            'running': False,
            'interval': INTERVAL,
            'next_run': None,
            'tasks': SCRIPTS,
            'logs': []
        }
    
    status.update(status_update)
    
    if len(status.get('logs', [])) > 100:
        status['logs'] = status['logs'][-100:]
    
    with open(STATUS_FILE, 'w') as f:
        json.dump(status, f, indent=2, ensure_ascii=False)

def log_message(message):
    """Print and log message"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] {message}")
    
    try:
        with open(STATUS_FILE, 'r') as f:
            status = json.load(f)
    except:
        status = {'logs': []}
    
    status['logs'].append(f"[{timestamp}] {message}")
    if len(status['logs']) > 100:
        status['logs'] = status['logs'][-100:]
    
    with open(STATUS_FILE, 'w') as f:
        json.dump(status, f, indent=2, ensure_ascii=False)

def run_script(script_name, script_path):
    """Run a Python script"""
    try:
        log_message(f"🚀 Starting {script_name}...")
        
        result = subprocess.run(
            ['python3', script_path],
            capture_output=True,
            text=True,
            timeout=300  # 5 minutes timeout
        )
        
        if result.returncode == 0:
            log_message(f"✅ {script_name} completed successfully")
            return 'success'
        else:
            log_message(f"⚠️ {script_name} finished with warnings")
            return 'warning'
            
    except subprocess.TimeoutExpired:
        log_message(f"⏰ {script_name} timed out")
        return 'timeout'
    except Exception as e:
        log_message(f"❌ {script_name} error: {str(e)[:50]}")
        return 'error'

def run_all_tasks():
    """Run all refresh tasks"""
    scripts_dir = Path(__file__).parent
    
    for task_id, task_info in SCRIPTS.items():
        script_path = scripts_dir / task_info['script']
        
        if script_path.exists():
            status = run_script(task_info['name'], str(script_path))
            SCRIPTS[task_id]['status'] = status
            SCRIPTS[task_id]['last_run'] = datetime.now().isoformat()
        else:
            log_message(f"⚠️ Script not found: {task_info['script']}")
    
    update_status({
        'tasks': SCRIPTS,
        'last_run': datetime.now().isoformat()
    })

def main():
    """Main scheduler loop"""
    os.makedirs(DATA_DIR, exist_ok=True)
    
    log_message("=" * 50)
    log_message("🔄 Auto Refresh Scheduler Started")
    log_message(f"⏱️ Interval: {INTERVAL // 60} minutes")
    log_message("=" * 50)
    
    update_status({
        'running': True,
        'interval': INTERVAL,
        'started_at': datetime.now().isoformat()
    })
    
    # Run immediately on start
    log_message("▶️ Running initial fetch...")
    run_all_tasks()
    
    # Then run every INTERVAL seconds
    while True:
        next_run = datetime.now().timestamp() + INTERVAL
        next_run_str = datetime.fromtimestamp(next_run).strftime('%H:%M:%S')
        
        update_status({
            'next_run': next_run_str,
            'tasks': SCRIPTS
        })
        
        log_message(f"⏳ Next run at {next_run_str}")
        time.sleep(INTERVAL)
        
        log_message("▶️ Running scheduled refresh...")
        run_all_tasks()

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        log_message("🛑 Scheduler stopped by user")
        update_status({'running': False})
    except Exception as e:
        log_message(f"❌ Scheduler error: {str(e)}")
        update_status({'running': False})
        sys.exit(1)
