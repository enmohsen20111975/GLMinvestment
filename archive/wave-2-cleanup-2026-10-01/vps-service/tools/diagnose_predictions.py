#!/usr/bin/env python3
"""
Diagnostic Tool — Customer-Facing Prediction Health Report
============================================================
سكريبت تشخيص التوصيات المعروضة للعملاء

يقرأ من جدول التوقعات الفعلي (predictions table في predictions.db)
ويحسب على آخر 30 و 60 يومًا:
  - عدد التوصيات (الكل / المستوطة / المعلقة)
  - Win Rate
  - متوسط العائد (للرابحة / للخاسرة / الإجمالي)
  - Profit Factor
  - أداء جرس الصباح منفصل (morning_bell = 1)
  - توزيع الخسائر vs الأرباح (histogram)
  - توزيع الأدلة (evidence_count) للـ V40

الإخراج:
  1. تقرير واضح في الترمينال
  2. ملف JSON مفصل
  3. ملف Markdown قابل للقراءة

الاستخدام على الإنتاج:
  cd /path/to/project
  python3 vps-service/tools/diagnose_predictions.py
  python3 vps-service/tools/diagnose_predictions.py --db /custom/path/predictions.db
  python3 vps-service/tools/diagnose_predictions.py --persona balanced --market EGX
  python3 vps-service/tools/diagnose_predictions.py --days 90

ملاحظات:
  - آمن: يفتح قاعدة البيانات في وضع readonly
  - خفيف: استعلامات SQL مجمّعة، لا يحمل كل الصفوف في الذاكرة
  - لا يعدّل أي بيانات
"""

import argparse
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta, date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────

# Default DB path: relative to project root (parent of vps-service/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB = PROJECT_ROOT / "db" / "predictions.db"

# Output directory for reports
DEFAULT_OUT_DIR = PROJECT_ROOT / "vps-service" / "backtest_results"

# A prediction is "settled" if it has a measurable actual_return.
# We use actual_return IS NOT NULL as the primary settled signal because
# production backfill may not always populate outcome_date/exit_reason.
# We also clamp absurd returns (data quality guard).
MAX_REALISTIC_RETURN = 500.0   # % — anything above is a data error
MIN_REALISTIC_RETURN = -95.0   # % — can't lose more than ~100%


# ──────────────────────────────────────────────────────────────────────────
# Database access
# ──────────────────────────────────────────────────────────────────────────

def open_db(db_path: str) -> sqlite3.Connection:
    """Open predictions.db in readonly mode (safe for production)."""
    if not os.path.exists(db_path):
        # Try immutable URI mode (allows concurrent access)
        db_path_uri = f"file:{db_path}?immutable=1"
        try:
            return sqlite3.connect(db_path_uri, uri=True, timeout=30.0)
        except sqlite3.Error:
            pass
        raise FileNotFoundError(f"Predictions DB not found: {db_path}")
    try:
        # Readonly — never modify production data
        return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=30.0)
    except sqlite3.Error:
        return sqlite3.connect(db_path, timeout=30.0)


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?",
        (table,)
    ).fetchone()
    return row[0] > 0


def get_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


# ──────────────────────────────────────────────────────────────────────────
# Core metric computation
# ──────────────────────────────────────────────────────────────────────────

