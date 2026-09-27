# دليل الاستثمار - دليل النشر

## المتطلبات
- خادم Ubuntu 20.04+ أو أي توزيعة Linux حديثة
- Python 3.9+
- 2GB RAM كحد أدنى
- 10GB مساحة تخزين

## أوامر النشر السريعة

### الطريقة 1: النشر التلقائي (موصى بها)

```bash
# 1. استنساخ المشروع
git clone https://github.com/YOUR_USERNAME/egx-investment-platform.git
cd egx-investment-platform/vps-service

# 2. تشغيل سكربت النشر
chmod +x deploy.sh
sudo ./deploy.sh --systemd
```

### الطريقة 2: النشر اليدوي

```bash
# 1. تثبيت المتطلبات
sudo apt update
sudo apt install -y python3 python3-pip python3-venv nginx supervisor

# 2. استنساخ المشروع
git clone https://github.com/YOUR_USERNAME/egx-investment-platform.git
cd egx-investment-platform/vps-service

# 3. إنشاء البيئة الافتراضية
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn

# 4. إنشاء المجلدات
mkdir -p data logs live_signals

# 5. تشغيل الخادم
gunicorn --bind 0.0.0.0:8010 --workers 4 --threads 2 main:app
```

### الطريقة 3: Docker

```bash
# بناء وتشغيل
docker-compose up -d

# عرض السجلات
docker-compose logs -f

# إيقاف
docker-compose down
```

## أوامر الإدارة

### التحقق من حالة الخادم
```bash
# Health check
curl http://localhost:8010/health

# Scheduler status
curl http://localhost:8010/api/scheduler/status
```

### إدارة Supervisor
```bash
# حالة الخدمة
sudo supervisorctl status egx-backend

# إعادة التشغيل
sudo supervisorctl restart egx-backend

# إيقاف
sudo supervisorctl stop egx-backend

# تشغيل
sudo supervisorctl start egx-backend
```

### عرض السجلات
```bash
# سجلات Gunicorn
tail -f /opt/egx-platform/logs/gunicorn.log

# سجلات الأخطاء
tail -f /opt/egx-platform/logs/gunicorn-error.log
```

### تحديث النشر
```bash
cd /opt/egx-platform
git pull origin main
cd vps-service
source venv/bin/activate
pip install -r requirements.txt
sudo supervisorctl restart egx-backend
```

## إعداد Nginx (اختياري)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## إعداد SSL مع Certbot

```bash
# تثبيت Certbot
sudo apt install certbot python3-certbot-nginx

# الحصول على شهادة SSL
sudo certbot --nginx -d your-domain.com

# التجديد التلقائي
sudo crontab -e
# أضف هذا السطر:
0 0 * * * certbot renew --quiet
```

## API Endpoints

| Endpoint | الوصف |
|----------|-------|
| `GET /health` | فحص صحة الخادم |
| `GET /api/v2/scan` | أفضل الفرص |
| `GET /api/v2/scanner` | ماسح السوق |
| `GET /api/v2/analysis/<ticker>` | تحليل سهم |
| `GET /api/v2/forecast/<ticker>` | توقع السعر |
| `GET /api/stocks` | قائمة الأسهم |
| `GET /api/scheduler/status` | حالة المجدول |

## استكشاف الأخطاء

### الخادم لا يعمل
```bash
# تحقق من السجلات
tail -f /opt/egx-platform/logs/gunicorn-error.log

# تحقق من المنفذ
sudo lsof -i :8010

# تحقق من صحة الكود
cd /opt/egx-platform/vps-service
source venv/bin/activate
python -c "import main"
```

### مشاكل قاعدة البيانات
```bash
# التحقق من وجود الملف
ls -la /opt/egx-platform/vps-service/data/

# إعادة إنشاء الجداول
python scripts/init_db_tables.py
```

### مشاكل الذاكرة
```bash
# زيادة عدد العمال (workers) في supervisor config
# أو تقليلها إذا كانت الذاكرة محدودة
```

## النسخ الاحتياطي التلقائي (بعد الإعداد)

بعد تثبيت الخدمة على VPS، أضف مهمة النسخ الاحتياطي اليومية:

```bash
cd /home/z/my-project
bash scripts/setup-backup-cron.sh
```

هذا يضيف cron job ينفذ `scripts/auto-backup.sh` يومياً الساعة 3 صباحاً.
النسخ القديمة (أكثر من 7 أيام) تُحذف تلقائياً.

## الدعم
- GitHub Issues: https://github.com/YOUR_USERNAME/egx-investment-platform/issues
- Email: support@your-domain.com
