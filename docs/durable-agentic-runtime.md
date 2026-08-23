# The durable agentic runtime

Local Studio can be handed a goal and left alone. This document describes what
was built, what it is measured to do, what policy it follows, and how it keeps
working when the model it is talking to changes shape.

It is the implementation record for the diagnosis written up as
`docs/DURABLE-AGENTIC-RUNTIME-P0.md` in the `local-ai-3090-stack` repository.
That document is the handoff and stays as written; this one is the answer.

Each claim below is labelled:

- **MEASURED** — observed on this machine, with the observation named.
- **IMPLEMENTED** — code that exists, with the file that holds it.
- **POLICY** — a decision, with its reason.
- **EVIDENCE** — the test or run that would fail if it stopped being true.

---

## 1. The defect this replaces

**MEASURED.** Compaction is a memory operation, and its return value was being
used as the answer to a different question: *should the agent keep working?*
On an autonomous run there was no queued human message, so the loop exited and
the task was abandoned silently. In a live rollout, 9 of 11 compactions were
followed by a human message rather than by the agent continuing.

Nothing in the system held the task, so compaction — the operation that
rewrites messages — was destroying the only copy of what was being done.

**IMPLEMENTED.** Task state now lives outside the model's context, in
`services/agent-runtime/src/agentic/`. A compaction checkpoints, rewrites the
active context, rebuilds a working set from the durable store, and schedules
the next inference itself.

---

## 2. Schema

**IMPLEMENTED.** `services/agent-runtime/src/agentic/schema.ts`. One STRICT
SQLite file, `agentic-runtime.sqlite`, beside the rest of the user data,
opened through the `bun:sqlite` / `node:sqlite` shim the Litter ledger already
proved (this package is typechecked by bun and shipped as `node dist/server.js`).

| table | holds |
|---|---|
| `agentic_runs` | goal, status, model + physical model + behaviour profile, context window, usable limit, plan revision, active task, cumulative input/output/cache tokens, compaction count, latest checkpoint, result, failure, recovery state |
| `agentic_plan_revisions` | revision number, why it happened, the resulting task id list |
| `agentic_tasks` | title, description, status, dependencies, acceptance criteria, attempt count, agent, result summary, evidence, blocker |
| `agentic_agents` | logical agent: role, status, model + physical model + behaviour profile, current task, session, active context, context limit, cumulative tokens, compactions, heartbeat |
| `agentic_attempts` | one row per attempt at a task: status, outcome, evidence, error |
| `agentic_tool_operations` | idempotency key, request hash, `PLANNED / STARTED / COMMITTED / FAILED / UNKNOWN`, whether it is side-effecting, external state |
| `agentic_artifacts` | externalised payloads: size, token estimate, digest, path, preview, provenance |
| `agentic_checkpoints` | tokens before/after, target, usable limit, duration, and the working set that was rebuilt |
| `agentic_events` | the timeline the owner sees |

**POLICY.** Every table is prefixed `agentic_`. `controller/src/stores/sqlite.ts`
sweeps a list of legacy names on every open — `runs`, `sessions`, `messages`,
`usage` — so a durable store called `runs` would be dropped out from under
itself. **EVIDENCE:** `agentic-profile-durability.test.ts` asserts no agentic
table takes a swept name.

The wire shapes are defined once, in `shared/agent/agentic-run.ts`, as Effect
Schemas: the same records the runtime persists are the records the view renders.

---

## 3. State machines

**IMPLEMENTED.** `services/agent-runtime/src/agentic/dag.ts`.

Run: `CREATED → PLANNING → RUNNING ⇄ PAUSED | WAITING_USER → COMPLETING →
COMPLETED | FAILED | CANCELLED`.

Task: `PENDING`, `READY`, `RUNNING`, `BLOCKED`, `WAITING_USER`, `SUCCEEDED`,
`FAILED`, `CANCELLED`.

**POLICY.** `READY` is derived, never stored as an opinion: a `PENDING` task
whose every dependency has `SUCCEEDED` is ready. A task whose dependency
`FAILED` or was `CANCELLED` is `BLOCKED` rather than merely waiting, because
nothing downstream will satisfy it without a plan revision. Cycles are rejected
when a plan is validated, not discovered when the scheduler starves.

