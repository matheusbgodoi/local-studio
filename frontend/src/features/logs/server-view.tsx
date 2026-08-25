"use client";

import { useMemo, useState, type ReactNode } from "react";
import { RefreshCw } from "@/ui/icon-registry";
import { AppPage, Button, Checkbox, KeyValueRow, StatusPill, Tabs } from "@/ui";
import { useLogs } from "@/features/logs/use-logs";
import { useControllerCapabilities } from "@/hooks/controller-capabilities-store";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { displayNameForModel, useServedModels } from "@/hooks/served-models-store";
import type { RealtimeStatusSnapshot } from "@/hooks/realtime-status-types";
import { getStoredBackendUrl } from "@/lib/api/connection";
import { CensoredApiUrl } from "@/ui/api-url-censor";
import { OpenApiPanel } from "./openapi-panel";

type Tab = "logs" | "docs";
type BackendInfo = { installed: boolean; version: string | null };

export default function ServerPage() {
  return <ServerContent />;
}

export function ServerContent({ embedded = false }: { embedded?: boolean }) {
  const { capabilities, loading: capabilitiesLoading } = useControllerCapabilities();
  const logsCapability = capabilities.features.logs;
  const openapiCapability = capabilities.features.openapi;
  const logs = useLogs(logsCapability);
  const realtime = useRealtimeStatusStore();
  const { physicalModels } = useServedModels();
  const modelDisplayName = displayNameForModel(
    physicalModels,
    realtime.status?.process?.served_model_name,
  );
  const [tab, setTab] = useState<Tab>("logs");
  const tabs: { id: Tab; label: string }[] = [
    ...(logsCapability === "supported" ? [{ id: "logs" as const, label: "Server Logs" }] : []),
    ...(openapiCapability === "supported" ? [{ id: "docs" as const, label: "API Docs" }] : []),
  ];
  const activeTab = tabs.some((item) => item.id === tab) ? tab : (tabs[0]?.id ?? null);
  const backendUrl = useMemo(
    () => (getStoredBackendUrl() || "http://127.0.0.1:8080").replace(/\/+$/, ""),
    [],
  );
  const content = (
    <>
      <ServerHeader
        embedded={embedded}
        backendUrl={backendUrl}
        connected={realtime.connected}
        running={Boolean(realtime.status?.running)}
        loadingContent={activeTab === "logs" && logs.loadingContent}
        selectedSession={activeTab === "logs" ? logs.selectedSession : null}
        onRefresh={() =>
          logs.selectedSession ? logs.loadLogContent(logs.selectedSession) : undefined
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
        <ServerStatusAside
          realtime={realtime}
          modelDisplayName={modelDisplayName}
          backendUrl={backendUrl}
          tab={activeTab}
          setTab={setTab}
          tabs={tabs}
          logsCapability={logsCapability}
          logsLoading={logs.loading}
          logsError={logs.sessionsError}
          sessions={logs.filteredSessions}
          selectedSession={logs.selectedSession}
          onSelectSession={logs.handleSelectSession}
        />
        <ServerViewerPanel
          tab={activeTab}
          capabilitiesLoading={capabilitiesLoading}
          logsCapability={logsCapability}
          openapiCapability={openapiCapability}
          selectedSession={logs.selectedSession}
          loadingContent={logs.loadingContent}
          contentError={logs.contentError}
          streamError={logs.streamError}
          autoScroll={logs.autoScroll}
          setAutoScroll={logs.setAutoScroll}
          logRef={logs.logRef}
          hasLogContent={logs.hasLogContent}
          renderLogs={logs.renderLogs}
        />
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex min-h-[44rem] flex-col overflow-hidden rounded-xl border border-(--ui-border) bg-(--ui-surface)">
        {content}
      </div>
    );
  }

  return <AppPage className="flex h-full min-h-0 flex-col overflow-hidden">{content}</AppPage>;
}

