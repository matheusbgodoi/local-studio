import { expect, test } from "bun:test";
import { criterionIsSatisfied } from "../../../shared/agent/acceptance";
import { createHarness } from "./support/agentic-harness";
import { validateProposal } from "../src/agentic/control-plane";
import { createRunFromPlan, reportProgressForTask } from "../src/agentic/control-service";
import { applyEvidence, parseTurnReport } from "../src/agentic/turn-report";
import { applyReadiness, settleTaskIfSatisfied } from "../src/agentic/readiness";

for (const kind of ["command", "file", "artifact"] as const) {
  test(`${kind} model claims do not complete or unblock dependencies`, () => {
    const h = createHarness();
    try {
      const plan = validateProposal({
        goal: "Offline only",
        tasks: [
          { title: "Check", acceptance: ["npm run check exits zero"] },
          { title: "Continue", dependsOn: ["Check"], acceptance: ["Review results"] },
        ],
      });
      if (!plan.ok) throw Error(plan.reason);
      const committed = createRunFromPlan(h.store, {
        plan,
        capability: h.capability,
        sessionId: "audit",
        piSessionId: null,
        cwd: h.dir,
      });
      const task = committed.tasks[0]!;
      h.store.updateTask(task.id, { acceptance: [{ ...task.acceptance[0]!, kind }] });
      const report = {
        evidence: [
          {
            criterion: task.acceptance[0]!.id,
            evidence: "Fabricated success",
            evidenceSource: "runtime_observation",
          },
        ],
        complete: false,
        blocked: null,
        needsUser: null,
      };
      const outcome = reportProgressForTask(h.store, {
        runId: committed.run.id,
        taskId: task.id,
        turnId: 1,
        report,
      });
      expect(outcome.ok && outcome.satisfied).toBe(false);
      expect(h.store.requireTask(task.id).status).toBe("WAITING_USER");
      expect(h.store.requireRun(committed.run.id).status).toBe("WAITING_USER");
      expect(h.store.requireTask(task.id).acceptance[0]!.evidenceSource).toBe("model_report");
      expect(h.store.listOperations(committed.run.id)).toHaveLength(0);
      h.store.updateTask(task.id, {
        status: "SUCCEEDED",
        acceptance: [{ ...task.acceptance[0]!, kind, satisfied: true, evidence: "Legacy claim" }],
      });
      applyReadiness(h.store, committed.run.id);
      expect(h.store.requireTask(task.id).status).toBe("WAITING_USER");
      expect(h.store.requireTask(committed.tasks[1]!.id).status).toBe("BLOCKED");
      expect(settleTaskIfSatisfied(h.store, task.id, true, "done").settled).toBe(false);
    } finally {
      h.dispose();
    }
  });
}

test("prose cannot verify executable criteria; ordinary assertions keep explicit provenance", () => {
  for (const kind of ["command", "file", "artifact", "assertion", "review"] as const) {
    const outcome = applyEvidence(
      [{ id: "c", kind, description: "check", satisfied: false, evidence: null }],
      parseTurnReport("TASK_EVIDENCE c: claimed success\nTASK_COMPLETE"),
    );
    expect(outcome.satisfied).toBe(kind === "assertion" || kind === "review");
    expect(outcome.acceptance[0]!.evidenceSource).toBe("model_report");
  }
  expect(
    criterionIsSatisfied({
      id: "c",
      kind: "command",
      description: "check",
      satisfied: true,
      evidence: "old",
    }),
  ).toBe(false);
  expect(
    criterionIsSatisfied({
      id: "c",
      kind: "command",
      description: "check",
      satisfied: true,
      evidence: "observed",
      evidenceSource: "runtime_observation",
    }),
  ).toBe(true);
});
