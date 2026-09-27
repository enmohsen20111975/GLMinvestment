# 🛡️ توجيه معماري: استقرار الشاشات وتحديث البيانات اللحظي الموضعي بدون إعادة تحميل
## Architectural Directive: UI View Stability & Silent In-Place Data Refresh

> **الموجّه إلى:** الفريق البرمجي / المبرمج الثاني / وكلاء الذكاء الاصطناعي (Team 2 & Collaborators)  
> **التاريخ:** 2026-09-27  
> **الحالة:** معتمد كمعيار إلزامي لجميع شاشات التطبيق (Production Mandatory Standard)  
> **المرجع التطبيقي (Canonical Reference):** شاشة رادار السيولة (`#liquidity-radar` — `MakerRadarTab.tsx` + `page.tsx`)

---

## 🎯 المشكلة التي تم حلها (The Root Problem)

عند تصفح شاشات التطبيق (مثل رادار السيولة، الأسهم، التوقعات، أو المحفظة)، كان المستخدم يواجه المشكلة التالية:
> *"كل فترة قصيرة الشاشة تقوم بعمل إعادة تحميل كامل (Flicker / Reload)، وكل الفلاتر، الترتيب، وعمليات البحث التي قمت بها تضيع تماماً وتعود للوضع الافتراضي!"*

### ⚠️ السبب الجذري في بنية React (Anti-Pattern):
1. **تعريف المكونات الديناميكية داخل دورة الرسم (`dynamicImport inside Render`):**
   * عند وضع `const View = dynamicImport(...)` داخل دالة `renderContent()` أو داخل `switch(currentView) { case '...': }`، تقوم React بإنشاء مؤشر مكوّن جديد كلياً (`New Component Reference`) في كل رندرة لصفحة `page.tsx`.
   * صفحة `AppShell` في `page.tsx` تعيد رسم نفسها دورياً عند وصول أي تحديث في الـ Zustand Store (مثل شريط الأسعار اللحظي، الإشعارات، العدادات، أو نبضات الـ Socket).
   * عندما تجد React أن مرجع المكون تغير (`prevType !== nextType`)، تقوم بـ **هدم المكون القديم بالكامل (`Unmount`)**، ثم إظهار شاشة الـ Skeleton/Loader، ثم بناء مكون جديد (`Mount`).
   * عملية الهدم (`Unmount`) **تمسح وتدمر جميع حالات الـ `useState` الداخلية**: الفلاتر، الترتيب (Sort)، البحث، التبويب النشط، وموضع التمرير (Scroll position).

```
❌ النمط الخاطئ السابق:
AppShell Render (بسبب أسعار/إشعارات)
    └──> switch (case 'view')
            └──> const MyView = dynamicImport(...)  <-- مرجع جديد في كل مرة!
                    └──> React Unmount للمكون القديم
                            ├──> تدمير الـ useState (ضياع الفلاتر والترتيب) 🗑️
                            └──> React Mount لمكون جديد (فلاش وشاشة تحميل) ⚡
```

```
✅ النمط الصحيح المعتمد:
Module Scope (أعلى الملف مرة واحدة فقط)
    └──> const MyView = withErrorBoundary(dynamicImport(...))
AppShell Render
    └──> switch (case 'view')
            └──> <MyView /> (نفس المرجع الثابت دائماً)
                    └──> البيانات تتحدث موضعياً (In-Place) بدون أي فلاش وبقاء الفلاتر والترتيب ✅
```

---

## 🏛️ الأركان الأربعة للاستقرار وتحديث البيانات الصامت (The 4 Golden Pillars)

على المبرمج الثاني تطبيق هذه القواعد الأربع بدقة على **أي شاشة حالية أو جديدة**:

### 1️⃣ الركن الأول: تعريف جميع الشاشات في النطاق العام للملف (`Module Scope`)
* **ممنوع قطعيّاً** استخدام `dynamicImport` أو تعريف مكونات React داخل الدوال أو الـ switch cases.
* كل شاشة يجب تعريفها في أعلى `src/app/page.tsx` وتغليفها بـ `withErrorBoundary`.

```tsx
// ✅ في أعلى ملف src/app/page.tsx (Module Scope):
const LiquidityRadarView = withErrorBoundary(
  dynamicImport(() => import('@/components/predictions/MakerRadarTab').then(m => ({ default: m.MakerRadarTab })), {
    ssr: false,
    loading: () => <LazyTabLoader label="رادار السيولة" />,
  }),
  'رادار السيولة',
);

// ✅ داخل switch (currentView) في AppShell:
case 'liquidity-radar':
  return <LiquidityRadarView market={currentMarket === 'CRYPTO' ? 'EGX' : currentMarket} />;
```

