"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { AgentChatPaneHeader } from "@/features/agent/ui/agent-chat-pane-header";
import { AgentComposerFrame } from "@/features/agent/ui/agent-composer-frame";
import { type FileMentionRow, type MentionRow } from "@/features/agent/ui/agent-composer-context";
import { builtinCommandProvider } from "@/features/agent/composer/builtin-commands";
import { ComposerProjectDrawer } from "@/features/agent/ui/composer-project-drawer";
import { SubagentChips } from "@/features/agent/ui/subagent-chips";
import { RunInlinePanel } from "@/features/runs/run-inline-panel";
import { GitDiffDrawer } from "@/features/agent/ui/git-diff-drawer";
import {
  promptTemplateCommandProvider,
  skillCommandProvider,
} from "@/features/agent/composer/catalogue-commands";
import {
  skillInvocationCommandProvider,
  skillInvocationText,
} from "@/features/agent/composer/skill-invocation-commands";
import { mcpCommandProvider } from "@/features/agent/composer/mcp-commands";
import { transcriptCommandProvider } from "@/features/agent/composer/transcript-commands";
import { setSessionConnectors } from "@/features/agent/tools/connector-session-api";
import {
  createComposerCommandRegistry,
  parseSlashInvocation,
  type SlashInvocation,
} from "@/features/agent/composer/command-registry";
import { deriveComposerVisual } from "@/features/agent/composer/composer-visual-state";

function diffDrawerFor(
  open: boolean,
  props: {
    cwd: string | null;
    gitBranch?: string | null;
    gitSummary?: GitSummary | null;
    onClose: () => void;
  },
) {
  if (!open) return null;
  return <GitDiffDrawer {...props} />;
}

function piSessionIdOf(tab: { piSessionId?: string | null } | null | undefined): string | null {
  return tab?.piSessionId ?? null;
}

// Per-conversation, like the reasoning level and for the same reasons: the owner
// picks it for THIS chat, two panes may disagree, and it has to survive a reload
// — so it lives on the session record the pane store already persists, not in
// workspace-global storage. Absent means "direct".
function sessionNetworkPolicy(tab: SessionTab | null): NetworkPolicy {
  return tab?.networkPolicy ?? DEFAULT_NETWORK_POLICY;
}

function networkControlFor(
  tab: SessionTab | null,
  policy: NetworkPolicy,
  onPolicyChange: (policy: NetworkPolicy) => void,
) {
  return (
    <AgentNetworkControl
      sessionId={tab?.id ?? null}
      policy={policy}
      disabled={!tab}
      onPolicyChange={onPolicyChange}
    />
  );
}

function subagentChipsFor(piSessionId: string | null | undefined) {
  if (!piSessionId) return null;
  return <SubagentChips piSessionId={piSessionId} />;
}

// Renders nothing until this conversation is driving a durable Run, which is
// the model's decision to make and not the composer's.
function runPanelFor(
  tab: { id?: string } | null | undefined,
  piSessionId: string | null | undefined,
) {
  return <RunInlinePanel sessionId={tab?.id ?? null} piSessionId={piSessionId ?? null} />;
}

