# 07 — النشر والتشغيل

> **آخر تحديث:** 2026-10-25 | **Commit:** `a3d1d8b`

---

## 1. البيئة

| | Sandbox (Dev) | VPS (Production) |
|---|---|---|
| **OS** | Cloud sandbox | Ubuntu VPS |
| **Node** | 24.x | 22+ |
| **Bun** | 1.x | 1.x |
| **Python** | 3.12 | 3.12 (.venv) |
| **Next.js** | 16.1.3 (Turbopack dev) | 16.1.3 (Webpack prod) |
| **DBs** | غير متوفرة (compressed) | متوفرة (1.5GB+) |
| **Python Backend** | غير مشغل | PM2 `python-backend` |
| **Data Engine** | غير مشغل | PM2 `data-engine` |

## 2. PM2 Services (ecosystem.config.js)

| # | Service | Port | Auto-restart |
|---|---------|------|-------------|
| 1 | python-backend | 8010 | ✅ |
| 2 | data-engine | 5000 | ✅ |
| 3 | nextjs | 3000 | ✅ |
| 4 | ws-service | 3005 | ✅ |
| 5 | telegram-poster | — | ✅ |
| 6 | telegram-interactive-bot | — | ✅ |
| 7 | telegram-events | 3003 | ✅ |
| 8 | news-agent | — | ✅ |

## 3. الأوامر

```bash
# Development (sandbox)
bun run dev                    # Next.js dev (:3000)

# Production (VPS)
bun run build                  # Next.js build (Webpack)
pm2 start ecosystem.config.js  # كل الخدمات
pm2 status                     # حالة الخدمات
pm2 logs                       # السجلات
pm2 restart all                # إعادة تشغيل
```

## 4. Caddy Gateway

```caddyfile
:81 {
  # Default → Next.js :3000
  # ?XTransformPort=8010 → Python :8010
  # ?XTransformPort=3005 → WS :3005
  # ?XTransformPort=3003 → Telegram Events :3003
}
```

## 5. Cron Jobs

| Job | Schedule (Cairo) | Output |
|-----|-----------------|--------|
| Daily Predictor | 14:30 post-close | predictions.db.predictions |
| Daily Closer | 14:35 post-close | updates outcomes |
| Nightly Quant Cache | 03:00 | quant_cache table |
| Nightly AI Analysis | 02:00 | stored_analyses ai_* columns |
| WAL Checkpoint | hourly | PRAGMA wal_checkpoint |
| Crypto Lab | every 5min 24/7 | crypto_predictions_log |

## 6. النسخ الاحتياطي

| النوع | الموقع | التردد |
|------|-------|--------|
| DB snapshot | `db_release_20261025/` | يدوي |
| Weekly backup | `data/db_backup_*` | أسبوعي |
| Code backup | `db/code_backup_*` | عند الطلب |
| GitHub push | origin/main | بعد كل مهمة |

## 7. مراقبة الأداء

| Metric | المصدر | الـ Endpoint |
|--------|---------|------------|
| CPU/RAM | PM2 | `/api/admin/system-resources` |
| DB size | SQLite | `/api/admin/databases` |
| Engine status | PM2 | `/api/admin/engines-status` |
| Cache freshness | radar_cache_status.json | `/api/maker-radar` |
| News health | news.db | `/api/admin/news-health` |
