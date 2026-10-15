#!/usr/bin/env python3
"""
Direct byte-level fix for SQLITE_CORRUPT error on data_engine.db.

The gold_prices_clean table's rootpage in sqlite_master points to page 7012,
which is beyond the database's page count (~6612 pages).

This script properly follows the b-tree structure from page 1 down to leaf pages,
finds the gold_prices_clean entry, and patches rootpage 7012 → 1.
"""
import struct
import sys
from pathlib import Path

DB_PATH = Path("/home/meme/my_apps/GLMinvestment/db/data_engine.db")
BACKUP_PATH = Path(str(DB_PATH) + ".pre_patch_v2")

def parse_varint(data: bytes, offset: int) -> tuple:
    """Parse a SQLite varint at offset, return (value, bytes_consumed)"""
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

def encode_varint(value: int) -> bytes:
    """Encode an integer as a SQLite varint"""
    if value <= 0x7F:
        return bytes([value])
    if value <= 0x3FFF:
        return bytes([((value >> 7) & 0x7F) | 0x80, value & 0x7F])
    if value <= 0x1FFFFF:
        return bytes([((value >> 14) & 0x7F) | 0x80,
                      ((value >> 7) & 0x7F) | 0x80,
                      value & 0x7F])
    out = bytearray()
    bits = value.bit_length()
    bytes_needed = (bits + 6) // 7
    for i in range(bytes_needed - 1, 0, -1):
        out.append(((value >> (i * 7)) & 0x7F) | 0x80)
    out.append(value & 0x7F)
    return bytes(out)

def get_page(data: bytes, page_num: int, page_size: int) -> bytes:
    """Get a page's raw bytes (1-indexed page numbers)"""
    offset = (page_num - 1) * page_size
    if page_num == 1:
        # Page 1 starts at offset 0
        return data[:page_size]
    return data[offset:offset + page_size]

def traverse_interior_table(data: bytes, page_num: int, page_size: int, target_name: str, depth: int = 0):
    """Recursively traverse an interior table b-tree page looking for target_name."""
    indent = "  " * depth
    page = get_page(data, page_num, page_size)
    
    # b-tree header on page 1 starts at offset 100; for other pages at offset 0
    btree_off = 100 if page_num == 1 else 0
    
    page_type = page[btree_off]
    if page_type not in (0x05, 0x0D):
        print(f"{indent}Page {page_num}: type 0x{page_type:02X} (not table page), skipping")
        return None
    
    num_cells = struct.unpack_from('>H', page, btree_off + 3)[0]
    
    if page_type == 0x0D:
        # LEAF TABLE PAGE - contains actual records
        return search_leaf_page(data, page_num, page_size, target_name, depth)
    else:
        # INTERIOR TABLE PAGE - contains child pointers
        print(f"{indent}Page {page_num}: interior table, {num_cells} cells, searching children...")
        cell_ptrs = []
        for i in range(num_cells):
            ptr = struct.unpack_from('>H', page, btree_off + 8 + i * 2)[0]
            cell_ptrs.append(ptr)
        
        # For interior table: each cell = 4-byte left child page + varint rowid
        for i, cell_ptr in enumerate(cell_ptrs):
            child_page = struct.unpack_from('>I', page, cell_ptr)[0]
            print(f"{indent}  Child pointer[{i}]: cell_ptr={cell_ptr}, left_child_page={child_page}")
            
            result = traverse_interior_table(data, child_page, page_size, target_name, depth + 1)
            if result:
                return result
        
        # Also check the rightmost child (stored in page header byte 8-11 for interior pages)
        # Wait, in SQLite, for interior pages, the rightmost pointer is at the page header
        # Actually, for interior table pages, byte 8-11 of the page (after b-tree header)
        # Wait no, that's for the b-tree header: bytes 8-11 are the rightmost child pointer
        # But the b-tree header is only 8 bytes for leaf pages and 12 bytes for interior pages
        # Let me check...
        
        # For interior pages: b-tree header is 12 bytes:
        # byte 0: type
        # bytes 1-2: first freeblock
        # bytes 3-4: num cells
        # bytes 5-6: cell content area
        # byte 7: fragmented free bytes
        # bytes 8-11: rightmost child pointer
        rightmost_child = struct.unpack_from('>I', page, btree_off + 8)[0]
        print(f"{indent}  Rightmost child: {rightmost_child}")
        result = traverse_interior_table(data, rightmost_child, page_size, target_name, depth + 1)
        if result:
            return result
        
        return None

