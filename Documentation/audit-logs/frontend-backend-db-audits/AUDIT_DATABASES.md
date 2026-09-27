# Database Audit Report — All SQLite Databases

**Project:** `/home/z/my-project`  
**Audit date:** 2026-09-27  
**Auditor:** Database Auditor (مساعد السكرتيرة لقواعد البيانات)  
**Task ID:** AUDIT-DB  
**Method:** READ-ONLY inspection via `better-sqlite3` + `rg` codebase grep (no writes performed).  

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| Total databases | 7 |
| Total tables (excluding sqlite_*) | 140 |
| Total rows across all DBs | 2,898,810 |
| Total size (excluding -wal/-shm) | 1231.62 MB |
| Empty tables (0 rows) | 56 |
| Tables without PRIMARY KEY | 2 |
| Stale tables (no data in last 30 days) | 27 |
| Orphan tables (no code references) | 4 |
| Big tables (>10K rows) | 16 |

### Status distribution

| Status | Count | % |
|--------|-------|---|
| ACTIVE_READ_WRITE | 99 | 70.7% |
| ACTIVE_READ_ONLY | 19 | 13.6% |
| WRITE_ONLY | 6 | 4.3% |
| ORPHAN | 4 | 2.9% |
| REFERENCED_NO_SQL | 12 | 8.6% |

### Top 5 findings

1. **`stored_analyses` is empty despite heavy code usage** — The table has 0 rows but is read from 28 files and written to by 10 files. Production analysis pipeline is not feeding it (or has been purged). Critical for UI surfaces like `ReportsView.tsx`, `auto_poster.py`, and `picks_management_routes.py`.
2. **`hunter_pick_tracking` is empty but the V2 Picks Management UI actively queries it** — Routes in `prediction_tracking_routes.py` (`SELECT * FROM hunter_pick_tracking WHERE status='pending'`) return zero rows. The pick-generation side of the V40.2 workflow is not recording any picks.
3. **`predictions.db.original` (4.9 MB) backup file** lingers in `db/` directory and is not part of the live system; should be moved to backups/. Also `custom.db` (24 KB, 0 rows in Post+User) is supposed to be removed per `src/lib/new-db.ts` comments but the file still exists.
4. **12 duplicate tables across DBs** — `stocks`, `gold_prices`, `cached_analysis`, `learned_lessons`, `portfolios`, `User`, `Post`, `ExpertRecommendation`, `egksco_price_history`, `egksco_stocks`, `telegram_news`, `user_trades` exist in 2+ DBs with different row counts, creating data-location ambiguity (Phase-4 `market.db` consolidation never completed).
5. **`price_history` (1.2M rows) data is 19 days stale** — Latest record 2026-09-07 (today=2026-09-27). The `price_history_safetynet` job may have stalled. `historical_data` table (99K rows) is even staler at 112 days old.

## 2. Database Inventory

| # | Database | Path | Size | Last Modified | Tables | Total Rows |
|---|----------|------|------|---------------|--------|------------|
| 1 | auth.db | `db/auth.db` | 208.00 KB | 2026-09-27 08:09:00 | 13 | 206 |
| 2 | custom.db | `db/custom.db` | 24.00 KB | 2026-09-27 07:51:42 | 2 | 0 |
| 3 | data_engine.db | `db/data_engine.db` | 272.46 MB | 2026-09-27 10:40:28 | 22 | 853,865 |
| 4 | intraday.db | `db/intraday.db` | 427.47 MB | 2026-09-27 08:09:02 | 5 | 600,225 |
| 5 | predictions.db | `db/predictions.db` | 224.34 MB | 2026-09-27 08:09:12 | 45 | 198,680 |
| 6 | price_history.db | `db/price_history.db` | 292.91 MB | 2026-09-27 08:09:03 | 1 | 1,206,795 |
| 7 | stocks.db | `db/stocks.db` | 14.21 MB | 2026-09-27 09:30:51 | 52 | 39,039 |

> Plus sidecar files observed in `db/`: `*.db-wal` and `*.db-shm` for each active DB (WAL mode is enabled). Backup file `predictions.db.original` (4.9 MB) also present — not part of the live system.

### DB file roles (per `vps-service/utils/db_paths.py`)

| DB | Role | Notes |
|----|------|-------|
| `stocks.db` | market (EGX + Arab stocks + screener metadata) | 14 MB, 52 tables; most active |
| `price_history.db` | canonical 25-year price history | 1.2M rows, single `price_history` table |
| `data_engine.db` | fundamentals (tab_*) + crypto/gold/silver/exchange ticks | 22 tables, 272 MB |
| `intraday.db` | tick-level intraday data | 5 tables, 428 MB; largest DB |
| `predictions.db` | predictions, lessons, AI workflow | 45 tables, 224 MB |
| `auth.db` | NextAuth users, sessions, API tokens | 13 tables, 208 KB |
| `custom.db` | (legacy Prisma DB — should be removed) | 0 rows; still on disk |

## 3. Per-Database Schema & Analysis

### 3.1 auth.db

**File:** `db/auth.db`  
**Size:** 208.00 KB  
**Last modified:** 2026-09-27T08:09:00.865Z  
**Tables:** 13  
**Total rows:** 206  

#### Table: `Account`

- **Rows:** 0
- **Columns:** 12
- **Indexes:** 2
- **Status:** ACTIVE_READ_ONLY — refs=25, reads=1, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)
```

**Indexes:**

- `sqlite_autoindex_Account_1`: (auto-index)
- `Account_provider_providerAccountId_key`: `CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId")`

**Code references:**

- Reads (1 files):
  - `src/lib/subscription-gate.ts`

---

#### Table: `ExpertRecommendation`

- **Rows:** 17
- **Columns:** 24
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=19, reads=6, writes=4
- **Latest record:** 2026-06-03 23:27:03 (via `created_at`, 115 days ago — STALE)

**Schema:**
```sql
CREATE TABLE ExpertRecommendation (
            id TEXT PRIMARY KEY,
            stock_symbol TEXT NOT NULL,
            stock_name_ar TEXT,
            expert_name TEXT NOT NULL,
            action TEXT NOT NULL,
            recommendation_type TEXT DEFAULT 'detailed',
            entry_price REAL NOT NULL,
            entry_price_from REAL,
            entry_price_to REAL,
            target_price REAL,
            target_price_2 REAL,
            investment_target REAL,
            stop_loss REAL,
            session_date TEXT,
            status TEXT DEFAULT 'PENDING',
            final_price REAL,
            profit_loss_percent REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop_loss INTEGER DEFAULT 0,
            notes TEXT,
            recommendation_date TEXT DEFAULT (datetime('now')),
            closed_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
```

**Indexes:**

- `sqlite_autoindex_ExpertRecommendation_1`: (auto-index)

**Code references:**

- Reads (6 files):
  - `src/app/api/seed-experts/route.ts`
  - `vps-service/analyzers/unified_learning_engine.py`
  - `vps-service/analyzers/expert_memory_bridge.py`
  - `vps-service/analyzers/expert_memory_v4.py`
  - `src/app/api/mobile/expert-recommendations/route.ts`
  - `src/app/api/expert-recommendations/route.ts`
- Writes (4 files):
  - `vps-service/api/telegram_routes.py`
  - `src/app/api/seed-experts/route.ts`
  - `src/app/api/expert-recommendations/route.ts`
  - `src/app/api/expert-recommendations/import/route.ts`

**Sample row:** `{"id":"exp001","stock_symbol":"BTFH","stock_name_ar":"بلتون القابضة","expert_name":"خبير السوق","action":"BUY","recommendation_type":"detailed","entry_price":3.18,"entry_price_from":3.18,"entry_price_to":3.2,"target_price":3.35,"target_price_2":3.52,"investment_target":null,"stop_loss":3.15,"session_date":null,"status":"PENDING","final_price":null,"profit_loss_percent":null,"hit_target":0,"hit_stop_loss":0,"notes":"T+1 لجلسة 3/6","recommendation_date":"2026-06-02","closed_at":null,"created_at":"2026-06-03 23:27:03","updated_at":"2026-06-03 23:27:03"}`

---

#### Table: `ExpertTrackRecord`

- **Rows:** 0
- **Columns:** 12
- **Indexes:** 2
- **Status:** REFERENCED_NO_SQL — refs=4, reads=0, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE ExpertTrackRecord (
            id TEXT PRIMARY KEY,
            expert_name TEXT NOT NULL UNIQUE,
            total_recommendations INTEGER DEFAULT 0,
            successful INTEGER DEFAULT 0,
            stopped INTEGER DEFAULT 0,
            pending INTEGER DEFAULT 0,
            success_rate REAL DEFAULT 0,
            avg_return REAL DEFAULT 0,
            best_return REAL,
            worst_return REAL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
```

**Indexes:**

- `sqlite_autoindex_ExpertTrackRecord_1`: (auto-index)
- `sqlite_autoindex_ExpertTrackRecord_2`: (auto-index)

**Code references:** ⚠️ None found — orphan table.

---

#### Table: `Post`

- **Rows:** 0
- **Columns:** 7
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=415, reads=2, writes=3
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)
```

**Indexes:**

- `sqlite_autoindex_Post_1`: (auto-index)

**Code references:**

- Reads (2 files):
  - `src/app/api/community/route.ts`
  - `src/app/api/mobile/community/route.ts`
- Writes (3 files):
  - `src/app/api/community/seed/route.ts`
  - `src/app/api/community/route.ts`
  - `src/app/api/mobile/community/route.ts`

---

#### Table: `PromoCode`

- **Rows:** 5
- **Columns:** 11
- **Indexes:** 2
- **Status:** REFERENCED_NO_SQL — refs=4, reads=0, writes=0
- **Latest record:** 2026-07-30 08:21:54 (via `created_at`, 59 days ago — STALE)

**Schema:**
```sql
CREATE TABLE PromoCode (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, max_uses INTEGER DEFAULT 1, current_uses INTEGER DEFAULT 0, expires_at DATETIME, premium_days INTEGER DEFAULT 30, plan_tier TEXT DEFAULT 'premium', is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, redeemed_by TEXT)
```

**Indexes:**

- `sqlite_autoindex_PromoCode_1`: (auto-index)
- `sqlite_autoindex_PromoCode_2`: (auto-index)

**Code references:** ⚠️ None found — orphan table.

**Sample row:** `{"id":"test_id_123","code":"TEST-FULL-VIP","max_uses":5,"current_uses":1,"expires_at":null,"premium_days":30,"plan_tier":"developer","is_active":1,"created_at":"2026-07-30 08:21:48","updated_at":"2026-07-30 08:21:48","redeemed_by":"user_test_456"}`

---

#### Table: `Session`

- **Rows:** 0
- **Columns:** 4
- **Indexes:** 2
- **Status:** ACTIVE_READ_ONLY — refs=117, reads=2, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)
```

**Indexes:**

- `sqlite_autoindex_Session_1`: (auto-index)
- `Session_sessionToken_key`: `CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken")`

**Code references:**

- Reads (2 files):
  - `src/app/api/money/route.ts`
  - `src/app/api/google-play/verify-receipt/route.ts`

---

#### Table: `SubscriptionPlan`

- **Rows:** 3
- **Columns:** 17
- **Indexes:** 2
- **Status:** REFERENCED_NO_SQL — refs=17, reads=0, writes=0
- **Latest record:** 2026-04-29 20:50:22 (via `created_at`, 150 days ago — STALE)

**Schema:**
```sql
CREATE TABLE SubscriptionPlan (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    price_yearly REAL,
    trial_days INTEGER NOT NULL DEFAULT 0,
    features TEXT NOT NULL,
    max_watchlist INTEGER NOT NULL DEFAULT 5,
    max_portfolio INTEGER NOT NULL DEFAULT 3,
    max_alerts INTEGER NOT NULL DEFAULT 10,
    ai_analysis INTEGER NOT NULL DEFAULT 0,
    deep_analysis INTEGER NOT NULL DEFAULT 0,
    priority_support INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

**Indexes:**

- `sqlite_autoindex_SubscriptionPlan_1`: (auto-index)
- `sqlite_autoindex_SubscriptionPlan_2`: (auto-index)

**Code references:** ⚠️ None found — orphan table.

**Sample row:** `{"id":"free","name":"free","name_ar":"مجانى","price":0,"price_yearly":0,"trial_days":30,"features":"[\"\\u0628\\u064a\\u0627\\u0646\\u0627\\u062a \\u0627\\u0644\\u0633\\u0648\\u0642 \\u0627\\u0644\\u0623\\u0633\\u0627\\u0633\\u064a\\u0629\", \"5 \\u0623\\u0633\\u0647\\u0645 \\u0641\\u064a \\u0642\\u0627\\u0626\\u0645\\u0629 \\u0627\\u0644\\u0645\\u0631\\u0627\\u0642\\u0628\\u0629\", \"\\u0645\\u062d\\u0641\\u0638\\u0629 \\u0627\\u0633\\u062a\\u062b\\u0645\\u0627\\u0631\\u064a\\u0629 \\u0648\\u0627\\u062d\\u062f\\u0629\", \"3 \\u062a\\u0646\\u0628\\u064a\\u0647\\u0627\\u062a \\u064a\\u0648\\u06…`

---

#### Table: `User`

- **Rows:** 100
- **Columns:** 16
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=235, reads=33, writes=13
- **Latest record:** 2026-07-30 09:23:58 (via `created_at`, 59 days ago — STALE)

**Schema:**
```sql
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "username" TEXT,
    "password_hash" TEXT,
    "image" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "subscription_tier" TEXT NOT NULL DEFAULT 'free',
    "default_risk_tolerance" TEXT NOT NULL DEFAULT 'medium',
    "last_login" DATETIME,
    "email_verified" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
, trial_ends_at DATETIME, trial_warning_sent_at DATETIME, trial_deletion_scheduled_at DATETIME)
```

**Indexes:**

- `sqlite_autoindex_User_1`: (auto-index)
- `User_email_key`: `CREATE UNIQUE INDEX "User_email_key" ON "User"("email")`
- `User_username_key`: `CREATE UNIQUE INDEX "User_username_key" ON "User"("username")`

**Code references:**

- Reads (33 files):
  - `vps-service/jobs/market_scheduler.py`
  - `vps-service/api/portfolio_routes.py`
  - `vps-service/ai/trade_recorder.py`
  - `vps-service/analyzers/smart_portfolio_monitor.py`
  - `src/app/api/watchlist/route.ts`
  - `src/app/api/watchlist/[id]/route.ts`
  - … +23 more
- Writes (13 files):
  - `vps-service/jobs/market_scheduler.py`
  - `vps-service/api/analytics.py`
  - `vps-service/api/portfolio_routes.py`
  - `vps-service/ai/trade_recorder.py`
  - `src/app/api/watchlist/route.ts`
  - `src/app/api/watchlist/[id]/route.ts`
  - … +3 more

**Sample row:** `{"id":"cmo8o12ix0000jqfcl9mbsi1s","email":"enmohsen2011975@gmail.com","name":"Admin","username":"admin","password_hash":"$2b$12$CnSYqqAbQeT80pVIzDIxnuKbN6MocE8.SNzdTZkEZbxpj0MpcDvGq","image":null,"is_active":1,"subscription_tier":"premium","default_risk_tolerance":"medium","last_login":null,"email_verified":null,"created_at":1776778476298,"updated_at":1776778476298,"trial_ends_at":null,"trial_warning_sent_at":null,"trial_deletion_scheduled_at":null}`

---

#### Table: `UserSubscription`

- **Rows:** 0
- **Columns:** 12
- **Indexes:** 2
- **Status:** REFERENCED_NO_SQL — refs=19, reads=0, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE UserSubscription (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    plan_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    trial_started_at TEXT,
    trial_ends_at TEXT,
    auto_renew INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (plan_id) REFERENCES SubscriptionPlan(id)
)
```

**Indexes:**

- `sqlite_autoindex_UserSubscription_1`: (auto-index)
- `sqlite_autoindex_UserSubscription_2`: (auto-index)

**Code references:** ⚠️ None found — orphan table.

---

#### Table: `VerificationToken`

- **Rows:** 0
- **Columns:** 3
- **Indexes:** 2
- **Status:** ORPHAN — refs=0, reads=0, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
)
```

**Indexes:**

- `VerificationToken_token_key`: `CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token")`
- `VerificationToken_identifier_token_key`: `CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token")`

**Code references:** ⚠️ None found — orphan table.

---

#### Table: `api_tokens`

- **Rows:** 6
- **Columns:** 9
- **Indexes:** 4
- **Status:** ACTIVE_READ_WRITE — refs=7, reads=2, writes=3
- **Latest record:** 2026-08-18T12:52:04.715Z (via `created_at`, 39 days ago — STALE)

**Schema:**
```sql
CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    device_info TEXT,
    ip_address TEXT,
    name TEXT,
    expires_at TEXT NOT NULL,
    last_used TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE
  )
```

**Indexes:**

- `sqlite_autoindex_api_tokens_1`: (auto-index)
- `sqlite_autoindex_api_tokens_2`: (auto-index)
- `idx_api_tokens_user_id`: `CREATE INDEX idx_api_tokens_user_id ON api_tokens(user_id)`
- `idx_api_tokens_token`: `CREATE INDEX idx_api_tokens_token ON api_tokens(token)`

**Code references:**

- Reads (2 files):
  - `src/app/api/admin/fix-dates/route.ts`
  - `src/lib/token-helper.ts`
- Writes (3 files):
  - `src/app/api/auth/google-signin/route.ts`
  - `src/app/api/auth/google/route.ts`
  - `src/app/api/auth/login/route.ts`

**Sample row:** `{"id":"7bf1d7d3-4d93-44ed-80c2-f4e7cf3fb82e","user_id":"48457b7f-40f2-4a7e-8955-d4d2cd1d79bd","token":"SCRUBBED","device_info":"Dart/3.11 (dart:io)","ip_address":null,"name":null,"expires_at":"2026-07-18T22:53:48.615Z","last_used":null,"created_at":"2026-06-18T22:53:48.615Z"}`

---

#### Table: `task_runs`

- **Rows:** 75
- **Columns:** 6
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=1, writes=1
- **Latest record:** 2026-07-12 12:58:10 (via `created_at`, 76 days ago — STALE)

**Schema:**
```sql
CREATE TABLE task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        last_run DATETIME NOT NULL,
        status TEXT DEFAULT 'completed',
        result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
```

**Indexes:**

- `sqlite_autoindex_task_runs_1`: (auto-index)

**Code references:**

- Reads (1 files):
  - `src/lib/scheduler/index.ts`
- Writes (1 files):
  - `src/lib/scheduler/index.ts`

**Sample row:** `{"id":"egx_predictions_1780267747360","task_id":"egx_predictions","last_run":1780267747360,"status":"completed","result":"Generated 0 predictions for egx","created_at":"2026-05-31 22:49:07"}`

---

#### Table: `user_trades`

- **Rows:** 0
- **Columns:** 10
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE user_trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                ticker TEXT NOT NULL,
                market TEXT DEFAULT 'EGX',
                trade_type TEXT,
                shares REAL,
                price REAL,
                trade_date TEXT,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
```

**Indexes:**

- `idx_user_trades_user`: `CREATE INDEX idx_user_trades_user ON user_trades(user_id)`
- `idx_user_trades_ticker`: `CREATE INDEX idx_user_trades_ticker ON user_trades(ticker)`

**Code references:**

- Reads (1 files):
  - `vps-service/ai/trade_recorder.py`
- Writes (1 files):
  - `vps-service/ai/trade_recorder.py`

---

### 3.2 custom.db

**File:** `db/custom.db`  
**Size:** 24.00 KB  
**Last modified:** 2026-09-27T07:51:42.552Z  
**Tables:** 2  
**Total rows:** 0  

#### Table: `Post`

- **Rows:** 0
- **Columns:** 7
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=415, reads=2, writes=3
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)
```

**Indexes:**

- `sqlite_autoindex_Post_1`: (auto-index)

**Code references:**

- Reads (2 files):
  - `src/app/api/community/route.ts`
  - `src/app/api/mobile/community/route.ts`
- Writes (3 files):
  - `src/app/api/community/seed/route.ts`
  - `src/app/api/community/route.ts`
  - `src/app/api/mobile/community/route.ts`

---

#### Table: `User`

- **Rows:** 0
- **Columns:** 5
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=235, reads=33, writes=13
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)
```

**Indexes:**

- `sqlite_autoindex_User_1`: (auto-index)
- `User_email_key`: `CREATE UNIQUE INDEX "User_email_key" ON "User"("email")`

**Code references:**

- Reads (33 files):
  - `vps-service/jobs/market_scheduler.py`
  - `vps-service/api/portfolio_routes.py`
  - `vps-service/ai/trade_recorder.py`
  - `vps-service/analyzers/smart_portfolio_monitor.py`
  - `src/app/api/watchlist/route.ts`
  - `src/app/api/watchlist/[id]/route.ts`
  - … +23 more
- Writes (13 files):
  - `vps-service/jobs/market_scheduler.py`
  - `vps-service/api/analytics.py`
  - `vps-service/api/portfolio_routes.py`
  - `vps-service/ai/trade_recorder.py`
  - `src/app/api/watchlist/route.ts`
  - `src/app/api/watchlist/[id]/route.ts`
  - … +3 more

---

### 3.3 data_engine.db

**File:** `db/data_engine.db`  
**Size:** 272.46 MB  
**Last modified:** 2026-09-27T10:40:28.781Z  
**Tables:** 22  
**Total rows:** 853,865  

#### Table: `btc_local_prices`

- **Rows:** 84,065
- **Columns:** 5
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=1, writes=1
- **Latest record:** 2026-09-26 19:43:21 (via `timestamp`, 0 days ago)

**Schema:**
```sql
CREATE TABLE btc_local_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            currency TEXT,
            price REAL,
            change_24h REAL,
            UNIQUE(timestamp, currency)
        )
```

**Indexes:**

- `sqlite_autoindex_btc_local_prices_1`: (auto-index)
- `idx_btc_local_prices_timestamp`: `CREATE INDEX idx_btc_local_prices_timestamp ON btc_local_prices (timestamp)`

**Code references:**

- Reads (1 files):
  - `vps-service/core/crypto_database.py`
- Writes (1 files):
  - `data_engine/scrapers/crypto_fetcher.py`

**Sample row:** `{"id":1,"timestamp":"2026-06-07 10:22:19","currency":"SAR","price":234488,"change_24h":2.9396687006141167}`

---

#### Table: `crypto_prices`

- **Rows:** 294,526
- **Columns:** 12
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=52, reads=27, writes=2
- **Latest record:** 2026-09-26 19:43:21 (via `timestamp`, 0 days ago)

**Schema:**
```sql
CREATE TABLE crypto_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            rank INTEGER,
            symbol TEXT,
            name TEXT,
            price_usd REAL,
            price_change_24h REAL,
            price_change_7d REAL,
            market_cap REAL,
            market_cap_rank INTEGER,
            total_volume REAL,
            circulating_supply REAL,
            UNIQUE(timestamp, symbol)
        )
```

**Indexes:**

- `sqlite_autoindex_crypto_prices_1`: (auto-index)
- `idx_crypto_prices_symbol`: `CREATE INDEX idx_crypto_prices_symbol ON crypto_prices (symbol)`
- `idx_crypto_prices_timestamp`: `CREATE INDEX idx_crypto_prices_timestamp ON crypto_prices (timestamp)`

**Code references:**

- Reads (27 files):
  - `data_engine/sync.py`
  - `data_engine/main.py`
  - `data_engine/intraday_storage.py`
  - `vps-service/lightweight_server.py`
  - `vps-service/jobs/v40_2_daily_generator.py`
  - `vps-service/jobs/crypto_lab_scheduler.py`
  - … +17 more
- Writes (2 files):
  - `data_engine/scrapers/crypto_fetcher.py`
  - `vps-service/scripts/fetch_crypto_historical.py`

**Sample row:** `{"id":1,"timestamp":"2026-06-26 00:09:45","rank":1,"symbol":"BTC","name":"Bitcoin","price_usd":59753,"price_change_24h":-2.01006,"price_change_7d":-4.885720039813289,"market_cap":1198056542610,"market_cap_rank":1,"total_volume":40417615811,"circulating_supply":20048137}`

---

#### Table: `egksco_price_history`

- **Rows:** 13,246
- **Columns:** 17
- **Indexes:** 3
- **Status:** ACTIVE_READ_ONLY — refs=31, reads=18, writes=0
- **Latest record:** 2026-09-08 20:35:51 (via `created_at`, 18 days ago)

**Schema:**
```sql
CREATE TABLE egksco_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price_date TEXT NOT NULL,
        open_price REAL,
        high_price REAL,
        low_price REAL,
        close_price REAL,
        volume INTEGER,
        turnover REAL,
        source TEXT DEFAULT 'egksco',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, buy_volume INTEGER, sell_volume INTEGER, delta_volume INTEGER, delta_pct REAL, pressure TEXT, market TEXT DEFAULT "EGX",
        UNIQUE(symbol, price_date, source)
    )
```

**Indexes:**

- `sqlite_autoindex_egksco_price_history_1`: (auto-index)
- `idx_egksco_ph_symbol_date`: `CREATE INDEX idx_egksco_ph_symbol_date ON egksco_price_history(symbol, price_date DESC)`
- `idx_egksco_ph_sym_date`: `CREATE UNIQUE INDEX idx_egksco_ph_sym_date ON egksco_price_history(symbol, price_date)`

**Code references:**

- Reads (18 files):
  - `vps-service/engines/v38_backtest_engine.py`
  - `vps-service/jobs/v40_2_daily_generator.py`
  - `vps-service/jobs/daily_closer.py`
  - `vps-service/jobs/learning_engine.py`
  - `vps-service/api/top_performers_routes.py`
  - `vps-service/analyzers/maestro_orchestrator.py`
  - … +8 more

**Sample row:** `{"id":1757623,"symbol":"AALR","price_date":"2026-09-08","open_price":318.16,"high_price":318,"low_price":306.12,"close_price":306.12,"volume":52953,"turnover":16209972.36,"source":"egksco","created_at":"2026-09-08 07:15:36","buy_volume":null,"sell_volume":null,"delta_volume":null,"delta_pct":null,"pressure":null,"market":"مصر"}`

---

#### Table: `egksco_stocks`

- **Rows:** 0
- **Columns:** 11
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=14, reads=8, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE egksco_stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT UNIQUE NOT NULL,
                name TEXT,
                market TEXT DEFAULT 'EGX',
                sector TEXT,
                last_price REAL,
                change REAL,
                change_percent REAL,
                volume INTEGER,
                turnover REAL,
                last_updated TEXT
            )
```

**Indexes:**

- `sqlite_autoindex_egksco_stocks_1`: (auto-index)
- `idx_egksco_symbol`: `CREATE INDEX idx_egksco_symbol ON egksco_stocks(symbol)`

**Code references:**

- Reads (8 files):
  - `vps-service/jobs/daily_closer.py`
  - `vps-service/utils/lesson_store.py`
  - `vps-service/utils/live_price.py`
  - `vps-service/api/stored_analysis_routes.py`
  - `vps-service/analyzers/stock_notebook.py`
  - `vps-service/data/analyses.py`
- Writes (1 files):
  - `vps-service/data/egksco_scraper.py`

---

#### Table: `egx_fundamentals`

- **Rows:** 0
- **Columns:** 14
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=8, reads=4, writes=2
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE egx_fundamentals (
                ticker TEXT PRIMARY KEY,
                name TEXT,
                pe_ratio REAL,
                pb_ratio REAL,
                roe REAL,
                roa REAL,
                debt_to_equity REAL,
                current_ratio REAL,
                dividend_yield REAL,
                market_cap REAL,
                shares_outstanding REAL,
                sector TEXT,
                industry TEXT,
                last_updated TEXT
            )
```

**Indexes:**

- `sqlite_autoindex_egx_fundamentals_1`: (auto-index)
- `idx_egx_fund_ticker`: `CREATE INDEX idx_egx_fund_ticker ON egx_fundamentals(ticker)`

**Code references:**

- Reads (4 files):
  - `vps-service/api/sniper_routes.py`
  - `vps-service/api/misc_routes.py`
  - `vps-service/analyzers/maestro_orchestrator.py`
  - `vps-service/data/egx_fundamental_fetcher.py`
- Writes (2 files):
  - `vps-service/data/eodhd_fetcher.py`
  - `vps-service/data/egx_fundamental_fetcher.py`

---

#### Table: `exchange_rates`

- **Rows:** 48,977
- **Columns:** 4
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=21, reads=11, writes=1
- **Latest record:** 2026-09-26 19:34:52 (via `timestamp`, 0 days ago)

**Schema:**
```sql
CREATE TABLE exchange_rates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            currency TEXT,
            rate_to_usd REAL,
            UNIQUE(timestamp, currency)
        )
```

**Indexes:**

- `sqlite_autoindex_exchange_rates_1`: (auto-index)

**Code references:**

- Reads (11 files):
  - `data_engine/sync.py`
  - `data_engine/intraday_storage.py`
  - `vps-service/analyzers/reports_engine.py`
  - `src/app/api/metals/gold/route.ts`
  - `src/lib/data-engine-db-sqljs.ts`
  - `src/lib/data-engine-db.ts`
  - … +1 more
- Writes (1 files):
  - `data_engine/scrapers/metals_forex_fetcher.py`

**Sample row:** `{"id":1,"timestamp":"2026-06-07 10:21:59","currency":"EGP","rate_to_usd":51.82}`

---

#### Table: `gold_prices`

- **Rows:** 187,153
- **Columns:** 7
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=37, reads=16, writes=1
- **Latest record:** 2026-09-26 19:34:52 (via `timestamp`, 0 days ago)

**Schema:**
```sql
CREATE TABLE gold_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            country TEXT,
            currency TEXT,
            karat TEXT,
            price_per_gram REAL,
            price_per_ounce REAL,
            UNIQUE(timestamp, country, karat)
        )