import {
  useComposerLoadedContext,
  useComposerMentionRows,
  useComposerTextareaBehavior,
  useComposerTextareaHeightSync,
  type UpdateTab,
} from "@/features/agent/ui/chat-pane-composer";
import { useComposerAttachments } from "@/features/agent/ui/chat-pane-composer-attachments";
import {
  applyContextRow,
  useComposerMentionSelection,
} from "@/features/agent/ui/chat-pane-composer-mention-selection";
import {
  consumeComposerMention,
  type ComposerMention,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/features/agent/composer-context";
import {
  useChatPaneContextAttachEffect,
  useChatPaneDerivedState,
  useChatPaneMentionEffects,
  useChatPaneRuntimeHandle,
} from "@/features/agent/ui/chat-pane-hooks";
import { useChatPaneSessionTitle } from "@/features/agent/ui/chat-pane-session-title";
import { canRunGoalCommand, useGoalCommand } from "@/features/agent/ui/use-goal-command";
import { useGoalMode } from "@/features/agent/ui/use-goal-mode";
import { useChatPaneComposerActions } from "@/features/agent/ui/use-chat-pane-composer-actions";
import { useComposerCommandHandlers } from "@/features/agent/ui/use-composer-command-handlers";
import { useChatPaneSendFlow } from "@/features/agent/ui/chat-pane-send-flow";
import { ChatPaneHandle, newId, nowLabel, SessionTab } from "@/features/agent/messages";
import { useSessionEngine } from "@/features/agent/runtime/engine";
import type { UpdateSession } from "@/features/agent/runtime/types";
import { useTools } from "@/features/agent/tools/context";
import type { GitSummary, Project } from "@/features/agent/projects/types";
import type { BrowserBackend } from "@/features/agent/tools/types";
import type { AgentThinkingLevel } from "@/features/agent/contracts";
import { DEFAULT_NETWORK_POLICY, type NetworkPolicy } from "@shared/agent/network-policy";
import { AgentNetworkControl } from "@/features/agent/ui/agent-network-control";
import { pickThinkingLevel } from "@/features/agent/messages/thinking-level-pref";
import {
  browserThinkingStorage,
  readModelThinkingLevel,
  writeModelThinkingLevel,
} from "@/features/agent/workspace/thinking-level-preference";
import {
  exportFilenameFromTitle,
  sessionToMarkdown,
} from "@/features/agent/messages/export-markdown";
import {
  OPEN_TERMINAL_EVENT,
  type OpenTerminalEventDetail,
  type TerminalOwner,
} from "@/features/agent/terminal-owners";
import {
  rememberPersistentTerminalOwner,
  selectPersistentTerminalOwner,
  usePersistentTerminalOwners,
  type TerminalOwnersSnapshot,
} from "@/features/agent/ui/use-persistent-terminal-owners";
import { PersistentTerminals } from "@/features/agent/ui/persistent-terminals";
import { saveTextFile } from "@/features/agent/composer/save-text-file";
import { cx } from "@/ui/utils";
import { ExtensionUiDialog } from "@/features/agent/ui/extension-ui-dialog";
import {
  clearSessionGoal,
  respondExtensionUi,
  updateSessionGoal,
} from "@/features/agent/runtime/api";
export type { ChatPaneHandle, SessionTab };

const Timeline = dynamic(
  () => import("@/features/agent/ui/timeline/timeline").then((mod) => mod.Timeline),
  { ssr: false, loading: () => <TimelineFallback /> },
);

function EmptyPromptTimeline() {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-10 pt-2">
      <div className="agent-thread-shell mx-auto flex flex-1">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="max-w-[24ch] text-[clamp(1.45rem,2.6vw,2.1rem)] font-semibold leading-[1.22] tracking-[-0.02em] text-(--fg)/90">
            A dream is something you build for yourself.
          </p>
          <p className="text-[length:var(--fs-xl)] text-(--dim)">Just talk to it.</p>
        </div>
      </div>
    </div>
  );
}

function TimelineFallback() {
  return <div className="flex min-h-0 flex-1 bg-(--agent-bg)" />;
}

function chatPaneClassName(composerOnly: boolean): string {
  return cx(
    "relative flex min-h-0 min-w-0 flex-1 flex-col",
    composerOnly
      ? "bg-transparent"
      : "bg-(--agent-bg) shadow-[inset_1px_0_rgba(255,255,255,0.015)]",
  );
}

function ChatTranscript({
  composerOnly,
  terminalView,
  showEmptyPrompt,
  activeTab,
  stickToBottom,
  setStickToBottom,
  running,
  onForkSession,
  loadEarlierHistory,
}: {
  composerOnly: boolean;
  terminalView: boolean;
  showEmptyPrompt: boolean;
  activeTab: SessionTab | undefined;
  stickToBottom: boolean;
  setStickToBottom: (value: boolean) => void;
  running: boolean;
  onForkSession?: () => void;
  loadEarlierHistory: () => Promise<void>;
}) {
  const viewKey = activeTab?.piSessionId ?? activeTab?.id ?? null;
  const viewAlias = activeTab?.piSessionId ? activeTab.id : null;
  if (composerOnly) return null;
  return (
    <div className={terminalView ? "hidden" : "flex min-h-0 min-w-0 flex-1"}>
      {showEmptyPrompt ? (
        <EmptyPromptTimeline />
      ) : (
        <Timeline
          key={activeTab?.id ?? "empty"}
          stickToBottom={stickToBottom}
          onStickToBottomChange={setStickToBottom}
          messages={activeTab?.messages ?? []}
          running={running}
          viewKey={viewKey}
          viewAlias={viewAlias}
          onForkSession={onForkSession}
          hasEarlier={activeTab?.historyCursor != null}
          onLoadEarlier={loadEarlierHistory}
        />
      )}
    </div>
  );
}

