#!/usr/bin/env python3
"""
Stitch Sovereign Terminal — structural rebuild for StocksView + StockScreenerAdvanced.

Approach (NO dark: prefix patching):
1. Replace legacy Tailwind classes (bg-card, text-foreground, etc.) with Stitch structural classes
   (bg-[#111622]/80, text-stitch-on-surface, etc.) using word-boundary regex.
2. Replace color classes (text-emerald-*, text-red-*, text-slate-*, bg-emerald-100, bg-slate-100, etc.)
   with Stitch equivalents.
3. Replace accent colors (amber, yellow, cyan, purple, pink, teal, orange) light variants with dark variants
   (since canvas is always dark now).
4. Strip all `dark:\\S+` tokens entirely.
5. Clean up duplicate spaces.
"""
import re
import sys

# Order matters: longer/more-specific patterns first.

# Phase 1: legacy → stitch (apply BEFORE stripping dark:)
LEGACY_REPLACEMENTS = [
    # Backgrounds — surface scale (most specific first)
    (r'\bbg-background\b', 'bg-stitch-canvas'),
    (r'\bbg-card/80\b', 'bg-[#111622]/80'),
    (r'\bbg-card\b', 'stitch-glass'),  # Cards become glass surfaces
    (r'\bbg-muted/60\b', 'bg-[#182030]/60'),
    (r'\bbg-muted/50\b', 'bg-[#182030]/50'),
    (r'\bbg-muted/40\b', 'bg-[#182030]/40'),
    (r'\bbg-muted/30\b', 'bg-[#182030]/30'),
    (r'\bbg-muted/20\b', 'bg-[#182030]/20'),
    (r'\bactive:bg-muted/50\b', 'active:bg-[#182030]/50'),
    (r'\bhover:bg-muted\b', 'hover:bg-[#182030]'),
    (r'\bbg-muted\b', 'bg-[#182030]'),
    (r'\bborder-muted-foreground/30\b', 'border-white/[0.06]'),
    (r'\bborder-dashed\b', 'border-dashed'),  # keep

    # Foregrounds
    (r'\bhover:text-foreground\b', 'hover:text-stitch-on-surface'),
    (r'\btext-foreground\b', 'text-stitch-on-surface'),

    # Muted
    (r'\btext-muted-foreground/70\b', 'text-stitch-muted/70'),
    (r'\btext-muted-foreground\b', 'text-stitch-muted'),

    # Borders
    (r'\bdivide-border/50\b', 'divide-white/[0.06]'),
    (r'\bdivide-border\b', 'divide-white/[0.06]'),
    (r'\bborder-border/50\b', 'border-white/[0.06]'),
    (r'\bborder-border\b', 'border-white/[0.06]'),

    # Emerald (positive / gain)
    (r'\bbg-emerald-500/10\b', 'bg-emerald-500/10'),  # keep — already stitch-like tint
    (r'\bbg-emerald-100\b', 'bg-emerald-500/10'),
    (r'\bbg-emerald-900/30\b', 'bg-emerald-500/10'),
    (r'\bbg-emerald-700\b', 'bg-emerald-700'),  # keep — used as active button bg
    (r'\bbg-emerald-600\b', 'bg-emerald-600'),  # keep — primary action green
    (r'\bhover:bg-emerald-700\b', 'hover:bg-emerald-700'),
    (r'\btext-emerald-700\b', 'text-stitch-primary'),
    (r'\btext-emerald-600\b', 'text-stitch-primary'),
    (r'\btext-emerald-800\b', 'text-stitch-primary'),
    (r'\btext-emerald-500\b', 'text-stitch-mint'),
    (r'\bborder-emerald-600\b', 'border-emerald-600'),
    (r'\bborder-emerald-200\b', 'border-emerald-500/30'),
    (r'\bborder-emerald-500/30\b', 'border-emerald-500/30'),
    (r'\bborder-emerald-500/40\b', 'border-emerald-500/40'),
    (r'\bborder-emerald-500/20\b', 'border-emerald-500/20'),
    (r'\bhover:border-emerald-200\b', 'hover:border-emerald-500/30'),

    # Red (negative / loss)
    (r'\bbg-red-500/10\b', 'bg-red-500/10'),
    (r'\bbg-red-100\b', 'bg-red-500/10'),
    (r'\bbg-red-900/30\b', 'bg-red-500/10'),
    (r'\bbg-red-900/40\b', 'bg-red-500/10'),
    (r'\bbg-red-500/5\b', 'bg-red-500/5'),
    (r'\btext-red-700\b', 'text-stitch-error'),
    (r'\btext-red-600\b', 'text-stitch-error'),
    (r'\btext-red-500\b', 'text-stitch-error'),
    (r'\btext-red-800\b', 'text-stitch-error'),
    (r'\bborder-red-500/30\b', 'border-red-500/30'),
    (r'\bborder-red-500\b', 'border-red-500'),
    (r'\bborder-red-200\b', 'border-red-500/30'),

    # Rose (alt negative)
    (r'\bbg-rose-500/20\b', 'bg-rose-500/20'),
    (r'\bbg-rose-500/10\b', 'bg-rose-500/10'),
    (r'\bbg-rose-50\b', 'bg-rose-500/10'),
    (r'\bbg-rose-100\b', 'bg-rose-500/10'),
    (r'\bbg-rose-900/30\b', 'bg-rose-500/10'),
    (r'\bbg-rose-900/40\b', 'bg-rose-500/10'),
    (r'\bbg-rose-950/30\b', 'bg-rose-500/10'),
    (r'\bhover:bg-rose-50\b', 'hover:bg-rose-500/10'),
    (r'\bhover:bg-rose-950/30\b', 'hover:bg-rose-500/10'),
    (r'\bhover:text-rose-700\b', 'hover:text-rose-400'),
    (r'\btext-rose-800\b', 'text-rose-400'),
    (r'\btext-rose-700\b', 'text-rose-400'),
    (r'\btext-rose-500\b', 'text-rose-400'),
    (r'\bborder-rose-200\b', 'border-rose-500/30'),
    (r'\bborder-rose-500/30\b', 'border-rose-500/30'),

    # Slate (neutral) → stitch hex equivalents
    (r'\bbg-slate-50/50\b', 'bg-[#182030]'),
    (r'\bbg-slate-100\b', 'bg-[#182030]'),
    (r'\bbg-slate-800/60\b', 'bg-[#182030]/60'),
    (r'\bbg-slate-800\b', 'bg-[#182030]'),
    (r'\bbg-slate-900/40\b', 'bg-[#182030]/60'),
    (r'\bbg-slate-500/20\b', 'bg-white/[0.04]'),
    (r'\bbg-slate-500/10\b', 'bg-white/[0.04]'),
    (r'\btext-slate-700\b', 'text-stitch-on-surface'),
    (r'\btext-slate-600\b', 'text-stitch-muted'),
    (r'\btext-slate-400\b', 'text-stitch-outline'),
    (r'\btext-slate-300\b', 'text-stitch-muted'),
    (r'\bborder-slate-200\b', 'border-white/[0.06]'),
    (r'\bborder-slate-400/40\b', 'border-white/[0.08]'),
    (r'\bborder-slate-500/40\b', 'border-white/[0.08]'),
    (r'\bborder-slate-700\b', 'border-white/[0.06]'),

    # Gray (neutral alt)
    (r'\bbg-gray-100\b', 'bg-[#182030]'),
    (r'\bbg-gray-800/60\b', 'bg-[#182030]/60'),
    (r'\bbg-gray-800\b', 'bg-[#182030]'),
    (r'\btext-gray-700\b', 'text-stitch-on-surface'),
    (r'\btext-gray-300\b', 'text-stitch-muted'),
    (r'\bborder-gray-200\b', 'border-white/[0.06]'),
    (r'\bborder-gray-700\b', 'border-white/[0.06]'),

    # Green (positive alt — distinct from emerald)
    (r'\bbg-green-100\b', 'bg-emerald-500/10'),
    (r'\bbg-green-900/40\b', 'bg-emerald-500/10'),
    (r'\btext-green-800\b', 'text-stitch-primary'),
    (r'\btext-green-700\b', 'text-stitch-primary'),
    (r'\btext-green-300\b', 'text-stitch-mint'),
    (r'\bborder-green-200\b', 'border-emerald-500/30'),
    (r'\bborder-green-800\b', 'border-emerald-500/30'),

    # Accent colors (amber, yellow, cyan, purple, pink, teal, orange, violet)
    # Convert light variant → dark variant (since canvas is always dark now)
    # amber
    (r'\bbg-amber-50/30\b', 'bg-amber-500/10'),
    (r'\bbg-amber-50/40\b', 'bg-amber-500/10'),
    (r'\bbg-amber-100\b', 'bg-amber-500/10'),
    (r'\bbg-amber-500/10\b', 'bg-amber-500/10'),
    (r'\bbg-amber-900/30\b', 'bg-amber-500/10'),
    (r'\bhover:bg-amber-50\b', 'hover:bg-amber-500/20'),
    (r'\bhover:bg-amber-500/20\b', 'hover:bg-amber-500/20'),
    (r'\bhover:bg-amber-950/30\b', 'hover:bg-amber-500/20'),
    (r'\btext-amber-700\b', 'text-amber-400'),
    (r'\btext-amber-600\b', 'text-amber-400'),
    (r'\btext-amber-500\b', 'text-amber-400'),
    (r'\btext-amber-800\b', 'text-amber-400'),
    (r'\btext-amber-400\b', 'text-amber-400'),
    (r'\btext-amber-300\b', 'text-amber-400'),
    (r'\bborder-amber-200\b', 'border-amber-500/30'),
    (r'\bborder-amber-500/30\b', 'border-amber-500/30'),
    (r'\bborder-amber-500/40\b', 'border-amber-500/40'),
    (r'\bborder-amber-500/20\b', 'border-amber-500/20'),
    (r'\bborder-amber-800\b', 'border-amber-500/30'),
    # yellow
    (r'\bbg-yellow-100\b', 'bg-yellow-500/10'),
    (r'\bbg-yellow-600/10\b', 'bg-yellow-500/10'),
    (r'\bbg-yellow-900/30\b', 'bg-yellow-500/10'),
    (r'\btext-yellow-700\b', 'text-yellow-400'),
    (r'\btext-yellow-600\b', 'text-yellow-400'),
    (r'\btext-yellow-800\b', 'text-yellow-400'),
    (r'\btext-yellow-500\b', 'text-yellow-400'),
    (r'\btext-yellow-400\b', 'text-yellow-400'),
    (r'\bborder-yellow-200\b', 'border-yellow-500/30'),
    # cyan
    (r'\bbg-cyan-100\b', 'bg-cyan-500/10'),
    (r'\bbg-cyan-900/40\b', 'bg-cyan-500/10'),
    (r'\bbg-cyan-500/10\b', 'bg-cyan-500/10'),
    (r'\btext-cyan-700\b', 'text-cyan-400'),
    (r'\btext-cyan-800\b', 'text-cyan-400'),
    (r'\btext-cyan-400\b', 'text-cyan-400'),
    (r'\btext-cyan-300\b', 'text-cyan-400'),
    (r'\bborder-cyan-200\b', 'border-cyan-500/30'),
    (r'\bborder-cyan-800\b', 'border-cyan-500/30'),
    (r'\bborder-cyan-500/40\b', 'border-cyan-500/40'),
    # purple
    (r'\bbg-purple-100\b', 'bg-purple-500/10'),
    (r'\bbg-purple-900/30\b', 'bg-purple-500/10'),
    (r'\btext-purple-700\b', 'text-purple-400'),
    (r'\btext-purple-400\b', 'text-purple-400'),
    (r'\btext-purple-300\b', 'text-purple-400'),
    (r'\bborder-purple-200\b', 'border-purple-500/30'),
    (r'\bborder-purple-500/40\b', 'border-purple-500/40'),
    # pink
    (r'\bbg-pink-100\b', 'bg-pink-500/10'),
    (r'\bbg-pink-900/30\b', 'bg-pink-500/10'),
    (r'\btext-pink-700\b', 'text-pink-400'),
    (r'\btext-pink-400\b', 'text-pink-400'),
    (r'\bborder-pink-200\b', 'border-pink-500/30'),
    # teal
    (r'\bbg-teal-100\b', 'bg-teal-500/10'),
    (r'\bbg-teal-900/30\b', 'bg-teal-500/10'),
    (r'\btext-teal-700\b', 'text-teal-400'),
    (r'\btext-teal-400\b', 'text-teal-400'),
    (r'\btext-teal-300\b', 'text-teal-400'),
    (r'\bborder-teal-200\b', 'border-teal-500/30'),
    (r'\bborder-teal-500/40\b', 'border-teal-500/40'),
    # orange
    (r'\bbg-orange-100\b', 'bg-orange-500/10'),
    (r'\bbg-orange-900/40\b', 'bg-orange-500/10'),
    (r'\bbg-orange-500/10\b', 'bg-orange-500/10'),
    (r'\btext-orange-700\b', 'text-orange-400'),
    (r'\btext-orange-800\b', 'text-orange-400'),
    (r'\btext-orange-400\b', 'text-orange-400'),
    (r'\btext-orange-300\b', 'text-orange-400'),
    (r'\bborder-orange-200\b', 'border-orange-500/30'),
    (r'\bborder-orange-500/40\b', 'border-orange-500/40'),
    (r'\bborder-orange-800\b', 'border-orange-500/30'),
    # violet
    (r'\bbg-violet-500/10\b', 'bg-violet-500/10'),
    (r'\btext-violet-700\b', 'text-violet-400'),
    (r'\btext-violet-300\b', 'text-violet-400'),
    (r'\bborder-violet-500/40\b', 'border-violet-500/40'),

    # Keep active-state green (emerald-600 is already stitch primary container #10B981)
    # bg-emerald-600 text-white border-emerald-600 is the canonical "active selected" style — keep

    # Special fix for: "bg-emerald-50/30 dark:bg-emerald-950/10" (trader presets bg)
    (r'\bbg-emerald-50/30\b', 'bg-emerald-500/10'),
    (r'\bbg-emerald-950/10\b', 'bg-emerald-500/10'),
    (r'\bbg-emerald-950/20\b', 'bg-emerald-500/10'),
    (r'\bhover:bg-emerald-950/30\b', 'hover:bg-emerald-500/20'),
    (r'\bhover:bg-emerald-50\b', 'hover:bg-emerald-500/20'),
]

