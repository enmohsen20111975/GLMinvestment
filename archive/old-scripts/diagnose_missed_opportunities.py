#!/usr/bin/env python3
"""
diagnose_missed_opportunities.py  (v2 — revised after data reality check)
=====================================================================
سكربت تشخيص الفرص الضائعة — المرحلة B من خطة المالك.

يقارن **ما اختاره النظام** (stored_analyses) بـ **ما ربّح فعلاً في السوق**
(Top-30 gainers)، منفصل Investor vs Gambler.

الواقع البياني (اكتُشف بعد أول تشغيل):
  1. stored_analyses.is_gambler_opportunity / is_investor_opportunity = 0 لكل الصفوف
     → P16 "Persona Divergence LIVE ✅" مش بيكتب الفlags فعلياً. ده finding حرج.
  2. price_history فيها gap 54 يوم (June 10 → Aug 3) → غير صالح للنافذة 25 يوم.
  3. stock_daily_prices هي المصدر الموثوق (June 25 → July 10، 957 ticker/day).
  4. persona_predictions table = 0 صفوف (فارغة تماماً).

استراتيجية السكربت (v2):
  - مصدر الأسعار: stock_daily_prices (primary) + price_history (fallback).
  - النافذة: auto-detect — من أول تاريخ متاح لآخر تاريخ متاح (بدل fixed 25 يوم).
  - فصل Persona: بما إن الفlags كلها 0، نستخدم proxy:
      * Gambler proxy = recommendation IN ('strong_buy','buy') AND volume_ratio >= 1.5
      * Investor proxy = recommendation IN ('buy','strong_buy') AND pe_ratio BETWEEN 5 AND 20 AND roe >= 10
    (نوثّق إن ده proxy مش الـ flags الحقيقية.)
  - يقرأ readonly — ما بتعملش أي تعديل على الإنتاج.

CLI:
  python3 vps-service/scripts/diagnose_missed_opportunities.py --market EGX
  python3 vps-service/scripts/diagnose_missed_opportunities.py --market EGX --json-only
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
VPS_ROOT = SCRIPT_DIR.parent
PROJECT_ROOT = VPS_ROOT.parent

PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
PRICE_HISTORY_DB = PROJECT_ROOT / "db" / "price_history.db"
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def log(msg: str):
    print(msg, flush=True)


def connect(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def parse_volume(v):
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().upper()
    mult = 1.0
    for suffix, m in [("K", 1e3), ("M", 1e6), ("B", 1e9)]:
        if s.endswith(suffix):
            mult = m
            s = s[:-1]
            break
    try:
        return float(s) * mult
    except Exception:
        return 0.0


# ──────────────────────────────────────────────────────────────────────────────
# 1) توصيات النظام اليوم
# ──────────────────────────────────────────────────────────────────────────────
def fetch_system_recommendations(market: str) -> dict:
    conn = connect(PREDICTIONS_DB)
    conn.row_factory = sqlite3.Row

    rows = conn.execute("""
        SELECT ticker, market, maestro_score, recommendation, confidence,
               entry_price, target_price, stop_loss, risk_reward,
               volume_ratio, pe_ratio, roe, change_1d, change_1m, volatility,
               fair_value_upside, liquidity_rating,
               is_gambler_opportunity, is_investor_opportunity,
               gambler_rank_score, investor_rank_score
        FROM stored_analyses
        WHERE market = ?
          AND updated_at >= date('now', 'start of day')
        ORDER BY ticker
    """, (market,)).fetchall()
    conn.close()

    all_rows = [dict(r) for r in rows]

    # التحقق من الـ flags الحقيقية
    real_gambler = [r for r in all_rows if r.get("is_gambler_opportunity") == 1]
    real_investor = [r for r in all_rows if r.get("is_investor_opportunity") == 1]
    flags_all_zero = (len(real_gambler) == 0 and len(real_investor) == 0)

    # Proxy فصل (بما إن الـ flags كلها 0)
    gambler_proxy = []
    investor_proxy = []
    for r in all_rows:
        rec = (r.get("recommendation") or "").lower()
        is_buy_like = rec in ("buy", "strong_buy", "accumulate")
        if not is_buy_like:
            continue
        # Gambler proxy: زخم + حجم
        vr = r.get("volume_ratio") or 0
        ch1d = r.get("change_1d") or 0
        if vr >= 1.5 or (ch1d and abs(ch1d) >= 2):
            gambler_proxy.append(r)
        # Investor proxy: أساسيات قوية
        pe = r.get("pe_ratio")
        roe = r.get("roe")
        if pe is not None and roe is not None and 5 <= pe <= 20 and roe >= 10:
            investor_proxy.append(r)

    all_buy = [r for r in all_rows if (r.get("recommendation") or "").lower() in ("buy", "strong_buy", "accumulate")]

    return {
        "all_analyses": all_rows,
        "gambler": gambler_proxy,
        "investor": investor_proxy,
        "all_buy": all_buy,
        "total_analyses": len(all_rows),
        "flags_all_zero": flags_all_zero,
        "real_gambler_count": len(real_gambler),
        "real_investor_count": len(real_investor),
        "persona_source": "proxy" if flags_all_zero else "flags",
    }


# ──────────────────────────────────────────────────────────────────────────────
# 2) أعلى 30 سهم ربحاً (auto-detect window)
# ──────────────────────────────────────────────────────────────────────────────
def fetch_top_gainers(market: str) -> tuple[list[dict], dict]:
    """
    مصدر مزدوج: stock_daily_prices (primary) + price_history (fallback).
    auto-detect: من أول تاريخ متاح لآخر تاريخ متاح.
    """
    # 1) stock_daily_prices — density + date range
    sconn = connect(STOCKS_DB)
    sconn.row_factory = sqlite3.Row
    sdp_dates = [r[0] for r in sconn.execute(
        "SELECT DISTINCT price_date FROM stock_daily_prices ORDER BY price_date"
    ).fetchall()]
    log(f"  stock_daily_prices: {len(sdp_dates)} distinct dates, range {sdp_dates[0] if sdp_dates else 'N/A'} → {sdp_dates[-1] if sdp_dates else 'N/A'}")

    # 2) price_history — density
    pconn = connect(PRICE_HISTORY_DB)
    pconn.row_factory = sqlite3.Row
    ph_dates = [r[0] for r in pconn.execute(
        "SELECT DISTINCT date FROM price_history ORDER BY date"
    ).fetchall()]
    log(f"  price_history: {len(ph_dates)} distinct dates, range {ph_dates[0] if ph_dates else 'N/A'} → {ph_dates[-1] if ph_dates else 'N/A'}")

    # فلتر السوق
    market_tickers = set()
    for r in sconn.execute("SELECT ticker FROM stocks WHERE market = ?", (market,)).fetchall():
        market_tickers.add(r["ticker"])

    # استخدم stock_daily_prices كمصدر أساسي (لو فيه بيانات كافية)
    if len(sdp_dates) >= 2:
        first_date = sdp_dates[0]
        last_date = sdp_dates[-1]
        log(f"  → using stock_daily_prices: window {first_date} → {last_date}")

        # لكل ticker: first close + last close + max high
        gainers = []
        for ticker in market_tickers:
            rows = sconn.execute("""
                SELECT price_date, close, high, volume
                FROM stock_daily_prices
                WHERE ticker = ? AND close IS NOT NULL AND close > 0
                ORDER BY price_date
            """, (ticker,)).fetchall()
            if len(rows) < 2:
                continue
            first_close = rows[0]["close"]
            last_close = rows[-1]["close"]
            max_high = max((r["high"] or r["close"]) for r in rows)
            avg_vol = sum(parse_volume(r["volume"]) for r in rows) / len(rows) if rows else 0

            ret = (last_close - first_close) / first_close * 100.0
            max_ret = (max_high - first_close) / first_close * 100.0

            gainers.append({
                "ticker": ticker,
                "first_date": rows[0]["price_date"],
                "last_date": rows[-1]["price_date"],
                "first_close": round(first_close, 4),
                "last_close": round(last_close, 4),
                "return_pct": round(ret, 2),
                "max_return_pct": round(max_ret, 2),
                "avg_volume": round(avg_vol, 0),
                "source": "stock_daily_prices",
            })
        sconn.close()
        pconn.close()

        # فلتر الأسهم الميتة
        gainers = [g for g in gainers if g["avg_volume"] >= 1000]
        gainers.sort(key=lambda x: x["return_pct"], reverse=True)

        window_info = {
            "source": "stock_daily_prices",
            "first_date": first_date,
            "last_date": last_date,
            "window_days": (datetime.strptime(last_date, "%Y-%m-%d") - datetime.strptime(first_date, "%Y-%m-%d")).days,
            "sdp_date_count": len(sdp_dates),
            "ph_date_count": len(ph_dates),
        }
        return gainers[:30], window_info

    # fallback لـ price_history لو stock_daily_prices فارغة
    log("  → stock_daily_prices empty, falling back to price_history")
    gainers = []
    for ticker in market_tickers:
        rows = pconn.execute("""
            SELECT date, close_price, high_price, volume
            FROM price_history
            WHERE ticker = ? AND close_price IS NOT NULL AND close_price > 0
            ORDER BY date
        """, (ticker,)).fetchall()
        if len(rows) < 2:
            continue
        first_close = rows[0]["close_price"]
        last_close = rows[-1]["close_price"]
        max_high = max((r["high_price"] or r["close_price"]) for r in rows)
        avg_vol = sum((r["volume"] or 0) for r in rows) / len(rows)

        ret = (last_close - first_close) / first_close * 100.0
        max_ret = (max_high - first_close) / first_close * 100.0

        gainers.append({
            "ticker": ticker,
            "first_date": rows[0]["date"],
            "last_date": rows[-1]["date"],
            "first_close": round(first_close, 4),
            "last_close": round(last_close, 4),
            "return_pct": round(ret, 2),
            "max_return_pct": round(max_ret, 2),
            "avg_volume": round(avg_vol, 0),
            "source": "price_history",
        })
    sconn.close()
    pconn.close()

    gainers = [g for g in gainers if g["avg_volume"] >= 1000]
    gainers.sort(key=lambda x: x["return_pct"], reverse=True)

    window_info = {
        "source": "price_history",
        "first_date": ph_dates[0] if ph_dates else None,
        "last_date": ph_dates[-1] if ph_dates else None,
        "window_days": None,
        "sdp_date_count": len(sdp_dates),
        "ph_date_count": len(ph_dates),
    }
    return gainers[:30], window_info


# ──────────────────────────────────────────────────────────────────────────────
# 3) المطابقة
# ──────────────────────────────────────────────────────────────────────────────
def cross_match(top_gainers, persona_recs, persona_name):
    rec_ticker_set = {r["ticker"] for r in persona_recs}

    hits = []
    misses = []
    for g in top_gainers:
        if g["ticker"] in rec_ticker_set:
            matching = [r for r in persona_recs if r["ticker"] == g["ticker"]]
            rec = matching[0].get("recommendation", "") if matching else ""
            hits.append({
                **g,
                "system_rec": rec,
                "maestro_score": matching[0].get("maestro_score") if matching else None,
            })
        else:
            misses.append({**g, "probable_reason": _guess_miss_reason(g)})

    return {
        "persona": persona_name,
        "hits": hits,
        "misses": misses,
        "coverage_pct": round(len(hits) / len(top_gainers) * 100, 1) if top_gainers else 0.0,
    }


def _guess_miss_reason(g):
    ret = g.get("return_pct", 0)
    max_ret = g.get("max_return_pct") or ret
    vol = g.get("avg_volume", 0)

    if vol < 5000:
        return "سيولة ضعيفة (متوسط حجم < 5K) — مستثنى محتمل من universe التداول"
    if ret > 30 or (max_ret and max_ret > 40):
        return "دخول متأخر — السهم طار قبل ما النظام يلتقطه"
    if ret > 15:
        return "زخم قوي بدون التقاط — threshold الفلتر عالي أو السهم خارج universe"
    return "غير واضح — يحتاج فحص يدوي"


# ──────────────────────────────────────────────────────────────────────────────
# 4) التوصيات الضعيفة
# ──────────────────────────────────────────────────────────────────────────────
def find_weak_picks(all_buy_recs, top_gainers, window_info):
    """BUY لكن العائد الفعلي ≤ 0 أو ضعيف مقابل الهدف."""
    return_lookup = {g["ticker"]: g for g in top_gainers}
    source = window_info.get("source")
    db_path = STOCKS_DB if source == "stock_daily_prices" else PRICE_HISTORY_DB
    date_col = "price_date" if source == "stock_daily_prices" else "date"
    close_col = "close" if source == "stock_daily_prices" else "close_price"
    table = "stock_daily_prices" if source == "stock_daily_prices" else "price_history"

    conn = connect(db_path)
    conn.row_factory = sqlite3.Row

    weak = []
    for r in all_buy_recs:
        ticker = r["ticker"]
        if ticker in return_lookup:
            g = return_lookup[ticker]
            ret = g["return_pct"]
        else:
            row = conn.execute(f"""
                SELECT MIN({date_col}) AS fd, MAX({date_col}) AS ld
                FROM {table} WHERE ticker = ? AND {close_col} IS NOT NULL AND {close_col} > 0
            """, (ticker,)).fetchone()
            if not row or not row["fd"] or not row["ld"]:
                weak.append({**r, "actual_return_pct": None, "weak_reason": "لا توجد بيانات سعر كافية"})
                continue
            fc = conn.execute(f"SELECT {close_col} AS c FROM {table} WHERE ticker=? AND {date_col}=? ORDER BY {date_col} ASC LIMIT 1", (ticker, row["fd"])).fetchone()
            lc = conn.execute(f"SELECT {close_col} AS c FROM {table} WHERE ticker=? AND {date_col}=? ORDER BY {date_col} DESC LIMIT 1", (ticker, row["ld"])).fetchone()
            if not fc or not lc or not fc["c"] or fc["c"] <= 0:
                weak.append({**r, "actual_return_pct": None, "weak_reason": "أسعار غير صالحة"})
                continue
            ret = round((lc["c"] - fc["c"]) / fc["c"] * 100, 2)

        target = r.get("target_price") or 0
        entry = r.get("entry_price") or 0
        expected_ret = ((target - entry) / entry * 100) if (entry and target and entry > 0) else 0

        if ret is None:
            continue
        if ret <= 0:
            reason = f"عائد فعلي سلبي/صفر ({ret}%) رغم توصية BUY — زخم معاكس أو سهم راكد"
        elif expected_ret > 0 and ret < expected_ret / 3:
            reason = f"عائد ضعيف ({ret}%) مقابل هدف متوقع {expected_ret:.1f}% — دخول متأخر"
        else:
            continue

        weak.append({
            "ticker": ticker,
            "recommendation": r.get("recommendation"),
            "maestro_score": r.get("maestro_score"),
            "entry_price": r.get("entry_price"),
            "target_price": r.get("target_price"),
            "actual_return_pct": ret,
            "expected_return_pct": round(expected_ret, 2),
            "weak_reason": reason,
        })
    conn.close()
    return weak


# ──────────────────────────────────────────────────────────────────────────────
# 5) تداخل القوائم + توزيع الإشارات
# ──────────────────────────────────────────────────────────────────────────────
def compute_overlap(gambler_recs, investor_recs):
    g_set = {r["ticker"] for r in gambler_recs}
    i_set = {r["ticker"] for r in investor_recs}
    overlap = g_set & i_set
    union = g_set | i_set
    overlap_pct = round(len(overlap) / len(union) * 100, 1) if union else 0.0
    return {
        "gambler_count": len(g_set),
        "investor_count": len(i_set),
        "overlap_count": len(overlap),
        "overlap_pct": overlap_pct,
        "verdict": "فصل قوي" if overlap_pct < 40 else ("فصل متوسط" if overlap_pct < 60 else "فصل ضعيف — قوائم متداخلة"),
    }


def signal_distribution(all_analyses):
    dist = {}
    for r in all_analyses:
        rec = (r.get("recommendation") or "unknown").lower()
        dist[rec] = dist.get(rec, 0) + 1
    return dist


# ──────────────────────────────────────────────────────────────────────────────
# تقرير عربي
# ──────────────────────────────────────────────────────────────────────────────
def build_arabic_report(data, market):
    today = datetime.now().strftime("%Y-%m-%d")
    w = data["window_info"]
    sys_d = data["system"]
    lines = []
    lines.append(f"# تقرير تشخيص الفرص الضائعة — {today}")
    lines.append(f"**السوق:** {market} | **مصدر الأسعار:** {w['source']} | **النافذة:** {w['first_date']} → {w['last_date']}")
    lines.append("")
    lines.append("## ملخص تنفيذي")
    lines.append(f"- إجمالي تحليلات النظام اليوم: **{sys_d['total_analyses']}** سهم")
    lines.append(f"- توصيات BUY/STRONG_BUY: **{len(sys_d['all_buy'])}** سهم")
    lines.append(f"- أعلى 30 سهم ربحاً: تم حسابها من {w['source']}")
    lines.append("")

    # تنبيه حرج عن الـ flags
    if sys_d["flags_all_zero"]:
        lines.append("## ⚠️ تنبيه حرج: Persona Flags كلها صفر")
        lines.append(f"- `is_gambler_opportunity` = 0 لكل {sys_d['total_analyses']} تحليل")
        lines.append(f"- `is_investor_opportunity` = 0 لكل {sys_d['total_analyses']} تحليل")
        lines.append(f"- `persona_predictions` table = 0 صفوف")
        lines.append("- **P16 \"Persona Divergence LIVE ✅\" المشروح في التوثيق مش بيكتب الفlags فعلياً.**")
        lines.append("- السكربت استخدم **proxy** بدل الفlags:")
        lines.append("  - Gambler proxy = BUY/STRONG_BUY + (volume_ratio ≥ 1.5 OR |change_1d| ≥ 2%)")
        lines.append("  - Investor proxy = BUY/STRONG_BUY + (pe_ratio BETWEEN 5 AND 20 AND roe ≥ 10)")
        lines.append(f"- **النتيجة:** Gambler proxy = {sys_d['gambler_count']} سهم | Investor proxy = {sys_d['investor_count']} سهم")
        lines.append("")

    lines.append("## قيود البيانات")
    lines.append(f"- `stored_analyses`: كلها من اليوم (مفيش تاريخ تحليلات سابق).")
    lines.append(f"- `price_history`: {w['ph_date_count']} تاريخ متاح، فيها gap كبير (June → Aug).")
    lines.append(f"- `stock_daily_prices`: {w['sdp_date_count']} تاريخ متاح (June 25 → July 10).")
    lines.append(f"- التشخيص بيقارن توصيات اليوم بالعائد الفعلي من {w['first_date']} → {w['last_date']}.")
    lines.append("")

    lines.append("## تغطية كل Persona (Coverage)")
    for p in ["gambler", "investor"]:
        cm = data["cross_match"][p]
        lines.append(f"- **{p}**: Coverage = **{cm['coverage_pct']}%** ({len(cm['hits'])} hit / {len(cm['misses'])} miss من Top-30)")
    lines.append("")

    lines.append("## تداخل قائمتي Investor / Gambler")
    ov = data["overlap"]
    lines.append(f"- Gambler proxy: {ov['gambler_count']} سهم | Investor proxy: {ov['investor_count']} سهم")
    lines.append(f"- التداخل: **{ov['overlap_count']}** سهم ({ov['overlap_pct']}%) — **{ov['verdict']}**")
    lines.append("")

    lines.append("## توزيع الإشارات (كل تحليلات اليوم)")
    dist = data["signal_distribution"]
    dist_str = " | ".join(f"{k}: {v}" for k, v in sorted(dist.items(), key=lambda x: -x[1]))
    lines.append(f"- {dist_str}")
    lines.append("")

    lines.append("## Top-10 أسهم رابحة في النافذة")
    lines.append("")
    lines.append("| # | السهم | العائد % | max % | متوسط الحجم |")
    lines.append("|---|------|---------|-------|------------|")
    for i, g in enumerate(data["top_gainers"][:10], 1):
        lines.append(f"| {i} | {g['ticker']} | +{g['return_pct']}% | +{g['max_return_pct']}% | {g['avg_volume']:.0f} |")
    lines.append("")

    lines.append("## أهم 5 أسهم ضائعة (Misses) — Gambler proxy")
    cm_g = data["cross_match"]["gambler"]
    top_misses = sorted(cm_g["misses"], key=lambda x: x["return_pct"], reverse=True)[:5]
    if top_misses:
        lines.append("")
        lines.append("| السهم | العائد % | السبب المحتمل |")
        lines.append("|------|---------|--------------|")
        for m in top_misses:
            lines.append(f"| {m['ticker']} | +{m['return_pct']}% | {m['probable_reason']} |")
    else:
        lines.append("- لا توجد misses (Coverage = 100%)")
    lines.append("")

    lines.append("## أهم 5 توصيات ضعيفة (BUY لكن العائد فعلي ≤ 0 أو ضعيف)")
    weak = data["weak_picks"][:5]
    if weak:
        lines.append("")
        lines.append("| السهم | توصية | Score | عائد فعلي % | عائد متوقع % | السبب |")
        lines.append("|------|------|-------|------------|-------------|------|")
        for w_ in weak:
            ret = w_.get("actual_return_pct")
            ret_s = f"{ret}%" if ret is not None else "N/A"
            lines.append(f"| {w_['ticker']} | {w_.get('recommendation','')} | {w_.get('maestro_score','')} | {ret_s} | {w_.get('expected_return_pct','')} | {w_['weak_reason']} |")
    else:
        lines.append("- لا توجد توصيات ضعيفة")
    lines.append("")

    lines.append("## توصية عملية للجولة القادمة (C1/C2)")
    g_cov = data["cross_match"]["gambler"]["coverage_pct"]
    i_cov = data["cross_match"]["investor"]["coverage_pct"]
    ov_pct = data["overlap"]["overlap_pct"]
    weak_count = len(data["weak_picks"])
    buy_count = len(sys_d["all_buy"])

    recs = []
    if sys_d["flags_all_zero"]:
        recs.append("🔴 **إصلاح P16 Persona Divergence** — الفlags مش بتتكتب فعلياً. ده prerequisite لـ C2.")
    if g_cov < 40:
        recs.append(f"تخفيف threshold فلتر الزخم للمضارب (Coverage {g_cov}% < 40%)")
    if i_cov < 40:
        recs.append(f"توسيع universe الأساسيات للمستثمر (Coverage {i_cov}% < 40%)")
    if ov_pct > 60:
        recs.append(f"تقوية فصل الشخصيات (التداخل {ov_pct}% > 60%)")
    if weak_count > 5:
        recs.append(f"تشديد فلتر الأسهم الميتة ({weak_count} توصية ضعيفة من {buy_count} BUY)")
    if buy_count > 100:
        recs.append(f"تقليل عدد توصيات BUY ({buy_count} توصية = تشوّش على المستخدم)")
    if not recs:
        recs.append("النظام في وضع جيد — راجع التفاصيل يدوياً")

    for i, r in enumerate(recs, 1):
        lines.append(f"{i}. {r}")
    lines.append("")
    lines.append("---")
    lines.append(f"*تم التوليد بواسطة `diagnose_missed_opportunities.py` v2 — {datetime.now().isoformat()}*")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="تشخيص الفرص الضائعة — المرحلة B (v2)")
    parser.add_argument("--market", type=str, default="EGX", help="EGX/TADAWUL/KSE/QSE")
    parser.add_argument("--json-only", action="store_true", help="JSON فقط بدون تقرير عربي")
    args = parser.parse_args()

    log("═══ تشخيص الفرص الضائعة (v2) ═══")
    log(f"السوق: {args.market}")
    log("")

    log("[1/5] قراءة توصيات النظام من stored_analyses...")
    sys_recs = fetch_system_recommendations(args.market)
    log(f"  إجمالي تحليلات اليوم: {sys_recs['total_analyses']}")
    log(f"  BUY/STRONG_BUY: {len(sys_recs['all_buy'])}")
    log(f"  real gambler flags: {sys_recs['real_gambler_count']} | real investor flags: {sys_recs['real_investor_count']}")
    if sys_recs["flags_all_zero"]:
        log(f"  ⚠️ FLAGS ALL ZERO — using proxy (gambler={len(sys_recs['gambler'])}, investor={len(sys_recs['investor'])})")
    else:
        log(f"  flags valid (gambler={len(sys_recs['gambler'])}, investor={len(sys_recs['investor'])})")

    log("")
    log("[2/5] حساب أعلى 30 سهم ربحاً (auto-detect window)...")
    top_gainers, window_info = fetch_top_gainers(args.market)
    log(f"  window: {window_info['first_date']} → {window_info['last_date']} ({window_info.get('window_days','?')} days)")
    log(f"  تم حساب {len(top_gainers)} سهم")
    if top_gainers:
        log(f"  Top-3: {[(g['ticker'], g['return_pct']) for g in top_gainers[:3]]}")

    log("")
    log("[3/5] مطابقة Top-30 مع توصيات كل persona...")
    cm_g = cross_match(top_gainers, sys_recs["gambler"], "gambler")
    cm_i = cross_match(top_gainers, sys_recs["investor"], "investor")
    log(f"  Gambler proxy Coverage: {cm_g['coverage_pct']}% ({len(cm_g['hits'])} hit / {len(cm_g['misses'])} miss)")
    log(f"  Investor proxy Coverage: {cm_i['coverage_pct']}% ({len(cm_i['hits'])} hit / {len(cm_i['misses'])} miss)")

    log("")
    log("[4/5] اكتشاف التوصيات الضعيفة...")
    weak = find_weak_picks(sys_recs["all_buy"], top_gainers, window_info)
    log(f"  {len(weak)} توصية ضعيفة")

    log("")
    log("[5/5] حساب تداخل القوائم + توزيع الإشارات...")
    overlap = compute_overlap(sys_recs["gambler"], sys_recs["investor"])
    log(f"  تداخل: {overlap['overlap_count']} ({overlap['overlap_pct']}%) — {overlap['verdict']}")
    sig_dist = signal_distribution(sys_recs["all_analyses"])

    data = {
        "generated_at": datetime.now().isoformat(),
        "market": args.market,
        "window_info": window_info,
        "system": {
            "total_analyses": sys_recs["total_analyses"],
            "all_buy": sys_recs["all_buy"],
            "all_buy_count": len(sys_recs["all_buy"]),
            "gambler_count": len(sys_recs["gambler"]),
            "investor_count": len(sys_recs["investor"]),
            "flags_all_zero": sys_recs["flags_all_zero"],
            "real_gambler_count": sys_recs["real_gambler_count"],
            "real_investor_count": sys_recs["real_investor_count"],
            "persona_source": sys_recs["persona_source"],
        },
        "top_gainers": top_gainers,
        "cross_match": {"gambler": cm_g, "investor": cm_i},
        "weak_picks": weak,
        "overlap": overlap,
        "signal_distribution": sig_dist,
    }

    today_str = datetime.now().strftime("%Y%m%d")
    json_path = OUTPUT_DIR / f"missed_opportunities_{today_str}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)
    log("")
    log(f"✅ JSON saved: {json_path}")

    report = build_arabic_report(data, args.market)
    md_path = OUTPUT_DIR / f"missed_opportunities_{today_str}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(report)
    log(f"✅ Report saved: {md_path}")
    log("")
    log("═══ التقرير العربي ═══")
    log("")
    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
