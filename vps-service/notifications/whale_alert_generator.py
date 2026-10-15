#!/usr/bin/env python3
"""
whale_alert_generator.py — ماكينة إشعارات تسويقية حية (Marketing Engine)
========================================================================
Task BRAVO-MARKETING-ENGINE: يولد رسالة تلخيصية يومية خطافة من أرقام الرادار
الحقيقية (total inflow, accumulating/distributing counts, top accumulators,
cash-rich stocks)، ويرسلها لقناة التليجرام + Web Push Notification (FoudaLens-style).

البيانات حقيقية 100% (Rule 27 — لا أرقام وهمية): من liquidity_radar_v2.scan_market
اللي بيسحب من stocks.db + data_engine.db (fundamentals + screener_lists).

Usage:
    python3 vps-service/notifications/whale_alert_generator.py               # EGX
    python3 vps-service/notifications/whale_alert_generator.py --market TADAWUL

Env (اختياري للإرسال):
    STOCKS_DB, DATA_ENGINE_DB  (مسارات قواعد البيانات؛ default = db/stocks.db + db/data_engine.db)
    TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  (لإرسال التليجرام)
    WEB_PUSH_ENDPOINT                       (لـ Web Push)
"""
import os, sys, json
from pathlib import Path
from typing import Optional, Dict, List

# Project root: vps-service/notifications/ -> up 2 -> project root
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

# DB paths (env override for sandbox; default to production paths)
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))


def _fmt_flow(val: float, currency_ar: str) -> str:
    """تنسيق ديناميكي (مليار/مليون/ألف) حسب الحجم — يمنع "0.0 مليار" (Phase 1 #2)."""
    a = abs(val)
    if a >= 1e9:
        return f"{val/1e9:,.2f} مليار {currency_ar}"
    elif a >= 1e6:
        return f"{val/1e6:,.1f} مليون {currency_ar}"
    elif a >= 1e3:
        return f"{val/1e3:,.1f} ألف {currency_ar}"
    else:
        return f"{val:,.0f} {currency_ar}"


def generate_whale_pulse_alert(market: str = 'EGX') -> Dict:
    """اجمع أرقام الرادار الحقيقية + رتّب رسالة تسويقية خطافة (FoudaLens-style).

    Returns: {message: str, stats: {...}, top_accumulators: [...]}
    """
    from liquidity_radar_v2 import scan_market
    result = scan_market(market)
    stocks = result.get('stocks', [])

    # ── aggregate (real numbers only — Rule 27) ──
    accumulators = [s for s in stocks if (s.get('whale', {}).get('net_flow_egp', 0) or 0) > 0]
    distributors = [s for s in stocks if (s.get('whale', {}).get('net_flow_egp', 0) or 0) < 0]
    total_inflow_raw = sum(s['whale']['net_flow_egp'] for s in accumulators)
    total_outflow_raw = sum(abs(s['whale']['net_flow_egp']) for s in distributors)

    # ─ـ currency (Task BRAVO-GULF-TADAWUL) + dynamic formatting (Phase 1 #2: يمنع "0.0 مليار")
    mr = result.get('market_regime', {}) or {}
    currency_ar = mr.get('currency_ar', 'جنيه مصري')
    market_label = ' (تداول)' if market.upper() == 'TADAWUL' else ''
    inflow_str = _fmt_flow(total_inflow_raw, currency_ar)
    outflow_str = _fmt_flow(total_outflow_raw, currency_ar)

    # top accumulators (by net_flow)
    top = sorted(accumulators, key=lambda s: s['whale']['net_flow_egp'], reverse=True)[:5]
    # cash-rich accumulators (free_cf > 0 + net_flow > 0)
    cash_rich = [s for s in accumulators if (s.get('fundamentals', {}).get('free_cash_flow') or 0) > 0]

    # ── format the marketing message ──
    lines = []
    lines.append(
        f"🚨 رادار نبض الحيتان{market_label}: رصد دخول {inflow_str} كاش مؤسسي "
        f"في {len(accumulators)} أسهم.. و {len(distributors)} سهم تحت التصريف! "
        f"افتح المنصة وشوف الأسهم اللي الحيتان بتشتريها قبل الإغلاق."
    )
    if top:
        lines.append("")
        lines.append("🔥 أقوى تجميعات اليوم (الكاش المؤسسي):")
        for i, s in enumerate(top, 1):
            flow_raw = s['whale']['net_flow_egp']
            flow_str = _fmt_flow(flow_raw, currency_ar)
            sym = s.get('ticker', '?')
            name = (s.get('name') or sym)
            if len(name) > 20:
                name = name[:20] + '…'
            entry = s.get('entry_defense', {}).get('entry_level')
            entry_str = f"{entry:.2f}" if entry else "—"
            fcf = (s.get('fundamentals', {}).get('free_cash_flow') or 0) / 1e9
            fcf_str = f" | free_cf={fcf:+.1f}B" if fcf else ""
            tv = " 🐋TV" if s.get('tv_whale_spotted') else ""
            lines.append(f"  {i}. {sym} ({name}) — تدفق {flow_str} | دخول {entry_str}{fcf_str}{tv}")
    if cash_rich:
        lines.append("")
        lines.append(
            f"💎 {len(cash_rich)} سهم Cash-Rich (free_cf موجب + تجميع) — "
            f"ترشيح مؤسسي مدعوم بتدفق نقدي حقيقي."
        )
    lines.append("")
    lines.append("━━━ مولّد آليًا من رادار السيولة الصارم (Bravo 2 · Rule 27: أرقام حقيقية فقط) ━━━")

    msg = "\n".join(lines)
    return {
        'message': msg,
        'stats': {
            'total_inflow_raw': round(total_inflow_raw, 0),
            'total_outflow_raw': round(total_outflow_raw, 0),
            'inflow_display': inflow_str,
            'outflow_display': outflow_str,
            'currency_ar': currency_ar,
            'accumulating_count': len(accumulators),
            'distributing_count': len(distributors),
            'cash_rich_count': len(cash_rich),
            'scanned_count': len(stocks),
            'market': market,
        },
        'top_accumulators': [
            {'ticker': s.get('ticker'), 'flow_raw': round(s['whale']['net_flow_egp'], 0)}
            for s in top
        ],
    }


