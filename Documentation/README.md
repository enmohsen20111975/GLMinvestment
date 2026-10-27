# GLMinvestment — دليل الاستثمار | التوثيق المرجعي

> **منصة استثمار متكاملة** للبورصة المصرية (EGX) + الأسواق العربية + الكريبتو + الذهب، بـ توقعات ذكية وإدارة مخاطر متقدمة.
>
> **الإنتاج:** `https://invist.m2y.net` · **المستودع:** `https://github.com/enmohsen20111975/GLMinvestment` · **الإصدار:** `3.4.41`
>
> **هذا الملف مكتوب من الكود الحقيقي** (`.ts`/`.tsx`/`.py`/`.prisma`) — وليس من توثيق قديم. آخر مراجعة: 2026-10-19 بعد نقل المشروع للساندبوكس.

---

## 📑 فهرس التوثيق (5 ملفات + الدستور)

| الملف | المحتوى |
|---|---|
| **`00-CONSTITUTION.md`** | الدستور الحاكم — 76 قاعدة ملزمة + الأدوار + KPIs + سياسة الشخصيات + سلامة DBs. **مصدر الحقيقة القانوني، لا يُلمس إلا بأمر المالك.** |
| **`README.md`** (هذا الملف) | نظرة عامة شاملة: المشروع، الـ stack، الأسواق، المعمارية، تشغيل، حالة، ترتيب قراءة. |
| **`01-ARCHITECTURE.md`** | البنية التقنية الكاملة: ألفا (الفرونت) + برافو (الباك) + data_engine + news-agent + الـ services والـ ports + تدفق البيانات + عقد الـ API. |
| **`02-DATABASES-AND-DATA.md`** | كل قواعد البيانات (17 DB) + Prisma schemas (auth + predictions) + الخريطة الكنسية للداتا + مصادر البيانات الخارجية + التعارضات المعروفة. |
| **`03-ENGINES-AND-LOGIC.md`** | محركات التحليل والتوصية: V40.2 + V38 + 30+ محلل + ML + AI + الرادار + SMC + Volume Profile + الباك تست + إدارة المخاطر + عتبات الإشارة. |
| **`04-TEAM.md`** | الفريق: المالك + جيمي + جون + ألفا + برافو + الوكلاء — الأدوار، النطاقات، المحظورات، الشخصيات، العلاقات. |

> كل ملفات التوثيق القديمة المبعثرة (27 ملف سابق في هذا المجلد + ملفات الـ root) نُقلت إلى `Documentation/archive/` كـ مرجع تاريخي. **المصدر الحي للحقيقة هو الـ 5 ملفات أعلاه + الدستور + `worklog.md` + `SESSION-STATE.md`.**

---

## 🎯 ما هو المشروع

منصة استثمار تقدّم:

- **توقعات ذكية** على 3 شخصيات (المضارب / المتوازن / المستثمر) — مولّدة من محرك **V40.2** (Python = العقل).
- **إدارة مخاطر متقدمة**: حجم الصفقة، وقف خسارة ATR `[5%, 9%]`، trailing stop كـ FLOOR، خروج جزئي عند 1R (`partial_1r_trailing`)، قاعدة 2%.
- **تتبّع صادق للأداء**: KPIs على الصفوف المغلقة فقط + HARD cap على الـ toxic returns (`ABS(actual_return) <= 50`).
- **رادار السيولة**: 4 أعمدة (phase + bucket + MFM + تدفق الحيتان) بـ تصنيف Mutually Exclusive (مستحيل سهم يظهر في "تجميع" و"تصريف" معاً).
- **بيانات حية** من EGKSCO + EGXPilot + Yahoo + TradingView + CoinGecko + metals.dev + Daleelak.
- **لوحات تحليل** للسوق، القطاعات، الأسهم الفردية، المحفظة، الرادار، التوقعات، الأخبار، الأكاديمية.
- **تكامل Telegram**: بوت تفاعلي + نشر تلقائي + شارتات + أكاديمية دروس.
- **توافق شرعي** + حاسبة تطهير (Tazkiyah) + زكاة + عشور.
- **متعدد الأسواق**: EGX + تداول (السعودية) + الكويت + قطر + أمريكا + كريبتو + دهب.

---

## 🧱 الـ Stack التقني (من `package.json` + `requirements.txt` + الكود)

