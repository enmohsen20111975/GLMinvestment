#!/usr/bin/env python3
"""Stitch Sovereign Terminal structural class replacement.

Applies legacy → stitch mapping via opacity-aware word-boundary regex.
Preserves dark: prefix and /N opacity modifiers.

Does NOT touch state, hooks, or JSX structure — className strings only.

Usage: python3 stitch_replace.py <file.tsx> [--dry-run]
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

# Each tuple: (legacy_class, stitch_replacement_base, kind)
# kind: 'noop' = skip (already stitch-compatible), 'replace' = apply with opacity preservation
# The regex preserves trailing opacity modifiers like '/50', '/30'.
# Order matters: noop entries first so subsequent replaces don't mangle them.
REPLACEMENTS = [
    # --- emerald bg /10 and /5 — KEEP (already stitch-compatible) ---
    ('bg-emerald-500/10', 'bg-emerald-500/10', 'noop'),
    ('bg-emerald-500/5',  'bg-emerald-500/5',  'noop'),
    # emerald bg opacity variants — convert to bg-emerald-500/(N) since stitch-compatible
    ('bg-emerald-500/20',  'bg-emerald-500/20',  'noop'),
    ('bg-emerald-500/40',  'bg-emerald-500/40',  'noop'),
    ('bg-emerald-500/70',  'bg-emerald-500/70',  'noop'),
    # --- bg-muted compound (any /N) → bg-[#182030]/N preserving opacity ---
    ('bg-muted', 'bg-[#182030]', 'replace'),
    # --- bg-card / bg-background ---
    ('bg-card',       'stitch-glass',  'replace'),
    ('bg-background', 'stitch-canvas', 'replace'),
    # --- emerald bg variants (non-500) ---
    ('bg-emerald-900', 'bg-emerald-500/10', 'replace'),  # bg-emerald-900/40 → bg-emerald-500/10
    ('bg-emerald-100', 'bg-emerald-500/10', 'replace'),
    # --- red bg variants (keep opacity if present) ---
    ('bg-red-500', 'bg-rose-500', 'replace'),
    ('bg-red-100', 'bg-rose-500/10', 'replace'),
    # --- slate bg variants (drop opacity since target is fixed hex) ---
    ('bg-slate-50',  'bg-[#182030]', 'replace'),
    ('bg-slate-100', 'bg-[#182030]', 'replace'),
    ('bg-slate-200', 'bg-[#182030]', 'replace'),
    ('bg-slate-800', 'bg-[#0B0E14]', 'replace'),
    ('bg-slate-900', 'bg-[#0B0E14]', 'replace'),
    ('bg-slate-950', 'bg-[#0B0E14]', 'replace'),
    # --- border-border (any /N) → border-white/[0.06] (drop opacity, stitch uses fixed) ---
    ('border-border', 'border-white/[0.06]', 'replace'),
    # --- emerald text → stitch-primary (keep any /N) ---
    ('text-emerald-700', 'text-stitch-primary', 'replace'),
    ('text-emerald-600', 'text-stitch-primary', 'replace'),
    ('text-emerald-500', 'text-stitch-primary', 'replace'),
    ('text-emerald-400', 'text-stitch-primary', 'replace'),
    ('text-emerald-300', 'text-stitch-primary', 'replace'),
    # --- red text → rose-400 ---
    ('text-red-600', 'text-rose-400', 'replace'),
    ('text-red-500', 'text-rose-400', 'replace'),
    ('text-red-400', 'text-rose-400', 'replace'),
    # --- slate text ---
    ('text-slate-900', 'text-stitch-on-surface', 'replace'),
    ('text-slate-700', 'text-stitch-muted', 'replace'),
    ('text-slate-600', 'text-stitch-muted', 'replace'),
    ('text-slate-500', 'text-stitch-outline', 'replace'),
    ('text-slate-400', 'text-stitch-outline', 'replace'),
    # --- generic semantic colors ---
    ('text-foreground',       'text-stitch-on-surface', 'replace'),
    ('text-muted-foreground', 'text-stitch-muted', 'replace'),
    # --- fonts ---
    ('font-mono', 'stitch-num', 'replace'),
    # --- tabular-nums kept as-is (already stitch-compatible) ---
]


def build_pattern(cls: str) -> re.Pattern:
    """Pattern that matches `cls` and optionally a trailing `/N` opacity modifier.
    Captures the opacity part in group `op` so we can preserve it.
    Lookbehind/lookahead exclude word chars, hyphens, and slashes — so the
    class name is fully bounded and we never split a partial match."""
    # NOTE: `\\` in replacement strings: backslashes need to be doubled in regular
    # Python strings, but for re.sub the literal `[`/`]`/`#` don't need escaping.
    # The opacity part is matched as `/[0-9]+` (no arbitrary-value `/[X.Y]` form
    # exists in source files for these classes).
    return re.compile(
        r'(?<![\w/\-])' + re.escape(cls) + r'(?P<op>/[0-9]+)?(?![\w/\-])'
    )


def apply_replacements(text: str) -> tuple[str, dict]:
    counts: dict[str, int] = {}
    for legacy, stitch, kind in REPLACEMENTS:
        if kind == 'noop':
            continue
        pattern = build_pattern(legacy)
        # If stitch already contains a `/` (explicit opacity OR arbitrary-value
        # syntax like border-white/[0.06]), DROP the captured op. Otherwise
        # preserve the captured opacity (e.g. bg-muted/50 → bg-[#182030]/50).
        if '/' in stitch:
            new_text, n = pattern.subn(stitch, text)
        else:
            new_text, n = pattern.subn(stitch + r'\g<op>', text)
        if n > 0:
            counts[legacy] = n
        text = new_text
    return text, counts


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print('usage: stitch_replace.py <file> [--dry-run]', file=sys.stderr)
        return 2
    path = Path(argv[1])
    dry = '--dry-run' in argv
    if not path.is_file():
        print(f'error: file not found: {path}', file=sys.stderr)
        return 2
    text = path.read_text(encoding='utf-8')
    new_text, counts = apply_replacements(text)
    total = sum(counts.values())
    if total == 0:
        print(f'[{path.name}] no legacy classes found')
        return 0
    detail = ', '.join(f'{k}={v}' for k, v in counts.items())
    print(f'[{path.name}] replaced {total} classes: {detail}')
    if dry:
        return 0
    path.write_text(new_text, encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
