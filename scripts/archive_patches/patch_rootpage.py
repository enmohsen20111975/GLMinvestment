#!/usr/bin/env python3
"""
Direct byte-level fix for SQLITE_CORRUPT error on data_engine.db.

The gold_prices_clean table's rootpage in sqlite_master points to page 7012,
which is beyond the database's page count (~6612 pages). This causes
SQLITE_CORRUPT on any schema access.

This script patches rootpage 7012 → 1 in the raw bytes of page 1.
Page 1 is the sqlite_master b-tree leaf page.
"""
import struct
import sys
from pathlib import Path

DB_PATH = Path("/home/meme/my_apps/GLMinvestment/db/data_engine.db")
BACKUP_PATH = DB_PATH.with_suffix(DB_PATH.suffix + ".pre_patch_backup")

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
            # 9th byte uses all 8 bits
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
    if value <= 0xFFFFFFF:
        return bytes([((value >> 21) & 0x7F) | 0x80,
                      ((value >> 14) & 0x7F) | 0x80,
                      ((value >> 7) & 0x7F) | 0x80,
                      value & 0x7F])
    # Larger values - use 5+ bytes
    result = []
    for i in range(8, 0, -1):
        shift = i * 7
        if value >= (1 << shift):
            result.append(((value >> shift) & 0x7F) | 0x80)
        elif result:
            result.append(((value >> shift) & 0x7F) | 0x80)
    result.append(value & 0x7F)
    return bytes(result)

