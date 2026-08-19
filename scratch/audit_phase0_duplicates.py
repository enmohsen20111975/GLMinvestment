#!/usr/bin/env python3
"""
PHASE 0.3 Duplicate Detection Audit Agent
READ-ONLY audit of db/predictions.db.

- Uses sqlite3 in read-only URI mode (file:...?mode=ro).
- Does NOT write to the DB.
- Does NOT modify any source files.
- Writes ONLY the deliverable: scripts/audit_phase0_duplicates.json
"""
import json
import os
import sqlite3
import hashlib
import sys
from collections import OrderedDict

PROJECT_ROOT = "/home/z/my-project"
DB_PATH = os.path.join(PROJECT_ROOT, "db", "predictions.db")
ZIP_PATH = os.path.join(PROJECT_ROOT, "data", "active_databases_20260817_full.zip")
OUT_JSON = os.path.join(PROJECT_ROOT, "scripts", "audit_phase0_duplicates.json")

MAX_EXAMPLES = 5
# Round entry_price when grouping to avoid floating-point noise.
ENTRY_ROUND = 4


def connect_ro(path):
    uri = "file:%s?mode=ro" % path
    return sqlite3.connect(uri, uri=True)


def table_columns(conn, table):
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(%s)" % table)
    cols = [r[1] for r in cur.fetchall()]
    return cols


def table_count(conn, table):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM %s" % table)
    return cur.fetchone()[0]


def duplicate_audit(conn, table, key_cols, extra_select=None, where_clause=None):
    """
    Audit duplicates on `key_cols` for `table`.
    Returns dict with: n_raw (caller fills), duplicate_keys, duplicate_rows,
    examples (list of dicts: key, count, sample rows).
    """
    key_expr = ", ".join(key_cols)
    select_cols = ", ".join(key_cols + (extra_select or []))
    where_sql = where_clause or ""

    # 1) Find groups with count>1
    sql_groups = (
        "SELECT %s, COUNT(*) AS cnt FROM %s %s "
        "GROUP BY %s HAVING cnt > 1 ORDER BY cnt DESC, %s"
        % (key_expr, table, where_sql, key_expr, key_expr)
    )
    cur = conn.cursor()
    cur.execute(sql_groups)
    dup_groups = cur.fetchall()

    n_dup_groups = len(dup_groups)
    # duplicate_rows = total rows participating in duplicate groups = sum(cnt)
    n_dup_rows = sum(r[-1] for r in dup_groups)
    # extra rows (rows beyond the first for each dup key)
    n_extra_rows = sum(r[-1] - 1 for r in dup_groups)

    # 2) Build examples (max MAX_EXAMPLES)
    examples = []
    n_cols = len(key_cols)
    for grp in dup_groups[:MAX_EXAMPLES]:
        key_vals = grp[:n_cols]
        cnt = grp[-1]
        # fetch up to 3 sample rows for this key
        where_parts = []
        params = []
        for col, val in zip(key_cols, key_vals):
            if val is None:
                where_parts.append("%s IS NULL" % col)
            else:
                where_parts.append("%s = ?" % col)
                params.append(val)
        sample_sql = (
            "SELECT %s FROM %s WHERE %s ORDER BY rowid LIMIT 3"
            % (select_cols, table, " AND ".join(where_parts))
        )
        cur.execute(sample_sql, params)
        sample_rows = cur.fetchall()
        examples.append({
            "key": dict(zip(key_cols, [str(v) if v is not None else None for v in key_vals])),
            "count": int(cnt),
            "samples": [dict(zip(key_cols + (extra_select or []), [str(c) if c is not None else None for c in row])) for row in sample_rows],
        })

    return {
        "duplicate_keys": int(n_dup_groups),
        "duplicate_rows": int(n_dup_rows),
        "extra_rows_beyond_first": int(n_extra_rows),
        "examples": examples,
    }


