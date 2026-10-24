import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// Data constants - these are safe at module level
const EGYPTIAN_NAMES = [
  'أحمد المصري', 'محمد السيد', 'محمود علي', 'خالد إبراهيم', 'ياسر حمدي',
  'عمر فاروق', 'حسين أحمد', 'طارق محمد', 'سمير حسن', 'رضا عبدالله',
  'سارة أحمد', 'نور محمد', 'منى السيد', 'هدى علي', 'فاطمة محمود',
  'أميرة حسن', 'ديانا مجدي', 'ندى كريم', 'رنا سعيد', 'شيماء عادل'
];

const AVATARS = [
  'https://api.dicebear.com/7.x/avataaars/svg?seed=ahmed',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=mohamed',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=mahmoud',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=khaled',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=yasser',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=sara',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=nour',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=mona',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=fatma',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=reem'
];

const ROOMS = [
  { name: 'stocks', name_ar: 'البورصة المصرية', description: 'مناقشة أسهم البورصة المصرية', icon: '📈' },
  { name: 'crypto', name_ar: 'العملات الرقمية', description: 'بيتكوين والإيثيريوم وغيرهم', icon: '₿' },
  { name: 'trading_tips', name_ar: 'نصائح التداول', description: 'استراتيجيات ونصائح للتداول', icon: '💡' },
  { name: 'success_stories', name_ar: 'قصص النجاح', description: 'شارك قصة نجاحك', icon: '🏆' },
  { name: 'market_news', name_ar: 'أخبار السوق', description: 'آخر أخبار الأسواق المالية', icon: '📰' }
];

const STOCKS_POSTS = [
  'كلمتين عن الإيجبت فودز - السهم ده كويس جداً للسحب على المدى الطويل، أرباحه مستقرة وتوزيعاته كويسة',
  'بصوا يا جماعة على التجاري الدولي، السهم عمل بريك أوت من نموذج القاع الدائري',
  'السياحة المصرية (ETRS) - السهم ده عنده إمكانيات كبيرة مع عودة السياحة',
  'أوراسكوم للإنشاءات - في أخبار عن مشاريع جديدة في الشرق الأوسط',
  'المصرف المتحد - السهم ده كويس للسحب على المدى المتوسط',
  'بورصة مصر النهاردة في التريندينج بتاعها، في تداولات قوية على السائلين',
  'القاهرة للادوية - السهم ده كويس جداً، عنده أصول حقيقية وأرباح ثابتة',
  'اليوم عملت صفقة على سهم المجموعة المالية هيرميس، دخل بخير الحمد لله',
  'الإسكندرية للحاويات - السهم ده بيبان إنه هيعمل حلوة قريب',
  'صناعة الورق - السهم ده في تحسن ملحوظ في الأداء المالي'
];

const CRYPTO_POSTS = [
  'بيتكوين وصل لـ 100K يا جماعة! أنا كنت متوقع ده من زمان',
  'الإيثيريوم يعمل أبديت جديد، السعر هيحسن بإذن الله',
  'عملت تحليل على BNB، في نموذج كوب ومقبض واضح على الفريم اليوم',
  'سولانا - العملة دي كويسة جداً للسحب على المدى الطويل',
  'شوفوا على USDT وUSDC، في فروقات في الأسعار بين البورصات',
  'اليوم عملت arbitrage بين Binance وCoinbase، ربحت حوالي 200 دولار',
  'الـ DeFi في نمو مستمر، فيه فرص كتير في المجال ده',
  'عملت تحليل على UNISWAP، السعر كويس جداً للدخول دلوقتي',
  'الـ NFTs رجعت تاني؟ شايف إنشاءات كتير في المجال ده',
  'الحلال والحرام في الكريبتو - لازم نفكر في الموضوع ده بجدية'
];

const TRADING_TIPS = [
  'نصيحة مني: متدخلش في أي صفقة من غير ستوب لوس، ده أهم حاجة',
  'استراتيجية السوينغ ترايدنج - ادخل على الفريم الأسبوعي واتبع الترند',
  'إدارة رأس المال أهم من التحليل الفني، متغامرش بأكتر من 2% في الصفقة',
  'التحليل الأساسي والتقني لازم يبقوا مع بعض مش لوحدهم',
  'أفضل أوقات التداول على البورصة المصرية من 11 الصبح لـ 1 الظهر',
  'التداول العاطفي هو العدو الأول للتريدر، لازم تتحكم في نفسك',
  'اعمل دفتر تداول وسجل كل صفقاتك، ده هيساعدك تتعلم من أخطائك',
  'المراجعة الأسبوعية مهمة جداً، شوف اللي صح واللي غلط',
  'متلقاش إشارات من حد، اتعلم اعمل إشاراتك بنفسك',
  'الصبر مفتاح النجاح في التداول، السوق مش هييجي عليك'
];

const SUCCESS_STORIES = [
  'الحمد لله ربنا رزقني دي شهر كويس، عملت 15% ربح على المحفظة كلها',
  'قبل سنة كان عندي 10 آلاف، دلوقتي بقوا 25 ألف الحمد لله',
  'قصة نجاح صغيرة: كنت بخسر كتير، بس دلوقتي ببقى في الربح بشكل مستمر',
  'أول صفقة ناجحة لي كانت على سهم الإيجبت فودز، ربحت 3 آلاف',
  'اتعلمت من أخطائي وبقيت أحسن، الحمد لله المحفظة في تزايد',
  'السر في إدارة المخاطر، ركزت على الموضوع ده وبقيت أربح',
  'دي أول سنة لي في التداول بختتمها بربح، الحمد لله',
  'كنت بخسر في الأول بس دلوقتي بقيت أعرف إيه الصح وإيه الغلط'
];