function ServerHeader({
  embedded,
  backendUrl,
  connected,
  running,
  loadingContent,
  selectedSession,
  onRefresh,
}: {
  embedded: boolean;
  backendUrl: string;
  connected: boolean;
  running: boolean;
  loadingContent: boolean;
  selectedSession: string | null;
  onRefresh: () => void;
}) {
  return (
    <header className={`border-b border-(--border) ${embedded ? "px-4 py-3" : "px-5 py-4"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {embedded ? (
            <CensoredApiUrl className="block font-mono text-xs text-(--color-foreground-subtle)">
              {backendUrl}
            </CensoredApiUrl>
          ) : (
            <>
              <div className="text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--color-foreground-subtle)">
                Server
              </div>
              <h1 className="mt-1 text-[length:var(--fs-3xl)] font-semibold tracking-[-0.015em]">
                Controller
              </h1>
              <CensoredApiUrl className="mt-1 block font-mono text-xs text-(--color-foreground-subtle)">
                {backendUrl}
              </CensoredApiUrl>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={connected ? "good" : "danger"} variant="badge">
            {connected ? "controller online" : "controller offline"}
          </StatusPill>
          <StatusPill tone={running ? "good" : "default"} variant="badge">
            {running ? "inference serving" : "inference idle"}
          </StatusPill>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={!selectedSession}
            icon={<RefreshCw className={`h-3.5 w-3.5 ${loadingContent ? "animate-spin" : ""}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>
    </header>
  );
}

function ServerStatusAside({
  realtime,
  modelDisplayName,
  backendUrl,
  tab,
  setTab,
  tabs,
  logsCapability,
  logsLoading,
  logsError,
  sessions,
  selectedSession,
  onSelectSession,
}: {
  realtime: RealtimeStatusSnapshot;
  modelDisplayName: string | null;
  backendUrl: string;
  tab: Tab | null;
  setTab: (t: Tab) => void;
  tabs: { id: Tab; label: string }[];
  logsCapability: "supported" | "unsupported" | "unknown";
  logsLoading: boolean;
  logsError: string | null;
  sessions: ReturnType<typeof useLogs>["filteredSessions"];
  selectedSession: string | null;
  onSelectSession: (id: string) => void;
}) {
  return (
    <aside className="min-h-0 overflow-y-auto border-b border-(--border) lg:border-b-0 lg:border-r">
      <ConnectionGroup realtime={realtime} backendUrl={backendUrl} />
      <RuntimeGroup realtime={realtime} />
      <BackendsGroup realtime={realtime} />
      <ProcessGroup realtime={realtime} modelDisplayName={modelDisplayName} />
      <ServicesGroup realtime={realtime} />
      {tabs.length > 0 && tab ? (
        <div className="border-t border-(--border) px-4 py-3">
          <Tabs variant="pill" items={tabs} activeTab={tab} onSelectTab={setTab} />
        </div>
      ) : null}
      {logsCapability === "supported" ? (
        <SessionList
          sessions={sessions}
          selectedSession={selectedSession}
          loading={logsLoading}
          error={logsError}
          onSelect={onSelectSession}
          onActivate={() => setTab("logs")}
        />
      ) : null}
    </aside>
  );
}

function ConnectionGroup({
  realtime,
  backendUrl,
}: {
  realtime: RealtimeStatusSnapshot;
  backendUrl: string;
}) {
  return (
    <StatusGroup title="Connection">
      <KeyValueRow
        label="URL"
        value={<CensoredApiUrl className="font-mono">{backendUrl}</CensoredApiUrl>}
      />
      <KeyValueRow label="Reachable" value={realtime.connected ? "yes" : "no"} />
      <KeyValueRow label="Inference port" value={realtime.status?.inference_port ?? "—"} />
      {realtime.lease?.holder ? <KeyValueRow label="Lease" value={realtime.lease.holder} /> : null}
    </StatusGroup>
  );
}

function RuntimeGroup({ realtime }: { realtime: RealtimeStatusSnapshot }) {
  const summary = realtime.runtimeSummary;
  return (
    <StatusGroup title="Runtime">
      <KeyValueRow
        label="Platform"
        value={
          summary
            ? `${summary.platform.kind} (${summary.platform.vendor ?? "—"})`
            : (realtime.platformKind ?? "—")
        }
      />
      <KeyValueRow
        label="GPU monitoring"
        value={
          summary
            ? `${summary.gpu_monitoring.available ? "available" : "unavailable"} · ${summary.gpu_monitoring.tool}`
            : "—"
        }
      />
      <KeyValueRow label="GPUs detected" value={realtime.gpus.length || "—"} />
    </StatusGroup>
  );
}

function BackendsGroup({ realtime }: { realtime: RealtimeStatusSnapshot }) {
  const backends = deriveBackends(realtime.runtimeSummary);
  return (
    <StatusGroup title="Backends">
      {backends.length > 0 ? (
        backends.map(([name, info]) => <BackendRow key={name} name={name} info={info} />)
      ) : (
        <div className="text-[length:var(--fs-sm)] text-(--color-foreground-subtlest)">
          {realtime.statusLoading ? "Detecting…" : "Not reported by this controller."}
        </div>
      )}
    </StatusGroup>
  );
}

function ProcessGroup({
  realtime,
  modelDisplayName,
}: {
  realtime: RealtimeStatusSnapshot;
  modelDisplayName: string | null;
}) {
  const process = realtime.status?.process ?? null;
  return (
    <StatusGroup title="Active process">
      {process ? (
        <>
          <KeyValueRow label="Backend" value={process.backend ?? "—"} />
          <KeyValueRow label="PID" value={process.pid ?? "—"} />
          <KeyValueRow label="Model" value={modelDisplayName ?? "Model identity unavailable"} />
          <KeyValueRow label="Port" value={process.port ?? "—"} />
        </>
      ) : (
        <div className="text-[length:var(--fs-sm)] text-(--color-foreground-subtlest)">
          No model loaded.
        </div>
      )}
    </StatusGroup>
  );
}

function ServicesGroup({ realtime }: { realtime: RealtimeStatusSnapshot }) {
  if (realtime.services.length === 0) return null;
  return (
    <StatusGroup title="Services">
      {realtime.services.map((svc) => (
        <div
          key={svc.id}
          className="flex items-center justify-between py-0.5 text-[length:var(--fs-sm)]"
        >
          <span className="min-w-0 truncate text-(--color-foreground-subtle)">{svc.id}</span>
          <span className={`shrink-0 font-mono ${serviceToneClass(svc.status, svc.last_error)}`}>
            {svc.status}
          </span>
        </div>
      ))}
    </StatusGroup>
  );
}

function BackendRow({ name, info }: { name: string; info: BackendInfo }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[length:var(--fs-sm)]">
      <span className="font-mono text-(--color-foreground-subtle)">{name}</span>
      {info.installed ? (
        <span className="font-mono text-(--color-success)">{info.version ?? "installed"}</span>
      ) : (
        <span className="text-(--color-foreground-subtlest)">not installed</span>
      )}
    </div>
  );
}

