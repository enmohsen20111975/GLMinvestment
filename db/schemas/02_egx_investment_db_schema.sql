-- =====================================================
-- egx_investment.db Schema (Heavy Database)
-- Used for: price charts, deep analysis, AI recommendations
-- ~55MB with historical data
-- =====================================================

-- Stock price history (main data table)
CREATE TABLE IF NOT EXISTS stock_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    open_price REAL DEFAULT 0,
    high_price REAL DEFAULT 0,
    low_price REAL DEFAULT 0,
    close_price REAL DEFAULT 0,
    volume INTEGER DEFAULT 0,
    adjusted_close REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(stock_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sph_stock_date ON stock_price_history(stock_id, date);
CREATE INDEX IF NOT EXISTS idx_sph_date ON stock_price_history(date);

-- Deep insight snapshots (AI analysis cache)
CREATE TABLE IF NOT EXISTS stock_deep_insight_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    insights_payload TEXT,
    fetched_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sdis_ticker ON stock_deep_insight_snapshots(ticker, fetched_at DESC);

-- Gold price history
CREATE TABLE IF NOT EXISTS gold_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    karat TEXT NOT NULL,
    price_per_gram REAL NOT NULL,
    change REAL,
    currency TEXT DEFAULT 'EGP',
    recorded_at TEXT,
    source TEXT DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_gph_karat ON gold_price_history(karat);
CREATE INDEX IF NOT EXISTS idx_gph_date ON gold_price_history(recorded_at);

-- =====================================================
-- SELF-LEARNING TABLES (Phase 2)
-- =====================================================

-- Signal logs - تسجيل الإشارات
CREATE TABLE IF NOT EXISTS signal_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    stock_id INTEGER,
    signal_date TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('buy', 'sell')),
    indicators_used TEXT NOT NULL,
    score REAL NOT NULL,
    calculated_entry_price REAL NOT NULL,
    calculated_stop_loss REAL NOT NULL,
    calculated_target REAL NOT NULL,
    has_news INTEGER DEFAULT 0,
    news_summary TEXT,
    executed INTEGER DEFAULT 0,
    execution_reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signal_logs_ticker ON signal_logs(ticker);
CREATE INDEX IF NOT EXISTS idx_signal_logs_date ON signal_logs(signal_date);
CREATE INDEX IF NOT EXISTS idx_signal_logs_direction ON signal_logs(direction);

-- Trade logs - تسجيل الصفقات
CREATE TABLE IF NOT EXISTS trade_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER,
    ticker TEXT NOT NULL,
    stock_id INTEGER,
    direction TEXT NOT NULL CHECK(direction IN ('buy', 'sell')),
    open_date TEXT NOT NULL,
    actual_entry_price REAL NOT NULL,
    actual_stop_loss REAL NOT NULL,
    actual_target REAL NOT NULL,
    shares_count INTEGER NOT NULL,
    trade_value REAL NOT NULL,
    commission REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    spread REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (signal_id) REFERENCES signal_logs(id)
);

CREATE INDEX IF NOT EXISTS idx_trade_logs_ticker ON trade_logs(ticker);
CREATE INDEX IF NOT EXISTS idx_trade_logs_status ON trade_logs(status);
CREATE INDEX IF NOT EXISTS idx_trade_logs_open_date ON trade_logs(open_date);

-- Outcome logs - تسجيل النتائج
CREATE TABLE IF NOT EXISTS outcome_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER NOT NULL,
    close_date TEXT NOT NULL,
    actual_exit_price REAL NOT NULL,
    close_reason TEXT NOT NULL CHECK(close_reason IN ('target', 'stop_loss', 'manual', 'news', 'timeout')),
    gross_profit_loss REAL NOT NULL,
    net_profit_loss REAL NOT NULL,
    profit_loss_percent REAL NOT NULL,
    days_open INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (trade_id) REFERENCES trade_logs(id)
);

CREATE INDEX IF NOT EXISTS idx_outcome_logs_trade ON outcome_logs(trade_id);
CREATE INDEX IF NOT EXISTS idx_outcome_logs_close_reason ON outcome_logs(close_reason);

