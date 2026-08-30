"use client";

import { useState, useSyncExternalStore } from "react";
import { Checkbox, Spinner, StatusPill } from "@/ui";
import type { UiTone } from "@/ui/status";
import {
  getComputeHostsState,
  patchComputeHost,
  refreshComputeHosts,
  subscribeComputeHosts,
  wakeComputeHost,
  type ComputeHostStatus as HostStatus,
} from "./compute-hosts-store";
import {
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsNotice,
  SettingsRow,
  SettingsValue,
} from "./settings-ui";

const STATE_LABEL: Record<string, { label: string; tone: UiTone }> = {
  "model-resident": { label: "Model resident", tone: "good" },
  "gateway-idle": { label: "Gateway up, no model", tone: "info" },
  gaming: { label: "Game mode", tone: "warning" },
  waking: { label: "Waking", tone: "info" },
  unreachable: { label: "Asleep or off", tone: "warning" },
  unknown: { label: "Unknown", tone: "warning" },
};

function gb(mb: number | null): string {
  return mb === null ? "—" : `${(mb / 1024).toFixed(1)} GB`;
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return `${Math.max(1, Math.round(delta / 1000))}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function ComputeHostsSection() {
  const store = useSyncExternalStore(
    subscribeComputeHosts,
    getComputeHostsState,
    getComputeHostsState,
  );
  const hosts = store.hosts;
  const waking = store.busyHostId;
  const message = store.notice;
  const [wakeUrlDraft, setWakeUrlDraft] = useState("");
  const [savingWakeUrl, setSavingWakeUrl] = useState(false);

  const load = () => void refreshComputeHosts();
  const patchHost = patchComputeHost;
  const wake = (id: string) => void wakeComputeHost(id);

  if (hosts === null) {
    return (
      <SettingsGroup title="Compute hosts" description="Remote machines that can serve inference.">
        <div className="px-1 py-3">
          <Spinner />
        </div>
      </SettingsGroup>
    );
  }

  if (hosts.length === 0) {
    return (
      <SettingsGroup title="Compute hosts" description="Remote machines that can serve inference.">
        <SettingsNotice tone="info">
          No compute host is configured. A host is a machine with a control endpoint CRIAs can ask
          about power and model state, and optionally a wake provider that can bring it back.
        </SettingsNotice>
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup
      title="Compute hosts"
      description="Remote machines that can serve inference, and how CRIAs may wake them."
      actions={<SettingsButton onClick={load}>Refresh</SettingsButton>}
    >
      {message ? <SettingsNotice tone={message.tone}>{message.text}</SettingsNotice> : null}

      {hosts.map((host) => {
        const meta = STATE_LABEL[host.state] ?? STATE_LABEL.unknown;
        const cooling =
          host.wakeCooldownUntil !== null && new Date(host.wakeCooldownUntil) > new Date();
        return (
          <div key={host.id} className="mb-4 last:mb-0">
            <SettingsRow
              label={host.name}
              description={host.detail ?? undefined}
              status={
                <StatusPill tone={meta.tone} variant="badge">
                  {host.wakeInFlight ? "Waking" : meta.label}
                </StatusPill>
              }
            />
            <SettingsRow
              label="Resident model"
              value={<SettingsValue mono>{host.residentModel ?? "none"}</SettingsValue>}
            />
            <SettingsRow
              label="GPU memory"
              value={
                <SettingsValue mono>
                  {host.gpuUsedMb === null
                    ? "—"
                    : `${gb(host.gpuUsedMb)} / ${gb(host.gpuTotalMb)} used`}
                </SettingsValue>
              }
            />
            <SettingsRow
              label="Last seen"
              value={<SettingsValue dim>{relative(host.lastSeenAt)}</SettingsValue>}
            />
            <SettingsRow
              label="Wake on demand"
              description={
                host.wakeConfigured
                  ? "A wake request is sent when the host is not reachable."
                  : "Paste the wake URL below to enable this."
              }
              control={
                <Checkbox
                  checked={host.wakeEnabled}
                  disabled={!host.wakeConfigured}
                  onChange={(checked) => void patchHost(host.id, { wakeEnabled: checked })}
                  label="Enabled"
                />
              }
            />
            <SettingsRow
              label="Wake automatically for agents"
              description="Let a delegated task bring the host up on its own."
              control={
                <Checkbox
                  checked={host.autoWake}
                  disabled={!host.wakeConfigured || !host.wakeEnabled}
                  onChange={(checked) => void patchHost(host.id, { autoWake: checked })}
                  label="Enabled"
                />
              }
            />
            <SettingsRow
              label="Wake URL"
              description="Stored locally and never committed. It carries the key that authorises the wake, so it is shown redacted."
              control={
                <div className="flex w-full items-center gap-2">
                  <SettingsInput
                    type="password"
                    value={wakeUrlDraft}
                    onChange={setWakeUrlDraft}
                    placeholder={
                      host.wakeConfigured ? "configured — paste to replace" : "https://…/wake?key=…"
                    }
                    aria-label="Wake URL"
                    className="min-w-0 flex-1"
                  />
                  <SettingsButton
                    disabled={savingWakeUrl || wakeUrlDraft.trim().length === 0}
                    onClick={() => {
                      setSavingWakeUrl(true);
                      void patchHost(host.id, { wakeUrl: wakeUrlDraft.trim() })
                        .then(() => setWakeUrlDraft(""))
                        .finally(() => setSavingWakeUrl(false));
                    }}
                  >
                    Save
                  </SettingsButton>
                </div>
              }
            />
            <SettingsRow
              label="Power on"
              description={
                cooling
                  ? "A wake was just sent; waiting for the host before sending another."
                  : "Sends the configured wake request, then waits for the AI stack to answer."
              }
              actions={
                <SettingsButton
                  tone="primary"
                  disabled={
                    !host.wakeConfigured ||
                    !host.wakeEnabled ||
                    host.wakeInFlight ||
                    waking === host.id ||
                    cooling
                  }
                  onClick={() => wake(host.id)}
                >
                  {waking === host.id || host.wakeInFlight ? "Waking…" : "Power on / Wake"}
                </SettingsButton>
              }
            />
            {host.lastWakeAt ? (
              <p className="px-1 pt-1 text-[length:var(--fs-xs)] text-(--ui-muted)">
                Last wake {relative(host.lastWakeAt)}
                {host.lastWakeOutcome ? ` · ${host.lastWakeOutcome}` : ""}
              </p>
            ) : null}
          </div>
        );
      })}
    </SettingsGroup>
  );
}
