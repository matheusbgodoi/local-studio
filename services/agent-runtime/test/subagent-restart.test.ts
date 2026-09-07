import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SubagentRun } from "../../../shared/agent/subagent";
import {
  saveSubagentRun,
  readSubagentRuns,
  readSessionExecutionPolicy,
  setSubagentLink,
  setSessionArchived,
  forgetSessionMetadata,
} from "../src/session-metadata-store";

function freshList(dir: string, parent: string): SubagentRun[] {
  const modulePath = path.resolve(import.meta.dir, "../src/subagents.ts");
  const code = `import { listSubagents } from ${JSON.stringify(modulePath)}; console.log(JSON.stringify(listSubagents(${JSON.stringify(parent)})));`;
  const result = Bun.spawnSync([process.execPath, "-e", code], {
    env: { ...process.env, LOCAL_STUDIO_DATA_DIR: dir },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString().trim());
}

test("fresh process restores completed results and marks unfinished children interrupted without inference", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "subagent-restart-"));
  writeFileSync(path.join(dir, "api-settings.json"), "{}");
  const previous = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = dir;
  const run: SubagentRun = {
    id: "run-a",
    parentPiSessionId: "parent",
    name: "Scout",
    task: "Inspect modules",
    piSessionId: "child-a",
    status: "running",
    startedAt: "2026-09-07T00:00:00Z",
    finishedAt: null,
    cwd: dir,
    modelId: "qwen-uncensored",
    executionPolicy: {
      behaviorProfile: "uncensored",
      networkPolicy: "vpn_protected",
    },
  };
  try {
    await Promise.all([
      saveSubagentRun(run),
      saveSubagentRun({
        ...run,
        id: "run-b",
        piSessionId: "child-b",
        status: "done",
        finishedAt: "2026-09-07T00:01:00Z",
        result: "Observed module map",
      }),
    ]);
    await setSessionArchived("unrelated", true);
    const restored = freshList(dir, "parent");
    expect(restored.find((x) => x.id === "run-a")).toMatchObject({
      status: "interrupted",
      task: "Inspect modules",
      piSessionId: "child-a",
      finishedAt: null,
    });
    expect(restored.find((x) => x.id === "run-a")?.error).toContain("not automatically resumed");
    expect(restored.find((x) => x.id === "run-a")?.executionPolicy).toEqual({
      behaviorProfile: "uncensored",
      networkPolicy: "vpn_protected",
    });
    expect(restored.find((x) => x.id === "run-b")).toMatchObject({
      status: "done",
      result: "Observed module map",
      piSessionId: "child-b",
    });
    expect(freshList(dir, "other-parent")).toEqual([]);
    expect(readSubagentRuns("parent").find((x) => x.id === "run-a")?.status).toBe("running");
    expect(readSessionExecutionPolicy("child-a")).toEqual({
      behaviorProfile: "uncensored",
      networkPolicy: "vpn_protected",
    });
    await forgetSessionMetadata("child-b");
    expect(freshList(dir, "parent").map((x) => x.id)).toEqual(["run-a"]);
  } finally {
    if (previous === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy links remain discoverable with unknown completion instead of invented success", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "subagent-legacy-"));
  writeFileSync(path.join(dir, "api-settings.json"), "{}");
  const previous = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = dir;
  try {
    await setSubagentLink("old-child", "parent", "Legacy scout");
    const restored = freshList(dir, "parent");
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      name: "Legacy scout",
      piSessionId: "old-child",
      status: "interrupted",
      finishedAt: null,
    });
    expect(restored[0]?.error).toContain("completion status is unknown");
  } finally {
    if (previous === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
