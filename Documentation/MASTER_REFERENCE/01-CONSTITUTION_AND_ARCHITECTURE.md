# 01-CONSTITUTION_AND_ARCHITECTURE.md

> **الملف المرجعي الأول** — دستور المشروع + المعمارية + القواعد الإلزامية.
> مصدر الحقيقة الوحيد للقواعد والبنية. أي تعارض مع الكود الفعلي يُرفع للمالك.

---

## 1. هوية المشروع

| البند | القيمة |
|---|---|
| **الاسم** | GLMinvestment (egx-investment-platform) |
| **الإصدار** | 3.4.41 |
| **الإنتاج** | https://invist.m2y.net |
| **المستودع** | https://github.com/enmohsen20111975/GLMinvestment |
| **المالك** | المهندس محسن (Co-Founder & Chairman) |
| **المعمارية** | Python = العقل، Node = العرض فقط |

### الفلسفة
منصة استثمار مؤسسية للبورصة المصرية (EGX) + أسواق خليجية (TADAWUL/KSE/QSE) + العملات الرقمية (CRYPTO) + الذهب. تقدّم توقعات ذكية + إدارة مخاطر + تتبّع صادق للأداء + إنقاذ للصفقات المتعثرة.

**المبدأ الحاكم**: "مشروع حقيقي لأموال حقيقية — الحقيقة المجردة الصادمة أشرف وأربح بآلاف المرات من أي نسبة فوز وهمية."

---

## 2. القواعد الإلزامية (82 قاعدة)

القواعد مقسّمة إلى 4 طبقات. كل قاعدة لها رقم + اسم + نص + عقوبة للكسر.

### 🔴 الطبقة 1 — القواعد المطلقة (Rule 1-30)

#### Rule 1 — لا تُلمس قواعد البيانات على الإنتاج
قواعد البيانات المرجعية للقراءة فقط. أي اختبار يحتاج كتابة يعمل على نسخة مؤقتة معزولة.

#### Rule 4 — لا شاشات/ملفات/أنظمة جديدة إلا في الطوارئ
لدينا 20 صفحة، 9 منها ميتة. لا تنشئ `page.tsx`/`.tsx`/`route.ts` جديد بدون موافقة المالك. الأولوية: تنظيف → حذف → دمج → تعديل → إضافة.

#### Rule 5 — كل كود جديد لازم يتربط
من الباك-إند ← API ← بروكسي ← الواجهة. لا كود معزول.

#### Rule 16 — تحقّق قبل الحذف (VERIFY-BEFORE-DELETE)
3 خطوات قبل حذف أي ملف: (1) استدعاءات الواجهة (2) تسجيل blueprint (3) سجل الأداء.

#### Rule 17 — المسارات نسبية دائمًا (RELATIVE-PATHS-ONLY)
ممنوع `/home/z/...` أو `/root/...` hardcoded. استخدم `__dirname` أو `process.cwd()`.

#### Rule 20 — Python = العقل، Node = العرض فقط (RULE20-PURE-PROXY)
- 17 Node routes اتحوّلت لـ pure thin proxies (~3,300 سطر logic أُزيلت).
- ممنوع أي logic مالي في React.
- `Math.random()` مقتصر على ID generation + A/B testing + Simulation (مصرّح).

#### Rule 27 — لا بيانات كاذبة (NO-FAKE-DATA)
- NULL = `null` (NOT 0, NOT 50, NOT placeholder).
- الـ client يعرض "— بيانات غير متاحة".
- ممنوع fabrication حتى مع `source: 'stub'` label.

#### Rule 28 — لا تكرار (NO-DUPLICATION)
ممنوع شاشة/تبويب/endpoint بنفس وظيفة موجود. وسّع الموجود بدل إنشاء جديد.

#### Rule 29 — نظام متكامل واحد (UNIFIED-SYSTEM)
كل ملف/مكوّن/endpoint مرتبط + مستخدم فعلاً. ممنوع مكدس Node موازي للـ Python.

#### Rule 30 — الشاشات للعميل بأسلوب احترافي (CLIENT-FACING-STYLE)
- احترافي/وقور/مباشر، عربي فصيح.
- لا عبارات تحميسية (Rule 31).
- لا إيموجي زائد.
- شاشة الأدمن فقط تقنية.
- **ممنوع blue/indigo** — emerald/teal/amber/red/slate فقط.

#### Rule 31 — لا عبارات تحميسية (NO-HYPE-LANGUAGE)
ممنوع "🚀 انطلق!" / "💰 كن ثرياً!" / "انطلق في رحلتك الاستثمارية". نص محايد وظيفي فقط.

