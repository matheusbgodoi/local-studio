import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { createHarness, criterion, driveToSettled, task } from "./support/agentic-harness";

//
// The acceptance condition the P0 handoff names: an unfinished task survives
// context pressure and the SAME task resumes automatically, more than once,
// with nobody typing "continue".
//
// The scripted agent makes genuine progress — one acceptance criterion per
// turn — while the context grows past the budget several times over. Progress
// matters: a turn that changed nothing is a stall, and a stall is supposed to
// replan rather than spin (that rule is pinned in agentic-stall-replan).
//
const CRITERIA = Array.from({ length: 12 }, (_, index) => criterion(`c${index + 1}`));
const GROWTH = { contextGrowth: 900, outputTokens: 200 };

const longTaskBackend = () => ({
  contextWindow: 9_000,
  turns: [
    ...CRITERIA.map((entry) => ({ text: `TASK_EVIDENCE ${entry.id}: verified by command output`, ...GROWTH })),
    { text: "TASK_COMPLETE", ...GROWTH },
  ],
});

const startLongTask = (harness: ReturnType<typeof createHarness>) =>
  harness.service.startRun({
    goal: "refactor the authentication platform",
    capability: harness.capability,
    sessionId: "session-1",
    piSessionId: "pi-1",
    cwd: "/tmp/project",
    tasks: [task("Backend implementation", [], CRITERIA)],
  });

const smallWindow = () => ({ model: { contextWindow: 9_000, maxTokens: 2_000 }, backend: longTaskBackend() });

describe("context pressure checkpoints, compacts and resumes the same task by itself", () => {
  test("one unfinished task is carried through at least three compactions and then completes", async () => {
    const harness = createHarness(smallWindow());
    try {
      const { run } = await startLongTask(harness);
      const taskId = harness.store.listTasks(run.id)[0]?.id as string;

      let sawRunningAfterCompaction = 0;
      for (let turn = 0; turn < 20; turn += 1) {
        const compactionsBefore = harness.store.listCheckpoints(run.id).length;
        await harness.service.onTurnSettled(run.id);
        const current = harness.store.requireTask(taskId);
        if (harness.store.listCheckpoints(run.id).length > compactionsBefore && current.status === "RUNNING") {
          sawRunningAfterCompaction += 1;
        }
      }

      expect(harness.store.listCheckpoints(run.id).length).toBeGreaterThanOrEqual(3);
      expect(sawRunningAfterCompaction).toBeGreaterThanOrEqual(3);
      expect(harness.store.requireTask(taskId).status).toBe("SUCCEEDED");
      expect(harness.store.requireRun(run.id).status).toBe("COMPLETED");
    } finally {
      harness.dispose();
    }
  });

  test("every compaction lowers the active context and numbers its checkpoint", async () => {
    const harness = createHarness(smallWindow());
    try {
      const { run } = await startLongTask(harness);
      await driveToSettled(harness, run.id, 20);

      const checkpoints = harness.store.listCheckpoints(run.id);
      expect(checkpoints.length).toBeGreaterThanOrEqual(3);
      checkpoints.forEach((checkpoint, index) => {
        expect(checkpoint.sequence).toBe(index + 1);
        expect(checkpoint.tokensAfter).toBeLessThan(checkpoint.tokensBefore);
        expect(checkpoint.usableLimit).toBe(harness.store.requireRun(run.id).usableLimit);
        expect(checkpoint.workingSet.goal).toBe("refactor the authentication platform");
      });
      expect(harness.store.requireRun(run.id).compactionCount).toBe(checkpoints.length);
    } finally {
      harness.dispose();
    }
  });

  test("no turn is a human typing continue: every prompt is the rebuilt working set", async () => {
    const harness = createHarness(smallWindow());
    try {
      const { run } = await startLongTask(harness);
      await driveToSettled(harness, run.id, 20);

      expect(harness.backend.promptsSent.length).toBeGreaterThanOrEqual(CRITERIA.length);
      for (const prompt of harness.backend.promptsSent) {
        expect(prompt).toContain("GOAL: refactor the authentication platform");
        expect(prompt).toContain("CURRENT TASK: Backend implementation");
        expect(prompt).toContain("NEXT ACTION:");
        expect(prompt.trim().toLowerCase()).not.toBe("continue");
      }
    } finally {
      harness.dispose();
    }
  });

  test("cumulative token counters never reset, while the active context does", async () => {
    const harness = createHarness(smallWindow());
    try {
      const { run } = await startLongTask(harness);
      let previousCumulative = 0;
      let previousActive = 0;
      let sawContextDrop = false;

      for (let turn = 0; turn < 20; turn += 1) {
        await harness.service.onTurnSettled(run.id);
        const current = harness.store.requireRun(run.id);
        const cumulative = current.cumulativeInputTokens + current.cumulativeOutputTokens;
        expect(cumulative).toBeGreaterThanOrEqual(previousCumulative);
        previousCumulative = cumulative;
        const active = harness.backend.activeTokens();
        if (active < previousActive) sawContextDrop = true;
        previousActive = active;
      }

      expect(sawContextDrop).toBe(true);
      expect(previousCumulative).toBeGreaterThan(0);
      expect(harness.store.listCheckpoints(run.id).length).toBeGreaterThanOrEqual(3);
    } finally {
      harness.dispose();
    }
  });

  test("the rebuilt working set carries the evidence already earned, so it is never re-earned", async () => {
    const harness = createHarness(smallWindow());
    try {
      const { run } = await startLongTask(harness);
      await driveToSettled(harness, run.id, 20);

      const checkpoints = harness.store.listCheckpoints(run.id);
      const last = checkpoints[checkpoints.length - 1];
      const satisfied = last?.workingSet.acceptance.filter((entry) => entry.satisfied) ?? [];
      expect(satisfied.length).toBeGreaterThan(0);
      expect(satisfied[0]?.evidence).toBe("verified by command output");

      const lastPrompt = harness.backend.promptsSent[harness.backend.promptsSent.length - 1] ?? "";
      expect(lastPrompt).toContain("verified by command output");
      expect(lastPrompt).toContain("(satisfied)");
    } finally {
      harness.dispose();
    }
  });

  test("a compaction that creates no headroom fails with a diagnostic instead of looping", async () => {
    const harness = createHarness({
      model: { contextWindow: 9_000, maxTokens: 2_000 },
      backend: { ...longTaskBackend(), baseTokens: 6_000, ineffectiveCompaction: true },
    });
    try {
      const { run } = await startLongTask(harness);
      const settled = await driveToSettled(harness, run.id, 40);
      expect(settled.status).toBe("FAILED");
      expect(harness.store.requireRun(run.id).failureReason).toContain("compact in a circle");
    } finally {
      harness.dispose();
    }
  });

  test("a window wide enough for the whole run compacts nothing and still finishes", async () => {
    const harness = createHarness({
      model: { contextWindow: 262_144, maxTokens: 32_768 },
      backend: { ...longTaskBackend(), contextWindow: 262_144 },
    });
    try {
      const { run } = await startLongTask(harness);
      const settled = await driveToSettled(harness, run.id, 20);
      expect(settled.status).toBe("COMPLETED");
      expect(harness.store.listCheckpoints(run.id).length).toBe(0);
    } finally {
      harness.dispose();
    }
  });
});

