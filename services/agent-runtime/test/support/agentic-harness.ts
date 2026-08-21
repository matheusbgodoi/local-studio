//
// The harness every agentic test drives: a real store on a real temporary
// SQLite file, a real scheduler, and the deterministic backend in place of the
// card. Nothing here is a mock of the runtime — only of the model.
//
// Relative on purpose: bun resolves no `@/` alias from this package.
//

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveAgenticCapability, type AgenticCapability } from "../../src/agentic/capability";
import type { ContextBudgetPolicy } from "../../src/agentic/context-budget";
import { createAgenticRunService } from "../../src/agentic/run-service";
import { createAgenticStore, type AgenticStore, type TaskSeed } from "../../src/agentic/store";
import { createFakeBackend, fakeAgentModel, type FakeBackend, type FakeBackendOptions } from "./agentic-backend";
import type { AgentModel } from "../../../../shared/agent/models";

export type Harness = {
  dir: string;
  store: AgenticStore;
  backend: FakeBackend;
  capability: AgenticCapability;
  service: ReturnType<typeof createAgenticRunService>;
  reopen: () => Harness;
  dispose: () => void;
};

export type HarnessOptions = {
  model?: Partial<AgentModel>;
  backend?: Partial<FakeBackendOptions>;
  budgetPolicy?: ContextBudgetPolicy;
  dir?: string;
};

export function criterion(id: string, description = `criterion ${id}`) {
  return { id, description, kind: "assertion" as const, satisfied: false, evidence: null };
}

export function task(title: string, dependencies: string[] = [], criteria = [criterion("c1")]): TaskSeed {
  return { title, description: `do ${title}`, dependencies, acceptance: criteria };
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const dir = options.dir ?? mkdtempSync(path.join(tmpdir(), "agentic-"));
  const model = fakeAgentModel(options.model);
  const capability = resolveAgenticCapability(model);
  const backend = createFakeBackend({
    contextWindow: capability.contextWindow,
    ...options.backend,
  });
  const store = createAgenticStore(dir);
  const service = createAgenticRunService({
    store,
    session: () => backend.session,
    capabilityFor: () => capability,
    budgetPolicy: options.budgetPolicy,
  });

  const harness: Harness = {
    dir,
    store,
    backend,
    capability,
    service,
    reopen: () => {
      store.close();
      return createHarness({ ...options, dir });
    },
    dispose: () => {
      store.close();
      if (!options.dir) rmSync(dir, { recursive: true, force: true });
    },
  };
  return harness;
}

//
// Drive the scheduler the way the runtime does — one settled turn at a time —
// and stop when the Run reaches a terminal state or asks for a human. The
// bound exists so a defect shows up as a failed assertion instead of a hang.
//
export async function driveToSettled(
  harness: Harness,
  runId: string,
  maxSteps = 60,
): Promise<{ steps: number; status: string }> {
  for (let step = 0; step < maxSteps; step += 1) {
    const before = harness.store.requireRun(runId);
    if (
      before.status === "COMPLETED" ||
      before.status === "FAILED" ||
      before.status === "CANCELLED" ||
      before.status === "WAITING_USER"
    ) {
      return { steps: step, status: before.status };
    }
    await harness.service.onTurnSettled(runId);
  }
  return { steps: maxSteps, status: harness.store.requireRun(runId).status };
}
