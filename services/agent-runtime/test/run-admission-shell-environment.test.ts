import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { shellExecutionEnvironment } from "../src/shell-execution-environment";
import { createAgenticControlExtension } from "../src/agentic/control-tools";
import { setAgenticControlHost } from "../src/agentic/control-host";
import { createFakeExtensionApi } from "./support/fake-extension-api";
import { createHarness, createTestControlHost } from "./support/agentic-harness";

describe("durable admission and shell credential boundaries", () => {
  test("planning uses the selected catalog identity instead of the SDK raw alias", async () => {
    const h = createHarness();
    try {
      const host = createTestControlHost(h);
      let admitted = "";
      setAgenticControlHost({
        ...host,
        startRun: async (input) => {
          admitted = input.modelId;
          return host.startRun(input);
        },
      });
      const api = createFakeExtensionApi();
      createAgenticControlExtension(
        () => "qualified-chat",
        () => "local-studio-remote/qwen-daily",
        () => ({ behaviorProfile: "standard", networkPolicy: "direct" }),
      )(api.api as never);
      await api.callTool(
        "plan_agentic_run",
        { goal: "Complete work", tasks: [{ title: "Work", acceptance: ["Result"] }] },
        { model: { id: "qwen-daily" } },
      );
      expect(admitted).toBe("local-studio-remote/qwen-daily");
      expect(h.store.listUnfinishedRuns()).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });

  test("copies the environment and removes internal credentials without removing project settings", () => {
    const input = {
      PATH: "/bin",
      PROJECT_MODE: "development",
      LOCAL_AI_API_KEY: "synthetic",
      LOCAL_STUDIO_FRONTEND_TOKEN_FILE: "synthetic-path",
      SITEGEIST_RELAY_TOKEN: "synthetic",
      HF_TOKEN: "synthetic",
      OPENAI_API_KEY: "synthetic",
      LOCAL_STUDIO_NETWORK_POLICY: "vpn_protected",
    };
    const filtered = shellExecutionEnvironment(input);
    expect(Object.keys(filtered).sort()).toEqual([
      "LOCAL_STUDIO_NETWORK_POLICY",
      "PATH",
      "PROJECT_MODE",
    ]);
    expect(Object.keys(input)).toHaveLength(8);
  });

  test("ordinary and witness-producing SDK shells cannot see synthetic runtime credentials", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "studio-shell-env-"));
    const root = path.resolve(import.meta.dir, "..");
    const modulePath = (relative: string) => JSON.stringify(path.join(root, relative));
    const script = `
      import { createOperationalTools } from ${modulePath("src/agentic/operational-tools.ts")};
      import { createHarness, createTestControlHost } from ${modulePath("test/support/agentic-harness.ts")};
      import { setAgenticControlHost } from ${modulePath("src/agentic/control-host.ts")};
      import { validateProposal } from ${modulePath("src/agentic/control-plane.ts")};
      import { createRunFromPlan } from ${modulePath("src/agentic/control-service.ts")};
      const command = 'test -z "\${LOCAL_AI_API_KEY+x}" && test -z "\${LOCAL_STUDIO_FRONTEND_TOKEN+x}" && test -z "\${SITEGEIST_RELAY_TOKEN+x}" && test -z "\${OPENAI_API_KEY+x}" && test "$PROJECT_MODE" = preserved && test "$LOCAL_STUDIO_NETWORK_POLICY" = vpn_protected';
      const ctx = { sessionManager: { getSessionId: () => "offline", getSessionFile: () => undefined } };
      const cwd = ${JSON.stringify(dir)};
      const ordinary = createOperationalTools({cwd,runtimeSessionId:"ordinary",shellPath:"/bin/bash"})[0];
      await ordinary.execute("ordinary",{command},undefined,undefined,ctx);
      const h = createHarness();
      try {
        const plan = validateProposal({goal:"Check",tasks:[{title:"Check",acceptance:[{description:"Check",check:{kind:"command",command,cwd:"."}}]}]});
        if(!plan.ok) throw Error("invalid offline plan");
        const {run,tasks,agents}=createRunFromPlan(h.store,{plan,capability:h.capability,sessionId:"offline",piSessionId:null,cwd});
        const task=tasks[0],agent=agents[0];
        h.store.updateRun(run.id,{status:"RUNNING",activeTaskId:task.id});h.store.updateTask(task.id,{status:"RUNNING",attemptCount:1});h.store.updateAgent(agent.id,{status:"WORKING",currentTaskId:task.id});h.store.startAttempt({runId:run.id,taskId:task.id,agentId:agent.id,attempt:1});
        setAgenticControlHost(createTestControlHost(h));
        const observed=createOperationalTools({cwd,runtimeSessionId:"offline#"+agent.id,shellPath:"/bin/bash"})[0];
        await observed.execute("observed",{command},undefined,undefined,ctx);
        if(!h.store.requireTask(task.id).acceptance[0].satisfied) throw Error("missing actual exit-zero witness");
        console.log("both paths passed");
      }finally{h.dispose();}
    `;
    try {
      const result = spawnSync(process.execPath, ["--eval", script], {
        encoding: "utf8",
        timeout: 10000,
        env: {
          PATH: process.env.PATH,
          HOME: dir,
          LOCAL_AI_API_KEY: "synthetic-only",
          LOCAL_STUDIO_FRONTEND_TOKEN: "synthetic-only",
          SITEGEIST_RELAY_TOKEN: "synthetic-only",
          OPENAI_API_KEY: "synthetic-only",
          PROJECT_MODE: "preserved",
          LOCAL_STUDIO_NETWORK_POLICY: "vpn_protected",
        },
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("both paths passed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
