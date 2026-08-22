import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no `@/` alias from this package.
import {
  computeContextBudget,
  DEFAULT_CONTEXT_BUDGET_POLICY,
} from "../src/agentic/context-budget";
import { resolveAgenticCapability } from "../src/agentic/capability";
import { applyEvidence, parseTurnReport } from "../src/agentic/turn-report";
import { fakeAgentModel } from "./support/agentic-backend";
import { createHarness, criterion, driveToSettled, task } from "./support/agentic-harness";

//
// Every case below was raised by an adversarial review of the durable runtime
// and confirmed against the code before being fixed. Each one names the state
// the runtime could previously reach and never leave.
//

const GROWTH = { contextGrowth: 1_400, outputTokens: 200 };

describe("a task with nothing to prove is not a task that can never finish", () => {
  test("no acceptance criteria means the claim is the gate", () => {
    const report = parseTurnReport("all done here\nTASK_COMPLETE");
    expect(applyEvidence([], report).satisfied).toBe(true);
    expect(applyEvidence([], parseTurnReport("still working")).satisfied).toBe(false);
  });

  test("a criteria-less task completes the run instead of stalling it into failure", async () => {
    const harness = createHarness({
      model: { contextWindow: 60_000, maxTokens: 8_000 },
      backend: {
        contextWindow: 60_000,
        turns: [{ text: "wrote the file\nTASK_COMPLETE", outputTokens: 80 }],
      },
    });
    try {
      const { run } = await harness.service.startRun({
        goal: "tidy the repository",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [{ title: "Tidy", description: "tidy it", dependencies: [], acceptance: [] }],
      });
      const settled = await driveToSettled(harness, run.id, 12);
      expect(settled.status).toBe("COMPLETED");
      expect(harness.store.listTasks(run.id)[0]?.status).toBe("SUCCEEDED");
    } finally {
      harness.dispose();
    }
  });
});

describe("a run that reached a terminal state during a step is never resurrected", () => {
  test("cancelling mid-step leaves the run cancelled, not RUNNING with no driver", async () => {
    const harness = createHarness({
      model: { contextWindow: 60_000, maxTokens: 8_000 },
      backend: { contextWindow: 60_000, fallback: () => ({ text: "working", outputTokens: 60 }) },
    });
    try {
      const { run } = await harness.service.startRun({
        goal: "long job",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("Work")],
      });

      const step = harness.service.onTurnSettled(run.id);
      harness.store.updateRun(run.id, { status: "CANCELLED", activeTaskId: null });
      const outcome = await step;

      expect(outcome.kind).toBe("idle");
      expect(harness.store.requireRun(run.id).status).toBe("CANCELLED");
    } finally {
      harness.dispose();
    }
  });
});

describe("a run waiting on a human is waiting, not failed", () => {
  test("a restart keeps it WAITING_USER and points at the task that asked", () => {
    const harness = createHarness();
    try {
      const run = harness.store.createRun({
        goal: "g",
        modelId: harness.capability.modelId,
        physicalModelId: harness.capability.physicalModelId,
        behaviorProfile: null,
        contextWindow: harness.capability.contextWindow,
        usableLimit: 5_000,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
      });
      harness.store.recordPlanRevision({
        runId: run.id,
        reason: "initial plan",
        tasks: [task("Ask the owner")],
      });
      const pending = harness.store.listTasks(run.id)[0];
      harness.store.updateTask(pending?.id as string, {
        status: "WAITING_USER",
        blocker: "which credential?",
      });

      const recovered = harness.service.recover();
      expect(recovered.length).toBe(1);
      const restored = harness.store.requireRun(run.id);
      expect(restored.status).toBe("WAITING_USER");
      expect(restored.activeTaskId).toBe(pending?.id as string);
    } finally {
      harness.dispose();
    }
  });

  test("a scheduler step with nothing runnable but a waiting task does not fail the run", async () => {
    const harness = createHarness({
      model: { contextWindow: 60_000, maxTokens: 8_000 },
      backend: {
        contextWindow: 60_000,
        turns: [{ text: "NEEDS_USER which credential?", outputTokens: 50 }],
      },
    });
    try {
      const { run } = await harness.service.startRun({
        goal: "g",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("Ask the owner")],
      });
      await harness.service.onTurnSettled(run.id);
      const again = await harness.service.onTurnSettled(run.id);
      expect(again.kind).toBe("waiting-user");
      expect(harness.store.requireRun(run.id).status).toBe("WAITING_USER");
    } finally {
      harness.dispose();
    }
  });
});

