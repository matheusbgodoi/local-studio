import { shellExecutionEnvironment } from "../shell-execution-environment";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import {
  createBashToolDefinition,
  createLocalBashOperations,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Effect, Schema } from "effect";
import type { AcceptanceCriterion } from "./contract";
import { agenticControlHost } from "./control-host";
import {
  captureExecutionOwnership,
  checkSpecHash,
  executionOwnershipIsCurrent,
  type ExecutionOwnership,
} from "./execution-ownership";
import type { AgenticStore } from "./store";

const FileCheckInput = Schema.Struct({ criterionId: Schema.String });
const text = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  details: {},
});

type Binding = {
  store: AgenticStore;
  owner: ExecutionOwnership;
  criteria: readonly AcceptanceCriterion[];
  cwd: string;
};

function bindingFor(sessionId: string): Binding | null {
  const host = agenticControlHost();
  const run = host?.activeRunForSession(sessionId) ?? null;
  if (!host || !run) return null;
  const owner = captureExecutionOwnership(host.store, run, sessionId);
  if (!owner) return null;
  return {
    store: host.store,
    owner,
    criteria: structuredClone(host.store.requireTask(owner.taskId).acceptance),
    cwd: run.cwd,
  };
}

function beginObservation(binding: Binding, criteria: readonly AcceptanceCriterion[]): void {
  if (!executionOwnershipIsCurrent(binding.store, binding.owner)) return;
  const task = binding.store.requireTask(binding.owner.taskId);
  const ids = new Set(criteria.map((criterion) => criterion.id));
  binding.store.updateTask(task.id, {
    acceptance: task.acceptance.map((criterion) =>
      ids.has(criterion.id)
        ? {
            ...criterion,
            satisfied: false,
            witness: undefined,
            evidence: null,
            evidenceSource: undefined,
          }
        : criterion,
    ),
  });
}

function recordObservation(
  binding: Binding,
  criterion: AcceptanceCriterion,
  toolCallId: string,
  observation: Record<string, unknown>,
  passed: boolean,
): void {
  const { store, owner } = binding;
  if (!criterion.check || !executionOwnershipIsCurrent(store, owner)) return;
  const specHash = checkSpecHash(criterion.check);
  store.transaction(() => {
    const task = store.requireTask(owner.taskId);
    const current = task.acceptance.find((candidate) => candidate.id === criterion.id);
    if (!current?.check || checkSpecHash(current.check) !== specHash) return;
    const artifact = store.recordArtifact({
      runId: owner.runId,
      taskId: owner.taskId,
      kind: "operational_witness",
      label: `Observed model-declared check ${criterion.id}`,
      mediaType: "application/json",
      provenance: "runtime_observation",
      content: JSON.stringify({
        version: 1,
        owner,
        criterionId: criterion.id,
        specHash,
        check: criterion.check,
        checkSource: "model_declared",
        toolCallId,
        observedAtMs: store.now(),
        passed,
        ...observation,
      }),
    });
    const witness = {
      artifactId: artifact.id,
      specHash,
      attemptId: owner.attemptId,
      planRevision: owner.planRevision,
    };
    store.updateTask(task.id, {
      acceptance: task.acceptance.map((candidate) =>
        candidate.id === criterion.id
          ? {
              ...candidate,
              satisfied: passed,
              evidenceSource: "runtime_observation",
              witness,
              evidence: `Model-declared check ${passed ? "passed" : "failed"}; runtime witness ${artifact.id}. This is not independent verification of the goal.`,
            }
          : candidate,
      ),
    });
    store.appendEvent({
      runId: owner.runId,
      taskId: owner.taskId,
      agentId: owner.agentId,
      type: "OPERATIONAL_CHECK_OBSERVED",
      summary: `${criterion.id}: ${passed ? "passed" : "failed"} (model-declared check)`,
      detail: witness,
    });
  });
}

