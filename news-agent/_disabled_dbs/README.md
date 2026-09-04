# Disabled DBs (kept for reference)

هذه الـ DBs كانت موجودة في الـ news repo الأصلي، لكن تم تعطيلها لأن:
- الـ canonical source لـ data_engine.db هو `/home/z/my-project/db/data_engine.db` (125 MB)
- الـ canonical source لـ news.db هو `/home/z/my-project/db/news.db` (7,806 خبر)

الـ news-agent scrapers بتكتب مباشرة في `/home/z/my-project/db/data_engine.db`.
أخبار news-agent القديمة (212) ادمجت في `/home/z/my-project/db/news.db.market_news`.

Rule 28 (NO-DUPLICATION): مفيش DBs مكررة.
