#!/usr/bin/env bash
# Lists installed packages in node_modules whose directory is empty or missing
# its package.json — the signature of a corrupted install left behind by an
# interrupted `npm install`/`npm ci`.
set -uo pipefail

cd "$(dirname "$0")/.."

broken=0
total=0

report() {
  printf '%s\n' "$1"
  broken=$((broken + 1))
}

for pkg in node_modules/*; do
  [ -d "$pkg" ] || continue
  case "$pkg" in
    node_modules/@*) continue ;;
  esac
  total=$((total + 1))
  if [ -z "$(ls -A "$pkg" 2>/dev/null)" ]; then
    report "EMPTY     $pkg"
  elif [ ! -f "$pkg/package.json" ]; then
    report "NO-PKGJSON $pkg"
  fi
done

for scope in node_modules/@*; do
  [ -d "$scope" ] || continue
  for pkg in "$scope"/*; do
    [ -d "$pkg" ] || continue
    total=$((total + 1))
    if [ -z "$(ls -A "$pkg" 2>/dev/null)" ]; then
      report "EMPTY     $pkg"
    elif [ ! -f "$pkg/package.json" ]; then
      report "NO-PKGJSON $pkg"
    fi
  done
done

echo
echo "checked: $total package dirs, broken: $broken"
