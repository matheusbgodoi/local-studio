import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { resolveAgenticCapability } from "../src/agentic/capability";
import { setAgenticControlHost, type AgenticControlHost } from "../src/agentic/control-host";
import { createAgenticControlExtension } from "../src/agentic/control-tools";
import { createRunFromPlan, reportProgressForTask, revisePlanForRun } from "../src/agentic/control-service";
import { createAgenticRunService } from "../src/agentic/run-service";
import { createAgenticStore, type AgenticStore } from "../src/agentic/store";
import { createFakeBackend, fakeAgentModel, type FakeBackend } from "./support/agentic-backend";
import { createFakeExtensionApi, type FakeExtensionApi } from "./support/fake-extension-api";

//
// The product flow, end to end, with only the model's judgement scripted.
//
// One ordinary chat turn arrives. The "model" decides on its own that this is
// durable work and calls plan_agentic_run. Nothing here posts to an API, builds
// a plan by hand or names a task: every id, every status and every transition
// below came out of the runtime. From then on the scheduler drives, the agent
// reports through the tool, the context is compacted repeatedly, and the same
// unfinished task resumes each time — with no magic string anywhere in the
// protocol and nobody typing "continue".
//

const CHAT_SESSION = "chat-1";
const GROWTH = { contextGrowth: 1_800, outputTokens: 200 };

const six = (prefix: string) => Array.from({ length: 6 }, (_, index) => `${prefix} check ${index + 1}`);

const PROPOSAL = {
  goal: "build a statistics module and prove it works",
  tasks: [
    { title: "Build stats.py", description: "write the module", acceptance: six("build") },
    {
      title: "Prove stats.py",
      description: "run the selftest and the rejections",
      dependsOn: ["Build stats.py"],
      acceptance: six("prove"),
    },
    {
      title: "Document it",
      description: "write NOTES.md",
      dependsOn: ["Prove stats.py"],
      acceptance: six("document"),
    },
  ],
};

type Fixture = {
  store: AgenticStore;
  chat: FakeExtensionApi;
  agent: FakeBackend;
  service: ReturnType<typeof createAgenticRunService>;
  dispose: () => void;
};

