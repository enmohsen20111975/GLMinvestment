# GLMinvestment — دليل الاستثمار (EGX Investment Platform)

> **منصة استثمار البورصة المصرية (EGX) — تحليلات ذكية + توقعات + إدارة مخاطر**
>
> **الإنتاج:** https://invist.m2y.net · **GitHub:** https://github.com/enmohsen20111975/GLMinvestment
> **الإصدار:** `3.4.41` · آخر update: 2026-08-09 (P0-v2, commit `ed55a60c`)

---

## 🎯 نظرة عامة

منصة استثمار متكاملة للبورصة المصرية، بـ توفّر:
- **توقعات ذكية** على 3 شخصيات (المضارب / المتوازن / المستثمر)
- **إدارة مخاطر متقدمة** (حجم الصفقة، وقف خسارة، trailing، forced exit)
- **تتبّع صادق للأداء** (CLEAN-only KPIs + HARD cap على toxic returns)
- **بيانات حية** من TradingView + شموع يومية من Yahoo Finance
- **لوحات تحليل** للسوق، القطاعات، والأسهم الفردية

### المعمارية

| الطبقة | التقنية | المنفذ | الدور |
|--------|---------|--------|-------|
| **الباك-إند (الدماغ)** | Python Flask | `8010` | كل المنطق: predictions, scoring, risk, persona, analysis |
| **Data-Engine** | Python Flask | `5000` | جلب الأسعار الحية (TradingView) → `stocks.db` |
| **الواجهة (العرض)** | Next.js 16 | `3000` | عرض فقط — كل logic في Python |
| **WebSocket** | Bun/TS socket.io | `3005` | real-time push للأسعار |
| **Gateway** | Caddy | `80/443` | يوجّه كل الـ traffic |

**القاعدة الحاكمة:** `Python = العقل، Node = العرض فقط`. الـ Next.js ما بيعملش أي logic — بس بـ ي proxie للـ Python على `:8010`.

---

## 🚀 التشغيل السريع

### المتطلبات
- **Bun** (runtime JS) + **Node.js 20+**
- **Python 3.11+** + `venv`
- **SQLite 3**

### التثبيت

```bash
git clone https://github.com/enmohsen20111975/GLMinvestment.git
cd GLMinvestment

# JS dependencies
bun install

# Python dependencies
cd vps-service && python3 -m venv venv && source venv/bin/pip install -r requirements.txt && cd ..

# قواعد البيانات
bunx prisma db push --schema=prisma/predictions-schema.prisma
python3 scripts/init_db_safety.py    # WAL + busy_timeout
```

### التشغيل (تطوير)

```bash
# الطرفية 1: Next.js (port 3000)
bun run dev

# الطرفية 2: Python backend (port 8010)
cd vps-service && source venv/bin/activate && python3 main.py

# الطرفية 3: Data-engine (port 5000) — اختياري للأسعار الحية
cd data_engine && python3 app.py
```

### التشغيل (إنتاج عبر pm2)

```bash
pm2 start ecosystem.config.js
pm2 status    # اتأكد إن python-backend + nextjs + data-engine + ws-service online
```

---

## 📁 بنية المشروع

```
GLMinvestment/
├── vps-service/              # 🧠 الباك-إند (الدماغ) — Python Flask على :8010
│   ├── api/                  #   مسارات الـ API (Blueprints)
│   ├── analyzers/            #   maestro_orchestrator, prediction_tracker, scoring
│   ├── core/                 #   opportunity_quality, migrator
│   ├── jobs/                 #   daily_closer, price_history_safetynet, market_scheduler
│   ├── data/                 #   eodhd_fetcher, gap_filler, egksco_scraper
│   └── config/               #   unified_config, market_hours
├── src/                      # 🎨 الواجهة — Next.js 16 على :3000
│   ├── app/                  #   App Router pages + api/ proxy routes
│   ├── components/           #   React components (shadcn/ui based)
│   └── lib/                  #   utils, db, auth
├── data_engine/              # 📡 جلب الأسعار الحية على :5000 → stocks.db
├── mini-services/            # 🔌 خدمات منفصلة (websocket, telegram)
├── scripts/                  # 🛠️ سكربتات صيانة DB + diagnostics + backfill
├── db/                       # 💾 قواعد بيانات SQLite
│   ├── predictions.db        #   التوقعات + outcomes + persona
│   ├── stocks.db             #   الأسهم الحية (intraday)
│   ├── price_history.db      #   الشموع اليومية (OHLC)
│   └── data_engine.db        #   بيانات الـ data-engine
├── prisma/                   # 📋 Prisma schemas
├── Documentation/            # 📚 التوثيق الشامل
├── docs/                     # 📄 توثيق إضافي
├── ecosystem.config.js       # ⚙️ إعداد pm2
├── Caddyfile                 # 🌐 إعداد الـ gateway
└── package.json              # 📦 dependencies + scripts
```

