import { afterEach, describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { setAgenticControlHost, type AgenticControlHost } from "../src/agentic/control-host";
import { AGENTIC_ROUTING_INSTRUCTIONS, createAgenticControlExtension } from "../src/agentic/control-tools";
import { createFakeExtensionApi } from "./support/fake-extension-api";
import { createHarness, createTestControlHost, type Harness } from "./support/agentic-harness";

//
// These drive the tools exactly as the model does — same names, same argument
// shapes, same return strings — with only the model itself absent.
//

const CHAT_SESSION = "chat-session";

const plan = {
  goal: "build and prove a statistics module",
  tasks: [
    { title: "Write it", description: "create stats.py", acceptance: ["stats.py defines mean and median"] },
    {
      title: "Prove it",
      description: "run the selftest",
      dependsOn: ["Write it"],
      acceptance: ["the selftest printed OK", "it exited 0"],
    },
  ],
};

let open: Harness | null = null;

const boot = () => {
  const harness = createHarness();
  open = harness;
  const host = createTestControlHost(harness);
  setAgenticControlHost(host as unknown as AgenticControlHost);
  const fake = createFakeExtensionApi();
  createAgenticControlExtension(() => CHAT_SESSION)(fake.api as never);
  return { harness, fake, host };
};

afterEach(() => {
  open?.dispose();
  open = null;
});

describe("the model is told the rule, and given the means", () => {
  test("four tools are registered and each one advertises itself to the model", () => {
    const { fake } = boot();
    expect(fake.toolNames().sort()).toEqual([
      "plan_agentic_run",
      "read_agentic_artifact",
      "report_task_progress",
      "revise_agentic_plan",
    ]);
  });

  test("the routing rule reaches the system prompt, once", async () => {
    const { fake } = boot();
    const first = await fake.emit<{ systemPrompt?: string }>("before_agent_start", {
      systemPrompt: "You are a coding agent.",
    });
    expect(first?.systemPrompt).toContain(AGENTIC_ROUTING_INSTRUCTIONS);
    expect(first?.systemPrompt).toContain("Do NOT create a run for it");

    const again = await fake.emit<{ systemPrompt?: string }>("before_agent_start", {
      systemPrompt: first?.systemPrompt ?? "",
    });
    expect(again?.systemPrompt).toBeUndefined();
  });

  test("an ordinary chat turn that calls no tool creates no run", async () => {
    const { harness, fake } = boot();
    await fake.emit("before_agent_start", { systemPrompt: "base" });
    expect(harness.store.listRuns()).toEqual([]);
  });
});

describe("plan_agentic_run is the only way a run begins", () => {
  test("a good plan creates the run and hands back the ids the runtime generated", async () => {
    const { harness, fake } = boot();
    const reply = await fake.callTool("plan_agentic_run", plan);

    const runs = harness.store.listRuns();
    expect(runs.length).toBe(1);
    expect(runs[0]?.goal).toBe("build and prove a statistics module");
    expect(runs[0]?.sessionId).toBe(CHAT_SESSION);

    const tasks = harness.store.listTasks(runs[0]?.id as string);
    expect(tasks.map((task) => task.title)).toEqual(["Write it", "Prove it"]);
    expect(reply).toContain(runs[0]?.id as string);
    expect(reply).toContain(tasks[0]?.id as string);
    expect(reply).toContain("t2c1");
  });

  test("a rejected plan creates nothing and comes back with something to fix", async () => {
    const { harness, fake } = boot();
    const reply = await fake.callTool("plan_agentic_run", {
      goal: "g",
      tasks: [
        { title: "A", acceptance: ["x"], dependsOn: ["B"] },
        { title: "B", acceptance: ["x"], dependsOn: ["A"] },
      ],
    });
    expect(reply).toContain("rejected");
    expect(reply).toContain("not a DAG");
    expect(harness.store.listRuns()).toEqual([]);
  });

  test("one conversation drives one run: a second attempt is refused, not duplicated", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const reply = await fake.callTool("plan_agentic_run", plan);
    expect(reply).toContain("already driving");
    expect(harness.store.listRuns().length).toBe(1);
  });

  test("named agents become real agents that own their tasks", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", {
      ...plan,
      agents: [
        { name: "Author", role: "writing", tasks: ["Write it"] },
        { name: "Verifier", role: "checking", tasks: ["Prove it"] },
      ],
    });
    const runId = harness.store.listRuns()[0]?.id as string;
    const agents = harness.store.listAgents(runId);
    expect(agents.map((agent) => agent.name)).toEqual(["Author", "Verifier"]);
    const tasks = harness.store.listTasks(runId);
    expect(tasks[0]?.agentId).toBe(agents[0]?.id as string);
    expect(tasks[1]?.agentId).toBe(agents[1]?.id as string);
  });
});

