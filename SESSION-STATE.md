# SESSION-STATE — GLMinvestment Restructure (John CEO Session)

> **الغرض:** مرجع دائم لحالة الجلسة. لو الـ context ضاع، اقرأ ده الأول.  
> **كتبه:** جون — المدير التنفيذي (Z.ai Code).  
> **التاريخ:** 2026-10-18 (آخر تحديث: see below).  
> **المستودع:** `/home/z/my-project` (origin/main).  
> **الإذن:** ده **الملف الوحيد** اللي جون مأذون يـ push-ه باستمرار (بأمر المالك) — بـ يتحدّث عند كل milestone (بعد كل phase PASS / قرار). باقي الملفات: push gate قرار جون لكل واحد.  
> **الحالة:** B-P0 + A-P1 + A-P2 + B-P1 خلصوا + متتحقق + متدفعين. B-P2 green-lit (split: برافو Python + ألفا A-P2.5 subscription-gate.ts). باقي: A-P3/A-P4 + B-P3 + data fixes.  
> **آخر تحديث:** 2026-10-18 — ✅✅✅ **MAESTRO-CANCER-1 خلص + متتحقق آمن:** maestro_orchestrator.py (4,416 سطر) اتمسح + الـ 13 endpoints بترجّع 410 + الـ 4 analyzers بـ catch + كمّلوا (MAESTRO_*=False) + daily_predictor/telegram شغّالين بـ V40.2. المنصة آمنة. 🟡 4 dead files لسه موجودة (recorder + 3 scripts) بس آمنة (imports جوّه functions dead). برافو بالغ في الـ '6 files' — بس 2 اتمسحتوا فعلًا. + متتبّت بنفسي: `maestro_orchestrator.py` (4,416 lines) LIVE على 8010 (13 endpoints + `POST /api/maestro/run` ثغرة — أي حد يـ trigger!) + متغلغل في قلب V40.2 (`daily_predictor.py` L3811 `run_expert_memory_phase`) + telegram (`auto_post_scheduler.py` L1190 `daily_opportunities`) + 4 zombie analyzers (crypto_maestro, unified_maestro, hunting_engine, background_analyzer) + الفرونت (`dual-persona/route.ts` L148 + `SpecialistAnalysisView.tsx` L1899 `data.maestro` + `MaestroWidget.tsx` zombie). **thresholds متناقضة** (maestro 55/42/30 vs V40.2 78/65/55) → **توصيات متناقضة للعميل** (بيع في الرئيسية + شراء في dual-persona!). data-layer follow-up + dead-engine معلّقين (المايسترو أولوية قصوى).

---

## 3.5 ★ CANONICAL DATA MAP (Ground Truth — من المالك، مسك الداتا بالمليمتر)

| Domain | Canonical DB.table | ملاحظة |
|---|---|---|
| أسعار أسهم تاريخية (شموع/RSI/MACD) | `price_history.db.price_history` | 1,310,184 صف، طازج ★ |
| Live stocks (سعر حالي) | `stocks.db.stocks` | current_price, close_price, change_percent, volume, last_updated |
| Stock intraday (دقيقة بدقيقة) | `intraday.db.stock_intraday` | — |
| Crypto prices | `data_engine.db.crypto_prices` + `btc_local_prices` | Top 50 CoinGecko + BTC بالعملات العربية |
| Crypto intraday | `intraday.db.crypto_intraday` | 104K+ سجل |
| Gold/metals | `data_engine.db.gold_prices` + `gold_prices_clean` + `silver_prices` | كل العيارات 24/21/18 + كل الدول |
| Forex | `data_engine.db.exchange_rates` | صرف العملات |
| Commodity intraday | `intraday.db.commodity_intraday` | — |

