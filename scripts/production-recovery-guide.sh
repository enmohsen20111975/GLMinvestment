#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║  GLMinvestment — Production Recovery & Maintenance Guide       ║
# ║  كل الأوامر اللي ممكن تحتاجها لأي مشكلة على السيرفر            ║
# ╚══════════════════════════════════════════════════════════════════╝
#
# ⚠️  شغّل كل أمر لوحده — مش كلهم مع بعض!
# ⚠️  لازم تكون في مجلد المشروع: cd ~/GLMinvestment

PROJECT_DIR=~/GLMinvestment

# ══════════════════════════════════════════════════════════════════
# 🔴 قسم 1: مشاكل GIT
# ══════════════════════════════════════════════════════════════════

# ──── مشكلة: git pull فشل بسبب تغييرات محلية ────
# السبب: ملفات محلية (زي DB files أو package-lock) اتعدلت على السيرفر
# الحل: رمّي التغييرات المحلية واسحب من جديد

cd $PROJECT_DIR
git status                          # شوف الملفات المتغيرة
git stash                           # احفظ التغييرات مؤقتاً (لو عايز ترجعها)
git pull origin main                # اسحب الكود الجديد
git stash pop                       # رجّع التغييرات (لو عملت stash)

# ──── مشكلة: git pull فشل بسبب unmerged files ────
# السبب: merge conflict من محاولة merge فاشلة قديمة
# الحل: reset كامل لآخر نسخة

cd $PROJECT_DIR
git reset --hard HEAD               # رمّي كل التغييرات المحلية
git pull origin main                # اسحب الكود الجديد

# ──── مشكلة: ملفات محلية بتمنع pull ومش عايز تفقدها ────
# الحل: احفظ نسخة احتياطية الأول

cd $PROJECT_DIR
cp db/predictions.db db/predictions.db.backup   # احفظ DB مهمة
cp db/stocks.db db/stocks.db.backup
git reset --hard HEAD
git pull origin main

# ──── مشكلة: السيرفر متقدم عن GitHub ────
# الحل: ارجع لنسخة GitHub

cd $PROJECT_DIR
git fetch origin
git reset --hard origin/main        # خلي السيرفر يطابق GitHub بالظبط

# ──── مشكلة: عايز تبدأ من الصفر ────
# ⚠️  ده يمسح كل حاجة!

cd ~
rm -rf GLMinvestment
git clone https://github.com/enmohsen20111975/GLMinvestment.git
cd GLMinvestment
# كمّل من قسم "الإعداد الكامل" تحت


# ══════════════════════════════════════════════════════════════════
# 🟡 قسم 2: مشاكل PM2 و الـ Ecosystem
# ══════════════════════════════════════════════════════════════════

# ──── إعادة تشغيل كل الخدمات ────

cd $PROJECT_DIR
pm2 restart all

# ──── إعادة تشغيل خدمة واحدة ────

pm2 restart python-backend
pm2 restart data-engine
pm2 restart nextjs
pm2 restart ws-service

# ──── مشكلة: PM2 بيستخدم كونفيج قديم ────
# الحل: امسح كل العمليات وابدأ من الأول

cd $PROJECT_DIR
pm2 stop all
pm2 delete all
pm2 start ecosystem.config.js

# ──── مشكلة: خدمة بتكراش كتير (restart count عالي) ────

pm2 stop <name>                     # أوقفها
pm2 logs <name> --lines 50          # شوف الأخطاء
# صلح المشكلة وبعدين:
pm2 restart <name>

# ──── مشكلة: ecosystem.config.js مش موجود ────
# السبب: git pull ماكملش أو الملف اتمسح

cd $PROJECT_DIR
git checkout origin/main -- ecosystem.config.js
pm2 start ecosystem.config.js

# ──── حفظ PM2 configuration (عشان يفضل بعد restart) ────

pm2 save                            # احفظ الحالة الحالية
pm2 startup                         # اخلي PM2 يبدأ مع الـ system boot

