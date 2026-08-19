#!/usr/bin/env python3
import sqlite3
import logging
from pathlib import Path
from datetime import datetime

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

AI_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = AI_DIR.parents[1]  # يصعد خطوتين لـ GLMinvestment root

PREDICTIONS_DB = str(PROJECT_ROOT / "db" / "predictions.db")
PRICE_DB = str(PROJECT_ROOT / "db" / "price_history.db")

def init_story_table():
    conn = sqlite3.connect(PREDICTIONS_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS stock_stories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT,
            pattern_type TEXT,
            story_date TEXT,
            story_text TEXT,
            keywords TEXT,
            outcome_pct REAL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_stories_ticker_pattern 
        ON stock_stories(ticker, pattern_type)
    """)
    conn.commit()
    conn.close()

def extract_patterns_for_ticker(ticker: str):
    conn_price = sqlite3.connect(PRICE_DB)
    conn_price.row_factory = sqlite3.Row
    rows = conn_price.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history
        WHERE ticker = ? AND close_price > 0
        ORDER BY date ASC
    """, (ticker,)).fetchall()
    conn_price.close()
    
    if len(rows) < 40:
        return 0
        
    stories = []
    volumes = [r["volume"] for r in rows]
    
    for i in range(20, len(rows) - 10):
        curr = rows[i]
        prev = rows[i-1]
        avg_vol = sum(volumes[i-20:i]) / 20
        if avg_vol == 0:
            continue
            
        vol_ratio = curr["volume"] / avg_vol
        price_change = (curr["close_price"] - prev["close_price"]) / prev["close_price"]
        
        if price_change <= -0.04:
            future_prices = [rows[j]["close_price"] for j in range(i+1, min(i+11, len(rows)))]
            if not future_prices:
                continue
            max_future = max(future_prices)
            future_return = (max_future - curr["close_price"]) / curr["close_price"]
            
            if future_return >= 0.05:
                story_text = (
                    f"في تاريخ {curr['date']}، تعرض سهم {ticker} لصدمة هبوط حاد بنسبة {price_change*100:.1f}% "
                    f"ليغلق عند {curr['close_price']:.2f}. كان حجم التداول وقتها يعادل {vol_ratio:.1f}x من المتوسط. "
                    f"شهد السهم بعدها ارتداداً قوياً ليحقق عائداً أقصى قدره +{future_return*100:.1f}% في غضون 10 أيام."
                )
                stories.append({
                    "ticker": ticker,
                    "pattern_type": "PANIC_BOUNCE",
                    "story_date": curr["date"],
                    "story_text": story_text,
                    "keywords": "panic_bounce,high_volatility,short_term_rebound",
                    "outcome_pct": round(future_return * 100, 2)
                })
                
        elif price_change >= 0.04 and vol_ratio >= 2.5:
            future_prices = [rows[j]["close_price"] for j in range(i+1, min(i+11, len(rows)))]
            if not future_prices:
                continue
            close_10d = future_prices[-1]
            return_10d = (close_10d - curr["close_price"]) / curr["close_price"]
            
            status = "مواصلة اتجاهه الصاعد" if return_10d > 0 else "تهدئة وجني أرباح"
            story_text = (
                f"في تاريخ {curr['date']}، حقق سهم {ticker} اختراقاً صعودياً قوياً بنسبة +{price_change*100:.1f}% "
                f"بمصاحبة سيولة ضخمة جداً بلغت {vol_ratio:.1f}x ضعف المعدل المعتاد. أدى هذا الاختراق لـ "
                f"{status} ليغلق بعد 10 أيام على عائد {return_10d*100:+.1f}%."
            )
            stories.append({
                "ticker": ticker,
                "pattern_type": "BREAKOUT",
                "story_date": curr["date"],
                "story_text": story_text,
                "keywords": "breakout,volume_spike,momentum",
                "outcome_pct": round(return_10d * 100, 2)
            })

        elif i > 5:
            last_5 = rows[i-5:i+1]
            changes = [(last_5[j]["close_price"] - last_5[j-1]["close_price"])/last_5[j-1]["close_price"] for j in range(1, 6)]
            vols = [last_5[j]["volume"]/avg_vol for j in range(1, 6)]
            
            if all(c < 0 for c in changes) and all(v < 0.8 for v in vols):
                future_prices = [rows[j]["close_price"] for j in range(i+1, min(i+11, len(rows)))]
                if not future_prices:
                    continue
                max_future = max(future_prices)
                future_return = (max_future - curr["close_price"]) / curr["close_price"]
                
                if future_return >= 0.04:
                    story_text = (
                        f"في الفترة المنتهية بـ {curr['date']}، سجل سهم {ticker} تراجعاً تدريجياً مستمراً لـ 5 جلسات "
                        f"بأحجام تداول ضعيفة جداً بلغت {sum(vols)/5:.1f}x من المتوسط، مما أشار لضعف البائعين وغياب ضغط البيع الفعلي. "
                        f"ارتد السهم بعدها مباشرة ليحقق عائداً قدره +{future_return*100:.1f}%."
                    )
                    stories.append({
                        "ticker": ticker,
                        "pattern_type": "LOW_VOL_DROP",
                        "story_date": curr["date"],
                        "story_text": story_text,
                        "keywords": "low_volume_drop,quiet_decline,reversal",
                        "outcome_pct": round(future_return * 100, 2)
                    })

    if stories:
        conn = sqlite3.connect(PREDICTIONS_DB)
        for s in stories:
            dup = conn.execute(
                "SELECT id FROM stock_stories WHERE ticker=? AND story_date=? AND pattern_type=?",
                (s["ticker"], s["story_date"], s["pattern_type"])
            ).fetchone()
            
            if not dup:
                conn.execute("""
                    INSERT INTO stock_stories (ticker, pattern_type, story_date, story_text, keywords, outcome_pct)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (s["ticker"], s["pattern_type"], s["story_date"], s["story_text"], s["keywords"], s["outcome_pct"]))
        conn.commit()
        conn.close()
        
    return len(stories)

def build_book_of_experiences():
    init_story_table()
    conn = sqlite3.connect(PREDICTIONS_DB)
    rows = conn.execute("SELECT DISTINCT ticker FROM stored_analyses ORDER BY maestro_score DESC").fetchall()
    conn.close()
    
    tickers = [r[0] for r in rows]
    logger.info(f"📋 بدء استخراج القصص لـ {len(tickers)} سهم...")
    
    total_stories = 0
    for idx, ticker in enumerate(tickers, 1):
        try:
            count = extract_patterns_for_ticker(ticker)
            total_stories += count
            if idx % 20 == 0 or count > 0:
                logger.info(f"  [{idx:3d}/{len(tickers)}] {ticker:6s} | تم استخراج {count:2d} قصة")
        except Exception as e:
            logger.error(f"  ✗ خطأ في {ticker}: {e}")
            
    logger.info(f"🎉 اكتمل بناء كتاب التجارب! إجمالي القصص المستخرجة: {total_stories}")

if __name__ == '__main__':
    build_book_of_experiences()


# ============================================================
# BRIEF-042 Task 5: التعلم المستمر (التلقين التلقائي)
# ============================================================
# عند إغلاق كل توقع (TARGET_HIT أو STOPPED)، تولّد "قصة/درس"
# تلقائياً وتخزنها في stock_stories ليستخدمها الـ RAG لاحقاً.
# ============================================================

def generate_story_from_closed_trade(closed_trade: dict) -> bool:
    """
    BRIEF-042: يولّد قصة عربية تلقائية من توقع مغلق ويخزنها في stock_stories.

    Args:
        closed_trade: dict يحتوي على:
            - ticker: رمز السهم
            - entry_price: سعر الدخول
            - exit_price: سعر الخروج
            - actual_return: نسبة الربح/الخسارة (%)
            - status: 'TARGET_HIT' أو 'STOPPED'
            - signal: 'BUY' أو 'SELL'
            - holding_days: عدد أيام الاحتفاظ
            - rsi: RSI وقت الدخول (اختياري)
            - volume_ratio: volume ratio وقت الدخول (اختياري)
            - prediction_date: تاريخ التوقع
            - outcome_date: تاريخ الإغلاق

    Returns:
        True لو تم التخزين بنجاح، False غير ذلك.
    """
    try:
        init_story_table()

        ticker = closed_trade.get('ticker', '')
        entry = float(closed_trade.get('entry_price', 0) or 0)
        exit_price = float(closed_trade.get('exit_price', 0) or 0)
        ret = float(closed_trade.get('actual_return', 0) or 0)
        status = closed_trade.get('status', '')
        signal = closed_trade.get('signal', 'BUY')
        holding_days = int(closed_trade.get('holding_days', 0) or 0)
        rsi = closed_trade.get('rsi')
        vol_ratio = closed_trade.get('volume_ratio')
        pred_date = closed_trade.get('prediction_date', '')
        outcome_date = closed_trade.get('outcome_date', '')

        if not ticker or entry <= 0:
            return False

        # تحديد نوع النمط
        if status == 'TARGET_HIT' and ret > 0:
            pattern_type = 'TRADE_WIN'
            outcome_verb = 'نجاح'
        elif status == 'STOPPED' or ret < 0:
            pattern_type = 'TRADE_LOSS'
            outcome_verb = 'فشل'
        else:
            pattern_type = 'TRADE_NEUTRAL'
            outcome_verb = 'محايد'

        # بناء نص القصة بالعربية
        rsi_part = f'عند RSI {rsi:.0f}' if rsi else 'بدون RSI محدد'
        vol_part = f'بحجم {vol_ratio:.1f}x' if vol_ratio else 'بحجم عادي'

        if ret > 0:
            story_text = (
                f"تم الشراء في {ticker} عند {entry:.2f} {rsi_part} {vol_part}، "
                f"والنتيجة كانت {outcome_verb} +{ret:.1f}% في {holding_days} يوم "
                f"لأن الإشارة كانت {signal}. السهم وصل للهدف عند {exit_price:.2f}."
            )
        elif ret < 0:
            story_text = (
                f"فشل صفقة {ticker} بسبب الشراء عند {entry:.2f} {rsi_part} {vol_part}. "
                f"السهم نزل وضرب الوقف عند {exit_price:.2f} بخسارة {ret:.1f}% في {holding_days} يوم. "
                f"الدرس: تجنب الدخول بهذه الشروط."
            )
        else:
            story_text = (
                f"صفقة محايدة على {ticker} عند {entry:.2f}، أغلقت عند {exit_price:.2f} "
                f"بدون ربح أو خسارة في {holding_days} يوم."
            )

        # الكلمات المفتاحية
        keywords = f"{pattern_type.lower()},{signal.lower()},{'win' if ret > 0 else 'loss' if ret < 0 else 'neutral'}"

        # التاريخ (نستخدم outcome_date لو موجود، غير ذلك prediction_date)
        story_date = outcome_date or pred_date or datetime.now().strftime('%Y-%m-%d')

        # التخزين (مع فحص التكرار)
        conn = sqlite3.connect(PREDICTIONS_DB)
        dup = conn.execute(
            "SELECT id FROM stock_stories WHERE ticker=? AND story_date=? AND pattern_type=?",
            (ticker, story_date, pattern_type)
        ).fetchone()

        if not dup:
            conn.execute("""
                INSERT INTO stock_stories (ticker, pattern_type, story_date, story_text, keywords, outcome_pct)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (ticker, pattern_type, story_date, story_text, keywords, round(ret, 2)))
            conn.commit()
            logger.info(f"📝 BRIEF-042: تم تخزين قصة {pattern_type} لـ {ticker} ({ret:+.1f}%)")
            conn.close()
            return True
        else:
            conn.close()
            return False

    except Exception as e:
        logger.error(f"generate_story_from_closed_trade failed: {e}")
        return False


