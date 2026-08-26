import { createReadStream } from "node:fs";
import readline from "node:readline";
import type { SessionSearchResult } from "../../../shared/agent/session-search";
import type { ProjectEntry } from "./projects-store";
import { listSessionSearchCandidates } from "./sessions-store";

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

async function transcriptMatch(
  filepath: string,
  queryPattern: RegExp,
  normalizedQuery: string,
  queryLength: number,
): Promise<string | null> {
  const stream = createReadStream(filepath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!queryPattern.test(line)) continue;
      try {
        const text = messageText(JSON.parse(line) as Record<string, unknown>);
        if (!text) continue;
        const matchAt = normalize(text).indexOf(normalizedQuery);
        if (matchAt >= 0) return contextualSnippet(text, matchAt, queryLength);
      } catch {
        continue;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return null;
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
  limit: number,
): Promise<SessionSearchResult[]> {
  const normalizedQuery = normalize(query);
  const queryPattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  const results: SessionSearchResult[] = [];
  const candidates = (await listSessionSearchCandidates(cwd)).sort(
    (a, b) => Date.parse(b.summary.updatedAt) - Date.parse(a.summary.updatedAt),
  );
  for (const candidate of candidates) {
    let snippet: string | null;
    try {
      snippet = await transcriptMatch(
        candidate.filepath,
        queryPattern,
        normalizedQuery,
        query.length,
      );
    } catch {
      continue;
    }
    if (!snippet) continue;
    results.push({
      sessionId: candidate.summary.id,
      projectId: project.id,
      projectName: project.name,
      title: candidate.summary.firstUserMessage,
      snippet,
      archived: candidate.summary.archived,
      updatedAt: candidate.summary.updatedAt,
    });
    if (results.length >= limit) break;
  }
  return results;
}
