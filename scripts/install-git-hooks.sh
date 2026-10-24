#!/usr/bin/env bash
# =============================================================================
# install-git-hooks.sh
# -----------------------------------------------------------------------------
# Installs the version-controlled pre-commit hook from scripts/git-hooks/
# into .git/hooks/ so it actually runs on every `git commit`.
#
# Idempotent: safe to re-run. Uses a relative symlink so the hook always
# reflects the latest version of scripts/git-hooks/pre-commit in the
# working tree (no need to re-install after editing the hook).
#
# Usage:
#   bash scripts/install-git-hooks.sh
# =============================================================================
set -euo pipefail

# Resolve repo root (works regardless of CWD).
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "ERROR: not inside a git repository." >&2
    exit 1
}

SOURCE_REL="scripts/git-hooks/pre-commit"
SOURCE_ABS="${REPO_ROOT}/${SOURCE_REL}"
TARGET="${REPO_ROOT}/.git/hooks/pre-commit"

if [ ! -f "$SOURCE_ABS" ]; then
    echo "ERROR: hook source not found: $SOURCE_ABS" >&2
    exit 1
fi

chmod +x "$SOURCE_ABS"

# If a real (non-symlink) pre-commit hook exists, back it up before replacing.
if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
    BACKUP="${TARGET}.backup.$(date +%Y%m%d_%H%M%S)"
    mv "$TARGET" "$BACKUP"
    echo "Backed up existing pre-commit hook -> $BACKUP"
fi

# Create relative symlink so the hook always tracks the source file.
ln -sf "$SOURCE_REL" "$TARGET"
chmod +x "$TARGET" 2>/dev/null || true

echo "Installed pre-commit hook:"
echo "  target : .git/hooks/pre-commit"
echo "  source : $SOURCE_REL  (live — edits take effect immediately)"
echo ""
echo "Done. Every 'git commit' will now block staged .db / .sqlite /"
echo "large backup files from being (re)tracked."
echo ""
echo "To verify:  ls -la .git/hooks/pre-commit"
