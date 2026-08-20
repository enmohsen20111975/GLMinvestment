#!/usr/bin/env python3
"""
Live Trading Journal — GLMinvestment
=====================================
دفتر تداول حي للقناة المتوازنة فقط (balanced).

القواعد:
- القناة: balanced فقط (morning_bell خارج الدفتر)
- رأس المال: تجريبي
- مخاطرة: ≤ 1% للصفقة
- حد مراكز مفتوحة: 3
- ممنوع: مسح صفقة خاسرة · تعديل وقف بعد الحدث · إدخال صفقات قديمة كأنها حية

الأعمدة:
- signal_id: معرف التوصية (من predictions.db)
- date: تاريخ الإشارة
- ticker: رمز السهم
- channel: balanced (ثابت)
- entry_price: سعر الدخول الفعلي يوم التنفيذ
- stop_loss: كما وصل من النظام
- target_price: كما وصل من النظام
- exit_price: سعر الخروج الفعلي
- exit_reason: TP / SL / manual / time_expiry
- return_pct: العائد المحسوب
- mfe_pct: Maximum Favorable Excursion (أعلى ربح عائم)
- mae_pct: Maximum Adverse Excursion (أقصى ضرر عائم)
- stuck_to_plan: هل التزم بالوقف؟ (yes/no)
- notes: ملاحظات

تقرير أسبوعي:
- n, WR, avg_win, avg_loss, PF, max_loss_streak, manual_stop_breaches
"""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
JOURNAL_DB = PROJECT_ROOT / "db" / "live_journal.db"
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"

# ============================================================================
# Schema
# ============================================================================

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS live_trades (
    -- Identity
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER,                    -- من predictions.db.id
    entry_date TEXT NOT NULL,             -- YYYY-MM-DD (يوم التنفيذ الفعلي)
    ticker TEXT NOT NULL,                 -- رمز السهم
    channel TEXT DEFAULT 'balanced',      -- ثابت: balanced فقط

    -- Plan (from system)
    planned_entry REAL,                   -- سعر الدخول المخطط
    planned_stop REAL,                    -- الوقف المخطط
    planned_target REAL,                  -- الهدف المخطط
    planned_target_2 REAL,                -- الهدف الثاني (إن وُجد)

    -- Execution (actual)
    actual_entry REAL,                    -- سعر الدخول الفعلي
    actual_stop REAL,                      -- الوقف الفعلي (قد يختلف عن المخطط)
    actual_target REAL,                   -- الهدف الفعلي

    -- Exit
    exit_date TEXT,                       -- تاريخ الخروج الفعلي
    exit_price REAL,                      -- سعر الخروج الفعلي
    exit_reason TEXT,                     -- TP / SL / manual / time_expiry / trailing
    exit_notes TEXT,                      -- سبب الخروج بالتفصيل

    -- Tracking (update daily)
    mfe_price REAL DEFAULT 0,            -- أعلى سعر وصل (Maximum Favorable Excursion)
    mae_price REAL DEFAULT 999999,       -- أدنى سعر وصل (Maximum Adverse Excursion)
    mfe_pct REAL DEFAULT 0,              -- أعلى ربح عائم %
    mae_pct REAL DEFAULT 0,              -- أقصى ضرر عائم %

    -- Calculation
    return_pct REAL,                      -- العائد المحسوب (يُحسب عند الإغلاق)
    holding_days INTEGER,                 -- مدة الصفقة بالأيام

    -- Compliance
    stuck_to_plan TEXT DEFAULT 'yes',    -- هل التزم بالخطة؟ (yes/no)
    manual_stop_breach INTEGER DEFAULT 0, -- هل كسر الوقف يدوياً؟ (0/1)

    -- Meta
    created_at TEXT DEFAULT (datetime('now', '+2 hours')),
    updated_at TEXT DEFAULT (datetime('now', '+2 hours')),
    notes TEXT                            -- ملاحظات عامة
);

CREATE INDEX IF NOT EXISTS idx_live_trades_ticker ON live_trades(ticker);
CREATE INDEX IF NOT EXISTS idx_live_trades_entry_date ON live_trades(entry_date);
CREATE INDEX IF NOT EXISTS idx_live_trades_exit_date ON live_trades(exit_date);
CREATE INDEX IF NOT EXISTS idx_live_trades_status ON live_trades(exit_reason);

-- ==========================================
-- Settings table
-- ==========================================
CREATE TABLE IF NOT EXISTS journal_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