# Phase 2: strip all dark:\S+ tokens (they're redundant now — stitch classes are structural)
# Use a single leading space (NOT \s+ which would eat newlines/indentation across lines).
DARK_TOKEN_RE = re.compile(r' dark:[^\s"\'`]+')

def transform(text: str) -> str:
    # Phase 1: legacy/color replacements
    for pattern, replacement in LEGACY_REPLACEMENTS:
        text = re.sub(pattern, replacement, text)
    # Phase 2: strip dark: tokens (only the leading space before each dark: token)
    text = DARK_TOKEN_RE.sub('', text)
    # Cleanup: collapse double-spaces that may appear INSIDE className strings (e.g., "foo  bar")
    # but ONLY do this when both spaces are not at line-start (to preserve indentation).
    # Match `X  Y` where X is non-space (and not newline) and Y is non-space — collapse to one space.
    text = re.sub(r'(?<=\S)  +(?=\S)', ' ', text)
    # Cleanup leading space right after opening quote in className (e.g., className=" foo")
    text = re.sub(r'className=" ', 'className="', text)
    text = re.sub(r'className=\' ', "className='", text)
    # Cleanup trailing space right before closing quote in className (e.g., className="foo ")
    text = re.sub(r' "', '"', text)
    return text


def main():
    if len(sys.argv) < 2:
        print("Usage: stitch_rebuild.py <file.tsx>", file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]
    with open(path, 'r', encoding='utf-8') as f:
        original = f.read()
    # Stats before
    dark_before = len(re.findall(r'dark:[^\s"\'`]+', original))
    legacy_before = len(re.findall(r'\b(bg-background|bg-card|bg-muted\b|text-foreground|text-muted-foreground|border-border\b)\b', original))
    transformed = transform(original)
    dark_after = len(re.findall(r'dark:[^\s"\'`]+', transformed))
    legacy_after = len(re.findall(r'\b(bg-background|bg-card|bg-muted\b|text-foreground|text-muted-foreground|border-border\b)\b', transformed))
    with open(path, 'w', encoding='utf-8') as f:
        f.write(transformed)
    print(f"✓ {path}")
    print(f"  dark: tokens:    {dark_before} → {dark_after}")
    print(f"  legacy classes:  {legacy_before} → {legacy_after}")


if __name__ == '__main__':
    main()
