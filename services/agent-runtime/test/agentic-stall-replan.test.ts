import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no `@/` alias from this package.
import {
  DEFAULT_STALL_POLICY,
  errorSignature,
  evaluateStall,
  progressFingerprint,
} from "../src/agentic/stall";
import { createHarness, criterion, driveToSettled, task } from "./support/agentic-harness";

const taskRecord = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "t1",
    runId: "r1",
    planRevision: 1,
    position: 0,
    title: "t",
    description: "d",
    status: "RUNNING",
    dependencies: [],
    acceptance: [criterion("c1")],
    attemptCount: 1,
    agentId: null,
    resultSummary: null,
    evidence: [],
    blocker: null,
    createdAtMs: 0,
    updatedAtMs: 0,
    startedAtMs: null,
    settledAtMs: null,
    ...overrides,
  }) as Parameters<typeof progressFingerprint>[0]["task"];

describe("progress is what changed, not what was said", () => {
  test("two turns that changed nothing share a fingerprint", () => {
    const input = { task: taskRecord(), operations: [], artifacts: [], errorSignature: "e1" };
    expect(progressFingerprint(input)).toBe(progressFingerprint(input));
  });

  test("a newly satisfied criterion changes the fingerprint", () => {
    const before = progressFingerprint({
      task: taskRecord(),
      operations: [],
      artifacts: [],
      errorSignature: null,
    });
    const after = progressFingerprint({
      task: taskRecord({ acceptance: [{ ...criterion("c1"), satisfied: true, evidence: "x" }] }),
      operations: [],
      artifacts: [],
      errorSignature: null,
    });
    expect(after).not.toBe(before);
  });

  test("an error signature ignores the numbers that vary between identical failures", () => {
    expect(errorSignature("timeout after 30s")).toBe(errorSignature("timeout after 45s"));
    expect(errorSignature("timeout")).not.toBe(errorSignature("permission denied"));
    expect(errorSignature(null)).toBeNull();
  });
});

describe("bounded retries, then a replan — never an infinite loop", () => {
  test("a changed fingerprint is progress and resets the counter", () => {
    const first = evaluateStall({
      state: { fingerprint: "a", repeats: 3 },
      fingerprint: "b",
      attemptCount: 4,
      planRevisions: 0,
    });
    expect(first.verdict.kind).toBe("progressing");
    expect(first.state.repeats).toBe(0);
  });

  test("one repeat is a retry, not yet a stall", () => {
    const verdict = evaluateStall({
      state: { fingerprint: "a", repeats: 0 },
      fingerprint: "a",
      attemptCount: 1,
      planRevisions: 0,
    }).verdict;
    expect(verdict.kind).toBe("retry");
  });

  test("the threshold turns repetition into a replan", () => {
    const verdict = evaluateStall({
      state: { fingerprint: "a", repeats: DEFAULT_STALL_POLICY.stallThreshold - 1 },
      fingerprint: "a",
      attemptCount: 2,
      planRevisions: 0,
    }).verdict;
    expect(verdict.kind).toBe("replan");
  });

  test("exhausting the attempt budget triggers a replan even without repetition of the count", () => {
    const verdict = evaluateStall({
      state: { fingerprint: "a", repeats: 0 },
      fingerprint: "a",
      attemptCount: DEFAULT_STALL_POLICY.maxAttemptsPerTask,
      planRevisions: 0,
    }).verdict;
    expect(verdict.kind).toBe("replan");
  });

  test("replanning is itself bounded: past the revision budget the run gives up with a reason", () => {
    const verdict = evaluateStall({
      state: { fingerprint: "a", repeats: 5 },
      fingerprint: "a",
      attemptCount: 9,
      planRevisions: DEFAULT_STALL_POLICY.maxPlanRevisions,
    }).verdict;
    expect(verdict.kind).toBe("give-up");
    if (verdict.kind === "give-up") expect(verdict.reason).toContain("plan revisions");
  });
});

describe("a run that cannot progress replans and then stops, in bounded time", () => {
  test("an agent repeating the same failure produces a plan revision with a diagnostic task", async () => {
    const harness = createHarness({
      model: { contextWindow: 60_000, maxTokens: 8_000 },
      backend: {
        contextWindow: 60_000,
        fallback: () => ({ text: "TASK_BLOCKED the same import error again", outputTokens: 60 }),
      },
    });
    try {
      const { run } = await harness.service.startRun({
        goal: "make the suite green",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("Fix the failing import")],
      });

      const settled = await driveToSettled(harness, run.id, 40);
      expect(settled.status).toBe("FAILED");
      expect(settled.steps).toBeLessThan(40);

      const revisions = harness.store.listEvents(run.id).filter((event) => event.type === "PLAN_REVISED");
      expect(revisions.length).toBeGreaterThanOrEqual(1);
      expect(revisions.length).toBeLessThanOrEqual(DEFAULT_STALL_POLICY.maxPlanRevisions);
      expect(harness.store.listTasks(run.id).some((entry) => entry.title.startsWith("Diagnose:"))).toBe(true);
      expect(harness.store.requireRun(run.id).failureReason).toBeTruthy();
    } finally {
      harness.dispose();
    }
  });

  //
  // Seen against the real card: a replan ends a step without launching, so the
  // previous turn's text was still sitting there and got read a second time —
  // charging two attempts for one piece of work.
  //
  test("a step that does not launch never charges a second attempt for one turn", async () => {
    const harness = createHarness({
      model: { contextWindow: 60_000, maxTokens: 8_000 },
      backend: {
        contextWindow: 60_000,
        fallback: () => ({ text: "TASK_BLOCKED the same import error again", outputTokens: 60 }),
      },
    });
    try {
      const { run } = await harness.service.startRun({
        goal: "make the suite green",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("Fix the failing import")],
      });
      await driveToSettled(harness, run.id, 40);

      const attempts = harness.store
        .listTasks(run.id)
        .reduce((total, entry) => total + entry.attemptCount, 0);
      const started = harness.store
        .listEvents(run.id)
        .filter((event) => event.type === "TASK_STARTED").length;
      expect(attempts).toBe(started);
      expect(harness.backend.turnIndex()).toBe(started);
    } finally {
      harness.dispose();
    }
  });

  test("the revised plan keeps the accepted work and re-points the failing task at the diagnosis", async () => {
    const harness = createHarness({
      model: { contextWindow: 60_000, maxTokens: 8_000 },
      backend: {
        contextWindow: 60_000,
        fallback: () => ({ text: "TASK_BLOCKED still stuck", outputTokens: 60 }),
      },
    });
    try {
      const { run } = await harness.service.startRun({
        goal: "ship the migration",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("Write the migration"), task("Run the migration", ["Write the migration"])],
      });
      await driveToSettled(harness, run.id, 40);

      const tasks = harness.store.listTasks(run.id);
      const diagnosisIds = new Set(
        tasks.filter((entry) => entry.title.startsWith("Diagnose:")).map((entry) => entry.id),
      );
      const original = tasks.find((entry) => entry.title === "Write the migration");
      expect(diagnosisIds.size).toBeGreaterThanOrEqual(1);
      expect(original?.dependencies.some((id) => diagnosisIds.has(id))).toBe(true);
      expect(tasks.find((entry) => entry.title === "Run the migration")).toBeTruthy();
    } finally {
      harness.dispose();
    }
  });
});
