import { Metadata } from 'next';

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: 'إخلاء المسؤولية | دليل الاستثمار',
  description: 'إخلاء المسؤولية لتطبيق دليل الاستثمار - منصة الاستثمار في البورصة المصرية',
};

export default function DisclaimerPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8" dir="rtl">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          {/* Header */}
          <div className="from-amber-600 to-amber-800 px-8 py-6">
            <h1 className="text-3xl font-bold text-white">إخلاء المسؤولية</h1>
            <p className="text-amber-100 mt-2">آخر تحديث: مايو 2025</p>
          </div>

          {/* Content */}
          <div className="px-8 py-6 prose prose-lg max-w-none">
            
            {/* تنبيه هام */}
            <section className="mb-8">
              <div className="bg-red-50 border-r-4 border-red-500 p-6 rounded-lg">
                <h2 className="text-xl font-bold text-red-800 mb-3 flex items-center gap-2">
                  <span className="text-2xl">⚠️</span>
                  تنبيه هام جداً
                </h2>
                <p className="text-red-700 font-medium leading-relaxed">
                  هذه المنصة للأغراض التعليمية والتثقيفية فقط. جميع المحتوى المعروض من تحليلات وبيانات ورسوم بيانية لا يُعتبر نصيحة استثمارية أو تحليل بشراء أو بيع الأوراق المالية.
                </p>
              </div>
            </section>

            {/* عدم تقديم نصائح مالية */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-amber-500 pb-2 mb-4">
                1. عدم تقديم نصائح مالية
              </h2>
              <p className="text-gray-700 leading-relaxed">
                منصة دليل الاستثمار لا تقدم خدمات استشارية مالية أو استثمارية بأي شكل من الأشكال. المحتوى المقدم على المنصة:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>للأغراض الإعلامية والتعليمية فقط</li>
                <li>لا يشكل تحليل بشراء أو بيع أي ورقة مالية</li>
                <li>لا يُغني عن استشارة مستشار مالي مرخص</li>
                <li>لا يأخذ في الاعتبار ظروفك المالية الشخصية</li>
              </ul>
            </section>

            {/* مخاطر الاستثمار */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-amber-500 pb-2 mb-4">
                2. مخاطر الاستثمار
              </h2>
              <div className="bg-yellow-50 border-r-4 border-yellow-400 p-4 mb-4">
                <p className="text-yellow-800 font-bold">
                  ⚠️ الاستثمار في الأوراق المالية ينطوي على مخاطر عالية
                </p>
              </div>
              <p className="text-gray-700 leading-relaxed">
                يجب على المستثمرين إدراك المخاطر التالية:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li><strong>خسارة رأس المال:</strong> يمكن خسارة جزء أو كل المبلغ المستثمر</li>
                <li><strong>تقلبات السوق:</strong> أسعار الأسهم تتقلب وقد تنخفض بشكل كبير</li>
                <li><strong>السيولة:</strong> قد لا تكون قادراً على بيع استثماراتك بسرعة</li>
                <li><strong>الأداء السابق:</strong> لا يضمن النتائج المستقبلية</li>
                <li><strong>العوامل الخارجية:</strong> الأحداث الاقتصادية والسياسية تؤثر على الأسواق</li>
              </ul>
            </section>

            {/* دقة البيانات */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-amber-500 pb-2 mb-4">
                3. دقة البيانات والمعلومات
              </h2>
              <p className="text-gray-700 leading-relaxed">
                نحن نبذل قصارى جهدنا لتقديم بيانات دقيقة وحديثة، لكن:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>لا نضمن دقة أو اكتمال أو موثوقية أي معلومات مقدمة</li>
                <li>البيانات قد تحتوي على أخطاء أو تأخير</li>
                <li>الأسعار المعروضة قد لا تعكس الأسعار الفعلية للسوق</li>
                <li>التحليلات الفنية لا تضمن توقعات المستقبل</li>
              </ul>
            </section>

            {/* الذكاء الاصطناعي */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-amber-500 pb-2 mb-4">
                4. التحليلات المالية والفنية
              </h2>
              <p className="text-gray-700 leading-relaxed">
                تستخدم المنصة أدوات ذكاء اصطناعي لتقديم تحليلات. يرجى ملاحظة:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>تحليلات AI للإشارة فقط وليست تحليلات مؤكدة</li>
                <li>النماذج قد تخطئ في التنبؤات</li>
                <li>لا تعتمد فقط على تحليلات AI في قراراتك</li>
                <li>التحليلات لا تأخذ في الاعتبار وضعك المالي الشخصي</li>
              </ul>
            </section>

            {/* إخلاء المسؤولية القانونية */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-amber-500 pb-2 mb-4">
                5. إخلاء المسؤولية القانونية
              </h2>
              <p className="text-gray-700 leading-relaxed">
                نحن غير مسؤولين عن:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>أي خسائر مالية مباشرة أو غير مباشرة ناتجة عن استخدام المنصة</li>
                <li>القرارات الاستثمارية التي تتخذها بناءً على محتوى المنصة</li>
                <li>أي أخطاء أو انقطاع في الخدمة</li>
                <li>دقة المعلومات من مصادر خارجية</li>
                <li>أي أضرار ناتجة عن الاعتماد على المعلومات المقدمة</li>
              </ul>
            </section>

            {/* المسؤولية الشخصية */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-amber-500 pb-2 mb-4">
                6. مسؤوليتك الشخصية
              </h2>
              <p className="text-gray-700 leading-relaxed">
                أنت مسؤول تماماً عن:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>قراراتك الاستثمارية ونتائجها</li>
                <li>إجراء أبحاثك الخاصة قبل الاستثمار</li>
                <li>استشارة مستشار مالي مرخص عند الحاجة</li>
                <li>فهم مخاطر أي استثمار تقوم به</li>
                <li>عدم استثمار أموال لا يمكنك تحمل خسارتها</li>
              </ul>
            </section>

            {/* تحليلات عامة */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-amber-500 pb-2 mb-4">
                7. تحليلات عامة للمستثمرين
              </h2>
              <div className="bg-green-50 border-r-4 border-green-400 p-4">
                <ul className="text-gray-700 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">✓</span>
                    <span>استثمر فقط أموالاً يمكنك تحمل خسارتها</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">✓</span>
                    <span>تنويع محفظتك الاستثمارية لتقليل المخاطر</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">✓</span>
                    <span>تعلم أساسيات الاستثمار قبل البدء</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">✓</span>
                    <span>تابع أخبار السوق والتطورات الاقتصادية</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">✓</span>
                    <span>استشر متخصصاً مالياً قبل قرارات كبيرة</span>
                  </li>
                </ul>
              </div>
            </section>

            {/* الاتصال */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-amber-500 pb-2 mb-4">
                8. الاتصال بنا
              </h2>
              <p className="text-gray-700 leading-relaxed">
                إذا كان لديكم أي أسئلة حول إخلاء المسؤولية هذا، يمكنكم التواصل معنا:
              </p>
              <div className="bg-gray-50 p-4 rounded-lg mt-4">
                <p className="text-gray-700"><strong>البريد الإلكتروني:</strong> support@invist.m2y.net</p>
                <p className="text-gray-700"><strong>الموقع:</strong> https://invist.m2y.net</p>
              </div>
            </section>

            {/* القبول */}
            <section className="bg-amber-50 p-6 rounded-lg mt-8">
              <p className="text-gray-700 text-center font-medium">
                باستخدامكم لمنصة دليل الاستثمار، فإنكم تقرؤون بأنكم فهمتم ووافقتم على إخلاء المسؤولية هذا، وتتحملون المسؤولية الكاملة عن قراراتكم الاستثمارية.
              </p>
            </section>

          </div>
        </div>

        {/* زر العودة */}
        <div className="mt-6 text-center">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-primary hover:underline font-medium"
          >
            <span>→</span>
            العودة للصفحة الرئيسية
          </a>
        </div>
      </div>
    </div>
  );
}