describe("progress is reported through a tool, and checked", () => {
  test("evidence is recorded and what is still owed comes straight back", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const runId = harness.store.listRuns()[0]?.id as string;
    // "Prove it" depends on "Write it": finish the dependency the way the model
    // would, so the task under test is genuinely startable.
    harness.store.updateTask(harness.store.listTasks(runId)[0]?.id as string, { status: "SUCCEEDED" });
    const prove = harness.store.listTasks(runId)[1];

    const reply = await fake.callTool("report_task_progress", {
      taskId: prove?.id,
      evidence: [{ criterion: "t2c1", evidence: "python3 stats.py --selftest printed OK" }],
    });
    expect(reply).toContain("Still outstanding: t2c2");
    expect(harness.store.requireTask(prove?.id as string).acceptance[0]?.satisfied).toBe(true);
  });

  test("the last criterion closes the gate, and the runtime says so", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const runId = harness.store.listRuns()[0]?.id as string;
    harness.store.updateTask(harness.store.listTasks(runId)[0]?.id as string, { status: "SUCCEEDED" });
    const prove = harness.store.listTasks(runId)[1];
    const reply = await fake.callTool("report_task_progress", {
      taskId: prove?.id,
      evidence: [
        { criterion: "t2c1", evidence: "printed OK" },
        { criterion: "t2c2", evidence: "exit code 0" },
      ],
      complete: true,
    });
    // Settled on the spot, not one inference later.
    expect(reply).toContain("marked this task complete");
    expect(harness.store.requireTask(prove?.id as string).status).toBe("SUCCEEDED");
  });

  test("a report against an unknown task is refused rather than written somewhere", async () => {
    const { fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const reply = await fake.callTool("report_task_progress", { taskId: "task_nope", complete: true });
    expect(reply).toContain("Rejected");
  });

  test("reporting without a run says so instead of inventing one", async () => {
    const { fake } = boot();
    const reply = await fake.callTool("report_task_progress", { taskId: "task_x" });
    expect(reply).toContain("not driving a run");
  });
});

describe("the model can rewrite its own plan", () => {
  test("a revision is committed as the next revision and keeps accepted work", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const runId = harness.store.listRuns()[0]?.id as string;
    const write = harness.store.listTasks(runId)[0];
    harness.store.updateTask(write?.id as string, { status: "SUCCEEDED" });

    const reply = await fake.callTool("revise_agentic_plan", {
      reason: "the module needs a percentile too",
      tasks: [
        { title: "Write it", acceptance: ["stats.py defines mean and median"] },
        { title: "Percentile", dependsOn: ["Write it"], acceptance: ["percentile interpolates"] },
        { title: "Prove it", dependsOn: ["Percentile"], acceptance: ["the selftest printed OK"] },
      ],
    });

    expect(reply).toContain("revision 2");
    const tasks = harness.store.listTasks(runId);
    expect(tasks.map((task) => task.title)).toEqual(["Write it", "Percentile", "Prove it"]);
    expect(tasks[0]?.status).toBe("SUCCEEDED");
  });

  test("a revision that is not a DAG is refused and the committed plan stands", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const runId = harness.store.listRuns()[0]?.id as string;
    const reply = await fake.callTool("revise_agentic_plan", {
      reason: "nonsense",
      tasks: [
        { title: "A", acceptance: ["x"], dependsOn: ["B"] },
        { title: "B", acceptance: ["x"], dependsOn: ["A"] },
      ],
    });
    expect(reply).toContain("rejected");
    expect(harness.store.requireRun(runId).planRevision).toBe(1);
  });
});