describe("a run finishes on evidence, and only on evidence", () => {
  test("the word complete without the evidence is rejected and the task stays open", async () => {
    const harness = createHarness({
      model: { contextWindow: 40_000, maxTokens: 4_000 },
      backend: {
        contextWindow: 40_000,
        turns: [{ text: "TASK_COMPLETE", outputTokens: 50 }, { text: "still working", outputTokens: 50 }],
      },
    });
    try {
      const { run } = await startLongTask(harness);
      await harness.service.onTurnSettled(run.id);
      const rejected = harness.store
        .listEvents(run.id)
        .filter((event) => event.type === "ACCEPTANCE_REJECTED");
      expect(rejected.length).toBe(1);
      expect(rejected[0]?.summary).toContain("c1");
      expect(harness.store.requireRun(run.id).status).toBe("RUNNING");
    } finally {
      harness.dispose();
    }
  });

  test("WAITING_USER is reached only when the agent genuinely asks a human", async () => {
    const harness = createHarness({
      model: { contextWindow: 40_000, maxTokens: 4_000 },
      backend: {
        contextWindow: 40_000,
        turns: [{ text: "NEEDS_USER which staging credential should I use?", outputTokens: 50 }],
      },
    });
    try {
      const { run } = await startLongTask(harness);
      const step = await harness.service.onTurnSettled(run.id);
      expect(step.kind).toBe("waiting-user");
      expect(harness.store.requireRun(run.id).status).toBe("WAITING_USER");
      expect(harness.store.listTasks(run.id)[0]?.blocker).toContain("staging credential");
    } finally {
      harness.dispose();
    }
  });

  test("a compaction never completes a run, cancels a task or idles the agent forever", async () => {
    const harness = createHarness(smallWindow());
    try {
      const { run } = await startLongTask(harness);
      for (let turn = 0; turn < 6; turn += 1) await harness.service.onTurnSettled(run.id);

      expect(harness.store.listCheckpoints(run.id).length).toBeGreaterThan(0);
      const current = harness.store.requireRun(run.id);
      expect(current.status).toBe("RUNNING");
      expect(harness.store.listTasks(run.id).some((entry) => entry.status === "CANCELLED")).toBe(false);
      expect(harness.store.listAgents(run.id)[0]?.status).toBe("WORKING");
    } finally {
      harness.dispose();
    }
  });
});