```

**Indexes:**

- `sqlite_autoindex_gold_prices_1`: (auto-index)
- `idx_gold_prices_timestamp`: `CREATE INDEX idx_gold_prices_timestamp ON gold_prices (timestamp)`

**Code references:**

- Reads (16 files):
  - `data_engine/sync.py`
  - `data_engine/main.py`
  - `data_engine/intraday_storage.py`
  - `vps-service/analyzers/reports_engine.py`
  - `vps-service/scripts/liquidity_backtest_engine.py`
  - `vps-service/scripts/dual_track_generator.py`
  - … +6 more
- Writes (1 files):
  - `data_engine/scrapers/metals_forex_fetcher.py`

**Sample row:** `{"id":1,"timestamp":"2026-06-26 00:27:18","country":"مصر","currency":"EGP","karat":"عيار 24","price_per_gram":3726.28,"price_per_ounce":115900.34998000001}`

---

#### Table: `gold_prices_clean`

- **Rows:** 31,360
- **Columns:** 8
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=7, reads=5, writes=1
- **Latest record:** 2026-09-26 19:34:52 (via `timestamp`, 0 days ago)

**Schema:**
```sql
CREATE TABLE gold_prices_clean (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        country TEXT NOT NULL,
        karat TEXT NOT NULL,
        currency TEXT NOT NULL,
        price_per_gram REAL,
        usd_rate_used REAL,
        global_ounce_usd REAL,
        UNIQUE(timestamp, country, karat, currency)
    )
```

**Indexes:**

- `sqlite_autoindex_gold_prices_clean_1`: (auto-index)
- `idx_gold_prices_clean_timestamp`: `CREATE INDEX idx_gold_prices_clean_timestamp ON gold_prices_clean (timestamp)`

**Code references:**

- Reads (5 files):
  - `data_engine/intraday_storage.py`
  - `vps-service/scripts/liquidity_backtest_engine.py`
  - `vps-service/scripts/dual_track_generator.py`
  - `src/lib/data-engine-db.ts`
  - `src/app/api/predictions/dual-track/threshold/route.ts`
- Writes (1 files):
  - `data_engine/scrapers/metals_forex_fetcher.py`

**Sample row:** `{"id":1,"timestamp":"2026-06-26 00:27:18","country":"مصر","karat":"24","currency":"EGP","price_per_gram":3838.37,"usd_rate_used":51.02,"global_ounce_usd":2340}`

---

#### Table: `historical_data`

- **Rows:** 99,076
- **Columns:** 11
- **Indexes:** 4
- **Status:** ACTIVE_READ_WRITE — refs=24, reads=13, writes=2
- **Latest record:** 2026-06-07 (via `date`, 112 days ago — STALE)

**Schema:**
```sql
CREATE TABLE historical_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT,
            name TEXT,
            market TEXT,
            date TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            last_fetch TEXT,
            UNIQUE(symbol, date)
        )
```

**Indexes:**

- `sqlite_autoindex_historical_data_1`: (auto-index)
- `idx_historical_data_symbol`: `CREATE INDEX idx_historical_data_symbol ON historical_data (symbol)`
- `idx_historical_data_date`: `CREATE INDEX idx_historical_data_date ON historical_data (date)`
- `idx_historical_data_market`: `CREATE INDEX idx_historical_data_market ON historical_data (market)`

**Code references:**

- Reads (13 files):
  - `vps-service/engines/smart_confluence_engine.py`
  - `vps-service/core/database.py`
  - `vps-service/analyzers/screener.py`
  - `vps-service/analyzers/v82_analyzer.py`
  - `vps-service/analyzers/sniper_engine.py`
  - `vps-service/data/us_stocks_fetcher.py`
  - … +3 more
- Writes (2 files):
  - `data_engine/scrapers/historical_fetcher_5years.py`
  - `vps-service/data/us_stocks_fetcher.py`

**Sample row:** `{"id":1,"symbol":"AAPL","name":"Apple Inc.","market":"الأسهم الأمريكية","date":"2026-05-06","open":281.66051049385584,"high":287.76487170009636,"low":280.8112868075762,"close":287.245361328125,"volume":58336100,"last_fetch":"2026-06-07T08:53:14.917147"}`

---

#### Table: `lost_and_found`

- **Rows:** 38
- **Columns:** 9
- **Indexes:** 0
- **Status:** ORPHAN — refs=0, reads=0, writes=0
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE lost_and_found(rootpgno INTEGER, pgno INTEGER, nfield INTEGER, id INTEGER, c0, c1, c2, c3, c4)
```

**Code references:** ⚠️ None found — orphan table.

**Sample row:** `{"rootpgno":7124,"pgno":7124,"nfield":5,"id":8619,"c0":null,"c1":"2026-07-02 19:28:15","c2":"AED","c3":225843,"c4":2.3237630897453285}`

---

#### Table: `screener_lists`

- **Rows:** 1,505
- **Columns:** 8
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=7, reads=4, writes=1
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE screener_lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT,
            list_type TEXT,
            market TEXT,
            rank INTEGER,
            symbol TEXT,
            name TEXT,
            scraped_at TEXT,
            UNIQUE(category, market, symbol)
        )
```

**Indexes:**

- `sqlite_autoindex_screener_lists_1`: (auto-index)
- `idx_screener_lists_symbol`: `CREATE INDEX idx_screener_lists_symbol ON screener_lists (symbol)`
- `idx_screener_lists_market`: `CREATE INDEX idx_screener_lists_market ON screener_lists (market)`

**Code references:**

- Reads (4 files):
  - `data_engine/scrapers/tradingview_screener_lists.py`
  - `vps-service/telegram/screener_blast.py`
  - `vps-service/analyzers/screener_integration.py`
  - `vps-service/analyzers/master_analyzer.py`
- Writes (1 files):
  - `data_engine/scrapers/tradingview_screener_lists.py`

**Sample row:** `{"id":8657,"category":"most_active","list_type":"gold","market":"مصر","rank":1,"symbol":"NIPH","name":"النيل للادوية","scraped_at":"2026-08-09 21:35:20"}`

---

#### Table: `silver_prices`

- **Rows:** 86,038
- **Columns:** 6
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=13, reads=6, writes=1
- **Latest record:** 2026-09-26 19:34:52 (via `timestamp`, 0 days ago)

**Schema:**
```sql
CREATE TABLE silver_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            country TEXT,
            currency TEXT,
            price_per_gram REAL,
            price_per_ounce REAL,
            UNIQUE(timestamp, country)
        )
```

**Indexes:**

- `sqlite_autoindex_silver_prices_1`: (auto-index)
- `idx_silver_prices_timestamp`: `CREATE INDEX idx_silver_prices_timestamp ON silver_prices (timestamp)`

**Code references:**

- Reads (6 files):
  - `data_engine/sync.py`
  - `data_engine/intraday_storage.py`
  - `src/lib/data-engine-db-sqljs.ts`
  - `src/lib/data-engine-db.ts`
  - `src/app/api/data-engine/status/route.ts`
  - `src/app/api/data-engine/control/route.ts`
- Writes (1 files):
  - `data_engine/scrapers/metals_forex_fetcher.py`

**Sample row:** `{"id":1,"timestamp":"2026-06-07 10:21:59","country":"مصر","currency":"EGP","price_per_gram":46.6494,"price_per_ounce":1450.96}`

---

#### Table: `stock_prices`

- **Rows:** 692
- **Columns:** 9
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=4, reads=2, writes=0
- **Latest record:** 2026-06-07 12:47:52 (via `timestamp`, 111 days ago — STALE)

**Schema:**
```sql
CREATE TABLE stock_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        symbol TEXT,
        name TEXT,
        price REAL,
        change_percent REAL,
        volume TEXT,
        market_cap TEXT,
        market TEXT,
        UNIQUE(timestamp, symbol)
    )
```

**Indexes:**

- `sqlite_autoindex_stock_prices_1`: (auto-index)

**Code references:**

- Reads (2 files):
  - `vps-service/telegram/telegram_interactive_bot.py`
  - `vps-service/analyzers/enhanced_prediction_tracker.py`

**Sample row:** `{"id":1,"timestamp":"2026-06-07 12:15:49","symbol":"ADCI","name":"أدكو","price":214.84,"change_percent":-0.54,"volume":"11.59 K","market_cap":"2.53 B EGP","market":"EGX"}`

---

#### Table: `stocks`

- **Rows:** 296
- **Columns:** 16
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=637, reads=288, writes=23
- **Latest record:** 2026-09-08 14:57:04 (via `last_update`, 18 days ago)

**Schema:**
```sql
CREATE TABLE stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    name TEXT,
    price REAL,
    change_percent REAL,
    volume TEXT,
    market_cap TEXT,
    market TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
, tabs_data TEXT, sector TEXT, analyst_rating TEXT, logo_url TEXT, last_update TEXT, is_active INTEGER DEFAULT 1, name_ar TEXT DEFAULT '')
```

**Indexes:**

- `idx_stocks_symbol`: `CREATE UNIQUE INDEX idx_stocks_symbol ON stocks(symbol)`
- `idx_stocks_market`: `CREATE INDEX idx_stocks_market ON stocks (market)`

**Code references:**

- Reads (288 files):
  - `data_engine/simple_server.py`
  - `data_engine/sync.py`
  - `data_engine/engine_server.py`
  - `data_engine/scrapers/fallback_chain.py`
  - `data_engine/scrapers/historical_fetcher_5years.py`
  - `data_engine/scrapers/yahoo_scraper.py`
  - … +278 more
- Writes (23 files):
  - `data_engine/sync.py`
  - `data_engine/scrapers/yahoo_scraper.py`
  - `data_engine/scrapers/tradingview_rest.py`
  - `data_engine/scrapers/egxpilot_scraper.py`
  - `data_engine/scrapers/egksco_scraper.py`
  - `data_engine/scrapers/tradingview_scraper.py`
  - … +13 more

**Sample row:** `{"id":1372444,"symbol":"AALR","name":"General Co. for Land Reclamation Development & Reconstruction","price":306.12,"change_percent":-3.784259492079463,"volume":"52953","market_cap":"2071221697.0","market":"مصر","created_at":"2026-09-08 07:13:25","tabs_data":"{\"recommendation\": 0.08787878787878788, \"rsi\": 53.17133196129608, \"rsi_prev\": 59.09653163793308, \"macd\": 8.655753133462383, \"macd_signal\": 12.816841600105302, \"change_abs\": -12.04000000000002, \"source\": \"tradingview_rest\"}","sector":"Finance","analyst_rating":null,"logo_url":null,"last_update":"2026-09-08 14:57:04","is_act…`

---

#### Table: `tab_balance_sheet`

- **Rows:** 866
- **Columns:** 14
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=17, reads=6, writes=0
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE "tab_balance_sheet" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            market TEXT NOT NULL,
            fiscal_period TEXT,
            fiscal_end TEXT,
            total_assets TEXT,
            total_liabilities TEXT,
            total_equity TEXT,
            shares_outstanding TEXT,
            shares_float TEXT,
            current_assets TEXT,
            current_liabilities TEXT,
            cash TEXT,
            debt TEXT,
            UNIQUE(symbol, market)
        )
```

**Indexes:**

- `sqlite_autoindex_tab_balance_sheet_1`: (auto-index)

**Code references:**

- Reads (6 files):
  - `vps-service/engine/stock_fundamentals.py`
  - `vps-service/api/chart_routes.py`
  - `vps-service/analyzers/maestro_orchestrator.py`
  - `vps-service/analyzers/fundamental_data_provider.py`
  - `vps-service/analyzers/fundamental_quality_gate.py`
  - `vps-service/analyzers/persona_screener.py`

**Sample row:** `{"id":4191,"symbol":"السعودية","market":"2025-Q3","fiscal_period":"2025-12-31","fiscal_end":"335.05 M SAR","total_assets":"152.35 M SAR","total_liabilities":"6.89 M SAR","total_equity":"92.4 M SAR","shares_outstanding":"63.75 M SAR","shares_float":"56.86 M SAR","current_assets":"242.65 M SAR","current_liabilities":"1.99","cash":"0.75","debt":"0.26"}`

---

#### Table: `tab_cash_flow`

- **Rows:** 866
- **Columns:** 9
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=12, reads=3, writes=0
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE "tab_cash_flow" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            market TEXT NOT NULL,
            fiscal_period TEXT,
            fiscal_end TEXT,
            operating_cf TEXT,
            investing_cf TEXT,
            financing_cf TEXT,
            free_cf TEXT,
            UNIQUE(symbol, market)
        )
```

**Indexes:**

- `sqlite_autoindex_tab_cash_flow_1`: (auto-index)

**Code references:**

- Reads (3 files):
  - `vps-service/engine/stock_fundamentals.py`
  - `vps-service/analyzers/fundamental_quality_gate.py`
  - `vps-service/analyzers/persona_screener.py`

**Sample row:** `{"id":4191,"symbol":"السعودية","market":"2025-Q3","fiscal_period":"2025-12-31","fiscal_end":"28.48 M SAR","operating_cf":"−4.5 M SAR","investing_cf":"−47.53 M SAR","financing_cf":"27.04 M SAR","free_cf":"1.76 M SAR"}`

---

#### Table: `tab_dividends`

- **Rows:** 858
- **Columns:** 11
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=22, reads=13, writes=0
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE "tab_dividends" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            market TEXT NOT NULL,
            dps_ttm TEXT,
            dps_fy TEXT,
            div_yield TEXT,
            div_yield_fwd TEXT,
            payout_ratio TEXT,
            dps_growth TEXT,
            cont_div TEXT,
            cont_div_growth TEXT,
            UNIQUE(symbol, market)
        )
```

**Indexes:**

- `sqlite_autoindex_tab_dividends_1`: (auto-index)

**Code references:**

- Reads (13 files):
  - `vps-service/jobs/fetch_corporate_actions.py`
  - `vps-service/engine/live_prediction_engine.py`
  - `vps-service/engine/stock_fundamentals.py`
  - `vps-service/engine/flow_system.py`
  - `vps-service/api/chart_routes.py`
  - `vps-service/analyzers/screener.py`
  - … +3 more

**Sample row:** `{"id":1,"symbol":"1010","market":"السعودية","dps_ttm":"1.05 SAR","dps_fy":null,"div_yield":"6.56%","div_yield_fwd":"5.25%","payout_ratio":"0.00%","dps_growth":"−17.65%","cont_div":"23","cont_div_growth":"0"}`

---

#### Table: `tab_income_statement`

- **Rows:** 866
- **Columns:** 12
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=16, reads=5, writes=0
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE "tab_income_statement" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            market TEXT NOT NULL,
            fiscal_period TEXT,
            fiscal_end TEXT,
            revenue TEXT,
            revenue_growth TEXT,
            gross_profit TEXT,
            operating_income TEXT,
            net_income TEXT,
            eps_basic TEXT,
            eps_diluted TEXT,
            UNIQUE(symbol, market)
        )
```

**Indexes:**

- `sqlite_autoindex_tab_income_statement_1`: (auto-index)

**Code references:**

- Reads (5 files):
  - `vps-service/engine/stock_fundamentals.py`
  - `vps-service/analyzers/screener.py`
  - `vps-service/analyzers/fundamental_data_provider.py`
  - `vps-service/analyzers/fundamental_quality_gate.py`
  - `vps-service/analyzers/persona_screener.py`

**Sample row:** `{"id":4191,"symbol":"السعودية","market":"2025-Q3","fiscal_period":"2025-12-31","fiscal_end":"250.68 M SAR","revenue":"−7.49%","revenue_growth":"69.34 M SAR","gross_profit":"26.92 M SAR","operating_income":"22.55 M SAR","net_income":"38.71 M SAR","eps_basic":"1.13 SAR","eps_diluted":"−8.31%"}`

---

#### Table: `tab_performance`

- **Rows:** 858
- **Columns:** 16
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=19, reads=11, writes=0
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE "tab_performance" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            market TEXT NOT NULL,
            price TEXT,
            change_percent TEXT,
            perf_1w TEXT,
            perf_1m TEXT,
            perf_3m TEXT,
            perf_6m TEXT,
            perf_ytd TEXT,
            perf_1y TEXT,
            perf_5y TEXT,
            perf_10y TEXT,
            perf_all TEXT,
            volatility_1w TEXT,
            volatility_1m TEXT,
            UNIQUE(symbol, market)
        )
```

**Indexes:**

- `sqlite_autoindex_tab_performance_1`: (auto-index)

**Code references:**

- Reads (11 files):
  - `vps-service/engine/live_prediction_engine.py`
  - `vps-service/engine/stock_fundamentals.py`
  - `vps-service/api/chart_routes.py`
  - `vps-service/analyzers/screener.py`
  - `vps-service/analyzers/maestro_orchestrator.py`
  - `vps-service/analyzers/reports_engine.py`
  - … +1 more

**Sample row:** `{"id":1,"symbol":"1010","market":"السعودية","price":"20.01 SAR","change_percent":"0.00%","perf_1w":"−2.10%","perf_1m":"−4.26%","perf_3m":"−8.00%","perf_6m":"+1.52%","perf_ytd":"−1.55%","perf_1y":"−2.09%","perf_5y":"+2.22%","perf_10y":"+142.55%","perf_all":"+132.00%","volatility_1w":"2.39%","volatility_1m":"1.15%"}`

---

#### Table: `tab_profitability`

- **Rows:** 858
- **Columns:** 13
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=27, reads=15, writes=0
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE "tab_profitability" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            market TEXT NOT NULL,
            gross_margin TEXT,
            operating_margin TEXT,
            pretax_margin TEXT,
            net_margin TEXT,
            fcf_margin TEXT,
            roa TEXT,
            roe TEXT,
            roc TEXT,
            rd_ratio TEXT,
            sga_ratio TEXT,
            UNIQUE(symbol, market)
        )
```

**Indexes:**

- `sqlite_autoindex_tab_profitability_1`: (auto-index)

**Code references:**

- Reads (15 files):
  - `vps-service/engine/live_prediction_engine.py`
  - `vps-service/engine/stock_fundamentals.py`
  - `vps-service/engine/flow_system.py`
  - `vps-service/api/chart_routes.py`
  - `vps-service/api/misc_routes.py`
  - `vps-service/analyzers/maestro_orchestrator.py`
  - … +5 more

**Sample row:** `{"id":1,"symbol":"1010","market":"السعودية","gross_margin":null,"operating_margin":"57.75%","pretax_margin":"34.25%","net_margin":"49.65%","fcf_margin":"28.83%","roa":"1.98%","roe":"15.60%","roc":"6.50%","rd_ratio":null,"sga_ratio":null}`

---

#### Table: `tab_technical_analysis`

- **Rows:** 863
- **Columns:** 13
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=18, reads=9, writes=0
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE "tab_technical_analysis" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            market TEXT NOT NULL,
            technical_rating TEXT,
            ma_rating TEXT,
            oscillators_rating TEXT,
            trend TEXT,
            momentum TEXT,
            rsi TEXT,
            macd TEXT,
            stoch TEXT,
            adx TEXT,
            atr TEXT,
            UNIQUE(symbol, market)
        )
```

**Indexes:**

- `sqlite_autoindex_tab_technical_analysis_1`: (auto-index)

**Code references:**

- Reads (9 files):
  - `vps-service/engine/live_prediction_engine.py`
  - `vps-service/engine/stock_fundamentals.py`
  - `vps-service/api/chart_routes.py`
  - `vps-service/analyzers/screener.py`
  - `vps-service/analyzers/maestro_orchestrator.py`
  - `vps-service/analyzers/reports_engine.py`

**Sample row:** `{"id":9631,"symbol":"السعودية","market":"شراء قوي","technical_rating":"شراء قوي","ma_rating":"شراء","oscillators_rating":"75.63","trend":"4.80","momentum":"1.85","rsi":"216.28","macd":"90.20","stoch":"91.83","adx":"1.07","atr":"0.91"}`

---

#### Table: `tab_valuation`

- **Rows:** 858
- **Columns:** 16
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=29, reads=18, writes=0
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE "tab_valuation" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            market TEXT NOT NULL,
            market_cap TEXT,
            market_cap_perf TEXT,
            pe_ratio TEXT,
            peg_ratio TEXT,
            ps_ratio TEXT,
            pb_ratio TEXT,
            pcf_ratio TEXT,
            pfcf_ratio TEXT,
            pcash_ratio TEXT,
            ev TEXT,
            ev_revenue TEXT,
            ev_ebit TEXT,
            ev_ebitda TEXT,
            UNIQUE(symbol, market)
        )
```

**Indexes:**

- `sqlite_autoindex_tab_valuation_1`: (auto-index)

**Code references:**

- Reads (18 files):
  - `vps-service/jobs/v40_2_daily_generator.py`
  - `vps-service/engine/live_prediction_engine.py`
  - `vps-service/engine/stock_fundamentals.py`
  - `vps-service/engine/flow_system.py`
  - `vps-service/api/chart_routes.py`
  - `vps-service/analyzers/screener.py`
  - … +8 more

**Sample row:** `{"id":1,"symbol":"1010","market":"السعودية","market_cap":"80.04 B SAR","market_cap_perf":"−5.28%","pe_ratio":"8.02","peg_ratio":"3.47","ps_ratio":"3.98","pb_ratio":"1.20","pcf_ratio":"6.68","pfcf_ratio":"8.04","pcash_ratio":null,"ev":"137.98 B SAR","ev_revenue":"4.01","ev_ebit":null,"ev_ebitda":null}`

---

### 3.4 intraday.db

**File:** `db/intraday.db`  
**Size:** 427.47 MB  
**Last modified:** 2026-09-27T08:09:02.564Z  
**Tables:** 5  
**Total rows:** 600,225  

#### Table: `commodity_intraday`

- **Rows:** 59,960
- **Columns:** 6
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=1, writes=1
- **Latest record:** 2026-09-25T17:22:14.498543 (via `timestamp`, 1 days ago)

**Schema:**
```sql
CREATE TABLE commodity_intraday (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            price REAL NOT NULL,
            change_percent REAL DEFAULT 0,
            unit TEXT,
            UNIQUE(symbol, timestamp)
        )
```

**Indexes:**

- `sqlite_autoindex_commodity_intraday_1`: (auto-index)
- `idx_comm_symbol_ts`: `CREATE INDEX idx_comm_symbol_ts ON commodity_intraday(symbol, timestamp)`
- `idx_comm_ts`: `CREATE INDEX idx_comm_ts ON commodity_intraday(timestamp)`

**Code references:**

- Reads (1 files):
  - `vps-service/analyzers/master_analyzer.py`
- Writes (1 files):
  - `data_engine/intraday_storage.py`

**Sample row:** `{"id":138711,"symbol":"GOLD_SA_16K","timestamp":"2026-08-26T16:29:35.801117","price":188.09,"change_percent":0,"unit":"SAR/gram"}`

---

#### Table: `crypto_intraday`

- **Rows:** 324,630
- **Columns:** 8
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=1, writes=1
- **Latest record:** 2026-09-25T17:26:17.451951 (via `timestamp`, 1 days ago)

**Schema:**
```sql
CREATE TABLE crypto_intraday (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            name TEXT,
            timestamp TEXT NOT NULL,
            price_usd REAL NOT NULL,
            change_24h REAL DEFAULT 0,
            volume_24h REAL DEFAULT 0,
            market_cap REAL DEFAULT 0,
            UNIQUE(symbol, timestamp)
        )
```

**Indexes:**

- `sqlite_autoindex_crypto_intraday_1`: (auto-index)
- `idx_crypto_symbol_ts`: `CREATE INDEX idx_crypto_symbol_ts ON crypto_intraday(symbol, timestamp)`
- `idx_crypto_ts`: `CREATE INDEX idx_crypto_ts ON crypto_intraday(timestamp)`

**Code references:**

- Reads (1 files):
  - `vps-service/analyzers/master_analyzer.py`
- Writes (1 files):
  - `data_engine/intraday_storage.py`

**Sample row:** `{"id":346559,"symbol":"DAI","name":"Dai","timestamp":"2026-08-26T16:02:11.817132","price_usd":0.999998,"change_24h":-0.00505,"volume_24h":253468470,"market_cap":4572355539}`

---

#### Table: `intraday_meta`

- **Rows:** 3
- **Columns:** 2
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=1, writes=1
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE intraday_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
```

**Indexes:**

- `sqlite_autoindex_intraday_meta_1`: (auto-index)

**Code references:**

- Reads (1 files):
  - `data_engine/intraday_storage.py`
- Writes (1 files):
  - `data_engine/intraday_storage.py`

**Sample row:** `{"key":"retention_days","value":"7"}`

---

#### Table: `intraday_prices`

- **Rows:** 0
- **Columns:** 9
- **Indexes:** 2
- **Status:** ACTIVE_READ_ONLY — refs=6, reads=2, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE intraday_prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                price_time TEXT NOT NULL,
                price REAL,
                volume INTEGER,
                bid REAL,
                ask REAL,
                source TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
```

**Indexes:**

- `idx_intraday_ticker_time`: `CREATE INDEX idx_intraday_ticker_time ON intraday_prices(ticker, price_time DESC)`
- `idx_intraday_time`: `CREATE INDEX idx_intraday_time ON intraday_prices(price_time DESC)`

**Code references:**

- Reads (2 files):
  - `vps-service/utils/live_price.py`
  - `vps-service/analyzers/screener_integration.py`

---

#### Table: `stock_intraday`

- **Rows:** 215,632
- **Columns:** 10
- **Indexes:** 4
- **Status:** ACTIVE_READ_WRITE — refs=28, reads=24, writes=2
- **Latest record:** 2026-09-01T11:57:11.915677 (via `timestamp`, 26 days ago)

**Schema:**
```sql
CREATE TABLE stock_intraday (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT,
            timestamp TEXT NOT NULL,
            price REAL NOT NULL,
            change_percent REAL DEFAULT 0,
            volume INTEGER DEFAULT 0,
            open REAL DEFAULT 0,
            high REAL DEFAULT 0,
            low REAL DEFAULT 0,
            UNIQUE(ticker, timestamp)
        )
```

**Indexes:**

- `sqlite_autoindex_stock_intraday_1`: (auto-index)
- `idx_stock_ticker_ts`: `CREATE INDEX idx_stock_ticker_ts ON stock_intraday(ticker, timestamp)`
- `idx_stock_ts`: `CREATE INDEX idx_stock_ts ON stock_intraday(timestamp)`
- `idx_stock_market`: `CREATE INDEX idx_stock_market ON stock_intraday(market)`

**Code references:**

- Reads (24 files):
  - `data_engine/intraday_storage.py`
  - `vps-service/jobs/v40_2_intraday_scanner.py`
  - `vps-service/jobs/daily_closer.py`
  - `vps-service/jobs/market_scheduler.py`
  - `vps-service/jobs/intraday_aggregator.py`
  - `vps-service/jobs/hot_candidate_detector.py`
  - … +14 more
- Writes (2 files):
  - `data_engine/intraday_storage.py`
  - `vps-service/scripts/backfill_intraday.py`

**Sample row:** `{"id":187933737,"ticker":"9593","market":"السعودية","timestamp":"2026-08-27T06:06:12.408640","price":21.79,"change_percent":0,"volume":50,"open":0,"high":0,"low":0}`

---

### 3.5 predictions.db

**File:** `db/predictions.db`  
**Size:** 224.34 MB  
**Last modified:** 2026-09-27T08:09:12.218Z  
**Tables:** 45  
**Total rows:** 198,680  

#### Table: `ExpertRecommendation`

- **Rows:** 17
- **Columns:** 24
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=19, reads=6, writes=4
- **Latest record:** 2026-06-03 23:27:03 (via `created_at`, 115 days ago — STALE)

**Schema:**
```sql
CREATE TABLE ExpertRecommendation (
            id TEXT PRIMARY KEY,
            stock_symbol TEXT NOT NULL,
            stock_name_ar TEXT,
            expert_name TEXT NOT NULL,
            action TEXT NOT NULL,
            recommendation_type TEXT DEFAULT 'detailed',
            entry_price REAL NOT NULL,
            entry_price_from REAL,
            entry_price_to REAL,
            target_price REAL,
            target_price_2 REAL,
            investment_target REAL,
            stop_loss REAL,
            session_date TEXT,
            status TEXT DEFAULT 'PENDING',
            final_price REAL,
            profit_loss_percent REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop_loss INTEGER DEFAULT 0,
            notes TEXT,
            recommendation_date TEXT DEFAULT (datetime('now')),
            closed_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
```

**Indexes:**

- `sqlite_autoindex_ExpertRecommendation_1`: (auto-index)

**Code references:**

- Reads (6 files):
  - `src/app/api/seed-experts/route.ts`
  - `vps-service/analyzers/unified_learning_engine.py`
  - `vps-service/analyzers/expert_memory_bridge.py`
  - `vps-service/analyzers/expert_memory_v4.py`
  - `src/app/api/mobile/expert-recommendations/route.ts`
  - `src/app/api/expert-recommendations/route.ts`
- Writes (4 files):
  - `vps-service/api/telegram_routes.py`
  - `src/app/api/seed-experts/route.ts`
  - `src/app/api/expert-recommendations/route.ts`
  - `src/app/api/expert-recommendations/import/route.ts`