def send_telegram(message: str, channel: Optional[str] = None) -> bool:
    """أرسل لقناة التليجرام (يحتاج TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)."""
    import urllib.request, urllib.error
    token = os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = channel or os.environ.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHANNEL_ID')
    if not token or not chat_id:
        print("[whale_alert] ⚠️ TELEGRAM_BOT_TOKEN/CHAT_ID غير مضبوط — تخطّي إرسال التليجرام (طباعة فقط).")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": chat_id, "text": message, "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            ok = r.status == 200
            print(f"[whale_alert] {'✅ Telegram أُرسل' if ok else '❌ فشل'} (HTTP {r.status})")
            return ok
    except Exception as e:
        print(f"[whale_alert] ❌ Telegram send failed: {e}")
        return False


def send_web_push(message: str) -> bool:
    """أرسل Web Push Notification (يحتاج WEB_PUSH_ENDPOINT)."""
    import urllib.request
    endpoint = os.environ.get('WEB_PUSH_ENDPOINT')
    if not endpoint:
        print("[whale_alert] ⚠️ WEB_PUSH_ENDPOINT غير مضبوط — تخطّي Web Push (طباعة فقط).")
        return False
    payload = json.dumps({"title": "🚨 رادار نبض الحيتان", "body": message[:200]}).encode()
    req = urllib.request.Request(endpoint, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            ok = r.status in (200, 201)
            print(f"[whale_alert] {'✅ Web Push أُرسل' if ok else '❌ فشل'} (HTTP {r.status})")
            return ok
    except Exception as e:
        print(f"[whale_alert] ❌ Web Push failed: {e}")
        return False


def print_schedule() -> None:
    """اطبع سطور الـ cron للساعتين الذهبيتين (توقيت القاهرة)."""
    print("=" * 72)
    print("⏰ الجدولة — الساعتان الذهبيتان (توقيت القاهرة Africa/Cairo):")
    print("=" * 72)
    # Phase 1 #3: CRON_TZ=Africa/Cairo (cron env var) — يُضبط مرة في أعلى crontab.
    header = (
        "# ضبط توقيت القاهرة لـ cron (مرة واحدة في أعلى crontab):\n"
        "CRON_TZ=Africa/Cairo\n"
        "TZ=Africa/Cairo\n"
    )
    egx = (
        "# 12:30 ظهرًا (Mid-Session) — EGX\n"
        "30 12 * * * cd /root/GLMinvestment && \\\n"
        "  STOCKS_DB=db/stocks.db DATA_ENGINE_DB=db/data_engine.db \\\n"
        "  TELEGRAM_BOT_TOKEN=$BOT TELEGRAM_CHAT_ID=$CHAT WEB_PUSH_ENDPOINT=$PUSH \\\n"
        "  python3 vps-service/notifications/whale_alert_generator.py --market EGX >> /var/log/whale_alert.log 2>&1"
    )
    tadawul = (
        "# 14:45 عصرًا (قبل الإغلاق بربع ساعة) — TADAWUL\n"
        "45 14 * * * cd /root/GLMinvestment && \\\n"
        "  STOCKS_DB=db/stocks.db DATA_ENGINE_DB=db/data_engine.db \\\n"
        "  TELEGRAM_BOT_TOKEN=$BOT TELEGRAM_CHAT_ID=$CHAT WEB_PUSH_ENDPOINT=$PUSH \\\n"
        "  python3 vps-service/notifications/whale_alert_generator.py --market TADAWUL >> /var/log/whale_alert.log 2>&1"
    )
    print(header)
    print()
    print(egx)
    print()
    print(tadawul)
    print("=" * 72)
    print("التركيب: crontab -e ثم ألصق السطور (CRON_TZ يضمن توقيت القاهرة).")
    print("=" * 72)


def main() -> int:
    args = sys.argv[1:]
    if '--schedule' in args:
        print_schedule()
        return 0
    market = 'EGX'
    if '--market' in args:
        i = args.index('--market')
        market = args[i + 1] if i + 1 < len(args) else 'EGX'
    alert = generate_whale_pulse_alert(market)
    print("=" * 72)
    print("📡 رسالة التنبيه التسويقي الجاهزة للإرسال (FoudaLens-style):")
    print("=" * 72)
    print(alert['message'])
    print("=" * 72)
    print(f"📊 Stats: {alert['stats']}")
    print()
    # Phase 1: --dry-run يطبعة فقط بدون إرسال فعلي.
    if '--dry-run' in args:
        print("📦 --dry-run: تخطّي الإرسال (طباعة فقط).")
        return 0
    # محاولة الإرسال (شرطية على المفاتيح — طباعة only لو غير متاحة)
    tg = send_telegram(alert['message'])
    wp = send_web_push(alert['message'])
    print(f"\n📤 Telegram: {'✓' if tg else '✗'} | Web Push: {'✓' if wp else '✗'}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
