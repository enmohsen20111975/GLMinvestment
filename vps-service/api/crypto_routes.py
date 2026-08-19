# DEPRECATED: This route is not registered in lightweight_server.py
#!/usr/bin/env python3
"""
Crypto API Routes
=================

API endpoints للعملات الرقمية:
- GET /api/crypto/status - حالة السوق
- GET /api/crypto/maestro/<coin_id> - تحليل عملة
- GET /api/crypto/quick-scan - فرص سريعة
- GET /api/crypto/regime - حالة السوق الكريبتو
- GET /api/crypto/bulk-analysis - تحليل شامل لكل العملات
- GET /api/crypto/categories - تصنيف العملات (قوية/ضعيفة/مكاسب صغيرة)

@authorM2yDevelopers Team
@version 2.0.0
"""

from flask import Blueprint, jsonify, request
from datetime import datetime
import sys
import os

# Add parent directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.crypto_maestro import CryptoMaestroOrchestrator, analyze_crypto
from analyzers.crypto_regime import CryptoRegimeDetector, get_crypto_regime
from analyzers.crypto_analyzer import CryptoAnalyzer

# Create blueprint
crypto_bp = Blueprint('crypto', __name__, url_prefix='/api/crypto')


# ============================================================================
# ROUTES
# ============================================================================

@crypto_bp.route('/status', methods=['GET'])
def get_status():
    """
    حالة نظام الكريبتو
    
    Returns:
        Status and available endpoints
    """
    return jsonify({
        "status": "online",
        "service": "Crypto Maestro",
        "version": "2.0.0",
        "endpoints": {
            "GET /api/crypto/status": "System status",
            "GET /api/crypto/regime": "Market regime (BTC Dom, Fear & Greed)",
            "GET /api/crypto/maestro/<coin_id>": "Full analysis of a coin",
            "GET /api/crypto/bulk-analysis": "تحليل شامل لكل العملات (NEW!)",
            "GET /api/crypto/categories": "تصنيف العملات (قوية/ضعيفة/مكاسب صغيرة) (NEW!)",
            "GET /api/crypto/quick-scan": "Top 10 opportunities",
            "GET /api/crypto/top/<limit>": "Analyze top N coins",
            "GET /api/crypto/prices": "Current prices"
        }
    })


