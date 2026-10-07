#!/bin/bash

# ============================================
# EGX Investment Platform - Deploy Script
# سكريبت النشر والتوزيع
# ============================================

echo "🚀 EGX Deployment Script"
echo "========================"

# ألوان للطباعة
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. فحص الكود
echo ""
echo "📝 Step 1: Checking code quality..."
bun run lint
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Lint errors found! Fix them before deploying.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Lint passed!${NC}"

# 2. فحص التغييرات
echo ""
echo "📦 Step 2: Checking changes..."
CHANGES=$(git status --porcelain)
if [ -z "$CHANGES" ]; then
    echo -e "${YELLOW}⚠️ No changes to commit.${NC}"
else
    echo "Changes found:"
    echo "$CHANGES"
fi

# 3. طلب رسالة Commit
echo ""
read -p "💬 Enter commit message: " COMMIT_MSG
if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="chore: update $(date +%Y-%m-%d)"
fi

# 4. إضافة التغييرات
echo ""
echo "➕ Step 3: Staging changes..."
git add -A

# 5. عمل Commit
echo ""
echo "💾 Step 4: Creating commit..."
git commit -m "$COMMIT_MSG"

# 6. الرفع على GitHub
echo ""
echo "🚀 Step 5: Pushing to GitHub..."
git push origin main
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Push failed!${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Deployed successfully!${NC}"
echo ""
echo "📊 Recent commits:"
git log --oneline -5
echo ""
echo "🔗 GitHub: https://github.com/enmohsen20111975/GLMinvestment"
