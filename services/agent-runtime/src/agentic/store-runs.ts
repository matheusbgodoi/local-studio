//
// Runs, plan revisions and tasks.
//
// A Run is the durable copy of what the agent is doing. Cumulative token
// counters are additive and never reset: a compaction lowers the ACTIVE
// context and leaves lifetime spend alone, and conflating the two is what made
// a healthy compaction read as lost work.
//

import { randomUUID } from "node:crypto";

import type { AcceptanceCriterion, AgenticEvent, AgenticRun, AgenticTask } from "./contract";
import { toEvent, toRun, toTask } from "./rows";
import { buildPatch, type AgenticStoreContext } from "./store-context";
import { withTransaction } from "./schema";
import type { NetworkPolicy } from "../../../../shared/agent/network-policy";

export type CreateRunInput = {
  goal: string;
  modelId: string;
  physicalModelId: string;
  behaviorProfile: string | null;
  contextWindow: number;
  usableLimit: number;
  sessionId: string;
  piSessionId: string | null;
  cwd: string;
  networkPolicy: NetworkPolicy;
};

export type TaskSeed = {
  id?: string;
  title: string;
  description: string;
  dependencies: readonly string[];
  acceptance: readonly AcceptanceCriterion[];
};

const RUN_COLUMNS: Record<string, string> = {
  status: "status",
  piSessionId: "pi_session_id",
  planRevision: "plan_revision",
  activeTaskId: "active_task_id",
  compactionCount: "compaction_count",
  latestCheckpointId: "latest_checkpoint_id",
  resultSummary: "result_summary",
  failureReason: "failure_reason",
  recoveryState: "recovery_state",
  archivedAtMs: "archived_at_ms",
  contextWindow: "context_window",
  usableLimit: "usable_limit",
  modelId: "model_id",
  physicalModelId: "physical_model_id",
  behaviorProfile: "behavior_profile",
};

const TASK_COLUMNS: Record<string, string> = {
  status: "status",
  agentId: "agent_id",
  resultSummary: "result_summary",
  blocker: "blocker",
  attemptCount: "attempt_count",
  startedAtMs: "started_at_ms",
  settledAtMs: "settled_at_ms",
};

