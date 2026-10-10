#!/usr/bin/env python3
"""
🔥 Screener Blast - بوست "صيد اليوم بالبلدي" على تليجرام
=======================================================

يسحب ملخص قوائم TradingView (اللي بيكتبها tradingview_screener_lists.py
بعد الجلسة في جدول screener_lists) ويولّد:
  - كرت صورة احترافي بـ PIL (خلفية داكنة متناسقة مع المنصة)
  - نص "الخلاصة بالبلدي" كـ caption
وينشر الاثنين على قناة التليجرام عبر TelegramAutoPoster (send_photo).

التشغيل:
  python3 screener_blast.py            # نشر فوري (صورة + caption)
  python3 screener_blast.py --dry-run  # طباعة البوست + حفظ الصورة بدون نشر
"""

import os
import sys
import json
import argparse
import sqlite3
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
CARDS_DIR = PROJECT_ROOT / 'db' / 'screener_cards'
CARDS_DIR.mkdir(parents=True, exist_ok=True)

# أولوية القوائم الذهبية (الأهم للسيولة أولاً)
GOLD_ORDER = ['most_active', 'unusual_volume', 'high_dividend', 'high_net_income']
TRAP_ORDER = ['penny', 'top_gainers']

GOLD_LABELS = {
    'most_active': 'الأكثر نشاطاً',
    'unusual_volume': 'زخم غير اعتيادي',
    'high_dividend': 'أعلى عائد توزيعات',
    'high_net_income': 'أعلى صافي دخل',
}
TRAP_LABELS = {
    'penny': 'سهم قرشي',
    'top_gainers': 'الأكثر ارتفاعاً',
}

TOP_N = 3

# ألوان المنصة (داكنة — ممنوع الأزرق/الإنديجو)
BG = (19, 21, 27)          # #13151B خلفية الكرت
PANEL = (31, 34, 43)       # لوحات داخلية
GOLD = (16, 185, 129)       # أخضر فرصة
TRAP = (239, 68, 68)        # أحمر فخ
TEXT = (228, 231, 238)      # نص فاتح
MUTED = (148, 163, 184)     # نص ثانوي
ACCENT = (234, 179, 8)      # أصفر تمييزي


def get_list_rows(category: str, market: str = 'مصر', limit: int = TOP_N) -> list:
    """يقري أعلى N صفوف من قائمة معينة (مرتبة حسب rank)."""
    try:
        if not Path(DATA_ENGINE_DB).exists():
            return []
        conn = sqlite3.connect(DATA_ENGINE_DB, timeout=5.0)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT symbol, name, rank FROM screener_lists WHERE category = ? AND market = ? ORDER BY rank ASC LIMIT ?',
            (category, market, limit)
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"[ScreenerBlast] list error {category}: {e}")
        return []


def get_stock_stats(symbol: str, market: str = 'مصر') -> dict:
    """يجمع سعر/حجم/قيمة سوقية من stocks، ومتوسط 20 يوم + النسبة من price_history."""
    stats = {'price': None, 'volume': None, 'market_cap': None, 'avg20': None, 'ratio': None}
    try:
        if Path(DATA_ENGINE_DB).exists():
            conn = sqlite3.connect(DATA_ENGINE_DB, timeout=5.0)
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                'SELECT price, volume, market_cap FROM stocks WHERE symbol = ? AND market = ?',
                (symbol, market)
            ).fetchone()
            conn.close()
            if row:
                stats['price'] = row['price']
                stats['volume'] = row['volume']
                stats['market_cap'] = row['market_cap']
        if Path(PRICE_HISTORY_DB).exists():
            try:
                ph = sqlite3.connect(PRICE_HISTORY_DB, timeout=5.0)
                ph.row_factory = sqlite3.Row
                tbl = None
                for cand in ('price_history', 'daily_prices', 'prices'):
                    try:
                        ph.execute(f"SELECT 1 FROM {cand} LIMIT 1")
                        tbl = cand
                        break
                    except Exception:
                        continue
                if tbl:
                    rows = ph.execute(
                        f"SELECT volume FROM {tbl} WHERE ticker = ? ORDER BY date DESC LIMIT 20",
                        (symbol,)
                    ).fetchall()
                    vols = [r['volume'] for r in rows if r['volume']]
                    if len(vols) >= 2:
                        avg = sum(vols) / len(vols)
                        last = vols[0]
                        stats['avg20'] = avg
                        if avg > 0:
                            stats['ratio'] = round(last / avg, 2)
                ph.close()
            except Exception as e:
                print(f"[ScreenerBlast] price_history error {symbol}: {e}")
    except Exception as e:
        print(f"[ScreenerBlast] stats error {symbol}: {e}")
    return stats


