-- ============================================================
-- hit_target reconciliation — suggested UPDATE statements
-- ============================================================
-- Generated: 2026-09-27T16:21:10.253415+00:00Z
-- Source DBs: predictions.db + price_history.db
-- Total checked: 1213  |  Mismatches: 478  |  Insufficient data: 37
--
-- IMPORTANT: every UPDATE is COMMENTED OUT. Review each one and
-- uncomment individually before applying. Setting actual_return=NULL
-- forces the reviewer to recompute the correct return — do not
-- blindly apply.
-- ============================================================

-- MISMATCH: prediction id=50281 ticker=PHDC date=2025-10-09
-- Recorded: closed_win (actual_return=+119.61%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=6.1120, target=19.0500, stop=5.7600, rows_in_window=248)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50281;

-- MISMATCH: prediction id=50475 ticker=ABUK date=2025-12-03
-- Recorded: closed_win (actual_return=+106.52%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.2100, stop=42.6700, rows_in_window=209)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50475;

-- MISMATCH: prediction id=50470 ticker=ABUK date=2025-12-02
-- Recorded: closed_win (actual_return=+105.62%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.2500, stop=42.8600, rows_in_window=210)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50470;

-- MISMATCH: prediction id=50465 ticker=ABUK date=2025-12-01
-- Recorded: closed_win (actual_return=+105.39%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.2600, stop=42.9100, rows_in_window=211)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50465;

-- MISMATCH: prediction id=50481 ticker=ABUK date=2025-12-04
-- Recorded: closed_win (actual_return=+105.30%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.3000, target=136.2600, stop=42.9300, rows_in_window=208)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50481;

-- MISMATCH: prediction id=50461 ticker=ABUK date=2025-11-30
-- Recorded: closed_win (actual_return=+103.96%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.3200, stop=43.2000, rows_in_window=212)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50461;

-- MISMATCH: prediction id=50455 ticker=ABUK date=2025-11-27
-- Recorded: closed_win (actual_return=+103.70%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.3400, stop=43.2600, rows_in_window=213)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50455;

-- MISMATCH: prediction id=50451 ticker=ABUK date=2025-11-26
-- Recorded: closed_win (actual_return=+103.65%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.3400, stop=43.2700, rows_in_window=214)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50451;

-- MISMATCH: prediction id=50415 ticker=ABUK date=2025-11-17
-- Recorded: closed_win (actual_return=+103.52%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.3400, stop=43.3000, rows_in_window=221)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50415;

-- MISMATCH: prediction id=50446 ticker=ABUK date=2025-11-25
-- Recorded: closed_win (actual_return=+103.17%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.3600, stop=43.3700, rows_in_window=215)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50446;

-- MISMATCH: prediction id=50409 ticker=ABUK date=2025-11-16
-- Recorded: closed_win (actual_return=+102.90%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.3700, stop=43.4300, rows_in_window=222)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50409;

-- MISMATCH: prediction id=50405 ticker=ABUK date=2025-11-13
-- Recorded: closed_win (actual_return=+102.81%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.3800, stop=43.4500, rows_in_window=223)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50405;

-- MISMATCH: prediction id=50394 ticker=ABUK date=2025-11-11
-- Recorded: closed_win (actual_return=+102.59%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.3900, stop=43.5000, rows_in_window=225)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50394;

-- MISMATCH: prediction id=50399 ticker=ABUK date=2025-11-12
-- Recorded: closed_win (actual_return=+102.38%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.4000, stop=43.5400, rows_in_window=224)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50399;

-- MISMATCH: prediction id=50389 ticker=ABUK date=2025-11-10
-- Recorded: closed_win (actual_return=+101.98%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.4100, stop=43.6300, rows_in_window=226)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50389;

-- MISMATCH: prediction id=50440 ticker=ABUK date=2025-11-24
-- Recorded: closed_win (actual_return=+101.59%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.4300, stop=43.7200, rows_in_window=216)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50440;

-- MISMATCH: prediction id=50432 ticker=ABUK date=2025-11-20
-- Recorded: closed_win (actual_return=+101.51%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.4400, stop=43.7300, rows_in_window=218)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50432;

-- MISMATCH: prediction id=50384 ticker=ABUK date=2025-11-09
-- Recorded: closed_win (actual_return=+101.12%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.4500, stop=43.8200, rows_in_window=227)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50384;

-- MISMATCH: prediction id=50420 ticker=ABUK date=2025-11-18
-- Recorded: closed_win (actual_return=+101.07%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.4600, stop=43.8300, rows_in_window=220)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50420;

-- MISMATCH: prediction id=50436 ticker=ABUK date=2025-11-23
-- Recorded: closed_win (actual_return=+101.07%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.4600, stop=43.8300, rows_in_window=217)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50436;

-- MISMATCH: prediction id=50527 ticker=ABUK date=2025-12-17
-- Recorded: closed_win (actual_return=+101.07%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=46.5200, target=136.4600, stop=43.8300, rows_in_window=199)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50527;

-- MISMATCH: prediction id=50424 ticker=ABUK date=2025-11-19
-- Recorded: closed_win (actual_return=+100.86%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.4700, stop=43.8800, rows_in_window=219)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50424;

-- MISMATCH: prediction id=50379 ticker=ABUK date=2025-11-06
-- Recorded: closed_win (actual_return=+100.51%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.1800, target=136.4800, stop=43.9500, rows_in_window=228)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50379;

-- MISMATCH: prediction id=50487 ticker=ABUK date=2025-12-07
-- Recorded: closed_win (actual_return=+99.36%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=45.6500, target=136.5400, stop=44.2000, rows_in_window=207)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50487;

-- MISMATCH: prediction id=50522 ticker=ABUK date=2025-12-16
-- Recorded: closed_win (actual_return=+99.36%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=46.5200, target=136.5400, stop=44.2000, rows_in_window=200)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50522;

-- MISMATCH: prediction id=50497 ticker=ABUK date=2025-12-09
-- Recorded: closed_win (actual_return=+98.01%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=46.5200, target=136.6000, stop=44.5000, rows_in_window=205)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50497;

-- MISMATCH: prediction id=50516 ticker=ABUK date=2025-12-15
-- Recorded: closed_win (actual_return=+96.44%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=46.5200, target=136.6800, stop=44.8700, rows_in_window=201)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50516;

-- MISMATCH: prediction id=50500 ticker=ABUK date=2025-12-10
-- Recorded: closed_win (actual_return=+96.07%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=46.5200, target=136.6900, stop=44.9500, rows_in_window=204)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50500;

-- MISMATCH: prediction id=50512 ticker=ABUK date=2025-12-14
-- Recorded: closed_win (actual_return=+95.82%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=46.5200, target=136.7100, stop=45.0100, rows_in_window=202)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50512;

-- MISMATCH: prediction id=50506 ticker=ABUK date=2025-12-11
-- Recorded: closed_win (actual_return=+94.16%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=46.5200, target=136.7900, stop=45.3900, rows_in_window=203)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50506;

-- MISMATCH: prediction id=50339 ticker=ABUK date=2025-10-27
-- Recorded: closed_win (actual_return=+93.96%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=136.8000, stop=45.4300, rows_in_window=236)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50339;

-- MISMATCH: prediction id=50349 ticker=ABUK date=2025-10-29
-- Recorded: closed_win (actual_return=+93.20%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=136.8400, stop=45.6100, rows_in_window=234)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50349;

-- MISMATCH: prediction id=50344 ticker=ABUK date=2025-10-28
-- Recorded: closed_win (actual_return=+93.00%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=136.8500, stop=45.6600, rows_in_window=235)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50344;

-- MISMATCH: prediction id=50356 ticker=ABUK date=2025-10-30
-- Recorded: closed_win (actual_return=+92.80%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=136.8600, stop=45.7100, rows_in_window=233)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50356;

-- MISMATCH: prediction id=50362 ticker=ABUK date=2025-11-02
-- Recorded: closed_win (actual_return=+92.76%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=136.8600, stop=45.7200, rows_in_window=232)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50362;

-- MISMATCH: prediction id=50335 ticker=ABUK date=2025-10-26
-- Recorded: closed_win (actual_return=+90.33%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=136.9800, stop=46.3000, rows_in_window=237)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50335;

-- MISMATCH: prediction id=50222 ticker=PHDC date=2025-09-23
-- Recorded: closed_win (actual_return=+89.83%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=19.2400, stop=6.6600, rows_in_window=260)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50222;

-- MISMATCH: prediction id=50326 ticker=ABUK date=2025-10-22
-- Recorded: closed_win (actual_return=+87.78%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=137.1200, stop=46.9400, rows_in_window=239)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50326;

-- MISMATCH: prediction id=50629 ticker=ABUK date=2026-01-15
-- Recorded: closed_win (actual_return=+87.33%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=49.0100, target=125.5900, stop=47.0400, rows_in_window=178)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50629;

-- MISMATCH: prediction id=50598 ticker=ABUK date=2026-01-06
-- Recorded: closed_win (actual_return=+85.54%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=49.0100, target=125.6800, stop=47.4900, rows_in_window=185)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50598;

-- MISMATCH: prediction id=50573 ticker=ABUK date=2025-12-30
-- Recorded: closed_win (actual_return=+84.52%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=48.9000, target=125.7400, stop=47.7600, rows_in_window=190)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50573;

-- MISMATCH: prediction id=50237 ticker=PHDC date=2025-09-28
-- Recorded: closed_win (actual_return=+84.36%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=19.2800, stop=6.8600, rows_in_window=257)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50237;

-- MISMATCH: prediction id=50227 ticker=PHDC date=2025-09-24
-- Recorded: closed_win (actual_return=+84.11%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=19.2800, stop=6.8700, rows_in_window=259)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50227;

-- MISMATCH: prediction id=50232 ticker=PHDC date=2025-09-25
-- Recorded: closed_win (actual_return=+84.11%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=19.2800, stop=6.8700, rows_in_window=258)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50232;

-- MISMATCH: prediction id=50277 ticker=PHDC date=2025-10-08
-- Recorded: closed_win (actual_return=+83.86%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=17.6700, stop=6.8700, rows_in_window=249)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50277;

-- MISMATCH: prediction id=50251 ticker=PHDC date=2025-10-01
-- Recorded: closed_win (actual_return=+82.61%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=19.3000, stop=6.9200, rows_in_window=254)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50251;

-- MISMATCH: prediction id=50247 ticker=PHDC date=2025-09-30
-- Recorded: closed_win (actual_return=+82.11%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=19.3000, stop=6.9400, rows_in_window=255)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50247;

-- MISMATCH: prediction id=50568 ticker=ABUK date=2025-12-29
-- Recorded: closed_win (actual_return=+82.01%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=48.9000, target=125.8800, stop=48.4200, rows_in_window=191)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50568;

-- MISMATCH: prediction id=50273 ticker=PHDC date=2025-10-07
-- Recorded: closed_win (actual_return=+81.62%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=17.6900, stop=6.9600, rows_in_window=250)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50273;

-- MISMATCH: prediction id=50267 ticker=PHDC date=2025-10-06
-- Recorded: closed_win (actual_return=+81.38%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=19.3100, stop=6.9700, rows_in_window=251)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50267;

-- MISMATCH: prediction id=50287 ticker=PHDC date=2025-10-12
-- Recorded: closed_win (actual_return=+81.38%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.2100, target=19.3100, stop=6.9700, rows_in_window=247)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50287;

-- MISMATCH: prediction id=50242 ticker=PHDC date=2025-09-29
-- Recorded: closed_win (actual_return=+81.13%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=19.3100, stop=6.9800, rows_in_window=256)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50242;

-- MISMATCH: prediction id=50257 ticker=PHDC date=2025-10-02
-- Recorded: closed_win (actual_return=+80.89%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=19.3100, stop=6.9900, rows_in_window=253)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50257;

-- MISMATCH: prediction id=50638 ticker=ABUK date=2026-01-18
-- Recorded: closed_win (actual_return=+80.89%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=50.0300, target=125.9400, stop=48.7200, rows_in_window=177)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50638;

-- MISMATCH: prediction id=50617 ticker=ABUK date=2026-01-12
-- Recorded: closed_win (actual_return=+80.09%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=49.0100, target=125.9900, stop=48.9400, rows_in_window=181)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50617;

-- MISMATCH: prediction id=50553 ticker=ABUK date=2025-12-24
-- Recorded: closed_win (actual_return=+79.85%)
-- Actual:   STOPPED (max_high=124.6290, min_low=48.9000, target=126.0000, stop=49.0000, rows_in_window=194)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50553;

-- MISMATCH: prediction id=50263 ticker=PHDC date=2025-10-05
-- Recorded: closed_win (actual_return=+79.20%)
-- Actual:   STOPPED (max_high=16.4300, min_low=6.1120, target=19.3200, stop=7.0500, rows_in_window=252)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50263;

-- MISMATCH: prediction id=50290 ticker=ABUK date=2025-10-13
-- Recorded: closed_win (actual_return=+78.24%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=137.6500, stop=49.4400, rows_in_window=246)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50290;

-- MISMATCH: prediction id=50643 ticker=ABUK date=2026-01-19
-- Recorded: closed_win (actual_return=+76.69%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=51.6600, target=126.1900, stop=49.8800, rows_in_window=176)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50643;

-- MISMATCH: prediction id=50296 ticker=ABUK date=2025-10-14
-- Recorded: closed_win (actual_return=+76.13%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=137.7800, stop=50.0300, rows_in_window=245)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50296;

-- MISMATCH: prediction id=50611 ticker=ABUK date=2026-01-11
-- Recorded: closed_win (actual_return=+75.96%)
-- Actual:   STOPPED (max_high=124.6290, min_low=49.0100, target=126.2300, stop=50.0800, rows_in_window=182)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50611;

-- MISMATCH: prediction id=50307 ticker=ABUK date=2025-10-16
-- Recorded: closed_win (actual_return=+75.53%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=137.8100, stop=50.2000, rows_in_window=243)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50307;

-- MISMATCH: prediction id=50647 ticker=ABUK date=2026-01-20
-- Recorded: closed_win (actual_return=+75.14%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=52.0400, target=126.2800, stop=50.3100, rows_in_window=175)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50647;

