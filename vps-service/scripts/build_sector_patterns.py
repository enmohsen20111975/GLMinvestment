#!/usr/bin/env python3
"""
Sector Patterns Builder
بناء أنماط القطاعات الشهرية

Analyzes historical data to find sector patterns:
- Monthly performance per sector
- Sector vs Market comparison
- Seasonal patterns (Ramadan, Q1, Q2, etc.)

@authorM2yDevelopers Team
"""

import sqlite3
from datetime import datetime
from typing import Dict, List, Tuple
from collections import defaultdict
import json
from pathlib import Path  # added by patch_db_paths.py


class SectorPatternsBuilder:
    """بناء أنماط القطاعات"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def get_connection(self):
        return sqlite3.connect(self.db_path)
    
    def get_monthly_prices(self) -> Dict:
        """Get first and last price of each stock for each month"""
        query = '''
            SELECT 
                s.ticker,
                s.sector,
                strftime('%Y-%m', sph.date) as month,
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
    
    def calculate_sector_monthly_returns(self) -> List[Dict]:
        """Calculate monthly returns for each sector"""
        prices = self.get_monthly_prices()
        
        # Group by ticker + month
        ticker_month_prices = defaultdict(list)
        for p in prices:
            key = (p['ticker'], p['month'])
            ticker_month_prices[key].append(p)
        
        # Calculate returns
        monthly_data = []
        
        for (ticker, month), price_list in ticker_month_prices.items():
            if len(price_list) < 2:
                continue
            
            sector = price_list[0]['sector']
            first_price = price_list[0]['close_price']
            last_price = price_list[-1]['close_price']
            
            if first_price and last_price and first_price > 0:
                ret = ((last_price - first_price) / first_price) * 100
                monthly_data.append({
                    'ticker': ticker,
                    'sector': sector,
                    'month': month,
                    'return': ret
                })
        
        return monthly_data
    
    def build_sector_patterns(self) -> Dict:
        """Build sector patterns from historical data"""
        monthly_data = self.calculate_sector_monthly_returns()
        
        # Group by sector + month
        sector_month_returns = defaultdict(list)
        for d in monthly_data:
            key = (d['sector'], d['month'])
            sector_month_returns[key].append(d['return'])
        
        # Calculate averages
        patterns = {}
        for (sector, month), returns in sector_month_returns.items():
            avg_return = sum(returns) / len(returns)
            positive_count = sum(1 for r in returns if r > 0)
            win_rate = positive_count / len(returns) if returns else 0
            
            patterns[(sector, month)] = {
                'sector': sector,
                'month': month,
                'avg_return': round(avg_return, 2),
                'win_rate': round(win_rate, 3),
                'sample_count': len(returns)
            }
        
        return patterns
    
    def build_monthly_patterns_by_sector(self) -> Dict:
        """Build patterns: for each sector, what's the typical performance in each month?"""
        monthly_data = self.calculate_sector_monthly_returns()
        
        # Group by sector + calendar month (1-12)
        sector_calendar_month = defaultdict(list)
        for d in monthly_data:
            # Extract calendar month from YYYY-MM
            cal_month = int(d['month'].split('-')[1])
            key = (d['sector'], cal_month)
            sector_calendar_month[key].append(d['return'])
        
        # Calculate averages
        patterns = {}
        for (sector, cal_month), returns in sector_calendar_month.items():
            if len(returns) < 3:  # Need at least 3 samples
                continue
            
            avg_return = sum(returns) / len(returns)
            positive_count = sum(1 for r in returns if r > 0)
            win_rate = positive_count / len(returns) if returns else 0
            
            patterns[(sector, cal_month)] = {
                'sector': sector,
                'month': cal_month,
                'month_name': datetime(2024, cal_month, 1).strftime('%B'),
                'avg_return': round(avg_return, 2),
                'win_rate': round(win_rate, 3),
                'sample_count': len(returns),
                'recommendation': 'favorable' if win_rate >= 0.6 and avg_return > 2 else 
                                  'unfavorable' if win_rate < 0.4 or avg_return < -2 else 'neutral'
            }
        
        return patterns
    
    def save_to_learned_lessons(self, patterns: Dict):
        """Save patterns to learned_lessons table"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Clear existing sector patterns
            cursor.execute("DELETE FROM learned_lessons WHERE lesson_type = 'sector_pattern'")
            
            for key, data in patterns.items():
                sector, month = key
                
                query = '''
                    INSERT INTO learned_lessons (
                        lesson_type, title, description, trigger_conditions, action,
                        confidence, occurrences, first_seen, last_seen, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'validated', datetime('now'))
                '''
                
                title = f"{sector} in {data['month_name']}"
                description = f"{sector} stocks typically {'rise' if data['avg_return'] > 0 else 'fall'} in {data['month_name']}: avg {data['avg_return']:+.1f}%, win rate {data['win_rate']*100:.0f}%"
                trigger_conditions = json.dumps({
                    'sector': sector,
                    'month': month,
                    'avg_return': data['avg_return'],
                    'win_rate': data['win_rate']
                })
                action = data['recommendation']
                confidence = data['win_rate']
                occurrences = data['sample_count']
                
                cursor.execute(query, (
                    'environmental', title, description, trigger_conditions, action,
                    confidence, occurrences
                ))
            
            conn.commit()
            print(f"Saved {len(patterns)} sector patterns to learned_lessons")
    
    def print_patterns_summary(self, patterns: Dict):
        """Print summary of sector patterns"""
        print("\n" + "=" * 80)
        print("SECTOR PATTERNS BY CALENDAR MONTH")
        print("=" * 80)
        
        # Group by sector
        by_sector = defaultdict(list)
        for key, data in patterns.items():
            by_sector[data['sector']].append(data)
        
        for sector in sorted(by_sector.keys()):
            months = sorted(by_sector[sector], key=lambda x: x['month'])
            
            print(f"\n{sector}:")
            for m in months:
                status_icon = "✅" if m['recommendation'] == 'favorable' else "❌" if m['recommendation'] == 'unfavorable' else "➖"
                print(f"  {m['month_name']:12s}: {m['avg_return']:+6.1f}% | WR {m['win_rate']*100:5.1f}% | {m['sample_count']:3d} samples {status_icon}")
    
    def get_best_months_for_sector(self, sector: str) -> List[Dict]:
        """Get best performing months for a sector"""
        patterns = self.build_monthly_patterns_by_sector()
        
        sector_patterns = [p for k, p in patterns.items() if p['sector'] == sector]
        sector_patterns.sort(key=lambda x: x['avg_return'], reverse=True)
        
        return sector_patterns[:3]  # Top 3 months


def main():
    """Main entry point"""
    db_path = str(Path(__file__).resolve().parents[2] / "db" / "stocks.db")
    
    builder = SectorPatternsBuilder(db_path)
    
    print("Building sector patterns...")
    patterns = builder.build_monthly_patterns_by_sector()
    
    print(f"\nFound {len(patterns)} sector-month patterns")
    
    # Print summary
    builder.print_patterns_summary(patterns)
    
    # Save to database
    builder.save_to_learned_lessons(patterns)
    
    # Example: Get best months for Banks
    print("\n" + "=" * 80)
    print("BEST MONTHS FOR KEY SECTORS")
    print("=" * 80)
    
    for sector in ['Banks', 'Financial Services', 'Real Estate', 'Healthcare', 'Basic Materials']:
        best = builder.get_best_months_for_sector(sector)
        if best:
            print(f"\n{sector} best months:")
            for m in best:
                print(f"  {m['month_name']}: {m['avg_return']:+.1f}%, WR {m['win_rate']*100:.0f}%")


if __name__ == '__main__':
    main()