**POLICY.** `WAITING_USER` is reachable only when the agent genuinely asks for
a human decision, credential or permission. A finished compaction, a finished
tool call and a finished task are the runtime's own business.

**EVIDENCE:** `agentic-dag.test.ts` (16 tests), plus
`agentic-compaction-resume.test.ts` for the `WAITING_USER` boundary.

---

## 4. The model capability contract

**MEASURED.** The gateway publishes, per model, on `GET /v1/models`:

```
metadata: { contextWindow, maxTokens, reasoning, nativeReasoning, tools,
            vision, displayName, physicalModelId, behaviorProfile,
            behaviorProfileLabel, behaviorProfileDefault, loadState, active }
```

Observed on 2026-08-21: `qwen-daily` 176128/32768 (`behaviorProfile: standard`,
`behaviorProfileDefault: true`), `qwen-uncensored` 176128/32768 over the same
`physicalModelId: qwen-daily`, `ornith-turbo` 196608/32768,
`gemma-write` 131072/32768.

**IMPLEMENTED.** `agentic/capability.ts` reads that record and nothing else.
`withRuntimeContextWindow()` lets the window the live session reports outrank
the catalogue, so a backend restarted with a different `-c` moves the budget of
a Run already in flight.

**POLICY.** No alias, window size or inference strategy is named in business
logic. Speculative decoding — MTP, DFlash, ngram, whatever comes next — is
invisible to a token budget by construction: the budget only reads tokens.

### How a 262K or 1M model works with no code change

Nothing has to happen. The reserves are fractions of whatever `contextWindow`
the contract declares, the usable limit is derived from it, and the
post-compaction target is a fraction of the usable limit. **EVIDENCE:**
`agentic-context-budget.test.ts` runs the identical policy at 32768, 131072,
176128, 196608, 262144 and 1048576 and asserts the reserves still add up and
the usable limit still grows. Two of those windows have never been served here.

---

## 5. Context budget

**IMPLEMENTED.** `agentic/context-budget.ts`.

```
usable = contextWindow
       - output reserve      clamp(maxTokens, 512, 25% of window)
       - reasoning reserve   4% of window, or 0 if the model declares no reasoning
       - tool result reserve max(1024, 8% of window), or 0 if it declares no tools
       - safety margin       max(256, 2% of window)
```

**POLICY.** There is no "95% then compact". Before every inference the runtime
asks whether `active working set + expected next operation` fits inside the
usable limit, and acts before sending an oversized request rather than after
being rejected. A payload large enough to be the sole cause of the overflow is
externalised instead of compacted around: rewriting memory to make room for one
build log is the wrong trade, and it would repeat on every retry.

**POLICY.** The post-compaction target is a region (≈35–50% of usable), not a
number to hit. A working set that legitimately needs less stays small; one that
needs more is allowed past the ceiling rather than mutilated into a summary
that cannot finish the task.

### The double-count, and the fresh-session guard

**MEASURED.** The first real-Qwen run failed before its first turn. The usable
limit already has the output reserve subtracted out of it, and the preflight
was adding it back as "the next operation" — so a narrowed budget looked
overflowed while the session held nothing but its system prompt, and the
backend refused to compact it.

**IMPLEMENTED.** The expected next operation is the prompt alone, and
compaction is skipped when the session is already at or below what the task
needs, because compaction can only remove what is *not* the working set.
**EVIDENCE:** two tests in `agentic-compaction-resume.test.ts` named for this
defect.

---

## 6. Compaction

**IMPLEMENTED.** `agentic/working-set.ts` and `agentic/scheduler.ts`.

```
checkpoint → externalise → compact → rebuild working set → resume
```

The working set is rebuilt **from the durable store**, never from the messages
being discarded. It carries the goal, the plan revision, the current task, its
acceptance criteria with the evidence already earned, the dependency outputs
the task actually needs, the decisions taken, artifact pointers, any tool call
still awaiting its result, unresolved errors, a recent tail, and the next
action.

