# Frontend Audit Report — src/components & src/app

> **Audit Date**: 2026-09-27  
> **Auditor**: Senior Frontend Code Auditor  
> **Project**: M2Y Investment Platform (Next.js 16, App Router)  
> **Scope**: `src/components/**/*.tsx` + `src/app/**/*.tsx` + `src/app/api/**/route.ts` + `src/lib/*.ts`  
> **Methodology**: Static import-graph analysis using Python + ripgrep; cross-referenced against `src/app/page.tsx` render tree.

## 1. Executive Summary

- **Total files audited**: 288 components + 12 app routes/pages + 658 API route handlers + 117 lib modules = **1075 source files**.
- **Total Lines of Code**: 148,563 (components) + 88,776 (API routes) + 43,704 (lib) ≈ **281,043 LOC of TypeScript/TSX** under `src/` (excluding `__tests__`).

### Status Distribution

| Layer | Active ✅ | Dynamic 🟡 | Orphan ⚠️ | Dead ❌ | Duplicate 🔁 | Total |
|-------|---------:|----------:|---------:|--------:|-------------:|------:|
| Components | 199 | 34 | 55 | 0 | ~5 pairs | 288 |
| Lib modules | 96 | 0 | 21 | 0 | ~2 pairs | 117 |
| API routes | 522 | 0 | 136 | 0 | ~3 pairs | 658 |
| **Totals** | **817** | **34** | **212** | **0** | **~10 pairs** | **1063** |

- **Orphan LOC**: 20,494 (components) + 8,929 (lib) + 13,525 (API) = **42,948 LOC of dead/unreferenced code** ≈ **15%** of audited source.

### Top Findings (Top 5)

1. **🚨 136 orphan API routes (~15,525 LOC)** — including all 8 `/api/cron/*` endpoints, all 3 `/api/technical/*` endpoints, all 3 `/api/scraper/*` endpoints, and 4 `/api/maestro/*` endpoints. None are invoked by any frontend file nor by any script under `scripts/`, `vps-service/`, or `crontab.txt`. Likely **dead code** or **external-only entry points** that should be confirmed against external uptime monitors before deletion.

2. **⚠️ 55 orphan component files (~20,494 LOC)** — the largest single contributor is `src/components/recommendations/AiRecommendations.tsx` (2,209 LOC) — a full AI-recommendations panel that was superseded by `MarketAnalysisView`'s persona tabs but never deleted. Also notable: the entire `src/components/studio/` directory (9 files, ~3,200 LOC) — a visual node-based flow canvas — is **fully orphaned**.

3. **🔁 Real duplicate pairs**: `share/ShareButton.tsx` vs `shared/ShareButton.tsx` (583 vs 449 LOC — both implement sharing with different UI shells); `portfolio/WealthCharts.tsx` vs `admin/WealthCharts.tsx` (346 vs 465 LOC — same chart family, different data sources); `StockScreener.tsx` (legacy, 590 LOC) vs `StockScreenerAdvanced.tsx` (active, 2,083 LOC).

