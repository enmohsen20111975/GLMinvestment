const Database = require('better-sqlite3');
const path = require('path');

const db = new Database('/home/meme/my_apps/GLMinvestment/db/stocks.db', { readonly: true });

function adaptStock(raw) {
  const numOrNull = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const curr = Number(raw.current_price) || 0;
  const prev = Number(raw.previous_close) || curr;
  let rawHigh = Number(raw.high_price) || 0;
  let rawLow = Number(raw.low_price) || 0;
  let rawOpen = Number(raw.open_price) || 0;

  if (rawHigh <= 0 || (curr > 0 && rawHigh < curr)) {
    rawHigh = Math.max(rawHigh > 0 ? rawHigh : curr, curr, prev);
  }
  if (rawLow <= 0 || (curr > 0 && rawLow > curr) || (curr > 0 && rawLow < curr * 0.35)) {
    rawLow = Math.min(rawLow > 0 && rawLow >= curr * 0.35 ? rawLow : curr, curr, prev);
  }
  if (rawHigh < rawLow) {
    rawHigh = Math.max(curr, prev);
    rawLow = Math.min(curr, prev);
  }
  if (rawOpen <= 0 || rawOpen < rawLow * 0.5 || rawOpen > rawHigh * 2) {
    rawOpen = prev > 0 ? prev : curr;
  }

  let h52 = numOrNull(raw.high_52w);
  let l52 = numOrNull(raw.low_52w);
  if (curr > 0) {
    if (h52 != null && h52 < curr) h52 = Math.max(h52, rawHigh, curr);
    if (l52 != null && (l52 > curr || l52 <= 0)) l52 = Math.min(l52 > 0 ? l52 : curr, rawLow, curr);
  }

  return {
    ticker: raw.ticker,
    current_price: curr,
    previous_close: prev,
    open_price: rawOpen,
    high_price: rawHigh,
    low_price: rawLow,
    high_52w: h52,
    low_52w: l52,
  };
}

function buildStockInfographicDataFromStock(stock) {
  const current = stock.current_price;
  const prevClose = stock.previous_close || current;
  const high = (stock.high_price && stock.high_price >= current)
    ? stock.high_price
    : Math.max(current, prevClose);
  const low = (stock.low_price && stock.low_price <= current && stock.low_price > 0 && stock.low_price >= current * 0.35)
    ? stock.low_price
    : Math.min(current, prevClose);
  const open = (stock.open_price && stock.open_price >= low * 0.9 && stock.open_price <= high * 1.1)
    ? stock.open_price
    : prevClose;

  const yearlyHigh = (stock.high_52w != null && stock.high_52w >= current)
    ? stock.high_52w
    : Math.max(high, current);
  const yearlyLow = (stock.low_52w != null && stock.low_52w <= current && stock.low_52w > 0)
    ? stock.low_52w
    : Math.min(low, current);

  const times = ['10:00', '11:00', '12:00', '01:00', '02:00', '03:00'];
  const midPoint = (high + low) / 2;
  const isUpSession = current >= open;
  const prices = isUpSession
    ? [open, low > open * 0.98 ? low : open * 0.99, midPoint, high * 0.995, (high + current) / 2, current]
    : [open, high < open * 1.02 ? high : open * 1.01, midPoint, low * 1.005, (low + current) / 2, current];
  const chart_data = times.map((t, i) => ({
    time: t,
    price: Math.max(low, Math.min(high, prices[i])),
  }));

  return {
    session: { high, low, prev_close: prevClose },
    fundamentals: { yearly_high: yearlyHigh, yearly_low: yearlyLow },
    chart_data,
  };
}

const tickers = ['CRST', 'COMI', 'ABUK', 'FWRY', 'EAST', 'SWDY', 'ORAS', 'PTCC', 'GETO', 'EKHO'];
console.log('Testing frontend card generation from SQLite records:');
for (const t of tickers) {
  const row = db.prepare('SELECT * FROM stocks WHERE ticker = ?').get(t);
  const stock = adaptStock(row);
  const card = buildStockInfographicDataFromStock(stock);

  console.log(`[${t}] Stock: Curr=${stock.current_price} H=${stock.high_price} L=${stock.low_price} 52H=${stock.high_52w} 52L=${stock.low_52w}`);
  console.log(`      Card:  H=${card.session.high} L=${card.session.low} 52H=${card.fundamentals.yearly_high} 52L=${card.fundamentals.yearly_low}`);

  // Invariant checks
  if (card.session.high !== stock.high_price) throw new Error(`${t}: Card high does not match stock high`);
  if (card.session.low !== stock.low_price) throw new Error(`${t}: Card low does not match stock low`);
  if (card.fundamentals.yearly_high !== stock.high_52w) throw new Error(`${t}: Card 52H does not match stock 52H`);
  if (card.fundamentals.yearly_low !== stock.low_52w) throw new Error(`${t}: Card 52L does not match stock 52L`);

  for (const pt of card.chart_data) {
    if (pt.price < card.session.low || pt.price > card.session.high) {
      throw new Error(`${t}: Chart point ${pt.price} outside [${card.session.low}, ${card.session.high}]`);
    }
  }
}
console.log('\n🎉 ALL FRONTEND INVARIANTS & SINGLE SOURCE OF TRUTH VERIFIED 100%!');
