import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { createHarness, criterion, driveToSettled, task } from "./support/agentic-harness";

const CRITERIA = Array.from({ length: 8 }, (_, index) => criterion(`c${index + 1}`));
const GROWTH = { contextGrowth: 900, outputTokens: 200 };

//
// The script follows the plan: the first task owns one criterion, the second
// owns eight, and a satisfied criterion set completes a task on its own — the
// word "complete" is never what decides it.
//
// The fallback models what a resumed model does with a rebuilt working set:
// it reads which criteria are still outstanding and supplies them. The turn
// that was in flight when the process died loses its evidence, which is the
// honest outcome of a crash, so without this the run would legitimately stall.
//
const progressingBackend = () => ({
  contextWindow: 9_000,
  turns: [
    { text: "TASK_EVIDENCE migration-applied: schema at revision 7", ...GROWTH },
    ...CRITERIA.map((entry) => ({ text: `TASK_EVIDENCE ${entry.id}: proven`, ...GROWTH })),
  ],
  fallback: () => ({
    text: CRITERIA.map((entry) => `TASK_EVIDENCE ${entry.id}: proven`).join("\n"),
    ...GROWTH,
  }),
});

const twoTaskPlan = () => [
  task("Database changes", [], [criterion("migration-applied")]),
  task("Backend implementation", ["Database changes"], CRITERIA),
];

