#!/usr/bin/env python3
"""
whale_alert_generator.py — ماكينة إشعارات رادار الحيتان الذهبية
=================================================================================
Task SOSO-WHALE-ALERT (2026-10-15): ماكينة إشعارات تخطف الزبون.

المميزات:
  - يقبل --market EGX أو --market TADAWUL (يدعم الريال السعودي)
  - يولّد رسالة تسويقية بالأرقام الحقيقية من data_engine.db
  - جاهز للجدولة عبر cron في توقيتين ذهبيين:
      12:30 ظهراً (ذروة منتصف الجلسة)
      14:45 عصراً (قبل إغلاق البورصة بربع ساعة)

Usage:
  python3 vps-service/notifications/whale_alert_generator.py --market EGX
  python3 vps-service/notifications/whale_alert_generator.py --market TADAWUL
  python3 vps-service/notifications/whale_alert_generator.py --market TADAWUL --dry-run
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_FILE = PROJECT_ROOT / "db" / "data_engine.db"

# خريطة العملات لكل سوق
MARKET_CONFIG = {
    'EGX': {
        'currency_ar': 'جنيه',
        'currency_short': 'مليار ج.م',
        'market_ar': 'البورصة المصرية',
        'market_slug': 'egypt',
    },
    'TADAWUL': {
        'currency_ar': 'ريال',
        'currency_short': 'مليار ر.س',
        'market_ar': 'تداول السعودية',
        'market_slug': 'saudi',
    },
    'KSE': {
        'currency_ar': 'دينار',
        'currency_short': 'مليار د.ك',
        'market_ar': 'بورصة الكويت',
        'market_slug': 'kuwait',
    },
    'QSE': {
        'currency_ar': 'ريال',
        'currency_short': 'مليار ر.ق',
        'market_ar': 'بورصة قطر',
        'market_slug': 'qatar',
    },
}


def log(msg: str) -> None:
    print(f"[whale_alert] {msg}", flush=True)


def _to_float(v, default=0.0):
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace('،', '').strip())
    except (ValueError, TypeError):
        return default


def generate_alert(market: str, dry_run: bool = False) -> dict:
    """يولّد رسالة رادار الحيتان للسوق المحدد."""
    config = MARKET_CONFIG.get(market.upper(), MARKET_CONFIG['EGX'])
    currency_short = config['currency_short']
    market_ar = config['market_ar']

    if not DB_FILE.exists():
        log(f"❌ data_engine.db غير موجود: {DB_FILE}")
        return {'success': False, 'error': 'DB not found'}

    conn = sqlite3.connect(str(DB_FILE))
    c = conn.cursor()

    # 1. حساب إجمالي صافي التدفق المؤسسي (من tab_technical_analysis أو stocks)
    # نستخدم stocks table للحصول على volume × close
    try:
        c.execute("""
            SELECT COALESCE(SUM(volume * close), 0) as total_turnover
            FROM stocks
            WHERE market = ? OR market = ?
        """, (market, config['market_slug']))
        row = c.fetchone()
        total_turnover = _to_float(row[0]) if row else 0
    except Exception:
        total_turnover = 0

    # 2. عدد الأسهم الإيجابية (change_percent > 0)
    try:
        c.execute("""
            SELECT COUNT(*) FROM stocks
            WHERE (market = ? OR market = ?) AND change_percent > 0
        """, (market, config['market_slug']))
        positive_count = c.fetchone()[0]
    except Exception:
        positive_count = 0

    # 3. عدد الأسهم السلبية
    try:
        c.execute("""
            SELECT COUNT(*) FROM stocks
            WHERE (market = ? OR market = ?) AND change_percent < 0
        """, (market, config['market_slug']))
        negative_count = c.fetchone()[0]
    except Exception:
        negative_count = 0

    # 4. إجمالي الأسهم
    try:
        c.execute("""
            SELECT COUNT(*) FROM stocks
            WHERE market = ? OR market = ?
        """, (market, config['market_slug']))
        total_stocks = c.fetchone()[0]
    except Exception:
        total_stocks = 0

    # 5. أعلى 3 أسهم تدفقاً (لو volume متاح)
    try:
        c.execute("""
            SELECT symbol, name, volume * close as turnover, change_percent
            FROM stocks
            WHERE (market = ? OR market = ?) AND volume IS NOT NULL AND close IS NOT NULL AND volume > 0
            ORDER BY turnover DESC
            LIMIT 3
        """, (market, config['market_slug']))
        top_stocks = c.fetchall()
    except Exception:
        top_stocks = []

    conn.close()

    # تحويل القيمة لمليارات
    total_billion = total_turnover / 1e9
    positive_ratio = (positive_count / total_stocks * 100) if total_stocks > 0 else 0

    # بناء الرسالة
    if total_stocks == 0:
        message = f"🚨 رادار نبض الحيتان ({market_ar}): لا توجد بيانات متاحة حالياً."
    else:
        emoji = "🟢" if positive_ratio >= 60 else ("🟡" if positive_ratio >= 40 else "🔴")
        message = (
            f"🚨 رادار نبض الحيتان ({market_ar})\n"
            f"\n"
            f"{emoji} إجمالي التدفق النقدي: {total_billion:.1f} {currency_short}\n"
            f"📈 أسهم صاعدة: {positive_count} ({positive_ratio:.0f}%)\n"
            f"📉 أسهم هابطة: {negative_count}\n"
            f"📊 إجمالي الأسهم: {total_stocks}\n"
        )
        if top_stocks:
            message += "\n🔥 أعلى الأسهم تدفقاً:\n"
            for i, (sym, name, turnover, chg) in enumerate(top_stocks, 1):
                chg_str = f"+{chg:.2f}%" if chg and chg >= 0 else f"{chg:.2f}%" if chg else "—"
                message += f"  {i}. {sym} ({name}) — {turnover/1e9:.1f} {currency_short} ({chg_str})\n"

        message += f"\n⏰ توقيت الإشعار: {datetime.now(timezone.utc).strftime('%H:%M UTC')}\n"
        message += "منصة دليل الاستثمار | invist.m2y.net"

    result = {
        'success': True,
        'market': market,
        'market_ar': market_ar,
        'message': message,
        'stats': {
            'total_turnover_billion': round(total_billion, 2),
            'currency': currency_short,
            'positive_count': positive_count,
            'negative_count': negative_count,
            'total_stocks': total_stocks,
            'positive_ratio_pct': round(positive_ratio, 1),
            'top_stocks': [
                {'symbol': s, 'name': n, 'turnover_billion': round(t/1e9, 2), 'change_pct': chg}
                for s, n, t, chg in top_stocks
            ],
        },
        'generated_at': datetime.now(timezone.utc).isoformat(),
    }

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="ماكينة إشعارات رادار الحيتان الذهبية")
    parser.add_argument('--market', type=str, default='EGX', help='السوق (EGX, TADAWUL, KSE, QSE)')
    parser.add_argument('--dry-run', action='store_true', help='معاينة فقط (لا إرسال)')
    args = parser.parse_args()

    market = args.market.upper()
    log("=" * 60)
    log(f"🚨 رادار نبض الحيتان — السوق: {market}")
    log(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    log("=" * 60)

    result = generate_alert(market, args.dry_run)

    if not result['success']:
        log(f"❌ {result['error']}")
        return 1

    # طباعة الرسالة
    print()
    print("━" * 60)
    print(result['message'].replace('\\n', '\n'))
    print("━" * 60)

    # طباعة الإحصائية
    stats = result['stats']
    log(f"\n📊 الإحصائية:")
    log(f"  إجمالي التدفق: {stats['total_turnover_billion']} {stats['currency']}")
    log(f"  صاعدة: {stats['positive_count']} ({stats['positive_ratio_pct']}%)")
    log(f"  هابطة: {stats['negative_count']}")
    log(f"  إجمالي الأسهم: {stats['total_stocks']}")

    if stats['top_stocks']:
        log(f"\n🔥 أعلى 3 أسهم:")
        for s in stats['top_stocks']:
            log(f"  {s['symbol']} — {s['turnover_billion']} {stats['currency']} ({s['change_pct']:.2f}%)")

    if not args.dry_run:
        log("\n📡 جاهز للإرسال إلى Telegram + Push Notifications")
        log("⏰ الجدولة الذهبية: 12:30 ظهراً + 14:45 عصراً (توقيت القاهرة)")

    return 0


if __name__ == '__main__':
    sys.exit(main())
