"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState } from "react";
import type { RemoteAccessInfo, RemoteAccessPairingCodeResult } from "../../../desktop/interfaces";
import { Check, Copy, Settings, Smartphone } from "@/ui/icon-registry";
import { ProfileAvatar, useLocalProfile } from "@/features/shell/local-profile";
import { writeClipboardText } from "@/lib/clipboard";
import { Button, UiModal, UiModalHeader } from "@/ui";

function RemoteAccessButton() {
  const desktop = typeof window === "undefined" ? undefined : window.localStudioDesktop;
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<RemoteAccessInfo | null>(null);
  const [pairing, setPairing] = useState<RemoteAccessPairingCodeResult | null>(null);
  const [copied, setCopied] = useState<"url" | "token" | null>(null);
  const pairingGeneration = useRef(0);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    setCopied(null);
    if (next) {
      const generation = ++pairingGeneration.current;
      setInfo(null);
      setPairing(null);
      void desktop?.getRemoteAccessInfo?.().then(
        (result) => {
          if (pairingGeneration.current === generation) setInfo(result);
        },
        () => {
          if (pairingGeneration.current === generation) {
            setInfo({ enabled: false, url: null, tokenAvailable: false });
          }
        },
      );
      void desktop?.getRemoteAccessPairingCode?.().then(
        (result) => {
          if (pairingGeneration.current === generation) setPairing(result);
        },
        () => {
          if (pairingGeneration.current === generation) {
            setPairing({ ok: false, reason: "generation_failed" });
          }
        },
      );
    }
  };

  const close = (): void => {
    pairingGeneration.current += 1;
    setOpen(false);
    setInfo(null);
    setPairing(null);
    setCopied(null);
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
    void desktop?.copyRemoteAccessToken?.().then(
      (result) => {
        if (result.ok) markCopied("token");
      },
      () => undefined,
    );
  };

  return (
    <div>
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
      <UiModal isOpen={open} onClose={close} maxWidth="max-w-md">
        <UiModalHeader
          title="Connect your phone"
          icon={<Smartphone className="h-4 w-4" strokeWidth={1.75} />}
          onClose={close}
        />
        <div className="p-5">
          {!desktop ? (
            <p className="text-[length:var(--fs-sm)] text-(--dim)">
              Pairing details are available in the Mac app.
            </p>
          ) : info?.enabled && info.url ? (
            <div className="space-y-5">
              <div className="text-center">
                <p className="text-[length:var(--fs-sm)] text-(--dim)">
                  Scan with your iPhone camera. Local Studio opens, pairs this device, and removes
                  the one-time code from the address bar.
                </p>
                <div className="mx-auto mt-4 flex h-60 w-60 items-center justify-center overflow-hidden rounded-2xl border border-black/10 bg-white p-3 shadow-sm">
                  {pairing?.ok ? (
                    <Image
                      src={pairing.dataUrl}
                      alt="QR code to pair this phone with Local Studio"
                      width={216}
                      height={216}
                      unoptimized
                      className="h-full w-full"
                    />
                  ) : pairing ? (
                    <span className="max-w-44 text-[length:var(--fs-xs)] text-neutral-600">
                      The pairing code could not be created. Copy the access token instead.
                    </span>
                  ) : (
                    <span className="text-[length:var(--fs-xs)] text-neutral-500">
                      Preparing secure pairing…
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[length:var(--fs-xs)] text-(--dim)">Tailnet URL</div>
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-(--border) bg-(--ui-fg)/[0.025] px-3 py-2">
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
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-(--border) bg-(--ui-fg)/[0.025] px-3 py-2">
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
              <p className="text-[length:var(--fs-xs)] leading-relaxed text-(--dim)">
                Tailnet only. This code expires in two minutes and can be redeemed once.
              </p>
            </div>
          ) : info ? (
            <div className="space-y-4">
              <p className="text-[length:var(--fs-sm)] text-(--dim)">
                Remote access is off. Run <span className="font-mono">npm run remote-access</span>{" "}
                on this Mac to enable it.
              </p>
              <div className="flex justify-end">
                <Button variant="secondary" onClick={close}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-72 items-center justify-center text-[length:var(--fs-sm)] text-(--dim)">
              Preparing secure pairing…
            </div>
          )}
        </div>
      </UiModal>
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