-- MISMATCH: prediction id=50321 ticker=ABUK date=2025-10-21
-- Recorded: closed_win (actual_return=+74.59%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=137.8700, stop=50.4800, rows_in_window=240)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50321;

-- MISMATCH: prediction id=50313 ticker=ABUK date=2025-10-19
-- Recorded: closed_win (actual_return=+73.94%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=137.9100, stop=50.6700, rows_in_window=242)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50313;

-- MISMATCH: prediction id=50316 ticker=ABUK date=2025-10-20
-- Recorded: closed_win (actual_return=+73.87%)
-- Actual:   STOPPED (max_high=124.6290, min_low=45.1800, target=137.9100, stop=50.6900, rows_in_window=241)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50316;

-- MISMATCH: prediction id=50443 ticker=PHDC date=2025-11-24
-- Recorded: closed_win (actual_return=+70.13%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.8600, target=19.4000, stop=7.4300, rows_in_window=216)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50443;

-- MISMATCH: prediction id=50453 ticker=PHDC date=2025-11-26
-- Recorded: closed_win (actual_return=+69.70%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.9000, target=19.4100, stop=7.4400, rows_in_window=214)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50453;

-- MISMATCH: prediction id=50323 ticker=PHDC date=2025-10-21
-- Recorded: closed_win (actual_return=+67.79%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.7400, target=19.4300, stop=7.5300, rows_in_window=240)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50323;

-- MISMATCH: prediction id=50373 ticker=PHDC date=2025-11-04
-- Recorded: closed_win (actual_return=+63.90%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.7500, target=19.4600, stop=7.7100, rows_in_window=230)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50373;

-- MISMATCH: prediction id=50547 ticker=PHDC date=2025-12-23
-- Recorded: closed_win (actual_return=+62.91%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.9900, target=17.8600, stop=7.7600, rows_in_window=195)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50547;

-- MISMATCH: prediction id=50533 ticker=PHDC date=2025-12-18
-- Recorded: closed_win (actual_return=+61.93%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.9900, target=19.4800, stop=7.8100, rows_in_window=198)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50533;

-- MISMATCH: prediction id=50538 ticker=PHDC date=2025-12-21
-- Recorded: closed_win (actual_return=+61.93%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.9900, target=17.8700, stop=7.8100, rows_in_window=197)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50538;

-- MISMATCH: prediction id=50377 ticker=PHDC date=2025-11-05
-- Recorded: closed_win (actual_return=+60.96%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.7500, target=19.4900, stop=7.8500, rows_in_window=229)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50377;

-- MISMATCH: prediction id=50552 ticker=PHDC date=2025-12-24
-- Recorded: closed_win (actual_return=+60.96%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.9900, target=17.8800, stop=7.8500, rows_in_window=194)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50552;

-- MISMATCH: prediction id=50902 ticker=PHDC date=2026-04-01
-- Recorded: closed_win (actual_return=+60.96%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=8.2100, target=17.8800, stop=7.8500, rows_in_window=124)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50902;

-- MISMATCH: prediction id=50597 ticker=PHDC date=2026-01-06
-- Recorded: closed_win (actual_return=+60.57%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.9900, target=17.8800, stop=7.8700, rows_in_window=185)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50597;

-- MISMATCH: prediction id=50897 ticker=PHDC date=2026-03-31
-- Recorded: closed_win (actual_return=+60.19%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.9900, target=17.8900, stop=7.8900, rows_in_window=125)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50897;

-- MISMATCH: prediction id=50913 ticker=PHDC date=2026-04-05
-- Recorded: closed_win (actual_return=+59.62%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=8.2100, target=17.8900, stop=7.9200, rows_in_window=122)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50913;

-- MISMATCH: prediction id=50932 ticker=PHDC date=2026-04-09
-- Recorded: closed_win (actual_return=+59.43%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=8.3900, target=17.8900, stop=7.9300, rows_in_window=118)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50932;

-- MISMATCH: prediction id=50625 ticker=PHDC date=2026-01-14
-- Recorded: closed_win (actual_return=+59.24%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.9900, target=17.9000, stop=7.9400, rows_in_window=179)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50625;

-- MISMATCH: prediction id=50632 ticker=PHDC date=2026-01-15
-- Recorded: closed_win (actual_return=+58.87%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=7.9900, target=17.9000, stop=7.9600, rows_in_window=178)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50632;

-- MISMATCH: prediction id=50908 ticker=PHDC date=2026-04-02
-- Recorded: closed_win (actual_return=+58.87%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=8.2100, target=17.9000, stop=7.9600, rows_in_window=123)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50908;

-- MISMATCH: prediction id=50917 ticker=PHDC date=2026-04-06
-- Recorded: closed_win (actual_return=+58.87%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=8.2100, target=17.9000, stop=7.9600, rows_in_window=121)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50917;

-- MISMATCH: prediction id=50667 ticker=ABUK date=2026-01-26
-- Recorded: closed_win (actual_return=+58.81%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=58.1200, target=127.3800, stop=55.4900, rows_in_window=171)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50667;

-- MISMATCH: prediction id=50567 ticker=PHDC date=2025-12-29
-- Recorded: closed_win (actual_return=+58.30%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9100, stop=7.9900, rows_in_window=191)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50567;

-- MISMATCH: prediction id=50846 ticker=PHDC date=2026-03-17
-- Recorded: closed_win (actual_return=+58.30%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9100, stop=7.9900, rows_in_window=135)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50846;

-- MISMATCH: prediction id=50502 ticker=PHDC date=2025-12-10
-- Recorded: closed_win (actual_return=+58.12%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=19.5200, stop=7.9900, rows_in_window=204)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50502;

-- MISMATCH: prediction id=50507 ticker=PHDC date=2025-12-11
-- Recorded: closed_win (actual_return=+58.12%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=19.5200, stop=7.9900, rows_in_window=203)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50507;

-- MISMATCH: prediction id=50637 ticker=PHDC date=2026-01-18
-- Recorded: closed_win (actual_return=+58.12%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9100, stop=7.9900, rows_in_window=177)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50637;

-- MISMATCH: prediction id=50572 ticker=PHDC date=2025-12-30
-- Recorded: closed_win (actual_return=+57.93%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9100, stop=8.0000, rows_in_window=190)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50572;

-- MISMATCH: prediction id=50851 ticker=PHDC date=2026-03-18
-- Recorded: closed_win (actual_return=+57.93%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9100, stop=8.0000, rows_in_window=134)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50851;

-- MISMATCH: prediction id=50563 ticker=PHDC date=2025-12-28
-- Recorded: closed_win (actual_return=+57.19%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9200, stop=8.0400, rows_in_window=192)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50563;

-- MISMATCH: prediction id=50578 ticker=PHDC date=2025-12-31
-- Recorded: closed_win (actual_return=+56.10%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9300, stop=8.1000, rows_in_window=189)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50578;

-- MISMATCH: prediction id=50927 ticker=PHDC date=2026-04-08
-- Recorded: closed_win (actual_return=+55.74%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=8.3900, target=17.9300, stop=8.1200, rows_in_window=119)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50927;

-- MISMATCH: prediction id=50817 ticker=PHDC date=2026-03-09
-- Recorded: closed_win (actual_return=+55.02%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9400, stop=8.1600, rows_in_window=141)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50817;

-- MISMATCH: prediction id=50831 ticker=PHDC date=2026-03-12
-- Recorded: closed_win (actual_return=+54.84%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9400, stop=8.1700, rows_in_window=138)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50831;

-- MISMATCH: prediction id=50876 ticker=PHDC date=2026-03-25
-- Recorded: closed_win (actual_return=+54.48%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9500, stop=8.1800, rows_in_window=129)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50876;

-- MISMATCH: prediction id=50613 ticker=PHDC date=2026-01-11
-- Recorded: closed_win (actual_return=+52.90%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9700, stop=8.2700, rows_in_window=182)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50613;

-- MISMATCH: prediction id=50728 ticker=PHDC date=2026-02-11
-- Recorded: closed_win (actual_return=+50.00%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=18.0000, stop=8.4200, rows_in_window=159)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50728;

-- MISMATCH: prediction id=50826 ticker=PHDC date=2026-03-11
-- Recorded: closed_win (actual_return=+50.00%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9700, stop=8.2800, rows_in_window=141)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50826;

-- MISMATCH: prediction id=50777 ticker=PHDC date=2026-02-25
-- Recorded: expired (actual_return=+49.50%)
-- Actual:   TARGET_HIT (max_high=16.4300, min_low=7.9900, target=16.3800, stop=8.4500, rows_in_window=149)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50777;

-- MISMATCH: prediction id=50793 ticker=PHDC date=2026-03-02
-- Recorded: expired (actual_return=+49.15%)
-- Actual:   TARGET_HIT (max_high=16.4300, min_low=7.9900, target=16.3500, stop=8.3300, rows_in_window=148)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50793;

-- MISMATCH: prediction id=50703 ticker=PHDC date=2026-02-04
-- Recorded: closed_win (actual_return=+48.98%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9800, stop=8.3400, rows_in_window=166)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50703;

-- MISMATCH: prediction id=50889 ticker=MASR date=2026-03-30
-- Recorded: expired (actual_return=+48.84%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=5.0100, target=45.1900, stop=4.8500, rows_in_window=127)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50889;

-- MISMATCH: prediction id=50951 ticker=PHDC date=2026-04-15
-- Recorded: closed_win (actual_return=+48.65%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=8.7000, target=19.6000, stop=8.3600, rows_in_window=116)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50951;

-- MISMATCH: prediction id=50783 ticker=PHDC date=2026-02-26
-- Recorded: expired (actual_return=+48.51%)
-- Actual:   TARGET_HIT (max_high=16.4300, min_low=7.9900, target=16.3900, stop=8.5100, rows_in_window=148)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50783;

-- MISMATCH: prediction id=50787 ticker=PHDC date=2026-03-01
-- Recorded: expired (actual_return=+48.31%)
-- Actual:   TARGET_HIT (max_high=16.4300, min_low=7.9900, target=16.3600, stop=8.3700, rows_in_window=149)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50787;

-- MISMATCH: prediction id=50823 ticker=PHDC date=2026-03-10
-- Recorded: closed_win (actual_return=+48.31%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=17.9900, stop=8.3700, rows_in_window=142)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50823;

-- MISMATCH: prediction id=50676 ticker=ABUK date=2026-01-28
-- Recorded: expired (actual_return=+46.04%)
-- Actual:   TARGET_HIT (max_high=124.6290, min_low=62.0100, target=116.8600, stop=60.3400, rows_in_window=169)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50676;

-- MISMATCH: prediction id=50795 ticker=MASR date=2026-03-03
-- Recorded: expired (actual_return=+45.18%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=5.0100, target=45.2200, stop=4.9800, rows_in_window=146)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50795;

-- MISMATCH: prediction id=50762 ticker=PHDC date=2026-02-22
-- Recorded: closed_win (actual_return=+45.14%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=18.0600, stop=8.7100, rows_in_window=152)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50762;

-- MISMATCH: prediction id=50800 ticker=MASR date=2026-03-04
-- Recorded: expired (actual_return=+44.91%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=5.0100, target=45.2200, stop=4.9900, rows_in_window=145)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50800;

-- MISMATCH: prediction id=50737 ticker=PHDC date=2026-02-15
-- Recorded: closed_win (actual_return=+44.52%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=18.0700, stop=8.7500, rows_in_window=157)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50737;

-- MISMATCH: prediction id=50740 ticker=PHDC date=2026-02-16
-- Recorded: closed_win (actual_return=+43.28%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=18.0800, stop=8.8200, rows_in_window=156)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50740;

-- MISMATCH: prediction id=50768 ticker=PHDC date=2026-02-23
-- Recorded: closed_win (actual_return=+42.37%)
-- Actual:   STOPPED (max_high=16.4300, min_low=7.9900, target=18.1000, stop=8.8800, rows_in_window=151)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50768;

-- MISMATCH: prediction id=50791 ticker=MASR date=2026-03-02
-- Recorded: expired (actual_return=+41.70%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=5.0100, target=45.2400, stop=5.1000, rows_in_window=147)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50791;

-- MISMATCH: prediction id=50812 ticker=MASR date=2026-03-08
-- Recorded: expired (actual_return=+41.70%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=5.0100, target=45.2400, stop=5.1000, rows_in_window=143)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50812;

-- MISMATCH: prediction id=50279 ticker=SAIB date=2025-10-09
-- Recorded: closed_win (actual_return=+40.56%)
-- Actual:   EXPIRED (max_high=3.0300, min_low=1.7400, target=14.3900, stop=1.6900, rows_in_window=249)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50279;

-- MISMATCH: prediction id=51199 ticker=ABUK date=2026-06-29
-- Recorded: closed_win (actual_return=+40.06%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=66.6600, target=140.5200, stop=62.9200, rows_in_window=61)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51199;

-- MISMATCH: prediction id=50763 ticker=ABUK date=2026-02-22
-- Recorded: closed_win (actual_return=+39.85%)
-- Actual:   EXPIRED (max_high=124.6290, min_low=63.7000, target=128.9800, stop=63.0100, rows_in_window=152)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50763;

-- MISMATCH: prediction id=51204 ticker=ABUK date=2026-06-30
-- Recorded: closed_win (actual_return=+38.61%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=67.0400, target=140.6600, stop=63.5800, rows_in_window=60)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51204;

-- MISMATCH: prediction id=51209 ticker=ABUK date=2026-07-01
-- Recorded: closed_win (actual_return=+37.85%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=67.7300, target=140.7300, stop=63.9200, rows_in_window=59)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51209;

-- MISMATCH: prediction id=50967 ticker=PHDC date=2026-04-20
-- Recorded: closed_win (actual_return=+37.70%)
-- Actual:   EXPIRED (max_high=16.4300, min_low=9.4400, target=19.7800, stop=9.1800, rows_in_window=111)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50967;

-- MISMATCH: prediction id=50778 ticker=ABUK date=2026-02-25
-- Recorded: expired (actual_return=+37.19%)
-- Actual:   TARGET_HIT (max_high=124.6290, min_low=63.7000, target=117.6800, stop=64.2400, rows_in_window=149)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50778;