---

## 🛡️ حماية البيانات (مُفعّلة)

| النظام | الملف | الدور |
|--------|------|-------|
| **W1-W9 Write-time Rejection** | `maestro_orchestrator.py` | يرفض التوقعات السامة قبل الكتابة (entry≤0, target≤entry, R:R≤0, ...) |
| **CLEAN/TOXIC classification** | `scripts/data_quality_rules.py` | يصنّف الصفوف المغلقة: clean (|return|≤50) / toxic / pending |
| **DailyCloser** | `vps-service/jobs/daily_closer.py` | يقفل الصفقات كل 15 دقيقة بصيغة BUY/SELL صحيحة |
| **price_history Safetynet** | `vps-service/jobs/price_history_safetynet.py` | Yahoo gap-fill كل 6 ساعات (مش بيعتمد على EODHD) |
| **Stale Monitor** | `vps-service/jobs/price_history_stale_monitor.py` | hourly alert لو `price_history.db` متجمّد > 1 يوم |
| **HARD toxic-row cap** | 3 API routes | `ABS(actual_return) <= 50` في WHERE — يمنع toxic rows من تلوث KPIs |

---

## 📚 التوثيق

> **توحيد 2026-08-17:** كل ملفات `Documentation/` السابقة (CURRENT_STATE، PROJECT_FULL_BLUEPRINT، API_DICTIONARY، 03-REFACTORING_REPORT، إلخ) دُمجت بالكامل في **4 ملفات رئيسية** فقط.

| الملف | الدور |
|------|------|
| [`Documentation/00-CONSTITUTION.md`](Documentation/00-CONSTITUTION.md) | ⭐ الدستور — القواعد + KPIs + سير العمل (ابدأ هنا) |
| [`Documentation/01-PROJECT_ANATOMY.md`](Documentation/01-PROJECT_ANATOMY.md) | التشريح الكامل (المعمارية، DBs، APIs، تدفق البيانات) |
| [`Documentation/02-SCREENS_AND_COMPONENTS.md`](Documentation/02-SCREENS_AND_COMPONENTS.md) | كل شاشة ومكوّن بحالته + الديون التقنية |
| [`Documentation/SYSTEM_HOW_IT_THINKS.md`](Documentation/SYSTEM_HOW_IT_THINKS.md) | كيف يفكر النظام (المنطق + R:R + fundamentals) |
| [`AGENTS.md`](AGENTS.md) | دليل سير العمل لأي agent |
| [`SYSTEM_STATE.md`](SYSTEM_STATE.md) | آخر حالة للنظام (المرجع الحي) |
| [`CHANGELOG.md`](CHANGELOG.md) | سجل التغييرات الكامل |
| [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) | دليل النشر التفصيلي |
| [`worklog.md`](worklog.md) | سجل عمل الـ agents (append-only) |

---

## 🔧 الـ Tech Stack

| الفئة | التقنية |
|------|---------|
| **Framework** | Next.js 16 (App Router) + React 19 |
| **Language** | TypeScript 5 + Python 3.11 |
| **Styling** | Tailwind CSS 4 + shadcn/ui (New York) |
| **Database** | SQLite + Prisma ORM |
| **Auth** | NextAuth.js v4 |
| **State** | Zustand (client) + TanStack Query (server) |
| **Icons** | Lucide React |
| **Real-time** | socket.io (Bun/TS mini-service) |
| **Gateway** | Caddy |
| **Process Manager** | pm2 |
| **Runtime** | Bun (JS) + Python venv |

---

## 📜 الترخيص

ملكية خاصة — © GLMinvestment. جميع الحقوق محفوظة.
