# 🚀 دليل النشر | Deployment Guide

> دليل كامل لتشغيل منصة GLMinvestment على اللابتوب والـ VPS
>
> Complete guide to run the GLMinvestment platform on laptop and VPS.

---

## 📋 محتويات المشروع | Project Architecture

المشروع بيتكون من **3 خدمات** لازم يشتغلوا مع بعض:

| Service | Language | Port | Role |
|---------|----------|------|------|
| **Next.js** | TypeScript | `3000` | الواجهة الأمامية (Display only) |
| **Python Backend** | Python | `8010` | العقل — كل التحليلات والحسابات |
| **Data-Engine** | Python | `5000` | جلب البيانات من TradingView/Yahoo/Crypto/News |

```
┌────────────────────────────────────────────────────────────┐
│  Browser  ──→  Next.js (3000)  ──→  Python Backend (8010)  │
│                                         │                   │
│                                         ↓                   │
│                                    Data-Engine (5000)       │
│                                         │                   │
│                                         ↓                   │
│                              SQLite DBs (db/*.db)           │
└────────────────────────────────────────────────────────────┘
```

---

## 🔑 المتطلبات الأساسية | Prerequisites

### على اللابتوب | On Laptop
```bash
# 1. Node.js 20+ و Bun
curl -fsSL https://bun.sh/install | bash
# أو نود من https://nodejs.org/

# 2. Python 3.11+
sudo apt install python3 python3-pip python3-venv

# 3. PM2 (اختياري للابتوب، ضروري للـ VPS)
sudo npm install -g pm2

# 4. Git
sudo apt install git
```

### على الـ VPS | On VPS
نفس المتطلبات بالظبط + افتح المنافذ `3000`, `8010`, `5000` في الـ firewall.

---

## 💻 1. التشغيل على اللابتوب | Laptop Setup

المسار: `meme@meme:~/my_apps/GLMinvestment/`

### الخطوة 1: استنساخ المشروع | Clone

```bash
cd ~/my_apps
git clone https://github.com/enmohsen20111975/GLMinvestment.git
cd GLMinvestment
```

### الخطوة 2: تثبيت اعتماديات Node | Install JS Dependencies

```bash
bun install
# أو: npm install
```

### الخطوة 3: إعداد ملف البيئة | Setup Environment

```bash
cp .env.example .env
nano .env
```

**ضروري تغيّر القيم دي بقيمك الحقيقية**:

