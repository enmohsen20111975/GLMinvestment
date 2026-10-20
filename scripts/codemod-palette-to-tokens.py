#!/usr/bin/env python3
"""
P0-COMPONENT-UNIFICATION Phase 2.6: PALETTE_MIGRATION codemod.

SAFELY migrates raw Tailwind palette classes to semantic design tokens
using literal string replacement (NO regex — str.replace only).

Skips:
  - src/lib/design-tokens.ts (defines the map)
  - src/lib/utils.ts (legacy fallbacks)
  - src/__tests__/ (test files)
  - src/archive/ (dead code)
  - .next/, node_modules/

Reports: files modified, total replacements per pattern.
"""
import os
import sys
from pathlib import Path

# Canonical migration map (from src/lib/design-tokens.ts PALETTE_MIGRATION).
# Each entry is: 'raw_palette_class' → 'semantic_token_class'.
# Empty string means "remove" (auto via token — used for dark: variants
# that the token system handles automatically).
PALETTE_MIGRATION = {
    # emerald → profit
    'text-emerald-600': 'text-profit',
    'text-emerald-700': 'text-profit',
    'text-emerald-500': 'text-profit',
    'bg-emerald-500': 'bg-profit',
    'bg-emerald-600': 'bg-profit',
    # green → success
    'text-green-600': 'text-success',
    'text-green-700': 'text-success',
    'bg-green-100': 'bg-success/10',
    # red → danger
    'text-red-500': 'text-danger',
    'text-red-600': 'text-danger',
    'bg-red-500': 'bg-danger',
    'bg-red-600': 'bg-danger',
    # rose → loss
    'text-rose-500': 'text-loss',
    'text-rose-600': 'text-loss',
    'bg-rose-500': 'bg-loss',
    # amber → warning
    'text-amber-500': 'text-warning',
    'text-amber-600': 'text-warning',
    'bg-amber-500': 'bg-warning',
    'bg-amber-600': 'bg-warning',
    # teal → whale
    'text-teal-500': 'text-whale',
    'text-teal-600': 'text-whale',
    'bg-teal-500': 'bg-whale',
    # blue → primary
    'text-blue-600': 'text-primary',
    'bg-blue-500': 'bg-primary',
}

# Redundant dark: variants — these override the token's dark mode with a
# specific palette color. Since the tokens (text-profit, text-loss, etc.)
# are CSS variables that already change value in dark mode, the dark:
# override is redundant and should be removed.
#
# These are removed as `class ` (with leading space if present) to avoid
# leaving orphan whitespace. Use a different mechanism than str.replace
# because we need to handle the leading space.
#
# Format: list of (pattern, replacement_after_removal) — replacement is
# usually empty string. We handle the leading space separately below.
DARK_VARIANTS_TO_REMOVE = [
    'dark:text-emerald-400',
    'dark:text-emerald-500',
    'dark:text-green-400',
    'dark:text-green-500',
    'dark:text-red-400',
    'dark:text-red-500',
    'dark:text-rose-400',
    'dark:text-rose-500',
    'dark:text-amber-400',
    'dark:text-amber-500',
    'dark:text-teal-400',
    'dark:text-teal-500',
    'dark:text-blue-400',
    'dark:text-blue-500',
    'dark:bg-emerald-950/40',
    'dark:bg-red-950/40',
    'dark:bg-rose-950/40',
    'dark:bg-amber-950/40',
    'dark:bg-teal-950/40',
    'dark:bg-green-950/40',
]

# Files/dirs to skip (relative to project root)
SKIP_PATHS = {
    'src/lib/design-tokens.ts',  # defines the map
    'src/lib/utils.ts',           # legacy fallbacks (intentional)
}

SKIP_DIR_PARTS = {
    '__tests__',   # test files
    'archive',     # dead code
    '.next',       # build output
    'node_modules',
    '.git',
}

# Only process these extensions
EXTENSIONS = {'.ts', '.tsx'}


def should_skip(path: Path, project_root: Path) -> bool:
    """Return True if this file should be skipped."""
    rel = path.relative_to(project_root)
    rel_str = str(rel).replace('\\', '/')
    # Skip specific files
    if rel_str in SKIP_PATHS:
        return True
    # Skip directories
    for part in path.parts:
        if part in SKIP_DIR_PARTS:
            return True
    # Skip scripts (this file itself)
    if 'codemod-palette' in path.name:
        return True
    return False


def migrate_file(path: Path) -> tuple[int, dict[str, int]]:
    """Migrate a single file. Returns (lines_changed, per_pattern_count)."""
    try:
        original = path.read_text(encoding='utf-8')
    except Exception as e:
        print(f"  ✗ Could not read {path}: {e}", file=sys.stderr)
        return 0, {}

    content = original
    per_pattern: dict[str, int] = {}

    for raw, replacement in PALETTE_MIGRATION.items():
        # Count occurrences before replace
        count = content.count(raw)
        if count > 0:
            per_pattern[raw] = count
            content = content.replace(raw, replacement)

    # Remove redundant dark: variants — handle leading space + trailing space
    # to avoid orphan whitespace bugs.
    for dark_variant in DARK_VARIANTS_TO_REMOVE:
        count = content.count(dark_variant)
        if count > 0:
            per_pattern[f"[remove] {dark_variant}"] = count
            # First: try removing ` dark_variant` (with leading space) — most common case
            content = content.replace(f' {dark_variant}', '')
            # Then: remove any remaining instances (e.g., at start of class string)
            content = content.replace(dark_variant, '')
            # Clean up any double spaces that resulted from removal
            while '  ' in content:
                content = content.replace('  ', ' ')

    if content == original:
        return 0, {}

    # Write back
    try:
        path.write_text(content, encoding='utf-8')
    except Exception as e:
        print(f"  ✗ Could not write {path}: {e}", file=sys.stderr)
        return 0, {}

    return content.count('\n') - original.count('\n'), per_pattern


def main():
    project_root = Path('/home/z/my-project')
    src_dir = project_root / 'src'

    if not src_dir.exists():
        print(f"✗ src/ not found at {src_dir}", file=sys.stderr)
        sys.exit(1)

    files_modified = 0
    total_replacements = 0
    pattern_totals: dict[str, int] = {}

    # Walk all .ts/.tsx files in src/
    for path in sorted(src_dir.rglob('*')):
        if not path.is_file():
            continue
        if path.suffix not in EXTENSIONS:
            continue
        if should_skip(path, project_root):
            continue

        _, per_pattern = migrate_file(path)
        if per_pattern:
            files_modified += 1
            file_total = sum(per_pattern.values())
            total_replacements += file_total
            print(f"  ✓ {path.relative_to(project_root)}: {file_total} replacements")
            for pat, cnt in per_pattern.items():
                pattern_totals[pat] = pattern_totals.get(pat, 0) + cnt

    print()
    print(f"=" * 60)
    print(f"PHASE 2.6 PALETTE_MIGRATION SUMMARY")
    print(f"=" * 60)
    print(f"Files modified: {files_modified}")
    print(f"Total replacements: {total_replacements}")
    print()
    print(f"Per-pattern breakdown:")
    for pat in sorted(pattern_totals.keys()):
        if pat.startswith('[remove] '):
            # dark: variant removal
            actual = pat.replace('[remove] ', '')
            print(f"  {actual:30s} → [removed]            : {pattern_totals[pat]} occurrences")
        else:
            replacement = PALETTE_MIGRATION.get(pat, '?')
            print(f"  {pat:30s} → {replacement:20s} : {pattern_totals[pat]} occurrences")


if __name__ == '__main__':
    main()
