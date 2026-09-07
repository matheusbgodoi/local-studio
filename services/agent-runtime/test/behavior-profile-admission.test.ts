import { expect, test } from "bun:test";
import {
  assertAgentBehaviorProfileAllowed,
  requiresTrustedConversation,
} from "../../../shared/agent/behavior-profile";
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

test("metadata blocks a renamed uncensored model before durable capability admission", () => {
  expect(() => assertAgentBehaviorProfileAllowed(model)).toThrow("tools disabled");
  expect(() => resolveAgenticCapability(model)).toThrow("read-only mode");
});

test("standard daily and unrelated profiles remain available without silent rerouting", () => {
  for (const behaviorProfile of ["standard", "alternate", undefined]) {
    const daily = { ...model, id: "qwen-daily", behaviorProfile };
    expect(() => assertAgentBehaviorProfileAllowed(daily)).not.toThrow();
    expect(resolveAgenticCapability(daily).modelId).toBe("qwen-daily");
  }
  expect(model.id).toBe("renamed-profile");
});

test("known raw aliases fail closed if metadata is absent, without substring guessing", () => {
  for (const identity of [
    { id: "qwen-uncensored" },
    { id: "local-studio-remote/qwen-uncensored" },
    { id: "renamed", rawId: "qwen-uncensored" },
  ])
    expect(requiresTrustedConversation(identity)).toBe(true);
  expect(requiresTrustedConversation({ id: "my-uncensored-experiment" })).toBe(false);
  expect(requiresTrustedConversation({ id: "qwen-uncensored", behaviorProfile: "standard" })).toBe(
    false,
  );
});