-- MISMATCH: prediction id=50780 ticker=MASR date=2026-02-26
-- Recorded: expired (actual_return=+37.14%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=5.0100, target=45.2800, stop=5.2700, rows_in_window=149)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50780;

-- MISMATCH: prediction id=50788 ticker=ABUK date=2026-03-01
-- Recorded: expired (actual_return=+36.19%)
-- Actual:   TARGET_HIT (max_high=124.6290, min_low=63.7000, target=117.7800, stop=64.7100, rows_in_window=147)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50788;

-- MISMATCH: prediction id=51244 ticker=ABUK date=2026-07-13
-- Recorded: closed_win (actual_return=+35.70%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=69.0100, target=140.9500, stop=64.9400, rows_in_window=52)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51244;

-- MISMATCH: prediction id=51239 ticker=ABUK date=2026-07-12
-- Recorded: closed_win (actual_return=+34.63%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=69.0100, target=141.0600, stop=65.4600, rows_in_window=53)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51239;

-- MISMATCH: prediction id=51216 ticker=ABUK date=2026-07-05
-- Recorded: closed_win (actual_return=+34.43%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=68.2000, target=141.0800, stop=65.5500, rows_in_window=58)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51216;

-- MISMATCH: prediction id=51219 ticker=ABUK date=2026-07-06
-- Recorded: closed_win (actual_return=+34.43%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=69.0100, target=129.5200, stop=65.5500, rows_in_window=57)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51219;

-- MISMATCH: prediction id=51224 ticker=ABUK date=2026-07-07
-- Recorded: closed_win (actual_return=+34.39%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=69.0100, target=129.5300, stop=65.5700, rows_in_window=56)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51224;

-- MISMATCH: prediction id=51184 ticker=ABUK date=2026-06-24
-- Recorded: closed_win (actual_return=+34.14%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=66.6600, target=141.1100, stop=65.7000, rows_in_window=64)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51184;

-- MISMATCH: prediction id=51234 ticker=ABUK date=2026-07-09
-- Recorded: closed_win (actual_return=+33.80%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=69.0100, target=129.5900, stop=65.8600, rows_in_window=54)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51234;

-- MISMATCH: prediction id=50686 ticker=REAC date=2026-02-01
-- Recorded: closed_win (actual_return=+33.05%)
-- Actual:   EXPIRED (max_high=21.8500, min_low=6.9100, target=146.7100, stop=6.6300, rows_in_window=135)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50686;

-- MISMATCH: prediction id=51169 ticker=ABUK date=2026-06-16
-- Recorded: closed_win (actual_return=+31.68%)
-- Actual:   STOPPED (max_high=96.2900, min_low=66.6600, target=141.3700, stop=66.9200, rows_in_window=70)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51169;

-- MISMATCH: prediction id=51229 ticker=ABUK date=2026-07-08
-- Recorded: closed_win (actual_return=+31.42%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=69.0100, target=129.8400, stop=67.0600, rows_in_window=55)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51229;

-- MISMATCH: prediction id=51274 ticker=ABUK date=2026-07-29
-- Recorded: closed_win (actual_return=+31.38%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=70.9100, target=129.8500, stop=67.0700, rows_in_window=40)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51274;

-- MISMATCH: prediction id=51269 ticker=ABUK date=2026-07-28
-- Recorded: closed_win (actual_return=+31.14%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=70.8800, target=129.8700, stop=67.2000, rows_in_window=41)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51269;

-- MISMATCH: prediction id=50934 ticker=SAIB date=2026-04-12
-- Recorded: closed_win (actual_return=+31.09%)
-- Actual:   EXPIRED (max_high=3.0300, min_low=1.8286, target=14.4200, stop=1.8100, rows_in_window=118)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50934;

-- MISMATCH: prediction id=51174 ticker=ABUK date=2026-06-21
-- Recorded: closed_win (actual_return=+31.07%)
-- Actual:   STOPPED (max_high=96.2900, min_low=66.6600, target=141.4300, stop=67.2400, rows_in_window=67)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51174;

-- MISMATCH: prediction id=51254 ticker=ABUK date=2026-07-15
-- Recorded: closed_win (actual_return=+30.14%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=69.0500, target=141.5400, stop=67.7200, rows_in_window=50)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51254;

-- MISMATCH: prediction id=51164 ticker=ABUK date=2026-06-15
-- Recorded: closed_win (actual_return=+28.81%)
-- Actual:   STOPPED (max_high=96.2900, min_low=66.6600, target=141.6800, stop=68.4100, rows_in_window=71)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51164;

-- MISMATCH: prediction id=51159 ticker=ABUK date=2026-06-14
-- Recorded: closed_win (actual_return=+28.80%)
-- Actual:   STOPPED (max_high=96.2900, min_low=66.6600, target=141.6900, stop=68.4200, rows_in_window=72)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51159;

-- MISMATCH: prediction id=51280 ticker=ABUK date=2026-07-30
-- Recorded: closed_win (actual_return=+28.36%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=70.9100, target=130.1800, stop=68.6600, rows_in_window=39)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51280;

-- MISMATCH: prediction id=51181 ticker=HELI date=2026-06-23
-- Recorded: closed_win (actual_return=+28.12%)
-- Actual:   EXPIRED (max_high=8.7700, min_low=6.3600, target=10.0500, stop=6.0200, rows_in_window=65)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51181;

-- MISMATCH: prediction id=51297 ticker=ABUK date=2026-08-04
-- Recorded: closed_win (actual_return=+28.04%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=72.1200, target=141.7700, stop=68.8200, rows_in_window=36)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51297;

-- MISMATCH: prediction id=50939 ticker=SAIB date=2026-04-13
-- Recorded: closed_win (actual_return=+27.14%)
-- Actual:   EXPIRED (max_high=3.0300, min_low=1.8937, target=14.4300, stop=1.8700, rows_in_window=117)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50939;

-- MISMATCH: prediction id=51261 ticker=ABUK date=2026-07-16
-- Recorded: closed_win (actual_return=+27.14%)
-- Actual:   STOPPED (max_high=96.2900, min_low=69.0500, target=141.8800, stop=69.3100, rows_in_window=49)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51261;

-- MISMATCH: prediction id=51302 ticker=ABUK date=2026-08-05
-- Recorded: closed_win (actual_return=+26.62%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=73.0000, target=141.9400, stop=69.6000, rows_in_window=35)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51302;

-- MISMATCH: prediction id=50859 ticker=SAIB date=2026-03-22
-- Recorded: closed_win (actual_return=+26.50%)
-- Actual:   STOPPED (max_high=3.0300, min_low=1.8286, target=14.4300, stop=1.8800, rows_in_window=133)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50859;

-- MISMATCH: prediction id=51307 ticker=ABUK date=2026-08-06
-- Recorded: closed_win (actual_return=+26.28%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=73.2000, target=130.4200, stop=69.7900, rows_in_window=34)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51307;

-- MISMATCH: prediction id=51317 ticker=ABUK date=2026-08-11
-- Recorded: closed_win (actual_return=+25.60%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=73.2000, target=142.0600, stop=70.1600, rows_in_window=31)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51317;

-- MISMATCH: prediction id=50864 ticker=SAIB date=2026-03-23
-- Recorded: closed_win (actual_return=+25.25%)
-- Actual:   STOPPED (max_high=3.0300, min_low=1.8286, target=14.4400, stop=1.9000, rows_in_window=132)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50864;

-- MISMATCH: prediction id=50423 ticker=REAC date=2025-11-18
-- Recorded: closed_win (actual_return=+24.40%)
-- Actual:   STOPPED (max_high=21.8500, min_low=6.6400, target=161.3300, stop=7.0900, rows_in_window=188)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50423;

-- MISMATCH: prediction id=50718 ticker=ORTE date=2026-02-09
-- Recorded: closed_stop (actual_return=-23.39%)
-- Actual:   TARGET_HIT (max_high=65.2859, min_low=44.8120, target=64.8900, stop=55.8000, rows_in_window=85)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50718;

-- MISMATCH: prediction id=50713 ticker=ORTE date=2026-02-08
-- Recorded: closed_stop (actual_return=-23.36%)
-- Actual:   TARGET_HIT (max_high=65.2859, min_low=44.8120, target=64.8800, stop=55.7700, rows_in_window=86)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50713;

-- MISMATCH: prediction id=51347 ticker=ABUK date=2026-08-19
-- Recorded: closed_win (actual_return=+23.29%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=75.2800, target=142.3400, stop=71.4800, rows_in_window=25)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51347;

-- MISMATCH: prediction id=50280 ticker=BTFH date=2025-10-09
-- Recorded: closed_win (actual_return=+21.67%)
-- Actual:   EXPIRED (max_high=3.6600, min_low=2.3106, target=5.1000, stop=2.2600, rows_in_window=248)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50280;

-- MISMATCH: prediction id=51228 ticker=EEII date=2026-07-07
-- Recorded: closed_stop (actual_return=-21.05%)
-- Actual:   TARGET_HIT (max_high=3.3600, min_low=2.1500, target=3.0100, stop=2.6600, rows_in_window=56)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51228;

-- MISMATCH: prediction id=51233 ticker=GRCA date=2026-07-08
-- Recorded: closed_stop (actual_return=-20.35%)
-- Actual:   TARGET_HIT (max_high=86.2500, min_low=38.7000, target=57.0700, stop=46.6800, rows_in_window=55)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51233;

-- MISMATCH: prediction id=50883 ticker=REAC date=2026-03-26
-- Recorded: closed_win (actual_return=+20.26%)
-- Actual:   EXPIRED (max_high=21.8500, min_low=7.6000, target=146.8600, stop=7.3400, rows_in_window=96)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=50883;

-- MISMATCH: prediction id=51332 ticker=ABUK date=2026-08-16
-- Recorded: closed_win (actual_return=+17.71%)
-- Actual:   EXPIRED (max_high=96.2900, min_low=75.2800, target=143.0600, stop=74.8600, rows_in_window=28)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51332;

-- MISMATCH: prediction id=51024 ticker=MASR date=2026-05-06
-- Recorded: expired (actual_return=+17.25%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.4000, target=55.2900, stop=6.1600, rows_in_window=100)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51024;

-- MISMATCH: prediction id=51286 ticker=TWSA date=2026-08-02
-- Recorded: closed_win (actual_return=+16.13%)
-- Actual:   EXPIRED (max_high=8.1000, min_low=6.1600, target=165.2100, stop=6.1200, rows_in_window=21)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51286;

-- MISMATCH: prediction id=50865 ticker=HRHO date=2026-03-23
-- Recorded: expired (actual_return=+16.04%)
-- Actual:   TARGET_HIT (max_high=30.0500, min_low=20.0552, target=29.8200, stop=19.9400, rows_in_window=131)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50865;

-- MISMATCH: prediction id=51145 ticker=ABUK date=2026-06-09
-- Recorded: expired (actual_return=+15.39%)
-- Actual:   STOPPED (max_high=96.2900, min_low=66.6600, target=131.8200, stop=76.3700, rows_in_window=75)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51145;

-- MISMATCH: prediction id=51292 ticker=TWSA date=2026-08-03
-- Recorded: closed_win (actual_return=+14.72%)
-- Actual:   STOPPED (max_high=8.1000, min_low=6.1600, target=165.2300, stop=6.2000, rows_in_window=20)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51292;

-- MISMATCH: prediction id=50898 ticker=ABUK date=2026-03-31
-- Recorded: expired (actual_return=+14.69%)
-- Actual:   STOPPED (max_high=124.6290, min_low=66.6600, target=131.9200, stop=76.8300, rows_in_window=125)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50898;

-- MISMATCH: prediction id=51125 ticker=ABUK date=2026-06-03
-- Recorded: expired (actual_return=+14.69%)
-- Actual:   STOPPED (max_high=96.2900, min_low=66.6600, target=143.4800, stop=76.8300, rows_in_window=79)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51125;

-- MISMATCH: prediction id=51121 ticker=ABUK date=2026-06-02
-- Recorded: expired (actual_return=+14.53%)
-- Actual:   STOPPED (max_high=96.2900, min_low=66.6600, target=143.5000, stop=76.9400, rows_in_window=80)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51121;

-- MISMATCH: prediction id=51131 ticker=ABUK date=2026-06-04
-- Recorded: expired (actual_return=+14.45%)
-- Actual:   STOPPED (max_high=96.2900, min_low=66.6600, target=143.5100, stop=77.0000, rows_in_window=78)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51131;

-- MISMATCH: prediction id=51141 ticker=ABUK date=2026-06-08
-- Recorded: expired (actual_return=+14.41%)
-- Actual:   STOPPED (max_high=96.2900, min_low=66.6600, target=143.5200, stop=77.0300, rows_in_window=76)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51141;

-- MISMATCH: prediction id=50933 ticker=ABUK date=2026-04-09
-- Recorded: expired (actual_return=+14.12%)
-- Actual:   STOPPED (max_high=124.6290, min_low=66.6600, target=132.0100, stop=77.2200, rows_in_window=118)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50933;

-- MISMATCH: prediction id=51079 ticker=MASR date=2026-05-21
-- Recorded: expired (actual_return=+13.78%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=50.4200, stop=6.3500, rows_in_window=89)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51079;

-- MISMATCH: prediction id=51198 ticker=EBSC date=2026-06-28
-- Recorded: expired (actual_return=+13.64%)
-- Actual:   TARGET_HIT (max_high=2.4000, min_low=1.7100, target=2.0200, stop=1.6500, rows_in_window=62)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51198;

-- MISMATCH: prediction id=50918 ticker=ABUK date=2026-04-06
-- Recorded: expired (actual_return=+13.44%)
-- Actual:   STOPPED (max_high=124.6290, min_low=66.6600, target=132.1000, stop=77.6900, rows_in_window=121)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50918;

-- MISMATCH: prediction id=50928 ticker=ABUK date=2026-04-08
-- Recorded: expired (actual_return=+13.38%)
-- Actual:   STOPPED (max_high=124.6290, min_low=66.6600, target=132.1100, stop=77.7200, rows_in_window=119)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50928;

-- MISMATCH: prediction id=51390 ticker=LKGP date=2026-09-01
-- Recorded: closed_stop (actual_return=-13.28%)
-- Actual:   EXPIRED (max_high=3.6900, min_low=3.5500, target=3.9000, stop=3.4400, rows_in_window=3)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51390;