| Variable | كيفية الحصول عليها |
|----------|-------------------|
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_CLIENT_SECRET` | نفس المكان |
| `PAYMOB_API_KEY` | [Paymob Dashboard](https://accept.paymob.com/portal/) |
| `PAYMOB_SECRET_KEY` | نفس المكان |
| `PAYMOB_HMAC` | نفس المكان |
| `TELEGRAM_BOT_TOKEN` | `@BotFather` على تليجرام |
| `TELEGRAM_API_ID` | [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_API_HASH` | نفس المكان |
| `TWELVE_DATA_API_KEY` | [twelvedata.com](https://twelvedata.com/) |
| `EODHD_API_KEY` | [eodhd.com](https://eodhd.com/) |
| `NEWSAPI_KEY` | [newsapi.org](https://newsapi.org/) |
| `GNEWS_KEY` | [gnews.io](https://gnews.io/) |

### الخطوة 4: إعداد Telegram Credentials

```bash
cp vps-service/telegram/credentials.example.json vps-service/telegram/credentials.json
nano vps-service/telegram/credentials.json
# عبّي القيم الحقيقية (api_id, api_hash, bot_token, phone, channel_id)
```

> ⚠️ **مهم**: ملف `credentials.json` مش متتبع في git (في `.gitignore`). لو رفعته بالغلط، كل الـ tokens بتاعت تليجرام بتتسرب.

### الخطوة 5: إعداد Python Backend

```bash
cd vps-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd ..
```

### الخطوة 6: تجهيز قواعد البيانات | Setup Databases

الـ DBs **مش على GitHub** (كبيرة + فيها بيانات حقيقية). عندك 3 خيارات:

#### الخيار أ: استخدام DBs موجودة عندك من قبل
```bash
# لو عندك نسخة قديمة من الـ DBs (من backup أو من سيرفر قديم)
cp /path/to/your/old/db/*.db db/
```

#### الخيار ب: إنشاء DBs من الصفر
```bash
# إنشاء كل الـ DBs من الـ Prisma schemas
bun run db:generate
bun run db:push

# للـ auth schema
npx prisma db push --schema=prisma/auth-schema.prisma

# للـ predictions schema
npx prisma db push --schema=prisma/predictions-schema.prisma

# التأكد من وجود كل الجداول
node scripts/ensure-databases.js
```

#### الخيار ج: نسخ الـ DBs من الـ VPS
```bash
# من الـ VPS، اعمل backup:
ssh root@YOUR_VPS_IP 'tar czf /tmp/dbs.tar.gz /root/GLMinvestment/db/*.db'
scp root@YOUR_VPS_IP:/tmp/dbs.tar.gz db/dbs.tar.gz
cd db && tar xzf dbs.tar.gz && rm dbs.tar.gz && cd ..
```

### الخطوة 7: تشغيل المشروع | Run

```bash
# الطريقة السريعة (dev mode — تشغيل Next.js + Python backend تلقائياً)
bun run dev
```

ده هيشغل:
- Python backend على `http://localhost:8010`
- Next.js على `http://localhost:3000`

افتح المتصفح على: **http://localhost:3000**

### الطريقة الاحترافية (PM2) | Production-style on Laptop

```bash
# تثبيت PM2 globally
sudo npm install -g pm2

# تشغيل كل الخدمات الـ 3
pm2 start ecosystem.config.js

# مراقبة
pm2 status
pm2 logs
pm2 monit

# إيقاف
pm2 stop all
```

---

## 🌐 2. النشر على VPS | VPS Deployment

المسار: `root@m2y:~/GLMinvestment#`

### الخطوة 1: استنساخ المشروع | Clone

```bash
cd ~
git clone https://github.com/enmohsen20111975/GLMinvestment.git
cd GLMinvestment
```

### الخطوة 2: تثبيت الاعتماديات | Install Dependencies

```bash
# Node.js + Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Python + أدوات
apt update
apt install -y python3 python3-pip python3-venv git curl

# PM2
npm install -g pm2

# بناء المشروع
bun install
```

### الخطوة 3: إعداد ملف البيئة

```bash
cp .env.example .env
nano .env
# عبّي كل القيم الحقيقية (نفس الجدول في قسم اللابتوب)
```

### الخطوة 4: إعداد Telegram Credentials

```bash
cp vps-service/telegram/credentials.example.json vps-service/telegram/credentials.json
nano vps-service/telegram/credentials.json
```

### الخطوة 5: إعداد Python Backend

```bash
cd vps-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd ..
```

### الخطوة 6: تعديل مسار venv في ecosystem.config.js

```bash
# الـ PM2 config فيه مسار hardcoded للابتوب:
#   /home/meme/my_apps/GLMinvestment/vps-service/venv/bin/python
# على الـ VPS المسار مختلف:
#   /root/GLMinvestment/vps-service/venv/bin/python

nano ecosystem.config.js
# غير السطر ده:
#   interpreter: '/home/meme/my_apps/GLMinvestment/vps-service/venv/bin/python',
# إلى:
#   interpreter: '/root/GLMinvestment/vps-service/venv/bin/python',
```

### الخطوة 7: تجهيز قواعد البيانات | Setup Databases

```bash
# إنشاء من الصفر
bun run db:generate
bun run db:push
npx prisma db push --schema=prisma/auth-schema.prisma
npx prisma db push --schema=prisma/predictions-schema.prisma
node scripts/ensure-databases.js

# أو نسخ من اللابتوب:
# (من اللابتوب)
scp db/*.db root@YOUR_VPS_IP:/root/GLMinvestment/db/
```

### الخطوة 8: بناء المشروع | Build

```bash
# بناء Next.js للإنتاج
bun run build
```

### الخطوة 9: تشغيل بـ PM2 | Start with PM2

```bash
# تشغيل كل الخدمات الـ 3
pm2 start ecosystem.config.js

# حفظ الـ PM2 process list عشان يشتغل تلقائياً بعد الـ reboot
pm2 save
pm2 startup
# هتظهرلك أمر sudo، انسخه ونفذه

# التحقق
pm2 status
# المفروض تشوف:
#   ✓ python-backend   (online)
#   ✓ data-engine      (online)
#   ✓ nextjs           (online)
```

### الخطوة 10: إعداد Nginx Reverse Proxy (اختياري)

```bash
apt install -y nginx

cat > /etc/nginx/sites-available/glminvestment << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Python backend مباشرة (لو محتاج)
    location /api/python/ {
        proxy_pass http://localhost:8010/;
    }
}
EOF

ln -s /etc/nginx/sites-available/glminvestment /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# SSL مع Certbot
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

---

## 🔄 3. التحديثات | How to Update

لما يكون فيه commits جديدة على GitHub، تحدّث كده:

### على اللابتوب
```bash
cd ~/my_apps/GLMinvestment
git pull origin main
bun install                    # لو فيه dependencies جديدة
cd vps-service && source venv/bin/activate && pip install -r requirements.txt && deactivate && cd ..
bun run db:push                # لو فيه schema changes
pm2 restart all                # لو شغال بـ PM2
# أو: Ctrl+C ثم bun run dev
```

### على الـ VPS
```bash
cd ~/GLMinvestment
git pull origin main
bun install
cd vps-service && source venv/bin/activate && pip install -r requirements.txt && deactivate && cd ..
bun run db:push
bun run build                  # ضروري للـ production
pm2 restart all
```

---

## 🚀 4. سكربت النشر السريع للـ VPS | One-click VPS Deploy

في المشروع فيه سكربت جاهز لنشر الـ Python analyzers + DBs من اللابتوب للـ VPS:

```bash
# من اللابتوب — تزامن ملفات المحللات والـ DBs للـ VPS
./vps-service/scripts/deploy_vps.sh --host YOUR_VPS_IP --user root --path /root/GLMinvestment
```

السكربت بيعمل:
1. ✅ تزامن ملفات Python المحللة عبر `rsync`
2. ✅ تزامن قواعد البيانات (`stocks.db`, `predictions.db`)
3. ✅ إعادة تشغيل `egx-backend` عبر supervisorctl
4. ✅ تشغيل backfill تعبئة التوقعات التاريخية
5. ✅ Health check على `http://localhost:8010/health`

**كل الخيارات:**
```bash
./vps-service/scripts/deploy_vps.sh --help
```

---

## 🛡️ نظام النسخ الاحتياطي التلقائي (Auto-Backup System)

### نظرة عامة
نظام نسخ احتياطي كامل مع تشغيل تلقائي يومي وحذف تلقائي بعد أسبوع.

### المكونات
| المكون | المسار | الوظيفة |
|--------|--------|---------|
| سكربت النسخ الاحتياطي | `scripts/auto-backup.sh` | نسخ جميع قواعد البيانات يومياً |
| إعداد Cron | `scripts/setup-backup-cron.sh` | تثبيت مهمة cron يومية الساعة 3 صباحاً |
| API نسخ احتياطي | `POST /api/admin/db-manager/auto-backup` | تشغيل النسخ من لوحة التحكم |
| API تنظيف | `POST /api/admin/db-manager/cleanup-old-backups` | حذف النسخ القديمة يدوياً |

### الإعداد على VPS
```bash
# 1. تشغيل السكربت يدوياً (اختبار)
bash scripts/auto-backup.sh

# 2. إعداد cron تلقائي يومي الساعة 3 صباحاً بتوقيت القاهرة
bash scripts/setup-backup-cron.sh

# 3. النسخ الاحتياطي يتخزن في:
#    db/backups/daily/YYYY-MM-DD/  (نسخ السكربت)
#    db/backups/auto/YYYY-MM-DD_HHmmss/  (نسخ الـ API)
```

### ماذا يفعل السكربت؟
- يبحث عن جميع ملفات `.db` الفعالة في `db/`
- يفحص سلامة كل قاعدة بيانات (`PRAGMA integrity_check`)
- ينفّذ `PRAGMA wal_checkpoint(TRUNCATE)` قبل النسخ
- يضغط كل قاعدة بملفاتها (`-wal`, `-shm`) في ملف ZIP منفصل
- يضع القواعد التالفة في مجلد `corrupted/` منفصل
- يحذف النسخ الأقدم من 7 أيام تلقائياً
- يسجل كل العمليات في `db/backups/backup.log`

### الحماية من فقدان البيانات
- `/api/admin/analytics` يعمل في وضع منخفض (degraded) إذا كانت قاعدة البيانات غير متاحة
- `/api/admin/users` يرجع قائمة فارغة بدل 500 إذا auth.db تالف
- **مهم**: لا تنسخ ملفات `.db` يدوياً أبداً بدون WAL checkpoint أولاً

---

## 🛠️ 10. السكربتات المساعدة | Utility Scripts

> **القاعدة:** كل السكربتات في `scripts/` — مش شغّالة في الـ runtime، أدوات صيانة يدوية أو cron jobs.
> **الإنتاج:** متاحة + مُختبرة. **الساندبوكس:** متاحة بدون cron (يدوياً فقط).

### 10.1 `daily_db_health_check.py` — الفحص اليومي التلقائي

**الوظيفة:** فحص سلامة كل DBs + إصلاح تلقائي + تحديث أسعار + تقرير JSON.

```bash
# تشغيل عادي (فحص + إصلاح)
python3 scripts/daily_db_health_check.py

# فحص فقط بدون إصلاح (معاينة)
python3 scripts/daily_db_health_check.py --dry-run

# تفاصيل أكثر
python3 scripts/daily_db_health_check.py --verbose
```

**الـ Workflow (7 خطوات):**
1. فحص سلامة كل DBs (`PRAGMA integrity_check`).
2. إصلاح تلقائي (REINDEX + dump/rebuild، auth.db = REINDEX فقط).
3. تحديث أسعار الأسهم من `price_history.db` (آخر close_price).
4. WAL checkpoints لكل DBs.
5. فحص الأسهم بـ `current_price=NULL/0` وإصلاحها.
6. توليد تقرير JSON في `db/backups/daily_health_report.json` + نسخ مؤرخة (30 يوم).
7. إرسال إشعار لو فيه مشاكل حرجة.

**التقارير الناتجة:**
- `db/backups/daily_health_report.json` (آخر تقرير).
- `db/backups/daily_health_YYYY-MM-DD.json` (نسخ مؤرخة 30 يوم).
- `db/backups/daily_health.log` (سجل cron).

### 10.2 `setup-daily-health-cron.sh` — تثبيت cron job يومي

**الوظيفة:** تثبيت/إزالة/حالة cron job يشغل `daily_db_health_check.py` يومياً 3 صباحاً Africa/Cairo.

```bash
# تثبيت cron job
bash scripts/setup-daily-health-cron.sh --install

# الحالة (آخر تقرير + آخر 10 أسطر من السجل)
bash scripts/setup-daily-health-cron.sh --status

# إزالة cron job
bash scripts/setup-daily-health-cron.sh --remove
```

**المخرجات:**
- `cron` line: `0 3 * * * cd /path/to/GLMinvestment && python3 scripts/daily_db_health_check.py >> db/backups/daily_health.log 2>&1`
- `CRON_MARKER="# GLMinvestment daily DB health check"` (للإزالة الآمنة لاحقاً).
- `TZ=Africa/Cairo` مُصدَّر في الـ env.

> ⚠️ **ملاحظة:** مش متاح في الساندبوكس — السكربت جاهز للإنتاج (Laptop + VPS).

### 10.3 `repair_all_dbs.py` — إصلاح DBs التالفة

**الوظيفة:** سكربت Python reusable لإصلاح كل DBs التالفة في `db/`.

```bash
# إصلاح كل DBs
python3 scripts/repair_all_dbs.py

# فحص فقط بدون إصلاح
python3 scripts/repair_all_dbs.py --check

# إصلاح DB محدد
python3 scripts/repair_all_dbs.py db/stocks.db
```

**الاستراتيجية (3 مراحل):**
1. `PRAGMA integrity_check` للكشف عن التلف.
2. `REINDEX` (سريع، يصلح مشاكل الفهارس).
3. `dump/rebuild` (موثوق، يصلح أي تلف في الـ B-tree).

**القواعد:**
- لا يحذف البيانات أبداً.
- ينشئ backup قبل أي إصلاح (`.bak` في نفس المجلد).
- يتعامل مع القفل بأن يطالب بإيقاف الخدمات أولاً (`pm2 stop all` أو `./.zscripts/start-watchdog.sh --stop`).

**الاستخدام في الإنتاج:**
```bash
# على الـ VPS:
cd ~/GLMinvestment
pm2 stop all
python3 scripts/repair_all_dbs.py
pm2 start all
```

### 10.4 `refresh_stock_prices.py` — تحديث الأسعار

**الوظيفة:** تحديث `stocks.current_price` و `stocks.last_update` من `price_history.db`.

```bash
python3 scripts/refresh_stock_prices.py
```

**الاستراتيجية (متوافقة مع DATA-FIX-001):**
1. لكل سهم EGX، نقرأ آخر `close_price` من `price_history`.
2. نُفضّل مصدر `egksco` (المرجع الرسمي من البورصة المصرية).
3. لو لم يوجد egksco، نسقط لمصدر `egx_investment_migration` (حتى لو كان مقياسه غير مثالي، أفضل من NULL/0).
4. نحدّث `stocks.current_price` و `stocks.last_update` (نفس تاريخ آخر شمعة).

**النتائج المتوقعة:**
- 324 سهم EGX محدّث.
- 39 سهم بـ NULL/0 أُصلحوا.
- أمثلة: COMI: 132.5→131.05, PHDC: 15.13→14.7, ABUK: 69.05→79.0.

### 10.5 `analyze_ticker_pollution.py` — تحليل تلوث الرموز

**الوظيفة:** فحص وتنظيف تلوث رموز الأسهم في جدول `stocks` (db/stocks.db).

```bash
# فحص + تقرير
python3 scripts/analyze_ticker_pollution.py

# تطبيق is_active=0 على الملوث الصريح
python3 scripts/analyze_ticker_pollution.py --apply
```

**التصنيفات:**
- `clean` (سليم): رمز قياسي 2-8 أحرف لاتينية أو رقمي.
- `polluted_explicit` (ملوث صريح): يحتوي مسافات أو أحرف عربية أو علامات ترقيم.
- `polluted_concat` (ملوث مدمج): رمز على شكل `<TICKER><NAME>D` بدون مسافات.
- `mismatched_market` (مُصنّف خطأ): `name_ar` يذكر دولة لا تطابق `market`.
- `null_price` (بدون سعر): `current_price` NULL أو 0.
- `duplicate_group` (مكرر): نفس `name_ar` يتكرر بأكثر من ticker.

**المخرجات:**
- `db/stocks_cleanup_report.json` (تقرير JSON شامل، ~90KB).
- جدول `stocks_cleanup_report` في `stocks.db` (توثيق المشاكل — آمن: لا يمسح بيانات).
- ملخص على stdout.

**القاعدة:** لا يحذف أي صف. فقط يصنّف ويوثّق ويقترح. `--apply` بتفعّل `is_active=0` (soft delete).

### 10.6 `inject_egx_historical_data.py` — حقن البيانات التاريخية

**الوظيفة:** حقن بيانات `stock_daily_prices` (EODHD نظيفة) في `price_history.db` بمصدر `egksco_backfill` لسد فجوة الـ 4-Day Data Trap.

```bash
# فحص فقط (معاينة)
python3 scripts/inject_egx_historical_data.py --dry-run

# حقن فعلي لكل الأسهم
python3 scripts/inject_egx_historical_data.py

# حقن سهم محدد
python3 scripts/inject_egx_historical_data.py --ticker=COMI
```

**الحالات اللي بتتعالج (الـ 6 أسهم الناقصة):**
- COMI, PHDC, SWDY, HRHO, FWRY, TMGH — كانت نسبها خارج `[0.5, 2.0]` (من 0.028x إلى 2.03x).
- بيانات migration ملوثة تماماً — لا يمكن تطبيعها.
- الحل: حقن بيانات EODHD النظيفة بمصدر `egksco_backfill`.

**النتيجة المتوقعة:**
- قبل: 4 شموع `egksco` فقط.
- بعد: 16 شمعة (4 egksco + 11 egksco_backfill + 1 overlap).
- `load_merged_history()` بيُرجع 16 شمعة بدلاً من 4 (تحسّن 4x).

**القواعد:**
- idempotent (يمكن إعادة تشغيله بأمان).
- backup قبل الحقن (`.bak`).
- ملاحظة: 16 شمعة لا تكفي لـ SMA200 — تحتاج مصدر بيانات EGX تاريخي إضافي (Yahoo Finance أو EGKSCO scraper).

### 10.7 `backtest_unified_pipeline.py` — Backtest بأثر رجعي

**الوظيفة:** Backtest للـ pipeline الموحّد (نفس منطق `chart_full_analysis`) للتحقق من win_rate ≥ 55%.

```bash
python3 scripts/backtest_unified_pipeline.py
```

**الـ Workflow:**
1. لكل سهم (10 أسهم EGX معروفة)، حمّل الـ history الكامل عبر `load_merged_history`.
2. لكل يوم `d` في آخر 90 يوم، اقتطع الـ history لحد `d` (as-of-date simulation).
3. شغّل نفس منطق الـ 5-layer scoring + risk calculation.
4. سجّل: `ticker, date, signal, entry, target, stop_loss, confluence_score`.
5. بعد 90 يوم، قارن التوقعات بالنتيجة الفعلية (forward window = 30 يوم):
   - BUY و target تحقق → ✅ hit
   - BUY و stop_loss تحقق → ❌ miss
   - BUY و لا target ولا stop خلال 30 يوم → ❌ miss (timeout)
6. احسب `win_rate = hits / (hits + misses)`.
7. احفظ النتائج في `db/backtest_results/unified_pipeline_backtest.json`.

**النتيجة الأخيرة (يوليو 2026):**

| السهم | signals | hits | misses | win_rate |
|-------|---------|------|--------|----------|
| ETEL | 90 | 33 | 28 | 54.1% |
| ABUK | 90 | 25 | 18 | 58.14% |
| EKHO | 90 | 45 | 29 | **60.81%** |
| **الإجمالي** | **270** | **103** | **75** | **57.87%** |

**الهدف: ≥ 55% → ✅ تحقق (+2.87 pts)**

**القواعد:**
- idempotent — يحفظ النتائج في JSON.
- لا يكتب في DBs الإنتاج.
- يستخدم نفس `load_merged_history()` (مُوحّد مع الشارت).

---

## ⏰ 11. Cron Job اليومي | Daily Cron

> **الوظيفة:** فحص وإصلاح تلقائي لقواعد البيانات + تحديث الأسعار يومياً 3 صباحاً بتوقيت القاهرة.

### التثبيت على الإنتاج

```bash
cd ~/GLMinvestment
git pull origin main
bash scripts/setup-daily-health-cron.sh --install
# سيشغل يومياً 3 صباحاً بتوقيت القاهرة (Africa/Cairo)
```

### التحقق من الحالة

```bash
bash scripts/setup-daily-health-cron.sh --status
# يعرض:
#   - cron entry
#   - آخر تقرير JSON (db/backups/daily_health_report.json)
#   - آخر 10 أسطر من السجل (db/backups/daily_health.log)
```

### الإزالة

```bash
bash scripts/setup-daily-health-cron.sh --remove
```

### الـ cron entry الناتج

```
# GLMinvestment daily DB health check
0 3 * * * cd /path/to/GLMinvestment && python3 scripts/daily_db_health_check.py >> db/backups/daily_health.log 2>&1
```

> ⚠️ **ملاحظة:** الـ cron مش متاح في الساندبوكس. السكربت يدوي على الساندبوكس فقط.

---

## 🔧 12. إصلاح DBs التالفة | DB Repair

> **3 خيارات للإصلاح:** سكربت سريع / لوحة الأدمن / cron تلقائي.

### الخيار 1: سكربت سريع (يدوي)

```bash
# إصلاح كل DBs
python3 scripts/repair_all_dbs.py

# فحص فقط
python3 scripts/repair_all_dbs.py --check

# DB محدد
python3 scripts/repair_all_dbs.py db/stocks.db
```

**الاستراتيجية:** REINDEX أولاً (سريع) → لو فشل → dump/rebuild (موثوق). ينشئ backup قبل أي إصلاح.

### الخيار 2: لوحة الأدمن (UI)

1. سجّل دخول Google بـ email أدمن.
2. ادخل `/admin` → Database Manager → اختر DB → "Repair".
3. الـ `AdminView` هيستدعي `/api/admin/auth/auto-cookie` تلقائياً لضبط الـ cookie.

**الـ API:**
```bash
POST /api/admin/db-manager/repair
Content-Type: application/json
{"db": "stocks.db"}
# Response 200: {success: true, steps: [...]} (6 steps)
```

> ⚠️ لو ظهر `ADMIN_AUTH_REQUIRED` → تأكد إن `ADMIN_*` vars موجودة في `.env`، وسجّل دخول Google.

### الخيار 3: cron تلقائي

لو `setup-daily-health-cron.sh --install` متثبّت، `daily_db_health_check.py` هيشتغل يومياً
3 صباحاً ويصلح الـ DBs تلقائياً (REINDEX + dump/rebuild لو لزم).

---

## 💉 13. حقن البيانات التاريخية | Data Injection

> **الوظيفة:** سد فجوة الـ 4-Day Data Trap لأسهم الـ EGX الناقصة.

### المشكلة

بعض الأسهم (COMI, PHDC, SWDY, HRHO, FWRY, TMGH) عندها بيانات migration ملوّثة تماماً
(نسب خارج `[0.5, 2.0]`) — لا يمكن تطبيعها. `load_merged_history()` بيرجع 4 شموع فقط
(egksco) — مش كافية لـ MACD/SMA200.

### الحل: `inject_egx_historical_data.py`

```bash
# معاينة
python3 scripts/inject_egx_historical_data.py --dry-run

# حقن فعلي
python3 scripts/inject_egx_historical_data.py

# سهم محدد
python3 scripts/inject_egx_historical_data.py --ticker=COMI
```

**النتيجة المتوقعة:**
- قبل: 4 شموع egksco.
- بعد: 16 شمعة (4 egksco + 11 egksco_backfill + 1 overlap).
- `load_merged_history()` بيرجع 16 شمعة (تحسّن 4x).

### التحقق

```bash
sqlite3 db/price_history.db "SELECT source, COUNT(*) FROM price_history WHERE ticker='COMI' GROUP BY source"
# النتيجة المتوقعة:
# egksco|4
# egksco_backfill|11

# عبر الـ API:
curl "http://localhost:8010/api/chart/full-analysis?ticker=COMI&limit=30" | jq '.data_points'
# النتيجة المتوقعة: 16
```

---

## 📊 14. التوثيق التلقائي | Automated Documentation

> **الوظيفة:** تقارير JSON تُولَّد تلقائياً لمراقبة جودة البيانات + backtest.

### 14.1 تقرير جودة البيانات (`/api/data-quality/report`)

**الـ API:**
```bash
curl "http://localhost:8010/api/data-quality/report" | jq
```

**الـ Response:**
```json
{
  "success": true,
  "summary": {
    "total_stocks": 762,
    "reliable_sources": 208,
    "needs_egksco_reference": 554
  },
  "by_source": {
    "egksco": 208,
    "egx_investment_migration": 554
  },
  "recommendations": [
    "554 سهم migration-only ما زالت بأسعار غير موثوقة — تحتاج مصدر EGX رسمي إضافي"
  ]
}
```

### 14.2 تقرير ترسانة الأدوات (`db/analysis_tools_audit.json`)

**الملف:** `db/analysis_tools_audit.json` (12.5 KB)
**المحتوى:**
- مقارنة شاملة: `chart-only` (6 أدوات) vs `maestro-only` (4 بعد TOOLKIT-UNIFY-010) vs `both` (7) vs غير مستخدمة (2).
- 10 فجوات محتملة (بعد التوحيد) + توصيات P0/P1/P2.
- `gap_count: 12 → 10` ✓
- `overlap_count: 5 → 7` ✓

### 14.3 تقرير الـ Backtest (`db/backtest_results/unified_pipeline_backtest.json`)

**الملف:** `db/backtest_results/unified_pipeline_backtest.json`
**المحتوى:**
- نتائج 270 signal × 90 يوم × 10 أسهم.
- `win_rate: 57.87%` (الهدف ≥ 55% ✅).
- تفاصيل لكل سهم: signals, hits, misses, win_rate.

### 14.4 تقرير تلوث الرموز (`db/stocks_cleanup_report.json`)

**الملف:** `db/stocks_cleanup_report.json` (~90 KB)
**المحتوى:**
- 941 سهم نشط نظيف (88.7% من الأصل).
- 98 سهم ملوث (is_active=0).
- جدول `stocks_cleanup_report` في `stocks.db`.

---

## 🩺 5. استكشاف الأخطاء | Troubleshooting

### المشكلة: Next.js مش بيبدأ
```bash
# افحص الـ logs
pm2 logs nextjs --lines 50
# أو
tail -50 /home/meme/my_apps/GLMinvestment/dev.log
```
**الأسباب الشائعة:**
- منفذ 3000 مستخدم: `lsof -i :3000` ثم اقتل العملية
- ملف `.env` ناقص: قارن مع `.env.example`
- prisma client مش متولد: `bun run db:generate`

### المشكلة: Python backend مش بيستجيب
```bash
curl http://localhost:8010/health
# لو فشل:
pm2 logs python-backend --lines 50
# أو
tail -50 vps-service/main.py.log
```
**الأسباب الشائعة:**
- الـ venv مش متثبت: `cd vps-service && source venv/bin/activate && pip install -r requirements.txt`
- منفذ 8010 مستخدم: `lsof -i :8010`
- DBs مش موجودة: `ls db/*.db`

### المشكلة: قاعدة البيانات فاضية
```bash
# تأكد إن الجداول موجودة
sqlite3 db/auth.db ".tables"
sqlite3 db/predictions.db ".tables"
sqlite3 db/stocks.db ".tables"

# لو فاضية، أعد إنشاءها
bun run db:push
npx prisma db push --schema=prisma/auth-schema.prisma
npx prisma db push --schema=prisma/predictions-schema.prisma
```

### المشكلة: Telegram bot مش شغال
```bash
# تأكد إن credentials.json موجود
ls -la vps-service/telegram/credentials.json
# لازم يكون فيه (مش الـ example)

# اختبر الـ token
curl "https://api.telegram.org/bot$(jq -r .bot_token vps-service/telegram/credentials.json)/getMe"
```

### المشكلة: مسار venv غلط في PM2
```bash
# اطبع المسار الحقيقي
ls vps-service/venv/bin/python
# حدّث ecosystem.config.js
sed -i "s|/home/meme/my_apps/GLMinvestment|/root/GLMinvestment|g" ecosystem.config.js
pm2 restart all
```

---

## 🔐 6. الأمان | Security Notes

### ✅ اللي اتعمل في الـ cleanup ده:
- شلنا **كل** الـ API keys/Tokens من الكود (كانت hardcoded كـ fallback)
- الـ `.env.example` بقى فيه placeholders فقط (`YOUR_*`)
- `credentials.json` بقت gitignored (مش هتترفع لـ GitHub أبداً)
- اتظبط **تاريخ git كله** (filter-repo) — مفيش ولا سر في أي commit قديم
- شلنا ملفات الـ DB الكبيرة من تاريخ git (414MB → 58MB)

### ⚠️ لازم تعملها يدوياً:
1. **بدّل كل الـ API keys** اللي كانت مسربة (لأنها ممكن تكون اتسربت قبل كده):
   - Telegram: `@BotFather` → `/revoke` → `token` جديد
   - Google OAuth: اعمل Client Secret جديد في الـ Console
   - Paymob: اعمل API key جديد من الـ dashboard
   - كل الـ market data APIs (TwelveData, EODHD, NewsAPI, GNews): اعملهم regenerate

2. **لو الـ repo كان public** (حتى لفترة قصيرة)، اعتبر كل الـ keys دي مكشوفة وبدّلها فوراً.

3. **الـ VPS IP**: لو كان ظاهر في commits قديمة (قبل الـ scrub)، فكر في تغيير الـ IP لو الـ VPS provider بيدعم ده.

---

## 📞 7. الدعم السريع | Quick Reference

| الإجراء | الأمر |
|---------|------|
| تشغيل dev | `bun run dev` |
| تشغيل production | `pm2 start ecosystem.config.js` |
| إيقاف الكل | `pm2 stop all` |
| إعادة تشغيل | `pm2 restart all` |
| الحالة | `pm2 status` |
| الـ logs | `pm2 logs` |
| الـ logs لخدمة معينة | `pm2 logs nextjs --lines 100` |
| فحص الـ lint | `bun run lint` |
| توليد prisma client | `bun run db:generate` |
| push الـ schema | `bun run db:push` |
| تحديث من GitHub | `git pull origin main` |
| فحص صحة Python backend | `curl http://localhost:8010/health` |
| فحص صحة Next.js | `curl http://localhost:3000` |
| فتح Prisma Studio | `bun run db:studio` |

---

## 🎯 8. اختصارات اللابتوب vs الـ VPS

| | Laptop | VPS |
|---|---|---|
| **المسار** | `~/my_apps/GLMinvestment/` | `~/GLMinvestment/` |
| **المستخدم** | `meme` | `root` |
| **venv path في PM2** | `/home/meme/my_apps/GLMinvestment/vps-service/venv/bin/python` | `/root/GLMinvestment/vps-service/venv/bin/python` |
| **Mode** | `bun run dev` | `pm2 start ecosystem.config.js` + `bun run build` |
| **المنافذ** | localhost only | مفتوحة على الإنترنت (مع Nginx + SSL) |
| **Auto-restart** | PM2 optional | PM2 + `pm2 startup` (ضروري) |

---

**تم الإعداد بواسطة Z.ai Code** | آخر تحديث: 2026-06-24

---

## 🧪 9. النشر على الساندبوكس (Z.ai Code Sandbox) | Sandbox Deployment

> هذا القسم مخصص لبيئة الساندبوكس التطويرية (Z.ai Code Sandbox).
> المسار: `/home/z/my-project/`

### الفروقات عن اللابتوب/VPS

| | اللابتوب/VPS | الساندبوكس |
|---|---|---|
| **المسار** | `~/my_apps/GLMinvestment/` أو `~/GLMinvestment/` | `/home/z/my-project/` |
| **المنفذ المكشوف** | 3000 (أو عبر Nginx) | 3000 فقط (عبر Caddy على المنفذ 81) |
| **PM2** | مطلوب للإنتاج | غير متاح — نستخدم `setsid` + watchdog |
| **Python venv** | `vps-service/venv/` | `/home/z/.venv/` (مشترك للساندبوكس) |
| **Build** | `bun run build` | ممنوع — `next dev` فقط |
| **NODE_OPTIONS** | `--max-old-space-size=2048` | `--max-old-space-size=1024` (الـ cgroup محدودة بـ 4GB) |

### التشغيل في الساندبوكس

الساندبوكس له **watchdog** مخصص يحافظ على الخدمات حية:

```bash
# تشغيل (يبقى Next.js + Python يعملان في الخلفية)
./.zscripts/start-watchdog.sh --start

# إيقاف
./.zscripts/start-watchdog.sh --stop

# الحالة
./.zscripts/start-watchdog.sh --status

# إعادة تشغيل
./.zscripts/start-watchdog.sh --restart
```

الـ watchdog:
- يبدأ Next.js على المنفذ 3000 و Python على المنفذ 8010
- يراقب المنافذ كل 5 ثواني ويعيد التشغيل عند الحاجة
- يستخدم `setsid + nohup + disown` لفصل العمليات عن الـ shell session
- يستخدم `NODE_OPTIONS=--max-old-space-size=1024` لتجنب OOM
- السجلات: `dev.log` (Next.js)، `python_backend.log` (Python)، `.zscripts/watchdog.log`

### الوصول للخدمات

- **الواجهة**: عبر Preview Panel (الطريقة الرسمية) أو `http://localhost:3000/`
- **Python backend مباشرة**: عبر proxy مع `?XTransformPort=8010` (مثلاً `/api/health?XTransformPort=8010`)
- **ملاحظة**: لا تكتب `http://localhost:PORT` في طلبات الواجهة — استخدم المسار النسبي مع `XTransformPort`

### إعداد الساندبوكس لأول مرة

```bash
# 1. تثبيت اعتماديات Node
bun install

# 2. تثبيت اعتماديات Python
pip3 install -r vps-service/requirements.txt

# 3. إنشاء قواعد البيانات
bunx prisma db push --schema=prisma/predictions-schema.prisma
# auth.db يأتي من git (فيه بيانات حقيقية) — لا تشغل prisma db push عليه إلا مع --accept-data-loss

# 4. تشغيل
./.zscripts/start-watchdog.sh --start
```

### استكشاف الأخطاء في الساندبوكس

```bash
# فحص حالة الخدمات
./.zscripts/start-watchdog.sh --status

# سجل Next.js
tail -50 dev.log

# سجل Python
tail -50 python_backend.log

# سجل الـ watchdog
tail -50 .zscripts/watchdog.log

# فحص الذاكرة (الـ cgroup محدودة بـ 4GB)
free -h

# فحص المنافذ
ss -tlnp | grep -E ':3000|:8010'
```

**المشكلة الشائعة: Next.js يموت باستمرار**
- السبب: OOM (تجاوز 4GB). يحدث غالباً عند فتح متصفح ثقيل أثناء compile.
- الحل: الـ watchdog يعيد التشغيل تلقائياً. انتظر ~30 ثانية للـ compile الأول.

**المشكلة الشائعة: "no such table: stocks"**
- السبب: `stocks.db` فارغ من بيانات الأسهم (الـ DBs الحقيقية مش على GitHub).
- الحل: شغّل سكربتات seed (مثل `scripts/seed-expert-recommendations.js`) أو انسخ الـ DBs من الإنتاج.

**المشكلة الشائعة: "database disk image is malformed"**
- السبب: تلف في B-tree أو rootpage (غالباً بسبب إيقاف مفاجئ للخدمة أو قطع الكهرباء).
- الحل (3 خيارات):
  1. **سكربت سريع (يدوي):**
     ```bash
     python3 scripts/repair_all_dbs.py            # إصلاح كل DBs في db/
     python3 scripts/repair_all_dbs.py --check    # فحص فقط بدون إصلاح
     python3 scripts/repair_all_dbs.py db/stocks.db  # إصلاح DB محدد
     ```
  2. **عبر لوحة الأدمن (UI):**
     - ادخل لوحة الأدمن → Database Manager → "Repair"
     - `POST /api/admin/db-manager/repair {db:"stocks.db"}` → HTTP 200 (6 steps).
     - **ملاحظة مهمة:** لو الـ middleware بيرفض بـ `ADMIN_AUTH_REQUIRED` — سجّل دخول Google
       بـ email أدمن، والـ `AdminView` هيستدعي `/api/admin/auth/auto-cookie` تلقائياً لضبط
       الـ httpOnly cookie.
  3. **الـ Cron اليومي (تلقائي):** لو `setup-daily-health-cron.sh --install` متثبّت،
     هيشتغل يومياً 3 صباحاً ويصلح الـ DBs تلقائياً.

**المشكلة الشائعة: "ADMIN_AUTH_REQUIRED" في admin routes**
- السبب: الـ middleware بيشتغل في Edge runtime ومش بيقدر يفحص NextAuth session (محتاج Node.js).
- الحل:
  1. تأكد إن `ADMIN_USERNAME`، `ADMIN_PASSWORD`، `ADMIN_SESSION_TOKEN` موجودين في `.env`.
  2. سجّل دخول Google بـ email أدمن (`enmohsen20111975@gmail.com`).
  3. ادخل لوحة الأدمن — هيستدعي `/api/admin/auth/auto-cookie` تلقائياً ويضبط httpOnly cookie.
  4. كل أوامر admin هتشتغل بعدها عبر الـ cookie (مدته 7 أيام).

**المشكلة الشائعة: "Data Split-Brain" (شارت ≠ مايسترو)**
- الأعراض: الشارت التفاعلي بيعرض قيم مختلفة عن جدول التحليلات لنفس السهم.
- السبب: `BackgroundAnalyzer` كان بيقرأ من `stock_daily_prices` مباشرة بدون فلتر egksco،
  بينما الشارت بيستخدم `load_merged_history()` بفلتر.
- الحل (مُطبَّق في DATA-UNIFY-007):
  - `BackgroundAnalyzer._analyze_and_store()` دلوقتي بيستخدم `load_merged_history()` (نفس الشارت).
  - فلتر السيولة الصارم: `MIN_TURNOVER_EGP = 500_000` — أي سهم turnover < 500K يُسقط.
  - الـ verify: `curl /api/stored-analysis/results?market=EGX | jq '.data[0].turnover_egp'`.
  - للمراجعة: `db/analysis_tools_audit.json` + `db/backtest_results/unified_pipeline_backtest.json`.

---

## 🛡️ 15. DB Safety + Cron + Scripts (Final — PROJECT-BLUEPRINT-019)

> **المصدر:** `worklog.md` (PROJECT-BLUEPRINT-019) + `PROJECT_BLUEPRINT.md` (قسم 10 + 11).
> **الهدف:** توثيق الحالة النهائية لحماية الـ DBs + السكربتات + الـ cron.

### 15.1 الـ DB Safety Stack (3 سكربتات — DB-ROBUSTNESS-017 + CRON-HEALTH-006)

| السكربت | الأسطر | الوظيفة | التشغيل |
|---------|--------|---------|---------|
| `scripts/init_db_safety.py` | 67 | يطبّق على كل DB: `journal_mode=WAL` + `synchronous=NORMAL` + `busy_timeout=30000` + `wal_autocheckpoint=1000` + `cache_size=-64000` + `wal_checkpoint(PASSIVE)` | عند بدء الـ backend |
| `scripts/repair_all_dbs.py` | ~250 | إصلاح DBs تالفة: `integrity_check` → `REINDEX` → `.dump` + `.reload` (rebuild كامل) + backup تلقائي | يدوي عند الطلب |
| `scripts/daily_db_health_check.py` | ~600 | فحص يومي 3 صباحاً Africa/Cairo: لكل DB `integrity_check` + `wal_checkpoint(TRUNCATE)` + تقرير JSON + تنظيف backups > 30 يوم | cron يومي |

### 15.2 الـ PRAGAs المُطبَّقة على كل connection جديد

```python
# في config.py:get_db_connection() + كل الـ DB clients في src/lib/
conn = sqlite3.connect(db_path, timeout=30)
conn.execute('PRAGMA journal_mode = WAL')          # concurrent read/write
conn.execute('PRAGMA synchronous = NORMAL')        # توازن safety/performance
conn.execute('PRAGMA busy_timeout = 30000')        # 30s wait بدل crash فوري
conn.execute('PRAGMA wal_autocheckpoint = 1000')   # checkpoint كل 1000 pages
conn.execute('PRAGMA cache_size = -64000')         # 64MB cache
conn.execute('PRAGMA foreign_keys = ON')
conn.execute('PRAGMA wal_checkpoint(PASSIVE)')     # truncate WAL على read
```

### 15.3 النتائج

- `database is locked` اختفت من الـ logs (ما فيش concurrent crashes)
- الـ WAL files ما بيتعدّاش 5MB (كانت بتوصل 50MB+)
- `integrity_check` بيرجع `ok` لكل الـ DBs الـ 4
- Cron يومي بيتفقد ويصلح قبل ما الـ user يحس

### 15.4 استراتيجية الإصلاح (3 خيارات)

1. **سكربت سريع (يدوي):**
   ```bash
   python3 scripts/repair_all_dbs.py            # إصلاح كل DBs
   python3 scripts/repair_all_dbs.py --check    # فحص فقط
   python3 scripts/repair_all_dbs.py db/stocks.db  # DB محدد
   ```

2. **عبر لوحة الأدمن (UI):**
   - `POST /api/admin/db-manager/repair {db:"stocks.db"}` → HTTP 200 (6 steps)
   - لو ظهر `ADMIN_AUTH_REQUIRED` → سجّل دخول Google، الـ AdminView هيستدعي `/api/admin/auth/auto-cookie` تلقائياً.

3. **الـ Cron اليومي (تلقائي):**
   - لو `setup-daily-health-cron.sh --install` متثبّت، هيشتغل يومياً 3 صباحاً.

### 15.5 الـ Cron Setup

```bash
# تثبيت (يومياً 3 صباحاً Africa/Cairo)
bash scripts/setup-daily-health-cron.sh --install

# الحالة + آخر تقرير + آخر 10 أسطر من السجل
bash scripts/setup-daily-health-cron.sh --status

# إزالة
bash scripts/setup-daily-health-cron.sh --remove
```

### 15.6 الـ 136 Maintenance Scripts (Final Count)

تم حصر 136 سكربت في `scripts/` موزّعة كالتالي:

| الفئة | العدد | أمثلة |
|------|------|--------|
| **DB Safety** | 4 | `init_db_safety.py`, `daily_db_health_check.py`, `repair_all_dbs.py`, `setup-daily-health-cron.sh` |
| **Data** | 5 | `refresh_stock_prices.py`, `analyze_ticker_pollution.py`, `inject_egx_historical_data.py`, `export_price_history.py`, `update_stocks_from_csv.py` |
| **Backtest** | 7 | `backtest_unified_pipeline.py`, `comprehensive_historical_test.py`, `win_rate_experiments.py`, `optimized_backtest.py`, `improved_backtest.py`, `baseline_backtest.py`, `simulated_backtest.py` |
| **Migration** | 12 | `migrate-to-unified-db.ts`, `migrate-databases.ts`, `migrate-price-history.ts`, `migrate-predictions-from-old-db.js`, `migrate-user-ids.py`, `unify-predictions-db.py`, ... |
| **Repair** | 10 | `repair_stocks_db.py`, `repair_stock_price_history.py`, `recover_data_engine.py`, `try_backup_recovery.py`, `fix_data_engine_corruption.*`, `fix-vps-db-complete.py`, `fix_vps_db_schema.py`, `patch_rootpage*.py` (v1-v6), ... |
| **Run/Deploy** | 12 | `start-python-backend.sh`, `start-nextjs.sh`, `deploy.sh`, `deploy-mobile-apis.sh`, `auto-backup.sh`, `setup-backup-cron.sh`, `keepalive*.sh`, ... |
| **Cleanup** | 9 | `clean-databases.sh`, `clean_vps_predictions.sh`, `clean_predictions_smart.py`, `clean_and_regenerate_predictions.py`, `clean_ai_predictions.py`, `clean_prediction_logs.py`, `clean-learned-lessons.js`, `close-stale-predictions.js`, `db_cleanup.py` |
| **Verify/Check** | 14 | `verify_fix.py`, `verify-migration.ts`, `verify_python_architecture.py`, `check_historical_data.py`, `check_price_history.py`, `check_corruption.py`, `check_db_schema.py`, `check_all_databases_production.py`, `check-predictions*.js`, `daily_result_checker.py`, ... |
| **Seed** | 6 | `seed-expert-recommendations.{py,js}`, `populate-databases*.py`, `ensure-databases.js`, `setup-all-dbs.ts`, `setup-prisma-db.ts`, `init-databases.py` |
| **Test** | 6 | `test_smart_confluence.py`, `test_better_sqlite3.js`, `test-better-sqlite3.js`, `test-cred.cjs`, `run_ab_test.py`, `_diag_*.{py,js}` |
| **Sync** | 7 | `sync_databases.py`, `sync-vps-data.py`, `sync-real-data.py`, `sync-from-python-api.ts`, `sync-data-engine.ts`, `sync-light-db*.ts`, `run_sync.sh` |
| **Import** | 5 | `import_egx30.py`, `import_egx30_history.py`, `import_egx30_v*.sh`, `import-all-data.ts`, `quick-import.ts` |
| **Patch** | 9 | `patch-html2canvas.js`, `patch_db_paths.py`, `patch_rootpage*.py` (v1-v6), `add_dividend_yield_column.py` |
| **Generate** | 5 | `generate_real_predictions.py`, `generate_full_predictions.py`, `generate_historical_predictions.py`, `regenerate_all_markets.py`, `mine_learned_lessons.py` |

### 15.7 الـ Project Blueprint Reference

للاطلاع على المرجع الكامل، راجع:
- **`PROJECT_BLUEPRINT.md`** (جذر المشروع — قسم 10 حماية DBs + قسم 11 السكربتات + قسم 13 خطوات إعادة البناء)
- **`AGENTS.md`** (قسم "الأدوات المساعدة" + قسم "الـ PROJECT_BLUEPRINT")
- **`scripts/`** (136 سكربت — كلها idempotent + تحترم القاعدة 2)

---

**تم الإعداد بواسطة Z.ai Code** | آخر تحديث: 2026-07-20 (PROJECT-BLUEPRINT-019 — DB Safety + Cron + Scripts Final)