function SessionList({
  sessions,
  selectedSession,
  loading,
  error,
  onSelect,
  onActivate,
}: {
  sessions: ReturnType<typeof useLogs>["filteredSessions"];
  selectedSession: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onActivate: () => void;
}) {
  return (
    <div className="max-h-[34vh] overflow-y-auto px-2 pb-3">
      {loading ? (
        <LogListMessage>Checking log sources…</LogListMessage>
      ) : error ? (
        <LogListMessage tone="danger">Logs could not be loaded: {error}</LogListMessage>
      ) : sessions.length === 0 ? (
        <LogListMessage>No log sources reported.</LogListMessage>
      ) : null}
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          onClick={() => {
            onActivate();
            onSelect(session.id);
          }}
          className={`mb-1 block w-full truncate rounded px-2 py-1.5 text-left text-[length:var(--fs-sm)] ${
            selectedSession === session.id
              ? "bg-(--color-surface) text-(--fg)"
              : "text-(--color-foreground-subtle) hover:bg-(--hover) hover:text-(--fg)"
          }`}
          title={session.id}
        >
          {session.recipe_name || session.model || session.id}
        </button>
      ))}
    </div>
  );
}

function LogListMessage({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className={`px-2 py-2 text-[length:var(--fs-sm)] ${
        tone === "danger" ? "text-(--color-destructive)" : "text-(--color-foreground-subtlest)"
      }`}
    >
      {children}
    </div>
  );
}

function ServerViewerPanel(props: {
  tab: Tab | null;
  capabilitiesLoading: boolean;
  logsCapability: "supported" | "unsupported" | "unknown";
  openapiCapability: "supported" | "unsupported" | "unknown";
  selectedSession: string | null;
  loadingContent: boolean;
  contentError: string | null;
  streamError: string | null;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  logRef: React.RefObject<HTMLDivElement | null>;
  hasLogContent: boolean;
  renderLogs: () => ReactNode;
}) {
  if (props.tab === "logs") return <LogsPanel {...props} />;
  if (props.tab === "docs") return <DocsPanel />;
  const checking =
    props.capabilitiesLoading ||
    props.logsCapability === "unknown" ||
    props.openapiCapability === "unknown";
  return (
    <UnavailablePanel>
      {checking
        ? "Checking which diagnostics this controller exposes…"
        : "This controller does not expose server logs or an API reference."}
    </UnavailablePanel>
  );
}

