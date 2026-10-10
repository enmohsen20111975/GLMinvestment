# Team 5 — Telegram Round 2 Verification

**Task ID**: TEAM-5-TG-R2
**Auditor**: Telegram specialist (general-purpose)
**Scope**: Verify Round 1 findings (6 items) against current code state.
**Date**: 2026-10-09 (post AUDIT-FIXES-PHASE-0 commit `62b7b36`)
**Approach**: PURE RESEARCH. No code modified. Read actual Python files + git diffs.

---

## 0. Method

For each Round 1 finding, I:
1. Re-read the relevant Python source file (lines cited below).
2. Searched for the exact pattern (`grep`) that would prove a fix is in place.
3. Checked `git log -p` to see which commit(s) touched the file since Round 1.

The Phase-0 audit-fix commit `62b7b36` ("fix(security): P0+P1 audit fixes") landed on 2026-10-09 16:51 UTC and explicitly references two Team-5 fixes:

- **P1-5**: Telegram retry logic — auto_poster (3 retries + backoff 2s/5s/10s + 429/5xx).
- **P2-14**: Telegram notifier disclaimer — 7 notify methods now auto-append disclaimer.

These are the only two telegram fixes in that commit. The other 4 Round 1 findings were not addressed in `62b7b36`.

---

## 1. Findings Verification Matrix

| # | Round 1 Finding | Round 2 Status | Evidence (file:line) |
|---|---|---|---|
| C1 | No retry logic in `auto_poster.py` (should have 3 retries + backoff) | ✅ **FIXED** | `auto_poster.py:249-317` — retry loop added in `send_message` only. |
| C2 | Daily query limit resets on restart | ❌ **NOT FIXED** | `telegram_interactive_bot.py:532` — `_daily_query_counts: Dict[str, int] = {}` still in-memory. |
| C3 | `auto_poster.py` doesn't write audit trail | ❌ **NOT FIXED** | No `UPDATE predictions SET was_published=…` anywhere in `auto_poster.py` or `auto_post_scheduler.py`. |
| C4 | Parse mode inconsistency (md vs HTML) | ❌ **NOT FIXED** | `auto_poster.py:236` default `parse_mode='md'`; `auto_post_scheduler.py` lines 255/264/265/267/314/324/325/327/467/1138/1140/1385 use `'md'`. `telegram_routes.py:1127, 1156` also `'md'`. Only `post_daily_opportunities:1213` switched to `'HTML'`. |
| C5 | `telegram_notifier.py` has no disclaimer | ✅ **FIXED** | `telegram_notifier.py:57-66` — `LEGAL_DISCLAIMER` added in `__init__`, auto-appended in `_send()`. |
| C6 | `TelegramBotClient` exists but not used by `auto_poster` / `bot` | ❌ **NOT FIXED** | Repo-wide grep: `TelegramBotClient` referenced ONLY inside `telegram_bot_api.py` (its own `__main__` self-test at lines 475-492). No imports from `auto_poster.py`, `telegram_interactive_bot.py`, `auto_post_scheduler.py`, or `telegram_notifier.py`. |

**Score**: 2 of 6 fixed (33%). Both fixes shipped in a single commit (`62b7b36`).

---

## 2. Detailed Verification per Finding

### C1 — Retry logic in `auto_poster.py` → ✅ FIXED (with caveats)

**Before (Round 1)**: `TelegramAutoPoster.send_message` caught `Exception` once for the button-fallback path and returned `{success: False, error: str(e)}` on any other failure. No retry.

**After (Round 2)** — `auto_poster.py:249-317`:

```python
# RETRY-FIX (2026-10-09, Team 5): إضافة retry logic لـ Telegram API
MAX_RETRIES = 3
RETRY_DELAYS = [2, 5, 10]  # seconds

# ... (connect + channel_entity + button prep) ...

last_error = None
for attempt in range(MAX_RETRIES):
    try:
        # try with buttons → fall back without buttons on btn_err
        msg = await self.client.send_message(self.channel_entity, text, parse_mode=parse_mode,
                                             link_preview=False, buttons=final_buttons)
        return {"success": True, "message_id": msg.id, "date": msg.date.isoformat() ...}
    except Exception as e:
        last_error = e
        error_str = str(e).lower()
        should_retry = ('429' in error_str or 'flood' in error_str or 'timeout' in error_str
                        or 'connection' in error_str or '500' in error_str
                        or '502' in error_str or '503' in error_str)
        if should_retry and attempt < MAX_RETRIES - 1:
            delay = RETRY_DELAYS[attempt]
            print(f"[AutoPoster] Send failed (attempt {attempt + 1}/{MAX_RETRIES}), retrying in {delay}s: {e}")
            await asyncio.sleep(delay)
        else:
            return {"success": False, "error": str(e)}
```

✅ Matches the Round 1 spec: **3 retries + backoff (2s, 5s, 10s) + retry on 429 / 5xx / flood / timeout / connection errors.**

**Caveats / residual weaknesses** (worth noting for future rounds):

1. **`send_photo` was NOT given the same retry treatment.** Lines 319-369 still have the old single-try + button-fallback pattern. If a daily/weekly post that includes a card image (PNG) hits a 429, the photo send still fails silently. The scheduler uses `send_photo` for both `post_daily_predictions` (line 255, 264) and `post_weekly_report` (line 314, 324) when a card image is generated — so the most-common path is actually the un-retried one.

2. **FloodWait `seconds` not honored.** Telethon's `FloodWaitError` carries a `.seconds` attribute (the official wait Telegram requires). The current code string-matches `'flood'` and applies the fixed `[2, 5, 10]` backoff. If Telegram says "wait 30s", total backoff is only 2+5+10 = 17s, so the third retry will STILL be FloodWaited. A robust fix should sleep `max(RETRY_DELAYS[attempt], e.seconds)`.

3. **Retry only triggers on substring match of `str(e).lower()`.** If Telethon raises a different exception type (e.g. `RPCError` without 'flood' in the message), it won't retry. Best practice: catch `FloodWaitError` separately.

4. **No jitter.** Three concurrent failing posts will all retry at exactly t+2, t+5, t+10 — thundering herd. Should add `+ random.uniform(0, 1)`.

**Verdict**: The fix satisfies the Round 1 spec literally (3 retries + backoff), but only covers `send_message`, not `send_photo`. Recommend a follow-up to extend the same loop to `send_photo`.

---

### C2 — Daily query limit resets on restart → ❌ NOT FIXED

**Round 1 finding**: `_daily_query_counts: Dict[str, int] = {}` lives in process memory. PM2 restart wipes it. A trial user who exhausted 5 queries at 9 AM gets 5 more after every code deploy or memory-threshold restart.

**Round 2 verification** — `telegram_interactive_bot.py:531-549`:

```python
DAILY_QUERY_LIMIT_TRIAL = 5
_daily_query_counts: Dict[str, int] = {}    # ← STILL in-memory

def check_and_increment_daily_limit(chat_id: int) -> Tuple[bool, int, int]:
    today_key = f"{chat_id}:{time.strftime('%Y-%m-%d')}"
    if len(_daily_query_counts) > 5000:
        _daily_query_counts.clear()        # ← STILL wipes ALL users under load

    count = _daily_query_counts.get(today_key, 0)
    if count >= DAILY_QUERY_LIMIT_TRIAL:
        return False, count, 0
    new_count = count + 1
    _daily_query_counts[today_key] = new_count
    remaining = max(0, DAILY_QUERY_LIMIT_TRIAL - new_count)
    return True, new_count, remaining
```

- No `sqlite3` calls inside `check_and_increment_daily_limit`.
- No import of `auth.db` or `predictions.db` for counter persistence.
- No `daily_query_log` table referenced.
- The `> 5000` mass-wipe is unchanged.

The function is called in 3 places (`telegram_interactive_bot.py:1106`, `1274`, `1350`) — all paths still go through the in-memory dict.

**Verdict**: Zero change since Round 1. Trial users can still bypass the 5-query limit by waiting for any PM2 restart.

---

### C3 — `auto_poster.py` doesn't write audit trail → ❌ NOT FIXED