type Props = {
  paneId: string;
  modelId: string;
  modelSupportsVision: boolean;
  modelThinkingLevels: readonly AgentThinkingLevel[];
  modelsLoading: boolean;
  contextWindow: number;
  cwd: string;
  projectName: string | null;
  modelSelector?: (props: ComposerModelSelectorProps) => ReactNode;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  onInitGit?: () => void;
  browserBackend: BrowserBackend;
  onToggleBrowserBackend: () => void;
  isFocused: boolean;
  onFocus: () => void;
  onPiSessionIdChange?: (sessionId: string) => void;
  tabs: SessionTab[];
  activeTabId: string;
  onUpdateSession: UpdateSession;
  onRenameSession: (tabId: string, title: string) => void;
  onClose?: () => void;
  onForkSession?: () => void;
  onOpenTerminal?: () => void;
  terminalOwner?: TerminalOwner | null;
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
  showHeader?: boolean;
  composerOnly?: boolean;
};

export type ComposerModelSelectorProps = {
  reasoningLevel: AgentThinkingLevel;
  reasoningLevels: readonly AgentThinkingLevel[];
  reasoningDisabled: boolean;
  onSelectReasoning: (level: AgentThinkingLevel) => void;
};

function renderComposerModelSelector(
  renderer: Props["modelSelector"],
  props: ComposerModelSelectorProps,
): ReactNode {
  return renderer ? renderer(props) : null;
}

function terminalActionFor(
  terminalOwner: TerminalOwner | null,
  toggleTerminalView: () => void,
  onOpenTerminal: (() => void) | undefined,
): (() => void) | undefined {
  return terminalOwner ? toggleTerminalView : onOpenTerminal;
}

