#!/usr/bin/env python3
"""CI check: fail if any 'DELETE FROM predictions' found in active code.

DEV-06 (2026-10-12 — DUAL-TRACK): Hard DELETE disabled per Rule 21/35.
All `DELETE FROM predictions` statements must be replaced with
`UPDATE predictions SET status='ARCHIVED', ...` (archive pattern).

This script greps vps-service/ and scripts/ for any remaining
`DELETE FROM predictions` occurrences and fails the build if any are
found in ACTIVE code (excluding archived code, __pycache__, comments,
and disabled/replaced guards).

Task ID: DEV-06
"""
import subprocess
import sys

result = subprocess.run(
    ['grep', '-r', 'DELETE FROM predictions', 'vps-service/', 'scripts/'],
    capture_output=True, text=True
)

# Filter out: archive/, __pycache__, comments (#), DISABLED guards,
# RULE35 markers, DEV-06 verified-disabled markers, and this script itself
# (its docstring/grep pattern reference "DELETE FROM predictions" by design).
active = [l for l in result.stdout.split('\n')
          if l and 'archive/' not in l and '__pycache__' not in l
          and '# ' not in l.split('DELETE')[0] and 'DISABLE' not in l
          and 'RULE35' not in l and 'DEV-06' not in l
          and 'check_no_hard_delete' not in l]

if active:
    print(f"❌ FAIL: {len(active)} active DELETE FROM predictions found:")
    for line in active:
        print(f"  {line}")
    sys.exit(1)
else:
    print("✅ PASS: 0 active DELETE FROM predictions")
    sys.exit(0)
