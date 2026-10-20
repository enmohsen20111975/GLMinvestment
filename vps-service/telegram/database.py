"""
telegram/database.py — COMPATIBILITY SHIM (BRAVO STAGE-2 CORE-UNIFY)
====================================================================
**تم نقل هذا الملف لـ telegram/telegram_db.py** عشان نتجنب الـ naming collision
مع core/database.py (اللي فيه DatabaseManager class مختلف).

الـ canonical location دلوقتي: `vps-service/telegram/telegram_db.py`

استخدام قديم (لسه شغال عبر shim):
    from telegram.database import db_manager

استخدام جديد (canonical):
    from telegram.telegram_db import db_manager

الـ shim بيـ re-export كل الـ public API من telegram_db.py.
"""
from telegram.telegram_db import *  # noqa: F401, F403
from telegram.telegram_db import db_manager  # explicit re-export for clarity