def persona_type_distribution(conn):
    cur = conn.cursor()
    cur.execute(
        "SELECT persona_type, COUNT(*) AS cnt FROM persona_predictions "
        "GROUP BY persona_type ORDER BY cnt DESC"
    )
    rows = cur.fetchall()
    return {str(r[0]) if r[0] is not None else "NULL": int(r[1]) for r in rows}


def cross_table_overlap(conn, t1, t2, key_defs, label):
    """
    Find rows in t1 that match rows in t2 on the key definitions.
    key_defs is a list of dicts: {"name": <col_alias>, "t1_expr": <SQL>, "t2_expr": <SQL>}.
    Uses CTE-normalized sub-views so that SQL expressions (e.g. ROUND(entry_price,4))
    work correctly in both SELECT and JOIN contexts.
    Returns: matched_distinct_keys, rows_in_t1_matched, rows_in_t2_matched, examples.
    """
    cur = conn.cursor()
    names = [kd["name"] for kd in key_defs]
    t1_proj = ", ".join('%s AS %s' % (kd["t1_expr"], kd["name"]) for kd in key_defs)
    t2_proj = ", ".join('%s AS %s' % (kd["t2_expr"], kd["name"]) for kd in key_defs)
    proj_csv = ", ".join(names)
    on_parts = ["a.%s = b.%s" % (n, n) for n in names]
    on_clause = " AND ".join(on_parts)

    base = "WITH t1n AS (SELECT %s FROM %s), t2n AS (SELECT %s FROM %s)" % (
        t1_proj, t1, t2_proj, t2
    )

    # 1) distinct shared keys
    sql_shared = (
        "%s SELECT COUNT(*) FROM ("
        "  SELECT DISTINCT %s FROM t1n "
        "  INTERSECT "
        "  SELECT DISTINCT %s FROM t2n"
        ")" % (base, proj_csv, proj_csv)
    )
    try:
        cur.execute(sql_shared)
        shared_keys = cur.fetchone()[0]
    except Exception as e:
        shared_keys = None
        print("WARN shared-key query failed for %s: %s" % (label, e), file=sys.stderr)

    # 2) rows in t1 that have a match in t2
    sql_t1_match = (
        "%s SELECT COUNT(*) FROM t1n a WHERE EXISTS ("
        "  SELECT 1 FROM t2n b WHERE %s"
        ")" % (base, on_clause)
    )
    try:
        cur.execute(sql_t1_match)
        t1_rows_matched = cur.fetchone()[0]
    except Exception as e:
        t1_rows_matched = None
        print("WARN t1 match query failed for %s: %s" % (label, e), file=sys.stderr)

    # 3) rows in t2 that have a match in t1
    sql_t2_match = (
        "%s SELECT COUNT(*) FROM t2n b WHERE EXISTS ("
        "  SELECT 1 FROM t1n a WHERE %s"
        ")" % (base, on_clause)
    )
    try:
        cur.execute(sql_t2_match)
        t2_rows_matched = cur.fetchone()[0]
    except Exception as e:
        t2_rows_matched = None
        print("WARN t2 match query failed for %s: %s" % (label, e), file=sys.stderr)

    # 4) examples: up to 5 shared distinct keys
    examples = []
    try:
        sql_ex = (
            "%s SELECT DISTINCT %s FROM t1n a WHERE EXISTS ("
            "  SELECT 1 FROM t2n b WHERE %s"
            ") LIMIT %d" % (base, proj_csv, on_clause, MAX_EXAMPLES)
        )
        cur.execute(sql_ex)
        for r in cur.fetchall():
            examples.append(dict(zip(names, [str(v) if v is not None else None for v in r])))
    except Exception as e:
        print("WARN example query failed for %s: %s" % (label, e), file=sys.stderr)

    return {
        "matched_distinct_keys": int(shared_keys) if shared_keys is not None else None,
        "rows_in_%s_matched" % t1: int(t1_rows_matched) if t1_rows_matched is not None else None,
        "rows_in_%s_matched" % t2: int(t2_rows_matched) if t2_rows_matched is not None else None,
        "examples": examples,
    }