**Sample row:** `{"id":"exp001","stock_symbol":"BTFH","stock_name_ar":"بلتون القابضة","expert_name":"خبير السوق","action":"BUY","recommendation_type":"detailed","entry_price":3.18,"entry_price_from":3.18,"entry_price_to":3.2,"target_price":3.35,"target_price_2":3.52,"investment_target":null,"stop_loss":3.15,"session_date":null,"status":"PENDING","final_price":null,"profit_loss_percent":null,"hit_target":0,"hit_stop_loss":0,"notes":"T+1 لجلسة 3/6","recommendation_date":"2026-06-02","closed_at":null,"created_at":"2026-06-03 23:27:03","updated_at":"2026-06-03 23:27:03"}`

---

#### Table: `aiPrediction`

- **Rows:** 2,589
- **Columns:** 24
- **Indexes:** 5
- **Status:** ACTIVE_READ_WRITE — refs=22, reads=6, writes=3
- **Latest record:** 2026-09-09 01:39:10 (via `updated_at`, 18 days ago)

**Schema:**
```sql
CREATE TABLE aiPrediction (
                    id TEXT PRIMARY KEY,
                    stock_symbol TEXT NOT NULL,
                    stock_name_ar TEXT,
                    maestro_score REAL DEFAULT 50,
                    confidence REAL DEFAULT 50,
                    signal_type TEXT DEFAULT 'BUY',
                    entry_price REAL NOT NULL,
                    target_price REAL,
                    stop_loss REAL,
                    regime TEXT,
                    phase_scores TEXT,
                    prediction_date TEXT NOT NULL,
                    status TEXT DEFAULT 'PENDING',
                    final_price REAL,
                    profit_loss_percent REAL,
                    hit_target INTEGER DEFAULT 0,
                    hit_stop_loss INTEGER DEFAULT 0,
                    days_to_target INTEGER,
                    signal_source_id TEXT,
                    notes TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT
                , risk_reward REAL DEFAULT 0, market TEXT DEFAULT "EGX")
```

**Indexes:**

- `sqlite_autoindex_aiPrediction_1`: (auto-index)
- `idx_symbol`: `CREATE INDEX idx_symbol ON aiPrediction(stock_symbol)`
- `idx_date`: `CREATE INDEX idx_date ON aiPrediction(prediction_date)`
- `idx_status`: `CREATE INDEX idx_status ON aiPrediction(status)`
- `idx_score`: `CREATE INDEX idx_score ON aiPrediction(maestro_score)`

**Code references:**

- Reads (6 files):
  - `vps-service/api/v2_routes.py`
  - `vps-service/api/stock_analysis_routes.py`
  - `vps-service/api/ai_predictions_routes.py`
  - `vps-service/analyzers/market_daily_report.py`
  - `vps-service/scripts/close_predictions.py`
  - `vps-service/scripts/publish_today_picks.py`
- Writes (3 files):
  - `vps-service/api/confluence_routes.py`
  - `vps-service/api/ai_predictions_routes.py`
  - `vps-service/scripts/publish_today_picks.py`

**Sample row:** `{"id":"2091deab-9aed-486d-b1b0-41c0113ecfe8","stock_symbol":"FAIT","stock_name_ar":"FAIT","maestro_score":62,"confidence":62,"signal_type":"BUY","entry_price":36.86,"target_price":37.03,"stop_loss":34.4924,"regime":"range","phase_scores":"{\"rsi\": null, \"rsi_signal\": null, \"macd_signal\": null, \"overall_score\": 62.0}","prediction_date":"2026-07-28","status":"TARGET_HIT","final_price":37.04999923706055,"profit_loss_percent":0.52,"hit_target":1,"hit_stop_loss":0,"days_to_target":1,"signal_source_id":null,"notes":null,"created_at":"2026-07-28T18:00:46.318117","updated_at":"2026-07-29 07:02:…`

---

#### Table: `aiPredictionStats`

- **Rows:** 1
- **Columns:** 9
- **Indexes:** 0
- **Status:** WRITE_ONLY — refs=2, reads=0, writes=1
- **Latest record:** 2026-09-07T14:46:01.316657 (via `last_updated`, 19 days ago)

**Schema:**
```sql
CREATE TABLE aiPredictionStats (
                    id INTEGER PRIMARY KEY,
                    total_predictions INTEGER DEFAULT 0,
                    successful_predictions INTEGER DEFAULT 0,
                    failed_predictions INTEGER DEFAULT 0,
                    pending_predictions INTEGER DEFAULT 0,
                    success_rate REAL DEFAULT 0,
                    avg_return REAL DEFAULT 0,
                    avg_maestro_score REAL DEFAULT 0,
                    last_updated TEXT
                )
```

**Code references:**

- Writes (1 files):
  - `vps-service/api/ai_predictions_routes.py`

**Sample row:** `{"id":1,"total_predictions":2589,"successful_predictions":23,"failed_predictions":12,"pending_predictions":33,"success_rate":65.71428571428571,"avg_return":1.3108474576271185,"avg_maestro_score":57.849895712630364,"last_updated":"2026-09-07T14:46:01.316657"}`

---

#### Table: `analysis_engine_status`

- **Rows:** 1
- **Columns:** 13
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=3, reads=2, writes=0
- **Latest record:** 2026-08-31 03:01:31 (via `updated_at`, 27 days ago)

**Schema:**
```sql
CREATE TABLE analysis_engine_status (
                id TEXT PRIMARY KEY DEFAULT 'main',
                is_running INTEGER DEFAULT 0,
                current_market TEXT,
                current_ticker TEXT,
                total_analyzed INTEGER DEFAULT 0,
                total_pending INTEGER DEFAULT 0,
                last_full_analysis DATETIME,
                last_run DATETIME,
                next_scheduled_run DATETIME,
                error_count INTEGER DEFAULT 0,
                last_error TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
```

**Indexes:**

- `sqlite_autoindex_analysis_engine_status_1`: (auto-index)

**Code references:**

- Reads (2 files):
  - `vps-service/api/stored_analysis_routes.py`
  - `vps-service/analyzers/background_analyzer.py`

**Sample row:** `{"id":"main","is_running":0,"current_market":"ALL","current_ticker":"QIBK","total_analyzed":0,"total_pending":0,"last_full_analysis":"2026-08-31T03:01:31.265035","last_run":"2026-08-31T03:01:31.265046","next_scheduled_run":"2026-08-31T04:01:31.265047","error_count":0,"last_error":null,"created_at":"2026-07-20 19:12:47","updated_at":"2026-08-31 03:01:31"}`

---

#### Table: `analysis_jobs`

- **Rows:** 0
- **Columns:** 13
- **Indexes:** 1
- **Status:** REFERENCED_NO_SQL — refs=2, reads=0, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE analysis_jobs (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                job_type TEXT NOT NULL,
                market TEXT,
                ticker TEXT,
                status TEXT DEFAULT 'pending',
                progress REAL DEFAULT 0,
                total_items INTEGER DEFAULT 0,
                processed_items INTEGER DEFAULT 0,
                result_summary TEXT,
                error_message TEXT,
                started_at DATETIME,
                completed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
```

**Indexes:**

- `sqlite_autoindex_analysis_jobs_1`: (auto-index)

**Code references:** ⚠️ None found — orphan table.

---

#### Table: `cached_analysis`

- **Rows:** 0
- **Columns:** 18
- **Indexes:** 4
- **Status:** ACTIVE_READ_WRITE — refs=21, reads=8, writes=7
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE cached_analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT DEFAULT 'EGX',
            analysis_date TEXT,
            analysis_json TEXT,
            signal TEXT,
            confidence REAL DEFAULT 0,
            master_score REAL,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            risk_reward REAL,
            indicators TEXT,
            regime TEXT,
            regime_score REAL,
            liquidity_level TEXT,
            is_tradeable INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ticker, market, analysis_date)
        )
```

**Indexes:**

- `sqlite_autoindex_cached_analysis_1`: (auto-index)
- `idx_pcached_ticker`: `CREATE INDEX idx_pcached_ticker ON cached_analysis(ticker)`
- `idx_pcached_market`: `CREATE INDEX idx_pcached_market ON cached_analysis(market, confidence DESC)`
- `idx_pcached_date`: `CREATE INDEX idx_pcached_date ON cached_analysis(analysis_date)`

**Code references:**

- Reads (8 files):
  - `vps-service/align_production_symbols.py`
  - `vps-service/core/database.py`
  - `vps-service/api/ai_predictions_routes.py`
  - `vps-service/ai/nightly_analysis.py`
  - `vps-service/ai/hot_stocks_detector.py`
  - `vps-service/analyzers/live_indicator_engine.py`
- Writes (7 files):
  - `vps-service/jobs/v40_2_intraday_scanner.py`
  - `vps-service/align_production_symbols.py`
  - `vps-service/engine/live_prediction_engine.py`
  - `vps-service/core/database.py`
  - `vps-service/analyzers/background_analyzer.py`
  - `src/app/api/admin/db-manager/repair/route.ts`

---

#### Table: `cash_transactions`

- **Rows:** 0
- **Columns:** 8
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=1, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE cash_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        amount REAL NOT NULL,
        transaction_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    , portfolio_id INTEGER)
```

**Indexes:**

- `idx_cash_user`: `CREATE INDEX idx_cash_user ON cash_transactions(user_id)`
- `idx_cash_date`: `CREATE INDEX idx_cash_date ON cash_transactions(transaction_date)`
- `idx_ct_pid`: `CREATE INDEX idx_ct_pid ON cash_transactions(portfolio_id)`

**Code references:**

- Reads (1 files):
  - `vps-service/api/portfolio_routes.py`
- Writes (1 files):
  - `vps-service/api/portfolio_routes.py`

---

#### Table: `corporate_actions`

- **Rows:** 106
- **Columns:** 7
- **Indexes:** 4
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=2, writes=1
- **Latest record:** 2026-09-22T06:00:04.274589 (via `created_at`, 5 days ago)

**Schema:**
```sql
CREATE TABLE corporate_actions (
            id TEXT PRIMARY KEY,
            ticker TEXT,
            action_type TEXT,
            action_date TEXT,
            details TEXT,
            source TEXT,
            created_at TEXT
        )
```

**Indexes:**

- `sqlite_autoindex_corporate_actions_1`: (auto-index)
- `idx_ca_ticker`: `CREATE INDEX idx_ca_ticker ON corporate_actions(ticker)`
- `idx_ca_type`: `CREATE INDEX idx_ca_type ON corporate_actions(action_type)`
- `idx_ca_date`: `CREATE INDEX idx_ca_date ON corporate_actions(action_date)`

**Code references:**

- Reads (2 files):
  - `vps-service/jobs/fetch_corporate_actions.py`
  - `src/app/api/disclosures/company/[symbol]/route.ts`
- Writes (1 files):
  - `vps-service/jobs/fetch_corporate_actions.py`

**Sample row:** `{"id":"ipo_9156523529079420684","ticker":"EGX_GENERAL","action_type":"ipo","action_date":"2026-08-26","details":"{\"title\": \"Egyptian Stock Exchange market cap grows 56.9% year-on-year in June 2026: Cabinet\", \"url\": \"https://english.ahram.org.eg/UI/Front/Inner.aspx?NewsContentID=575341\", \"date\": \"2026-08-26T06:00:04+00:00\", \"source\": \"Ahram Online\"}","source":"duckduckgo","created_at":"2026-09-01T06:00:04.170439"}`

---

#### Table: `crypto_lessons`

- **Rows:** 0
- **Columns:** 9
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE crypto_lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, period_days INTEGER, total_closed INTEGER, win_rate REAL, loss_rate REAL, avg_pnl REAL, profit_factor REAL, by_signal TEXT, created_at TEXT DEFAULT (datetime('now')))
```

**Code references:**

- Reads (1 files):
  - `vps-service/engine/crypto_full_system.py`
- Writes (1 files):
  - `vps-service/engine/crypto_full_system.py`

---

#### Table: `crypto_predictions`

- **Rows:** 0
- **Columns:** 21
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=4, writes=3
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE crypto_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, name TEXT, price REAL, signal TEXT, signal_ar TEXT, maestro_score REAL, confidence REAL, entry_price REAL, target_price REAL, stop_loss REAL, risk_reward REAL, position_size_pct REAL, market_regime TEXT, fear_greed REAL, btc_dominance REAL, reasons TEXT, warnings TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))
```

**Code references:**

- Reads (4 files):
  - `vps-service/jobs/crypto_lab_scheduler.py`
  - `vps-service/engine/crypto_full_system.py`
  - `vps-service/scripts/test_crypto_monitor_exit.py`
  - `src/app/api/crypto-lab/predictions/route.ts`
- Writes (3 files):
  - `vps-service/jobs/crypto_lab_scheduler.py`
  - `vps-service/engine/crypto_full_system.py`
  - `vps-service/scripts/test_crypto_monitor_exit.py`

---

#### Table: `crypto_predictions_log`

- **Rows:** 151,912
- **Columns:** 16
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=6, reads=3, writes=2
- **Latest record:** 2026-09-17T06:46:01.356671Z (via `created_at`, 10 days ago)

**Schema:**
```sql
CREATE TABLE crypto_predictions_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    signal TEXT,
                    confidence REAL DEFAULT 0,
                    entry_price REAL,
                    target_price REAL,
                    stop_loss REAL,
                    analysis_json TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                , status TEXT DEFAULT 'open', exit_price REAL, exit_type TEXT, highest_price REAL, actual_return REAL, exited_at TEXT, remaining_pct REAL DEFAULT 1.0)
```

**Indexes:**

- `idx_crypto_pred_symbol_time`: `CREATE INDEX idx_crypto_pred_symbol_time ON crypto_predictions_log(symbol, created_at) `
- `idx_crypto_pred_status`: `CREATE INDEX idx_crypto_pred_status ON crypto_predictions_log(status) `

**Code references:**

- Reads (3 files):
  - `vps-service/jobs/crypto_lab_scheduler.py`
  - `vps-service/scripts/test_crypto_monitor_exit.py`
  - `src/app/api/crypto-lab/predictions/route.ts`
- Writes (2 files):
  - `vps-service/jobs/crypto_lab_scheduler.py`
  - `vps-service/scripts/test_crypto_monitor_exit.py`

**Sample row:** `{"id":1,"symbol":"BTC","signal":"SELL","confidence":30,"entry_price":63497,"target_price":66354.365,"stop_loss":61592.09,"analysis_json":"{\"symbol\": \"BTC\", \"coin_id\": \"bitcoin\", \"name\": \"Bitcoin\", \"timestamp\": \"2026-08-17T05:01:23.865565Z\", \"source\": \"coingecko\", \"current_price\": 63497.0, \"change_24h_pct\": 0.5, \"volume_24h\": 12260241563.0, \"market_cap\": 1274476076368.0, \"high_24h\": 63457.0, \"low_24h\": 62667.0, \"candles_analyzed\": 1, \"indicators\": {\"rsi\": 50.0, \"macd_line\": null, \"macd_signal\": null, \"macd_hist\": null, \"sma20\": 63497.0, \"sma50\": 6…`

---

#### Table: `equity_snapshots`

- **Rows:** 0
- **Columns:** 10
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=2, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE equity_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        total_value REAL NOT NULL DEFAULT 0,
        total_invested REAL NOT NULL DEFAULT 0,
        cash_balance REAL NOT NULL DEFAULT 0,
        pnl REAL NOT NULL DEFAULT 0,
        pnl_pct REAL NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    , portfolio_id INTEGER)
```

**Indexes:**

- `idx_equity_user_date`: `CREATE INDEX idx_equity_user_date ON equity_snapshots(user_id, snapshot_date)`
- `idx_es_pid`: `CREATE INDEX idx_es_pid ON equity_snapshots(portfolio_id)`

**Code references:**

- Reads (2 files):
  - `vps-service/api/portfolio_routes.py`
  - `vps-service/ai/portfolio_routes.py`
- Writes (1 files):
  - `vps-service/api/portfolio_routes.py`

---

#### Table: `exit_notifications`

- **Rows:** 3,932
- **Columns:** 15
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=2, writes=1
- **Latest record:** 2026-09-24 13:30:04 (via `created_at`, 2 days ago)

**Schema:**
```sql
CREATE TABLE exit_notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    prediction_id INTEGER NOT NULL,
                    ticker TEXT NOT NULL,
                    notification_type TEXT NOT NULL,
                    message TEXT,
                    current_price REAL,
                    gain_pct REAL,
                    momentum_5d REAL,
                    momentum_20d REAL,
                    sma20 REAL,
                    rsi REAL,
                    old_target REAL,
                    new_target REAL,
                    day_number INTEGER,
                    created_at TEXT DEFAULT (datetime('now','localtime')),
                    FOREIGN KEY (prediction_id) REFERENCES predictions(id)
                )
```

**Indexes:**

- `idx_exit_notif_pred`: `CREATE INDEX idx_exit_notif_pred ON exit_notifications(prediction_id) `
- `idx_exit_notif_created`: `CREATE INDEX idx_exit_notif_created ON exit_notifications(created_at DESC) `

**Code references:**

- Reads (2 files):
  - `vps-service/lightweight_server.py`
  - `vps-service/jobs/daily_closer.py`
- Writes (1 files):
  - `vps-service/jobs/daily_closer.py`

**Sample row:** `{"id":1,"prediction_id":39319,"ticker":"SPMD","notification_type":"BREAKEVEN_LOCK","message":"تم نقل الوقف لنقطة الدخول — رأس المال مضمون","current_price":0.475,"gain_pct":5.56,"momentum_5d":5.32,"momentum_20d":7.95,"sma20":0.4507,"rsi":60.31,"old_target":null,"new_target":null,"day_number":2,"created_at":"2026-08-11 12:35:03"}`

---

#### Table: `historical_trades`

- **Rows:** 13,117
- **Columns:** 17
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=1, writes=1
- **Latest record:** 2026-09-12 12:50:35 (via `created_at`, 14 days ago)

**Schema:**
```sql
CREATE TABLE historical_trades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    strategy TEXT NOT NULL,
                    buy_date TEXT NOT NULL,
                    buy_price REAL NOT NULL,
                    sell_date TEXT,
                    sell_price REAL,
                    pnl_pct REAL,
                    holding_days INTEGER,
                    outcome TEXT,
                    pattern_type TEXT,
                    market_condition TEXT,
                    rsi_at_buy REAL,
                    volume_ratio_at_buy REAL,
                    lesson_text TEXT,
                    fed_to_ai INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now'))
                )
```

**Indexes:**

- `idx_hist_ticker`: `CREATE INDEX idx_hist_ticker ON historical_trades(ticker) `
- `idx_hist_pattern`: `CREATE INDEX idx_hist_pattern ON historical_trades(pattern_type, outcome) `
- `idx_hist_strategy`: `CREATE INDEX idx_hist_strategy ON historical_trades(strategy, outcome) `

**Code references:**

- Reads (1 files):
  - `vps-service/ai/historical_trade_generator.py`
- Writes (1 files):
  - `vps-service/ai/historical_trade_generator.py`

**Sample row:** `{"id":1,"ticker":"","strategy":"support_bounce","buy_date":"2025-11-23","buy_price":10.99,"sell_date":"2025-11-25","sell_price":11.54,"pnl_pct":5,"holding_days":2,"outcome":"WIN","pattern_type":"reversal","market_condition":"sideways","rsi_at_buy":38.4,"volume_ratio_at_buy":0.7,"lesson_text":"استراتيجية support_bounce على : شراء @ 10.99 في 2025-11-23 (RSI=38, vol_ratio=0.7, market=sideways). بيع @ 11.54 بعد 2 يوم. النتيجة: WIN (+5.0%). النمط: reversal.","fed_to_ai":1,"created_at":"2026-08-01 16:25:11"}`

---

#### Table: `hunter_pick_tracking`

- **Rows:** 0
- **Columns:** 16
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=1, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE hunter_pick_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT NOT NULL,
            entry_price REAL NOT NULL,
            stop_loss REAL NOT NULL,
            target_price REAL NOT NULL,
            risk_reward REAL NOT NULL,
            pick_date TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            current_price REAL,
            verification_date TEXT,
            profit_loss_pct REAL,
            narrative TEXT,
            personas TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
```

**Indexes:**

- `idx_hpt_ticker_date`: `CREATE INDEX idx_hpt_ticker_date ON hunter_pick_tracking(ticker, pick_date) `
- `idx_hpt_market_status`: `CREATE INDEX idx_hpt_market_status ON hunter_pick_tracking(market, status) `

**Code references:**

- Reads (1 files):
  - `vps-service/api/prediction_tracking_routes.py`
- Writes (1 files):
  - `vps-service/api/prediction_tracking_routes.py`

---

#### Table: `learned_lessons`

- **Rows:** 19,464
- **Columns:** 10
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=29, reads=13, writes=5
- **Latest record:** 2026-09-25T13:40:02.157664 (via `updated_at`, 1 days ago)

**Schema:**
```sql
CREATE TABLE learned_lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_type TEXT NOT NULL,
                condition TEXT NOT NULL,
                outcome TEXT NOT NULL,
                failure_rate REAL,
                occurrences INTEGER DEFAULT 0,
                avg_return REAL,
                recommendation TEXT,
                created_at TEXT,
                updated_at TEXT
            )
```

**Indexes:**

- `idx_learned_lessons_type_created`: `CREATE INDEX idx_learned_lessons_type_created ON learned_lessons(lesson_type, created_at)`

**Code references:**

- Reads (13 files):
  - `vps-service/jobs/daily_closer.py`
  - `vps-service/jobs/learning_engine.py`
  - `vps-service/utils/win_lesson_store.py`
  - `vps-service/utils/lesson_store.py`
  - `vps-service/engine/historical_backfill_engine.py`
  - `vps-service/api/sniper_routes.py`
  - … +3 more
- Writes (5 files):
  - `vps-service/jobs/learning_engine.py`
  - `vps-service/utils/win_lesson_store.py`
  - `vps-service/utils/lesson_store.py`
  - `vps-service/engine/historical_backfill_engine.py`
  - `vps-service/scripts/build_sector_patterns.py`

**Sample row:** `{"id":1,"lesson_type":"regime_bear","condition":"market_regime=bear","outcome":"failure","failure_rate":89.2,"occurrences":804,"avg_return":11.58,"recommendation":"reduce_exposure","created_at":"2026-07-23T17:26:51.688243","updated_at":"2026-09-25T13:40:02.157664"}`

---

#### Table: `liquidity_backtest_results`

- **Rows:** 10
- **Columns:** 15
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=4, reads=2, writes=1
- **Latest record:** 2026-09-24 16:06:40 (via `created_at`, 2 days ago)

**Schema:**
```sql
CREATE TABLE liquidity_backtest_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market TEXT NOT NULL,
            ticker TEXT,
            total_signals INTEGER DEFAULT 0,
            successful_signals INTEGER DEFAULT 0,
            failed_signals INTEGER DEFAULT 0,
            hit_rate REAL DEFAULT 0,
            avg_return REAL DEFAULT 0,
            dynamic_threshold REAL DEFAULT 0,
            backtest_start TEXT,
            backtest_end TEXT,
            backtest_days INTEGER,
            qualified INTEGER DEFAULT 0,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(market, ticker, backtest_start, backtest_end)
        )
```

**Indexes:**

- `sqlite_autoindex_liquidity_backtest_results_1`: (auto-index)

**Code references:**

- Reads (2 files):
  - `vps-service/scripts/dual_track_generator.py`
  - `src/app/api/predictions/dual-track/stats/route.ts`
- Writes (1 files):
  - `vps-service/scripts/liquidity_backtest_engine.py`

**Sample row:** `{"id":1,"market":"EGX","ticker":null,"total_signals":63,"successful_signals":30,"failed_signals":33,"hit_rate":47.62,"avg_return":2.2821,"dynamic_threshold":62456094,"backtest_start":"2026-08-25","backtest_end":"2026-08-25","backtest_days":0,"qualified":0,"notes":"p75=62456094, sample=1591, fallback=False, target_return=1.5%, holding_days=5","created_at":"2026-09-24 12:58:48"}`

---

#### Table: `liquidity_dynamic_threshold`

- **Rows:** 5
- **Columns:** 8
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=6, reads=3, writes=2
- **Latest record:** 2026-09-24 16:06:40 (via `created_at`, 2 days ago)

**Schema:**
```sql
CREATE TABLE liquidity_dynamic_threshold (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market TEXT NOT NULL,
            threshold_date TEXT NOT NULL,
            threshold_value REAL NOT NULL,
            percentile_method TEXT DEFAULT 'p75',
            sample_size INTEGER DEFAULT 0,
            fallback_used INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(market, threshold_date)
        )
```

**Indexes:**

- `sqlite_autoindex_liquidity_dynamic_threshold_1`: (auto-index)

**Code references:**

- Reads (3 files):
  - `vps-service/scripts/dual_track_generator.py`
  - `src/app/api/predictions/dual-track/list/route.ts`
  - `src/app/api/predictions/dual-track/stats/route.ts`
- Writes (2 files):
  - `vps-service/scripts/liquidity_backtest_engine.py`
  - `src/app/api/predictions/dual-track/threshold/route.ts`

**Sample row:** `{"id":6,"market":"EGX","threshold_date":"2026-09-24","threshold_value":62456094,"percentile_method":"p75","sample_size":1591,"fallback_used":0,"created_at":"2026-09-24 16:00:27"}`

---

#### Table: `liquidity_signal_outcomes`

- **Rows:** 1,308
- **Columns:** 11
- **Indexes:** 1
- **Status:** WRITE_ONLY — refs=2, reads=0, writes=1
- **Latest record:** 2026-09-24 16:06:40 (via `created_at`, 2 days ago)

**Schema:**
```sql
CREATE TABLE liquidity_signal_outcomes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market TEXT NOT NULL,
            ticker TEXT,
            signal_date TEXT NOT NULL,
            entry_price REAL,
            exit_price REAL,
            return_pct REAL,
            hit INTEGER DEFAULT 0,
            holding_days INTEGER DEFAULT 5,
            threshold_used REAL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(market, ticker, signal_date)
        )
```

**Indexes:**

- `sqlite_autoindex_liquidity_signal_outcomes_1`: (auto-index)

**Code references:**

- Writes (1 files):
  - `vps-service/scripts/liquidity_backtest_engine.py`

**Sample row:** `{"id":64,"market":"US","ticker":"AAPL","signal_date":"2026-06-26","entry_price":283.78,"exit_price":312.66,"return_pct":10.1769,"hit":1,"holding_days":5,"threshold_used":7305128,"created_at":"2026-09-24 13:00:36"}`

---

#### Table: `live_ai_signals`

- **Rows:** 1,636
- **Columns:** 10
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=2, writes=1
- **Latest record:** 2026-09-16 11:27:14 (via `created_at`, 11 days ago)

**Schema:**
```sql
CREATE TABLE live_ai_signals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    decision TEXT,
                    confidence INTEGER,
                    reason TEXT,
                    narrative TEXT,
                    source TEXT,
                    indicators_json TEXT,
                    detected_at TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                )
```

**Indexes:**

- `idx_live_ai_ticker`: `CREATE INDEX idx_live_ai_ticker ON live_ai_signals(ticker)`
- `idx_live_ai_detected`: `CREATE INDEX idx_live_ai_detected ON live_ai_signals(detected_at)`

**Code references:**

- Reads (2 files):
  - `vps-service/ai/trade_recorder.py`
  - `vps-service/ai/live_ai_monitor.py`
- Writes (1 files):
  - `vps-service/ai/live_ai_monitor.py`

**Sample row:** `{"id":1,"ticker":"CLHO","decision":"BUY","confidence":85,"reason":"السهم CLHO يقع في منطقة Order Blocks (مناطق الفجوات السعرية) مع حجم تداول عالي جداً وسعر ثابت، مما يشير إلى بصمات الأموال الذكية (Smart Money Accumulation). هذا يدل على فرص شراء ممتازة. بالإضافة إلى ذلك، قياس العائد إلى المخاطرة (R/R) يشير إلى أنه مناسب للشراء في السوق الحالي.","narrative":"CLHO يقع في منطقة Order Blocks مع حجم تداول عالي جداً وسعر ثابت، مما يشير إلى بصمات الأموال الذكية (Smart Money Accumulation). هذا يدل على فرص شراء ممتازة. بالإضافة إلى ذلك، قياس العائد إلى المخاطرة (R/R) يشير إلى أنه مناسب للشراء في السوق ا…`

---

#### Table: `morning_bell_signals`

- **Rows:** 82
- **Columns:** 21
- **Indexes:** 3
- **Status:** ACTIVE_READ_ONLY — refs=2, reads=1, writes=0
- **Latest record:** 2026-08-27T13:05:31+00:00 (via `created_at`, 30 days ago — STALE)

**Schema:**
```sql
CREATE TABLE morning_bell_signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT NOT NULL DEFAULT 'EGX',
            signal_type TEXT NOT NULL DEFAULT 'MORNING_BELL',
            signal_date TEXT NOT NULL,
            watch_price REAL NOT NULL,
            entry_ref REAL,
            target_price REAL,
            stop_loss REAL,
            confidence REAL,
            evidence_count INTEGER,
            status TEXT NOT NULL DEFAULT 'WATCH',
            skip_reason TEXT,
            linked_prediction_id INTEGER,
            outcome TEXT,
            max_pct_move REAL DEFAULT 0,
            highest_price REAL,
            lowest_price REAL,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (linked_prediction_id) REFERENCES predictions(id)
        )
```

**Indexes:**

- `idx_mb_status`: `CREATE INDEX idx_mb_status ON morning_bell_signals(status)`
- `idx_mb_date`: `CREATE INDEX idx_mb_date ON morning_bell_signals(signal_date DESC)`
- `idx_mb_ticker`: `CREATE INDEX idx_mb_ticker ON morning_bell_signals(ticker, signal_date)`

