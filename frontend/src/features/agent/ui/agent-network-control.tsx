"use client";

import { useCallback, useState, type MouseEvent, type PointerEvent } from "react";
import { Check, ChevronLeft, Lock, Network } from "@/ui/icon-registry";
import { POPOVER_MENU_CLASS, POPOVER_SEPARATOR_CLASS } from "@/ui/popover";
import { cx } from "@/ui/utils";
import {
  isProtectedPolicy,
  type NetworkPolicy,
  type NetworkStatus,
} from "@shared/agent/network-policy";
import {
  failClosedLabel,
  measuredLabel,
  networkStateHeadline,
  networkStateLabel,
  networkStateTone,
  networkToneDotClass,
  observationLabel,
  tunnelLabel,
} from "@/features/agent/network/network-labels";
import {
  refreshNetworkStatus,
  setSessionNetworkPolicy,
} from "@/features/agent/network/network-status-store";
import { useNetworkStatus } from "@/features/agent/network/use-network-status";
import { importNetworkProvider } from "@/features/agent/network/network-api";
import { Effect } from "effect";

//
// The network control for ONE conversation, sitting next to the model control
// and speaking the same language: one quiet trigger, one popover.
//
// The trigger is deliberately unbalanced. "Direct" is the default and says
// almost nothing — a small icon and one word, in the dim colour every other
// optional composer affordance uses. Protection is the state worth seeing, so
// only that one gets a padlock, a name, and a coloured dot.
//
// The popover never asserts more than was measured. Every field it draws comes
// from GET /api/agent/network/status; a field that is null, or an observation
// that came back "unavailable", is printed as "not measured", and BLOCKED and
// ERROR are printed as what they are rather than hidden behind a spinner.
// Nothing here describes anonymity: a tunnel moves where packets leave from.
//

function stopToolbarEvent(event: MouseEvent | PointerEvent): void {
  event.stopPropagation();
}

export function AgentNetworkControl({
  sessionId,
  policy,
  disabled = false,
  onPolicyChange,
}: {
  sessionId: string | null;
  policy: NetworkPolicy;
  disabled?: boolean;
  onPolicyChange: (policy: NetworkPolicy) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const protectedHere = isProtectedPolicy(policy);
  // A conversation restored from disk can already be protected and nobody has
  // touched the toggle in this page's lifetime, so the subscription itself
  // carries that fact — see `useNetworkStatus`.
  const { status, loading, error } = useNetworkStatus(protectedHere);

  const close = useCallback(() => {
    setOpen(false);
    setRefusal(null);
  }, []);

  const choose = useCallback(
    async (next: NetworkPolicy) => {
      if (!sessionId || pending || next === policy) return;
      setPending(true);
      setRefusal(null);
      const outcome = await setSessionNetworkPolicy(sessionId, next);
      setPending(false);
      //
      // A refusal leaves the conversation exactly where it was. Flipping the
      // control and then showing an error would teach the owner that the padlock
      // is decorative, which is the one thing it must never be.
      //
      if (!outcome.accepted) {
        setRefusal(outcome.error);
        return;
      }
      onPolicyChange(next);
    },
    [onPolicyChange, pending, policy, sessionId],
  );

  const tone = status ? networkStateTone(status.state) : "warn";

  return (
    <div
      className="relative min-w-0 shrink-0"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        close();
      }}
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
    >
      <button
        type="button"
        onPointerDown={stopToolbarEvent}
        onMouseDown={stopToolbarEvent}
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        className={cx(
          "inline-flex !h-[30px] !min-h-[30px] shrink-0 items-center gap-1.5 rounded-lg bg-transparent px-2 text-[length:var(--fs-base)] whitespace-nowrap transition-colors hover:bg-(--hover) hover:text-(--fg) active:translate-y-px disabled:opacity-60",
          protectedHere ? "text-(--fg)/85" : "text-(--hl2)",
          open && "bg-(--hover) text-(--fg)",
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          protectedHere
            ? `Network: VPN protected${status ? ` (${networkStateLabel(status.state)})` : ""}`
            : "Network: direct"
        }
        title={
          protectedHere
            ? status
              ? networkStateHeadline(status.state)
              : "VPN protected — the network status has not been read yet"
            : "Network: direct — this conversation uses the machine's own route"
        }
      >
        {protectedHere ? (
          <>
            <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">VPN Protected</span>
            <span
              aria-hidden="true"
              className={cx("h-1.5 w-1.5 shrink-0 rounded-full", networkToneDotClass(tone))}
            />
          </>
        ) : (
          <>
            <Network className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">Direct</span>
          </>
        )}
      </button>
      {open ? (
        <div
          className={cx(
            "absolute bottom-full right-0 z-[300] mb-1.5 w-80 max-w-[calc(100vw-2rem)]",
            POPOVER_MENU_CLASS,
          )}
          role="menu"
          aria-label="Network"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <div className="flex h-9 items-center gap-1 border-b border-(--border) px-1 pb-1">
            <button
              type="button"
              onClick={close}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
              aria-label="Close"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-1 text-[length:var(--fs-sm)] font-medium text-(--dim)">
              Network
            </span>
          </div>

          <PolicyRow
            label="VPN Protected"
            hint="Confine this conversation's egress to the tunnel"
            checked={protectedHere}
            disabled={pending || !sessionId}
            onClick={() => void choose(protectedHere ? "direct" : "vpn_protected")}
          />

          {refusal ? (
            <p className="px-2.5 pb-1.5 text-[length:var(--fs-xs)] text-(--err)">{refusal}</p>
          ) : null}

          <div className={POPOVER_SEPARATOR_CLASS} />

          {status && !status.configured ? (
            <ProviderImport onImported={() => void refreshNetworkStatus()} />
          ) : (
            <NetworkDetails status={status} loading={loading} error={error} policy={policy} />
          )}
        </div>
      ) : null}
    </div>
  );
}

