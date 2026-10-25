#!/usr/bin/env python3
"""
Telegram News Scraper (Bot-Based) - جامع أخبار قنوات تيليجرام
===============================================================
يستخدم Bot API لاستقبال الرسائل الجديدة من القنوات
(يلزم إضافة البوت كأدمن في كل قناة)

للحصول على تاريخي: يستخدم Bot API getUpdates أو webhook
"""
from __future__ import annotations
import os, re, sys, json, asyncio, logging, hashlib, sqlite3
import urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
from pathlib import Path

SERVICE_DIR = Path(__file__).parent
ROOT_DIR = SERVICE_DIR.parent.parent
if str(SERVICE_DIR.parent) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR.parent))

def load_env():
    env_path = ROOT_DIR / ".env"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    k_clean = k.strip()
                    val = v.strip().strip('"').strip("'")
                    if not os.environ.get(k_clean):
                        os.environ[k_clean] = val

load_env()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SCRAPER] %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger("telegram_news_scraper")

# Telethon for USER session (if available)
try:
    from telethon import TelegramClient, events
    from telethon.tl.types import MessageMediaPhoto
    from telethon.errors import FloodWaitError, ChannelPrivateError
    TELETHON_OK = True
except ImportError:
    TELETHON_OK = False

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
API_ID = int(os.environ.get("TELEGRAM_API_ID", "") or "34557076")
API_HASH = os.environ.get("TELEGRAM_API_HASH", "fe604a9844bf753210acb4e648af4155")

# القنوات التي أضفنا فيها البوت كأدمن أو مشرف
# استبدل بالـ chat_id الحقيقي إذا عرفته
TARGET_CHANNELS_USERNAMES = [
    "sahmmisr",
    "EGXAlerts",
    "arabianinvestment",
    "BorsaMisr",
]

# User session path (لو وُجدت جلسة مستخدم حقيقية)
USER_SESSION_PATHS = [
    str(SERVICE_DIR / "telegram_user_session"),
    str(SERVICE_DIR / "telegram_session_user"),
]

PREDICTION_RE = re.compile(
    r"(مستهدف|هدف|سعر مستهدف|توقع ارتفاع|توقع هبوط|نتوقع|دعم|مقاومة|شراء عند|بيع عند|وقف خسارة)",
    re.IGNORECASE | re.UNICODE
)

TICKER_RE = re.compile(
    r"\b(COMI|HRHO|EKHO|SKPC|ORWE|AMOC|TMGH|EFID|FWRY|SWDY|GBCO|EGTS|EGAS|OCDI|PHDC|CLHO|JUFO|FWST|SMID|MENA|MNHD|DNII|ESRS|CIRA|KABO|ETEL|LCSW|AMER|AREC|HELI|OTMT|RAAM|SVCE|AFDI|NCGC|ADMG|EGX30)\b",
    re.IGNORECASE
)

MIN_MSG_LENGTH = 50
MAX_NEWS_AGE_HOURS = 72
DB_PATH = ROOT_DIR / "db" / "news.db"


