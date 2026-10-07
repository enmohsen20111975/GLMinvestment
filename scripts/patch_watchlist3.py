#!/usr/bin/env python3
"""Add store destructuring to EnhancedWatchlistView"""

filepath = '/home/z/my-project/src/components/watchlist/EnhancedWatchlistView.tsx'
with open(filepath, 'rb') as f:
    content = f.read()

# Add store destructuring after the state declarations
old = b"  const [showIntelligence, setShowIntelligence] = useState(false);\r\n"
new = b"  const [showIntelligence, setShowIntelligence] = useState(false);\r\n  const { setDealAdvisorPrefill, setCurrentView } = useAppStore();\r\n"

if old in content:
    content = content.replace(old, new, 1)
    print('STORE: added (CRLF)')
else:
    old = b"  const [showIntelligence, setShowIntelligence] = useState(false);\n"
    new = b"  const [showIntelligence, setShowIntelligence] = useState(false);\n  const { setDealAdvisorPrefill, setCurrentView } = useAppStore();\n"
    if old in content:
        content = content.replace(old, new, 1)
        print('STORE: added (LF)')
    else:
        print('NOT FOUND')
        exit(1)

with open(filepath, 'wb') as f:
    f.write(content)
print('SAVED')
