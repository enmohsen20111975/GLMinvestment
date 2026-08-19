#!/usr/bin/env python3
"""
Crypto Risk Manager
===================

إدارة المخاطر للعملات الرقمية - مختلفة عن EGX:
- Position Size: 3% (أصغر بسبب التقلب)
- Max Positions: 10 (أكثر)
- Stop Loss: 15-25% (أوسع)
- Target: 25-50% (أعلى)

@authorM2yDevelopers Team
@version 1.0.0
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime


# ============================================================================
# CONSTANTS - CRYPTO SPECIFIC RISK RULES
# ============================================================================

# Position Sizing (أصغر من EGX بسبب التقلب العالي)
MAX_POSITION_PCT = 3.0          # كل صفقة = 3% من رأس المال
MAX_TOTAL_EXPOSURE = 30.0       # 10 صفقات × 3% = 30%
MAX_POSITIONS = 10              # أقصى عدد صفقات مفتوحة
MAX_SECTOR_PCT = 9.0            # 3 coins × 3% = 9% per sector
MAX_SECTOR_POSITIONS = 3        # أقصى صفقات لكل قطاع

# Stop Loss & Target (أوسع من EGX)
CRYPTO_STOP_LOSS = {
    'bitcoin': 12.0,            # أقل تقلباً
    'ethereum': 15.0,
    'large_cap': 18.0,          # Top 20
    'mid_cap': 22.0,            # Top 50
    'small_cap': 25.0,          # Top 100
    'meme': 30.0                # High risk
}

CRYPTO_TARGET = {
    'bitcoin': 20.0,
    'ethereum': 25.0,
    'large_cap': 30.0,
    'mid_cap': 40.0,
    'small_cap': 50.0,
    'meme': 80.0
}

# Leverage - NO LEVERAGE ALLOWED
LEVERAGE_ALLOWED = False
MAX_LEVERAGE = 1.0              # 1x = spot only


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class CryptoPosition:
    """مركز عملة رقمية"""
    coin_id: str
    symbol: str
    entry_price: float
    current_price: float
    position_size_pct: float
    stop_loss: float
    target: float
    sector: str
    market_cap_rank: int
    timestamp: str


@dataclass
class CryptoRiskCheck:
    """نتيجة فحص المخاطر"""
    allowed: bool
    reason: str
    reason_ar: str
    position_size_pct: float
    stop_loss_pct: float
    target_pct: float
    warnings: List[str]


@dataclass
class CryptoPortfolioStatus:
    """حالة المحفظة الكريبتو"""
    total_positions: int
    total_exposure_pct: float
    sector_exposure: Dict[str, float]
    available_capital_pct: float
    can_open_new: bool
    warnings: List[str]


# ============================================================================
# CRYPTO RISK MANAGER
# ============================================================================

class CryptoRiskManager:
    """
    مدير مخاطر العملات الرقمية
    
    الفروقات عن EGX:
    - Position Size أصغر (3% بدل 5%)
    - Stop Loss أوسع (15-25% بدل 5-10%)
    - Target أعلى (25-50% بدل 8-15%)
    - قطاعات مختلفة (Layer1, DeFi, Meme, etc.)
    """
    
    # Crypto Sectors
    CRYPTO_SECTORS = {
        # Layer 1
        'bitcoin': 'Layer1',
        'ethereum': 'Layer1',
        'solana': 'Layer1',
        'cardano': 'Layer1',
        'avalanche-2': 'Layer1',
        'polkadot': 'Layer1',
        'chainlink': 'Layer1',
        'tron': 'Layer1',
        
        # DeFi
        'uniswap': 'DeFi',
        'aave': 'DeFi',
        'maker': 'DeFi',
        'compound': 'DeFi',
        'lido': 'DeFi',
        
        # Exchange
        'binancecoin': 'Exchange',
        'crypto-com-chain': 'Exchange',
        'okb': 'Exchange',
        
        # Meme
        'dogecoin': 'Meme',
        'shiba-inu': 'Meme',
        'pepe': 'Meme',
        'floki': 'Meme',
        
        # Gaming/Metaverse
        'axie-infinity': 'Gaming',
        'the-sandbox': 'Gaming',
        'decentraland': 'Gaming',
        'immutable-x': 'Gaming',
        
        # AI
        'render-token': 'AI',
        'fetch-ai': 'AI',
        'singularitynet': 'AI',
    }
    
    # Market Cap Categories
    LARGE_CAP_RANK = 10      # Top 10 = Large Cap
    MID_CAP_RANK = 50        # Top 50 = Mid Cap
    SMALL_CAP_RANK = 100     # Top 100 = Small Cap
    
    def __init__(self):
        self.positions: List[CryptoPosition] = []
        self.total_capital_pct = 100.0
    
    def get_sector(self, coin_id: str) -> str:
        """تحديد قطاع العملة"""
        return self.CRYPTO_SECTORS.get(coin_id, 'Other')
    
    def get_cap_category(self, market_cap_rank: int) -> str:
        """تحديد فئة حجم السوق"""
        if market_cap_rank <= 1:
            return 'bitcoin'
        elif market_cap_rank == 2:
            return 'ethereum'
        elif market_cap_rank <= self.LARGE_CAP_RANK:
            return 'large_cap'
        elif market_cap_rank <= self.MID_CAP_RANK:
            return 'mid_cap'
        elif market_cap_rank <= self.SMALL_CAP_RANK:
            return 'small_cap'
        else:
            return 'meme'  # Default to high risk
    
    def get_stop_loss_pct(self, coin_id: str, market_cap_rank: int) -> float:
        """حساب نسبة وقف الخسارة"""
        category = self.get_cap_category(market_cap_rank)
        return CRYPTO_STOP_LOSS.get(category, 20.0)
    
    def get_target_pct(self, coin_id: str, market_cap_rank: int) -> float:
        """حساب نسبة الهدف"""
        category = self.get_cap_category(market_cap_rank)
        return CRYPTO_TARGET.get(category, 30.0)
    
    def get_portfolio_status(self) -> CryptoPortfolioStatus:
        """حالة المحفظة الحالية"""
        total_exposure = sum(p.position_size_pct for p in self.positions)
        
        # Calculate sector exposure
        sector_exposure = {}
        for pos in self.positions:
            sector = pos.sector
            sector_exposure[sector] = sector_exposure.get(sector, 0) + pos.position_size_pct
        
        available_capital = self.total_capital_pct - total_exposure
        can_open_new = (
            len(self.positions) < MAX_POSITIONS and
            total_exposure < MAX_TOTAL_EXPOSURE
        )
        
        warnings = []
        if total_exposure > MAX_TOTAL_EXPOSURE * 0.8:
            warnings.append(f"⚠️ Total exposure at {total_exposure:.1f}% (max: {MAX_TOTAL_EXPOSURE}%)")
        
        for sector, exposure in sector_exposure.items():
            if exposure > MAX_SECTOR_PCT * 0.8:
                warnings.append(f"⚠️ {sector} sector at {exposure:.1f}% (max: {MAX_SECTOR_PCT}%)")
        
        return CryptoPortfolioStatus(
            total_positions=len(self.positions),
            total_exposure_pct=round(total_exposure, 2),
            sector_exposure=sector_exposure,
            available_capital_pct=round(available_capital, 2),
            can_open_new=can_open_new,
            warnings=warnings
        )
    
    def can_open_position(
        self,
        coin_id: str,
        symbol: str,
        market_cap_rank: int,
        proposed_size_pct: float = None
    ) -> CryptoRiskCheck:
        """
        هل يمكن فتح مركز جديد؟
        
        Args:
            coin_id: معرف العملة
            symbol: رمز العملة
            market_cap_rank: ترتيب حجم السوق
            proposed_size_pct: الحجم المقترح (اختياري)
        
        Returns:
            CryptoRiskCheck مع القرار
        """
        warnings = []
        sector = self.get_sector(coin_id)
        
        # 1. Check max positions
        if len(self.positions) >= MAX_POSITIONS:
            return CryptoRiskCheck(
                allowed=False,
                reason=f"Max positions ({MAX_POSITIONS}) reached",
                reason_ar=f"وصلت لحد أقصى صفقات ({MAX_POSITIONS})",
                position_size_pct=0,
                stop_loss_pct=0,
                target_pct=0,
                warnings=["Cannot open more positions"]
            )
        
        # 2. Check total exposure
        current_exposure = sum(p.position_size_pct for p in self.positions)
        if current_exposure >= MAX_TOTAL_EXPOSURE:
            return CryptoRiskCheck(
                allowed=False,
                reason=f"Max total exposure ({MAX_TOTAL_EXPOSURE}%) reached",
                reason_ar=f"وصلت لحد أقصى تعرض ({MAX_TOTAL_EXPOSURE}%)",
                position_size_pct=0,
                stop_loss_pct=0,
                target_pct=0,
                warnings=["Reduce existing positions first"]
            )
        
        # 3. Check sector exposure
        sector_positions = [p for p in self.positions if p.sector == sector]
        sector_exposure = sum(p.position_size_pct for p in sector_positions)
        
        if len(sector_positions) >= MAX_SECTOR_POSITIONS:
            return CryptoRiskCheck(
                allowed=False,
                reason=f"Max sector positions ({MAX_SECTOR_POSITIONS}) for {sector}",
                reason_ar=f"وصلت لحد أقصى صفقات القطاع ({MAX_SECTOR_POSITIONS}) لـ {sector}",
                position_size_pct=0,
                stop_loss_pct=0,
                target_pct=0,
                warnings=[f"Too many {sector} positions"]
            )
        
        if sector_exposure >= MAX_SECTOR_PCT:
            return CryptoRiskCheck(
                allowed=False,
                reason=f"Max sector exposure ({MAX_SECTOR_PCT}%) for {sector}",
                reason_ar=f"وصلت لحد أقصى تعرض القطاع ({MAX_SECTOR_PCT}%) لـ {sector}",
                position_size_pct=0,
                stop_loss_pct=0,
                target_pct=0,
                warnings=[f"Reduce {sector} exposure first"]
            )
        
        # 4. Calculate position size
        available_for_position = MAX_TOTAL_EXPOSURE - current_exposure
        available_for_sector = MAX_SECTOR_PCT - sector_exposure
        
        # Take minimum of all limits
        max_size = min(
            MAX_POSITION_PCT,
            available_for_position,
            available_for_sector
        )
        
        position_size = min(proposed_size_pct or MAX_POSITION_PCT, max_size)
        
        # 5. Get stop loss and target
        stop_loss_pct = self.get_stop_loss_pct(coin_id, market_cap_rank)
        target_pct = self.get_target_pct(coin_id, market_cap_rank)
        
        # 6. Add warnings
        if sector == 'Meme':
            warnings.append("⚠️ Meme coins are highly volatile - use extra caution")
        
        if market_cap_rank > 50:
            warnings.append(f"⚠️ Low market cap rank (#{market_cap_rank}) - higher risk")
        
        if position_size < MAX_POSITION_PCT:
            warnings.append(f"ℹ️ Position size reduced to {position_size:.1f}% due to limits")
        
        return CryptoRiskCheck(
            allowed=True,
            reason=f"Position allowed for {symbol}",
            reason_ar=f"المركز مسموح لـ {symbol}",
            position_size_pct=round(position_size, 2),
            stop_loss_pct=stop_loss_pct,
            target_pct=target_pct,
            warnings=warnings
        )
    
    def open_position(
        self,
        coin_id: str,
        symbol: str,
        entry_price: float,
        position_size_pct: float,
        market_cap_rank: int
    ) -> Optional[CryptoPosition]:
        """فتح مركز جديد"""
        
        check = self.can_open_position(coin_id, symbol, market_cap_rank, position_size_pct)
        
        if not check.allowed:
            print(f"Cannot open position: {check.reason_ar}")
            return None
        
        sector = self.get_sector(coin_id)
        stop_loss = entry_price * (1 - check.stop_loss_pct / 100)
        target = entry_price * (1 + check.target_pct / 100)
        
        position = CryptoPosition(
            coin_id=coin_id,
            symbol=symbol,
            entry_price=entry_price,
            current_price=entry_price,
            position_size_pct=check.position_size_pct,
            stop_loss=stop_loss,
            target=target,
            sector=sector,
            market_cap_rank=market_cap_rank,
            timestamp=datetime.now().isoformat()
        )
        
        self.positions.append(position)
        return position
    
    def close_position(self, coin_id: str) -> bool:
        """إغلاق مركز"""
        for i, pos in enumerate(self.positions):
            if pos.coin_id == coin_id:
                self.positions.pop(i)
                return True
        return False
    
    def update_prices(self, price_updates: Dict[str, float]):
        """تحديث الأسعار الحالية"""
        for pos in self.positions:
            if pos.coin_id in price_updates:
                pos.current_price = price_updates[pos.coin_id]
    
    def check_stops_and_targets(self) -> List[Dict]:
        """فحص وقف الخسارة والهدف"""
        triggered = []
        
        for pos in self.positions:
            pnl_pct = (pos.current_price - pos.entry_price) / pos.entry_price * 100
            
            if pos.current_price <= pos.stop_loss:
                triggered.append({
                    'coin_id': pos.coin_id,
                    'symbol': pos.symbol,
                    'type': 'STOP_LOSS',
                    'entry': pos.entry_price,
                    'current': pos.current_price,
                    'target_stop': pos.stop_loss,
                    'pnl_pct': round(pnl_pct, 2)
                })
            elif pos.current_price >= pos.target:
                triggered.append({
                    'coin_id': pos.coin_id,
                    'symbol': pos.symbol,
                    'type': 'TARGET',
                    'entry': pos.entry_price,
                    'current': pos.current_price,
                    'target_price': pos.target,
                    'pnl_pct': round(pnl_pct, 2)
                })
        
        return triggered
    
    def get_portfolio_summary(self) -> Dict:
        """ملخص المحفظة"""
        status = self.get_portfolio_status()
        
        total_pnl = 0
        positions_summary = []
        
        for pos in self.positions:
            pnl_pct = (pos.current_price - pos.entry_price) / pos.entry_price * 100
            pnl_contribution = pnl_pct * pos.position_size_pct / 100
            total_pnl += pnl_contribution
            
            positions_summary.append({
                'symbol': pos.symbol,
                'entry': pos.entry_price,
                'current': pos.current_price,
                'size_pct': pos.position_size_pct,
                'pnl_pct': round(pnl_pct, 2),
                'sector': pos.sector
            })
        
        return {
            'total_positions': status.total_positions,
            'total_exposure_pct': status.total_exposure_pct,
            'available_capital_pct': status.available_capital_pct,
            'sector_breakdown': status.sector_exposure,
            'total_pnl_pct': round(total_pnl, 2),
            'positions': positions_summary,
            'warnings': status.warnings
        }


# ============================================================================
# CONVENIENCE FUNCTION
# ============================================================================

def get_crypto_risk_manager() -> CryptoRiskManager:
    """Get a new crypto risk manager instance"""
    return CryptoRiskManager()


# ============================================================================
# MAIN TEST
# ============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("CRYPTO RISK MANAGER TEST")
    print("=" * 60)
    
    rm = CryptoRiskManager()
    
    # Test 1: Open BTC position
    print("\n📊 Test 1: Open BTC Position")
    check = rm.can_open_position('bitcoin', 'BTC', 1)
    print(f"   Allowed: {check.allowed}")
    print(f"   Position Size: {check.position_size_pct}%")
    print(f"   Stop Loss: {check.stop_loss_pct}%")
    print(f"   Target: {check.target_pct}%")
    
    # Open the position
    pos = rm.open_position('bitcoin', 'BTC', 65000, 3.0, 1)
    if pos:
        print(f"   ✅ Opened BTC at ${pos.entry_price}")
    
    # Test 2: Open ETH position
    print("\n📊 Test 2: Open ETH Position")
    pos = rm.open_position('ethereum', 'ETH', 3500, 3.0, 2)
    if pos:
        print(f"   ✅ Opened ETH at ${pos.entry_price}")
    
    # Test 3: Open SOL position
    print("\n📊 Test 3: Open SOL Position")
    pos = rm.open_position('solana', 'SOL', 150, 3.0, 5)
    if pos:
        print(f"   ✅ Opened SOL at ${pos.entry_price}")
    
    # Test 4: Try to open 4th Layer1 position (should fail)
    print("\n📊 Test 4: Open 4th Layer1 (should fail)")
    check = rm.can_open_position('cardano', 'ADA', 8)
    print(f"   Allowed: {check.allowed}")
    print(f"   Reason: {check.reason_ar}")
    
    # Test 5: Portfolio Summary
    print("\n📊 Test 5: Portfolio Summary")
    summary = rm.get_portfolio_summary()
    print(f"   Total Positions: {summary['total_positions']}")
    print(f"   Total Exposure: {summary['total_exposure_pct']}%")
    print(f"   Available Capital: {summary['available_capital_pct']}%")
    print(f"   Sector Breakdown: {summary['sector_breakdown']}")
    
    # Test 6: Meme coin warning
    print("\n📊 Test 6: Meme Coin Warning")
    check = rm.can_open_position('dogecoin', 'DOGE', 15)
    print(f"   Allowed: {check.allowed}")
    print(f"   Warnings: {check.warnings}")
    
    print("\n" + "=" * 60)
    print("CRYPTO RISK MANAGER TEST COMPLETE")
    print("=" * 60)
