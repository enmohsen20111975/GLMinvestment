import json
import logging
import sqlite3
from flask import Blueprint, jsonify, request, current_app
from pathlib import Path
from typing import Optional

# الوصول للـ agent
import sys
_AI_DIR = Path(__file__).resolve().parent.parent
if str(_AI_DIR) not in sys.path:
    sys.path.insert(0, str(_AI_DIR))
from ai.glm_finance_agent import GLMFinanceAgent, PREDICTIONS_DB
from ai.decision_engine import DecisionEngine

logger = logging.getLogger(__name__)

ai_bp = Blueprint('ai', __name__, url_prefix='/api/ai')
_agent = None

def get_agent():
    global _agent
    if _agent is None:
        _agent = GLMFinanceAgent()
    return _agent

# ─── Helper Functions ─────────────────────────────────────────────────────────

def _get_cached_analysis(ticker: str) -> Optional[dict]:
    ticker_upper = ticker.upper()
    try:
        conn = sqlite3.connect(PREDICTIONS_DB)
        conn.row_factory = sqlite3.Row
        row = conn.execute("""
            SELECT ai_decision, ai_confidence, ai_reason, ai_narrative, ai_updated_at
            FROM stored_analyses
            WHERE ticker = ?
              AND ai_decision IS NOT NULL
            LIMIT 1
        """, (ticker_upper,)).fetchone()
        conn.close()

        if row:
            return {
                "ticker": ticker_upper,
                "decision": row["ai_decision"],
                "confidence": row["ai_confidence"],
                "reason": row["ai_reason"],
                "narrative": row["ai_narrative"],
                "updated_at": row["ai_updated_at"],
                "source": "database_precomputed"
            }
    except Exception as e:
        logger.error(f"Error reading cached analysis: {e}")
    return None

def _run_live_analysis(ticker: str) -> dict:
    """يشغّل تحليل RAG AI لحظياً لسهم معيّن. آمن ضد كل الاستثناءات."""
    try:
        agent = get_agent()
        if not agent.is_available():
            return {"error": "Ollama service offline", "status": 503}

        db_engine = DecisionEngine()
        indicators = agent._fetch_indicators(ticker)
        if not indicators:
            return {"error": "No indicators found for ticker", "status": 404}

        # RAG search — استخدم find_similar_stories (الاسم الصحيح في DecisionEngine)
        similar_cases = db_engine.find_similar_stories(
            ticker=ticker,
            current_rsi=float(indicators.get("rsi") or 50.0),
            current_recommendation=str(indicators.get("recommendation") or ""),
            limit=3
        )

        prompt = db_engine.build_rag_prompt(ticker, indicators, similar_cases)
        # QWEN-UNIFY: call_fast = الموديل الموحّد من env (glm-fast default).
        raw_response = agent.call_fast(prompt, max_tokens=400)
        decision = agent._parse_json_response(raw_response)

        if "decision" not in decision:
            return {"error": "AI model failed to generate valid decision structure",
                    "raw": decision.get("raw", "")[:300],
                    "status": 502}

        # استخراج آمن للحقول (الـ AI ممكن يرجع confidence كنص أو float)
        try:
            conf_raw = decision.get("confidence", 0)
            conf_int = int(float(str(conf_raw).replace("%", "").strip()))
            conf_int = max(0, min(100, conf_int))
        except (ValueError, TypeError):
            conf_int = 50
        reason = str(decision.get("reason") or "")
        narrative = str(decision.get("narrative") or "")
        dec_str = str(decision.get("decision") or "HOLD").upper()

        # حفظ — UPDATE لو موجود، INSERT لو جديد
        try:
            conn = sqlite3.connect(PREDICTIONS_DB)
            cur = conn.cursor()
            cur.execute("SELECT ticker FROM stored_analyses WHERE ticker = ?", (ticker,))
            exists = cur.fetchone() is not None
            if exists:
                cur.execute("""
                    UPDATE stored_analyses
                    SET ai_decision = ?, ai_confidence = ?, ai_reason = ?,
                        ai_narrative = ?, ai_updated_at = datetime('now')
                    WHERE ticker = ?
                """, (dec_str, conf_int, reason, narrative, ticker))
            else:
                cur.execute("""
                    INSERT INTO stored_analyses
                        (ticker, ai_decision, ai_confidence, ai_reason, ai_narrative, ai_updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                """, (ticker, dec_str, conf_int, reason, narrative))
            conn.commit()
            conn.close()
        except Exception as db_err:
            logger.error(f"DB save failed for {ticker}: {db_err}")
            # نكمّل برغم فشل الحفظ — المستخدم لسه يستاهل الـ decision

        return {
            "ticker": ticker,
            "decision": dec_str,
            "confidence": conf_int,
            "reason": reason,
            "narrative": narrative,
            "source": "live_ai"
        }
    except Exception as e:
        logger.exception(f"_run_live_analysis failed for {ticker}")
        return {"error": f"Internal error: {e}", "status": 500}

