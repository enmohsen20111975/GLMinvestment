import sqlite3

conn_st = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/stocks.db')
r_oras = conn_st.execute("SELECT ticker, name, current_price, support, resistance, high_52w, low_52w, volume, pe_ratio, eps, market_cap FROM stocks WHERE ticker='ORAS'").fetchone()
print("ORAS in stocks.db:", r_oras)

conn_pr = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
p_oras = conn_pr.execute("SELECT ticker, signal, entry_price, target_price, stop_loss, risk_reward, confidence, notes FROM predictions WHERE ticker='ORAS' ORDER BY prediction_date DESC LIMIT 3").fetchall()
print("ORAS in predictions.db:", p_oras)
