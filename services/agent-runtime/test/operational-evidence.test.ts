import { describe, expect, test } from "bun:test";
import { validateProposal } from "../src/agentic/control-plane";
import { createRunFromPlan } from "../src/agentic/control-service";
import { captureExecutionOwnership, executionOwnershipIsCurrent, checkSpecHash } from "../src/agentic/execution-ownership";
import { createHarness } from "./support/agentic-harness";

const proposal = (check: unknown) => validateProposal({ goal: "Build", tasks: [{ title: "Build", acceptance: [{ description: "Build succeeds", check }] }] });

describe("operational check admission and ownership", () => {
  test("keeps exact specifications but rejects malformed checks and ignores forged provenance", () => {
    const check = { kind: "command", command: "npm run build", cwd: "." };
    const plan = validateProposal({ goal: "Build", tasks: [{ title: "Build", acceptance: [{ description: "Build", check, checkSource: "owner", witness: { artifactId: "fake" }, satisfied: true }] }] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.seeds[0]!.acceptance[0]).toMatchObject({ satisfied: false, checkSource: "model_declared", check });
    expect(plan.seeds[0]!.acceptance[0]!.witness).toBeUndefined();
    expect(proposal({ ...check, cwd: "../other" }).ok).toBe(false);
    expect(proposal({ ...check, command: "" }).ok).toBe(false);
    expect(proposal({ kind: "file", path: "out.txt", sha256: "invented" }).ok).toBe(false);
    expect(checkSpecHash(check as {kind:"command";command:string;cwd:string})).not.toBe(checkSpecHash({ kind: "command", command: "true", cwd: "." }));
  });

  test("requires the actual working agent and attempt and invalidates ownership on replan", () => {
    const h = createHarness();
    try {
      const plan = proposal({ kind: "command", command: "npm run build", cwd: "." });
      if (!plan.ok) throw new Error(plan.reason);
      const { run, tasks, agents } = createRunFromPlan(h.store, { plan, capability: h.capability, sessionId: "chat", piSessionId: null, cwd: h.dir });
      const task = tasks[0]!;
      const agent = agents[0]!;
      h.store.updateRun(run.id, { status: "RUNNING", activeTaskId: task.id });
      h.store.updateTask(task.id, { status: "RUNNING", attemptCount: 1 });
      h.store.updateAgent(agent.id, { status: "WORKING", currentTaskId: task.id });
      const session = `chat#${agent.id}`;
      expect(captureExecutionOwnership(h.store, h.store.requireRun(run.id), session)).toBeNull();
      const attempt = h.store.startAttempt({ runId: run.id, taskId: task.id, agentId: agent.id, attempt: 1 });
      const owner = captureExecutionOwnership(h.store, h.store.requireRun(run.id), session)!;
      expect(owner.attemptId).toBe(attempt.id);
      expect(Object.isFrozen(owner)).toBe(true);
      expect(captureExecutionOwnership(h.store, h.store.requireRun(run.id), "chat")).toBeNull();
      expect(captureExecutionOwnership(h.store, h.store.requireRun(run.id), "chat#other")).toBeNull();
      expect(executionOwnershipIsCurrent(h.store, owner)).toBe(true);
      h.store.recordPlanRevision({ runId: run.id, reason: "changed checks", tasks: plan.seeds });
      expect(executionOwnershipIsCurrent(h.store, owner)).toBe(false);
    } finally { h.dispose(); }
  });
});
