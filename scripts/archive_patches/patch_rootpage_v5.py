#!/usr/bin/env python3
"""
Find a free/unused page in the database and patch gold_prices_clean's rootpage to it.

Strategy:
1. Scan sqlite_master at byte level to find ALL table rootpages
2. Additionally scan all pages to detect which are used as b-tree root pages
3. Find a page that is NOT used as any table's rootpage
4. Patch gold_prices_clean's rootpage (currently 7012) to that free page
"""
import struct
from pathlib import Path

DB_PATH = Path("/home/meme/my_apps/GLMinvestment/db/data_engine.db")
BACKUP_PATH = Path(str(DB_PATH) + ".pre_patch_v5")

def get_page(data: bytes, page_num: int, page_size: int) -> bytes:
    if page_num < 1 or (page_num - 1) * page_size >= len(data):
        return None
    offset = (page_num - 1) * page_size
    return data[offset:offset + page_size]

def parse_varint(data: bytes, offset: int) -> tuple:
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

def main():
    print("=" * 60)
    print("  Rootpage Patch v5 - Find Free Page")
    print("=" * 60)
    
    # Restore from clean backup
    for bname in [".pre_patch_v4", ".pre_patch_backup"]:
        b = Path(str(DB_PATH) + bname)
        if b.exists():
            print(f"Restoring from {b.name}...")
            import shutil
            shutil.copy2(str(b), str(DB_PATH))
            break
    
    db_bytes = bytearray(DB_PATH.read_bytes())
    page_size = struct.unpack_from('>H', db_bytes, 16)[0]
    num_pages = len(db_bytes) // page_size
    print(f"Database: {len(db_bytes)} bytes, page_size={page_size}, pages={num_pages}")
    
    # Step 1: Traverse sqlite_master b-tree to find all table rootpages
    # Page 1 is an interior table (type 0x05) -> follow to leaf pages
    
    def traverse(page_num: int, depth: int = 0) -> list:
        """Traverse b-tree and return list of (name, rootpage) for tables."""
        results = []
        page = get_page(db_bytes, page_num, page_size)
        if page is None:
            return results
        
        btree_off = 100 if page_num == 1 else 0
        page_type = page[btree_off]
        num_cells = struct.unpack_from('>H', page, btree_off + 3)[0]
        hdr_size = 12 if page_type in (0x05, 0x02) else 8
        
        if page_type == 0x0D:  # Leaf table
            for i in range(num_cells):
                cell_ptr = struct.unpack_from('>H', page, btree_off + hdr_size + i * 2)[0]
                offset = cell_ptr
                
                plen, c1 = parse_varint(page, offset)
                if plen is None: continue
                offset += c1
                
                rowid, c2 = parse_varint(page, offset)
                if rowid is None: continue
                offset += c2
                
                hdr_sz, c3 = parse_varint(page, offset)
                if hdr_sz is None: continue
                
                # Parse column types
                col_types = []
                hdr_pos = offset + c3
                hdr_end = offset + hdr_sz
                while hdr_pos < hdr_end:
                    ct, cct = parse_varint(page, hdr_pos)
                    if ct is None: break
                    col_types.append(ct)
                    hdr_pos += cct
                
                # Extract values
                data_pos = offset + hdr_sz
                values = []
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
                    elif ct >= 13:
                        text_len = (ct - 13) // 2
                        tv = page[data_pos:data_pos+text_len].decode('utf-8', errors='replace')
                        values.append(tv)
                        data_pos += text_len
                    else:
                        data_pos += [0, 1, 2, 3, 4, 6, 8, 8, 0, 0, 0, 0][ct] if ct <= 11 else 0
                        values.append(None)
                
                # sqlite_master has columns: type, name, tbl_name, rootpage, sql
                if len(values) >= 4:
                    results.append((str(values[1]), int(values[3]) if values[3] is not None else 0, 
                                   str(values[0]), values[4] if len(values) > 4 else ""))
            
        elif page_type == 0x05:  # Interior table
            for i in range(num_cells):
                cell_ptr = struct.unpack_from('>H', page, btree_off + hdr_size + i * 2)[0]
                child_page = struct.unpack_from('>I', page, cell_ptr)[0]
                results.extend(traverse(child_page, depth + 1))
            
            # Rightmost child
            right_child = struct.unpack_from('>I', page, btree_off + 8)[0]
            results.extend(traverse(right_child, depth + 1))
        
        return results
    
    print("\n--- Scanning sqlite_master b-tree for all tables ---")
    tables = traverse(1)
    
    used_pages = set()
    for name, rootpage, tbl_type, sql in tables:
        marker = ""
        if rootpage == 7012:
            marker = " <-- BAD (page beyond file)"
        elif rootpage == 7013:
            marker = " <-- BAD (page beyond file)"
        elif rootpage <= num_pages:
            used_pages.add(rootpage)
        print(f"  {name:35s} rootpage={rootpage:5d} [{tbl_type}]{marker}")
    
    print(f"\n--- Used pages (rootpages): {sorted(used_pages)}")
    print(f"--- Total unique rootpages in use: {len(used_pages)}")
    
    # Find candidate pages - pages that exist but are NOT used as rootpages
    all_pages = set(range(1, num_pages + 1))
    free_pages = sorted(all_pages - used_pages)
    print(f"--- Free pages: {len(free_pages)} available")
    print(f"--- First few free pages: {free_pages[:20]}")
    print(f"--- Last few free pages: {free_pages[-20:] if len(free_pages) > 20 else free_pages}")
    
    # Choose page 2 as the new rootpage (usually free in most databases)
    # Or pick the first truly free page
    candidate = None
    for p in free_pages:
        if p not in used_pages and p != 1:  # Don't use sqlite_master's page
            candidate = p
            break
    
    if candidate is None:
        print("ERROR: No free pages found!")
        return
    
    print(f"\nCandidate for new gold_prices_clean rootpage: page {candidate}")
    
    # Step 2: Patch the gold_prices_clean rootpage
    name_bytes = b'gold_prices_clean'
    
    # Search for TABLE entry: "gold_prices_clean" + "gold_prices_clean" + 0x1B64
    pattern = name_bytes + name_bytes + bytes([0x1B, 0x64])
    pos = db_bytes.find(pattern)
    
    if pos >= 0:
        rootpage_offset = pos + len(name_bytes) * 2
        rp_bytes = db_bytes[rootpage_offset:rootpage_offset+2]
        rp_value = struct.unpack_from('>H', rp_bytes, 0)[0]
        print(f"\nFound TABLE entry at offset {pos}")
        print(f"Rootpage at offset {rootpage_offset}: {rp_bytes.hex()} = {rp_value}")
        
        if rp_value == 7012:
            import shutil
            shutil.copy2(str(DB_PATH), str(BACKUP_PATH))
            print(f"Backup saved to {BACKUP_PATH}")
            
            # Patch to candidate page
            new_rp = struct.pack('>H', candidate)
            db_bytes[rootpage_offset] = new_rp[0]
            db_bytes[rootpage_offset+1] = new_rp[1]
            
            verify = struct.unpack_from('>H', db_bytes, rootpage_offset)[0]
            print(f"Patched rootpage: 7012 → {verify}")
            
            if verify != candidate:
                print("ERROR: Patch verification failed!")
                return
            
            DB_PATH.write_bytes(bytes(db_bytes))
            print("✓ Database written!")
        else:
            print(f"Rootpage is {rp_value}, not 7012. Already patched?")
    
    # Step 3: Also patch the autoindex rootpage (7013) if it exists
    # The autoindex entry has name="sqlite_autoindex_gold_prices_clean_1"
    # Pattern: "sqlite_autoindex_gold_prices_clean_1" + "gold_prices_clean" + 0x1B65
    
    idx_name = b'sqlite_autoindex_gold_prices_clean_1'
    pattern2 = idx_name + name_bytes + bytes([0x1B, 0x65])
    pos2 = db_bytes.find(pattern2)
    
    if pos2 >= 0:
        rootpage_offset2 = pos2 + len(idx_name) + len(name_bytes)
        rp2 = struct.unpack_from('>H', db_bytes, rootpage_offset2)[0]
        print(f"\nFound autoindex entry: rootpage={rp2}")
        
        if rp2 == 7013:
            # Find another free page for the autoindex
            candidate2 = None
            for p in free_pages:
                if p != candidate and p not in used_pages:
                    candidate2 = p
                    break
            if candidate2:
                new_rp2 = struct.pack('>H', candidate2)
                db_bytes[rootpage_offset2] = new_rp2[0]
                db_bytes[rootpage_offset2+1] = new_rp2[1]
                print(f"Patched autoindex rootpage: 7013 → {candidate2}")
                
                DB_PATH.write_bytes(bytes(db_bytes))
                print("✓ Autoindex patched!")
    
    print("\nDone! Now verifying...")

if __name__ == '__main__':
    main()
