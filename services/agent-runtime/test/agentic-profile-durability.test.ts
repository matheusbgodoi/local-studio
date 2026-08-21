import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { capabilityIdentity, resolveAgenticCapability } from "../src/agentic/capability";
import { AGENTIC_STORE_FILENAME } from "../src/agentic/schema";
import { goalContinuationPrompt } from "../src/goal-driver";
import { groupByPhysicalModel, normalizeOpenAIModels } from "../../../shared/agent/models";
import { createHarness, criterion, driveToSettled, task } from "./support/agentic-harness";

//
// The live catalogue, verbatim: two aliases over one checkpoint, the daily
// profile declaring itself the default and the uncensored one deliberately
// declaring nothing.
//
const LIVE_MODELS = {
  object: "list" as const,
  data: [
    {
      id: "qwen-daily",
      object: "model",
      metadata: {
        contextWindow: 176_128,
        maxTokens: 32_768,
        reasoning: true,
        tools: true,
        vision: true,
        displayName: "Qwen3.8-27B",
        physicalModelId: "qwen-daily",
        behaviorProfile: "standard",
        behaviorProfileLabel: "Standard",
        behaviorProfileDefault: true,
      },
    },
    {
      id: "qwen-uncensored",
      object: "model",
      metadata: {
        contextWindow: 176_128,
        maxTokens: 32_768,
        reasoning: true,
        tools: true,
        vision: true,
        displayName: "Qwen3.8-27B",
        physicalModelId: "qwen-daily",
        behaviorProfile: "uncensored",
        behaviorProfileLabel: "Uncensored",
      },
    },
  ],
};

const CRITERIA = [criterion("c1"), criterion("c2"), criterion("c3"), criterion("c4")];

describe("the durable runtime records the checkpoint and the profile, and confuses neither", () => {
  test("two profiles of one checkpoint keep one physical model id and two behaviours", () => {
    const models = normalizeOpenAIModels(LIVE_MODELS);
    const daily = resolveAgenticCapability(models[0] as never);
    const uncensored = resolveAgenticCapability(models[1] as never);

    expect(daily.physicalModelId).toBe("qwen-daily");
    expect(uncensored.physicalModelId).toBe("qwen-daily");
    expect(daily.behaviorProfile).toBe("standard");
    expect(uncensored.behaviorProfile).toBe("uncensored");
    expect(daily.contextWindow).toBe(uncensored.contextWindow);
    expect(capabilityIdentity(daily)).not.toBe(capabilityIdentity(uncensored));
  });

  test("the default profile is the one that declares itself, never whichever sorted first", () => {
    const [physical] = groupByPhysicalModel(normalizeOpenAIModels(LIVE_MODELS));
    expect(physical?.primary.id).toBe("qwen-daily");
    expect(physical?.primary.behaviorProfile).toBe("standard");
    expect(physical?.profiles.find((entry) => entry.id === "qwen-uncensored")?.behaviorProfileDefault).toBe(
      undefined,
    );
  });

  test("a run persists both, and a restart restores both unchanged", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agentic-profile-"));
    try {
      const first = createHarness({
        dir,
        model: {
          id: "qwen-uncensored",
          physicalModelId: "qwen-daily",
          behaviorProfile: "uncensored",
          behaviorProfileLabel: "Uncensored",
          contextWindow: 176_128,
          maxTokens: 32_768,
        },
      });
      const run = first.store.createRun({
        goal: "g",
        modelId: first.capability.modelId,
        physicalModelId: first.capability.physicalModelId,
        behaviorProfile: first.capability.behaviorProfile,
        contextWindow: first.capability.contextWindow,
        usableLimit: 1_000,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
      });
      first.store.close();

      const second = createHarness({ dir });
      try {
        const restored = second.store.requireRun(run.id);
        expect(restored.modelId).toBe("qwen-uncensored");
        expect(restored.physicalModelId).toBe("qwen-daily");
        expect(restored.behaviorProfile).toBe("uncensored");
        expect(restored.contextWindow).toBe(176_128);
      } finally {
        second.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("compaction and resume never move the profile a run was started with", async () => {
    const harness = createHarness({
      model: {
        id: "qwen-daily",
        physicalModelId: "qwen-daily",
        behaviorProfile: "standard",
        contextWindow: 9_000,
        maxTokens: 2_000,
      },
      backend: {
        contextWindow: 9_000,
        turns: CRITERIA.map((entry) => ({
          text: `TASK_EVIDENCE ${entry.id}: proven`,
          contextGrowth: 1_400,
          outputTokens: 200,
        })),
      },
    });
    try {
      const { run } = await harness.service.startRun({
        goal: "long job",
        capability: harness.capability,
        sessionId: "s",
        piSessionId: "p",
        cwd: "/tmp/p",
        tasks: [task("Work", [], CRITERIA)],
      });
      await driveToSettled(harness, run.id, 20);

      expect(harness.store.listCheckpoints(run.id).length).toBeGreaterThanOrEqual(1);
      const finished = harness.store.requireRun(run.id);
      expect(finished.behaviorProfile).toBe("standard");
      expect(finished.physicalModelId).toBe("qwen-daily");
      const agent = harness.store.listAgents(run.id)[0];
      expect(agent?.behaviorProfile).toBe("standard");
      expect(agent?.physicalModelId).toBe("qwen-daily");
      expect(harness.store.listEvents(run.id).some((event) => event.type === "COMPACTED")).toBe(true);
    } finally {
      harness.dispose();
    }
  });

  test("uncensored is never adopted implicitly: an undeclared run carries no profile at all", () => {
    const harness = createHarness();
    try {
      expect(harness.capability.behaviorProfile).toBeNull();
      const run = harness.store.createRun({
        goal: "g",
        modelId: harness.capability.modelId,
        physicalModelId: harness.capability.physicalModelId,
        behaviorProfile: harness.capability.behaviorProfile,
        contextWindow: harness.capability.contextWindow,
        usableLimit: 1_000,
        sessionId: "s",
        piSessionId: null,
        cwd: "/tmp/p",
      });
      expect(harness.store.requireRun(run.id).behaviorProfile).toBeNull();
    } finally {
      harness.dispose();
    }
  });
});

describe("ordinary chat is not a Run and is left exactly as it was", () => {
  test("a session that never started a Run has none, and the store stays empty", () => {
    const harness = createHarness();
    try {
      expect(harness.store.listRuns()).toEqual([]);
      expect(harness.store.listUnfinishedRuns()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test("the existing goal continuation prompt is untouched by the durable runtime", () => {
    const prompt = goalContinuationPrompt("tidy the repository");
    expect(prompt).toContain("Continue working toward the goal: tidy the repository");
    expect(prompt).toContain("GOAL_COMPLETE");
    expect(prompt).toContain("GOAL_BLOCKED");
  });

  test("the durable store lives in its own file, outside the controller database", () => {
    const harness = createHarness();
    try {
      expect(AGENTIC_STORE_FILENAME).toBe("agentic-runtime.sqlite");
      expect(harness.store.filepath.endsWith(AGENTIC_STORE_FILENAME)).toBe(true);
      expect(harness.store.filepath).not.toContain("controller.db");
    } finally {
      harness.dispose();
    }
  });

  test("no agentic table takes a name the controller sweeps on every open", () => {
    const harness = createHarness();
    try {
      const swept = ["jobs", "chat_sessions", "chat_messages", "chat_runs", "chat_usage", "sessions", "messages", "runs", "usage"];
      const present = harness.store.tableNames();
      expect(present).toContain("agentic_runs");
      for (const table of swept) expect(present).not.toContain(table);
    } finally {
      harness.dispose();
    }
  });
});