def compute_metrics(rows: List[Tuple]) -> Dict[str, Any]:
    """
    Compute win-rate, PF, avg returns, distribution from settled prediction rows.
    Each row = (actual_return, morning_bell, evidence_count, persona, ticker,
                prediction_date, entry_price, hit_target, hit_stop).
    """
    if not rows:
        return _empty_metrics()

    total = len(rows)
    wins = [r for r in rows if r[0] is not None and r[0] > 0]
    losses = [r for r in rows if r[0] is not None and r[0] < 0]
    flat = [r for r in rows if r[0] is not None and r[0] == 0]
    unsettled = [r for r in rows if r[0] is None]

    settled = wins + losses + flat
    win_returns = [r[0] for r in wins]
    loss_returns = [r[0] for r in losses]

    gross_profit = sum(win_returns)
    gross_loss = abs(sum(loss_returns))
    pf = gross_profit / gross_loss if gross_loss > 0 else float('inf') if gross_profit > 0 else 0.0

    avg_win = sum(win_returns) / len(win_returns) if win_returns else 0.0
    avg_loss = sum(loss_returns) / len(loss_returns) if loss_returns else 0.0
    avg_return = (sum(win_returns) + sum(loss_returns)) / len(settled) if settled else 0.0

    win_rate = len(wins) / len(settled) * 100 if settled else 0.0

    # Max drawdown (sequential equity curve, ordered by prediction_date)
    # Using actual_return as % gain per trade, starting from equity = 100
    equity = 100.0
    peak = equity
    max_dd = 0.0
    # Sort settled by prediction_date for sequential equity
    dated = [(r[5], r[0]) for r in settled if r[5] and r[0] is not None]
    dated.sort(key=lambda x: x[0])
    for _, ret in dated:
        equity *= (1 + ret / 100.0)
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak * 100
        if dd > max_dd:
            max_dd = dd

    # Distribution buckets
    dist = _distribution(win_returns, loss_returns)

    # Morning bell subset
    mb_rows = [r for r in settled if r[1] == 1]
    mb_wins = [r for r in mb_rows if r[0] > 0]
    mb_losses = [r for r in mb_rows if r[0] < 0]
    mb_wr = len(mb_wins) / len(mb_rows) * 100 if mb_rows else 0.0
    mb_gp = sum(r[0] for r in mb_wins)
    mb_gl = abs(sum(r[0] for r in mb_losses))
    mb_pf = mb_gp / mb_gl if mb_gl > 0 else float('inf') if mb_gp > 0 else 0.0
    mb_avg = (sum(r[0] for r in mb_wins) + sum(r[0] for r in mb_losses)) / len(mb_rows) if mb_rows else 0.0

    # Evidence distribution (V40)
    ev_dist = defaultdict(lambda: {"total": 0, "wins": 0, "losses": 0, "returns": 0.0})
    for r in settled:
        ev = r[2] if r[2] is not None else 0
        ev_dist[ev]["total"] += 1
        if r[0] and r[0] > 0:
            ev_dist[ev]["wins"] += 1
        elif r[0] and r[0] < 0:
            ev_dist[ev]["losses"] += 1
        if r[0]:
            ev_dist[ev]["returns"] += r[0]

    return {
        "total_predictions": total,
        "settled": len(settled),
        "pending": len(unsettled),
        "wins": len(wins),
        "losses": len(losses),
        "flat": len(flat),
        "win_rate_pct": round(win_rate, 2),
        "profit_factor": round(pf, 3) if pf != float('inf') else "inf",
        "avg_win_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "avg_return_pct": round(avg_return, 2),
        "gross_profit_pct": round(gross_profit, 2),
        "gross_loss_pct": round(gross_loss, 2),
        "max_drawdown_pct": round(max_dd, 2),
        "final_equity": round(equity, 2),
        "morning_bell": {
            "total": len(mb_rows),
            "wins": len(mb_wins),
            "losses": len(mb_losses),
            "win_rate_pct": round(mb_wr, 2),
            "profit_factor": round(mb_pf, 3) if mb_pf != float('inf') else "inf",
            "avg_return_pct": round(mb_avg, 2),
            "gross_profit_pct": round(mb_gp, 2),
            "gross_loss_pct": round(mb_gl, 2),
        },
        "distribution": dist,
        "evidence_distribution": {
            str(k): {
                "total": v["total"],
                "wins": v["wins"],
                "losses": v["losses"],
                "win_rate_pct": round(v["wins"] / v["total"] * 100, 2) if v["total"] else 0,
                "avg_return_pct": round(v["returns"] / v["total"], 2) if v["total"] else 0,
            }
            for k, v in sorted(ev_dist.items())
        },
    }


def _empty_metrics() -> Dict[str, Any]:
    return {
        "total_predictions": 0, "settled": 0, "pending": 0,
        "wins": 0, "losses": 0, "flat": 0,
        "win_rate_pct": 0, "profit_factor": 0,
        "avg_win_pct": 0, "avg_loss_pct": 0, "avg_return_pct": 0,
        "gross_profit_pct": 0, "gross_loss_pct": 0,
        "max_drawdown_pct": 0, "final_equity": 100,
        "morning_bell": {"total": 0, "wins": 0, "losses": 0,
                         "win_rate_pct": 0, "profit_factor": 0,
                         "avg_return_pct": 0, "gross_profit_pct": 0,
                         "gross_loss_pct": 0},
        "distribution": {}, "evidence_distribution": {},
    }


