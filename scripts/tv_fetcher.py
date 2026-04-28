#!/usr/bin/env python3
"""
tv_fetcher.py - Fetch live EGX stock data from TradingView using tradingview-ta

Usage:
    python3 tv_fetcher.py quote COMI
    python3 tv_fetcher.py batch COMI,HRHO,EMFD
    python3 tv_fetcher.py all
    python3 tv_fetcher.py indices
"""

import json
import sys
import warnings
warnings.filterwarnings('ignore')

from tradingview_ta import TA_Handler, Interval, get_multiple_analysis

# Known EGX stock tickers that work with TradingView
# Format: (TradingView symbol, display ticker)
EGX_STOCKS = [
    # Major stocks
    ("COMI", "COMI"),  # Commercial International Bank
    ("HRHO", "HRHO"),  # EFG Hermes
    ("EMFD", "EMFD"),  # Egyptian Financial Group
    ("ORHD", "ORHD"),  # Orascom Development
    ("OCDI", "OCDI"),  # Orascom Construction
    ("AMER", "AMER"),  # Amer Group
    ("ALCN", "ALCN"),  # Arab Cotton Ginning
    ("ALQA", "ALQA"),  # Al Qahera
    ("APOG", "APOG"),  # AppIoT Group
    ("BTFH", "BTFH"),  # Beltone Financial
    ("CAII", "CAII"),  # Cairo Investment
    ("CCAP", "CCAP"),  # Citadel Capital
    ("CIRA", "CIRA"),  # Cairo Investment
    ("EDFU", "EDFU"),  # Edfu
    ("EKRI", "EKRI"),  # Egyptian Kuwaiti
    ("ELKA", "ELKA"),  # El Kahera
    ("EZDK", "EZDK"),  # Ezz Steel
    ("FWRY", "FWRY"),  # Fawry
    ("GDEC", "GDEC"),  # Giza General
    ("GLAX", "GLAX"),  # GlaxoSmithKline
    ("HELI", "HELI"),  # Heliopolis Housing
    ("MNHD", "MNHD"),  # Madinet Nasr
    ("MTIE", "MTIE"),  # Maritime Transport
    ("OPET", "OPET"),  # Obour
    ("OILA", "OILA"),  # Oils & Soaps
    ("PRDC", "PRDC"),  # Production
    ("RMDA", "RMDA"),  # Raya
    ("SWDY", "SWDY"),  # Elsewedy Electric
    ("TALM", "TALM"),  # Talaat Moustafa
    ("TMGH", "TMGH"),  # Talaat Moustafa Group
    # More stocks
    ("ABUK", "ABUK"),
    ("ACMD", "ACMD"),
    ("ADCI", "ADCI"),
    ("AINT", "AINT"),
    ("AIRP", "AIRP"),
    ("ALCH", "ALCH"),
    ("ALTS", "ALTS"),
    ("AMOC", "AMOC"),
    ("ANFI", "ANFI"),
    ("APIC", "APIC"),
    ("ARAB", "ARAB"),
    ("ARCG", "ARCG"),
    ("ASRI", "ASRI"),
    ("ATLC", "ATLC"),
    ("ATWA", "ATWA"),
    ("AUCS", "AUCS"),
    ("AZIN", "AZIN"),
    ("BNKA", "BNKA"),
    ("BQAK", "BQAK"),
    ("BRIO", "BRIO"),
    ("CABC", "CABC"),
    ("CAKR", "CAKR"),
    ("CASE", "CASE"),
    ("CATA", "CATA"),
    ("CHDA", "CHDA"),
    ("CIEB", "CIEB"),
    ("CLHO", "CLHO"),
    ("CMGI", "CMGI"),
    ("CNFN", "CNFN"),
    ("CPCS", "CPCS"),
    ("CSAG", "CSAG"),
    ("CSBE", "CSBE"),
    ("CSEC", "CSEC"),
    ("DREI", "DREI"),
    ("DSCV", "DSCV"),
    ("DTHC", "DTHC"),
    ("EAST", "EAST"),
    ("EBSC", "EBSC"),
    ("ECMF", "ECMF"),
    ("ECOL", "ECOL"),
    ("EFIC", "EFIC"),
    ("EGCH", "EGCH"),
    ("EGEM", "EGEM"),
    ("EGPA", "EGPA"),
    ("EGPC", "EGPC"),
    ("EGSS", "EGSS"),
    ("EGTS", "EGTS"),
    ("EKIK", "EKIK"),
    ("ELCR", "ELCR"),
    ("ELDP", "ELDP"),
    ("ELFA", "ELFA"),
    ("ELSH", "ELSH"),
    ("ELTU", "ELTU"),
    ("ESEK", "ESEK"),
    ("ESGN", "ESGN"),
    ("ETFO", "ETFO"),
    ("ETIL", "ETIL"),
    ("FAIT", "FAIT"),
    ("FDVA", "FDVA"),
    ("FIEL", "FIEL"),
    ("FLMI", "FLMI"),
    ("GBHO", "GBHO"),
    ("GCOM", "GCOM"),
    ("GENA", "GENA"),
    ("GENI", "GENI"),
    ("GFSM", "GFSM"),
    ("GGCC", "GGCC"),
    ("GHAL", "GHAL"),
    ("GIPC", "GIPC"),
    ("GIZE", "GIZE"),
    ("GMCN", "GMCN"),
    ("GNOT", "GNOT"),
    ("GRPO", "GRPO"),
    ("GWED", "GWED"),
    ("HAUP", "HAUP"),
    ("HDBK", "HDBK"),
    ("HRNY", "HRNY"),
    ("ICAI", "ICAI"),
    ("ICDM", "ICDM"),
    ("ICIB", "ICIB"),
    ("IDRE", "IDRE"),
    ("IDHC", "IDHC"),
    ("INAI", "INAI"),
    ("INCO", "INCO"),
    ("INFI", "INFI"),
    ("INMA", "INMA"),
    ("IRAX", "IRAX"),
    ("ISFA", "ISFA"),
    ("ITDCAI", "ITDCAI"),
    ("JOIN", "JOIN"),
    ("KABO", "KABO"),
    ("KDTD", "KDTD"),
    ("LADA", "LADA"),
    ("LIVN", "LIVN"),
    ("MCQE", "MCQE"),
    ("MEIN", "MEIN"),
    ("MIQR", "MIQR"),
    ("MISR", "MISR"),
    ("MNHD", "MNHD"),
    ("MOIN", "MOIN"),
    ("MRIN", "MRIN"),
    ("MTRC", "MTRC"),
    ("NAFH", "NAFH"),
    ("NCCC", "NCCC"),
    ("NEXA", "NEXA"),
    ("NTPC", "NTPC"),
    ("NTRA", "NTRA"),
    ("OCDI", "OCDI"),
    ("OIMC", "OIMC"),
    ("OIUH", "OIUH"),
    ("OIZD", "OIZD"),
    ("OLIV", "OLIV"),
    ("ORWE", "ORWE"),
    ("OSDN", "OSDN"),
    ("OUDC", "OUDC"),
    ("PHDW", "PHDW"),
    ("PICH", "PICH"),
    ("PIRI", "PIRI"),
    ("PMDV", "PMDV"),
    ("PRDC", "PRDC"),
    ("PTEC", "PTEC"),
    ("PRES", "PRES"),
    ("QENA", "QENA"),
    ("RAYA", "RAYA"),
    ("RDI", "RDI"),
    ("RREI", "RREI"),
    ("RSIE", "RSIE"),
    ("SAEY", "SAEY"),
    ("SAFS", "SAFS"),
    ("SAIH", "SAIH"),
    ("SAIS", "SAIS"),
    ("SAWA", "SAWA"),
    ("SBAG", "SBAG"),
    ("SCAN", "SCAN"),
    ("SDFD", "SDFD"),
    ("SDIV", "SDIV"),
    ("SGAM", "SGAM"),
    ("SHRE", "SHRE"),
    ("SIPA", "SIPA"),
    ("SKPC", "SKPC"),
    ("SODA", "SODA"),
    ("SPMD", "SPMD"),
    ("SQFF", "SQFF"),
    ("SVCE", "SVCE"),
    ("SVPL", "SVPL"),
    ("SWYE", "SWYE"),
    ("TALC", "TALC"),
    ("TANM", "TANM"),
    ("TAQA", "TAQA"),
    ("TCEY", "TCEY"),
    ("THRD", "THRD"),
    ("TIPC", "TIPC"),
    ("TREI", "TREI"),
    ("TRMA", "TRMA"),
    ("UNBI", "UNBI"),
    ("UNDP", "UNDP"),
    ("UNFA", "UNFA"),
    ("VODE", "VODE"),
    ("WADC", "WADC"),
    ("WECA", "WECA"),
    ("ZMNS", "ZMNS"),
]

