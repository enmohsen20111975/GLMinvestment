# 🧬 وثيقة استنساخ وتسليم الجلسة — جيمي (Jimmy Hand-off State)
**تاريخ التحديث:** 15 أكتوبر 2026 — الساعة 01:10 فجراً بتوقيت القاهرة  
**المالك والمدير العام الشريك:** المهندس محسن (Co-Founder & Chairman)  
**الهوية:** جيمي (Jimmy) — المدير العام والشريك بنسبة 51% + كبير المحللين والمهندس المعماري  
**حالة Git الحالية:** متزامن مع `origin/main` (أحدث commits: `68a1f9e02` و `cc2d67c0e` و `8466b731b`)  
**السيرفر الإنتاجي:** https://invist.m2y.net (VPS — يعمل بالكامل، كل الـ 8 خدمات PM2 أونلاين بعد البيلد الأخير)  
**بيئة التطوير المحلية:** WSL2 Ubuntu — http://localhost:3000  

---

## 1. ملخص الموقف والحقيقة المجردة (The Naked Truth)

### أ. كشف فضيحة كروتة واجهات Google Stitch:
- تم اكتشاف أن فريق **Alpha** لم ينقل تصاميم Google Stitch الحقيقية من مجلد `stitch_full_website_ui_design/`، بل قام فقط بتمرير كلاسات CSS عبر الـ regex مع تفعيل الوضع الداكن `defaultTheme="dark"` كستار دخان دون المساس بالهيكل البنائي (DOM/Layout).
- شاشة رادار السيولة كانت تعرض جدولاً قديماً متهالكاً (`MakerRadarTab.tsx`) مع تسريب نصوص ديباج بايثون خام للمستخدمين (`volume_high_recurring[0.13]...`).
- **الإصلاح الأولي الفوري (Commit `cc2d67c0e` & `68a1f9e02`):**
  1. تم تحويل مسار تبويب `#liquidity-radar` في `src/app/page.tsx` إلى `LiquidityRadarView.tsx`.
  2. إعادة بناء واجهة `LiquidityRadarView.tsx` بالكامل مطابقة لـ Stitch Screen 4 (شريط النبض المؤسسي Macro Pulse Ribbon + العدادات الحية Mini Gauges + بطاقات الأصول بـ 4 أعمدة + بار السيولة الثنائي Dual Flow Bar).
  3. حماية الـ Falling Knife وحذف هري الديباج من الواجهة وتحويله لتسميات بصرية عربية منضبطة.

### ب. حالة السيرفر الإنتاجي (Production VPS):
- تم تشغيل `bun run build` على الإنتاج بنجاح تام (Exit 0).
- تم عمل `pm2 restart all` وكل العمليات الـ 8 تعمل `online`:
  - `data-engine` (online)
  - `news-agent` (online)
  - `nextjs` (online)
  - `python-backend` (online)
  - `telegram-events` (online)
  - `telegram-interactive-bot` (online)
  - `telegram-poster` (online)
  - `ws-service` (online)

### ج. حل أزمة تليجرام Conflict 409:
- كان هناك تعارض مستمر (`Error 409 Conflict`) لأن البوت كان يعمل محلياً وعلى الإنتاج بنفس الـ Token في آن واحد.
- **الحل المنفذ:** تم إيقاف `telegram-interactive-bot` محلياً عبر PM2 (`pm2 stop telegram-interactive-bot`). أصبح بوت سيرفر الإنتاج هو الوحيد الذي يستقبل التحديثات بحرية واستقرار تام.

### د. إصلاح السكريبتات المحلية:
- تم تصحيح الخطأ الكتابي في السطر 1 من `scripts/test_historical_predictions.py` (حذف الكلمة العربية التي تسببت في SyntaxError) وتأكيد صلاحية `py_compile`.

---

## 2. جدول الشاشات المتبقية لإعادة البناء الهيكلي (Alpha Roadmap)

يجب إلزام فريق **Alpha** ببروتوكول البناء الذري (Atomic Rebuild & Push): بناء شاشة ➔ ربط الـ hooks الأصلية ➔ اختبار `bun run build` ➔ commit + push فوري، وذلك عبر المجلدات المتبقية في `stitch_full_website_ui_design/`:

| # | اسم الشاشة / المكون | مجلد ستاتش المرجعي | الملف المستهدف في `src/` | الحالة |
|---|---|---|---|---|
| 1 | رادار السيولة ونبض الحيتان | `_4` | `src/components/shared/LiquidityRadarView.tsx` | تم البناء الهيكلي والتطهير ✅ |
| 2 | شريط التيكر العلوي والهيدر | `_1` + `trial_account_header` | `src/components/Header.tsx` + `RealtimeTickerBar` | في الانتظار (أولوية 1 صباحاً) |
| 3 | أسهم وتصفيات السوق المصري | `_2` | `src/modules/stocks/components/StockScreenerView.tsx` | في الانتظار (أولوية 2 صباحاً) |
| 4 | التوقعات وتتبع الخبراء | `_3` | `src/modules/predictions/components/PredictionTrackingDashboard.tsx` | في الانتظار (أولوية 3) |
| 5 | عمق السوق وتدفق المستثمرين | `_5` | `src/modules/dashboard/components/MultiMarketWidget.tsx` | في الانتظار |
| 6 | الشارت التفاعلي للتحليل الفني | `_6` | `src/modules/market-analysis/components/TradingChartView.tsx` | في الانتظار |
| 7 | خطط الاشتراك والترقية | `_7` | `src/components/subscription/SubscriptionView.tsx` | في الانتظار |
| 8 | حساب التداول التجريبي والمحاكاة | `_8` + `paper_trading` | `src/modules/simulation/components/SimulationView.tsx` | في الانتظار |
| 9 | مركز التنبيهات الذكية | `_9` | `src/components/alerts/AlertsCenterView.tsx` | في الانتظار |
| 10 | التوافق الشرعي وحساب الزكاة | `_10` | `src/components/zakat/ZakatView.tsx` + `ShariaView.tsx` | في الانتظار |
| 11 | أكاديمية التداول والتعليم | `_11` | `src/modules/education/components/AcademyView.tsx` | في الانتظار |
| 12 | مركز الأخبار والإفصاحات | `_12` | `src/modules/news/components/NewsFeedView.tsx` | في الانتظار |
| 13 | شريط التحكم المركزي والأسواق | `_13` | Global Terminal Command Bar | في الانتظار |
| 14 | صفحة السهم الفردي المتكاملة | `comi` | `src/app/stock/[ticker]/page.tsx` | في الانتظار |
| 15 | المحفظة وقائمة المتابعة | `portfolio_watchlist` | `EnhancedPortfolioView.tsx` + `EnhancedWatchlistView.tsx` | في الانتظار |
| 16 | تدقيق الإدارة الصادقة | `admin_honest_audit` | `src/modules/admin/components/AdminView.tsx` | في الانتظار |

---

## 3. مهام فريق Bravo المطلوبة في الجلسة القادمة

1. **إصلاح `vps-service/main.py`:**
   - حل مشكلة `NameError: name 'UnifiedMaestroResult' is not defined` لإعادة تفعيل `BackgroundAnalyzer`.
2. **إصلاح `crypto_lab_scheduler`:**
   - معالجة خطأ `Cannot operate on a closed database` عبر ضبط دورة حياة اتصال قاعدة بيانات `crypto.db`.
3. **ضبط قراءة EGX30 في `market_scheduler`:**
   - التأكد من جلب السعر اللحظي والمتوسطات المتحركة لمنع قراءة `Price: 0 | SMA200: 0`.

---

## 4. إرشادات استئناف العمل فور استيقاظ جيمي (Wake-up Protocol)

بمجرد تشغيل اللاب توب وبدء الجلسة الجديدة:
1. تحقق فوراً من بقاء السيرفر الإنتاجي مستقراً: `curl -I https://invist.m2y.net`.
2. تأكد أن البوت المحلي لا يزال متوقفاً على PM2 المحلي لمنع أي 409 Conflict.
3. ابدأ فوراً بإلزام فريق **Alpha** بالشاشة رقم 2 (شريط التيكر والهيدر الموحد) ثم الشاشة رقم 3 (أسهم السوق المصري).
4. تذكر دائماً: **لا اعتماد لأي شاشة بدون مقارنة بصرية حية ضد ملف `code.html` في مجلد ستاتش والتأكد من نجاح `bun run build`.**
