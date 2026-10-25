#!/usr/bin/env python3
import sqlite3
import logging
import sys
from pathlib import Path
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

AI_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = AI_DIR.parents[1]  # يصعد خطوتين لـ GLMinvestment root
PREDICTIONS_DB = str(PROJECT_ROOT / "db" / "predictions.db")
STOCKS_DB = str(PROJECT_ROOT / "db" / "stocks.db")

# إضافة مسار vps-service لـ sys.path لتسهيل استيراد الـ engines
VPS_SERVICE_DIR = str(PROJECT_ROOT / "vps-service")
if VPS_SERVICE_DIR not in sys.path:
    sys.path.insert(0, VPS_SERVICE_DIR)

class DecisionEngine:
    def __init__(self, db_path: str = PREDICTIONS_DB):
        self.db_path = db_path


    def find_similar_stories(
        self, 
        ticker: str, 
        current_rsi: float, 
        current_recommendation: str,
        limit: int = 3
    ) -> List[Dict[str, Any]]:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.db_path, writable=False)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        stories = []
        try:
            query_ticker = """
                SELECT ticker, pattern_type, story_date, story_text, outcome_pct
                FROM stock_stories
                WHERE ticker = ?
                ORDER BY RANDOM()
                LIMIT ?
            """
            cursor.execute(query_ticker, (ticker, limit))
            rows = cursor.fetchall()
            
            for r in rows:
                stories.append({
                    "ticker": r["ticker"],
                    "pattern_type": r["pattern_type"],
                    "date": r["story_date"],
                    "text": r["story_text"],
                    "outcome": r["outcome_pct"]
                })
                
            if len(stories) < limit:
                needed = limit - len(stories)
                suggested_pattern = "BREAKOUT" if "buy" in current_recommendation.lower() else "LOW_VOL_DROP"
                if current_rsi and current_rsi < 40:
                    suggested_pattern = "PANIC_BOUNCE"
                elif current_rsi and current_rsi > 70:
                    suggested_pattern = "BREAKOUT"
                    
                query_general = """
                    SELECT ticker, pattern_type, story_date, story_text, outcome_pct
                    FROM stock_stories
                    WHERE pattern_type = ? AND ticker != ?
                    ORDER BY RANDOM()
                    LIMIT ?
                """
                cursor.execute(query_general, (suggested_pattern, ticker, needed))
                gen_rows = cursor.fetchall()
                
                for r in gen_rows:
                    stories.append({
                        "ticker": r["ticker"],
                        "pattern_type": r["pattern_type"],
                        "date": r["story_date"],
                        "text": r["story_text"],
                        "outcome": r["outcome_pct"]
                    })
        except Exception as e:
            logger.error(f"Error finding similar stories: {e}")
        finally:
            conn.close()
            
        return stories

    def find_similar_cases(
        self,
        ticker: str,
        current_tech: float,
        current_fund: float,
        limit: int = 3
    ) -> List[Dict[str, Any]]:
        """
        البحث عن حالات مشابهة متوافقة مع استدعاءات api_routes و nightly_analysis.
        """
        # إذا كانت القيمة ممررة كـ technical_score (0-100) بدلاً من RSI، نستخدمها لتحديد الـ recommendation المقترح
        # أما إذا كانت هي الـ RSI (غالباً بين 10 و 90) سنمررها مباشرة كـ rsi
        rsi = current_tech
        recommendation = "BUY" if (current_tech and current_tech > 60) else "HOLD"
        return self.find_similar_stories(
            ticker=ticker,
            current_rsi=rsi,
            current_recommendation=recommendation,
            limit=limit
        )

    def build_rag_prompt(
        self, 
        ticker: str, 
        indicators: dict, 
        similar_stories: List[dict]
    ) -> str:
        """بناء سياق RAG والـ Prompt المنظم لـ 'المحلل الصايع' مع SMC والتدفقات والدروس المستفادة"""
        
        # 1. جلب البيانات الأساسية (Fundamentals)
        rsi = indicators.get("rsi")
        macd = indicators.get("macd")
        score = indicators.get("maestro_score")
        rec = indicators.get("recommendation") or indicators.get("signal")
        price = indicators.get("price")
        vol_ratio = indicators.get("volume_ratio")
        
        pe = indicators.get("pe_ratio")
        roe = indicators.get("roe")
        profit_margin = indicators.get("profit_margin")
        pb = indicators.get("pb_ratio")
        eps = indicators.get("eps")
        debt_to_equity = indicators.get("debt_to_equity")
        div_yield = indicators.get("dividend_yield")
        
        # محاولة تعبئة النواقص من stocks.db
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn_stocks = db_manager.get_connection(STOCKS_DB, writable=False)
            conn_stocks.row_factory = sqlite3.Row
            row = conn_stocks.execute(
                "SELECT current_price, rsi, pe_ratio, roe, profit_margin, pb_ratio, eps, debt_to_equity, dividend_yield, avg_volume, volume FROM stocks WHERE ticker = ?", 
                (ticker.upper(),)
            ).fetchone()
            if row:
                if price in (None, "N/A"): price = row["current_price"]
                if rsi in (None, "N/A"): rsi = row["rsi"]
                if pe in (None, "N/A"): pe = row["pe_ratio"]
                if roe in (None, "N/A"): roe = row["roe"]
                if profit_margin in (None, "N/A"): profit_margin = row["profit_margin"]
                if pb in (None, "N/A"): pb = row["pb_ratio"]
                if eps in (None, "N/A"): eps = row["eps"]
                if debt_to_equity in (None, "N/A"): debt_to_equity = row["debt_to_equity"]
                if div_yield in (None, "N/A"): div_yield = row["dividend_yield"]
                if vol_ratio in (None, "N/A", "1.0", 1.0) and row["avg_volume"] and row["volume"]:
                    def parse_vol(v):
                        if not v: return 0.0
                        if isinstance(v, (int, float)): return float(v)
                        v_str = str(v).replace('\u202f', '').replace(' ', '').strip().upper()
                        mult = 1.0
                        if v_str.endswith('K'):
                            mult = 1000.0
                            v_str = v_str[:-1]
                        elif v_str.endswith('M'):
                            mult = 1000000.0
                            v_str = v_str[:-1]
                        elif v_str.endswith('B'):
                            mult = 1000000000.0
                            v_str = v_str[:-1]
                        try:
                            return float(v_str) * mult
                        except ValueError:
                            return 0.0
                    vol_val = parse_vol(row["volume"])
                    avg_vol_val = parse_vol(row["avg_volume"])
                    if avg_vol_val > 0:
                        vol_ratio = round(vol_val / avg_vol_val, 2)
            conn_stocks.close()
        except Exception as e:
            logger.warning(f"Error fetching fundamentals in build_rag_prompt: {e}")

        # 2. حساب مؤشرات الـ Flow (سياق السوق العام والقطاع)
        macro_flow = "N/A"
        sector_flow = "N/A"
        sector_name = "N/A"
        sector_avg_change = "N/A"
        sector_breadth = "N/A"
        flow_score = "N/A"
        flow_label = "N/A"
        flow_action = "N/A"
        try:
            from engine.flow_system import FlowSystemEngine
            flow_engine = FlowSystemEngine()
            flow_res = flow_engine.calculate_flow_score(ticker.upper())
            if flow_res:
                macro_flow = flow_res.macro_flow
                sector_flow = flow_res.sector_flow
                sector_name = flow_res.sector
                sector_avg_change = flow_res.sector_avg_change
                sector_breadth = flow_res.sector_breadth
                flow_score = flow_res.flow_score
                flow_label = flow_res.label
                flow_action = flow_res.action
        except Exception as e:
            logger.warning(f"Error calculating flow in build_rag_prompt: {e}")

        # 3. جلب القواعد والدروس المستفادة آلياً من prediction_lessons
        lessons = []
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn_pred = db_manager.get_connection(self.db_path, writable=False)
            conn_pred.row_factory = sqlite3.Row
            rows = conn_pred.execute("""
                SELECT category, rule, evidence, failure_rate, recommendation
                FROM prediction_lessons
                WHERE failure_rate >= 50
                ORDER BY failure_rate DESC
                LIMIT 10
            """).fetchall()
            for r in rows:
                lessons.append(f"- [{r['category']}] {r['rule']} | البينة: {r['evidence']} | نسبة الفشل: {r['failure_rate']}% | التوصية: {r['recommendation']}")
            conn_pred.close()
        except Exception as e:
            logger.warning(f"Error fetching lessons in build_rag_prompt: {e}")
        
        lessons_text = "\n".join(lessons) if lessons else "لا توجد دروس مسجلة حالياً."

        # 4. بناء نص الحالات المشابهة
        stories_text = ""
        for i, s in enumerate(similar_stories, 1):
            stories_text += f"القصة {i} ({s['pattern_type']}): {s['text']}\n\n"

        # 5. صياغة الـ Prompt النهائي بلهجة المحلل الصايع وقواعد الـ SMC
        prompt = f"""أنت "الصايع" — مدير صندوق استثماري مؤسسي محترف ومحلل مخضرم تتداول بمنطق الأموال الذكية (SMC) في البورصة المصرية والعربية.
مهمتك هي إجراء تحليل هيكلي شامل للسهم من القمة إلى القاع (Top-Down Analysis)، ومقارنته بالقصص التاريخية والدروس المستفادة، ثم إصدار قرار مالي ذكي بلهجة صريحة وقوية (كلام محترفين وصُيّاع وليس مجرد أرقام جافة).

### قواعد التفكير والتحليل الصارمة (SMC & Risk Management):
1. **تحليل اتجاه السوق العام والسيولة (Market Regime):** إذا كان السوق العام هابطاً (Bearish)، ارفض الصفقات الضعيفة واطلب دائماً نسبة خصم (Discount Price) ولا تشترِ بأسعار مرتفعة.
2. **البحث عن بصمات الأموال الذكية (Smart Money Accumulation):** قارن حجم التداول بالسعر. إذا كان هناك (حجم تداول عالي جداً + سعر ثابت أو حركة ضيقة) فهذا يدل على "تجميع خفي" (Smart Money Accumulation) وهو فرصة شراء ذهبية.
3. **مناطق العرض والطلب والسيولة (FVG & Order Blocks):** لا تشترِ عند الدعم الكلاسيكي مباشرة لأنه غالباً يمثل (فخ سيولة/Smart Money Trap) لاصطياد المتداولين الأفراد. انتظر حتى يتم سحب السيولة (Liquidity Sweep) تحت الدعم ثم ادخل في الـ Order Blocks أو مناطق الفجوات السعرية (Fair Value Gap - FVG).
4. **نسبة العائد إلى المخاطرة (Risk/Reward):** احسب نسبة العائد للمخاطرة (R/R) بدقة. ارفض تماماً أي صفقة يكون العائد المتوقع فيها أقل من 1.3 ضعف المخاطرة (R/R < 1.3).

### المعطيات الحالية للسهم {ticker}:
- السعر الحالي: {price if price is not None else "N/A"}
- Maestro Score: {score if score is not None else "N/A"}/100
- RSI: {rsi if rsi is not None else "N/A"}
- MACD: {macd if macd is not None else "N/A"}
- حجم التداول اليوم / المتوسط: {vol_ratio if vol_ratio is not None else "N/A"}x
- التوصية الفنية الحالية: {rec if rec is not None else "N/A"}

### بيانات التحليل الأساسي (Fundamental Cache):
- مكرر الربحية (P/E Ratio): {pe if pe is not None else "N/A"}
- العائد على حقوق المساهمين (ROE): {roe if roe is not None else "N/A"}%
- هامش صافي الربح (Profit Margin): {profit_margin if profit_margin is not None else "N/A"}%
- القيمة الدفترية (P/B Ratio): {pb if pb is not None else "N/A"}
- ربحية السهم (EPS): {eps if eps is not None else "N/A"}
- نسبة الديون إلى حقوق الملكية (Debt to Equity): {debt_to_equity if debt_to_equity is not None else "N/A"}
- عائد التوزيعات (Dividend Yield): {div_yield if div_yield is not None else "N/A"}%

### سياق السوق العام والقطاع (Macro & Sector Flow):
- القطاع: {sector_name}
- قوة تدفق السوق العام (Macro Flow): {macro_flow}
- قوة تدفق القطاع (Sector Flow): {sector_flow}
- متوسط تغير القطاع اليوم: {sector_avg_change}%
- اتساع القطاع (% الأسهم الصاعدة): {sector_breadth}%
- النتيجة الإجمالية للتدفق (Flow Score): {flow_score}/100 ({flow_label} - {flow_action})

### الدروس المستفادة وقواعد التداول الصارمة (Automated Lessons):
{lessons_text}

### قصص تاريخية مشابهة من كتاب التجارب (RAG Context):
{stories_text if stories_text else "لا توجد قصص كافية للمقارنة. اعتمد على خبرتك المالية وقواعد الـ SMC المذكورة أعلاه."}

### المطلوب:
حلل الوضع الحالي للسهم بناءً على الخطوات الأربع وقواعد الـ SMC.
أجب بصيغة JSON فقط دون أي مقدمات أو شرح خارج نطاق القوسين.

⛔ قواعد صارمة (منع الهلوسة الرقمية):
- لا تغيّر أو تختلق أي سعر/هدف/وقف/نسبة/Score/R:R. استخدم الأرقام المعطاة أعلاه كما هي.
- لو البيانات ناقصة قل صراحةً في note: «التحليل غير مكتمل».
- confidence تعكس قوة اتساق البيانات المعطاة، لا تخمّن خارجها.

### شكل الإخراج المطلوب (JSON):
{{
  "decision": "BUY/SELL/HOLD/WATCH",
  "confidence": 0-100,
  "agree_with_engine": true,
  "summary": "جملة واحدة واضحة للتوصية",
  "reasons": ["سبب فني 1", "سبب أساسي 2", "سبب سياقي 3"],
  "risk": "مخاطرة واحدة محددة",
  "note": "ملاحظة قصيرة أو تحذير إن وجد تعارض",
  "narrative": "تحليل بلهجة المحلل المحترف. ركز على التدفق العام (Macro/Sector Flow)، التجميع الخفي، سحب السيولة (Liquidity Sweep)، ومعدل الـ R/R.",
  "disclaimer": "الاستثمار ينطوي على مخاطر وقد تتعرض لخسارة رأس المال"
}}"""
        return prompt
