"use client";

import { useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { DictationShortcutBridge } from "../../../../desktop/interfaces";

function bridge(): DictationShortcutBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = window.localStudioDesktop?.dictationShortcut;
  return candidate &&
    typeof candidate.registerTarget === "function" &&
    typeof candidate.reportRecording === "function" &&
    typeof candidate.onRequest === "function"
    ? candidate
    : null;
}

export function useGlobalDictationShortcut({
  enabled,
  recording,
  start,
  stop,
}: {
  enabled: boolean;
  recording: boolean;
  start: () => Promise<boolean>;
  stop: () => void;
}): void {
  const [ownerId] = useState(() => crypto.randomUUID());
  const recordingSeen = useRef(false);

  useMountSubscription(() => {
    const api = bridge();
    if (!api || !enabled) return;
    const id = ownerId;
    const unsubscribe = api.onRequest((request) => {
      if (request.ownerId !== id) return;
      if (request.action === "start") {
        void start().then((started) => {
          if (!started) void api.reportRecording(id, false);
        });
      } else stop();
    });
    void api.registerTarget(id, true);
    return () => {
      stop();
      void api.reportRecording(id, false);
      void api.registerTarget(id, false);
      unsubscribe();
    };
  }, [enabled, ownerId, start, stop]);

  useMountSubscription(() => {
    const api = bridge();
    if (!api || !enabled) return;
    if (!recording && !recordingSeen.current) return;
    recordingSeen.current = recording;
    void api.reportRecording(ownerId, recording);
  }, [enabled, ownerId, recording]);
}
