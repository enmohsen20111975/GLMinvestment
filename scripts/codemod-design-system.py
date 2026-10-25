#!/usr/bin/env python3
"""
ALPHA-DESIGN-SYSTEM codemod — Per Mohsen's directive 2026-10-20.

SAFELY replaces all raw Tailwind palette classes with CSS variable tokens
using literal string replacement (NO regex — str.replace only).

Skips:
  - src/lib/design-tokens.ts (has the PALETTE_MIGRATION map — keys stay raw)
  - src/__tests__/ (test files)
  - archive/, .next/, node_modules/, .git/

Replacements:
  emerald → profit
  rose    → loss
  amber   → warning
  cyan    → whale
  teal    → whale
  slate   → muted/neutral (context-dependent)
  All dark: overrides for these colors → removed (CSS vars handle dark mode)
"""
import os
import sys
from pathlib import Path

# ════════════════════════════════════════════════════════════════════════════
# The canonical replacement map (literal string → literal string, NO regex)
# ════════════════════════════════════════════════════════════════════════════

REPLACEMENTS = [
    # ─── bg-* (backgrounds) ───
    # emerald → profit
    ('bg-emerald-500/15', 'bg-profit/10'),
    ('bg-emerald-500/10', 'bg-profit/10'),
    ('bg-emerald-500/20', 'bg-profit/10'),
    ('bg-emerald-500', 'bg-profit'),
    ('bg-emerald-600', 'bg-profit'),
    # rose → loss
    ('bg-rose-500/15', 'bg-loss/10'),
    ('bg-rose-500/10', 'bg-loss/10'),
    ('bg-rose-500/20', 'bg-loss/10'),
    ('bg-rose-500', 'bg-loss'),
    # amber → warning
    ('bg-amber-500/15', 'bg-warning/10'),
    ('bg-amber-500/10', 'bg-warning/10'),
    ('bg-amber-500/20', 'bg-warning/10'),
    ('bg-amber-500', 'bg-warning'),
    ('bg-amber-600', 'bg-warning'),
    # cyan → whale
    ('bg-cyan-500/15', 'bg-whale/10'),
    ('bg-cyan-500/10', 'bg-whale/10'),
    ('bg-cyan-500', 'bg-whale'),
    # teal → whale
    ('bg-teal-500/15', 'bg-whale/10'),
    ('bg-teal-500/10', 'bg-whale/10'),
    ('bg-teal-500', 'bg-whale'),
    # slate → muted/neutral (for backgrounds)
    ('bg-slate-200/80', 'bg-muted'),
    ('bg-slate-200/70', 'bg-muted'),
    ('bg-slate-200/60', 'bg-muted'),
    ('bg-slate-200/50', 'bg-muted'),
    ('bg-slate-200', 'bg-muted'),
    ('bg-slate-100', 'bg-muted'),

    # ─── text-* (foregrounds) ───
    # emerald → profit
    ('text-emerald-700', 'text-profit'),
    ('text-emerald-600', 'text-profit'),
    ('text-emerald-500', 'text-profit'),
    ('text-emerald-400', 'text-profit'),
    # rose → loss
    ('text-rose-700', 'text-loss'),
    ('text-rose-600', 'text-loss'),
    ('text-rose-500', 'text-loss'),
    ('text-rose-400', 'text-loss'),
    # amber → warning
    ('text-amber-700', 'text-warning'),
    ('text-amber-600', 'text-warning'),
    ('text-amber-500', 'text-warning'),
    ('text-amber-400', 'text-warning'),
    ('text-amber-800', 'text-warning'),
    ('text-amber-300', 'text-warning'),
    # cyan → whale
    ('text-cyan-700', 'text-whale'),
    ('text-cyan-600', 'text-whale'),
    ('text-cyan-500', 'text-whale'),
    ('text-cyan-400', 'text-whale'),
    # teal → whale
    ('text-teal-700', 'text-whale'),
    ('text-teal-600', 'text-whale'),
    ('text-teal-500', 'text-whale'),
    ('text-teal-300', 'text-whale'),
    # slate → muted-foreground (for text)
    ('text-slate-700', 'text-muted-foreground'),
    ('text-slate-600', 'text-muted-foreground'),
    ('text-slate-500', 'text-muted-foreground'),
    ('text-slate-400', 'text-muted-foreground'),
    ('text-slate-300', 'text-muted-foreground'),

    # ─── border-* (borders) ───
    # emerald → profit
    ('border-emerald-500/30', 'border-profit/20'),
    ('border-emerald-500/20', 'border-profit/20'),
    ('border-emerald-500', 'border-profit/20'),
    # rose → loss
    ('border-rose-500/30', 'border-loss/20'),
    ('border-rose-500/20', 'border-loss/20'),
    ('border-rose-500', 'border-loss/20'),
    # amber → warning
    ('border-amber-500/30', 'border-warning/20'),
    ('border-amber-500/20', 'border-warning/20'),
    ('border-amber-500', 'border-warning/20'),
    # cyan → whale
    ('border-cyan-500/30', 'border-whale/20'),
    ('border-cyan-500/20', 'border-whale/20'),
    ('border-cyan-500', 'border-whale/20'),
    # teal → whale
    ('border-teal-500/30', 'border-whale/20'),
    ('border-teal-500/20', 'border-whale/20'),
    ('border-teal-500', 'border-whale/20'),
    # slate → border (default border)
    ('border-slate-300/60', 'border-border'),
    ('border-slate-300', 'border-border'),
    ('border-slate-200', 'border-border'),

    # ─── dark: overrides — REMOVE ALL (CSS vars handle dark mode) ───
    # These need to be removed carefully. We remove the dark: variant
    # for our target colors. The pattern is: ' dark:text-emerald-400' etc.
    (' dark:text-emerald-400', ''),
    (' dark:text-emerald-300', ''),
    (' dark:text-emerald-500', ''),
    (' dark:text-rose-400', ''),
    (' dark:text-rose-300', ''),
    (' dark:text-rose-500', ''),
    (' dark:text-amber-400', ''),
    (' dark:text-amber-300', ''),
    (' dark:text-amber-500', ''),
    (' dark:text-cyan-400', ''),
    (' dark:text-cyan-300', ''),
    (' dark:text-teal-300', ''),
    (' dark:text-teal-400', ''),
    (' dark:text-slate-300', ''),
    (' dark:text-slate-400', ''),
    (' dark:bg-slate-800', ''),
    (' dark:bg-slate-900/40', ''),
    (' dark:bg-slate-950/40', ''),
    (' dark:bg-slate-800/40', ''),
    (' dark:bg-slate-900', ''),
    (' dark:border-slate-700', ''),
    (' dark:border-slate-800', ''),
    ('dark:text-emerald-400 ', ''),
    ('dark:text-emerald-300 ', ''),
    ('dark:text-emerald-500 ', ''),
    ('dark:text-rose-400 ', ''),
    ('dark:text-rose-300 ', ''),
    ('dark:text-amber-400 ', ''),
    ('dark:text-amber-300 ', ''),
    ('dark:text-cyan-400 ', ''),
    ('dark:text-teal-300 ', ''),
    ('dark:text-slate-300 ', ''),
    ('dark:text-slate-400 ', ''),
    ('dark:bg-slate-800 ', ''),
    ('dark:bg-slate-900/40 ', ''),
    ('dark:bg-slate-950/40 ', ''),
    ('dark:bg-slate-800/40 ', ''),
    ('dark:border-slate-700 ', ''),
    ('dark:border-slate-800 ', ''),

    # ─── Corrupted strings (from design-tokens.ts TONE_SOLID) ───
    ('border-emerald-500/30-foreground', 'border-profit/20'),
    ('border-rose-500/30-foreground', 'border-loss/20'),
    ('border-amber-500/30-foreground', 'border-warning/20'),

    # ─── Remaining patterns (catch-all for less common shades) ───
    ('text-emerald-800', 'text-profit'),
    ('text-rose-800', 'text-loss'),
    ('text-amber-900', 'text-warning'),
]

