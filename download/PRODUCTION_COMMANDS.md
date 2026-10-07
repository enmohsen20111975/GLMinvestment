# 🚀 أوامر تشغيل السيرفرات على الإنتاج

> **المسار الإنتاجي:** `/root/GLMinvestment/` (مع التأكد من `cwd` قبل أي أمر)
> **الـ URL:** https://invist.m2y.net
> **المستخدم:** root

---

## 📋 البنية التحتية (7 خدمات PM2)

| # | الخدمة | المنفذ | الوصف |
|---|---|---|---|
| 1 | `python-backend` | 8010 | 🧠 العقل — كل المنطق + التوقعات + V40.2 |
| 2 | `data-engine` | 5000 | 📡 جلب الأسعار (TradingView + Yahoo) |
| 3 | `nextjs` | 3000 | 🎨 العرض فقط (Next.js production) |
| 4 | `ws-service` | 3005 | ⚡ WebSocket لتحديثات الأسعار اللحظية |
| 5 | `telegram-poster` | — | 📱 نشر تيليجرام (scheduler) |
| 6 | `telegram-interactive-bot` | — | 🤖 البوت التفاعلي |
| 7 | `telegram-events` | 3003 | 📡 socket.io relay لأحداث تيليجرام |
| 8 | `news-agent` | — | 📰 وكيل أخبار EGX محلي |

> **Ollama** (Local AI / RAG) منفصل — مُدار بـ systemd على المنفذ 11434 (ليس PM2)

---

## 🔥 الأوامر الأساسية (الأكثر استخداماً)

### ✅ فحص الحالة (Status)
```bash
cd /root/GLMinvestment
pm2 status
pm2 list
```

### ✅ فحص الـ Health
```bash
# فحص شامل للنظام كله
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool

# فحص Python backend مباشرة
curl -s http://127.0.0.1:8010/health

# فحص data-engine
curl -s http://127.0.0.1:3000/api/data-engine/health

# فحص admin cron health
curl -s http://127.0.0.1:3000/api/admin/cron-health
```

### ✅ السجلات (Logs)
```bash
# كل السجل الحي لكل الخدمات
pm2 logs

# سجل خدمة معينة فقط
pm2 logs python-backend --lines 100
pm2 logs nextjs --lines 50
pm2 logs data-engine --lines 50
pm2 logs news-agent --lines 50

# سجل لآخر N سطر فقط
pm2 logs python-backend --lines 200 --nostream
```

### ✅ إعادة التشغيل (Restart)
```bash
# إعادة تشغيل خدمة واحدة
pm2 restart python-backend
pm2 restart nextjs
pm2 restart data-engine
pm2 restart ws-service

# إعادة تشغيل كل الخدمات
pm2 restart all

# إعادة تشغيل مع تحديث متغيرات البيئة
pm2 restart python-backend --update-env
```

### ✅ الإيقاف والتشغيل (Stop/Start)
```bash
# تشغيل كل الخدمات من ecosystem.config.js
cd /root/GLMinvestment
pm2 start ecosystem.config.js

# إيقاف كل الخدمات
pm2 stop all

# حذف كل الخدمات من PM2 (لا يحذف الكود)
pm2 delete all

# إعادة تشغيل كل شيء من الصفر
pm2 delete all && pm2 start ecosystem.config.js
```

---

## 🔄 التحديث من GitHub (Deploy)

### الطريقة الآمنة (موصى بها)
```bash
cd /root/GLMinvestment

# 1. سحب آخر التحديثات
git pull origin main

# 2. تثبيت JS dependencies (لو تغير package.json)
bun install

# 3. توليد Prisma client (لو تغير schema)
bun run db:generate

# 4. إعادة بناء Next.js + إعادة تشغيله (atomic — ملف واحد)
bash scripts/rebuild-and-restart.sh

# 5. فحص الحالة
pm2 status
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
```

### تحديث Python backend فقط (بدون build)
```bash
cd /root/GLMinvestment
git pull origin main
pm2 restart python-backend --update-env
pm2 restart data-engine --update-env
pm2 restart news-agent --update-env
```

