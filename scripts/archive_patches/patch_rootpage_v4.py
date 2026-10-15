#!/usr/bin/env python3
"""
Fix data_engine.db corruption by patching gold_prices_clean rootpage at byte level.

The rootpage for gold_prices_clean is stored as a 2-byte big-endian integer
(serial type 2 in SQLite record format). Value 0x1B64 = 7012.
We need to change it to a valid page number (e.g., 1 = 0x0001).

Strategy: Search for the raw bytes 0x1B 0x64 that appear right after the
"gold_prices_clean" table name in the sqlite_master record, and change
them to a valid page number (keeping the same serial type = 2-byte int).
"""
import struct
from pathlib import Path

DB_PATH = Path("/home/meme/my_apps/GLMinvestment/db/data_engine.db")
BACKUP_PATH = Path(str(DB_PATH) + ".pre_patch_v4")

def encode_varint(value: int) -> bytes:
    """Encode an integer as a SQLite varint."""
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
    print("  Rootpage Patch v4 - Direct 2-byte integer patch")
    print("=" * 60)
    
    # Restore from clean backup first
    backup_v3 = Path(str(DB_PATH) + ".pre_patch_v3")
    backup_v2 = Path(str(DB_PATH) + ".pre_patch_v2")
    backup_v1 = Path(str(DB_PATH) + ".pre_patch_backup")
    
    for b in [backup_v1, backup_v2, backup_v3]:
        if b.exists():
            print(f"Restoring from {b.name}...")
            import shutil
            shutil.copy2(str(b), str(DB_PATH))
            break
    
    db_bytes = bytearray(DB_PATH.read_bytes())
    page_size = struct.unpack_from('>H', db_bytes, 16)[0]
    print(f"Database: {len(db_bytes)} bytes, page_size={page_size}")
    
    # Strategy 1: Search for "gold_prices_clean" followed by the 2-byte rootpage
    # In the record, the schema is: type='table', name='gold_prices_clean', 
    # tbl_name='gold_prices_clean', rootpage=<2-byte int>, sql='CREATE TABLE...'
    # After the second "gold_prices_clean" string, the next 2 bytes are rootpage
    
    # Search for: "gold_prices_clean" + "gold_prices_clean" + <rootpage as 2-byte int>
    name_bytes = b'gold_prices_clean'
    
    # Pattern: after the second occurrence of "gold_prices_clean", rootpage is 0x1B64
    target_value = 7012  # 0x1B64
    new_value = 1        # 0x0001 (page 1, which is sqlite_master - valid)
    
    # Search for "gold_prices_clean" concatenated with itself (name + tbl_name)
    # This is followed by 0x1B64 (rootpage) in the TABLE entry
    pattern = name_bytes + name_bytes + bytes([0x1B, 0x64])
    
    pos = db_bytes.find(pattern)
    if pos >= 0:
        print(f"\nFound TABLE entry at offset {pos}")
        rootpage_offset = pos + len(name_bytes) * 2
        print(f"Rootpage at offset {rootpage_offset}")
        
        # Verify the bytes
        rp_bytes = db_bytes[rootpage_offset:rootpage_offset+2]
        rp_value = struct.unpack_from('>H', rp_bytes, 0)[0]
        print(f"Rootpage bytes: {rp_bytes.hex()} = {rp_value}")
        
        if rp_value == target_value:
            import shutil
            shutil.copy2(str(DB_PATH), str(BACKUP_PATH))
            print(f"Backup: {BACKUP_PATH}")
            
            # Write new 2-byte value
            new_rp = struct.pack('>H', new_value)
            db_bytes[rootpage_offset] = new_rp[0]
            db_bytes[rootpage_offset+1] = new_rp[1]
            
            # Verify
            verify = struct.unpack_from('>H', db_bytes, rootpage_offset)[0]
            print(f"Patched rootpage: {verify}")
            assert verify == new_value
            
            DB_PATH.write_bytes(bytes(db_bytes))
            print("✓ Database patched!")
        else:
            print(f"Unexpected rootpage value: {rp_value}")
    else:
        print("Pattern (name+name+0x1B64) not found.")
        print("Searching for individual occurrences...")
        
        # Search for all occurrences of gold_prices_clean
        pos = 0
        while True:
            pos = db_bytes.find(name_bytes, pos)
            if pos == -1:
                break
            context = db_bytes[pos:pos+80]
            print(f"\n  Offset {pos}: {context.hex()}")
            pos += 1
        
        # Also search for just 0x1B64
        print(f"\nSearching for 0x1B64 (rootpage=7012) anywhere...")
        pos = 0
        count = 0
        while count < 10:
            pos = db_bytes.find(bytes([0x1B, 0x64]), pos)
            if pos == -1:
                break
            context = db_bytes[max(0,pos-10):pos+20]
            print(f"  Offset {pos}: {context.hex()} | {context}")
            pos += 1
            count += 1

    print("\nDone!")

if __name__ == '__main__':
    main()