### 🔴 الطبقة 2 — قواعد البيانات والمال (Rule 33-52)

#### Rule 50 — المال كحياة العميل (MONEY-AS-CUSTOMER-LIFE)
كل رقم في شاشات المحفظة/الثروة/التنبيهات لازم يكون رقم حقيقي من الـ DB. لا mock data.

#### Rule 52 — مكونات قابلة لإعادة الاستخدام موحّدة (UNIFIED-REUSABLE-COMPONENTS)
- `UnifiedTable` إلزامي لأي جدول.
- `UnifiedPublishButton` إلزامي لأي زر نشر.
- `StockSearchSelector` للبحث.
- `ExchangeSelector` لمبدّل الأسواق.

### 🔴 الطبقة 3 — القواعد الكنسية (Rule 60-80)

#### Rule 60 — نظام الوحدات (MODULE-SYSTEM)
كل كود جديد في `src/modules/<module>/` (17 frontend module) أو `vps-service/modules/<module>/` (8 backend module).

#### Rule 63 — لا ملفات جديدة (NO-NEW-SCREENS-FILES)
ممنوع إنشاء شاشة/ملف جديد إلا بموافقة صريحة. الأولوية: تنظيف → حذف → دمج → تعديل → إضافة.

#### Rule 67b — الحسابات الكنسية (CALCULATION-CANONICAL)
كل حساب له canonical file واحد:
- `vps-service/analyzers/indicators/atr.py` (Wilder's smoothing)
- `vps-service/analyzers/indicators/rsi.py`
- `vps-service/analyzers/indicators/ma.py`
- `vps-service/analyzers/indicators/srsi.py`
- TS ports: `src/lib/canonical-signal.ts` + `canonical-rsi.ts` + `canonical-price.ts`

#### Rule 72 — عقد البيانات الموحّد (UNIFIED-DATA-CONTRACT)
16 canonical metric. كل شاشة تعرضها تستورد من canonical module.

#### Rule 73 — مصدر عرض واحد (SINGLE-DISPLAY-SOURCE)
كل شاشة تعرض decision data تقرأ من `/api/stocks/[ticker]/unified`. ممنوع قراءة signal/master_score/entry/target/stop من أكثر من مصدر.

#### Rule 78 — التعرّض المشروط للصفقات (CONDITIONAL-TRADE-EXPOSURE)
- `TradePlanCard` يظهر فقط لـ BUY/STRONG_BUY/ACCUMULATE.
- SELL/AVOID → شريط أحمر + "لا توجد فرصة شراء".
- REDUCE → شريط amber.
- HOLD/WAIT → شريط amber خفيف + "انتظر تأكيد الإشارة".

#### Rule 80 — تناسق تدفق الأموال (MONEY-FLOW-CONSISTENCY)
ممنوع تصنيف "سيولة داخلة" لو `buy_pct < 45%` أو `net_flow < 0` → "🔴 ضغط بيعي" إلزامي.

### 🔴 الطبقة 4 — قواعد العمل والفريق (Rule 76-82)

#### Rule 76 — مراجعة شغل الفريق (TEAM-WORK-REVIEW)
قبل أي مهمة: `git pull --rebase` + قراءة آخر 200-300 سطر worklog + آخر 3-5 commits.

#### Rule 81 — ممنوع نهائيًا `--force` (ABSOLUTE FORBIDDEN --force)
ممنوع نهائيًا تنفيذ `git push --force` أو `--force-with-lease` من أي ساندبوكس.

#### Rule 82 — إلزام الدليل القابل للفحص (VERIFIABLE-PROOF-MANDATE)
لا يُعتد بأي تقرير إصلاح بدون دليل رقمي قابل للفحص (Test Output + File diff).

---

## 3. المعمارية الشاملة

```
┌─────────────────────────────────────────────────────────────────┐
│                    المستخدم (Browser / Flutter)                  │
└────────────┬────────────────────────────────────┬───────────────┘
             │                                    │
             ▼                                    ▼
┌────────────────────────┐          ┌─────────────────────────────┐
│   Caddy (Gateway)      │          │   Flutter App (Mobile)      │
│   :80 → :443 redirect  │          │   /api/mobile/* endpoints   │
│   :443 auto-TLS        │          └──────────────┬──────────────┘
│   Security headers     │                         │
│   XTransformPort       │                         │
└────────────┬───────────┘                         │
             │                                     │
             ▼                                     │
┌──────────────────────────────────────────────────┘
│   Next.js 14 (nextjs service — port 3000)
│   ├── SPA hash routing (#view → page.tsx switch)
│   ├── 17 frontend modules (src/modules/)
│   ├── 463 API routes (src/app/api/)
│   ├── shadcn/ui (new-york) + Recharts + Cairo font
│   ├── 3 Prisma schemas (auth + predictions + default)
│   ├── better-sqlite3 direct access (91 files)
│   ├── cache-manager.ts (SSOT — LRU + TTL)
│   ├── canonical-signal.ts (TS port of Python)
│   └── Sentry (client + server, safe no-op if DSN unset)
│
│   ├── proxy-server.js (sandbox only — :3000 → :3001)
│   └── watchdog.sh (auto-restart on crash)
└────────────┬───────────────────────────────────────────────────┘
             │ pythonFetch() — pure thin proxy (Rule 20)
             ▼
┌─────────────────────────────────────────────────────────────────┐
│   Python Backend (python-backend service — port 8010)            │
│   ├── Flask + gunicorn (4 workers × 2 threads, timeout 120s)    │
│   ├── vps-service/ — THE BRAIN                                   │
│   │   ├── analyzers/ (126 files, 39 active)                     │
│   │   │   ├── indicators/ (atr.py, rsi.py, ma.py, srsi.py)      │
│   │   │   ├── core_scoring_engine.py (V40.2 — THE BRAIN)        │
│   │   │   ├── master_analyzer.py (الدمج الموحد)                  │
│   │   │   ├── v68_oracle.py (probability/fingerprint)            │
│   │   │   └── [v82, sniper, confluence_v3, board_of_analysts]   │
│   │   │       (DISABLED — SUB_ENGINE_DISABLED=True)              │
│   │   ├── engines/ (backtest_engine, historical_backfill)        │
│   │   ├── modules/ (8 backend modules)                          │
│   │   ├── routes/ (unified_v2, misc, scanner, chart)            │
│   │   ├── scripts/ (auto_git_sync, apply_guard_triggers)        │
│   │   └── utils/ (canonical_signal.py, shared_liquidity.py)     │
│   └── Dockerfile (Python 3.11-slim + HEALTHCHECK)                │
└────────────┬───────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│   Data Engine (data-engine service — port 5000)                  │
│   ├── Flask — يجلب البيانات (TradingView, Yahoo, EODHD)          │
│   ├── scrapers/ (egksco, crypto, gold, forex, silver)           │
│   └── يكتب في data_engine.db (stocks + prices + news + sharia)   │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│   Databases (SQLite)                                             │
│   ├── auth.db (18 models — User, Account, Session, ApiToken...) │
│   ├── predictions.db (10 models — Prediction, PersonaPred...)  │
│   ├── stocks.db (user_stock_watchlists, portfolio_assets...)   │
│   ├── data_engine.db (stocks, prices, news, sharia_metrics)   │
│   ├── intraday.db (intraday prices)                           │
│   └── metrics.db (system metrics + anomaly detection)         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│   Services الإضافية                                              │
│   ├── ws-service (port 3005) — Socket.io real-time push         │
│   ├── telegram-events (port 3003) — Telegram bot bridge         │
│   ├── telegram-poster + telegram-interactive-bot                │
│   └── news-agent — يجمع الأخبار + يرسلها لـ Python              │
└─────────────────────────────────────────────────────────────────┘
```

### الإجمالي
- **583,991 LOC** (290,446 TS + 291,173 Python + scripts)
- **463 API routes** في 100 مجموعة
- **30 Prisma models** (18 auth + 10 predictions + 2 default)
- **7 DBs** (auth + predictions + stocks + data_engine + intraday + metrics + custom)
- **8 PM2 services**

---

## 4. الوحدات (Modules)

### Frontend Modules (17 في `src/modules/`)
| الوحدة | المكونات | الوظيفة |
|---|---|---|
| admin | 40+ | لوحة الإدارة (20+ sub-tabs) |
| auth | 1 | DevLoginForm (admin dev only) |
| crypto | 2 | CryptoPortfolioView + CryptoPredictionTracking |
| dashboard | 19 | DashboardView + RealtimeTicker + LiveMonitor |
| education | 10 | AcademyView + LearningVisuals |
| market-analysis | 20 | MarketAnalysisView + ProfessionalTradingChart |
| news | 1 | NewsFeedView |
| portfolio | 12 | PortfolioView + BagHolderRescuePanel |
| predictions | 4 | PredictionTrackingView + DualTrack |
| publishing | 7 | UserPublishingView + QuickPublishButton |
| radar | 10 | AccuracyDashboard + MultiMarketRadar |
| reports | 5 | ExecutiveReportView + DailyMarketReport |
| screener | 1 | StockScreenerAdvanced |
| sharia | 2 | ShariaView + ShariaBadge |
| simulation | 1 | SimulationView |
| stock-analysis | 15 | StockDetailView + TradingChartView |
| subscription | 4 | PricingView + TrialExpiredModal + InstapayModal |

### Backend Modules (8 في `vps-service/modules/`)
| الوحدة | الوظيفة |
|---|---|
| admin | إدارة النظام + DBs + users |
| ai | DeepSeek integration (env-only, no hardcoded keys) |
| market_data | scrapers + price history |
| market_regime | bull/bear/range classification |
| portfolio | portfolio analysis + risk |
| predictions | V40.2 + prediction engine |
| radar | maker-radar + wyckoff |
| telegram | bot integration |

---

## 5. الأنماط المعمارية الإلزامية

### SPA Hash Routing
```
URL: /#dashboard → page.tsx → useAppStore.setCurrentViewFromHash('dashboard')
                  → renderView() switch → <DashboardView />
```
- `VALID_VIEWS` في `src/lib/valid-views.ts` هو SSOT لكل الـ routes المسموح بها.
- `ALIAS_VIEW_REDIRECTS` يحوّل الـ aliases (#analysis → #recommendations).
- `CRYPTO_VIEW_REDIRECTS` يحوّل crypto-* views لـ unified views + `setCurrentMarket('CRYPTO')`.

### UI-Mirror Protocol (Rule 53)
- crypto views تستخدم نفس مكوّنات EGX مع `currentMarket='CRYPTO'`.
- ممنوع قائمة crypto منفصلة. مبدّل الأسواق هو الطريق الوحيد للتبديل.

### Canonical SSOT Pattern (Rule 67b + 72)
- كل حساب له canonical file واحد في Python.
- TS ports في `src/lib/canonical-*.ts` تتطابق 100% مع Python (self-tests).
- ممنوع recomputation client-side.

### Cache Manager (SSOT)
```typescript
import { cache } from '@/lib/cache-manager';
const price = await cache.getOrCompute('da:stock:COMI', () => fetchPrice('COMI'), 60_000);
```
- LRU eviction (max 512 entries)
- Per-entry TTL (default 60s)
- Namespaced keys (`da:`, `egxpy:`, `msa:`, etc.)

### Unified Error Envelope
```typescript
// src/lib/api-response.ts
apiOk(data) // → { success: true, data, timestamp }
apiErr(message, { code, status, details }) // → { success: false, error, timestamp }
```

---

## 6. الفرق والأدوار

### فريق Alpha (Frontend & UI Lead)
- مسؤول عن `src/` فقط.
- ممنوع لمس بايثون أو DBs.
- ممنوع `git push --force` (Rule 81).
- الألوان: emerald/teal/amber (ممنوع blue/indigo).

### فريق Bravo (Chief Quant & Math Lead)
- مسؤول عن `vps-service/` + `scripts/`.
- ممنوع لمس الواجهات.
- ممنوع توليد أهداف صاعدة على سكاكين ساقطة.
- ممنوع بيانات وهمية.

### جيمي (Jimmy) — المدير العام
- المعماري + كبير المحللين.
- يدير Alpha + Bravo.
- كل قراراته موثّقة في worklog.

### سوسو (CEO Agent)
- الرئيس التنفيذي التقني.
- يدير الوكلاء + يراجع الجودة.
- مسؤول عن حماية بيانات المالك + رأس ماله.

---

## 7. التوثيق المرجعي

| الملف | المحتوى |
|---|---|
| **01-CONSTITUTION_AND_ARCHITECTURE.md** | هذا الملف — القواعد + البنية |
| **02-SCREENS_AND_API_CONTRACTS.md** | الشاشات + API + Data contracts |
| **03-ENGINEERING_AND_DEPLOYMENT.md** | الأدوات + النشر + Ops |
| **04-SECURITY_AND_GOVERNANCE.md** | الأمن + الصلاحيات + سير العمل |
| **05-REBUILD_FROM_SCRATCH.md** | دليل إعادة البناء خطوة بخطوة |

---

*آخر تحديث: 2026-10-14 by سوسو (CEO Agent)*
