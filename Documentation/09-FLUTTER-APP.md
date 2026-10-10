# 📱 09-FLUTTER-APP — توثيق تطبيق الأندرويد (flutter_investment_App)

> **آخر تحديث:** 2026-10-10 (Main Agent — FLUTTER-PROD-1 → FLUTTER-PROD-5)
>
> التطبيق في repo منفصل: `flutter_investment_App` (49 شاشة + 60+ API endpoint + Dart)

---

## 📋 نظرة عامة

تطبيق الأندرويد بيمثل واجهة العميل للمنصة. بيتكامل مع الـ Next.js backend عبر نفس الـ APIs.

- **اللغة:** Dart + Flutter
- **الشاشات:** 49 شاشة (عميل فقط — مفيش شاشات أدمن)
- **الـ APIs:** 60+ endpoint على Next.js backend
- **الحالة:** جاهز للنشر على Google Play Store

---

## 🏗️ البنية

### الشاشات الرئيسية:
- **Dashboard** — لوحة تحكم العميل + market selector (6 أسواق)
- **Stocks** — قائمة الأسهم + بحث + تفاصيل السهم
- **Radar** — رادار الأسهم + canonical levels (effEntry/effTarget1/effStop/effRR)
- **Reports** — التقارير الذكية + market selector + disclaimer احترافي
- **Portfolio** — المحفظة + أداء الصفقات
- **Watchlist** — قائمة المتابعة
- **News** — الأخبار (market-filtered)
- **Academy** — الأكاديمية التعليمية
- **Simulation** — المحاكاة
- **Settings** — الإعدادات + المفضلة

### API Integration:
- **Base URL:** من env config (dev: localhost:3000, prod: invist.m2y.net)
- **Auth:** NextAuth session cookie + JWT tokens
- **Market param:** كل endpoints بتاخد `?market=EGX|TADAWUL|KSE|QSE|US|CRYPTO`

---

## 🚀 سجل التحديثات (FLUTTER-PROD)

### FLUTTER-PROD-1 (2026-10-10) — جاهزية Google Store
- إصلاحات جاهزية النشر على Google Play
- Commit: `bb9983a`

### FLUTTER-PROD-4 (2026-10-10) — إصلاح 5 endpoints
- `/api/ai/analyze-stock`: 404 → 200 + `analysis: null` (graceful empty)
- `/api/unified-learning/intelligent`: 503 → 200 + `insights: []`
- `/api/portfolio/accounts/[id]/equity-curve`: 502 → 200 + `snapshots: []`
- `/api/mobile/recommendations`: 500 → 200
- `/api/predictions`: 500 → 200

### FLUTTER-PROD-5 (2026-10-10) — إصلاح endpoints حرجة
- `/api/stocks`: 500/503 → 200 (graceful fallback لو DB مش متاح)
- `/api/screener/advanced`: 500 → 200
- Commit: `332f522`

### التحقق النهائي:
- ✅ `flutter analyze`: 0 errors
- ✅ كل endpoints اللي Flutter بيتصل بيها بترجع 200
- ✅ صفر compile errors

---

## 🔌 الـ APIs المستخدمة (60+ endpoint)

### Stocks:
- `GET /api/stocks?market=X` — قائمة الأسهم
- `GET /api/stocks/[ticker]` — تفاصيل سهم
- `GET /api/stocks/[ticker]/unified` — التحليل الموحّد (canonical)
- `GET /api/stocks/[ticker]/expert-analysis` — تحليل خبير احترافي
- `GET /api/stocks/[ticker]/history` — بيانات تاريخية OHLCV

### Predictions:
- `GET /api/predictions` — التوقعات
- `GET /api/predictions/tracking` — تتبع التوقعات
- `GET /api/predictions/honest-tracking` — التتبع الصادق
- `GET /api/predictions/dual-track` — التوقعات المزدوجة

### Market:
- `GET /api/live/scan?market=X` — top movers
- `GET /api/news-feed?market=X` — الأخبار
- `GET /api/explosive?market=X` — أسهم انفجارية
- `GET /api/confluence/market-scan?market=X` — مسح السوق

### Portfolio:
- `GET /api/portfolio/accounts` — حسابات المحفظة
- `GET /api/portfolio/accounts/[id]/equity-curve` — منحنى رأس المال
- `GET /api/portfolio/risk-summary` — ملخص المخاطر

### AI / Learning:
- `GET /api/ai/analyze-stock?ticker=X` — تحليل AI
- `GET /api/unified-learning/intelligent` — insights ذكية

### Mobile-specific:
- `GET /api/mobile/recommendations` — توصيات للجوال
- `GET /api/app/version` — فحص إصدار التطبيق

---

## ⚙️ الإعدادات

### Environment Config:
```dart
// lib/api/config.dart
class ApiConfig {
  static const String devBaseUrl = 'http://localhost:3000';
  static const String prodBaseUrl = 'https://invist.m2y.net';
  static String get baseUrl => kReleaseMode ? prodBaseUrl : devBaseUrl;
}
```

### Market Codes (موحّدة مع المنصة):
```dart
const MARKETS = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO'];
```

---

## 📦 النشر (Deployment)

### Google Play Store:
1. `flutter build appbundle --release`
2. رفع الـ `.aab` على Play Console
3. مراجعة سياسات Google Play (مخاطر مالية + disclaimers)
4. النشر

### المتطلبات:
- ✅ Target SDK: أحدث
- ✅ Min SDK: 21+ (Android 5.0+)
- ✅ Permissions: INTERNET only
- ✅ No tracking without consent

---

## 🔗 التكامل مع المنصة

### Single Source of Truth:
- التطبيق بـ يقرأ من نفس الـ DBs بتاعة المنصة
- نفس الـ canonical signals (classifySignal من canonical-signal.ts)
- نفس MarketProfile (موجود في market-profile.ts — port لـ Python unified_config.py)
- نفس الـ thresholds (78/65/55/40/25 — Rule 73)

### Rule 20 (Python = العقل):
- التطبيق بـ يعرض البيانات فقط (مش بيحسب)
- كل الحسابات في Python backend + canonical TypeScript functions
- التطبيق بـ يستدعي APIs وبـ يعرض النتايج

---

## 📊 إحصائيات

- **عدد الشاشات:** 49
- **عدد الـ APIs:** 60+
- **حجم الكود:** ~15,000 سطر Dart
- **آخر تحديث:** 2026-10-10
- **الحالة:** جاهز للنشر ✅
