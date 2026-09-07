# Production readiness work — 2026-09-07

## Source lineage

The owner's starting checkout was clean at `64a7cda3c`, on
`fix/chat-survives-context-wall-20260830`, with 16 unpublished local commits.
Those commits and the original worktree remain intact.

The work branch was created from the fork's `dev` (`a765eb27b`), then rebased
onto the owner's customized product before fixes. That dev line diverged by
25 upstream commits from the owner line, including removal of plan/inspector
surfaces and changes to automated tests that the owner explicitly forbids
restoring. A trial merge showed seven conflicting paths. Adopting it wholesale
would conflate unrelated upstream UI changes with product hardening.

The ancestry merge therefore deliberately retains the current owner source
with Git's `ours` strategy. It does not claim those upstream changes were
implemented. This makes the PR target `dev` explicit without overwriting the
customized product or restoring deleted tests. All subsequent fixes are small
normal commits; git hooks remain enabled. No protected branch was pushed.

## Verified milestones and outstanding acceptance

The first integrated `npm run check` passed after the status, Settings, Pi
terminal-error, task-description and subagent lifecycle fixes. It includes
static analysis, type checks and production builds, not automated test suites.
An initial attempt with borrowed dependency symlinks failed while assembling
the standalone bundle; installing the locked dependencies in this isolated
worktree through `npm run setup` corrected the environment and the gate passed.

The existing runtime-only deterministic checks verify SDK terminal errors,
continuation, independent context reserves, retained task descriptions,
subagent restrictions/cancellation, repeated compaction and checkpoint
measurement provenance. Passing these does not establish installed acceptance.

Authenticated profiling of the old installed app reproduced Settings' unhandled
setup-request failures. The fixes are in source; a candidate installation and
repeated authenticated profiling, offline/recovery flows, real tool execution
and long-conversation compaction remain required before promotion.

Related evidence: [status](status-readiness-2026-09-07.md),
[subagents](subagent-readiness-2026-09-07.md),
[context and durable work](durable-agentic-runtime.md).
