-- ===============================================
-- SQL Script to Fix Production Database Issues
-- Run this on the production server:
-- sqlite3 <project_root>/db/stocks.db < fix_production_db.sql
-- ===============================================

-- 1. Fix email_verified column - convert Unix timestamps to proper DateTime format
-- The value "1780269841979" is a Unix timestamp in milliseconds
-- SQLite datetime function expects seconds, so divide by 1000

-- First, let's see the current problematic values
SELECT 'Checking email_verified values before fix:';
SELECT id, email, email_verified FROM users WHERE typeof(email_verified) = 'text' AND email_verified GLOB '*[0-9]*';

-- Fix: Convert numeric string timestamps to ISO datetime format
-- This handles values like "1780269841979" (milliseconds)
UPDATE users 
SET email_verified = datetime(CAST(email_verified AS REAL) / 1000, 'unixepoch')
WHERE typeof(email_verified) = 'text' 
  AND email_verified GLOB '*[0-9]*'
  AND length(email_verified) > 10;

-- Verify the fix
SELECT 'Checking email_verified values after fix:';
SELECT id, email, email_verified FROM users;

-- 2. Add Account table if it doesn't exist
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
    created_at TEXT DEFAULT (datetime('now'))
);

-- Create unique index for Account
CREATE UNIQUE INDEX IF NOT EXISTS sqlite_autoindex_Account_1 ON Account(provider, providerAccountId);
CREATE INDEX IF NOT EXISTS idx_Account_userId ON Account(userId);

-- 3. Add missing columns to ApiToken table if they don't exist
-- SQLite doesn't have IF NOT EXISTS for columns, so we use a workaround

-- Add device_info column
ALTER TABLE ApiToken ADD COLUMN device_info TEXT;

-- Add ip_address column
ALTER TABLE ApiToken ADD COLUMN ip_address TEXT;

-- 4. Verify all tables exist
SELECT 'All tables in database:';
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;

-- 5. Verify ApiToken table structure
SELECT 'ApiToken table structure:';
PRAGMA table_info(ApiToken);

-- 6. Verify Account table structure
SELECT 'Account table structure:';
PRAGMA table_info(Account);

SELECT 'Database fix completed!';
