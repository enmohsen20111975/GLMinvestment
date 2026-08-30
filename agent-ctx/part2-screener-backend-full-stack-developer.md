# Task: part2-screener-backend
## Agent: full-stack-developer
## Status: ✅ COMPLETED (sandbox only — no git push)

## ما اتعمل
### Python (`vps-service/api/advanced_screener_routes.py`)
File: 288 → 401 سطر (+113)

**1. Import (line 16):**
- `from utils.stock_state import compute_stock_state, get_state_order`
- الـ helper من Part 1A (الـ shared module المشترك).

**2. 6 query params جديدة (lines 109-121):**
- `min_pe`, `max_pe` (P/E range — مكرر الربحية)
- `min_roe` (الحد الأدنى لـ ROE %)
- `min_dividend_yield` (الحد الأدنى لتوزيعات الأرباح %)
- `min_market_cap`, `max_market_cap` (نطاق القيمة السوقية)
- `stock_state` (Python-side post-filter — Python = brain)
  - valid values: CORRECTION | CORRECTION_END | DECLINING | NEAR_BREAKOUT | AT_PEAK | BALANCED_MOMENTUM | NEUTRAL
  - invalid values بـ ignore بصمت (safe-by-design، لا 500 error)

**3. post_sorts handling (lines 127-143):**
- `post_sorts = {'stock_state', 'momentum_score'}` — computed fields مش موجودة في SQL
- لو `sort_by` في post_sorts → SQL ORDER BY بـ fallback لـ `turnover_egp` (placeholder) + Python re-sort بعد fetch
- `needs_post_processing = bool(stock_state_filter) or needs_post_sort`
- `internal_limit = 500` لو post-processing — fetch pool أكبر قبل post-filter/sort، ثم slice لـ user limit (mitigation لـ R2.4 في خطة Plan)

**4. 6 where_clauses SQL جديدة (lines 206-224):**
- كل filter بـ pattern: `field IS NOT NULL AND field >= ?` / `<= ?` — يتجاهل NULLs + يـ apply على non-null فقط
- تستخدم params list (parameterized) — safe من SQL injection

**5. stock_state computation (lines 259-273):**
- قبل `stocks.append({...})` بـ build `stock_dict_for_state` بالـ 10 fields المطلوبة:
  `current_price, change_percent, ma_50, ma_200, rsi, high_52w, low_52w, avg_volume, volume, trend`
- `state_info = compute_stock_state(stock_dict_for_state)` → `{state, state_ar, state_reason, momentum_score}`

**6. 4 computed fields في stock dict (lines 318-322):**
- `stock_state` (key — one of 7 states)
- `stock_state_ar` (Arabic display name)
- `stock_state_reason` (short technical reason in Arabic)
- `momentum_score` (0-100, rounded to 1 decimal)

**7. Python-side post-filter (lines 325-328):**
- لو `stock_state_filter` موجود → `[s for s in stocks if s['stock_state'] == stock_state_filter]`
- بيتـ apply بعد ما كل stocks تـ build (state computed لكل واحد)

**8. Python-side post-sort (lines 330-343):**
- `momentum_score`: sort by float, `reverse=(order_dir == 'DESC')` → DESC = highest first
- `stock_state`: sort by `get_state_order()`, `reverse=(order_dir == 'ASC')` → DESC = best first (CORRECTION_END=1 ascending)، ASC = worst first (DECLINING=7 descending)

**9. Slice to user limit (lines 346-347):**
- `stocks = stocks[:limit]` لو `needs_post_processing` (بعد post-filter/sort)

**10. filters echo update (line 384):**
- أضفت `'stock_state': stock_state_filter or None` في response عشان الـ frontend يـ verify الـ filter

**11. Docstring update (lines 63-86):**
- شرح الـ 6 params الجديدة + الـ 4 computed fields + post-sort behavior (computed fields sorted in Python)

