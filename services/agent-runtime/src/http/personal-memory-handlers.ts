import { Schema } from "effect";
import {
  PersonalMemoryCreateSchema,
  PersonalMemoryDeleteSchema,
  PersonalMemorySettingsUpdateSchema,
  PersonalMemoryUpdateSchema,
} from "../../../../shared/agent/personal-memory";
import {
  addPersonalMemory,
  deleteAllPersonalMemories,
  deletePersonalMemories,
  PersonalMemoryError,
  readPersonalMemory,
  updatePersonalMemoryEntry,
  updatePersonalMemorySettings,
} from "../personal-memory-store";
import { errorMessage, jsonError } from "./helpers";

const decodeCreate = Schema.decodeUnknownOption(PersonalMemoryCreateSchema);
const decodeUpdate = Schema.decodeUnknownOption(PersonalMemoryUpdateSchema);
const decodeSettings = Schema.decodeUnknownOption(PersonalMemorySettingsUpdateSchema);
const decodeDelete = Schema.decodeUnknownOption(PersonalMemoryDeleteSchema);

async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function failure(error: unknown): Response {
  return jsonError(
    errorMessage(error, "Personal memory request failed"),
    error instanceof PersonalMemoryError ? 400 : 500,
  );
}

export async function handlePersonalMemoryGet(): Promise<Response> {
  return Response.json(await readPersonalMemory());
}

export async function handlePersonalMemoryCreate(request: Request): Promise<Response> {
  const decoded = decodeCreate(await body(request));
  if (decoded._tag === "None") return jsonError("Memory text and options are invalid");
  try {
    return Response.json(await addPersonalMemory(decoded.value), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function handlePersonalMemoryUpdate(request: Request, id: string): Promise<Response> {
  const decoded = decodeUpdate(await body(request));
  if (decoded._tag === "None") return jsonError("Memory update is invalid");
  try {
    return Response.json(await updatePersonalMemoryEntry(id, decoded.value));
  } catch (error) {
    return failure(error);
  }
}

export async function handlePersonalMemorySettings(request: Request): Promise<Response> {
  const decoded = decodeSettings(await body(request));
  if (decoded._tag === "None") return jsonError("Memory settings are invalid");
  try {
    return Response.json(await updatePersonalMemorySettings(decoded.value));
  } catch (error) {
    return failure(error);
  }
}

export async function handlePersonalMemoryDelete(request: Request): Promise<Response> {
  const decoded = decodeDelete(await body(request));
  if (decoded._tag === "None") return jsonError("Memory deletion request is invalid");
  try {
    if (decoded.value.all) return Response.json(await deleteAllPersonalMemories());
    return Response.json(await deletePersonalMemories(decoded.value.ids ?? []));
  } catch (error) {
    return failure(error);
  }
}

export async function handlePersonalMemoryDeleteOne(id: string): Promise<Response> {
  try {
    return Response.json(await deletePersonalMemories([id]));
  } catch (error) {
    return failure(error);
  }
}
