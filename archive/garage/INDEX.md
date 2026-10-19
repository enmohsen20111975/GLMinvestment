# Garage Index — Dead/Deprecated Code Archive

> كل ملف هنا اتعمله archive (مش delete) لحد ما الاختبارات تثبت إنه زبالة.
>
> Rule 16 (VERIFY-BEFORE-DELETE) — الأرشفة أول، الـ delete بعد ما نتأكد.
> Rule 4 (NO-NEW-FILES) — الـ archive مش ملفات جديدة، ده نقل لـ ملفات موجودة.

## الـ Rule

- **ما تـ importش** أي ملف من هنا في كود حي. لو محتاج Function فيه، اعمله rewrite في مكانه الصحيح.
- **ما تـ deleteش** أي ملف من هنا بدون قرار جون (PASS/FAIL/BLOCKED) + اختبارات صارمة.
- **كل ملف** هنا محفوظ بـ `git mv` (التاريخ محفوظ — `git log --follow` بيشتغل).

## الـ Index

| الملف الأصلي | مكان الأرشفة | السبب | التاريخ |
|---|---|---|---|
| `vps-service/scripts/seed_official_stocks.py` | `archive/garage/seed_official_stocks.py` | BUG: ticker = Arabic name (مخالف للـ canonical = English uppercase). الـ tickers الرسمية لازم تيجي من EGKSCO بس. DATA-ENGINE-UNIFY-1 Stage 1.1. | 2026-10-19 |
| `vps-service/scripts/seed_egx_stocks.py` | `archive/garage/seed_egx_stocks.py` | Seed script بـ write مباشر في stocks.db (مخالف للـ canonical flow: data_engine.db → sync.py → stocks.db). الـ tickers الرسمية لازم تيجي من EGKSCO بس. DATA-ENGINE-UNIFY-1 Stage 1.1. | 2026-10-19 |
| `vps-service/scripts/seed_multi_market_stocks.py` | `archive/garage/seed_multi_market_stocks.py` | Seed script بـ write مباشر في stocks.db لمصادر multi-market. الـ tickers الرسمية لازم تيجي من المصدر الـ canonical لكل asset class. DATA-ENGINE-UNIFY-1 Stage 1.1. | 2026-10-19 |
| `data_engine/scrapers/egxpilot_scraper.py` | `archive/garage/egxpilot_scraper.py` | DEPRECATED في `fallback_chain.py` (AGILE-PHASE1-034). المصدر ميت (ما بيرجّعش data fresh). الـ `_try_egxpilot()` لسه معرّف للتوافق بس الـ main chain مش بـ يناديه. DATA-ENGINE-UNIFY-1 Stage 1.2. | 2026-10-19 |
| `data_engine/scrapers/yahoo_scraper.py` | `archive/garage/yahoo_scraper.py` | DEPRECATED في `fallback_chain.py` (AGILE-PHASE1-034). بيرجّع بيانات أمس (stale). الـ `_try_yahoo()` لسه معرّف للتوافق بس الـ main chain مش بـ يناديه. DATA-ENGINE-UNIFY-1 Stage 1.2. | 2026-10-19 |
| `src/hooks/useSmartChart.ts` | `archive/garage/src-hooks/useSmartChart.ts` | ORPHAN: مش مستورد في أي ملف حي (280 LOC). Chart hook قديم اتسّطب. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/hooks/use-previous-value.ts` | `archive/garage/src-hooks/use-previous-value.ts` | ORPHAN: مش مستورد في أي ملف حي (51 LOC). Hook تجريبي. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/hooks/use-persona-results.ts` | `archive/garage/src-hooks/use-persona-results.ts` | ORPHAN: مش مستورد في أي ملف حي (118 LOC). Persona results hook قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/hooks/useSignalNotifications.ts` | `archive/garage/src-hooks/useSignalNotifications.ts` | ORPHAN: مش مستورد في أي ملف حي (182 LOC). Signal notifications hook قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/modules/personalized/lib/personalized-radar.ts` | `archive/garage/src-modules/personalized-radar.ts` | ORPHAN: مش مستورد في أي ملف حي (583 LOC). Personalized radar logic قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/data/crypto-learning-content.ts` | `archive/garage/src-data/crypto-learning-content.ts` | ORPHAN: مش مستورد في أي ملف حي (612 LOC). Crypto learning content قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/lib/unified-db.ts` | `archive/garage/src-lib/unified-db.ts` | ORPHAN: مش مستورد في أي ملف حي (487 LOC). Unified DB قديم (اتلغى لـ api-client). ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/lib/external-data-fetcher.ts` | `archive/garage/src-lib/external-data-fetcher.ts` | ORPHAN: مش مستورد في أي ملف حي (329 LOC). External data fetcher قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/lib/community-db.ts` | `archive/garage/src-lib/community-db.ts` | ORPHAN: مش مستورد في أي ملف حي (90 LOC). Community DB قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/lib/crypto-learning-store.ts` | `archive/garage/src-lib/crypto-learning-store.ts` | ORPHAN: مش مستورد في أي ملف حي (385 LOC). Crypto learning store قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/lib/new-db-queries.ts` | `archive/garage/src-lib/new-db-queries.ts` | ORPHAN: مش مستورد في أي ملف حي (346 LOC). New DB queries قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/lib/vps-client.ts` | `archive/garage/src-lib/vps-client.ts` | ORPHAN: مش مستورد في أي ملف حي (656 LOC). VPS client قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/lib/m2ySyncClient.ts` | `archive/garage/src-lib/m2ySyncClient.ts` | ORPHAN: مش مستورد في أي ملف حي (80 LOC). M2Y sync client قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/lib/chart-generator.ts` | `archive/garage/src-lib/chart-generator.ts` | ORPHAN: مش مستورد في أي ملف حي (360 LOC). Chart generator قديم. ENGINEERING-CLEANUP. | 2026-10-19 |
| `src/lib/engine-control-store.ts` | `archive/garage/src-lib/engine-control-store.ts` | ORPHAN: مش مستورد في أي ملف حي (300 LOC). Engine control store قديم. ENGINEERING-CLEANUP. | 2026-10-19 |

## ملاحظات

- **الـ 3 seed scripts:** فيهم بـ write مباشر في `stocks.db` (مخالفة صريحة للـ Rule 4 من الـ canonical flow: "ممنوع أي ملف يكتب في stocks.db مباشرة"). الـ `seed_official_stocks.py` فيه BUG إضافي: ticker = اسم عربي (مخالف لـ "ticker canonical = English uppercase").
- **الـ 2 deprecated scrapers:** importهم في `fallback_chain.py` جوّه `_try_egxpilot()` + `_try_yahoo()` — الاتنين deprecated ومش بـ يتندوا من الـ main fallback chain. الـ import جوّه `try/except ImportError`، فلما الـ files اتمسحت من مكانها الأصلي، الـ functions رجّعت `[], "ImportError"` بدل ما تـ crash. ده السلوك المطلوب (Fail-Fast graceful).
- **ما اتمسحش أي ملف فعلياً** — `git mv` بس. لو حد احتاجهم، `git log --follow archive/garage/<file>` بيوريك التاريخ كامل.

## الـ acceptance tests (بعد الأرشفة)

```bash
# 1. الـ files مش في مكانها الأصلي
ls vps-service/scripts/seed_official_stocks.py vps-service/scripts/seed_egx_stocks.py vps-service/scripts/seed_multi_market_stocks.py data_engine/scrapers/egxpilot_scraper.py data_engine/scrapers/yahoo_scraper.py
# → كلهم "No such file or directory"

# 2. الـ files موجودة في garage
ls archive/garage/{seed_official_stocks,seed_egx_stocks,seed_multi_market_stocks,egxpilot_scraper,yahoo_scraper}.py
# → كلهم موجودين

# 3. مفيش imports حية للـ seed scripts
grep -rn "seed_official_stocks\|seed_egx_stocks\|seed_multi_market_stocks" vps-service/ data_engine/ src/
# → مفيش نتايج حية (ممكن docstring/self-references بس)
```