describe("a turn is counted once, and identified by which turn it was", () => {
  test("a step that does not prompt never re-charges the previous turn's tokens", async () => {
    const harness = createHarness({
      model: { contextWindow: 60_000, maxTokens: 8_000 },
      backend: {
        contextWindow: 60_000,
        turns: [{ text: "NEEDS_USER which credential?", outputTokens: 400 }],
      },
    });
    try {
      const { run } = await harness.service.startRun({
        goal: "g",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("Ask the owner")],
      });
      await harness.service.onTurnSettled(run.id);
      const afterFirst = harness.store.requireRun(run.id).cumulativeOutputTokens;
      await harness.service.onTurnSettled(run.id);
      expect(harness.store.requireRun(run.id).cumulativeOutputTokens).toBe(afterFirst);
    } finally {
      harness.dispose();
    }
  });

  test("a model that repeats itself word for word still gets a second turn read", async () => {
    const repeated = `TASK_EVIDENCE c1: proven`;
    const harness = createHarness({
      model: { contextWindow: 60_000, maxTokens: 8_000 },
      backend: {
        contextWindow: 60_000,
        turns: [
          { text: repeated, ...GROWTH },
          { text: repeated, ...GROWTH },
        ],
      },
    });
    try {
      const { run } = await harness.service.startRun({
        goal: "g",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("Work", [], [criterion("c1")]), task("Second", ["Work"], [criterion("c1")])],
      });
      await harness.service.onTurnSettled(run.id);
      await harness.service.onTurnSettled(run.id);
      const tasks = harness.store.listTasks(run.id);
      expect(tasks.every((entry) => entry.status === "SUCCEEDED")).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});

describe("a rejected turn settles its own rows", () => {
  test("the attempt is failed and the task is not left RUNNING", async () => {
    const harness = createHarness({
      model: { contextWindow: 60_000, maxTokens: 8_000 },
      backend: { contextWindow: 60_000, promptError: "the provider refused the request" },
    });
    try {
      const run = harness.service.createRun({
        goal: "g",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("Work")],
      });
      let thrown: unknown = null;
      try {
        await harness.service.onTurnSettled(run.id);
      } catch (error) {
        thrown = error;
      }
      expect(thrown instanceof Error && thrown.message).toContain("refused");

      const current = harness.store.listTasks(run.id)[0];
      expect(current?.status).toBe("PENDING");
      expect(current?.blocker).toContain("refused");
      expect(harness.store.listAttempts(current?.id as string).some((a) => a.status === "RUNNING")).toBe(
        false,
      );
      expect(harness.store.listAgents(run.id)[0]?.status).toBe("INTERRUPTED");
    } finally {
      harness.dispose();
    }
  });
});

describe("compaction counters count the same thing", () => {
  test("a refused compaction leaves both the run and its agent where they were", async () => {
    const harness = createHarness({
      model: { contextWindow: 9_000, maxTokens: 2_000 },
      backend: {
        contextWindow: 9_000,
        compactionError: "Nothing to compact (session too small)",
        fallback: (index) => ({ text: `TASK_EVIDENCE c${index + 1}: proven`, ...GROWTH }),
      },
    });
    try {
      const criteria = Array.from({ length: 10 }, (_, index) => criterion(`c${index + 1}`));
      const { run } = await harness.service.startRun({
        goal: "g",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("Work", [], criteria)],
      });
      for (let turn = 0; turn < 10; turn += 1) await harness.service.onTurnSettled(run.id);
      expect(harness.store.listEvents(run.id).filter((e) => e.type === "COMPACTION_REFUSED").length)
        .toBeGreaterThan(0);
      expect(harness.store.listAgents(run.id)[0]?.compactionCount).toBe(
        harness.store.requireRun(run.id).compactionCount,
      );
    } finally {
      harness.dispose();
    }
  });
});

describe("the budget refuses to produce a limit nothing can fit in", () => {
  test("a fractional override is floored away rather than collapsing the budget to zero", () => {
    const capability = resolveAgenticCapability(fakeAgentModel({ contextWindow: 131_072 }));
    const budget = computeContextBudget(capability, {
      ...DEFAULT_CONTEXT_BUDGET_POLICY,
      usableContextOverride: 0.5,
    });
    expect(budget.overridden).toBe(false);
    expect(budget.usableLimit).toBeGreaterThan(0);
  });

  test("every declared window leaves a positive usable limit", () => {
    for (const contextWindow of [2_048, 4_096, 8_192, 32_768, 1_048_576]) {
      const budget = computeContextBudget(
        resolveAgenticCapability(fakeAgentModel({ contextWindow, maxTokens: contextWindow })),
      );
      expect(budget.usableLimit).toBeGreaterThan(0);
    }
  });
});
