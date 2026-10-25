# RESTRUCTURE-BACKEND-AUDIT.md — Bravo Backend Audit (RESTRUCTURE-WAVE1-B)

> **Task ID:** RESTRUCTURE-WAVE1-B
> **Agent:** Bravo (backend/quant dragon — Z.ai Code copy)
> **Scope:** `vps-service/` + `scripts/` + `db/` + `Documentation/` ONLY
> **Mode:** AUDIT ONLY — بلا كود. `.md` بس.
> **Push gate:** 🚫 NO `git push` (الـ push gate ملك المالك).
> **التاريخ:** 2026-10-18

---

## 🎯 الملخص التنفيذي

**الاكتشاف الأبرز:** الـ **paywall/subscription/trial logic كله في Next.js (`src/`) — مش في Python backend خالص**. الـ backend بـ يخدم data للأي حد بيسأله (مفيش role-based gate في الـ API layer). ده مخالفة صريحة لـ Rule 20 (Python=Brain) — المنطق الحسابي للـ access control مفروض يكون في Python.

| المحور | الحالة | الخطورة |
|--------|--------|---------|
| (a) Paywall Gates | 🔴 **مفيش في Python** — كله في Next.js | CRITICAL |
| (b) Trial System | 🟡 storage في auth.db + logic في Next.js | HIGH |
| (c) Guest Mode API | 🔴 **مفيش role model** — كل endpoints مفتوحة | CRITICAL |
| (d) Stocks/Crypto Duplication | 🟡 endpoints مكررة، logic مش موحّد | HIGH |
| (e) Admin Permissions | 🔴 **22/74 admin endpoints بدون @require_admin** | CRITICAL |

**Risks الكلية:**
1. **Security CRITICAL**: 22 admin endpoint بلا auth + كل API endpoints مفتوحة لأي حد يوصل الـ backend.
2. **Architecture CRITICAL**: paywall/trial logic في Next.js بدل Python (Rule 20 violation).
3. **Feasibility**: Guest Mode محتاج role model جديد في auth.db + middleware في Python.

---

## (a) Paywall Gates Audit

### الاكتشاف الرئيسي
**مفيش paywall/subscription gates في `vps-service/` خالص.**

فحصت بـ grep على `subscription_status`، `is_subscribed`، `paying_user`، `requires_subscription`، `paywall`، `PAYWALL` في `vps-service/api/` + `vps-service/core/` → **0 matches**.

### أين الـ paywall logic فعلاً؟
- **Next.js (`src/`)** — ده scope ألفا.
- **Telegram bot** (`vps-service/telegram/telegram_interactive_bot.py:795`) — فيه `check_subscription(chat_id)` بـ يستعلم Next.js endpoint `/api/bot/check-subscription`.

### التوصية (للكيمي/محسن)
الـ paywall **مفروض يكون في Python backend** (Rule 20 — Python=Brain). المسار المقترح:

```
Current:  Next.js → Python (no gate) → DB
Target:   Next.js → Python (@require_subscription decorator) → DB
```

**Implementation plan (للكيمي — تكليف منفصل):**
1. أكتب `@require_subscription(tier='normal')` decorator في `vps-service/core/auth_middleware.py`.
2. الـ decorator بـ يقرأ `X-User-Tier` header (بيبعه Next.js بعد ما يعمل auth) + يـ verify against `auth.db.User.subscription_tier`.
3. لو tier < required → 403 + `{"error": "subscription_required", "required_tier": "normal"}`.
4. طبّق الـ decorator على endpoints الـ advanced (deep_analysis, ai_analysis, backtesting).

**User journeys mapping:**
| Journey | الوصول الحالي (Python) | المطلوب |
|---------|------------------------|---------|
| زائر (Guest) | كله مفتوح 🔴 | market prices + radar محدود بس |
| Trial شغّال | كله مفتوح 🔴 | كل شيء ما عدا backtesting + advanced AI |
| Trial خلص | كله مفتوح 🔴 | محدود (soft paywall — محتاج Python gate) |
| مدفوع | كله مفتوح ✅ | كله مفتوح ✅ |

---

## (b) Trial System Audit

