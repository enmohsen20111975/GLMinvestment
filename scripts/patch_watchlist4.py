#!/usr/bin/env python3
"""Add analyze button to Desktop Table View"""

filepath = '/home/z/my-project/src/components/watchlist/EnhancedWatchlistView.tsx'
with open(filepath, 'rb') as f:
    content = f.read()

# Add analyze button before edit button in desktop table
old_block = b"""<div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                onClick={() => handleEdit(item)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>"""

# Try CRLF
old_block_crlf = old_block.replace(b'\n', b'\r\n')
new_block_crlf = (
    b'<div className="flex items-center justify-center gap-1">\r\n'
    b'                              <Button\r\n'
    b'                                variant="ghost"\r\n'
    b'                                size="icon"\r\n'
    b'                                className="h-8 w-8 text-primary hover:bg-primary/10"\r\n'
    b'                                onClick={() => {\r\n'
    b'                                  setDealAdvisorPrefill({\r\n'
    b'                                    ticker: item.ticker,\r\n'
    b'                                    entryPrice: item.purchase_price ?? null,\r\n'
    b'                                    entryQty: item.quantity ?? null,\r\n'
    b'                                    source: \'watchlist\',\r\n'
    b'                                  });\r\n'
    b'                                  setCurrentView(\'trading-chart\');\r\n'
    b'                                }}\r\n'
    b'                                title="\xd9\x85\xd8\xb3\xd8\xaa\xd8\xb4\xd8\xa7\xd8\xb1 \xd8\xa7\xd9\x84\xd8\xb5\xd9\x81\xd9\x82\xd8\xa9"\r\n'
    b'                              >\r\n'
    b'                                <Sparkles className="w-3.5 h-3.5" />\r\n'
    b'                              </Button>\r\n'
    b'                              <Button\r\n'
    b'                                variant="ghost"\r\n'
    b'                                size="icon"\r\n'
    b'                                className="h-8 w-8 text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"\r\n'
    b'                                onClick={() => handleEdit(item)}\r\n'
    b'                              >\r\n'
    b'                                <Pencil className="w-3.5 h-3.5" />\r\n'
    b'                              </Button>'
)

if old_block_crlf in content:
    content = content.replace(old_block_crlf, new_block_crlf, 1)
    print('DESKTOP: updated (CRLF)')
elif old_block in content:
    new_block = new_block_crlf.replace(b'\r\n', b'\n')
    content = content.replace(old_block, new_block, 1)
    print('DESKTOP: updated (LF)')
else:
    print('DESKTOP: NOT FOUND')
    exit(1)

with open(filepath, 'wb') as f:
    f.write(content)
print('SAVED')
