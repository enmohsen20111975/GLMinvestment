#!/usr/bin/env python3
"""Debug page 1 of data_engine.db to understand the b-tree structure."""
import struct

DB_PATH = "/home/meme/my_apps/GLMinvestment/db/data_engine.db"

with open(DB_PATH, 'rb') as f:
    data = f.read()

# Header
page_size = struct.unpack_from('>H', data, 16)[0]
if page_size == 1:
    page_size = 65536

print(f"Page size: {page_size}")
print(f"File size: {len(data)}")
print(f"Number of pages: {len(data) // page_size}")

# Page 1 starts at offset 100 (after 100-byte header)
page1 = data[100:100 + page_size]

print(f"\nPage 1 first 50 bytes: {page1[:50].hex()}")
print(f"Page type: {page1[0]} (5=interior table, 13=leaf table)")
print(f"First freeblock: {struct.unpack_from('>H', page1, 1)[0]}")
print(f"Num cells: {struct.unpack_from('>H', page1, 3)[0]}")
print(f"Start of content: {struct.unpack_from('>H', page1, 5)[0]}")
print(f"Fragmented free bytes: {page1[7]}")

rightmost = struct.unpack_from('>I', page1, 8)[0]
print(f"Rightmost pointer: {rightmost}")

# Cell pointers (at offset 12 for interior table)
num_cells = struct.unpack_from('>H', page1, 3)[0]
print(f"\nCell pointer array (offset 12, {num_cells} cells):")
for i in range(num_cells):
    ptr = struct.unpack_from('>H', page1, 12 + i * 2)[0]
    print(f"  Cell {i}: pointer offset = {ptr}")
    
    # Parse interior table cell: 4-byte left child + varint rowid
    left_child = struct.unpack_from('>I', page1, ptr)[0]
    
    # Read varint for rowid
    pos = ptr + 4
    rowid = 0
    for j in range(9):
        byte = page1[pos + j]
        if j < 8:
            rowid = (rowid << 7) | (byte & 0x7F)
            if not (byte & 0x80):
                break
        else:
            rowid = (rowid << 8) | byte
    
    print(f"    left_child_page={left_child}, rowid={rowid}")

# Also print the raw hex of a few cell pointer bytes
print(f"\nRaw cell pointer bytes (offset 12-30): {page1[12:30].hex()}")
print(f"\nRaw page 1 bytes 3500-3600 (looking for more data):")
# Check if there are more cell pointers or data
for offset in range(3500, min(3800, page_size)):
    val = page1[offset]
    if 32 <= val <= 126:
        pass  # printable

# Search for known table names in page 1
for name in [b'historical_data', b'stocks', b'exchange_rates', b'silver_prices', b'gold_prices']:
    pos = page1.find(name)
    if pos >= 0:
        print(f"Found '{name.decode()}' at offset {pos}")
        context = page1[max(0,pos-20):pos+len(name)+20]
        print(f"  Context: {context[:60].hex()}")

# Check if there are overflow pages or if sqlite_master has more pages
# The first few bytes of the database file tell us the page 1 is the root
# But sqlite_master might span multiple pages

print(f"\nSearching for leaf pages referenced by interior pages...")
# List all unique child pages found
child_pages = set()
for i in range(num_cells):
    ptr = struct.unpack_from('>H', page1, 12 + i * 2)[0]
    left_child = struct.unpack_from('>I', page1, ptr)[0]
    child_pages.add(left_child)
child_pages.add(rightmost)
print(f"Child pages: {sorted(child_pages)}")

# Check each child page to see what type they are
for cp in sorted(child_pages):
    if cp == 0:
        continue
    if cp == 1:
        pdata = page1
    else:
        offset = (cp - 1) * page_size
        if offset >= len(data):
            print(f"Page {cp}: OUT OF BOUNDS (offset {offset} >= {len(data)})")
            continue
        pdata = data[offset:offset + page_size]
    
    ptype = pdata[0]
    ncells = struct.unpack_from('>H', pdata, 3)[0]
    print(f"Page {cp}: type={ptype} (5=interior, 13=leaf), cells={ncells}")
    
    if ptype == 13 and ncells > 0:
        # Read a few cells to see what's in there
        print(f"  Cell pointer array starts at offset 8:")
        for ci in range(min(ncells, 5)):
            cell_ptr = struct.unpack_from('>H', pdata, 8 + ci * 2)[0]
            print(f"    Cell {ci}: offset={cell_ptr}")
