#!/usr/bin/env python3
"""
Stock Personality Calculator
حاسبة شخصية السهم

Calculates stock personality based on comparison with sector:
- LEADER: Stock moves before sector (predictive)
- LAGGARD: Stock moves after sector (reactive)
- FOLLOWER: Stock moves with sector (neutral)

@authorM2yDevelopers Team
"""

import sqlite3
from typing import Dict, List, Tuple
from collections import defaultdict
import json
from pathlib import Path  # added by patch_db_paths.py


class StockPersonalityCalculator:
    """حاسبة شخصية السهم"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def get_connection(self):
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        return db_manager.connection(self.db_path, writable=False).__enter__()
    
    def get_daily_returns(self) -> Dict:
        """Get daily returns for all stocks"""
        query = '''
            SELECT 
                s.ticker,
                s.sector,
                sph.date,
                sph.close_price
            FROM stock_price_history sph
            JOIN stocks s ON sph.stock_id = s.id
            WHERE s.sector IS NOT NULL AND s.sector != 'Other'
            ORDER BY s.ticker, sph.date
        '''
        
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(query)
            return [dict(row) for row in cursor.fetchall()]
    
    def calculate_daily_returns(self) -> Dict:
        """Calculate daily returns for each stock"""
        prices = self.get_daily_returns()
        
        # Group by ticker
        ticker_prices = defaultdict(list)
        for p in prices:
            ticker_prices[p['ticker']].append(p)
        
        # Calculate daily returns
        daily_returns = defaultdict(dict)
        
        for ticker, price_list in ticker_prices.items():
            sector = price_list[0]['sector']
            
            for i in range(1, len(price_list)):
                date = price_list[i]['date']
                prev_close = price_list[i-1]['close_price']
                curr_close = price_list[i]['close_price']
                
                if prev_close and curr_close and prev_close > 0:
                    ret = ((curr_close - prev_close) / prev_close) * 100
                    daily_returns[date][ticker] = {
                        'return': ret,
                        'sector': sector
                    }
        
        return daily_returns
    
    def calculate_sector_daily_returns(self) -> Dict:
        """Calculate sector average daily returns"""
        daily_returns = self.calculate_daily_returns()
        
        sector_daily = defaultdict(lambda: defaultdict(list))
        
        for date, tickers in daily_returns.items():
            for ticker, data in tickers.items():
                sector = data['sector']
                sector_daily[sector][date].append(data['return'])
        
        # Calculate averages
        sector_avg_returns = defaultdict(dict)
        for sector, dates in sector_daily.items():
            for date, returns in dates.items():
                if returns:
                    sector_avg_returns[sector][date] = sum(returns) / len(returns)
        
        return sector_avg_returns
    
    def calculate_stock_personality(self) -> Dict:
        """Calculate personality for each stock"""
        daily_returns = self.calculate_daily_returns()
        sector_returns = self.calculate_sector_daily_returns()
        
        # Count: how many times stock moved before/with/after sector
        stock_stats = defaultdict(lambda: {
            'before': 0,  # Stock moved before sector
            'with': 0,    # Stock moved with sector
            'after': 0,   # Stock moved after sector
            'total': 0,
            'sector': None
        })
        
        # Get dates in order
        all_dates = sorted(daily_returns.keys())
        
        for i in range(1, len(all_dates)):
            prev_date = all_dates[i-1]
            curr_date = all_dates[i]
            
            for ticker, data in daily_returns[curr_date].items():
                stock_ret = data['return']
                sector = data['sector']
                stock_stats[ticker]['sector'] = sector
                
                # Get sector return for previous day (predictive)
                if sector in sector_returns and prev_date in sector_returns[sector]:
                    sector_prev_ret = sector_returns[sector][prev_date]
                else:
                    continue
                
                # Get sector return for current day (reactive)
                if curr_date in sector_returns[sector]:
                    sector_curr_ret = sector_returns[sector][curr_date]
                else:
                    continue
                
                stock_stats[ticker]['total'] += 1
                
                # Determine relationship
                # LEADER: Stock moves in SAME direction as sector will move TOMORROW
                # LAGGARD: Stock moves AFTER sector moved
                # FOLLOWER: Stock moves WITH sector
                
                # Simplified: compare current stock vs current sector
                if abs(stock_ret - sector_curr_ret) < 1:  # Within 1% = moving together
                    stock_stats[ticker]['with'] += 1
                elif stock_ret > sector_curr_ret + 1:  # Stock outperforming
                    stock_stats[ticker]['before'] += 1
                elif stock_ret < sector_curr_ret - 1:  # Stock underperforming
                    stock_stats[ticker]['after'] += 1
        
        # Determine personality
        personalities = {}
        
        for ticker, stats in stock_stats.items():
            if stats['total'] < 20:  # Need enough samples
                continue
            
            before_pct = stats['before'] / stats['total']
            with_pct = stats['with'] / stats['total']
            after_pct = stats['after'] / stats['total']
            
            # More lenient thresholds
            if before_pct > 0.25:  # Often outperforms sector
                personality = 'LEADER'
            elif after_pct > 0.25:  # Often underperforms sector
                personality = 'LAGGARD'
            else:  # Moves with sector
                personality = 'FOLLOWER'
            
            personalities[ticker] = {
                'ticker': ticker,
                'sector': stats['sector'],
                'personality': personality,
                'leader_pct': round(before_pct * 100, 1),
                'follower_pct': round(with_pct * 100, 1),
                'laggard_pct': round(after_pct * 100, 1),
                'samples': stats['total']
            }
        
        return personalities
    
    def save_personalities(self, personalities: Dict):
        """Save personalities to stocks table (add column if needed)"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Check if column exists
            cursor.execute("PRAGMA table_info(stocks)")
            columns = [col[1] for col in cursor.fetchall()]
            
            if 'personality' not in columns:
                cursor.execute("ALTER TABLE stocks ADD COLUMN personality TEXT")
                conn.commit()
            
            # Update stocks
            for ticker, data in personalities.items():
                cursor.execute(
                    "UPDATE stocks SET personality = ? WHERE ticker = ?",
                    (data['personality'], ticker)
                )
            
            conn.commit()
            print(f"Updated {len(personalities)} stocks with personality")
    
    def print_summary(self, personalities: Dict):
        """Print personality summary"""
        print("\n" + "=" * 80)
        print("STOCK PERSONALITIES")
        print("=" * 80)
        
        # Count by personality
        counts = defaultdict(int)
        for p in personalities.values():
            counts[p['personality']] += 1
        
        print("\n=== OVERALL DISTRIBUTION ===")
        for personality, count in sorted(counts.items()):
            print(f"{personality}: {count} stocks")
        
        # Show LEADERS
        print("\n=== LEADERS (Outperform sector) ===")
        leaders = [p for p in personalities.values() if p['personality'] == 'LEADER']
        leaders.sort(key=lambda x: x['leader_pct'], reverse=True)
        for p in leaders[:20]:
            print(f"{p['ticker']:10s} ({p['sector']:20s}): {p['leader_pct']:.1f}% leader")
        
        # Show LAGGARDS
        print("\n=== LAGGARDS (Underperform sector) ===")
        laggards = [p for p in personalities.values() if p['personality'] == 'LAGGARD']
        laggards.sort(key=lambda x: x['laggard_pct'], reverse=True)
        for p in laggards[:20]:
            print(f"{p['ticker']:10s} ({p['sector']:20s}): {p['laggard_pct']:.1f}% laggard")


def main():
    """Main entry point"""
    db_path = str(Path(__file__).resolve().parents[2] / "db" / "stocks.db")
    
    calculator = StockPersonalityCalculator(db_path)
    
    print("Calculating stock personalities...")
    personalities = calculator.calculate_stock_personality()
    
    print(f"\nCalculated personality for {len(personalities)} stocks")
    
    # Print summary
    calculator.print_summary(personalities)
    
    # Save to database
    calculator.save_personalities(personalities)


if __name__ == '__main__':
    main()