-- MISMATCH: prediction id=51134 ticker=MASR date=2026-06-07
-- Recorded: expired (actual_return=+13.27%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=55.3300, stop=6.3800, rows_in_window=78)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51134;

-- MISMATCH: prediction id=50541 ticker=CIEB date=2025-12-22
-- Recorded: expired (actual_return=+12.58%)
-- Actual:   STOPPED (max_high=31.1002, min_low=20.0000, target=33.3600, stop=20.7100, rows_in_window=196)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50541;

-- MISMATCH: prediction id=50583 ticker=SAIB date=2026-01-01
-- Recorded: expired (actual_return=+12.44%)
-- Actual:   STOPPED (max_high=3.0300, min_low=1.8286, target=14.4800, stop=2.1100, rows_in_window=189)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50583;

-- MISMATCH: prediction id=51025 ticker=ABUK date=2026-05-06
-- Recorded: expired (actual_return=+12.34%)
-- Actual:   STOPPED (max_high=118.4160, min_low=66.6600, target=143.8200, stop=78.4500, rows_in_window=99)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51025;

-- MISMATCH: prediction id=50600 ticker=HRHO date=2026-01-07
-- Recorded: expired (actual_return=+12.12%)
-- Actual:   TARGET_HIT (max_high=31.5000, min_low=19.0027, target=29.9700, stop=20.6400, rows_in_window=184)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50600;

-- MISMATCH: prediction id=51149 ticker=MASR date=2026-06-10
-- Recorded: expired (actual_return=+12.12%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=50.4400, stop=6.4400, rows_in_window=75)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51149;

-- MISMATCH: prediction id=50472 ticker=MTEZ date=2025-12-02
-- Recorded: closed_stop (actual_return=-12.09%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=107.1800, stop=91.3400, rows_in_window=134)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50472;

-- MISMATCH: prediction id=51116 ticker=ABUK date=2026-06-01
-- Recorded: expired (actual_return=+12.08%)
-- Actual:   STOPPED (max_high=96.2900, min_low=66.6600, target=143.8600, stop=78.6300, rows_in_window=81)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51116;

-- MISMATCH: prediction id=50903 ticker=ABUK date=2026-04-01
-- Recorded: expired (actual_return=+11.83%)
-- Actual:   STOPPED (max_high=124.6290, min_low=66.6600, target=132.3400, stop=78.8000, rows_in_window=124)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50903;

-- MISMATCH: prediction id=51035 ticker=ABUK date=2026-05-10
-- Recorded: expired (actual_return=+11.81%)
-- Actual:   STOPPED (max_high=112.1140, min_low=66.6600, target=143.9000, stop=78.8100, rows_in_window=97)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51035;

-- MISMATCH: prediction id=50958 ticker=ABUK date=2026-04-16
-- Recorded: expired (actual_return=+11.63%)
-- Actual:   STOPPED (max_high=118.4160, min_low=66.6600, target=143.9200, stop=78.9400, rows_in_window=113)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50958;

-- MISMATCH: prediction id=50468 ticker=MTEZ date=2025-12-01
-- Recorded: closed_stop (actual_return=-11.41%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=107.0400, stop=90.6400, rows_in_window=135)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50468;

-- MISMATCH: prediction id=51087 ticker=MASR date=2026-05-24
-- Recorded: expired (actual_return=+11.30%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=55.3600, stop=6.4900, rows_in_window=88)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51087;

-- MISMATCH: prediction id=51090 ticker=MASR date=2026-05-25
-- Recorded: expired (actual_return=+11.30%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=55.3600, stop=6.4900, rows_in_window=87)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51090;

-- MISMATCH: prediction id=51139 ticker=MASR date=2026-06-08
-- Recorded: expired (actual_return=+11.30%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=55.3600, stop=6.4900, rows_in_window=77)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51139;

-- MISMATCH: prediction id=51050 ticker=ACAMD date=2026-05-13
-- Recorded: closed_stop (actual_return=-11.11%)
-- Actual:   TARGET_HIT (max_high=2.6000, min_low=1.9600, target=2.3800, stop=2.1000, rows_in_window=94)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51050;

-- MISMATCH: prediction id=50478 ticker=MTEZ date=2025-12-03
-- Recorded: closed_stop (actual_return=-11.08%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=106.9600, stop=90.3100, rows_in_window=133)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50478;

-- MISMATCH: prediction id=51130 ticker=MASR date=2026-06-04
-- Recorded: expired (actual_return=+10.50%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=55.3700, stop=6.5300, rows_in_window=79)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51130;

-- MISMATCH: prediction id=51144 ticker=MASR date=2026-06-09
-- Recorded: expired (actual_return=+10.50%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=50.4600, stop=6.5300, rows_in_window=76)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51144;

-- MISMATCH: prediction id=51023 ticker=ABUK date=2026-05-05
-- Recorded: expired (actual_return=+10.43%)
-- Actual:   STOPPED (max_high=118.4160, min_low=66.6600, target=144.1100, stop=79.8000, rows_in_window=100)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51023;

-- MISMATCH: prediction id=51160 ticker=MASR date=2026-06-14
-- Recorded: expired (actual_return=+10.34%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.7100, target=55.3700, stop=6.5400, rows_in_window=73)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51160;

-- MISMATCH: prediction id=50460 ticker=MTEZ date=2025-11-30
-- Recorded: closed_stop (actual_return=-10.32%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=106.8000, stop=89.5500, rows_in_window=136)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50460;

-- MISMATCH: prediction id=50966 ticker=ABUK date=2026-04-20
-- Recorded: expired (actual_return=+10.24%)
-- Actual:   STOPPED (max_high=118.4160, min_low=66.6600, target=144.1400, stop=79.9400, rows_in_window=111)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50966;

-- MISMATCH: prediction id=50508 ticker=CIEB date=2025-12-11
-- Recorded: expired (actual_return=+10.23%)
-- Actual:   STOPPED (max_high=31.1002, min_low=20.0000, target=36.3500, stop=21.1600, rows_in_window=203)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50508;

-- MISMATCH: prediction id=50759 ticker=CIEB date=2026-02-22
-- Recorded: expired (actual_return=+10.08%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.4600, stop=21.1800, rows_in_window=152)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50759;

-- MISMATCH: prediction id=50601 ticker=SAIB date=2026-01-07
-- Recorded: expired (actual_return=+10.00%)
-- Actual:   STOPPED (max_high=3.0300, min_low=1.8286, target=14.4900, stop=2.1600, rows_in_window=185)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50601;

-- MISMATCH: prediction id=51124 ticker=MASR date=2026-06-03
-- Recorded: expired (actual_return=+9.56%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=55.3800, stop=6.5900, rows_in_window=80)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51124;

-- MISMATCH: prediction id=51189 ticker=MASR date=2026-06-25
-- Recorded: expired (actual_return=+9.56%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.7100, target=55.3800, stop=6.5900, rows_in_window=64)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51189;

-- MISMATCH: prediction id=50963 ticker=ABUK date=2026-04-19
-- Recorded: expired (actual_return=+9.51%)
-- Actual:   STOPPED (max_high=118.4160, min_low=66.6600, target=144.2500, stop=80.4700, rows_in_window=112)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50963;

-- MISMATCH: prediction id=50511 ticker=ESRS date=2025-12-14
-- Recorded: expired (actual_return=+9.46%)
-- Actual:   TARGET_HIT (max_high=291.4770, min_low=60.8195, target=149.8300, stop=121.1500, rows_in_window=143)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50511;

-- MISMATCH: prediction id=50922 ticker=ABUK date=2026-04-07
-- Recorded: expired (actual_return=+9.45%)
-- Actual:   STOPPED (max_high=124.6290, min_low=66.6600, target=132.7100, stop=80.5200, rows_in_window=120)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50922;

-- MISMATCH: prediction id=50947 ticker=RTVC date=2026-04-14
-- Recorded: expired (actual_return=+9.35%)
-- Actual:   TARGET_HIT (max_high=4.5800, min_low=3.1740, target=4.0600, stop=3.3200, rows_in_window=115)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50947;

-- MISMATCH: prediction id=51056 ticker=ABUK date=2026-05-14
-- Recorded: expired (actual_return=+9.21%)
-- Actual:   STOPPED (max_high=112.1140, min_low=66.6600, target=144.3000, stop=80.6900, rows_in_window=93)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51056;

-- MISMATCH: prediction id=50835 ticker=ABUK date=2026-03-15
-- Recorded: expired (actual_return=+8.95%)
-- Actual:   STOPPED (max_high=124.6290, min_low=66.6600, target=132.7800, stop=80.8800, rows_in_window=137)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50835;

-- MISMATCH: prediction id=51041 ticker=ABUK date=2026-05-11
-- Recorded: expired (actual_return=+8.95%)
-- Actual:   STOPPED (max_high=112.1140, min_low=66.6600, target=144.3400, stop=80.8800, rows_in_window=96)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51041;

-- MISMATCH: prediction id=51092 ticker=ABUK date=2026-05-25
-- Recorded: expired (actual_return=+8.95%)
-- Actual:   STOPPED (max_high=112.1140, min_low=66.6600, target=144.3400, stop=80.8800, rows_in_window=86)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51092;

-- MISMATCH: prediction id=51069 ticker=MASR date=2026-05-19
-- Recorded: expired (actual_return=+8.94%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=50.4800, stop=6.6300, rows_in_window=91)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51069;

-- MISMATCH: prediction id=51083 ticker=ABUK date=2026-05-21
-- Recorded: expired (actual_return=+8.94%)
-- Actual:   STOPPED (max_high=112.1140, min_low=66.6600, target=132.7900, stop=80.8900, rows_in_window=88)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51083;

-- MISMATCH: prediction id=50781 ticker=CIEB date=2026-02-26
-- Recorded: expired (actual_return=+8.92%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=30.6200, stop=21.4000, rows_in_window=148)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50781;

-- MISMATCH: prediction id=50983 ticker=ABUK date=2026-04-23
-- Recorded: expired (actual_return=+8.80%)
-- Actual:   STOPPED (max_high=118.4160, min_low=66.6600, target=144.3600, stop=80.9900, rows_in_window=108)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50983;

-- MISMATCH: prediction id=51129 ticker=PRMH date=2026-06-04
-- Recorded: closed_stop (actual_return=-8.80%)
-- Actual:   TARGET_HIT (max_high=3.0200, min_low=2.2800, target=3.0000, stop=2.6500, rows_in_window=78)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51129;

-- MISMATCH: prediction id=50755 ticker=CIEB date=2026-02-19
-- Recorded: expired (actual_return=+8.25%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.5400, stop=21.5300, rows_in_window=153)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50755;

-- MISMATCH: prediction id=51186 ticker=MASR date=2026-06-24
-- Recorded: expired (actual_return=+8.17%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.7100, target=55.4000, stop=6.6700, rows_in_window=65)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51186;

-- MISMATCH: prediction id=51259 ticker=MASR date=2026-07-16
-- Recorded: closed_stop (actual_return=-8.13%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=55.6500, stop=7.8600, rows_in_window=50)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51259;

-- MISMATCH: prediction id=50843 ticker=ABUK date=2026-03-16
-- Recorded: expired (actual_return=+8.11%)
-- Actual:   STOPPED (max_high=124.6290, min_low=66.6600, target=132.9200, stop=81.5200, rows_in_window=136)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50843;

-- MISMATCH: prediction id=51256 ticker=MASR date=2026-07-15
-- Recorded: closed_stop (actual_return=-7.91%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=55.6400, stop=7.8400, rows_in_window=51)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51256;

-- MISMATCH: prediction id=50775 ticker=CIEB date=2026-02-25
-- Recorded: expired (actual_return=+7.78%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=30.6600, stop=21.6300, rows_in_window=149)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50775;

-- MISMATCH: prediction id=50480 ticker=MTEZ date=2025-12-04
-- Recorded: closed_stop (actual_return=-7.71%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=106.2600, stop=87.0100, rows_in_window=132)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50480;

-- MISMATCH: prediction id=51165 ticker=MASR date=2026-06-15
-- Recorded: expired (actual_return=+7.71%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.7100, target=55.4000, stop=6.7000, rows_in_window=72)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51165;

-- MISMATCH: prediction id=51030 ticker=MASR date=2026-05-07
-- Recorded: closed_stop (actual_return=-7.69%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=55.6400, stop=7.8200, rows_in_window=99)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51030;

-- MISMATCH: prediction id=51120 ticker=MASR date=2026-06-02
-- Recorded: expired (actual_return=+7.56%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=55.4000, stop=6.7100, rows_in_window=81)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51120;

-- MISMATCH: prediction id=50750 ticker=CIEB date=2026-02-18
-- Recorded: expired (actual_return=+7.55%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.5700, stop=21.6800, rows_in_window=154)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50750;

-- MISMATCH: prediction id=51046 ticker=ABUK date=2026-05-12
-- Recorded: expired (actual_return=+7.47%)
-- Actual:   STOPPED (max_high=112.1140, min_low=66.6600, target=144.5700, stop=82.0000, rows_in_window=95)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51046;

-- MISMATCH: prediction id=50580 ticker=HRHO date=2026-01-01
-- Recorded: expired (actual_return=+7.28%)
-- Actual:   TARGET_HIT (max_high=31.5000, min_low=19.0027, target=30.1700, stop=21.5700, rows_in_window=188)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50580;

-- MISMATCH: prediction id=51298 ticker=GGCC date=2026-08-05
-- Recorded: STOPPED (actual_return=-7.00%)
-- Actual:   TARGET_HIT (max_high=1.2800, min_low=0.8100, target=1.1800, stop=1.0400, rows_in_window=35)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51298;

-- MISMATCH: prediction id=51311 ticker=GGCC date=2026-08-09
-- Recorded: STOPPED (actual_return=-7.00%)
-- Actual:   TARGET_HIT (max_high=1.2800, min_low=0.8100, target=1.2600, stop=1.1100, rows_in_window=33)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51311;

-- MISMATCH: prediction id=51334 ticker=LUTS date=2026-08-17
-- Recorded: STOPPED (actual_return=-7.00%)
-- Actual:   TARGET_HIT (max_high=1.9500, min_low=0.8280, target=1.2600, stop=1.1100, rows_in_window=27)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51334;