**Code references:**

- Reads (1 files):
  - `src/app/api/mobile/market/morning-bell/route.ts`

**Sample row:** `{"id":1,"ticker":"1080","market":"EGX","signal_type":"MORNING_BELL","signal_date":"2026-08-26","watch_price":22.8,"entry_ref":null,"target_price":25.353300000000004,"stop_loss":21.66,"confidence":100,"evidence_count":5,"status":"SKIPPED","skip_reason":"other","linked_prediction_id":null,"outcome":null,"max_pct_move":0,"highest_price":null,"lowest_price":null,"notes":null,"created_at":"2026-08-25T17:13:58+00:00","updated_at":"2026-08-25 17:31:25"}`

---

#### Table: `optimizer_params_history`

- **Rows:** 14
- **Columns:** 9
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=1, writes=1
- **Latest record:** 2026-09-23 21:37:41 (via `created_at`, 3 days ago)

**Schema:**
```sql
CREATE TABLE optimizer_params_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    optimized_at TEXT NOT NULL,
                    window_days INTEGER DEFAULT 90,
                    regime TEXT DEFAULT 'all',
                    total INTEGER DEFAULT 0,
                    win_rate REAL DEFAULT 0,
                    profit_factor REAL DEFAULT 0,
                    params_json TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
```

**Code references:**

- Reads (1 files):
  - `vps-service/analyzers/prediction_optimizer.py`
- Writes (1 files):
  - `vps-service/analyzers/prediction_optimizer.py`

**Sample row:** `{"id":1,"optimized_at":"2026-07-22T08:23:13.885875+00:00","window_days":90,"regime":"all","total":458,"win_rate":1,"profit_factor":999,"params_json":"{\"best_min_conviction\": 3, \"best_min_rr\": 1.2, \"best_stop_atr_mult\": 2.5, \"best_target_atr_mult\": 4.0, \"window_days\": 90, \"total_predictions\": 458, \"win_rate\": 1.0, \"profit_factor\": 999.0, \"regime\": \"all\", \"last_optimized\": \"2026-07-22T08:23:13.885875+00:00\", \"regime_specific\": {\"bull\": {}, \"bear\": {}, \"range\": {}, \"regime_count\": {\"bull\": 0, \"bear\": 0, \"range\": 0, \"unknown\": 0}}}","created_at":"2026-07-2…`

---

#### Table: `persona_predictions`

- **Rows:** 1,669
- **Columns:** 25
- **Indexes:** 7
- **Status:** ACTIVE_READ_WRITE — refs=17, reads=5, writes=2
- **Latest record:** 2026-08-30T22:09:19.836079 (via `created_at`, 27 days ago)

**Schema:**
```sql
CREATE TABLE persona_predictions (
                id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                market TEXT,
                persona_type TEXT,
                signal_type TEXT,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                prediction_date TEXT,
                status TEXT DEFAULT 'PENDING',
                final_price REAL,
                profit_loss_percent REAL,
                hit_target INTEGER DEFAULT 0,
                hit_stop_loss INTEGER DEFAULT 0,
                created_at TEXT
            , persona TEXT DEFAULT 'balanced', signal TEXT, signal_ar TEXT, score REAL DEFAULT 0, confidence REAL DEFAULT 0, risk_reward REAL, rationale TEXT, rationale_ar TEXT, story_arc TEXT, analysis_json TEXT)
```

**Indexes:**

- `sqlite_autoindex_persona_predictions_1`: (auto-index)
- `idx_persona_ticker`: `CREATE INDEX idx_persona_ticker ON persona_predictions(ticker)`
- `idx_persona_type`: `CREATE INDEX idx_persona_type ON persona_predictions(persona_type)`
- `idx_persona_status`: `CREATE INDEX idx_persona_status ON persona_predictions(status)`
- `idx_persona_date`: `CREATE INDEX idx_persona_date ON persona_predictions(prediction_date)`
- `idx_persona_ticker_type`: `CREATE INDEX idx_persona_ticker_type ON persona_predictions(ticker, persona_type)`
- `idx_persona_persona`: `CREATE INDEX idx_persona_persona ON persona_predictions(persona)`

**Code references:**

- Reads (5 files):
  - `vps-service/core/persona_db.py`
  - `src/app/api/admin/close-predictions/route.ts`
  - `vps-service/scripts/persona_unify_a_measurement.py`
  - `vps-service/scripts/backfill_historical_predictions.py`
  - `vps-service/scripts/close_predictions.py`
- Writes (2 files):
  - `vps-service/core/persona_db.py`
  - `vps-service/scripts/backfill_historical_predictions.py`

**Sample row:** `{"id":"e6a7326e53d9652e8425d8baf5a609dd","ticker":"PIOH","market":"EGX","persona_type":"gambler","signal_type":"STRONG_BUY","entry_price":18.303,"target_price":23.520750000000003,"stop_loss":16.9116,"prediction_date":"2026-01-01","status":"CLOSED","final_price":18.5175,"profit_loss_percent":1.17,"hit_target":0,"hit_stop_loss":0,"created_at":"2026-08-25T23:13:12.067873","persona":"balanced","signal":null,"signal_ar":null,"score":0,"confidence":0,"risk_reward":null,"rationale":null,"rationale_ar":null,"story_arc":null,"analysis_json":null}`

---

#### Table: `platform_recommendations`

- **Rows:** 0
- **Columns:** 28
- **Indexes:** 4
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=2, writes=2
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE platform_recommendations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            name TEXT DEFAULT '',
            market TEXT NOT NULL,
            signal TEXT NOT NULL,
            confidence INTEGER DEFAULT 50,
            entry_price REAL DEFAULT 0,
            target_price REAL DEFAULT 0,
            stop_loss REAL DEFAULT 0,
            predicted_date TEXT NOT NULL,
            expiry_date TEXT NOT NULL,
            status TEXT DEFAULT 'ACTIVE',
            final_price REAL,
            profit_loss REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop INTEGER DEFAULT 0,
            technical_score INTEGER DEFAULT 50,
            fundamental_score INTEGER DEFAULT 50,
            volume_seasonal_score INTEGER DEFAULT 50,
            confluence_score INTEGER DEFAULT 50,
            rsi REAL DEFAULT 50,
            macd_signal TEXT DEFAULT 'NEUTRAL',
            pe_ratio REAL,
            roe REAL,
            technical_rating TEXT DEFAULT '',
            phase_scores TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
```

**Indexes:**

- `idx_pr_date`: `CREATE INDEX idx_pr_date ON platform_recommendations(predicted_date)`
- `idx_pr_symbol`: `CREATE INDEX idx_pr_symbol ON platform_recommendations(symbol)`
- `idx_pr_status`: `CREATE INDEX idx_pr_status ON platform_recommendations(status)`
- `idx_pr_market`: `CREATE INDEX idx_pr_market ON platform_recommendations(market)`

**Code references:**

- Reads (2 files):
  - `vps-service/engines/historical_prediction_generator.py`
  - `vps-service/align_production_symbols.py`
- Writes (2 files):
  - `vps-service/engines/historical_prediction_generator.py`
  - `vps-service/align_production_symbols.py`

---

#### Table: `portfolio_pnl_history`

- **Rows:** 0
- **Columns:** 9
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=1, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE portfolio_pnl_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        ticker TEXT,
        pnl REAL NOT NULL DEFAULT 0,
        pnl_pct REAL NOT NULL DEFAULT 0,
        record_date TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT (datetime('now'))
    , portfolio_id INTEGER)
```

**Indexes:**

- `idx_pnl_user_date`: `CREATE INDEX idx_pnl_user_date ON portfolio_pnl_history(user_id, record_date)`

**Code references:**

- Reads (1 files):
  - `vps-service/api/portfolio_routes.py`
- Writes (1 files):
  - `vps-service/api/portfolio_routes.py`

---

#### Table: `portfolio_positions`

- **Rows:** 0
- **Columns:** 7
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=1, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE portfolio_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portfolio_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        stop_loss_pct REAL NOT NULL DEFAULT 8.0,
        sector TEXT NOT NULL DEFAULT 'unknown',
        correlation_group TEXT,
        FOREIGN KEY (portfolio_id) REFERENCES portfolio_state(portfolio_id)
    )
```

**Indexes:**

- `idx_pp_portfolio`: `CREATE INDEX idx_pp_portfolio ON portfolio_positions(portfolio_id)`
- `idx_pp_pid2`: `CREATE INDEX idx_pp_pid2 ON portfolio_positions(portfolio_id)`

**Code references:**

- Reads (1 files):
  - `vps-service/api/portfolio_routes.py`
- Writes (1 files):
  - `vps-service/api/portfolio_routes.py`

---

#### Table: `portfolio_state`

- **Rows:** 0
- **Columns:** 8
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=2, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE portfolio_state (
        portfolio_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 100000,
        cash REAL NOT NULL DEFAULT 30000,
        peak_value REAL NOT NULL DEFAULT 100000,
        persona TEXT NOT NULL DEFAULT 'balanced',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
```

**Indexes:**

- `sqlite_autoindex_portfolio_state_1`: (auto-index)
- `idx_ps_pid`: `CREATE INDEX idx_ps_pid ON portfolio_state(portfolio_id)`

**Code references:**

- Reads (2 files):
  - `vps-service/portfolio/hard_protection.py`
  - `vps-service/api/portfolio_routes.py`
- Writes (1 files):
  - `vps-service/api/portfolio_routes.py`

---

#### Table: `portfolios`

- **Rows:** 4
- **Columns:** 10
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=10, reads=5, writes=2
- **Latest record:** 2026-07-22 14:04:08 (via `created_at`, 66 days ago — STALE)

**Schema:**
```sql
CREATE TABLE portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    broker TEXT DEFAULT 'manual',
    market TEXT DEFAULT 'EGX',
    currency TEXT DEFAULT 'EGP',
    is_master INTEGER DEFAULT 0,
    initial_capital REAL DEFAULT 100000,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)
```

**Indexes:**

- `idx_portfolios_user`: `CREATE INDEX idx_portfolios_user ON portfolios(user_id)`
- `idx_portfolios_user_master`: `CREATE INDEX idx_portfolios_user_master ON portfolios(user_id, is_master)`

**Code references:**

- Reads (5 files):
  - `vps-service/api/portfolio_routes.py`
  - `src/app/api/portfolio/master/route.ts`
  - `src/app/api/portfolio/smart-monitor/signals/route.ts`
  - `src/app/api/portfolio/holdings/route.ts`
  - `src/app/api/portfolio/accounts/route.ts`
- Writes (2 files):
  - `vps-service/api/portfolio_routes.py`
  - `src/app/api/portfolio/accounts/route.ts`

**Sample row:** `{"id":1,"user_id":"default","name":"المحفظة الأم","broker":"master","market":"EGX","currency":"EGP","is_master":1,"initial_capital":100000,"created_at":"2026-07-22 13:57:37","updated_at":"2026-07-22 13:57:37"}`

---

#### Table: `prediction_lessons`

- **Rows:** 4
- **Columns:** 9
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=6, reads=3, writes=2
- **Latest record:** 2026-07-30 20:11:08 (via `created_at`, 58 days ago — STALE)

**Schema:**
```sql
CREATE TABLE prediction_lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT, category TEXT, rule TEXT, evidence TEXT,
    failure_rate REAL, sample_size INTEGER, recommendation TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
```

**Code references:**

- Reads (3 files):
  - `vps-service/ai/decision_engine.py`
  - `src/app/api/predictions/honest-tracking/route.ts`
  - `src/lib/honest-tracking/maestro.ts`
- Writes (2 files):
  - `src/app/api/predictions/honest-tracking/learn-from-errors/route.ts`
  - `src/lib/honest-tracking/maestro.ts`

**Sample row:** `{"id":53,"type":"technical","category":"مؤشرات فنية","rule":"لا تشتري عند RSI مرتفع (>70)","evidence":"5 صفقة خاسرة من 107 عند RSI > 70","failure_rate":5,"sample_size":5,"recommendation":"تفعيل فلتر RSI — تجنب الشراء إذا RSI > 70 إلا في حالة Momentum Accumulation","created_at":"2026-07-30 20:11:08"}`

---

#### Table: `prediction_outcomes`

- **Rows:** 0
- **Columns:** 17
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE prediction_outcomes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        prediction_id INTEGER NOT NULL,
                        ticker TEXT NOT NULL,
                        prediction_date TEXT NOT NULL,
                        signal TEXT,
                        confidence REAL,
                        entry_price REAL,
                        price_1d_later REAL,
                        price_3d_later REAL,
                        price_5d_later REAL,
                        price_10d_later REAL,
                        return_1d REAL,
                        return_3d REAL,
                        return_5d REAL,
                        return_10d REAL,
                        outcome TEXT,
                        evaluated_at TEXT,
                        UNIQUE(prediction_id)
                    )
```

**Indexes:**

- `sqlite_autoindex_prediction_outcomes_1`: (auto-index)
- `idx_po_ticker`: `CREATE INDEX idx_po_ticker ON prediction_outcomes(ticker)`
- `idx_po_date`: `CREATE INDEX idx_po_date ON prediction_outcomes(prediction_date)`

**Code references:**

- Reads (1 files):
  - `vps-service/analyzers/feedback_loop.py`
- Writes (1 files):
  - `vps-service/analyzers/feedback_loop.py`

---

#### Table: `prediction_outcomes_old`

- **Rows:** 0
- **Columns:** 10
- **Indexes:** 0
- **Status:** REFERENCED_NO_SQL — refs=1, reads=0, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE "prediction_outcomes_old" (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prediction_id TEXT NOT NULL,
                outcome_date TEXT NOT NULL,
                exit_price REAL,
                pnl_percent REAL,
                hit_target INTEGER DEFAULT 0,
                hit_stop INTEGER DEFAULT 0,
                days_to_resolve INTEGER,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (prediction_id) REFERENCES predictions(id)
            )
```

**Code references:** ⚠️ None found — orphan table.

---

#### Table: `predictions`

- **Rows:** 1,359
- **Columns:** 67
- **Indexes:** 8
- **Status:** ACTIVE_READ_WRITE — refs=333, reads=107, writes=21
- **Latest record:** 2026-09-24 09:10:24 (via `updated_at`, 3 days ago)

**Schema:**
```sql
CREATE TABLE predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                signal TEXT NOT NULL,
                signal_type TEXT NOT NULL,
                
                prediction_date TEXT NOT NULL,
                entry_price REAL NOT NULL,
                target_price REAL,
                stop_loss REAL,
                master_score REAL,
                
                technical_score REAL DEFAULT 50,
                fundamental_score REAL DEFAULT 50,
                ai_pattern_score REAL DEFAULT 50,
                sentiment_score REAL DEFAULT 50,
                
                outcome_date TEXT,
                exit_price REAL,
                actual_return REAL,
                hit_target INTEGER DEFAULT 0,
                hit_stop INTEGER DEFAULT 0,
                is_correct INTEGER,
                
                holding_days INTEGER DEFAULT 0,
                notes TEXT,
                
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            , is_trend_following INTEGER DEFAULT 0, exit_type TEXT, trailing_stop_atr_mult REAL DEFAULT 2.5, initial_stop_atr_mult REAL DEFAULT 2.0, atr_at_entry REAL, highest_price_reached REAL, market TEXT DEFAULT 'EGX', exit_reason TEXT, risk_reward REAL, confidence REAL, lowest_price_reached REAL, stock_ticker TEXT, direction TEXT, score REAL DEFAULT 0, horizon TEXT, persona TEXT DEFAULT 'balanced', status TEXT DEFAULT 'active', pnl_percent REAL, closed_at DATETIME, analysis_json TEXT, updated_at DATETIME, signal_ar TEXT, maestro_score REAL DEFAULT 0, actual_exit_price REAL, highest_price REAL, lowest_price REAL, days_to_close INTEGER, pnl_pct REAL, data_quality TEXT, quality_flags TEXT, partial_exit_price REAL, partial_exit_date TEXT, partial_return_pct REAL, exit_policy TEXT DEFAULT 'fixed', target_price_2 REAL, explosive_score REAL DEFAULT 0, explosive_label TEXT DEFAULT '', evidence_count INTEGER DEFAULT 0, morning_bell INTEGER DEFAULT 0, kill_filter_result TEXT DEFAULT '', maker_entry_volume REAL, fuel_pct REAL, fuel_exhausted INTEGER DEFAULT 0, fuel_phase TEXT DEFAULT "", track TEXT DEFAULT 'full_analysis')
```

**Indexes:**

- `idx_predictions_ticker`: `CREATE INDEX idx_predictions_ticker ON predictions(ticker)`
- `idx_predictions_market`: `CREATE INDEX idx_predictions_market ON predictions(market)`
- `idx_predictions_date`: `CREATE INDEX idx_predictions_date ON predictions(prediction_date)`
- `idx_predictions_outcome`: `CREATE INDEX idx_predictions_outcome ON predictions(outcome_date)`
- `idx_predictions_status`: `CREATE INDEX idx_predictions_status ON predictions(outcome_date, hit_target, hit_stop)`
- `idx_predictions_created`: `CREATE INDEX idx_predictions_created ON predictions(created_at DESC)`
- `idx_predictions_signal`: `CREATE INDEX idx_predictions_signal ON predictions (signal)`
- `idx_predictions_prediction_date`: `CREATE INDEX idx_predictions_prediction_date ON predictions (prediction_date)`

**Code references:**

- Reads (107 files):
  - `vps-service/lightweight_server.py`
  - `vps-service/telegram/telegram_interactive_bot.py`
  - `vps-service/telegram/telegram_intraday_alerts.py`
  - `vps-service/telegram/telegram_chart_generator.py`
  - `vps-service/telegram/telegram_notifier.py`
  - `vps-service/telegram/telegram_morning_bell.py`
  - … +97 more
- Writes (21 files):
  - `vps-service/telegram/telegram_target_hit_tracker.py`
  - `vps-service/jobs/v40_2_daily_generator.py`
  - `vps-service/core/db_manager.py`
  - `vps-service/api/historical_predictions_v2_routes.py`
  - `vps-service/api/admin_routes.py`
  - `vps-service/api/ai_predictions_routes.py`
  - … +11 more

**Sample row:** `{"id":50214,"ticker":"MASR","signal":"BUY","signal_type":"BUY","prediction_date":"2025-09-22 12:00:00","entry_price":4.05,"target_price":44.97,"stop_loss":3.81,"master_score":100,"technical_score":100,"fundamental_score":50,"ai_pattern_score":50,"sentiment_score":50,"outcome_date":"2026-09-22","exit_price":null,"actual_return":89.63,"hit_target":1,"hit_stop":0,"is_correct":1,"holding_days":50,"notes":"persona=conservative; score=100; conf=100.0; regime=bear; sector_status=neutral; sector_role=mid; RSI=46.3; trend=BEARISH","created_at":"2025-09-22 12:00:00","is_trend_following":0,"exit_type":"m…`

---

#### Table: `quant_cache`

- **Rows:** 525
- **Columns:** 10
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=4, reads=1, writes=1
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE quant_cache (
                ticker              TEXT PRIMARY KEY,
                smfi                REAL,
                smfi_label          TEXT,
                monte_carlo_prob    REAL,
                monte_carlo_label   TEXT,
                monte_carlo_horizon INTEGER,
                smfi_bonus          REAL,
                mc_bonus            REAL,
                computed_at         TEXT,
                computed_price      REAL
            )
```

**Indexes:**

- `sqlite_autoindex_quant_cache_1`: (auto-index)

**Code references:**

- Reads (1 files):
  - `vps-service/analyzers/quant_cache.py`
- Writes (1 files):
  - `vps-service/analyzers/quant_cache.py`

**Sample row:** `{"ticker":"ACRO","smfi":57.03502041826507,"smfi_label":"MODERATE_ACCUMULATION","monte_carlo_prob":4.6,"monte_carlo_label":"VERY_LOW","monte_carlo_horizon":5,"smfi_bonus":10,"mc_bonus":-10,"computed_at":"2026-07-29 18:22:10","computed_price":102}`

---

#### Table: `reports`

- **Rows:** 0
- **Columns:** 10
- **Indexes:** 4
- **Status:** ACTIVE_READ_WRITE — refs=44, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE reports (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    date TEXT NOT NULL,
                    title TEXT,
                    content TEXT,
                    image_path TEXT,
                    status TEXT DEFAULT 'pending',
                    telegram_message_id TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    published_at TEXT
                )
```

**Indexes:**

- `sqlite_autoindex_reports_1`: (auto-index)
- `idx_reports_type`: `CREATE INDEX idx_reports_type ON reports(type)`
- `idx_reports_date`: `CREATE INDEX idx_reports_date ON reports(date)`
- `idx_reports_status`: `CREATE INDEX idx_reports_status ON reports(status)`

**Code references:**

- Reads (1 files):
  - `vps-service/analyzers/reports_engine.py`
- Writes (1 files):
  - `vps-service/analyzers/reports_engine.py`

---

#### Table: `session_event_sent_log`

- **Rows:** 0
- **Columns:** 4
- **Indexes:** 1
- **Status:** ORPHAN — refs=0, reads=0, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE session_event_sent_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            event_type TEXT NOT NULL,
            last_sent_at TEXT NOT NULL,
            UNIQUE(ticker, event_type)
        )
```

**Indexes:**

- `sqlite_autoindex_session_event_sent_log_1`: (auto-index)

**Code references:** ⚠️ None found — orphan table.

---

#### Table: `session_events`

- **Rows:** 0
- **Columns:** 15
- **Indexes:** 2
- **Status:** ORPHAN — refs=0, reads=0, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE session_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            ticker TEXT,
            market TEXT NOT NULL DEFAULT 'EGX',
            price_at_event REAL,
            ref_price REAL,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            change_pct REAL,
            priority INTEGER NOT NULL DEFAULT 5,
            message_ar TEXT NOT NULL,
            telegram_sent INTEGER DEFAULT 0,
            telegram_error TEXT,
            created_at TEXT NOT NULL
        )
```

**Indexes:**

- `idx_se_created`: `CREATE INDEX idx_se_created ON session_events(created_at DESC)`
- `idx_se_ticker_type`: `CREATE INDEX idx_se_ticker_type ON session_events(ticker, event_type, created_at)`

**Code references:** ⚠️ None found — orphan table.

---

#### Table: `sniper_performance`

- **Rows:** 26
- **Columns:** 16
- **Indexes:** 0
- **Status:** WRITE_ONLY — refs=1, reads=0, writes=1
- **Latest record:** 2026-09-25T13:40:02.164169 (via `created_at`, 1 days ago)

**Schema:**
```sql
CREATE TABLE sniper_performance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                total_predictions INTEGER,
                target_hit_count INTEGER,
                stopped_count INTEGER,
                expired_count INTEGER,
                win_rate REAL,
                avg_return REAL,
                avg_win REAL,
                avg_loss REAL,
                profit_factor REAL,
                best_ticker TEXT,
                worst_ticker TEXT,
                lessons_count INTEGER,
                created_at TEXT
            )
```

**Code references:**

- Writes (1 files):
  - `vps-service/jobs/learning_engine.py`

**Sample row:** `{"id":1,"period_start":"2026-07-16","period_end":"2026-07-23","total_predictions":27,"target_hit_count":8,"stopped_count":8,"expired_count":11,"win_rate":50,"avg_return":2.22,"avg_win":7.48,"avg_loss":4.36,"profit_factor":2.15,"best_ticker":"AIDC","worst_ticker":"2120","lessons_count":8,"created_at":"2026-07-23T17:26:51.713169"}`

---

#### Table: `stock_stories`

- **Rows:** 899
- **Columns:** 8
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=8, reads=3, writes=2
- **Latest record:** 2026-09-12 12:50:35 (via `created_at`, 14 days ago)

**Schema:**
```sql
CREATE TABLE stock_stories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                pattern_type TEXT,
                story_date TEXT,
                story_text TEXT,
                keywords TEXT,
                outcome_pct REAL,
                created_at TEXT DEFAULT (datetime('now'))
            )
```

**Code references:**

- Reads (3 files):
  - `vps-service/ai/story_generator.py`
  - `vps-service/ai/historical_trade_generator.py`
  - `vps-service/ai/decision_engine.py`
- Writes (2 files):
  - `vps-service/ai/story_generator.py`
  - `vps-service/ai/historical_trade_generator.py`

**Sample row:** `{"id":1,"ticker":"","pattern_type":"reversal","story_date":"2025-11-23","story_text":"سهم  — استراتيجية support_bounce (ارتداد). السوق كان عرضي. شراء @ 10.99 في 2025-11-23. RSI=38، حجم=0.7x. بيع @ 11.54 بعد 2 يوم. النتيجة: نجح (+5.0%).","keywords":"reversal,sideways,WIN,support_bounce","outcome_pct":5,"created_at":"2026-08-01 16:25:11"}`

---

#### Table: `stored_analyses`

- **Rows:** 0
- **Columns:** 48
- **Indexes:** 9
- **Status:** ACTIVE_READ_WRITE — refs=48, reads=28, writes=10
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE stored_analyses (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                ticker TEXT NOT NULL,
                market TEXT DEFAULT 'EGX',
                maestro_score REAL DEFAULT 0,
                recommendation TEXT DEFAULT 'hold',
                recommendation_ar TEXT,
                confidence REAL DEFAULT 0,
                entry_price REAL DEFAULT 0,
                target_price REAL,
                stop_loss REAL,
                risk_reward REAL DEFAULT 0,
                regime TEXT,
                regime_score REAL,
                regime_confidence REAL,
                timeframe_score REAL,
                timeframe_aligned INTEGER DEFAULT 0,
                timeframe_count INTEGER DEFAULT 0,
                volume_ratio REAL,
                liquidity_rating TEXT,
                news_risk_level TEXT,
                has_cbe_news INTEGER DEFAULT 0,
                analysis_json TEXT,
                analysis_type TEXT DEFAULT 'scheduled',
                analysis_version TEXT DEFAULT '2.0',
                turnover_egp REAL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, ai_decision TEXT, ai_confidence INTEGER, ai_reason TEXT, ai_narrative TEXT, ai_confidence_adjustment INTEGER, ai_raw TEXT, ai_updated_at TEXT, signal TEXT DEFAULT 'HOLD', technical_score REAL, fundamental_score REAL, is_gambler_opportunity INTEGER DEFAULT 0, is_investor_opportunity INTEGER DEFAULT 0, gambler_rank_score REAL DEFAULT 0, investor_rank_score REAL DEFAULT 0, pe_ratio REAL, roe REAL, change_1d REAL, change_1m REAL, volatility REAL, fair_value_upside REAL, smc_signal TEXT,
                UNIQUE(ticker, market)
            )
```

**Indexes:**

- `sqlite_autoindex_stored_analyses_1`: (auto-index)
- `sqlite_autoindex_stored_analyses_2`: (auto-index)
- `idx_stored_ticker`: `CREATE INDEX idx_stored_ticker ON stored_analyses(ticker)`
- `idx_stored_market`: `CREATE INDEX idx_stored_market ON stored_analyses(market)`
- `idx_stored_score`: `CREATE INDEX idx_stored_score ON stored_analyses(maestro_score)`
- `idx_stored_rec`: `CREATE INDEX idx_stored_rec ON stored_analyses(recommendation)`
- `idx_stored_ticker_date`: `CREATE INDEX idx_stored_ticker_date ON stored_analyses(ticker, created_at DESC)`
- `idx_stored_ticker_market`: `CREATE INDEX idx_stored_ticker_market ON stored_analyses(ticker, market)`
- `idx_stored_signal`: `CREATE INDEX idx_stored_signal ON stored_analyses(signal)`

**Code references:**

- Reads (28 files):
  - `vps-service/telegram/auto_poster.py`
  - `vps-service/telegram/patch_auto_poster.py`
  - `vps-service/jobs/market_scheduler.py`
  - `src/components/reports/ReportsView.tsx`
  - `vps-service/api/v2_routes.py`
  - `vps-service/api/picks_management_routes.py`
  - … +18 more
- Writes (10 files):
  - `vps-service/jobs/v40_2_daily_generator.py`
  - `vps-service/jobs/v40_2_intraday_scanner.py`
  - `vps-service/core/persona_db.py`
  - `vps-service/api/ai_routes.py`
  - `vps-service/ai/nightly_analysis.py`
  - `vps-service/analyzers/background_analyzer.py`

---

#### Table: `telegram_news`

- **Rows:** 0
- **Columns:** 8
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=7, reads=3, writes=2
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE telegram_news (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ticker TEXT,
                        message_text TEXT NOT NULL,
                        sentiment TEXT DEFAULT 'neutral',
                        confidence INTEGER DEFAULT 50,
                        source_group TEXT,
                        message_date TEXT,
                        created_at TEXT DEFAULT (datetime('now'))
                    )
```

**Indexes:**

- `idx_tg_news_ticker_date`: `CREATE INDEX idx_tg_news_ticker_date ON telegram_news(ticker, message_date) `

**Code references:**

- Reads (3 files):
  - `vps-service/telegram/database.py`
  - `vps-service/api/chart_routes.py`
  - `vps-service/ai/telegram_signal_importer.py`
- Writes (2 files):
  - `vps-service/telegram/database.py`
  - `vps-service/api/telegram_routes.py`

---

#### Table: `telegram_signals`

- **Rows:** 0
- **Columns:** 8
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=2, reads=2, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE telegram_signals (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ticker TEXT,
                        message_text TEXT NOT NULL,
                        sentiment TEXT DEFAULT 'neutral',
                        confidence INTEGER DEFAULT 50,
                        source_group TEXT,
                        message_date TEXT,
                        created_at TEXT DEFAULT (datetime('now'))
                    )
