import { expect, test } from "bun:test";
import {
  assertBehaviorProfile,
  behaviorProfileForModel,
  executionPolicyForModel,
} from "../../../shared/agent/execution-policy";
import { resolveAgenticCapability } from "../src/agentic/capability";
import type { AgentModel } from "../../../shared/agent/models";

const model: AgentModel = {
  id: "renamed-profile",
  name: "Renamed profile",
  provider: "local-studio",
  physicalModelId: "qwen-daily",
  behaviorProfile: "uncensored",
  contextWindow: 200704,
  maxTokens: 32768,
  reasoning: true,
  vision: true,
  tools: true,
  active: true,
};

test("agentic admission honors an explicitly selected uncensored profile", () => {
  const capability = resolveAgenticCapability(model);
  expect(capability.modelId).toBe("renamed-profile");
  expect(capability.behaviorProfile).toBe("uncensored");
});

test("standard and uncensored aliases resolve to their declared execution profiles", () => {
  expect(behaviorProfileForModel({ id: "qwen-daily" })).toBe("standard");
  expect(behaviorProfileForModel({ id: "qwen-uncensored" })).toBe("uncensored");
  expect(executionPolicyForModel(model, "vpn_protected")).toEqual({
    behaviorProfile: "uncensored",
    networkPolicy: "vpn_protected",
  });
});

test("a descendant profile mismatch is rejected instead of silently rerouted", () => {
  expect(() => assertBehaviorProfile("uncensored", { id: "qwen-daily" })).toThrow(
    "was not rerouted",
  );
  expect(() => assertBehaviorProfile("uncensored", model)).not.toThrow();
});