-- MISMATCH: prediction id=51350 ticker=IEEC date=2026-08-20
-- Recorded: STOPPED (actual_return=-7.00%)
-- Actual:   TARGET_HIT (max_high=1.2800, min_low=0.4010, target=1.1500, stop=1.0200, rows_in_window=22)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51350;

-- MISMATCH: prediction id=50486 ticker=MTEZ date=2025-12-07
-- Recorded: closed_stop (actual_return=-6.97%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=106.1200, stop=86.3200, rows_in_window=131)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50486;

-- MISMATCH: prediction id=50942 ticker=MASR date=2026-04-13
-- Recorded: closed_stop (actual_return=-6.80%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=5.9100, target=55.6200, stop=7.7500, rows_in_window=117)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50942;

-- MISMATCH: prediction id=51202 ticker=MASR date=2026-06-29
-- Recorded: expired (actual_return=+6.67%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.8200, target=55.4200, stop=6.7700, rows_in_window=62)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51202;

-- MISMATCH: prediction id=50765 ticker=CIEB date=2026-02-23
-- Recorded: expired (actual_return=+6.35%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.6200, stop=21.9200, rows_in_window=151)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50765;

-- MISMATCH: prediction id=51245 ticker=MASR date=2026-07-13
-- Recorded: closed_stop (actual_return=-6.34%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=55.6200, stop=7.7100, rows_in_window=53)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51245;

-- MISMATCH: prediction id=51063 ticker=ABUK date=2026-05-17
-- Recorded: expired (actual_return=+6.24%)
-- Actual:   STOPPED (max_high=112.1140, min_low=66.6600, target=144.7800, stop=82.9500, rows_in_window=92)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51063;

-- MISMATCH: prediction id=51197 ticker=RTVC date=2026-06-28
-- Recorded: expired (actual_return=+6.04%)
-- Actual:   TARGET_HIT (max_high=4.3600, min_low=3.5500, target=4.1900, stop=3.4300, rows_in_window=62)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51197;

-- MISMATCH: prediction id=51365 ticker=MASR date=2026-08-25
-- Recorded: STOPPED (actual_return=-5.94%)
-- Actual:   EXPIRED (max_high=7.6800, min_low=7.4900, target=55.4900, stop=7.1300, rows_in_window=2)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51365;

-- MISMATCH: prediction id=51114 ticker=ORTE date=2026-06-01
-- Recorded: expired (actual_return=-5.90%)
-- Actual:   STOPPED (max_high=48.7000, min_low=44.8120, target=67.9900, stop=45.4200, rows_in_window=5)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51114;

-- MISMATCH: prediction id=51344 ticker=MASR date=2026-08-19
-- Recorded: STOPPED (actual_return=-5.87%)
-- Actual:   EXPIRED (max_high=7.7700, min_low=7.6000, target=55.5100, stop=7.2200, rows_in_window=2)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51344;

-- MISMATCH: prediction id=50524 ticker=MTEZ date=2025-12-17
-- Recorded: expired (actual_return=+5.86%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=103.8900, stop=75.8500, rows_in_window=123)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50524;

-- MISMATCH: prediction id=50677 ticker=CIEB date=2026-01-28
-- Recorded: expired (actual_return=-5.85%)
-- Actual:   STOPPED (max_high=31.1002, min_low=20.0000, target=31.3300, stop=24.7600, rows_in_window=169)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50677;

-- MISMATCH: prediction id=50217 ticker=BTFH date=2025-09-22
-- Recorded: expired (actual_return=-5.81%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.3106, target=4.4000, stop=2.9100, rows_in_window=261)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50217;

-- MISMATCH: prediction id=50223 ticker=BTFH date=2025-09-23
-- Recorded: expired (actual_return=-5.81%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.3106, target=5.2400, stop=2.9100, rows_in_window=260)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50223;

-- MISMATCH: prediction id=50639 ticker=BTFH date=2026-01-19
-- Recorded: expired (actual_return=-5.81%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8075, target=4.8200, stop=2.9100, rows_in_window=176)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50639;

-- MISMATCH: prediction id=50704 ticker=BTFH date=2026-02-05
-- Recorded: expired (actual_return=-5.81%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8100, target=4.8200, stop=2.9100, rows_in_window=163)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50704;

-- MISMATCH: prediction id=50709 ticker=BTFH date=2026-02-08
-- Recorded: expired (actual_return=-5.81%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8100, target=4.8200, stop=2.9100, rows_in_window=162)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50709;

-- MISMATCH: prediction id=50984 ticker=BTFH date=2026-04-26
-- Recorded: expired (actual_return=-5.81%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8700, target=5.2400, stop=2.9100, rows_in_window=107)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50984;

-- MISMATCH: prediction id=50990 ticker=BTFH date=2026-04-27
-- Recorded: expired (actual_return=-5.81%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8700, target=5.2400, stop=2.9100, rows_in_window=106)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50990;

-- MISMATCH: prediction id=51109 ticker=ORTE date=2026-05-31
-- Recorded: expired (actual_return=-5.78%)
-- Actual:   STOPPED (max_high=49.4809, min_low=44.8120, target=67.9800, stop=45.3600, rows_in_window=6)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51109;

-- MISMATCH: prediction id=50633 ticker=BLDG date=2026-01-15
-- Recorded: expired (actual_return=-5.76%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=126.1600, stop=25.1500, rows_in_window=105)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50633;

-- MISMATCH: prediction id=50545 ticker=BLDG date=2025-12-23
-- Recorded: expired (actual_return=-5.62%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=126.1500, stop=25.1100, rows_in_window=122)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50545;

-- MISMATCH: prediction id=50837 ticker=DMNH date=2026-03-15
-- Recorded: expired (actual_return=+5.56%)
-- Actual:   STOPPED (max_high=108.6770, min_low=73.1240, target=122.8700, stop=73.7500, rows_in_window=64)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50837;

-- MISMATCH: prediction id=51250 ticker=MASR date=2026-07-14
-- Recorded: expired (actual_return=-5.54%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=55.6000, stop=7.6400, rows_in_window=52)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51250;

-- MISMATCH: prediction id=50807 ticker=PIOH date=2026-03-05
-- Recorded: expired (actual_return=-5.53%)
-- Actual:   STOPPED (max_high=18.8327, min_low=14.7225, target=23.3800, stop=16.1700, rows_in_window=70)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50807;

-- MISMATCH: prediction id=50943 ticker=BLDG date=2026-04-13
-- Recorded: expired (actual_return=-5.51%)
-- Actual:   STOPPED (max_high=28.7613, min_low=23.8440, target=138.2200, stop=25.0900, rows_in_window=43)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50943;

-- MISMATCH: prediction id=50255 ticker=BTFH date=2025-10-02
-- Recorded: expired (actual_return=-5.50%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.3106, target=5.2400, stop=2.9100, rows_in_window=253)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50255;

-- MISMATCH: prediction id=50351 ticker=BTFH date=2025-10-29
-- Recorded: expired (actual_return=-5.50%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2400, stop=2.9100, rows_in_window=234)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50351;

-- MISMATCH: prediction id=50644 ticker=BTFH date=2026-01-20
-- Recorded: expired (actual_return=-5.50%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8075, target=4.8200, stop=2.9100, rows_in_window=175)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50644;

-- MISMATCH: prediction id=51112 ticker=BTFH date=2026-05-31
-- Recorded: expired (actual_return=-5.50%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=5.2400, stop=2.9100, rows_in_window=82)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51112;

-- MISMATCH: prediction id=51226 ticker=BTFH date=2026-07-07
-- Recorded: expired (actual_return=-5.50%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=4.8200, stop=2.9100, rows_in_window=56)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51226;

-- MISMATCH: prediction id=51260 ticker=BTFH date=2026-07-16
-- Recorded: expired (actual_return=-5.50%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=5.2400, stop=2.9100, rows_in_window=49)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51260;

-- MISMATCH: prediction id=51155 ticker=HRHO date=2026-06-11
-- Recorded: expired (actual_return=-5.49%)
-- Actual:   STOPPED (max_high=28.0800, min_low=24.4000, target=28.4600, stop=24.4800, rows_in_window=73)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51155;

-- MISMATCH: prediction id=50758 ticker=BLDG date=2026-02-19
-- Recorded: expired (actual_return=-5.33%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.8440, target=126.1300, stop=25.0400, rows_in_window=80)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50758;

-- MISMATCH: prediction id=50494 ticker=CERA date=2025-12-09
-- Recorded: expired (actual_return=+5.30%)
-- Actual:   TARGET_HIT (max_high=2.0800, min_low=0.9300, target=1.4000, stop=1.2300, rows_in_window=205)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50494;

-- MISMATCH: prediction id=50672 ticker=DMNH date=2026-01-27
-- Recorded: expired (actual_return=+5.28%)
-- Actual:   STOPPED (max_high=108.6770, min_low=72.4840, target=122.9100, stop=73.9500, rows_in_window=97)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50672;

-- MISMATCH: prediction id=51172 ticker=MASR date=2026-06-16
-- Recorded: expired (actual_return=+5.21%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.7100, target=55.4400, stop=6.8700, rows_in_window=71)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51172;

-- MISMATCH: prediction id=51206 ticker=MASR date=2026-06-30
-- Recorded: expired (actual_return=+5.21%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=55.4400, stop=6.8700, rows_in_window=61)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51206;

-- MISMATCH: prediction id=51091 ticker=BTFH date=2026-05-25
-- Recorded: expired (actual_return=-5.19%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=5.2400, stop=2.9000, rows_in_window=86)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51091;

-- MISMATCH: prediction id=50980 ticker=MTEZ date=2026-04-23
-- Recorded: expired (actual_return=-5.13%)
-- Actual:   STOPPED (max_high=98.4225, min_low=82.9235, target=105.7600, stop=84.6400, rows_in_window=32)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50980;

-- MISMATCH: prediction id=50571 ticker=BLDG date=2025-12-30
-- Recorded: expired (actual_return=-5.08%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=126.1200, stop=24.9800, rows_in_window=117)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50571;

-- MISMATCH: prediction id=51148 ticker=EHDR date=2026-06-09
-- Recorded: expired (actual_return=-4.96%)
-- Actual:   TARGET_HIT (max_high=3.1900, min_low=2.3700, target=2.9800, stop=2.6300, rows_in_window=75)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51148;

-- MISMATCH: prediction id=50308 ticker=BTFH date=2025-10-16
-- Recorded: expired (actual_return=-4.89%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2400, stop=2.8900, rows_in_window=243)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50308;

-- MISMATCH: prediction id=50317 ticker=BTFH date=2025-10-20
-- Recorded: expired (actual_return=-4.89%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2400, stop=2.8900, rows_in_window=241)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50317;

-- MISMATCH: prediction id=50338 ticker=BTFH date=2025-10-26
-- Recorded: expired (actual_return=-4.89%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2400, stop=2.8900, rows_in_window=237)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50338;

-- MISMATCH: prediction id=50403 ticker=BTFH date=2025-11-12
-- Recorded: expired (actual_return=-4.89%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2400, stop=2.8900, rows_in_window=224)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50403;

-- MISMATCH: prediction id=50635 ticker=BTFH date=2026-01-18
-- Recorded: expired (actual_return=-4.89%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8075, target=4.8100, stop=2.8900, rows_in_window=177)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50635;

-- MISMATCH: prediction id=50714 ticker=BTFH date=2026-02-09
-- Recorded: expired (actual_return=-4.89%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8100, target=4.8100, stop=2.8900, rows_in_window=161)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50714;

-- MISMATCH: prediction id=51088 ticker=BTFH date=2026-05-24
-- Recorded: expired (actual_return=-4.89%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=5.2400, stop=2.8900, rows_in_window=87)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51088;

-- MISMATCH: prediction id=51241 ticker=BTFH date=2026-07-12
-- Recorded: expired (actual_return=-4.89%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=5.2400, stop=2.8900, rows_in_window=53)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51241;

-- MISMATCH: prediction id=50241 ticker=PIOH date=2025-09-29
-- Recorded: expired (actual_return=+4.77%)
-- Actual:   STOPPED (max_high=20.0318, min_low=14.5255, target=25.0400, stop=14.5800, rows_in_window=183)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50241;

-- MISMATCH: prediction id=50560 ticker=BLDG date=2025-12-28
-- Recorded: expired (actual_return=-4.65%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=126.0900, stop=24.8600, rows_in_window=119)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50560;

-- MISMATCH: prediction id=50250 ticker=PIOH date=2025-10-01
-- Recorded: expired (actual_return=+4.64%)
-- Actual:   STOPPED (max_high=20.0318, min_low=14.5255, target=25.0500, stop=14.6000, rows_in_window=181)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50250;

-- MISMATCH: prediction id=51002 ticker=ABUK date=2026-04-29
-- Recorded: expired (actual_return=+4.62%)
-- Actual:   STOPPED (max_high=118.4160, min_low=66.6600, target=145.0500, stop=84.2300, rows_in_window=104)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51002;

-- MISMATCH: prediction id=50529 ticker=MTEZ date=2025-12-18
-- Recorded: expired (actual_return=+4.59%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=104.0900, stop=76.7700, rows_in_window=122)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50529;

-- MISMATCH: prediction id=51018 ticker=CAPE date=2026-05-04
-- Recorded: expired (actual_return=-4.59%)
-- Actual:   STOPPED (max_high=34.6639, min_low=28.8833, target=100.8000, stop=31.1000, rows_in_window=28)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51018;

-- MISMATCH: prediction id=50265 ticker=BTFH date=2025-10-06
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.3106, target=5.2400, stop=2.8800, rows_in_window=251)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50265;

-- MISMATCH: prediction id=50292 ticker=BTFH date=2025-10-13
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2400, stop=2.8800, rows_in_window=246)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50292;

-- MISMATCH: prediction id=50333 ticker=BTFH date=2025-10-23
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2400, stop=2.8800, rows_in_window=238)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50333;

-- MISMATCH: prediction id=50669 ticker=BTFH date=2026-01-27
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8075, target=4.8100, stop=2.8800, rows_in_window=170)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50669;

