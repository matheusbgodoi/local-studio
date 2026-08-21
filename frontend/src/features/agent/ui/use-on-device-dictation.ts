"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { TranscriptPhase } from "@/features/agent/ui/use-chat-pane-composer-actions";

/**
 * Dictation that runs on this Mac and never sends audio anywhere.
 *
 * The desktop main process spawns a Swift helper that opens the microphone itself and streams
 * text back; the renderer never sees a single audio sample. That is the difference from the
 * upload path in `use-composer-dictation`, which records in the browser and POSTs the clip to
 * a backend — fine when a backend offers transcription, but it is a recording leaving the
 * machine, and it cannot show a word until the user stops speaking.
 *
 * Availability is PROBED, not assumed: the helper only exists in a macOS build where
 * `desktop/speech/build.sh` has run, and even then the locale's assets may not be installed.
 * A caller that cannot get an answer falls back rather than presenting a button that fails.
 */

type DictationEvent =
  | { type: "ready"; locale: string }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; code: string; message: string }
  | { type: "done" };

type DictationBridge = {
  probeDictation: (locale: string) => Promise<{ available: boolean; reason?: string }>;
  startDictation: (locale: string) => Promise<{ started: boolean; reason?: string }>;
  stopDictation: (mode: "stop" | "cancel") => Promise<{ ok: boolean }>;
  onDictationEvent: (listener: (event: DictationEvent) => void) => () => void;
};

function bridge(): DictationBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { localStudioDesktop?: Partial<DictationBridge> })
    .localStudioDesktop;
  if (!candidate) return null;
  const complete =
    typeof candidate.probeDictation === "function" &&
    typeof candidate.startDictation === "function" &&
    typeof candidate.stopDictation === "function" &&
    typeof candidate.onDictationEvent === "function";
  // All four or none. A half-present bridge is an older desktop build, and starting against it
  // would open a microphone nothing is listening to.
  return complete ? (candidate as DictationBridge) : null;
}

/** The composer speaks the user's language; the transcriber has to be told which. */
function preferredLocale(): string {
  if (typeof navigator === "undefined") return "pt-BR";
  return navigator.language || "pt-BR";
}

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case "helper_not_bundled":
      return "On-device dictation is not part of this build";
    case "not_macos":
      return "On-device dictation needs macOS";
    case "already_running":
      return "Dictation is already running";
    case "asset_unavailable":
      return "This language has no on-device speech model installed";
    default:
      return "On-device dictation is unavailable";
  }
}

export function useOnDeviceDictation(onTranscript: (text: string, phase: TranscriptPhase) => void) {
  // `null` = not probed yet. Distinct from `false`, so the button can stay hidden rather than
  // flicker in and then out on every mount.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const unsubscribe = useRef<(() => void) | null>(null);
  const mounted = useRef(true);

  useMountSubscription(() => {
    mounted.current = true;
    const api = bridge();
    if (!api) {
      setAvailable(false);
      return;
    }
    void api
      .probeDictation(preferredLocale())
      .then((probe) => {
        if (mounted.current) setAvailable(probe.available);
      })
      .catch(() => {
        if (mounted.current) setAvailable(false);
      });
    return () => {
      mounted.current = false;
      unsubscribe.current?.();
      unsubscribe.current = null;
      // Releasing the microphone is not optional on unmount. `cancel` and not `stop`: a
      // composer that is going away has nowhere to put a final transcript.
      void api.stopDictation("cancel").catch(() => {});
    };
  }, []);

  const stop = useCallback(() => {
    const api = bridge();
    if (!api) return;
    void api.stopDictation("stop").catch(() => {});
  }, []);

  const start = useCallback(async () => {
    const api = bridge();
    if (!api || recording) return;
    setError("");

    unsubscribe.current?.();
    unsubscribe.current = api.onDictationEvent((event) => {
      if (!mounted.current) return;
      switch (event.type) {
        case "ready":
          setRecording(true);
          break;
        case "partial":
          onTranscript(event.text, "partial");
          break;
        case "final":
          onTranscript(event.text, "final");
          break;
        case "error":
          setError(event.message || reasonText(event.code));
          break;
        case "done":
          // Always arrives, including after a crash, so the button cannot stick on "recording".
          setRecording(false);
          unsubscribe.current?.();
          unsubscribe.current = null;
          break;
      }
    });

    const result = await api.startDictation(preferredLocale()).catch(() => ({
      started: false,
      reason: "spawn_failed",
    }));
    if (!result.started && mounted.current) {
      setError(reasonText(result.reason));
      setRecording(false);
      unsubscribe.current?.();
      unsubscribe.current = null;
    }
  }, [onTranscript, recording]);

  return {
    available,
    recording,
    error,
    toggle: recording ? stop : () => void start(),
  };
}
