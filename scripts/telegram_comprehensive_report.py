#!/usr/bin/env python3
"""
telegram_comprehensive_report.py — تقرير تليجرام شامل ومحترم
================================================================
يبعت تقرير كامل للقناة فيه:
  1. ملخص السوق (صاعد/هابط/محايد + نسبة)
  2. حالة السوق (DEFENSIVE/NORMAL/AGGRESSIVE + الأسباب)
  3. أعلى 5 صاعدات + أعلى 5 هابطات
  4. رادار السيولة (عدد الأسهم تحت الميكروسكوب + أفضل 5 فرص)
  5. التوقعات النشطة (entry/target/stop/RR)
  6. إحصائيات الأداء (win rate + profit factor)
  7. بيانات أساسية لأهم سهم (P/E, ROE, إلخ)
  8. ملخص السيولة بالقطاعات (LIQUIDITY-ALERTS-IMPL — 2026-10-07)
     أعلى 3 قطاعات سيولة داخلة / خارجة + أعلى 3 أسهم بتجمع / بتوزع سيولة

Usage:
  python3 scripts/telegram_comprehensive_report.py
  python3 scripts/telegram_comprehensive_report.py --dry-run  # print only
  python3 scripts/telegram_comprehensive_report.py --send     # send to Telegram
"""
import os
import sys
import json
import sqlite3
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / 'db'

def load_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return None

def fmt_money(n):
    if n is None: return '—'
    if abs(n) >= 1e9: return f"{n/1e9:.1f}B"
    if abs(n) >= 1e6: return f"{n/1e6:.1f}M"
    if abs(n) >= 1e3: return f"{n/1e3:.0f}K"
    return f"{n:.0f}"

def fmt_pct(n):
    if n is None: return '—'
    sign = '+' if n > 0 else ''
    return f"{sign}{n:.1f}%"

