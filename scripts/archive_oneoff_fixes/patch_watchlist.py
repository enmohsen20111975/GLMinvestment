#!/usr/bin/env python3
"""Add analyze button to WatchlistMobileCard"""
import sys

filepath = '/home/z/my-project/src/components/watchlist/EnhancedWatchlistView.tsx'
with open(filepath, 'rb') as f:
    content = f.read()

# 1. Update function signature to accept onAnalyze
old_sig = "function WatchlistMobileCard({ \r\n  item, \r\n  hasGainLoss, \r\n  onEdit, \r\n  onDelete \r\n}: { \r\n  item: EnhancedWatchlistItem; \r\n  hasGainLoss: boolean;\r\n  onEdit: () => void;\r\n  onDelete: () => void;\r\n}) {".encode('utf-8')
new_sig = "function WatchlistMobileCard({ \r\n  item, \r\n  hasGainLoss, \r\n  onEdit, \r\n  onDelete, \r\n  onAnalyze \r\n}: { \r\n  item: EnhancedWatchlistItem; \r\n  hasGainLoss: boolean;\r\n  onEdit: () => void;\r\n  onDelete: () => void;\r\n  onAnalyze: () => void;\r\n}) {".encode('utf-8')

if old_sig in content:
    content = content.replace(old_sig, new_sig, 1)
    print('SIG: updated')
else:
    old_sig2 = b"function WatchlistMobileCard({ \n  item, \n  hasGainLoss, \n  onEdit, \n  onDelete \n}: { \n  item: EnhancedWatchlistItem; \n  hasGainLoss: boolean;\n  onEdit: () => void;\n  onDelete: () => void;\n}) {"
    new_sig2 = b"function WatchlistMobileCard({ \n  item, \n  hasGainLoss, \n  onEdit, \n  onDelete, \n  onAnalyze \n}: { \n  item: EnhancedWatchlistItem; \n  hasGainLoss: boolean;\n  onEdit: () => void;\n  onDelete: () => void;\n  onAnalyze: () => void;\n}) {"
    if old_sig2 in content:
        content = content.replace(old_sig2, new_sig2, 1)
        print('SIG: updated (LF)')
    else:
        print('SIG: NOT FOUND')
        sys.exit(1)

# 2. Add the analyze button before the edit button
edit_btn_marker = b'<Button\r\n            variant="outline"\r\n            size="sm"\r\n            onClick={onEdit}\r\n            className="h-9"\r\n          >\r\n            <Pencil'
if edit_btn_marker not in content:
    edit_btn_marker = b'<Button\n            variant="outline"\n            size="sm"\n            onClick={onEdit}\n            className="h-9"\n          >\n            <Pencil'
if edit_btn_marker not in content:
    print('EDIT BTN: NOT FOUND')
    sys.exit(1)

crlf = b'\r\n' if b'\r\n' in edit_btn_marker else b'\n'
analyze_btn = (
    b'<Button' + crlf +
    b'            variant="outline"' + crlf +
    b'            size="sm"' + crlf +
    b'            onClick={onAnalyze}' + crlf +
    b'            className="h-9 border-primary text-primary hover:bg-primary/10"' + crlf +
    b'            title="\xd9\x85\xd8\xb3\xd8\xaa\xd8\xb4\xd8\xa7\xd8\xb1 \xd8\xa7\xd9\x84\xd8\xb5\xd9\x81\xd9\x82\xd8\xa9"' + crlf +
    b'          >' + crlf +
    b'            <Sparkles className="w-3.5 h-3.5 ml-1.5" />' + crlf +
    b'            \xd9\x85\xd8\xb3\xd8\xaa\xd8\xb4\xd8\xa7\xd8\xb1' + crlf +
    b'          </Button>' + crlf +
    b'          '
)

content = content.replace(edit_btn_marker, analyze_btn + edit_btn_marker, 1)
print('BTN: added')

with open(filepath, 'wb') as f:
    f.write(content)
print('SAVED')
