#!/usr/bin/env python3
"""
alerts_engine.py — محرك التنبيهات الذكية وإدارة المخاطر
=========================================================
Phase 3 #1: مراقبة قوائم العميل ومحافظهم — فحص الأسهم ومقارنتها بلحظات دخول
الحوت أو تهديد وقف الخسارة، وإطلاق تنبيهات للمتصفح والتليجرام.

يقرأ من رادار السيولة (whale flow + entry_defense + fundamentals).
Rule 27: أرقام حقيقية. لا except-pass.

Usage:
    python3 vps-service/analyzers/alerts_engine.py --portfolio "COMI:EGX:130:100,SWDY:EGX:116:200"
"""
from __future__ import annotations
import os, sys, json
from pathlib import Path
from typing import Optional, Dict, List

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))


def _to_float(v, default=0.0):
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace(',', '').strip())
    except (ValueError, TypeError):
        return default


def monitor_portfolio(portfolio: List[Dict]) -> Dict:
    """فحص كل سهم في المحفظة مقابل رادار الحيتان + مستويات الدخول/الدفاع."""
    from liquidity_radar_v2 import scan_market
    by_market: Dict[str, List[Dict]] = {}
    for h in portfolio:
        by_market.setdefault(h['market'], []).append(h)
    alerts = []
    for market, holdings in by_market.items():
        try:
            result = scan_market(market)
            stocks = {str(s.get('ticker', '')).upper(): s for s in result.get('stocks', [])}
        except Exception as e:
            sys.stderr.write(f"[alerts] scan_market({market}) error: {e}\n")
            stocks = {}
        for h in holdings:
            s = stocks.get(h['ticker'].upper())
            if not s:
                alerts.append({
                    'ticker': h['ticker'], 'market': market, 'alert_type': 'NO_DATA',
                    'severity': 'info', 'message': f"{h['ticker']} غير موجود في مسح {market}",
                })
                continue
            entry_defense = s.get('entry_defense', {}) or {}
            whale = s.get('whale', {}) or {}
            fundamentals = s.get('fundamentals', {}) or {}
            current = _to_float(entry_defense.get('entry_level'))
            defense = _to_float(entry_defense.get('defense_level'))
            net_flow = _to_float(whale.get('net_flow_egp'))
            entry_price = _to_float(h.get('entry_price'))
            shares = _to_float(h.get('shares'))
            pnl_pct = ((current - entry_price) / entry_price * 100.0) if entry_price > 0 and current > 0 else 0.0
            pnl_egp = (current - entry_price) * shares if current > 0 else 0.0
            # ── alerts ──
            stock_alerts = []
            # STOP-LOSS THREAT: price near/below defense (within 2% above OR below).
            if defense > 0 and current > 0:
                distance_pct = ((current - defense) / defense * 100.0)
                if current < defense:
                    stock_alerts.append({
                        'alert_type': 'STOP_LOSS_BREACH', 'severity': 'critical',
                        'message': f"🛑 {h['ticker']} كسر وقف الخسارة ({current:.2f} < دفاع {defense:.2f}) — اقطع فوراً.",
                    })
                elif distance_pct < 2.0:
                    stock_alerts.append({
                        'alert_type': 'STOP_LOSS_THREAT', 'severity': 'warning',
                        'message': f"⚠️ {h['ticker']} يقترب من وقف الخسارة ({current:.2f} — دفاع {defense:.2f} — على بُعد {distance_pct:+.1f}%).",
                    })
            # WHALE DISTRIBUTING (holding in a distributing stock = risk).
            if net_flow < 0:
                stock_alerts.append({
                    'alert_type': 'WHALE_DISTRIBUTING', 'severity': 'warning',
                    'message': f"🐋 {h['ticker']} تصريف حيتان (صافي التدفق {net_flow/1e6:+.1f}M) — الحيتان بتبيع.",
                })
            # WHALE ACCUMULATING (near whale entry — good).
            elif net_flow > 0:
                stock_alerts.append({
                    'alert_type': 'WHALE_ACCUMULATING', 'severity': 'positive',
                    'message': f"🐋 {h['ticker']} تجميع حيتان (صافي التدفق {net_flow/1e6:+.1f}M) — الحيتان بتشتري.",
                })
            # CASH BLEEDING (free_cf negative).
            free_cf = fundamentals.get('free_cash_flow')
            if free_cf is not None and free_cf < 0:
                stock_alerts.append({
                    'alert_type': 'CASH_BLEEDING', 'severity': 'warning',
                    'message': f"💰 {h['ticker']} الشركة تنزف كاش (free_cf={free_cf/1e9:+.2f}B).",
                })
            for a in stock_alerts:
                a.update({
                    'ticker': h['ticker'], 'market': market,
                    'current_price': round(current, 4), 'entry_price': entry_price,
                    'defense': round(defense, 4) if defense else None,
                    'pnl_pct': round(pnl_pct, 2), 'pnl_egp': round(pnl_egp, 2),
                    'net_flow_egp': round(net_flow, 0), 'free_cf': free_cf,
                })
                alerts.append(a)
    summary = {
        'critical': sum(1 for a in alerts if a.get('severity') == 'critical'),
        'warning': sum(1 for a in alerts if a.get('severity') == 'warning'),
        'positive': sum(1 for a in alerts if a.get('severity') == 'positive'),
        'info': sum(1 for a in alerts if a.get('severity') == 'info'),
    }
    return {'alerts': alerts, 'summary': summary, 'holdings_checked': len(portfolio)}


