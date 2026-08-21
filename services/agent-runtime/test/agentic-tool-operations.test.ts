import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { estimateTokens } from "../src/agentic/store-operations";
import { buildWorkingSet, renderWorkingSet } from "../src/agentic/working-set";
import { createHarness, criterion, task } from "./support/agentic-harness";

const startRun = (harness: ReturnType<typeof createHarness>) =>
  harness.service.startRun({
    goal: "deploy the service",
    capability: harness.capability,
    sessionId: "s",
    piSessionId: "p",
    cwd: "/tmp/p",
    tasks: [task("Deploy", [], [criterion("deployed")])],
  });

const harnessOptions = {
  model: { contextWindow: 60_000, maxTokens: 8_000 },
  backend: { contextWindow: 60_000, fallback: () => ({ text: "working", outputTokens: 60 }) },
};

describe("a side effect is reserved once and committed once", () => {
  test("the first reservation is granted and the ledger records the request it was granted for", async () => {
    const harness = createHarness(harnessOptions);
    try {
      const { run } = await startRun(harness);
      const taskId = harness.store.listTasks(run.id)[0]?.id as string;
      const first = harness.store.reserveOperation({
        idempotencyKey: "op-1",
        runId: run.id,
        taskId,
        attemptId: null,
        action: "git.commit",
        request: { message: "ship" },
        sideEffecting: true,
      });
      expect(first.kind).toBe("reserved");
      expect(first.operation.status).toBe("PLANNED");
      expect(first.operation.sideEffecting).toBe(true);
      expect(first.operation.requestHash).toHaveLength(64);
    } finally {
      harness.dispose();
    }
  });

  test("a committed operation is served from the ledger instead of being run again", async () => {
    const harness = createHarness(harnessOptions);
    try {
      const { run } = await startRun(harness);
      const taskId = harness.store.listTasks(run.id)[0]?.id as string;
      const reserve = () =>
        harness.store.reserveOperation({
          idempotencyKey: "op-2",
          runId: run.id,
          taskId,
          attemptId: null,
          action: "deploy",
          request: { target: "prod" },
          sideEffecting: true,
        });
      reserve();
      harness.store.commitOperation("op-2", { result: { revision: 42 }, externalState: "live" });
      const replay = reserve();
      expect(replay.kind).toBe("cached");
      expect(replay.operation.result).toEqual({ revision: 42 });
      expect(replay.operation.externalState).toBe("live");
    } finally {
      harness.dispose();
    }
  });

  test("the same key with a different request is a mismatch, not a silent overwrite", async () => {
    const harness = createHarness(harnessOptions);
    try {
      const { run } = await startRun(harness);
      const taskId = harness.store.listTasks(run.id)[0]?.id as string;
      harness.store.reserveOperation({
        idempotencyKey: "op-3",
        runId: run.id,
        taskId,
        attemptId: null,
        action: "deploy",
        request: { target: "staging" },
        sideEffecting: true,
      });
      const clashing = harness.store.reserveOperation({
        idempotencyKey: "op-3",
        runId: run.id,
        taskId,
        attemptId: null,
        action: "deploy",
        request: { target: "production" },
        sideEffecting: true,
      });
      expect(clashing.kind).toBe("mismatch");
    } finally {
      harness.dispose();
    }
  });

  test("a read-only operation caught mid-flight is simply retried; a side-effecting one is not", async () => {
    const harness = createHarness(harnessOptions);
    try {
      const { run } = await startRun(harness);
      const taskId = harness.store.listTasks(run.id)[0]?.id as string;
      const base = { runId: run.id, taskId, attemptId: null, request: { path: "/etc" } };

      harness.store.reserveOperation({ ...base, idempotencyKey: "read-1", action: "fs.read", sideEffecting: false });
      harness.store.markOperationStarted("read-1");
      expect(
        harness.store.reserveOperation({ ...base, idempotencyKey: "read-1", action: "fs.read", sideEffecting: false })
          .kind,
      ).toBe("reserved");

      harness.store.reserveOperation({ ...base, idempotencyKey: "write-1", action: "fs.write", sideEffecting: true });
      harness.store.markOperationStarted("write-1");
      expect(
        harness.store.reserveOperation({ ...base, idempotencyKey: "write-1", action: "fs.write", sideEffecting: true })
          .kind,
      ).toBe("reconcile");
    } finally {
      harness.dispose();
    }
  });

  test("a failed operation may be retried, because nothing was committed", async () => {
    const harness = createHarness(harnessOptions);
    try {
      const { run } = await startRun(harness);
      const taskId = harness.store.listTasks(run.id)[0]?.id as string;
      const input = {
        idempotencyKey: "op-4",
        runId: run.id,
        taskId,
        attemptId: null,
        action: "deploy",
        request: { target: "prod" },
        sideEffecting: true,
      };
      harness.store.reserveOperation(input);
      harness.store.failOperation("op-4", "connection refused");
      const retry = harness.store.reserveOperation(input);
      expect(retry.kind).toBe("reserved");
      expect(retry.operation.externalState).toBe("connection refused");
    } finally {
      harness.dispose();
    }
  });
});

