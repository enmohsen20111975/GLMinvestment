# MONEY-TIER2-REBUILD — Unified Alert Engine + Endpoints

**Agent:** Full-Stack Developer (subagent)
**Task ID:** MONEY-TIER2-REBUILD
**Date:** 2026-09-24
**Branch:** main
**Commits pushed:** 6 (https://github.com/enmohsen20111975/GLMinvestment)

## Mission
بناء محرك تنبيهات موحّد للمنصة يفحص 3 مصادر (أسهم + ذهب + PnL المحفظة) ويطلق user_notifications، مع 5 endpoints جديدة + 1 React panel جديد. كل الـ data من SQLite مباشرة — مفيش Python.

## Files Created (6)

| # | Path | Role | Lines |
|---|------|------|-------|
| 1 | `src/lib/schedulers/alert-engine.ts` | محرك التنبيهات الموحّد: `ensureUserNotifColumns`, `runStockAlertsCheck`, `runGoldAlertsCheck`, `runPortfolioPnLCheck`, `runAllAlerts`, `runAllAlertsForCurrentUser` | 646 |
| 2 | `src/app/api/alerts/scheduler/route.ts` | GET (stats + last_run) + POST (run engine). Query: `only_me=1` / `user_id=...` (admin). | 150 |
| 3 | `src/app/api/alerts/gold/route.ts` | CRUD كامل لتنبيهات الذهب (GET/POST/DELETE). karat 24/21/18 + condition above/below + threshold_price. | 324 |
| 4 | `src/app/api/notifications/route.ts` | GET (list with unread_count) + POST (mark_all_read أو notification_id). فيه `ensureNotifColumns(db)` helper للـ legacy schemas. | 254 |
| 5 | `src/app/api/finance/seed-alert-thresholds/route.ts` | GET (إحصائية NULL vs filled) + POST (زرع ±5% thresholds للـ NULL rows). | 259 |
| 6 | `src/components/portfolio/TopUpRecommendationsPanel.tsx` | Panel يعرض الأسهم الرابحة ≥ 10% مع توصية "زيادة المركز". RTL + Arabic + lucide icons (TrendingUp, Plus, Sparkles). | 430 |

**Total: ~2,063 lines** من code جديد.

## Architecture Decisions

### 1. محرك واحد موحّد بدل من 3 engines منفصلة
كل الـ engines (stock/gold/pnl) في ملف واحد `alert-engine.ts` عشان:
- سهولة الاستدعاء من أي route بـ `import { runAllAlerts }`.
- مشاركة helpers (`insertNotification`, `ensureUserNotifColumns`).
- dedup logic مركزي في مكان واحد.

### 2. منع التكرار بـ 24-hour window
قبل كل INSERT، بنفذ:
```sql
SELECT 1 FROM user_notifications
WHERE user_id = ? AND type = ? AND ticker IS ? AND message = ?
  AND created_at > datetime('now', '-24 hours')
LIMIT 1
```
لو موجود → skip الـ INSERT. كده الـ scheduler ممكن يشتغل كل ساعة بدون spam.

### 3. تمرير userId كـ optional parameter
كل function تأخذ `userId?`:
- لو `undefined` → فحص لكل المستخدمين (admin/cron mode).
- لو محدد → فحص للمستخدم ده بس (per-user mode).

### 4. Severity levels مع semantic meaning
- `success` → إيجابي (تجاوز سعر مستهدف / top_up_opportunity / gold price above)
- `warning` → حذر (انخفاض تحت عتبة / gold price below)
- `critical` → عاجل (bag_holder_warning — خسارة > 10%)
- `info` → عام

### 5. ALTER TABLE آمن (idempotent)
كل الـ schema helpers بتعمل:
1. `CREATE TABLE IF NOT EXISTS` (للجدول نفسه)
2. `PRAGMA table_info()` + `ALTER TABLE ADD COLUMN` لكل عمود ناقص

ده ضروري عشان الجدول ممكن يكون موجود من schema قديم بدون columns `severity` / `payload` / `ticker`.

### 6. TopUpRecommendationsPanel — تصميم قابل للدمج
الـ panel بياخد data من `/api/portfolio/holdings` (موجود بالفعل) ويفلتر `pnl_percent >= 10`. كده:
- مفيش endpoint جديد مطلوب.
- نفس المصدر اللي EnhancedPortfolioView بيستخدمه.
- سهل الدمج في أي مكان في الـ portfolio view.

## Verification

- ✅ `bun run lint` → exit 0 (مرتين بعد آخر تعديل)
- ✅ `/` route → HTTP 200
- ✅ `/api/alerts/scheduler?only_me=1` بدون auth → HTTP 401 + `{"success":false,"error":"Authentication required"}`
- ✅ `/api/notifications` بدون auth → HTTP 401 + empty list
- ✅ `/api/alerts/gold` بدون auth → HTTP 401 + empty alerts
- ✅ `/api/finance/seed-alert-thresholds` بدون auth → HTTP 401
- ✅ 6 commits اتدفعت على GitHub main: `ac65891..38a3dc0`

## Issues Encountered

### Issue 1: `better-sqlite3` direct import crashes Bun
المشكلة: محاولة فتح stocks.db مباشرة عبر `better-sqlite3` من سكريبت standalone بتعمل crash في Bun 1.3.14 (NAPI FATAL ERROR).

الحل: ما استخدمتش direct DB inspection. اعتمدت على:
- قراءة الـ schema pattern من `src/app/api/finance/schema/route.ts` (الـ watchlist + portfolio_assets).
- الـ pattern من `src/app/api/portfolio/master/route.ts` + `holdings/route.ts` للـ read access.

### Issue 2: SqliteDatabase wrapper type
الـ `SqliteDatabase` من `@/lib/sqlite-wrapper` بيحدد `prepare().run(...params: unknown[])`. عشان كده:
- استخدمت positional params في SELECTs: `.all(userId)`.
- استخدمت positional params في INSERTs: `.run(p.user_id, p.type, ...)` (نفس pattern بتاع master/route.ts).
- تجنبت named params عشان أضمن compatibility مع sql.js fallback (اللي مش بيدعمها بنفس الطريقة).

### Issue 3: TICKER IS ? في dedup SQL
عشان `ticker` ممكن يكون `NULL`، استخدمت `ticker IS ?` بدل `ticker = ?` عشان SQLite بتعامل NULL بـ `IS` مش `=`. لو مرّرنا `null` كـ parameter، الـ `IS NULL` بيتطابق بشكل صحيح.

## Integration Suggestions (للمهندس الرئيسي)

### A. دمج TopUpRecommendationsPanel في EnhancedPortfolioView

**الموقع المقترح:** بعد `<BagHolderRescuePanel />` (line 1031-1038 في EnhancedPortfolioView.tsx).

```tsx
{/* ROBO-ADVISOR-P4: محرك إنقاذ الأسهم المزنوقة */}
<div id="bag-holder-rescue-anchor">
  <BagHolderRescuePanel ... />
</div>

{/* MONEY-TIER2: توصيات زيادة المركز — الأسهم الرابحة ≥ 10% */}
<TopUpRecommendationsPanel />

{/* P37-PHASE-2B-4A: Currency badge ... */}
```

**الـ import:** أضف في block الـ imports (line 83):
```tsx
import { TopUpRecommendationsPanel } from '@/components/portfolio/TopUpRecommendationsPanel';
```

### B. ربط الـ Alert Scheduler بـ cron job

الـ `/api/alerts/scheduler` ممكن يتعمل له ping كل ساعة من:
1. **Cron job خارجي** (Vercel Cron / GitHub Actions):
   ```
   0 * * * * curl -X POST https://invist.m2y.net/api/alerts/scheduler?XTransformPort=3000
   ```
2. **mini-service داخلي** في `mini-services/alert-scheduler/index.ts`:
   - bun --hot script بيستخدم node-cron.
   - كل ساعة يعمل HTTP GET لـ `/api/alerts/scheduler` (بدون auth = global scan لـ admin).
   - port 3006 (مثلاً).

### C. ربط NotificationCenter بـ user_notifications

الـ `src/components/notifications/NotificationCenter.tsx` حالياً بيقرأ من `useNotificationStore` (Zustand + localStorage). التوصية:
1. أضف useEffect في `NotificationCenter` يـ fetch من `/api/notifications` على mount.
2. hydrate الـ store بـ data من SQLite.
3. استخدم POST `/api/notifications` مع `mark_all_read: true` بدل ما يكون client-side only.

### D. زر "تشغيل فحص التنبيهات" في Admin Dashboard

الـ `/api/alerts/scheduler` POST يدعم `user_id` parameter (admin-only). ممكن يتعمل زر في admin panel:
- "فحص الآن (لمستخدم)" → POST `/api/alerts/scheduler?user_id=...`
- "فحص شامل (كل المستخدمين)" → POST `/api/alerts/scheduler` (admin بدون only_me)

## Files NOT Modified (compiled against existing code)
- `src/lib/finance-db.ts` (getFinanceDb) — استخدمته كما هو
- `src/lib/auth-helper.ts` (getSessionUserId) — استخدمته كما هو
- `src/lib/data-engine-db.ts` (getLiveEgyptGoldPrices) — استخدمته كما هو
- `src/lib/sqlite-wrapper.ts` (SqliteDatabase type) — استخدمته كما هو
- `src/app/api/portfolio/master/route.ts` — pattern reference فقط
- `src/app/api/portfolio/holdings/route.ts` — pattern reference + data source للـ TopUp panel
- `src/components/portfolio/BagHolderRescuePanel.tsx` — UI pattern reference

## Next Steps (للمراحل القادمة)
1. **T2.5**: إضافة cron job / mini-service للـ scheduler عشان يشتغل تلقائياً.
2. **T2.6**: دمج TopUpRecommendationsPanel فعلياً في EnhancedPortfolioView (1 import + 1 JSX).
3. **T2.7**: ربط NotificationCenter بـ /api/notifications (hydration من SQLite).
4. **T2.8**: إضافة WebSocket emit عند INSERT تنبيه جديد (mini-service منفصل على port 3003).

---
**Status: ✅ Complete — 6 files, 6 commits, lint clean, endpoints responsive.**
