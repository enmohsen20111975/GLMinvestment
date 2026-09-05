import { Metadata } from 'next';

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: 'شروط الاستخدام | دليل الاستثمار',
  description: 'شروط الاستخدام لتطبيق دليل الاستثمار - منصة الاستثمار في البورصة المصرية',
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8" dir="rtl">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-l from-purple-600 to-purple-800 px-8 py-6">
            <h1 className="text-3xl font-bold text-white">شروط الاستخدام</h1>
            <p className="text-purple-100 mt-2">آخر تحديث: مايو 2025</p>
          </div>

          {/* Content */}
          <div className="px-8 py-6 prose prose-lg max-w-none">
            
            {/* مقدمة */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                1. قبول الشروط
              </h2>
              <p className="text-gray-700 leading-relaxed">
                مرحباً بكم في منصة دليل الاستثمار (&quot;المنصة&quot;، &quot;نحن&quot;، &quot;لنا&quot;). باستخدامكم لتطبيقنا وخدماتنا، فإنكم توافقون على الالتزام بشروط الاستخدام هذه. إذا لم توافقوا على أي جزء من هذه الشروط، يرجى عدم استخدام المنصة.
              </p>
              <p className="text-gray-700 leading-relaxed mt-4">
                تحكم هذه الشروط علاقتكم معنا وتحدد حقوق والتزامات كل طرف. ننصحكم بقراءة هذه الشروط بعناية قبل استخدام المنصة.
              </p>
            </section>

            {/* وصف الخدمة */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                2. وصف الخدمة
              </h2>
              <p className="text-gray-700 leading-relaxed">
                توفر منصة دليل الاستثمار خدمات المعلومات الاستثمارية والتقارير المالية للبورصة المصرية (EGX)، وتشمل:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>بيانات الأسعار المباشرة والتاريخية لأسهم البورصة المصرية</li>
                <li>التحليل الفني والمؤشرات للأسهم</li>
                <li>تحليلات سوقية مالية وفنية متقدمة</li>
                <li>إدارة المحفظة الاستثمارية</li>
                <li>متابعة أسعار الذهب والعملات</li>
                <li>تحليلات العملات الرقمية</li>
                <li>محتوى تعليمي للاستثمار</li>
              </ul>
              <div className="bg-yellow-50 border-r-4 border-yellow-400 p-4 mt-4">
                <p className="text-yellow-800 font-medium">
                  ⚠️ تنبيه هام: المنصة توفر معلومات وتحليلات للأغراض الإعلامية والتعليمية فقط ولا تعتبر نصيحة مالية أو تحليل بالبيع أو الشراء.
                </p>
              </div>
            </section>

            {/* التسجيل والحساب */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                3. التسجيل والحساب
              </h2>
              
              <h3 className="text-xl font-medium text-gray-700 mt-4">أ. إنشاء الحساب</h3>
              <p className="text-gray-700 leading-relaxed mt-2">
                لاستخدام بعض ميزات المنصة، يجب إنشاء حساب. أنتم مسؤولون عن:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>تقديم معلومات صحيحة ودقيقة عند التسجيل</li>
                <li>الحفاظ على سرية كلمة المرور</li>
                <li>جميع الأنشطة التي تتم تحت حسابكم</li>
                <li>إخطارنا فوراً في حالة أي استخدام غير مصرح به للحساب</li>
              </ul>

              <h3 className="text-xl font-medium text-gray-700 mt-6">ب. اشتراكات الخدمة</h3>
              <p className="text-gray-700 leading-relaxed mt-2">
                تقدم المنصة خطط اشتراك مختلفة:
              </p>
              <div className="overflow-x-auto mt-4">
                <table className="min-w-full bg-white border border-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-right border-b">الخطة</th>
                      <th className="px-4 py-2 text-right border-b">المميزات</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-4 py-2 border-b">المجانية</td>
                      <td className="px-4 py-2 border-b">بيانات الأسعار الأساسية، قوائم متابعة محدودة</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 border-b">الأساسية</td>
                      <td className="px-4 py-2 border-b">تحليلات متقدمة، رؤى سوقية، تنبيهات الأسعار</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 border-b">المتقدمة</td>
                      <td className="px-4 py-2 border-b">جميع المميزات، تحليلات AI، دعم أولوية</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* الاستخدام المقبول */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                4. الاستخدام المقبول
              </h2>
              <p className="text-gray-700 leading-relaxed">يُسمح لكم باستخدام المنصة للأغراض المشروعة فقط. يُحظر:</p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>استخدام المنصة لأي أغراض غير قانونية</li>
                <li>محاولة الوصول غير المصرح به إلى أنظمة المنصة</li>
                <li>نسخ أو توزيع محتوى المنصة بدون إذن</li>
                <li>استخدام برامج آلية (bots) لاستخراج البيانات</li>
                <li>التلاعب بالأسعار أو البيانات</li>
                <li>نشر معلومات مضللة أو ضارة</li>
                <li>انتحال شخصية مستخدمين آخرين</li>
                <li>بيع أو نقل الحساب لأطراف ثالثة</li>
              </ul>
            </section>

            {/* إخلاء المسؤولية */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                5. إخلاء المسؤولية
              </h2>
              <div className="bg-red-50 border-r-4 border-red-400 p-4 mb-4">
                <p className="text-red-800 font-bold mb-2">⚠️ تنبيه مخاطر الاستثمار</p>
                <p className="text-red-700">
                  الاستثمار في الأوراق المالية ينطوي على مخاطر، بما في ذلك احتمال خسارة رأس المال. الأداء السابق لا يضمن النتائج المستقبلية.
                </p>
              </div>
              <p className="text-gray-700 leading-relaxed">
                المنصة لا تقدم نصائح مالية أو استثمارية. المعلومات المقدمة هي للأغراض الإعلامية فقط. يجب على المستخدمين:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>إجراء أبحاثهم الخاصة قبل اتخاذ قرارات الاستثمار</li>
                <li>استشارة مستشار مالي مرخص عند الحاجة</li>
                <li>فهم مخاطر الاستثمار في الأسواق المالية</li>
                <li>عدم استثمار أموال لا يمكنهم تحمل خسارتها</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mt-4">
                <strong>نحن غير مسؤولين عن:</strong>
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>أي خسائر مالية ناتجة عن استخدام المنصة</li>
                <li>دقة أو اكتمال المعلومات المقدمة</li>
                <li>انقطاع الخدمة أو أخطاء تقنية</li>
                <li>قرارات الاستثمار التي تتخذونها</li>
              </ul>
            </section>

            {/* الملكية الفكرية */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                6. الملكية الفكرية
              </h2>
              <p className="text-gray-700 leading-relaxed">
                جميع حقوق الملكية الفكرية المتعلقة بالمنصة (بما في ذلك العلامات التجارية، حقوق النشر، البرمجيات، التصميمات، والبيانات) محفوظة لنا أو لموردي المحتوى لدينا.
              </p>
              <p className="text-gray-700 leading-relaxed mt-4">
                يُحظر نسخ أو تعديل أو توزيع أو بيع أي جزء من المنصة بدون موافقة كتابية مسبقة منا.
              </p>
            </section>

            {/* المدفوعات والاسترداد */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                7. المدفوعات والاسترداد
              </h2>
              
              <h3 className="text-xl font-medium text-gray-700 mt-4">أ. سياسة الدفع</h3>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>يتم دفع الاشتراكات مقدماً</li>
                <li>نقبل الدفع عبر البطاقات الائتمانية والمحافظ الإلكترونية</li>
                <li>يتم تجديد الاشتراكات تلقائياً ما لم يتم إلغاؤها</li>
              </ul>

              <h3 className="text-xl font-medium text-gray-700 mt-6">ب. سياسة الاسترداد</h3>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>يمكن طلب الاسترداد خلال 7 أيام من الاشتراك</li>
                <li>لا يوجد استرداد جزئي للأشهر غير المستخدمة</li>
                <li>يتم معالجة طلبات الاسترداد خلال 14 يوم عمل</li>
              </ul>
            </section>

            {/* الإنهاء */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                8. إنهاء الحساب
              </h2>
              <p className="text-gray-700 leading-relaxed">
                نحتفظ بالحق في تعليق أو إنهاء حسابكم في الحالات التالية:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>انتهاك شروط الاستخدام</li>
                <li>سلوك احتيالي أو مشبوه</li>
                <li>عدم دفع رسوم الاشتراك</li>
                <li>طلب من السلطات القانونية</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mt-4">
                يمكنكم إلغاء حسابكم في أي وقت من خلال إعدادات الحساب أو التواصل مع الدعم.
              </p>
            </section>

            {/* تحديث الشروط */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                9. تحديث الشروط
              </h2>
              <p className="text-gray-700 leading-relaxed">
                نحتفظ بالحق في تعديل شروط الاستخدام في أي وقت. سنخطركم بالتغييرات الجوهرية عبر:
              </p>
              <ul className="list-disc list-inside text-gray-700 mr-4 mt-2 space-y-2">
                <li>إشعار في التطبيق</li>
                <li>البريد الإلكتروني</li>
                <li>إشعار على موقعنا الإلكتروني</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mt-4">
                استمراركم في استخدام المنصة بعد نشر التغييرات يعني موافقتكم على الشروط المحدثة.
              </p>
            </section>

            {/* القانون الواجب التطبيق */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                10. القانون الواجب التطبيق
              </h2>
              <p className="text-gray-700 leading-relaxed">
                تخضع شروط الاستخدام هذه وتفسر وفقاً قوانين جمهورية مصر العربية. أي نزاعات تنشأ عن هذه الشروط يتم حلها حصرياً في محاكم القاهرة.
              </p>
            </section>

            {/* الاتصال */}
            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 border-b-2 border-purple-500 pb-2 mb-4">
                11. الاتصال بنا
              </h2>
              <p className="text-gray-700 leading-relaxed">
                إذا كان لديكم أي أسئلة حول شروط الاستخدام هذه، يمكنكم التواصل معنا:
              </p>
              <div className="bg-gray-50 p-4 rounded-lg mt-4">
                <p className="text-gray-700"><strong>البريد الإلكتروني:</strong> support@invist.m2y.net</p>
                <p className="text-gray-700"><strong>الموقع:</strong> https://invist.m2y.net</p>
                <p className="text-gray-700"><strong>العنوان:</strong> القاهرة، مصر</p>
              </div>
            </section>

            {/* إقرار */}
            <section className="bg-purple-50 p-6 rounded-lg mt-8">
              <p className="text-gray-700 text-center font-medium">
                باستخدامكم لمنصة دليل الاستثمار، فإنكم تقرؤون بأنكم قرأتم وفهمتم ووافقتم على شروط الاستخدام هذه.
              </p>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}
