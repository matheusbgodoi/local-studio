import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { createRunFromPlan } from "../src/agentic/control-service";
import { validateProposal, type ValidatedPlan } from "../src/agentic/control-plane";
import { createToolInterceptor } from "../src/agentic/tool-interceptor";
import { createFakeExtensionApi } from "./support/fake-extension-api";
import { createHarness, type Harness } from "./support/agentic-harness";

//
// The durable mechanisms are only real if they meet the actual tool path. These
// drive the two SDK hooks with the payload shapes the SDK sends.
//

const HUGE = Array.from({ length: 3_000 }, (_, index) => `line ${index} of the build log`).join("\n");

const planFor = (goal: string): ValidatedPlan => {
  const validated = validateProposal({
    goal,
    tasks: [{ title: "Work", description: "do it", acceptance: ["it is done"] }],
  });
  if (!validated.ok) throw new Error(validated.reason);
  return validated;
};

const boot = (harness: Harness, withRun: boolean) => {
  let runId: string | null = null;
  if (withRun) {
    const committed = createRunFromPlan(harness.store, {
      plan: planFor("ship it"),
      capability: harness.capability,
      sessionId: "chat",
      piSessionId: null,
      cwd: "/tmp/project",
    });
    runId = committed.run.id;
    harness.store.updateRun(runId, { status: "RUNNING", activeTaskId: committed.tasks[0]?.id ?? null });
  }
  const fake = createFakeExtensionApi();
  createToolInterceptor({
    store: () => harness.store,
    activeRun: () => (runId ? harness.store.requireRun(runId) : null),
  })(fake.api as never);
  return { fake, runId };
};

const toolResult = (toolName: string, text: string, isError = false) => ({
  type: "tool_result",
  toolCallId: `call-${toolName}-${text.length}`,
  toolName,
  input: { command: "npm run build" },
  content: [{ type: "text", text }],
  isError,
});

const toolCall = (toolName: string, input: unknown, toolCallId = "call-1") => ({
  type: "tool_call",
  toolCallId,
  toolName,
  input,
});

describe("outside a run, nothing is intercepted", () => {
  test("a huge ordinary-chat output reaches the model exactly as the tool produced it", async () => {
    const harness = createHarness();
    try {
      const { fake } = boot(harness, false);
      const replacement = await fake.emit("tool_result", toolResult("bash", HUGE));
      expect(replacement).toBeUndefined();
      expect(harness.store.listRuns()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test("a side-effecting call in ordinary chat is not ledgered and not blocked", async () => {
    const harness = createHarness();
    try {
      const { fake } = boot(harness, false);
      expect(await fake.emit("tool_call", toolCall("bash", { command: "git commit" }))).toBeUndefined();
    } finally {
      harness.dispose();
    }
  });
});

describe("a large real tool output becomes an artifact, and a reference takes its place", () => {
  test("the payload is stored whole and the model gets a pointer with head and tail", async () => {
    const harness = createHarness();
    try {
      const { fake, runId } = boot(harness, true);
      const replacement = (await fake.emit("tool_result", toolResult("bash", HUGE))) as {
        content: { type: string; text: string }[];
      };

      const artifacts = harness.store.listArtifacts(runId as string);
      expect(artifacts.length).toBe(1);
      const artifact = artifacts[0];
      expect(artifact?.byteSize).toBe(Buffer.byteLength(HUGE, "utf8"));
      expect(artifact?.provenance).toBe("bash");

      const text = replacement.content[0]?.text ?? "";
      expect(text).toContain(artifact?.id as string);
      expect(text).toContain("read_agentic_artifact");
      expect(text).toContain("line 0 of the build log");
      expect(text).not.toContain("line 1500 of the build log");
      expect(text.length).toBeLessThan(HUGE.length / 5);

      expect(harness.store.readArtifactSlice(artifact?.id as string, 0, 11)).toBe("line 0 of t");
    } finally {
      harness.dispose();
    }
  });

  test("an output that comfortably fits is left alone", async () => {
    const harness = createHarness();
    try {
      const { fake, runId } = boot(harness, true);
      expect(await fake.emit("tool_result", toolResult("bash", "ok"))).toBeUndefined();
      expect(harness.store.listArtifacts(runId as string)).toEqual([]);
    } finally {
      harness.dispose();
    }
  });
});

describe("a side-effecting real operation is reserved before it runs and recorded after", () => {
  test("the ledger carries the call, then its result", async () => {
    const harness = createHarness();
    try {
      const { fake, runId } = boot(harness, true);
      await fake.emit("tool_call", toolCall("bash", { command: "git commit -m ship" }, "c1"));

      const reserved = harness.store.listOperations(runId as string);
      expect(reserved.length).toBe(1);
      expect(reserved[0]?.status).toBe("STARTED");
      expect(reserved[0]?.action).toBe("bash");
      expect(reserved[0]?.sideEffecting).toBe(true);

      await fake.emit("tool_result", {
        ...toolResult("bash", "committed 1 file"),
        toolCallId: "c1",
      });
      expect(harness.store.listOperations(runId as string)[0]?.status).toBe("COMMITTED");
    } finally {
      harness.dispose();
    }
  });

  test("a read is not ledgered, because repeating it costs nothing", async () => {
    const harness = createHarness();
    try {
      const { fake, runId } = boot(harness, true);
      await fake.emit("tool_call", toolCall("read", { path: "/tmp/x" }, "c2"));
      expect(harness.store.listOperations(runId as string)).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test("a failed operation is recorded as failed, so a retry is allowed", async () => {
    const harness = createHarness();
    try {
      const { fake, runId } = boot(harness, true);
      await fake.emit("tool_call", toolCall("bash", { command: "false" }, "c3"));
      await fake.emit("tool_result", { ...toolResult("bash", "boom", true), toolCallId: "c3" });
      expect(harness.store.listOperations(runId as string)[0]?.status).toBe("FAILED");
    } finally {
      harness.dispose();
    }
  });

  test("an operation caught in flight by a crash is blocked until the real state is checked", async () => {
    const harness = createHarness();
    try {
      const { fake, runId } = boot(harness, true);
      const call = toolCall("bash", { command: "git push" }, "c4");
      await fake.emit("tool_call", call);

      // The process dies here: recovery marks what was in flight UNKNOWN.
      harness.service.recover();
      expect(harness.store.listOperations(runId as string)[0]?.status).toBe("UNKNOWN");
      harness.store.updateRun(runId as string, {
        status: "RUNNING",
        activeTaskId: harness.store.listTasks(runId as string)[0]?.id ?? null,
      });

      const blocked = (await fake.emit("tool_call", { ...call, toolCallId: "c5" })) as {
        block?: boolean;
        reason?: string;
      };
      expect(blocked?.block).toBe(true);
      expect(blocked?.reason).toContain("may have completed");
      expect(blocked?.reason).toContain("Check the real state first");
    } finally {
      harness.dispose();
    }
  });

  test("running the same command again on purpose is allowed, and left in the record", async () => {
    const harness = createHarness();
    try {
      const { fake, runId } = boot(harness, true);
      const call = toolCall("bash", { command: "npm test" }, "c6");
      await fake.emit("tool_call", call);
      await fake.emit("tool_result", { ...toolResult("bash", "164 passing"), toolCallId: "c6" });

      const again = await fake.emit("tool_call", { ...call, toolCallId: "c7" });
      expect(again).toBeUndefined();
      expect(
        harness.store.listEvents(runId as string).some((event) => event.type === "OPERATION_REPEATED"),
      ).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});