def column_distribution(conn, table, column):
    cur = conn.cursor()
    cur.execute(
        "SELECT %s, COUNT(*) AS cnt FROM %s GROUP BY %s ORDER BY cnt DESC" % (column, table, column)
    )
    rows = cur.fetchall()
    return {str(r[0]) if r[0] is not None else "NULL": int(r[1]) for r in rows}


def md5_of_file(path):
    if not os.path.exists(path):
        return None
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def dup_pct(n_dup_rows, n_raw):
    if not n_raw:
        return 0.0
    return (100.0 * n_dup_rows) / float(n_raw)


def classify_status(table_blocks):
    """
    Decide PASS / PASS_WITH_WARNING / FAIL based on worst-case duplicate_rows/n_raw across blocks.
    >10% -> FAIL, 1-10% -> PASS_WITH_WARNING, 0% -> PASS clean.
    BLOCKED reserved for inability to read the DB.
    """
    worst_pct = 0.0
    worst_label = None
    for label, n_raw, dup_rows in table_blocks:
        p = dup_pct(dup_rows, n_raw)
        if p > worst_pct:
            worst_pct = p
            worst_label = label
    if worst_pct > 10.0:
        return "FAIL", worst_pct, worst_label
    if worst_pct >= 1.0:
        return "PASS_WITH_WARNING", worst_pct, worst_label
    return "PASS_CLEAN", worst_pct, worst_label


