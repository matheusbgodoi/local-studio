import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { AgenticWorkingSetSchema } from "../../../shared/agent/agentic-run";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  applyContextHeadroomSettings,
  applySessionContextHeadroom,
} from "../src/pi-agent-settings";
import { buildWorkingSet, renderWorkingSet } from "../src/agentic/working-set";
import { createHarness, task } from "./support/agentic-harness";

describe("independent session context policy", () => {
  test("concurrent settings writes preserve valid settings without temporary-file collisions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "context-settings-"));
    try {
      await writeFile(
        path.join(dir, "settings.json"),
        JSON.stringify({ ownerPreference: "preserved" }),
      );
      await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          applyContextHeadroomSettings(dir, index % 2 ? 200704 : 32768),
        ),
      );
      expect(
        JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8")).ownerPreference,
      ).toBe("preserved");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("different model windows retain independent overrides and owner preferences", () => {
    const large = SettingsManager.inMemory({
      compaction: { enabled: false, keepRecentTokens: 1234 },
    });
    const small = SettingsManager.inMemory({ compaction: { reserveTokens: 44155 } });
    applySessionContextHeadroom(large, 200704);
    applySessionContextHeadroom(small, 32768);
    expect(large.getCompactionSettings()).toEqual({
      enabled: false,
      keepRecentTokens: 1234,
      reserveTokens: 44155,
    });
    expect(small.getCompactionSettings().reserveTokens).toBe(16384);
    expect(large.getCompactionSettings().reserveTokens).toBe(44155);
  });
});

test("detailed task instructions survive first inference and durable working-set reconstruction", async () => {
  const harness = createHarness();
  const description =
    "Edit src/billing.ts only; preserve account nonce NONCE_74A and the rounding decision.";
  try {
    const { run } = await harness.service.startRun({
      goal: "Repair billing",
      capability: harness.capability,
      sessionId: "session",
      piSessionId: "pi",
      cwd: "/tmp/project",
      tasks: [{ ...task("Fix calculation"), description }],
    });
    expect(harness.backend.promptsSent[0]).toContain(description);
    const tasks = harness.store.listTasks(run.id);
    const workingSet = buildWorkingSet({
      run,
      tasks,
      activeTask: tasks[0] ?? null,
      operations: [],
      artifacts: [],
      events: [],
      recentTail: [],
      unresolvedErrors: [],
    });
    expect(renderWorkingSet(workingSet)).toContain(description);
    expect(
      renderWorkingSet(
        Schema.decodeUnknownSync(AgenticWorkingSetSchema)({
          ...workingSet,
          taskDescription: undefined,
        }),
      ),
    ).toContain("Fix calculation");
  } finally {
    harness.dispose();
  }
});
