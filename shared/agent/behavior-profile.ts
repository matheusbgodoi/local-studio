import type { AgentModel } from "./models";

export type AgentBehaviorProfileIdentity = Pick<AgentModel, "id" | "rawId" | "behaviorProfile">;

export function isUncensoredBehaviorProfile(model: AgentBehaviorProfileIdentity): boolean {
  const profile = model.behaviorProfile?.trim().toLowerCase();
  if (profile) return profile === "uncensored";
  const rawId = model.rawId?.trim() || model.id.slice(model.id.lastIndexOf("/") + 1);
  return rawId === "qwen-uncensored";
}

export const requiresTrustedConversation = isUncensoredBehaviorProfile;

export class AgentBehaviorProfileError extends Error {}

export function assertAgentBehaviorProfileAllowed(): void {}
