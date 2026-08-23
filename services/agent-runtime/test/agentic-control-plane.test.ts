import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no `@/` alias from this package.
import {
  MAX_AGENTS_PER_RUN,
  MAX_CRITERIA_PER_TASK,
  MAX_TASKS_PER_PLAN,
  validateProgress,
  validateProposal,
} from "../src/agentic/control-plane";
import { createRunFromPlan, reportProgressForTask, revisePlanForRun } from "../src/agentic/control-service";
import { createHarness } from "./support/agentic-harness";

const goodPlan = () => ({
  goal: "refactor the authentication platform",
  tasks: [
    { title: "Inspect", description: "read it", acceptance: ["a map of the call sites exists"] },
    {
      title: "Refactor",
      description: "change it",
      dependsOn: ["Inspect"],
      acceptance: ["the suite is green", "no call site still uses the old helper"],
    },
  ],
});

const ok = <T>(value: T | { ok: false; reason: string }): T => {
  if (value && typeof value === "object" && "ok" in value && (value as { ok: unknown }).ok === false) {
    throw new Error(`expected a valid proposal, got: ${(value as { reason: string }).reason}`);
  }
  return value as T;
};

describe("the model proposes; the runtime decides whether the proposal is a plan", () => {
  test("a well-formed plan is accepted and every id is the runtime's", () => {
    const validated = ok(validateProposal(goodPlan()));
    expect(validated.goal).toBe("refactor the authentication platform");
    expect(validated.seeds.map((seed) => seed.title)).toEqual(["Inspect", "Refactor"]);
    expect(validated.seeds[1]?.dependencies).toEqual(["Inspect"]);
    expect(validated.seeds[0]?.acceptance[0]?.id).toBe("t1c1");
    expect(validated.seeds[1]?.acceptance.map((entry) => entry.id)).toEqual(["t2c1", "t2c2"]);
  });

  test("a cycle is rejected with the cycle named, not committed and discovered later", () => {
    const outcome = validateProposal({
      goal: "g",
      tasks: [
        { title: "A", acceptance: ["x"], dependsOn: ["B"] },
        { title: "B", acceptance: ["x"], dependsOn: ["A"] },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("not a DAG");
  });

  test("a dependency on a task outside the plan is rejected", () => {
    const outcome = validateProposal({
      goal: "g",
      tasks: [{ title: "A", acceptance: ["x"], dependsOn: ["Ghost"] }],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("Ghost");
  });

  test("a task with no acceptance criteria is rejected, because nothing could ever finish it", () => {
    const outcome = validateProposal({ goal: "g", tasks: [{ title: "A", acceptance: [] }] });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("acceptance criterion");
  });

  test("over-planning is bounded, so a trivial request cannot become a twelve-task DAG", () => {
    const many = Array.from({ length: MAX_TASKS_PER_PLAN + 1 }, (_, index) => ({
      title: `T${index}`,
      acceptance: ["x"],
    }));
    const outcome = validateProposal({ goal: "g", tasks: many });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain(String(MAX_TASKS_PER_PLAN));

    const criteria = Array.from({ length: MAX_CRITERIA_PER_TASK + 1 }, (_, i) => `c${i}`);
    const tooMany = validateProposal({ goal: "g", tasks: [{ title: "A", acceptance: criteria }] });
    expect(tooMany.ok).toBe(false);

    const agents = Array.from({ length: MAX_AGENTS_PER_RUN + 1 }, (_, i) => ({ name: `A${i}` }));
    const tooManyAgents = validateProposal({ ...goodPlan(), agents });
    expect(tooManyAgents.ok).toBe(false);
  });

  test("two tasks with one title, and an empty plan, are both rejected", () => {
    expect(
      validateProposal({ goal: "g", tasks: [{ title: "A", acceptance: ["x"] }, { title: "A", acceptance: ["y"] }] }).ok,
    ).toBe(false);
    expect(validateProposal({ goal: "g", tasks: [] }).ok).toBe(false);
    expect(validateProposal({ tasks: [{ title: "A", acceptance: ["x"] }] }).ok).toBe(false);
  });

  test("an agent assigned a task outside the plan is rejected", () => {
    const outcome = validateProposal({ ...goodPlan(), agents: [{ name: "Backend", tasks: ["Ghost"] }] });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("Ghost");
  });
});

describe("committing a validated plan is the runtime's, not the model's", () => {
  test("a plan becomes a Run with tasks, an agent and revision 1", () => {
    const harness = createHarness();
    try {
      const committed = createRunFromPlan(harness.store, {
        plan: ok(validateProposal(goodPlan())),
        capability: harness.capability,
        sessionId: "chat-1",
        piSessionId: "pi-1",
        cwd: "/tmp/project",
      });
      expect(committed.run.goal).toBe("refactor the authentication platform");
      expect(committed.run.planRevision).toBe(1);
      expect(committed.tasks.map((task) => task.title)).toEqual(["Inspect", "Refactor"]);
      expect(committed.agents.length).toBe(1);
      expect(committed.tasks.every((task) => task.agentId === committed.agents[0]?.id)).toBe(true);
      const refactor = committed.tasks[1];
      expect(refactor?.dependencies).toEqual([committed.tasks[0]?.id as string]);
    } finally {
      harness.dispose();
    }
  });

  test("named agents each get their own row and own the tasks they were given", () => {
    const harness = createHarness();
    try {
      const committed = createRunFromPlan(harness.store, {
        plan: ok(
          validateProposal({
            ...goodPlan(),
            agents: [
              { name: "Scout", role: "reading", tasks: ["Inspect"] },
              { name: "Builder", role: "changing", tasks: ["Refactor"] },
            ],
          }),
        ),
        capability: harness.capability,
        sessionId: "chat-1",
        piSessionId: null,
        cwd: "/tmp/project",
      });
      expect(committed.agents.map((agent) => agent.name)).toEqual(["Scout", "Builder"]);
      const byTitle = new Map(committed.tasks.map((task) => [task.title, task] as const));
      const byName = new Map(committed.agents.map((agent) => [agent.name, agent] as const));
      expect(byTitle.get("Inspect")?.agentId).toBe(byName.get("Scout")?.id as string);
      expect(byTitle.get("Refactor")?.agentId).toBe(byName.get("Builder")?.id as string);
      expect(new Set(committed.agents.map((agent) => agent.physicalModelId)).size).toBe(1);
    } finally {
      harness.dispose();
    }
  });

  test("a revision keeps the work already accepted and raises the revision number", () => {
    const harness = createHarness();
    try {
      const committed = createRunFromPlan(harness.store, {
        plan: ok(validateProposal(goodPlan())),
        capability: harness.capability,
        sessionId: "chat-1",
        piSessionId: null,
        cwd: "/tmp/project",
      });
      const inspect = committed.tasks[0];
      harness.store.updateTask(inspect?.id as string, { status: "SUCCEEDED", resultSummary: "mapped" });

      const revised = revisePlanForRun(harness.store, {
        runId: committed.run.id,
        reason: "the helper is used by a second package too",
        plan: ok(
          validateProposal({
            goal: committed.run.goal,
            tasks: [
              { title: "Inspect", acceptance: ["a map of the call sites exists"] },
              { title: "Refactor", dependsOn: ["Inspect"], acceptance: ["the suite is green"] },
              { title: "Second package", dependsOn: ["Refactor"], acceptance: ["it builds"] },
            ],
          }),
        ),
        capability: harness.capability,
      });

      expect(revised.run.planRevision).toBe(2);
      expect(revised.tasks.map((task) => task.title)).toEqual(["Inspect", "Refactor", "Second package"]);
      expect(revised.tasks[0]?.status).toBe("SUCCEEDED");
      expect(revised.tasks[0]?.resultSummary).toBe("mapped");
      expect(harness.store.listEvents(committed.run.id).some((event) => event.type === "REPLAN")).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});

//
// Both of these were found by an adversarial review of the revision path, and
// both would have cost the owner real work: the first makes a model re-prove
// what it already proved (which the stall detector then reads as no progress),
// and the second leaves the scheduler working on a task the plan no longer has.
//
describe("a revision changes the plan without discarding what was already true", () => {
  const twoTasks = () =>
    validateProposal({
      goal: "g",
      tasks: [
        { title: "Keep", acceptance: ["alpha", "beta"] },
        { title: "Drop", acceptance: ["gamma"] },
      ],
    });

  test("evidence earned against a criterion survives a revision that keeps it", () => {
    const harness = createHarness();
    try {
      const committed = createRunFromPlan(harness.store, {
        plan: ok(twoTasks()),
        capability: harness.capability,
        sessionId: "s",
        piSessionId: null,
        cwd: "/tmp/p",
      });
      const keep = committed.tasks[0];
      reportProgressForTask(harness.store, {
        runId: committed.run.id,
        taskId: keep?.id as string,
        report: ok(validateProgress({ evidence: [{ criterion: "t1c1", evidence: "alpha proven" }] })),
        turnId: 1,
      });

      revisePlanForRun(harness.store, {
        runId: committed.run.id,
        reason: "drop one",
        plan: ok(validateProposal({ goal: "g", tasks: [{ title: "Keep", acceptance: ["alpha", "beta"] }] })),
        capability: harness.capability,
      });

      const after = harness.store.requireTask(keep?.id as string);
      const alpha = after.acceptance.find((criterion) => criterion.description === "alpha");
      expect(alpha?.satisfied).toBe(true);
      expect(alpha?.evidence).toBe("alpha proven");
      expect(after.acceptance.find((criterion) => criterion.description === "beta")?.satisfied).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  test("a criterion the revision rewrote starts unproven, because it is a different claim", () => {
    const harness = createHarness();
    try {
      const committed = createRunFromPlan(harness.store, {
        plan: ok(twoTasks()),
        capability: harness.capability,
        sessionId: "s",
        piSessionId: null,
        cwd: "/tmp/p",
      });
      const keep = committed.tasks[0];
      reportProgressForTask(harness.store, {
        runId: committed.run.id,
        taskId: keep?.id as string,
        report: ok(validateProgress({ evidence: [{ criterion: "t1c1", evidence: "alpha proven" }] })),
        turnId: 1,
      });
      revisePlanForRun(harness.store, {
        runId: committed.run.id,
        reason: "the bar moved",
        plan: ok(
          validateProposal({ goal: "g", tasks: [{ title: "Keep", acceptance: ["alpha, and twice over"] }] }),
        ),
        capability: harness.capability,
      });
      const after = harness.store.requireTask(keep?.id as string);
      expect(after.acceptance.length).toBe(1);
      expect(after.acceptance[0]?.satisfied).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  test("a task the revision dropped stops being work, and says why", () => {
    const harness = createHarness();
    try {
      const committed = createRunFromPlan(harness.store, {
        plan: ok(twoTasks()),
        capability: harness.capability,
        sessionId: "s",
        piSessionId: null,
        cwd: "/tmp/p",
      });
      const dropped = committed.tasks[1];
      revisePlanForRun(harness.store, {
        runId: committed.run.id,
        reason: "that turned out to be unnecessary",
        plan: ok(validateProposal({ goal: "g", tasks: [{ title: "Keep", acceptance: ["alpha", "beta"] }] })),
        capability: harness.capability,
      });

      const after = harness.store.requireTask(dropped?.id as string);
      expect(after.status).toBe("CANCELLED");
      expect(after.blocker).toContain("revision");
    } finally {
      harness.dispose();
    }
  });

  test("work already finished is not cancelled just because the plan moved on", () => {
    const harness = createHarness();
    try {
      const committed = createRunFromPlan(harness.store, {
        plan: ok(twoTasks()),
        capability: harness.capability,
        sessionId: "s",
        piSessionId: null,
        cwd: "/tmp/p",
      });
      const dropped = committed.tasks[1];
      harness.store.updateTask(dropped?.id as string, { status: "SUCCEEDED", resultSummary: "done anyway" });
      revisePlanForRun(harness.store, {
        runId: committed.run.id,
        reason: "no longer needed",
        plan: ok(validateProposal({ goal: "g", tasks: [{ title: "Keep", acceptance: ["alpha", "beta"] }] })),
        capability: harness.capability,
      });
      expect(harness.store.requireTask(dropped?.id as string).status).toBe("SUCCEEDED");
    } finally {
      harness.dispose();
    }
  });
});

describe("a progress report is evidence the runtime checks, not a status the model sets", () => {
  const setup = (harness: ReturnType<typeof createHarness>) =>
    createRunFromPlan(harness.store, {
      plan: ok(validateProposal(goodPlan())),
      capability: harness.capability,
      sessionId: "chat-1",
      piSessionId: null,
      cwd: "/tmp/project",
    });

  test("evidence lands on the named criterion and the rest stays outstanding", () => {
    const harness = createHarness();
    try {
      const committed = setup(harness);
      const task = committed.tasks[1];
      const outcome = reportProgressForTask(harness.store, {
        runId: committed.run.id,
        taskId: task?.id as string,
        report: ok(validateProgress({ evidence: [{ criterion: "t2c1", evidence: "164/164 green" }] })),
        turnId: 1,
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.satisfied).toBe(false);
        expect(outcome.outstanding).toEqual(["t2c2"]);
      }
      const stored = harness.store.requireTask(task?.id as string);
      expect(stored.acceptance.find((entry) => entry.id === "t2c1")?.evidence).toBe("164/164 green");
    } finally {
      harness.dispose();
    }
  });

  test("a criterion id that is not on the task is named back instead of silently accepted", () => {
    const harness = createHarness();
    try {
      const committed = setup(harness);
      const outcome = reportProgressForTask(harness.store, {
        runId: committed.run.id,
        taskId: committed.tasks[1]?.id as string,
        report: ok(validateProgress({ evidence: [{ criterion: "nope", evidence: "x" }] })),
        turnId: 1,
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.unknownCriteria).toEqual(["nope"]);
    } finally {
      harness.dispose();
    }
  });

  test("a report for a task of another run is refused", () => {
    const harness = createHarness();
    try {
      const committed = setup(harness);
      const outcome = reportProgressForTask(harness.store, {
        runId: "run_other",
        taskId: committed.tasks[0]?.id as string,
        report: ok(validateProgress({ complete: true })),
        turnId: 1,
      });
      expect(outcome.ok).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  test("every report leaves a structured signal, so no state transition rests on prose", () => {
    const harness = createHarness();
    try {
      const committed = setup(harness);
      reportProgressForTask(harness.store, {
        runId: committed.run.id,
        taskId: committed.tasks[0]?.id as string,
        report: ok(validateProgress({ evidence: [{ criterion: "t1c1", evidence: "the map" }], complete: true })),
        turnId: 7,
      });
      const kinds = harness.store.listSignals(committed.run.id).map((signal) => signal.kind);
      expect(kinds).toContain("evidence");
      expect(kinds).toContain("complete");
    } finally {
      harness.dispose();
    }
  });
});