**Round 1 finding**: After `post_daily_predictions()` posts a recommendation, the `predictions` table is NOT updated with `was_published=1` / `published_at` / `telegram_message_id`. Only the Next.js admin route does. This makes `TelegramPredictionsTab.tsx` show ~0% published despite daily auto-publishing.

**Round 2 verification**:

Repo-wide grep for `was_published` + `published_at` + `telegram_message_id` in `vps-service/telegram/`:

| File | Hits | Writes to `predictions` table? |
|------|------|-------------------------------|
| `auto_poster.py` | 0 | ❌ No reference at all |
| `auto_post_scheduler.py` | 3 hits (lines 1146, 1158, 1161) | ❌ Only assigns these keys to the return dict of `_post_report_via_engine` — does NOT execute SQL `UPDATE predictions`. The `engine.publish_to_telegram()` call goes through `ReportsEngine.publish_to_telegram` which writes to its own `reports` table (`reports_engine.py:1878-1879`), NOT to `predictions`. |
| `telegram_notifier.py` | 0 | ❌ No reference |
| `telegram_target_hit_tracker.py` | 0 | ❌ (separate state file `target_hit_state.json`) |
| `liquidity_alerts.py` | 0 | ❌ (separate state file `liquidity_alerts_state.json`) |

Repo-wide grep for `UPDATE predictions SET was_published`:

| Location | Type |
|----------|------|
| `scripts/_fix_db_restore.py:193` | one-off backfill script (TARGET_HIT only) |
| `scripts/production-migrate.py:383` | one-off backfill script (TARGET_HIT only) |
| Next.js `src/app/api/telegram/publish-stock/route.ts` (Round 1 confirmed) | admin UI manual publish |

**No new writes were added by the auto_poster / auto_post_scheduler**. The audit trail gap is identical to Round 1.

**Impact**: The admin dashboard still shows auto-published recommendations as "not published", and the duplicate-publish risk remains (admin sees "not published" → clicks publish → subscriber gets duplicate).

**Verdict**: Not addressed. Same Priority-1 recommendation as Round 1 stands: add an `UPDATE predictions SET published_at = datetime('now'), telegram_message_id = ?, was_published = 1 WHERE UPPER(ticker) = ? AND date(prediction_date) = date('now')` call after every successful `poster.send_message(text, ticker='COMI')`.

---

### C4 — Parse mode inconsistency (md vs HTML) → ❌ NOT FIXED

**Round 1 finding**: `auto_poster.py` and most `auto_post_scheduler.py` posts use `parse_mode='md'` (legacy Markdown). `_format_daily_opportunities_post`, `telegram_notifier`, `telegram_target_hit_tracker`, `liquidity_alerts`, `telegram_interactive_bot` all use `parse_mode='HTML'`. Same channel, different parse modes → broken/inconsistent rendering.

**Round 2 verification** — full parse_mode census:

| Sender | parse_mode | Lines |
|--------|-----------|-------|
| `auto_poster.py:TelegramAutoPoster.send_message` | `'md'` (default arg) | 236 |
| `auto_post_scheduler.py:post_daily_predictions` | `'md'` | 255, 264, 265, 267 |
| `auto_post_scheduler.py:post_weekly_report` | `'md'` | 314, 324, 325, 327 |
| `auto_post_scheduler.py:_post_report_via_engine` (manual fallback) | `'md'` | 1138, 1140 |
| `auto_post_scheduler.py:post_monthly_report` | `'md'` | (via `_post_report_via_engine`) |
| `auto_post_scheduler.py:post_daily_opportunities` | `'HTML'` | 1213 |
| `auto_post_scheduler.py:_format_morning_bell_post` caller | `'md'` | 467, 1385 |
| `telegram_routes.py:post_recommendation` | `'md'` | 1127 |
| `telegram_routes.py:post_daily_summary` | `'md'` | 1156 |
| `telegram_notifier.py:_send` | `'HTML'` | 87 |
| `telegram_target_hit_tracker.py` | `'HTML'` | 419, 859, 878 |
| `telegram_daily_lessons.py` | `'HTML'` | (send_photo caption) |
| `liquidity_alerts.py` | `'HTML'` (via notifier) | (no direct call) |
| `telegram_interactive_bot.py:send_message` | `'HTML'` (default arg) | 242 |