| الطبقة | التقنية | الإصدار | الدور |
|---|---|---|---|
| **الفرونت (ألفا)** | Next.js + React + TypeScript | 14.2.28 / 18.2 / 5.9 | عرض فقط — SPA بشاشة وحيدة + 113 API route |
| **تنسيق الفرونت** | Tailwind CSS + shadcn/ui + Framer Motion | 3 / New York / 12 | نظام تصميم + حركات |
| **State (الفرونت)** | Zustand | 5.0.6 | كل الحالة (React Query مثبّت بس **صفر استخدام**) |
| **DBs (الفرونت)** | Prisma + better-sqlite3 + sql.js | 5.22 / 13 / 1.14 | auth.db + predictions.db (Prisma) + باقي DBs (better-sqlite3) |
| **Auth** | NextAuth.js | 4.24 | جلسات + Google OAuth + tokens |
| **الباك (برافو)** | Python + FastAPI + Flask | 3.11 / latest | العقل — كل المنطق والمحركات والحسابات |
| **Data Engine** | Python + Flask | latest | سحب الأسعار الحية من 20+ مصدر |
| **WebSocket** | Socket.io + Bun | 4.8 / latest | push لحظي للأسعار (port 3005) |
| **DBs (الباك)** | SQLite | 3 | 17 DB (شوف `02-DATABASES-AND-DATA.md`) |
| **AI** | Ollama (محلي) + DeepSeek API + z-ai-web-dev-sdk | — | LLM للتحليل + أخبار + قرارات |
| **ML** | sklearn (ملف `.pkl` واحد) | — | طبقة overlay (`ml_overlay_v1.pkl`) |
| **Gateway** | Caddy | — | توجيه الـ traffic (port 81) |
| **Process Manager (إنتاج)** | PM2 | 7 | 8 خدمات |

> ⚠️ **ملاحظة حرجة**: توثيق قديم (README الجذر) كان بيقول "Next.js 16" — ده **كاذب**. الكود الفعلي Next.js **14.2.28** + React **18.2**. الـ sandbox اللي اتنقل فيه المشروع كان Next 16 بس الاحتفاظ بـ stack الـ repo هو القرار الصحيح (رفع Next 16 = تدمير).

---

## 🏛️ المعمارية في صورة واحدة

```
┌─────────────────────────────────────────────────────────────────┐
│                    المتصفح / Flutter App                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ (HTTP + Socket.io)
┌───────────────────────────▼─────────────────────────────────────┐
│  Caddy Gateway (port 81)                                         │
│  - /?XTransformPort=<port> → توجيه ديناميكي                      │
│  - default → localhost:3000                                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
┌──────▼──────┐  ┌──────────▼──────────┐  ┌──────▼──────────┐
│ Next.js 3000│  │ Python FastAPI 8010 │  │ WS Socket.io 3005│
│  (ألفا)     │  │   (برافو — العقل)   │  │  (push لحظي)    │
│  عرض فقط    │◄─┤  V40.2 + 30 محلل   │  │  poll Python 2-30s│
│  113 route  │  │  محركات + مخاطر    │  └─────────────────┘
│  3 proxy ───┘  │  Flask mounted     │
└───────────────►┤  ~30 blueprint     │
                 └──────────┬──────────┘
                            │
                 ┌──────────▼──────────┐
                 │ data_engine 5000    │
                 │ (سحب الأسعار)       │
                 │ 20+ scraper         │
                 └──────────┬──────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
      EGKSCO/EGXPilot   CoinGecko/      metals.dev/
      Yahoo/TradingView Binance         Daleelak
            │
            ▼
    ┌──────────────────────────────────────┐
    │  SQLite DBs (17) — شوف 02-DATABASES  │
    │  stocks / data_engine / price_history│
    │  predictions / auth / news / intraday│
    └──────────────────────────────────────┘

  خدمات منفصلة: telegram-poster / telegram-interactive-bot /
                telegram-events / news-agent
```

**القاعدة الحاكمة (Rule 20 — Python=Brain):** Next.js ما بيعملش أي منطق — بس بـ يعرض ويـ proxie للـ Python على `:8010`. أي حساب في الواجهة = مخالفة.

---

## 📁 بنية المشروع (من الـ filesystem)

