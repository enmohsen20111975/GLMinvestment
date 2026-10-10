#!/bin/bash
# ==============================================================================
# deploy_production_updates.sh
# سكريبت تطبيق التحديثات وترقية قاعدة البيانات على الخادم الإنتاجي (Production VPS)
# ==============================================================================
set -e

# ألوان للتنسيق
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}==================================================================${NC}"
echo -e "${GREEN}🚀 بدء تطبيق التحديثات وإصلاح نظام الاشتراكات على السيرفر الإنتاجي${NC}"
echo -e "${BLUE}==================================================================${NC}"

# التأكد من المسار
if [ -d "/root/GLMinvestment" ]; then
    cd /root/GLMinvestment
elif [ -d "/opt/GLMinvestment" ]; then
    cd /opt/GLMinvestment
fi

echo -e "\n${YELLOW}📥 [1/4] سحب أحدث كود من GitHub (origin/main)...${NC}"
git pull origin main

echo -e "\n${YELLOW}🗄️ [2/4] تشغيل سكربت ترقية وضبط قاعدة البيانات (db/auth.db)...${NC}"
python3 scripts/migrate_production_auth_db.py

echo -e "\n${YELLOW}📦 [3/4] إعادة بناء تطبيق Next.js بحزمة الإنتاج...${NC}"
npm run build

echo -e "\n${YELLOW}🔄 [4/4] إعادة تشغيل خدمات PM2...${NC}"
if pm2 describe nextjs > /dev/null 2>&1; then
    pm2 restart nextjs
elif pm2 describe nextjs-frontend > /dev/null 2>&1; then
    pm2 restart nextjs-frontend
else
    echo "⚠️ لم يتم العثور على nextjs أو nextjs-frontend كاسم محدد، جاري إعادة تشغيل التطبيقات..."
    pm2 restart all
fi

echo -e "\n${GREEN}==================================================================${NC}"
echo -e "${GREEN}✅ تم بنجاح تطبيق كافة التحديثات وترقية قاعدة البيانات!${NC}"
echo -e "${BLUE}==================================================================${NC}"
echo -e "للتحقق السريع:"
echo -e "curl -s 'http://localhost:3000/api/subscription/plans?market=egx' | head -c 200"
echo ""
