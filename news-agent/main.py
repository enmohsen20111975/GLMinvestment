"""
NewsAgent — العقل المحلي لتحليل أخبار البورصة
==============================================
يجمع أخبار من Telegram + Web + RSS
يحللها بنموذج Ollama محلي
يبعت النتيجة للسيرفر الإنتاجي كـ JSON منظم
"""

import os
import sys
import asyncio
import signal
import logging
import json
from pathlib import Path
from datetime import datetime, timedelta

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, 'reconfigure'):
        _stream.reconfigure(encoding='utf-8', errors='replace')

# تأكد إن المسار صح
sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.text import Text

load_dotenv()

from collectors.telegram_collector import TelegramCollector
from collectors.telegram_web_collector import TelegramWebCollector
from collectors.web_scraper import WebScraper
from collectors.rss_collector import RSSCollector
from collectors.egyptian_sources import EgyptianSourcesCollector
from analyzer.news_analyzer import NewsAnalyzer
from analyzer.vision_analyzer import VisionAnalyzer
from analyzer.recommendation_aggregator import RecommendationAggregator
from sender.production_sender import ProductionSender
from sender.social_publisher import SocialPublisher
from sender.db_writer import NewsDBWriter
from data.news_store import NewsStore

# ── إعداد اللوج ───────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('data/agent.log', encoding='utf-8'),
    ]
)
log = logging.getLogger('NewsAgent')
console = Console()


