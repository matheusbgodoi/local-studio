import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no `@/` alias from this package.
import { resolveAgenticCapability, withRuntimeContextWindow } from "../src/agentic/capability";
import {
  computeContextBudget,
  DEFAULT_CONTEXT_BUDGET_POLICY,
  preflightContext,
  resolvePostCompactionTarget,
} from "../src/agentic/context-budget";
import { normalizeOpenAIModel } from "../../../shared/agent/models";
import { fakeAgentModel } from "./support/agentic-backend";

//
// The windows below are fixtures, not constants the runtime knows. They exist
// to prove that the same policy holds at every size the campaign has served or
// might serve — including two this machine has never run.
//
const WINDOWS = [32_768, 131_072, 176_128, 196_608, 262_144, 1_048_576];

describe("capabilities are read from the wire contract, never from an alias", () => {
  test("a llama-swap row is read through metadata exactly as the gateway publishes it", () => {
    const capability = resolveAgenticCapability(
      normalizeOpenAIModel({
        id: "qwen-uncensored",
        object: "model",
        metadata: {
          contextWindow: 176_128,
          maxTokens: 32_768,
          tools: true,
          vision: true,
          reasoning: true,
          physicalModelId: "qwen-daily",
          behaviorProfile: "uncensored",
          behaviorProfileLabel: "Uncensored",
        },
      }),
    );
    expect(capability.modelId).toBe("qwen-uncensored");
    expect(capability.physicalModelId).toBe("qwen-daily");
    expect(capability.behaviorProfile).toBe("uncensored");
    expect(capability.contextWindow).toBe(176_128);
    expect(capability.maxOutputTokens).toBe(32_768);
    expect(capability.tools).toBe(true);
    expect(capability.contextWindowDeclared).toBe(true);
  });

  test("a row that declares nothing still yields a usable budget instead of throwing", () => {
    const capability = resolveAgenticCapability(normalizeOpenAIModel({ id: "silent", object: "model" }));
    expect(capability.contextWindowDeclared).toBe(false);
    expect(computeContextBudget(capability).usableLimit).toBeGreaterThan(0);
  });

  test("the window the live session reports outranks the catalogue", () => {
    const capability = resolveAgenticCapability(fakeAgentModel({ contextWindow: 8_000 }));
    const moved = withRuntimeContextWindow(capability, 262_144);
    expect(moved.contextWindow).toBe(262_144);
    expect(computeContextBudget(moved).usableLimit).toBeGreaterThan(
      computeContextBudget(capability).usableLimit,
    );
  });

  test("a nonsense runtime reading is ignored rather than adopted", () => {
    const capability = resolveAgenticCapability(fakeAgentModel({ contextWindow: 131_072 }));
    expect(withRuntimeContextWindow(capability, 0).contextWindow).toBe(131_072);
    expect(withRuntimeContextWindow(capability, null).contextWindow).toBe(131_072);
  });
});

