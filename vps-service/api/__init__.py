"""
API Module
==========
API routes for Flask application.

Modules:
- stocks: Stock endpoints
- crypto: Crypto endpoints
- analysis_routes: Analysis endpoints
- public_routes: Public API endpoints
- professional_analysis_routes: Professional analysis endpoint
- scanner_routes: Scanner endpoints
"""

# Lazy imports to avoid circular dependencies
__all__ = [
    'register_stock_routes',
    'register_analysis_routes',
    'public_bp',
    'prof_analysis_bp',
    'scanner_bp'
]


def __getattr__(name):
    """Lazy import modules."""
    if name == 'register_stock_routes':
        from .stocks import register_stock_routes
        return register_stock_routes
    elif name == 'register_analysis_routes':
        from .analysis_routes import register_analysis_routes
        return register_analysis_routes
    elif name == 'public_bp':
        from .public_routes import public_bp
        return public_bp
    elif name == 'prof_analysis_bp':
        from .professional_analysis_routes import prof_analysis_bp
        return prof_analysis_bp
    elif name == 'scanner_bp':
        from .scanner_routes import scanner_bp
        return scanner_bp
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
