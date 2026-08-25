import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const CLEANUP_FILENAME = "agentic-delete-cleanup.json";
const SAFE_QUARANTINE = /\.deleting-[0-9a-f-]+$/i;

function cleanupFile(dataDir: string): string {
  return path.join(dataDir, CLEANUP_FILENAME);
}

function allowedRoots(dataDir: string): string[] {
  return [path.resolve(dataDir)];
}

function isSafeTarget(dataDir: string, target: string): boolean {
  if (!path.isAbsolute(target) || !SAFE_QUARANTINE.test(target)) return false;
  const resolved = path.resolve(target);
  const lexicalMatch = allowedRoots(dataDir).some(
    (root) => resolved !== root && resolved.startsWith(`${root}${path.sep}`),
  );
  if (!lexicalMatch || !existsSync(resolved)) return lexicalMatch;

  // A manifest is durable input, so a lexical prefix is not enough: an
  // attacker could replace a parent directory with a symlink after the queue
  // was written. Resolve the existing parent and require it to remain below
  // one of the real allowed roots before any recursive delete.
  try {
    const realParent = realpathSync.native(path.dirname(resolved));
    return allowedRoots(dataDir).some((root) => {
      if (!existsSync(root)) return false;
      const realRoot = realpathSync.native(root);
      return realParent === realRoot || realParent.startsWith(`${realRoot}${path.sep}`);
    });
  } catch {
    return false;
  }
}

function readQueue(dataDir: string): string[] {
  const file = cleanupFile(dataDir);
  if (!existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is string => typeof entry === "string" && isSafeTarget(dataDir, entry),
    );
  } catch {
    return [];
  }
}

function writeQueue(dataDir: string, entries: readonly string[]): void {
  const file = cleanupFile(dataDir);
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, JSON.stringify([...new Set(entries)], null, 2), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

export function queueDeleteCleanup(dataDir: string, targets: readonly string[]): void {
  if (dataDir === ":memory:") return;
  const safe = targets.filter((target) => isSafeTarget(dataDir, target));
  if (safe.length !== targets.length) throw new Error("Unsafe Run cleanup target was refused");
  writeQueue(dataDir, [...readQueue(dataDir), ...safe]);
}

export function drainDeleteCleanupQueue(dataDir: string): void {
  if (dataDir === ":memory:") return;
  const pending = readQueue(dataDir);
  if (pending.length === 0) return;
  const remaining: string[] = [];
  for (const target of pending) {
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      remaining.push(target);
    }
  }
  try {
    writeQueue(dataDir, remaining);
  } catch {
    // Keeping the previous queue is safer than claiming cleanup happened.
  }
}
