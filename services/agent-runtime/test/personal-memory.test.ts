import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  canUseLocalOnlyMemory,
  personalMemorySection,
} from "../src/personal-memory-extension";
import {
  addPersonalMemory,
  deleteAllPersonalMemories,
  deletePersonalMemories,
  readPersonalMemory,
  updatePersonalMemoryEntry,
  updatePersonalMemorySettings,
} from "../src/personal-memory-store";

const root = mkdtempSync(path.join(tmpdir(), "local-studio-memory-"));
const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;

beforeAll(() => {
  process.env.LOCAL_STUDIO_DATA_DIR = root;
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  rmSync(root, { recursive: true, force: true });
});

describe("personal memory", () => {
  test("starts off and supports explicit CRUD", async () => {
    expect(await readPersonalMemory()).toMatchObject({ mode: "off", knowledgeMode: "off" });
    await updatePersonalMemorySettings({ mode: "automatic", knowledgeMode: "automatic" });
    const created = await addPersonalMemory({ text: "  Prefiro respostas diretas.  " });
    expect(created.entries[0]?.text).toBe("Prefiro respostas diretas.");
    const id = created.entries[0]?.id ?? "";
    const updated = await updatePersonalMemoryEntry(id, { enabled: false });
    expect(updated.entries[0]?.enabled).toBe(false);
    expect((await deletePersonalMemories([id])).entries).toHaveLength(0);
    expect((await deleteAllPersonalMemories()).entries).toHaveLength(0);
  });

  test("never injects local-only items into cloud model prompts", async () => {
    await addPersonalMemory({ text: "Standard detail", sensitivity: "standard" });
    await addPersonalMemory({ text: "Private local detail", sensitivity: "local_only" });
    expect(personalMemorySection(false)).toContain("Standard detail");
    expect(personalMemorySection(false)).not.toContain("Private local detail");
    expect(personalMemorySection(true)).toContain("Private local detail");
  });

  test("recognizes only local, private-network, and Tailscale controllers", () => {
    expect(canUseLocalOnlyMemory("http://127.0.0.1:8000")).toBe(true);
    expect(canUseLocalOnlyMemory("https://ai-node-3090.example.ts.net")).toBe(true);
    expect(canUseLocalOnlyMemory("http://100.64.0.12:8000")).toBe(true);
    expect(canUseLocalOnlyMemory("https://api.openai.com")).toBe(false);
    expect(canUseLocalOnlyMemory(undefined)).toBe(false);
  });
});