def build_top_lists() -> dict:
    """يجمع أعلى 3 ذهبي وأعلى 3 فخ."""
    gold, trap = [], []
    for cat in GOLD_ORDER:
        for r in get_list_rows(cat):
            r = dict(r)
            r['category'] = cat
            r['stats'] = get_stock_stats(r['symbol'])
            gold.append(r)
            if len(gold) >= TOP_N:
                break
        if len(gold) >= TOP_N:
            break
    for cat in TRAP_ORDER:
        for r in get_list_rows(cat):
            r = dict(r)
            r['category'] = cat
            r['stats'] = get_stock_stats(r['symbol'])
            trap.append(r)
            if len(trap) >= TOP_N:
                break
        if len(trap) >= TOP_N:
            break
    return {'gold': gold, 'trap': trap}


def format_stock_line(r: dict) -> str:
    name = (r.get('name') or '').strip()
    label = (GOLD_LABELS if r['category'] in GOLD_LABELS else TRAP_LABELS).get(r['category'], r['category'])
    if name:
        return f"• *{r['symbol']}* — {name} _({label})_"
    return f"• *{r['symbol']}* _({label})_"


def build_post(top: dict) -> str:
    today = datetime.now().strftime('%Y-%m-%d')
    gold = top.get('gold', [])
    trap = top.get('trap', [])

    lines = []
    lines.append("📊 *صيد النهاردة بالبلدي — بعد الجلسة*")
    lines.append(f"🗓️ {today}")
    lines.append("")
    lines.append("🔥 *الفرص الذهبية (سيولة مؤسسية دخلت بقوة):*")
    if gold:
        for r in gold:
            lines.append(format_stock_line(r))
    else:
        lines.append("• مفيش حركة استثنائية واضحة النهاردة يا هندسة، استنى الجلسة الجاية.")
    lines.append("")
    lines.append("⚠️ *فخاخ النهاردة (ابعد عنها أو اتعامل بيها بحذر):*")
    if trap:
        for r in trap:
            lines.append(format_stock_line(r))
    else:
        lines.append("• مفيش فخاخ مسجلة — بس برضه متندفعش ورا أي سهم على العالي.")
    lines.append("")
    lines.append("💡 السيولة الذكية بتختار صح… إنتَ إيه رأيك؟ خلي الأرقام تقودك مش المشاعر 😎")
    lines.append("")
    lines.append("#تحليل_فني #EGX #صيد_اليوم")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════
# توليد الكرت بالصورة — PIL (Zero cost على السيرفر)
# ═══════════════════════════════════════════════════════════════════════════