Every compaction records: tokens before, tokens after, target, usable limit,
reason, duration, run and task id, and the working set itself. The run's
compaction count is cumulative, and it counts compactions **performed** — a
refusal leaves it, and the agent's, where they were.

**MEASURED.** A backend reports no context usage until the next turn produces
some, so `tokensAfter` is often absent rather than zero immediately after a
compaction. It is stored as measured-or-zero and the working-set estimate is
stored beside it as `targetTokens`; the timeline marks an estimate with a
tilde. Publishing the absent reading as zero would have been a measurement
nobody took.

**POLICY — loop guard.** A compaction that creates no headroom twice fails the
run with a diagnostic rather than compacting in a circle.

**EVIDENCE:** `agentic-compaction-resume.test.ts` — twelve tests, including one
that carries a single unfinished task through at least three
checkpoint/compact/resume cycles and asserts the task is still `RUNNING` after
each one, that every prompt sent is the rebuilt working set rather than the
word "continue", and that lifetime token counters never fall while the active
context does.

---

## 7. Large tool output

**IMPLEMENTED.** `agentic/store-operations.ts`. A payload is written to
`agentic-artifacts/<run>/<id>.txt`, and context receives a pointer, a size, a
digest, its provenance and a head/tail preview that names how much was elided.
Slices are retrievable later by id and offset, over
`GET /api/agent/artifacts/:id`.

**EVIDENCE:** `agentic-tool-operations.test.ts` externalises a four-thousand-line
build log and asserts the rebuilt context is more than ten times smaller than
the payload and does not contain its last line.

---

## 8. Idempotency and reconciliation

**IMPLEMENTED.** `agentic/store-operations.ts`, `agentic/recovery.ts`.

Every operation carries an idempotency key and a hash of its request:

| state found | what happens |
|---|---|
| nothing | reserved, `PLANNED` |
| same key, different request | `mismatch` — never a silent overwrite |
| `COMMITTED` | `cached` — served from the ledger, not redone |
| `STARTED`/`UNKNOWN`, side-effecting | `reconcile` — the real external state must be inspected first |
| `STARTED`, read-only | reserved — safe to retry |
| `FAILED` | reserved — nothing was committed |

On restart: agents whose process is gone become `INTERRUPTED`, never
`COMPLETED`; running attempts are settled as `INTERRUPTED`; `RUNNING` tasks
return to `PENDING`; `SUCCEEDED` tasks are preserved untouched; side-effecting
operations caught in flight become `UNKNOWN`. The run becomes `PAUSED` with a
recovery summary the owner can read.

**EVIDENCE:** `agentic-crash-recovery.test.ts` kills the process by throwing the
store away and reopening it on the same directory, so whatever survives had to
be on disk.

---

## 9. Scheduler

**IMPLEMENTED.** `agentic/scheduler.ts`, driven by `agentic/service.ts`.

**POLICY.** One local inference at a time. `prompt()` resolves when the turn is
done, so the loop *is* the turn sequencing; no event listener can advance a Run
twice, and no parallel GPU capacity is fabricated. Logical agents are durable
objects with independent contexts and their own tasks; five of them may be the
one resident checkpoint through five sessions, which is why every agent row
carries its physical model id and behaviour profile.

**POLICY — acceptance.** An agent saying "done" is a candidate for validation.
A task succeeds when every acceptance criterion carries evidence, reported as
`TASK_EVIDENCE <criterion-id>: <evidence>`. A claim of `TASK_COMPLETE` with
criteria still owed is recorded as `ACCEPTANCE_REJECTED` and the task stays
open with the missing evidence named.

**POLICY — stalls.** Progress is a fingerprint of what changed — satisfied
criteria, committed operations, new artifacts, the error signature — not of
what was said. Bounded attempts that move none of it trigger a plan revision;
bounded revisions that still move none of it fail the run with a reason.

**EVIDENCE:** `agentic-stall-replan.test.ts` asserts the run terminates in
bounded time, produces at most the allowed number of revisions, and re-points
the failing task at a diagnostic task rather than retrying it identically.

---

## 10. Profile semantics