const MARKET_NEWS = [
  'الأخبار تقول إن البنك المركزي هيثبت الفائدة، ده كويس للبورصة',
  'في تقارير عن تحسن الاقتصاد المصري، ده هينعكس على الأسهم',
  'البورصة المصرية حققت مكاسب 2.5% في الأسبوع الماضي',
  'الاستثمار الأجنبي في البورصة المصرية في زيادة',
  'أخبار عن صفقات جديدة لشركات المقاولات المصرية في الخليج',
  'السياحة في مصر بتسجل أرقام قياسية، الأسهم السياحية هتستفيد',
  'البنوك المصرية في تحسن كبير، الأرباح في زيادة',
  'البورصة المصرية من أفضل البورصات الناشئة في الأداء'
];

const POST_TEMPLATES: Record<string, string[]> = {
  stocks: STOCKS_POSTS,
  crypto: CRYPTO_POSTS,
  trading_tips: TRADING_TIPS,
  success_stories: SUCCESS_STORIES,
  market_news: MARKET_NEWS
};

export async function GET(request: NextRequest) {
  // CRITICAL FIX (2026-08-28): Disabled — generates fake community data
  // (fake users, fake posts, fake success stories). This is a financial platform.
  return NextResponse.json({
    success: false,
    disabled: true,
    error: 'تم إيقاف توليد بيانات المجتمع المُصطنعة — هذا تطبيق إنتاجي',
    message: 'Community seeder has been removed. Use real user-generated content only.',
  }, { status: 410 });
}

export async function POST(request: NextRequest) {
  // CRITICAL FIX (2026-08-28): Disabled — generates fake community data
  return NextResponse.json({
    success: false,
    disabled: true,
    error: 'تم إيقاف توليد بيانات المجتمع المُصطنعة — هذا تطبيق إنتاجي',
    message: 'Community seeder has been removed. Use real user-generated content only.',
  }, { status: 410 });
}

async function seedDatabase() {
  try {
    console.log('[seed] Starting seed process...');

    // All database operations happen here at runtime, not build time
    const dbPath = path.join(process.cwd(), 'db', 'community.db');
    const dbDir = path.dirname(dbPath);
    
    // Ensure directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Delete existing database for clean seed
    if (fs.existsSync(dbPath)) {
      // Close any existing connections first
      try {
        const walPath = dbPath + '-wal';
        const shmPath = dbPath + '-shm';
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
      } catch {
        // Ignore cleanup errors
      }
      fs.unlinkSync(dbPath);
      console.log('[seed] Deleted existing database');
    }

    const db = new Database(dbPath);

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        avatar TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        likes INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS post_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        UNIQUE(post_id, user_id)
      );
    `);

    // Seed users
    const insertUser = db.prepare('INSERT INTO users (name, avatar) VALUES (?, ?)');
    for (let i = 0; i < EGYPTIAN_NAMES.length; i++) {
      insertUser.run(EGYPTIAN_NAMES[i], AVATARS[i % AVATARS.length]);
    }
    console.log('[seed] Inserted', EGYPTIAN_NAMES.length, 'users');

    // Seed rooms
    const insertRoom = db.prepare('INSERT INTO rooms (name, name_ar, description, icon) VALUES (?, ?, ?, ?)');
    for (const room of ROOMS) {
      insertRoom.run(room.name, room.name_ar, room.description, room.icon);
    }
    console.log('[seed] Inserted', ROOMS.length, 'rooms');

    // Seed posts
    const insertPost = db.prepare('INSERT INTO posts (user_id, room_id, content) VALUES (?, ?, ?)');

    for (let roomId = 1; roomId <= ROOMS.length; roomId++) {
      const roomName = ROOMS[roomId - 1].name;
      const templates = POST_TEMPLATES[roomName] || STOCKS_POSTS;

      for (let i = 0; i < templates.length; i++) {
        const userId = Math.floor(Math.random() * EGYPTIAN_NAMES.length) + 1;
        insertPost.run(userId, roomId, templates[i]);
      }
    }

    // Add some comments
    const insertComment = db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)');
    const comments = [
      'تمام كلامك صح',
      'أنا معاك في الرأي ده',
      'معلش ممكن تفصل أكتر؟',
      'ربنا يباركلك',
      'الحمد لله دي سارة',
      'أحسنت، تحليل كويس',
      'متفق معاك',
      'ده الكلام الصح',
      'شكراً على المعلومة',
      'ربنا يوفقك'
    ];

    for (let i = 0; i < 50; i++) {
      const postId = Math.floor(Math.random() * 50) + 1;
      const userId = Math.floor(Math.random() * EGYPTIAN_NAMES.length) + 1;
      const comment = comments[Math.floor(Math.random() * comments.length)];
      insertComment.run(postId, userId, comment);
    }

    // Close database connection
    db.close();

    const totalPosts = Object.values(POST_TEMPLATES).reduce((a, b) => a + b.length, 0);

    return NextResponse.json({
      success: true,
      message: 'Database seeded successfully',
      users: EGYPTIAN_NAMES.length,
      rooms: ROOMS.length,
      posts: totalPosts
    });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
