"use client";

import { useCallback, useRef, type RefObject } from "react";
import { respondExtensionUi } from "@/features/agent/runtime/api";
import type { SessionTab } from "@/features/agent/messages";

type UpdateTab = (id: string, update: (tab: SessionTab) => SessionTab) => void;

/** `partial` is volatile and will be rewritten; `final` will not. The upload path only ever
 *  produces finals, which is why it is the default. */
export type TranscriptPhase = "partial" | "final";

/** Composer actions that only touch the active tab's text or its pending
 *  extension prompt. Lifted out of ChatPane so the component reads as
 *  composition rather than a wall of one-off callbacks. */
export function useChatPaneComposerActions({
  activeTab,
  updateTab,
  textareaRef,
}: {
  activeTab: SessionTab | undefined;
  updateTab: UpdateTab;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}): {
  handleTranscript: (transcript: string, phase?: TranscriptPhase) => void;
  handleExtensionUiResponse: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
} {
  /**
   * Dictation writes into the composer, then puts the caret at the end so the user can keep
   * going without reaching for the mouse.
   *
   * A PARTIAL REPLACES THE SPAN IT WROTE LAST TIME; a final settles it. The on-device engine
   * emits volatile results — "quero" then "quero que" then "quero que você" — and appending
   * each one produces "quero quero que quero que você". So the span this dictation owns is
   * tracked, and every partial rewrites exactly that range and nothing else.
   *
   * The span is remembered as a start offset and a length rather than as "the tail of the
   * text", because the user may keep typing around it, and because a final that arrives after
   * the composer was cleared must not resurrect a sentence into an empty box.
   */
  const span = useRef<{ tabId: string; start: number; length: number } | null>(null);

  const handleTranscript = useCallback(
    (transcript: string, phase: TranscriptPhase = "final") => {
      if (!activeTab) return;
      const text = transcript.trim();
      const current = activeTab.input;
      const open = span.current;

      let start: number;
      let before: string;
      let after: string;

      if (open && open.tabId === activeTab.id && open.start + open.length <= current.length) {
        // Rewrite the span this dictation owns, leaving anything the user typed around it.
        start = open.start;
        before = current.slice(0, start);
        after = current.slice(start + open.length);
      } else {
        // First result of an utterance: append after what is already typed, with one space.
        const head = current.trimEnd();
        before = head ? `${head} ` : "";
        start = before.length;
        after = "";
      }

      // An empty transcript with no span open is nothing happening: the user pressed stop
      // before saying anything. Writing here would append the separator computed above and
      // leave a trailing space in a composer they never dictated into.
      if (!text && !open) return;

      // Emptying an owned span takes its separator with it, when there is nothing after it to
      // separate from. Otherwise the user is left with a gap where a word used to be.
      const next = text
        ? `${before}${text}${after}`
        : `${after ? before : before.trimEnd()}${after}`;
      const caret = text ? start + text.length : next.length;

      // A final closes the span, so the next utterance starts a new one instead of eating this
      // sentence. An empty final closes it without leaving a stray separator behind.
      span.current =
        phase === "partial" ? { tabId: activeTab.id, start, length: text.length } : null;

      updateTab(activeTab.id, (tab) => ({ ...tab, input: next }));
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      });
    },
    [activeTab, textareaRef, updateTab],
  );

  /** Clear the prompt optimistically; a failed round-trip surfaces as the
   *  session error rather than leaving a dead dialog on screen. */
  const handleExtensionUiResponse = useCallback(
    (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      const request = activeTab?.extensionUiRequest;
      if (!activeTab || !request) return;
      updateTab(activeTab.id, (session) => ({ ...session, extensionUiRequest: undefined }));
      void respondExtensionUi(activeTab.id, request.requestId, response).catch((error) => {
        updateTab(activeTab.id, (session) => ({
          ...session,
          error: error instanceof Error ? error.message : "Extension response failed",
        }));
      });
    },
    [activeTab, updateTab],
  );

  return { handleTranscript, handleExtensionUiResponse };
}
