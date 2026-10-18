# SESSION-STATE — GLMinvestment Restructure (John CEO Session)

> **الغرض:** مرجع دائم لحالة الجلسة. لو الـ context ضاع، اقرأ ده الأول.  
> **كتبه:** جون — المدير التنفيذي (Z.ai Code).  
> **التاريخ:** 2026-10-18 (آخر تحديث: see below).  
> **المستودع:** `/home/z/my-project` (origin/main).  
> **الإذن:** ده **الملف الوحيد** اللي جون مأذون يـ push-ه باستمرار (بأمر المالك) — بـ يتحدّث عند كل milestone (بعد كل phase PASS / قرار). باقي الملفات: push gate قرار جون لكل واحد.  
> **الحالة:** B-P0 + A-P1 + A-P2 + B-P1 خلصوا + متتحقق منهم + متدفعين لـ origin (`77b9988`). باقي: A-P3/A-P4 + B-P2/B-P3 + الـ data-conflict fixes.  
> **آخر تحديث:** 2026-10-18 — A-P1 + A-P2 + B-P1 متحقق منهم (page.tsx untouched، tabs مدمجة، paywall middleware + py_compile PASS).

---

## 1. الهوية + السلطة

- **جون = المدير التنفيذي وابن البورصة.** مش كيمي (الـ QA/COO سابقًا)، مش مطوّر.
- **دوري:** أوزّع الشغل على الفريقين (ألفا/برافو)، أتحقق بالدليل، أحاسب، بوابة الـ push.
- **المالك (محسن):** فوض لي قرارات الـ push approval + القرارات الفنية التنفيذية. دستوريًا Rule 75 (push) **معلّقة** بأمر المالك — الـ push gate قرار جون.
- **الدستور = الدين.** القواعد اللي بتلمسنا: 4 (NO-NEW-SCREENS)، 20 (Python=Brain)، 27 (NO-FAKE-DATA)، 73 (SINGLE-DISPLAY-SOURCE)، 2 (ممنوع لمس config)، 1 (ممنوع لمس DBs الإنتاج).

---

## 2. الـ Directive بتاعة المالك (الـ restructure)

4 مراحل لتنظيف الـ "mess":
1. **تنظيف جذري:** 58 switch case → 8–10 top-level screens (قرار جون: ≤10، طوى 3).
2. **إعادة هيكلة التنقل:** TopBar جدول محدد (5 أقسام).
3. **Auth & Monetization محترم:** Guest Mode + Trial (14d) soft + soft paywall (مش hard block).
4. **Admin:** 26 tab → 4–5 hubs.

---

## 3. القرارات اللي أخدها جون (الماك يقدر يلغي)

| القرار | القيمة | المبرر |
|---|---|---|
| Canonical price source | **`stocks.db.stock_daily_prices`** | الـ 1.4M rows الأكمل بعد replenishment برافو. يحل الـ split-brain. Rule 12 amendment معلّق للسجل. |
| trial_days canonical | **14** | spec المالك ("Trial 14 days"). |
| TopBar top-level max | **≤10** (طوى: الفلاتر المتقدمة، التقارير، التنبيهات) | قيد المالك ("8–10 max"). |
| API contract ownership | **جون** | بفصل بين ألفا وبرافو. |
| Push approval | **جون (مفوّض)** | تفويض المالك. |

---

## 4. الحالة المتحقق منها (PASS)

### B-P0 — CRITICAL security (خلص + متدفع)
- **commit:** `13ae02f` على origin/main.
- **الشغل:** 22 admin endpoint في `vps-service/api/admin_routes.py` اتعملهم `@require_admin`.
- **التحقق (جون):** 74 route، 74 `@require_admin` decorator، 0 unauthed (awk)، `py_compile` PASS، 5 critical endpoints متأكد منهم بالـ path (`/backtest/run-enhanced`, `/historical-backfill/run`, `/sectors/classify-stocks`, `/iterative-learning/start`, `/maestro-backfill/run`).
- **تصحيح:** برافو لقى 22، جون قال 21 أولًا — برافو صح. اعترف جون بالغلط.

### Phase 1 fixes (جلسة سابقة — متحقق منها كمان)
- `flow_system.py`: `MAX_POSITION_SIZE = 0.025` (cap 2.5%، Rule 19).
- `canonical_flow.py`: `RR_FLOOR = 1.8` + `evaluate_risk` مربوط في whale_inflow/bottom_absorption/correction_exhaustion.
- `v2_routes.py`: fabrication (entry×0.92/1.10/1.15) اتمسحت → NULL policy.
- `MakerRadarTab.tsx`: `DEEP-DIRECTIVE-CANCELLED` + `source='none'` + null entries.
- `sparkline/route.ts`: `Math.sin()` fabrication اتمسحت.
- `liquidity_radar_v2.py`: `BRAVO-FIX` — التدفق الموجب تحت MA20 = امتصاص خفي مش تصريف.
- دستور Rule 18: `dynamic_rr_normal = 1.8`.