### تحديث Next.js فقط (بعد تعديل frontend)
```bash
cd /root/GLMinvestment
git pull origin main
bash scripts/rebuild-and-restart.sh
# هذا يساوي: bun run build && pm2 restart nextjs --update-env
```

---

## 🧠 رادار السيولة + التوقعات (الأوامر المهمة)

### تشغيل رادار السيولة يدوياً (كل الأسهم EGX)
```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate  # أو .venv حسب الإعداد
python3 scripts/maker_radar.py --json-only
# النتيجة: scripts/output/maker_radar_EGX_<DATE>.json
```

### تشغيل الرادار لسوق آخر (TADAWUL / KSE / QSE / US / CRYPTO / GOLD)
```bash
python3 scripts/maker_radar.py --market TADAWUL --json-only
python3 scripts/maker_radar.py --market CRYPTO --json-only
python3 scripts/maker_radar.py --market GOLD --json-only
```

### تقرير الدقة التاريخية (سكريبت جديد)
```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate

# عينة سريعة (250 يوم × 100 سهم)
python3 scripts/output/radar_historical_accuracy.py --top 250 --limit-tickers 100 --min-rows 90

# فحص فترة محددة
python3 scripts/output/radar_historical_accuracy.py --start 2026-01-01 --end 2026-06-30

# النتيجة: scripts/output/radar_historical_accuracy.json
```

### إغلاق التوقعات المنتهية (Daily Closer)
```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate
python3 -c "
import sys
sys.path.insert(0, 'vps-service')
from jobs.daily_closer import DailyCloser
closer = DailyCloser()
n = closer.run()
print(f'Closed {n} predictions')
"
```

### توليد توقعات V40.2 يدوياً
```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate
python3 scripts/v40_2_build_predictions.py
```

---

## 💾 قواعد البيانات (DB Safety)

> ⚠️ **Rule 1 (CONSTITUTION):** ممنوع لمس DBs الإنتاجية إلا عبر أدوات read-only.
> الاسترجاع يكون فقط عبر `vps-service/tools/restore_from_local.py` وبعد إذن المالك.

### فحص حالة DBs (read-only — آمن)
```bash
cd /root/GLMinvestment
sqlite3 db/predictions.db "SELECT COUNT(*), status FROM predictions GROUP BY status"
sqlite3 db/stocks.db "SELECT COUNT(*) FROM stocks"
sqlite3 db/stocks.db "SELECT COUNT(*) FROM stock_daily_prices"
sqlite3 db/price_history.db "SELECT MIN(date), MAX(date), COUNT(*) FROM price_history"
```

### فحص DB integrity
```bash
sqlite3 db/predictions.db "PRAGMA integrity_check;"
sqlite3 db/stocks.db "PRAGMA integrity_check;"
```

### WAL checkpoint (لتسرياع القراءة بعد عمليات كتابة كثيرة)
```bash
sqlite3 db/predictions.db "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 db/stocks.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

### نسخة احتياطية قبل أي تعديل (محلي فقط — لا يُرفع لـ GitHub)
```bash
cd /root/GLMinvestment
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p db/_backups
cp db/predictions.db db/_backups/predictions_${TS}.bak
cp db/stocks.db db/_backups/stocks_${TS}.bak
cp db/price_history.db db/_backups/price_history_${TS}.bak
# ملاحظة: db/_backups/ في .gitignore — آمن
```

---

## 🧪 فحص الـ Lint + Tests (قبل أي commit)

```bash
cd /root/GLMinvestment

# Lint (Frontend)
bun run lint

# Tests (Frontend)
bun run test

# Tests (Backend Python)
cd vps-service && source venv/bin/activate && python3 -m pytest tests/ -v

# Type check (Frontend)
npx tsc --noEmit -p tsconfig.json