export function createOperationalTools(options: {
  cwd: string;
  runtimeSessionId: string;
  shellPath?: string;
  commandPrefix?: string;
}): ToolDefinition[] {
  const local = createLocalBashOperations({ shellPath: options.shellPath });
  const safeOperations: typeof local = {
    exec: (command, cwd, execOptions) =>
      local.exec(command, cwd, {
        ...execOptions,
        env: shellExecutionEnvironment(execOptions.env ?? process.env),
      }),
  };
  const base = createBashToolDefinition(options.cwd, { ...options, operations: safeOperations });
  const bash: typeof base = {
    ...base,
    execute(id, input, signal, onUpdate, ctx) {
      return Effect.runPromise(
        Effect.tryPromise({
          try: async () => {
            const binding = bindingFor(options.runtimeSessionId);
            const matches =
              binding?.criteria.filter(
                (criterion) =>
                  criterion.check?.kind === "command" &&
                  criterion.check.command === input.command &&
                  path.resolve(binding.cwd, criterion.check.cwd) === path.resolve(options.cwd),
              ) ?? [];
            if (!binding || matches.length === 0)
              return base.execute(id, input, signal, onUpdate, ctx);
            beginObservation(binding, matches);
            const tool = createBashToolDefinition(options.cwd, {
              shellPath: options.shellPath,
              commandPrefix: options.commandPrefix,
              operations: {
                async exec(command, cwd, execOptions) {
                  const digest = createHash("sha256");
                  let outputBytes = 0;
                  let exitCode: number | null = null;
                  try {
                    const result = await safeOperations.exec(command, cwd, {
                      ...execOptions,
                      onData(data) {
                        digest.update(data);
                        outputBytes += data.length;
                        execOptions.onData(data);
                      },
                    });
                    exitCode = result.exitCode;
                    return result;
                  } finally {
                    const observation = {
                      requestedCommand: input.command,
                      executedCommand: command,
                      cwd,
                      exitCode,
                      aborted: execOptions.signal?.aborted === true,
                      outputBytes,
                      outputSha256: digest.digest("hex"),
                    };
                    if (binding)
                      for (const criterion of matches)
                        recordObservation(
                          binding,
                          criterion,
                          id,
                          observation,
                          exitCode === 0 && !execOptions.signal?.aborted,
                        );
                  }
                },
              },
            });
            return tool.execute(id, input, signal, onUpdate, ctx);
          },
          catch: (error) => error,
        }),
      );
    },
  };
  const verifyFile: ToolDefinition = {
    name: "verify_file_criterion",
    label: "Observe declared file check",
    description:
      "Hash the exact workspace file in a declared acceptance criterion. Supply only criterionId. The runtime compares actual bytes with the frozen model-declared SHA-256, not with a claimed result. This proves exact bytes at observation time, not semantic correctness.",
    parameters: {
      ...Schema.toJsonSchemaDocument(FileCheckInput).schema,
      "~unsafe": null,
    } as ToolDefinition["parameters"],
    execute(id, input, signal) {
      return Effect.runPromise(
        Effect.tryPromise({
          try: async () => {
            const { criterionId } = Schema.decodeUnknownSync(FileCheckInput)(input);
            const binding = bindingFor(options.runtimeSessionId);
            const criterion = binding?.criteria.find((candidate) => candidate.id === criterionId);
            if (!binding || criterion?.check?.kind !== "file")
              return text("No matching file criterion belongs to this running task attempt.");
            beginObservation(binding, [criterion]);
            signal?.throwIfAborted();
            const root = await realpath(binding.cwd);
            const resolved = await realpath(path.resolve(root, criterion.check.path));
            const relative = path.relative(root, resolved);
            if (
              relative === ".." ||
              relative.startsWith(`..${path.sep}`) ||
              path.isAbsolute(relative)
            )
              throw new Error("File check escapes the run workspace.");
            const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
            let sha256: string;
            let bytes: number;
            try {
              const before = await handle.stat();
              if (!before.isFile() || before.size > 64 * 1024 * 1024)
                throw new Error("File checks require a regular file no larger than 64 MiB.");
              const hash = createHash("sha256");
              let count = 0;
              for await (const chunk of handle.createReadStream({
                autoClose: false,
                highWaterMark: 1024 * 1024,
              })) {
                signal?.throwIfAborted();
                count += chunk.length;
                if (count > 64 * 1024 * 1024)
                  throw new Error("File grew beyond the verification limit.");
                hash.update(chunk);
              }
              const after = await handle.stat();
              if (
                before.size !== after.size ||
                before.mtimeMs !== after.mtimeMs ||
                before.ctimeMs !== after.ctimeMs ||
                count !== before.size
              )
                throw new Error("File changed during verification; retry after writes finish.");
              sha256 = hash.digest("hex");
              bytes = count;
            } finally {
              await handle.close();
            }
            signal?.throwIfAborted();
            const passed = sha256 === criterion.check.sha256;
            recordObservation(binding, criterion, id, { path: resolved, sha256, bytes }, passed);
            return text(
              `Model-declared file check ${passed ? "matched" : "did not match"} actual bytes. ${executionOwnershipIsCurrent(binding.store, binding.owner) ? "Observation recorded." : "Task ownership changed; no acceptance was granted."}`,
            );
          },
          catch: (error) => error,
        }),
      );
    },
  };
  return [bash as ToolDefinition, verifyFile];
}
