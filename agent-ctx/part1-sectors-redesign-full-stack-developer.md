# Task: part1-sectors-redesign
## Agent: full-stack-developer
## Status: ✅ COMPLETED (sandbox only — no git push)

## ما اتعمل
### Python (`vps-service/api/sector_tracking_routes.py`)
- أضفت لـ `stocks[]` في `/api/sectors/tracking`: `turnover_egp` (vol×price), `ma_50`, `ma_200`, `above_ma50` (bool), `distance_from_52w_high` (%), `distance_from_52w_low` (%).
- أضفت لـ `sectors[]`: `total_market_cap` (sum of market_cap).
- أضفت لـ `valid_sorts`: `total_market_cap` + `leader_change`.
- استبدلت sort lambda بـ `_typed_sort_key` (tuple `(type_rank, value)`) — safe مع numeric/string/None mix.
- Docstring حدّث بكل fields + sort fields.

### Frontend (`src/components/analysis/MarketAnalysisView.tsx`)
- Import fix: أضفت `formatNumber` لـ import من `@/lib/utils` (كان مش مستورد).
- Interfaces: وسّعت `SectorTrackingStock` (+7 fields) + `SectorTrackingEntry` (+`total_market_cap`).
- New types: `SectorStockSortField` (8 sortable fields للجدول الفرعي).
- New helpers: `formatEGPShort` (مليار/مليون/ألف بالعربي), `avgChangeHeatClass`, `stockChangeHeatClass` (heatmap بسيط 3-level).
- SectorTrackingTab redesign كامل:
  - **No cards** (لا كروتات) — شريط أدوات + inline summary (6 KPIs) + جدولين فقط.
  - الجدول الرئيسي: 8 أعمدة sortable (القطاع | الحرارة | متوسط التغير % بـ heatmap bg | إجمالي السيولة | رابحة | خاسرة | سهم القائد clickable | القيمة السوقية | زر التوسعة).
  - الجدول الفرعي (collapsible): 8 أعمدة sortable (السهم | السعر | التغير % بـ heatmap | الحجم | السيولة ج.م | القيمة السوقية | فوق/تحت MA50 | RSI | من قمة 52 أسبوع). كل صف clickable → `useAppStore.loadStockDetail(ticker)` ينقل لـ #stock-detail.
  - RTL (`dir="rtl"` على root) + responsive (mobile-first grid).
  - شريط شرح ألوان (heatmap legend) + interaction hints في footer.

## اختبار sandbox
- `bun run lint` → EXIT 0 ✅
- `python3 -c "import ast; ast.parse(open('vps-service/api/sector_tracking_routes.py').read())"` → ✅
- `curl http://127.0.0.1:3000/` → HTTP 200 (Next dev يـ compile بنجاح) ✅
- Python backend on :8010 ما بيشتغلش في sandbox الحالي (مش متعلق بتعديلاتي — bug سابق).

## القيود اللي اتبعت
- ✅ لا git push (sandbox فقط)
- ✅ لا كلمات حماسية (لا "🚀" ولا "🔥 فرصة" ولا "AI magic")
- ✅ لا كروتات — جداول فقط (Rule 30)
- ✅ Python = brain — كل logic في Python، Node/React = display (Rule 20)
- ✅ shadcn/ui components (Table, Badge, Select, Button, Skeleton, Card للـ error state فقط)
- ✅ RTL (عربي) — كل النصوص بالعربي
- ✅ client-facing — العميل يفهمها بسهولة

## ملاحظات للـ Next Agents
- Python endpoint `/api/sectors/tracking` دلوقتي بيرجع fields كاملة للـ stocks sub-table — Part 2 (screener) و Part 4 (stop-loss) ممكن تستفيد من نفس pattern لـ turnover_egp + distance_from_52w computation (موجود كـ reference).
- الـ `_typed_sort_key` helper ممكن يـ reuse في endpoints تانية بتـ sort بـ mixed types.
- الـ `formatEGPShort` و `avgChangeHeatClass` helpers ممكن يـ move لـ `@/lib/utils.ts` لو Part 2/3 محتاجينها (دلوقتي محلية في MarketAnalysisView.tsx).
