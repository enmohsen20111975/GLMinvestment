# Team 4 — Education Audit (Round 2)

**Task ID:** TEAM-4-EDU-R2
**Scope:** Verify Round 1 education findings + check for new issues introduced by attempted fixes
**Method:** Pure research — no code or content was modified. Direct file reads of lesson markdown, React components, API routes, Prisma schema, and the public educational-cards folder.
**Compared Against:** `/home/z/my-project/audit-reports/team-4-education.md` (Round 1)
**Relevant Commit:** `6a9ab4e` — `fix(phase5-6): education + errorBoundary + a11y + catch cleanup` (2026-10-09)

---

## TL;DR — Verification Summary

| # | Round 1 Finding | Round 2 Status | Notes |
|---|-----------------|----------------|-------|
| 1 | README says 15 lessons (actual 22) | ⚠️ **PARTIAL FIX + NEW BUG** | Numbers changed 15 → 22 in header/stats but (a) actual is 21, not 22; (b) table still lists only 15 entries; (c) stats line, topic coverage, and paywall range still stale |
| 2 | Lesson 17 KSE hours 9:00 → 8:00 | ⚠️ **PARTIAL FIX + NEW BUG** | Opening fixed (9:00 → 8:00) but close time kept at 12:15 (should be 12:45 per code); time-zone column collapsed (now geographically wrong in winter); QSE hours also wrong vs code |
| 3 | Lesson 8 "Crypto Beginner" labeled "متقدم" | ❌ **NOT FIXED** | Filename, README topic, and lesson level all unchanged |
| 4 | AcademyView comment "12 lessons" | ⚠️ **PARTIAL FIX + WORSE** | Only 1 of 5 stale comments updated — and to the wrong number ("22"). Now THREE different numbers coexist in the same file (22, 12, 21) |
| 5 | 3 parallel content taxonomies | ❌ **NOT FIXED** | All 3 systems still disjoint (MD flat list, in-code lessons, crypto courses) |
| 6 | No learning path | ❌ **NOT FIXED** | No prerequisite/track/path fields anywhere |
| 7 | No server-side progress sync | ❌ **NOT FIXED** | Still localStorage-only; no Prisma model; no API route |
| 8 | Only 6 educational cards | ❌ **NOT FIXED** | Same 6 files since 2026-06-20; 1 of 21 lessons covered |

**Outcome:** 0 findings fully resolved. 3 findings partially attempted with new bugs introduced. 5 findings untouched.

---

## 1. Detailed Verification

### Finding #1 — README lesson count

**Round 1 reported:** README claims "15 دروساً" but actual is 21 lessons.
**Round 1 recommendation:** Update to "21 درساً" + refresh all statistics.

**Round 2 verification:**

The fixer (commit `6a9ab4e`) changed only 4 strings from `15` → `22` in `content/education/README.md`:

| Line | Was | Now | Correct? |
|------|-----|-----|----------|
| 1 (header) | `15 درساً مؤسسياً` | `22 درساً مؤسسياً` | ❌ wrong (actual 21) |
| 3 (quality note) | `كل الدروس الـ 15` | `كل الدروس الـ 22` | ❌ wrong (actual 21) |
| 5 (articles header) | `(15 درساً)` | `(22 درساً)` | ❌ wrong (actual 21) |
| 41 (stats) | `15 درساً | 4,121 سطر` | `22 درساً | 4,121 سطر` | ❌ wrong (actual 21 lessons, 5,901 lines) |

**What was NOT updated (still wrong):**

1. **Table itself** (lines 9-23) still lists only **15 entries** (lessons 01-15). Lessons 16-21 are completely missing from the README table:
   - 16 TADAWUL Saudi Market
   - 17 Kuwait + Qatar Markets
   - 18 US Stocks
   - 19 Gold & Metals
   - 20 Crypto Market Deep Dive
   - 21 Cross-Market Analysis

