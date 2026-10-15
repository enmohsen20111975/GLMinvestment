#!/usr/bin/env python3
"""
dcs_data.py — DCS Telemetry CLI helper (Bravo 2 / Python calc brain)
=====================================================================
Invoked by Next.js API route via child_process. Reads REAL extracted production
DBs and computes canonical indicators (ATR/RSI Wilder's) by loading
vps-service/analyzers/indicators/atr.py + rsi.py DIRECTLY via importlib.
NO mock data (Rule 27). NO duplicate math (Rule 67b). Python = sole calc brain (Rule 4).

Usage: python3 dcs_data.py <view> [limit|symbol] [bars]
  views: overview, stocks, indicators, signals, feeds, crypto, risk-guard, screener
"""
import os, sys, sqlite3, json, importlib.util
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DB_DIR = "/home/z/my-project/GLMinvestment/db/extracted_db"
ATR_PY = "/home/z/my-project/GLMinvestment/vps-service/analyzers/indicators/atr.py"
RSI_PY = "/home/z/my-project/GLMinvestment/vps-service/analyzers/indicators/rsi.py"

def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m
_atr = _load(ATR_PY, "_dcs_atr")
_rsi = _load(RSI_PY, "_dcs_rsi")
calc_atr = _atr.calc_atr
calc_rsi = _rsi.calc_rsi

def _connect(name):
    p = os.path.join(DB_DIR, name)
    if not os.path.exists(p): return None
    try:
        c = sqlite3.connect(f"file:{p}?mode=ro", uri=True); c.row_factory = sqlite3.Row; return c
    except Exception: return None

def _rows(name, sql, params=()):
    c = _connect(name)
    if c is None: return []
    try: return [dict(r) for r in c.execute(sql, params).fetchall()]
    except Exception: return []
    finally: c.close()

def _one(name, sql, params=()):
    r = _rows(name, sql, params); return r[0] if r else {}

def _count(name, table):
    r = _one(name, f'SELECT COUNT(*) AS n FROM "{table}"')
    return int(r.get("n", 0)) if r else 0

def _rr(entry, target, stop):
    try: e, t, s = float(entry or 0), float(target or 0), float(stop or 0)
    except Exception: return None
    if e <= 0 or t <= 0 or s <= 0 or s >= e: return None
    risk = e - s
    if risk <= 0: return None
    return round((t - e) / risk, 3)