export function ChatPane({
  paneId,
  modelId,
  modelSupportsVision,
  modelThinkingLevels,
  modelsLoading,
  contextWindow,
  cwd,
  projectName,
  modelSelector,
  gitBranch,
  gitSummary,
  onInitGit,
  browserBackend,
  onToggleBrowserBackend,
  isFocused,
  onFocus,
  onPiSessionIdChange,
  tabs,
  activeTabId,
  onUpdateSession,
  onRenameSession,
  onClose,
  onForkSession,
  onOpenTerminal,
  terminalOwner = null,
  rightPanelOpen,
  onToggleRightPanel,
  onRegisterHandle,
  showHeader = true,
  composerOnly = false,
}: Props) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAppliedComposerHeightRef = useRef(0);
  const lastComposerValueLengthRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [mention, setMention] = useState<ComposerMention | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [fileMentionRows, setFileMentionRows] = useState<FileMentionRow[]>([]);
  const tools = useTools();
  const {
    activeTab,
    currentContextTokens,
    effectiveContextWindow,
    running,
    showEmptyPrompt,
    visibleQueueItems,
  } = useChatPaneDerivedState({ activeTabId, contextWindow, tabs });
  const [terminalView, setTerminalView] = useState(false);
  const terminalSnapshot = usePersistentTerminalOwners(
    terminalView,
    terminalView ? terminalOwner : null,
  );
  const toggleTerminalView = useCallback(() => {
    setTerminalView((open) => {
      const next = !open;
      if (next && terminalOwner) rememberPersistentTerminalOwner(terminalOwner, { select: true });
      return next;
    });
  }, [terminalOwner]);
  useMountSubscription(() => {
    if (!isFocused) return;
    const onOpenTerminalEvent = (event: Event) => {
      const detail = (event as CustomEvent<OpenTerminalEventDetail>).detail;
      if (!detail?.mountKey) return;
      selectPersistentTerminalOwner(detail.mountKey);
      setTerminalView(true);
    };
    window.addEventListener(OPEN_TERMINAL_EVENT, onOpenTerminalEvent);
    return () => window.removeEventListener(OPEN_TERMINAL_EVENT, onOpenTerminalEvent);
  }, [isFocused]);
  const updateTab = onUpdateSession;
  const {
    attachments,
    setAttachments,
    readingAttachments,
    composerDragActive,
    attachFiles,
    removeAttachment,
    clearAttachments,
    consumeAttachments,
    handleComposerDragOver,
    handleComposerDragLeave,
    handleComposerDrop,
  } = useComposerAttachments({
    activeTab,
    updateTab,
    fileInputRef,
  });
  useChatPaneContextAttachEffect({
    contextAttachRequest: tools.contextAttachRequest,
    isFocused,
    setAttachments,
  });
  useChatPaneMentionEffects({
    cwd,
    mention,
    setFileMentionRows,
    setMentionIndex,
  });
  const {
    displayedSessionTitle,
    sessionPinned,
    togglePinnedSession,
    handlePiSessionIdChange,
    renameActiveSession,
  } = useChatPaneSessionTitle({
    activeTab,
    activeTabId,
    paneId,
    running: Boolean(running),
    onPiSessionIdChange,
    onRenameSession,
  });
  const selectMentionRow = useComposerMentionSelection({
    activeTab,
    mention,
    cwd,
    tools,
    updateTab,
    setAttachments,
    setMention,
    textareaRef,
  });
  const composerInput = activeTab?.input ?? "";
  const resetComposerHeight = useCallback(() => {
    if (textareaRef.current) textareaRef.current.style.height = "";
    lastAppliedComposerHeightRef.current = 0;
    lastComposerValueLengthRef.current = 0;
  }, []);
  useComposerTextareaHeightSync({
    value: composerInput,
    textareaRef,
    lastAppliedComposerHeightRef,
    lastComposerValueLengthRef,
  });
  const { selectedSkills, selectedPromptTemplates, removeLoadedContext } = useComposerLoadedContext(
    { activeTab, tools },
  );
  // Per-session choice wins; a fresh session (no saved level) falls back to the
  // level THIS MODEL was last used at, which is Off until it has one. Reading the
  // per-model store rather than one global default is what stops a level picked on
  // a reasoning model from seeding a fresh session on a model that cannot think
  // (and keeps the Computer side-chat, whose tabs live outside the workspace
  // reducer, on the same footing as the main panes). Issue #277 stands: a new
  // session still does not snap back to a hardcoded level.
  const thinkingLevel = pickThinkingLevel(
    modelThinkingLevels,
    activeTab?.thinkingLevel,
    modelId ? readModelThinkingLevel(browserThinkingStorage(), modelId) : undefined,
  );
  const selectThinkingLevel = useCallback(
    (level: AgentThinkingLevel) => {
      if (!activeTab || running) return;
      // Persist on the session (survives turns + reloads) and file it under the
      // model it was picked FOR, so the next session on that model opens here.
      updateTab(activeTab.id, (session) => ({ ...session, thinkingLevel: level }));
      if (modelId) writeModelThinkingLevel(browserThinkingStorage(), modelId, level);
    },
    [activeTab, modelId, running, updateTab],
  );
  const composerModelSelector = renderComposerModelSelector(modelSelector, {
    reasoningLevel: thinkingLevel,
    reasoningLevels: modelThinkingLevels,
    reasoningDisabled: Boolean(running),
    onSelectReasoning: selectThinkingLevel,
  });
  const networkPolicy = sessionNetworkPolicy(activeTab);
  // The runtime is told only after IT accepted the change (the control refuses
  // to flip on a 409), so what is written here is always a policy the boundary
  // has already agreed to.
  const networkControl = networkControlFor(activeTab, networkPolicy, (policy) => {
    if (!activeTab) return;
    updateTab(activeTab.id, (session) => ({ ...session, networkPolicy: policy }));
  });

  const engine = useSessionEngine({
    tabs,
    activeTabId,
    modelId,
    thinkingLevel,
    toolAccess: "full",
    cwd,
    networkPolicy,
    browserBackend,
    onPiSessionIdChange: handlePiSessionIdChange,
    updateSession: updateTab,
    selectionFor: tools.selectionFor,
  });
  const { compacting, compactSession } = useChatPaneRuntimeHandle({
    activeTab,
    activeTabId,
    engine,
    modelId,
    isFocused,
    onRegisterHandle,
    running: Boolean(running),
  });
  const openComputerStatus = useCallback(() => {
    tools.setComputerTab("status");
    tools.setComputerOpen(true);
  }, [tools]);
  const openBrowserPanel = useCallback(() => {
    tools.setComputerTab("browser");
    tools.setComputerOpen(true);
  }, [tools]);
  const [diffDrawerOpen, setDiffDrawerOpen] = useState(false);
  const openDiffDrawer = useCallback(() => setDiffDrawerOpen(true), []);
  const closeDiffDrawer = useCallback(() => setDiffDrawerOpen(false), []);
  const exportSession = useCallback(() => {
    if (!activeTab) return;
    const markdown = sessionToMarkdown(activeTab.messages, displayedSessionTitle);
    void saveTextFile(
      exportFilenameFromTitle(displayedSessionTitle),
      markdown,
      "text/markdown;charset=utf-8",
    );
  }, [activeTab, displayedSessionTitle]);
  const canExport = Boolean(
    activeTab?.messages.some((message) => message.role !== "system" && message.text.trim()),
  );
  const openTerminalAction = terminalActionFor(terminalOwner, toggleTerminalView, onOpenTerminal);
  const applyTemplate = useCallback(
    (row: ComposerPromptTemplateRef) =>
      activeTab ? applyContextRow(activeTab.id, "promptTemplate", row, tools) : Promise.resolve(),
    [activeTab, tools],
  );
  const applySkill = useCallback(
    (row: ComposerSkillRef) =>
      activeTab ? applyContextRow(activeTab.id, "skill", row, tools) : Promise.resolve(),
    [activeTab, tools],
  );
  // `/skill:<name>` sends Pi's own invocation as the turn message so
  // _expandSkillCommand inlines that SKILL.md for THIS task only. It bypasses
  // buildPromptArgs on purpose: the invocation must be the first token of the
  // message (Pi reads the skill name up to the first space), and this turn
  // carries no armed-skill context by design.
  const runSkillInvocation = useCallback(
    (skill: ComposerSkillRef, args: string) => {
      if (!activeTab || !modelId) return Promise.resolve();
      const text = skillInvocationText(skill, args);
      return engine.submitPrompt({
        text,
        prompt: text,
        displayText: text,
        userText: text,
        targetSessionId: activeTab.id,
        // `skills` is left to the session's current selection on purpose: it
        // feeds runtimeOptionsFingerprint, and overriding it here would restart
        // the runtime for this turn and again for the next one.
      });
    },
    [activeTab, engine, modelId],
  );
  const activeConnectors = useMemo(
    () => tools.selectionFor(activeTab?.id).connectors ?? [],
    [activeTab?.id, tools],
  );
  // `/mcp` is a status command, and the per-session `error` field has no
  // renderer in the transcript — so its answer goes in as an assistant event
  // block, the neutral separator line the timeline already draws.
  const noteInTranscript = useCallback(
    (text: string) => {
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        messages: [
          ...tab.messages,
          {
            id: newId("assistant"),
            role: "assistant" as const,
            text: "",
            blocks: [{ kind: "event" as const, id: newId("event"), text }],
            timestamp: nowLabel(),
          },
        ],
      }));
    },
    [activeTab, updateTab],
  );
  const applyConnectorSelection = useCallback(
    async (connectorIds: string[]) => {
      if (!activeTab) return "Open a chat before changing connectors.";
      const result = await setSessionConnectors(activeTab.id, connectorIds);
      if (result.error) return result.error;
      const current = tools.selectionFor(activeTab.id);
      tools.setSelection(activeTab.id, { ...current, connectors: result.active });
      return null;
    },
    [activeTab, tools],
  );
  const activePiSessionId = piSessionIdOf(activeTab);
  const { goalRevision, goalAction } = useGoalCommand(activePiSessionId);
  const [goalModeOn, setGoalModeOn] = useState(false);
  const handleProjectPicked = useCallback(
    (project: Project) => {
      if (!activeTab || activeTab.messages.length > 0) return;
      updateTab(activeTab.id, (session) => ({
        ...session,
        projectId: project.id,
        cwd: project.path,
      }));
    },
    [activeTab, updateTab],
  );
  const commandRegistry = useMemo(
    () =>
      createComposerCommandRegistry([
        builtinCommandProvider({
          compact: () => void compactSession(),
          openStatus: openComputerStatus,
          openBrowser: openBrowserPanel,
          openPlugins: () => router.push("/integrations"),
          ...(openTerminalAction ? { openTerminal: openTerminalAction } : {}),
          ...(onForkSession ? { forkSession: onForkSession } : {}),
          goal: goalAction,
          enterGoalMode: () => setGoalModeOn(true),
        }),
        ...(canExport && activeTab
          ? [
              transcriptCommandProvider({
                messages: () => activeTab.messages,
                title: () => displayedSessionTitle,
                notify: noteInTranscript,
              }),
            ]
          : []),
        mcpCommandProvider({
          connectors: tools.connectorCatalogue,
          active: activeConnectors,
          apply: applyConnectorSelection,
          notify: noteInTranscript,
        }),
        promptTemplateCommandProvider({
          templates: tools.promptTemplateCatalogue,
          applyTemplate,
        }),
        // The explicit, zero-injection path leads; the legacy `$skill`
        // selected-context provider below still resolves `/<skill-name>` for
        // sessions that already used it.
        skillInvocationCommandProvider({
          skills: tools.skillCatalogue,
          runSkill: runSkillInvocation,
        }),
        skillCommandProvider({ skills: tools.skillCatalogue, applySkill }),
      ]),
    [
      activeConnectors,
      activeTab,
      applyConnectorSelection,
      applySkill,
      applyTemplate,
      canExport,
      compactSession,
      displayedSessionTitle,
      goalAction,
      noteInTranscript,
      onForkSession,
      openBrowserPanel,
      openComputerStatus,
      openTerminalAction,
      router,
      runSkillInvocation,
      tools.connectorCatalogue,
      tools.promptTemplateCatalogue,
      tools.skillCatalogue,
    ],
  );
  const commandContext = useMemo(
    () => ({ running: Boolean(running), compacting }),
    [running, compacting],
  );
  const commandMatches = useMemo(
    () => (mention?.kind === "command" ? commandRegistry.match(mention.query, commandContext) : []),
    [commandContext, commandRegistry, mention],
  );
  const mentionRows = useComposerMentionRows({
    commandRows: commandMatches,
    fileMentionRows,
    mention,
    skillRows: tools.skillCatalogue,
  });
  const { runCommandInvocation, handleSelectMention } = useComposerCommandHandlers({
    activeTab,
    commandRegistry,
    commandContext,
    mention,
    setMention,
    resetComposerHeight,
    textareaRef,
    updateTab,
    selectMentionRow,
  });
  const { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn } =
    useChatPaneSendFlow({
      activeTab,
      attachments,
      clearAttachments,
      consumeAttachments,
      cwd,
      engine,
      modelId,
      modelSupportsVision,
      readingAttachments,
      resetComposerHeight,
      running: Boolean(running),
      setMention,
      setStickToBottom,
      tools,
      updateTab,
    });
  const { handleComposerPaste, handleComposerChange, handleComposerKeyDown } =
    useComposerTextareaBehavior({
      activeTab,
      mention,
      mentionRows,
      mentionIndex,
      hasAttachments: attachments.length > 0,
      running: Boolean(running),
      textareaRef,
      lastAppliedComposerHeightRef,
      lastComposerValueLengthRef,
      resetComposerHeight,
      updateTab,
      setMention,
      setMentionIndex,
      selectMentionRow: handleSelectMention,
      queueMessage,
      abortTurn,
      attachFiles,
    });
  const goalModeApi = useGoalMode({
    goalAction,
    sendMessage,
    goalMode: goalModeOn,
    setGoalMode: setGoalModeOn,
  });
  const handleComposerSubmit = useCallback(
    (event: FormEvent) => {
      if (goalModeApi.submitAsGoal(event, activeTab?.input ?? "")) return;
      const invocation = parseSlashInvocation(activeTab?.input ?? "");
      const commandCanRun = invocation?.name !== "goal" || canRunGoalCommand(activePiSessionId);
      if (invocation && commandCanRun && commandRegistry.find(invocation.name, commandContext)) {
        event.preventDefault();
        void runCommandInvocation(invocation);
        return;
      }
      void sendMessage(event);
    },
    [
      activeTab,
      activePiSessionId,
      commandContext,
      commandRegistry,
      goalModeApi,
      runCommandInvocation,
      sendMessage,
    ],
  );
  const loadEarlierHistory = useCallback(
    () => (activeTabId ? engine.loadEarlier(activeTabId) : Promise.resolve()),
    [activeTabId, engine],
  );
  const { handleTranscript, handleExtensionUiResponse } = useChatPaneComposerActions({
    activeTab,
    updateTab,
    textareaRef,
  });
  const composerVisual = deriveComposerVisual({
    compacting,
    hasMessages: (activeTab?.messages.length ?? 0) > 0,
  });
  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className={chatPaneClassName(composerOnly)}
    >
      <ChatPaneChrome
        extensionUiRequest={activeTab?.extensionUiRequest}
        onExtensionUiRespond={handleExtensionUiResponse}
        showHeader={showHeader}
        terminalView={terminalView}
        terminalSnapshot={terminalSnapshot}
        header={{
          title: displayedSessionTitle,
          pinned: sessionPinned,
          rightPanelOpen,
          canFork: Boolean(onForkSession),
          canClose: Boolean(onClose),
          canExport,
          onTogglePinned: togglePinnedSession,
          onRename: renameActiveSession,
          onFork: onForkSession,
          onOpenTerminal: openTerminalAction,
          terminalOpen: terminalView,
          onExport: exportSession,
          onClose,
          onToggleRightPanel,
        }}
      />
      <ChatTranscript
        composerOnly={composerOnly}
        terminalView={terminalView}
        showEmptyPrompt={showEmptyPrompt}
        activeTab={activeTab}
        stickToBottom={stickToBottom}
        setStickToBottom={setStickToBottom}
        running={Boolean(running)}
        onForkSession={onForkSession}
        loadEarlierHistory={loadEarlierHistory}
      />
      <div className={terminalView ? "hidden" : "contents"}>
        {diffDrawerFor(diffDrawerOpen, {
          cwd: cwd || null,
          gitBranch,
          gitSummary,
          onClose: closeDiffDrawer,
        })}
        {runPanelFor(activeTab, activePiSessionId)}
        {subagentChipsFor(activePiSessionId)}
        <AgentComposerFrame
          attachments={attachments}
          banner={composerVisual.banner}
          browserBackend={browserBackend}
          composerDragActive={composerDragActive}
          contextWindow={effectiveContextWindow}
          currentContextTokens={currentContextTokens}
          cwd={cwd}
          fileInputRef={fileInputRef}
          gitBranch={gitBranch}
          gitSummary={gitSummary}
          input={composerInput}
          mention={mention}
          mentionIndex={mentionIndex}
          mentionRows={mentionRows}
          modelSupportsVision={modelSupportsVision}
          modelSelector={composerModelSelector}
          onAbortTurn={() => void abortTurn()}
          onAttachFiles={(files) => void attachFiles(files)}
          onComposerChange={handleComposerChange}
          onComposerDragLeave={handleComposerDragLeave}
          onComposerDragOver={handleComposerDragOver}
          onComposerDrop={handleComposerDrop}
          onComposerKeyDown={(event) => {
            if (goalModeApi.interceptKeyDown(event)) return;
            handleComposerKeyDown(event);
          }}
          onComposerPaste={handleComposerPaste}
          onEditQueued={editQueued}
          onInitGit={onInitGit}
          onOpenStatus={openComputerStatus}
          onOpenDiff={openDiffDrawer}
          onQueueExpandedChange={setQueueExpanded}
          onRemoveAttachment={removeAttachment}
          onRemoveLoadedContext={removeLoadedContext}
          onRemoveQueued={removeQueued}
          onSelectMention={(entry) => void handleSelectMention(entry)}
          onSteerQueued={(queueId) => void steerQueued(queueId)}
          onSubmit={handleComposerSubmit}
          onTranscript={handleTranscript}
          networkControl={networkControl}
          onToggleBrowserBackend={onToggleBrowserBackend}
          placeholder={goalModeApi.goalPlaceholder ?? composerVisual.placeholder}
          drawer={
            <SessionProjectDrawer
              tabId={activeTabId}
              piSessionId={activePiSessionId}
              revision={goalRevision}
              projectName={projectName}
              cwd={cwd}
              gitBranch={gitBranch}
              gitSummary={gitSummary}
              onInitGit={onInitGit}
              onOpenDiff={openDiffDrawer}
              showProjectRow={composerVisual.showProjectRow}
              running={Boolean(running)}
              onProjectPicked={handleProjectPicked}
              queueItems={visibleQueueItems}
              onEditQueued={editQueued}
              onRemoveQueued={removeQueued}
              onSteerQueued={(queueId) => void steerQueued(queueId)}
            />
          }
          showStatusBar={!composerVisual.showProjectRow}
          promptTemplates={selectedPromptTemplates}
          queueExpanded={queueExpanded}
          queueItems={visibleQueueItems}
          readingAttachments={readingAttachments}
          running={Boolean(running)}
          selectedSkills={selectedSkills}
          shortcutTarget={isFocused && !terminalView}
          status={activeTab?.status}
          textareaRef={textareaRef}
          goalMode={goalModeApi.goalMode}
          onExitGoalMode={goalModeApi.exitGoalMode}
          floating={composerOnly}
          dense={!showHeader && !composerOnly}
        />
      </div>
    </section>
  );
}

