import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  resolveContextReading,
  runCompaction,
  type AgenticInferenceSession,
} from "../src/agentic/scheduler-session";
import { openAgenticDatabase } from "../src/agentic/schema";
import { toCheckpoint } from "../src/agentic/rows";

test("unknown context includes retained messages and hidden overhead or blocks admission", () => {
  expect(resolveContextReading(null, 200704, () => 24500)).toEqual({
    tokens: 24500,
    contextWindow: 200704,
    measured: false,
  });
  expect(resolveContextReading(120000, 200704, () => null).measured).toBe(true);
  expect(() => resolveContextReading(null, 200704, () => null)).toThrow("could not be estimated");
});

test("estimated post-compaction context never proves effectiveness", async () => {
  let compacted = false;
  const session: AgenticInferenceSession = {
    readContext: async () => ({
      tokens: compacted ? 24500 : 160000,
      contextWindow: 200704,
      measured: !compacted,
    }),
    compact: async () => {
      compacted = true;
    },
    prompt: async () => {},
    turnId: () => 0,
    lastAssistantText: () => "",
    lastTurnUsage: () => ({ input: 0, output: 0, cache: 0 }),
    lastError: () => null,
  };
  const outcome = await runCompaction(session, "preserve task", 0, () => 10);
  expect(outcome.tokensAfter).toBe(24500);
  expect(outcome.afterMeasured).toBe(false);
  expect(outcome.effective).toBeNull();
});

test("checkpoint provenance survives reopening and migrates old stores additively", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "context-migration-"));
  try {
    const initial = openAgenticDatabase(dir);
    initial.database.exec("ALTER TABLE agentic_checkpoints DROP COLUMN before_measured");
    initial.database.exec("ALTER TABLE agentic_checkpoints DROP COLUMN after_measured");
    initial.database.exec(
      "INSERT INTO agentic_checkpoints VALUES ('old','run',NULL,1,'legacy',100,0,20,200,1,'{}',1)",
    );
    initial.database.close();
    const migrated = openAgenticDatabase(dir);
    try {
      const old = toCheckpoint(
        migrated.database
          .prepare("SELECT * FROM agentic_checkpoints WHERE id='old'")
          .get() as Record<string, unknown>,
      );
      expect(old.afterMeasured).toBe(false);
      migrated.database.exec(
        "UPDATE agentic_checkpoints SET tokens_after=24500, before_measured=1, after_measured=0 WHERE id='old'",
      );
    } finally {
      migrated.database.close();
    }
    const reopened = openAgenticDatabase(dir);
    try {
      const saved = toCheckpoint(
        reopened.database
          .prepare("SELECT * FROM agentic_checkpoints WHERE id='old'")
          .get() as Record<string, unknown>,
      );
      expect(saved.tokensAfter).toBe(24500);
      expect(saved.afterMeasured).toBe(false);
    } finally {
      reopened.database.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