🔴 **الـ bug الجذري:** `data_engine.db.egksco_price_history` = **0 صفوف (فاضي)**. بس `vps-service/data/prices.py` + **10 ملفات** بـ check egksco FIRST (بنص صريح في prices.py L23/42/52) — بـ يـ waste I/O + بـ يسبب split-brain. **Rule 46 نفسها غلط** (أعلنت egksco canonical). الحل: prices.py بـ يـ check price_history FIRST، شيل egksco checks، حدّث Rule 46.

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
| ✅ **A-P3** | ألفا | ✅ PASS + متدفع (`92197fe`) — Guest Mode (AuthView سجن اتشال + GuestLockedView + isGuest) + TrialExpiredModal soft + PaywallListener (402/403 routing صح) + apiClient regression fix (9 methods). 3 حالات code-ready، browser كامل محتاج backend. |
| 🔜 **A-P4** | ألفا | admin 26→4-5 hubs |
| 🔄 **B-P2** | برافو (Python) + ألفا (A-P2.5 src) | ✅ PASS + متدفع — TRIAL_DAYS_CANONICAL=14 + fail-closed للـ paid (قرار جون اتـ implement) + trial_migration.py + admin reset |
| 🔜 **B-P3** | برافو | stocks/crypto unification — canonical محدّد (price_history للأسعار التاريخية) |
| 🔴 **MAESTRO-CANCER-1** | برافو (Python) + ألفا (frontend) | **أولوية قصوى — Stage 4** — surgical disconnection piece by piece: trace → افصل الفرونت → افصل telegram → 🔴 افصل قلب V40.2 (daily_predictor L3811) → شيل 13 endpoints → شيل 4 zombies → شيل maestro_orchestrator.py (LAST). unify thresholds على V40.2 (78/65/55). verify بعد كل قطع. ⚠️ بنشتغل على مفاصل حية |
| ✅ **DATA-LAYER-1** | برافو | ✅ PASS + متدفع — prices.py price_history-first + Rule 46 amended. ⏸️ follow-up معلّق (stale docstring + egksco reconcile) — الـ data-layer وقّفه المالك |
| ✅ **A-DB-1** | ألفا | ✅ PASS (جزئي) + متدفع — api-client.ts + shared-db deprecated. ⏸️ 56 routes migration معلّقة |
| ⏸️ **DEAD-ENGINE-1** | برافو | **معلّق + متصحّح** (الأولوية = DATA-LAYER-1). ⚠️ الخلاصة الجديدة: `engines/backtest_engine.py` + `analyzers/maestro_orchestrator.py` = **RED LINE (LIVE)** — ممنوع اللمس. الـ cancer الحقيقي = 5 broken scripts (diagnose_v402_filters/full، diagnose_entry_gate، retrospective_analysis، run_full_backtest_daemon.sh) + 3 zombie duplicates (scripts/backtesting_engine.py sys.exit guard، analysis_engine_v2.py، analyzers/backtest_engine.py). **triple-verify قبل أي إزالة**: not imported by daily_predictor/core/jobs/live_signals + not in crontab |
| ~~CANONICAL-DB-1~~ | برافو | ✅ متقرّر (المالك جاوب بالـ data — شوف Section 3.5) |

### ملاحظات verify (جون):
- A-P1: تبّت `page.tsx` ما اتلمس (git log empty للملف في الـ A-P1/A-P2 commits) → Rule 67 محترمة.
- A-P2: لقيت comments `RESTRUCT-A-P2` في الـ 3 views + TabsTrigger imports — tabs فعلًا مدمجة.
- B-P1: `require_role(min_tier, require_trial)` + `require_trial_or_paid` موجودين + مستوردين + مستخدمين في ai_routes + py_compile PASS. برافو بلّغ 4/4 logic tests ضد auth.db حقيقي (premium→paid، free+NULL→trial_not_set، guest→no_user، nonexistent→not_found). ✅ متحقق.
- ⚠️ B-P1 follow-up (B-P1.5): الـ decorator متطبّق على `/api/ai/live/scan` بس (1 من 469 endpoint). باقي الـ advanced endpoints محتاجة تطبيق في mandate منفصل بعد B-P2.
- 🎯 قرار CEO (fail-safe vs fail-closed): fail-SAFE للـ guest/public reads؛ fail-CLOSED للـ paid gates. ✅ متـ implement في B-P2 (auth_middleware L296 `fail_closed` param).
- 🚨 CRITICAL AVOIDED: DEAD-ENGINE-1 misclassification (delete live engine) اتصلّح قبل أي ضرر. المحركات الحية (backtest_engine.py + maestro_orchestrator.py) ما اتلمستش في أي commit.
- 🟡 NIT 1: prices.py module docstring (L1-90) stale (لسه egksco-first) — الـ function الفعلي (L340+) صح. برافو ينظّف.
- 🟡 NIT 2: egksco row-count تعارض — المالك قال 0، برافو قال 59,109 (Rule 46 amendment L1576). reconcile إنتاج vs ساندبوكس.
- 🟡 NIT 3: A-DB-1 جزئي — 56 routes pending migration لـ Python proxy.

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
| 4 | trial 4-source | B-P2 + A-P2.5 | برافو+ألفا | ✅ خلص — TRIAL_DAYS=14 canonical |
| 5 | price split-brain | DATA-LAYER-1 | برافو | ✅ خلص — prices.py price_history-first + Rule 46 amended |
| 6 | frontend direct-DB | A-DB-1 | ألفا | ✅ جزئي — api-client.ts + shared-db deprecated، 56 routes pending |
| 7 | R/R stale 1.5 | cleanup دستوري | ألفا | ⏸️ معلّق |
| 8 | ~~dead-engine cancer~~ → **تصحيح**: `engines/backtest_engine.py` LIVE (V40.2 driver). الـ cancer الحقيقي = 5 broken scripts + 3 zombie duplicate engines. DEAD-ENGINE-1 معلّق | برافو | ⏸️ معلّق |
| 9 | 🔴🔴🔴 **MAESTRO-CANCER-1** (Stage 4): maestro_orchestrator 4,416 lines LIVE + 13 endpoints + متغلغل في V40.2 قلب + telegram + فرونت + 4 zombies + thresholds متناقضة → توصيات متناقضة للعميل | برافو+ألفا | 🔴 أولوية قصوى |

