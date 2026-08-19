// ============================================================================
// مساعد الاستثمار Flutter - API Client
// Centralized API communication with caching, error handling, and fallbacks
// ============================================================================

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'local_database.dart';
import '../models/types.dart';
import 'cache_manager.dart';
import '../services/subscription_service.dart';

class GLMApiClient {
  GLMApiClient._privateConstructor() {
    _initDio();
  }
  static final GLMApiClient _instance = GLMApiClient._privateConstructor();
  static GLMApiClient get instance => _instance;

  late final Dio _dio;
  String _baseUrl = 'https://invist.m2y.net';
  String? _authToken;

  late final Dio _aiDio; // Separate Dio instance for AI/long requests
  late final Dio _chartDio; // Separate Dio instance for chart data

  void _initDio() {
    // Default Dio - standard requests
    _dio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
    ));
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (_authToken != null) {
          options.headers['Authorization'] = 'Bearer $_authToken';
        }
        return handler.next(options);
      },
      onError: (error, handler) {
        debugPrint(
            '[API Error] ${error.response?.statusCode} - ${error.message}');
        return handler.next(error);
      },
    ));

    // AI Dio - for long-running AI requests (120s timeout)
    _aiDio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 120),
    ));
    _aiDio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (_authToken != null) {
          options.headers['Authorization'] = 'Bearer $_authToken';
        }
        return handler.next(options);
      },
      onError: (error, handler) {
        debugPrint(
            '[API AI Error] ${error.response?.statusCode} - ${error.message}');
        return handler.next(error);
      },
    ));

    // Chart Dio - for chart data
    _chartDio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
    ));
    _chartDio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (_authToken != null) {
          options.headers['Authorization'] = 'Bearer $_authToken';
        }
        return handler.next(options);
      },
      onError: (error, handler) {
        debugPrint(
            '[API Chart Error] ${error.response?.statusCode} - ${error.message}');
        return handler.next(error);
      },
    ));
  }

  Dio get aiDio => _aiDio;
  Dio get chartDio => _chartDio;

  void setAuthToken(String? token) {
    _authToken = token;
  }

  Dio get dio => _dio;

  Future<bool> isAuthenticated() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('auth_token');
    return token != null && token.isNotEmpty;
  }

  // ============================================================================
  // Auth API
  // ============================================================================
  Future<AuthResponse> googleLogin(String idToken) async {
    try {
      debugPrint('[API Auth] Sending Google login request...');
      final response = await _dio.post('/api/auth/google', data: {
        'id_token': idToken,
      });
      final result = AuthResponse.fromJson(response.data);
      if (result.success && result.token != null) {
        await _saveAuthToken(result.token!);
        if (result.user != null) {
          await _saveUserData(result.user!);
        }
      }
      return result;
    } catch (e) {
      debugPrint('[API Auth] Google login failed: $e');
      return AuthResponse(
        success: false,
        message: 'فشل تسجيل الدخول عبر Google: ${e.toString()}',
      );
    }
  }

  Future<Map<String, dynamic>> updateProfile({String? phone}) async {
    try {
      final response = await _dio.put('/api/auth/profile', data: {
        if (phone != null) 'phone': phone,
      });
      final user = await getUser();
      if (user != null) {
        final updatedUser = User(
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          image: user.image,
          isAdmin: user.isAdmin,
          subscriptionTier: user.subscriptionTier,
          defaultRiskTolerance: user.defaultRiskTolerance,
          phone: phone ?? user.phone,
          isActive: user.isActive,
          emailVerified: user.emailVerified,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
        );
        await _saveUserData(updatedUser);
      }
      return response.data;
    } catch (e) {
      debugPrint('[API] updateProfile failed: $e');
      final user = await getUser();
      if (user != null) {
        final updatedUser = User(
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          image: user.image,
          isAdmin: user.isAdmin,
          subscriptionTier: user.subscriptionTier,
          defaultRiskTolerance: user.defaultRiskTolerance,
          phone: phone ?? user.phone,
          isActive: user.isActive,
          emailVerified: user.emailVerified,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
        );
        await _saveUserData(updatedUser);
        return {'success': true, 'message': 'تم تحديث الهاتف محلياً'};
      }
      return {'success': false, 'error': e.toString()};
    }
  }

  Future<void> _saveAuthToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('auth_token', token);
    _authToken = token;
  }

  Future<void> _saveUserData(User user) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user_data', jsonEncode(user.toJson()));
  }

  Future<User?> getUser() async {
    final prefs = await SharedPreferences.getInstance();
    final userJson = prefs.getString('user_data');
    if (userJson != null) {
      return User.fromJson(jsonDecode(userJson));
    }
    return null;
  }

  Future<void> clearAuth() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
    await prefs.remove('user_data');
    _authToken = null;
  }

  // ============================================================================
  // Market API
  // ============================================================================
  Future<MarketOverview> getMarketOverview([String? market]) async {
    final String cacheKey =
        market != null ? 'market_overview_$market' : 'market_overview';
    return ApiCacheManager.instance.fetch<MarketOverview>(
      key: cacheKey,
      fetcher: () async {
        try {
          debugPrint('[API] Fetching market overview for $market...');
          final response =
              await _dio.get('/api/market/overview', queryParameters: {
            if (market != null) 'market': market,
          });
          debugPrint('[API] Market overview response: ${response.data.keys}');
          return MarketOverview.fromJson(response.data);
        } catch (e) {
          debugPrint('[API] getMarketOverview failed: $e');
          // Return empty fallback to prevent stuck UI
          return MarketOverview(
            indices: [],
            marketStatus: MarketStatus(isOpen: null),
            topGainers: [],
            topLosers: [],
          );
        }
      },
      ttl: ApiCacheManager.marketTtl,
    );
  }

  Future<Map<String, dynamic>> getMarketLiveData([String? market]) async {
    final String cacheKey =
        market != null ? 'market_live_data_$market' : 'market_live_data';
    return ApiCacheManager.instance.fetch<Map<String, dynamic>>(
      key: cacheKey,
      fetcher: () async {
        try {
          final response =
              await _dio.get('/api/market/live-data', queryParameters: {
            if (market != null) 'market': market,
          });
          return response.data;
        } catch (e) {
          debugPrint('[API] getMarketLiveData failed: $e');
          return {};
        }
      },
      ttl: ApiCacheManager.marketTtl,
    );
  }

  Future<Map<String, dynamic>> getMarketInvesting([String? market]) async {
    final String cacheKey =
        market != null ? 'market_investing_$market' : 'market_investing';
    return ApiCacheManager.instance.fetch<Map<String, dynamic>>(
      key: cacheKey,
      fetcher: () async {
        try {
          final response =
              await _dio.get('/api/market/investing', queryParameters: {
            if (market != null) 'market': market,
          });
          return response.data;
        } catch (e) {
          debugPrint('[API] getMarketInvesting failed: $e');
          return {};
        }
      },
      ttl: ApiCacheManager.marketTtl,
    );
  }

  Future<Map<String, dynamic>> getMarketAiInsights() async {
    try {
      final response =
          await _dio.get('/api/market/recommendations/ai-insights');
      return response.data;
    } catch (e) {
      debugPrint('[API] getMarketAiInsights failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Stock API
  // ============================================================================
  Future<Map<String, dynamic>> getStocks(
      {String search = '', String? market}) async {
    return ApiCacheManager.instance.fetch<Map<String, dynamic>>(
      key: 'stocks_${market ?? 'all'}_${search.hashCode}',
      fetcher: () async {
        final queryParams = <String, dynamic>{};
        if (search.isNotEmpty) queryParams['query'] = search;
        if (market != null) queryParams['market'] = market;
        try {
          debugPrint(
              '[API] Fetching stocks with query: $search, market: $market');
          final response =
              await _dio.get('/api/stocks', queryParameters: queryParams);
          debugPrint(
              '[API] Stocks response: ${(response.data['stocks'] as List?)?.length ?? 0} stocks');
          return response.data;
        } catch (e) {
          debugPrint('[API] getStocks failed: $e');
          try {
            final localStocks =
                await LocalDatabase.instance.queryStocks(search: search);
            return {'stocks': localStocks};
          } catch (localError) {
            debugPrint('[API] Local stocks fallback failed: $localError');
            return {'stocks': []};
          }
        }
      },
      ttl: ApiCacheManager
          .marketTtl, // Stock data doesn't change extremely frequently
    );
  }

  Future<Map<String, dynamic>> getStockMovementClassification(
      {String? market}) async {
    try {
      final data = await _dio
          .get('/api/stocks/movement-classification', queryParameters: {
        if (market != null) 'market': market,
      });
      return data.data;
    } catch (e) {
      debugPrint(
          '[API] Movement classification error (may be unavailable): $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getStockFundamentals(
      {required String ticker}) async {
    try {
      // FIX: /api/stocks/fundamentals returns empty data, use /api/stocks/[ticker] instead
      final response = await _dio.get('/api/stocks/$ticker');
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] getStockFundamentals failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Crypto API
  // ============================================================================
  Future<Map<String, dynamic>> getCrypto() async {
    return ApiCacheManager.instance.fetch<Map<String, dynamic>>(
      key: 'crypto_data',
      fetcher: () async {
        try {
          debugPrint('[API] Fetching crypto data...');
          final response = await _dio.get('/api/crypto');
          debugPrint('[API] Crypto response keys: ${response.data.keys}');
          return response.data;
        } catch (e) {
          debugPrint('[API] getCrypto failed: $e');
          return {'coins': [], 'data': []};
        }
      },
      ttl: ApiCacheManager.marketTtl,
    );
  }

  // ============================================================================
  // MOBILE Portfolio API (CORRECT endpoints for mobile)
  // ============================================================================
  Future<PortfolioResponse> getPortfolio() async {
    // Fallback to mobile endpoint with old method name for compatibility
    return getMobilePortfolio();
  }

  Future<PortfolioResponse> getMobilePortfolio() async {
    return ApiCacheManager.instance.fetch<PortfolioResponse>(
      key: 'portfolio_data',
      fetcher: () async {
        final response = await _dio.get('/api/mobile/portfolio');
        debugPrint(
            '[API Mobile Portfolio] Response items: ${(response.data["items"] as List?)?.length ?? 0}');
        return PortfolioResponse.fromJson(response.data);
      },
      ttl: const Duration(minutes: 2),
    );
  }

  Future<Map<String, dynamic>> analyzePortfolio() async {
    try {
      final result = await _dio.get('/api/mobile/portfolio/analyze');
      return result.data;
    } catch (e) {
      debugPrint('[Portfolio] Analysis error: $e');
      return {};
    }
  }

  // ============================================================================
  // MOBILE Portfolio CRUD (CORRECT endpoints)
  // ============================================================================
  Future<Map<String, dynamic>> addToPortfolio(Map<String, dynamic> data) async {
    return addToMobilePortfolio(data);
  }

  Future<Map<String, dynamic>> addToMobilePortfolio(
      Map<String, dynamic> data) async {
    try {
      final response = await _dio.post('/api/mobile/portfolio', data: data);
      return response.data;
    } catch (e) {
      debugPrint('[API] addToMobilePortfolio failed: $e');
      rethrow;
    }
  }

  Future<Map<String, dynamic>> removeFromPortfolio(String id) async {
    return removeMobilePortfolio(id);
  }

  Future<Map<String, dynamic>> removeMobilePortfolio(String id) async {
    try {
      final response = await _dio
          .delete('/api/mobile/portfolio', queryParameters: {'id': id});
      return response.data;
    } catch (e) {
      debugPrint('[API] removeMobilePortfolio failed: $e');
      rethrow;
    }
  }

  Future<Map<String, dynamic>> getPortfolioIntelligence() async {
    try {
      final response = await _dio.get('/api/mobile/portfolio/intelligence');
      return response.data;
    } catch (e) {
      debugPrint('[API] getPortfolioIntelligence failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Watchlist API
  // ============================================================================
  Future<WatchlistResponse> getWatchlist() async {
    return ApiCacheManager.instance.fetch<WatchlistResponse>(
      key: 'watchlist_data',
      fetcher: () async {
        try {
          debugPrint('[API Watchlist] Fetching...');
          final response = await _dio.get('/api/watchlist');
          final data = response.data is Map<String, dynamic>
              ? response.data
              : Map<String, dynamic>.from(response.data as Map);
          debugPrint(
              '[API Watchlist] Response keys: ${data.keys.toList()}');
          final result = WatchlistResponse.fromJson(data);
          debugPrint('[API Watchlist] Parsed items: ${result.items.length}');
          return result;
        } catch (e) {
          debugPrint('[API] getWatchlist failed: $e');
          return WatchlistResponse(success: false, items: [], total: 0);
        }
      },
      ttl: const Duration(minutes: 2),
    );
  }

  Future<WatchlistResponse> getWatchlistEnhanced() async {
    return ApiCacheManager.instance.fetch<WatchlistResponse>(
      key: 'watchlist_enhanced',
      fetcher: () async {
        try {
          debugPrint('[API Watchlist] Fetching enhanced...');
          final response = await _dio.get('/api/watchlist-enhanced');
          final data = response.data is Map<String, dynamic>
              ? response.data
              : Map<String, dynamic>.from(response.data as Map);
          debugPrint(
              '[API Watchlist] Enhanced response keys: ${data.keys.toList()}');
          final result = WatchlistResponse.fromJson(data);
          debugPrint(
              '[API Watchlist] Enhanced parsed items: ${result.items.length}');
          return result;
        } catch (e) {
          debugPrint('[API] getWatchlistEnhanced failed: $e');
          return WatchlistResponse(success: false, items: [], total: 0);
        }
      },
      ttl: const Duration(minutes: 2),
    );
  }

  Future<Map<String, dynamic>> addToWatchlist(Map<String, dynamic> data) async {
    try {
      final response = await _dio.post('/api/watchlist', data: data);
      return response.data;
    } catch (e) {
      debugPrint('[API] addToWatchlist failed: $e');
      rethrow;
    }
  }

  Future<Map<String, dynamic>> removeFromWatchlist(String id) async {
    try {
      final response = await _dio.delete('/api/watchlist/$id');
      return response.data;
    } catch (e) {
      debugPrint('[API] removeFromWatchlist failed: $e');
      rethrow;
    }
  }

  // ============================================================================
  // Metals API (Gold/Silver)
  // ============================================================================
  Future<List<dynamic>> getGoldPrices() async {
    try {
      // FIX: /api/metals → 404, use /api/market/gold instead
      final response = await _dio.get('/api/market/gold');
      final data = response.data;
      if (data is Map<String, dynamic>) {
        final goldPrices = data['gold_prices'];
        if (goldPrices is Map) {
          return [goldPrices];
        }
        return [data];
      }
      return data is List ? data : [];
    } catch (e) {
      debugPrint('[API] getGoldPrices failed: $e');
      return [];
    }
  }

  // ============================================================================
  // Currency API
  // ============================================================================
  Future<List<dynamic>> getCurrencyList() async {
    try {
      final response = await _dio.get('/api/currency/list');
      return response.data;
    } catch (e) {
      debugPrint('[API] getCurrencyList failed: $e');
      return [];
    }
  }

  // ============================================================================
  // Zakat API
  // ============================================================================
  Future<Map<String, dynamic>> calculateZakat(Map<String, dynamic> data) async {
    try {
      final response = await _dio.post('/api/zakat/calculate', data: data);
      return response.data;
    } catch (e) {
      debugPrint('[API] calculateZakat failed: $e');
      return {};
    }
  }

  // ============================================================================
  // MOBILE Recommendations API (CORRECT endpoints)
  // ============================================================================
  Future<List<dynamic>> getRecommendations() async {
    return getMobileRecommendations();
  }

  Future<List<dynamic>> getMobileRecommendations(
      {String? persona, String? market}) async {
    try {
      // FIX: Use getTopPredictions for 3-7 highest confidence predictions
      final preds = await getTopPredictions(count: 7, market: market);
      if (preds.isNotEmpty) {
        // Filter by persona if specified
        if (persona != null) {
          final filtered = preds.where((p) {
            final signal = p is Map ? (p['signal_type'] ?? p['signal'] ?? '') : '';
            return signal.toString().toLowerCase().contains(persona.toLowerCase());
          }).toList();
          if (filtered.isNotEmpty) return filtered;
        }
        return preds;
      }
      // Fallback to old endpoint
      final queryParams = <String, dynamic>{};
      if (persona != null) queryParams['persona'] = persona;
      if (market != null) queryParams['market'] = market;
      final response = await _dio.get('/api/mobile/recommendations',
          queryParameters: queryParams);
      if (response.data is List) return response.data;
      final data = response.data is Map<String, dynamic>
          ? response.data
          : Map<String, dynamic>.from(response.data as Map);
      final list = data['recommendations'] ??
          data['data'] ??
          data['results'] ??
          data['stocks'] ??
          [];
      return list is List ? list : [];
    } catch (e) {
      debugPrint('[API] getMobileRecommendations failed: $e');
      return [];
    }
  }

  // Market-specific recommendations (supports market in path).
  // Falls back to all-markets endpoint if the market route 404s.
  Future<List<dynamic>> getMarketRecommendations(
      {required String market, String? persona, int limit = 10}) async {
    try {
      // FIX: /api/mobile/stocks/EGX/recommendation returns top_buy_signals: 0
      // Use /api/v2/recommend which has real recommendations
      final queryParams = <String, dynamic>{'limit': limit};
      if (market != 'ALL') queryParams['market'] = market;
      final response = await _dio.get('/api/v2/recommend', queryParameters: queryParams);
      if (response.data is List) return response.data;
      final data = response.data is Map<String, dynamic>
          ? response.data
          : Map<String, dynamic>.from(response.data as Map);
      final list = data['recommendations'] ??
          data['data'] ??
          data['results'] ??
          data['stocks'] ??
          data['top_buy_signals'] ??
          [];
      return list is List ? list : [];
    } catch (e) {
      debugPrint('[API] getMarketRecommendations($market) failed: $e');
      // Fallback to predictions
      return getMobilePredictions(limit: limit);
    }
  }

  Future<Map<String, dynamic>> getMorningReports() async {
    try {
      final response = await _dio.get('/api/reports/morning');
      return response.data;
    } catch (e) {
      debugPrint('[API] getMorningReports failed: $e');
      return {};
    }
  }

  // ============================================================================
  // AI Analysis API
  // ============================================================================
  Future<Map<String, dynamic>> getLiveAnalysis() async {
    try {
      final response = await _dio.get('/api/v2/live-analysis');
      return response.data;
    } catch (e) {
      debugPrint('[API] getLiveAnalysis failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Subscription API
  // ============================================================================
  Future<Map<String, dynamic>> getCurrentSubscription() async {
    return getSubscriptionCurrent();
  }

  Future<Map<String, dynamic>> getSubscriptionCurrent() async {
    try {
      final response = await _dio.get('/api/subscription/current');
      return response.data;
    } catch (e) {
      debugPrint('[API] getSubscriptionCurrent failed: $e');
      return {};
    }
  }

  Future<List<dynamic>> getSubscriptionPlansV2() async {
    try {
      final response = await _dio.get('/api/subscription/plans');
      return response.data is List
          ? response.data
          : (response.data['plans'] ?? []);
    } catch (e) {
      debugPrint('[API] getSubscriptionPlansV2 failed: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> upgradeSubscription(String planId) async {
    try {
      final response = await _dio.post('/api/subscription/upgrade', data: {
        'plan_id': planId,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] upgradeSubscription failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> subscribeToPlan(String planId) async {
    try {
      final response = await _dio.post('/api/subscription/subscribe', data: {
        'plan_id': planId,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] subscribeToPlan failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> startTrial() async {
    try {
      final response = await _dio.post('/api/subscription/trial');
      return response.data;
    } catch (e) {
      debugPrint('[API] startTrial failed: $e');
      return {};
    }
  }

  Future<FeatureAccessResult> checkSubscriptionAccess(String feature) async {
    try {
      final response = await _dio.post('/api/subscription/check-access', data: {
        'feature': feature,
      });
      return FeatureAccessResult.fromJson(response.data);
    } catch (e) {
      debugPrint('[API] checkSubscriptionAccess failed: $e');
      return FeatureAccessResult(
        feature: feature,
        hasAccess: false,
        reason: 'Failed to check access',
        reasonEn: 'Failed to check access',
        tier: 'free',
      );
    }
  }

  // ============================================================================
  // Local Database API (for fallback)
  // ============================================================================
  Future<List<Map<String, dynamic>>> getLocalStocks(
      {String search = ''}) async {
    return await LocalDatabase.instance.queryStocks(search: search);
  }

  Future<Map<String, dynamic>?> getLocalStockDetail(String ticker) async {
    return await LocalDatabase.instance.getStockDetail(ticker);
  }

  Future<List<Map<String, dynamic>>> getLocalStockHistory(String ticker,
      {int days = 30}) async {
    return await LocalDatabase.instance.getStockHistory(ticker, days: days);
  }

  // ============================================================================
  // Stock History Screen Methods
  // ============================================================================
  Future<StockHistoryResponse> getStockHistory(String ticker,
      {int days = 30}) async {
    try {
      final response = await _dio
          .get('/api/stocks/$ticker/history', queryParameters: {'days': days});
      return StockHistoryResponse.fromJson(response.data);
    } catch (e) {
      debugPrint('[API] getStockHistory failed: $e');
      return StockHistoryResponse(data: [], summary: null);
    }
  }

  Future<Map<String, dynamic>> getStockDetail(String ticker,
      {bool flat = false}) async {
    try {
      final response = await _dio
          .get('/api/stocks/$ticker', queryParameters: {'flat': flat});
      return response.data;
    } catch (e) {
      debugPrint('[API] getStockDetail failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getStockRecommendation(String ticker) async {
    try {
      final response = await _dio.get('/api/stocks/$ticker/recommendation');
      return response.data;
    } catch (e) {
      debugPrint('[API] getStockRecommendation failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getStockProfessionalAnalysis(
      String ticker) async {
    try {
      final response =
          await _dio.get('/api/stocks/$ticker/professional-analysis');
      return response.data;
    } catch (e) {
      debugPrint('[API] getStockProfessionalAnalysis failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getStockNews(String ticker) async {
    try {
      final response = await _dio.get('/api/stocks/$ticker/news');
      return response.data;
    } catch (e) {
      debugPrint('[API] getStockNews failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Currency Screen Methods
  // ============================================================================
  Future<dynamic> getCurrency() async {
    try {
      final response = await _dio.get('/api/currency');
      return response.data;
    } catch (e) {
      debugPrint('[API] getCurrency failed: $e');
      try {
        final response = await _dio.get('/api/currency/list');
        final data = response.data;
        if (data is List) {
          return {'currencies': data};
        }
        return data;
      } catch (e2) {
        debugPrint('[API] getCurrencyList fallback failed: $e2');
        return null;
      }
    }
  }

  Future<Map<String, dynamic>> convertCurrency(
      String from, String to, double amount) async {
    try {
      final response = await _dio.post('/api/currency/convert',
          data: {'from': from, 'to': to, 'amount': amount});
      return response.data;
    } catch (e) {
      debugPrint('[API] convertCurrency failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Crypto Detail Screen Methods
  // ============================================================================
  Future<Map<String, dynamic>> getCryptoDetail(String coinId) async {
    try {
      final response = await _dio.get('/api/crypto/$coinId');
      return response.data;
    } catch (e) {
      debugPrint('[API] getCryptoDetail failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getCryptoOHLC(
      {required String coinId, required int days}) async {
    try {
      final response = await _dio.get('/api/crypto/ohlc',
          queryParameters: {'coin_id': coinId, 'days': days});
      return response.data;
    } catch (e) {
      debugPrint('[API] getCryptoOHLC failed: $e');
      return {};
    }
  }

  // ============================================================================
  // AI Analysis Screen Methods
  // ============================================================================
  Future<Map<String, dynamic>> healthCheck() async {
    try {
      final response = await _dio.get('/api/health');
      return response.data;
    } catch (e) {
      debugPrint('[API] healthCheck failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getBatchAnalysis() async {
    try {
      // FIX: /api/ai/batch-analysis → 404, use /api/v2/live-analysis instead
      final response = await _dio.get('/api/v2/live-analysis');
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] getBatchAnalysis failed: $e');
      return {};
    }
  }

  Future<List<dynamic>> getPredictions() async {
    return getMobilePredictions();
  }

  Future<List<dynamic>> getMobilePredictions(
      {int? limit, String? status}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (limit != null) queryParams['limit'] = limit;
      if (status != null) queryParams['status'] = status;
      final response = await _aiDio.get('/api/mobile/predictions',
          queryParameters: queryParams);
      if (response.data is List) return response.data;
      // FIX: API returns 'activePredictions' and 'closedPredictions', not 'predictions'
      final data = response.data is Map<String, dynamic>
          ? response.data
          : Map<String, dynamic>.from(response.data as Map);
      final active = data['activePredictions'];
      final closed = data['closedPredictions'];
      final predictions = data['predictions'] ?? data['data'];
      List<dynamic> result = [];
      if (active is List && active.isNotEmpty) {
        result = active;
      } else if (predictions is List) {
        result = predictions;
      } else if (closed is List && closed.isNotEmpty) {
        result = closed;
      }
      // FIX: Sort by confidence DESC and filter to top 7 (user wants 3-7 highest confidence)
      result.sort((a, b) {
        final confA = a is Map ? (a['confidence'] ?? a['maestro_score'] ?? 0) : 0;
        final confB = b is Map ? (b['confidence'] ?? b['maestro_score'] ?? 0) : 0;
        return (confB as num).compareTo(confA as num);
      });
      // Return top 7 by default (or limit if specified)
      final maxResults = limit ?? 7;
      return result.take(maxResults).toList();
    } catch (e) {
      debugPrint('[API] getMobilePredictions failed: $e');
      return [];
    }
  }

  /// Get top predictions sorted by confidence (3-7 highest)
  Future<List<dynamic>> getTopPredictions({int count = 7, String? market}) async {
    try {
      final all = await getMobilePredictions(limit: 100);
      // Filter BUY/STRONG_BUY signals only (highest confidence predictions)
      final buySignals = all.where((p) {
        if (p is! Map) return false;
        final signal = (p['signal'] ?? p['signal_type'] ?? '').toString().toUpperCase();
        return signal.contains('BUY') || signal.contains('STRONG');
      }).toList();
      // If we have enough BUY signals, return top 'count'
      if (buySignals.length >= count) {
        return buySignals.take(count).toList();
      }
      // Otherwise return top 'count' from all
      return all.take(count).toList();
    } catch (e) {
      debugPrint('[API] getTopPredictions failed: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> getPredictionPerformance(
      {String? month, String? market}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (month != null) queryParams['month'] = month;
      if (market != null) queryParams['market'] = market;
      final response = await _aiDio.get('/api/predictions/performance',
          queryParameters: queryParams);
      return response.data;
    } catch (e) {
      debugPrint('[API] getPredictionPerformance failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getGlobalPredictions() async {
    try {
      final response = await _aiDio.get('/api/global-predictions');
      return response.data;
    } catch (e) {
      debugPrint('[API] getGlobalPredictions failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> analyzeStock(String ticker) async {
    try {
      final response =
          await _dio.post('/api/ai/analyze-stock', data: {'ticker': ticker});
      return response.data;
    } catch (e) {
      debugPrint('[API] analyzeStock failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Subscription Screen Methods
  // ============================================================================
  Future<List<dynamic>> getSubscriptionPlans() async {
    try {
      final response = await _dio.get('/api/subscription/plans');
      return response.data;
    } catch (e) {
      debugPrint('[API] getSubscriptionPlans failed: $e');
      return [];
    }
  }

  Future<void> logout() async {
    try {
      await _dio.post('/api/auth/logout');
    } catch (e) {
      debugPrint('[API] logout failed: $e');
    } finally {
      await clearAuth();
    }
  }

  String get baseUrl => _baseUrl;

  void setBaseUrl(String url) {
    _baseUrl = url;
    _dio.options.baseUrl = _baseUrl;
    _aiDio.options.baseUrl = _baseUrl;
    _chartDio.options.baseUrl = _baseUrl;
  }

  Future<Map<String, dynamic>> getExpertRecommendations(
      {String? status, String? market}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (status != null) queryParams['status'] = status;
      if (market != null) queryParams['market'] = market;
      final response = await _dio.get('/api/recommendations/expert',
          queryParameters: queryParams);
      return response.data;
    } catch (e) {
      debugPrint('[API] getExpertRecommendations failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getMe() async {
    try {
      final response = await _dio.get('/api/auth/me');
      return response.data;
    } catch (e) {
      debugPrint('[API] getMe failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getMinAppVersion() async {
    return {
      'min_version': '2.4.0',
      'message_ar': 'يرجى تحديث التطبيق إلى أحدث إصدار للمتابعة.',
    };
  }

  // ============================================================================
  // Unified Multi-Market APIs
  // ============================================================================
  Future<Map<String, dynamic>> getUnifiedMarkets() async {
    return {
      'markets': [
        {'code': 'EGX', 'name_ar': 'البورصة المصرية'},
        {'code': 'TADAWUL', 'name_ar': 'تداول السعودية'},
        {'code': 'KSE', 'name_ar': 'بورصة الكويت'},
        {'code': 'QSE', 'name_ar': 'بورصة قطر'},
        {'code': 'DFM', 'name_ar': 'دبي المالي'},
        {'code': 'ADX', 'name_ar': 'أبوظبي المالي'},
        {'code': 'BSE', 'name_ar': 'بورصة البحرين'},
      ]
    };
  }

  Future<List<dynamic>> getUnifiedPersonas() async {
    // P39 FIX: return the platform's actual 3-persona config (conservative /
    // balanced / gambler) matching src/lib/v2/persona-config.ts on the web.
    // The old /api/v2/unified/personas endpoint never existed (404), so we
    // return the canonical persona list directly.
    return [
      {
        'code': 'conservative',
        'name_ar': 'المحافظ',
        'icon': '🛡️',
        'timeframe': '3-12 شهر',
        'description': 'حماية رأس المال أولاً — وقف خسارة ضيق (0.8×ATR) وحد مخاطفة 1%',
        'stop_factor': 0.8,
        'target_factor': 1.2,
        'max_risk_percent': 1.0,
        'crypto_allowed': false,
        'color': '#3b82f6',
      },
      {
        'code': 'balanced',
        'name_ar': 'المتوازن',
        'icon': '⚖️',
        'timeframe': '1-6 شهر',
        'description': 'توازن بين العائد والمخاطر — معاملات قياسية (1.0×ATR) وحد مخاطفة 2%',
        'stop_factor': 1.0,
        'target_factor': 1.0,
        'max_risk_percent': 2.0,
        'crypto_allowed': true,
        'color': '#eab308',
      },
      {
        'code': 'gambler',
        'name_ar': 'المغامر',
        'icon': '🔥',
        'timeframe': 'يومي-أسبوعي',
        'description': 'مخاطر عالية جداً مع وعي — وقف واسع (1.5×ATR) وحد مخاطفة 4.5%',
        'stop_factor': 1.5,
        'target_factor': 1.8,
        'max_risk_percent': 4.5,
        'crypto_allowed': true,
        'color': '#ef4444',
      },
    ];
  }

  Future<Map<String, dynamic>> getUnifiedConfig(
      {required String market, required String persona}) async {
    try {
      final response =
          await _dio.get('/api/v2/unified/config', queryParameters: {
        'market': market,
        'persona': persona,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] getUnifiedConfig failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> scanUnifiedMarket({
    required String market,
    required String persona,
    int topN = 20,
    int minScore = 65,
  }) async {
    try {
      final response = await _dio.post('/api/v2/unified/scan', data: {
        'market': market,
        'persona': persona,
        'top_n': topN,
        'min_score': minScore,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] scanUnifiedMarket failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> analyzeUnifiedStock({
    required String ticker,
    required String market,
    required String persona,
    double? support,
    double? resistance,
  }) async {
    try {
      final response = await _dio.post('/api/v2/unified/analyze', data: {
        'ticker': ticker,
        'market': market,
        'persona': persona,
        if (support != null) 'support': support,
        if (resistance != null) 'resistance': resistance,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] analyzeUnifiedStock failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getMaestroAnalysis(String ticker,
      {required String market, required String persona}) async {
    try {
      final response =
          await _dio.get('/api/maestro/stock/$ticker', queryParameters: {
        'market': market,
        'persona': persona,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] getMaestroAnalysis failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Backtesting APIs
  // ============================================================================
  Future<Map<String, dynamic>> runBacktest({
    required String strategy,
    required String ticker,
    required String startDate,
    required String endDate,
  }) async {
    try {
      final response = await _dio.post('/api/backtest', data: {
        'strategy': strategy,
        'ticker': ticker,
        'start_date': startDate,
        'end_date': endDate,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] runBacktest failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getBacktestingResults({
    String? action,
    String? persona,
    int? year,
    int? month,
    int? weeks,
  }) async {
    try {
      final response = await _dio.get('/api/backtesting', queryParameters: {
        if (action != null) 'action': action,
        if (persona != null) 'persona': persona,
        if (year != null) 'year': year,
        if (month != null) 'month': month,
        if (weeks != null) 'weeks': weeks,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] getBacktestingResults failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> runUnifiedBacktest(
      Map<String, dynamic> data) async {
    try {
      final response = await _dio.post('/api/backtesting/unified', data: data);
      return response.data;
    } catch (e) {
      debugPrint('[API] runUnifiedBacktest failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> runKimiBacktest() async {
    try {
      final response = await _dio.get('/api/kimi/backtest/run');
      return response.data;
    } catch (e) {
      debugPrint('[API] runKimiBacktest failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> runWalkForward() async {
    try {
      final response = await _dio.get('/api/walk-forward/run');
      return response.data;
    } catch (e) {
      debugPrint('[API] runWalkForward failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Learning & AI Self-Learning APIs
  // ============================================================================
  Future<Map<String, dynamic>> getUnifiedLearningStatus() async {
    try {
      // FIX: /api/learning/status → 404, use /api/unified-learning/status
      final response = await _dio.get('/api/unified-learning/status');
      return response.data;
    } catch (e) {
      debugPrint('[API] getUnifiedLearningStatus failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> runIterativeLearning() async {
    try {
      final response = await _dio.post('/api/unified-learning/iterative');
      return response.data;
    } catch (e) {
      debugPrint('[API] runIterativeLearning failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> runIntelligentLearning() async {
    try {
      final response = await _dio.post('/api/unified-learning/intelligent');
      return response.data;
    } catch (e) {
      debugPrint('[API] runIntelligentLearning failed: $e');
      return {};
    }
  }

  Future<List<dynamic>> getUnifiedLearningIndicators() async {
    try {
      // FIX: use /api/unified-learning/indicators (was using /api/learning/indicators → 404)
      final response = await _dio.get('/api/unified-learning/indicators');
      return response.data is List
          ? response.data
          : (response.data['indicators'] ?? response.data['data'] ?? []);
    } catch (e) {
      debugPrint('[API] getUnifiedLearningIndicators failed: $e');
      return [];
    }
  }

  Future<List<dynamic>> getUnifiedLearningPatterns() async {
    try {
      // FIX: use /api/unified-learning/patterns (was using /api/learning/patterns → 404)
      final response = await _dio.get('/api/unified-learning/patterns');
      return response.data is List
          ? response.data
          : (response.data['patterns'] ?? []);
    } catch (e) {
      debugPrint('[API] getUnifiedLearningPatterns failed: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> mineUnifiedLearningLessons() async {
    try {
      final response = await _dio.post('/api/unified-learning/mine-lessons');
      return response.data;
    } catch (e) {
      debugPrint('[API] mineUnifiedLearningLessons failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Payment Verification APIs
  // ============================================================================
  Future<Map<String, dynamic>> verifyGooglePlayReceipt(
      String receiptData) async {
    try {
      final response =
          await _dio.post('/api/google-play/verify-receipt', data: {
        'receipt_data': receiptData,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] verifyGooglePlayReceipt failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> verifyInstapayPayment(
      String txHashOrDetails) async {
    try {
      final response = await _dio.post('/api/instapay/verify', data: {
        'tx_hash': txHashOrDetails,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] verifyInstapayPayment failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> createPaymobPayment({
    required double amount,
    required String currency,
    required String planId,
  }) async {
    try {
      final response = await _dio.post('/api/paymob/create-payment', data: {
        'amount': amount,
        'currency': currency,
        'plan_id': planId,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] createPaymobPayment failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Metals API (Gold & Silver)
  // ============================================================================
  Future<Map<String, dynamic>> getGold() async {
    try {
      final response = await _dio.get('/api/mobile/gold');
      return response.data;
    } catch (e) {
      debugPrint('[API] getGold failed: $e');
      try {
        final response = await _dio.get('/api/metals/gold');
        return response.data;
      } catch (_) {
        return {};
      }
    }
  }

  Future<List<dynamic>> getGoldHistory(
      {required String karat, required int days}) async {
    try {
      final response =
          await _dio.get('/api/mobile/gold/history', queryParameters: {
        'karat': karat,
        'days': days,
      });
      return response.data is List
          ? response.data
          : (response.data['history'] ?? []);
    } catch (e) {
      debugPrint('[API] getGoldHistory failed: $e');
      try {
        final response =
            await _dio.get('/api/metals/gold/history', queryParameters: {
          'karat': karat,
          'days': days,
        });
        return response.data is List
            ? response.data
            : (response.data['history'] ?? []);
      } catch (_) {
        return [];
      }
    }
  }

  // ============================================================================
  // MOBILE Dashboard API
  // ============================================================================
  Future<Map<String, dynamic>> getDashboard({String? market}) async {
    try {
      debugPrint('[API] Fetching mobile dashboard...');
      final response = await _dio.get('/api/mobile/dashboard', queryParameters: {
        if (market != null) 'market': market,
      });
      final data = response.data is Map<String, dynamic>
          ? response.data
          : Map<String, dynamic>.from(response.data as Map);

      // FIX: Normalize keys to match what dashboard_screen.dart expects
      final inner = data['data'] is Map ? data['data'] : data;

      // Map 'gainers' → 'top_gainers', 'losers' → 'top_losers'
      if (inner['top_gainers'] == null && inner['gainers'] != null) {
        inner['top_gainers'] = inner['gainers'];
      }
      if (inner['top_losers'] == null && inner['losers'] != null) {
        inner['top_losers'] = inner['losers'];
      }
      // Map 'egx30'/'egx70' → 'indices'
      if (inner['indices'] == null) {
        final indices = <Map<String, dynamic>>[];
        for (final key in ['egx30', 'egx70', 'egx100']) {
          if (inner[key] is Map) {
            final idx = inner[key] as Map;
            indices.add({
              'name': key.toUpperCase(),
              'value': idx['value'] ?? idx['price'] ?? idx['last'],
              'change_percent': idx['change_percent'] ?? idx['change'] ?? 0,
            });
          }
        }
        if (indices.isNotEmpty) inner['indices'] = indices;
      }
      // Map 'breadth' → 'market_summary'
      if (inner['market_summary'] == null && inner['breadth'] is Map) {
        final b = inner['breadth'] as Map;
        inner['market_summary'] = {
          'advances': b['gainers'] ?? 0,
          'declines': b['losers'] ?? 0,
          'unchanged': b['unchanged'] ?? 0,
        };
      }
      // Map 'most_active' → 'top_movers.most_active'
      if (inner['top_movers'] == null && inner['most_active'] != null) {
        inner['top_movers'] = {
          'most_active': inner['most_active'],
          if (inner['top_gainers'] != null) 'gainers': inner['top_gainers'],
          if (inner['top_losers'] != null) 'losers': inner['top_losers'],
        };
      }

      return inner;
    } catch (e) {
      debugPrint('[API] getDashboard failed: $e');
      return {};
    }
  }

  // ============================================================================
  // MOBILE Notifications API
  // ============================================================================
  Future<List<dynamic>> getMobileNotifications() async {
    return [];
  }

  Future<Map<String, dynamic>> markNotificationRead(String id) async {
    try {
      final response =
          await _dio.post('/api/mobile/notifications', data: {'id': id});
      return response.data;
    } catch (e) {
      debugPrint('[API] markNotificationRead failed: $e');
      return {};
    }
  }

  // ============================================================================
  // MOBILE Alerts API
  // ============================================================================
  Future<Map<String, dynamic>> getAlertSettings() async {
    try {
      final response = await _dio.get('/api/mobile/alerts/settings');
      return response.data;
    } catch (e) {
      debugPrint('[API] getAlertSettings failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> createAlert(Map<String, dynamic> data) async {
    try {
      final response =
          await _dio.post('/api/mobile/alerts/settings', data: data);
      return response.data;
    } catch (e) {
      debugPrint('[API] createAlert failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> deleteAlert(String id) async {
    try {
      final response = await _dio
          .delete('/api/mobile/alerts/settings', queryParameters: {'id': id});
      return response.data;
    } catch (e) {
      debugPrint('[API] deleteAlert failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Hunter/Screener API
  // ============================================================================
  Future<List<dynamic>> getHunterScreener(
      {String? market, int limit = 10}) async {
    try {
      // FIX: /api/scanner/quick → 404, use /api/v2/recommend as fallback
      final response = await _dio.get('/api/v2/recommend', queryParameters: {
        if (market != null && market != 'ALL') 'market': market,
        'limit': limit,
      });
      if (response.data is List) return response.data;
      final data = response.data is Map<String, dynamic>
          ? response.data
          : Map<String, dynamic>.from(response.data as Map);
      return data['recommendations'] ??
          data['results'] ??
          data['hunters'] ??
          data['opportunities'] ??
          data['stocks'] ??
          data['data'] ??
          [];
    } catch (e) {
      debugPrint('[API] getHunterScreener failed: $e');
      return [];
    }
  }

  // ============================================================================
  // AI Chat API
  // ============================================================================
  Future<Map<String, dynamic>> sendAiChat(String message,
      {Map<String, dynamic>? context}) async {
    try {
      final response = await _aiDio.post('/api/ai/chat', data: {
        'message': message,
        if (context != null) 'context': context,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] sendAiChat failed: $e');
      return {};
    }
  }

  // ============================================================================
  // MOBILE News API
  // ============================================================================
  Future<List<dynamic>> getMobileNews() async {
    try {
      final response = await _dio.get('/api/mobile/news');
      if (response.data is List) return response.data;
      return response.data['news'] ??
          response.data['articles'] ??
          response.data['data'] ??
          [];
    } catch (e) {
      debugPrint('[API] getMobileNews failed: $e');
      return [];
    }
  }

  // ============================================================================
  // Learning Content API
  // ============================================================================
  Future<List<dynamic>> getLearningContent() async {
    try {
      // FIX: /api/learning/content returns market data not lessons
      // Return static educational content instead
      return [
        {'id': '01', 'title': 'سيكولوجيا التداول', 'icon': '🧠', 'category': 'psychology',
         'summary': 'التحكم في المشاعر أثناء التداول', 'read_time': '5 دقائق'},
        {'id': '02', 'title': 'تحليل المراحل (Stage Analysis)', 'icon': '📊', 'category': 'technical',
         'summary': 'كيف تحدد مرحلة السهم', 'read_time': '7 دقائق'},
        {'id': '03', 'title': 'استراتيجية CAN SLIM', 'icon': '💰', 'category': 'strategy',
         'summary': 'استراتيجية اختيار الأسهم الناجحة', 'read_time': '10 دقائق'},
        {'id': '04', 'title': 'العودة للمتوسط (Mean Reversion)', 'icon': '🔄', 'category': 'strategy',
         'summary': 'تداول ارتداد الأسهم', 'read_time': '6 دقائق'},
        {'id': '05', 'title': 'إدارة المخاطر', 'icon': '🛡️', 'category': 'risk',
         'summary': 'كيف تحمي رأس مالك', 'read_time': '8 دقائق'},
        {'id': '06', 'title': 'Price Action', 'icon': '📈', 'category': 'technical',
         'summary': 'قراءة حركة السعر', 'read_time': '12 دقائق'},
        {'id': '07', 'title': 'قصص العمالقة', 'icon': '🏆', 'category': 'stories',
         'summary': 'قصص ملهمة من كبار المستثمرين', 'read_time': '5 دقائق'},
        {'id': '08', 'title': 'الكريبتو للمبتدئين', 'icon': '₿', 'category': 'crypto',
         'summary': 'أساسيات العملات الرقمية', 'read_time': '15 دقائق'},
      ];
    } catch (e) {
      debugPrint('[API] getLearningContent failed: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> updateLearningProgress(String lessonId) async {
    try {
      final response = await _dio
          .post('/api/learning/progress', data: {'lesson_id': lessonId});
      return response.data;
    } catch (e) {
      debugPrint('[API] updateLearningProgress failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Market Status API
  // ============================================================================
  Future<Map<String, dynamic>> getMarketStatus() async {
    try {
      final response = await _dio.get('/api/market/status');
      return response.data;
    } catch (e) {
      debugPrint('[API] getMarketStatus failed: $e');
      return {};
    }
  }

  // ============================================================================
  // MOBILE Zakat API
  // ============================================================================
  Future<Map<String, dynamic>> getMobileZakat(
      Map<String, dynamic> params) async {
    try {
      final response = await _dio.get('/api/mobile/zakat-calculator',
          queryParameters: params);
      return response.data;
    } catch (e) {
      debugPrint('[API] getMobileZakat failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Watchlist Intelligence API
  // ============================================================================
  Future<Map<String, dynamic>> getWatchlistIntelligence() async {
    try {
      final response = await _dio.get('/api/mobile/watchlist/intelligence');
      return response.data;
    } catch (e) {
      debugPrint('[API] getWatchlistIntelligence failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Crypto Recommendations API
  // ============================================================================
  Future<List<dynamic>> getCryptoRecommendations(
      {int limit = 10, String? risk}) async {
    try {
      final response =
          await _dio.get('/api/crypto/recommendations', queryParameters: {
        'limit': limit,
        if (risk != null) 'risk': risk,
      });
      if (response.data is List) return response.data;
      return response.data['recommendations'] ?? response.data['data'] ?? [];
    } catch (e) {
      debugPrint('[API] getCryptoRecommendations failed: $e');
      return [];
    }
  }

  // ============================================================================
  // Finance Asset APIs
  // ============================================================================
  Future<List<dynamic>> getFinanceAssets() async {
    try {
      final response = await _dio.get('/api/finance/assets');
      return response.data is List
          ? response.data
          : (response.data['assets'] ?? []);
    } catch (e) {
      debugPrint('[API] getFinanceAssets failed: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> addFinanceAsset(
      Map<String, dynamic> data) async {
    try {
      final response = await _dio.post('/api/finance/assets', data: data);
      return response.data;
    } catch (e) {
      debugPrint('[API] addFinanceAsset failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> deleteFinanceAsset(String id) async {
    try {
      final response = await _dio.delete('/api/finance/assets/$id');
      return response.data;
    } catch (e) {
      debugPrint('[API] deleteFinanceAsset failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Risk Management APIs
  // ============================================================================
  Future<Map<String, dynamic>> getRiskDecisionTable() async {
    try {
      final response = await _dio.get('/api/risk/decision-table');
      return response.data;
    } catch (e) {
      debugPrint('[API] getRiskDecisionTable failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getRiskStockTypes() async {
    try {
      final response = await _dio.get('/api/risk/stock-types');
      return response.data;
    } catch (e) {
      debugPrint('[API] getRiskStockTypes failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Data Engine APIs
  // ============================================================================
  Future<Map<String, dynamic>> getDataEngineHealth() async {
    try {
      final response = await _dio.get('/api/data-engine/health');
      return response.data;
    } catch (e) {
      debugPrint('[API] getDataEngineHealth failed: $e');
      return {};
    }
  }

  Future<List<dynamic>> getDataEngineStocks() async {
    try {
      final response = await _dio.get('/api/data-engine/stocks');
      return response.data is List
          ? response.data
          : (response.data['stocks'] ?? []);
    } catch (e) {
      debugPrint('[API] getDataEngineStocks failed: $e');
      return [];
    }
  }

  Future<List<dynamic>> getDataEngineMetals() async {
    try {
      final response = await _dio.get('/api/data-engine/metals');
      return response.data is List
          ? response.data
          : (response.data['metals'] ?? []);
    } catch (e) {
      debugPrint('[API] getDataEngineMetals failed: $e');
      return [];
    }
  }

  Future<List<dynamic>> getDataEngineCrypto() async {
    try {
      final response = await _dio.get('/api/data-engine/crypto');
      return response.data is List
          ? response.data
          : (response.data['crypto'] ?? []);
    } catch (e) {
      debugPrint('[API] getDataEngineCrypto failed: $e');
      return [];
    }
  }

  Future<List<dynamic>> getDataEngineForex() async {
    try {
      final response = await _dio.get('/api/data-engine/forex');
      return response.data is List
          ? response.data
          : (response.data['forex'] ?? []);
    } catch (e) {
      debugPrint('[API] getDataEngineForex failed: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> getDataEngineStatus() async {
    try {
      final response = await _dio.get('/api/data-engine/status');
      return response.data;
    } catch (e) {
      debugPrint('[API] getDataEngineStatus failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Multi-Market Sync APIs
  // ============================================================================
  Future<Map<String, dynamic>> syncMultiMarkets() async {
    try {
      final response = await _dio.get('/api/multi-market/sync');
      return response.data;
    } catch (e) {
      debugPrint('[API] syncMultiMarkets failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getMarketConnections() async {
    try {
      final response = await _dio.get('/api/market/connections');
      return response.data;
    } catch (e) {
      debugPrint('[API] getMarketConnections failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getMarketIncrementalSync() async {
    try {
      final response = await _dio.get('/api/market/incremental-sync');
      return response.data;
    } catch (e) {
      debugPrint('[API] getMarketIncrementalSync failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> syncMarketLive() async {
    try {
      final response = await _dio.post('/api/market/sync-live');
      return response.data;
    } catch (e) {
      debugPrint('[API] syncMarketLive failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> syncMarket() async {
    try {
      final response = await _dio.post('/api/market/sync');
      return response.data;
    } catch (e) {
      debugPrint('[API] syncMarket failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Unified Stocks API
  // ============================================================================
  Future<List<dynamic>> getUnifiedStocks() async {
    try {
      final response = await _dio.get('/api/unified-stocks');
      return response.data is List
          ? response.data
          : (response.data['stocks'] ?? []);
    } catch (e) {
      debugPrint('[API] getUnifiedStocks failed: $e');
      return [];
    }
  }

  // ============================================================================
  // Confluence / Persona APIs
  // ============================================================================
  Future<Map<String, dynamic>> getConfluenceAnalyze(String ticker) async {
    try {
      final response =
          await _dio.get('/api/confluence/analyze/$ticker');
      return response.data;
    } catch (e) {
      debugPrint('[API] getConfluenceAnalyze failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getConfluenceMarketScan(
      {String? market, String? persona}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (market != null) queryParams['market'] = market;
      if (persona != null) queryParams['persona'] = persona;
      final response = await _dio.get('/api/confluence/market-scan',
          queryParameters: queryParams);
      return response.data;
    } catch (e) {
      debugPrint('[API] getConfluenceMarketScan failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getPersonaAnalyze(String ticker) async {
    try {
      final response =
          await _dio.get('/api/persona/analyze/$ticker');
      return response.data;
    } catch (e) {
      debugPrint('[API] getPersonaAnalyze failed: $e');
      return {};
    }
  }

  Future<List<dynamic>> getPersonaRecommendations(
      {String? persona, String? market}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (persona != null) queryParams['persona'] = persona;
      if (market != null) queryParams['market'] = market;
      final response = await _dio.get('/api/persona/recommendations',
          queryParameters: queryParams);
      if (response.data is List) return response.data;
      return response.data['recommendations'] ?? response.data['data'] ?? [];
    } catch (e) {
      debugPrint('[API] getPersonaRecommendations failed: $e');
      return [];
    }
  }

  Future<List<dynamic>> getScannerQuick(
      {String? market, int limit = 20}) async {
    try {
      final response = await _dio.get('/api/scanner/quick', queryParameters: {
        if (market != null) 'market': market,
        'limit': limit,
      });
      if (response.data is List) return response.data;
      final data = response.data is Map<String, dynamic>
          ? response.data
          : Map<String, dynamic>.from(response.data as Map);
      return data['results'] ?? data['scanner'] ?? data['data'] ?? [];
    } catch (e) {
      debugPrint('[API] getScannerQuick failed: $e');
      return [];
    }
  }

  // ============================================================================
  // Payment APIs
  // ============================================================================
  Future<Map<String, dynamic>> createSubscriptionCheckout(
      Map<String, dynamic> data) async {
    try {
      final response = await _dio.post('/api/subscription/checkout', data: data);
      return response.data;
    } catch (e) {
      debugPrint('[API] createSubscriptionCheckout failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> verifyPayment(Map<String, dynamic> data) async {
    try {
      final response = await _dio.post('/api/subscription/verify', data: data);
      return response.data;
    } catch (e) {
      debugPrint('[API] verifyPayment failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getSubscriptionStatus() async {
    try {
      final response = await _dio.get('/api/subscription/status');
      return response.data;
    } catch (e) {
      debugPrint('[API] getSubscriptionStatus failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Crypto Backtesting & Simulation APIs
  // ============================================================================
  Future<Map<String, dynamic>> getCryptoBacktesting(
      {String? coinId, int? days}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (coinId != null) queryParams['coin_id'] = coinId;
      if (days != null) queryParams['days'] = days;
      final response = await _dio.get('/api/crypto/backtesting',
          queryParameters: queryParams);
      return response.data;
    } catch (e) {
      debugPrint('[API] getCryptoBacktesting failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> simulateCryptoTrade(
      Map<String, dynamic> data) async {
    try {
      final response =
          await _dio.post('/api/crypto/simulation', data: data);
      return response.data;
    } catch (e) {
      debugPrint('[API] simulateCryptoTrade failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getCryptoPortfolio() async {
    try {
      final response = await _dio.get('/api/crypto/portfolio');
      return response.data;
    } catch (e) {
      debugPrint('[API] getCryptoPortfolio failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getCryptoStats() async {
    try {
      final response = await _dio.get('/api/crypto/stats');
      return response.data;
    } catch (e) {
      debugPrint('[API] getCryptoStats failed: $e');
      return {};
    }
  }

  Future<Map<String, dynamic>> getCryptoStatus() async {
    try {
      final response = await _dio.get('/api/crypto/status');
      return response.data;
    } catch (e) {
      debugPrint('[API] getCryptoStatus failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Mobile Crypto APIs
  // ============================================================================
  Future<List<dynamic>> getMobileCrypto() async {
    try {
      final response = await _dio.get('/api/mobile/crypto');
      if (response.data is List) return response.data;
      return response.data['crypto'] ?? response.data['data'] ?? [];
    } catch (e) {
      debugPrint('[API] getMobileCrypto failed: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> getMobileCryptoDetail(String coinId) async {
    try {
      final response = await _dio.get('/api/mobile/crypto/$coinId');
      return response.data;
    } catch (e) {
      debugPrint('[API] getMobileCryptoDetail failed: $e');
      return {};
    }
  }

  Future<List<dynamic>> getMobileCryptoRecommendations(
      {int limit = 10, String? risk}) async {
    try {
      final response =
          await _dio.get('/api/mobile/crypto/recommendations', queryParameters: {
        'limit': limit,
        if (risk != null) 'risk': risk,
      });
      if (response.data is List) return response.data;
      return response.data['recommendations'] ?? response.data['data'] ?? [];
    } catch (e) {
      debugPrint('[API] getMobileCryptoRecommendations failed: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> getMobileCryptoAnalysis(String coinId) async {
    try {
      final response =
          await _dio.get('/api/mobile/crypto/analysis', queryParameters: {
        'coin_id': coinId,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] getMobileCryptoAnalysis failed: $e');
      return {};
    }
  }

  Future<List<dynamic>> getMobileCryptoLearning() async {
    try {
      final response = await _dio.get('/api/mobile/crypto/learning');
      if (response.data is List) return response.data;
      return response.data['lessons'] ?? response.data['data'] ?? [];
    } catch (e) {
      debugPrint('[API] getMobileCryptoLearning failed: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> getMobileCryptoPortfolio() async {
    try {
      final response = await _dio.get('/api/mobile/crypto/portfolio');
      return response.data;
    } catch (e) {
      debugPrint('[API] getMobileCryptoPortfolio failed: $e');
      return {};
    }
  }

  Future<List<dynamic>> getMobileCryptoWatchlist() async {
    try {
      final response = await _dio.get('/api/mobile/crypto/watchlist');
      if (response.data is List) return response.data;
      return response.data['watchlist'] ?? response.data['data'] ?? [];
    } catch (e) {
      debugPrint('[API] getMobileCryptoWatchlist failed: $e');
      return [];
    }
  }

  // ============================================================================
  // Push Token Registration
  // ============================================================================
  Future<Map<String, dynamic>> registerPushToken(String token) async {
    try {
      final response = await _dio.post('/api/push/register', data: {
        'push_token': token,
      });
      return response.data;
    } catch (e) {
      debugPrint('[API] registerPushToken failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Trading Chart - Full Analysis API
  // GET /api/v2/chart/full-analysis?ticker=X&timeframe=MONTH&limit=30
  // ============================================================================
  Future<Map<String, dynamic>> getChartFullAnalysis({
    required String ticker,
    String timeframe = 'MONTH',
    int limit = 30,
    String state = 'buyer',
  }) async {
    try {
      final response = await _chartDio.get(
        '/api/v2/chart/full-analysis',
        queryParameters: {
          'ticker': ticker,
          'timeframe': timeframe,
          'limit': limit,
          'state': state,
        },
      );
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] getChartFullAnalysis($ticker) failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Portfolio Holdings API
  // GET /api/portfolio/holdings
  // ============================================================================
  Future<Map<String, dynamic>> getPortfolioHoldings() async {
    try {
      final response = await _dio.get('/api/portfolio/holdings');
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] getPortfolioHoldings failed: $e');
      return {};
    }
  }

  // ============================================================================
  // Market Live Data API (alias for getMarketLiveData with explicit market)
  // GET /api/market/live-data?market=EGX
  // ============================================================================
  Future<Map<String, dynamic>> getMarketLiveQuotes({String market = 'EGX'}) async {
    try {
      final response = await _dio.get(
        '/api/market/live-data',
        queryParameters: {'market': market},
      );
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] getMarketLiveQuotes($market) failed: $e');
      return {};
    }
  }

  // ============================================================================
  // PHASE5-053: New Endpoints for Commercial Launch
  // ============================================================================

  /// GET /api/predictions/league-report?period=monthly
  /// الدوري الممتاز للسوق — أفضل 10 أسهم/صفقات في الفترة
  Future<Map<String, dynamic>> getLeagueReport({String period = 'monthly'}) async {
    try {
      final response = await _dio.get(
        '/api/predictions/league-report',
        queryParameters: {'period': period},
      );
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] getLeagueReport($period) failed: $e');
      return {'success': false, 'league': []};
    }
  }

  /// GET /api/fomo/missed-opportunities
  /// FOMO Engine — الأرباح الفائتة للعميل المجاني
  Future<Map<String, dynamic>> getFomoMissedOpportunities() async {
    try {
      final response = await _dio.get('/api/fomo/missed-opportunities');
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] getFomoMissedOpportunities failed: $e');
      return {'success': false, 'missed_opportunities': []};
    }
  }

  /// GET /api/portfolio/watchlists?user_id=U
  /// قوائم المتابعة الخاصة بالمستخدم
  Future<Map<String, dynamic>> getWatchlists({String userId = 'default'}) async {
    try {
      final response = await _dio.get(
        '/api/portfolio/watchlists',
        queryParameters: {'user_id': userId},
      );
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] getWatchlists failed: $e');
      return {'success': false, 'watchlists': []};
    }
  }

  /// POST /api/portfolio/watchlists (action: create/add/remove)
  Future<Map<String, dynamic>> manageWatchlist({
    required String action,
    int? watchlistId,
    String? name,
    String? ticker,
    String userId = 'default',
  }) async {
    try {
      final body = <String, dynamic>{
        'action': action,
        'user_id': userId,
      };
      if (watchlistId != null) body['watchlist_id'] = watchlistId;
      if (name != null) body['name'] = name;
      if (ticker != null) body['ticker'] = ticker;

      final response = await _dio.post('/api/portfolio/watchlists', data: body);
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] manageWatchlist($action) failed: $e');
      return {'success': false};
    }
  }

  /// GET /api/portfolio/master?user_id=U
  /// المحفظة الأم (Master) — تجمع كل المحافظ الفرعية
  Future<Map<String, dynamic>> getPortfolioMaster({String userId = 'default'}) async {
    try {
      final response = await _dio.get(
        '/api/portfolio/master',
        queryParameters: {'user_id': userId},
      );
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] getPortfolioMaster failed: $e');
      return {'success': false, 'aggregated': {}};
    }
  }

  /// GET /api/live/scan?limit=10
  /// فحص لحظي لأعلى الفرص في السوق
  Future<Map<String, dynamic>> getLiveScan({int limit = 10}) async {
    try {
      final response = await _dio.get(
        '/api/live/scan',
        queryParameters: {'limit': limit},
      );
      return response.data is Map<String, dynamic>
          ? response.data
          : {'data': response.data};
    } catch (e) {
      debugPrint('[API] getLiveScan failed: $e');
      return {'success': false, 'opportunities': []};
    }
  }

  // ===========================================================================
  // BRIEF-047/048: Live Monitor & Portfolio Alerts API
  // ===========================================================================

  /// GET /api/live-monitor/ledger
  /// BRIEF-047: سجل التوقعات + Win Rate + live_alerts
  Future<Map<String, dynamic>> getLiveMonitorLedger() async {
    try {
      final response = await _dio.get('/api/live-monitor/ledger',
          options: Options(headers: {'Cache-Control': 'no-cache'}));
      return response.data is Map<String, dynamic>
          ? response.data
          : {'success': false};
    } catch (e) {
      debugPrint('[API] getLiveMonitorLedger failed: $e');
      return {
        'success': false,
        'active_predictions': [],
        'closed_predictions': [],
        'win_rate': 0,
        'total_signals': 0,
        'wins': 0,
        'losses': 0,
        'live_alerts': [],
      };
    }
  }

  /// GET /api/chart/{ticker}?period=1w&asset=stock
  /// BRIEF-049: بيانات intraday للفريمات اللحظية (5m/15m/1h)
  Future<Map<String, dynamic>> getIntradayChart(String ticker,
      {String period = '1w'}) async {
    try {
      final response = await _chartDio.get(
        '/api/chart/${ticker.toUpperCase()}',
        queryParameters: {'period': period, 'asset': 'stock', '_t': DateTime.now().millisecondsSinceEpoch},
      );
      return response.data is Map<String, dynamic>
          ? response.data
          : {'success': false, 'data': []};
    } catch (e) {
      debugPrint('[API] getIntradayChart failed: $e');
      return {'success': false, 'data': []};
    }
  }

  /// BRIEF-048: فحص تنبيهات المحفظة (TP/SL/Trailing)
  /// بتجيب المحفظة + الأسعار الحالية و تتاكد من:
  /// 1. Hit Target (TP1/TP2/TP3)
  /// 2. OB Breach (Stop Loss)
  /// 3. Trailing Stop suggestion
  Future<List<Map<String, dynamic>>> checkPortfolioAlerts() async {
    List<Map<String, dynamic>> alerts = [];

    try {
      // اجيب المحفظة
      final portfolio = await getMobilePortfolio();
      if (portfolio.positions.isEmpty) return alerts;

      for (final pos in portfolio.positions) {
        final ticker = pos.ticker;
        final avgPrice = pos.avgPrice;
        final quantity = pos.quantity;
        if (avgPrice <= 0 || quantity <= 0) continue;

        // اجيب السعر الحالي
        double currentPrice = 0;
        try {
          final stockRes = await _dio.get('/api/mobile/stocks/$ticker',
              options: Options(headers: {'Cache-Control': 'no-cache'}));
          if (stockRes.data is Map) {
            currentPrice = (stockRes.data['price'] ??
                    stockRes.data['data']?['price'] ??
                    stockRes.data['currentPrice'] ??
                    0)
                .toDouble();
          }
        } catch (_) {
          continue;
        }
        if (currentPrice <= 0) continue;

        final pnlPct = (currentPrice - avgPrice) / avgPrice * 100;

        // 1. Hit Target (TP1/TP2/TP3)
        final tp1 = pos.targetPrice ?? 0;
        final tp2 = pos.target2 ?? 0;
        final tp3 = pos.target3 ?? 0;

        if (tp1 > 0 && currentPrice >= tp1 && currentPrice < tp1 * 1.02) {
          alerts.add({
            'type': 'TARGET_HIT',
            'severity': 'info',
            'ticker': ticker,
            'message': '🎯 $ticker وصل لـ TP1 ($tp1) - ربح ${pnlPct.toStringAsFixed(1)}%',
            'price': currentPrice,
            'target': tp1,
            'pnl_pct': pnlPct,
          });
        }
        if (tp2 > 0 && currentPrice >= tp2 && currentPrice < tp2 * 1.02) {
          alerts.add({
            'type': 'TARGET_HIT',
            'severity': 'info',
            'ticker': ticker,
            'message': '🎯 $ticker وصل لـ TP2 ($tp2) - ربح ${pnlPct.toStringAsFixed(1)}%',
            'price': currentPrice,
            'target': tp2,
            'pnl_pct': pnlPct,
          });
        }
        if (tp3 > 0 && currentPrice >= tp3) {
          alerts.add({
            'type': 'TARGET_HIT',
            'severity': 'info',
            'ticker': ticker,
            'message': '🎯 $ticker وصل لـ TP3 ($tp3) - ربح ${pnlPct.toStringAsFixed(1)}%',
            'price': currentPrice,
            'target': tp3,
            'pnl_pct': pnlPct,
          });
        }

        // 2. OB Breach (Stop Loss)
        final stopLoss = pos.stopLoss ?? 0;
        if (stopLoss > 0 && currentPrice <= stopLoss) {
          alerts.add({
            'type': 'OB_BREACH',
            'severity': 'critical',
            'ticker': ticker,
            'message': '🚨 $ticker كسر وقف الخسارة ($stopLoss) - خسارة ${pnlPct.abs().toStringAsFixed(1)}% - خروج طارئ!',
            'price': currentPrice,
            'stop_loss': stopLoss,
            'pnl_pct': pnlPct,
          });
        }

        // 3. Trailing Stop (لو ربح > 15%)
        if (pnlPct > 15 && stopLoss > 0 && currentPrice > stopLoss * 1.15) {
          final newStop = currentPrice * 0.95;
          if (newStop > stopLoss) {
            alerts.add({
              'type': 'TRAILING_STOP',
              'severity': 'warning',
              'ticker': ticker,
              'message': '📈 $ticker ربح ${pnlPct.toStringAsFixed(1)}% - اقترح تحريك الـ SL لـ ${newStop.toStringAsFixed(2)}',
              'price': currentPrice,
              'new_stop': newStop,
              'pnl_pct': pnlPct,
            });
          }
        }
      }
    } catch (e) {
      debugPrint('[API] checkPortfolioAlerts failed: $e');
    }

    return alerts;
  }

  /// BRIEF-048: فحص تنبيهات الحيتان (LIVE_WHALE_BUY)
  Future<List<Map<String, dynamic>>> getWhaleAlerts() async {
    try {
      final ledger = await getLiveMonitorLedger();
      final liveAlerts = ledger['live_alerts'] as List? ?? [];
      return liveAlerts
          .where((a) => a['alert_type'] == 'LIVE_WHALE_BUY')
          .map((a) => {
                'type': 'LIVE_WHALE_BUY',
                'severity': 'info',
                'ticker': a['ticker'] ?? '',
                'message': a['message'] ?? '🐋 حوت نشط',
                'timestamp': a['timestamp'] ?? '',
              })
          .toList()
          .cast<Map<String, dynamic>>();
    } catch (e) {
      debugPrint('[API] getWhaleAlerts failed: $e');
      return [];
    }
  }

  // ===========================================================================
  // P40 ACADEMY: Live Paper Trading V2 — /api/paper-trading-v2/
  // ===========================================================================

  /// Get or create the user's paper trading account (auto-creates with
  /// 100,000 EGP virtual balance on first call).
  Future<Map<String, dynamic>> getPaperTradingAccount() async {
    try {
      final response = await _dio.get('/api/paper-trading-v2/account');
      if (response.statusCode == 200) {
        final data = response.data as Map<String, dynamic>;
        if (data['success'] == true) {
          return data['account'] as Map<String, dynamic>;
        }
      }
      return {};
    } catch (e) {
      debugPrint('[API] getPaperTradingAccount failed: $e');
      return {};
    }
  }

  /// Place a new paper trading order (BUY or SELL with optional SL/TP).
  /// Returns the created order or throws with the error message.
  Future<Map<String, dynamic>> placePaperOrder({
    required String ticker,
    required String assetType,
    required String orderType,
    required double shares,
    required double entryPrice,
    double? stopLoss,
    double? takeProfit,
    String? notes,
  }) async {
    final response = await _dio.post('/api/paper-trading-v2/order', data: {
      'ticker': ticker.toUpperCase(),
      'asset_type': assetType,
      'order_type': orderType,
      'shares': shares,
      'entry_price': entryPrice,
      if (stopLoss != null) 'stop_loss': stopLoss,
      if (takeProfit != null) 'take_profit': takeProfit,
      if (notes != null) 'notes': notes,
    });
    final data = response.data as Map<String, dynamic>;
    if (data['success'] == true) {
      return data['order'] as Map<String, dynamic>;
    }
    throw Exception(data['error'] ?? 'فشل تنفيذ الأمر');
  }

  /// Get open positions enriched with live prices + unrealized P&L.
  Future<Map<String, dynamic>> getPaperPositions() async {
    try {
      final response = await _dio.get('/api/paper-trading-v2/positions');
      if (response.statusCode == 200) {
        final data = response.data as Map<String, dynamic>;
        if (data['success'] == true) {
          return data;
        }
      }
      return {'account': {}, 'positions': [], 'autoClosed': [], 'livePrices': {}};
    } catch (e) {
      debugPrint('[API] getPaperPositions failed: $e');
      return {'account': {}, 'positions': [], 'autoClosed': [], 'livePrices': {}};
    }
  }

  /// Close an open order at the given current price.
  Future<Map<String, dynamic>> closePaperOrder({
    required int orderId,
    required double currentPrice,
    String reason = 'MANUAL',
  }) async {
    final response = await _dio.post(
      '/api/paper-trading-v2/orders/$orderId/close',
      data: {'current_price': currentPrice, 'reason': reason},
    );
    final data = response.data as Map<String, dynamic>;
    if (data['success'] == true) return data;
    throw Exception(data['error'] ?? 'فشل إغلاق الصفقة');
  }

  /// List orders (open / closed / all).
  Future<List<Map<String, dynamic>>> getPaperOrders(
      {String status = 'all'}) async {
    try {
      final response = await _dio.get(
        '/api/paper-trading-v2/orders',
        queryParameters: {'status': status},
      );
      final data = response.data as Map<String, dynamic>;
      if (data['success'] == true) {
        return (data['orders'] as List)
            .map((e) => e as Map<String, dynamic>)
            .toList();
      }
      return [];
    } catch (e) {
      debugPrint('[API] getPaperOrders failed: $e');
      return [];
    }
  }

  /// Reset the paper trading account to 100,000 EGP.
  Future<Map<String, dynamic>> resetPaperAccount() async {
    try {
      final response = await _dio.post('/api/paper-trading-v2/reset');
      final data = response.data as Map<String, dynamic>;
      if (data['success'] == true) {
        return data['account'] as Map<String, dynamic>;
      }
      return {};
    } catch (e) {
      debugPrint('[API] resetPaperAccount failed: $e');
      return {};
    }
  }

  // ===========================================================================
  // P39 PERSONA: Dynamic Risk Profiler — client-side score, no API needed
  // ===========================================================================

  /// Map a risk tolerance score (1..100) to a persona id.
  String scoreToPersona(int score) {
    if (score <= 35) return 'conservative';
    if (score <= 65) return 'balanced';
    return 'gambler';
  }

  /// Get the persona config (stop factor, target factor, max risk %, etc.)
  Map<String, dynamic> getPersonaVector(String persona) {
    const vectors = {
      'conservative': {
        'stop_factor': 0.8,
        'target_factor': 1.2,
        'max_risk_percent': 1.0,
        'cut_loss_threshold_pct': 8.0,
        'average_down_max_pct': 5.0,
        'hold_patience_days': 30,
        'debt_paydown_ratio': 0.5,
        'asset_ceilings': {'egx': 65, 'crypto': 0, 'gold': 25, 'cash': 10},
      },
      'balanced': {
        'stop_factor': 1.0,
        'target_factor': 1.0,
        'max_risk_percent': 2.0,
        'cut_loss_threshold_pct': 15.0,
        'average_down_max_pct': 10.0,
        'hold_patience_days': 60,
        'debt_paydown_ratio': 0.3,
        'asset_ceilings': {'egx': 55, 'crypto': 15, 'gold': 20, 'cash': 10},
      },
      'gambler': {
        'stop_factor': 1.5,
        'target_factor': 1.8,
        'max_risk_percent': 4.5,
        'cut_loss_threshold_pct': 25.0,
        'average_down_max_pct': 20.0,
        'hold_patience_days': 90,
        'debt_paydown_ratio': 0.1,
        'asset_ceilings': {'egx': 30, 'crypto': 60, 'gold': 5, 'cash': 5},
      },
    };
    return vectors[persona] ?? vectors['balanced']!;
  }
}

// Top-level getter for backward compatibility
GLMApiClient get api => GLMApiClient.instance;