function LogsPanel({
  selectedSession,
  loadingContent,
  contentError,
  streamError,
  autoScroll,
  setAutoScroll,
  logRef,
  hasLogContent,
  renderLogs,
}: {
  selectedSession: string | null;
  loadingContent: boolean;
  contentError: string | null;
  streamError: string | null;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  logRef: React.RefObject<HTMLDivElement | null>;
  hasLogContent: boolean;
  renderLogs: () => ReactNode;
}) {
  return (
    <div className="min-h-0 p-4">
      <section className="flex h-full min-h-[32rem] flex-col overflow-hidden rounded-lg border border-(--color-card-border) bg-(--color-card)">
        <div className="flex min-h-10 items-center justify-between border-b border-(--color-card-border) px-3">
          <div className="truncate font-mono text-xs text-(--color-foreground-subtle)">
            {selectedSession ?? "select a log stream"}
          </div>
          <Checkbox
            checked={autoScroll}
            onChange={setAutoScroll}
            label="auto-scroll"
            className="items-center text-[length:var(--fs-sm)]"
            labelClassName="text-[length:var(--fs-sm)] font-normal"
          />
        </div>
        <div
          ref={logRef}
          className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[length:var(--fs-sm)] leading-5 text-(--fg)"
        >
          <LogContent
            selectedSession={selectedSession}
            loadingContent={loadingContent}
            contentError={contentError}
            streamError={streamError}
            hasLogContent={hasLogContent}
            renderLogs={renderLogs}
          />
        </div>
      </section>
    </div>
  );
}

function LogContent({
  selectedSession,
  loadingContent,
  contentError,
  streamError,
  hasLogContent,
  renderLogs,
}: {
  selectedSession: string | null;
  loadingContent: boolean;
  contentError: string | null;
  streamError: string | null;
  hasLogContent: boolean;
  renderLogs: () => ReactNode;
}) {
  if (loadingContent) return <div className="text-(--color-foreground-subtle)">Loading logs…</div>;
  if (contentError) {
    return (
      <div className="text-(--color-destructive)">Logs could not be loaded: {contentError}</div>
    );
  }
  if (!selectedSession) {
    return <div className="text-(--color-foreground-subtle)">Select a log source.</div>;
  }
  return (
    <>
      {streamError ? (
        <div className="mb-2 text-(--color-destructive)">
          Live updates are unavailable: {streamError}
        </div>
      ) : null}
      {hasLogContent ? (
        renderLogs()
      ) : (
        <div className="text-(--color-foreground-subtle)">This source has no log lines.</div>
      )}
    </>
  );
}

function UnavailablePanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 items-center justify-center p-8 text-center text-[length:var(--fs-sm)] text-(--color-foreground-subtle)">
      {children}
    </div>
  );
}

function DocsPanel() {
  return (
    <div className="min-h-0 p-4">
      <section className="flex h-full min-h-[32rem] flex-col overflow-hidden rounded-lg border border-(--color-card-border) bg-(--color-card)">
        <div className="flex min-h-10 items-center border-b border-(--color-card-border) px-3 text-xs">
          <span className="text-(--color-foreground-subtle)">OpenAPI reference</span>
        </div>
        <OpenApiPanel />
      </section>
    </div>
  );
}

function StatusGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-(--border) px-4 py-3">
      <div className="mb-2 text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.16em] text-(--color-foreground-subtlest)">
        {title}
      </div>
      <dl className="space-y-1 text-[length:var(--fs-sm)]">{children}</dl>
    </div>
  );
}

function deriveBackends(
  summary: RealtimeStatusSnapshot["runtimeSummary"],
): [string, BackendInfo][] {
  if (!summary) return [];
  const entries: ([string, BackendInfo] | null)[] = [
    ["vllm", summary.backends.vllm],
    ["sglang", summary.backends.sglang],
    ["llamacpp", summary.backends.llamacpp],
    summary.backends.mlx ? ["mlx", summary.backends.mlx] : null,
  ];
  return entries.filter((e): e is [string, BackendInfo] => e !== null);
}

function serviceToneClass(status: string, lastError?: string | null): string {
  if (status === "ok" || status === "healthy") return "text-(--color-success)";
  if (status === "error" || lastError) return "text-(--color-destructive)";
  return "text-(--color-foreground-subtle)";
}
