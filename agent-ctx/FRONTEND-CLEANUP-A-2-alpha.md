# تکلیف: FRONTEND-CLEANUP-A-2

> **موجہ لـ:** ألفا (Frontend)
> **من:** جون (المدير التنفيذي)
> **التاريخ:** 2026-10-19 (تحديث 2: إضافة Problem 4 الصفحات الحية + احترام تعديلات جيمي)
> **الخطورة:** 🟠 HIGH — كود مكسور + تضارب بيانات العميل + شاشات ميتة
> **القواعد الدستورية:** Rule 4, Rule 20, Rule 27, Rule 67, Rule 73, Rule 75

---

```
╔══════════════════════════════════════════════════════════════════╗
║  تکلیف: FRONTEND-CLEANUP-A-2                                     ║
║  موجہ لمين: ألفا (Frontend)                                       ║
╠══════════════════════════════════════════════════════════════════╣
║  المشكلة المکتشفة (بالإثباتات):                                   ║
║                                                                  ║
║  3 مشکلات في src/ — كلهم بيـ cause تضارب بيانات أو كود مكسور.    ║
║                                                                  ║
║  Problem 1 — 1679 pre-existing tsc errors في الكود كله:          ║
║  - الدليل: npx tsc --noEmit → 1679 errors.                      ║
║    أكبر الملفات:                                                  ║
║    * ComprehensiveStockAnalysis.tsx (195 errors)                 ║
║    * stock-names.ts (134 errors)                                  ║
║    * + ملفات تانية كتير                                           ║
║  - السبب: الكود تراكمت فيه أخطاء types من فترات طويلة.           ║
║  - الخطر: أي refactoring أو feature جديدة هتبني على كود مكسور.   ║
║                                                                  ║
║  Problem 2 — BTC price 3 أرقام مختلفة على الشاشة:                ║
║  - الدليل:                                                       ║
║    /api/data-engine/crypto → BTC=81119.87, change=-0.57%,        ║
║      rank=2, name="BTC/USDT"                                     ║
║    /api/crypto/coins → BTC=82318, change=+0.359%,                ║
║      rank=1, name="Bitcoin"                                       ║
║    /api/predictions/eid → BTC entryPrice=81119.87                ║
║  - فرق 1198$ + إشارة مختلفة (نازل vs طالع) + rank مختلف.         ║
║  - العميل بيشوف رقمين مختلفين لنفس العملة لو الشاشة بـ swap.     ║
║  - السبب: /api/crypto/coins بيقرأ من source مختلف عن             ║
║    /api/data-engine/crypto. مفيش canonical source موحّد.         ║
║                                                                  ║
║  Problem 3 — EGX50 index change غلط رياضياً:                     ║
║  - الدليل:                                                       ║
║    /api/market/overview → change=-149.75 (غلط)                  ║
║    /api/market/indices → change=-149.75 (غلط)                   ║
║    /api/market-pulse → change_percent=+34.59% (صح)              ║
║  - value=7877.31, previous_close=5852.85                         ║
║  - المفروض: change = value - previous_close = +2024.46           ║
║  - الـ change field بيحسب غلط (إشارة سالبة + قيمة غلط).          ║
║  - السبب: في src/app/api/market/ (overview/indices)، الـ change   ║
║    بيتحسب من formula غلط أو بيـ read من field مختلف.             ║
║                                                                  ║
║  Problem 4 — الشاشات ميتة (مش بتـ update live):                  ║
║  - توجيه المالك: «الصفحات لازم تكون حية وبتنبض بالحياة»           ║
║  - الدليل:                                                        ║
║    * رادار السيولة: الترتيب ثابت، ما بيتغيرش لما السيولة تزيد/قل  ║
║    * شاشة الأسهم: الترتيب ثابت رغم تغير السعر/الحجم                ║
║    * مفيش indicator بصري لـ "سيولة زادت" / "سيولة قلت"            ║
║  - المطلوب:                                                       ║
║    * تحديث البيانات بالـ polling (كل 1-5 دقايق للـ data،          ║
║      مش كل شوية)                                                  ║
║    * التغيير يكون data update (مش إعادة رسم الشاشة كلها)          ║
║    * مؤشرات بصرية لـ التغير (flash green/red، arrow up/down،     ║
║      delta badges)                                                ║
║    * الترتيب يتـ re-sort لما السعر/السيولة يتغير                  ║
║  - القاعدة التقنية: React.memo + useMemo + useCallback عشان       ║
║    ما تـ re-renderش كومبوننت لو الـ data ما اتغيرش.               ║
║  - جيمي عمل ده في UnifiedTable.tsx (useMemo + useCallback +       ║
║    memo) — اتبع نفس الـ pattern.                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  ⚠️ احترام تعديلات جيمي (إلزامي):                                 ║
║  جيمي (شريك المالك) عمل تعديلات كتير آخر فترة. ألفا لازم:         ║
║  1. تـ pull آخر الكود من origin/main قبل ما تبدأ                  ║
║  2. تقرأ الـ diffs بتاعة جيمي وتفهم الـ patterns:                 ║
║     * UnifiedTable.tsx: useMemo + useCallback + memo للـ perf     ║
║     * FormulaEngine.ts: static imports للـ client bundle          ║
║     * LoginPromptModal.tsx: compact design pattern                ║
║     * BRAVO-INDICATOR-UNIFY: canonical delegates (مش تنفيذ مكرر)  ║
║  3. تتبع نفس الـ patterns في شغلك الجديد                          ║
║  4. ما تكسّرش أي تعديل من تعديلات جيمي                            ║
║  5. لو لقيت تعارض بين تعديلاتك وتعديلات جيمي → ارفعه لجون         ║
╠══════════════════════════════════════════════════════════════════╣
║  خطة المراحل (overview):                                         ║
║  - المرحلة 1: تشخيص الـ 1679 tsc errors + تصنيفها                ║
║  - المرحلة 2: إصلاح الـ tsc errors (أكبر 10 ملفات الأول)         ║
║  - المرحلة 3: توحيد BTC canonical source (Rule 73)              ║
║  - المرحلة 4: إصلاح EGX50 change math                            ║
║  - المرحلة 5: الشاشات الحية (live polling + flash updates)       ║
║  - المرحلة 6: اختبارات شاملة + Agent Browser verify             ║
╠══════════════════════════════════════════════════════════════════╣
║  تفاصيل كل مرحلة (بالخطوات):                                     ║
║                                                                  ║
║  المرحلة 1 — تشخيص tsc errors:                                   ║
║    1.1. شغّل: npx tsc --noEmit --pretty false 2>&1 | tee          ║
║         /tmp/tsc_errors.txt                                      ║
║    1.2. صنّف الـ errors حسب الملف (group + count)                ║
║    1.3. حدد أكبر 10 ملفات (اللي فيها أكتر errors)                ║
║    1.4. لكل ملف، حدد نوع الـ error (missing type, any, null,     ║
║         incompatible, etc)                                       ║
║    1.5. وثّق في /tmp/tsc_diagnosis.md                            ║
║                                                                  ║
║  المرحلة 2 — إصلاح tsc errors (أكبر 10 ملفات):                   ║
║    2.1. ابدأ بأكبر ملف (ComprehensiveStockAnalysis.tsx — 195     ║
║         errors)                                                  ║
║    2.2. لكل ملف:                                                 ║
║         (a) اقرأ الـ errors                                       ║
║         (b) أصلح الـ types (من غير ما تغير logic)                ║
║         (c) تأكد إن الـ component لسه بيـ render                  ║
║    2.3. بعد كل ملف: npx tsc --noEmit على الملف ده بس             ║
║    2.4. الهدف: تقليل الـ 1679 لـ أقل من 500 (أكبر 10 ملفات)     ║
║    2.5. ⚠️ ما تكسّرش شاشة شغّالة. الـ fixes دي type-only          ║
║         (مش logic changes).                                      ║
║                                                                  ║
║  المرحلة 3 — توحيد BTC canonical source (Rule 73):              ║
║    3.1. افتح src/app/api/crypto/coins/route.ts +                 ║
║         src/app/api/data-engine/crypto/route.ts                  ║
║    3.2. حدد أنهي source هتـ canonical:                           ║
║         (a) data_engine.db.crypto_prices (live، بـ CoinGecko)    ║
║         (b) crypto.db.cryptos (legacy — migrated)                ║
║    3.3. الـ canonical = data_engine.db.crypto_prices (بـ رأي     ║
║         جون — ده اللي SESSION-STATE قال إنه canonical)           ║
║    3.4. خلي /api/crypto/coins يقرأ من نفس الـ source             ║
║    3.5. شيل أي source مكرر (لو /api/crypto/coins بيقرأ من        ║
║         crypto.db.cryptos → حوّله لـ data_engine.db)             ║
║    3.6. تأكد إن BTC price واحد في كل الـ routes                  ║
║                                                                  ║
║  المرحلة 4 — إصلاح EGX50 change math:                           ║
║    4.1. افتح src/app/api/market/overview/route.ts +              ║
║         src/app/api/market/indices/route.ts                      ║
║    4.2. دوّر على الـ change field computation                     ║
║    4.3. الـ formula الصح: change = value - previous_close        ║
║    4.4. لو الـ change بـ يـ read من DB field → تأكد إن الـ field  ║
║         ده صح (لو فيه bug في الـ data، ابلّغ برافو)              ║
║    4.5. لو الـ change بـ يـ compute في الـ route → أصلح الـ math  ║
║    4.6. تأكد إن change_percent = (change / previous_close) × 100 ║
║                                                                  ║
║  المرحلة 5 — الشاشات الحية (live polling + flash updates):       ║
║    5.1. حدد الـ priority screens (توجيه المالك):                  ║
║         * رادار السيولة (LiquidityRadarView)                     ║
║         * شاشة الأسهم (StocksView)                               ║
║         * Top Movers                                             ║
║         * Market Pulse widget                                    ║
║    5.2. لكل شاشة:                                                 ║
║         (a) ابحث عن polling mechanism موجود (useVisibilityAware-  ║
║             Polling موجود في src/hooks/)                         ║
║         (b) حدد الـ refresh interval (1-5 دقايق حسب الشاشة)       ║
║         (c) استخدم React.memo + useMemo + useCallback عشان       ║
║             ما تـ re-renderش كومبوننت لو الـ data ما اتغيرش      ║
║         (d) أضف flash indicator (green/red) لما السعر يتغير      ║
║         (e) أضف delta badge (+/- %) لـ التغير                    ║
║         (f) الترتيب يتـ re-sort لما السعر/السيولة يتغير          ║
║    5.3. لـ رادار السيولة بالذات:                                  ║
║         * أضف indicator بصري لـ "سيولة زادت" (green up arrow)    ║
║         * أضف indicator بصري لـ "سيولة قلت" (red down arrow)     ║
║         * الـ row يتـ re-order حسب الـ liquidity score           ║
║    5.4. الـ pattern المرجعي: UnifiedTable.tsx (جيمي) —            ║
║         useMemo + useCallback + memo                             ║
║    5.5. ما تـ re-renderش الشاشة كلها — بس الـ rows اللي اتغيرت   ║
║    5.6. اختبر بـ Agent Browser:                                  ║
║         * شاهد السعر لمدة دقيقة                                  ║
║         * لازم يـ flash لو اتغير                                 ║
║         * الـ DOM ما يتـ re-mountش (React DevTools)              ║
║                                                                  ║
║  المرحلة 6 — اختبارات شاملة:                                     ║
║    6.1. lint: bun run lint → 0 errors                           ║
║    6.2. tsc: npx tsc --noEmit → أقل من 500 (من 1679)            ║
║    6.3. curl tests:                                              ║
║         - /api/crypto/coins BTC == /api/data-engine/crypto BTC   ║
║         - /api/market/overview EGX50 change == value - prev      ║
║         - /api/market/indices EGX50 change == value - prev       ║
║    6.4. Agent Browser:                                           ║
║         - dashboard مفيهوش BTC بـ رقمين                          ║
║         - index card الـ change صح                               ║
║         - رادار السيولة بـ flash + re-order                      ║
║         - شاشة الأسهم بـ flash + re-sort                         ║
║    6.5. dev.log نظيف                                             ║
╠══════════════════════════════════════════════════════════════════╣
║  الاختبارات الصارمة بعد كل مرحلة (معيار القبول):                  ║
║                                                                  ║
║  بعد المرحلة 1:                                                   ║
║  - /tmp/tsc_diagnosis.md موجود + فيه أكبر 10 ملفات               ║
║  - ما عدّلتش أي كود                                              ║
║                                                                  ║
║  بعد المرحلة 2:                                                   ║
║  - tsc errors قلّت من 1679 لـ أقل من 500                         ║
║  - lint PASS                                                     ║
║  - كل الـ components لسه بـ render (Agent Browser verify)        ║
║                                                                  ║
║  بعد المرحلة 3:                                                   ║
║  - curl /api/crypto/coins BTC price == curl /api/data-engine/    ║
║    crypto BTC price                                              ║
║  - change_24h متطابق                                             ║
║                                                                  ║
║  بعد المرحلة 4:                                                   ║
║  - curl /api/market/overview EGX50 change == +2024.46            ║
║  - curl /api/market/indices EGX50 change == +2024.46             ║
║  - change_percent == +34.59%                                     ║
║                                                                  ║
║  الاختبار النهائي:                                                ║
║  - lint PASS + tsc < 500 errors + curl all PASS + Agent Browser  ║
║  - git status نظيف                                               ║
╠══════════════════════════════════════════════════════════════════╣
║  المحظورات:                                                      ║
║  - 🚫 ما تلمسش vps-service/ + scripts/ + db/ + prisma/           ║
║  - 🚫 ما تكسّرش شاشة شغّالة (الـ tsc fixes type-only)             ║
║  - 🚫 ما تعملش logic changes عشان تـ fix type error              ║
║  - 🚫 ما تـ create ملف جديد (Rule 4)                              ║
║  - 🚫 ما تـ disable اختبار                                        ║
║  - 🚫 ما تـ push (Rule 75 معلّقة)                                ║
║  - 🚫 TODO / dead code / console.log debug                       ║
║  - 🚫 ما تلمس config files (Rule 2)                              ║
╠══════════════════════════════════════════════════════════════════╣
║  القواعد الدستورية المرتبطة:                                     ║
║  - Rule 4 (NO-NEW-SCREENS-FILES)                                 ║
║  - Rule 20 (Python=Brain — ما تحسبش في الواجهة)                  ║
║  - Rule 27 (NO-FAKE-DATA)                                        ║
║  - Rule 67 (CALCULATION-CANONICAL)                               ║
║  - Rule 73 (SINGLE-DISPLAY-SOURCE)                               ║
║  - Rule 75 (PUSH-AFTER-EVERY-TASK — معلّقة، جون يـ push)         ║
╠══════════════════════════════════════════════════════════════════╣
║  التسليم:                                                        ║
║  - تقرير في worklog.md (Task ID: FRONTEND-CLEANUP-A-2)          ║
║  - diff + lint + tsc + curl + browser proof                      ║
║  - انتظر قرار جون (PASS/FAIL/BLOCKED) قبل أي push                ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## ملاحظات جون لألفا

1. **الـ tsc errors دي مش شغلك لوحدك** — دي تراكم تاريخي. بس إنت ألفا، و نطاقك `src/`. الـ 1679 errors دي كلها في `src/`. ابدأ بأكبر 10 ملفات.

2. **الـ BTC unification (Problem 2)** — لو لقيت إن `/api/crypto/coins` بيقرأ من `crypto.db.cryptos` (legacy)، حوّله لـ `data_engine.db.crypto_prices`. لو احتجت migration في الـ DB، ابلّغ جون (ده تکلیف برافو).

3. **الـ EGX50 change (Problem 3)** — لو الـ bug في الـ data (مش في الـ math)، ابلّغ جون. الـ indices جاية من `stocks.db.market_indices` أو `data_engine.db`. لو الـ field نفسه غلط، ده برافو.

4. **الترتيب** — المرحلة 3 (BTC) و 4 (EGX50) الأول (تضارب العميل بيشوفه)، بعدها المرحلة 1-2 (tsc cleanup — مفيش تضارب بس كود مكسور).

5. **ما تحاولش تـ fix الـ 1679 كلهم** — الهدف أقل من 500 (أكبر 10 ملفات). الباقي تکلیف تاني.

---

**جون — ألفا، إنتوا فاضيين. الـ 3 مشکلات دول محتاجين شغل. ابدأوا بالـ BTC + EGX50 (تضارب العميل بيشوفه)، بعدها الـ tsc cleanup. أي تسليم بدون اختبار = FAIL.**
