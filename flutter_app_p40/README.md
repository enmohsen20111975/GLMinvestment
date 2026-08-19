# Flutter App P40 Updates — أكاديمية M2y + محاكي التداول + استبيان المخاطر

> **ملاحظة مهمة:** الـ token المتاح في الـ sandbox لديه صلاحية فقط على مستودع
> `GLMinvestment` ولا يملك صلاحية على مستودع `flutter_investment_App`. لذلك تم
> رفع ملفات تطبيق الأندرويد هنا في مجلد `flutter_app_p40/` كمرجع. يُرجى نسخ هذه
> الملفات يدوياً إلى مستودع الـ Flutter: https://github.com/enmohsen20111975/flutter_investment_App
> 
> **Note:** The sandbox token only has access to the `GLMinvestment` repo, not the
> Flutter repo. The Flutter app update files are included here for reference.
> Please copy them manually to the Flutter repo.

## الملفات المُحدّثة (8 ملفات)

### ملفات معدّلة (2):
1. `lib/api/client.dart` — إضافة 8 methods جديدة (6 paper trading + 2 persona) + إصلاح `getUnifiedPersonas()`.
2. `lib/app.dart` — إضافة imports + 2 drawer items (Academy + Risk Profiler).

### ملفات جديدة (6):
1. `lib/screens/academy_screen.dart` — الشاشة الرئيسية للأكاديمية (4 تبويبات).
2. `lib/screens/paper_trading_screen.dart` — محطة التداول الورقي الحي (Pillar 1).
3. `lib/screens/candle_simulator_screen.dart` — محاكي الشموع التفاعلي (Pillar 2).
4. `lib/screens/strategy_sandbox_screen.dart` — مختبر الاستراتيجيات (Pillar 3).
5. `lib/screens/academy_encyclopedia_screen.dart` — الموسوعة التعليمية (Pillar 4).
6. `lib/screens/risk_profiler_screen.dart` — استبيان تحمّل المخاطر (P39).

## طريقة التثبيت

```bash
# في مستودع الـ Flutter
cd flutter_investment_App

# نسخ الملفات من مستودع المنصة
cp /path/to/GLMinvestment/flutter_app_p40/lib/api/client.dart lib/api/client.dart
cp /path/to/GLMinvestment/flutter_app_p40/lib/app.dart lib/app.dart
cp /path/to/GLMinvestment/flutter_app_p40/lib/screens/academy_screen.dart lib/screens/
cp /path/to/GLMinvestment/flutter_app_p40/lib/screens/paper_trading_screen.dart lib/screens/
cp /path/to/GLMinvestment/flutter_app_p40/lib/screens/candle_simulator_screen.dart lib/screens/
cp /path/to/GLMinvestment/flutter_app_p40/lib/screens/strategy_sandbox_screen.dart lib/screens/
cp /path/to/GLMinvestment/flutter_app_p40/lib/screens/academy_encyclopedia_screen.dart lib/screens/
cp /path/to/GLMinvestment/flutter_app_p40/lib/screens/risk_profiler_screen.dart lib/screens/

# commit + push
git add .
git commit -m "feat(p40): Academy + Paper Trading + Persona Risk Profiler"
git push origin main
```

## المتطلبات

- يتطلب منصة M2y الإصدار 3.25.0+ (P40 Academy backend endpoints).
- يعمل مع الإصدارات الأقدم (fallback آمن لو الـ endpoints غير متاحة).

## التفاصيل الكاملة

راجع `CHANGELOG.md` في هذا المجلد للتفاصيل الكاملة لكل تغيير.