### الـ storage (في auth.db — سليم)
`User` table فيه:
- `subscription_tier` (TEXT): `free` / `normal` / `premium` / `pro` / `developer` / `admin` / `enterprise` / `b2b_*`
- `trial_ends_at` (DATETIME): تاريخ نهاية الـ trial
- `trial_warning_sent_at` (DATETIME): آخر تحذير
- `trial_deletion_scheduled_at` (DATETIME): موعد الحذف

### الـ SubscriptionPlan (10 plans)
| id | name_ar | price | trial_days | max_watchlist | ai_analysis |
|----|---------|-------|------------|---------------|------------|
| free | مجانى | 0 | 30 | 5 | 0 |
| normal | عادى | 199 | 0 | 25 | 0 |
| premium | مميز | 299 | 0 | 9999 | 1 |
| pro | Pro | 599 | 0 | 500 | 1 |
| developer | مطور | 0 | 0 | 1000 | 1 |
| admin | مدير النظام | 0 | 0 | 99999 | 1 |
| enterprise | مؤسسي | 1999 | 0 | 9999 | 1 |
| b2b_starter | B2B Starter | 99 | 0 | 500 | 1 |
| b2b_pro | B2B Pro | 299 | 0 | 2000 | 1 |
| b2b_enterprise | B2B Enterprise | 999 | 0 | 99999 | 1 |

### الـ gaps المكتشفة
1. **trial_days = 30 لـ free بس** — باقي الـ plans `trial_days = 0`. ده معناه إن الـ "14-day trial" اللي بتتكلم عنه كيمي **مش متطبّق** في الـ DB schema. الـ free plan عنده 30 يوم، مش 14.
2. **trial_ends_at = NULL لـ 3/3 sample users** — حتى الـ `free` user عنده `trial_ends_at = None`. ده معناه إن الـ trial **مش بيـ trigger** عند الـ registration.
3. **مفيش admin reset/extend endpoint في Python** — لو محتاج reset trial، بتاع الـ Next.js route (scope ألفا).

### التوصية
- **لو محسن عاوز 14-day trial**: غيّر `SubscriptionPlan.free.trial_days` من 30 لـ 14 (تكليف منفصل).
- **الـ trial trigger**: محتاج logic في Python `POST /api/auth/register` يـ set `trial_ends_at = NOW() + 14 days`.
- **soft-paywall-on-expiry**: محتاج `@require_active_subscription` decorator في Python بـ يـ check `trial_ends_at > NOW()`.

---

## (c) Guest Mode API Feasibility

### الاكتشاف
**مفيش role model في Python backend خالص.**

- `auth_middleware.py` فيه `@require_admin` بس — مفيش `@require_user` أو `@require_paid` أو `@guest_ok`.
- كل endpoints الـ read (market prices, radar, news) **مفتوحة لأي حد** بيسأل الـ backend.
- مفيش anonymous/guest role في `auth.db`.

### Endpoints اللي تقدر تخدم Guest (read-only, no token)
كل الـ endpoints دي **حاليًا مفتوحة** (بس لازم تفضل للـ guest):

| Endpoint | المصدر | Guest OK? |
|----------|--------|-----------|
| `GET /api/market-pulse` | lightweight_server:166 | ✅ |
| `GET /api/market-overview` | lightweight_server:1081 | ✅ |
| `GET /api/stocks` | public_routes:59 | ✅ |
| `GET /api/stocks/<ticker>` | public_routes:149 | ✅ |
| `GET /api/flow/summary` | lightweight_server:470 | ✅ |
| `GET /api/flow/top` | lightweight_server:484 | ✅ |
| `GET /api/flow/<ticker>` | lightweight_server:499 | ✅ |
| `GET /api/liquidity/buckets` | canonical_flow:609 | ✅ |
| `GET /api/market/overview` | public_routes:516 | ✅ |

### Endpoints اللي لازم تفضل ورا auth (advanced)
| Endpoint | السبب |
|----------|------|
| `POST /api/portfolio/*` | user-specific data |
| `POST /api/watchlist` | user-specific |
| `POST /api/price-alerts` | user-specific |
| `GET /api/ai/live/scan` | advanced AI (premium) |
| `POST /api/backtest/*` | premium feature |
| `GET /api/expert-recommendations/active` | premium |

