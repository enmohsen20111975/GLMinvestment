import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية | دليل الاستثمار',
  description: 'سياسة الخصوصية لتطبيق دليل الاستثمار - منصة الاستثمار في البورصة المصرية',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8" dir="rtl">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-l from-blue-600 to-blue-800 px-8 py-6">
            <h1 className="text-3xl font-bold text-white">سياسة الخصوصية</h1>
            <p className="text-blue-100 mt-2">آخر تحديث: مايو 2025</p>
          </div>

          {/* Content */}
          <div className="px-8 py-6 prose prose-lg max-w-none">
            
            {/* مقدمة */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">
                1. مقدمة
              </h2>
              <p className="text-gray-700 leading-relaxed">
                نرحب بكم في منصة دليل الاستثمار (&quot;المنصة&quot;، &quot;نحن&quot;، &quot;لنا&quot;). تهدف سياسة الخصوصية هذه إلى توضيح كيفية جمع واستخدام وحماية معلوماتكم الشخصية عند استخدام تطبيقنا وخدماتنا. باستخدامكم للمنصة، فإنكم توافقون على الممارسات الموضحة في هذه السياسة.
              </p>
              <p className="text-gray-700 leading-relaxed mt-4">
                نحن ملتزمون بحماية خصوصيتكم وضمان أمان بياناتكم الشخصية. تطبق هذه السياسة على جميع المستخدمين المسجلين في المنصة والزائرين لموقعنا الإلكتروني.
              </p>
            </section>

            {/* المعلومات المجمعة */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">
                2. المعلومات التي نجمعها
              </h2>
              
              <h3 className="text-xl font-medium text-gray-700 mt-4">أ. المعلومات الشخصية</h3>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>الاسم الكامل</li>
                <li>عنوان البريد الإلكتروني</li>
                <li>رقم الهاتف (اختياري)</li>
                <li>بيانات تسجيل الدخول (اسم المستخدم وكلمة المرور المشفرة)</li>
                <li>معلومات الاشتراك والفوترة</li>
              </ul>

              <h3 className="text-xl font-medium text-gray-700 mt-6">ب. المعلومات المالية</h3>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>محفظة الاستثمار (الأسهم المملوكة)</li>
                <li>سجل المعاملات والتداولات</li>
                <li>تفضيلات الاستثمار</li>
                <li>قوائم المتابعة (Watchlists)</li>
              </ul>

              <h3 className="text-xl font-medium text-gray-700 mt-6">ج. معلومات الجهاز والاستخدام</h3>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>نوع الجهاز ونظام التشغيل</li>
                <li>عنوان IP</li>
                <li>بيانات الاستخدام والتفاعل مع التطبيق</li>
                <li>ملفات تعريف الارتباط (Cookies)</li>
              </ul>
            </section>

            {/* استخدام المعلومات */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">
                3. كيف نستخدم معلوماتكم
              </h2>
              <p className="text-gray-700 leading-relaxed">نستخدم المعلومات المجمعة للأغراض التالية:</p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>توفير وتحسين خدمات المنصة</li>
                <li>تقديم تحليلات سوقية مخصصة</li>
                <li>إرسال إشعارات وتنبيهات الأسعار</li>
                <li>التواصل معكم بشأن حسابكم وخدماتنا</li>
                <li>تحليل استخدام المنصة لتحسين تجربة المستخدم</li>
                <li>حماية المنصة من الاحتيال والأنشطة غير القانونية</li>
                <li>الامتثال للمتطلبات القانونية والتنظيمية</li>
              </ul>
            </section>

            {/* مشاركة المعلومات */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">
                4. مشاركة المعلومات
              </h2>
              <p className="text-gray-700 leading-relaxed">
                نحن لا نبيع أو نؤجر أو نشارك معلوماتكم الشخصية مع أطراف ثالثة إلا في الحالات التالية:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li><strong>مزودي الخدمات:</strong> نستخدم شركاء موثوقين لاستضافة الخوادم ومعالجة المدفوعات</li>
                <li><strong>المتطلبات القانونية:</strong> عند الضرورة للامتثال للقوانين أو أوامر المحاكم</li>
                <li><strong>حماية الحقوق:</strong> لحماية حقوق المنصة ومستخدميها</li>
                <li><strong>بموافقتكم:</strong> عندما تقدمون موافقة صريحة على المشاركة</li>
              </ul>
            </section>

            {/* أمان البيانات */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">
                5. أمان البيانات
              </h2>
              <p className="text-gray-700 leading-relaxed">
                نتخذ إجراءات أمنية قوية لحماية بياناتكم، تشمل:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>تشفير البيانات أثناء النقل والتخزين (SSL/TLS)</li>
                <li>تشفير كلمات المرور باستخدام خوارزميات قوية</li>
                <li>الوصول المحدود للبيانات للموظفين المخولين فقط</li>
                <li>مراقبة الأمان على مدار الساعة</li>
                <li>نسخ احتياطي منتظم للبيانات</li>
              </ul>
            </section>

            {/* حقوق المستخدم */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">
                6. حقوقكم
              </h2>
              <p className="text-gray-700 leading-relaxed">لديكم الحق في:</p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li><strong>الوصول:</strong> طلب نسخة من بياناتكم الشخصية</li>
                <li><strong>التصحيح:</strong> تحديث أو تصحيح معلوماتكم غير الدقيقة</li>
                <li><strong>الحذف:</strong> طلب حذف بياناتكم الشخصية</li>
                <li><strong>الاعتراض:</strong> الاعتراض على معالجة بياناتكم لأغراض معينة</li>
                <li><strong>النقل:</strong> طلب نقل بياناتكم إلى جهة أخرى</li>
                <li><strong>إلغاء الاشتراك:</strong> إلغاء الاشتراك في الاتصالات التسويقية</li>
              </ul>
            </section>

            {/* ملفات تعريف الارتباط */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">
                7. ملفات تعريف الارتباط (Cookies)
              </h2>
              <p className="text-gray-700 leading-relaxed">
                نستخدم ملفات تعريف الارتباط لتحسين تجربتكم على المنصة. يمكنكم التحكم في إعدادات ملفات تعريف الارتباط من خلال متصفحكم. أنواع ملفات تعريف الارتباط التي نستخدمها:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li><strong>ملفات ضرورية:</strong> للوظائف الأساسية للمنصة</li>
                <li><strong>ملفات تحليلية:</strong> لفهم كيفية استخدام المنصة</li>
                <li><strong>ملفات التفضيلات:</strong> لتذكر إعداداتكم</li>
              </ul>
            </section>

            {/* الاحتفاظ بالبيانات */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">
                8. فترة الاحتفاظ بالبيانات
              </h2>
              <p className="text-gray-700 leading-relaxed">
                نحتفظ ببياناتكم الشخصية طالما كان حسابكم نشطاً أو حسب الضرورة لتقديم خدماتنا. عند إغلاق حسابكم، سنحذف بياناتكم الشخصية خلال 90 يوماً، إلا في حالة وجود متطلبات قانونية للاحتفاظ بها لفترة أطول.
              </p>
            </section>

            {/* التحديثات */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">
                9. تحديثات سياسة الخصوصية
              </h2>
              <p className="text-gray-700 leading-relaxed">
                قد نقوم بتحديث سياسة الخصوصية هذه من وقت لآخر. سنخطركم بأي تغييرات جوهرية عبر البريد الإلكتروني أو من خلال إشعار في التطبيق. ننصحكم بمراجعة هذه السياسة بشكل دوري.
              </p>
            </section>

            {/* الاتصال */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">
                10. الاتصال بنا
              </h2>
              <p className="text-gray-700 leading-relaxed">
                إذا كان لديكم أي أسئلة أو استفسارات حول سياسة الخصوصية هذه أو ممارساتنا المتعلقة بالبيانات، يمكنكم التواصل معنا:
              </p>
              <div className="bg-gray-50 p-4 rounded-lg mt-4">
                <p className="text-gray-700"><strong>البريد الإلكتروني:</strong> support@invist.m2y.net</p>
                <p className="text-gray-700"><strong>الموقع:</strong> https://invist.m2y.net</p>
                <p className="text-gray-700"><strong>العنوان:</strong> القاهرة، مصر</p>
              </div>
            </section>

            {/* إقرار */}
            <section className="bg-blue-50 p-6 rounded-lg mt-8">
              <p className="text-gray-700 text-center font-medium">
                باستخدامكم لمنصة دليل الاستثمار، فإنكم تقرؤون وتوافقون على سياسة الخصوصية هذه.
              </p>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}