**The `'md'` legacy-mode usage is unchanged.** All the daily/weekly/monthly/recommendation posts from `auto_poster.py` and `auto_post_scheduler.py` still flow with `'md'`. The mixed rendering problem Round 1 flagged is exactly the same.

**Templates still use Markdown syntax**: e.g. `auto_poster.py:430` `f"📊 **تحليل سهم {ticker}**"` — `**bold**` requires Markdown; in HTML mode this would render literally as `**تحليل سهم COMI**`.

**Verdict**: Not addressed. Recommend standardizing on `'HTML'` everywhere + migrating all `**bold**` → `<b>bold</b>`, `` `code` `` → `<code>code</code>`, `_italic_` → `<i>italic</i>`.

---

### C5 — `telegram_notifier.py` has no disclaimer → ✅ FIXED

**Round 1 finding**: All 7 `notify_*` methods (`notify_target_hit`, `notify_approaching_target`, `notify_stop_warning`, `notify_trailing_profit`, `notify_stop_loss`, `notify_daily_report`, `notify_weekly_report`) lacked the `LEGAL_DISCLAIMER` constant.

**Round 2 verification** — `telegram_notifier.py:52-100`:

```python
def __init__(self):
    self.bot_token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    self.chat_id = os.environ.get('TELEGRAM_CHAT_ID', '') or os.environ.get('TELEGRAM_CHANNEL_ID', '')
    self.enabled = bool(self.bot_token and self.chat_id)
    # DISCLAIMER-FIX (2026-10-09, Team 5): إضافة disclaimer لكل رسالة
    self.LEGAL_DISCLAIMER = "\n\n━━━━━━━━━━━━━━━━━━━\n⚠️ <i>تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. إدارة رأس المال مسؤوليتك أولاً.</i>"

def _send(self, message: str, reply_markup: Optional[Dict[str, Any]] = None, ticker: Optional[str] = None) -> bool:
    """إرسال رسالة للتليجرام مع الأزرار الرسمية."""
    if not self.enabled:
        return False
    # DISCLAIMER-FIX: ضيف disclaimer لكل رسالة (لو مش موجود بالفعل)
    if 'ليس نصيحة استثمارية' not in message:
        message = message + self.LEGAL_DISCLAIMER
    try:
        # ... urlopen with parse_mode='HTML' ...
```

**All 7 `notify_*` methods** (`notify_target_hit:102`, `notify_approaching_target:136`, `notify_stop_warning:160`, `notify_trailing_profit:187`, `notify_stop_loss:203`, `notify_daily_report:217`, `notify_weekly_report:266`) route through `_send()`, so they all receive the disclaimer.

**Quality notes**:

- The disclaimer is wrapped in `<i>…</i>` HTML tags, which is consistent with `_send()`'s `parse_mode='HTML'` (line 87). ✅
- The `'ليس نصيحة استثمارية' not in message` guard prevents double-appending if a caller already includes a disclaimer (idempotent). ✅
- The disclaimer is appended AT THE END (after the message body), separated by a separator line `━━━━━━━━━━━━━━━━━━━` for visual clarity. ✅
- One subtle bug: the guard checks for the bare Arabic phrase, but the appended disclaimer uses `<i>…ليس نصيحة استثمارية. …</i>` — if a caller's pre-existing disclaimer happens to be HTML-escaped differently (e.g. with `&amp;`), the substring check would still match correctly since it's plain Arabic text. ✅ safe.

**Verdict**: Properly fixed. No residual issues.

---

### C6 — `TelegramBotClient` exists but not used by `auto_poster` / `bot` → ❌ NOT FIXED

**Round 1 finding**: `telegram_bot_api.py` defines a robust `TelegramBotClient` (429 + 5xx retry, FloodWait freeze, chunked sends, stats, dry_run). `auto_poster.py` and `telegram_interactive_bot.py` (the two PM2 services) do NOT use it.

