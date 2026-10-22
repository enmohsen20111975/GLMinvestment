# 05 — خطة طبقة الوصول للبيانات (Data Access Layer)

> **الحالة:** مُقترح للتنفيذ (Proposed)  
> **التاريخ:** 2026-10-22  
> **السبب:** لمنع تكرار مشاكل الـ "عك" والـ "بهتلة" في الـ frontend + centralization of DB access.

---

## المشكلة الحالية (Why We Need This)

الساند بوكس والإنتاج عندهم **5 مصادر بيانات مختلفة**، كل route بيفتح DB بإيده:

| المصدر | عدد الـ routes اللي بتفتحه مباشرة |
|---|---|
| `stocks.db` | 103 |
| `predictions.db` | 65 |
| `data_engine.db` | 53 |
| `price_history.db` | 17 |
| `auth.db` | 14 |
| `news.db` | 11 |
| `intraday.db` | 9 |
| **الإجمالي** | **272 route** يفتح DB مباشرة |

### المشاكل اللي بتسببها:

1. **Database locks** — كل route بيفتح connection بإيده → تعارضات.
2. **لا schema validation مركزية** — لو الـ schema اتغير، هتكسر 272 route.
3. **لا caching مركزية** — كل route بيعمل query من الصفر.
4. **DRY violation** — نفس الـ SQL مكتوب في 10 أماكن.
5. **صعوبة الـ migrations** — محدش بيعرف كم route بيستخدم table معينة.
6. **الـ "بهتلة"** — الـ corrupted tickers (UBEEU) بتدخل من scraper، تتـ publish من auto_poster، وتظهر في frontend بدون ما حد يـ filterها.

---

## الـ Architecture المقترحة

### الـ Layer Structure

```
┌─────────────────────────────────────────────────┐
│  Frontend (React Components)                    │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  API Routes (Next.js)                            │
│  src/app/api/*/route.ts                         │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  🆕 Data Access Layer (DAL)                     │
│  src/lib/dal/                                   │
│  ├── stocks.ts       ← stocks.db reader         │
│  ├── predictions.ts   ← predictions.db reader   │
│  ├── price-history.ts ← price_history.db reader │
│  ├── data-engine.ts   ← data_engine.db reader   │
│  └── auth.ts          ← auth.db reader          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Databases (SQLite)                             │
│  db/stocks.db, predictions.db, price_history.db │
└─────────────────────────────────────────────────┘
```

### الـ Principles

1. **Single Entry Point** — كل route يعمل `import { getStocks } from '@/lib/dal/stocks'` بدل فتح DB مباشرة.
2. **Centralized Validation** — الـ DAL يـ validate الـ tickers قبل ما يرجعها (منع UBEEU).
3. **Centralized Caching** — الـ DAL يـ cache الـ queries (5-15 min TTL).
4. **Type Safety** — الـ DAL يرجع TypeScript types موثقة.
5. **Centralized Logging** — الـ DAL يسجّل كل query للـ debugging.

---

## خطة التنفيذ (Migration Plan)

### المرحلة 1: إنشاء الـ DAL الأساسية (يوم 1)

#### 1.1 `src/lib/dal/stocks.ts`
```typescript
// Single reader for stocks.db
export async function getStocks(market: string): Promise<Stock[]>
export async function getStockByTicker(ticker: string): Promise<Stock | null>
export async function getActiveStocks(market: string): Promise<Stock[]>
// Internal: validate ticker (reject UBEEU, ISIN codes)
```

#### 1.2 `src/lib/dal/predictions.ts`
```typescript
// Single reader for predictions.db
export async function getPredictions(market: string, limit: number): Promise<Prediction[]>
export async function getStoredAnalyses(market: string): Promise<StoredAnalysis[]>
```

#### 1.3 `src/lib/dal/price-history.ts`
```typescript
// Single reader for price_history.db
export async function getCandles(ticker: string, days: number): Promise<Candle[]>
export async function getChange1d(ticker: string): Promise<number>
export async function getTurnoverEgp(ticker: string): Promise<number>
```

### المرحلة 2: Migration الـ routes الأكثر استخداماً (يوم 2-3)

#### 2.1 الـ routes اللي بتـ serve الـ frontend مباشرة
- `/api/v2/liquidity-radar` → استخدم `dal.stocks` + `dal.price-history`
- `/api/stored-analysis/results` → استخدم `dal.predictions`
- `/api/predictions` → استخدم `dal.predictions`
- `/api/sectors/tracking` → استخدم `dal.stocks`

#### 2.2 الـ routes اللي بتـ publish لـ Telegram
- `auto_poster.py` → استخدم الـ validation من الـ DAL

### المرحلة 3: Migration باقي الـ routes (يوم 4-5)

- الـ 272 route المتبقية تـ migrate تدريجياً.
- نبدأ بالـ routes اللي بتـ read بكتر (الأكثر استدعاءً).
- نترك الـ routes اللي بتـ write للنهاية (محتاجة careful review).

### المرحلة 4: Python Backend DAL (يوم 6-7)

- توسيع `vps-service/core/db_manager.py` الموجود.
- Migration الـ 239 file اللي لسه بتستخدم raw `sqlite3.connect`.
- إضافة ticker validation في الـ Python layer كمان.

---

## الـ Benefits المتوقعة

| المؤشر | قبل DAL | بعد DAL |
|---|---|---|
| Database connections per request | 5-10 | **1-2** (cached) |
| Ticker validation | مفيش | **centralized** |
| Caching | مفيش | **5-15 min TTL** |
| Schema migration risk | عالية (272 route) | **منخفضة** (DAL واحد) |
| Debugging | صعب (logs متفرقة) | **سهل** (centralized logging) |

---

## الـ Risks + Mitigation

| الخطر | الإجراء |
|---|---|
| الـ migration يكسر routes | نبدأ بـ dry-run (DAL returns same data) |
| Performance regression | الـ DAL cached → أسرع من الـ direct |
| Team resistance | نـ migrate تدريجياً + توثيق واضح |

---

## الـ Rollback Plan

- الـ DAL optional — الـ routes القديمة تشتغل زي ما هي.
- لو الـ DAL وقع، الـ routes ترجع لـ direct DB access.
- نـ feature flag الـ DAL: `USE_DAL=true/false`.

---

## الـ Dependencies

- `better-sqlite3` (موجود بالفعل)
- TypeScript types (موجودة بالفعل)
- No new packages required.

---

## الـ Timeline المقترح

| المرحلة | المدة | المخرجات |
|---|---|---|
| 1. إنشاء DAL | يوم 1 | `stocks.ts`, `predictions.ts`, `price-history.ts` |
| 2. Migration الـ core routes | يوم 2-3 | 4 routes مـ migrated |
| 3. Migration باقي الـ routes | يوم 4-5 | 50% من الـ 272 route |
| 4. Python backend DAL | يوم 6-7 | `db_manager.py` متوسّع |
| 5. Testing + cleanup | يوم 8 | كل الـ routes مـ migrated |

**الإجمالي: 8 أيام شغل.**
