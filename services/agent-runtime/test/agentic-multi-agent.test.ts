import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { resolveAgenticCapability } from "../src/agentic/capability";
import { validateProposal, type ValidatedPlan } from "../src/agentic/control-plane";
import { createRunFromPlan } from "../src/agentic/control-service";
import { createAgenticRunService } from "../src/agentic/run-service";
import { createSerialGate } from "../src/agentic/scheduler";
import { createAgenticStore } from "../src/agentic/store";
import { createFakeBackend, fakeAgentModel } from "./support/agentic-backend";

//
// Two logical agents, one card. Their working contexts are genuinely separate —
// compacting one must not reset the other — while decoding stays serialized,
// because there is one GPU and pretending otherwise would only queue behind
// itself while claiming not to.
//

const GROWTH = { contextGrowth: 1_800, outputTokens: 200 };

const planFor = (): ValidatedPlan => {
  const validated = validateProposal({
    goal: "two strands of work",
    tasks: [
      { title: "Strand A", description: "long", acceptance: ["a1", "a2", "a3", "a4", "a5", "a6"] },
      { title: "Strand B", description: "short", acceptance: ["b1"] },
    ],
    agents: [
      { name: "Alpha", role: "first", tasks: ["Strand A"] },
      { name: "Beta", role: "second", tasks: ["Strand B"] },
    ],
  });
  if (!validated.ok) throw new Error(validated.reason);
  return validated;
};

describe("the inference gate lets exactly one decode at a time", () => {
  test("overlapping calls run one after another, in order", async () => {
    const gate = createSerialGate();
    const order: string[] = [];
    let live = 0;
    let peak = 0;

    const job = (name: string, ms: number) =>
      gate(async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => setTimeout(resolve, ms));
        order.push(name);
        live -= 1;
      });

    await Promise.all([job("first", 20), job("second", 1), job("third", 1)]);
    expect(peak).toBe(1);
    expect(order).toEqual(["first", "second", "third"]);
  });

  test("one failure does not wedge the queue", async () => {
    const gate = createSerialGate();
    const failed = gate(async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    expect(await gate(async () => "still working")).toBe("still working");
  });
});

describe("two agents on one run keep their own working context", () => {
  test("compacting one leaves the other's context, spend and checkpoints alone", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agentic-multi-"));
    try {
      const store = createAgenticStore(dir);
      const capability = resolveAgenticCapability(fakeAgentModel({ contextWindow: 9_000, maxTokens: 2_000 }));

      // Alpha is scripted to keep working and keep growing; Beta finishes fast.
      const alpha = createFakeBackend({
        contextWindow: 9_000,
        fallback: (index) => ({ text: `TASK_EVIDENCE t1c${Math.min(index + 1, 6)}: proven`, ...GROWTH }),
      });
      const beta = createFakeBackend({
        contextWindow: 9_000,
        fallback: () => ({ text: "TASK_EVIDENCE t2c1: proven", outputTokens: 60 }),
      });

      let peakConcurrency = 0;
      let live = 0;
      const serial = createSerialGate();

      const service = createAgenticRunService({
        store,
        capabilityFor: () => capability,
        inferenceGate: async (task) =>
          serial(async () => {
            live += 1;
            peakConcurrency = Math.max(peakConcurrency, live);
            try {
              return await task();
            } finally {
              live -= 1;
            }
          }),
        session: (_run, agent) => (agent?.name === "Beta" ? beta.session : alpha.session),
      });

      const committed = createRunFromPlan(store, {
        plan: planFor(),
        capability,
        sessionId: "chat",
        piSessionId: null,
        cwd: "/tmp/project",
      });
      store.updateRun(committed.run.id, { status: "RUNNING" });

      for (let step = 0; step < 24; step += 1) {
        const current = store.requireRun(committed.run.id);
        if (["COMPLETED", "FAILED", "CANCELLED", "WAITING_USER"].includes(current.status)) break;
        await service.onTurnSettled(committed.run.id);
      }

      const agents = store.listAgents(committed.run.id);
      const alphaRow = agents.find((agent) => agent.name === "Alpha");
      const betaRow = agents.find((agent) => agent.name === "Beta");

      expect(peakConcurrency).toBe(1);
      expect(store.listCheckpoints(committed.run.id).length).toBeGreaterThanOrEqual(1);
      expect(alphaRow?.compactionCount).toBeGreaterThanOrEqual(1);
      expect(betaRow?.compactionCount).toBe(0);

      // Separate objects, separate histories: Beta never saw Alpha's growth.
      expect(beta.activeTokens()).toBeLessThan(alpha.activeTokens());
      expect(beta.compactions.length).toBe(0);
      expect(alpha.compactions.length).toBeGreaterThanOrEqual(1);

      // Each prompt went to the agent that owns the task named in it.
      expect(alpha.promptsSent.every((prompt) => prompt.includes("Strand A"))).toBe(true);
      expect(beta.promptsSent.every((prompt) => prompt.includes("Strand B"))).toBe(true);

      expect(store.listTasks(committed.run.id).every((task) => task.status === "SUCCEEDED")).toBe(true);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
