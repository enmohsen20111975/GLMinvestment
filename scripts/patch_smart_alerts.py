#!/usr/bin/env python3
"""Fix /api/finance/smart-alerts — add price fallback + skip zero-price stocks"""

filepath = '/home/z/my-project/src/app/api/finance/smart-alerts/route.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add fallback chain for current_price (previous_close → skip if 0)
# Replace the price lookup + loop start
old_block = """    const priceMap = new Map(stockPrices.map(s => [s.ticker, s]));
    
    // Generate smart alerts
    const alerts: SmartAlert[] = [];
    
    for (const stock of portfolioStocks) {
      const price = priceMap.get(stock.ticker);
      if (!price) continue;
      
      const currentPrice = price.current_price || 0;
      const buyPrice = stock.avg_buy_price || 0;
      const profitLossPercent = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;"""

new_block = """    const priceMap = new Map(stockPrices.map(s => [s.ticker, s]));
    
    // Generate smart alerts
    const alerts: SmartAlert[] = [];
    
    // FIX (DEAL-ADVISOR-002, 2026-08-19): previously used current_price directly
    // from stocks table. If current_price was 0/null (stale feed), the code
    // computed profitLossPercent = -100% and fired fake "stop loss" / "support
    // near" alerts with currentPrice=0, targetPrice=support, distance=100%.
    // Now: (1) fallback to previous_close if current_price is 0, (2) skip the
    // stock entirely if no valid price exists (so the UI shows NO fake alert
    // instead of a misleading zero alert).
    for (const stock of portfolioStocks) {
      const price = priceMap.get(stock.ticker);
      if (!price) continue;
      
      // Fallback chain: current_price → previous_close → skip
      let currentPrice = Number(price.current_price) || 0;
      if (currentPrice <= 0) {
        currentPrice = Number(price.previous_close) || 0;
      }
      // SKIP stocks with no valid price — do NOT generate fake zero alerts
      if (currentPrice <= 0) continue;
      
      const buyPrice = stock.avg_buy_price || 0;
      const profitLossPercent = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;"""

if old_block in content:
    content = content.replace(old_block, new_block, 1)
    print('PRICE FALLBACK: replaced')
else:
    print('PRICE FALLBACK: NOT FOUND')
    exit(1)

# 2. Filter unrealistic support/resistance (like deal-advisor does)
# Add a filter after computing currentPrice: if support < currentPrice * 0.5 or
# resistance < currentPrice * 0.5, treat as null
old_support = """      // 3. Support Near Alert
      if (price.support && currentPrice <= price.support * 1.05) {"""

new_support = """      // FIX (DEAL-ADVISOR-002): filter unrealistic support/resistance values.
      // stocks.db.support can be stale (e.g. support=18.3 while currentPrice=138.84).
      // If support/resistance is more than 30% below current price, treat as null.
      const validSupport = (price.support && price.support > currentPrice * 0.7) ? price.support : null;
      const validResistance = (price.resistance && price.resistance > currentPrice * 0.7 && price.resistance > currentPrice) ? price.resistance : null;
      
      // 3. Support Near Alert
      if (validSupport && currentPrice <= validSupport * 1.05) {"""

if old_support in content:
    content = content.replace(old_support, new_support, 1)
    print('SUPPORT FILTER: replaced')
else:
    print('SUPPORT FILTER: NOT FOUND')
    exit(1)

# 3. Update resistance references
old_res = """      // 4. Resistance Near Alert
      if (price.resistance && currentPrice >= price.resistance * 0.95) {"""

new_res = """      // 4. Resistance Near Alert
      if (validResistance && currentPrice >= validResistance * 0.95) {"""

if old_res in content:
    content = content.replace(old_res, new_res, 1)
    print('RESISTANCE FILTER 1: replaced')

# 4. Update breakout reference
old_break = """      // 6. Breakout Alert (above resistance)
      if (price.resistance && currentPrice > price.resistance) {"""

new_break = """      // 6. Breakout Alert (above resistance)
      if (validResistance && currentPrice > validResistance) {"""

if old_break in content:
    content = content.replace(old_break, new_break, 1)
    print('BREAKOUT FILTER: replaced')

# 5. Update breakdown reference
old_breakdown = """      // 7. Breakdown Alert (below support)
      if (price.support && currentPrice < price.support * 0.98) {"""

new_breakdown = """      // 7. Breakdown Alert (below support)
      if (validSupport && currentPrice < validSupport * 0.98) {"""

if old_breakdown in content:
    content = content.replace(old_breakdown, new_breakdown, 1)
    print('BREAKDOWN FILTER: replaced')

# 6. Update the support/resistance references inside alert bodies (toFixed calls)
# Replace `price.support.toFixed(2)` → `validSupport.toFixed(2)`
content = content.replace("price.support.toFixed(2)", "validSupport.toFixed(2)")
content = content.replace("price.resistance.toFixed(2)", "validResistance.toFixed(2)")
content = content.replace("targetPrice: price.support", "targetPrice: validSupport")
content = content.replace("targetPrice: price.resistance", "targetPrice: validResistance")
# Update the distancePercent calculations
content = content.replace(
    "((currentPrice - price.support) / price.support) * 100",
    "((currentPrice - validSupport) / validSupport) * 100"
)
content = content.replace(
    "((price.resistance - currentPrice) / currentPrice) * 100",
    "((validResistance - currentPrice) / currentPrice) * 100"
)
content = content.replace(
    "((currentPrice - price.resistance) / price.resistance) * 100",
    "((currentPrice - validResistance) / validResistance) * 100"
)
content = content.replace(
    "((price.support - currentPrice) / price.support) * 100",
    "((validSupport - currentPrice) / validSupport) * 100"
)
# Update the breakdownPercent reference
content = content.replace("(price.support - currentPrice) / price.support", "(validSupport - currentPrice) / validSupport")
print('BODY REFERENCES: updated')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print('SAVED')
