#!/usr/bin/env python3
"""Deep analysis of the restored predictions.db to understand WHY stats are good/bad."""
import sqlite3
import statistics

con = sqlite3.connect('/home/z/my-project/db/predictions.db')
cur = con.cursor()

print("=" * 70)
print("RESTORED predictions.db — Deep Analysis")
print("=" * 70)

# Overall
total, closed = cur.execute("SELECT COUNT(*), SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) FROM predictions").fetchone()
print(f"\nTotal: {total} | Closed: {closed}")

# Win/loss
wins, losses = cur.execute("SELECT SUM(CASE WHEN actual_return>0 THEN 1 ELSE 0 END), SUM(CASE WHEN actual_return<=0 THEN 1 ELSE 0 END) FROM predictions WHERE outcome_date IS NOT NULL").fetchone()
print(f"Wins: {wins} | Losses: {losses} | Win%: {wins/(wins+losses)*100:.1f}%")

# Profit factor
sw, sl = cur.execute("SELECT SUM(CASE WHEN actual_return>0 THEN actual_return END), SUM(CASE WHEN actual_return<=0 THEN actual_return END) FROM predictions WHERE outcome_date IS NOT NULL").fetchone()
print(f"Sum Win: +{sw:.2f} | Sum Loss: {sl:.2f} | PF: {sw/abs(sl):.3f}")

# Avg/median
wins_list = [r[0] for r in cur.execute("SELECT actual_return FROM predictions WHERE outcome_date IS NOT NULL AND actual_return>0").fetchall()]
loss_list = [r[0] for r in cur.execute("SELECT actual_return FROM predictions WHERE outcome_date IS NOT NULL AND actual_return<=0").fetchall()]
print(f"\nWins: avg=+{statistics.mean(wins_list):.2f}% median=+{statistics.median(wins_list):.2f}% max=+{max(wins_list):.2f}%")
print(f"Losses: avg={statistics.mean(loss_list):.2f}% median={statistics.median(loss_list):.2f}% min={min(loss_list):.2f}%")

# By signal type
print("\n=== By signal type ===")
for row in cur.execute("SELECT signal, COUNT(*), SUM(CASE WHEN actual_return>0 THEN 1 ELSE 0 END), ROUND(AVG(actual_return),3) FROM predictions WHERE outcome_date IS NOT NULL GROUP BY signal ORDER BY 2 DESC").fetchall():
    sig, cnt, w, avg = row
    wp = (w/cnt*100) if cnt else 0
    print(f"  {sig}: total={cnt} wins={w} win%={wp:.1f}% avg_ret={avg}%")

# By persona
print("\n=== By persona ===")
for row in cur.execute("SELECT persona, COUNT(*), SUM(CASE WHEN actual_return>0 THEN 1 ELSE 0 END), ROUND(AVG(actual_return),3), ROUND(AVG(CASE WHEN actual_return>0 THEN actual_return END),3), ROUND(AVG(CASE WHEN actual_return<=0 THEN actual_return END),3) FROM predictions WHERE outcome_date IS NOT NULL GROUP BY persona ORDER BY 2 DESC").fetchall():
    p, cnt, w, avg, aw, al = row
    wp = (w/cnt*100) if cnt else 0
    print(f"  {p}: total={cnt} wins={w} win%={wp:.1f}% avg={avg}% avgWin={aw}% avgLoss={al}%")

# By exit_type
print("\n=== By exit_type ===")
for row in cur.execute("SELECT exit_type, COUNT(*), SUM(CASE WHEN actual_return>0 THEN 1 ELSE 0 END), ROUND(AVG(actual_return),3) FROM predictions WHERE outcome_date IS NOT NULL GROUP BY exit_type ORDER BY 2 DESC").fetchall():
    e, cnt, w, avg = row
    wp = (w/cnt*100) if cnt else 0
    print(f"  {e}: total={cnt} wins={w} win%={wp:.1f}% avg={avg}%")

