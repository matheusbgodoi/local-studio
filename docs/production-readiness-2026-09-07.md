# Production readiness work — 2026-09-07

## Current installed outcome

Final11 source `3c44bf00` is installed in both desktop channels; the stable app is running normally with Qwen Standard/XHigh as its durable native default. Complete checks and both official desktop builds passed. Actual Electron acceptance verified visible admission failures, restored drafts, safe automatic defaults, persisted preferences after restart and an externally witnessed tool write. The [final receipt](installed-candidate-2026-09-07.md#final11-stable-installation-and-native-electron-acceptance) records hashes and limits. The Golden inference backend remains selected after the bounded challenger campaign; no universal 99% quality claim is made.

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
setup-request failures. The subsequent candidate installations and acceptance results are tracked in
[the installed receipt](installed-candidate-2026-09-07.md) and the status evidence.
That receipt now includes actual threshold compaction at 190,073 backend tokens,
externally verified memory-only continuation and bounded cancellation. Those
results do not establish every workflow. Final10 additionally proved durable interrupted-child discovery after a fresh process restart; see the latest milestones in that chronological receipt.

Related evidence: [status](status-readiness-2026-09-07.md),
[subagents](subagent-readiness-2026-09-07.md),
[context and durable work](durable-agentic-runtime.md).

## Push validation

The first push was blocked because the old hook rechecked an upstream `test:`
commit already present on the fork's dev branch. Outgoing validation now excludes
commits already reachable from that remote's tracking refs, while validating
every new outgoing subject. Direct pushes to dev/main and the full static,
cleanup and standalone gates remain enforced. This fixes history selection;
it does not disable hooks or permit new nonconventional commits.

## Installed acceptance candidate

The integrated source at `bbb78a9cff0f50ce0cdf7c25cb34a01011e3cc52`
passed `npm run setup`, `npm run check` and
`npm --prefix frontend run desktop:dist:dev`. The generated dev app identifies
as `org.local.studio.desktop.dev`, version 2.1.0, with Next build
`mtqrwv7q58dh7l`. Its DMG SHA-256 is
`d60c132ba3c9993e6600f4f21d0390586b288b91c731dbe272e85c6a74abbe7e`.

The documented `scripts/install-desktop-app.sh dev` installed and verified the
ad-hoc-signed owner build. It was launched with an explicit isolated user-data
directory, `Local Studio Acceptance 20260907`. The compiled one-way mirror
copied existing histories and configuration; SQLite's read-only backup API
copied durable task state, and local memory/artifacts were copied separately.
At that initial isolated milestone, the stable application's data was not migrated or modified. Final10 was subsequently installed in the stable channel after a private recovery snapshot; its original projects and histories loaded, and one synthetic acceptance project was added. The task snapshot
contained three cancelled, three completed, one failed and one paused run;
none was running. A fresh private frontend token gates the acceptance instance.

The installed candidate started its packaged Next frontend and dedicated Pi
runtime successfully. Authenticated browser profiling observed Settings with
zero uncaught exceptions and zero console errors, compared with the reproduced
setup-request exceptions in the old installation. Read-only API requests loaded
22 sessions, five projects, one memory entry and eight durable runs. This is
initial acceptance evidence, not completion of offline, tool, context or
long-session qualification. Further profile results and failures are retained
until root causes are resolved.

The branch is published with normal hooks enabled in review-ready PR
[#39](https://github.com/matheusbgodoi/local-studio/pull/39), targeting dev.