```
/home/z/my-project/
├── src/                      # ألفا — الفرونت (Next.js)
│   ├── app/                  # 113 API route + صفحات (admin, backtest, rescue, payment, legal)
│   │   ├── page.tsx          # الشاشة الرئيسية (SPA, 1081 سطر, switch بين 50 view)
│   │   ├── api/              # proxy/[...path] + python/[...path] + proxy-prod + 110 route آخر
│   │   ├── admin/            # server-side guard + صفحات أدمن
│   │   └── ...
│   ├── modules/              # 18 موديول (dashboard, stock-analysis, portfolio, radar, ...)
│   ├── components/           # ui/ (shadcn) + shared/ + layout/ + auth/ + ...
│   ├── lib/                  # DB clients + helpers + stores (zustand) + AI
│   ├── hooks/                # useAuthCheck, use-mobile, useSmartChart, ...
│   ├── middleware.ts         # Edge runtime — request-ID + route categorizer
│   └── instrumentation.ts    # metrics collector
├── vps-service/              # برافو — الباك بايثون (FastAPI port 8010)
│   ├── main.py               # FastAPI app — mount Flask + scheduler + migrations
│   ├── lightweight_server.py # Flask app — ~30 blueprint (maestro معطّل 410)
│   ├── engines/              # market_regime + backtest_engine (V38)
│   ├── engine/               # flow_system + persona_engine + crypto + explosive + ...
│   ├── glminvestment_engines/# Minervini/Turtle (VCP, Donchian, ATR, Stage2, Confluence v4)
│   ├── analyzers/            # 30+ محلل (master, core_scoring, sniper, smc, volume_profile, ...)
│   ├── ml_models/            # ml_overlay_v1.pkl (ملف sklearn واحد)
│   ├── ai/                   # 11 ملف — Ollama + DeepSeek + portfolio_routes + news_agent
│   ├── api/                  # 36 blueprint (admin, ai, canonical_flow, v2, confluence, ...)
│   ├── core/                 # migrator + db_manager + scheduler + router + analysis_runner
│   ├── jobs/                 # 13 cron (daily_predictor, daily_closer, intraday_scanner, ...)
│   ├── scripts/              # 80+ سكريبت (backtest, backfill, cleanup, migration)
│   ├── live_signals/         # داتا (egx_signals.json + crypto_signals.json)
│   ├── paper_trading/        # داتا
│   ├── portfolio/            # 9 ملف (position_manager, multi_target_exit, purification, ...)
│   ├── strategies_merge/     # 4 استراتيجيات A/B (correction/chase/merged/merged_strict)
│   ├── telegram/             # 15 ملف (auto_post_scheduler, interactive_bot, notifier, ...)
│   ├── ws-service/           # Socket.io على port 3005 (Bun)
│   ├── risk_management_advanced.py  # CANONICAL risk API (1901 سطر)
│   ├── analysis_engine_v2.py # Plugin-Based (4 plugins)
│   └── requirements.txt
├── data_engine/              # برافو — محرك البيانات (Flask port 5000)
│   ├── main.py               # 24 endpoint (/trigger/*, /control/*, /health)
│   ├── sync.py               # Full System Sync → stocks.db + WS broadcast
│   ├── realtime_sync.py      # webhook لـ Next.js (reload cache)
│   ├── intraday_storage.py   # intraday.db (3 جداول، 7 أيام احتفاظ)
│   ├── scrapers/             # 20 مصدر (EGKSCO, EGXPilot, Yahoo, TradingView, CoinGecko, ...)
│   ├── config/market_hours.py # أوقات البورصات (Africa/Cairo)
│   └── requirements.txt
├── news-agent/               # خدمة أخبار منفصلة (collectors: RSS/Telegram/mubasher/...)
├── telegram-events/          # خدمة events تليجرام
├── prisma/                   # schemas
│   ├── auth-schema.prisma    # 19 model (User, Session, Subscription, Watchlist, ...)
│   ├── predictions-schema.prisma # 10 model (Prediction, PersonaPrediction, StoredAnalysis, ...)
│   ├── schema.prisma         # placeholder (User+Post) — مش active
│   └── seed-subscriptions.ts # 3 plans (free/normal/premium)
├── db/                       # كل SQLite DBs (gitignored — متولّدة من data_engine)
├── scripts/                  # 339 سكريبت (root-level — backfill, cleanup, utils)
├── content/education/        # 21 درس تعليمي (محتوى، مش توثيق)
├── public/                   # static assets
├── Documentation/            # هذا التوثيق (5 ملفات + دستور + أرشيف)
├── agent-ctx/                # تكليفات الوكلاء السابقين (16 ملف — أرشيف)
├── audit-reports/            # تقارير تدقيق (11 ملف — أرشيف)
├── archive/                  # كود/داتا مؤرشفة
├── backups/                  # نسخ احتياطية
├── .zscripts/                # سكريبتات البيئة (dev.sh, start.sh, build.sh)
├── Caddyfile                 # gateway config (port 81)
├── ecosystem.config.js       # PM2 config (8 خدمات)
├── package.json              # Next.js scripts + deps
├── worklog.md                # سجل العمل الحي (دليل المالك)
├── SESSION-STATE.md          # حالة الجلسة الحالية
├── CHANGELOG.md              # سجل التغييرات
└── README.md                 # (الجذر — قديم، يحتاج تحديث)
```

---

## 🚀 التشغيل

### المتطلبات
- **Bun** + **Node.js 20+**
- **Python 3.11+** + `venv`
- **SQLite 3**

