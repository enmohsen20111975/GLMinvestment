"""
Unified paths configuration for news-agent.
=============================================
الـ canonical project root هو /home/z/my-project (مش news-agent/).
كل الـ scrapers بتكتب في /home/z/my-project/db/data_engine.db.

Rule 28 (NO-DUPLICATION): مفيش DBs مكررة. مصدر واحد للحقيقة.
"""
from pathlib import Path

# === Canonical project root (الـ main project، مش news-agent/) ===
# news-agent/ هو submodule جوه الـ main project
NEWS_AGENT_DIR = Path(__file__).resolve().parent.parent  # /home/z/my-project/news-agent/
PROJECT_ROOT = NEWS_AGENT_DIR.parent                      # /home/z/my-project/

# === Canonical DBs (في /home/z/my-project/db/) ===
DB_DIR = PROJECT_ROOT / 'db'
DATA_ENGINE_DB = str(DB_DIR / 'data_engine.db')
NEWS_DB = str(DB_DIR / 'news.db')
STOCKS_DB = str(DB_DIR / 'stocks.db')
PREDICTIONS_DB = str(DB_DIR / 'predictions.db')
INTRADAY_DB = str(DB_DIR / 'intraday.db')

# === news-agent/data/ (للـ JSON files + telegram images) ===
DATA_DIR = NEWS_AGENT_DIR / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)

# === Disabled scrapers (محتفظ بيهم بس مش نشطين) ===
DISABLED_SCRAPERS = [
    'collectors/rss_collector.py.disabled',
    'collectors/scrappers/investing_scraper.py.disabled',
    'collectors/investing_news_collector.py.disabled',
]

# === Verification (لما الـ module يتـ import) ===
if __name__ == '__main__':
    print(f'PROJECT_ROOT: {PROJECT_ROOT}')
    print(f'NEWS_AGENT_DIR: {NEWS_AGENT_DIR}')
    print(f'DATA_ENGINE_DB: {DATA_ENGINE_DB}')
    print(f'NEWS_DB: {NEWS_DB}')
    print(f'STOCKS_DB: {STOCKS_DB}')
    print(f'DB_DIR exists: {DB_DIR.exists()}')
    print(f'data_engine.db exists: {Path(DATA_ENGINE_DB).exists()}')
    print(f'news.db exists: {Path(NEWS_DB).exists()}')
    print(f'stocks.db exists: {Path(STOCKS_DB).exists()}')
