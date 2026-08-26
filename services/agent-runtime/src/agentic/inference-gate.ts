//
// One card, one decode at a time — and the owner never waits behind the night's
// work.
//
// The scheduler serialising its own turns is not enough: a chat turn goes down
// the ordinary prompt path, so without a process-wide gate an interactive
// message and a Run's turn could decode at the same time on one GPU. Both paths
// queue here instead.
//
// Interactive work is taken first. That is the difference between a queue and a
// fair queue: an overnight Run must not make the owner wait minutes to be
// answered, and a Run losing a few seconds to a person costs nothing.
//

import { getGlobalSingleton } from "../instances";

export type GatePriority = "interactive" | "background";

type QueuedWaiter = { start: () => void };

export type InferenceGate = {
  acquire: (priority: GatePriority, signal?: AbortSignal) => Promise<() => void>;
  run: <T>(priority: GatePriority, task: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
  depth: () => { interactive: number; background: number; busy: boolean };
};

export function createPriorityInferenceGate(): InferenceGate {
  const interactive: QueuedWaiter[] = [];
  const background: QueuedWaiter[] = [];
  let busy = false;

  const pump = (): void => {
    if (busy) return;
    const next = interactive.shift() ?? background.shift();
    if (!next) return;
    busy = true;
    next.start();
  };

  const release = (): void => {
    busy = false;
    pump();
  };

  return {
    acquire(priority: GatePriority, signal?: AbortSignal): Promise<() => void> {
      return new Promise<() => void>((resolve, reject) => {
        let settled = false;
        const queue = priority === "interactive" ? interactive : background;
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        const onAbort = () => {
          if (settled) return;
          settled = true;
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
          cleanup();
          reject(signal?.reason ?? new Error("Inference request cancelled"));
        };
        const waiter: QueuedWaiter = {
          start: () => {
            if (settled) return;
            settled = true;
            cleanup();
            let released = false;
            resolve(() => {
              if (released) return;
              released = true;
              release();
            });
          },
        };
        queue.push(waiter);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
        else pump();
      });
    },
    async run<T>(priority: GatePriority, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      const releaseLease = await this.acquire(priority, signal);
      try {
        return await task();
      } finally {
        releaseLease();
      }
    },
    depth: () => ({ interactive: interactive.length, background: background.length, busy }),
  };
}

//
// Process-wide, because the card is. Both the chat path and every Run share it.
//
export function sharedInferenceGate(): InferenceGate {
  return getGlobalSingleton("agenticInferenceGate", createPriorityInferenceGate);
}
