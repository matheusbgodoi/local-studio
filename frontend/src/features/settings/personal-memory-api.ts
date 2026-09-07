import { Schema } from "effect";
import {
  PersonalMemoryDocumentSchema,
  type PersonalMemoryCreate,
  type PersonalMemoryDocument,
  type PersonalMemorySettingsUpdate,
  type PersonalMemoryUpdate,
} from "@shared/agent/personal-memory";

const decodeDocument = Schema.decodeUnknownOption(PersonalMemoryDocumentSchema, {
  onExcessProperty: "preserve",
});

async function request(url: string, init?: RequestInit): Promise<PersonalMemoryDocument> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Memory request failed (${response.status})`;
    throw new Error(error);
  }
  const decoded = decodeDocument(payload);
  if (decoded._tag === "None") throw new Error("Memory response was invalid");
  return decoded.value;
}

function json(method: string, value: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

export function loadPersonalMemory(): Promise<PersonalMemoryDocument> {
  return request("/api/agent/memory");
}

export function createPersonalMemory(input: PersonalMemoryCreate): Promise<PersonalMemoryDocument> {
  return request("/api/agent/memory", json("POST", input));
}

export function updatePersonalMemorySettings(
  input: PersonalMemorySettingsUpdate,
): Promise<PersonalMemoryDocument> {
  return request("/api/agent/memory/settings", json("PUT", input));
}

export function updatePersonalMemory(
  id: string,
  input: PersonalMemoryUpdate,
): Promise<PersonalMemoryDocument> {
  return request(`/api/agent/memory/${encodeURIComponent(id)}`, json("PATCH", input));
}

export function deletePersonalMemories(ids: string[]): Promise<PersonalMemoryDocument> {
  return request("/api/agent/memory/delete", json("POST", { ids }));
}

export function deleteAllPersonalMemories(): Promise<PersonalMemoryDocument> {
  return request("/api/agent/memory/delete", json("POST", { all: true }));
}