### التثبيت
```bash
git clone https://github.com/enmohsen20111975/GLMinvestment.git
cd GLMinvestment
bun install                                          # JS deps (1122 package)
cd vps-service && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && cd ..
cd data_engine && pip install -r requirements.txt && cd ..
bunx prisma db push --schema=prisma/auth-schema.prisma
bunx prisma db push --schema=prisma/predictions-schema.prisma
```

### التشغيل (تطوير — ساندبوكس)
```bash
# 1) Next.js (port 3000) — الفرونت
bun run dev

# 2) Python backend (port 8010) — العقل
cd vps-service && source venv/bin/activate && python3 main.py

# 3) Data engine (port 5000) — سحب الأسعار
cd data_engine && python3 main.py

# 4) WebSocket (port 3005) — push لحظي
cd vps-service/ws-service && bun run dev
```

### التشغيل (إنتاج — PM2)
```bash
pm2 start ecosystem.config.js    # 8 خدمات: nextjs, python-backend, data-engine, ws-service, telegram-poster, telegram-interactive-bot, telegram-events, news-agent
pm2 status
pm2 logs
```

> في الساندبوكس الحالي: **Next.js بس اللي شغّال** (port 3000). الباك بايثون (8010) + data_engine (5000) + WS (3005) **مش شغالين**، والـ DBs داتا السوق فاضية (gitignored). شاشات الداتا هتظهر فاضية/إيرور لحد ما برافو تشتغل.

---

## 📊 الحالة الحالية (2026-10-19)

### ✅ شغّال
- الـ repo في `/home/z/my-project` بـ history كامل (274 commit).
- Next.js 14.2.28 dev server على port 3000 (مستقر، homepage بيرجع HTTP 200).
- الفرونت (ألفا) بيـ render ويتفاعل (onboarding + dashboard + admin).
- Prisma clients مولّدين (auth + predictions). `db/auth.db` + `db/predictions.db` متخلقين (فاضيين).
- `00-CONSTITUTION.md` + الـ 5 ملفات التوثيقية دي موجودة.

### 🔴 معلّق (BLOCKED)
- **الباك بايثون (برافو)** مش شغّال → `/api/market/overview`, `/api/market-pulse` بترجع 500 (`SQLITE_CANTOPEN` على `db/stocks.db`). `/api/predictions/eid` بترجع 503.
- **DBs داتا السوق فاضية**: `stocks.db`, `data_engine.db`, `price_history.db`, `news.db`, `intraday.db`, `historical.db` — كلها gitignored ومتولّدة من `data_engine` scrapers.
- **تعارضات DBs معروفة** (شوف `02-DATABASES-AND-DATA.md`): price_history 4 مخازن متوازية، gold_prices.db phantom، crypto.db متقسم.

### المطلوب بعد كده
1. **برافو**: تشغيل Python backend + data_engine + backfill لداتا السوق التاريخية والحية.
2. **برافو**: توحيد price_history (4 مخازن → 1 canonical).
3. **ألفا**: DESIGN-SYSTEM Phase 1 (tokens wire) → A-P4 (admin hubs 26→4-5).
4. **أمني**: revoke توكن GitHub المحروق (لو لسه) + استبدال في `~/.git-credentials`.

---

## 📖 ترتيب القراءة (إلزامي قبل أي عمل)

1. **`Documentation/00-CONSTITUTION.md`** — الدستور (76 قاعدة).
2. **`Documentation/README.md`** (هذا الملف) — نظرة عامة.
3. **`Documentation/01-ARCHITECTURE.md`** — البنية التقنية.
4. **`Documentation/02-DATABASES-AND-DATA.md`** — الـ DBs والداتا.
5. **`Documentation/03-ENGINES-AND-LOGIC.md`** — المحركات والمنطق.
6. **`Documentation/04-TEAM.md`** — الفريق والأدوار.
7. **`SESSION-STATE.md`** (الجذر) — آخر حالة للجلسة.
8. **`worklog.md`** (الجذر) — آخر ~150 سطر لمعرفة آخر شغل.

---

## 🔗 روابط رسمية

- **الإنتاج:** `https://invist.m2y.net` — المسار على الـ VPS: `/root/GLMinvestment/`
- **GitHub (المنصة):** `https://github.com/enmohsen20111975/GLMinvestment`
- **GitHub (تطبيق Flutter):** `https://github.com/enmohsen20111975/flutter_investment_App`
- **الملف الرسمي للروابط:** `Documentation/الروابط الرسمية .txt`

---

*هذا التوثيق مكتوب من الكود الحقيقي بواسطة جون (المدير التنفيذي) في 2026-10-19. أي تعارض بين هذا التوثيق والتوثيق المؤرشف — هذا هو الصحيح.*
