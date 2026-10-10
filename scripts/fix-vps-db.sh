#!/bin/bash
# سكريبت لإصلاح قاعدة البيانات على VPS

echo "=== إصلاح قاعدة البيانات ==="

# 1. نسخ قاعدة البيانات
echo "📦 نسخ قاعدة البيانات..."
scp db/custom.db root@YOUR_VPS_IP:/root/GLMinvestment/db/custom.db

# 2. إعادة تشغيل الخدمات
echo "🔄 إعادة تشغيل الخدمات..."
ssh root@YOUR_VPS_IP << 'REMOTE'
cd /root/GLMinvestment
pm2 restart nextjs-frontend
pm2 restart python-backend
echo "✅ تم إعادة التشغيل"
REMOTE

echo "✅ تم الإصلاح!"
