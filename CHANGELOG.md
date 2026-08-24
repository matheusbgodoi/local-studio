# Changelog — owner fork

Owner builds of this fork. Upstream's own history is in
[`sybil-solutions/local-studio`](https://github.com/sybil-solutions/local-studio/releases)
and is not repeated here.

Versioning is `<upstream base>-local.<n>` — see
[`docs/upstream-updates.md`](docs/upstream-updates.md).

## v2.1.0-local.14 — 2026-08-24

The Browser toggle is gone and a network policy takes its place. Base:
upstream `v2.1.0`.

**The toggle answered the wrong question.** Turning the browser off never
removed the agent's internet — `bash`, `curl`, Python, Node, `git`, `npm`, an
API and any MCP connector were all still there — so it described a tool list
while appearing to describe a route. The browser is now an ordinary capability,
always loaded, and the model chooses between it and the shell on the merits.

**VPN Protected replaces it**, in the chat's own session controls rather than in
settings. Direct is the machine's normal route; Protected means an agent
workload has no permitted direct path to the public internet, and losing the
tunnel blocks public egress instead of falling back to it.

**The boundary is a macOS Seatbelt jail**, not a proxy variable. A jailed
process may reach exactly one destination — the loopback port sing-box listens
on — the jail is inherited across `exec`, it cannot be widened from inside, and
it needs no privilege. Fail-closed is therefore structural: when the tunnel
dies there is no second path, because none was ever permitted. sing-box TUN was
rejected (needs root, and `IP_BOUND_IF` walks around the routing table); a pf
group rule was rejected (blind to ICMP, and setuid binaries create sockets it
cannot see). Both were measured here before being ruled out.

Covered by the jail: the model's `bash` tool and everything it starts, the
owner's terminal, local MCP stdio connectors, and Chromium in headless, headful
and `browser_verify`. Covered in code and fail-closed the same way, but not by
the kernel: the in-process reader and `browser_search`. That distinction is
surfaced in the status popover rather than rounded up.

**Enforcement and attestation are separate.** `failClosed` is read from whether
the jail exists, never from a probe — an exit-IP lookup is telemetry, not a
firewall. Observations are three-valued so an unmeasured field says
`unavailable` rather than borrowing the good news next to it.

**A Run keeps the policy it was born with**, as a durable column, through
compaction, resume, restart and crash recovery. Moving the toggle starts the
next Run somewhere else; it does not re-route one in flight. A lost tunnel
pauses a protected Run the way a lost backend does, and a restored one resumes
it. On boot, protected Runs re-register before anything can resume, so the
boundary is up before the first turn is possible.

**Isolation is conservative and says so.** The agent-runtime is one process
shared by every conversation, so while any workload is protected all agent
traffic is. A Direct conversation temporarily using the VPN is acceptable; a
protected workload occasionally using the direct route is not.

The Run a conversation started is now also followable from the chat's right
sidebar, reusing the existing Runs store and components. The global `/runs`
page is unchanged.

`npm run test:network-protection` is an acceptance run against the real
machine. It found two defects in this work: a CONNECT acknowledged before its
upstream existed was being read as proof of protection, and the exit address was
parsed positionally from a service that returns fields in its own order.

Docs: [`docs/protected-networking.md`](docs/protected-networking.md).

## v2.1.0-local.13 — 2026-08-23

The autonomous control plane, qualified against the final Phase 4 host. Base:
upstream **2.1.0**. Source only; no binary is published.

- **A task now settles when its evidence closes, not one inference later.** The
  runtime only adjudicated between turns, and this model does thirty tool calls
  inside one. A task reported with every criterion satisfied stayed `RUNNING`,
  its dependents stayed `BLOCKED` with the edges already gone, and the model
  burned two plan revisions working around a gate that had in fact been met.
  Readiness is now derived wherever the shape of a plan changes, and the
  dependency guard asks the dependencies themselves rather than a stored label.
- **Losing the backend pauses a run instead of ending it.** The machine serving
  the model dropped off the network mid-run; the drive loop threw `fetch
  failed` and the run went to `FAILED`, which is terminal — three proved tasks
  and two checkpoints became unreachable. A lost backend is now the same
  accident as a lost process and takes the same road: reconcile, keep every
  proved task, reopen as `PAUSED`. Only an error about the *work* ends a run.
- [`docs/durable-agentic-runtime.md`](docs/durable-agentic-runtime.md) records
  the final acceptance run against the released Phase 4 host.

## v2.1.0-local.12 — 2026-08-22

Base: upstream **2.1.0**. Source only; no binary is published.

- **Compaction counters count compactions performed, not attempted.** A backend
  that refuses to compact a session it considers too short was bumping the
  agent's counter but not its Run's, so an agent read one higher than the Run it
  belongs to — visible in the final verification against the card, where the Run
  said 7 and its agent said 8.
- [`docs/durable-agentic-runtime.md`](docs/durable-agentic-runtime.md) now
  records what running against the card found, what the adversarial review
  found, and the final verification numbers: a fourteen-task chain, **7
  checkpoint → compact → automatic resume cycles**, every task satisfied, no
  manual "continue".

## v2.1.0-local.11 — 2026-08-21

Eleven states the durable runtime could reach and never leave, found by an
adversarial review of the previous build and each pinned by a test. Base:
upstream **2.1.0**. Source only; no binary is published.

### Runs that could not finish, and Runs that would not stop

- **A task that declared no acceptance criteria could not finish.** It could not
  succeed, it drew no rejection either — so the working set never told the model
  what was missing — and the stall detector eventually failed the whole Run over
  it. The claim is now the gate when there is nothing to prove.
- **Cancelling during a step resurrected the Run.** A launch awaits the backend
  before it writes; a cancel landing in that window was overwritten back to
  `RUNNING`, leaving a live-looking Run with no loop driving it.
- **A Run that stopped to ask a question came back from a restart as `PAUSED`**,
  and the next resume found nothing runnable and failed a Run that was only ever
  waiting. It returns as `WAITING_USER` now, pointing at the task that asked.
- **A step that ends without prompting re-read the previous turn** — charging a
  second attempt, counting its tokens twice, and knocking a waiting task back to
  pending. A turn is now identified by which turn it was rather than by what it
  said, so a model repeating itself word for word still gets read.
- **A rejected turn** left its attempt and task `RUNNING` under a Run about to
  fail, hiding the work from the view and from restart reconciliation.
- **A resumed Run double-counted its whole lifetime spend**, because the usage
  baseline started empty against a rollout that already held every earlier turn.

### Boundaries

- **The create-run endpoint accepted any working directory.** Every sibling
  route confines it to `WORKSPACE_ROOTS`, and a Run drives tools with full
  access, so this was the last place that should have been the exception.
- **An acceptance `kind` was cast from arbitrary input** into a type the
  owner-facing schema accepts only five values for, so one bad request could
  permanently break snapshot decoding for that Run.

### Smaller

- A fractional context override floored to a usable budget of zero.
- The window moving mid-run left the stored usable limit behind.
- The fallback capability named an output size instead of deriving one from the
  window it was given.
- A snapshot that failed to load left a spinner with no explanation.

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