# ──── مراقبة الخدمات ────

pm2 status                          # حالة كل الخدمات
pm2 monit                           # مراقبة حية (CPU + RAM)
pm2 logs                            # كل الـ logs
pm2 logs python-backend --lines 50  # logs لخدمة معينة
pm2 logs nextjs --lines 50
pm2 logs data-engine --lines 50

# ──── مسح كل الـ logs ────

pm2 flush                           # امسح كل الـ logs
# أو:
> $PROJECT_DIR/logs/python-backend-error.log
> $PROJECT_DIR/logs/python-backend-out.log
> $PROJECT_DIR/logs/nextjs-error.log
> $PROJECT_DIR/logs/nextjs-out.log
> $PROJECT_DIR/logs/data-engine-error.log
> $PROJECT_DIR/logs/data-engine-out.log


# ══════════════════════════════════════════════════════════════════
# 🔵 قسم 3: مشاكل قواعد البيانات
# ══════════════════════════════════════════════════════════════════

# ──── إنشاء كل قواعد البيانات من الصفر ────
# استخدم ده بعد git clone أو لو DB files اتمسحت

cd $PROJECT_DIR
python3 scripts/init-databases.py

# ──── إنشاء auth.db و predictions.db (Prisma) ────

cd $PROJECT_DIR
npx prisma db push
npx prisma db push --schema=prisma/auth-schema.prisma
npx prisma db push --schema=prisma/predictions-schema.prisma

# ──── مشكلة: "no such table" ────
# السبب: جدول مش موجود في الـ DB
# الحل: شغّل init-databases.py تاني + أعد تشغيل الخدمات

cd $PROJECT_DIR
python3 scripts/init-databases.py
pm2 restart python-backend
pm2 restart data-engine

# ──── مشكلة: "no such column" ────
# السبب: الـ schema اتغير في الكود لكن الـ DB القديم مش فيه العمود الجديد
# الحل: أضف العمود الناقص يدوياً

cd $PROJECT_DIR
sqlite3 db/stocks.db "ALTER TABLE stocks ADD COLUMN market TEXT DEFAULT 'EGX';"
sqlite3 db/predictions.db "ALTER TABLE predictions ADD COLUMN market TEXT DEFAULT 'EGX';"
# بعد كده:
pm2 restart python-backend

# ──── مشكلة: DB مكسورة (corrupted) ────

cd $PROJECT_DIR
# شيك على الـ DB
sqlite3 db/stocks.db "PRAGMA integrity_check;"
# لو فاسدة، اعمل إصلاح:
cp db/stocks.db db/stocks.db.corrupt_backup
sqlite3 db/stocks.db ".recover" | sqlite3 db/stocks_repaired.db
mv db/stocks_repaired.db db/stocks.db
pm2 restart all

# ──── مشكلة: "database is locked" ────
# السبب: عملية تانية بتستخدم الـ DB

# أوقف كل الخدمات الأول
pm2 stop all
# شيك مين بيتعمل مع الـ DB
lsof db/stocks.db
# لو مفيش حاجة، امسح الـ WAL files
rm -f db/stocks.db-wal db/stocks.db-shm
rm -f db/predictions.db-wal db/predictions.db-shm
rm -f db/intraday.db-wal db/intraday.db-shm
# شغّل تاني
pm2 start all

# ──── مشكلة: كل الأرقام صفر في Dashboard ────
# السبب: DB فاضية — data_engine لازم يجيب بيانات

# الطريقة 1: استنى data_engine يجيب البيانات تلقائياً (5-10 دقايق)
pm2 logs data-engine --lines 20

# الطريقة 2: إجبار data_engine على الجلب دلوقتي
curl http://localhost:5000/api/trigger/all

# ──── فحص حجم ومحتوى الـ DBs ────

