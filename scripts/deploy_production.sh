#!/bin/bash
set -e

echo "🚀 Starting production deployment..."

cd ~/GLMinvestment

echo "📥 Pulling latest code..."
git pull origin main

echo "🐍 Setting up Python venv..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate

echo "📦 Installing dependencies..."
if [ -f "data_engine/requirements.txt" ]; then
    pip install -r data_engine/requirements.txt
else
    echo "⚠️ data_engine/requirements.txt not found, installing minimal deps..."
    pip install flask flask-cors playwright requests beautifulsoup4
fi

echo "🌐 Installing Playwright deps..."
python -m playwright install-deps chromium

echo "🗄️ Running initial scrape..."
python data_engine/scrapers/tradingview_scraper.py

echo "🔄 Running initial sync..."
python3 data_engine/sync.py

echo "⏰ Setting up cron jobs..."
(crontab -l 2>/dev/null | grep -v "TradingView scraper\|data_engine/sync.py";
 echo "# TradingView scraper every 5 min during work hours (Sun-Thu 9:00-14:59)
*/5 9-14 * * 0-4 cd ~/GLMinvestment && source .venv/bin/activate && python data_engine/scrapers/tradingview_scraper.py >> data_engine/logs/scraper.log 2>&1" ) | crontab -

echo "✅ Deployment complete!"