# EGX Indices
EGX_INDICES = [
    ("EGX30", "EGX30"),
    ("EGX50", "EGX50"),
    ("EGX70", "EGX70"),
    ("EGX100", "EGX100"),
]

def fetch_quote(symbol: str, exchange: str = "EGX", screener: str = "egypt") -> dict:
    """Fetch a single stock quote from TradingView."""
    try:
        handler = TA_Handler(
            symbol=symbol,
            screener=screener,
            exchange=exchange,
            interval=Interval.INTERVAL_1_DAY
        )
        analysis = handler.get_analysis()
        
        indicators = analysis.indicators
        price = indicators.get('close', 0)
        prev_close = indicators.get('previous_close', price)
        
        change = price - prev_close if prev_close else 0
        change_pct = (change / prev_close * 100) if prev_close else 0
        
        return {
            "ticker": symbol,
            "exchange": exchange,
            "current_price": round(price, 4) if price else 0,
            "previous_close": round(prev_close, 4) if prev_close else 0,
            "open_price": round(indicators.get('open', price), 4),
            "high_price": round(indicators.get('high', price), 4),
            "low_price": round(indicators.get('low', price), 4),
            "volume": int(indicators.get('volume', 0)),
            "price_change": round(change, 4),
            "price_change_percent": round(change_pct, 4),
            "last_update": analysis.time.strftime('%Y-%m-%d %H:%M:%S') if analysis.time else '',
            "source": "tradingview-ta",
            "success": True
        }
    except Exception as e:
        return {
            "ticker": symbol,
            "error": str(e),
            "success": False
        }