class NewsAgent:
    """المحرك الرئيسي لوكيل الأخبار المحلي"""

    def __init__(self):
        self.store    = NewsStore()
        self.analyzer = NewsAnalyzer()
        self.vision   = VisionAnalyzer()
        self.sender   = ProductionSender()
        # DATA-ENGINE-UNIFY-1 / News Stage 1: bypass Node.js — write directly to news.db
        self.db_writer = NewsDBWriter()
        self.social   = SocialPublisher()
        self.recommender = RecommendationAggregator(self.store)
        self.running  = False

        self.collectors = [WebScraper(self.store), RSSCollector(self.store)]
        # DATA-ENGINE-UNIFY-1 / News: التليجرام معطّل — التركيز على السحب من المواقع
        # المالك: "مش عايز أخبار من التليجرام، التركيز على السحب من المواقع"
        # لو محتاجين تفعيله تاني: TELEGRAM_WEB_ENABLED=1
        if os.getenv('TELEGRAM_WEB_ENABLED', '0').lower() in ('1', 'true', 'yes', 'on'):
            self.collectors.append(TelegramWebCollector(self.store))
        telegram_creds = all([
            os.getenv('TELEGRAM_API_ID'),
            os.getenv('TELEGRAM_API_HASH'),
        ])
        # Telethon (MTProto) معطّل كمان — لو محتاجينه: TELEGRAM_MTPROTO_ENABLED=1
        if telegram_creds and os.getenv('TELEGRAM_MTPROTO_ENABLED', '0').lower() in ('1', 'true', 'yes'):
            self.collectors.insert(0, TelegramCollector(self.store))
        if os.getenv('ENABLE_EGYPTIAN_SOURCES', '0').lower() in ('1', 'true', 'yes'):
            self.collectors.append(EgyptianSourcesCollector(self.store))

        self._register_sources()

    async def _collect_all(self):
        """جمع الأخبار من كل المصادر بالتوازي"""
        console.print("[cyan]⚡ جمع الأخبار من كل المصادر...[/cyan]")
        tasks = [c.collect() for c in self.collectors]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        total = 0
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                log.warning(f"Collector {self.collectors[i].__class__.__name__} error: {r}")
            else:
                total += r or 0
        console.print(f"[green]  ✓ تم جمع {total} خبر جديد[/green]")
        return total

    async def _analyze_pending(self):
        """تحليل الأخبار الجديدة بـ Ollama"""
        pending = self.store.get_pending_analysis(limit=50)
        if not pending:
            return 0
        console.print(f"[yellow]🧠 تحليل {len(pending)} خبر بنموذج محلي...[/yellow]")
        analyzed = 0
        for news in pending:
            try:
                result = await self.analyzer.analyze(news)
                self.store.save_analysis(news['id'], result)
                analyzed += 1
            except Exception as e:
                log.warning(f"Analysis error for {news['id']}: {e}")
        console.print(f"[green]  ✓ تم تحليل {analyzed} خبر[/green]")
        return analyzed

    async def _send_important(self):
        """إرسال الأخبار المهمة للموقع + منصات التواصل"""
        min_score = int(os.getenv('MIN_IMPORTANCE_SCORE', 55))
        max_batch  = int(os.getenv('MAX_NEWS_PER_BATCH', 20))
        items = self.store.get_important_unsent(min_score=min_score, limit=max_batch)

        threshold = self._importance_threshold()
        new_source_sources = self._new_source_labels()

        valid_items = []
        for item in items:
            raw_analysis = item.get('raw_analysis', '{}')
            if isinstance(raw_analysis, str):
                try:
                    raw_analysis = json.loads(raw_analysis)
                except Exception:
                    raw_analysis = {}

            if not raw_analysis.get('is_valid_news', True):
                continue

            score = raw_analysis.get('importance', item.get('importance', 0))
            item_source = item.get('source', '')

            if score < threshold:
                continue

            if item_source in new_source_sources and score < 75:
                continue

            valid_items.append(item)

        if not valid_items:
            return 0

        console.print(
            f"[magenta]📡 إرسال {len(valid_items)} خبر مهم "
            f"(threshold={threshold}, تم فلترة {len(items) - len(valid_items)})...[/magenta]"
        )

        # 1. كتابة مباشرة في news.db.market_news (بايثون — بدون Node.js)
        # DATA-ENGINE-UNIFY-1 / News Stage 1: canonical path = direct DB write
        db_written = await self.db_writer.write_batch(valid_items)

        # 2. (fallback) إرسال للموقع الرسمي عبر Node.js — لو Node شغال
        # لو Node مطفي، الأخبار بتوصل بـ Python مباشرة
        sent = await self.sender.send_batch(valid_items)
        sent_ids = [i['id'] for i in valid_items[:sent]]
        self.store.mark_sent(sent_ids)

        log.info(f'  📊 News batch: {db_written} DB-written, {sent} Node-forwarded')

        # 2. نشر على منصات التواصل (تيليجرام) للأخبار المؤثرة وذات الصلة بالأسهم
        # ─── TELEGRAM-FILTER (Task PHASE-2-COMPLETE-2026-10-07) ────────────────
        # العميل اشتكى إن الأخبار بتيجي على التليجرام بكميات كبيرة (80+ رسالة في كل مرة).
        # الفلتر الجديد:
        #   (أ) EGX فقط: mkt='EGX' (مش news عامة)
        #   (ب) درجة أهمية عالية: importance >= 70 (مش 50/60)
        #   (ج) لازم يكون فيه tickers مرتبطة (فيه EGX stock)
        #   (د) حد أقصى 10 رسائل لكل batch (لو cron كل 5 دقايق = ~80 رسالة/يوم كحد أقصى)
        social_platforms = [p.strip() for p in os.getenv('SOCIAL_PLATFORMS', 'telegram').split(',') if p.strip()]
        if not social_platforms:
            console.print('[dim]  ↳ النشر الاجتماعي متوقف لهذا الوكيل[/dim]')
            return sent

        # Config للفلتر (env-driven، تقدر تـ override)
        TG_MIN_IMPORTANCE = int(os.getenv('TG_MIN_IMPORTANCE', '70'))
        TG_REQUIRE_TICKERS = os.getenv('TG_REQUIRE_TICKERS', '1').lower() in ('1', 'true', 'yes', 'on')
        TG_MARKET_FILTER = os.getenv('TG_MARKET_FILTER', 'EGX').upper()
        TG_MAX_PER_BATCH = int(os.getenv('TG_MAX_PER_BATCH', '10'))

        # فلترة الأخبار المؤهلة للنشر على التليجرام
        tg_eligible = []
        for item in valid_items[:sent]:
            raw_analysis = item.get('raw_analysis', '{}')
            if isinstance(raw_analysis, str):
                try:
                    raw_analysis = json.loads(raw_analysis)
                except Exception:
                    raw_analysis = {}

            importance = raw_analysis.get('importance', item.get('importance', 0))
            is_catalyst = bool(raw_analysis.get('is_catalyst') or item.get('is_catalyst'))

            # (أ) درجة الأهمية: لازم >= TG_MIN_IMPORTANCE (default 70)
            if importance < TG_MIN_IMPORTANCE:
                continue

            # (ب) لازم يكون فيه tickers مرتبطة (لها صلة بأسهم EGX)
            item_tickers = item.get('tickers')
            if isinstance(item_tickers, str):
                try:
                    item_tickers = json.loads(item_tickers)
                except Exception:
                    item_tickers = []
            if not item_tickers and raw_analysis.get('tickers'):
                item_tickers = raw_analysis.get('tickers', [])

            if TG_REQUIRE_TICKERS and not item_tickers:
                continue

            # (ج) فلتر السوق: خبر EGX فقط (default)
            item_market = (item.get('market') or '').upper()
            if TG_MARKET_FILTER and item_market and item_market != TG_MARKET_FILTER:
                continue

            tg_eligible.append({
                'item': item,
                'raw_analysis': raw_analysis,
                'importance': importance,
                'is_catalyst': is_catalyst,
                'tickers': item_tickers,
            })

        # (د) حد أقصى 10 رسائل لكل batch — عشان التليجرام ما يغرقش
        # لو فيه catalyst قوي (importance >= 85) → له الأولوية
        tg_eligible.sort(key=lambda x: -x['importance'])
        tg_to_publish = tg_eligible[:TG_MAX_PER_BATCH]

        if not tg_to_publish:
            console.print(f'[dim]  ↳ مفيش أخبار جاية معايير التليجرام (EGX + importance≥{TG_MIN_IMPORTANCE} + tickers) — تخطّي النشر[/dim]')
            return sent

        console.print(f'[cyan]  📢 {len(tg_to_publish)} خبر مؤهل للتليجرام (من {len(valid_items[:sent])} تم تحليلهم) — importance≥{TG_MIN_IMPORTANCE}, market={TG_MARKET_FILTER}[/cyan]')

        for entry in tg_to_publish:
            item = entry['item']
            raw_analysis = entry['raw_analysis']
            is_catalyst = entry['is_catalyst']
            item_tickers = entry['tickers']
            importance = entry['importance']

            # (تم استخراج tickers + is_catalyst + importance فوق في الـ filter)
            # شروط النشر على تيليجرام (كلها اتطمنت في الفلتر فوق، بس نتأكد)
            should_publish = is_catalyst or importance >= TG_MIN_IMPORTANCE
            if should_publish:
                try:
                    item_to_publish = dict(item)
                    if is_catalyst:
                        item_to_publish['is_catalyst'] = True
                    if item_tickers:
                        item_to_publish['tickers'] = item_tickers
                    if raw_analysis.get('summary_ar') and not item_to_publish.get('summary_ar'):
                        item_to_publish['summary_ar'] = raw_analysis.get('summary_ar')

                    links = await self.social.publish(item_to_publish, platforms=social_platforms)
                    self.store.save_published_links(item['id'], links)
                    console.print(f"[bold cyan]  📢 [{importance}/100] نُشر على تليجرام: {item.get('title', '')[:40]}...[/bold cyan]")
                except Exception as e:
                    log.warning(f"Social publish error for {item['id']}: {e}")

        console.print(f"[green]  ✓ تم نشر {len(tg_to_publish)} خبر على التليجرام (من {sent} تم إرسالهم للموقع)[/green]")
        return sent

    def _state_file(self) -> Path:
        return Path(__file__).parent / 'data' / '.source_state.json'

    def _load_state(self) -> dict:
        try:
            with open(self._state_file(), 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save_state(self, state: dict):
        self._state_file().parent.mkdir(parents=True, exist_ok=True)
        with open(self._state_file(), 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)

    def _new_source_labels(self) -> set[str]:
        """يرجع labels المصادر اللي لسه في فترة الـ grace (تحتاج importance >= 75)."""
        grace_days = int(os.getenv('NEW_SOURCE_GRACE_DAYS', '7'))
        state = self._load_state()
        labels: set[str] = set()
        now = datetime.now()
        for source_key, info in state.get('sources', {}).items():
            if not info.get('enabled'):
                continue
            first_seen = info.get('first_seen')
            if not first_seen:
                continue
            try:
                first_dt = datetime.fromisoformat(first_seen)
            except ValueError:
                continue
            if now - first_dt < timedelta(days=grace_days):
                labels.update(info.get('labels', []))
        return labels

    def _importance_threshold(self) -> int:
        """يحسب الـ threshold بناءً على الـ grace period للمصادر الجديدة."""
        base = int(os.getenv('MIN_IMPORTANCE_SCORE', 55))
        if self._new_source_labels():
            return max(base, int(os.getenv('NEW_SOURCE_MIN_IMPORTANCE', 75)))
        return base

    def _register_sources(self):
        """يسجل المصادر النشطة الآن — يُستدعى مرة عند البدء."""
        if os.getenv('ENABLE_EGYPTIAN_SOURCES', '0').lower() not in ('1', 'true', 'yes'):
            return
        state = self._load_state()
        sources = state.setdefault('sources', {})
        alborsaa_labels = [
            'جريدة البورصة',
        ]
        key = 'alborsaanews'
        if key not in sources:
            sources[key] = {
                'enabled': True,
                'first_seen': datetime.now().isoformat(),
                'labels': alborsaa_labels,
            }
            log.info(f'Alborsaa registered as new source (grace period {os.getenv("NEW_SOURCE_GRACE_DAYS", "7")} days)')
        elif alborsaa_labels and not sources[key].get('labels'):
            sources[key]['labels'] = alborsaa_labels
        self._save_state(state)

    async def _aggregate_recommendations(self) -> int:
        """تجميع توصيات الخبراء من الأخبار المحلية وإرسالها للموقع."""
        try:
            added = await self.recommender.run()
        except Exception as e:
            log.warning(f'Aggregator error: {e}')
            return 0
        if not added:
            return 0

        unsent = self.store.get_unsent_recommendations(limit=added)
        if not unsent:
            return 0

        console.print(f'[magenta]📊 إرسال {len(unsent)} توصية مجمّعة للخبراء...[/magenta]')
        sent_ids: list[str] = []
        for rec in unsent:
            try:
                remote_id = await self.sender.send_recommendation(rec)
                if remote_id:
                    sent_ids.append(rec['id'])
                    if remote_id and remote_id != rec['id']:
                        self.store.update_recommendation_remote_id(rec['id'], remote_id)
            except Exception as e:
                log.warning(f'Recommendation send error for {rec.get("stock_symbol")}: {e}')
        if sent_ids:
            self.store.mark_recommendations_sent(sent_ids)
        console.print(f'[green]  ✓ تم إرسال {len(sent_ids)} توصية[/green]')
        return len(sent_ids)

    async def run_cycle(self):
        """دورة تشغيل واحدة كاملة"""
        now = datetime.now().strftime('%H:%M:%S')
        console.rule(f"[bold blue]🔄 دورة جديدة — {now}[/bold blue]")
        try:
            collected = await self._collect_all()
            await self._analyze_pending()
            await self._aggregate_recommendations()
            await self._send_important()
        except Exception as e:
            log.error(f"Cycle error: {e}", exc_info=True)

    async def run_forever(self):
        """تشغيل مستمر بفترات منتظمة"""
        interval = int(os.getenv('COLLECTION_INTERVAL_MINUTES', 15)) * 60
        self.running = True

        console.print(Panel(
            Text.from_markup(
                "[bold green]🚀 News Agent شغّال![/bold green]\n"
                f"[cyan]النموذج:[/cyan] {os.getenv('OLLAMA_MODEL', 'qwen2.5-coder:7b')}\n"
                f"[cyan]الدورة:[/cyan] كل {interval//60} دقيقة\n"
                f"[cyan]السيرفر:[/cyan] {os.getenv('PRODUCTION_SERVER_URL', 'N/A')}\n"
                "[dim]اضغط Ctrl+C للإيقاف[/dim]"
            ),
            title="📰 EGX News Intelligence Agent",
            border_style="blue"
        ))

        while self.running:
            await self.run_cycle()
            console.print(f"[dim]💤 انتظار {interval//60} دقيقة للدورة القادمة...[/dim]")
            await asyncio.sleep(interval)

    def stop(self):
        self.running = False
        console.print("[red]🛑 وقف News Agent[/red]")


async def main():
    agent = NewsAgent()

    def _sighandler(sig, frame):
        agent.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, _sighandler)
    signal.signal(signal.SIGTERM, _sighandler)

    # لو تشغيله مرة واحدة بس
    if '--once' in sys.argv:
        await agent.run_cycle()
    else:
        await agent.run_forever()


if __name__ == '__main__':
    asyncio.run(main())