**POLICY.** `physicalModelId` and `behaviorProfile` are persisted separately on
both the run and the agent, and nothing rewrites them — not compaction, not
recovery. The default profile is the one that declares itself
(`behaviorProfileDefault`), never whichever alias sorted first. A run started
without a declared profile carries none; uncensored is never implicit.

**EVIDENCE:** `agentic-profile-durability.test.ts`.

---

## 11. What the owner sees

`/runs` — `frontend/src/features/runs/`.

- **Run**: goal, status, elapsed, tasks done, plan revision, agents, inference
  slots, and three quantities kept separate — active context, lifetime spend,
  compaction count — plus the model and its window.
- **Tasks**: dependency-ordered, each showing what blocks it, every acceptance
  criterion with its evidence, and the attempt count.
- **Agents**: task, role, physical model and behaviour profile, context,
  lifetime spend, compactions.
- **Activity**: plan revisions, attempts, compactions (stating their own
  before/after numbers and that the task resumed automatically), acceptance
  decisions, artifacts, recovery.

**POLICY.** Observable execution only. No attempt is made to surface private
reasoning.

**POLICY.** Ordinary chat is not a Run and never becomes one. Historical
conversations are not migrated. The runs view is additive; the chat surface is
untouched.

---

## 12. Test architecture

`services/agent-runtime/test/` — deterministic, offline, run by hand with
`bun test` from that directory, as `AGENTS.md` requires. No new dependency, and
nothing wired into `npm run check`, CI or a git hook.

`test/support/agentic-backend.ts` is a deterministic stand-in for an inference
backend: configurable context window, predictable token accounting, scripted
turn outcomes, controllable errors, and an option to simulate a compaction that
frees nothing. Only the model is faked — the store is a real SQLite file and
the scheduler is the production one. That is what makes it possible to force a
dozen compactions in a millisecond rather than filling 176128 real tokens to
observe the third.

| file | covers |
|---|---|
| `agentic-dag.test.ts` | dependencies, cycles, readiness, selection |
| `agentic-context-budget.test.ts` | capability read-through, reserves at six windows, preflight, post-compaction region, the override |
| `agentic-compaction-resume.test.ts` | one compaction, ≥3 compactions on one unfinished task, working-set reconstruction, automatic resume, counters, loop guard |
| `agentic-tool-operations.test.ts` | call/result pairing, externalisation, exactly-once |
| `agentic-crash-recovery.test.ts` | restart after checkpoint, mid-task, around a tool operation |
| `agentic-profile-durability.test.ts` | profile restoration, declared default, ordinary chat untouched |
| `agentic-stall-replan.test.ts` | bounded retry, replan, no infinite loop |
| `agentic-review-findings.test.ts` | every state an adversarial review found the runtime could not leave |
| `agentic-control-plane.test.ts` | what the runtime accepts as a plan, and what it refuses |
| `agentic-control-tools.test.ts` | the tools under the names and shapes the model sees |
| `agentic-tool-interception.test.ts` | artifacts and idempotency on the real tool path |
| `agentic-multi-agent.test.ts` | two agents, independent contexts, one decode at a time |
| `agentic-inference-gate.test.ts` | one card decodes once; the owner goes first |

---

## 13. The autonomous control plane

**IMPLEMENTED.** The owner writes an ordinary prompt. The served model decides
whether that is a question or durable work, and if it is work, it plans it,
creates the Run and drives it. Nothing about that path asks the owner to press
anything.

### The tools

`agentic/control-tools.ts` registers four tools on **every** chat session,
because deciding that a request is durable work is the model's to make and a
session that could not reach the tools could never make it.

| tool | what the model proposes |
|---|---|
| `plan_agentic_run` | a goal, tasks with dependencies and acceptance criteria, optionally named agents |
| `revise_agentic_plan` | a replacement plan, when what it learned means the current one cannot work |
| `report_task_progress` | evidence against a task's criteria, or that it is blocked, or a question only the owner can answer |
| `read_agentic_artifact` | part of a large output the runtime stored outside the conversation |