---

## 5. الـ Phases — الحالة المحدّثة

| Task ID | الفريق | الحالة |
|---|---|---|
| ✅ **B-P0** | برافو | PASS + متدفع (`13ae02f`) — 22 admin endpoints محميين |
| ✅ **A-P1** | ألفا | PASS + متدفع — TopBar 24→10، `page.tsx` UNTOUCHED (Rule 67) |
| ✅ **A-P2** | ألفا | PASS + متدفع — tabs مدمجة (stock-filters→StocksView، reports→MarketAnalysisView، alerts→EnhancedPortfolioView) |
| ✅ **B-P1** | برافو | PASS + متدفع — `require_role` + `require_trial_or_paid` في auth_middleware، مستخدم في ai_routes، py_compile PASS، `API-CONTRACT-PAYWALL.md` مكتوب |
| 🔜 **A-P3** | ألفا | Auth UI (Guest Mode + Trial soft + soft paywall بالاَ contract) |
| 🔜 **A-P4** | ألفا | admin 26→4-5 hubs |
| 🔜 **B-P2** | برافو | trial fix (14 + populate `trial_ends_at` + admin reset) |
| 🔜 **B-P3** | برافو | stocks/crypto unification (canonical `stocks.db`) — BLOCKED لحد canonical price decision |

### ملاحظات verify (جون):
- A-P1: تبّت `page.tsx` ما اتلمس (git log empty للملف في الـ A-P1/A-P2 commits) → Rule 67 محترمة.
- A-P2: لقيت comments `RESTRUCT-A-P2` في الـ 3 views + TabsTrigger imports — tabs فعلًا مدمجة.
- B-P1: `require_role(min_tier, require_trial)` + `require_trial_or_paid` موجودين + مستوردين + مستخدمين في ai_routes. ⚠️ محتاج تبّيت إن الـ decorator متطبّق على كل الـ advanced endpoints (مش بس ai_routes) — follow-up.

---

## 6. الـ Data-Conflict Findings (dig جون — الـ "mess")

| # | الناقل | الخطورة | الملف/الدليل |
|---|---|---|---|
| 1 | **price split-brain** | 🔴 CRITICAL | `daily_predictor.py`: `get_scan_dates` (egksco=PRIMARY، 162K rows) vs `get_tickers` (price_history=canonical، egksco=0 rows). 4 ادعاءات متناقضة عن canonical. |
| 2 | **frontend direct-DB** | 🔴 CRITICAL | `src/lib/shared-db.ts` بـ يفتح 6 DBs مباشرة (data_engine/stocks/price_history/historical/intraday/predictions) + `data-engine-db-sqljs.ts`. Rule 20 violation + مصدر تضارب. |
| 3 | **frontend target validator** | 🟠 HIGH | `src/lib/targets-validator.ts` بـ يعدّل stop/target client-side بـ fallback. |
| 4 | **R/R 1.5 stale** | 🟠 HIGH | دستور Rule 18 index + KPIs لسه فيها "1.5" + `multi_target_exit.py T1_R_MULTIPLE=1.5`. |
| 5 | **trial 4-source** | 🔴 CRITICAL | seed free=0 / subscription-gate.ts=7 / old hardcoded=14 / كومنت=30. B-P2 يوحّد لـ 14. |

---

## 7. الـ API Contract (B-P1 ↔ A-P3) — نهائي

### Tier order
`guest` (no token) < `free` < `normal` < `premium` < `pro` < `admin`

### Auth propagation
Next.js (الـ auth gateway) بـ يبعت `X-User-Id` + `X-User-Tier` headers للـ Python.  
⚠️ **Security:** safe بس لو Python مش معرّض direct للإنترنت (Caddy بـ route `/api/*` عبر Next.js). لو معرّض → signed token مش header. **برافو يتأكد الأول.**

### Middleware (برافو في `auth_middleware.py`)
- `@require_role(min_tier)` → 403 لو `tier < min_tier`.
- `@require_active_subscription` → 403 لو trial خلص + مش مدفوع.

