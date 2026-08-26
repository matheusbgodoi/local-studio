import { Stat, StatusPill } from "@/ui";
import {
  SettingsFactRows,
  SettingsGroup,
  type SettingsFactRow,
  type StatusTone,
} from "./settings-ui";
import type { ApiConnectionSettings } from "./types";
import type { CompatibilityCheck, CompatibilityReport, ConfigData, ServiceInfo } from "@/lib/types";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import type { CapabilityState } from "@local-studio/contracts/capabilities";

export function ServicesSettings({
  data,
  apiSettings,
  loading,
  error,
}: {
  data: ConfigData | null;
  apiSettings: ApiConnectionSettings;
  loading: boolean;
  error: string | null;
}) {
  const services = data?.services ?? [];
  const tone = services.length ? "good" : error ? "warning" : "info";

  return (
    <SettingsGroup
      title="Services & endpoints"
      description="Controller, inference, and desktop endpoints used by this installation."
      actions={
        <StatusPill tone={tone}>
          {services.length ? `${services.length} live` : loading ? "checking" : "unavailable"}
        </StatusPill>
      }
      collapsible
      defaultOpen={false}
    >
      <SettingsFactRows
        rows={[...services.map(serviceFactRow), ...endpointFactRows(data, apiSettings)]}
      />
    </SettingsGroup>
  );
}

export function SystemOverview({
  data,
  compatibilityReport,
  loading,
  error,
  configCapability,
  compatibilityCapability,
}: {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
  loading: boolean;
  error: string | null;
  configCapability: CapabilityState;
  compatibilityCapability: CapabilityState;
}) {
  const realtime = useRealtimeStatusStore();
  const supportedData = configCapability === "supported" ? data : null;
  const runtime = supportedData?.runtime;
  const checks = compatibilityReport?.checks ?? [];
  const actionableChecks = checks.filter((check) => check.severity !== "info");
  const controllerState = controllerSnapshotState(
    realtime.connected,
    Boolean(supportedData),
    loading,
  );
  const controllerTone = controllerSnapshotTone(
    realtime.connected,
    Boolean(supportedData),
    Boolean(error),
  );
  const platform =
    runtime?.platform.kind ??
    realtime.runtimeSummary?.platform.kind ??
    realtime.platformKind ??
    platformFromGpus(realtime.gpus.map((gpu) => gpu.name));
  const gpuCount = runtime?.gpus.count ?? (realtime.gpus.length ? realtime.gpus.length : null);
  const compatibilityState = compatibilitySnapshotState(
    compatibilityReport,
    actionableChecks.length,
    loading,
  );
  const showCompatibility = compatibilityCapability === "supported";

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-start justify-between gap-4 px-1">
        <div>
          <h3 className="text-[length:var(--fs-lg)] font-medium tracking-[-0.01em] text-(--ui-fg)">
            System snapshot
          </h3>
          <p className="mt-1 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
            Live controller state at a glance. Expand a section only when you need to act.
          </p>
        </div>
        <StatusPill tone={controllerTone}>{controllerState.toLowerCase()}</StatusPill>
      </div>
      <dl className="grid grid-cols-2 border-y border-(--ui-separator) py-4 sm:grid-cols-4">
        <Stat label="Controller" value={controllerState} />
        {platform ? <Stat label="Platform" value={platform} /> : null}
        {gpuCount !== null ? <Stat label="GPUs" value={gpuCount} /> : null}
        {showCompatibility ? <Stat label="Compatibility" value={compatibilityState} /> : null}
      </dl>
      {error ? (
        <p className="mt-2 px-1 text-[length:var(--fs-sm)] text-(--ui-warning)">{error}</p>
      ) : null}
    </section>
  );
}

export function SystemDetails({
  data,
  compatibilityReport,
  configCapability,
  compatibilityCapability,
}: {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
  configCapability: CapabilityState;
  compatibilityCapability: CapabilityState;
}) {
  const realtime = useRealtimeStatusStore();
  const supportedData = configCapability === "supported" ? data : null;
  const machineRows = machineFactRows(supportedData, realtime, configCapability);
  return (
    <div>
      {machineRows.length ? (
        <SettingsGroup
          title="Machine details"
          description="Ports, paths, platform versions, and GPU inventory reported by the controller."
          collapsible
          defaultOpen={false}
        >
          <SettingsFactRows rows={machineRows} />
        </SettingsGroup>
      ) : null}
      {compatibilityCapability === "supported" && compatibilityReport ? (
        <CompatibilitySettings checks={compatibilityReport.checks} />
      ) : null}
    </div>
  );
}