/** The pane's fixed furniture: a pending extension prompt, the header, and the
 *  terminal surface that swaps places with the transcript. Kept out of ChatPane
 *  so the container reads as state and wiring rather than layout. */
function ChatPaneChrome({
  extensionUiRequest,
  onExtensionUiRespond,
  showHeader,
  terminalView,
  terminalSnapshot,
  header,
}: {
  extensionUiRequest: SessionTab["extensionUiRequest"];
  onExtensionUiRespond: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
  showHeader: boolean;
  terminalView: boolean;
  terminalSnapshot: TerminalOwnersSnapshot;
  header: ComponentProps<typeof AgentChatPaneHeader>;
}) {
  return (
    <>
      {extensionUiRequest ? (
        <ExtensionUiDialog request={extensionUiRequest} onRespond={onExtensionUiRespond} />
      ) : null}
      {showHeader ? <AgentChatPaneHeader {...header} /> : null}
      <div className={terminalView ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>
        <PersistentTerminals
          active={terminalView}
          activeOwnerKey={terminalSnapshot.activeOwnerKey}
          terminals={terminalSnapshot.owners}
        />
      </div>
    </>
  );
}

/** Remounts per session so the goal poll and project selection never carry
 *  across tabs, and hides project switching while a turn is in flight. */
// The drawer's Interrupt button has no form event of its own, and sendMessage
// only ever uses the event to cancel the browser's native submit.

function SessionProjectDrawer({
  tabId,
  piSessionId,
  showProjectRow,
  running,
  ...rest
}: Omit<ComponentProps<typeof ComposerProjectDrawer>, "canPickProject" | "piSessionId"> & {
  tabId: string | null;
  piSessionId: string | null;
  showProjectRow: boolean;
  running: boolean;
}) {
  return (
    <ComposerProjectDrawer
      key={`${tabId}:${piSessionId ?? "new"}`}
      piSessionId={piSessionId}
      canPickProject={showProjectRow && !running}
      running={running}
      {...rest}
    />
  );
}