# By market
print("\n=== By market ===")
for row in cur.execute("SELECT market, COUNT(*), SUM(CASE WHEN actual_return>0 THEN 1 ELSE 0 END), ROUND(AVG(actual_return),3) FROM predictions WHERE outcome_date IS NOT NULL GROUP BY market ORDER BY 2 DESC").fetchall():
    m, cnt, w, avg = row
    wp = (w/cnt*100) if cnt else 0
    print(f"  {m}: total={cnt} wins={w} win%={wp:.1f}% avg={avg}%")

# Status distribution
print("\n=== Status distribution ===")
for row in cur.execute("SELECT status, COUNT(*) FROM predictions GROUP BY status ORDER BY 2 DESC").fetchall():
    print(f"  {row[0]}: {row[1]}")

# Date range
mind, maxd = cur.execute("SELECT MIN(prediction_date), MAX(prediction_date) FROM predictions").fetchone()
print(f"\nDate range: {mind} → {maxd}")

# Monthly breakdown
print("\n=== Monthly closed performance ===")
for row in cur.execute("""
    SELECT substr(prediction_date, 1, 7) as month,
           COUNT(*) as total,
           SUM(CASE WHEN actual_return>0 THEN 1 ELSE 0 END) as wins,
           ROUND(AVG(actual_return),3) as avg_ret,
           ROUND(SUM(CASE WHEN actual_return>0 THEN actual_return END) / ABS(SUM(CASE WHEN actual_return<=0 THEN actual_return END)), 3) as pf
    FROM predictions
    WHERE outcome_date IS NOT NULL
    GROUP BY month
    ORDER BY month
""").fetchall():
    m, t, w, avg, pf = row
    wp = (w/t*100) if t else 0
    print(f"  {m}: total={t} wins={w} win%={wp:.1f}% avg={avg}% PF={pf}")

# Top 10 winning tickers
print("\n=== Top 10 winning tickers (by avg return, min 3 predictions) ===")
for row in cur.execute("""
    SELECT ticker, COUNT(*) as n, ROUND(AVG(actual_return),2) as avg, ROUND(SUM(actual_return),2) as total
    FROM predictions
    WHERE outcome_date IS NOT NULL AND actual_return > 0
    GROUP BY ticker
    HAVING n >= 3
    ORDER BY avg DESC
    LIMIT 10
""").fetchall():
    print(f"  {row[0]}: n={row[1]} avg=+{row[2]}% total=+{row[3]}%")

# Top 10 losing tickers
print("\n=== Top 10 losing tickers (by avg return, min 3 predictions) ===")
for row in cur.execute("""
    SELECT ticker, COUNT(*) as n, ROUND(AVG(actual_return),2) as avg, ROUND(SUM(actual_return),2) as total
    FROM predictions
    WHERE outcome_date IS NOT NULL AND actual_return < 0
    GROUP BY ticker
    HAVING n >= 3
    ORDER BY avg ASC
    LIMIT 10
""").fetchall():
    print(f"  {row[0]}: n={row[1]} avg={row[2]}% total={row[3]}%")

# Holding days analysis
print("\n=== Holding days distribution ===")
hd = cur.execute("SELECT holding_days FROM predictions WHERE outcome_date IS NOT NULL AND holding_days IS NOT NULL").fetchall()
if hd:
    days = [r[0] for r in hd]
    print(f"  avg={statistics.mean(days):.1f} median={statistics.median(days)} min={min(days)} max={max(days)}")

# Risk/reward analysis
print("\n=== Risk/Reward stats (where risk_reward > 0) ===")
rr = cur.execute("SELECT risk_reward FROM predictions WHERE risk_reward IS NOT NULL AND risk_reward > 0").fetchall()
if rr:
    rrs = [r[0] for r in rr]
    print(f"  count={len(rrs)} avg={statistics.mean(rrs):.2f} median={statistics.median(rrs):.2f}")

# T2 status
t2_set = cur.execute("SELECT COUNT(*) FROM predictions WHERE target_price_2 > 0").fetchone()[0]
print(f"\n=== T2 (target_price_2) status: {t2_set} predictions have T2 set ===")

# Explosive labels
print("\n=== Explosive labels ===")
for row in cur.execute("SELECT explosive_label, COUNT(*) FROM predictions GROUP BY explosive_label ORDER BY 2 DESC").fetchall():
    print(f"  {row[0]}: {row[1]}")

con.close()
