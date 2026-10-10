# GLMinvestment — دليل الاستثمار (EGX Investment Platform)

> **منصة استثمار البورصة المصرية (EGX) — تحليلات ذكية + توقعات + إدارة مخاطر**
>
> **الإنتاج:** https://invist.m2y.net · **GitHub:** https://github.com/enmohsen20111975/GLMinvestment
> **الإصدار:** `3.4.41` · آخر update: 2026-10-01 (Task `FIX-WAVE-4-DOCS`)

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

> **توحيد 2026-10-01 (Task `DOC-SYNC-FULL`):** كل ملفات `Documentation/` السابقة (134 ملف توثيقي قديم) دُمجت بالكامل في **6 ملفات canonical** فقط + هذا الـ README.

| # | الملف | الدور |
|---|------|------|
| 00 | [`Documentation/00-CONSTITUTION.md`](Documentation/00-CONSTITUTION.md) | ⭐ الدستور — القواعد (62 قاعدة) + KPIs + سير العمل (ابدأ هنا) |
| 01 | [`Documentation/01-PROJECT_ANATOMY.md`](Documentation/01-PROJECT_ANATOMY.md) | التشريح الكامل (المعمارية، DBs، APIs، تدفق البيانات) |
| 02 | [`Documentation/02-SCREENS_AND_COMPONENTS.md`](Documentation/02-SCREENS_AND_COMPONENTS.md) | كل شاشة ومكوّن بحالته + الديون التقنية |
| 03 | [`Documentation/03-API_REFERENCE.md`](Documentation/03-API_REFERENCE.md) | مرجع الـ APIs الشامل — كل 690 route موثّقة عبر 24 قسم |
| 04 | [`Documentation/SYSTEM_HOW_IT_THINKS.md`](Documentation/SYSTEM_HOW_IT_THINKS.md) | كيف يفكر النظام (المنطق + R:R + fundamentals) |
| 05 | [`Documentation/05-CURRENT_STATE.md`](Documentation/05-CURRENT_STATE.md) | الحالة الحالية للكود — يحلّ محل كل الـ audit-logs + reports + deployment |
| — | [`Documentation/README.md`](Documentation/README.md) | الفهرس — يشرح الـ 6 ملفات canonical |
| — | [`Documentation/BACKLOG.md`](Documentation/BACKLOG.md) | أفكار مؤجّلة من الاجتماع الاستراتيجي (2026-10-01) — 42 فكرة (Wave 2-4) |
| — | [`worklog.md`](worklog.md) | سجل عمل الـ agents (append-only) |

> **ملاحظة:** الـ AGENTS.md / SYSTEM_STATE.md / CHANGELOG.md / DEPLOYMENT_GUIDE.md اللي كانت في الجذور — تم دمج كلها في الـ 6 ملفات canonical أعلاه (Task `DOC-CONSOLIDATION` — 2026-09-30). مفيش حاجة تانية في الجذور غير الـ README + worklog.

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