class NewsDatabase:
    def __init__(self):
        self.db_path = DB_PATH
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS channel_news (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    msg_id INTEGER NOT NULL,
                    channel TEXT NOT NULL,
                    channel_title TEXT,
                    text TEXT NOT NULL,
                    date TEXT NOT NULL,
                    has_media INTEGER DEFAULT 0,
                    media_type TEXT,
                    msg_hash TEXT UNIQUE,
                    tickers TEXT,
                    is_prediction INTEGER DEFAULT 0,
                    importance INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS expert_predictions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT,
                    prediction_text TEXT NOT NULL,
                    source_channel TEXT,
                    direction TEXT,
                    price_target REAL,
                    support_level REAL,
                    resistance_lvl REAL,
                    occurrence_count INTEGER DEFAULT 1,
                    first_seen TEXT DEFAULT (datetime('now')),
                    last_seen TEXT DEFAULT (datetime('now')),
                    msg_hash TEXT UNIQUE
                );
                CREATE TABLE IF NOT EXISTS channel_stats (
                    channel TEXT PRIMARY KEY,
                    channel_title TEXT,
                    total_messages INTEGER DEFAULT 0,
                    predictions INTEGER DEFAULT 0,
                    last_scraped TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_cn_date ON channel_news(date DESC);
                CREATE INDEX IF NOT EXISTS idx_pred_count ON expert_predictions(occurrence_count DESC);
            """)
        log.info(f"DB ready: {self.db_path}")

    def save_news(self, item):
        try:
            with self._connect() as conn:
                conn.execute("""
                    INSERT OR IGNORE INTO channel_news
                    (msg_id,channel,channel_title,text,date,has_media,media_type,msg_hash,tickers,is_prediction,importance)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """, (item["msg_id"], item["channel"], item.get("channel_title",""), item["text"],
                      item["date"], int(item.get("has_media", False)), item.get("media_type",""),
                      item["msg_hash"], json.dumps(item.get("tickers",[]), ensure_ascii=False),
                      int(item.get("is_prediction", False)), item.get("importance", 1)))
                
                # ربط الأخبار ذات الأهمية المرتفعة بجدول market_news ليقوم محرك التليجرام برصدها وفحصها
                imp = item.get("importance", 1)
                if imp >= 3 and len(item.get("text", "")) >= 60:
                    urls = re.findall(r'https?://[^\s]+', item["text"])
                    source_url = urls[0] if urls else f"https://t.me/{item['channel']}/{item['msg_id']}"
                    # استخراج العنوان من أول سطر
                    first_line = item["text"].strip().split('\n')[0][:120].strip()
                    first_line = re.sub(r'^[🔴⚡📢⚠️🚨📰]+\s*', '', first_line).strip()
                    title = first_line if len(first_line) >= 15 else item["text"][:80].strip()
                    
                    calc_imp = 80 if imp >= 4 else 75
                    conn.execute("""
                        INSERT OR IGNORE INTO market_news
                        (title, content, summary_ar, source, source_type, url, tickers, importance, sentiment, is_sent, published_at, fetched_at)
                        VALUES (?, ?, ?, ?, 'telegram', ?, ?, ?, 'neutral', 0, ?, datetime('now'))
                    """, (
                        title, item["text"], item["text"][:300],
                        item.get("channel_title") or item["channel"],
                        source_url,
                        json.dumps(item.get("tickers", []), ensure_ascii=False),
                        calc_imp,
                        item["date"]
                    ))
                return conn.rowcount > 0
        except Exception as e:
            log.error(f"save_news error: {e}")
            return False

    def save_prediction(self, pred):
        try:
            with self._connect() as conn:
                ex = conn.execute("SELECT id FROM expert_predictions WHERE msg_hash=?", (pred["msg_hash"],)).fetchone()
                if ex:
                    conn.execute("UPDATE expert_predictions SET occurrence_count=occurrence_count+1, last_seen=datetime('now') WHERE msg_hash=?", (pred["msg_hash"],))
                else:
                    conn.execute("""
                        INSERT OR IGNORE INTO expert_predictions
                        (ticker,prediction_text,source_channel,direction,price_target,support_level,resistance_lvl,msg_hash)
                        VALUES (?,?,?,?,?,?,?,?)
                    """, (pred.get("ticker"), pred["prediction_text"], pred["source_channel"],
                          pred.get("direction","NEUTRAL"), pred.get("price_target"),
                          pred.get("support_level"), pred.get("resistance_lvl"), pred["msg_hash"]))
        except Exception as e:
            log.error(f"save_prediction error: {e}")

    def update_stats(self, channel, title, msgs, preds):
        with self._connect() as conn:
            conn.execute("""
                INSERT INTO channel_stats (channel,channel_title,total_messages,predictions,last_scraped)
                VALUES (?,?,?,?,datetime('now'))
                ON CONFLICT(channel) DO UPDATE SET
                    channel_title=excluded.channel_title,
                    total_messages=total_messages+excluded.total_messages,
                    predictions=predictions+excluded.predictions,
                    last_scraped=datetime('now')
            """, (channel, title, msgs, preds))

    def hash_exists(self, h):
        with self._connect() as conn:
            return bool(conn.execute("SELECT 1 FROM channel_news WHERE msg_hash=?", (h,)).fetchone())

    def get_top_predictions(self, limit=20):
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM expert_predictions ORDER BY occurrence_count DESC, last_seen DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def get_news_count(self):
        with self._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM channel_news").fetchone()[0]


def compute_hash(channel, msg_id, text):
    return hashlib.sha256(f"{channel}:{msg_id}:{text[:100]}".encode()).hexdigest()[:16]

def extract_tickers(text):
    try:
        from utils.egx_tickers import extract_egx_tickers
        smart = extract_egx_tickers(text)
        if smart:
            return smart
    except Exception:
        pass
    return list(set(TICKER_RE.findall(text.upper())))

def is_prediction(text):
    return bool(PREDICTION_RE.search(text))

def extract_price_target(text):
    m = re.search(r"(?:مستهدف|هدف)[:\s]*([0-9]+(?:\.[0-9]+)?)", text)
    return float(m.group(1)) if m else None

def extract_support(text):
    m = re.search(r"دعم[:\s]*([0-9]+(?:\.[0-9]+)?)", text)
    return float(m.group(1)) if m else None

def extract_resistance(text):
    m = re.search(r"مقاومة[:\s]*([0-9]+(?:\.[0-9]+)?)", text)
    return float(m.group(1)) if m else None

def detect_direction(text):
    up = sum(1 for w in ["ارتفاع","صعود","شراء","ايجابي","bullish","buy"] if w in text.lower())
    dn = sum(1 for w in ["هبوط","تراجع","بيع","سلبي","bearish","sell","انخفاض"] if w in text.lower())
    return "UP" if up > dn else ("DOWN" if dn > up else "NEUTRAL")

def calc_importance(text, has_media):
    if any(w in text for w in ["عاجل","هام","تحذير","breaking"]): return 5
    if any(w in text for w in ["قرار","نتائج","أرباح","خسائر","اندماج","توزيع أرباح"]): return 4
    if has_media: return 3
    if len(text) > 300: return 3
    return 1

CHAT_FILTER_RE = re.compile(
    r'(\[رد على|رد على[:\s]|in reply to|معايا بره|عاوز اعرف|عايز اعرف|يعني اي|يعني ايه|'
    r'ربنا يوفقك|صباح الخير|مساء الخير|يا شباب|يا رجالة|يا جماعة|حد يفيد|رأيكم ايه|'
    r'ميعادها امته|ميعادها امتى|تسلم|شكرا|بالله عليك|هو كمان|لو سمحت|حد يفهمني)',
    re.IGNORECASE | re.UNICODE
)

def process_message(channel, channel_title, msg_id, text, date_ts, has_photo=False):
    text = text.strip()
    if len(text) < MIN_MSG_LENGTH:
        return None
    # تصفية ردود الشات والدردشة غير المهنية
    if text.startswith('[رد') or CHAT_FILTER_RE.search(text):
        return None
    if date_ts:
        try:
            if isinstance(date_ts, (int, float)):
                msg_time = datetime.fromtimestamp(date_ts, tz=timezone.utc)
            else:
                msg_time = datetime.fromisoformat(str(date_ts))
                if msg_time.tzinfo is None:
                    msg_time = msg_time.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - msg_time > timedelta(hours=MAX_NEWS_AGE_HOURS):
                return None
            date_str = msg_time.isoformat()
        except Exception:
            date_str = datetime.utcnow().isoformat()
    else:
        date_str = datetime.utcnow().isoformat()

    tickers = extract_tickers(text)
    pred = is_prediction(text)
    imp = calc_importance(text, has_photo)
    h = compute_hash(channel, msg_id, text)
    media_type = "photo" if has_photo else ""

    item = {
        "msg_id": msg_id, "channel": channel, "channel_title": channel_title,
        "text": text, "date": date_str, "has_media": has_photo, "media_type": media_type,
        "msg_hash": h, "tickers": tickers, "is_prediction": pred, "importance": imp
    }
    if pred:
        item["_prediction"] = {
            "ticker": tickers[0] if tickers else None,
            "prediction_text": text[:500],
            "source_channel": channel,
            "direction": detect_direction(text),
            "price_target": extract_price_target(text),
            "support_level": extract_support(text),
            "resistance_lvl": extract_resistance(text),
            "msg_hash": h,
        }
    return item


class TelegramNewsScraper:
    """
    Scraper ثنائي الوضع:
    1. USER SESSION: يستخدم Telethon مع user account (يقرأ التاريخ الكامل)
    2. BOT MODE: يستقبل الرسائل اللحظية عبر Bot API (لا يقرأ التاريخ)
    """

    def __init__(self, channels=None):
        self.channels = channels or TARGET_CHANNELS_USERNAMES
        self.db = NewsDatabase()
        self.client = None
        self.mode = "bot"  # "user" or "bot"

        # User session
        self.api_id = API_ID
        self.api_hash = API_HASH

        # Find existing user session
        self.user_session_path = None
        for sp in USER_SESSION_PATHS:
            if os.path.exists(sp + ".session"):
                self.user_session_path = sp
                break

    async def connect(self):
        if not TELETHON_OK:
            log.warning("Telethon not available - bot mode only")
            self.mode = "bot"
            return True

        # Try user session first
        if self.user_session_path:
            try:
                self.client = TelegramClient(
                    self.user_session_path, self.api_id, self.api_hash,
                    system_version="4.16.30-vxCUSTOM"
                )
                await self.client.connect()
                if await self.client.is_user_authorized():
                    me = await self.client.get_me()
                    if not me.bot:
                        log.info(f"USER mode: Connected as {me.first_name} ({me.phone})")
                        self.mode = "user"
                        return True
                    else:
                        log.warning("Session is a BOT - cannot read channel history")
                await self.client.disconnect()
            except Exception as e:
                log.error(f"User session failed: {e}")

        # Fallback to bot mode (real-time only)
        log.info("BOT mode: Using Bot API (real-time updates only, no history)")
        log.info("To enable full history scraping, run: python3 telegram_news_scraper.py --create-session")
        self.mode = "bot"
        self.client = None
        return True

    async def disconnect(self):
        if self.client:
            await self.client.disconnect()

    async def backfill_channel_user(self, channel_id, limit=200):
        """جلب تاريخي - USER MODE فقط"""
        if not self.client or self.mode != "user":
            return 0, 0
        saved, preds = 0, 0
        channel_title = channel_id
        try:
            entity = await self.client.get_entity(channel_id)
            channel_title = getattr(entity, "title", channel_id)
            log.info(f"Scraping: {channel_title} (limit={limit})")
            async for msg in self.client.iter_messages(entity, limit=limit):
                if not msg.message:
                    continue
                # تجاهل الردود في الشاتات ومجموعات النقاش
                if getattr(msg, 'is_reply', False) or getattr(msg, 'reply_to_msg_id', None):
                    continue
                has_photo = hasattr(msg, "media") and isinstance(msg.media, MessageMediaPhoto)
                item = process_message(channel_id, channel_title, msg.id,
                                       msg.message, msg.date, has_photo)
                if not item or self.db.hash_exists(item["msg_hash"]):
                    continue
                if self.db.save_news(item):
                    saved += 1
                if "_prediction" in item:
                    self.db.save_prediction(item["_prediction"])
                    preds += 1
                await asyncio.sleep(0.05)
        except ChannelPrivateError:
            log.warning(f"Channel {channel_id} is private")
        except FloodWaitError as e:
            log.warning(f"Flood wait {e.seconds}s")
            await asyncio.sleep(e.seconds)
        except Exception as e:
            log.error(f"Error scraping {channel_id}: {e}")
        self.db.update_stats(channel_id, channel_title, saved, preds)
        log.info(f"  Done {channel_title}: {saved} news, {preds} predictions")
        return saved, preds

    async def backfill_all(self, limit_per_channel=200):
        if self.mode != "user":
            log.warning("Backfill requires USER session. Run --create-session first.")
            log.info("Starting in BOT polling mode instead...")
            return 0, 0
        total_s, total_p = 0, 0
        for ch in self.channels:
            s, p = await self.backfill_channel_user(ch, limit_per_channel)
            total_s += s
            total_p += p
            await asyncio.sleep(2)
        log.info(f"TOTAL: {total_s} news, {total_p} predictions")
        return total_s, total_p

    async def bot_polling_loop(self):
        """
        Bot API polling - يستقبل الرسائل الجديدة من القنوات
        (يلزم إضافة البوت كأدمن في القنوات)
        """
        if not BOT_TOKEN:
            log.error("BOT_TOKEN not set!")
            return

        base_url = f"https://api.telegram.org/bot{BOT_TOKEN}"
        offset = 0
        log.info(f"Bot polling started (watching {len(self.channels)} channels)...")

        def fetch_updates(off):
            url = f"{base_url}/getUpdates?offset={off}&timeout=30&limit=100"
            req = urllib.request.Request(url, headers={"User-Agent": "GLMTelegramScraper/1.0"})
            with urllib.request.urlopen(req, timeout=40) as resp:
                return json.loads(resp.read().decode())

        while True:
            try:
                data = await asyncio.to_thread(fetch_updates, offset)
                if not data.get("ok"):
                    log.error(f"API error: {data}")
                    await asyncio.sleep(5)
                    continue

                updates = data.get("result", [])
                for update in updates:
                    offset = update["update_id"] + 1
                    await self._handle_bot_update(update)

                if not updates:
                    await asyncio.sleep(1)

            except urllib.error.URLError as e:
                log.error(f"Network error: {e}")
                await asyncio.sleep(10)
            except Exception as e:
                log.error(f"Polling error: {e}")
                await asyncio.sleep(5)

    async def _handle_bot_update(self, update):
        """معالجة update من البوت"""
        msg_data = update.get("channel_post") or update.get("message")
        if not msg_data:
            return

        chat = msg_data.get("chat", {})
        chat_type = chat.get("type", "")
        if chat_type not in ("channel", "supergroup"):
            return

        # تجاهل تام لأي ردود على رسائل أخرى
        if msg_data.get("reply_to_message"):
            return

        # تحقق أن القناة في قائمتنا
        username = (chat.get("username") or "").lower()
        chat_id = str(chat.get("id", ""))
        channel_key = username if username else chat_id

        if username and username not in [c.lower() for c in self.channels]:
            return

        text = msg_data.get("text") or msg_data.get("caption") or ""
        msg_id = msg_data.get("message_id", 0)
        date_ts = msg_data.get("date", 0)
        channel_title = chat.get("title", username or chat_id)
        has_photo = bool(msg_data.get("photo"))

        item = process_message(channel_key, channel_title, msg_id, text, date_ts, has_photo)
        if not item or self.db.hash_exists(item["msg_hash"]):
            return

        if self.db.save_news(item):
            tag = "URGENT" if item["importance"] >= 4 else "NEWS"
            log.info(f"[{tag}] [{channel_title}] {text[:80]}...")
        if "_prediction" in item:
            self.db.save_prediction(item["_prediction"])
            log.info(f"  PREDICTION from {channel_title}")

    async def start_user_monitoring(self):
        """مراقبة لحظية - USER MODE"""
        if not self.client:
            return
        channel_usernames = [c.lower() for c in self.channels]

        @self.client.on(events.NewMessage())
        async def handler(event):
            try:
                chat = await event.get_chat()
                username = (getattr(chat, "username", None) or "").lower()
                if username not in channel_usernames:
                    return
                msg = event.message
                if not msg.message:
                    return
                # تجاهل الردود بين المشتركين في قنوات الدردشة
                if getattr(msg, 'is_reply', False) or getattr(msg, 'reply_to_msg_id', None):
                    return
                channel_title = getattr(chat, "title", username)
                has_photo = hasattr(msg, "media") and isinstance(msg.media, MessageMediaPhoto)
                item = process_message(username, channel_title, msg.id,
                                       msg.message, msg.date, has_photo)
                if not item or self.db.hash_exists(item["msg_hash"]):
                    return
                if self.db.save_news(item):
                    tag = "URGENT" if item["importance"] >= 4 else "NEWS"
                    log.info(f"[{tag}] [{channel_title}] {msg.message[:80]}...")
                if "_prediction" in item:
                    self.db.save_prediction(item["_prediction"])
            except Exception as e:
                log.error(f"Handler error: {e}")

        log.info("USER live monitoring: " + ", ".join(self.channels))
        await self.client.run_until_disconnected()

    def get_summary(self):
        preds = self.db.get_top_predictions(10)
        total = self.db.get_news_count()
        lines = [f"Total news in DB: {total}", f"Mode: {self.mode}", "", "Top Expert Predictions:"]
        for i, p in enumerate(preds, 1):
            arrow = "UP" if p["direction"] == "UP" else ("DOWN" if p["direction"] == "DOWN" else "--")
            ticker = p.get("ticker") or "?"
            lines.append(f"{i}. [{arrow}] {ticker} - {p['prediction_text'][:80]}... (x{p['occurrence_count']})")
        return "\n".join(lines)


async def create_user_session():
    """إنشاء User Session (مرة واحدة فقط)"""
    print("\n=== إنشاء جلسة مستخدم Telegram ===")
    phone = input("📱 رقم الهاتف (مثال: +201234567890): ").strip()

    session_path = str(SERVICE_DIR / "telegram_user_session")
    client = TelegramClient(session_path, API_ID, API_HASH)
    await client.connect()

    if await client.is_user_authorized():
        me = await client.get_me()
        print(f"✅ الجلسة موجودة بالفعل: {me.first_name} ({me.phone})")
        await client.disconnect()
        return

    await client.send_code_request(phone)
    code = input("🔑 كود التحقق (من تيليجرام): ").strip()
    try:
        await client.sign_in(phone, code)
    except Exception:
        pwd = input("🔐 كلمة مرور 2FA (اتركها فارغة إن لم تكن مفعّلة): ").strip()
        if pwd:
            await client.sign_in(password=pwd)

    me = await client.get_me()
    print(f"\n✅ تم تسجيل الدخول: {me.first_name} ({me.phone})")
    print(f"✅ الجلسة محفوظة في: {session_path}.session")
    await client.disconnect()


async def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "live"

    if cmd == "--create-session":
        await create_user_session()
        return

    scraper = TelegramNewsScraper()
    await scraper.connect()

    if cmd == "--backfill":
        await scraper.backfill_all(300)
        print(scraper.get_summary())
        await scraper.disconnect()
    else:
        # Live mode
        if scraper.mode == "user":
            await scraper.backfill_all(100)
            await scraper.start_user_monitoring()
        else:
            # Bot polling mode
            await scraper.bot_polling_loop()


if __name__ == "__main__":
    asyncio.run(main())
