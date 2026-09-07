"use client";

import { Mic, Square } from "@/ui/icon-registry";
import type { TranscriptPhase } from "./use-chat-pane-composer-actions";
import { useComposerDictation } from "./use-composer-dictation";
import { useOnDeviceDictation } from "./use-on-device-dictation";
import { useGlobalDictationShortcut } from "./use-global-dictation-shortcut";

export function ComposerDictationButton({
  disabled,
  inactiveClassName,
  idleClassName = "",
  onTranscript,
  shortcutTarget,
}: {
  disabled: boolean;
  inactiveClassName: string;
  idleClassName?: string;
  onTranscript: (text: string, phase?: TranscriptPhase) => void;
  shortcutTarget: boolean;
}) {
  // TWO ENGINES, AND THE LOCAL ONE WINS WHEN IT IS REALLY THERE.
  //
  // On-device transcribes as the user speaks and no audio ever leaves the Mac. The upload path
  // records in the browser and POSTs the clip to a backend — it works, and it is the only
  // option off macOS or on a build without the helper, but it cannot show a word until the
  // user stops, and it is a recording leaving the machine.
  //
  // `available` starts as null (not probed yet) and only becomes true after the helper has
  // answered that the language's model is installed. Anything else falls back, so the button
  // is never offered by a path that would fail when pressed.
  const local = useOnDeviceDictation(onTranscript);
  const upload = useComposerDictation((text: string) => onTranscript(text, "final"));
  const onDevice = local.available === true;
  useGlobalDictationShortcut({
    enabled: shortcutTarget && onDevice,
    recording: local.recording,
    start: local.start,
    stop: local.stop,
  });
  const dictation = onDevice
    ? {
        error: local.error,
        recording: local.recording,
        transcribing: false,
        busy: local.recording,
        toggle: local.toggle,
      }
    : upload;

  const title = dictation.error
    ? dictation.error
    : dictation.transcribing
      ? "Transcribing…"
      : dictation.recording
        ? "Stop dictation"
        : onDevice
          ? "Dictate message — on this Mac, no audio leaves it"
          : "Dictate message";

  return (
    <>
      <button
        type="button"
        onClick={() => void dictation.toggle()}
        disabled={disabled || (dictation.busy && !dictation.recording)}
        aria-pressed={dictation.recording}
        aria-label={dictation.recording ? "Stop dictation" : "Start dictation"}
        title={title}
        className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${dictation.recording ? "bg-red-500/15 text-red-400" : `${dictation.busy ? "" : idleClassName} ${inactiveClassName}`}`}
      >
        {dictation.recording ? (
          <Square className="h-3 w-3 fill-current" strokeWidth={1.5} />
        ) : (
          <Mic className="h-4 w-4" strokeWidth={1.5} />
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {dictation.error || (dictation.transcribing ? "Transcribing audio" : "")}
      </span>
    </>
  );
}