---

### 2️⃣ الركن الثاني: التحديث الصامت للبيانات (`Silent In-Place Polling`)
* عند جلب البيانات في الخلفية دورياً (Auto-refresh أو Polling)، **ممنوع تفعيل `loading = true`** إذا كانت البيانات موجودة مسبقاً (`data !== null`).
* تفعيل `loading = true` يُخفي الشاشة ويُظهر الـ Skeleton، مما يهدم الجداول ويزعج المستخدم.
* البديل: استخدم متغير `refreshing = true` فقط لتشغيل حركة دوران خفيفة لأيقونة التحديث (`animate-spin`) في الزاوية، مع إبقاء الجداول والبيانات معروضة وثابتة.

```tsx
// ✅ النمط الصحيح لدوال الجلب (Fetchers):
const fetchData = useCallback(async (silent = false) => {
  // لو silent = true (تحديث خلفي دوري) -> نشغل refreshing فقط ولا نلمس loading
  if (silent) {
    setRefreshing(true);
  } else {
    // التحميل الأولي فقط هو الذي يظهر skeleton لو لم تكن هناك بيانات
    setLoading(true);
  }

  try {
    const res = await fetch('/api/...', { cache: 'no-store' });
    const json = await res.json();
    if (json.success) {
      setData(json); // تحديث البيانات موضعياً
      setLastUpdated(new Date());
    }
  } catch (err) {
    console.error(err);
  } finally {
    if (silent) setRefreshing(false); else setLoading(false);
  }
}, [market]);

// وفي واجهة المستخدم:
if (loading && !data) {
  return <ScreenSkeleton />; // تظهر فقط عند أول زيارة لو مفيش كاش
}
// باقي الشاشة تظل مرسومة وثابتة!
```

---

### 3️⃣ الركن الثالث: الحفظ المسبق للمكونات والأعمدة (`React.memo` & `useMemo`)
* مكونات الجداول والأقسام الفرعية التي تعرض بيانات متكررة يجب تغليفها بـ `React.memo` لمنع إعادة رسمها ما لم تتغير خصائصها (`props`).
* مصفوفة أعمدة الجدول `columns` يجب تغليفها بـ `useMemo`؛ لأن إعادة إنشاء مصفوفة الأعمدة في كل رندرة تجعل الجدول يعيد حساب الفلاتر والترتيب بلا داعٍ.

```tsx
// ✅ تغليف المكون بـ React.memo:
const StockTable = memo(function StockTable({
  stocks,
  accent,
  onSelect,
}: StockTableProps) {
  // ✅ حفظ تعريف الأعمدة بـ useMemo:
  const columns: Column<RadarStockRow>[] = useMemo(() => [
    { key: 'ticker', header: 'السهم', sortable: true, filterable: true },
    { key: 'current_price', header: 'السعر', sortable: true },
    // ...
  ], [accent, onSelect]);

  const data = useMemo(() => stocks.map((s, i) => ({ ...s, _idx: i + 1 })), [stocks]);

  return (
    <UnifiedTable
      columns={columns}
      data={data}
      keyField="ticker"
      dense
      columnToggle
      filterable
    />
  );
});
```

---

### 4️⃣ الركن الرابع: إسناد مفاتيح ثابتة للأقسام (`Stable Explicit Keys`)
* عند رسم أقسام أو كروت شاشات تعتمد على شروط أو فلاتر (`conditional rendering`)، يجب وضع `key` نصي صريح وثابت (وليس `index` أو `Math.random()`).
* هذا يضمن لـ React معرفة المكون بدقة وإبقاء حالته دون إتلاف عند اختفاء أو ظهور أقسام مجاورة.

```tsx
// ✅ مفاتيح ثابتة صريحة:
{showPreSurge && (
  <RadarSection
    key="radar-pre-surge"
    title="🚀 Pre-Surge"
    stocks={preSurgeList}
  />
)}

{showExplosive && (
  <RadarSection
    key="radar-explosive"
    title="🔥 منفجرة"
    stocks={explosiveList}
  />
)}
```

---

## 📋 قائمة فحص ومراجعة الشاشات الأخرى (Audit Checklist for Team 2)

يرجى من المبرمج الثاني فتح الشاشات التالية في المشروع والتأكد من مطابقتها لهذا المعيار:

| # | الشاشة | الملف المستهدف | الفحص المطلوب |
|---|--------|----------------|---------------|
| 1 | **الأسهم (Screener)** | `src/components/stocks/StocksView.tsx` | التأكد من عدم إعادة ضبط فلاتر القطاعات عند تحديث أسعار الأسهم. |
| 2 | **المحفظة (Portfolio)** | `src/components/portfolio/EnhancedPortfolioView.tsx` | التأكد من أن تحديث أسعار الأسهم في المحفظة لا يقفل التبويبات المفتوحة أو تفاصيل الصفقات. |
| 3 | **قائمة المتابعة (Watchlist)** | `src/components/watchlist/EnhancedWatchlistView.tsx` | التأكد من ثبات الفرز والمجموعات أثناء التحديث الدوري. |
| 4 | **تتبع التوقعات (Predictions)** | `src/components/predictions/PredictionTrackingView.tsx` | التأكد من بقاء التبويب النشط (Target Hit, Active, etc.) وفلاتر الترتيب عند مزامنة الصفقات. |
| 5 | **إدارة التوصيات (Picks)** | `src/components/predictions/PicksManagementView.tsx` | التأكد من أن التحديث اللحظي لا يعيد المستخدم إلى أول صفحة أو يلغي الفلترة. |
| 6 | **التقارير (Reports)** | `src/components/reports/ReportsView.tsx` | التأكد من ثبات الكروت والشارتات دون رمشة. |
| 7 | **تحليل السوق (Market Analysis)** | `src/components/analysis/MarketAnalysisView.tsx` | التأكد من ثبات مؤشرات السيولة والفنيات داخل التبويبات الفرعية. |

---

## 🏆 ملخص النتيجة (Benefits)
1. **تجربة مستخدم فائقة السرعة والسلاسة:** لا توجد شاشات تحميل تومض فجأة أمام عين المستخدم.
2. **الاحتفاظ الكامل بالبيانات المدخلة:** الترتيب (Sorting)، الفلاتر (Filters)، البحث، والصفوف الموسعة تظل كما تركها المستخدم تماماً، بينما تتغير الأرقام والأسعار داخل الخلايا بهدوء وسلاسة.
3. **توفير استهلاك الذاكرة والـ CPU:** التخلص من الهدم والبناء العشوائي لشجرة الـ DOM، مما يقلل الحمل على متصفح العميل والسيرفر.

---

## ✅ نتائج مراجعة فعلية للشاشات (Live Audit Results — 2026-09-27)

تم مراجعة الشاشات برمجياً وتسجيل حالتها الفعلية:

| # | الشاشة | الملف | الحالة | الملاحظات |
|---|--------|-------|--------|-----------|
| 1 | **رادار السيولة** | MakerRadarTab.tsx + page.tsx | ✅ **مكتمل** | النموذج المرجعي — module-scope import، React.memo، stable keys |
| 2 | **الأسهم (Screener)** | StocksView.tsx | ✅ **مكتمل** | يستخدم efreshLivePrices (in-place) بدون setLoading على polling |
| 3 | **قائمة المتابعة** | EnhancedWatchlistView.tsx | ✅ **مكتمل** | silent=true pattern مطبق بالكامل مع setRefreshing فقط |
| 4 | **المحفظة** | EnhancedPortfolioView.tsx | ✅ **مكتمل** | loadAssets(silent=true) بدون setLoading عند الـ polling |
| 5 | **إدارة التوصيات** | PicksManagementView.tsx | ✅ **مكتمل** | setRefreshing فقط عند التحديث اليدوي، initial load منفصل |
| 6 | **تتبع التوقعات** | PredictionTrackingView.tsx | ⚠️ **يحتاج مراجعة** | setLoading(true) بدون silent-guard — يظهر skeleton عند كل refresh |
| 7 | **التقارير** | ReportsView.tsx | ⚠️ **يحتاج مراجعة** | setLoading(true) بدون silent-guard — يُخفي البيانات عند كل refresh |
| 8 | **تحليل السوق** | MarketAnalysisView.tsx | ✅ **مكتمل** | dynamic imports خارج الـ render، لا polling داخلي |

### 🔧 الشاشات المطلوب تحديثها (Action Items for Team 2)

#### ① PredictionTrackingView.tsx


#### ② ReportsView.tsx


---

## 🔗 المرجع الكامل للنمط (Canonical Implementation)

المرجع الأكمل والأحدث هو شاشة MakerRadarTab.tsx. قبل تعديل أي شاشة، اقرأ الملفين التاليين:

1. src/components/predictions/MakerRadarTab.tsx — تطبيق الأركان 2، 3، 4
2. src/app/page.tsx — تطبيق الركن 1 (module-scope imports)

**الأولوية:** ابدأ بـ PredictionTrackingView.tsx ثم ReportsView.tsx.


---

## ✅ نتائج مراجعة فعلية للشاشات (Live Audit Results — 2026-09-27)

تم مراجعة جميع شاشات التطبيق برمجياً وتسجيل حالتها الفعلية:

