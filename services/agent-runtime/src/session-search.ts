import { closeSync, createReadStream, openSync, readSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { StringDecoder } from "node:string_decoder";
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

function fileContainsQuery(filepath: string, normalizedQuery: string): boolean {
  const buffer = Buffer.allocUnsafe(512 * 1024);
  const decoder = new StringDecoder("utf8");
  let carry = "";
  let fd: number | null = null;
  try {
    fd = openSync(filepath, "r");
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const text = carry + decoder.write(buffer.subarray(0, bytesRead));
      if (normalize(text).includes(normalizedQuery)) return true;
      carry = text.slice(-Math.max(normalizedQuery.length + 8, 64));
    }
    return normalize(carry + decoder.end()).includes(normalizedQuery);
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function matchingFiles(
  candidates: Awaited<ReturnType<typeof listSessionSearchCandidates>>,
  normalizedQuery: string,
): Set<string> {
  return new Set(
    candidates
      .filter((candidate) => fileContainsQuery(candidate.filepath, normalizedQuery))
      .map((candidate) => path.resolve(candidate.filepath)),
  );
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
  const matches = matchingFiles(candidates, normalizedQuery);
  for (const candidate of candidates) {
    if (!matches.has(path.resolve(candidate.filepath))) continue;
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