function CompatibilitySettings({ checks }: { checks: CompatibilityCheck[] }) {
  const ordered = [...checks].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const actionableChecks = ordered.filter((check) => check.severity !== "info");
  const tone: StatusTone = actionableChecks.length ? "warning" : "good";

  return (
    <SettingsGroup
      title="Compatibility"
      description="Diagnostics and suggested fixes from the controller probe."
      actions={<StatusPill tone={tone}>{actionableChecks.length ? "review" : "clear"}</StatusPill>}
      collapsible
      defaultOpen={actionableChecks.length > 0}
    >
      {ordered.length === 0 ? (
        <SettingsFactRows rows={[{ label: "Report", value: "No issues detected" }]} />
      ) : (
        <SettingsFactRows rows={ordered.map(compatibilityFactRow)} />
      )}
    </SettingsGroup>
  );
}

function endpointFactRows(
  data: ConfigData | null,
  apiSettings: ApiConnectionSettings,
): SettingsFactRow[] {
  const rows: SettingsFactRow[] = [
    {
      label: "Controller URL",
      value: data?.environment.controller_url ?? apiSettings.backendUrl,
      mono: true,
      status: { label: data ? "live" : "saved", tone: data ? "good" : "info" },
    },
  ];
  if (data?.environment.inference_url) {
    rows.push({ label: "Inference URL", value: data.environment.inference_url, mono: true });
  }
  if (data?.environment.frontend_url) {
    rows.push({ label: "Frontend URL", value: data.environment.frontend_url, mono: true });
  }
  return rows;
}

function machineFactRows(
  data: ConfigData | null,
  realtime: ReturnType<typeof useRealtimeStatusStore>,
  configCapability: CapabilityState,
): SettingsFactRow[] {
  return [
    ...(configCapability === "supported" ? networkFactRows(data) : []),
    ...(configCapability === "supported" ? storageFactRows(data) : []),
    ...runtimeFactRows(data, realtime),
  ];
}

function networkFactRows(data: ConfigData | null): SettingsFactRow[] {
  const config = data?.config;

  if (!config) return [];
  const rows: SettingsFactRow[] = [];
  if (config.host) rows.push({ label: "Host", value: config.host, mono: true });
  if (config.port !== undefined) {
    rows.push({ label: "Controller port", value: config.port, mono: true });
  }
  if (config.inference_port !== undefined) {
    rows.push({ label: "Inference port", value: config.inference_port, mono: true });
  }
  return rows;
}

function storageFactRows(data: ConfigData | null): SettingsFactRow[] {
  const config = data?.config;

  if (!config) return [];
  const rows: SettingsFactRow[] = [];
  if (config.models_dir) {
    rows.push({
      label: "Models directory",
      value: config.models_dir,
      mono: true,
      truncate: true,
    });
  }
  if (config.data_dir) {
    rows.push({
      label: "Data directory",
      value: config.data_dir,
      mono: true,
      truncate: true,
    });
  }
  if (config.db_path) {
    rows.push({
      label: "Database",
      value: config.db_path,
      mono: true,
      truncate: true,
    });
  }
  return rows;
}

function runtimeFactRows(
  data: ConfigData | null,
  realtime: ReturnType<typeof useRealtimeStatusStore>,
): SettingsFactRow[] {
  const runtime = data?.runtime;
  const gpuCount = runtime?.gpus.count ?? (realtime.gpus.length ? realtime.gpus.length : undefined);
  const gpuNames = [...new Set(realtime.gpus.map((gpu) => gpu.name).filter(Boolean))];
  const platform =
    runtime?.platform.kind ??
    realtime.runtimeSummary?.platform.kind ??
    realtime.platformKind ??
    platformFromGpus(gpuNames);

  return [
    ...runtimePlatformRows(platform),
    ...runtimeGpuRows(runtime?.gpus.types ?? [], gpuNames, gpuCount),
    ...runtimeDriverRows(runtime),
  ];
}