//
// Raised by an adversarial review of the control plane and confirmed against
// the code before being fixed.
//
//
// Found by the first real-Qwen acceptance run. A capable model did thirty tool
// calls inside ONE turn: it proved a task, watched it stay RUNNING because the
// runtime only adjudicated between turns, saw its dependents still BLOCKED, and
// burned two plan revisions working around a gate that had already been met.
//
describe("the plan moves while the model is still working", () => {
  test("a task whose criteria are all met settles at once, and its dependents open", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const runId = harness.store.listRuns()[0]?.id as string;
    const [write, prove] = harness.store.listTasks(runId);

    expect(write?.status).toBe("READY");
    expect(prove?.status).toBe("BLOCKED");

    const reply = await fake.callTool("report_task_progress", {
      taskId: write?.id,
      evidence: [{ criterion: "t1c1", evidence: "cat stats.py showed mean and median" }],
      complete: true,
    });

    // Settled inside the turn, not one inference later.
    expect(harness.store.requireTask(write?.id as string).status).toBe("SUCCEEDED");
    expect(harness.store.requireTask(prove?.id as string).status).toBe("READY");
    expect(reply).toContain("marked this task complete");
    expect(reply).toContain("Now ready to start: Prove it");
  });

  test("a revision that drops the edges opens the tasks immediately", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const runId = harness.store.listRuns()[0]?.id as string;
    expect(harness.store.listTasks(runId)[1]?.status).toBe("BLOCKED");

    await fake.callTool("revise_agentic_plan", {
      reason: "these are independent after all",
      tasks: [
        { title: "Write it", acceptance: ["stats.py defines mean and median"] },
        { title: "Prove it", acceptance: ["the selftest printed OK"] },
      ],
    });

    // No dependencies left, so nothing may still read as blocked.
    for (const task of harness.store.listTasks(runId)) {
      expect(task.dependencies.length).toBe(0);
      expect(task.status).not.toBe("BLOCKED");
    }
  });

  test("a task is still refused while a dependency is genuinely unfinished", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const runId = harness.store.listRuns()[0]?.id as string;
    const prove = harness.store.listTasks(runId)[1];
    const reply = await fake.callTool("report_task_progress", {
      taskId: prove?.id,
      evidence: [{ criterion: "t2c1", evidence: "skipping ahead" }],
    });
    expect(reply).toContain("still depends on Write it");
    expect(harness.store.requireTask(prove?.id as string).acceptance[0]?.satisfied).toBe(false);
  });
});

describe("the review's findings, pinned", () => {
  test("a report against a task still waiting on its dependencies is refused", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const runId = harness.store.listRuns()[0]?.id as string;
    const blocked = harness.store.listTasks(runId)[1];
    harness.store.updateTask(blocked?.id as string, { status: "BLOCKED" });

    const reply = await fake.callTool("report_task_progress", {
      taskId: blocked?.id,
      evidence: [{ criterion: "t2c1", evidence: "not really" }],
    });
    expect(reply).toContain("still depends on");
    expect(harness.store.requireTask(blocked?.id as string).acceptance[0]?.satisfied).toBe(false);
  });

  test("reading a large artifact is not itself externalised into a new one", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const runId = harness.store.listRuns()[0]?.id as string;
    const artifact = harness.store.recordArtifact({
      runId,
      taskId: null,
      kind: "log",
      label: "big.log",
      mediaType: "text/plain",
      provenance: "bash",
      content: "z".repeat(50_000),
    });
    const before = harness.store.listArtifacts(runId).length;
    const slice = await fake.callTool("read_agentic_artifact", { artifactId: artifact.id, length: 20_000 });
    expect(slice.length).toBe(20_000);
    expect(harness.store.listArtifacts(runId).length).toBe(before);
  });
});

describe("a stored artifact is readable by the model that was given its id", () => {
  test("a slice comes back, and an unknown id says so", async () => {
    const { harness, fake } = boot();
    await fake.callTool("plan_agentic_run", plan);
    const runId = harness.store.listRuns()[0]?.id as string;
    const artifact = harness.store.recordArtifact({
      runId,
      taskId: null,
      kind: "log",
      label: "build.log",
      mediaType: "text/plain",
      provenance: "npm run build",
      content: "abcdefghij".repeat(50),
    });

    expect(await fake.callTool("read_agentic_artifact", { artifactId: artifact.id, offset: 0, length: 5 })).toBe(
      "abcde",
    );
    expect(await fake.callTool("read_agentic_artifact", { artifactId: "artifact_nope" })).toContain("No artifact");
  });
});
