"use client";

import { browserSessionPath } from "@shared/agent/browser-session";
import { effectTimeout, type EffectTimer } from "@/lib/effect-timers";

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type BrowserPaneState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

type FramePayload = {
  ok: boolean;
  error?: string;
  data?: { frame: string | null } & BrowserPaneState;
};

type Props = {
  sessionId?: string;

  url: string;
  onState: (state: BrowserPaneState) => void;

  onUnavailable: (error: string) => void;

  visible?: boolean;
};

const VIEWPORT_MIN = { width: 320, height: 240 };
const VIEWPORT_MAX = { width: 1920, height: 1200 };
const POLL_INTERVAL_MS = 110;
const MOVE_THROTTLE_MS = 33;

function postBrowser(path: string, body: unknown, sessionId?: string): void {
  void fetch(browserSessionPath(`/api/agent/browser/${path}`, sessionId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

export function ScreencastSurface({
  sessionId,
  url,
  onState,
  onUnavailable,
  visible = true,
}: Props) {
  const postScopedBrowser = useCallback(
    (path: string, body: unknown) => postBrowser(path, body, sessionId),
    [sessionId],
  );
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const serverUrlRef = useRef<string>("");
  const viewportRef = useRef({ width: 1280, height: 800 });
  const lastMoveAtRef = useRef(0);
  const onStateRef = useRef(onState);
  const onUnavailableRef = useRef(onUnavailable);

  useMountSubscription(() => {
    onStateRef.current = onState;
    onUnavailableRef.current = onUnavailable;
  }, [onState, onUnavailable]);

  useMountSubscription(() => {
    if (!visible) return;
    let disposed = false;
    let timer: EffectTimer | null = null;

    const tick = async () => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = effectTimeout(() => void tick(), 1_000);
        return;
      }
      try {
        const response = await fetch(browserSessionPath("/api/agent/browser/frame", sessionId), {
          cache: "no-store",
        });
        if (response.status === 503) {
          const payload = (await response.json().catch(() => null)) as FramePayload | null;
          onUnavailableRef.current(payload?.error || "Browser unavailable");
          return;
        }
        const payload = (await response.json()) as FramePayload;
        if (!disposed && payload.ok && payload.data) {
          if (payload.data.frame) setFrameSrc(`data:image/jpeg;base64,${payload.data.frame}`);
          serverUrlRef.current = payload.data.url;
          onStateRef.current({
            url: payload.data.url,
            title: payload.data.title,
            canGoBack: payload.data.canGoBack,
            canGoForward: payload.data.canGoForward,
          });
        }
      } catch {}
      if (!disposed) timer = effectTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      disposed = true;
      if (timer) timer.cancel();
    };
  }, [visible, sessionId]);

  useMountSubscription(() => {
    const target = url.trim();
    if (!target || target === serverUrlRef.current) return;
    let cancelled = false;
    void fetch(browserSessionPath("/api/agent/browser/navigate", sessionId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: target }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { ok: boolean; error?: string };
        if (cancelled) return;
        setNavError(payload.ok ? null : (payload.error ?? "Navigation failed"));
      })
      .catch((error) => {
        if (!cancelled) {
          setNavError(error instanceof Error ? error.message : "Navigation failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url, sessionId]);

  useMountSubscription(() => {
    if (!container) return;
    let timer: EffectTimer | null = null;
    const sync = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.round(
        Math.min(VIEWPORT_MAX.width, Math.max(VIEWPORT_MIN.width, rect.width)),
      );
      const height = Math.round(
        Math.min(VIEWPORT_MAX.height, Math.max(VIEWPORT_MIN.height, rect.height)),
      );
      if (width === viewportRef.current.width && height === viewportRef.current.height) return;
      viewportRef.current = { width, height };
      postScopedBrowser("viewport", { width, height });
    };
    const observer = new ResizeObserver(() => {
      if (timer) timer.cancel();
      timer = effectTimeout(sync, 250);
    });
    observer.observe(container);
    sync();
    return () => {
      if (timer) timer.cancel();
      observer.disconnect();
    };
  }, [container, postScopedBrowser]);

  const toViewport = (event: { clientX: number; clientY: number }) => {
    const rect = container?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * viewportRef.current.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * viewportRef.current.height),
    };
  };

  const buttonName = (button: number) =>
    button === 1 ? "middle" : button === 2 ? "right" : "left";

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    container?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = toViewport(event);
    postScopedBrowser("input", {
      kind: "mouse",
      type: "down",
      x,
      y,
      button: buttonName(event.button),
      clickCount: Math.max(1, event.detail),
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { x, y } = toViewport(event);
    postScopedBrowser("input", {
      kind: "mouse",
      type: "up",
      x,
      y,
      button: buttonName(event.button),
      clickCount: Math.max(1, event.detail),
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const now = Date.now();
    if (now - lastMoveAtRef.current < MOVE_THROTTLE_MS) return;
    lastMoveAtRef.current = now;
    const { x, y } = toViewport(event);
    postScopedBrowser("input", { kind: "mouse", type: "move", x, y });
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const { x, y } = toViewport(event);
    postScopedBrowser("input", { kind: "wheel", x, y, deltaX: event.deltaX, deltaY: event.deltaY });
  };

  const handleKey = (type: "down" | "up") => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey) return;
    event.preventDefault();
    postScopedBrowser("input", { kind: "key", type, key: event.key, code: event.code });
  };

  return (
    <div
      ref={setContainer}
      tabIndex={0}
      role="application"
      aria-label="Live browser"
      className="relative size-full min-h-0 overflow-hidden bg-white outline-none"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onWheel={handleWheel}
      onKeyDown={handleKey("down")}
      onKeyUp={handleKey("up")}
      onContextMenu={(event) => event.preventDefault()}
    >
      {frameSrc ? (
        <img
          src={frameSrc}
          alt=""
          draggable={false}
          className="size-full select-none object-contain"
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-(--bg) text-xs text-(--dim)">
          Connecting to browser…
        </div>
      )}
      {navError ? (
        <div className="absolute left-2 top-2 max-w-[80%] truncate rounded-md border border-(--err)/40 bg-(--bg)/95 px-2 py-1 text-xs text-(--err)">
          {navError}
        </div>
      ) : null}
    </div>
  );
}
