# Flutter App API Audit — مراجعة تطبيق الموبايل

> **Date:** 2026-09-30
> **Flutter repo:** https://github.com/enmohsen20111975/flutter_investment_App
> **Next.js repo:** https://github.com/enmohsen20111975/GLMinvestment

---

## ملخص

تطبيق Flutter شغّال منذ شهور مع العملاء. فيه:
- **46 شاشة** (screens)
- **175 API endpoint** مستخدم
- **127 endpoint** تم اختباره (92 شغّال، 23 محتاج auth، 4 مش موجود، 4 server error)

---

## المشكلة الحرجة: APIs جديدة ضاعت

أثناء العمل على الموجات Level 2+3، الـ subagents أنشأت **13 API endpoint جديد** للميزات الجديدة:
1. `/api/market/regime` (MarketRegimeEngine)
2. `/api/maker-radar/exit-radar` (Exit Radar)
3. `/api/maker-radar/multi-market` (Multi-Market Radar)
4. `/api/radar/accuracy` (Historical Accuracy)
5. `/api/maker-radar/timeline` (Signal Tracking Timeline)
6. `/api/radar/weekly-report` (Weekly PDF Report)
7. `/api/stocks/[ticker]/publish-data` (Stock Publisher data)
8. `/api/radar/personalized` (Personalized Radar)
9. `/api/telegram/publish-stock` (Telegram Bot publishing)
10. `/api/maker-radar/entry-timing` (Entry Timing Signal)
11. `/api/maker-radar/footprint` (Liquidity Footprint)
12. `/api/maker-radar/sector-treemap` (Sector Treemap)
13. `/api/maker-radar/signal-tracker` (Signal Tracker)

**لكن** الـ git history اتعرض ليها rebase من مبرمج تاني، والـ commits اللي فيها الـ APIs دي **ضاعت** (موجودة كـ dangling commits في الـ reflog).

---

## Flutter APIs اللي بتشتغل (92/127)

الـ Flutter app بيستخدم 175 API endpoint. منها:
- ✅ Auth (register/login/logout/me/profile)
- ✅ Stocks (list/detail/history/news/recommendation)
- ✅ Market (overview/live-data/investing/indices/summary)
- ✅ Portfolio (holdings/accounts/equity-curve/intelligence)
- ✅ Watchlist (list/add/delete)
- ✅ Crypto (list/detail/flow/explosive/recommendations)
- ✅ Predictions (honest-tracking/performance/league-report)
- ✅ AI (analyze-stock/chat)
- ✅ Radar (maker-radar/warmup/live-watch/track)
- ✅ News (latest)
- ✅ Gold/Currency (gold/currency/list/convert)
- ✅ Subscription (plans/checkout/verify/status)
- ✅ Learning (progress)
- ✅ Reports (morning)

---

## Flutter APIs اللي محتاجة إضافة (NEW features)

الميزات الجديدة اللي اتعملت في الـ Next.js بس مش موجودة في الـ Flutter:

| # | API Endpoint | الميزة | الأولوية |
|---|-------------|--------|---------|
| 1 | `/api/market/regime` | MarketRegimeEngine (DEFENSIVE/NORMAL/AGGRESSIVE) | عالية |
| 2 | `/api/maker-radar/exit-radar` | Exit Radar (5 exit paths) | عالية |
| 3 | `/api/maker-radar/multi-market` | Multi-Market Radar (7 markets) | عالية |
| 4 | `/api/radar/accuracy` | Historical Accuracy Score | متوسطة |
| 5 | `/api/maker-radar/timeline` | Signal Tracking Timeline | متوسطة |
| 6 | `/api/radar/weekly-report` | Weekly PDF Report | متوسطة |
| 7 | `/api/stocks/[ticker]/publish-data` | Stock Publisher data | منخفضة |
| 8 | `/api/radar/personalized` | Personalized Radar | منخفضة |
| 9 | `/api/telegram/publish-stock` | Telegram Bot publishing | منخفضة |
| 10 | `/api/maker-radar/entry-timing` | Entry Timing Signal (0-100) | متوسطة |
| 11 | `/api/maker-radar/footprint` | Liquidity Footprint (POC/VAH/VAL) | منخفضة |
| 12 | `/api/maker-radar/sector-treemap` | Sector Treemap | منخفضة |
| 13 | `/api/maker-radar/signal-tracker` | Signal Tracker (win rate per type) | متوسطة |

---

## خطوات الإصلاح

### 1. إعادة إنشاء الـ APIs الضائعة في Next.js
الـ 13 API endpoint موجودة كـ dangling commits. محتاجة cherry-pick أو إعادة كتابة.

### 2. إضافة الـ APIs الجديدة للـ Flutter
لكل API جديد:
- إضافة method في `lib/api/client.dart`
- إضافة screen أو widget في `lib/screens/`
- ربطه في الـ navigation

### 3. تحديث الـ Flutter app
- إضافة شاشة "حالة السوق" (Market Regime)
- إضافة شاشة "رادار الخروج" (Exit Radar)
- إضافة شاشة "الرادار الموحّد" (Multi-Market Radar)
- إضافة tab "الدقة التاريخية" في radar_hub
- إضافة tab "الخط الزمني" في radar detail
- إضافة شاشة "التقرير الأسبوعي"
- إضافة زر "نشر السهم" في stock detail