```

**Indexes:**

- `idx_tg_sig_ticker_date`: `CREATE INDEX idx_tg_sig_ticker_date ON telegram_signals(ticker, message_date) `

**Code references:**

- Reads (2 files):
  - `vps-service/api/ai_routes.py`
  - `vps-service/ai/telegram_signal_importer.py`

---

#### Table: `trade_journal_entries`

- **Rows:** 0
- **Columns:** 28
- **Indexes:** 4
- **Status:** ACTIVE_READ_WRITE — refs=1, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE trade_journal_entries (
            trade_id TEXT PRIMARY KEY,
            ticker TEXT NOT NULL,
            direction TEXT NOT NULL DEFAULT 'long',
            entry_price REAL NOT NULL,
            shares INTEGER NOT NULL,
            entry_date TEXT NOT NULL,
            planned_stop REAL NOT NULL,
            planned_target REAL NOT NULL,
            planned_risk_reward REAL NOT NULL DEFAULT 0,
            entry_reason TEXT DEFAULT '',
            entry_reason_ar TEXT DEFAULT '',
            strategy_used TEXT DEFAULT 'planned_scale_in',
            persona_at_entry TEXT DEFAULT 'balanced',
            market_condition TEXT DEFAULT 'neutral',
            exit_price REAL,
            exit_date TEXT,
            exit_reason TEXT,
            exit_reason_ar TEXT,
            actual_stop_hit INTEGER DEFAULT 0,
            actual_target_hit INTEGER DEFAULT 0,
            actual_risk_reward REAL DEFAULT 0,
            profit_loss REAL DEFAULT 0,
            profit_loss_pct REAL DEFAULT 0,
            days_held INTEGER DEFAULT 0,
            is_closed INTEGER DEFAULT 0,
            journal_required INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
```

**Indexes:**

- `sqlite_autoindex_trade_journal_entries_1`: (auto-index)
- `idx_journal_ticker`: `CREATE INDEX idx_journal_ticker ON trade_journal_entries(ticker)`
- `idx_journal_dates`: `CREATE INDEX idx_journal_dates ON trade_journal_entries(created_at)`
- `idx_journal_closed`: `CREATE INDEX idx_journal_closed ON trade_journal_entries(is_closed)`

**Code references:**

- Reads (1 files):
  - `vps-service/portfolio/trade_journal.py`
- Writes (1 files):
  - `vps-service/portfolio/trade_journal.py`

---

#### Table: `trade_journal_reflections`

- **Rows:** 0
- **Columns:** 11
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=1, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE trade_journal_reflections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id TEXT NOT NULL,
            mistake TEXT,
            mistake_ar TEXT,
            lesson TEXT,
            lesson_ar TEXT,
            emotional_state TEXT,
            followed_plan INTEGER DEFAULT 1,
            grade TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (trade_id) REFERENCES trade_journal_entries(trade_id)
        )
```

**Indexes:**

- `idx_reflections_trade`: `CREATE INDEX idx_reflections_trade ON trade_journal_reflections(trade_id)`

**Code references:**

- Reads (1 files):
  - `vps-service/portfolio/trade_journal.py`
- Writes (1 files):
  - `vps-service/portfolio/trade_journal.py`

---

#### Table: `trade_outcomes`

- **Rows:** 0
- **Columns:** 20
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE trade_outcomes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    ticker TEXT NOT NULL,
                    buy_date TEXT,
                    buy_price REAL,
                    sell_date TEXT,
                    sell_price REAL,
                    quantity REAL,
                    pnl REAL,                        -- الربح/الخسارة بالجنيه
                    pnl_pct REAL,                    -- النسبة %
                    holding_days INTEGER,
                    outcome TEXT,                    -- 'WIN' / 'LOSS' / 'BREAKEVEN'

                    -- التحليل: إيه اللي المشروع قاله قبل الشراء؟
                    prediction_before_buy TEXT,      -- recommendation اللي كانت في stored_analyses
                    maestro_score_before REAL,
                    ai_decision_before TEXT,
                    had_live_signal INTEGER DEFAULT 0,  -- هل فيه live_ai_signal قبل الشراء؟

                    -- التعلّم: إيه الـ pattern الناجح/الفاشل؟
                    pattern_type TEXT,               -- 'breakout' / 'volume_spike' / 'reversal' / 'accumulation'
                    lessons TEXT,                    -- دروس مستفادة

                    analyzed INTEGER DEFAULT 0,      -- هل الـ learning engine حله؟
                    created_at TEXT DEFAULT (datetime('now'))
                )
```

**Indexes:**

- `idx_outcomes_user`: `CREATE INDEX idx_outcomes_user ON trade_outcomes(user_id)`
- `idx_outcomes_ticker`: `CREATE INDEX idx_outcomes_ticker ON trade_outcomes(ticker)`
- `idx_outcomes_outcome`: `CREATE INDEX idx_outcomes_outcome ON trade_outcomes(outcome)`

**Code references:**

- Reads (1 files):
  - `vps-service/ai/trade_recorder.py`
- Writes (1 files):
  - `vps-service/ai/trade_recorder.py`

---

#### Table: `user_trades`

- **Rows:** 0
- **Columns:** 9
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE user_trades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    ticker TEXT NOT NULL,
                    trade_type TEXT NOT NULL,        -- 'BUY' / 'SELL'
                    price REAL NOT NULL,
                    quantity REAL NOT NULL,
                    trade_date TEXT NOT NULL,        -- ISO date
                    notes TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
```

**Indexes:**

- `idx_trades_user`: `CREATE INDEX idx_trades_user ON user_trades(user_id)`
- `idx_trades_ticker`: `CREATE INDEX idx_trades_ticker ON user_trades(ticker)`
- `idx_trades_date`: `CREATE INDEX idx_trades_date ON user_trades(trade_date)`

**Code references:**

- Reads (1 files):
  - `vps-service/ai/trade_recorder.py`
- Writes (1 files):
  - `vps-service/ai/trade_recorder.py`

---

### 3.6 price_history.db

**File:** `db/price_history.db`  
**Size:** 292.91 MB  
**Last modified:** 2026-09-27T08:09:03.877Z  
**Tables:** 1  
**Total rows:** 1,206,795  

#### Table: `price_history`

- **Rows:** 1,206,795
- **Columns:** 12
- **Indexes:** 6
- **Status:** ACTIVE_READ_WRITE — refs=196, reads=122, writes=17
- **Latest record:** 2026-09-08 20:35:51 (via `created_at`, 18 days ago)

**Schema:**
```sql
CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  open_price REAL,
  high_price REAL,
  low_price REAL,
  close_price REAL,
  volume INTEGER,
  source TEXT DEFAULT 'system',
  created_at TEXT DEFAULT (datetime('now')), adjusted INTEGER DEFAULT 0, market TEXT,
  
  UNIQUE(ticker, date)
)
```

**Indexes:**

- `sqlite_autoindex_price_history_1`: (auto-index)
- `idx_price_history_ticker`: `CREATE INDEX idx_price_history_ticker ON price_history(ticker)`
- `idx_price_history_date`: `CREATE INDEX idx_price_history_date ON price_history(date)`
- `idx_price_history_ticker_date`: `CREATE INDEX idx_price_history_ticker_date ON price_history(ticker, date)`
- `idx_ph_ticker_date`: `CREATE INDEX idx_ph_ticker_date ON price_history(ticker, date)`
- `idx_ph_ticker_source`: `CREATE INDEX idx_ph_ticker_source ON price_history(ticker, source)`

**Code references:**

- Reads (122 files):
  - `data_engine/intraday_storage.py`
  - `vps-service/engines/market_regime.py`
  - `vps-service/engines/smart_confluence_engine.py`
  - `vps-service/engines/v38_backtest_engine.py`
  - `vps-service/telegram/telegram_chart_generator.py`
  - `vps-service/jobs/v40_2_daily_generator.py`
  - … +112 more
- Writes (17 files):
  - `vps-service/jobs/price_history_safetynet.py`
  - `vps-service/jobs/intraday_aggregator.py`
  - `vps-service/tools/migrate_price_history.py`
  - `vps-service/align_production_symbols.py`
  - `vps-service/data/eodhd_fetcher.py`
  - `vps-service/data/gap_filler.py`
  - … +7 more

**Sample row:** `{"id":225197,"ticker":"BTC","date":"2025-01-09","open_price":135.389,"high_price":138.378,"low_price":130.569,"close_price":133.003,"volume":74,"source":"egx_investment_migration","created_at":"2026-06-03 12:23:39","adjusted":0,"market":null}`

---

### 3.7 stocks.db

**File:** `db/stocks.db`  
**Size:** 14.21 MB  
**Last modified:** 2026-09-27T09:30:51.262Z  
**Tables:** 52  
**Total rows:** 39,039  

#### Table: `ExpertRecommendation`

- **Rows:** 127
- **Columns:** 38
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=19, reads=6, writes=4
- **Latest record:** 2026-09-07 08:13:04 (via `recommendation_date`, 20 days ago)

**Schema:**
```sql
CREATE TABLE ExpertRecommendation (
    id TEXT PRIMARY KEY,
    stock_symbol TEXT NOT NULL,
    stock_name_ar TEXT,
    expert_name TEXT NOT NULL DEFAULT 'خبير محلل',
    action TEXT NOT NULL,
    recommendation_type TEXT DEFAULT 'detailed',
    entry_price REAL,
    entry_price_from REAL,
    entry_price_to REAL,
    target_price REAL,
    target_price_2 REAL,
    investment_target REAL,
    stop_loss REAL,
    support_level REAL,
    resistance_level REAL,
    session_date TEXT,
    status TEXT DEFAULT 'PENDING',
    final_price REAL,
    profit_loss_percent REAL,
    hit_target INTEGER DEFAULT 0,
    hit_stop_loss INTEGER DEFAULT 0,
    notes TEXT,
    recommendation_date TEXT DEFAULT (datetime('now')),
    closed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  , expert_source TEXT, entry_condition TEXT, stop_loss_condition TEXT, expected_profit_min REAL, expected_profit_max REAL, expected_profit_investment REAL, technical_analysis TEXT, fundamental_analysis TEXT, recommendation_reason TEXT, session_type TEXT DEFAULT 'صباحية', expected_duration TEXT, expected_duration_days INTEGER)
```

**Indexes:**

- `sqlite_autoindex_ExpertRecommendation_1`: (auto-index)

**Code references:**

- Reads (6 files):
  - `src/app/api/seed-experts/route.ts`
  - `vps-service/analyzers/unified_learning_engine.py`
  - `vps-service/analyzers/expert_memory_bridge.py`
  - `vps-service/analyzers/expert_memory_v4.py`
  - `src/app/api/mobile/expert-recommendations/route.ts`
  - `src/app/api/expert-recommendations/route.ts`
- Writes (4 files):
  - `vps-service/api/telegram_routes.py`
  - `src/app/api/seed-experts/route.ts`
  - `src/app/api/expert-recommendations/route.ts`
  - `src/app/api/expert-recommendations/import/route.ts`

**Sample row:** `{"id":"rec_1780600017879_plm6pbk3s","stock_symbol":"EHDR","stock_name_ar":"المصريين للإسكان","expert_name":"خبير محلل","action":"دعم / ارتداد","recommendation_type":"detailed","entry_price":2.27,"entry_price_from":null,"entry_price_to":null,"target_price":null,"target_price_2":null,"investment_target":null,"stop_loss":null,"support_level":null,"resistance_level":null,"session_date":null,"status":"PENDING","final_price":null,"profit_loss_percent":null,"hit_target":0,"hit_stop_loss":0,"notes":"اغلاق قرب دعم مهم جداً","recommendation_date":"2026-05-19","closed_at":null,"created_at":"2026-06-04 19…`

---

#### Table: `analytics_events`

- **Rows:** 467
- **Columns:** 12
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=6, reads=3, writes=2
- **Latest record:** 2026-09-26 18:16:40 (via `created_at`, 0 days ago)

**Schema:**
```sql
CREATE TABLE analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        user_id TEXT,
        view TEXT,
        action TEXT,
        detail TEXT,
        ip_hash TEXT,
        user_agent TEXT,
        screen_width INTEGER,
        created_at TEXT DEFAULT (datetime('now', '+2 hours'))
      , duration_sec INTEGER, session_id TEXT)
```

**Indexes:**

- `idx_analytics_type`: `CREATE INDEX idx_analytics_type ON analytics_events(type, created_at)`
- `idx_analytics_view`: `CREATE INDEX idx_analytics_view ON analytics_events(view, created_at)`
- `idx_analytics_user`: `CREATE INDEX idx_analytics_user ON analytics_events(user_id, created_at)`

**Code references:**

- Reads (3 files):
  - `src/app/api/admin/analytics/route.ts`
  - `src/app/api/admin/users/route.ts`
  - `src/app/api/admin/users/cleanup-expired/route.ts`
- Writes (2 files):
  - `src/app/api/admin/users/cleanup-expired/route.ts`
  - `src/app/api/track/route.ts`

**Sample row:** `{"id":1,"type":"page_view","user_id":null,"view":"stocks","action":null,"detail":null,"ip_hash":"156.212.108.***","user_agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.","screen_width":2549,"created_at":"2026-06-03 17:20:09","duration_sec":null,"session_id":null}`

---

#### Table: `cached_analysis`

- **Rows:** 143
- **Columns:** 39
- **Indexes:** 4
- **Status:** ACTIVE_READ_WRITE — refs=21, reads=8, writes=7
- **Latest record:** 2026-09-26T14:25:17.057448 (via `created_at`, 0 days ago)

**Schema:**
```sql
CREATE TABLE cached_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT UNIQUE,
    sector TEXT,
    current_price REAL DEFAULT 0,
    recommendation TEXT DEFAULT 'hold',
    composite_score REAL DEFAULT 0,
    target_price REAL DEFAULT 0,
    stop_loss REAL DEFAULT 0,
    signal TEXT DEFAULT 'hold',
    confidence REAL DEFAULT 0,
    analysis_json TEXT DEFAULT '{}',
    master_score REAL DEFAULT 0,
    risk_level TEXT DEFAULT 'medium',
    technical_score REAL DEFAULT 0,
    fundamental_score REAL DEFAULT 0,
    sentiment_score REAL DEFAULT 0,
    risk_score REAL DEFAULT 0,
    momentum_score REAL DEFAULT 0,
    trend TEXT DEFAULT 'neutral',
    liquidity_level TEXT DEFAULT 'medium',
    volatility REAL DEFAULT 0,
    upside_potential REAL DEFAULT 0,
    is_tradeable INTEGER DEFAULT 1,
    volume_trend TEXT DEFAULT 'stable',
    price_strength REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
, analysis_date TEXT, price_change_1d REAL DEFAULT 0, price_change_1w REAL DEFAULT 0, price_change_1m REAL DEFAULT 0, confluence_score REAL DEFAULT 0, volume_seasonal_score REAL DEFAULT 0, timing_score REAL, pattern_score REAL, market_regime_score REAL, risk_reward REAL, entry_price REAL, market TEXT)
```

**Indexes:**

- `sqlite_autoindex_cached_analysis_1`: (auto-index)
- `idx_cached_ticker`: `CREATE INDEX idx_cached_ticker ON cached_analysis(ticker)`
- `idx_cached_date`: `CREATE INDEX idx_cached_date ON cached_analysis(analysis_date)`
- `idx_cached_tradeable`: `CREATE INDEX idx_cached_tradeable ON cached_analysis(is_tradeable, analysis_date)`

**Code references:**

- Reads (8 files):
  - `vps-service/align_production_symbols.py`
  - `vps-service/core/database.py`
  - `vps-service/api/ai_predictions_routes.py`
  - `vps-service/ai/nightly_analysis.py`
  - `vps-service/ai/hot_stocks_detector.py`
  - `vps-service/analyzers/live_indicator_engine.py`
- Writes (7 files):
  - `vps-service/jobs/v40_2_intraday_scanner.py`
  - `vps-service/align_production_symbols.py`
  - `vps-service/engine/live_prediction_engine.py`
  - `vps-service/core/database.py`
  - `vps-service/analyzers/background_analyzer.py`
  - `src/app/api/admin/db-manager/repair/route.ts`

**Sample row:** `{"id":123067384,"ticker":"EDBM","sector":null,"current_price":0,"recommendation":"hold","composite_score":0,"target_price":0,"stop_loss":0,"signal":"REDUCE","confidence":0,"analysis_json":"{\"ticker\": \"EDBM\", \"signal\": \"REDUCE\", \"signal_ar\": \"تخفيف\", \"confidence\": 56.1, \"master_score\": 40.68, \"technical_score\": 45.75, \"fundamental_score\": 50.0, \"timing_score\": 30.0, \"pattern_score\": 52.0, \"market_regime_score\": 50.0, \"liquidity_level\": \"HIGH\", \"is_tradeable\": true, \"liquidity_warning\": null, \"session_phase\": \"بعد الجلسة\", \"risk_profile\": {\"signal\": \"HO…`

---

#### Table: `conjunction_patterns`

- **Rows:** 150
- **Columns:** 15
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=12, reads=2, writes=1
- **Latest record:** 2026-06-25T02:29:31.831932 (via `last_updated`, 94 days ago — STALE)

**Schema:**
```sql
CREATE TABLE conjunction_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                persona_name TEXT DEFAULT 'balanced',
                sector TEXT NOT NULL,
                regime TEXT NOT NULL,
                rsi_bucket TEXT NOT NULL,
                month INTEGER,
                quarter TEXT,
                total_signals INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                win_rate REAL DEFAULT 0,
                avg_pnl REAL DEFAULT 0,
                decision TEXT DEFAULT 'proceed',
                confidence_adjustment REAL DEFAULT 0,
                last_updated TEXT,
                UNIQUE(persona_name, sector, regime, rsi_bucket, month)
            )
```

**Indexes:**

- `sqlite_autoindex_conjunction_patterns_1`: (auto-index)
- `idx_conjunction_lookup`: `CREATE INDEX idx_conjunction_lookup ON conjunction_patterns(sector, regime, rsi_bucket, month)`

**Code references:**

- Reads (2 files):
  - `vps-service/analyzers/expert_memory.py`
  - `vps-service/scripts/true_forward_test.py`
- Writes (1 files):
  - `vps-service/analyzers/expert_memory.py`

**Sample row:** `{"id":1,"persona_name":"balanced","sector":"القطاع المالي","regime":"unknown","rsi_bucket":"unknown","month":1,"quarter":"Q1","total_signals":625,"wins":458,"losses":167,"win_rate":0.7328,"avg_pnl":3.3209,"decision":"boost","confidence_adjustment":20,"last_updated":"2026-06-25T02:29:31.831932"}`

---

#### Table: `context_logs`

- **Rows:** 0
- **Columns:** 9
- **Indexes:** 0
- **Status:** REFERENCED_NO_SQL — refs=5, reads=0, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE context_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                sector TEXT,
                regime TEXT,
                rsi_bucket TEXT,
                month INTEGER,
                quarter TEXT,
                persona TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
```

**Code references:** ⚠️ None found — orphan table.

---

#### Table: `daily_analytics_summary`

- **Rows:** 0
- **Columns:** 17
- **Indexes:** 2
- **Status:** WRITE_ONLY — refs=1, reads=0, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE daily_analytics_summary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT UNIQUE,
            total_page_views INTEGER DEFAULT 0,
            unique_visitors INTEGER DEFAULT 0,
            new_users INTEGER DEFAULT 0,
            returning_users INTEGER DEFAULT 0,
            total_sessions INTEGER DEFAULT 0,
            avg_session_duration INTEGER DEFAULT 0,
            bounce_rate REAL DEFAULT 0,
            mobile_users INTEGER DEFAULT 0,
            desktop_users INTEGER DEFAULT 0,
            tablet_users INTEGER DEFAULT 0,
            top_pages TEXT,
            top_features TEXT,
            top_stocks_viewed TEXT,
            top_referrers TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
```

**Indexes:**

- `sqlite_autoindex_daily_analytics_summary_1`: (auto-index)
- `idx_das_date`: `CREATE INDEX idx_das_date ON daily_analytics_summary(date)`

**Code references:**

- Writes (1 files):
  - `vps-service/api/analytics.py`

---

#### Table: `egksco_price_history`

- **Rows:** 0
- **Columns:** 10
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=31, reads=18, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE egksco_price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                date TEXT NOT NULL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                close_price REAL,
                volume INTEGER,
                value REAL,
                source TEXT DEFAULT 'egksco',
                UNIQUE(symbol, date)
            )
```

**Indexes:**

- `sqlite_autoindex_egksco_price_history_1`: (auto-index)

**Code references:**

- Reads (18 files):
  - `vps-service/engines/v38_backtest_engine.py`
  - `vps-service/jobs/v40_2_daily_generator.py`
  - `vps-service/jobs/daily_closer.py`
  - `vps-service/jobs/learning_engine.py`
  - `vps-service/api/top_performers_routes.py`
  - `vps-service/analyzers/maestro_orchestrator.py`
  - … +8 more

---

#### Table: `egksco_stocks`

- **Rows:** 250
- **Columns:** 17
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=14, reads=8, writes=1
- **Latest record:** 2026-07-23T13:41:57.648276 (via `last_update`, 65 days ago — STALE)

**Schema:**
```sql
CREATE TABLE egksco_stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT UNIQUE NOT NULL,
                name TEXT,
                name_ar TEXT,
                last_price REAL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                prev_close REAL,
                change_pct REAL,
                volume INTEGER,
                value REAL,
                trades_count INTEGER,
                last_update TEXT,
                source TEXT DEFAULT 'egksco',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
```

**Indexes:**

- `sqlite_autoindex_egksco_stocks_1`: (auto-index)

**Code references:**

- Reads (8 files):
  - `vps-service/jobs/daily_closer.py`
  - `vps-service/utils/lesson_store.py`
  - `vps-service/utils/live_price.py`
  - `vps-service/api/stored_analysis_routes.py`
  - `vps-service/analyzers/stock_notebook.py`
  - `vps-service/data/analyses.py`
- Writes (1 files):
  - `vps-service/data/egksco_scraper.py`

**Sample row:** `{"id":1,"symbol":"ODHN","name":"(AG)اوراسكوم القابضة للتنمية","name_ar":"(AG)اوراسكوم القابضة للتنمية","last_price":0,"open_price":0,"high_price":0,"low_price":0,"prev_close":0,"change_pct":null,"volume":0,"value":0,"trades_count":null,"last_update":"2026-07-23T13:41:57.245925","source":"egksco","created_at":"2026-06-03 15:09:37","updated_at":"2026-07-23 10:41:57"}`

---

#### Table: `egksco_sync_status`

- **Rows:** 451
- **Columns:** 10
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=1, writes=1
- **Latest record:** 2026-08-27 11:20:14 (via `sync_time`, 31 days ago — STALE)

**Schema:**
```sql
CREATE TABLE egksco_sync_status (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_type TEXT NOT NULL,
                status TEXT NOT NULL,
                stocks_count INTEGER DEFAULT 0,
                new_stocks INTEGER DEFAULT 0,
                updated_stocks INTEGER DEFAULT 0,
                errors INTEGER DEFAULT 0,
                duration_seconds REAL,
                message TEXT,
                sync_time TEXT DEFAULT CURRENT_TIMESTAMP
            )
```

**Code references:**

- Reads (1 files):
  - `vps-service/data/egksco_scraper.py`
- Writes (1 files):
  - `vps-service/data/egksco_scraper.py`

**Sample row:** `{"id":1,"sync_type":"stocks","status":"success","stocks_count":256,"new_stocks":256,"updated_stocks":0,"errors":0,"duration_seconds":1.376953363418579,"message":"","sync_time":"2026-06-03 15:09:38"}`

---

#### Table: `error_logs`

- **Rows:** 0
- **Columns:** 9
- **Indexes:** 0
- **Status:** WRITE_ONLY — refs=1, reads=0, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE error_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            error_type TEXT NOT NULL,
            error_message TEXT,
            stack_trace TEXT,
            page_path TEXT,
            user_id TEXT,
            session_id TEXT,
            user_agent TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
```

**Code references:**

- Writes (1 files):
  - `vps-service/api/analytics.py`

---

#### Table: `feature_usage`

- **Rows:** 0
- **Columns:** 9
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=4, reads=2, writes=2
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE feature_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            session_id TEXT,
            feature_name TEXT NOT NULL,
            action TEXT,
            metadata TEXT,
            ticker TEXT,
            duration_ms INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        )
```

**Indexes:**

- `idx_fu_name`: `CREATE INDEX idx_fu_name ON feature_usage(feature_name)`
- `idx_fu_created`: `CREATE INDEX idx_fu_created ON feature_usage(created_at)`

**Code references:**

- Reads (2 files):
  - `vps-service/api/analytics.py`
  - `src/app/api/admin/users/cleanup-expired/route.ts`
- Writes (2 files):
  - `vps-service/api/analytics.py`
  - `src/app/api/admin/users/cleanup-expired/route.ts`

---

#### Table: `financial_obligations`

- **Rows:** 0
- **Columns:** 16
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=7, reads=6, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE financial_obligations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        creditor TEXT NOT NULL DEFAULT '',
        total_amount REAL NOT NULL DEFAULT 0,
        remaining_amount REAL NOT NULL DEFAULT 0,
        monthly_payment REAL NOT NULL DEFAULT 0,
        interest_rate REAL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        next_payment_date TEXT,
        status TEXT DEFAULT 'active',
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
```

**Code references:**

- Reads (6 files):
  - `vps-service/scripts/wealth_tracker.py`
  - `src/app/api/finance/reports/route.ts`
  - `src/app/api/finance/obligations/route.ts`
  - `src/app/api/finance/obligations/payments/route.ts`
  - `src/app/api/finance/calculate-values/route.ts`
  - `src/app/api/portfolio/master/route.ts`
- Writes (1 files):
  - `src/app/api/finance/obligations/route.ts`

---

#### Table: `financial_transactions`

- **Rows:** 0
- **Columns:** 11
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=5, reads=4, writes=2
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE financial_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT NOT NULL,
        is_recurring INTEGER DEFAULT 0,
        recurring_frequency TEXT,
        transaction_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
```

**Code references:**

- Reads (4 files):
  - `vps-service/scripts/wealth_tracker.py`
  - `src/app/api/finance/transactions/route.ts`
  - `src/app/api/finance/transactions/[id]/route.ts`
  - `src/app/api/finance/reports/route.ts`
- Writes (2 files):
  - `src/app/api/finance/transactions/route.ts`
  - `src/app/api/finance/transactions/[id]/route.ts`

---

#### Table: `gold_alerts`

- **Rows:** 0
- **Columns:** 8
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=2, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE gold_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '',
      karat INTEGER NOT NULL DEFAULT 24,
      condition TEXT NOT NULL DEFAULT 'above',
      threshold_price REAL,
      is_active INTEGER DEFAULT 1,
      last_triggered TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
```

**Code references:**

- Reads (2 files):
  - `src/app/api/alerts/gold/route.ts`
  - `src/lib/schedulers/alert-engine.ts`
- Writes (1 files):
  - `src/app/api/alerts/gold/route.ts`

---

#### Table: `gold_prices`

- **Rows:** 3
- **Columns:** 6
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=37, reads=16, writes=1
- **Latest record:** 2026-06-03T16:52:36.506Z (via `last_update`, 115 days ago — STALE)

**Schema:**
```sql
CREATE TABLE gold_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        karat TEXT NOT NULL,
        price_per_gram REAL NOT NULL,
        currency TEXT DEFAULT 'EGP',
        source TEXT,
        last_update TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(karat, currency)
      )
```

**Indexes:**

- `sqlite_autoindex_gold_prices_1`: (auto-index)

**Code references:**

- Reads (16 files):
  - `data_engine/sync.py`
  - `data_engine/main.py`
  - `data_engine/intraday_storage.py`
  - `vps-service/analyzers/reports_engine.py`
  - `vps-service/scripts/liquidity_backtest_engine.py`
  - `vps-service/scripts/dual_track_generator.py`
  - … +6 more
- Writes (1 files):
  - `data_engine/scrapers/metals_forex_fetcher.py`

**Sample row:** `{"id":1,"karat":"24","price_per_gram":3200,"currency":"EGP","source":"default","last_update":"2026-06-03T16:52:36.506Z"}`

---

#### Table: `indicator_trust_scores`

- **Rows:** 10
- **Columns:** 8
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=8, reads=2, writes=2
- **Latest record:** 2026-05-04 18:56:35 (via `last_updated`, 145 days ago — STALE)

**Schema:**
```sql
CREATE TABLE indicator_trust_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                indicator_name TEXT NOT NULL,
                persona_name TEXT DEFAULT 'balanced',
                timeframe TEXT,
                success_count INTEGER DEFAULT 0,
                failure_count INTEGER DEFAULT 0,
                trust_score REAL DEFAULT 0.5,
                last_updated TEXT,
                UNIQUE(indicator_name, persona_name, timeframe)
            )
```

**Indexes:**

- `sqlite_autoindex_indicator_trust_scores_1`: (auto-index)

**Code references:**

- Reads (2 files):
  - `vps-service/analyzers/indicator_trust_scores.py`
  - `vps-service/analyzers/unified_learning_engine.py`
- Writes (2 files):
  - `vps-service/analyzers/indicator_trust_scores.py`
  - `vps-service/analyzers/unified_learning_engine.py`