def _send_telegram(message: str) -> bool:
    """إرسال تنبيه للتليجرام (شرطي على TELEGRAM_BOT_TOKEN)."""
    import urllib.request
    token = os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = os.environ.get('TELEGRAM_CHAT_ID')
    if not token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = json.dumps({"chat_id": chat_id, "text": message, "parse_mode": "HTML"}).encode()
    try:
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status == 200
    except Exception as e:
        sys.stderr.write(f"[alerts] telegram send error: {e}\n")
        return False


def parse_portfolio(s: str) -> List[Dict]:
    out = []
    for item in s.split(','):
        parts = item.strip().split(':')
        if len(parts) >= 4:
            out.append({
                'ticker': parts[0].strip(), 'market': parts[1].strip(),
                'entry_price': _to_float(parts[2]), 'shares': _to_float(parts[3]),
            })
    return out


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description='محرك التنبيهات الذكية — Portfolio Monitor (Phase 3)')
    p.add_argument('--portfolio', required=True, help='TICKER:MARKET:ENTRY:SHARES,...')
    p.add_argument('--dry-run', action='store_true', help='طباعة فقط بدون إرسال')
    args = p.parse_args()
    portfolio = parse_portfolio(args.portfolio)
    r = monitor_portfolio(portfolio)
    print("=" * 72)
    print("🚨 محرك التنبيهات الذكية — مراقبة المحفظة")
    print("=" * 72)
    print(f"\n📊 المحفظة: {r['holdings_checked']} سهم | التنبيهات: {r['summary']}")
    if not r['alerts']:
        print("✅ لا تنبيهات — كل الأسهم سليمة.")
    for a in r['alerts']:
        icon = {'critical': '🛑', 'warning': '⚠️', 'positive': '✅', 'info': 'ℹ️'}.get(a['severity'], '•')
        print(f"\n{icon} [{a['alert_type']}] {a['ticker']} ({a['market']})")
        print(f"   {a['message']}")
        print(f"   Entry: {a.get('entry_price')} | Current: {a.get('current_price')} | Defense: {a.get('defense')} | P/L: {a.get('pnl_pct')}% ({a.get('pnl_egp')} EGP)")
        print(f"   Whale net_flow: {a.get('net_flow_egp')} | free_cf: {a.get('free_cf')}")
    print("=" * 72)
    if not args.dry_run and r['alerts']:
        msg = "\n".join(a['message'] for a in r['alerts'] if a['severity'] in ('critical', 'warning'))
        if msg:
            sent = _send_telegram(msg)
            print(f"📤 Telegram: {'✓ أُرسل' if sent else '✗ تخطّي (لا مفاتيح)'}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
