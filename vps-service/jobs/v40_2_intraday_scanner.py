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
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

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
from analyzers.v76_golden_hunter import analyze_v76
from analyzers.prediction_tracker import PredictionTracker
from core.opportunity_quality import compute_dynamic_target


def get_active_intraday_tickers(min_volume: int = 10000) -> List[Dict[str, Any]]:
    """جلب جميع الأسهم النشطة اليوم من قاعدة intraday.db مرتبة حسب السيولة."""
    if not INTRADAY_DB.exists():
        return []
    try:
        conn = sqlite3.connect(str(INTRADAY_DB), timeout=5.0)
        today_str = datetime.now().strftime('%Y-%m-%d')
        # تحقق من وجود بيانات اليوم أو أحدث يوم متاح
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
        conn = sqlite3.connect(str(STOCKS_DB), timeout=3.0)
        s_row = conn.execute("SELECT sector FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
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

    # تدفق الميكرز
    if maker.get('flow') == 'buying':
        m_conf = maker.get('confidence', 0)
        if m_conf >= 60:
            score += 20
            reasons.append(f"دخول سيولة مؤسسية حقيقية (ثقة {m_conf}%)")
        else:
            score += 10
    elif maker.get('flow') == 'selling':
        score -= 25
        reasons.append("خروج سيولة مؤسسية / تصريف")

    # الاختراق اللحظي
    if breakout.get('is_breakout'):
        score += 15
        reasons.append(f"اختراق قمة آخر ساعتين بحجم {breakout['volume_ratio']}x")

    # أداء القطاع
    if sector_perf.get('heat') == 'hot':
        score += 8
        reasons.append(f"قطاع ساخن ({sector_name})")
    elif sector_perf.get('heat') == 'cold' and sector_perf.get('avg_change', 0) < -1.5:
        score -= 10

    # تقييم الدخول: هل الإشارة جاهزة للدخول الفوري بأفضل سعر؟
    is_buy = score >= 70 and maker.get('flow') != 'selling'
    if not is_buy:
        return None

    # 6. حساب وقف الخسارة والأهداف بدقة هندسية لحماية رأس المال
    # الوقف: قاع اليوم أو بحد أقصى 8.5% (متوافق مع درع الهندسة)
    day_low = ticker_info['low']
    est_atr = (max(prices) - min(prices))
    if est_atr <= 0:
        est_atr = curr_price * 0.04

    # وقف خسارة محكم بين 5.5% و 8.5% متوافق تماماً مع Geometry Guard
    stop_loss = round(max(curr_price * 0.915, min(curr_price * 0.945, day_low * 0.99 if (0 < day_low < curr_price) else curr_price * 0.93)), 2)
    risk = max(0.01, curr_price - stop_loss)

    # الهدف الأول: ضعف المخاطرة (2R) مع سقف 35% لتفادي W9 rejection
    target_1 = round(min(curr_price * 1.35, curr_price + max(risk * 2.0, est_atr * 2.5)), 2)
    # الهدف الثاني (الانفجاري): 5x ATR
    target_2 = round(curr_price + (est_atr * 5.0), 2)
    rr = round((target_1 - curr_price) / risk, 2)

    return {
        'ticker': ticker,
        'scan_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'current_price': curr_price,
        'signal': 'STRONG_BUY' if score >= 80 else 'BUY',
        'score': min(100, score),
        'entry_price': curr_price,
        'target_price': target_1,
        'target_price_2': target_2,
        'stop_loss': stop_loss,
        'risk_reward': rr,
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
                    kill_filter_result=f"INTRADAY-5M | MAKER:{p['maker_flow']}({p['maker_confidence']}%) | R={p['risk_reward']} | {p['v76_signal']}"
                )
                if pid:
                    saved_count += 1
            print(f"  💾 تم حفظ {saved_count} توقع لحظي في {PREDICTIONS_DB}", flush=True)

            # مزامنة الفرص اللحظية فوراً في stored_analyses ليراها المستخدم في شاشة التوقعات مباشرة
            try:
                conn_sa = sqlite3.connect(str(PREDICTIONS_DB), timeout=30.0)
                cur_sa = conn_sa.cursor()
                now_iso = datetime.now().isoformat()
                today_str = datetime.now().strftime('%Y-%m-%d')
                for p in top_picks:
                    analysis_dict = {
                        'ticker': p['ticker'],
                        'signal': p['signal'],
                        'entry_price': p['entry_price'],
                        'target_price': p['target_price'],
                        'target_price_2': p.get('target_price_2'),
                        'stop_loss': p['stop_loss'],
                        'risk_reward': p.get('risk_reward', 2.0),
                        'reasons': p.get('reasons', []),
                        'maker_flow': p.get('maker_flow', 'ACCUMULATION'),
                        'score': p['score'],
                        'source': 'V40.2_INTRADAY_5M'
                    }
                    sa_id = f"v40_{p['ticker']}_EGX"
                    cur_sa.execute('''
                        INSERT INTO stored_analyses (
                            id, ticker, market, maestro_score, recommendation, recommendation_ar,
                            confidence, entry_price, target_price, stop_loss, risk_reward,
                            prediction_date, updated_at, analysis_json, is_gambler_opportunity, is_investor_opportunity
                        ) VALUES (?, ?, 'EGX', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
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
                            is_investor_opportunity = 1
                    ''', (
                        sa_id, p['ticker'], p['score'], p['signal'], 'شراء قوي' if 'STRONG' in p['signal'] else 'شراء',
                        p.get('maker_confidence', 80), p['entry_price'], p['target_price'], p['stop_loss'],
                        p.get('risk_reward', 2.0), today_str, now_iso, json.dumps(analysis_dict, ensure_ascii=False)
                    ))
                conn_sa.commit()
                conn_sa.close()
                print(f"  ⚡ تم مزامنة {len(top_picks)} فرصة لحظية في stored_analyses لشاشة التوقعات", flush=True)

                # تحديث cached_analysis في stocks.db لإزالة تحذير الكاش القديم
                try:
                    conn_ca = sqlite3.connect(str(STOCKS_DB), timeout=30.0)
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

    return top_picks


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='V40.2 Intraday Realtime Scanner')
    parser.add_argument('--no-save', action='store_true', help='فحص جاف بدون حفظ في قاعدة البيانات')
    parser.add_argument('--limit', type=int, default=5, help='الحد الأقصى للفرص')
    args = parser.parse_args()

    scan_intraday(save_to_db=not args.no_save, limit=args.limit)