---

**جون — بالدليل مش بالكلام. استكمل من هنا لو ضاع حاجة.**

---

## 12. MAESTRO-CANCER-1 — STEP 0 TRACE نتائج + القرار (2026-10-18)

### الـ 5 live callers (تبّت جون):
1. `daily_predictor.py L3811` run_expert_memory_phase — optional shim (try/except) **بس بـ يعمل lesson-veto** (شيلانه = فقدان الـ veto، مش crash).
2. `telegram/auto_post_scheduler.py L1190` daily_opportunities — HARD dependency.
3. `api/stock_analysis_routes.py L43` → hunting_engine helpers (ممكن مش محتاجين maestro مباشرة — verify).
4. `jobs/market_scheduler.py L114` → background_analyzer — **مش في crontab** (ممكن dead — verify).
5. `live_signals/recorder.py L39/116` → crypto_maestro — HARD LIVE.

### 🔴 V40.2 ماعندهش بدائل جاهزة لـ daily_opportunities/hunting/background/crypto → STEP 4-6 = BUILD مش swap.

### القرار (reordered للسرعة + الحرص):
- **فورية (ألفا)**: بدّل الفرونت لـ V40.2 canonical → يوقف التناقض للعميل فورًا.
- **برافو NOW (safe)**: STEP 3 المعدّل — **re-implement lesson-veto جوّه V40.2 قبل شيل الـ shim** (قرار المالك: (ب) — مفيش فقدان قدرة) + STEP 2 (ابني V40.2 daily_opportunities للـ telegram).
- **STOP قبل STEP 4-6**: BUILD scope (V40.2 equivalents) — حقق + ابعتلي.
- **STEP 1 (410)**: بعد ما ألفا بدّل الفرونت.
- **STEP 7 (kill maestro)**: LAST.

---

## 13. تحديثات متأخرة (2026-10-18 مساءً) — جون سبه، بيلحق دلوقتي

### ✅ MAESTRO-CANCER-1 — خلص + متتحقق آمن (commit `e634be8` + `4853696`)
- maestro_orchestrator.py (4,416 سطر) اتمسح. 13 endpoints → 410. الـ 4 analyzers بـ catch + كمّلوا (MAESTRO_*=False). المنصة آمنة.

### ✅ DATA-ENGINE-AUDIT-1 — خلص + متدفع (commit `0932151`)
- برافو فحص محرك البيانات (port 5000): 18 endpoints + 22 scrapers + 5 sync functions.
- DATA-ENGINE-MAP.md على origin (13.9KB) — الـ data flow كامل (EGX live/daily + crypto + gold + forex).
- الـ 4 dead files اتمسحتوا فعلًا (recorder + 3 scripts).

### 🔴 الـ Data Engine findings + توضيحات المالك:
| الـ finding | توضيح المالك | الحالة |
|---|---|---|
| stocks.db.stocks stale 4 شهور | **EGXPilot scraper مات** (الموقع الاتقفل) → مش fixable. محتاج مصدر بديل. | 🔴 محتاج قرار جاي |
| intraday.db stale 4 أيام | **مش مستعملة خلاص** (deprecated). | ✅ ما يهمش |
| aiPrediction stale 7 أيام | **عادي** — الـ sample DB عند جون مش كامل. المالك بـ يشغل daily_predictor بنفسه على الإنتاج. | ✅ عادي |
| الـ DBs stale عمومًا | **sample مش كاملة** + كان فيه جمع+سبت إجازة. آخر تحديث ~امبارح. | ✅ مفهوم |
| egksco vs price_history | **100/100 match** — متطابقين. | ✅ تمام |

