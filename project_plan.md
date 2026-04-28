Add the news featuer for the current application 
useing of below for just help 
فحصت المصادر دي بنفسي. دي النتيجة:

---

| المصدر | الرابط | النوع | اللغة | الحالة | بيجيب إيه | القيود |
|---|---|---|---|---|---|---|
| **آراب فاينانس RSS** | `arabfinance.com/ar/RSS/RSSList` | RSS | عربي | ✅ شغال | أخبار البورصة والاقتصاد والبنوك والقطاعات كلها مقسمة RSS  | XML عادي، مفيش API رسمي، لكن RSS سهل ت parse في Node.js |
| **مباشر.إنفو** | `mubasher.info` أو `english.mubasher.info` | Scraping | عربي/إنجليزي | ✅ شغال | أخبار لحظية للبورصة المصرية EGX ومؤشراتها  | مفيش API مجاني رسمي، خدمة الـ NetPlus Pro مدفوعة  |
| **البنك المركزي CBE** | `cbe.org.eg` | Scraping / RSS | إنجليزي/عربي | ✅ شغال | قرارات الفايدة، أسعار الدولار، التضخم، السياسة النقدية  | مفيش API مفتوح، لكن الموقع stable وينفع scrape |
| **NewsAPI.org** | `newsapi.org` | API | عربي/إنجليزي | ✅ شغال | أخبار مصر بفلتر `country=eg` أو بحث `q=EGX+البورصة`  | 100 request/يوم في الخطة المجانية |
| **WorldNewsAPI** | `worldnewsapi.com` | API | عربي | ✅ شغال | أخبار مصر بفلتر `source-country=eg` + `language=ar`  | خطة مجانية محدودة |
| **Mediastack** | `mediastack.com` | API | عربي/إنجليزي | ✅ شغال | أخبار مصر بفلتر `country=eg`  | خطة مجانية بسيطة |
| **هيئة الرقابة المالية FRA** | `fra.gov.eg` | Scraping | عربي | ✅ شغال | قرارات تنظيمية تخص الشركات والسماسرة  | مفيش API، لكن القرارات بتأثر السوق فوراً |
| **البورصة المصرية EGX** | `egx.com.eg` | Scraping | عربي/إنجليزي | ✅ شغال | إفصاحات الشركات المقيدة (أرباح، توزيعات، تغييرات رأسمال) | مفيش API مجاني رسمي، لكن الإفصاحات public ومحتاج scrape |
| **TradingView News (Apify)** | `apify.com` | API (مدفوع/مجاني) | إنجليزي | ⚠️ Partial | scraper جاهز لأخبار TradingView  | محتاج account في Apify، مش متخصص في EGX |
| **Daily News Egypt** | `dailynewsegypt.com` | Scraping | إنجليزي | ✅ شغال | أخبار اقتصادية مصرية  | إنجليزي بس، مفيش API |

---

### الترتيب اللي أنصحك تشتغل بيه:

| الأولوية | المصدر | السبب |
|---|---|---|
| 1 | **Arab Finance RSS** | عربي 100%، مجاني، سهل، أخبار مباشرة على البورصة |
| 2 | **NewsAPI.org** | API حقيقي، 100 request/يوم تكفي، ممكن تفلتر بكلمات زي "البورصة المصرية" |
| 3 | **CBE** | أي خبر فايدة أو دولار بيحرك السوق كله |
| 4 | **EGX إفصاحات** | دي اللي بتحرك السهم نفسه (أرباح، توزيعات، زيادة رأسمال) |
| 5 | **Mubasher.info** | backup للأخبار اللحظية لو عايز scrape |

### ملحوظة مهمة:
**مفيش API مجاني رسمي متخصص 100% في البورصة المصرية.** كل اللي فوق إما general news APIs (NewsAPI, WorldNewsAPI) أو RSS/scraping من مصادر مصرية متخصصة. لو لقيت حد بيقول "API مجاني للبورصة المصرية" غير اللي فوق، غالباً fake أو محتاج اشتراك مدفوع خفي.

we need the free way only and sort them related to stocks and major news 
make the news with API can i access it from my mobile application or from another website 

it is very important to build the local markdown file for all our activity to use it as the project memeory for all modifications and improvement   