### Role model المطلوب (feasibility)
```python
# Proposed in auth_middleware.py:
def require_role(min_tier='guest'):
    """tiers: guest < free < normal < premium < pro < admin"""
    def decorator(f):
        @functools.wraps(f)
        def wrapped(*args, **kwargs):
            tier = request.headers.get('X-User-Tier', 'guest')
            if TIER_ORDER.index(tier) < TIER_ORDER.index(min_tier):
                return jsonify({"error": "insufficient_tier", "required": min_tier}), 403
            return f(*args, **kwargs)
        return wrapped
    return decorator
```

**DB schema gap:** `User` table مفيهاش `role` column مستقل. الـ `subscription_tier` بـ يعمل دور الـ role. محتاج نضيف `anonymous` tier للـ guest (أو نـ allow NULL user_id للـ guest endpoints).

**Risks:**
- 🔴 لو فتحنا guest mode بدون rate limiting → abuse (scraping).
- 🟡 محتاج middleware جديد + schema migration (إضافة `anonymous` tier أو table منفصل).

---

## (d) Stocks/Crypto API Unification

### الـ duplication المكتشف

**Stocks endpoints** (في `lightweight_server.py` + `api/stocks.py` + `api/public_routes.py`):
- `/api/stocks` (public_routes)
- `/api/stocks/<ticker>` (public_routes)
- `/api/stocks/presets` (stocks.py)
- `/api/stocks/computed` (stocks.py)
- `/api/stocks/top-performers` (top_performers_routes)
- `/api/flow/<ticker>` (lightweight_server) — stocks-specific
- `/api/explosive/<ticker>` (lightweight_server) — stocks-specific

**Crypto endpoints** (في `lightweight_server.py`):
- `/api/crypto/live`
- `/api/crypto/flow/<symbol>` — **duplicate logic** مع `/api/flow/<ticker>`
- `/api/crypto/explosive/<symbol>` — **duplicate logic** مع `/api/explosive/<ticker>`
- `/api/crypto/<coin_id>/history`
- `/api/crypto/watchlist`
- `/api/crypto/portfolio`
- `/api/crypto/simulation/*`

### الـ duplication الحقيقي
`/api/flow/<ticker>` و `/api/crypto/flow/<symbol>` بـ يعملوا نفس الحاجة (liquidity flow analysis) بس لـ markets مختلفة. الـ logic **مش موحّد** — كل واحد بـ يقرأ من DB مختلف.

### التوصية (Rule 20 — logic في Python)
**Unified endpoint:**
```
GET /api/flow/<symbol>?market=EGX|CRYPTO|TADAWUL|...
```

**Implementation plan:**
1. أكتب `analyze_liquidity_flow(symbol, market)` في `vps-service/analyzers/flow_analyzer.py` — unified.
2. الـ function بـ يـ route لـ DB الصحيح حسب `market`:
   - `EGX` → stocks.db
   - `CRYPTO` → crypto.db + CoinGecko API
   - `TADAWUL` → data_engine.db
3. Deprecate الـ endpoints القديمة بـ 410 Gone + redirect header.

**Risks:**
- 🟡 الـ frontend (ألفا) محتاج يـ update الـ fetch calls.
- 🟡 backward compatibility — الـ mobile app ممكن لسه بـ يستعلم الـ endpoints القديمة.

---

## (e) Admin Permissions Audit

### الـ numbers
- **74** admin endpoint في `admin_routes.py` (4980 سطر).
- **52** محمية بـ `@require_admin` ✅.
- **22** **بدون** `@require_admin` 🔴 (security risk).

### الـ 22 endpoint غير محمية (CRITICAL)
```
/backtest/params (GET + POST)
/backtest/run-enhanced
/iterative-learning/start
/iterative-learning/step
/iterative-learning/run-auto
/iterative-learning/status
/iterative-learning/stop
/iterative-learning/grid-search
/iterative-learning/smart-optimize
/sectors/rotation
/sectors/classify-stocks
/sectors/stats
/historical-backfill/run
/historical-backfill/status
+ 7 more (full list in worklog)
```

### خطورة الـ 22 endpoint
- **`/backtest/run-enhanced`**: ممكن يستهلك CPU/Memory كبير → DoS.
- **`/iterative-learning/*`**: ممكن يـ trigger ML training مكلف → resource exhaustion.
- **`/historical-backfill/run`**: ممكن يـ write للـ DB بدون auth → data corruption.
- **`/sectors/classify-stocks`**: write operation (POST) بدون auth → data manipulation.

