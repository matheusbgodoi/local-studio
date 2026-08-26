"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { CapabilityState } from "@local-studio/contracts/capabilities";
import api from "@/lib/api/client";
import type { LogSession } from "@/lib/types";
import { readPageCache, scopedPageCacheKey, writePageCache } from "@/lib/page-data-cache";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const MAX_RENDERED_LINES = 20_000;
const FAST_LOG_REQUEST = { timeout: 3_000, retries: 0 } as const;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const parseLogEvent = (block: string): { sessionId: string | null; line: string | null } | null => {
  const fields = block.split("\n");
  const event = fields
    .find((field) => field.startsWith("event:"))
    ?.slice(6)
    .trim();
  if (event !== "log") return null;
  const data = fields
    .filter((field) => field.startsWith("data:"))
    .map((field) => field.slice(5).trimStart())
    .join("\n");
  try {
    const payload = JSON.parse(data) as { data?: { session_id?: unknown; line?: unknown } };
    return {
      sessionId: typeof payload.data?.session_id === "string" ? payload.data.session_id : null,
      line: typeof payload.data?.line === "string" ? payload.data.line : null,
    };
  } catch {
    return null;
  }
};

const consumeLogStream = async (
  response: Response,
  signal: AbortSignal,
  onEvent: (event: { sessionId: string | null; line: string | null }) => void,
): Promise<void> => {
  if (!response.ok) throw new Error(`Live log stream returned HTTP ${response.status}`);
  if (!response.body) throw new Error("Live log stream returned no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = parseLogEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) onEvent(event);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
};

export function useLogs(logsCapability: CapabilityState, controllerKey: string) {
  const sessionsCacheKey = scopedPageCacheKey(controllerKey, "logs:sessions");
  // Stale-while-revalidate: paint the last-loaded session list instantly on
  // navigation while the fresh fetch runs in the background.
  const [cachedSessions] = useState(() => readPageCache<LogSession[]>(sessionsCacheKey));
  const [sessions, setSessions] = useState<LogSession[]>(() =>
    logsCapability === "supported" ? (cachedSessions ?? []) : [],
  );
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [contentFilter, setContentFilter] = useState("");
  const [loading, setLoading] = useState(
    logsCapability === "unknown" || (logsCapability === "supported" && cachedSessions === null),
  );
  const [loadingContent, setLoadingContent] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const streamControllerRef = useRef<AbortController | null>(null);
  const selectedLogSession = useMemo(
    () => sessions.find((session) => session.id === selectedSession) ?? null,
    [selectedSession, sessions],
  );
  const streamingAvailable = selectedLogSession?.streaming !== false;

  const loadSessions = useCallback(async () => {
    if (logsCapability !== "supported") return;
    setSessionsError(null);
    try {
      const data = await api.getLogSessions(FAST_LOG_REQUEST);
      writePageCache(sessionsCacheKey, data.sessions || []);
      setSessions(data.sessions || []);
      if (data.sessions?.length > 0) {
        setSelectedSession((current) => current ?? data.sessions[0].id);
      }
    } catch (e) {
      setSessionsError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [logsCapability, sessionsCacheKey]);

  const loadLogContent = useCallback(
    async (sessionId: string, silent = false) => {
      if (logsCapability !== "supported") return;
      if (!silent) setLoadingContent(true);
      setContentError(null);
      try {
        const data = await api.getLogs(sessionId, 2000, FAST_LOG_REQUEST);
        const lines = Array.isArray(data.logs) ? data.logs : [];
        setLogLines(lines);
      } catch (e) {
        setContentError(errorMessage(e));
        setLogLines([]);
      } finally {
        if (!silent) setLoadingContent(false);
      }
    },
    [logsCapability],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (sessionId === "controller" || session?.deletable === false) {
        alert("This log source is read-only.");
        return;
      }
      if (!confirm("Delete this log session?")) return;
      try {
        await api.deleteLogSession(sessionId);
        if (selectedSession === sessionId) {
          setSelectedSession(null);
          setLogLines([]);
        }
        await loadSessions();
      } catch (e) {
        alert("Failed to delete: " + (e as Error).message);
      }
    },
    [loadSessions, selectedSession, sessions],
  );

  const downloadLog = useCallback(() => {
    if (!selectedSession || logLines.length === 0) return;
    const blob = new Blob([logLines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedSession}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logLines, selectedSession]);

  const filteredSessions = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter(
      (session) =>
        session.model?.toLowerCase().includes(query) || session.id.toLowerCase().includes(query),
    );
  }, [filter, sessions]);

  useMountSubscription(() => {
    if (logsCapability === "supported") {
      setLoading(cachedSessions === null);
      void loadSessions();
      return;
    }
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    setSessions([]);
    setSelectedSession(null);
    setLogLines([]);
    setSessionsError(null);
    setContentError(null);
    setStreamError(null);
    setLoading(logsCapability === "unknown");
    setLoadingContent(false);
  }, [cachedSessions, loadSessions, logsCapability]);
  useMountSubscription(() => {
    if (selectedSession) void loadLogContent(selectedSession);
  }, [loadLogContent, selectedSession]);
  useMountSubscription(() => {
    if (logsCapability !== "supported" || !autoRefresh || !selectedSession || !streamingAvailable) {
      streamControllerRef.current?.abort();
      streamControllerRef.current = null;
      return;
    }

    streamControllerRef.current?.abort();
    const controller = new AbortController();
    streamControllerRef.current = controller;
    const url = `/api/proxy/logs/${encodeURIComponent(selectedSession)}/stream?tail=0`;
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(url, {
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          });
          setStreamError(null);
          await consumeLogStream(response, controller.signal, ({ sessionId, line }) => {
            if (!line || (sessionId && sessionId !== selectedSession)) return;
            setLogLines((previous) => {
              const next = [...previous, line];
              return next.length > MAX_RENDERED_LINES ? next.slice(-MAX_RENDERED_LINES) : next;
            });
          });
        } catch (error) {
          if (!controller.signal.aborted) setStreamError(errorMessage(error));
        }
        if (!controller.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
      }
    })();

    return () => {
      controller.abort();
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
    };
  }, [autoRefresh, logsCapability, selectedSession, streamingAvailable]);
  useMountSubscription(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines.length, autoScroll]);
  useMountSubscription(() => {
    if (filteredSessions.length === 0) {
      if (selectedSession) {
        setSelectedSession(null);
        setLogLines([]);
      }
      return;
    }
    if (!selectedSession || !filteredSessions.some((session) => session.id === selectedSession)) {
      setSelectedSession(filteredSessions[0]?.id ?? null);
    }
  }, [filteredSessions, selectedSession]);

  const formatDateTime = (dateValue: string) =>
    new Date(dateValue).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const getLogLineClass = (line: string) => {
    if (line.includes("ERROR") || line.includes("error")) return "text-(--err)";
    if (line.includes("WARNING") || line.includes("warn")) return "text-(--hl3)";
    if (line.includes("INFO")) return "text-(--hl1)";
    if (line.includes("loaded") || line.includes("started") || line.includes("success"))
      return "text-(--hl2)";
    return "text-(--dim)";
  };

  const renderLogs = useCallback(() => {
    const query = contentFilter.trim().toLowerCase();
    const visible = query
      ? logLines.filter((line) => line.toLowerCase().includes(query))
      : logLines;
    return visible.map((line, index) => (
      <div key={index} className={`${getLogLineClass(line)} hover:bg-(--hover) px-2 py-0.5`}>
        {line || "\u00A0"}
      </div>
    ));
  }, [contentFilter, logLines]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
    setSidebarOpen(false);
  }, []);

  return {
    sessions,
    filteredSessions,
    selectedSession,
    hasLogContent: logLines.length > 0,
    filter,
    contentFilter,
    loading,
    loadingContent,
    sessionsError,
    contentError,
    streamError,
    autoScroll,
    autoRefresh,
    streamingAvailable,
    sidebarOpen,
    logRef,
    setFilter,
    setContentFilter,
    setAutoScroll,
    setAutoRefresh,
    setSidebarOpen,
    loadLogContent,
    deleteSession,
    downloadLog,
    renderLogs,
    handleSelectSession,
    formatDateTime,
    setSelectedSession,
  };
}