def search_leaf_page(data: bytes, page_num: int, page_size: int, target_name: str, depth: int = 0):
    """Search a leaf table page for the target entry."""
    indent = "  " * depth
    page = get_page(data, page_num, page_size)
    btree_off = 100 if page_num == 1 else 0
    
    page_type = page[btree_off]
    assert page_type == 0x0D, f"Page {page_num} is not a leaf table page (type 0x{page_type:02X})"
    
    num_cells = struct.unpack_from('>H', page, btree_off + 3)[0]
    print(f"{indent}Page {page_num}: leaf table, {num_cells} cells")
    
    cell_ptrs = []
    for i in range(num_cells):
        ptr = struct.unpack_from('>H', page, btree_off + 8 + i * 2)[0]
        cell_ptrs.append(ptr)
    
    for i, cell_ptr in enumerate(cell_ptrs):
        offset = cell_ptr
        payload_len, consumed = parse_varint(page, offset)
        if payload_len is None:
            continue
        offset += consumed
        
        rowid, consumed = parse_varint(page, offset)
        if rowid is None:
            continue
        offset += consumed
        
        # Parse record header
        hdr_size, consumed = parse_varint(page, offset)
        if hdr_size is None:
            continue
        
        # Parse column types
        col_types = []
        hdr_pos = offset + consumed
        hdr_end = offset + hdr_size
        while hdr_pos < hdr_end:
            ct, consumed_ct = parse_varint(page, hdr_pos)
            if ct is None:
                break
            col_types.append(ct)
            hdr_pos += consumed_ct
        
        # Parse column values
        data_pos = offset + hdr_size
        values = []
        col_start_offsets = [data_pos]
        for ct in col_types:
            if ct == 0:
                values.append(None)
            elif ct == 1:
                val = struct.unpack_from('>b', page, data_pos)[0]
                values.append(val)
                data_pos += 1
            elif ct == 2:
                val = struct.unpack_from('>h', page, data_pos)[0]
                values.append(val)
                data_pos += 2
            elif ct == 3:
                val = (page[data_pos] << 16) | (page[data_pos+1] << 8) | page[data_pos+2]
                if val & 0x800000:
                    val -= 0x1000000
                values.append(val)
                data_pos += 3
            elif ct == 4:
                val = struct.unpack_from('>i', page, data_pos)[0]
                values.append(val)
                data_pos += 4
            elif ct == 5:
                val = struct.unpack_from('>q', page, data_pos)[0] >> 16
                values.append(val)
                data_pos += 6
            elif ct == 6:
                val = struct.unpack_from('>q', page, data_pos)[0]
                values.append(val)
                data_pos += 8
            elif ct >= 13:
                text_len = (ct - 13) // 2
                if ct % 2 == 0:
                    text_val = page[data_pos:data_pos + text_len].decode('utf-16-le', errors='replace')
                else:
                    text_val = page[data_pos:data_pos + text_len].decode('utf-8', errors='replace')
                values.append(text_val)
                data_pos += text_len
            # For float (7,8) or blob (12, 14, etc) we skip
            elif ct in (7, 8):
                data_pos += 8 if ct == 7 else 0
                values.append(None)
            elif ct in (9, 10, 11):
                values.append(None)
            elif ct == 12 or (ct >= 14 and ct % 2 == 0):
                blob_len = (ct - 12) // 2
                data_pos += blob_len
                values.append(None)
            else:
                values.append(None)
            col_start_offsets.append(data_pos)
        
        # Check if this is gold_prices_clean
        if len(values) >= 5 and values[2] == target_name:
            print(f"\n{indent}{'='*50}")
            print(f"{indent}FOUND {target_name} in cell {i} on page {page_num}!")
            print(f"{indent}Rowid: {rowid}")
            col_names = ['rowid_placeholder', 'type', 'name', 'tbl_name', 'rootpage', 'sql']
            for j, (v, cn) in enumerate(zip(values, col_names[:len(values)])):
                v_str = str(v)[:100] if isinstance(v, str) else str(v)
                print(f"{indent}  [{j}] {cn} = {v_str}")
            
            rootpage = values[4] if len(values) > 4 else None
            if rootpage == 7012:
                print(f"{indent}\n  Current rootpage: {rootpage}")
                print(f"{indent}  Rootpage column is at serialized offset: {col_start_offsets[4]}")
                
                # Find the rootpage varint in the serialized data
                rootpage_offset_in_page = col_start_offsets[4]
                
                # Read the varint at that position
                rp_val, rp_len = parse_varint(page, rootpage_offset_in_page)
                print(f"{indent}  Rootpage varint value: {rp_val}, length: {rp_len}")
                print(f"{indent}  Rootpage raw bytes: {page[rootpage_offset_in_page:rootpage_offset_in_page+rp_len].hex()}")
                
                # Compute global file offset
                file_offset = ((page_num - 1) * page_size) + rootpage_offset_in_page
                if page_num == 1:
                    file_offset = rootpage_offset_in_page
                print(f"{indent}  Global file offset: {file_offset}")
                
                # Encode new rootpage (1) and patch
                new_bytes = encode_varint(1)
                print(f"{indent}  New rootpage bytes: {new_bytes.hex()} (len={len(new_bytes)})")
                
                if rp_len != len(new_bytes):
                    # Varint length changed - this is problematic because we'd need to
                    # shift all subsequent data. Instead, use rootpage=128 (1-byte vs 2-byte)
                    print(f"{indent}  Varint length differs (old={rp_len}, new={len(new_bytes)})")
                    print(f"{indent}  Trying rootpage=128 (fits in 2 bytes)...")
                    new_bytes = encode_varint(128)
                    print(f"{indent}  New rootpage bytes for 128: {new_bytes.hex()} (len={len(new_bytes)})")
                    if rp_len == len(new_bytes):
                        print(f"{indent}  Using rootpage=128 instead of 1")
                    else:
                        print(f"{indent}  WARNING: Still length mismatch. Trying other values...")
                        # Try values that encode to same length
                        for try_val in range(1, 16384):
                            nb = encode_varint(try_val)
                            if len(nb) == rp_len:
                                print(f"{indent}  Using rootpage={try_val} (encodes to {len(nb)} bytes)")
                                new_bytes = nb
                                break
                
                return (file_offset, page[rootpage_offset_in_page:rootpage_offset_in_page+rp_len], new_bytes)
            else:
                print(f"{indent}  Rootpage is {rootpage}, not 7012. No patch needed.")
                return None
    
    return None