-- MISMATCH: prediction id=50719 ticker=BTFH date=2026-02-10
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8100, target=4.8100, stop=2.8800, rows_in_window=160)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50719;

-- MISMATCH: prediction id=50994 ticker=BTFH date=2026-04-28
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8700, target=5.2400, stop=2.8800, rows_in_window=105)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50994;

-- MISMATCH: prediction id=51013 ticker=BTFH date=2026-05-03
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8700, target=5.2400, stop=2.8800, rows_in_window=102)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51013;

-- MISMATCH: prediction id=51026 ticker=BTFH date=2026-05-06
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8700, target=5.2400, stop=2.8800, rows_in_window=99)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51026;

-- MISMATCH: prediction id=51135 ticker=BTFH date=2026-06-07
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=5.2400, stop=2.8800, rows_in_window=77)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51135;

-- MISMATCH: prediction id=51161 ticker=BTFH date=2026-06-14
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=5.2400, stop=2.8800, rows_in_window=72)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51161;

-- MISMATCH: prediction id=51236 ticker=BTFH date=2026-07-09
-- Recorded: expired (actual_return=-4.58%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=4.8100, stop=2.8800, rows_in_window=54)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51236;

-- MISMATCH: prediction id=50283 ticker=PIOH date=2025-10-09
-- Recorded: expired (actual_return=+4.50%)
-- Actual:   STOPPED (max_high=20.0318, min_low=14.5255, target=25.0500, stop=14.6200, rows_in_window=175)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50283;

-- MISMATCH: prediction id=50726 ticker=CIEB date=2026-02-11
-- Recorded: expired (actual_return=+4.47%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.7100, stop=22.3100, rows_in_window=159)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50726;

-- MISMATCH: prediction id=50880 ticker=PIOH date=2026-03-26
-- Recorded: expired (actual_return=-4.47%)
-- Actual:   STOPPED (max_high=17.6137, min_low=14.7225, target=23.3400, stop=15.9900, rows_in_window=55)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50880;

-- MISMATCH: prediction id=50748 ticker=CIEB date=2026-02-17
-- Recorded: expired (actual_return=+4.38%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.7100, stop=22.3300, rows_in_window=155)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50748;

-- MISMATCH: prediction id=50761 ticker=DMNH date=2026-02-22
-- Recorded: expired (actual_return=+4.31%)
-- Actual:   STOPPED (max_high=108.6770, min_low=72.4840, target=123.0600, stop=74.6400, rows_in_window=79)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50761;

-- MISMATCH: prediction id=50261 ticker=PIOH date=2025-10-05
-- Recorded: expired (actual_return=+4.30%)
-- Actual:   STOPPED (max_high=20.0318, min_low=14.5255, target=25.0600, stop=14.6500, rows_in_window=179)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50261;

-- MISMATCH: prediction id=50297 ticker=BTFH date=2025-10-14
-- Recorded: expired (actual_return=-4.26%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2300, stop=2.8700, rows_in_window=245)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50297;

-- MISMATCH: prediction id=50397 ticker=BTFH date=2025-11-11
-- Recorded: expired (actual_return=-4.26%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2300, stop=2.8700, rows_in_window=225)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50397;

-- MISMATCH: prediction id=50684 ticker=BTFH date=2026-02-01
-- Recorded: expired (actual_return=-4.26%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8100, target=4.8100, stop=2.8700, rows_in_window=167)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50684;

-- MISMATCH: prediction id=51000 ticker=BTFH date=2026-04-29
-- Recorded: expired (actual_return=-4.26%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8700, target=5.2300, stop=2.8700, rows_in_window=104)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51000;

-- MISMATCH: prediction id=51017 ticker=BTFH date=2026-05-04
-- Recorded: expired (actual_return=-4.26%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8700, target=5.2300, stop=2.8700, rows_in_window=101)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51017;

-- MISMATCH: prediction id=51221 ticker=BTFH date=2026-07-06
-- Recorded: expired (actual_return=-4.26%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=4.8100, stop=2.8700, rows_in_window=57)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51221;

-- MISMATCH: prediction id=51246 ticker=BTFH date=2026-07-13
-- Recorded: expired (actual_return=-4.26%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=5.2300, stop=2.8700, rows_in_window=52)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51246;

-- MISMATCH: prediction id=51251 ticker=BTFH date=2026-07-14
-- Recorded: expired (actual_return=-4.26%)
-- Actual:   STOPPED (max_high=3.2500, min_low=2.8700, target=5.2300, stop=2.8700, rows_in_window=51)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51251;

-- MISMATCH: prediction id=50863 ticker=MASR date=2026-03-22
-- Recorded: expired (actual_return=-4.24%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=5.0100, target=55.5800, stop=7.5400, rows_in_window=133)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50863;

-- MISMATCH: prediction id=50884 ticker=PIOH date=2026-03-29
-- Recorded: expired (actual_return=-4.13%)
-- Actual:   STOPPED (max_high=17.5688, min_low=14.7225, target=23.3300, stop=15.9300, rows_in_window=54)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50884;

-- MISMATCH: prediction id=51068 ticker=ABUK date=2026-05-18
-- Recorded: expired (actual_return=+4.11%)
-- Actual:   STOPPED (max_high=112.1140, min_low=66.6600, target=145.1400, stop=84.6400, rows_in_window=91)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51068;

-- MISMATCH: prediction id=50495 ticker=MTEZ date=2025-12-09
-- Recorded: expired (actual_return=-4.07%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=105.5600, stop=83.7000, rows_in_window=129)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50495;

-- MISMATCH: prediction id=51265 ticker=EDBM date=2026-07-21
-- Recorded: expired (actual_return=+4.05%)
-- Actual:   STOPPED (max_high=3.1500, min_low=0.7600, target=183.8800, stop=1.6200, rows_in_window=33)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51265;

-- MISMATCH: prediction id=50456 ticker=BTFH date=2025-11-27
-- Recorded: expired (actual_return=-3.95%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2300, stop=2.8600, rows_in_window=213)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50456;

-- MISMATCH: prediction id=50649 ticker=BTFH date=2026-01-21
-- Recorded: expired (actual_return=-3.95%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8075, target=4.8100, stop=2.8600, rows_in_window=174)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50649;

-- MISMATCH: prediction id=50654 ticker=BTFH date=2026-01-22
-- Recorded: expired (actual_return=-3.95%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8075, target=4.8100, stop=2.8600, rows_in_window=173)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50654;

-- MISMATCH: prediction id=50735 ticker=CIEB date=2026-02-15
-- Recorded: expired (actual_return=+3.85%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.7300, stop=22.4500, rows_in_window=157)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50735;

-- MISMATCH: prediction id=51045 ticker=MASR date=2026-05-12
-- Recorded: expired (actual_return=+3.78%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=55.4600, stop=6.9600, rows_in_window=96)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51045;

-- MISMATCH: prediction id=51175 ticker=MASR date=2026-06-21
-- Recorded: expired (actual_return=+3.78%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.7100, target=55.4600, stop=6.9600, rows_in_window=68)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51175;

-- MISMATCH: prediction id=50286 ticker=PIOH date=2025-10-12
-- Recorded: expired (actual_return=+3.64%)
-- Actual:   STOPPED (max_high=20.0318, min_low=14.5255, target=25.0800, stop=14.7400, rows_in_window=174)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50286;

-- MISMATCH: prediction id=50270 ticker=BTFH date=2025-10-07
-- Recorded: expired (actual_return=-3.63%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.3106, target=4.8100, stop=2.8500, rows_in_window=250)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50270;

-- MISMATCH: prediction id=50302 ticker=BTFH date=2025-10-15
-- Recorded: expired (actual_return=-3.63%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2300, stop=2.8500, rows_in_window=244)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50302;

-- MISMATCH: prediction id=50689 ticker=BTFH date=2026-02-02
-- Recorded: expired (actual_return=-3.63%)
-- Actual:   STOPPED (max_high=3.3700, min_low=2.8100, target=4.8100, stop=2.8500, rows_in_window=166)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50689;

-- MISMATCH: prediction id=51033 ticker=CIEB date=2026-05-07
-- Recorded: expired (actual_return=-3.54%)
-- Actual:   STOPPED (max_high=26.2700, min_low=23.2700, target=37.0000, stop=24.1800, rows_in_window=98)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51033;

-- MISMATCH: prediction id=50998 ticker=ABUK date=2026-04-28
-- Recorded: expired (actual_return=+3.52%)
-- Actual:   STOPPED (max_high=118.4160, min_low=66.6600, target=145.2400, stop=85.1200, rows_in_window=105)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50998;

-- MISMATCH: prediction id=51211 ticker=MASR date=2026-07-01
-- Recorded: expired (actual_return=+3.50%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=55.4600, stop=6.9800, rows_in_window=60)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51211;

-- MISMATCH: prediction id=50623 ticker=DMNH date=2026-01-13
-- Recorded: expired (actual_return=-3.49%)
-- Actual:   STOPPED (max_high=108.6770, min_low=72.4840, target=124.3400, stop=80.6700, rows_in_window=107)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50623;

-- MISMATCH: prediction id=50298 ticker=PIOH date=2025-10-14
-- Recorded: expired (actual_return=+3.44%)
-- Actual:   STOPPED (max_high=20.0318, min_low=14.5255, target=25.0800, stop=14.7700, rows_in_window=172)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50298;

-- MISMATCH: prediction id=51240 ticker=MASR date=2026-07-12
-- Recorded: expired (actual_return=-3.40%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=55.5700, stop=7.4700, rows_in_window=54)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51240;

-- MISMATCH: prediction id=50959 ticker=PIOH date=2026-04-19
-- Recorded: expired (actual_return=+3.37%)
-- Actual:   STOPPED (max_high=17.5688, min_low=14.7776, target=25.0900, stop=14.7800, rows_in_window=39)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50959;

-- MISMATCH: prediction id=50732 ticker=CIEB date=2026-02-12
-- Recorded: expired (actual_return=+3.33%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.7600, stop=22.5600, rows_in_window=158)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50732;

-- MISMATCH: prediction id=50683 ticker=DMNH date=2026-01-29
-- Recorded: expired (actual_return=+3.32%)
-- Actual:   STOPPED (max_high=108.6770, min_low=72.4840, target=133.9300, stop=75.3600, rows_in_window=95)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50683;

-- MISMATCH: prediction id=50320 ticker=BTFH date=2025-10-21
-- Recorded: expired (actual_return=-3.31%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2300, stop=2.8400, rows_in_window=240)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50320;

-- MISMATCH: prediction id=50581 ticker=BLDG date=2026-01-01
-- Recorded: expired (actual_return=-3.30%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=138.1000, stop=24.5000, rows_in_window=115)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50581;

-- MISMATCH: prediction id=50622 ticker=CIEB date=2026-01-13
-- Recorded: expired (actual_return=+3.29%)
-- Actual:   STOPPED (max_high=31.1002, min_low=20.0000, target=33.7600, stop=22.5700, rows_in_window=180)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50622;

-- MISMATCH: prediction id=50722 ticker=CIEB date=2026-02-10
-- Recorded: expired (actual_return=+3.29%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.7600, stop=22.5700, rows_in_window=160)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50722;

-- MISMATCH: prediction id=51031 ticker=CAPE date=2026-05-07
-- Recorded: expired (actual_return=-3.28%)
-- Actual:   STOPPED (max_high=33.1207, min_low=28.8833, target=100.7100, stop=30.6700, rows_in_window=25)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51031;

-- MISMATCH: prediction id=50868 ticker=MASR date=2026-03-23
-- Recorded: expired (actual_return=-3.27%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=5.0100, target=55.5600, stop=7.4700, rows_in_window=132)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50868;

-- MISMATCH: prediction id=50575 ticker=BLDG date=2025-12-31
-- Recorded: expired (actual_return=-3.19%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=126.0100, stop=24.4800, rows_in_window=116)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50575;

-- MISMATCH: prediction id=50517 ticker=HRHO date=2025-12-15
-- Recorded: expired (actual_return=-3.15%)
-- Actual:   TARGET_HIT (max_high=31.5000, min_low=19.0027, target=30.6600, stop=23.8900, rows_in_window=201)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50517;

-- MISMATCH: prediction id=50535 ticker=MTEZ date=2025-12-21
-- Recorded: expired (actual_return=+3.09%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=81.0898, target=96.3500, stop=77.8900, rows_in_window=121)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50535;

-- MISMATCH: prediction id=50627 ticker=CIEB date=2026-01-14
-- Recorded: expired (actual_return=+3.08%)
-- Actual:   STOPPED (max_high=31.1002, min_low=20.0000, target=33.7700, stop=22.6200, rows_in_window=179)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50627;

-- MISMATCH: prediction id=50293 ticker=PIOH date=2025-10-13
-- Recorded: expired (actual_return=+3.05%)
-- Actual:   STOPPED (max_high=20.0318, min_low=14.5255, target=25.1000, stop=14.8200, rows_in_window=173)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50293;

-- MISMATCH: prediction id=50896 ticker=PIOH date=2026-03-31
-- Recorded: expired (actual_return=-3.04%)
-- Actual:   STOPPED (max_high=17.5688, min_low=14.7225, target=23.2900, stop=15.7600, rows_in_window=52)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50896;

-- MISMATCH: prediction id=50901 ticker=PIOH date=2026-04-01
-- Recorded: expired (actual_return=-3.04%)
-- Actual:   STOPPED (max_high=17.5688, min_low=14.7225, target=23.2900, stop=15.7500, rows_in_window=51)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50901;

-- MISMATCH: prediction id=51359 ticker=BTFH date=2026-08-24
-- Recorded: STOPPED (actual_return=-3.03%)
-- Actual:   EXPIRED (max_high=3.0700, min_low=2.8700, target=5.2200, stop=2.7900, rows_in_window=23)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51359;

-- MISMATCH: prediction id=50256 ticker=PIOH date=2025-10-02
-- Recorded: expired (actual_return=+2.98%)
-- Actual:   STOPPED (max_high=20.0318, min_low=14.5255, target=25.1000, stop=14.8300, rows_in_window=180)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50256;

