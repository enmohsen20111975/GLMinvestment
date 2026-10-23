#!/usr/bin/env python3
"""
Crypto Engine — محرك العملات الرقمية (مخفف - لا يفتح connections كثيرة)
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path
from dataclasses import dataclass, asdict
import re

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')


def _sf(val, default=0.0):
    if val is None: return default
    try:
        s = str(val).replace('−', '-').replace('،', '').replace('\u202f', '').strip()
        match = re.search(r'([+-]?\d+\.?\d*)\s*([BMKbmk])?', s)
        if match:
            num = float(match.group(1))
            suffix = (match.group(2) or '').upper()
            if suffix == 'B': num *= 1e9
            elif suffix == 'M': num *= 1e6
            elif suffix == 'K': num *= 1e3
            return num if num == num else default
        return default
    except: return default


@dataclass
class CryptoFlowScore:
    symbol: str
    name: str
    price_usd: float
    change_24h: float
    change_7d: float
    flow_score: float
    label: str
    label_en: str
    color: str
    volume_score: float
    momentum_score: float
    market_cap_score: float
    trend_score: float
    market_cap: float
    volume_24h: float
    rank: int
    action: str
    action_en: str
    position_size: float
    stop_loss: float
    target: float

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class CryptoExplosiveScore:
    symbol: str
    name: str
    price_usd: float
    change_24h: float
    explosive_score: float
    label: str
    label_en: str
    color: str
    volume_surge: float
    price_position: float
    market_cap_tier: float
    smart_money: float
    market_condition: float
    pattern: str
    pattern_en: str
    volume_ratio: float
    market_cap: float
    volume_24h: float
    rank: int
    action: str
    action_en: str
    position_size: float
    stop_loss: float
    target: float
    excluded: bool
    exclusion_reason: str

    def to_dict(self) -> Dict:
        return asdict(self)


class CryptoEngine:
    """محرك العملات الرقمية - يحمل كل البيانات في طلب واحد"""

    def __init__(self):
        self.db_path = DATA_ENGINE_DB
        self._cryptos_cache = None
        self._avg_volumes_cache = None

    def _get_conn(self):
        if not os.path.exists(self.db_path): return None
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.db_path, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        return conn

    def get_all_cryptos(self, limit: int = 200) -> List[Dict]:
        """جلب كل العملات في طلب واحد (cached)"""
        if self._cryptos_cache is not None:
            return self._cryptos_cache[:limit]

        conn = self._get_conn()
        if not conn: return []
        cur = conn.cursor()
        rows = cur.execute("""
            SELECT c.symbol, c.name, c.price_usd, c.price_change_24h,
                   c.price_change_7d, c.market_cap, c.market_cap_rank,
                   c.total_volume, c.circulating_supply, c.rank, c.timestamp
            FROM crypto_prices c
            INNER JOIN (
                SELECT symbol, MAX(timestamp) as max_ts
                FROM crypto_prices GROUP BY symbol
            ) latest ON c.symbol = latest.symbol AND c.timestamp = latest.max_ts
            ORDER BY CAST(c.market_cap_rank AS INTEGER) ASC LIMIT ?
        """, (limit,)).fetchall()

        # Get avg volumes in ONE query
        vol_rows = cur.execute("""
            SELECT symbol, AVG(CAST(total_volume AS REAL)) as avg_vol
            FROM crypto_prices
            WHERE total_volume > 0
            GROUP BY symbol
        """).fetchall()
        conn.close()

        self._avg_volumes_cache = {r['symbol']: _sf(r['avg_vol']) for r in vol_rows}

        result = []
        for r in rows:
            result.append({
                'symbol': r['symbol'], 'name': r['name'],
                'price_usd': _sf(r['price_usd']),
                'change_24h': _sf(r['price_change_24h']),
                'change_7d': _sf(r['price_change_7d']),
                'market_cap': _sf(r['market_cap']),
                'market_cap_rank': int(_sf(r['market_cap_rank'], 999)),
                'volume_24h': _sf(r['total_volume']),
                'circulating_supply': _sf(r['circulating_supply']),
                'rank': int(_sf(r['rank'], 999)),
                'timestamp': r['timestamp'],
            })
        self._cryptos_cache = result
        return result[:limit]

    def _get_avg_volume_cached(self, symbol: str) -> float:
        if self._avg_volumes_cache is None:
            self.get_all_cryptos(200)
        return self._avg_volumes_cache.get(symbol, 0)

    def _calculate_market_condition(self, cryptos: List[Dict]) -> float:
        top10 = [c for c in cryptos if c.get('market_cap_rank', 999) <= 10]
        if not top10: return 50.0
        avg_change = sum(c.get('change_24h', 0) for c in top10) / len(top10)
        if avg_change > 3: return 100.0
        elif avg_change > 1: return 75.0
        elif avg_change > -1: return 50.0
        elif avg_change > -3: return 25.0
        else: return 0.0

    def _detect_smart_money(self, vol_ratio, change_24h):
        try:
            vol = _sf(vol_ratio, 1.0)
            chg = _sf(change_24h, 0.0)
            if vol >= 2.0:
                if abs(chg) < 1: return "تجميع خفي", "ACCUMULATION", 80.0
                elif chg > 5: return "انفجار صاعد (فخ)", "BREAKOUT_TRAP", 30.0
                elif chg > 1: return "صعود بحجم كبير", "BULLISH_VOLUME_SURGE", 50.0
                elif chg < -3: return "تصريف", "DISTRIBUTION", 10.0
                else: return "حركة طفيفة", "MILD_ACTION", 40.0
            elif vol >= 1.5:
                if abs(chg) < 1: return "تجميع خفيف", "LIGHT_ACCUMULATION", 60.0
                elif chg > 0.5: return "صعود بحجم", "BULLISH_VOLUME", 55.0
                else: return "طبيعي", "NORMAL", 40.0
            else: return "هادئ", "QUIET", 20.0
        except: return "طبيعي", "NORMAL", 50.0

    def calculate_flow_score(self, symbol: str) -> Optional[CryptoFlowScore]:
        """Flow Score لعملة - لا يفتح connection جديد"""
        cryptos = self.get_all_cryptos(200)
        crypto = next((c for c in cryptos if c['symbol'] == symbol), None)
        if not crypto: return None

        price = crypto['price_usd']
        change_24h = crypto['change_24h']
        change_7d = crypto['change_7d']
        volume = crypto['volume_24h']
        market_cap = crypto['market_cap']
        rank = crypto['market_cap_rank']

        avg_vol = self._get_avg_volume_cached(symbol)
        vol_ratio = (volume / avg_vol) if avg_vol and avg_vol > 0 else 1.0
        vol_ratio = min(vol_ratio, 10.0)
        if vol_ratio > 2: vol_score = 100.0
        elif vol_ratio > 1.5: vol_score = 75.0
        elif vol_ratio > 1.0: vol_score = 50.0
        else: vol_score = 25.0

        if change_24h > 5: mom_score = 100.0
        elif change_24h > 2: mom_score = 75.0
        elif change_24h > 0: mom_score = 50.0
        elif change_24h > -2: mom_score = 25.0
        else: mom_score = 0.0
        if change_7d > 10: mom_score = min(100, mom_score + 20)
        elif change_7d < -10: mom_score = max(0, mom_score - 20)

        if rank <= 10: cap_score = 100.0
        elif rank <= 50: cap_score = 75.0
        elif rank <= 100: cap_score = 50.0
        else: cap_score = 25.0

        if change_7d > 0 and change_24h > 0: trend_score = 100.0
        elif change_7d > 0 and change_24h < 0: trend_score = 60.0
        elif change_7d < 0 and change_24h > 0: trend_score = 40.0
        else: trend_score = 20.0

        total = (vol_score * 0.25 + mom_score * 0.30 + cap_score * 0.25 + trend_score * 0.20)

        if total >= 75:
            label, label_en, color = "نار", "FIRE", "red"
            action, action_en = "دخول قوي", "STRONG_ENTRY"
            pos, stop, target = 25, -5, 20
        elif total >= 60:
            label, label_en, color = "شرارة", "SPARK", "orange"
            action, action_en = "دخول حذر", "CAUTIOUS_ENTRY"
            pos, stop, target = 15, -7, 15
        elif total >= 40:
            label, label_en, color = "رماد", "ASH", "amber"
            action, action_en = "استنى", "WAIT"
            pos, stop, target = 0, 0, 0
        else:
            label, label_en, color = "بارد", "COLD", "blue"
            action, action_en = "ماتدخلش", "AVOID"
            pos, stop, target = 0, 0, 0

        return CryptoFlowScore(
            symbol=symbol, name=crypto['name'],
            price_usd=round(price, 6),
            change_24h=round(change_24h, 2), change_7d=round(change_7d, 2),
            flow_score=round(total, 1), label=label, label_en=label_en, color=color,
            volume_score=round(vol_score, 1), momentum_score=round(mom_score, 1),
            market_cap_score=round(cap_score, 1), trend_score=round(trend_score, 1),
            market_cap=market_cap, volume_24h=volume, rank=rank,
            action=action, action_en=action_en,
            position_size=pos, stop_loss=stop, target=target,
        )

    def get_top_flow(self, limit: int = 20) -> List[Dict]:
        """أعلى العملات - لا يفتح connections متعددة"""
        cryptos = self.get_all_cryptos(200)
        results = []
        for c in cryptos:
            try:
                flow = self.calculate_flow_score(c['symbol'])
                if flow: results.append(flow.to_dict())
            except: pass
        results.sort(key=lambda x: x['flow_score'], reverse=True)
        return results[:limit]

    def calculate_explosive_score(self, symbol: str) -> Optional[CryptoExplosiveScore]:
        """Explosive Score - لا يفتح connection جديد"""
        cryptos = self.get_all_cryptos(200)
        crypto = next((c for c in cryptos if c['symbol'] == symbol), None)
        if not crypto: return None

        price = crypto['price_usd']
        change_24h = crypto['change_24h']
        volume = crypto['volume_24h']
        market_cap = crypto['market_cap']
        rank = crypto['market_cap_rank']

        excluded = False
        exclusion_reason = ""
        if 0.95 < price < 1.05 and abs(change_24h) < 0.5:
            excluded = True
            exclusion_reason = "عملة مستقرة (stablecoin)"

        avg_vol = self._get_avg_volume_cached(symbol)
        vol_ratio = (volume / avg_vol) if avg_vol and avg_vol > 0 else 1.0
        vol_ratio = min(vol_ratio, 10.0)

        if vol_ratio >= 3: vol_score = 100.0
        elif vol_ratio >= 2: vol_score = 75.0
        elif vol_ratio >= 1.5: vol_score = 50.0
        else: vol_score = 0.0

        change_7d = crypto.get('change_7d', 0)
        if change_7d < -10: price_score = 90.0
        elif change_7d < -5: price_score = 70.0
        elif change_7d > 20: price_score = 20.0
        elif change_7d > 10: price_score = 40.0
        else: price_score = 50.0

        if rank <= 10: cap_score = 100.0
        elif rank <= 50: cap_score = 75.0
        elif rank <= 100: cap_score = 50.0
        else: cap_score = 25.0

        pattern_ar, pattern_en, smart_score = self._detect_smart_money(vol_ratio, change_24h)
        market_condition = self._calculate_market_condition(cryptos)

        total = (vol_score * 0.25 + price_score * 0.30 + cap_score * 0.20 +
                 smart_score * 0.15 + market_condition * 0.10)

        if total >= 75:
            label, label_en, color = "قنبلة", "BOMB", "red"
            action, action_en = "دخول فوري", "ENTER_NOW"
            pos, stop, target = 20, -5, 30
        elif total >= 65:
            label, label_en, color = "صاروخ", "ROCKET", "orange"
            action, action_en = "دخول بحذر", "CAUTIOUS_ENTRY"
            pos, stop, target = 10, -7, 20
        elif total >= 50:
            label, label_en, color = "شرارة", "SPARK", "amber"
            action, action_en = "استنى تأكيد", "WAIT_CONFIRM"
            pos, stop, target = 0, 0, 0
        else:
            label, label_en, color = "ميت", "DEAD", "gray"
            action, action_en = "فوت", "SKIP"
            pos, stop, target = 0, 0, 0

        if excluded:
            label, label_en, color = "مستثنى", "EXCLUDED", "slate"
            action, action_en = "ممنوع", "FORBIDDEN"
            pos, stop, target = 0, 0, 0
            total = 0.0

        return CryptoExplosiveScore(
            symbol=symbol, name=crypto['name'],
            price_usd=round(price, 6), change_24h=round(change_24h, 2),
            explosive_score=round(total, 1),
            label=label, label_en=label_en, color=color,
            volume_surge=round(vol_score, 1), price_position=round(price_score, 1),
            market_cap_tier=round(cap_score, 1), smart_money=round(smart_score, 1),
            market_condition=round(market_condition, 1),
            pattern=pattern_ar, pattern_en=pattern_en,
            volume_ratio=round(vol_ratio, 2),
            market_cap=market_cap, volume_24h=volume, rank=rank,
            action=action, action_en=action_en,
            position_size=pos, stop_loss=stop, target=target,
            excluded=excluded, exclusion_reason=exclusion_reason,
        )

    def get_top_explosive(self, limit: int = 20) -> List[Dict]:
        cryptos = self.get_all_cryptos(200)
        results = []
        for c in cryptos:
            try:
                score = self.calculate_explosive_score(c['symbol'])
                if score and not score.excluded: results.append(score.to_dict())
            except: pass
        results.sort(key=lambda x: x['explosive_score'], reverse=True)
        return results[:limit]

    def get_live_monitor(self) -> Dict:
        cryptos = self.get_all_cryptos(200)
        if not cryptos: return {'success': False, 'error': 'No crypto data'}

        total_market_cap = sum(c['market_cap'] for c in cryptos)
        total_volume = sum(c['volume_24h'] for c in cryptos)
        gainers_list = sorted([c for c in cryptos if c['change_24h'] > 0], key=lambda x: x['change_24h'], reverse=True)[:10]
        losers_list = sorted([c for c in cryptos if c['change_24h'] < 0], key=lambda x: x['change_24h'])[:10]
        most_active = sorted(cryptos, key=lambda x: x['volume_24h'], reverse=True)[:10]

        return {
            'success': True,
            'data': {
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'total_coins': len(cryptos),
                'total_market_cap': total_market_cap,
                'total_volume_24h': total_volume,
                'gainers_count': len([c for c in cryptos if c['change_24h'] > 0]),
                'losers_count': len([c for c in cryptos if c['change_24h'] < 0]),
                'market_condition': self._calculate_market_condition(cryptos),
                'gainers': gainers_list,
                'losers': losers_list,
                'most_active': most_active,
                'all_cryptos': cryptos,
            }
        }
