// ============================================================================
// مساعد الاستثمار Flutter - App Root with Navigation
// Bottom Tab Navigator + AppBar + Drawer + Command Bar
// ============================================================================

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'theme/colors.dart';
import 'screens/dashboard_screen.dart';
import 'screens/stocks_screen.dart';
import 'screens/stock_history_screen.dart';
import 'screens/currency_screen.dart';
import 'screens/crypto_screen.dart';
import 'screens/zakat_screen.dart';
import 'screens/ai_analysis_screen.dart';
import 'screens/auth_screen.dart';
import 'screens/portfolio_screen.dart';
import 'screens/watchlist_screen.dart';
import 'screens/recommendations_screen.dart';
import 'screens/subscription_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/webview_screen.dart';
import 'screens/metals_screen.dart';
import 'screens/learning_backtest_screen.dart';
import 'screens/hunter_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/alerts_screen.dart';
import 'screens/news_screen.dart';
import 'screens/screener_screen.dart';
import 'screens/trading_chart_screen.dart';
import 'screens/reports_screen.dart';
import 'screens/simulation_screen.dart';
import 'screens/prediction_performance_screen.dart';
import 'screens/trading_journal_screen.dart';
import 'screens/smart_confluence_screen.dart';
import 'screens/live_monitor_screen.dart';
import 'screens/academy_screen.dart';
import 'screens/risk_profiler_screen.dart';
import 'api/client.dart';
import 'models/types.dart';
import 'services/notification_service.dart';

class MainNavigator extends StatefulWidget {
  const MainNavigator({super.key});

  @override
  State<MainNavigator> createState() => _MainNavigatorState();
}

class _MainNavigatorState extends State<MainNavigator> {
  int _currentIndex = 0;
  int _marketVersion = 0;
  bool _loadingMarkets = false;
  final GlobalKey<State> _dashboardKey = GlobalKey<State>();
  final GlobalKey<State> _stocksKey = GlobalKey<State>();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  User? _user;
  bool _isLoggedIn = false;
  String _selectedMarket = 'EGX';
  int _notificationCount = 0;
  Timer? _notificationPollTimer;
  List<_MarketOption> _marketOptions = const [
    _MarketOption('EGX', 'مصر'),
    _MarketOption('TADAWUL', 'السعودية'),
    _MarketOption('KSE', 'الكويت'),
    _MarketOption('QSE', 'قطر'),
    _MarketOption('DFM', 'دبي'),
    _MarketOption('ADX', 'أبوظبي'),
    _MarketOption('BSE', 'البحرين'),
  ];

  List<Widget> get _screens => [
        DashboardScreen(
          key: _dashboardKey,
          marketVersion: _marketVersion,
        ),
        StocksScreen(
          key: _stocksKey,
          marketVersion: _marketVersion,
        ),
        HunterScreen(
          marketVersion: _marketVersion,
        ),
        const CryptoScreen(),
        const PortfolioScreen(),
      ];

  Stream<int> get _notificationCountStream async* {
    yield _notificationCount;
    await Future<void>.delayed(const Duration(seconds: 30));
    while (true) {
      yield _notificationCount;
      await Future<void>.delayed(const Duration(seconds: 30));
    }
  }

