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

الـ shim بيـ import كل module من engines/ ويعمل re-export. لو الـ module
مش موجود في engines/، الـ import هيـ fail (عمدًا — عشان نكتشف الـ regressions).
"""
import importlib
import sys

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
    """اعمل re-export لكل module من engines/."""
    for mod_name in _MOVED_MODULES:
        try:
            # import من engines/ (canonical)
            canonical = importlib.import_module(f'engines.{mod_name}')
            # خليه متاح كـ engine.{mod_name}
            sys.modules[f'engine.{mod_name}'] = canonical
            setattr(sys.modules[__name__], mod_name, canonical)
        except Exception as e:
            # لو الـ import فشل، سجّله بس — ما تكسرش الـ package
            pass


_reexport()