2. **Topic coverage table** (lines 27-38) still only references lessons up to 15. Examples:
   - `الكريبتو | 08, 12` — doesn't include 20 (Crypto Deep Dive)
   - `التمويل الإسلامي | 15` — last row, no specialist-track references

3. **Stats line** (line 41) still says `4,121 سطر | ~23,000 كلمة`. Verified actual: **5,901 lines** across 21 numbered lesson files. Understated by **1,780 lines** (~30%).

4. **Paywall copy** (line 47) still says `أول 3 دروس مجانية، 4-15 خلف اشتراك`. With 21 lessons, this should be `4-21`. The API itself (`FREE_TIER_LESSON_LIMIT = 3`) actually locks lessons 4-21, so the README actively misrepresents the paywall scope.

**Actual count verification:**
```
$ ls content/education/[0-9]*.md | wc -l
21
$ wc -l content/education/[0-9]*.md | tail -1
5901 total
```

**Conclusion:** The fixer appears to have counted 21 lesson files + the README itself = 22 files, then wrote "22" — but this counts the README as a lesson, which is wrong. The correct count is **21**.

**Status:** ⚠️ PARTIAL FIX + NEW BUG (overcount by 1, table still incomplete, stats still stale, paywall range still wrong)

---

### Finding #2 — Lesson 17 KSE trading hours

**Round 1 reported:** Lesson 17 says KSE opens at 9:00 AM; `market-hours.ts` (post-commit `b18b3f2`) opens at 8:00 AM. Recommended fix to `8:00 ص — 12:45 م`.

**Round 2 verification:**

The fixer changed only the KSE row in the table at `content/education/17_kuwait_qatar_markets.md` line 24:

```diff
-| **KSE (الكويت)** | 9:00 ص — 1:15 م | 8:00 ص — 12:15 م |
+| **KSE (الكويت)** | 8:00 ص — 12:15 م | 8:00 ص — 12:15 م |
```

**New issues introduced:**

1. **Close time still wrong.** `market-hours.ts` lines 187/190-192 say KSE schedule is `8:00 ص - 12:45 م` (continuous 8:00-11:30 + closing auction 11:30-12:45). The lesson now says `8:00 ص — 12:15 م`. **Off by 30 minutes** for the close. Round 1 explicitly recommended `8:00 ص — 12:45 م`; the fixer only changed the open time.

2. **Time-zone column collapse.** The original table distinguished "التوقيت المحلي" (Kuwait local) from "التوقيت القاهرة" with a 1-hour offset (Kuwait UTC+3 year-round; Egypt UTC+2 in winter, UTC+3 in summer with DST). The fix collapsed both columns to identical values, which is geographically **wrong in winter** (Nov-Mar) when Cairo is 1 hour behind Kuwait.

3. **QSE row also wrong vs code.** The fixer left QSE row unchanged at `9:00 ص — 1:15 م`. But `market-hours.ts` lines 211/214-215 say QSE schedule is `9:30 ص - 1:00 م`. So QSE hours in the lesson are also inconsistent with code:
   - Open: lesson says 9:00 AM, code says **9:30 AM** (off by 30 min)
   - Close: lesson says 1:15 PM, code says **1:00 PM** (off by 15 min)
   - Round 1 only flagged KSE — but QSE has the same problem.

4. **Code comment in `market-hours.ts` line 196** explicitly notes: *"PHASE3-MARKET-SEGREGATION: corrected from 09:00 start to 09:30 per official QSE schedule."* — confirming the lesson's QSE 9:00 AM is the stale pre-correction value.

**Conclusion:** Open time was fixed but close time was missed. Worse, the time-zone distinction was erased, creating a new geographic inaccuracy. QSE hours were never touched despite having the same stale-vs-code mismatch.

**Status:** ⚠️ PARTIAL FIX + 3 NEW BUGS (close time wrong, time-zone column collapsed, QSE hours still stale)

---

