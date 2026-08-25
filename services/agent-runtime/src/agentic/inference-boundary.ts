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

type InferenceContext = { priority: GatePriority; signal?: AbortSignal };

const active = new AsyncLocalStorage<InferenceContext>();
const installed = new WeakSet<ModelRuntime>();

function leased<T>(source: AsyncIterable<T>, release: () => void): AsyncIterable<T> {
  const wrapped: AsyncIterable<T> & { result?: () => Promise<unknown> } = {
    async *[Symbol.asyncIterator]() {
      try {
        yield* source;
      } finally {
        release();
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
): T {
  return active.run({ priority, ...(signal ? { signal } : {}) }, task);
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
      const release = await sharedInferenceGate().acquire(request.priority, request.signal);
      try {
        return leased(stream(model, context, options), release);
      } catch (error) {
        release();
        throw error;
      }
    })) as ModelRuntime["stream"];

  runtime.streamSimple = ((
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ) =>
    lazyStream(model, async () => {
      const request = active.getStore() ?? { priority: "interactive" as const };
      const release = await sharedInferenceGate().acquire(request.priority, request.signal);
      try {
        return leased(streamSimple(model, context, options), release);
      } catch (error) {
        release();
        throw error;
      }
    })) as ModelRuntime["streamSimple"];
}
