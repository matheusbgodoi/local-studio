"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { RemoteAccessInfo } from "../../../desktop/interfaces";
import { Check, Copy, Settings, Smartphone } from "@/ui/icon-registry";
import { ProfileAvatar, useLocalProfile } from "@/features/shell/local-profile";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { writeClipboardText } from "@/lib/clipboard";
import { POPOVER_PANEL_CLASS } from "@/ui/popover";

function RemoteAccessButton() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<RemoteAccessInfo | null>(null);
  const [copied, setCopied] = useState<"url" | "token" | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useMountSubscription(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    setCopied(null);
    if (next) {
      void window.localStudioDesktop
        ?.getRemoteAccessInfo?.()
        .then(setInfo, () => setInfo({ enabled: false, url: null, tokenAvailable: false }));
    }
  };

  const markCopied = (value: "url" | "token"): void => {
    setCopied(value);
    window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 1800);
  };

  const copyUrl = (): void => {
    if (!info?.url) return;
    void writeClipboardText(info.url).then(
      () => markCopied("url"),
      () => undefined,
    );
  };

  const copyToken = (): void => {
    void window.localStudioDesktop?.copyRemoteAccessToken?.().then(
      (result) => {
        if (result.ok) markCopied("token");
      },
      () => undefined,
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--sidebar-row-radius)] text-(--fg)/60 transition-colors hover:bg-(--hover) hover:text-(--fg)"
        title="Mobile access"
        aria-label="Mobile access"
        aria-expanded={open}
      >
        <Smartphone className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      {open ? (
        <div className={`absolute bottom-9 right-0 z-[1000] w-72 p-3 ${POPOVER_PANEL_CLASS}`}>
          <div className="text-[length:var(--fs-sm)] font-medium text-(--fg)">Mobile access</div>
          {!window.localStudioDesktop ? (
            <p className="mt-1.5 text-[length:var(--fs-xs)] text-(--dim)">
              Pairing details are available in the Mac app.
            </p>
          ) : info?.enabled && info.url ? (
            <div className="mt-2 space-y-2.5">
              <div>
                <div className="text-[length:var(--fs-xs)] text-(--dim)">Tailnet URL</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 break-all font-mono text-[length:var(--fs-xs)] text-(--fg)">
                    {info.url}
                  </span>
                  <button
                    type="button"
                    onClick={copyUrl}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-(--hover)"
                    aria-label="Copy mobile URL"
                  >
                    {copied === "url" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <div className="text-[length:var(--fs-xs)] text-(--dim)">Access token</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 font-mono text-[length:var(--fs-sm)] tracking-widest text-(--fg)">
                    ************
                  </span>
                  <button
                    type="button"
                    onClick={copyToken}
                    className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[length:var(--fs-xs)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                  >
                    {copied === "token" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied === "token" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          ) : info ? (
            <p className="mt-1.5 text-[length:var(--fs-xs)] text-(--dim)">
              Remote access is off. Run <span className="font-mono">npm run remote-access</span> on
              this Mac to enable it.
            </p>
          ) : (
            <p className="mt-1.5 text-[length:var(--fs-xs)] text-(--dim)">Loading…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ProfileFooter({ settingsActive }: { settingsActive: boolean }) {
  const [profile] = useLocalProfile();

  return (
    <div className="flex h-[var(--sidebar-row-height)] items-center gap-1">
      <Link
        href="/settings#profile"
        prefetch={false}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--sidebar-row-radius)] px-2 py-1 text-left transition-colors hover:bg-(--hover)"
        aria-label="Profile settings"
      >
        <ProfileAvatar profile={profile} />
        <span className="truncate text-[length:var(--fs-md)] text-(--fg)">{profile.name}</span>
      </Link>
      <RemoteAccessButton />
      <Link
        href="/settings"
        prefetch={false}
        title="Settings"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--sidebar-row-radius)] transition-colors ${
          settingsActive
            ? "bg-(--active) text-(--fg)"
            : "text-(--fg)/60 hover:bg-(--hover) hover:text-(--fg)"
        }`}
      >
        <Settings className="h-3.5 w-3.5" strokeWidth={1.75} />
      </Link>
    </div>
  );
}
