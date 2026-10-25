#!/usr/bin/env python3
"""
Final fix: patch both gold_prices_clean (7012) and its autoindex (7013) 
to truly unused pages. Includes page 1 in the used set since sqlite_master 
uses it.
"""
import struct
from pathlib import Path

DB_PATH = Path("/home/meme/my_apps/GLMinvestment/db/data_engine.db")
BACKUP_PATH = Path(str(DB_PATH) + ".pre_patch_v6")

def get_page(data: bytes, pn: int, ps: int) -> bytes:
    if pn < 1 or (pn - 1) * ps >= len(data):
        return None
    return data[(pn - 1) * ps:(pn - 1) * ps + ps]

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

def find_all_used_pages(data: bytes, page_size: int, num_pages: int) -> set:
    """
    Find all pages used by any b-tree by scanning rootpages from sqlite_master
    and then recursively following b-tree pointers.
    """
    used = set()
    used.add(1)  # sqlite_master root
    
    # Step 1: Get all rootpages from sqlite_master
    def traverse_sm(pn: int) -> list:
        results = []
        page = get_page(data, pn, page_size)
        if page is None:
            return results
        b_off = 100 if pn == 1 else 0
        pt = page[b_off]
        nc = struct.unpack_from('>H', page, b_off + 3)[0]
        hs = 12 if pt in (0x05, 0x02) else 8
        
        if pt == 0x0D:
            for i in range(nc):
                cp = struct.unpack_from('>H', page, b_off + hs + i * 2)[0]
                off = cp
                pl, c1 = parse_varint(page, off)
                if pl is None: continue
                off += c1
                rid, c2 = parse_varint(page, off)
                if rid is None: continue
                off += c2
                hs2, c3 = parse_varint(page, off)
                if hs2 is None: continue
                
                ctypes = []
                hp = off + c3
                he = off + hs2
                while hp < he:
                    ct, cct = parse_varint(page, hp)
                    if ct is None: break
                    ctypes.append(ct)
                    hp += cct
                
                dp = off + hs2
                vals = []
                for ct in ctypes:
                    if ct == 0: vals.append(None)
                    elif ct == 1: vals.append(page[dp]); dp += 1
                    elif ct == 2: vals.append(struct.unpack_from('>h', page, dp)[0]); dp += 2
                    elif ct == 3: vals.append((page[dp]<<16)|(page[dp+1]<<8)|page[dp+2]); dp += 3
                    elif ct == 4: vals.append(struct.unpack_from('>i', page, dp)[0]); dp += 4
                    elif ct >= 13:
                        tl = (ct - 13) // 2
                        vals.append(page[dp:dp+tl].decode('utf-8', errors='replace'))
                        dp += tl
                    else: dp += [0,1,2,3,4,6,8,8,0,0,0,0][ct] if ct <= 11 else 0; vals.append(None)
                
                if len(vals) >= 4:
                    results.append((vals[1], int(vals[3]) if vals[3] is not None else 0, vals[2]))
        elif pt == 0x05:
            for i in range(nc):
                cp = struct.unpack_from('>H', page, b_off + hs + i * 2)[0]
                child = struct.unpack_from('>I', page, cp)[0]
                results.extend(traverse_sm(child))
            rc = struct.unpack_from('>I', page, b_off + 8)[0]
            results.extend(traverse_sm(rc))
        return results
    
    tables = traverse_sm(1)
    print(f"\nFound {len(tables)} entries in sqlite_master")
    
    rootpages = set()
    for name, rp, tp in tables:
        rootpages.add(rp)
        print(f"  {name:40s} rp={rp:5d} {tp}")
    
    # Also add free list pages
    # Page 1 header: bytes 32-35 = first freelist trunk page
    fl_trunk = struct.unpack_from('>I', data, 32)[0]
    print(f"\nFreelist trunk page: {fl_trunk}")
    
    # Follow freelist trunk chain
    fl_pages = set()
    if fl_trunk and fl_trunk <= num_pages:
        pages_to_check = [fl_trunk]
        while pages_to_check:
            tp = pages_to_check.pop(0)
            if tp in fl_pages:
                continue
            fl_pages.add(tp)
            pg = get_page(data, tp, page_size)
            if pg is None:
                continue
            # Freelist trunk: bytes 0-3 = next trunk, bytes 4-7 = num leaf pages
            num_leaf = struct.unpack_from('>I', pg, 4)[0]
            for i in range(int(num_leaf)):
                lp = struct.unpack_from('>I', pg, 8 + i * 4)[0]
                fl_pages.add(lp)
            next_trunk = struct.unpack_from('>I', pg, 0)[0]
            if next_trunk:
                pages_to_check.append(next_trunk)
    
    print(f"Freelist pages: {sorted(fl_pages) if fl_pages else 'none'}")
    
    all_used = rootpages | fl_pages | {1}
    print(f"\nAll used pages: {sorted(all_used)}")
    print(f"Total used: {len(all_used)}")
    
    return all_used, tables

