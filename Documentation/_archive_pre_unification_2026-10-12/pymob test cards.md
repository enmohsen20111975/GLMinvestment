محتاج منك إعداد واختبار وسائل الدفع **Online Card** و **Mobile Wallet** باستخدام بيانات الاختبار التالية.

### 1. اختبار Mastercard

اختبر بطاقتين Mastercard، وكل بطاقة لازم تتجرب كعملية دفع مستقلة:

**Mastercard – Card 1**
- Card Number: `5123456789012346`
- Cardholder Name: `Test Account`
- Expiry Month: `01`
- Expiry Year: `39`
- CVV: `123`

**Mastercard – Card 2**
- Card Number: `5123450000000008`
- Cardholder Name: `Test Account`
- Expiry Month: `01`
- Expiry Year: `39`
- CVV: `123`

### 2. اختبار Visa

استخدم بطاقة Visa التالية:

- Card Number: `4111111111111111`
- Cardholder Name: `Test Account`
- Expiry Month: `01`
- Expiry Year: `39`
- CVV: `123`

### 3. اختبار Mobile Wallet

استخدم بيانات المحفظة التالية:

- Wallet Number: `01010101010`
- MPin Code: `123456`
- OTP: `123456`

### المطلوب من الاختبار

اختبر دورة الدفع كاملة لكل وسيلة:

1. اختيار المنتج/الباقة.
2. الانتقال إلى صفحة الدفع.
3. اختيار طريقة الدفع.
4. إدخال بيانات الاختبار المناسبة.
5. تنفيذ عملية الدفع.
6. التأكد من رجوع الـ callback/webhook بشكل صحيح.
7. التأكد من إنشاء وتحديث حالة الـ transaction في قاعدة البيانات.
8. التأكد من تحديث حالة الطلب/الاشتراك بعد نجاح الدفع.
9. التأكد من عدم تسجيل بيانات البطاقات أو الـ CVV أو الـ MPIN أو الـ OTP في الـ logs.
10. التأكد من التعامل الصحيح مع حالات:
   - Payment Success
   - Payment Failed
   - Payment Pending
   - Callback/Webhook مكرر
   - المستخدم يرجع للصفحة قبل اكتمال الدفع
   - إعادة تحميل صفحة نتيجة الدفع
   - Transaction موجودة بالفعل ولا يجب إنشاء عملية مكررة.

### مهم جداً

- البيانات السابقة **Test Credentials فقط**، وممنوع استخدامها في Production.
- تأكد أن إعدادات الـ Payment Gateway مضبوطة على **Sandbox/Test Environment** أثناء الاختبار.
- لا تضع بيانات البطاقات أو الـ CVV أو بيانات المحفظة بشكل hard-coded داخل الكود.
- استخدم Environment Variables أو إعدادات الـ Test Environment.
- بعد انتهاء الاختبار، تأكد أن Production يستخدم Credentials مختلفة تماماً.
- المطلوب في النهاية تقرير مختصر يوضح نتيجة اختبار كل وسيلة دفع:

| طريقة الدفع | الاختبار | النتيجة | Transaction ID | ملاحظات |
|---|---|---|---|---|
| Mastercard | Card 1 | | | |
| Mastercard | Card 2 | | | |
| Visa | Card 1 | | | |
| Mobile Wallet | Wallet | | | |

لو أي اختبار فشل، حدد **مكان الفشل بالضبط**: Frontend / Payment Gateway / Callback / Webhook / Backend / Database، مع رسالة الخطأ والـ transaction state، بدون كشف أي بيانات حساسة.