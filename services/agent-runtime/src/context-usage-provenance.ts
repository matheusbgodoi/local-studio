import { calculateContextTokens, type AgentSession } from "@earendil-works/pi-coding-agent";

export function contextUsageIsMeasured(
  tokens: number | null | undefined,
  messages: AgentSession["messages"],
): boolean {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return false;
  const last = messages.at(-1);
  if (last?.role !== "assistant" || last.stopReason === "error" || last.stopReason === "aborted")
    return false;
  return Boolean(last.usage) && calculateContextTokens(last.usage) === tokens;
}