### ✅ DROP-EMPTY-TABLES-1 (خلص + متتحقق — commit 0b47eb6 + 45f6d43)
- برافو شال **78 empty tables** من sandbox (مش 6). 0 data loss.
- **متتحقق آمن**: كل الـ 38 referenced tables فيهم `CREATE TABLE IF NOT EXISTS` → auto-recreate. daily_predictor EXIT=0.
- السكربت **enhanced** (`--check-refs` + `--exclude` + `_check_auto_create`) — جاهز للـ production بـ إذن المالك.
- production run: `python3 scripts/drop_empty_tables.py --check-refs --exclude=paper_trades,signal_logs`
- سكربت يمسح الجداول الفاضية (egksco_stocks + news_articles + metrics.resource_snapshot_* + historical.daily_prices + crypto.cryptos + أي تاني فاضي).
- أمان: verify row=0 قبل DROP، --dry-run، idempotent، Rule 17، sandbox copy بس.

### 🚫 cron/production ops = بتاع المالك
- جون **بطلّع ايده** من الـ cron/production. المالك بـ يـ check الإنتاج بنفسه (cron logs + scrapers).
- لو scraper مكسور (كود) → برافو يصلّحه. لو مش شغّال (ops) → المالك يشغّله على الـ VPS.

### 🔜 Alpha A-P3 (Auth UI) — جاري + revival prompt جاهز
- A-P3 mandate مفصل اتعطى لألفا (Guest Mode + Trial soft + soft paywalls + 4 files).
- revival prompt جاهز (لو ألفا مات بسبب بيئة النود الزفت) — فيه تاريخه + آخر شغل + قواعده.

### ملاحظة مستقبلية:
- EGXPilot مات = مفيش live price source. هنحتاج مصدر بديل (Yahoo؟ TradingView live؟) في مرحلة جاية. **مش دلوقتي**.

---

## 14. أوامر الإنتاج + اللاب توب (scripts برافو — تنفّذ بإذن المالك)

السكربتات دي عملها فريق برافو. **تنفّذ على الإنتاج VPS + اللاب توب بإذن المالك بس** (Rule 1). جون ما يـ run-sh على الإنتاج.

### 1. drop_empty_tables.py (تنظيف الجداول الفاضية)
- جاهز + متتحقق آمن. كل الـ referenced tables فيهم `CREATE TABLE IF NOT EXISTS` → auto-recreate.
- **dry-run الأول** (يبّن بس):
  `python3 scripts/drop_empty_tables.py --dry-run --check-refs`
- **الـ run الحقيقي** (بعد مراجعة الـ dry-run):
  `python3 scripts/drop_empty_tables.py --check-refs --exclude=paper_trades,signal_logs`

### 2. trial_migration.py (backfill trial_ends_at)
- يـ backfill NULL trial_ends_at → NOW()+14d لـ free-tier users. idempotent + --dry-run.
- **dry-run الأول**:
  `python3 vps-service/scripts/trial_migration.py --dry-run`
- **الـ run الحقيقي**:
  `python3 vps-service/scripts/trial_migration.py`
- على auth.db (Rule 1 — إذن المالك).

### 3. daily_predictor (cron — بـ يشتغل تلقائي على الإنتاج)
- crontab (Sun-Thu):
  `0 3 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 vps-service/jobs/daily_predictor.py --today-only --max-picks 5 >> /tmp/v40_2_morning.log 2>&1`
  `30 13 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 vps-service/jobs/daily_predictor.py --yesterday-only --max-picks 5 >> /tmp/v40_2_evening.log 2>&1`
- logs: `/tmp/v40_2_morning.log` + `/tmp/v40_2_evening.log`.
- run يدوي (لو محتاج): `python3 vps-service/jobs/daily_predictor.py --today-only --max-picks 5`

### ⚠️ ملاحظات مهمة
- كل الـ commands دي **بإذن المالك**. جون ما يلمس الإنتاج.
- trial_migration + drop_empty_tables: **dry-run الأول دايماً**.
- cron (daily_predictor): المالك بـ يـ check الـ logs + يشغّله بنفسه.
- EGXPilot scraper مات (الموقع اتقفل) = مفيش live price source. محتاج مصدر بديل (Yahoo؟ TradingView؟) — **مش دلوقتي**.