def _distribution(win_returns: List[float], loss_returns: List[float]) -> Dict[str, int]:
    """Bucket all returns into ranges for a histogram."""
    buckets = {
        "< -15%": 0, "-15% to -10%": 0, "-10% to -5%": 0, "-5% to 0%": 0,
        "0% to +5%": 0, "+5% to +10%": 0, "+10% to +15%": 0, "+15% to +25%": 0,
        "> +25%": 0,
    }
    for r in win_returns:
        if r >= 25: buckets["> +25%"] += 1
        elif r >= 15: buckets["+15% to +25%"] += 1
        elif r >= 10: buckets["+10% to +15%"] += 1
        elif r >= 5: buckets["+5% to +10%"] += 1
        else: buckets["0% to +5%"] += 1
    for r in loss_returns:
        if r <= -15: buckets["< -15%"] += 1
        elif r <= -10: buckets["-15% to -10%"] += 1
        elif r <= -5: buckets["-10% to -5%"] += 1
        else: buckets["-5% to 0%"] += 1
    return buckets


# ──────────────────────────────────────────────────────────────────────────
# Query builder
# ──────────────────────────────────────────────────────────────────────────

def fetch_predictions(
    conn: sqlite3.Connection,
    days_back: Optional[int],
    persona: Optional[str],
    market: Optional[str],
) -> List[Tuple]:
    """
    Fetch prediction rows matching filters.
    Returns list of tuples:
      (actual_return, morning_bell, evidence_count, persona, ticker,
       prediction_date, entry_price, hit_target, hit_stop)
    Applies data-quality clamping on actual_return.
    """
    cols = get_columns(conn, "predictions")
    has_mb = "morning_bell" in cols
    has_ev = "evidence_count" in cols

    where_parts = []
    params: List[Any] = []

    if days_back is not None and days_back > 0:
        cutoff = (date.today() - timedelta(days=days_back)).isoformat()
        where_parts.append("prediction_date >= ?")
        params.append(cutoff)
    if persona:
        where_parts.append("persona = ?")
        params.append(persona)
    if market:
        where_parts.append("(market = ? OR market IS NULL)")
        params.append(market.upper())

    where_clause = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""

    mb_sel = "morning_bell" if has_mb else "0 AS morning_bell"
    ev_sel = "evidence_count" if has_ev else "0 AS evidence_count"

    query = f"""
        SELECT actual_return, {mb_sel}, {ev_sel}, persona, ticker,
               prediction_date, entry_price, hit_target, hit_stop
        FROM predictions{where_clause}
        ORDER BY prediction_date DESC, id DESC
    """

    rows = conn.execute(query, params).fetchall()

    # Data quality: clamp absurd returns
    cleaned = []
    skipped = 0
    for r in rows:
        ret = r[0]
        if ret is not None and (ret > MAX_REALISTIC_RETURN or ret < MIN_REALISTIC_RETURN):
            skipped += 1
            continue
        cleaned.append(r)
    if skipped:
        print(f"  ⚠️  Skipped {skipped} rows with unrealistic returns (data quality guard)")

    return cleaned


# ──────────────────────────────────────────────────────────────────────────
# Report formatting
# ──────────────────────────────────────────────────────────────────────────

