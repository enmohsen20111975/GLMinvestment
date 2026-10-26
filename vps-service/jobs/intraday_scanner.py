#!/usr/bin/env python3
"""
V40.2 Unified Intraday Realtime Engine — محرك التوقعات اللحظي الموحد (كل 5 دقائق)
================================================================================
يقوم بمسح بيانات الـ 5 دقائق الحية من db/intraday.db أثناء جلسة التداول لكشف:
  1. الاختراقات اللحظية (Intraday Breakouts) قبل إغلاق السوق
  2. تدفق السيولة المؤسسية الحية (Smart Money / Maker Flow)
  3. إشارات V76 الذهبية (الانفجار من التجميع + إعادة الاختبار)
  4. حساب أفضل نقطة دخول بأفضل سعر وأعلى عائد R:R

النظام موحد بالكامل مع محرك V40.2 ولا يعتمد على أسلوب الطوب المنفصل.
"""

import os
import sys
import json
import sqlite3
import argparse
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

# Module-level logger (BRAVO-INCUBATOR: used by promote_incubator_candidates)
logger = logging.getLogger(__name__)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s'))
    logger.addHandler(_h)
    logger.setLevel(logging.INFO)

# Path setup
PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
os.chdir(str(PROJECT_ROOT))
os.environ['BYPASS_PRED_CAP'] = '1'

INTRADAY_DB = PROJECT_ROOT / 'db' / 'intraday.db'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'

from analyzers.intraday_reader import (
    get_intraday_data,
    detect_intraday_breakout,
    detect_maker_flow,
    get_sector_performance
)
from analyzers.golden_hunter import analyze_v76
from analyzers.prediction_tracker import PredictionTracker
from core.opportunity_quality import compute_dynamic_target
from analyzers.trader_levels_engine import get_unified_trader_levels


def get_active_intraday_tickers(min_volume: int = 10000) -> List[Dict[str, Any]]:
    """جلب جميع الأسهم النشطة اليوم من قاعدة intraday.db مرتبة حسب السيولة."""
    if not INTRADAY_DB.exists():
        return []
    try:
        # BRAVO-FIX: استخدم direct sqlite3.connect + try/finally بدل __enter__ بدون __exit__
        # الـ bug القديم: db_manager.get_connection() بدون __exit__ بـ يـسبب "closed database"
        # Phase 7.1: migrated
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(INTRADAY_DB), writable=False)
        conn.row_factory = sqlite3.Row
        try:
            today_str = datetime.now().strftime('%Y-%m-%d')
            latest_date_row = conn.execute("SELECT MAX(SUBSTR(timestamp, 1, 10)) FROM stock_intraday").fetchone()
            scan_date = latest_date_row[0] if latest_date_row and latest_date_row[0] else today_str
            
            rows = conn.execute('''
                SELECT ticker, COUNT(*) as bars_count, MAX(price) as high_p, 
                       MIN(price) as low_p, MAX(volume) as max_vol,
                       (SELECT price FROM stock_intraday s2 WHERE s2.ticker = s1.ticker ORDER BY timestamp DESC LIMIT 1) as last_p,
                       (SELECT price FROM stock_intraday s3 WHERE s3.ticker = s1.ticker ORDER BY timestamp ASC LIMIT 1) as first_p
                FROM stock_intraday s1
                WHERE SUBSTR(timestamp, 1, 10) = ?
                GROUP BY ticker
                HAVING max_vol >= ? AND bars_count >= 5
                ORDER BY max_vol DESC
            ''', (scan_date, min_volume)).fetchall()
        finally:
            conn.close()

        result = []
        for r in rows:
            ticker, bars_count, high_p, low_p, max_vol, last_p, first_p = r
            chg_pct = ((last_p - first_p) / first_p * 100) if first_p and first_p > 0 else 0
            result.append({
                'ticker': ticker,
                'scan_date': scan_date,
                'bars_count': bars_count,
                'high': float(high_p or 0),
                'low': float(low_p or 0),
                'last_price': float(last_p or 0),
                'first_price': float(first_p or 0),
                'change_pct': round(chg_pct, 2),
                'volume': float(max_vol or 0)
            })
        return result
    except Exception as e:
        print(f"[INTRADAY-SCANNER] Error getting active tickers: {e}", flush=True)
        return []


