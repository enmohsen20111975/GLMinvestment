"""
Config Module
=============
إعدادات النظام

Contains:
- market_config: إعدادات الأسواق
"""

from .market_config import (
    MarketConfig,
    MarketType,
    MarketRegime,
    MARKET_CONFIGS,
    get_market_config,
    get_all_markets,
    get_markets_by_type,
    get_stock_markets,
    get_crypto_markets,
    is_market_open,
    get_regime_settings,
    detect_market_from_ticker,
)

from .sys_config import (
    DATABASE_PATH,
    PRICE_HISTORY_DB_PATH,
    API_PORT,
    API_HOST,
    DEBUG_MODE,
    LOG_LEVEL,
    PROJECT_ROOT,
    DB_DIR,
    LOGS_DIR,
    get_database_path,
    get_price_history_db_path,
    get_db_connection,
    verify_database,
    print_config,
)

__all__ = [
    'MarketConfig',
    'MarketType',
    'MarketRegime',
    'MARKET_CONFIGS',
    'get_market_config',
    'get_all_markets',
    'get_markets_by_type',
    'get_stock_markets',
    'get_crypto_markets',
    'is_market_open',
    'get_regime_settings',
    'detect_market_from_ticker',
    'DATABASE_PATH',
    'PRICE_HISTORY_DB_PATH',
    'API_PORT',
    'API_HOST',
    'DEBUG_MODE',
    'LOG_LEVEL',
    'PROJECT_ROOT',
    'DB_DIR',
    'LOGS_DIR',
    'get_database_path',
    'get_price_history_db_path',
    'get_db_connection',
    'verify_database',
    'print_config',
]