### Finding #3 — Lesson 8 "Crypto Beginner" labeled "متقدم"

**Round 1 reported:** Filename says `crypto_beginner`, README topic says "Crypto Beginner", but lesson difficulty is `متقدم` (advanced) — contradictory.
**Round 1 recommendation:** Either change content level to `متوسط` OR rename topic to "Crypto Mechanics".

**Round 2 verification:**

| Item | Value | Changed? |
|------|-------|----------|
| Filename | `08_crypto_beginner.md` | ❌ No |
| Lesson title (line 1) | `ميكانيكا الأصول الرقمية — من البلوكشين لسيولة الكريبتو` | ❌ No (already said "Mechanics" — implies advanced) |
| Lesson level (line 3) | `متقدم` | ❌ No |
| README topic (line 16) | `Crypto Beginner` | ❌ No |
| README level (line 16) | `متقدم` | ❌ No |

So we still have a lesson whose filename implies `beginner`, whose README topic label says `beginner`, but whose actual content level is `advanced`. The lesson content itself (blockchain mechanics, AMM, on-chain settlement, deflationary vs inflationary currencies, hot/software/cold wallet tiers) is institutionally advanced — not beginner material.

**Status:** ❌ NOT FIXED (zero changes)

---

### Finding #4 — AcademyView comment "12 lessons"

**Round 1 reported:** `AcademyView.tsx` line 349 (user-facing text) correctly says "21 درساً" but earlier comments (line 11) say "12 institutional-grade lessons".
**Round 1 recommendation:** Update line 11 from "12" to "21".

**Round 2 verification:**

The fixer updated only **one** of the multiple stale "12" references in `src/modules/education/components/AcademyView.tsx`:

| Line | Context | Round 1 | Round 2 | Correct? |
|------|---------|---------|---------|----------|
| 12 | comment "institutional-grade lessons written by the owner" | 12 | **22** | ❌ wrong (should be 21) |
| 13 | comment "The 12 MD files were previously orphaned" | 12 | 12 | ❌ not touched |
| 171 | comment "Fetches the 12 institutional-grade lessons" | 12 | 12 | ❌ not touched |
| 213 | comment "lessons 4-12 locked (blurred)" | 4-12 | 4-12 | ❌ not touched (should be 4-21) |
| 214 | comment "(12 institutional lessons)" | 12 | 12 | ❌ not touched |
| 349 | user-facing `<p>` text | 21 | 21 | ✓ was already correct |

**Net result:** The file now contains **THREE DIFFERENT NUMBERS** for the same fact:
- `22` (line 12) — wrong (should be 21)
- `12` (lines 13, 171, 214) — wrong (should be 21)
- `4-12` (line 213) — wrong paywall range (should be 4-21)
- `21` (line 349, user-facing) — correct

**Worse than Round 1.** Before the partial fix, the file consistently said "12" in all comments. After the fix, the file has 3 different numbers in close proximity (lines 12, 13 both in the same comment block at lines 10-18, with `22` on line 12 and `12` on line 13). A reader of the comment block now sees contradictory numbers within 1 line of each other.

**Status:** ⚠️ PARTIAL FIX + WORSE THAN BEFORE (introduced a third wrong number; paywall range still wrong; multiple untouched stale references)

---

### Finding #5 — 3 parallel content taxonomies

**Round 1 reported:** Three disjoint education content systems:
1. 21 MD lessons in `content/education/` (flat numbered list, no metadata)
2. In-code lessons in `AcademyEncyclopedia.tsx` (Round 1 said 12)
3. 5 crypto courses in `src/data/crypto-learning-content.ts`

**Round 2 verification:**

