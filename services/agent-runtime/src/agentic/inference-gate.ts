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

export type InferenceGate = {
  run: <T>(priority: GatePriority, task: () => Promise<T>) => Promise<T>;
  depth: () => { interactive: number; background: number; busy: boolean };
};

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
    run<T>(priority: GatePriority, task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const waiter: Waiter = {
          start: () => {
            void (async () => {
              try {
                resolve(await task());
              } catch (error) {
                reject(error);
              } finally {
                release();
              }
            })();
          },
        };
        if (priority === "interactive") interactive.push(waiter);
        else background.push(waiter);
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
