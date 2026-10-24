"""
data_engine/scrapers/ticker_validator.py
=========================================
Central ticker validation — the single source of truth for "is this ticker real?".

PURPOSE:
    Every scraper that inserts into stocks.db MUST call validate_ticker() first.
    This prevents corrupted tickers (UBEEU, TWSATA, ISIN codes) from entering the DB.

USAGE:
    from scrapers.ticker_validator import validate_ticker, is_valid_egx_ticker

    # In your scraper:
    for stock in scraped_data:
        symbol = stock.get('symbol', '')
        name = stock.get('name', '')
        if not validate_ticker(symbol, name):
            log(f"⚠️ SKIP invalid ticker: {symbol} / {name}")
            continue
        cursor.execute("INSERT INTO stocks ...")

DETECTION PATTERNS:
    1. Pollution merge: symbol ends with first letter of name (UBEEU → UBEE + 'U' from 'United')
    2. ISIN codes: EGS + 12+ chars (EGS3I0S1C019) — not ticker symbols
    3. Name starts with lowercase (scraper stripped first char)
    4. Name has trailing 'D' artifact (legacy debug marker)
"""
import re
from typing import Tuple


# Known canonical EGX tickers (whitelist for preferred shares that look corrupted but are real)
# These tickers have ph_rows >= 100 (established) + properly capitalized names.
PREFERRED_WHITELIST = {
    'FAITA',  # Faisal Bank USD preferred
    'CCAPP',  # Al Qalaa preferred
    'EGSA',   # NileSat (real ticker, base EGS is the fake)
    'AIGC',   # Arab Investment Group (if exists)
}

# ISIN pattern: EGS + 12+ alphanumeric chars
ISIN_PATTERN = re.compile(r'^EGS[A-Z0-9]{10,}$')

# Suffix variants like EGS30AJ1C016-EGP (with -EGP suffix)
ISIN_SUFFIX_PATTERN = re.compile(r'^EGS[A-Z0-9]{10,}-EGP$')


def is_isin_code(symbol: str) -> bool:
    """Check if symbol looks like an ISIN code (not a ticker)."""
    if not symbol:
        return False
    return bool(ISIN_PATTERN.match(symbol) or ISIN_SUFFIX_PATTERN.match(symbol))


def is_pollution_merge(symbol: str, name: str) -> bool:
    """Check if symbol was polluted by merging first letter of company name.

    Pattern: symbol = base + first_char_of_name
    Example: UBEEU = UBEE + 'U' (from 'United')

    Returns True if the symbol's last char matches the first char of the name,
    AND the remaining symbol (base) looks like a valid shorter ticker.
    """
    if not symbol or not name:
        return False
    if len(symbol) < 4:
        return False

    # Check if name starts with lowercase (scraper stripped first char)
    # Example: name='nited Bank SAE' (lowercase 'n') → symbol='UBEEU' (stole the 'U')
    name_starts_lowercase = bool(name) and name[0].islower()

    # Check if last char of symbol matches first char of name
    # Example: symbol='UBEEU', name='United Bank' → 'U' == 'U' → True
    last_char = symbol[-1].upper()
    first_char = name[0].upper() if name else ''
    matches_first_char = (last_char == first_char)

    # Check for trailing 'D' artifact in name (legacy debug marker)
    # Example: name='UBEEUnited Bank SAED' → trailing 'D'
    has_trailing_d = name.endswith('D') and len(name) > 2 and not name[-2].isspace()

    # Check if symbol starts with name (reversed pollution)
    # Example: symbol='UBEEU', name='UBEEUnited Bank SAED' → name starts with symbol
    name_starts_with_symbol = name.startswith(symbol)

    # Decision: polluted if name starts lowercase OR matches_first_char
    # But NOT if the ticker is in the preferred whitelist
    if symbol in PREFERRED_WHITELIST:
        return False

    if name_starts_lowercase:
        return True

    if matches_first_char and (name_starts_with_symbol or has_trailing_d):
        return True

    return False