**Sample row:** `{"id":1,"indicator_name":"RSI","persona_name":"balanced","timeframe":null,"success_count":0,"failure_count":0,"trust_score":0.5,"last_updated":"2026-05-04 18:56:33"}`

---

#### Table: `investors_data`

- **Rows:** 30
- **Columns:** 17
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=4, reads=1, writes=3
- **Latest record:** 2026-09-26 10:35:05 (via `created_at`, 1 days ago)

**Schema:**
```sql
CREATE TABLE investors_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  session_type TEXT,
  individuals_buys_value REAL,
  individuals_sells_value REAL,
  individuals_net_value REAL,
  arab_buys_value REAL,
  arab_sells_value REAL,
  arab_net_value REAL,
  foreign_buys_value REAL,
  foreign_sells_value REAL,
  foreign_net_value REAL,
  total_buys_value REAL,
  total_sells_value REAL,
  number_of_trades INTEGER,
  source TEXT DEFAULT 'computed_estimate',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(date)
)
```

**Indexes:**

- `sqlite_autoindex_investors_data_1`: (auto-index)

**Code references:**

- Reads (1 files):
  - `src/app/api/egx/investors/route.ts`
- Writes (3 files):
  - `vps-service/scrappers/egx_investors_scraper.py`
  - `src/app/api/egx/investors/seed/route.ts`
  - `src/app/api/egx/investors/route.ts`

**Sample row:** `{"id":1,"date":"2026-09-26","session_type":"day","individuals_buys_value":3587804204.2,"individuals_sells_value":5563528134.64,"individuals_net_value":-1975723930.43,"arab_buys_value":512543457.74,"arab_sells_value":794789733.52,"arab_net_value":-282246275.78,"foreign_buys_value":1025086915.49,"foreign_sells_value":1589579467.04,"foreign_net_value":-564492551.55,"total_buys_value":5125434577.43,"total_sells_value":7947897335.19,"number_of_trades":2734764,"source":"computed_estimate","created_at":"2026-09-26 10:35:05"}`

---

#### Table: `learned_lessons`

- **Rows:** 0
- **Columns:** 8
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=29, reads=13, writes=5
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE learned_lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_type TEXT NOT NULL,
                lesson_text TEXT NOT NULL,
                context_json TEXT,
                confidence REAL DEFAULT 0.5,
                source TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
```

**Code references:**

- Reads (13 files):
  - `vps-service/jobs/daily_closer.py`
  - `vps-service/jobs/learning_engine.py`
  - `vps-service/utils/win_lesson_store.py`
  - `vps-service/utils/lesson_store.py`
  - `vps-service/engine/historical_backfill_engine.py`
  - `vps-service/api/sniper_routes.py`
  - … +3 more
- Writes (5 files):
  - `vps-service/jobs/learning_engine.py`
  - `vps-service/utils/win_lesson_store.py`
  - `vps-service/utils/lesson_store.py`
  - `vps-service/engine/historical_backfill_engine.py`
  - `vps-service/scripts/build_sector_patterns.py`

---

#### Table: `macro_indicators`

- **Rows:** 3
- **Columns:** 11
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=11, reads=4, writes=2
- **Latest record:** 2026-09-26T18:33:03 (via `updated_at`, 0 days ago)

**Schema:**
```sql
CREATE TABLE macro_indicators (
        date TEXT PRIMARY KEY,
        usd_to_egp REAL,
        cbe_interest_rate REAL,
        usd_change_3d REAL,
        created_at TEXT DEFAULT (datetime('now'))
    , indicator_name TEXT, indicator_value REAL DEFAULT 0, unit TEXT DEFAULT '%', source TEXT, recorded_at TEXT, updated_at TEXT)
```

**Indexes:**

- `sqlite_autoindex_macro_indicators_1`: (auto-index)
- `idx_macro_indicators_name`: `CREATE UNIQUE INDEX idx_macro_indicators_name ON macro_indicators(indicator_name)`

**Code references:**

- Reads (4 files):
  - `vps-service/analyzers/macro_veto.py`
  - `vps-service/analyzers/real_return_engine.py`
  - `src/app/api/finance/real-return/route.ts`
  - `src/app/api/finance/inflation/route.ts`
- Writes (2 files):
  - `vps-service/jobs/fetch_inflation_worldbank.py`
  - `src/app/api/finance/inflation/route.ts`

**Sample row:** `{"date":"2026-07-21","usd_to_egp":48.5,"cbe_interest_rate":27.25,"usd_change_3d":0,"created_at":"2026-07-21 18:52:26","indicator_name":null,"indicator_value":0,"unit":"%","source":null,"recorded_at":null,"updated_at":null}`

---

#### Table: `market_indices`

- **Rows:** 5
- **Columns:** 10
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=25, reads=19, writes=2
- **Latest record:** 2026-03-11 00:48:04.798 +00:00 (via `last_update`, 200 days ago — STALE)

**Schema:**
```sql
CREATE TABLE market_indices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT UNIQUE,
  name TEXT,
  name_ar TEXT,
  current_value REAL,
  previous_close REAL,
  change REAL,
  change_percent REAL,
  is_shariah INTEGER DEFAULT 0,
  last_update TEXT
)
```

**Indexes:**

- `sqlite_autoindex_market_indices_1`: (auto-index)

**Code references:**

- Reads (19 files):
  - `vps-service/lightweight_server.py`
  - `vps-service/import_egx30_production.py`
  - `vps-service/telegram/telegram_market_analysis.py`
  - `vps-service/telegram/telegram_morning_bell.py`
  - `vps-service/jobs/market_scheduler.py`
  - `vps-service/engine/explosive_scanner.py`
  - … +9 more
- Writes (2 files):
  - `vps-service/import_egx30_production.py`
  - `vps-service/tests/test_phase_b_integrity.py`

**Sample row:** `{"id":1,"symbol":"EGX30","name":"EGX 30 Index","name_ar":null,"current_value":10285.596804959525,"previous_close":11129.090481605035,"change":194.64450888361483,"change_percent":2.159546357273079,"is_shariah":0,"last_update":"2026-03-11 00:48:04.352 +00:00"}`

---

#### Table: `market_pulse_cache`

- **Rows:** 2,132
- **Columns:** 20
- **Indexes:** 0
- **Status:** WRITE_ONLY — refs=1, reads=0, writes=1
- **Latest record:** 2026-08-28 18:28:29 (via `created_at`, 29 days ago)

**Schema:**
```sql
CREATE TABLE market_pulse_cache (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        regime TEXT,
                        regime_5 TEXT,
                        strength REAL,
                        breadth REAL,
                        risk_level TEXT,
                        advancers INTEGER,
                        decliners INTEGER,
                        flat_count INTEGER,
                        egx30_price REAL,
                        sma20 REAL,
                        sma50 REAL,
                        sma200 REAL,
                        atr_pct REAL,
                        volatility_regime TEXT,
                        trading_paused INTEGER DEFAULT 0,
                        pause_reason TEXT,
                        sector_top TEXT,
                        sector_bottom TEXT,
                        created_at TEXT DEFAULT (datetime('now'))
                    )
```

**Code references:**

- Writes (1 files):
  - `vps-service/jobs/market_scheduler.py`

**Sample row:** `{"id":1,"regime":"bear","regime_5":"weak_bear","strength":48,"breadth":0.52,"risk_level":"high","advancers":26,"decliners":20,"flat_count":4,"egx30_price":10285.596804959525,"sma20":0,"sma50":0,"sma200":0,"atr_pct":0,"volatility_regime":"low","trading_paused":0,"pause_reason":null,"sector_top":"[{\"sector\": \"Producer Manufacturing\", \"avg_change\": 6.22}, {\"sector\": \"Process Industries\", \"avg_change\": 2.4}, {\"sector\": \"Technology Services\", \"avg_change\": 2.3}]","sector_bottom":"[{\"sector\": \"Finance\", \"avg_change\": -1.54}, {\"sector\": \"Consumer Durables\", \"avg_change\":…`

---

#### Table: `market_regime_log`

- **Rows:** 34
- **Columns:** 15
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=7, reads=3, writes=1
- **Latest record:** 2026-08-28 00:08:47 (via `created_at`, 30 days ago)

**Schema:**
```sql
CREATE TABLE market_regime_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        regime TEXT NOT NULL,
        confidence REAL DEFAULT 0,
        egx30_close REAL,
        egx30_change_pct REAL,
        volume_ratio REAL,
        adx REAL,
        rsi REAL,
        created_at TEXT DEFAULT (datetime('now'))
    , stock_id INTEGER, regime_ar TEXT, ticker TEXT, reason TEXT, indicators TEXT)
```

**Indexes:**

- `sqlite_autoindex_market_regime_log_1`: (auto-index)

**Code references:**

- Reads (3 files):
  - `vps-service/analyzers/board_of_analysts.py`
  - `vps-service/analyzers/regime_detector.py`
  - `vps-service/analyzers/prediction_optimizer.py`
- Writes (1 files):
  - `vps-service/analyzers/regime_detector.py`

**Sample row:** `{"id":1,"date":"2026-06-21","regime":"bull_trend","confidence":42.9,"egx30_close":null,"egx30_change_pct":null,"volume_ratio":null,"adx":null,"rsi":null,"created_at":"2026-06-21 14:26:31","stock_id":null,"regime_ar":"صاعد واضح","ticker":"EGX30","reason":"","indicators":"{\"adx\": {\"adx\": 60.5, \"plus_di\": 0.17, \"minus_di\": 0.01, \"trend_strength\": \"strong\", \"direction\": \"bullish\"}, \"roc\": {\"roc\": -99.6, \"status\": \"bearish\"}}"}`

---

#### Table: `news_items`

- **Rows:** 0
- **Columns:** 11
- **Indexes:** 3
- **Status:** ACTIVE_READ_ONLY — refs=8, reads=3, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE news_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT,
            published_at TEXT,
            category TEXT DEFAULT 'general',
            title TEXT,
            content TEXT,
            sentiment TEXT DEFAULT 'neutral',
            importance INTEGER DEFAULT 1,
            source TEXT,
            url TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
```

**Indexes:**

- `idx_news_ticker`: `CREATE INDEX idx_news_ticker ON news_items(ticker)`
- `idx_news_published`: `CREATE INDEX idx_news_published ON news_items(published_at DESC)`
- `idx_news_category`: `CREATE INDEX idx_news_category ON news_items(category, published_at DESC)`

**Code references:**

- Reads (3 files):
  - `vps-service/analyzers/news_stop_filter.py`
  - `vps-service/analyzers/sentiment_analyzer.py`
  - `src/app/api/disclosures/company/[symbol]/route.ts`

---

#### Table: `obligation_payments`

- **Rows:** 0
- **Columns:** 9
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=2, writes=2
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE obligation_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        obligation_id INTEGER NOT NULL,
        user_id TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL,
        payment_date TEXT NOT NULL,
        principal_amount REAL DEFAULT 0,
        interest_amount REAL DEFAULT 0,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (obligation_id) REFERENCES financial_obligations(id)
      )
```

**Code references:**

- Reads (2 files):
  - `src/app/api/finance/obligations/route.ts`
  - `src/app/api/finance/obligations/payments/route.ts`
- Writes (2 files):
  - `src/app/api/finance/obligations/route.ts`
  - `src/app/api/finance/obligations/payments/route.ts`

---

#### Table: `outcome_logs`

- **Rows:** 8,544
- **Columns:** 10
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=20, reads=5, writes=1
- **Latest record:** 2026-06-25T02:29:31.695648 (via `created_at`, 94 days ago — STALE)

**Schema:**
```sql
CREATE TABLE outcome_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id INTEGER NOT NULL,
                close_date TEXT NOT NULL,
                actual_exit_price REAL,
                close_reason TEXT,
                gross_profit_loss REAL,
                net_profit_loss REAL,
                profit_loss_percent REAL,
                days_open INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            )
```

**Code references:**

- Reads (5 files):
  - `vps-service/api/admin_routes.py`
  - `vps-service/analyzers/unified_learning_engine.py`
  - `vps-service/analyzers/expert_memory.py`
  - `vps-service/scripts/true_forward_test.py`
  - `vps-service/scripts/verification.py`
- Writes (1 files):
  - `vps-service/scripts/backfill_signal_memory.py`

**Sample row:** `{"id":1,"trade_id":1,"close_date":"2026-01-01","actual_exit_price":null,"close_reason":"verified_backfill","gross_profit_loss":null,"net_profit_loss":null,"profit_loss_percent":-3.91,"days_open":null,"created_at":"2026-06-25T02:29:31.695648"}`

---

#### Table: `page_views`

- **Rows:** 0
- **Columns:** 15
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=6, reads=2, writes=2
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE page_views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            session_id TEXT,
            page_path TEXT NOT NULL,
            page_title TEXT,
            referrer TEXT,
            ip_hash TEXT,
            user_agent TEXT,
            device_type TEXT,
            browser TEXT,
            os TEXT,
            country TEXT,
            city TEXT,
            load_time_ms INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        )
```

**Indexes:**

- `idx_pv_path`: `CREATE INDEX idx_pv_path ON page_views(page_path)`
- `idx_pv_created`: `CREATE INDEX idx_pv_created ON page_views(created_at)`

**Code references:**

- Reads (2 files):
  - `vps-service/api/analytics.py`
  - `src/app/api/admin/users/cleanup-expired/route.ts`
- Writes (2 files):
  - `vps-service/api/analytics.py`
  - `src/app/api/admin/users/cleanup-expired/route.ts`

---

#### Table: `pending_settlements`

- **Rows:** 0
- **Columns:** 12
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE pending_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ticker TEXT,
    side TEXT NOT NULL,                  -- 'buy' | 'sell'
    quantity REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    value REAL NOT NULL DEFAULT 0,        -- quantity * price
    trade_date TEXT NOT NULL,             -- ISO timestamp when trade executed
    settle_date TEXT NOT NULL,            -- trade_date + T2_SETTLEMENT_DAYS
    settled INTEGER NOT NULL DEFAULT 0,   -- 0 = pending, 1 = settled (auto-flagged after T+2)
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)
```

**Indexes:**

- `idx_ps_user_side_settled`: `CREATE INDEX idx_ps_user_side_settled ON pending_settlements(user_id, side, settled)`
- `idx_ps_user_trade_date`: `CREATE INDEX idx_ps_user_trade_date ON pending_settlements(user_id, trade_date)`

**Code references:**

- Reads (1 files):
  - `vps-service/portfolio/hard_protection.py`
- Writes (1 files):
  - `vps-service/portfolio/hard_protection.py`

---

#### Table: `portfolio_assets`

- **Rows:** 25
- **Columns:** 29
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=40, reads=33, writes=3
- **Latest record:** 2026-08-28 12:19:22 (via `updated_at`, 29 days ago)

**Schema:**
```sql
CREATE TABLE portfolio_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'stock',
    name TEXT NOT NULL,
    total_invested REAL NOT NULL DEFAULT 0,
    current_value REAL NOT NULL DEFAULT 0,
    notes TEXT,
    weight_grams REAL,
    karat INTEGER,
    purchase_price_per_gram REAL,
    bank_name TEXT,
    interest_rate REAL,
    certificate_duration_months INTEGER,
    certificate_return_rate REAL,
    certificate_maturity_date TEXT,
    fund_name TEXT,
    fund_type TEXT,
    stock_id INTEGER,
    stock_ticker TEXT,
    quantity REAL,
    avg_buy_price REAL,
    added_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  , portfolio_id TEXT DEFAULT 'default', market TEXT DEFAULT 'EGX', currency TEXT DEFAULT 'EGP', is_active INTEGER DEFAULT 1, asset_class TEXT DEFAULT 'stock', annual_yield REAL DEFAULT 0)
```

**Code references:**

- Reads (33 files):
  - `vps-service/lightweight_server.py`
  - `vps-service/jobs/market_scheduler.py`
  - `vps-service/jobs/daily_portfolio_yield.py`
  - `vps-service/portfolio/hard_protection.py`
  - `vps-service/api/portfolio_routes.py`
  - `vps-service/analyzers/live_autonomous_monitor.py`
  - … +23 more
- Writes (3 files):
  - `src/app/api/admin/users/cleanup-expired/route.ts`
  - `src/app/api/finance/assets/route.ts`
  - `src/app/api/finance/assets/[id]/route.ts`

**Sample row:** `{"id":1,"user_id":"48457b7f-40f2-4a7e-8955-d4d2cd1d79bd","type":"stock","name":"بلتون المالية","total_invested":10029.720000000001,"current_value":9903.56,"notes":null,"weight_grams":null,"karat":null,"purchase_price_per_gram":null,"bank_name":null,"interest_rate":null,"certificate_duration_months":null,"certificate_return_rate":null,"certificate_maturity_date":null,"fund_name":null,"fund_type":null,"stock_id":null,"stock_ticker":"BTFH","quantity":3154,"avg_buy_price":3.18,"added_at":"2026-06-14 13:14:06","updated_at":"2026-07-29 12:08:55","portfolio_id":"default","market":"EGX","currency":"EG…`

---

#### Table: `portfolios`

- **Rows:** 3
- **Columns:** 11
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=10, reads=5, writes=2
- **Latest record:** 2026-07-22 15:17:16 (via `created_at`, 66 days ago — STALE)

**Schema:**
```sql
CREATE TABLE portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      broker TEXT DEFAULT 'manual',
      market TEXT DEFAULT 'EGX',
      currency TEXT DEFAULT 'EGP',
      color TEXT DEFAULT 'blue',
      is_master INTEGER DEFAULT 0,
      initial_capital REAL DEFAULT 100000,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
```

**Code references:**

- Reads (5 files):
  - `vps-service/api/portfolio_routes.py`
  - `src/app/api/portfolio/master/route.ts`
  - `src/app/api/portfolio/smart-monitor/signals/route.ts`
  - `src/app/api/portfolio/holdings/route.ts`
  - `src/app/api/portfolio/accounts/route.ts`
- Writes (2 files):
  - `vps-service/api/portfolio_routes.py`
  - `src/app/api/portfolio/accounts/route.ts`

**Sample row:** `{"id":1,"user_id":"default","name":"المحفظة الأم","broker":"master","market":"EGX","currency":"EGP","color":"emerald","is_master":1,"initial_capital":100000,"created_at":"2026-07-22 15:16:20","updated_at":"2026-07-22 15:16:20"}`

---

#### Table: `radar_signal_tracking`

- **Rows:** 96
- **Columns:** 15
- **Indexes:** 4
- **Status:** ACTIVE_READ_WRITE — refs=4, reads=3, writes=2
- **Latest record:** 2026-09-27 09:29:19 (via `created_at`, 0 days ago)

**Schema:**
```sql
CREATE TABLE radar_signal_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    signal_date TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    entry_price REAL NOT NULL,
    path TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    outcome_7d REAL,
    outcome_14d REAL,
    outcome_30d REAL,
    max_price_after REAL,
    min_price_after REAL,
    verified_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
```

**Indexes:**

- `idx_radar_sig_ticker`: `CREATE INDEX idx_radar_sig_ticker ON radar_signal_tracking(ticker)`
- `idx_radar_sig_status`: `CREATE INDEX idx_radar_sig_status ON radar_signal_tracking(status)`
- `idx_radar_sig_type`: `CREATE INDEX idx_radar_sig_type ON radar_signal_tracking(signal_type)`
- `idx_radar_sig_date`: `CREATE INDEX idx_radar_sig_date ON radar_signal_tracking(signal_date)`

**Code references:**

- Reads (3 files):
  - `src/lib/radar-signal-tracker.ts`
  - `src/app/api/maker-radar/signal-tracker/route.ts`
  - `src/app/api/maker-radar/signal-tracker/verify/route.ts`
- Writes (2 files):
  - `src/lib/radar-signal-tracker.ts`
  - `src/app/api/maker-radar/signal-tracker/route.ts`

**Sample row:** `{"id":4,"ticker":"RKAZ","signal_date":"2026-09-27","signal_type":"explosive_surge","entry_price":4.9,"path":"D_explosive_surge","reason":"🔥 EXPLOSIVE_SURGE — vol 9.57× ≥ 2.0 + سعر فوق SMA20 (4.90 > 4.46) + range منضغط (15.9% < 18.0%). ⚠️ position size 2% (EXPLOSIVE_SURGE_POSITION_SIZE)","status":"pending","outcome_7d":null,"outcome_14d":null,"outcome_30d":null,"max_price_after":null,"min_price_after":null,"verified_at":null,"created_at":"2026-09-27 09:29:19"}`

---

#### Table: `real_evaluated_predictions`

- **Rows:** 4,035
- **Columns:** 10
- **Indexes:** 0
- **Status:** REFERENCED_NO_SQL — refs=1, reads=0, writes=0
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE real_evaluated_predictions (
            id INTEGER PRIMARY KEY,
            ticker TEXT,
            signal TEXT,
            entry_price REAL,
            exit_price REAL,
            hit_target INTEGER,
            hit_stop INTEGER,
            return_pct REAL,
            holding_days INTEGER,
            evaluated_at TEXT DEFAULT (datetime('now'))
        )
```

**Code references:** ⚠️ None found — orphan table.

**Sample row:** `{"id":1,"ticker":"COMI","signal":"BUY","entry_price":132.5,"exit_price":140,"hit_target":0,"hit_stop":0,"return_pct":5.66,"holding_days":7,"evaluated_at":"2026-07-23 13:11:09"}`

---

#### Table: `regime_indicator_weights`

- **Rows:** 0
- **Columns:** 5
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=10, reads=5, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE regime_indicator_weights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                regime TEXT NOT NULL,
                indicator_name TEXT NOT NULL,
                weight REAL DEFAULT 0.5,
                last_updated TEXT,
                UNIQUE(regime, indicator_name)
            )
```

**Indexes:**

- `sqlite_autoindex_regime_indicator_weights_1`: (auto-index)

**Code references:**

- Reads (5 files):
  - `vps-service/engine/historical_backfill_engine.py`
  - `vps-service/api/learning_routes.py`
  - `vps-service/api/admin_routes.py`
  - `vps-service/analyzers/confluence_engine_v3.py`
  - `src/lib/analysis-engine.ts`
- Writes (1 files):
  - `vps-service/engine/historical_backfill_engine.py`

---

#### Table: `scraping_status`

- **Rows:** 0
- **Columns:** 8
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE scraping_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id TEXT NOT NULL UNIQUE,
                    status TEXT DEFAULT 'idle',
                    last_run TEXT,
                    messages_scraped INTEGER DEFAULT 0,
                    recommendations_found INTEGER DEFAULT 0,
                    news_found INTEGER DEFAULT 0,
                    error_message TEXT
                )
```

**Indexes:**

- `sqlite_autoindex_scraping_status_1`: (auto-index)

**Code references:**

- Reads (1 files):
  - `vps-service/telegram/database.py`
- Writes (1 files):
  - `vps-service/telegram/database.py`

---

#### Table: `screener_presets`

- **Rows:** 1,710
- **Columns:** 21
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=4, reads=1, writes=1
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE screener_presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                preset TEXT NOT NULL,
                ticker TEXT NOT NULL,
                name TEXT,
                name_ar TEXT,
                market TEXT DEFAULT 'EGX',
                sector TEXT,
                current_price REAL,
                previous_close REAL,
                change_1d REAL,
                change_1w REAL,
                change_1m REAL,
                volume INTEGER,
                volume_week INTEGER,
                volume_month INTEGER,
                turnover_egp REAL,
                fair_value REAL,
                upside_percent REAL,
                market_cap REAL,
                pe_ratio REAL,
                computed_at TEXT DEFAULT (datetime('now')),
                UNIQUE(ticker, market, preset)
            )
```

**Indexes:**

- `sqlite_autoindex_screener_presets_1`: (auto-index)

**Code references:**

- Reads (1 files):
  - `vps-service/api/stocks.py`
- Writes (1 files):
  - `vps-service/jobs/market_scheduler.py`

**Sample row:** `{"id":1,"preset":"most_active","ticker":"OCIC","name":"Orascom Construction Industries","name_ar":"Orascom Construction Industries","market":"EGX","sector":"Real Estate","current_price":2814.588,"previous_close":null,"change_1d":0,"change_1w":null,"change_1m":null,"volume":429839,"volume_week":null,"volume_month":null,"turnover_egp":1209819691.33,"fair_value":2952.365,"upside_percent":4.9,"market_cap":273015491468.21848,"pe_ratio":27.82,"computed_at":"2026-07-26 17:45:50"}`

---

#### Table: `screener_results`

- **Rows:** 173
- **Columns:** 9
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=2, writes=1
- **Latest record:** 2026-07-01 17:38:22 (via `scan_date`, 87 days ago — STALE)

**Schema:**
```sql
CREATE TABLE screener_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            preset TEXT NOT NULL,
            symbol TEXT NOT NULL,
            name TEXT,
            market TEXT,
            price REAL,
            score REAL,
            reason TEXT,
            scan_date TEXT NOT NULL
        )
```

**Code references:**

- Reads (2 files):
  - `vps-service/api/screener_routes.py`
  - `vps-service/analyzers/screener.py`
- Writes (1 files):
  - `vps-service/analyzers/screener.py`

**Sample row:** `{"id":141,"preset":"value","symbol":"MEGMالشرق","name":"MEGMالشرق","market":"مصر","price":12.54,"score":83,"reason":"P/E=0.7 | P/B=0.41 | Div=42.2% | Payout=0%","scan_date":"2026-07-01 11:01:26"}`

---

#### Table: `stock_adaptive_profiles`

- **Rows:** 67
- **Columns:** 19
- **Indexes:** 3
- **Status:** ACTIVE_READ_WRITE — refs=10, reads=2, writes=2
- **Latest record:** 2026-08-03T12:30:09 (via `updated_at`, 54 days ago — STALE)

**Schema:**
```sql
CREATE TABLE stock_adaptive_profiles (
                ticker TEXT PRIMARY KEY,
                sector TEXT,
                -- التذبذب التاريخي
                volatility_percentile_90d REAL,
                avg_atr_pct REAL,
                -- سلوك الحجم
                avg_volume_20d REAL,
                volume_spike_threshold REAL,
                -- النطاق الحقيقي اللي بيتحرك فيه
                typical_move_1d REAL,
                typical_move_5d REAL,
                typical_move_15d REAL,
                -- سلوك الأزمات
                reaction_to_market_crashes TEXT,
                crash_avg_drawdown REAL,
                crash_recovery_days REAL,
                -- شخصية السهم (من stock_dna_analyzer)
                personality_type_en TEXT,
                -- بيانات العينة
                history_days INTEGER,
                history_start_date TEXT,
                history_end_date TEXT,
                confidence TEXT,
                updated_at TEXT,
                profile_json TEXT,
                FOREIGN KEY (ticker) REFERENCES stocks(ticker) ON DELETE CASCADE
            )
```

**Indexes:**

- `sqlite_autoindex_stock_adaptive_profiles_1`: (auto-index)
- `idx_stock_adaptive_profiles_sector`: `CREATE INDEX idx_stock_adaptive_profiles_sector ON stock_adaptive_profiles(sector)`
- `idx_stock_adaptive_profiles_personality`: `CREATE INDEX idx_stock_adaptive_profiles_personality ON stock_adaptive_profiles(personality_type_en)`

**Code references:**

- Reads (2 files):
  - `vps-service/analyzers/stock_dna_analyzer.py`
  - `vps-service/analyzers/master_analyzer.py`
- Writes (2 files):
  - `vps-service/analyzers/stock_dna_analyzer.py`
  - `vps-service/scripts/build_stock_profiles.py`

**Sample row:** `{"ticker":"AALR","sector":"Finance","volatility_percentile_90d":50,"avg_atr_pct":5.722,"avg_volume_20d":120124,"volume_spike_threshold":4,"typical_move_1d":2.443,"typical_move_5d":14.744,"typical_move_15d":29.399,"reaction_to_market_crashes":"correlated","crash_avg_drawdown":7.52,"crash_recovery_days":27.3,"personality_type_en":"speculative_bull","history_days":5587,"history_start_date":"2004-05-06","history_end_date":"2026-07-30","confidence":"high","updated_at":"2026-08-03T12:28:01","profile_json":"{\"ticker\": \"AALR\", \"sector\": \"Finance\", \"volatility_percentile_90d\": 50.0, \"avg_atr…`

---

#### Table: `stock_daily_prices`

- **Rows:** 17,930
- **Columns:** 16
- **Indexes:** 6
- **Status:** ACTIVE_READ_WRITE — refs=66, reads=42, writes=5
- **Latest record:** 2026-09-26T19:32:41.178892 (via `fetch_time`, 0 days ago)

**Schema:**
```sql
CREATE TABLE stock_daily_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            price_date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            change_percent REAL,
            fetch_time TEXT, open_price REAL, high_price REAL, low_price REAL, close_price REAL, turnover REAL, market TEXT,
            UNIQUE(ticker, price_date)
        )
```

**Indexes:**

- `sqlite_autoindex_stock_daily_prices_1`: (auto-index)
- `idx_sdp_ticker_date`: `CREATE INDEX idx_sdp_ticker_date ON stock_daily_prices(ticker, price_date DESC)`
- `idx_sdp_date`: `CREATE INDEX idx_sdp_date ON stock_daily_prices(price_date DESC)`
- `idx_sdp_ticker`: `CREATE INDEX idx_sdp_ticker ON stock_daily_prices(ticker)`
- `idx_stock_daily_prices_ticker`: `CREATE INDEX idx_stock_daily_prices_ticker ON stock_daily_prices (ticker)`
- `idx_stock_daily_prices_price_date`: `CREATE INDEX idx_stock_daily_prices_price_date ON stock_daily_prices (price_date)`

**Code references:**

