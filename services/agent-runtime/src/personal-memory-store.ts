import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import {
  PERSONAL_MEMORY_MAX_ENTRIES,
  PERSONAL_MEMORY_MAX_TEXT,
  PersonalMemoryDocumentSchema,
  type PersonalMemoryCategory,
  type PersonalMemoryCreate,
  type PersonalMemoryDocument,
  type PersonalMemoryEntry,
  type PersonalMemorySensitivity,
  type PersonalMemorySettingsUpdate,
  type PersonalMemorySource,
  type PersonalMemoryUpdate,
} from "../../../shared/agent/personal-memory";
import { resolveDataDir } from "./data-dir";

const decodeDocument = Schema.decodeUnknownOption(PersonalMemoryDocumentSchema, {
  onExcessProperty: "preserve",
});
let access = Promise.resolve();

export class PersonalMemoryError extends Error {}

function filePath(): string {
  return path.join(resolveDataDir(), "personal-memory.json");
}

function emptyDocument(): PersonalMemoryDocument {
  return {
    version: 1,
    mode: "off",
    knowledgeMode: "off",
    entries: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeDocument(value: unknown): PersonalMemoryDocument {
  const decoded = decodeDocument(value);
  if (decoded._tag === "None") return emptyDocument();
  return {
    ...decoded.value,
    entries: [...decoded.value.entries]
      .filter((entry) => entry.text.trim().length > 0)
      .slice(0, PERSONAL_MEMORY_MAX_ENTRIES),
  };
}

function normalizedText(value: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) throw new PersonalMemoryError("Memory text is required");
  if (text.length > PERSONAL_MEMORY_MAX_TEXT) {
    throw new PersonalMemoryError(
      `Memory text must be ${PERSONAL_MEMORY_MAX_TEXT} characters or less`,
    );
  }
  return text;
}

function withAccess<T>(operation: () => Promise<T>): Promise<T> {
  const result = access.then(operation, operation);
  access = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function persist(document: PersonalMemoryDocument): Promise<PersonalMemoryDocument> {
  const file = filePath();
  const next = normalizeDocument(document);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await chmod(temp, 0o600).catch(() => undefined);
  await rename(temp, file);
  return next;
}

export async function readPersonalMemory(): Promise<PersonalMemoryDocument> {
  try {
    return normalizeDocument(JSON.parse(await readFile(filePath(), "utf8")));
  } catch {
    return emptyDocument();
  }
}

export function readPersonalMemorySync(): PersonalMemoryDocument {
  try {
    return normalizeDocument(JSON.parse(readFileSync(filePath(), "utf8")));
  } catch {
    return emptyDocument();
  }
}

export function updatePersonalMemorySettings(
  update: PersonalMemorySettingsUpdate,
): Promise<PersonalMemoryDocument> {
  return withAccess(async () => {
    const current = await readPersonalMemory();
    return persist({
      ...current,
      ...(update.mode ? { mode: update.mode } : {}),
      ...(update.knowledgeMode ? { knowledgeMode: update.knowledgeMode } : {}),
      updatedAt: new Date().toISOString(),
    });
  });
}

export function addPersonalMemory(
  input: PersonalMemoryCreate,
  source: PersonalMemorySource = "manual",
): Promise<PersonalMemoryDocument> {
  return withAccess(async () => {
    const current = await readPersonalMemory();
    if (current.entries.length >= PERSONAL_MEMORY_MAX_ENTRIES) {
      throw new PersonalMemoryError(`Memory already contains ${PERSONAL_MEMORY_MAX_ENTRIES} items`);
    }
    const text = normalizedText(input.text);
    const duplicate = current.entries.find(
      (entry) => entry.text.toLowerCase() === text.toLowerCase(),
    );
    if (duplicate) return current;
    const now = new Date().toISOString();
    const entry: PersonalMemoryEntry = {
      id: randomUUID(),
      text,
      category: input.category ?? "preference",
      sensitivity: input.sensitivity ?? "standard",
      source,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    return persist({ ...current, entries: [entry, ...current.entries], updatedAt: now });
  });
}

export function updatePersonalMemoryEntry(
  id: string,
  update: PersonalMemoryUpdate,
): Promise<PersonalMemoryDocument> {
  return withAccess(async () => {
    const current = await readPersonalMemory();
    if (!current.entries.some((entry) => entry.id === id)) {
      throw new PersonalMemoryError("Memory item was not found");
    }
    const now = new Date().toISOString();
    const entries = current.entries.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            ...(update.text !== undefined ? { text: normalizedText(update.text) } : {}),
            ...(update.category ? { category: update.category as PersonalMemoryCategory } : {}),
            ...(update.sensitivity
              ? { sensitivity: update.sensitivity as PersonalMemorySensitivity }
              : {}),
            ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
            updatedAt: now,
          }
        : entry,
    );
    return persist({ ...current, entries, updatedAt: now });
  });
}

export function deletePersonalMemories(ids: readonly string[]): Promise<PersonalMemoryDocument> {
  return withAccess(async () => {
    const current = await readPersonalMemory();
    const wanted = new Set(ids);
    return persist({
      ...current,
      entries: current.entries.filter((entry) => !wanted.has(entry.id)),
      updatedAt: new Date().toISOString(),
    });
  });
}

export function deleteAllPersonalMemories(): Promise<PersonalMemoryDocument> {
  return withAccess(async () => {
    const current = await readPersonalMemory();
    return persist({ ...current, entries: [], updatedAt: new Date().toISOString() });
  });
}
