# 🚀 الملف الخامس: مرجع الـ APIs ودليل العمليات والنشر (API REFERENCE & DEVOPS PLAYBOOK)
**منصة دليل الاستثمار والتحليل الكمي — GLMinvestment**  
**المشرف العام وصاحب المنصة:** الأستاذ محسن  
**المدير العام والمسؤول التنفيذي:** Chief Market Analyst & Systems Architect  
**تاريخ التوثيق والاعتماد:** 12 أكتوبر 2026

---

## 📡 1. مرجع واجهات برمجة التطبيقات الأساسية (Core API Endpoints)

تعمل واجهات الـ API في Next.js كوكيل مرور خفيف (Thin Proxy) يتصل مباشرة بمحرك بايثون (`http://localhost:8010`) لخدمة الواجهات وتطبيق الموبايل:

### أ. مسارات رادار صانع السوق ووايكوف (Maker Radar & Wyckoff Routes):
| المسار (Endpoint) | الطريقة (Method) | الوصف والمعاملات | مصدر البيانات |
| :--- | :--- | :--- | :--- |
| `/api/maker-radar/wyckoff-screener` | `GET` | ماسح مراحل وايكوف لجميع الأسهم النشطة مع توزيع المراحل ومعدلات الثقة ونقاط القوة والضعف. المعاملات: `phase` (C_SPRING / D_SOS / ALL)، `market` (EGX)، `limit`. | Python Blueprint (`:8010`) عبر `stock_daily_prices` |
| `/api/maker-radar/stock?ticker=SYMBOL` | `GET` | تفاصيل السهم في الرادار: مؤشر MFI 14، دورة الصانع، الحجم النسبي، القطاع المعرب، والدعم والمقاومة. | `stocks.db` + حسابات Python |
| `/api/maker-radar/institutional-backtest` | `GET` | تقرير الباك-تست المؤسسي المعتمد: Sharpe, Sortino, Profit Factor, Max Drawdown, Win Rate. | `db/reports/institutional_backtest_summary.json` |
| `/api/maker-radar/signals` | `GET` | جلب الإشارات الحية النشطة وتاريخ الصفقات المفتوحة. | `predictions.db` |

### ب. مسارات الأسهم والسيولة اللحظية (Stock & Intraday Flow Routes):
| المسار (Endpoint) | الطريقة (Method) | الوصف والمعاملات | مصدر البيانات |
| :--- | :--- | :--- | :--- |
| `/api/stocks/[ticker]/intraday-flow` | `GET` | تدفق شمعات 5 دقائق اللحظية، خط الـ CVD، نقطة السيطرة POC، وحجم صفقات الحيتان (>100K). | `db/intraday.db` |
| `/api/stocks/[ticker]/history` | `GET` | السجل التاريخي اليومي لشموع السهم (OHLCV). | `db/stocks.db` |
| `/api/stocks/[ticker]/publish-data` | `GET` | تجهيز كامل بيانات السهم لصالح استوديو النشر وبطاقات السوشيال ميديا. | مجمّع من القواعد والتحليل |
| `/api/stocks/[ticker]/recommendation` | `GET` | التوصية الفنية المباشرة مع فحص الـ R:R وصمامات الأمان. | محرك التقييم الفني |

### ج. مسارات الاشتراكات والبوابات (Subscription & Payments):
* `/api/subscription/status`: فحص صلاحية وخطة اشتراك المستخدم الحالي.
* `/api/subscription/plans`: جلب الباقات المتاحة (شهرية / سنوية).
* `/api/subscription/instapay/submit`: رفع إيصال الدفع عبر إنستاباي للتحقق والتفعيل.

---

## 🛠️ 2. دليل الصيانة والتشغيل اليومي (DevOps Runbook)

### أ. إدارة خدمات الخادم عبر PM2:
```bash
# فحص حالة جميع الخدمات
pm2 status

# إعادة تشغيل محرك بايثون التحليلي
pm2 restart python-backend

# إعادة تشغيل واجهة Next.js بعد التحديثات
pm2 restart nextjs

# متابعة السجلات المباشرة للأخطاء
pm2 logs python-backend --lines 50
pm2 logs nextjs --lines 50
```

### ب. بناء وتحديث واجهة الإنتاج (Production Build):
```bash
# سحب آخر التحديثات مع الحفاظ على التوافق
git pull --rebase origin main

# بناء النسخة المحسنة للإنتاج
npm run build

# إعادة تحميل الخادم دون توقف
pm2 reload nextjs
```

### ج. المهام المجدولة الدورية (Scheduled Cron Jobs):
* **تغذية وحفظ الجلسات اللحظية:** `vps-service/jobs/intraday_session_preserver.py` (يحتفظ بآخر 3 جلسات تداول لـ EGX30 لمنع فراغ الشاشات في العطلات).
* **إغلاق وتقييم الصفقات اليومي:** `vps-service/jobs/daily_closer.py` (يعمل عند إغلاق السوق الساعة 15:00 لتسجيل نتائج الصفقات وتحديث نسب النجاح).
* **مزامنة القطاعات الرسمية:** `scripts/align_stock_sectors_ar.py` (يحدث تصنيفات البورصة الرسمية للأسهم في `stocks.db`).

---

## 🚨 3. بروتوكول الطوارئ والإنعاش السريع (Emergency Recovery Protocol)

1. **انقطاع محرك بايثون (`503 python_backend_unreachable`):**
   - تحقق من السجل: `pm2 logs python-backend --err`.
   - التأكد من تثبيت الحزم المطلوبة وإعادة تشغيله: `pm2 restart python-backend`.
2. **امتلاء الذاكرة أو بطء الاستجابة:**
   - فحص استهلاك الذاكرة: `free -m`.
   - إعادة تشغيل العمليات المتعثرة: `pm2 restart all`.
3. **التراجع عن الالتزامات البرمجية عند حدوث خلل (Git Rollback):**
   - العودة لآخر Commit مستقر: `git reset --hard HEAD~1` متبوعاً بـ `npm run build && pm2 reload nextjs`.