def build_report():
    lines = []
    now = datetime.now()
    date_str = now.strftime('%Y-%m-%d %H:%M')

    # Pre-initialise so later sections don't UnboundLocalError when radar
    # JSON / fundamentals data is missing (safe-by-design — section 7 + 8
    # reference all_picks).
    all_picks = []

    # ═══════════════════════════════════════════════════════════════════
    # HEADER
    # ═══════════════════════════════════════════════════════════════════
    lines.append("📊 <b>التقرير الشامل — دليل الاستثمار</b>")
    lines.append(f"📅 {date_str} — بورصة مصر EGX")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━")
    lines.append("")

    # ═══════════════════════════════════════════════════════════════════
    # 1. MARKET REGIME
    # ═══════════════════════════════════════════════════════════════════
    regime_emoji = '⚖️'
    regime_label = 'عادي'
    regime_reasons = []
    try:
        pred_db = sqlite3.connect(str(DB_DIR / 'predictions.db'))
        row = pred_db.execute("SELECT value FROM engine_settings WHERE key = 'current_regime'").fetchone()
        if row:
            data = json.loads(row[0])
            r = data.get('regime', 'NORMAL')
            regime_emoji = {'DEFENSIVE': '🛡️', 'NORMAL': '⚖️', 'AGGRESSIVE': '🚀'}.get(r, '⚖️')
            regime_label = {'DEFENSIVE': 'دفاعي', 'NORMAL': 'عادي', 'AGGRESSIVE': 'هجومي'}.get(r, 'عادي')
            regime_reasons = data.get('reasons', [])[:2]
            confidence = data.get('confidence', 0.5)
        pred_db.close()
    except:
        pass

    lines.append(f"{regime_emoji} <b>حالة السوق: {regime_label}</b>")
    if regime_reasons:
        for reason in regime_reasons:
            if reason.strip():
                lines.append(f"   • {reason.strip()}")
    lines.append("")

    # ═══════════════════════════════════════════════════════════════════
    # 2. MARKET SUMMARY
    # ═══════════════════════════════════════════════════════════════════
    try:
        stocks_db = sqlite3.connect(str(DB_DIR / 'stocks.db'))
        stocks_db.row_factory = sqlite3.Row
        total = stocks_db.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
        advancers = stocks_db.execute("SELECT COUNT(*) FROM stocks WHERE change_percent > 0").fetchone()[0]
        decliners = stocks_db.execute("SELECT COUNT(*) FROM stocks WHERE change_percent < 0").fetchone()[0]
        unchanged = total - advancers - decliners
        breadth_pct = (advancers / total * 100) if total > 0 else 0

        lines.append(f"📈 <b>ملخص السوق</b>")
        lines.append(f"   📊 إجمالي الأسهم: {total}")
        lines.append(f"   🟢 صاعد: {advancers} ({breadth_pct:.0f}%)")
        lines.append(f"   🔴 هابط: {decliners} ({100-breadth_pct:.0f}%)" if total > 0 else f"   🔴 هابط: {decliners}")
        lines.append(f"   ⚪ ثابت: {unchanged}")
        lines.append("")

        # ═══════════════════════════════════════════════════════════════
        # 3. TOP GAINERS / LOSERS
        # ═══════════════════════════════════════════════════════════════
        gainers = stocks_db.execute(
            "SELECT ticker, name_ar, close, change_percent FROM stocks WHERE change_percent IS NOT NULL ORDER BY change_percent DESC LIMIT 5"
        ).fetchall()
        losers = stocks_db.execute(
            "SELECT ticker, name_ar, close, change_percent FROM stocks WHERE change_percent IS NOT NULL ORDER BY change_percent ASC LIMIT 5"
        ).fetchall()

        if gainers:
            lines.append("🟢 <b>أعلى الصاعدات</b>")
            for g in gainers:
                name = (g['name_ar'] or g['ticker'] or '')[:25]
                lines.append(f"   {g['ticker']} — {fmt_pct(g['change_percent'])} | {name}")
            lines.append("")

        if losers:
            lines.append("🔴 <b>أعلى الهابطات</b>")
            for l in losers:
                name = (l['name_ar'] or l['ticker'] or '')[:25]
                lines.append(f"   {l['ticker']} — {fmt_pct(l['change_percent'])} | {name}")
            lines.append("")

        stocks_db.close()
    except Exception as e:
        lines.append(f"⚠️ خطأ في قراءة بيانات السوق: {e}")
        lines.append("")

    # ═══════════════════════════════════════════════════════════════════
    # 4. RADAR SUMMARY
    # ═══════════════════════════════════════════════════════════════════
    radar_path = PROJECT_ROOT / 'scripts' / 'output'
    radar_files = sorted([f for f in os.listdir(radar_path) if f.startswith('maker_radar_') and f.endswith('.json')], reverse=True) if os.path.exists(radar_path) else []

    if radar_files:
        radar = load_json(radar_path / radar_files[0])
        if radar:
            microscope = radar.get('under_microscope_count', 0)
            quiet = radar.get('quiet_count', 0)
            pre_surge = radar.get('pre_surge_count', 0)
            explosive = radar.get('explosive_count', 0)
            early_break = radar.get('early_break_count', 0)

            lines.append("📡 <b>رادار السيولة</b>")
            lines.append(f"   🔬 تحت الميكروسكوب: {microscope} سهم")
            lines.append(f"   🎯 تجميع قوي: {quiet} | 🚀 Pre-Surge: {pre_surge}")
            lines.append(f"   💥 انفجار: {explosive} | ⚡ اختراق: {early_break}")
            lines.append("")

            # Top 5 radar picks
            all_picks = []
            for stock in (radar.get('pre_surge_list') or [])[:3]:
                all_picks.append(stock)
            for stock in (radar.get('quiet_list') or [])[:2]:
                all_picks.append(stock)

            if all_picks:
                lines.append("   <b>أفضل 5 فرص من الرادار:</b>")
                for i, s in enumerate(all_picks[:5], 1):
                    ticker = s.get('ticker', '???')
                    price = s.get('current_price', 0)
                    path = s.get('path', '')
                    path_ar = {'A_pre_surge': 'Pre-Surge 🚀', 'B_quiet_accumulation_strong': 'تجميع قوي 🎯',
                               'C_quiet_accumulation_weak': 'تجميع ضعيف', 'D_explosive_surge': 'انفجار 🔥',
                               'E_early_break': 'اختراق ⚡'}.get(path, path)
                    acc = s.get('accumulation', '')
                    vol_ratio = s.get('volume_ratio_10d_vs_20d', 0)
                    turnover = s.get('avg_turnover_20d', 0)
                    roc = s.get('roc_10d', None)

                    lines.append(f"   {i}. <b>{ticker}</b> — {path_ar}")
                    lines.append(f"      💰 السعر: {price:.2f} EGP")
                    if roc is not None:
                        lines.append(f"      📈 ROC 10d: {fmt_pct(roc)}")
                    if vol_ratio:
                        lines.append(f"      📊 حجم نسبي: {vol_ratio:.2f}×")
                    if turnover:
                        lines.append(f"      💧 سيولة: {fmt_money(turnover)} EGP")
                    if acc:
                        lines.append(f"      🎯 {acc}")
                lines.append("")

    # ═══════════════════════════════════════════════════════════════════
    # 5. ACTIVE PREDICTIONS
    # ═══════════════════════════════════════════════════════════════════
    try:
        pred_db = sqlite3.connect(str(DB_DIR / 'predictions.db'))
        pred_db.row_factory = sqlite3.Row
        active = pred_db.execute(
            "SELECT ticker, prediction_date, entry_price, target_price, target_price_2, stop_loss, "
            "signal, confidence, risk_reward FROM predictions "
            "WHERE status IN ('active','ACTIVE') ORDER BY id DESC LIMIT 5"
        ).fetchall()

        if active:
            lines.append("🎯 <b>التوقعات النشطة</b>")
            for p in active:
                ticker = p['ticker']
                entry = p['entry_price']
                target = p['target_price']
                target2 = p['target_price_2']
                stop = p['stop_loss']
                rr = p['risk_reward']
                signal = p['signal']
                conf = p['confidence']

                # Calculate percentages
                t1_pct = ((target - entry) / entry * 100) if entry > 0 else 0
                s_pct = ((stop - entry) / entry * 100) if entry > 0 else 0

                signal_emoji = {'STRONG_BUY': '🚀', 'BUY': '✅', 'INSTITUTIONAL_BUY': '🏛️',
                                'HOLD': '⏸️', 'SELL': '🔻'}.get(signal, '📊')

                lines.append(f"   {signal_emoji} <b>{ticker}</b> — {signal}")
                lines.append(f"      💰 الدخول: {entry:.2f} EGP")
                lines.append(f"      🎯 الهدف 1: {target:.2f} ({fmt_pct(t1_pct)})")
                if target2:
                    t2_pct = ((target2 - entry) / entry * 100) if entry > 0 else 0
                    lines.append(f"      🎯 الهدف 2: {target2:.2f} ({fmt_pct(t2_pct)})")
                lines.append(f"      🛑 وقف الخسارة: {stop:.2f} ({fmt_pct(s_pct)})")
                if rr:
                    lines.append(f"      ⚖️ R:R = 1:{rr:.1f}")
                if conf:
                    lines.append(f"      🎯 الثقة: {conf}%")
            lines.append("")

        # ═══════════════════════════════════════════════════════════════
        # 6. PERFORMANCE STATS
        # ═══════════════════════════════════════════════════════════════
        total_preds = pred_db.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
        closed = pred_db.execute("SELECT COUNT(*) FROM predictions WHERE status NOT IN ('active','ACTIVE')").fetchone()[0]
        wins = pred_db.execute("SELECT COUNT(*) FROM predictions WHERE status IN ('TARGET_HIT','closed_win')").fetchone()[0]
        losses = pred_db.execute("SELECT COUNT(*) FROM predictions WHERE status IN ('STOPPED','closed_stop')").fetchone()[0]
        wr = (wins / closed * 100) if closed > 0 else 0

        lines.append("📊 <b>إحصائيات الأداء</b>")
        lines.append(f"   📋 إجمالي التوقعات: {total_preds}")
        lines.append(f"   ✅ مغلق: {closed} | ⏳ نشط: {total_preds - closed}")
        lines.append(f"   🏆 رابح: {wins} | ❌ خاسر: {losses}")
        lines.append(f"   📈 نسبة النجاح: {wr:.1f}%")
        lines.append("")

        pred_db.close()
    except Exception as e:
        lines.append(f"⚠️ خطأ في قراءة التوقعات: {e}")
        lines.append("")

    # ═══════════════════════════════════════════════════════════════════
    # 7. FUNDAMENTALS HIGHLIGHT (top radar pick)
    # ═══════════════════════════════════════════════════════════════════
    if all_picks and len(all_picks) > 0:
        top_ticker = all_picks[0].get('ticker', '')
        if top_ticker:
            try:
                de_db = sqlite3.connect(str(DB_DIR / 'data_engine.db'))
                de_db.row_factory = sqlite3.Row

                # Valuation
                val = de_db.execute("SELECT * FROM tab_valuation WHERE symbol LIKE ? LIMIT 1", (top_ticker + '%',)).fetchone()
                prof = de_db.execute("SELECT * FROM tab_profitability WHERE symbol LIKE ? LIMIT 1", (top_ticker + '%',)).fetchone()
                tech = de_db.execute("SELECT * FROM tab_technical_analysis WHERE symbol LIKE ? LIMIT 1", (top_ticker + '%',)).fetchone()

                if val or prof:
                    lines.append(f"📋 <b>بيانات {top_ticker} المالية</b>")
                    if val:
                        pe = val['pe_ratio']
                        mc = val['market_cap']
                        pb = val['pb_ratio']
                        if pe: lines.append(f"   📊 P/E: {pe}")
                        if mc: lines.append(f"   💰 القيمة السوقية: {mc}")
                        if pb: lines.append(f"   📊 P/B: {pb}")
                    if prof:
                        roe = prof['roe']
                        roa = prof['roa']
                        margin = prof['net_margin']
                        if roe: lines.append(f"   📈 ROE: {roe}")
                        if roa: lines.append(f"   📈 ROA: {roa}")
                        if margin: lines.append(f"   💵 هامش الربح: {margin}")
                    if tech:
                        rsi = tech['rsi']
                        rating = tech['technical_rating']
                        if rsi: lines.append(f"   📉 RSI: {rsi}")
                        if rating: lines.append(f"   📊 التقييم الفني: {rating}")
                    lines.append("")

                de_db.close()
            except:
                pass

    # ═══════════════════════════════════════════════════════════════════
    # 8. LIQUIDITY FLOW DIGEST (2026-10-07 — owner directive)
    # ═══════════════════════════════════════════════════════════════════
    # ملخص السيولة بالقطاعات — top sectors IN/OUT + top stocks accumulating/distributing.
    # Uses vps-service/telegram/liquidity_alerts.py (same module the intraday
    # scanner hooks into). Returns empty list when no data — section is skipped.
    try:
        sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
        from telegram.liquidity_alerts import build_liquidity_digest
        digest_lines = build_liquidity_digest(top_n=3)
        if digest_lines:
            lines.extend(digest_lines)
    except Exception as _liq_err:
        # Safe-by-design: digest is best-effort, never breaks the report.
        lines.append(f"⚠️ تعذّر بناء ملخص السيولة: {_liq_err}")
        lines.append("")

    # ═══════════════════════════════════════════════════════════════════
    # 9. AI ANALYSIS REASON (Task IMPROVEMENT-07-2026-10-06 — Rule 71)
    # عرض analysis_reason لأحدث التوقعات في predictions.db
    # النص بيشمل: WHO IS BUYING + Money Flow + Radar Path + Targets + R:R
    # ═══════════════════════════════════════════════════════════════════
    try:
        pred_db = sqlite3.connect(str(DB_DIR / 'predictions.db'))
        pred_db.row_factory = sqlite3.Row
        # آخر 3 توقعات فيها analysis_reason (في notes column أو analysis_json)
        recent = pred_db.execute('''
            SELECT ticker, signal, master_score, entry_price, target_price, stop_loss,
                   prediction_date, notes, analysis_json
            FROM predictions
            WHERE signal IN ('STRONG_BUY', 'INSTITUTIONAL_BUY', 'BUY')
            ORDER BY id DESC LIMIT 3
        ''').fetchall()
        pred_db.close()

        if recent:
            lines.append("📝 <b>تحليل أحدث التوقعات</b>")
            for r in recent:
                ticker = r['ticker']
                signal = r['signal']
                score = r['master_score'] or 0
                entry = r['entry_price'] or 0
                target = r['target_price'] or 0
                stop = r['stop_loss'] or 0
                date = (r['prediction_date'] or '')[:10]

                # محاولة قراءة analysis_reason من notes أو analysis_json
                reason = ''
                if r['notes']:
                    reason = r['notes'][:300]
                elif r['analysis_json']:
                    try:
                        aj = json.loads(r['analysis_json'])
                        reason = aj.get('analysis_reason', '')[:300]
                    except:
                        pass

                # بناء سطر مختصر
                rr = ''
                if entry and stop and target and (entry - stop) > 0:
                    rr = f" R:R={(target-entry)/(entry-stop):.1f}"

                lines.append(f"   🎯 <b>{ticker}</b> — {signal} (score={score:.0f}){rr}")
                lines.append(f"      📅 {date} | دخول: {entry:.2f} | هدف: {target:.2f} | وقف: {stop:.2f}")

                # عرض أول سطرين من analysis_reason لو موجود
                if reason:
                    reason_lines = reason.split('\n')[:3]
                    for rl in reason_lines:
                        if rl.strip():
                            lines.append(f"      {rl.strip()[:80]}")
            lines.append("")
    except Exception as _reason_err:
        # Safe-by-design
        pass

    # ═══════════════════════════════════════════════════════════════════
    # FOOTER
    # ═══════════════════════════════════════════════════════════════════
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━")
    lines.append("📍 <b>منصة دليل الاستثمار</b>")
    lines.append("🌐 invist.m2y.net")
    lines.append("📱 Android | 📱 Telegram")
    lines.append("⚠️ تحليل وليس نصيحة مالية")

    return "\n".join(lines)


def send_to_telegram(text):
    """Send the report to Telegram channel."""
    import asyncio
    try:
        sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
        from telegram.auto_poster import TelegramAutoPoster
        poster = TelegramAutoPoster()
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        connect = loop.run_until_complete(poster.connect())
        if not connect.get('success'):
            return {"success": False, "error": f"Connect failed: {connect.get('error')}"}
        result = loop.run_until_complete(poster.send_message(text, parse_mode='HTML'))
        loop.run_until_complete(poster.disconnect())
        loop.close()
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='تقرير تليجرام شامل')
    parser.add_argument('--dry-run', action='store_true', help='Print only, no send')
    parser.add_argument('--send', action='store_true', help='Send to Telegram')
    args = parser.parse_args()

    report = build_report()
    print(report)
    print("\n" + "="*50)
    print(f"Report length: {len(report)} chars, {len(report.split(chr(10)))} lines")

    if args.send:
        print("\n📤 Sending to Telegram...")
        result = send_to_telegram(report)
        if result.get('success'):
            print(f"✅ Sent! Message ID: {result.get('message_id')}")
        else:
            print(f"❌ Failed: {result.get('error')}")
    elif not args.dry_run:
        print("\n💡 Use --send to send to Telegram or --dry-run to suppress this message")
