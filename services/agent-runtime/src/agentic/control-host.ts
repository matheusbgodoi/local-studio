//
// The slot the control tools read the live runtime out of.
//
// pi-runtime registers the tool extension on every session, and the tools need
// the durable runtime. Importing it directly would close a cycle
// (service -> pi-runtime -> control-tools -> service), so the runtime pushes
// itself in here at boot and the tools pull it out when a handler runs.
//

import type { AgenticCapability } from "./capability";
import type { AgenticRun, AgenticTask } from "./contract";
import type { ProgressReport, ValidatedPlan } from "./control-plane";
import type { ProgressOutcome } from "./control-service";
import type { AgenticStore } from "./store";

export type AgenticControlHost = {
  store: AgenticStore;
  /** The Run this chat session is currently driving, if any. */
  activeRunForSession: (sessionId: string, piSessionId?: string | null) => AgenticRun | null;
  /** Commit a validated plan and start driving it. */
  startRun: (input: {
    plan: ValidatedPlan;
    modelId: string;
    sessionId: string;
    piSessionId: string | null;
    cwd: string;
  }) => Promise<{ run: AgenticRun; tasks: AgenticTask[]; agentNames: string[] }>;
  revisePlan: (input: { runId: string; reason: string; plan: ValidatedPlan }) => {
    run: AgenticRun;
    tasks: AgenticTask[];
    agentNames: string[];
  };
  reportProgress: (input: {
    runId: string;
    taskId: string;
    report: ProgressReport;
  }) => ProgressOutcome;
  readArtifact: (artifactId: string, offset: number, length: number) => string | null;
  capabilityForRun: (run: AgenticRun) => AgenticCapability;
};

let host: AgenticControlHost | null = null;

export function setAgenticControlHost(next: AgenticControlHost): void {
  host = next;
}

export function agenticControlHost(): AgenticControlHost | null {
  return host;
}
