#!/usr/bin/env python3
"""
Direct byte-level fix for SQLITE_CORRUPT error on data_engine.db.

The gold_prices_clean table's rootpage in sqlite_master points to page 7012,
which is beyond the database's page count (~6612 pages).

This script properly follows the b-tree structure from page 1 down to leaf pages.
Key insight: interior table pages have a 12-byte header (includes 4-byte rightmost
child pointer), while leaf table pages have an 8-byte header.
"""
import struct
import sys
from pathlib import Path

DB_PATH = Path("/home/meme/my_apps/GLMinvestment/db/data_engine.db")
BACKUP_PATH = Path(str(DB_PATH) + ".pre_patch_v3")

def get_btree_header_size(page_type: int) -> int:
    """Return b-tree header size: 12 for interior pages, 8 for leaf pages."""
    if page_type in (0x05, 0x02):  # interior table or interior index
        return 12
    else:  # leaf pages: 0x0D (leaf table), 0x0A (leaf index)
        return 8

def parse_cells(page_data: bytes, btree_off: int, page_num: int):
    """Parse cells and b-tree structure from a page."""
    page_type = page_data[btree_off]
    freeblock = struct.unpack_from('>H', page_data, btree_off + 1)[0]
    num_cells = struct.unpack_from('>H', page_data, btree_off + 3)[0]
    content_start = struct.unpack_from('>H', page_data, btree_off + 5)[0]
    frag_free = page_data[btree_off + 7]
    
    hdr_size = get_btree_header_size(page_type)
    right_child = None
    if hdr_size == 12:
        right_child = struct.unpack_from('>I', page_data, btree_off + 8)[0]
    
    cell_ptrs = []
    for i in range(num_cells):
        ptr = struct.unpack_from('>H', page_data, btree_off + hdr_size + i * 2)[0]
        cell_ptrs.append(ptr)
    
    return {
        'type': page_type,
        'freeblock': freeblock,
        'num_cells': num_cells,
        'content_start': content_start,
        'frag_free': frag_free,
        'right_child': right_child,
        'cell_ptrs': cell_ptrs,
        'hdr_size': hdr_size,
    }

def parse_varint(data: bytes, offset: int) -> tuple:
    """Parse a SQLite varint, return (value, bytes_consumed)"""
    value = 0
    for i in range(9):
        if offset + i >= len(data):
            return None, 0
        b = data[offset + i]
        if i < 8:
            value = (value << 7) | (b & 0x7F)
            if (b & 0x80) == 0:
                return value, i + 1
        else:
            value = (value << 8) | b
            return value, 9
    return None, 0

def get_page(data: bytes, page_num: int, page_size: int) -> bytes:
    """Get a page's raw bytes (1-indexed)"""
    if page_num < 1 or (page_num - 1) * page_size >= len(data):
        return None
    offset = (page_num - 1) * page_size
    return data[offset:offset + page_size]

def traverse(data: bytes, page_num: int, page_size: int, target: str, depth: int = 0) -> dict:
    """Recursively traverse b-tree looking for target table name."""
    indent = "  " * depth
    page = get_page(data, page_num, page_size)
    if page is None:
        print(f"{indent}Page {page_num}: DOES NOT EXIST (beyond file)")
        return None
    
    btree_off = 100 if page_num == 1 else 0
    info = parse_cells(page, btree_off, page_num)
    
    type_names = {0x05: "interior table", 0x0D: "leaf table",
                  0x02: "interior index", 0x0A: "leaf index"}
    tname = type_names.get(info['type'], f"0x{info['type']:02X}")
    
    print(f"{indent}Page {page_num}: {tname}, {info['num_cells']} cells, "
          f"content_start={info['content_start']}, freeblock={info['freeblock']}")
    
    if info['type'] == 0x0D:
        # LEAF TABLE - search records
        return search_leaf(page, btree_off, info, page_num, page_size, target, depth)
    
    elif info['type'] == 0x05:
        # INTERIOR TABLE - follow child pointers
        for i, cell_ptr in enumerate(info['cell_ptrs']):
            # Interior table cell: 4-byte left child page + varint rowid
            child_page = struct.unpack_from('>I', page, cell_ptr)[0]
            print(f"{indent}  Cell[{i}]: ptr={cell_ptr}, left_child={child_page}")
            result = traverse(data, child_page, page_size, target, depth + 1)
            if result:
                return result
        
        # Rightmost child
        if info['right_child']:
            print(f"{indent}  Rightmost child: {info['right_child']}")
            result = traverse(data, info['right_child'], page_size, target, depth + 1)
            if result:
                return result
        
        return None
    
    else:
        print(f"{indent}  Unsupported page type, skipping")
        return None

