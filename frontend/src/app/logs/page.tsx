"use client";

import { LogsView } from "@/features/logs/logs-view";
import { useLogs } from "@/features/logs/use-logs";
import { useControllerCapabilities } from "@/hooks/controller-capabilities-store";

export default function LogsPage() {
  const { controllerKey } = useControllerCapabilities();
  return <LogsPageForController key={controllerKey} />;
}

function LogsPageForController() {
  const { capabilities, controllerKey } = useControllerCapabilities();
  const {
    sessions,
    filteredSessions,
    selectedSession,
    hasLogContent,
    filter,
    contentFilter,
    loading,
    loadingContent,
    autoScroll,
    autoRefresh,
    streamingAvailable,
    sidebarOpen,
    logRef,
    setFilter,
    setContentFilter,
    setAutoScroll,
    setAutoRefresh,
    setSidebarOpen,
    loadLogContent,
    deleteSession,
    downloadLog,
    renderLogs,
    handleSelectSession,
    formatDateTime,
  } = useLogs(capabilities.features.logs, controllerKey);

  return (
    <LogsView
      sessions={sessions}
      filteredSessions={filteredSessions}
      selectedSession={selectedSession}
      hasLogContent={hasLogContent}
      filter={filter}
      contentFilter={contentFilter}
      loading={loading}
      loadingContent={loadingContent}
      autoScroll={autoScroll}
      autoRefresh={autoRefresh}
      streamingAvailable={streamingAvailable}
      sidebarOpen={sidebarOpen}
      logRef={logRef}
      onFilterChange={setFilter}
      onContentFilterChange={setContentFilter}
      onAutoScrollChange={setAutoScroll}
      onAutoRefreshChange={setAutoRefresh}
      onSidebarToggle={setSidebarOpen}
      onLoadLogContent={loadLogContent}
      onDeleteSession={deleteSession}
      onDownloadLog={downloadLog}
      onRenderLogs={renderLogs}
      onSelectSession={handleSelectSession}
      formatDateTime={formatDateTime}
    />
  );
}