4. **🏚️ Layout migration leftover**: `src/components/layout/Sidebar.tsx` (644 LOC) is the **former left-sidebar navigation** that was replaced by `TopBar.tsx` (per the comment "بديل الـ Sidebar القديم" at TopBar.tsx:6). 0 importers — fully orphaned. Same situation: `news-feed-widget.tsx` (216 LOC) — an early-prototype news widget that was superseded by `news/NewsFeedView.tsx`. (Note: `auto-analysis-widget.tsx` and `eid-predictions-widget.tsx` are root-level widgets too, but both ARE imported by `DashboardView.tsx` — they're ACTIVE, not orphan.)

5. **🧪 8 TODOs + 5 `@deprecated` markers** — all clustered in `src/lib/egx-db.ts` (8 `// TODO: Implement ...` stubs for currency/gold/analysis APIs that just throw or return null), plus `@deprecated` markers in `lib/new-db.ts`, `lib/finance-db.ts`, and 2 sites in `lib/egx-db.ts` referring to the removed `custom.db`.

### Active Coverage

- **Render-tree-reachable**: 233 of 288 components (80%) are loaded via `src/app/page.tsx` (either static import or `dynamic()` + `withErrorBoundary`).
- **API reachable from frontend**: 522 of 658 (79%) routes are referenced via `fetch('/api/...')` somewhere in `src/` (excluding `src/middleware.ts` public-path config + route files themselves).
- **Lib reachable**: 96 of 117 (82%) lib modules are imported by at least one other file.

## 2. Inventory Tables

### 2.1 Components (src/components)

> Mode: `client` = has `'use client'` directive; `none` = no directive (server-compatible).  
> Status: ✅ ACTIVE = imported by ≥1 file; 🟡 DYNAMIC = loaded via `next/dynamic` from `page.tsx`; ⚠️ ORPHAN = 0 importers found anywhere in `src/`.

| File | LOC | Mode | Exports (first 3) | Importers | Used By | Status |
|------|----:|------|-------------------|----------:|---------|--------|
| `FeedbackWidget.tsx` | 232 | client | `export function FeedbackWidget() {~export default FeedbackWidget;` | 1 | app/layout.tsx | ✅ ACTIVE |
| `Providers.tsx` | 33 | client | `export function Providers({ children }: { children: React.ReactNode }) {
` | 1 | app/layout.tsx | ✅ ACTIVE |
| `auto-analysis-widget.tsx` | 259 | client | `export function AutoAnalysisWidget() {~export default AutoAnalysisWidget;` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `eid-predictions-widget.tsx` | 255 | client | `export function EidPredictionsWidget() {~export default EidPredictionsWidget;` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `news-feed-widget.tsx` | 216 | client | `export function NewsFeedWidget() {~export default NewsFeedWidget;` | 0 | _(none)_ | ⚠️ ORPHAN |
| `about/AboutView.tsx` | 384 | client | `export function AboutView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `academy/AcademyEncyclopedia.tsx` | 1791 | client | `export function AcademyEncyclopedia() {~export default AcademyEncyclopedia;` | 1 | components/academy/AcademyView.tsx | ✅ ACTIVE |
| `academy/AcademyView.tsx` | 73 | client | `export function AcademyView() {~export default AcademyView;` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `academy/CandlestickSimulator.tsx` | 944 | client | `export interface CandlePattern {~export const CANDLE_PATTERNS: CandlePattern[] =` | 1 | components/academy/AcademyView.tsx | ✅ ACTIVE |
| `academy/LessonPDFExporter.tsx` | 587 | client | `export interface LessonSection {~export interface QuizQuestion {~export interfac` | 1 | components/academy/AcademyEncyclopedia.tsx | ✅ ACTIVE |
| `academy/PaperTradingWorkstation.tsx` | 1550 | none | `export function PaperTradingWorkstation() {~export default PaperTradingWorkstati` | 1 | components/academy/AcademyView.tsx | ✅ ACTIVE |
| `academy/StrategySandbox.tsx` | 2188 | client | `export function StrategySandbox() {~export default StrategySandbox;` | 1 | components/academy/AcademyView.tsx | ✅ ACTIVE |
| `admin/AdminView.tsx` | 2109 | client | `export interface SystemIssue {~export function AdminView() {` | 2 | app/page.tsx, components/admin/SystemProblemsTab.tsx | ✅ ACTIVE |
| `admin/BacktestTab.tsx` | 650 | client | `export function BacktestTab() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/CryptoAdminPanel.tsx` | 367 | client | `export function CryptoAdminPanel() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/CryptoPredictionGenerator.tsx` | 593 | client | `export function CryptoPredictionGenerator() {~export default CryptoPredictionGen` | 0 | _(none)_ | ⚠️ ORPHAN |
| `admin/DataEngineTab.tsx` | 634 | client | `export function DataEngineTab() {
` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/DataScraperControl.tsx` | 533 | client | `export function DataScraperControl() {
` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/DatabaseManagerFull.tsx` | 3284 | client | `export function DatabaseManagerFull() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/DbBackupPanel.tsx` | 869 | client | `export function DbBackupPanel() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/EngineSettingsTab.tsx` | 576 | client | `export function EngineSettingsTab() {~export default EngineSettingsTab;` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/EnginesStatusTab.tsx` | 737 | client | `export function EnginesStatusTab() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/ForexTab.tsx` | 300 | client | `export function ForexTab() {
` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/GoldSilverTab.tsx` | 258 | client | `export function GoldSilverTab() {
` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/HumanRecommendationsAdmin.tsx` | 1024 | client | `export function HumanRecommendationsAdmin() {~export default HumanRecommendation` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/MultiMarketTab.tsx` | 246 | client | `export function MultiMarketTab() {
` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/NewsManagementTab.tsx` | 1040 | client | `export function NewsManagementTab() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/NotebookAdminTab.tsx` | 524 | client | `export function NotebookAdminTab() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/OptimizerParamsPanel.tsx` | 372 | client | `export function OptimizerParamsPanel({ onClose }: { onClose: () => void }) {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `admin/PromoCodesAdmin.tsx` | 592 | client | `export function PromoCodesAdmin() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/PurgeCacheButton.tsx` | 261 | client | `export function PurgeCacheButton() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/RegimeDetectionWidget.tsx` | 126 | client | `export function RegimeDetectionWidget() {
` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/RowEditorModal.tsx` | 286 | client | `export interface ColumnSchema {~export function RowEditorModal({` | 0 | _(none)_ | ⚠️ ORPHAN |
| `admin/SectorClassificationAdmin.tsx` | 274 | client | `export function SectorClassificationAdmin() {
` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/SuperLearningSystem.tsx` | 2480 | client | `export function SuperLearningSystem() {~export default SuperLearningSystem;` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/SystemControlPanel.tsx` | 465 | client | `export function SystemControlPanel() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/SystemMonitorPanel.tsx` | 504 | client | `export function SystemMonitorPanel() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/SystemProblemsTab.tsx` | 488 | client | `export function SystemProblemsTab({~export default SystemProblemsTab;` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/SystemTopologyGraph.tsx` | 850 | client | `export interface TopologyData {~export function getStatusColor(status: string) {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `admin/TelegramTab.tsx` | 2200 | client | `export function TelegramTab() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/UserManagementPanel.tsx` | 599 | client | `export function UserManagementPanel() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/UsersManagement.tsx` | 1086 | client | `export function UsersManagement() {
~export default UsersManagement;
` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `admin/WealthCharts.tsx` | 465 | client | `export function WealthCharts() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `advanced-analysis/CandlestickWidget.tsx` | 228 | client | `export function CandlestickWidget({ ticker, currentPrice, onAnalyze, compact = f` | 0 | _(none)_ | ⚠️ ORPHAN |
| `advanced-analysis/FibonacciWidget.tsx` | 149 | client | `export function FibonacciWidget({ ticker, currentPrice, compact = false }: Fibon` | 0 | _(none)_ | ⚠️ ORPHAN |
| `advanced-analysis/SpecialistAnalysisView.tsx` | 1061 | client | `export function SpecialistAnalysisView() {~export default SpecialistAnalysisView` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `ai/AIAnalysisWidget.tsx` | 421 | client | `export function AIAnalysisWidget({ ticker, stockName, currentPrice }: AIAnalysis` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `ai/AIAssistantChat.tsx` | 332 | client | `export function AIAssistantChat() {
~export default AIAssistantChat;
` | 2 | components/ai/AIView.tsx, components/ai/index.ts | ✅ ACTIVE |
| `ai/AIView.tsx` | 325 | client | `export function AIView({ initialTab = 'chat' }: AIViewProps) {~export default AI` | 1 | components/ai/index.ts | ✅ ACTIVE |
| `ai/FloatingAssistant.tsx` | 304 | client | `export function FloatingAssistant() {~export default FloatingAssistant;` | 1 | app/page.tsx | ✅ ACTIVE |
| `ai/index.ts` | 3 | none | `export { AIAssistantChat } from './AIAssistantChat';
~export { AIView } from './` | 0 | _(none)_ | ⚠️ ORPHAN |
| `alerts/AlertsCenterView.tsx` | 686 | client | `export function AlertsCenterView() {
` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `alerts/SmartAlertsPanel.tsx` | 319 | client | `export function SmartAlertsPanel() {` | 1 | components/memory/TradingMemoryView.tsx | ✅ ACTIVE |
| `analysis/AlertPanel.tsx` | 384 | client | `export function AlertPanel({ ticker, open, onClose }: AlertPanelProps) {` | 1 | components/analysis/SingleStockAnalysisView.tsx | ✅ ACTIVE |
| `analysis/AnalysisFlowDiagram.tsx` | 326 | client | `export function AnalysisFlowDiagram({ persona, className }: Props) {~export defa` | 0 | _(none)_ | ⚠️ ORPHAN |
| `analysis/ChartControls.tsx` | 142 | client | `export default function ChartControls({` | 1 | components/analysis/SingleStockAnalysisView.tsx | ✅ ACTIVE |
| `analysis/ExpertRecommendationsPanel.tsx` | 1598 | client | `export function ExpertRecommendationsPanel({ market }: { market: MarketType }) {` | 8 | components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx, components/analysis/market-analysis/LiveTrackingTab.tsx | ✅ ACTIVE |
| `analysis/InstitutionalDecisionPanel.tsx` | 685 | client | `export interface MakerState {~export interface FlightState {~export interface Pr` | 1 | components/analysis/SingleStockAnalysisView.tsx | ✅ ACTIVE |
| `analysis/InteractiveChart.tsx` | 1677 | client | `export function InteractiveChart(props: FullChartProps) {` | 1 | components/analysis/SingleStockAnalysisView.tsx | ✅ ACTIVE |
| `analysis/LiveDashboard.tsx` | 123 | client | `export function HeartbeatStatusBar() {~export function WhaleAlertListener() {~ex` | 1 | components/analysis/SingleStockAnalysisView.tsx | ✅ ACTIVE |
| `analysis/MarketAnalysisView.tsx` | 273 | client | `export function MarketAnalysisView({ initialMarket }: MarketAnalysisViewProps = ` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `analysis/MarketDepthLiquidityWidget.tsx` | 437 | client | `export function MarketDepthLiquidityWidget({ ticker, compact = false }: WidgetPr` | 1 | components/predictions/MakerRadarTab.tsx | ✅ ACTIVE |
| `analysis/SingleStockAnalysisView.tsx` | 1315 | client | `export interface SingleStockAnalysisViewProps {~export function SingleStockAnaly` | 3 | components/analysis/TradingChartView.tsx, components/analysis/market-analysis/PersonaTab.tsx, components/crypto/CryptoTradingChartView.tsx | ✅ ACTIVE |
| `analysis/TradingChartView.tsx` | 314 | client | `export function TradingChartView({ initialTicker }: TradingChartViewProps) {` | 3 | app/page.tsx, components/analysis/market-analysis/PersonaTab.tsx, components/portfolio/PositionDeepDiveDrawer.tsx | ✅ ACTIVE |
| `analysis/UnifiedAnalysisView.tsx` | 562 | client | `export default function UnifiedAnalysisView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `auth/AuthGate.tsx` | 449 | client | `export function AuthGate({ children }: { children: React.ReactNode }) {` | 1 | app/page.tsx | ✅ ACTIVE |
| `auth/AuthView.tsx` | 638 | client | `export function AuthView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `auth/LoginPromptModal.tsx` | 285 | client | `export function LoginPromptModal() {` | 1 | components/auth/AuthGate.tsx | ✅ ACTIVE |
| `auth/SessionExpiredModal.tsx` | 145 | client | `export function SessionExpiredModal() {` | 1 | components/Providers.tsx | ✅ ACTIVE |
| `backtesting/EGXBacktestDashboard.tsx` | 443 | client | `export function EGXBacktestDashboard() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `crypto/CryptoAdditionalViews.tsx` | 40 | client | `export function CryptoLearningView() {~export function CryptoSimulationView() {` | 1 | app/page.tsx | ✅ ACTIVE |
| `crypto/CryptoAdvancedAnalysisView.tsx` | 684 | client | `export default function CryptoAdvancedAnalysisView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `crypto/CryptoLearningView.tsx` | 1106 | client | `export function CryptoLearningView() {` | 1 | components/crypto/CryptoAdditionalViews.tsx | ✅ ACTIVE |
| `crypto/CryptoPortfolioView.tsx` | 641 | client | `export function CryptoPortfolioView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `crypto/CryptoPredictionTrackingView.tsx` | 461 | client | `export default function CryptoPredictionTrackingView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `crypto/CryptoScreenerView.tsx` | 677 | client | `export default function CryptoScreenerView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `crypto/CryptoSimulationView.tsx` | 1941 | client | `export function CryptoSimulationView() {` | 1 | components/crypto/CryptoAdditionalViews.tsx | ✅ ACTIVE |
| `crypto/CryptoTradingChartView.tsx` | 275 | client | `export function CryptoTradingChartView({~export default CryptoTradingChartView;` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `daily-picks/DailyPicksPoster.tsx` | 322 | client | `export function DailyPicksPoster() {` | 8 | components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx, components/analysis/market-analysis/LiveTrackingTab.tsx | ✅ ACTIVE |
| `dashboard/AssetPreferenceOnboarding.tsx` | 184 | client | `export function AssetPreferenceOnboarding() {~export default AssetPreferenceOnbo` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/CryptoSignalsWidget.tsx` | 233 | client | `export function CryptoSignalsWidget() {
` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/DashboardView.tsx` | 518 | client | `export function DashboardView() {` | 1 | app/page.tsx | ✅ ACTIVE |
| `dashboard/DevelopmentNotice.tsx` | 33 | client | `export function DevelopmentNotice() {
` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/IndexCards.tsx` | 117 | client | `export function IndexCards() {
` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/IntradayPressurePanel.tsx` | 361 | client | `export function IntradayPressurePanel({ initialTicker = 'COMI' }: Props) {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `dashboard/InvestorsFlowPanel.tsx` | 513 | client | `export function InvestorsFlowPanel() {` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/LiquidityFlowPanel.tsx` | 439 | client | `export function LiquidityFlowPanel() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `dashboard/LiveMonitor.tsx` | 1353 | client | `export function LiveMonitor() {~export default LiveMonitor;` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `dashboard/LiveStockTicker.tsx` | 294 | client | `export function LiveStockTicker() {~export default LiveStockTicker;` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/MaestroWidget.tsx` | 168 | client | `export function MaestroWidget() {` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/MarketPulseWidget.tsx` | 874 | client | `export function MarketPulseWidget() {~export default MarketPulseWidget;` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/MarketSentiment.tsx` | 197 | client | `export function MarketSentiment() {
` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/MarketSummary.tsx` | 81 | client | `export function MarketSummary() {
` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/MultiMarketWidget.tsx` | 610 | client | `export function MultiMarketWidget() {` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/PinnableWidget.tsx` | 68 | client | `export function PinnableWidget({ id, title, children, className }: PinnableWidge` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/PredictionsBacktestTable.tsx` | 533 | client | `export function PredictionsBacktestTable() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `dashboard/RealtimeTicker.tsx` | 192 | client | `export function RealtimeTicker() {` | 1 | app/page.tsx | ✅ ACTIVE |
| `dashboard/SafeWidget.tsx` | 80 | client | `export class SafeWidget extends Component<Props, State> {
~export function withS` | 2 | components/dashboard/DashboardView.tsx, components/predictions/MakerRadarTab.tsx | ✅ ACTIVE |
| `dashboard/SeasonalitySignalsWidget.tsx` | 222 | client | `export function SeasonalitySignalsWidget() {` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `dashboard/TopMovers.tsx` | 151 | client | `export function TopMovers() {
` | 1 | components/dashboard/DashboardView.tsx | ✅ ACTIVE |
| `deal-advisor/DealAdvisorPanel.tsx` | 831 | client | `export function DealAdvisorPanel({` | 1 | components/analysis/SingleStockAnalysisView.tsx | ✅ ACTIVE |
| `devil/DevilsCalendar.tsx` | 193 | client | `export function DevilsCalendar() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `devil/DevilsCard.tsx` | 314 | client | `export function DevilsCard({ ticker }: DevilsCardProps) {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `devil/MarketMood.tsx` | 186 | client | `export function MarketMood({ compact = false }: { compact?: boolean }) {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `devil/ScenarioMatrix.tsx` | 182 | client | `export function ScenarioMatrix({ ticker }: ScenarioMatrixProps) {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `help/PlatformGuide.tsx` | 486 | client | `export function PlatformGuide({ open, onOpenChange }: PlatformGuideProps) {~expo` | 2 | app/page.tsx, components/layout/Sidebar.tsx | ✅ ACTIVE |
| `intelligence/WatchlistIntelligenceSection.tsx` | 501 | client | `export function WatchlistIntelligenceSection() {
` | 1 | components/watchlist/EnhancedWatchlistView.tsx | ✅ ACTIVE |
| `journal/TradingJournalView.tsx` | 586 | client | `export function TradingJournalView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `layout/ExchangeSelector.tsx` | 76 | client | `export function ExchangeSelector({ compact = false, className }: ExchangeSelecto` | 2 | components/analysis/TradingChartView.tsx, components/layout/Sidebar.tsx | ✅ ACTIVE |
| `layout/Footer.tsx` | 131 | client | `export function Footer() {` | 1 | app/page.tsx | ✅ ACTIVE |
| `layout/Header.tsx` | 226 | client | `export function Header({ title, subtitle }: HeaderProps) {` | 4 | components/auth/AuthView.tsx, components/dashboard/DashboardView.tsx, components/settings/SettingsView.tsx | ✅ ACTIVE |
| `layout/MobileMoreSheet.tsx` | 235 | client | `export function useMobileMoreSheet() {~export function MobileMoreButton({ classN` | 1 | components/layout/Header.tsx | ✅ ACTIVE |
| `layout/MobileNav.tsx` | 83 | client | `export function MobileNav() {` | 1 | app/page.tsx | ✅ ACTIVE |
| `layout/Sidebar.tsx` | 644 | client | `export function Sidebar() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `layout/TopBar.tsx` | 525 | client | `export function TopBar() {` | 1 | app/page.tsx | ✅ ACTIVE |
| `learning/LearningView.tsx` | 1063 | client | `export function LearningView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `learning/LearningVisuals.tsx` | 796 | client | `export function CandlestickDiagram({ variant = 'bullish' }: { variant?: 'bullish` | 1 | components/learning/LearningView.tsx | ✅ ACTIVE |
| `learning/MathRenderer.tsx` | 157 | client | `export function MathExpression({ expression, block = false }: { expression: stri` | 2 | components/crypto/CryptoLearningView.tsx, components/learning/LearningView.tsx | ✅ ACTIVE |
| `legal/DisclaimerBanner.tsx` | 124 | client | `export function DisclaimerBanner() {~export function LegalDisclaimerFooter() {~e` | 5 | components/crypto/CryptoAdvancedAnalysisView.tsx, components/crypto/CryptoPredictionTrackingView.tsx, components/crypto/CryptoScreenerView.tsx | ✅ ACTIVE |
| `market/ExpertPredictionsImageCard.tsx` | 525 | client | `export interface ExpertPick {~export interface ExpertPredictionsImageCardProps {` | 8 | components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx, components/analysis/market-analysis/LiveTrackingTab.tsx | ✅ ACTIVE |
| `market/ImageCardExport.tsx` | 228 | client | `export function ImageCardExport({` | 10 | components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx, components/analysis/market-analysis/LiveTrackingTab.tsx | ✅ ACTIVE |
| `market/MarketStatusExport.tsx` | 293 | client | `export function MarketStatusExport() {` | 8 | components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx, components/analysis/market-analysis/LiveTrackingTab.tsx | ✅ ACTIVE |
| `market/MarketStatusImageCard.tsx` | 766 | client | `export interface MarketStatusStock {~export interface MarketStatusImageCardProps` | 1 | components/market/MarketStatusExport.tsx | ✅ ACTIVE |
| `market/PersonaImageCard.tsx` | 603 | client | `export interface PersonaPick {~export interface PersonaImageCardProps {~export c` | 8 | components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx, components/analysis/market-analysis/LiveTrackingTab.tsx | ✅ ACTIVE |
| `market/PredictionsImageCard.tsx` | 434 | client | `export interface PredictionPick {~export interface PredictionsImageCardProps {~e` | 8 | components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx, components/analysis/market-analysis/LiveTrackingTab.tsx | ✅ ACTIVE |
| `market/StockLeagueImageCard.tsx` | 326 | client | `export interface LeagueEntry {~export type ReportPeriod = 'daily' \| 'weekly' \| '` | 2 | app/admin/honest-predictions/page.tsx, app/admin/reports/page.tsx | ✅ ACTIVE |
| `market/TopTradesImageCard.tsx` | 208 | client | `export interface TopTrade {~export function TopTradesImageCard({ trades, monthNa` | 1 | app/admin/honest-predictions/page.tsx | ✅ ACTIVE |
| `memory/ExpertMemoryPanel.tsx` | 375 | client | `export function ExpertMemoryPanel({~export function ExpertMemoryBadge({ ticker }` | 1 | components/memory/TradingMemoryView.tsx | ✅ ACTIVE |
| `memory/TradingMemoryView.tsx` | 326 | client | `export function TradingMemoryView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `news/NewsFeedView.tsx` | 801 | client | `export interface NewsItem {~export interface NewsFeedData {~export function News` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `notifications/CentralAlertMonitor.tsx` | 276 | client | `export function CentralAlertMonitor() {` | 1 | app/page.tsx | ✅ ACTIVE |
| `notifications/NotificationBell.tsx` | 182 | client | `export function NotificationBell({ onOpenPanel }: NotificationBellProps) {
` | 1 | components/layout/Sidebar.tsx | ✅ ACTIVE |
| `notifications/NotificationCenter.tsx` | 310 | client | `export function NotificationCenter() {` | 2 | app/page.tsx, components/layout/TopBar.tsx | ✅ ACTIVE |
| `notifications/RoboNotifierToggle.tsx` | 109 | client | `export function RoboNotifierToggle() {` | 2 | app/page.tsx, components/layout/TopBar.tsx | ✅ ACTIVE |
| `persona/DynamicRiskProfilerModal.tsx` | 325 | client | `export function DynamicRiskProfilerModal({~export default DynamicRiskProfilerMod` | 2 | components/portfolio/BagHolderRescuePanel.tsx, components/portfolio/EnhancedPortfolioView.tsx | ✅ ACTIVE |
| `persona/PersonaSelector.tsx` | 273 | client | `export function PersonaSelector({ 
~export function usePersona() {
` | 1 | components/settings/SettingsView.tsx | ✅ ACTIVE |
| `portfolio/AdvancedPortfolioManager.tsx` | 578 | client | `export function AdvancedPortfolioManager() {
~export default AdvancedPortfolioMa` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `portfolio/BagHolderRescuePanel.tsx` | 595 | client | `export function BagHolderRescuePanel({` | 1 | components/portfolio/EnhancedPortfolioView.tsx | ✅ ACTIVE |
| `portfolio/EnhancedPortfolioView.tsx` | 3153 | client | `export function EnhancedPortfolioView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `portfolio/MasterPortfolioSummary.tsx` | 245 | client | `export function MasterPortfolioSummary({ userId, onSubPortfoliosLoaded }: Master` | 1 | components/portfolio/EnhancedPortfolioView.tsx | ✅ ACTIVE |
| `portfolio/MultiPortfolioSelector.tsx` | 658 | client | `export interface PortfolioAccount {~export const COLOR_OPTIONS = [~export functi` | 2 | components/portfolio/EnhancedPortfolioView.tsx, components/portfolio/MasterPortfolioSummary.tsx | ✅ ACTIVE |
| `portfolio/PortfolioIntelligencePanel.tsx` | 400 | client | `export function PortfolioIntelligencePanel() {` | 1 | components/memory/TradingMemoryView.tsx | ✅ ACTIVE |
| `portfolio/PositionDeepDiveDrawer.tsx` | 223 | client | `export const PositionDeepDiveDrawer: React.FC<PositionDeepDiveDrawerProps> = ({` | 0 | _(none)_ | ⚠️ ORPHAN |
| `portfolio/RealReturnPanel.tsx` | 247 | client | `export function RealReturnPanel() {` | 1 | components/portfolio/EnhancedPortfolioView.tsx | ✅ ACTIVE |
| `portfolio/RiskManagementBar.tsx` | 98 | client | `export const RiskManagementBar: React.FC<RiskManagementBarProps> = ({` | 0 | _(none)_ | ⚠️ ORPHAN |
| `portfolio/RiskProfilerQuiz.tsx` | 541 | client | `export interface CurrentAllocation {~export function RiskProfilerQuiz({ currentA` | 1 | components/portfolio/EnhancedPortfolioView.tsx | ✅ ACTIVE |
| `portfolio/RoboAdvisorPanel.tsx` | 1286 | client | `export function RoboAdvisorPanel({ assets, rebalanceAlerts }: RoboAdvisorPanelPr` | 1 | components/portfolio/EnhancedPortfolioView.tsx | ✅ ACTIVE |
| `portfolio/SmartAssistantPanel.tsx` | 563 | client | `export function SmartAssistantPanel() {` | 1 | components/memory/TradingMemoryView.tsx | ✅ ACTIVE |
| `portfolio/StockSearchDropdown.tsx` | 122 | client | `export interface StockSearchResult {~export function StockSearchDropdown({~expor` | 2 | components/academy/PaperTradingWorkstation.tsx, components/portfolio/BagHolderRescuePanel.tsx | ✅ ACTIVE |
| `portfolio/TopUpRecommendationsPanel.tsx` | 430 | client | `export function TopUpRecommendationsPanel() {` | 1 | components/portfolio/EnhancedPortfolioView.tsx | ✅ ACTIVE |
| `portfolio/UnifiedHoldingsTable.tsx` | 381 | client | `export interface HoldingItem {~export interface WatchlistItem {~export const Uni` | 0 | _(none)_ | ⚠️ ORPHAN |
| `portfolio/WealthCharts.tsx` | 346 | client | `export const WealthCharts: React.FC = () => {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `predictions/DualTrackPredictionsView.tsx` | 613 | client | `export function DualTrackPredictionsView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `predictions/MakerRadarTab.tsx` | 2282 | client | `export function MakerRadarTab({ market = 'EGX' }: MakerRadarTabProps) {~export d` | 2 | app/page.tsx, components/analysis/MarketAnalysisView.tsx | ✅ ACTIVE |
| `predictions/PicksManagementView.tsx` | 770 | client | `export function PicksManagementView() {~export default PicksManagementView;` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `predictions/PredictionTrackingDashboard.tsx` | 2024 | client | `export function PredictionTrackingDashboard({~export default PredictionTrackingD` | 2 | components/advanced-analysis/SpecialistAnalysisView.tsx, components/analysis/MarketAnalysisView.tsx | ✅ ACTIVE |
| `predictions/PredictionTrackingView.tsx` | 657 | client | `export function PredictionTrackingView() {~export default PredictionTrackingView` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `publishing/QuickPublishButton.tsx` | 335 | client | `export function QuickPublishButton({` | 2 | components/stocks/StockAdvancedAnalysisView.tsx, components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `publishing/UserPublishingView.tsx` | 739 | client | `export function UserPublishingView() {
~export default UserPublishingView;
` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `recommendations/AiRecommendations.tsx` | 2209 | client | `export function AiRecommendations() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `recommendations/PublishedPredictions.tsx` | 177 | client | `export function PublishedPredictions() {~export default PublishedPredictions;` | 0 | _(none)_ | ⚠️ ORPHAN |
| `recommendations/RecommendationHistory.tsx` | 244 | client | `export function RecommendationHistory({ limit = 20, showShareButton = true }: Re` | 0 | _(none)_ | ⚠️ ORPHAN |
| `recommendations/RecommendationMonitoring.tsx` | 565 | client | `export function RecommendationMonitoring() {
` | 0 | _(none)_ | ⚠️ ORPHAN |
| `recommendations/RefreshAnalyticsButton.tsx` | 117 | client | `export function RefreshAnalyticsButton({` | 10 | components/analysis/MarketAnalysisView.tsx, components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx | ✅ ACTIVE |
| `recommendations/SocialPostView.tsx` | 304 | client | `export function SocialPostView({ onStockClick }: SocialPostViewProps) {~export d` | 0 | _(none)_ | ⚠️ ORPHAN |
| `reports/DailyMarketReport.tsx` | 699 | client | `export function DailyMarketReport({ printMode = false }: DailyMarketReportProps)` | 1 | components/reports/ReportsView.tsx | ✅ ACTIVE |
| `reports/DataManager.tsx` | 374 | client | `export function DataManager() {` | 1 | components/settings/SettingsView.tsx | ✅ ACTIVE |
| `reports/ExecutiveReportView.tsx` | 2080 | client | `export type ReportTimeframe = 1 \| 2 \| 7 \| 14 \| 30 \| 60 \| 90 \| 180 \| 365 \| 999 \| ` | 1 | components/analysis/MarketAnalysisView.tsx | ✅ ACTIVE |
| `reports/ReportsView.tsx` | 1178 | client | `export function ReportsView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `reports/StockAnalysisReport.tsx` | 1005 | client | `export function StockAnalysisReport() {
` | 1 | components/reports/ReportsView.tsx | ✅ ACTIVE |
| `screener/BottomPanel.tsx` | 976 | client | `export interface ScreenerStock {~export interface BottomPanelProps {~export func` | 0 | _(none)_ | ⚠️ ORPHAN |
| `screener/ChartCard.tsx` | 712 | client | `export interface ChartCardProps {~export function ChartCard({~export default Cha` | 0 | _(none)_ | ⚠️ ORPHAN |
| `screener/ComparisonChartCard.tsx` | 567 | client | `export interface StockListItem {~export function ComparisonChartCard({~export de` | 0 | _(none)_ | ⚠️ ORPHAN |
| `screener/StockScreener.tsx` | 590 | client | `export function StockScreener() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `screener/StockScreenerAdvanced.tsx` | 2083 | client | `export function StockScreenerAdvanced({ initialTab = 'advanced', initialMarket }` | 2 | app/page.tsx, components/predictions/PredictionTrackingDashboard.tsx | ✅ ACTIVE |
| `screener/UnifiedScreenerView.tsx` | 534 | client | `export function UnifiedScreenerView() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `screener/WatchlistSidebar.tsx` | 292 | client | `export interface WatchlistStock {~export interface WatchlistSidebarProps {~expor` | 0 | _(none)_ | ⚠️ ORPHAN |
| `screener/chartIndicators.ts` | 211 | none | `export interface OhlcvPoint {~export function calcSMA(data: number[], period: nu` | 4 | components/screener/BottomPanel.tsx, components/screener/ChartCard.tsx, components/screener/ComparisonChartCard.tsx | ✅ ACTIVE |
| `seasonality/SeasonalityDashboard.tsx` | 300 | client | `export function SeasonalityDashboard() {
` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `settings/SettingsView.tsx` | 232 | client | `export function SettingsView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `share/ShareButton.tsx` | 583 | client | `export interface ShareStockData {~export function ShareButton({` | 9 | components/dashboard/DashboardView.tsx, components/learning/LearningView.tsx, components/recommendations/AiRecommendations.tsx | ✅ ACTIVE |
| `shared/ErrorBoundary.tsx` | 290 | client | `export interface ErrorBoundaryProps {~export class ErrorBoundary extends Compone` | 3 | __tests__/ErrorBoundary.test.tsx, app/page.tsx, components/admin/AdminView.tsx | ✅ ACTIVE |
| `shared/ExpertIntelligencePanel.tsx` | 780 | client | `export function ExpertIntelligencePanel({~export default ExpertIntelligencePanel` | 9 | components/advanced-analysis/SpecialistAnalysisView.tsx, components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx | ✅ ACTIVE |
| `shared/LazyTabLoader.tsx` | 76 | client | `export function LazyTabLoader({~export function LazyInlineLoader({ label = 'العن` | 2 | app/page.tsx, components/admin/AdminView.tsx | ✅ ACTIVE |
| `shared/MarketSelector.tsx` | 64 | client | `export function MarketSelector({` | 10 | components/analysis/MarketAnalysisView.tsx, components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx | ✅ ACTIVE |
| `shared/ShareButton.tsx` | 449 | client | `export function ShareButton({~export function ShareableCard({~export default Sha` | 2 | components/ai/AIAnalysisWidget.tsx, components/stocks/StockAdvancedAnalysisView.tsx | ✅ ACTIVE |
| `shared/StockSearchSelector.tsx` | 252 | client | `export function StockSearchSelector({` | 2 | components/analysis/SingleStockAnalysisView.tsx, components/analysis/TradingChartView.tsx | ✅ ACTIVE |
| `shared/UnifiedPublishButton.tsx` | 367 | client | `export interface UnifiedPublishButtonProps {~export function UnifiedPublishButto` | 20 | components/analysis/ExpertRecommendationsPanel.tsx, components/analysis/market-analysis/LiveTrackingTab.tsx, components/analysis/market-analysis/SectorTrackingTab.tsx | ✅ ACTIVE |
| `shared/UnifiedTable.tsx` | 697 | client | `export interface Column<T> {~export interface UnifiedTableProps<T> {~export func` | 41 | components/admin/CryptoPredictionGenerator.tsx, components/admin/DatabaseManagerFull.tsx, components/admin/HumanRecommendationsAdmin.tsx | ✅ ACTIVE |
| `simulation/SimulationView.tsx` | 1913 | client | `export function SimulationView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `smart-assistant/SmartConfluenceView.tsx` | 275 | client | `export function SmartConfluenceView() {~export default SmartConfluenceView;` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `smart-tips/SmartTip.tsx` | 528 | client | `export function SmartTip({~export function TipOfTheDay({ className }: { classNam` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `sniper/OpportunityCard.tsx` | 357 | client | `export function OpportunityCard({ opportunity: opp }: OpportunityCardProps) {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `sniper/PerformanceTracker.tsx` | 463 | client | `export function PerformanceTracker() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `stocks/CalculationBreakdown.tsx` | 602 | client | `export function CalculationBreakdown() {
` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `stocks/ComprehensiveStockAnalysis.tsx` | 1374 | client | `export function ComprehensiveStockAnalysis({ ticker, market = 'EGX' }: Props) {` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `stocks/DataCoverageBanner.tsx` | 209 | client | `export function DataCoverageBanner() {
` | 0 | _(none)_ | ⚠️ ORPHAN |
| `stocks/DeepAnalysis.tsx` | 1148 | client | `export function DeepAnalysis() {
` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `stocks/DeltaVolumeBar.tsx` | 229 | client | `export function DeltaVolumeBar({ ticker }: { ticker: string }) {` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `stocks/GateAnalysisView.tsx` | 215 | client | `export default function GateAnalysisView({ ticker, currentPrice, stockName }: Ga` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `stocks/MarketDepthPanel.tsx` | 280 | client | `export function MarketDepthPanel({ initialTicker = 'COMI' }: { initialTicker?: s` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `stocks/StockAdvancedAnalysisView.tsx` | 679 | client | `export function StockAdvancedAnalysisView({ ticker, stockName, currentPrice }: S` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `stocks/StockDetail.tsx` | 1166 | client | `export function StockDetail() {` | 1 | components/stocks/StocksView.tsx | ✅ ACTIVE |
| `stocks/StockIcon.tsx` | 108 | client | `export function StockIcon({ ~export function StockIconMini({ ~export default Sto` | 5 | components/analysis/market-analysis/PersonaTab.tsx, components/analysis/market-analysis/PredictionsTab.tsx, components/predictions/MakerRadarTab.tsx | ✅ ACTIVE |
| `stocks/StockNews.tsx` | 576 | client | `export function StockNews() {
` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `stocks/StockSelector.tsx` | 460 | client | `export function StockSelector({~export default StockSelector;` | 3 | components/dashboard/DashboardView.tsx, components/layout/MobileMoreSheet.tsx, components/stocks/StocksView.tsx | ✅ ACTIVE |
| `stocks/StocksView.tsx` | 2138 | client | `export function StocksView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `stocks/TradingViewChart.tsx` | 1821 | client | `export const RESOLUTIONS = [~export const RANGES = [~export function TradingView` | 1 | components/stocks/StockDetail.tsx | ✅ ACTIVE |
| `stocks/TreasuryBondsView.tsx` | 435 | client | `export function TreasuryBondsView() {` | 1 | components/stocks/StocksView.tsx | ✅ ACTIVE |
| `studio/CustomEdge.tsx` | 77 | client | `export const CustomEdge = memo(CustomEdgeComponent);` | 1 | components/studio/FlowCanvas.tsx | ✅ ACTIVE |
| `studio/DataSourceNode.tsx` | 51 | client | `export const DataSourceNode = memo(DataSourceNodeComponent);` | 1 | components/studio/FlowCanvas.tsx | ✅ ACTIVE |
| `studio/EngineNode.tsx` | 107 | client | `export const EngineNode = memo(EngineNodeComponent);` | 1 | components/studio/FlowCanvas.tsx | ✅ ACTIVE |
| `studio/FlowCanvas.tsx` | 685 | client | `export function FlowCanvas() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `studio/OrchestratorNode.tsx` | 99 | client | `export const OrchestratorNode = memo(OrchestratorNodeComponent);` | 1 | components/studio/FlowCanvas.tsx | ✅ ACTIVE |
| `studio/ResultNode.tsx` | 79 | client | `export const ResultNode = memo(ResultNodeComponent);` | 1 | components/studio/FlowCanvas.tsx | ✅ ACTIVE |
| `studio/ResultPanel.tsx` | 150 | client | `export function ResultPanel({ result, loading }: ResultPanelProps) {` | 1 | components/studio/FlowCanvas.tsx | ✅ ACTIVE |
| `studio/Toolbar.tsx` | 152 | client | `export function StudioToolbar({` | 1 | components/studio/FlowCanvas.tsx | ✅ ACTIVE |
| `studio/types.ts` | 149 | none | `export interface EngineConfig {~export interface PipelineInfo {~export interface` | 7 | components/studio/DataSourceNode.tsx, components/studio/EngineNode.tsx, components/studio/FlowCanvas.tsx | ✅ ACTIVE |
| `subscription/SubscriptionView.tsx` | 1430 | client | `export function SubscriptionView() {` | 2 | app/page.tsx, components/settings/SettingsView.tsx | ✅ ACTIVE |
| `tithes/TithesView.tsx` | 757 | client | `export function TithesView() {
` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `ui/accordion.tsx` | 66 | none | `export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
` | 5 | components/academy/AcademyEncyclopedia.tsx, components/academy/StrategySandbox.tsx, components/portfolio/EnhancedPortfolioView.tsx | ✅ ACTIVE |
| `ui/alert-dialog.tsx` | 153 | none | `export {` | 11 | components/academy/PaperTradingWorkstation.tsx, components/admin/DatabaseManagerFull.tsx, components/admin/EngineSettingsTab.tsx | ✅ ACTIVE |
| `ui/alert.tsx` | 66 | none | `export { Alert, AlertTitle, AlertDescription }
` | 9 | app/backtest/page.tsx, components/admin/DatabaseManagerFull.tsx, components/admin/EngineSettingsTab.tsx | ✅ ACTIVE |
| `ui/aspect-ratio.tsx` | 11 | none | `export { AspectRatio }` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/avatar.tsx` | 53 | none | `export { Avatar, AvatarImage, AvatarFallback }
` | 3 | components/admin/TelegramTab.tsx, components/admin/UserManagementPanel.tsx, components/admin/UsersManagement.tsx | ✅ ACTIVE |
| `ui/badge.tsx` | 47 | none | `export { Badge, badgeVariants }
` | 167 | app/admin/educational-cards/page.tsx, app/admin/honest-predictions/page.tsx, app/backtest/page.tsx | ✅ ACTIVE |
| `ui/breadcrumb.tsx` | 109 | none | `export {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/button.tsx` | 60 | none | `export interface ButtonProps
~export { Button, buttonVariants }
` | 177 | app/admin/educational-cards/page.tsx, app/admin/honest-predictions/page.tsx, app/admin/reports/page.tsx | ✅ ACTIVE |
| `ui/calendar.tsx` | 213 | none | `export { Calendar, CalendarDayButton }` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/card.tsx` | 93 | none | `export {
` | 162 | app/admin/educational-cards/page.tsx, app/admin/honest-predictions/page.tsx, app/admin/reports/page.tsx | ✅ ACTIVE |
| `ui/carousel.tsx` | 241 | none | `export {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/chart.tsx` | 353 | none | `export type ChartConfig = {
~export {
` | 2 | components/crypto/CryptoSimulationView.tsx, components/simulation/SimulationView.tsx | ✅ ACTIVE |
| `ui/checkbox.tsx` | 32 | none | `export { Checkbox }
` | 6 | app/admin/educational-cards/page.tsx, components/admin/CryptoPredictionGenerator.tsx, components/admin/DbBackupPanel.tsx | ✅ ACTIVE |
| `ui/collapsible.tsx` | 33 | none | `export { Collapsible, CollapsibleTrigger, CollapsibleContent }
` | 4 | app/admin/honest-predictions/page.tsx, components/academy/CandlestickSimulator.tsx, components/predictions/MakerRadarTab.tsx | ✅ ACTIVE |
| `ui/command.tsx` | 184 | none | `export {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/context-menu.tsx` | 252 | none | `export {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/dialog.tsx` | 152 | none | `export {` | 30 | app/admin/educational-cards/page.tsx, components/FeedbackWidget.tsx, components/admin/DbBackupPanel.tsx | ✅ ACTIVE |
| `ui/drawer.tsx` | 135 | none | `export {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/dropdown-menu.tsx` | 257 | none | `export {
` | 7 | components/admin/TelegramTab.tsx, components/admin/UserManagementPanel.tsx, components/admin/UsersManagement.tsx | ✅ ACTIVE |
| `ui/form.tsx` | 167 | none | `export {
` | 1 | components/auth/AuthView.tsx | ✅ ACTIVE |
| `ui/help-tooltip.tsx` | 183 | client | `export function HelpTooltip({ items, className, iconClassName }: HelpTooltipProp` | 1 | components/recommendations/AiRecommendations.tsx | ✅ ACTIVE |
| `ui/hover-card.tsx` | 44 | none | `export { HoverCard, HoverCardTrigger, HoverCardContent }` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/input-otp.tsx` | 77 | none | `export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/input.tsx` | 26 | none | `export { Input }
` | 65 | app/admin/honest-predictions/page.tsx, components/FeedbackWidget.tsx, components/academy/PaperTradingWorkstation.tsx | ✅ ACTIVE |
| `ui/label.tsx` | 24 | none | `export { Label }
` | 28 | app/admin/honest-predictions/page.tsx, components/FeedbackWidget.tsx, components/academy/PaperTradingWorkstation.tsx | ✅ ACTIVE |
| `ui/menubar.tsx` | 276 | none | `export {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/mini-sparkline.tsx` | 130 | client | `export function MiniSparkline({` | 9 | components/dashboard/IndexCards.tsx, components/dashboard/MarketPulseWidget.tsx, components/dashboard/MultiMarketWidget.tsx | ✅ ACTIVE |
| `ui/navigation-menu.tsx` | 168 | none | `export {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/pagination.tsx` | 127 | none | `export {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/popover.tsx` | 48 | none | `export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
` | 3 | components/notifications/NotificationBell.tsx, components/share/ShareButton.tsx, components/shared/StockSearchSelector.tsx | ✅ ACTIVE |
| `ui/progress.tsx` | 31 | none | `export { Progress }
` | 44 | app/admin/honest-predictions/page.tsx, components/academy/AcademyEncyclopedia.tsx, components/admin/AdminView.tsx | ✅ ACTIVE |
| `ui/radio-group.tsx` | 45 | none | `export { RadioGroup, RadioGroupItem }
` | 2 | components/persona/DynamicRiskProfilerModal.tsx, components/portfolio/RiskProfilerQuiz.tsx | ✅ ACTIVE |
| `ui/resizable.tsx` | 56 | none | `export { ResizablePanelGroup, ResizablePanel, ResizableHandle }` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/scroll-area.tsx` | 58 | none | `export { ScrollArea, ScrollBar }
` | 27 | app/admin/honest-predictions/page.tsx, components/academy/AcademyEncyclopedia.tsx, components/academy/StrategySandbox.tsx | ✅ ACTIVE |
| `ui/select.tsx` | 185 | none | `export {
` | 54 | app/admin/educational-cards/page.tsx, app/admin/honest-predictions/page.tsx, components/admin/BacktestTab.tsx | ✅ ACTIVE |
| `ui/separator.tsx` | 28 | none | `export { Separator }
` | 33 | app/admin/honest-predictions/page.tsx, components/academy/CandlestickSimulator.tsx, components/academy/PaperTradingWorkstation.tsx | ✅ ACTIVE |
| `ui/sheet.tsx` | 139 | none | `export {
` | 4 | components/analysis/ExpertRecommendationsPanel.tsx, components/help/PlatformGuide.tsx, components/notifications/NotificationCenter.tsx | ✅ ACTIVE |
| `ui/sidebar.tsx` | 726 | none | `export {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/skeleton.tsx` | 13 | none | `export { Skeleton }
` | 88 | app/backtest/page.tsx, components/admin/AdminView.tsx, components/admin/CryptoAdminPanel.tsx | ✅ ACTIVE |
| `ui/slider.tsx` | 63 | none | `export { Slider }
` | 7 | app/admin/honest-predictions/page.tsx, components/academy/CandlestickSimulator.tsx, components/admin/OptimizerParamsPanel.tsx | ✅ ACTIVE |
| `ui/sonner.tsx` | 25 | none | `export { Toaster }
` | 1 | app/layout.tsx | ✅ ACTIVE |
| `ui/stat-card.tsx` | 74 | client | `export function StatCard({~export default StatCard;` | 6 | components/crypto/CryptoAdvancedAnalysisView.tsx, components/crypto/CryptoPredictionTrackingView.tsx, components/crypto/CryptoScreenerView.tsx | ✅ ACTIVE |
| `ui/switch.tsx` | 31 | none | `export { Switch }
` | 11 | app/admin/honest-predictions/page.tsx, components/admin/OptimizerParamsPanel.tsx, components/admin/RowEditorModal.tsx | ✅ ACTIVE |
| `ui/table.tsx` | 116 | none | `export {
` | 13 | app/admin/educational-cards/page.tsx, app/admin/honest-predictions/page.tsx, app/backtest/page.tsx | ✅ ACTIVE |
| `ui/tabs.tsx` | 67 | none | `export { Tabs, TabsList, TabsTrigger, TabsContent }
` | 50 | app/backtest/page.tsx, components/academy/AcademyView.tsx, components/academy/PaperTradingWorkstation.tsx | ✅ ACTIVE |
| `ui/textarea.tsx` | 18 | none | `export { Textarea }
` | 12 | components/FeedbackWidget.tsx, components/admin/DatabaseManagerFull.tsx, components/admin/HumanRecommendationsAdmin.tsx | ✅ ACTIVE |
| `ui/toast.tsx` | 128 | none | `export {` | 2 | components/ui/toaster.tsx, hooks/use-toast.ts | ✅ ACTIVE |
| `ui/toaster.tsx` | 34 | none | `export function Toaster() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `ui/toggle-group.tsx` | 73 | none | `export { ToggleGroup, ToggleGroupItem }
` | 1 | components/zakat/ZakatView.tsx | ✅ ACTIVE |
| `ui/toggle.tsx` | 47 | none | `export { Toggle, toggleVariants }
` | 1 | components/ui/toggle-group.tsx | ✅ ACTIVE |
| `ui/tooltip.tsx` | 61 | none | `export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
` | 12 | app/admin/honest-predictions/page.tsx, components/admin/DatabaseManagerFull.tsx, components/deal-advisor/DealAdvisorPanel.tsx | ✅ ACTIVE |
| `v82/V82DecisionPanel.tsx` | 294 | client | `export function V82DecisionPanel({ initialTicker = 'COMI' }: { initialTicker?: s` | 2 | app/page.tsx, components/portfolio/EnhancedPortfolioView.tsx | ✅ ACTIVE |
| `watchlist/EnhancedWatchlistView.tsx` | 1255 | client | `export function EnhancedWatchlistView() {` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `watchlist/ProfessionalWatchlistView.tsx` | 472 | client | `export function ProfessionalWatchlistView() {` | 1 | components/memory/TradingMemoryView.tsx | ✅ ACTIVE |
| `zakat/ZakatView.tsx` | 1142 | client | `export function ZakatView() {
` | 1 | app/page.tsx | 🟡 DYNAMIC |
| `admin/live-chart/index.tsx` | 281 | client | `export const STATUS_STYLES: Record<string, { bg: string; text: string; border: s` | 0 | _(none)_ | ⚠️ ORPHAN |
| `admin/platform-performance/PlatformPerformanceView.tsx` | 906 | client | `export function PlatformPerformanceView() {` | 1 | components/admin/AdminView.tsx | ✅ ACTIVE |
| `analysis/market-analysis/CryptoPredictionsTab.tsx` | 519 | client | `_(no `export`)_` | 0 | _(none)_ | ⚠️ ORPHAN |
| `analysis/market-analysis/ExpertPredictionsTab.tsx` | 514 | client | `_(no `export`)_` | 0 | _(none)_ | ⚠️ ORPHAN |
| `analysis/market-analysis/LiveTrackingTab.tsx` | 720 | client | `_(no `export`)_` | 0 | _(none)_ | ⚠️ ORPHAN |
| `analysis/market-analysis/MarketStatusTab.tsx` | 1085 | client | `export function MarketStatusTab({ market }: { market: MarketType }) {` | 1 | components/analysis/MarketAnalysisView.tsx | ✅ ACTIVE |
| `analysis/market-analysis/MorningBellSection.tsx` | 486 | client | `export function HorizontalSectorsBar({ marketCode }: { marketCode: string }) {~e` | 1 | components/analysis/MarketAnalysisView.tsx | ✅ ACTIVE |
| `analysis/market-analysis/PersonaTab.tsx` | 2140 | client | `export function PersonaTab({ market, persona }: { market: MarketType; persona: '` | 1 | components/analysis/MarketAnalysisView.tsx | ✅ ACTIVE |
| `analysis/market-analysis/PredictionsTab.tsx` | 857 | client | `export function PreviousPredictionsArchive({` | 1 | components/analysis/market-analysis/PersonaTab.tsx | ✅ ACTIVE |
| `analysis/market-analysis/SectorTrackingTab.tsx` | 670 | client | `export function SectorTrackingTab({ market }: { market: MarketType }) {` | 1 | components/analysis/MarketAnalysisView.tsx | ✅ ACTIVE |
| `analysis/market-analysis/helpers.ts` | 1170 | none | `export function pickValidPrice(...candidates: Array<unknown>): number \| undefine` | 9 | components/analysis/MarketAnalysisView.tsx, components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx | ✅ ACTIVE |
| `analysis/market-analysis/types.ts` | 461 | none | `export interface StockData {~export interface LiveStock {~export interface Stock` | 10 | components/analysis/MarketAnalysisView.tsx, components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx | ✅ ACTIVE |
| `predictions/radar/RadarStatsCards.tsx` | 793 | client | `export function RadarSignalStatsCard() {~export function SectorTreemapCard() {~e` | 1 | components/predictions/MakerRadarTab.tsx | ✅ ACTIVE |

**Subtotal**: 288 files, 148,563 LOC. Active=199, Dynamic=34, Orphan=55.

### 2.2 App Routes (src/app)

#### 2.2.1 Page/Layout files (non-API)

| File | LOC | Mode | Route | Exports | Status |
|------|----:|------|-------|---------|--------|
| `app/layout.tsx` | 77 | none | `/` (root layout) | `RootLayout` (default) | ✅ root |
| `app/page.tsx` | 639 | client | `/` (hash-routed SPA) | `Home` (default) | ✅ root |
| `app/admin/layout.tsx` | 77 | none | `/admin/*` | `AdminLayout` (default) | ✅ |
| `app/admin/page.tsx` | 37 | client | `/admin` | `AdminRedirectPage` (default) | ✅ |
| `app/admin/reports/page.tsx` | 120 | client | `/admin/reports` | `ReportsPage` (default) | ✅ |
| `app/admin/educational-cards/page.tsx` | 1,704 | client | `/admin/educational-cards` | `AdminEducationalCardsPage` (default) | ✅ |
| `app/admin/honest-predictions/page.tsx` | 1,921 | client | `/admin/honest-predictions` | `HonestPredictionsPage` (default) | ✅ |
| `app/backtest/page.tsx` | 379 | client | `/backtest` | `Home` (default) | ✅ |
| `app/payment/success/page.tsx` | 158 | client | `/payment/success` | `PaymentSuccess` (default) | ✅ |
| `app/legal/privacy/page.tsx` | 197 | none | `/legal/privacy` | `PrivacyPolicyPage` (default) | ✅ linked from Footer |
| `app/legal/terms/page.tsx` | 265 | none | `/legal/terms` | `TermsOfServicePage` (default) | ✅ linked from Footer |
| `app/legal/disclaimer/page.tsx` | 209 | none | `/legal/disclaimer` | `DisclaimerPage` (default) | ✅ linked from Footer |

**Subtotal**: 12 files, ~5,783 LOC. All 12 are reachable from browser URLs (12 routes).

#### 2.2.2 API Route Handlers (src/app/api/**/route.ts)

**Subtotal**: 658 route handlers, 88,776 LOC. Active=522, Orphan=136.

**Status legend**: ✅ ACTIVE = called from `src/` via `fetch('/api/...')` (excluding `src/middleware.ts` config + route files themselves); ⚠️ ORPHAN = no caller found in any `.ts/.tsx/.js/.cjs/.mjs/.py` file under project root.

##### Method distribution across all 658 routes

| HTTP Methods | Routes |
|--------------|-------:|
| `GET` | 395 |
| `POST` | 108 |
| `GET,POST` | 69 |
| `POST,GET` | 46 |
| `GET,POST,DELETE` | 11 |
| `GET,POST,PUT,DELETE` | 5 |
| `PUT,DELETE` | 3 |
| `?` | 3 |
| `GET,DELETE` | 2 |
| `DELETE` | 2 |
| `GET,POST,PUT,DELETE,PATCH` | 2 |
| `PUT` | 2 |
| `GET,POST,PUT,PATCH,DELETE` | 1 |
| `GET,PUT` | 1 |
| `POST,DELETE` | 1 |
| `DELETE,POST` | 1 |
| `GET,POST,PATCH,DELETE` | 1 |
| `GET,PATCH,DELETE` | 1 |
| `GET,POST,PUT` | 1 |
| `GET,PUT,POST` | 1 |
| `POST,GET,DELETE` | 1 |
| `POST,PUT` | 1 |

##### Top 30 API routes by LOC

| File | LOC | Methods | Status |
|------|----:|---------|--------|
| `deal-advisor/[ticker]/route.ts` | 977 | `GET` | ✅ ACTIVE |
| `advanced-analysis/scan-all/route.ts` | 950 | `GET,POST` | ⚠️ ORPHAN |
| `admin/advanced-analysis/run/route.ts` | 769 | `POST,GET` | ⚠️ ORPHAN |
| `admin/platform-performance/route.ts` | 645 | `GET` | ✅ ACTIVE |
| `predictions/honest-tracking/list/route.ts` | 643 | `GET` | ✅ ACTIVE |
| `finance/calculate-values/route.ts` | 638 | `GET` | ✅ ACTIVE |
| `predictions/honest-tracking/stats/route.ts` | 615 | `GET` | ✅ ACTIVE |
| `admin/db-manager/repair/route.ts` | 578 | `POST` | ✅ ACTIVE |
| `mubasher/sync/route.ts` | 576 | `POST,GET` | ✅ ACTIVE |
| `maestro/logic-panel/route.ts` | 573 | `GET` | ⚠️ ORPHAN |
| `market/sync-live/route.ts` | 526 | `POST` | ✅ ACTIVE |
| `market/scheduled-sync/route.ts` | 521 | `POST,GET` | ✅ ACTIVE |
| `analyst/predictions/route.ts` | 517 | `GET,POST,PUT` | ✅ ACTIVE |
| `auth/google/route.ts` | 510 | `POST` | ✅ ACTIVE |
| `admin/db-backup/route.ts` | 501 | `GET,POST,DELETE` | ✅ ACTIVE |
| `predictions/credibility/route.ts` | 489 | `GET` | ⚠️ ORPHAN |
| `auth/[...nextauth]/route.ts` | 488 | `?` | ✅ ACTIVE |
| `egx/investors/route.ts` | 477 | `GET` | ✅ ACTIVE |
| `market/liquidity-flow/route.ts` | 472 | `GET` | ✅ ACTIVE |
| `chart/[ticker]/route.ts` | 471 | `GET` | ✅ ACTIVE |
| `admin/sync-vps/route.ts` | 459 | `POST,GET` | ✅ ACTIVE |
| `export/route.ts` | 459 | `GET` | ✅ ACTIVE |
| `data-engine/control/route.ts` | 457 | `GET,POST` | ✅ ACTIVE |
| `predictions/expert-consensus/route.ts` | 449 | `GET` | ✅ ACTIVE |
| `unified-analysis/[symbol]/route.ts` | 440 | `GET` | ⚠️ ORPHAN |
| `live-monitor/ledger/route.ts` | 436 | `GET` | ✅ ACTIVE |
| `admin/news/route.ts` | 432 | `GET,POST,PUT,DELETE` | ✅ ACTIVE |
| `subscription/verify/route.ts` | 430 | `POST` | ✅ ACTIVE |
| `admin/engines-status/route.ts` | 420 | `GET` | ✅ ACTIVE |
| `finance/assets/route.ts` | 412 | `GET,POST,PUT,DELETE` | ✅ ACTIVE |

##### Full API inventory (sorted by category)

| # | Route | LOC | Methods | Status | Called From |
|---|-------|----:|---------|--------|-------------|
| 1 | `/api` | 5 | `GET` | ✅ ACTIVE | ./data_engine/realtime_sync.py, ./data_engine/scrapers/crypto |
| 2 | `/api/[...slug]` | 69 | `GET,POST,PUT,PATCH,DELETE` | ✅ ACTIVE | ./data_engine/realtime_sync.py, ./data_engine/scrapers/crypto |
| 3 | `/api/admin/ab-test` | 32 | `GET` | ✅ ACTIVE | ./scripts/run_ab_test.py, ./src/middleware.ts |
| 4 | `/api/admin/advanced-analysis/config` | 114 | `GET,PUT` | ⚠️ ORPHAN | _(none)_ |
| 5 | `/api/admin/advanced-analysis/run` | 769 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 6 | `/api/admin/ai-analyze` | 31 | `GET` | ✅ ACTIVE | ./src/middleware.ts |
| 7 | `/api/admin/ai-predictions/evaluate-range` | 82 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 8 | `/api/admin/ai-predictions/generate` | 31 | `POST` | ✅ ACTIVE | ./src/components/admin/SuperLearningSystem.tsx |
| 9 | `/api/admin/analytics` | 248 | `GET` | ✅ ACTIVE | ./src/app/api/admin/analytics/route.ts, ./src/components/admi |
| 10 | `/api/admin/auth` | 89 | `POST,DELETE` | ✅ ACTIVE | ./src/app/api/admin/auth/auto-cookie/route.ts, ./src/app/api/ |
| 11 | `/api/admin/auth/auto-cookie` | 102 | `POST` | ✅ ACTIVE | ./src/app/api/admin/auth/auto-cookie/route.ts, ./src/componen |
| 12 | `/api/admin/auth/token` | 20 | `GET` | ✅ ACTIVE | ./src/app/api/admin/auth/token/route.ts, ./src/components/adm |
| 13 | `/api/admin/backtest/ab-test` | 38 | `POST` | ✅ ACTIVE | ./src/app/api/admin/backtest/ab-test/route.ts |
| 14 | `/api/admin/backtest/engine-results` | 36 | `GET` | ✅ ACTIVE | ./src/app/api/admin/backtest/engine-results/route.ts |
| 15 | `/api/admin/backtest/run-engine` | 38 | `POST` | ✅ ACTIVE | ./src/app/api/admin/backtest/run-engine/route.ts |
| 16 | `/api/admin/backtest/v40/run` | 136 | `POST` | ✅ ACTIVE | ./src/components/admin/BacktestTab.tsx |
| 17 | `/api/admin/backtest/v40/stats` | 167 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/seed/route.ts, ./src/components/adm |
| 18 | `/api/admin/backtest/v40/status/[jobId]` | 70 | `GET` | ✅ ACTIVE | ./src/app/api/admin/backtest/v40/run/route.ts, ./src/componen |
| 19 | `/api/admin/build-stock-dna` | 78 | `POST` | ✅ ACTIVE | ./src/app/api/admin/build-stock-dna/route.ts |
| 20 | `/api/admin/clean-predictions` | 234 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/clean-predictions/route.ts, ./src/compone |
| 21 | `/api/admin/clear-junk-data` | 138 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 22 | `/api/admin/clear-predictions` | 51 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 23 | `/api/admin/close-predictions` | 139 | `POST,GET` | ✅ ACTIVE | ./src/app/api/admin/close-predictions/route.ts, ./src/middlew |
| 24 | `/api/admin/currency` | 93 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/currency/route.ts |
| 25 | `/api/admin/daily-analysis` | 371 | `GET,POST,DELETE` | ✅ ACTIVE | ./src/components/admin/EnginesStatusTab.tsx |
| 26 | `/api/admin/data-sources` | 238 | `GET` | ✅ ACTIVE | ./src/app/api/admin/data-sources/route.ts |
| 27 | `/api/admin/db` | 45 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/auth/auto-cookie/route.ts, ./src/app/api/ |
| 28 | `/api/admin/db-backup` | 501 | `GET,POST,DELETE` | ✅ ACTIVE | ./src/app/api/admin/db-backup/route.ts, ./src/components/admi |
| 29 | `/api/admin/db-explorer` | 138 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 30 | `/api/admin/db-health` | 138 | `GET` | ✅ ACTIVE | ./src/app/api/admin/db-health/route.ts |
| 31 | `/api/admin/db-manager` | 46 | `GET` | ✅ ACTIVE | ./src/app/api/admin/auth/auto-cookie/route.ts, ./src/app/api/ |
| 32 | `/api/admin/db-manager/auto-backup` | 173 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/auto-backup/route.ts |
| 33 | `/api/admin/db-manager/backup` | 48 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/backup/route.ts, ./src/compone |
| 34 | `/api/admin/db-manager/checkpoint-all` | 24 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/checkpoint-all/route.ts, ./src |
| 35 | `/api/admin/db-manager/cleanup-old-backups` | 126 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/cleanup-old-backups/route.ts |
| 36 | `/api/admin/db-manager/cleanup-symbols` | 45 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 37 | `/api/admin/db-manager/delete-backup` | 38 | `DELETE,POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/delete-backup/route.ts, ./src/ |
| 38 | `/api/admin/db-manager/drop-table` | 30 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/drop-table/route.ts, ./src/com |
| 39 | `/api/admin/db-manager/export` | 54 | `GET` | ✅ ACTIVE | ./src/app/api/admin/db-manager/export-all/route.ts, ./src/app |
| 40 | `/api/admin/db-manager/export-all` | 68 | `POST,GET` | ✅ ACTIVE | ./src/app/api/admin/db-manager/export-all/route.ts, ./src/com |
| 41 | `/api/admin/db-manager/historical-backups` | 79 | `GET,POST,DELETE` | ✅ ACTIVE | ./src/app/api/admin/db-manager/historical-backups/route.ts, . |
| 42 | `/api/admin/db-manager/import-all` | 62 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/import-all/route.ts, ./src/com |
| 43 | `/api/admin/db-manager/import-egx30` | 45 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 44 | `/api/admin/db-manager/integrity` | 26 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/integrity/route.ts |
| 45 | `/api/admin/db-manager/query` | 46 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/query/route.ts, ./src/componen |
| 46 | `/api/admin/db-manager/recover` | 52 | `POST` | ✅ ACTIVE | ./src/components/admin/DatabaseManagerFull.tsx, ./src/lib/adm |
| 47 | `/api/admin/db-manager/recover-all` | 45 | `POST` | ✅ ACTIVE | ./src/components/admin/DatabaseManagerFull.tsx, ./src/lib/adm |
| 48 | `/api/admin/db-manager/reindex` | 26 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/reindex/route.ts, ./src/middle |
| 49 | `/api/admin/db-manager/repair` | 578 | `POST` | ✅ ACTIVE | ./src/app/api/admin/auth/auto-cookie/route.ts, ./src/app/api/ |
| 50 | `/api/admin/db-manager/repair-all` | 48 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 51 | `/api/admin/db-manager/repair-engine` | 45 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 52 | `/api/admin/db-manager/restore` | 39 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/restore/route.ts, ./src/compon |
| 53 | `/api/admin/db-manager/schema` | 36 | `GET` | ✅ ACTIVE | ./src/app/api/admin/db-manager/schema/route.ts, ./src/compone |
| 54 | `/api/admin/db-manager/truncate-table` | 30 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/truncate-table/route.ts, ./src |
| 55 | `/api/admin/db-manager/vacuum` | 26 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/vacuum/route.ts |
| 56 | `/api/admin/db-manager/wal-checkpoint` | 26 | `POST` | ✅ ACTIVE | ./src/app/api/admin/db-manager/wal-checkpoint/route.ts |
| 57 | `/api/admin/db/[db]` | 68 | `GET,DELETE` | ✅ ACTIVE | ./src/app/api/admin/db/[db]/[table]/[row]/route.ts, ./src/app |
| 58 | `/api/admin/db/[db]/[table]` | 95 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/db/[db]/[table]/[row]/route.ts, ./src/app |
| 59 | `/api/admin/db/[db]/[table]/[row]` | 87 | `PUT,DELETE` | ✅ ACTIVE | ./src/app/api/admin/db/[db]/[table]/[row]/route.ts, ./src/app |
| 60 | `/api/admin/educational-cards` | 176 | `GET,POST` | ✅ ACTIVE | ./src/app/admin/educational-cards/page.tsx, ./src/app/api/adm |
| 61 | `/api/admin/educational-cards/[id]` | 265 | `GET,POST,DELETE` | ✅ ACTIVE | ./src/app/admin/educational-cards/page.tsx, ./src/app/api/adm |
| 62 | `/api/admin/educational-cards/[id]/image` | 105 | `GET` | ✅ ACTIVE | ./src/app/admin/educational-cards/page.tsx, ./src/app/api/adm |
| 63 | `/api/admin/educational-cards/lessons` | 87 | `GET` | ✅ ACTIVE | ./src/app/admin/educational-cards/page.tsx, ./src/app/api/adm |
| 64 | `/api/admin/engine-control/status` | 46 | `GET` | ✅ ACTIVE | ./src/app/api/admin/engine-control/status/route.ts |
| 65 | `/api/admin/engine-control/toggle` | 60 | `POST` | ✅ ACTIVE | ./src/app/api/admin/engine-control/toggle/route.ts |
| 66 | `/api/admin/engine-control/trigger` | 105 | `POST` | ✅ ACTIVE | ./src/app/api/admin/engine-control/trigger/route.ts |
| 67 | `/api/admin/engine-control/weights` | 100 | `POST` | ✅ ACTIVE | ./src/app/api/admin/engine-control/weights/route.ts |
| 68 | `/api/admin/engine-settings` | 270 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/engine-settings/reset/route.ts, ./src/app |
| 69 | `/api/admin/engine-settings/reset` | 87 | `POST` | ✅ ACTIVE | ./src/app/api/admin/engine-settings/reset/route.ts, ./src/com |
| 70 | `/api/admin/engines-status` | 420 | `GET` | ✅ ACTIVE | ./src/components/admin/EnginesStatusTab.tsx |
| 71 | `/api/admin/export-data` | 199 | `GET` | ✅ ACTIVE | ./src/app/api/admin/export-data/route.ts |
| 72 | `/api/admin/export-vps` | 125 | `GET` | ✅ ACTIVE | ./src/app/api/admin/export-vps/route.ts |
| 73 | `/api/admin/feature-flags` | 32 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 74 | `/api/admin/fix-dates` | 178 | `POST,GET` | ✅ ACTIVE | ./src/app/api/admin/fix-dates/route.ts, ./src/middleware.ts |
| 75 | `/api/admin/generate-historical-predictions` | 349 | `POST,GET` | ✅ ACTIVE | ./src/app/admin/honest-predictions/page.tsx |
| 76 | `/api/admin/generate-predictions` | 35 | `POST` | ✅ ACTIVE | ./src/components/admin/AdminView.tsx, ./src/components/admin/ |
| 77 | `/api/admin/gold` | 92 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/gold/route.ts |
| 78 | `/api/admin/historical-backfill/results` | 48 | `GET` | ✅ ACTIVE | ./src/app/api/admin/historical-backfill/results/route.ts |
| 79 | `/api/admin/historical-backfill/run` | 58 | `POST` | ✅ ACTIVE | ./src/app/api/admin/historical-backfill/run/route.ts |
| 80 | `/api/admin/historical-backfill/status` | 47 | `GET` | ✅ ACTIVE | ./src/app/api/admin/historical-backfill/status/route.ts |
| 81 | `/api/admin/import-data` | 271 | `POST` | ✅ ACTIVE | ./src/app/api/admin/import-data/route.ts |
| 82 | `/api/admin/import-egxpilot` | 201 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 83 | `/api/admin/import-snapshot` | 182 | `POST` | ✅ ACTIVE | ./src/app/api/admin/import-snapshot/route.ts |
| 84 | `/api/admin/import-stocks` | 263 | `POST,GET` | ✅ ACTIVE | ./src/app/api/admin/import-stocks/route.ts, ./src/middleware. |
| 85 | `/api/admin/learned-lessons` | 32 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 86 | `/api/admin/market-status` | 32 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 87 | `/api/admin/monitor` | 164 | `GET` | ✅ ACTIVE | ./src/app/api/admin/monitor/route.ts |
| 88 | `/api/admin/news` | 432 | `GET,POST,PUT,DELETE` | ✅ ACTIVE | ./src/app/api/admin/news/route.ts, ./src/components/admin/New |
| 89 | `/api/admin/phase4-status` | 32 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 90 | `/api/admin/platform-performance` | 645 | `GET` | ✅ ACTIVE | ./src/app/api/admin/platform-performance/route.ts, ./src/app/ |
| 91 | `/api/admin/pm2-control` | 157 | `POST,GET` | ✅ ACTIVE | ./src/components/admin/EnginesStatusTab.tsx, ./src/middleware |
| 92 | `/api/admin/promo-codes` | 224 | `GET,POST,PATCH,DELETE` | ✅ ACTIVE | ./src/app/api/admin/promo-codes/route.ts, ./src/components/ad |
| 93 | `/api/admin/purge-cache` | 209 | `POST,GET` | ✅ ACTIVE | ./src/app/api/admin/purge-cache/route.ts, ./src/components/ad |
| 94 | `/api/admin/recommendation-settings` | 143 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/recommendation-settings/route.ts |
| 95 | `/api/admin/recommendations` | 92 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/recommendations/route.ts |
| 96 | `/api/admin/refresh-historical-data` | 163 | `POST,GET` | ✅ ACTIVE | ./src/app/api/admin/refresh-historical-data/route.ts |
| 97 | `/api/admin/reports` | 149 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/reports/[id]/image/route.ts, ./src/app/ap |
| 98 | `/api/admin/reports/[id]` | 186 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/reports/[id]/image/route.ts, ./src/app/ap |
| 99 | `/api/admin/reports/[id]/image` | 102 | `GET` | ✅ ACTIVE | ./src/app/api/admin/reports/[id]/image/route.ts, ./src/app/ap |
| 100 | `/api/admin/retroactive-predictions` | 31 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 101 | `/api/admin/scrape-stocks` | 275 | `POST,GET` | ✅ ACTIVE | ./src/app/api/admin/scrape-stocks/route.ts |
| 102 | `/api/admin/screener-refresh` | 69 | `POST` | ✅ ACTIVE | ./src/app/api/admin/screener-refresh/route.ts |
| 103 | `/api/admin/seasonality` | 111 | `GET` | ✅ ACTIVE | ./src/app/api/admin/seasonality/route.ts |
| 104 | `/api/admin/stats` | 161 | `GET` | ✅ ACTIVE | ./src/app/api/admin/stats/route.ts, ./src/components/admin/Ad |
| 105 | `/api/admin/subscription/seed` | 122 | `POST` | ✅ ACTIVE | ./src/app/api/admin/subscription/seed/route.ts |
| 106 | `/api/admin/subscription/set-plan` | 102 | `POST` | ✅ ACTIVE | ./src/app/api/admin/subscription/set-plan/route.ts |
| 107 | `/api/admin/sync-fundamentals` | 31 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 108 | `/api/admin/sync-stocks-db` | 153 | `POST,GET` | ✅ ACTIVE | ./src/app/api/admin/sync-stocks-db/route.ts, ./src/components |
| 109 | `/api/admin/sync-vps` | 459 | `POST,GET` | ✅ ACTIVE | ./src/app/api/admin/sync-vps/route.ts, ./src/components/admin |
| 110 | `/api/admin/system-health` | 224 | `GET` | ✅ ACTIVE | ./src/app/api/admin/system-health/route.ts, ./src/components/ |
| 111 | `/api/admin/system-resources` | 231 | `GET` | ✅ ACTIVE | ./src/app/api/admin/system-resources/route.ts, ./src/componen |
| 112 | `/api/admin/system-topology` | 32 | `GET` | ✅ ACTIVE | ./src/app/api/admin/system-topology/route.ts, ./src/app/api/t |
| 113 | `/api/admin/users` | 345 | `GET` | ✅ ACTIVE | ./scripts/migrate-db.ts, ./src/app/api/admin/users/[id]/route |
| 114 | `/api/admin/users/[id]` | 234 | `GET,PATCH,DELETE` | ✅ ACTIVE | ./src/app/api/admin/users/[id]/route.ts, ./src/app/api/admin/ |
| 115 | `/api/admin/users/cleanup-expired` | 114 | `POST` | ✅ ACTIVE | ./src/app/api/admin/users/cleanup-expired/route.ts, ./src/com |
| 116 | `/api/advanced-analysis` | 28 | `GET` | ✅ ACTIVE | ./src/components/advanced-analysis/CandlestickWidget.tsx, ./s |
| 117 | `/api/advanced-analysis/results` | 28 | `GET` | ✅ ACTIVE | ./src/components/recommendations/SocialPostView.tsx |
| 118 | `/api/advanced-analysis/scan-all` | 950 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 119 | `/api/ai-analysis` | 164 | `GET,POST` | ✅ ACTIVE | ./src/app/api/ai-analysis/route.ts |
| 120 | `/api/ai-performance` | 321 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 121 | `/api/ai-predictions/evaluate` | 28 | `POST` | ✅ ACTIVE | ./vps-service/api/ai_predictions_routes.py |
| 122 | `/api/ai-predictions/extract` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 123 | `/api/ai-proxy` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 124 | `/api/ai/analyze-stock` | 331 | `POST` | ✅ ACTIVE | ./src/app/api/ai/analyze-stock/route.ts |
| 125 | `/api/ai/batch-analysis` | 74 | `POST` | ✅ ACTIVE | ./src/app/api/ai/batch-analysis/route.ts |
| 126 | `/api/ai/chat` | 212 | `POST,GET` | ✅ ACTIVE | ./src/app/api/ai/analyze-stock/route.ts, ./src/components/ai/ |
| 127 | `/api/alerts` | 293 | `GET` | ✅ ACTIVE | ./src/app/api/alerts/[id]/route.ts, ./src/app/api/alerts/crea |
| 128 | `/api/alerts/[id]` | 149 | `DELETE` | ✅ ACTIVE | ./src/app/api/alerts/[id]/route.ts, ./src/app/api/alerts/crea |
| 129 | `/api/alerts/create` | 208 | `POST` | ✅ ACTIVE | ./src/app/api/alerts/create/route.ts |
| 130 | `/api/alerts/gold` | 324 | `GET,POST,DELETE` | ✅ ACTIVE | ./src/app/api/alerts/gold/route.ts |
| 131 | `/api/alerts/quick-add` | 226 | `POST,GET` | ✅ ACTIVE | ./src/app/api/alerts/quick-add/route.ts, ./src/components/ana |
| 132 | `/api/alerts/scheduler` | 150 | `GET,POST` | ✅ ACTIVE | ./src/app/api/alerts/scheduler/route.ts, ./src/components/not |
| 133 | `/api/analysis-engine` | 234 | `GET,POST` | ✅ ACTIVE | ./src/app/api/analysis-engine/route.ts |
| 134 | `/api/analysis/results` | 48 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 135 | `/api/analysis/status` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 136 | `/api/analyst/predictions` | 517 | `GET,POST,PUT` | ✅ ACTIVE | ./src/app/api/analyst/predictions/route.ts |
| 137 | `/api/app/version` | 94 | `GET` | ✅ ACTIVE | ./src/app/api/app/version/route.ts |
| 138 | `/api/auth/[...nextauth]` | 488 | `?` | ✅ ACTIVE | ./src/app/admin/layout.tsx, ./src/app/api/admin/auth/auto-coo |
| 139 | `/api/auth/config` | 54 | `GET` | ✅ ACTIVE | ./src/app/api/auth/config/route.ts |
| 140 | `/api/auth/google` | 510 | `POST` | ✅ ACTIVE | ./src/app/api/auth/google-signin/route.ts, ./src/app/api/auth |
| 141 | `/api/auth/google-signin` | 306 | `GET,POST` | ✅ ACTIVE | ./src/app/api/auth/google-signin/route.ts |
| 142 | `/api/auth/login` | 184 | `POST` | ✅ ACTIVE | ./src/app/api/auth/login/route.ts, ./src/lib/api-client.ts |
| 143 | `/api/auth/logout` | 65 | `POST` | ✅ ACTIVE | ./src/app/api/auth/logout/route.ts, ./src/lib/api-client.ts |
| 144 | `/api/auth/me` | 191 | `GET` | ✅ ACTIVE | ./src/app/api/auth/me/route.ts, ./src/app/api/redeem-promo/ro |
| 145 | `/api/auth/profile` | 71 | `GET,PUT,POST` | ✅ ACTIVE | ./src/app/api/auth/profile/route.ts |
| 146 | `/api/auth/register` | 154 | `POST` | ✅ ACTIVE | ./src/app/api/auth/register/route.ts, ./src/components/auth/A |
| 147 | `/api/auto-refresh/start` | 71 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 148 | `/api/auto-refresh/status` | 81 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 149 | `/api/auto-refresh/stop` | 39 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 150 | `/api/backtest` | 54 | `POST` | ✅ ACTIVE | ./src/app/api/backtest/route.ts, ./src/app/api/backtesting/ro |
| 151 | `/api/backtesting` | 46 | `GET` | ✅ ACTIVE | ./src/app/api/backtesting/route.ts, ./src/app/api/backtesting |
| 152 | `/api/backtesting/apply-params` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 153 | `/api/backtesting/unified` | 47 | `POST` | ✅ ACTIVE | ./src/app/api/backtesting/unified/route.ts |
| 154 | `/api/cache` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/cache/clear/route.ts, ./vps-service/api/misc_ro |
| 155 | `/api/cache/clear` | 81 | `POST,GET` | ✅ ACTIVE | ./src/app/api/cache/clear/route.ts |
| 156 | `/api/chart/[ticker]` | 471 | `GET` | ✅ ACTIVE | ./scripts/smoke_load_test.py, ./src/app/api/chart/[ticker]/ro |
| 157 | `/api/community` | 60 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 158 | `/api/community/posts/[post_id]/comments` | 50 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 159 | `/api/community/seed` | 265 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 160 | `/api/confluence/analyze/[ticker]` | 80 | `GET` | ✅ ACTIVE | ./src/app/api/confluence/analyze/[ticker]/route.ts, ./src/app |
| 161 | `/api/confluence/daily-picks` | 28 | `GET` | ✅ ACTIVE | ./src/components/daily-picks/DailyPicksPoster.tsx |
| 162 | `/api/confluence/market-scan` | 175 | `GET` | ✅ ACTIVE | ./src/app/api/confluence/market-scan/route.ts |
| 163 | `/api/cron/auto-sync` | 74 | `GET,POST` | ✅ ACTIVE | ./src/app/api/cron/auto-sync/route.ts, ./src/instrumentation. |
| 164 | `/api/cron/confluence` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 165 | `/api/cron/daily-telegram` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 166 | `/api/cron/learning` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 167 | `/api/cron/precompute` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 168 | `/api/cron/predictions` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 169 | `/api/cron/scheduled` | 390 | `GET,POST` | ✅ ACTIVE | ./src/app/api/cron/scheduled/route.ts |
| 170 | `/api/cron/screener` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 171 | `/api/cron/update-cache` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 172 | `/api/cron/verify-predictions` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 173 | `/api/crypto` | 83 | `GET` | ✅ ACTIVE | ./src/app/api/crypto-backtesting/route.ts, ./src/app/api/cryp |
| 174 | `/api/crypto-backtesting` | 44 | `GET` | ✅ ACTIVE | ./src/app/api/crypto-backtesting/route.ts, ./src/components/a |
| 175 | `/api/crypto-lab` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/crypto-lab/predictions/route.ts, ./src/componen |
| 176 | `/api/crypto-lab/predictions` | 183 | `GET` | ✅ ACTIVE | ./src/app/api/crypto-lab/predictions/route.ts, ./src/componen |
| 177 | `/api/crypto-predictions` | 71 | `GET` | ✅ ACTIVE | ./src/app/api/crypto-predictions/route.ts, ./src/components/c |
| 178 | `/api/crypto/[id]` | 184 | `GET` | ✅ ACTIVE | ./src/app/api/crypto-lab/route.ts, ./src/app/api/crypto/[id]/ |
| 179 | `/api/crypto/[id]/history` | 59 | `GET` | ✅ ACTIVE | ./src/app/api/crypto-lab/route.ts, ./src/app/api/crypto/[id]/ |
| 180 | `/api/crypto/analyze` | 66 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/analyze/route.ts, ./vps-service/lightwei |
| 181 | `/api/crypto/coins` | 104 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/coins/route.ts, ./src/app/api/unified-cr |
| 182 | `/api/crypto/events` | 116 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/events/route.ts |
| 183 | `/api/crypto/explosive` | 65 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/explosive/[symbol]/route.ts, ./src/app/a |
| 184 | `/api/crypto/explosive/[symbol]` | 10 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/explosive/[symbol]/route.ts, ./src/app/a |
| 185 | `/api/crypto/flow` | 60 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/flow/[symbol]/route.ts, ./src/app/api/cr |
| 186 | `/api/crypto/flow/[symbol]` | 10 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/flow/[symbol]/route.ts, ./src/app/api/cr |
| 187 | `/api/crypto/full-analysis` | 374 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/full-analysis/route.ts, ./src/components |
| 188 | `/api/crypto/live` | 9 | `GET` | ✅ ACTIVE | ./src/app/api/crypto-lab/route.ts, ./src/app/api/crypto/live/ |
| 189 | `/api/crypto/mr-signals` | 89 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/mr-signals/route.ts |
| 190 | `/api/crypto/ohlc` | 115 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/ohlc/route.ts |
| 191 | `/api/crypto/portfolio` | 45 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/portfolio/route.ts, ./src/components/por |
| 192 | `/api/crypto/recommendations` | 47 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/recommendations/route.ts |
| 193 | `/api/crypto/simulation` | 117 | `GET,POST` | ✅ ACTIVE | ./src/app/api/crypto/simulation/route.ts, ./vps-service/light |
| 194 | `/api/crypto/start` | 119 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 195 | `/api/crypto/stats` | 76 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/stats/route.ts |
| 196 | `/api/crypto/status` | 17 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 197 | `/api/crypto/stop` | 103 | `POST` | ✅ ACTIVE | ./src/app/api/crypto/start/route.ts |
| 198 | `/api/crypto/sync` | 281 | `GET,POST` | ✅ ACTIVE | ./src/app/api/crypto/sync/route.ts, ./vps-service/lightweight |
| 199 | `/api/crypto/watchlist` | 45 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/watchlist/route.ts, ./src/components/ale |
| 200 | `/api/currency` | 113 | `GET` | ✅ ACTIVE | ./src/app/api/currency/convert/route.ts, ./src/app/api/curren |
| 201 | `/api/currency/convert` | 208 | `GET,POST` | ✅ ACTIVE | ./src/app/api/currency/convert/route.ts |
| 202 | `/api/currency/list` | 98 | `GET` | ✅ ACTIVE | ./src/app/api/currency/list/route.ts, ./src/app/api/mobile/cu |
| 203 | `/api/data-engine/compare-db` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 204 | `/api/data-engine/control` | 457 | `GET,POST` | ✅ ACTIVE | ./src/components/admin/DataEngineTab.tsx, ./src/components/ad |
| 205 | `/api/data-engine/crypto` | 63 | `GET` | ✅ ACTIVE | ./src/app/api/data-engine/crypto/route.ts, ./src/components/c |
| 206 | `/api/data-engine/forex` | 66 | `GET` | ✅ ACTIVE | ./src/components/admin/ForexTab.tsx, ./src/components/dashboa |
| 207 | `/api/data-engine/gold` | 83 | `GET` | ✅ ACTIVE | ./src/components/admin/GoldSilverTab.tsx, ./src/components/da |
| 208 | `/api/data-engine/health` | 165 | `GET` | ✅ ACTIVE | ./src/app/api/data-engine/health/route.ts |
| 209 | `/api/data-engine/metals` | 111 | `GET` | ✅ ACTIVE | ./src/app/api/data-engine/metals/route.ts |
| 210 | `/api/data-engine/new-db-stats` | 93 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 211 | `/api/data-engine/reload` | 105 | `POST,GET` | ✅ ACTIVE | ./data_engine/realtime_sync.py, ./src/app/api/data-engine/rel |
| 212 | `/api/data-engine/silver` | 48 | `GET` | ✅ ACTIVE | ./src/components/admin/GoldSilverTab.tsx |
| 213 | `/api/data-engine/status` | 115 | `GET` | ✅ ACTIVE | ./src/components/admin/MultiMarketTab.tsx |
| 214 | `/api/data-engine/stocks` | 76 | `GET` | ✅ ACTIVE | ./src/components/admin/MultiMarketTab.tsx, ./src/components/d |
| 215 | `/api/data-import` | 28 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 216 | `/api/data-status` | 28 | `GET` | ✅ ACTIVE | ./src/components/admin/AdminView.tsx |
| 217 | `/api/database-report` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 218 | `/api/db-stats` | 57 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 219 | `/api/deal-advisor/[ticker]` | 977 | `GET` | ✅ ACTIVE | ./src/app/api/deal-advisor/[ticker]/route.ts, ./src/component |
| 220 | `/api/devil/calendar` | 31 | `GET` | ✅ ACTIVE | ./src/app/api/devil/calendar/route.ts, ./src/components/devil |
| 221 | `/api/devil/card/[ticker]` | 84 | `GET` | ✅ ACTIVE | ./src/app/api/devil/card/[ticker]/route.ts, ./src/components/ |
| 222 | `/api/devil/filter` | 63 | `POST` | ✅ ACTIVE | ./src/app/api/devil/filter/route.ts |
| 223 | `/api/devil/market-mood` | 28 | `GET` | ✅ ACTIVE | ./src/components/devil/MarketMood.tsx |
| 224 | `/api/devil/scenario/[ticker]` | 69 | `GET` | ✅ ACTIVE | ./src/app/api/devil/scenario/[ticker]/route.ts, ./src/compone |
| 225 | `/api/disclosures/company/[symbol]` | 149 | `GET` | ✅ ACTIVE | ./src/app/api/disclosures/company/[symbol]/route.ts |
| 226 | `/api/dividend-analysis` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 227 | `/api/dividend-calendar` | 106 | `GET,POST` | ✅ ACTIVE | ./src/app/api/dividend-calendar/route.ts |
| 228 | `/api/dynamic-analysis` | 66 | `GET` | ✅ ACTIVE | ./src/app/api/dynamic-analysis/route.ts |
| 229 | `/api/egx/investors` | 477 | `GET` | ✅ ACTIVE | ./src/app/api/egx/investors/route.ts, ./src/app/api/egx/inves |
| 230 | `/api/egx/investors/seed` | 340 | `POST,GET` | ✅ ACTIVE | ./src/app/api/egx/investors/seed/route.ts |
| 231 | `/api/egxpilot/analysis/[ticker]` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 232 | `/api/egxpilot/news` | 53 | `GET` | ✅ ACTIVE | ./src/app/api/egxpilot/news/route.ts, ./src/lib/api-client.ts |
| 233 | `/api/egxpilot/stocks` | 174 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 234 | `/api/eodhd/backfill-status` | 56 | `GET` | ✅ ACTIVE | ./src/app/api/eodhd/backfill-status/route.ts, ./vps-service/l |
| 235 | `/api/expert-recommendations` | 301 | `GET,POST,PUT,DELETE` | ✅ ACTIVE | ./news-agent/analyzer/recommendation_aggregator.py, ./news-ag |
| 236 | `/api/expert-recommendations/active` | 42 | `GET` | ✅ ACTIVE | ./src/app/api/expert-recommendations/active/route.ts, ./vps-s |
| 237 | `/api/expert-recommendations/batch` | 28 | `GET` | ✅ ACTIVE | ./src/components/admin/HumanRecommendationsAdmin.tsx |
| 238 | `/api/expert-recommendations/experts` | 74 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 239 | `/api/expert-recommendations/import` | 157 | `POST` | ✅ ACTIVE | ./news-agent/analyzer/recommendation_aggregator.py, ./news-ag |
| 240 | `/api/explosive` | 26 | `GET` | ✅ ACTIVE | ./src/app/api/cron/screener/route.ts, ./src/app/api/explosive |
| 241 | `/api/explosive/[ticker]` | 70 | `GET` | ✅ ACTIVE | ./src/app/api/cron/screener/route.ts, ./src/app/api/explosive |
| 242 | `/api/explosive/hunt` | 242 | `GET` | ✅ ACTIVE | ./src/app/api/explosive/hunt/route.ts, ./vps-service/lightwei |
| 243 | `/api/export` | 459 | `GET` | ✅ ACTIVE | ./src/app/api/export/route.ts, ./src/components/reports/DataM |
| 244 | `/api/features` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/proxy-prod/[...path]/route.ts |
| 245 | `/api/feedback` | 144 | `GET,POST` | ✅ ACTIVE | ./skills/skill-creator/eval-viewer/generate_review.py, ./src/ |
| 246 | `/api/finance/assets` | 412 | `GET,POST,PUT,DELETE` | ✅ ACTIVE | ./src/app/api/finance/assets/[id]/route.ts, ./src/app/api/fin |
| 247 | `/api/finance/assets/[id]` | 159 | `PUT,DELETE` | ✅ ACTIVE | ./src/app/api/finance/assets/[id]/route.ts, ./src/components/ |
| 248 | `/api/finance/calculate-values` | 638 | `GET` | ✅ ACTIVE | ./scripts/drop_stale_gold_prices.py, ./src/app/api/finance/ca |
| 249 | `/api/finance/inflation` | 72 | `POST,GET` | ✅ ACTIVE | ./scripts/update_macro_indicators.py, ./src/app/api/finance/i |
| 250 | `/api/finance/obligations` | 339 | `GET,POST,PUT,DELETE` | ✅ ACTIVE | ./src/app/api/finance/obligations/payments/route.ts, ./src/ap |
| 251 | `/api/finance/obligations/payments` | 169 | `GET,POST` | ✅ ACTIVE | ./src/app/api/finance/obligations/payments/route.ts, ./src/co |
| 252 | `/api/finance/portfolio-analysis` | 173 | `GET` | ✅ ACTIVE | ./src/app/api/finance/portfolio-analysis/route.ts |
| 253 | `/api/finance/projection` | 178 | `GET` | ✅ ACTIVE | ./src/app/api/finance/projection/route.ts, ./src/components/p |
| 254 | `/api/finance/real-return` | 132 | `GET` | ✅ ACTIVE | ./src/app/api/finance/real-return/route.ts, ./src/components/ |
| 255 | `/api/finance/reports` | 125 | `GET` | ✅ ACTIVE | ./src/app/api/finance/reports/route.ts, ./src/components/aler |
| 256 | `/api/finance/schema` | 187 | `POST` | ✅ ACTIVE | ./src/app/api/finance/schema/route.ts, ./src/app/page.tsx |
| 257 | `/api/finance/screener` | 266 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 258 | `/api/finance/seed-alert-thresholds` | 259 | `GET,POST` | ✅ ACTIVE | ./src/app/api/finance/seed-alert-thresholds/route.ts |
| 259 | `/api/finance/smart-alerts` | 400 | `GET` | ✅ ACTIVE | ./scripts/patch_smart_alerts.py, ./src/components/alerts/Smar |
| 260 | `/api/finance/smart-analysis` | 181 | `GET` | ✅ ACTIVE | ./src/app/api/finance/smart-analysis/route.ts, ./src/componen |
| 261 | `/api/finance/smart-confluence` | 258 | `GET,POST` | ✅ ACTIVE | ./src/app/api/finance/smart-confluence/route.ts, ./src/compon |
| 262 | `/api/finance/smart-watchlist` | 268 | `GET` | ✅ ACTIVE | ./src/app/api/finance/smart-watchlist/route.ts, ./src/compone |
| 263 | `/api/finance/transactions` | 147 | `GET,POST` | ✅ ACTIVE | ./src/app/api/finance/transactions/[id]/route.ts, ./src/app/a |
| 264 | `/api/finance/transactions/[id]` | 42 | `DELETE` | ✅ ACTIVE | ./src/app/api/finance/transactions/[id]/route.ts, ./src/compo |
| 265 | `/api/flow` | 13 | `GET` | ✅ ACTIVE | ./src/app/api/advanced-analysis/route.ts, ./src/app/api/ai-pr |
| 266 | `/api/flow/[ticker]` | 60 | `GET` | ✅ ACTIVE | ./src/app/api/advanced-analysis/route.ts, ./src/app/api/ai-pr |
| 267 | `/api/fomo/missed-opportunities` | 116 | `GET` | ✅ ACTIVE | ./src/app/api/fomo/missed-opportunities/route.ts |
| 268 | `/api/global-predictions` | 46 | `GET` | ✅ ACTIVE | ./src/app/api/global-predictions/route.ts |
| 269 | `/api/google-play/verify-receipt` | 170 | `POST` | ✅ ACTIVE | ./src/app/api/google-play/verify-receipt/route.ts |
| 270 | `/api/health` | 60 | `GET` | ✅ ACTIVE | ./scripts/smoke_load_test.py, ./src/app/api/admin/system-heal |
| 271 | `/api/historical/start` | 115 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 272 | `/api/historical/status` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 273 | `/api/hunter/cache-status` | 33 | `GET` | ✅ ACTIVE | ./src/app/api/hunter/cache-status/route.ts |
| 274 | `/api/hunter/daily-picks` | 48 | `GET` | ✅ ACTIVE | ./src/app/api/hunter/daily-picks/route.ts |
| 275 | `/api/hunter/publish-pick` | 63 | `POST` | ✅ ACTIVE | ./src/app/api/hunter/publish-pick/route.ts, ./src/lib/pick-fo |
| 276 | `/api/hunter/refresh` | 47 | `POST` | ✅ ACTIVE | ./src/app/api/hunter/refresh/route.ts |
| 277 | `/api/hunter/screener` | 46 | `GET` | ✅ ACTIVE | ./src/app/api/hunter/screener/route.ts |
| 278 | `/api/import` | 254 | `POST` | ✅ ACTIVE | ./src/app/api/import/route.ts |
| 279 | `/api/indicator-trust-scores` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/indicator-trust-scores/route.ts |
| 280 | `/api/init-db` | 28 | `GET` | ✅ ACTIVE | ./src/app/page.tsx |
| 281 | `/api/instapay` | 127 | `GET,POST` | ✅ ACTIVE | ./src/components/publishing/UserPublishingView.tsx |
| 282 | `/api/instapay/approve` | 118 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 283 | `/api/instapay/verify` | 178 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 284 | `/api/iterative-learning` | 28 | `GET` | ✅ ACTIVE | ./src/components/admin/SuperLearningSystem.tsx |
| 285 | `/api/keepalive` | 12 | `GET` | ✅ ACTIVE | ./src/components/Providers.tsx, ./src/middleware.ts |
| 286 | `/api/kimi/backtest/run` | 133 | `POST,GET` | ✅ ACTIVE | ./src/app/api/kimi/backtest/run/route.ts |
| 287 | `/api/learning-params` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 288 | `/api/learning-params/active` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 289 | `/api/learning-params/init` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 290 | `/api/learning-params/save` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 291 | `/api/learning/content` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 292 | `/api/learning/indicators` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/learning/indicators/route.ts |
| 293 | `/api/learning/patterns` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/learning/patterns/route.ts |
| 294 | `/api/learning/progress` | 94 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 295 | `/api/learning/status` | 35 | `GET` | ✅ ACTIVE | ./src/app/api/learning/status/route.ts, ./vps-service/api/lea |
| 296 | `/api/legal/privacy` | 137 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 297 | `/api/legal/terms` | 168 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 298 | `/api/live-monitor` | 178 | `GET` | ✅ ACTIVE | ./src/app/api/finance/calculate-values/route.ts, ./src/app/ap |
| 299 | `/api/live-monitor/ledger` | 436 | `GET` | ✅ ACTIVE | ./src/app/api/live-monitor/ledger/route.ts, ./src/lib/use-liv |
| 300 | `/api/live-monitor/trigger` | 42 | `POST` | ✅ ACTIVE | ./src/app/api/live-monitor/trigger/route.ts, ./src/components |
| 301 | `/api/live/analysis/[ticker]` | 17 | `GET` | ✅ ACTIVE | ./src/app/api/live/analysis/[ticker]/route.ts, ./vps-service/ |
| 302 | `/api/live/scan` | 51 | `GET` | ✅ ACTIVE | ./src/app/api/live/scan/route.ts, ./vps-service/api/public_ro |
| 303 | `/api/maestro` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/admin/generate-historical-predictions/route.ts |
| 304 | `/api/maestro/command-center` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 305 | `/api/maestro/config` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 306 | `/api/maestro/logic-panel` | 573 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 307 | `/api/maestro/news` | 28 | `GET` | ✅ ACTIVE | ./vps-service/api/maestro_routes.py |
| 308 | `/api/maestro/overview` | 28 | `GET` | ✅ ACTIVE | ./src/components/dashboard/MaestroWidget.tsx, ./vps-service/a |
| 309 | `/api/maestro/personas` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 310 | `/api/maestro/signals` | 28 | `GET` | ✅ ACTIVE | ./vps-service/api/maestro_routes.py |
| 311 | `/api/maestro/stock/[ticker]` | 111 | `GET` | ✅ ACTIVE | ./src/app/api/ai/analyze-stock/route.ts, ./src/app/api/maestr |
| 312 | `/api/maker-radar` | 134 | `GET` | ✅ ACTIVE | ./src/app/api/maker-radar/entry-timing/route.ts, ./src/app/ap |
| 313 | `/api/maker-radar/entry-timing` | 256 | `GET` | ✅ ACTIVE | ./src/app/api/maker-radar/entry-timing/route.ts, ./src/compon |
| 314 | `/api/maker-radar/footprint` | 388 | `GET` | ✅ ACTIVE | ./src/app/api/maker-radar/footprint/route.ts, ./src/component |
| 315 | `/api/maker-radar/live-watch` | 284 | `GET` | ✅ ACTIVE | ./src/app/api/maker-radar/live-watch/route.ts |
| 316 | `/api/maker-radar/sector-treemap` | 342 | `GET` | ✅ ACTIVE | ./src/app/api/maker-radar/sector-treemap/route.ts, ./src/comp |
| 317 | `/api/maker-radar/signal-tracker` | 372 | `GET,POST` | ✅ ACTIVE | ./src/app/api/maker-radar/signal-tracker/route.ts, ./src/app/ |
| 318 | `/api/maker-radar/signal-tracker/verify` | 387 | `POST` | ✅ ACTIVE | ./src/app/api/maker-radar/signal-tracker/verify/route.ts, ./s |
| 319 | `/api/maker-radar/stock` | 159 | `GET` | ✅ ACTIVE | ./src/components/predictions/MakerRadarTab.tsx |
| 320 | `/api/maker-radar/track` | 147 | `POST,GET,DELETE` | ✅ ACTIVE | ./src/app/api/maker-radar/track/route.ts, ./src/components/pr |
| 321 | `/api/maker-radar/warmup` | 62 | `GET,POST` | ✅ ACTIVE | ./src/app/api/maker-radar/route.ts, ./src/app/api/maker-radar |
| 322 | `/api/market-learning` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 323 | `/api/market-pulse` | 147 | `GET` | ✅ ACTIVE | ./scripts/smoke_load_test.py, ./src/app/api/admin/ab-test/rou |
| 324 | `/api/market-screen` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 325 | `/api/market/auto-seed` | 65 | `GET` | ✅ ACTIVE | ./src/app/api/market/auto-seed/route.ts |
| 326 | `/api/market/bulk-update` | 28 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 327 | `/api/market/connections` | 230 | `GET` | ✅ ACTIVE | ./src/app/api/market/connections/route.ts, ./src/components/a |
| 328 | `/api/market/continuation/[ticker]` | 62 | `GET` | ✅ ACTIVE | ./src/app/api/market/continuation/[ticker]/route.ts, ./src/ap |
| 329 | `/api/market/exit-status` | 91 | `GET` | ✅ ACTIVE | ./src/app/api/market/exit-status/route.ts, ./src/app/api/mobi |
| 330 | `/api/market/gold` | 59 | `GET` | ✅ ACTIVE | ./src/app/api/market/gold/route.ts, ./src/lib/api-client.ts |
| 331 | `/api/market/incremental-sync` | 36 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 332 | `/api/market/indices` | 34 | `GET` | ✅ ACTIVE | ./src/app/api/market/indices/route.ts, ./src/lib/api-client.t |
| 333 | `/api/market/intraday-pressure` | 348 | `GET` | ✅ ACTIVE | ./src/app/api/market/intraday-pressure/route.ts, ./src/compon |
| 334 | `/api/market/investing` | 152 | `GET` | ✅ ACTIVE | ./src/app/api/market/investing/route.ts |
| 335 | `/api/market/liquidity-flow` | 472 | `GET` | ✅ ACTIVE | ./src/app/api/market/liquidity-flow/route.ts, ./src/component |
| 336 | `/api/market/live-data` | 240 | `GET` | ✅ ACTIVE | ./src/app/api/market/live-data/route.ts |
| 337 | `/api/market/morning-bell` | 60 | `GET` | ✅ ACTIVE | ./src/app/api/market/morning-bell/route.ts, ./src/app/api/mob |
| 338 | `/api/market/overview` | 137 | `GET` | ✅ ACTIVE | ./src/app/api/admin/sync-vps/route.ts, ./src/app/api/market/o |
| 339 | `/api/market/publish-status-image` | 81 | `POST` | ✅ ACTIVE | ./src/app/api/market/publish-status-image/route.ts, ./src/com |
| 340 | `/api/market/recommendations/ai-insights` | 65 | `GET` | ✅ ACTIVE | ./src/app/api/market/recommendations/ai-insights/route.ts, ./ |
| 341 | `/api/market/refresh-data` | 125 | `GET,POST` | ✅ ACTIVE | ./src/app/api/market/refresh-data/route.ts |
| 342 | `/api/market/report/daily` | 95 | `GET` | ✅ ACTIVE | ./src/app/api/market/report/daily/route.ts |
| 343 | `/api/market/report/status` | 40 | `GET` | ✅ ACTIVE | ./src/app/api/market/report/status/route.ts |
| 344 | `/api/market/report/weekly` | 80 | `GET` | ✅ ACTIVE | ./src/app/api/market/report/weekly/route.ts |
| 345 | `/api/market/scheduled-sync` | 521 | `POST,GET` | ✅ ACTIVE | ./src/app/api/cron/auto-sync/route.ts, ./src/app/api/market/s |
| 346 | `/api/market/sectors` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/market/sectors/intelligence/route.ts, ./src/com |
| 347 | `/api/market/sectors/intelligence` | 300 | `GET` | ✅ ACTIVE | ./src/app/api/market/sectors/intelligence/route.ts, ./src/com |
| 348 | `/api/market/seed-historical` | 86 | `POST,GET` | ✅ ACTIVE | ./src/app/api/market/seed-historical/route.ts |
| 349 | `/api/market/status` | 41 | `GET` | ✅ ACTIVE | ./src/components/analysis/market-analysis/MarketStatusTab.ts |
| 350 | `/api/market/summary` | 194 | `GET` | ✅ ACTIVE | ./src/app/api/market/summary/route.ts |
| 351 | `/api/market/sync` | 270 | `POST,GET` | ✅ ACTIVE | ./src/app/api/market/live-data/route.ts, ./src/app/api/market |
| 352 | `/api/market/sync-historical` | 28 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 353 | `/api/market/sync-live` | 526 | `POST` | ✅ ACTIVE | ./src/app/api/market/live-data/route.ts, ./src/app/api/market |
| 354 | `/api/market/test-sources` | 98 | `GET,POST` | ✅ ACTIVE | ./src/app/api/market/test-sources/route.ts |
| 355 | `/api/market/top-movers` | 75 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 356 | `/api/metals-forex/start` | 99 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 357 | `/api/metals-forex/status` | 80 | `GET` | ✅ ACTIVE | ./src/components/academy/PaperTradingWorkstation.tsx |
| 358 | `/api/metals-forex/stop` | 33 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 359 | `/api/metals/gold` | 214 | `GET` | ✅ ACTIVE | ./src/app/api/metals/gold/history/route.ts, ./src/app/api/met |
| 360 | `/api/metals/gold/history` | 17 | `GET` | ✅ ACTIVE | ./src/app/api/metals/gold/history/route.ts, ./src/app/api/mob |
| 361 | `/api/mobile/ai/recommendations` | 115 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/ai/recommendations/route.ts |
| 362 | `/api/mobile/alerts/check` | 336 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/alerts/check/route.ts |
| 363 | `/api/mobile/alerts/settings` | 286 | `GET,POST,DELETE` | ✅ ACTIVE | ./src/app/api/mobile/alerts/settings/route.ts, ./src/middlewa |
| 364 | `/api/mobile/analysis/EGX` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 365 | `/api/mobile/analysis/[ticker]` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 366 | `/api/mobile/auth/me` | 87 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/auth/me/route.ts |
| 367 | `/api/mobile/community` | 93 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 368 | `/api/mobile/crypto` | 195 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/crypto/[id]/route.ts, ./src/app/api/mobi |
| 369 | `/api/mobile/crypto/[id]` | 60 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/crypto/[id]/route.ts, ./src/app/api/mobi |
| 370 | `/api/mobile/crypto/analysis` | 159 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/crypto/analysis/route.ts |
| 371 | `/api/mobile/crypto/learning` | 197 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 372 | `/api/mobile/crypto/portfolio` | 150 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/crypto/portfolio/route.ts |
| 373 | `/api/mobile/crypto/recommendations` | 174 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 374 | `/api/mobile/crypto/watchlist` | 135 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 375 | `/api/mobile/currency` | 79 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 376 | `/api/mobile/dashboard` | 163 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/dashboard/route.ts |
| 377 | `/api/mobile/expert-recommendations` | 138 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/expert-recommendations/route.ts |
| 378 | `/api/mobile/gold` | 95 | `GET` | ✅ ACTIVE | ./src/app/api/market/gold/route.ts, ./src/app/api/metals/gold |
| 379 | `/api/mobile/gold/history` | 17 | `GET` | ✅ ACTIVE | ./src/app/api/metals/gold/history/route.ts, ./src/app/api/mob |
| 380 | `/api/mobile/learning` | 309 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 381 | `/api/mobile/maestro` | 150 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 382 | `/api/mobile/market/morning-bell` | 156 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/market/morning-bell/route.ts |
| 383 | `/api/mobile/market/overview` | 121 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/market/overview/route.ts |
| 384 | `/api/mobile/market/recommendations/ai-insights` | 147 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/market/recommendations/ai-insights/rout |
| 385 | `/api/mobile/news` | 219 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 386 | `/api/mobile/notifications` | 155 | `GET,POST` | ✅ ACTIVE | ./src/app/api/mobile/notifications/route.ts, ./src/middleware |
| 387 | `/api/mobile/portfolio` | 318 | `GET,POST,DELETE` | ✅ ACTIVE | ./src/app/api/mobile/portfolio/analyze/route.ts, ./src/app/ap |
| 388 | `/api/mobile/portfolio/analyze` | 187 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/portfolio/analyze/route.ts |
| 389 | `/api/mobile/portfolio/intelligence` | 170 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/portfolio/intelligence/route.ts |
| 390 | `/api/mobile/predictions` | 100 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/predictions/continuation/route.ts, ./src |
| 391 | `/api/mobile/predictions/continuation` | 70 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/predictions/continuation/route.ts |
| 392 | `/api/mobile/predictions/exit-status` | 181 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/predictions/exit-status/route.ts |
| 393 | `/api/mobile/recommendations` | 155 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/recommendations/route.ts, ./src/middlewa |
| 394 | `/api/mobile/reports` | 194 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/reports/route.ts |
| 395 | `/api/mobile/risk` | 139 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/risk/route.ts |
| 396 | `/api/mobile/seasonality` | 132 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/seasonality/route.ts |
| 397 | `/api/mobile/signals` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 398 | `/api/mobile/stocks/EGX/professional-analysis` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 399 | `/api/mobile/stocks/EGX/recommendation` | 139 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/stocks/EGX/recommendation/route.ts |
| 400 | `/api/mobile/stocks/[ticker]` | 97 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/stocks/EGX/recommendation/route.ts, ./sr |
| 401 | `/api/mobile/stocks/[ticker]/professional-analysis` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/stocks/EGX/recommendation/route.ts, ./sr |
| 402 | `/api/mobile/stocks/[ticker]/recommendation` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/stocks/EGX/recommendation/route.ts, ./sr |
| 403 | `/api/mobile/subscription` | 140 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 404 | `/api/mobile/summary` | 122 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/summary/route.ts |
| 405 | `/api/mobile/watchlist` | 277 | `GET,POST,DELETE` | ✅ ACTIVE | ./src/app/api/mobile/watchlist-enhanced/route.ts, ./src/app/a |
| 406 | `/api/mobile/watchlist-enhanced` | 228 | `GET,POST` | ✅ ACTIVE | ./src/app/api/mobile/watchlist-enhanced/route.ts |
| 407 | `/api/mobile/watchlist/intelligence` | 46 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/watchlist/intelligence/route.ts, ./src/c |
| 408 | `/api/mobile/zakat-calculator` | 47 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/zakat-calculator/route.ts |
| 409 | `/api/money` | 220 | `GET` | ✅ ACTIVE | ./src/app/api/money/route.ts, ./src/components/admin/WealthCh |
| 410 | `/api/money/smart-monitor` | 108 | `GET` | ✅ ACTIVE | ./src/components/admin/WealthCharts.tsx |
| 411 | `/api/money/wealth` | 97 | `GET` | ✅ ACTIVE | ./src/components/admin/WealthCharts.tsx |
| 412 | `/api/monthly-performance` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 413 | `/api/mubasher/sync` | 576 | `POST,GET` | ✅ ACTIVE | ./src/app/api/mubasher/sync/route.ts |
| 414 | `/api/multi-market/sync` | 123 | `POST,GET` | ✅ ACTIVE | ./src/app/api/multi-market/sync/route.ts, ./src/components/ad |
| 415 | `/api/news` | 193 | `GET,POST` | ✅ ACTIVE | ./news-agent/sender/production_sender.py, ./scripts/migrate-n |
| 416 | `/api/news-feed` | 391 | `GET,POST` | ✅ ACTIVE | ./src/app/api/admin/news/route.ts, ./src/app/api/proxy-prod/[ |
| 417 | `/api/news/apikeys` | 167 | `GET,POST,DELETE` | ⚠️ ORPHAN | _(none)_ |
| 418 | `/api/news/apikeys/verify` | 161 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 419 | `/api/news/ingest` | 186 | `POST,GET` | ✅ ACTIVE | ./src/app/api/news/ingest/route.ts |
| 420 | `/api/news/latest` | 253 | `GET` | ✅ ACTIVE | ./src/app/api/news/latest/route.ts |
| 421 | `/api/notifications` | 263 | `GET,POST` | ✅ ACTIVE | ./src/app/api/notifications/route.ts, ./src/components/notifi |
| 422 | `/api/paper-trading` | 380 | `GET,POST` | ✅ ACTIVE | ./src/app/api/paper-trading-v2/account/route.ts, ./src/app/ap |
| 423 | `/api/paper-trading-v2/account` | 38 | `GET` | ✅ ACTIVE | ./src/app/api/paper-trading-v2/account/route.ts, ./src/compon |
| 424 | `/api/paper-trading-v2/order` | 69 | `POST` | ✅ ACTIVE | ./src/app/api/paper-trading-v2/order/route.ts, ./src/app/api/ |
| 425 | `/api/paper-trading-v2/orders` | 45 | `GET` | ✅ ACTIVE | ./src/app/api/paper-trading-v2/orders/[id]/close/route.ts, ./ |
| 426 | `/api/paper-trading-v2/orders/[id]/close` | 55 | `POST` | ✅ ACTIVE | ./src/app/api/paper-trading-v2/orders/[id]/close/route.ts, ./ |
| 427 | `/api/paper-trading-v2/positions` | 149 | `GET` | ✅ ACTIVE | ./src/app/api/paper-trading-v2/positions/route.ts, ./src/comp |
| 428 | `/api/paper-trading-v2/reset` | 35 | `POST` | ✅ ACTIVE | ./src/app/api/paper-trading-v2/reset/route.ts, ./src/componen |
| 429 | `/api/parse-recommendations` | 300 | `POST,GET` | ✅ ACTIVE | ./src/components/analysis/ExpertRecommendationsPanel.tsx |
| 430 | `/api/payments/result` | 66 | `GET` | ✅ ACTIVE | ./src/app/api/payments/result/route.ts |
| 431 | `/api/paymob/callback` | 267 | `GET,POST` | ✅ ACTIVE | ./src/__tests__/test_phase_a_hotfix.test.ts, ./src/app/api/pa |
| 432 | `/api/paymob/create-payment` | 231 | `POST` | ✅ ACTIVE | ./src/app/api/paymob/create-payment/route.ts, ./src/app/api/s |
| 433 | `/api/paymob/process-wallet` | 63 | `POST` | ✅ ACTIVE | ./src/app/api/paymob/process-wallet/route.ts, ./src/component |
| 434 | `/api/persona/analyze/[ticker]` | 187 | `GET` | ✅ ACTIVE | ./src/app/api/persona/analyze/[ticker]/route.ts |
| 435 | `/api/persona/gambler` | 62 | `GET` | ✅ ACTIVE | ./src/app/api/persona/gambler/route.ts, ./src/app/api/persona |
| 436 | `/api/persona/investor` | 62 | `GET` | ✅ ACTIVE | ./src/app/api/persona/investor/route.ts, ./src/app/api/person |
| 437 | `/api/persona/recommendations` | 117 | `GET` | ✅ ACTIVE | ./src/app/api/persona/recommendations/route.ts |
| 438 | `/api/points` | 116 | `GET` | ✅ ACTIVE | ./src/components/publishing/UserPublishingView.tsx |
| 439 | `/api/points/leaderboard` | 64 | `GET` | ✅ ACTIVE | ./src/components/publishing/UserPublishingView.tsx |
| 440 | `/api/portfolio` | 42 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/accounts/[id]/equity-curve/route.ts,  |
| 441 | `/api/portfolio/accounts` | 124 | `GET,POST` | ✅ ACTIVE | ./src/app/api/portfolio/accounts/[id]/equity-curve/route.ts,  |
| 442 | `/api/portfolio/accounts/[id]/equity-curve` | 37 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/accounts/[id]/equity-curve/route.ts,  |
| 443 | `/api/portfolio/accounts/[id]/state` | 37 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/accounts/[id]/equity-curve/route.ts,  |
| 444 | `/api/portfolio/analyze` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 445 | `/api/portfolio/assets` | 67 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 446 | `/api/portfolio/bag-holder-rescue` | 308 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/bag-holder-rescue/route.ts, ./src/com |
| 447 | `/api/portfolio/cashflow` | 160 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/cashflow/route.ts, ./src/components/p |
| 448 | `/api/portfolio/check` | 211 | `POST,GET` | ✅ ACTIVE | ./src/app/api/portfolio/check/route.ts |
| 449 | `/api/portfolio/equity-curve` | 194 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/equity-curve/route.ts, ./src/componen |
| 450 | `/api/portfolio/equity/curve` | 46 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/equity/curve/route.ts, ./src/componen |
| 451 | `/api/portfolio/holdings` | 333 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/assets/route.ts, ./src/app/api/portfo |
| 452 | `/api/portfolio/import-real` | 222 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 453 | `/api/portfolio/intelligence` | 192 | `GET` | ✅ ACTIVE | ./src/components/portfolio/PortfolioIntelligencePanel.tsx |
| 454 | `/api/portfolio/master` | 411 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/master/route.ts, ./src/components/por |
| 455 | `/api/portfolio/priority-sync` | 213 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/priority-sync/route.ts |
| 456 | `/api/portfolio/risk-summary` | 262 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/risk-summary/route.ts, ./src/componen |
| 457 | `/api/portfolio/smart-monitor/signals` | 264 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/smart-monitor/signals/route.ts, ./src |
| 458 | `/api/portfolio/state` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/state/route.ts, ./src/components/port |
| 459 | `/api/portfolio/watchlists` | 179 | `GET` | ✅ ACTIVE | ./src/app/api/portfolio/watchlists/route.ts, ./src/components |
| 460 | `/api/prediction-performance` | 35 | `GET` | ✅ ACTIVE | ./scripts/migrate-db.ts, ./src/app/admin/honest-predictions/p |
| 461 | `/api/predictions` | 158 | `GET,POST` | ✅ ACTIVE | ./next.config.mjs, ./scripts/monitor_live_session.py, ./src/ap |
| 462 | `/api/predictions/active-management` | 249 | `GET` | ✅ ACTIVE | ./next.config.mjs, ./src/app/api/predictions/active-managemen |
| 463 | `/api/predictions/backtest-list` | 185 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/backtest-list/route.ts, ./src/compo |
| 464 | `/api/predictions/credibility` | 489 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 465 | `/api/predictions/daily-picks` | 223 | `GET` | ✅ ACTIVE | ./next.config.mjs, ./src/app/api/predictions/daily-picks/rout |
| 466 | `/api/predictions/dual-track/backtest` | 157 | `GET,POST` | ✅ ACTIVE | ./src/app/api/predictions/dual-track/backtest/route.ts, ./src |
| 467 | `/api/predictions/dual-track/list` | 168 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/dual-track/list/route.ts, ./src/com |
| 468 | `/api/predictions/dual-track/stats` | 238 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/dual-track/stats/route.ts, ./src/ap |
| 469 | `/api/predictions/dual-track/threshold` | 274 | `GET,POST` | ✅ ACTIVE | ./src/app/api/predictions/dual-track/threshold/route.ts, ./sr |
| 470 | `/api/predictions/eid` | 256 | `GET,POST` | ✅ ACTIVE | ./src/components/eid-predictions-widget.tsx |
| 471 | `/api/predictions/expert-consensus` | 449 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/expert-consensus/route.ts, ./src/co |
| 472 | `/api/predictions/export-pdf` | 391 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 473 | `/api/predictions/generate` | 28 | `POST` | ✅ ACTIVE | ./src/components/recommendations/RefreshAnalyticsButton.tsx,  |
| 474 | `/api/predictions/generate-all` | 49 | `POST` | ✅ ACTIVE | ./src/components/recommendations/RefreshAnalyticsButton.tsx,  |
| 475 | `/api/predictions/honest-tracking` | 63 | `GET` | ✅ ACTIVE | ./scripts/monitor_live_session.py, ./src/app/admin/honest-pre |
| 476 | `/api/predictions/honest-tracking/learn-from-errors` | 211 | `GET,POST` | ✅ ACTIVE | ./src/app/admin/honest-predictions/page.tsx, ./src/app/api/pr |
| 477 | `/api/predictions/honest-tracking/list` | 643 | `GET` | ✅ ACTIVE | ./src/app/admin/honest-predictions/page.tsx, ./src/app/api/pr |
| 478 | `/api/predictions/honest-tracking/live-tracking` | 309 | `GET` | ✅ ACTIVE | ./scripts/monitor_live_session.py, ./src/components/predictio |
| 479 | `/api/predictions/honest-tracking/missed-opportunities` | 312 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/honest-tracking/missed-opportuniti |
| 480 | `/api/predictions/honest-tracking/stats` | 615 | `GET` | ✅ ACTIVE | ./src/app/admin/honest-predictions/page.tsx, ./src/app/api/pr |
| 481 | `/api/predictions/honest-tracking/verify-pending` | 72 | `POST` | ✅ ACTIVE | ./src/app/admin/honest-predictions/page.tsx, ./src/app/api/pr |
| 482 | `/api/predictions/intraday` | 87 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 483 | `/api/predictions/league-report` | 69 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/league-report/route.ts, ./src/compo |
| 484 | `/api/predictions/live` | 198 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 485 | `/api/predictions/monthly-league` | 38 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/monthly-league/route.ts, ./src/comp |
| 486 | `/api/predictions/performance` | 44 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/performance-dashboard/route.ts, ./s |
| 487 | `/api/predictions/performance-dashboard` | 333 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/performance-dashboard/route.ts, ./s |
| 488 | `/api/predictions/price-verify` | 362 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 489 | `/api/predictions/refresh-v40` | 283 | `POST,GET` | ✅ ACTIVE | ./src/app/api/predictions/refresh-v40/route.ts, ./src/compone |
| 490 | `/api/predictions/seed` | 31 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 491 | `/api/predictions/tracking` | 70 | `GET,POST` | ✅ ACTIVE | ./src/app/api/predictions/export-pdf/route.ts, ./src/app/api/ |
| 492 | `/api/predictions/tracking/list` | 86 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/tracking/list/route.ts, ./src/compo |
| 493 | `/api/predictions/tracking/stats` | 49 | `GET` | ✅ ACTIVE | ./src/app/api/predictions/tracking/stats/route.ts, ./src/comp |
| 494 | `/api/predictions/tracking/verify` | 54 | `POST` | ✅ ACTIVE | ./src/app/api/predictions/honest-tracking/verify-pending/rou |
| 495 | `/api/predictions/verify` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 496 | `/api/proxy-prod/[...path]` | 259 | `GET,POST,PUT,DELETE` | ✅ ACTIVE | ./src/app/api/proxy-prod/[...path]/route.ts, ./vps-service/an |
| 497 | `/api/proxy/[...path]` | 199 | `GET,POST,PUT,DELETE,PATCH` | ✅ ACTIVE | ./scripts/verify_python_architecture.py, ./src/app/api/proxy/ |
| 498 | `/api/push/register` | 123 | `POST,GET` | ✅ ACTIVE | ./src/app/api/push/register/route.ts |
| 499 | `/api/python/[...path]` | 70 | `GET,POST,PUT,DELETE,PATCH` | ✅ ACTIVE | ./src/app/api/proxy/[...path]/route.ts, ./src/app/api/python/ |
| 500 | `/api/real-predictions` | 28 | `POST` | ✅ ACTIVE | ./src/app/api/ai-performance/route.ts |
| 501 | `/api/recommendations` | 28 | `GET` | ✅ ACTIVE | ./news-agent/ui/app.js, ./news-agent/ui/dashboard.py, ./src/ap |
| 502 | `/api/recommendations/backtest` | 28 | `GET` | ✅ ACTIVE | ./src/components/recommendations/RecommendationMonitoring.ts |
| 503 | `/api/recommendations/batch` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 504 | `/api/recommendations/expert` | 21 | `?` | ✅ ACTIVE | ./src/app/api/recommendations/expert/route.ts |
| 505 | `/api/recommendations/publish` | 70 | `POST` | ✅ ACTIVE | ./src/app/api/recommendations/publish/batch/route.ts, ./src/a |
| 506 | `/api/recommendations/publish/batch` | 57 | `POST` | ✅ ACTIVE | ./src/app/api/recommendations/publish/batch/route.ts |
| 507 | `/api/recommendations/retroactive-evaluate` | 178 | `POST` | ✅ ACTIVE | ./src/components/recommendations/RecommendationMonitoring.ts |
| 508 | `/api/recommendations/verify` | 28 | `GET` | ✅ ACTIVE | ./src/components/recommendations/RecommendationMonitoring.ts |
| 509 | `/api/redeem-promo` | 315 | `POST` | ✅ ACTIVE | ./src/app/api/redeem-promo/route.ts, ./src/components/subscri |
| 510 | `/api/reports/daily` | 28 | `GET` | ✅ ACTIVE | ./src/lib/vps-adapter.ts, ./vps-service/api/reports_routes.py |
| 511 | `/api/reports/morning` | 230 | `GET,POST,DELETE` | ✅ ACTIVE | ./src/app/api/reports/morning/route.ts |
| 512 | `/api/reports/weekly` | 28 | `GET` | ✅ ACTIVE | ./vps-service/api/reports_routes.py |
| 513 | `/api/risk/decision-table` | 54 | `GET` | ✅ ACTIVE | ./src/app/api/data-engine/health/route.ts, ./src/app/api/risk |
| 514 | `/api/risk/position-size` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 515 | `/api/risk/stock-types` | 32 | `GET` | ✅ ACTIVE | ./src/app/api/risk/stock-types/route.ts, ./vps-service/risk_m |
| 516 | `/api/risk/stop-loss` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 517 | `/api/risk/targets` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 518 | `/api/run-all` | 146 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 519 | `/api/scanner/quick` | 293 | `GET` | ✅ ACTIVE | ./src/app/api/admin/daily-analysis/route.ts, ./src/app/api/co |
| 520 | `/api/scanner/run` | 134 | `GET,POST` | ✅ ACTIVE | ./src/app/api/scanner/run/route.ts |
| 521 | `/api/scheduler/run` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 522 | `/api/scraper/start` | 136 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 523 | `/api/scraper/status` | 17 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 524 | `/api/scraper/stop` | 6 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 525 | `/api/screener/advanced` | 247 | `GET` | ✅ ACTIVE | ./src/app/api/screener/advanced/route.ts, ./src/components/an |
| 526 | `/api/seasonality-signals` | 28 | `GET` | ✅ ACTIVE | ./src/components/dashboard/SeasonalitySignalsWidget.tsx, ./sr |
| 527 | `/api/sectors/[sector]/stocks` | 49 | `GET` | ✅ ACTIVE | ./src/app/api/sectors/[sector]/stocks/route.ts, ./src/app/api |
| 528 | `/api/sectors/tracking` | 47 | `GET` | ✅ ACTIVE | ./src/app/api/sectors/tracking/route.ts, ./src/components/ana |
| 529 | `/api/seed-experts` | 163 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 530 | `/api/seed-recommendations` | 192 | `GET` | ✅ ACTIVE | ./src/app/api/seed-recommendations/route.ts |
| 531 | `/api/self-learning` | 28 | `GET` | ✅ ACTIVE | ./src/components/admin/AdminView.tsx, ./src/components/admin/ |
| 532 | `/api/smart-confluence/analysis/[symbol]` | 73 | `GET` | ✅ ACTIVE | ./src/app/api/smart-confluence/analysis/[symbol]/route.ts |
| 533 | `/api/smart-confluence/tabs` | 68 | `GET` | ✅ ACTIVE | ./src/app/api/smart-confluence/tabs/route.ts |
| 534 | `/api/sniper/backtest` | 28 | `GET` | ✅ ACTIVE | ./src/components/backtesting/EGXBacktestDashboard.tsx |
| 535 | `/api/sniper/closer/pending` | 42 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 536 | `/api/sniper/closer/run` | 14 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 537 | `/api/sniper/learning/performance` | 28 | `GET` | ✅ ACTIVE | ./src/components/sniper/PerformanceTracker.tsx |
| 538 | `/api/sniper/scan` | 15 | `GET` | ✅ ACTIVE | ./src/app/api/sniper/scan/route.ts, ./src/app/page.tsx, ./src/ |
| 539 | `/api/sniper/track` | 91 | `POST` | ✅ ACTIVE | ./src/components/sniper/OpportunityCard.tsx |
| 540 | `/api/stats` | 35 | `GET` | ✅ ACTIVE | ./vps-service/api/misc_routes.py, ./vps-service/data/egx_fetc |
| 541 | `/api/stock-detail` | 82 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 542 | `/api/stock-notebook` | 201 | `GET,POST,DELETE` | ✅ ACTIVE | ./src/app/api/stock-notebook/route.ts |
| 543 | `/api/stock-profile/[ticker]` | 50 | `GET` | ✅ ACTIVE | ./src/app/api/stock-profile/[ticker]/route.ts, ./src/componen |
| 544 | `/api/stock-seasonality` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 545 | `/api/stock/deep-analysis` | 69 | `GET` | ✅ ACTIVE | ./src/app/api/stock/deep-analysis/route.ts, ./src/app/api/sto |
| 546 | `/api/stocks` | 156 | `GET` | ✅ ACTIVE | ./data_engine/scrapers/egxpilot_scraper.py, ./scripts/fetch_p |
| 547 | `/api/stocks/[ticker]` | 50 | `GET` | ✅ ACTIVE | ./data_engine/scrapers/egxpilot_scraper.py, ./scripts/fetch_p |
| 548 | `/api/stocks/[ticker]/comprehensive` | 183 | `GET` | ✅ ACTIVE | ./data_engine/scrapers/egxpilot_scraper.py, ./scripts/fetch_p |
| 549 | `/api/stocks/[ticker]/depth` | 409 | `GET` | ✅ ACTIVE | ./data_engine/scrapers/egxpilot_scraper.py, ./scripts/fetch_p |
| 550 | `/api/stocks/[ticker]/history` | 79 | `GET` | ✅ ACTIVE | ./data_engine/scrapers/egxpilot_scraper.py, ./scripts/fetch_p |
| 551 | `/api/stocks/[ticker]/news` | 71 | `GET` | ✅ ACTIVE | ./data_engine/scrapers/egxpilot_scraper.py, ./scripts/fetch_p |
| 552 | `/api/stocks/[ticker]/orderbook` | 214 | `GET` | ✅ ACTIVE | ./data_engine/scrapers/egxpilot_scraper.py, ./scripts/fetch_p |
| 553 | `/api/stocks/[ticker]/professional-analysis` | 117 | `GET` | ✅ ACTIVE | ./data_engine/scrapers/egxpilot_scraper.py, ./scripts/fetch_p |
| 554 | `/api/stocks/[ticker]/recommendation` | 59 | `GET` | ✅ ACTIVE | ./data_engine/scrapers/egxpilot_scraper.py, ./scripts/fetch_p |
| 555 | `/api/stocks/advanced-analysis` | 28 | `GET` | ✅ ACTIVE | ./src/components/stocks/StockAdvancedAnalysisView.tsx |
| 556 | `/api/stocks/analysis` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 557 | `/api/stocks/batch-analysis` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 558 | `/api/stocks/confluence` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 559 | `/api/stocks/data-coverage` | 181 | `GET` | ✅ ACTIVE | ./src/app/api/stocks/data-coverage/route.ts, ./src/components |
| 560 | `/api/stocks/delta-volume` | 115 | `GET` | ✅ ACTIVE | ./src/app/api/stocks/delta-volume/route.ts, ./src/components/ |
| 561 | `/api/stocks/dual-persona/[ticker]` | 190 | `GET` | ✅ ACTIVE | ./src/app/api/persona/analyze/[ticker]/route.ts, ./src/app/ap |
| 562 | `/api/stocks/fundamentals` | 213 | `GET,POST` | ✅ ACTIVE | ./src/app/api/stocks/fundamentals/route.ts |
| 563 | `/api/stocks/movement-classification` | 50 | `GET` | ✅ ACTIVE | ./src/app/api/stocks/movement-classification/route.ts |
| 564 | `/api/stocks/presets` | 31 | `GET` | ✅ ACTIVE | ./src/app/api/stocks/presets/route.ts, ./src/components/stock |
| 565 | `/api/stocks/recommendations` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 566 | `/api/stocks/screener` | 73 | `GET` | ✅ ACTIVE | ./src/app/api/stocks/screener/route.ts, ./src/components/scre |
| 567 | `/api/stocks/search` | 145 | `GET` | ✅ ACTIVE | ./scripts/patch_search.py, ./src/app/api/stocks/search/route. |
| 568 | `/api/stocks/sparkline` | 199 | `GET` | ✅ ACTIVE | ./src/components/ui/mini-sparkline.tsx |
| 569 | `/api/stocks/technical` | 28 | `GET` | ✅ ACTIVE | ./vps-service/analyzers/technical_analyzer.py |
| 570 | `/api/stocks/top-performers` | 129 | `GET` | ✅ ACTIVE | ./src/app/api/stocks/top-performers/route.ts, ./src/component |
| 571 | `/api/stored-analysis/live-tracking` | 168 | `GET` | ✅ ACTIVE | ./src/app/api/stored-analysis/live-tracking/route.ts, ./src/c |
| 572 | `/api/stored-analysis/results` | 287 | `GET` | ✅ ACTIVE | ./scripts/monitor_live_session.py, ./scripts/run_quick_analys |
| 573 | `/api/subscribe/[plan]` | 28 | `GET` | ✅ ACTIVE | ./src/components/subscription/SubscriptionView.tsx |
| 574 | `/api/subscription/activate` | 88 | `POST` | ✅ ACTIVE | ./src/app/api/subscription/activate/route.ts, ./src/app/payme |
| 575 | `/api/subscription/check-access` | 201 | `POST,GET` | ✅ ACTIVE | ./src/app/api/subscription/check-access/route.ts |
| 576 | `/api/subscription/checkout` | 321 | `POST` | ✅ ACTIVE | ./src/app/api/subscription/checkout/route.ts |
| 577 | `/api/subscription/current` | 147 | `GET` | ✅ ACTIVE | ./src/app/api/subscription/current/route.ts, ./src/app/api/su |
| 578 | `/api/subscription/deactivate` | 91 | `POST` | ✅ ACTIVE | ./src/app/api/subscription/deactivate/route.ts |
| 579 | `/api/subscription/developer-request` | 65 | `POST` | ✅ ACTIVE | ./src/app/api/subscription/developer-request/route.ts, ./src/ |
| 580 | `/api/subscription/plans` | 172 | `GET` | ✅ ACTIVE | ./src/app/api/subscription/plans/route.ts |
| 581 | `/api/subscription/start-trial` | 79 | `POST` | ✅ ACTIVE | ./src/app/api/subscription/start-trial/route.ts, ./src/app/ap |
| 582 | `/api/subscription/status` | 215 | `GET` | ✅ ACTIVE | ./src/app/api/subscription/status/route.ts |
| 583 | `/api/subscription/subscribe` | 188 | `POST` | ✅ ACTIVE | ./src/app/api/subscription/subscribe/route.ts |
| 584 | `/api/subscription/trial` | 148 | `POST` | ✅ ACTIVE | ./src/app/api/subscription/trial/route.ts |
| 585 | `/api/subscription/upgrade` | 94 | `POST` | ✅ ACTIVE | ./src/app/api/subscription/subscribe/route.ts, ./src/app/api/ |
| 586 | `/api/subscription/verify` | 430 | `POST` | ✅ ACTIVE | ./src/app/api/subscription/verify/route.ts |
| 587 | `/api/sync-historical` | 173 | `POST,GET` | ✅ ACTIVE | ./src/components/admin/DataScraperControl.tsx |
| 588 | `/api/sync-names` | 105 | `GET` | ✅ ACTIVE | ./src/app/api/sync-names/route.ts |
| 589 | `/api/sync-prices` | 189 | `GET,POST` | ⚠️ ORPHAN | _(none)_ |
| 590 | `/api/system-control` | 28 | `GET` | ✅ ACTIVE | ./src/components/admin/SystemControlPanel.tsx |
| 591 | `/api/system/db-health` | 81 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 592 | `/api/tab-data` | 62 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 593 | `/api/technical/start` | 127 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 594 | `/api/technical/status` | 44 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 595 | `/api/technical/stop` | 40 | `POST` | ⚠️ ORPHAN | _(none)_ |
| 596 | `/api/telegram/[...path]` | 124 | `?` | ✅ ACTIVE | ./news-agent/ui/app.js, ./news-agent/ui/dashboard.py, ./src/ap |
| 597 | `/api/telegram/post` | 114 | `POST,GET` | ✅ ACTIVE | ./src/app/api/telegram/post/route.ts |
| 598 | `/api/telegram/send-daily-report` | 29 | `POST` | ✅ ACTIVE | ./src/app/api/telegram/send-daily-report/route.ts, ./src/comp |
| 599 | `/api/telegram/share` | 298 | `POST,GET` | ⚠️ ORPHAN | _(none)_ |
| 600 | `/api/test-db` | 43 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 601 | `/api/test-simple` | 10 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 602 | `/api/tips/random` | 80 | `GET` | ✅ ACTIVE | ./src/app/api/tips/random/route.ts, ./src/components/smart-ti |
| 603 | `/api/topology` | 46 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 604 | `/api/track` | 68 | `POST` | ✅ ACTIVE | ./src/app/api/track/route.ts, ./src/components/admin/AdminVie |
| 605 | `/api/trading-journal` | 140 | `GET,POST` | ✅ ACTIVE | ./src/app/api/trading-journal/route.ts, ./src/app/api/trading |
| 606 | `/api/trading-journal/stats` | 132 | `GET` | ✅ ACTIVE | ./src/app/api/trading-journal/stats/route.ts, ./src/component |
| 607 | `/api/trading/time` | 28 | `GET` | ✅ ACTIVE | ./vps-service/api/misc_routes.py |
| 608 | `/api/unified` | 321 | `GET,POST` | ✅ ACTIVE | ./scripts/monitor_live_session.py, ./scripts/test_predictions |
| 609 | `/api/unified-analysis` | 78 | `GET` | ✅ ACTIVE | ./src/app/api/unified-analysis/route.ts, ./vps-service/analyz |
| 610 | `/api/unified-analysis/[symbol]` | 440 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 611 | `/api/unified-analysis/recommendations` | 185 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 612 | `/api/unified-crypto` | 32 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 613 | `/api/unified-learning/indicators` | 75 | `GET` | ✅ ACTIVE | ./src/app/api/learning/indicators/route.ts, ./src/app/api/uni |
| 614 | `/api/unified-learning/intelligent` | 82 | `GET,POST` | ✅ ACTIVE | ./src/app/api/unified-learning/intelligent/route.ts, ./vps-se |
| 615 | `/api/unified-learning/iterative` | 101 | `POST,GET` | ✅ ACTIVE | ./src/app/api/unified-learning/iterative/route.ts, ./vps-serv |
| 616 | `/api/unified-learning/mine-lessons` | 116 | `POST,GET` | ✅ ACTIVE | ./src/app/api/unified-learning/mine-lessons/route.ts, ./vps-s |
| 617 | `/api/unified-learning/patterns` | 75 | `GET` | ✅ ACTIVE | ./src/app/api/learning/patterns/route.ts, ./src/app/api/unifi |
| 618 | `/api/unified-learning/status` | 72 | `GET` | ✅ ACTIVE | ./src/app/api/learning/status/route.ts, ./src/app/api/unified |
| 619 | `/api/unified-market-analysis` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 620 | `/api/unified-scoring` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/unified-scoring/route.ts |
| 621 | `/api/unified-stocks` | 44 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 622 | `/api/unified/predictions` | 92 | `GET,POST` | ✅ ACTIVE | ./scripts/monitor_live_session.py, ./scripts/test_predictions |
| 623 | `/api/us-stocks` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 624 | `/api/user-posts` | 211 | `GET,POST` | ✅ ACTIVE | ./src/components/publishing/QuickPublishButton.tsx, ./src/com |
| 625 | `/api/user-posts/[id]` | 84 | `GET,DELETE` | ✅ ACTIVE | ./src/components/publishing/UserPublishingView.tsx |
| 626 | `/api/user-posts/[id]/like` | 56 | `POST` | ✅ ACTIVE | ./src/components/publishing/UserPublishingView.tsx |
| 627 | `/api/v2/admin/config` | 97 | `GET,POST` | ✅ ACTIVE | ./src/app/api/v2/admin/config/route.ts |
| 628 | `/api/v2/analyze` | 19 | `POST` | ✅ ACTIVE | ./src/app/api/v2/analyze/route.ts, ./src/components/studio/Fl |
| 629 | `/api/v2/chart/full-analysis` | 192 | `GET` | ✅ ACTIVE | ./src/app/api/crypto/full-analysis/route.ts, ./src/app/api/v2 |
| 630 | `/api/v2/day-trading-opportunities` | 23 | `GET` | ✅ ACTIVE | ./src/app/api/v2/day-trading-opportunities/route.ts |
| 631 | `/api/v2/engines` | 12 | `GET` | ✅ ACTIVE | ./src/app/api/v2/engines/route.ts, ./src/app/api/v2/unified/c |
| 632 | `/api/v2/feedback/backtest` | 28 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 633 | `/api/v2/feedback/predictions` | 30 | `GET` | ⚠️ ORPHAN | _(none)_ |
| 634 | `/api/v2/feedback/run` | 28 | `GET` | ✅ ACTIVE | ./src/app/api/cron/scheduled/route.ts |
| 635 | `/api/v2/feedback/status` | 42 | `GET` | ✅ ACTIVE | ./src/app/api/v2/feedback/status/route.ts |
| 636 | `/api/v2/health` | 12 | `GET` | ✅ ACTIVE | ./src/app/api/v2/health/route.ts, ./src/components/studio/Flo |
| 637 | `/api/v2/live-analysis` | 46 | `GET` | ✅ ACTIVE | ./src/app/api/v2/live-analysis/route.ts, ./src/components/rec |
| 638 | `/api/v2/morning-recommendations` | 46 | `GET` | ✅ ACTIVE | ./scripts/verify_python_architecture.py, ./src/app/api/v2/mor |
| 639 | `/api/v2/pipeline` | 36 | `POST,PUT` | ✅ ACTIVE | ./src/app/api/v2/pipeline/[name]/engine/[engine]/toggle/rout |
| 640 | `/api/v2/pipeline/[name]/engine/[engine]/toggle` | 23 | `PUT` | ✅ ACTIVE | ./src/app/api/v2/pipeline/[name]/engine/[engine]/toggle/rout |
| 641 | `/api/v2/pipeline/[name]/engine/[engine]/weight` | 23 | `PUT` | ✅ ACTIVE | ./src/app/api/v2/pipeline/[name]/engine/[engine]/toggle/rout |
| 642 | `/api/v2/pipeline/[name]/summary` | 19 | `GET` | ✅ ACTIVE | ./src/app/api/v2/pipeline/[name]/engine/[engine]/toggle/rout |
| 643 | `/api/v2/pipelines` | 12 | `GET` | ✅ ACTIVE | ./src/app/api/v2/pipelines/route.ts, ./src/app/api/v2/unified |
| 644 | `/api/v2/presets` | 12 | `GET` | ✅ ACTIVE | ./src/app/api/v2/presets/route.ts, ./src/app/api/v2/unified/c |
| 645 | `/api/v2/recommend` | 20 | `GET` | ✅ ACTIVE | ./scripts/run_quick_analysis.py, ./src/app/api/persona/recomm |
| 646 | `/api/v2/stock/[symbol]/analysis` | 28 | `GET` | ✅ ACTIVE | ./scripts/verify_python_architecture.py |
| 647 | `/api/v2/unified/analyze` | 230 | `POST` | ✅ ACTIVE | ./src/app/api/v2/unified/analyze/route.ts, ./vps-service/api/ |
| 648 | `/api/v2/unified/config` | 312 | `GET` | ✅ ACTIVE | ./src/app/api/v2/unified/config/route.ts, ./src/app/api/v2/un |
| 649 | `/api/v2/unified/personas` | 263 | `GET` | ✅ ACTIVE | ./src/app/api/v2/unified/personas/route.ts, ./vps-service/api |
| 650 | `/api/v2/unified/scan` | 214 | `POST` | ✅ ACTIVE | ./src/app/api/v2/unified/scan/route.ts, ./vps-service/api/uni |
| 651 | `/api/v4/stats` | 248 | `GET` | ✅ ACTIVE | ./src/app/api/python/[...path]/route.ts, ./src/app/api/v4/sta |
| 652 | `/api/v82` | 220 | `GET` | ✅ ACTIVE | ./src/app/api/v82/route.ts, ./src/components/v82/V82DecisionP |
| 653 | `/api/walk-forward-test` | 28 | `GET` | ✅ ACTIVE | ./src/components/auto-analysis-widget.tsx |
| 654 | `/api/walk-forward/run` | 124 | `POST,GET` | ✅ ACTIVE | ./src/app/api/walk-forward/run/route.ts |
| 655 | `/api/watchlist` | 224 | `GET,POST` | ✅ ACTIVE | ./src/app/api/mobile/watchlist-enhanced/route.ts, ./src/app/a |
| 656 | `/api/watchlist-enhanced` | 102 | `GET` | ✅ ACTIVE | ./src/app/api/mobile/watchlist-enhanced/route.ts, ./src/app/a |
| 657 | `/api/watchlist/[id]` | 199 | `PUT,DELETE` | ✅ ACTIVE | ./src/app/api/watchlist/[id]/route.ts, ./src/lib/api-config.t |
| 658 | `/api/zakat/calculate` | 182 | `POST,GET` | ✅ ACTIVE | ./src/app/api/zakat/calculate/route.ts |

### 2.3 Lib (src/lib)

| File | LOC | Exports (first 3) | Importers | Used By | Status |
|------|----:|-------------------|----------:|---------|--------|
| `admin-auth-server.ts` | 201 | `export function getAdminSessionToken(): string {~export function verifyAdminCred` | 115 | app/api/admin/ab-test/route.ts, app/api/admin/advanced-analysis/config/route.ts, app/api/admin/advanced-analysis/run/route.ts | ✅ ACTIVE |
| `admin-auth.ts` | 90 | `export function isAdmin(email: string \| null \| undefined, username?: string \| nu` | 9 | app/admin/educational-cards/page.tsx, app/api/admin/auth/auto-cookie/route.ts, app/api/market/seed-historical/route.ts | ✅ ACTIVE |
| `admin-db-manager.ts` | 1499 | `export interface DatabaseOverview {~export interface TableSummary {~export inter` | 20 | app/api/admin/db-manager/auto-backup/route.ts, app/api/admin/db-manager/backup/route.ts, app/api/admin/db-manager/checkpoint-all/route.ts | ✅ ACTIVE |
| `admin-identities.ts` | 150 | `export function getServerAdminEmails(): string[] {~export function getServerAdmi` | 8 | app/admin/layout.tsx, app/api/auth/[...nextauth]/route.ts, app/api/auth/google/route.ts | ✅ ACTIVE |
| `ai/deepseek-client.ts` | 227 | `export type DeepSeekModel = 'deepseek-chat' \| 'deepseek-reasoner';~export interf` | 1 | app/api/ai/chat/route.ts | ✅ ACTIVE |
| `ai/memory.ts` | 261 | `export interface ConversationMemory {
~export interface DecisionMemory {
~export` | 1 | app/api/ai/chat/route.ts | ✅ ACTIVE |
| `ai/tools.ts` | 132 | `export interface SearchResult {
~export interface MarketNews {
~export async fun` | 1 | app/api/ai/chat/route.ts | ✅ ACTIVE |
| `alert-sound.ts` | 103 | `export function playAlertSound(direction: AlertDirection = 'neutral'): void {~ex` | 5 | components/analysis/AlertPanel.tsx, components/notifications/CentralAlertMonitor.tsx, components/notifications/RoboNotifierToggle.tsx | ✅ ACTIVE |
| `alerts-store.ts` | 205 | `export type AlertType =~export interface PriceAlert {~export interface AlertsSto` | 3 | components/analysis/AlertPanel.tsx, components/analysis/SingleStockAnalysisView.tsx, lib/use-alerts.tsx | ✅ ACTIVE |
| `analysis-engine.ts` | 3126 | `export interface PricePoint {~export interface ProfessionalAnalysis {~export fun` | 0 | _(none)_ | ⚠️ ORPHAN |
| `analysis-store.ts` | 62 | `export interface AnalysisCacheData {~export const useAnalysisStore = create<Anal` | 9 | components/analysis/MarketAnalysisView.tsx, components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx | ✅ ACTIVE |
| `api-cache.ts` | 85 | `export async function cached<T>(~export function clearCache(keyOrPattern?: strin` | 1 | app/api/health/route.ts | ✅ ACTIVE |
| `api-client.ts` | 314 | `export const apiClient = new ApiClient();` | 4 | components/reports/DailyMarketReport.tsx, components/reports/ReportsView.tsx, components/reports/StockAnalysisReport.tsx | ✅ ACTIVE |
| `api-config.ts` | 210 | `export const API_ENDPOINTS = {
~export const apiClient = new ApiClient();
~expor` | 0 | _(none)_ | ⚠️ ORPHAN |
| `auth-helper.ts` | 198 | `export async function getSessionUserId(): Promise<{ userId: string \| null; isAdm` | 55 | app/api/ai/analyze-stock/route.ts, app/api/ai/chat/route.ts, app/api/alerts/[id]/route.ts | ✅ ACTIVE |
| `auto-seed-stocks.ts` | 281 | `export async function ensureStocksSeeded(): Promise<{ seeded: boolean; count: nu` | 0 | _(none)_ | ⚠️ ORPHAN |
| `build-trigger.ts` | 1 | `_(no `export`)_` | 0 | _(none)_ | ⚠️ ORPHAN |
| `cache/api-cache.ts` | 115 | `export function getCached<T>(key: string): T \| null {~export function setCached<` | 1 | lib/cache/data-freshness.ts | ✅ ACTIVE |
| `cache/data-freshness.ts` | 263 | `export function checkStocksFreshness(market?: string): FreshnessResult {~export ` | 0 | _(none)_ | ⚠️ ORPHAN |
| `cache/precomputed-cache.ts` | 1000 | `export interface CacheEntry<T> {~export interface PrecomputedStockData {~export ` | 0 | _(none)_ | ⚠️ ORPHAN |
| `candlestick-patterns.ts` | 438 | `export interface Candle {~export interface CandlePattern {~export function detec` | 1 | lib/technical-analysis.ts | ✅ ACTIVE |
| `chart-generator.ts` | 360 | `export interface PieChartData {
~export interface BarChartData {
~export functio` | 1 | app/api/telegram/share/route.ts | ✅ ACTIVE |
| `community-db.ts` | 90 | `export const db = new Proxy({} as Database.Database, {` | 4 | app/api/community/posts/[post_id]/comments/route.ts, app/api/community/route.ts, app/api/mobile/community/route.ts | ✅ ACTIVE |
| `crypto-learning-store.ts` | 385 | `export interface CryptoLearningBadge {
~export interface CryptoLearningProgress ` | 1 | components/crypto/CryptoLearningView.tsx | ✅ ACTIVE |
| `data-adapter.ts` | 1342 | `export interface HistoricalPrice {
~export interface UnifiedStockData {
~export ` | 1 | app/api/market/scheduled-sync/route.ts | ✅ ACTIVE |
| `data-engine-db-sqljs.ts` | 475 | `export async function getDataEngineDbSqlJs(): Promise<SqlJsDatabase> {~export as` | 7 | app/api/finance/calculate-values/route.ts, app/api/portfolio/bag-holder-rescue/route.ts, app/api/portfolio/holdings/route.ts | ✅ ACTIVE |
| `data-engine-db.ts` | 996 | `export function getDataEngineDb(): Database.Database {~export function getPriceH` | 41 | app/api/ai/analyze-stock/route.ts, app/api/alerts/gold/route.ts, app/api/crypto/full-analysis/route.ts | ✅ ACTIVE |
| `data-sync.ts` | 892 | `export interface ParsedStockPrice {~export interface StockCurrentData {~export i` | 5 | app/api/admin/import-stocks/route.ts, app/api/market/refresh-data/route.ts, app/api/market/scheduled-sync/route.ts | ✅ ACTIVE |
| `data-validator.ts` | 516 | `export interface ValidationResult {
~export interface StockDataPoint {
~export i` | 3 | app/api/market/refresh-data/route.ts, lib/data-adapter.ts, lib/egx-data-sources.ts | ✅ ACTIVE |
| `db-auth.ts` | 27 | `export const authDb =
~export type { User, Account, Session, SubscriptionPlan, U` | 3 | lib/data-engine-db.ts, lib/db-helpers.ts, lib/db.ts | ✅ ACTIVE |
| `db-helpers.ts` | 274 | `export { db, authDb } from './db';~export type {~export {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `db-predictions.ts` | 27 | `export const predictionsDb =
~export type { AiPrediction, ExpertRecommendation, ` | 6 | app/api/admin/ai-predictions/evaluate-range/route.ts, app/api/admin/clean-predictions/route.ts, app/api/crypto-predictions/route.ts | ✅ ACTIVE |
| `db-v2.ts` | 401 | `export const DB_PATHS = {~export function getStocksDb(): Database {~export funct` | 1 | lib/db-helpers.ts | ✅ ACTIVE |
| `db.ts` | 11 | `export { authDb as db, authDb } from './db-auth'
~export type { User, Account, S` | 80 | app/admin/layout.tsx, app/api/admin/advanced-analysis/run/route.ts, app/api/admin/auth/auto-cookie/route.ts | ✅ ACTIVE |
| `devil/chain-reaction-engine.ts` | 272 | `export function runChainReaction(~export function detectMacroEventFromTitle(~exp` | 2 | lib/devil/devil-orchestrator.ts, lib/devil/scenario-matrix.ts | ✅ ACTIVE |
| `devil/contrarian-engine.ts` | 140 | `export function analyzeContrarian(~export function calculatePricePercentile(~exp` | 2 | lib/devil/devil-filter.ts, lib/devil/devil-orchestrator.ts | ✅ ACTIVE |
| `devil/devil-filter.ts` | 280 | `export interface DevilFilterResult {~export function detectFallingKnife(~export ` | 1 | app/api/devil/filter/route.ts | ✅ ACTIVE |
| `devil/devil-orchestrator.ts` | 332 | `export const GOLDEN_RULES: GoldenRule[] = [~export function checkGoldenRules(ctx` | 2 | app/api/devil/card/[ticker]/route.ts, lib/devil/devil-filter.ts | ✅ ACTIVE |
| `devil/divergence-engine.ts` | 160 | `export function analyzeDivergence(~export function findStrongestDivergence(~expo` | 1 | lib/devil/devil-orchestrator.ts | ✅ ACTIVE |
| `devil/event-calendar.ts` | 168 | `export function getDevilsCalendar(): DevilsCalendar {~export function getUpcomin` | 2 | app/api/devil/calendar/route.ts, lib/devil/devil-orchestrator.ts | ✅ ACTIVE |
| `devil/market-mood.ts` | 137 | `export function calculateMarketMood(~export function quickMarketMood(` | 0 | _(none)_ | ⚠️ ORPHAN |
| `devil/pre-event-engine.ts` | 194 | `export function calculateExpectedValue(scenarios: ScenarioOutcome[]): number {~e` | 1 | lib/devil/devil-orchestrator.ts | ✅ ACTIVE |
| `devil/regime-engine.ts` | 215 | `export function getSeasonality(date: Date = new Date()): SeasonalityFactor {~exp` | 4 | app/api/devil/scenario/[ticker]/route.ts, lib/devil/devil-orchestrator.ts, lib/devil/event-calendar.ts | ✅ ACTIVE |
| `devil/scenario-matrix.ts` | 119 | `export interface ScenarioInput {~export function buildScenarioMatrix(input: Scen` | 1 | app/api/devil/scenario/[ticker]/route.ts | ✅ ACTIVE |
| `devil/types.ts` | 243 | `export interface NewsItem {~export interface PriceReaction {~export interface Di` | 13 | components/devil/DevilsCalendar.tsx, components/devil/DevilsCard.tsx, components/devil/MarketMood.tsx | ✅ ACTIVE |
| `dynamic-analysis-engine.ts` | 925 | `export type StockRegime = 'STRONG_BULL' \| 'WEAK_BULL' \| 'RANGE' \| 'WEAK_BEAR' \| ` | 2 | lib/gate-analyzer.ts, lib/honest-tracking/maestro.ts | ✅ ACTIVE |
| `egx-data-sources.ts` | 716 | `export async function fetchFromMubasher(ticker: string): Promise<{~export async ` | 3 | app/api/admin/scrape-stocks/route.ts, app/api/market/refresh-data/route.ts, lib/data-adapter.ts | ✅ ACTIVE |
| `egx-db.ts` | 1248 | `export async function ensureInitialized(): Promise<void> {~export function clear` | 52 | app/api/admin/advanced-analysis/run/route.ts, app/api/admin/clear-junk-data/route.ts, app/api/admin/currency/route.ts | ✅ ACTIVE |
| `egx-trading-hours.ts` | 189 | `export function getCairoTime(date: Date = new Date()): Date {
~export function i` | 1 | components/recommendations/AiRecommendations.tsx | ✅ ACTIVE |
| `egxpy-bridge.ts` | 530 | `export async function isVpsApiAvailable(): Promise<boolean> {~export interface E` | 3 | app/api/market/connections/route.ts, app/api/market/live-data/route.ts, app/api/market/sync-live/route.ts | ✅ ACTIVE |
| `engine-control-store.ts` | 300 | `export type EngineLogType = 'info' \| 'success' \| 'error' \| 'warning';~export int` | 4 | app/api/admin/engine-control/status/route.ts, app/api/admin/engine-control/toggle/route.ts, app/api/admin/engine-control/trigger/route.ts | ✅ ACTIVE |
| `expert/expert-filter.ts` | 233 | `export interface ExpertFilterResult {~export function detectFallingKnife(~export` | 0 | _(none)_ | ⚠️ ORPHAN |
| `external-data-fetcher.ts` | 329 | `export interface FundamentalData {
~export interface BatchFetchResult {
~export ` | 1 | app/api/stocks/fundamentals/route.ts | ✅ ACTIVE |
| `finance-db.ts` | 56 | `export async function getFinanceDb(): Promise<SqliteDatabase> {~export function ` | 45 | app/api/admin/analytics/route.ts, app/api/admin/users/cleanup-expired/route.ts, app/api/admin/users/route.ts | ✅ ACTIVE |
| `flutter-sqlite-fallback.ts` | 591 | `export function getStockByTickerFallback(~export function getTopMoversFallback(l` | 32 | app/api/confluence/analyze/[ticker]/route.ts, app/api/crypto/[id]/route.ts, app/api/crypto/explosive/route.ts | ✅ ACTIVE |
| `format.ts` | 123 | `export function formatPrice(~export function formatNumber(~export function forma` | 2 | components/dashboard/IntradayPressurePanel.tsx, components/dashboard/LiquidityFlowPanel.tsx | ✅ ACTIVE |
| `gate-analyzer.ts` | 1032 | `export interface GateAnalysisInput {~export interface GateResult {~export type G` | 1 | components/stocks/GateAnalysisView.tsx | ✅ ACTIVE |
| `gold-history-helper.ts` | 165 | `export const dynamic = 'force-dynamic';~export const revalidate = 30;~export asy` | 2 | app/api/metals/gold/history/route.ts, app/api/mobile/gold/history/route.ts | ✅ ACTIVE |
| `honest-tracking/maestro.ts` | 1850 | `export interface MaestroParams {~export const DEFAULT_PARAMS: MaestroParams = {~` | 5 | app/api/admin/generate-historical-predictions/route.ts, app/api/predictions/honest-tracking/learn-from-errors/route.ts, app/api/predictions/honest-tracking/list/route.ts | ✅ ACTIVE |
| `learning-store.ts` | 364 | `export interface LearningBadge {
~export interface LearningProgress {
~export in` | 1 | components/learning/LearningView.tsx | ✅ ACTIVE |
| `m2ySyncClient.ts` | 80 | `export interface GLMSyncPayload {
~export async function syncSubscriptionToM2Y(p` | 1 | app/api/subscription/deactivate/route.ts | ✅ ACTIVE |
| `market-data-access.ts` | 359 | `export interface PriceRow {~export interface MarketTicker {~export function norm` | 2 | app/api/predictions/price-verify/route.ts, lib/technical-analysis.ts | ✅ ACTIVE |
| `market-hours.ts` | 135 | `export interface MarketSessionStatus {~export function getEGXMarketStatus(date: ` | 4 | components/dashboard/LiveMonitor.tsx, components/predictions/MakerRadarTab.tsx, components/stocks/TradingViewChart.tsx | ✅ ACTIVE |
| `multi-source-adapter.ts` | 1057 | `export interface StockQuote {~export interface GoldPrice {~export interface Curr` | 2 | app/api/market/sync/route.ts, app/api/market/test-sources/route.ts | ✅ ACTIVE |
| `new-db-queries.ts` | 346 | `export async function ensureInitialized(): Promise<void> {~export function getPr` | 2 | app/api/admin/db-health/route.ts, lib/db-helpers.ts | ✅ ACTIVE |
| `new-db.ts` | 368 | `export async function ensureInitialized(): Promise<void> {~export const DB_PATHS` | 1 | lib/db-helpers.ts | ✅ ACTIVE |
| `notification-beep.ts` | 98 | `export type BeepType = 'signal' \| 'alert' \| 'success' \| 'error';~export function` | 1 | hooks/useSignalNotifications.ts | ✅ ACTIVE |
| `notification-store.ts` | 82 | `export const useNotificationStore = create<NotificationStore>((set, get) => ({
` | 7 | components/layout/Header.tsx, components/layout/MobileMoreSheet.tsx, components/layout/Sidebar.tsx | ✅ ACTIVE |
| `official-links.ts` | 44 | `export const OFFICIAL_LINKS = {~export const COMMUNITY_PROMPT = 'انضم الآن إلى م` | 27 | app/api/telegram/share/route.ts, components/advanced-analysis/SpecialistAnalysisView.tsx, components/analysis/MarketAnalysisView.tsx | ✅ ACTIVE |
| `paper-trading-v2-db.ts` | 393 | `export interface PaperTradingAccount {~export interface PaperTradingOrder {~expo` | 7 | app/api/paper-trading-v2/account/route.ts, app/api/paper-trading-v2/order/route.ts, app/api/paper-trading-v2/orders/[id]/close/route.ts | ✅ ACTIVE |
| `patch-html2pdf.ts` | 43 | `export async function patchHtml2Canvas(): Promise<void> {
~export async function` | 9 | components/crypto/CryptoSimulationView.tsx, components/dashboard/DashboardView.tsx, components/learning/LearningView.tsx | ✅ ACTIVE |
| `payment.ts` | 90 | `export interface PaymentTokenPayload {~export function generatePaymentToken(para` | 2 | app/api/subscription/subscribe/route.ts, app/api/subscription/upgrade/route.ts | ✅ ACTIVE |
| `paymob.ts` | 425 | `export const paymobService = new PaymobService();
~export type { PaymentRequest,` | 0 | _(none)_ | ⚠️ ORPHAN |
| `paywall.ts` | 194 | `export async function getPaywallUser(req: NextRequest): Promise<PaywallUser> {~e` | 4 | app/api/explosive/route.ts, app/api/fomo/missed-opportunities/route.ts, app/api/stored-analysis/results/route.ts | ✅ ACTIVE |
| `persona-dynamic.ts` | 513 | `export interface PersonaFactors {~export type PersonaVectorKey = 'conservative' ` | 5 | components/persona/DynamicRiskProfilerModal.tsx, components/portfolio/BagHolderRescuePanel.tsx, components/portfolio/EnhancedPortfolioView.tsx | ✅ ACTIVE |
| `persona-matrix.ts` | 196 | `export type PersonaId = 'conservative' \| 'balanced' \| 'aggressive';~export inter` | 0 | _(none)_ | ⚠️ ORPHAN |
| `pick-formatter.ts` | 116 | `export interface ShareablePick {~export function formatPickForSharing(~export de` | 0 | _(none)_ | ⚠️ ORPHAN |
| `plans.ts` | 142 | `export interface PlanData {~export function getPlan(planId: string): PlanData \| ` | 1 | lib/payment.ts | ✅ ACTIVE |
| `portfolio-store.ts` | 196 | `export interface PortfolioAsset {~export interface MasterSummary {~export interf` | 2 | components/portfolio/EnhancedPortfolioView.tsx, components/portfolio/MasterPortfolioSummary.tsx | ✅ ACTIVE |
| `prediction-validator.ts` | 293 | `export interface PredictionValidationResult {~export interface PredictionInput {` | 1 | app/api/predictions/honest-tracking/list/route.ts | ✅ ACTIVE |
| `protection/display-protection.ts` | 224 | `export interface ProtectionConfig {~export function getProtectionConfig(): Prote` | 2 | app/api/predictions/honest-tracking/list/route.ts, app/api/predictions/honest-tracking/live-tracking/route.ts | ✅ ACTIVE |
| `python-backend.ts` | 160 | `export const PYTHON_BACKEND_URL = getPythonBackendUrl();~export function pythonA` | 40 | app/api/admin/educational-cards/[id]/image/route.ts, app/api/admin/educational-cards/[id]/route.ts, app/api/admin/educational-cards/lessons/route.ts | ✅ ACTIVE |
| `radar-cache.ts` | 438 | `export interface RadarCacheStatus {~export function findLatestRadarFile(): strin` | 4 | app/api/maker-radar/route.ts, app/api/maker-radar/sector-treemap/route.ts, app/api/maker-radar/warmup/route.ts | ✅ ACTIVE |
| `radar-db.ts` | 180 | `export interface RadarDbConfig {~export function getRadarDbConfig(): RadarDbConf` | 4 | app/api/maker-radar/entry-timing/route.ts, app/api/maker-radar/footprint/route.ts, app/api/maker-radar/stock/route.ts | ✅ ACTIVE |
| `radar-signal-tracker.ts` | 190 | `export function pickTrackerDbPath(): string \| null {~export function openTracker` | 1 | lib/schedulers/radar-alerts.ts | ✅ ACTIVE |
| `risk-reward.ts` | 66 | `export function computeRiskReward(~export function preferComputedRiskReward(` | 3 | app/api/finance/smart-confluence/route.ts, app/api/predictions/backtest-list/route.ts, app/api/predictions/daily-picks/route.ts | ✅ ACTIVE |
| `robo-notifier.ts` | 249 | `export async function requestNotificationPermission(): Promise<boolean> {~export` | 2 | components/notifications/CentralAlertMonitor.tsx, components/notifications/RoboNotifierToggle.tsx | ✅ ACTIVE |
| `safe-error.ts` | 98 | `export function toArabicError(err: unknown, fallback: string = ARABIC_NETWORK_ER` | 2 | components/auto-analysis-widget.tsx, components/eid-predictions-widget.tsx | ✅ ACTIVE |
| `scheduler/index.ts` | 146 | `export const TASK_IDS = {
~export async function shouldRunTask(taskId: string, i` | 0 | _(none)_ | ⚠️ ORPHAN |
| `schedulers/alert-engine.ts` | 659 | `export interface AlertEngineResult {~export type AlertSeverity = 'info' \| 'succe` | 2 | app/api/alerts/scheduler/route.ts, lib/schedulers/radar-alerts.ts | ✅ ACTIVE |
| `schedulers/radar-alerts.ts` | 447 | `export async function runRadarAlertsCheck(userId?: string): Promise<number> {~ex` | 2 | lib/radar-cache.ts, lib/schedulers/alert-engine.ts | ✅ ACTIVE |
| `seed-historical-data.ts` | 622 | `export async function seedHistoricalData(): Promise<SeedResult> {~export interfa` | 0 | _(none)_ | ⚠️ ORPHAN |
| `server-url.ts` | 73 | `export function getSelfBaseUrl(request: NextRequest): string {~export function g` | 4 | app/api/paper-trading-v2/positions/route.ts, app/api/persona/analyze/[ticker]/route.ts, app/api/stocks/[ticker]/comprehensive/route.ts | ✅ ACTIVE |
| `shared-db.ts` | 276 | `export interface OpenOptions {~export function openDb(dbName: string, options?: ` | 10 | app/api/admin/close-predictions/route.ts, app/api/admin/platform-performance/route.ts, app/api/deal-advisor/[ticker]/route.ts | ✅ ACTIVE |
| `signal-utils.ts` | 116 | `export type SignalLike = string \| number \| undefined \| null;~export function det` | 10 | __tests__/signal-utils.test.ts, components/analysis/market-analysis/CryptoPredictionsTab.tsx, components/analysis/market-analysis/ExpertPredictionsTab.tsx | ✅ ACTIVE |
| `sqlite-admin.ts` | 528 | `export interface DatabaseInfo {~export interface TableSchema {~export interface ` | 4 | app/api/admin/db/[db]/[table]/[row]/route.ts, app/api/admin/db/[db]/[table]/route.ts, app/api/admin/db/[db]/route.ts | ✅ ACTIVE |
| `sqlite-compat.ts` | 142 | `export class Database {~export default Database;` | 0 | _(none)_ | ⚠️ ORPHAN |
| `sqlite-wrapper.ts` | 305 | `export interface DatabaseOptions {~export interface RunResult {~export interface` | 21 | app/api/alerts/[id]/route.ts, app/api/alerts/create/route.ts, app/api/alerts/gold/route.ts | ✅ ACTIVE |
| `stock-icon.ts` | 129 | `export function getStockIconUrl(ticker: string, logoUrl?: string \| null): string` | 1 | components/stocks/StockIcon.tsx | ✅ ACTIVE |
| `stock-movement-classification.ts` | 365 | `export type StockMovementCategory = 'active' \| 'slow' \| 'dead' \| 'unknown';
~exp` | 0 | _(none)_ | ⚠️ ORPHAN |
| `stock-movement-classifier.ts` | 290 | `export type StockMovementType = 'alive' \| 'slow' \| 'dead' \| 'unknown';
~export i` | 0 | _(none)_ | ⚠️ ORPHAN |
| `stock-names.ts` | 874 | `export interface StockNameInfo {~export const STOCK_NAMES: Record<string, StockN` | 2 | app/api/predictions/honest-tracking/list/route.ts, lib/vps-client.ts | ✅ ACTIVE |
| `store.ts` | 1475 | `export function adaptCryptoToStock(raw: Record<string, unknown>): Stock {~export` | 79 | app/page.tsx, app/payment/success/page.tsx, components/about/AboutView.tsx | ✅ ACTIVE |
| `subscription-gate.ts` | 224 | `export interface SubscriptionLimits {
~export function getTierLimits(tier: strin` | 2 | components/auth/AuthGate.tsx, components/reports/DataManager.tsx | ✅ ACTIVE |
| `sw-register.ts` | 78 | `export async function registerServiceWorker(): Promise<ServiceWorkerRegistration` | 1 | hooks/useSignalNotifications.ts | ✅ ACTIVE |
| `technical-analysis.ts` | 488 | `export function computeRSI(prices: number[], period = 14): number {~export funct` | 0 | _(none)_ | ⚠️ ORPHAN |
| `token-helper.ts` | 323 | `export async function validateToken(token: string): Promise<{ userId: string } \|` | 3 | app/api/admin/fix-dates/route.ts, app/api/mobile/auth/me/route.ts, lib/auth-helper.ts | ✅ ACTIVE |
| `unified-db.ts` | 487 | `export async function ensureUnifiedDbInitialized(): Promise<void> {
~export func` | 2 | app/api/unified-stocks/route.ts, lib/db-helpers.ts | ✅ ACTIVE |
| `use-engine-updates.ts` | 65 | `export interface EngineUpdate {~export function useEngineUpdates() {` | 0 | _(none)_ | ⚠️ ORPHAN |
| `use-live-dashboard.ts` | 258 | `export interface HeartbeatStatus {~export interface WhaleAlert {~export interfac` | 1 | components/analysis/LiveDashboard.tsx | ✅ ACTIVE |
| `use-python-api.ts` | 451 | `export function usePythonApi<T>(
~export const pythonApi = {
~export default pyt` | 0 | _(none)_ | ⚠️ ORPHAN |
| `use-undo-redo.ts` | 98 | `export interface UndoableAction<T> {~export function useUndoRedo<T>(initialValue` | 0 | _(none)_ | ⚠️ ORPHAN |
| `utils.ts` | 339 | `export function cn(...inputs: ClassValue[]) {
~export function safeNum(value: un` | 200 | app/admin/educational-cards/page.tsx, app/admin/honest-predictions/page.tsx, app/admin/reports/page.tsx | ✅ ACTIVE |
| `valid-views.ts` | 93 | `export const VALID_VIEWS: readonly string[] = [~export const VALID_VIEWS_SET: Re` | 1 | app/page.tsx | ✅ ACTIVE |
| `vps-adapter.ts` | 798 | `export interface VpsBaseResponse<T = unknown> {
~export interface VpsStockQuote ` | 5 | app/api/admin/data-sources/route.ts, app/api/market/connections/route.ts, app/api/market/live-data/route.ts | ✅ ACTIVE |
| `vps-client.ts` | 654 | `export function isVpsHealthy(): boolean {
~export function shouldTryVps(): boole` | 1 | app/api/mobile/stocks/EGX/recommendation/route.ts | ✅ ACTIVE |
| `ws-client.ts` | 458 | `export function safeToFixed(value: unknown, digits: number = 2, fallback: string` | 4 | components/analysis/SingleStockAnalysisView.tsx, components/dashboard/RealtimeTicker.tsx, lib/use-alerts.tsx | ✅ ACTIVE |

**Subtotal**: 117 files, 43,704 LOC. Active=96, Orphan=21.

## 3. Orphans & Dead Code (قائمة الأيتام)

> Each item below is a file with **zero importers** in the entire `src/` tree (confirmed via `imports_full3.tsv` — a Python-built index that resolves both `@/` and relative `./`/`../` imports, plus `import('./X')` dynamic chunks).  
> Each item includes a **recommendation**: 🗑️ delete / 🔄 re-route / 📦 keep-as-asset / 🔍 needs-investigation.

### 3.1 Orphan Components (55 files, ~20,494 LOC)

| # | File | LOC | Function | Recommendation |
|---|------|----:|----------|----------------|
| 1 | `src/components/recommendations/AiRecommendations.tsx` | 2209 | AI recommendations panel — superseded by MarketAnalysisView persona tabs (per page.tsx comment). | 🔄 re-route or 🗑️ delete |
| 2 | `src/components/screener/BottomPanel.tsx` | 976 | Bottom panel for old StockScreener. | 🔍 needs-investigation |
| 3 | `src/components/admin/SystemTopologyGraph.tsx` | 850 | System topology visualization widget — never wired into AdminView tabs. | 🔍 needs-investigation |
| 4 | `src/components/ui/sidebar.tsx` | 726 | shadcn/ui sidebar primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 5 | `src/components/analysis/market-analysis/LiveTrackingTab.tsx` | 720 | Live tracking tab for market-analysis — never wired into MarketAnalysisView tabs array. | 🔍 needs-investigation |
| 6 | `src/components/screener/ChartCard.tsx` | 712 | Chart card sub-component for old StockScreener. | 🔍 needs-investigation |
| 7 | `src/components/studio/FlowCanvas.tsx` | 685 | Visual flow canvas (React Flow) — entire studio/ folder is orphaned. | 🔍 needs-investigation (entire feature folder orphaned — 9 files) |
| 8 | `src/components/layout/Sidebar.tsx` | 644 | Legacy left-sidebar nav — replaced by TopBar (per TopBar.tsx:6 comment). | 🗑️ delete (replaced by TopBar) |
| 9 | `src/components/admin/CryptoPredictionGenerator.tsx` | 593 | Crypto prediction generator admin panel — referenced only in a comment at AdminView.tsx:71. | 🔍 needs-investigation |
| 10 | `src/components/screener/StockScreener.tsx` | 590 | Legacy stock screener — superseded by StockScreenerAdvanced.tsx. | 🔄 re-route or 🗑️ delete |
| 11 | `src/components/screener/ComparisonChartCard.tsx` | 567 | Comparison chart card for old screener. | 🔍 needs-investigation |
| 12 | `src/components/recommendations/RecommendationMonitoring.tsx` | 565 | Recommendation monitoring panel — superseded by PredictionTrackingView. | 🔄 re-route or 🗑️ delete |
| 13 | `src/components/screener/UnifiedScreenerView.tsx` | 534 | Unified screener view — superseded by StockScreenerAdvanced. | 🔄 re-route or 🗑️ delete |
| 14 | `src/components/dashboard/PredictionsBacktestTable.tsx` | 533 | Backtest table widget — never wired into DashboardView. | 🔍 needs-investigation |
| 15 | `src/components/analysis/market-analysis/CryptoPredictionsTab.tsx` | 519 | Crypto predictions tab — never wired into MarketAnalysisView. | 🔍 needs-investigation |
| 16 | `src/components/analysis/market-analysis/ExpertPredictionsTab.tsx` | 514 | Expert predictions tab — never wired into MarketAnalysisView. | 🔍 needs-investigation |
| 17 | `src/components/sniper/PerformanceTracker.tsx` | 463 | Sniper performance tracker — never wired. | 🔍 needs-investigation |
| 18 | `src/components/dashboard/LiquidityFlowPanel.tsx` | 439 | Liquidity flow panel widget — never wired into DashboardView. | 🔍 needs-investigation |
| 19 | `src/components/portfolio/UnifiedHoldingsTable.tsx` | 381 | Unified holdings table — superseded by EnhancedPortfolioView internal table. | 🔄 re-route or 🗑️ delete |
| 20 | `src/components/admin/OptimizerParamsPanel.tsx` | 372 | Optimizer parameters admin panel — never wired. | 🔍 needs-investigation |
| 21 | `src/components/dashboard/IntradayPressurePanel.tsx` | 361 | Intraday pressure panel — never wired into DashboardView. | 🔍 needs-investigation |
| 22 | `src/components/sniper/OpportunityCard.tsx` | 357 | Sniper opportunity card — never wired. | 🔍 needs-investigation |
| 23 | `src/components/portfolio/WealthCharts.tsx` | 346 | Wealth charts (portfolio variant) — superseded by admin/WealthCharts.tsx (which IS active in page.tsx). | 🔄 re-route or 🗑️ delete |
| 24 | `src/components/analysis/AnalysisFlowDiagram.tsx` | 326 | Analysis flow diagram — never wired. | 🔍 needs-investigation |
| 25 | `src/components/devil/DevilsCard.tsx` | 314 | Devil's advocate card — never wired. | 🔍 needs-investigation |
| 26 | `src/components/recommendations/SocialPostView.tsx` | 304 | Social post view — never wired. | 🔍 needs-investigation |
| 27 | `src/components/screener/WatchlistSidebar.tsx` | 292 | Watchlist sidebar for old screener. | 🔍 needs-investigation |
| 28 | `src/components/admin/RowEditorModal.tsx` | 286 | Row editor modal — never wired. | 🔍 needs-investigation |
| 29 | `src/components/admin/live-chart/index.tsx` | 281 | Live chart admin page — only referenced as `id` string in PlatformGuide. | 🔍 needs-investigation |
| 30 | `src/components/ui/menubar.tsx` | 276 | shadcn/ui menubar primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 31 | `src/components/ui/context-menu.tsx` | 252 | shadcn/ui context-menu primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 32 | `src/components/recommendations/RecommendationHistory.tsx` | 244 | Recommendation history view — superseded by PredictionTrackingView. | 🔄 re-route or 🗑️ delete |
| 33 | `src/components/ui/carousel.tsx` | 241 | _(no description available)_ | 📦 keep-as-asset (shadcn primitive) |
| 34 | `src/components/advanced-analysis/CandlestickWidget.tsx` | 228 | Candlestick widget — never wired. | 🔍 needs-investigation |
| 35 | `src/components/portfolio/PositionDeepDiveDrawer.tsx` | 223 | Position deep-dive drawer — never wired. | 🔍 needs-investigation |
| 36 | `src/components/news-feed-widget.tsx` | 216 | Early-prototype news feed widget — superseded by news/NewsFeedView.tsx. | 🗑️ delete (early prototype) |
| 37 | `src/components/ui/calendar.tsx` | 213 | shadcn/ui calendar primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 38 | `src/components/stocks/DataCoverageBanner.tsx` | 209 | Data coverage banner — never wired. | 🔍 needs-investigation |
| 39 | `src/components/devil/DevilsCalendar.tsx` | 193 | Devil's calendar widget — never wired. | 🔍 needs-investigation |
| 40 | `src/components/devil/MarketMood.tsx` | 186 | Market mood widget — never wired. | 🔍 needs-investigation |
| 41 | `src/components/ui/command.tsx` | 184 | shadcn/ui command primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 42 | `src/components/devil/ScenarioMatrix.tsx` | 182 | Scenario matrix view — never wired. | 🔍 needs-investigation |
| 43 | `src/components/recommendations/PublishedPredictions.tsx` | 177 | Published predictions view — superseded by UserPublishingView. | 🔄 re-route or 🗑️ delete |
| 44 | `src/components/ui/navigation-menu.tsx` | 168 | shadcn/ui navigation-menu primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 45 | `src/components/advanced-analysis/FibonacciWidget.tsx` | 149 | Fibonacci widget — never wired. | 🔍 needs-investigation |
| 46 | `src/components/ui/drawer.tsx` | 135 | shadcn/ui drawer primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 47 | `src/components/ui/pagination.tsx` | 127 | shadcn/ui pagination primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 48 | `src/components/ui/breadcrumb.tsx` | 109 | shadcn/ui breadcrumb primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 49 | `src/components/portfolio/RiskManagementBar.tsx` | 98 | Risk management bar — never wired. | 🔍 needs-investigation |
| 50 | `src/components/ui/input-otp.tsx` | 77 | shadcn/ui input-otp primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 51 | `src/components/ui/resizable.tsx` | 56 | shadcn/ui resizable primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 52 | `src/components/ui/hover-card.tsx` | 44 | shadcn/ui hover-card primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 53 | `src/components/ui/toaster.tsx` | 34 | shadcn/ui toaster wrapper — kept for future use (sonner.tsx is the active one). | 📦 keep-as-asset (shadcn primitive) |
| 54 | `src/components/ui/aspect-ratio.tsx` | 11 | shadcn/ui aspect-ratio primitive — kept for future use. | 📦 keep-as-asset (shadcn primitive) |
| 55 | `src/components/ai/index.ts` | 3 | Re-export barrel for AI components — never imported. | 🔍 needs-investigation |

**Categories of orphan components**:

- **shadcn/ui primitives** (15 files, ~2,800 LOC) — kept as part of the shadcn ecosystem but never directly used. These are "library assets" — typical of shadcn installations.
- **Old screener family** (`screener/StockScreener.tsx` + `BottomPanel.tsx` + `ChartCard.tsx` + `ComparisonChartCard.tsx` + `WatchlistSidebar.tsx` + `UnifiedScreenerView.tsx`, 6 files, ~3,400 LOC) — superseded by `StockScreenerAdvanced.tsx`.
- **Studio family** (`studio/*`, 9 files, ~3,200 LOC) — a React Flow–based visual node editor. Looks like a planned feature that was never finished/wired.
- **Devil's advocate family** (`devil/*`, 4 files, ~880 LOC) — a contrarian analysis module with full lib support in `src/lib/devil/*` (which IS active) but the UI components were never rendered.
- **Recommendations family** (`recommendations/AiRecommendations.tsx`, `RecommendationHistory.tsx`, `RecommendationMonitoring.tsx`, `PublishedPredictions.tsx`, `SocialPostView.tsx`, 5 files, ~3,500 LOC) — superseded by MarketAnalysisView + PredictionTrackingView + UserPublishingView.
- **Dashboard widgets** (`dashboard/LiquidityFlowPanel.tsx`, `IntradayPressurePanel.tsx`, `PredictionsBacktestTable.tsx`, 3 files, ~1,300 LOC) — never wired into DashboardView.
- **Layout migration leftover** (`layout/Sidebar.tsx`, 644 LOC) — replaced by `TopBar.tsx`.
- **Root-level widget** (`news-feed-widget.tsx`, 216 LOC) — early prototype superseded by `news/NewsFeedView.tsx`. (Siblings `auto-analysis-widget.tsx` and `eid-predictions-widget.tsx` are still active — imported by `DashboardView.tsx`.)
- **Admin panels** (`admin/CryptoPredictionGenerator.tsx`, `OptimizerParamsPanel.tsx`, `RowEditorModal.tsx`, `SystemTopologyGraph.tsx`, `live-chart/index.tsx`, 5 files, ~2,490 LOC) — never wired into AdminView tabs array.

### 3.2 Orphan Lib modules (21 files, ~8,929 LOC)

| # | File | LOC | Function | Recommendation |
|---|------|----:|----------|----------------|
| 1 | `src/lib/analysis-engine.ts` | 3126 | Technical indicator library (MACD, RSI, Bollinger, ATR, OBV, StochasticRSI) — never imported; only mentioned in a comment in /api/analysis-engine/route.ts:203. | 🔍 needs-investigation (3,126 LOC of indicators — could be valuable) |
| 2 | `src/lib/cache/precomputed-cache.ts` | 1000 | Precomputed results cache layer — never imported (the cache/api-cache.ts and cache/data-freshness.ts siblings also have low usage). | 🔍 needs-investigation (1,000 LOC of cache layer — could be valuable) |
| 3 | `src/lib/seed-historical-data.ts` | 622 | Historical data seeding utility — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 4 | `src/lib/technical-analysis.ts` | 488 | Technical analysis helper module — only matched as id string in /api/mobile/learning/route.ts. | 🗑️ delete (verify no Python/external caller first) |
| 5 | `src/lib/use-python-api.ts` | 451 | Python API hook — never imported. | 🔍 needs-investigation (451 LOC) |
| 6 | `src/lib/paymob.ts` | 425 | Paymob payment integration lib — never imported (paymob routes exist in api/paymob/* but call paymob SDK directly, not this lib). | 🗑️ delete (verify no Python/external caller first) |
| 7 | `src/lib/stock-movement-classification.ts` | 365 | Stock movement classification logic — never imported. | 🔁 duplicate (two files for same purpose — merge + delete one) |
| 8 | `src/lib/stock-movement-classifier.ts` | 290 | Stock movement classifier (duplicate of stock-movement-classification.ts — same purpose, different file). | 🔁 duplicate (two files for same purpose — merge + delete one) |
| 9 | `src/lib/auto-seed-stocks.ts` | 281 | Auto-seed stocks utility — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 10 | `src/lib/db-helpers.ts` | 274 | Database helper functions — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 11 | `src/lib/cache/data-freshness.ts` | 263 | Data freshness tracker — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 12 | `src/lib/expert/expert-filter.ts` | 233 | Expert filter logic — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 13 | `src/lib/api-config.ts` | 210 | API configuration constants — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 14 | `src/lib/persona-matrix.ts` | 196 | Persona matrix data — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 15 | `src/lib/scheduler/index.ts` | 146 | Scheduler barrel index — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 16 | `src/lib/sqlite-compat.ts` | 142 | SQLite compatibility layer — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 17 | `src/lib/devil/market-mood.ts` | 137 | Market mood logic (devil module) — never imported (despite UI components in devil/ being orphaned too). | 🗑️ delete (verify no Python/external caller first) |
| 18 | `src/lib/pick-formatter.ts` | 116 | Pick formatting utility — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 19 | `src/lib/use-undo-redo.ts` | 98 | Undo/redo React hook — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 20 | `src/lib/use-engine-updates.ts` | 65 | Engine updates React hook — never imported. | 🗑️ delete (verify no Python/external caller first) |
| 21 | `src/lib/build-trigger.ts` | 1 | Build trigger placeholder (1 line) — never imported. | 🗑️ delete (verify no Python/external caller first) |

**Note**: All devil lib modules except `market-mood.ts` ARE active — only the UI side (4 components) and `market-mood.ts` lib are orphaned. The other devil libs (`devil-orchestrator.ts`, `chain-reaction-engine.ts`, `regime-engine.ts`, etc.) are imported by API routes.

### 3.3 Orphan API routes (136 files, ~13,525 LOC)

**Caveat**: Some of these endpoints are likely designed for **external invocation** (uptime monitors, external cron, admin scripts run from CLI). The audit only flags them as orphan based on absence of `fetch('/api/...')` calls anywhere in `src/` or any Python/JS file under project root. Before deleting, verify against external uptime monitors / load balancers.

**Orphan API categories**:

| Category | Active | Orphan | Notes |
|----------|-------:|-------:|-------|
| `admin` | 96 | 17 |  |
| `mobile` | 35 | 13 | 13 of 48 mobile routes are orphan — possibly deprecated mobile-app endpoints |
| `cron` | 2 | 8 | 8 of 8 cron routes are orphan — likely external-only (designed for uptime monitor pings) |
| `predictions` | 28 | 7 |  |
| `learning-params` | 0 | 4 |  |
| `maestro` | 5 | 4 | 4 of 9 maestro routes are orphan — full feature being phased out per PHASE-5 (Maestro dead) |
| `market` | 27 | 4 |  |
| `stocks` | 21 | 4 |  |
| `auto-refresh` | 0 | 3 | 3 of 3 auto-refresh routes are orphan — feature appears fully dead |
| `community` | 0 | 3 | 3 of 3 community routes are orphan — community feature deprecated |
| `portfolio` | 17 | 3 |  |
| `risk` | 2 | 3 | 3 of 5 risk routes are orphan |
| `scraper` | 0 | 3 | 3 of 3 scraper routes are orphan — admin scraper control panel (never wired in UI) |
| `technical` | 0 | 3 | 3 of 3 technical routes are orphan — Python technical-analysis service starter/stopper |
| `analysis` | 0 | 2 |  |
| `crypto` | 21 | 2 |  |
| `data-engine` | 10 | 2 |  |
| `egxpilot` | 1 | 2 |  |
| `historical` | 0 | 2 |  |
| `instapay` | 1 | 2 |  |
| `learning` | 3 | 2 |  |
| `legal` | 0 | 2 | 2 of 2 legal routes are orphan (privacy + terms API — duplicated by static /legal/* pages) |
| `metals-forex` | 1 | 2 | 2 of 2 metals-forex routes are orphan |
| `news` | 3 | 2 |  |
| `sniper` | 4 | 2 |  |
| `unified-analysis` | 1 | 2 |  |
| `v2` | 22 | 2 |  |
| `advanced-analysis` | 2 | 1 |  |
| `ai-performance` | 0 | 1 |  |
| `ai-predictions` | 1 | 1 |  |
| `ai-proxy` | 0 | 1 |  |
| `backtesting` | 2 | 1 |  |
| `data-import` | 0 | 1 |  |
| `database-report` | 0 | 1 |  |
| `db-stats` | 0 | 1 |  |
| `dividend-analysis` | 0 | 1 |  |
| `expert-recommendations` | 4 | 1 |  |
| `finance` | 18 | 1 |  |
| `market-learning` | 0 | 1 |  |
| `market-screen` | 0 | 1 |  |
| `monthly-performance` | 0 | 1 |  |
| `recommendations` | 7 | 1 |  |
| `run-all` | 0 | 1 |  |
| `scheduler` | 0 | 1 |  |
| `seed-experts` | 0 | 1 |  |
| `stock-detail` | 0 | 1 |  |
| `stock-seasonality` | 0 | 1 |  |
| `sync-prices` | 0 | 1 |  |
| `system` | 0 | 1 |  |
| `tab-data` | 0 | 1 |  |
| `telegram` | 3 | 1 |  |
| `test-db` | 0 | 1 | Test endpoints — should never be in production |
| `test-simple` | 0 | 1 | Test endpoints — should never be in production |
| `topology` | 0 | 1 |  |
| `unified-crypto` | 0 | 1 |  |
| `unified-market-analysis` | 0 | 1 |  |
| `unified-stocks` | 0 | 1 |  |
| `us-stocks` | 0 | 1 |  |
| `[...slug]` | 1 | 0 |  |
| `ai` | 3 | 0 |  |
| `ai-analysis` | 1 | 0 |  |
| `alerts` | 6 | 0 |  |
| `analysis-engine` | 1 | 0 |  |
| `analyst` | 1 | 0 |  |
| `app` | 1 | 0 |  |
| `auth` | 9 | 0 |  |
| `backtest` | 1 | 0 |  |
| `cache` | 2 | 0 |  |
| `chart` | 1 | 0 |  |
| `confluence` | 3 | 0 |  |
| `crypto-backtesting` | 1 | 0 |  |
| `crypto-lab` | 2 | 0 |  |
| `crypto-predictions` | 1 | 0 |  |
| `currency` | 3 | 0 |  |
| `data-status` | 1 | 0 |  |
| `deal-advisor` | 1 | 0 |  |
| `devil` | 5 | 0 |  |
| `disclosures` | 1 | 0 |  |
| `dividend-calendar` | 1 | 0 |  |
| `dynamic-analysis` | 1 | 0 |  |
| `egx` | 2 | 0 |  |
| `eodhd` | 1 | 0 |  |
| `explosive` | 3 | 0 |  |
| `export` | 1 | 0 |  |
| `features` | 1 | 0 |  |
| `feedback` | 1 | 0 |  |
| `flow` | 2 | 0 |  |
| `fomo` | 1 | 0 |  |
| `global-predictions` | 1 | 0 |  |
| `google-play` | 1 | 0 |  |
| `health` | 1 | 0 |  |
| `hunter` | 5 | 0 |  |
| `import` | 1 | 0 |  |
| `indicator-trust-scores` | 1 | 0 |  |
| `init-db` | 1 | 0 |  |
| `iterative-learning` | 1 | 0 |  |
| `keepalive` | 1 | 0 |  |
| `kimi` | 1 | 0 |  |
| `live` | 2 | 0 |  |
| `live-monitor` | 3 | 0 |  |
| `maker-radar` | 10 | 0 |  |
| `market-pulse` | 1 | 0 |  |
| `metals` | 2 | 0 |  |
| `money` | 3 | 0 |  |
| `mubasher` | 1 | 0 |  |
| `multi-market` | 1 | 0 |  |
| `news-feed` | 1 | 0 |  |
| `notifications` | 1 | 0 |  |
| `paper-trading` | 1 | 0 |  |
| `paper-trading-v2` | 6 | 0 |  |
| `parse-recommendations` | 1 | 0 |  |
| `payments` | 1 | 0 |  |
| `paymob` | 3 | 0 |  |
| `persona` | 4 | 0 |  |
| `points` | 2 | 0 |  |
| `prediction-performance` | 1 | 0 |  |
| `proxy` | 1 | 0 |  |
| `proxy-prod` | 1 | 0 |  |
| `push` | 1 | 0 |  |
| `python` | 1 | 0 |  |
| `real-predictions` | 1 | 0 |  |
| `redeem-promo` | 1 | 0 |  |
| `reports` | 3 | 0 |  |
| `scanner` | 2 | 0 |  |
| `screener` | 1 | 0 |  |
| `seasonality-signals` | 1 | 0 |  |
| `sectors` | 2 | 0 |  |
| `seed-recommendations` | 1 | 0 |  |
| `self-learning` | 1 | 0 |  |
| `smart-confluence` | 2 | 0 |  |
| `stats` | 1 | 0 |  |
| `stock` | 1 | 0 |  |
| `stock-notebook` | 1 | 0 |  |
| `stock-profile` | 1 | 0 |  |
| `stored-analysis` | 2 | 0 |  |
| `subscribe` | 1 | 0 |  |
| `subscription` | 13 | 0 |  |
| `sync-historical` | 1 | 0 |  |
| `sync-names` | 1 | 0 |  |
| `system-control` | 1 | 0 |  |
| `tips` | 1 | 0 |  |
| `track` | 1 | 0 |  |
| `trading` | 1 | 0 |  |
| `trading-journal` | 2 | 0 |  |
| `unified` | 2 | 0 |  |
| `unified-learning` | 6 | 0 |  |
| `unified-scoring` | 1 | 0 |  |
| `unknown` | 1 | 0 |  |
| `user-posts` | 3 | 0 |  |
| `v4` | 1 | 0 |  |
| `v82` | 1 | 0 |  |
| `walk-forward` | 1 | 0 |  |
| `walk-forward-test` | 1 | 0 |  |
| `watchlist` | 2 | 0 |  |
| `watchlist-enhanced` | 1 | 0 |  |
| `zakat` | 1 | 0 |  |

##### Full list of orphan APIs (sorted by category, then route)

| # | Route | LOC | Methods | Notes |
|---|-------|----:|---------|-------|
| 1 | `/api/admin/advanced-analysis/config` | 114 | `GET,PUT` | Admin advanced-analysis config endpoint |
| 2 | `/api/admin/advanced-analysis/run` | 769 | `POST,GET` | Admin trigger to run advanced-analysis scan |
| 3 | `/api/admin/ai-predictions/evaluate-range` | 82 | `POST` | Range evaluation for AI predictions |
| 4 | `/api/admin/clear-junk-data` | 138 | `POST,GET` | Clear junk data utility |
| 5 | `/api/admin/clear-predictions` | 51 | `POST` | Clear predictions table |
| 6 | `/api/admin/db-explorer` | 138 | `GET` | DB explorer endpoint |
| 7 | `/api/admin/db-manager/cleanup-symbols` | 45 | `POST` | Symbol cleanup |
| 8 | `/api/admin/db-manager/import-egx30` | 45 | `POST` | Import EGX30 symbols |
| 9 | `/api/admin/db-manager/repair-all` | 48 | `POST` | Repair all DB tables |
| 10 | `/api/admin/db-manager/repair-engine` | 45 | `POST` | Repair DB engine |
| 11 | `/api/admin/feature-flags` | 32 | `GET` | Feature flags config |
| 12 | `/api/admin/import-egxpilot` | 201 | `POST,GET` | Import from egxpilot source |
| 13 | `/api/admin/learned-lessons` | 32 | `GET` | Learned lessons admin viewer |
| 14 | `/api/admin/market-status` | 32 | `GET` | Market status admin endpoint |
| 15 | `/api/admin/phase4-status` | 32 | `GET` | Phase-4 status check |
| 16 | `/api/admin/retroactive-predictions` | 31 | `POST` | Retroactive prediction generator |
| 17 | `/api/admin/sync-fundamentals` | 31 | `POST` | Sync fundamentals data |
| 18 | `/api/advanced-analysis/scan-all` | 950 | `GET,POST` | Scan-all trigger |
| 19 | `/api/ai-performance` | 321 | `GET` | AI performance metrics |
| 20 | `/api/ai-predictions/extract` | 28 | `GET` | Extract AI predictions |
| 21 | `/api/ai-proxy` | 28 | `GET` | AI proxy endpoint |
| 22 | `/api/analysis/results` | 48 | `GET` | Analysis results viewer |
| 23 | `/api/analysis/status` | 28 | `GET` | Analysis status |
| 24 | `/api/auto-refresh/start` | 71 | `POST` | Auto-refresh start (feature dead) |
| 25 | `/api/auto-refresh/status` | 81 | `GET` | Auto-refresh status |
| 26 | `/api/auto-refresh/stop` | 39 | `POST` | Auto-refresh stop |
| 27 | `/api/backtesting/apply-params` | 28 | `GET` | Apply backtest params |
| 28 | `/api/community` | 60 | `GET,POST` | Community main endpoint |
| 29 | `/api/community/posts/[post_id]/comments` | 50 | `GET,POST` | Post comments endpoint |
| 30 | `/api/community/seed` | 265 | `GET,POST` | Community seed endpoint |
| 31 | `/api/cron/confluence` | 28 | `GET` | Cron: confluence |
| 32 | `/api/cron/daily-telegram` | 28 | `GET` | Cron: daily Telegram message |
| 33 | `/api/cron/learning` | 28 | `GET` | Cron: learning engine |
| 34 | `/api/cron/precompute` | 28 | `GET` | Cron: precompute |
| 35 | `/api/cron/predictions` | 28 | `GET` | Cron: predictions generator |
| 36 | `/api/cron/screener` | 28 | `GET` | Cron: screener refresh |
| 37 | `/api/cron/update-cache` | 28 | `GET` | Cron: cache update |
| 38 | `/api/cron/verify-predictions` | 28 | `GET` | Cron: prediction verification |
| 39 | `/api/crypto/start` | 119 | `POST` | Crypto data starter |
| 40 | `/api/crypto/status` | 17 | `GET` | Crypto status |
| 41 | `/api/data-engine/compare-db` | 28 | `GET` | Compare DBs |
| 42 | `/api/data-engine/new-db-stats` | 93 | `GET` | New DB stats |
| 43 | `/api/data-import` | 28 | `POST` | Data import endpoint |
| 44 | `/api/database-report` | 28 | `GET` | Database report |
| 45 | `/api/db-stats` | 57 | `GET` | DB statistics |
| 46 | `/api/dividend-analysis` | 28 | `GET` | Dividend analysis |
| 47 | `/api/egxpilot/analysis/[ticker]` | 28 | `GET` | EGXpilot ticker analysis |
| 48 | `/api/egxpilot/stocks` | 174 | `GET,POST` | EGXpilot stocks list |
| 49 | `/api/expert-recommendations/experts` | 74 | `GET` | Experts list |
| 50 | `/api/finance/screener` | 266 | `GET,POST` | Finance screener |
| 51 | `/api/historical/start` | 115 | `POST,GET` | Historical data starter |
| 52 | `/api/historical/status` | 28 | `GET` | Historical data status |
| 53 | `/api/instapay/approve` | 118 | `POST` | InstaPay approval |
| 54 | `/api/instapay/verify` | 178 | `POST,GET` | InstaPay verification |
| 55 | `/api/learning-params` | 28 | `GET` | Learning params endpoint |
| 56 | `/api/learning-params/active` | 28 | `GET` | Active learning params |
| 57 | `/api/learning-params/init` | 28 | `GET` | Init learning params |
| 58 | `/api/learning-params/save` | 28 | `GET` | Save learning params |
| 59 | `/api/learning/content` | 28 | `GET` | Learning content endpoint |
| 60 | `/api/learning/progress` | 94 | `GET,POST` | Learning progress |
| 61 | `/api/legal/privacy` | 137 | `GET` | Privacy API (duplicate of /legal/privacy static page) |
| 62 | `/api/legal/terms` | 168 | `GET` | Terms API (duplicate of /legal/terms static page) |
| 63 | `/api/maestro/command-center` | 28 | `GET` | Maestro command center |
| 64 | `/api/maestro/config` | 28 | `GET` | Maestro config |
| 65 | `/api/maestro/logic-panel` | 573 | `GET` | Maestro logic panel |
| 66 | `/api/maestro/personas` | 28 | `GET` | Maestro personas |
| 67 | `/api/market-learning` | 28 | `GET` | Market learning endpoint |
| 68 | `/api/market-screen` | 28 | `GET` | Market screen |
| 69 | `/api/market/bulk-update` | 28 | `POST` | Bulk update market data |
| 70 | `/api/market/incremental-sync` | 36 | `GET,POST` | Incremental sync |
| 71 | `/api/market/sync-historical` | 28 | `POST` | Sync historical data |
| 72 | `/api/market/top-movers` | 75 | `GET` | Top market movers |
| 73 | `/api/metals-forex/start` | 99 | `POST` | Metals/forex starter |
| 74 | `/api/metals-forex/stop` | 33 | `POST` | Metals/forex stopper |
| 75 | `/api/mobile/analysis/EGX` | 28 | `GET` | Mobile EGX analysis |
| 76 | `/api/mobile/analysis/[ticker]` | 28 | `GET` | Mobile ticker analysis |
| 77 | `/api/mobile/community` | 93 | `GET,POST` | Mobile community |
| 78 | `/api/mobile/crypto/learning` | 197 | `GET` | Mobile crypto learning |
| 79 | `/api/mobile/crypto/recommendations` | 174 | `GET` | Mobile crypto recommendations |
| 80 | `/api/mobile/crypto/watchlist` | 135 | `GET` | Mobile crypto watchlist |
| 81 | `/api/mobile/currency` | 79 | `GET` | Mobile currency |
| 82 | `/api/mobile/learning` | 309 | `GET` | Mobile learning |
| 83 | `/api/mobile/maestro` | 150 | `GET,POST` | Mobile maestro |
| 84 | `/api/mobile/news` | 219 | `GET,POST` | Mobile news |
| 85 | `/api/mobile/signals` | 28 | `GET` | Mobile signals |
| 86 | `/api/mobile/stocks/EGX/professional-analysis` | 28 | `GET` | Mobile EGX professional analysis |
| 87 | `/api/mobile/subscription` | 140 | `GET` | Mobile subscription |
| 88 | `/api/monthly-performance` | 28 | `GET` | Monthly performance metrics |
| 89 | `/api/news/apikeys` | 167 | `GET,POST,DELETE` | News API keys manager |
| 90 | `/api/news/apikeys/verify` | 161 | `POST` | News API keys verifier |
| 91 | `/api/portfolio/analyze` | 28 | `GET` | Portfolio analyze endpoint |
| 92 | `/api/portfolio/assets` | 67 | `GET` | Portfolio assets |
| 93 | `/api/portfolio/import-real` | 222 | `POST,GET` | Import real portfolio |
| 94 | `/api/predictions/credibility` | 489 | `GET` | Prediction credibility |
| 95 | `/api/predictions/export-pdf` | 391 | `GET` | Export predictions as PDF |
| 96 | `/api/predictions/intraday` | 87 | `GET` | Intraday predictions |
| 97 | `/api/predictions/live` | 198 | `GET,POST` | Live predictions |
| 98 | `/api/predictions/price-verify` | 362 | `POST,GET` | Price verification |
| 99 | `/api/predictions/seed` | 31 | `POST,GET` | Seed predictions |
| 100 | `/api/predictions/verify` | 28 | `GET` | Verify predictions |
| 101 | `/api/recommendations/batch` | 28 | `GET` | Batch recommendations |
| 102 | `/api/risk/position-size` | 28 | `GET` | Risk position sizing |
| 103 | `/api/risk/stop-loss` | 28 | `GET` | Risk stop-loss |
| 104 | `/api/risk/targets` | 28 | `GET` | Risk targets |
| 105 | `/api/run-all` | 146 | `POST,GET` | Run-all trigger |
| 106 | `/api/scheduler/run` | 28 | `GET` | Scheduler run |
| 107 | `/api/scraper/start` | 136 | `POST` | Scraper starter |
| 108 | `/api/scraper/status` | 17 | `GET` | Scraper status |
| 109 | `/api/scraper/stop` | 6 | `POST` | Scraper stopper |
| 110 | `/api/seed-experts` | 163 | `POST,GET` | Seed experts |
| 111 | `/api/sniper/closer/pending` | 42 | `GET` | Sniper closer pending |
| 112 | `/api/sniper/closer/run` | 14 | `POST` | Sniper closer run |
| 113 | `/api/stock-detail` | 82 | `GET` | Stock detail endpoint |
| 114 | `/api/stock-seasonality` | 28 | `GET` | Stock seasonality |
| 115 | `/api/stocks/analysis` | 28 | `GET` | Stocks analysis |
| 116 | `/api/stocks/batch-analysis` | 28 | `GET` | Stocks batch analysis |
| 117 | `/api/stocks/confluence` | 28 | `GET` | Stocks confluence |
| 118 | `/api/stocks/recommendations` | 28 | `GET` | Stocks recommendations |
| 119 | `/api/sync-prices` | 189 | `GET,POST` | Sync prices |
| 120 | `/api/system/db-health` | 81 | `GET` | System DB health |
| 121 | `/api/tab-data` | 62 | `GET` | Tab data endpoint |
| 122 | `/api/technical/start` | 127 | `POST` | Technical starter |
| 123 | `/api/technical/status` | 44 | `GET` | Technical status |
| 124 | `/api/technical/stop` | 40 | `POST` | Technical stopper |
| 125 | `/api/telegram/share` | 298 | `POST,GET` | Telegram share endpoint |
| 126 | `/api/test-db` | 43 | `GET` | Test DB endpoint (should not be in production) |
| 127 | `/api/test-simple` | 10 | `GET` | Simple test endpoint (should not be in production) |
| 128 | `/api/topology` | 46 | `GET` | Topology endpoint |
| 129 | `/api/unified-analysis/[symbol]` | 440 | `GET` | Unified analysis by symbol |
| 130 | `/api/unified-analysis/recommendations` | 185 | `GET` | Unified analysis recommendations |
| 131 | `/api/unified-crypto` | 32 | `GET` | Unified crypto endpoint |
| 132 | `/api/unified-market-analysis` | 28 | `GET` | Unified market analysis |
| 133 | `/api/unified-stocks` | 44 | `GET` | Unified stocks endpoint |
| 134 | `/api/us-stocks` | 28 | `GET` | US stocks endpoint |
| 135 | `/api/v2/feedback/backtest` | 28 | `GET` | V2 feedback backtest |
| 136 | `/api/v2/feedback/predictions` | 30 | `GET` | V2 feedback predictions |

## 4. Hidden Gems (الكنوز المخفية)

> Components/libraries that exist and work but aren't surfaced in the UI render tree (i.e., not loaded by `src/app/page.tsx`).

### 4.1 Component-level Hidden Gems

| File | LOC | Description | Why Hidden |
|------|----:|-------------|-----------|
| `src/components/studio/FlowCanvas.tsx` | 685 | Visual node-based flow canvas (React Flow) with orchestrator/data-source/engine/result nodes + custom edges + toolbar | Entire studio/ folder is orphaned — likely a planned "engine builder" feature that was never wired into navigation |
| `src/components/recommendations/AiRecommendations.tsx` | 2209 | Full AI-powered recommendations panel with persona-driven stock picks, scenarios, and explanations | Superseded by MarketAnalysisView persona tabs but never deleted — 2,209 LOC of working code |
| `src/components/admin/SystemTopologyGraph.tsx` | 850 | System topology visualization showing all engines/data flows as an interactive graph | Never wired into AdminView tabs — would be a great addition to the admin overview |
| `src/components/admin/CryptoPredictionGenerator.tsx` | 593 | Admin panel to generate crypto predictions with model selection + parameter tuning | Only mentioned in a comment at AdminView.tsx:71 — never imported |
| `src/components/admin/OptimizerParamsPanel.tsx` | 372 | Optimizer parameter tuning admin panel | Never wired into AdminView |
| `src/components/admin/RowEditorModal.tsx` | 286 | Generic row editor modal for in-place DB row editing | Could be used by DatabaseManagerFull but isn't |
| `src/components/admin/live-chart/index.tsx` | 281 | Live chart admin page with real-time updates | Only referenced as id string in PlatformGuide.tsx |
| `src/components/dashboard/LiquidityFlowPanel.tsx` | 439 | Liquidity flow visualization panel | Could be a great dashboard widget |
| `src/components/dashboard/IntradayPressurePanel.tsx` | 361 | Intraday buy/sell pressure panel | Could be a great dashboard widget |
| `src/components/dashboard/PredictionsBacktestTable.tsx` | 533 | Predictions backtest results table | Could be a great dashboard widget |
| `src/components/portfolio/PositionDeepDiveDrawer.tsx` | 223 | Position deep-dive drawer showing detailed analysis for a single position | Could enhance EnhancedPortfolioView |
| `src/components/portfolio/RiskManagementBar.tsx` | 98 | Risk management visual bar | Could enhance portfolio risk UI |
| `src/components/portfolio/UnifiedHoldingsTable.tsx` | 381 | Unified holdings table with advanced features | Superseded by EnhancedPortfolioView internal table |
| `src/components/portfolio/WealthCharts.tsx` | 346 | Wealth charts (portfolio variant) | Superseded by admin/WealthCharts.tsx which is active |
| `src/components/analysis/market-analysis/LiveTrackingTab.tsx` | 720 | Live tracking tab for market-analysis (real-time stock tracking) | Never wired into MarketAnalysisView tabs array |
| `src/components/analysis/market-analysis/CryptoPredictionsTab.tsx` | 519 | Crypto predictions tab for market-analysis | Never wired into MarketAnalysisView tabs array |
| `src/components/analysis/market-analysis/ExpertPredictionsTab.tsx` | 514 | Expert predictions tab for market-analysis | Never wired into MarketAnalysisView tabs array |
| `src/components/recommendations/RecommendationMonitoring.tsx` | 565 | Recommendation monitoring dashboard | Superseded by PredictionTrackingView |
| `src/components/devil/DevilsCard.tsx` | 314 | Devil's advocate card showing contrarian view | Never rendered in UI despite full lib support |
| `src/components/devil/MarketMood.tsx` | 186 | Market mood widget | Never rendered |
| `src/components/devil/DevilsCalendar.tsx` | 193 | Devil's calendar showing upcoming contrarian events | Never rendered |
| `src/components/devil/ScenarioMatrix.tsx` | 182 | Scenario matrix view | Never rendered |
| `src/components/screener/StockScreener.tsx` | 590 | Legacy stock screener (predecessor of StockScreenerAdvanced) | Superseded — kept for reference |
| `src/components/news-feed-widget.tsx` | 216 | Early news feed widget prototype — superseded by `news/NewsFeedView.tsx`. | Zero importers — `DashboardView.tsx` uses `auto-analysis-widget.tsx` + `eid-predictions-widget.tsx` but never imported `news-feed-widget.tsx`. |
| `src/components/auto-analysis-widget.tsx` | 259 | Auto-analysis widget — ACTIVE (imported by `DashboardView.tsx`). | Not hidden — included as a record that this root-level widget is alive. |
| `src/components/eid-predictions-widget.tsx` | 255 | Eid predictions widget — ACTIVE (imported by `DashboardView.tsx`). | Not hidden — included as a record that this root-level widget is alive. |
| `src/components/layout/Sidebar.tsx` | 644 | Legacy left-sidebar navigation | Replaced by TopBar.tsx per comment at TopBar.tsx:6 |

### 4.2 Lib-level Hidden Gems

| File | LOC | Description | Why Hidden |
|------|----:|-------------|-----------|
| `src/lib/analysis-engine.ts` | 3126 | Technical indicator library: MACD, RSI, Bollinger Bands, StochasticRSI, ATR, OBV. 3,126 LOC of pure functions. Could power TradingChartView's indicator overlays. | Never imported — only mentioned in a comment at /api/analysis-engine/route.ts:203 (which is itself an orphan API). |
| `src/lib/cache/precomputed-cache.ts` | 1000 | Precomputed results cache (1,000 LOC). Designed for caching expensive analysis computations. | Never imported — sibling cache/api-cache.ts and cache/data-freshness.ts are imported but this one isn't. |
| `src/lib/use-python-api.ts` | 451 | React hook for calling the Python backend API (451 LOC). | Never imported — likely superseded by direct fetch calls. |
| `src/lib/seed-historical-data.ts` | 622 | Historical data seeding utility (622 LOC). | Never imported — possibly a one-time script-style lib that was inlined into scripts/. |
| `src/lib/technical-analysis.ts` | 488 | Technical analysis helper module (488 LOC). | Never imported — possibly duplicate of analysis-engine.ts. |
| `src/lib/persona-matrix.ts` | 196 | Persona matrix data (196 LOC). | Never imported — possibly superseded by persona-dynamic.ts (which IS active). |
| `src/lib/paymob.ts` | 425 | Paymob payment integration lib (425 LOC). | Never imported — paymob API routes call paymob SDK directly, not this lib. |

## 5. Duplicates (التكرارات)

### 5.1 Confirmed Duplicate Pairs

| # | File A | File B | Similarity | Recommendation |
|---|--------|--------|-----------|----------------|
| 1 | `src/components/share/ShareButton.tsx` (583 LOC, 9 importers) | `src/components/shared/ShareButton.tsx` (449 LOC, 2 importers) | Same component name, both implement social/image sharing with different UI shells (Popover vs Dialog). `share/` uses `OFFICIAL_LINKS_BLOCK` + `ShareStockData` interface; `shared/` adds Facebook/Send/MessageCircle buttons. | 🔁 **Merge**: keep `shared/ShareButton.tsx` (broader feature set) and migrate the 9 callers of `share/ShareButton.tsx`. OR rename `shared/ShareButton.tsx` → `shared/SocialShareButton.tsx` to disambiguate. |
| 2 | `src/components/portfolio/WealthCharts.tsx` (346 LOC, 0 importers ⚠️) | `src/components/admin/WealthCharts.tsx` (465 LOC, 1 importer — page.tsx DYNAMIC) | Both implement wealth visualization (line/pie/bar charts) but with different data sources. `admin/WealthCharts` is the ACTIVE one (loaded by page.tsx for `wealth` view). | 🗑️ **Delete** `portfolio/WealthCharts.tsx` (orphan, superseded). |
| 3 | `src/components/screener/StockScreener.tsx` (590 LOC, 0 importers ⚠️) | `src/components/screener/StockScreenerAdvanced.tsx` (2,083 LOC, 2 importers — page.tsx DYNAMIC + PredictionTrackingDashboard) | Same domain — `StockScreenerAdvanced` is the active replacement with more features. | 🗑️ **Delete** legacy `StockScreener.tsx` (and its 4 sub-component helpers: `BottomPanel`, `ChartCard`, `ComparisonChartCard`, `WatchlistSidebar`). |
| 4 | `src/lib/stock-movement-classification.ts` (365 LOC, 0 importers ⚠️) | `src/lib/stock-movement-classifier.ts` (290 LOC, 0 importers ⚠️) | Two lib files with nearly identical names — both implement stock movement classification. Both are orphan. | 🗑️ **Delete both** (no callers anywhere) OR investigate which is canonical if one is needed. |
| 5 | `src/components/ui/chart.tsx` (shadcn chart wrapper) | `src/components/analysis/InteractiveChart.tsx` (1,677 LOC) + `src/components/stocks/TradingViewChart.tsx` (1,821 LOC) + `src/components/analysis/TradingChartView.tsx` (loaded DYNAMIC in page.tsx) | Four different "chart" implementations exist — shadcn wrapper, recharts-based interactive, TradingView embedded, and the active view. | Not a true duplicate (different chart types) — but warrants documentation of which chart is used where. |
| 6 | `src/components/ai/AIView.tsx` (orphan) | `src/components/ai/AIAssistantChat.tsx` (orphan) | `src/components/ai/FloatingAssistant.tsx` (ACTIVE) | `src/components/ai/AIAnalysisWidget.tsx` (ACTIVE) | Multiple AI UI entry points — only FloatingAssistant and AIAnalysisWidget are wired. | 🗑️ **Delete** AIView + AIAssistantChat (orphans). |

### 5.2 Semantic Overlap (Similar-Function Families)

These aren't strict duplicates but represent families of files doing similar work — useful for understanding sprawl:

| Family | Files | Active | Orphan | Notes |
|--------|------|-------:|-------:|-------|
| **Chart components** | 11 | 4 | 7 | Includes `ui/chart.tsx`, `InteractiveChart`, `TradingChartView`, `TradingViewChart`, `CryptoTradingChartView`, `ChartControls`, `ChartCard`, `ComparisonChartCard`, `chartIndicators.ts`, `WealthCharts` x2 |
| **Analysis views** | 13 | 5 | 8 | `MarketAnalysisView` (active) + `UnifiedAnalysisView` (active) + `SpecialistAnalysisView` (active) + `SingleStockAnalysisView` (orphan) + `GateAnalysisView` (orphan) + `StockAdvancedAnalysisView` (orphan) + `ComprehensiveStockAnalysis` (orphan) + `DeepAnalysis` (orphan) + `AnalysisFlowDiagram` (orphan) + `CryptoAdvancedAnalysisView` (active) + `AIAnalysisWidget` (active) + `auto-analysis-widget` (active — imported by DashboardView) |
| **Prediction views** | 13 | 6 | 7 | `PredictionTrackingView`, `DualTrackPredictionsView`, `PicksManagementView`, `MakerRadarTab`, `PredictionTrackingDashboard`, `CryptoPredictionTrackingView` (active); plus orphans: `CryptoPredictionsTab`, `ExpertPredictionsTab`, `PredictionsBacktestTable`, `PredictionsImageCard`, `ExpertPredictionsImageCard`, `CryptoPredictionGenerator` (note: `eid-predictions-widget` is ACTIVE — imported by DashboardView) |
| **Recommendation panels** | 6 | 1 | 5 | Only `RefreshAnalyticsButton` is active; the 5 orphan files in `recommendations/*` represent the legacy recommendation system |
| **Screener family** | 8 | 2 | 6 | `StockScreenerAdvanced` + `chartIndicators.ts` (active); 6 legacy screener files |
| **Portfolio family** | 16 | 9 | 7 | `EnhancedPortfolioView`, `RoboAdvisorPanel`, `PortfolioIntelligencePanel`, `SmartAssistantPanel`, `TopUpRecommendationsPanel`, `RealReturnPanel`, `MasterPortfolioSummary`, `RiskProfilerQuiz`, `MultiPortfolioSelector` (active); orphans include `UnifiedHoldingsTable`, `PositionDeepDiveDrawer`, `RiskManagementBar`, `WealthCharts`, `AdvancedPortfolioManager` (active!), `BagHolderRescuePanel` (active), `StockSearchDropdown` (active) |
| **Studio family (visual flow)** | 9 | 0 | 9 | **All 9 studio files are orphan** — React Flow–based visual node editor (likely a planned feature) |
| **Devil family** | 4 UI + 8 lib | 0 UI / 7 lib | 4 UI / 1 lib | The lib modules are imported by API routes (`devil-orchestrator`, `chain-reaction-engine`, etc.) but the UI components were never rendered |

## 6. Tech Debt (الديون التقنية)

### 6.1 TODO / FIXME / HACK / @deprecated Markers

Only **10 files** contain TODO/FIXME/HACK/XXX/@deprecated markers (very low density — codebase is clean):

| File | Line | Marker | Comment |
|------|-----:|--------|---------|
| `src/components/subscription/SubscriptionView.tsx` | 1392 | _(placeholder)_ | `placeholder="01XXXXXXXXX"` — uses X-characters (not a real TODO, just pattern matching artifact) |
| `src/components/memory/TradingMemoryView.tsx` | 141 | `// TODO:` | `Open trade recording dialog` — unimplemented feature stub |
| `src/lib/new-db.ts` | 127 | `@deprecated` | `custom.db has been removed. Use Prisma with auth.db for user data.` — function is dead code |
| `src/lib/egx-db.ts` | 1117 | `@deprecated` | `custom.db has been removed. Use Prisma for user data or stocks.db for stock data.` |
| `src/lib/egx-db.ts` | 1126 | `@deprecated` | `custom.db has been removed. This always returns true if stocks.db exists.` |
| `src/lib/egx-db.ts` | 1154 | `// TODO:` | `Implement currency rates fetching` — function is a stub |
| `src/lib/egx-db.ts` | 1160 | `// TODO:` | `Implement currency rates update` — function is a stub |
| `src/lib/egx-db.ts` | 1166 | `// TODO:` | `Implement gold prices fetching` — function is a stub |
| `src/lib/egx-db.ts` | 1172 | `// TODO:` | `Implement gold prices update` — function is a stub |
| `src/lib/egx-db.ts` | 1189 | `// TODO:` | `Implement stock analysis retrieval from learned.db` — function is a stub |
| `src/lib/egx-db.ts` | 1220 | `// TODO:` | `Implement batch analysis retrieval` — function is a stub |
| `src/lib/egx-db.ts` | 1236 | `// TODO:` | `Implement tips by category` — function is a stub |
| `src/lib/egx-db.ts` | 1241 | `// TODO:` | `Implement random tip` — function is a stub |
| `src/lib/finance-db.ts` | 21 | `@deprecated` | `custom.db has been removed. Uses stocks.db instead.` |
| `src/app/api/admin/recommendations/route.ts` | 78 | `// TODO:` | `Save recommendations to database when model is available` — endpoint works but doesn't persist |
| `src/app/api/telegram/share/route.ts` | 20 | _(comment)_ | `Get the channel chat_id (can be @channel_username or -100XXXXXXXXXX)` — note about format |
| `src/hooks/use-persona-results.ts` | 3 | `* TODO:` | `يجب إضافة import لهذا hook في المكونات المناسبة` (Arabic: "should add import for this hook in appropriate components") — hook is orphan |
| `src/app/api/google-play/verify-receipt/route.ts` | 55 | `// TODO:` | `In production, verify with Google Play API` — incomplete implementation |
| `src/app/api/google-play/verify-receipt/route.ts` | 147 | `// TODO:` | `Implement real Google Play API verification` — incomplete implementation |
| `src/app/api/portfolio/smart-monitor/signals/route.ts` | 2 | _(comment)_ | `GET /api/portfolio/smart-monitor/signals?ticker=XXX` — just route documentation |

**Tech Debt Hotspot**: `src/lib/egx-db.ts` has **8 TODO stubs** + **2 @deprecated markers** — this is the single largest concentration of tech debt in the codebase. The 8 TODO stubs are all `function` declarations that just throw or return null. They appear to be placeholders for a planned migration to `learned.db` that never happened.

### 6.2 Other Tech Debt Indicators

- **Dead DB references**: `custom.db` was removed from the codebase but is still referenced in `@deprecated` JSDoc comments in 3 lib files (`new-db.ts`, `egx-db.ts` x2, `finance-db.ts`). These should be cleaned up.
- **Phase-5 Maestro migration**: Multiple `// Maestro مات` ("Maestro is dead") comments scattered throughout the codebase indicate the Maestro feature is being phased out. 4 of 9 `/api/maestro/*` routes are orphaned — confirms the phase-out is in progress.
- **UI-MIRROR PROTOCOL** (per page.tsx:84): Crypto views were merged into stock views via `setCurrentMarket('CRYPTO')` — but 6+ crypto-specific components still exist (some active, some orphaned). This is documented but worth tracking.

## 7. Heavy Files (أكبر الملفات)

### 7.1 Top 10 by LOC (combined components + lib + API)

| # | File | LOC | Layer | Status |
|---|------|----:|-------|--------|
| 1 | `src/components/admin/DatabaseManagerFull.tsx` | 3284 | component | ✅ ACTIVE |
| 2 | `src/components/portfolio/EnhancedPortfolioView.tsx` | 3153 | component | 🟡 DYNAMIC |
| 3 | `src/lib/analysis-engine.ts` | 3126 | lib | ⚠️ ORPHAN |
| 4 | `src/components/admin/SuperLearningSystem.tsx` | 2480 | component | ✅ ACTIVE |
| 5 | `src/components/predictions/MakerRadarTab.tsx` | 2282 | component | ✅ ACTIVE |
| 6 | `src/components/recommendations/AiRecommendations.tsx` | 2209 | component | ⚠️ ORPHAN |
| 7 | `src/components/admin/TelegramTab.tsx` | 2200 | component | ✅ ACTIVE |
| 8 | `src/components/academy/StrategySandbox.tsx` | 2188 | component | ✅ ACTIVE |
| 9 | `src/components/analysis/market-analysis/PersonaTab.tsx` | 2140 | component | ✅ ACTIVE |
| 10 | `src/components/stocks/StocksView.tsx` | 2138 | component | 🟡 DYNAMIC |

### 7.2 Top 10 heaviest components

| # | File | LOC | Status |
|---|------|----:|--------|
| 1 | `src/components/admin/DatabaseManagerFull.tsx` | 3284 | ✅ ACTIVE |
| 2 | `src/components/portfolio/EnhancedPortfolioView.tsx` | 3153 | 🟡 DYNAMIC |
| 3 | `src/components/admin/SuperLearningSystem.tsx` | 2480 | ✅ ACTIVE |
| 4 | `src/components/predictions/MakerRadarTab.tsx` | 2282 | ✅ ACTIVE |
| 5 | `src/components/recommendations/AiRecommendations.tsx` | 2209 | ⚠️ ORPHAN |
| 6 | `src/components/admin/TelegramTab.tsx` | 2200 | ✅ ACTIVE |
| 7 | `src/components/academy/StrategySandbox.tsx` | 2188 | ✅ ACTIVE |
| 8 | `src/components/analysis/market-analysis/PersonaTab.tsx` | 2140 | ✅ ACTIVE |
| 9 | `src/components/stocks/StocksView.tsx` | 2138 | 🟡 DYNAMIC |
| 10 | `src/components/admin/AdminView.tsx` | 2109 | ✅ ACTIVE |

### 7.3 Top 10 heaviest lib modules

| # | File | LOC | Status |
|---|------|----:|--------|
| 1 | `src/lib/analysis-engine.ts` | 3126 | ⚠️ ORPHAN |
| 2 | `src/lib/honest-tracking/maestro.ts` | 1850 | ✅ ACTIVE |
| 3 | `src/lib/admin-db-manager.ts` | 1499 | ✅ ACTIVE |
| 4 | `src/lib/store.ts` | 1475 | ✅ ACTIVE |
| 5 | `src/lib/data-adapter.ts` | 1342 | ✅ ACTIVE |
| 6 | `src/lib/egx-db.ts` | 1248 | ✅ ACTIVE |
| 7 | `src/lib/multi-source-adapter.ts` | 1057 | ✅ ACTIVE |
| 8 | `src/lib/gate-analyzer.ts` | 1032 | ✅ ACTIVE |
| 9 | `src/lib/cache/precomputed-cache.ts` | 1000 | ⚠️ ORPHAN |
| 10 | `src/lib/data-engine-db.ts` | 996 | ✅ ACTIVE |

### 7.4 Top 10 heaviest API routes

| # | File | LOC | Methods | Status |
|---|------|----:|---------|--------|
| 1 | `src/app/api/deal-advisor/[ticker]/route.ts` | 977 | `GET` | ✅ ACTIVE |
| 2 | `src/app/api/advanced-analysis/scan-all/route.ts` | 950 | `GET,POST` | ⚠️ ORPHAN |
| 3 | `src/app/api/admin/advanced-analysis/run/route.ts` | 769 | `POST,GET` | ⚠️ ORPHAN |
| 4 | `src/app/api/admin/platform-performance/route.ts` | 645 | `GET` | ✅ ACTIVE |
| 5 | `src/app/api/predictions/honest-tracking/list/route.ts` | 643 | `GET` | ✅ ACTIVE |
| 6 | `src/app/api/finance/calculate-values/route.ts` | 638 | `GET` | ✅ ACTIVE |
| 7 | `src/app/api/predictions/honest-tracking/stats/route.ts` | 615 | `GET` | ✅ ACTIVE |
| 8 | `src/app/api/admin/db-manager/repair/route.ts` | 578 | `POST` | ✅ ACTIVE |
| 9 | `src/app/api/mubasher/sync/route.ts` | 576 | `POST,GET` | ✅ ACTIVE |
| 10 | `src/app/api/maestro/logic-panel/route.ts` | 573 | `GET` | ⚠️ ORPHAN |

**Note**: `src/lib/analysis-engine.ts` (3,126 LOC) is the **#3 heaviest file overall** AND it's **orphan** ⚠️ — this is a significant amount of unreferenced code (technical indicators library). Worth investigating whether to delete or wire it up.

## 8. Recommendations (التوصيات)

### Priority 1 — Quick Wins (low-risk, high-impact)

1. **🗑️ Delete `news-feed-widget.tsx`** (216 LOC) — early prototype superseded by `news/NewsFeedView.tsx`. Zero importers. (Note: `auto-analysis-widget.tsx` and `eid-predictions-widget.tsx` are NOT orphans — both are imported by `DashboardView.tsx`.)
2. **🗑️ Delete `src/components/layout/Sidebar.tsx`** (644 LOC). Replaced by `TopBar.tsx` per the comment at TopBar.tsx:6. Zero importers (and it itself imports ExchangeSelector — once Sidebar is gone, ExchangeSelector has only 1 importer).
3. **🗑️ Delete legacy screener family** (`StockScreener.tsx` + `BottomPanel.tsx` + `ChartCard.tsx` + `ComparisonChartCard.tsx` + `WatchlistSidebar.tsx` + `UnifiedScreenerView.tsx`, ~3,400 LOC). All superseded by `StockScreenerAdvanced.tsx`.
4. **🔁 Merge duplicate `ShareButton`**: pick one (recommend `shared/ShareButton.tsx` for richer UI), migrate the 9 callers of the other, then delete the loser. Saves ~500 LOC and removes a major source of confusion.
5. **🗑️ Delete `portfolio/WealthCharts.tsx`** (346 LOC). Superseded by `admin/WealthCharts.tsx` which is the one actually loaded by `page.tsx`.
6. **🗑️ Delete duplicate `stock-movement-classification.ts` + `stock-movement-classifier.ts`** (655 LOC combined). Both orphan. Investigate which (if either) is canonical before deleting both.

### Priority 2 — Strategic Decisions

7. **🔍 Investigate `src/lib/analysis-engine.ts`** (3,126 LOC orphan). This is the largest orphan file by far. It exports technical indicators (MACD, RSI, Bollinger, ATR, OBV, StochasticRSI). Two options:  
   - **Wire it up** to `TradingChartView.tsx` / `InteractiveChart.tsx` as the canonical indicator library (would replace inline calculations), OR  
   - **Delete it** if it's truly unused.  
   - Recommended: **wire it up** — re-implementing these indicators from scratch would be wasted effort.
8. **🔍 Investigate the entire `src/components/studio/` directory** (9 files, ~3,200 LOC). This is a React Flow–based visual node editor with orchestrator/data-source/engine/result nodes. Looks like a planned "engine builder" UI. Three options:  
   - **Finish and ship** it as a new admin feature, OR  
   - **Archive** to `scripts/_archived/` (similar to what was done with `CryptoRecommendationsView` and `CryptoAnalysisView` per page.tsx:184 comment), OR  
   - **Delete** if the feature was abandoned.
9. **🔍 Investigate the entire `src/components/devil/` UI family** (4 files, ~880 LOC). The lib support exists and IS active (devil-orchestrator, chain-reaction-engine, etc. imported by API routes), but the UI was never rendered. Either wire the UI into MarketAnalysisView as a new tab OR delete the UI side.
10. **🔍 Investigate 4 orphan MarketAnalysisView tabs**: `LiveTrackingTab.tsx`, `CryptoPredictionsTab.tsx`, `ExpertPredictionsTab.tsx`, `PredictionsTab.tsx` (~2,500 LOC combined). These look like complete tab implementations that were never added to the tabs array. Likely a 1-line fix in `MarketAnalysisView.tsx` to wire them in.

### Priority 3 — Orphan API routes

11. **Verify external invocation patterns for `/api/cron/*` (8 routes)**. Before deleting:  
    - Check `crontab.txt` (currently calls Python scripts directly, not HTTP)  
    - Check if uptime monitors (UptimeRobot, BetterStack, etc.) ping these endpoints  
    - Check if `vps-service/` has any cron wrappers  
    - If no external caller found: **delete** (they're dead code).
12. **🗑️ Delete `auto-refresh/*` (3 routes, ~240 LOC)** — feature is fully dead (all 3 routes orphan).
13. **🗑️ Delete `technical/*` (3 routes, ~350 LOC)** — Python technical-analysis starter/stopper. The lib counterpart (`technical-analysis.ts`) is also orphan. Entire feature appears dead.
14. **🗑️ Delete `scraper/*` (3 routes, ~400 LOC)** — admin scraper control panel never wired into UI.
15. **🗑️ Delete `metals-forex/*` (2 routes, ~190 LOC)** — entire feature appears dead.
16. **🗑️ Delete `test-db` + `test-simple`** — test endpoints should never ship to production.
17. **🔁 Consolidate `legal/privacy` + `legal/terms` API routes** — they duplicate the static `/legal/*` pages. Either delete the API version (likely correct — pages don't need an API) or document why both exist.
18. **🔍 Investigate `community/*` (3 orphan routes)** — community feature appears deprecated. Check `UserPublishingView.tsx` (active) to see if it covers community features, then delete the orphans.
19. **🔍 Investigate `mobile/*` orphans (13 of 48 routes)** — possibly deprecated mobile-app endpoints. Check mobile app store listings / API contract docs before deleting.

### Priority 4 — Code Cleanup

20. **🧹 Clean up `src/lib/egx-db.ts` tech debt hotspot**: 8 `// TODO:` stubs + 2 `@deprecated` markers in a single file. Either implement the stubs (currency/gold/analysis/tips APIs) or remove the function declarations entirely.
21. **🧹 Clean up `custom.db` references**: 4 `@deprecated` markers in 3 lib files reference the removed `custom.db`. Remove the deprecated functions and their JSDoc.
22. **🧹 Wire up `use-persona-results.ts` hook** (118 LOC orphan): the TODO at line 3 explicitly says "يجب إضافة import لهذا hook في المكونات المناسبة" ("should add import for this hook in appropriate components"). Either wire it up or delete it.
23. **🧹 Implement Google Play receipt verification** at `api/google-play/verify-receipt/route.ts` (2 TODOs at lines 55 + 147) — currently the endpoint doesn't actually verify receipts, which is a security risk if it's used for in-app purchases.
24. **🧹 Wire up `AiRecommendations.tsx` decision**: 2,209 LOC orphan. Either re-route it as a new view in `page.tsx` (e.g., `#ai-recommendations`) OR delete it. Don't leave it sitting in the codebase unused.
25. **🧹 Decide on `live-chart/index.tsx`** (281 LOC orphan admin page). Referenced only as `id: 'live-chart'` string in `PlatformGuide.tsx`. Either wire it into AdminView's tab array OR delete it.

### Priority 5 — Documentation / Future Audit Prep

26. **📋 Document the active render tree** in a single canonical place (perhaps `Documentation/02-SCREENS_AND_COMPONENTS.md`). The current `page.tsx` has 41+ dynamic imports + ~60 view cases — a diagram would help future maintainers understand the routing.
27. **📋 Add an ESLint rule for orphan imports**. A custom rule that flags `export` statements with zero importers would prevent future orphan accumulation.
28. **📋 Re-run this audit quarterly**. The codebase grew by ~670 API routes + 288 components in an unknown timeframe — without periodic audits, dead code accumulates fast.

## 9. Methodology

### 9.1 Scope

- **In scope**: every `.ts` / `.tsx` file under `src/components/`, `src/app/`, `src/lib/`, and `src/hooks/` (288 + 12 + 658 + 117 + 7 = **1,082 files**, **~288k LOC**).
- **Out of scope**: `src/__tests__/`, `src/instrumentation.ts`, `src/middleware.ts`, `src/types/`, `scripts/`, `vps-service/`, `prisma/`, `examples/`, `tests/`, `data_engine/`, `notebooks/`, `mini-services/`, `news-agent/`, `telegram-events/`, `data/`, `db/`, `content/`, `models/`, `public/`, `skills/`, `tool-results/`, `upload/`, `download/`, `backups/`, `.next/`, `node_modules/`.

### 9.2 Inventory Phase (Phase 1)

- Used `find src/{components,app,lib,hooks}` to enumerate every file.
- Used `wc -l` to capture LOC for each file.
- Used `head -3` + `grep -q use client` to detect Next.js directives.
- Used `grep -E '^export '` to capture exported symbols (first 3 per file).
- Used `grep -E '^import.*@'` to count `@/` imports per file.

### 9.3 Usage Analysis Phase (Phase 2)

- **Import index built with Python** (`/tmp/build_import_index4.py`): walks every `.ts/.tsx` file under `src/`, extracts every `from '...'` and `import('...')` source string, resolves relative `./X` and `../X` paths against the importing file's directory (using `os.path.normpath`), normalizes `@/`-prefixed paths, strips extensions, and handles `/index` resolution. Result: 2,598 unique (normalized_import_path, source_file) pairs written to `/tmp/imports_full3.tsv`.
- **Per-file usage check**: for each component file, normalized its path to `@/components/...` form, queried the import index for all importers, filtered out self-imports, and counted unique importers.
- **Status classification**:
  - ✅ **ACTIVE** — imported by ≥1 other file.
  - 🟡 **DYNAMIC** — only importer is `src/app/page.tsx` AND the import is via `dynamicImport(() => import('@/components/...'))`.
  - ⚠️ **ORPHAN** — 0 importers found anywhere in `src/`.
  - ❌ **DEAD** — file exists but is empty/placeholder/broken. (None found — every file has at least 1 export or import.)
  - 🔁 **DUPLICATE** — same functionality exists in another file (manually identified via semantic similarity).

### 9.4 API Route Audit Phase (Phase 3)

- Used `grep -oE 'export async function (GET|POST|PUT|DELETE|PATCH)'` to extract HTTP methods per route.
- For each route, derived the API path (e.g., `src/app/api/admin/foo/route.ts` → `/api/admin/foo`).
- For dynamic segments (`[param]`), used the prefix before `[` as the search key.
- Searched project root (excluding `src/app/api/`, `src/middleware.ts`) for any `.ts/.tsx/.js/.cjs/.mjs/.py` file containing the path string.
- 0 matches → ⚠️ **ORPHAN API**; ≥1 match → ✅ **ACTIVE API**.
- **Caveat**: This detects literal string references only. Dynamic string concatenation like `` fetch(`/api/${category}/${id}`) `` would not match — manual verification required for any route that the audit flags as orphan but appears important.

### 9.5 Lib Audit Phase (Phase 4)

- Same Python import index as Phase 2.
- Same ACTIVE/ORPHAN classification.

### 9.6 Discovery Phase (Phase 5)

- **Hidden gems**: manually curated from the orphan list — files that look complete and functional but aren't surfaced in UI.
- **Tech debt**: `rg 'TODO|FIXME|HACK|XXX|@deprecated'` across `src/` (ripgrep via Grep tool) — 10 files, ~20 markers.
- **Dead code**: derived from orphan list — files that look complete (have `export` statements, have non-trivial LOC) but are never imported.
- **Duplicates**: manually identified via (a) same-basename files in different directories, (b) semantic keyword grouping ("Chart", "Recommendation", "Prediction", "Analysis", etc.).
- **Heavy files**: sorted all files by LOC, took top 10 per layer + combined top 10.

### 9.7 Limitations

1. **External callers not detectable**: this audit only checks `src/` for callers. External scripts (uptime monitors, external cron, mobile apps, partner integrations) may invoke APIs that appear orphaned. The report flags these as ⚠️ ORPHAN but explicitly notes "verify against external callers before deletion".
2. **Dynamic string concatenation**: `` fetch(`/api/${x}/foo`) `` patterns are not detected by literal-string search. An API endpoint that's called via dynamic path construction may falsely appear orphan.
3. **Re-exports via barrel files**: my index does follow `export * from './X'` and `export { foo } from './X'` patterns (Python script captures both `from` and `import(...)`), so barrel files are handled correctly.
4. **CSS / SCSS / static assets**: not audited (would require separate tooling).
5. **Test files** (`src/__tests__/`): not audited (out of scope).
6. **Type-only imports** (`import type { Foo } from './X'`): captured by the Python regex (matches `from '...'` regardless of `type` keyword).

### 9.8 Reproducibility

All analysis scripts are in `/tmp/`:
- `/tmp/build_import_index4.py` — builds the import index (`/tmp/imports_full3.tsv`)
- `/tmp/usage_precise4.sh` — checks importers for a single file
- `/tmp/analyze_all2.sh` — runs usage check on all components
- `/tmp/analyze_lib2.sh` — runs usage check on all lib files
- `/tmp/analyze_api_v4.sh` — runs usage check on all API routes
- `/tmp/components_final2.tsv`, `/tmp/lib_final.tsv`, `/tmp/api_final4.tsv` — final analysis results

To re-run: `python3 /tmp/build_import_index4.py && /tmp/analyze_all2.sh && /tmp/analyze_lib2.sh && /tmp/analyze_api_v4.sh`

---

**End of report.** Total files audited: 1,075 (288 components + 12 app routes/pages + 658 API route handlers + 117 lib modules) plus 7 hooks. Total LOC audited: ~281,000 (148,563 components + 88,776 API + 43,704 lib + ~5,800 app non-API + 1,111 hooks). Orphan LOC identified: 42,948 (15%). Active LOC: ~238,000 (85%).