def is_valid_egx_ticker(symbol: str) -> bool:
    """Check if symbol is a valid EGX ticker format.

    Valid EGX tickers:
    - 2-8 uppercase letters/numbers
    - No ISIN codes (EGS + 12 chars)
    - No suffix variants (EGS...-EGP)
    """
    if not symbol:
        return False

    # Reject ISIN codes
    if is_isin_code(symbol):
        return False

    # Reject tickers that are too long (real EGX tickers are 2-8 chars)
    if len(symbol) > 10:
        return False

    # Reject tickers with special chars (except hyphens for preferred)
    if not re.match(r'^[A-Z0-9\-]+$', symbol.upper()):
        return False

    return True


def validate_ticker(symbol: str, name: str = '') -> Tuple[bool, str]:
    """Validate a ticker symbol + name before inserting into DB.

    Returns:
        (is_valid, reason)
        - is_valid: True if the ticker should be accepted
        - reason: explanation if rejected
    """
    if not symbol:
        return False, 'empty_symbol'

    # Check 1: ISIN code
    if is_isin_code(symbol):
        return False, f'isin_code ({symbol})'

    # Check 2: Pollution merge (UBEEU pattern)
    if name and is_pollution_merge(symbol, name):
        return False, f'pollution_merge ({symbol} = base + first_char_of_name)'

    # Check 3: Name starts with lowercase (scraper stripped first char)
    if name and name[0].islower() and symbol not in PREFERRED_WHITELIST:
        return False, f'name_starts_lowercase (scraper stripped first char)'

    # Check 4: Valid EGX ticker format
    if not is_valid_egx_ticker(symbol):
        return False, f'invalid_format ({symbol})'

    return True, 'valid'


# ============================================================================
# Test cases (run with: python3 data_engine/scrapers/ticker_validator.py)
# ============================================================================
if __name__ == '__main__':
    test_cases = [
        # (symbol, name, expected_valid, description)
        ('UBEE', 'United Bank SAE', True, 'real ticker'),
        ('UBEEU', 'nited Bank SAE', False, 'pollution: UBEE + U from United'),
        ('UBEEU', 'UBEEUnited Bank SAED', False, 'pollution: name starts with symbol + trailing D'),
        ('EGS3I0S1C019', 'ايكمي', False, 'ISIN code'),
        ('EGS30AJ1C016-EGP', 'International Dry Ice', False, 'ISIN with -EGP suffix'),
        ('FAITA', 'Faisal Islamic Bank of Egypt', True, 'real preferred (whitelist)'),
        ('CCAPP', 'القلعة للاستثمارات المالية - اسهم ممتازة', True, 'real preferred (whitelist)'),
        ('COMI', 'البنك التجاري الدولي', True, 'real ticker'),
        ('LUTSL', 'LUTSLotus For Agricultural...D', False, 'pollution: LUTS + L from Lotus'),
        ('FWRYF', 'awry For Banking Technology', False, 'pollution: FWRY + F from Fawry'),
        ('ABUK', 'ابوقير للاسمدة', True, 'real ticker'),
        ('', 'empty symbol', False, 'empty symbol'),
    ]

    print(f"{'symbol':15s} | {'name':45s} | {'valid':>5s} | expected | reason")
    print('-' * 100)

    all_pass = True
    for symbol, name, expected, desc in test_cases:
        is_valid, reason = validate_ticker(symbol, name)
        status = '✅' if is_valid == expected else '❌'
        if is_valid != expected:
            all_pass = False
        print(f"{symbol:15s} | {name[:45]:45s} | {str(is_valid):>5s} | {status} {str(expected):>5s} | {reason} ({desc})")

    print()
    if all_pass:
        print("✅ All test cases passed!")
    else:
        print("❌ Some test cases failed!")
