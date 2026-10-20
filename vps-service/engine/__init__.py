"""
engine/ — COMPATIBILITY SHIM (BRAVO STAGE-1 ENGINE-UNIFY)
==========================================================
**Rule 67 + Rule 60 (MODULE-SYSTEM)**: تم نقل كل محتويات engine/ لـ engines/
(canonical location). ده shim عشان backward compat — أي import من engine/
هيـ redirect لـ engines/.

الـ canonical location دلوقتي: `vps-service/engines/`

استخدام قديم (لسه شغال):
    from engine.flow_system import ...
    from engine.crypto_engine import ...

استخدام جديد (canonical):
    from engines.flow_system import ...
    from engines.crypto_engine import ...

الـ shim بيـ import كل module من engines/ ويعمل re-export. لو الـ import
فشل، بـ يسجّل الـ error في logging (مش silent swallow) عشان الـ debug يكون
سهل. الـ failure مش بيكسر الـ package كله — بس الـ module ده بالذات هيكون None.
"""
import importlib
import logging
import sys

logger = logging.getLogger(__name__)

# قائمة الـ modules اللي اتـ نقلوا من engine/ لـ engines/
_MOVED_MODULES = [
    'crypto_engine',
    'explosive_scanner',
    'flow_system',
    'historical_backfill_engine',
    'paper_trade_tracker',
    'persona_engine',
    'stock_fundamentals',
]


def _reexport():
    """اعمل re-export لكل module من engines/ — سجّل الأخطاء بدلاً من silent swallow."""
    failed = []
    for mod_name in _MOVED_MODULES:
        try:
            # import من engines/ (canonical)
            canonical = importlib.import_module(f'engines.{mod_name}')
            # خليه متاح كـ engine.{mod_name}
            sys.modules[f'engine.{mod_name}'] = canonical
            setattr(sys.modules[__name__], mod_name, canonical)
        except Exception as e:
            # سجّل الـ error صراحةً (مش silent swallow) عشان الـ debug يكون سهل
            logger.error(
                "engine shim: failed to re-export engine.%s from engines.%s: %s",
                mod_name, mod_name, e, exc_info=True
            )
            failed.append(mod_name)
    if failed:
        logger.warning(
            "engine shim: %d/%d modules failed to re-export: %s",
            len(failed), len(_MOVED_MODULES), ", ".join(failed)
        )
    return failed


_reexport()
