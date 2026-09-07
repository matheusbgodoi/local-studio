import { Effect, Semaphore } from "effect";
import { getGlobalSingleton } from "./instances";
import { applyRuntimeEnvInjections } from "./pi-runtime-helpers";

const startup = getGlobalSingleton("runtimeStartupEnvironment", () => Semaphore.makeUnsafe(1));

export function installRuntimeStartupEnvironment(values: Record<string, string>) {
  return Effect.gen(function* () {
    yield* Effect.acquireRelease(startup.take(1), () => startup.release(1));
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const previous = Object.fromEntries(
          Object.keys(values).map((key) => [key, process.env[key]]),
        );
        applyRuntimeEnvInjections(values);
        return previous;
      }),
      (previous) =>
        Effect.sync(() => {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }),
    );
  });
}
