# DB Snapshot — 2026-10-28 (Experimental Branch)

**الفرع ده للـ DBs التجريبية فقط.** مش هتتـ merge لـ main أبداً.

## المحتويات

- `db_snapshot_2026-10-28_part_00` إلى `part_05` — 6 أجزاء (235MB مضغوط)
- كل جزء 45MB ما عدا الأخير (9.4MB)

## الـ DBs بعد فك الضغط

| DB | الحجم | آخر تحديث |
|---|---|---|
| stocks.db | 28MB | 2026-10-28 |
| predictions.db | 314MB | 2026-10-28 |
| price_history.db | 376MB | 2026-10-28 |
| data_engine.db | 548MB | 2026-10-28 |
| intraday.db | — | — |
| news.db | 14MB | 2026-10-28 |
| metrics.db | 6.4MB | 2026-10-21 |
| decision_log.db | 602KB | 2026-10-28 |
| auth.db | 266KB | 2026-10-27 |

## إزاي تستخدم

```bash
# 1. نزل الأجزاء الـ 6
git clone -b db-experimental https://github.com/enmohsen20111975/GLMinvestment.git db-snapshot-repo
cd db-snapshot-repo/db-snapshot

# 2. ادمج الأجزاء
cat db_snapshot_2026-10-28_part_00 db_snapshot_2026-10-28_part_01 db_snapshot_2026-10-28_part_02 db_snapshot_2026-10-28_part_03 db_snapshot_2026-10-28_part_04 db_snapshot_2026-10-28_part_05 > db_snapshot_2026-10-28.zip

# 3. فك الضغط في فولدر db/
unzip db_snapshot_2026-10-28.zip -d /path/to/GLMinvestment/db/
```

## تحذير

- **مش هتتـ merge لـ main أبداً** — ده فرع تجريبي للـ DBs بس.
- **استخدمها على الابتوب فقط** — مش للإنتاج.
- **الـ DBs دي من snapshot 2026-10-28** — تحديثها بيحصل عبر الـ data_engine في الإنتاج.
