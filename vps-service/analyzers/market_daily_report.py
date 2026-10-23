#!/usr/bin/env python3
"""
Market Daily Report Generator
==============================
مولد التقرير اليومي/الأسبوعي للسوق

يقوم بإنشاء تقرير شامل يتضمن:
- ملخص أداء السوق اليوم/الأسبوع
- أفضل وأسهم الأسوأ أداءً
- القطاعات الفائزة والخاسرة
- التوقعات للجلسة القادمة
- تحليل فني وأساسي

Author: GLMinvestment Platform
"""

import os
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pathlib import Path
import json


# ============================================================================
# MARKET CONFIGURATION
# ============================================================================

MARKET_CONFIG = {
    'EGX': {
        'name_ar': 'البورصة المصرية',
        'working_days': [6, 0, 1, 2, 3],  # الأحد للخميس (Python: 6=Sunday)
        'timezone': 'Africa/Cairo',
        'open_hour': 10,
        'close_hour': 14,
    },
    'TADAWUL': {
        'name_ar': 'السوق السعودي',
        'working_days': [6, 0, 1, 2, 3],  # الأحد للخميس
        'timezone': 'Asia/Riyadh',
        'open_hour': 10,
        'close_hour': 15,
    },
    'KSE': {
        'name_ar': 'بورصة الكويت',
        'working_days': [6, 0, 1, 2, 3],  # الأحد للخميس
        'timezone': 'Asia/Kuwait',
        'open_hour': 9,
        'close_hour': 13,
    },
    'QSE': {
        'name_ar': 'بورصة قطر',
        'working_days': [6, 0, 1, 2, 3],  # الأحد للخميس
        'timezone': 'Asia/Qatar',
        'open_hour': 9,
        'close_hour': 13,
    },
    'US': {
        'name_ar': 'البورصة الأمريكية',
        'working_days': [0, 1, 2, 3, 4],  # الإثنين للجمعة (Mon-Fri ET)
        'timezone': 'America/New_York',
        'open_hour': 9,   # 9:30 AM ET → 14:30 UTC
        'close_hour': 16, # 4:00 PM ET → 21:00 UTC
    },
    'CRYPTO': {
        'name_ar': 'سوق العملات الرقمية',
        'working_days': [0, 1, 2, 3, 4, 5, 6],  # 24/7
        'timezone': 'UTC',
        'open_hour': 0,
        'close_hour': 23,
    },
    'GOLD': {
        'name_ar': 'سوق الذهب',
        'working_days': [0, 1, 2, 3, 4, 5, 6],  # 24/7
        'timezone': 'UTC',
        'open_hour': 0,
        'close_hour': 23,
    },
}

DAY_NAMES_AR = {
    0: 'الإثنين',
    1: 'الثلاثاء',
    2: 'الأربعاء',
    3: 'الخميس',
    4: 'الجمعة',
    5: 'السبت',
    6: 'الأحد'
}


# ============================================================================
# MARKET DAILY REPORT CLASS
# ============================================================================