//
// Protection cannot be turned on without a provider, and until this existed the
// only way to supply one was curl — a feature with no way in. It appears exactly
// when `configured` is false, which is also the state the 409 refusal reports,
// so the answer to "why won't it turn on" is in the same place as the question.
//
// The configuration is pasted rather than picked from disk: the runtime reads
// the TEXT and keeps the keys itself, a file path would have to be read by the
// browser anyway, and nothing here should hold a private key longer than the
// request that carries it.
//
function ProviderImport({ onImported }: { onImported: () => void }) {
  const [config, setConfig] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (!config.trim() || busy) return;
    setBusy(true);
    setError(null);
    void Effect.runPromise(importNetworkProvider(config, name.trim() || "WireGuard"))
      .then((outcome) => {
        if (outcome.accepted) {
          //
          // Cleared on success so the key material does not sit in a React state
          // tree for the rest of the session.
          //
          setConfig("");
          setName("");
          onImported();
          return;
        }
        setError(outcome.error);
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error ? cause.message : "The configuration could not be imported",
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="px-2.5 pb-2 pt-1">
      <p className="text-[length:var(--fs-xs)] text-(--fg)">No VPN configuration imported</p>
      <p className="mt-1 text-[length:var(--fs-xs)] leading-relaxed text-(--dim)">
        Paste a WireGuard configuration from your provider. It must route everything (
        <span className="font-mono">AllowedIPs</span> including{" "}
        <span className="font-mono">0.0.0.0/0</span>) — a split tunnel would leave a direct path.
      </p>
      <input
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        placeholder="Name (optional)"
        className="mt-2 w-full rounded-md border border-(--border) bg-(--bg) px-2 py-1 text-[length:var(--fs-xs)] text-(--fg) placeholder:text-(--dim)"
      />
      <textarea
        value={config}
        onChange={(event) => setConfig(event.currentTarget.value)}
        spellCheck={false}
        rows={5}
        placeholder={
          "[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = host:port\nAllowedIPs = 0.0.0.0/0, ::/0"
        }
        className="mt-1.5 w-full resize-none rounded-md border border-(--border) bg-(--bg) px-2 py-1 font-mono text-[length:var(--fs-2xs)] leading-relaxed text-(--fg) placeholder:text-(--dim)"
      />
      {error ? <p className="mt-1 text-[length:var(--fs-xs)] text-(--err)">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !config.trim()}
        className="mt-1.5 inline-flex h-7 items-center rounded-md bg-(--active) px-2.5 text-[length:var(--fs-xs)] text-(--fg) hover:bg-(--hover) disabled:opacity-40"
      >
        {busy ? "Importing…" : "Import configuration"}
      </button>
    </div>
  );
}

function PolicyRow({
  label,
  hint,
  checked,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className="mt-1 flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[length:var(--fs-base)] text-(--fg) transition-colors hover:bg-(--hover) disabled:cursor-default disabled:opacity-55"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block truncate text-[length:var(--fs-xs)] text-(--dim)">{hint}</span>
      </span>
      {checked ? <Check className="h-4 w-4 shrink-0 text-(--fg)" /> : null}
    </button>
  );
}

function NetworkDetails({
  status,
  loading,
  error,
  policy,
}: {
  status: NetworkStatus | null;
  loading: boolean;
  error: string | null;
  policy: NetworkPolicy;
}) {
  if (!status) {
    return (
      <p className="px-2.5 py-2 text-[length:var(--fs-xs)] text-(--dim)">
        {error ?? (loading ? "Reading the network status…" : "The network status is unavailable.")}
      </p>
    );
  }
  const tone = networkStateTone(status.state);
  //
  // The boundary is process-wide. A Direct conversation on a machine that is
  // currently carrying protected work is still routed through the tunnel, and
  // saying so is the honest version of a padlock the owner did not ask for.
  //
  const sharedBoundary = !isProtectedPolicy(policy) && status.protectedSessionCount > 0;
  return (
    <div className="px-2.5 pb-1.5 pt-1">
      <p className="flex items-start gap-2 text-[length:var(--fs-xs)] text-(--fg)">
        <span
          aria-hidden="true"
          className={cx("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", networkToneDotClass(tone))}
        />
        <span className="min-w-0">{networkStateHeadline(status.state)}</span>
      </p>
      {status.detail ? (
        <p className="mt-1 pl-3.5 text-[length:var(--fs-xs)] text-(--dim)">{status.detail}</p>
      ) : null}
      {error ? (
        <p className="mt-1 pl-3.5 text-[length:var(--fs-xs)] text-(--warn)">
          Last reading failed: {error}
        </p>
      ) : null}

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[length:var(--fs-xs)]">
        <DetailRow label="Status" value={networkStateLabel(status.state)} />
        <DetailRow label="Provider" value={measuredLabel(status.tunnel.provider)} />
        <DetailRow label="Exit" value={measuredLabel(status.tunnel.exitCountry)} />
        <DetailRow label="Exit IP" value={measuredLabel(status.tunnel.exitIp)} />
        <DetailRow label="Tunnel" value={tunnelLabel(status.tunnel.connected)} />
        <DetailRow label="Protocol" value={measuredLabel(status.tunnel.protocol)} />
        <DetailRow label="DNS" value={observationLabel(status.dns)} />
        <DetailRow label="IPv4" value={observationLabel(status.ipv4)} />
        <DetailRow label="IPv6" value={observationLabel(status.ipv6)} />
        <DetailRow label="Fail-closed" value={failClosedLabel(status.enforcement.failClosed)} />
      </dl>

      {status.enforcement.unconfinedPaths.length > 0 ? (
        <p className="mt-2 text-[length:var(--fs-xs)] text-(--warn)">
          Outside the boundary: {status.enforcement.unconfinedPaths.join(", ")}
        </p>
      ) : null}

      {sharedBoundary ? (
        <p className="mt-2 text-[length:var(--fs-xs)] text-(--dim)">
          A protected workload is active; agent network is currently routed through the VPN.
        </p>
      ) : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-(--dim)">{label}</dt>
      <dd className="min-w-0 truncate text-right text-(--fg)/80">{value}</dd>
    </>
  );
}
