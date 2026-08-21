//
// Preflight context budget.
//
// Every reserve is a FRACTION of the window the capability contract declared,
// so the policy is the same sentence at 32K, at 176128 and at 1M:
//
//   usable = window - output reserve - reasoning reserve - tool reserve - safety
//
// The scheduler asks, before every inference and before admitting any tool
// result, whether `active working set + expected next operation` still fits.
// It never waits for the provider to reject the request, and it never compacts
// at a fixed percentage.
//

import type { AgenticCapability } from "./capability";

export type ContextBudgetPolicy = {
  maxOutputShare: number;
  minOutputReserve: number;
  reasoningShare: number;
  toolResultShare: number;
  minToolResultReserve: number;
  safetyShare: number;
  minSafetyMargin: number;
  postCompactionFloorShare: number;
  postCompactionCeilingShare: number;
  usableContextOverride: number | null;
};

export type ContextBudget = {
  contextWindow: number;
  outputReserve: number;
  reasoningReserve: number;
  toolResultReserve: number;
  safetyMargin: number;
  usableLimit: number;
  postCompactionFloor: number;
  postCompactionCeiling: number;
  overridden: boolean;
};

export type PreflightAction = "proceed" | "externalize" | "compact";

export type PreflightDecision = {
  action: PreflightAction;
  fits: boolean;
  projectedTokens: number;
  usableLimit: number;
  overflowTokens: number;
  headroomTokens: number;
};

export const DEFAULT_CONTEXT_BUDGET_POLICY: ContextBudgetPolicy = {
  maxOutputShare: 0.25,
  minOutputReserve: 512,
  reasoningShare: 0.04,
  toolResultShare: 0.08,
  minToolResultReserve: 1024,
  safetyShare: 0.02,
  minSafetyMargin: 256,
  postCompactionFloorShare: 0.35,
  postCompactionCeilingShare: 0.5,
  usableContextOverride: null,
};

const MIN_USABLE_SHARE = 0.1;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const share = (window: number, fraction: number): number =>
  Math.max(0, Math.floor(window * Math.max(0, fraction)));

export function computeContextBudget(
  capability: AgenticCapability,
  policy: ContextBudgetPolicy = DEFAULT_CONTEXT_BUDGET_POLICY,
): ContextBudget {
  const contextWindow = capability.contextWindow;

  const outputCeiling = Math.max(policy.minOutputReserve, share(contextWindow, policy.maxOutputShare));
  const outputReserve = clamp(capability.maxOutputTokens, policy.minOutputReserve, outputCeiling);

  const reasoningReserve = capability.reasoning ? share(contextWindow, policy.reasoningShare) : 0;

  const toolResultReserve = capability.tools
    ? Math.max(policy.minToolResultReserve, share(contextWindow, policy.toolResultShare))
    : 0;

  const safetyMargin = Math.max(policy.minSafetyMargin, share(contextWindow, policy.safetyShare));

  const computed =
    contextWindow - outputReserve - reasoningReserve - toolResultReserve - safetyMargin;
  const floor = share(contextWindow, MIN_USABLE_SHARE);
  const naturalLimit = Math.max(floor, computed);

  //
  // An override may only narrow, and it must still leave a budget a prompt can
  // fit in: a fractional value floored to zero would have made every preflight
  // overflow with nothing able to fix it.
  //
  const override = policy.usableContextOverride;
  const flooredOverride =
    typeof override === "number" && Number.isFinite(override) ? Math.floor(override) : 0;
  const overridden = flooredOverride > 0 && flooredOverride < naturalLimit;
  const usableLimit = overridden ? flooredOverride : naturalLimit;

  return {
    contextWindow,
    outputReserve,
    reasoningReserve,
    toolResultReserve,
    safetyMargin,
    usableLimit,
    postCompactionFloor: share(usableLimit, policy.postCompactionFloorShare),
    postCompactionCeiling: share(usableLimit, policy.postCompactionCeilingShare),
    overridden,
  };
}

//
// A payload big enough to be the sole cause of the overflow is externalised
// rather than compacted away: rewriting memory to make room for one giant
// build log is the wrong trade, and it would be repeated on every retry.
//
export function preflightContext(input: {
  budget: ContextBudget;
  activeTokens: number;
  expectedNextOperationTokens: number;
}): PreflightDecision {
  const active = Math.max(0, Math.floor(input.activeTokens));
  const next = Math.max(0, Math.floor(input.expectedNextOperationTokens));
  const projectedTokens = active + next;
  const usableLimit = input.budget.usableLimit;
  const fits = projectedTokens <= usableLimit;
  const overflowTokens = fits ? 0 : projectedTokens - usableLimit;

  let action: PreflightAction = "proceed";
  if (!fits) {
    action = next > input.budget.toolResultReserve && next >= overflowTokens ? "externalize" : "compact";
  }

  return {
    action,
    fits,
    projectedTokens,
    usableLimit,
    overflowTokens,
    headroomTokens: Math.max(0, usableLimit - projectedTokens),
  };
}

//
// The post-compaction target is a REGION, not a percentage to hit. A working
// set that legitimately needs less stays small; one that needs more is allowed
// past the ceiling rather than being mutilated into a summary that cannot
// finish the task.
//
export function resolvePostCompactionTarget(
  budget: ContextBudget,
  requiredTokens: number,
): { target: number; belowFloor: boolean; aboveCeiling: boolean } {
  const required = Math.max(0, Math.floor(requiredTokens));
  if (required < budget.postCompactionFloor) {
    return { target: required, belowFloor: true, aboveCeiling: false };
  }
  if (required > budget.postCompactionCeiling) {
    return { target: Math.min(required, budget.usableLimit), belowFloor: false, aboveCeiling: true };
  }
  return { target: required, belowFloor: false, aboveCeiling: false };
}
