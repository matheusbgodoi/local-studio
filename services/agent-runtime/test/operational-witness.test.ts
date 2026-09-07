import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { criterionIsSatisfied } from "../../../shared/agent/acceptance";
import { setAgenticControlHost } from "../src/agentic/control-host";
import { validateProposal } from "../src/agentic/control-plane";
import { createRunFromPlan, reportProgressForTask } from "../src/agentic/control-service";
import { createOperationalTools } from "../src/agentic/operational-tools";
import { createHarness, createTestControlHost } from "./support/agentic-harness";

const ctx = {
  sessionManager: { getSessionId: () => "offline", getSessionFile: () => undefined },
} as unknown as ExtensionContext;
const execute = (tool: ToolDefinition, input: object, signal?: AbortSignal) =>
  tool.execute("call-offline", input, signal, undefined, ctx);
function setup(command: string) {
  const h = createHarness();
  const hash = createHash("sha256").update("prefix-observed").digest("hex");
  const plan = validateProposal({
    goal: "Observed checks",
    tasks: [
      {
        title: "Execute",
        acceptance: [
          { description: "Command", check: { kind: "command", command, cwd: "." } },
          { description: "File", check: { kind: "file", path: "out.txt", sha256: hash } },
        ],
      },
    ],
  });
  if (!plan.ok) throw new Error(plan.reason);
  const { run, tasks, agents } = createRunFromPlan(h.store, {
    plan,
    capability: h.capability,
    sessionId: "observed-chat",
    piSessionId: null,
    cwd: h.dir,
  });
  const task = tasks[0]!;
  const agent = agents[0]!;
  h.store.updateRun(run.id, { status: "RUNNING", activeTaskId: task.id });
  h.store.updateTask(task.id, { status: "RUNNING", attemptCount: 1 });
  h.store.updateAgent(agent.id, { status: "WORKING", currentTaskId: task.id });
  h.store.startAttempt({ runId: run.id, taskId: task.id, agentId: agent.id, attempt: 1 });
  setAgenticControlHost(createTestControlHost(h));
  const shim = path.join(h.dir, "shell-shim");
  writeFileSync(
    shim,
    '#!/bin/bash\nprintf called >> "' + path.join(h.dir, "shell-used") + '"\nexec /bin/bash "$@"\n',
    { mode: 0o700 },
  );
  const tools = createOperationalTools({
    cwd: h.dir,
    runtimeSessionId: `${run.sessionId}#${agent.id}`,
    shellPath: shim,
    commandPrefix: "export OBSERVED_PREFIX=prefix-observed",
  });
  return { h, task, run, plan, tools, criteria: () => h.store.requireTask(task.id).acceptance };
}

describe("raw operational witnesses", () => {
  test("records actual exit zero and exact bytes with the configured shell and prefix", async () => {
    const s = setup('printf %s "$OBSERVED_PREFIX" > out.txt');
    try {
      await execute(s.tools[0]!, { command: 'printf %s "$OBSERVED_PREFIX" > out.txt' });
      expect(readFileSync(path.join(s.h.dir, "shell-used"), "utf8")).toBe("called");
      expect(criterionIsSatisfied(s.criteria()[0]!)).toBe(true);
      expect(criterionIsSatisfied(s.criteria()[1]!)).toBe(false);
      await execute(s.tools[1]!, { criterionId: "t1c2", passed: true });
      expect(criterionIsSatisfied(s.criteria()[1]!)).toBe(true);
      const witnesses = s.h.store
        .listArtifacts(s.run.id)
        .filter((a) => a.kind === "operational_witness");
      expect(witnesses).toHaveLength(2);
      const observed = JSON.parse(s.h.store.readArtifactSlice(witnesses[0]!.id, 0, 16000)!);
      expect(observed.exitCode).toBe(0);
      expect(observed.executedCommand).toContain("export OBSERVED_PREFIX");
      expect(observed.owner.attemptId).toBe(s.criteria()[0]!.witness!.attemptId);
      writeFileSync(path.join(s.h.dir, "out.txt"), "wrong");
      await execute(s.tools[1]!, { criterionId: "t1c2", passed: true });
      expect(criterionIsSatisfied(s.criteria()[1]!)).toBe(false);
      writeFileSync(path.join(s.h.dir, "out.txt"), "prefix-observed");
      await execute(s.tools[1]!, { criterionId: "t1c2" });
      reportProgressForTask(s.h.store, {
        runId: s.run.id,
        taskId: s.task.id,
        turnId: 1,
        report: { evidence: [], complete: true, blocked: null, needsUser: null },
      });
      expect(s.h.store.requireTask(s.task.id).status).toBe("SUCCEEDED");
    } finally {
      s.h.dispose();
    }
  });

  test("unrelated successful commands and nonzero/null exits cannot satisfy a check", async () => {
    const s = setup("exit 7");
    try {
      await execute(s.tools[0]!, { command: "true" });
      expect(s.h.store.listArtifacts(s.run.id)).toHaveLength(0);
      await expect(execute(s.tools[0]!, { command: "exit 7" })).rejects.toThrow();
      expect(criterionIsSatisfied(s.criteria()[0]!)).toBe(false);
      const row = s.h.store.listArtifacts(s.run.id)[0]!;
      expect(JSON.parse(s.h.store.readArtifactSlice(row.id, 0, 16000)!).exitCode).toBe(7);
    } finally {
      s.h.dispose();
    }
    const killed = setup("kill -TERM $$");
    try {
      await execute(killed.tools[0]!, { command: "kill -TERM $$" }).catch(() => {});
      expect(criterionIsSatisfied(killed.criteria()[0]!)).toBe(false);
      const row = killed.h.store.listArtifacts(killed.run.id)[0]!;
      expect(JSON.parse(killed.h.store.readArtifactSlice(row.id, 0, 16000)!).exitCode).toBeNull();
    } finally {
      killed.h.dispose();
    }
  });

  test("cancelled commands and changed plan ownership cannot grant acceptance", async () => {
    const s = setup("sleep 1");
    try {
      await expect(
        execute(s.tools[0]!, { command: "sleep 1" }, AbortSignal.timeout(20)),
      ).rejects.toThrow();
      expect(criterionIsSatisfied(s.criteria()[0]!)).toBe(false);
      const pending = execute(s.tools[0]!, { command: "sleep 1" });
      s.h.store.recordPlanRevision({ runId: s.run.id, reason: "new plan", tasks: s.plan.seeds });
      await pending;
      expect(criterionIsSatisfied(s.criteria()[0]!)).toBe(false);
      expect(s.h.store.listArtifacts(s.run.id)).toHaveLength(1);
    } finally {
      s.h.dispose();
    }
  });
});