-- MISMATCH: prediction id=50997 ticker=AMPI date=2026-04-28
-- Recorded: expired (actual_return=+2.97%)
-- Actual:   TARGET_HIT (max_high=3.1400, min_low=2.4300, target=2.8400, stop=2.5100, rows_in_window=105)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50997;

-- MISMATCH: prediction id=51070 ticker=CAPE date=2026-05-19
-- Recorded: expired (actual_return=+2.71%)
-- Actual:   STOPPED (max_high=31.8236, min_low=28.8833, target=91.7700, stop=28.8900, rows_in_window=17)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51070;

-- MISMATCH: prediction id=50274 ticker=BTFH date=2025-10-08
-- Recorded: expired (actual_return=-2.67%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.3106, target=4.8000, stop=2.8200, rows_in_window=249)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50274;

-- MISMATCH: prediction id=50284 ticker=BTFH date=2025-10-12
-- Recorded: expired (actual_return=-2.67%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2200, stop=2.8200, rows_in_window=247)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50284;

-- MISMATCH: prediction id=50596 ticker=AIFI date=2026-01-06
-- Recorded: expired (actual_return=+2.67%)
-- Actual:   TARGET_HIT (max_high=4.1550, min_low=1.4500, target=2.3800, stop=2.1000, rows_in_window=185)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50596;

-- MISMATCH: prediction id=50779 ticker=BTFH date=2026-02-26
-- Recorded: expired (actual_return=-2.67%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8100, target=4.3800, stop=2.8200, rows_in_window=148)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50779;

-- MISMATCH: prediction id=50784 ticker=BTFH date=2026-03-01
-- Recorded: expired (actual_return=-2.67%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8100, target=4.3800, stop=2.8200, rows_in_window=147)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50784;

-- MISMATCH: prediction id=50866 ticker=BTFH date=2026-03-23
-- Recorded: expired (actual_return=-2.67%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8100, target=5.2200, stop=2.8200, rows_in_window=131)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50866;

-- MISMATCH: prediction id=50991 ticker=PIOH date=2026-04-27
-- Recorded: expired (actual_return=+2.65%)
-- Actual:   STOPPED (max_high=17.5688, min_low=14.7776, target=25.1100, stop=14.8800, rows_in_window=33)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50991;

-- MISMATCH: prediction id=51113 ticker=MASR date=2026-05-31
-- Recorded: expired (actual_return=-2.54%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=6.5400, target=55.5500, stop=7.4200, rows_in_window=83)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51113;

-- MISMATCH: prediction id=51443 ticker=BTFH date=2026-09-16
-- Recorded: TARGET_HIT (actual_return=+2.53%)
-- Actual:   EXPIRED (max_high=3.0700, min_low=2.8900, target=5.2100, stop=2.7300, rows_in_window=4)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51443;

-- MISMATCH: prediction id=50540 ticker=MTEZ date=2025-12-22
-- Recorded: expired (actual_return=+2.46%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=81.9066, target=96.4500, stop=78.3800, rows_in_window=120)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50540;

-- MISMATCH: prediction id=51248 ticker=FTNS date=2026-07-13
-- Recorded: expired (actual_return=+2.46%)
-- Actual:   TARGET_HIT (max_high=1.4800, min_low=1.1500, target=1.2900, stop=1.1400, rows_in_window=52)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51248;

-- MISMATCH: prediction id=51357 ticker=ACAMD date=2026-08-23
-- Recorded: STOPPED (actual_return=-2.44%)
-- Actual:   EXPIRED (max_high=2.2500, min_low=1.9600, target=2.3600, stop=1.9300, rows_in_window=23)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51357;

-- MISMATCH: prediction id=51037 ticker=GMCI date=2026-05-10
-- Recorded: expired (actual_return=+2.37%)
-- Actual:   TARGET_HIT (max_high=2.2600, min_low=1.6307, target=1.7900, stop=1.5800, rows_in_window=97)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51037;

-- MISMATCH: prediction id=50325 ticker=BTFH date=2025-10-22
-- Recorded: expired (actual_return=-2.34%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2200, stop=2.8100, rows_in_window=239)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50325;

-- MISMATCH: prediction id=50476 ticker=FTNS date=2025-12-03
-- Recorded: expired (actual_return=-2.34%)
-- Actual:   TARGET_HIT (max_high=1.6975, min_low=1.1200, target=1.3500, stop=1.2000, rows_in_window=209)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50476;

-- MISMATCH: prediction id=50861 ticker=BTFH date=2026-03-22
-- Recorded: expired (actual_return=-2.34%)
-- Actual:   STOPPED (max_high=3.3200, min_low=2.8100, target=5.2200, stop=2.8100, rows_in_window=132)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50861;

-- MISMATCH: prediction id=51249 ticker=FTNS date=2026-07-14
-- Recorded: expired (actual_return=-2.34%)
-- Actual:   TARGET_HIT (max_high=1.4800, min_low=1.1500, target=1.3500, stop=1.2000, rows_in_window=51)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51249;

-- MISMATCH: prediction id=51370 ticker=BTFH date=2026-08-26
-- Recorded: STOPPED (actual_return=-2.34%)
-- Actual:   EXPIRED (max_high=3.0700, min_low=2.8700, target=5.2200, stop=2.8100, rows_in_window=20)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51370;

-- MISMATCH: prediction id=51375 ticker=BTFH date=2026-08-27
-- Recorded: STOPPED (actual_return=-2.34%)
-- Actual:   EXPIRED (max_high=3.0700, min_low=2.8700, target=5.2200, stop=2.8100, rows_in_window=19)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51375;

-- MISMATCH: prediction id=50589 ticker=BLDG date=2026-01-05
-- Recorded: expired (actual_return=-2.25%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=125.9600, stop=24.2500, rows_in_window=113)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50589;

-- MISMATCH: prediction id=50631 ticker=DMNH date=2026-01-15
-- Recorded: expired (actual_return=+2.24%)
-- Actual:   STOPPED (max_high=108.6770, min_low=72.4840, target=123.3800, stop=76.1500, rows_in_window=105)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50631;

-- MISMATCH: prediction id=51016 ticker=BLDG date=2026-05-04
-- Recorded: expired (actual_return=-2.10%)
-- Actual:   STOPPED (max_high=28.0125, min_low=23.8440, target=138.0400, stop=24.2100, rows_in_window=28)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51016;

-- MISMATCH: prediction id=50642 ticker=DMNH date=2026-01-19
-- Recorded: expired (actual_return=+2.07%)
-- Actual:   STOPPED (max_high=108.6770, min_low=72.4840, target=123.4000, stop=76.2800, rows_in_window=103)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50642;

-- MISMATCH: prediction id=50355 ticker=BTFH date=2025-10-30
-- Recorded: expired (actual_return=-2.01%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.6500, target=5.2200, stop=2.8000, rows_in_window=233)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50355;

-- MISMATCH: prediction id=50411 ticker=BTFH date=2025-11-16
-- Recorded: expired (actual_return=-2.01%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2200, stop=2.8000, rows_in_window=222)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50411;

-- MISMATCH: prediction id=51349 ticker=BTFH date=2026-08-20
-- Recorded: STOPPED (actual_return=-2.01%)
-- Actual:   EXPIRED (max_high=3.0700, min_low=2.8700, target=5.2200, stop=2.8000, rows_in_window=24)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51349;

-- MISMATCH: prediction id=51364 ticker=BTFH date=2026-08-25
-- Recorded: TARGET_HIT (actual_return=+2.01%)
-- Actual:   EXPIRED (max_high=3.0000, min_low=2.9500, target=5.2200, stop=2.7800, rows_in_window=2)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51364;

-- MISMATCH: prediction id=51006 ticker=BLDG date=2026-04-30
-- Recorded: expired (actual_return=-1.95%)
-- Actual:   STOPPED (max_high=28.0125, min_low=23.8440, target=138.0300, stop=24.1800, rows_in_window=30)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51006;

-- MISMATCH: prediction id=50626 ticker=DMNH date=2026-01-14
-- Recorded: expired (actual_return=-1.92%)
-- Actual:   STOPPED (max_high=108.6770, min_low=72.4840, target=124.0600, stop=79.3800, rows_in_window=106)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50626;

-- MISMATCH: prediction id=50528 ticker=HRHO date=2025-12-17
-- Recorded: expired (actual_return=-1.84%)
-- Actual:   TARGET_HIT (max_high=31.5000, min_low=19.0027, target=30.6000, stop=23.5700, rows_in_window=199)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50528;

-- MISMATCH: prediction id=50542 ticker=HRHO date=2025-12-22
-- Recorded: expired (actual_return=-1.84%)
-- Actual:   TARGET_HIT (max_high=31.5000, min_low=19.0027, target=28.2700, stop=23.5700, rows_in_window=196)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50542;

-- MISMATCH: prediction id=50282 ticker=ELKA date=2025-10-09
-- Recorded: expired (actual_return=+1.83%)
-- Actual:   TARGET_HIT (max_high=2.7500, min_low=0.9600, target=1.8800, stop=1.5400, rows_in_window=248)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50282;

-- MISMATCH: prediction id=50666 ticker=DMNH date=2026-01-26
-- Recorded: expired (actual_return=+1.83%)
-- Actual:   STOPPED (max_high=108.6770, min_low=72.4840, target=123.4400, stop=76.4500, rows_in_window=98)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50666;

-- MISMATCH: prediction id=50652 ticker=BLDG date=2026-01-21
-- Recorded: expired (actual_return=-1.79%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=125.9400, stop=24.1400, rows_in_window=101)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50652;

-- MISMATCH: prediction id=50543 ticker=AMPI date=2025-12-22
-- Recorded: expired (actual_return=-1.77%)
-- Actual:   TARGET_HIT (max_high=3.1400, min_low=2.2800, target=2.9800, stop=2.6300, rows_in_window=196)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50543;

-- MISMATCH: prediction id=50551 ticker=HRHO date=2025-12-24
-- Recorded: expired (actual_return=-1.76%)
-- Actual:   TARGET_HIT (max_high=31.5000, min_low=19.0027, target=28.2600, stop=23.5500, rows_in_window=194)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50551;

-- MISMATCH: prediction id=50378 ticker=PIOH date=2025-11-05
-- Recorded: expired (actual_return=+1.75%)
-- Actual:   STOPPED (max_high=20.0318, min_low=14.7225, target=25.1400, stop=15.0100, rows_in_window=156)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50378;

-- MISMATCH: prediction id=51447 ticker=CIEB date=2026-09-16
-- Recorded: TARGET_HIT (actual_return=+1.72%)
-- Actual:   EXPIRED (max_high=25.6000, min_low=24.3000, target=36.7900, stop=23.2200, rows_in_window=5)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51447;

-- MISMATCH: prediction id=50426 ticker=BTFH date=2025-11-19
-- Recorded: expired (actual_return=-1.68%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2200, stop=2.7900, rows_in_window=219)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50426;

-- MISMATCH: prediction id=50537 ticker=HRHO date=2025-12-21
-- Recorded: expired (actual_return=-1.64%)
-- Actual:   TARGET_HIT (max_high=31.5000, min_low=19.0027, target=28.2600, stop=23.5200, rows_in_window=197)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50537;

-- MISMATCH: prediction id=50810 ticker=PIOH date=2026-03-08
-- Recorded: expired (actual_return=-1.64%)
-- Actual:   STOPPED (max_high=18.8327, min_low=14.7225, target=21.2500, stop=15.5300, rows_in_window=69)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50810;

-- MISMATCH: prediction id=50473 ticker=FTNS date=2025-12-02
-- Recorded: expired (actual_return=+1.63%)
-- Actual:   TARGET_HIT (max_high=1.6975, min_low=1.1200, target=1.3000, stop=1.1500, rows_in_window=210)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50473;

-- MISMATCH: prediction id=50562 ticker=HRHO date=2025-12-28
-- Recorded: expired (actual_return=-1.60%)
-- Actual:   TARGET_HIT (max_high=31.5000, min_low=19.0027, target=28.2600, stop=23.5100, rows_in_window=192)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50562;

-- MISMATCH: prediction id=51217 ticker=MASR date=2026-07-05
-- Recorded: expired (actual_return=+1.59%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=55.4900, stop=7.1100, rows_in_window=59)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51217;

-- MISMATCH: prediction id=51067 ticker=APRI date=2026-05-18
-- Recorded: expired (actual_return=-1.56%)
-- Actual:   STOPPED (max_high=103.9358, min_low=93.8216, target=115.6500, stop=96.7700, rows_in_window=18)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51067;

-- MISMATCH: prediction id=50555 ticker=BLDG date=2025-12-25
-- Recorded: expired (actual_return=-1.52%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=125.9300, stop=24.0700, rows_in_window=120)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50555;

-- MISMATCH: prediction id=51392 ticker=EDBM date=2026-09-01
-- Recorded: TARGET_HIT (actual_return=+1.50%)
-- Actual:   STOPPED (max_high=3.1500, min_low=0.7600, target=183.9100, stop=1.7500, rows_in_window=4)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51392;

-- MISMATCH: prediction id=50509 ticker=MTEZ date=2025-12-14
-- Recorded: expired (actual_return=-1.48%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=105.0900, stop=81.5000, rows_in_window=126)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50509;

-- MISMATCH: prediction id=51382 ticker=ACAMD date=2026-08-30
-- Recorded: STOPPED (actual_return=-1.48%)
-- Actual:   EXPIRED (max_high=2.2500, min_low=1.9900, target=2.3300, stop=1.9100, rows_in_window=18)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51382;

-- MISMATCH: prediction id=51225 ticker=MASR date=2026-07-07
-- Recorded: expired (actual_return=-1.41%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=50.6300, stop=7.3300, rows_in_window=57)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51225;

-- MISMATCH: prediction id=50952 ticker=PIOH date=2026-04-15
-- Recorded: expired (actual_return=+1.37%)
-- Actual:   STOPPED (max_high=17.5688, min_low=14.7776, target=25.1500, stop=15.0700, rows_in_window=41)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50952;

-- MISMATCH: prediction id=50514 ticker=MTEZ date=2025-12-15
-- Recorded: expired (actual_return=+1.34%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=104.6100, stop=79.2400, rows_in_window=125)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50514;

