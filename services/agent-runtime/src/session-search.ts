import { createReadStream } from "node:fs";
import readline from "node:readline";
import type { SessionSearchResult } from "../../../shared/agent/session-search";
import type { ProjectEntry } from "./projects-store";
import { listSessionSearchCandidates } from "./sessions-store";

type Segment = { text: string; normalized: string };
type IndexedTranscript = {
  mtimeMs: number;
  size: number;
  chars: number;
  segments: Segment[];
};

const index = new Map<string, IndexedTranscript>();
const MAX_INDEX_CHARS = 64 * 1024 * 1024;
let indexedChars = 0;

function normalize(value: string): string {
  return value.toLocaleLowerCase();
}

function messageText(event: Record<string, unknown>): string | null {
  if (event.type !== "message" && event.type !== "user_message") return null;
  const message =
    event.type === "message"
      ? (event.message as { role?: string; content?: unknown } | undefined)
      : { role: "user", content: event.content };
  if (message?.role !== "user" && message?.role !== "assistant") return null;
  if (typeof message.content === "string") return message.content.trim() || null;
  if (!Array.isArray(message.content)) return null;
  const text = message.content
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || null;
}

function remember(filepath: string, entry: IndexedTranscript): IndexedTranscript {
  const previous = index.get(filepath);
  if (previous) indexedChars -= previous.chars;
  index.delete(filepath);
  index.set(filepath, entry);
  indexedChars += entry.chars;
  while (indexedChars > MAX_INDEX_CHARS && index.size > 1) {
    const oldest = index.entries().next().value as [string, IndexedTranscript] | undefined;
    if (!oldest) break;
    index.delete(oldest[0]);
    indexedChars -= oldest[1].chars;
  }
  return entry;
}

async function transcriptIndex(
  filepath: string,
  mtimeMs: number,
  size: number,
): Promise<IndexedTranscript> {
  const cached = index.get(filepath);
  if (cached?.mtimeMs === mtimeMs && cached.size === size) {
    index.delete(filepath);
    index.set(filepath, cached);
    return cached;
  }
  const segments: Segment[] = [];
  const stream = createReadStream(filepath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const text = messageText(JSON.parse(line) as Record<string, unknown>);
        if (text) segments.push({ text, normalized: normalize(text) });
      } catch {
        continue;
      }
    }
  } finally {
    stream.destroy();
  }
  const chars = segments.reduce((total, segment) => total + segment.text.length * 2, 0);
  return remember(filepath, { mtimeMs, size, chars, segments });
}

function contextualSnippet(text: string, matchAt: number, queryLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  const compactMatch = normalize(compact).indexOf(
    normalize(text.slice(matchAt, matchAt + queryLength)),
  );
  const at = compactMatch >= 0 ? compactMatch : 0;
  const start = Math.max(0, at - 90);
  const end = Math.min(compact.length, at + queryLength + 130);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

export async function searchProjectSessions(
  project: ProjectEntry,
  cwd: string,
  query: string,
): Promise<SessionSearchResult[]> {
  const normalizedQuery = normalize(query);
  const results: SessionSearchResult[] = [];
  for (const candidate of await listSessionSearchCandidates(cwd)) {
    const transcript = await transcriptIndex(candidate.filepath, candidate.mtimeMs, candidate.size);
    for (const segment of transcript.segments) {
      const matchAt = segment.normalized.indexOf(normalizedQuery);
      if (matchAt < 0) continue;
      results.push({
        sessionId: candidate.summary.id,
        projectId: project.id,
        projectName: project.name,
        title: candidate.summary.firstUserMessage,
        snippet: contextualSnippet(segment.text, matchAt, query.length),
        archived: candidate.summary.archived,
        updatedAt: candidate.summary.updatedAt,
      });
      break;
    }
  }
  return results;
}