function build(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "agentic-flow-"));
  const store = createAgenticStore(dir);
  const capability = resolveAgenticCapability(fakeAgentModel({ contextWindow: 9_000, maxTokens: 2_000 }));

  const host: AgenticControlHost = {
    store,
    activeRunForSession: (sessionId) => {
      const chat = sessionId.split("#")[0] ?? sessionId;
      return store.listUnfinishedRuns().find((run) => run.sessionId === chat) ?? null;
    },
    capabilityForRun: () => capability,
    startRun: async (input) => {
      const committed = createRunFromPlan(store, {
        plan: input.plan,
        capability,
        sessionId: input.sessionId,
        piSessionId: input.piSessionId,
        cwd: input.cwd,
      });
      store.updateRun(committed.run.id, { status: "RUNNING" });
      return { run: committed.run, tasks: committed.tasks, agentNames: committed.agents.map((a) => a.name) };
    },
    revisePlan: (input) => {
      const committed = revisePlanForRun(store, { ...input, capability });
      return { run: committed.run, tasks: committed.tasks, agentNames: committed.agents.map((a) => a.name) };
    },
    reportProgress: (input) => reportProgressForTask(store, { ...input, turnId: store.now() }),
    readArtifact: (id, offset, length) => store.readArtifactSlice(id, offset, length),
  };
  setAgenticControlHost(host);

  // The conversation the owner is typing into.
  const chat = createFakeExtensionApi();
  createAgenticControlExtension(() => CHAT_SESSION)(chat.api as never);

  // The agent's own session, with the same tools on it.
  const agentTools = createFakeExtensionApi();
  createAgenticControlExtension(() => CHAT_SESSION)(agentTools.api as never);

  //
  // The scripted agent: every turn it reports the next criterion through the
  // tool, and its context grows until the budget forces a compaction.
  //
  let reported = 0;
  const agent = createFakeBackend({
    contextWindow: 9_000,
    fallback: () => ({ text: "carrying on", ...GROWTH }),
    onPrompt: async () => {
      const run = host.activeRunForSession(CHAT_SESSION);
      if (!run) return;
      const task = store.listTasks(run.id).find((entry) => entry.status !== "SUCCEEDED");
      if (!task) return;
      const next = task.acceptance.find((criterion) => !criterion.satisfied);
      if (!next) return;
      reported += 1;
      await agentTools.callTool("report_task_progress", {
        taskId: task.id,
        evidence: [{ criterion: next.id, evidence: `verified by command output #${reported}` }],
        ...(task.acceptance.filter((c) => !c.satisfied).length === 1 ? { complete: true } : {}),
      });
    },
  });

  const service = createAgenticRunService({
    store,
    capabilityFor: () => capability,
    session: () => agent.session,
  });

  return {
    store,
    chat,
    agent,
    service,
    dispose: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("one ordinary prompt becomes a run the model planned and the runtime drove", () => {
  test("the model creates the run itself, and the runtime owns every id in it", async () => {
    const fixture = build();
    try {
      expect(fixture.store.listRuns()).toEqual([]);

      // The turn the owner typed. The model decides this is durable work.
      await fixture.chat.callTool("plan_agentic_run", PROPOSAL);

      const runs = fixture.store.listRuns();
      expect(runs.length).toBe(1);
      const run = runs[0];
      expect(run?.goal).toBe("build a statistics module and prove it works");
      expect(run?.sessionId).toBe(CHAT_SESSION);
      expect(run?.id.startsWith("run_")).toBe(true);

      const tasks = fixture.store.listTasks(run?.id as string);
      expect(tasks.map((task) => task.title)).toEqual(["Build stats.py", "Prove stats.py", "Document it"]);
      expect(tasks.every((task) => task.id.startsWith("task_"))).toBe(true);
      expect(tasks[0]?.acceptance.map((c) => c.id)).toEqual(["t1c1", "t1c2", "t1c3", "t1c4", "t1c5", "t1c6"]);
      // Dependencies were named by title and resolved to runtime ids.
      expect(tasks[1]?.dependencies).toEqual([tasks[0]?.id as string]);
      expect(fixture.store.listAgents(run?.id as string).length).toBe(1);
    } finally {
      fixture.dispose();
    }
  });

  test("it then runs itself to completion, compacting repeatedly and resuming the same task", async () => {
    const fixture = build();
    try {
      await fixture.chat.callTool("plan_agentic_run", PROPOSAL);
      const runId = fixture.store.listRuns()[0]?.id as string;

      let resumedRunningSameTask = 0;
      for (let step = 0; step < 60; step += 1) {
        const current = fixture.store.requireRun(runId);
        if (["COMPLETED", "FAILED", "CANCELLED", "WAITING_USER"].includes(current.status)) break;
        const activeBefore = current.activeTaskId;
        const before = fixture.store.listCheckpoints(runId).length;
        await fixture.service.onTurnSettled(runId);
        const after = fixture.store.listCheckpoints(runId).length;
        const activeAfter = fixture.store.requireRun(runId).activeTaskId;
        if (after > before && activeAfter === activeBefore && activeAfter !== null) {
          resumedRunningSameTask += 1;
        }
      }

      expect(fixture.store.listCheckpoints(runId).length).toBeGreaterThanOrEqual(3);
      expect(resumedRunningSameTask).toBeGreaterThanOrEqual(3);
      expect(fixture.store.requireRun(runId).status).toBe("COMPLETED");
      expect(fixture.store.listTasks(runId).every((task) => task.status === "SUCCEEDED")).toBe(true);
      expect(
        fixture.store
          .listTasks(runId)
          .every((task) => task.acceptance.every((criterion) => criterion.satisfied)),
      ).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  test("nothing in the protocol was a magic string, and nobody typed continue", async () => {
    const fixture = build();
    try {
      await fixture.chat.callTool("plan_agentic_run", PROPOSAL);
      const runId = fixture.store.listRuns()[0]?.id as string;
      for (let step = 0; step < 60; step += 1) {
        const current = fixture.store.requireRun(runId);
        if (["COMPLETED", "FAILED", "CANCELLED", "WAITING_USER"].includes(current.status)) break;
        await fixture.service.onTurnSettled(runId);
      }

      // The scripted agent never emitted a marker; every transition came from a
      // tool call recorded as a signal.
      expect(fixture.store.listSignals(runId).filter((s) => s.kind === "evidence").length).toBe(18);
      expect(fixture.store.listSignals(runId).some((s) => s.kind === "complete")).toBe(true);
      for (const prompt of fixture.agent.promptsSent) {
        expect(prompt.trim().toLowerCase()).not.toBe("continue");
      }
      expect(fixture.store.requireRun(runId).status).toBe("COMPLETED");
    } finally {
      fixture.dispose();
    }
  });

  test("cumulative spend only ever rises, while the active context falls at each compaction", async () => {
    const fixture = build();
    try {
      await fixture.chat.callTool("plan_agentic_run", PROPOSAL);
      const runId = fixture.store.listRuns()[0]?.id as string;

      let previous = 0;
      let sawDrop = false;
      let previousActive = 0;
      for (let step = 0; step < 60; step += 1) {
        const current = fixture.store.requireRun(runId);
        if (["COMPLETED", "FAILED", "CANCELLED", "WAITING_USER"].includes(current.status)) break;
        await fixture.service.onTurnSettled(runId);
        const run = fixture.store.requireRun(runId);
        const cumulative = run.cumulativeInputTokens + run.cumulativeOutputTokens;
        expect(cumulative).toBeGreaterThanOrEqual(previous);
        previous = cumulative;
        const active = fixture.agent.activeTokens();
        if (active < previousActive) sawDrop = true;
        previousActive = active;
      }

      expect(sawDrop).toBe(true);
      expect(previous).toBeGreaterThan(0);
    } finally {
      fixture.dispose();
    }
  });
});