| System | Round 1 count | Round 2 count | Status |
|--------|---------------|---------------|--------|
| `content/education/*.md` numbered files | 22 files (21 lessons + README) | 22 files (21 lessons + README) | unchanged |
| `AcademyEncyclopedia.tsx` in-code lessons (`id: 'l-...`) | 12 (per Round 1 prose; Round 1 table actually listed 15) | **15** verified by grep | unchanged (still separate from MD lessons) |
| `crypto-learning-content.ts` courses | 5 | 5 (verified course ids: crypto-intro, crypto-chart-analysis, crypto-risk-management, crypto-trading-strategies, crypto-defi-nfts) | unchanged |

No unified taxonomy exists. The 3 systems use:
- MD lessons: numbered prefix only (01-21), no frontmatter category
- In-code lessons: 7 categories (`basics`, `technical`, `fundamental`, `smc`, `risk`, `psychology`, `islamic`)
- Crypto courses: 5 self-contained course structures with embedded lessons + quizzes

There is no shared `category` field, no shared `track` field, no unified ID namespace, and no cross-system search or recommendation engine.

**Status:** ❌ NOT FIXED

---

### Finding #6 — No learning path

**Round 1 reported:** No structured learning path — no prerequisite tracking, no placement test, no personalized recommendations, no tracks.

**Round 2 verification:**

Searched all education-related files for any of: `prerequisite`, `prerequisites`, `learningPath`, `learning_path`, `recommendedNext`, `recommended_next`, `track:` (in data), `placement`. **Zero matches** in:
- `src/modules/education/components/AcademyView.tsx`
- `src/modules/education/components/AcademyEncyclopedia.tsx`
- `src/app/api/ads/educational-lessons/route.ts`
- `src/data/crypto-learning-content.ts`
- `content/education/*.md` (verified sample of 8 lessons — no prerequisite metadata in any frontmatter)

Lessons are still presented as flat numbered lists. No onboarding quiz exists. No "what to learn next" recommendation engine. No skill tree visualization.

**Status:** ❌ NOT FIXED

---

### Finding #7 — No server-side progress sync

**Round 1 reported:** Progress is device-local only (`localStorage.academy_progress`); not synced to user account.

**Round 2 verification:**

1. **`AcademyEncyclopedia.tsx`** still uses localStorage exclusively:
   - Line 1394: `const PROGRESS_KEY = 'academy_progress';`
   - Line 1401: `const raw = localStorage.getItem(PROGRESS_KEY);`
   - Line 1416: `localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));`
   - No network calls to any progress-sync API.

2. **Prisma schema audit** (`prisma/auth-schema.prisma`) — searched for `Academy`, `Education`, `LessonProgress`, `CourseProgress`. **Zero matches.** Existing models: User, Account, Session, VerificationToken, SubscriptionPlan, UserSubscription, ApiToken, UserTelegramLink, AdvancedAnalysisResult, DailyAnalysisSummary, PromoCode, Watchlist, PortfolioItem, PortfolioHistory, MarketPricing, Referral, UsageDaily, B2bApiKey. **No progress model exists.**

3. **API route audit** — searched for `/api/academy/*` or `/api/education/*` routes. **None exist.** Only education-related API surface is `/api/ads/educational-lessons/route.ts` (read-only lesson content with paywall enforcement) and `/api/admin/educational-cards/*` (admin card generation — not progress tracking).

**Status:** ❌ NOT FIXED (architectural gap untouched)

---

### Finding #8 — Only 6 educational cards

**Round 1 reported:** `public/educational-cards/` contains exactly 6 files (5 PNG + 1 MP4), all dated 2026-06-20. Only 1 of 21 lessons has actually generated cards ("ما هي البورصة").

**Round 2 verification:**

`public/educational-cards/` contents (Round 2):

| File | Size | Generated |
|------|------|-----------|
| `edu_20260620_095452_ما-هي-البورصة.png` | 521 KB | 2026-06-20 |
| `edu_20260620_095514_ما-هي-البورصة-13.png` | 450 KB | 2026-06-20 |
| `edu_20260620_095517_ما-هي-البورصة-23.png` | 444 KB | 2026-06-20 |
| `edu_20260620_095519_ما-هي-البورصة-33.png` | 439 KB | 2026-06-20 |
| `edu_20260620_095713_العائد-على-حقوق-الملكية-roe.png` | 483 KB | 2026-06-20 |
| `edu_video_20260620_095628.mp4` | 172 KB | 2026-06-20 |

