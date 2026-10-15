#!/usr/bin/env python3
"""Add onAnalyze handler to WatchlistMobileCard invocation + store import usage"""

from pathlib import Path

# Resolve target file relative to project root (Rule 17 + Rule 61 — RELATIVE-PATHS-ONLY)
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
filepath = str(_PROJECT_ROOT / 'src' / 'components' / 'watchlist' / 'EnhancedWatchlistView.tsx')
with open(filepath, 'rb') as f:
    content = f.read()

# Add onAnalyze to the WatchlistMobileCard invocation
old_call = b"""<WatchlistMobileCard
                key={item.id}
                item={item}
                hasGainLoss={hasGainLoss}
                onEdit={() => handleEdit(item)}
                onDelete={() => setDeleteId(item.id)}
              />"""
new_call = b"""<WatchlistMobileCard
                key={item.id}
                item={item}
                hasGainLoss={hasGainLoss}
                onEdit={() => handleEdit(item)}
                onDelete={() => setDeleteId(item.id)}
                onAnalyze={() => {
                  setDealAdvisorPrefill({
                    ticker: item.ticker,
                    entryPrice: item.purchase_price ?? null,
                    entryQty: item.quantity ?? null,
                    source: 'watchlist',
                  });
                  setCurrentView('trading-chart');
                }}
              />"""

# Try CRLF first
old_call_crlf = old_call.replace(b'\n', b'\r\n')
new_call_crlf = new_call.replace(b'\n', b'\r\n')

if old_call_crlf in content:
    content = content.replace(old_call_crlf, new_call_crlf, 1)
    print('CALL: updated (CRLF)')
elif old_call in content:
    content = content.replace(old_call, new_call, 1)
    print('CALL: updated (LF)')
else:
    print('CALL: NOT FOUND')
    exit(1)

with open(filepath, 'wb') as f:
    f.write(content)
print('SAVED')