-- Context logs - تسجيل البيئة المحيطة بالصفقة
CREATE TABLE IF NOT EXISTS context_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER NOT NULL,
    egx30_state TEXT NOT NULL CHECK(egx30_state IN ('BULL', 'BEAR', 'RANGE')),
    egx30_adx REAL DEFAULT 0,
    official_usd_rate REAL DEFAULT 0,
    parallel_usd_rate REAL DEFAULT 0,
    usd_gap_percent REAL DEFAULT 0,
    egx30_volume REAL DEFAULT 0,
    egx30_avg_volume REAL DEFAULT 0,
    liquidity_ratio REAL DEFAULT 1,
    is_dividend_season INTEGER DEFAULT 0,
    is_cbe_decision_near INTEGER DEFAULT 0,
    market_sentiment REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (trade_id) REFERENCES trade_logs(id)
);

CREATE INDEX IF NOT EXISTS idx_context_logs_trade ON context_logs(trade_id);

-- Indicator trust scores - درجات الثقة للمؤشرات الفنية
CREATE TABLE IF NOT EXISTS indicator_trust_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    indicator_name TEXT NOT NULL UNIQUE,
    current_score REAL DEFAULT 100,
    base_score REAL DEFAULT 100,
    total_signals INTEGER DEFAULT 0,
    successful_signals INTEGER DEFAULT 0,
    failed_signals INTEGER DEFAULT 0,
    consecutive_losses INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'reflection', 'disabled')),
    reflection_start TEXT,
    reflection_end TEXT,
    regime_scores TEXT DEFAULT '{}',
    last_updated TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_indicator_trust_name ON indicator_trust_scores(indicator_name);
CREATE INDEX IF NOT EXISTS idx_indicator_trust_status ON indicator_trust_scores(status);

-- Learned lessons - الدروس المستفادة من التداول
CREATE TABLE IF NOT EXISTS learned_lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_type TEXT NOT NULL CHECK(lesson_type IN ('direct', 'compound', 'environmental')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    trigger_conditions TEXT NOT NULL,
    action TEXT NOT NULL,
    confidence REAL DEFAULT 0,
    occurrences INTEGER DEFAULT 1,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'testing' CHECK(status IN ('testing', 'validated', 'rejected')),
    validation_start TEXT,
    validation_end TEXT,
    paper_trades_tested INTEGER DEFAULT 0,
    paper_trades_success INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_learned_lessons_type ON learned_lessons(lesson_type);
CREATE INDEX IF NOT EXISTS idx_learned_lessons_status ON learned_lessons(status);

-- Regime indicator weights - أوزان المؤشرات حسب طور السوق
CREATE TABLE IF NOT EXISTS regime_indicator_weights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    indicator_name TEXT NOT NULL,
    regime TEXT NOT NULL CHECK(regime IN ('BULL', 'BEAR', 'RANGE')),
    weight REAL DEFAULT 1.0,
    expectancy REAL DEFAULT 0,
    last_calculated TEXT DEFAULT (datetime('now')),
    UNIQUE(indicator_name, regime)
);

CREATE INDEX IF NOT EXISTS idx_regime_weights_indicator ON regime_indicator_weights(indicator_name);
CREATE INDEX IF NOT EXISTS idx_regime_weights_regime ON regime_indicator_weights(regime);

-- Review cycles - المراجعات الدورية للأداء
CREATE TABLE IF NOT EXISTS review_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_type TEXT NOT NULL CHECK(review_type IN ('daily', 'weekly', 'monthly', 'quarterly')),
    review_date TEXT NOT NULL,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    total_profit_loss REAL DEFAULT 0,
    win_rate REAL DEFAULT 0,
    avg_win REAL DEFAULT 0,
    avg_loss REAL DEFAULT 0,
    expectancy REAL DEFAULT 0,
    best_indicator TEXT,
    worst_indicator TEXT,
    patterns_detected INTEGER DEFAULT 0,
    lessons_learned INTEGER DEFAULT 0,
    weight_adjustments INTEGER DEFAULT 0,
    summary TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_review_cycles_type ON review_cycles(review_type);
CREATE INDEX IF NOT EXISTS idx_review_cycles_date ON review_cycles(review_date);

-- Fatal errors - الغلطة القاتلة (أخطاء كبيرة تستدعي التوقف)
CREATE TABLE IF NOT EXISTS fatal_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    error_date TEXT NOT NULL,
    trade_id INTEGER,
    error_type TEXT NOT NULL,
    loss_percent REAL NOT NULL,
    capital_impact_percent REAL NOT NULL,
    consecutive_losses INTEGER DEFAULT 0,
    trading_halted INTEGER DEFAULT 0,
    halt_reason TEXT,
    review_completed INTEGER DEFAULT 0,
    review_findings TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (trade_id) REFERENCES trade_logs(id)
);

CREATE INDEX IF NOT EXISTS idx_fatal_errors_date ON fatal_errors(error_date);