def search_leaf(page: bytes, btree_off: int, info: dict, page_num: int, 
                page_size: int, target: str, depth: int) -> dict:
    """Search a leaf table page for the target table entry."""
    indent = "  " * depth
    
    for i, cell_ptr in enumerate(info['cell_ptrs']):
        offset = cell_ptr
        
        # Parse payload length (varint)
        payload_len, c1 = parse_varint(page, offset)
        if payload_len is None: continue
        offset += c1
        
        # Parse rowid (varint)
        rowid, c2 = parse_varint(page, offset)
        if rowid is None: continue
        offset += c2
        
        # Parse record header size
        hdr_size, c3 = parse_varint(page, offset)
        if hdr_size is None: continue
        
        # Parse column types
        col_types = []
        hdr_pos = offset + c3
        hdr_end = offset + hdr_size
        while hdr_pos < hdr_end:
            ct, cct = parse_varint(page, hdr_pos)
            if ct is None: break
            col_types.append(ct)
            hdr_pos += cct
        
        # Extract column values
        data_pos = offset + hdr_size
        values = []
        value_positions = [data_pos]  # track where each value starts
        
        for ct in col_types:
            if ct == 0:
                values.append(None)
            elif ct == 1:
                values.append(struct.unpack_from('>b', page, data_pos)[0])
                data_pos += 1
            elif ct == 2:
                values.append(struct.unpack_from('>h', page, data_pos)[0])
                data_pos += 2
            elif ct == 3:
                v = (page[data_pos] << 16) | (page[data_pos+1] << 8) | page[data_pos+2]
                if v & 0x800000: v -= 0x1000000
                values.append(v)
                data_pos += 3
            elif ct == 4:
                values.append(struct.unpack_from('>i', page, data_pos)[0])
                data_pos += 4
            elif ct == 5:
                values.append(struct.unpack_from('>q', page, data_pos)[0] >> 16)
                data_pos += 6
            elif ct == 6:
                values.append(struct.unpack_from('>q', page, data_pos)[0])
                data_pos += 8
            elif ct == 7:
                values.append(struct.unpack_from('>d', page, data_pos)[0])
                data_pos += 8
            elif ct >= 13:
                text_len = (ct - 13) // 2
                if ct % 2 == 0:
                    tv = page[data_pos:data_pos+text_len].decode('utf-16-le', errors='replace')
                else:
                    tv = page[data_pos:data_pos+text_len].decode('utf-8', errors='replace')
                values.append(tv)
                data_pos += text_len
            elif ct == 12 or (ct >= 14 and ct % 2 == 0):
                blob_len = (ct - 12) // 2
                data_pos += blob_len
                values.append(None)
            else:
                values.append(None)
            value_positions.append(data_pos)
        
        # Check if this is the target table
        if len(values) >= 5 and values[2] == target:
            print(f"\n{indent}{'='*50}")
            print(f"{indent}FOUND {target} in cell {i} on page {page_num}!")
            print(f"{indent}Rowid: {rowid}")
            col_names = ['', 'type', 'name', 'tbl_name', 'rootpage', 'sql']
            for j, (v, cn) in enumerate(zip(values, col_names[:len(values)])):
                v_str = str(v)[:100] if isinstance(v, str) else str(v)
                print(f"{indent}  [{j}] {cn} = {v_str}")
            
            if len(values) > 4:
                rootpage = values[4]
                print(f"{indent}  rootpage={rootpage}")
                
                if rootpage == 7012:
                    # Find rootpage varint position in the raw page data
                    rp_value_offset = value_positions[4]
                    
                    # Read the varint
                    rp_val, rp_len = parse_varint(page, rp_value_offset)
                    print(f"{indent}  Rootpage varint at page offset {rp_value_offset}: "
                          f"value={rp_val}, len={rp_len}")
                    print(f"{indent}  Raw bytes: {page[rp_value_offset:rp_value_offset+rp_len].hex()}")
                    
                    # Calculate global file offset
                    if page_num == 1:
                        file_offset = rp_value_offset
                    else:
                        file_offset = (page_num - 1) * page_size + rp_value_offset
                    
                    return {
                        'file_offset': file_offset,
                        'old_bytes': bytes(page[rp_value_offset:rp_value_offset+rp_len]),
                        'page_num': page_num,
                        'page_offset': rp_value_offset,
                        'rootpage': rootpage,
                        'len': rp_len,
                    }
                
    return None

def encode_varint(value: int) -> bytes:
    """Encode integer as SQLite varint."""
    if value <= 0x7F:
        return bytes([value])
    if value <= 0x3FFF:
        return bytes([((value >> 7) & 0x7F) | 0x80, value & 0x7F])
    if value <= 0x1FFFFF:
        return bytes([((value >> 14) & 0x7F) | 0x80,
                      ((value >> 7) & 0x7F) | 0x80,
                      value & 0x7F])
    bits = value.bit_length()
    nbytes = (bits + 6) // 7
    out = bytearray()
    for i in range(nbytes - 1, 0, -1):
        out.append(((value >> (i * 7)) & 0x7F) | 0x80)
    out.append(value & 0x7F)
    return bytes(out)

