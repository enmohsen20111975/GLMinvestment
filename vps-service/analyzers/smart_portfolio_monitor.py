#!/usr/bin/env python3
"""
Smart Portfolio Monitor — المراقب الذكي للمحفظة
==================================================
يراقب أسهم العميل كل 5 دقائق ويعطي:
1. إشارات بيع/شراء لكل سهم في المحفظة
2. اقتراحات متوسط (averaging)
3. تنبيهات وقائية (stop loss)
4. توصيات توزيع الثروة

يقرأ من stocks.db (portfolio_assets + user_stock_watchlists)
ويحلل باستخدام PredictionOptimizer + الأسعار الحية.
"""

from __future__ import annotations

import os
import sys
import sqlite3
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')


@dataclass
class StockSignal:
    """إشارة ذكية لسهم واحد في محفظة العميل."""
    ticker: str
    name: str
    current_price: float
    purchase_price: float
    quantity: float
    invested: float
    current_value: float
    pnl: float
    pnl_pct: float
    
    # التحليل
    action: str  # 'HOLD' / 'SELL' / 'BUY_MORE' / 'STOP_LOSS' / 'TAKE_PROFIT'
    action_ar: str  # بالعربي
    reason: str
    confidence: int  # 0-100
    
    # المؤشرات
    rsi: float = 0
    change_pct: float = 0
    signal: str = ''
    trend: str = ''
    
    # اقتراح المتوسط
    average_suggestion: Optional[Dict] = None
    
    # مستويات الحماية
    stop_loss: float = 0
    take_profit: float = 0
    
    # التنبيهات
    alerts: List[str] = field(default_factory=list)


@dataclass
class WealthPlan:
    """خطة توزيع الثروة."""
    total_wealth: float
    total_invested: float
    total_current_value: float
    
    # التوزيع المثالي المقترح
    recommended_allocation: Dict[str, float] = field(default_factory=dict)
    
    # التوزيع الحالي
    current_allocation: Dict[str, float] = field(default_factory=dict)
    
    # الفجوة
    gaps: List[str] = field(default_factory=list)
    
    # التوصيات
    recommendations: List[str] = field(default_factory=list)