class MarketDailyReport:
    """
    مولد التقارير اليومية والأسبوعية للسوق
    """
    
    def __init__(self, db_path: str = None):
        if db_path is None:
            project_root = Path(__file__).parent.parent.parent
            db_path = str(project_root / 'db' / 'stocks.db')
        self.db_path = db_path
        
        # Path to predictions.db
        self.predictions_db = str(Path(__file__).parent.parent.parent / 'db' / 'predictions.db')
    
    def _get_db_connection(self):
        """Get database connection"""
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        return db_manager.connection(self.db_path, writable=False).__enter__()
    
    def _get_predictions_connection(self):
        """Get predictions database connection"""
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        return db_manager.connection(self.predictions_db, writable=False).__enter__()
    
    def get_market_status(self, market: str = 'EGX') -> Dict:
        """
        تحديد حالة السوق الحالية
        
        Returns:
            Dict: حالة السوق
        """
        now = datetime.now()
        weekday = now.weekday()
        hour = now.hour
        
        config = MARKET_CONFIG.get(market, MARKET_CONFIG['EGX'])
        
        is_working_day = weekday in config['working_days']
        is_market_hours = config['open_hour'] <= hour < config['close_hour']
        
        # تحديد الجلسة القادمة
        if not is_working_day or (is_working_day and hour >= config['close_hour']):
            # البحث عن يوم العمل القادم
            next_working_day = now + timedelta(days=1)
            while next_working_day.weekday() not in config['working_days']:
                next_working_day += timedelta(days=1)
            next_session = next_working_day.strftime('%Y-%m-%d')
            next_session_day = DAY_NAMES_AR[next_working_day.weekday()]
        else:
            next_session = now.strftime('%Y-%m-%d')
            next_session_day = DAY_NAMES_AR[weekday]
        
        return {
            'current_date': now.strftime('%Y-%m-%d'),
            'current_day': DAY_NAMES_AR.get(weekday, 'غير معروف'),
            'current_time': now.strftime('%H:%M'),
            'is_working_day': is_working_day,
            'is_market_hours': is_market_hours,
            'market_status': 'مفتوح' if is_working_day and is_market_hours else 'مغلق',
            'next_session_date': next_session,
            'next_session_day': next_session_day,
            'market_name': config['name_ar']
        }
    
    def get_top_gainers(self, market: str = 'EGX', limit: int = 10) -> List[Dict]:
        """
        أفضل الأسهم ارتفاعاً
        """
        conn = self._get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Get stocks with performance data
            cursor.execute('''
                SELECT ticker, name, change_percent
                FROM stocks
                WHERE (ticker LIKE ? OR market = ?) AND change_percent > 0
                ORDER BY change_percent DESC
                LIMIT ?
            ''', (f'%{market}%', market, limit))
            
            rows = cursor.fetchall()
            
            gainers = []
            for row in rows:
                gainers.append({
                    'symbol': row[0],
                    'name': row[1],
                    'change_percent': row[2] or 0
                })
            
            return gainers
            
        except Exception as e:
            print(f"Error getting top gainers: {e}")
            return []
        finally:
            conn.close()
    
    def get_top_losers(self, market: str = 'EGX', limit: int = 10) -> List[Dict]:
        """
        أسوأ الأسهم انخفاضاً
        """
        conn = self._get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT ticker, name, change_percent
                FROM stocks
                WHERE (ticker LIKE ? OR market = ?) AND change_percent < 0
                ORDER BY change_percent ASC
                LIMIT ?
            ''', (f'%{market}%', market, limit))
            
            rows = cursor.fetchall()
            
            losers = []
            for row in rows:
                losers.append({
                    'symbol': row[0],
                    'name': row[1],
                    'change_percent': row[2] or 0
                })
            
            return losers
            
        except Exception as e:
            print(f"Error getting top losers: {e}")
            return []
        finally:
            conn.close()
    
    def get_buy_recommendations(self, market: str = 'EGX', limit: int = 5) -> List[Dict]:
        """
        توقعات الشراء للجلسة القادمة
        KILL-MAESTRO (2026-08-31): اقرأ من predictions (V40.2) مش aiPrediction (Maestro)
        + ممنوع SELL في EGX (Rule 19)
        """
        conn = self._get_predictions_connection()
        cursor = conn.cursor()

        try:
            # KILL-MAESTRO: اقرأ من predictions (V40.2) مش aiPrediction
            # بيع = جنى أرباح / خروج (مش بيع على المكشوف)
            # بس اللي عندهم entry_price > 0 (مش 0.00)
            cursor.execute('''
                SELECT ticker, signal, entry_price,
                       target_price, stop_loss, target_price_2,
                       master_score, confidence, prediction_date,
                       persona, evidence_count, notes
                FROM predictions
                WHERE market = ?
                  AND signal IN ('BUY', 'STRONG_BUY', 'STRONG BUY')
                  AND status = 'active'
                  AND outcome_date IS NULL
                  AND entry_price > 0
                  AND target_price > 0
                  AND stop_loss > 0
                ORDER BY prediction_date DESC, master_score DESC, evidence_count DESC
                LIMIT ?
            ''', (market, limit * 4))

            rows = cursor.fetchall()

            # Helper for arabic names
            try:
                from egx_arabic_lookup import get_arabic_stock_name
            except Exception:
                def get_arabic_stock_name(t, fb=None): return fb or t

            seen_tickers = set()
            recommendations = []
            for row in rows:
                tk = row[0]
                if tk in seen_tickers:
                    continue
                seen_tickers.add(tk)

                name_ar = get_arabic_stock_name(tk, tk)
                recommendations.append({
                    'symbol': tk,
                    'ticker': tk,
                    'name': name_ar,
                    'name_ar': name_ar,
                    'signal': row[1],
                    'entry_price': float(row[2] or 0),
                    'target_price': float(row[3] or 0),
                    'stop_loss': float(row[4] or 0),
                    'target_price_2': float(row[5] or 0) if row[5] else float(row[3] or 0) * 1.05,
                    'score': float(row[6] or 0),
                    'confidence': float(row[7] or row[6] or 80),
                    'date': row[8],
                    'persona': row[9] or 'balanced',
                    'evidence_count': row[10] or 3,
                    'notes': row[11] or '',
                })
                if len(recommendations) >= limit:
                    break

            return recommendations

        except Exception as e:
            print(f"Error getting buy recommendations: {e}")
            # Fallback: جرّب aiPrediction (لو predictions table مش موجود)
            try:
                cursor.execute('''
                    SELECT stock_symbol, stock_name_ar, signal_type, entry_price,
                           target_price, stop_loss, maestro_score, confidence,
                           prediction_date
                    FROM aiPrediction
                    WHERE (market = ? OR stock_symbol LIKE ?)
                      AND signal_type IN ('BUY', 'STRONG_BUY')
                      AND status = 'PENDING'
                      AND entry_price > 0
                      AND target_price > 0
                      AND stop_loss > 0
                    ORDER BY maestro_score DESC, confidence DESC
                    LIMIT ?
                ''', (market, f'%{market}%', limit))
                rows = cursor.fetchall()
                recommendations = []
                for row in rows:
                    recommendations.append({
                        'symbol': row[0], 'name': row[1], 'signal': row[2],
                        'entry_price': row[3], 'target_price': row[4],
                        'stop_loss': row[5], 'score': row[6],
                        'confidence': row[7], 'date': row[8],
                    })
                return recommendations
            except:
                return []
        finally:
            conn.close()
    
    def get_sector_performance(self, market: str = 'EGX') -> List[Dict]:
        """
        أداء القطاعات
        """
        # This would need sector data - returning placeholder for now
        return [
            {'sector': 'البنوك', 'change': 1.5, 'stocks_count': 15},
            {'sector': 'الاتصالات', 'change': -0.8, 'stocks_count': 5},
            {'sector': 'العقارات', 'change': 2.1, 'stocks_count': 20},
            {'sector': 'الطاقة', 'change': -1.2, 'stocks_count': 8},
        ]
    
    def get_market_summary(self, market: str = 'EGX') -> Dict:
        """
        ملخص السوق
        """
        conn = self._get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Get total stocks count
            cursor.execute('''
                SELECT COUNT(*) FROM stocks 
                WHERE ticker LIKE ? OR market = ?
            ''', (f'%{market}%', market))
            total_stocks = cursor.fetchone()[0] or 0
            
            # Get stocks with positive change
            cursor.execute('''
                SELECT COUNT(*) FROM stocks
                WHERE (ticker LIKE ? OR market = ?)
                  AND change_percent > 0
            ''', (f'%{market}%', market))
            gainers_count = cursor.fetchone()[0] or 0
            
            # Get stocks with negative change
            cursor.execute('''
                SELECT COUNT(*) FROM stocks
                WHERE (ticker LIKE ? OR market = ?)
                  AND change_percent < 0
            ''', (f'%{market}%', market))
            losers_count = cursor.fetchone()[0] or 0
            
            return {
                'total_stocks': total_stocks,
                'gainers': gainers_count,
                'losers': losers_count,
                'unchanged': total_stocks - gainers_count - losers_count,
                'market_breadth': round((gainers_count / total_stocks * 100) if total_stocks > 0 else 0, 1)
            }
            
        except Exception as e:
            print(f"Error getting market summary: {e}")
            return {
                'total_stocks': 0,
                'gainers': 0,
                'losers': 0,
                'unchanged': 0,
                'market_breadth': 0
            }
        finally:
            conn.close()
    
    def generate_daily_report(self, market: str = 'EGX', for_next_session: bool = True) -> Dict:
        """
        توليد التقرير اليومي
        
        Args:
            market: السوق
            for_next_session: إذا True، التقرير للجلسة القادمة
            
        Returns:
            Dict: التقرير الكامل
        """
        market_status = self.get_market_status(market)
        
        report = {
            'report_type': 'daily',
            'market': market,
            'market_name': market_status['market_name'],
            'generated_at': datetime.now().isoformat(),
            'market_status': market_status,
            'target_session': {
                'date': market_status['next_session_date'] if for_next_session else market_status['current_date'],
                'day': market_status['next_session_day'] if for_next_session else market_status['current_day']
            },
            'summary': self.get_market_summary(market),
            'top_gainers': self.get_top_gainers(market, 5),
            'top_losers': self.get_top_losers(market, 5),
            'sector_performance': self.get_sector_performance(market),
            'recommendations': self.get_buy_recommendations(market, 5),
            'social_share': {
                'text': 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈',
                'links': {
                    'website': 'https://invist.m2y.net',
                    'android_app': 'https://play.google.com/store/apps/details?id=com.egx.investment',
                    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
                    'telegram': 'https://t.me/Arabian_investment_guide'
                }
            }
        }
        
        # إضافة نص التقرير
        report['report_text'] = self._generate_report_text(report)
        
        return report
    
    def generate_weekly_report(self, market: str = 'EGX') -> Dict:
        """
        توليد التقرير الأسبوعي
        """
        market_status = self.get_market_status(market)
        
        # Calculate week start and end
        today = datetime.now()
        week_start = today - timedelta(days=today.weekday())  # Monday
        week_end = week_start + timedelta(days=6)  # Sunday
        
        report = {
            'report_type': 'weekly',
            'market': market,
            'market_name': market_status['market_name'],
            'generated_at': datetime.now().isoformat(),
            'week_range': {
                'start': week_start.strftime('%Y-%m-%d'),
                'end': week_end.strftime('%Y-%m-%d')
            },
            'summary': self.get_market_summary(market),
            'top_gainers': self.get_top_gainers(market, 10),
            'top_losers': self.get_top_losers(market, 10),
            'sector_performance': self.get_sector_performance(market),
            'recommendations': self.get_buy_recommendations(market, 10),
            'social_share': {
                'text': 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈',
                'links': {
                    'website': 'https://invist.m2y.net',
                    'android_app': 'https://play.google.com/store/apps/details?id=com.egx.investment',
                    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
                    'telegram': 'https://t.me/Arabian_investment_guide'
                }
            }
        }
        
        report['report_text'] = self._generate_weekly_report_text(report)
        
        return report
    
    def _generate_report_text(self, report: Dict) -> str:
        """
        توليد نص التقرير للنشر
        """
        market_status = report['market_status']
        target = report['target_session']
        summary = report['summary']
        
        # Header
        text = f"""
📊 تقرير سوق {report['market_name']}
{'='*40}

📅 جلسة {target['day']} - {target['date']}

"""
        
        # Market summary
        text += f"""
📈 ملخص السوق:
• إجمالي الأسهم: {summary['total_stocks']}
• ارتفعت: {summary['gainers']} 🟢
• انخفضت: {summary['losers']} 🔴
• ثابتة: {summary['unchanged']} ⚪
• اتساع السوق: {summary['market_breadth']}%

"""
        
        # Top gainers
        if report['top_gainers']:
            text += "\n🟢 أعلى الأسهم ارتفاعاً:\n"
            for i, stock in enumerate(report['top_gainers'][:5], 1):
                text += f"  {i}. {stock['symbol']} ({stock['name'] or '-'}): +{stock['change_percent']:.1f}%\n"
        
        # Top losers
        if report['top_losers']:
            text += "\n🔴 أعلى الأسهم انخفاضاً:\n"
            for i, stock in enumerate(report['top_losers'][:5], 1):
                text += f"  {i}. {stock['symbol']} ({stock['name'] or '-'}): {stock['change_percent']:.1f}%\n"
        
        # Recommendations
        if report['recommendations']:
            text += "\n🎯 توقعات للجلسة القادمة:\n"
            for i, rec in enumerate(report['recommendations'][:5], 1):
                text += f"  {i}. {rec['symbol']} - {rec['name'] or '-'}\n"
                text += f"     📌 دخول: {rec['entry_price']:.2f} | 🎯 هدف: {rec['target_price']:.2f} | 🛑 وقف: {rec['stop_loss']:.2f}\n"
        
        # Footer
        text += f"""
{'='*40}

💡 نصيحة اليوم: التداول بلا مشاعر يعني الالتزام بالخطة والتوقف عند الحدود.

{'='*40}

انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈

🔗 روابطنا الرسمية:
🌐 الموقع الإلكتروني: https://invist.m2y.net
📱 تطبيق أندرويد: https://play.google.com/store/apps/details?id=com.egx.investment
📘 فيسبوك: https://www.facebook.com/profile.php?id=61590600300048
✈️ تليجرام: https://t.me/Arabian_investment_guide
"""
        
        return text
    
    def _generate_weekly_report_text(self, report: Dict) -> str:
        """
        توليد نص التقرير الأسبوعي
        """
        week = report['week_range']
        summary = report['summary']
        
        text = f"""
📊 التقرير الأسبوعي لسوق {report['market_name']}
{'='*50}

📅 الفترة: {week['start']} إلى {week['end']}

📈 ملخص الأسبوع:
• إجمالي الأسهم: {summary['total_stocks']}
• ارتفعت: {summary['gainers']} 🟢
• انخفضت: {summary['losers']} 🔴
• اتساع السوق: {summary['market_breadth']}%

"""
        
        # Top performers
        if report['top_gainers']:
            text += "\n🟢 أفضل 10 أسهم هذا الأسبوع:\n"
            for i, stock in enumerate(report['top_gainers'], 1):
                text += f"  {i}. {stock['symbol']}: +{stock['change_percent']:.1f}%\n"
        
        # Recommendations for next week
        if report['recommendations']:
            text += "\n🎯 توقعات للأسبوع القادم:\n"
            for i, rec in enumerate(report['recommendations'][:10], 1):
                text += f"  {i}. {rec['symbol']} - Score: {rec['score']}\n"
        
        # Footer
        text += f"""
{'='*50}

انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈

🔗 روابطنا الرسمية:
🌐 https://invist.m2y.net
📱 https://play.google.com/store/apps/details?id=com.egx.investment
📘 https://www.facebook.com/profile.php?id=61590600300048
✈️ https://t.me/Arabian_investment_guide
"""
        
        return text

    def generate_monthly_report(self, market: str = 'EGX') -> Dict:
        """
        توليد التقرير الشهري
        يجمع أداء السوق خلال آخر 30 يوم + التوقعات + إحصائيات الـ predictions
        """
        market_status = self.get_market_status(market)

        # Calculate month start and end
        today = datetime.now()
        # First day of current month
        month_start = today.replace(day=1)
        # First day of next month
        if today.month == 12:
            month_end = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            month_end = today.replace(month=today.month + 1, day=1) - timedelta(days=1)

        # محاولة حساب الأداء الشهري من price_history
        monthly_performance = self._get_monthly_performance(market, month_start, month_end)

        # محاولة جلب إحصائيات الـ predictions للشهر
        predictions_stats = self._get_monthly_predictions_stats(market, month_start, month_end)

        report = {
            'report_type': 'monthly',
            'market': market,
            'market_name': market_status['market_name'],
            'generated_at': datetime.now().isoformat(),
            'month_range': {
                'start': month_start.strftime('%Y-%m-%d'),
                'end': month_end.strftime('%Y-%m-%d'),
                'month_name_ar': self._get_month_name_ar(month_start.month),
                'year': month_start.year,
            },
            'summary': self.get_market_summary(market),
            'monthly_performance': monthly_performance,
            'predictions_stats': predictions_stats,
            'top_gainers': self.get_top_gainers(market, 10),
            'top_losers': self.get_top_losers(market, 10),
            'sector_performance': self.get_sector_performance(market),
            'recommendations': self.get_buy_recommendations(market, 10),
            'social_share': {
                'text': 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈',
                'links': {
                    'website': 'https://invist.m2y.net',
                    'android_app': 'https://play.google.com/store/apps/details?id=com.egx.investment',
                    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
                    'telegram': 'https://t.me/Arabian_investment_guide'
                }
            }
        }

        report['report_text'] = self._generate_monthly_report_text(report)

        return report

    def _get_month_name_ar(self, month_num: int) -> str:
        """اسم الشهر بالعربي"""
        months = [
            'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
            'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
        ]
        return months[month_num - 1] if 1 <= month_num <= 12 else ''

    def _get_monthly_performance(self, market: str, month_start: datetime, month_end: datetime) -> Dict:
        """حساب الأداء الشهري من price_history"""
        result = {
            'best_performers': [],
            'worst_performers': [],
            'avg_change': 0,
            'positive_days': 0,
            'negative_days': 0,
        }
        try:
            from pathlib import Path
            db_path = str(Path(__file__).parent.parent.parent / 'db' / 'price_history.db')
            if not os.path.exists(db_path):
                return result

            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(db_path, writable=False).__enter__()
            conn.row_factory = sqlite3.Row

            # جلب أداء كل سهم خلال الشهر
            start_str = month_start.strftime('%Y-%m-%d')
            end_str = month_end.strftime('%Y-%m-%d')

            cursor = conn.cursor()
            try:
                cursor.execute('''
                    SELECT ticker,
                           MIN(close) as min_price,
                           MAX(close) as max_price,
                           (SELECT close FROM price_history p2
                            WHERE p2.ticker = p1.ticker AND p2.date <= ?
                            ORDER BY p2.date DESC LIMIT 1) as end_price,
                           (SELECT close FROM price_history p3
                            WHERE p3.ticker = p1.ticker AND p3.date >= ?
                            ORDER BY p3.date ASC LIMIT 1) as start_price
                    FROM price_history p1
                    WHERE date BETWEEN ? AND ?
                    GROUP BY ticker
                    HAVING start_price IS NOT NULL AND end_price IS NOT NULL
                    ORDER BY ((end_price - start_price) / start_price * 100) DESC
                    LIMIT 10
                ''', (end_str, start_str, start_str, end_str))

                for row in cursor.fetchall():
                    start_price = float(row['start_price'] or 0)
                    end_price = float(row['end_price'] or 0)
                    if start_price > 0:
                        change_pct = ((end_price - start_price) / start_price) * 100
                        result['best_performers'].append({
                            'ticker': row['ticker'],
                            'start_price': start_price,
                            'end_price': end_price,
                            'change_percent': round(change_pct, 2),
                        })

                # أسوأ 10
                cursor.execute('''
                    SELECT ticker,
                           (SELECT close FROM price_history p2
                            WHERE p2.ticker = p1.ticker AND p2.date <= ?
                            ORDER BY p2.date DESC LIMIT 1) as end_price,
                           (SELECT close FROM price_history p3
                            WHERE p3.ticker = p1.ticker AND p3.date >= ?
                            ORDER BY p3.date ASC LIMIT 1) as start_price
                    FROM price_history p1
                    WHERE date BETWEEN ? AND ?
                    GROUP BY ticker
                    HAVING start_price IS NOT NULL AND end_price IS NOT NULL
                    ORDER BY ((end_price - start_price) / start_price * 100) ASC
                    LIMIT 10
                ''', (end_str, start_str, start_str, end_str))

                for row in cursor.fetchall():
                    start_price = float(row['start_price'] or 0)
                    end_price = float(row['end_price'] or 0)
                    if start_price > 0:
                        change_pct = ((end_price - start_price) / start_price) * 100
                        result['worst_performers'].append({
                            'ticker': row['ticker'],
                            'start_price': start_price,
                            'end_price': end_price,
                            'change_percent': round(change_pct, 2),
                        })

                # متوسط التغيير
                if result['best_performers']:
                    avg = sum(s['change_percent'] for s in result['best_performers']) / len(result['best_performers'])
                    result['avg_change'] = round(avg, 2)

            except Exception as e:
                print(f"Monthly performance query error: {e}")

            conn.close()
        except Exception as e:
            print(f"Monthly performance error: {e}")

        return result

    def _get_monthly_predictions_stats(self, market: str, month_start: datetime, month_end: datetime) -> Dict:
        """إحصائيات الـ predictions للشهر"""
        result = {
            'total': 0,
            'successful': 0,
            'failed': 0,
            'success_rate': 0,
            'avg_return': 0,
        }
        try:
            from pathlib import Path
            db_path = str(Path(__file__).parent.parent.parent / 'db' / 'predictions.db')
            if not os.path.exists(db_path):
                return result

            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(db_path, writable=False).__enter__()
            cursor = conn.cursor()

            start_str = month_start.strftime('%Y-%m-%d')
            end_str = month_end.strftime('%Y-%m-%d')

            # محاولة جلب الـ predictions
            try:
                cursor.execute('''
                    SELECT COUNT(*) as total,
                           SUM(CASE WHEN status = 'TARGET_HIT' OR status = 'success' THEN 1 ELSE 0 END) as successful,
                           SUM(CASE WHEN status = 'STOPPED' OR status = 'failed' THEN 1 ELSE 0 END) as failed
                    FROM predictions
                    WHERE date(created_at) BETWEEN ? AND ?
                ''', (start_str, end_str))
                row = cursor.fetchone()
                if row:
                    result['total'] = row[0] or 0
                    result['successful'] = row[1] or 0
                    result['failed'] = row[2] or 0
                    if result['total'] > 0:
                        result['success_rate'] = round((result['successful'] / result['total']) * 100, 1)

                # متوسط العائد
                try:
                    cursor.execute('''
                        SELECT AVG(actual_return) FROM predictions
                        WHERE date(created_at) BETWEEN ? AND ?
                          AND actual_return IS NOT NULL
                    ''', (start_str, end_str))
                    avg = cursor.fetchone()[0]
                    if avg:
                        result['avg_return'] = round(float(avg), 2)
                except Exception:
                    pass

            except Exception as e:
                print(f"Predictions stats query error: {e}")

            conn.close()
        except Exception as e:
            print(f"Predictions stats error: {e}")

        return result

    def _generate_monthly_report_text(self, report: Dict) -> str:
        """توليد نص التقرير الشهري"""
        month = report['month_range']
        summary = report['summary']
        perf = report.get('monthly_performance', {})
        preds = report.get('predictions_stats', {})

        text = f"""
📊 التقرير الشهري لسوق {report['market_name']}
{'='*50}

📅 الشهر: {month['month_name_ar']} {month['year']}
📅 الفترة: {month['start']} إلى {month['end']}

📈 ملخص السوق:
• إجمالي الأسهم: {summary['total_stocks']}
• ارتفعت: {summary['gainers']} 🟢
• انخفضت: {summary['losers']} 🔴
• اتساع السوق: {summary['market_breadth']}%

"""

        # إحصائيات الـ predictions
        if preds.get('total', 0) > 0:
            text += f"""
🎯 أداء التوقعات هذا الشهر:
• إجمالي التوقعات: {preds['total']}
• ناجحة: {preds['successful']} ✅
• فاشلة: {preds['failed']} ❌
• نسبة النجاح: {preds['success_rate']}%
• متوسط العائد: {preds['avg_return']:+.2f}%

"""

        # أفضل الأسهم أداءً
        if perf.get('best_performers'):
            text += "🏆 أفضل 10 أسهم هذا الشهر:\n"
            for i, stock in enumerate(perf['best_performers'][:10], 1):
                text += f"  {i}. {stock['ticker']}: {stock['change_percent']:+.2f}%\n"

        # أسوأ الأسهم
        if perf.get('worst_performers'):
            text += "\n📉 أسوأ 10 أسهم هذا الشهر:\n"
            for i, stock in enumerate(perf['worst_performers'][:5], 1):
                text += f"  {i}. {stock['ticker']}: {stock['change_percent']:+.2f}%\n"

        # التوقعات للشهر القادم
        if report['recommendations']:
            text += "\n🎯 توقعات للشهر القادم:\n"
            for i, rec in enumerate(report['recommendations'][:10], 1):
                text += f"  {i}. {rec['symbol']} - Score: {rec['score']}\n"

        # Footer
        text += f"""
{'='*50}

انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈

🔗 روابطنا الرسمية:
🌐 https://invist.m2y.net
📱 https://play.google.com/store/apps/details?id=com.egx.investment
📘 https://www.facebook.com/profile.php?id=61590600300048
✈️ https://t.me/Arabian_investment_guide
"""

        return text

if __name__ == '__main__':
    reporter = MarketDailyReport()
    
    print("=" * 60)
    print("📊 اختبار نظام التقارير اليومية")
    print("=" * 60)
    
    # Test market status
    status = reporter.get_market_status('EGX')
    print(f"\n📅 حالة السوق:")
    print(f"  اليوم: {status['current_day']}")
    print(f"  التاريخ: {status['current_date']}")
    print(f"  حالة السوق: {status['market_status']}")
    print(f"  الجلسة القادمة: {status['next_session_day']} - {status['next_session_date']}")
    
    # Generate daily report
    print("\n" + "=" * 60)
    print("📰 توليد التقرير اليومي")
    print("=" * 60)
    
    report = reporter.generate_daily_report('EGX')
    print(report['report_text'])