| # | الشاشة | الملف | الحالة | الملاحظات |
|---|--------|-------|--------|-----------|
| 1 | **رادار السيولة** | `MakerRadarTab.tsx` + `page.tsx` | ✅ **مكتمل** | النموذج المرجعي — module-scope import، React.memo، stable keys |
| 2 | **الأسهم (Screener)** | `StocksView.tsx` | ✅ **مكتمل** | يستخدم `refreshLivePrices` (in-place) بدون setLoading على polling |
| 3 | **قائمة المتابعة** | `EnhancedWatchlistView.tsx` | ✅ **مكتمل** | `silent=true` pattern مطبق بالكامل مع `setRefreshing` فقط |
| 4 | **المحفظة** | `EnhancedPortfolioView.tsx` | ✅ **مكتمل** | `loadAssets(silent=true)` بدون setLoading عند الـ polling |
| 5 | **إدارة التوصيات** | `PicksManagementView.tsx` | ✅ **مكتمل** | `setRefreshing` فقط عند التحديث اليدوي، initial load منفصل |
| 6 | **تتبع التوقعات** | `PredictionTrackingView.tsx` | ⚠️ **يحتاج مراجعة** | `setLoading(true)` بدون silent-guard — يظهر skeleton عند كل refresh |
| 7 | **التقارير** | `ReportsView.tsx` | ⚠️ **يحتاج مراجعة** | `setLoading(true)` بدون silent-guard — يُخفي البيانات عند كل refresh |
| 8 | **تحليل السوق** | `MarketAnalysisView.tsx` | ✅ **مكتمل** | dynamic imports خارج الـ render، لا polling داخلي |

---

### 🔧 الشاشات المطلوب تحديثها (Action Items for Team 2)

**الأولوية:** ابدأ بـ `PredictionTrackingView.tsx` ثم `ReportsView.tsx`.

#### ① إصلاح `PredictionTrackingView.tsx`

**المشكلة:** دوال `fetchStats` و `fetchList` تستدعي `setLoadingStats(true)` و `setLoadingList(true)` بدون تمييز بين التحميل الأولي والتحديث الدوري. النتيجة: skeleton يظهر فجأة أمام المستخدم كل دقيقة.

**الإصلاح المطلوب:**

```tsx
// ❌ الحالي:
const fetchStats = async () => {
  setLoadingStats(true);
  // ...
  setLoadingStats(false);
};

// ✅ المطلوب — silent refresh بدون skeleton:
const [refreshing, setRefreshing] = useState(false);

const fetchStats = async (silent = false) => {
  if (!silent) setLoadingStats(true);
  else setRefreshing(true);
  try {
    // ...fetch...
  } finally {
    if (!silent) setLoadingStats(false);
    else setRefreshing(false);
  }
};

// عند الـ polling الدوري:
useEffect(() => {
  const id = setInterval(() => fetchStats(true), 60_000); // silent=true
  return () => clearInterval(id);
}, [market]);

// وفي واجهة المستخدم — إظهار spinner خفيف بدل skeleton:
{refreshing && (
  <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
)}
// الـ skeleton يظهر فقط إذا لم تكن هناك بيانات:
{loadingStats && !stats ? <StatsSkeleton /> : <StatsPanel data={stats} />}
```

#### ② إصلاح `ReportsView.tsx`

**المشكلة:** `setLoading(true)` في كل تحديث يُخفي الكروت والشارتات ويُظهر skeleton، مما يسبب وميضاً مزعجاً.

**الإصلاح المطلوب:**

```tsx
// ❌ الحالي:
const loadReport = async () => {
  setLoading(true); // يخفي كل شيء!
  // ...
  setLoading(false);
};

// ✅ المطلوب:
const [refreshing, setRefreshing] = useState(false);

const loadReport = async (silent = false) => {
  if (!silent) setLoading(true);
  else setRefreshing(true);
  try {
    // ...fetch...
    setData(result); // تحديث البيانات في نفس المكان
  } finally {
    if (!silent) setLoading(false);
    else setRefreshing(false);
  }
};

// الـ skeleton فقط للزيارة الأولى:
if (loading && !data) return <ReportsSkeleton />;
```

---

## 🔗 المرجع الكامل للنمط (Canonical Implementation)

قبل تعديل أي شاشة، اقرأ الملفين التاليين كمرجع:

1. `src/components/predictions/MakerRadarTab.tsx` — تطبيق الأركان 2، 3، 4
2. `src/app/page.tsx` — تطبيق الركن 1 (module-scope imports)
3. `src/components/watchlist/EnhancedWatchlistView.tsx` — نموذج مثالي للـ silent refresh pattern