INSERT OR IGNORE INTO journal_settings (key, value) VALUES
    ('capital', '100000'),
    ('risk_per_trade_pct', '1.0'),
    ('max_concurrent', '3'),
    ('channel', 'balanced'),
    ('started_at', datetime('now', '+2 hours')),
    ('morning_bell_policy', 'EXCLUDED');
"""

# ============================================================================
# Initialize
# ============================================================================

def init_journal():
    """أنشئ قاعدة بيانات الدفتر الحي."""
    conn = sqlite3.connect(str(JOURNAL_DB))
    conn.executescript(SCHEMA_SQL)
    conn.commit()

    # Print settings
    settings = conn.execute("SELECT * FROM journal_settings").fetchall()
    print("✅ Live Journal initialized")
    print(f"   DB: {JOURNAL_DB}")
    print(f"   Settings:")
    for s in settings:
        print(f"     {s[0]}: {s[1]}")

    # Count existing trades
    count = conn.execute("SELECT COUNT(*) FROM live_trades").fetchone()[0]
    open_count = conn.execute("SELECT COUNT(*) FROM live_trades WHERE exit_date IS NULL").fetchone()[0]
    closed_count = conn.execute("SELECT COUNT(*) FROM live_trades WHERE exit_date IS NOT NULL").fetchone()[0]
    print(f"   Trades: {count} total ({open_count} open, {closed_count} closed)")
    conn.close()


# ============================================================================
# Record a new trade (from prediction signal)
# ============================================================================

def record_trade(signal_id: int, actual_entry: float, actual_stop: float = None, actual_target: float = None, notes: str = ""):
    """
    سجّل صفقة جديدة من توصية النظام.
    يجب أن تكون القناة balanced فقط.
    """
    # اقرأ التوصية من predictions.db
    conn_pred = sqlite3.connect(f"file:{PREDICTIONS_DB}?mode=ro", uri=True)
    conn_pred.row_factory = sqlite3.Row
    pred = conn_pred.execute("""
        SELECT id, ticker, prediction_date, entry_price, target_price, stop_loss,
               morning_bell, market, signal
        FROM predictions WHERE id = ?
    """, (signal_id,)).fetchone()
    conn_pred.close()

    if not pred:
        print(f"❌ Signal ID {signal_id} not found in predictions.db")
        return None

    if int(pred["morning_bell"] or 0) == 1:
        print(f"⚠️  Signal {signal_id} is morning_bell — EXCLUDED from balanced journal")
        return None

    conn = sqlite3.connect(str(JOURNAL_DB))
    cursor = conn.cursor()

    # Check max concurrent
    open_count = cursor.execute("SELECT COUNT(*) FROM live_trades WHERE exit_date IS NULL").fetchone()[0]
    max_concurrent = int(conn.execute("SELECT value FROM journal_settings WHERE key='max_concurrent'").fetchone()[0])
    if open_count >= max_concurrent:
        print(f"⚠️  Max concurrent ({max_concurrent}) reached — cannot open new trade")
        conn.close()
        return None

    cursor.execute("""
        INSERT INTO live_trades (
            signal_id, entry_date, ticker, channel,
            planned_entry, planned_stop, planned_target,
            actual_entry, actual_stop, actual_target,
            mfe_price, mae_price, notes
        ) VALUES (?, ?, ?, 'balanced', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        signal_id,
        pred["prediction_date"],
        pred["ticker"],
        pred["entry_price"],
        pred["stop_loss"],
        pred["target_price"],
        actual_entry,
        actual_stop or pred["stop_loss"],
        actual_target or pred["target_price"],
        actual_entry,  # mfe_price starts at entry
        actual_entry,  # mae_price starts at entry
        notes,
    ))
    trade_id = cursor.lastrowid
    conn.commit()
    conn.close()

    print(f"✅ Trade #{trade_id} recorded: {pred['ticker']} @ {actual_entry} (signal #{signal_id})")
    return trade_id


# ============================================================================
# Update MFE/MAE (call daily)
# ============================================================================

def update_mfe_mae(trade_id: int, current_price: float):
    """حدّث أعلى/أدنى سعر للصفقة المفتوحة."""
    conn = sqlite3.connect(str(JOURNAL_DB))
    conn.row_factory = sqlite3.Row
    trade = conn.execute("SELECT * FROM live_trades WHERE id = ? AND exit_date IS NULL", (trade_id,)).fetchone()
    if not trade:
        print(f"❌ Trade #{trade_id} not found or already closed")
        conn.close()
        return

    entry = float(trade["actual_entry"] or 0)
    if entry <= 0:
        conn.close()
        return

    new_mfe = max(float(trade["mfe_price"] or 0), current_price)
    new_mae = min(float(trade["mae_price"] or 999999), current_price)

    mfe_pct = ((new_mfe - entry) / entry) * 100 if entry > 0 else 0
    mae_pct = ((new_mae - entry) / entry) * 100 if entry > 0 else 0

    conn.execute("""
        UPDATE live_trades SET
            mfe_price = ?, mae_price = ?, mfe_pct = ?, mae_pct = ?,
            updated_at = datetime('now', '+2 hours')
        WHERE id = ?
    """, (new_mfe, new_mae, round(mfe_pct, 4), round(mae_pct, 4), trade_id))
    conn.commit()
    conn.close()

    print(f"📊 Trade #{trade_id}: MFE={round(mfe_pct,2)}% MAE={round(mae_pct,2)}%")