### التوصية (P0 — security fix)
1. **Add `@require_admin` للـ 22 endpoint** (تكليف منفصل لـ Bravo).
2. **Audit الـ admin_routes.py بالكامل** — فيـ 4980 سطر، ممكن فيه endpoints تانية مش محمية.
3. **Add rate limiting** على الـ admin endpoints الـ heavy (backtest, learning).

### تبسيط الـ 26-tab admin (scope ألفا، بس التوصية هنا)
الـ 26 tab في `AdminView.tsx` بـ يـ consume 74 endpoint. التبسيط المقترح:
- **دمج**: `/iterative-learning/*` (9 endpoints) → tab واحد "Learning".
- **دمج**: `/backtest/*` → tab واحد "Backtesting".
- **فصل**: `/sectors/*` (3 endpoints) → tab "Sectors" مستقل.
- **حذف**: endpoints الـ deprecated / unused (محتاج inventory كامل).

---

## 📊 الإحصائيات الإجمالية

| المؤشر | القيمة |
|--------|--------|
| إجمالي admin endpoints | 74 |
| محمية بـ @require_admin | 52 |
| **بدون حماية (CRITICAL)** | **22** |
| Paywall gates في Python | **0** |
| Subscription plans في auth.db | 10 |
| trial_days للـ free plan | 30 (مش 14) |
| Users بـ trial_ends_at = NULL | 3/3 sample |
| Stocks endpoints | 7+ |
| Crypto endpoints | 14 |
| Duplicated logic (flow/explosive) | 2 pairs |

---

## 🚨 Risks Summary (للكيمي/محسن)

### CRITICAL (3)
1. **22 admin endpoint بدون auth** — أي حد يقدر يـ trigger backtest/learning/backfill.
2. **مفيش paywall في Python** — كله في Next.js (Rule 20 violation).
3. **مفيش role model** — Guest محتاج schema migration + middleware.

### HIGH (3)
4. **trial_days = 30 مش 14** — الـ DB schema مش متطابقة مع الـ spec.
5. **trial_ends_at = NULL** — الـ trial مش بيـ trigger عند registration.
6. **Stocks/Crypto duplication** — logic مش موحّد، maintenance burden.

### MEDIUM (2)
7. **74 admin endpoint في ملف واحد (4980 سطر)** — maintenance nightmare.
8. **10 subscription plans** — فيها overlap (pro vs enterprise vs b2b_pro) — محتاج توحيد.

---

## 📋 المسار المقترح للتنفيذ (Waves)

### Wave 1 (P0 — Security)
1. أضف `@require_admin` للـ 22 endpoint (Bravo).
2. أكتب `@require_subscription` decorator (Bravo).
3. طبّق الـ decorator على endpoints الـ advanced (Bravo).

### Wave 2 (P0 — Architecture)
4. نقل الـ paywall logic من Next.js لـ Python (تعاون Bravo + Alpha).
5. fix `trial_days` 30 → 14 (Bravo — DB migration).
6. أضف `trial_ends_at` trigger عند registration (Bravo).

### Wave 3 (P1 — Unification)
7. unified `/api/flow/<symbol>?market=` endpoint (Bravo).
8. unified `/api/explosive/<symbol>?market=` endpoint (Bravo).
9. admin endpoints refactoring (Bravo — تقسيم admin_routes.py).

---

## ✅ Acceptance Proof

- **الملف ده:** `/home/z/my-project/RESTRUCTURE-BACKEND-AUDIT.md` (مكتوب).
- **Scope:** `vps-service/` + `db/` read-only. ما لمستش `src/` ولا `.py` ولا DB writes.
- **Push:** 🚫 مفيش push (الـ push gate ملك المالك).
- **Worklog:** هـ append سكشن في `worklog.md` (Task ID `RESTRUCTURE-WAVE1-B`).

---

## 🔁 Hand-off

التقرير ده للكيمي/محسن للقرار التنفيذي. أي تنفيذ محتاج:
1. **تكليف منفصل** لكل wave (Rule 75 — commit + push per task).
2. **تنسيق مع ألفا** للـ frontend changes (لو نقلنا paywall لـ Python).
3. **human approval** قبل أي DB migration (auth.db schema).

**برافو — تنين الباك إند والكم المجنح**
