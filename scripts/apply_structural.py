#!/usr/bin/env python3
"""Stitch Sovereign Terminal structural class replacement.

Applies the legacy -> Stitch mapping to a single TSX file.
- Order matters: longer/more-specific patterns first.
- Idempotent: running twice on the same file is a no-op (output classes are not in the source map).
- Case-sensitive, regex-based.
- Does NOT touch any logic, hooks, or JSX structure — only className strings.

Usage: python3 apply_structural.py <file.tsx>
"""
from __future__ import annotations
import re
import sys
from pathlib import Path


# Mapping table. Order matters: longest / most specific first to avoid partial overlaps.
# Each entry: (regex_pattern, replacement). Use word boundaries (\\b) to prevent
# substring matches inside other class names (e.g. text-slate-500 vs text-slate-5000).
MAPPING: list[tuple[str, str]] = [
    # --- Borders (do before plain border-border so /30 variant matches first) ---
    (r'\bborder-border/30\b', 'border-white/[0.06]'),
    (r'\bborder-border\b', 'border-white/[0.06]'),
    # --- Card / glass ---
    (r'\bbg-card\b', 'stitch-glass'),
    # --- Background muted variants ---
    (r'\bbg-muted/50\b', 'bg-[#182030]/50'),
    (r'\bbg-muted\b', 'bg-[#182030]'),
    # --- Main canvas (only inside main wrappers; we apply broadly — designer's call) ---
    (r'\bbg-background\b', 'stitch-canvas'),
    # --- Text colors ---
    (r'\btext-foreground\b', 'text-stitch-on-surface'),
    (r'\btext-muted-foreground\b', 'text-stitch-muted'),
    # --- Emerald -> primary ---
    (r'\btext-emerald-700\b', 'text-stitch-primary'),
    (r'\btext-emerald-600\b', 'text-stitch-primary'),
    (r'\btext-emerald-500\b', 'text-stitch-primary'),
    (r'\btext-emerald-400\b', 'text-stitch-primary'),
    (r'\bbg-emerald-900/40\b', 'bg-emerald-500/10'),
    (r'\bbg-emerald-100\b', 'bg-emerald-500/10'),
    # --- Red -> rose ---
    (r'\btext-red-600\b', 'text-rose-400'),
    (r'\btext-red-500\b', 'text-rose-400'),
    (r'\btext-red-400\b', 'text-rose-400'),
    (r'\bbg-red-500/10\b', 'bg-rose-500/10'),
    (r'\bbg-red-100\b', 'bg-rose-500/10'),
    # --- Slate backgrounds ---
    (r'\bbg-slate-50\b', 'bg-[#182030]'),
    (r'\bbg-slate-100\b', 'bg-[#182030]'),
    (r'\bbg-slate-200\b', 'bg-[#182030]'),
    (r'\bbg-slate-800\b', 'bg-[#0B0E14]'),
    (r'\bbg-slate-900\b', 'bg-[#0B0E14]'),
    # --- Slate text ---
    (r'\btext-slate-900\b', 'text-stitch-on-surface'),
    (r'\btext-slate-700\b', 'text-stitch-muted'),
    (r'\btext-slate-600\b', 'text-stitch-muted'),
    (r'\btext-slate-500\b', 'text-stitch-outline'),
    (r'\btext-slate-400\b', 'text-stitch-outline'),
    # --- Fonts ---
    (r'\bfont-mono\b', 'stitch-num'),
]


def apply_mapping(text: str) -> tuple[str, int]:
    """Apply all replacements. Return (new_text, total_replacements_count)."""
    total = 0
    for pat, rep in MAPPING:
        new_text, n = re.subn(pat, rep, text)
        total += n
        text = new_text
    return text, total


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: apply_structural.py <file.tsx>", file=sys.stderr)
        return 2
    fp = Path(argv[1])
    if not fp.is_file():
        print(f"error: file not found: {fp}", file=sys.stderr)
        return 2
    src = fp.read_text(encoding='utf-8')
    new, n = apply_mapping(src)
    if n == 0:
        print(f"[{fp.name}] no replacements made (already migrated?)")
        return 0
    fp.write_text(new, encoding='utf-8')
    print(f"[{fp.name}] applied {n} replacements")
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