describe("a large payload is externalised, not re-pasted into every request", () => {
  const bigLog = Array.from({ length: 4_000 }, (_, index) => `line ${index} of the build log`).join("\n");

  test("the artifact keeps the whole payload while context gets a pointer and a preview", async () => {
    const harness = createHarness(harnessOptions);
    try {
      const { run } = await startRun(harness);
      const taskId = harness.store.listTasks(run.id)[0]?.id as string;
      const artifact = harness.store.recordArtifact({
        runId: run.id,
        taskId,
        kind: "log",
        label: "build.log",
        mediaType: "text/plain",
        provenance: "npm run build",
        content: bigLog,
      });

      expect(artifact.byteSize).toBe(Buffer.byteLength(bigLog, "utf8"));
      expect(artifact.tokenEstimate).toBe(estimateTokens(bigLog));
      expect(artifact.digest).toHaveLength(64);
      expect(artifact.preview.length).toBeLessThan(bigLog.length / 5);
      expect(artifact.preview).toContain("characters externalised");
      expect(artifact.provenance).toBe("npm run build");
    } finally {
      harness.dispose();
    }
  });

  test("a slice of the payload is retrievable later, so nothing is lost by externalising it", async () => {
    const harness = createHarness(harnessOptions);
    try {
      const { run } = await startRun(harness);
      const artifact = harness.store.recordArtifact({
        runId: run.id,
        taskId: null,
        kind: "log",
        label: "build.log",
        mediaType: "text/plain",
        provenance: "npm run build",
        content: bigLog,
      });
      expect(harness.store.readArtifactSlice(artifact.id, 0, 12)).toBe(bigLog.slice(0, 12));
      expect(harness.store.readArtifactSlice(artifact.id, 100, 20)).toBe(bigLog.slice(100, 120));
      expect(harness.store.readArtifactSlice("artifact_missing")).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  test("the working set carries the reference and never the payload", async () => {
    const harness = createHarness(harnessOptions);
    try {
      const { run } = await startRun(harness);
      const currentTask = harness.store.listTasks(run.id)[0];
      harness.store.recordArtifact({
        runId: run.id,
        taskId: currentTask?.id ?? null,
        kind: "log",
        label: "build.log",
        mediaType: "text/plain",
        provenance: "npm run build",
        content: bigLog,
      });
      const rendered = renderWorkingSet(
        buildWorkingSet({
          run: harness.store.requireRun(run.id),
          tasks: harness.store.listTasks(run.id),
          activeTask: currentTask ?? null,
          operations: harness.store.listOperations(run.id),
          artifacts: harness.store.listArtifacts(run.id),
          events: harness.store.listEvents(run.id),
          recentTail: [],
          unresolvedErrors: [],
        }),
      );
      expect(rendered).toContain("build.log");
      expect(rendered).toContain("do not re-paste");
      expect(rendered.length).toBeLessThan(bigLog.length / 10);
      expect(rendered).not.toContain("line 3999 of the build log");
    } finally {
      harness.dispose();
    }
  });

  test("a tool call still awaiting its result survives into the rebuilt context as a pairing to settle", async () => {
    const harness = createHarness(harnessOptions);
    try {
      const { run } = await startRun(harness);
      const currentTask = harness.store.listTasks(run.id)[0];
      harness.store.reserveOperation({
        idempotencyKey: "op-pending",
        runId: run.id,
        taskId: currentTask?.id as string,
        attemptId: null,
        action: "db.migrate",
        request: { revision: 7 },
        sideEffecting: true,
      });
      harness.store.markOperationStarted("op-pending");

      const workingSet = buildWorkingSet({
        run: harness.store.requireRun(run.id),
        tasks: harness.store.listTasks(run.id),
        activeTask: currentTask ?? null,
        operations: harness.store.listOperations(run.id),
        artifacts: harness.store.listArtifacts(run.id),
        events: harness.store.listEvents(run.id),
        recentTail: [],
        unresolvedErrors: [],
      });
      expect(workingSet.pendingToolCalls).toEqual([
        { idempotencyKey: "op-pending", action: "db.migrate", status: "STARTED" },
      ]);
      expect(renderWorkingSet(workingSet)).toContain("AWAITING RECONCILIATION");
    } finally {
      harness.dispose();
    }
  });
});