# ════════════════════════════════════════════════════════════════════════════
# Files to skip
# ════════════════════════════════════════════════════════════════════════════

SKIP_DIRS = {'__tests__', 'archive', '.next', 'node_modules', '.git', 'scripts'}
SKIP_FILES = {
    'src/lib/design-tokens.ts',  # has PALETTE_MIGRATION map (keys stay raw)
}
EXTENSIONS = {'.ts', '.tsx'}

# ════════════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════════════

def should_skip(path: Path, project_root: Path) -> bool:
    rel = str(path.relative_to(project_root)).replace('\\', '/')
    if rel in SKIP_FILES:
        return True
    for part in path.parts:
        if part in SKIP_DIRS:
            return True
    return False

def migrate_file(path: Path) -> tuple:
    try:
        original = path.read_text(encoding='utf-8')
    except Exception as e:
        print(f"  ✗ Could not read {path}: {e}", file=sys.stderr)
        return 0, {}

    content = original
    total = 0
    per_pattern = {}

    for old, new in REPLACEMENTS:
        count = content.count(old)
        if count > 0:
            content = content.replace(old, new)
            total += count
            per_pattern[old] = count

    if content == original:
        return 0, {}

    # Clean up double spaces left by dark: removal
    while '  ' in content:
        content = content.replace('  ', ' ')

    try:
        path.write_text(content, encoding='utf-8')
    except Exception as e:
        print(f"  ✗ Could not write {path}: {e}", file=sys.stderr)
        return 0, {}

    return total, per_pattern

def main():
    project_root = Path('/home/z/my-project')
    src_dir = project_root / 'src'

    files_modified = 0
    total_replacements = 0

    for path in sorted(src_dir.rglob('*')):
        if not path.is_file():
            continue
        if path.suffix not in EXTENSIONS:
            continue
        if should_skip(path, project_root):
            continue

        count, _ = migrate_file(path)
        if count > 0:
            files_modified += 1
            total_replacements += count
            print(f"  ✓ {path.relative_to(project_root)}: {count} replacements")

    print()
    print(f"{'=' * 60}")
    print(f"DESIGN-SYSTEM CODEMOD SUMMARY")
    print(f"{'=' * 60}")
    print(f"Files modified: {files_modified}")
    print(f"Total replacements: {total_replacements}")

if __name__ == '__main__':
    main()