describe("the reserve policy is a fraction of whatever window was declared", () => {
  test("every window produces reserves that leave real headroom", () => {
    for (const contextWindow of WINDOWS) {
      const capability = resolveAgenticCapability(
        fakeAgentModel({ contextWindow, maxTokens: 32_768, tools: true, reasoning: true }),
      );
      const budget = computeContextBudget(capability);
      expect(budget.contextWindow).toBe(contextWindow);
      expect(budget.usableLimit).toBeGreaterThan(0);
      expect(budget.usableLimit).toBeLessThan(contextWindow);
      expect(
        budget.usableLimit +
          budget.outputReserve +
          budget.reasoningReserve +
          budget.toolResultReserve +
          budget.safetyMargin,
      ).toBe(contextWindow);
    }
  });

  test("the usable limit grows with the window, so a bigger model is not compacted like a small one", () => {
    const limits = WINDOWS.map(
      (contextWindow) =>
        computeContextBudget(resolveAgenticCapability(fakeAgentModel({ contextWindow }))).usableLimit,
    );
    for (let index = 1; index < limits.length; index += 1) {
      expect(limits[index] as number).toBeGreaterThan(limits[index - 1] as number);
    }
  });

  test("the output reserve is the declared max output until that would eat the window", () => {
    const roomy = computeContextBudget(
      resolveAgenticCapability(fakeAgentModel({ contextWindow: 176_128, maxTokens: 32_768 })),
    );
    expect(roomy.outputReserve).toBe(32_768);
    const cramped = computeContextBudget(
      resolveAgenticCapability(fakeAgentModel({ contextWindow: 32_768, maxTokens: 32_768 })),
    );
    expect(cramped.outputReserve).toBe(Math.floor(32_768 * DEFAULT_CONTEXT_BUDGET_POLICY.maxOutputShare));
  });

  test("a model that declares no tools is not charged a tool reserve", () => {
    const budget = computeContextBudget(
      resolveAgenticCapability(fakeAgentModel({ contextWindow: 131_072, tools: false, reasoning: false })),
    );
    expect(budget.toolResultReserve).toBe(0);
    expect(budget.reasoningReserve).toBe(0);
  });

  test("an explicit usable override narrows the budget without touching the model", () => {
    const capability = resolveAgenticCapability(fakeAgentModel({ contextWindow: 176_128 }));
    const budget = computeContextBudget(capability, {
      ...DEFAULT_CONTEXT_BUDGET_POLICY,
      usableContextOverride: 6_000,
    });
    expect(budget.usableLimit).toBe(6_000);
    expect(budget.contextWindow).toBe(176_128);
    expect(budget.overridden).toBe(true);
  });

  test("an override wider than the natural limit is ignored: it may only narrow", () => {
    const capability = resolveAgenticCapability(fakeAgentModel({ contextWindow: 32_768 }));
    const natural = computeContextBudget(capability);
    const attempted = computeContextBudget(capability, {
      ...DEFAULT_CONTEXT_BUDGET_POLICY,
      usableContextOverride: 10_000_000,
    });
    expect(attempted.usableLimit).toBe(natural.usableLimit);
    expect(attempted.overridden).toBe(false);
  });
});

describe("preflight decides before the request, not after the provider rejects it", () => {
  const budget = computeContextBudget(
    resolveAgenticCapability(fakeAgentModel({ contextWindow: 131_072, tools: true })),
  );

  test("what fits proceeds", () => {
    const decision = preflightContext({ budget, activeTokens: 1_000, expectedNextOperationTokens: 500 });
    expect(decision.action).toBe("proceed");
    expect(decision.fits).toBe(true);
    expect(decision.headroomTokens).toBe(budget.usableLimit - 1_500);
  });

  test("a working set that has simply grown too large asks for compaction", () => {
    const decision = preflightContext({
      budget,
      activeTokens: budget.usableLimit - 100,
      expectedNextOperationTokens: 500,
    });
    expect(decision.action).toBe("compact");
    expect(decision.overflowTokens).toBe(400);
  });

  test("one enormous pending payload is externalised rather than compacted around", () => {
    const decision = preflightContext({
      budget,
      activeTokens: 2_000,
      expectedNextOperationTokens: budget.usableLimit,
    });
    expect(decision.action).toBe("externalize");
  });

  test("the boundary itself fits: the limit is inclusive", () => {
    const decision = preflightContext({
      budget,
      activeTokens: budget.usableLimit,
      expectedNextOperationTokens: 0,
    });
    expect(decision.fits).toBe(true);
  });
});

describe("the post-compaction target is a region, not a percentage to hit", () => {
  const budget = computeContextBudget(resolveAgenticCapability(fakeAgentModel({ contextWindow: 131_072 })));

  test("a working set that legitimately needs less stays small", () => {
    const target = resolvePostCompactionTarget(budget, 500);
    expect(target.target).toBe(500);
    expect(target.belowFloor).toBe(true);
  });

  test("a working set inside the region is taken at its own size", () => {
    const inside = Math.floor((budget.postCompactionFloor + budget.postCompactionCeiling) / 2);
    const target = resolvePostCompactionTarget(budget, inside);
    expect(target.target).toBe(inside);
    expect(target.belowFloor).toBe(false);
    expect(target.aboveCeiling).toBe(false);
  });

  test("a working set that needs more is allowed past the ceiling rather than mutilated", () => {
    const target = resolvePostCompactionTarget(budget, budget.postCompactionCeiling + 5_000);
    expect(target.aboveCeiling).toBe(true);
    expect(target.target).toBe(budget.postCompactionCeiling + 5_000);
    expect(target.target).toBeLessThanOrEqual(budget.usableLimit);
  });
});