**POLICY — the model proposes, the runtime decides.** There is no tool that
writes a row, sets a status or invents an id. `agentic/control-plane.ts`
validates every proposal: titles unique, dependencies inside the plan, the DAG
acyclic, at least one acceptance criterion per task, and bounds — twelve tasks,
six criteria, four agents — so a trivial request cannot become a twelve-task
DAG and a confused model cannot fill the store. A rejected proposal comes back
with a reason it can act on rather than a silent failure.

**POLICY — the Run a conversation drives is resolved from the session**, never
taken from the model, which removes a class of both mistake and mischief.

### Routing

**POLICY.** No keyword classifier. The rule reaches the model as a section of
its system prompt (`before_agent_start`, the same seam the session goal uses)
and the tools advertise themselves through `promptSnippet` and
`promptGuidelines`. The decision is native tool-calling.

A question, an explanation or a single small edit stays ordinary chat and
creates nothing. **EVIDENCE:** `agentic-control-tools.test.ts` drives the tools
under the exact names and argument shapes the model sees, and asserts that a
turn which calls no tool leaves the store empty.

### Structured reporting

**IMPLEMENTED.** `agentic_turn_signals`. A turn that called the reporting tool
has already had its evidence validated and committed; the scheduler adjudicates
from those signals. Prose markers still parse as a fallback for a turn that
reported in words, but no state transition depends on the model spelling a
magic string correctly any more.

### Real tool execution

**IMPLEMENTED.** `agentic/tool-interceptor.ts` hooks `tool_call` and
`tool_result` on the same session, and both stand down outside a Run so
ordinary chat is untouched.

- An output over the preview budget becomes a durable artifact; what reaches
  the model is a reference, its size, and the head and tail. It can read any
  other part with `read_agentic_artifact`, and nothing re-pastes the payload.
- A side-effecting operation (`bash`, `write`, `edit`) is reserved in the ledger
  before it runs and recorded after. One caught in flight when a process died
  is **blocked** until the model has checked the real external state.
  Deliberately re-running the same command is still allowed and left in the
  record — exactly-once applies where it must, across a crash, not to a
  legitimate second `npm test`.

### Agents and the card

**IMPLEMENTED.** Each logical agent gets its own runtime session, so its
working context, compaction history and checkpoints are its own; compacting one
cannot touch another. **EVIDENCE:** `agentic-multi-agent.test.ts`.

**POLICY.** One process-wide gate (`agentic/inference-gate.ts`) serialises every
decode — a Run's turns and the owner's chat both queue in it, because the
scheduler serialising only its own turns still allowed a chat turn and a Run
turn to decode together on one card. Interactive work is taken first, so an
overnight Run never makes the owner wait minutes to be answered.

## 14. What the card found

**MEASURED.** Running this against the resident Qwen found four defects the
offline battery could not, each now pinned by a test: the usable limit already
excludes the output reserve and the preflight was adding it back; the session
adapter was rebuilt on every step, so every turn reported zero tokens; a
backend refusing to compact a session it considers too short ended a healthy
run; and a step that ended without prompting read the previous turn again.

**MEASURED.** An adversarial review of the result raised sixteen candidates and
confirmed eleven, including a task with no acceptance criteria that could never
finish, a cancel overwritten back to `RUNNING` mid-step, a restart that failed a
run which was only waiting on the owner, and a create-run endpoint that did not
confine its working directory to `WORKSPACE_ROOTS`. All are fixed and pinned in
`agentic-review-findings.test.ts`.

**EVIDENCE.** Final verification on the shipped build: a fourteen-task chain
against `qwen-daily` (window 176128 read live, scheduler budget narrowed to
30000), **7 checkpoint → compact → automatic resume cycles**, every task
succeeded, 312085 input / 37917 output cumulative, one plan revision never
needed, profile `qwen-daily`/`standard` unchanged, and no manual "continue".

## 15. The end-to-end override

`LOCAL_STUDIO_AGENTIC_USABLE_CONTEXT` narrows the **scheduler's** usable
context for a long run against the real card, so several genuine
checkpoint/compact/resume cycles happen in minutes instead of hours. It touches
neither the model nor the served window, it can only ever narrow (a wider value
is ignored), and it is unset in production. It is read once, in
`agentic/service.ts`, and flows in as an ordinary policy parameter.
