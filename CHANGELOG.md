# Changelog — owner fork

Owner builds of this fork. Upstream's own history is in
[`sybil-solutions/local-studio`](https://github.com/sybil-solutions/local-studio/releases)
and is not repeated here.

Versioning is `<upstream base>-local.<n>` — see
[`docs/upstream-updates.md`](docs/upstream-updates.md).

## v2.1.0-local.10 — 2026-08-21

Durable agentic runtime. Base: upstream **2.1.0**. Source only; no binary is
published. Owner builds `-local.2` through `-local.9` were tagged without a
changelog entry and are not backfilled here.

### A goal survives its own compaction

- **The defect.** Compaction is a memory operation, and its return value was
  being used as the answer to a different question: *should the agent keep
  working?* On an autonomous run there is no queued human message, so the loop
  exited and the task was abandoned in silence. Measured in a live rollout on
  the reference rig: **9 of 11 compactions were followed by a human message
  rather than by the agent continuing.**
- **Runs, Tasks and Agents are now durable records** in their own STRICT SQLite
  file, outside the model's context. A compaction checkpoints, rewrites the
  active context, rebuilds a working set **from the store rather than from the
  messages being discarded**, and schedules the next inference itself. The same
  task stays `RUNNING`. Nobody types "continue".
- The rebuilt working set carries the goal, the plan revision, the task, its
  acceptance criteria **with the evidence already earned**, the dependency
  outputs it needs now, the decisions taken, artifact pointers, any tool call
  still awaiting its result, and the next action.
- **A task DAG with derived readiness.** `READY` is never stored as an opinion;
  a dependency that `FAILED` blocks rather than delays; cycles are rejected when
  a plan is validated, not discovered when the scheduler starves.
- **"Done" is a candidate, not a verdict.** A task succeeds when every
  acceptance criterion carries evidence. A completion claim with criteria still
  owed is recorded and the task stays open with the missing evidence named.
- **Repeated non-progress replans, bounded.** Progress is a fingerprint of what
  changed — satisfied criteria, committed operations, new artifacts, the error
  signature — not of what was said.

### Nothing is baked to one model

- Context reserves are fractions of whatever `contextWindow` the serving
  contract declares, read from `/v1/models`. The same policy is exercised at
  **32768, 131072, 176128, 196608, 262144 and 1048576** — two of which this rig
  has never served — and a window the live session reports outranks the
  catalogue, so a backend restarted with a different `-c` moves the budget of a
  run already in flight. No alias, window size or decoding strategy appears in
  business logic.
- `physicalModelId` and `behaviorProfile` are persisted separately and never
  rewritten by compaction or recovery. The default profile is the one that
  **declares** itself; uncensored is never implicit.

### Crashes, side effects and large payloads

- On restart, an agent whose process is gone becomes `INTERRUPTED`, never
  `COMPLETED`; completed tasks are not redone; a side-effecting operation caught
  in flight becomes `UNKNOWN` and must be reconciled against the real external
  state rather than replayed.
- A committed operation is served from the ledger on retry. The same key with a
  different request is a mismatch, never a silent overwrite.
- **Large tool output is externalised**, not re-pasted: a four-thousand-line
  build log becomes an artifact with a digest, a provenance note and a preview
  that says how much was elided, retrievable later by slice.

### What the owner sees

- A **Runs** view: the run and its progress, the task graph with every
  acceptance criterion and its evidence, the logical agents — each naming its
  physical model and behaviour profile, so five agents never read as five cards
  — and an activity list where a compaction states its own before/after numbers
  and that the task resumed automatically.
- **Three quantities are no longer collapsed into one**: active context, which a
  compaction is supposed to lower; lifetime spend, which never moves down; and
  the compaction count. That conflation is what made a healthy compaction read
  as lost work.
- Ordinary chat is not a Run and never becomes one. Historical conversations are
  not migrated.

### Gates

- `npm run check` had been red on `main` since the on-device dictation work:
  `audit-layout` asserts the tracked executable set exactly, and
  `frontend/desktop/speech/build.sh` was added with the executable bit its own
  usage text depends on. Neither the pre-push hook nor the CI gates job runs
  that step, so nothing said so. The helper stays executable and the audit now
  expects it.

## v2.1.0-local.1 — 2026-08-19

First tagged owner build. Base: upstream **2.1.0** (`eeeb3406`). Source only; no
binary is published. See the
[release](https://github.com/matheusbgodoi/local-studio/releases/tag/v2.1.0-local.1).

### Usage: tokens, energy, efficiency

- Usage rebuilt around three tabs — **Tokens**, **Energy**, **Efficiency** — over
  a shared Today / 7D / 30D / 365D / All period and an all-models-or-one filter,
  aggregated on the rig rather than in the browser.
- **Processed tokens** replaced the old headline. Cached prompt reuse is no longer
  counted as work: on the reference rig, 44.40M of 46.14M logical tokens were
  cache reuse and 1.73M were actually processed.
- Throughput reads llama.cpp's own `timings`, never HTTP duration; context
  pressure is measured against the resident server's own window.
- **GPU board energy** with coverage accounting — an unmeasured hour is unknown,
  never zero — and efficiency in processed tokens per kWh.
- Currency, electricity rate and calendar timezone as user preferences. **No cost
  is ever stored**, so correcting the rate re-prices all of history at once.
- The `Sessions` tile was removed: it was always 0 and read as "you used nothing".

### Web search and browsing

- **`browser_search`** — keyless discovery via DuckDuckGo's HTML frontend with a
  single Lite fallback. No API key, account, container or daemon. It lives in the
  Browser extension, so the Browser toggle gates it like every other browser tool.
- Reader-first page reading through the existing SSRF-guarded transport, with the
  rendered browser as fallback.
- **Human verification**: challenges are detected, retries stop, and the page is
  handed to the owner in a visible window on the same browser profile.
  **Automated CAPTCHA bypass is deliberately not implemented.**
- The browser profile moved out of `os.tmpdir()` into `<userData>/browser-profile`,
  because it now holds cookies from sites the owner verified or signed in to.

### Documentation and licensing

- `NOTICE` added: the Apache-2.0 §4(b) record of what this fork modified.
- The README's Download section no longer hands readers the upstream DMG without
  saying what installing it costs.
- `AGENTS.md` reconciled with the tree it describes.
