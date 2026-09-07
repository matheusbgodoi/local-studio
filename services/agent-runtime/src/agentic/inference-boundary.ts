import { AsyncLocalStorage } from "node:async_hooks";
import {
  lazyStream,
  type Api,
  type Context,
  type Model,
  type ModelsApiStreamOptions,
  type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { sharedInferenceGate, type GatePriority } from "./inference-gate";
import type {
  InferenceActivityObserver,
  InferenceActivityToken,
} from "./inference-activity";

type InferenceContext = {
  priority: GatePriority;
  signal?: AbortSignal;
  observer?: InferenceActivityObserver;
};

const active = new AsyncLocalStorage<InferenceContext>();
const installed = new WeakSet<ModelRuntime>();

function outputStarted(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const event = value as {
    type?: unknown;
    delta?: unknown;
    content?: unknown;
    toolCall?: unknown;
  };
  if (
    (event.type === "text_delta" ||
      event.type === "thinking_delta" ||
      event.type === "toolcall_delta") &&
    typeof event.delta === "string" &&
    event.delta.length > 0
  ) {
    return true;
  }
  if (
    (event.type === "text_end" || event.type === "thinking_end") &&
    typeof event.content === "string" &&
    event.content.length > 0
  ) {
    return true;
  }
  return event.type === "toolcall_end" && Boolean(event.toolCall);
}

function leased<T>(
  source: AsyncIterable<T>,
  release: () => void,
  observer: InferenceActivityObserver | undefined,
  token: InferenceActivityToken,
): AsyncIterable<T> {
  let generating = false;
  const wrapped: AsyncIterable<T> & { result?: () => Promise<unknown> } = {
    async *[Symbol.asyncIterator]() {
      try {
        for await (const event of source) {
          if (!generating && outputStarted(event)) {
            generating = true;
            observer?.generating(token);
          }
          yield event;
        }
      } finally {
        release();
        observer?.settled(token);
      }
    },
  };
  const result = (source as { result?: () => Promise<unknown> }).result;
  if (typeof result === "function") wrapped.result = () => result.call(source);
  return wrapped;
}

export function withInferenceContext<T>(
  priority: GatePriority,
  signal: AbortSignal | undefined,
  task: () => T,
  observer?: InferenceActivityObserver,
): T {
  return active.run({ priority, ...(signal ? { signal } : {}), ...(observer ? { observer } : {}) }, task);
}

async function openLeasedStream<T>(
  source: () => AsyncIterable<T>,
  request: InferenceContext,
): Promise<AsyncIterable<T>> {
  const token: InferenceActivityToken = {};
  request.observer?.queued(token);
  let release: (() => void) | undefined;
  try {
    release = await sharedInferenceGate().acquire(request.priority, request.signal);
    return leased(source(), release, request.observer, token);
  } catch (error) {
    release?.();
    request.observer?.settled(token);
    throw error;
  }
}

export function installInferenceBoundary(runtime: ModelRuntime): void {
  if (installed.has(runtime)) return;
  installed.add(runtime);

  const stream = runtime.stream.bind(runtime);
  const streamSimple = runtime.streamSimple.bind(runtime);

  runtime.stream = (<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ) =>
    lazyStream(model, async () => {
      const request = active.getStore() ?? { priority: "interactive" as const };
      return openLeasedStream(() => stream(model, context, options), {
        ...request,
        signal: request.signal ?? options?.signal,
      });
    })) as ModelRuntime["stream"];

  runtime.streamSimple = ((
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ) =>
    lazyStream(model, async () => {
      const request = active.getStore() ?? { priority: "interactive" as const };
      return openLeasedStream(() => streamSimple(model, context, options), {
        ...request,
        signal: request.signal ?? options?.signal,
      });
    })) as ModelRuntime["streamSimple"];
}
