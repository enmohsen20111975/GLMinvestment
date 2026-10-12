#!/usr/bin/env python3
"""
Migrate Arabic hardcoded strings in LearningVisuals.tsx → useTranslation() t().

Strategy:
  1. Find all unique Arabic strings via 3 regexes (attrs, JSX text, str literals).
  2. Generate a slug key for each unique Arabic string.
  3. Replace occurrences in context-aware way:
       - ATTR `="نص"`        → `={t('learning.KEY')}`
       - JSX  `>نص<`        → `>{t('learning.KEY')}<`
       - STR  `"نص"` / `'نص'` → `t('learning.KEY')`   (only when standalone)
  4. Insert `useTranslation` import + `const t = useTranslation();` in each
     component function body.
  5. Emit ar.json / en.json new entries to be merged.
"""
from __future__ import annotations
import json
import re
from pathlib import Path
from collections import OrderedDict

ROOT = Path('/home/z/my-project')
TSX = ROOT / 'src/modules/education/components/LearningVisuals.tsx'
AR_JSON = ROOT / 'messages/ar.json'
EN_JSON = ROOT / 'messages/en.json'

ATTR_RE = re.compile(
    r'(\b[a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*"([^"\n]*[\u0600-\u06FF][^"\n]*)"'
)
# Use [^<>{}] (NOT [^<>{]) — Python regex treats { in a char class as a quantifier
# if not balanced by }, leading to wrong matches.
# Also exclude quotes (" ' `) to prevent matching across string literals in code.
JSX_TEXT_RE = re.compile(r'>\s*([^<>{}\n"\'`]*[\u0600-\u06FF][^<>{}\n"\'`]*)\s*<')
# Exclude { and } from string content to avoid matching across template literal
# interpolations (${...}) and JSX expression boundaries (} ... {).
# This means: a string literal with Arabic can't span across ${...} or {expr}.
STR_LIT_RE = re.compile(r'(["\'`])([^"\'`\n{}]*[\u0600-\u06FF][^"\'`\n{}]*)\1')


def main():
    text = TSX.read_text(encoding='utf-8')

    str_to_key = OrderedDict()
    counter = 0
    for m in ATTR_RE.finditer(text):
        ar_text = m.group(2).strip()
        if ar_text not in str_to_key:
            counter += 1
            key = f'attr_{counter:03d}'
            str_to_key[ar_text] = key
    for m in JSX_TEXT_RE.finditer(text):
        ar_text = m.group(1).strip()
        if ar_text not in str_to_key:
            counter += 1
            key = f'k_{counter:03d}'
            str_to_key[ar_text] = key
    for m in STR_LIT_RE.finditer(text):
        ar_text = m.group(2).strip()
        if ar_text not in str_to_key:
            counter += 1
            key = f'k_{counter:03d}'
            str_to_key[ar_text] = key

    print(f'Unique Arabic strings: {len(str_to_key)}')

    # 1. ATTR replacements
    def attr_repl(m):
        attr_name = m.group(1)
        ar_text = m.group(2).strip()
        key = str_to_key.get(ar_text)
        if key is None:
            return m.group(0)
        return f'{attr_name}={{t(\'learning.{key}\')}}'
    text = ATTR_RE.sub(attr_repl, text)

    # 2. JSX text replacements
    def jsx_repl(m):
        ar_text = m.group(1).strip()
        key = str_to_key.get(ar_text)
        if key is None:
            return m.group(0)
        return f">{{t('learning.{key}')}}<"
    text = JSX_TEXT_RE.sub(jsx_repl, text)

    # 3. STR_LIT replacements
    def str_repl(m):
        ar_text = m.group(2).strip()
        key = str_to_key.get(ar_text)
        if key is None:
            return m.group(0)
        return f"t('learning.{key}')"
    text = STR_LIT_RE.sub(str_repl, text)

    # 4. Inject import
    if "from '@/lib/i18n-context'" not in text:
        text = text.replace(
            "import { cn } from '@/lib/utils';",
            "import { cn } from '@/lib/utils';\nimport { useTranslation } from '@/lib/i18n-context';",
            1,
        )

    # 5. Inject `const t = useTranslation();` at start of each component function body
    # Match both `function NAME(` and `export function NAME(`.
    func_pattern = re.compile(
        r'^(?:export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(',
        re.MULTILINE,
    )
    out_parts = []
    last_end = 0
    for fm in func_pattern.finditer(text):
        start = fm.start()
        rest = text[fm.end():]
        m2 = re.search(r'\)\s*\{', rest)
        if not m2:
            continue
        body_start = fm.end() + m2.end()
        next_func_m = func_pattern.search(text, body_start)
        body_end = next_func_m.start() if next_func_m else len(text)
        body = text[body_start:body_end]
        if "t('learning." in body:
            insertion = '  const t = useTranslation();\n'
            out_parts.append(text[last_end:body_start])
            out_parts.append(insertion)
            last_end = body_start
    out_parts.append(text[last_end:])
    text = ''.join(out_parts)

    TSX.write_text(text, encoding='utf-8')
    print(f'Wrote: {TSX}')

    # 6. JSON entries
    ar_data = json.loads(AR_JSON.read_text(encoding='utf-8'), object_pairs_hook=OrderedDict)
    en_data = json.loads(EN_JSON.read_text(encoding='utf-8'), object_pairs_hook=OrderedDict)

    new_entries = OrderedDict()
    for ar_text, key in str_to_key.items():
        new_entries[key] = ar_text

    ar_data['learning'] = new_entries
    en_data['learning'] = new_entries  # use Arabic as EN placeholder

    AR_JSON.write_text(
        json.dumps(ar_data, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    EN_JSON.write_text(
        json.dumps(en_data, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(f'ar.json: {len(new_entries)} learning keys')
    print(f'en.json: {len(new_entries)} learning keys')


if __name__ == '__main__':
    main()