def main():
    if not os.path.exists(DB_PATH):
        print("FATAL: DB not found at %s" % DB_PATH, file=sys.stderr)
        return _emit_blocked("DB not found")

    conn = connect_ro(DB_PATH)

    # ---- verify tables exist ----
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing = {r[0] for r in cur.fetchall()}
    required = {"predictions", "persona_predictions", "prediction_logs"}
    missing = required - existing
    if missing:
        return _emit_blocked("missing tables: %s" % ", ".join(sorted(missing)))

    # ---- schema snapshot ----
    schema = {
        "predictions": table_columns(conn, "predictions"),
        "persona_predictions": table_columns(conn, "persona_predictions"),
        "prediction_logs": table_columns(conn, "prediction_logs"),
    }

    # ================= predictions =================
    pred_n = table_count(conn, "predictions")
    # Key 1: (ticker, prediction_date, persona, entry_price)
    pred_k1 = duplicate_audit(
        conn, "predictions",
        ["ticker", "prediction_date", "persona",
         "ROUND(entry_price, %d)" % ENTRY_ROUND],
        extra_select=["entry_price", "morning_bell", "market", "status", "id"],
    )
    # Key 2: (ticker, prediction_date, entry_price) without persona
    pred_k2 = duplicate_audit(
        conn, "predictions",
        ["ticker", "prediction_date",
         "ROUND(entry_price, %d)" % ENTRY_ROUND],
        extra_select=["entry_price", "persona", "morning_bell", "market", "id"],
    )
    # Key 3: (ticker, prediction_date) WHERE morning_bell = 1
    pred_k3 = duplicate_audit(
        conn, "predictions",
        ["ticker", "prediction_date"],
        extra_select=["entry_price", "persona", "morning_bell", "market", "id"],
        where_clause="WHERE morning_bell = 1",
    )

    predictions_block = {
        "n_raw": int(pred_n),
        "schema_columns": schema["predictions"],
        "persona_distribution": column_distribution(conn, "predictions", "persona"),
        "morning_bell_distribution": column_distribution(conn, "predictions", "morning_bell"),
        "duplicates_by_ticker_date_persona_entry": pred_k1,
        "duplicates_by_ticker_date_entry": pred_k2,
        "duplicates_by_ticker_date_morning_bell": pred_k3,
    }

    # ============= persona_predictions =============
    pp_n = table_count(conn, "persona_predictions")
    pp_k1 = duplicate_audit(
        conn, "persona_predictions",
        ["ticker", "prediction_date", "persona",
         "ROUND(entry_price, %d)" % ENTRY_ROUND],
        extra_select=["entry_price", "persona_type", "status", "market", "id"],
    )
    pp_k2 = duplicate_audit(
        conn, "persona_predictions",
        ["ticker", "prediction_date", "persona_type",
         "ROUND(entry_price, %d)" % ENTRY_ROUND],
        extra_select=["entry_price", "persona", "status", "market", "id"],
    )
    pp_dist = persona_type_distribution(conn)
    pp_persona_dist = column_distribution(conn, "persona_predictions", "persona")
    # Structural warning: the `persona` column on persona_predictions is degenerate
    # (always 'balanced'); the real discriminator is `persona_type`. So the
    # (ticker,date,persona,entry) key collapses gambler+investor pairs into dup groups.
    pp_structural_warnings = []
    if len(pp_persona_dist) == 1:
        only_val = next(iter(pp_persona_dist.keys()))
        only_cnt = pp_persona_dist[only_val]
        pp_structural_warnings.append({
            "code": "DEGENERATE_PERSONA_COLUMN",
            "severity": "HIGH",
            "message": (
                "persona_predictions.persona is constant ('%s' = %d/%d rows). "
                "Every (gambler, investor) pair for the same ticker/date/entry_price "
                "is counted as a duplicate group on the (ticker,date,persona,entry) key. "
                "The correct discriminator is persona_type, which yields 0 duplicates "
                "on (ticker,date,persona_type,entry)."
                % (only_val, only_cnt, pp_n)
            ),
            "duplicate_rows_caused_by_structure": pp_k1["duplicate_rows"],
            "duplicate_pct_caused_by_structure": round(dup_pct(pp_k1["duplicate_rows"], pp_n), 4),
        })
    persona_predictions_block = {
        "n_raw": int(pp_n),
        "schema_columns": schema["persona_predictions"],
        "persona_distribution": pp_persona_dist,
        "persona_type_distribution": pp_dist,
        "duplicates_by_ticker_date_persona_entry": pp_k1,
        "duplicates_by_ticker_date_persona_type_entry": pp_k2,
        "structural_warnings": pp_structural_warnings,
    }

    # ============= prediction_logs =============
    pl_n = table_count(conn, "prediction_logs")
    pl_k1 = duplicate_audit(
        conn, "prediction_logs",
        ["ticker", "prediction_date"],
        extra_select=["source", "entry_price", "recommendation", "id"],
    )
    pl_k2 = duplicate_audit(
        conn, "prediction_logs",
        ["ticker", "prediction_date", "source"],
        extra_select=["entry_price", "recommendation", "id"],
    )
    prediction_logs_block = {
        "n_raw": int(pl_n),
        "schema_columns": schema["prediction_logs"],
        "duplicates_by_ticker_date": pl_k1,
        "duplicates_by_ticker_date_source": pl_k2,
    }

    # ============= cross-table =============
    # predictions vs persona_predictions on (ticker, prediction_date, entry_price rounded)
    cross_pred_pp = cross_table_overlap(
        conn, "predictions", "persona_predictions",
        [
            {"name": "ticker",          "t1_expr": "ticker",                       "t2_expr": "ticker"},
            {"name": "prediction_date", "t1_expr": "prediction_date",              "t2_expr": "prediction_date"},
            {"name": "entry_price_r",   "t1_expr": "ROUND(entry_price, %d)" % ENTRY_ROUND, "t2_expr": "ROUND(entry_price, %d)" % ENTRY_ROUND},
        ],
        label="predictions<->persona_predictions",
    )
    # prediction_logs vs predictions on (ticker, prediction_date)
    cross_logs_pred = cross_table_overlap(
        conn, "prediction_logs", "predictions",
        [
            {"name": "ticker",          "t1_expr": "ticker",          "t2_expr": "ticker"},
            {"name": "prediction_date", "t1_expr": "prediction_date", "t2_expr": "prediction_date"},
        ],
        label="prediction_logs<->predictions",
    )
    # Also: prediction_logs vs persona_predictions on (ticker, prediction_date) — sanity
    cross_logs_pp = cross_table_overlap(
        conn, "prediction_logs", "persona_predictions",
        [
            {"name": "ticker",          "t1_expr": "ticker",          "t2_expr": "ticker"},
            {"name": "prediction_date", "t1_expr": "prediction_date", "t2_expr": "prediction_date"},
        ],
        label="prediction_logs<->persona_predictions",
    )
    cross_table_block = {
        "predictions_vs_persona_predictions_on_ticker_date_entry": cross_pred_pp,
        "prediction_logs_vs_predictions_on_ticker_date": cross_logs_pred,
        "prediction_logs_vs_persona_predictions_on_ticker_date": cross_logs_pp,
    }

    # ============= status decision =============
    # Per the literal rule (>10% dup_rows/n_raw => FAIL), persona_predictions k1
    # triggers FAIL because persona is a degenerate constant column. We classify
    # the literal rule-based STATUS separately from the real data-integrity
    # picture (which excludes the structural degenerate-key case).
    table_blocks = [
        ("predictions[k1:tdpE]", pred_n, pred_k1["duplicate_rows"]),
        ("predictions[k2:tdE]",   pred_n, pred_k2["duplicate_rows"]),
        ("predictions[k3:td,mb]", pred_n, pred_k3["duplicate_rows"]),
        ("persona_predictions[k1:tdpE]", pp_n, pp_k1["duplicate_rows"]),
        ("persona_predictions[k2:tdptE]", pp_n, pp_k2["duplicate_rows"]),
        ("prediction_logs[k1:td]", pl_n, pl_k1["duplicate_rows"]),
        ("prediction_logs[k2:tds]", pl_n, pl_k2["duplicate_rows"]),
    ]
    status_label, worst_pct, worst_block = classify_status(table_blocks)

    # Real data-integrity picture: exclude the persona_predictions k1 structural case.
    di_blocks = [
        ("predictions[k1:tdpE]", pred_n, pred_k1["duplicate_rows"]),
        ("predictions[k2:tdE]",   pred_n, pred_k2["duplicate_rows"]),
        ("predictions[k3:td,mb]", pred_n, pred_k3["duplicate_rows"]),
        ("persona_predictions[k2:tdptE]", pp_n, pp_k2["duplicate_rows"]),
        ("prediction_logs[k1:td]", pl_n, pl_k1["duplicate_rows"]),
        ("prediction_logs[k2:tds]", pl_n, pl_k2["duplicate_rows"]),
    ]
    di_label, di_worst_pct, di_worst_block = classify_status(di_blocks)

    # Translate to required PASS / FAIL / BLOCKED vocabulary (literal rule).
    if status_label == "FAIL":
        final_status = "FAIL"
        fail_kind = "STRUCTURAL_DEGENERATE_KEY"
    elif status_label == "PASS_WITH_WARNING":
        final_status = "PASS"
        fail_kind = None
    else:
        final_status = "PASS"
        fail_kind = None

    # Data-integrity verdict (excluding structural case).
    if di_label == "FAIL":
        di_status = "FAIL"
    elif di_label == "PASS_WITH_WARNING":
        di_status = "PASS_WITH_WARNING"
    else:
        di_status = "PASS_CLEAN"

    # NEXT_PHASE_ALLOWED: literal FAIL -> NO (schema remediation required first).
    next_phase_allowed = "NO" if final_status == "FAIL" else "YES"

    # MD5 of dataset zip
    zip_md5 = md5_of_file(ZIP_PATH)

    report = OrderedDict()
    report["audit"] = {
        "phase": "0.3",
        "name": "Duplicate Detection Audit",
        "mode": "READ-ONLY",
        "db": DB_PATH,
        "dataset_zip": ZIP_PATH,
        "dataset_md5": zip_md5,
        "engine": "python3 + sqlite3 (read-only URI)",
    }
    report["status"] = {
        "status": final_status,
        "fail_kind": fail_kind,
        "internal_label": status_label,
        "worst_duplicate_pct": round(worst_pct, 4),
        "worst_block": worst_block,
        "rule": ">10% FAIL | 1-10% PASS(warning) | 0% PASS(clean)",
        "data_integrity_status": di_status,
        "data_integrity_worst_pct": round(di_worst_pct, 4),
        "data_integrity_worst_block": di_worst_block,
        "data_integrity_note": (
            "Excludes persona_predictions k1 (ticker,date,persona,entry) because the "
            "`persona` column is a degenerate constant 'balanced'; the canonical key "
            "is (ticker,date,persona_type,entry) which yields 0 duplicates."
        ),
        "next_phase_allowed": next_phase_allowed,
    }
    report["predictions"] = predictions_block
    report["persona_predictions"] = persona_predictions_block
    report["prediction_logs"] = prediction_logs_block
    report["cross_table"] = cross_table_block

    # Ensure scripts/ exists
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)

    conn.close()

    # Console summary
    print("=== PHASE 0.3 Duplicate Audit Summary ===")
    print("DB:", DB_PATH)
    print("ZIP md5:", zip_md5)
    print("STATUS:", final_status, "(internal:", status_label, ") worst_pct:", round(worst_pct, 4), "block:", worst_block)
    print("NEXT_PHASE_ALLOWED:", report["status"]["next_phase_allowed"])
    print("predictions n_raw:", pred_n,
          "| k1 dup_keys:", pred_k1["duplicate_keys"], "dup_rows:", pred_k1["duplicate_rows"],
          "| k2 dup_keys:", pred_k2["duplicate_keys"], "dup_rows:", pred_k2["duplicate_rows"],
          "| k3(morning_bell) dup_keys:", pred_k3["duplicate_keys"], "dup_rows:", pred_k3["duplicate_rows"])
    print("persona_predictions n_raw:", pp_n,
          "| k1 dup_keys:", pp_k1["duplicate_keys"], "dup_rows:", pp_k1["duplicate_rows"],
          "| k2 dup_keys:", pp_k2["duplicate_keys"], "dup_rows:", pp_k2["duplicate_rows"])
    print("  persona_type_distribution:", pp_dist)
    print("prediction_logs n_raw:", pl_n,
          "| k1 dup_keys:", pl_k1["duplicate_keys"], "dup_rows:", pl_k1["duplicate_rows"],
          "| k2 dup_keys:", pl_k2["duplicate_keys"], "dup_rows:", pl_k2["duplicate_rows"])
    print("cross predictions<->persona_predictions:",
          cross_pred_pp["matched_distinct_keys"],
          "shared keys; t1 rows matched:", list(cross_pred_pp.values())[1],
          "t2 rows matched:", list(cross_pred_pp.values())[2])
    print("cross prediction_logs<->predictions:",
          cross_logs_pred["matched_distinct_keys"],
          "shared keys; t1 rows matched:", list(cross_logs_pred.values())[1],
          "t2 rows matched:", list(cross_logs_pred.values())[2])
    print("Output JSON:", OUT_JSON)


def _emit_blocked(reason):
    report = OrderedDict()
    report["audit"] = {
        "phase": "0.3",
        "name": "Duplicate Detection Audit",
        "mode": "READ-ONLY",
        "error": reason,
    }
    report["status"] = {
        "status": "BLOCKED",
        "reason": reason,
        "next_phase_allowed": "NO",
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print("BLOCKED:", reason)
    return None


if __name__ == "__main__":
    main()
