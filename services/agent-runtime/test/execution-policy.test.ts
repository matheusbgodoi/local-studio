import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAgentTurnRequest } from "../../../shared/agent/agent-turn";
import { NetworkService } from "../src/network/service";
import { executionNetworkPolicy, withExecutionNetworkPolicy } from "../src/network/execution-scope";
import { piStatusFromEvents } from "../src/pi-runtime-state";

function turn(networkPolicy?: unknown) {
  return parseAgentTurnRequest({
    sessionId: "session-a",
    modelId: "qwen-uncensored",
    message: "work",
    ...(networkPolicy === undefined ? {} : { networkPolicy }),
  });
}

test("turn admission keeps an explicit UI network policy and never invents one when omitted", () => {
  expect(turn("vpn_protected")).toMatchObject({
    ok: true,
    value: { modelId: "qwen-uncensored", networkPolicy: "vpn_protected" },
  });
  expect(turn()).toMatchObject({ ok: true, value: { modelId: "qwen-uncensored" } });
  if (turn().ok) expect(turn().value.networkPolicy).toBeUndefined();
  expect(turn("protected")).toEqual({
    ok: false,
    error: "networkPolicy must be direct or vpn_protected",
  });
});

test("runtime status reports the effective backend behavior and network policy", () => {
  const status = piStatusFromEvents({
    running: true,
    activePromptCount: 0,
    modelId: "qwen-uncensored",
    behaviorProfile: "uncensored",
    networkPolicy: "vpn_protected",
    cwd: "/tmp",
    piSessionId: "pi-a",
    agentDir: "/tmp/agent",
    eventSeq: 0,
    lastError: null,
    eventLog: [],
  });
  expect(status.modelId).toBe("qwen-uncensored");
  expect(status.behaviorProfile).toBe("uncensored");
  expect(status.networkPolicy).toBe("vpn_protected");
});

test("direct and VPN execution scopes coexist without cross-session contamination", async () => {
  const observations = await Promise.all([
    withExecutionNetworkPolicy("direct", async () => {
      await Promise.resolve();
      return executionNetworkPolicy();
    }),
    withExecutionNetworkPolicy("vpn_protected", async () => {
      await Promise.resolve();
      return executionNetworkPolicy();
    }),
  ]);
  expect(observations).toEqual(["direct", "vpn_protected"]);
  expect(executionNetworkPolicy()).toBeUndefined();
});

test("explicit direct routing stays direct while another session demands VPN", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "execution-network-"));
  const service = new NetworkService(dir);
  try {
    service.setSessionPolicy("vpn-session", "vpn_protected");
    expect(service.sessionPolicy("vpn-session")).toBe("vpn_protected");
    expect(service.sessionPolicy("direct-session")).toBe("direct");
    expect(service.wrap({ command: "echo", args: ["ok"] }, "direct")).toEqual({
      command: "echo",
      args: ["ok"],
    });
    expect(service.environment("direct")).toEqual({});
    expect(service.proxyEndpoint("direct")).toBeNull();
    expect(service.proxyEndpoint("vpn_protected")).toBe("127.0.0.1:47318");
  } finally {
    service.releaseSession("vpn-session");
    rmSync(dir, { recursive: true, force: true });
  }
});