def find_free_patch_sites(tables: list) -> dict:
    """Find the pages that need patching and what to patch them to."""
    patches = {}
    for name, rp, tp in tables:
        if rp == 7012:
            patches['table'] = name
        if rp == 7013:
            patches['index'] = name
    return patches

def main():
    print("=" * 60)
    print("  Rootpage Patch v6 - Final")
    print("=" * 60)
    
    # Restore from earliest clean backup
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
    print(f"Database: {len(db_bytes)} bytes, {page_size} bytes/page, {num_pages} pages")
    
    # Find all used pages
    all_used, tables = find_all_used_pages(bytes(db_bytes), page_size, num_pages)
    
    # Find candidate free pages
    free_pages = sorted(set(range(1, num_pages + 1)) - all_used)
    print(f"\nFree pages: {len(free_pages)} available")
    print(f"First 10 free: {free_pages[:10]}")
    print(f"Last 10 free: {free_pages[-10:] if len(free_pages) > 10 else free_pages}")
    
    # Patch both rootpages to free pages
    patches_needed = find_free_patch_sites(tables)
    print(f"\nPatches needed: {patches_needed}")
    
    if not patches_needed:
        print("No patches needed - database might already be fixed!")
        return
    
    import shutil
    shutil.copy2(str(DB_PATH), str(BACKUP_PATH))
    print(f"Backup: {BACKUP_PATH}")
    
    free_idx = 0
    for key in ['table', 'index']:
        if key not in patches_needed:
            continue
        
        # Find a free page
        while free_idx < len(free_pages) and free_pages[free_idx] in all_used:
            free_idx += 1
        if free_idx >= len(free_pages):
            print(f"ERROR: No free pages left!")
            return
        
        new_rp = free_pages[free_idx]
        free_idx += 1
        
        if key == 'table':
            # Find and patch "gold_prices_clean" + "gold_prices_clean" + 0x1B64
            nb = b'gold_prices_clean'
            pattern = nb + nb + bytes([0x1B, 0x64])
            pos = db_bytes.find(pattern)
            if pos >= 0:
                rp_off = pos + len(nb) * 2
                old_val = struct.unpack_from('>H', db_bytes, rp_off)[0]
                struct.pack_into('>H', db_bytes, rp_off, new_rp)
                print(f"TABLE: gold_prices_clean rp {old_val} → {new_rp} (page {new_rp})")
            else:
                print(f"ERROR: Could not find TABLE entry to patch!")
        else:
            # Find and patch autoindex
            # Pattern: "sqlite_autoindex_gold_prices_clean_1" + "gold_prices_clean" + 0x1B65
            idx_name = b'sqlite_autoindex_gold_prices_clean_1'
            tbl_name = b'gold_prices_clean'
            pattern = idx_name + tbl_name + bytes([0x1B, 0x65])
            pos = db_bytes.find(pattern)
            if pos >= 0:
                rp_off = pos + len(idx_name) + len(tbl_name)
                old_val = struct.unpack_from('>H', db_bytes, rp_off)[0]
                struct.pack_into('>H', db_bytes, rp_off, new_rp)
                print(f"INDEX: sqlite_autoindex_gold_prices_clean_1 rp {old_val} → {new_rp} (page {new_rp})")
            else:
                print(f"ERROR: Could not find INDEX entry to patch!")
    
    DB_PATH.write_bytes(bytes(db_bytes))
    print(f"\n✓ Database written to {DB_PATH}")

if __name__ == '__main__':
    main()