cd $PROJECT_DIR
ls -lh db/*.db
echo "--- stocks.db ---"
sqlite3 db/stocks.db "SELECT market, COUNT(*) FROM stocks GROUP BY market;"
echo "--- predictions.db ---"
sqlite3 db/predictions.db "SELECT COUNT(*) FROM predictions;"
echo "--- intraday.db ---"
sqlite3 db/intraday.db "SELECT COUNT(*) FROM stock_intraday;"


# ══════════════════════════════════════════════════════════════════
# 🟢 قسم 4: مشاكل Python venv
# ══════════════════════════════════════════════════════════════════

# ───ـ إنشاء venv من الصفر لـ vps-service ────

cd $PROJECT_DIR/vps-service
rm -rf venv                         # امسح القديم
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate

# ──── إنشاء venv من الصفر لـ data_engine ────

cd $PROJECT_DIR/data_engine
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt 2>/dev/null || pip install flask flask-cors requests pytz pandas numpy
deactivate

# ──── مشكلة: "No module named 'xxx'" ────
# الحل: أضف الـ package في الـ venv

cd $PROJECT_DIR/vps-service
source venv/bin/activate
pip install xxx                     # حط اسم الـ package
deactivate
pm2 restart python-backend


# ══════════════════════════════════════════════════════════════════
# 🟣 قسم 5: مشاكل Next.js
# ══════════════════════════════════════════════════════════════════

# ───ـ إعادة تثبيت npm packages ────

cd $PROJECT_DIR
rm -rf node_modules
npm install

# ──── مشكلة: Next.js بيكراش "production build not found" ────
# السبب: مفيش .next build directory
# الحل 1: استخدم dev mode (الـ ecosystem.config.js بيعمل كده تلقائياً)

pm2 restart nextjs

# الحل 2: اعمل build (أبطأ لكن أفضل للأداء)
cd $PROJECT_DIR
npm run build
# بعدين غيّر ecosystem.config.js لـ next start

# ──── مشكلة: "JWEDecryptionFailed" في auth ────
# السبب: NEXTAUTH_SECRET متغير أو مش متعرف

cd $PROJECT_DIR
# تأكد إن NEXTAUTH_SECRET موجود في .env
grep NEXTAUTH_SECRET .env
# لو مش موجود، أضفه:
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)" >> .env
pm2 restart nextjs

# ──── مشكلة: "OAuth client disabled" ────
# السبب: Google OAuth مش متعرف على السيرفر
# الحل: ده طبيعي — الكود الجديد بيخفي زر Google لو مش متعرف
# لو عايز تفعله: ضع GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET في .env


# ══════════════════════════════════════════════════════════════════
# 🟠 قسم 6: مشاكل ws-service
# ══════════════════════════════════════════════════════════════════

# ──── مشكلة: "Unknown file extension .ts" ────
# السبب: bun مش متعملش install على السيرفر
# الحل: install bun

curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
pm2 restart ws-service

# ──── بديل: لو مش عايز تثبت bun ────
# احذف ws-service من ecosystem.config.js مؤقتاً
pm2 stop ws-service
pm2 delete ws-service


# ══════════════════════════════════════════════════════════════════
# 🔴 قسم 7: الإعداد الكامل (من الصفر)
# ══════════════════════════════════════════════════════════════════
# شغّل الأوامر دي واحدة واحدة لو بدأت من الأول

cd ~
git clone https://github.com/enmohsen20111975/GLMinvestment.git
cd GLMinvestment

# 1. إنشاء قواعد البيانات
python3 scripts/init-databases.py

# 2. جهز vps-service venv
cd ~/GLMinvestment/vps-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate

# 3. جهز data_engine venv
cd ~/GLMinvestment/data_engine
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt 2>/dev/null || pip install flask flask-cors requests pytz pandas numpy
deactivate

# 4. جهز Next.js
cd ~/GLMinvestment
npm install
npx prisma db push
npx prisma db push --schema=prisma/auth-schema.prisma
npx prisma db push --schema=prisma/predictions-schema.prisma

# 5. أنشئ مجلد logs
mkdir -p logs

# 6. ابدأ PM2
cd ~/GLMinvestment
pm2 start ecosystem.config.js
pm2 save

# 7. تأكد
pm2 status
pm2 logs --lines 20

# 8. (اختياري) ثبّت bun لـ ws-service
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
pm2 restart ws-service

# 9. (اختياري) اخلي PM2 يبدأ مع الـ system
pm2 startup
# انسخ الأمر اللي هيظهر والصقه في الـ terminal


# ══════════════════════════════════════════════════════════════════
# 🟢 قسم 8: تحديث الكود من GitHub
# ══════════════════════════════════════════════════════════════════
# بعد أي تعديل على الساندبوكس وpush لـ GitHub

cd ~/GLMinvestment

# 1. أوقف الخدمات
pm2 stop all

# 2. احفظ DBs مهمة (اختياري)
cp db/predictions.db db/predictions.db.backup 2>/dev/null
cp db/stocks.db db/stocks.db.backup 2>/dev/null

# 3. حدّث الكود
git reset --hard HEAD
git pull origin main

# 4. حدّث الـ dependencies (لو اتغيرت)
cd ~/GLMinvestment/vps-service
source venv/bin/activate
pip install -r requirements.txt
deactivate

cd ~/GLMinvestment/data_engine
source venv/bin/activate
pip install -r requirements.txt 2>/dev/null || pip install flask flask-cors requests pytz pandas numpy
deactivate

cd ~/GLMinvestment
npm install

# 5. حدّث الـ DB schemas (لو اتغيروا)
python3 scripts/init-databases.py
npx prisma db push
npx prisma db push --schema=prisma/auth-schema.prisma
npx prisma db push --schema=prisma/predictions-schema.prisma

# 6. أعد تشغيل الخدمات
pm2 start ecosystem.config.js
pm2 save

# 7. تأكد
pm2 status
pm2 logs --lines 20


# ══════════════════════════════════════════════════════════════════
# 📊 قسم 9: فحص سريع (Health Check)
# ══════════════════════════════════════════════════════════════════

# فحص Python Backend
curl -s http://localhost:8010/health | head -1

# فحص Data Engine
curl -s http://localhost:5000/health | head -1

# فحص Next.js
curl -s http://localhost:3000 | head -1

# فحص قواعد البيانات
sqlite3 ~/GLMinvestment/db/stocks.db "SELECT COUNT(*) FROM stocks;" 2>/dev/null || echo "❌ stocks.db"
sqlite3 ~/GLMinvestment/db/predictions.db "SELECT COUNT(*) FROM predictions;" 2>/dev/null || echo "❌ predictions.db"

# فحص المساحة على القرص
df -h /
du -sh ~/GLMinvestment/db/
du -sh ~/GLMinvestment/logs/


# ══════════════════════════════════════════════════════════════════
# 🧹 قسم 10: تنظيف
# ══════════════════════════════════════════════════════════════════

# مسح الـ logs القديمة
find ~/GLMinvestment/logs/ -name "*.log" -mtime +7 -delete

# مسح الـ DB backup files القديمة
find ~/GLMinvestment/db/ -name "*.backup" -mtime +30 -delete
find ~/GLMinvestment/db/ -name "*.before_repair" -delete
find ~/GLMinvestment/db/ -name "*.corrupt_backup*" -delete

# مسح WAL/SHM files المعلقة
rm -f ~/GLMinvestment/db/*.db-wal
rm -f ~/GLMinvestment/db/*.db-shm

# شغل Vacuum على الـ DBs (تصغير الحجم)
sqlite3 ~/GLMinvestment/db/stocks.db "VACUUM;"
sqlite3 ~/GLMinvestment/db/predictions.db "VACUUM;"
sqlite3 ~/GLMinvestment/db/intraday.db "VACUUM;"
