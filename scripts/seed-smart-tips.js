/**
 * Seed script for smart_tips table in custom.db
 * Run with: node scripts/seed-smart-tips.js
 */
const path = require('path');
const fs = require('fs');

async function main() {
  console.log('Initializing sql.js...');
  const sqlJsDist = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist');
  const sqlJsWasm = path.join(sqlJsDist, 'sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(sqlJsWasm);
  const initSqlJs = require(path.join(sqlJsDist, 'sql-wasm.js'));
  const sqlJs = await initSqlJs({ wasmBinary });

  // Load custom.db
  const dbPath = path.join(process.cwd(), 'db', 'custom.db');
  const buffer = fs.readFileSync(dbPath);
  const db = new sqlJs.Database(buffer);

  // Create smart_tips table
  db.run(`
    CREATE TABLE IF NOT EXISTS smart_tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT 'general',
      content TEXT NOT NULL,
      author TEXT,
      trigger_event TEXT,
      priority INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      show_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Check if tips already exist
  const countResult = db.exec('SELECT COUNT(*) FROM smart_tips');
  const existingCount = countResult[0]?.values[0][0] || 0;
  if (existingCount > 0) {
    console.log('smart_tips table already has', existingCount, 'rows. Skipping seed.');
    db.close();
    return;
  }

  // Seed tips
  const tips = [
    // === PATIENCE & LONG-TERM INVESTING (20) ===
    ['patience', 'الاستثمار الناجح يحتاج صبراً كصبر المزارع — تزرع اليوم لتحصد بعد سنوات', 'dashboard_view', 5],
    ['patience', 'السوق يحول المستثمر المتسرع إلى فقير، والمستثمر الصبور إلى ثري', 'dashboard_view', 4],
    ['patience', 'لا تشتري سهماً إلا إذا كنت مستعداً لامتلاكه 5 سنوات', 'stock_detail', 5],
    ['patience', 'أفضل استثمار هو الاستثمار الذي لا تفكر فيه كل يوم', 'stock_detail', 3],
    ['patience', 'من يتداول كثيراً يخسر كثيراً — التكاليف والضرائب تأكل الأرباح', 'stock_detail', 4],
    ['patience', 'الثروة تُبنى بالبطء وتُفقد بالسرعة', 'dashboard_view', 3],
    ['patience', 'السهم الجيد في محفظة سيئة أفضل من السهم السيئ في محفظة جيدة', 'add_watchlist', 4],
    ['patience', 'لا تستثمر مالاً قد تحتاجه خلال سنة — الاستثمار يحتاج وقتاً للتعافي', 'recommendation_view', 3],
    ['patience', 'التراجع المؤقت في السهم الجيد ليس خسارة، بل فرصة للشراء بسعر أقل', 'stock_detail', 5],
    ['patience', 'المستثمر الحكيم يشتري في الخوف ويبيع في الطمع — العكس هو الخسارة', 'market_crash', 5],
    ['patience', 'إذا كان سعر السهم ينخفض لسبب مؤقت في الشركة القوية، فهذا هدية', 'stock_detail', 4],
    ['patience', 'الوقت في السوق أهم من توقيت السوق', 'dashboard_view', 5],
    ['patience', 'المستثمر الذي يتابع أسهمه كل ساعة يصبح مضارباً فاشلاً', 'stock_detail', 3],
    ['patience', 'الصبر ليس مجرد انتظار، بل هو الثقة في قرارك المبني على البيانات', 'recommendation_view', 4],
    ['patience', 'الثروة الحقيقية تأتي من امتلاك أصول تتضاعف مع الزمن، ليس من المضاربة', 'dashboard_view', 4],
    ['patience', 'لا تبيع سهماً جيداً لمجرد أنه توقف عن الصعود شهراً', 'stock_detail', 3],
    ['patience', 'السوق يختبر صبرك قبل أن يكافئك', 'market_crash', 4],
    ['patience', 'المستثمر الناجح هو من يقرأ التقارير السنوية، لا من يتابع الشاشات', 'recommendation_view', 3],
    ['patience', 'إذا لم تستطع تحمل انخفاض 30% في محفظتك، فأنت تحتاج إعادة تقييم مخاطرك', 'dashboard_view', 4],
    ['patience', 'أفضل قرار استثماري قد تتخذه هو عدم اتخاذ قرار في لحظة غضب أو خوف', 'market_crash', 5],

    // === RISK AVOIDANCE (25) ===
    ['risk', 'الشراء والبيع السريع هو أقصر طريق لخسارة رأس المال', 'stock_detail', 5],
    ['risk', 'لا تقترض لتستثمر — الديون تقتل القدرة على الصبر', 'dashboard_view', 4],
    ['risk', 'إذا كان العرض يبدو جيداً جداً لدرجة يصعب تصديقها، فهو بالتأكيد كذلك', 'recommendation_view', 5],
    ['risk', 'تجنب الأسهم التي يروج لها خبراء على فيسبوك وواتساب', 'dashboard_view', 4],
    ['risk', 'السهم الذي ارتفع 50% في أسبوع قد ينهار 70% في يوم واحد', 'stock_detail', 4],
    ['risk', 'لا تضع أكثر من 10% من رأس مالك في سهم واحد — مهما كنت واثقاً', 'add_watchlist', 5],
    ['risk', 'التنويع وقاية من الجهل — إذا كنت لا تفهم الشركة، لا تستثمر فيها', 'add_watchlist', 5],
    ['risk', 'تجنب الشركات التي لا تحقق أرباحاً لأكثر من عامين', 'recommendation_view', 3],
    ['risk', 'الاستثمار بناءً على نصيحة صديق هو مقامرة، ليس استثماراً', 'dashboard_view', 4],
    ['risk', 'لا تشتري سهماً فقط لأنه انخفض كثيراً — قد ينخفض أكثر', 'stock_detail', 4],
    ['risk', 'تجنب الشركات ذات الديون المرتفعة في الأسواق الناشئة', 'recommendation_view', 3],
    ['risk', 'السيولة المنخفضة تعني أنك قد لا تستطيع البيع عند الحاجة', 'stock_detail', 3],
    ['risk', 'لا تستثمر في شركتك التي تعمل بها — خطر التركيز مضاعف', 'dashboard_view', 3],
    ['risk', 'إذا لم تفهم كيف تجني الشركة أرباحها، فلا تستثمر فيها', 'stock_detail', 4],
    ['risk', 'السوق يمكن أن يبقى غير منطقي أطول مما تبقى أنت مفلساً', 'market_crash', 5],
    ['risk', 'إذا فقدت 50% من رأس مالك، تحتاج ربح 100% لتعويضه — الرياضيات قاسية', 'market_crash', 5],
    ['risk', 'لا تضيف على خسارة خسارة — التكلفة الغارقة تقتل المحافظ', 'stock_detail', 4],
    ['risk', 'لا تستثمر بناءً على الشعور أو الحدس — البيانات أو لا شيء', 'recommendation_view', 4],
    ['risk', 'المضاربة بالهامش في البورصة المصرية هي انتحار مالي بطيء', 'dashboard_view', 5],
    ['risk', 'إذا كانت جميع الأخبار إيجابية، فقد حان وقت البيع وليس الشراء', 'recommendation_view', 4],
    ['risk', 'تجنب الشراء عند الاكتتاب الأولي — غالباً ما يكون مبالغاً فيه', 'dashboard_view', 3],
    ['risk', 'تجنب الأسهم التي تتداول بأقل من جنيه واحد — غالباً ما تكون فخاخاً', 'stock_detail', 3],
    ['risk', 'التاريخ لا يعيد نفسه بالضبط، لكنه يتماشى مع الإيقاع', 'recommendation_view', 3],
    ['risk', 'لا تستخدم وقف خسارة وهمياً — ضع أمر بيع فعلياً عند مستوى محدد', 'stock_detail', 4],

    // === ANALYSIS & DECISIONS (20) ===
    ['analysis', 'اشتري الشركة، لا السهم — السهم مجرد ورقة تمثل ملكية', 'stock_detail', 5],
    ['analysis', 'السعر الذي تدفعه يحدد عائدك، ليس جودة الشركة وحدها', 'recommendation_view', 5],
    ['analysis', 'القيمة السوقية أهم من سعر السهم — سهم بـ 5 جنيهات قد يكون أغلى من سهم بـ 50', 'stock_detail', 4],
    ['analysis', 'P/E المنخفض ليس دائماً فرصة — قد يكون السوق يرى مشكلة مستقبلية', 'stock_detail', 4],
    ['analysis', 'التوزيعات النقدية هي أجر الصبر — لا تهملها', 'recommendation_view', 3],
    ['analysis', 'مقارنة الشركة بقطاعها أهم من مقارنتها بالسوق ككل', 'stock_detail', 3],
    ['analysis', 'التحليل الفني يساعد في التوقيت، لكن التحليل الأساسي يحدد القيمة', 'recommendation_view', 4],
    ['analysis', 'لا تشتري سهماً قبل قراءة آخر تقرير سنوي للشركة', 'stock_detail', 4],
    ['analysis', 'نمو الأرباح المستدام أفضل من نمو الإيرادات المؤقت', 'recommendation_view', 3],
    ['analysis', 'الشركة التي لا تولد تدفق نقدي حر إيجابياً هي شركة تائهة', 'recommendation_view', 4],
    ['analysis', 'إذا كان مجلس الإدارة يبيع أسهمه، فكر ملياً قبل الشراء', 'stock_detail', 4],
    ['analysis', 'نسبة الربحية أهم من حجم المبيعات', 'recommendation_view', 3],
    ['analysis', 'الشركة القوية تتحمل الأزمات — الشركة الضعيفة تنهار عند أول ريح', 'stock_detail', 3],
    ['analysis', 'لا تشتري سهماً لمجرد أنه في EGX30 — المؤشرات تتغير، الجودة تبقى', 'recommendation_view', 3],
    ['analysis', 'اقرأ الإفصاحات على موقع الرقابة المالية قبل أن تقرأ التوصيات', 'recommendation_view', 4],
    ['analysis', 'السهم الرخيص ليس بالضرورة سهماً رخيصاً — قد يكون مبالغاً في سعره', 'stock_detail', 3],
    ['analysis', 'إذا لم تستطع شرح استثمارك في جملتين، فأنت لا تفهمه', 'stock_detail', 4],
    ['analysis', 'التحليل الكمي يكمله التحليل النوعي — الإدارة والمنافسة مهمان', 'recommendation_view', 3],
    ['analysis', 'السوق يكافئ الشركات التي تنمو بذكاء، ليس التي تنمو بسرعة', 'recommendation_view', 3],
    ['analysis', 'إذا لم تفهم كيف تجني الشركة أرباحها، فلا تستثمر فيها أبداً', 'stock_detail', 5],

    // === EGX SPECIFIC (20) ===
    ['egx', 'البورصة المصرية تختلف عن الأسواق الأمريكية — السيولة أقل، التقلب أعلى', 'dashboard_view', 5, 'خبير محلي'],
    ['egx', 'في مصر، قرارات البنك المركزي تؤثر على الأسهم أكثر من أرباح الشركات', 'dashboard_view', 5],
    ['egx', 'سعر الدولار في مصر هو مؤشر الخوف — ارتفاعه يضغط على الأسهم المستوردة', 'currency_view', 5],
    ['egx', 'الأسهم الدفاعية مثل المواد الغذائية والأدوية تنجو في الأزمات المصرية', 'market_crash', 5],
    ['egx', 'تجنب الأسهم المتأثرة بالاستيراد عند ارتفاع الدولار', 'currency_view', 4],
    ['egx', 'قطاع العقارات في مصر مخزن للقيمة في التضخم', 'dashboard_view', 3, 'خبير محلي'],
    ['egx', 'البنوك المصرية تستفيد من ارتفاع أسعار الفائدة — فهمها جيداً', 'recommendation_view', 4],
    ['egx', 'التضخم المرتفع في مصر يأكل عوائدك إذا كانت أقل من 15% سنوياً', 'dashboard_view', 4],
    ['egx', 'في البورصة المصرية التجميع والتصريف حقيقة — تعلم قراءة حجم التداول', 'stock_detail', 5],
    ['egx', 'الأسهم الصغيرة في مصر أكثر عرضة للتلاعب — احذر', 'stock_detail', 4],
    ['egx', 'العطلات الرسمية في مصر كثيرة — احسبها في تخطيطك الاستثماري', 'dashboard_view', 3],
    ['egx', 'التوصيات المجانية في الجروبات غالباً ما تكون فخاخ تصريف', 'dashboard_view', 5],
    ['egx', 'أسعار الفائدة على شهادات الادخار هي المنافس الحقيقي للأسهم في مصر', 'dashboard_view', 5],
    ['egx', 'إذا كانت شهادات البنك تعطي 20% بدون مخاطر، فالسهم يجب أن يعطي 25%+ لتستحق المخاطرة', 'recommendation_view', 5],
    ['egx', 'قطاع السياحة المصري حساس للأمن والعملات — تابع الأخبار السياسية', 'dashboard_view', 3],
    ['egx', 'الشركات المصرية التي تصدر تستفيد من انخفاض الجنيه', 'currency_view', 4],
    ['egx', 'لا تستهين بتقرير البنك المركزي ربع السنوي — فيه إشارات قوية', 'recommendation_view', 3],
    ['egx', 'الاستثمار الأجنبي المباشر يدفع السوق المصري — تابعه', 'dashboard_view', 3],
    ['egx', 'أوقات التداول في البورصة المصرية: الأحد-الخميس 10:00-2:30 — التوقيت مهم', 'dashboard_view', 2],
    ['egx', 'لا تضع أوامر بيع في آخر 15 دقيقة من التداول — التقلب عالي جداً', 'stock_detail', 4],

    // === PSYCHOLOGY (15) ===
    ['psychology', 'الخوف والطمع هما عدواك — اكتب قرارك قبل النوم ونفذه في الصباح', 'stock_detail', 5],
    ['psychology', 'إذا شعرت بالخوف من فقدان فرصة، فأنت على وشك ارتكاب خطأ', 'recommendation_view', 5],
    ['psychology', 'التأكيد الزائد يجعلك ترى فقط ما يؤيد رأيك — انتبه للتحيز', 'stock_detail', 4],
    ['psychology', 'الخسارة الورقية ليست خسارة حقيقية — لا تبيع في الذعر', 'market_crash', 5],
    ['psychology', 'الفخر يمنع الاعتراف بالخطأ — اقطع الخسارة مبكراً', 'stock_detail', 4],
    ['psychology', 'الحسد من أرباح الآخرين يدفعك لمخاطرات غير محسوبة', 'dashboard_view', 4],
    ['psychology', 'لا تقارن محفظتك بصديق ناجح — قد يكذب أو يحتفظ بخسائره', 'dashboard_view', 3],
    ['psychology', 'الندم على فرصة فائتة أسوأ من الخسارة — السوق مليء بالفرص', 'recommendation_view', 4],
    ['psychology', 'إذا كان النوم يصعب عليك بسبب استثمار، فأنت تخاطر أكثر مما تتحمل', 'stock_detail', 4],
    ['psychology', 'المال السهل في السوق هو فخ — الثروة تأتي من العمل الشاق والصبر', 'dashboard_view', 4],
    ['psychology', 'لا تستثمر بناءً على الغيرة من نجاح غيرك', 'dashboard_view', 3],
    ['psychology', 'السعي وراء الاستعجال (FOMO) أغلى درس في البورصة المصرية', 'stock_detail', 5],
    ['psychology', 'اكتب يوميات استثمارية — سترى أخطاءك بوضوح بعد 6 أشهر', 'dashboard_view', 3],
    ['psychology', 'النجاح في الاستثمار يحتاج إلى نظام لا إلى نبوءات', 'recommendation_view', 4],
    ['psychology', 'في النهاية، السوق يكافئ العقلانية ويعاقب العاطفة', 'market_crash', 5],
  ];

  // Insert tips
  let count = 0;
  for (const [category, content, trigger, priority, author] of tips) {
    db.run(
      'INSERT INTO smart_tips (category, content, author, trigger_event, priority, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [category, content, author || null, trigger || null, priority || 0]
    );
    count++;
  }

  console.log('Seeded', count, 'smart tips into custom.db');

  // Verify
  const verify = db.exec('SELECT category, COUNT(*) as cnt FROM smart_tips GROUP BY category');
  for (const row of verify[0].values) {
    console.log('  ' + row[0] + ': ' + row[1] + ' tips');
  }

  // Save DB
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  db.close();
  console.log('Database saved.');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
