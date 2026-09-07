import { afterEach, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExecutionPolicy } from "../../../shared/agent/execution-policy";
import { piRuntimeManager } from "../src/pi-runtime";
import { readSessionExecutionPolicy, sessionSubagentLink } from "../src/session-metadata-store";
import { listSubagents, runSubagent } from "../src/subagents";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture(
  executionPolicy: ExecutionPolicy = {
    behaviorProfile: "uncensored",
    networkPolicy: "vpn_protected",
  },
) {
  const dir = mkdtempSync(path.join(tmpdir(), "subagent-lifecycle-"));
  writeFileSync(path.join(dir, "api-settings.json"), "{}");
  const previous = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = dir;
  const parentId = randomUUID();
  const childId = randomUUID();
  const modelId =
    executionPolicy.behaviorProfile === "uncensored" ? "qwen-uncensored" : "qwen-daily";
  const parent = piRuntimeManager.getSession(parentId);
  const child = piRuntimeManager.getSession(childId);
  const parentStatus = {
    ...parent.status,
    running: true,
    piSessionId: parentId,
    modelId,
    cwd: dir,
    behaviorProfile: executionPolicy.behaviorProfile,
    networkPolicy: executionPolicy.networkPolicy,
  };
  const childStatus = {
    ...child.status,
    running: true,
    piSessionId: childId,
    modelId,
    cwd: dir,
    behaviorProfile: executionPolicy.behaviorProfile,
    networkPolicy: executionPolicy.networkPolicy,
  };
  Object.defineProperty(parent, "status", { configurable: true, get: () => parentStatus });
  Object.defineProperty(child, "status", { configurable: true, get: () => childStatus });
  const options = spyOn(parent, "getStartOptions").mockReturnValue({
    toolAccess: "read_only",
    networkPolicy: executionPolicy.networkPolicy,
    executionPolicy,
    browserSessionId: "parent-browser",
  });
  const lookup = spyOn(piRuntimeManager, "getSessionForLookup").mockReturnValue({
    sessionId: childId,
    session: child,
  });
  const start = spyOn(child, "ensureStarted").mockResolvedValue();
  const abort = spyOn(child, "abortStrict").mockResolvedValue();
  const stop = spyOn(child, "stop").mockImplementation(async () => {
    childStatus.running = false;
  });
  const prompt = spyOn(child, "prompt").mockImplementation(async () => {
    expect(sessionSubagentLink(childId)?.parentSessionId).toBe(parentId);
  });
  cleanups.push(async () => {
    for (const mock of [options, lookup, start, abort, stop, prompt]) mock.mockRestore();
    delete (parent as unknown as Record<string, unknown>).status;
    delete (child as unknown as Record<string, unknown>).status;
    await parent.stop();
    await child.stop();
    piRuntimeManager.releaseSession(parentId, parent);
    piRuntimeManager.releaseSession(childId, child);
    if (previous === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return { parentId, childId, start, abort, stop, prompt, executionPolicy };
}

async function assertNestedInheritance(executionPolicy: ExecutionPolicy) {
  const f = fixture(executionPolicy);
  const grandchildId = randomUUID();
  const grandchild = piRuntimeManager.getSession(grandchildId);
  const modelId =
    executionPolicy.behaviorProfile === "uncensored" ? "qwen-uncensored" : "qwen-daily";
  const child = piRuntimeManager.getSession(f.childId);
  const childOptions = spyOn(child, "getStartOptions").mockReturnValue({
    toolAccess: "read_only",
    networkPolicy: executionPolicy.networkPolicy,
    executionPolicy,
    browserSessionId: f.childId,
  });
  const grandchildStatus = {
    ...grandchild.status,
    running: true,
    piSessionId: grandchildId,
    modelId,
    cwd: path.dirname(process.cwd()),
    behaviorProfile: executionPolicy.behaviorProfile,
    networkPolicy: executionPolicy.networkPolicy,
  };
  Object.defineProperty(grandchild, "status", {
    configurable: true,
    get: () => grandchildStatus,
  });
  const originalLookup = spyOn(piRuntimeManager, "getSessionForLookup");
  originalLookup.mockRestore();
  const nestedLookup = spyOn(piRuntimeManager, "getSessionForLookup")
    .mockReturnValueOnce({ sessionId: f.childId, session: child })
    .mockReturnValueOnce({ sessionId: grandchildId, session: grandchild });
  const grandchildStart = spyOn(grandchild, "ensureStarted").mockResolvedValue();
  const grandchildPrompt = spyOn(grandchild, "prompt").mockResolvedValue();
  const grandchildAbort = spyOn(grandchild, "abortStrict").mockResolvedValue();
  const grandchildStop = spyOn(grandchild, "stop").mockImplementation(async () => {
    grandchildStatus.running = false;
  });
  f.prompt.mockImplementation(async () => {
    await runSubagent({ parentPiSessionId: f.childId, name: "nested", task: "inspect nested" });
  });
  cleanups.push(async () => {
    for (const mock of [
      childOptions,
      nestedLookup,
      grandchildStart,
      grandchildPrompt,
      grandchildAbort,
      grandchildStop,
    ]) {
      mock.mockRestore();
    }
    delete (grandchild as unknown as Record<string, unknown>).status;
    await grandchild.stop();
    piRuntimeManager.releaseSession(grandchildId, grandchild);
  });

  await runSubagent({ parentPiSessionId: f.parentId, name: "child", task: "inspect child" });

  expect(f.start.mock.calls[0]?.[0]).toBe(modelId);
  expect(f.start.mock.calls[0]?.[3]?.executionPolicy).toEqual(executionPolicy);
  expect(f.start.mock.calls[0]?.[3]?.networkPolicy).toBe(executionPolicy.networkPolicy);
  expect(grandchildStart.mock.calls[0]?.[0]).toBe(modelId);
  expect(grandchildStart.mock.calls[0]?.[3]?.executionPolicy).toEqual(executionPolicy);
  expect(grandchildStart.mock.calls[0]?.[3]?.networkPolicy).toBe(executionPolicy.networkPolicy);
  expect(f.prompt.mock.calls[0]?.[2]?.inferencePriority).toBe("background");
  expect(readSessionExecutionPolicy(f.childId)).toEqual(executionPolicy);
  expect(readSessionExecutionPolicy(grandchildId)).toEqual(executionPolicy);
}

test("standard direct policy reaches child, grandchild, and background inference", async () => {
  await assertNestedInheritance({ behaviorProfile: "standard", networkPolicy: "direct" });
});

test("uncensored VPN policy reaches child, grandchild, and background inference", async () => {
  await assertNestedInheritance({ behaviorProfile: "uncensored", networkPolicy: "vpn_protected" });
});

test("child inherits restrictions, gets an independent browser, and persists ownership before inference", async () => {
  const f = fixture();
  await runSubagent({ parentPiSessionId: f.parentId, name: "audit", task: "inspect only" });
  const options = f.start.mock.calls[0]?.[3];
  expect(options?.toolAccess).toBe("read_only");
  expect(options?.executionPolicy).toEqual(f.executionPolicy);
  expect(options?.browserSessionId).not.toBe("parent-browser");
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(listSubagents(f.parentId)[0]?.status).toBe("done");
});

test("request cancellation aborts a running child and releases its runtime", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.prompt.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        f.abort.mockImplementation(async () => {
          resolve();
        });
        controller.abort();
      }),
  );
  await expect(
    runSubagent({ parentPiSessionId: f.parentId, name: "cancel", task: "wait" }, controller.signal),
  ).rejects.toThrow();
  expect(f.abort).toHaveBeenCalled();
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(listSubagents(f.parentId)[0]?.status).toBe("interrupted");
});

test("failed startup still disposes the child without entering inference", async () => {
  const f = fixture();
  f.start.mockRejectedValue(new Error("offline startup"));
  await expect(
    runSubagent({ parentPiSessionId: f.parentId, name: "failure", task: "inspect" }),
  ).rejects.toThrow("offline startup");
  expect(f.prompt).not.toHaveBeenCalled();
  expect(f.stop).toHaveBeenCalledTimes(1);
});