# ============================================================================
# Close a trade
# ============================================================================

def close_trade(trade_id: int, exit_date: str, exit_price: float, exit_reason: str,
                 stuck_to_plan: str = "yes", manual_stop_breach: int = 0, notes: str = ""):
    """أغلق صفقة."""
    conn = sqlite3.connect(str(JOURNAL_DB))
    conn.row_factory = sqlite3.Row
    trade = conn.execute("SELECT * FROM live_trades WHERE id = ?", (trade_id,)).fetchone()
    if not trade:
        print(f"❌ Trade #{trade_id} not found")
        conn.close()
        return

    entry = float(trade["actual_entry"] or 0)
    if entry <= 0:
        conn.close()
        return

    return_pct = ((exit_price - entry) / entry) * 100

    # Holding days
    from datetime import datetime as dt
    try:
        entry_date = dt.strptime(trade["entry_date"], "%Y-%m-%d")
        exit_d = dt.strptime(exit_date, "%Y-%m-%d")
        holding_days = (exit_d - entry_date).days
    except:
        holding_days = None

    conn.execute("""
        UPDATE live_trades SET
            exit_date = ?, exit_price = ?, exit_reason = ?,
            return_pct = ?, holding_days = ?,
            stuck_to_plan = ?, manual_stop_breach = ?,
            exit_notes = ?, updated_at = datetime('now', '+2 hours')
        WHERE id = ?
    """, (exit_date, exit_price, exit_reason, round(return_pct, 4),
          holding_days, stuck_to_plan, manual_stop_breach, notes, trade_id))
    conn.commit()
    conn.close()

    print(f"🔒 Trade #{trade_id} closed: {exit_reason} @ {exit_price} → {round(return_pct, 2)}%")


# ============================================================================
# Weekly report
# ============================================================================

def weekly_report():
    """تقرير أسبوعي: n, WR, avg_win, avg_loss, PF, max_loss_streak, manual_breaches."""
    conn = sqlite3.connect(str(JOURNAL_DB))
    conn.row_factory = sqlite3.Row

    closed = conn.execute("""
        SELECT * FROM live_trades
        WHERE exit_date IS NOT NULL AND channel = 'balanced'
        ORDER BY exit_date
    """).fetchall()

    open_trades = conn.execute("""
        SELECT * FROM live_trades WHERE exit_date IS NULL AND channel = 'balanced'
    """).fetchall()

    n = len(closed)
    if n == 0:
        print("📊 Weekly Report: No closed trades yet")
        print(f"   Open trades: {len(open_trades)}")
        conn.close()
        return

    returns = [float(t["return_pct"] or 0) for t in closed]
    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r < 0]

    gp = sum(wins)
    gl = sum(abs(r) for r in losses)
    pf = gp / gl if gl > 0 else 0

    avg_win = gp / len(wins) if wins else 0
    avg_loss = -(gl / len(losses)) if losses else 0

    # Max losing streak
    max_streak = 0
    current_streak = 0
    for r in returns:
        if r < 0:
            current_streak += 1
            max_streak = max(max_streak, current_streak)
        else:
            current_streak = 0

    # Manual stop breaches
    breaches = sum(1 for t in closed if int(t["manual_stop_breach"] or 0) == 1)

    # MFE/MAE averages
    mfe_avg = sum(float(t["mfe_pct"] or 0) for t in closed) / n if n > 0 else 0
    mae_avg = sum(float(t["mae_pct"] or 0) for t in closed) / n if n > 0 else 0

    print("=" * 60)
    print("📊 LIVE TRADING JOURNAL — WEEKLY REPORT")
    print("=" * 60)
    print(f"  Channel: balanced ONLY")
    print(f"  Closed trades: {n}")
    print(f"  Open trades: {len(open_trades)}")
    print()
    print(f"  Win Rate:     {len(wins)}/{n} = {round(len(wins)/n*100, 1)}%")
    print(f"  Profit Factor: {round(pf, 4)}")
    print(f"  Expectancy:   {round(sum(returns)/n, 4)}%")
    print(f"  Avg Win:      +{round(avg_win, 2)}%")
    print(f"  Avg Loss:     {round(avg_loss, 2)}%")
    print(f"  Max Loss:     {round(min(returns), 2)}%")
    print(f"  Max Win:      +{round(max(returns), 2)}%")
    print(f"  Max Loss Streak: {max_streak}")
    print(f"  Manual Stop Breaches: {breaches}")
    print(f"  Avg MFE (favorable): +{round(mfe_avg, 2)}%")
    print(f"  Avg MAE (adverse):   {round(mae_avg, 2)}%")
    print()
    print("  VERDICT:")
    if pf > 1.0 and breaches == 0:
        print("  ✅ PF > 1 with full plan compliance → PROMISING")
    elif pf > 1.0 and breaches > 0:
        print(f"  ⚠️  PF > 1 but {breaches} manual breaches → DISCIPLINE ISSUE")
    else:
        print("  ❌ PF < 1 → NOT READY (fix exit strategy first)")
    print()

    # Detail table
    print("  TRADE DETAILS:")
    print(f"  {'#':>3} {'Ticker':>6} {'Entry':>8} {'Exit':>8} {'Return':>8} {'MFE':>7} {'MAE':>7} {'Reason':>12} {'Plan':>5}")
    print("  " + "-" * 80)
    for t in closed:
        print(f"  {t['id']:>3} {t['ticker']:>6} {t['actual_entry']:>8.2f} {float(t['exit_price'] or 0):>8.2f} {float(t['return_pct'] or 0):>7.2f}% {float(t['mfe_pct'] or 0):>6.2f}% {float(t['mae_pct'] or 0):>6.2f}% {t['exit_reason']:>12} {t['stuck_to_plan']:>5}")

    conn.close()