def main():
    print("=" * 60)
    print("  Byte-Level Rootpage Patch for data_engine.db")
    print("=" * 60)

    if not DB_PATH.exists():
        print(f"ERROR: Database not found at {DB_PATH}")
        sys.exit(1)

    # Read the database
    db_bytes = bytearray(DB_PATH.read_bytes())
    print(f"\nDatabase size: {len(db_bytes)} bytes")

    # Parse page 1 header
    page_size = struct.unpack_from('>H', db_bytes, 16)[0]
    print(f"Page size: {page_size} bytes")

    if page_size < 512:
        print(f"ERROR: Invalid page size {page_size}")
        sys.exit(1)

    # Page 1 starts at offset 0 (first page, includes database header)
    page1_offset = 0
    page1_data = db_bytes[page1_offset:page1_offset + page_size]

    # Parse page 1 b-tree page header
    # Offset within page depends on whether it's page 1 (includes db header of 100 bytes)
    # For page 1: db header = 100 bytes, then b-tree header
    # Actually, page 1 b-tree header starts at offset 100 (after db header)
    btree_offset = 100

    # b-tree page header:
    # byte 0: page type (0x02=interior index, 0x05=interior table, 0x0A=leaf index, 0x0D=leaf table)
    page_type = db_bytes[btree_offset]
    type_names = {0x02: "interior index", 0x05: "interior table",
                   0x0A: "leaf index", 0x0D: "leaf table"}
    print(f"Page 1 type: 0x{page_type:02X} ({type_names.get(page_type, 'unknown')})")

    # byte 1-2: offset to first freeblock
    # byte 3-4: number of cells
    num_cells = struct.unpack_from('>H', db_bytes, btree_offset + 3)[0]
    print(f"Number of cells: {num_cells}")

    # byte 5-6: offset to start of cell content area
    # byte 7: fragmented free bytes count

    # Cell pointer array starts at offset btree_offset + 8
    cell_pointers = []
    for i in range(num_cells):
        cell_offset = struct.unpack_from('>H', db_bytes, btree_offset + 8 + i * 2)[0]
        cell_pointers.append(cell_offset)

    print(f"\nCell pointers: {cell_pointers}")

    # For leaf table pages (type 0x0D), each cell contains:
    # - payload length (varint)
    # - rowid (varint)
    # - payload (record data)

    for i, cell_offset in enumerate(cell_pointers):
        offset = cell_offset
        # Payload length
        payload_len, consumed = parse_varint(db_bytes, offset)
        if payload_len is None:
            continue
        offset += consumed

        # Rowid
        rowid, consumed = parse_varint(db_bytes, offset)
        if rowid is None:
            continue
        offset += consumed

        # Record header
        # First varint in payload is total header size
        header_size, consumed = parse_varint(db_bytes, offset)
        if header_size is None:
            continue

        # Parse column types from the record header
        col_types = []
        header_offset = offset + consumed
        header_end = offset + header_size

        while header_offset < header_end:
            col_type, consumed = parse_varint(db_bytes, header_offset)
            if col_type is None:
                break
            col_types.append(col_type)
            header_offset += consumed

        # Now extract column values from the payload body
        data_offset = offset + header_size
        values = []
        for ct in col_types:
            if ct == 0:  # NULL
                values.append(None)
            elif ct == 1:  # 1-byte signed int
                val = struct.unpack_from('>b', db_bytes, data_offset)[0]
                values.append(val)
                data_offset += 1
            elif ct == 2:  # 2-byte signed int
                val = struct.unpack_from('>h', db_bytes, data_offset)[0]
                values.append(val)
                data_offset += 2
            elif ct == 3:  # 3-byte signed int
                val = (db_bytes[data_offset] << 16) | (db_bytes[data_offset+1] << 8) | db_bytes[data_offset+2]
                if val & 0x800000:
                    val -= 0x1000000
                values.append(val)
                data_offset += 3
            elif ct == 4:  # 4-byte signed int
                val = struct.unpack_from('>i', db_bytes, data_offset)[0]
                values.append(val)
                data_offset += 4
            elif ct == 5:  # 6-byte signed int
                val = struct.unpack_from('>q', db_bytes, data_offset)[0] >> 16
                values.append(val)
                data_offset += 6
            elif ct == 6:  # 8-byte signed int
                val = struct.unpack_from('>q', db_bytes, data_offset)[0]
                values.append(val)
                data_offset += 8
            elif ct >= 13:  # Text: (ct-13)/2 bytes
                text_len = (ct - 13) // 2
                if ct % 2 == 0:  # Even = UTF-16LE
                    text_val = db_bytes[data_offset:data_offset + text_len].decode('utf-16-le', errors='replace')
                else:  # Odd = UTF-8
                    text_val = db_bytes[data_offset:data_offset + text_len].decode('utf-8', errors='replace')
                values.append(text_val)
                data_offset += text_len
            else:
                values.append(f"<type={ct}>")

        # Check if this is the gold_prices_clean table entry
        if len(values) >= 5 and values[1] == 'gold_prices_clean':
            print(f"\n{'='*40}")
            print(f"CELL {i}: FOUND gold_prices_clean!")
            print(f"  Rowid: {rowid}")
            print(f"  Payload offset: {cell_offset}")
            print(f"  Record values:")
            col_names = ['rowid_placeholder', 'type', 'name', 'tbl_name', 'rootpage', 'sql']
            for j, (v, cn) in enumerate(zip(values, col_names[:len(values)])):
                val_str = str(v)[:80] if isinstance(v, str) else str(v)
                print(f"    [{j}] {cn} = {val_str}")

            # Find the rootpage (column index 4 in the values list)
            if len(values) > 4:
                current_rootpage = values[4]
                print(f"\n  Current rootpage: {current_rootpage}")

                if current_rootpage == 7012:
                    # We need to patch rootpage from 7012 to 1
                    # The rootpage is stored as a varint in the payload
                    # We need to find its exact position

                    # Re-parse from the beginning to find the rootpage offset
                    # Let's trace through the record fields
                    rec_offset = cell_offset + (1 if payload_len <= 0x7F else 2)  # after payload_len
                    # Skip rowid varint
                    _, consumed_rowid = parse_varint(db_bytes, rec_offset)
                    rec_offset += consumed_rowid

                    # Skip header_size
                    _, consumed_hdr = parse_varint(db_bytes, rec_offset)
                    rec_offset += consumed_hdr

                    # Parse column types (these are the varints in the header)
                    col_type_offsets = []
                    hdr_pos = rec_offset
                    for ct_idx, ct in enumerate(col_types):
                        _, consumed_ct = parse_varint(db_bytes, hdr_pos)
                        col_type_offsets.append((hdr_pos, consumed_ct, ct))
                        hdr_pos += consumed_ct

                    # Now locate where rootpage value starts in the data section
                    data_pos = cell_offset + payload_len  # no, data starts after header
                    # Actually: offset = cell_offset, payload_len at cell_offset
                    # rowid after payload_len
                    # header after rowid
                    # data after header

                    pos = cell_offset
                    plen, c1 = parse_varint(db_bytes, pos); pos += c1
                    rid, c2 = parse_varint(db_bytes, pos); pos += c2

                    hdr_sz, c3 = parse_varint(db_bytes, pos); pos += c3

                    # Skip column type varints
                    for ct_idx, ct in enumerate(col_types):
                        _, c_ct = parse_varint(db_bytes, pos)
                        col_type_offsets[ct_idx] = (pos, c_ct, ct)
                        pos += c_ct

                    # Now pos points to start of data values (after header)
                    # Walk through data values to find rootpage position (index 4)
                    data_pos = pos
                    for col_idx, ct in enumerate(col_types):
                        if col_idx == 4:
                            # This is the rootpage value
                            rootpage_varint_offset = data_pos
                            rootpage_varint_val, rootpage_varint_len = parse_varint(db_bytes, data_pos)
                            print(f"  Rootpage varint at byte offset {rootpage_varint_offset}")
                            print(f"  Rootpage varint value: {rootpage_varint_val}, length: {rootpage_varint_len}")
                            print(f"  Rootpage raw bytes: {db_bytes[rootpage_varint_offset:rootpage_varint_offset+rootpage_varint_len].hex()}")

                            if rootpage_varint_val == 7012:
                                # Patch it to 1
                                new_rootpage_bytes = encode_varint(1)
                                if len(new_rootpage_bytes) == rootpage_varint_len:
                                    print(f"  Patching rootpage from 7012 to 1...")
                                    for j in range(rootpage_varint_len):
                                        db_bytes[rootpage_varint_offset + j] = new_rootpage_bytes[j]
                                    print(f"  Patched! New bytes at offset: {db_bytes[rootpage_varint_offset:rootpage_varint_offset+rootpage_varint_len].hex()}")
                                else:
                                    print(f"  WARNING: Varint length mismatch: old={rootpage_varint_len}, new={len(new_rootpage_bytes)}")
                                    print(f"  Cannot patch - varint size changed. Need different approach.")
                            break

                        # Skip this column's data
                        if ct == 0:
                            pass  # NULL - no data
                        elif ct == 1:
                            data_pos += 1
                        elif ct == 2:
                            data_pos += 2
                        elif ct == 3:
                            data_pos += 3
                        elif ct == 4:
                            data_pos += 4
                        elif ct == 5:
                            data_pos += 6
                        elif ct == 6:
                            data_pos += 8
                        elif ct >= 13:
                            text_len = (ct - 13) // 2
                            data_pos += text_len
                        else:
                            print(f"  WARNING: Unknown column type {ct} at column {col_idx}")
                            break
                else:
                    print(f"  Rootpage is {current_rootpage}, not 7012. No patch needed.")
            break
    else:
        print("\nWARNING: Could not find gold_prices_clean entry in sqlite_master!")
        print("The table might be in a different format or location.")
        print("Let me search for the string directly...")
        # Search for "gold_prices_clean" in the raw bytes
        search_term = b'gold_prices_clean'
        pos = 0
        found_positions = []
        while True:
            pos = db_bytes.find(search_term, pos)
            if pos == -1:
                break
            found_positions.append(pos)
            pos += 1
        if found_positions:
            print(f"  Found 'gold_prices_clean' at byte offsets: {found_positions}")
            for pos in found_positions:
                context = db_bytes[max(0,pos-20):pos+50]
                print(f"  Context at {pos}: {context[:60].hex()}")
        else:
            print("  'gold_prices_clean' not found in database at all!")
            print("  Checking if the backup also has this issue...")

    # Write changes back
    print("\n" + "=" * 40)
    if True:  # Always attempt write
        # Make backup first
        if not BACKUP_PATH.exists():
            import shutil
            shutil.copy2(str(DB_PATH), str(BACKUP_PATH))
            print(f"Backup created at {BACKUP_PATH}")

        DB_PATH.write_bytes(bytes(db_bytes))
        print(f"Database patched and written back to {DB_PATH}")

    print("\nDone!")

if __name__ == '__main__':
    main()