//
// The process is killed by throwing the store away and opening a new one on
// the same directory. Nothing is carried across in memory, which is the point:
// whatever survives had to be on disk.
//
const withRestart = async (
  body: (dir: string, boot: (startIndex?: number) => ReturnType<typeof createHarness>) => Promise<void>,
) => {
  const dir = mkdtempSync(path.join(tmpdir(), "agentic-crash-"));
  const boot = (startIndex = 0) =>
    createHarness({
      dir,
      model: { contextWindow: 9_000, maxTokens: 2_000 },
      backend: { ...progressingBackend(), startIndex },
    });
  try {
    await body(dir, boot);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("a restart finds the run, keeps what was finished and redoes nothing that was", () => {
  test("an unfinished run is discoverable after the process dies", async () => {
    await withRestart(async (_dir, boot) => {
      const first = boot();
      const { run } = await first.service.startRun({
        goal: "ship the migration",
        capability: first.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: twoTaskPlan(),
      });
      await first.service.onTurnSettled(run.id);
      first.store.close();

      const second = boot();
      try {
        const unfinished = second.store.listUnfinishedRuns();
        expect(unfinished.map((entry) => entry.id)).toContain(run.id);
        expect(unfinished[0]?.goal).toBe("ship the migration");
      } finally {
        second.dispose();
      }
    });
  });

  test("completed tasks stay completed and the interrupted one is reset, never completed", async () => {
    await withRestart(async (_dir, boot) => {
      const first = boot();
      const { run } = await first.service.startRun({
        goal: "ship the migration",
        capability: first.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: twoTaskPlan(),
      });
      await first.service.onTurnSettled(run.id);
      const done = first.store.listTasks(run.id).find((entry) => entry.status === "SUCCEEDED");
      expect(done?.title).toBe("Database changes");
      first.store.close();

      const second = boot();
      try {
        const recovery = second.service.recover();
        expect(recovery[0]?.preservedTasks).toContain(done?.id as string);
        expect(recovery[0]?.interruptedAgents).toBe(1);
        expect(recovery[0]?.resetTasks.length).toBe(1);

        const tasks = second.store.listTasks(run.id);
        expect(tasks.find((entry) => entry.id === done?.id)?.status).toBe("SUCCEEDED");
        expect(tasks.find((entry) => entry.title === "Backend implementation")?.status).not.toBe(
          "SUCCEEDED",
        );
        expect(second.store.listAgents(run.id)[0]?.status).toBe("INTERRUPTED");
        expect(second.store.requireRun(run.id).status).toBe("PAUSED");
        expect(second.store.requireRun(run.id).recoveryState).toContain("preserved");
      } finally {
        second.dispose();
      }
    });
  });

  test("after recovery the run resumes and finishes without the owner intervening", async () => {
    await withRestart(async (_dir, boot) => {
      const first = boot();
      const { run } = await first.service.startRun({
        goal: "ship the migration",
        capability: first.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: twoTaskPlan(),
      });
      for (let turn = 0; turn < 3; turn += 1) await first.service.onTurnSettled(run.id);
      const compactionsBefore = first.store.requireRun(run.id).compactionCount;
      const cumulativeBefore = first.store.requireRun(run.id).cumulativeOutputTokens;
      const consumedTurns = first.backend.turnIndex();
      first.store.close();

      const second = boot(consumedTurns);
      try {
        second.service.recover();
        const settled = await driveToSettled(second, run.id, 40);
        expect(settled.status).toBe("COMPLETED");
        const finished = second.store.requireRun(run.id);
        expect(finished.compactionCount).toBeGreaterThanOrEqual(compactionsBefore);
        expect(finished.cumulativeOutputTokens).toBeGreaterThan(cumulativeBefore);
        expect(second.store.listTasks(run.id).every((entry) => entry.status === "SUCCEEDED")).toBe(true);
      } finally {
        second.dispose();
      }
    });
  });

  test("a checkpoint written before the crash is still there, with its working set", async () => {
    await withRestart(async (_dir, boot) => {
      const first = boot();
      const { run } = await first.service.startRun({
        goal: "ship the migration",
        capability: first.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: twoTaskPlan(),
      });
      for (let turn = 0; turn < 6; turn += 1) await first.service.onTurnSettled(run.id);
      const checkpoints = first.store.listCheckpoints(run.id).length;
      expect(checkpoints).toBeGreaterThan(0);
      first.store.close();

      const second = boot();
      try {
        const restored = second.store.listCheckpoints(run.id);
        expect(restored.length).toBe(checkpoints);
        expect(restored[0]?.workingSet.goal).toBe("ship the migration");
        expect(restored[0]?.workingSet.acceptance.length).toBeGreaterThan(0);
      } finally {
        second.dispose();
      }
    });
  });
});

describe("a side effect caught in flight is reconciled, never replayed", () => {
  test("an interrupted side-effecting operation becomes UNKNOWN and is listed for reconciliation", async () => {
    await withRestart(async (_dir, boot) => {
      const first = boot();
      const { run } = await first.service.startRun({
        goal: "ship the migration",
        capability: first.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: twoTaskPlan(),
      });
      const taskId = first.store.listTasks(run.id)[0]?.id as string;
      first.store.reserveOperation({
        idempotencyKey: "commit-1",
        runId: run.id,
        taskId,
        attemptId: null,
        action: "git.commit",
        request: { message: "apply migration" },
        sideEffecting: true,
      });
      first.store.markOperationStarted("commit-1");
      first.store.close();

      const second = boot();
      try {
        const recovery = second.service.recover();
        expect(recovery[0]?.operationsNeedingReconciliation).toContain("commit-1");
        expect(second.store.getOperation("commit-1")?.status).toBe("UNKNOWN");

        const again = second.store.reserveOperation({
          idempotencyKey: "commit-1",
          runId: run.id,
          taskId,
          attemptId: null,
          action: "git.commit",
          request: { message: "apply migration" },
          sideEffecting: true,
        });
        expect(again.kind).toBe("reconcile");
      } finally {
        second.dispose();
      }
    });
  });

  test("an operation that committed before the crash is served from the ledger, not redone", async () => {
    await withRestart(async (_dir, boot) => {
      const first = boot();
      const { run } = await first.service.startRun({
        goal: "ship the migration",
        capability: first.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: twoTaskPlan(),
      });
      const taskId = first.store.listTasks(run.id)[0]?.id as string;
      first.store.reserveOperation({
        idempotencyKey: "deploy-1",
        runId: run.id,
        taskId,
        attemptId: null,
        action: "deploy",
        request: { target: "staging" },
        sideEffecting: true,
      });
      first.store.commitOperation("deploy-1", { result: { url: "https://staging" } });
      first.store.close();

      const second = boot();
      try {
        second.service.recover();
        const replay = second.store.reserveOperation({
          idempotencyKey: "deploy-1",
          runId: run.id,
          taskId,
          attemptId: null,
          action: "deploy",
          request: { target: "staging" },
          sideEffecting: true,
        });
        expect(replay.kind).toBe("cached");
        expect(replay.operation.result).toEqual({ url: "https://staging" });
        expect(second.service.recover()[0]?.operationsNeedingReconciliation).toEqual([]);
      } finally {
        second.dispose();
      }
    });
  });
});
