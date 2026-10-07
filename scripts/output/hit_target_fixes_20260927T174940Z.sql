-- ============================================================
-- hit_target reconciliation — suggested UPDATE statements
-- ============================================================
-- Generated: 2026-09-27T17:49:40.865196+00:00Z
-- Source DBs: predictions.db + price_history.db
-- Total checked: 1213  |  Mismatches: 15  |  Insufficient data: 37
--
-- IMPORTANT: every UPDATE is COMMENTED OUT. Review each one and
-- uncomment individually before applying. Setting actual_return=NULL
-- forces the reviewer to recompute the correct return — do not
-- blindly apply.
-- ============================================================

-- MISMATCH: prediction id=51390 ticker=LKGP date=2026-09-01
-- Recorded: closed_stop (actual_return=-13.28%)
-- Actual:   EXPIRED (max_high=3.6900, min_low=3.5500, target=3.9000, stop=3.4400, rows_in_window=3)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51390;

-- MISMATCH: prediction id=51328 ticker=ORTE date=2026-08-16
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=45.7681, min_low=45.1024, target=67.4200, stop=42.7500, rows_in_window=2)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51328;

-- MISMATCH: prediction id=51333 ticker=ORTE date=2026-08-17
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=45.7681, min_low=45.1024, target=67.4200, stop=42.7500, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51333;

-- MISMATCH: prediction id=51336 ticker=REAC date=2026-08-17
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=9.4500, min_low=9.2500, target=161.7000, stop=8.8200, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51336;

-- MISMATCH: prediction id=51338 ticker=ORTE date=2026-08-18
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=45.7681, min_low=45.1024, target=67.4200, stop=42.7500, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51338;

-- MISMATCH: prediction id=51340 ticker=REAC date=2026-08-18
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=9.4500, min_low=9.2500, target=161.7000, stop=8.8200, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51340;

-- MISMATCH: prediction id=51348 ticker=ORTE date=2026-08-20
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=45.7681, min_low=45.1024, target=67.4200, stop=42.7500, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51348;

-- MISMATCH: prediction id=51353 ticker=ORTE date=2026-08-23
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=45.7681, min_low=45.1024, target=67.4200, stop=42.7500, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51353;

-- MISMATCH: prediction id=51355 ticker=REAC date=2026-08-23
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=9.4500, min_low=9.2500, target=161.7000, stop=8.8200, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51355;

-- MISMATCH: prediction id=51358 ticker=ORTE date=2026-08-24
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=45.7681, min_low=45.1024, target=67.4200, stop=42.7500, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51358;

-- MISMATCH: prediction id=51361 ticker=REAC date=2026-08-24
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=9.4500, min_low=9.2500, target=161.7000, stop=8.8200, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51361;

-- MISMATCH: prediction id=51368 ticker=ORTE date=2026-08-26
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=45.7681, min_low=45.1024, target=67.4200, stop=42.7500, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51368;

-- MISMATCH: prediction id=51371 ticker=REAC date=2026-08-26
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=9.4500, min_low=9.2500, target=161.7000, stop=8.8200, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51371;

-- MISMATCH: prediction id=51373 ticker=ORTE date=2026-08-27
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=45.7681, min_low=45.1024, target=67.4200, stop=42.7500, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51373;

-- MISMATCH: prediction id=51376 ticker=REAC date=2026-08-27
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   EXPIRED (max_high=9.4500, min_low=9.2500, target=161.7000, stop=8.8200, rows_in_window=1)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51376;

