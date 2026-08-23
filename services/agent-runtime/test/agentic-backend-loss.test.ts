import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { isBackendLoss } from "../src/agentic/backend-loss";
import { settleDriveFailure } from "../src/agentic/recovery";
import { createHarness, criterion, task } from "./support/agentic-harness";

//
// Written from an incident, not from a hypothesis. The final acceptance run had
// three of five tasks proved and two compactions recorded when the machine
// serving the model dropped off the network for a minute. The drive loop threw
// `fetch failed`, the Run was marked FAILED, and FAILED is terminal — the
// owner could not get any of that work back.
//

describe("telling a lost backend apart from a lost cause", () => {
  test("the ways the local stack says it could not reach the server", () => {
    for (const message of [
      "fetch failed",
      "connect ECONNREFUSED 127.0.0.1:8080",
      "read ECONNRESET",
      "getaddrinfo ENOTFOUND ai-node-3090",
      "connect ETIMEDOUT",
      "socket hang up",
      "HTTP Error 502: Bad Gateway",
      "503 Service Unavailable",
      "This operation was aborted",
    ]) {
      expect(isBackendLoss(new Error(message))).toBe(true);
    }
  });

  test("an error about the work is not an error about the network", () => {
    for (const message of [
      "Unknown model for an agentic run: qwen-daily",
      "task task_1 still depends on Write it; finish those first",
      "acceptance criterion kind must be command, file or observation",
      "plan proposes a cycle: a -> b -> a",
    ]) {
      expect(isBackendLoss(new Error(message))).toBe(false);
    }
  });

  //
  // undici puts the useful half in `cause`, one or two levels down. Reading
  // only the top message sees "fetch failed" and nothing else.
  //
  test("the reason hidden under a wrapped fetch rejection is still found", () => {
    const buried = new Error("fetch failed", {
      cause: new Error("connect ECONNREFUSED 100.94.25.113:8080"),
    });
    expect(isBackendLoss(buried)).toBe(true);

    const twice = new Error("request failed", { cause: buried });
    expect(isBackendLoss(twice)).toBe(true);
  });

  test("a bare object carrying a code is read too", () => {
    expect(isBackendLoss({ message: "request failed", code: "ECONNREFUSED" })).toBe(true);
    expect(isBackendLoss({ message: "plan rejected" })).toBe(false);
  });
});

const GROWTH = { contextGrowth: 900, outputTokens: 200 };

const withHarness = async (body: (h: ReturnType<typeof createHarness>) => Promise<void>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "agentic-backend-loss-"));
  const harness = createHarness({
    dir,
    model: { contextWindow: 40_000, maxTokens: 4_000 },
    backend: {
      contextWindow: 40_000,
      turns: [{ text: "TASK_EVIDENCE first: proved", ...GROWTH }],
      fallback: () => ({ text: "TASK_EVIDENCE first: proved", ...GROWTH }),
    },
  });
  try {
    await body(harness);
  } finally {
    harness.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("losing the backend pauses the run instead of ending it", () => {
  test("proved work survives, the interrupted task is reset, and the run can be resumed", async () => {
    await withHarness(async (harness) => {
      const { run } = await harness.service.startRun({
        goal: "grow the toolkit",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [
          task("First", [], [criterion("first")]),
          task("Second", ["First"], [criterion("second")]),
        ],
      });
      await harness.service.onTurnSettled(run.id);

      const proved = harness.store.listTasks(run.id).filter((t) => t.status === "SUCCEEDED");
      expect(proved).toHaveLength(1);

      const outcome = settleDriveFailure(
        harness.store,
        run.id,
        new Error("fetch failed", { cause: new Error("connect ETIMEDOUT") }),
      );
      expect(outcome.paused).toBe(true);

      const after = harness.store.requireRun(run.id);
      expect(after.status).toBe("PAUSED");
      expect(after.failureReason).toContain("fetch failed");

      const tasks = harness.store.listTasks(run.id);
      expect(tasks.filter((t) => t.status === "SUCCEEDED").map((t) => t.title)).toEqual(["First"]);
      expect(tasks.find((t) => t.title === "Second")?.status).not.toBe("FAILED");

      const events = harness.store.listEvents(run.id, 0);
      const interrupted = events.find((e) => e.type === "RUN_INTERRUPTED");
      expect(interrupted?.summary).toContain("can be resumed");
      expect(events.some((e) => e.type === "RUN_FAILED")).toBe(false);

      //
      // PAUSED is the state a resume knows how to pick up, which is the whole
      // point of not writing FAILED.
      //
      expect(harness.store.listUnfinishedRuns().map((entry) => entry.id)).toContain(run.id);
    });
  });

  test("an error about the work still ends the run", async () => {
    await withHarness(async (harness) => {
      const { run } = await harness.service.startRun({
        goal: "grow the toolkit",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("First", [], [criterion("first")])],
      });

      const outcome = settleDriveFailure(
        harness.store,
        run.id,
        new Error("Unknown model for an agentic run: gone"),
      );
      expect(outcome.paused).toBe(false);
      expect(harness.store.requireRun(run.id).status).toBe("FAILED");
      expect(harness.store.listEvents(run.id, 0).some((e) => e.type === "RUN_FAILED")).toBe(true);
    });
  });
});