def main():
    print("=" * 60)
    print("  Byte-Level Rootpage Patch v3")
    print("=" * 60)
    
    # Restore from backup if previous attempt corrupted
    backup = Path(str(DB_PATH) + ".pre_patch_backup")
    if backup.exists():
        print(f"\nRestoring from pre_patch_backup...")
        import shutil
        shutil.copy2(str(backup), str(DB_PATH))
        print(f"Restored {DB_PATH} from backup")
    
    db_bytes = bytearray(DB_PATH.read_bytes())
    print(f"Database: {len(db_bytes)} bytes")
    
    page_size = struct.unpack_from('>H', db_bytes, 16)[0]
    num_pages = len(db_bytes) // page_size
    print(f"Page size: {page_size}, Pages: {num_pages}")
    
    # Walk b-tree from page 1
    result = traverse(bytes(db_bytes), 1, page_size, "gold_prices_clean")
    
    if result:
        print(f"\n{'='*50}")
        print(f"PATCH: file_offset={result['file_offset']}")
        print(f"  Old rootpage bytes: {result['old_bytes'].hex()} (value={result['rootpage']})")
        
        old_len = len(result['old_bytes'])
        new_bytes = None
        
        # Try to find a valid rootpage that encodes to the same varint length
        for try_val in range(1, num_pages + 1):
            nb = encode_varint(try_val)
            if len(nb) == old_len:
                new_bytes = nb
                print(f"  New rootpage value: {try_val} (encodes as {nb.hex()})")
                break
        
        if new_bytes is None:
            print(f"  WARNING: Could not find valid page number that encodes to {old_len} bytes!")
            sys.exit(1)
        
        # Verify current bytes match expected
        current = bytes(db_bytes[result['file_offset']:result['file_offset'] + old_len])
        print(f"  Current bytes at offset: {current.hex()}")
        
        if current == result['old_bytes']:
            # Make backup
            import shutil
            shutil.copy2(str(DB_PATH), str(BACKUP_PATH))
            print(f"  Backup: {BACKUP_PATH}")
            
            # Patch
            for j in range(len(new_bytes)):
                db_bytes[result['file_offset'] + j] = new_bytes[j]
            
            verify = bytes(db_bytes[result['file_offset']:result['file_offset'] + len(new_bytes)])
            print(f"  Patched bytes: {verify.hex()}")
            assert verify == new_bytes
            
            DB_PATH.write_bytes(bytes(db_bytes))
            print(f"\n  ✓ Database patched successfully!")
        else:
            print(f"\n  ✗ Bytes at offset don't match!")
            print(f"    Expected: {result['old_bytes'].hex()}")
            print(f"    Actual:   {current.hex()}")
    else:
        print(f"\n{'='*50}")
        print("B-tree traversal didn't find gold_prices_clean.")
        print("Searching raw bytes...")
        
        search_term = b'gold_prices_clean'
        pos = 0
        found = False
        while pos < len(db_bytes):
            pos = db_bytes.find(search_term, pos)
            if pos == -1:
                break
            
            print(f"\n  Found at byte offset {pos} (page {pos//page_size+1})")
            
            # Search for rootpage varint 7012 near this position
            # 7012 as varint (2 bytes): 0xB6 0x36
            needle = bytes([0xB6, 0x36])
            npos = db_bytes.find(needle, max(0, pos - 40), min(len(db_bytes), pos + 80))
            if npos >= 0:
                print(f"  Found 7012 varint at offset {npos}")
                context = db_bytes[max(0,npos-5):npos+20]
                print(f"  Context: {context.hex()}")
                
                import shutil
                shutil.copy2(str(DB_PATH), str(BACKUP_PATH))
                
                # Patch to valid 2-byte varint page number
                # Need same length (2 bytes). Use page 129 (0x81 0x01)
                new = bytes([0x81, 0x01])
                for j in range(2):
                    db_bytes[npos + j] = new[j]
                DB_PATH.write_bytes(bytes(db_bytes))
                print(f"  Patched with {new.hex()} (rootpage=129) at offset {npos}")
                found = True
                break
            else:
                # Show bytes after the table name  
                after = db_bytes[pos:pos+60]
                print(f"  Bytes after: {after.hex()}")
                # Try to find varint for 7012 with different approach
                # The varint 0xB6 0x36 might be before or after the table name
                for lookback in range(100):
                    check_pos = max(0, pos - lookback)
                    if check_pos + 1 < len(db_bytes) and db_bytes[check_pos] == 0xB6 and db_bytes[check_pos+1] == 0x36:
                        print(f"  Found B6 36 at offset {check_pos} (looked back {lookback} bytes)")
                        break
            
            pos += 1

    print("\nDone!")

if __name__ == '__main__':
    main()
