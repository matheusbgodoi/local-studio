import { useCallback, useMemo, useRef } from "react";
import {
  cleanSessionTitle,
  visibleUserTextFromPi,
  type SessionTab,
} from "@/features/agent/messages";
import { loadSessionPrefs, patchCanonicalSessionPref } from "@/features/agent/messages/prefs";
import { assistantContentCopyText } from "@/features/agent/ui/timeline/activity-grouping";
import { useProjectsNavSessionPrefs } from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

function titleExcerpt(tab: SessionTab | null): string {
  if (!tab) return "";
  const user = tab.messages.find((message) => message.role === "user");
  const assistant = tab.messages.find((message) => message.role === "assistant");
  if (!user || !assistant) return "";
  const userText = visibleUserTextFromPi(user.text).trim();
  const assistantText = (
    assistant.text.trim() || assistantContentCopyText(assistant.blocks ?? []).trim()
  ).slice(0, 4000);
  if (!userText || !assistantText) return "";
  return `User:\n${userText.slice(0, 1800)}\n\nAssistant:\n${assistantText}`;
}

export function useChatPaneSessionTitle({
  activeTab,
  activeTabId,
  paneId,
  running,
  onPiSessionIdChange,
  onRenameSession,
}: {
  activeTab: SessionTab | null;
  activeTabId: string;
  paneId: string;
  running: boolean;
  onPiSessionIdChange?: (sessionId: string) => void;
  onRenameSession: (tabId: string, title: string) => void;
}) {
  const sessionPrefs = useProjectsNavSessionPrefs();
  const localPrefKey = paneId && activeTab?.id ? `tab:${paneId}:${activeTab.id}` : null;
  const sessionPrefKeys = useMemo(
    () =>
      [activeTab?.id, localPrefKey, activeTab?.piSessionId].filter((value): value is string =>
        Boolean(value),
      ),
    [activeTab?.id, activeTab?.piSessionId, localPrefKey],
  );
  const sessionPrefTitle = sessionPrefKeys.reduce((title, key) => {
    const nextTitle = cleanSessionTitle(sessionPrefs[key]?.title);
    return nextTitle || title;
  }, "");
  // Empty starter/restored tabs stay visually untitled until user content arrives.
  const sessionLooksEmpty =
    !activeTab || (activeTab.messages.length === 0 && !activeTab.input.trim() && !running);
  const displayedSessionTitle = sessionLooksEmpty
    ? ""
    : sessionPrefTitle || cleanSessionTitle(activeTab?.title) || "";
  const sessionPinned = sessionPrefKeys.some((key) => Boolean(sessionPrefs[key]?.pinned));
  const generatedFor = useRef(new Set<string>());
  const excerpt = titleExcerpt(activeTab);

  useMountSubscription(() => {
    const bridge = window.localStudioDesktop?.generateSessionTitle;
    const piSessionId = activeTab?.piSessionId;
    if (!bridge || !activeTab || !piSessionId || running || !excerpt || sessionPrefTitle) return;
    if (generatedFor.current.has(piSessionId)) return;
    generatedFor.current.add(piSessionId);
    const tabId = activeTab.id;
    const keys = [...sessionPrefKeys];
    let cancelled = false;
    void bridge(excerpt, navigator.language || "en-US")
      .then((result) => {
        if (cancelled || !result.ok) return;
        const latest = loadSessionPrefs();
        if (keys.some((key) => cleanSessionTitle(latest[key]?.title))) return;
        const title = cleanSessionTitle(result.title);
        if (!title) return;
        onRenameSession(tabId, title);
        patchCanonicalSessionPref(piSessionId, keys, { title });
      })
      .catch(() => generatedFor.current.delete(piSessionId))
      .finally(() => {
        if (cancelled) generatedFor.current.delete(piSessionId);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab?.id, activeTab?.piSessionId, excerpt, onRenameSession, running, sessionPrefTitle]);

  const patchActiveSessionPrefs = useCallback(
    (patch: { title?: string; pinned?: boolean }) => {
      const primary = activeTab?.piSessionId ?? localPrefKey ?? activeTab?.id;
      if (primary) patchCanonicalSessionPref(primary, sessionPrefKeys, patch);
    },
    [activeTab?.id, activeTab?.piSessionId, localPrefKey, sessionPrefKeys],
  );
  const togglePinnedSession = useCallback(() => {
    if (sessionPrefKeys.length === 0) return;
    patchActiveSessionPrefs({ pinned: !sessionPinned });
  }, [patchActiveSessionPrefs, sessionPinned, sessionPrefKeys.length]);
  const handlePiSessionIdChange = useCallback(
    (piSessionId: string) => {
      patchCanonicalSessionPref(piSessionId, [activeTabId, `tab:${paneId}:${activeTabId}`]);
      // Once a fresh chat earns its persistent id, swap the throwaway `?new=`
      // nonce in the address bar for `?session=<piSessionId>` so a reload
      // reattaches to (or at least reopens) this conversation instead of
      // restarting a blank chat and losing the in-flight turn from view. Use
      // replaceState — it's invisible to Next's `useSearchParams`, so the
      // running turn's nav effect never re-fires. Side-chat pane excluded.
      if (typeof window !== "undefined" && paneId !== "computer-side-chat" && piSessionId) {
        const params = new URLSearchParams(window.location.search);
        if (params.get("new") !== null && params.get("session") !== piSessionId) {
          params.delete("new");
          params.set("session", piSessionId);
          window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
        }
      }
      onPiSessionIdChange?.(piSessionId);
    },
    [activeTabId, onPiSessionIdChange, paneId],
  );
  const renameActiveSession = useCallback(
    (nextTitle: string) => {
      if (!activeTab) return;
      const trimmed = cleanSessionTitle(nextTitle);
      if (!trimmed || trimmed === displayedSessionTitle) return;
      onRenameSession(activeTab.id, trimmed);
      patchActiveSessionPrefs({ title: trimmed });
    },
    [activeTab, displayedSessionTitle, onRenameSession, patchActiveSessionPrefs],
  );

  return {
    displayedSessionTitle,
    sessionPinned,
    togglePinnedSession,
    handlePiSessionIdChange,
    renameActiveSession,
  };
}