function runtimePlatformRows(platform: string | null | undefined): SettingsFactRow[] {
  return platform ? [{ label: "Platform", value: platform }] : [];
}

function runtimeGpuRows(
  reportedTypes: string[],
  realtimeTypes: string[],
  gpuCount: number | undefined,
): SettingsFactRow[] {
  const rows: SettingsFactRow[] = [];
  if (reportedTypes.length || realtimeTypes.length) {
    rows.push({
      label: "GPU types",
      value: (reportedTypes.length ? reportedTypes : realtimeTypes).join(", "),
      truncate: true,
    });
  }
  if (gpuCount !== undefined) {
    rows.push({
      label: "GPU count",
      value: gpuCount,
      mono: true,
      status: {
        label: gpuCount ? "detected" : "none reported",
        tone: gpuCount ? ("good" as const) : ("default" as const),
      },
    });
  }
  return rows;
}

function runtimeDriverRows(runtime: ConfigData["runtime"] | undefined): SettingsFactRow[] {
  const rows: SettingsFactRow[] = [];
  if (runtime?.cuda.driver_version) {
    rows.push({ label: "CUDA driver", value: runtime.cuda.driver_version, mono: true });
  }
  if (runtime?.cuda.cuda_version) {
    rows.push({ label: "CUDA runtime", value: runtime.cuda.cuda_version, mono: true });
  }
  if (runtime?.platform.rocm?.rocm_version) {
    rows.push({ label: "ROCm", value: runtime.platform.rocm.rocm_version, mono: true });
  }
  return rows;
}

function controllerSnapshotState(connected: boolean, synced: boolean, loading: boolean): string {
  if (connected) return "Online";
  if (synced) return "Synced";
  return loading ? "Checking" : "Unavailable";
}

function controllerSnapshotTone(
  connected: boolean,
  synced: boolean,
  hasError: boolean,
): StatusTone {
  if (connected || synced) return "good";
  return hasError ? "warning" : "info";
}

function compatibilitySnapshotState(
  report: CompatibilityReport | null,
  issueCount: number,
  loading: boolean,
): string {
  if (!report) return loading ? "Checking" : "Unavailable";
  if (!issueCount) return "Clear";
  return `${issueCount} issue${issueCount === 1 ? "" : "s"}`;
}

function platformFromGpus(names: readonly string[]): string | null {
  const joined = names.join(" ").toLowerCase();
  if (joined.includes("nvidia")) return "cuda";
  if (joined.includes("amd") || joined.includes("radeon")) return "rocm";
  if (joined.includes("apple")) return "metal";
  return null;
}

function serviceFactRow(service: ServiceInfo): SettingsFactRow {
  return {
    key: `${service.name}-${service.port}`,
    label: service.name,
    description: service.description ?? "No description reported",
    value: `${service.protocol.toUpperCase()} :${service.port}${
      service.port !== service.internal_port ? ` → :${service.internal_port}` : ""
    }`,
    mono: true,
    status: { label: service.status, tone: toneForStatus(service.status) },
  };
}

function compatibilityFactRow(check: CompatibilityCheck): SettingsFactRow {
  return {
    key: check.id,
    label: check.severity.toUpperCase(),
    description: check.message,
    value: check.evidence ?? check.suggested_fix ?? "No extra evidence",
    dim: true,
    status: { label: check.severity, tone: severityTone(check.severity) },
  };
}

function toneForStatus(status: string): StatusTone {
  const normalized = status.toLowerCase();
  if (normalized.includes("ready") || normalized.includes("running") || normalized.includes("ok")) {
    return "good";
  }
  if (normalized.includes("error") || normalized.includes("down") || normalized.includes("fail")) {
    return "danger";
  }
  if (
    normalized.includes("fallback") ||
    normalized.includes("check") ||
    normalized.includes("warn")
  ) {
    return "warning";
  }
  return "default";
}

function severityRank(severity: CompatibilityCheck["severity"]): number {
  if (severity === "error") return 0;
  if (severity === "warn") return 1;
  return 2;
}

function severityTone(severity: CompatibilityCheck["severity"]): StatusTone {
  if (severity === "error") return "danger";
  if (severity === "warn") return "warning";
  return "info";
}
