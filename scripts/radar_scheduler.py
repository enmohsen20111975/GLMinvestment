#!/usr/bin/env python3
"""
radar_scheduler.py — Radar refresh loop كل 15 دقيقة
بديل cron في الـ sandbox (مفيش crontab)
"""
import subprocess
import time
import os
from datetime import datetime

LOG_FILE = '/tmp/radar_scheduler.log'
INTERVAL = 900  # 15 دقيقة

def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

def run_radar():
    log('🔄 Radar refresh started')
    for market in ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US']:
        try:
            result = subprocess.run(
                ['python3', 'scripts/maker_radar.py', '--market', market, '--json-only'],
                cwd='/home/z/my-project',
                timeout=120,
                capture_output=True,
                text=True
            )
            # آخر سطر فيه النتيجة
            last_lines = result.stdout.strip().split('\n')[-3:] if result.stdout else []
            for line in last_lines:
                if 'JSON saved' in line or 'under_microscope' in line or 'signals' in line:
                    log(f'  {market}: {line.strip()}')
        except subprocess.TimeoutExpired:
            log(f'  {market}: TIMEOUT')
        except Exception as e:
            log(f'  {market}: ERROR {e}')
    log('✅ Radar refresh completed')

if __name__ == '__main__':
    log('🚀 Radar scheduler started (interval=15min)')
    # أول run فوراً
    run_radar()
    # بعدها كل 15 دقيقة
    while True:
        time.sleep(INTERVAL)
        run_radar()
