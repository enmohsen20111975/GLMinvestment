#!/usr/bin/env bash
# Runs the production build with bun on PATH.
# bun lives in ~/.bun/bin, which non-interactive shells do not source.
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"
cd /home/meme/my_apps/GLMinvestment

echo "bun version: $(bun --version)"
bun run build
