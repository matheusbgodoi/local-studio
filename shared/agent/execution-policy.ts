import { Schema } from "effect";
import type { AgentModel } from "./models";
import { NetworkPolicySchema, type NetworkPolicy } from "./network-policy";

export const ExecutionPolicySchema = Schema.Struct({
  behaviorProfile: Schema.NullOr(Schema.String),
  networkPolicy: NetworkPolicySchema,
});

export type ExecutionPolicy = typeof ExecutionPolicySchema.Type;

export type BehaviorProfileIdentity = Pick<AgentModel, "id" | "rawId" | "behaviorProfile">;

export function behaviorProfileForModel(model: BehaviorProfileIdentity): string | null {
  const declared = model.behaviorProfile?.trim().toLowerCase();
  if (declared) return declared;
  const rawId = model.rawId?.trim() || model.id.slice(model.id.lastIndexOf("/") + 1);
  if (rawId === "qwen-uncensored") return "uncensored";
  if (rawId === "qwen-daily") return "standard";
  return null;
}

export function executionPolicyForModel(
  model: BehaviorProfileIdentity,
  networkPolicy: NetworkPolicy,
): ExecutionPolicy {
  return { behaviorProfile: behaviorProfileForModel(model), networkPolicy };
}

export function assertBehaviorProfile(
  expected: string | null,
  model: BehaviorProfileIdentity,
): void {
  const actual = behaviorProfileForModel(model);
  if (expected === actual) return;
  throw new Error(
    `The persisted behavior profile is '${expected ?? "none"}', but model '${model.id}' currently declares '${actual ?? "none"}'. The session was not rerouted.`,
  );
}
