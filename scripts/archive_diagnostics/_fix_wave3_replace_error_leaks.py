#!/usr/bin/env python3
"""
FIX-WAVE-3-HIGH Fix 3 — Replace error-disclosing catch blocks (Rule 30).

Replaces patterns that leak internal error details (file paths, SQL errors,
stack traces) in API route JSON responses with a generic `'internal_error'`
string, and ensures each modified catch block logs the real error server-side
via console.error.

Patterns covered (case-insensitive on identifier):
  - error: String(error)
  - error: String(err)
  - error: String(e)
  - error: error.message
  - error: err.message
  - error: e.message
  - error: e instanceof Error ? e.message : 'Unknown error'
  - error: error instanceof Error ? error.message : 'Unknown error'
  - message: `...${String(error)}`  (in API responses only)

Strategy:
  1. For each .ts route file under src/app/api, scan catch blocks.
  2. If a catch block contains one of the leaking patterns AND no console.error
     call before the return, prepend a `console.error('[route-name]', <err>)`
     call to the block (using the file's relative path as the tag).
  3. Replace the leaking pattern with `error: 'internal_error'` (or
     `message: 'internal_error'` for message-bearing responses).

  Output: prints file paths modified + total replacements.

Idempotent: re-running on already-fixed files is a no-op.
"""

import re
import sys
from pathlib import Path

API_ROOT = Path('/home/z/my-project/src/app/api')
PATTERNS = [
    # error: String(error|err|e)
    (re.compile(r'error:\s*String\(\s*(?:error|err|e)\s*\)'), "error: 'internal_error'"),
    # error: <id>.message (error/err/e)
    (re.compile(r'error:\s*error\.message'), "error: 'internal_error'"),
    (re.compile(r'error:\s*err\.message'), "error: 'internal_error'"),
    (re.compile(r'error:\s*e\.message'), "error: 'internal_error'"),
    # error: <id> instanceof Error ? <id>.message : <fallback>
    (re.compile(r"error:\s*e\s+instanceof\s+Error\s*\?\s*e\.message\s*:\s*'Unknown error'"), "error: 'internal_error'"),
    (re.compile(r"error:\s*err\s+instanceof\s+Error\s*\?\s*err\.message\s*:\s*'Unknown error'"), "error: 'internal_error'"),
    (re.compile(r"error:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*'Unknown error'"), "error: 'internal_error'"),
    # error: e instanceof Error ? e.message : String(e|err|error)
    (re.compile(r'error:\s*e\s+instanceof\s+Error\s*\?\s*e\.message\s*:\s*String\(\s*e\s*\)'), "error: 'internal_error'"),
    (re.compile(r'error:\s*err\s+instanceof\s+Error\s*\?\s*err\.message\s*:\s*String\(\s*err\s*\)'), "error: 'internal_error'"),
    (re.compile(r'error:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(\s*error\s*\)'), "error: 'internal_error'"),
    # error: e instanceof Error ? e.message : 'Something went wrong'
    (re.compile(r"error:\s*e\s+instanceof\s+Error\s*\?\s*e\.message\s*:\s*'[^']*'"), "error: 'internal_error'"),
    (re.compile(r"error:\s*err\s+instanceof\s+Error\s*\?\s*err\.message\s*:\s*'[^']*'"), "error: 'internal_error'"),
    (re.compile(r"error:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*'[^']*'"), "error: 'internal_error'"),
]

# Conservative: only add console.error if catch var is one of these
KNOWN_CATCH_VARS = ('error', 'err', 'e')

def file_already_has_console_error_nearby(content: str, replace_pos: int) -> bool:
    """Return True if there's a console.error within 600 chars BEFORE the replacement position."""
    window_start = max(0, replace_pos - 600)
    window = content[window_start:replace_pos]
    return 'console.error' in window or 'console.warn' in window


def find_catch_var(content: str, pos: int) -> str | None:
    """Find the catch variable name for the catch block enclosing `pos`."""
    # Walk backward to find the nearest 'catch (' token
    catch_idx = content.rfind('catch (', 0, pos)
    if catch_idx == -1:
        return None
    open_paren = catch_idx + len('catch (')
    close_paren = content.find(')', open_paren)
    if close_paren == -1:
        return None
    var = content[open_paren:close_paren].strip()
    return var if var in KNOWN_CATCH_VARS else (var or None)


def add_console_error_if_missing(content: str, replace_pos: int, file_rel: str) -> str:
    """Insert a `console.error('[file-rel]', <err>);` before the return statement
    that wraps the replacement site — IF not already present nearby."""
    if file_already_has_console_error_nearby(content, replace_pos):
        return content
    var = find_catch_var(content, replace_pos)
    if not var:
        return content  # don't know what to log; skip
    # Find the start of the `return` statement that contains replace_pos
    ret_idx = content.rfind('return', max(0, replace_pos - 400), replace_pos)
    if ret_idx == -1:
        return content
    # Find the line start
    line_start = content.rfind('\n', 0, ret_idx) + 1
    # Detect indentation of the return statement
    indent = content[line_start:ret_idx]
    if not indent.isspace():
        # weird — return is not at line start; bail out
        return content
    insert = f"{indent}console.error('[{file_rel}]', {var});\n"
    return content[:line_start] + insert + content[line_start:]


def process_file(path: Path) -> tuple[int, int]:
    """Return (replacements, console_added)."""
    try:
        content = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        return 0, 0
    original = content
    file_rel = str(path.relative_to(Path('/home/z/my-project/src/app/api')))
    # strip leading slash + replace path separators for a cleaner log tag
    file_rel = file_rel.replace('/route.ts', '').replace('/_', '/').lstrip('/')
    # collapse to a single tag token (no spaces)
    file_rel = file_rel.replace('/', ':').replace(' ', '-')[:60]
    console_added = 0
    for pat, repl in PATTERNS:
        for m in list(pat.finditer(content)):
            replace_pos = m.start()
            new_content = add_console_error_if_missing(content, replace_pos, file_rel)
            if new_content != content:
                console_added += 1
                content = new_content
            # Re-find the match position in (possibly modified) content
            # by searching for the same pattern near replace_pos
            new_m = pat.search(content, replace_pos - 1 if replace_pos > 0 else 0)
            if not new_m:
                continue
            content = content[:new_m.start()] + repl + content[new_m.end():]
    if content != original:
        path.write_text(content, encoding='utf-8')
        # Count replacements done
        delta = sum(
            len(pat.findall(original)) - len(pat.findall(content))
            for pat, _ in PATTERNS
        )
        return max(delta, 1), console_added
    return 0, 0


def main() -> int:
    total_replacements = 0
    total_console = 0
    files_changed = 0
    for ts_file in API_ROOT.rglob('*.ts'):
        r, c = process_file(ts_file)
        if r:
            files_changed += 1
            total_replacements += r
            total_console += c
            print(f"  {ts_file.relative_to(Path('/home/z/my-project'))}: {r} replacements, {c} console.error added")
    print(f"\nTOTAL: {files_changed} files, {total_replacements} replacements, {total_console} console.error added")
    return 0


if __name__ == '__main__':
    sys.exit(main())
