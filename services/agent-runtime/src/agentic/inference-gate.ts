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

type Waiter = { start: () => void };

export type GateOptions = { waitMs?: number };

export type InferenceGate = {
  run: <T>(priority: GatePriority, task: () => Promise<T>, options?: GateOptions) => Promise<T>;
  depth: () => { interactive: number; background: number; busy: boolean };
};

//
// How long an interactive turn will wait for the card before going ahead
// anyway. A turn can legitimately stay open for minutes — a tool asking the
// owner a question, a long build — and wedging every other conversation behind
// it is a worse failure than a brief overlap on a server that queues requests
// itself. Background work has no such escape: a Run always waits its turn.
//
export const INTERACTIVE_MAX_WAIT_MS = 20_000;

export function createPriorityInferenceGate(): InferenceGate {
  const interactive: Waiter[] = [];
  const background: Waiter[] = [];
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
    run<T>(priority: GatePriority, task: () => Promise<T>, options?: GateOptions): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        let started = false;
        const begin = (holdsSlot: boolean) => {
          if (started) return;
          started = true;
          void (async () => {
            try {
              resolve(await task());
            } catch (error) {
              reject(error);
            } finally {
              if (holdsSlot) release();
            }
          })();
        };

        const waiter: Waiter = { start: () => begin(true) };
        if (priority === "interactive") interactive.push(waiter);
        else background.push(waiter);

        const waitMs = options?.waitMs ?? (priority === "interactive" ? INTERACTIVE_MAX_WAIT_MS : 0);
        if (waitMs > 0) {
          const timer = setTimeout(() => {
            const queue = priority === "interactive" ? interactive : background;
            const index = queue.indexOf(waiter);
            if (index === -1) return;
            queue.splice(index, 1);
            begin(false);
          }, waitMs);
          if (typeof timer === "object" && timer && "unref" in timer) {
            (timer as { unref: () => void }).unref();
          }
        }
        pump();
      });
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
