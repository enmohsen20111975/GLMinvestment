"""
Crypto Data Fetcher
===================
Fetches cryptocurrency data from CoinGecko.

Features:
- Top cryptos by market cap
- OHLCV data
- Market data
"""

import json
import time
import urllib.request
import urllib.error
from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime

COINGECKO_API = "https://api.coingecko.com/api/v3"


@dataclass
class CryptoPrice:
    """Crypto price data."""
    coin_id: str
    symbol: str
    name: str
    current_price: float
    price_change_24h: float
    price_change_percent_24h: float
    high_24h: float
    low_24h: float
    volume: float
    market_cap: float
    market_cap_rank: int


class CryptoDataFetcher:
    """
    Crypto Data Fetcher from CoinGecko.
    
    Usage:
        fetcher = CryptoDataFetcher()
        top = fetcher.get_top_cryptos(10)
        bitcoin = fetcher.get_crypto('bitcoin')
    """
    
    def __init__(self, cache_duration: int = 300):
        self.cache_duration = cache_duration
        self.cache = {}
    
    def _fetch(self, url: str) -> Dict:
        """Fetch data from API."""
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            })
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print("Rate limited, waiting 60 seconds...")
                time.sleep(60)
                return self._fetch(url)
            raise
        except Exception as e:
            print(f"Error fetching {url}: {e}")
            return {}
    
    def get_top_cryptos(self, limit: int = 50) -> List[CryptoPrice]:
        """Get top cryptocurrencies by market cap."""
        url = f"{COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page={limit}&sparkline=false"
        data = self._fetch(url)
        
        cryptos = []
        for item in data:
            try:
                cryptos.append(CryptoPrice(
                    coin_id=item['id'],
                    symbol=item['symbol'].upper(),
                    name=item['name'],
                    current_price=item['current_price'],
                    price_change_24h=item['price_change_24h'],
                    price_change_percent_24h=item['price_change_percentage_24h'],
                    high_24h=item['high_24h'],
                    low_24h=item['low_24h'],
                    volume=item['total_volume'],
                    market_cap=item['market_cap'],
                    market_cap_rank=item['market_cap_rank']
                ))
            except:
                continue
        
        return cryptos
    
    def get_crypto(self, coin_id: str) -> Optional[CryptoPrice]:
        """Get single crypto data."""
        url = f"{COINGECKO_API}/coins/markets?vs_currency=usd&ids={coin_id}&sparkline=false"
        data = self._fetch(url)
        
        if data and len(data) > 0:
            item = data[0]
            return CryptoPrice(
                coin_id=item['id'],
                symbol=item['symbol'].upper(),
                name=item['name'],
                current_price=item['current_price'],
                price_change_24h=item['price_change_24h'],
                price_change_percent_24h=item['price_change_percentage_24h'],
                high_24h=item['high_24h'],
                low_24h=item['low_24h'],
                volume=item['total_volume'],
                market_cap=item['market_cap'],
                market_cap_rank=item['market_cap_rank']
            )
        
        return None
    
    def get_global_data(self) -> Dict:
        """Get global market data."""
        url = f"{COINGECKO_API}/global"
        return self._fetch(url)
    
    def get_ohlcv(self, coin_id: str, days: int = 90) -> List[Dict]:
        """Get OHLCV data."""
        url = f"{COINGECKO_API}/coins/{coin_id}/ohlc?vs_currency=usd&days={days}"
        data = self._fetch(url)
        
        ohlcv = []
        for item in data:
            try:
                ohlcv.append({
                    'timestamp': item[0],
                    'open': item[1],
                    'high': item[2],
                    'low': item[3],
                    'close': item[4]
                })
            except:
                continue
        
        return ohlcv