def process_recently_closed_trades(days: int = 7) -> dict:
    """
    BRIEF-042: يعالج كل التوقعات المغلقة في آخر X يوم ويولّد قصص لها.

    يُستدعى يومياً بعد إغلاق السوق (15:30) عبر market_scheduler.py.
    """
    try:
        from datetime import datetime, timedelta
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

        conn = sqlite3.connect(PREDICTIONS_DB)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT ticker, signal, signal_type, prediction_date,
                   entry_price, exit_price, actual_return,
                   hit_target, hit_stop, holding_days, outcome_date
            FROM predictions
            WHERE outcome_date IS NOT NULL
              AND date(outcome_date) >= date(?)
            ORDER BY outcome_date DESC
            LIMIT 100
        """, (cutoff,)).fetchall()
        conn.close()

        processed = 0
        stored = 0
        for r in rows:
            d = dict(r)
            status = 'TARGET_HIT' if d.get('hit_target') else ('STOPPED' if d.get('hit_stop') else 'EXPIRED')
            d['status'] = status
            stored = generate_story_from_closed_trade(d)
            if stored:
                processed += 1

        logger.info(f"📝 BRIEF-042: process_closed_trades — {processed} قصة جديدة من {len(rows)} توقع مغلق")
        return {
            'success': True,
            'total_closed': len(rows),
            'stories_generated': processed,
        }
    except Exception as e:
        logger.error(f"process_recently_closed_trades failed: {e}")
        return {'success': False, 'error': str(e)}
