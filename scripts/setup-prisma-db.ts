#!/usr/bin/env bun
/**
 * Setup Prisma Database
 * ======================
 * 
 * ينشئ قاعدة بيانات جديدة لـ Prisma (auth.db)
 * ويضيف جداول المستخدمين والحسابات
 */

import { Database } from 'bun:sqlite';
import { existsSync, copyFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const DB_DIR = './db';

console.log('===========================================');
console.log('  Setup Prisma Database');
console.log('===========================================\n');

// Create auth.db for Prisma
const authDbPath = join(DB_DIR, 'auth.db');
const customDbPath = join(DB_DIR, 'stocks.db');

console.log('📦 Creating auth.db for Prisma...\n');

const authDb = new Database(authDbPath);

// Create User table
authDb.run(`
  CREATE TABLE IF NOT EXISTS User (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    username TEXT UNIQUE,
    name TEXT,
    image TEXT,
    password_hash TEXT,
    subscription_tier TEXT DEFAULT 'free',
    default_risk_tolerance TEXT DEFAULT 'medium',
    is_active INTEGER DEFAULT 1,
    email_verified TEXT,
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Create Account table
authDb.run(`
  CREATE TABLE IF NOT EXISTS Account (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    providerAccountId TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TEXT,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    session_state TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
  )
`);
authDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider ON Account(provider, providerAccountId)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_account_userId ON Account(userId)');

// Create ApiToken table
authDb.run(`
  CREATE TABLE IF NOT EXISTS ApiToken (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    name TEXT,
    device_info TEXT,
    ip_address TEXT,
    expires_at TEXT NOT NULL,
    last_used TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_apitoken_token ON ApiToken(token)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_apitoken_user_id ON ApiToken(user_id)');

// Create PortfolioPosition table
authDb.run(`
  CREATE TABLE IF NOT EXISTS PortfolioPosition (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    stock_symbol TEXT NOT NULL,
    shares REAL NOT NULL,
    avg_cost REAL NOT NULL,
    current_price REAL,
    total_invested REAL,
    entry_date TEXT,
    exit_date TEXT,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    avg_down_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE,
    UNIQUE(user_id, stock_symbol)
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_portfolio_user_id ON PortfolioPosition(user_id)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_portfolio_stock_symbol ON PortfolioPosition(stock_symbol)');

// Create SubscriptionPlan table
authDb.run(`
  CREATE TABLE IF NOT EXISTS SubscriptionPlan (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    price REAL DEFAULT 0,
    duration_days INTEGER DEFAULT 30,
    features TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Create UserSubscription table
authDb.run(`
  CREATE TABLE IF NOT EXISTS UserSubscription (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    plan_id TEXT,
    status TEXT DEFAULT 'active',
    start_date TEXT DEFAULT (datetime('now')),
    end_date TEXT,
    auto_renew INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES SubscriptionPlan(id)
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_usersub_user_id ON UserSubscription(user_id)');

// Create UserPoints table
authDb.run(`
  CREATE TABLE IF NOT EXISTS UserPoints (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    total_points INTEGER DEFAULT 0,
    available_points INTEGER DEFAULT 0,
    spent_points INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    experience INTEGER DEFAULT 0,
    posts_points INTEGER DEFAULT 0,
    referral_points INTEGER DEFAULT 0,
    purchase_points INTEGER DEFAULT 0,
    bonus_points INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_userpoints_user_id ON UserPoints(user_id)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_userpoints_level ON UserPoints(level)');

// Create UserPost table
authDb.run(`
  CREATE TABLE IF NOT EXISTS UserPost (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    direction TEXT NOT NULL,
    entry_price REAL,
    target_price REAL,
    stop_loss REAL,
    timeframe TEXT,
    reasoning TEXT,
    confidence REAL DEFAULT 0.5,
    status TEXT DEFAULT 'active',
    outcome TEXT,
    actual_result REAL,
    verified_at TEXT,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    points_earned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_userpost_user_id ON UserPost(user_id)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_userpost_ticker ON UserPost(ticker)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_userpost_status ON UserPost(status)');

// Create PostLike table
authDb.run(`
  CREATE TABLE IF NOT EXISTS PostLike (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES UserPost(id) ON DELETE CASCADE,
    UNIQUE(post_id, user_id)
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_postlike_post_id ON PostLike(post_id)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_postlike_user_id ON PostLike(user_id)');

// Create PostComment table
authDb.run(`
  CREATE TABLE IF NOT EXISTS PostComment (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES UserPost(id) ON DELETE CASCADE
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_postcomment_post_id ON PostComment(post_id)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_postcomment_user_id ON PostComment(user_id)');

// Create PointsTransaction table
authDb.run(`
  CREATE TABLE IF NOT EXISTS PointsTransaction (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    type TEXT NOT NULL,
    source TEXT,
    reference_id TEXT,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES UserPoints(id) ON DELETE CASCADE
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_pointstransaction_user_id ON PointsTransaction(user_id)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_pointstransaction_type ON PointsTransaction(type)');

// Create InstaPayPayment table
authDb.run(`
  CREATE TABLE IF NOT EXISTS InstaPayPayment (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'EGP',
    points_amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    instapay_ref TEXT,
    sender_name TEXT,
    sender_phone TEXT,
    verified_by TEXT,
    verified_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_instapay_user_id ON InstaPayPayment(user_id)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_instapay_status ON InstaPayPayment(status)');

// Create Watchlist table
authDb.run(`
  CREATE TABLE IF NOT EXISTS Watchlist (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    stock_id INTEGER NOT NULL,
    alert_price_above REAL,
    alert_price_below REAL,
    alert_change_percent REAL,
    notes TEXT,
    purchase_price REAL,
    quantity INTEGER,
    added_at TEXT DEFAULT (datetime('now')),
    last_viewed TEXT,
    view_count INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE,
    UNIQUE(user_id, stock_id)
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON Watchlist(user_id)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_watchlist_stock_id ON Watchlist(stock_id)');

// Create ExpertRecommendation table
authDb.run(`
  CREATE TABLE IF NOT EXISTS ExpertRecommendation (
    id TEXT PRIMARY KEY,
    expert_name TEXT NOT NULL,
    stock_symbol TEXT NOT NULL,
    stock_name_ar TEXT,
    action TEXT NOT NULL,
    entry_price REAL NOT NULL,
    target_price REAL,
    stop_loss REAL,
    investment_target REAL,
    stop_loss_condition TEXT,
    timeframe TEXT,
    risk_level TEXT,
    notes TEXT,
    source TEXT,
    source_url TEXT,
    status TEXT DEFAULT 'PENDING',
    hit_target INTEGER DEFAULT 0,
    hit_stop_loss INTEGER DEFAULT 0,
    final_price REAL,
    profit_loss_percent REAL,
    closed_at TEXT,
    verified_at TEXT,
    recommendation_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_expertrec_expert_name ON ExpertRecommendation(expert_name)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_expertrec_stock_symbol ON ExpertRecommendation(stock_symbol)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_expertrec_status ON ExpertRecommendation(status)');

// Create ExpertTrackRecord table
authDb.run(`
  CREATE TABLE IF NOT EXISTS ExpertTrackRecord (
    id TEXT PRIMARY KEY,
    expert_name TEXT UNIQUE NOT NULL,
    total_recommendations INTEGER DEFAULT 0,
    successful_recommendations INTEGER DEFAULT 0,
    failed_recommendations INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 0,
    avg_return REAL DEFAULT 0,
    best_return REAL DEFAULT 0,
    worst_return REAL DEFAULT 0,
    last_recommendation_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_experttrack_expert_name ON ExpertTrackRecord(expert_name)');

// Create DeepSeekPrediction table
authDb.run(`
  CREATE TABLE IF NOT EXISTS DeepSeekPrediction (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    market TEXT DEFAULT 'EGX',
    signal TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    entry_price REAL NOT NULL,
    target_price REAL,
    stop_loss REAL,
    reasoning TEXT,
    indicators TEXT,
    news_summary TEXT,
    verify_date TEXT,
    verified INTEGER DEFAULT 0,
    final_price REAL,
    result TEXT,
    profit_loss_pct REAL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_deepseek_created_at ON DeepSeekPrediction(created_at)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_deepseek_verified ON DeepSeekPrediction(verified)');
authDb.run('CREATE INDEX IF NOT EXISTS idx_deepseek_symbol ON DeepSeekPrediction(symbol)');

// Create DeepSeekAccuracy table
authDb.run(`
  CREATE TABLE IF NOT EXISTS DeepSeekAccuracy (
    id TEXT PRIMARY KEY,
    period TEXT UNIQUE NOT NULL,
    total_predictions INTEGER DEFAULT 0,
    verified_predictions INTEGER DEFAULT 0,
    successful INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Create PointsSettings table
authDb.run(`
  CREATE TABLE IF NOT EXISTS PointsSettings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    points_per_post INTEGER DEFAULT 10,
    points_per_win INTEGER DEFAULT 50,
    points_per_referral INTEGER DEFAULT 100,
    points_per_view REAL DEFAULT 0.1,
    level_1_threshold INTEGER DEFAULT 0,
    level_2_threshold INTEGER DEFAULT 500,
    level_3_threshold INTEGER DEFAULT 1500,
    level_4_threshold INTEGER DEFAULT 5000,
    level_5_threshold INTEGER DEFAULT 15000,
    egp_per_100_points REAL DEFAULT 10.0,
    free_posts_per_day INTEGER DEFAULT 3,
    premium_posts_per_day INTEGER DEFAULT 10,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Create PointsPackage table
authDb.run(`
  CREATE TABLE IF NOT EXISTS PointsPackage (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    points INTEGER NOT NULL,
    price_egp REAL NOT NULL,
    bonus_points INTEGER DEFAULT 0,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    display_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
authDb.run('CREATE INDEX IF NOT EXISTS idx_pointspackage_is_active ON PointsPackage(is_active)');

console.log('✅ Created all Prisma tables in auth.db');

// Verify tables
const tables = authDb.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
console.log(`\n📊 Tables created: ${tables.length}`);
tables.forEach(t => console.log(`   - ${t.name}`));

authDb.close();

// Update .env to use auth.db
console.log('\n📝 Updating .env to use auth.db...');
console.log('   DATABASE_URL should be: file:./db/auth.db');

console.log('\n===========================================');
console.log('           Setup Complete!');
console.log('===========================================\n');

console.log('Next steps:');
console.log('  1. Update .env: DATABASE_URL="file:./db/auth.db"');
console.log('  2. Run: bunx prisma db push');
console.log('  3. Restart: pm2 restart all');

// Duplicate shebang block removed; the second copy of this script was accidentally appended to the end of the file.

const DB_DIR = './db';

console.log('===========================================');
console.log('  Setup Prisma Database');
console.log('===========================================\n');

const authDbPath = join(DB_DIR, 'auth.db');
const authDb = new Database(authDbPath);

authDb.run(`CREATE TABLE IF NOT EXISTS User (id TEXT PRIMARY KEY, email TEXT UNIQUE, username TEXT UNIQUE, name TEXT, image TEXT, password_hash TEXT, created_at TEXT DEFAULT (datetime('now')))`);
authDb.run(`CREATE TABLE IF NOT EXISTS Account (id TEXT PRIMARY KEY, userId TEXT NOT NULL, type TEXT NOT NULL, provider TEXT NOT NULL, providerAccountId TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`);
authDb.run(`CREATE TABLE IF NOT EXISTS ExpertRecommendation (id TEXT PRIMARY KEY, expert_name TEXT NOT NULL, stock_symbol TEXT NOT NULL, action TEXT NOT NULL, entry_price REAL NOT NULL, target_price REAL, stop_loss REAL, recommendation_date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`);

authDb.close();
console.log('✅ Prisma database setup complete');

