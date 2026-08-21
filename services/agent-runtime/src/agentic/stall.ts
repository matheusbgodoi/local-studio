//
// Stall detection.
//
// Progress is not "the agent said something". It is a fingerprint of what
// actually changed: satisfied criteria, committed operations, new artifacts
// and the error signature. Bounded attempts that move none of it are a stall,
// and a stall triggers a plan revision rather than another identical attempt.
//

import { createHash } from "node:crypto";

import type { AgenticArtifact, AgenticTask, AgenticToolOperation } from "./contract";

export const DEFAULT_MAX_ATTEMPTS_PER_TASK = 4;
export const DEFAULT_STALL_THRESHOLD = 2;
export const DEFAULT_MAX_PLAN_REVISIONS = 3;

export type ProgressFingerprint = string;

export function progressFingerprint(input: {
  task: AgenticTask;
  operations: readonly AgenticToolOperation[];
  artifacts: readonly AgenticArtifact[];
  errorSignature: string | null;
}): ProgressFingerprint {
  const satisfied = input.task.acceptance
    .filter((criterion) => criterion.satisfied)
    .map((criterion) => criterion.id)
    .sort()
    .join(",");
  const committed = input.operations
    .filter((operation) => operation.status === "COMMITTED")
    .map((operation) => operation.idempotencyKey)
    .sort()
    .join(",");
  const artifactIds = input.artifacts.map((artifact) => artifact.digest).sort().join(",");
  return createHash("sha256")
    .update([satisfied, committed, artifactIds, input.errorSignature ?? ""].join("|"))
    .digest("hex")
    .slice(0, 32);
}

export type StallPolicy = {
  maxAttemptsPerTask: number;
  stallThreshold: number;
  maxPlanRevisions: number;
};

export const DEFAULT_STALL_POLICY: StallPolicy = {
  maxAttemptsPerTask: DEFAULT_MAX_ATTEMPTS_PER_TASK,
  stallThreshold: DEFAULT_STALL_THRESHOLD,
  maxPlanRevisions: DEFAULT_MAX_PLAN_REVISIONS,
};

export type StallVerdict =
  | { kind: "progressing" }
  | { kind: "retry"; repeats: number }
  | { kind: "replan"; reason: string }
  | { kind: "give-up"; reason: string };

export type StallState = {
  fingerprint: ProgressFingerprint | null;
  repeats: number;
};

export function evaluateStall(input: {
  state: StallState;
  fingerprint: ProgressFingerprint;
  attemptCount: number;
  planRevisions: number;
  policy?: StallPolicy;
}): { verdict: StallVerdict; state: StallState } {
  const policy = input.policy ?? DEFAULT_STALL_POLICY;
  const repeated = input.state.fingerprint === input.fingerprint;
  const repeats = repeated ? input.state.repeats + 1 : 0;
  const state: StallState = { fingerprint: input.fingerprint, repeats };

  if (!repeated) return { verdict: { kind: "progressing" }, state };

  if (input.attemptCount >= policy.maxAttemptsPerTask || repeats >= policy.stallThreshold) {
    if (input.planRevisions >= policy.maxPlanRevisions) {
      return {
        verdict: {
          kind: "give-up",
          reason: `no progress after ${input.attemptCount} attempts and ${input.planRevisions} plan revisions`,
        },
        state,
      };
    }
    return {
      verdict: {
        kind: "replan",
        reason: `no measurable progress across ${repeats + 1} attempts on the same approach`,
      },
      state,
    };
  }

  return { verdict: { kind: "retry", repeats }, state };
}

export function errorSignature(message: string | null | undefined): string | null {
  if (!message) return null;
  return createHash("sha256")
    .update(message.replace(/\d+/g, "#").slice(0, 2000))
    .digest("hex")
    .slice(0, 16);
}