**Round 2 verification** — repo-wide grep for `TelegramBotClient` and `telegram_bot_api`:

```
vps-service/telegram/telegram_bot_api.py:3   # docstring
vps-service/telegram/telegram_bot_api.py:16  from telegram.telegram_bot_api import TelegramBotClient   # ← inside __main__ docstring example
vps-service/telegram/telegram_bot_api.py:18  bot = TelegramBotClient()                                 # ← inside __main__ docstring example
vps-service/telegram/telegram_bot_api.py:107 class TelegramBotClient:                                  # ← definition
vps-service/telegram/telegram_bot_api.py:459 print('🧪 telegram_bot_api — Self Test')                  # ← __main__ self-test
vps-service/telegram/telegram_bot_api.py:475 bot = TelegramBotClient(token='', chat_id='')
vps-service/telegram/telegram_bot_api.py:481 dry = TelegramBotClient(token='x', chat_id='y', dry_run=True)
vps-service/telegram/telegram_bot_api.py:487 fake = TelegramBotClient(token='t', chat_id='c')
vps-service/telegram/telegram_bot_api.py:492 st = TelegramBotClient(token='t', chat_id='c').status()
vps-service/telegram/telegram_bot_api.py:497 print('✅ telegram_bot_api ready')
```

**Every single reference is inside `telegram_bot_api.py` itself** (definition + self-test block). Zero external imports. Specifically:

- `auto_poster.py` — uses raw `telethon.TelegramClient.send_message` (lines 272, 283, 343, 354). No `TelegramBotClient`.
- `auto_post_scheduler.py` — uses `TelegramAutoPoster` (which uses Telethon). No `TelegramBotClient`.
- `telegram_interactive_bot.py` — uses raw `requests.post` to `https://api.telegram.org/bot{token}/sendMessage` (line 242-280). No `TelegramBotClient`.
- `telegram_notifier.py` — uses raw `urllib.request.urlopen` (line 94-97). No `TelegramBotClient`.

**Note**: Round 1's audit report stated *"Only news-agent uses it"* — this appears to be inaccurate. `ai/news_agent.py` does not import `TelegramBotClient` either (repo-wide grep returned zero hits outside `telegram_bot_api.py`). The robust client is **completely orphaned** — defined and self-tested but wired to nothing.

**Verdict**: Not addressed. The C1 retry fix added inline retry logic to `TelegramAutoPoster.send_message` (the Telethon path), which partially closes the practical gap, but the architectural recommendation to consolidate on `TelegramBotClient` (HTTP Bot API, with proper FloodWait `seconds` honor + chunked sends + stats) is still open.

---

## 3. Summary

### What was done between Round 1 and Round 2

A single commit (`62b7b36`, "AUDIT-FIXES-PHASE-0", 2026-10-09 16:51 UTC) addressed 2 of the 6 Round 1 findings:

- **P1-5 / C1**: Added inline retry loop to `TelegramAutoPoster.send_message` (3 attempts, [2s, 5s, 10s] backoff, retries on 429/flood/timeout/connection/5xx). **Partial**: `send_photo` was not given the same treatment.
- **P2-14 / C5**: Added `LEGAL_DISCLAIMER` to `TelegramNotifier.__init__` and auto-append in `_send()` so all 7 `notify_*` methods now carry the disclaimer. **Complete**.

### What was NOT done (4 of 6 findings still open)

| # | Finding | Severity | Effort to fix |
|---|---------|----------|----------------|
| C2 | Daily query limit in-memory | 🔴 Critical (security: trial users bypass limit) | ~1 hour — add `bot_daily_query_log` table in `auth.db`, replace dict with SQLite lookup |
| C3 | `auto_poster` audit trail gap | 🔴 Critical (admin sees wrong published %, double-publish risk) | ~1 hour — add SQL `UPDATE predictions …` after successful `poster.send_message` |
| C4 | `md` vs `HTML` parse mode inconsistency | 🟡 High (broken rendering in channel) | ~2 hours — migrate all `**bold**` → `<b>bold</b>` + change default to `'HTML'` |
| C6 | `TelegramBotClient` orphaned | 🟡 High (architectural: no central retry/stats) | ~3 hours — refactor `auto_poster.py` + `telegram_interactive_bot.py` to use it |

