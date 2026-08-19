"""
Core Module
===========
Core functionality for the Python backend.

Modules:
- database: Database connection and queries
- cache: Caching system for performance
"""

from .database import DatabaseManager, get_db_connection
from .cache import CacheManager

__all__ = ['DatabaseManager', 'get_db_connection', 'CacheManager']