export function createRunStore(context: AgenticStoreContext) {
  const { all, one, database, ms, appendEvent } = context;

  const getRun = (id: string): AgenticRun | null => {
    const row = one("SELECT * FROM agentic_runs WHERE id = ?", id);
    return row ? toRun(row) : null;
  };

  const requireRun = (id: string): AgenticRun => {
    const run = getRun(id);
    if (!run) throw new Error(`Unknown agentic run: ${id}`);
    return run;
  };

  const getTask = (id: string): AgenticTask | null => {
    const row = one("SELECT * FROM agentic_tasks WHERE id = ?", id);
    return row ? toTask(row) : null;
  };

  const requireTask = (id: string): AgenticTask => {
    const task = getTask(id);
    if (!task) throw new Error(`Unknown agentic task: ${id}`);
    return task;
  };

  const listTasks = (runId: string): AgenticTask[] =>
    all("SELECT * FROM agentic_tasks WHERE run_id = ? ORDER BY position ASC", runId).map(toTask);

  const createRun = (input: CreateRunInput): AgenticRun =>
    withTransaction(database, () => {
      const id = `run_${randomUUID()}`;
      const at = ms();
      context.run(
        `INSERT INTO agentic_runs(id, goal, status, model_id, physical_model_id, behavior_profile,
           network_policy, context_window, usable_limit, session_id, pi_session_id, cwd,
           created_at_ms, updated_at_ms)
         VALUES (?,?,'CREATED',?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        input.goal,
        input.modelId,
        input.physicalModelId,
        input.behaviorProfile,
        input.networkPolicy,
        input.contextWindow,
        input.usableLimit,
        input.sessionId,
        input.piSessionId,
        input.cwd,
        at,
        at,
      );
      appendEvent({ runId: id, type: "RUN_CREATED", summary: input.goal });
      return requireRun(id);
    });

  const updateRun = (id: string, patch: Partial<AgenticRun>): AgenticRun => {
    const { assignments, values } = buildPatch(RUN_COLUMNS, patch as Record<string, unknown>);
    if (assignments.length === 0) return requireRun(id);
    assignments.push("updated_at_ms = ?");
    context.run(
      `UPDATE agentic_runs SET ${assignments.join(", ")} WHERE id = ?`,
      ...values,
      ms(),
      id,
    );
    return requireRun(id);
  };

  const addRunUsage = (
    id: string,
    usage: { input?: number; output?: number; cache?: number },
  ): AgenticRun => {
    context.run(
      `UPDATE agentic_runs SET
         cumulative_input_tokens = cumulative_input_tokens + ?,
         cumulative_output_tokens = cumulative_output_tokens + ?,
         cumulative_cache_tokens = cumulative_cache_tokens + ?,
         updated_at_ms = ?
       WHERE id = ?`,
      Math.max(0, Math.floor(usage.input ?? 0)),
      Math.max(0, Math.floor(usage.output ?? 0)),
      Math.max(0, Math.floor(usage.cache ?? 0)),
      ms(),
      id,
    );
    return requireRun(id);
  };

  //
  // A revision rewrites the shape of the plan without forgetting the work
  // already accepted: a task carried across by id or title keeps its status,
  // attempts and evidence.
  //
  const recordPlanRevision = (input: {
    runId: string;
    reason: string;
    tasks: TaskSeed[];
  }): { revision: number; tasks: AgenticTask[] } =>
    withTransaction(database, () => {
      const run = requireRun(input.runId);
      const revision = run.planRevision + 1;
      const at = ms();
      const byTitle = new Map(listTasks(input.runId).map((task) => [task.title, task] as const));

      const carriedFor = (seed: TaskSeed) => (seed.id ? getTask(seed.id) : byTitle.get(seed.title));
      const ids = input.tasks.map((seed) => carriedFor(seed)?.id ?? seed.id ?? `task_${randomUUID()}`);
      const idByTitle = new Map(input.tasks.map((seed, index) => [seed.title, ids[index] as string]));

      input.tasks.forEach((seed, position) => {
        const carried = carriedFor(seed);
        const id = ids[position] as string;
        const dependencies = JSON.stringify(
          seed.dependencies.map((dependency) => idByTitle.get(dependency) ?? dependency),
        );
        //
        // Evidence belongs to the claim it proved, not to a position in a list.
        // A criterion the revision restated is a different claim and starts
        // unproven; one it kept keeps what was already shown, or the model
        // would be made to prove the same thing twice and the stall detector
        // would read that as no progress.
        //
        const provenByDescription = new Map(
          (carried?.acceptance ?? [])
            .filter((criterion) => criterion.satisfied)
            .map((criterion) => [criterion.description, criterion.evidence] as const),
        );
        const acceptance = JSON.stringify(
          seed.acceptance.map((criterion) =>
            provenByDescription.has(criterion.description)
              ? {
                  ...criterion,
                  satisfied: true,
                  evidence: provenByDescription.get(criterion.description) ?? null,
                }
              : criterion,
          ),
        );
        if (carried) {
          context.run(
            `UPDATE agentic_tasks SET plan_revision = ?, position = ?, title = ?, description = ?,
               dependencies_json = ?, acceptance_json = ?, updated_at_ms = ? WHERE id = ?`,
            revision,
            position,
            seed.title,
            seed.description,
            dependencies,
            acceptance,
            at,
            id,
          );
          return;
        }
        context.run(
          `INSERT INTO agentic_tasks(id, run_id, plan_revision, position, title, description, status,
             dependencies_json, acceptance_json, created_at_ms, updated_at_ms)
           VALUES (?,?,?,?,?,?,'PENDING',?,?,?,?)`,
          id,
          input.runId,
          revision,
          position,
          seed.title,
          seed.description,
          dependencies,
          acceptance,
          at,
          at,
        );
      });

      //
      // A task the revision left out is no longer work. Finished work stays
      // finished — it happened — but anything unfinished is cancelled with the
      // reason, so the scheduler cannot pick up a task the plan has dropped.
      //
      const kept = new Set(ids);
      for (const existing of listTasks(input.runId)) {
        if (kept.has(existing.id)) continue;
        if (existing.status === "SUCCEEDED" || existing.status === "CANCELLED") continue;
        context.run(
          "UPDATE agentic_tasks SET status = 'CANCELLED', blocker = ?, settled_at_ms = ?, updated_at_ms = ? WHERE id = ?",
          `dropped by plan revision ${revision}: ${input.reason}`,
          at,
          at,
          existing.id,
        );
        appendEvent({
          runId: input.runId,
          taskId: existing.id,
          type: "TASK_CANCELLED",
          summary: `dropped by plan revision ${revision}`,
        });
      }

      context.run(
        "INSERT INTO agentic_plan_revisions(run_id, revision, reason, dag_json, created_at_ms) VALUES (?,?,?,?,?)",
        input.runId,
        revision,
        input.reason,
        JSON.stringify(ids),
        at,
      );
      context.run(
        "UPDATE agentic_runs SET plan_revision = ?, updated_at_ms = ? WHERE id = ?",
        revision,
        at,
        input.runId,
      );
      appendEvent({
        runId: input.runId,
        type: revision === 1 ? "PLAN_CREATED" : "PLAN_REVISED",
        summary: input.reason,
        detail: { revision, taskIds: ids },
      });
      return { revision, tasks: listTasks(input.runId) };
    });

  const updateTask = (
    id: string,
    patch: Partial<AgenticTask> & {
      acceptance?: readonly AcceptanceCriterion[];
      evidence?: readonly string[];
    },
  ): AgenticTask => {
    const { assignments, values } = buildPatch(TASK_COLUMNS, patch as Record<string, unknown>);
    if (patch.acceptance !== undefined) {
      assignments.push("acceptance_json = ?");
      values.push(JSON.stringify(patch.acceptance));
    }
    if (patch.evidence !== undefined) {
      assignments.push("evidence_json = ?");
      values.push(JSON.stringify(patch.evidence));
    }
    if (patch.dependencies !== undefined) {
      assignments.push("dependencies_json = ?");
      values.push(JSON.stringify(patch.dependencies));
    }
    if (assignments.length === 0) return requireTask(id);
    assignments.push("updated_at_ms = ?");
    context.run(
      `UPDATE agentic_tasks SET ${assignments.join(", ")} WHERE id = ?`,
      ...values,
      ms(),
      id,
    );
    return requireTask(id);
  };

  return {
    createRun,
    getRun,
    requireRun,
    updateRun,
    addRunUsage,
    listRuns: (): AgenticRun[] =>
      all("SELECT * FROM agentic_runs ORDER BY created_at_ms DESC").map(toRun),
    listUnfinishedRuns: (): AgenticRun[] =>
      all(
        "SELECT * FROM agentic_runs WHERE status NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY created_at_ms DESC",
      ).map(toRun),
    recordPlanRevision,
    listTasks,
    getTask,
    requireTask,
    updateTask,
    listEvents: (runId: string, afterId = 0): AgenticEvent[] =>
      all(
        "SELECT * FROM agentic_events WHERE run_id = ? AND id > ? ORDER BY id ASC",
        runId,
        afterId,
      ).map(toEvent),
  };
}