- Reads (42 files):
  - `vps-service/lightweight_server.py`
  - `vps-service/engines/v38_backtest_engine.py`
  - `vps-service/engines/master_backfill_adapter.py`
  - `vps-service/import_egx30_production.py`
  - `vps-service/jobs/v40_2_daily_generator.py`
  - `vps-service/jobs/market_scheduler.py`
  - … +32 more
- Writes (5 files):
  - `data_engine/sync.py`
  - `vps-service/lightweight_server.py`
  - `vps-service/align_production_symbols.py`
  - `vps-service/data/eodhd_fetcher.py`
  - `vps-service/scripts/daily_price_updater.py`

**Sample row:** `{"id":226699,"ticker":"ACAP","price_date":"2026-06-25","open":null,"high":null,"low":null,"close":8.65,"volume":"317.39 K","change_percent":-2.15,"fetch_time":"2026-06-25T13:11:01.278826","open_price":null,"high_price":null,"low_price":null,"close_price":8.65,"turnover":null,"market":"EGX"}`

---

#### Table: `stock_phase`

- **Rows:** 1,133
- **Columns:** 25
- **Indexes:** 2
- **Status:** REFERENCED_NO_SQL — refs=1, reads=0, writes=0
- **Latest record:** 2026-08-25 22:13:11 (via `updated_at`, 32 days ago — STALE)

**Schema:**
```sql
CREATE TABLE stock_phase (
            symbol TEXT PRIMARY KEY,
            phase TEXT NOT NULL,
            phase_ar TEXT NOT NULL,
            summary_ar TEXT NOT NULL,
            support REAL,
            support_2 REAL,
            resistance REAL,
            resistance_2 REAL,
            green_floor REAL,
            invalidation REAL,
            pct_to_support REAL,
            pct_to_resistance REAL,
            rvol REAL,
            above_sma20 INTEGER,
            above_sma50 INTEGER,
            above_sma200 INTEGER,
            atr_pct REAL,
            chg_5d REAL,
            chg_20d REAL,
            correction_ending_score INTEGER DEFAULT 0,
            breakout_ready INTEGER DEFAULT 0,
            profit_taking_risk INTEGER DEFAULT 0,
            last_close REAL,
            computed_at TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
```

**Indexes:**

- `sqlite_autoindex_stock_phase_1`: (auto-index)
- `idx_stock_phase_phase`: `CREATE INDEX idx_stock_phase_phase ON stock_phase(phase)`

**Code references:** ⚠️ None found — orphan table.

**Sample row:** `{"symbol":"1010","phase":"TREND_UP_HOLD","phase_ar":"المنطقة الخضراء — فوق المتوسطات وثبت","summary_ar":"السهم فوق منطقته الإيجابية وثبات نسبي","support":11.936,"support_2":11.3392,"resistance":13.216,"resistance_2":13.8768,"green_floor":12.5908,"invalidation":11.6881,"pct_to_support":5.95,"pct_to_resistance":4.14,"rvol":0.97,"above_sma20":1,"above_sma50":1,"above_sma200":1,"atr_pct":3.84,"chg_5d":-1.67,"chg_20d":6.43,"correction_ending_score":0,"breakout_ready":0,"profit_taking_risk":0,"last_close":12.691,"computed_at":"2026-08-25T22:02:19+00:00","updated_at":"2026-08-25 22:02:19"}`

---

#### Table: `stocks`

- **Rows:** 976
- **Columns:** 58
- **Indexes:** 6
- **Status:** ACTIVE_READ_WRITE — refs=637, reads=288, writes=23
- **Latest record:** 2026-09-26T19:32:41.178892 (via `last_update`, 0 days ago)

**Schema:**
```sql
CREATE TABLE stocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            name TEXT,
            name_ar TEXT,
            market TEXT NOT NULL DEFAULT 'EGX',
            sector TEXT,
            industry TEXT,
            current_price REAL,
            previous_close REAL,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            change_percent REAL,
            volume INTEGER,
            market_cap REAL,
            pe_ratio REAL,
            pb_ratio REAL,
            ps_ratio REAL,
            eps REAL,
            roe REAL,
            roa REAL,
            debt_to_equity REAL,
            current_ratio REAL,
            book_value_per_share REAL,
            ma_50 REAL,
            ma_200 REAL,
            rsi REAL,
            support REAL,
            resistance REAL,
            signal REAL,
            trend TEXT,
            dividend_yield REAL,
            profit_margin REAL,
            avg_volume REAL,
            beta REAL,
            high_52w REAL,
            low_52w REAL,
            close REAL,
            change_value REAL,
            is_active INTEGER DEFAULT 1,
            is_egx30 INTEGER DEFAULT 0,
            is_egx70 INTEGER DEFAULT 0,
            is_egx100 INTEGER DEFAULT 0,
            last_update TEXT,
            created_at TEXT,
            updated_at TEXT
        , dps_ttm REAL DEFAULT 0, free_float_percentage REAL, free_float_shares INTEGER, change REAL, last_updated TEXT, currency TEXT DEFAULT 'EGP', exchange TEXT DEFAULT 'EGX', is_suspended INTEGER DEFAULT 0, is_egx INTEGER DEFAULT 1, turnover_egp REAL, value_traded REAL, logo_url TEXT DEFAULT '')
```

**Indexes:**

- `idx_stocks_market`: `CREATE INDEX idx_stocks_market ON stocks(market)`
- `idx_stocks_ticker`: `CREATE UNIQUE INDEX idx_stocks_ticker ON stocks(ticker)`
- `idx_stocks_sector`: `CREATE INDEX idx_stocks_sector ON stocks (sector)`
- `idx_stocks_is_egx30`: `CREATE INDEX idx_stocks_is_egx30 ON stocks (is_egx30)`
- `idx_stocks_is_egx70`: `CREATE INDEX idx_stocks_is_egx70 ON stocks (is_egx70)`
- `idx_stocks_is_egx100`: `CREATE INDEX idx_stocks_is_egx100 ON stocks (is_egx100)`

**Code references:**

- Reads (288 files):
  - `data_engine/simple_server.py`
  - `data_engine/sync.py`
  - `data_engine/engine_server.py`
  - `data_engine/scrapers/fallback_chain.py`
  - `data_engine/scrapers/historical_fetcher_5years.py`
  - `data_engine/scrapers/yahoo_scraper.py`
  - … +278 more
- Writes (23 files):
  - `data_engine/sync.py`
  - `data_engine/scrapers/yahoo_scraper.py`
  - `data_engine/scrapers/tradingview_rest.py`
  - `data_engine/scrapers/egxpilot_scraper.py`
  - `data_engine/scrapers/egksco_scraper.py`
  - `data_engine/scrapers/tradingview_scraper.py`
  - … +13 more

**Sample row:** `{"id":1,"ticker":"COMI","name":"Commercial International Bank - Egypt (CIB) S.A.E.","name_ar":"Commercial International Bank - Egypt (CIB) S.A.E.","market":"EGX","sector":"Finance","industry":null,"current_price":138.55,"previous_close":140.06,"open_price":140.96,"high_price":142,"low_price":138.01,"change_percent":-1.0781093816935534,"volume":3725471,"market_cap":476923679875,"pe_ratio":24.14,"pb_ratio":1.7,"ps_ratio":null,"eps":5.77,"roe":18,"roa":null,"debt_to_equity":0,"current_ratio":null,"book_value_per_share":null,"ma_50":null,"ma_200":204.38126,"rsi":null,"support":18.3,"resistance":22…`

---

#### Table: `stocks_backup`

- **Rows:** 335
- **Columns:** 40
- **Indexes:** 1
- **Status:** REFERENCED_NO_SQL — refs=1, reads=0, writes=0
- **Latest record:** 2026-06-04T14:40:56.072645 (via `last_update`, 114 days ago — STALE)

**Schema:**
```sql
CREATE TABLE "stocks_backup" (
        id INTEGER PRIMARY KEY, ticker TEXT UNIQUE, name TEXT, 
        market TEXT DEFAULT 'EGX', sector TEXT, current_price REAL, volume INTEGER
    , is_active INTEGER DEFAULT 1, previous_close REAL DEFAULT 0, is_egx30 INTEGER DEFAULT 0, is_egx70 INTEGER DEFAULT 0, is_egx100 INTEGER DEFAULT 0, name_ar TEXT, open_price REAL DEFAULT 0, high_price REAL DEFAULT 0, low_price REAL DEFAULT 0, change_percent REAL DEFAULT 0, change_value REAL DEFAULT 0, pe_ratio REAL DEFAULT 0, pb_ratio REAL DEFAULT 0, market_cap REAL DEFAULT 0, dividend_yield REAL DEFAULT 0, eps REAL DEFAULT 0, beta REAL DEFAULT 0, avg_volume REAL DEFAULT 0, high_52w REAL DEFAULT 0, low_52w REAL DEFAULT 0, ma_50 REAL DEFAULT 0, ma_200 REAL DEFAULT 0, rsi REAL DEFAULT 0, macd REAL DEFAULT 0, signal REAL DEFAULT 0, support REAL DEFAULT 0, resistance REAL DEFAULT 0, trend TEXT DEFAULT 'neutral', last_update TEXT, roe REAL DEFAULT 0, profit_margin REAL DEFAULT 0, debt_to_equity REAL DEFAULT 0, close REAL DEFAULT 0)
```

**Indexes:**

- `sqlite_autoindex_stocks_backup_1`: (auto-index)

**Code references:** ⚠️ None found — orphan table.

**Sample row:** `{"id":1,"ticker":"COMI","name":"سي أي بي","market":"133.33","sector":"132.55","current_price":132.5,"volume":2135067,"is_active":1,"previous_close":131.85,"is_egx30":1,"is_egx70":0,"is_egx100":1,"name_ar":"سي أي بي","open_price":132.55,"high_price":133.69,"low_price":131.8,"change_percent":0,"change_value":0,"pe_ratio":23.35,"pb_ratio":1.7,"market_cap":114165206369.15956,"dividend_yield":6.37,"eps":5.77,"beta":null,"avg_volume":0,"high_52w":0,"low_52w":0,"ma_50":null,"ma_200":204.38126,"rsi":null,"macd":0,"signal":0,"support":18.3,"resistance":22.25,"trend":"neutral","last_update":"2026-06-04T…`

---

#### Table: `system_settings`

- **Rows:** 1
- **Columns:** 7
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=5, reads=1, writes=1
- **Latest record:** 2026-08-27T15:06:54.810907Z (via `updated_at`, 30 days ago — STALE)

**Schema:**
```sql
CREATE TABLE system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                value_type TEXT DEFAULT 'float',
                description TEXT,
                category TEXT DEFAULT 'general',
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_by TEXT DEFAULT 'system'
            )
```

**Indexes:**

- `sqlite_autoindex_system_settings_1`: (auto-index)

**Code references:**

- Reads (1 files):
  - `vps-service/analyzers/engine_settings.py`
- Writes (1 files):
  - `vps-service/analyzers/engine_settings.py`

**Sample row:** `{"key":"toxic_ticker_blocklist","value":"{\"tickers\": [\"ISPH\", \"TMGH\"], \"updated_at\": \"2026-08-27T15:06:54.810815Z\", \"rule\": \"Rule 28 (TOXIC-TICKER-BLOCKLIST)\", \"min_trades\": 3, \"wr_threshold\": 40.0, \"lookback_days\": 365}","value_type":"float","description":null,"category":"general","updated_at":"2026-08-27T15:06:54.810907Z","updated_by":"system"}`

---

#### Table: `telegram_images`

- **Rows:** 0
- **Columns:** 7
- **Indexes:** 0
- **Status:** REFERENCED_NO_SQL — refs=1, reads=0, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE telegram_images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER NOT NULL,
                    channel_id TEXT NOT NULL,
                    image_path TEXT NOT NULL,
                    ocr_text TEXT,
                    processed INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
```

**Code references:** ⚠️ None found — orphan table.

---

#### Table: `telegram_messages`

- **Rows:** 0
- **Columns:** 18
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=2, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE telegram_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER NOT NULL,
                    channel_id TEXT NOT NULL,
                    channel_name TEXT,
                    text TEXT,
                    message_type TEXT DEFAULT 'general',
                    processed_text TEXT,
                    confidence REAL DEFAULT 0,
                    has_images INTEGER DEFAULT 0,
                    image_paths TEXT,
                    image_urls TEXT,
                    is_reply INTEGER DEFAULT 0,
                    reply_to_message_id INTEGER,
                    reply_to_text TEXT,
                    views INTEGER DEFAULT 0,
                    forwards INTEGER DEFAULT 0,
                    date TEXT,
                    scraped_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(message_id, channel_id)
                )
```

**Indexes:**

- `sqlite_autoindex_telegram_messages_1`: (auto-index)

**Code references:**

- Reads (2 files):
  - `vps-service/telegram/database.py`
  - `vps-service/telegram/telegram_client.py`
- Writes (1 files):
  - `vps-service/telegram/database.py`

---

#### Table: `telegram_news`

- **Rows:** 6
- **Columns:** 10
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=7, reads=3, writes=2
- **Latest record:** 2026-06-18 15:49:40 (via `created_at`, 100 days ago — STALE)

**Schema:**
```sql
CREATE TABLE telegram_news (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT,
                    summary TEXT,
                    sentiment TEXT DEFAULT 'neutral',
                    symbols TEXT,
                    raw_text TEXT,
                    channel_name TEXT,
                    market TEXT DEFAULT 'EGX',
                    date TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
```

**Code references:**

- Reads (3 files):
  - `vps-service/telegram/database.py`
  - `vps-service/api/chart_routes.py`
  - `vps-service/ai/telegram_signal_importer.py`
- Writes (2 files):
  - `vps-service/telegram/database.py`
  - `vps-service/api/telegram_routes.py`

**Sample row:** `{"id":1,"title":"CNFN        كونتكت المالية\n\n\nبالارتكاز اعلى من 4.49 يستهدف 4.94 \n\nالاغلاق فوق الاخير يستهدف5.46\n\nفوق","summary":"CNFN        كونتكت المالية\n\n\nبالارتكاز اعلى من 4.49 يستهدف 4.94 \n\nالاغلاق فوق الاخير يستهدف5.46\n\nفوق الأخير يستهدف 5.76 \n\nفوق الأخير أحدث الأرقام \n\nاستوب 4.50\n.** \n💯⚡️**","sentiment":"neutral","symbols":"","raw_text":"CNFN        كونتكت المالية\n\n\nبالارتكاز اعلى من 4.49 يستهدف 4.94 \n\nالاغلاق فوق الاخير يستهدف5.46\n\nفوق الأخير يستهدف 5.76 \n\nفوق الأخير أحدث الأرقام \n\nاستوب 4.50\n.** \n💯⚡️**","channel_name":"البورصة المصرية🇪🇬💸","market…`

---

#### Table: `telegram_recommendations`

- **Rows:** 0
- **Columns:** 17
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=3, reads=2, writes=2
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE telegram_recommendations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER NOT NULL,
                    channel_id TEXT NOT NULL,
                    channel_name TEXT,
                    symbol TEXT NOT NULL,
                    market TEXT DEFAULT 'unknown',
                    action TEXT,
                    entry_price REAL,
                    target_price REAL,
                    stop_loss REAL,
                    timeframe TEXT,
                    confidence REAL DEFAULT 0,
                    reasoning TEXT,
                    original_text TEXT,
                    expert_name TEXT,
                    is_verified INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
```

**Code references:**

- Reads (2 files):
  - `vps-service/telegram/database.py`
  - `vps-service/ai/telegram_signal_importer.py`
- Writes (2 files):
  - `vps-service/telegram/database.py`
  - `vps-service/ai/telegram_signal_importer.py`

---

#### Table: `tracked_channels`

- **Rows:** 0
- **Columns:** 10
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=1, writes=1
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE tracked_channels (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id TEXT UNIQUE NOT NULL,
                    channel_name TEXT,
                    username TEXT,
                    market TEXT DEFAULT 'unknown',
                    content_type TEXT DEFAULT 'general',
                    is_active INTEGER DEFAULT 1,
                    last_scraped TEXT,
                    total_messages INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
```

**Indexes:**

- `sqlite_autoindex_tracked_channels_1`: (auto-index)

**Code references:**

- Reads (1 files):
  - `vps-service/telegram/database.py`
- Writes (1 files):
  - `vps-service/telegram/database.py`

---

#### Table: `tuned_predictions_summary`

- **Rows:** 1
- **Columns:** 8
- **Indexes:** 0
- **Status:** REFERENCED_NO_SQL — refs=1, reads=0, writes=0
- **Latest record:** 2026-07-23 13:11:17 (via `updated_at`, 65 days ago — STALE)

**Schema:**
```sql
CREATE TABLE tuned_predictions_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_trades_count INTEGER,
        raw_win_rate REAL,
        tuned_trades_count INTEGER,
        tuned_win_rate REAL,
        tuned_avg_return REAL,
        tuned_total_return REAL,
        updated_at TEXT DEFAULT (datetime('now'))
    )
```

**Code references:** ⚠️ None found — orphan table.

**Sample row:** `{"id":1,"raw_trades_count":4035,"raw_win_rate":35.39033457249071,"tuned_trades_count":4008,"tuned_win_rate":35.62874251497006,"tuned_avg_return":-2.8005289421157684,"tuned_total_return":-11224.52,"updated_at":"2026-07-23 13:11:17"}`

---

#### Table: `user_financial_settings`

- **Rows:** 0
- **Columns:** 4
- **Indexes:** 1
- **Status:** ACTIVE_READ_ONLY — refs=2, reads=2, writes=0
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE user_financial_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL UNIQUE,
        monthly_expenses REAL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      )
```

**Indexes:**

- `sqlite_autoindex_user_financial_settings_1`: (auto-index)

**Code references:**

- Reads (2 files):
  - `src/app/api/finance/projection/route.ts`
  - `src/app/api/finance/calculate-values/route.ts`

---

#### Table: `user_notifications`

- **Rows:** 96
- **Columns:** 10
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=7, reads=6, writes=3
- **Latest record:** 2026-09-27 09:22:20 (via `created_at`, 0 days ago)

**Schema:**
```sql
CREATE TABLE user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'system',
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      severity TEXT DEFAULT 'info',
      payload TEXT,
      ticker TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
```

**Indexes:**

- `idx_user_notif_dedup`: `CREATE INDEX idx_user_notif_dedup ON user_notifications(user_id, type, ticker)`

**Code references:**

- Reads (6 files):
  - `vps-service/jobs/market_scheduler.py`
  - `src/app/api/alerts/route.ts`
  - `src/app/api/alerts/scheduler/route.ts`
  - `src/app/api/alerts/[id]/route.ts`
  - `src/lib/schedulers/alert-engine.ts`
  - `src/app/api/notifications/route.ts`
- Writes (3 files):
  - `vps-service/jobs/market_scheduler.py`
  - `src/app/api/alerts/[id]/route.ts`
  - `src/lib/schedulers/alert-engine.ts`

**Sample row:** `{"id":1,"user_id":"mohseny-admin-cuid","type":"top_up_opportunity","title":"🚀 فرصة زيادة مركز","message":"سهم 4160 رابح 17.5% (ربح 3427 ج.م) — فرصة لزيادة المركز","severity":"success","payload":"{\"avg_buy_price\":30,\"current_price\":35.24,\"quantity\":654,\"pnl_pct\":17.466666666666672,\"profit_egp\":3426.9600000000014}","ticker":"4160","read":0,"created_at":"2026-09-25 19:23:51"}`

---

#### Table: `user_sessions`

- **Rows:** 0
- **Columns:** 18
- **Indexes:** 2
- **Status:** ACTIVE_READ_WRITE — refs=2, reads=1, writes=2
- **Latest record:** (table empty)

**Schema:**
```sql
CREATE TABLE user_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT UNIQUE,
            user_id TEXT,
            ip_hash TEXT,
            user_agent TEXT,
            device_type TEXT,
            browser TEXT,
            os TEXT,
            country TEXT,
            city TEXT,
            referrer TEXT,
            landing_page TEXT,
            exit_page TEXT,
            page_views INTEGER DEFAULT 0,
            duration_seconds INTEGER DEFAULT 0,
            is_bounce INTEGER DEFAULT 0,
            started_at TEXT DEFAULT (datetime('now')),
            ended_at TEXT
        )
```

**Indexes:**

- `sqlite_autoindex_user_sessions_1`: (auto-index)
- `idx_user_sessions_user`: `CREATE INDEX idx_user_sessions_user ON user_sessions(user_id)`

**Code references:**

- Reads (1 files):
  - `src/app/api/admin/users/cleanup-expired/route.ts`
- Writes (2 files):
  - `vps-service/api/analytics.py`
  - `src/app/api/admin/users/cleanup-expired/route.ts`

---

#### Table: `user_stock_watchlists`

- **Rows:** 67
- **Columns:** 12
- **Indexes:** 0
- **Status:** ACTIVE_READ_WRITE — refs=21, reads=18, writes=6
- **Latest record:** (no date column)

**Schema:**
```sql
CREATE TABLE user_stock_watchlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT DEFAULT '',
        stock_id INTEGER,
        alert_price_above REAL,
        alert_price_below REAL,
        alert_change_percent REAL,
        notes TEXT,
        added_at TEXT DEFAULT (datetime('now')),
        last_viewed TEXT,
        view_count INTEGER DEFAULT 0
      , purchase_price REAL DEFAULT NULL, quantity INTEGER DEFAULT NULL)