def fetch_batch(tickers: list) -> dict:
    """Fetch quotes for multiple tickers."""
    results = []
    errors = []
    
    for tv_symbol, display_ticker in tickers:
        quote = fetch_quote(tv_symbol)
        if quote.get('success'):
            quote['ticker'] = display_ticker  # Use display ticker
            results.append(quote)
        else:
            errors.append({"ticker": display_ticker, "error": quote.get('error')})
    
    return {
        "results": results,
        "errors": errors,
        "total_fetched": len(results),
        "total_errors": len(errors)
    }

def fetch_all_stocks() -> dict:
    """Fetch all known EGX stocks."""
    return fetch_batch(EGX_STOCKS)

def fetch_all_indices() -> dict:
    """Fetch all EGX indices."""
    return fetch_batch(EGX_INDICES)

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python3 tv_fetcher.py [quote|batch|all|indices] [symbols...]"}))
        sys.exit(1)
    
    command = sys.argv[1].lower()
    
    if command == "quote" and len(sys.argv) >= 3:
        symbol = sys.argv[2].upper()
        result = fetch_quote(symbol)
        print(json.dumps(result))
    
    elif command == "batch" and len(sys.argv) >= 3:
        symbols = [s.strip().upper() for s in sys.argv[2].split(',')]
        # Map symbols to known TradingView symbols
        ticker_map = {t: s for s, t in EGX_STOCKS}
        tickers = [(ticker_map.get(s, s), s) for s in symbols]
        result = fetch_batch(tickers)
        print(json.dumps(result))
    
    elif command == "all":
        result = fetch_all_stocks()
        print(json.dumps(result))
    
    elif command == "indices":
        result = fetch_all_indices()
        print(json.dumps(result))
    
    else:
        print(json.dumps({"error": f"Unknown command: {command}"}))

if __name__ == "__main__":
    main()
