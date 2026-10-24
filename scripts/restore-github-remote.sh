#!/usr/bin/env bash
# Restores the GitHub remote from .env (re-runnable, idempotent).
# Used after a sandbox reset when .git/config loses the remote.
# Reads ONLY GITHUB_* vars via grep (avoids sourcing whole .env,
# which may contain unquoted values with spaces).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "[restore-remote] ERROR: .env not found" >&2
  exit 1
fi

GITHUB_PAT=$(grep -E '^GITHUB_PAT=' .env | head -1 | cut -d= -f2-)
GITHUB_REMOTE_URL=$(grep -E '^GITHUB_REMOTE_URL=' .env | head -1 | cut -d= -f2-)

if [ -z "$GITHUB_PAT" ] || [ -z "$GITHUB_REMOTE_URL" ]; then
  echo "[restore-remote] ERROR: GITHUB_PAT or GITHUB_REMOTE_URL missing in .env" >&2
  exit 1
fi

# Remove existing origin (if any) then re-add with embedded token.
if git remote get-url origin >/dev/null 2>&1; then
  CURRENT=$(git remote get-url origin)
  if [ "$CURRENT" = "$GITHUB_REMOTE_URL" ]; then
    echo "[restore-remote] origin already correct. Nothing to do."
    exit 0
  fi
  git remote remove origin
fi

git remote add origin "$GITHUB_REMOTE_URL"
# Never prompt; the token is embedded in the URL.
git config credential.helper ""
echo "[restore-remote] origin restored -> enmohsen20111975/GLMinvestment"