  @override
  void initState() {
    super.initState();
    _loadSelectedMarket();
    _loadMarketOptions();
    _startNotificationPolling();
    // Restore auth token into singleton so interceptors send it on every request
    _restoreAuthToken();
    // Defer auth check to post-frame callback to avoid blocking UI
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkAuth();
    });
  }

  @override
  void dispose() {
    _notificationPollTimer?.cancel();
    super.dispose();
  }

  void _startNotificationPolling() {
    _notificationPollTimer?.cancel();
    _notificationPollTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _fetchNotificationCount();
    });
    _fetchNotificationCount();
  }

  Future<void> _fetchNotificationCount() async {
    try {
      final response = await api.getMobileNotifications();
      final Map<String, dynamic> data = <String, dynamic>{};
      if (response is Map) {
        final Map<dynamic, dynamic> rawMap = response as Map<dynamic, dynamic>;
        for (final entry in rawMap.keys) {
          final key = entry.toString();
          data[key] = rawMap[entry];
        }
      }
      final dynamic rawNotifications = data['notifications'] ?? data['data'];
      final List<dynamic> list =
          rawNotifications is List ? rawNotifications : <dynamic>[];
      
      final prefs = await SharedPreferences.getInstance();
      final List<String> notifiedIds = prefs.getStringList('notified_notification_ids') ?? <String>[];
      final List<String> newNotifiedIds = List<String>.from(notifiedIds);

      int unread = 0;
      for (final item in list) {
        final Map<dynamic, dynamic> map =
            item is Map ? item as Map<dynamic, dynamic> : <dynamic, dynamic>{};
        final String id = map['id']?.toString() ?? '';
        final isRead = map['is_read'] == true || map['read'] == true;
        
        if (!isRead) {
          unread++;
          if (id.isNotEmpty && !notifiedIds.contains(id)) {
            final String title = map['title']?.toString() ?? 'تنبيه جديد ✨';
            final String message = map['message']?.toString() ?? '';
            final String type = map['type']?.toString() ?? 'price_alert';
            final int notificationId = int.tryParse(id) ?? id.hashCode;
            
            unawaited(NotificationService().showLocalNotification(
              id: notificationId,
              title: title,
              body: message,
              payload: 'notification_$id',
              channelId: type == 'system' ? 'daily_analysis' : 'recommendations',
            ));
            
            newNotifiedIds.add(id);
          }
        }
      }

      if (newNotifiedIds.length > 100) {
        newNotifiedIds.removeRange(0, newNotifiedIds.length - 100);
      }
      await prefs.setStringList('notified_notification_ids', newNotifiedIds);

      if (mounted) {
        setState(() => _notificationCount = unread);
      }
    } catch (_) {}
  }

  Future<void> _loadSelectedMarket() async {
    final prefs = await SharedPreferences.getInstance();
    final storedMarket = prefs.getString('active_market') ?? 'EGX';
    final market = _marketOptions.any((m) => m.code == storedMarket)
        ? storedMarket
        : _marketOptions.first.code;
    setState(() {
      _selectedMarket = market;
    });
  }

  Future<void> _loadMarketOptions() async {
    setState(() => _loadingMarkets = true);
    try {
      final data = await api.getUnifiedMarkets();
      final rawMarkets = data['markets'] ?? data['data'] ?? data['items'];
      if (rawMarkets is List && rawMarkets.isNotEmpty) {
        final options = rawMarkets
            .map((e) {
              final map = e as Map<String, dynamic>;
              final code = map['code']?.toString() ??
                  map['market']?.toString() ??
                  map['symbol']?.toString() ??
                  '';
              if (code.isEmpty) return null;
              return _MarketOption(
                code,
                map['name_ar']?.toString() ??
                    map['name']?.toString() ??
                    map['country_ar']?.toString() ??
                    map['country']?.toString() ??
                    code,
              );
            })
            .whereType<_MarketOption>()
            .toList();
        if (options.isNotEmpty && mounted) {
          setState(() {
            _marketOptions = options;
            if (!_marketOptions.any((m) => m.code == _selectedMarket)) {
              _selectedMarket = options.first.code;
            }
          });
        }
      }
    } catch (e) {
      debugPrint('[App] Failed to load unified markets: $e');
    } finally {
      if (mounted) {
        setState(() => _loadingMarkets = false);
      }
    }
  }

  Future<void> _changeMarket(String market) async {
    final messenger = ScaffoldMessenger.of(context);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('active_market', market);
    if (!mounted) return;
    setState(() {
      _selectedMarket = market;
      _marketVersion++;
    });

    messenger.showSnackBar(
      SnackBar(
        content: Text('تم تحويل السوق النشط إلى $market'),
        duration: const Duration(seconds: 1),
        backgroundColor: AppColors.primary,
      ),
    );
  }

  Future<void> _checkAuth() async {
    final loggedIn = await api.isAuthenticated();
    if (mounted) {
      setState(() {
        _isLoggedIn = loggedIn;
        if (loggedIn) {
          _loadUserData();
        } else {
          _user = null;
        }
      });
    }
  }

  Future<void> _restoreAuthToken() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('auth_token');
      if (token != null && token.isNotEmpty) {
        api.setAuthToken(token);
      }
    } catch (_) {}
  }

  Future<void> _loadUserData() async {
    final user = await api.getUser();
    if (mounted) {
      setState(() {
        _user = user;
      });
    }
  }

  void _refreshAuth() {
    _checkAuth();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        key: _scaffoldKey,
        drawer: _buildDrawer(),
        // ── Persistent AppBar with drawer toggle + command bar ──
        appBar: AppBar(
          backgroundColor: AppColors.surface,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.menu_rounded, color: AppColors.text),
            onPressed: () => _scaffoldKey.currentState?.openDrawer(),
          ),
          title: const Text(
            'مساعد الاستثمار',
            style: TextStyle(
              fontFamily: 'Cairo',
              fontWeight: FontWeight.w800,
              fontSize: 18,
              color: AppColors.text,
            ),
          ),
          actions: [
            // Notification Bell
            StreamBuilder<int>(
              initialData: _notificationCount,
              stream: _notificationCountStream,
              builder: (context, snapshot) {
                final count = snapshot.data ?? 0;
                return Stack(
                  clipBehavior: Clip.none,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.notifications_rounded,
                          color: AppColors.text),
                      onPressed: () => _navigateTo(const NotificationsScreen()),
                    ),
                    if (count > 0)
                      Positioned(
                        top: 4,
                        left: 4,
                        child: Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: AppColors.danger,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          constraints: const BoxConstraints(
                            minWidth: 16,
                            minHeight: 16,
                          ),
                          child: Text(
                            count > 99 ? '99+' : '$count',
                            style: const TextStyle(
                              color: AppColors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
            // Market Selector Dropdown
            Theme(
              data: Theme.of(context).copyWith(
                cardColor: AppColors.surface,
              ),
              child: PopupMenuButton<String>(
                initialValue: _selectedMarket,
                onSelected: _changeMarket,
                child: Container(
                  margin: const EdgeInsets.symmetric(vertical: 12),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _selectedMarket,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: AppColors.text,
                        ),
                      ),
                      const Icon(Icons.arrow_drop_down,
                          size: 16, color: AppColors.text),
                    ],
                  ),
                ),
                itemBuilder: (context) => _loadingMarkets
                    ? [
                        const PopupMenuItem<String>(
                          enabled: false,
                          child: SizedBox(
                            width: 160,
                            height: 32,
                            child: Center(
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: AppColors.primary)),
                          ),
                        ),
                      ]
                    : _marketOptions.map((option) {
                        return PopupMenuItem<String>(
                          value: option.code,
                          child: Text('${option.code} (${option.label})',
                              style: const TextStyle(color: AppColors.text)),
                        );
                      }).toList(),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.search_rounded, color: AppColors.text),
              onPressed: _showCommandBar,
            ),
            if (_isLoggedIn)
              GestureDetector(
                onTap: () => _navigateTo(const SettingsScreen()),
                child: Container(
                  margin: const EdgeInsets.only(left: 8, right: 8),
                  decoration: const BoxDecoration(
                    gradient: AppColors.gradientPurplePink,
                    shape: BoxShape.circle,
                  ),
                  child: CircleAvatar(
                    radius: 16,
                    backgroundColor: AppColors.transparent,
                    child: Text(
                      _getUserInitials(_user),
                      style: const TextStyle(
                          color: AppColors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 13),
                    ),
                  ),
                ),
              )
            else
              GestureDetector(
                onTap: () async {
                  await _navigateTo(const AuthScreen());
                  _refreshAuth();
                },
                child: Container(
                  margin: const EdgeInsets.only(left: 8, right: 8),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: const BoxDecoration(
                    gradient: AppColors.gradientPurplePink,
                    borderRadius: BorderRadius.all(Radius.circular(16)),
                  ),
                  child: const Text(
                    '✨',
                    style: TextStyle(fontSize: 16),
                  ),
                ),
              ),
          ],
        ),
        body: IndexedStack(
          index: _currentIndex,
          children: _screens,
        ),
        bottomNavigationBar: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [AppColors.surface, AppColors.surfaceMuted],
            ),
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary,
                blurRadius: 20,
                offset: Offset(0, -4),
              ),
            ],
          ),
          child: BottomNavigationBar(
            currentIndex: _currentIndex,
            onTap: (index) => setState(() => _currentIndex = index),
            items: const [
              BottomNavigationBarItem(
                icon: Icon(Icons.home_rounded, color: AppColors.textMuted),
                activeIcon: Icon(Icons.home, color: AppColors.primaryGlow),
                label: 'الرئيسية',
              ),
              BottomNavigationBarItem(
                icon:
                    Icon(Icons.trending_up_rounded, color: AppColors.textMuted),
                activeIcon:
                    Icon(Icons.trending_up, color: AppColors.primaryGlow),
                label: 'الأسهم',
              ),
              BottomNavigationBarItem(
                icon:
                    Icon(Icons.visibility_rounded, color: AppColors.textMuted),
                activeIcon:
                    Icon(Icons.visibility, color: AppColors.primaryGlow),
                label: 'الفرص',
              ),
              BottomNavigationBarItem(
                icon: Icon(Icons.currency_bitcoin_rounded,
                    color: AppColors.textMuted),
                activeIcon:
                    Icon(Icons.currency_bitcoin, color: AppColors.primaryGlow),
                label: 'الكريبتو',
              ),
              BottomNavigationBarItem(
                icon: Icon(Icons.account_balance_wallet_rounded,
                    color: AppColors.textMuted),
                activeIcon: Icon(Icons.account_balance_wallet,
                    color: AppColors.primaryGlow),
                label: 'المحفظة',
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ===========================================================================
  // Command Bar - Quick search & navigation
  // ===========================================================================
  void _showCommandBar() {
    showDialog(
      context: context,
      builder: (ctx) => _CommandBarDialog(
        onNavigate: (screen) {
          Navigator.pop(ctx);
          _navigateTo(screen);
        },
        onSwitchTab: (index) {
          Navigator.pop(ctx);
          setState(() => _currentIndex = index);
        },
      ),
    );
  }

  // ===========================================================================
  // Side Drawer
  // ===========================================================================
  Widget _buildDrawer() {
    return Drawer(
      child: Directionality(
        textDirection: TextDirection.rtl,
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            // Header with user info
            Container(
              padding: const EdgeInsets.fromLTRB(20, 50, 20, 20),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppColors.primaryDark,
                    AppColors.primary,
                    AppColors.secondary
                  ],
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.white.withValues(alpha: 0.2),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.trending_up_rounded,
                        color: AppColors.white, size: 28),
                  ),
                  const SizedBox(height: 12),
                  const Text('مساعد الاستثمار',
                      style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: AppColors.white,
                          fontFamily: 'Cairo')),
                  const SizedBox(height: 4),
                  Text('منصة الاستثمار الذكية',
                      style: TextStyle(
                          fontSize: 13,
                          color: AppColors.white.withValues(alpha: 0.8))),
                  if (_isLoggedIn && _user != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                          color: AppColors.white.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8)),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 14,
                            backgroundColor:
                                AppColors.white.withValues(alpha: 0.3),
                            child: Text(
                              _getUserInitials(_user),
                              style: const TextStyle(
                                  color: AppColors.white,
                                  fontWeight: FontWeight.w700,
                                  fontSize: 12),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(_user?.username ?? _user?.name ?? 'مستخدم',
                                    style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                        color: AppColors.white)),
                                Text(_user?.email ?? '',
                                    style: TextStyle(
                                        fontSize: 10,
                                        color: AppColors.white
                                            .withValues(alpha: 0.7)),
                                    overflow: TextOverflow.ellipsis),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ] else ...[
                    const SizedBox(height: 8),
                    GestureDetector(
                      onTap: () {
                        Navigator.pop(context);
                        _navigateTo(const AuthScreen());
                        _refreshAuth();
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                            color: AppColors.white.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(8)),
                        child: const Row(
                          children: [
                            Icon(Icons.login, color: AppColors.white, size: 16),
                            SizedBox(width: 8),
                            Text('تسجيل الدخول',
                                style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.white)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),

            // ── Quick Access ──
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 20, 20, 8),
              child: Text('الوصول السريع',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted)),
            ),
            _buildDrawerItem(Icons.notifications_outlined, 'الإشعارات',
                () => _navigateTo(const NotificationsScreen())),
            _buildDrawerItem(Icons.visibility_outlined, 'قائمة المراقبة',
                () => _navigateTo(const WatchlistScreen())),
            _buildDrawerItem(Icons.history, 'تاريخ الأسهم',
                () => _navigateTo(const StockHistoryScreen(ticker: 'EGX'))),
            _buildDrawerItem(Icons.tune_outlined, 'التنبيهات',
                () => _navigateTo(const AlertsScreen())),
            _buildDrawerItem(Icons.auto_awesome_outlined, 'تحليل AI',
                () => _navigateTo(const AiAnalysisScreen())),

            const Divider(),

            // ── Markets ──
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 12, 20, 8),
              child: Text('الأسواق',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted)),
            ),
            _buildDrawerItem(
                Icons.trending_up,
                'الأسهم',
                () => setState(() {
                      _currentIndex = 1;
                      Navigator.pop(context);
                    })),
            _buildDrawerItem(
                Icons.currency_bitcoin,
                'الكريبتو',
                () => setState(() {
                      _currentIndex = 2;
                      Navigator.pop(context);
                    })),
            _buildDrawerItem(Icons.swap_horiz, 'العملات',
                () => _navigateTo(const CurrencyScreen())),
            _buildDrawerItem(Icons.toll_outlined, 'الذهب والمعادن',
                () => _navigateTo(const MetalsScreen())),

            const Divider(),

            // ── Analysis & Tools ──
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 12, 20, 8),
              child: Text('التحليل والأدوات',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted)),
            ),
            _buildDrawerItem(Icons.visibility, 'الفرص الاستثمارية',
                () => _navigateTo(const HunterScreen())),
            _buildDrawerItem(Icons.article_outlined, 'الأخبار',
                () => _navigateTo(const NewsScreen())),
            _buildDrawerItem(Icons.lightbulb_outline, 'التوقعات',
                () => _navigateTo(const RecommendationsScreen())),
            _buildDrawerItem(Icons.calculate_outlined, 'حاسبة الزكاة',
                () => _navigateTo(const ZakatScreen())),
            _buildDrawerItem(Icons.analytics_outlined, 'التعلم والاستراتيجيات',
                () => _navigateTo(const LearningBacktestScreen())),
            _buildDrawerItem(Icons.school_outlined, 'أكاديمية M2y التعليمية',
                () => _navigateTo(const AcademyScreen())),
            _buildDrawerItem(Icons.psychology_outlined, 'استبيان تحمّل المخاطر',
                () => _navigateTo(const RiskProfilerScreen())),

            const Divider(),

            // ── Advanced Tools (NEW) ──
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 12, 20, 8),
              child: Text('أدوات متقدمة',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted)),
            ),
            _buildDrawerItem(Icons.grid_view_rounded, 'المسح المتعدد (Screener)',
                () => _navigateTo(const ScreenerScreen())),
            _buildDrawerItem(Icons.candlestick_chart_outlined, 'الشارت التفاعلي',
                () => _navigateTo(const TradingChartScreen(ticker: 'EGX'))),
            _buildDrawerItem(Icons.description_outlined, 'التقارير اليومية',
                () => _navigateTo(const ReportsScreen())),
            _buildDrawerItem(Icons.science_outlined, 'محاكاة التداول',
                () => _navigateTo(const SimulationScreen())),
            _buildDrawerItem(Icons.fact_check_outlined, 'تقييم التوقعات',
                () => _navigateTo(const PredictionPerformanceScreen())),
            _buildDrawerItem(Icons.menu_book_outlined, 'يومية التداول',
                () => _navigateTo(const TradingJournalScreen())),
            _buildDrawerItem(Icons.hub_outlined, 'التلاقي الذكي',
                () => _navigateTo(const SmartConfluenceScreen())),
            _buildDrawerItem(Icons.radar_outlined, 'المراقبة اللحظية',
                () => _navigateTo(const LiveMonitorScreen())),

            const Divider(),

            // ── Account ──
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 12, 20, 8),
              child: Text('الحساب',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted)),
            ),
            _buildDrawerItem(
                Icons.wallet_outlined,
                'المحفظة',
                () => setState(() {
                      _currentIndex = 3;
                      Navigator.pop(context);
                    })),
            _buildDrawerItem(Icons.card_membership_outlined, 'الاشتراكات',
                () => _navigateTo(const SubscriptionScreen())),
            _buildDrawerItem(Icons.settings_outlined, 'الإعدادات',
                () => _navigateTo(const SettingsScreen())),
            _buildDrawerItem(
                Icons.login, _isLoggedIn ? 'تسجيل الخروج' : 'تسجيل الدخول', () {
              if (_isLoggedIn) {
                _handleLogout();
              } else {
                _navigateTo(const AuthScreen()).then((_) => _refreshAuth());
              }
            }),

            const Divider(),

            // ── Website ──
            _buildDrawerItem(Icons.language, 'فتح الموقع',
                () => _navigateTo(const WebViewScreen())),

            const SizedBox(height: 20),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'الإصدار 2.0.0 • © 2024 مساعد الاستثمار',
                style: TextStyle(fontSize: 10, color: AppColors.textMuted),
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  Future<void> _handleLogout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تسجيل الخروج'),
          content: const Text('هل تريد تسجيل الخروج من حسابك؟'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('إلغاء')),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style:
                  ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
              child:
                  const Text('خروج', style: TextStyle(color: AppColors.white)),
            ),
          ],
        ),
      ),
    );
    if (confirm == true) {
      await api.logout();
      setState(() {
        _user = null;
        _isLoggedIn = false;
      });
      if (mounted) Navigator.pop(context); // Close drawer
    }
  }

  String _getUserInitials(User? user) {
    if (user == null) return 'U';
    final String displayName = user.username ?? user.email;
    if (displayName.isEmpty) return 'U';
    return displayName[0].toUpperCase();
  }

  Widget _buildDrawerItem(IconData icon, String label, VoidCallback onTap) {
    return ListTile(
      leading: Icon(icon, size: 20, color: AppColors.textSecondary),
      title: Text(label,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
      onTap: onTap,
      dense: true,
      visualDensity: const VisualDensity(horizontal: -4, vertical: -2),
    );
  }

  Future<void> _navigateTo(Widget screen) async {
    Navigator.pop(context); // Close drawer if open
    await Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
    _refreshAuth(); // Refresh auth state when returning
  }
}

