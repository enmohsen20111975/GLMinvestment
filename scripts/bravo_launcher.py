#!/usr/bin/env python3
"""
Launcher that ignores SIGHUP so the python process survives shell exit.
"""
import os
import signal
import subprocess
import sys

# Ignore SIGHUP (sent when controlling terminal closes)
signal.signal(signal.SIGHUP, signal.SIG_IGN)

# Set env vars
env = os.environ.copy()
env['SKIP_CRYPTO_LAB'] = '1'

# Replace ourselves with main.py
os.chdir('/home/z/my-project/vps-service')
os.execvpe('python3', ['python3', 'main.py'], env)
