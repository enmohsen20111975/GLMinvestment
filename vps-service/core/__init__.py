"""
Core Module
===========
Core functionality for the Python backend.

Modules:
- database: Database connection and queries
- cache_manager: Caching system for performance (canonical — cache.py was archived)
"""

from .database import DatabaseManager, get_db_connection

# FIX (2026-10-05): cache.py was archived (0 importers — Rule 16).
# cache_manager.py is the canonical cache module.
try:
    from .cache_manager import CacheManager
except ImportError:
    CacheManager = None  # graceful fallback

__all__ = ['DatabaseManager', 'get_db_connection', 'CacheManager']