class SmartPortfolioMonitor:
    """المراقب الذكي لمحفظة العميل."""

    def __init__(self):
        self.stocks_db = STOCKS_DB
        self.ph_db = PRICE_HISTORY_DB

    def analyze_user_portfolio(self, user_id: str) -> Dict:
        """تحليل شامل لمحفظة العميل."""
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.stocks_db, writable=False).__enter__()
        conn.row_factory = sqlite3.Row

        # 1. جلب أصول المحفظة
        assets = conn.execute("""
            SELECT p.*, s.ticker, s.name as stock_name, s.current_price as live_price,
                   s.change_percent, s.rsi, s.signal, s.trend, s.sector
            FROM portfolio_assets p
            LEFT JOIN stocks s ON p.stock_ticker = s.ticker
            WHERE p.user_id = ? AND p.type = 'stock'
            ORDER BY p.total_invested DESC
        """, (user_id,)).fetchall()

        # 2. جلب قائمة المراقبة
        watchlist = conn.execute("""
            SELECT w.*, s.ticker, s.name, s.current_price, s.change_percent,
                   s.rsi, s.signal, s.trend, s.sector, s.pe_ratio
            FROM user_stock_watchlists w
            LEFT JOIN stocks s ON w.stock_id = s.id
            WHERE w.user_id = ?
        """, (user_id,)).fetchall()

        conn.close()

        # 3. تحليل كل سهم
        stock_signals = []
        for asset in assets:
            if asset['live_price'] and asset['live_price'] > 0:
                signal = self._analyze_stock(asset)
                stock_signals.append(signal)

        # 4. تحليل قائمة المراقبة
        watchlist_signals = []
        for w in watchlist:
            if w['current_price'] and w['current_price'] > 0:
                signal = self._analyze_watchlist_item(w)
                watchlist_signals.append(signal)

        # 5. خطة توزيع الثروة
        wealth_plan = self._create_wealth_plan(assets, stock_signals)

        # 6. ملخص
        total_invested = sum(s.invested for s in stock_signals)
        total_current = sum(s.current_value for s in stock_signals)
        total_pnl = total_current - total_invested

        sell_signals = [s for s in stock_signals if s.action in ('SELL', 'STOP_LOSS', 'TAKE_PROFIT')]
        buy_signals = [s for s in stock_signals if s.action == 'BUY_MORE']
        hold_signals = [s for s in stock_signals if s.action == 'HOLD']

        return {
            'user_id': user_id,
            'timestamp': datetime.now().isoformat(),
            'summary': {
                'total_assets': len(stock_signals),
                'total_invested': round(total_invested, 2),
                'total_current_value': round(total_current, 2),
                'total_pnl': round(total_pnl, 2),
                'total_pnl_pct': round(total_pnl / total_invested * 100, 2) if total_invested > 0 else 0,
                'sell_count': len(sell_signals),
                'buy_more_count': len(buy_signals),
                'hold_count': len(hold_signals),
                'watchlist_count': len(watchlist_signals),
            },
            'stock_signals': [self._signal_to_dict(s) for s in stock_signals],
            'watchlist_signals': [self._signal_to_dict(s) for s in watchlist_signals],
            'wealth_plan': self._wealth_plan_to_dict(wealth_plan),
            'alerts': self._collect_all_alerts(stock_signals),
        }

    def _analyze_stock(self, asset) -> StockSignal:
        """تحليل سهم واحد في المحفظة."""
        ticker = asset['ticker'] or asset['stock_ticker'] or ''
        name = asset['stock_name'] or asset['name'] or ticker
        current_price = asset['live_price'] or 0
        purchase_price = asset['avg_buy_price'] or asset['purchase_price'] or 0
        quantity = asset['quantity'] or 0
        invested = asset['total_invested'] or (purchase_price * quantity)
        current_value = current_price * quantity
        pnl = current_value - invested
        pnl_pct = (pnl / invested * 100) if invested > 0 else 0

        rsi = asset['rsi'] or 50
        change_pct = asset['change_percent'] or 0
        signal = asset['signal'] or ''
        trend = asset['trend'] or ''

        # تحديد الإجراء
        action = 'HOLD'
        action_ar = 'احتفظ'
        reason = ''
        confidence = 50
        alerts = []

        # stop loss — خسارة كبيرة
        stop_loss_price = purchase_price * 0.92  # -8%
        take_profit_price = purchase_price * 1.15  # +15%

        if pnl_pct <= -8:
            action = 'STOP_LOSS'
            action_ar = '🚨 إيقاف خسارة — بِع فوراً'
            reason = f'خسارة {pnl_pct:.1f}% — تجاوز حد الإيقاف (-8%)'
            confidence = 90
            alerts.append(f'🚨 {ticker}: خسارة {pnl_pct:.1f}% — يُنصح بالبيع فوراً')
        elif pnl_pct >= 15:
            action = 'TAKE_PROFIT'
            action_ar = '✅ جني أرباح — بِع جزء'
            reason = f'ربح {pnl_pct:.1f}% — حقق الهدف (+15%)'
            confidence = 85
            alerts.append(f'✅ {ticker}: ربح {pnl_pct:.1f}% — جني أرباح موصى به')
        elif rsi > 70 and pnl_pct > 5:
            action = 'SELL'
            action_ar = '📤 بيع — تشبع شرائي'
            reason = f'RSI={rsi:.0f} (تشبع شرائي) + ربح {pnl_pct:.1f}%'
            confidence = 75
            alerts.append(f'📤 {ticker}: RSI مرتفع ({rsi:.0f}) — فرصة بيع')
        elif rsi < 30 and pnl_pct < -3:
            action = 'BUY_MORE'
            action_ar = '📥 شراء أكثر — تشبع بيعي'
            reason = f'RSI={rsi:.0f} (تشبع بيعي) — فرصة متوسط'
            confidence = 70
            alerts.append(f'📥 {ticker}: RSI منخفض ({rsi:.0f}) — فرصة متوسط')
            # اقتراح المتوسط
            avg_price = (purchase_price + current_price) / 2
            avg_suggestion = {
                'current_avg': purchase_price,
                'new_avg_if_buy': round(avg_price, 2),
                'shares_to_buy': quantity,  # نفس الكمية لمتوسط
                'cost_to_average': round(current_price * quantity, 2),
                'potential_reduction': round((purchase_price - avg_price), 2),
            }
        elif change_pct < -5:
            action = 'HOLD'
            action_ar = '⏸️ احتفظ — انخفاض مؤقت'
            reason = f'انخفاض {change_pct:.1f}% اليوم — انتظر الارتداد'
            confidence = 60
            if pnl_pct < -5:
                alerts.append(f'⚠️ {ticker}: انخفاض {change_pct:.1f}% اليوم (خسارة كلية {pnl_pct:.1f}%)')
        elif change_pct > 5 and pnl_pct > 0:
            action = 'HOLD'
            action_ar = '💪 احتفظ — صعود قوي'
            reason = f'صعود {change_pct:.1f}% اليوم — استمر'
            confidence = 65

        return StockSignal(
            ticker=ticker,
            name=name,
            current_price=current_price,
            purchase_price=purchase_price,
            quantity=quantity,
            invested=invested,
            current_value=current_value,
            pnl=pnl,
            pnl_pct=pnl_pct,
            action=action,
            action_ar=action_ar,
            reason=reason,
            confidence=confidence,
            rsi=rsi,
            change_pct=change_pct,
            signal=signal,
            trend=trend,
            stop_loss=stop_loss_price,
            take_profit=take_profit_price,
            alerts=alerts,
        )

    def _analyze_watchlist_item(self, item) -> StockSignal:
        """تحليل سهم في قائمة المراقبة."""
        ticker = item['ticker'] or ''
        name = item['name'] or ticker
        current_price = item['current_price'] or 0
        rsi = item['rsi'] or 50
        change_pct = item['change_percent'] or 0
        signal = item['signal'] or ''
        trend = item['trend'] or ''

        action = 'HOLD'
        action_ar = 'راقب'
        reason = ''
        confidence = 50
        alerts = []

        if rsi < 30:
            action = 'BUY'
            action_ar = '🎯 فرصة شراء — تشبع بيعي'
            reason = f'RSI={rsi:.0f} — سعر منخفض'
            confidence = 75
            alerts.append(f'🎯 {ticker}: فرصة شراء (RSI={rsi:.0f})')
        elif rsi > 70:
            action = 'WATCH_SELL'
            action_ar = '👀 راقب للبيع — تشبع شرائي'
            reason = f'RSI={rsi:.0f} — قد ينخفض'
            confidence = 65
        elif change_pct > 5:
            action = 'WATCH'
            action_ar = '📈 صعود قوي'
            reason = f'+{change_pct:.1f}% اليوم'
            confidence = 55
        elif change_pct < -5:
            action = 'WATCH_BUY'
            action_ar = '📉 انخفاض — راقب للشراء'
            reason = f'{change_pct:.1f}% اليوم — قد يكون فرصة'
            confidence = 60

        return StockSignal(
            ticker=ticker,
            name=name,
            current_price=current_price,
            purchase_price=0,
            quantity=0,
            invested=0,
            current_value=0,
            pnl=0,
            pnl_pct=0,
            action=action,
            action_ar=action_ar,
            reason=reason,
            confidence=confidence,
            rsi=rsi,
            change_pct=change_pct,
            signal=signal,
            trend=trend,
            alerts=alerts,
        )

    def _create_wealth_plan(self, assets, stock_signals) -> WealthPlan:
        """إنشاء خطة توزيع الثروة."""
        total_invested = sum(s.invested for s in stock_signals)
        total_current = sum(s.current_value for s in stock_signals)

        # التوزيع الحالي حسب نوع الأصل
        current_alloc = {}
        for asset in assets:
            atype = asset['type'] or 'other'
            current_alloc[atype] = current_alloc.get(atype, 0) + (asset['total_invested'] or 0)

        # التوزيع المثالي (نموذج محافظ للسوق المصري)
        recommended = {
            'stock': 40,      # 40% أسهم
            'gold': 25,       # 25% ذهب (ملاذ آمن)
            'bank': 20,       # 20% شهادات بنكية
            'cash': 10,       # 10% كاش (سيولة)
            'crypto': 5,      # 5% كريبتو (مخاطرة عالية)
        }

        # حساب الفجوات
        gaps = []
        recommendations = []

        for asset_type, ideal_pct in recommended.items():
            current_pct = (current_alloc.get(asset_type, 0) / total_invested * 100) if total_invested > 0 else 0
            diff = ideal_pct - current_pct
            if abs(diff) > 10:
                if diff > 0:
                    gaps.append(f'نقص في {asset_type}: {current_pct:.0f}% (المثالي {ideal_pct}%)')
                    recommendations.append(f'📥 زِد استثمارك في {asset_type} بمقدار {diff:.0f}%')
                else:
                    gaps.append(f'زيادة في {asset_type}: {current_pct:.0f}% (المثالي {ideal_pct}%)')
                    recommendations.append(f'📤 قلّل استثمارك في {asset_type} بمقدار {abs(diff):.0f}%')

        # توصيات إضافية ذكية
        losing_stocks = [s for s in stock_signals if s.pnl_pct < -10]
        winning_stocks = [s for s in stock_signals if s.pnl_pct > 15]

        if losing_stocks:
            recommendations.append(f'🚨 لديك {len(losing_stocks)} سهم بخسارة >10% — راجع بيعها')
        if winning_stocks:
            recommendations.append(f'✅ لديك {len(winning_stocks)} سهم بربح >15% — فكر في جني أرباح')

        # تنويع القطاعات
        sectors = {}
        for s in stock_signals:
            if s.ticker:
                sec = s.trend or 'غير محدد'
                sectors[sec] = sectors.get(sec, 0) + s.invested
        if len(sectors) < 3 and total_invested > 100000:
            recommendations.append('⚠️ محفظتك غير متنوعة — وزّع استثماراتك على 3+ قطاعات')

        return WealthPlan(
            total_wealth=total_current,
            total_invested=total_invested,
            total_current_value=total_current,
            recommended_allocation=recommended,
            current_allocation={k: round(v / total_invested * 100, 1) if total_invested > 0 else 0 for k, v in current_alloc.items()},
            gaps=gaps,
            recommendations=recommendations,
        )

    def _collect_all_alerts(self, signals: List[StockSignal]) -> List[str]:
        """جمع كل التنبيهات."""
        alerts = []
        for s in signals:
            alerts.extend(s.alerts)
        return alerts

    def _signal_to_dict(self, s: StockSignal) -> Dict:
        return {
            'ticker': s.ticker,
            'name': s.name,
            'current_price': s.current_price,
            'purchase_price': s.purchase_price,
            'quantity': s.quantity,
            'invested': round(s.invested, 2),
            'current_value': round(s.current_value, 2),
            'pnl': round(s.pnl, 2),
            'pnl_pct': round(s.pnl_pct, 2),
            'action': s.action,
            'action_ar': s.action_ar,
            'reason': s.reason,
            'confidence': s.confidence,
            'rsi': s.rsi,
            'change_pct': s.change_pct,
            'signal': s.signal,
            'trend': s.trend,
            'stop_loss': round(s.stop_loss, 2),
            'take_profit': round(s.take_profit, 2),
            'alerts': s.alerts,
        }

    def _wealth_plan_to_dict(self, p: WealthPlan) -> Dict:
        return {
            'total_wealth': round(p.total_wealth, 2),
            'total_invested': round(p.total_invested, 2),
            'total_current_value': round(p.total_current_value, 2),
            'recommended_allocation': p.recommended_allocation,
            'current_allocation': p.current_allocation,
            'gaps': p.gaps,
            'recommendations': p.recommendations,
        }