def analyze_intraday_opportunity(ticker_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    تحليل سهم واحد بالاعتماد على محرك V40.2 + V76 + Maker Flow اللحظي.
    """
    ticker = ticker_info['ticker']
    curr_price = ticker_info['last_price']
    if curr_price <= 0.10:  # تجاهل الأسهم التي تقل عن 10 قروش
        return None

    # 1. جلب بيانات الـ 5 دقائق (آخر 6 ساعات)
    intra = get_intraday_data(ticker, hours=6)
    prices = intra.get('prices', [])
    volumes = intra.get('volumes', [])
    highs = intra.get('highs', [])
    lows = intra.get('lows', [])
    if len(prices) < 10:
        return None

    # 2. كشف الاختراق اللحظي وتدفق السيولة الذكية (Smart Money)
    breakout = detect_intraday_breakout(ticker, lookback_bars=12)
    maker = detect_maker_flow(ticker, lookback_bars=12)

    # 3. إعداد شموع الـ 5 دقائق للـ V76 Golden Hunter
    # نبني Opens من الإغلاقات السابقة
    opens = [prices[0]] + prices[:-1]
    # الـ highs والـ lows الحقيقية لكل شمعة
    candle_highs = [max(p, o) for p, o in zip(prices, opens)]
    candle_lows = [min(p, o) for p, o in zip(prices, opens)]

    v76_res = analyze_v76(prices, candle_highs, candle_lows, volumes, opens)
    v76_signal = v76_res.get('signal', 'NEUTRAL')

    # 4. قطاع السهم
    sector_name = None
    sector_perf = {}
    try:
        # BRAVO-FIX: direct sqlite3.connect + try/finally (بدل __enter__ بدون __exit__)
        # Phase 7.1: migrated
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(STOCKS_DB), writable=False)
        try:
            s_row = conn.execute("SELECT sector FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
        finally:
            conn.close()
        if s_row and s_row[0]:
            sector_name = s_row[0]
            sector_perf = get_sector_performance(sector_name)
    except Exception:
        pass

    # 5. حساب النتيجة المجمعة وتحديد ما إذا كانت هناك فرصة قوية
    score = 50
    reasons = []

    # إشارة V76
    if v76_signal == 'PUMP_FROM_DESERT':
        score += 25
        reasons.append("انفجار من تجميع (V76 Pump from Desert)")
    elif v76_signal == 'GOLDEN_RETEST':
        score += 20
        reasons.append("إعادة اختبار ذهبية للدعم (V76 Golden Retest)")

    # تدفق الميكرز (حساب ديناميكي متدرج حسب نسبة الثقة)
    if maker.get('flow') == 'buying':
        m_conf = maker.get('confidence', 0)
        conf_boost = int(12 + max(0, m_conf - 50) * 0.4)
        score += conf_boost
        reasons.append(f"دخول سيولة مؤسسية حقيقية (ثقة {m_conf}%)")
    elif maker.get('flow') == 'selling':
        score -= 25
        reasons.append("خروج سيولة مؤسسية / تصريف")

    # الاختراق اللحظي بحجم التداول
    if breakout.get('is_breakout'):
        vr = breakout.get('volume_ratio', 1.0)
        vol_boost = min(22, int(10 + max(0, vr - 1.0) * 4))
        score += vol_boost
        reasons.append(f"اختراق قمة آخر ساعتين بحجم {vr}x")



    # أداء القطاع
    if sector_perf.get('heat') == 'hot':
        score += 8
        reasons.append(f"قطاع ساخن ({sector_name})")
    elif sector_perf.get('heat') == 'cold' and sector_perf.get('avg_change', 0) < -1.5:
        score -= 10

    # 5.5 فحص تحيز الأخبار الواردة من Local News Agent
    try:
        # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
        from ai.market_news_reader import get_news_bias
        news_ctx = get_news_bias(ticker, hours_back=12)
        if news_ctx.get('has_news'):
            # VETO Kill Switch: خبر سلبي شديد الأهمية يمنع الدخول فوراً
            if news_ctx.get('sentiment') == 'bearish' and news_ctx.get('importance', 0) >= 70:
                return None
            bias = news_ctx.get('bias', 0)
            score = max(0, min(100, score + bias))
            if bias != 0:
                dir_str = "دعم إيجابي" if bias > 0 else "ضغط سلبي"
                reasons.append(f"أخبار ({news_ctx.get('sentiment')}: {dir_str} {bias:+d})")
    except Exception:
        pass

    # تقييم الدخول: هل الإشارة جاهزة للدخول الفوري بأفضل سعر؟
    is_buy = score >= 70 and maker.get('flow') != 'selling'
    if not is_buy:
        return None

    # 6. حساب المستويات الهيكلية الاحترافية الموحدة (SSOT)
    levels = get_unified_trader_levels(ticker, current_price=curr_price)
    entry_min = levels['entry_min']
    entry_max = levels['entry_max']
    target_1 = levels['target_1']
    target_2 = levels['target_2']
    stop_loss = levels['stop_loss']
    s1 = levels['support_1']
    s2 = levels['support_2']
    r1 = levels['resistance_1']
    r2 = levels['resistance_2']
    rr = levels['risk_reward']

    reasons.append(f"نطاق الشراء: {levels['entry_range_str']}")
    reasons.append(f"الهدف 1: {target_1:.2f} ج.م (مقاومة م1)")
    reasons.append(f"الهدف 2: {target_2:.2f} ج.م (مقاومة م2)")
    reasons.append(f"وقف الخسارة: {stop_loss:.2f} ج.م (كسر دعم د1)")

    # تقييم العائد إلى المخاطرة لحظياً وتعديل السكور ديناميكياً
    if rr >= 3.0:
        score += 6
    elif rr >= 2.0:
        score += 3
    elif rr < 1.3:
        score -= 6

    return {
        'ticker': ticker,
        'scan_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'current_price': curr_price,
        'signal': 'STRONG_BUY' if score >= 80 else 'BUY',
        'score': min(100, score),
        'entry_price': entry_max,
        'entry_price_min': entry_min,
        'entry_price_max': entry_max,
        'entry_range_str': levels['entry_range_str'],
        'target_price': target_1,
        'target_price_2': target_2,
        'stop_loss': stop_loss,
        'support_level': s1,
        'support_level_2': s2,
        'resistance_level': r1,
        'resistance_level_2': r2,
        'risk_reward': rr,
        'advice': levels['advice'],
        'v76_signal': v76_signal,
        'maker_flow': maker.get('flow'),
        'maker_confidence': maker.get('confidence'),
        'is_breakout': breakout.get('is_breakout'),
        'volume_ratio': breakout.get('volume_ratio'),
        'sector': sector_name,
        'reasons': reasons
    }


def scan_intraday(save_to_db: bool = True, limit: int = 5) -> List[Dict[str, Any]]:
    """تشغيل الفحص اللحظي على كل الأسهم النشطة وإرجاع أفضل الفرص."""
    print(f"\n⚡ [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] بدء الفحص اللحظي لمحرك V40.2 الموحد...", flush=True)
    active_stocks = get_active_intraday_tickers(min_volume=20000)
    print(f"  تم العثور على {len(active_stocks)} سهماً نشطاً اليوم في intraday.db", flush=True)

    opportunities = []
    for stock in active_stocks:
        opp = analyze_intraday_opportunity(stock)
        if opp:
            opportunities.append(opp)

    # ترتيب الفرص حسب القوة والعائد
    opportunities.sort(key=lambda x: (-x['score'], -x['risk_reward']))
    top_picks = opportunities[:limit]

    print(f"\n🎯 عدد الفرص اللحظية المكتشفة: {len(top_picks)} من أصل {len(opportunities)} سهم مرشح", flush=True)
    for i, p in enumerate(top_picks, 1):
        print(f"  [{i}] {p['ticker']} | {p['signal']} (Score: {p['score']}/100)")
        print(f"      سعر الدخول: {p['entry_price']:.3f} | الوقف: {p['stop_loss']:.3f} | هدف 1: {p['target_price']:.3f} (R:R {p['risk_reward']}R) | هدف 2: {p['target_price_2']:.3f}")
        print(f"      الأسباب: {' + '.join(p['reasons'])}")

    # حفظ في predictions.db إذا كان مفعلاً
    if save_to_db and top_picks:
        try:
            tracker = PredictionTracker(str(PREDICTIONS_DB))
            saved_count = 0
            for p in top_picks:
                # UNIFY-FIX (Rule 73 SINGLE-WRITER): مرر risk_reward + who_is_buying_state
                # كان intraday_scanner يكتب predictions بدون هذه الحقول → NULL في DB
                pid = tracker.record_prediction(
                    ticker=p['ticker'],
                    signal=p['signal'],
                    entry_price=p['entry_price'],
                    target_price=p['target_price'],
                    stop_loss=p['stop_loss'],
                    master_score=p['score'],
                    technical_score=p['score'],
                    persona='balanced',
                    atr_at_entry=round(p['entry_price'] * 0.04, 3),
                    target_price_2=p['target_price_2'],
                    prediction_date=datetime.now().strftime('%Y-%m-%d'),
                    evidence_count=4,
                    risk_reward=p['risk_reward'],  # P0 FIX: كان مفقود
                    who_is_buying_state=p.get('maker_flow', ''),  # P0 FIX: كان مفقود
                    kill_filter_result=f"INTRADAY-5M | MAKER:{p['maker_flow']}({p['maker_confidence']}%) | R={p['risk_reward']} | {p['v76_signal']}"
                )
                if pid:
                    saved_count += 1
                    try:
                        # BRAVO-FIX: direct sqlite3.connect + try/finally
                        # Phase 7.1: migrated to db_manager (writable=True)
                        from core.db_manager import db_manager
                        conn_p = db_manager.get_connection(str(PREDICTIONS_DB), writable=True)
                        try:
                            conn_p.execute("""
                                UPDATE predictions 
                                SET entry_price_min = ?, entry_price_max = ?, support_level = ?, support_level_2 = ?, resistance_level = ?, resistance_level_2 = ?
                                WHERE id = ?
                            """, (
                                p.get('entry_price_min'), p.get('entry_price_max'),
                                p.get('support_level'), p.get('support_level_2'),
                                p.get('resistance_level'), p.get('resistance_level_2'),
                                pid
                            ))
                            conn_p.commit()
                        finally:
                            conn_p.close()
                    except Exception:
                        pass
            print(f"  💾 تم حفظ {saved_count} توقع لحظي في {PREDICTIONS_DB}", flush=True)

            # مزامنة الفرص اللحظية فوراً في stored_analyses ليراها المستخدم في شاشة التوقعات مباشرة
            # SINGLE-WRITER (Task PHASE-3, Rule 73) — only daily_predictor.py should write to stored_analyses.
            # The INSERT below is DISABLED to prevent conflicting decisions (last-writer-wins).
            # The cached_analysis (stocks.db) update that follows still runs (different table).
            SKIP_STORED_ANALYSES_WRITE = True
            try:
                # BRAVO-FIX: direct sqlite3.connect + try/finally
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                conn_sa = db_manager.get_connection(str(PREDICTIONS_DB), writable=False)
                cur_sa = conn_sa.cursor()
                # ضمان وجود جميع الأعمدة اللازمة في سيرفر الإنتاج بدون أخطاء schema
                for col_name, col_type in [
                    ("prediction_date", "TEXT"),
                    ("is_gambler_opportunity", "INTEGER DEFAULT 1"),
                    ("is_investor_opportunity", "INTEGER DEFAULT 1"),
                    ("analysis_json", "TEXT"),
                    ("logo_url", "TEXT")
                ]:
                    try:
                        cur_sa.execute(f"ALTER TABLE stored_analyses ADD COLUMN {col_name} {col_type}")
                    except Exception:
                        pass
                now_iso = datetime.now().isoformat()
                today_str = datetime.now().strftime('%Y-%m-%d')
                for p in top_picks:
                    # جلب اللوجو والاسم العربي من stocks.db
                    logo_url = ''
                    name_ar = p['ticker']
                    try:
                        # BRAVO-FIX: direct sqlite3.connect + try/finally
                        # Phase 7.1: migrated to db_manager (writable=False)
                        from core.db_manager import db_manager
                        conn_s = db_manager.get_connection(str(STOCKS_DB), writable=False)
                        try:
                            s_r = conn_s.execute("SELECT logo_url, name_ar FROM stocks WHERE ticker = ?", (p['ticker'],)).fetchone()
                        finally:
                            conn_s.close()
                        if s_r:
                            logo_url = s_r[0] or ''
                            name_ar = s_r[1] or p['ticker']
                    except Exception:
                        pass

                    analysis_dict = {
                        'ticker': p['ticker'],
                        'name_ar': name_ar,
                        'logo_url': logo_url,
                        'signal': p['signal'],
                        'entry_price': p['entry_price'],
                        'entry_price_min': p.get('entry_price_min'),
                        'entry_price_max': p.get('entry_price_max'),
                        'entry_range_str': p.get('entry_range_str'),
                        'target_price': p['target_price'],
                        'target_price_2': p.get('target_price_2'),
                        'stop_loss': p['stop_loss'],
                        'support_level': p.get('support_level'),
                        'support_level_2': p.get('support_level_2'),
                        'resistance_level': p.get('resistance_level'),
                        'resistance_level_2': p.get('resistance_level_2'),
                        'risk_reward': p.get('risk_reward', 2.0),
                        'advice': p.get('advice'),
                        'reasons': p.get('reasons', []),
                        'maker_flow': p.get('maker_flow', 'ACCUMULATION'),
                        'score': p['score'],
                        'source': 'V40.2_INTRADAY_5M'
                    }
                    sa_id = f"v40_{p['ticker']}_EGX"
                    # SINGLE-WRITER (Task PHASE-3, Rule 73) — guard wraps the actual INSERT.
                    if not SKIP_STORED_ANALYSES_WRITE:
                        cur_sa.execute('''
                            INSERT INTO stored_analyses (
                                id, ticker, market, maestro_score, recommendation, recommendation_ar,
                                confidence, entry_price, target_price, stop_loss, risk_reward,
                                prediction_date, updated_at, analysis_json, is_gambler_opportunity, is_investor_opportunity, logo_url
                            ) VALUES (?, ?, 'EGX', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
                            ON CONFLICT(ticker, market) DO UPDATE SET
                                maestro_score = excluded.maestro_score,
                                recommendation = excluded.recommendation,
                                recommendation_ar = excluded.recommendation_ar,
                                confidence = excluded.confidence,
                                entry_price = excluded.entry_price,
                                target_price = excluded.target_price,
                                stop_loss = excluded.stop_loss,
                                risk_reward = excluded.risk_reward,
                                prediction_date = excluded.prediction_date,
                                updated_at = excluded.updated_at,
                                analysis_json = excluded.analysis_json,
                                is_gambler_opportunity = 1,
                                is_investor_opportunity = 1,
                                logo_url = excluded.logo_url
                        ''', (
                            sa_id, p['ticker'], p['score'], p['signal'], 'شراء قوي' if 'STRONG' in p['signal'] else 'شراء',
                            p.get('maker_confidence', 80), p['entry_price'], p['target_price'], p['stop_loss'],
                            p.get('risk_reward', 2.0), today_str, now_iso, json.dumps(analysis_dict, ensure_ascii=False),
                            logo_url
                        ))
                    else:
                        # SINGLE-WRITER skip — no INSERT executed; transaction stays empty.
                        pass
                if not SKIP_STORED_ANALYSES_WRITE:
                    conn_sa.commit()
                    conn_sa.close()
                    print(f"  ⚡ تم مزامنة {len(top_picks)} فرصة لحظية في stored_analyses لشاشة التوقعات", flush=True)
                else:
                    try:
                        conn_sa.close()
                    except Exception:
                        pass
                    print(f"  ⚡ [SINGLE-WRITER] Skipping stored_analyses sync for {len(top_picks)} picks — use daily_predictor.py", flush=True)

                # تحديث cached_analysis في stocks.db لإزالة تحذير الكاش القديم
                try:
                    # BRAVO-FIX: direct sqlite3.connect + try/finally
                    # Phase 7.1: migrated to db_manager (writable=True)
                    from core.db_manager import db_manager
                    conn_ca = db_manager.get_connection(str(STOCKS_DB), writable=True)
                    cur_ca = conn_ca.cursor()
                    for p in top_picks:
                        cur_ca.execute('''
                            INSERT INTO cached_analysis (
                                ticker, current_price, entry_price, target_price, stop_loss,
                                signal, recommendation, confidence, master_score, risk_reward,
                                created_at, updated_at, analysis_date, is_tradeable
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), date('now'), 1)
                            ON CONFLICT(ticker) DO UPDATE SET
                                current_price = excluded.current_price,
                                entry_price = excluded.entry_price,
                                target_price = excluded.target_price,
                                stop_loss = excluded.stop_loss,
                                signal = excluded.signal,
                                recommendation = excluded.recommendation,
                                confidence = excluded.confidence,
                                master_score = excluded.master_score,
                                risk_reward = excluded.risk_reward,
                                created_at = datetime('now'),
                                updated_at = datetime('now'),
                                analysis_date = date('now'),
                                is_tradeable = 1
                        ''', (
                            p['ticker'], p['entry_price'], p['entry_price'], p['target_price'], p['stop_loss'],
                            p['signal'], p['signal'], p.get('maker_confidence', 80), p['score'], p.get('risk_reward', 2.0)
                        ))
                    conn_ca.commit()
                    conn_ca.close()
                except Exception as _ca_e:
                    print(f"  ⚠️ خطأ في مزامنة cached_analysis: {_ca_e}", flush=True)
            except Exception as _sa_e:
                print(f"  ⚠️ خطأ في مزامنة stored_analyses: {_sa_e}", flush=True)
        except Exception as e:
            print(f"  ⚠️ خطأ أثناء حفظ التوقعات اللحظية: {e}", flush=True)

    # BRAVO-INCUBATOR: promote any incubator candidates that met their trigger
    try:
        promoted = promote_incubator_candidates()
        if promoted:
            logger.info(f"🔭 Incubator promoted {len(promoted)} stocks: {promoted}")
    except Exception as e:
        logger.error(f"Incubator promotion error: {e}")

    return top_picks


def _run_liquidity_alerts_hook() -> None:
    """LIQUIDITY-ALERTS-IMPL (2026-10-07 — owner directive):
    Fire sector + stock liquidity flow Telegram alerts after each 5-min scan.
    Safe-by-design: any failure is logged + swallowed (never crashes the scanner).
    """
    try:
        from telegram.liquidity_alerts import run_liquidity_alerts
        summary = run_liquidity_alerts()
        if summary.get('total', 0) > 0:
            print(f"  📨 [LIQUIDITY-ALERTS] sent: {summary}", flush=True)
    except Exception as _la_err:
        # Never crash the scanner — alerts are best-effort.
        print(f"  ⚠️ [LIQUIDITY-ALERTS] failed: {_la_err}", flush=True)


# ============================================================================
# BRAVO-INCUBATOR: Intraday Promotion Hook — الترقية اللحظية
# ============================================================================
def promote_incubator_candidates(market: str = 'EGX') -> list:
    """آلية الترقية اللحظية (Intraday Promotion Hook).

    أثناء جلسة التداول: قراءة قائمة incubator_candidates من الكاش.
    لو سهم حقق شرط الـ Trigger (كسر trigger_price أو فوليوم اختراق):
      1. يتم تسجيل التوقع فوراً في predictions بـ signal='BUY', track='RADAR_PROMOTED'
      2. يُرسل إشعار للواجهة وللبوت

    Args:
        market: كود السوق (default: EGX)

    Returns:
        list of promoted tickers
    """
    import glob
    import json as _json
    from pathlib import Path
    from datetime import datetime as _dt

    project_root = Path(__file__).resolve().parents[2]
    output_dir = project_root / 'scripts' / 'output'
    pattern = str(output_dir / f'maker_radar_{market}_*.json')
    cache_files = sorted(glob.glob(pattern), reverse=True)

    if not cache_files:
        return []

    try:
        with open(cache_files[0], 'r', encoding='utf-8') as f:
            cache_data = _json.load(f)
    except Exception:
        return []

    candidates = cache_data.get('incubator_candidates', [])
    if not candidates:
        return []

    promoted = []

    # اقرأ الأسعار اللحظية الحالية من intraday.db
    intraday_db = project_root / 'db' / 'intraday.db'
    predictions_db = project_root / 'db' / 'predictions.db'

    try:
        import sqlite3
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        intra_conn = db_manager.get_connection(str(intraday_db), writable=False)
        intra_conn.row_factory = sqlite3.Row
    except Exception:
        return []

    try:
        for cand in candidates:
            ticker = cand.get('ticker', '')
            trigger = cand.get('trigger', {})
            trigger_type = trigger.get('type')
            trigger_price = trigger.get('trigger_price')

            if not ticker or not trigger_type:
                continue

            # اقرأ آخر سعر + حجم لحظي للسهم
            row = intra_conn.execute(
                "SELECT price, volume FROM stock_intraday WHERE ticker = ? ORDER BY timestamp DESC LIMIT 1",
                (ticker,)
            ).fetchone()

            if not row:
                continue

            live_price = row['price'] or 0
            live_volume = row['volume'] or 0

            if live_price <= 0:
                continue

            # فحص تحقق الشرط
            triggered = False
            if trigger_type == 'RESISTANCE_BREAK' and trigger_price:
                # الشرط: السعر كسر trigger_price
                if live_price > trigger_price:
                    triggered = True
            elif trigger_type == 'SUPPORT_CONFIRM' and trigger_price:
                # الشرط: السعر ثبت فوق trigger_price (الدعم)
                if live_price > trigger_price:
                    triggered = True
            elif trigger_type == 'VOLUME_SURGE':
                # الشرط: الحجم الحالي > 1.5× متوسط 20 يوم
                avg_vol_20 = cand.get('avg_volume_20d') or 0
                if avg_vol_20 > 0 and live_volume > avg_vol_20 * 1.5:
                    triggered = True

            if not triggered:
                continue

            # سجّل التوقع في predictions.db
            # B2 FIX (Task 1-b, Bravo): replace `INSERT OR IGNORE` (which silently
            # dropped updates AND created one row per 5-min scan = up to 60 dup
            # rows per ticker per day) with explicit check-then-update.
            #
            # Identity model (see scripts/b2_dedup_migration.py):
            #   (ticker, date(prediction_date), persona, market, track)
            # = ONE prediction per day per persona per market per track.
            #
            # If a matching row already exists for today (same ticker+persona+market+track),
            # UPDATE only the mutable analysis fields — PRESERVE the original
            # entry_price / stop_loss / target_price / prediction_date / persona
            # (owner constraint #2 + #6: do NOT overwrite the original Entry Price;
            # the FIRST row holds the original).
            try:
                # Phase 7.1: migrated to db_manager (writable=True)
                from core.db_manager import db_manager
                pred_conn = db_manager.get_connection(str(predictions_db), writable=True)
                pred_cur = pred_conn.cursor()

                _today_str = _dt.now().strftime('%Y-%m-%d')
                _track_val = 'RADAR_PROMOTED'
                _market_val = 'EGX'  # promote_incubator_candidates is EGX-only by design
                _persona_val = 'balanced'

                # Look up any existing row for today's identity.
                _existing = pred_cur.execute("""
                    SELECT id, entry_price, stop_loss, target_price, prediction_date
                    FROM predictions
                    WHERE ticker = ?
                      AND substr(prediction_date,1,10) = ?
                      AND persona = ?
                      AND market = ?
                      AND track = ?
                    ORDER BY prediction_date ASC, rowid ASC
                    LIMIT 1
                """, (ticker, _today_str, _persona_val, _market_val, _track_val)).fetchone()

                _now_iso = _dt.now().isoformat()
                _now_full = _dt.now().strftime('%Y-%m-%d %H:%M:%S')
                _notes_val = (
                    f"تمت الترقية لايف من رادار التربص بعد تحقيق شرط "
                    f"{trigger.get('condition_ar', trigger_type)}"
                )

                if _existing:
                    # UPDATE mutable fields only — preserve original prices + dates + persona.
                    # The UNIQUE INDEX idx_predictions_dedup (created by B2 migration)
                    # would otherwise ABORT a bare INSERT; we avoid that by going through
                    # this UPDATE path explicitly.
                    _orig_id = _existing[0]
                    try:
                        pred_cur.execute("""
                            UPDATE predictions SET
                                signal = 'BUY',
                                signal_type = 'BUY',
                                risk_reward = ?,
                                confidence = ?,
                                notes = ?,
                                updated_at = ?,
                                update_count = COALESCE(update_count, 0) + 1,
                                kill_filter_result = COALESCE(kill_filter_result, '') || ' | re-triggered ' || ?
                            WHERE id = ?
                        """, (
                            cand.get('risk_reward'),
                            cand.get('readiness_pct', 80),
                            _notes_val,
                            _now_iso,
                            _now_full,
                            _orig_id,
                        ))
                        logger.info(
                            f"🚀 INCUBATOR PROMOTED (UPDATE existing): {ticker} — "
                            f"trigger={trigger_type}, live_price={live_price}, "
                            f"existing_id={_orig_id}, original_entry={_existing[1]} "
                            f"(PRESERVED), update_count→COALESCE+1"
                        )
                    except Exception as _upde:
                        # Fallback: if update_count column missing (old schema),
                        # retry without it. Idempotent ALTER handles future runs.
                        try:
                            pred_cur.execute("""
                                UPDATE predictions SET
                                    signal = 'BUY',
                                    signal_type = 'BUY',
                                    risk_reward = ?,
                                    confidence = ?,
                                    notes = ?,
                                    updated_at = ?
                                WHERE id = ?
                            """, (
                                cand.get('risk_reward'),
                                cand.get('readiness_pct', 80),
                                _notes_val,
                                _now_iso,
                                _orig_id,
                            ))
                        except Exception:
                            raise
                    promoted.append(ticker)
                else:
                    # No existing row for today → INSERT a new one.
                    pred_cur.execute("""
                        INSERT INTO predictions (
                            ticker, signal, signal_type, entry_price, stop_loss, target_price,
                            risk_reward, confidence, track, notes, prediction_date, created_at,
                            persona, market, updated_at, update_count
                        ) VALUES (?, 'BUY', 'BUY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                    """, (
                        ticker,
                        cand.get('current_price', live_price),
                        cand.get('stop_loss_if_promoted'),
                        cand.get('target_if_promoted'),
                        cand.get('risk_reward'),
                        cand.get('readiness_pct', 80),
                        _track_val,
                        _notes_val,
                        _now_full,
                        _now_iso,
                        _persona_val,
                        _market_val,
                        _now_iso,
                    ))
                    logger.info(
                        f"🚀 INCUBATOR PROMOTED (NEW INSERT): {ticker} — "
                        f"trigger={trigger_type}, live_price={live_price}"
                    )
                    promoted.append(ticker)

                pred_conn.commit()
                pred_conn.close()
            except Exception as e:
                logger.error(f"Failed to promote {ticker}: {e}")

    finally:
        intra_conn.close()

    return promoted


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='V40.2 Intraday Realtime Scanner')
    parser.add_argument('--no-save', action='store_true', help='فحص جاف بدون حفظ في قاعدة البيانات')
    parser.add_argument('--limit', type=int, default=5, help='الحد الأقصى للفرص')
    args = parser.parse_args()

    scan_intraday(save_to_db=not args.no_save, limit=args.limit)

    # ── LIQUIDITY FLOW ALERTS (2026-10-07 — owner directive) ─────────────
    # Send sector flow IN/OUT + stock accumulation/distribution alerts
    # AFTER each intraday scan completes (5-min cadence during market hours).
    _run_liquidity_alerts_hook()
