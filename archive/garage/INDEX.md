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
