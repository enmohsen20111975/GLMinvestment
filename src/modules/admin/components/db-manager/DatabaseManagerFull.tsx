'use client';

/**
 * db-manager/DatabaseManagerFull.tsx
 * =====================================
 * Container component for the Database Manager split.
 *
 * Owns NO state directly — everything is delegated to `useDbManagerActions`
 * hook (which in turn delegates data fetching to `useDatabaseManagerData`).
 * This file is just the layout JSX that wires the sub-components together.
 *
 * Layout:
 *  - HeaderBar (top): DB count, integrity summary, bulk ops, search
 *  - Warning + error banners
 *  - Grid (lg:4 cols): sidebar (1) + tabs (3)
 *    - Tabs: Overview / Tables / SQL / Backups / Daily / Maintenance
 *    - Maintenance tab also embeds RecoveryToolsPanel (recovery + advanced ops)
 *  - ConfirmDialog (global)
 *  - Custom scrollbar styles
 */

import { useCallback } from 'react';
import {
  Database as DatabaseIcon,
  Table as TableIcon,
  Play,
  Info,
  History,
  Activity,
  DatabaseBackup,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { useDbManagerActions } from './useDbManagerActions';
import { HeaderBar } from './HeaderBar';
import { DbSidebar } from './DbSidebar';
import { OverviewPanel } from './OverviewPanel';
import { TablesPanel } from './TablesPanel';
import { SqlConsolePanel } from './SqlConsolePanel';
import { BackupsPanel } from './BackupsPanel';
import { DailyBackupsPanel } from './DailyBackupsPanel';
import { MaintenancePanel } from './MaintenancePanel';
import { RecoveryToolsPanel } from './RecoveryToolsPanel';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './SharedComponents';
import type { TabKey } from './types';

export function DatabaseManagerFull() {
  const a = useDbManagerActions();

  const handlePageChange = useCallback(
    (p: number) => {
      if (a.selectedDb && a.selectedTable) a.setPage(p);
    },
    [a.selectedDb, a.selectedTable, a.setPage]
  );

  return (
    <>
      <div className="space-y-4" dir="rtl">
        {/* Header bar (DB count, integrity summary, bulk ops, search) */}
        <HeaderBar
          databaseCount={a.databases.length}
          totalSizeBytes={a.totalSizeBytes}
          integritySummary={a.integritySummary}
          walDbCount={a.walDbCount}
          dbsLoading={a.dbsLoading}
          search={a.search}
          onSearchChange={a.setSearch}
          onRefresh={a.handleRefreshDbs}
          bulkLoading={a.bulkLoading}
          importFile={a.importFile}
          importResult={a.importResult}
          onImportFileChange={(f) => {
            a.setImportFile(f);
            a.setImportResult(null);
          }}
          onCheckpointAll={a.handleCheckpointAll}
          onExportAll={a.handleExportAll}
          onImportAll={a.handleImportAll}
        />

        {/* Warning banner */}
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>تنبيه: أدوات إدارية متقدمة</AlertTitle>
          <AlertDescription>
            هذه الأدوات تتعامل مباشرة مع قواعد بيانات الإنتاج. العمليات المدمرة (DROP / TRUNCATE / VACUUM / استعادة) تتطلب تأكيداً صريحاً. يُنصح بعمل نسخة احتياطية قبل أي تعديل.
          </AlertDescription>
        </Alert>

        {a.dbsError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>خطأ</AlertTitle>
            <AlertDescription>{a.dbsError}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Sidebar: DB list */}
          <div className="lg:col-span-1">
            <DbSidebar
              databases={a.databases}
              filteredDatabases={a.filteredDatabases}
              loading={a.dbsLoading}
              selectedDb={a.selectedDb}
              onSelectDb={a.handleSelectDb}
            />
          </div>

          {/* Main area: tabs */}
          <div className="lg:col-span-3">
            <Tabs value={a.activeTab} onValueChange={(v) => a.setActiveTab(v as TabKey)}>
              <TabsList className="grid grid-cols-6 w-full">
                <TabsTrigger value="overview">
                  <Info className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">نظرة عامة</span>
                </TabsTrigger>
                <TabsTrigger value="tables">
                  <TableIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">الجداول</span>
                </TabsTrigger>
                <TabsTrigger value="sql">
                  <Play className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">SQL</span>
                </TabsTrigger>
                <TabsTrigger value="backups">
                  <DatabaseBackup className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">النسخ</span>
                </TabsTrigger>
                <TabsTrigger value="daily">
                  <History className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">اليومية</span>
                </TabsTrigger>
                <TabsTrigger value="maintenance">
                  <Activity className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">الصيانة</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                {a.selectedOverview ? (
                  <OverviewPanel overview={a.selectedOverview} onBackup={a.handleBackup} />
                ) : (
                  <EmptyState icon={DatabaseIcon} text="اختر قاعدة بيانات من اليمين" />
                )}
              </TabsContent>

              <TabsContent value="tables">
                {a.selectedDb ? (
                  <TablesPanel
                    dbName={a.selectedDb}
                    tables={a.tables}
                    tablesLoading={a.tablesLoading}
                    tablesError={a.tablesError}
                    selectedTable={a.selectedTable}
                    onSelectTable={a.handleSelectTable}
                    tableRows={a.tableRows}
                    rowsLoading={a.rowsLoading}
                    rowsError={a.rowsError}
                    page={a.page}
                    sortBy={a.sortBy}
                    sortDir={a.sortDir}
                    onSort={a.handleSort}
                    onPageChange={handlePageChange}
                    onExport={a.handleExportTable}
                    onDropTable={a.handleDropTable}
                    onTruncateTable={a.handleTruncateTable}
                    onViewSchema={(t) => a.selectedDb && a.fetchSchema(a.selectedDb, t)}
                    schema={a.schema}
                    schemaOpen={a.schemaOpen}
                    onSchemaClose={() => a.setSchemaOpen(false)}
                    onRetry={() => a.selectedDb && a.refetchTables()}
                  />
                ) : (
                  <EmptyState icon={TableIcon} text="اختر قاعدة بيانات أولاً" />
                )}
              </TabsContent>

              <TabsContent value="sql">
                {a.selectedDb ? (
                  <SqlConsolePanel
                    dbName={a.selectedDb}
                    sql={a.sql}
                    setSql={a.setSql}
                    dryRun={a.dryRun}
                    setDryRun={a.setDryRun}
                    onRun={a.handleRunSql}
                    onClear={a.handleClearSql}
                    loading={a.queryLoading}
                    result={a.queryResult}
                    error={a.queryError}
                    history={a.history}
                    onHistoryClick={(s) => a.setSql(s)}
                    onClearHistory={a.handleClearHistory}
                  />
                ) : (
                  <EmptyState icon={Play} text="اختر قاعدة بيانات أولاً" />
                )}
              </TabsContent>

              <TabsContent value="backups">
                {a.selectedDb ? (
                  <BackupsPanel
                    dbName={a.selectedDb}
                    backups={a.backups}
                    loading={a.backupsLoading}
                    error={a.backupsError}
                    onBackup={a.handleBackup}
                    onRestore={a.handleRestore}
                    onDelete={a.handleDeleteBackup}
                    onRefresh={a.fetchBackups}
                  />
                ) : (
                  <EmptyState icon={DatabaseBackup} text="اختر قاعدة بيانات أولاً" />
                )}
              </TabsContent>

              <TabsContent value="daily">
                <DailyBackupsPanel
                  backups={a.dailyBackups}
                  loading={a.dailyLoading}
                  error={a.dailyError}
                  restoreResult={a.dailyRestoreResult}
                  onRestore={a.handleRestoreDaily}
                  onDelete={a.handleDeleteDaily}
                  onRefresh={a.fetchDailyBackups}
                />
              </TabsContent>

              <TabsContent value="maintenance" className="space-y-4">
                {a.selectedDb && (
                  <MaintenancePanel
                    dbName={a.selectedDb}
                    loading={a.maintenanceLoading}
                    result={a.maintenanceResult}
                    onVacuum={() =>
                      a.handleMaintenance(
                        'VACUUM',
                        'VACUUM',
                        <p className="text-sm">
                          سيتم إعادة بناء ملف <strong>{a.selectedDb}</strong> لاستعادة المساحة غير المستخدمة.
                          قد يستغرق وقتاً طويلاً للقواعد الكبيرة. سيتم قفل القاعدة أثناء العملية.
                        </p>
                      )
                    }
                    onIntegrity={() =>
                      a.handleMaintenance(
                        'INTEGRITY_CHECK',
                        'فحص السلامة',
                        <p className="text-sm">
                          سيتم تنفيذ <code>PRAGMA integrity_check</code> على <strong>{a.selectedDb}</strong> للتأكد من سلامة بنية البيانات. عملية للقراءة فقط وآمنة.
                        </p>
                      )
                    }
                    onWalCheckpoint={() =>
                      a.handleMaintenance(
                        'WAL_CHECKPOINT',
                        'WAL Checkpoint',
                        <p className="text-sm">
                          سيتم دمج محتوى ملف الـ WAL (-wal) في الملف الرئيسي <strong>{a.selectedDb}</strong> ثم اقتطاع ملف WAL. مفيد لتحرير مساحة.
                        </p>
                      )
                    }
                    onReindex={() =>
                      a.handleMaintenance(
                        'REINDEX',
                        'REINDEX',
                        <p className="text-sm">
                          سيتم إعادة بناء جميع الفهارس في <strong>{a.selectedDb}</strong>. مفيد بعد عمليات حذف كبيرة.
                        </p>
                      )
                    }
                  />
                )}

                {/* Recovery + Advanced tools — always visible in maintenance tab */}
                <RecoveryToolsPanel
                  selectedDb={a.selectedDb}
                  selectedOverview={a.selectedOverview}
                  recoverLoading={a.recoverLoading}
                  recoverResult={a.recoverResult}
                  advancedLoading={a.advancedLoading}
                  advancedOutput={a.advancedOutput}
                  onRecoverDb={a.handleRecoverDb}
                  onRecoverAll={a.handleRecoverAll}
                  onAdvancedOperation={a.handleAdvancedOperation}
                />

                {!a.selectedDb && !a.advancedOutput && (
                  <EmptyState icon={Activity} text="اختر قاعدة بيانات من القائمة الجانبية لعرض عمليات الصيانة الهيكلية" />
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Global confirmation dialog */}
        <ConfirmDialog
          confirm={a.confirm}
          busy={a.confirmBusy}
          onClose={() => a.setConfirm(null)}
          onConfirm={a.handleConfirmAction}
        />

        {/* Custom scrollbar + RTL helpers */}
        <style jsx global>{`
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: hsl(var(--muted-foreground) / 0.3);
            border-radius: 3px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: hsl(var(--muted-foreground) / 0.5);
          }
        `}</style>
      </div>
    </>
  );
}

export default DatabaseManagerFull;
