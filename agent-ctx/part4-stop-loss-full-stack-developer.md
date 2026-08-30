# Task ID: part4-stop-loss — full-stack-developer agent

## السياق
- Part 4 من خطة Task ID: plan-redesign (تنفيذ 4 أجزاء).
- Part 2 (سابق) أنشأ `vps-service/utils/stock_state.py` بـ `compute_stock_state` + `is_near_correction_end` + `is_in_active_correction`.
- أنا مسؤول عن Python backend فقط (لا frontend changes).

## التعديلات المنفذة (sandbox only — لا push)

### 1. `vps-service/jobs/daily_closer.py` — تأجيل stop-loss
- **Import** (lines 181-193): `from utils.stock_state import is_near_correction_end` بـ safe fallback.
- **Helper method** (lines 950-1151): `_should_defer_stop_for_correction_end(pred_id, ticker, day_date, close, day_volume, gain_pct) -> bool`.
  - R4.1: فقط لو `gain_pct < 0` AND `> -15%`.
  - R4.2: one-shot defer عبر `exit_notifications` table (persistent state).
  - Computes: change_percent, ma_50, rsi_14, avg_volume من 180-day lookback history.
  - Logs `HOLD_CORRECTION_ENDING` notification عند الـ defer.
- **5 insertion points** قبل كل stop-loss trigger:
  1. `check_trailing_stop` (line 697-710): trailing stop path.
  2. `_close_with_dynamic_exit` (line 1303-1316): Rule 1 HARD/DYNAMIC STOP.
  3. `_close_explosive_trend_follow` (line 1604-1617): hard stop للأسهم الانفجارية.
  4. `_close_with_partial_trailing` (line 1750-1763): partial pre-stop.
  5. Mean-reversion BUY path (line 2326-2340): داخل `if is_buy:` block فقط (SELL positions ما بـ نـ deferهاش).

### 2. `vps-service/engines/v38_backtest_engine.py` — entry gate
- **Import** (lines 54-65): `from utils.stock_state import is_in_active_correction` بـ safe fallback.
- **Entry gate** (lines 1640-1696) قبل return statement في `analyze_single_day_v393`:
  - R4.2: فقط يـ reject `signal == 'BUY'` (مش STRONG_BUY ولا INSTITUTIONAL_BUY).
  - Computes: change_percent, rsi_14, low_52w, ma_50 من `sl_closes`.
  - لو `is_in_active_correction` True → return `{'signal': 'WAIT', 'score': 0, 'proofs': proofs_dict, 'reason': 'in_active_correction'}`.

## القيود المحققة
- ✅ **R4.1**: `gain_pct < 0` AND `> -15%` فقط.
- ✅ **R4.2**: only defer ONCE per prediction + only reject signal == 'BUY' (مش STRONG_BUY/INSTITUTIONAL_BUY).
- ✅ **safe-by-design**: كل helper calls wrapped في try/except، fallback functions تـ return False لو import فشل.
- ✅ **Python = brain** (Rule 20): كل logic في Python. Node/React ما اتلمسش.
- ✅ **لا AI hype** (Rule 31): notification messages فنية محايدة.

## اختبارات
- `ast.parse(...)` → ✅ syntax OK على الملفين.
- `is_near_correction_end` + `is_in_active_correction` imports + 6 scenarios pass.
- `_should_defer_stop_for_correction_end` tests (gain=+5%, gain=-20%, nonexistent ticker) → كلهم False ✅.
- V38 engine end-to-end call على healthy stock → لا crashes ✅.
- Edit completeness: 5 defer-check calls + 3 is_in_active_correction calls + 2 HOLD_CORRECTION_ENDING refs ✅.
- `bun run lint` → EXIT 0 ✅.
- dev.log: فقط WS proxy errors على :3005 (pre-existing، مش متعلق بتعديلاتي).

## الملفات المتأثرة
- `vps-service/jobs/daily_closer.py` (2657 → 2943 سطر، +286 سطر) — 5 stop-loss paths + helper method + import.
- `vps-service/engines/v38_backtest_engine.py` (2097 → 2126 سطر، +29 سطر) — import + entry gate block.
- `/home/z/my-project/worklog.md` — worklog entry محفوظ.

## ما تم تجنبه
- لا `git push` (sandbox only).
- لا frontend changes (لا page.tsx, لا components, لا UI).
- لا schema changes (exit_notifications table موجودة من P0-v16).
- لا new mini-services.
- لا tests files (per task instructions).
