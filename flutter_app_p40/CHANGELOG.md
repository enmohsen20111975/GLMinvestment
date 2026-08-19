# Changelog — Flutter Investment App

## [2.9.0] — P40 Academy + Persona Risk Profiler (August 2026)

### المقدمة
تحديث تطبيق الأندرويد لمواكبة منصة M2y — إضافة أكاديمية تعليمية كاملة + محاكي تداول
ورقي حي بالأسعار الحقيقية + استبيان تحمّل المخاطر الديناميكي + إصلاح أخطاء الـ API.

### Added — 6 شاشات جديدة

1. **`academy_screen.dart`** — الشاشة الرئيسية للأكاديمية بـ 4 تبويبات:
   - 📚 الموسوعة التعليمية
   - 💻 التداول الورقي الحي
   - 🕯️ محاكي الشموع اليابانية
   - 📊 مختبر الاستراتيجيات الفنية

2. **`paper_trading_screen.dart`** (Pillar 1) — محطة التداول الورقي الحي:
   - حساب وهمي بـ 100,000 ج.م (auto-create).
   - تنفيذ أوامار BUY/SELL مع stop_loss + take_profit.
   - جدول المراكز المفتوحة مع unrealized P&L + auto SL/TP trigger.
   - سجل الصفقات المغلقة + تصفير الحساب.
   - Polling كل 10 ثوانٍ للأسعار الحية.

3. **`candle_simulator_screen.dart`** (Pillar 2) — محاكي الشموع التفاعلي:
   - 4 sliders للتحكم في OHLC (0..100).
   - رسم شمعة SVG مباشر (CustomPaint).
   - كشف آلي عن 9 أنماط (Doji, Hammer, Engulfing, Marubozu, etc).
   - شرح سيكولوجي + احتمالية صعود/هبوط لكل نمط.

4. **`strategy_sandbox_screen.dart`** (Pillar 3) — مختبر الاستراتيجيات:
   - 13 استراتيجية عبر 3 فئات (SMC/ICT, TA, Fundamental).
   - شارت SVG توضيحي لكل استراتيجية.
   - شرح عربي + نقاط أساسية + كيفية التداول + أمثلة EGX حقيقية.

5. **`academy_encyclopedia_screen.dart`** (Pillar 4) — الموسوعة التعليمية:
   - 12 درس عربي كامل عبر 6 فئات.
   - اختبارات تفاعلية (3 أسئلة لكل درس).
   - شارات إنجاز + تتبع التقدم (SharedPreferences).
   - التنقل بين الدروس.

6. **`risk_profiler_screen.dart`** (P39) — استبيان تحمّل المخاطر:
   - 10 أسئلة تحسب Risk Score (1..100).
   - استنتاج الشخصية (conservative/balanced/gambler).
   - حفظ النتيجة في SharedPreferences.

### Added — API Methods (lib/api/client.dart)

6 methods جديدة للـ paper trading:
- `getPaperTradingAccount()` — GET /api/paper-trading-v2/account
- `placePaperOrder(...)` — POST /api/paper-trading-v2/order
- `getPaperPositions()` — GET /api/paper-trading-v2/positions
- `closePaperOrder(...)` — POST /api/paper-trading-v2/orders/[id]/close
- `getPaperOrders(status)` — GET /api/paper-trading-v2/orders
- `resetPaperAccount()` — POST /api/paper-trading-v2/reset

Plus 2 persona helpers:
- `scoreToPersona(score)` — يحول 1..100 إلى persona id.
- `getPersonaVector(persona)` — يُعيد معاملات الشخصية (stop_factor, target_factor, max_risk_percent, asset_ceilings).

### Fixed — API Issues

- **`getUnifiedPersonas()`**: كان يُرجع static placeholders (`investor` / `gambler`) بسبب 404
  على `/api/v2/unified/personas`. تم إصلاحه لإرجاع الـ 3 personas الحقيقية من المنصة
  (`conservative` / `balanced` / `gambler`) مع كل المعاملات (stop_factor, target_factor,
  max_risk_percent, crypto_allowed, color).

### Navigation Wiring (lib/app.dart)

- Added imports: `academy_screen.dart` + `risk_profiler_screen.dart`.
- Added 2 drawer items:
  - "أكاديمية M2y التعليمية" (Icons.school_outlined) → AcademyScreen.
  - "استبيان تحمّل المخاطر" (Icons.psychology_outlined) → RiskProfilerScreen.

### Compatibility

- يتطلب منصة M2y الإصدار 3.25.0+ (P40 Academy backend endpoints).
- يعمل مع الإصدارات الأقدم (fallback آمن لو الـ endpoints غير متاحة — يُرجع قيم فارغة).

### Files Summary

| File | Status | Lines |
|---|---|---|
| `lib/api/client.dart` | MODIFIED | +210 (paper trading + persona methods + personas fix) |
| `lib/screens/academy_screen.dart` | NEW | +82 |
| `lib/screens/paper_trading_screen.dart` | NEW | +380 |
| `lib/screens/candle_simulator_screen.dart` | NEW | +310 |
| `lib/screens/strategy_sandbox_screen.dart` | NEW | +400 |
| `lib/screens/academy_encyclopedia_screen.dart` | NEW | +560 |
| `lib/screens/risk_profiler_screen.dart` | NEW | +220 |
| `lib/app.dart` | MODIFIED | +6 (imports + drawer items) |
| **Total** | | **~2,168 lines** |
