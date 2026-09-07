import { EventEmitter } from "node:events";
import * as undici from "undici";
import { LOCAL_BACKEND_HTTP_IDLE_TIMEOUT_MS } from "../../../shared/agent/context-headroom";

const ignoreDispatcherError = (): void => {};

function withErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreDispatcherError);
  }
  return dispatcher;
}

function createClient(origin: string | URL, options: object): undici.Dispatcher {
  return withErrorListener(new undici.Client(origin, options as undici.Client.Options));
}

function createOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const poolOptions = options as undici.Pool.Options;
  if (poolOptions.connections === 1) return createClient(origin, poolOptions);
  return withErrorListener(new undici.Pool(origin, { ...poolOptions, factory: createClient }));
}

let configuredTimeoutMs: number | null = null;

export function configureInferenceHttpTimeout(
  timeoutMs: number = LOCAL_BACKEND_HTTP_IDLE_TIMEOUT_MS,
): number | null {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return configuredTimeoutMs;
  if (configuredTimeoutMs === timeoutMs) return configuredTimeoutMs;
  const normalized = Math.floor(timeoutMs);
  undici.setGlobalDispatcher(
    withErrorListener(
      new undici.EnvHttpProxyAgent({
        allowH2: false,
        bodyTimeout: normalized,
        headersTimeout: normalized,
        clientFactory: createClient,
        factory: createOriginDispatcher,
      }),
    ),
  );
  undici.install?.();
  configuredTimeoutMs = normalized;
  return configuredTimeoutMs;
}

export function inferenceHttpTimeoutMs(): number | null {
  return configuredTimeoutMs;
}
