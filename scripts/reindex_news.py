#!/usr/bin/env python3
"""
News Re-indexing and Backfill Script
====================================
Re-processes all news articles in news.db with:
1. Exact EGX dictionary matching (fixing all wrong COMI/FWRY hallucinations)
2. Accurate sentiment and impact classifications
3. DeepSeek executive financial summaries (summary_ar) and catalyst flags
"""

import sys
import sqlite3
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT / 'vps-service' / 'analyzers'))
sys.path.append(str(ROOT / 'vps-service' / 'ai'))

from egx_stocks_dictionary import extract_tickers_accurately, get_stock_display_info
from deepseek_news_service import enrich_news_with_deepseek, rule_based_fallback

DB_PATH = ROOT / 'db' / 'news.db'

def reindex():
    print(f"Connecting to database: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Ensure is_catalyst column exists
    try:
        cur.execute("ALTER TABLE market_news ADD COLUMN is_catalyst INTEGER DEFAULT 0")
        conn.commit()
        print("Added column is_catalyst to market_news.")
    except Exception:
        pass

    cur.execute("SELECT id, title, content, tickers, sentiment, impact_type, summary_ar FROM market_news ORDER BY id DESC")
    rows = cur.fetchall()
    print(f"Total articles to inspect: {len(rows)}")

    updated_tickers_count = 0
    enriched_ai_count = 0

    for i, (nid, title, content, old_tickers_json, old_sentiment, old_impact, old_summary) in enumerate(rows):
        full_text = f"{title or ''} {content or ''}"
        accurate_tickers = extract_tickers_accurately(full_text)
        new_tickers_json = json.dumps(accurate_tickers, ensure_ascii=False)

        # Check if tickers changed
        if new_tickers_json != old_tickers_json:
            updated_tickers_count += 1

        # We enrich news that either has tickers OR had high importance / earnings
        should_enrich_ai = bool(accurate_tickers)

        if should_enrich_ai:
            print(f"[{i+1}/{len(rows)}] Enriching #{nid}: {title[:55]} -> {accurate_tickers}")
            try:
                # Use DeepSeek for accurate financial synthesis
                analysis = enrich_news_with_deepseek(title, content, accurate_tickers, timeout=6.0)
                sentiment = analysis.get('sentiment') or old_sentiment or 'neutral'
                impact_type = analysis.get('impact_type') or old_impact or 'general'
                importance = analysis.get('importance', 65)
                is_catalyst = 1 if analysis.get('is_catalyst') else 0
                summary_ar = analysis.get('summary_ar') or title
                enriched_ai_count += 1
                # Small pause to be respectful to rate limits
                time.sleep(0.3)
            except Exception as e:
                print(f"  Fallback for #{nid}: {e}")
                fb = rule_based_fallback(title, content, accurate_tickers)
                sentiment = fb['sentiment']
                impact_type = fb['impact_type']
                importance = fb['importance']
                is_catalyst = 1 if fb['is_catalyst'] else 0
                summary_ar = fb['summary_ar']
        else:
            # Clean rule-based for general macro news
            fb = rule_based_fallback(title, content, accurate_tickers)
            sentiment = fb['sentiment']
            impact_type = fb['impact_type']
            importance = fb['importance']
            is_catalyst = 0
            summary_ar = old_summary if (old_summary and len(old_summary) > 20) else title

        cur.execute("""
            UPDATE market_news
            SET tickers = ?,
                sentiment = ?,
                impact_type = ?,
                importance = ?,
                is_catalyst = ?,
                summary_ar = ?
            WHERE id = ?
        """, (new_tickers_json, sentiment, impact_type, importance, is_catalyst, summary_ar, nid))

        if (i + 1) % 25 == 0:
            conn.commit()
            print(f"--- Processed {i+1} / {len(rows)} articles ---")

    conn.commit()
    conn.close()

    print("\n==========================================")
    print("REINDEXING COMPLETED SUCCESSFULLY!")
    print(f"Total articles scanned: {len(rows)}")
    print(f"Articles with corrected tickers: {updated_tickers_count}")
    print(f"Articles enriched with AI investor summaries: {enriched_ai_count}")
    print("==========================================")

if __name__ == '__main__':
    reindex()