-- MISMATCH: prediction id=51153 ticker=MENA date=2026-06-10
-- Recorded: expired (actual_return=-1.32%)
-- Actual:   TARGET_HIT (max_high=116.0000, min_low=6.4100, target=7.8300, stop=6.4100, rows_in_window=74)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51153;

-- MISMATCH: prediction id=50658 ticker=DMNH date=2026-01-22
-- Recorded: expired (actual_return=+1.25%)
-- Actual:   STOPPED (max_high=108.6770, min_low=72.4840, target=123.5400, stop=76.8900, rows_in_window=100)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50658;

-- MISMATCH: prediction id=50858 ticker=DMNH date=2026-03-19
-- Recorded: expired (actual_return=+1.20%)
-- Actual:   STOPPED (max_high=108.6770, min_low=73.1240, target=123.5400, stop=76.9300, rows_in_window=60)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50858;

-- MISMATCH: prediction id=50973 ticker=NEDA date=2026-04-21
-- Recorded: expired (actual_return=+1.12%)
-- Actual:   TARGET_HIT (max_high=3.2200, min_low=2.5300, target=2.8400, stop=2.5100, rows_in_window=110)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50973;

-- MISMATCH: prediction id=50520 ticker=MTEZ date=2025-12-16
-- Recorded: expired (actual_return=+1.10%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=104.6500, stop=79.4200, rows_in_window=124)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50520;

-- MISMATCH: prediction id=51011 ticker=BLDG date=2026-05-03
-- Recorded: expired (actual_return=-1.10%)
-- Actual:   STOPPED (max_high=28.0125, min_low=23.8440, target=137.9800, stop=23.9700, rows_in_window=29)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51011;

-- MISMATCH: prediction id=50558 ticker=HRHO date=2025-12-25
-- Recorded: expired (actual_return=-1.01%)
-- Actual:   TARGET_HIT (max_high=31.5000, min_low=19.0027, target=28.2300, stop=23.3700, rows_in_window=193)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50558;

-- MISMATCH: prediction id=50557 ticker=MTEZ date=2025-12-25
-- Recorded: expired (actual_return=-0.96%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=82.9235, target=97.0300, stop=81.0800, rows_in_window=117)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50557;

-- MISMATCH: prediction id=51318 ticker=MASR date=2026-08-12
-- Recorded: STOPPED (actual_return=-0.90%)
-- Actual:   EXPIRED (max_high=8.9500, min_low=7.4900, target=55.5300, stop=7.2900, rows_in_window=30)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51318;

-- MISMATCH: prediction id=51335 ticker=MASR date=2026-08-17
-- Recorded: STOPPED (actual_return=-0.90%)
-- Actual:   EXPIRED (max_high=8.9500, min_low=7.4900, target=55.5300, stop=7.2900, rows_in_window=27)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51335;

-- MISMATCH: prediction id=51040 ticker=CAPE date=2026-05-11
-- Recorded: expired (actual_return=-0.87%)
-- Actual:   STOPPED (max_high=32.4322, min_low=28.8833, target=100.5500, stop=29.9300, rows_in_window=23)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51040;

-- MISMATCH: prediction id=51062 ticker=CAPE date=2026-05-17
-- Recorded: expired (actual_return=-0.87%)
-- Actual:   STOPPED (max_high=32.4322, min_low=28.8833, target=100.5500, stop=29.9300, rows_in_window=19)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51062;

-- MISMATCH: prediction id=50707 ticker=CIEB date=2026-02-05
-- Recorded: expired (actual_return=-0.84%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.9600, stop=23.5100, rows_in_window=163)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50707;

-- MISMATCH: prediction id=51424 ticker=BTFH date=2026-09-10
-- Recorded: TARGET_HIT (actual_return=+0.83%)
-- Actual:   EXPIRED (max_high=2.9800, min_low=2.9100, target=5.2200, stop=2.7900, rows_in_window=2)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51424;

-- MISMATCH: prediction id=50532 ticker=HRHO date=2025-12-18
-- Recorded: expired (actual_return=-0.81%)
-- Actual:   TARGET_HIT (max_high=31.5000, min_low=19.0027, target=30.5400, stop=23.3200, rows_in_window=198)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50532;

-- MISMATCH: prediction id=50909 ticker=PIOH date=2026-04-05
-- Recorded: expired (actual_return=+0.81%)
-- Actual:   STOPPED (max_high=17.5688, min_low=14.7225, target=23.1700, stop=15.1500, rows_in_window=49)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50909;

-- MISMATCH: prediction id=50682 ticker=MASR date=2026-01-29
-- Recorded: expired (actual_return=+0.79%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=4.6800, target=55.5000, stop=7.1700, rows_in_window=169)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50682;

-- MISMATCH: prediction id=50937 ticker=MASR date=2026-04-12
-- Recorded: expired (actual_return=-0.78%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=5.9100, target=55.5200, stop=7.2800, rows_in_window=118)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50937;

-- MISMATCH: prediction id=51354 ticker=MASR date=2026-08-23
-- Recorded: STOPPED (actual_return=-0.78%)
-- Actual:   EXPIRED (max_high=8.9500, min_low=7.4900, target=55.5200, stop=7.2800, rows_in_window=23)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51354;

-- MISMATCH: prediction id=50414 ticker=BTFH date=2025-11-17
-- Recorded: expired (actual_return=+0.69%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2000, stop=2.7300, rows_in_window=221)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50414;

-- MISMATCH: prediction id=50430 ticker=BTFH date=2025-11-20
-- Recorded: expired (actual_return=+0.69%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2000, stop=2.7300, rows_in_window=218)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50430;

-- MISMATCH: prediction id=50435 ticker=BTFH date=2025-11-23
-- Recorded: expired (actual_return=+0.69%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2000, stop=2.7300, rows_in_window=217)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50435;

-- MISMATCH: prediction id=50390 ticker=BTFH date=2025-11-10
-- Recorded: expired (actual_return=-0.68%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2100, stop=2.7600, rows_in_window=226)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50390;

-- MISMATCH: prediction id=50404 ticker=BTFH date=2025-11-13
-- Recorded: expired (actual_return=-0.68%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2100, stop=2.7600, rows_in_window=223)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50404;

-- MISMATCH: prediction id=50546 ticker=MTEZ date=2025-12-23
-- Recorded: expired (actual_return=+0.67%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=82.7941, target=96.7500, stop=79.7600, rows_in_window=119)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50546;

-- MISMATCH: prediction id=51220 ticker=MASR date=2026-07-06
-- Recorded: expired (actual_return=-0.65%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=50.6200, stop=7.2700, rows_in_window=58)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51220;

-- MISMATCH: prediction id=51235 ticker=MASR date=2026-07-09
-- Recorded: expired (actual_return=-0.65%)
-- Actual:   TARGET_HIT (max_high=62.1442, min_low=7.0100, target=50.6200, stop=7.2700, rows_in_window=55)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51235;

-- MISMATCH: prediction id=50957 ticker=PIOH date=2026-04-16
-- Recorded: expired (actual_return=+0.62%)
-- Actual:   STOPPED (max_high=17.5688, min_low=14.7776, target=25.1700, stop=15.1800, rows_in_window=40)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50957;

-- MISMATCH: prediction id=51055 ticker=CAPE date=2026-05-14
-- Recorded: expired (actual_return=-0.62%)
-- Actual:   STOPPED (max_high=32.4322, min_low=28.8833, target=100.5300, stop=29.8500, rows_in_window=20)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51055;

-- MISMATCH: prediction id=51076 ticker=CAPE date=2026-05-20
-- Recorded: expired (actual_return=+0.61%)
-- Actual:   STOPPED (max_high=31.8236, min_low=28.8833, target=91.8900, stop=29.4800, rows_in_window=16)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51076;

-- MISMATCH: prediction id=51405 ticker=MCRO date=2026-09-06
-- Recorded: STOPPED (actual_return=-0.59%)
-- Actual:   TARGET_HIT (max_high=1.8100, min_low=1.5400, target=1.7900, stop=1.5800, rows_in_window=13)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51405;

-- MISMATCH: prediction id=50976 ticker=TELE date=2026-04-22
-- Recorded: expired (actual_return=-0.58%)
-- Actual:   STOPPED (max_high=58.1959, min_low=51.5260, target=73.1800, stop=52.2500, rows_in_window=36)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50976;

-- MISMATCH: prediction id=50716 ticker=CIEB date=2026-02-09
-- Recorded: expired (actual_return=-0.56%)
-- Actual:   STOPPED (max_high=29.5806, min_low=20.0000, target=33.9500, stop=23.4400, rows_in_window=161)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50716;

-- MISMATCH: prediction id=50757 ticker=DMNH date=2026-02-19
-- Recorded: expired (actual_return=+0.44%)
-- Actual:   STOPPED (max_high=108.6770, min_low=72.4840, target=123.6700, stop=77.5200, rows_in_window=80)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50757;

-- MISMATCH: prediction id=51051 ticker=CAPE date=2026-05-13
-- Recorded: expired (actual_return=+0.42%)
-- Actual:   STOPPED (max_high=32.4322, min_low=28.8833, target=100.4700, stop=29.5400, rows_in_window=21)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51051;

-- MISMATCH: prediction id=50584 ticker=BLDG date=2026-01-04
-- Recorded: expired (actual_return=+0.40%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=125.8300, stop=23.6000, rows_in_window=114)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50584;

-- MISMATCH: prediction id=51360 ticker=MASR date=2026-08-24
-- Recorded: STOPPED (actual_return=-0.39%)
-- Actual:   EXPIRED (max_high=8.9500, min_low=7.4900, target=55.5000, stop=7.1700, rows_in_window=23)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51360;

-- MISMATCH: prediction id=50904 ticker=PIOH date=2026-04-02
-- Recorded: expired (actual_return=-0.37%)
-- Actual:   STOPPED (max_high=17.5688, min_low=14.7225, target=23.2000, stop=15.3300, rows_in_window=50)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50904;

-- MISMATCH: prediction id=50445 ticker=BTFH date=2025-11-25
-- Recorded: expired (actual_return=+0.34%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2100, stop=2.7300, rows_in_window=215)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50445;

-- MISMATCH: prediction id=50504 ticker=MTEZ date=2025-12-11
-- Recorded: expired (actual_return=+0.29%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=79.5997, target=104.7900, stop=80.0700, rows_in_window=127)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50504;

-- MISMATCH: prediction id=51061 ticker=APRI date=2026-05-17
-- Recorded: expired (actual_return=+0.24%)
-- Actual:   STOPPED (max_high=103.9358, min_low=93.8216, target=115.2800, stop=95.0400, rows_in_window=19)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51061;

-- MISMATCH: prediction id=51339 ticker=MASR date=2026-08-18
-- Recorded: STOPPED (actual_return=-0.13%)
-- Actual:   EXPIRED (max_high=8.9500, min_low=7.4900, target=55.5000, stop=7.1500, rows_in_window=27)
-- Suggested fix:
-- UPDATE predictions SET status='EXPIRED', actual_return=NULL WHERE id=51339;

-- MISMATCH: prediction id=51396 ticker=EDBM date=2026-09-02
-- Recorded: TARGET_HIT (actual_return=-0.11%)
-- Actual:   STOPPED (max_high=3.1500, min_low=0.7600, target=183.9100, stop=1.7500, rows_in_window=3)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51396;

-- MISMATCH: prediction id=50550 ticker=MTEZ date=2025-12-24
-- Recorded: expired (actual_return=-0.04%)
-- Actual:   TARGET_HIT (max_high=122.2008, min_low=82.7941, target=96.8700, stop=80.3300, rows_in_window=118)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50550;

-- MISMATCH: prediction id=50661 ticker=BLDG date=2026-01-25
-- Recorded: expired (actual_return=-0.04%)
-- Actual:   STOPPED (max_high=33.2247, min_low=23.1503, target=125.8500, stop=23.7100, rows_in_window=99)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50661;

-- MISMATCH: prediction id=50300 ticker=GDWA date=2025-10-15
-- Recorded: expired (actual_return=+0.00%)
-- Actual:   TARGET_HIT (max_high=1.3800, min_low=0.7101, target=1.3500, stop=1.2000, rows_in_window=244)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50300;

-- MISMATCH: prediction id=50305 ticker=COPR date=2025-10-16
-- Recorded: expired (actual_return=+0.00%)
-- Actual:   TARGET_HIT (max_high=1.2000, min_low=0.2589, target=1.0700, stop=0.9400, rows_in_window=243)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50305;

-- MISMATCH: prediction id=50310 ticker=COPR date=2025-10-19
-- Recorded: expired (actual_return=+0.00%)
-- Actual:   TARGET_HIT (max_high=1.2000, min_low=0.2589, target=1.1600, stop=1.0300, rows_in_window=242)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50310;

-- MISMATCH: prediction id=50439 ticker=BTFH date=2025-11-24
-- Recorded: expired (actual_return=+0.00%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2100, stop=2.7400, rows_in_window=216)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50439;

-- MISMATCH: prediction id=50450 ticker=BTFH date=2025-11-26
-- Recorded: expired (actual_return=+0.00%)
-- Actual:   STOPPED (max_high=3.6600, min_low=2.7020, target=5.2100, stop=2.7400, rows_in_window=214)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=50450;

-- MISMATCH: prediction id=50855 ticker=PTCC date=2026-03-19
-- Recorded: expired (actual_return=n/a)
-- Actual:   TARGET_HIT (max_high=248.3480, min_low=19.0000, target=189.6100, stop=155.0600, rows_in_window=56)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=50855;

-- MISMATCH: prediction id=51266 ticker=EDBM date=2026-07-26
-- Recorded: expired (actual_return=+0.00%)
-- Actual:   STOPPED (max_high=3.1500, min_low=0.7600, target=183.9000, stop=1.6900, rows_in_window=31)
-- Suggested fix:
-- UPDATE predictions SET status='STOPPED', actual_return=NULL WHERE id=51266;

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

-- MISMATCH: prediction id=51404 ticker=OFH date=2026-09-06
-- Recorded: STOPPED (actual_return=+0.00%)
-- Actual:   TARGET_HIT (max_high=1.1800, min_low=1.0200, target=1.1500, stop=1.0200, rows_in_window=13)
-- Suggested fix:
-- UPDATE predictions SET status='TARGET_HIT', actual_return=NULL WHERE id=51404;