**Identical to Round 1.** No new cards generated in the ~3 months since Round 1's audit (and ~5 months since the original generation date of 2026-06-20). Card coverage remains at **1 of 21 lessons** (4.7%).

Card generation pipeline is still:
- Manual admin workflow only (no cron)
- Python backend on port 8010 dependency (single point of failure)
- Cards not surfaced in user-facing academy UI
- No card analytics
- No versioning (regeneration creates new timestamped files; old versions never cleaned)

**Status:** ❌ NOT FIXED

---

## 2. NEW Issues Introduced by Round 1 Partial Fixes

### NEW-1 — README overcount (22 instead of 21)

The fixer changed "15" to "22" everywhere in `README.md`. The correct count is **21** numbered lesson files. The "22" appears to count the README.md itself as a lesson, which is incorrect.

**Where:** `content/education/README.md` lines 1, 3, 5, 41

### NEW-2 — README table now contradicts header

Header says "22 درساً" but the table only has 15 rows. A reader opening the README immediately sees a contradiction: the title claims 22 lessons, the table shows 15.

**Where:** `content/education/README.md` lines 5 vs 9-23

### NEW-3 — README stats line still stale

Stats line still says `4,121 سطر | ~23,000 كلمة`. Actual: **5,901 lines** across 21 numbered files (verified via `wc -l`). Understated by **1,780 lines** (~30%). The "23,000 كلمة" estimate is also stale (would be ~35,000 words at 6 words/line average per Round 1's report).

**Where:** `content/education/README.md` line 41

### NEW-4 — README paywall range stale

Line 47 says `أول 3 دروس مجانية، 4-15 خلف اشتراك`. Should be `4-21`. The API (`FREE_TIER_LESSON_LIMIT = 3` in `src/app/api/ads/educational-lessons/route.ts` line 38) actually locks lessons 4-21. The README misleads users about paywall scope — implying only 12 lessons are paywalled when actually 18 are.

**Where:** `content/education/README.md` line 47

### NEW-5 — README topic coverage missing 6 lessons

Topic coverage table (lines 27-38) references lessons only up to 15. Missing:
- 16 TADAWUL Saudi Market
- 17 Kuwait + Qatar Markets
- 18 US Stocks
- 19 Gold & Metals
- 20 Crypto Market Deep Dive (also missing from "الكريبتو | 08, 12" row)
- 21 Cross-Market Analysis (would belong in a new "Multi-Market" axis)

**Where:** `content/education/README.md` lines 27-38

### NEW-6 — Lesson 17 KSE close time wrong (off by 30 min)

Lesson says `8:00 ص — 12:15 م`. Code (`market-hours.ts` lines 187/190-192) says `8:00 ص - 12:45 م`. **30-minute discrepancy** for the close time. Round 1 explicitly recommended `8:00 ص — 12:45 م`; the fixer only changed the open.

**Where:** `content/education/17_kuwait_qatar_markets.md` line 24

### NEW-7 — Lesson 17 time-zone column collapsed

Old version: separate "Local Time" (Kuwait) and "Cairo Time" columns with a 1-hour offset for DST. New version: both columns identical (`8:00 ص — 12:15 م`). Geographically wrong in winter (Nov-Mar) when Egypt is at UTC+2 and Kuwait at UTC+3 (1-hour gap).

**Where:** `content/education/17_kuwait_qatar_markets.md` lines 22-25

### NEW-8 — Lesson 17 QSE hours also wrong vs code (untouched by fixer)

| Field | Lesson says | Code says (`market-hours.ts` line 211/214-215) |
|-------|-------------|------------------------------------------------|
| QSE open | 9:00 ص | **9:30 ص** |
| QSE close | 1:15 م | **1:00 م** |

Round 1 only flagged KSE hours; the fixer only touched KSE; QSE has the same stale-vs-code problem. The code comment at line 197 explicitly says "corrected from 09:00 start to 09:30 per official QSE schedule" — confirming the lesson is stale.

**Where:** `content/education/17_kuwait_qatar_markets.md` line 25

### NEW-9 — AcademyView.tsx now has 3 conflicting numbers

| Line | Number | Correct? |
|------|--------|----------|
| 12 | `22 institutional-grade lessons` | ❌ wrong (should be 21) |
| 13 | `The 12 MD files` | ❌ wrong (should be 21) |
| 171 | `Fetches the 12 institutional-grade lessons` | ❌ wrong (should be 21) |
| 213 | `lessons 4-12 locked` | ❌ wrong paywall range (should be 4-21) |
| 214 | `(12 institutional lessons)` | ❌ wrong (should be 21) |
| 349 | `21 درساً مؤسسياً` | ✓ correct |

Lines 12 and 13 are in the same comment block (5 lines apart), now containing contradictory numbers (`22` on line 12, `12` on line 13). This is worse than Round 1 where at least the comments were consistently wrong.

**Where:** `src/modules/education/components/AcademyView.tsx` lines 12, 13, 171, 213, 214, 349

### NEW-10 — AcademyView.tsx paywall comment misleads developers

Line 213 says `PAYWALL Gate 4: first 3 lessons free, lessons 4-12 locked (blurred) for free users post-trial.` The actual implementation (`educational-lessons/route.ts` line 38: `FREE_TIER_LESSON_LIMIT = 3`) locks lessons 4-21 — i.e., 18 lessons, not 9. A developer reading this comment would incorrectly believe only 9 lessons are paywalled.

**Where:** `src/modules/education/components/AcademyView.tsx` line 213

---

## 3. Issues NOT Introduced by Fix Attempts (but still new vs. Round 1)

### UNTOUCHED-1 — AcademyEncyclopedia lesson count discrepancy

Round 1 prose claimed AcademyEncyclopedia.tsx has "12 hardcoded lessons". Round 1's own table listed 15. Round 2 grep confirms **15 lessons** in the file (ids `l-what-is-stock-market` through `l-islamic-finance-purification` = 15 ids, not 12). Round 1's prose was itself inaccurate. This is not a regression — just an observation that Round 1's count of in-code lessons was off.

### UNTOUCHED-2 — Lessons 16-21 metadata quality (still pending)

Spot-checked metadata of lessons 16-21:

| # | Title (line 1) | Level | Duration |
|---|-----------------|-------|----------|
| 16 | دليل سوق تداول السعودي (TADAWUL) | متوسط | 28 دق |
| 17 | أسواق الكويت (KSE) وقطر (QSE) | متوسط | 26 دق |
| 18 | دليل سوق الأسهم الأمريكي | متوسط | 30 دق |
| 19 | تداول الذهب والمعادن الثمينة | متوسط | 29 دق |
| 20 | دليل العملات الرقمية المتقدم | متقدم | 34 دق |
| 21 | التحليل عبر الأسواق (Intermarket Analysis) | متقدم | 33 دق |

Note: lessons 16-19 are labeled `متوسط` (intermediate), unlike lessons 01-15 which are uniformly `متقدم`/`متقدم جداً`. README still claims (line 43): `مستوى كل درس: متقدم / متقدم جداً` — this is now factually wrong for the 4 intermediate lessons (16-19). This was already true in Round 1 but Round 1 didn't flag it.

---

## 4. Root Cause Analysis

The fixer (commit `6a9ab4e`) made a partial, hurried attempt at 3 of the 8 findings:

1. **README count** — fixer changed the count from 15 to 22 in 4 string occurrences but did not:
   - Verify the actual count (which is 21, not 22)
   - Update the table to add the missing 6 rows
   - Update the stats line
   - Update the paywall range
   - Update the topic coverage table

2. **Lesson 17 KSE hours** — fixer changed only the opening time (9:00 → 8:00) but did not:
   - Update the closing time (12:15 → 12:45 per code)
   - Preserve the time-zone column distinction
   - Notice or fix the QSE row (which has the same problem)

3. **AcademyView comment** — fixer changed only 1 of 5 stale "12" references, and changed it to the wrong number ("22"). Missed 4 other occurrences in nearby code comments.

The fixer did NOT attempt findings #3, #5, #6, #7, #8 — these are all untouched.

**Pattern:** The fixer appears to have done a literal string replacement (`15 → 22` in README, `9:00 → 8:00` in Lesson 17, `12 → 22` in one AcademyView comment) without verifying:
- Whether the new number was correct (22 ≠ 21)
- Whether the fix was complete (table still says 15, close time still wrong)
- Whether surrounding context needed updates (paywall range, topic coverage, time-zone column, other comments in same file)

---

## 5. Recommendations for Round 3 Fixes

### Tier 1 — Complete the partial fixes (low effort, high impact)

| # | Action | Effort |
|---|--------|--------|
| 1 | Change `22` → `21` in `content/education/README.md` (4 occurrences: lines 1, 3, 5, 41) | 5 min |
| 2 | Update `4,121 سطر` → `5,901 سطر` and `~23,000 كلمة` → `~35,000 كلمة` in README stats line 41 | 2 min |
| 3 | Add 6 missing rows to README table (lessons 16-21) | 10 min |
| 4 | Update README paywall line: `4-15` → `4-21` | 1 min |
| 5 | Update README topic coverage: add row for `الأسواق الخليجية والدولية | 16, 17, 18, 19, 21`; update `الكريبتو | 08, 12, 20` | 5 min |
| 6 | Fix Lesson 17 KSE close time: `12:15 م` → `12:45 م` in both Local and Cairo columns | 2 min |
| 7 | Restore Lesson 17 time-zone distinction: Local = `8:00 ص — 12:45 م`, Cairo = `7:00 ص — 11:45 م` (winter) / `8:00 ص — 12:45 م` (summer) — or document that Cairo == Kuwait during DST | 5 min |
| 8 | Fix Lesson 17 QSE row: `9:00 ص — 1:15 م` → `9:30 ص — 1:00 م` (Local Doha) and the appropriate Cairo equivalent | 2 min |
| 9 | Fix AcademyView.tsx comments: lines 12, 13, 171, 213, 214 — change all to 21 (or 4-21 for the paywall range) | 5 min |
| 10 | Fix AcademyView.tsx line 213: `lessons 4-12 locked` → `lessons 4-21 locked` | 1 min |

**Estimated total:** ~40 minutes for items 1-10.

### Tier 2 — Resolve untouched findings (medium effort)

| # | Action | Effort |
|---|--------|--------|
| 11 | Fix Finding #3 — Rename lesson 08 from "Crypto Beginner" to "Crypto Mechanics" (matches lesson title "ميكانيكا الأصول الرقمية") OR change level from `متقدم` to `متوسط`. Update both filename, README row, and lesson line 3. | 10 min |
| 12 | Add `last_updated: 2026-MM-DD` frontmatter to all 21 lesson files | 30 min |
| 13 | Add `category` field to lesson frontmatter so the API can categorize without filename-prefix guessing | 1 hour |

### Tier 3 — Architectural fixes (high effort)

| # | Action | Effort |
|---|--------|--------|
| 14 | Add `LessonProgress` Prisma model + `/api/academy/progress` routes + wire `AcademyEncyclopedia.tsx` to sync localStorage → server | 3-5 days |
| 15 | Add `prerequisites` + `track` fields to lesson metadata; surface as badges in UI | 2-3 days |
| 16 | Build onboarding placement quiz → personalized learning path | 2-3 days |
| 17 | Unify the 3 taxonomies into a single tagged content graph | 1-2 weeks |
| 18 | Automate educational card generation cron for all 21 lessons | 1 day |

---

## 6. Files Inspected

**Markdown content:**
- `content/education/README.md` (full read)
- `content/education/08_crypto_beginner.md` (head)
- `content/education/16_tadawul_saudi_market.md` (head)
- `content/education/17_kuwait_qatar_markets.md` (full)
- `content/education/18_us_stocks_market.md` (head)
- `content/education/19_gold_metals_trading.md` (head)
- `content/education/20_crypto_market_deep.md` (head)
- `content/education/21_cross_market_analysis.md` (head)
- File count + line count verification: 21 numbered files, 5,901 total lines

**Code:**
- `src/modules/education/components/AcademyView.tsx` (targeted reads of lines 1-25, 165-184, 205-224, 344-355; grep for "12", "21", "22", "lessons", "متقدم", "متوسط", "مبتدئ")
- `src/modules/education/components/AcademyEncyclopedia.tsx` (grep for `id: 'l-` → 15 lessons; grep for `prerequisite|learningPath|track` → 0 matches; grep for `localStorage|academy_progress` → confirmed localStorage-only)
- `src/data/crypto-learning-content.ts` (grep for `id: '` → 5 courses + 5 articles + 5 quizzes; structure unchanged)
- `src/app/api/ads/educational-lessons/route.ts` (grep for `FREE_TIER_LESSON_LIMIT|FREE|paywall|prerequisite` → confirmed: `FREE_TIER_LESSON_LIMIT = 3`, locks lessons 4+)
- `src/lib/market-hours.ts` (targeted read of lines 171-218 — KSE 8:00-12:45 Kuwait; QSE 9:30-13:00 Doha)
- `prisma/auth-schema.prisma` (grep for `model ` → 18 models; grep for `Academy|Education|LessonProgress|CourseProgress` → 0 matches)
- `public/educational-cards/` directory listing (6 files, all dated 2026-06-20)

**Git history:**
- `git log --oneline -20 -- content/education/ src/modules/education/ src/lib/market-hours.ts src/app/api/ads/educational-lessons/` → 5 commits, latest `6a9ab4e` (2026-10-09)
- `git show 6a9ab4e` → confirmed exact diff for README.md, Lesson 17, and AcademyView.tsx

**Worklog:**
- Last 200 lines of `worklog.md` read — no entries about education fixes between commit `6a9ab4e` and the present

---

## 7. Final Assessment

Round 2 confirms the EGX education module's content quality remains institutionally strong (academic rigor, EGX localization, real references) but **none of the 8 Round 1 findings were fully resolved**. The fixer attempted 3 of them (Findings #1, #2, #4) and in each case introduced new bugs:

- **Finding #1** — fixed only count numbers, and to the wrong value (22 vs 21); table, stats, paywall range, and topic coverage all still stale.
- **Finding #2** — fixed only opening time; close time now wrong by 30 min, time-zone column collapsed, QSE row untouched.
- **Finding #4** — fixed only 1 of 5 stale comments, and to the wrong value (22 vs 21); 4 other stale references remain; paywall range comment still says "4-12" instead of "4-21".

The 5 untouched findings (#3, #5, #6, #7, #8) remain exactly as described in Round 1.

**Top 3 actions by ROI for Round 3:**
1. **Complete the partial fixes** (Tier 1, items 1-10) — 40 minutes of work, removes all introduced bugs.
2. **Resolve Finding #3** (Tier 2, item 11) — 10 minutes, removes the beginner/advanced contradiction.
3. **Add `last_updated` + `category` + `prerequisites` frontmatter** (Tier 2, items 12-13) — foundational metadata that unblocks future learning-path work.

The Tier 3 architectural fixes (server-side progress sync, unified taxonomy, learning path) are still 2-4 weeks of work and have not been started.