def format_terminal_report(
    metrics_30: Dict, metrics_60: Dict, metrics_all: Dict,
    persona: Optional[str], market: Optional[str],
) -> str:
    """Format a clear, readable terminal report."""
    filter_desc = []
    if persona: filter_desc.append(f"persona={persona}")
    if market: filter_desc.append(f"market={market}")
    filter_str = f" [{', '.join(filter_desc)}]" if filter_desc else " [الكل]"

    lines = []
    lines.append("")
    lines.append("=" * 72)
    lines.append("  📊 تقرير تشخيص التوصيات المعروضة للعملاء")
    lines.append(f"  التاريخ: {datetime.now().strftime('%Y-%m-%d %H:%M')}{filter_str}")
    lines.append("=" * 72)

    for label, m in [("آخر 30 يوم", metrics_30),
                     ("آخر 60 يوم", metrics_60),
                     ("كل الأوقات", metrics_all)]:
        lines.append("")
        lines.append(f"── {label} {'─' * (58 - len(label))}")
        lines.append(f"  إجمالي التوصيات:      {m['total_predictions']}")
        lines.append(f"  المستوطة (settled):   {m['settled']}  |  معلقة: {m['pending']}")
        lines.append(f"  رابحة / خاسرة:        {m['wins']} / {m['losses']}")
        lines.append(f"  Win Rate:             {m['win_rate_pct']}%")
        pf_str = str(m['profit_factor'])
        lines.append(f"  Profit Factor:        {pf_str}")
        lines.append(f"  متوسط الربح:          +{m['avg_win_pct']}%")
        lines.append(f"  متوسط الخسارة:        {m['avg_loss_pct']}%")
        lines.append(f"  متوسط العائد/صفقة:    {m['avg_return_pct']}%")
        lines.append(f"  Max Drawdown:         {m['max_drawdown_pct']}%")
        lines.append(f"  Equity النهائي:       {m['final_equity']} (من 100)")

        mb = m['morning_bell']
        if mb['total'] > 0:
            lines.append(f"  🔔 جرس الصباح:")
            lines.append(f"     العدد: {mb['total']}  |  WR: {mb['win_rate_pct']}%  |  PF: {mb['profit_factor']}")
            lines.append(f"     متوسط العائد: {mb['avg_return_pct']}%  |  ربح إجمالي: +{mb['gross_profit_pct']}%  |  خسارة: {mb['gross_loss_pct']}%")

    # Distribution
    lines.append("")
    lines.append("── توزيع العوائد (آخر 30 يوم) ──────────────────────")
    for bucket, count in metrics_30.get("distribution", {}).items():
        bar = "█" * min(count, 40)
        lines.append(f"  {bucket:<18} {count:>4}  {bar}")

    # Evidence distribution
    ev = metrics_30.get("evidence_distribution", {})
    if ev:
        lines.append("")
        lines.append("── توزيع الأدلة (evidence_count) — آخر 30 يوم ─────")
        lines.append(f"  {'ev':<5} {'العدد':<6} {'WR%':<8} {'متوسط العائد':<12}")
        for k, v in ev.items():
            lines.append(f"  {k:<5} {v['total']:<6} {v['win_rate_pct']:<8} {v['avg_return_pct']}%")

    lines.append("")
    lines.append("=" * 72)
    lines.append("  💡 للحصول على تقرير مفصل، راجع ملفات JSON و Markdown")
    lines.append("=" * 72)
    lines.append("")

    return "\n".join(lines)


