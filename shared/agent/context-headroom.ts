export const CONTEXT_HEADROOM_FRACTION = 0.22;

export const MIN_COMPACTION_RESERVE_TOKENS = 16_384;

export const MAX_COMPACTION_RESERVE_TOKENS = 65_536;

export const COMPACTION_KEEP_RECENT_TOKENS = 20_000;

export const LOCAL_BACKEND_HTTP_IDLE_TIMEOUT_MS = 1_800_000;

//
// The idle timeout above is sized for INFERENCE: a 150K-token prompt-processing
// pass on a local llama.cpp box legitimately runs for minutes before the first
// byte. It must not be inherited by the control plane. Listing models, probing
// health or reading a status endpoint either answers quickly or is not going to
// answer at all, and a sleeping host on a tailnet never sends a reset — so
// without its own deadline that request hangs for the full inference timeout
// and the model picker appears frozen.
//
export const CONTROL_PLANE_TIMEOUT_MS = 8_000;

export function compactionReserveTokens(contextWindow: number | null | undefined): number {
  if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return MIN_COMPACTION_RESERVE_TOKENS;
  }
  const scaled = Math.round(contextWindow * CONTEXT_HEADROOM_FRACTION);
  return Math.min(MAX_COMPACTION_RESERVE_TOKENS, Math.max(MIN_COMPACTION_RESERVE_TOKENS, scaled));
}

export function contextCompactionThreshold(contextWindow: number | null | undefined): number | null {
  if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }
  return contextWindow - compactionReserveTokens(contextWindow);
}

const CONTEXT_WALL_PATTERNS: readonly RegExp[] = [
  /request timed out/i,
  /\bterminated\b/i,
  /stream ended without finish_reason/i,
  /headers timeout/i,
  /body timeout/i,
  /UND_ERR_(HEADERS|BODY)_TIMEOUT/i,
  /ECONNRESET/i,
  /socket hang up/i,
  /exceeds the available context size/i,
  /exceeds the context window/i,
  /maximum context length/i,
  /prompt is too long/i,
  /context[_ ]length[_ ]exceeded/i,
];

const DELIBERATE_STOP_PATTERNS: readonly RegExp[] = [
  /\baborted\b/i,
  /operation was aborted/i,
  /request was aborted/i,
  /cancelled/i,
];

export function isContextWallFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  if (DELIBERATE_STOP_PATTERNS.some((pattern) => pattern.test(message))) return false;
  return CONTEXT_WALL_PATTERNS.some((pattern) => pattern.test(message));
}

export function shouldRecoverByCompaction(
  message: string | null | undefined,
  usedTokens: number | null | undefined,
  contextWindow: number | null | undefined,
): boolean {
  if (!isContextWallFailure(message)) return false;
  const threshold = contextCompactionThreshold(contextWindow);
  if (threshold === null) return true;
  if (typeof usedTokens !== "number" || !Number.isFinite(usedTokens)) return true;
  return usedTokens >= threshold * 0.5;
}