### Residual issues introduced by the partial C1 fix

1. `send_photo` has no retry — daily/weekly posts with card images still lose messages on FloodWait.
2. FloodWait `seconds` not honored — backoff fixed at `[2, 5, 10]` regardless of Telegram's requested wait.
3. No jitter — concurrent failing sends will collide on retry.

---

## 4. Recommended Next Actions (Priority Order)

1. **C2 (Critical, ~1h)**: Persist `daily_query_counts` to `auth.db.bot_daily_query_log(chat_id, date, count, PRIMARY KEY(chat_id, date))`. Replace `_daily_query_counts.clear()` with `DELETE WHERE date < today`.
2. **C3 (Critical, ~1h)**: After every successful `poster.send_message(text, ticker='X')` in `auto_post_scheduler.py`, run `UPDATE predictions SET published_at = datetime('now'), telegram_message_id = ?, was_published = 1 WHERE UPPER(ticker) = 'X' AND date(prediction_date) = date('now')`. Mirror the Next.js `publish-stock/route.ts:175-184` logic.
3. **C4 (High, ~2h)**: Standardize on `parse_mode='HTML'` across `auto_poster.py`, `auto_post_scheduler.py`, and `telegram_routes.py`. Migrate all `**bold**` → `<b>bold</b>`, `` `code` `` → `<code>code</code>`.
4. **C6 (High, ~3h)**: Wire `TelegramBotClient` into `auto_poster.py` + `telegram_interactive_bot.py`. This unifies retry, FloodWait-honor, chunked sends, and stats — subsumes the inline C1 fix.
5. **C1 follow-up (Low, ~30min)**: Extend the retry loop to `send_photo`. Parse FloodWait `seconds` from `FloodWaitError` and sleep `max(RETRY_DELAYS[attempt], e.seconds)`. Add `+ random.uniform(0, 1)` jitter.

---

## 5. Files Reviewed (Round 2)

### Python (full or focused re-read)
- `vps-service/telegram/auto_poster.py` (993 LOC) — focused read of lines 1-118, 236-370 (send_message + send_photo), 820-994 (helpers)
- `vps-service/telegram/auto_post_scheduler.py` (1,830 LOC) — grep + targeted read of lines 219-340, 1076-1220 (post_daily_predictions, _post_report_via_engine, post_daily_opportunities)
- `vps-service/telegram/telegram_interactive_bot.py` (1,418 LOC) — grep + read of lines 528-549 (daily limit), 835-905 (auth.db fallback), 1100-1110 (limit enforcement)
- `vps-service/telegram/telegram_notifier.py` (439 LOC) — full read of lines 50-150 (init, _send, notify_target_hit, notify_approaching_target)
- `vps-service/telegram/telegram_bot_api.py` (497 LOC) — grep only (verifying zero external imports)
- `vps-service/telegram/telegram_target_hit_tracker.py` (1,068 LOC) — grep only (parse_mode census)
- `vps-service/telegram/liquidity_alerts.py` (830 LOC) — grep only
- `vps-service/telegram/telegram_daily_lessons.py` (509 LOC) — grep only
- `vps-service/api/telegram_routes.py` (1,861 LOC) — focused read of lines 1115-1170 (post_recommendation, post_daily_summary)
- `vps-service/analyzers/reports_engine.py` — grep verifying `publish_to_telegram` writes to `reports` table, not `predictions`

### Git
- `git log --all --oneline -- vps-service/telegram/` — 6 commits since 2026-10-08
- `git log --all -p --since="2026-10-08" -- vps-service/telegram/auto_poster.py vps-service/telegram/telegram_notifier.py` — confirmed the retry + disclaimer diffs in `62b7b36`
- `git diff HEAD~5 --stat -- vps-service/telegram/` — only 2 of 16 telegram files were modified

### Round 1 baseline
- `audit-reports/team-5-telegram.md` (697 LOC) — full re-read of Round 1 findings, evidence, and recommendations

---

**End of Round 2 verification. No code was modified.**
