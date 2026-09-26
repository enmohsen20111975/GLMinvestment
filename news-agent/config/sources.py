"""
سجل مركزي لكل مصادر الأخبار
==============================
كل مصدر له:
- display_name: الاسم اللي بيظهر على الموقع Official
- source_type: النوع (telegram, web, rss, copy)
- enabled: هل هو مفعّل

مميزات التصميم:
- Telegram sources كلها بتظهر كـ «تيليجرام» (موحد)
- المواقع بتظهر باسمها الحقيقي (مثل «journalist البورصة»)
- سهل إضافة مصدر جديد من غير كود
- محفوظ كـ JSON لل Editing يدي لو محتاج
"""

import os
import json
import logging
from pathlib import Path

log = logging.getLogger('SourceRegistry')

REGISTRY_PATH = Path(__file__).parent / 'sources.json'

DEFAULT_SOURCES = {
    # Telegram — كل القنوات بتتجمع تحت اسم موحدة «تيليجرام»
    'telegram': {
        'display_name': 'تيليجرام',
        'source_type': 'telegram',
        'enabled': True,
        'description': 'قنوات تيليجرام متخصصة في البورصة المصرية',
        'channels': [
            'sahmmisr',
            'borsablarabi',
            'easier_stock',
            'ostoulcapital',
            'BursaAcademy',
            'borsabelarabi96',
            'MubasherTA',
            'egyptianborsa',
            'shariaStocksEG',
            'AhmedMansourstocks',
            'egxpilot',
            'SOM3AEG',
            'egx_professinals',
            'Arabian_investment_guide',
        ],
    },
    # RSS feeds
    'rss_amwal': {
        'display_name': 'أموال الغد',
        'source_type': 'rss',
        'enabled': True,
        'description': 'أموال الغد (Amwal Al-Ghad)',
        'feeds': ['https://www.amwalalghad.com/feed/'],
    },
    'rss_masrawy': {
        'display_name': 'mastafy',
        'source_type': 'rss',
        'enabled': True,
        'description': 'mastafy - اقتصاد (RSS feed ID 206)',
        'feeds': ['https://www.masrawy.com/rss/feed/206/%D8%A7%D9%82%D8%AA%D8%B5%D8%A7%D8%AF'],
    },
    'rss_hapijournal': {
        'display_name': 'حابي',
        'source_type': 'rss',
        'enabled': True,
        'description': 'حابي - سوق المال + البنوك + Investment (RSS feed)',
        'feeds': ['https://hapijournal.com/feed/'],
    },
'rss_youm7': {
        'display_name': 'اليوم السابع - اقتصاد',
        'source_type': 'rss',
        'enabled': True,
        'description': 'اليوم السابع - قسم الاقتصاد',
        'feeds': ['https://www.youm7.com/Section/56/RSS'],
    },
    'rss_argaam': {
        'display_name': 'أرقام',
        'source_type': 'rss',
        'enabled': True,
        'description': 'أرقام (Argaam)',
        'feeds': ['https://argaam.com/ar/rss'],
    },
    # Web scraping
    'web_duckduckgo': {
        'display_name': 'بحث ويب',
        'source_type': 'web',
        'enabled': True,
        'description': 'بحث DuckDuckGo عبر GLMinvestment analyzer',
    },
    'web_alborsaa': {
        'display_name': 'journalist البورصة',
        'source_type': 'web',
        'enabled': True,
        'description': 'journalist البورصة - قسم البورصة والوات',
    },
    'web_almalnews': {
        'display_name': 'journalist المال',
        'source_type': 'web',
        'enabled': True,
        'description': 'journalist المال - أخبار الشركة + البورصة + الإفصالات',
    },
    'web_mubasher': {
        'display_name': 'مباشر',
        'source_type': 'web',
        'enabled': True,
        'description': 'مباشر - البورصة المصرية (Mubasher) - HTML scraping',
    },
}


class SourceRegistry:
    """يدير خريطة المصادر وأسماء العرض"""

    def __init__(self):
        self._sources = self._load_or_create()
        self._telegram_channels = self._index_telegram_channels()

    def _load_or_create(self) -> dict:
        if REGISTRY_PATH.exists():
            try:
                with open(REGISTRY_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if data:
                        return data
            except (json.JSONDecodeError, OSError) as e:
                log.warning(f'فشل قراءة sources.json: {e} —عيد التهيئة')

        REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(REGISTRY_PATH, 'w', encoding='utf-8') as f:
            json.dump(DEFAULT_SOURCES, f, ensure_ascii=False, indent=2)
        log.info(f'تم إنشاء sources.json في {REGISTRY_PATH}')
        return DEFAULT_SOURCES

    def _index_telegram_channels(self) -> dict:
        """يرجع dict: channel_name → display_name (دايماً «تيليجرام»)"""
        tg = self._sources.get('telegram', {})
        name = tg.get('display_name', 'تيليجرام') if tg.get('enabled', True) else 'تيليجرام'
        return {ch: name for ch in tg.get('channels', [])}

    def get_telegram_display(self, channel_id_or_username: str) -> str:
        """يرجع الاسم الموحد لأي channel تيليجرام"""
        if not self._telegram_channels:
            return 'تيليجرام'
        cleaned = channel_id_or_username.lstrip('@').lower()
        for ch, name in self._telegram_channels.items():
            if ch.lower().lstrip('@') == cleaned:
                return name
        return 'تيليجرام'

    def get_rss_display(self, feed_url: str, fallback_title: str = '') -> str:
        """يرجع name الـ RSS feed بناءً على الـ URL"""
        url_lower = feed_url.lower()
        for key, info in self._sources.items():
            if info.get('source_type') != 'rss' or not info.get('enabled'):
                continue
            for feed in info.get('feeds', []):
                if feed.lower() in url_lower or url_lower in feed.lower():
                    return info['display_name']
        return fallback_title or 'RSS'

    def get_web_display(self, source_key: str, fallback: str) -> str:
        """يرجع name موقع الـ web scraping"""
        info = self._sources.get(source_key)
        if info and info.get('enabled'):
            return info['display_name']
        return fallback

    def all_display_names(self) -> set:
        return {
            info['display_name']
            for info in self._sources.values()
            if info.get('enabled', True)
        }

    def is_egyptian_source_label(self, label: str) -> bool:
        """هل الـ label ده لمصدر مصري جديد في فترة grace؟"""
        for key, info in self._sources.items():
            if info.get('source_type') == 'web' and info.get('enabled'):
                if info.get('display_name') == label:
                    return True
        return False


registry = SourceRegistry()