import type { AgentModel } from "./models";

export type AgentBehaviorProfileIdentity = Pick<AgentModel, "id" | "rawId" | "behaviorProfile">;

export function requiresTrustedConversation(model: AgentBehaviorProfileIdentity): boolean {
  const profile = model.behaviorProfile?.trim().toLowerCase();
  if (profile) return profile === "uncensored";
  const rawId = model.rawId?.trim() || model.id.slice(model.id.lastIndexOf("/") + 1);
  return rawId === "qwen-uncensored";
}

export class AgentBehaviorProfileError extends Error {
  override readonly name = "AgentBehaviorProfileError";
}

export function assertAgentBehaviorProfileAllowed(model: AgentBehaviorProfileIdentity): void {
  if (!requiresTrustedConversation(model)) return;
  throw new AgentBehaviorProfileError(
    "The uncensored profile requires a trusted conversation with tools disabled. " +
      "Agent sessions can read untrusted content, including in read-only mode. " +
      "Select the standard daily profile to use chats, tasks, or background agents. " +
      "The selected model has not been changed.",
  );
}