if __name__ == '__main__':
    monitor = SmartPortfolioMonitor()
    
    # Test with real user
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    user = conn.execute("SELECT DISTINCT user_id FROM portfolio_assets LIMIT 1").fetchone()
    conn.close()
    
    if user:
        result = monitor.analyze_user_portfolio(user[0])
        print(f"\n{'='*60}")
        print(f"📊 Smart Portfolio Monitor")
        print(f"{'='*60}")
        print(f"\nSummary:")
        s = result['summary']
        print(f"  Assets: {s['total_assets']}")
        print(f"  Invested: {s['total_invested']:,}")
        print(f"  Current: {s['total_current_value']:,}")
        print(f"  PnL: {s['total_pnl']:,} ({s['total_pnl_pct']}%)")
        print(f"  Sell: {s['sell_count']} | Buy More: {s['buy_more_count']} | Hold: {s['hold_count']}")
        
        print(f"\nStock Signals:")
        for sig in result['stock_signals']:
            print(f"  {sig['ticker']}: {sig['action_ar']} (PnL: {sig['pnl_pct']}%, RSI: {sig['rsi']})")
        
        print(f"\nAlerts:")
        for a in result['alerts']:
            print(f"  {a}")
        
        print(f"\nWealth Plan:")
        wp = result['wealth_plan']
        print(f"  Recommended: {wp['recommended_allocation']}")
        print(f"  Current: {wp['current_allocation']}")
        print(f"  Gaps: {wp['gaps']}")
        print(f"  Recommendations:")
        for r in wp['recommendations']:
            print(f"    {r}")
    else:
        print("No users found")
