#!/usr/bin/env bash
# =====================================================================
# git-recover-and-push.sh — استرجاع git بعد sandbox reset + push لـ GitHub
# =====================================================================
# يستخدم في حالتين:
#   1) .git ضاع في sandbox reset (المشروع مش git repo بعد).
#   2) الـ remote ضاع من .git/config.
#
# المتطلبات في .env:
#   GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
#   GITHUB_REMOTE_URL=https://github.com/enmohsen20111975/GLMinvestment.git
#
# الاستخدام:
#   1) املأ GITHUB_PAT في .env
#   2) bash scripts/git-recover-and-push.sh
#
# ملاحظة: السكريبت آمن — ما بيمسحش أي ملفات، بس بيجيب تاريخ GitHub
# ويحطه فوق الملفات المحلية بدون تغييرها (git reset --mixed).
# =====================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

echo "📂 Project: $PROJECT_DIR"

# ── 1) اقرأ credentials من .env ──
if [ ! -f .env ]; then
  echo "❌ .env not found. Create it with GITHUB_PAT + GITHUB_REMOTE_URL." >&2
  exit 1
fi

GITHUB_PAT=$(grep -E '^GITHUB_PAT=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'')
GITHUB_REMOTE_URL=$(grep -E '^GITHUB_REMOTE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'')

if [ -z "$GITHUB_PAT" ]; then
  echo "❌ GITHUB_PAT missing in .env. Get one from:" >&2
  echo "   https://github.com/settings/tokens (scope: repo)" >&2
  exit 1
fi
if [ -z "$GITHUB_REMOTE_URL" ]; then
  GITHUB_REMOTE_URL="https://github.com/enmohsen20111975/GLMinvestment.git"
  echo "ℹ️  GITHUB_REMOTE_URL not set, using default: $GITHUB_REMOTE_URL"
fi

# ادمج الـ PAT في الـ URL (صيغة: https://<token>@github.com/...)
AUTH_URL=$(echo "$GITHUB_REMOTE_URL" | sed "s|https://github.com|https://${GITHUB_PAT}@github.com|")

# ── 2) git init لو مش repo ──
if [ ! -d .git ]; then
  echo "🔧 .git missing — initializing fresh repo..."
  git init -b main
else
  echo "✅ .git exists"
fi

# ── 3) اضبط الـ remote ──
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$AUTH_URL"
  echo "🔄 origin URL updated"
else
  git remote add origin "$AUTH_URL"
  echo "➕ origin added"
fi
git config credential.helper ""  # استخدم الـ token المدمج، ما تسألش

# ── 4) جلب التاريخ الموجود (لو فيه) ──
echo "⬇️  Fetching existing history from GitHub..."
if git fetch origin main 2>/dev/null; then
  echo "✅ History fetched"
  # حط الـ fetched history كـ base بدون مسح الملفات المحلية
  git reset --mixed origin/main 2>/dev/null || true
else
  echo "ℹ️  No existing history on remote (first push) or fetch failed — continuing with local"
fi

# ── 5) stage + commit التغييرات المحلية ──
git add -A
if git diff --cached --quiet; then
  echo "ℹ️  No changes to commit"
else
  COMMIT_MSG="chore: update $(date +%Y-%m-%d) — engines + ENGINES_DEEP_DIVE Ch.20"
  git commit -m "$COMMIT_MSG" -m "Added Chapter 20 (glminvestment-engines package documentation) to Documentation/ENGINES_DEEP_DIVE.md"
  echo "✅ Committed: $COMMIT_MSG"
fi

# ── 6) push ──
echo "🚀 Pushing to GitHub..."
if git push -u origin main; then
  echo ""
  echo "🎉 SUCCESS — pushed to GitHub!"
  echo "   Remote: $GITHUB_REMOTE_URL"
  echo "   Branch: main"
else
  echo ""
  echo "❌ Push failed. Possible causes:" >&2
  echo "   - Invalid/expired PAT" >&2
  echo "   - No write access to the repo" >&2
  echo "   - Network issue" >&2
  exit 1
fi