@crypto_bp.route('/regime', methods=['GET'])
def get_regime():
    """
    حالة سوق الكريبتو
    
    Returns:
        BTC Dominance, Fear & Greed, Alt Season Score, etc.
    """
    try:
        regime = get_crypto_regime()
        
        return jsonify({
            "success": True,
            "data": {
                "regime": regime.regime,
                "btc_dominance": regime.btc_dominance,
                "fear_greed_index": regime.fear_greed_index,
                "alt_season_score": regime.alt_season_score,
                "volatility_regime": regime.volatility_regime,
                "signal": regime.signal,
                "reasons": regime.reasons,
                "timestamp": datetime.now().isoformat()
            }
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/maestro/<coin_id>', methods=['GET'])
def analyze_coin(coin_id: str):
    """
    تحليل عملة رقمية
    
    Args:
        coin_id: معرف العملة (bitcoin, ethereum, etc.)
    
    Returns:
        Full analysis with signal, targets, etc.
    """
    try:
        # Add timeout wrapper
        import signal
        
        def timeout_handler(signum, frame):
            raise TimeoutError("API request timed out")
        
        # Set 15 second timeout for the whole analysis
        try:
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(15)
        except Exception:
            pass  # Signal might not work on all platforms
        
        try:
            result = analyze_crypto(coin_id.lower())
            
            # Cancel the alarm
            try:
                signal.alarm(0)
            except Exception:
                pass
            
            if not result:
                return jsonify({
                    "success": False,
                    "error": f"Coin '{coin_id}' not found or data unavailable",
                    "hint": "Try a different coin ID like 'bitcoin', 'ethereum', 'solana'"
                }), 404
            
            return jsonify({
                "success": True,
                "data": {
                    "coin_id": result.coin_id,
                    "symbol": result.symbol,
                    "name": result.name,
                    "timestamp": result.timestamp,
                    "maestro_score": result.maestro_score,
                    "confidence": result.confidence,
                    "signal": result.signal,
                    "signal_ar": result.signal_ar,
                    "prices": {
                        "current": result.current_price,
                        "entry": result.entry_price,
                        "stop_loss": result.stop_loss,
                        "target": result.target,
                        "risk_reward": result.risk_reward
                    },
                    "position_size_pct": result.position_size_pct,
                    "market": {
                        "regime": result.market_regime,
                        "fear_greed": result.fear_greed,
                        "btc_dominance": result.btc_dominance
                    },
                    "circuit_breaker": result.circuit_breaker,
                    "reasons": result.reasons,
                    "warnings": result.warnings
                }
            })
        except TimeoutError:
            return jsonify({
                "success": False,
                "error": "Analysis timed out - CoinGecko API is slow",
                "hint": "Try again in a few seconds"
            }), 504
            
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/quick-scan', methods=['GET'])
def quick_scan():
    """
    فحص سريع للفرص
    
    Returns:
        Top 10 buying opportunities
    """
    try:
        maestro = CryptoMaestroOrchestrator()
        opportunities = maestro.get_quick_scan()
        
        return jsonify({
            "success": True,
            "count": len(opportunities),
            "data": opportunities,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/top/<int:limit>', methods=['GET'])
def analyze_top(limit: int = 20):
    """
    تحليل أفضل العملات
    
    Args:
        limit: عدد العملات (default: 20, max: 50)
    
    Returns:
        Analysis of top cryptocurrencies
    """
    try:
        limit = min(limit, 50)  # Cap at 50
        
        maestro = CryptoMaestroOrchestrator()
        results = maestro.analyze_top(limit)
        
        data = []
        for r in results:
            data.append({
                "symbol": r.symbol,
                "name": r.name,
                "price": r.current_price,
                "maestro_score": r.maestro_score,
                "signal": r.signal,
                "signal_ar": r.signal_ar,
                "entry": r.entry_price,
                "target": r.target,
                "stop_loss": r.stop_loss,
                "risk_reward": r.risk_reward,
                "position_size_pct": r.position_size_pct
            })
        
        return jsonify({
            "success": True,
            "count": len(data),
            "data": data,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/prices', methods=['GET'])
def get_prices():
    """
    أسعار أفضل العملات
    
    Query params:
        limit: عدد العملات (default: 50)
    
    Returns:
        Current prices of top cryptocurrencies
    """
    try:
        limit = int(request.args.get('limit', 50))
        limit = min(limit, 100)
        
        analyzer = CryptoAnalyzer()
        cryptos = analyzer.fetcher.get_top_cryptos(limit)
        
        data = []
        for c in cryptos:
            data.append({
                "id": c.coin_id,
                "symbol": c.symbol,
                "name": c.name,
                "price": c.current_price,
                "change_24h": c.price_change_percent_24h,
                "market_cap": c.market_cap,
                "market_cap_rank": c.market_cap_rank,
                "volume_24h": c.total_volume,
                "ath": c.ath,
                "atl": c.atl
            })
        
        return jsonify({
            "success": True,
            "count": len(data),
            "data": data
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/bulk-analysis', methods=['GET'])
def bulk_analysis():
    """
    تحليل شامل وسريع لكل العملات
    
    Query params:
        limit: عدد العملات (default: 100, max: 200)
    
    Returns:
        تحليل سريع لكل العملات مع:
        - تصنيف القوة (STRONG/MODERATE/WEAK)
        - نوع الفرصة (SWING/SCALPING/INVESTMENT)
        - إشارة التداول
        - درجة الثقة
    """
    try:
        limit = int(request.args.get('limit', 100))
        limit = min(limit, 200)
        
        analyzer = CryptoAnalyzer()
        cryptos = analyzer.fetcher.get_top_cryptos(limit)
        
        # Get market regime once
        try:
            regime = get_crypto_regime()
            fear_greed = regime.fear_greed_index
            btc_dominance = regime.btc_dominance
            volatility = regime.volatility_regime
        except:
            fear_greed = 50
            btc_dominance = 50.0
            volatility = "MEDIUM"
        
        results = []
        for c in cryptos:
            try:
                # Quick analysis based on price data
                analysis = _quick_analyze_crypto(c, fear_greed, btc_dominance, volatility)
                results.append(analysis)
            except Exception as e:
                # Still include basic data even if analysis fails
                results.append({
                    "id": c.coin_id,
                    "symbol": c.symbol,
                    "name": c.name,
                    "price": c.current_price,
                    "change_24h": c.price_change_percent_24h,
                    "market_cap_rank": c.market_cap_rank,
                    "signal": "HOLD",
                    "signal_ar": "احتفاظ",
                    "strength": "MODERATE",
                    "opportunity_type": "INVESTMENT",
                    "confidence": 50,
                    "score": 50,
                    "reasons": ["Basic data only - analysis unavailable"]
                })
        
        # Sort by score
        results.sort(key=lambda x: x.get('score', 0), reverse=True)
        
        # Categorize
        categories = _categorize_coins(results)
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "market_regime": {
                "fear_greed": fear_greed,
                "btc_dominance": btc_dominance,
                "volatility": volatility
            },
            "summary": {
                "total": len(results),
                "strong_buy": len([r for r in results if r.get('signal') == 'STRONG_BUY']),
                "buy": len([r for r in results if r.get('signal') == 'BUY']),
                "hold": len([r for r in results if r.get('signal') == 'HOLD']),
                "sell": len([r for r in results if r.get('signal') in ['SELL', 'STRONG_SELL']])
            },
            "categories": categories,
            "data": results
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


def _quick_analyze_crypto(crypto, fear_greed: int, btc_dominance: float, volatility: str) -> dict:
    """
    تحليل سريع للعملة بدون OHLCV كامل
    
    تحسينات v2.1:
    - توزيع أفضل للدرجات
    - إشارات بيع وشراء حقيقية
    - مراعاة حالة السوق
    """
    # Base score يعتمد على حالة السوق
    if fear_greed <= 30:  # Fear = فرص
        score = 55  # Lean towards BUY
    elif fear_greed >= 70:  # Greed = حذر
        score = 45  # Lean towards SELL
    else:
        score = 50  # Neutral
    
    reasons = []
    warnings = []
    
    # 1. Price vs ATH/ATL analysis
    ath_distance = crypto.ath_change_percent  # Negative = below ATH
    atl_distance = crypto.atl_change_percent  # Positive = above ATL
    
    # Near ATL (good entry) - قرب من القاع
    if atl_distance < 30:  # Within 30% of ATL
        score += 15
        reasons.append(f"قريب من القاع ({atl_distance:.0f}% فوق ATL)")
    elif atl_distance < 50:
        score += 8
        reasons.append(f"قرب من أدنى سعر")
    
    # Near ATH (risky) - قرب من القمة
    if ath_distance > -10:  # Within 10% of ATH
        score -= 15
        warnings.append("قريب جداً من القمة - خطر التصحيح")
    elif ath_distance > -25:
        score -= 8
        warnings.append("قرب من أعلى سعر")
    
    # 2. 24h Change analysis - أهم عامل
    change_24h = crypto.price_change_percent_24h or 0
    
    if change_24h < -15:  # انهيار = فرصة
        score += 20
        reasons.append(f"انهيار ({change_24h:.1f}%) = فرصة شراء قوية")
    elif change_24h < -10:
        score += 15
        reasons.append(f"انخفاض حاد ({change_24h:.1f}%) = فرصة")
    elif change_24h < -5:
        score += 8
        reasons.append(f"انخفاض ({change_24h:.1f}%)")
    elif change_24h > 20:  # ضخ = خطر
        score -= 20
        warnings.append(f"ضخ كبير ({change_24h:.1f}%) = خطر")
    elif change_24h > 10:
        score -= 12
        warnings.append(f"ارتفاع حاد ({change_24h:.1f}%) = حذر")
    elif change_24h > 5:
        score -= 5
    
    # 3. Volume analysis
    vol_mcap_ratio = (crypto.total_volume / crypto.market_cap) if crypto.market_cap > 0 else 0
    
    if vol_mcap_ratio > 0.3:  # حجم ضخم
        score += 8
        reasons.append("حجم تداول ضخم")
    elif vol_mcap_ratio > 0.15:  # حجم عالي
        score += 4
    elif vol_mcap_ratio < 0.01:  # حجم ضعيف جداً
        score -= 10
        warnings.append("سيولة ضعيفة جداً")
    elif vol_mcap_ratio < 0.03:
        score -= 5
        warnings.append("حجم تداول منخفض")
    
    # 4. Market cap rank
    if crypto.market_cap_rank <= 5:
        score += 5  # Top 5 = آمن
    elif crypto.market_cap_rank <= 20:
        score += 3
    elif crypto.market_cap_rank > 150:
        # Small cap - مخاطرة عالية
        if change_24h > 10:
            score -= 5  # خطر المضاربة
            warnings.append("عملة صغيرة بتضخ - حذر")
        elif change_24h < -10:
            score += 5  # فرصة في العملات الصغيرة
    
    # 5. Market regime adjustments
    if fear_greed <= 20:  # Extreme fear = فرصة ذهبية
        score += 15
        reasons.append("خوف شديد = فرصة ذهبية")
    elif fear_greed <= 30:
        score += 8
        reasons.append("خوف في السوق = فرصة")
    elif fear_greed >= 80:  # Extreme greed = خطر
        score -= 15
        warnings.append("طمع شديد = خطر كبير")
    elif fear_greed >= 70:
        score -= 8
        warnings.append("طمع في السوق")
    
    # 6. BTC Dominance effect
    if btc_dominance > 58:  # BTC Season
        if crypto.coin_id != "bitcoin":
            score -= 5  # Alts تعاني
    elif btc_dominance < 45:  # Alt Season
        if crypto.coin_id != "bitcoin":
            score += 5  # Alts ترتفع
    
    # 7. Determine signal - thresholds معدلة
    if score >= 65:
        signal = "STRONG_BUY"
        signal_ar = "شراء قوي"
    elif score >= 55:
        signal = "BUY"
        signal_ar = "شراء"
    elif score >= 45:
        signal = "HOLD"
        signal_ar = "احتفاظ"
    elif score >= 35:
        signal = "SELL"
        signal_ar = "بيع"
    else:
        signal = "STRONG_SELL"
        signal_ar = "بيع قوي"
    
    # 8. Determine strength
    if score >= 70:
        strength = "STRONG"
    elif score >= 50:
        strength = "MODERATE"
    else:
        strength = "WEAK"
    
    # 9. Determine opportunity type
    if crypto.market_cap_rank <= 20 and score >= 55:
        opp_type = "INVESTMENT"
    elif change_24h < -8 and vol_mcap_ratio > 0.05:
        opp_type = "SWING"
    elif crypto.market_cap_rank > 50 and abs(change_24h) > 5:
        opp_type = "SCALPING"
    else:
        opp_type = "INVESTMENT"
    
    # 10. Calculate confidence
    confidence = min(50 + abs(score - 50) * 1.2, 95)
    
    return {
        "id": crypto.coin_id,
        "symbol": crypto.symbol,
        "name": crypto.name,
        "price": crypto.current_price,
        "change_24h": round(change_24h, 2),
        "market_cap": crypto.market_cap,
        "market_cap_rank": crypto.market_cap_rank,
        "volume_24h": crypto.total_volume,
        "ath": crypto.ath,
        "atl": crypto.atl,
        "ath_distance_pct": round(ath_distance, 2),
        "atl_distance_pct": round(atl_distance, 2),
        "signal": signal,
        "signal_ar": signal_ar,
        "strength": strength,
        "opportunity_type": opp_type,
        "confidence": round(confidence),
        "score": round(score),
        "reasons": reasons[:3],
        "warnings": warnings[:2]
    }


def _categorize_coins(results: list) -> dict:
    """
    تصنيف العملات حسب الفرص - v2.1
    """
    categories = {
        "strong_opportunities": [],  # قوية للشراء
        "scalping_plays": [],  # مكاسب صغيرة سريعة
        "value_picks": [],  # عملات قريبة من ATL
        "momentum_plays": [],  # عملات بحركة صاعدة
        "avoid": [],  # تجنب
        "watchlist": []  # مراقبة
    }
    
    for r in results:
        signal = r.get('signal', 'HOLD')
        score = r.get('score', 50)
        
        # Strong opportunities - شراء قوي أو شراء بدرجة عالية
        if signal in ['STRONG_BUY', 'BUY'] and score >= 55:
            categories["strong_opportunities"].append({
                "symbol": r["symbol"],
                "name": r["name"],
                "price": r["price"],
                "score": score,
                "change_24h": r.get("change_24h", 0),
                "reason": r.get("reasons", [""])[0] if r.get("reasons") else ""
            })
        
        # Scalping plays - عملات بحركة
        elif r.get('opportunity_type') == 'SCALPING':
            categories["scalping_plays"].append({
                "symbol": r["symbol"],
                "name": r["name"],
                "price": r["price"],
                "change_24h": r.get("change_24h", 0),
                "reason": "حركة سريعة متوقعة"
            })
        
        # Value picks (near ATL) - قرب من القاع
        elif r.get('atl_distance_pct', 100) < 60 and signal in ['BUY', 'HOLD']:
            categories["value_picks"].append({
                "symbol": r["symbol"],
                "name": r["name"],
                "price": r["price"],
                "atl_distance": r.get("atl_distance_pct", 0),
                "reason": "قرب من أدنى سعر تاريخي"
            })
        
        # Momentum plays - ارتفاع
        elif r.get('change_24h', 0) > 3 and signal not in ['SELL', 'STRONG_SELL']:
            categories["momentum_plays"].append({
                "symbol": r["symbol"],
                "name": r["name"],
                "price": r["price"],
                "change_24h": r.get("change_24h", 0),
                "reason": f"حركة صاعدة {r.get('change_24h', 0):.1f}%"
            })
        
        # Avoid - بيع
        elif signal in ['SELL', 'STRONG_SELL']:
            categories["avoid"].append({
                "symbol": r["symbol"],
                "name": r["name"],
                "price": r["price"],
                "score": score,
                "reason": r.get("warnings", ["إشارة بيع"])[0] if r.get("warnings") else "إشارة بيع"
            })
        
        # Watchlist - احتفاظ للمراقبة
        elif signal == 'HOLD':
            categories["watchlist"].append({
                "symbol": r["symbol"],
                "name": r["name"],
                "price": r["price"],
                "score": score,
                "reason": "تحت المراقبة"
            })
    
    # Sort each category by score
    for key in categories:
        categories[key] = sorted(categories[key], key=lambda x: x.get('score', 0) if isinstance(x.get('score', 0), (int, float)) else 0, reverse=True)[:10]
    
    return categories


@crypto_bp.route('/categories', methods=['GET'])
def get_categories():
    """
    تصنيف العملات حسب نوع الفرصة
    
    Returns:
        - strong_opportunities: فرص قوية للشراء
        - scalping_plays: مكاسب صغيرة سريعة
        - value_picks: عملات قريبة من ATL
        - momentum_plays: عملات بحركة صاعدة
        - avoid: تجنب
    """
    try:
        # Reuse bulk analysis
        limit = int(request.args.get('limit', 100))
        
        analyzer = CryptoAnalyzer()
        cryptos = analyzer.fetcher.get_top_cryptos(limit)
        
        # Get market regime
        try:
            regime = get_crypto_regime()
            fear_greed = regime.fear_greed_index
            btc_dominance = regime.btc_dominance
            volatility = regime.volatility_regime
        except:
            fear_greed = 50
            btc_dominance = 50.0
            volatility = "MEDIUM"
        
        results = []
        for c in cryptos:
            try:
                analysis = _quick_analyze_crypto(c, fear_greed, btc_dominance, volatility)
                results.append(analysis)
            except:
                pass
        
        categories = _categorize_coins(results)
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "market_regime": {
                "fear_greed": fear_greed,
                "btc_dominance": btc_dominance,
                "volatility": volatility
            },
            "categories": categories
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/portfolio', methods=['GET'])
def get_portfolio():
    """
    محفظة الكريبتو
    
    Returns:
        Mock portfolio data for demo
    """
    return jsonify({
        "success": True,
        "data": {
            "holdings": [],
            "total_value_usd": 0,
            "total_value_egp": 0,
            "change_24h": 0,
            "message": "Portfolio feature coming soon"
        },
        "timestamp": datetime.now().isoformat()
    })


@crypto_bp.route('/watchlist', methods=['GET'])
def get_watchlist():
    """
    قائمة مراقبة الكريبتو
    
    Returns:
        Mock watchlist data for demo
    """
    return jsonify({
        "success": True,
        "data": {
            "items": [],
            "message": "Watchlist feature coming soon"
        },
        "timestamp": datetime.now().isoformat()
    })


# ============================================================================
# CRYPTO DATABASE SYNC ROUTES
# ============================================================================

@crypto_bp.route('/sync', methods=['POST'])
def sync_crypto_db():
    """
    مزامنة بيانات الكريبتو من CoinGecko إلى crypto.db
    
    Request body:
        limit: عدد العملات (default: 50)
    
    Returns:
        نتائج المزامنة
    """
    try:
        from core.crypto_database import sync_crypto_from_coingecko
        
        data = request.get_json() or {}
        limit = data.get('limit', 50)
        
        result = sync_crypto_from_coingecko(limit)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/db/status', methods=['GET'])
def get_crypto_db_status():
    """
    حالة قاعدة بيانات crypto.db
    
    Returns:
        إحصائيات قاعدة البيانات وحالة المزامنة
    """
    try:
        from core.crypto_database import crypto_db
        
        stats = crypto_db.get_stats()
        sync_status = crypto_db.get_sync_status()
        
        return jsonify({
            "success": True,
            "stats": stats,
            "sync_status": sync_status
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/db/list', methods=['GET'])
def get_crypto_db_list():
    """
    قائمة العملات من crypto.db
    
    Query params:
        limit: عدد العملات (default: 50)
        active_only: العملات النشطة فقط (default: true)
    
    Returns:
        قائمة العملات
    """
    try:
        from core.crypto_database import crypto_db
        
        limit = int(request.args.get('limit', 50))
        active_only = request.args.get('active_only', 'true').lower() == 'true'
        
        cryptos = crypto_db.get_all_cryptos(active_only, limit)
        
        return jsonify({
            "success": True,
            "count": len(cryptos),
            "cryptos": cryptos
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/db/<symbol>', methods=['GET'])
def get_crypto_from_db(symbol):
    """
    تفاصيل عملة من crypto.db
    
    Args:
        symbol: رمز العملة (BTC, ETH, etc.)
    
    Returns:
        بيانات العملة
    """
    try:
        from core.crypto_database import crypto_db
        
        crypto = crypto_db.get_crypto(symbol)
        if crypto:
            return jsonify({
                "success": True,
                "crypto": crypto
            })
        return jsonify({
            "success": False,
            "error": f"Crypto {symbol} not found"
        }), 404
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/db/btc-local', methods=['GET'])
def get_btc_local_prices():
    """
    أسعار BTC بالعملات العربية (EGP, SAR, KWD, QAR, AED, BHD, OMR, JOD)
    
    Returns:
        أسعار BTC بالعملات المحلية
    """
    try:
        from core.crypto_database import crypto_db
        
        prices = crypto_db.get_btc_local_prices()
        
        return jsonify({
            "success": True,
            "prices": prices
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/db/recommendations', methods=['GET'])
def get_crypto_db_recommendations():
    """
    توقعات الكريبتو من Telegram
    
    Query params:
        symbol: فلترة برمز العملة
        limit: عدد التوقعات (default: 50)
    
    Returns:
        قائمة التوقعات
    """
    try:
        from core.crypto_database import crypto_db
        
        symbol = request.args.get('symbol')
        limit = int(request.args.get('limit', 50))
        
        recommendations = crypto_db.get_recommendations(symbol, limit)
        
        return jsonify({
            "success": True,
            "count": len(recommendations),
            "recommendations": recommendations
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/db/news', methods=['GET'])
def get_crypto_db_news():
    """
    أخبار الكريبتو من Telegram
    
    Query params:
        limit: عدد الأخبار (default: 50)
    
    Returns:
        قائمة الأخبار
    """
    try:
        from core.crypto_database import crypto_db
        
        limit = int(request.args.get('limit', 50))
        news = crypto_db.get_news(limit)
        
        return jsonify({
            "success": True,
            "count": len(news),
            "news": news
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ============================================================================
# REGISTER FUNCTION
# ============================================================================

def register_crypto_routes(app):
    """Register crypto routes with Flask app"""
    app.register_blueprint(crypto_bp)
    print("[Crypto Routes] Registered at /api/crypto/*")


# ============================================================================
# PREDICTION ENGINE ROUTES
# ============================================================================

@crypto_bp.route('/predict/<symbol>', methods=['GET'])
def predict_crypto(symbol):
    """
    تحليل وتوقع عملة رقمية
    
    Args:
        symbol: رمز العملة (BTC, ETH, etc.)
    
    Returns:
        تحليل فني كامل + توقعات الأسعار
    """
    try:
        from analyzers.crypto_prediction_engine import prediction_engine
        
        result = prediction_engine.analyze_crypto(symbol.upper())
        
        if not result:
            return jsonify({
                "success": False,
                "error": f"Currency {symbol} not found in database"
            }), 404
        
        return jsonify({
            "success": True,
            "data": {
                "symbol": result.symbol,
                "current_price": result.current_price,
                "predictions": {
                    "1d": {
                        "price": result.predicted_price_1d,
                        "change_percent": result.predicted_change_1d
                    },
                    "7d": {
                        "price": result.predicted_price_7d,
                        "change_percent": result.predicted_change_7d
                    }
                },
                "confidence": result.confidence,
                "signal": result.signal,
                "trend": result.trend,
                "risk_level": result.risk_level,
                "indicators": result.indicators,
                "levels": {
                    "support": result.support_levels,
                    "resistance": result.resistance_levels
                },
                "market": {
                    "fear_greed_index": result.fear_greed_index,
                    "sentiment": result.market_sentiment
                },
                "timestamp": result.timestamp
            }
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/predict/all', methods=['GET'])
def predict_all_crypto():
    """
    تحليل وتوقع كل العملات
    
    Query params:
        limit: عدد العملات (default: 20)
    
    Returns:
        قائمة بتحليلات وتوقعات كل العملات
    """
    try:
        from analyzers.crypto_prediction_engine import prediction_engine
        
        limit = int(request.args.get('limit', 20))
        
        results = prediction_engine.analyze_all()
        
        # ترتيب حسب الإشارة والثقة
        def score_item(r):
            signal_scores = {
                'strong_buy': 100,
                'buy': 70,
                'neutral': 50,
                'sell': 30,
                'strong_sell': 0
            }
            return signal_scores.get(r.signal, 50) * (r.confidence / 100)
        
        sorted_results = sorted(results, key=score_item, reverse=True)[:limit]
        
        return jsonify({
            "success": True,
            "count": len(sorted_results),
            "total_analyzed": len(results),
            "predictions": [{
                "symbol": r.symbol,
                "current_price": r.current_price,
                "predicted_change_1d": r.predicted_change_1d,
                "predicted_change_7d": r.predicted_change_7d,
                "confidence": r.confidence,
                "signal": r.signal,
                "trend": r.trend,
                "risk_level": r.risk_level,
                "fear_greed_index": r.fear_greed_index
            } for r in sorted_results]
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/signals/top', methods=['GET'])
def get_top_signals():
    """
    أفضل إشارات التداول
    
    Query params:
        type: نوع الإشارة (buy, sell, all) default: buy
        limit: عدد النتائج default: 10
    
    Returns:
        أفضل فرص التداول
    """
    try:
        from analyzers.crypto_prediction_engine import prediction_engine
        
        signal_type = request.args.get('type', 'buy')
        limit = int(request.args.get('limit', 10))
        
        results = prediction_engine.analyze_all()
        
        # فلترة حسب النوع
        if signal_type == 'buy':
            filtered = [r for r in results if r.signal in ['strong_buy', 'buy']]
        elif signal_type == 'sell':
            filtered = [r for r in results if r.signal in ['strong_sell', 'sell']]
        else:
            filtered = results
        
        # ترتيب
        def score_item(r):
            signal_scores = {
                'strong_buy': 100,
                'buy': 70,
                'neutral': 50,
                'sell': 30,
                'strong_sell': 0
            }
            base = signal_scores.get(r.signal, 50)
            return base * (r.confidence / 100)
        
        sorted_results = sorted(filtered, key=score_item, reverse=True)[:limit]
        
        return jsonify({
            "success": True,
            "type": signal_type,
            "count": len(sorted_results),
            "signals": [{
                "symbol": r.symbol,
                "current_price": r.current_price,
                "predicted_price_1d": r.predicted_price_1d,
                "predicted_change_1d": r.predicted_change_1d,
                "confidence": r.confidence,
                "signal": r.signal,
                "trend": r.trend,
                "indicators": {
                    "rsi": r.indicators.get('rsi', 0),
                    "macd_trend": r.indicators.get('macd_trend', 'neutral'),
                    "bb_position": r.indicators.get('bb_position', 0.5)
                },
                "support": r.support_levels[0] if r.support_levels else None,
                "resistance": r.resistance_levels[0] if r.resistance_levels else None
            } for r in sorted_results]
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@crypto_bp.route('/fear-greed', methods=['GET'])
def get_fear_greed():
    """
    مؤشر الخوف والطمع
    
    Returns:
        قيمة المؤشر وتصنيفه
    """
    try:
        from analyzers.crypto_prediction_engine import SentimentAnalyzer
        
        value, classification = SentimentAnalyzer.get_fear_greed_index()
        
        # تفسير القيمة
        if value <= 25:
            interpretation = "extreme_fear"
            recommendation = "فرصة شراء محتملة - الخوف الشديد في السوق"
        elif value <= 45:
            interpretation = "fear"
            recommendation = "حذر - السوق متشائم"
        elif value <= 55:
            interpretation = "neutral"
            recommendation = "حيادية - انتظار اتجاه أوضح"
        elif value <= 75:
            interpretation = "greed"
            recommendation = "تفاؤل - توخي الحذر من التصحيح"
        else:
            interpretation = "extreme_greed"
            recommendation = "تحذير - السوق مبالغ في التفاؤل"
        
        return jsonify({
            "success": True,
            "data": {
                "value": value,
                "classification": classification,
                "interpretation": interpretation,
                "recommendation": recommendation,
                "timestamp": datetime.now().isoformat()
            }
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ============================================================================
# PREDICTIONS SAVE ENDPOINT
# ============================================================================

@crypto_bp.route('/predictions/save', methods=['POST'])
def save_crypto_predictions():
    """
    حفظ توقعات الكريبتو في قاعدة البيانات
    
    Body:
    - predictions: قائمة التوقعات
    - config: إعدادات التوليد
    
    Returns:
    - success: نجاح العملية
    - saved_count: عدد التوقعات المحفوظة
    """
    try:
        data = request.get_json() or {}
        predictions = data.get('predictions', [])
        config = data.get('config', {})
        
        if not predictions:
            return jsonify({
                'success': False,
                'error': 'لا توجد توقعات للحفظ'
            }), 400
        
        # Database path
        from pathlib import Path
        BASE_DIR = Path(__file__).parent.parent.parent.resolve()
        PREDICTIONS_DB = str(BASE_DIR / 'db' / 'predictions.db')
        
        import sqlite3
        import uuid
        import json
        
        conn = sqlite3.connect(PREDICTIONS_DB)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Ensure table exists
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS crypto_predictions (
                id TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                name TEXT,
                price REAL,
                signal TEXT,
                signal_ar TEXT,
                maestro_score REAL,
                confidence REAL,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                risk_reward REAL,
                position_size_pct REAL,
                market_regime TEXT,
                fear_greed INTEGER,
                btc_dominance REAL,
                reasons TEXT,
                warnings TEXT,
                status TEXT DEFAULT 'PENDING',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT
            )
        ''')
        
        saved_count = 0
        errors = []
        
        for pred in predictions:
            try:
                pred_id = str(uuid.uuid4())
                
                cursor.execute('''
                    INSERT INTO crypto_predictions 
                    (id, symbol, name, price, signal, signal_ar, maestro_score, confidence,
                     entry_price, target_price, stop_loss, risk_reward, position_size_pct,
                     market_regime, fear_greed, btc_dominance, reasons, warnings)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    pred_id,
                    pred.get('symbol', ''),
                    pred.get('name', ''),
                    pred.get('price', 0),
                    pred.get('signal', 'HOLD'),
                    pred.get('signal_ar', 'احتفاظ'),
                    pred.get('maestro_score', 50),
                    pred.get('confidence', 50),
                    pred.get('entry_price', 0),
                    pred.get('target_price', 0),
                    pred.get('stop_loss', 0),
                    pred.get('risk_reward', 0),
                    pred.get('position_size_pct', 0),
                    pred.get('market_regime', 'NEUTRAL'),
                    pred.get('fear_greed', 50),
                    pred.get('btc_dominance', 50),
                    json.dumps(pred.get('reasons', [])),
                    json.dumps(pred.get('warnings', []))
                ))
                saved_count += 1
            except Exception as e:
                errors.append(f"{pred.get('symbol', 'unknown')}: {str(e)}")
        
        conn.commit()
        conn.close()
        
        print(f"[Crypto] Saved {saved_count} predictions")
        
        return jsonify({
            'success': True,
            'message': f'تم حفظ {saved_count} توقع بنجاح',
            'saved_count': saved_count,
            'errors': errors[:5]
        })
        
    except Exception as e:
        print(f"[Crypto] Error saving predictions: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@crypto_bp.route('/predictions/list', methods=['GET'])
def list_crypto_predictions():
    """
    قائمة توقعات الكريبتو
    
    Query params:
    - limit: عدد النتائج (default: 50)
    - status: فلتر حسب الحالة (optional)
    """
    try:
        limit = int(request.args.get('limit', 50))
        status = request.args.get('status')
        
        from pathlib import Path
        BASE_DIR = Path(__file__).parent.parent.parent.resolve()
        PREDICTIONS_DB = str(BASE_DIR / 'db' / 'predictions.db')
        
        import sqlite3
        
        conn = sqlite3.connect(PREDICTIONS_DB)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Check if table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='crypto_predictions'")
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'success': True,
                'predictions': [],
                'count': 0
            })
        
        where = "WHERE status = ?" if status else ""
        params = [status] if status else []
        
        cursor.execute(f'''
            SELECT * FROM crypto_predictions 
            {where}
            ORDER BY created_at DESC 
            LIMIT ?
        ''', tuple(params + [limit]))
        
        predictions = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({
            'success': True,
            'predictions': predictions,
            'count': len(predictions)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================================
# MAIN (for testing)
# ============================================================================

if __name__ == "__main__":
    from flask import Flask
    app = Flask(__name__)
    register_crypto_routes(app)
    
    print("\n" + "="*60)
    print("CRYPTO API TEST")
    print("="*60)
    
    with app.test_client() as client:
        # Test status
        print("\n1. Testing /api/crypto/status...")
        response = client.get('/api/crypto/status')
        print(f"   Status: {response.status_code}")
        
        # Test regime
        print("\n2. Testing /api/crypto/regime...")
        response = client.get('/api/crypto/regime')
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.get_json()
            if data.get('success'):
                print(f"   Regime: {data['data']['regime']}")
                print(f"   Fear & Greed: {data['data']['fear_greed_index']}")
        
        # Test bitcoin
        print("\n3. Testing /api/crypto/maestro/bitcoin...")
        response = client.get('/api/crypto/maestro/bitcoin')
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.get_json()
            if data.get('success'):
                print(f"   Signal: {data['data']['signal']}")
                print(f"   Score: {data['data']['maestro_score']}")
