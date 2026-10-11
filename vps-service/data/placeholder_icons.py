#!/usr/bin/env python3
"""placeholder_icons.py — إنشاء أيقونات placeholder للأسهم اللي ملهاش logo على TradingView

الأسهم اللي TradingView ماعندهاش logo (Rule 27: متنحملهاش fake logo) بتسابت 404 في الكونسول.
بدل ما الـ frontend يrequest ملف مش موجود، بنعمل SVG placeholder محلي باسم السهم
(neutral — مش تزوير logo، بس fallback UI زي الـ sector emoji بس بشكل ملف محلي).

Usage: python3 placeholder_icons.py
"""
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
OUTPUT_DIR = PROJECT_ROOT / "public" / "stock-icons"

SVG_TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="{bg}"/>
  <text x="32" y="41" font-family="system-ui,sans-serif" font-size="{fs}" font-weight="700" fill="#ffffff" text-anchor="middle">{ticker}</text>
</svg>
"""

# لون محايد للـ placeholders (slate) — مختلف عن logos الحقيقية عشان متلخبش
BG = "#94a3b8"


def main():
    db = sqlite3.connect(str(STOCKS_DB))
    rows = db.execute(
        "SELECT DISTINCT ticker FROM stocks WHERE market IN ('EGX', 'مصر')"
    ).fetchall()
    db.close()

    created = 0
    for (ticker,) in rows:
        t = (ticker or "").strip().upper()
        if not t:
            continue
        out = OUTPUT_DIR / f"{t}.svg"
        if out.exists():
            continue
        # خط أصغر للأسماء الطويلة (bond tickers زي EGS48271C018)
        fs = 22 if len(t) <= 5 else (16 if len(t) <= 9 else 11)
        out.write_text(SVG_TEMPLATE.format(bg=BG, fs=fs, ticker=t), encoding="utf-8")
        created += 1

    total = len(list(OUTPUT_DIR.glob("*.svg")))
    print(f"created: {created} placeholder icons")
    print(f"total icons: {total}")


if __name__ == "__main__":
    main()