# ============================================================================
# CLI
# ============================================================================

def main():
    import sys
    if len(sys.argv) < 2:
        print("""
Live Trading Journal — GLMinvestment
=====================================
Usage:
  python3 scripts/live_journal.py init
  python3 scripts/live_journal.py record <signal_id> <actual_entry> [actual_stop] [actual_target] [notes]
  python3 scripts/live_journal.py update <trade_id> <current_price>
  python3 scripts/live_journal.py close <trade_id> <exit_date> <exit_price> <exit_reason> [stuck_to_plan] [notes]
  python3 scripts/live_journal.py report

Commands:
  init     — Initialize the journal database
  record   — Record a new trade from a prediction signal
  update   — Update MFE/MAE for an open trade (call daily)
  close    — Close a trade with exit details
  report   — Print weekly report

Rules:
  - Channel: balanced ONLY (morning_bell excluded)
  - Risk: ≤ 1% per trade
  - Max concurrent: 3
  - No deleting losing trades
  - No retroactive stop changes
""")
        return

    cmd = sys.argv[1]
    if cmd == "init":
        init_journal()
    elif cmd == "record":
        if len(sys.argv) < 4:
            print("Usage: record <signal_id> <actual_entry> [actual_stop] [actual_target] [notes]")
            return
        signal_id = int(sys.argv[2])
        actual_entry = float(sys.argv[3])
        actual_stop = float(sys.argv[4]) if len(sys.argv) > 4 else None
        actual_target = float(sys.argv[5]) if len(sys.argv) > 5 else None
        notes = sys.argv[6] if len(sys.argv) > 6 else ""
        record_trade(signal_id, actual_entry, actual_stop, actual_target, notes)
    elif cmd == "update":
        if len(sys.argv) < 4:
            print("Usage: update <trade_id> <current_price>")
            return
        trade_id = int(sys.argv[2])
        current_price = float(sys.argv[3])
        update_mfe_mae(trade_id, current_price)
    elif cmd == "close":
        if len(sys.argv) < 6:
            print("Usage: close <trade_id> <exit_date> <exit_price> <exit_reason> [stuck_to_plan] [notes]")
            return
        trade_id = int(sys.argv[2])
        exit_date = sys.argv[3]
        exit_price = float(sys.argv[4])
        exit_reason = sys.argv[5]
        stuck = sys.argv[6] if len(sys.argv) > 6 else "yes"
        notes = sys.argv[7] if len(sys.argv) > 7 else ""
        close_trade(trade_id, exit_date, exit_price, exit_reason, stuck, 0 if stuck == "yes" else 1, notes)
    elif cmd == "report":
        weekly_report()
    else:
        print(f"Unknown command: {cmd}")


if __name__ == "__main__":
    main()