# Python syntax check
python3 -c "import sys; sys.path.insert(0, 'vps-service'); import main"
```

---

## 🆘 استرداد الكوارث (Disaster Recovery)

### لو الـ Next.js مات ولا يريد أن يبدأ
```bash
cd /root/GLMinvestment
pm2 stop nextjs
rm -rf .next
bun run build
pm2 start nextjs --update-env
sleep 6
curl -s http://127.0.0.1:3000/api/health
```

### لو Python backend مات
```bash
cd /root/GLMinvestment
pm2 stop python-backend
source vps-service/venv/bin/activate
python3 -c "import sys; sys.path.insert(0,'vps-service'); import main" # تحقق imports
pm2 start python-backend --update-env
sleep 4
curl -s http://127.0.0.1:8010/health
```

### لو كل الخدمات معلقة (إعادة تشغيل كاملة)
```bash
cd /root/GLMinvestment
pm2 delete all
pm2 start ecosystem.config.js
sleep 15
pm2 status
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
```

### لو git في حالة سيئة (recover)
```bash
cd /root/GLMinvestment
git status
git fetch origin
git reset --hard origin/main  # ⚠️ يحذف كل التغييرات المحلية غير الملتزمة!
bash scripts/git-recover-and-push.sh  # سكريبت استرداد موجود في المشروع
```

---

## 📊 مراقبة الأداء (Monitoring)

### فحص استهلاك الذاكرة لكل خدمة
```bash
pm2 monit
# أو
pm2 list
```

### فحص system resources
```bash
free -h
df -h
top -bn1 | head -20
```

### فحص الـ cron jobs (لو موجودة)
```bash
crontab -l | head -30
```

---

## 🔐 أمان

### تغيير إعدادات Admin (لو لزم)
```bash
# المتغيرات المطلوبة في .env (لا تُرفع لـ GitHub):
# ADMIN_USERNAME=...
# ADMIN_PASSWORD=...
# ADMIN_EMAIL=...
# TELEGRAM_BOT_TOKEN=...
# TELEGRAM_CHAT_ID=...
# NEXTAUTH_SECRET=...
# NEXTAUTH_URL=https://invist.m2y.net
```

### فحص الـ Sentry للأخطاء الإنتاجية
```bash
# السجلات تُرسل تلقائياً عبر sentry.client.config.ts + sentry.server.config.ts
# راجع dashboard Sentry للتفاصيل
```

---

## 📞 في حالة الطوارئ

| المشكلة | الحل السريع |
|---|---|
| الموقع لا يفتح | `pm2 status` ← شوف nextjs شغال؟ لو لأ: `pm2 restart nextjs` |
| API يرجع 500 | `pm2 logs python-backend --lines 50` ← شوف الخطأ |
| الأسعار لا تتحدث | `pm2 restart data-engine` + `curl http://127.0.0.1:5000/health` |
| التوقعات متوقفة | `pm2 logs python-backend \| grep -i v40` + شغل `python3 scripts/v40_2_build_predictions.py` يدوياً |
| تيليجرام لا ينشر | `pm2 restart telegram-poster` + `pm2 logs telegram-poster --lines 50` |
| ذاكرة عالية | `pm2 monit` + شوف الخدمة الأكثر استهلاكاً + `pm2 restart <name>` |

---

## ⚠️ قواعد صارمة (CONSTITUTION)

1. **ممنوع لمس DBs الإنتاجية** إلا بأدوات read-only أو بعد إذن المالك (`restore_from_local.py`).
2. **ممنوع `restore_dbs.py`** أو أي سكريبت يكتب فوق DB إنتاجي.
3. **ممنوع force push** على `origin/main`.
4. **ممنوع `reset --hard`** بدون فهم تام للتغييرات التي ستُفقد.
5. **كل المسارات نسبية** (لا مسارات مطلقة مثل `/home/meme/...` في الكود).
6. **VERIFY-BEFORE-DELETE** — حتى الملفات التي تبدو ميتة يجب سؤال المالك قبل حذفها.
7. **لا بيانات وهمية** — كل اختبار يستخدم بيانات حقيقية أو لا يُنفذ.