class _MarketOption {
  final String code;
  final String label;

  const _MarketOption(this.code, this.label);
}

// ===========================================================================
// Command Bar Dialog - Quick search & navigation palette
// ===========================================================================
class _CommandBarDialog extends StatefulWidget {
  final void Function(Widget screen) onNavigate;
  final void Function(int index) onSwitchTab;

  const _CommandBarDialog(
      {required this.onNavigate, required this.onSwitchTab});

  @override
  State<_CommandBarDialog> createState() => _CommandBarDialogState();
}

class _CommandBarDialogState extends State<_CommandBarDialog> {
  final _searchCtrl = TextEditingController();
  String _query = '';

  final List<_CommandAction> _actions = [
    // Quick Access
    _CommandAction('قائمة المراقبة', Icons.visibility_outlined,
        Icons.visibility, () => const WatchlistScreen(), null),
    _CommandAction('تاريخ الأسهم', Icons.history, Icons.history,
        () => const StockHistoryScreen(ticker: 'EGX'), null),
    // Markets
    _CommandAction('الأسهم', Icons.trending_up, Icons.trending_up, null, 1),
    _CommandAction('الكريبتو', Icons.currency_bitcoin_outlined,
        Icons.currency_bitcoin, null, 2),
    _CommandAction('العملات', Icons.swap_horiz, Icons.swap_horiz,
        () => const CurrencyScreen(), null),
    _CommandAction('الذهب والمعادن', Icons.toll_outlined, Icons.toll,
        () => const MetalsScreen(), null),
    // Analysis
    _CommandAction('التوقعات', Icons.lightbulb_outline, Icons.lightbulb,
        () => const RecommendationsScreen(), null),
    _CommandAction('حاسبة الزكاة', Icons.calculate_outlined, Icons.calculate,
        () => const ZakatScreen(), null),
    _CommandAction('تحليل AI', Icons.auto_awesome_outlined, Icons.auto_awesome,
        () => const AiAnalysisScreen(), null),
    _CommandAction('التعلم واختبار الاستراتيجيات', Icons.analytics_outlined,
        Icons.analytics, () => const LearningBacktestScreen(), null),
    // Advanced Tools (NEW)
    _CommandAction('المسح المتعدد', Icons.grid_view_outlined, Icons.grid_view,
        () => const ScreenerScreen(), null),
    _CommandAction('الشارت التفاعلي', Icons.candlestick_chart_outlined,
        Icons.candlestick_chart, () => const TradingChartScreen(ticker: 'EGX'), null),
    _CommandAction('التقارير اليومية', Icons.description_outlined,
        Icons.description, () => const ReportsScreen(), null),
    _CommandAction('محاكاة التداول', Icons.science_outlined, Icons.science,
        () => const SimulationScreen(), null),
    _CommandAction('تقييم التوقعات', Icons.fact_check_outlined,
        Icons.fact_check, () => const PredictionPerformanceScreen(), null),
    _CommandAction('يومية التداول', Icons.menu_book_outlined, Icons.menu_book,
        () => const TradingJournalScreen(), null),
    _CommandAction('التلاقي الذكي', Icons.hub_outlined, Icons.hub,
        () => const SmartConfluenceScreen(), null),
    _CommandAction('المراقبة اللحظية', Icons.radar_outlined, Icons.radar,
        () => const LiveMonitorScreen(), null),
    // Account
    _CommandAction('المحفظة', Icons.wallet_outlined, Icons.wallet, null, 3),
    _CommandAction('الاشتراكات', Icons.card_membership_outlined,
        Icons.card_membership, () => const SubscriptionScreen(), null),
    _CommandAction('الإعدادات', Icons.settings_outlined, Icons.settings,
        () => const SettingsScreen(), null),
    _CommandAction('تسجيل الدخول', Icons.login, Icons.login,
        () => const AuthScreen(), null),
    _CommandAction('فتح الموقع', Icons.language, Icons.language,
        () => const WebViewScreen(), null),
  ];

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  List<_CommandAction> get _filtered {
    if (_query.isEmpty) return _actions;
    return _actions.where((a) => a.label.contains(_query)).toList();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: Container(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.7,
            maxWidth: MediaQuery.of(context).size.width * 0.9,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Search field
              Container(
                padding: const EdgeInsets.all(16),
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                      colors: [AppColors.primaryDark, AppColors.primary]),
                  borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.search, color: AppColors.white),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _searchCtrl,
                        autofocus: true,
                        style: const TextStyle(
                            color: AppColors.white, fontSize: 16),
                        decoration: InputDecoration(
                          hintText: 'ابحث أو اختر إجراء...',
                          hintStyle: TextStyle(
                              color: AppColors.white.withValues(alpha: 0.6)),
                          border: InputBorder.none,
                        ),
                        onChanged: (v) => setState(() => _query = v),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: AppColors.white),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),
              // Actions grid
              Flexible(
                child: GridView.count(
                  crossAxisCount: 3,
                  padding: const EdgeInsets.all(16),
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  shrinkWrap: true,
                  childAspectRatio: 1.1,
                  children: filtered.map((action) {
                    return InkWell(
                      onTap: () {
                        if (action.screenBuilder != null) {
                          widget.onNavigate(action.screenBuilder!());
                        } else if (action.tabIndex != null) {
                          widget.onSwitchTab(action.tabIndex!);
                        }
                      },
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: AppColors.primaryMuted,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Icon(action.icon,
                                  size: 22, color: AppColors.primary),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              action.label,
                              style: const TextStyle(
                                  fontSize: 11, fontWeight: FontWeight.w600),
                              textAlign: TextAlign.center,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CommandAction {
  final String label;
  final IconData icon;
  final IconData activeIcon;
  final Widget Function()? screenBuilder;
  final int? tabIndex;

  _CommandAction(this.label, this.icon, this.activeIcon, this.screenBuilder,
      this.tabIndex);
}