### Endpoint classification
| Endpoint | min_tier |
|---|---|
| `GET /api/market-pulse`, `/api/stocks`, `/api/flow/summary`, `/api/flow/top`, `/api/market/overview`, `/api/news` | guest |
| `GET /api/flow/<ticker>`, `/api/stocks/<ticker>`, `/api/liquidity/buckets` (limited) | free |
| `GET /api/flow/<ticker>` full, `/api/liquidity` deep, `/api/ai/live/scan` | normal/premium |
| `POST /api/backtest/*`, `/api/expert-recommendations/active` | premium |
| `POST /api/portfolio/*`, `/api/watchlist`, `/api/price-alerts` | free (محتاج `X-User-Id`) |

### Paywall response shapes
```json
{ "error": "insufficient_tier", "required_tier": "free", "current_tier": "guest" }   // 403 → LoginPromptModal
{ "error": "trial_expired", "required": "subscription" }                              // 403 → soft paywall (مش hard block)
{ "error": "insufficient_tier", "required_tier": "premium", "current_tier": "normal" } // 403 → LockModal + upgrade
```

### Trial logic (B-P2)
- `POST /api/auth/register`: `trial_ends_at = NOW() + 14 days`.
- `@require_active_subscription`: لو `subscription_tier ∈ paid` → pass. else لو `trial_ends_at > NOW()` → pass. else → 403 `trial_expired`.
- Admin reset: `POST /api/admin/user/<id>/reset-trial` (محمي `@require_admin`) → `trial_ends_at = NOW() + 14 days`.

---

## 8. الـ Mandate Structure

- **Scope:** ألفا = `src/` بس. برافو = `vps-service/` + `scripts/` + `db/` + `Documentation/` بس.
- **المحظورات:** 🚫 `git push` (gate جون) · 🚫 cross-scope · 🚫 `page.tsx` جديد (Rule 4) · 🚫 لمس config (Rule 2) · 🚫 fabrication (Rule 27) · 🚫 logic حسابي في client (Rule 20) · 🚫 لمس DBs إنتاج (Rule 1) · 🚫 `--force` push.
- **Flow:** كل phase → diff + acceptance proof → جون يتحقق → PASS → push approval (جون) → واصل.
- **Worklog:** append section لكل phase بالـ Task ID + template (ابدأ بـ `---`).

---

## 9. إزاي تستكمل لو الـ context ضاع

1. اقرأ ده (`SESSION-STATE.md`).
2. اقرأ `Documentation/00-CONSTITUTION.md` (Rules 4، 20، 27، 73؛ Rule 75 **معلّقة**).
3. `git pull origin main` → حدّث الحالة.
4. `git log --oneline -15` → شوف آخر commits.
5. اقرأ `worklog.md` آخر ~200 سطر (`tail -n 200`) → شغل الفريقين الأخير.
6. استكمل: **B-P1 (برافو) GO** + **A-P1 push (ألفا) موافق**.
7. جون يتحقق من كل phase؛ push approvals قرار جون.

---

## 10. مسارات مهمة

| الحاجة | المسار |
|---|---|
| المستودع | `/home/z/my-project` (origin/main) |
| venvs | `vps-service/venv`، `data_engine/venv`، `news-agent/venv` (Python 3.12.15) |
| DBs مضغوطة | `/data/db_backup_*.zip` (part1-8 + predictions.db.zip) — استرجع للـ testing |
| تقارير الفريقين | `ALPHA-TEAM-WORK.md`، `أعمال-فريق-برافو.md`، `RESTRUCTURE-MIGRATION-PLAN.md`، `RESTRUCTURE-BACKEND-AUDIT.md` |
| الدستور | `Documentation/00-CONSTITUTION.md` |
| خطة الـ migration | `RESTRUCTURE-MIGRATION-PLAN.md` (commit `5f3c100`) |
| sandbox backup | `/home/z/my-project.sandbox.bak` (السكافولد القديم) |

---

## 11. الـ "mess" المستهدف (100% نظافة)

| # | الـ mess | الحل | الفريق | الحالة |
|---|---|---|---|---|
| 1 | 22 unauthed admin endpoints | B-P0 | برافو | ✅ خلص + متدفع |
| 2 | 58→10 شاشات + bloat | A-P1 + A-P2 خلصوا | ألفا | ✅ جزئي (A-P3 + A-P4 لسه) |
| 3 | paywall في Next.js | B-P1 | برافو | ✅ خلص (middleware + contract) |
| 4 | trial 4-source | B-P2 → 14 | برافو | 🔜 |
| 5 | price split-brain | B-P3 → canonical `stocks.db` + Rule 12 amendment | برافو | 🔜 |
| 6 | frontend direct-DB | mandate لألفا (proxy للـ Python) | ألفا | 🔜 |
| 7 | R/R stale 1.5 | cleanup دستوري | ألفا | 🔜 |

---

**جون — بالدليل مش بالكلام. استكمل من هنا لو ضاع حاجة.**
