"""
Cache Manager
=============
Simple caching system for performance optimization.

Features:
- In-memory caching
- TTL (Time To Live) support
- Automatic cleanup of expired entries
"""

import time
from typing import Dict, Any, Optional
from datetime import datetime
import threading


class CacheManager:
    """
    Simple in-memory cache with TTL support.
    
    Usage:
        cache = CacheManager(default_ttl=300)  # 5 minutes
        cache.set('stocks', stocks_data)
        stocks = cache.get('stocks')
    """
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls, *args, **kwargs):
        """Singleton pattern for global cache."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._cache = {}
                    cls._instance._timestamps = {}
                    cls._instance._default_ttl = kwargs.get('default_ttl', 300)
        return cls._instance
    
    def __init__(self, default_ttl: int = 300):
        """Initialize cache with default TTL."""
        self._cache: Dict[str, Any] = {}
        self._timestamps: Dict[str, float] = {}
        self._default_ttl = default_ttl
    
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache if not expired."""
        if key not in self._cache:
            return None
        
        # Check if expired
        if key in self._timestamps:
            if time.time() - self._timestamps[key] > self._default_ttl:
                self.delete(key)
                return None
        
        return self._cache.get(key)
    
    def set(self, key: str, value: Any, ttl: int = None) -> None:
        """Set value in cache with optional TTL."""
        self._cache[key] = value
        self._timestamps[key] = time.time()
    
    def delete(self, key: str) -> None:
        """Delete value from cache."""
        self._cache.pop(key, None)
        self._timestamps.pop(key, None)
    
    def clear(self) -> None:
        """Clear all cache."""
        self._cache.clear()
        self._timestamps.clear()
    
    def cleanup_expired(self) -> int:
        """Remove all expired entries. Returns count of removed entries."""
        now = time.time()
        expired_keys = [
            key for key, timestamp in self._timestamps.items()
            if now - timestamp > self._default_ttl
        ]
        
        for key in expired_keys:
            self.delete(key)
        
        return len(expired_keys)
    
    def get_stats(self) -> Dict:
        """Get cache statistics."""
        return {
            'entries_count': len(self._cache),
            'oldest_entry': min(self._timestamps.values()) if self._timestamps else None,
            'newest_entry': max(self._timestamps.values()) if self._timestamps else None,
            'default_ttl': self._default_ttl
        }


# Global cache instance
cache = CacheManager(default_ttl=300)  # 5 minutes default TTL