def build_card_image(top: dict) -> str | None:
    """يولّد صورة كرت احترافي ويرجّع مسارها. None لو PIL مش متاح."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("[ScreenerBlast] Pillow غير متاح — هنشر نصياً فقط")
        return None

    def load_font(size, bold=False):
        candidates = [
            ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold
             else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
            ('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' if bold
             else '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'),
            ('/usr/share/fonts/opentype/noto/NotoSansArabic-Bold.ttf' if bold
             else '/usr/share/fonts/opentype/noto/NotoSansArabic-Regular.ttf'),
        ]
        for c in candidates:
            if os.path.exists(c):
                try:
                    return ImageFont.truetype(c, size)
                except Exception:
                    continue
        return ImageFont.load_default()

    f_title = load_font(30, bold=True)
    f_sym = load_font(22, bold=True)
    f_lbl = load_font(16, bold=True)
    f_small = load_font(13)

    W = 720
    PAD = 28
    row_h = 86
    header_h = 92
    footer_h = 46
    gold = top.get('gold', [])
    trap = top.get('trap', [])
    n_rows = max(len(gold), len(trap), 1)
    H = header_h + footer_h + (n_rows * row_h) + (PAD * 3)

    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)

    # هيدر
    d.text((PAD, 22), "صيد النهاردة بالبلدي", font=f_title, fill=TEXT)
    d.text((PAD, 60), datetime.now().strftime('بعد الجلسة — %Y-%m-%d'), font=f_small, fill=MUTED)

    y = header_h
    col_w = (W - PAD * 3) // 2

    def draw_column(x, title, items, color, labels):
        d.text((x, y - 30), title, font=f_lbl, fill=color)
        ry = y
        for it in items:
            d.rectangle([x, ry, x + col_w, ry + row_h - 10], fill=PANEL, outline=color, width=2)
            sym = it['symbol']
            name = (it.get('name') or '').strip()
            lab = labels.get(it['category'], it['category'])
            d.text((x + 12, ry + 10), sym, font=f_sym, fill=TEXT)
            if name:
                d.text((x + 12, ry + 40), name[:18], font=f_small, fill=MUTED)
            d.text((x + 12, ry + 60), lab, font=f_small, fill=color)
            st = it.get('stats', {})
            vol_txt = ''
            if st.get('ratio') is not None:
                vol_txt = f"حجم/متوسط20: {st['ratio']}x"
            elif st.get('volume'):
                vol_txt = f"حجم: {st['volume']}"
            if vol_txt:
                d.text((x + col_w - 12, ry + 10), vol_txt, font=f_small, fill=ACCENT, anchor='ra')
            ry += row_h

    draw_column(PAD, "🔥 فرص ذهبية", gold, GOLD, GOLD_LABELS)
    draw_column(PAD * 2 + col_w, "⚠️ فخاخ مضاربية", trap, TRAP, TRAP_LABELS)

    # فوتر
    d.text((PAD, H - footer_h + 14), "#تحليل_فني  #EGX  #صيد_اليوم", font=f_small, fill=MUTED)

    path = str(CARDS_DIR / f"screener_card_{datetime.now().strftime('%Y%m%d')}.png")
    img.save(path, 'PNG')
    return path


def post_blast(dry_run: bool = False) -> dict:
    top = build_top_lists()
    caption = build_post(top)
    image_path = build_card_image(top)

    if dry_run:
        print("=" * 50)
        print(caption)
        print("=" * 50)
        print(f"[dry-run] image: {image_path}")
        return {"success": True, "dry_run": True, "image": image_path,
                "gold": len(top['gold']), "trap": len(top['trap'])}

    try:
        import asyncio
        from telegram.auto_poster import auto_poster

        if image_path:
            result = asyncio.new_event_loop().run_until_complete(
                auto_poster.send_photo(image_path, caption=caption, parse_mode='md')
            )
        else:
            result = asyncio.new_event_loop().run_until_complete(
                auto_poster.send_message(caption, parse_mode='md')
            )
        return {"success": bool(result and result.get('success')), "result": result,
                "image": image_path, "gold": len(top['gold']), "trap": len(top['trap'])}
    except Exception as e:
        return {"success": False, "error": str(e), "image": image_path,
                "gold": len(top['gold']), "trap": len(top['trap'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Screener Blast Telegram poster (image + caption)')
    parser.add_argument('--dry-run', action='store_true', help='توليد الصورة + طباعة البوست بدون نشر')
    args = parser.parse_args()
    out = post_blast(dry_run=args.dry_run)
    print(json.dumps(out, ensure_ascii=False, indent=2))