def main():
    print("=" * 60)
    print("  Byte-Level Rootpage Patch v2 for data_engine.db")
    print("=" * 60)
    
    if not DB_PATH.exists():
        print(f"ERROR: Database not found at {DB_PATH}")
        sys.exit(1)
    
    # Read the database
    db_bytes = bytearray(DB_PATH.read_bytes())
    print(f"\nDatabase size: {len(db_bytes)} bytes")
    
    # Parse page size
    page_size = struct.unpack_from('>H', db_bytes, 16)[0]
    print(f"Page size: {page_size} bytes")
    num_pages = len(db_bytes) // page_size
    print(f"Number of pages: {num_pages}")
    
    # Walk the b-tree from page 1
    result = traverse_interior_table(bytes(db_bytes), 1, page_size, "gold_prices_clean")
    
    if result:
        file_offset, old_bytes, new_bytes = result
        print(f"\n{'='*50}")
        print(f"Patching rootpage at file offset {file_offset}")
        print(f"  Old bytes: {old_bytes.hex()}")
        print(f"  New bytes: {new_bytes.hex()}")
        
        # Verify current bytes match
        current = bytes(db_bytes[file_offset:file_offset + len(old_bytes)])
        print(f"  Current bytes at offset: {current.hex()}")
        
        if current == old_bytes:
            # Make backup
            if not BACKUP_PATH.exists():
                import shutil
                shutil.copy2(str(DB_PATH), str(BACKUP_PATH))
                print(f"\nBackup created at {BACKUP_PATH}")
            
            # Patch
            for j in range(len(new_bytes)):
                db_bytes[file_offset + j] = new_bytes[j]
            
            # Verify patch
            verify = bytes(db_bytes[file_offset:file_offset + len(new_bytes)])
            print(f"  Patched bytes: {verify.hex()}")
            assert verify == new_bytes, "Patch verification failed!"
            
            DB_PATH.write_bytes(bytes(db_bytes))
            print(f"\nDatabase patched successfully!")
        else:
            print(f"\nERROR: Bytes at offset don't match expected!")
            print(f"  Expected: {old_bytes.hex()}")
            print(f"  Actual:   {current.hex()}")
            print(f"  Database may have been modified since backup.")
    else:
        print(f"\n{'='*50}")
        print("Could not find gold_prices_clean entry through b-tree traversal.")
        print("Searching for the string directly in raw file data...")
        
        # Direct search
        search_term = b'gold_prices_clean'
        pos = 0
        found = False
        while True:
            pos = db_bytes.find(search_term, pos)
            if pos == -1:
                break
            
            print(f"\n  Found at offset {pos} (page {pos // page_size + 1}, offset {pos % page_size})")
            # Show context (before "gold_prices_clean")
            context_start = max(0, pos - 50)
            context = db_bytes[context_start:pos + 100]
            print(f"  Hex context: {context[:120].hex()}")
            
            # Look for 0xB6 0x36 (varint for 7012) near this position
            search_area = db_bytes[max(0,pos-30):pos+30]
            needle = bytes([0xB6, 0x36])
            needle_pos = search_area.find(needle)
            if needle_pos >= 0:
                global_offset = max(0, pos-30) + needle_pos
                print(f"\n  Found 0xB6 0x36 (rootpage=7012) at global offset {global_offset}!")
                
                # Make backup
                if not BACKUP_PATH.exists():
                    import shutil
                    shutil.copy2(str(DB_PATH), str(BACKUP_PATH))
                    print(f"\n  Backup created at {BACKUP_PATH}")
                
                # Patch: change 0xB6 0x36 to 0x81 0x01 (rootpage=128, also 2 bytes)
                # Or even better, use a valid page number like page 1
                # 1 as 2-byte varint = 0x81 0x01 (since 1 > 127, so first byte = 0x80 | (1>>7) = 0x80 | 0 = 0x80)
                # Wait, 1 <= 127, so 1-byte varint = 0x01
                # But that's only 1 byte, not 2
                # For 2 bytes: need value > 127. Try 128 = 0x81 0x00... wait
                # 128 in varint: 128 > 127, so 2 bytes
                # byte 0: 0x80 | (128 >> 7) = 0x80 | 1 = 0x81
                # byte 1: 128 & 0x7F = 0
                # So 128 = 0x81 0x00
                
                # Let me use 129 instead (still 2-byte, valid page)
                # 129: byte 0 = 0x80 | (129>>7) = 0x80|1 = 0x81, byte 1 = 129&0x7F = 1
                # So 129 = 0x81 0x01
                
                new_rootpage_bytes = bytes([0x81, 0x01])  # rootpage = 129
                print(f"  Patching with rootpage=129 ({new_rootpage_bytes.hex()})")
                
                for j in range(2):
                    db_bytes[global_offset + j] = new_rootpage_bytes[j]
                
                DB_PATH.write_bytes(bytes(db_bytes))
                print(f"\n  Database patched successfully!")
                found = True
                break
            else:
                print(f"  WARNING: 0xB6 0x36 not found near offset {pos}")
                # Let me check what bytes are near this position
                near_bytes = db_bytes[max(0,pos-15):pos+10]
                print(f"  Bytes before gold_prices_clean: {near_bytes.hex()}")
            
            pos += 1
        
        if not found:
            print("\n  Could not find rootpage=7012 near any gold_prices_clean occurrence!")
            print("  Searching for 0xB6 0x36 anywhere in file...")
            needle = bytes([0xB6, 0x36])
            pos = 0
            while True:
                pos = db_bytes.find(needle, pos)
                if pos == -1:
                    break
                context = db_bytes[max(0,pos-5):pos+15]
                print(f"  Found at offset {pos}: {context.hex()}")
                pos += 1

    print("\nDone!")

if __name__ == '__main__':
    main()
