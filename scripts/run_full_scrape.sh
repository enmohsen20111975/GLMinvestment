#!/bin/bash
cd ~/GLMinvestment
source .venv/bin/activate
echo "🔥 Running full TradingView scrape..."
python data_engine/scrapers/tradingview_scraper.py
echo "✅ Scrape complete!"