# ─── Endpoints ────────────────────────────────────────────────────────────────

@ai_bp.route('/status', methods=['GET'])
def ai_status():
    try:
        import httpx
        r = httpx.get("http://localhost:11434/api/tags", timeout=3)
        models = [m["name"] for m in r.json().get("models", [])]
        return jsonify({
            "status": "online",
            "models": models,
            "ollama_url": "http://localhost:11434"
        })
    except Exception as e:
        return jsonify({
            "status": "offline",
            "error": str(e),
            "hint": "sudo systemctl start ollama"
        })

@ai_bp.route('/decision/<ticker>', methods=['GET'])
def get_ai_decision(ticker):
    ticker_upper = ticker.upper()
    
    # 1. حاول جلب الكاش
    cached = _get_cached_analysis(ticker_upper)
    if cached:
        return jsonify(cached)
        
    # 2. تشغيل فوري إذا لم يوجد كاش
    logger.info(f"No cached AI decision for {ticker_upper}, running live analysis...")
    result = _run_live_analysis(ticker_upper)
    if "error" in result:
        return jsonify({"detail": result["error"]}), result.get("status", 500)
    return jsonify(result)

@ai_bp.route('/compare', methods=['POST'])
def compare_stocks():
    data = request.get_json() or {}
    tickers = data.get('tickers', [])
    
    if len(tickers) < 2:
        return jsonify({"detail": "أدخل سهمين على الأقل"}), 400
    if len(tickers) > 5:
        return jsonify({"detail": "الحد الأقصى 5 أسهم للمقارنة"}), 400

    agent = get_agent()
    if not agent.is_available():
        return jsonify({"detail": "Ollama غير متاح حالياً"}), 503

    indicators_list = [agent._fetch_indicators(t) or {} for t in tickers]
    result = agent.compare_stocks(tickers, indicators_list)
    return jsonify({"comparison": result, "tickers": tickers})

@ai_bp.route('/ask', methods=['POST'])
def ask_question():
    data = request.get_json() or {}
    question = data.get('question', '')
    context = data.get('context', {})

    if not question:
        return jsonify({"detail": "الرجاء إدخال سؤال"}), 400

    agent = get_agent()
    if not agent.is_available():
        return jsonify({"detail": "Ollama غير متاح حالياً"}), 503

    answer = agent.answer_question(question, context)
    return jsonify({"answer": answer, "question": question})


# ============================================================
# Live AI Monitor + Hot Stocks (جديد — يوليو 2026)
# ============================================================

_live_monitor = None

def _get_live_monitor():
    global _live_monitor
    if _live_monitor is None:
        try:
            from ai.live_ai_monitor import LiveAIMonitor
            _live_monitor = LiveAIMonitor()
        except Exception as e:
            logger.error(f"LiveAIMonitor init failed: {e}")
            return None
    return _live_monitor


