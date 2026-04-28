# Task: Create Flutter Core Configuration Files for EGX Investment Platform

## Files Created

### 1. `pubspec.yaml`
- Flutter SDK >=3.5.0
- All 18 requested dependencies: provider, http, socket_io_client, fl_chart, intl, shared_preferences, google_fonts, cached_network_image, shimmer, pull_to_refresh_flutter3, url_launcher, share_plus, flutter_local_notifications, connectivity_plus, path_provider, json_annotation, flutter_svg, iconsax
- Google Fonts asset declarations for Cairo (4 weights) and Inter (4 weights)
- Flutter lints dev dependency

### 2. `lib/config/constants.dart`
- `ApiConstants` class with all API endpoints matching the Next.js backend
- WebSocket configuration: URL path, event names (market:update, ticker:update, subscribe:ticker, unsubscribe:ticker)
- `baseUrl` via `String.fromEnvironment` for build-time injection
- Helper method `stockEndpoint()` for ticker substitution in URL templates

### 3. `lib/config/colors.dart`
- `AppColors` class with all requested color constants
- Light mode: bg, surface, card, border
- Dark mode: bg (slate-900), surface (slate-800), card, border
- Brand: primary (emerald-600), primaryLight, primaryDark, accent (amber-500)
- Status: profit/loss with light variants for dark mode
- Recommendation badge colors: strongBuy, buy, hold, sell, strongSell
- Text colors for both light and dark modes
- Utility methods: `profitOrLoss()`, `profitForBrightness()`, `lossForBrightness()`, `recommendationColor()` (supports both English and Arabic labels)

### 4. `lib/config/theme.dart`
- `AppTheme` class with full `light` and `dark` ThemeData (Material 3)
- Cairo font for Arabic, Inter for English via Google Fonts
- Complete themes: AppBar, TextTheme (all 15 styles), Card, ElevatedButton, OutlinedButton, TextButton, InputDecoration, BottomNavigationBar, NavigationRail, Chip, Divider, SnackBar, TabBar, BottomSheet, Dialog, FAB
- Light: white bg, emerald-600 primary, slate text
- Dark: slate-900 bg, emerald-500 primary, light text
- Cupertino page transitions for smooth iOS/Android feel

### 5. `lib/config/routes.dart`
- 11 named routes: /, /login, /register, /stocks, /stock/:ticker, /portfolio, /analysis, /gold, /watchlist, /chat, /settings
- `onGenerateRoute` with URI path parsing for dynamic routes
- Navigation helper methods: `goToStockDetail()`, `goToLogin()`, `goToRegister()`, `goHome()`
- 404 fallback route

### 6. `lib/l10n/app_localizations.dart`
- Map-based localization (no code generation needed)
- Arabic (ar) as default, English (en) supported
- `AppLocalizations` class with `languageCode` and `isRtl`/`isLtr`/`textDirection` helpers
- `_AppLocalizationsDelegate` for MaterialApp integration
- 150+ localized strings covering:
  - App info, Navigation labels, Market terms, Stock terms
  - Stock detail, Analysis/Recommendations, Recommendation labels
  - Gold & Currency, Portfolio, Smart Tips, Auth
  - Settings, Actions, Time periods, Errors & States
  - Disclaimer, Risk levels, Sectors, Index names, Currency names, Units

### 7. `lib/app.dart`
- `EgxApp` root widget
- `Consumer<ThemeProvider>` for theme mode switching
- `Consumer<LocaleProvider>` for locale/language switching
- `Directionality` builder for RTL/LTR based on locale
- Material 3 setup with light/dark themes
- Full localization delegates: AppLocalizations + built-in Material/Widgets/Cupertino
- `localeResolutionCallback` defaulting to Arabic
- Route generation via `AppRoutes.onGenerateRoute`

### 8. `lib/main.dart`
- Entry point with `WidgetsFlutterBinding.ensureInitialized()`
- System UI: transparent status bar, portrait-only orientation
- `MultiProvider` with 4 providers: ThemeProvider, LocaleProvider, AuthProvider, MarketProvider

### 9. `analysis_options.yaml`
- Flutter lints package inclusion
- Strict analysis rules: strict-casts, strict-raw-types
- 18 lint rules enabled (const constructors, avoid print, single quotes, etc.)
- Generated file exclusion (*.g.dart, *.freezed.dart)

### 10. Provider Files (supporting app.dart and main.dart)
- `lib/providers/theme_provider.dart`: ThemeMode persistence with SharedPreferences, system brightness tracking
- `lib/providers/locale_provider.dart`: Language persistence, Arabic/English toggle, RTL support
- `lib/providers/auth_provider.dart`: Register/login/session/logout stubs for NextAuth integration
- `lib/providers/market_provider.dart`: HTTP client, all API fetch methods, Socket.IO WebSocket with auto-reconnect

### 11. Placeholder Screen Files (11 files)
- Dashboard, Login, Register, Stocks, StockDetail (with ticker param), Portfolio, Analysis, Gold, Watchlist, Chat, Settings