def format_markdown_report(
    metrics_30: Dict, metrics_60: Dict, metrics_all: Dict,
    persona: Optional[str], market: Optional[str],
) -> str:
    """Format a Markdown report for archival."""
    filter_desc = []
    if persona: filter_desc.append(f"persona=`{persona}`")
    if market: filter_desc.append(f"market=`{market}`")
    filter_str = f" ({', '.join(filter_desc)})" if filter_desc else ""

    lines = []
    lines.append(f"# تقرير تشخيص التوصيات{filter_str}")
    lines.append(f"> تاريخ التوليد: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")

    for label, m in [("آخر 30 يوم", metrics_30),
                     ("آخر 60 يوم", metrics_60),
                     ("كل الأوقات", metrics_all)]:
        lines.append(f"## {label}")
        lines.append("")
        lines.append("| المؤشر | القيمة |")
        lines.append("|--------|--------|")
        lines.append(f"| إجمالي التوصيات | {m['total_predictions']} |")
        lines.append(f"| المستوطة | {m['settled']} |")
        lines.append(f"| معلقة | {m['pending']} |")
        lines.append(f"| رابحة | {m['wins']} |")
        lines.append(f"| خاسرة | {m['losses']} |")
        lines.append(f"| Win Rate | {m['win_rate_pct']}% |")
        lines.append(f"| Profit Factor | {m['profit_factor']} |")
        lines.append(f"| متوسط الربح | +{m['avg_win_pct']}% |")
        lines.append(f"| متوسط الخسارة | {m['avg_loss_pct']}% |")
        lines.append(f"| متوسط العائد/صفقة | {m['avg_return_pct']}% |")
        lines.append(f"| Max Drawdown | {m['max_drawdown_pct']}% |")
        lines.append(f"| Equity النهائي | {m['final_equity']} |")
        lines.append("")

        mb = m['morning_bell']
        if mb['total'] > 0:
            lines.append(f"### 🔔 جرس الصباح ({label})")
            lines.append("")
            lines.append("| المؤشر | القيمة |")
            lines.append("|--------|--------|")
            lines.append(f"| العدد | {mb['total']} |")
            lines.append(f"| Win Rate | {mb['win_rate_pct']}% |")
            lines.append(f"| Profit Factor | {mb['profit_factor']} |")
            lines.append(f"| متوسط العائد | {mb['avg_return_pct']}% |")
            lines.append(f"| ربح إجمالي | +{mb['gross_profit_pct']}% |")
            lines.append(f"| خسارة إجمالية | {mb['gross_loss_pct']}% |")
            lines.append("")

    # Distribution
    lines.append("## توزيع العوائد (آخر 30 يوم)")
    lines.append("")
    lines.append("| النطاق | العدد |")
    lines.append("|--------|-------|")
    for bucket, count in metrics_30.get("distribution", {}).items():
        lines.append(f"| {bucket} | {count} |")
    lines.append("")

    # Evidence distribution
    ev = metrics_30.get("evidence_distribution", {})
    if ev:
        lines.append("## توزيع الأدلة (evidence_count) — آخر 30 يوم")
        lines.append("")
        lines.append("| evidence | العدد | WR% | متوسط العائد |")
        lines.append("|----------|-------|-----|--------------|")
        for k, v in ev.items():
            lines.append(f"| {k} | {v['total']} | {v['win_rate_pct']}% | {v['avg_return_pct']}% |")
        lines.append("")

    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="تشخيص التوصيات المعروضة للعملاء (Production-safe, readonly)"
    )
    parser.add_argument("--db", default=str(DEFAULT_DB),
                        help=f"مسار قاعدة بيانات التوقعات (default: {DEFAULT_DB})")
    parser.add_argument("--persona", default=None,
                        help="فلترة حسب persona (balanced/investor/gambler)")
    parser.add_argument("--market", default=None,
                        help="فلترة حسب market (EGX/TADAWUL)")
    parser.add_argument("--days", type=int, default=None,
                        help="أيام إضافية للفترة الكلية (default: كل الأوقات)")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR),
                        help=f"مجلد الإخراج (default: {DEFAULT_OUT_DIR})")
    args = parser.parse_args()

    # Resolve paths
    db_path = os.path.abspath(args.db)
    out_dir = Path(os.path.abspath(args.out_dir))
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"📂 قاعدة البيانات: {db_path}")

    if not os.path.exists(db_path):
        print(f"❌ الملف غير موجود: {db_path}")
        sys.exit(1)

    conn = open_db(db_path)

    if not table_exists(conn, "predictions"):
        print("❌ جدول 'predictions' غير موجود في قاعدة البيانات")
        conn.close()
        sys.exit(1)

    cols = get_columns(conn, "predictions")
    print(f"📋 الأعمدة المتاحة: {len(cols)}")
    if "morning_bell" in cols:
        print("  ✅ morning_bell column present (V40.1+)")
    if "evidence_count" in cols:
        print("  ✅ evidence_count column present (V40.1+)")

    # Fetch for 3 periods
    print("\n⏳ جاري حساب المقاييس...")
    rows_30 = fetch_predictions(conn, 30, args.persona, args.market)
    rows_60 = fetch_predictions(conn, 60, args.persona, args.market)
    rows_all = fetch_predictions(conn, args.days, args.persona, args.market)

    print(f"  آخر 30 يوم: {len(rows_30)} صف")
    print(f"  آخر 60 يوم: {len(rows_60)} صف")
    print(f"  كل الأوقات:  {len(rows_all)} صف")

    metrics_30 = compute_metrics(rows_30)
    metrics_60 = compute_metrics(rows_60)
    metrics_all = compute_metrics(rows_all)

    conn.close()

    # Terminal report
    report = format_terminal_report(metrics_30, metrics_60, metrics_all,
                                     args.persona, args.market)
    print(report)

    # Save JSON
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = ""
    if args.persona: suffix += f"_{args.persona}"
    if args.market: suffix += f"_{args.market}"

    json_path = out_dir / f"diagnosis_{timestamp}{suffix}.json"
    json_data = {
        "generated_at": datetime.now().isoformat(),
        "filters": {"persona": args.persona, "market": args.market,
                     "all_days": args.days},
        "last_30_days": metrics_30,
        "last_60_days": metrics_60,
        "all_time": metrics_all,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)
    print(f"💾 JSON: {json_path}")

    # Save Markdown
    md_path = out_dir / f"diagnosis_{timestamp}{suffix}.md"
    md_content = format_markdown_report(metrics_30, metrics_60, metrics_all,
                                         args.persona, args.market)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f"📝 Markdown: {md_path}")

    # Exit code: 0 if WR >= 40% and PF >= 1.0, else 1 (for cron/alerting)
    wr_30 = metrics_30["win_rate_pct"]
    pf_30 = metrics_30["profit_factor"]
    pf_val = pf_30 if isinstance(pf_30, (int, float)) else 2.0
    if wr_30 >= 40.0 and pf_val >= 1.0:
        print("\n✅ المؤشرات ضمن النطاق المقبول")
        sys.exit(0)
    else:
        print(f"\n⚠️  تنبيه: WR={wr_30}% أو PF={pf_30} خارج النطاق المقبول (WR≥40%, PF≥1.0)")
        sys.exit(2)


if __name__ == "__main__":
    main()
