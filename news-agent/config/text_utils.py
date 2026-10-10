"""
تنظيف النصوص من HTML
=====================
بعض الـ RSS feeds بيبعتوا الـ summary كـ block HTML كامل
(<div><img …/><p>…</p></div>)، والأangklish boilerplate بتاع WordPress
("The post <a>title</a> appeared first on <a>site</a>.").

أي نص جاي من collector لازم يعدي من هنا قبل ما يتحفظ أو يتعرض.
"""

import re

_HTML_BLOCK_RE = re.compile(r'<(?:script|style)[^>]*>.*?</(?:script|style)>', re.I | re.S)
_HTML_BR_RE = re.compile(r'<br\s*/?>|</p\s*>|</div\s*>|</li\s*>', re.I)
_HTML_ANY_RE = re.compile(r'<[^>]+>')
_WP_BOILERPLATE_RE = re.compile(
    r'(?is)\n*\s*\bthe\s+post\b.*?\b(?:appeared\s+first\s+on|was\s+first\s+published\s+on)\b.*\Z'
)
_ENTITY_RE = re.compile(r'&#(\d+);')
_SPACE_RE = re.compile(r'[ \t]+')
_MULTI_NL_RE = re.compile(r'\n{3,}')

ENTITIES = {
    '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'",
    '&#8220;': '«', '&#8221;': '»', '&#8216;': '‘', '&#8217;': '’',
    '&#8230;': '…', '&lt;': '<', '&gt;': '>', '&mdash;': '—', '&ndash;': '–',
    '&laquo;': '«', '&raquo;': '»',
}


def strip_html(text: str, keep_newlines: bool = True) -> str:
    """يشيل HTML والكيانات وboilerplate — نفس النتيجة في بايثون والتايب سكربت."""
    if not text:
        return ''
    if '<' not in text and '&' not in text:
        return _WP_BOILERPLATE_RE.sub('', text).strip()

    text = _HTML_BLOCK_RE.sub(' ', text)
    text = (_HTML_BR_RE.sub('\n', text) if keep_newlines else _HTML_BR_RE.sub(' ', text))
    text = _HTML_ANY_RE.sub(' ', text)
    for ent, ch in ENTITIES.items():
        text = text.replace(ent, ch)
    text = _ENTITY_RE.sub(
        lambda m: chr(int(m.group(1))) if int(m.group(1)) < 65536 else '', text
    )
    text = _WP_BOILERPLATE_RE.sub('', text)
    text = _SPACE_RE.sub(' ', text)
    return _MULTI_NL_RE.sub('\n\n', text).strip()