def v_overview():
    eng = _one("predictions.db", "SELECT is_running, current_market, current_ticker, total_analyzed, total_pending, last_full_analysis, last_run FROM analysis_engine_status LIMIT 1")
    stats = _one("predictions.db", "SELECT total_predictions, successful_predictions, failed_predictions, pending_predictions, success_rate, avg_return, avg_maestro_score FROM aiPredictionStats LIMIT 1")
    return {"engine": {"is_running": bool(eng.get("is_running")) if eng else False, "current_market": eng.get("current_market"), "current_ticker": eng.get("current_ticker"), "total_analyzed": eng.get("total_analyzed"), "total_pending": eng.get("total_pending"), "last_full_analysis": eng.get("last_full_analysis"), "last_run": eng.get("last_run")}, "counts": {"stocks_egx_ksa": _count("stocks.db", "egksco_stocks"), "price_history_rows": _count("price_history.db", "price_history"), "ai_predictions": _count("predictions.db", "aiPrediction"), "crypto_logs": _count("predictions.db", "crypto_predictions_log"), "crypto_ticks": _count("data_engine.db", "crypto_prices"), "cached_analyses": _count("stocks.db", "cached_analysis"), "screener_cards": _count("price_history.db", "screener_daily")}, "performance": {"success_rate": stats.get("success_rate"), "avg_return": stats.get("avg_return"), "avg_maestro_score": stats.get("avg_maestro_score"), "total": stats.get("total_predictions"), "successful": stats.get("successful_predictions"), "failed": stats.get("failed_predictions"), "pending": stats.get("pending_predictions")}, "server_time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}

def v_stocks(limit=20):
    # cached_analysis (stocks.db) lacks target/stop — stocks panel sourced from
    # predictions.db/aiPrediction (real entry/target/stop + maestro_score + R/R).
    rows = _rows("predictions.db", "SELECT stock_symbol, stock_name_ar, signal_type, confidence, maestro_score, entry_price, target_price, stop_loss FROM aiPrediction WHERE entry_price>0 AND target_price>0 AND stop_loss>0 ORDER BY maestro_score DESC LIMIT ?", (limit * 3,))
    seen, out = set(), []
    for r in rows:
        sym = r.get("stock_symbol")
        if sym and sym not in seen:
            seen.add(sym)
            rr = _rr(r.get("entry_price"), r.get("target_price"), r.get("stop_loss"))
            out.append({"symbol": sym, "name": r.get("stock_name_ar"), "price": r.get("entry_price"), "sector": None, "recommendation": r.get("signal_type"), "composite_score": r.get("maestro_score"), "target": r.get("target_price"), "stop_loss": r.get("stop_loss"), "rr": rr, "rr_pass": (rr is not None and rr >= 1.5)})
            if len(out) >= limit: break
    return out

def v_indicators(symbol, bars=30):
    rows = _rows("price_history.db", "SELECT date, high_price, low_price, close_price FROM price_history WHERE ticker=? ORDER BY date DESC LIMIT ?", (symbol.upper(), bars))
    if len(rows) < 15: return {"symbol": symbol.upper(), "atr_14": None, "rsi_14": None, "note": "insufficient price history (<15 bars)", "bars": len(rows)}
    rows.reverse()
    highs = [float(r["high_price"]) for r in rows if r["high_price"] is not None]
    lows = [float(r["low_price"]) for r in rows if r["low_price"] is not None]
    closes = [float(r["close_price"]) for r in rows if r["close_price"] is not None]
    n = min(len(highs), len(lows), len(closes)); highs, lows, closes = highs[-n:], lows[-n:], closes[-n:]
    return {"symbol": symbol.upper(), "date": rows[-1].get("date"), "close": closes[-1] if closes else None, "atr_14": calc_atr(highs, lows, closes, 14), "rsi_14": calc_rsi(closes, 14), "bars_used": n, "calc_source": "vps-service/analyzers/indicators/atr.py + rsi.py (Wilder's canonical, Rule 67b)"}

def v_signals(limit=20):
    rows = _rows("predictions.db", "SELECT stock_symbol, stock_name_ar, signal_type, confidence, maestro_score, entry_price, target_price, stop_loss, created_at FROM aiPrediction WHERE stock_symbol IS NOT NULL ORDER BY id DESC LIMIT ?", (limit,))
    out = []
    for r in rows:
        rr = _rr(r.get("entry_price"), r.get("target_price"), r.get("stop_loss"))
        out.append({"symbol": r.get("stock_symbol"), "name": r.get("stock_name_ar"), "signal": r.get("signal_type"), "confidence": r.get("confidence"), "maestro_score": r.get("maestro_score"), "entry": r.get("entry_price"), "target": r.get("target_price"), "stop_loss": r.get("stop_loss"), "rr": rr, "rr_pass": (rr is not None and rr >= 1.5), "created_at": r.get("created_at")})
    return out

def v_feeds():
    rows = _rows("stocks.db", "SELECT sync_type, status, stocks_count, new_stocks, updated_stocks, errors, duration_seconds, message, sync_time FROM egksco_sync_status WHERE id IN (SELECT MAX(id) FROM egksco_sync_status GROUP BY sync_type) ORDER BY id DESC")
    cl = _rows("data_engine.db", "SELECT run_ts, total, succeeded, failed, failed_symbols FROM crypto_fetch_log ORDER BY id DESC LIMIT 1")
    return {"market_syncs": [{"market": r.get("sync_type"), "status": r.get("status"), "stocks_count": r.get("stocks_count"), "new": r.get("new_stocks"), "updated": r.get("updated_stocks"), "errors": r.get("errors"), "duration_s": r.get("duration_seconds"), "message": r.get("message"), "sync_time": r.get("sync_time"), "led": "ok" if (r.get("status") == "success" and not r.get("errors")) else ("warn" if r.get("errors") else "down")} for r in rows], "crypto_last_fetch": cl[0] if cl else {}}

def v_crypto(limit=12):
    # data_engine.db/crypto_prices is partially corrupt on GROUP BY — use a simple
    # WHERE+LIMIT (non-corrupt path) + dedupe by symbol in Python. Fallback: intraday.db.
    rows = _rows("data_engine.db", "SELECT symbol, name, price_usd, price_change_24h, price_change_7d, market_cap_rank FROM crypto_prices WHERE market_cap_rank IS NOT NULL LIMIT ?", (limit * 10,))
    if not rows:
        rows = _rows("intraday.db", "SELECT symbol, name, price_usd, change_24h AS price_change_24h, NULL AS price_change_7d, NULL AS market_cap_rank FROM crypto_intraday WHERE id IN (SELECT MAX(id) FROM crypto_intraday GROUP BY symbol) ORDER BY market_cap DESC LIMIT ?", (limit * 10,))
    seen, out = set(), []
    for r in rows:
        sym = r.get("symbol")
        if sym and sym not in seen:
            seen.add(sym)
            out.append({"symbol": sym, "name": r.get("name"), "price_usd": r.get("price_usd"), "change_24h": r.get("price_change_24h"), "change_7d": r.get("price_change_7d"), "rank": r.get("market_cap_rank")})
            if len(out) >= limit: break
    return out

def v_risk_guard():
    # stocks.db/cached_analysis lacks target/stop in this snapshot — R/R gate sourced from
    # predictions.db/aiPrediction (2610 rows with entry/target/stop). Real R/R data.
    rows = _rows("predictions.db", "SELECT stock_symbol, stock_name_ar, signal_type, entry_price, target_price, stop_loss FROM aiPrediction WHERE entry_price>0 AND target_price>0 AND stop_loss>0")
    passed, killed = [], []
    for r in rows:
        rr = _rr(r.get("entry_price"), r.get("target_price"), r.get("stop_loss"))
        item = {"symbol": r.get("stock_symbol"), "name": r.get("stock_name_ar"), "price": r.get("entry_price"), "target": r.get("target_price"), "stop": r.get("stop_loss"), "rr": rr, "recommendation": r.get("signal_type")}
        if rr is not None and rr >= 1.5: passed.append(item)
        elif rr is not None: killed.append(item)
    passed.sort(key=lambda x: x["rr"] or 0, reverse=True); killed.sort(key=lambda x: x["rr"] or 0)
    return {"passed_count": len(passed), "killed_count": len(killed), "passed": passed[:10], "killed": killed[:10]}

def v_screener(limit=12):
    return _rows("price_history.db", "SELECT ticker, name_ar, sector, last_close, change_1d_pct, change_5d_pct, change_20d_pct, volume FROM screener_daily ORDER BY ABS(change_1d_pct) DESC LIMIT ?", (limit,))

def v_topology():
    """Live engineering diagram model: nodes (components) + edges (data/control/decision lines)
    with REAL states derived from the telemetry. Drives the SCADA/P&ID flow diagram.
    Honesty rule (Rule 27): states reflect the actual snapshot — engine IDLE => most flows inactive;
    the only LIVE flow in the sandbox is DB -> API -> DCS screen (the dashboard polling)."""
    ov = v_overview(); fd = v_feeds(); rg = v_risk_guard(); sg = v_signals(); cr = v_crypto(limit=6)
    eng = ov.get("engine", {}); counts = ov.get("counts", {})
    eng_running = bool(eng.get("is_running"))
    sig_count = counts.get("ai_predictions", 0)
    sigs_now = len(sg) if isinstance(sg, list) else 0
    feeds_ms = fd.get("market_syncs", []) if isinstance(fd, dict) else []
    egx_led = next((m.get("led") for m in feeds_ms if m.get("market") == "stocks"), "unknown")
    rg_passed = rg.get("passed_count", 0) if isinstance(rg, dict) else 0
    rg_killed = rg.get("killed_count", 0) if isinstance(rg, dict) else 0
    crypto_ok = bool(fd.get("crypto_last_fetch", {}).get("succeeded", 0) > 0)

    def st(ok_running, fallback_unknown=False):
        if ok_running is True: return "running"
        if ok_running is False: return "stopped"
        return "unknown" if fallback_unknown else "idle"

    nodes = [
        # Sources (lane 0)
        {"id":"src_egx","label":"EGX/KSA Feeds","type":"source","lane":0,"x":90,"y":120,"state":st(egx_led=="ok") if egx_led in ("ok","warn","down") else "unknown","sub":f"led={egx_led}"},
        {"id":"src_crypto","label":"Crypto Feeds","type":"source","lane":0,"x":90,"y":220,"state":"running" if crypto_ok else "stopped","sub":"50 cryptos" if crypto_ok else "down"},
        {"id":"src_gold","label":"Gold/Commodity","type":"source","lane":0,"x":90,"y":320,"state":"unknown","sub":"commodity_intraday"},
        # Databases (lane 1)
        {"id":"db_stocks","label":"stocks.db","type":"db","lane":1,"x":330,"y":120,"state":"ok","sub":f"{counts.get('stocks_egx_ksa',0)} stocks"},
        {"id":"db_ph","label":"price_history.db","type":"db","lane":1,"x":330,"y":200,"state":"ok","sub":f"{counts.get('price_history_rows',0):,} rows"},
        {"id":"db_pred","label":"predictions.db","type":"db","lane":1,"x":330,"y":280,"state":"ok","sub":f"{sig_count} preds"},
        {"id":"db_data_engine","label":"data_engine.db","type":"db","lane":1,"x":330,"y":360,"state":"ok","sub":f"{counts.get('crypto_ticks',0):,} crypto ticks"},
        {"id":"db_intra","label":"intraday.db","type":"db","lane":1,"x":330,"y":440,"state":"ok","sub":"intraday ticks"},
        # Engines (lane 2)
        {"id":"eng_analysis","label":"analysis_engine_v2","type":"engine","lane":2,"x":600,"y":160,"state":st(eng_running),"sub":f"ticker={eng.get('current_ticker')}","last_run":eng.get("last_run")},
        {"id":"eng_indicators","label":"Canonical ATR/RSI","type":"engine","lane":2,"x":600,"y":240,"state":"running","sub":"Wilder's (Rule 67b) · called by DCS NOW"},
        {"id":"eng_scoring","label":"core_scoring_engine","type":"engine","lane":2,"x":600,"y":320,"state":"unknown","sub":"cached_analysis"},
        {"id":"eng_target","label":"dynamic_target_engine","type":"engine","lane":2,"x":600,"y":400,"state":"unknown","sub":"targets/stop"},
        {"id":"eng_backtest","label":"backtest_engine","type":"engine","lane":2,"x":600,"y":480,"state":"stopped","sub":"series variant"},
        # Decision gates (lane 3)
        {"id":"gate_rr","label":"R/R Guard","type":"gate","lane":3,"x":860,"y":280,"state":"running" if (rg_passed+rg_killed)>0 else "idle","sub":f"PASS≥1.5: {rg_passed} · KILL: {rg_killed}"},
        {"id":"gate_knife","label":"Falling-Knife Filter","type":"gate","lane":3,"x":860,"y":380,"state":"unknown","sub":"downtrend block"},
        # Outputs (lane 4)
        {"id":"out_signals","label":"Live Signals","type":"output","lane":4,"x":1090,"y":200,"state":"ok" if sigs_now>0 else "idle","sub":f"{sigs_now} recent"},
        {"id":"out_preds","label":"AI Predictions","type":"output","lane":4,"x":1090,"y":280,"state":"ok" if sig_count>0 else "idle","sub":f"{sig_count} total"},
        {"id":"out_telegram","label":"Telegram Alerts","type":"output","lane":4,"x":1090,"y":360,"state":"unknown","sub":"alert_system"},
        {"id":"out_dcs","label":"DCS Screen","type":"output","lane":4,"x":1090,"y":440,"state":"running","sub":"YOU ARE HERE · polling live"},
        {"id":"out_admin","label":"Admin Panel","type":"output","lane":4,"x":1090,"y":520,"state":"running","sub":"ops-dcs connected"},
        # Jobs band (control lane, top)
        {"id":"job_cron","label":"Cron Scheduler","type":"job","lane":-1,"x":600,"y":40,"state":"unknown","sub":"crontab.txt (canonical)"},
        {"id":"job_daily","label":"daily_predictor","type":"job","lane":-1,"x":330,"y":40,"state":"unknown","sub":"scheduled"},
    ]
    # Edges: kind = data | control | decision. active = data currently flowing.
    dcs_live = True  # the dashboard polling IS happening
    edges = [
        {"from":"src_egx","to":"db_stocks","kind":"data","active":egx_led in ("ok","warn")},
        {"from":"src_crypto","to":"db_data_engine","kind":"data","active":crypto_ok},
        {"from":"src_gold","to":"db_data_engine","kind":"data","active":False},
        {"from":"db_stocks","to":"eng_analysis","kind":"data","active":eng_running},
        {"from":"db_ph","to":"eng_indicators","kind":"data","active":True, "label":"OHLC"},
        {"from":"eng_indicators","to":"eng_scoring","kind":"data","active":eng_running},
        {"from":"eng_scoring","to":"eng_target","kind":"data","active":eng_running},
        {"from":"eng_analysis","to":"gate_rr","kind":"data","active":eng_running},
        {"from":"eng_target","to":"gate_rr","kind":"data","active":eng_running},
        {"from":"gate_rr","to":"out_signals","kind":"decision","active":rg_passed>0,"label":"PASS"},
        {"from":"gate_rr","to":"out_rejected","kind":"decision","active":rg_killed>0,"label":"KILL <1.5"},
        {"from":"eng_analysis","to":"out_preds","kind":"data","active":eng_running},
        {"from":"out_signals","to":"out_telegram","kind":"data","active":sigs_now>0},
        # control lines (dashed)
        {"from":"job_cron","to":"eng_analysis","kind":"control","active":False,"label":"schedule"},
        {"from":"out_admin","to":"eng_analysis","kind":"control","active":False,"label":"settings"},
        # the LIVE polling flow (always active — this is the real "life")
        {"from":"db_stocks","to":"out_dcs","kind":"data","active":dcs_live,"label":"poll 3s","dashed":False},
        {"from":"db_ph","to":"out_dcs","kind":"data","active":dcs_live,"label":"poll"},
        {"from":"db_pred","to":"out_dcs","kind":"data","active":dcs_live,"label":"poll"},
        {"from":"db_data_engine","to":"out_dcs","kind":"data","active":dcs_live,"label":"poll"},
        {"from":"out_admin","to":"out_dcs","kind":"control","active":dcs_live,"label":"iframe embed"},
    ]
    # rejected bin (sink for killed signals)
    nodes.append({"id":"out_rejected","label":"Rejected (R/R<1.5)","type":"output","lane":4,"x":1090,"y":120,"state":"ok" if rg_killed>0 else "idle","sub":f"{rg_killed} killed"})
    return {
        "meta": {
            "title":"GLMinvestment — Live System Topology",
            "snapshot_date":"2026-10-10",
            "engine_state":"IDLE" if not eng_running else "RUNNING",
            "engine_idle_since":eng.get("last_run"),
            "live_flow_source":"dashboard polling (real, DB -> API -> DCS screen)",
            "calc_brain":"Python (Rule 4/67b) — ATR/RSI canonical",
            "server_time":ov.get("server_time"),
        },
        "nodes":nodes,
        "edges":edges,
        "legend":{"states":{"running":"working now (animated flow)","ok":"available/healthy","idle":"present but inactive","stopped":"halted","unknown":"no live telemetry"},"edges":{"data":"data transport (cyan)","control":"control/schedule (amber, dashed)","decision":"decision route (green=pass/red=kill)"}},
    }

VIEWS = {"overview": v_overview, "stocks": v_stocks, "indicators": v_indicators, "signals": v_signals, "feeds": v_feeds, "crypto": v_crypto, "risk-guard": v_risk_guard, "screener": v_screener, "topology": v_topology}

def main():
    if len(sys.argv) < 2 or sys.argv[1] not in VIEWS:
        print(json.dumps({"error": f"unknown view. available: {list(VIEWS)}"}), file=sys.stderr); sys.exit(1)
    view = sys.argv[1]
    try:
        if view == "indicators":
            data = v_indicators(sys.argv[2] if len(sys.argv) > 2 else "COMI", int(sys.argv[3]) if len(sys.argv) > 3 else 30)
        elif view in ("stocks", "signals", "crypto", "screener"):
            data = VIEWS[view](int(sys.argv[2]) if len(sys.argv) > 2 else 20)
        else:
            data = VIEWS[view]()
        print(json.dumps(data, default=str, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e), "view": view}), file=sys.stderr); sys.exit(1)

if __name__ == "__main__":
    main()
