// src/modules/admin/index.ts
// Public API for the admin module.

export { AdminView } from './components/AdminView';
export type { SystemIssue } from './components/AdminView';
export { BacktestTab } from './components/BacktestTab';
export { CryptoAdminPanel } from './components/CryptoAdminPanel';
export { CryptoPredictionGenerator } from './components/CryptoPredictionGenerator';
export { DataEngineTab } from './components/DataEngineTab';
export { DataScraperControl } from './components/DataScraperControl';
export { DatabaseManagerFull } from './components/DatabaseManagerFull';
export { DbBackupPanel } from './components/DbBackupPanel';
export { EngineSettingsTab } from './components/EngineSettingsTab';
export { EnginesStatusTab } from './components/EnginesStatusTab';
export { ForexTab } from './components/ForexTab';
export { GoldSilverTab } from './components/GoldSilverTab';
export { HumanRecommendationsAdmin } from './components/HumanRecommendationsAdmin';
export { MultiMarketTab } from './components/MultiMarketTab';
export { NewsManagementTab } from './components/NewsManagementTab';
export { NotebookAdminTab } from './components/NotebookAdminTab';
export { OptimizerParamsPanel } from './components/OptimizerParamsPanel';
export { PromoCodesAdmin } from './components/PromoCodesAdmin';
export { PurgeCacheButton } from './components/PurgeCacheButton';
export { RegimeDetectionWidget } from './components/RegimeDetectionWidget';
export { RowEditorModal } from './components/RowEditorModal';
export { SectorClassificationAdmin } from './components/SectorClassificationAdmin';
export { SuperLearningSystem } from './components/SuperLearningSystem';
export { SystemControlPanel } from './components/SystemControlPanel';
export { SystemMonitorPanel } from './components/SystemMonitorPanel';
export { SystemProblemsTab } from './components/SystemProblemsTab';
export {
  SystemTopologyGraph,
  getStatusColor,
} from './components/SystemTopologyGraph';
export { SystemTopologyTab } from './components/SystemTopologyTab';
export { TelegramTab } from './components/TelegramTab';
export { UserManagementPanel } from './components/UserManagementPanel';
export { UsersManagement } from './components/UsersManagement';
export { WealthCharts } from './components/WealthCharts';

// live-chart sub-module
export {
  STATUS_STYLES,
  getStatusStyle,
  formatLiveSeconds,
  formatLiveClock,
  LiveDot,
  useLivePolling,
  LiveStatusBar,
  AnimatedEdge,
} from './components/live-chart';

// platform-performance sub-module
export { PlatformPerformanceView } from './components/platform-performance/PlatformPerformanceView';