## اختبارات
- `python3 -c "import ast; ast.parse(open('vps-service/api/advanced_screener_routes.py').read())"` → ✅ syntax OK
- `python3 -c "from api.advanced_screener_routes import advanced_screener_bp"` → ✅ import OK (after `pip3 install flask`)
- `bun run lint` (frontend) → EXIT 0 ✅
- Flask test_client على real `db/stocks.db` — 6/6 scenarios pass:
  1. **Default**: 5 stocks رجعوا، كل keys موجودة.
  2. **stock_state=AT_PEAK**: 0 stocks (مفيش AT_PEAK حالياً)، filter echo=AT_PEAK. ✅
  3. **Fundamental filters** (P/E 5-20 + ROE≥10 + div_yield≥2 + mcap≥1B): HRHO رجع (pe=17.02, roe=18, div_yield=5.06, mcap=37B)، state=NEUTRAL، momentum=40. ✅
  4. **sort=momentum_score DESC**: top 5 كلهم momentum=80 (CORRECTION_END). ✅
  5. **sort=stock_state DESC**: top 10 كلهم CORRECTION_END (state_order=1). ✅
  6. **stock_state=BOGUS** (invalid): filter اتـ ignore، filter echo=None، 3 stocks رجعوا. ✅
- Scenario smoke-test على `compute_stock_state`: recovery / declining / at_peak — كلهم رجعوا الـ state الصحيح + momentum + reason. ✅

## القيود اللي اتبعت
- ✅ **No git push** — sandbox only (ما عملتش `git add`/`commit`/`push`)
- ✅ **Python = brain** (Rule 20): كل logic (state computation, post-filter, post-sort, momentum_score) في Python. Node proxy ما اتلمسش. Frontend ما اتلمسش (Part 2 frontend لاحق).
- ✅ **No AI hype** (Rule 31): الأسماء فنية محايدة (CORRECTION / CORRECTION_END / DECLINING / NEAR_BREAKOUT / AT_PEAK / BALANCED_MOMENTUM / NEUTRAL). مفيش "🚀 انفجار" ولا "🔥 فرصة".
- ✅ **Safe-by-design**: invalid stock_state بـ ignore بصمت (لا 500 error). NaN/None بـ propagate لـ NEUTRAL.
- ✅ **SQL injection safe**: كل filters parameterized (params list). sort field validated ضد whitelist (`valid_sorts` set) + computed fields handled بـ post-sort (ما بتـinjectش SQL).

## ملاحظات للـ Next Agents (Part 2 frontend)
- الـ API endpoint `/api/screener/advanced` دلوقتي بيرجع كل الـ fields المطلوبة:
  - **Filters** (query params): market, sector, sort, order, limit, min_price, max_price, min_volume, min_turnover, min_change, trend, above_ma, rsi_oversold, rsi_overbought, volume_surge, near_52w_high, near_52w_low, **min_pe, max_pe, min_roe, min_dividend_yield, min_market_cap, max_market_cap, stock_state**
  - **Sort fields**: كل الـ SQL columns + **stock_state** (best→worst by STATE_ORDER) + **momentum_score** (0-100)
  - **Per-stock computed fields**: `stock_state`, `stock_state_ar`, `stock_state_reason`, `momentum_score`
- الـ Node proxy موجود (`src/app/api/screener/advanced/route.ts`) — ما يحتاجش تعديل.
- مثال URL للـ frontend:
  ```
  /api/screener/advanced?market=EGX&stock_state=CORRECTION&min_pe=5&max_pe=20&min_roe=15&sort=momentum_score&order=desc&limit=50
  ```
- الـ state colors (لو الـ frontend محتاجها): AT_PEAK=amber, CORRECTION_END=emerald, BALANCED_MOMENTUM=green, DECLINING=red, CORRECTION=orange, NEAR_BREAKOUT=blue, NEUTRAL=gray (موجودة في `utils/stock_state.py:STATE_COLORS`).
- الـ state order للـ badge sort: CORRECTION_END=1 (best) ... DECLINING=7 (worst) — موجود في `utils/stock_state.py:STATE_ORDER`.

## ملاحظات للـ Next Agents (Part 4 backend — stop-loss)
- الـ helper `compute_stock_state` يستخدم `ma_50` كـ proxy لـ MA20 (decision من خطة Plan R2.1/R2.2 — screener ما بـ fetchش price history لـ MA20 computation).
- لو Part 4 محتاج MA20 actual → يـ compute من `price_history.db.price_history` في `is_near_correction_end` / `is_in_active_correction` (الدوال موجودة في `utils/stock_state.py` بس دلوقتي بـ use MA50 proxy).
- الـ stock_state filter في الـ screener بـ uses post-filter (Python-side) — لو Part 4 محتاج نفس pattern لـ filtering بعد computation، راجع `advanced_screener_routes.py:325-343` كـ reference.