@ai_bp.route('/live/signals', methods=['GET'])
def live_signals():
    """آخر إشارات الـ AI أثناء الجلسة (آخر N ساعة).

    Query params:
      hours — عدد الساعات (افتراضي 4)
      market — السوق (افتراضي EGX)
    """
    hours = request.args.get('hours', 4, type=int)
    market = request.args.get('market', 'EGX').upper()
    monitor = _get_live_monitor()
    if not monitor:
        return jsonify({"success": False, "error": "LiveAIMonitor غير متاح"}), 503
    try:
        signals = monitor.get_live_signals(market=market, hours=hours)
        return jsonify({
            "success": True,
            "count": len(signals),
            "hours": hours,
            "market": market,
            "signals": signals
        })
    except Exception as e:
        logger.exception("live_signals failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/live/scan', methods=['GET'])
def live_scan():
    """تشغيل فوري للمسح الكامل: hot stocks + AI analysis.

    Query params:
      market — السوق (افتراضي EGX)
      max_stocks — أقصى عدد أسهم (افتراضي 10)
    """
    market = request.args.get('market', 'EGX').upper()
    max_stocks = request.args.get('max_stocks', 10, type=int)
    monitor = _get_live_monitor()
    if not monitor:
        return jsonify({"success": False, "error": "LiveAIMonitor غير متاح"}), 503
    try:
        result = monitor.scan_and_analyze(market=market, max_stocks=max_stocks)
        return jsonify({"success": True, **result})
    except Exception as e:
        logger.exception("live_scan failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/hot-stocks', methods=['GET'])
def hot_stocks():
    """الأسهم الساخنة دلوقتي (طلوع + حجم) بدون AI."""
    market = request.args.get('market', 'EGX').upper()
    min_change = request.args.get('min_change_pct', 2.0, type=float)
    min_vol = request.args.get('min_volume_ratio', 1.5, type=float)
    try:
        from ai.hot_stocks_detector import HotStocksDetector
        detector = HotStocksDetector()
        stocks = detector.detect_hot_stocks(market=market, min_change_pct=min_change, min_volume_ratio=min_vol)
        return jsonify({
            "success": True,
            "count": len(stocks),
            "market": market,
            "stocks": stocks
        })
    except Exception as e:
        logger.exception("hot_stocks failed")
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# Trade Recorder + Learning Loop (جديد — يوليو 2026)
# ============================================================

_trade_recorder = None

def _get_trade_recorder():
    global _trade_recorder
    if _trade_recorder is None:
        try:
            from ai.trade_recorder import TradeRecorder
            _trade_recorder = TradeRecorder()
        except Exception as e:
            logger.error(f"TradeRecorder init failed: {e}")
            return None
    return _trade_recorder


@ai_bp.route('/trades/record', methods=['POST'])
def record_trade():
    """تسجيل صفقة مستخدم (شراء/بيع).

    Body:
      user_id, ticker, trade_type ('BUY'/'SELL'), price, quantity, trade_date?, notes?
    """
    data = request.get_json() or {}
    required = ['user_id', 'ticker', 'trade_type', 'price', 'quantity']
    for field in required:
        if field not in data:
            return jsonify({"success": False, "error": f"الحقل مطلوب: {field}"}), 400

    recorder = _get_trade_recorder()
    if not recorder:
        return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503

    try:
        trade_type = data['trade_type'].upper()
        if trade_type == 'BUY':
            result = recorder.record_buy(
                user_id=data['user_id'],
                ticker=data['ticker'].upper(),
                price=float(data['price']),
                quantity=float(data['quantity']),
                trade_date=data.get('trade_date'),
                notes=data.get('notes', '')
            )
        elif trade_type == 'SELL':
            result = recorder.record_sell(
                user_id=data['user_id'],
                ticker=data['ticker'].upper(),
                price=float(data['price']),
                quantity=float(data['quantity']),
                trade_date=data.get('trade_date'),
                notes=data.get('notes', '')
            )
        else:
            return jsonify({"success": False, "error": "trade_type يجب أن BUY أو SELL"}), 400

        return jsonify({"success": True, **result})
    except Exception as e:
        logger.exception("record_trade failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/trades/<user_id>', methods=['GET'])
def get_user_trades(user_id):
    """جلب كل صفقات المستخدم."""
    limit = request.args.get('limit', 50, type=int)
    recorder = _get_trade_recorder()
    if not recorder:
        return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503
    try:
        trades = recorder.get_user_trades(user_id, limit=limit)
        return jsonify({"success": True, "count": len(trades), "trades": trades})
    except Exception as e:
        logger.exception("get_user_trades failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/trades/<user_id>/performance', methods=['GET'])
def get_performance(user_id):
    """إحصائيات أداء المستخدم (win rate, avg pnl, etc)."""
    recorder = _get_trade_recorder()
    if not recorder:
        return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503
    try:
        stats = recorder.get_performance_stats(user_id=user_id)
        return jsonify({"success": True, "stats": stats})
    except Exception as e:
        logger.exception("get_performance failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/trades/learn', methods=['POST'])
def learn_from_trades():
    """تشغيل الـ learning loop يدوياً (بدون انتظار 15:30).

    Body (optional):
      user_id — لو محدد، بيتحلّل لمستخدم واحد بس
    """
    data = request.get_json() or {}
    user_id = data.get('user_id')
    recorder = _get_trade_recorder()
    if not recorder:
        return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503
    try:
        result = recorder.learn_from_trades(user_id=user_id)
        return jsonify({"success": True, **result})
    except Exception as e:
        logger.exception("learn_from_trades failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/trades/outcomes', methods=['GET'])
def get_outcomes():
    """نتائج الصفقات (للتحليل)."""
    user_id = request.args.get('user_id')
    limit = request.args.get('limit', 50, type=int)
    recorder = _get_trade_recorder()
    if not recorder:
        return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503
    try:
        outcomes = recorder.get_trade_outcomes(user_id=user_id, limit=limit)
        return jsonify({"success": True, "count": len(outcomes), "outcomes": outcomes})
    except Exception as e:
        logger.exception("get_outcomes failed")
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# Historical Trade Generator (جديد — يوليو 2026)
# ============================================================
# مقترح المستخدم محسن: بدل ما نستنى صفقات المستخدم، نولّد آلاف الصفقات
# من البيانات التاريخية عشان الـ AI يتعلم منها.
# ============================================================

_hist_gen = None

def _get_hist_gen():
    global _hist_gen
    if _hist_gen is None:
        try:
            from ai.historical_trade_generator import HistoricalTradeGenerator
            _hist_gen = HistoricalTradeGenerator()
        except Exception as e:
            logger.error(f"HistoricalTradeGenerator init failed: {e}")
            return None
    return _hist_gen


@ai_bp.route('/historical/generate', methods=['GET'])
def historical_generate():
    """تشغيل Historical Trade Generator يدوياً.

    Query params:
      days_back — عدد الأيام للوراء (افتراضي 180)
      max_trades_per_ticker — أقصى صفقات لكل سهم (افتراضي 50)
      ticker_limit — عدد الأسهم (0 = الكل، افتراضي 20 للـ test)
    """
    days_back = request.args.get('days_back', 180, type=int)
    max_trades = request.args.get('max_trades_per_ticker', 50, type=int)
    ticker_limit = request.args.get('ticker_limit', 20, type=int)

    gen = _get_hist_gen()
    if not gen:
        return jsonify({"success": False, "error": "Generator غير متاح"}), 503

    try:
        result = gen.generate_all_trades(
            days_back=days_back,
            max_trades_per_ticker=max_trades,
            ticker_limit=ticker_limit,
        )
        return jsonify({"success": True, **result})
    except Exception as e:
        logger.exception("historical_generate failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/historical/feed-ai', methods=['POST'])
def historical_feed_ai():
    """تغذية الـ AI بالصفقات التاريخية (تخزين في stock_stories)."""
    limit = (request.get_json() or {}).get('limit', 5000)
    gen = _get_hist_gen()
    if not gen:
        return jsonify({"success": False, "error": "Generator غير متاح"}), 503
    try:
        result = gen.feed_to_ai_learning(limit=limit)
        return jsonify({"success": True, **result})
    except Exception as e:
        logger.exception("historical_feed_ai failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/historical/stats', methods=['GET'])
def historical_stats():
    """إحصائيات الصفقات التاريخية (win rate, patterns, strategies)."""
    gen = _get_hist_gen()
    if not gen:
        return jsonify({"success": False, "error": "Generator غير متاح"}), 503
    try:
        stats = gen.get_stats()
        return jsonify({"success": True, "stats": stats})
    except Exception as e:
        logger.exception("historical_stats failed")
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# Telegram Signal Importer (جديد — يوليو 2026)
# ============================================================
# يجيب توصيات من جروبات Telegram ويستخدمها كـ training data
# ============================================================

_tg_importer = None

def _get_tg_importer():
    global _tg_importer
    if _tg_importer is None:
        try:
            from ai.telegram_signal_importer import TelegramSignalImporter
            _tg_importer = TelegramSignalImporter()
        except Exception as e:
            logger.error(f"TelegramSignalImporter init failed: {e}")
            return None
    return _tg_importer


@ai_bp.route('/telegram/import', methods=['POST'])
def telegram_import():
    """استيراد توصيات من جروب Telegram.

    Body:
      group_username — معرف الجروب (مطلوب)
      limit — عدد الرسائل (افتراضي 100)
    """
    data = request.get_json() or {}
    group = data.get('group_username', '').strip()
    if not group:
        return jsonify({"success": False, "error": "group_username مطلوب"}), 400

    limit = int(data.get('limit', 100))

    importer = _get_tg_importer()
    if not importer:
        return jsonify({"success": False, "error": "Importer غير متاح"}), 503

    try:
        result = importer.import_signals_from_group(group, limit)
        return jsonify({"success": True, **result})
    except Exception as e:
        logger.exception("telegram_import failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/telegram/evaluate', methods=['POST'])
def telegram_evaluate():
    """تقييم التوصيات المستوردة (بعد N أيام)."""
    data = request.get_json() or {}
    days = int(data.get('days_back', 7))

    importer = _get_tg_importer()
    if not importer:
        return jsonify({"success": False, "error": "Importer غير متاح"}), 503

    try:
        result = importer.evaluate_pending_signals(days_back=days)
        return jsonify({"success": True, **result})
    except Exception as e:
        logger.exception("telegram_evaluate failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/telegram/stats', methods=['GET'])
def telegram_stats():
    """إحصائيات التوصيات المستوردة."""
    importer = _get_tg_importer()
    if not importer:
        return jsonify({"success": False, "error": "Importer غير متاح"}), 503

    try:
        stats = importer.get_stats()
        return jsonify({"success": True, "stats": stats})
    except Exception as e:
        logger.exception("telegram_stats failed")
        return jsonify({"success": False, "error": str(e)}), 500


@ai_bp.route('/telegram/signals', methods=['GET'])
def telegram_signals_list():
    """قائمة التوصيات المستوردة."""
    importer = _get_tg_importer()
    if not importer:
        return jsonify({"success": False, "error": "Importer غير متاح"}), 503

    try:
        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _db = str(_root / 'db' / 'predictions.db')

        limit = request.args.get('limit', 50, type=int)
        evaluated_only = request.args.get('evaluated', 'false').lower() == 'true'

        conn = sqlite3.connect(_db)
        conn.row_factory = sqlite3.Row

        if evaluated_only:
            rows = conn.execute("""
                SELECT * FROM telegram_signals
                WHERE evaluated = 1
                ORDER BY message_date DESC LIMIT ?
            """, (limit,)).fetchall()
        else:
            rows = conn.execute("""
                SELECT * FROM telegram_signals
                ORDER BY message_date DESC LIMIT ?
            """, (limit,)).fetchall()

        conn.close()
        return jsonify({
            "success": True,
            "count": len(rows),
            "signals": [dict(r) for r in rows]
        })
    except Exception as e:
        logger.exception("telegram_signals_list failed")
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# Premium Predictions (جديد — يوليو 2026)
# ============================================================
# توقعات أعمق للمدفوعين فقط — AI + multi-factor + confidence tiers
# ============================================================

@ai_bp.route('/premium/predictions', methods=['GET'])
def premium_predictions():
    """توقعات Premium للمدفوعين.

    الفرق عن الـ regular:
    1. AI analysis لكل سهم (glm-fast)
    2. Multi-factor confluence score
    3. Confidence tier (Tier 1/2/3)
    4. Detailed narrative بالعربي
    5. Risk assessment متقدم

    Query params:
      market — السوق (افتراضي EGX)
      limit — عدد النتائج (افتراضي 10، حد أقصى 20)
      tier — فلترة حسب Tier (1/2/3/all)
    """
    market = request.args.get('market', 'EGX').upper()
    limit = min(request.args.get('limit', 10, type=int), 20)
    tier_filter = request.args.get('tier', 'all')

    try:
        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _db = str(_root / 'db' / 'predictions.db')

        conn = sqlite3.connect(_db)
        conn.row_factory = sqlite3.Row

        # جلب التوقعات من stored_analyses + aiPrediction
        # لا نسمح بـ market IS NULL (يسرّب أسهم سعودية/كويتية لقوائم EGX)
        rows = conn.execute("""
            SELECT ticker, market, recommendation, maestro_score,
                   target_price, stop_loss, entry_price, confidence,
                   updated_at, ai_decision, ai_confidence
            FROM stored_analyses
            WHERE market = ?
            ORDER BY maestro_score DESC
            LIMIT ?
        """, (market, limit * 2)).fetchall()

        # Defense-in-depth: Python-side strict filter (catches Saudi numeric
        # tickers + known Kuwaiti/Gulf tickers even if their market column was
        # polluted with 'EGX'). Mirrors the fix in /api/v2/recommend.
        try:
            from api.v2_routes import _strict_market_filter
            rows = [
                r for r in rows
                if _strict_market_filter(dict(r), market, db_manager=None)
            ]
        except Exception:
            pass  # fallback: rely on SQL filter only

        from api.misc_routes import _get_stock_name

        premium_results = []
        for r in rows:
            d = dict(r)
            ticker = d.get('ticker', '')
            stock_info = _get_stock_name(ticker)

            score = d.get('maestro_score', 50) or 50
            ai_conf = d.get('ai_confidence') or d.get('confidence') or 50

            # Multi-factor confluence
            confluence_score = _calculate_confluence(score, ai_conf)

            # Confidence tier
            tier = _get_tier(confluence_score)

            # فلترة حسب tier لو موجود
            if tier_filter != 'all' and str(tier['number']) != tier_filter:
                continue

            premium_results.append({
                'ticker': ticker,
                'symbol': ticker,
                'name': stock_info['name'],
                'name_ar': stock_info['name_ar'],
                'sector': stock_info['sector'],
                'signal': (d.get('recommendation') or 'hold').upper(),
                'maestro_score': score,
                'ai_confidence': ai_conf,
                'confluence_score': confluence_score,
                'tier': tier,
                'entry_price': d.get('entry_price') or 0,
                'target_price': d.get('target_price') or 0,
                'stop_loss': d.get('stop_loss') or 0,
                'risk_reward': _calc_rr(d.get('entry_price'), d.get('target_price'), d.get('stop_loss')),
                'updated_at': d.get('updated_at'),
                'premium_features': {
                    'ai_narrative': f"تحليل AI متقدم لـ {ticker} — Tier {tier['number']}",
                    'risk_assessment': tier['description'],
                    'multi_factor': True,
                }
            })

            if len(premium_results) >= limit:
                break

        conn.close()

        return jsonify({
            'success': True,
            'market': market,
            'count': len(premium_results),
            'predictions': premium_results,
            'tier_distribution': _tier_distribution(premium_results),
            'premium': True,
        })
    except Exception as e:
        logger.exception("premium_predictions failed")
        return jsonify({"success": False, "error": str(e)}), 500


def _calculate_confluence(maestro_score, ai_confidence):
    """يحسب confluence score من عوامل متعددة."""
    # 60% maestro + 40% AI
    return round((maestro_score * 0.6) + (ai_confidence * 0.4), 1)


def _get_tier(score):
    """يحدد الـ tier بناءً على confluence score."""
    if score >= 75:
        return {
            'number': 1,
            'name': 'Strong Buy',
            'name_ar': 'شراء قوي',
            'description': '🟢 عوامل متفقة بقوة — فرصة ممتازة',
            'color': 'green',
        }
    elif score >= 60:
        return {
            'number': 2,
            'name': 'Buy',
            'name_ar': 'شراء',
            'description': '🟡 عوامل إيجابية — فرصة جيدة',
            'color': 'yellow',
        }
    elif score >= 45:
        return {
            'number': 3,
            'name': 'Accumulate',
            'name_ar': 'تجميع',
            'description': '🟠 عوامل متوسطة — تجميع تدريجي',
            'color': 'orange',
        }
    else:
        return {
            'number': 4,
            'name': 'Watch',
            'name_ar': 'مراقبة',
            'description': '⚪ عوامل ضعيفة — انتظر تأكيد',
            'color': 'gray',
        }


def _calc_rr(entry, target, stop):
    """يحسب Risk/Reward ratio."""
    try:
        if not entry or not target or not stop or entry <= 0:
            return 0
        risk = entry - stop
        reward = target - entry
        if risk <= 0:
            return 0
        return round(reward / risk, 2)
    except Exception:
        return 0


def _tier_distribution(predictions):
    """توزيع التوقعات على الـ tiers."""
    dist = {1: 0, 2: 0, 3: 0, 4: 0}
    for p in predictions:
        tier_num = p.get('tier', {}).get('number', 4)
        dist[tier_num] = dist.get(tier_num, 0) + 1
    return dist