```

**Code references:**

- Reads (18 files):
  - `vps-service/analyzers/smart_portfolio_monitor.py`
  - `src/app/api/watchlist/route.ts`
  - `src/app/api/watchlist/[id]/route.ts`
  - `src/app/api/alerts/route.ts`
  - `src/app/api/alerts/[id]/route.ts`
  - `src/app/api/alerts/create/route.ts`
  - … +8 more
- Writes (6 files):
  - `src/app/api/watchlist/route.ts`
  - `src/app/api/watchlist/[id]/route.ts`
  - `src/app/api/alerts/create/route.ts`
  - `src/app/api/admin/users/cleanup-expired/route.ts`
  - `src/app/api/mobile/watchlist/route.ts`
  - `src/app/api/mobile/watchlist-enhanced/route.ts`

**Sample row:** `{"id":1,"user_id":"48457b7f-40f2-4a7e-8955-d4d2cd1d79bd","stock_id":22,"alert_price_above":null,"alert_price_below":null,"alert_change_percent":null,"notes":null,"added_at":"2026-06-14 13:14:06","last_viewed":null,"view_count":0,"purchase_price":null,"quantity":null}`

---

#### Table: `wealth_tracking`

- **Rows:** 36
- **Columns:** 14
- **Indexes:** 1
- **Status:** ACTIVE_READ_WRITE — refs=6, reads=3, writes=2
- **Latest record:** 2026-08-28 12:19:09 (via `created_at`, 29 days ago)

**Schema:**
```sql
CREATE TABLE wealth_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    snapshot_date TEXT NOT NULL,
    total_invested REAL DEFAULT 0,
    total_current_value REAL DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    total_pnl_pct REAL DEFAULT 0,
    stocks_value REAL DEFAULT 0,
    gold_value REAL DEFAULT 0,
    crypto_value REAL DEFAULT 0,
    bank_value REAL DEFAULT 0,
    cash_value REAL DEFAULT 0,
    other_value REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, snapshot_date)
)
```

**Indexes:**

- `sqlite_autoindex_wealth_tracking_1`: (auto-index)

**Code references:**

- Reads (3 files):
  - `src/components/portfolio/WealthCharts.tsx`
  - `vps-service/scripts/wealth_tracker.py`
  - `src/app/api/portfolio/equity-curve/route.ts`
- Writes (2 files):
  - `vps-service/jobs/daily_portfolio_yield.py`
  - `vps-service/scripts/wealth_tracker.py`

**Sample row:** `{"id":7,"user_id":"48457b7f-40f2-4a7e-8955-d4d2cd1d79bd","snapshot_date":"2026-08-17","total_invested":6459242.33,"total_current_value":6506191.36,"total_pnl":46949.03,"total_pnl_pct":0.73,"stocks_value":215473.75,"gold_value":96000,"crypto_value":0,"bank_value":6194717.61,"cash_value":0,"other_value":0,"created_at":"2026-08-17 12:20:56"}`

---

## 4. Cross-Database Map

Several tables appear in multiple databases. The Phase-4 `market.db` consolidation plan (documented in `vps-service/utils/db_paths.py`) was never completed; only `auth.db` and `predictions.db` are properly placed. The intended "market.db" role is currently split across `stocks.db + price_history.db + data_engine.db + intraday.db`.

### 4.1 Duplicated tables (same schema, different DBs)

| Table | Locations (rows) | Canonical DB | Action |
|-------|------------------|--------------|--------|
| `stocks` | `stocks.db` (976) · `data_engine.db` (296) | `stocks.db` | Investigate — 296 rows in data_engine may be stale duplicates |
| `gold_prices` | `data_engine.db` (187,153) · `stocks.db` (3) | `data_engine.db` | `stocks.db` copy is stale — DROP |
| `cached_analysis` | `stocks.db` (143, fresh) · `predictions.db` (0) | `stocks.db` | `predictions.db` copy unused — DROP |
| `learned_lessons` | `predictions.db` (19,464) · `stocks.db` (0, different schema!) | `predictions.db` | Different schemas — `stocks.db` copy is legacy — DROP |
| `egksco_price_history` | `data_engine.db` (13,246) · `stocks.db` (0, different schema) | `data_engine.db` | `stocks.db` copy is empty legacy — DROP |
| `egksco_stocks` | `stocks.db` (250) · `data_engine.db` (0) | `stocks.db` | `data_engine.db` copy empty — DROP |
| `portfolios` | `predictions.db` (4) · `stocks.db` (3) | unclear | Both populated — needs decision |
| `ExpertRecommendation` | `stocks.db` (127, fresh) · `auth.db` (17) · `predictions.db` (17) | `stocks.db` | Auth/predictions copies stale (115d) — DROP |
| `telegram_news` | `stocks.db` (6) · `predictions.db` (0) | `stocks.db` | `predictions.db` copy empty — DROP |
| `User` | `auth.db` (100) · `custom.db` (0) | `auth.db` | `custom.db` is legacy — DELETE FILE |
| `Post` | `auth.db` (0) · `custom.db` (0) | `auth.db` | `custom.db` is legacy — DELETE FILE |
| `user_trades` | `auth.db` (0) · `predictions.db` (0) | unclear | Both empty — needs decision |

### 4.2 Logical cross-DB references

Code joins are **not possible across DB files** in SQLite (no FDW), so cross-DB relationships are logical only:

- `predictions.db.predictions.ticker` ← references `stocks.db.stocks.ticker` (and `price_history.db.price_history.ticker`)
- `predictions.db.stored_analyses.ticker` ← references `stocks.db.stocks.ticker`
- `predictions.db.crypto_predictions_log.symbol` ← references `data_engine.db.crypto_prices.symbol`
- `predictions.db.exit_notifications.prediction_id` ← FK to `predictions.db.predictions.id`
- `intraday.db.stock_intraday.ticker` ← references `stocks.db.stocks.ticker` (and `price_history.db.price_history.ticker`)
- `stocks.db.user_stock_watchlists.ticker` ← references `stocks.db.stocks.ticker`
- `stocks.db.stock_daily_prices.ticker` ← references `stocks.db.stocks.ticker`
- `stocks.db.radar_signal_tracking.ticker` ← references `stocks.db.stocks.ticker`
- `auth.db.User.id` ← linked by `user_stock_watchlists.user_id`, `user_notifications.user_id`, `api_tokens.user_id`
- `auth.db.PromoCode` / `SubscriptionPlan` / `UserSubscription` ← linked by `User.id` (Prisma relations)

## 5. Orphan Tables

Tables with NO code references anywhere in `src/`, `vps-service/`, `data_engine/`, or `telegram-events/` (excluding `db_paths.py` config-only mentions).

| Table | DB | Rows | Notes |
|-------|----|-----:|-------|
| `lost_and_found` | db/data_engine.db | 38 | Looks like a debugging table (38 random rows). No queries anywhere. |
| `session_events` | db/predictions.db | 0 | Schema created but no reads/writes. |
| `session_event_sent_log` | db/predictions.db | 0 | Companion log table for session_events — also unused. |
| `VerificationToken` | db/auth.db | 0 | NextAuth Prisma table — no code path uses it (auth is via custom JWT). |

**Effectively orphan (only mentioned in `db_paths.py` routing config, no real SQL queries):**

| Table | DB | Rows | Note |
|-------|----|-----:|------|
| `stock_phase` | db/stocks.db | 1,133 | 1133 rows of stock-phase data (Weinstein stage analysis) but no `FROM stock_phase` SQL anywhere. |
| `stocks_backup` | db/stocks.db | 335 | Backup snapshot from 2026-06-04. No reads. Should DROP. |
| `real_evaluated_predictions` | db/stocks.db | 4,035 | 4035 evaluated predictions but no `FROM real_evaluated_predictions` SQL anywhere. Possibly superseded by `prediction_outcomes`. |
| `tuned_predictions_summary` | db/stocks.db | 1 | Single config row, no reads. |
| `prediction_outcomes_old` | db/predictions.db | 0 | Explicit "_old" suffix — empty, dead. |
| `telegram_images` | db/stocks.db | 0 | Schema present but never queried. |

## 6. Stale Data

Tables where the latest record is older than 30 days (cutoff: 2026-08-28). Sorted by age.

| Table | DB | Rows | Latest | Column | Days old |
|-------|----|-----:|--------|--------|---------:|
| `market_indices` | db/stocks.db | 5 | 2026-03-11 00:48:04.798 +00:00 | `last_update` | 200 |
| `SubscriptionPlan` | db/auth.db | 3 | 2026-04-29 20:50:22 | `created_at` | 150 |
| `indicator_trust_scores` | db/stocks.db | 10 | 2026-05-04 18:56:35 | `last_updated` | 145 |
| `ExpertRecommendation` | db/auth.db | 17 | 2026-06-03 23:27:03 | `created_at` | 115 |
| `ExpertRecommendation` | db/predictions.db | 17 | 2026-06-03 23:27:03 | `created_at` | 115 |
| `gold_prices` | db/stocks.db | 3 | 2026-06-03T16:52:36.506Z | `last_update` | 115 |
| `stocks_backup` | db/stocks.db | 335 | 2026-06-04T14:40:56.072645 | `last_update` | 114 |
| `historical_data` | db/data_engine.db | 99,076 | 2026-06-07 | `date` | 112 |
| `stock_prices` | db/data_engine.db | 692 | 2026-06-07 12:47:52 | `timestamp` | 111 |
| `telegram_news` | db/stocks.db | 6 | 2026-06-18 15:49:40 | `created_at` | 100 |
| `conjunction_patterns` | db/stocks.db | 150 | 2026-06-25T02:29:31.831932 | `last_updated` | 94 |
| `outcome_logs` | db/stocks.db | 8,544 | 2026-06-25T02:29:31.695648 | `created_at` | 94 |
| `screener_results` | db/stocks.db | 173 | 2026-07-01 17:38:22 | `scan_date` | 87 |
| `task_runs` | db/auth.db | 75 | 2026-07-12 12:58:10 | `created_at` | 76 |
| `portfolios` | db/predictions.db | 4 | 2026-07-22 14:04:08 | `created_at` | 66 |
| `portfolios` | db/stocks.db | 3 | 2026-07-22 15:17:16 | `created_at` | 66 |
| `egksco_stocks` | db/stocks.db | 250 | 2026-07-23T13:41:57.648276 | `last_update` | 65 |
| `tuned_predictions_summary` | db/stocks.db | 1 | 2026-07-23 13:11:17 | `updated_at` | 65 |
| `PromoCode` | db/auth.db | 5 | 2026-07-30 08:21:54 | `created_at` | 59 |
| `User` | db/auth.db | 100 | 2026-07-30 09:23:58 | `created_at` | 59 |
| `prediction_lessons` | db/predictions.db | 4 | 2026-07-30 20:11:08 | `created_at` | 58 |
| `stock_adaptive_profiles` | db/stocks.db | 67 | 2026-08-03T12:30:09 | `updated_at` | 54 |
| `api_tokens` | db/auth.db | 6 | 2026-08-18T12:52:04.715Z | `created_at` | 39 |
| `stock_phase` | db/stocks.db | 1,133 | 2026-08-25 22:13:11 | `updated_at` | 32 |
| `egksco_sync_status` | db/stocks.db | 451 | 2026-08-27 11:20:14 | `sync_time` | 31 |
| `morning_bell_signals` | db/predictions.db | 82 | 2026-08-27T13:05:31+00:00 | `created_at` | 30 |
| `system_settings` | db/stocks.db | 1 | 2026-08-27T15:06:54.810907Z | `updated_at` | 30 |

### Stale data highlights

- **`market_indices`** (5 rows, 200 days old) — EGX30 index snapshot last updated 2026-03-11. The market overview UI likely shows stale index values.
- **`SubscriptionPlan`** (3 rows, 150 days old) — subscription tier definitions last touched 2026-04-29; if pricing changed since, this is outdated.
- **`indicator_trust_scores`** (10 rows, 145 days old) — indicator-trust system has not been re-evaluated since 2026-05-04.
- **`historical_data`** (99K rows, 112 days old) — daily-price bulk import from Yahoo/EODHD has not run since 2026-06-07. Probably superseded by `price_history` table.
- **`stock_prices`** in data_engine.db (692 rows, 111 days old) — same root cause.
- **`stocks_backup`** (335 rows, 114 days old) — old backup table.
- **`outcome_logs`** (8,544 rows, 94 days old) — prediction outcome log not being written since 2026-06-25; possibly migrated to `prediction_outcomes` (which is empty — bug?).
- **`screener_results`** (173 rows, 87 days old) — last scan 2026-07-01; the screener backend is stale.

## 7. Hidden Gems

Tables containing potentially valuable data that may not be surfaced in the UI, or whose full value is under-utilized.

| Table | DB | Rows | Latest | Hidden value |
|-------|----|-----:|--------|--------------|
| `tab_balance_sheet` | db/data_engine.db | 866 | (no date col) | 866 balance-sheet snapshots per stock — could power deep fundamental screening. |
| `tab_cash_flow` | db/data_engine.db | 866 | (no date col) | 866 cash-flow statements — useful for free-cash-flow yields. |
| `tab_dividends` | db/data_engine.db | 858 | (no date col) | 858 dividend histories — never surfaced as dividend-yield screener. |
| `tab_income_statement` | db/data_engine.db | 866 | (no date col) | Income statements — could power P/E, P/S, PEG screening. |
| `tab_performance` | db/data_engine.db | 858 | (no date col) | Performance metrics (1W/1M/3M/1Y returns per stock) — no UI consumer. |
| `tab_profitability` | db/data_engine.db | 858 | (no date col) | ROE/ROA/margins — only the surface tab_valuation is read. |
| `tab_technical_analysis` | db/data_engine.db | 863 | (no date col) | Pre-computed technical indicators (RSI, MACD, MA) for 863 stocks. |
| `tab_valuation` | db/data_engine.db | 858 | (no date col) | Valuation ratios (P/E, P/B, EV/EBITDA) — surface only via `tab_valuation`. |
| `historical_trades` | db/predictions.db | 13,117 | 2026-09-12 | 13K historical trade records (entry/exit dates + prices) — could power strategy backtests but only `historical_trade_generator.py` writes; no reader surfaces them. |
| `persona_predictions` | db/predictions.db | 1,669 | 2026-08-30 | 1,669 persona-tagged predictions — could compare persona accuracy. |
| `exit_notifications` | db/predictions.db | 3,932 | 2026-09-24 | 3,932 historical exit signals — useful for replay/learning UI but only `daily_closer.py` writes them. |
| `stock_stories` | db/predictions.db | 899 | 2026-08-11 | AI-generated narrative stories for 899 stock-prediction pairs — possibly a hidden UX surface. |
| `corporate_actions` | db/predictions.db | 106 | 2026-09-18 | 106 corporate-action events (splits, dividends, name changes) — not surfaced in stock detail UI. |
| `learned_lessons` | db/predictions.db | 19,464 | 2026-09-25 | 19K lesson records (condition → outcome → recommendation) — high-value training data for the AI engine; reads only via `learning_engine.py`. |
| `investors_data` | db/stocks.db | 30 | 2026-09-26 | Daily EGX investors-flow (foreigners/Arabs/locals net buy) — fresh but only consumed by `InvestorsFlowPanel`. |
| `market_regime_log` | db/stocks.db | 34 | 2026-08-28 | 34 regime-change events — would be valuable as a timeline UI. |
| `stock_adaptive_profiles` | db/stocks.db | 67 | 2026-08-03 | Adaptive per-stock profiles (DNA) for 67 stocks — should be expanded. |
| `screener_presets` | db/stocks.db | 1,710 | (preset configs) | 1,710 screener preset configurations — could enable screener template sharing. |
| `lost_and_found` | db/data_engine.db | 38 | (no date col) | 38 mystery rows in an unnamed schema-less table — worth investigating. |

## 8. Index Recommendations

Audit of indexes on the 16 tables with >10,000 rows.

### 8.1 Missing indexes (high priority)

| Table | Rows | Missing index on column(s) | Why it matters |
|-------|-----:|---------------------------|-----------------|
| `predictions.db.historical_trades` | 13,117 | `buy_date`, `sell_date`, `created_at` | Backtest queries filter by date range — currently must full-scan. Has `idx_hist_ticker`, `idx_hist_pattern`, `idx_hist_strategy` but no date index. |
| `data_engine.db.exchange_rates` | 48,977 | `timestamp` (only autoindex exists) | Time-series FX queries likely filter by timestamp — table has only `sqlite_autoindex_exchange_rates_1` (uniqueness constraint), no range index. |
| `predictions.db.learned_lessons` | 19,464 | `updated_at` | `learning_engine.py` reads recent updates; only `idx_learned_lessons_type_created(lesson_type, created_at)` exists. Add `idx_learned_lessons_updated(updated_at)`. |

### 8.2 Redundant indexes (DROP candidates)

| Table | Redundant indexes | Recommendation |
|-------|-------------------|----------------|
| `price_history.db.price_history` | `idx_price_history_ticker_date(ticker, date)` AND `idx_ph_ticker_date(ticker, date)` — identical definition. Also `idx_price_history_ticker` is redundant because the composite covers it (leftmost prefix). | DROP `idx_ph_ticker_date` (exact duplicate) and `idx_price_history_ticker` (covered by composite). Saves ~50 MB index space. |
| `stocks.db.stock_daily_prices` | 4 overlapping indexes on `ticker`: `idx_sdp_ticker_date(ticker, price_date DESC)`, `idx_sdp_ticker(ticker)`, `idx_stock_daily_prices_ticker(ticker)`. Plus 2 overlapping on `price_date`: `idx_sdp_date(price_date DESC)`, `idx_stock_daily_prices_price_date(price_date)`. | DROP `idx_sdp_ticker`, `idx_stock_daily_prices_ticker`, `idx_sdp_date`, `idx_stock_daily_prices_price_date` — keep `idx_sdp_ticker_date` (DESC composite) as canonical. Saves ~3-4 MB. |
| `predictions.db.stored_analyses` | `idx_stored_ticker(ticker)` AND `idx_stored_ticker_market(ticker, market)` AND `idx_stored_ticker_date(ticker, created_at DESC)` — three indexes all starting with `ticker`. The composite `idx_stored_ticker_market` covers plain `ticker` lookups. | DROP `idx_stored_ticker`. Keep `idx_stored_ticker_market` and `idx_stored_ticker_date`. |
| `data_engine.db.egksco_price_history` | `idx_egksco_ph_symbol_date(symbol, price_date DESC)` AND `idx_egksco_ph_sym_date(symbol, price_date)` — semantically identical (DESC vs default ASC, but for one-row-per-date the ordering is irrelevant). | DROP `idx_egksco_ph_sym_date` (the UNIQUE autoindex already enforces uniqueness). |
| `predictions.db.predictions` | `idx_predictions_date(prediction_date)` AND `idx_predictions_prediction_date(prediction_date)` — exact duplicate. Also `idx_predictions_outcome(outcome_date, hit_target, hit_stop)` overlaps with `idx_predictions_status(outcome_date, hit_target, hit_stop)` (same definition!). | DROP `idx_predictions_prediction_date` (duplicate of `idx_predictions_date`). DROP `idx_predictions_status` (duplicate of `idx_predictions_outcome`). |

### 8.3 Index summary by table

| Table | DB | Rows | Indexes | Date coverage | Ticker coverage |
|-------|----|-----:|--------:|---------------|------------------|
| `btc_local_prices` | db/data_engine.db | 84,065 | 2 | ✅ | n/a |
| `crypto_prices` | db/data_engine.db | 294,526 | 3 | ✅ | ✅ |
| `egksco_price_history` | db/data_engine.db | 13,246 | 3 | ✅ | ✅ |
| `exchange_rates` | db/data_engine.db | 48,977 | 1 | ❌ | n/a |
| `gold_prices` | db/data_engine.db | 187,153 | 2 | ✅ | n/a |
| `gold_prices_clean` | db/data_engine.db | 31,360 | 2 | ✅ | n/a |
| `historical_data` | db/data_engine.db | 99,076 | 4 | ✅ | ✅ |
| `silver_prices` | db/data_engine.db | 86,038 | 2 | ✅ | n/a |
| `commodity_intraday` | db/intraday.db | 59,960 | 3 | ✅ | ✅ |
| `crypto_intraday` | db/intraday.db | 324,630 | 3 | ✅ | ✅ |
| `stock_intraday` | db/intraday.db | 215,632 | 4 | ✅ | ✅ |
| `crypto_predictions_log` | db/predictions.db | 151,912 | 2 | ✅ | ✅ |
| `historical_trades` | db/predictions.db | 13,117 | 3 | ❌ | ✅ |
| `learned_lessons` | db/predictions.db | 19,464 | 1 | partial | n/a |
| `price_history` | db/price_history.db | 1,206,795 | 6 | ✅ | ✅ |
| `stock_daily_prices` | db/stocks.db | 17,930 | 6 | ✅ | ✅ |

## 9. Schema Issues

### 9.1 Tables without PRIMARY KEY

| Table | DB | Rows | Issue |
|-------|----|-----:|-------|
| `VerificationToken` | db/auth.db | 0 | No PK defined — risk of duplicate rows. |
| `lost_and_found` | db/data_engine.db | 38 | No PK defined — risk of duplicate rows. |

### 9.2 Tables with 0 rows but active code (potential bugs)

These tables are read or written by code but have zero data — a workflow gap.

| Table | DB | Status | Notes |
|-------|----|--------|-------|
| `User` | db/custom.db | ACTIVE_READ_WRITE (refs=235, reads=33, writes=13) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `stored_analyses` | db/predictions.db | ACTIVE_READ_WRITE (refs=48, reads=28, writes=10) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `egksco_price_history` | db/stocks.db | ACTIVE_READ_ONLY (refs=31, reads=18, writes=0) | Code reads from empty table — likely bug |
| `learned_lessons` | db/stocks.db | ACTIVE_READ_WRITE (refs=29, reads=13, writes=5) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `cached_analysis` | db/predictions.db | ACTIVE_READ_WRITE (refs=21, reads=8, writes=7) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `egksco_stocks` | db/data_engine.db | ACTIVE_READ_WRITE (refs=14, reads=8, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `crypto_predictions` | db/predictions.db | ACTIVE_READ_WRITE (refs=2, reads=4, writes=3) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `financial_obligations` | db/stocks.db | ACTIVE_READ_WRITE (refs=7, reads=6, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `egx_fundamentals` | db/data_engine.db | ACTIVE_READ_WRITE (refs=8, reads=4, writes=2) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `financial_transactions` | db/stocks.db | ACTIVE_READ_WRITE (refs=5, reads=4, writes=2) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `regime_indicator_weights` | db/stocks.db | ACTIVE_READ_WRITE (refs=10, reads=5, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `Post` | db/auth.db | ACTIVE_READ_WRITE (refs=415, reads=2, writes=3) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `Post` | db/custom.db | ACTIVE_READ_WRITE (refs=415, reads=2, writes=3) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `telegram_news` | db/predictions.db | ACTIVE_READ_WRITE (refs=7, reads=3, writes=2) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `platform_recommendations` | db/predictions.db | ACTIVE_READ_WRITE (refs=3, reads=2, writes=2) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `feature_usage` | db/stocks.db | ACTIVE_READ_WRITE (refs=4, reads=2, writes=2) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `obligation_payments` | db/stocks.db | ACTIVE_READ_WRITE (refs=3, reads=2, writes=2) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `page_views` | db/stocks.db | ACTIVE_READ_WRITE (refs=6, reads=2, writes=2) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `telegram_recommendations` | db/stocks.db | ACTIVE_READ_WRITE (refs=3, reads=2, writes=2) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `equity_snapshots` | db/predictions.db | ACTIVE_READ_WRITE (refs=3, reads=2, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `portfolio_state` | db/predictions.db | ACTIVE_READ_WRITE (refs=3, reads=2, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `gold_alerts` | db/stocks.db | ACTIVE_READ_WRITE (refs=3, reads=2, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `news_items` | db/stocks.db | ACTIVE_READ_ONLY (refs=8, reads=3, writes=0) | Code reads from empty table — likely bug |
| `telegram_messages` | db/stocks.db | ACTIVE_READ_WRITE (refs=3, reads=2, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `user_sessions` | db/stocks.db | ACTIVE_READ_WRITE (refs=2, reads=1, writes=2) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `Session` | db/auth.db | ACTIVE_READ_ONLY (refs=117, reads=2, writes=0) | Code reads from empty table — likely bug |
| `user_trades` | db/auth.db | ACTIVE_READ_WRITE (refs=3, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `intraday_prices` | db/intraday.db | ACTIVE_READ_ONLY (refs=6, reads=2, writes=0) | Code reads from empty table — likely bug |
| `cash_transactions` | db/predictions.db | ACTIVE_READ_WRITE (refs=1, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `crypto_lessons` | db/predictions.db | ACTIVE_READ_WRITE (refs=2, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `hunter_pick_tracking` | db/predictions.db | ACTIVE_READ_WRITE (refs=1, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `portfolio_pnl_history` | db/predictions.db | ACTIVE_READ_WRITE (refs=1, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `portfolio_positions` | db/predictions.db | ACTIVE_READ_WRITE (refs=1, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `prediction_outcomes` | db/predictions.db | ACTIVE_READ_WRITE (refs=3, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `reports` | db/predictions.db | ACTIVE_READ_WRITE (refs=44, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `telegram_signals` | db/predictions.db | ACTIVE_READ_ONLY (refs=2, reads=2, writes=0) | Code reads from empty table — likely bug |
| `trade_journal_entries` | db/predictions.db | ACTIVE_READ_WRITE (refs=1, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `trade_journal_reflections` | db/predictions.db | ACTIVE_READ_WRITE (refs=1, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `trade_outcomes` | db/predictions.db | ACTIVE_READ_WRITE (refs=3, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `user_trades` | db/predictions.db | ACTIVE_READ_WRITE (refs=3, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `pending_settlements` | db/stocks.db | ACTIVE_READ_WRITE (refs=2, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `scraping_status` | db/stocks.db | ACTIVE_READ_WRITE (refs=3, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `tracked_channels` | db/stocks.db | ACTIVE_READ_WRITE (refs=2, reads=1, writes=1) | CRITICAL: code reads AND writes but table empty — pipeline broken |
| `user_financial_settings` | db/stocks.db | ACTIVE_READ_ONLY (refs=2, reads=2, writes=0) | Code reads from empty table — likely bug |
| `Account` | db/auth.db | ACTIVE_READ_ONLY (refs=25, reads=1, writes=0) | Code reads from empty table — likely bug |
| `daily_analytics_summary` | db/stocks.db | WRITE_ONLY (refs=1, reads=0, writes=1) | Code writes to empty table — write path may be failing silently |
| `error_logs` | db/stocks.db | WRITE_ONLY (refs=1, reads=0, writes=1) | Code writes to empty table — write path may be failing silently |
| `ExpertTrackRecord` | db/auth.db | REFERENCED_NO_SQL (refs=4, reads=0, writes=0) | Code writes to empty table — write path may be failing silently |
| `UserSubscription` | db/auth.db | REFERENCED_NO_SQL (refs=19, reads=0, writes=0) | Code writes to empty table — write path may be failing silently |
| `analysis_jobs` | db/predictions.db | REFERENCED_NO_SQL (refs=2, reads=0, writes=0) | Code writes to empty table — write path may be failing silently |
| `prediction_outcomes_old` | db/predictions.db | REFERENCED_NO_SQL (refs=1, reads=0, writes=0) | Code writes to empty table — write path may be failing silently |
| `context_logs` | db/stocks.db | REFERENCED_NO_SQL (refs=5, reads=0, writes=0) | Code writes to empty table — write path may be failing silently |
| `telegram_images` | db/stocks.db | REFERENCED_NO_SQL (refs=1, reads=0, writes=0) | Code writes to empty table — write path may be failing silently |

### 9.3 Schema drift / evolutionary scars

- `predictions.db.predictions` has **67 columns** including 4 distinct timestamp columns (`prediction_date`, `outcome_date`, `created_at`, `updated_at`, `closed_at`) and 4 distinct price columns (`entry_price`, `exit_price`, `actual_exit_price`, `partial_exit_price`). Schema has clearly been extended many times via `ALTER TABLE … ADD COLUMN`. Consider a normalised redesign.
- `stocks.db.stocks` has **58 columns** including `signal` (INTEGER), `signal_ar` (TEXT), `last_update` (TEXT ISO), `last_updated` (TEXT ISO), `updated_at` (TEXT ISO), `created_at` (TEXT ISO) — 3 timestamp columns with similar names.
- `stocks.db.stock_daily_prices` has duplicate column pairs: `open`/`open_price`, `high`/`high_price`, `low`/`low_price`, `close`/`close_price` — one set is legacy, the other newer. Both populate (or one set is NULL).
- `predictions.db.learned_lessons` and `stocks.db.learned_lessons` have **completely different schemas** under the same name. The `stocks.db` one has 8 columns + 0 indexes; the `predictions.db` one has 10 columns + 1 index.
- `predictions.db.stored_analyses` has TEXT PRIMARY KEY `id` generated via `lower(hex(randomblob(16)))` — 32-char hex. Risk of collision under heavy writes is negligible but consider INTEGER PK for performance.
- `predictions.db.crypto_predictions_log` schema contains literal newlines and trailing whitespace from f-string concatenation — works but harder to maintain.

### 9.4 Empty tables without code (truly dead)

3 tables have 0 rows AND no code references — safe to DROP after verification:

| Table | DB |
|-------|----|
| `VerificationToken` | db/auth.db |
| `session_event_sent_log` | db/predictions.db |
| `session_events` | db/predictions.db |

## 10. Recommendations

Prioritized action list (P0 = blocking / data-integrity, P1 = important cleanup, P2 = nice-to-have).

### P0 — Critical / blocking

1. **Investigate why `stored_analyses` is empty.** It is read by 28 files including `ReportsView.tsx` (UI), `auto_poster.py` (Telegram), `picks_management_routes.py`, and `ai_routes.py`. Either the write pipeline (`v40_2_daily_generator.py`, `background_analyzer.py`) has been failing for >24h, or a recent purge (`PurgeCacheButton.tsx`) cleared it. Verify the V40.2 daily generator is actually running and check `analysis_engine_status` for clues.

2. **Investigate why `hunter_pick_tracking` is empty.** The Picks Management UI queries it via `prediction_tracking_routes.py:292` (`SELECT * FROM hunter_pick_tracking WHERE status='pending'`). Pick-generation code path needs verification.

3. **Restore `price_history` data freshness.** 1.2M rows but latest record is 2026-09-07 (19 days stale). Run `vps-service/jobs/price_history_safetynet.py` manually and check logs. Same root cause for `historical_data` (112 days stale).

4. **Fix duplicate `predictions` indexes.** DROP `idx_predictions_prediction_date` (duplicate of `idx_predictions_date`) and `idx_predictions_status` (duplicate of `idx_predictions_outcome`). Both currently waste disk space and slow writes.

### P1 — Important cleanup

5. **Delete `custom.db`** (file). Per `src/lib/new-db.ts` comments it is supposed to be removed. Currently 0 rows in `Post`/`User`. Also delete `db/predictions.db.original` (4.9 MB stale backup).

6. **DROP duplicate `stocks.db` tables that are stale/empty:**
   - `gold_prices` (3 rows, 115 days stale) — canonical is `data_engine.db.gold_prices` (187K rows).
   - `learned_lessons` (0 rows, different schema) — canonical is `predictions.db.learned_lessons` (19K rows).
   - `egksco_price_history` (0 rows, different schema) — canonical is `data_engine.db.egksco_price_history` (13K rows).
   - `stocks_backup` (335 rows, 114 days stale) — explicit backup, no reads.

7. **DROP duplicate `predictions.db` tables that are empty:**
   - `cached_analysis` (0 rows) — canonical is `stocks.db.cached_analysis` (143 rows, fresh).
   - `telegram_news` (0 rows) — canonical is `stocks.db.telegram_news` (6 rows).
   - `prediction_outcomes_old` (explicit "_old").
   - `session_events`, `session_event_sent_log` (no usage).

8. **DROP fully-orphan tables in `stocks.db`:**
   - `stock_phase` (1,133 rows, no reads) — confirm and migrate if needed.
   - `real_evaluated_predictions` (4,035 rows, no reads) — confirm and migrate if needed.
   - `tuned_predictions_summary`, `telegram_images` (empty orphans).

9. **Add missing indexes:**
   - `historical_trades`: `CREATE INDEX idx_hist_buy_date ON historical_trades(buy_date);` (and on `sell_date`).
   - `exchange_rates`: `CREATE INDEX idx_exchange_rates_ts ON exchange_rates(timestamp);`.
   - `learned_lessons`: `CREATE INDEX idx_ll_updated ON learned_lessons(updated_at);`.

10. **Restore `screener_results` freshness** — last scan 2026-07-01 (87 days stale). The screener job is not running.

### P2 — Nice-to-have / architectural

11. **Resume the Phase-4 `market.db` consolidation** (per `vps-service/utils/db_paths.py`): fold `stocks.db + price_history.db + data_engine.db + intraday.db` into a single `market.db` (using `ATTACH DATABASE` for migration). Currently `market.db` is 0 bytes (never created).

12. **Document the canonical-DB-for-table map** — `db_paths.get_db_for_table()` already exists but is incomplete (e.g. `radar_signal_tracking` is missing from the routing dictionary). Update it to cover all 127 tables.

13. **Fix `predictions.db.predictions` schema bloat** — 67 columns including 4 timestamp columns and 4 price columns (entry/exit/actual_exit/partial_exit). Split into `predictions` (core) + `prediction_outcomes` (already exists but empty) + `prediction_exits` (new).

14. **Standardize timestamp column naming** — `stocks` table has both `last_update`, `last_updated`, and `updated_at`. Pick one and migrate.

15. **Surface hidden-gem tables in UI** — e.g. `tab_dividends`, `corporate_actions`, `market_regime_log`, `historical_trades` are all populated but never read by UI components.

### P3 — Schema integrity (low priority but recommended)

16. **Add PRIMARY KEY to `VerificationToken` and `lost_and_found`** — only 2 tables without PK.
17. **Remove duplicate column pairs in `stock_daily_prices`** (`open`/`open_price`, etc.) — pick one canonical name.
18. **Add `NOT NULL` constraints** to critical fields like `predictions.entry_price` (already NOT NULL ✓), `predictions.target_price` (currently nullable), `stored_analyses.entry_price` (defaults to 0 — should be NOT NULL).

## 11. Methodology

### 11.1 Inspection approach

1. **DB file discovery** — `Glob('**/*.db')` against `/home/z/my-project` (excluding `node_modules`). Found 7 `.db` files in `/home/z/my-project/db/`.
2. **Schema extraction** — Node.js script (`agent-ctx/_audit_inspect.cjs`) opens each DB with `better-sqlite3` in `readonly: true, fileMustExist: true` mode (no writes possible). For each table it records: `CREATE TABLE` SQL, `PRAGMA table_info()`, `sqlite_master` indexes, `COUNT(*)`, sample row (`SELECT * LIMIT 1`), and `MAX(<date_col>)` for any column matching `/date|time|created|updated|signal|prediction|pick/i`.
3. **Output**: full JSON dump at `agent-ctx/_audit_data.json` (615 KB) containing every table, column, index, count, and freshness date.

### 11.2 Usage analysis

4. **Code reference search** — `rg` (ripgrep) searched `src/`, `vps-service/`, `data_engine/`, `telegram-events/` for each table name with three patterns:
   - `\b<table>\b` — any mention (TS types, SQL strings, doc comments).
   - `(FROM|JOIN)\s+<table>` — read queries.
   - `(INSERT INTO|UPDATE|REPLACE INTO|DELETE FROM)\s+<table>` — write queries.
5. **Classification** — `ACTIVE_READ_WRITE`, `ACTIVE_READ_ONLY`, `WRITE_ONLY`, `ORPHAN` (zero refs), `REFERENCED_NO_SQL` (mentioned but no clear FROM/INSERT SQL — usually TS types).
6. **Output**: `agent-ctx/_audit_usage.json` with file lists per table.

### 11.3 Freshness analysis

7. For every table with at least one date-like column, compute the maximum date value across all date columns. Compare to today (2026-09-27) and flag as stale if older than 30 days.

### 11.4 Index audit

8. For every table with >10,000 rows, check column types for date/timestamp and ticker/symbol columns, then verify whether at least one index covers each. Flag redundant indexes (identical or leftmost-prefix-overlapping definitions).

### 11.5 Limitations

- The usage analysis is **regex-based**. SQL queries constructed via string concatenation with the table name as a variable are not detected. Tables are flagged as `ORPHAN` only when no literal occurrence of the name appears anywhere.
- The freshness analysis depends on date columns being correctly named. Tables with custom date column names (e.g. `signal_date`) may still be detected; tables using epoch integers are not.
- Cross-database logical relationships are inferred from table names and code patterns; no foreign keys exist in SQLite by default in this codebase.
- Row counts are exact (`COUNT(*)`); for the 1.2M-row `price_history` table the count took ~50ms.
- The `db_paths.py` routing dictionary mentions additional tables (e.g. `morning_bell_signals`, `crypto_predictions_log`) that are correctly read by code — these were verified manually.

---

**Report generated:** 2026-09-27  
**Auditor:** Database Auditor (مساعد السكرتيرة لقواعد البيانات)  
**Audit ID:** AUDIT-DB  
**Files produced:**
- `agent-ctx/AUDIT_DATABASES.md` (this report)
- `agent-ctx/_audit_data.json` (raw schema + counts)
- `agent-ctx/_audit_usage.json` (per-table code-reference map)
- `agent-ctx/_audit_inspect.cjs` (DB inspection script)
- `agent-ctx/_audit_usage.cjs` (usage grep script)
